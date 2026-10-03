/**
 * Agent-facing grep output shaping: k-budget file-level diversity.
 *
 * Root cause (task bench, rstudio-education__gradethis-161): bareGrep returns
 * matches sorted alphabetically by file and the agent wrapper printed the
 * first k grouped by file — so one flooded early-alphabet file could consume
 * the entire k budget and structurally hide every other matching file, with
 * no signal that elision happened.
 *
 * These helpers are pure and option-gated: only the ss-grep agent wrapper
 * enables them. The human-facing grep product shape and all NL ranking paths
 * are untouched.
 *
 * Two line-allocation rules live here:
 *   legacy (SS_FIX_GREP_ALLOC=0): the first maxFiles files in path order, k lines
 *     round robin over them in path order (applyGrepFileDiversity without `order`,
 *     renderGrepBody without `alloc`). Byte for byte the pre-2026-10-02 output.
 *   weight (default): every matching file is a candidate; the engine keeps the
 *     maxFiles files of highest weight = sqrt(hits) x prior (prior 1 source, 0.5
 *     test/spec/fixture, 0.25 generated/vendored/minified) and the k lines are shared
 *     by Sainte-Laguë. Files print in descending weight. Replay of 1,036 recorded dev grep
 *     calls on the engine's own match sets (exploratory; eval/grep-allocation-replay, which
 *     reproduces the tool's output on 106 of 106 sampled calls): on the 154 calls with more
 *     files than k, answer-file inclusion is 82.1% legacy vs 81.2% weighted, with more
 *     answer lines (2.21 vs 1.95). The earlier 71.1% -> 83.0% came from an rg replay that
 *     also counted documentation files the grep index never returns. 100% either way when
 *     every file fits.
 *
 * Arms (grep-allocation-rules.js, grep-line-classes.js; sat2, guarantee and line classes are
 * DEFAULT ON in ss-grep since 2026-10-03, the renderer default stays the legacy rule): SS_FIX_GREP_WEIGHT=sat2,
 * SS_FIX_GREP_ALLOC_RULE=guarantee|hh, SS_FIX_GREP_LINES (which stored matches a file shows).
 */

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { grepHitText, isTestLikePath } from './agent-output-fixes.js';
import { allocateGrepLinesWithFirstLine, grepWeightKey } from './grep-allocation-rules.js';
import { selectGrepLinesByClass } from './grep-line-classes.js';

/** Split a path into whole segments, dropping "" and "." (so "./a//b" → [a,b]). */
function pathSegments(value) {
  return String(value).replace(/\\/g, '/').split('/').filter(s => s !== '' && s !== '.');
}

/** Segments of the root's real path, or null when it does not resolve. Cached per root. */
const _canonicalRoots = new Map();
function canonicalRootSegments(projectRoot) {
  if (!_canonicalRoots.has(projectRoot)) {
    let segs = null;
    try { segs = pathSegments(realpathSync.native(projectRoot)); } catch { segs = null; }
    _canonicalRoots.set(projectRoot, segs);
  }
  return _canonicalRoots.get(projectRoot);
}

