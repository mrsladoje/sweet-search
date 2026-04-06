/**
 * Regex Prefiltering Module — literal extraction and sparse gram candidate lookup.
 *
 * Extracts required literal substrings from regex patterns, then uses either
 * ripgrep fixed-string prefiltering or the sparse trigram index to narrow the
 * file set before the full regex scan.  Keeps the hot-path fast by skipping
 * files that cannot possibly match.
 *
 * Split from search-pattern.js for the 500-line-limit rule.
 */

import {
  extractRegexLiteralClauses,
  loadSparseGramIndex,
  loadChunkGramIndex,
  hasNativeChunkGramSupport,
  buildChunkGramIndexArtifact,
  resolveSparseSymbolMask as _resolveSparseSymbolMask,
  nativeGrepFilesWithMatches as _nativeGrepFilesWithMatches,
  nativeGrepFilesWithMatchesFixed as _nativeGrepFilesWithMatchesFixed,
  nativeGrepLines as _nativeGrepLines,
  nativeGrepFull as _nativeGrepFull,
  nativeGrepChunkRanges as _nativeGrepChunkRanges,
  chunkGramSearch as _chunkGramSearch,
  getSparseGramAllFiles as _getSparseGramAllFiles,
  queryAndGrepLines as _queryAndGrepLines,
  queryAndGrepFull as _queryAndGrepFull,
} from '../infrastructure/native-sparse-gram.js';

// Re-export for search-pattern.js (avoids circular import through native-sparse-gram.js)
export const resolveSparseSymbolMask = _resolveSparseSymbolMask;
export const nativeGrepFilesWithMatches = _nativeGrepFilesWithMatches;
export const nativeGrepFilesWithMatchesFixed = _nativeGrepFilesWithMatchesFixed;
export const nativeGrepLines = _nativeGrepLines;
export const nativeGrepFull = _nativeGrepFull;
export const nativeGrepChunkRanges = _nativeGrepChunkRanges;
export const chunkGramSearch = _chunkGramSearch;
export const getSparseGramAllFiles = _getSparseGramAllFiles;
export const queryAndGrepLines = _queryAndGrepLines;
export const queryAndGrepFull = _queryAndGrepFull;
import { existsSync, mkdirSync } from 'fs';
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { CODE_FILE_EXTENSIONS } from '../infrastructure/constants.js';
import { isRipgrepCodePath, resolveSearchSymbolFilter } from './search-pattern-chunks.js';

// =============================================================================
// Case-insensitive flag detection
// =============================================================================

