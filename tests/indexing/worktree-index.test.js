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
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  bootstrapWorktreeIndex, gcWorktreeIndexes, isRuntimeFile, rekeyFileState, requestWorktreeIndex,
  worktreeIndexDir, bootstrapState, bootstrapClaimPath, isClonedEntry, indexDateMs, createExclusive,
  removeIfStale, cloneIndexDir, plainCopyMaxBytes, ensureWorktreeIndex, indexReadiness,
} from '../../core/indexing/worktree-index.mjs';
import { holdMaintainerForIndexRun } from '../../core/indexing/maintainer-launcher.mjs';
import { stateDirGone, linkedWorktreeCloneOf, requestCloneReplacement } from '../../core/indexing/index-maintainer.mjs';
import { projectSocketPath } from '../../core/search/server-identity.js';
import { pendingReindexFiles } from '../../core/search/index-freshness.js';
import http from 'node:http';
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

// The configuration fingerprint a process rooted in a checkout gives a complete index: the
// one its maintainer compares (baseline-readiness.mjs). Taken from such a process, not from
// this one, whose project root is the repository under test.
let fingerprint = null;
function currentFingerprint(root) {
  if (fingerprint) return fingerprint;
  const url = (rel) => JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, '../../core', rel)).href);
  const script = `const [{ applyPersistedLiModel }, { buildConfigFingerprint }] = await Promise.all([import(${url('infrastructure/init-config.js')}), import(${url('indexing/config-fingerprint.js')})]);`
    + 'applyPersistedLiModel(process.env.SWEET_SEARCH_PROJECT_ROOT); process.stdout.write("\\n" + JSON.stringify(buildConfigFingerprint()));';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: root }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  fingerprint = JSON.parse(out.trim().split('\n').pop());
  return fingerprint;
}

/** The head of merkle-state.json: what marks a full build as complete, with its format. */
function writeMerkleHead(state, overrides = {}) {
  fs.writeFileSync(path.join(state, 'merkle-state.json'),
    JSON.stringify({ version: currentFingerprint(main).version, config_fingerprint: { ...currentFingerprint(main), ...overrides }, lastIndex: '2020-01-01T00:00:00.000Z' }));
}

