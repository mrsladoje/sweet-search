#!/usr/bin/env node
/**
 * Benchmark CatBoost and ID3 on realistic novel queries
 *
 * This benchmark uses completely novel examples not seen during training.
 * Queries are English-dominant with max 2 languages per query.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures } from '../features/extractor.js';
import { routeQueryCatBoost } from '../models/catboost_router_full.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load benchmark queries
const benchmark = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'query-sets/realistic-benchmark.json'), 'utf-8'
));

const queries = benchmark.queries;

console.log('═══════════════════════════════════════════════════════════════');
console.log(`REALISTIC BENCHMARK: ${benchmark.name}`);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`\n${benchmark.description}\n`);
console.log(`Total queries: ${queries.length}`);

// Distribution
const byLabel = {};
const byLang = {};
const bySubtype = {};

for (const q of queries) {
  byLabel[q.label] = (byLabel[q.label] || 0) + 1;
  byLang[q.lang] = (byLang[q.lang] || 0) + 1;
  bySubtype[q.subtype] = (bySubtype[q.subtype] || 0) + 1;
}

console.log('\nDistribution by label:');
for (const [label, count] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(12)}: ${count}`);
}

console.log('\nDistribution by language:');
for (const [lang, count] of Object.entries(byLang).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${lang.padEnd(12)}: ${count}`);
}

// Run CatBoost predictions
console.log('\n───────────────────────────────────────────────────────────────');
console.log('CatBoost JS Results');
console.log('───────────────────────────────────────────────────────────────');

const errors = [];
let correct = 0;
const perClass = { LEXICAL: { correct: 0, total: 0 }, SEMANTIC: { correct: 0, total: 0 },
                   STRUCTURAL: { correct: 0, total: 0 }, HYBRID: { correct: 0, total: 0 } };
const perLang = {};
const confusionMatrix = {};

for (const q of queries) {
  const features = Array.from(extractAllFeatures(q.query));
  const result = routeQueryCatBoost(features);

  perClass[q.label].total++;

  // Track per-language accuracy
  if (!perLang[q.lang]) perLang[q.lang] = { correct: 0, total: 0 };
  perLang[q.lang].total++;

  // Confusion matrix
  const key = `${q.label} → ${result.mode}`;
  confusionMatrix[key] = (confusionMatrix[key] || 0) + 1;

  if (result.mode === q.label) {
    correct++;
    perClass[q.label].correct++;
    perLang[q.lang].correct++;
  } else {
    errors.push({
      query: q.query,
      expected: q.label,
      predicted: result.mode,
      confidence: result.confidence.toFixed(3),
      lang: q.lang,
      subtype: q.subtype
    });
  }
}

const accuracy = (correct / queries.length * 100).toFixed(2);
console.log(`\nOverall Accuracy: ${accuracy}% (${correct}/${queries.length})`);

console.log('\nPer-class accuracy:');
console.log('| Class       | Accuracy     | Correct/Total |');
console.log('|-------------|--------------|---------------|');
for (const [cls, stats] of Object.entries(perClass)) {
  const acc = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : 'N/A';
  console.log(`| ${cls.padEnd(11)} | ${(acc + '%').padEnd(12)} | ${stats.correct}/${stats.total}`.padEnd(14) + '|');
}

console.log('\nPer-language accuracy:');
console.log('| Language    | Accuracy     | Correct/Total |');
console.log('|-------------|--------------|---------------|');
for (const [lang, stats] of Object.entries(perLang).sort((a, b) => b[1].total - a[1].total)) {
  const acc = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : 'N/A';
  console.log(`| ${lang.padEnd(11)} | ${(acc + '%').padEnd(12)} | ${stats.correct}/${stats.total}`.padEnd(14) + '|');
}

// Show errors
if (errors.length > 0) {
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log(`MISCLASSIFIED (${errors.length} errors)`);
  console.log('───────────────────────────────────────────────────────────────');

  // Group by error type
  const byType = {};
  for (const e of errors) {
    const key = `${e.expected} → ${e.predicted}`;
    if (!byType[key]) byType[key] = [];
    byType[key].push(e);
  }

  for (const [type, items] of Object.entries(byType).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n--- ${type} (${items.length}) ---`);
    for (const e of items.slice(0, 5)) { // Show max 5 per type
      console.log(`  "${e.query}"`);
      console.log(`    conf=${e.confidence}, lang=${e.lang}, subtype=${e.subtype}`);
    }
    if (items.length > 5) {
      console.log(`  ... and ${items.length - 5} more`);
    }
  }
}

// Confusion matrix summary
console.log('\n───────────────────────────────────────────────────────────────');
console.log('CONFUSION MATRIX');
console.log('───────────────────────────────────────────────────────────────');
const labels = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];
console.log('             | ' + labels.map(l => l.slice(0, 4).padStart(4)).join(' | ') + ' |');
console.log('-------------|------|------|------|------|');
for (const actual of labels) {
  const row = labels.map(pred => {
    const key = `${actual} → ${pred}`;
    return (confusionMatrix[key] || 0).toString().padStart(4);
  });
  console.log(`${actual.padEnd(12)} | ${row.join(' | ')} |`);
}

// Latency benchmark
console.log('\n───────────────────────────────────────────────────────────────');
console.log('LATENCY BENCHMARK');
console.log('───────────────────────────────────────────────────────────────');

const iterations = 1000;
const start = performance.now();
for (let i = 0; i < iterations; i++) {
  for (const q of queries.slice(0, 10)) { // Use first 10 queries
    const features = Array.from(extractAllFeatures(q.query));
    routeQueryCatBoost(features);
  }
}
const elapsed = performance.now() - start;
const avgLatency = (elapsed / (iterations * 10) * 1000).toFixed(2);
console.log(`Average latency: ${avgLatency} μs/query (${iterations * 10} iterations)`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`\nBenchmark: ${benchmark.name}`);
console.log(`Queries: ${queries.length} (novel, not in training set)`);
console.log(`Languages: English-dominant, max 2 per query`);
console.log(`\nCatBoost Accuracy: ${accuracy}%`);
console.log(`  LEXICAL:    ${(perClass.LEXICAL.correct / perClass.LEXICAL.total * 100).toFixed(1)}%`);
console.log(`  SEMANTIC:   ${(perClass.SEMANTIC.correct / perClass.SEMANTIC.total * 100).toFixed(1)}%`);
console.log(`  STRUCTURAL: ${(perClass.STRUCTURAL.correct / perClass.STRUCTURAL.total * 100).toFixed(1)}%`);
console.log(`  HYBRID:     ${(perClass.HYBRID.correct / perClass.HYBRID.total * 100).toFixed(1)}%`);
console.log(`\nLatency: ${avgLatency} μs/query`);