export function hasCaseInsensitiveRegexFlag(regex) {
  return /\(\?[a-z-]*i[a-z-]*:?/.test(regex);
}

// =============================================================================
// Literal extraction from regex patterns
// =============================================================================

export function extractRequiredLiteralsHeuristic(regex) {
  if (!regex || typeof regex !== 'string') return [];

  let inClass = false;
  let escape = false;
  let current = '';
  const literals = [];

  const pushCurrent = () => {
    if (current.length >= 3) literals.push(current);
    current = '';
  };

  for (const char of regex) {
    if (escape) {
      if (/[\w/-]/.test(char)) {
        current += char;
      } else {
        pushCurrent();
      }
      escape = false;
      continue;
    }

    if (char === '\\') {
      pushCurrent();
      escape = true;
      continue;
    }

    if (inClass) {
      if (char === ']') inClass = false;
      pushCurrent();
      continue;
    }

    if (char === '[') {
      inClass = true;
      pushCurrent();
      continue;
    }

    if (char === '|') {
      // Alternation means neither side is universally required.
      // Return empty to avoid false negatives — a prefilter using
      // literals from one branch would exclude files matching the other.
      return [];
    }

    if (/[.*+?^${}()]/.test(char)) {
      pushCurrent();
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();

  return [...new Set(literals)];
}

export function extractLiteralClausesHeuristic(regex) {
  const literals = extractRequiredLiteralsHeuristic(regex);
  return literals.length > 0 ? [literals] : [];
}

export function normalizeLiteralClauses(clauses) {
  if (!Array.isArray(clauses)) return [];

  const normalized = [];
  for (const clause of clauses) {
    if (!Array.isArray(clause)) continue;
    const deduped = [];
    for (const literal of clause) {
      if (typeof literal !== 'string') continue;
      const trimmed = literal.trim();
      if (trimmed.length < 3 || deduped.includes(trimmed)) continue;
      deduped.push(trimmed);
    }
    if (deduped.length === 0) continue;
    if (!normalized.some(existing => existing.length === deduped.length && existing.every((value, idx) => value === deduped[idx]))) {
      normalized.push(deduped);
    }
  }

  return normalized;
}

export function extractLiteralClauses(regex, options = {}) {
  if (!regex || typeof regex !== 'string') {
    return { clauses: [], source: 'none' };
  }

  if (!options.forceHeuristic) {
    try {
      const nativeResult = extractRegexLiteralClauses(regex);
      const nativeClauses = normalizeLiteralClauses(nativeResult?.clauses);
      if (nativeClauses.length > 0) {
        return { clauses: nativeClauses, source: 'native' };
      }
    } catch {
      // Fall back to heuristic extraction below.
    }
  }

  const heuristicClauses = extractLiteralClausesHeuristic(regex);
  if (heuristicClauses.length > 0) {
    return { clauses: heuristicClauses, source: 'heuristic' };
  }

  return { clauses: [], source: 'none' };
}

// =============================================================================
// Literal prefiltering via ripgrep fixed-string mode
// =============================================================================

/**
 * Run literal prefilter for a single AND-clause of literals.
 *
 * Accepts `rgFunctions` to avoid a circular import with search-pattern.js.
 * The caller (generateRegexMatches) passes { getRgCapabilities, runRipgrepFilesWithMatches }.
 */
async function runLiteralPrefilter(literals, searchDir, files, opts, rgFunctions) {
  if (!Array.isArray(literals) || literals.length === 0) {
    return Array.isArray(files) ? [...files] : null;
  }

  const caseInsensitive = opts.caseInsensitive ?? false;
  const timeout = opts.timeout ?? 10000;
  const globs = opts.globs ?? [];
  const { supportsAnd } = rgFunctions.getRgCapabilities();

  if (supportsAnd && literals.length > 1) {
    return rgFunctions.runRipgrepFilesWithMatches(literals, searchDir, {
      files,
      fixedString: true,
      caseInsensitive,
      globs,
      timeout,
      useAnd: true,
    });
  }

  let currentFiles = files;
  for (const literal of literals) {
    currentFiles = await rgFunctions.runRipgrepFilesWithMatches(literal, searchDir, {
      files: currentFiles,
      fixedString: true,
      caseInsensitive,
      globs,
      timeout,
    });
    if (Array.isArray(currentFiles) && currentFiles.length === 0) {
      break;
    }
  }

  return currentFiles;
}

/**
 * Run literal prefilter across OR-clauses (each clause is an AND-set of literals).
 *
 * Accepts `rgFunctions` to avoid a circular import with search-pattern.js.
 */
export async function runLiteralPrefilterClauses(clauses, searchDir, files = null, opts = {}, rgFunctions = {}) {
  if (!Array.isArray(clauses) || clauses.length === 0) {
    return Array.isArray(files) ? [...files] : null;
  }

  const combined = new Set();
  for (const clause of clauses) {
    if (!Array.isArray(clause) || clause.length === 0) {
      return Array.isArray(files) ? [...files] : null;
    }
    const clauseMatches = await runLiteralPrefilter(clause, searchDir, files, opts, rgFunctions);
    if (!Array.isArray(clauseMatches)) {
      return null;
    }
    for (const file of clauseMatches) combined.add(file);
  }

  return [...combined];
}

// =============================================================================
// Sparse gram index candidate lookup
// =============================================================================

export function ensureSparseGramIndex(searcher, options = {}) {
  if (!searcher) return null;
  if (searcher.sparseGramIndex) return searcher.sparseGramIndex;

  const indexPath = options.sparseGramIndexPath || searcher.sparseGramIndexPath || DB_PATHS.sparseGramIndex;
  const loaded = loadSparseGramIndex(indexPath);
  if (loaded) {
    searcher.sparseGramIndex = loaded;
  }
  return loaded;
}

export function querySparseGramCandidates(searcher, literalClauses, options = {}) {
  const useGramIndex = options.useGramIndex ?? options.gramIndex ?? true;
  if (!useGramIndex) {
    return {
      eligible: false,
      reason: 'disabled',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }
  if (!Array.isArray(literalClauses) || literalClauses.length === 0) {
    return {
      eligible: false,
      reason: 'not_eligible',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }

  try {
    const sparseGramIndex = ensureSparseGramIndex(searcher, options);
    if (!sparseGramIndex) {
      return {
        eligible: false,
        reason: 'not_loaded',
        totalFiles: 0,
        gramsUsed: 0,
        denseGramsTouched: 0,
        sparseGramsTouched: 0,
        candidateFiles: 0,
        files: null,
      };
    }

    const maxCandidateFiles = options.maxGramCandidateFiles ?? 2048;
    const maxCandidateRatio = options.maxGramCandidateRatio ?? 0.30;
    const symbolMask = _resolveSparseSymbolMask(resolveSearchSymbolFilter(options));
    const combined = new Set();
    let totalFiles = 0;
    let gramsUsed = 0;
    let denseGramsTouched = 0;
    let sparseGramsTouched = 0;

    for (const clause of literalClauses) {
      if (!Array.isArray(clause) || clause.length === 0) {
        return {
          eligible: false,
          reason: 'not_eligible',
          totalFiles,
          gramsUsed,
          denseGramsTouched,
          sparseGramsTouched,
          candidateFiles: 0,
          files: null,
        };
      }
      const result = sparseGramIndex.queryLiterals(
        clause,
        options.maxGramCandidates ?? 0,
        symbolMask || 0
      );
      if (!result?.eligible) {
        return {
          eligible: false,
          reason: 'not_eligible',
          totalFiles: Math.max(totalFiles, result?.totalFiles || 0),
          gramsUsed: gramsUsed + (result?.gramsUsed || 0),
          denseGramsTouched: denseGramsTouched + (result?.denseGramsTouched || 0),
          sparseGramsTouched: sparseGramsTouched + (result?.sparseGramsTouched || 0),
          candidateFiles: Array.isArray(result?.files) ? result.files.length : 0,
          files: null,
        };
      }
      totalFiles = Math.max(totalFiles, result.totalFiles || 0);
      gramsUsed += result.gramsUsed || 0;
      denseGramsTouched += result.denseGramsTouched || 0;
      sparseGramsTouched += result.sparseGramsTouched || 0;
      const clauseFiles = Array.isArray(result.files)
        ? result.files.filter(isRipgrepCodePath)
        : [];
      if (
        clauseFiles.length === 0 ||
        clauseFiles.length > maxCandidateFiles ||
        (result.totalFiles > 0 && (clauseFiles.length / result.totalFiles) > maxCandidateRatio)
      ) {
        return {
          eligible: false,
          reason: 'too_broad',
          totalFiles,
          gramsUsed,
          denseGramsTouched,
          sparseGramsTouched,
          candidateFiles: clauseFiles.length,
          files: null,
        };
      }
      for (const file of clauseFiles) combined.add(file);
    }

    const files = [...combined];
    if (
      files.length === 0 ||
      files.length > maxCandidateFiles ||
      (totalFiles > 0 && (files.length / totalFiles) > maxCandidateRatio)
    ) {
      return {
        eligible: false,
        reason: 'too_broad',
        totalFiles,
        gramsUsed,
        denseGramsTouched,
        sparseGramsTouched,
        candidateFiles: files.length,
        files: null,
      };
    }

    return {
      eligible: true,
      reason: 'ok',
      totalFiles,
      gramsUsed,
      denseGramsTouched,
      sparseGramsTouched,
      candidateFiles: files.length,
      files,
    };
  } catch {
    return {
      eligible: false,
      reason: 'error',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }
}

// =============================================================================
// Chunk-level gram index candidate lookup
// =============================================================================

let _chunkGramBuildAttempted = false;

export function ensureChunkGramIndex(searcher, options = {}) {
  if (!searcher) return null;
  if (searcher.chunkGramIndex) return searcher.chunkGramIndex;

  const indexPath = options.chunkGramIndexPath || searcher.chunkGramIndexPath || DB_PATHS.chunkGramIndex;
  let loaded = loadChunkGramIndex(indexPath);

  // Lazy build: if no on-disk index but LI index is loaded, build from LI documents
  if (!loaded && !_chunkGramBuildAttempted && hasNativeChunkGramSupport() && searcher.lateInteractionIndex?.documents?.size > 0) {
    _chunkGramBuildAttempted = true;
    try {
      const chunks = [];
      for (const [, doc] of searcher.lateInteractionIndex.documents) {
        const meta = doc.metadata;
        if (meta?.file && meta.startLine != null && meta.endLine != null) {
          chunks.push({ filePath: meta.file, startLine: meta.startLine, endLine: meta.endLine });
        }
      }
      if (chunks.length > 0) {
        const dir = indexPath.substring(0, indexPath.lastIndexOf('/'));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const projectRoot = searcher.projectRoot || PROJECT_ROOT;
        buildChunkGramIndexArtifact({ projectRoot, chunks, outputPath: indexPath });
        loaded = loadChunkGramIndex(indexPath);
      }
    } catch {
      // Lazy build is best-effort; fall back to no chunk gram
    }
  }

  if (loaded) {
    searcher.chunkGramIndex = loaded;
  }
  return loaded;
}

/**
 * Query the chunk-level gram index. Returns candidate chunk RANGES when
 * selective enough — not just files. The caller passes these ranges to
 * nativeGrepChunkRanges for regex verification on only those line ranges,
 * then maps verified chunks straight to MaxSim (skipping mapMatchesToChunks).
 *
 * @returns {{ eligible: boolean, reason: string, chunkRanges: Array|null, totalChunks: number, candidateChunks: number }}
 */
export function queryChunkGramCandidates(searcher, literalClauses, options = {}) {
  const useChunkGram = options.useChunkGram ?? true;
  if (!useChunkGram) {
    return { eligible: false, reason: 'disabled', chunkRanges: null, totalChunks: 0, candidateChunks: 0 };
  }

  if (!Array.isArray(literalClauses) || literalClauses.length === 0) {
    return { eligible: false, reason: 'not_eligible', chunkRanges: null, totalChunks: 0, candidateChunks: 0 };
  }

  try {
    const chunkGramIndex = ensureChunkGramIndex(searcher, options);
    if (!chunkGramIndex) {
      return { eligible: false, reason: 'not_loaded', chunkRanges: null, totalChunks: 0, candidateChunks: 0 };
    }

    // Gate: chunk ratio <= 20% (generous — real filtering is by the verifier).
    // File dedup count <= 2048 (limits file reads for verification).
    const maxCandidateRatio = options.maxChunkGramCandidateRatio ?? 0.20;
    const maxCandidateFiles = options.maxChunkGramCandidateFiles ?? 2048;
    let allChunkHits = [];
    let totalChunks = 0;
    let candidateChunks = 0;

    for (const clause of literalClauses) {
      if (!Array.isArray(clause) || clause.length === 0) {
        return { eligible: false, reason: 'not_eligible', chunkRanges: null, totalChunks, candidateChunks };
      }

      const result = chunkGramIndex.queryLiterals(clause);
      if (!result?.eligible) {
        return { eligible: false, reason: 'not_eligible', chunkRanges: null, totalChunks: result?.totalChunks || 0, candidateChunks: 0 };
      }

      totalChunks = Math.max(totalChunks, result.totalChunks || 0);
      candidateChunks += result.candidateChunks || 0;

      const hits = (result.chunkIds || []).filter(c => isRipgrepCodePath(c.file));
      allChunkHits = allChunkHits.length === 0 ? hits : allChunkHits.concat(hits);
    }

    const ratio = totalChunks > 0 ? candidateChunks / totalChunks : 1;
    const uniqueFiles = new Set(allChunkHits.map(c => c.file));

    if (allChunkHits.length === 0 || uniqueFiles.size > maxCandidateFiles || ratio > maxCandidateRatio) {
      return { eligible: false, reason: 'too_broad', chunkRanges: null, totalChunks, candidateChunks };
    }

    // Return chunk ranges for the verifier (nativeGrepChunkRanges)
    const chunkRanges = allChunkHits.map(c => ({
      file: c.file,
      startLine: c.startLine,
      endLine: c.endLine,
      chunkId: c.chunkId,
    }));

    return { eligible: true, reason: 'ok', chunkRanges, totalChunks, candidateChunks };
  } catch {
    return { eligible: false, reason: 'error', chunkRanges: null, totalChunks: 0, candidateChunks: 0 };
  }
}
