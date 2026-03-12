#!/usr/bin/env node
/**
 * Prepare 3-class training data by removing STRUCTURAL samples.
 *
 * STRUCTURAL queries are handled by regex patterns in query-router.js (100% accuracy).
 * Removing them from ML training eliminates STRUCTURAL↔SEMANTIC confusion.
 *
 * Input:  training/output/catboost_training_data.json (3728 samples, 4 classes)
 * Output: training/output/catboost_training_data_3class.json (3004 samples, 3 classes)
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const inputPath = join(__dirname, '..', 'output', 'catboost_training_data.json');
const outputPath = join(__dirname, '..', 'output', 'catboost_training_data_3class.json');

// Load original data
const data = JSON.parse(readFileSync(inputPath, 'utf-8'));
const samples = data.samples || data;

console.log(`Loaded ${samples.length} samples from ${inputPath}`);

// Count original distribution
const origCounts = {};
for (const s of samples) {
  origCounts[s.label] = (origCounts[s.label] || 0) + 1;
}
console.log('\nOriginal distribution:');
for (const [label, count] of Object.entries(origCounts).sort()) {
  console.log(`  ${label}: ${count}`);
}

// Drop STRUCTURAL samples and remove pre-extracted features (force Python re-extraction)
const filtered = samples
  .filter(s => s.label !== 'STRUCTURAL')
  .map(({ features, ...rest }) => rest);  // Strip pre-extracted features

// Validate distribution
const newCounts = {};
for (const s of filtered) {
  newCounts[s.label] = (newCounts[s.label] || 0) + 1;
}

console.log(`\n3-class distribution (${filtered.length} samples):`);
for (const [label, count] of Object.entries(newCounts).sort()) {
  console.log(`  ${label}: ${count}`);
}

// Validate expected counts
const expected = { HYBRID: 487, LEXICAL: 719, SEMANTIC: 1798 };
for (const [label, count] of Object.entries(expected)) {
  if (newCounts[label] !== count) {
    console.error(`\nERROR: Expected ${label}=${count}, got ${newCounts[label]}`);
    process.exit(1);
  }
}

// Write output
const output = { samples: filtered };
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\nWrote ${filtered.length} samples to ${outputPath}`);
console.log('Dropped: STRUCTURAL (724 samples)');
console.log('Removed: pre-extracted features (Python will re-extract all 50)');
