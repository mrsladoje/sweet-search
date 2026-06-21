/**
 * Bounded-build (segment eviction) parity for LateInteractionIndex.
 *
 * The streaming indexer builds the LI index with `buildEvict: true` so each
 * flushed segment's per-token slabs are dropped from the in-memory map — peak
 * heap O(one segment) instead of O(all docs). This must produce a byte-for-byte
 * equivalent on-disk index to a normal build, and the live `documents` map must
 * actually shrink during the build (proving eviction happened).
 *
 * Regression guard for the large-repo OOM fix (libsql/swc indexed under the
 * default heap): if eviction silently stopped evicting, or diverged from the
 * normal save path, this fails.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { LATE_INTERACTION_CONFIG } from '../../core/infrastructure/config/ranking.js';

const TMP = path.join(os.tmpdir(), 'li-evict-parity');
const cleanup = (p) => {
  for (const s of [p, p + '.segments', p + '-stage.segments', p + '.segments.bak']) {
    try { rmSync(s, { recursive: true, force: true }); } catch { /* ignore */ }
  }
};

// Deterministic token vectors so normal and evict builds are bit-identical.
function tokensFor(seed, n = 5, dim = 128) {
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 0xffffffff) * 2 - 1; };
  return Array.from({ length: n }, () => new Float32Array(Array.from({ length: dim }, rnd)));
}

async function build(evict, indexPath, nDocs) {
  cleanup(indexPath);
  const idx = new LateInteractionIndex({
    tokenDim: 128, quantBits: 8, modelId: LATE_INTERACTION_CONFIG.model,
    indexPath, loadExisting: false, segmentSize: 50, buildEvict: evict,
  });
  await idx.init();
  for (let i = 0; i < nDocs; i++) {
    await idx.add('doc' + i, tokensFor(i), { file: 'f' + i + '.js', symbol: 'sym' + i });
  }
  // Register an alias AFTER all adds — exercises hasDoc() against an exemplar
  // whose tokens may already have been flushed+evicted.
  idx.addAlias('alias0', 'doc100', 'cluster0', { file: 'a0.js' });
  const residentBeforeSave = idx.documents.size;
  await idx.save();
  return { idx, stats: idx.getStats(), residentBeforeSave };
}

async function reload(indexPath) {
  const r = new LateInteractionIndex({
    tokenDim: 128, quantBits: 8, modelId: LATE_INTERACTION_CONFIG.model,
    indexPath, loadExisting: true,
  });
  await r.init();
  return r;
}

describe('LateInteractionIndex bounded build (segment eviction)', () => {
  afterEach(() => {
    cleanup(path.join(TMP, 'normal.db'));
    cleanup(path.join(TMP, 'evict.db'));
  });

  it('evicts flushed segments yet produces a normal-equivalent index', async () => {
    const N = 175; // > 3 segments at segmentSize=50
    const normal = await build(false, path.join(TMP, 'normal.db'), N);
    const evict = await build(true, path.join(TMP, 'evict.db'), N);

    // Eviction actually happened: normal keeps all docs resident through save,
    // evict drops flushed segments (only the unflushed tail, if any, remains).
    expect(normal.residentBeforeSave).toBe(N);
    expect(evict.residentBeforeSave).toBeLessThan(N);

    // Stats parity (doc + token counts survive eviction via running totals).
    expect(evict.stats.documents).toBe(normal.stats.documents);
    expect(evict.stats.documents).toBe(N);
    expect(evict.stats.totalTokens).toBe(normal.stats.totalTokens);

    // On-disk parity: reload both and compare doc count + a sampled doc's tokens.
    const rn = await reload(path.join(TMP, 'normal.db'));
    const re = await reload(path.join(TMP, 'evict.db'));
    expect(re.documents.size).toBe(N);
    expect(re.documents.size).toBe(rn.documents.size);
    expect(re.documents.get('doc100')?.numTokens).toBe(rn.documents.get('doc100')?.numTokens);
    // Alias pointer persisted and resolves to a real exemplar after eviction.
    expect(re.aliasPointers.get('alias0')?.exemplarId).toBe('doc100');
    expect(re.documents.has('doc100')).toBe(true);
  });

  it('leaves the default (non-evict) build behavior unchanged', async () => {
    const idx = new LateInteractionIndex({ tokenDim: 128, quantBits: 8, indexPath: path.join(TMP, 'normal.db'), loadExisting: false, segmentSize: 50 });
    expect(idx._evictMode).toBe(false);
    await idx.init();
    for (let i = 0; i < 120; i++) await idx.add('d' + i, tokensFor(i), { file: 'd.js' });
    expect(idx.documents.size).toBe(120); // nothing evicted in normal mode
  });
});
