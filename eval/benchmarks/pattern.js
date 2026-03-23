/**
 * Pattern benchmark adapter — ColGrep hybrid regex + semantic search.
 *
 * Unlike standard benchmarks (corpus.jsonl + queries.jsonl with doc_ids),
 * pattern benchmarks use the project's own codebase and match against
 * gold chunk IDs rather than synthetic doc IDs.
 *
 * Data format:
 *   queries.jsonl: { query_id, regex, semantic_query, relevant_chunk_ids, relevant_files, language,
 *                    regex_family, difficulty, naming_quality, notes }
 */

import { existsSync } from 'fs';
import path from 'path';
import { loadJsonl } from '../lib/data-loader.js';
import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

export class PatternBenchmark extends BaseBenchmark {
  constructor() {
    super({
      name: 'pattern-benchmark',
      languages: ['javascript'],
      description: 'ColGrep pattern benchmark — hybrid regex + semantic code search',
      source: 'eval/data/pattern-benchmark/ (self-referential, no download needed)',
    });
  }

  /**
   * Pattern benchmark data lives in eval/data/pattern-benchmark/.
   * Only needs queries.jsonl (no corpus.jsonl — uses the project itself).
   */
  hasData(evalDir) {
    return existsSync(path.join(evalDir, 'data', this._name, 'queries.jsonl'));
  }

  /**
   * Load pattern benchmark queries.
   * Returns { queries } (no corpus — the project IS the corpus).
   */
  loadData(evalDir) {
    const dataDir = path.join(evalDir, 'data', this._name);
    return {
      queries: loadJsonl(path.join(dataDir, 'queries.jsonl')),
      corpus: null,  // Uses the project codebase directly
    };
  }

  /**
   * Get evaluation slices for this benchmark.
   * Pattern queries carry slice metadata (regex_family, difficulty, naming_quality).
   */
  getSliceKeys() {
    return ['regexFamily', 'difficulty', 'namingQuality'];
  }
}

BenchmarkRegistry.register(new PatternBenchmark());
export default PatternBenchmark;
