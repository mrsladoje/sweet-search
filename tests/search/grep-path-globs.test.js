/**
 * ss-grep / ss-find `-g` globs (core/search/grep-path-globs.js): ripgrep's override-glob
 * semantics on repo-relative paths, evaluated in JS so the native grep path is kept.
 *
 * The last block cross-checks every case against the real `rg` on a temp tree when rg is
 * installed (skipped otherwise), so a drift from ripgrep shows up as a failing case.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { compilePathGlob, compilePathGlobs, filterMatchesByPathGlobs } from '../../core/search/grep-path-globs.js';

const FILES = [
  '.hidden/z.h',
  'lib/src/HttpClient.java',
  'lib/src/x.h',
  'lib/src/y.c',
  'lib/tests/a.go',
  'lib/tests/sub/b_test.go',
  'src/m.h',
  'src/m_test.go',
  'src/tests/u.py',
  'tests/t.py',
  'top.h',
  'vendor_x/v.c',
];
const pick = (...globs) => FILES.filter(f => compilePathGlobs(globs).matches(f));

describe('compilePathGlobs — ripgrep -g semantics', () => {
  it('no globs (or only empty ones) compiles to null: the caller skips the filter', () => {
    expect(compilePathGlobs([])).toBeNull();
    expect(compilePathGlobs(null)).toBeNull();
    expect(compilePathGlobs(['', '!', '/'])).toBeNull();
    expect(compilePathGlob('!')).toBeNull();
  });

  it('an excluded directory glob drops everything below it', () => {
    expect(pick('!lib/tests/**')).not.toContain('lib/tests/a.go');
    expect(pick('!lib/tests/**')).not.toContain('lib/tests/sub/b_test.go');
    expect(pick('!lib/tests/**')).toContain('src/tests/u.py');
    // anchored dir without /** prunes the directory, as rg does
    expect(pick('!lib/tests')).toEqual(pick('!lib/tests/**'));
  });

  it('a slash-less glob matches the basename at any depth, directories included', () => {
    expect(pick('*.h')).toEqual(['.hidden/z.h', 'lib/src/x.h', 'src/m.h', 'top.h']);
    expect(pick('!*_test.go')).not.toContain('lib/tests/sub/b_test.go');
    expect(pick('!*_test.go')).not.toContain('src/m_test.go');
    // a bare directory name excludes every directory of that name
    const noTests = pick('!tests');
    expect(noTests.filter(f => f.split('/').includes('tests'))).toEqual([]);
    expect(pick('!tests/')).toEqual(noTests);
  });

  it('a glob with a slash is anchored at the root; a leading / or ./ anchors too', () => {
    expect(pick('lib/src/*')).toEqual(['lib/src/HttpClient.java', 'lib/src/x.h', 'lib/src/y.c']);
    expect(pick('*/m.h')).toEqual(['src/m.h']);
    expect(pick('/top.h')).toEqual(['top.h']);
    expect(pick('./top.h')).toEqual(['top.h']);       // deliberate deviation: rg matches nothing
    expect(pick('!/tests')).toContain('src/tests/u.py');
    expect(pick('!/tests')).not.toContain('tests/t.py');
  });

  it('an include must match the FILE (rg): a directory include admits nothing below it', () => {
    expect(pick('lib')).toEqual([]);
    expect(pick('lib/*')).toEqual([]);
    expect(pick('lib/')).toEqual([]);
    expect(pick('lib/**')).toHaveLength(5);
  });

  it('include + exclude: exclusion wins, whatever the order', () => {
    expect(pick('*.h', '!src/**')).toEqual(['.hidden/z.h', 'lib/src/x.h', 'top.h']);
    expect(pick('lib/**', '!*.h')).toEqual(['lib/src/HttpClient.java', 'lib/src/y.c', 'lib/tests/a.go', 'lib/tests/sub/b_test.go']);
    // deliberate deviation from rg (last glob wins there): an exclusion is never undone
    expect(pick('!src/**', 'src/m.h')).toEqual([]);
    expect(pick('src/m.h', '!src/**')).toEqual([]);
  });

  it('** crosses directories, braces alternate, classes work, dot files match, case counts', () => {
    expect(pick('**/tests/*.py')).toEqual(['src/tests/u.py', 'tests/t.py']);
    expect(pick('lib/**/*.go')).toEqual(['lib/tests/a.go', 'lib/tests/sub/b_test.go']);
    expect(pick('*.{h,c}')).toHaveLength(6);
    expect(pick('[lt]*/*.py')).toEqual(['tests/t.py']);
    expect(pick('!.hidden')).not.toContain('.hidden/z.h');
    expect(pick('!*.H')).toEqual(FILES);
  });

  it('memoises per file and normalises ./ and backslash-free spellings of the target', () => {
    const c = compilePathGlobs(['!tests/**']);
    expect(c.matches('./tests/t.py')).toBe(false);
    expect(c.matches('tests//t.py')).toBe(false);
    expect(c.matches('src/m.h')).toBe(true);
  });
});

