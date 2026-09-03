/**
 * ss-grep k-budget file diversity (grep-output-shaping.js + bareGrep gating).
 *
 * Regression suite for the gradethis-161 flooding failure: one file with more
 * matches than -k consumed every output slot and structurally hid the test
 * file the agent needed, with no signal that elision happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

import {
  applyGrepFileDiversity,
  allocateGrepBudget,
  renderGrepBody,
  reallocateGrepTailForManifest,
  matchesGrepFileFilter,
} from '../../core/search/grep-output-shaping.js';
import { bareGrep, SweetSearch } from '../../core/search/index.js';
import { buildSingletonSiblingLine } from '../../core/search/agent-pack-completion.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

function m(file, line, text = 'detect_mistakes(x)') {
  return { file, line, column: 1, matchText: text, content: text };
}

/** gradethis-161 shape: 190 matches in one early-alphabet file + 23 across 13 others (213 total). */
function floodMatches() {
  const out = [];
  for (let i = 1; i <= 190; i++) out.push(m('inst/tutorials/grade_code-messages.Rmd', i));
  const others = [
    ['R/detect_mistakes.R', 3],
    ['R/grade_code.R', 2],
    ['tests/testthat/test_detect_mistakes.R', 8],
  ];
  for (const [file, n] of others) {
    for (let i = 1; i <= n; i++) out.push(m(file, i * 10));
  }
  for (let f = 1; f <= 10; f++) out.push(m(`vignettes/v${f}.Rmd`, 5));
  out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return out; // 213 total across 14 files
}

