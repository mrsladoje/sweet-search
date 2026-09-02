// core/search/index-coverage.js — "is this path in the index, and if not, why?"
//
// The defect: the ss-* wrappers answered that with a PATH predicate (`admitsShape`), but the
// indexer also drops files by CONTENT. A committed bundle is git-tracked, so the path rules
// re-admit it and the minified-shape rule drops it anyway; the path predicate then said
// "admitted" and the wrapper printed a bare `(no matches)`. Asking the index itself cannot
// drift from the indexer, whatever rule did the dropping.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createIndexCoverage, REASONS, looksLikeBundle } from '../../core/search/index-coverage.js';

const require = createRequire(import.meta.url);

let root;

/** A project with a real (tiny) vector database holding exactly the paths named. */
function makeProject(indexedPaths) {
  const dir = mkdtempSync(path.join(tmpdir(), 'idxcov-'));
  mkdirSync(path.join(dir, '.sweet-search'), { recursive: true });
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dir, '.sweet-search', 'codebase.db'));
  db.exec(`CREATE TABLE vectors (
    id TEXT PRIMARY KEY, file_path TEXT NOT NULL, embedding BLOB NOT NULL,
    text TEXT, metadata TEXT, session_id TEXT, tags TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, epoch_retired INTEGER)`);
  const ins = db.prepare('INSERT INTO vectors (id, file_path, embedding, epoch_retired) VALUES (?, ?, ?, ?)');
  for (const [i, p] of indexedPaths.entries()) {
    const retired = p.startsWith('!') ? 7 : null;      // "!path" = a retired row
    ins.run(String(i), retired ? p.slice(1) : p, Buffer.alloc(1), retired);
  }
  db.close();
  return dir;
}

