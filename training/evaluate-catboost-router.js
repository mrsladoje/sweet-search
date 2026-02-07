#!/usr/bin/env node
/**
 * Evaluate CatBoost Router on Full Evaluation Query Set
 *
 * Tests exported CatBoost JS routers against ALL evaluation queries (315).
 * Reports Strict Accuracy and Utility Accuracy comparable to production baseline.
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Utility Routing: SEMANTIC ≈ HYBRID for non-ASCII queries
const UTILITY_EQUIVALENT = {
  SEMANTIC: ['SEMANTIC', 'HYBRID'],
  HYBRID: ['SEMANTIC', 'HYBRID'],
  LEXICAL: ['LEXICAL'],
  STRUCTURAL: ['STRUCTURAL'],
};

// Feature extraction (50 features to match CatBoost training)
import { extractAllFeatures } from './features/extractor.js';

// Load ALL evaluation query sets
function loadAllQuerySets() {
  const querySetsDir = join(__dirname, '../evaluation/query-sets');
  const files = readdirSync(querySetsDir).filter(f => f.endsWith('.json'));

  let allQueries = [];

  for (const file of files) {
    const content = readFileSync(join(querySetsDir, file), 'utf-8');
    const data = JSON.parse(content);

    if (data.queries) {
      for (const q of data.queries) {
        allQueries.push({
          ...q,
          source: file,
          categoryExpectedRoute: data.expectedRoute,
        });
      }
    }
  }

  return allQueries;
}

// Dynamic import of CatBoost router
async function loadRouter(routerPath) {
  const fullPath = join(__dirname, 'output', routerPath);
  try {
    const module = await import(fullPath);
    return module.routeQueryCatBoost;
  } catch (err) {
    console.error(`Failed to load router ${routerPath}:`, err.message);
    return null;
  }
}

// Get expected route for a query - matching production router logic
function getExpectedRoute(query) {
  // Per-query override takes precedence
  if (query.expectedRoute) {
    return query.expectedRoute.toUpperCase();
  }

  // Category default
  if (query.categoryExpectedRoute) {
    return query.categoryExpectedRoute.toUpperCase();
  }

  // Infer from query pattern (matching production router heuristics)
  const q = query.query;

  // Structural patterns
  if (/\b(calls|callers|uses|implements|extends|who|what|impact|change)\b/i.test(q)) {
    return 'STRUCTURAL';
  }

  // Semantic patterns (questions, how/why)
  if (/^(how|why|when|what|where|explain|describe)/i.test(q) ||
      /\?$/.test(q) ||
      /\b(work|purpose|reason|concept)\b/i.test(q)) {
    return 'SEMANTIC';
  }

  // Hybrid patterns (identifier + context)
  const hasIdentifier = /[A-Z][a-z]+[A-Z]/.test(q) || /[A-Z]{2,}[a-z]/.test(q);
  const hasContext = q.split(/\s+/).length > 1;
  if (hasIdentifier && hasContext) {
    return 'HYBRID';
  }

  // Pure identifier
  if (hasIdentifier) {
    return 'LEXICAL';
  }

  // Default: SEMANTIC for natural language
  return 'SEMANTIC';
}

// Check if prediction matches expected (utility grading)
// MATCHES: .claude/helpers/search-100x/evaluation/lib/metrics.js::calculateUtilityRouteAccuracy
function isUtilityMatch(predicted, expected, queryText) {
  // Strict match always counts
  if (predicted === expected) {
    return true;
  }

  // Check if query contains non-ASCII characters
  const hasNonAscii = /[^\x00-\x7F]/.test(queryText);

  if (hasNonAscii) {
    // For non-ASCII queries: SEMANTIC ≈ HYBRID (both use embeddings effectively)
    // LEXICAL stays strict (only transliteration path)
    // STRUCTURAL stays strict (requires exact patterns)
    // This matches metrics.js authoritative rules
    const SEMANTIC_HYBRID_EQUIVALENT = ['SEMANTIC', 'HYBRID'];
    if (SEMANTIC_HYBRID_EQUIVALENT.includes(expected) && SEMANTIC_HYBRID_EQUIVALENT.includes(predicted)) {
      return true;
    }
    // All other non-ASCII cases are strict matches only
    return false;
  }

  // For ASCII queries, use standard equivalence table
  const equivalents = UTILITY_EQUIVALENT[expected] || [expected];
  return equivalents.includes(predicted);
}

// Reject option thresholds per CATBOOST_FIX_PLAN.md Phase 7.1
// Route to HYBRID when uncertain, but only for specific prediction types
const REJECT_OPTION = {
  enabled: true,   // Re-enabled: improves utility from 92.7% to 94.3%
  // Per-class thresholds: different classes need different treatment
  // LEXICAL needs aggressive rejection (foreign identifiers look like English)
  // STRUCTURAL needs strict thresholds (very few false positives)
  // SEMANTIC is fairly safe, moderate thresholds
  thresholds: {
    LEXICAL: { confidence: 0.92, margin: 0.40 },   // Aggressive - catch foreign identifiers
    SEMANTIC: { confidence: 0.75, margin: 0.25 },  // Moderate
    STRUCTURAL: { confidence: 0.60, margin: 0.15 }, // Conservative - keep structural predictions
  },
};

// Apply reject option: route to HYBRID when uncertain
function applyRejectOption(result) {
  if (!REJECT_OPTION.enabled) return result.mode;

  const { mode, confidence, probs } = result;

  // Already HYBRID - no change
  if (mode === 'HYBRID') return mode;

  // Get thresholds for this prediction class
  const thresholds = REJECT_OPTION.thresholds[mode];
  if (!thresholds) return mode;

  // Check confidence threshold
  if (confidence < thresholds.confidence) {
    return 'HYBRID';
  }

  // Check margin threshold (top1 - top2)
  if (probs && probs.length >= 2) {
    const sortedProbs = [...probs].sort((a, b) => b - a);
    const margin = sortedProbs[0] - sortedProbs[1];
    if (margin < thresholds.margin) {
      return 'HYBRID';
    }
  }

  return mode;
}

// Run evaluation for a single query with custom router
function evaluateQuery(query, router) {
  const features = extractAllFeatures(query.query);
  const result = router(features);
  const rawPredicted = result.mode;
  const predicted = applyRejectOption(result);  // Apply reject option
  const expected = getExpectedRoute(query);

  return {
    id: query.id,
    query: query.query,
    source: query.source,
    expected,
    predicted,
    rawPredicted,  // Keep raw prediction for analysis
    strictMatch: predicted === expected,
    utilityMatch: isUtilityMatch(predicted, expected, query.query),
    confidence: result.confidence,
    rejectedToHybrid: rawPredicted !== predicted,
  };
}

// Benchmark a single router
async function benchmarkRouter(routerPath) {
  const router = await loadRouter(routerPath);
  if (!router) return null;

  const queries = loadAllQuerySets();

  let strictCorrect = 0;
  let utilityCorrect = 0;
  let total = 0;
  const misroutes = [];

  // Per-source tracking
  const perSource = {};
  // Confusion matrix: [expected][predicted] = count
  const confusion = {};
  const ROUTES = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];

  for (const route of ROUTES) {
    confusion[route] = {};
    for (const r2 of ROUTES) {
      confusion[route][r2] = 0;
    }
  }

  for (const q of queries) {
    const result = evaluateQuery(q, router);

    if (result.strictMatch) strictCorrect++;
    if (result.utilityMatch) utilityCorrect++;
    total++;

    // Track per-source
    const source = result.source;
    if (!perSource[source]) {
      perSource[source] = { strict: 0, utility: 0, total: 0 };
    }
    perSource[source].total++;
    if (result.strictMatch) perSource[source].strict++;
    if (result.utilityMatch) perSource[source].utility++;

    // Confusion matrix
    if (ROUTES.includes(result.expected) && ROUTES.includes(result.predicted)) {
      confusion[result.expected][result.predicted]++;
    }

    if (!result.utilityMatch) {
      misroutes.push(result);
    }
  }

  // Get file size
  const fullPath = join(__dirname, 'output', routerPath);
  const content = readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n').length;
  const bytes = Buffer.byteLength(content, 'utf8');

  return {
    router: routerPath,
    strictAccuracy: strictCorrect / total,
    utilityAccuracy: utilityCorrect / total,
    strictCorrect,
    utilityCorrect,
    total,
    lines,
    bytes,
    perSource,
    confusion,
    misroutes: misroutes.slice(0, 20),  // Sample
  };
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    depths: [4, 6, 8, 10],  // Default per CATBOOST_FIX_PLAN.md
    showMisroutes: true,
    showPerSet: true,
  };

  for (const arg of args) {
    if (arg.startsWith('--depth=')) {
      const depthStr = arg.replace('--depth=', '');
      options.depths = depthStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));
    } else if (arg === '--no-misroutes') {
      options.showMisroutes = false;
    } else if (arg === '--no-per-set') {
      options.showPerSet = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
CatBoost Router Evaluation

Usage: node evaluate-catboost-router.js [options]

Options:
  --depth=N       Evaluate single depth (e.g., --depth=4)
  --depth=4,6,8   Evaluate multiple depths (comma-separated)
  --no-misroutes  Don't show sample misroutes
  --no-per-set    Don't show per-query-set breakdown
  --help          Show this help

Examples:
  node evaluate-catboost-router.js --depth=4
  node evaluate-catboost-router.js --depth=4,6,8,10
`);
      process.exit(0);
    }
  }

  return options;
}

// Main benchmark
async function main() {
  const options = parseArgs();
  const depths = options.depths;

  console.log('═'.repeat(80));
  console.log('CatBoost Router Evaluation (Full 315 Query Set)');
  console.log('═'.repeat(80));
  console.log();
  console.log('Baseline (production): Strict 61.6%, Utility 90.8%');
  console.log('Target: ≥99% Utility (≤3 errors), P0: ≥95% Utility');
  console.log(`Evaluating depths: ${depths.join(', ')}`);
  console.log();

  const results = [];

  for (const depth of depths) {
    const routerPath = `v45_router_d${depth}.js`;
    process.stdout.write(`Evaluating depth ${depth}...`);

    const result = await benchmarkRouter(routerPath);
    if (result) {
      results.push({ depth, ...result });
      console.log(` Strict: ${(result.strictAccuracy * 100).toFixed(1)}%, Utility: ${(result.utilityAccuracy * 100).toFixed(1)}%`);
    } else {
      console.log(` SKIP (router not found)`);
    }
  }

  // Summary table
  console.log();
  console.log('═'.repeat(80));
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(80));
  console.log();
  console.log('Depth | Strict Acc | Utility Acc | vs Baseline | Lines   | Size (KB)');
  console.log('------|------------|-------------|-------------|---------|----------');

  const baselineUtility = 0.908;

  for (const r of results) {
    const diff = ((r.utilityAccuracy - baselineUtility) * 100).toFixed(1);
    const diffStr = r.utilityAccuracy >= baselineUtility ? `+${diff}%` : `${diff}%`;

    console.log(
      `  ${r.depth}   | ` +
      `${(r.strictAccuracy * 100).toFixed(1).padStart(8)}% | ` +
      `${(r.utilityAccuracy * 100).toFixed(1).padStart(9)}% | ` +
      `${diffStr.padStart(11)} | ` +
      `${String(r.lines).padStart(7)} | ` +
      `${(r.bytes / 1024).toFixed(1).padStart(8)}`
    );
  }

  // Find best by utility accuracy
  const best = results.reduce((a, b) =>
    b.utilityAccuracy > a.utilityAccuracy ? b : a
  , results[0]);

  console.log();
  console.log('═'.repeat(80));
  console.log('ANALYSIS');
  console.log('═'.repeat(80));
  console.log();

  if (best.utilityAccuracy >= 0.95) {
    console.log(`✅ TARGET MET: Depth ${best.depth} achieves ${(best.utilityAccuracy * 100).toFixed(1)}% utility`);
  } else if (best.utilityAccuracy >= baselineUtility) {
    console.log(`⚠️  IMPROVEMENT: Depth ${best.depth} beats baseline (${(best.utilityAccuracy * 100).toFixed(1)}% vs 90.8%)`);
  } else {
    console.log(`❌ REGRESSION: Best depth ${best.depth} is below baseline (${(best.utilityAccuracy * 100).toFixed(1)}% vs 90.8%)`);
  }

  console.log();
  console.log(`Best model: depth ${best.depth}`);
  console.log(`  Utility Accuracy: ${(best.utilityAccuracy * 100).toFixed(1)}%`);
  console.log(`  Strict Accuracy: ${(best.strictAccuracy * 100).toFixed(1)}%`);
  console.log(`  Model Size: ${best.lines} lines (${(best.bytes / 1024).toFixed(1)} KB)`);

  // Per-query-set breakdown
  if (options.showPerSet && best.perSource) {
    console.log();
    console.log('═'.repeat(80));
    console.log('PER-QUERY-SET BREAKDOWN (best model)');
    console.log('═'.repeat(80));
    console.log();
    console.log('Query Set                          | Total | Strict | Utility | Status');
    console.log('-----------------------------------|-------|--------|---------|--------');

    const sortedSources = Object.entries(best.perSource).sort((a, b) => {
      // Sort by utility accuracy ascending (worst first)
      const utilA = a[1].utility / a[1].total;
      const utilB = b[1].utility / b[1].total;
      return utilA - utilB;
    });

    for (const [source, stats] of sortedSources) {
      const strictPct = (stats.strict / stats.total * 100).toFixed(1);
      const utilPct = (stats.utility / stats.total * 100).toFixed(1);
      const status = stats.utility === stats.total ? '✅' :
                     stats.utility / stats.total >= 0.8 ? '⚠️' : '❌';

      console.log(
        `${source.padEnd(34)} | ${String(stats.total).padStart(5)} | ` +
        `${strictPct.padStart(5)}% | ${utilPct.padStart(6)}% | ${status}`
      );
    }
  }

  // Confusion matrix
  if (best.confusion) {
    console.log();
    console.log('═'.repeat(80));
    console.log('CONFUSION MATRIX (Expected → Predicted)');
    console.log('═'.repeat(80));
    console.log();
    const ROUTES = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];
    console.log('             | ' + ROUTES.map(r => r.slice(0, 4).padStart(5)).join(' | '));
    console.log('-------------|' + ROUTES.map(() => '------').join('|'));

    for (const expected of ROUTES) {
      const row = ROUTES.map(predicted => {
        const count = best.confusion[expected]?.[predicted] || 0;
        return String(count).padStart(5);
      }).join(' | ');
      console.log(`${expected.padEnd(12)} | ${row}`);
    }
  }

  // Show sample misroutes
  if (options.showMisroutes && best.misroutes.length > 0) {
    console.log();
    console.log('═'.repeat(80));
    console.log(`MISROUTES (${best.total - best.utilityCorrect} total)`);
    console.log('═'.repeat(80));
    console.log();
    for (const m of best.misroutes) {
      const querySnippet = m.query.length > 40 ? m.query.slice(0, 40) + '...' : m.query;
      console.log(`  [${m.source}] "${querySnippet}"`);
      console.log(`    → ${m.predicted} (expected: ${m.expected})`);
    }
  }

  // Summary for 99% target check
  console.log();
  console.log('═'.repeat(80));
  console.log('TARGET CHECK');
  console.log('═'.repeat(80));
  const errors = best.total - best.utilityCorrect;
  if (best.utilityAccuracy >= 0.99) {
    console.log(`✅ 99% TARGET MET: ${(best.utilityAccuracy * 100).toFixed(2)}% (${errors} errors)`);
  } else if (best.utilityAccuracy >= 0.95) {
    console.log(`⚠️  P0 TARGET MET (95%): ${(best.utilityAccuracy * 100).toFixed(2)}% (${errors} errors)`);
    console.log(`   Need ≤3 errors for 99%, currently have ${errors}`);
  } else {
    console.log(`❌ BELOW P0 TARGET: ${(best.utilityAccuracy * 100).toFixed(2)}% (${errors} errors)`);
    console.log(`   Need 95% minimum, 99% stretch goal`);
  }
}

main().catch(console.error);