describe('matchesGrepFileFilter', () => {
  it('matches exact relative path, ./-prefixed filter, and path suffix', () => {
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'tests/testthat/test_x.R')).toBe(true);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', './tests/testthat/test_x.R')).toBe(true);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'test_x.R')).toBe(true);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'testthat/test_x.R')).toBe(true);
  });

  // Was locked in as `false` — a directory scope matched NOTHING, so
  // `ss-grep … --in tests/testthat` printed "(no matches)" and was
  // indistinguishable from a regex that genuinely misses.
  it('matches a directory scope, named from the root or by its own name', () => {
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'tests/testthat')).toBe(true);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'tests/testthat/')).toBe(true);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', './tests/testthat')).toBe(true);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'tests')).toBe(true);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'testthat')).toBe(true);
  });

  it('rejects other files and partial segment overlaps', () => {
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'x.R')).toBe(false);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'test')).toBe(false);       // not a whole segment
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'testthat/test_y.R')).toBe(false);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'src/tests')).toBe(false);  // run must be contiguous
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', '')).toBe(false);
    expect(matchesGrepFileFilter('', 'tests')).toBe(false);
  });

  it('never lets a scope escape the repository root', () => {
    // The engine only ever emits repo-relative paths, so a traversal scope has
    // nothing to match; `..` is rejected outright so it cannot even be spelled.
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', '..')).toBe(false);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', '../tests/testthat')).toBe(false);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', '../../etc/passwd')).toBe(false);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'tests/../tests/testthat')).toBe(false);
    expect(matchesGrepFileFilter('etc/passwd', '/etc/passwd')).toBe(false);             // root unknown
  });

  // Agents paste back the absolute path the harness gave them. Two of the
  // eleven directory scopes in the 2026-08-11 run were spelled this way and
  // returned nothing, because an absolute scope is LONGER than the repo-relative
  // path the engine emits, so no contiguous run can exist.
  describe('absolute scopes (as agents actually spell them)', () => {
    const ROOT = '/root/.ss-eval/runs/dart-lang__http-1114__sweet__r0__11/.claude/worktrees/agent-ae7c';
    const FILE = 'pkgs/http/lib/src/response.dart';

    it('with the project root known: strips the root, then matches relatively', () => {
      expect(matchesGrepFileFilter(FILE, `${ROOT}/pkgs/http/lib/src`, ROOT)).toBe(true);
      expect(matchesGrepFileFilter(FILE, `${ROOT}/pkgs/http`, ROOT)).toBe(true);
      expect(matchesGrepFileFilter('lib/other.dart', `${ROOT}/pkgs/http/lib/src`, ROOT)).toBe(false);
    });

    it('scoping to the repo root itself matches every file', () => {
      expect(matchesGrepFileFilter(FILE, ROOT, ROOT)).toBe(true);
    });

    it('without the root: rejects an absolute scope instead of guessing from a suffix', () => {
      expect(matchesGrepFileFilter(FILE, `${ROOT}/pkgs/http/lib/src`)).toBe(false);
      expect(matchesGrepFileFilter(FILE, `${ROOT}/pkgs/http`)).toBe(false);
    });

    it('without the root, a bare repo root cannot be recognised — stays false', () => {
      expect(matchesGrepFileFilter(FILE, ROOT)).toBe(false);
    });

    it('rejects absolute scopes outside the known root even when a suffix aligns', () => {
      expect(matchesGrepFileFilter('src/auth.js', '/tmp/other-repo/src', ROOT)).toBe(false);
      expect(matchesGrepFileFilter('src/auth.js', `${ROOT}2/src`, ROOT)).toBe(false);
    });

    it('keeps a rooted absolute scope anchored after stripping the root', () => {
      expect(matchesGrepFileFilter('nested/src/a.js', `${ROOT}/src`, ROOT)).toBe(false);
      expect(matchesGrepFileFilter('nested/src/a.js', `${ROOT}/src/a.js`, ROOT)).toBe(false);
    });

    it('a relative scope cannot over-widen from a longer unrelated prefix', () => {
      expect(matchesGrepFileFilter('c/d.js', 'a/b/c')).toBe(false);
      expect(matchesGrepFileFilter('src/lib/x.js', 'other/src')).toBe(false);
    });

    it('still refuses traversal in an absolute scope', () => {
      expect(matchesGrepFileFilter(FILE, `${ROOT}/../../etc`, ROOT)).toBe(false);
    });
  });

  it('resolves every directory scope recorded in the 2026-08-11 run', () => {
    // Ten of eleven returned "(no matches)". These are the exact spellings.
    const recorded = [
      ['test/nimble_options_test.exs', 'test'],
      ['packages/bingo-handlebars/src/handlebars.ts', 'packages/bingo-handlebars/src'],
      ['packages/bingo-handlebars/src/handlebars.ts', 'packages/bingo-handlebars'],
      ['pkgs/http/test/response_test.dart', 'pkgs/http/test'],
      ['src/Kubernetes.Controller/Converters/YarpParser.cs', 'src/Kubernetes.Controller/Converters'],
      ['pkgs/http/lib/src/response.dart', 'pkgs/http/lib'],
      ['robot-core/src/test/java/org/obolibrary/robot/IOHelperTest.java', 'robot-core/src/test'],
      ['config/cache.php', 'config'],
    ];
    for (const [file, scope] of recorded) {
      expect(matchesGrepFileFilter(file, scope), `${scope} -> ${file}`).toBe(true);
    }
  });

  describe('whole-repo scope: `.` and `./`', () => {
    // The scope carries no path segments, and the old rule rejected an empty segment list
    // outright — so `--in .` matched NOTHING and printed "(no matches)", the one answer an
    // agent reads as "your pattern is absent". It fired on 5 fresh-pool calls, 4 with real
    // hits. "Here" means the repository, so it must behave like an unscoped grep.
    it('matches every repo-relative path', () => {
      for (const scope of ['.', './', './/.', './/']) {
        expect(matchesGrepFileFilter('src/a.js', scope, '/repo'), scope).toBe(true);
        expect(matchesGrepFileFilter('deeply/nested/dir/z.R', scope, '/repo'), scope).toBe(true);
      }
    });

    it('works with no project root supplied', () => {
      expect(matchesGrepFileFilter('src/a.js', '.', null)).toBe(true);
    });

    it('still refuses traversal and the filesystem root', () => {
      // `..` escapes; `/` is the filesystem root, a different claim from "this repository",
      // and it has fewer segments than any real root so the absolute branch rejects it.
      expect(matchesGrepFileFilter('src/a.js', '..', '/repo')).toBe(false);
      expect(matchesGrepFileFilter('src/a.js', './..', '/repo')).toBe(false);
      expect(matchesGrepFileFilter('src/a.js', '/', '/repo')).toBe(false);
    });

    it('is equivalent to no scope at all across a whole file list', () => {
      const files = ['a.js', 'src/b.js', 'src/deep/c.R', 'tests/testthat/test_x.R'];
      expect(files.filter(f => matchesGrepFileFilter(f, '.', '/repo'))).toEqual(files);
    });
  });

  it('accepts several scopes: any one matching wins', () => {
    const scopes = ['lib/nimble_options.ex', 'test/nimble_options_test.exs'];
    expect(matchesGrepFileFilter('lib/nimble_options.ex', scopes)).toBe(true);
    expect(matchesGrepFileFilter('test/nimble_options_test.exs', scopes)).toBe(true);   // was silently dropped
    expect(matchesGrepFileFilter('mix.exs', scopes)).toBe(false);
    expect(matchesGrepFileFilter('lib/nimble_options.ex', [])).toBe(false);
    expect(matchesGrepFileFilter('lib/nimble_options.ex', ['', null])).toBe(false);
  });
});

