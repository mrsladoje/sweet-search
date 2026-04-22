import { describe, it, expect } from 'vitest';
import { expandAliases } from '../../core/search/dedup/sibling-expander.js';

function makeFakeRepo(rows) {
  return {
    findSiblingsByClusterIds(clusterIds, excludeIds = []) {
      const excl = new Set(excludeIds);
      return rows.filter((r) => {
        const meta = JSON.parse(r.metadata);
        return clusterIds.includes(meta.clusterId) && !excl.has(r.id);
      });
    },
  };
}

describe('expandAliases (promotion)', () => {
  it('promotes siblings into the flat ranked list after each exemplar', () => {
    const repo = makeFakeRepo([
      { id: 'alias-1', file_path: 'b.js', text: 'dup1', metadata: JSON.stringify({ clusterId: 'c1', exemplarId: 'ex-1', startLine: 1 }) },
      { id: 'alias-2', file_path: 'c.js', text: 'dup2', metadata: JSON.stringify({ clusterId: 'c1', exemplarId: 'ex-1', startLine: 1 }) },
      { id: 'alias-3', file_path: 'd.js', text: 'dup3', metadata: JSON.stringify({ clusterId: 'c2', exemplarId: 'ex-2', startLine: 2 }) },
    ]);
    const results = [
      { id: 'ex-1', score: 0.9, metadata: { clusterId: 'c1', exemplarId: null } },
      { id: 'ex-2', score: 0.8, metadata: { clusterId: 'c2', exemplarId: null } },
      { id: 'standalone', score: 0.7, metadata: { clusterId: null, exemplarId: null } },
    ];

    const { stats } = expandAliases(results, repo);

    expect(stats.exemplarsExpanded).toBe(2);
    expect(stats.aliasesPromoted).toBe(3);
    // Expected order: ex-1, alias-1, alias-2, ex-2, alias-3, standalone
    expect(results.map((r) => r.id)).toEqual(['ex-1', 'alias-1', 'alias-2', 'ex-2', 'alias-3', 'standalone']);
    // Promoted aliases inherit exemplar score + carry isAlias flag.
    expect(results[1].isAlias).toBe(true);
    expect(results[1].exemplarId).toBe('ex-1');
    expect(results[1].score).toBe(0.9);
    expect(results[4].score).toBe(0.8);
    // Exemplars still carry .aliases for UI formatter.
    expect(results[0].aliases).toHaveLength(2);
    expect(results[3].aliases).toHaveLength(1);
    // Standalone untouched.
    expect(results[5].isAlias).toBeUndefined();
  });

  it('handles stringified metadata on results', () => {
    const repo = makeFakeRepo([
      { id: 'alias-1', file_path: 'b.js', text: 'dup', metadata: JSON.stringify({ clusterId: 'c1', exemplarId: 'ex-1' }) },
    ]);
    const results = [
      { id: 'ex-1', score: 0.9, metadata: JSON.stringify({ clusterId: 'c1', exemplarId: null }) },
    ];
    expandAliases(results, repo);
    expect(results).toHaveLength(2);
    expect(results[1].id).toBe('alias-1');
    expect(results[1].isAlias).toBe(true);
  });

  it('no-op when results have no dedup metadata', () => {
    const repo = makeFakeRepo([]);
    const results = [{ id: 'x', score: 0.9, metadata: { type: 'function' } }];
    const { stats } = expandAliases(results, repo);
    expect(stats.exemplarsExpanded).toBe(0);
    expect(stats.aliasesPromoted).toBe(0);
    expect(results).toHaveLength(1);
  });

  it('no-op on empty results or missing repo', () => {
    expect(expandAliases([], null).stats.exemplarsExpanded).toBe(0);
    expect(expandAliases(null, {}).stats.exemplarsExpanded).toBe(0);
  });

  it('excludes exemplar ids from sibling lookup', () => {
    const repo = {
      findSiblingsByClusterIds(clusterIds, excludeIds = []) {
        expect(clusterIds).toEqual(['c1']);
        expect(excludeIds).toEqual(['ex-1']);
        return [];
      },
    };
    const results = [{ id: 'ex-1', score: 0.9, metadata: { clusterId: 'c1' } }];
    expandAliases(results, repo);
  });

  it('does not duplicate an alias already present in results', () => {
    const repo = makeFakeRepo([
      { id: 'alias-1', file_path: 'b.js', text: 'dup', metadata: JSON.stringify({ clusterId: 'c1', exemplarId: 'ex-1' }) },
    ]);
    const results = [
      { id: 'ex-1', score: 0.9, metadata: { clusterId: 'c1', exemplarId: null } },
      { id: 'alias-1', score: 0.5, metadata: { clusterId: 'c1', exemplarId: 'ex-1' } }, // already present somehow
    ];
    expandAliases(results, repo);
    // alias-1 appears exactly once.
    const ids = results.map((r) => r.id);
    expect(ids.filter((x) => x === 'alias-1')).toHaveLength(1);
  });
});
