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
  allocateGrepLinesSainteLague,
  selectGrepFilesByWeight,
  grepFilePrior,
  renderGrepBody,
  matchesGrepFileFilter,
  renderGrepListing,
  renderGrepHiddenFiles,
  GREP_HIDDEN_HINT,
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

// =============================================================================
// Weighted rule (SS_FIX_GREP_ALLOC, default ON in ss-grep): sqrt(hits) x prior,
// streaming top-maxFiles selection, Sainte-Laguë line allocation
// =============================================================================

/** Deterministic PRNG (mulberry32). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 16 x weight^2: hits x 16 x prior^2 (exact integers). */
const keyOf = (hits, file) => hits * 16 * grepFilePrior(file) ** 2;

/** Brute force: every line scans every file (no frontier, no heap). */
function referenceAllocation(keys, totals, caps, budget) {
  const alloc = keys.map(() => 0);
  for (let line = 0; line < budget; line++) {
    let best = -1;
    for (let i = 0; i < keys.length; i++) {
      if (alloc[i] >= caps[i]) continue;
      if (best < 0) { best = i; continue; }
      const di = (2 * alloc[i] + 1) ** 2; const db = (2 * alloc[best] + 1) ** 2;
      const lhs = keys[i] * db; const rhs = keys[best] * di;
      if (lhs > rhs || (lhs === rhs && totals[i] > totals[best])) best = i;
    }
    if (best < 0) break;
    alloc[best]++;
  }
  return alloc;
}

/** Sorted match list from {file: hits}; lines 1..hits. */
function matchList(counts) {
  const out = [];
  for (const file of Object.keys(counts).sort((a, b) => a.localeCompare(b))) {
    for (let line = 1; line <= counts[file]; line++) out.push(m(file, line, `hit ${line}`));
  }
  return out;
}

// dgraph-08 (r3 dev dossier): `ss-grep "func .*export|func .*Export" -k 30`, 84 hits in 20
// files; the answer worker/export.go has 22 hits and sorts late in the alphabet.
const DGRAPH_08 = {
  'backup/run.go': 3, 'buildvars/buildvars.go': 2, 'buildvars/buildvars_test.go': 4,
  'dgraph/cmd/live/load-uids/load_test.go': 2, 'dgraphapi/cluster.go': 1, 'dgraphtest/load.go': 1,
  'dgraphtest/local_cluster.go': 1, 'graphql/admin/export.go': 2, 'graphql/e2e/schema/schema_test.go': 1,
  'protos/pb/pb.pb.go': 23, 'protos/pb/pb_grpc.pb.go': 3, 'systest/bulk_live/common/bulk_live_cases.go': 1,
  'systest/export/export_test.go': 4, 'systest/live_pw_test.go': 1, 'systest/vector/load_test.go': 2,
  'testutil/multi_tenancy.go': 1, 'worker/backup.go': 1, 'worker/export.go': 22, 'worker/export_test.go': 8,
  'x/metrics.go': 1,
};

describe('grepFilePrior', () => {
  it('source 1, test/spec/fixture 0.5, generated/vendored/minified 0.25', () => {
    for (const f of ['worker/export.go', 'src/Testament.java', 'lib/latest.rb', 'build.gradle', 'docs/spectrum.md']) {
      expect(grepFilePrior(f)).toBe(1);
    }
    for (const f of ['worker/export_test.go', 'tests/a.py', 'pkg/test_x.py', 'src/a.spec.ts', 'spec/x_spec.rb',
      'src/FooTest.java', 'conftest.py', 'testdata/x.json', 'lib/__mocks__/a.js', 'fixtures/a.json']) {
      expect(grepFilePrior(f)).toBe(0.5);
    }
    for (const f of ['protos/pb/pb.pb.go', 'api/x_pb2.py', 'src/a.generated.ts', 'vendor/github.com/x/a.go',
      'node_modules/a/index.js', 'dist/app.js', 'web/build/x.js', 'static/app.min.js']) {
      expect(grepFilePrior(f)).toBe(0.25);
    }
  });

  it('generated wins over test (a vendored test file is 0.25)', () => {
    expect(grepFilePrior('vendor/x/y_test.go')).toBe(0.25);
    expect(grepFilePrior('tests/fixtures/a.pb.go')).toBe(0.25);
  });

  it('the one-regex keyword pre-check never changes an answer', async () => {
    const { isTestLikePath } = await import('../../core/search/agent-output-fixes.js');
    const GENERATED = /\.pb\.go$|_pb2\.py$|\.generated\.|(^|\/)(vendor|dist|build|node_modules)\/|\.min\.js$/i;
    const parts = ['src', 'tests', 'Test', 'spec', 'specs', 'fixture', 'mocks', 'e2e', 'vendor', 'dist', 'build',
      'node_modules', 'pb', 'lib', 'testing', 'integration-tests', '__tests__', 'TESTDATA', 'Generated', 'Spec'];
    const names = ['a.go', 'a_test.go', 'test_a.py', 'a.test.ts', 'a.spec.js', 'a_spec.rb', 'FooTest.java', 'FooTests.swift',
      'conftest.py', 'a.pb.go', 'a_pb2.py', 'a.generated.cs', 'a.min.js', 'Testament.java', 'latest.go', 'mockito.kt',
      'distance.go', 'builder.go', 'e2e.go', 'aspect.c', 'a.min.css', 'pb2.go'];
    const r = prng(11);
    for (let i = 0; i < 4000; i++) {
      const segs = [];
      for (let d = Math.floor(r() * 4); d > 0; d--) segs.push(parts[Math.floor(r() * parts.length)]);
      const file = [...segs, names[Math.floor(r() * names.length)]].join('/');
      const expected = GENERATED.test(file) ? 0.25 : isTestLikePath(file) ? 0.5 : 1;
      expect(grepFilePrior(file)).toBe(expected);
    }
  });
});

