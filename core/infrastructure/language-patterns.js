/**
 * Shared Language Pattern Registry
 *
 * Single source of truth for language detection, chunker boundary patterns,
 * and graph extraction patterns across all supported languages/formats.
 *
 * Used by:
 * - ast-chunker.js        → chunk boundary detection via getChunkerPatterns()
 * - core/graph-extractor.js → entity/relationship extraction via getGraphPatterns()
 *
 * Design:
 * - EXTENSION_MAP: complete for all 35+ languages (always resolves)
 * - FILENAME_MAP: for extensionless files (Dockerfile, Makefile)
 * - LANGUAGES: extracted to modular registry files
 * - API functions handle missing LANGUAGES entries gracefully (return null → caller falls back)
 */

import path from 'path';
import { EXTENSION_MAP, FILENAME_MAP } from './language-patterns/maps.js';
import { LANGUAGES } from './language-patterns/registry.js';
export { EXTENSION_MAP, FILENAME_MAP, LANGUAGES };

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Get language config by file extension.
 * @param {string} ext - File extension including dot (e.g. '.py')
 * @returns {{ id: string, ...config } | null}
 */
export function getLanguageByExtension(ext) {
  const id = EXTENSION_MAP[ext.toLowerCase()];
  if (!id) return null;
  const lang = LANGUAGES[id];
  if (!lang) return { id, indentBased: false, endKeyword: null, comment: null, chunker: null, graph: null };
  return { id, ...lang };
}

/**
 * Tokens that can appear in C++ source but NOT in valid C source outside
 * of string literals or comments. Used by resolveLanguage() to disambiguate
 * `.h` files between C and C++.
 *
 *   template<       — C has no templates (C99+ has `_Generic`, syntactically distinct).
 *   namespace IDENT — C has no namespaces (token reserved in C++).
 *   class IDENT[:{] — `class IDENT { ... }` and `class IDENT : base` are C++ syntax;
 *                     `int class;` (using `class` as a C field name) does NOT match.
 *   decltype(       — C++11 type-deduction; not in any C standard.
 *   {private|public|protected}: — access specifiers, C++ only at file scope. They
 *                     could appear as goto labels in C, but doing so is exceptionally
 *                     rare and the cost of a false positive is "parse a C header with
 *                     tree-sitter-cpp" which is mostly a superset of tree-sitter-c.
 *   IDENT::IDENT    — scope-resolution operator, C++ only.
 *
 * Strings/comments containing these tokens can produce false positives. The cost is
 * one mis-routed header parsed by tree-sitter-cpp, which still produces reasonable
 * results since tree-sitter-cpp is a near-superset of tree-sitter-c. This is the
 * same disambiguation strategy used by GitHub Linguist for `.h`.
 */
