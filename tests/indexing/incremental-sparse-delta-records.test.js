/**
 * Sparse-gram delta records from the maintainer:
 * - carry the file's symbol mask (from its live vector rows, as the full build derives it);
 *   with mask 0, a symbol-filtered grep took every edited file as a candidate (Fable F3);
 * - are extracted from the base loaded once per base file identity (each record and weights
 *   lookup loaded and parsed the whole base again: Fable F5, Opus F11).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runProductionReconcileTick, __testing } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { resolveLatestRecords, fileIdFor } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { SPARSE_SYMBOL_MASKS, buildSparseGramIndexArtifact, hasNativeSparseGramSupport } from '../../core/infrastructure/native-sparse-gram.js';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

let projectRoot;
let stateDir;
beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sparse-records-'));
  stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
});
afterEach(() => { fs.rmSync(projectRoot, { recursive: true, force: true }); });

describe('maintainer sparse-gram records', () => {
  it('carry the symbol mask of the file\'s live rows', async () => {
    if (!hasNativeSparseGramSupport()) return;
    fs.writeFileSync(path.join(projectRoot, 'src/a.js'), 'export function alphaThing(input) {\n  return input.trim();\n}\n');
    fs.writeFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: 'src/a.js' })}\n`);
    await runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
    const record = resolveLatestRecords(path.join(stateDir, 'codebase-sparse-grams.idx')).get(fileIdFor('src/a.js')).record;
    expect(record.symbolMask & SPARSE_SYMBOL_MASKS.function).toBe(SPARSE_SYMBOL_MASKS.function);
  });

  it('keep one loaded base per base file identity', () => {
    if (!hasNativeSparseGramSupport()) return;
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    fs.writeFileSync(path.join(projectRoot, 'src/a.js'), 'export const alpha = 1;\n');
    buildSparseGramIndexArtifact({ projectRoot, files: ['src/a.js'], fileSymbolMasks: [0], outputPath: base });
    const adapter = new __testing.ProductionReconcileAdapter({ projectRoot, stateDir, modelInfo: MODEL_INFO, vectorEncoder, liEncoder });
    const first = adapter._sparseExtractor(base);
    expect(first.index).toBeTruthy();
    expect(adapter._sparseExtractor(base)).toBe(first);

    fs.writeFileSync(path.join(projectRoot, 'src/b.js'), 'export const beta = 2;\n');
    buildSparseGramIndexArtifact({ projectRoot, files: ['src/a.js', 'src/b.js'], fileSymbolMasks: [0, 0], outputPath: `${base}.next` });
    fs.renameSync(`${base}.next`, base);
    expect(adapter._sparseExtractor(base)).not.toBe(first);
  });
});
