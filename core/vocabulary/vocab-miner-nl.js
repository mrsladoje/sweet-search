/**
 * Vocabulary Miner NL (Natural Language) Module
 *
 * Handles NL content mining from comments, docstrings, and commit messages.
 * Includes secret detection, script detection, tokenization, and n-gram extraction.
 */

import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { PROJECT_ROOT } from '../infrastructure/config/index.js';
import { STOP_WORDS, splitIdentifier } from './vocab-miner-utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Secret patterns to redact from NL content
export const SECRET_PATTERNS = [
  /(?=[A-Za-z0-9+/]*[+/=])[A-Za-z0-9+/]{40,}={0,2}/,   // base64 > 40 chars with at least one +, /, or =
  /sk-[A-Za-z0-9]{20,}/,          // OpenAI keys
  /ghp_[A-Za-z0-9]{30,}/,         // GitHub PATs
  /gho_[A-Za-z0-9]{30,}/,         // GitHub OAuth
  /Bearer\s+\S{20,}/i,            // Bearer tokens
  /token=[A-Za-z0-9_\-]{16,}/i,   // token= params
  /password\s*=\s*\S{6,}/i,       // password= assignments
  /api[_-]?key\s*[:=]\s*\S{10,}/i, // apikey assignments
];

export const NL_MINING_TIMEOUT_MS = 6000;

// ---------------------------------------------------------------------------
// Community-Aware NL Mining
// ---------------------------------------------------------------------------

/**
 * Mine natural language terms from comments and docstrings,
 * weighted by community distinctiveness using c-TF-IDF.
 *
 * @param {Array<{id: number, entityIds: Array, fileIds: string[]}>} communities
 * @param {string} [projectRoot]
 * @param {object} [options]
 * @param {number} [options.timeoutMs=6000] - Max wall-clock time
 * @param {number} [options.maxFileSize=100000] - Max bytes per file
 * @returns {{ communityPhrases: Array<{communityId: number, phrases: Array<{text: string, score: number, type: string}>}> }}
 */
