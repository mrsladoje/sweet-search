import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

// Code moved by an edit above it kept its old line span: the reuse fingerprint and the
// whole-file cutoff ignored lines, so results and read-semantic pointed at the wrong lines.
// A moved chunk now gets a new row version with the old embedding and a copied LI doc.
const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });

describe('code moved without changing', () => {
  let projectRoot;
  let stateDir;
  const rel = 'src/sample.js';
  const calls = { dense: 0, li: 0 };
  const vectorEncoder = async (texts) => { calls.dense += texts.length; return texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97)); };
  const liEncoder = async (texts) => { calls.li += texts.length; return texts.map((t) => [Float32Array.from({ length: 8 }, (_, k) => Math.sin(t.length + k))]); };

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-moved-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    calls.dense = 0; calls.li = 0;
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  async function tick() {
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: rel })}\n`);
    return runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
  }
  const live = () => {
    const db = new Database(join(stateDir, 'codebase.db'), { readonly: true });
    try { return db.prepare('SELECT id, metadata FROM vectors WHERE epoch_retired IS NULL').all().map((r) => ({ id: r.id, line: JSON.parse(r.metadata).startLine })); } finally { db.close(); }
  };
  const liIds = async () => {
    const idx = new LateInteractionIndex({ indexPath: join(stateDir, 'codebase-late-interaction.db'), loadExisting: true });
    await idx.init();
    return new Set(idx.documents.keys());
  };

  it('updates the line span, reuses the vectors, and copies the LI doc', async () => {
    const body = 'export function alphaThing(input) {\n  return input.trim();\n}\n';
    writeFileSync(join(projectRoot, rel), body);
    await tick();
    const before = live();
    expect(before.map((r) => r.line)).toEqual([1]);
    calls.dense = 0; calls.li = 0;

    writeFileSync(join(projectRoot, rel), `\n\n\n${body}`);
    await tick();
    const after = live();
    expect(after.map((r) => r.line)).toEqual([4]);
    expect(after[0].id).not.toBe(before[0].id);
    expect(calls).toEqual({ dense: 0, li: 0 });
    expect(await liIds()).toEqual(new Set(after.map((r) => r.id)));
  });
});
