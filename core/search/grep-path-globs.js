/**
 * Path globs for the agent grep tools: ss-grep / ss-find `-g <glob>` (and the grep-habit
 * aliases --include / --exclude / --exclude-dir, which the wrapper rewrites into `-g` form).
 *
 * Agents exclude paths with ripgrep globs (`rg -g '!lib/tests/**'`) and grep flags
 * (`grep --exclude-dir=tests`). ss-grep runs on the in-process native sparse-gram grep, not on
 * ripgrep, and handing these globs to ripgrep would throw that fast path away. So the globs are
 * evaluated HERE, on the repo-relative paths the engine has already produced — the same place
 * and kind of filter as `--in` (matchesGrepFileFilter) — before any count, cap or k budget is
 * computed. A filter like this can only ever REMOVE matches.
 *
 * Semantics follow ripgrep's `-g` (gitignore-style override globs), measured against rg 15.1:
 *
 *   `GLOB`        include: when any include glob is given, a file must match one of them.
 *                 The FILE itself must match (as in rg): `-g lib` or `-g 'lib/*'` includes
 *                 nothing below lib/src; write `-g 'lib/**'`.
 *   `!GLOB`       exclude: a file is excluded when it, OR ANY DIRECTORY ABOVE IT, matches
 *                 (rg prunes a matched directory, so `-g '!tests'` drops every file below
 *                 every `tests/` directory at any depth).
 *   no `/`        matches the basename at any depth (`*.h`, `!*_test.go`, `!tests`).
 *   a `/`         (leading or in the middle) anchors the glob to the repository root
 *                 (`lib/src/*`, `/top.h`). The wrapper has already re-anchored a glob typed
 *                 from a subdirectory (see resolveCwdGlob in cwd-paths.js).
 *   trailing `/`  matches directories only (`!tests/` = every `tests` directory).
 *   `*` `?` `[…]` never cross `/`; `**` as a whole segment crosses directories
 *                 (`**` + `/tests/**`, `lib/**` + `/*.go`); `{a,b}` alternates.
 *   dot files     match like any other name (`*.h` matches `.hidden/z.h`), as in rg.
 *   case          sensitive, as rg's -g.
 *
 * DELIBERATE DEVIATIONS from rg (decided, documented):
 *   1. Exclusion always wins. rg lets the LAST matching glob decide, so
 *      `-g '!src/**' -g 'src/m.h'` searches src/m.h in rg and nothing here. An agent that
 *      excludes a path means it; order-dependent re-inclusion is a trap, not a feature.
 *   2. A leading `./` is read as "anchored here" (`./src/*` = `/src/*`). In rg it matches
 *      nothing at all, which an agent would read as "pattern absent".
 *   3. `\` is always a glob escape, never a path separator (rg's default on Unix).
 */

import { Minimatch } from 'minimatch';

const MINIMATCH_OPTIONS = Object.freeze({
  dot: true,                 // rg: `*` matches dot files
  nocomment: true,           // a leading `#` is a literal, not a comment
  nonegate: true,            // `!` is handled here (include vs exclude), never by minimatch
  platform: 'linux',         // POSIX separators and `\` escapes on every host
  optimizationLevel: 2,
});

/** Split a repo-relative path into whole segments, dropping "" and "." (`./a//b` → [a, b]). */
function segmentsOf(file) {
  return String(file).replace(/\\/g, '/').split('/').filter(s => s !== '' && s !== '.');
}

/**
 * Parse one rg-style glob into its matcher. Returns null for an empty body (`!`, `/`, `''`).
 * @param {string} raw
 */