describe('applyGrepFileDiversity', () => {
  it('caps kept matches per file while counting all of them (flood shape)', () => {
    const { kept, fileSummary } = applyGrepFileDiversity(floodMatches(), { perFileCap: 50, maxFiles: 50 });
    const keptFiles = new Set(kept.map(x => x.file));
    expect(keptFiles.size).toBe(14);                       // every file survives
    expect(keptFiles.has('tests/testthat/test_detect_mistakes.R')).toBe(true);
    const flooded = fileSummary.files.find(f => f.file === 'inst/tutorials/grade_code-messages.Rmd');
    expect(flooded.total).toBe(190);                       // counted beyond the cap
    expect(flooded.kept).toBe(50);                         // stored only up to the cap
    expect(fileSummary.hiddenFileCount).toBe(0);
    expect(fileSummary.hiddenMatchCount).toBe(0);
  });

  it('keeps everything and reports total==kept at the exact cap boundary', () => {
    const matches = Array.from({ length: 5 }, (_, i) => m('a.js', i + 1));
    const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap: 5 });
    expect(kept.length).toBe(5);
    expect(fileSummary.files[0]).toEqual({ file: 'a.js', total: 5, kept: 5 });
  });

  it('counts files beyond maxFiles as hidden with a bounded sample', () => {
    const matches = [];
    for (let f = 1; f <= 8; f++) matches.push(m(`f${f}.js`, 1), m(`f${f}.js`, 2));
    const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap: 5, maxFiles: 4 });
    expect(new Set(kept.map(x => x.file)).size).toBe(4);
    expect(fileSummary.hiddenFileCount).toBe(4);
    expect(fileSummary.hiddenMatchCount).toBe(8);
    expect(fileSummary.hiddenSample.length).toBe(3);       // bounded, name + total
    expect(fileSummary.hiddenSample[0]).toEqual({ file: 'f5.js', total: 2 });
  });
});

describe('allocateGrepBudget', () => {
  it('allocates breadth-first: no file starves while another goes deep', () => {
    expect(allocateGrepBudget([50, 3, 2], 10)).toEqual([5, 3, 2]);
  });
  it('gives full depth when the budget covers everything', () => {
    expect(allocateGrepBudget([4, 2], 50)).toEqual([4, 2]);
  });
  it('covers one line per file first when files outnumber the budget', () => {
    expect(allocateGrepBudget([9, 9, 9, 9], 3)).toEqual([1, 1, 1, 0]);
  });
  it('handles zero budget and empty input', () => {
    expect(allocateGrepBudget([3, 3], 0)).toEqual([0, 0]);
    expect(allocateGrepBudget([], 10)).toEqual([]);
  });
});

