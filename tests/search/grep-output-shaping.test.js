/**
 * ss-grep k-budget file diversity (grep-output-shaping.js + bareGrep gating).
 *
 * Regression suite for the gradethis-161 flooding failure: one file with more
 * matches than -k consumed every output slot and structurally hid the test
 * file the agent needed, with no signal that elision happened.
 */
import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

import {
  applyGrepFileDiversity,
  allocateGrepBudget,
  renderGrepBody,
  matchesGrepFileFilter,
} from '../../core/search/grep-output-shaping.js';
import { bareGrep } from '../../core/search/index.js';

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
  it('rejects other files and partial basename overlaps', () => {
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'x.R')).toBe(false);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', 'tests/testthat')).toBe(false);
    expect(matchesGrepFileFilter('tests/testthat/test_x.R', '')).toBe(false);
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
});
