// ss-find crashed on any index whose late-interaction documents carry no line spans:
//
//   "Pattern search requires a late interaction index with line spans.
//    Re-index with late interaction enabled."
//
// A crash is the one answer the agent cannot act on. The index it was handed is the only
// index it has; it cannot re-index the repository mid-task. It fired on mathnet in the
// fresh pool. The codebase vector rows carry the same spans under the same chunk ids, so
// the map is rebuilt from them; if even that is empty the matches route to the unindexed
// path and the agent still gets its grep results, unranked.
import { describe, it, expect } from 'vitest';
import {
  buildChunkLocationMap, buildCodebaseChunkLocationMap, getChunkLocationMap,
  findChunkIntervalForLine,
} from '../../core/search/search-pattern-chunks.js';

/** A late-interaction index whose documents carry metadata WITHOUT startLine/endLine. */
function liIndexWithoutSpans() {
  return {
    documents: new Map([
      ['src/a.js:1-20:0', { metadata: { file: 'src/a.js', type: 'function', name: 'alpha' } }],
      ['src/a.js:21-40:1', { metadata: { file: 'src/a.js', type: 'function', name: 'beta' } }],
    ]),
    aliasPointers: new Map(),
  };
}

/** The same chunks as codebase vector rows, which DO carry the spans. */
function codebaseRepoWithSpans() {
  const rows = [
    { id: 'src/a.js:21-40:1', file_path: 'src/a.js', metadata: JSON.stringify({ startLine: 21, endLine: 40, type: 'function', name: 'beta' }) },
    { id: 'src/a.js:1-20:0', file_path: 'src/a.js', metadata: JSON.stringify({ startLine: 1, endLine: 20, type: 'function', name: 'alpha' }) },
    { id: 'src/b.js:1-5:0', file_path: 'src/b.js', metadata: JSON.stringify({ startLine: 1, endLine: 5 }) },
    { id: 'bad', file_path: 'src/c.js', metadata: '{not json' },                       // ignored
    { id: 'nospan', file_path: 'src/c.js', metadata: JSON.stringify({ type: 'x' }) },  // ignored
  ];
  return { *iterateVectors() { yield* rows; } };
}

describe('chunk line spans without a late-interaction span table', () => {
  it('the LI-derived map is empty when the documents carry no spans (the defect)', () => {
    expect(buildChunkLocationMap(liIndexWithoutSpans()).size).toBe(0);
  });

  it('rebuilds the same map from the codebase vector rows', () => {
    const map = buildCodebaseChunkLocationMap({ codebaseRepo: codebaseRepoWithSpans() });
    expect(map.size).toBe(2);
    const bucket = map.get('src/a.js');
    // Sorted by startLine, with the running max the binary search relies on.
    expect(bucket.map(b => b.startLine)).toEqual([1, 21]);
    expect(bucket.map(b => b._maxEndSoFar)).toEqual([20, 40]);
    // The ids are the CHUNK ids, not file paths — that is what lets the MaxSim rerank
    // still resolve them in the late-interaction index.
    expect(bucket.map(b => b.id)).toEqual(['src/a.js:1-20:0', 'src/a.js:21-40:1']);
    // Rows with unparseable or span-less metadata are skipped, not fatal.
    expect(map.has('src/c.js')).toBe(false);
  });

  it('the rebuilt map answers findChunkIntervalForLine identically', () => {
    const map = buildCodebaseChunkLocationMap({ codebaseRepo: codebaseRepoWithSpans() });
    const hit = findChunkIntervalForLine(map.get('src/a.js'), 25);
    expect(hit.interval.id).toBe('src/a.js:21-40:1');
    expect(findChunkIntervalForLine(map.get('src/a.js'), 999)).toBeNull();
  });

  it('getChunkLocationMap falls back automatically and caches the result', () => {
    const searcher = {
      lateInteractionIndex: liIndexWithoutSpans(),
      codebaseRepo: codebaseRepoWithSpans(),
    };
    const map = getChunkLocationMap.call(searcher);
    expect(map.size).toBe(2);
    // Cached: a second call returns the same object, not a second full table scan.
    expect(getChunkLocationMap.call(searcher)).toBe(map);
  });

  it('returns an EMPTY map rather than throwing when neither source has spans', () => {
    // Degraded, not broken: every match routes to the unindexed path and the agent still
    // gets its grep results. That is strictly better than the crash it replaces.
    const searcher = { lateInteractionIndex: liIndexWithoutSpans(), codebaseRepo: null };
    expect(() => getChunkLocationMap.call(searcher)).not.toThrow();
    expect(getChunkLocationMap.call(searcher).size).toBe(0);

    const broken = {
      lateInteractionIndex: liIndexWithoutSpans(),
      codebaseRepo: { *iterateVectors() { throw new Error('database is locked'); } },
    };
    expect(() => getChunkLocationMap.call(broken)).not.toThrow();
    expect(getChunkLocationMap.call(broken).size).toBe(0);
  });

  it('does not disturb an index that DOES carry line spans', () => {
    const li = {
      documents: new Map([['src/a.js:1-20:0', { metadata: { file: 'src/a.js', startLine: 1, endLine: 20 } }]]),
      aliasPointers: new Map(),
    };
    const searcher = {
      lateInteractionIndex: li,
      // A codebase repo that would throw if it were ever consulted.
      codebaseRepo: { *iterateVectors() { throw new Error('must not be reached'); } },
    };
    const map = getChunkLocationMap.call(searcher);
    expect(map.size).toBe(1);
    expect(map.get('src/a.js')[0].id).toBe('src/a.js:1-20:0');
  });
});
