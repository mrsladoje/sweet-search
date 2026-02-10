#!/usr/bin/env node
/**
 * Pre-warm vocabulary with common terms for semantic search.
 * Terms can be sourced from:
 *   1. A JSON file passed as the first CLI argument
 *   2. .sweet-search/vocab-terms.json (default, if it exists)
 *   3. A built-in generic programming term list (fallback)
 *
 * Usage:
 *   node prewarm-vocab.js [terms-file]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expandVocabulary } from '../core/embedding-service.js';

const DEFAULT_TERMS_PATH = resolve(process.cwd(), '.sweet-search/vocab-terms.json');

const GENERIC_TERMS = [
  // Common code search patterns
  'authentication', 'authorization', 'login', 'logout',
  'user', 'config', 'database', 'connection',
  'request', 'response', 'handler', 'controller',
  'service', 'repository', 'model', 'entity',
  'error', 'exception', 'validation', 'middleware',
  'route', 'endpoint', 'API', 'REST',
  'test', 'mock', 'fixture', 'setup',
  'import', 'export', 'module', 'package',
  'class', 'interface', 'function', 'method',
  'constructor', 'initialize', 'factory', 'builder',
  'cache', 'queue', 'event', 'listener',
  'how does authentication work',
  'where is the database connection configured',
  'find all API endpoints',
  'error handling patterns',
];

/**
 * Load terms from a JSON file. Expects a JSON array of strings.
 * @param {string} filePath - Absolute path to the JSON terms file
 * @returns {string[]} The parsed array of term strings
 */
function loadTermsFromFile(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Terms file must contain a JSON array, got ${typeof parsed}`);
  }

  const nonStrings = parsed.filter((t) => typeof t !== 'string');
  if (nonStrings.length > 0) {
    throw new Error(`Terms file contains ${nonStrings.length} non-string entries`);
  }

  return parsed;
}

/**
 * Resolve the term list from CLI argument, default file, or generic fallback.
 * @returns {{ terms: string[], source: string }}
 */
function resolveTerms() {
  const cliArg = process.argv[2];

  // 1. CLI argument takes priority
  if (cliArg) {
    const filePath = resolve(process.cwd(), cliArg);
    if (!existsSync(filePath)) {
      console.error(`Error: terms file not found: ${filePath}`);
      process.exit(1);
    }
    const terms = loadTermsFromFile(filePath);
    return { terms, source: `CLI argument (${filePath})` };
  }

  // 2. Default terms file
  if (existsSync(DEFAULT_TERMS_PATH)) {
    const terms = loadTermsFromFile(DEFAULT_TERMS_PATH);
    return { terms, source: `default file (${DEFAULT_TERMS_PATH})` };
  }

  // 3. Generic fallback
  return { terms: GENERIC_TERMS, source: 'generic fallback (built-in programming terms)' };
}

const { terms, source } = resolveTerms();

console.log(`\nPre-warming vocabulary with ${terms.length} terms...`);
console.log(`Source: ${source}`);

const start = Date.now();

try {
  await expandVocabulary(terms);
  console.log('Done in ' + (Date.now() - start) + 'ms');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
