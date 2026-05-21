/**
 * Unit tests for the autonomous dirty-scan producer (release-gate C1 fix).
 *
 * The maintainer tick is a queue consumer; this producer diffs the working tree
 * against merkle-state.json and enqueues add/modify/delete hints so ordinary
 * edits are reconciled without `sweet-search index --add`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanDirtyAndEnqueue, dirtyScanEnabled } from '../../core/incremental-indexing/application/dirty-scan.mjs';

let sandbox;
let stateDir;

function statTuple(absPath) {
  const s = statSync(absPath, { bigint: true });
  return { hash: 'x', size: s.size.toString(), mtime_ns: s.mtimeNs.toString(), inode: s.ino.toString() };
}

function writeMerkle(files) {
  writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify({ version: '2.4', files }), 'utf-8');
}

function queuedPaths() {
  const f = join(stateDir, 'index-maintainer-queue.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l).file_path);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'ss-dirty-scan-'));
  stateDir = join(sandbox, '.sweet-search');
  mkdirSync(join(sandbox, 'src'), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('scanDirtyAndEnqueue', () => {
  it('enqueues a brand-new file not present in merkle-state', async () => {
    writeFileSync(join(sandbox, 'src/new.js'), 'export const a = 1;\n', 'utf-8');
    writeMerkle({}); // nothing known yet

    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });

    expect(res.added).toBe(1);
    expect(queuedPaths()).toContain('src/new.js');
  });

  it('enqueues a modified file (stat differs from merkle baseline)', async () => {
    const p = join(sandbox, 'src/mod.js');
    writeFileSync(p, 'export const a = 1;\n', 'utf-8');
    writeMerkle({ 'src/mod.js': statTuple(p) });

    // Mutate so size + mtime change.
    writeFileSync(p, 'export const a = 1;\nexport const b = 2;\n', 'utf-8');
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });

    expect(res.modified).toBe(1);
    expect(queuedPaths()).toContain('src/mod.js');
  });

  it('does NOT enqueue an unchanged file', async () => {
    const p = join(sandbox, 'src/same.js');
    writeFileSync(p, 'export const a = 1;\n', 'utf-8');
    writeMerkle({ 'src/same.js': statTuple(p) });

    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });

    expect(res.enqueued).toBe(0);
    expect(queuedPaths()).not.toContain('src/same.js');
  });

  it('enqueues a deleted file that is still in merkle-state', async () => {
    const p = join(sandbox, 'src/gone.js');
    writeFileSync(p, 'export const a = 1;\n', 'utf-8');
    writeMerkle({ 'src/gone.js': statTuple(p) });
    rmSync(p);

    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });

    expect(res.deleted).toBe(1);
    expect(queuedPaths()).toContain('src/gone.js');
  });

  it('respects the path filter (excluded paths are skipped)', async () => {
    writeFileSync(join(sandbox, 'src/keep.js'), 'a', 'utf-8');
    writeFileSync(join(sandbox, 'src/skip.js'), 'b', 'utf-8');
    writeMerkle({});

    const isExcluded = (rel) => rel.endsWith('skip.js');
    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir, isExcluded });

    const q = queuedPaths();
    expect(q).toContain('src/keep.js');
    expect(q).not.toContain('src/skip.js');
    expect(res.enqueued).toBe(1);
  });

  it('de-dupes against paths already in the queue', async () => {
    writeFileSync(join(sandbox, 'src/dup.js'), 'a', 'utf-8');
    writeMerkle({});
    // Pre-seed the queue with the same path.
    writeFileSync(
      join(stateDir, 'index-maintainer-queue.jsonl'),
      `${JSON.stringify({ file_path: 'src/dup.js', source: 'cli' })}\n`,
      'utf-8',
    );

    const res = await scanDirtyAndEnqueue({ projectRoot: sandbox, stateDir });

    expect(res.enqueued).toBe(0);
    // Still exactly one entry — not appended twice.
    expect(queuedPaths().filter((p) => p === 'src/dup.js')).toHaveLength(1);
  });

  it('honours the SWEET_SEARCH_RECONCILE_SCAN opt-out token', () => {
    expect(dirtyScanEnabled({})).toBe(true);
    expect(dirtyScanEnabled({ SWEET_SEARCH_RECONCILE_SCAN: '0' })).toBe(false);
    expect(dirtyScanEnabled({ SWEET_SEARCH_RECONCILE_SCAN: 'off' })).toBe(false);
    expect(dirtyScanEnabled({ SWEET_SEARCH_RECONCILE_SCAN: '1' })).toBe(true);
  });
});