describe('renderGrepBody', () => {
  it('flood shape: every file visible within k lines, truncation marked inline', () => {
    const { kept, fileSummary } = applyGrepFileDiversity(floodMatches(), { perFileCap: 50, maxFiles: 50 });
    const body = renderGrepBody(kept, fileSummary, 50);
    expect(body.lines.length).toBe(50);                    // token budget unchanged
    const filesShown = new Set(body.lines.map(l => l.split(':')[0]));
    expect(filesShown.size).toBe(14);                      // the fix: no file hidden
    expect(filesShown.has('tests/testthat/test_detect_mistakes.R')).toBe(true);
    const floodedLines = body.lines.filter(l => l.startsWith('inst/tutorials/'));
    expect(floodedLines.length).toBeLessThan(50);          // flooding structurally impossible
    expect(floodedLines[floodedLines.length - 1]).toMatch(/\(\+\d+ more in this file\)$/);
    // counter correctness: shown + elided == total for the flooded file
    const shown = floodedLines.length;
    const elided = Number(floodedLines[shown - 1].match(/\(\+(\d+) more in this file\)$/)[1]);
    expect(shown + elided).toBe(190);
    expect(body.hiddenLine).toBeNull();
    expect(body.truncatedFileCount).toBeGreaterThan(0);
  });

  it('many-files case: output lines identical to the legacy flat-grouped shape', () => {
    // 4 files, 9 matches, k=20 — no truncation anywhere, so the new shaping
    // must reproduce the old output exactly (grouped by file, sorted order).
    const matches = [
      m('a.js', 1), m('a.js', 2), m('a.js', 3),
      m('b.js', 1), m('b.js', 2),
      m('c.js', 4), m('c.js', 9),
      m('d.js', 7), m('d.js', 8),
    ];
    const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap: 20, maxFiles: 20 });
    const body = renderGrepBody(kept, fileSummary, 20);
    expect(body.lines).toEqual(matches.map(x => `${x.file}:${x.line}: ${x.matchText}`));
    expect(body.truncatedFileCount).toBe(0);
    expect(body.hiddenLine).toBeNull();
  });

  it('cap boundary: k matches in one file → no marker; k+1 → (+1 more)', () => {
    const at = applyGrepFileDiversity(
      Array.from({ length: 20 }, (_, i) => m('a.js', i + 1)), { perFileCap: 20 });
    const bodyAt = renderGrepBody(at.kept, at.fileSummary, 20);
    expect(bodyAt.lines.length).toBe(20);
    expect(bodyAt.lines.some(l => l.includes('more in this file'))).toBe(false);

    const over = applyGrepFileDiversity(
      Array.from({ length: 21 }, (_, i) => m('a.js', i + 1)), { perFileCap: 20 });
    const bodyOver = renderGrepBody(over.kept, over.fileSummary, 20);
    expect(bodyOver.lines.length).toBe(20);
    expect(bodyOver.lines[19]).toMatch(/\(\+1 more in this file\)$/);
  });

  it('more files than budget: unshown files surface in one honest tail line', () => {
    const matches = [];
    for (let f = 1; f <= 6; f++) matches.push(m(`f${f}.js`, 1), m(`f${f}.js`, 2));
    const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap: 5, maxFiles: 6 });
    const body = renderGrepBody(kept, fileSummary, 4);
    expect(body.lines.length).toBe(4);
    expect(body.hiddenLine).toMatch(/^# \+2 more file\(s\) with 4 match\(es\)/);
    expect(body.hiddenLine).toContain('f5.js');
    expect(body.hiddenLine).toContain('--in <file>');
  });
});

