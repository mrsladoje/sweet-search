/**
 * Shared constants for sweet-search
 * Extracted to prevent drift between graph-search.js and sweet-search.js
 */

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
 * Canonical set of code file extensions recognized by sweet-search.
 * Used by both the indexer (sparse gram builder) and the search pipeline
 * (ripgrep type filter + code file detection). Single source of truth.
 */
export const CODE_FILE_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'lua', 'sh', 'zig', 'hs', 'ml',
  'ex', 'exs', 'clj', 'erl', 'r', 'jl', 'dart', 'v', 'nim', 'cr', 'd', 'f90',
  'ada', 'pas', 'cob', 'pl', 'pm', 'sql', 'graphql', 'proto', 'yaml', 'yml',
  'json', 'toml', 'xml', 'html', 'css', 'scss', 'sass', 'less', 'svelte',
  'vue', 'astro', 'mdx',
]);

/**
 * Ripgrep type definition glob matching CODE_FILE_EXTENSIONS.
 * Used with --type-add to define a custom 'code' type for ripgrep.
 */
export const RIPGREP_CODE_TYPE_GLOB =
  'code:*.{js,ts,jsx,tsx,py,rs,go,java,c,cpp,h,hpp,cs,rb,php,swift,kt,scala,lua,sh,zig,hs,ml,ex,exs,clj,erl,r,jl,dart,v,nim,cr,d,f90,ada,pas,cob,pl,pm,sql,graphql,proto,yaml,yml,json,toml,xml,html,css,scss,sass,less,svelte,vue,astro,mdx}';

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
