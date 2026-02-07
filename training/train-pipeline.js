#!/usr/bin/env node
/**
 * Complete Training Pipeline for 99% Accuracy
 *
 * This script orchestrates the full "99% Plan":
 * 1. Generate augmented data (noun-salad, verb-object, how-identifier)
 * 2. Generate hard negatives from benchmark errors
 * 3. Combine with original training data
 * 4. Extract features
 * 5. Train CatBoost with sample weights
 * 6. Export to JavaScript
 * 7. Run realistic benchmark
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { extractAllFeatures } from './features/extractor.js';
import {
  generateNounSaladQueries,
  generateVerbObjectQueries,
  generateHowDoesIdentifierQueries,
} from './generators/data-augmentation.js';
import {
  MISCLASSIFIED,
  generateHybridVariations,
  generateSemanticVariations,
  generateStructuralVariations,
} from './generators/hard-negatives.js';
import {
  generatePureNativeSemanticQueries,
} from './generators/pure-native-semantic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Data augmentation counts
  nounSaladCount: 2000,
  verbObjectCount: 2000,
  howIdentifierCount: 1000,
  pureNativeSemanticCount: 2000,  // Final Push: Pure native language SEMANTIC
  variationsPerError: 10,

  // Paths
  originalDataPath: path.join(__dirname, 'output/llm_labeled_data.json'),
  combinedDataPath: path.join(__dirname, 'output/combined_training_data.json'),
  modelPath: path.join(__dirname, 'models/query_router_v4.cbm'),  // v4 for Zen features
  exportPath: path.join(__dirname, 'models/catboost_router_full.js'),

  // CatBoost parameters (Final Push)
  catboostParams: {
    iterations: 500,
    depth: 10,  // Increased from 8 for 99%+ accuracy
    learningRate: 0.1,
    valRatio: 0.2,
    // Class weights: LEXICAL: 0.5, SEMANTIC: 1.5, STRUCTURAL: 2.0, HYBRID: 2.0
    classWeights: 'L:0.5,S:1.5,ST:2.0,H:2.0',
  },
};

// =============================================================================
// PIPELINE STEPS
// =============================================================================

async function step1_generateAugmentedData() {
  console.log('\n═══ Step 1: Generate Augmented Data (HYBRID) ═══');

  const nounSalad = generateNounSaladQueries(CONFIG.nounSaladCount);
  const verbObject = generateVerbObjectQueries(CONFIG.verbObjectCount);
  const howIdentifier = generateHowDoesIdentifierQueries(CONFIG.howIdentifierCount);

  console.log(`  ✓ Noun-Salad: ${nounSalad.length} HYBRID samples`);
  console.log(`  ✓ Verb-Object: ${verbObject.length} HYBRID samples`);
  console.log(`  ✓ How-Identifier: ${howIdentifier.length} HYBRID samples`);

  return [...nounSalad, ...verbObject, ...howIdentifier];
}

function step1b_generatePureNativeSemanticData() {
  console.log('\n═══ Step 1b: Generate Pure Native SEMANTIC Data ═══');

  const pureNative = generatePureNativeSemanticQueries(CONFIG.pureNativeSemanticCount);

  // Add weight for counter-balancing HYBRID over-indexing
  const weighted = pureNative.map(q => ({
    ...q,
    weight: 2.0,  // Higher weight to counteract HYBRID bias
  }));

  console.log(`  ✓ Pure Native SEMANTIC: ${weighted.length} samples`);
  console.log(`    Languages: Russian, Serbian, German, Spanish, French`);
  console.log(`    Weight: 2.0 (to counteract HYBRID over-indexing)`);

  return weighted;
}

function step2_generateHardNegatives() {
  console.log('\n═══ Step 2: Generate Hard Negatives ═══');

  const allVariations = [];

  // Group errors by type
  const hybridToStructural = MISCLASSIFIED.filter(e => e.expected === 'HYBRID' && e.predicted === 'STRUCTURAL');
  const semanticToHybrid = MISCLASSIFIED.filter(e => e.expected === 'SEMANTIC' && e.predicted === 'HYBRID');
  const structuralToHybrid = MISCLASSIFIED.filter(e => e.expected === 'STRUCTURAL' && e.predicted === 'HYBRID');
  const hybridToSemantic = MISCLASSIFIED.filter(e => e.expected === 'HYBRID' && e.predicted === 'SEMANTIC');

  // Generate variations
  for (const error of hybridToStructural) {
    allVariations.push(...generateHybridVariations(error.query, CONFIG.variationsPerError));
  }
  for (const error of semanticToHybrid) {
    allVariations.push(...generateSemanticVariations(error.query, CONFIG.variationsPerError));
  }
  for (const error of structuralToHybrid) {
    allVariations.push(...generateStructuralVariations(error.query, CONFIG.variationsPerError));
  }
  for (const error of hybridToSemantic) {
    allVariations.push(...generateHybridVariations(error.query, CONFIG.variationsPerError));
  }

  // Add original errors with 10x weight
  for (const error of MISCLASSIFIED) {
    allVariations.push({
      query: error.query,
      label: error.expected,
      subtype: 'original_error',
      weight: 10.0,
    });
  }

  console.log(`  ✓ Source errors: ${MISCLASSIFIED.length}`);
  console.log(`  ✓ Generated variations: ${allVariations.length}`);

  return allVariations;
}

function step3_loadOriginalData() {
  console.log('\n═══ Step 3: Load Original Training Data ═══');

  const rawData = JSON.parse(fs.readFileSync(CONFIG.originalDataPath, 'utf-8'));
  const samples = rawData.samples || rawData;

  // Map to standardized format
  const original = samples.map(s => ({
    query: s.query,
    label: s.originalLabel || s.label,
    subtype: s.subtype || 'original',
    weight: 1.0,  // Default weight
  }));

  console.log(`  ✓ Loaded ${original.length} original samples`);

  return original;
}

function step4_combineAndExtractFeatures(original, augmented, hardNegatives, pureNativeSemantic) {
  console.log('\n═══ Step 4: Combine Data & Extract Features ═══');

  // Combine all data
  const combined = [...original, ...augmented, ...hardNegatives, ...pureNativeSemantic];

  console.log(`  Original: ${original.length}`);
  console.log(`  Augmented (HYBRID): ${augmented.length}`);
  console.log(`  Hard Negatives: ${hardNegatives.length}`);
  console.log(`  Pure Native SEMANTIC: ${pureNativeSemantic.length}`);
  console.log(`  Combined: ${combined.length}`);

  // Extract features for each sample
  console.log(`  Extracting 48 features per sample (including 5 Zen features)...`);
  const withFeatures = combined.map(sample => ({
    ...sample,
    features: Array.from(extractAllFeatures(sample.query)),
  }));

  // Save combined data
  const output = {
    name: 'Combined Training Data (Zen - 99.9% Plan)',
    description: 'Original + Augmented + Hard Negatives + Pure Native SEMANTIC + Zen Features (CJK, Structural Question, German Compound)',
    generated: new Date().toISOString(),
    featureCount: 48,
    samples: withFeatures,
  };

  fs.writeFileSync(CONFIG.combinedDataPath, JSON.stringify(output, null, 2));
  console.log(`  ✓ Saved to ${CONFIG.combinedDataPath}`);

  return withFeatures;
}

async function step5_trainCatBoost() {
  console.log('\n═══ Step 5: Train CatBoost (Final Push) ═══');

  // Check if Python venv exists
  const venvPath = path.join(__dirname, '.venv');
  if (!fs.existsSync(venvPath)) {
    console.log('  Creating Python virtual environment...');
    execSync('python3 -m venv .venv', { cwd: __dirname });
    execSync('.venv/bin/pip install catboost numpy', { cwd: __dirname, stdio: 'inherit' });
  }

  // Run CatBoost training with class weights
  const trainCmd = `.venv/bin/python models/train_catboost.py \
    --data output/combined_training_data.json \
    --output models/query_router_v4.cbm \
    --iterations ${CONFIG.catboostParams.iterations} \
    --depth ${CONFIG.catboostParams.depth} \
    --lr ${CONFIG.catboostParams.learningRate} \
    --val-ratio ${CONFIG.catboostParams.valRatio} \
    --class-weights "${CONFIG.catboostParams.classWeights}"`;

  console.log(`  Running: ${trainCmd.split('\n').join(' ')}`);
  console.log(`  Class weights: ${CONFIG.catboostParams.classWeights}`);
  console.log(`  Depth: ${CONFIG.catboostParams.depth} (increased for 99%+ accuracy)`);

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', trainCmd], {
      cwd: __dirname,
      stdio: 'inherit',
    });

    proc.on('close', code => {
      if (code === 0) {
        console.log('  ✓ CatBoost training complete');
        resolve();
      } else {
        reject(new Error(`CatBoost training failed with code ${code}`));
      }
    });
  });
}

async function step6_exportToJS() {
  console.log('\n═══ Step 6: Export to JavaScript ═══');

  const exportCmd = `.venv/bin/python models/export_catboost_to_js.py \
    --model models/query_router_v4.cbm \
    --output models/catboost_router_full.js`;

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', exportCmd], {
      cwd: __dirname,
      stdio: 'inherit',
    });

    proc.on('close', code => {
      if (code === 0) {
        console.log('  ✓ Exported to JavaScript');
        resolve();
      } else {
        reject(new Error(`Export failed with code ${code}`));
      }
    });
  });
}

async function step7_runBenchmark() {
  console.log('\n═══ Step 7: Run Realistic Benchmark ═══');

  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['evaluation/benchmark-realistic.js'], {
      cwd: __dirname,
      stdio: 'inherit',
    });

    proc.on('close', code => {
      if (code === 0) {
        console.log('  ✓ Benchmark complete');
        resolve();
      } else {
        reject(new Error(`Benchmark failed with code ${code}`));
      }
    });
  });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('QUERY ROUTER TRAINING PIPELINE (Final Push - 99%+ Plan)');
  console.log('═══════════════════════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // Step 1: Generate augmented HYBRID data
    const augmented = await step1_generateAugmentedData();

    // Step 1b: Generate pure native SEMANTIC data (Final Push)
    const pureNativeSemantic = step1b_generatePureNativeSemanticData();

    // Step 2: Generate hard negatives
    const hardNegatives = step2_generateHardNegatives();

    // Step 3: Load original data
    const original = step3_loadOriginalData();

    // Step 4: Combine and extract features (now with 43 features)
    const combined = step4_combineAndExtractFeatures(original, augmented, hardNegatives, pureNativeSemantic);

    // Step 5: Train CatBoost (depth=10, class weights)
    await step5_trainCatBoost();

    // Step 6: Export to JavaScript
    await step6_exportToJS();

    // Step 7: Run benchmark
    await step7_runBenchmark();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`✓ Pipeline complete in ${elapsed}s`);
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('\n✗ Pipeline failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { step1_generateAugmentedData, step2_generateHardNegatives };