describe('reallocateGrepTailForManifest', () => {
  it('pays for an indexed family manifest by removing complete tail lines', () => {
    const lines = [
      'src/i32/ivec2.rs:22: pub struct IVec2',
      'src/i32/ivec3.rs:22: pub struct IVec3',
      'src/u32/uvec2.rs:22: pub struct UVec2',
    ];
    const manifest = { rendered: '# indexed family: IVec{2,3,4} · UVec{2,3,4} · I64Vec{2,3,4} · U64Vec{2,3,4}' };
    const beforeTokens = lines.reduce((sum, line) => sum + Math.ceil(`${line}\n`.length / 3.5), 0);
    const out = reallocateGrepTailForManifest(lines, manifest);
    const afterTokens = out.lines.reduce((sum, line) => sum + Math.ceil(`${line}\n`.length / 3.5), 0)
      + Math.ceil(`${out.familyManifest.rendered}\n`.length / 3.5);

    expect(out.removedLineCount).toBeGreaterThan(0);
    expect(out.lines).toEqual(lines.slice(0, -out.removedLineCount));
    expect(afterTokens).toBeLessThanOrEqual(beforeTokens);
  });

  it('abstains when all grep lines cannot fund the manifest', () => {
    const lines = ['a:1: x'];
    const manifest = { rendered: `# indexed family: ${'VeryLongFamily'.repeat(20)}` };
    expect(reallocateGrepTailForManifest(lines, manifest)).toEqual({
      lines,
      familyManifest: null,
      removedLineCount: 0,
    });
  });
});

// =============================================================================
// bareGrep option gating (mock native unified index, hermetic off-repo paths)
// =============================================================================

function makeUnifiedIndex(matches) {
  const fullResult = { matches, candidateFiles: 1, totalFiles: 1, scannedFiles: 1 };
  return {
    searchFull: vi.fn(() => fullResult),
    searchLines: vi.fn(() => ({ ...fullResult, matches: matches.map(x => ({ file: x.file, line: x.line })) })),
  };
}

function makeSearcher(matches) {
  return {
    projectRoot: '/proj',
    // pinned off-repo so a live sparse-delta overlay cannot leak into the mock
    sparseGramIndexPath: path.join(os.tmpdir(), 'sweet-search-absent-sparse.idx'),
    sparseGramIndex: makeUnifiedIndex(matches),
  };
}

