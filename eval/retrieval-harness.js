#!/usr/bin/env node
/**
 * Retrieval Evaluation Harness
 *
 * Validates chunking/search changes against code retrieval benchmarks.
 * Metrics: Recall@k, MRR, NDCG@k
 *
 * Usage:
 *   node eval/retrieval-harness.js --evaluate             # Run evaluation on latest results
 *   node eval/retrieval-harness.js --save-baseline         # Save current as baseline
 *   node eval/retrieval-harness.js --compare               # Compare to baseline
 *   node eval/retrieval-harness.js --dataset=codesearchnet # Specific dataset
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Result entry format:
 *   { retrieved: string[], relevant: string[] }
 *
 * - `retrieved`: ordered list of doc IDs returned by search (rank order)
 * - `relevant`: set of ground-truth relevant doc IDs for the query
 */

export class RetrievalHarness {
  constructor(options = {}) {
    this.resultsDir = options.resultsDir || path.join(__dirname, 'results');
    this.baselineFile = options.baselineFile || path.join(this.resultsDir, 'baseline.json');
    this.k_values = options.k_values || [1, 5, 10, 20];
    this.deltaThresholds = options.deltaThresholds || {
      'recall@5': -0.02,
      'recall@20': -0.02,
      'mrr': -0.02,
    };
  }

  /**
   * Compute Recall@k: average fraction of relevant docs found in top-k.
   * For each query, recall = (# relevant found in top-k) / (# total relevant).
   * Equivalent to Success@k when each query has exactly 1 relevant doc.
   * @param {Array<{retrieved: string[], relevant: string[]}>} results
   * @param {number} k
   * @returns {number}
   */
  recallAtK(results, k) {
    if (results.length === 0) return 0;
    let totalRecall = 0;
    for (const r of results) {
      if (r.relevant.length === 0) continue;
      const topK = new Set(r.retrieved.slice(0, k));
      const found = r.relevant.filter(doc => topK.has(doc)).length;
      totalRecall += found / r.relevant.length;
    }
    return totalRecall / results.length;
  }

  /**
   * Compute Success@k (hit rate): fraction of queries with at least one relevant doc in top-k.
   * @param {Array<{retrieved: string[], relevant: string[]}>} results
   * @param {number} k
   * @returns {number}
   */
  successAtK(results, k) {
    if (results.length === 0) return 0;
    let hits = 0;
    for (const r of results) {
      const topK = r.retrieved.slice(0, k);
      if (topK.some(doc => r.relevant.includes(doc))) {
        hits++;
      }
    }
    return hits / results.length;
  }

  /**
   * Compute Mean Reciprocal Rank.
   * @param {Array<{retrieved: string[], relevant: string[]}>} results
   * @returns {number}
   */
  mrr(results) {
    if (results.length === 0) return 0;
    let total = 0;
    for (const r of results) {
      for (let i = 0; i < r.retrieved.length; i++) {
        if (r.relevant.includes(r.retrieved[i])) {
          total += 1 / (i + 1);
          break;
        }
      }
    }
    return total / results.length;
  }

  /**
   * Compute NDCG@k (Normalized Discounted Cumulative Gain).
   * Uses binary relevance (1 if relevant, 0 otherwise).
   * @param {Array<{retrieved: string[], relevant: string[]}>} results
   * @param {number} k
   * @returns {number}
   */
  ndcgAtK(results, k) {
    if (results.length === 0) return 0;
    let totalNdcg = 0;

    for (const r of results) {
      const topK = r.retrieved.slice(0, k);
      let dcg = 0;
      let idcg = 0;

      for (let i = 0; i < topK.length; i++) {
        const rel = r.relevant.includes(topK[i]) ? 1 : 0;
        dcg += rel / Math.log2(i + 2);
      }

      const numRelevant = Math.min(r.relevant.length, k);
      for (let i = 0; i < numRelevant; i++) {
        idcg += 1 / Math.log2(i + 2);
      }

      totalNdcg += idcg > 0 ? dcg / idcg : 0;
    }

    return totalNdcg / results.length;
  }

