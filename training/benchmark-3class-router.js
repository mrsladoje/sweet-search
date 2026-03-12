#!/usr/bin/env node
/**
 * 3-Class CatBoost Router Benchmark
 *
 * Measures:
 * - Latency: p50/p95/p99 over 100k iterations
 * - Accuracy: on eval set (excluding structural-only query sets)
 * - Zero structural leak: ML model never outputs 'structural'
 * - Comparison: v45 4-class vs v46 3-class
 */

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Feature extraction
import { extractAllFeatures } from './features/extractor.js';

// Structural eval sets — excluded from accuracy (structural is opt-in only)
const STRUCTURAL_EVAL_SETS = new Set([
  'structural.json',
  'english-novel-structural.json',
]);

// Load evaluation queries (excluding structural-only sets)
function loadEvalQueries() {
  const querySetsDir = join(__dirname, '../evaluation/query-sets');
  const files = readdirSync(querySetsDir).filter(f => f.endsWith('.json'));
  const queries = [];

  for (const file of files) {
    if (STRUCTURAL_EVAL_SETS.has(file)) continue;
    const content = readFileSync(join(querySetsDir, file), 'utf-8');
    const data = JSON.parse(content);
    if (data.queries) {
      for (const q of data.queries) {
        queries.push({
          ...q,
          source: file,
          categoryExpectedRoute: data.expectedRoute,
        });
      }
    }
  }

  return queries;
}

// Dynamic import of router
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

// Latency benchmark
function benchLatency(router, queries, iterations = 100000) {
  // Pre-extract features for all queries
  const featureSets = queries.map(q => extractAllFeatures(q.query));

  // Warmup
  for (let i = 0; i < 1000; i++) {
    router(featureSets[i % featureSets.length]);
  }

  // Measure
  const timings = [];
  for (let i = 0; i < iterations; i++) {
    const features = featureSets[i % featureSets.length];
    const start = performance.now();
    router(features);
    const elapsed = (performance.now() - start) * 1000; // μs
    timings.push(elapsed);
  }

  timings.sort((a, b) => a - b);
  return {
    p50: timings[Math.floor(iterations * 0.5)],
    p95: timings[Math.floor(iterations * 0.95)],
    p99: timings[Math.floor(iterations * 0.99)],
    mean: timings.reduce((a, b) => a + b, 0) / iterations,
    min: timings[0],
    max: timings[timings.length - 1],
  };
}

// Get expected route
function getExpectedRoute(query) {
  if (query.expectedRoute) return query.expectedRoute.toUpperCase();
  if (query.categoryExpectedRoute) return query.categoryExpectedRoute.toUpperCase();
  return 'SEMANTIC'; // default
}

// Utility match
function isUtilityMatch(predicted, expected, queryText) {
  if (predicted === expected) return true;
  const hasNonAscii = /[^\x00-\x7F]/.test(queryText);
  if (hasNonAscii) {
    const equiv = ['SEMANTIC', 'HYBRID'];
    if (equiv.includes(expected) && equiv.includes(predicted)) return true;
    return false;
  }
  const equivalents = {
    SEMANTIC: ['SEMANTIC', 'HYBRID'],
    HYBRID: ['SEMANTIC', 'HYBRID'],
    LEXICAL: ['LEXICAL'],
  };
  return (equivalents[expected] || [expected]).includes(predicted);
}

async function main() {
  console.log('═'.repeat(70));
  console.log('3-Class CatBoost Router Benchmark');
  console.log('═'.repeat(70));
  console.log();

  const queries = loadEvalQueries();
  console.log(`Evaluation queries: ${queries.length} (structural sets excluded)`);

  // Try loading v46 3-class router
  const router = await loadRouter('v46_router_d4.js');
  if (!router) {
    console.error('\nv46_router_d4.js not found. Train the model first:');
    console.error('  python training/models/train_catboost.py --data training/output/catboost_training_data_3class.json --output training/models/query_router_3class.cbm');
    console.error('  python training/models/export_catboost_to_js.py --model training/models/query_router_3class.cbm --output training/output/v46_router_d4.js');
    process.exit(1);
  }

  // === ACCURACY ===
  console.log('\n--- Accuracy ---');
  let strictCorrect = 0;
  let utilityCorrect = 0;
  let structuralLeaks = 0;
  const misroutes = [];

  for (const q of queries) {
    const features = extractAllFeatures(q.query);
    const result = router(features);
    const predicted = result.mode;
    const expected = getExpectedRoute(q);

    // Zero structural leak check
    if (predicted === 'STRUCTURAL') {
      structuralLeaks++;
    }

    const strict = predicted === expected;
    const utility = isUtilityMatch(predicted, expected, q.query);

    if (strict) strictCorrect++;
    if (utility) utilityCorrect++;
    if (!utility) {
      misroutes.push({ query: q.query, source: q.source, predicted, expected });
    }
  }

  const strictAcc = (strictCorrect / queries.length * 100).toFixed(1);
  const utilityAcc = (utilityCorrect / queries.length * 100).toFixed(1);

  console.log(`  Strict:  ${strictAcc}% (${strictCorrect}/${queries.length})`);
  console.log(`  Utility: ${utilityAcc}% (${utilityCorrect}/${queries.length})`);
  console.log(`  Structural leaks: ${structuralLeaks} (target: 0)`);

  if (misroutes.length > 0 && misroutes.length <= 20) {
    console.log(`\n  Misroutes (${misroutes.length}):`);
    for (const m of misroutes.slice(0, 15)) {
      const snippet = m.query.length > 45 ? m.query.slice(0, 45) + '...' : m.query;
      console.log(`    [${m.source}] "${snippet}" → ${m.predicted} (expected: ${m.expected})`);
    }
  }

  // === LATENCY ===
  console.log('\n--- Latency (JS fallback, 100k iterations) ---');
  const latency = benchLatency(router, queries);
  console.log(`  p50:  ${latency.p50.toFixed(1)}μs`);
  console.log(`  p95:  ${latency.p95.toFixed(1)}μs`);
  console.log(`  p99:  ${latency.p99.toFixed(1)}μs`);
  console.log(`  mean: ${latency.mean.toFixed(1)}μs`);

  // === ZERO STRUCTURAL LEAK ===
  console.log('\n--- Zero Structural Leak Check ---');
  if (structuralLeaks === 0) {
    console.log('  PASS: ML model never outputs STRUCTURAL');
  } else {
    console.log(`  FAIL: ${structuralLeaks} queries returned STRUCTURAL`);
  }

  // === SUMMARY ===
  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));

  const utilityPct = utilityCorrect / queries.length;
  if (utilityPct >= 0.98 && structuralLeaks === 0) {
    console.log(`PASS: ${utilityAcc}% utility accuracy, 0 structural leaks`);
  } else if (utilityPct >= 0.95) {
    console.log(`PARTIAL: ${utilityAcc}% utility (target: 98%+), ${structuralLeaks} leaks`);
  } else {
    console.log(`FAIL: ${utilityAcc}% utility (target: 98%+), ${structuralLeaks} leaks`);
  }
}

main().catch(console.error);
