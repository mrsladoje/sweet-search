/**
 * Native sparse-gram wrapper — loads/builds the Rust-backed pattern prefilter
 * artifact via the existing napi addon.
 */

import { existsSync } from 'fs';
import { createRequire } from 'module';
import { resolveNativeAddon } from './native-resolver.js';

const require = createRequire(import.meta.url);

let _addon = null;
let _addonLoaded = false;

export const SPARSE_SYMBOL_MASKS = {
  function: 1 << 0,
  class: 1 << 1,
  method: 1 << 2,
  import: 1 << 3,
  type: 1 << 4,
  other: 1 << 5,
};

export function resolveSparseSymbolMask(symbolType) {
  if (typeof symbolType !== 'string') return 0;

  const normalized = symbolType.trim().toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes('function')) return SPARSE_SYMBOL_MASKS.function;
  if (normalized.includes('method')) return SPARSE_SYMBOL_MASKS.method;
  if (normalized.includes('class')) return SPARSE_SYMBOL_MASKS.class;
  if (normalized.includes('import')) return SPARSE_SYMBOL_MASKS.import;
  if (
    normalized.includes('type') ||
    normalized.includes('interface') ||
    normalized.includes('enum') ||
    normalized.includes('typedef')
  ) {
    return SPARSE_SYMBOL_MASKS.type;
  }
  return SPARSE_SYMBOL_MASKS.other;
}

function loadAddon() {
  if (_addonLoaded) return _addon;
  _addonLoaded = true;

  try {
    const addonPath = resolveNativeAddon();
    if (!addonPath) return null;
    const mod = require(addonPath);
    if (
      typeof mod.buildSparseGramIndex === 'function' &&
      typeof mod.NativeSparseGramIndex?.load === 'function' &&
      typeof mod.extractRegexLiterals === 'function'
    ) {
      _addon = mod;
    }
  } catch {
    // Native addon is optional; callers decide whether to warn or fall back.
  }

  return _addon;
}

export function hasNativeSparseGramSupport() {
  return !!loadAddon();
}

export function buildSparseGramIndexArtifact({ projectRoot, files, fileSymbolMasks = [], outputPath }) {
  const addon = loadAddon();
  if (!addon) {
    throw new Error(
      'Native sparse gram support is unavailable on this platform. ' +
      'Run with the native addon installed or fall back to literal prefilter only.'
    );
  }
  return addon.buildSparseGramIndex(projectRoot, files, fileSymbolMasks, outputPath);
}

export function loadSparseGramIndex(indexPath) {
  if (!indexPath || !existsSync(indexPath)) return null;

  const addon = loadAddon();
  if (!addon) return null;

  return addon.NativeSparseGramIndex.load(indexPath);
}

export function extractRegexLiteralClauses(regex) {
  const addon = loadAddon();
  if (!addon) return null;
  return addon.extractRegexLiterals(regex);
}

/**
 * In-process regex file matching using the native addon's regex + rayon.
 * Replaces `rg --files-with-matches` to eliminate spawn overhead (~3ms).
 * Returns null if the native addon is unavailable (falls back to rg).
 */
export function nativeGrepFilesWithMatches(pattern, projectRoot, files, caseInsensitive) {
  const addon = loadAddon();
  if (!addon?.nativeGrepFilesWithMatches) return null;
  try {
    return addon.nativeGrepFilesWithMatches(pattern, projectRoot, files, caseInsensitive || false);
  } catch {
    return null; // Fall back to rg on regex incompatibility
  }
}

/**
 * In-process regex line-level matching using the native addon's regex + rayon + mmap.
 * Replaces `rg --json` for narrowed queries — eliminates spawn + JSON parse overhead.
 * Returns null if the native addon is unavailable (falls back to rg).
 *
 * @returns {{ matches: Array<{file: string, line: number}>, scannedFiles: number, elapsedUs: number }|null}
 */
export function nativeGrepLines(pattern, projectRoot, files, caseInsensitive) {
  const addon = loadAddon();
  if (!addon?.nativeGrepLines) return null;
  try {
    return addon.nativeGrepLines(pattern, projectRoot, files, caseInsensitive || false);
  } catch {
    return null;
  }
}

/**
 * In-process regex line-level matching with full match fields.
 * Returns {file, line, column, matchText, content} per match — suitable for
 * bareGrep where callers need display-quality output.
 * Returns null if the native addon is unavailable (falls back to rg).
 *
 * @returns {{ matches: Array<{file: string, line: number, column: number, matchText: string, content: string}>, scannedFiles: number, elapsedUs: number }|null}
 */
export function nativeGrepFull(pattern, projectRoot, files, caseInsensitive) {
  const addon = loadAddon();
  if (!addon?.nativeGrepFull) return null;
  try {
    return addon.nativeGrepFull(pattern, projectRoot, files, caseInsensitive || false);
  } catch {
    return null;
  }
}

/**
 * Get all file paths from the sparse gram index.
 * Used to provide the full file list to native grep for the raw_rg path
 * (avoids needing a directory walk).
 */
export function getSparseGramAllFiles(sparseGramIndex) {
  if (!sparseGramIndex?.getAllFiles) return null;
  try {
    return sparseGramIndex.getAllFiles();
  } catch {
    return null;
  }
}