/** POSIX, drive-letter, and UNC spellings after slash normalization. */
function isAbsolutePath(value) {
  const normalized = String(value).replace(/\\/g, '/');
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

/**
 * True when a match's repo-relative path lies inside a drill-in scope.
 *
 * Matching is on WHOLE path segments — the scope's segments must appear as a
 * contiguous run of the target's segments — so every reasonable spelling an
 * agent can paste is accepted while `x.R` still never matches `test_x.R`:
 *
 *   exact path            tests/testthat/test_x.R
 *   ./-prefixed           ./tests/testthat/test_x.R
 *   trailing segments     testthat/test_x.R   ·   test_x.R
 *   DIRECTORY from root   tests   ·   tests/testthat   ·   tests/testthat/
 *   DIRECTORY by name     testthat
 *
 * The two directory rows are the fix. The previous rule required the run to end
 * at the final segment, so a directory scope matched nothing at all: `ss-grep
 * … --in tests/testthat` printed "(no matches)" — indistinguishable from a
 * regex that genuinely misses — instead of scoping to the directory.
 *
 * ROOT-ANCHORED FIRST. A relative scope that exists at the repository root
 * (`GRDB/Core/TransactionObserver.swift`, `src`) means that path, as `grep -r … <path>`
 * does: it matches the path itself and what lies under it, never a nested copy of
 * the same segments (r3-grdb: `Tests/CustomSQLite/GRDB -> ../..` made 33 copies of
 * that file match, 1,716 hits for a one-file drill-in). Only a scope that does not
 * exist at the root falls back to the segment-run match above. Without a projectRoot
 * the segment-run match is the only rule.
 *
 * SAFETY: this is a pure post-filter over repo-relative paths the engine has
 * already produced. It can only ever REMOVE results, never widen a read, so no
 * scope can reach outside the repository root. A scope carrying a `..` segment
 * is rejected outright, so an escape cannot even be spelled.
 *
 * @param {string} file - repo-relative match path (as emitted by the engine)
 * @param {string|string[]} filter - user-supplied --in value(s); any one matching wins
 * @param {string|null} projectRoot - absolute root required to validate absolute scopes
 * @returns {boolean}
 */
export function matchesGrepFileFilter(file, filter, projectRoot = null) {
  return grepFileFilterPredicate(filter, projectRoot)(file);
}

/**
 * matchesGrepFileFilter as a predicate over many files: each scope is resolved once (the
 * root-existence check of a relative scope is one stat per scope, not one per match).
 *
 * @param {string|string[]} filter - user-supplied --in value(s); any one matching wins
 * @param {string|null} projectRoot - absolute repository root
 * @returns {(file: string) => boolean}
 */
export function grepFileFilterPredicate(filter, projectRoot = null) {
  if (!filter) return () => false;
  const root = projectRoot ? pathSegments(projectRoot) : null;
  const scopes = Array.isArray(filter) ? filter : [filter];
  const runAt = (hay, needle, start) => {
    for (let i = 0; i < needle.length; i++) if (hay[start + i] !== needle[i]) return false;
    return true;
  };
  const tests = scopes.map((raw) => {
    if (!raw) return null;
    let scope = pathSegments(raw);
    if (scope.includes('..')) return null;
    // WHOLE-REPO scope. `.` and `./` carry no segments, and the old rule rejected an empty
    // segment list outright — so `--in .` matched NOTHING and printed "(no matches)", the
    // one answer that reads as "your pattern is absent". It fired on 5 calls in the fresh
    // pool, 4 of which had real hits. A relative scope of "here" means the repository, so
    // accept every repo-relative path — exactly what an unscoped grep already does. An
    // ABSOLUTE scope with no segments is "/", the filesystem root, which is a different
    // claim; it falls through to the absolute branch below and is rejected there.
    if (scope.length === 0 && !isAbsolutePath(raw)) return () => true;

    // ABSOLUTE scope. It is meaningful only relative to the repository root
    // that produced the repo-relative target. Suffix inference is unsafe:
    // `/tmp/other-repo/src` must never scope this repository's `src/a.js`.
    // Once the root is stripped, keep the remainder root-anchored as well — an
    // exact `/repo/src` scope must not match `nested/src/a.js`.
    if (isAbsolutePath(raw)) {
      if (!root || !isAbsolutePath(projectRoot)) return null;
      // The same directory can have two spellings (macOS /tmp → /private/tmp). The
      // implicit cwd scope of ss-grep is a real path; the engine root may be either.
      const realRoot = canonicalRootSegments(projectRoot);
      const anchor = (scope.length >= root.length && runAt(scope, root, 0)) ? root
        : (realRoot && scope.length >= realRoot.length && runAt(scope, realRoot, 0)) ? realRoot
          : null;
      if (!anchor) return null;
      // (a bare "/" has fewer segments than any real root, so it is rejected above)
      scope = scope.slice(anchor.length);
      if (scope.length === 0) return () => true;
      return (target) => scope.length <= target.length && runAt(target, scope, 0);
    }

    // ROOT-ANCHORED: the scope names a path at the repository root.
    let atRoot = false;
    if (projectRoot && isAbsolutePath(projectRoot)) {
      try { atRoot = existsSync(path.join(projectRoot, ...scope)); } catch { atRoot = false; }
    }
    if (atRoot) return (target) => scope.length <= target.length && runAt(target, scope, 0);

    return (target) => {
      if (scope.length > target.length) return false;
      for (let start = 0; start + scope.length <= target.length; start++) {
        if (runAt(target, scope, start)) return true;
      }
      return false;
    };
  }).filter(Boolean);
  return (file) => {
    if (!file) return false;
    const target = pathSegments(file);
    if (target.length === 0) return false;
    return tests.some((test) => test(target));
  };
}

/**
 * Streaming per-file diversification of a (file,line)-sorted match list.
 * Keeps at most `perFileCap` matches per file and at most `maxFiles` distinct
 * files; everything beyond is COUNTED but never stored, so memory is bounded
 * by perFileCap*maxFiles regardless of total match count.
 *
 * PRECONDITION: matches must be grouped by file (bareGrep sorts by
 * (file, line, column) before calling) — the walk uses a single per-file
 * cursor precisely so no map proportional to distinct-file count is built.
 *
 * `order: 'weight'` keeps the maxFiles files of highest weight instead of the first
 * maxFiles in path order (see selectGrepFilesByWeight). Absent = the legacy walk below.
 *
 * `totals` (bareGrep's capped list): each file's full match count, when `matches` holds only
 * the first ones of a file (at least perFileCap of them, or all). Counts then come from it.
 *
 * @param {Array<{file: string}>} matches - sorted by (file, line)
 * @param {{perFileCap: number, maxFiles?: number, hiddenSampleSize?: number, order?: 'weight', weight?: 'sat2', totals?: Map<string, number>}} opts
 * @returns {{kept: Array, fileSummary: {
 *   files: Array<{file: string, total: number, kept: number}>,
 *   hiddenFileCount: number, hiddenMatchCount: number,
 *   hiddenSample: Array<{file: string, total: number}>,
 * }}}
 */
export function applyGrepFileDiversity(matches, opts = {}) {
  if (opts.order === 'weight') return selectGrepFilesByWeight(matches, opts);
  const perFileCap = Math.max(1, opts.perFileCap | 0);
  const maxFiles = opts.maxFiles > 0 ? (opts.maxFiles | 0) : Infinity;
  const hiddenSampleSize = opts.hiddenSampleSize ?? 3;

  const kept = [];
  const files = [];            // [{file, total, kept}] in first-appearance (sorted) order
  const hiddenSample = [];     // first few hidden files, name + total
  let hiddenFileCount = 0;
  let hiddenMatchCount = 0;

  const totals = opts.totals || null;
  let current = null;
  for (const m of matches) {
    if (!current || current.file !== m.file) {
      if (files.length < maxFiles) {
        current = { file: m.file, total: 0, kept: 0 };
        files.push(current);
      } else {
        current = { file: m.file, total: 0, kept: -1 }; // hidden file: count only
        hiddenFileCount++;
        if (hiddenSample.length < hiddenSampleSize) {
          hiddenSample.push(current);
        }
      }
      if (totals) {
        current.total = totals.get(m.file) ?? 0;
        if (current.kept < 0) hiddenMatchCount += current.total;
      }
    }
    if (!totals) current.total++;
    if (current.kept >= 0 && current.kept < perFileCap) {
      kept.push(m);
      current.kept++;
    } else if (current.kept < 0 && !totals) {
      hiddenMatchCount++;
    }
  }

  return {
    kept,
    fileSummary: {
      files,
      hiddenFileCount,
      hiddenMatchCount,
      hiddenSample: hiddenSample.map(h => ({ file: h.file, total: h.total })),
    },
  };
}

// --- weighted rule (SS_FIX_GREP_ALLOC, default ON) ----------------------------------------
//
// weight(file) = sqrt(hits) x prior. Every comparison below uses the SQUARE of the weight,
// scaled to an integer: key = hits x scale with scale = 16 x prior^2 (16 source, 4 test,
// 1 generated). Squaring keeps every order and every Sainte-Laguë quotient comparison
// (w_i/(2a_i+1) vs w_j/(2a_j+1)  <=>  key_i (2a_j+1)^2 vs key_j (2a_i+1)^2), needs no sqrt
// at all, and is exact: integer products stay far below 2^53, so a tie is a real tie.
//
// Ties: higher hits first, then engine path order (bareGrep's localeCompare sort; the start
// offset of a file's group in the sorted match list encodes it).

/** Generated, vendored or minified by path shape (the replay's rule); precompiled once. */
const GENERATED_PATH_RE = /\.pb\.go$|_pb2\.py$|\.generated\.|(^|\/)(vendor|dist|build|node_modules)\/|\.min\.js$/i;

/**
 * One-regex pre-check: every test rule (isTestLikePath) and every generated rule above
 * needs one of these substrings, so a path without any of them is plain source and skips
 * the full checks. Measured on the recorded agent calls: ~150 ns per file, ~2 µs per call.
 * (Not memoised: the engine hands every match a fresh path string, so a Map lookup must
 * hash the path and costs about as much as this pass; a per-directory variant was slower.)
 */
const PRIOR_KEYWORD_RE = /test|spec|fixture|mock|e2e|pb2?[._]|generated|vendor|dist\/|build\/|node_modules|\.min\./i;

const SCALE_SOURCE = 16;  // prior 1
const SCALE_TEST = 4;     // prior 0.5
const SCALE_GENERATED = 1; // prior 0.25

function priorScale(file) {
  if (!PRIOR_KEYWORD_RE.test(file)) return SCALE_SOURCE;
  if (GENERATED_PATH_RE.test(file)) return SCALE_GENERATED;
  return isTestLikePath(file) ? SCALE_TEST : SCALE_SOURCE;
}

/** The file-type prior of a match path: 1 source, 0.5 test/spec/fixture, 0.25 generated/vendored/minified. */
export function grepFilePrior(file) {
  const scale = priorScale(String(file || ''));
  return scale === SCALE_SOURCE ? 1 : scale === SCALE_TEST ? 0.5 : 0.25;
}

/** a better than b: larger key, then more hits, then earlier in path order. */
function betterFile(keyA, totA, ordA, keyB, totB, ordB) {
  return keyA > keyB || (keyA === keyB && (totA > totB || (totA === totB && ordA < ordB)));
}

// The selection heap: one Float64Array, three slots per file (key, hits, start offset), the
// WORST kept file at the root. Module-level functions over a typed array: no closure, no
// context-variable access, no allocation per file.
function fileHeapSiftDown(h, size, pos) {
  const key = h[3 * pos]; const tot = h[3 * pos + 1]; const ord = h[3 * pos + 2];
  for (;;) {
    let c = 2 * pos + 1;
    if (c >= size) break;
    if (c + 1 < size && betterFile(h[3 * c], h[3 * c + 1], h[3 * c + 2], h[3 * c + 3], h[3 * c + 4], h[3 * c + 5])) c++;
    if (!betterFile(key, tot, ord, h[3 * c], h[3 * c + 1], h[3 * c + 2])) break;
    h[3 * pos] = h[3 * c]; h[3 * pos + 1] = h[3 * c + 1]; h[3 * pos + 2] = h[3 * c + 2];
    pos = c;
  }
  h[3 * pos] = key; h[3 * pos + 1] = tot; h[3 * pos + 2] = ord;
}

function fileHeapPush(h, size, key, tot, ord) {
  let pos = size;
  while (pos > 0) {
    const p = (pos - 1) >> 1;
    if (!betterFile(h[3 * p], h[3 * p + 1], h[3 * p + 2], key, tot, ord)) break;
    h[3 * pos] = h[3 * p]; h[3 * pos + 1] = h[3 * p + 1]; h[3 * pos + 2] = h[3 * p + 2];
    pos = p;
  }
  h[3 * pos] = key; h[3 * pos + 1] = tot; h[3 * pos + 2] = ord;
}

/** Insert into the best-first hidden sample `s` (three slots per file, at most `max` files). */
function sampleInsert(s, len, max, key, tot, ord) {
  let pos = len < max ? len : max - 1;
  if (pos < 0 || (len === max && !betterFile(key, tot, ord, s[3 * pos], s[3 * pos + 1], s[3 * pos + 2]))) return len;
  while (pos > 0 && betterFile(key, tot, ord, s[3 * pos - 3], s[3 * pos - 2], s[3 * pos - 1])) {
    s[3 * pos] = s[3 * pos - 3]; s[3 * pos + 1] = s[3 * pos - 2]; s[3 * pos + 2] = s[3 * pos - 1];
    pos--;
  }
  s[3 * pos] = key; s[3 * pos + 1] = tot; s[3 * pos + 2] = ord;
  return len < max ? len + 1 : len;
}

/**
 * Streaming top-maxFiles file selection by weight over a (file,line)-sorted match list.
 *
 * A file's hit count is known when its group ends; the file then competes for one of
 * maxFiles slots in a min-heap (worst kept file at the root). Nothing is copied while
 * streaming: a file is (start offset, hits, key), its matches stay in the input. The prior
 * is computed only when the file could still win a slot or a hidden-sample place: its key
 * is at most hits x 16, so when that bound does not beat the worst entry, the file is
 * counted and skipped. On a 10,000-file flood of 1-hit files almost no file pays for it.
 *
 * Memory: the heap holds at most maxFiles entries and `kept` at most perFileCap x maxFiles
 * matches, as in the legacy walk. Everything else is counted for the hidden-files line.
 *
 * `weight: 'sat2'` (SS_FIX_GREP_WEIGHT) ranks by hits / (hits + 2) x prior instead;
 * fileSummary.weight then says so. Absent = sqrt(hits) x prior.
 *
 * @returns same shape as applyGrepFileDiversity; files in descending weight, each with
 *   its `prior`; kept grouped per file in that order (line order inside a file);
 *   hiddenSample = the highest-weight hidden files; fileSummary.order = 'weight'.
 */
export function selectGrepFilesByWeight(matches, opts = {}) {
  const sat = opts.weight === 'sat2';
  const perFileCap = Math.max(1, opts.perFileCap | 0);
  const maxFiles = opts.maxFiles > 0 ? (opts.maxFiles | 0) : Infinity;
  const sampleSize = Math.max(0, opts.hiddenSampleSize ?? 3);
  const n = matches.length;

  // A finite maxFiles (every ss-grep call) sizes the heap once; an unbounded one grows it.
  let capacity = Math.max(1, Math.min(maxFiles, n, Number.isFinite(maxFiles) ? n : 256));
  let heap = new Float64Array(3 * capacity);
  let size = 0;
  const sample = new Float64Array(3 * Math.max(1, sampleSize));
  let sampleLen = 0;
  let hiddenFileCount = 0;
  let hiddenMatchCount = 0;

  let i = 0;
  const totals = opts.totals || null;
  while (i < n) {
    const start = i;
    const file = matches[i].file;
    i++;
    while (i < n && matches[i].file === file) i++;
    const total = totals ? (totals.get(file) ?? 0) : i - start;
    const bound = sat ? grepWeightKey(total, SCALE_SOURCE, 'sat2') : total * SCALE_SOURCE;
    if (size === maxFiles && bound <= heap[0]) {
      // Cannot beat the worst kept file (equal bound: fewer-or-equal hits, later path).
      hiddenFileCount++;
      hiddenMatchCount += total;
      if (sampleLen < sampleSize || bound > sample[3 * sampleSize - 3]) {
        const scale = priorScale(file);
        sampleLen = sampleInsert(sample, sampleLen, sampleSize, sat ? grepWeightKey(total, scale, 'sat2') : total * scale, total, start);
      }
      continue;
    }
    const key = sat ? grepWeightKey(total, priorScale(file), 'sat2') : total * priorScale(file);
    if (size < maxFiles) {
      if (size === capacity) {
        const grown = new Float64Array(heap.length * 2);
        grown.set(heap);
        heap = grown;
        capacity *= 2;
      }
      fileHeapPush(heap, size++, key, total, start);
      continue;
    }
    hiddenFileCount++;
    if (betterFile(key, total, start, heap[0], heap[1], heap[2])) {
      const outKey = heap[0]; const outTot = heap[1]; const outOrd = heap[2];
      heap[0] = key; heap[1] = total; heap[2] = start;
      fileHeapSiftDown(heap, size, 0);
      hiddenMatchCount += outTot;
      sampleLen = sampleInsert(sample, sampleLen, sampleSize, outKey, outTot, outOrd);
    } else {
      hiddenMatchCount += total;
      sampleLen = sampleInsert(sample, sampleLen, sampleSize, key, total, start);
    }
  }

  // Drain the heap worst-first into the tail: files[] ends up best first.
  const files = new Array(size);
  const ords = new Int32Array(size);
  while (size > 0) {
    const last = size - 1;
    const key = heap[0]; const tot = heap[1]; const ord = heap[2];
    heap[0] = heap[3 * last]; heap[1] = heap[3 * last + 1]; heap[2] = heap[3 * last + 2];
    size = last;
    if (size > 0) fileHeapSiftDown(heap, size, 0);
    ords[last] = ord;
    const scale = sat ? priorScale(matches[ord].file) : key / tot;
    files[last] = { file: matches[ord].file, total: tot, kept: Math.min(tot, perFileCap), prior: scale === SCALE_SOURCE ? 1 : scale === SCALE_TEST ? 0.5 : 0.25 };
  }
  const kept = [];
  for (let f = 0; f < files.length; f++) {
    const end = ords[f] + files[f].kept;
    for (let j = ords[f]; j < end; j++) kept.push(matches[j]);
  }
  const hiddenSample = new Array(sampleLen);
  for (let s = 0; s < sampleLen; s++) hiddenSample[s] = { file: matches[sample[3 * s + 2]].file, total: sample[3 * s + 1] };

  return {
    kept,
    fileSummary: { files, hiddenFileCount, hiddenMatchCount, hiddenSample, order: 'weight', ...(sat ? { weight: 'sat2' } : {}) },
  };
}

/**
 * Sainte-Laguë line allocation: each next line goes to the file with the largest
 * weight / (2 x linesGiven + 1), never beyond the file's stored matches (`caps`). No floor
 * round: a heavy file can take a second line before a light file gets its first.
 * Ties: more hits first, then the earlier file.
 *
 * PRECONDITION: files in weight order (key desc, hits desc, path asc), as
 * selectGrepFilesByWeight returns them. A file that never got a line is then dominated by
 * the first such file, so only files already holding a line plus that one frontier file
 * compete: a max-heap of at most min(files, budget) + 1 entries, O(budget x log budget)
 * however many files matched. Typed arrays, no allocation in the loop.
 *
 * @param {ArrayLike<number>} keys - hits x prior scale (16 x weight^2)
 * @param {ArrayLike<number>} totals - hits per file (tie-break)
 * @param {ArrayLike<number>} caps - stored matches per file (lines it can show)
 * @param {number} budget - lines to give (k)
 * @returns {Int32Array} lines per file, same order as the input
 */
export function allocateGrepLinesSainteLague(keys, totals, caps, budget) {
  const n = keys.length;
  const alloc = new Int32Array(n);
  let remaining = Math.max(0, budget | 0);
  if (n === 0 || remaining === 0) return alloc;
  const heap = new Int32Array(Math.min(n, remaining) + 1);
  let size = 0;
  let next = 0;
  // q_a > q_b <=> keys[a] (2 alloc[b] + 1)^2 > keys[b] (2 alloc[a] + 1)^2
  const better = (a, b) => {
    const da = 2 * alloc[a] + 1; const db = 2 * alloc[b] + 1;
    const lhs = keys[a] * db * db; const rhs = keys[b] * da * da;
    return lhs > rhs || (lhs === rhs && (totals[a] > totals[b] || (totals[a] === totals[b] && a < b)));
  };
  const siftUp = (pos) => {
    const f = heap[pos];
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (!better(f, heap[parent])) break;
      heap[pos] = heap[parent];
      pos = parent;
    }
    heap[pos] = f;
  };
  const siftDown = (pos) => {
    const f = heap[pos];
    for (;;) {
      let child = 2 * pos + 1;
      if (child >= size) break;
      if (child + 1 < size && better(heap[child + 1], heap[child])) child++;
      if (!better(heap[child], f)) break;
      heap[pos] = heap[child];
      pos = child;
    }
    heap[pos] = f;
  };
  const pushFrontier = () => {
    while (next < n && !(caps[next] > 0)) next++;
    if (next < n) { heap[size] = next++; siftUp(size++); }
  };
  pushFrontier();
  while (remaining > 0 && size > 0) {
    const f = heap[0];
    const first = alloc[f] === 0;
    alloc[f]++;
    remaining--;
    if (alloc[f] < caps[f]) siftDown(0);
    else { heap[0] = heap[--size]; if (size > 0) siftDown(0); }
    if (first) pushFrontier();
  }
  return alloc;
}

