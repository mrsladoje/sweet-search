/**
 * Vocabulary Miner Utilities
 *
 * Leaf module with no project-internal imports.
 * Provides shared constants and helper functions used by all vocab-miner modules.
 */

import { readdirSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Common stop words to exclude from NL terms
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'that', 'this', 'it', 'its', 'i', 'we', 'they',
  'he', 'she', 'you', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'our', 'their', 'what', 'which', 'who', 'whom',
  // Code stop words
  'var', 'let', 'const', 'function', 'return', 'class', 'new', 'true',
  'false', 'null', 'undefined', 'void', 'typeof', 'instanceof',
  'import', 'export', 'default', 'from', 'require', 'module',
]);

// File extensions for source code scanning
export const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyi', '.go', '.rs', '.java', '.kt', '.kts',
  '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.rb',
  '.php', '.swift', '.scala', '.ex', '.exs', '.lua',
]);

// ---------------------------------------------------------------------------
// Identifier Splitting
// ---------------------------------------------------------------------------

/**
 * Split an identifier into constituent words.
 * Handles camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case.
 *
 * Examples:
 *   getUserData       → [get, User, Data]
 *   XMLParser         → [XML, Parser]
 *   http_server_utils → [http, server, utils]
 *   MAX_RETRY_COUNT   → [MAX, RETRY, COUNT]
 *
 * @param {string} ident - Identifier to split
 * @returns {string[]} Lowercase token parts
 */
export function splitIdentifier(ident) {
  if (!ident || ident.length < 2) return ident ? [ident.toLowerCase()] : [];

  // Replace separators (_, -, .) with spaces first
  let spaced = ident.replace(/[_\-./]/g, ' ');

  // Insert space before transitions: aB, ABc (acronym → word), 2D (digit → upper)
  spaced = spaced.replace(/([a-z])([A-Z])/g, '$1 $2');
  spaced = spaced.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  spaced = spaced.replace(/([0-9])([A-Z])/g, '$1 $2');

  // Split on whitespace and filter
  const parts = spaced
    .split(/\s+/)
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0);

  return parts;
}

// ---------------------------------------------------------------------------
// Term Helpers
// ---------------------------------------------------------------------------

/**
 * Add or update a term in the terms map. Keeps the highest score.
 */
export function addTerm(terms, term, score, source) {
  if (!term || term.length < 2) return;
  const key = term.toLowerCase();
  const existing = terms.get(key);
  if (!existing || existing.score < score) {
    terms.set(key, { term: existing?.term || term, score, source });
  }
}

/**
 * Merge an array of term objects into a Map.
 */
export function mergeTerms(target, termArray) {
  for (const t of termArray) {
    addTerm(target, t.term, t.score, t.source);
  }
}

/**
 * Convert terms Map to sorted array.
 */
export function termsToArray(terms) {
  return [...terms.values()]
    .sort((a, b) => b.score - a.score);
}

/**
 * Walk directory tree up to maxDepth levels deep. Returns file paths.
 * Skips hidden dirs, node_modules, .git, and other noise.
 */
export function walkShallow(dir, maxDepth, depth = 0) {
  if (depth >= maxDepth) return [];

  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.sweet-search', '.agentic-qe',
    'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
    '__pycache__', '.venv', 'venv', 'target', '.swarm',
  ]);

  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && depth > 0) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walkShallow(join(dir, entry.name), maxDepth, depth + 1));
    } else if (entry.isFile()) {
      results.push(join(dir, entry.name));
    }
  }

  return results;
}