/**
 * All-in-one gram query + native grep (lean output: file + line).
 * Single NAPI crossing — gram lookup, extension filtering, threshold checks,
 * and regex verification all happen in Rust. Zero string copies for the
 * candidate file list.
 *
 * @param {Object} sparseGramIndex - Loaded NativeSparseGramIndex instance
 * @param {string[][]} clauses - OR of AND-clause literal sets
 * @param {string} regex - Regex pattern
 * @param {string} projectRoot - Absolute project root
 * @param {Object} opts
 * @returns {{ eligible, totalFiles, candidateFiles, gramsUsed, denseGramsTouched, sparseGramsTouched, matches: Array<{file, line}>, scannedFiles, grepElapsedUs }|null}
 */
export function queryAndGrepLines(sparseGramIndex, clauses, regex, projectRoot, opts = {}) {
  if (!sparseGramIndex?.queryAndGrepLines) return null;
  try {
    return sparseGramIndex.queryAndGrepLines(
      clauses, regex, projectRoot,
      opts.maxGramCandidates ?? 0,
      opts.symbolMask ?? 0,
      opts.caseInsensitive ?? false,
      opts.codeExtensions ?? [],
      opts.maxCandidateFiles ?? 2048,
      opts.maxCandidateRatio ?? 0.30,
    );
  } catch {
    return null;
  }
}

/**
 * All-in-one gram query + native grep (full output: file + line + column + matchText + content).
 * Same as queryAndGrepLines but returns display-quality fields for bareGrep.
 */
export function queryAndGrepFull(sparseGramIndex, clauses, regex, projectRoot, opts = {}) {
  if (!sparseGramIndex?.queryAndGrepFull) return null;
  try {
    return sparseGramIndex.queryAndGrepFull(
      clauses, regex, projectRoot,
      opts.maxGramCandidates ?? 0,
      opts.symbolMask ?? 0,
      opts.caseInsensitive ?? false,
      opts.codeExtensions ?? [],
      opts.maxCandidateFiles ?? 2048,
      opts.maxCandidateRatio ?? 0.30,
    );
  } catch {
    return null;
  }
}

// =============================================================================
// Chunk-level gram index wrappers
// =============================================================================

export function hasNativeChunkGramSupport() {
  const addon = loadAddon();
  return !!(addon?.buildChunkGramIndex && addon?.NativeChunkGramIndex?.load);
}

export function buildChunkGramIndexArtifact({ projectRoot, chunks, outputPath }) {
  const addon = loadAddon();
  if (!addon?.buildChunkGramIndex) {
    throw new Error('Native chunk gram support is unavailable.');
  }
  return addon.buildChunkGramIndex(projectRoot, chunks, outputPath);
}

export function loadChunkGramIndex(indexPath) {
  if (!indexPath || !existsSync(indexPath)) return null;
  const addon = loadAddon();
  if (!addon?.NativeChunkGramIndex?.load) return null;
  try {
    return addon.NativeChunkGramIndex.load(indexPath);
  } catch {
    return null;
  }
}

/**
 * Verify regex matches within specific chunk line ranges.
 * Groups chunks by file, reads each file once (mmap for large),
 * scans only the specified line ranges. Returns only verified chunks.
 *
 * @param {string} pattern - Regex pattern
 * @param {string} projectRoot - Absolute project root
 * @param {Array<{file: string, startLine: number, endLine: number, chunkId: number}>} chunks
 * @param {boolean} [caseInsensitive]
 * @returns {{ verified: Array<{file, startLine, endLine, chunkId, matchCount}>, filesRead, chunksChecked, elapsedUs }|null}
 */
export function nativeGrepChunkRanges(pattern, projectRoot, chunks, caseInsensitive) {
  const addon = loadAddon();
  if (!addon?.nativeGrepChunkRanges) return null;
  try {
    return addon.nativeGrepChunkRanges(pattern, projectRoot, chunks, caseInsensitive || false);
  } catch {
    return null;
  }
}

/**
 * All-in-one native chunk search: query gram index + merge ranges + verify
 * regex + return verified chunks. Single NAPI crossing — no intermediate
 * serialization of candidate lists.
 *
 * @param {Object} chunkGramIndex - Loaded NativeChunkGramIndex instance
 * @param {string} pattern - Regex pattern
 * @param {string} projectRoot - Absolute project root
 * @param {string[]} literals - Literal strings extracted from the regex
 * @param {boolean} [caseInsensitive]
 * @param {number} [maxRatio=0.20] - Max chunk candidate ratio before bailing
 * @param {number} [maxFiles=2048] - Max unique files before bailing
 * @returns {{ eligible, reason, verified, totalChunks, candidateChunks, filesRead, elapsedUs }|null}
 */
export function chunkGramSearch(chunkGramIndex, pattern, projectRoot, literals, caseInsensitive, maxRatio, maxFiles) {
  if (!chunkGramIndex?.search) return null;
  try {
    return chunkGramIndex.search(pattern, projectRoot, literals, caseInsensitive || false, maxRatio, maxFiles);
  } catch {
    return null;
  }
}
