/**
 * readDirtySet stat-ed, symlink-checked, gitignore-checked and content-checked the whole queue
 * on every tick, then processed 50 files: a backlog drained in O(backlog^2) (Opus round 4,
 * F8). It now admits twice the tick's file cap and puts the rest back in the queue unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runProductionReconcileTick, __testing } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { readIndexedFiles } from '../helpers/file-state.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

let projectRoot;
let stateDir;
const N = 30;
const rels = Array.from({ length: N }, (_, i) => `src/f${String(i).padStart(2, '0')}.js`);

function queueLines() {
  try {
    return fs.readFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-dirty-slice-'));
  stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  for (const [i, rel] of rels.entries()) fs.writeFileSync(path.join(projectRoot, rel), `export const v${i} = ${i};\n`);
  fs.writeFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'),
    rels.map((rel, i) => `${JSON.stringify({ file_path: rel, timestamp: 1000 + i, source: 'scan' })}\n`).join(''));
});
afterEach(() => { fs.rmSync(projectRoot, { recursive: true, force: true }); });

describe('readDirtySet slice', () => {
  it('admits twice the file cap and requeues the rest unchanged', async () => {
    const adapter = new __testing.ProductionReconcileAdapter({ projectRoot, stateDir, modelInfo: MODEL_INFO, vectorEncoder, liEncoder, config: { filesPerTick: 5 } });
    const admitted = await adapter.readDirtySet();
    expect(admitted).toHaveLength(10);
    expect(admitted[0]).toBe(rels[N - 1]); // fresh hints newest first
    const tail = queueLines();
    expect(tail).toHaveLength(20);
    expect(tail.every((e) => e.source === 'scan')).toBe(true);
    expect(new Set([...admitted, ...tail.map((e) => e.file_path)])).toEqual(new Set(rels));
  });

  it('drains the whole backlog over ticks without losing a file', async () => {
    for (let t = 0; t < 12 && (queueLines().length > 0 || t === 0); t++) {
      await runProductionReconcileTick({
        projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
        logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 5, cpuBudgetMs: 10_000 },
      });
    }
    const merkle = readIndexedFiles(stateDir);
    expect(rels.filter((rel) => !merkle[rel])).toEqual([]);
    expect(queueLines()).toEqual([]);
  });
});
