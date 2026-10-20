/**
 * Tests for core/incremental-indexing/infrastructure/li-segment-merge.mjs.
 *
 * The reconcile write path seals one tiny LI segment per tick, so segment
 * count grows unbounded. These tests cover the batch-merge that bounds it:
 *
 *   - many small live segments collapse into ceil(liveDocs / SEGMENT_SIZE)
 *   - tombstoned docs are dropped during the merge
 *   - model metadata / token format survive a reload after merge
 *   - manifest publish lists only segment files that exist on disk
 *   - consumed files are quarantined (deferred delete), then swept on grace
 *   - crash orphans (segment files not in the manifest) are reclaimed,
 *     idempotently, without touching live segments
 *   - monotonic, collision-proof segment naming
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  mergeLiSegments, sweepQuarantine, sweepOrphanSegments, nextSegmentSeq, pickSegmentsToMerge, collectLiveDocs,
} from '../../core/incremental-indexing/infrastructure/li-segment-merge.mjs';
import { readLiSegmentStats } from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import { resetSegmentIdentityCache } from '../../core/incremental-indexing/infrastructure/li-segment-state.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import {
  createBitmap, setBit, saveBitmap,
} from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';

function mkState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-li-merge-'));
}

const STUB = 'codebase-late-interaction.db';
const SEGDIR = 'codebase-late-interaction.db.segments';

/**
 * Build a segmented LI fixture. `segments` is an array of doc-count numbers;
 * each becomes one sealed segment file with that many docs. Doc ids are
 * globally unique (`doc-<n>`). Returns { indexPath, segmentDir, manifest }.
 */
