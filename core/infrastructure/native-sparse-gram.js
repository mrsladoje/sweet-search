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
  } catch (err) {
    // Native addon is optional; callers decide whether to warn or fall back.
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] addon load failed:', err.message);
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
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] nativeGrepFilesWithMatches failed:', err.message);
    return null; // Fall back to rg on regex incompatibility
  }
}

/**
 * In-process fixed-string literal prefilter with AND semantics.
 * Returns files containing ALL given literals. Replaces sequential rg -F spawns.
 * Uses str::contains() — no regex compilation overhead.
 *
 * @param {string[]} literals - All must be present in the file (AND)
 * @param {string} projectRoot
 * @param {string[]} files - Relative file paths to search
 * @param {boolean} [caseInsensitive]
 * @returns {{ matchingFiles: string[], scannedFiles: number, elapsedUs: number }|null}
 */
export function nativeGrepFilesWithMatchesFixed(literals, projectRoot, files, caseInsensitive) {
  const addon = loadAddon();
  if (!addon?.nativeGrepFilesWithMatchesFixed) return null;
  try {
    return addon.nativeGrepFilesWithMatchesFixed(literals, projectRoot, files, caseInsensitive || false);
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] nativeGrepFilesWithMatchesFixed failed:', err.message);
    return null;
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
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] nativeGrepLines failed:', err.message);
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
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] nativeGrepFull failed:', err.message);
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
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] getSparseGramAllFiles failed:', err.message);
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
      opts.maxCandidateFiles ?? 100000,
      opts.maxCandidateRatio ?? 1.0,
    );
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] queryAndGrepLines failed:', err.message);
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
      opts.maxCandidateFiles ?? 100000,
      opts.maxCandidateRatio ?? 1.0,
    );
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] queryAndGrepFull failed:', err.message);
    return null;
  }
}

/**
 * Unified search (lean output): gram narrowing → grep candidates, or fallback → grep all files.
 * Single NAPI crossing for the entire query. Replaces the JS planner + separate NAPI calls.
 */
export function searchLines(sparseGramIndex, clauses, regex, projectRoot, opts = {}) {
  if (!sparseGramIndex?.searchLines) return null;
  try {
    return sparseGramIndex.searchLines(
      clauses, regex, projectRoot,
      opts.maxGramCandidates ?? 0,
      opts.symbolMask ?? 0,
      opts.caseInsensitive ?? false,
      opts.codeExtensions ?? [],
      opts.maxCandidateFiles ?? 100000,
      opts.maxCandidateRatio ?? 1.0,
    );
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] searchLines failed:', err.message);
    return null;
  }
}

/**
 * Unified search (full output): same as searchLines but returns display-quality fields.
 */
export function searchFull(sparseGramIndex, clauses, regex, projectRoot, opts = {}) {
  if (!sparseGramIndex?.searchFull) return null;
  try {
    return sparseGramIndex.searchFull(
      clauses, regex, projectRoot,
      opts.maxGramCandidates ?? 0,
      opts.symbolMask ?? 0,
      opts.caseInsensitive ?? false,
      opts.codeExtensions ?? [],
      opts.maxCandidateFiles ?? 100000,
      opts.maxCandidateRatio ?? 1.0,
    );
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] searchFull failed:', err.message);
    return null;
  }
}

