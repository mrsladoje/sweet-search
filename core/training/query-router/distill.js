#!/usr/bin/env node
/**
 * Distillation Orchestrator
 *
 * SOTA Pipeline (2025):
 * 1. Load template-generated queries (labeled by rules)
 * 2. Re-label with Multi-LLM Ensemble (GLM 4.6 + Claude Haiku 4.5)
 * 3. Train CatBoost on LLM-labeled data
 * 4. Export model for production inference
 *
 * Why distillation?
 * - Templates are rule-based → biased toward simple patterns
 * - LLMs understand semantic nuance → better generalization
 * - CatBoost is 30-60x faster than LLM inference
 *
 * Usage:
 *   node distill.js --input output/comprehensive_training_data.json
 *   node distill.js --input output/training_data.json --sample 500
 *   node distill.js --skip-labeling  # Use existing labeled data
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { extractAllFeatures } from './features/extractor.js';
import { labelQueriesBatchEnsemble } from './reviewers/ensemble-labeler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Input/Output paths
  defaultInput: path.join(__dirname, 'output', 'comprehensive_training_data.json'),
  labeledOutput: path.join(__dirname, 'output', 'llm_labeled_data.json'),
  catboostModel: path.join(__dirname, 'models', 'query_router.cbm'),

  // Labeling settings
  batchSize: 10,          // Queries per batch (parallel LLM calls)
  sampleSize: null,       // null = all, or limit for testing
  minConfidence: 0.6,     // Skip low-confidence labels

  // CatBoost training settings
  iterations: 300,
  depth: 6,
  learningRate: 0.1,
  valRatio: 0.2,
};

// =============================================================================
// HELPERS
// =============================================================================

function loadJsonFile(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8');
  const data = JSON.parse(content);

  // Handle both formats: {data: [...]} or {samples: [...]} or [...]
  if (data.data) return data.data;
  if (data.samples) return data.samples;
  return data;
}

function saveJsonFile(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`✓ Saved ${filepath}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runPythonTrainer(dataPath, outputPath) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'models', 'train_catboost.py');
    const venvPython = path.join(__dirname, '.venv', 'bin', 'python');

    console.log(`\n📊 Training CatBoost model...`);
    console.log(`   Input: ${dataPath}`);
    console.log(`   Output: ${outputPath}`);

    const proc = spawn(venvPython, [
      pythonScript,
      '--data', dataPath,
      '--output', outputPath,
      '--iterations', String(CONFIG.iterations),
      '--depth', String(CONFIG.depth),
      '--lr', String(CONFIG.learningRate),
      '--val-ratio', String(CONFIG.valRatio),
    ], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // Show progress (filter verbose CatBoost output)
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.includes('Accuracy') || line.includes('features') ||
            line.includes('complete') || line.includes('saved')) {
          console.log('   ' + line);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Python trainer exited with code ${code}\n${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

async function runDistillation(options = {}) {
  const {
    inputPath = CONFIG.defaultInput,
    sampleSize = CONFIG.sampleSize,
    skipLabeling = false,
    dryRun = false,
  } = options;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 DISTILLATION PIPELINE - SOTA 2025');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Multi-LLM Ensemble: GLM 4.6 + Claude Haiku 4.5 (MRRV voting)`);
  console.log(`  Student Model: CatBoost (30-60x faster than LLM)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ───────────────────────────────────────────────────────────────────────────
  // Step 1: Load input data
  // ───────────────────────────────────────────────────────────────────────────
  console.log('📂 Step 1: Loading input data...');

  let samples;
  if (skipLabeling) {
    // Use existing LLM-labeled data
    if (!fs.existsSync(CONFIG.labeledOutput)) {
      throw new Error(`Labeled data not found: ${CONFIG.labeledOutput}`);
    }
    samples = loadJsonFile(CONFIG.labeledOutput);
    console.log(`   Loaded ${samples.length} pre-labeled samples`);
  } else {
    // Load template-generated data
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    samples = loadJsonFile(inputPath);
    console.log(`   Loaded ${samples.length} samples from ${path.basename(inputPath)}`);

    // Sample if requested
    if (sampleSize && sampleSize < samples.length) {
      // Stratified sampling by original label
      const byLabel = {};
      for (const s of samples) {
        const lbl = s.label || 'UNKNOWN';
        (byLabel[lbl] = byLabel[lbl] || []).push(s);
      }

      const perLabel = Math.ceil(sampleSize / Object.keys(byLabel).length);
      samples = [];
      for (const [label, items] of Object.entries(byLabel)) {
        // Shuffle and take perLabel samples
        const shuffled = items.sort(() => Math.random() - 0.5);
        samples.push(...shuffled.slice(0, perLabel));
      }
      samples = samples.slice(0, sampleSize);
      console.log(`   Sampled ${samples.length} queries (stratified)`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 2: Label with Multi-LLM Ensemble
  // ───────────────────────────────────────────────────────────────────────────
  let labeledData;

  if (skipLabeling) {
    labeledData = samples;
    console.log('\n⏭️  Step 2: Skipping labeling (using existing labels)');
  } else {
    console.log('\n🤖 Step 2: Labeling with Multi-LLM Ensemble (MRRV)...');
    console.log(`   Batch size: ${CONFIG.batchSize}`);
    console.log(`   Total queries: ${samples.length}`);

    if (dryRun) {
      console.log('   [DRY RUN] Would label queries here');
      labeledData = samples.map(s => ({ ...s, llmLabel: s.label, confidence: 0.9 }));
    } else {
      // Extract queries
      const queries = samples.map(s => s.query);

      // Process in batches
      const startTime = Date.now();
      labeledData = [];
      let processedCount = 0;
      let agreementSum = 0;
      let confidenceSum = 0;

      for (let i = 0; i < queries.length; i += CONFIG.batchSize) {
        const batch = queries.slice(i, i + CONFIG.batchSize);
        const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
        const totalBatches = Math.ceil(queries.length / CONFIG.batchSize);

        process.stdout.write(`\r   Batch ${batchNum}/${totalBatches} (${processedCount}/${queries.length})...`);

        try {
          const results = await labelQueriesBatchEnsemble(batch);

          for (let j = 0; j < batch.length; j++) {
            const original = samples[i + j];
            const result = results[j];

            labeledData.push({
              query: original.query,
              originalLabel: original.label,
              label: result.label,  // LLM label (for training)
              confidence: result.confidence,
              crossModelAgreement: result.crossModelAgreement,
              tier: result.tier,
              subtype: original.subtype,
              language: original.language,
            });

            agreementSum += result.crossModelAgreement || 0;
            confidenceSum += result.confidence || 0;
          }

          processedCount += batch.length;

          // Rate limiting
          if (i + CONFIG.batchSize < queries.length) {
            await sleep(100); // Small delay between batches
          }
        } catch (err) {
          console.error(`\n   ⚠️  Batch ${batchNum} failed: ${err.message}`);
          // Use original labels as fallback
          for (let j = 0; j < batch.length; j++) {
            const original = samples[i + j];
            labeledData.push({
              query: original.query,
              originalLabel: original.label,
              label: original.label,  // Fallback to template label
              confidence: 0.5,
              crossModelAgreement: 0,
              tier: 'fallback',
              subtype: original.subtype,
              language: original.language,
            });
          }
          processedCount += batch.length;
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const avgAgreement = (agreementSum / labeledData.length * 100).toFixed(1);
      const avgConfidence = (confidenceSum / labeledData.length * 100).toFixed(1);

      console.log(`\n   ✓ Labeled ${labeledData.length} queries in ${elapsed}s`);
      console.log(`   ✓ Avg cross-model agreement: ${avgAgreement}%`);
      console.log(`   ✓ Avg confidence: ${avgConfidence}%`);

      // Show label changes
      let changed = 0;
      for (const d of labeledData) {
        if (d.label !== d.originalLabel) changed++;
      }
      console.log(`   ✓ Labels changed: ${changed} (${(changed/labeledData.length*100).toFixed(1)}%)`);

      // Save labeled data
      saveJsonFile(CONFIG.labeledOutput, {
        metadata: {
          generatedAt: new Date().toISOString(),
          totalSamples: labeledData.length,
          avgConfidence,
          avgAgreement,
          labelsChanged: changed,
        },
        samples: labeledData,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3: Filter low-confidence samples
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n🔍 Step 3: Filtering low-confidence samples...');

  const highConfidence = labeledData.filter(d =>
    d.confidence >= CONFIG.minConfidence || d.tier === 'fallback'
  );

  console.log(`   Kept: ${highConfidence.length}/${labeledData.length} samples`);
  console.log(`   (min confidence threshold: ${CONFIG.minConfidence})`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 4: Extract features for CatBoost
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n⚙️  Step 4: Extracting features...');

  const trainingData = [];
  for (const sample of highConfidence) {
    try {
      const features = extractAllFeatures(sample.query);
      trainingData.push({
        query: sample.query,
        label: sample.label,
        features: Object.values(features),
      });
    } catch (err) {
      console.warn(`   ⚠️  Failed to extract features for: "${sample.query}"`);
    }
  }

  console.log(`   ✓ Extracted features for ${trainingData.length} samples`);

  // Save training data for Python
  const catboostInput = path.join(__dirname, 'output', 'catboost_training_data.json');
  saveJsonFile(catboostInput, { samples: trainingData });

  // ───────────────────────────────────────────────────────────────────────────
  // Step 5: Train CatBoost
  // ───────────────────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log('\n📊 Step 5: [DRY RUN] Would train CatBoost here');
  } else {
    try {
      await runPythonTrainer(catboostInput, CONFIG.catboostModel);
      console.log(`   ✓ Model saved to ${CONFIG.catboostModel}`);
    } catch (err) {
      console.error('   ✗ CatBoost training failed:', err.message);
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 6: Summary
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🎉 DISTILLATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Input queries: ${samples.length}`);
  console.log(`  Training samples: ${trainingData.length}`);
  console.log(`  Model: ${CONFIG.catboostModel}`);
  console.log('\nTo use the model in sweet-search:');
  console.log(`  const catboost = require('catboost');`);
  console.log(`  const model = new catboost.Model('${CONFIG.catboostModel}');`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  return {
    inputCount: samples.length,
    labeledCount: labeledData.length,
    trainingCount: trainingData.length,
    modelPath: CONFIG.catboostModel,
  };
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  const options = {
    inputPath: CONFIG.defaultInput,
    sampleSize: null,
    skipLabeling: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      options.inputPath = path.resolve(args[++i]);
    } else if (args[i] === '--sample' && args[i + 1]) {
      options.sampleSize = parseInt(args[++i], 10);
    } else if (args[i] === '--skip-labeling') {
      options.skipLabeling = true;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Distillation Pipeline - Train CatBoost from Multi-LLM labeled data

Usage:
  node distill.js [options]

Options:
  --input <file>    Input JSON file with template-generated queries
  --sample <n>      Limit to N samples (for testing)
  --skip-labeling   Use existing LLM-labeled data (skip ensemble step)
  --dry-run         Run without actual LLM calls or training
  --help, -h        Show this help

Examples:
  node distill.js                                    # Full pipeline
  node distill.js --sample 100                       # Quick test with 100 samples
  node distill.js --skip-labeling                    # Retrain using existing labels
  node distill.js --input output/multilingual_5k.json --sample 500
`);
      process.exit(0);
    }
  }

  try {
    await runDistillation(options);
  } catch (err) {
    console.error('\n✗ Distillation failed:', err.message);
    process.exit(1);
  }
}

// Run if main
main();
