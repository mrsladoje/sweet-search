/**
 * Data loading utilities for benchmark evaluation.
 * Handles JSONL reading/writing and data normalization.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, createReadStream } from 'fs';
import { createInterface } from 'readline';

// V8 caps single strings at 0x1fffffe8 bytes (~512 MiB). The benchmark
// harness must handle JSONL files past that cap (BRIGHT-code: 761 MiB
// corpus). Stream above a conservative threshold so even arbitrarily
// large benchmarks load cleanly across all backends.
const JSONL_STREAM_THRESHOLD_BYTES = 256 * 1024 * 1024;  // 256 MiB

/**
 * Load a JSONL file into an array of objects.
 *
 * Uses a streaming line reader for files larger than 256 MiB to avoid
 * V8's max-string-length crash. Below the threshold uses readFileSync
 * for speed (identical output: array of parsed objects).
 *
 * Returns a Promise for large files; sync result for small ones. All
 * call sites in this harness already `await` the result (Promise stays
 * compatible — a synchronous return resolves immediately under `await`).
 *
 * @param {string} filePath - Path to .jsonl file
 * @returns {Array<Object> | Promise<Array<Object>>}
 */
export function loadJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const size = statSync(filePath).size;
  if (size < JSONL_STREAM_THRESHOLD_BYTES) {
    const content = readFileSync(filePath, 'utf-8');
    return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  return loadJsonlStream(filePath);
}

/**
 * Streaming JSONL loader for files > V8 string limit.
 * @param {string} filePath
 * @returns {Promise<Array<Object>>}
 */
export async function loadJsonlStream(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  const out = [];
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`Failed to parse JSONL line ${lineNo} of ${filePath}: ${err.message}`);
    }
  }
  return out;
}

/**
 * Write an array of objects to a JSONL file.
 * @param {string} filePath - Output path
 * @param {Array<Object>} data - Array of objects to serialize
 */
export function writeJsonl(filePath, data) {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = data.map(d => JSON.stringify(d)).join('\n') + '\n';
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Normalize a corpus document to the standard format.
 * @param {Object} raw - Raw document from any benchmark
 * @returns {Object} Normalized corpus document
 */
export function normalizeCorpusDoc(raw) {
  return {
    doc_id: raw.doc_id || '',
    code: raw.code || '',
    language: raw.language || 'unknown',
    func_name: raw.func_name || '',
    repo: raw.repo || '',
    path: raw.path || '',
  };
}

/**
 * Normalize a query to the standard format.
 * @param {Object} raw - Raw query from any benchmark
 * @returns {Object} Normalized query
 */
export function normalizeQuery(raw) {
  return {
    query_id: raw.query_id || '',
    query: raw.query || '',
    relevant_doc_ids: raw.relevant_doc_ids || [],
    language: raw.language || 'unknown',
  };
}
