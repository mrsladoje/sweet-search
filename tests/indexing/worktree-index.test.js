/**
 * A linked worktree's own index, cloned from the main checkout's (core/indexing/worktree-index.mjs).
 *
 * The fixture is a real git repository with a linked worktree and a hand-made state dir:
 * a codebase.db marker, a file-state.db written by the real store, and the runtime files
 * of the main checkout's processes. No models, no indexer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  bootstrapWorktreeIndex, gcWorktreeIndexes, isRuntimeFile, rekeyFileState, requestWorktreeIndex,
  worktreeIndexDir, bootstrapState, bootstrapClaimPath,
} from '../../core/indexing/worktree-index.mjs';
import { openFileState } from '../../core/incremental-indexing/infrastructure/file-state-store.mjs';
import { contentHashSync } from '../../core/incremental-indexing/infrastructure/hashing.mjs';
import { resolveRoots } from '../../core/search/worktree-roots.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let tmp;
let main;
let wt;

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function statOf(abs) {
  const st = fs.statSync(abs, { bigint: true });
  return { size: st.size.toString(), mtime_ns: st.mtimeNs.toString(), inode: st.ino.toString() };
}

/** A main index whose file records describe the main checkout's files exactly. */
function makeMainIndex() {
  const state = path.join(main, '.sweet-search');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'codebase.db'), 'index');
  fs.mkdirSync(path.join(state, 'codebase-late-interaction.db.segments'));
  fs.writeFileSync(path.join(state, 'codebase-late-interaction.db.segments', 'segment-1.bin'), 'seg');
  // Runtime files: none may reach the worktree's index.
  fs.writeFileSync(path.join(state, 'index-maintainer.lock'), JSON.stringify({ pid: 99999999 }));
  fs.writeFileSync(path.join(state, 'index-maintainer-queue.jsonl'), '{"file_path":"a.js"}\n');
  fs.writeFileSync(path.join(state, 'index-maintainer.log'), 'log');
  fs.writeFileSync(path.join(state, 'daemon.log'), 'log');
  fs.writeFileSync(path.join(state, 'worktree-stamp.json'), JSON.stringify({ projectRoot: main }));
  fs.mkdirSync(path.join(state, 'readers'));
  fs.mkdirSync(path.join(state, 'worktrees', 'other-123'), { recursive: true });
  const store = openFileState(state);
  for (const rel of ['a.js', 'b.js', 'gone.js']) {
    const abs = path.join(main, rel);
    store.putFile(rel, { hash: contentHashSync(fs.readFileSync(abs)), ...statOf(abs), epoch: 1, chunkIds: [rel] });
  }
  // A grep-only file recorded by stat alone, as the full build does.
  const l = fs.lstatSync(path.join(main, 'LICENSE'), { bigint: true });
  store.putGrep('LICENSE', { size: l.size.toString(), mtime_ns: l.mtimeNs.toString() });
  store.close();
  return state;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-wt-index-')));
  main = path.join(tmp, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q');
  write(main, 'a.js', 'export const a = 1;\n');
  write(main, 'b.js', 'export const b = 2;\n');
  write(main, 'gone.js', 'export const gone = 3;\n');
  write(main, 'LICENSE', 'MIT\n');
  git(main, 'add', '-A');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  wt = path.join(tmp, 'wt');
  git(main, 'worktree', 'add', '-q', wt, '-b', 'feature');
  // The worktree's own changes: one edit, one deletion, one new file.
  write(wt, 'b.js', 'export const b = 22;\n');
  fs.rmSync(path.join(wt, 'gone.js'));
  write(wt, 'new.js', 'export const fresh = 4;\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('isRuntimeFile', () => {
  it('keeps index artifacts and drops the main checkout\'s runtime files', () => {
    for (const name of ['codebase.db', 'codebase.db-wal', 'file-state.db', 'code-graph.db', 'codebase-sparse-grams.idx',
      'codebase-late-interaction.db.segments', 'merkle-state.json', 'reconcile-manifest.json', 'rebuild-queue.jsonl']) {
      expect(isRuntimeFile(name), name).toBe(false);
    }
    for (const name of ['index-maintainer.lock', 'index-maintainer-queue.jsonl', 'index-maintainer.log.1', 'daemon.log',
      'query-telemetry.jsonl', 'readers', 'worktrees', 'worktree-stamp.json', 'codebase.db-shm', 'worktree-bootstrap.lock',
      'maintainer-watch-snapshot.bin', 'reconcile-pause.json']) {
      expect(isRuntimeFile(name), name).toBe(true);
    }
  });
});

