/**
 * Shared constants for sweet-search
 * Extracted to prevent drift between graph-search.js and sweet-search.js
 */

import { EXTENSION_MAP } from './language-patterns/maps.js';

export const SYMBOL_KIND_WEIGHTS = {
  class: 1.0,
  interface: 0.95,
  struct: 0.95,
  enum: 0.9,
  function: 0.85,
  method: 0.80,
  constructor: 0.75,
  constant: 0.7,
  property: 0.65,
  field: 0.6,
  variable: 0.4,
  parameter: 0.3,
  reference: 0.2,
  call: 0.15,
  import: 0.1,
};

export const DEFINITION_TYPES = new Set([
  'class', 'interface', 'struct', 'enum', 'function', 'method', 'constructor'
]);

/**
 * Canonical set of code file extensions recognized by sweet-search's
 * grep/pattern path — the sparse-gram literal index, native-grep extension
 * filter, ripgrep `--type-add code` fallback, and `isRipgrepCodePath`.
 *
 * DERIVED from EXTENSION_MAP (the single source of truth for which extensions
 * sweet-search indexes) so ss-grep coverage can NEVER drift behind newly-added
 * languages. This drift previously dropped Solidity, .cts/.mts, .cljc/.cljs/.edn,
 * .mli, .rd/.rmd, shaders, build DSLs, etc. from ss-grep even though they were
 * discovered + embedded (so ss-search worked but ss-grep silently returned
 * nothing). Keys are stored bare + lowercase (no leading dot) to match
 * `path.extname(f).slice(1).toLowerCase()` at the call sites.
 *
 * Pure document formats (Markdown/reStructuredText/plaintext) are intentionally
 * EXCLUDED — they go through DocumentChunker and are not part of the grep
 * code-path (isRipgrepCodePath('README.md') must stay false, and sparse-gram
 * candidate lists drop doc files). Config/markup/style formats (json/yaml/xml/
 * html/css/ini/…) stay in, matching the historical set.
 *
 * Plus a few historically grep-able languages that have no EXTENSION_MAP entry
 * (no chunker grammar): Ada, D, V.
 */
const DOC_FORMAT_LANGUAGE_IDS = new Set(['markdown', 'rst', 'plaintext']);
const LEGACY_EXTRA_CODE_EXTENSIONS = ['ada', 'd', 'v'];
/**
 * Discovered by FILE_PATTERNS and worth grepping, but with no chunker grammar, so
 * they get no EXTENSION_MAP entry (which would claim one). Without this list they
 * would be embedded and searchable yet invisible to ss-grep — the exact drift the
 * comment above describes. Added 2026-07 from the held-out-2 extension-coverage
 * audit; `mod` covers go.mod, which FILE_PATTERNS has always discovered.
 */
const EXTRA_GREPPABLE_CODE_EXTENSIONS = [
  'razor', 'jj', 'bnf', 'yy', 'y', 'scm', 'jq', 'pkl', 'gleam', 'hylo',
  'snap', 'stderr', 'conf', 'config', 'adoc', 'scd', 'vtt', 'test', 'mod',
  'txtar', 'bsh', 'inc', 'fixed',
];
export const CODE_FILE_EXTENSIONS = new Set([
  ...Object.entries(EXTENSION_MAP)
    .filter(([, id]) => !DOC_FORMAT_LANGUAGE_IDS.has(id))
    .map(([ext]) => ext.replace(/^\./, '').toLowerCase()),
  ...LEGACY_EXTRA_CODE_EXTENSIONS,
  ...EXTRA_GREPPABLE_CODE_EXTENSIONS,
]);

/**
 * Ripgrep type definition glob matching CODE_FILE_EXTENSIONS.
 * Used with --type-add to define a custom 'code' type for ripgrep. Derived from
 * the same set so it stays in lockstep.
 */
export const RIPGREP_CODE_TYPE_GLOB =
  `code:*.{${Array.from(CODE_FILE_EXTENSIONS).join(',')}}`;

/**
 * Sparse gram symbol type bitmasks.
 * These bit positions must match the Rust native addon's expectations.
 * Used by both the indexer (to tag files) and the search pipeline (to filter).
 */
export const SPARSE_SYMBOL_MASKS = {
  function: 1 << 0,
  class: 1 << 1,
  method: 1 << 2,
  import: 1 << 3,
  type: 1 << 4,
  other: 1 << 5,
};

/**
 * Resolve a symbol type string to its sparse gram bitmask value.
 * @param {string} symbolType
 * @returns {number} bitmask (0 if unrecognized)
 */
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
