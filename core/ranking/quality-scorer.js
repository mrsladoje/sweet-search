/**
 * Quality-Aware Chunk/Context Weighting
 *
 * Computes quality priors for search results so that not all chunks are
 * treated equally. Each result gets a 0-1 quality score based on six
 * factors: test proximity, recency (git blame last-modified date),
 * symbol centrality (PageRank), comment density, cyclomatic complexity
 * estimate, and chunk size preference.
 *
 * Usage:
 *   const scorer = new QualityScorer({ dbPath, repoMap: { pageRank, loadGraph, buildAdjacency } });
 *   const scored = scorer.scoreResults(results);
 */

import { existsSync, statSync } from 'fs';
import path from 'path';
import { DB_PATHS } from '../infrastructure/config/index.js';

/** Weights for each quality factor (must sum to 1.0) */
const FACTOR_WEIGHTS = {
  testProximity: 0.20,
  recency: 0.15,
  centrality: 0.25,
  commentDensity: 0.15,
  complexity: 0.10,
  sizeScore: 0.15,
};

/** Branching keywords used to estimate cyclomatic complexity */
const COMPLEXITY_KEYWORDS = /\b(if|else|switch|case|for|while|try|catch)\b|&&|\|\||\?/g;

/** Comment-line heuristic patterns */
const COMMENT_LINE_RE = /^\s*(\/\/|#(?!!)|\/\*|\*(?!\/)|\*\/)/;

/** Test file patterns (relative to source file) */
const TEST_SUFFIXES = ['.test.js', '.spec.js', '.test.ts', '.spec.ts', '.test.mjs', '.spec.mjs'];
const TEST_DIRS = ['__tests__', 'tests', 'test', 'spec'];

/** @type {Map<string, number>} filePath -> testProximity score */
const _testProximityCache = new Map();

/**
 * Test proximity: does a companion test file exist for the given source path?
 * @param {string} filePath - Source file path
 * @returns {number} 1.0 if test exists, 0.3 otherwise
 */
export function scoreTestProximity(filePath) {
  if (!filePath) return 0.3;
  if (_testProximityCache.has(filePath)) return _testProximityCache.get(filePath);

  const score = _computeTestProximity(filePath);
  _testProximityCache.set(filePath, score);
  return score;
}

function _computeTestProximity(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  // Test files themselves always count as tested
  for (const suffix of TEST_SUFFIXES) {
    if (filePath.endsWith(suffix)) return 1.0;
  }
  for (const td of TEST_DIRS) {
    if (filePath.includes(`/${td}/`) || filePath.includes(`\\${td}\\`)) return 1.0;
  }

  for (const suffix of TEST_SUFFIXES) {
    if (existsSync(path.join(dir, `${base}${suffix}`))) return 1.0;
  }

  for (const td of TEST_DIRS) {
    for (const suffix of TEST_SUFFIXES) {
      if (existsSync(path.join(dir, td, `${base}${suffix}`))) return 1.0;
      if (existsSync(path.join(dir, '..', td, `${base}${suffix}`))) return 1.0;
    }
  }

  return 0.3;
}

/**
 * Comment density: ratio of comment lines to total lines.
 * Score = clamp(ratio * 3, 0, 1)
 * @param {string} text - Chunk text content
 * @returns {number} 0-1
 */
export function scoreCommentDensity(text) {
  if (!text) return 0;
  const lines = text.split('\n');
  if (lines.length === 0) return 0;

  let commentLines = 0;
  for (const line of lines) {
    if (COMMENT_LINE_RE.test(line)) commentLines++;
  }

  const ratio = commentLines / lines.length;
  return Math.min(ratio * 3, 1);
}

/**
 * Complexity estimate: count branching keywords / operators.
 * Score = 1 - clamp(count / 20, 0, 1) → simpler code scores higher.
 * @param {string} text - Chunk text content
 * @returns {number} 0-1
 */
export function scoreComplexity(text) {
  if (!text) return 1; // no code = no complexity
  const matches = text.match(COMPLEXITY_KEYWORDS);
  const count = matches ? matches.length : 0;
  return 1 - Math.min(count / 20, 1);
}

/**
 * Chunk size preference: medium-sized chunks (100-500 chars) score 1.0.
 * Outside that range, linearly decay to 0.3 minimum.
 * @param {string} text - Chunk text content
 * @returns {number} 0.3-1.0
 */
export function scoreSizePreference(text) {
  if (!text) return 0.3;
  const len = text.length;

  if (len >= 100 && len <= 500) return 1.0;

  if (len < 100) {
    return 0.3 + 0.7 * (len / 100);
  }

  const decay = Math.min((len - 500) / 1500, 1);
  return 1.0 - 0.7 * decay;
}

// Module-level: shared across scorer instances.
/** @type {Map<string, number>} filePath -> recency score */
const _recencyCache = new Map();

/**
 * Recency: how recently was this file last modified on disk?
 * Files edited today score 1.0; files untouched for a year score 0.1.
 * Uses filesystem mtime (fast, works on any filesystem).
 * This is a FILE-level score: all chunks from the same file share it.
 *
 * @param {string} filePath - Source file path
 * @returns {number} 0.1-1.0 (0.5 neutral if stat fails)
 */
export function scoreRecency(filePath) {
  if (!filePath) return 0.5;
  if (_recencyCache.has(filePath)) return _recencyCache.get(filePath);

  let score = 0.5;
  try {
    const mtimeMs = statSync(filePath).mtimeMs;
    const daysSinceLastEdit = (Date.now() - mtimeMs) / 86_400_000;
    score = Math.max(0.1, 1.0 - daysSinceLastEdit / 365);
  } catch {
    score = 0.5; // file not found or permission error
  }

  _recencyCache.set(filePath, score);
  return score;
}

export function clearRecencyCache() {
  _recencyCache.clear();
}

export function clearTestProximityCache() {
  _testProximityCache.clear();
}

export class QualityScorer {
  /**
   * @param {object} [options]
   * @param {string} [options.dbPath] - Path to code-graph.db for PageRank centrality
   * @param {Record<string, number>} [options.weights] - Override factor weights
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || DB_PATHS.codeGraph;
    this.weights = { ...FACTOR_WEIGHTS, ...options.weights };
    // The repo-map functions (core/graph/repo-map.js) are passed in: ranking may not import graph.
    this._repoMap = options.repoMap ?? null;

    this._pageRankScores = null;
    this._pageRankEntityMap = null;
    this._pageRankLoaded = false;
  }

  _repoMapFunctions() {
    const repoMap = this._repoMap ?? _repoMapModule;
    if (!repoMap) throw new Error('QualityScorer needs the repoMap option ({ pageRank, loadGraph, buildAdjacency })');
    return repoMap;
  }

  /** Loaded lazily; cached for the lifetime of this scorer instance. */
  _ensurePageRank() {
    if (this._pageRankLoaded) return;
    this._pageRankLoaded = true;

    try {
      if (!existsSync(this.dbPath)) return;

      const { loadGraph, buildAdjacency, pageRank } = this._repoMapFunctions();
      const graph = loadGraph(this.dbPath);
      if (!graph.entities.length) return;

      const { outEdges, allNodes, entityMap } = buildAdjacency(graph);
      const scores = pageRank(outEdges, allNodes);

      let maxScore = 0;
      for (const s of scores.values()) {
        if (s > maxScore) maxScore = s;
      }

      this._pageRankScores = new Map();
      this._pageRankEntityMap = entityMap;

      if (maxScore > 0) {
        for (const [id, s] of scores) {
          this._pageRankScores.set(id, s / maxScore);
        }
      }
    } catch {
      // Graph not available: centrality returns 0
    }
  }

  /**
   * Look up PageRank centrality for a result by matching file + name/line.
   * @param {object} result - Search result with file, name, startLine
   * @returns {number} 0-1 normalized PageRank score
   */
  _getCentrality(result) {
    this._ensurePageRank();
    if (!this._pageRankScores || !this._pageRankEntityMap) return 0;

    const file = result.file || result.file_path || '';
    const name = result.name || '';
    const startLine = result.startLine ?? result.start_line;

    for (const [id, ent] of this._pageRankEntityMap) {
      if (ent.file_path !== file) continue;
      if (name && ent.name === name) {
        return this._pageRankScores.get(id) || 0;
      }
      if (startLine != null && ent.start_line === startLine) {
        return this._pageRankScores.get(id) || 0;
      }
    }

    // Fallback: average score of all entities in this file
    let sum = 0;
    let count = 0;
    for (const [id, ent] of this._pageRankEntityMap) {
      if (ent.file_path === file) {
        sum += this._pageRankScores.get(id) || 0;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  /**
   * Score a single chunk/result.
   * @param {object} chunk - Result object with file, name, content/text, startLine, etc.
   * @returns {{ score: number, factors: Record<string, number> }}
   */
  scoreChunk(chunk) {
    const text = chunk.content || chunk.text || chunk.signature || '';
    const file = chunk.file || chunk.file_path || '';

    const factors = {
      testProximity: scoreTestProximity(file),
      recency: scoreRecency(file),
      centrality: this._getCentrality(chunk),
      commentDensity: scoreCommentDensity(text),
      complexity: scoreComplexity(text),
      sizeScore: scoreSizePreference(text),
    };

    let score = 0;
    for (const [key, weight] of Object.entries(this.weights)) {
      score += (factors[key] || 0) * weight;
    }

    score = Math.max(0, Math.min(1, score));

    return { score, factors };
  }

  /** Adds quality_score and quality_factors to each result. */
  scoreResults(results) {
    if (!Array.isArray(results) || results.length === 0) return results;

    return results.map(r => {
      const { score, factors } = this.scoreChunk(r);
      return {
        ...r,
        quality_score: score,
        quality_factors: factors,
      };
    });
  }
}

// Process-wide fallback for a scorer built without the `repoMap` option.
let _repoMapModule = null;

/**
 * @deprecated Pass `repoMap` to the QualityScorer constructor. Kept until core/search/sweet-search.js
 * stops calling it.
 * @param {{ pageRank: Function, loadGraph: Function, buildAdjacency: Function }} mod
 */
export function setRepoMapModule(mod) {
  _repoMapModule = mod;
}

export default QualityScorer;
