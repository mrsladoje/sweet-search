/**
 * Trace-only relationship types (core/graph/relationship-types.js) must not
 * change search ranking: structural PageRank, graph expansion, community
 * detection and the context-expander neighbour list all skip them, while
 * ss-trace still reads them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSchema } from '../../core/graph/graph-extractor.js';
import { buildWeightedAdjacency, pageRankWeighted } from '../../core/graph/structural-pagerank.js';
import { expandOneHop, getExpansionStats, GRAPH_EXPANSION_TRACE_ONLY_TYPES_SQL } from '../../core/graph/graph-expansion.js';
import { computeGraphHash } from '../../core/graph/community-detector.js';
import {
  SITE_LINE_RELATIONSHIP_TYPES, TRACE_ONLY_RELATIONSHIP_TYPES, TRACE_ONLY_TYPES_SQL, rankingRelationshipTypes, isTraceOnlyRelationship,
} from '../../core/graph/relationship-types.js';

const tmpFiles = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeDb(file, { withTraceOnly }) {
  const db = new Database(file);
  createGraphSchema(db);
  const ent = db.prepare('INSERT INTO entities (id, file_path, type, name, start_line, end_line) VALUES (?, ?, ?, ?, 1, 10)');
  for (const [id, type] of [['a', 'class'], ['b', 'class'], ['m1', 'method'], ['m2', 'method'], ['f', 'function']]) {
    ent.run(id, `src/${id}.kt`, type, id);
  }
  const rel = db.prepare('INSERT INTO relationships (source_id, target_id, target_name, type, weight, context_line) VALUES (?, ?, ?, ?, 1.0, 1)');
  rel.run('f', 'm1', 'm1', 'calls');
  rel.run('a', 'b', 'b', 'extends');
  if (withTraceOnly) {
    rel.run('m1', 'm2', 'b.m2', 'overrides');
    rel.run('f', 'a', 'a', 'instantiates');
    rel.run('f', 'b', 'b', 'typeRef');
    rel.run('f', 'b', 'b', 'extensionOf');
    // Every site line of the type usages (and calls) lives in the trace-only
    // site-line table; ranking must not see those rows either.
    const line = db.prepare('INSERT INTO call_lines (source_id, target_name, context_line, rel_type) VALUES (?, ?, ?, ?)');
    for (const l of [2, 3, 4]) line.run('f', 'a', l, 'instantiates');
    for (const l of [5, 6]) line.run('f', 'm1', l, 'calls');
  }
  return db;
}

describe('trace-only relationship types', () => {
  it('one list, and graph-expansion mirrors it exactly', () => {
    expect(TRACE_ONLY_RELATIONSHIP_TYPES).toEqual(['overrides', 'instantiates', 'typeRef', 'extensionOf']);
    expect(GRAPH_EXPANSION_TRACE_ONLY_TYPES_SQL).toBe(TRACE_ONLY_TYPES_SQL);
    expect(rankingRelationshipTypes(['calls', 'overrides', 'uses'])).toEqual(['calls', 'uses']);
    expect(isTraceOnlyRelationship('instantiates')).toBe(true);
    expect(isTraceOnlyRelationship('calls')).toBe(false);
    // Site lines are kept for calls and the per-line trace-only types;
    // overrides is derived per method pair (one line by nature).
    expect([...SITE_LINE_RELATIONSHIP_TYPES].sort()).toEqual(['calls', 'extensionOf', 'instantiates', 'typeRef']);
  });

  it('PageRank, expansion and the community hash are identical with and without them', () => {
    const results = {};
    for (const withTraceOnly of [false, true]) {
      const file = path.join(os.tmpdir(), `trace-only-${process.pid}-${withTraceOnly}.db`);
      fs.rmSync(file, { force: true });
      tmpFiles.push(file);
      const db = makeDb(file, { withTraceOnly });
      const { outEdges, allNodes } = buildWeightedAdjacency(db);
      const pr = pageRankWeighted(outEdges, allNodes);
      const hop = expandOneHop(db, new Set(['f', 'm1']), new Set(['calls', 'extends', 'uses', 'overrides', 'instantiates', 'typeRef']));
      const stats = getExpansionStats(db, ['f', 'm1', 'a']);
      db.close();
      results[withTraceOnly] = {
        pr: [...pr.entries()].sort(),
        hop: [...hop.keys()].sort(),
        stats,
        hash: computeGraphHash(file),
      };
    }
    expect(results[true]).toEqual(results[false]);
  });
});
