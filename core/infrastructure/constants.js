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
