#!/usr/bin/env node
/**
 * Train models on ORIGINAL template labels (not LLM-distilled)
 *
 * Hypothesis: Template labels are more consistent than LLM labels
 * because LLMs over-classify as SEMANTIC
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures, getAllFeatureNames } from './features/extractor.js';
import { buildTree, evaluate, generateTypeScriptModule, predict } from './models/decision-tree.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load data - use originalLabel instead of label
const data = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'output/llm_labeled_data.json'), 'utf-8'
));
const samples = data.samples;

console.log('═══════════════════════════════════════════════════════════════');
console.log('TRAINING ON ORIGINAL TEMPLATE LABELS');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`Total samples: ${samples.length}`);

// Shuffle with same seed
function shuffle(arr, seed = 42) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const shuffled = shuffle(samples);
const splitIdx = Math.floor(shuffled.length * 0.8);
const trainSamples = shuffled.slice(0, splitIdx);
const testSamples = shuffled.slice(splitIdx);

console.log(`Train: ${trainSamples.length}, Test: ${testSamples.length}\n`);

// Extract features
console.log('Extracting features...');
const featureNames = getAllFeatureNames();
const trainX = [];
const trainY = [];
const testX = [];
const testY = [];

for (const s of trainSamples) {
  const f = extractAllFeatures(s.query);
  trainX.push(Array.from(f));
  trainY.push(s.originalLabel); // Use ORIGINAL label!
}

for (const s of testSamples) {
  const f = extractAllFeatures(s.query);
  testX.push(Array.from(f));
  testY.push(s.originalLabel); // Use ORIGINAL label!
}

console.log(`Extracted ${featureNames.length} features\n`);

// Train ID3
console.log('───────────────────────────────────────────────────────────────');
console.log('Training ID3 on ORIGINAL labels...');
console.log('───────────────────────────────────────────────────────────────');

const startTrain = performance.now();
const tree = buildTree(trainX, trainY, featureNames, 10, 3);
const trainTime = performance.now() - startTrain;
console.log(`Training time: ${trainTime.toFixed(2)}ms`);

// Evaluate
const trainEval = evaluate(tree, trainX, trainY);
const testEval = evaluate(tree, testX, testY);

console.log(`\nTrain accuracy: ${(trainEval.accuracy * 100).toFixed(2)}%`);
console.log(`Test accuracy:  ${(testEval.accuracy * 100).toFixed(2)}%`);

console.log('\nPer-class accuracy (test):');
const LABELS = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];
for (const label of LABELS) {
  const total = Object.values(testEval.confusion[label]).reduce((a, b) => a + b, 0);
  const correct = testEval.confusion[label][label];
  if (total > 0) {
    console.log(`  ${label.padEnd(12)}: ${(correct / total * 100).toFixed(1)}% (${correct}/${total})`);
  }
}

// Benchmark inference
console.log('\nBenchmarking inference...');
const iterations = 10000;
const startInfer = performance.now();
for (let i = 0; i < iterations; i++) {
  predict(tree, testX[i % testX.length]);
}
const inferTime = performance.now() - startInfer;
const perQuery = (inferTime / iterations) * 1000;
console.log(`Average: ${perQuery.toFixed(2)}μs per query`);

// Export
const outputPath = path.join(__dirname, 'output/id3_original_labels.ts');
const tsCode = generateTypeScriptModule(tree, featureNames);
fs.writeFileSync(outputPath, tsCode);
console.log(`\nExported to: ${outputPath}`);

// Also save as JSON for CatBoost training
const catboostData = {
  samples: trainSamples.map((s, i) => ({
    query: s.query,
    label: s.originalLabel,
    features: trainX[i],
  }))
};
const catboostPath = path.join(__dirname, 'output/catboost_original_labels.json');
fs.writeFileSync(catboostPath, JSON.stringify(catboostData, null, 2));
console.log(`CatBoost training data: ${catboostPath}`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('COMPARISON: Original Labels vs LLM Labels');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`
| Training Data      | Test Accuracy |
|--------------------|---------------|
| LLM Labels         | 77.17%        |
| Original Labels    | ${(testEval.accuracy * 100).toFixed(2)}%        |
`);
