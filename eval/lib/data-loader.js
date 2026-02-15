/**
 * Data loading utilities for benchmark evaluation.
 * Handles JSONL reading/writing and data normalization.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

/**
 * Load a JSONL file into an array of objects.
 * @param {string} filePath - Path to .jsonl file
 * @returns {Array<Object>}
 */
export function loadJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
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
