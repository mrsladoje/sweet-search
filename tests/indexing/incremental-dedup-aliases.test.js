import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

// A dedup alias (full build) has its exemplar's embedding, no chunk FTS row and no LI doc
// (a sidecar pointer stands in). Deleting the exemplar's file left the alias without chunk
// BM25 and LI, and editing an alias file left its pointer behind.
const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from({ length: 8 }, (_, k) => Math.sin(t.length + k))]);

describe('dedup aliases of a retired exemplar', () => {
  let projectRoot;
  let stateDir;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-alias-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  async function tick(...files) {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), files.map((f) => `${JSON.stringify({ file_path: f })}\n`).join(''));
    await runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }
  const liPath = () => join(stateDir, 'codebase-late-interaction.db');

  it('turns the aliases into ordinary rows with chunk FTS, an LI doc and no pointer', async () => {
    const code = 'export function sharedThing(input) {\n  return input.trim();\n}\n';
    writeFileSync(join(projectRoot, 'src/a.js'), code);
    writeFileSync(join(projectRoot, 'src/b.js'), code);
    await tick('src/a.js', 'src/b.js');

    // Make b's row an alias of a's row, as a full build with dedup would.
    const db = new Database(join(stateDir, 'codebase.db'));
    const rowOf = (file) => db.prepare('SELECT rowid, id, metadata FROM vectors WHERE file_path = ? AND epoch_retired IS NULL').get(file);
    const a = rowOf('src/a.js');
    const b = rowOf('src/b.js');
    db.prepare('UPDATE vectors SET metadata = ? WHERE rowid = ?').run(JSON.stringify({ ...JSON.parse(b.metadata), exemplarId: a.id, isExemplar: false }), b.rowid);
    db.prepare('DELETE FROM chunk_text_fts WHERE rowid = ?').run(b.rowid);
    db.close();
    const li = new LateInteractionIndex({ indexPath: liPath(), loadExisting: true, positionsOnly: true });
    await li.init();
    const pos = li._docSegmentPositions.get(b.id);
    const { openSegmentState, tombstoneDoc, persistSegmentState } = await import('../../core/incremental-indexing/infrastructure/li-segment-state.mjs');
    const st = openSegmentState(pos.segmentPath, pos.docIndex + 1);
    tombstoneDoc(st, pos.docIndex);
    persistSegmentState(st);
    writeFileSync(`${liPath()}.aliases.json`, `${JSON.stringify({ version: 2, count: 1 })}\n${JSON.stringify({ aliasId: b.id, exemplarId: a.id, clusterId: 'c1', metadata: {} })}\n`);

    unlinkSync(join(projectRoot, 'src/a.js'));
    await tick('src/a.js');

    const after = new Database(join(stateDir, 'codebase.db'), { readonly: true });
    try {
      const row = after.prepare('SELECT rowid, metadata FROM vectors WHERE id = ?').get(b.id);
      expect(JSON.parse(row.metadata).exemplarId).toBeNull();
      // Live rows only: a retired row keeps its FTS row until GC (search filters by epoch).
      expect(after.prepare("SELECT f.rowid FROM chunk_text_fts f JOIN vectors v ON v.rowid = f.rowid WHERE chunk_text_fts MATCH 'sharedThing' AND v.epoch_retired IS NULL").all().map((r) => r.rowid)).toEqual([row.rowid]);
    } finally { after.close(); }
    const back = new LateInteractionIndex({ indexPath: liPath(), loadExisting: true });
    await back.init();
    expect([...back.documents.keys()]).toEqual([b.id]);
    expect(readFileSync(`${liPath()}.aliases.json`, 'utf8')).not.toContain(b.id);
  });
});
