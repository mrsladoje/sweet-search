#!/usr/bin/env node
/**
 * Combine training data and extract features for CatBoost training.
 *
 * Includes: Original + Augmented (HYBRID) + Hard Negatives + Pure Native SEMANTIC
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures } from './features/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('═══════════════════════════════════════════════════════════════');
console.log('COMBINING TRAINING DATA (Final Push)');
console.log('═══════════════════════════════════════════════════════════════\n');

// Load original data
const originalPath = path.join(__dirname, 'output/llm_labeled_data.json');
const originalData = JSON.parse(fs.readFileSync(originalPath, 'utf-8'));
const original = (originalData.samples || originalData).map(s => ({
  query: s.query,
  label: s.originalLabel || s.label,
  subtype: s.subtype || 'original',
  weight: 1.0,
}));
console.log(`Original data: ${original.length} samples`);

// Load augmented data
const augmentedPath = path.join(__dirname, 'output/augmented_data.json');
const augmentedData = JSON.parse(fs.readFileSync(augmentedPath, 'utf-8'));
const augmented = augmentedData.queries.map(q => ({
  query: q.query,
  label: q.label,
  subtype: q.subtype,
  weight: 1.0,  // Standard weight for augmented
}));
console.log(`Augmented data: ${augmented.length} samples`);

// Load hard negatives
const hardNegPath = path.join(__dirname, 'output/hard_negatives.json');
const hardNegData = JSON.parse(fs.readFileSync(hardNegPath, 'utf-8'));
const hardNegatives = hardNegData.queries.map(q => ({
  query: q.query,
  label: q.label,
  subtype: q.subtype,
  weight: q.weight || 5.0,  // High weight for hard negatives
}));
console.log(`Hard negatives: ${hardNegatives.length} samples`);

// Load pure native semantic data (Final Push)
let pureNativeSemantic = [];
const pureNativePath = path.join(__dirname, 'output/pure_native_semantic.json');
if (fs.existsSync(pureNativePath)) {
  const pureNativeData = JSON.parse(fs.readFileSync(pureNativePath, 'utf-8'));
  pureNativeSemantic = pureNativeData.queries.map(q => ({
    query: q.query,
    label: q.label,
    subtype: q.subtype,
    weight: 2.0,  // Higher weight for pure native (counter HYBRID over-indexing)
    lang: q.lang,
  }));
  console.log(`Pure Native SEMANTIC: ${pureNativeSemantic.length} samples`);
} else {
  console.log('Pure Native SEMANTIC: Not found (run generators/pure-native-semantic.js first)');
}

// Load Intent Salad data (Final Push v5 - "[concept] in [Identifier]" = HYBRID)
let intentSalad = [];
const intentSaladPath = path.join(__dirname, 'output/intent_salad.json');
if (fs.existsSync(intentSaladPath)) {
  const intentSaladData = JSON.parse(fs.readFileSync(intentSaladPath, 'utf-8'));
  intentSalad = intentSaladData.queries.map(q => ({
    query: q.query,
    label: q.label,
    subtype: q.subtype,
    weight: 2.0,  // Higher weight to fix "[concept] in [Id]" → STRUCTURAL errors
  }));
  console.log(`Intent Salad HYBRID: ${intentSalad.length} samples`);
} else {
  console.log('Intent Salad: Not found (run generators/intent-salad.js first)');
}

// Load Relational Push data (Final Push v5 - passive STRUCTURAL patterns)
let relationalPush = [];
const relationalPushPath = path.join(__dirname, 'output/relational_push.json');
if (fs.existsSync(relationalPushPath)) {
  const relationalPushData = JSON.parse(fs.readFileSync(relationalPushPath, 'utf-8'));
  relationalPush = relationalPushData.queries.map(q => ({
    query: q.query,
    label: q.label,
    subtype: q.subtype,
    weight: 3.0,  // Higher weight for passive/complex STRUCTURAL patterns
  }));
  console.log(`Relational Push STRUCTURAL: ${relationalPush.length} samples`);
} else {
  console.log('Relational Push: Not found (run generators/relational-push.js first)');
}

// Combine all
const combined = [...original, ...augmented, ...hardNegatives, ...pureNativeSemantic, ...intentSalad, ...relationalPush];
console.log(`\nCombined total: ${combined.length} samples`);

// Show weight distribution
const weightDist = {};
for (const s of combined) {
  weightDist[s.weight] = (weightDist[s.weight] || 0) + 1;
}
console.log('Weight distribution:', weightDist);

// Show label distribution
const labelDist = {};
for (const s of combined) {
  labelDist[s.label] = (labelDist[s.label] || 0) + 1;
}
console.log('Label distribution:', labelDist);

// Extract features
console.log('\nExtracting 50 features per sample (including 7 Zen features)...');
const withFeatures = combined.map((s, i) => {
  if (i > 0 && i % 1000 === 0) {
    process.stdout.write(`  ${i}/${combined.length}\r`);
  }
  return {
    ...s,
    features: Array.from(extractAllFeatures(s.query)),
  };
});
console.log(`  ✓ Extracted features for ${withFeatures.length} samples`);

// Save
const outputPath = path.join(__dirname, 'output/combined_training_data.json');
const output = {
  name: 'Combined Training Data (v5 - Final Push)',
  description: 'Original + Augmented + Hard Negatives + Pure Native SEMANTIC + Intent Salad + Relational Push + 50 Features (including Non-Latin Identifier, ALL_CAPS detection)',
  generated: new Date().toISOString(),
  featureCount: 50,
  counts: {
    original: original.length,
    augmented: augmented.length,
    hardNegatives: hardNegatives.length,
    pureNativeSemantic: pureNativeSemantic.length,
    intentSalad: intentSalad.length,
    relationalPush: relationalPush.length,
    total: combined.length,
  },
  samples: withFeatures,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\n✓ Saved to ${outputPath}`);
console.log('═══════════════════════════════════════════════════════════════');