describe('rekeyFileState', () => {
  it('gives unchanged files the worktree\'s stat and queues the rest', async () => {
    const state = makeMainIndex();
    const copy = path.join(tmp, 'copy');
    fs.cpSync(state, copy, { recursive: true });
    const { same, changed } = await rekeyFileState({ stateDir: copy, worktree: wt, mainCheckout: main });
    // a.js same; LICENSE same (checked against the main checkout's file); b.js changed;
    // gone.js left to the dirty scan, which retires it.
    expect(same).toBe(2);
    expect(changed).toEqual(['b.js']);
    const store = openFileState(copy, { readonly: true });
    try {
      expect(store.getFile('a.js')).toMatchObject({ ...statOf(path.join(wt, 'a.js')), epoch: 1, chunkIds: ['a.js'] });
      expect(store.getFile('b.js').mtime_ns).toBe(statOf(path.join(main, 'b.js')).mtime_ns);
      const lic = store.getGrep('LICENSE');
      expect(lic.mtime_ns).toBe(fs.lstatSync(path.join(wt, 'LICENSE'), { bigint: true }).mtimeNs.toString());
      expect(lic.hash).toBe(contentHashSync(fs.readFileSync(path.join(wt, 'LICENSE'))));
    } finally {
      store.close();
    }
  });

  it('queues a stat-only grep file when the main checkout\'s copy no longer matches the record', async () => {
    const state = makeMainIndex();
    write(main, 'LICENSE', 'Apache\n'); // the main index is behind its own checkout
    const copy = path.join(tmp, 'copy');
    fs.cpSync(state, copy, { recursive: true });
    const { changed } = await rekeyFileState({ stateDir: copy, worktree: wt, mainCheckout: main });
    expect(changed).toContain('LICENSE');
  });
});

describe('bootstrapWorktreeIndex', () => {
  it('clones the index next to the main one, links it in, and leaves git clean', async () => {
    makeMainIndex();
    const r = await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    expect(r.changed).toBe(1);
    const dir = worktreeIndexDir(main, wt);
    expect(r.dir).toBe(dir);
    expect(path.dirname(dir)).toBe(path.join(main, '.sweet-search', 'worktrees'));
    // The worktree holds a link, not a directory.
    expect(fs.lstatSync(path.join(wt, '.sweet-search')).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(path.join(wt, '.sweet-search'))).toBe(dir);
    // Index entries came along; runtime files and other worktrees' indexes did not.
    expect(fs.readFileSync(path.join(dir, 'codebase-late-interaction.db.segments', 'segment-1.bin'), 'utf8')).toBe('seg');
    for (const name of ['index-maintainer.lock', 'index-maintainer.log', 'daemon.log', 'readers', 'worktrees']) {
      expect(fs.existsSync(path.join(dir, name)), name).toBe(false);
    }
    // Stamped for the worktree, with the changed file queued.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'worktree-stamp.json'), 'utf8')).projectRoot).toBe(wt);
    const queued = fs.readFileSync(path.join(dir, 'index-maintainer-queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).file_path);
    expect(queued).toEqual(['b.js']);
    // The main index is untouched, and its maintainer is not left paused.
    expect(fs.existsSync(path.join(main, '.sweet-search', 'reconcile-pause.json'))).toBe(false);
    expect(fs.existsSync(path.join(main, '.sweet-search', 'index-maintainer-queue.jsonl'))).toBe(true);
    // git sees nothing new in the worktree, and the worktree can be removed.
    expect(git(wt, 'status', '--porcelain', '--', '.sweet-search')).toBe('');
    // The roots now resolve to the worktree's own index: no split.
    const roots = resolveRoots({ cwd: wt });
    expect(roots).toMatchObject({ indexRoot: wt, fileRoot: wt, split: false });
  });

  it('does not touch a worktree that has a state dir of its own', async () => {
    makeMainIndex();
    fs.mkdirSync(path.join(wt, '.sweet-search'));
    const r = await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    expect(r).toEqual({ skipped: 'own-state-dir' });
  });

  it('refuses while the main index is paused by someone else', async () => {
    const state = makeMainIndex();
    fs.writeFileSync(path.join(state, 'reconcile-pause.json'), JSON.stringify({ paused: true }));
    await expect(bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false })).rejects.toThrow(/paused/);
    expect(fs.existsSync(path.join(wt, '.sweet-search'))).toBe(false);
    expect(fs.readdirSync(path.join(state, 'worktrees'))).toEqual(['other-123']);
  });

  it('replaces a dangling link (the main index was deleted and rebuilt)', async () => {
    makeMainIndex();
    fs.symlinkSync(path.join(tmp, 'nowhere'), path.join(wt, '.sweet-search'));
    const r = await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    expect(r.dir).toBe(worktreeIndexDir(main, wt));
    expect(fs.existsSync(path.join(wt, '.sweet-search', 'codebase.db'))).toBe(true);
  });
});

