import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { applyUnindexedFallback } from '../../core/search/grep-unindexed-fallback.js';
import { _resetChangedGrepFilesCache } from '../../core/indexing/grep-corpus.js';

function write(root, rel, content) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

const passThrough = (result) => [...(result.indexedMatches || []), ...(result.overlayMatches || [])];

function fakeIndex(files) {
  return { getAllFiles: () => files };
}

describe('applyUnindexedFallback', () => {
  let root;

  beforeEach(() => {
    _resetChangedGrepFilesCache();
    root = mkdtempSync(join(tmpdir(), 'ss-grep-fallback-'));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 't');
    write(root, 'src/clean.go', 'func Clean() {}\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function run(extra = {}) {
    return applyUnindexedFallback({
      searcher: {
        sparseGramIndex: fakeIndex(['src/clean.go']),
        sparseGramIndexPath: join(root, 'absent-sparse.idx'),
      },
      regex: 'IsPrecert',
      searchDir: root,
      options: {},
      matches: [],
      shapeResult: passThrough,
      ...extra,
    });
  }

  it('does nothing when the indexed search found matches', async () => {
    const found = [{ file: 'src/clean.go', line: 1 }];
    const out = await run({ matches: found });
    expect(out.matches).toBe(found);
    expect(out.stats).toBeNull();
  });

  it('greps an untracked file the index does not hold', async () => {
    write(root, 'vendor/x509/x509.go', 'package x509\nfunc (c *Certificate) IsPrecert() bool\n');
    const out = await run();
    expect(out.matches).toEqual([expect.objectContaining({ file: 'vendor/x509/x509.go', line: 2 })]);
    expect(out.stats).toMatchObject({ unindexedFallbackFiles: 1, unindexedFallbackMatches: 1 });
  });

  it('greps a modified tracked file whose grams may be stale', async () => {
    write(root, 'src/clean.go', 'func Clean() {}\nfunc IsPrecert() {}\n');
    const out = await run();
    expect(out.matches).toEqual([expect.objectContaining({ file: 'src/clean.go', line: 2 })]);
  });

  it('never re-searches clean files', async () => {
    const out = await run({ regex: 'Clean' });
    expect(out.matches).toEqual([]);
    expect(out.stats.unindexedFallbackFiles).toBe(0);
  });

  it('only greps changed files inside an --in scope', async () => {
    write(root, 'vendor/x509/x509.go', 'func IsPrecert() bool\n');
    write(root, 'other/x.go', 'func IsPrecert() bool\n');
    const out = await run({ options: { fileFilter: 'other' } });
    expect(out.matches.map((m) => m.file)).toEqual(['other/x.go']);
    expect(out.stats.unindexedFallbackFiles).toBe(1);
  });

  it('searches fixed strings literally', async () => {
    write(root, 'notes.txt', 'a.b(c)\n');
    const out = await run({ regex: 'a.b(c)', options: { fixedString: true } });
    expect(out.matches).toEqual([expect.objectContaining({ file: 'notes.txt', line: 1 })]);
  });

  it('can be switched off', async () => {
    write(root, 'vendor/x509/x509.go', 'func IsPrecert() bool\n');
    const out = await run({ options: { unindexedFallback: false } });
    expect(out.matches).toEqual([]);
    expect(out.stats).toBeNull();
  });

  it('reports whether an explicit --in scope is in the grep index', async () => {
    const covered = await run({ options: { fileFilter: 'src' } });
    expect(covered.stats.scopeInGrepIndex).toBe(true);
    const uncovered = await run({ options: { fileFilter: 'vendor' } });
    expect(uncovered.stats.scopeInGrepIndex).toBe(false);
  });

  it('does not report coverage for the implicit cwd scope', async () => {
    const out = await run({ options: { fileFilter: 'src', _cwdScope: true } });
    expect(out.stats).not.toHaveProperty('scopeInGrepIndex');
  });
});
