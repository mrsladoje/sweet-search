/**
 * Full discovery skips minified/bundled files by content shape (indexer-utils.js). The
 * maintainer's admission did not, so it re-added every file the full build dropped and the
 * two kept reversing each other. The shared admission policy now carries the check: the
 * scan does not queue a new minified file, and the consumer retires one that became minified.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { scanDirtyAndEnqueue, _resetGrepDiscoveryMemo } from '../../core/incremental-indexing/application/dirty-scan.mjs';

const MODEL_INFO = Object.freeze({ provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 });
const vectorEncoder = async (texts) => texts.map((t, i) => Float32Array.from({ length: 8 }, (_, k) => ((t.length + i + k * 13) % 97) / 97));
const liEncoder = async (texts) => texts.map((t) => [Float32Array.from([t.length, 2, 3, 4])]);
const MINIFIED = `var a=${'1+'.repeat(1500)}1;\n`; // one 3 KB line: the single-line rule

let projectRoot;
let stateDir;

function write(rel, content) {
  const abs = path.join(projectRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
function tick() {
  return runProductionReconcileTick({
    projectRoot, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
    logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 20, cpuBudgetMs: 10_000 },
  });
}
function vectorRows(rel) {
  const p = path.join(stateDir, 'codebase.db');
  if (!fs.existsSync(p)) return 0;
  const db = new Database(p, { readonly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE file_path = ? AND epoch_retired IS NULL').get(rel).n; } finally { db.close(); }
}

beforeEach(() => {
  _resetGrepDiscoveryMemo();
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-minified-'));
  stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: projectRoot });
  write('.gitignore', '.sweet-search/\n');
  write('src/app.js', 'export function app() {\n  return 1;\n}\n');
});
afterEach(() => { fs.rmSync(projectRoot, { recursive: true, force: true }); });

describe('minified files in the maintainer', () => {
  it('are not queued when new', async () => {
    write('src/bundle.js', MINIFIED);
    const scan = await scanDirtyAndEnqueue({ projectRoot, stateDir });
    expect(scan.files).toContain('src/app.js');
    expect(scan.files).not.toContain('src/bundle.js');
  });

  it('are retired when an indexed file becomes minified', async () => {
    fs.writeFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: 'src/app.js' })}\n`);
    await tick();
    expect(vectorRows('src/app.js')).toBeGreaterThan(0);

    write('src/app.js', MINIFIED);
    fs.writeFileSync(path.join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: 'src/app.js' })}\n`);
    await tick();
    expect(vectorRows('src/app.js')).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(stateDir, 'merkle-state.json'), 'utf8')).files['src/app.js']).toBeUndefined();
  });
});