async function buildSegmented(stateDir, segmentDocCounts) {
  const indexPath = path.join(stateDir, STUB);
  const segmentDir = path.join(stateDir, SEGDIR);
  fs.mkdirSync(segmentDir, { recursive: true });
  const writer = new LateInteractionIndex({
    indexPath, loadExisting: false, tokenDim: 4, useInt8: false, modelId: 'test', maxTokens: 8,
  });
  await writer.init();

  const segments = [];
  let docNum = 0;
  let total = 0;
  // An entry is a doc count (fresh ids doc-<n>) or an explicit id list; every
  // doc gets distinct token values, so the copy that survives can be told apart.
  for (let s = 0; s < segmentDocCounts.length; s += 1) {
    writer._currentSegment = new Map();
    const spec = segmentDocCounts[s];
    const ids = Array.isArray(spec) ? spec : Array.from({ length: spec }, (_, d) => `doc-${docNum + d}`);
    for (const id of ids) {
      const base = docNum * 4;
      await writer.add(id, [Float32Array.from([base + 1, base + 2, base + 3, base + 4])], { name: `n${docNum}` });
      docNum += 1;
    }
    const segName = `segment-${String(s).padStart(4, '0')}.bin`;
    await writer._writeSegmentFile(path.join(segmentDir, segName), writer._currentSegment);
    segments.push({ path: segName, count: ids.length });
    total += ids.length;
  }

  const manifest = {
    version: '3.0', format: 'sslx-v3', modelId: 'test', tokenDim: 4, maxTokens: 8,
    useInt8: false, quantBits: 32, poolFactor: 1, whtSeed: 0, whtOrdering: 'natural',
    matryoshkaDim: 0, totalDocuments: total, nextSeq: segmentDocCounts.length, segments,
  };
  fs.writeFileSync(path.join(segmentDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(indexPath, JSON.stringify({ version: '3.0', format: 'segmented', segmentDir: SEGDIR }));
  return { indexPath, segmentDir, manifest };
}

function readManifest(segmentDir) {
  return JSON.parse(fs.readFileSync(path.join(segmentDir, 'manifest.json'), 'utf-8'));
}

function tombstone(segmentDir, segName, indices, docCount) {
  const bm = createBitmap(docCount);
  for (const i of indices) setBit(bm, i);
  saveBitmap(path.join(segmentDir, segName + '.stale.bin'), bm);
}

describe('mergeLiSegments', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkState(); });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('skips when no segmented index exists', async () => {
    const out = await mergeLiSegments(stateDir);
    expect(out.skipped).toBe('no-segmented-index');
  });

  it('skips when fewer than 2 small segments exist', async () => {
    await buildSegmented(stateDir, [3]);
    const out = await mergeLiSegments(stateDir);
    expect(out.skipped).toBe('too-few-small-segments');
  });

  it('merges many small segments into one and bounds the count', async () => {
    const { segmentDir, indexPath } = await buildSegmented(stateDir, [2, 2, 2, 2, 2]);
    expect(readLiSegmentStats(stateDir)).toEqual({ segmentCount: 5, smallSegmentCount: 5, pendingDeleteFiles: 0 });

    const out = await mergeLiSegments(stateDir);
    expect(out.skipped).toBeUndefined();
    expect(out.mergedFrom).toBe(5);
    expect(out.mergedInto).toBe(1);
    expect(out.segmentCountAfter).toBe(1);

    const manifest = readManifest(segmentDir);
    expect(manifest.segments.length).toBe(1);
    expect(manifest.totalDocuments).toBe(10);
    // Every referenced segment file exists on disk.
    for (const seg of manifest.segments) {
      expect(fs.existsSync(path.join(segmentDir, seg.path))).toBe(true);
    }

    // Reload: all 10 live docs present, model/token metadata preserved.
    const reloaded = new LateInteractionIndex({ indexPath, loadExisting: true, modelId: 'test' });
    await reloaded.init();
    expect(reloaded.documents.size).toBe(10);
    expect(reloaded.tokenDim).toBe(4);
    expect(reloaded.modelId).toBe('test');
    for (let i = 0; i < 10; i += 1) expect(reloaded.documents.has(`doc-${i}`)).toBe(true);
  });

  it('reads only the small segments and keeps their docs byte for byte', async () => {
    const { segmentDir, indexPath } = await buildSegmented(stateDir, [4, 2, 2]);
    tombstone(segmentDir, 'segment-0001.bin', [0], 2);
    const before = new LateInteractionIndex({ indexPath, loadExisting: true, modelId: 'test' });
    await before.init();
    const tokensOf = (idx, id) => Array.from(idx.documents.get(id).tokens);
    const normsOf = (idx, id) => Array.from(idx.documents.get(id).tokenNorms);
    const expected = ['doc-5', 'doc-6', 'doc-7'].map((id) => [id, tokensOf(before, id), normsOf(before, id)]);

    const read = [];
    const original = LateInteractionIndex.prototype._readSegmentFile;
    LateInteractionIndex.prototype._readSegmentFile = function (segPath, skip) {
      read.push(path.basename(segPath));
      return original.call(this, segPath, skip);
    };
    let out;
    try {
      out = await mergeLiSegments(stateDir, { segmentSize: 3 });
    } finally {
      LateInteractionIndex.prototype._readSegmentFile = original;
    }
    expect(read.sort()).toEqual(['segment-0001.bin', 'segment-0002.bin']);
    expect(out.keptDocs).toBe(3);

    const after = new LateInteractionIndex({ indexPath, loadExisting: true, modelId: 'test' });
    await after.init();
    expect(after.documents.size).toBe(7);
    expect(after.documents.has('doc-4')).toBe(false);
    for (const [id, tokens, norms] of expected) {
      expect(tokensOf(after, id)).toEqual(tokens);
      expect(normsOf(after, id)).toEqual(norms);
    }
  });

  it('keeps the same copy a full load keeps when a doc id is live in two segments', async () => {
    // dup-a: in seg1 and seg2 (seg2 is later and wins). dup-b: in seg1 and the
    // large seg3 that is not merged (seg3 wins, so seg1's copy is dropped).
    const { indexPath } = await buildSegmented(stateDir, [['x0', 'x1', 'x2', 'x3', 'x4'], ['dup-a', 'dup-b'], ['dup-a', 'y'], ['dup-b', 'z0', 'z1', 'z2']]);
    const full = new LateInteractionIndex({ indexPath, loadExisting: true, modelId: 'test' });
    await full.init();
    const tokens = (idx, id) => Array.from(idx.documents.get(id).tokens);
    const want = Object.fromEntries([...full.documents.keys()].map((id) => [id, tokens(full, id)]));

    const out = await mergeLiSegments(stateDir, { segmentSize: 4 });
    expect(out.mergedFrom).toBe(2); // seg1 + seg2; seg3 holds 4 docs, not small
    expect(out.keptDocs).toBe(2); // dup-a (seg2 copy) and y

    const after = new LateInteractionIndex({ indexPath, loadExisting: true, modelId: 'test' });
    await after.init();
    expect([...after.documents.keys()].sort()).toEqual(Object.keys(want).sort());
    for (const [id, t] of Object.entries(want)) expect(tokens(after, id)).toEqual(t);
  });

  it('verifies each unchanged segment once per process, not on every merge', async () => {
    const { indexPath, segmentDir, manifest } = await buildSegmented(stateDir, [3, 2, 2]);
    resetSegmentIdentityCache();
    let verified = 0;
    const original = LateInteractionIndex.prototype._readSegmentIdsVerified;
    LateInteractionIndex.prototype._readSegmentIdsVerified = function (...a) { verified += 1; return original.apply(this, a); };
    try {
      const picked = new Set([path.join(segmentDir, 'segment-0001.bin'), path.join(segmentDir, 'segment-0002.bin')]);
      const first = await collectLiveDocs(indexPath, segmentDir, manifest, picked);
      expect(verified).toBe(3);
      const second = await collectLiveDocs(indexPath, segmentDir, manifest, picked);
      expect(verified).toBe(3);
      expect(second.collected.map((d) => d.docId)).toEqual(first.collected.map((d) => d.docId));
    } finally {
      LateInteractionIndex.prototype._readSegmentIdsVerified = original;
      resetSegmentIdentityCache();
    }
  });

  it('picks small segments size-tiered so a large one is not rewritten for a few tiny ones', () => {
    const seg = (count, i) => ({ path: `s${i}`, count });
    const pick = (counts) => pickSegmentsToMerge(counts.map(seg)).map((s) => s.count).sort((a, b) => a - b);
    expect(pick([5574, 5, 4, 5, 10, 1, 15, 106, 1])).toEqual([1, 1, 4, 5, 5, 10, 15, 106]);
    expect(pick([5574, 1, 1])).toEqual([1, 1]);
    expect(pick([5574, 900, 400, 300])).toEqual([300, 400, 900, 5574]);
    expect(pick([3, 3, 3, 3])).toEqual([3, 3, 3, 3]);
  });

  it('drops tombstoned docs during the merge', async () => {
    const { segmentDir, indexPath } = await buildSegmented(stateDir, [3, 3]);
    // Tombstone doc-1 (seg0 idx1) and doc-4 (seg1 idx1).
    tombstone(segmentDir, 'segment-0000.bin', [1], 3);
    tombstone(segmentDir, 'segment-0001.bin', [1], 3);

    const out = await mergeLiSegments(stateDir);
    expect(out.keptDocs).toBe(4);

    const reloaded = new LateInteractionIndex({ indexPath, loadExisting: true, modelId: 'test' });
    await reloaded.init();
    expect(reloaded.documents.size).toBe(4);
    expect(reloaded.documents.has('doc-1')).toBe(false);
    expect(reloaded.documents.has('doc-4')).toBe(false);
    expect(reloaded.documents.has('doc-0')).toBe(true);
    expect(reloaded.documents.has('doc-5')).toBe(true);
  });

  it('quarantines consumed files (deferred delete) then sweeps them on grace', async () => {
    const { segmentDir } = await buildSegmented(stateDir, [2, 2, 2]);
    const oldFiles = ['segment-0000.bin', 'segment-0001.bin', 'segment-0002.bin'];

    const out = await mergeLiSegments(stateDir, { graceMs: 60_000 });
    expect(out.quarantined).toBeGreaterThanOrEqual(3);

    // Consumed files are NOT deleted yet — readers on the old manifest can
    // still resolve them.
    for (const f of oldFiles) expect(fs.existsSync(path.join(segmentDir, f))).toBe(true);
    expect(fs.existsSync(path.join(segmentDir, 'pending-delete.jsonl'))).toBe(true);

    // After the grace window elapses, a sweep physically removes them.
    const deleted = sweepQuarantine(segmentDir, 0, Date.now() + 120_000);
    expect(deleted).toBeGreaterThanOrEqual(3);
    for (const f of oldFiles) expect(fs.existsSync(path.join(segmentDir, f))).toBe(false);
  });

  it('drains lingering quarantine on a later invocation even with nothing to merge', async () => {
    const { segmentDir } = await buildSegmented(stateDir, [2, 2, 2]);
    // First merge collapses to 1 active segment and quarantines the 3 consumed
    // files (retained — grace not elapsed).
    const first = await mergeLiSegments(stateDir, { graceMs: 1_000_000 });
    expect(first.quarantined).toBeGreaterThanOrEqual(3);
    const onDiskAfterMerge = fs.readdirSync(segmentDir).filter((n) => n.endsWith('.bin') && !n.endsWith('.stale.bin')).length;
    expect(onDiskAfterMerge).toBeGreaterThan(1); // active + quarantined

    // Later: nothing to merge (1 active segment) but grace has elapsed, so the
    // skip path still sweeps the quarantine.
    await new Promise((r) => setTimeout(r, 5));
    const second = await mergeLiSegments(stateDir, { graceMs: 0 });
    expect(second.skipped).toBe('too-few-small-segments');
    expect(second.quarantineDeleted).toBeGreaterThanOrEqual(3);
    const onDiskAfterSweep = fs.readdirSync(segmentDir).filter((n) => n.endsWith('.bin') && !n.endsWith('.stale.bin')).length;
    expect(onDiskAfterSweep).toBe(1); // only the active merged segment remains
  });

  it('sweepOnly drains quarantine without merging or reloading the index', async () => {
    const { segmentDir } = await buildSegmented(stateDir, [2, 2, 2]);
    await mergeLiSegments(stateDir, { graceMs: 1_000_000 }); // collapse → 1, quarantine 3
    const manifestAfterMerge = readManifest(segmentDir);
    expect(manifestAfterMerge.segments.length).toBe(1);

    await new Promise((r) => setTimeout(r, 5));
    const out = await mergeLiSegments(stateDir, { graceMs: 0, sweepOnly: true });
    expect(out.swept).toBe(true);
    expect(out.quarantineDeleted).toBeGreaterThanOrEqual(3);
    // Manifest untouched by a sweep-only pass; on-disk converged to 1 segment.
    expect(readManifest(segmentDir).segments.length).toBe(1);
    const onDisk = fs.readdirSync(segmentDir).filter((n) => n.endsWith('.bin') && !n.endsWith('.stale.bin')).length;
    expect(onDisk).toBe(1);
  });

  it('reclaims crash-orphan segment files without touching live ones', async () => {
    const { segmentDir } = await buildSegmented(stateDir, [10000, 5]); // one full, one small
    const manifest = readManifest(segmentDir);
    const liveNames = new Set(manifest.segments.map((s) => s.path));

    // Plant an orphan (a crashed merge's leftover) not referenced by manifest.
    const orphan = path.join(segmentDir, 'segment-9999.bin');
    fs.writeFileSync(orphan, 'garbage');

    const deleted = sweepOrphanSegments(segmentDir, manifest);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(orphan)).toBe(false);
    for (const name of liveNames) expect(fs.existsSync(path.join(segmentDir, name))).toBe(true);
  });

  it('is idempotent: a second merge after a full compaction is a no-op skip', async () => {
    await buildSegmented(stateDir, [2, 2, 2]);
    const first = await mergeLiSegments(stateDir);
    expect(first.mergedInto).toBe(1);
    // After collapsing to 1 small segment there is nothing left to merge.
    const second = await mergeLiSegments(stateDir);
    expect(second.skipped).toBe('too-few-small-segments');
  });

  it('uses monotonic, collision-proof segment names after out-of-order removal', () => {
    expect(nextSegmentSeq({ segments: [] })).toBe(0);
    expect(nextSegmentSeq({ segments: [{ path: 'segment-0000.bin' }, { path: 'segment-0007.bin' }] })).toBe(8);
    expect(nextSegmentSeq({ nextSeq: 42, segments: [{ path: 'segment-0000.bin' }] })).toBe(42);
  });
});
