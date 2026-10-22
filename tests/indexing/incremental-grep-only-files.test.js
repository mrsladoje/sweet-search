/**
 * Grep-only files: in the sparse-gram (ss-grep) corpus but outside embedding admission
 * (tracked vendor/, LICENSE, *.csv). The maintainer tracked only embedding files, so an
 * edit to one never reached the grep index and ss-grep answered from the full build's
 * grams (false "no matches" once committed). They now get sparse-gram records only, and
 * grep-corpus-state.json records them for the dirty scan.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { scanDirtyAndEnqueue, _resetGrepDiscoveryMemo } from '../../core/incremental-indexing/application/dirty-scan.mjs';
import { resolveLatestRecords, fileIdFor } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { readGrepCorpusState, writeGrepCorpusState, grepStatEntry } from '../../core/incremental-indexing/infrastructure/grep-corpus-state.mjs';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);

let projectRoot;
let stateDir;

function write(rel, content) {
  const abs = path.join(projectRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function readQueue() {
  try {
    return fs.readFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l).file_path);
  } catch { return []; }
}
function enqueue(...rels) {
  fs.appendFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'), rels.map((r) => `${JSON.stringify({ file_path: r })}\n`).join(''));
}
function tick() {
  return runProductionReconcileTick({
    projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
    logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 20, cpuBudgetMs: 10_000 },
  });
}
function record(rel) {
  return resolveLatestRecords(path.join(stateDir, 'codebase-sparse-grams.idx')).get(fileIdFor(rel))?.record ?? null;
}
function vectorRows(rel) {
  const p = path.join(stateDir, 'codebase.db');
  if (!fs.existsSync(p)) return 0;
  const db = new Database(p, { readonly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE file_path = ? AND epoch_retired IS NULL').get(rel).n; } finally { db.close(); }
}

beforeEach(() => {
  _resetGrepDiscoveryMemo();
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-grep-only-'));
  stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  write('.gitignore', '.sweet-search/\n');
  write('src/main.go', 'package main\n\nfunc main() { IsPrecert() }\n');
  write('vendor/lib/cert.go', 'package lib\n\nfunc IsOld() bool { return false }\n');
});
afterEach(() => { fs.rmSync(projectRoot, { recursive: true, force: true }); });

describe('grep-only files', () => {
  it('keep their sparse-gram records current through edit and delete, with no vector rows', async () => {
    enqueue('src/main.go', 'vendor/lib/cert.go');
    await tick();
    expect(vectorRows('src/main.go')).toBeGreaterThan(0);
    expect(vectorRows('vendor/lib/cert.go')).toBe(0);
    expect(record('vendor/lib/cert.go')).toMatchObject({ deleted: false, filePath: 'vendor/lib/cert.go' });
    expect(readGrepCorpusState(stateDir).files['vendor/lib/cert.go']).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'merkle-state.json'), 'utf8')).files['vendor/lib/cert.go']).toBeUndefined();

    // The scan sees the edit through the grep state (the embedding walk skips vendor/).
    write('vendor/lib/cert.go', 'package lib\n\nfunc IsPrecert() bool { return true }\n');
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(projectRoot, 'vendor/lib/cert.go'), t, t);
    await scanDirtyAndEnqueue({ projectRoot, stateDir });
    expect(readQueue()).toContain('vendor/lib/cert.go');
    const before = record('vendor/lib/cert.go').contentHash;
    await tick();
    expect(record('vendor/lib/cert.go').contentHash).not.toBe(before);

    fs.rmSync(path.join(projectRoot, 'vendor/lib/cert.go'));
    await scanDirtyAndEnqueue({ projectRoot, stateDir });
    expect(readQueue()).toContain('vendor/lib/cert.go');
    await tick();
    expect(record('vendor/lib/cert.go')).toMatchObject({ deleted: true });
    expect(readGrepCorpusState(stateDir).files['vendor/lib/cert.go']).toBeUndefined();
  });

  it('are discovered from the file list when new, and not re-queued once recorded', async () => {
    writeGrepCorpusState(stateDir, { files: { 'vendor/lib/cert.go': grepStatEntry(path.join(projectRoot, 'vendor/lib/cert.go')) } });
    write('vendor/lib/new.go', 'package lib\n\nfunc Fresh() {}\n');
    write('LICENSE', 'MIT License\n');
    const scan = await scanDirtyAndEnqueue({ projectRoot, stateDir });
    expect(scan.files).toEqual(expect.arrayContaining(['vendor/lib/new.go', 'LICENSE']));
    expect(scan.files).not.toContain('vendor/lib/cert.go');
    await tick();
    expect(record('vendor/lib/new.go')).toMatchObject({ deleted: false });
    _resetGrepDiscoveryMemo();
    const again = await scanDirtyAndEnqueue({ projectRoot, stateDir });
    expect(again.files).not.toContain('vendor/lib/new.go');
  });

  it('keep the sparse content of an embedding file that grew past the embedding size cap', async () => {
    const { createAdmissionPolicy } = await import('../../core/indexing/admission-policy.js');
    const { loadProjectConfig } = await import('../../core/infrastructure/config/index.js');
    const admissionPolicy = createAdmissionPolicy({ projectRoot, config: { ...loadProjectConfig(projectRoot), maxFileSize: 200 } });
    const run = () => runProductionReconcileTick({
      projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO, admissionPolicy,
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 20, cpuBudgetMs: 10_000 },
    });
    enqueue('src/main.go');
    await run();
    expect(vectorRows('src/main.go')).toBeGreaterThan(0);

    write('src/main.go', `package main\n\nfunc main() { IsPrecert() }\n${'// padding line\n'.repeat(30)}`);
    enqueue('src/main.go');
    await run();
    expect(vectorRows('src/main.go')).toBe(0);
    expect(record('src/main.go')).toMatchObject({ deleted: false });
    expect(readGrepCorpusState(stateDir).files['src/main.go']).toBeTruthy();
  });

  it('keep sparse content when an embedding file leaves admission but stays in the grep corpus', async () => {
    enqueue('src/main.go');
    await tick();
    expect(vectorRows('src/main.go')).toBeGreaterThan(0);
    // Embedding admission now excludes it (.sweet-search-ignore drops it from grep too, so
    // use a shape the embedding policy rejects: move it under vendor/ via a rename).
    fs.mkdirSync(path.join(projectRoot, 'vendor/app'), { recursive: true });
    fs.renameSync(path.join(projectRoot, 'src/main.go'), path.join(projectRoot, 'vendor/app/main.go'));
    enqueue('src/main.go', 'vendor/app/main.go');
    await tick();
    expect(vectorRows('src/main.go')).toBe(0);
    expect(record('src/main.go')).toMatchObject({ deleted: true });
    expect(record('vendor/app/main.go')).toMatchObject({ deleted: false });
  });
});
