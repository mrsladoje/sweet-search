#!/usr/bin/env node
/**
 * Benchmark CatBoost Router Exports
 *
 * Tests exported JS routers against the query evaluation set.
 * Reports Strict Accuracy, Utility Accuracy, and model size.
 */

import { readFileSync, existsSync } from 'fs';
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

// Load evaluation query set
function loadQuerySet() {
  const querySetPath = join(__dirname, '../evaluation/query-sets/mixed.json');
  if (!existsSync(querySetPath)) {
    console.error('Query set not found:', querySetPath);
    process.exit(1);
  }
  const content = readFileSync(querySetPath, 'utf-8');
  return JSON.parse(content);
}

// Dynamic import of CatBoost router
async function loadRouter(routerPath) {
  const fullPath = join(__dirname, 'output', routerPath);
  if (!existsSync(fullPath)) {
    console.error(`Router not found: ${fullPath}`);
    return null;
  }

  try {
    const module = await import(fullPath);
    return module.routeQueryCatBoost;
  } catch (err) {
    console.error(`Failed to load router ${routerPath}:`, err.message);
    return null;
  }
}

// Get expected route for a query
function getExpectedRoute(query) {
  // Per-query override takes precedence
  if (query.expectedRoute) {
    return query.expectedRoute.toUpperCase();
  }

  // For translation queries without explicit route:
  // - T1 (transliteration) queries with ASCII-like identifiers → LEXICAL
  // - T2 (translation) queries → SEMANTIC (they need concept matching)
  // - T3 (structural) queries → STRUCTURAL or HYBRID

  // Default behavior based on tier
  if (query.tier === 'T1') {
    return 'LEXICAL';  // Transliteration - lexical search works
  } else if (query.tier === 'T2') {
    return 'SEMANTIC';  // Translation needed - semantic search
  } else if (query.tier === 'T3') {
    return 'STRUCTURAL';  // Structural intent
  }

  // Fallback: non-ASCII with no tier → SEMANTIC (needs translation)
  const hasNonAscii = /[^\x00-\x7F]/.test(query.query);
  return hasNonAscii ? 'SEMANTIC' : 'LEXICAL';
}

// Check if prediction matches expected (utility grading)
function isUtilityMatch(predicted, expected) {
  const equivalents = UTILITY_EQUIVALENT[expected] || [expected];
  return equivalents.includes(predicted);
}

// Benchmark a single router
async function benchmarkRouter(routerPath) {
  const router = await loadRouter(routerPath);
  if (!router) return null;

  const querySet = loadQuerySet();
  const queries = querySet.queries;

  let strictCorrect = 0;
  let utilityCorrect = 0;
  let total = 0;

  const results = [];

  for (const q of queries) {
    const features = extractAllFeatures(q.query);
    const result = router(features);
    const predicted = result.mode;
    const expected = getExpectedRoute(q);

    const strictMatch = predicted === expected;
    const utilityMatch = isUtilityMatch(predicted, expected);

    if (strictMatch) strictCorrect++;
    if (utilityMatch) utilityCorrect++;
    total++;

    results.push({
      id: q.id,
      query: q.query,
      expected,
      predicted,
      strictMatch,
      utilityMatch,
      confidence: result.confidence,
    });
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
    total,
    lines,
    bytes,
    results,
  };
}

// Main benchmark
async function main() {
  const depths = [4, 5, 6, 7, 8];

  console.log('═'.repeat(80));
  console.log('CatBoost Router Benchmark (Translation-Fallback Query Set)');
  console.log('═'.repeat(80));
  console.log();

  const results = [];

  for (const depth of depths) {
    const routerPath = `v45_router_d${depth}.js`;
    console.log(`Benchmarking depth ${depth}...`);

    const result = await benchmarkRouter(routerPath);
    if (result) {
      results.push({ depth, ...result });
      console.log(`  Strict: ${(result.strictAccuracy * 100).toFixed(1)}%, Utility: ${(result.utilityAccuracy * 100).toFixed(1)}%`);
    }
  }

  // Summary table
  console.log();
  console.log('═'.repeat(80));
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(80));
  console.log();
  console.log('Depth | Strict Acc | Utility Acc | Lines   | Size (KB)');
  console.log('------|------------|-------------|---------|----------');

  for (const r of results) {
    console.log(
      `  ${r.depth}   | ` +
      `${(r.strictAccuracy * 100).toFixed(1).padStart(8)}% | ` +
      `${(r.utilityAccuracy * 100).toFixed(1).padStart(9)}% | ` +
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
  console.log('RECOMMENDATION');
  console.log('═'.repeat(80));
  console.log();
  console.log(`🏆 Best Depth: ${best.depth}`);
  console.log(`   Utility Accuracy: ${(best.utilityAccuracy * 100).toFixed(1)}%`);
  console.log(`   Strict Accuracy: ${(best.strictAccuracy * 100).toFixed(1)}%`);
  console.log(`   Model Size: ${best.lines} lines (${(best.bytes / 1024).toFixed(1)} KB)`);

  // Show misclassifications for best model
  const misses = best.results.filter(r => !r.utilityMatch);
  if (misses.length > 0) {
    console.log();
    console.log(`⚠️  Misclassified queries (${misses.length}):`);
    for (const m of misses.slice(0, 10)) {
      console.log(`   ${m.id}: "${m.query}" → ${m.predicted} (expected: ${m.expected})`);
    }
    if (misses.length > 10) {
      console.log(`   ... and ${misses.length - 10} more`);
    }
  }
}

main().catch(console.error);