/** renderGrepBody under the weighted rule (opts.alloc === 'weight'). */
function renderGrepBodyWeighted(kept, fileSummary, k, opts) {
  const summaryFiles = fileSummary.files || [];
  const weight = opts.weight === 'sat2' ? 'sat2' : undefined;
  // Fast path: the engine already handed files in this weight's order, kept contiguous per file.
  let order = null;
  let groups = null;
  if (fileSummary.order === 'weight' && fileSummary.weight === weight) {
    let off = 0;
    let contiguous = true;
    for (const f of summaryFiles) {
      if (f.kept > 0 && kept[off]?.file !== f.file) { contiguous = false; break; }
      off += f.kept;
    }
    if (contiguous && off === kept.length) order = summaryFiles;
  }
  if (!order) {
    // Anything else (a pre-change engine, a caller's own match list): group, weigh, sort.
    // At most maxFiles files, never the whole match list.
    groups = new Map();
    for (const m of kept) {
      let g = groups.get(m.file);
      if (!g) { g = []; groups.set(m.file, g); }
      g.push(m);
    }
    const listed = new Set(summaryFiles.map(f => f.file));
    const pool = summaryFiles.map((f, idx) => ({ ...f, kept: groups.get(f.file)?.length ?? 0, idx }));
    for (const [file, ms] of groups) {
      if (!listed.has(file)) pool.push({ file, total: ms.length, kept: ms.length, idx: pool.length });
    }
    for (const f of pool) f.prior = grepFilePrior(f.file);
    const keyOf = f => grepWeightKey(f.total, f.prior * f.prior * SCALE_SOURCE, weight);
    pool.sort((a, b) => keyOf(b) - keyOf(a) || b.total - a.total || a.idx - b.idx);
    order = pool;
  }

  const n = order.length;
  const keys = new Float64Array(n);
  const totals = new Float64Array(n);
  const caps = new Int32Array(n);
  for (let f = 0; f < n; f++) {
    const p = order[f].prior ?? 1;
    totals[f] = order[f].total;
    keys[f] = grepWeightKey(order[f].total, p * p * SCALE_SOURCE, weight);
    caps[f] = order[f].kept;
  }
  const alloc = opts.rule === 'guarantee' || opts.rule === 'hh'
    ? allocateGrepLinesWithFirstLine(keys, totals, caps, k, opts.rule)
    : allocateGrepLinesSainteLague(keys, totals, caps, k);

  const rows = [];
  let shownMatches = 0;
  let truncatedFileCount = 0;
  let off = 0;
  const unallocated = [];
  for (let f = 0; f < n; f++) {
    const { file, total } = order[f];
    const ms = groups ? groups.get(file) : null;
    const base = off;
    off += caps[f];
    const a = alloc[f];
    if (a === 0) { unallocated.push(order[f]); continue; }
    const picks = opts.lineClasses === true && a < caps[f]
      ? selectGrepLinesByClass(ms || kept.slice(base, base + caps[f]), a)
      : null;
    for (let j = 0; j < a; j++) {
      const at = picks ? picks[j] : j;
      const m = ms ? ms[at] : kept[base + at];
      const text = grepHitText(m, { fullLine: opts?.fullLine === true });
      let more = 0;
      if (j === a - 1 && total > a) {
        more = total - a;
        truncatedFileCount++;
      }
      rows.push({ file, line: m.line, text, more });
      shownMatches++;
    }
  }
  return finishGrepBody(rows, unallocated, fileSummary, shownMatches, truncatedFileCount, opts);
}