  /**
   * Run full evaluation and compute all metrics.
   * @param {Array<{retrieved: string[], relevant: string[]}>} results
   * @returns {Object} metrics keyed by name
   */
  evaluate(results) {
    const metrics = {};

    for (const k of this.k_values) {
      metrics[`recall@${k}`] = this.recallAtK(results, k);
      metrics[`ndcg@${k}`] = this.ndcgAtK(results, k);
    }

    metrics.mrr = this.mrr(results);
    metrics.totalQueries = results.length;
    metrics.timestamp = new Date().toISOString();

    return metrics;
  }

  /**
   * Compare current metrics against saved baseline. Check delta thresholds.
   * @param {Object} currentMetrics
   * @returns {Promise<{hasBaseline: boolean, deltas: Object, passed: boolean}>}
   */
  async compareToBaseline(currentMetrics) {
    let baseline = null;
    try {
      const baselineData = await fs.readFile(this.baselineFile, 'utf-8');
      baseline = JSON.parse(baselineData);
    } catch {
      return { hasBaseline: false, deltas: {}, passed: true };
    }

    const deltas = {};
    let passed = true;

    for (const [metric, threshold] of Object.entries(this.deltaThresholds)) {
      if (baseline[metric] !== undefined && currentMetrics[metric] !== undefined) {
        const delta = currentMetrics[metric] - baseline[metric];
        deltas[metric] = {
          baseline: baseline[metric],
          current: currentMetrics[metric],
          delta,
          threshold,
          passed: delta >= threshold,
        };
        if (delta < threshold) passed = false;
      }
    }

    return { hasBaseline: true, deltas, passed };
  }

  /**
   * Save metrics as new baseline.
   * @param {Object} metrics
   */
  async saveBaseline(metrics) {
    await fs.mkdir(this.resultsDir, { recursive: true });
    await fs.writeFile(this.baselineFile, JSON.stringify(metrics, null, 2));
  }

  /**
   * Save evaluation results with a timestamped filename.
   * @param {Object} metrics
   * @param {string} [name='latest']
   * @returns {Promise<string>} path to saved file
   */
  async saveResults(metrics, name = 'latest') {
    await fs.mkdir(this.resultsDir, { recursive: true });
    const filename = path.join(this.resultsDir, `eval_${name}_${Date.now()}.json`);
    await fs.writeFile(filename, JSON.stringify(metrics, null, 2));
    return filename;
  }

  /**
   * Format results as a readable text report.
   * @param {Object} metrics
   * @param {{hasBaseline: boolean, deltas: Object, passed: boolean}} comparison
   * @returns {string}
   */
  formatReport(metrics, comparison) {
    const lines = ['=== Retrieval Evaluation Report ===', ''];

    lines.push('Metrics:');
    for (const k of this.k_values) {
      if (metrics[`recall@${k}`] !== undefined) {
        lines.push(`  Recall@${k}:  ${(metrics[`recall@${k}`] * 100).toFixed(1)}%`);
      }
    }
    lines.push(`  MRR:        ${(metrics.mrr * 100).toFixed(1)}%`);
    for (const k of this.k_values) {
      if (metrics[`ndcg@${k}`] !== undefined) {
        lines.push(`  NDCG@${k}:   ${(metrics[`ndcg@${k}`] * 100).toFixed(1)}%`);
      }
    }
    lines.push(`  Queries:    ${metrics.totalQueries}`);

    if (comparison.hasBaseline) {
      lines.push('', 'Delta vs Baseline:');
      for (const [metric, info] of Object.entries(comparison.deltas)) {
        const sign = info.delta >= 0 ? '+' : '';
        const status = info.passed ? 'PASS' : 'FAIL';
        lines.push(`  ${metric}: ${sign}${(info.delta * 100).toFixed(1)}pp [${status}]`);
      }
      lines.push('', comparison.passed ? 'Overall: PASS' : 'Overall: FAIL - regression detected');
    } else {
      lines.push('', 'No baseline found. Use --save-baseline to create one.');
    }

    return lines.join('\n');
  }

