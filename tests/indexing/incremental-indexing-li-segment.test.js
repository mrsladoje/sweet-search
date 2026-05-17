/**
 * Tests for core/incremental-indexing/infrastructure/li-segment-state.mjs
 *
 * Plan § 7.5 LI segments + tombstone state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  openSegmentState,
  tombstoneDoc,
  persistSegmentState,
  staleDocRatio,
  listSegments,
  evaluateSegmentRatios,
  filterLiveDocs,
  isDocTombstoned,
  STALE_SIDECAR_EXT,
} from '../../core/incremental-indexing/infrastructure/li-segment-state.mjs';

describe('li-segment-state', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweet-search-li-'));
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('openSegmentState seeds a fresh bitmap when sidecar is missing', () => {
    const seg = path.join(dir, 'seg-000.bin');
    fs.writeFileSync(seg, Buffer.alloc(0));
    const state = openSegmentState(seg, 100);
    expect(state.docCount).toBe(100);
    expect(state.bitmap.capacity).toBeGreaterThanOrEqual(100);
    expect(staleDocRatio(state)).toBe(0);
  });

  it('tombstoneDoc + persist round-trips via the sidecar', () => {
    const seg = path.join(dir, 'seg-000.bin');
    fs.writeFileSync(seg, Buffer.alloc(0));
    const state = openSegmentState(seg, 100);
    tombstoneDoc(state, 5);
    tombstoneDoc(state, 99);
    persistSegmentState(state);
    expect(fs.existsSync(seg + STALE_SIDECAR_EXT)).toBe(true);

    const reloaded = openSegmentState(seg, 100);
    expect(isDocTombstoned(reloaded, 5)).toBe(true);
    expect(isDocTombstoned(reloaded, 6)).toBe(false);
    expect(isDocTombstoned(reloaded, 99)).toBe(true);
    expect(staleDocRatio(reloaded)).toBeCloseTo(2 / 100, 5);
  });

  it('listSegments excludes the stale-sidecar', () => {
    const seg1 = path.join(dir, 'seg-000.bin');
    const seg2 = path.join(dir, 'seg-001.bin');
    fs.writeFileSync(seg1, Buffer.alloc(0));
    fs.writeFileSync(seg2, Buffer.alloc(0));
    fs.writeFileSync(seg1 + STALE_SIDECAR_EXT, Buffer.alloc(64));
    const segs = listSegments(dir);
    expect(segs.length).toBe(2);
    expect(segs.find((s) => s.endsWith(STALE_SIDECAR_EXT))).toBeUndefined();
  });

  it('evaluateSegmentRatios reports per-segment stale ratio', () => {
    const seg1 = path.join(dir, 'seg-000.bin');
    const seg2 = path.join(dir, 'seg-001.bin');
    fs.writeFileSync(seg1, Buffer.alloc(0));
    fs.writeFileSync(seg2, Buffer.alloc(0));

    const state1 = openSegmentState(seg1, 10);
    tombstoneDoc(state1, 1);
    tombstoneDoc(state1, 2);
    tombstoneDoc(state1, 3);
    persistSegmentState(state1);

    const docCounts = new Map([[seg1, 10], [seg2, 10]]);
    const out = evaluateSegmentRatios(dir, docCounts);
    expect(out.length).toBe(2);
    const byId = Object.fromEntries(out.map((o) => [o.segmentId, o.staleDocRatio]));
    expect(byId['seg-000.bin']).toBeCloseTo(0.3, 5);
    expect(byId['seg-001.bin']).toBe(0);
  });

  it('staleDocRatio ignores tombstone bits beyond the current docCount', () => {
    const seg = path.join(dir, 'seg-000.bin');
    fs.writeFileSync(seg, Buffer.alloc(0));
    const state = openSegmentState(seg, 100);
    tombstoneDoc(state, 99);
    persistSegmentState(state);

    const reopened = openSegmentState(seg, 10);
    expect(staleDocRatio(reopened)).toBe(0);
  });

  it('filterLiveDocs drops tombstoned indices', () => {
    const seg = path.join(dir, 'seg-000.bin');
    fs.writeFileSync(seg, Buffer.alloc(0));
    const state = openSegmentState(seg, 50);
    tombstoneDoc(state, 7);
    expect(filterLiveDocs(state, [1, 7, 42])).toEqual([1, 42]);
  });
});