describe('bareGrep — file-diversity options are additive and default-off', () => {
  it('without new options: no fileSummary, legacy slice behavior intact', async () => {
    const res = await bareGrep.call(makeSearcher(floodMatches()), 'detect_mistakes\\(', null,
      { regex: 'detect_mistakes\\(', maxMatches: 50 });
    expect(res.fileSummary).toBeUndefined();
    expect(res.results.length).toBe(50);
    expect(res.stats.totalMatches).toBe(213);
    // documents the pre-fix flood: all 50 slots from the alphabetically-first file
    expect(new Set(res.results.map(r => r.file)).size).toBe(1);
  });

  it('perFileCap keeps every file reachable and reports per-file totals', async () => {
    const res = await bareGrep.call(makeSearcher(floodMatches()), 'detect_mistakes\\(', null,
      { regex: 'detect_mistakes\\(', maxMatches: 0, perFileCap: 50, maxFiles: 50 });
    expect(res.stats.totalMatches).toBe(213);
    expect(new Set(res.results.map(r => r.file)).size).toBe(14);
    const flooded = res.fileSummary.files.find(f => f.file === 'inst/tutorials/grade_code-messages.Rmd');
    expect(flooded).toEqual({ file: 'inst/tutorials/grade_code-messages.Rmd', total: 190, kept: 50 });
  });

  it('fileFilter scopes matches to one file before the cap is applied', async () => {
    const res = await bareGrep.call(makeSearcher(floodMatches()), 'detect_mistakes\\(', null,
      { regex: 'detect_mistakes\\(', maxMatches: 5, fileFilter: 'tests/testthat/test_detect_mistakes.R' });
    expect(res.stats.totalMatches).toBe(8);                // file-scoped true total
    expect(res.results.length).toBe(5);
    expect(new Set(res.results.map(r => r.file))).toEqual(new Set(['tests/testthat/test_detect_mistakes.R']));
  });

  it('fileFilter accepts several scopes and keeps matches from every one', async () => {
    const matches = [
      m('lib/nimble_options.ex', 12),
      m('mix.exs', 3),
      m('test/nimble_options_test.exs', 44),
    ].sort((a, b) => a.file.localeCompare(b.file));
    const res = await bareGrep.call(makeSearcher(matches), 'keys', null, {
      regex: 'keys', maxMatches: 0,
      fileFilter: ['lib/nimble_options.ex', 'test/nimble_options_test.exs'],
    });
    expect(res.stats.totalMatches).toBe(2);
    expect(new Set(res.results.map(r => r.file)))
      .toEqual(new Set(['lib/nimble_options.ex', 'test/nimble_options_test.exs']));
  });

  it('fileFilter accepts a directory scope', async () => {
    const res = await bareGrep.call(makeSearcher(floodMatches()), 'detect_mistakes\\(', null,
      { regex: 'detect_mistakes\\(', maxMatches: 0, fileFilter: 'tests/testthat' });
    expect(res.stats.totalMatches).toBe(8);
    expect(new Set(res.results.map(r => r.file)))
      .toEqual(new Set(['tests/testthat/test_detect_mistakes.R']));
  });

  it('uses options.projectRoot for absolute scopes when the searcher has no root', async () => {
    const searcher = makeSearcher(floodMatches());
    delete searcher.projectRoot;
    const res = await bareGrep.call(searcher, 'detect_mistakes\\(', null, {
      regex: 'detect_mistakes\\(', maxMatches: 0,
      projectRoot: '/proj', fileFilter: '/proj/tests/testthat',
    });
    expect(res.stats.totalMatches).toBe(8);
    expect(new Set(res.results.map(r => r.file)))
      .toEqual(new Set(['tests/testthat/test_detect_mistakes.R']));
  });

  it('agent grep derives complete width families from indexed declarations', async () => {
    const matches = [
      m('src/i32/ivec2.rs', 22, 'pub struct IVec2'),
      m('src/i32/ivec3.rs', 22, 'pub struct IVec3'),
      m('src/i32/ivec4.rs', 22, 'pub struct IVec4'),
      m('src/u32/uvec2.rs', 22, 'pub struct UVec2'),
      m('src/u32/uvec3.rs', 22, 'pub struct UVec3'),
      m('src/u32/uvec4.rs', 22, 'pub struct UVec4'),
    ];
    const indexed = [
      ...['IVec', 'UVec', 'I64Vec', 'U64Vec'].flatMap(prefix => [2, 3, 4].map(width => ({
        name: `${prefix}${width}`, type: 'struct', filePath: `src/${prefix.toLowerCase()}/${width}.rs`,
      }))),
    ];
    const searcher = makeSearcher(matches);
    searcher.codeGraphRepo = {
      findEntitiesInRange: vi.fn((file) => {
        const name = matches.find(match => match.file === file)?.matchText.split(' ').at(-1);
        return name ? [{ name, type: 'struct' }] : [];
      }),
      findFamilyCandidates: vi.fn(() => indexed),
    };

    const res = await bareGrep.call(searcher, 'model-written-regex-is-ignored', null, {
      regex: 'model-written-regex-is-ignored', maxMatches: 0, perFileCap: 30, maxFiles: 30,
      _isAgentFormat: true,
    });
    expect(res.familyManifest.rendered).toContain('IVec{2,3,4}');
    expect(res.familyManifest.rendered).toContain('UVec{2,3,4}');
    expect(res.familyManifest.rendered).toContain('I64Vec{2,3,4}');
    expect(res.familyManifest.rendered).toContain('U64Vec{2,3,4}');
    expect(searcher.codeGraphRepo.findFamilyCandidates).toHaveBeenCalledWith('vec', expect.objectContaining({
      filePrefix: 'src', types: ['struct'],
    }));
  });

  it('does no symbol-table family work for non-agent grep', async () => {
    const searcher = makeSearcher([m('src/vec2.rs', 1, 'pub struct Vec2')]);
    searcher.codeGraphRepo = {
      findEntitiesInRange: vi.fn(() => [{ name: 'Vec2', type: 'struct' }]),
      findFamilyCandidates: vi.fn(() => []),
    };
    const res = await bareGrep.call(searcher, 'Vec2', null, { regex: 'Vec2' });
    expect(res.familyManifest).toBeUndefined();
    expect(searcher.codeGraphRepo.findEntitiesInRange).not.toHaveBeenCalled();
  });
});

