/**
 * Shared constants for search-100x
 * Extracted to prevent drift between graph-search.js and smart-search-v21.js
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
