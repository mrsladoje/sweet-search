/**
 * Strip a trailing `_<hex>` slug from a path's final basename, before
 * its extension. Used by the Java family (Java/PHP/C#/Kotlin/Scala)
 * per the v6.2 language-conditioned policy.
 *
 *   javascript/Semantic-UI/Table_366c13.js -> javascript/Semantic-UI/Table.js
 *   src/Button.tsx (no slug) -> src/Button.tsx (unchanged)
 *
 * Exported for reuse in chunk-builder.js (document chunks) and tests.
 */
export function normalizePathSlug(relativePath) {
  if (!relativePath) return relativePath;
  return relativePath.replace(/_[0-9a-f]{6,}(\.[a-zA-Z0-9]+)$/, '$1');
}

// Languages that share Java's slug-stripped-path li_text policy.
// (At LI input routing time these are sent to chunk.li_text; pickLiInput in
// chunk-embed-text.js imports this set so the policy stays in one place.)
export const JAVA_FAMILY = new Set([
  'java', 'php',
  'csharp', 'c#',
  'kotlin', 'scala',
]);