/**
 * Breadth-first budget allocation: round-robin one line per file per round,
 * in the given (deterministic) file order, until `budget` lines are allocated
 * or every file's available matches are exhausted. Flooding is structurally
 * impossible — file A gets its (r+1)-th line only after every other file got
 * its r-th — while few-files queries keep full depth (deep rounds fill just
 * like the old flat output).
 *
 * @param {number[]} counts - available (fetched) matches per file
 * @param {number} budget - total lines to allocate (k)
 * @returns {number[]} allocation per file, same order as counts
 */
export function allocateGrepBudget(counts, budget) {
  const alloc = counts.map(() => 0);
  let remaining = Math.max(0, budget | 0);
  let progressed = true;
  while (remaining > 0 && progressed) {
    progressed = false;
    for (let i = 0; i < counts.length && remaining > 0; i++) {
      if (alloc[i] < counts[i]) {
        alloc[i]++;
        remaining--;
        progressed = true;
      }
    }
  }
  return alloc;
}

/**
 * Render the diversified agent grep body: matches grouped per file (research:
 * contiguous per-file blocks read better than interleaving) with allocation
 * decided breadth-first, and a visible inline `(+N more in this file)` marker
 * on the last shown line of every truncated file — elision is never silent
 * and costs no extra lines.
 *
 * @param {Array<{file: string, line: number, matchText?: string, content?: string}>} kept -
 *   diversified matches in engine order (grouped by file)
 * @param {{files: Array<{file, total, kept}>, hiddenFileCount, hiddenMatchCount,
 *          hiddenSample: Array<{file, total}>}} fileSummary
 * @param {number} k - body line budget
 * @param {{dropRepeatedText?: boolean, alloc?: 'weight', fullLine?: boolean, weight?: 'sat2',
 *          rule?: 'guarantee'|'hh', lineClasses?: boolean}} [opts] - SS_FIX_GREP_ORDER: when
 *   every shown hit prints the same text (and more than one hit shows), print `file:line`
 *   only. `fullLine` (SS_FIX_GREP_FULLLINE, default ON in ss-grep): each hit prints its full
 *   source line (grepHitText), not the matched substring. `alloc: 'weight'` (SS_FIX_GREP_ALLOC,
 *   default ON in ss-grep): files in descending weight, lines shared by Sainte-Laguë
 *   (allocateGrepLinesSainteLague), the hidden-files examples are the highest-weight hidden
 *   files. Under `alloc: 'weight'` only: `weight` (SS_FIX_GREP_WEIGHT), `rule`
 *   (SS_FIX_GREP_ALLOC_RULE) and `lineClasses` (SS_FIX_GREP_LINES: a file with fewer lines than
 *   stored matches shows its lowest `lineClass` matches, in line order; rows without a class
 *   keep the prefix).
 *   Absent = the original format, byte for byte.
 * @returns {{lines: string[], rows: Array<{file, line, text, more}>, shownMatches: number,
 *            matchedFileCount: number, truncatedFileCount: number, hiddenLine: string|null}}
 *   `rows[i]` is the hit printed as `lines[i]` (for grep context rendering).
 */
