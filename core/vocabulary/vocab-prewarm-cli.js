/**
 * CLI handler for `sweet-search prewarm-vocab`.
 *
 * Pre-warms the vocabulary cache with terms for semantic search. Terms are
 * sourced from, in priority order:
 *   1. An explicit terms file path (first positional argument)
 *   2. <PROJECT_ROOT>/.sweet-search/vocab-terms.json
 *   3. A built-in generic programming term list (fallback)
 *
 * Usage: sweet-search prewarm-vocab [terms-file]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expandVocabulary } from '../embedding/index.js';
import { PROJECT_ROOT } from '../infrastructure/config/index.js';

const GENERIC_TERMS = [
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

function resolveTerms(cliArg) {
  if (cliArg) {
    const filePath = resolve(process.cwd(), cliArg);
    if (!existsSync(filePath)) {
      throw new Error(`terms file not found: ${filePath}`);
    }
    return { terms: loadTermsFromFile(filePath), source: `CLI argument (${filePath})` };
  }

  const defaultPath = resolve(PROJECT_ROOT, '.sweet-search', 'vocab-terms.json');
  if (existsSync(defaultPath)) {
    return { terms: loadTermsFromFile(defaultPath), source: `default file (${defaultPath})` };
  }

  return { terms: GENERIC_TERMS, source: 'generic fallback (built-in programming terms)' };
}

/**
 * CLI entry point dispatched from `core/cli.js`.
 *
 * @param {string[]} args - Arguments after `prewarm-vocab`.
 */
export async function handlePrewarmVocabCli(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`sweet-search prewarm-vocab — pre-warm vocabulary for semantic search

Usage:
  sweet-search prewarm-vocab [terms-file]

Arguments:
  terms-file    Optional path to a JSON array of terms to warm.
                Defaults to .sweet-search/vocab-terms.json, then to a
                built-in generic programming term list.`);
    return;
  }

  const cliArg = args.find((a) => !a.startsWith('-'));

  let terms, source;
  try {
    ({ terms, source } = resolveTerms(cliArg));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log(`\nPre-warming vocabulary with ${terms.length} terms...`);
  console.log(`Source: ${source}`);

  const start = Date.now();

  try {
    await expandVocabulary(terms);
    console.log(`Done in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}