describe('gcWorktreeIndexes', () => {
  it('deletes the index of a removed worktree and keeps a live one', async () => {
    makeMainIndex();
    await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    const worktrees = path.join(main, '.sweet-search', 'worktrees');
    const dir = worktreeIndexDir(main, wt);
    // other-123 has no stamp but is fresh: an unfinished bootstrap is given time.
    expect(gcWorktreeIndexes(worktrees)).toEqual([]);
    git(main, 'worktree', 'remove', '--force', wt);
    expect(fs.existsSync(wt)).toBe(false);
    expect(gcWorktreeIndexes(worktrees)).toEqual([dir]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('leaves an index a live maintainer still holds, unless that maintainer is the caller', () => {
    const worktrees = path.join(tmp, 'wts');
    const dir = path.join(worktrees, 'x-1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'worktree-stamp.json'), JSON.stringify({ projectRoot: path.join(tmp, 'removed') }));
    fs.writeFileSync(path.join(dir, 'index-maintainer.lock'), JSON.stringify({ pid: process.pid }));
    expect(gcWorktreeIndexes(worktrees)).toEqual([]);
    expect(gcWorktreeIndexes(worktrees, { selfPid: process.pid })).toEqual([dir]);
  });

  it('deletes unfinished bootstrap folders of dead processes only', () => {
    const worktrees = path.join(tmp, 'wts');
    const dead = path.join(worktrees, 'x-1.bootstrap-99999999');
    const live = path.join(worktrees, `x-2.bootstrap-${process.pid}`);
    fs.mkdirSync(dead, { recursive: true });
    fs.mkdirSync(live, { recursive: true });
    expect(gcWorktreeIndexes(worktrees)).toEqual([dead]);
    expect(fs.existsSync(live)).toBe(true);
  });
});

describe('requestWorktreeIndex', () => {
  it('starts nothing when switched off, already indexed, or failed recently', () => {
    makeMainIndex();
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: wt, env: { SWEET_SEARCH_WORKTREE_INDEX: '0' } }).reason).toBe('disabled');
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: main }).reason).toBe('not-linked');
    fs.writeFileSync(bootstrapClaimPath(main, wt), JSON.stringify({ status: 'failed', atMs: Date.now() }));
    expect(bootstrapState(main, wt)).toBe('failed-recently');
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: wt }).reason).toBe('failed-recently');
    // A short retry period from a transient failure (a paused main index) runs out.
    fs.writeFileSync(bootstrapClaimPath(main, wt), JSON.stringify({ status: 'failed', atMs: Date.now() - 61_000, retryAfterMs: 60_000 }));
    expect(bootstrapState(main, wt)).toBe(null);
  });

  it('runs the bootstrap in a background process', async () => {
    makeMainIndex();
    const r = requestWorktreeIndex({ mainCheckout: main, worktree: wt, env: { ...process.env, SWEET_SEARCH_RECONCILE_V2: '0' } });
    expect(r.started).toBe(true);
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(path.join(wt, '.sweet-search', 'codebase.db')) && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(fs.existsSync(path.join(wt, '.sweet-search', 'codebase.db'))).toBe(true);
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: wt }).reason).toBe('indexed');
  }, 30_000);
});