export function mineNLContent(communities, projectRoot, options = {}) {
  const root = projectRoot || PROJECT_ROOT;
  const timeoutMs = options.timeoutMs ?? NL_MINING_TIMEOUT_MS;
  const maxFileSize = options.maxFileSize ?? 100_000;
  const codeGraphNames = options.codeGraphNames || null;
  const deadline = Date.now() + timeoutMs;

  if (!communities || communities.length === 0) {
    return { communityPhrases: [] };
  }

  // Phase 1: Extract NL text per document. Communities that cover the same files
  // (single entities of one file, most of them when few call edges resolve) make one
  // document, under the first community's id: the same text counted once per entity
  // would only raise every term's document frequency. Each file is read once.
  const fileText = new Map();
  const nlTextOf = (filePath) => {
    if (fileText.has(filePath)) return fileText.get(filePath);
    let nlText = null;
    const fullPath = filePath.startsWith('/') ? filePath : join(root, filePath);
    try {
      if (statSync(fullPath).size <= maxFileSize) {
        nlText = extractNLText(readFileSync(fullPath, 'utf-8'), extname(filePath), codeGraphNames) || null;
      }
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    fileText.set(filePath, nlText);
    return nlText;
  };

  const docs = new Map(); // sorted file set -> communityId
  for (const comm of communities) {
    const files = [...new Set(comm.fileIds || [])].sort();
    const key = files.join('\0');
    if (!docs.has(key)) docs.set(key, { communityId: comm.id, files });
  }

  const communityTexts = []; // [{communityId, text}]
  for (const { communityId, files } of docs.values()) {
    if (Date.now() > deadline) break;
    const texts = [];
    for (const filePath of files) {
      if (Date.now() > deadline) break;
      const nlText = nlTextOf(filePath);
      if (nlText) texts.push(nlText);
    }
    communityTexts.push({ communityId, text: texts.join(' ') });
  }

  // Phase 2: TF-IDF per community
  const totalDocs = communityTexts.length;
  const dfMap = new Map(); // term -> number of communities containing it

  // Tokenize once per community, reuse for TF, bigrams, and trigrams.
  const communityTermFreqs = communityTexts.map(({ communityId, text }) => {
    const tokens = tokenizeNL(text);
    const tf = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }
    const bigrams = extractBigrams(tokens);
    const trigrams = extractTrigrams(tokens);
    return { communityId, tf, totalTokens: tokens.length, tokens, bigrams, trigrams };
  });

  // Document frequency (unigrams)
  for (const { tf } of communityTermFreqs) {
    for (const term of tf.keys()) {
      dfMap.set(term, (dfMap.get(term) || 0) + 1);
    }
  }

  // Per-ngram document frequency maps so bigram/trigram IDF
  // reflects actual cross-community distinctiveness (not constant 1).
  const bigramDfMap = new Map();
  const trigramDfMap = new Map();
  for (const { bigrams, trigrams } of communityTermFreqs) {
    for (const bg of bigrams.keys()) bigramDfMap.set(bg, (bigramDfMap.get(bg) || 0) + 1);
    for (const tg of trigrams.keys()) trigramDfMap.set(tg, (trigramDfMap.get(tg) || 0) + 1);
  }

  // Phase 3: c-TF-IDF scoring
  const communityPhrases = [];

  for (let ci = 0; ci < communityTermFreqs.length; ci++) {
    // No deadline here: the budget bounds the text read above, and scoring what was
    // read is cheap. Dropping it would return no phrases whenever reading used the budget.
    const { communityId, tf, totalTokens } = communityTermFreqs[ci];
    if (totalTokens === 0) {
      communityPhrases.push({ communityId, phrases: [] });
      continue;
    }

    const scored = [];
    for (const [term, count] of tf) {
      const termFreq = count / totalTokens;
      const df = dfMap.get(term) || 1;
      const idf = Math.log(1 + totalDocs / df);

      // c-TF-IDF: weight by distinctiveness (terms unique to this community score higher)
      const ctfIdf = termFreq * idf;
      scored.push({ text: term, score: ctfIdf, type: 'unigram' });
    }

    // Bigrams and trigrams using their own DF maps
    const { bigrams, trigrams } = communityTermFreqs[ci];
    for (const [bigram, count] of bigrams) {
      const termFreq = count / Math.max(totalTokens - 1, 1);
      const idf = Math.log(1 + totalDocs / (bigramDfMap.get(bigram) || 1));
      scored.push({ text: bigram, score: termFreq * idf * 1.5, type: 'bigram' });
    }
    for (const [trigram, count] of trigrams) {
      const termFreq = count / Math.max(totalTokens - 2, 1);
      const idf = Math.log(1 + totalDocs / (trigramDfMap.get(trigram) || 1));
      scored.push({ text: trigram, score: termFreq * idf * 1.8, type: 'trigram' });
    }

    // Sort by score descending, take top 50
    scored.sort((a, b) => b.score - a.score);
    communityPhrases.push({
      communityId,
      phrases: scored.slice(0, 50),
    });
  }

  return { communityPhrases };
}

// ---------------------------------------------------------------------------
// NL Text Extraction
// ---------------------------------------------------------------------------

/**
 * Extract natural language text from source code (comments, docstrings).
 * @param {string} content
 * @param {string} ext
 * @param {Set<string>} [codeGraphNames] - Known entity names for secret exemption
 */