export function compilePathGlob(raw) {
  if (typeof raw !== 'string') return null;
  let body = raw;
  const exclude = body.startsWith('!');
  if (exclude) body = body.slice(1);
  // Trailing `/` = directories only. Several slashes are one.
  const dirOnly = /\/+$/.test(body);
  body = body.replace(/\/+$/, '');
  // `./x` (deviation 2) and `/x` anchor at the root; the anchor characters are not part of
  // the path that is matched.
  let anchored = false;
  while (body.startsWith('./') || body.startsWith('/')) {
    anchored = true;
    body = body.startsWith('./') ? body.slice(2) : body.slice(1);
  }
  if (body === '' || body === '.') return null;
  if (body.includes('/')) anchored = true;
  // An unanchored glob matches its name at any depth: rg compiles it as `**/glob`. With no
  // `/` in the body, that is exactly "the last segment matches the body", which is far cheaper
  // to test than `**/body` against the whole path.
  const mm = new Minimatch(body, MINIMATCH_OPTIONS);
  return {
    raw, exclude, dirOnly, anchored,
    // `path`: whole repo-relative path; `name`: its last segment.
    match: (path, name) => mm.match(anchored ? path : name),
  };
}

/**
 * Compile a list of rg-style globs into one file predicate.
 *
 * Returns null when there is nothing to apply (no globs, or only empty ones), so a caller
 * can skip the filter entirely and stay byte-identical. `matches(file)` is memoised per
 * file: a grep hands over many matches per file.
 *
 * @param {string[]|string|null|undefined} globs
 * @returns {{ matches: (file: string) => boolean, includes: object[], excludes: object[] } | null}
 */
export function compilePathGlobs(globs) {
  const list = (Array.isArray(globs) ? globs : (globs ? [globs] : []))
    .map(compilePathGlob)
    .filter(Boolean);
  if (list.length === 0) return null;
  const includes = list.filter(g => !g.exclude);
  const excludes = list.filter(g => g.exclude);
  const memo = new Map();
  // Excluded directories, memoised per directory: the files of one directory share the walk.
  const dirMemo = new Map();
  const dirExcluded = (segs, n) => {
    if (n === 0 || excludes.length === 0) return false;
    const dir = segs.slice(0, n).join('/');
    let v = dirMemo.get(dir);
    if (v === undefined) {
      v = dirExcluded(segs, n - 1) || excludes.some(g => g.match(dir, segs[n - 1]));
      dirMemo.set(dir, v);
    }
    return v;
  };
  const decide = (file) => {
    const segs = segmentsOf(file);
    if (segs.length === 0) return false;
    const full = segs.join('/');
    const name = segs[segs.length - 1];
    // Exclusion wins (deviation 1): the file, or any directory above it.
    if (excludes.some(g => !g.dirOnly && g.match(full, name))) return false;
    if (dirExcluded(segs, segs.length - 1)) return false;
    if (includes.length === 0) return true;
    // Include: the file itself must match (a directory-only include matches no file, as in rg).
    return includes.some(g => !g.dirOnly && g.match(full, name));
  };
  return {
    includes,
    excludes,
    matches(file) {
      const key = String(file);
      let v = memo.get(key);
      if (v === undefined) { v = decide(key); memo.set(key, v); }
      return v;
    },
  };
}

/**
 * Keep the matches whose file passes the globs, and count what the globs removed, so a caller
 * can say "your globs excluded N matches" instead of a bare "(no matches)".
 *
 * @param {Array<{file: string}>} matches
 * @param {ReturnType<typeof compilePathGlobs>} compiled  null = no globs, matches unchanged
 * @returns {{ kept: Array, excludedMatches: number, excludedFiles: number }}
 */
export function filterMatchesByPathGlobs(matches, compiled, totals = null) {
  if (!compiled) return { kept: matches, excludedMatches: 0, excludedFiles: 0 };
  const kept = [];
  const droppedFiles = new Set();
  let excludedMatches = 0;
  for (const m of matches || []) {
    if (compiled.matches(m.file)) kept.push(m);
    else { excludedMatches++; droppedFiles.add(m.file); }
  }
  // A capped list (bareGrep): each excluded file counts all its matches.
  if (totals) {
    excludedMatches = 0;
    for (const file of droppedFiles) excludedMatches += totals.get(file) ?? 0;
  }
  return { kept, excludedMatches, excludedFiles: droppedFiles.size };
}

/** True when any glob in the list is non-empty (the wire and the wrapper use this to gate). */
export function hasPathGlobs(globs) {
  return Array.isArray(globs) ? globs.some(g => typeof g === 'string' && g !== '') : false;
}
