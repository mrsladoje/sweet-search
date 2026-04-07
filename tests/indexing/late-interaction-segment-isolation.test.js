import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Regression test: staged LI rebuilds must not mutate the live segment directory.
 *
 * Scenario: A live segmented LI index exists. A staged rebuild loads it, removes
 * a document, adds new documents (crossing the segment flush threshold), then
 * saves to a staged path. The live .segments directory must remain unchanged.
 */

const tmpRoot = path.join(os.tmpdir(), `sweet-search-li-isolation-${process.pid}`);
const livePath = path.join(tmpRoot, 'live-li.db');
const stagedPath = path.join(tmpRoot, 'staged-li.db');

// Dynamically import to avoid config mock issues
async function importLI() {
  const mod = await import('../../core/ranking/late-interaction-index.js');
  return mod.LateInteractionIndex;
}

function makeFakeTokens(dim, numTokens) {
  return Array.from({ length: numTokens }, () => {
    const arr = new Float32Array(dim);
    for (let i = 0; i < dim; i++) arr[i] = Math.random();
    return arr;
  });
}

describe('LateInteractionIndex segment isolation', () => {
  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(tmpRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('staged rebuild does not mutate live .segments directory', async () => {
    const LateInteractionIndex = await importLI();
    const SEGMENT_SIZE = 3; // tiny segments to force flushes quickly

    // Step 1: Build a live segmented index with enough docs to create segments
    const liveIndex = new LateInteractionIndex({
      tokenDim: 4,
      useInt8: true,
      modelId: 'test-model',
      indexPath: livePath,
      segmentSize: SEGMENT_SIZE,
    });

    for (let i = 0; i < 7; i++) {
      await liveIndex.add(`doc-${i}`, makeFakeTokens(4, 2), { file: `src/f${i}.ts` });
    }
    await liveIndex.save();

    // Verify live segments were created
    const liveSegDir = livePath + '.segments';
    expect(existsSync(liveSegDir)).toBe(true);
    const liveSegFiles = await fs.readdir(liveSegDir);
    const liveSegBins = liveSegFiles.filter(f => f.endsWith('.bin')).sort();
    expect(liveSegBins.length).toBeGreaterThan(0);

    // Snapshot the live segment directory state
    const liveManifestBefore = await fs.readFile(path.join(liveSegDir, 'manifest.json'), 'utf-8');
    const liveSegContentsBefore = {};
    for (const f of liveSegBins) {
      liveSegContentsBefore[f] = await fs.readFile(path.join(liveSegDir, f));
    }

    // Step 2: Staged rebuild — load from live, remove a doc, add new docs, save to staged
    const stagedIndex = new LateInteractionIndex({
      tokenDim: 4,
      useInt8: true,
      modelId: 'test-model',
      indexPath: livePath,
      segmentSize: SEGMENT_SIZE,
    });

    await stagedIndex.init();
    expect(stagedIndex.documents.size).toBe(7);

    // Isolate BEFORE any add() calls (this is the pattern buildLateInteractionIndex uses)
    stagedIndex.resetForSave(stagedPath);

    // Remove a document
    stagedIndex.documents.delete('doc-0');

    // Add enough new docs to trigger at least one segment flush during add()
    for (let i = 7; i < 14; i++) {
      await stagedIndex.add(`doc-${i}`, makeFakeTokens(4, 2), { file: `src/f${i}.ts` });
    }

    await stagedIndex.save();

    // Step 3: Verify live .segments was NOT mutated
    const liveSegFilesAfter = await fs.readdir(liveSegDir);
    const liveSegBinsAfter = liveSegFilesAfter.filter(f => f.endsWith('.bin')).sort();
    expect(liveSegBinsAfter).toEqual(liveSegBins);

    const liveManifestAfter = await fs.readFile(path.join(liveSegDir, 'manifest.json'), 'utf-8');
    expect(liveManifestAfter).toBe(liveManifestBefore);

    for (const f of liveSegBins) {
      const contentAfter = await fs.readFile(path.join(liveSegDir, f));
      expect(Buffer.compare(contentAfter, liveSegContentsBefore[f])).toBe(0);
    }

    // Step 4: Verify staged index is correct
    const stagedSegDir = stagedPath + '.segments';
    expect(existsSync(stagedSegDir)).toBe(true);

    // Reload staged and verify doc-0 is gone, new docs are present
    const reloaded = new LateInteractionIndex({
      tokenDim: 4,
      useInt8: true,
      modelId: 'test-model',
      indexPath: stagedPath,
      segmentSize: SEGMENT_SIZE,
    });
    await reloaded.init();

    expect(reloaded.documents.has('doc-0')).toBe(false);
    expect(reloaded.documents.size).toBe(13); // 7 - 1 removed + 7 new
    for (let i = 1; i < 14; i++) {
      expect(reloaded.documents.has(`doc-${i}`)).toBe(true);
    }
  });
});
