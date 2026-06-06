/**
 * Native sparse-gram wrapper — loads/builds the Rust-backed pattern prefilter
 * artifact via the existing napi addon.
 */

import { existsSync } from 'fs';
import { loadNativeAddon } from './native-resolver.js';
import { SPARSE_SYMBOL_MASKS, resolveSparseSymbolMask } from './constants.js';

// Re-export from constants.js — canonical source of symbol type vocabulary.
export { SPARSE_SYMBOL_MASKS, resolveSparseSymbolMask };

let _addon = null;
let _addonLoaded = false;
let _fallbackWeights = null;

const ASCII_DIM = 128;
const WEIGHT_TABLE_LEN = ASCII_DIM * ASCII_DIM;
const MIN_SPAN_LEN = 3;
const MAX_GRAM_LEN = 12;
const FALLBACK_WEIGHTS_ID = 'common-code-bigram-v1';
const COMMON_CODE_BIGRAMS = [
  ['th', 5000], ['he', 4800], ['in', 4700], ['er', 4500], ['re', 4300], ['fo', 4200], ['or', 4200], ['fu', 4100],
  ['un', 4000], ['ct', 3900], ['cl', 3800], ['ss', 3700], ['co', 3600], ['de', 3500], ['nt', 3400], ['io', 3300],
  ['on', 3200], ['st', 3100], ['te', 3000], ['ra', 2900], ['ri', 2800], ['al', 2700], ['se', 2600], ['it', 2500],
  ['at', 2400], ['es', 2300], ['is', 2200], ['le', 2100], ['ar', 2000], ['ha', 1900], ['ng', 1800], ['js', 1700],
  ['ts', 1600], ['py', 1500], ['rs', 1400], ['::', 1300], ['->', 1200], ['=>', 1100], ['__', 1000], ['./', 900],
];

function isSpanCode(code) {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) ||
    code === 95 || code === 46 || code === 47 || code === 58 || code === 45;
}

