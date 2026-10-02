/**
 * Bare-grep zero-hit fallback: search the files the index may not answer for, and only those.
 *
 * The sparse-gram index holds the grep corpus as of its build plus the reconciler's deltas.
 * What it can still miss is a file created or edited since the build that the reconciler does
 * not track (a grep-only file such as `vendor/…`, a `Makefile`, an untracked script) — its grams
 * are stale or absent. Re-running the whole search with `rg` would turn every true zero into a
 * slow zero, so on 0 hits only git's modified + untracked files are grepped: usually a handful,
 * listed by one `git ls-files` call. Outside git there is no such list and nothing is re-run.
 */

import { nativeGrepFull } from '../infrastructure/native-sparse-gram.js';
import { matchesGrepFileFilter } from './grep-output-shaping.js';
import { runRipgrepJson, normalizeSearchPath } from './search-pattern-ripgrep.js';
import {
  ensureSparseGramIndex, getSparseGramAllFilesWithOverlay, hasCaseInsensitiveRegexFlag,
} from './search-pattern-prefilter.js';

async function grepFiles(regex, searchDir, files, fixedString) {
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
    return await runRipgrepJson(regex, searchDir, { files, fixedString });
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
  if (matches.length > 0 || options.unindexedFallback === false) return { matches, stats: null };
  const scope = options.fileFilter;
  const inScope = (rel) => !scope || matchesGrepFileFilter(rel, scope, searchDir);
  const { listChangedGrepFiles } = await import('../indexing/grep-corpus.js');
  const files = listChangedGrepFiles(searchDir).filter(inScope);
  const stats = { unindexedFallbackFiles: files.length, unindexedFallbackMatches: 0 };
  if (files.length > 0) {
    const found = await grepFiles(regex, searchDir, files, options.fixedString === true);
    if (found.length > 0) {
      const shaped = shapeResult({ indexedMatches: found, overlayMatches: [] });
      stats.unindexedFallbackMatches = shaped.length;
      if (shaped.length > 0) return { matches: shaped, stats };
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
