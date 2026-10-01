/**
 * Admission rule 5: the indexer does not follow symlinks.
 *
 * The defect: full discovery used fast-glob's default `followSymbolicLinks: true`. GRDB
 * tracks `Tests/CustomSQLite/GRDB -> ../..`, a loop back to the repo root, so 19,264 of
 * 19,866 indexed files were copies (34 levels deep) and every ss-grep hit came back ~33
 * times. git, ripgrep and `grep -r` all treat a symlink as a link, not as a directory to
 * walk; the indexer now does the same, on every path that admits files:
 *   - full discovery (no-follow walk + no symlinked git re-admission),
 *   - the incremental producer (dirty-scan's lstat-based walk),
 *   - the incremental consumer (readDirtySet retires symlinked paths and queues the real
 *     file when an edit arrives through a symlink),
 *   - the not-indexed note (names the real path instead of "not seen yet").
 * The parity test locks the invariant that full and incremental admit the same set.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createAdmissionPolicy } from '../../core/indexing/admission-policy.js';
import { discoverFiles } from '../../core/indexing/indexer-utils.js';
import { scanDirtyAndEnqueue } from '../../core/incremental-indexing/application/dirty-scan.mjs';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { createIndexCoverage, semanticTargetFor } from '../../core/search/index-coverage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let sandbox;   // holds the project root and an "outside" sibling dir
let root;

function write(rel, content = 'x', base = root) {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function link(target, rel) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.symlinkSync(target, abs);
}
function git(...args) { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); }
function gitCommitAll() {
  git('add', '-A');
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: root, stdio: 'ignore' });
}

/**
 * Every symlink shape seen in the bench repos, plus the two that must never leak in:
 *   Tests/Custom/LOOP -> ../..              GRDB-style loop back to the root
 *   cli/docs -> ../docs                      jj-style second path to a sibling dir
 *   pkg/fake/src -> ../../python             uv-style deep sibling link
 *   docs/schema.json -> ../cli/schema.json   jj-style file symlink
 *   src/ext -> <outside>/lib                 directory outside the project root
 *   src/broken.js -> nowhere.js              broken link
 */
function buildFixture() {
  write('src/a.js', 'export const a = 1;\n');
  write('docs/guide.md', '# guide\n');
  write('python/mod.py', 'def f():\n    return 1\n');
  write('cli/schema.json', '{"a":1}\n');
  write('lib/o.js', 'export const o = 1;\n', path.join(sandbox, 'outside'));
  link('../..', 'Tests/Custom/LOOP');
  link('../docs', 'cli/docs');
  link('../../python', 'pkg/fake/src');
  link('../cli/schema.json', 'docs/schema.json');
  link(path.join(sandbox, 'outside', 'lib'), 'src/ext');
  link('nowhere.js', 'src/broken.js');
}
const REAL_FILES = ['cli/schema.json', 'docs/guide.md', 'python/mod.py', 'src/a.js'];