describe('SweetSearch grep dispatch', () => {
  it('preserves fileSummary for warm-daemon callers', async () => {
    const fileSummary = {
      files: [{ file: 'src/a.js', total: 2, kept: 1 }],
      hiddenFileCount: 0,
      hiddenMatchCount: 1,
      hiddenSample: [],
    };
    const searcher = {
      useLateInteraction: false,
      qualityWeight: 1,
      manifestEpoch: null,
      _manifestStateDir: null,
      initGrepOnly: vi.fn(async () => {}),
      _refreshManifestPins: vi.fn(async () => {}),
      log: vi.fn(),
      bareGrep: vi.fn(async () => ({
        results: [{ file: 'src/a.js', line: 1 }],
        fileSummary,
        familyManifest: { rendered: '# indexed family: Vec{2,3,4}' },
        stats: { total_ms: 1 },
      })),
    };

    const result = await SweetSearch.prototype.search.call(searcher, 'needle', { mode: 'grep' });
    expect(result.fileSummary).toEqual(fileSummary);
    expect(result.familyManifest.rendered).toBe('# indexed family: Vec{2,3,4}');
  });
});

// ---------------------------------------------------------------------------
// Singleton sibling line (2026-09-03, squashql-295 shape). A 1-match grep in
// checkSubQuery must co-list, WITH code, the field the fix needs (declared
// L35, assigned L55) and the sibling method that reads it (L191).
// ---------------------------------------------------------------------------

const JAVA = 'src/QueryResolver.java';

function writeSquashql(root) {
  const lines = [];
  for (let i = 1; i <= 300; i++) {
    if (i === 10) lines.push('public class QueryResolver {');
    else if (i === 35) lines.push('  private final Map<Measure, CompiledMeasure> subQueryMeasures;');
    else if (i === 36) lines.push('  private final Map<String, Store> storesByName;');
    else if (i === 50) lines.push('  public QueryResolver(QueryDto query, Map<String, Store> storesByName) {');
    else if (i === 55) lines.push('    this.subQueryMeasures = compileMeasures(query.table.subQuery.measures, false);');
    else if (i === 60) lines.push('  }');
    else if (i === 100) lines.push('  private CompiledMeasure compileMeasure(Measure m) {');
    else if (i === 110) lines.push('  }');
    else if (i === 191) lines.push('  private DatabaseQuery toSubQuery(QueryDto subQuery) {');
    else if (i === 207) lines.push('    List<CompiledMeasure> measures = new ArrayList<>(this.subQueryMeasures.values());');
    else if (i === 208) lines.push('  }');
    else if (i === 210) lines.push('  private void checkSubQuery(QueryDto subQuery) {');
    else if (i === 212) lines.push('      throw new IllegalArgumentException("sub-query in a sub-query is not supported");');
    else if (i === 228) lines.push('  }');
    else if (i === 300) lines.push('}');
    else lines.push(`    // line ${i}`);
  }
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, JAVA), lines.join('\n') + '\n');
}

const ENTITIES = [
  { id: 1, name: 'QueryResolver', type: 'class', startLine: 10, endLine: 300 },
  { id: 2, name: 'subQueryMeasures', type: 'field', startLine: 35, endLine: 35 },
  { id: 3, name: 'storesByName', type: 'field', startLine: 36, endLine: 36 },
  { id: 4, name: 'QueryResolver', type: 'method', startLine: 50, endLine: 60 },
  { id: 5, name: 'compileMeasure', type: 'method', startLine: 100, endLine: 110 },
  { id: 6, name: 'toSubQuery', type: 'method', startLine: 191, endLine: 208 },
  { id: 7, name: 'checkSubQuery', type: 'method', startLine: 210, endLine: 228 },
];

