import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { evaluateWatermarks, DEFAULT_WATERMARKS } from '../../core/incremental-indexing/domain/watermark-scheduler.mjs';
import { readGraphRankState, PAGERANK_STATE } from '../../core/incremental-indexing/infrastructure/maintenance-state-reader.mjs';
import { graphPageRankHandler } from '../../core/incremental-indexing/application/maintenance-handlers.mjs';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';

// The maintainer wrote entities with page_rank 0 and never recomputed it: on a large maintained
// index 5,516 of 18,816 live entities (29 %) had no score, and trace ranks callers by it.
describe('graph_pagerank watermark', () => {
  const rank = (graphEpoch, rankedEpoch, msSinceRun) => ({ graphRank: { graphEpoch, rankedEpoch, msSinceRun } });

  it('fires once the graph changed since the last pass and the interval passed', () => {
    expect(evaluateWatermarks(rank(5, 0, Infinity))).toEqual([
      { tier: 'graph_pagerank', reason: 'graph_changed', payload: { graphEpoch: 5, rankedEpoch: 0 } },
    ]);
    expect(evaluateWatermarks(rank(5, 4, DEFAULT_WATERMARKS.pageRankIntervalMs))).toHaveLength(1);
  });

  it('waits out the interval, and does nothing when the graph did not change', () => {
    expect(evaluateWatermarks(rank(5, 4, DEFAULT_WATERMARKS.pageRankIntervalMs - 1))).toEqual([]);
    expect(evaluateWatermarks(rank(5, 5, Infinity))).toEqual([]);
    expect(evaluateWatermarks(rank(0, 0, Infinity))).toEqual([]); // a full build ranked it
  });
});

describe('graph_pagerank job', () => {
  let stateDir;
  beforeEach(() => { stateDir = mkdtempSync(join(tmpdir(), 'ss-pagerank-')); });
  afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

  function graph(rows, edges) {
    const db = new Database(join(stateDir, 'code-graph.db'));
    db.exec(`CREATE TABLE entities (id TEXT PRIMARY KEY, stale_since INTEGER, epoch_retired INTEGER, page_rank REAL DEFAULT 0, epoch_written INTEGER DEFAULT 0);
             CREATE TABLE relationships (source_id TEXT, target_id TEXT, type TEXT, weight REAL, epoch_retired INTEGER, epoch_written INTEGER DEFAULT 0);`);
    for (const [id, retired, pr] of rows) db.prepare('INSERT INTO entities (id, stale_since, epoch_retired, page_rank) VALUES (?, ?, ?, ?)').run(id, retired, retired, pr);
    for (const [s, t, retired] of edges) db.prepare("INSERT INTO relationships (source_id, target_id, type, weight, epoch_retired) VALUES (?, ?, 'calls', 1, ?)").run(s, t, retired);
    return db;
  }
  const ranks = () => {
    const db = new Database(join(stateDir, 'code-graph.db'), { readonly: true });
    try { return Object.fromEntries(db.prepare('SELECT id, page_rank FROM entities').all().map((r) => [r.id, r.page_rank])); } finally { db.close(); }
  };

  it('scores the live graph, ignores retired rows, and records its run', () => {
    // a -> b is live; a -> c was retired, and so was entity old.
    graph([['a', null, 0], ['b', null, 0], ['c', null, 0], ['old', 5, 0]], [['a', 'b', null], ['a', 'c', 7], ['old', 'b', 5]]).close();
    expect(readGraphRankState(stateDir)).toMatchObject({ graphEpoch: 7, rankedEpoch: 0, msSinceRun: Infinity });

    graphPageRankHandler({}, { stateDir });

    const pr = ranks();
    expect(pr.a).toBeGreaterThan(0);
    expect(pr.c).toBeGreaterThan(0);
    expect(pr.b).toBeGreaterThan(pr.c); // only the live edge feeds b; the retired one adds nothing to c
    expect(existsSync(join(stateDir, PAGERANK_STATE))).toBe(true);
    const state = readGraphRankState(stateDir);
    expect(state).toMatchObject({ graphEpoch: 7, rankedEpoch: 7 });
    expect(state.msSinceRun).toBeLessThan(DEFAULT_WATERMARKS.pageRankIntervalMs);
  });
});

describe('re-written entity keeps its PageRank', () => {
  let projectRoot;
  let stateDir;
  const rel = 'src/sample.js';
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-pagerank-keep-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
  const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
  const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);
  async function tick() {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: rel })}\n`);
    return runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }
  const liveRank = () => {
    const db = new Database(join(stateDir, 'code-graph.db'), { readonly: true });
    try { return db.prepare("SELECT id, page_rank FROM entities WHERE name = 'alphaThing' AND epoch_retired IS NULL").get(); } finally { db.close(); }
  };

  it('copies the old row\'s score to the new row of an edited definition', async () => {
    writeFileSync(join(projectRoot, rel), 'export function alphaThing(input) {\n  return input.trim();\n}\n');
    await tick();
    const first = liveRank();
    const db = new Database(join(stateDir, 'code-graph.db'));
    db.prepare('UPDATE entities SET page_rank = 0.25 WHERE id = ?').run(first.id);
    db.close();

    writeFileSync(join(projectRoot, rel), '// moved down one line\nexport function alphaThing(input) {\n  return input.trim();\n}\n');
    await tick();
    const second = liveRank();
    expect(second.id).not.toBe(first.id);
    expect(second.page_rank).toBe(0.25);
  });
});
