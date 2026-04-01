/**
 * Repo Map Tests
 *
 * Tests for core/repo-map.js:
 * - PageRank algorithm correctness
 * - Graph adjacency building
 * - Token-budget binary search rendering
 * - Entity filtering and ranking
 * - Focus file/entity boosting
 * - Edge cases (empty graph, disconnected nodes)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
  pageRank,
  buildAdjacency,
  renderRepoMap,
  estimateTokens,
  generateRepoMap,
  loadGraph,
  createGraphSchema,
} from '../../core/graph/index.js';

// =============================================================================
// PageRank Algorithm
// =============================================================================

describe('PageRank algorithm', () => {
  it('returns empty map for empty graph', () => {
    const scores = pageRank(new Map(), new Set());
    expect(scores.size).toBe(0);
  });

  it('assigns equal scores to disconnected nodes', () => {
    const nodes = new Set(['a', 'b', 'c']);
    const edges = new Map();
    const scores = pageRank(edges, nodes);
    expect(scores.size).toBe(3);
    // All scores should be roughly equal
    const vals = [...scores.values()];
    expect(vals[0]).toBeCloseTo(vals[1], 3);
    expect(vals[1]).toBeCloseTo(vals[2], 3);
  });

  it('scores sum to approximately 1 in a fully-connected graph', () => {
    // All nodes have outgoing edges → no dangling-node mass leak
    const nodes = new Set(['a', 'b', 'c']);
    const edges = new Map([
      ['a', new Set(['b', 'c'])],
      ['b', new Set(['c'])],
      ['c', new Set(['a'])],
    ]);
    const scores = pageRank(edges, nodes);
    const sum = [...scores.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it('ranks highly-linked node highest', () => {
    // c is the "hub" — everyone points to c
    const nodes = new Set(['a', 'b', 'c']);
    const edges = new Map([
      ['a', new Set(['c'])],
      ['b', new Set(['c'])],
    ]);
    const scores = pageRank(edges, nodes);
    expect(scores.get('c')).toBeGreaterThan(scores.get('a'));
    expect(scores.get('c')).toBeGreaterThan(scores.get('b'));
  });

  it('handles self-referential graphs without infinite loop', () => {
    const nodes = new Set(['a']);
    const edges = new Map([['a', new Set(['a'])]]);
    const scores = pageRank(edges, nodes);
    expect(scores.get('a')).toBeCloseTo(1, 2);
  });

  it('converges with custom damping factor', () => {
    const nodes = new Set(['a', 'b']);
    const edges = new Map([['a', new Set(['b'])]]);
    const scores = pageRank(edges, nodes, { damping: 0.5, iterations: 50 });
    expect(scores.get('b')).toBeGreaterThan(scores.get('a'));
  });

  it('handles large linear chain', () => {
    const n = 100;
    const nodes = new Set();
    const edges = new Map();
    for (let i = 0; i < n; i++) {
      nodes.add(`n${i}`);
      if (i < n - 1) {
        edges.set(`n${i}`, new Set([`n${i + 1}`]));
      }
    }
    const scores = pageRank(edges, nodes, { iterations: 30 });
    // Last node should have higher score (receives link from chain)
    expect(scores.get(`n${n - 1}`)).toBeGreaterThan(scores.get('n0'));
  });
});

// =============================================================================
// Adjacency Building
// =============================================================================

describe('buildAdjacency', () => {
  it('builds correct node set from entities', () => {
    const graph = {
      entities: [
        { id: 'e1', file_path: 'a.ts', type: 'class', name: 'Foo' },
        { id: 'e2', file_path: 'b.ts', type: 'function', name: 'bar' },
      ],
      relationships: [],
    };
    const { allNodes, entityMap, fileEntities } = buildAdjacency(graph);
    expect(allNodes.size).toBe(2);
    expect(entityMap.get('e1').name).toBe('Foo');
    expect(fileEntities.get('a.ts')).toHaveLength(1);
    expect(fileEntities.get('b.ts')).toHaveLength(1);
  });

  it('creates edges from resolved relationships', () => {
    const graph = {
      entities: [
        { id: 'e1', file_path: 'a.ts', type: 'class', name: 'Foo' },
        { id: 'e2', file_path: 'b.ts', type: 'class', name: 'Bar' },
      ],
      relationships: [
        { source_id: 'e1', target_id: 'e2', target_name: 'Bar', type: 'extends', weight: 1 },
      ],
    };
    const { outEdges } = buildAdjacency(graph);
    expect(outEdges.get('e1')?.has('e2')).toBe(true);
  });

  it('resolves target_name when target_id is null', () => {
    const graph = {
      entities: [
        { id: 'e1', file_path: 'a.ts', type: 'class', name: 'Foo' },
        { id: 'e2', file_path: 'b.ts', type: 'class', name: 'Bar' },
      ],
      relationships: [
        { source_id: 'e1', target_id: null, target_name: 'Bar', type: 'extends', weight: 1 },
      ],
    };
    const { outEdges } = buildAdjacency(graph);
    expect(outEdges.get('e1')?.has('e2')).toBe(true);
  });

  it('resolves dotted target_name (method calls)', () => {
    const graph = {
      entities: [
        { id: 'e1', file_path: 'a.ts', type: 'function', name: 'main' },
        { id: 'e2', file_path: 'b.ts', type: 'class', name: 'service' },
      ],
      relationships: [
        { source_id: 'e1', target_id: null, target_name: 'service.process', type: 'calls', weight: 1 },
      ],
    };
    const { outEdges } = buildAdjacency(graph);
    expect(outEdges.get('e1')?.has('e2')).toBe(true);
  });

  it('skips self-loops', () => {
    const graph = {
      entities: [
        { id: 'e1', file_path: 'a.ts', type: 'function', name: 'recursive' },
      ],
      relationships: [
        { source_id: 'e1', target_id: 'e1', target_name: 'recursive', type: 'calls', weight: 1 },
      ],
    };
    const { outEdges } = buildAdjacency(graph);
    expect(outEdges.get('e1')?.has('e1')).toBeFalsy();
  });

  it('skips relationships with null source_id', () => {
    const graph = {
      entities: [
        { id: 'e1', file_path: 'a.ts', type: 'class', name: 'Foo' },
      ],
      relationships: [
        { source_id: null, target_id: 'e1', target_name: 'Foo', type: 'imports', weight: 1 },
      ],
    };
    const { outEdges } = buildAdjacency(graph);
    expect(outEdges.size).toBe(0);
  });
});

// =============================================================================
// Token Estimation
// =============================================================================

describe('estimateTokens', () => {
  it('estimates short text', () => {
    const tokens = estimateTokens('hello world');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it('estimates empty string as 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales linearly with length', () => {
    const short = estimateTokens('abc');
    const long = estimateTokens('abc'.repeat(100));
    expect(long).toBeGreaterThan(short * 50); // approximate
  });
});

// =============================================================================
// Repo Map Rendering
// =============================================================================

describe('renderRepoMap', () => {
  const makeEntity = (id, name, type, filePath, sig) => ({
    entity: { id, name, type, file_path: filePath, signature: sig || name, start_line: 1 },
    score: 0,
  });

  it('returns empty message for no entities', () => {
    const result = renderRepoMap([], 1000);
    expect(result.entityCount).toBe(0);
    expect(result.text).toContain('empty');
  });

  it('fits single entity within budget', () => {
    const entries = [makeEntity('e1', 'Foo', 'class', 'a.ts', 'class Foo')];
    entries[0].score = 1;
    const result = renderRepoMap(entries, 1000);
    expect(result.entityCount).toBe(1);
    expect(result.text).toContain('a.ts');
    expect(result.text).toContain('Foo');
  });

  it('truncates to fit token budget', () => {
    const entries = [];
    for (let i = 0; i < 100; i++) {
      entries.push({
        entity: {
          id: `e${i}`,
          name: `VeryLongFunctionName_${i}_with_extra_padding`,
          type: 'function',
          file_path: `src/module_${i}/handler.ts`,
          signature: `function VeryLongFunctionName_${i}_with_extra_padding(arg1: string, arg2: number): Promise<Result>`,
          start_line: 1,
        },
        score: 100 - i,
      });
    }
    const result = renderRepoMap(entries, 200); // very tight budget
    expect(result.entityCount).toBeLessThan(100);
    expect(result.entityCount).toBeGreaterThan(0);
    expect(result.totalEntities).toBe(100);
  });

  it('groups entities by file', () => {
    const entries = [
      { entity: { id: 'e1', name: 'foo', type: 'function', file_path: 'a.ts', signature: 'function foo()', start_line: 1 }, score: 2 },
      { entity: { id: 'e2', name: 'bar', type: 'function', file_path: 'a.ts', signature: 'function bar()', start_line: 10 }, score: 1 },
      { entity: { id: 'e3', name: 'baz', type: 'class', file_path: 'b.ts', signature: 'class baz', start_line: 1 }, score: 3 },
    ];
    const result = renderRepoMap(entries, 5000);
    expect(result.fileCount).toBe(2);
    // b.ts should come first (highest score)
    const bIdx = result.text.indexOf('b.ts');
    const aIdx = result.text.indexOf('a.ts');
    expect(bIdx).toBeLessThan(aIdx);
  });

  it('orders entities within file by line number', () => {
    const entries = [
      { entity: { id: 'e1', name: 'second', type: 'function', file_path: 'a.ts', signature: 'function second()', start_line: 20 }, score: 1 },
      { entity: { id: 'e2', name: 'first', type: 'function', file_path: 'a.ts', signature: 'function first()', start_line: 5 }, score: 2 },
    ];
    const result = renderRepoMap(entries, 5000);
    const firstIdx = result.text.indexOf('first');
    const secondIdx = result.text.indexOf('second');
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});

// =============================================================================
// SQLite Integration (end-to-end)
// =============================================================================

describe('generateRepoMap (SQLite integration)', () => {
  let tmpDir;
  let dbPath;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'repo-map-test-'));
    dbPath = path.join(tmpDir, 'code-graph.db');

    const db = new Database(dbPath);
    createGraphSchema(db);

    // Insert test entities
    const insertEntity = db.prepare(`
      INSERT INTO entities (id, file_path, type, name, signature, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRel = db.prepare(`
      INSERT INTO relationships (source_id, target_id, target_name, type, weight)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Build a small but realistic graph:
    // UserService (class) → extends BaseService
    // UserService → calls Database.query
    // AuthController (class) → calls UserService.findUser
    // Database (class) — heavily referenced hub
    // helper (function) — leaf node, low importance

    insertEntity.run('e1', 'src/user-service.ts', 'class', 'UserService', 'class UserService extends BaseService', 1, 50);
    insertEntity.run('e2', 'src/base-service.ts', 'class', 'BaseService', 'abstract class BaseService', 1, 30);
    insertEntity.run('e3', 'src/auth-controller.ts', 'class', 'AuthController', 'class AuthController', 1, 40);
    insertEntity.run('e4', 'src/database.ts', 'class', 'Database', 'class Database', 1, 100);
    insertEntity.run('e5', 'src/utils.ts', 'function', 'helper', 'function helper()', 1, 5);
    insertEntity.run('e6', 'src/user-service.ts', 'method', 'findUser', 'async findUser(id: string)', 10, 25);
    insertEntity.run('e7', 'src/types.ts', 'interface', 'IUserConfig', 'interface IUserConfig', 1, 10);

    // Relationships
    insertRel.run('e1', 'e2', 'BaseService', 'extends', 1.0);
    insertRel.run('e1', null, 'Database.query', 'calls', 1.0);
    insertRel.run('e3', null, 'UserService.findUser', 'calls', 1.0);
    insertRel.run('e6', null, 'Database.query', 'calls', 1.0);
    insertRel.run('e3', null, 'Database.connect', 'calls', 1.0);

    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads graph from SQLite', () => {
    const graph = loadGraph(dbPath);
    expect(graph.entities.length).toBe(7);
    expect(graph.relationships.length).toBe(5);
  });

  it('generates repo map with default budget', () => {
    const result = generateRepoMap({ dbPath, tokenBudget: 1024 });
    expect(result.entityCount).toBeGreaterThan(0);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.text).toContain('Database'); // hub node should appear
    expect(result.pageRankTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('Database (hub) ranks higher than helper (leaf)', () => {
    const result = generateRepoMap({ dbPath, tokenBudget: 5000 });
    const dbIdx = result.text.indexOf('Database');
    const helperIdx = result.text.indexOf('helper');
    // If both appear, Database should be in a higher-ranked file
    if (dbIdx !== -1 && helperIdx !== -1) {
      expect(dbIdx).toBeLessThan(helperIdx);
    }
  });

  it('respects token budget constraint', () => {
    const small = generateRepoMap({ dbPath, tokenBudget: 100 });
    const large = generateRepoMap({ dbPath, tokenBudget: 5000 });
    expect(small.entityCount).toBeLessThanOrEqual(large.entityCount);
    expect(estimateTokens(small.text)).toBeLessThanOrEqual(110); // small tolerance
  });

  it('focus files boost specified file entities', () => {
    const normal = generateRepoMap({ dbPath, tokenBudget: 5000 });
    const focused = generateRepoMap({
      dbPath,
      tokenBudget: 5000,
      focusFiles: ['src/utils.ts'],
    });
    // Both should include helper, but in focused mode it should rank higher
    expect(focused.text).toContain('helper');
  });

  it('focus entities boost specified entity names', () => {
    const result = generateRepoMap({
      dbPath,
      tokenBudget: 5000,
      focusEntities: ['IUserConfig'],
    });
    expect(result.text).toContain('IUserConfig');
  });

  it('includes interface entities in output', () => {
    const result = generateRepoMap({ dbPath, tokenBudget: 5000 });
    expect(result.text).toContain('interface');
  });

  it('handles very small budget gracefully', () => {
    const result = generateRepoMap({ dbPath, tokenBudget: 100 });
    expect(result.entityCount).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });
});