function squashqlRepo() {
  return {
    findEnclosingEntity: vi.fn((file, line) => ENTITIES
      .filter(e => e.startLine <= line && e.endLine >= line)
      .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0] || null),
    findEntitiesInFile: vi.fn(() => ENTITIES),
  };
}

describe('singleton sibling line (squashql-295)', () => {
  let root;
  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'sibling-line-')); writeSquashql(root); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('co-lists the field declaration, its assignment and the sibling reader, with code', () => {
    const line = buildSingletonSiblingLine([m(JAVA, 212, 'throw new IllegalArgumentException(...)')], squashqlRepo(), {
      regex: 'sub-query in a sub-query is not supported', projectRoot: root,
    });
    expect(line.rendered).toBe(
      '# same file (siblings of checkSubQuery): '
      + '35: private final Map<Measure, CompiledMeasure> subQueryMeasures; · '
      + '55: this.subQueryMeasures = compileMeasures(query.table.subQuery.measures, false); · '
      + '191: private DatabaseQuery toSubQuery(QueryDto subQuery) {',
    );
    // Unrelated siblings (storesByName, compileMeasure) and the enclosing class never appear.
    expect(line.rendered).not.toContain('storesByName');
    expect(line.rendered).not.toContain('compileMeasure(');
    expect(line.tokens).toBeGreaterThan(0);
    expect(line.tokens).toBeLessThan(80);
  });

  it('is silent for multi-hit, no-enclosing-entity and no-family hits', () => {
    const repo = squashqlRepo();
    expect(buildSingletonSiblingLine([m(JAVA, 212), m(JAVA, 213)], repo, { projectRoot: root })).toBeNull();
    expect(buildSingletonSiblingLine([m(JAVA, 5)], repo, { projectRoot: root })).toBeNull();
    // compileMeasure shares no family token with anything and reads no field.
    expect(buildSingletonSiblingLine([m(JAVA, 105)], repo, { projectRoot: root })).toBeNull();
    expect(repo.findEntitiesInFile).toHaveBeenCalledTimes(1); // only the in-entity miss did file work
  });

  it('bareGrep attaches it only for agent format without --in', async () => {
    const searcher = { ...makeSearcher([m(JAVA, 212, 'throw new IllegalArgumentException("sub-query in a sub-query is not supported");')]), projectRoot: root };
    searcher.codeGraphRepo = squashqlRepo();
    const agent = await bareGrep.call(searcher, 'not supported', null, {
      regex: 'not supported', maxMatches: 0, perFileCap: 20, maxFiles: 20, _isAgentFormat: true,
    });
    expect(agent.results).toHaveLength(1);
    expect(agent.siblingLine.rendered).toContain('35: private final Map<Measure, CompiledMeasure> subQueryMeasures;');
    const human = await bareGrep.call(searcher, 'not supported', null, { regex: 'not supported', maxMatches: 0 });
    expect(human.siblingLine).toBeUndefined();
    const scoped = await bareGrep.call(searcher, 'not supported', null, {
      regex: 'not supported', maxMatches: 20, fileFilter: 'src', _isAgentFormat: true,
    });
    expect(scoped.siblingLine).toBeUndefined();
    // The off-switch is an OPTION, not an env read: the daemon's env is whatever
    // spawned it (a client that ran with SS_SIBLING_LINE=0 must not disable it for all).
    const off = await bareGrep.call(searcher, 'not supported', null, {
      regex: 'not supported', maxMatches: 0, perFileCap: 20, maxFiles: 20, _isAgentFormat: true, _siblingLine: false,
    });
    expect(off.siblingLine).toBeUndefined();
  });
});
