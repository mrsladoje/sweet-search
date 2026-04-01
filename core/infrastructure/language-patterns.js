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
  getChunkerPatterns,
  getGraphPatterns,
  getLanguageMeta,
  getSupportedExtensions,
  isIndentBased,
  getRegisteredLanguages,
};
