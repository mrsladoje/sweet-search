import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { generateRegexMatches } from '../../core/search/search-pattern-planner.js';
import { bareGrep } from '../../core/search/search-pattern.js';
import { discoverGrepCorpus } from '../../core/indexing/grep-corpus.js';
import { isSymlinkedRelUnder } from '../../core/indexing/admission-policy.js';
import {
  buildSparseGramIndexArtifact, hasNativeSparseGramSupport, loadSparseGramIndex,
} from '../../core/infrastructure/native-sparse-gram.js';

// GRDB's layout: `Tests/CustomSQLite/GRDB -> ../..` is a git-tracked symlink back to the root,
// so every file is reachable under unbounded `Tests/CustomSQLite/GRDB/…` prefixes.
const LOOP = 'Tests/CustomSQLite/GRDB';
const REAL_FILES = {
  'GRDB/QueryInterface/SQL/Table.swift': 'struct Table {\n  func hasMany() {}\n}\n',
  'GRDB/Record/Association.swift': 'func hasMany(_ x: Int) -> Int { x }\n',
  'Tests/CustomSQLite/CustomSQLite/sqlite3.h': '/* hasMany is not here */\n',
};

function makeLoopRepo() {
  const root = mkdtempSync(join(tmpdir(), 'ss-grep-symlink-loop-'));
  for (const [rel, content] of Object.entries(REAL_FILES)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  symlinkSync('../..', join(root, LOOP));
  return root;
}

// What an index built before the no-follow rule held: every real file again under one and
// two loop levels.
function staleIndexFiles() {
  const real = Object.keys(REAL_FILES);
  return [...real, ...real.map((f) => `${LOOP}/${f}`), ...real.map((f) => `${LOOP}/${LOOP}/${f}`)];
}

describe('isSymlinkedRelUnder', () => {
  let root;
  beforeAll(() => { root = makeLoopRepo(); });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('is true for the link and every path through it, false for real paths', () => {
    expect(isSymlinkedRelUnder(root, LOOP)).toBe(true);
    expect(isSymlinkedRelUnder(root, `${LOOP}/GRDB/Record/Association.swift`)).toBe(true);
    expect(isSymlinkedRelUnder(root, 'GRDB/Record/Association.swift')).toBe(false);
    expect(isSymlinkedRelUnder(root, 'Tests/CustomSQLite/CustomSQLite/sqlite3.h')).toBe(false);
  });

  it('shares directory verdicts through the memo', () => {
    const memo = new Map();
    isSymlinkedRelUnder(root, `${LOOP}/GRDB/Record/Association.swift`, memo);
    expect(memo.get(LOOP)).toBe(true);
    expect(memo.get('Tests')).toBe(false);
  });
});

describe('a fresh grep corpus never lists loop paths', () => {
  let root;
  beforeAll(() => {
    root = makeLoopRepo();
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('holds each real file once and not the symlink', async () => {
    const corpus = await discoverGrepCorpus([], { projectRoot: root });
    expect(corpus.source).toBe('git');
    expect(corpus.files.sort()).toEqual(Object.keys(REAL_FILES).sort());
  });
});

describe.runIf(hasNativeSparseGramSupport())('grep over an index that still holds loop paths', () => {
  let root;
  let searcher;

  beforeAll(() => {
    root = makeLoopRepo();
    const indexPath = join(root, 'sparse.idx');
    buildSparseGramIndexArtifact({ projectRoot: root, files: staleIndexFiles(), outputPath: indexPath });
    searcher = { sparseGramIndex: loadSparseGramIndex(indexPath), sparseGramIndexPath: indexPath, projectRoot: root };
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const realHits = ['GRDB/QueryInterface/SQL/Table.swift', 'GRDB/Record/Association.swift'];

  it('the stale index really holds the loop copies', () => {
    expect(searcher.sparseGramIndex.getAllFiles().filter((f) => f.startsWith(`${LOOP}/`))).toHaveLength(6);
  });

  it('keeps only real paths on the gram-narrowed regex path', async () => {
    const result = await generateRegexMatches(searcher, 'hasMany\\(', root, {});
    expect(result.matchingFiles.sort()).toEqual(realHits);
    expect(result.indexedMatches.map((m) => m.file).sort()).toEqual(realHits);
    expect(result.stats.symlinkAliasMatchesDropped).toBe(4);
  });

  it('keeps only real paths on the fixed-string path', async () => {
    const result = await generateRegexMatches(searcher, 'func hasMany', root, { fixedString: true });
    expect([...new Set(result.indexedMatches.map((m) => m.file))].sort()).toEqual(realHits);
  });

  it('ss-grep (bareGrep) counts and returns only real paths', async () => {
    const out = await bareGrep.call(searcher, 'hasMany', null, { projectRoot: root });
    const files = [...new Set(out.results.map((r) => r.file || r.filePath))].sort();
    expect(files).toEqual([...realHits, 'Tests/CustomSQLite/CustomSQLite/sqlite3.h'].sort());
    expect(out.results.every((r) => !String(r.file || r.filePath).startsWith(`${LOOP}/`))).toBe(true);
  });
});
