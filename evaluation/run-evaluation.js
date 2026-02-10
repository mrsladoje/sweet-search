#!/usr/bin/env node
/**
 * SEARCH 100x Evaluation Runner
 *
 * Main CLI for running quality evaluation on the search system.
 *
 * Usage:
 *   node run-evaluation.js                    # Run all categories
 *   node run-evaluation.js --category=identifier
 *   node run-evaluation.js --baseline         # Save as baseline
 *   node run-evaluation.js --compare baseline.json
 *   node run-evaluation.js --ci               # Fail if below targets
 *   node run-evaluation.js --concurrency=5   # Parallel queries (default: 5)
 *   node run-evaluation.js --no-color        # Disable ANSI colors
 */

import { fileURLToPath } from 'url';
import { dirname, join, resolve, sep } from 'path';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import http from 'http';
import pMap from 'p-map';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { SweetSearch } from '../core/sweet-search.js';
import { calculateAllMetrics } from './lib/metrics.js';
import { CostTracker } from './lib/cost-tracker.js';
import { ResultMatcher, evaluateQuery } from './lib/result-matcher.js';
import {
  generateReport,
  formatConsoleReport,
  formatJsonReport,
  compareToBaseline,
} from './lib/report-generator.js';

// =============================================================================
// SERVER CLIENT (uses preheated server instead of fresh instance)
// =============================================================================

const SEARCH_SERVER_PORT = 9876;
const SEARCH_SERVER_SOCKET = '/tmp/search.sock';

/**
 * Client for the preheated search server.
 * Uses Unix socket for 30-50% faster performance than TCP.
 */
class ServerSearchClient {
  constructor(options = {}) {
    this.useSocket = options.useSocket !== false && existsSync(SEARCH_SERVER_SOCKET);
    this.verbose = options.verbose || false;
  }

  async init() {
    // Verify server is running
    try {
      const health = await this._request('/health');
      if (this.verbose) {
        console.log(`[ServerClient] Connected to preheated server (${this.useSocket ? 'Unix socket' : 'TCP'})`);
      }
      return true;
    } catch (e) {
      throw new Error(`Preheated server not running. Start with: node sweet-search.js --serve`);
    }
  }

  async search(query, options = {}) {
    const params = new URLSearchParams({
      q: query,
      k: options.k || 10,
      mode: options.mode || 'auto',
      format: 'json',
    });

    const response = await this._request(`/search?${params.toString()}`);
    return response;
  }

