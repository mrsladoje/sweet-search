import { describe, it, expect } from 'vitest';
import { forwardPush, loadDirectionalSubgraph, personalizedPageRank } from '../../core/graph/structural-forward-push.js';

describe('forwardPush', () => {
  it('returns higher PPR for closer nodes', () => {
    // s -> a -> b -> c: a should have more mass than b, b more than c.
    const subgraph = new Map([
      ['s', new Map([['a', 1]])],
      ['a', new Map([['b', 1]])],
      ['b', new Map([['c', 1]])],
    ]);
    const scores = forwardPush({ sourceId: 's', subgraph, alpha: 0.15, epsilon: 1e-5 });
    expect(scores.get('a')).toBeGreaterThan(scores.get('b'));
    expect(scores.get('b')).toBeGreaterThan(scores.get('c'));
    expect(scores.has('s')).toBe(false);
  });

  it('weights heavier edges more', () => {
    // s connects to a (weight 1) and b (weight 10).
    const subgraph = new Map([
      ['s', new Map([['a', 1], ['b', 10]])],
    ]);
    const scores = forwardPush({ sourceId: 's', subgraph, alpha: 0.15, epsilon: 1e-5 });
    expect(scores.get('b')).toBeGreaterThan(scores.get('a'));
  });

  it('returns an empty map when source has no outgoing edges', () => {
    const subgraph = new Map([['s', new Map()]]);
    const scores = forwardPush({ sourceId: 's', subgraph, alpha: 0.15, epsilon: 1e-5 });
    expect(scores.size).toBe(0);
  });

  it('handles degenerate input safely', () => {
    expect(forwardPush({ sourceId: null, subgraph: new Map() }).size).toBe(0);
    expect(forwardPush({ sourceId: 's', subgraph: null }).size).toBe(0);
  });
});

describe('loadDirectionalSubgraph', () => {
  it('BFS-loads multi-hop edges with deduplication', () => {
    const fakeEdges = {
      ['s']: [{ from: 's', to: 'a', weight: 1 }, { from: 's', to: 'b', weight: 1 }],
      ['a']: [{ from: 'a', to: 'c', weight: 2 }],
      ['b']: [{ from: 'b', to: 'c', weight: 1 }],
      ['c']: [],
    };
    const calls = [];
    const loadFrontier = (ids) => {
      calls.push([...ids]);
      return ids.flatMap(id => fakeEdges[id] || []);
    };
    const { subgraph, nodeCount, hops } = loadDirectionalSubgraph({
      sourceId: 's', loadFrontier, maxHops: 4,
    });
    expect(nodeCount).toBe(4);
    expect(hops).toBe(3);
    // c should accumulate weight from both incoming edges (a and b).
    const cFromA = subgraph.get('a').get('c');
    const cFromB = subgraph.get('b').get('c');
    expect(cFromA).toBe(2);
    expect(cFromB).toBe(1);
    // No duplicate frontier calls for the same node.
    const flat = calls.flat();
    const counts = {};
    for (const id of flat) counts[id] = (counts[id] || 0) + 1;
    expect(Object.values(counts).every(c => c === 1)).toBe(true);
  });

  it('honours maxNodes', () => {
    const loadFrontier = (ids) => ids.flatMap((id, i) => [
      { from: id, to: `${id}-x${i}`, weight: 1 },
      { from: id, to: `${id}-y${i}`, weight: 1 },
    ]);
    const { nodeCount } = loadDirectionalSubgraph({
      sourceId: 's', loadFrontier, maxHops: 10, maxNodes: 5,
    });
    expect(nodeCount).toBeLessThanOrEqual(5);
  });
});

describe('personalizedPageRank wrapper', () => {
  it('combines subgraph loading with forward push', () => {
    const fakeEdges = {
      ['s']: [{ from: 's', to: 'a', weight: 1 }],
      ['a']: [{ from: 'a', to: 'b', weight: 1 }],
    };
    const loadFrontier = (ids) => ids.flatMap(id => fakeEdges[id] || []);
    const { scores, nodeCount } = personalizedPageRank({ sourceId: 's', loadFrontier });
    expect(nodeCount).toBe(3);
    expect(scores.get('a')).toBeGreaterThan(scores.get('b') || 0);
  });
});