beforeAll(() => { root = null; });
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('index coverage', () => {
  it('answers from the index, not from a path predicate', async () => {
    root = makeProject(['src/a.js', 'src/b.js']);
    writeFileSync(path.join(root, 'src-a.js'), 'x');
    const cov = await createIndexCoverage({ projectRoot: root });
    expect(cov.isIndexed('src/a.js')).toBe(true);
    expect(cov.isIndexed('src/zzz.js')).toBe(false);
    // Leading "./" and backslashes normalise to the same key the indexer wrote.
    expect(cov.isIndexed('./src/a.js')).toBe(true);
    cov.close();
    rmSync(root, { recursive: true, force: true }); root = null;
  });

  it('treats a retired row as not indexed', async () => {
    // A retired row is a file the index USED to hold. It is not searchable now, and
    // counting it as present would put the wrapper straight back to a bare (no matches).
    root = makeProject(['src/live.js', '!src/gone.js']);
    const cov = await createIndexCoverage({ projectRoot: root });
    expect(cov.isIndexed('src/live.js')).toBe(true);
    expect(cov.isIndexed('src/gone.js')).toBe(false);
    cov.close();
    rmSync(root, { recursive: true, force: true }); root = null;
  });

  it('fails OPEN when the index cannot be read', async () => {
    // A hint is never worth breaking a search over: with no database every path reports
    // indexed, and the wrappers behave exactly as they did before this module existed.
    root = mkdtempSync(path.join(tmpdir(), 'idxcov-nodb-'));
    writeFileSync(path.join(root, 'a.js'), 'x');
    const cov = await createIndexCoverage({ projectRoot: root });
    expect(cov.isIndexed('a.js')).toBe(true);
    expect(await cov.notIndexedNote('a.js')).toBeNull();
    cov.close();
    rmSync(root, { recursive: true, force: true }); root = null;
  });

  it('separates an EXCLUDED file from one this index has not seen yet', async () => {
    // The distinction that keeps the note honest. Telling an agent "not indexed, look at
    // the source it was built from" about its own newly written file would be a lie, and
    // it is a measured case: 7 of 1,251 sweet lexical calls on the fresh pool were genuine
    // stale-index zeros on the agent's own code (register E3).
    root = makeProject(['src/known.js']);
    mkdirSync(path.join(root, 'src'), { recursive: true });
    mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(path.join(root, 'src/known.js'), 'export const a = 1;\n');
    writeFileSync(path.join(root, 'src/fresh.js'), 'export const b = 2;\n');
    writeFileSync(path.join(root, 'node_modules/dep/index.js'), 'module.exports = 1;\n');
    const cov = await createIndexCoverage({ projectRoot: root });

    expect(await cov.notIndexedNote('src/known.js')).toBeNull();

    const fresh = await cov.notIndexedNote('src/fresh.js');
    expect(fresh.kind).toBe('stale');
    expect(fresh.text).toMatch(/has not seen it yet/);
    expect(fresh.text).not.toMatch(/built from/);

    const dep = await cov.notIndexedNote('node_modules/dep/index.js');
    expect(dep.kind).toBe('excluded');
    cov.close();
    rmSync(root, { recursive: true, force: true }); root = null;
  });

  it('names a committed bundle by its CONTENT, which the path rules cannot see', async () => {
    // The exact fresh-pool case: `dist/index.js` is git-tracked, so the path rules re-admit
    // it and the content rule drops it. The index says it is absent; the reason comes from
    // the same content shape the indexer used.
    root = makeProject(['src/real.js']);
    mkdirSync(path.join(root, 'dist'), { recursive: true });
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'src/real.js'), 'export const a = 1;\n');
    // One very long line repeated: median line length far above 200, the bundler shape.
    writeFileSync(path.join(root, 'dist/index.js'), `${'a'.repeat(4000)};\n`.repeat(40));
    const cov = await createIndexCoverage({ projectRoot: root });
    const note = await cov.notIndexedNote('dist/index.js');
    expect(note.kind).toBe('excluded');
    expect(note.text).toMatch(/not indexed: dist\/index\.js/);
    cov.close();
    rmSync(root, { recursive: true, force: true }); root = null;
  });

  it('reports a directory only when NOTHING under it is indexed', async () => {
    root = makeProject(['src/deep/a.js']);
    mkdirSync(path.join(root, 'src/deep'), { recursive: true });
    mkdirSync(path.join(root, 'build'), { recursive: true });
    writeFileSync(path.join(root, 'src/deep/a.js'), 'x');
    writeFileSync(path.join(root, 'build/out.js'), 'x');
    const cov = await createIndexCoverage({ projectRoot: root });
    expect(await cov.notIndexedNote('src')).toBeNull();            // has indexed descendants
    expect(await cov.notIndexedNote('src/')).toBeNull();           // trailing slash is the same scope
    const build = await cov.notIndexedNote('build');
    expect(build.isDir).toBe(true);
    expect(build.kind).toBe('excluded');
    // A prefix match must not leak across a sibling: "src" must never match "srcfoo".
    mkdirSync(path.join(root, 'srcfoo'), { recursive: true });
    writeFileSync(path.join(root, 'srcfoo/x.js'), 'x');
    expect(await cov.notIndexedNote('srcfoo')).not.toBeNull();
    cov.close();
    rmSync(root, { recursive: true, force: true }); root = null;
  });

  it('says nothing about a path that does not exist or sits outside the project', async () => {
    root = makeProject(['src/a.js']);
    const cov = await createIndexCoverage({ projectRoot: root });
    expect(await cov.notIndexedNote('nope.js')).toBeNull();
    expect(await cov.notIndexedNote('/etc/hosts')).toBeNull();
    expect(await cov.notIndexedNote('')).toBeNull();
    cov.close();
    rmSync(root, { recursive: true, force: true }); root = null;
  });

  it('every reason carries a kind, and only excluded reasons refuse a body', () => {
    for (const [name, r] of Object.entries(REASONS)) {
      expect(['excluded', 'stale'], `${name} kind`).toContain(r.kind);
      expect(r.text.length, `${name} text`).toBeGreaterThan(0);
    }
    expect(REASONS.notYetIndexed.kind).toBe('stale');
    expect(REASONS.minified.kind).toBe('excluded');
  });

  it('looksLikeBundle keys on line shape, never on the path', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'idxcov-shape-'));
    const wide = path.join(dir, 'ordinary-name.js');
    const narrow = path.join(dir, 'dist-index.js');   // bundler-ish NAME, source shape
    writeFileSync(wide, `${'x'.repeat(4000)};\n`.repeat(40));
    writeFileSync(narrow, 'const a = 1;\nconst b = 2;\n'.repeat(500));
    expect(looksLikeBundle(wide)).toBe(true);
    expect(looksLikeBundle(narrow)).toBe(false);
    // A sub-1KB file is never a bundle, however dense.
    const tiny = path.join(dir, 'tiny.js');
    writeFileSync(tiny, `${'x'.repeat(300)};\n`);
    expect(looksLikeBundle(tiny)).toBe(false);
    expect(looksLikeBundle(path.join(dir, 'missing.js'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
