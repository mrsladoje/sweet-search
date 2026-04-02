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