beforeEach(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-symlink-')));
  root = path.join(sandbox, 'repo');
  fs.mkdirSync(root);
});
afterEach(() => { try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('admission policy / symlink predicates', () => {
  it('isSymlinkedRel flags a symlink leaf and anything under a symlinked dir, nothing else', () => {
    buildFixture();
    const p = createAdmissionPolicy({ projectRoot: root });
    const memo = new Map();
    expect(p.isSymlinkedRel('src/a.js', memo)).toBe(false);
    expect(p.isSymlinkedRel('docs/schema.json', memo)).toBe(true);            // file symlink
    expect(p.isSymlinkedRel('cli/docs/guide.md', memo)).toBe(true);           // under dir symlink
    expect(p.isSymlinkedRel('Tests/Custom/LOOP/src/a.js', memo)).toBe(true);  // loop
    expect(p.isSymlinkedRel('src/ext/o.js', memo)).toBe(true);                // outside root
    expect(p.isSymlinkedRel('src/broken.js', memo)).toBe(true);               // broken link is still a link
    expect(p.isSymlinkedRel('src/missing/x.js', memo)).toBe(false);           // missing ≠ symlink
    expect(p.isSymlinkedRel('', memo)).toBe(false);
  });

  it('a project root reached through a symlink is not itself treated as a symlink', async () => {
    write('src/a.js');
    const viaLink = path.join(sandbox, 'repo-link');
    fs.symlinkSync(root, viaLink);
    const p = createAdmissionPolicy({ projectRoot: viaLink });
    expect(p.isSymlinkedRel('src/a.js')).toBe(false);
    expect(p.realRelInsideRoot('src/a.js')).toBe('src/a.js');
    // Bench harnesses and worktrees often reach a repo through a symlinked path.
    expect(await discoverFiles({ projectRoot: viaLink, silent: true })).toEqual(['src/a.js']);
  });

  it('realRelInsideRoot maps to the real path inside the root, else null', () => {
    buildFixture();
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.realRelInsideRoot('cli/docs/guide.md')).toBe('docs/guide.md');
    expect(p.realRelInsideRoot('Tests/Custom/LOOP/src/a.js')).toBe('src/a.js');
    expect(p.realRelInsideRoot('docs/schema.json')).toBe('cli/schema.json');
    expect(p.realRelInsideRoot('src/ext/o.js')).toBe(null);    // outside the project
    expect(p.realRelInsideRoot('src/broken.js')).toBe(null);   // broken
  });

  it('realRelInsideRoot keeps a real directory whose name starts with ".." inside the root', () => {
    write('..gen/z.js', 'export const z = 1;\n');
    link('../..gen/z.js', 'src/zlink.js');
    const p = createAdmissionPolicy({ projectRoot: root });
    expect(p.realRelInsideRoot('src/zlink.js')).toBe('..gen/z.js');
  });
});

describe('full discovery does not follow symlinks', () => {
  it('admits only the real files of a fixture with every symlink shape', async () => {
    buildFixture();
    const files = (await discoverFiles({ projectRoot: root, silent: true })).sort();
    expect(files).toEqual(REAL_FILES);
  });

  it('git re-admission skips a tracked symlink under a build-output dir', async () => {
    write('src/build/real.jam', 'rule feature { }');
    link('real.jam', 'src/build/alias.jam');                 // tracked as mode 120000
    write('.gitignore', '/build/\n');
    git('init');
    gitCommitAll();
    const files = new Set(await discoverFiles({ projectRoot: root, silent: true }));
    expect(files.has('src/build/real.jam')).toBe(true);
    expect(files.has('src/build/alias.jam')).toBe(false);
  });
});

describe('full and incremental admission agree on symlinks', () => {
  it('dirty-scan (empty baseline) enqueues exactly the files full discovery admits', async () => {
    buildFixture();
    git('init');
    gitCommitAll();
    const stateDir = path.join(sandbox, 'state');
    fs.mkdirSync(stateDir);
    const full = (await discoverFiles({ projectRoot: root, silent: true })).sort();
    const res = await scanDirtyAndEnqueue({ projectRoot: root, stateDir });
    expect([...res.files].sort()).toEqual(full);
    expect(full).toEqual(REAL_FILES);
  });
});

// ── consumer: the reconcile tick ──────────────────────────────────────────────
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

describe('reconciler consumer applies rule 5', () => {
  let stateDir;
  beforeEach(() => {
    stateDir = path.join(root, '.sweet-search');
    fs.mkdirSync(stateDir, { recursive: true });
  });
  const enqueue = (...rels) => fs.appendFileSync(
    path.join(stateDir, 'index-maintainer-queue.jsonl'),
    rels.map((r) => `${JSON.stringify({ file_path: r })}\n`).join(''),
  );
  const tick = () => runProductionReconcileTick({
    projectRoot: root, stateDir, vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
    logger: silentLogger, config: { filesPerTick: 20, cpuBudgetMs: 10_000 },
  });
  const liveRows = (file) => {
    const db = new Database(path.join(stateDir, 'codebase.db'));
    try { return db.prepare('SELECT id FROM vectors WHERE file_path = ? AND epoch_retired IS NULL').all(file); }
    finally { db.close(); }
  };
  const merkle = () => {
    try { return JSON.parse(fs.readFileSync(path.join(stateDir, 'merkle-state.json'), 'utf-8')).files || {}; }
    catch { return {}; }
  };

  it('an edit queued through a symlinked dir indexes the real file, never the link path', async () => {
    write('lib/a.js', 'export function alpha(x) { return x + 1; }\n');
    link('../lib', 'src/link');
    enqueue('src/link/a.js');
    await tick();
    expect(liveRows('lib/a.js').length).toBeGreaterThan(0);
    expect(liveRows('src/link/a.js').length).toBe(0);
    expect(merkle()['src/link/a.js']).toBeUndefined();
  });

  it('a queued file symlink or outside-root link is never indexed', async () => {
    write('src/a.js', 'export function alpha(x) { return x + 1; }\n');
    write('lib/o.js', 'export const o = 1;\n', path.join(sandbox, 'outside'));
    link('a.js', 'src/alias.js');
    link(path.join(sandbox, 'outside', 'lib'), 'src/ext');
    enqueue('src/alias.js', 'src/ext/o.js');
    await tick();
    expect(liveRows('src/alias.js').length).toBe(0);
    expect(liveRows('src/ext/o.js').length).toBe(0);
    expect(liveRows('src/a.js').length).toBeGreaterThan(0);   // the real target, via the alias edit
  });

  it('retires a previously indexed path once it runs through a symlink', async () => {
    // An index built before the fix holds the path; model it as a real file that is
    // later replaced by a symlinked directory (same path, now a second path to docs/).
    write('docs/guide.md', '# guide\nsome text about the guide\n');
    write('cli/docs/guide.md', '# guide\nsome text about the guide\n');
    enqueue('docs/guide.md', 'cli/docs/guide.md');
    await tick();
    expect(liveRows('cli/docs/guide.md').length).toBeGreaterThan(0);

    fs.rmSync(path.join(root, 'cli/docs'), { recursive: true });
    link('../docs', 'cli/docs');
    const res = await scanDirtyAndEnqueue({ projectRoot: root, stateDir });
    expect(res.files).toContain('cli/docs/guide.md');          // producer: merkle-known, not walked
    await tick();
    expect(liveRows('cli/docs/guide.md').length).toBe(0);      // consumer: retired
    expect(merkle()['cli/docs/guide.md']).toBeUndefined();
    expect(liveRows('docs/guide.md').length).toBeGreaterThan(0);
  });
});

describe('not-indexed note for a symlinked path', () => {
  function makeIndex(indexedPaths) {
    fs.mkdirSync(path.join(root, '.sweet-search'), { recursive: true });
    const db = new Database(path.join(root, '.sweet-search', 'codebase.db'));
    db.exec(`CREATE TABLE vectors (
      id TEXT PRIMARY KEY, file_path TEXT NOT NULL, embedding BLOB NOT NULL,
      text TEXT, metadata TEXT, session_id TEXT, tags TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, epoch_retired INTEGER)`);
    const ins = db.prepare('INSERT INTO vectors (id, file_path, embedding) VALUES (?, ?, ?)');
    indexedPaths.forEach((p, i) => ins.run(String(i), p, Buffer.alloc(1)));
    db.close();
  }

  it('names the real path, and is not an "excluded" refusal (ss-read may still read it)', async () => {
    buildFixture();
    makeIndex(REAL_FILES);
    const cov = await createIndexCoverage({ projectRoot: root });
    const file = await cov.notIndexedNote('cli/docs/guide.md');
    expect(file.kind).toBe('symlink');
    expect(file.text).toContain('docs/guide.md');
    const dir = await cov.notIndexedNote('Tests/Custom/LOOP');
    expect(dir.kind).toBe('symlink');
    expect(dir.isDir).toBe(true);
    const outside = await cov.notIndexedNote('src/ext/o.js');
    expect(outside.kind).toBe('symlink');
    expect(outside.text).toMatch(/outside this project/);
    expect(await cov.notIndexedNote('src/a.js')).toBe(null);   // indexed real file: no note
    cov.close();
  });

  it('carries the real path, and ss-semantic answers from it or refuses (never a whole-file span)', async () => {
    buildFixture();
    makeIndex(REAL_FILES);
    const cov = await createIndexCoverage({ projectRoot: root });
    const inside = await cov.notIndexedNote('cli/docs/guide.md');
    expect(inside.realPath).toBe('docs/guide.md');
    expect(semanticTargetFor('cli/docs/guide.md', inside)).toEqual({ file: 'docs/guide.md', refuse: false, redirected: true });
    const outside = await cov.notIndexedNote('src/ext/o.js');
    expect(outside.realPath).toBe(null);
    expect(semanticTargetFor('src/ext/o.js', outside)).toEqual({ file: 'src/ext/o.js', refuse: true, redirected: false });
    // Unchanged behaviour for the other kinds.
    expect(semanticTargetFor('src/a.js', null).refuse).toBe(false);
    expect(semanticTargetFor('dist/x.js', { kind: 'excluded', isDir: false }).refuse).toBe(true);
    expect(semanticTargetFor('src/new.js', { kind: 'stale', isDir: false }).refuse).toBe(false);
    cov.close();
  });

  it('ss-semantic on a symlink that leads outside the project exits 1 with the link note', () => {
    buildFixture();
    makeIndex(REAL_FILES);
    const helpers = path.resolve(__dirname, '../../eval/agent-read-workflows/bin/_ss-helpers.mjs');
    const res = spawnSync(process.execPath, [helpers, 'semantic', 'src/ext/o.js', 'what is o'], {
      cwd: root, encoding: 'utf-8', timeout: 30_000,
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: root },
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/does not follow this link/);
    expect(res.stdout).toBe('');
  });
});