describe('allocateGrepLinesSainteLague', () => {
  const run = (hitsList, caps, budget, files = hitsList.map((_, i) => `f${i}.go`)) =>
    [...allocateGrepLinesSainteLague(hitsList.map((h, i) => keyOf(h, files[i])), hitsList, caps, budget)];

  it('each line goes to the largest weight / (2 x lines + 1)', () => {
    // weights 3 (9 hits) and 1 (1 hit): 3 -> line 1; tie 1 vs 1 -> more hits; then 0.6 < 1.
    expect(run([9, 1], [9, 1], 1)).toEqual([1, 0]);
    expect(run([9, 1], [9, 1], 2)).toEqual([2, 0]);
    expect(run([9, 1], [9, 1], 3)).toEqual([2, 1]);
    expect(run([9, 1], [9, 1], 4)).toEqual([3, 1]);
  });

  it('no floor round: a dense file takes its 2nd line before light files get a 1st', () => {
    // weight 4 (16 hits) vs three weight-1 files: 4, then 4/3 = 1.33 > 1.
    expect(run([16, 1, 1, 1], [16, 1, 1, 1], 3)).toEqual([2, 1, 0, 0]);
  });

  it('never more lines than a file has stored matches', () => {
    expect(run([400, 1, 1], [2, 1, 1], 4)).toEqual([2, 1, 1]);
    expect(run([400, 4], [3, 4], 10)).toEqual([3, 4]);
  });

  it('k larger than every stored match: everything shows', () => {
    expect(run([5, 3, 1], [5, 3, 1], 100)).toEqual([5, 3, 1]);
  });

  it('a single file gets min(k, stored)', () => {
    expect(run([50], [20], 8)).toEqual([8]);
    expect(run([50], [20], 30)).toEqual([20]);
  });

  it('all 1-hit files: the first k files in order (path order), one line each', () => {
    expect(run([1, 1, 1, 1, 1], [1, 1, 1, 1, 1], 3)).toEqual([1, 1, 1, 0, 0]);
  });

  it('exact ties: no float rounding; more hits first, then the earlier file', () => {
    // test files: 72 hits (weight sqrt(72)/2; after one line sqrt(72)/2/3 = sqrt(8)/2) vs 8 hits
    // (weight sqrt(8)/2). Equal exactly; floating-point sqrt makes the 8-hit file larger by one ulp.
    const files = ['a_test.go', 'b_test.go'];
    expect(run([72, 8], [72, 8], 2, files)).toEqual([2, 0]);
    expect(run([72, 8], [72, 8], 3, files)).toEqual([2, 1]);
    expect(run([4, 4], [4, 4], 1)).toEqual([1, 0]);
  });

  it('zero budget and no files', () => {
    expect(run([3, 3], [3, 3], 0)).toEqual([0, 0]);
    expect(run([], [], 10)).toEqual([]);
  });

  it('agrees with a brute-force scan on 3,000 random inputs', () => {
    const r = prng(3);
    for (let c = 0; c < 3000; c++) {
      const n = 1 + Math.floor(r() * 40);
      const files = []; const hits = [];
      for (let i = 0; i < n; i++) {
        const u = r();
        files.push(u < 0.6 ? `src/f${i}.go` : u < 0.85 ? `src/f${i}_test.go` : `vendor/f${i}.go`);
        hits.push(1 + Math.floor(r() * r() * 60));
      }
      // the function's precondition: weight order (key desc, hits desc, then input order)
      const order = files.map((_, i) => i).sort((a, b) =>
        keyOf(hits[b], files[b]) - keyOf(hits[a], files[a]) || hits[b] - hits[a] || a - b);
      const keys = order.map(i => keyOf(hits[i], files[i]));
      const totals = order.map(i => hits[i]);
      const caps = totals.map(t => Math.min(t, 1 + Math.floor(r() * 30)));
      const budget = Math.floor(r() * 50);
      expect([...allocateGrepLinesSainteLague(keys, totals, caps, budget)])
        .toEqual(referenceAllocation(keys, totals, caps, budget));
    }
  });
});