export function renderGrepBody(kept, fileSummary, k, opts = undefined) {
  if (opts?.alloc === 'weight') return renderGrepBodyWeighted(kept, fileSummary, k, opts);
  const groups = new Map();
  for (const m of kept) {
    if (!groups.has(m.file)) groups.set(m.file, []);
    groups.get(m.file).push(m);
  }
  const totals = new Map(fileSummary.files.map(f => [f.file, f.total]));
  const ordered = [...groups.entries()];
  const alloc = allocateGrepBudget(ordered.map(([, ms]) => ms.length), k);

  const rows = [];
  let shownMatches = 0;
  let truncatedFileCount = 0;
  const unallocated = []; // fetched files that got zero budget (more files than k)
  ordered.forEach(([file, ms], i) => {
    if (alloc[i] === 0) {
      unallocated.push({ file, total: totals.get(file) ?? ms.length });
      return;
    }
    const total = totals.get(file) ?? ms.length;
    for (let j = 0; j < alloc[i]; j++) {
      const m = ms[j];
      const text = grepHitText(m, { fullLine: opts?.fullLine === true });
      let more = 0;
      if (j === alloc[i] - 1 && total > alloc[i]) {
        more = total - alloc[i];
        truncatedFileCount++;
      }
      rows.push({ file, line: m.line, text, more });
      shownMatches++;
    }
  });
  return finishGrepBody(rows, unallocated, fileSummary, shownMatches, truncatedFileCount, opts);
}

