/**
 * Regression test for C1 — LI staged-save path aliasing.
 *
 * Pre-fix bug: resetForSave(stagedStub) caused _flushSegment to derive a
 * segments directory at `stagedStub + '.segments'`. On atomic swap of the
 * stub file only, the promoted stub retained an absolute `segmentDir` field
 * still pointing at `.tmp.segments`, so the live index served from the
 * staged directory. Every subsequent rebuild then clobbered live segments
 * while writing.
 *
 * Post-fix contract:
 *   1. During staging, segments go into a distinct directory that does NOT
 *      collide with the live {finalPath}.segments.
 *   2. The stub file records `segmentDir` as a BASENAME (relative path).
 *   3. On atomic promotion, the segments directory is renamed alongside the
 *      stub file so the basename resolves correctly.
 *   4. On load, the stub's segmentDir basename resolves relative to the
 *      stub's dirname — NEVER with a stale `.tmp` suffix.
 *   5. If a broken stub (absolute path with `.tmp.segments`) is loaded, the
 *      self-heal migrates the orphaned directory and rewrites the stub.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

async function mkTmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'li-staged-save-'));
  return dir;
}

function seedTokens(dim = 8, n = 3) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Float32Array(dim);
    for (let j = 0; j < dim; j++) row[j] = ((i + 1) * (j + 1)) / 10;
    out[i] = row;
  }
  return out;
}

async function populate(index, count = 3) {
  for (let i = 0; i < count; i++) {
    await index.add(`doc-${i}`, seedTokens(8, 3), { file: `f${i}.js` });
  }
}

describe('LI staged-save (C1 regression)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkTmp();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('stub records segmentDir as a basename (not absolute) after non-staged save', async () => {
    const indexPath = path.join(tmpDir, 'live.db');
    // Force segmented path: segmentSize=2 so with 3 docs we exceed threshold
    const idx = new LateInteractionIndex({
      indexPath,
      tokenDim: 8,
      useInt8: false,
      loadExisting: false,
      segmentSize: 2,
    });
    await idx.init();
    await populate(idx, 3);
    await idx.save();

    const stub = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
    expect(stub.format).toBe('segmented');
    // segmentDir MUST be a basename, not an absolute path
    expect(path.isAbsolute(stub.segmentDir)).toBe(false);
    expect(stub.segmentDir).toBe('live.db.segments');
    // The segments directory must exist at the resolved location
    expect(existsSync(path.join(tmpDir, stub.segmentDir))).toBe(true);
  });

  it('staged save writes segments to a distinct directory and stub points at final basename', async () => {
    const finalPath = path.join(tmpDir, 'live.db');
    const stagedPath = finalPath + '.tmp';
    const stagingSegmentDir = stagedPath + '-stage.segments';

    const idx = new LateInteractionIndex({
      indexPath: finalPath,
      tokenDim: 8,
      useInt8: false,
      loadExisting: false,
      segmentSize: 2,
    });
    await idx.init();
    idx.resetForSave(stagedPath, {
      stagingSegmentDir,
      finalIndexPath: finalPath,
    });
    await populate(idx, 3);
    await idx.save();

    // Staged stub exists at the staging path
    const stub = JSON.parse(await fs.readFile(stagedPath, 'utf-8'));

    // CRITICAL: the stub's segmentDir field records the POST-swap basename,
    // not the staged basename. This is the whole point of C1 fix.
    expect(stub.segmentDir).toBe('live.db.segments');
    expect(stub.segmentDir).not.toContain('.tmp');

    // Segments were written to the stagingSegmentDir, NOT to
    // {finalPath}.segments (which would collide with the live dir).
    expect(existsSync(stagingSegmentDir)).toBe(true);
    expect(existsSync(finalPath + '.segments')).toBe(false);
    // And NOT to the old broken path (.tmp.segments next to staged stub)
    expect(existsSync(stagedPath + '.segments')).toBe(false);
  });

  it('load resolves basename segmentDir relative to stub dirname', async () => {
    const indexPath = path.join(tmpDir, 'live.db');
    const idx = new LateInteractionIndex({
      indexPath,
      tokenDim: 8,
      useInt8: false,
      loadExisting: false,
      segmentSize: 2,
    });
    await idx.init();
    await populate(idx, 3);
    await idx.save();

    // Re-open with a fresh instance (simulates process restart)
    const reopened = new LateInteractionIndex({
      indexPath,
      tokenDim: 8,
      useInt8: false,
    });
    await reopened.init();
    expect(reopened.documents.size).toBe(3);
  });

  it('self-heal migrates broken .tmp.segments state and rewrites stub', async () => {
    // Simulate the pre-fix broken on-disk state:
    //   live.db stub contains an absolute path with .tmp.segments suffix
    //   live.db.tmp.segments/ directory holds the actual segments
    const finalPath = path.join(tmpDir, 'live.db');
    const brokenSegDir = finalPath + '.tmp.segments';

    // First, build a legitimate segmented index so we have real segment files
    const idx = new LateInteractionIndex({
      indexPath: finalPath,
      tokenDim: 8,
      useInt8: false,
      loadExisting: false,
      segmentSize: 2,
    });
    await idx.init();
    await populate(idx, 3);
    await idx.save();
    // Move the segments directory to the "broken" location
    await fs.rename(finalPath + '.segments', brokenSegDir);
    // Rewrite the stub to simulate the pre-fix absolute path with .tmp.segments
    await fs.writeFile(finalPath, JSON.stringify({
      version: '3.0',
      format: 'segmented',
      segmentDir: brokenSegDir, // absolute, contains .tmp.segments
    }));

    // Now load — self-heal should migrate
    const reopened = new LateInteractionIndex({
      indexPath: finalPath,
      tokenDim: 8,
      useInt8: false,
    });
    await reopened.init();

    // Broken directory should be migrated
    expect(existsSync(brokenSegDir)).toBe(false);
    expect(existsSync(finalPath + '.segments')).toBe(true);

    // Stub should be rewritten to use the stable basename
    const healedStub = JSON.parse(await fs.readFile(finalPath, 'utf-8'));
    expect(healedStub.segmentDir).toBe('live.db.segments');
    expect(healedStub.segmentDir).not.toContain('.tmp');

    // Documents must still be loadable
    expect(reopened.documents.size).toBe(3);
  });
});
