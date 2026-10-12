/**
 * The early-stop check behind a scoped ss-grep's `# also N hits outside --in` line.
 *
 * The exact line counts every hit of the regex outside the scope and names the files with the
 * most hits: a whole-repo grep on every `--in <file>` call. Its cost follows the number of
 * matching files: 2-4 ms for a few hundred, 300-800 ms for a license header in 15,600
 * kubernetes files, on a one-file grep that answered in 4 ms.
 *
 * This check samples the gram index's candidates outside the scope. When the sample says
 * many files match, it confirms candidates, source files first, until `limit` match and stops:
 * the line then says `limit`+ files and names those. Otherwise (few candidates, few matching
 * files, or fewer than `limit` found) it answers null and the exact search runs, byte-identical
 * to before, with its hit-ranked names (r3hb-sequel-08: the plugin file it was built to name).
 */

import {
  extractLiteralClauses, prefilterLiteralClauses, querySparseGramCandidates,
  ensureSparseGramIndex, getSparseGramAllFilesWithOverlay, hasCaseInsensitiveRegexFlag,
  nativeGrepFilesWithMatches,
} from './search-pattern-prefilter.js';
import { grepFileFilterPredicate, isOutsideScopeSourceFile } from './grep-output-shaping.js';
import { compilePathGlobs } from './grep-path-globs.js';

// Outside candidates up to this many: the exact search reads them all quickly.
export const OUTSIDE_PROBE_EXACT_MAX_CANDIDATES = 256;
// Estimated matching files up to this many: the exact search stays cheap (2-4 ms measured at
// 26-339 matching files on the eval repos, 52 ms at 2,708 on kubernetes) and keeps its
// hit-ranked names.
export const OUTSIDE_PROBE_EXACT_MAX_MATCHING = 500;
const OUTSIDE_PROBE_SAMPLE = 64;
const OUTSIDE_PROBE_BATCH = 64;

function matchingSet(regex, searchDir, files, caseInsensitive) {
  const result = nativeGrepFilesWithMatches(regex, searchDir, files, caseInsensitive);
  return Array.isArray(result?.matchingFiles) ? new Set(result.matchingFiles) : null;
}

/**
 * @returns {{ files: string[], limit: number } | null} `files` = the first `limit` matching
 *   files outside the scope, source files first, then index order. Null = use the exact search.
 */
export function probeOutsideScope(searcher, regex, searchDir, options, limit) {
  if (!(limit > 0) || !options.fileFilter) return null;
  const index = ensureSparseGramIndex(searcher, options);
  if (!index) return null;
  const caseInsensitive = hasCaseInsensitiveRegexFlag(regex);
  const plan = extractLiteralClauses(regex, options);
  const clauses = prefilterLiteralClauses(plan.clauses, { caseInsensitive });
  const lookup = clauses.gram.length > 0 ? querySparseGramCandidates(searcher, clauses.gram, options) : null;
  const pool = Array.isArray(lookup?.files)
    ? lookup.files
    : (lookup?.eligible === true ? [] : getSparseGramAllFilesWithOverlay(searcher, index, options));
  if (!Array.isArray(pool) || pool.length <= OUTSIDE_PROBE_EXACT_MAX_CANDIDATES) return null;

  const inScope = grepFileFilterPredicate(options.fileFilter, searchDir);
  const globs = compilePathGlobs(options.pathGlobs);
  const outside = (file) => !inScope(file) && (!globs || globs.matches(file));

  // Estimate the matching files from an evenly spaced sample of the candidates.
  const step = pool.length / OUTSIDE_PROBE_SAMPLE;
  const sample = [];
  for (let i = 0; i < OUTSIDE_PROBE_SAMPLE; i++) {
    const file = pool[Math.floor(i * step)];
    if (outside(file)) sample.push(file);
  }
  if (sample.length === 0) return null;
  const sampleHits = matchingSet(regex, searchDir, sample, caseInsensitive);
  if (!sampleHits) return null;
  const estimate = (sampleHits.size / sample.length) * pool.length;
  if (estimate <= OUTSIDE_PROBE_EXACT_MAX_MATCHING) return null;

  // Source files first, in index order; the others are kept for a second pass only if needed.
  const found = [];
  const deferred = [];
  let batch = [];
  const flush = () => {
    const hits = matchingSet(regex, searchDir, batch, caseInsensitive);
    if (!hits) return false;
    for (const file of batch) if (hits.has(file) && found.length < limit) found.push(file);
    batch = [];
    return true;
  };
  for (let i = 0; i < pool.length && found.length < limit; i++) {
    const file = pool[i];
    if (!outside(file)) continue;
    if (!isOutsideScopeSourceFile(file)) { deferred.push(file); continue; }
    batch.push(file);
    if (batch.length === OUTSIDE_PROBE_BATCH && !flush()) return null;
  }
  if (batch.length && found.length < limit && !flush()) return null;
  for (let i = 0; i < deferred.length && found.length < limit; i += OUTSIDE_PROBE_BATCH) {
    batch = deferred.slice(i, i + OUTSIDE_PROBE_BATCH);
    if (!flush()) return null;
  }
  return found.length >= limit ? { files: found, limit } : null;
}