/** A complete main index whose file records describe the main checkout's files exactly. */
function makeMainIndex() {
  const state = path.join(main, '.sweet-search');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'codebase.db'), 'index');
  writeMerkleHead(state);
  fs.mkdirSync(path.join(state, 'codebase-late-interaction.db.segments'));
  fs.writeFileSync(path.join(state, 'codebase-late-interaction.db.segments', 'segment-1.bin'), 'seg');
  // Runtime files: none may reach the worktree's index.
  fs.writeFileSync(path.join(state, 'index-maintainer.lock'), JSON.stringify({ pid: 99999999 }));
  fs.writeFileSync(path.join(state, 'index-maintainer-queue.jsonl'), '{"file_path":"a.js"}\n');
  fs.writeFileSync(path.join(state, 'index-maintainer.log'), 'log');
  fs.writeFileSync(path.join(state, 'daemon.log'), 'log');
  fs.writeFileSync(path.join(state, 'worktree-stamp.json'), JSON.stringify({ projectRoot: main }));
  fs.writeFileSync(path.join(state, 'reconcile-manifest.json'), JSON.stringify({ epoch: 3, publishedAt: '2020-01-01T00:00:00.000Z' }));
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
    // Dated as of the newest unchanged worktree file, so unchanged files do not read as
    // stale; the edited b.js is newer still.
    const published = Date.parse(JSON.parse(fs.readFileSync(path.join(dir, 'reconcile-manifest.json'), 'utf8')).publishedAt);
    const ns = (f) => fs.statSync(path.join(wt, f), { bigint: true }).mtimeNs;
    const newestSame = ns('a.js') > ns('LICENSE') ? ns('a.js') : ns('LICENSE');
    expect(published).toBe(indexDateMs(newestSame, ns('b.js')));
    // Unchanged files read fresh, the changed one stale (freshness: mtimeMs > publishedAt).
    expect(fs.statSync(path.join(wt, 'a.js')).mtimeMs <= published).toBe(true);
    expect(fs.statSync(path.join(wt, 'b.js')).mtimeMs > published).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'reconcile-manifest.json'), 'utf8')).epoch).toBe(3);
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
    // other-123 is not named by this module: never touched.
    expect(gcWorktreeIndexes(worktrees)).toEqual([]);
    git(main, 'worktree', 'remove', '--force', wt);
    expect(fs.existsSync(wt)).toBe(false);
    expect(gcWorktreeIndexes(worktrees)).toEqual([dir]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('acts only inside a .sweet-search/worktrees folder, never on a repository', () => {
    // Review finding (FATAL): the exit clean-up of a main checkout's maintainer ran on the
    // repository root and deleted .git and src.
    const repo = path.join(tmp, 'repo');
    for (const d of ['.git', 'src', 'node_modules']) fs.mkdirSync(path.join(repo, d), { recursive: true });
    const old = new Date(Date.now() - 3600_000);
    for (const d of ['.git', 'src', 'node_modules']) fs.utimesSync(path.join(repo, d), old, old);
    expect(gcWorktreeIndexes(repo)).toEqual([]);
    expect(gcWorktreeIndexes(path.join(tmp, 'elsewhere', 'worktrees'))).toEqual([]);
    for (const d of ['.git', 'src', 'node_modules']) expect(fs.existsSync(path.join(repo, d))).toBe(true);
    // Inside a worktrees folder: an unstamped folder, and one not named by this module, stay.
    const worktrees = path.join(tmp, 'm', '.sweet-search', 'worktrees');
    const unstamped = path.join(worktrees, 'a-0123456789ab');
    const foreign = path.join(worktrees, 'notes');
    fs.mkdirSync(unstamped, { recursive: true });
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'worktree-stamp.json'), JSON.stringify({ projectRoot: path.join(tmp, 'gone') }));
    fs.utimesSync(unstamped, old, old);
    expect(gcWorktreeIndexes(worktrees, { nowMs: Date.now() + 3600_000 })).toEqual([]);
  });

  it('keeps a freshly stamped index whose worktree exists (published, link not made yet)', () => {
    const worktrees = path.join(tmp, 'm', '.sweet-search', 'worktrees');
    const dir = path.join(worktrees, 'wt-0123456789ab');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'worktree-stamp.json'), JSON.stringify({ projectRoot: wt, stampedAt: new Date().toISOString() }));
    expect(gcWorktreeIndexes(worktrees)).toEqual([]);
    expect(gcWorktreeIndexes(worktrees, { nowMs: Date.now() + 3600_000 })).toEqual([dir]);
  });

  it('leaves an index a live maintainer still holds, unless that maintainer is the caller', () => {
    const worktrees = path.join(tmp, 'm', '.sweet-search', 'worktrees');
    const dir = path.join(worktrees, 'x-0123456789ab');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'worktree-stamp.json'), JSON.stringify({ projectRoot: path.join(tmp, 'removed') }));
    fs.writeFileSync(path.join(dir, 'index-maintainer.lock'), JSON.stringify({ pid: process.pid }));
    expect(gcWorktreeIndexes(worktrees)).toEqual([]);
    expect(gcWorktreeIndexes(worktrees, { selfPid: process.pid })).toEqual([dir]);
  });

  it('deletes unfinished bootstrap folders of dead processes only', () => {
    const worktrees = path.join(tmp, 'm', '.sweet-search', 'worktrees');
    const dead = path.join(worktrees, 'x-0123456789ab.bootstrap-99999999');
    const live = path.join(worktrees, `y-0123456789ab.bootstrap-${process.pid}`);
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

// A clone was taken from any main index that had a codebase.db, also one whose build was
// killed half way. And a clone that was not a complete baseline (taken from a main index in
// an older format, or left in the old format by an upgrade) served the worktree for good
// with a dormant maintainer, also after the main index was rebuilt.
// See docs/STATE_MACHINES.md, IX-SM5 and finding IX3.
describe('main index readiness (the clone source must be a finished build)', () => {
  it('judges a state dir as the maintainer of that checkout does', () => {
    const state = makeMainIndex();
    expect(indexReadiness(main, state)).toMatchObject({ ready: true });
    writeMerkleHead(state, { chunkingVersion: -1 });
    expect(indexReadiness(main, state)).toMatchObject({ ready: false, reason: 'config-fingerprint-mismatch' });
    fs.rmSync(path.join(state, 'merkle-state.json'));
    expect(indexReadiness(main, state)).toMatchObject({ ready: false, reason: 'no-merkle-state' });
  });

  it('starts no bootstrap from a main index whose build did not finish', () => {
    const state = makeMainIndex();
    // A full build killed after it swapped codebase.db in: no merkle state, no manifest.
    fs.rmSync(path.join(state, 'merkle-state.json'));
    fs.rmSync(path.join(state, 'reconcile-manifest.json'));
    const r = requestWorktreeIndex({ mainCheckout: main, worktree: wt, env: { ...process.env, SWEET_SEARCH_RECONCILE_V2: '0' } });
    expect(r).toEqual({ started: false, reason: 'main-index-not-ready' });
    expect(bootstrapState(main, wt)).toBe(null);
  });

  it('does not clone a main index whose build did not finish, and tries again later', async () => {
    const state = makeMainIndex();
    fs.rmSync(path.join(state, 'merkle-state.json')); // the build was killed before its last step
    await expect(bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false }))
      .rejects.toMatchObject({ message: expect.stringMatching(/main checkout's index is not ready \(no-merkle-state\)/), retryAfterMs: 120_000 });
    expect(fs.existsSync(path.join(wt, '.sweet-search', 'codebase.db'))).toBe(false);
    // The build is run again and finishes: the next bootstrap clones the index.
    writeMerkleHead(state);
    const r = await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    expect(['clone', 'copy']).toContain(r.mode);
  });

  it('clones a finished main index in an older format, and replaces the clone once the main index is rebuilt', async () => {
    const state = makeMainIndex();
    writeMerkleHead(state, { chunkingVersion: -1 }); // built by an older version: the upgrade asks for a rebuild
    fs.writeFileSync(path.join(state, 'codebase.db'), 'old format index');
    const first = await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    expect(['clone', 'copy']).toContain(first.mode);
    const clone = path.join(wt, '.sweet-search');
    expect(indexReadiness(wt, clone)).toMatchObject({ ready: false, reason: 'config-fingerprint-mismatch' });
    // No replacement while the main index is in the old format too.
    await expect(bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false, replace: true }))
      .rejects.toThrow(/main checkout's index is not ready \(config-fingerprint-mismatch\)/);

    // `sweet-search index` in the main checkout: new format.
    fs.writeFileSync(path.join(state, 'codebase.db'), 'index');
    writeMerkleHead(state);
    const second = await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false, replace: true });
    expect(['clone', 'copy']).toContain(second.mode);
    expect(fs.readFileSync(path.join(clone, 'codebase.db'), 'utf8')).toBe('index');
    expect(indexReadiness(wt, clone)).toMatchObject({ ready: true });
  });
});