/** Shared tail of both rules: printed lines, the hidden-files line, the counts. */
function finishGrepBody(rows, unallocated, fileSummary, shownMatches, truncatedFileCount, opts) {
  const dropText = opts?.dropRepeatedText === true
    && rows.length > 1 && rows.every(row => row.text === rows[0].text);
  const lines = rows.map((row) => {
    let line = dropText ? `${row.file}:${row.line}` : `${row.file}:${row.line}: ${row.text}`;
    if (row.more) line += ` (+${row.more} more in this file)`;
    return line;
  });

  // Files that matched but got no body line at all (more matching files than
  // budget, or clipped by the engine's maxFiles fetch bound): one honest tail
  // line naming the first few (path order under the legacy rule, highest weight under
  // alloc: 'weight') so the agent can jump straight to them.
  const hiddenFiles = unallocated.length + fileSummary.hiddenFileCount;
  const hiddenMatches = unallocated.reduce((a, f) => a + f.total, 0) + fileSummary.hiddenMatchCount;
  let hiddenLine = null;
  if (hiddenFiles > 0) {
    const sample = [...unallocated.map(f => f.file), ...fileSummary.hiddenSample.map(f => f.file)]
      .slice(0, 3);
    hiddenLine = `# +${hiddenFiles} more file(s) with ${hiddenMatches} match(es)` +
      (sample.length ? ` — e.g. ${sample.join(', ')}` : '') +
      `; narrow the regex, raise -k, or drill in with --in <file>`;
  }

  return {
    lines,
    rows,
    shownMatches,
    matchedFileCount: fileSummary.files.length + fileSummary.hiddenFileCount,
    truncatedFileCount,
    hiddenLine,
  };
}

