#!/usr/bin/env node
/**
 * Benchmark: CatBoost JS vs ID3 JS
 *
 * Compares both models trained on the same LLM-distilled data:
 * - Accuracy on held-out test set
 * - Inference latency (microseconds)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures } from './features/extractor.js';
import { routeQueryCatBoost } from './models/catboost_router_full.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load LLM-labeled data
const rawData = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'output/llm_labeled_data.json'), 'utf-8'
));
const samples = rawData.samples;

// Shuffle samples with fixed seed for reproducibility
function shuffle(arr, seed = 42) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const shuffledSamples = shuffle(samples);

// 80/20 split with shuffled data
const splitIdx = Math.floor(shuffledSamples.length * 0.8);
const testSamples = shuffledSamples.slice(splitIdx);

console.log('═══════════════════════════════════════════════════════════════');
console.log('BENCHMARK: CatBoost JS vs ID3 JS (on ORIGINAL template labels)');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`Test samples: ${testSamples.length}`);
console.log(`Training samples: ${splitIdx}`);

// Show test set label distribution (using ORIGINAL labels)
const testDist = {};
for (const s of testSamples) {
  testDist[s.originalLabel] = (testDist[s.originalLabel] || 0) + 1;
}
console.log('\nTest set distribution:');
for (const [label, count] of Object.entries(testDist).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(12)}: ${count}`);
}
console.log('');

// Extract features for test set
const testFeatures = testSamples.map(s => {
  const f = extractAllFeatures(s.query);
  return Array.from(f);
});
const testLabels = testSamples.map(s => s.originalLabel); // Use ORIGINAL labels for evaluation

// === CatBoost JS ===
console.log('───────────────────────────────────────────────────────────────');
console.log('CatBoost JS (294 trees, exported to pure JS)');
console.log('───────────────────────────────────────────────────────────────');

let catboostCorrect = 0;
for (let i = 0; i < testFeatures.length; i++) {
  const result = routeQueryCatBoost(testFeatures[i]);
  if (result.mode === testLabels[i]) {
    catboostCorrect++;
  }
}
const catboostAccuracy = catboostCorrect / testFeatures.length;
console.log(`Accuracy: ${(catboostAccuracy * 100).toFixed(2)}% (${catboostCorrect}/${testFeatures.length})`);

// Benchmark speed
const catboostIterations = 10000;
const catboostStart = performance.now();
for (let i = 0; i < catboostIterations; i++) {
  routeQueryCatBoost(testFeatures[i % testFeatures.length]);
}
const catboostTime = performance.now() - catboostStart;
const catboostPerQuery = (catboostTime / catboostIterations) * 1000; // μs
console.log(`Latency: ${catboostPerQuery.toFixed(2)} μs/query (${catboostIterations} iterations)`);

// === ID3 JS ===
console.log('\n───────────────────────────────────────────────────────────────');
console.log('ID3 JS (single tree, exported to pure JS)');
console.log('───────────────────────────────────────────────────────────────');

// Dynamically import the ID3 model (ES module)
const id3Module = await import('./output/id3_original_labels.js');
const routeQueryID3 = id3Module.routeQueryML || id3Module.default;

let id3Correct = 0;
for (let i = 0; i < testFeatures.length; i++) {
  const result = routeQueryID3(testFeatures[i]);
  if (result.mode.toUpperCase() === testLabels[i]) {
    id3Correct++;
  }
}
const id3Accuracy = id3Correct / testFeatures.length;
console.log(`Accuracy: ${(id3Accuracy * 100).toFixed(2)}% (${id3Correct}/${testFeatures.length})`);

// Benchmark speed
const id3Iterations = 10000;
const id3Start = performance.now();
for (let i = 0; i < id3Iterations; i++) {
  routeQueryID3(testFeatures[i % testFeatures.length]);
}
const id3Time = performance.now() - id3Start;
const id3PerQuery = (id3Time / id3Iterations) * 1000; // μs
console.log(`Latency: ${id3PerQuery.toFixed(2)} μs/query (${id3Iterations} iterations)`);

// === Per-class breakdown ===
console.log('\n───────────────────────────────────────────────────────────────');
console.log('PER-CLASS ANALYSIS');
console.log('───────────────────────────────────────────────────────────────');

const classes = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];
const catboostByClass = {};
const id3ByClass = {};

for (const cls of classes) {
  catboostByClass[cls] = { correct: 0, total: 0 };
  id3ByClass[cls] = { correct: 0, total: 0 };
}

for (let i = 0; i < testFeatures.length; i++) {
  const trueLabel = testLabels[i];
  catboostByClass[trueLabel].total++;
  id3ByClass[trueLabel].total++;

  const catResult = routeQueryCatBoost(testFeatures[i]);
  if (catResult.mode === trueLabel) catboostByClass[trueLabel].correct++;

  const id3Result = routeQueryID3(testFeatures[i]);
  if (id3Result.mode.toUpperCase() === trueLabel) id3ByClass[trueLabel].correct++;
}

console.log('| Class       | CatBoost     | ID3          | Samples |');
console.log('|-------------|--------------|--------------|---------|');
for (const cls of classes) {
  const catAcc = catboostByClass[cls].total > 0
    ? (catboostByClass[cls].correct / catboostByClass[cls].total * 100).toFixed(1)
    : '-';
  const id3Acc = id3ByClass[cls].total > 0
    ? (id3ByClass[cls].correct / id3ByClass[cls].total * 100).toFixed(1)
    : '-';
  const total = catboostByClass[cls].total;
  if (total > 0) {
    console.log(`| ${cls.padEnd(11)} | ${catAcc.padStart(10)}%  | ${id3Acc.padStart(10)}%  | ${String(total).padStart(7)} |`);
  }
}

// === Summary ===
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`
| Metric      | CatBoost JS  | ID3 JS       | Winner      |
|-------------|--------------|--------------|-------------|
| Accuracy    | ${(catboostAccuracy * 100).toFixed(2)}%       | ${(id3Accuracy * 100).toFixed(2)}%       | ${catboostAccuracy >= id3Accuracy ? 'CatBoost' : 'ID3'}     |
| Latency     | ${catboostPerQuery.toFixed(2)} μs     | ${id3PerQuery.toFixed(2)} μs      | ${catboostPerQuery <= id3PerQuery ? 'CatBoost' : 'ID3'}     |
| Speedup     | 1.0x         | ${(catboostPerQuery / id3PerQuery).toFixed(1)}x          | -           |
`);

// Accuracy gap analysis
const accuracyGap = Math.abs(catboostAccuracy - id3Accuracy) * 100;
if (accuracyGap < 2) {
  console.log('Recommendation: ID3 - Similar accuracy, much faster');
} else if (catboostAccuracy > id3Accuracy) {
  console.log(`Recommendation: CatBoost - ${accuracyGap.toFixed(1)}% accuracy advantage`);
} else {
  console.log(`Recommendation: ID3 - ${accuracyGap.toFixed(1)}% accuracy advantage AND faster`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