function normalizeAsciiCode(code) {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function pairIndex(left, right) {
  return (left << 7) | right;
}

function buildFallbackWeights() {
  if (_fallbackWeights) return _fallbackWeights;
  const counts = new Uint32Array(WEIGHT_TABLE_LEN);
  counts.fill(1);
  for (const [pair, count] of COMMON_CODE_BIGRAMS) {
    counts[pairIndex(pair.charCodeAt(0), pair.charCodeAt(1))] = count;
  }
  let total = 0;
  for (const count of counts) total += count;
  const denominator = total + WEIGHT_TABLE_LEN;
  _fallbackWeights = Array.from(counts, (count) => Math.log(denominator / (count + 1)));
  return _fallbackWeights;
}

function collectNormalizedSpans(text) {
  const spans = [];
  let current = [];
  for (const char of String(text || '')) {
    const code = normalizeAsciiCode(char.charCodeAt(0));
    if (isSpanCode(code)) current.push(code);
    else if (current.length >= MIN_SPAN_LEN) {
      spans.push(current);
      current = [];
    } else current = [];
  }
  if (current.length >= MIN_SPAN_LEN) spans.push(current);
  return spans;
}

function bytesToString(bytes) {
  return String.fromCharCode(...bytes);
}

function extractSparseGramsFromSpan(span, weights) {
  if (span.length < MIN_SPAN_LEN) return [];
  const pairWeights = [];
  for (let i = 0; i < span.length - 1; i += 1) {
    pairWeights.push(weights[pairIndex(span[i], span[i + 1])]);
  }
  const grams = [];
  const seen = new Set();
  for (let start = 0; start <= span.length - MIN_SPAN_LEN; start += 1) {
    const maxEnd = Math.min(span.length, start + MAX_GRAM_LEN);
    for (let end = start + MIN_SPAN_LEN; end <= maxEnd; end += 1) {
      const first = pairWeights[start];
      const last = pairWeights[end - 2];
      let interiorMax = Number.NEGATIVE_INFINITY;
      if (end - start > MIN_SPAN_LEN) {
        for (let i = start + 1; i < end - 2; i += 1) {
          interiorMax = Math.max(interiorMax, pairWeights[i]);
        }
      }
      if (Math.min(first, last) > interiorMax) {
        const gram = bytesToString(span.slice(start, end));
        if (!seen.has(gram)) { seen.add(gram); grams.push(gram); }
      }
    }
  }
  if (grams.length === 0) {
    for (let i = 0; i <= span.length - MIN_SPAN_LEN; i += 1) {
      const gram = bytesToString(span.slice(i, i + MIN_SPAN_LEN));
      if (!seen.has(gram)) { seen.add(gram); grams.push(gram); }
    }
  }
  return grams;
}

function normalizeLiteral(literal) {
  const bytes = [];
  for (const char of String(literal || '')) {
    const code = normalizeAsciiCode(char.charCodeAt(0));
    if (!isSpanCode(code)) return null;
    bytes.push(code);
  }
  return bytes.length >= MIN_SPAN_LEN ? bytes : null;
}

function extractCoveringGramsFromSpan(span, weights) {
  if (span.length < MIN_SPAN_LEN) return [];
  const pairWeights = [];
  for (let i = 0; i < span.length - 1; i += 1) {
    pairWeights.push(weights[pairIndex(span[i], span[i + 1])]);
  }
  const grams = [];
  const seen = new Set();
  const stack = [[0, span.length]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    const len = end - start;
    if (len < MIN_SPAN_LEN) continue;
    if (len === MIN_SPAN_LEN) {
      const gram = bytesToString(span.slice(start, end));
      if (!seen.has(gram)) { seen.add(gram); grams.push(gram); }
      continue;
    }
    if (len <= MAX_GRAM_LEN) {
      const first = pairWeights[start];
      const last = pairWeights[end - 2];
      let interiorMax = Number.NEGATIVE_INFINITY;
      for (let i = start + 1; i < end - 2; i += 1) {
        interiorMax = Math.max(interiorMax, pairWeights[i]);
      }
      if (Math.min(first, last) > interiorMax) {
        const gram = bytesToString(span.slice(start, end));
        if (!seen.has(gram)) { seen.add(gram); grams.push(gram); }
        continue;
      }
    }
    let maxWeight = Number.NEGATIVE_INFINITY;
    let maxPos = start + 1;
    for (let i = start + 1; i < end - 1; i += 1) {
      if (pairWeights[i] > maxWeight) {
        maxWeight = pairWeights[i];
        maxPos = i;
      }
    }
    const leftEnd = maxPos + 1;
    const rightStart = maxPos;
    if (end - rightStart >= MIN_SPAN_LEN) stack.push([rightStart, end]);
    if (leftEnd - start >= MIN_SPAN_LEN) stack.push([start, leftEnd]);
  }
  if (grams.length === 0) {
    for (let i = 0; i <= span.length - MIN_SPAN_LEN; i += 1) {
      const gram = bytesToString(span.slice(i, i + MIN_SPAN_LEN));
      if (!seen.has(gram)) { seen.add(gram); grams.push(gram); }
    }
  }
  return grams;
}

function loadAddon() {
  if (_addonLoaded) return _addon;
  _addonLoaded = true;

  // CUDA-preferred with CPU fallback (see loadNativeAddon): a CUDA addon that
  // can't load on a no-GPU box falls back to the plain CPU addon.
  const res = loadNativeAddon({
    validate: (m) =>
      typeof m.buildSparseGramIndex === 'function' &&
      typeof m.NativeSparseGramIndex?.load === 'function' &&
      typeof m.extractRegexLiterals === 'function',
  });
  if (res) _addon = res.mod;

  return _addon;
}

export function hasNativeSparseGramSupport() {
  return !!loadAddon();
}

/**
 * Whether the native addon exposes the in-process grep functions
 * (native_grep_lines / native_grep_full). When true, ss-grep / ss-pattern can
 * run regex matching in-process without spawning ripgrep.
 */
export function isNativeGrepAvailable() {
  const addon = loadAddon();
  return !!(
    addon &&
    typeof addon.nativeGrepLines === 'function' &&
    typeof addon.nativeGrepFull === 'function'
  );
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

function normalizeExtractionResult(result) {
  if (!result || !Array.isArray(result.grams)) return null;
  return {
    weightsId: result.weightsId || result.weights_id || FALLBACK_WEIGHTS_ID,
    grams: [...new Set(result.grams.map(String))].sort(),
  };
}

function fallbackSparseGramExtraction(content) {
  const weights = buildFallbackWeights();
  const grams = new Set();
  for (const span of collectNormalizedSpans(content)) {
    for (const gram of extractSparseGramsFromSpan(span, weights)) grams.add(gram);
  }
  return { weightsId: FALLBACK_WEIGHTS_ID, grams: [...grams].sort() };
}

function fallbackRequiredGrams(literals) {
  if (!Array.isArray(literals) || literals.length === 0) {
    return { eligible: false, grams: [], weightsId: FALLBACK_WEIGHTS_ID };
  }
  const weights = buildFallbackWeights();
  const grams = new Set();
  for (const literal of literals) {
    const span = normalizeLiteral(literal);
    if (!span) return { eligible: false, grams: [], weightsId: FALLBACK_WEIGHTS_ID };
    const required = extractCoveringGramsFromSpan(span, weights);
    if (required.length === 0) return { eligible: false, grams: [], weightsId: FALLBACK_WEIGHTS_ID };
    for (const gram of required) grams.add(gram);
  }
  return { eligible: true, grams: [...grams].sort(), weightsId: FALLBACK_WEIGHTS_ID };
}

export function extractSparseGramDeltaRecord({ indexPath, content }) {
  const addon = loadAddon();
  if (addon) {
    try {
      if (indexPath && existsSync(indexPath)) {
        const index = addon.NativeSparseGramIndex.load(indexPath);
        const extractor = index.extractIndexGrams || index.extract_index_grams;
        if (typeof extractor === 'function') return normalizeExtractionResult(extractor.call(index, content));
        const stats = typeof index.getStats === 'function' ? index.getStats() : null;
        if (stats?.usedFallbackWeights || stats?.used_fallback_weights) {
          return fallbackSparseGramExtraction(content);
        }
        if (typeof stats?.weightsId === 'string' || typeof stats?.weights_id === 'string') {
          return { weightsId: stats.weightsId || stats.weights_id, grams: [] };
        }
      }
      if (typeof addon.extractSparseGramDelta === 'function') {
        return normalizeExtractionResult(addon.extractSparseGramDelta(content));
      }
      if (typeof addon.extract_sparse_gram_delta === 'function') {
        return normalizeExtractionResult(addon.extract_sparse_gram_delta(content));
      }
    } catch (err) {
      if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] extractSparseGramDeltaRecord failed:', err.message);
    }
  }
  return fallbackSparseGramExtraction(content);
}

export function extractSparseGramRequiredGrams(sparseGramIndex, literals) {
  try {
    const extractor = sparseGramIndex?.extractLiteralCoveringGrams || sparseGramIndex?.extract_literal_covering_grams;
    if (typeof extractor === 'function') {
      const result = extractor.call(sparseGramIndex, literals);
      return {
        eligible: !!result?.eligible,
        grams: Array.isArray(result?.grams) ? [...new Set(result.grams.map(String))].sort() : [],
        weightsId: result?.weightsId || result?.weights_id || null,
      };
    }
  } catch (err) {
    if (process.env.SWEET_DEBUG) console.debug('[native-sparse-gram] extractSparseGramRequiredGrams failed:', err.message);
    return null;
  }
  return fallbackRequiredGrams(literals);
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