/**
 * Replace the lowest-ranked complete grep lines with an indexed family
 * manifest, but only when those lines fully fund the manifest's estimated
 * tokens. The input is never mutated and an underfunded manifest is omitted.
 */
export function reallocateGrepTailForManifest(lines, manifest, estimateTokens = (text) => (
  text ? Math.ceil(text.length / 3.5) : 0
)) {
  if (!Array.isArray(lines) || !manifest?.rendered || lines.length === 0) {
    return { lines, familyManifest: null, removedLineCount: 0 };
  }
  const required = estimateTokens(`${manifest.rendered}\n`);
  let reclaimed = 0;
  let keep = lines.length;
  while (keep > 0 && reclaimed < required) {
    keep--;
    reclaimed += estimateTokens(`${lines[keep]}\n`);
  }
  if (reclaimed < required) {
    return { lines, familyManifest: null, removedLineCount: 0 };
  }
  return {
    lines: lines.slice(0, keep),
    familyManifest: { ...manifest, tokens: required },
    removedLineCount: lines.length - keep,
  };
}

/**
 * `grep -n -A/-B/-C` rendering of the hits ss-grep already chose to show.
 *
 * Agents read grep's own shape without instruction, so this is that shape: a hit
 * is `file:LINE: text`, a context line is `file-LINE- text`, overlapping or
 * touching windows of one file merge into one group, and groups are separated by
 * `--`. Every printed line is the FULL source line (indentation kept), not the
 * matched substring the context-free body prints. A line that matches the regex
 * but was not itself a shown hit still prints with `:`, as grep would.
 *
 * Pure: file contents come from `getLines(file)` (1-based line i is element i-1;
 * null when unreadable, in which case that file's hits print as plain hit lines).
 *
 * @param {Array<{file: string, line: number, text?: string, suffix?: string}>} rows -
 *   shown hits in display order; `suffix` (a truncation marker) is kept on its hit
 * @param {{before?: number, after?: number,
 *          getLines: (file: string) => string[]|null,
 *          matchLines?: Map<string, Set<number>>}} opts
 * @returns {string[]} output lines
 */
