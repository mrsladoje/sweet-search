#!/usr/bin/env node
/**
 * Download and bundle the local reranker model
 *
 * Uses Transformers.js to download a cross-encoder model for local reranking.
 * The model is cached in the models/gte-reranker-int8 directory for offline use.
 *
 * Usage: node scripts/download-model.mjs
 */

import { pipeline, env } from '@xenova/transformers';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_DIR = join(__dirname, '..');
const MODEL_DIR = join(SEARCH_DIR, 'models', 'gte-reranker-int8');

// Model options (in order of preference)
const MODEL_OPTIONS = [
  // High-quality cross-encoder models for reranking
  'Xenova/ms-marco-MiniLM-L-6-v2',      // Fast, good quality, ~90MB
  'Xenova/bge-reranker-base',            // Excellent quality, ~400MB
  'cross-encoder/ms-marco-MiniLM-L-6-v2', // Fallback
];

async function downloadModel() {
  console.log('=== Local Reranker Model Download ===\n');

  // Ensure model directory exists
  if (!existsSync(MODEL_DIR)) {
    mkdirSync(MODEL_DIR, { recursive: true });
  }

  // Configure Transformers.js to cache in our model directory
  env.cacheDir = MODEL_DIR;
  env.localModelPath = MODEL_DIR;

  let selectedModel = null;
  let classifier = null;

  for (const modelId of MODEL_OPTIONS) {
    console.log(`Attempting to load: ${modelId}...`);
    try {
      // Use text-classification pipeline for cross-encoder scoring
      classifier = await pipeline('text-classification', modelId, {
        quantized: true,  // Use INT8 quantized version if available
        progress_callback: (progress) => {
          if (progress.status === 'downloading') {
            const pct = ((progress.loaded / progress.total) * 100).toFixed(1);
            process.stdout.write(`\r  Downloading: ${pct}% (${(progress.loaded / 1024 / 1024).toFixed(1)}MB)`);
          }
        }
      });
      selectedModel = modelId;
      console.log(`\n✓ Successfully loaded: ${modelId}`);
      break;
    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
    }
  }

  if (!classifier) {
    console.error('\n❌ Failed to load any model. Check your internet connection.');
    process.exit(1);
  }

  // Test the model
  console.log('\nTesting model with sample reranking...');
  try {
    const testQuery = 'authentication service';
    const testDocs = [
      'AuthService handles user login and JWT tokens',
      'Database connection pool configuration',
      'User authentication module with OAuth support',
    ];

    const results = [];
    for (const doc of testDocs) {
      const input = `${testQuery} [SEP] ${doc}`;
      const output = await classifier(input);
      const score = output[0]?.label === 'LABEL_1' ? output[0].score : 1 - output[0].score;
      results.push({ doc: doc.slice(0, 40), score: score.toFixed(4) });
    }

    results.sort((a, b) => b.score - a.score);
    console.log('\nTest results (sorted by relevance):');
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.score}] ${r.doc}...`);
    });
    console.log('✓ Model test passed');
  } catch (err) {
    console.warn(`⚠ Model test failed: ${err.message}`);
  }

  // List cached files
  console.log('\n=== Cached Model Files ===');
  listDir(MODEL_DIR, '');

  // Calculate total size
  const totalSize = getDirSize(MODEL_DIR);
  console.log(`\nTotal model size: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);

  console.log('\n✓ Model download complete!');
  console.log(`\nModel location: ${MODEL_DIR}`);
  console.log(`Selected model: ${selectedModel}`);

  return { modelId: selectedModel, modelDir: MODEL_DIR, size: totalSize };
}

function listDir(dir, indent) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        console.log(`${indent}📁 ${entry}/`);
        listDir(fullPath, indent + '  ');
      } else {
        const size = (stat.size / 1024 / 1024).toFixed(1);
        console.log(`${indent}📄 ${entry} (${size}MB)`);
      }
    }
  } catch (err) {
    // Ignore errors
  }
}

function getDirSize(dir) {
  let size = 0;
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += stat.size;
      }
    }
  } catch (err) {
    // Ignore errors
  }
  return size;
}

// Run if called directly
downloadModel().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