  /**
   * Convert existing benchmark result file (from run_benchmark.js) to the
   * retrieval-harness result format for baseline comparison.
   *
   * The existing baseline stores aggregate metrics in `report.aggregate`
   * with keys like `recall_at_5`, `mrr_at_10`. We normalize these to
   * `recall@5`, `mrr` etc.
   *
   * @param {string} filePath - Path to existing benchmark result JSON
   * @returns {Promise<Object>} Normalized metrics
   */
  async importBenchmarkResult(filePath) {
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const agg = data.aggregate || {};

    const metrics = {};
    for (const k of this.k_values) {
      if (agg[`recall_at_${k}`] !== undefined) {
        metrics[`recall@${k}`] = agg[`recall_at_${k}`];
      }
      if (agg[`ndcg_at_${k}`] !== undefined) {
        metrics[`ndcg@${k}`] = agg[`ndcg_at_${k}`];
      }
    }
    metrics.mrr = agg.mrr_at_10 || 0;
    metrics.totalQueries = data.queryCount || 0;
    metrics.timestamp = data.timestamp || new Date().toISOString();
    metrics.source = filePath;

    return metrics;
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function cli() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')).map(a => a.split('=')[0]));
  const getArg = (name) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=')[1] : null;
  };

  if (flags.has('--help') || flags.has('-h')) {
    console.log(`
Retrieval Evaluation Harness

Usage: node eval/retrieval-harness.js [options]

Commands:
  --evaluate          Evaluate latest benchmark results
  --save-baseline     Save current results as baseline
  --compare           Compare latest results to baseline
  --import=FILE       Import existing benchmark result as baseline

Options:
  --dataset=NAME      Dataset to evaluate (default: codesearchnet)
  --baseline=FILE     Path to baseline file
  --li-quant=SCHEME   Late interaction quantization scheme for A/B testing
                      Values: float32, int8, int4, int4-quantile, wht-int8, wht-int4
  --help, -h          Show this help
`);
    process.exit(0);
  }

  const dataset = getArg('dataset') || 'codesearchnet';
  const liQuant = getArg('li-quant') || null; // CRA A/B testing: float32|int8|int4|int4-quantile|wht-int8|wht-int4
  const resultsDir = path.join(__dirname, 'results');
  const baselineOverride = getArg('baseline');

  // CRA A/B: if --li-quant is set, suffix the results/baseline files
  const quantSuffix = liQuant ? `_${liQuant}` : '';

  const harness = new RetrievalHarness({
    resultsDir,
    baselineFile: baselineOverride || path.join(resultsDir, `${dataset}${quantSuffix}_baseline.json`),
    liQuant,
  });

  if (flags.has('--import')) {
    const importFile = getArg('import');
    if (!importFile) {
      console.error('--import requires a file path: --import=path/to/result.json');
      process.exit(1);
    }
    const metrics = await harness.importBenchmarkResult(importFile);
    await harness.saveBaseline(metrics);
    console.log(`Imported and saved baseline from ${importFile}`);
    console.log(JSON.stringify(metrics, null, 2));
    process.exit(0);
  }

  // Find latest result file for the dataset
  const latestFile = await findLatestResult(resultsDir, dataset);
  if (!latestFile) {
    console.error(`No results found for dataset "${dataset}" in ${resultsDir}`);
    console.error('Run the benchmark first: node eval/run_benchmark.js');
    process.exit(2);
  }

  console.log(`Using result: ${path.basename(latestFile)}`);
  const metrics = await harness.importBenchmarkResult(latestFile);

  if (flags.has('--save-baseline')) {
    await harness.saveBaseline(metrics);
    console.log(`Baseline saved to ${harness.baselineFile}`);
  }

  if (flags.has('--compare') || flags.has('--evaluate')) {
    const comparison = await harness.compareToBaseline(metrics);
    const report = harness.formatReport(metrics, comparison);
    console.log('\n' + report);
    if (comparison.hasBaseline && !comparison.passed) {
      process.exit(1);
    }
  }

  if (!flags.has('--save-baseline') && !flags.has('--compare') && !flags.has('--evaluate')) {
    // Default: evaluate + compare
    const comparison = await harness.compareToBaseline(metrics);
    const report = harness.formatReport(metrics, comparison);
    console.log('\n' + report);
  }
}

/**
 * Find the latest timestamped result file for a dataset.
 */
async function findLatestResult(resultsDir, dataset) {
  if (!existsSync(resultsDir)) return null;
  const files = await fs.readdir(resultsDir);
  const matching = files
    .filter(f => f.startsWith(`${dataset}_`) && f.endsWith('.json') && !f.includes('baseline') && !f.includes('retrieval_baseline'))
    .sort()
    .reverse();
  return matching.length > 0 ? path.join(resultsDir, matching[0]) : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