describe('selectGrepFilesByWeight (applyGrepFileDiversity order: weight)', () => {
  it('keeps the dense late-alphabet file when more files match than maxFiles (the legacy walk drops it)', () => {
    const matches = matchList(DGRAPH_08);
    const legacy = applyGrepFileDiversity(matches, { perFileCap: 5, maxFiles: 5 });
    expect(legacy.fileSummary.files.map(f => f.file)).not.toContain('worker/export.go');
    const { kept, fileSummary } = applyGrepFileDiversity(matches, { perFileCap: 5, maxFiles: 5, order: 'weight' });
    expect(fileSummary.order).toBe('weight');
    expect(fileSummary.files[0]).toEqual({ file: 'worker/export.go', total: 22, kept: 5, prior: 1 });
    // 22 hits (w 4.69), 3 hits (w 1.73), then weight 1.41: the 8-hit test file (equal weight,
    // more hits) before the 2-hit sources, which keep path order
    expect(fileSummary.files.map(f => f.file)).toEqual([
      'worker/export.go', 'backup/run.go', 'worker/export_test.go', 'buildvars/buildvars.go',
      'graphql/admin/export.go',
    ]);
    // kept: grouped per file in that order, line order inside a file, at most perFileCap each
    expect(kept.slice(0, 5).map(x => `${x.file}:${x.line}`)).toEqual([1, 2, 3, 4, 5].map(l => `worker/export.go:${l}`));
    expect(kept.length).toBe(5 + 3 + 5 + 2 + 2);
    expect(fileSummary.hiddenFileCount).toBe(15);
    expect(fileSummary.hiddenMatchCount).toBe(84 - (22 + 3 + 8 + 2 + 2));
    // the highest-weight hidden files: pb.pb.go (23 x 0.25: w 1.20), then the two 4-hit test files (w 1.0)
    expect(fileSummary.hiddenSample).toEqual([
      { file: 'protos/pb/pb.pb.go', total: 23 },
      { file: 'buildvars/buildvars_test.go', total: 4 },
      { file: 'systest/export/export_test.go', total: 4 },
    ]);
  });

  it('memory stays bounded: at most perFileCap x maxFiles stored, however many files match', () => {
    const matches = [];
    for (let i = 0; i < 10000; i++) matches.push(m(`pkg/f${String(i).padStart(5, '0')}.go`, 1));
    for (let l = 1; l <= 5000; l++) matches.push(m('zz/worker/export.go', l));
    const { kept, fileSummary } = selectGrepFilesByWeight(matches, { perFileCap: 20, maxFiles: 20 });
    expect(kept.length).toBeLessThanOrEqual(20 * 20);
    expect(fileSummary.files.length).toBe(20);
    expect(fileSummary.files[0]).toEqual({ file: 'zz/worker/export.go', total: 5000, kept: 20, prior: 1 });
    expect(fileSummary.files[1].file).toBe('pkg/f00000.go');   // equal 1-hit files: path order
    expect(fileSummary.files.length + fileSummary.hiddenFileCount).toBe(10001);
    expect(fileSummary.hiddenMatchCount).toBe(10000 - 19);
  });

  it('agrees with a brute-force top-maxFiles on 2,000 random match lists', () => {
    const r = prng(5);
    for (let c = 0; c < 2000; c++) {
      const counts = {};
      for (let i = 0, n = 1 + Math.floor(r() * 50); i < n; i++) {
        const u = r();
        const file = u < 0.6 ? `d${i % 5}/f${i}.go` : u < 0.85 ? `d${i % 5}/f${i}_test.go` : `vendor/f${i}.go`;
        counts[file] = 1 + Math.floor(r() * r() * 30);
      }
      const maxFiles = 1 + Math.floor(r() * 20);
      const perFileCap = 1 + Math.floor(r() * 10);
      const order = Object.keys(counts).sort((a, b) => a.localeCompare(b))
        .map((file, i) => ({ file, hits: counts[file], i }))
        .sort((a, b) => keyOf(b.hits, b.file) - keyOf(a.hits, a.file) || b.hits - a.hits || a.i - b.i);
      const { kept, fileSummary } = selectGrepFilesByWeight(matchList(counts), { perFileCap, maxFiles });
      expect(fileSummary.files.map(f => f.file)).toEqual(order.slice(0, maxFiles).map(f => f.file));
      expect(fileSummary.hiddenSample.map(f => f.file)).toEqual(order.slice(maxFiles, maxFiles + 3).map(f => f.file));
      expect(fileSummary.hiddenFileCount).toBe(Math.max(0, order.length - maxFiles));
      expect(fileSummary.hiddenMatchCount).toBe(order.slice(maxFiles).reduce((a, f) => a + f.hits, 0));
      expect(kept.length).toBe(order.slice(0, maxFiles).reduce((a, f) => a + Math.min(f.hits, perFileCap), 0));
    }
  });

  it('no maxFiles: every file kept, the heap grows past its first size', () => {
    const counts = {};
    for (let i = 0; i < 700; i++) counts[`f${String(i).padStart(3, '0')}.go`] = 1 + (i % 4);
    const { fileSummary } = selectGrepFilesByWeight(matchList(counts), { perFileCap: 2 });
    expect(fileSummary.files).toHaveLength(700);
    expect(fileSummary.hiddenFileCount).toBe(0);
    expect(fileSummary.files[0]).toEqual({ file: 'f003.go', total: 4, kept: 2, prior: 1 });
  });
});