export function renderGrepContext(rows, { before = 0, after = 0, getLines, matchLines } = {}) {
  const groups = [];
  for (const row of rows || []) {
    const last = groups[groups.length - 1];
    if (last && last.file === row.file) last.rows.push(row);
    else groups.push({ file: row.file, rows: [row] });
  }
  const blocks = [];
  for (const { file, rows: hits } of groups) {
    const lines = getLines ? getLines(file) : null;
    const plain = (row) => `${row.file}:${row.line}: ${row.text ?? ''}${row.suffix || ''}`;
    const windows = [];
    for (const row of [...hits].sort((a, b) => a.line - b.line)) {
      if (!lines || row.line < 1 || row.line > lines.length) {
        windows.push({ plain: plain(row) });           // stale or unreadable: the hit alone
        continue;
      }
      const start = Math.max(1, row.line - before);
      const end = Math.min(lines.length, row.line + after);
      const cur = windows[windows.length - 1];
      if (cur && !cur.plain && start <= cur.end + 1) {
        cur.end = Math.max(cur.end, end);
        cur.hits.set(row.line, row);
      } else {
        windows.push({ start, end, hits: new Map([[row.line, row]]) });
      }
    }
    const matched = matchLines?.get(file);
    for (const w of windows) {
      if (w.plain) { blocks.push([w.plain]); continue; }
      const out = [];
      for (let n = w.start; n <= w.end; n++) {
        const text = String(lines[n - 1] ?? '').replace(/\r$/, '');
        const hit = w.hits.get(n);
        if (hit) out.push(`${file}:${n}: ${text}${hit.suffix || ''}`);
        else if (matched?.has(n)) out.push(`${file}:${n}: ${text}`);
        else out.push(text ? `${file}-${n}- ${text}` : `${file}-${n}-`);
      }
      blocks.push(out);
    }
  }
  const result = [];
  blocks.forEach((block, i) => {
    if (i > 0) result.push('--');
    result.push(...block);
  });
  return result;
}
