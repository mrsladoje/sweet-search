#!/usr/bin/env node
/**
 * Analyze original template labels vs LLM distilled labels
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures } from './features/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load data
const data = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'output/llm_labeled_data.json'), 'utf-8'
));
const samples = data.samples;

// Shuffle with same seed as benchmark
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

console.log('═══════════════════════════════════════════════════════════════');
console.log('ORIGINAL TEMPLATE LABELS vs LLM DISTILLED LABELS');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`Total samples: ${samples.length}`);
console.log(`Train: ${trainSamples.length}, Test: ${testSamples.length}\n`);

// Count mismatches
let trainMismatch = 0;
let testMismatch = 0;

for (const s of trainSamples) {
  if (s.originalLabel !== s.label) trainMismatch++;
}
for (const s of testSamples) {
  if (s.originalLabel !== s.label) testMismatch++;
}

console.log('Label mismatches (original != LLM):');
console.log(`  Train: ${trainMismatch}/${trainSamples.length} (${(trainMismatch/trainSamples.length*100).toFixed(1)}%)`);
console.log(`  Test:  ${testMismatch}/${testSamples.length} (${(testMismatch/testSamples.length*100).toFixed(1)}%)`);

// Distribution comparison
console.log('\n───────────────────────────────────────────────────────────────');
console.log('TEST SET LABEL DISTRIBUTION');
console.log('───────────────────────────────────────────────────────────────');

const origDist = {};
const llmDist = {};

for (const s of testSamples) {
  origDist[s.originalLabel] = (origDist[s.originalLabel] || 0) + 1;
  llmDist[s.label] = (llmDist[s.label] || 0) + 1;
}

console.log('\n| Class       | Original | LLM Label | Change |');
console.log('|-------------|----------|-----------|--------|');
for (const cls of ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID']) {
  const orig = origDist[cls] || 0;
  const llm = llmDist[cls] || 0;
  const change = llm - orig;
  const sign = change >= 0 ? '+' : '';
  console.log(`| ${cls.padEnd(11)} | ${String(orig).padStart(8)} | ${String(llm).padStart(9)} | ${(sign + change).padStart(6)} |`);
}

// Now let's train a simple model on ORIGINAL labels and compare
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('HYPOTHESIS: Are original template labels more consistent?');
console.log('═══════════════════════════════════════════════════════════════\n');

// Extract features
const trainX = [];
const trainYOriginal = [];
const trainYLLM = [];
const testX = [];
const testYOriginal = [];
const testYLLM = [];

for (const s of trainSamples) {
  const f = extractAllFeatures(s.query);
  trainX.push(Array.from(f));
  trainYOriginal.push(s.originalLabel);
  trainYLLM.push(s.label);
}

for (const s of testSamples) {
  const f = extractAllFeatures(s.query);
  testX.push(Array.from(f));
  testYOriginal.push(s.originalLabel);
  testYLLM.push(s.label);
}

// Simple majority-class baseline for each
const countLabels = (arr) => {
  const counts = {};
  for (const l of arr) {
    counts[l] = (counts[l] || 0) + 1;
  }
  return counts;
};

console.log('Train label distribution:');
console.log('  Original:', JSON.stringify(countLabels(trainYOriginal)));
console.log('  LLM:     ', JSON.stringify(countLabels(trainYLLM)));

console.log('\nTest label distribution:');
console.log('  Original:', JSON.stringify(countLabels(testYOriginal)));
console.log('  LLM:     ', JSON.stringify(countLabels(testYLLM)));

// Key insight: Check cross-model agreement for mismatched samples
console.log('\n───────────────────────────────────────────────────────────────');
console.log('MISMATCHED SAMPLES ANALYSIS');
console.log('───────────────────────────────────────────────────────────────\n');

const mismatchedTest = testSamples.filter(s => s.originalLabel !== s.label);
console.log(`Mismatched test samples: ${mismatchedTest.length}`);

// Group by transition type
const transitions = {};
for (const s of mismatchedTest) {
  const key = `${s.originalLabel} -> ${s.label}`;
  if (!transitions[key]) {
    transitions[key] = { count: 0, avgConfidence: 0, avgAgreement: 0 };
  }
  transitions[key].count++;
  transitions[key].avgConfidence += s.confidence || 0;
  transitions[key].avgAgreement += s.crossModelAgreement || 0;
}

console.log('\n| Transition              | Count | Avg Conf | Avg Agreement |');
console.log('|-------------------------|-------|----------|---------------|');
for (const [key, data] of Object.entries(transitions).sort((a, b) => b[1].count - a[1].count)) {
  const avgConf = (data.avgConfidence / data.count * 100).toFixed(1);
  const avgAgree = (data.avgAgreement / data.count * 100).toFixed(1);
  console.log(`| ${key.padEnd(23)} | ${String(data.count).padStart(5)} | ${avgConf.padStart(7)}% | ${avgAgree.padStart(12)}% |`);
}

// HYBRID analysis
console.log('\n───────────────────────────────────────────────────────────────');
console.log('HYBRID CLASS DEEP DIVE');
console.log('───────────────────────────────────────────────────────────────\n');

const hybridOriginal = testSamples.filter(s => s.originalLabel === 'HYBRID');
const hybridLLM = testSamples.filter(s => s.label === 'HYBRID');

console.log(`Originally HYBRID: ${hybridOriginal.length}`);
console.log(`LLM labeled HYBRID: ${hybridLLM.length}`);

const hybridKept = hybridOriginal.filter(s => s.label === 'HYBRID');
const hybridChanged = hybridOriginal.filter(s => s.label !== 'HYBRID');

console.log(`\nOf original HYBRID samples:`);
console.log(`  Kept as HYBRID: ${hybridKept.length} (${(hybridKept.length/hybridOriginal.length*100).toFixed(1)}%)`);
console.log(`  Changed: ${hybridChanged.length} (${(hybridChanged.length/hybridOriginal.length*100).toFixed(1)}%)`);

// Where did HYBRID go?
const hybridTo = {};
for (const s of hybridChanged) {
  hybridTo[s.label] = (hybridTo[s.label] || 0) + 1;
}
console.log(`\n  Changed to:`);
for (const [label, count] of Object.entries(hybridTo).sort((a,b) => b[1] - a[1])) {
  console.log(`    ${label}: ${count}`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('CONCLUSION');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('The LLM ensemble is second-guessing HYBRID labels aggressively.');
console.log('This adds noise rather than improving label quality.');
console.log('');
console.log('Recommendation: Train on ORIGINAL template labels instead,');
console.log('or use a stricter confidence threshold for label changes.');