describe('renderGrepBody alloc: weight', () => {
  const weighted = (counts, k, maxFiles = k) => {
    const { kept, fileSummary } = applyGrepFileDiversity(matchList(counts), {
      perFileCap: Math.min(k, 100), maxFiles, order: 'weight',
    });
    return renderGrepBody(kept, fileSummary, k, { alloc: 'weight' });
  };

  it('files in descending weight, lines in line order, truncation marked on the last shown line', () => {
    const body = weighted({ 'a.go': 1, 'b_test.go': 4, 'z.go': 9 }, 4);
    expect(body.lines).toEqual([
      'z.go:1: hit 1',
      'z.go:2: hit 2 (+7 more in this file)',
      'b_test.go:1: hit 1 (+3 more in this file)',
      'a.go:1: hit 1',
    ]);
    expect(body.truncatedFileCount).toBe(2);
    expect(body.hiddenLine).toBeNull();
    expect(body.matchedFileCount).toBe(3);
    expect(body.rows.map(r => r.more)).toEqual([0, 7, 3, 0]);
  });

  it('hidden-files line: unshown kept files first, then the engine\'s highest-weight hidden files', () => {
    const counts = { 'a.go': 1, 'b.go': 1, 'c_test.go': 1, 'vendor/v.go': 1, 'z.go': 16 };
    const body = weighted(counts, 3);
    // z (w 4) takes 2 lines (4, then 4/3 > 1), a.go the third; b.go got none; c_test.go and
    // vendor/v.go were never kept (maxFiles = k = 3)
    expect(body.lines).toEqual(['z.go:1: hit 1', 'z.go:2: hit 2 (+14 more in this file)', 'a.go:1: hit 1']);
    expect(body.hiddenLine).toBe('# +3 more file(s) with 3 match(es) — e.g. b.go, c_test.go, vendor/v.go; '
      + 'narrow the regex, raise -k, or drill in with --in <file>');
    expect(body.matchedFileCount).toBe(5);
  });

  it('all files fit and k covers everything: every hit shows, densest file first', () => {
    const body = weighted({ 'a.go': 2, 'b.go': 3 }, 20);
    expect(body.lines).toEqual(['b.go:1: hit 1', 'b.go:2: hit 2', 'b.go:3: hit 3', 'a.go:1: hit 1', 'a.go:2: hit 2']);
    expect(body.hiddenLine).toBeNull();
  });

  it('dropRepeatedText (B7) still applies', () => {
    const { kept, fileSummary } = selectGrepFilesByWeight(
      [m('a.go', 1), m('a.go', 2), m('b.go', 4)], { perFileCap: 5, maxFiles: 5 });
    const body = renderGrepBody(kept, fileSummary, 5, { alloc: 'weight', dropRepeatedText: true });
    expect(body.lines).toEqual(['a.go:1', 'a.go:2', 'b.go:4']);
  });

  it('a legacy-shaped engine result (no order marker) renders the same as the weighted engine', () => {
    const r = prng(9);
    for (let c = 0; c < 300; c++) {
      const counts = {};
      for (let i = 0, n = 1 + Math.floor(r() * 25); i < n; i++) {
        counts[`${r() < 0.3 ? 'tests/' : 'src/'}f${i}.go`] = 1 + Math.floor(r() * r() * 30);
      }
      const k = 1 + Math.floor(r() * 30);
      const matches = matchList(counts);
      // both engines keep every file (maxFiles >= files): only the order handling differs
      const legacy = applyGrepFileDiversity(matches, { perFileCap: Math.min(k, 100), maxFiles: 1000 });
      const engine = applyGrepFileDiversity(matches, { perFileCap: Math.min(k, 100), maxFiles: 1000, order: 'weight' });
      expect(renderGrepBody(legacy.kept, legacy.fileSummary, k, { alloc: 'weight' }))
        .toEqual(renderGrepBody(engine.kept, engine.fileSummary, k, { alloc: 'weight' }));
    }
  });

  it('dgraph-08: the answer file leads with 6 lines; the legacy rule gave it 1 line near the bottom', () => {
    const matches = matchList(DGRAPH_08);
    const legacy = applyGrepFileDiversity(matches, { perFileCap: 30, maxFiles: 30 });
    const oldBody = renderGrepBody(legacy.kept, legacy.fileSummary, 30);
    expect(oldBody.lines.filter(l => l.startsWith('worker/export.go:'))).toHaveLength(1);
    const body = weighted(DGRAPH_08, 30);
    const shown = (f) => body.lines.filter(l => l.startsWith(`${f}:`)).length;
    expect(body.lines[0]).toBe('worker/export.go:1: hit 1');
    expect(shown('worker/export.go')).toBe(6);
    expect(body.lines).toHaveLength(30);
    expect(new Set(body.rows.map(r => r.file)).size).toBe(20);   // every file still shows
    expect(shown('worker/export_test.go')).toBe(2);
    expect(shown('buildvars/buildvars_test.go')).toBe(1);
    expect(body.hiddenLine).toBeNull();
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

  it('agent grep with -g globs: the family names no member from an excluded file', async () => {
    const matches = [
      m('src/i32/ivec2.rs', 22, 'pub struct IVec2'),
      m('src/i32/ivec3.rs', 22, 'pub struct IVec3'),
    ];
    const indexed = [
      ...[2, 3, 4].map(width => ({ name: `IVec${width}`, type: 'struct', filePath: `src/i32/ivec${width}.rs` })),
      ...[2, 3, 4].map(width => ({ name: `TVec${width}`, type: 'struct', filePath: `src/tests/tvec${width}.rs` })),
    ];
    const searcher = makeSearcher(matches);
    searcher.codeGraphRepo = {
      findEntitiesInRange: vi.fn((file) => {
        const name = matches.find(match => match.file === file)?.matchText.split(' ').at(-1);
        return name ? [{ name, type: 'struct' }] : [];
      }),
      findFamilyCandidates: vi.fn(() => indexed),
    };
    const run = pathGlobs => bareGrep.call(searcher, 'IVec', null, {
      regex: 'IVec', maxMatches: 0, perFileCap: 30, maxFiles: 30, _isAgentFormat: true,
      ...(pathGlobs ? { pathGlobs } : {}),
    });
    expect((await run()).familyManifest.rendered).toContain('TVec{2,3,4}');
    const res = await run(['!tests/']);
    expect(res.familyManifest.rendered).toContain('IVec{2,3,4}');
    expect(res.familyManifest.rendered).not.toContain('TVec');
    expect((await run(['*.rs', '!ivec4.rs'])).familyManifest.rendered).toContain('IVec{2,3}');
  });

  it('agent grep: hits in test files seed no family (test function names are not a family to complete)', async () => {
    const matches = [
      m('posting/list_test.go', 177, 'addMutationHelper(t, l, edge, Set, txn)'),
      m('posting/list_test.go', 240, 'addMutationHelper(t, ol, edge, Set, txn)'),
      m('posting/list_test.go', 320, 'addMutationHelper(t, ol1, edge, Set, txn)'),
    ];
    const enclosing = { 177: 'TestAddMutation_jchiu1', 240: 'TestAddMutation_jchiu2', 320: 'TestAddMutation_jchiu3' };
    const searcher = makeSearcher(matches);
    searcher.codeGraphRepo = {
      findEntitiesInRange: vi.fn(() => []),
      findEnclosingEntity: vi.fn((file, line) => ({ name: enclosing[line], type: 'function' })),
      findFamilyCandidates: vi.fn(() => Object.values(enclosing).map(name => ({ name, type: 'function', filePath: 'posting/list_test.go' }))),
    };
    const res = await bareGrep.call(searcher, 'addMutationHelper', null, {
      regex: 'addMutationHelper', maxMatches: 0, perFileCap: 30, maxFiles: 30, _isAgentFormat: true,
    });
    expect(res.familyManifest).toBeUndefined();
    expect(searcher.codeGraphRepo.findFamilyCandidates).not.toHaveBeenCalled();
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

  it('two hits in one file (the call site inside toSubQuery + the definition) merge their families', () => {
    // ss-grep "checkSubQuery" -k 20 → L192 (inside toSubQuery) and L210 (checkSubQuery itself).
    const line = buildSingletonSiblingLine([m(JAVA, 192, 'checkSubQuery(subQuery);'), m(JAVA, 210, 'private void checkSubQuery')], squashqlRepo(), {
      regex: 'checkSubQuery', projectRoot: root,
    });
    expect(line.rendered.startsWith('# same file (siblings of toSubQuery, checkSubQuery): 35: private final Map<Measure, CompiledMeasure> subQueryMeasures; · 55: this.subQueryMeasures =')).toBe(true);
    // Neither enclosing method is listed as its own sibling.
    expect(line.rendered).not.toContain('191:');
    expect(line.rendered).not.toContain('210:');
  });

  it('is silent for >3 hits, hits across files, no-enclosing-entity and no-family hits', () => {
    const repo = squashqlRepo();
    expect(buildSingletonSiblingLine([m(JAVA, 212), m(JAVA, 213), m(JAVA, 214), m(JAVA, 215)], repo, { projectRoot: root })).toBeNull();
    expect(buildSingletonSiblingLine([m(JAVA, 212), m('src/Other.java', 3)], repo, { projectRoot: root })).toBeNull();
    expect(buildSingletonSiblingLine([m(JAVA, 5)], repo, { projectRoot: root })).toBeNull();
    // compileMeasure shares no family token with anything and reads no field.
    expect(buildSingletonSiblingLine([m(JAVA, 105)], repo, { projectRoot: root })).toBeNull();
    expect(repo.findEntitiesInFile).toHaveBeenCalledTimes(1); // only the in-entity miss did file work
  });

  it('bareGrep keeps it under the implicit cwd scope of ss-grep (_cwdScope), unlike --in', async () => {
    const searcher = { ...makeSearcher([m(JAVA, 212, 'throw new IllegalArgumentException("sub-query in a sub-query is not supported");')]), projectRoot: root };
    searcher.codeGraphRepo = squashqlRepo();
    const opts = { regex: 'not supported', maxMatches: 0, perFileCap: 20, maxFiles: 20, _isAgentFormat: true, _siblingLine: true };
    const inScope = await bareGrep.call(searcher, 'not supported', null, {
      ...opts, fileFilter: path.join(root, 'src'), _cwdScope: true,
    });
    expect(inScope.results).toHaveLength(1);
    expect(inScope.siblingLine.rendered).toContain('35: private final Map<Measure, CompiledMeasure> subQueryMeasures;');
    const outOfScope = await bareGrep.call(searcher, 'not supported', null, {
      ...opts, fileFilter: path.join(root, 'test'), _cwdScope: true,
    });
    expect(outOfScope.results).toHaveLength(0);
  });

  it('bareGrep attaches it only for agent format without --in, and honours the opt-out', async () => {
    const searcher = { ...makeSearcher([m(JAVA, 212, 'throw new IllegalArgumentException("sub-query in a sub-query is not supported");')]), projectRoot: root };
    searcher.codeGraphRepo = squashqlRepo();
    const agent = await bareGrep.call(searcher, 'not supported', null, {
      regex: 'not supported', maxMatches: 0, perFileCap: 20, maxFiles: 20, _isAgentFormat: true, _siblingLine: true,
    });
    expect(agent.results).toHaveLength(1);
    expect(agent.siblingLine.rendered).toContain('35: private final Map<Measure, CompiledMeasure> subQueryMeasures;');
    const human = await bareGrep.call(searcher, 'not supported', null, { regex: 'not supported', maxMatches: 0 });
    expect(human.siblingLine).toBeUndefined();
    const scoped = await bareGrep.call(searcher, 'not supported', null, {
      regex: 'not supported', maxMatches: 20, fileFilter: 'src', _isAgentFormat: true, _siblingLine: true,
    });
    expect(scoped.siblingLine).toBeUndefined();
    // The switch is an OPTION, not an env read (the daemon's env is whatever spawned
    // it); default on, `_siblingLine: false` opts out.
    const off = await bareGrep.call(searcher, 'not supported', null, {
      regex: 'not supported', maxMatches: 0, perFileCap: 20, maxFiles: 20, _isAgentFormat: true, _siblingLine: false,
    });
    expect(off.siblingLine).toBeUndefined();
  });
});

describe('renderGrepListing (ss-grep output, grouped by file)', () => {
  const FILE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  FILE[9] = '    pub enum ConfigSource {';   // line 10, indented
  FILE[11] = '';                              // line 12, blank
  const files = { 'src/a.rs': FILE, 'src/b.rs': ['fn b() {', '    ConfigSource::Env', '}'] };
  const getLines = (f) => files[f] ?? null;

  it('prints each path once, then `LINE:text` rows; a file with hidden hits says how many on its own line after its last row', () => {
    const rows = [
      { file: 'posting/index.go', line: 497, text: 'func (txn *Txn) addMutationHelper(' },
      { file: 'posting/list_test.go', line: 75, text: 'func addMutationHelper(t *testing.T) {' },
      { file: 'posting/list_test.go', line: 177, text: 'addMutationHelper(t, l, edge, Set, txn)', more: 62 },
    ];
    expect(renderGrepListing(rows)).toEqual([
      'posting/index.go', '497:func (txn *Txn) addMutationHelper(',
      'posting/list_test.go', '75:func addMutationHelper(t *testing.T) {', '177:addMutationHelper(t, l, edge, Set, txn)', '(+62 more)',
    ]);
  });

  it('rows of one file group under one path even when they arrive apart; dropText prints the line only', () => {
    const rows = [{ file: 'a.go', line: 3, text: 'x' }, { file: 'b.go', line: 1, text: 'x' }, { file: 'a.go', line: 9, text: 'x' }];
    expect(renderGrepListing(rows)).toEqual(['a.go', '3:x', '9:x', 'b.go', '1:x']);
    expect(renderGrepListing(rows, { dropText: true })).toEqual(['a.go', '3', '9', 'b.go', '1']);
  });

  it('path rule: a typed --in file prints no heading when alone, its file name next to other files', () => {
    const rows = [{ file: 'src/lib/a.go', line: 3, text: 'x' }, { file: 'src/lib/a.go', line: 9, text: 'y', more: 2 }];
    expect(renderGrepListing(rows, { typed: ['src/lib/a.go'] })).toEqual(['3:x', '9:y', '(+2 more)']);
    expect(renderGrepListing(rows.slice(0, 1), { typed: ['src/lib/a.go'] })).toEqual(['3:x']);
    const two = [{ file: 'src/lib/a.go', line: 3, text: 'x' }, { file: 'src/other/b.go', line: 1, text: 'x' }];
    expect(renderGrepListing(two, { typed: ['src/lib/a.go'] })).toEqual(['a.go', '3:x', 'src/other/b.go', '1:x']);
    // Two files with one name: the typed one prints the suffix that tells them apart.
    const same = [{ file: 'src/lib/a.go', line: 3, text: 'x' }, { file: 'src/old/a.go', line: 1, text: 'x' }];
    expect(renderGrepListing(same, { typed: ['src/lib/a.go'] })).toEqual(['lib/a.go', '3:x', 'src/old/a.go', '1:x']);
  });

  it('context: hit `N:text`, context `N-text`, full indented lines, under the path', () => {
    const out = renderGrepListing([{ file: 'src/a.rs', line: 10, text: 'ConfigSource' }], { before: 1, after: 2, getLines });
    expect(out).toEqual(['src/a.rs', '9-line 9', '10:    pub enum ConfigSource {', '11-line 11', '12-']);
  });

  it('context: merges overlapping and touching windows; -- separates windows of one file, the path separates files', () => {
    const rows = [
      { file: 'src/a.rs', line: 3, text: 'x' },
      { file: 'src/a.rs', line: 5, text: 'x' },     // overlaps 3's window
      { file: 'src/a.rs', line: 8, text: 'x' },     // touches (6..7 | 7..9)
      { file: 'src/a.rs', line: 20, text: 'x' },    // separate window
      { file: 'src/b.rs', line: 2, text: 'x' },     // next file
    ];
    expect(renderGrepListing(rows, { before: 1, after: 1, getLines })).toEqual([
      'src/a.rs', '2-line 2', '3:line 3', '4-line 4', '5:line 5', '6-line 6', '7-line 7', '8:line 8', '9-line 9',
      '--',
      '19-line 19', '20:line 20', '21-line 21',
      'src/b.rs', '1-fn b() {', '2:    ConfigSource::Env', '3-}',
    ]);
  });

  it('context: -A only clamps at end of file; a matching context line prints with `:`', () => {
    expect(renderGrepListing([{ file: 'src/b.rs', line: 2, text: 'x' }], { after: 22, getLines }))
      .toEqual(['src/b.rs', '2:    ConfigSource::Env', '3-}']);
    expect(renderGrepListing([{ file: 'src/a.rs', line: 3, text: 'x', more: 4 }], {
      after: 2, getLines, matchLines: new Map([['src/a.rs', new Set([3, 4])]]),
    })).toEqual(['src/a.rs', '3:line 3', '4:line 4', '5-line 5', '(+4 more)']);
  });

  it('context: an unreadable file or a stale line prints the plain hit row, in order', () => {
    expect(renderGrepListing([
      { file: 'gone.rs', line: 4, text: 'hit', more: 1 },
      { file: 'src/b.rs', line: 99, text: 'stale' },
      { file: 'src/b.rs', line: 2, text: 'x' },
    ], { before: 0, after: 1, getLines })).toEqual(['gone.rs', '4:hit', '(+1 more)', 'src/b.rs', '2:    ConfigSource::Env', '3-}', '--', '99:stale']);
  });

  it('the hidden-files line and the hint', () => {
    expect(renderGrepHiddenFiles(null)).toBeNull();
    expect(renderGrepHiddenFiles({ files: 1, matches: 1, sample: ['a_test.go'] })).toBe('# +1 more file with 1 hit: a_test.go');
    expect(renderGrepHiddenFiles({ files: 6, matches: 10, sample: ['a.go', 'b.go', 'c.go'] }))
      .toBe('# +6 more files with 10 hits: a.go, b.go, c.go');
    expect(GREP_HIDDEN_HINT).toBe('# hidden hits: raise -k or use --in <file>');
  });
});

describe('generated prior: lockfiles, API dumps, blob hit lines; copies collapse (2026-10-05 Codex replays)', () => {
  it('lockfiles take the generated prior; look-alike source does not', () => {
    for (const f of ['web/docs/package-lock.json', 'Cargo.lock', 'go.sum', 'yarn.lock', 'pnpm-lock.yaml',
      'ios/Podfile.lock', 'Package.resolved']) {
      expect(grepFilePrior(f), f).toBe(0.25);
    }
    for (const f of ['src/lock.rs', 'src/clock.go', 'lib/locker/mutex.go', 'api/routes.go', 'src/x.api.ts', 'Package.swift', 'api/payments.api']) {
      expect(grepFilePrior(f), f).toBe(1);
    }
  });

  it('a file whose hit lines are all hash / base64 blobs ranks as generated, whatever its name', () => {
    const blob = (file, line) => ({ file, line, matchText: 'gc',
      content: '"integrity": "sha512-3z0NHDxD6n5I9gc05U1eW1AyRm+Gznzq3naMrthPNqE6oYykcogW0l/jfpQ==",' });
    const code = (file, line) => ({ file, line, matchText: 'gc', content: 'pub fn gc(&self, keep_newer: SystemTime) -> Result<()> {' });
    const matches = [blob('a/deps.json', 1), blob('a/deps.json', 2), blob('a/deps.json', 3), blob('a/deps.json', 4),
      code('b/store.rs', 10), code('b/store.rs', 20)];
    const { fileSummary } = selectGrepFilesByWeight(matches, { maxFiles: 2, perFileCap: 4, order: 'weight' });
    expect(fileSummary.files.map((f) => f.file)).toEqual(['b/store.rs', 'a/deps.json']);
    expect(fileSummary.files[1].prior).toBe(0.25);
  });

  it('long identifiers and URLs are no blob', () => {
    const one = (content) => selectGrepFilesByWeight([{ file: 'a.js', line: 1, matchText: 'x', content }],
      { maxFiles: 1, perFileCap: 1, order: 'weight' }).fileSummary.files[0].prior;
    expect(one('const thisIsAVeryLongIdentifierNameForTestingPurposesOnly123 = 1;')).toBe(1);
    expect(one('"resolved": "https://registry.npmjs.org/lightningcss/-/lightningcss-1.33.0.tgz",')).toBe(1);
    // one hash line is a test vector, not a data file
    expect(one('checksum = "5c6cb57a04249c6480766f7f7cef5467412af1490f8d1e243141daddada3264f"')).toBe(1);
  });

  it('a blob file needs 3+ hits that are all blobs; one ordinary hit keeps the source prior', () => {
    const vec = (line) => ({ file: 'src/aes.ts', line, matchText: 'x', content: '  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",' });
    const prior = (ms) => selectGrepFilesByWeight(ms, { maxFiles: 1, perFileCap: 8, order: 'weight' }).fileSummary.files[0].prior;
    expect(prior([vec(1), vec(2), vec(3)])).toBe(0.25);
    expect(prior([vec(1), vec(2), vec(3), { file: 'src/aes.ts', line: 9, matchText: 'x', content: 'export function encrypt(x) {' }])).toBe(1);
    expect(prior([vec(1), vec(2)])).toBe(1);
    // hits the engine did not hand over (per-file cap) may be ordinary code
    const capped = selectGrepFilesByWeight([vec(1), vec(2), vec(3)], { maxFiles: 1, perFileCap: 8, order: 'weight', totals: new Map([['src/aes.ts', 9]]) });
    expect(capped.fileSummary.files[0].prior).toBe(1);
  });

  it('a copy (same file name, same text, line numbers aside) prints one line with its own hit lines', () => {
    const rows = [
      { file: 'docs/git.md', line: 52, text: 'Garbage collection: Yes.' },
      { file: 'docs/git.md', line: 54, text: 'no garbage collection' },
      { file: 'web/docs/git.md', line: 54, text: 'Garbage collection: Yes.' },
      { file: 'web/docs/git.md', line: 56, text: 'no garbage collection' },
      { file: 'web/other.md', line: 52, text: 'Garbage collection: Yes.' },
      { file: 'web/other.md', line: 54, text: 'no garbage collection' },
    ];
    expect(renderGrepListing(rows)).toEqual([
      'docs/git.md', '52:Garbage collection: Yes.', '54:no garbage collection',
      'web/docs/git.md (same matching lines as docs/git.md, at 54, 56)',
      // another file name is no copy
      'web/other.md', '52:Garbage collection: Yes.', '54:no garbage collection',
    ]);
    // a file with hidden hits never collapses: they may differ
    expect(renderGrepListing([
      { file: 'a/index.ts', line: 10, text: 'export const enabled = true;' },
      { file: 'a/index.ts', line: 12, text: 'x', more: 1 },
      { file: 'b/index.ts', line: 30, text: 'export const enabled = true;' },
      { file: 'b/index.ts', line: 32, text: 'x', more: 1 },
    ])).not.toContain('same matching lines');
    // a line cut short is no evidence
    expect(renderGrepListing([
      { file: 'a/x.ts', line: 1, text: 'const a = 1 … tail' }, { file: 'a/x.ts', line: 2, text: 'b' },
      { file: 'b/x.ts', line: 1, text: 'const a = 1 … tail' }, { file: 'b/x.ts', line: 2, text: 'b' },
    ])).not.toContain('same matching lines');
    // line numbers only (dropText): equal numbers are no evidence of a copy
    expect(renderGrepListing(rows.slice(0, 4), { dropText: true })).toEqual(['docs/git.md', '52', '54', 'web/docs/git.md', '54', '56']);
  });
});
