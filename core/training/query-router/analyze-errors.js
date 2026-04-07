#!/usr/bin/env node
/**
 * Analyze misclassified samples from CatBoost model
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures } from './features/extractor.js';
import { routeQueryCatBoost } from './models/catboost_router_full.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load data
const rawData = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'output/llm_labeled_data.json'), 'utf-8'
));
const samples = rawData.samples;

// Same shuffle as benchmark
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
const testSamples = shuffled.slice(splitIdx);

// Find misclassified
const errors = [];
for (const s of testSamples) {
  const features = Array.from(extractAllFeatures(s.query));
  const result = routeQueryCatBoost(features);
  if (result.mode !== s.originalLabel) {
    errors.push({
      query: s.query,
      expected: s.originalLabel,
      predicted: result.mode,
      confidence: result.confidence.toFixed(3),
      language: s.language || 'en',
      subtype: s.subtype,
      probs: result.probs
    });
  }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(`MISCLASSIFIED SAMPLES (${errors.length} / ${testSamples.length} = ${(errors.length/testSamples.length*100).toFixed(2)}% error rate)`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Group by error type
const byType = {};
for (const e of errors) {
  const key = `${e.expected} → ${e.predicted}`;
  if (!byType[key]) byType[key] = [];
  byType[key].push(e);
}

for (const [type, items] of Object.entries(byType).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`\n--- ${type} (${items.length} errors) ---`);
  for (const e of items) {
    console.log(`\n  "${e.query}"`);
    console.log(`    expected=${e.expected}, predicted=${e.predicted}, conf=${e.confidence}`);
    console.log(`    lang=${e.language}, subtype=${e.subtype}`);
  }
}

// Summary by language
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('ERRORS BY LANGUAGE');
console.log('═══════════════════════════════════════════════════════════════');
const byLang = {};
for (const e of errors) {
  byLang[e.language] = (byLang[e.language] || 0) + 1;
}
for (const [lang, count] of Object.entries(byLang).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${lang}: ${count}`);
}

// Summary by subtype
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('ERRORS BY SUBTYPE');
console.log('═══════════════════════════════════════════════════════════════');
const bySubtype = {};
for (const e of errors) {
  bySubtype[e.subtype] = (bySubtype[e.subtype] || 0) + 1;
}
for (const [subtype, count] of Object.entries(bySubtype).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${subtype}: ${count}`);
}