describe('a worktree index that is not a complete baseline is replaced', () => {
  const cloneState = () => fs.realpathSync(path.join(wt, '.sweet-search'));
  // The index marker as a tool call would read it. Empty while a replacement is between
  // removing the old folder and publishing the new one (the split roots serve then).
  const cloneText = () => {
    try { return fs.readFileSync(path.join(wt, '.sweet-search', 'codebase.db'), 'utf8'); } catch { return ''; }
  };
  const ageStamp = (ms) => {
    const file = path.join(cloneState(), 'worktree-stamp.json');
    const stamp = JSON.parse(fs.readFileSync(file, 'utf8'));
    stamp.stampedAt = new Date(Date.now() - ms).toISOString();
    fs.writeFileSync(file, JSON.stringify(stamp));
  };
  /** The state after: clone taken from an old-format main index, main index then rebuilt. */
  async function staleClone() {
    const state = makeMainIndex();
    await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    writeMerkleHead(cloneState(), { chunkingVersion: -1 });
    fs.writeFileSync(path.join(cloneState(), 'codebase.db'), 'old index');
    return state;
  }

  it('leaves an indexed worktree alone unless a replacement is asked for', async () => {
    await staleClone();
    expect(await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false })).toEqual({ skipped: 'indexed' });
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: wt }).reason).toBe('indexed');
  });

  it('replaces the clone with a clone of the main index that is ready now', async () => {
    await staleClone();
    const before = cloneState();
    const r = await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false, replace: true });
    expect(['clone', 'copy']).toContain(r.mode);
    expect(cloneState()).toBe(before); // the same place, new content
    expect(fs.readFileSync(path.join(cloneState(), 'codebase.db'), 'utf8')).toBe('index');
    expect(indexReadiness(wt, path.join(wt, '.sweet-search'))).toMatchObject({ ready: true });
    // The worktree's own changes are queued again for its maintainer.
    expect(fs.readFileSync(path.join(cloneState(), 'index-maintainer-queue.jsonl'), 'utf8')).toMatch(/b\.js/);
    expect(fs.existsSync(path.join(cloneState(), 'reconcile-pause.json'))).toBe(false);
  });

  it('replaces nothing when the worktree index is ready', async () => {
    makeMainIndex();
    await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    await expect(bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false, replace: true }))
      .rejects.toThrow(/nothing to replace/);
  });

  it('replaces nothing when the main index is not ready either', async () => {
    const state = await staleClone();
    writeMerkleHead(state, { chunkingVersion: -1 });
    await expect(bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false, replace: true }))
      .rejects.toThrow(/main checkout's index is not ready/);
    expect(fs.readFileSync(path.join(cloneState(), 'codebase.db'), 'utf8')).toBe('old index');
  });

  it('replaces nothing when the clone already has the main index\'s baseline', async (ctx) => {
    const state = makeMainIndex();
    const model = currentFingerprint(main).liModel;
    // The verdicts below differ through the persisted model choice; an environment that
    // fixes the model, or switches late interaction off, gives both roots one verdict.
    if (!model || process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL) ctx.skip();
    await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    // A model chosen in the worktree: its own processes now refuse the index, the main
    // checkout's still accept the main index. A new clone would bring the same baseline
    // (and would undo the choice): the index is left alone.
    const choice = JSON.stringify({ runtime: { li: { model: model === 'lateon-code' ? 'lateon-code-edge' : 'lateon-code' } } });
    fs.writeFileSync(path.join(cloneState(), 'config.json'), choice);
    expect(indexReadiness(main, state)).toMatchObject({ ready: true });
    expect(indexReadiness(wt, path.join(wt, '.sweet-search'))).toMatchObject({ ready: false, reason: 'config-fingerprint-mismatch' });
    await expect(bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false, replace: true }))
      .rejects.toMatchObject({ message: expect.stringMatching(/nothing to replace it with/), retryAfterMs: 6 * 3600_000 });
    expect(fs.readFileSync(path.join(cloneState(), 'config.json'), 'utf8')).toBe(choice);
  });

  it('asks for a replacement at most once per period, and never for a state dir of the worktree\'s own', async () => {
    await staleClone();
    const env = { ...process.env, SWEET_SEARCH_RECONCILE_V2: '0' };
    // Just cloned: a replacement would be a loop.
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: wt, env, replace: true }).reason).toBe('replaced-recently');
    ageStamp(11 * 60_000);
    const r = requestWorktreeIndex({ mainCheckout: main, worktree: wt, env, replace: true });
    expect(r.started).toBe(true);
    const deadline = Date.now() + 20_000;
    while (cloneText() !== 'index' && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(cloneText()).toBe('index');

    // A real folder (an index the user built in the worktree) is never replaced.
    const own = path.join(tmp, 'own');
    git(main, 'worktree', 'add', '-q', own, '-b', 'own');
    fs.mkdirSync(path.join(own, '.sweet-search'));
    fs.writeFileSync(path.join(own, '.sweet-search', 'codebase.db'), 'mine');
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: own, env, replace: true }).reason).toBe('own-state-dir');
  }, 40_000);

  it('the maintainer of a linked worktree index knows its main checkout and worktree', async () => {
    makeMainIndex();
    await bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false });
    expect(linkedWorktreeCloneOf({ projectRoot: wt, stateDirPath: path.join(wt, '.sweet-search'), stateDir: cloneState() }))
      .toEqual({ mainCheckout: main, worktree: wt });
    // The main checkout's own index, and any index that is a real folder, is not a clone.
    const mainState = path.join(main, '.sweet-search');
    expect(linkedWorktreeCloneOf({ projectRoot: main, stateDirPath: mainState, stateDir: mainState })).toBe(null);
  });

  it('a dormant maintainer of a linked worktree index asks for the new clone and gets it', async () => {
    await staleClone();
    ageStamp(11 * 60_000);
    const ctx = { projectRoot: wt, stateDirPath: path.join(wt, '.sweet-search'), stateDir: cloneState() };
    const mainState = path.join(main, '.sweet-search');
    // The background process inherits this: it must not start a real maintainer here.
    const before = process.env.SWEET_SEARCH_RECONCILE_V2;
    process.env.SWEET_SEARCH_RECONCILE_V2 = '0';
    try {
      // The main checkout's own maintainer never asks.
      expect(await requestCloneReplacement({ projectRoot: main, stateDirPath: mainState, stateDir: mainState })).toBe(null);
      const r = await requestCloneReplacement(ctx);
      expect(r).toMatchObject({ started: true });
      // Asked once per period: the next dormant tick starts nothing.
      expect(await requestCloneReplacement(ctx)).toBe(null);
      const deadline = Date.now() + 20_000;
      while (cloneText() !== 'index' && Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 100));
      }
      expect(cloneText()).toBe('index');
    } finally {
      if (before === undefined) delete process.env.SWEET_SEARCH_RECONCILE_V2; else process.env.SWEET_SEARCH_RECONCILE_V2 = before;
    }
  }, 40_000);
});

