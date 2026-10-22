import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openFileState, readFileStateObject } from '../../core/incremental-indexing/infrastructure/file-state-store.mjs';
import { buildConfigFingerprint } from '../../core/indexing/config-fingerprint.js';
import { hasCompleteBaseIndex } from '../../core/incremental-indexing/infrastructure/baseline-readiness.mjs';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { writeMerkleState } from '../helpers/file-state.js';

// The per-file merkle map was parsed and rewritten whole on every working tick (58 ms +
// 52 ms and 55 MB at 100k files). It now lives in file-state.db: keyed reads, and a tick
// writes only the rows it changed.
describe('file-state store', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ss-file-state-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('round-trips merkle-shaped entries, keyed and by directory prefix', () => {
    const store = openFileState(dir);
    store.putFile('src/a.js', { hash: 'h1', size: '10', mtime_ns: '123456789012345678', inode: '99999999999999999', epoch: 3, chunkIds: ['x', 'y'], liSkip: true });
    store.putFile('src/b.js', { hash: 'h2', size: 5, mtime_ns: '1' });
    store.putFile('srcx/c.js', { hash: 'h3', size: '1', mtime_ns: '1' });
    store.putGrep('vendor/v.go', { size: '7', mtime_ns: '8', hash: 'g' });
    expect(store.getFile('src/a.js')).toEqual({ hash: 'h1', size: '10', mtime_ns: '123456789012345678', inode: '99999999999999999', epoch: 3, chunkIds: ['x', 'y'], liSkip: true });
    expect(store.getFile('src/b.js')).toEqual({ hash: 'h2', size: '5', mtime_ns: '1' });
    expect(store.filePathsUnder('src/').sort()).toEqual(['src/a.js', 'src/b.js']);
    expect(store.getGrep('vendor/v.go')).toEqual({ size: '7', mtime_ns: '8', hash: 'g' });
    store.deleteFile('src/b.js');
    expect(store.fileCount()).toBe(2);
    store.close();
    expect(Object.keys(readFileStateObject(dir)).sort()).toEqual(['src/a.js', 'srcx/c.js']);
  });

  it('a state from before the store (state version 2.4) needs a full rebuild', () => {
    const stateDir = join(dir, '.sweet-search');
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, 'reconcile-manifest.json'), JSON.stringify({ epoch: 1 }));
    writeFileSync(join(stateDir, 'codebase.db'), '');
    writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({ version: '2.4', config_fingerprint: { ...buildConfigFingerprint(), version: '2.4' }, files: {} }));
    const gate = hasCompleteBaseIndex(stateDir);
    expect(gate.ready).toBe(false);
    expect(gate.changes.map((c) => c.reason)).toContain('state_version_changed');
  });
});

describe('a tick writes the header small and only the rows it changed', () => {
  let projectRoot;
  let stateDir;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'ss-file-state-tick-'));
    stateDir = join(projectRoot, '.sweet-search');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  it('keeps every other row as it was and the per-file map out of merkle-state.json', async () => {
    const others = {};
    for (let i = 0; i < 50; i += 1) others[`src/other${i}.js`] = { hash: `keep${i}`, size: '1', mtime_ns: '2', inode: '3', epoch: 0, chunkIds: [`c${i}`] };
    writeMerkleState(stateDir, { version: '2.5', files: others });
    writeFileSync(join(projectRoot, 'src/new.js'), 'export function alpha(x) {\n  return x;\n}\n');
    writeFileSync(join(stateDir, 'index-maintainer-queue.jsonl'), `${JSON.stringify({ file_path: 'src/new.js' })}\n`);
    await runProductionReconcileTick({
      projectRoot, stateDir,
      vectorEncoder: async (t) => t.map(() => Float32Array.from({ length: 8 }, (_, k) => k / 8)),
      liEncoder: async (t) => t.map(() => [Float32Array.from([1, 2, 3, 4])]),
      modelInfo: { provider: 'test', model: 'fake', dimension: 8, hnswDimension: 8 },
      logger: { info() {}, warn() {}, error() {} }, config: { filesPerTick: 10, cpuBudgetMs: 10_000 },
    });
    const header = JSON.parse(readFileSync(join(stateDir, 'merkle-state.json'), 'utf8'));
    expect(header.files).toBeUndefined();
    expect(header.stats.totalFiles).toBe(51);
    const rows = readFileStateObject(stateDir);
    for (const [rel, entry] of Object.entries(others)) expect(rows[rel]).toEqual(entry);
    expect(rows['src/new.js'].hash).toBeTruthy();
  });
});