const HEADER_CPP_DISAMBIGUATOR = /\btemplate\s*<|\bnamespace\s+[A-Za-z_]|\bclass\s+[A-Za-z_]\w*\s*[:{]|\bdecltype\s*\(|\b(?:private|public|protected)\s*:|[A-Za-z_]\w*\s*::\s*[A-Za-z_]/;

// Number of leading characters scanned for C++ disambiguator tokens. Real-world
// C++ headers have at least one telltale token within the first ~1KB (include
// guards + namespace/template/class). 2KB gives generous margin without making
// the scan a hot-path cost.
const HEADER_DISAMBIGUATOR_SCAN_BYTES = 2048;

/**
 * Resolve the language for a file, using file content to disambiguate
 * ambiguous extensions (today: `.h` for C vs C++).
 *
 * The default `.h → c` mapping in EXTENSION_MAP is incorrect for header-
 * only C++ libraries (highway, Eigen, fmt, abseil-cpp, range-v3, …)
 * where the implementation lives in `.h` files. When `.h` is parsed by
 * tree-sitter-c, C++ keywords (alignas, namespace, template, decltype)
 * are misidentified, producing phantom symbols and oversized macro-cluster
 * chunks that pollute retrieval.
 *
 * Strategy: per-file content scan. If a `.h` file contains any token that
 * cannot appear in valid C outside strings/comments (template<, namespace,
 * class IDENT[:{], decltype(, access specifiers, IDENT::IDENT), route to
 * cpp; otherwise keep the default routing. No project-level state, no
 * cross-file leakage; per-file decision is locally explainable.
 *
 * @param {string} filePath - File path
 * @param {string} [content] - File content (optional; required for `.h` disambiguation)
 * @returns {{ id: string, ...config } | null}
 */
export function resolveLanguage(filePath, content) {
  const langInfo = getLanguageByPath(filePath);
  if (!langInfo) return null;
  if (langInfo.id !== 'c') return langInfo;
  // Only attempt content disambiguation for `.h` (the ambiguous extension).
  // `.c` files are unambiguous C; we won't override them based on content.
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.h') return langInfo;
  if (typeof content !== 'string' || content.length === 0) return langInfo;
  const probe = content.length > HEADER_DISAMBIGUATOR_SCAN_BYTES
    ? content.slice(0, HEADER_DISAMBIGUATOR_SCAN_BYTES)
    : content;
  if (HEADER_CPP_DISAMBIGUATOR.test(probe)) {
    return getLanguageByExtension('.cpp');
  }
  return langInfo;
}

/**
 * Get language config by file path (handles both extension and filename).
 * @param {string} filePath - File path
 * @returns {{ id: string, ...config } | null}
 */
export function getLanguageByPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext) {
    const result = getLanguageByExtension(ext);
    if (result) return result;
  }
  // No extension — check filename
  const basename = path.basename(filePath);
  // Check exact match
  const id = FILENAME_MAP[basename];
  if (id) {
    const lang = LANGUAGES[id];
    if (!lang) return { id, indentBased: false, endKeyword: null, comment: null, chunker: null, graph: null };
    return { id, ...lang };
  }
  // Check prefix match (e.g. "Dockerfile.prod" → dockerfile)
  for (const [name, langId] of Object.entries(FILENAME_MAP)) {
    if (basename.startsWith(name + '.') || basename.startsWith(name + '-')) {
      const lang = LANGUAGES[langId];
      if (!lang) return { id: langId, indentBased: false, endKeyword: null, comment: null, chunker: null, graph: null };
      return { id: langId, ...lang };
    }
  }
  return null;
}

/**
 * Get chunker patterns for a language.
 * @param {string} languageId - Language identifier (e.g. 'python')
 * @returns {Object<string, RegExp> | null}
 */
export function getChunkerPatterns(languageId) {
  return LANGUAGES[languageId]?.chunker || null;
}

/**
 * Get graph extraction patterns for a language.
 * @param {string} languageId
 * @returns {{ entities: Object, relationships: Object, skipCallObjects: string[] } | null}
 */
export function getGraphPatterns(languageId) {
  return LANGUAGES[languageId]?.graph || null;
}

/**
 * Get language metadata (indent style, comments).
 * @param {string} languageId
 * @returns {{ indentBased: boolean, endKeyword: string|null, comment: Object } | null}
 */
export function getLanguageMeta(languageId) {
  const lang = LANGUAGES[languageId];
  if (!lang) return null;
  return {
    indentBased: lang.indentBased,
    endKeyword: lang.endKeyword,
    comment: lang.comment,
  };
}

/**
 * Get all supported file extensions.
 * @returns {string[]}
 */
export function getSupportedExtensions() {
  return Object.keys(EXTENSION_MAP);
}

/**
 * Check if a language uses indentation for scoping.
 * @param {string} languageId
 * @returns {boolean}
 */
export function isIndentBased(languageId) {
  return LANGUAGES[languageId]?.indentBased || false;
}

/**
 * Get all registered language IDs.
 * @returns {string[]}
 */
export function getRegisteredLanguages() {
  return Object.keys(LANGUAGES);
}

export default {
  EXTENSION_MAP,
  FILENAME_MAP,
  LANGUAGES,
  getLanguageByExtension,
  getLanguageByPath,
  resolveLanguage,
  getChunkerPatterns,
  getGraphPatterns,
  getLanguageMeta,
  getSupportedExtensions,
  isIndentBased,
  getRegisteredLanguages,
};