describe('filterMatchesByPathGlobs', () => {
  it('keeps the allowed matches and counts what the globs removed', () => {
    const matches = [
      { file: 'src/a.js', line: 1 }, { file: 'tests/a.test.js', line: 1 },
      { file: 'tests/a.test.js', line: 9 }, { file: 'tests/b.test.js', line: 2 },
    ];
    const r = filterMatchesByPathGlobs(matches, compilePathGlobs(['!tests/**']));
    expect(r.kept.map(m => m.file)).toEqual(['src/a.js']);
    expect(r.excludedMatches).toBe(3);
    expect(r.excludedFiles).toBe(2);
  });

  it('null globs: the very same array, nothing counted', () => {
    const matches = [{ file: 'a', line: 1 }];
    const r = filterMatchesByPathGlobs(matches, null);
    expect(r.kept).toBe(matches);
    expect(r.excludedMatches).toBe(0);
  });
});

// ---- the same cases, measured against the real ripgrep -----------------------------------------
let rgAvailable = false;
try { execFileSync('rg', ['--version'], { stdio: 'ignore' }); rgAvailable = true; } catch { rgAvailable = false; }

describe.skipIf(!rgAvailable)('compilePathGlobs == ripgrep 15 on a temp tree', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ss-globs-rg-'));
  for (const f of FILES) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), 'Head\n');
  }
  afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  const rgFiles = (globs) => {
    try {
      return execFileSync('rg', ['--files', '--hidden', '--no-ignore', ...globs.flatMap(g => ['-g', g])],
        { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim().split('\n').filter(Boolean).sort();
    } catch { return []; }   // rg exits 1 when every file was filtered out
  };

  // Every case where rg's order rule and ours agree (no re-include after an exclude).
  const CASES = [
    ['!lib/tests/**'], ['!tests'], ['!tests/'], ['tests'], ['tests/**'], ['*.h'], ['!*_test.go'],
    ['lib/src/*'], ['lib/*'], ['/top.h'], ['!lib/src/HttpClient*'], ['*.h', '!src/**'],
    ['src/m.h', '!src/**'], ['**/tests/*.py'], ['src/**/*.py'], ['*.{h,c}'], ['!vendor*'], ['!lib'],
    ['lib/**', '!*.h'], ['lib'], ['lib/'], ['!/tests'], ['!lib/tests'], ['*/m.h'], ['!.hidden'],
    ['!*.H'], ['x.h'], ['!**/tests/**'], ['lib/**/*.go'], ['[lt]*/*.py'], ['!src/'],
  ];
  it.each(CASES.map(c => [c.join(' '), c]))('%s', (_label, globs) => {
    expect(pick(...globs)).toEqual(rgFiles(globs));
  });
});