  _request(path) {
    return new Promise((resolve, reject) => {
      const options = this.useSocket
        ? { socketPath: SEARCH_SERVER_SOCKET, path, method: 'GET' }
        : { hostname: 'localhost', port: SEARCH_SERVER_PORT, path, method: 'GET' };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Exit codes for CI differentiation
const EXIT_CODES = {
  SUCCESS: 0,
  METRICS_BELOW_TARGET: 1,
  CONFIGURATION_ERROR: 2,
  INFRASTRUCTURE_ERROR: 3,
  BASELINE_REGRESSION: 4,
};

// Success targets from SEARCH_200X.md
const TARGETS = {
  mrr: 0.72,
  ndcg: 0.68,
  recall: 0.88,
  successRate: 0.90,
  routeAccuracy: 0.90,
  cacheHitRate: 0.80,
  maxCostPerQuery: 0.001,
  map: 0.70,
};

// Default configuration
const DEFAULT_CONFIG = {
  concurrency: 5,
  warmupQueries: 5,
  k: 10,
  recallK: 20,
  includeCI: true,
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = {
    category: null,
    baseline: false,
    compare: null,
    ci: false,
    concurrency: DEFAULT_CONFIG.concurrency,
    color: true,
    verbose: false,
    output: null,
    help: false,
    byLanguage: false,
    language: null,
    useServer: false,  // Use preheated server instead of fresh instance
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--baseline') {
      args.baseline = true;
    } else if (arg === '--ci') {
      args.ci = true;
    } else if (arg === '--no-color') {
      args.color = false;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg === '--by-language') {
      args.byLanguage = true;
    } else if (arg === '--use-server' || arg === '--server') {
      args.useServer = true;
    } else if (arg.startsWith('--language=')) {
      args.language = arg.split('=')[1];
    } else if (arg.startsWith('--category=')) {
      args.category = arg.split('=')[1];
    } else if (arg.startsWith('--compare=')) {
      args.compare = arg.split('=')[1];
    } else if (arg.startsWith('--concurrency=')) {
      // Clamp concurrency between 1 and 50 to prevent resource exhaustion
      const parsed = parseInt(arg.split('=')[1], 10);
      if (isNaN(parsed) || parsed < 1) {
        console.warn(`Warning: Invalid concurrency value '${arg.split('=')[1]}', using default ${DEFAULT_CONFIG.concurrency}`);
        args.concurrency = DEFAULT_CONFIG.concurrency;
      } else if (parsed > 50) {
        console.warn(`Warning: Concurrency clamped from ${parsed} to 50 (maximum allowed)`);
        args.concurrency = 50;
      } else {
        args.concurrency = parsed;
      }
    } else if (arg.startsWith('--output=')) {
      args.output = arg.split('=')[1];
    }
  }

  return args;
}

/**
 * Validate that a user-provided path is within allowed directories.
 * Prevents path traversal attacks via CLI arguments.
 * @param {string} userPath - The path provided by the user
 * @param {string} baseDir - The base directory to validate against (defaults to __dirname)
 * @returns {string} The resolved absolute path
 * @throws {Error} If path traversal is detected
 */
function validatePath(userPath, baseDir = __dirname) {
  const resolved = resolve(userPath);
  const allowedBase = resolve(baseDir);
  // Only allow paths within baseDir or its subdirectories
  if (!resolved.startsWith(allowedBase + sep) && resolved !== allowedBase) {
    throw new Error(`Path traversal detected: ${userPath} is outside allowed directory ${allowedBase}`);
  }
  return resolved;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
SEARCH 100x Evaluation Runner

Usage:
  node run-evaluation.js [options]

Options:
  --category=NAME     Run only specific category (identifier, conceptual, structural, mixed)
  --language=CODE     Run only queries for specific language (en, sr, de, zh, ja, etc.)
  --by-language       Show per-language breakdown in results
  --baseline          Save results as baseline for future comparison
  --compare=FILE      Compare results against baseline JSON file
  --ci                Exit with code 1 if metrics fall below targets
  --concurrency=N     Number of parallel queries (default: 5)
  --output=FILE       Save JSON report to file
  --use-server        Use preheated search server (faster, models pre-warmed)
  --no-color          Disable ANSI colors in output
  --verbose, -v       Show verbose output including per-query details
  --help, -h          Show this help message

Examples:
  node run-evaluation.js                          # Run all categories
  node run-evaluation.js --use-server             # Use preheated server (recommended)
  node run-evaluation.js --category=identifier    # Run only identifier queries
  node run-evaluation.js --language=sr            # Run only Serbian queries
  node run-evaluation.js --by-language            # Show per-language metrics
  node run-evaluation.js --baseline               # Save results as baseline
  node run-evaluation.js --ci --compare=baseline.json  # CI mode with comparison

Success Targets:
  MRR@10:       > ${TARGETS.mrr}
  NDCG@10:      > ${TARGETS.ndcg}
  MAP@10:       > ${TARGETS.map}
  Recall@20:    > ${TARGETS.recall}
  Success@10:   > ${(TARGETS.successRate * 100).toFixed(0)}%
  Route Acc:    > ${(TARGETS.routeAccuracy * 100).toFixed(0)}%
  Cache Rate:   > ${(TARGETS.cacheHitRate * 100).toFixed(0)}%
  $/query:      < $${TARGETS.maxCostPerQuery}

Exit Codes:
  0  Success - all metrics meet targets
  1  Metrics below target
  2  Configuration error (invalid paths, schema validation failure)
  3  Infrastructure error (search system failure)
  4  Baseline regression detected
`);
}

/**
 * Load query sets from JSON files with schema validation
 */
function loadQuerySets(category = null, language = null) {
  const querySetsDir = join(__dirname, 'query-sets');
  const queryFiles = readdirSync(querySetsDir)
    .filter(f => f.endsWith('.json') && f !== 'schema.json');

  // Load and compile schema for validation
  const schemaPath = join(querySetsDir, 'schema.json');
  let validate = null;

  if (existsSync(schemaPath)) {
    try {
      const ajv = new Ajv({ allErrors: true });
      addFormats(ajv);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
      validate = ajv.compile(schema);
    } catch (schemaError) {
      console.error(`Failed to load schema: ${schemaError.message}`);
      throw new Error(`Schema loading failed: ${schemaError.message}`);
    }
  } else {
    console.warn('Warning: schema.json not found, skipping validation');
  }

  const allQueries = [];

  for (const file of queryFiles) {
    const filePath = join(querySetsDir, file);
    const content = readFileSync(filePath, 'utf-8');

    let querySet;
    try {
      querySet = JSON.parse(content);
    } catch (parseError) {
      console.error(`Failed to parse ${file}: ${parseError.message}`);
      throw new Error(`Invalid JSON in query set: ${file}`);
    }

    // Validate against schema if available
    if (validate && !validate(querySet)) {
      console.error(`Schema validation failed for ${file}:`);
      for (const error of validate.errors) {
        console.error(`  - ${file}:${error.instancePath || '/'}: ${error.message}`);
      }
      throw new Error(`Invalid query set: ${file}`);
    }

    // Filter by category if specified
    if (category && querySet.category !== category) {
      continue;
    }

    // Add category to each query
    for (const query of querySet.queries) {
      // Filter by language if specified
      const queryLang = query.language || 'en';
      if (language && queryLang !== language) {
        continue;
      }

      allQueries.push({
        ...query,
        category: querySet.category,
        language: queryLang,
        expectedRoute: query.expectedRoute || querySet.expectedRoute,
      });
    }
  }

  return allQueries;
}

/**
 * Run warmup queries to get the search system into a hot state
 */
async function runWarmup(search, queries, count = 5) {
  console.log(`\nRunning ${count} warmup queries...`);

  const warmupQueries = queries.slice(0, count);
  for (const q of warmupQueries) {
    await search.search(q.query, { k: 5 });
  }

  console.log('Warmup complete.\n');
}

/**
 * Run cold start measurement
 */
async function measureColdStart(search, query) {
  console.log('Measuring cold start latency...');

  const start = performance.now();
  const result = await search.search(query, { k: 5 });
  const latency = performance.now() - start;

  console.log(`Cold start: ${latency.toFixed(0)}ms\n`);

  return {
    latency,
    result,
  };
}

/**
 * Calculate per-language metrics
 */
function calculatePerLanguageMetrics(results) {
  const byLanguage = {};

  for (const result of results) {
    const lang = result.language || 'en';
    if (!byLanguage[lang]) {
      byLanguage[lang] = {
        total: 0,
        successful: 0,
        routeCorrect: 0,
        latencies: [],
      };
    }

    byLanguage[lang].total++;
    if (result.success) byLanguage[lang].successful++;
    if (result.routeCorrect) byLanguage[lang].routeCorrect++;
    if (result.latencyMs) byLanguage[lang].latencies.push(result.latencyMs);
  }

  // Calculate metrics per language
  const metrics = {};
  for (const [lang, data] of Object.entries(byLanguage)) {
    const successRate = data.successful / data.total;
    const routeAccuracy = data.routeCorrect / data.total;
    const avgLatency = data.latencies.length > 0
      ? data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length
      : 0;

    metrics[lang] = {
      total: data.total,
      successRate,
      routeAccuracy,
      avgLatencyMs: avgLatency,
    };
  }

  return metrics;
}

/**
 * Run evaluation on all queries
 */
async function runEvaluation(args) {
  const queries = loadQuerySets(args.category, args.language);

  if (queries.length === 0) {
    console.error(`No queries found${args.category ? ` for category: ${args.category}` : ''}${args.language ? ` for language: ${args.language}` : ''}`);
    process.exit(EXIT_CODES.CONFIGURATION_ERROR);
  }

  console.log(`Loaded ${queries.length} queries${args.category ? ` (category: ${args.category})` : ''}${args.language ? ` (language: ${args.language})` : ''}`);

  // Initialize search client (preheated server or fresh instance)
  let search;
  if (args.useServer) {
    console.log('Connecting to preheated server...');
    search = new ServerSearchClient({ verbose: args.verbose });
    try {
      await search.init();
      console.log('✓ Connected to preheated server (FlashRank already warm!)');
    } catch (e) {
      console.error(`\n❌ ${e.message}`);
      console.error('Tip: Run session-preheat.sh first or use --no-server for fresh instance');
      process.exit(EXIT_CODES.INFRASTRUCTURE_ERROR);
    }
  } else {
    console.log('Initializing fresh SweetSearch instance...');
    search = new SweetSearch({ verbose: false });
    await search.init();
  }

  // Initialize cost tracker
  const costTracker = new CostTracker();

  // Run warmup
  await runWarmup(search, queries, DEFAULT_CONFIG.warmupQueries);

  // Cold start measurement (first query after warmup, simulating restart)
  const coldStart = await measureColdStart(search, queries[0].query);

  // Run queries with controlled concurrency
  console.log(`Running ${queries.length} queries (concurrency: ${args.concurrency})...\n`);

  let completedCount = 0;
  const startTime = performance.now();

  const results = await pMap(queries, async (query, index) => {
    const queryStart = performance.now();

    try {
      const { results, stats } = await search.search(query.query, { k: DEFAULT_CONFIG.k });
      const latencyMs = performance.now() - queryStart;

      // Track costs from stats
      costTracker.trackFromStats(stats);

      // Evaluate results against ground truth
      const evaluated = evaluateQuery(query, results, stats);

      // Mark first query as cold start
      if (index === 0) {
        evaluated.isColdStart = true;
        evaluated.latencyMs = coldStart.latency;
      } else {
        evaluated.latencyMs = latencyMs;
      }

      completedCount++;
      if (args.verbose || completedCount % 10 === 0) {
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(`\r  Progress: ${completedCount}/${queries.length} (${elapsed}s)`);
      }

      return evaluated;

    } catch (error) {
      console.error(`\nError on query ${query.id}: ${error.message}`);
      return {
        ...query,
        error: error.message,
        results: [],
        matchedResults: [],
        latencyMs: performance.now() - queryStart,
        success: false,
      };
    }
  }, { concurrency: args.concurrency });

  const totalTimeMs = performance.now() - startTime;
  const totalTimeSec = (totalTimeMs / 1000).toFixed(1);
  console.log(`\n\nCompleted ${results.length} queries in ${totalTimeSec}s\n`);

  // Generate report
  const report = generateReport(results, {
    k: DEFAULT_CONFIG.k,
    recallK: DEFAULT_CONFIG.recallK,
    includeCI: DEFAULT_CONFIG.includeCI,
    costTracker,
    totalTime: totalTimeMs,
  });

  // Output report
  console.log(formatConsoleReport(report, args.color));

  // Show per-language breakdown if requested
  if (args.byLanguage) {
    const langMetrics = calculatePerLanguageMetrics(results);

    console.log('\n' + '='.repeat(50));
    console.log('PER-LANGUAGE METRICS');
    console.log('='.repeat(50));
    console.log('\n  Lang    Queries  Success   Route     Latency');
    console.log('  ' + '-'.repeat(46));

    for (const [lang, m] of Object.entries(langMetrics).sort((a, b) => b[1].total - a[1].total)) {
      const successPct = (m.successRate * 100).toFixed(1);
      const routePct = (m.routeAccuracy * 100).toFixed(1);
      const latency = m.avgLatencyMs.toFixed(0);

      console.log(`  ${lang.padEnd(6)}  ${m.total.toString().padStart(7)}  ${successPct.padStart(6)}%  ${routePct.padStart(6)}%  ${latency.padStart(8)}ms`);
    }

    // Add to report for JSON output
    report.perLanguage = langMetrics;
  }

  // Compare to baseline if provided
  let hasRegressions = false;
  if (args.compare) {
    // Validate path to prevent traversal attacks
    let comparePath;
    try {
      comparePath = validatePath(args.compare);
    } catch (pathError) {
      console.error(`\nInvalid compare path: ${pathError.message}`);
      process.exit(EXIT_CODES.CONFIGURATION_ERROR);
    }

    if (existsSync(comparePath)) {
      const baselineContent = readFileSync(comparePath, 'utf-8');
      const baseline = JSON.parse(baselineContent);
      const comparison = compareToBaseline(report, baseline);

      console.log('\n' + '='.repeat(50));
      console.log('BASELINE COMPARISON');
      console.log('='.repeat(50));

      if (comparison.regressions.length > 0) {
        hasRegressions = true;
        console.log('\n[WARNING] REGRESSIONS DETECTED:');
        for (const r of comparison.regressions) {
          console.log(`  - ${r.metric}: ${r.baseline.toFixed(4)} -> ${r.current.toFixed(4)} (${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(4)})`);
        }
      }

      if (comparison.improvements.length > 0) {
        console.log('\n[OK] IMPROVEMENTS:');
        for (const i of comparison.improvements) {
          console.log(`  - ${i.metric}: ${i.baseline.toFixed(4)} -> ${i.current.toFixed(4)} (+${i.delta.toFixed(4)})`);
        }
      }

      if (comparison.regressions.length === 0 && comparison.improvements.length === 0) {
        console.log('\n[OK] No significant changes from baseline');
      }
    } else {
      console.error(`\nBaseline file not found: ${comparePath}`);
      process.exit(EXIT_CODES.CONFIGURATION_ERROR);
    }
  }

  // Save as baseline if requested
  if (args.baseline) {
    const baselinePath = join(__dirname, 'results', `baseline-${new Date().toISOString().split('T')[0]}.json`);
    writeFileSync(baselinePath, formatJsonReport(report));
    console.log(`\n✓ Baseline saved to: ${baselinePath}`);
  }

  // Save output if requested
  if (args.output) {
    // Validate path to prevent traversal attacks
    let outputPath;
    try {
      outputPath = validatePath(args.output);
    } catch (pathError) {
      console.error(`\nInvalid output path: ${pathError.message}`);
      process.exit(EXIT_CODES.CONFIGURATION_ERROR);
    }
    writeFileSync(outputPath, formatJsonReport(report));
    console.log(`\n[OK] Report saved to: ${outputPath}`);
  }

  // CI mode: check against targets
  if (args.ci) {
    console.log('\n' + '='.repeat(50));
    console.log('CI TARGET CHECK');
    console.log('='.repeat(50));

    const failures = [];

    if (report.aggregate.mrr < TARGETS.mrr) {
      failures.push(`MRR@10: ${report.aggregate.mrr.toFixed(4)} < ${TARGETS.mrr}`);
    }
    if (report.aggregate.ndcg < TARGETS.ndcg) {
      failures.push(`NDCG@10: ${report.aggregate.ndcg.toFixed(4)} < ${TARGETS.ndcg}`);
    }
    if (report.aggregate.recall < TARGETS.recall) {
      failures.push(`Recall@20: ${report.aggregate.recall.toFixed(4)} < ${TARGETS.recall}`);
    }
    if (report.aggregate.successRate < TARGETS.successRate) {
      failures.push(`Success@10: ${(report.aggregate.successRate * 100).toFixed(1)}% < ${(TARGETS.successRate * 100).toFixed(0)}%`);
    }
    // Use utility route accuracy for CI (SEMANTIC ≈ HYBRID for non-ASCII)
    const utilityRouteAcc = report.utilityRouteAccuracy?.accuracy ?? report.routeAccuracy.accuracy;
    if (utilityRouteAcc < TARGETS.routeAccuracy) {
      failures.push(`Route Accuracy (Utility): ${(utilityRouteAcc * 100).toFixed(1)}% < ${(TARGETS.routeAccuracy * 100).toFixed(0)}%`);
    }
    if (report.cost && report.cost.avgCostPerQuery > TARGETS.maxCostPerQuery) {
      failures.push(`Cost/query: $${report.cost.avgCostPerQuery.toFixed(6)} > $${TARGETS.maxCostPerQuery}`);
    }
    if (report.aggregate.map !== undefined && report.aggregate.map < TARGETS.map) {
      failures.push(`MAP@10: ${report.aggregate.map.toFixed(4)} < ${TARGETS.map}`);
    }

    if (failures.length > 0) {
      console.log('\n[FAILED] Below target thresholds:');
      for (const f of failures) {
        console.log(`  - ${f}`);
      }
      process.exit(EXIT_CODES.METRICS_BELOW_TARGET);
    } else {
      console.log('\n[PASSED] All metrics meet targets');
    }

    // If CI mode with comparison, exit with regression code if regressions detected
    if (hasRegressions) {
      console.log('\n[FAILED] Baseline regressions detected');
      process.exit(EXIT_CODES.BASELINE_REGRESSION);
    }
  }

  // Cleanup
  await search.close?.();

  return report;
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  try {
    await runEvaluation(args);
  } catch (error) {
    console.error('Evaluation failed:', error);

    // Distinguish between configuration/validation errors and infrastructure errors
    if (error.message.includes('Invalid query set') ||
        error.message.includes('Schema loading failed') ||
        error.message.includes('Invalid JSON') ||
        error.message.includes('Path traversal')) {
      process.exit(EXIT_CODES.CONFIGURATION_ERROR);
    }

    // Default to infrastructure error for unexpected failures
    process.exit(EXIT_CODES.INFRASTRUCTURE_ERROR);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(EXIT_CODES.INFRASTRUCTURE_ERROR);
});
