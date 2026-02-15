/**
 * Abstract base class for benchmark adapters.
 * Each benchmark knows how to download, normalize, and clean its data.
 *
 * Data format contract:
 *   corpus.jsonl:  { doc_id, code, language, func_name, repo, path }
 *   queries.jsonl: { query_id, query, relevant_doc_ids, language }
 */

import { existsSync } from 'fs';
import path from 'path';
import { loadJsonl } from '../lib/data-loader.js';

export class BaseBenchmark {
  /**
   * @param {Object} config
   * @param {string} config.name - Benchmark identifier (used as directory name)
   * @param {string[]} config.languages - Programming languages covered
   * @param {string} config.description - Human-readable description
   * @param {string} config.source - Data source URL
   * @param {string} [config.downloadCmd] - Command to download data
   */
  constructor(config) {
    this._name = config.name;
    this._languages = config.languages;
    this._description = config.description;
    this._source = config.source;
    this._downloadCmd = config.downloadCmd || '';
  }

  get name() { return this._name; }
  get languages() { return this._languages; }
  get description() { return this._description; }
  get source() { return this._source; }
  get downloadCmd() { return this._downloadCmd; }

  /**
   * Check if benchmark data is already downloaded.
   * @param {string} evalDir - Path to eval/ directory
   * @returns {boolean}
   */
  hasData(evalDir) {
    const dataDir = path.join(evalDir, 'data', this._name);
    return existsSync(path.join(dataDir, 'corpus.jsonl')) &&
           existsSync(path.join(dataDir, 'queries.jsonl'));
  }

  /**
   * Load normalized benchmark data.
   * @param {string} evalDir - Path to eval/ directory
   * @returns {{ corpus: Array, queries: Array }}
   */
  loadData(evalDir) {
    const dataDir = path.join(evalDir, 'data', this._name);
    return {
      corpus: loadJsonl(path.join(dataDir, 'corpus.jsonl')),
      queries: loadJsonl(path.join(dataDir, 'queries.jsonl')),
    };
  }

  /**
   * Optional: benchmark-specific query cleaning.
   * Override in subclasses for special handling.
   * @param {string} query - Raw query text
   * @returns {string} Cleaned query
   */
  cleanQuery(query) {
    return query
      .replace(/^\/\/\s*/, '')
      .replace(/^\/\*+\s*/, '')
      .replace(/^\*+\s*/, '')
      .replace(/^#\s*/, '')
      .trim();
  }

  /**
   * Get a summary of this benchmark for display.
   * @returns {string}
   */
  toString() {
    return `${this._name}: ${this._description} [${this._languages.join(', ')}]`;
  }
}
