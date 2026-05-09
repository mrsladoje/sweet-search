/**
 * Token-overlap leakage gate.
 *
 * Closes the §11.9 hole: GEPA's reflector reads dev-set traces — symbol
 * names, file paths, gold-answer-adjacent tokens — and can write them back
 * into the optimised prompt as "examples." That is gold-leakage straight
 * into the shipped artifact, the *opposite* direction from §11.1
 * (probes-vs-pretraining decontamination).
 *
 * This gate enumerates every ≥3-gram in the candidate prompt and rejects
 * any that match a non-whitelist n-gram from the Dev-tier corpus (probe
 * symbols, file paths, gold-answer prose, queries). Whitelist contains only
 * generic English / programming n-grams.
 *
 * Plan reference: §0.5 (control #5), §11.9 (algorithm + gate points).
 *
 * Pure function. No I/O for the gate itself; the whitelist file loader is a
 * separate helper so callers can cache the whitelist across many gate calls.
 */

import { existsSync, readFileSync } from 'fs';

const DEFAULT_NGRAM_LENGTH = 3;
const DEFAULT_MIN_TOKEN_LENGTH = 2; // skip 1-letter tokens to avoid noise

/**
 * Tokenise a body of text into normalised tokens for n-gram extraction.
 *
 * Splits on whitespace and ASCII punctuation, lowercases, drops single
 * characters. Preserves identifier-like tokens (camelCase / snake_case /
 * kebab-case stay intact as one token).
 */
function tokenize(text) {
  if (typeof text !== 'string') return [];
  const lowered = text.toLowerCase();
  const tokens = lowered
    .split(/[\s,;:.()\[\]{}<>"'`!?@#$%^&*+=|\\/~]+/u)
    .filter((t) => t.length >= DEFAULT_MIN_TOKEN_LENGTH);
  return tokens;
}

/**
 * Extract every contiguous n-gram from a token list.
 */
function ngrams(tokens, n) {
  const out = new Set();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

/**
 * Build the leakage corpus of n-grams from Dev-tier probe records.
 *
 * Sources (per §11.9.1):
 *   - probe symbol names (expectedSymbolAnyOf, expectedSymbol)
 *   - gold answer file paths (expectedFile, expectedFiles)
 *   - gold answer prose (expectedFacts, expectedAnswerProse, etc.)
 *   - the query string itself
 *
 * Whitelist removes generic n-grams (e.g. "the function", "for each") so
 * legitimate prompt prose isn't blocked.
 *
 * @param {object} args
 * @param {Array<object>} args.probes             — Dev-tier probe records
 * @param {Set<string>}   args.whitelist          — generic-ngram set
 * @param {number}        [args.ngramLength=3]
 * @param {string[]}      [args.proseFields]      — probe field names treated as prose
 * @returns {Set<string>}
 */
export function buildLeakageCorpus({
  probes,
  whitelist,
  ngramLength = DEFAULT_NGRAM_LENGTH,
  proseFields,
}) {
  if (!Array.isArray(probes)) throw new TypeError('leakage-gate: probes must be an array');
  if (!(whitelist instanceof Set)) throw new TypeError('leakage-gate: whitelist must be a Set');
  if (!Number.isInteger(ngramLength) || ngramLength < 2) {
    throw new RangeError('leakage-gate: ngramLength must be ≥ 2');
  }
  const fields = proseFields || [
    'query',
    'question',
    'expectedFile',
    'expectedFiles',
    'expectedSymbol',
    'expectedSymbolAnyOf',
    'expectedFacts',
    'expectedAnswerProse',
    'gold',
  ];
  const corpus = new Set();
  for (const p of probes) {
    if (!p || typeof p !== 'object') continue;
    const fragments = [];
    for (const f of fields) {
      const v = p[f];
      if (typeof v === 'string') fragments.push(v);
      else if (Array.isArray(v)) for (const e of v) if (typeof e === 'string') fragments.push(e);
    }
    for (const fragment of fragments) {
      const toks = tokenize(fragment);
      for (const ng of ngrams(toks, ngramLength)) {
        if (!whitelist.has(ng)) corpus.add(ng);
      }
    }
  }
  return corpus;
}

/**
 * Run the leakage gate against a candidate prompt body.
 *
 * @param {object} args
 * @param {string}      args.candidate            — prompt body to check
 * @param {Set<string>} args.leakageCorpus
 * @param {number}      [args.ngramLength=3]
 * @returns {{
 *   passes: boolean,
 *   matches: Array<{ ngram: string }>,
 *   nCandidateNgrams: number,
 *   nCorpusNgrams: number,
 * }}
 */
export function checkLeakage({
  candidate,
  leakageCorpus,
  ngramLength = DEFAULT_NGRAM_LENGTH,
}) {
  if (typeof candidate !== 'string') {
    throw new TypeError('leakage-gate: candidate must be a string');
  }
  if (!(leakageCorpus instanceof Set)) {
    throw new TypeError('leakage-gate: leakageCorpus must be a Set');
  }
  const tokens = tokenize(candidate);
  const candidateNgrams = ngrams(tokens, ngramLength);
  const matches = [];
  for (const ng of candidateNgrams) {
    if (leakageCorpus.has(ng)) matches.push({ ngram: ng });
  }
  return {
    passes: matches.length === 0,
    matches,
    nCandidateNgrams: candidateNgrams.size,
    nCorpusNgrams: leakageCorpus.size,
  };
}

/**
 * Load the whitelist file. One n-gram per line. Lines starting with `#`
 * (comments) and empty lines are ignored.
 */
export function loadWhitelist(path) {
  if (typeof path !== 'string') throw new TypeError('leakage-gate: whitelist path required');
  if (!existsSync(path)) {
    throw new Error(`leakage-gate: whitelist file not found at ${path}`);
  }
  const text = readFileSync(path, 'utf8');
  const set = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    set.add(trimmed);
  }
  return set;
}

export const _internal = { tokenize, ngrams };
