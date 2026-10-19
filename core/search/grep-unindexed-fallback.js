/**
 * Bare-grep zero-hit fallback: search the files the index may not answer for, and only those.
 *
 * The sparse-gram index holds the grep corpus as of its build plus the reconciler's deltas.
 * What it can still miss is a file created or edited since the build that the reconciler does
 * not track (a grep-only file such as `vendor/…`, a `Makefile`, an untracked script) — its grams
 * are stale or absent. Re-running the whole search with `rg` would turn every true zero into a
 * slow zero, so on 0 hits only git's modified + untracked files are grepped: usually a handful,
 * listed by one `git ls-files` call. Outside git there is no such list and nothing is re-run.
 *
 * The files waiting in the maintainer's reindex queue are grepped too. A committed file the
 * maintainer has not reached yet (after a branch switch, a pull, or while it was stopped) is not
 * in git's changed list, and without this its stale grams answer "no matches".
 *
 * Queued files are grepped when the indexed search has hits as well: the stale grams of a queued
 * file can hide its new lines while other files match (the call sites are indexed, the new
 * definition is not). Only queued files the indexed search did not return are read; a returned
 * file was already read from disk. The native ss-grep lane declines while the queue is not
 * empty (crates/sweet-search-native/src/lane/state.rs reindex_pending), so the JS answers.
 */

import { nativeGrepFull } from '../infrastructure/native-sparse-gram.js';
import { grepFileFilterPredicate } from './grep-output-shaping.js';
import { compilePathGlobs } from './grep-path-globs.js';
import { runRipgrepJson, normalizeSearchPath } from './search-pattern-ripgrep.js';
import {
  ensureSparseGramIndex, getSparseGramAllFilesWithOverlay, hasCaseInsensitiveRegexFlag,
} from './search-pattern-prefilter.js';

async function grepFiles(regex, searchDir, files, fixedString, caseInsensitive = false) {
  if (!fixedString) {
    const native = nativeGrepFull(regex, searchDir, files, hasCaseInsensitiveRegexFlag(regex));
    if (native) {
      const out = [];
      for (const m of native.matches || []) {
        const file = normalizeSearchPath(searchDir, m.file);
        if (file) out.push({ ...m, file });
      }
      return out;
    }
  }
  try {
    // A regex carries its own case flags; fixed-string text takes only the explicit option.
    return await runRipgrepJson(regex, searchDir, { files, fixedString, caseInsensitive: fixedString && caseInsensitive });
  } catch {
    return [];
  }
}

/**
 * @param {object} ctx
 * @param {object} ctx.searcher      the SweetSearch instance (for the grep index's file list)
 * @param {string} ctx.regex
 * @param {string} ctx.searchDir     absolute project root
 * @param {object} ctx.options       bareGrep options (fixedString, fileFilter, _cwdScope, unindexedFallback)
 * @param {Array}  ctx.matches       the shaped matches of the indexed search
 * @param {(result: object) => Array} ctx.shapeResult  bareGrep's symbol / --in / -g shaping
 * @returns {Promise<{matches: Array, stats: object | null}>}
 */
export async function applyUnindexedFallback({ searcher, regex, searchDir, options, matches, shapeResult }) {
  if (options.unindexedFallback === false) return { matches, stats: null };
  const scope = options.fileFilter;
  const inFilter = scope ? grepFileFilterPredicate(scope, searchDir) : null;
  const inScope = (rel) => !inFilter || inFilter(rel);
  // The queue listing is capped, so it takes the -g globs too: the cap then counts only files
  // the answer can show. A copy of bareGrep's compiled globs, so this one does not add to the
  // directories its note lists. (Changed files are not capped; shapeResult applies the globs
  // to their hits and counts what they remove.)
  const globs = compilePathGlobs(options.pathGlobs);
  const inQueueScope = globs ? (rel) => inScope(rel) && globs.matches(rel) : inScope;
  const { listChangedGrepFiles, listPendingReindexFiles } = await import('../indexing/grep-corpus.js');
  if (matches.length > 0) {
    return addQueuedFileMatches({ searcher, regex, searchDir, options, matches, shapeResult, inScope: inQueueScope, listPendingReindexFiles });
  }
  const files = [...new Set([
    ...listChangedGrepFiles(searchDir).filter(inScope),
    ...listPendingReindexFiles(searchDir, { stateDir: searcher?._manifestStateDir, inScope: inQueueScope }),
  ])];
  const stats = { unindexedFallbackFiles: files.length, unindexedFallbackMatches: 0 };
  if (files.length > 0) {
    const found = await grepFiles(regex, searchDir, files, options.fixedString === true, options.caseInsensitive === true);
    if (found.length > 0) {
      const shaped = shapeResult({ indexedMatches: found, overlayMatches: [] });
      stats.unindexedFallbackMatches = shaped.length;
      // The graph holds old (or no) entities for these files: line classes must not trust it.
      if (shaped.length > 0) return { matches: shaped, stats, staleFiles: new Set(shaped.map((m) => m.file)) };
    }
  }
  // An explicit --in that still has no hits: say whether the grep index covers the scope, so
  // the caller does not call a searched scope "not indexed".
  if (scope && options._cwdScope !== true) {
    const index = ensureSparseGramIndex(searcher, options);
    const indexed = index ? getSparseGramAllFilesWithOverlay(searcher, index, options) : null;
    if (Array.isArray(indexed)) stats.scopeInGrepIndex = indexed.some(inScope);
  }
  return { matches, stats };
}

/**
 * Hits in queued files the indexed search did not return. `extraMatches` are shaped (symbol,
 * --in, -g) like the indexed ones; bareGrep merges them into its list. Nothing queued, or no
 * hit = the result unchanged.
 */
async function addQueuedFileMatches({ searcher, regex, searchDir, options, matches, shapeResult, inScope, listPendingReindexFiles }) {
  const pending = listPendingReindexFiles(searchDir, { stateDir: searcher?._manifestStateDir, inScope });
  if (pending.length === 0) return { matches, stats: null };
  const returned = new Set(matches.map((m) => m.file));
  const files = pending.filter((file) => !returned.has(file));
  if (files.length === 0) return { matches, stats: null };
  const stats = { unindexedFallbackFiles: files.length, unindexedFallbackMatches: 0 };
  const found = await grepFiles(regex, searchDir, files, options.fixedString === true, options.caseInsensitive === true);
  if (found.length === 0) return { matches, stats };
  const extraMatches = shapeResult({ indexedMatches: found, overlayMatches: [] })
    .filter((m) => !returned.has(m.file));
  stats.unindexedFallbackMatches = extraMatches.length;
  if (extraMatches.length === 0) return { matches, stats };
  return { matches, stats, extraMatches, staleFiles: new Set(extraMatches.map((m) => m.file)) };
}
