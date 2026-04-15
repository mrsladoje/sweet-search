/**
 * Regression tests for N1 — `atomicSwapLateInteractionIndex` rollback bug.
 *
 * Pre-fix: when the segments-dir rename succeeded but the stub swap failed,
 * the catch block used the predicate `!existsSync(finalSegDir)` to decide
 * whether to restore from `.bak`. After the segments rename, `finalSegDir`
 * exists (pointing at the NEW segments), so the predicate was always false
 * and rollback never executed. The live index was left in a torn state:
 * OLD stub + NEW segments + ORIGINAL segments stranded in `.bak`.
 *
 * Post-fix contract (see core/indexing/indexer-phases.js):
 *   1. If the stub swap fails after the segments were moved into place,
 *      the new segments are stashed at `.failed-swap` for recovery.
 *   2. The original segments are restored from `.bak` to `finalSegDir`.
 *   3. The original error propagates.
 *   4. Cleanup sidecars (`.bak`, `.failed-swap`) are removed on success.
 *
 * Pre-fix verification (2026-04-15): I ran this suite against a temporarily
 * reverted `atomicSwapLateInteractionIndex` with the broken rollback predicate
 * and 3 of the 4 tests failed with the expected assertion mismatches:
 *   - "rollback: missing staged stub causes throw AND restores original segments"
 *   - "rollback: no original segments — swap fails with no .bak cleanup needed"
 *   - "rollback: stale .failed-swap from prior run is cleaned before reuse"
 * The happy-path test passed on both the pre-fix and post-fix code because
 * it never enters the broken catch branch. 3/4 load-bearing on the fix.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { _testInternals } from '../../core/indexing/indexer-phases.js';

const { atomicSwapLateInteractionIndex, stagedLateInteractionSegmentDir } = _testInternals;

async function mkTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'atomic-swap-li-'));
}

async function writeMarker(dir, name, contents) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), contents);
}

describe('atomicSwapLateInteractionIndex (N1 regression)', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkTmp();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('happy path: staged stub + staged segments promoted to live', async () => {
    const finalPath = path.join(tmpDir, 'live.db');
    const stagedPath = finalPath + '.tmp';
    const finalSegDir = finalPath + '.segments';
    const stagingSegDir = stagedLateInteractionSegmentDir(stagedPath);

    // Original live state
    await fs.writeFile(finalPath, '"original-stub"');
    await writeMarker(finalSegDir, 'ORIGINAL.marker', 'original');

    // Staged state ready to promote
    await fs.writeFile(stagedPath, '"staged-stub"');
    await writeMarker(stagingSegDir, 'STAGED.marker', 'staged');

    await atomicSwapLateInteractionIndex(stagedPath, finalPath);

    // Live stub is now the staged content
    expect(await fs.readFile(finalPath, 'utf-8')).toBe('"staged-stub"');
    // Live segments dir contains only the STAGED marker
    expect(existsSync(path.join(finalSegDir, 'STAGED.marker'))).toBe(true);
    expect(existsSync(path.join(finalSegDir, 'ORIGINAL.marker'))).toBe(false);
    // Nothing left behind
    expect(existsSync(stagingSegDir)).toBe(false);
    expect(existsSync(stagedPath)).toBe(false);
    expect(existsSync(finalSegDir + '.bak')).toBe(false);
    expect(existsSync(finalSegDir + '.failed-swap')).toBe(false);
  });

  it('rollback: missing staged stub causes throw AND restores original segments', async () => {
    // Simulate the torn-state scenario: segments land successfully but the
    // stub swap fails (here because the staged stub file was never written).
    // atomicSwapDatabase throws ENOENT trying to rename tmpPath → finalPath.
    const finalPath = path.join(tmpDir, 'live.db');
    const stagedPath = finalPath + '.tmp';
    const finalSegDir = finalPath + '.segments';
    const stagingSegDir = stagedLateInteractionSegmentDir(stagedPath);

    // Original live state
    await fs.writeFile(finalPath, '"original-stub"');
    await writeMarker(finalSegDir, 'ORIGINAL.marker', 'original');

    // Staged segments exist but staged stub does NOT
    await writeMarker(stagingSegDir, 'STAGED.marker', 'staged');
    // stagedPath deliberately not created → atomicSwapDatabase fails

    await expect(
      atomicSwapLateInteractionIndex(stagedPath, finalPath)
    ).rejects.toThrow();

    // ORIGINAL segments are back at finalSegDir (rollback succeeded)
    expect(existsSync(path.join(finalSegDir, 'ORIGINAL.marker'))).toBe(true);
    expect(existsSync(path.join(finalSegDir, 'STAGED.marker'))).toBe(false);

    // STAGED segments are preserved at .failed-swap for manual recovery
    // (so the operator can inspect what would have been promoted)
    expect(existsSync(finalSegDir + '.failed-swap')).toBe(true);
    expect(
      existsSync(path.join(finalSegDir + '.failed-swap', 'STAGED.marker'))
    ).toBe(true);

    // Original live stub was restored by atomicSwapDatabase's own rollback
    expect(existsSync(finalPath)).toBe(true);
    expect(await fs.readFile(finalPath, 'utf-8')).toBe('"original-stub"');
  });

  it('rollback: no original segments — swap fails with no .bak cleanup needed', async () => {
    // Edge case: this is the very first LI rebuild, so there are no original
    // segments to back up. Segments rename still runs (creating finalSegDir),
    // then the stub swap fails, and rollback should move the new segments to
    // .failed-swap — with no bak to restore because there wasn't one.
    const finalPath = path.join(tmpDir, 'live.db');
    const stagedPath = finalPath + '.tmp';
    const finalSegDir = finalPath + '.segments';
    const stagingSegDir = stagedLateInteractionSegmentDir(stagedPath);

    // NO original live state: fresh install
    await writeMarker(stagingSegDir, 'STAGED.marker', 'staged');
    // stagedPath deliberately not created

    await expect(
      atomicSwapLateInteractionIndex(stagedPath, finalPath)
    ).rejects.toThrow();

    // No original existed → finalSegDir should NOT exist post-rollback
    expect(existsSync(finalSegDir)).toBe(false);
    // Staged segments preserved at .failed-swap
    expect(existsSync(finalSegDir + '.failed-swap')).toBe(true);
    expect(
      existsSync(path.join(finalSegDir + '.failed-swap', 'STAGED.marker'))
    ).toBe(true);
  });

  it('rollback: stale .failed-swap from prior run is cleaned before reuse', async () => {
    // If a previous swap failure left a `.failed-swap` directory behind, the
    // next swap must be able to write into the same location without
    // colliding. atomicSwapLateInteractionIndex clears .failed-swap up front
    // and also before the catch-block rename.
    const finalPath = path.join(tmpDir, 'live.db');
    const stagedPath = finalPath + '.tmp';
    const finalSegDir = finalPath + '.segments';
    const stagingSegDir = stagedLateInteractionSegmentDir(stagedPath);

    // Seed a stale .failed-swap from a "previous" failed run
    await writeMarker(finalSegDir + '.failed-swap', 'STALE.marker', 'stale');

    // Set up a fresh successful swap
    await fs.writeFile(finalPath, '"original-stub"');
    await writeMarker(finalSegDir, 'ORIGINAL.marker', 'original');
    await fs.writeFile(stagedPath, '"staged-stub"');
    await writeMarker(stagingSegDir, 'STAGED.marker', 'staged');

    await atomicSwapLateInteractionIndex(stagedPath, finalPath);

    // Swap succeeded AND the stale .failed-swap was removed
    expect(existsSync(finalSegDir + '.failed-swap')).toBe(false);
    expect(existsSync(path.join(finalSegDir, 'STAGED.marker'))).toBe(true);
  });
});