describe('review fixes', () => {
  it('clones index entries only: no runtime files, legacy artifacts or unknown folders', () => {
    expect(isClonedEntry('codebase.db', false)).toBe(true);
    expect(isClonedEntry('codebase-late-interaction.db.segments', true)).toBe(true);
    expect(isClonedEntry('codebase-sparse-grams.idx.deltas', true)).toBe(true);
    expect(isClonedEntry('grammars', true)).toBe(true);
    expect(isClonedEntry('benchmarks', true)).toBe(false);
    expect(isClonedEntry('readers', true)).toBe(false);
    expect(isClonedEntry('codebase-hnsw.usearch', false)).toBe(false);
    expect(isClonedEntry('index-maintainer.lock', false)).toBe(false);
  });

  it('dates the clone at or after every unchanged file and before every changed one', () => {
    // Fractional milliseconds round up (a truncated date left the newest unchanged file stale).
    expect(indexDateMs(1_000_750_000n, null)).toBe(1001);
    // A changed file older than the newest unchanged one wins: it must read stale.
    expect(indexDateMs(5_000_000_000n, 2_000_500_000n)).toBe(2000);
    expect(indexDateMs(5_000_000_000n, 2_000_000_000n)).toBe(1999);
    expect(indexDateMs(0n, 3_000_000_000n)).toBe(2999);
    expect(indexDateMs(0n, null)).toBe(0);
  });

  it('creates claim files whole or not at all', () => {
    const f = path.join(tmp, 'claim.json');
    expect(createExclusive(f, '{"pid":1}')).toBe(true);
    expect(createExclusive(f, '{"pid":2}')).toBe(false);
    expect(fs.readFileSync(f, 'utf8')).toBe('{"pid":1}');
    expect(fs.readdirSync(tmp).filter((n) => n.startsWith('claim.json.'))).toEqual([]);
  });

  it('an index run waits for a live clone\'s pause, and a clone sees a pause it does not own', async () => {
    const state = path.join(tmp, 'state');
    fs.mkdirSync(state);
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(state, 'reconcile-pause.json'), JSON.stringify({ paused: true, holderPid: holder.pid, reason: 'clone' }));
      const t0 = Date.now();
      const waited = await holdMaintainerForIndexRun(state, { waitForHolderMs: 400 });
      expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
      expect(waited.ours).toBe(false);
      waited();
      // The clone's pause is still there: a hold that does not own it never removes it.
      expect(JSON.parse(fs.readFileSync(path.join(state, 'reconcile-pause.json'), 'utf8')).holderPid).toBe(holder.pid);
      holder.kill('SIGKILL');
      await new Promise((r) => holder.once('exit', r));
      const mine = await holdMaintainerForIndexRun(state, { waitForHolderMs: 400 });
      expect(mine.ours).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(state, 'reconcile-pause.json'), 'utf8')).holderPid).toBe(process.pid);
      mine();
      expect(fs.existsSync(path.join(state, 'reconcile-pause.json'))).toBe(false);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('a frozen index pause (no holder process) is respected but not owned', async () => {
    const state = path.join(tmp, 'state');
    fs.mkdirSync(state);
    fs.writeFileSync(path.join(state, 'reconcile-pause.json'), JSON.stringify({ paused: true, reason: 'frozen' }));
    const r = await holdMaintainerForIndexRun(state, { waitForHolderMs: 100 });
    expect(r.ours).toBe(false);
    r();
    expect(fs.existsSync(path.join(state, 'reconcile-pause.json'))).toBe(true);
  });

  it('the bootstrap refuses while a full index run holds the main index', async () => {
    const state = makeMainIndex();
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(state, 'reconcile-pause.json'), JSON.stringify({ paused: true, holderPid: holder.pid }));
      await expect(bootstrapWorktreeIndex({ mainCheckout: main, worktree: wt, launch: false })).rejects.toThrow(/paused/);
      expect(fs.existsSync(path.join(wt, '.sweet-search'))).toBe(false);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('only a missing entry counts as a removed checkout', () => {
    expect(stateDirGone(path.join(tmp, 'nope'), main)).toBe(true);
    expect(stateDirGone(main, path.join(tmp, 'nope'))).toBe(true);
    expect(stateDirGone(main, main)).toBe(false);
  });

  it('does not start a bootstrap for a worktree with a state dir of its own', () => {
    makeMainIndex();
    fs.mkdirSync(path.join(wt, '.sweet-search'));
    expect(requestWorktreeIndex({ mainCheckout: main, worktree: wt }).reason).toBe('own-state-dir');
  });

  it('asks an earlier daemon of the worktree path to stop over its socket, never the main checkout\'s', async () => {
    makeMainIndex();
    // A worktree nested in its main checkout, as Claude Code makes them.
    const nested = path.join(main, '.claude', 'worktrees', 'n1');
    git(main, 'worktree', 'add', '-q', nested, '-b', 'nested');
    // The socket the nested worktree's own daemon listens on once it has an index.
    fs.mkdirSync(path.join(tmp, 'probe', '.sweet-search'), { recursive: true });
    fs.symlinkSync(path.join(tmp, 'probe', '.sweet-search'), path.join(nested, '.sweet-search'));
    const nestedSock = projectSocketPath({ SWEET_SEARCH_PROJECT_ROOT: nested }, nested);
    fs.unlinkSync(path.join(nested, '.sweet-search'));
    const mainSock = projectSocketPath({ SWEET_SEARCH_PROJECT_ROOT: main }, main);
    expect(nestedSock).not.toBe(mainSock);
    const got = { main: [], nested: [] };
    const daemon = (sock, key) => new Promise((resolve) => {
      fs.rmSync(sock, { force: true });
      const srv = http.createServer((req, res) => { got[key].push(req.url); res.end('ok'); });
      srv.listen(sock, () => resolve(srv));
    });
    const servers = [await daemon(mainSock, 'main'), await daemon(nestedSock, 'nested')];
    try {
      await bootstrapWorktreeIndex({ mainCheckout: main, worktree: nested, launch: false });
      expect(got.nested).toEqual(['/stop']);
      expect(got.main).toEqual([]);
    } finally {
      for (const srv of servers) await new Promise((r) => srv.close(r));
    }
  });

  it('removes a stale claim only as the version it judged', () => {
    const f = path.join(tmp, 'lock.json');
    fs.writeFileSync(f, '{"pid":99999999}');
    removeIfStale(f, (text) => JSON.parse(text).pid === 99999999);
    expect(fs.existsSync(f)).toBe(false);
    // A live version (replaced meanwhile) is put back, not deleted.
    fs.writeFileSync(f, `{"pid":${process.pid}}`);
    removeIfStale(f, () => false);
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).pid).toBe(process.pid);
    expect(fs.readdirSync(tmp).filter((n) => n.includes('.stale'))).toEqual([]);
  });

  it('copies without copy-on-write only up to the size limit', () => {
    const state = makeMainIndex();
    const dst = path.join(tmp, 'plain');
    expect(() => cloneIndexDir(state, dst, { platform: 'win32', env: { SWEET_SEARCH_WORKTREE_COPY_MAX_MB: '0' } }))
      .toThrow(/plain-copy limit/);
    expect(cloneIndexDir(state, dst, { platform: 'win32', env: {} })).toBe('copy');
    expect(fs.existsSync(path.join(dst, 'codebase.db'))).toBe(true);
    expect(plainCopyMaxBytes({})).toBe(1024 * 1024 * 1024);
  });

  it('an index run blocked past its wait gets blockedBy and leaves no temp file', async () => {
    const state = path.join(tmp, 'state2');
    fs.mkdirSync(state);
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(path.join(state, 'reconcile-pause.json'), JSON.stringify({ paused: true, holderPid: holder.pid, reason: 'clone' }));
      let waited = null;
      const r = await holdMaintainerForIndexRun(state, { waitForHolderMs: 300, onWait: (w) => { waited = w; } });
      expect(r.ours).toBe(false);
      expect(r.blockedBy).toEqual({ pid: holder.pid, reason: 'clone' });
      expect(waited).toEqual({ pid: holder.pid, reason: 'clone' });
      expect(fs.readdirSync(state).sort()).toEqual(['reconcile-pause.json']);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('lists the files still queued for the maintainer', () => {
    const state = path.join(tmp, 'state3');
    fs.mkdirSync(state);
    expect(pendingReindexFiles(state).size).toBe(0);
    fs.writeFileSync(path.join(state, 'index-maintainer-queue.jsonl'), '{"file_path":"a.js"}\n{"file_path":"./b/c.js"}\n{"bad');
    fs.writeFileSync(path.join(state, 'index-maintainer-queue.processing.jsonl'), '{"file_path":"d.js"}\n');
    expect([...pendingReindexFiles(state)].sort()).toEqual(['a.js', 'b/c.js', 'd.js']);
  });

  it('the MCP wait gives up within its bound and reports no index when switched off', async () => {
    makeMainIndex();
    const t0 = Date.now();
    expect(await ensureWorktreeIndex({ mainCheckout: main, worktree: wt, env: { SWEET_SEARCH_WORKTREE_INDEX: '0' }, waitMs: 500 })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