export function extractNLText(content, ext, codeGraphNames) {
  const texts = [];

  // Line comments: // or #
  const lineCommentRe = /(?:^|\s)(?:\/\/|#)\s*(.+)$/gm;
  let match;
  while ((match = lineCommentRe.exec(content))) {
    const text = match[1].trim();
    if (text.length > 5 && !isDirectiveComment(text) && !isSecretLike(text, codeGraphNames)) {
      texts.push(text);
    }
  }

  // Block comments: /* ... */ or """ ... """
  const blockRe = /\/\*\*?\s*([\s\S]*?)\*\/|"""([\s\S]*?)"""|'''([\s\S]*?)'''/g;
  while ((match = blockRe.exec(content))) {
    const text = (match[1] || match[2] || match[3] || '')
      .replace(/^\s*\*\s?/gm, '') // strip leading * in JSDoc
      .trim();
    if (text.length > 5 && !isDirectiveComment(text) && !isSecretLike(text, codeGraphNames)) {
      texts.push(text);
    }
  }

  return texts.join(' ');
}

/**
 * A comment for a tool, not a reader: a shebang (`#!/usr/bin/env node`) or one whose
 * every word is joined by '-', ':' or '@' (`eslint-disable no-console`,
 * `tslint:disable`, `@ts-ignore`). Judged by shape, so no list of tools to grow;
 * "re-run the tests" has plain words and stays.
 */
export function isDirectiveComment(text) {
  if (text.startsWith('!')) return true;
  return text.split(/[\s,]+/).filter(Boolean).every((w) => /[-:@]/.test(w));
}

// ---------------------------------------------------------------------------
// Secret Detection
// ---------------------------------------------------------------------------

/**
 * Check if text looks like it contains a secret/credential.
 * F9: If the term also appears as an identifier name in the code graph,
 * it's a variable name, not a secret value — exempt it.
 *
 * @param {string} text
 * @param {Set<string>} [codeGraphNames] - Known entity names from code-graph.db
 * @returns {boolean}
 */
export function isSecretLike(text, codeGraphNames) {
  if (!SECRET_PATTERNS.some(pattern => pattern.test(text))) return false;
  // F9: If any word in the text appears as a code graph identifier, exempt it.
  // Comments like "// Validates password_hash" contain entity names embedded
  // in natural language — check each word, not the full string.
  if (codeGraphNames && codeGraphNames.size > 0) {
    const words = text.trim().split(/[\s.,;:()[\]{}<>!?'"=+\-*/&|^~#@]+/);
    if (words.some(w => w.length > 1 && codeGraphNames.has(w))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Script Detection
// ---------------------------------------------------------------------------

/**
 * Detect dominant Unicode script of text.
 * Returns 'latin', 'cjk', or 'other' based on first 5000 chars.
 */
export function detectScript(text) {
  const sample = text.slice(0, 5000);
  let latin = 0, cjk = 0, other = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0);
    if (code <= 0x7F || (code >= 0xC0 && code <= 0x024F)) latin++;
    else if ((code >= 0x4E00 && code <= 0x9FFF) ||
             (code >= 0x3400 && code <= 0x4DBF) ||
             (code >= 0x3040 && code <= 0x30FF) ||
             (code >= 0xAC00 && code <= 0xD7AF)) cjk++;
    else other++;
  }
  const total = latin + cjk + other || 1;
  if (cjk / total > 0.8) return 'cjk';
  if (latin / total > 0.5) return 'latin';
  return 'other';
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Tokenize NL text into lowercase words, filtering stop words and short tokens.
 * F8: CJK/non-Latin support via Intl.Segmenter when >80% is CJK script.
 */
export function tokenizeNL(text) {
  if (!text) return [];

  const script = detectScript(text);

  // F8: Use Intl.Segmenter for CJK-dominant text
  if (script === 'cjk' && typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
      const segments = segmenter.segment(text.toLowerCase());
      return [...segments]
        .filter(s => s.isWordLike && s.segment.length > 1)
        .map(s => s.segment);
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
  }

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

// ---------------------------------------------------------------------------
// N-gram Extraction
// ---------------------------------------------------------------------------

/**
 * Extract bigrams from a token list.
 * @returns {Map<string, number>} bigram -> count
 */
export function extractBigrams(tokens) {
  const bigrams = new Map();
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
  }
  return bigrams;
}

/**
 * Extract trigrams from a token list.
 * @returns {Map<string, number>} trigram -> count
 */
export function extractTrigrams(tokens) {
  const trigrams = new Map();
  for (let i = 0; i < tokens.length - 2; i++) {
    const trigram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
    trigrams.set(trigram, (trigrams.get(trigram) || 0) + 1);
  }
  return trigrams;
}
