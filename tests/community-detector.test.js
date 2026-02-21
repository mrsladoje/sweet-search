/**
 * Community Detector Tests
 *
 * Tests for leidenCommunities, fallbackDirectoryGrouping,
 * computeGraphHash, and detectCommunities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock DB reference that tests can override
let _mockDbInstance = null;

vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(function () {
      if (_mockDbInstance) return _mockDbInstance;
      return {
        prepare: () => ({ all: () => [], get: () => null, run: () => {} }),
        exec: () => {},
        close: () => {},
        pragma: () => {},
      };
    }),
  };
});

import {
  leidenCommunities,
  fallbackDirectoryGrouping,
  computeGraphHash,
  detectCommunities,
} from '../core/community-detector.js';
import Database from 'better-sqlite3';

beforeEach(() => {
  _mockDbInstance = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// leidenCommunities
// ---------------------------------------------------------------------------

describe('leidenCommunities', () => {
  it('returns empty assignment for empty graph', () => {
    const adjacency = new Map();
    const result = leidenCommunities(adjacency);
    expect(result.assignment.size).toBe(0);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
  });

  it('assigns single node to its own community', () => {
    const adjacency = new Map([[1, new Map()]]);
    const result = leidenCommunities(adjacency);
    expect(result.assignment.size).toBe(1);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
  });

  it('groups two connected nodes into a community', () => {
    const adjacency = new Map([
      [1, new Map([[2, 3]])],
      [2, new Map([[1, 3]])],
    ]);
    const result = leidenCommunities(adjacency);
    expect(result.assignment.size).toBe(2);
    const c1 = result.assignment.get(1);
    const c2 = result.assignment.get(2);
    expect(c1).toBe(c2);
  });

  it('separates three disconnected clusters', () => {
    const adjacency = new Map([
      [1, new Map([[2, 5]])],
      [2, new Map([[1, 5]])],
      [3, new Map([[4, 5]])],
      [4, new Map([[3, 5]])],
      [5, new Map([[6, 5]])],
      [6, new Map([[5, 5]])],
    ]);
    const result = leidenCommunities(adjacency);
    expect(result.assignment.size).toBe(6);

    expect(result.assignment.get(1)).toBe(result.assignment.get(2));
    expect(result.assignment.get(3)).toBe(result.assignment.get(4));
    expect(result.assignment.get(5)).toBe(result.assignment.get(6));

    const communities = new Set(result.assignment.values());
    expect(communities.size).toBeGreaterThanOrEqual(2);
  });

  it('handles timeout gracefully', () => {
    const adjacency = new Map([
      [1, new Map([[2, 1]])],
      [2, new Map([[1, 1]])],
    ]);
    const result = leidenCommunities(adjacency, { timeoutMs: 0 });
    expect(result.assignment).toBeInstanceOf(Map);
    expect(typeof result.iterations).toBe('number');
  });

  it('respects resolution parameter', () => {
    const adjacency = new Map([
      [1, new Map([[2, 2], [3, 1]])],
      [2, new Map([[1, 2], [3, 1]])],
      [3, new Map([[1, 1], [2, 1]])],
    ]);
    const lowRes = leidenCommunities(adjacency, { resolution: 0.1 });
    const highRes = leidenCommunities(adjacency, { resolution: 10.0 });

    expect(lowRes.assignment.size).toBe(3);
    expect(highRes.assignment.size).toBe(3);
  });

  it('handles no-edge graph (all nodes isolated)', () => {
    const adjacency = new Map([
      [1, new Map()],
      [2, new Map()],
      [3, new Map()],
    ]);
    const result = leidenCommunities(adjacency);
    expect(result.assignment.size).toBe(3);
    expect(result.converged).toBe(true);
    expect(result.iterations).toBe(0);
  });

  it('respects maxIterations', () => {
    const adjacency = new Map([
      [1, new Map([[2, 1]])],
      [2, new Map([[1, 1]])],
    ]);
    const result = leidenCommunities(adjacency, { maxIterations: 1 });
    expect(result.iterations).toBeLessThanOrEqual(1);
  });

  it('flattens transitive community assignments after aggregation', () => {
    // Build a graph with two dense clusters linked by a weak bridge.
    // This triggers multi-level aggregation where super-nodes from
    // iteration 1 get re-assigned in iteration 2, creating transitive
    // chains (node→c, c→cc) that must be flattened before returning.
    //
    // Cluster A: nodes 1-5 (dense, weight=10)
    // Cluster B: nodes 6-10 (dense, weight=10)
    // Bridge: 5↔6 (weight=1)
    const adjacency = new Map();
    for (let i = 1; i <= 10; i++) adjacency.set(i, new Map());
    // Cluster A
    for (let i = 1; i <= 5; i++) {
      for (let j = i + 1; j <= 5; j++) {
        adjacency.get(i).set(j, 10);
        adjacency.get(j).set(i, 10);
      }
    }
    // Cluster B
    for (let i = 6; i <= 10; i++) {
      for (let j = i + 1; j <= 10; j++) {
        adjacency.get(i).set(j, 10);
        adjacency.get(j).set(i, 10);
      }
    }
    // Weak bridge
    adjacency.get(5).set(6, 1);
    adjacency.get(6).set(5, 1);

    const result = leidenCommunities(adjacency, { maxIterations: 20 });
    const { assignment } = result;

    // The invariant: every node's community must be a terminal (fixed-point).
    // No node should point to a community ID that itself maps to a different ID.
    for (const [node, comm] of assignment) {
      if (assignment.has(comm)) {
        expect(assignment.get(comm)).toBe(comm);
      }
    }

    // All original nodes (1-10) should still be in the assignment
    for (let i = 1; i <= 10; i++) {
      expect(assignment.has(i)).toBe(true);
    }

    // Nodes in the same cluster should share a community
    const commA = assignment.get(1);
    for (let i = 2; i <= 5; i++) {
      expect(assignment.get(i)).toBe(commA);
    }
    const commB = assignment.get(6);
    for (let i = 7; i <= 10; i++) {
      expect(assignment.get(i)).toBe(commB);
    }
  });
});

// ---------------------------------------------------------------------------
// fallbackDirectoryGrouping
// ---------------------------------------------------------------------------

describe('fallbackDirectoryGrouping', () => {
  it('groups entities by top-2 directory segments', () => {
    const entities = [
      { id: 1, name: 'A', file_path: 'src/auth/login.js' },
      { id: 2, name: 'B', file_path: 'src/auth/logout.js' },
      { id: 3, name: 'C', file_path: 'lib/utils/helper.js' },
    ];
    const result = fallbackDirectoryGrouping(entities);
    expect(result.length).toBe(2);

    const srcAuth = result.find(c => c.entityIds.includes(1));
    expect(srcAuth.entityIds).toContain(2);
    expect(srcAuth.entityCount).toBe(2);

    const libUtils = result.find(c => c.entityIds.includes(3));
    expect(libUtils.entityCount).toBe(1);
  });

  it('returns empty array for empty input', () => {
    expect(fallbackDirectoryGrouping([]).length).toBe(0);
  });

  it('handles root-level files', () => {
    const entities = [{ id: 1, name: 'A', file_path: 'README.md' }];
    const result = fallbackDirectoryGrouping(entities);
    expect(result.length).toBe(1);
    expect(result[0].entityIds).toEqual([1]);
  });

  it('handles entities with empty file_path', () => {
    const entities = [{ id: 1, name: 'A', file_path: '' }];
    const result = fallbackDirectoryGrouping(entities);
    expect(result.length).toBe(1);
    expect(result[0].entityIds).toEqual([1]);
  });

  it('assigns sequential community IDs', () => {
    const entities = [
      { id: 1, name: 'A', file_path: 'a/b/c.js' },
      { id: 2, name: 'B', file_path: 'x/y/z.js' },
    ];
    const result = fallbackDirectoryGrouping(entities);
    const ids = result.map(c => c.id).sort();
    expect(ids).toEqual([0, 1]);
  });

  it('populates fileIds correctly', () => {
    const entities = [
      { id: 1, name: 'A', file_path: 'src/core/a.js' },
      { id: 2, name: 'B', file_path: 'src/core/b.js' },
    ];
    const result = fallbackDirectoryGrouping(entities);
    expect(result[0].fileIds.sort()).toEqual(['src/core/a.js', 'src/core/b.js']);
  });
});

// ---------------------------------------------------------------------------
// computeGraphHash
// ---------------------------------------------------------------------------

describe('computeGraphHash', () => {
  it('returns 64-char hex hash from DB rows', () => {
    const rows = [{ source_id: 1, target_id: 2, type: 'calls' }];
    _mockDbInstance = {
      prepare: () => ({ all: () => rows }),
      close: () => {},
    };

    const hash = computeGraphHash('/fake/path.db');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
  });

  it('produces deterministic hash for same input', () => {
    const rows = [
      { source_id: 1, target_id: 2, type: 'imports' },
      { source_id: 3, target_id: 4, type: 'calls' },
    ];
    _mockDbInstance = {
      prepare: () => ({ all: () => rows }),
      close: () => {},
    };

    const hash1 = computeGraphHash('/fake/path.db');
    const hash2 = computeGraphHash('/fake/path.db');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    _mockDbInstance = {
      prepare: () => ({ all: () => [{ source_id: 1, target_id: 2, type: 'calls' }] }),
      close: () => {},
    };
    const hash1 = computeGraphHash('/fake/path.db');

    _mockDbInstance = {
      prepare: () => ({ all: () => [{ source_id: 5, target_id: 6, type: 'imports' }] }),
      close: () => {},
    };
    const hash2 = computeGraphHash('/fake/path.db');

    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// detectCommunities
// ---------------------------------------------------------------------------

describe('detectCommunities', () => {
  it('returns empty result when DB cannot be opened', () => {
    _mockDbInstance = null;
    Database.mockImplementationOnce(function() { throw new Error('SQLITE_CANTOPEN'); });
    const result = detectCommunities('/nonexistent/path.db');
    expect(result.communities).toEqual([]);
    expect(result.graphHash).toBe('');
    expect(result.stale).toBe(false);
  });

  it('detects communities from entities and relationships', () => {
    const entities = [
      { id: 1, name: 'AuthService', type: 'class', file_path: 'src/auth.js' },
      { id: 2, name: 'LoginHandler', type: 'function', file_path: 'src/auth.js' },
      { id: 3, name: 'UserModel', type: 'class', file_path: 'src/user.js' },
    ];
    const relationships = [
      { source_id: 1, target_id: 2, type: 'calls' },
      { source_id: 2, target_id: 1, type: 'imports' },
    ];

    let callIdx = 0;
    _mockDbInstance = {
      prepare: () => {
        const idx = callIdx++;
        return { all: () => idx === 0 ? entities : relationships };
      },
      close: () => {},
    };

    const result = detectCommunities('/fake/code-graph.db');
    expect(result.communities.length).toBeGreaterThan(0);
    expect(typeof result.graphHash).toBe('string');
    expect(result.graphHash.length).toBe(64);
  });

  it('falls back to directory grouping when entities exceed cutoff', () => {
    const entities = Array.from({ length: 50001 }, (_, i) => ({
      id: i, name: `E${i}`, type: 'function', file_path: `src/dir${i % 10}/file.js`,
    }));
    const relationships = [];

    let callIdx = 0;
    _mockDbInstance = {
      prepare: () => {
        const idx = callIdx++;
        return { all: () => idx === 0 ? entities : relationships };
      },
      close: () => {},
    };

    const result = detectCommunities('/fake/code-graph.db');
    expect(result.communities.length).toBeGreaterThan(0);
    expect(result.stale).toBe(false);
  });

  it('handles empty entity set gracefully', () => {
    _mockDbInstance = {
      prepare: () => ({ all: () => [] }),
      close: () => {},
    };

    const result = detectCommunities('/fake/code-graph.db');
    expect(result.communities).toEqual([]);
    expect(result.graphHash.length).toBe(64);
  });

  it('returns valid result regardless of timeout', () => {
    const entities = Array.from({ length: 20 }, (_, i) => ({
      id: i, name: `E${i}`, type: 'function', file_path: `src/f${i}.js`,
    }));
    const relationships = [];
    for (let i = 0; i < 20; i++) {
      for (let j = i + 1; j < Math.min(i + 3, 20); j++) {
        relationships.push({ source_id: i, target_id: j, type: 'calls' });
      }
    }

    let callIdx = 0;
    _mockDbInstance = {
      prepare: () => {
        const idx = callIdx++;
        return { all: () => idx === 0 ? entities : relationships };
      },
      close: () => {},
    };

    const result = detectCommunities('/fake/code-graph.db', { timeoutMs: 0 });
    expect(typeof result.stale).toBe('boolean');
    expect(Array.isArray(result.communities)).toBe(true);
    expect(result.graphHash.length).toBe(64);
  });
});
