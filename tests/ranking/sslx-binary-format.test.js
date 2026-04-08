import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * SSLX v3 binary segment format tests.
 *
 * Validates: write/read round-trip, backward compat with LISE,
 * CRC32 integrity, tokenNorms persistence, edge cases.
 */

const tmpRoot = path.join(os.tmpdir(), `sweet-search-sslx-${process.pid}`);

async function importLI() {
  const mod = await import('../../core/ranking/late-interaction-index.js');
  return mod.LateInteractionIndex;
}

function makeFakeTokens(dim, numTokens) {
  return Array.from({ length: numTokens }, () => {
    const arr = new Float32Array(dim);
    for (let i = 0; i < dim; i++) arr[i] = (Math.random() - 0.5) * 2;
    return arr;
  });
}

describe('SSLX v3 binary segment format', () => {
  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('round-trips documents through SSLX binary format', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'li.db');
    const SEGMENT_SIZE = 3;

    // Build index with enough docs to trigger segmented save
    const index = new LateInteractionIndex({
      tokenDim: 8,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: SEGMENT_SIZE,
    });

    const originalTokens = {};
    for (let i = 0; i < 7; i++) {
      const tokens = makeFakeTokens(8, 3 + (i % 3)); // varying token counts
      originalTokens[`doc-${i}`] = tokens;
      await index.add(`doc-${i}`, tokens, { file: `src/f${i}.ts` });
    }
    await index.save();

    // Verify SSLX format was written
    const segDir = indexPath + '.segments';
    expect(existsSync(segDir)).toBe(true);
    const manifest = JSON.parse(await fs.readFile(path.join(segDir, 'manifest.json'), 'utf-8'));
    expect(manifest.format).toBe('sslx-v3');
    expect(manifest.totalDocuments).toBe(7);

    // Verify segment files have SSLX magic
    for (const seg of manifest.segments) {
      const segBuf = await fs.readFile(path.join(segDir, seg.path));
      expect(segBuf.readUInt32LE(0)).toBe(0x53534C58); // "SSLX"
      expect(segBuf.readUInt16LE(4)).toBe(3); // version
    }

    // Reload and verify
    const reloaded = new LateInteractionIndex({
      tokenDim: 8,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: SEGMENT_SIZE,
    });
    await reloaded.init();

    expect(reloaded.documents.size).toBe(7);
    for (let i = 0; i < 7; i++) {
      const id = `doc-${i}`;
      expect(reloaded.documents.has(id)).toBe(true);

      const doc = reloaded.documents.get(id);
      const origDoc = index.documents.get(id);

      // Token count must match
      expect(doc.numTokens).toBe(origDoc.numTokens);
      expect(doc.dim).toBe(origDoc.dim);

      // INT8 token data must match byte-for-byte
      expect(doc.tokens.length).toBe(origDoc.tokens.length);
      for (let j = 0; j < doc.tokens.length; j++) {
        expect(doc.tokens[j]).toBe(origDoc.tokens[j]);
      }

      // Per-token min/scale arrays must match
      expect(doc.minArray).toBeDefined();
      expect(doc.scaleArray).toBeDefined();
      expect(doc.minArray.length).toBe(origDoc.minArray.length);
      for (let j = 0; j < doc.minArray.length; j++) {
        expect(doc.minArray[j]).toBeCloseTo(origDoc.minArray[j], 5);
        expect(doc.scaleArray[j]).toBeCloseTo(origDoc.scaleArray[j], 5);
      }

      // tokenNorms must be persisted (not rebuilt)
      expect(doc.tokenNorms).toBeDefined();
      expect(doc.tokenNorms.length).toBe(origDoc.tokenNorms.length);
      for (let j = 0; j < doc.tokenNorms.length; j++) {
        expect(doc.tokenNorms[j]).toBeCloseTo(origDoc.tokenNorms[j], 4);
      }
    }
  });

  it('SSLX segments are compact — overhead < 10% of raw payload', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'li-size.db');
    const SEGMENT_SIZE = 30; // force segmented save

    const index = new LateInteractionIndex({
      tokenDim: 128,
      useInt8: true,
      modelId: 'lateon-code',
      indexPath,
      segmentSize: SEGMENT_SIZE,
    });

    // Add 50 docs with realistic token counts (triggers segmented save)
    for (let i = 0; i < 50; i++) {
      await index.add(`doc-${i}`, makeFakeTokens(128, 50), { file: `src/f${i}.ts` });
    }
    await index.save();

    const segDir = indexPath + '.segments';
    const manifest = JSON.parse(await fs.readFile(path.join(segDir, 'manifest.json'), 'utf-8'));
    expect(manifest.format).toBe('sslx-v3');

    let totalBinarySize = 0;
    for (const seg of manifest.segments) {
      const stat = await fs.stat(path.join(segDir, seg.path));
      totalBinarySize += stat.size;
    }

    const rawPayload = 50 * 50 * 128; // int8 bytes
    const rawWithNorms = rawPayload + 50 * 50 * 4; // + f32 norms
    const overhead = totalBinarySize - rawWithNorms;

    // Binary overhead (headers, doc table, ID table, CRC) should be < 10% of payload
    expect(overhead / rawWithNorms).toBeLessThan(0.10);
  });

  it('CRC32 corruption is detected and _readSegmentFile throws', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'li-corrupt.db');
    const SEGMENT_SIZE = 3; // force segmented save

    const index = new LateInteractionIndex({
      tokenDim: 4,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: SEGMENT_SIZE,
    });

    for (let i = 0; i < 5; i++) {
      await index.add(`doc-${i}`, makeFakeTokens(4, 2));
    }
    await index.save();

    // Corrupt a byte in the middle of the segment file
    const segDir = indexPath + '.segments';
    const manifest = JSON.parse(await fs.readFile(path.join(segDir, 'manifest.json'), 'utf-8'));
    const segPath = path.join(segDir, manifest.segments[0].path);
    const buf = await fs.readFile(segPath);
    buf[100] ^= 0xFF; // flip bits
    await fs.writeFile(segPath, buf);

    // _readSegmentFile should throw CRC32 mismatch
    const reloaded = new LateInteractionIndex({
      tokenDim: 4,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: SEGMENT_SIZE,
    });

    await expect(reloaded._readSegmentFile(segPath)).rejects.toThrow(/CRC32 mismatch/);

    // init() catches the error (existing load() behavior) — index loads empty
    await reloaded.init();
    expect(reloaded.documents.size).toBe(0);
  });

  it('handles documents with varying token counts', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'li-varying.db');
    const SEGMENT_SIZE = 100;

    const index = new LateInteractionIndex({
      tokenDim: 16,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: SEGMENT_SIZE,
    });

    // Edge cases: 1 token, many tokens, varied counts
    const tokenCounts = [1, 2, 100, 50, 3, 1, 200];
    for (let i = 0; i < tokenCounts.length; i++) {
      await index.add(`doc-${i}`, makeFakeTokens(16, tokenCounts[i]));
    }
    await index.save();

    const reloaded = new LateInteractionIndex({
      tokenDim: 16,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: SEGMENT_SIZE,
    });
    await reloaded.init();

    expect(reloaded.documents.size).toBe(tokenCounts.length);
    for (let i = 0; i < tokenCounts.length; i++) {
      const doc = reloaded.documents.get(`doc-${i}`);
      expect(doc.numTokens).toBe(tokenCounts[i]);
    }
  });

  it('handles document IDs with unicode characters', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'li-unicode.db');

    const index = new LateInteractionIndex({
      tokenDim: 4,
      useInt8: true,
      modelId: 'test',
      indexPath,
      segmentSize: 100,
    });

    const ids = [
      'simple-id',
      'path/to/file.ts',
      'src/日本語ファイル.ts',
      'src/émojis-🎉.ts',
      'a'.repeat(200), // long ID
    ];

    for (const id of ids) {
      await index.add(id, makeFakeTokens(4, 2));
    }
    await index.save();

    const reloaded = new LateInteractionIndex({
      tokenDim: 4,
      useInt8: true,
      modelId: 'test',
      indexPath,
      segmentSize: 100,
    });
    await reloaded.init();

    for (const id of ids) {
      expect(reloaded.documents.has(id)).toBe(true);
    }
  });

  it('scoring works correctly after SSLX round-trip', async () => {
    const LateInteractionIndex = await importLI();
    const indexPath = path.join(tmpRoot, 'li-score.db');

    const index = new LateInteractionIndex({
      tokenDim: 8,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: 100,
    });

    // Add docs and compute scores before save
    for (let i = 0; i < 5; i++) {
      await index.add(`doc-${i}`, makeFakeTokens(8, 10));
    }

    const queryTokens = makeFakeTokens(8, 3);
    const scoresBefore = await index.scoreWithLateInteraction(queryTokens, [
      { id: 'doc-0', score: 1 },
      { id: 'doc-1', score: 1 },
      { id: 'doc-2', score: 1 },
    ]);

    await index.save();

    // Reload and re-score
    const reloaded = new LateInteractionIndex({
      tokenDim: 8,
      useInt8: true,
      modelId: 'test-model',
      indexPath,
      segmentSize: 100,
    });
    await reloaded.init();

    const scoresAfter = await reloaded.scoreWithLateInteraction(queryTokens, [
      { id: 'doc-0', score: 1 },
      { id: 'doc-1', score: 1 },
      { id: 'doc-2', score: 1 },
    ]);

    // Scores must be identical (same quantized data, same norms)
    for (let i = 0; i < scoresBefore.length; i++) {
      expect(scoresAfter[i].lateInteractionScore).toBeCloseTo(
        scoresBefore[i].lateInteractionScore,
        6, // f32 precision
      );
    }
  });
});
