import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Phase 2: WHT Rotation + INT8 tests.
 *
 * Validates: rotation is applied, scoring works in rotated space,
 * whtSeed=0 disables rotation, quality preservation.
 */

const tmpRoot = path.join(os.tmpdir(), `sweet-search-wht-${process.pid}`);

async function importLI() {
  const mod = await import('../../core/ranking/late-interaction-index.js');
  return mod.LateInteractionIndex;
}

function makeFakeTokens(dim, numTokens, seed = 0) {
  // Deterministic random for reproducible tests
  let s = seed;
  const prng = () => {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    return (s / 0x7FFFFFFF) * 2 - 1;
  };
  return Array.from({ length: numTokens }, () => {
    const arr = new Float32Array(dim);
    for (let i = 0; i < dim; i++) arr[i] = prng();
    return arr;
  });
}

function l2Norm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  return Math.sqrt(sum);
}

describe('WHT Rotation (Phase 2)', () => {
  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('WHT rotation preserves token norms (orthogonal transform)', async () => {
    const LateInteractionIndex = await importLI();

    const indexWithRotation = new LateInteractionIndex({
      tokenDim: 128,
      useInt8: false, // float32 to check norms directly
      modelId: 'test',
      indexPath: path.join(tmpRoot, 'rot.db'),
      whtSeed: 42,
    });

    const indexNoRotation = new LateInteractionIndex({
      tokenDim: 128,
      useInt8: false,
      modelId: 'test',
      indexPath: path.join(tmpRoot, 'norot.db'),
      whtSeed: 0, // disabled
    });

    const tokens = makeFakeTokens(128, 10, 12345);

    await indexWithRotation.add('doc-0', tokens);
    await indexNoRotation.add('doc-0', tokens);

    const rotDoc = indexWithRotation.documents.get('doc-0');
    const noRotDoc = indexNoRotation.documents.get('doc-0');

    // Token norms must be preserved (WHT is orthogonal)
    for (let t = 0; t < 10; t++) {
      expect(rotDoc.tokenNorms[t]).toBeCloseTo(noRotDoc.tokenNorms[t], 4);
    }

    // But token data must be DIFFERENT (rotation actually happened)
    let anyDiff = false;
    for (let i = 0; i < rotDoc.tokens.length; i++) {
      if (Math.abs(rotDoc.tokens[i] - noRotDoc.tokens[i]) > 1e-6) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });

  it('scoring with rotation produces valid results (round-trip)', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'score-rot.db');

    const index = new LateInteractionIndex({
      tokenDim: 16,
      useInt8: true,
      modelId: 'test',
      indexPath,
      whtSeed: 42,
    });

    // Add docs with known token patterns
    for (let i = 0; i < 5; i++) {
      await index.add(`doc-${i}`, makeFakeTokens(16, 8, i * 100));
    }

    // Score with query in rotated space
    const queryTokens = makeFakeTokens(16, 3, 999);
    const results = await index.scoreWithLateInteraction(queryTokens, [
      { id: 'doc-0', score: 1 },
      { id: 'doc-1', score: 1 },
      { id: 'doc-2', score: 1 },
    ]);

    // All scores should be valid numbers > 0
    for (const r of results) {
      expect(r.lateInteractionScore).toBeGreaterThan(0);
      expect(isFinite(r.lateInteractionScore)).toBe(true);
    }

    // Scores should differentiate docs (not all identical)
    const scores = results.map(r => r.lateInteractionScore);
    const allSame = scores.every(s => Math.abs(s - scores[0]) < 1e-6);
    expect(allSame).toBe(false);
  });

  it('whtSeed=0 disables rotation (backward compat)', async () => {
    const LateInteractionIndex = await importLI();

    const index = new LateInteractionIndex({
      tokenDim: 8,
      useInt8: true,
      modelId: 'test',
      indexPath: path.join(tmpRoot, 'norot.db'),
      whtSeed: 0,
    });

    const tokens = makeFakeTokens(8, 3, 42);
    await index.add('doc-0', tokens);

    // _signVector should not be initialized
    expect(index._signVector).toBeNull();
  });

  it('whtSeed persists in SSLX format and restores on load', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'persist.db');

    const index = new LateInteractionIndex({
      tokenDim: 8,
      useInt8: true,
      modelId: 'test',
      indexPath,
      segmentSize: 3,
      whtSeed: 42,
    });

    for (let i = 0; i < 5; i++) {
      await index.add(`doc-${i}`, makeFakeTokens(8, 3, i));
    }
    await index.save();

    // Reload and verify whtSeed is restored
    const reloaded = new LateInteractionIndex({
      tokenDim: 8,
      useInt8: true,
      modelId: 'test',
      indexPath,
      segmentSize: 3,
    });
    await reloaded.init();

    expect(reloaded.whtSeed).toBe(42);
    expect(reloaded.documents.size).toBe(5);

    // Scoring should produce the same results as pre-save
    const queryTokens = makeFakeTokens(8, 2, 777);
    const scoresBefore = await index.scoreWithLateInteraction(queryTokens, [
      { id: 'doc-0', score: 1 },
      { id: 'doc-1', score: 1 },
    ]);
    const scoresAfter = await reloaded.scoreWithLateInteraction(queryTokens, [
      { id: 'doc-0', score: 1 },
      { id: 'doc-1', score: 1 },
    ]);

    for (let i = 0; i < scoresBefore.length; i++) {
      expect(scoresAfter[i].lateInteractionScore).toBeCloseTo(
        scoresBefore[i].lateInteractionScore, 5,
      );
    }
  });

  it('WHT rotation equalizes dimension variance', async () => {
    const LateInteractionIndex = await importLI();

    // Create tokens with intentionally skewed dimension variance
    // (some dimensions have high variance, others low)
    const dim = 128;
    const numTokens = 50;
    const tokens = [];
    for (let t = 0; t < numTokens; t++) {
      const vec = new Float32Array(dim);
      for (let d = 0; d < dim; d++) {
        // First 32 dims: high variance; rest: low variance
        const scale = d < 32 ? 1.0 : 0.1;
        vec[d] = (Math.random() - 0.5) * 2 * scale;
      }
      tokens.push(vec);
    }

    const indexRot = new LateInteractionIndex({
      tokenDim: dim,
      useInt8: false,
      modelId: 'test',
      indexPath: path.join(tmpRoot, 'var-rot.db'),
      whtSeed: 42,
    });

    const indexNoRot = new LateInteractionIndex({
      tokenDim: dim,
      useInt8: false,
      modelId: 'test',
      indexPath: path.join(tmpRoot, 'var-norot.db'),
      whtSeed: 0,
    });

    await indexRot.add('doc', tokens);
    await indexNoRot.add('doc', tokens);

    // Compute per-dimension variance
    function dimVariance(doc) {
      const vars = new Float32Array(dim);
      for (let d = 0; d < dim; d++) {
        let sum = 0, sumSq = 0;
        for (let t = 0; t < numTokens; t++) {
          const v = doc.tokens[t * dim + d];
          sum += v;
          sumSq += v * v;
        }
        const mean = sum / numTokens;
        vars[d] = sumSq / numTokens - mean * mean;
      }
      return vars;
    }

    const noRotVars = dimVariance(indexNoRot.documents.get('doc'));
    const rotVars = dimVariance(indexRot.documents.get('doc'));

    // Without rotation: high variance ratio (max/min >> 1)
    const noRotMax = Math.max(...noRotVars.filter(v => v > 0));
    const noRotMin = Math.min(...noRotVars.filter(v => v > 0));
    const noRotRatio = noRotMax / noRotMin;

    // With rotation: variance should be more equalized (lower ratio)
    const rotMax = Math.max(...rotVars.filter(v => v > 0));
    const rotMin = Math.min(...rotVars.filter(v => v > 0));
    const rotRatio = rotMax / rotMin;

    // Rotation should reduce the variance ratio significantly
    expect(rotRatio).toBeLessThan(noRotRatio);
  });
});
