/**
 * The cost bound behind a scoped ss-grep's `# also N hits outside --in` line.
 *
 * The exact line counts every hit of the regex outside the scope and names the files with the
 * most hits: a whole-repo grep on every `--in <file>` call. Its cost follows the files it must
 * read, the gram index's candidates: ~11 us a file on kubernetes, so 2 ms for sequel's 756
 * candidates but 33 ms for 3,023 (`volMountStatus|criproxy`, 15 matching files) and 300-800 ms
 * for a license header in 26,000.
 *
 * Up to OUTSIDE_PROBE_EXACT_MAX_CANDIDATES candidates the exact search runs, byte-identical to
 * before, with its hit-ranked names (r3hb-sequel-08: the plugin file it was built to name). Past
 * that, this reads at most a budget of candidates, source files first, and stops at `limit`
 * matching files: the line then says `N+ files` and names those.
 */

import path from 'node:path';
import {
  extractLiteralClauses, prefilterLiteralClauses, ensureSparseGramIndex,
  getSparseGramAllFilesWithOverlay, hasCaseInsensitiveRegexFlag, nativeGrepFull,
} from './search-pattern-prefilter.js';
import { grepFileFilterPredicate, isOutsideScopeSourceFile } from './grep-output-shaping.js';
import { compilePathGlobs } from './grep-path-globs.js';

// Candidates up to this many: the exact search reads them all (<= ~9 ms on kubernetes).
export const OUTSIDE_PROBE_EXACT_MAX_CANDIDATES = 800;
// Candidate files read at most past that: ~1.2 ms per 512 on kubernetes. A scope with no hit
// of its own reads more, since then the line is the only sign the pattern exists.
export const OUTSIDE_PROBE_READ_BUDGET = 512;
export const OUTSIDE_PROBE_READ_BUDGET_EMPTY_SCOPE = 2048;
const OUTSIDE_PROBE_BATCH = 64;

/**
 * The gram index's candidates, each clause capped just past the exact limit (the native
 * query stops there: 0.2-0.3 ms, not 3-11 ms for a 26,000-file list). `over` = more than the
 * exact limit; the list then holds the first capped files of each clause, in index order.
 * Null = the regex has no literal the index can use.
 */
function cappedCandidates(index, gramClauses) {
  if (!gramClauses.length) return null;
  const cap = OUTSIDE_PROBE_EXACT_MAX_CANDIDATES + 1;
  const files = new Set();
  let over = false;
  for (const clause of gramClauses) {
    const result = index.queryLiterals(clause, cap, 0);
    if (!result?.eligible || !Array.isArray(result.files)) return null;
    if (result.files.length >= cap) over = true;
    for (const file of result.files) files.add(file);
  }
  return { files: [...files], over: over || files.size > OUTSIDE_PROBE_EXACT_MAX_CANDIDATES };
}

/**
 * @returns {{ files: string[], limit: number, complete: boolean } | null} `files` = matching
 *   files outside the scope, source files first, at most `limit`; `complete` = every candidate
 *   was read, so the count is exact. Null = run the exact search.
 */
export function probeOutsideScope(searcher, regex, searchDir, options, limit) {
  if (!(limit > 0) || !options.fileFilter) return null;
  const index = ensureSparseGramIndex(searcher, options);
  if (typeof index?.queryLiterals !== 'function') return null;
  const caseInsensitive = hasCaseInsensitiveRegexFlag(regex);
  const plan = extractLiteralClauses(regex, options);
  const clauses = prefilterLiteralClauses(plan.clauses, { caseInsensitive });
  const capped = cappedCandidates(index, clauses.gram);
  if (capped && !capped.over) return null;
  const pool = capped ? capped.files : getSparseGramAllFilesWithOverlay(searcher, index, options);
  if (!Array.isArray(pool) || pool.length <= OUTSIDE_PROBE_EXACT_MAX_CANDIDATES) return null;

  const inScope = grepFileFilterPredicate(options.fileFilter, searchDir);
  const globs = compilePathGlobs(options.pathGlobs);
  const source = [];
  const other = [];
  for (const file of pool) {
    if (inScope(file) || (globs && !globs.matches(file))) continue;
    (isOutsideScopeSourceFile(file) ? source : other).push(file);
  }
  // A scope that answered prints only for a source file outside (renderOutsideScopeProbeLine):
  // with no source match after the last source file, nothing more can print.
  const scopeAnswered = options.grepOutsideScopedTotal !== 0;
  const ordered = source.concat(other);
  const budget = scopeAnswered ? OUTSIDE_PROBE_READ_BUDGET : OUTSIDE_PROBE_READ_BUDGET_EMPTY_SCOPE;
  const toRead = Math.min(ordered.length, budget);
  const found = [];
  let read = 0;
  while (read < toRead && found.length < limit) {
    if (scopeAnswered && read >= source.length && found.length === 0) break;
    // The first batch finds a flood's files; past it, few matches: read the rest in bigger
    // batches (fewer native calls).
    const size = read === 0 || found.length >= limit / 4 ? OUTSIDE_PROBE_BATCH : OUTSIDE_PROBE_BATCH * 4;
    const batch = ordered.slice(read, Math.min(read + size, toRead));
    read += batch.length;
    const result = nativeGrepFull(regex, searchDir, batch, caseInsensitive, { perFileCap: 1, indexPaths: true });
    if (!Array.isArray(result?.matches)) return null;
    const hit = new Set(result.matches.map((m) => (path.isAbsolute(m.file) ? path.relative(searchDir, m.file) : m.file)));
    // The addon answers in any order: keep the batch's own order.
    for (const file of batch) if (hit.has(file) && found.length < limit) found.push(file);
  }
  // Every candidate read = the file count is exact. A capped list is never all candidates.
  const complete = !capped?.over && read === ordered.length && found.length < limit;
  if (scopeAnswered && found.length && !isOutsideScopeSourceFile(found[0])) return { files: [], limit, complete };
  return { files: found, limit, complete };
}
