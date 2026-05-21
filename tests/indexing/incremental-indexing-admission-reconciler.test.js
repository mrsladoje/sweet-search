/**
 * Consumer-side admission + convergence for the production reconciler, plus LI
 * generated-content parity. Drives real reconcile ticks (fake encoders) and
 * asserts the second admission gate: queued files full indexing would skip are
 * never reconciled, previously-indexed files that become inadmissible are
 * retired, and @generated content is dropped from LI only (matching full
 * indexing) while embeddings/graph/sparse still index it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const silentLogger = { info() {}, warn() {}, error() {} };

function fakeVector(text, index) {
  const seed = [...text].reduce((s, ch) => s + ch.charCodeAt(0), index + 1);
  return Float32Array.from({ length: 8 }, (_, i) => ((seed + i * 13) % 97) / 97);
}
async function vectorEncoder(texts) { return texts.map((t, i) => fakeVector(t, i)); }
async function liEncoder(texts) {
  return texts.map((t, i) => [Float32Array.from([t.length + i, 2, 3, 4]), Float32Array.from([t.length + i + 1, 3, 4, 5])]);
}

let projectRoot;
let stateDir;

function gitInit(root) { execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' }); }
function write(rel, content = 'x') {
  const abs = path.join(projectRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function enqueue(...rels) {
  const lines = rels.map((r) => `${JSON.stringify({ file_path: r })}\n`).join('');
  fs.appendFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'), lines);
}
function withDb(dbPath, fn) {
  if (!fs.existsSync(dbPath)) return fn(null);
  const db = new Database(dbPath);
  try { return fn(db); } finally { db.close(); }
}
function liveVectorRows(file) {
  return withDb(path.join(stateDir, 'codebase.db'), (db) => {
    if (!db) return [];
    return db.prepare('SELECT id, file_path FROM vectors WHERE file_path = ? AND epoch_retired IS NULL').all(file);
  });
}
function liveGraphEntities(file) {
  return withDb(path.join(stateDir, 'code-graph.db'), (db) => {
    if (!db) return [];
    return db.prepare('SELECT id FROM entities WHERE file_path = ? AND epoch_retired IS NULL').all(file);
  });
}
function merkleFiles() {
  try { return JSON.parse(fs.readFileSync(path.join(stateDir, 'merkle-state.json'), 'utf-8')).files || {}; } catch { return {}; }
}
function tick() {
  return runProductionReconcileTick({
    projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
    logger: silentLogger, config: { filesPerTick: 20, cpuBudgetMs: 10_000 },
  });
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-admit-recon-'));
  stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });
});
afterEach(() => { try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('reconciler second admission gate', () => {
  it('does not index unsupported binary/data files queued after baseline', async () => {
    write('src/sample.js', 'export function alpha(x){ return x + 1; }\n');
    enqueue('src/sample.js');
    await tick();
    expect(liveVectorRows('src/sample.js').length).toBeGreaterThan(0);

    // A png and a parquet are written and queued (e.g. via a stray `index --add`).
    write('logo.png', 'PNG');
    write('data.parquet', 'PARQ');
    enqueue('logo.png', 'data.parquet');
    const second = await tick();

    expect(second.files_processed).toBe(0); // both dropped by the gate
    expect(liveVectorRows('logo.png')).toEqual([]);
    expect(liveVectorRows('data.parquet')).toEqual([]);
    expect(liveGraphEntities('data.parquet')).toEqual([]);
    expect(merkleFiles()['data.parquet']).toBeUndefined();
    expect(liveVectorRows('src/sample.js').length).toBeGreaterThan(0); // baseline intact
  });

  it('retires a previously-indexed file that becomes gitignored', async () => {
    gitInit(projectRoot);
    write('src/a.js', 'export function beta(x){ return x - 1; }\n');
    enqueue('src/a.js');
    await tick();
    expect(liveVectorRows('src/a.js').length).toBeGreaterThan(0);
    expect(merkleFiles()['src/a.js']).toBeDefined();

    write('.gitignore', 'src/a.js\n');
    enqueue('src/a.js');
    const second = await tick();

    expect(second.ops_per_tier.vectors_delete).toBeGreaterThan(0);
    expect(liveVectorRows('src/a.js')).toEqual([]);
    expect(liveGraphEntities('src/a.js')).toEqual([]);
    expect(merkleFiles()['src/a.js']).toBeUndefined();
  });
});

describe('LI generated-content parity', () => {
  it('drops @generated content from LI but still indexes it in embeddings/graph/sparse', async () => {
    write('src/gen.js', [
      '// @generated by tool — DO NOT EDIT',
      'export function generatedThing(input) {',
      '  // @generated',
      '  return input.trim();',
      '}',
      '',
    ].join('\n'));
    enqueue('src/gen.js');
    const res = await tick();

    expect(res.ops_per_tier.vectors_upsert).toBeGreaterThan(0); // embeddings index it
    expect(res.ops_per_tier.graph_upsert).toBeGreaterThan(0);   // graph indexes it
    expect(res.ops_per_tier.sparse_gram_delta_upsert).toBe(1);  // sparse indexes it
    expect(res.ops_per_tier.li_segment_append || 0).toBe(0);    // LI skips it (parity with full)
  });

  it('indexes ordinary content into LI', async () => {
    write('src/normal.js', 'export function ordinary(input) {\n  return input + 1;\n}\n');
    enqueue('src/normal.js');
    const res = await tick();
    expect(res.ops_per_tier.vectors_upsert).toBeGreaterThan(0);
    expect(res.ops_per_tier.li_segment_append).toBeGreaterThan(0);
  });

  it('keeps a @generated file out of LI even when a non-first chunk is modified', async () => {
    const v1 = [
      'export function first(input) {',
      '  // @generated DO NOT EDIT',
      '  return input;',
      '}',
      'export function second(input) {',
      '  return input + 1;',
      '}',
      '',
    ].join('\n');
    write('src/gen2.js', v1);
    enqueue('src/gen2.js');
    const first = await tick();
    expect(first.ops_per_tier.vectors_upsert).toBeGreaterThan(0);
    expect(first.ops_per_tier.li_segment_append || 0).toBe(0);

    // Modify ONLY the second function; the @generated first chunk is hash-reused.
    write('src/gen2.js', v1.replace('return input + 1;', 'return input + 2;'));
    enqueue('src/gen2.js');
    const second = await tick();
    expect(second.ops_per_tier.vectors_upsert).toBeGreaterThan(0); // re-encoded in embeddings
    expect(second.ops_per_tier.li_segment_append || 0).toBe(0);    // still excluded from LI (whole-file decision)
  });
});
