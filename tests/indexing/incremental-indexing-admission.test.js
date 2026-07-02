/**
 * Admission + current-session convergence for the incremental dirty-scan
 * producer. The producer must enqueue exactly what a fresh full index would
 * admit (no unsupported extensions, no gitignored/excluded/oversized files), and
 * must enqueue previously-indexed files that become deleted / excluded /
 * oversized / gitignored so the consumer can retire them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { scanDirtyAndEnqueue } from '../../core/incremental-indexing/application/dirty-scan.mjs';

let sandbox;
let stateDir;

function gitInit(root) {
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
}
function write(rel, content = 'x') {
  const abs = path.join(sandbox, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function statTuple(rel) {
  const s = fs.statSync(path.join(sandbox, rel), { bigint: true });
  return { hash: 'h', size: s.size.toString(), mtime_ns: s.mtimeNs.toString(), inode: s.ino.toString() };
}
function writeMerkle(files) {
  fs.writeFileSync(path.join(stateDir, 'merkle-state.json'), JSON.stringify({ version: '2.4', files }), 'utf-8');
}
function queuedPaths() {
  const f = path.join(stateDir, 'index-maintainer-queue.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l).file_path);
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-admit-scan-'));
  stateDir = path.join(sandbox, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });
});
afterEach(() => { try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('dirty-scan / admission of new files', () => {
  it('does NOT enqueue unsupported binary/data extensions (png/pdf/parquet)', async () => {
    write('src/a.js', 'export const a = 1;');
    write('img/logo.png');
    write('doc.pdf');
    write('data.parquet');
    write('nb.ipynb', '{"cells": []}'); // Jupyter notebooks ARE indexed (generic chunking)
    writeMerkle({});
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    const q = queuedPaths();
    expect(q).toContain('src/a.js');
    expect(q).toContain('nb.ipynb');
    expect(q).not.toContain('img/logo.png');
    expect(q).not.toContain('doc.pdf');
    expect(q).not.toContain('data.parquet');
    expect(res.added).toBe(2);
  });

  it('does NOT enqueue oversized new files', async () => {
    write('small.js', 'export const a = 1;');
    write('big.js', Buffer.alloc(2 * 1024 * 1024)); // > 1 MB default
    writeMerkle({});
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    const q = queuedPaths();
    expect(q).toContain('small.js');
    expect(q).not.toContain('big.js');
    expect(res.added).toBe(1);
  });

  it('does NOT enqueue gitignored new files', async () => {
    gitInit(sandbox);
    write('.gitignore', 'ignored.js\nsecrets/\n');
    write('keep.js');
    write('ignored.js');
    write('secrets/key.js');
    writeMerkle({});
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    const q = queuedPaths();
    expect(q).toContain('keep.js');
    expect(q).not.toContain('ignored.js');
    expect(q).not.toContain('secrets/key.js');
    expect(res.added).toBe(1);
  });
});

describe('dirty-scan / convergence (retire previously-indexed files)', () => {
  it('retires a file that became excluded by project config', async () => {
    write('src/keep.js', 'export const a = 1;');
    write('.sweet-search.config.json', JSON.stringify({ exclude: ['**/keep.js'] }));
    // src/keep.js + the config file were both already indexed (unchanged).
    writeMerkle({ 'src/keep.js': statTuple('src/keep.js'), '.sweet-search.config.json': statTuple('.sweet-search.config.json') });
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    expect(queuedPaths()).toContain('src/keep.js');
    expect(res.retired).toBeGreaterThanOrEqual(1);
  });

  it('retires a file that became oversized', async () => {
    write('src/grow.js', 'export const a = 1;');
    writeMerkle({ 'src/grow.js': statTuple('src/grow.js') });
    write('src/grow.js', Buffer.alloc(2 * 1024 * 1024)); // grow past the cap
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    expect(queuedPaths()).toContain('src/grow.js');
    expect(res.retired).toBe(1);
    expect(res.modified).toBe(0); // not reindexed — retired
  });

  it('retires a file that became gitignored', async () => {
    gitInit(sandbox);
    write('src/keep.js', 'export const a = 1;');
    writeMerkle({ 'src/keep.js': statTuple('src/keep.js') });
    write('.gitignore', 'src/keep.js\n');
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    expect(queuedPaths()).toContain('src/keep.js');
    expect(res.retired).toBe(1);
  });

  it('retires a file living under a directory that just became excluded', async () => {
    write('pkg/a.js', 'export const a = 1;');
    write('.sweet-search.config.json', JSON.stringify({ exclude: ['**/pkg/**'] }));
    writeMerkle({ 'pkg/a.js': statTuple('pkg/a.js'), '.sweet-search.config.json': statTuple('.sweet-search.config.json') });
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    expect(queuedPaths()).toContain('pkg/a.js'); // dir pruned, still retired
    expect(res.retired).toBeGreaterThanOrEqual(1);
  });

  it('still retires a deleted file (existing behavior preserved)', async () => {
    write('src/gone.js', 'export const a = 1;');
    writeMerkle({ 'src/gone.js': statTuple('src/gone.js') });
    fs.rmSync(path.join(sandbox, 'src/gone.js'));
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });
    expect(queuedPaths()).toContain('src/gone.js');
    expect(res.deleted).toBe(1);
  });
});
