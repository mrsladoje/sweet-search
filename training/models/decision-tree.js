#!/usr/bin/env node

/**
 * Decision Tree Classifier for Query Router
 *
 * Pure JavaScript implementation for training and TypeScript export.
 * No Python dependencies required - runs entirely in Node.js.
 *
 * Features:
 * - ID3 algorithm with information gain
 * - Handles continuous and binary features
 * - Exports to optimized TypeScript if/else tree
 * - Target: <50μs inference
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures, getAllFeatureNames } from '../features/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Labels
const LABELS = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];
const LABEL_TO_INDEX = { LEXICAL: 0, SEMANTIC: 1, STRUCTURAL: 2, HYBRID: 3 };

/**
 * Calculate entropy of a label distribution.
 */
function entropy(counts, total) {
  if (total === 0) return 0;
  let ent = 0;
  for (const count of counts) {
    if (count > 0) {
      const p = count / total;
      ent -= p * Math.log2(p);
    }
  }
  return ent;
}

/**
 * Calculate information gain for a split.
 */
function informationGain(parentCounts, parentTotal, leftCounts, leftTotal, rightCounts, rightTotal) {
  const parentEntropy = entropy(parentCounts, parentTotal);
  const leftEntropy = entropy(leftCounts, leftTotal);
  const rightEntropy = entropy(rightCounts, rightTotal);

  const weightedChildEntropy =
    (leftTotal / parentTotal) * leftEntropy +
    (rightTotal / parentTotal) * rightEntropy;

  return parentEntropy - weightedChildEntropy;
}

/**
 * Find the best split for a dataset.
 */
function findBestSplit(X, y, featureNames) {
  const n = X.length;
  if (n === 0) return null;

  // Count label distribution
  const labelCounts = new Array(LABELS.length).fill(0);
  for (const label of y) {
    labelCounts[LABEL_TO_INDEX[label]]++;
  }

  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;

  const numFeatures = X[0].length;

  for (let f = 0; f < numFeatures; f++) {
    // Get unique values for this feature
    const values = [...new Set(X.map(row => row[f]))].sort((a, b) => a - b);

    // Try thresholds between adjacent values
    for (let i = 0; i < values.length - 1; i++) {
      const threshold = (values[i] + values[i + 1]) / 2;

      // Split data
      const leftCounts = new Array(LABELS.length).fill(0);
      const rightCounts = new Array(LABELS.length).fill(0);
      let leftTotal = 0, rightTotal = 0;

      for (let j = 0; j < n; j++) {
        if (X[j][f] <= threshold) {
          leftCounts[LABEL_TO_INDEX[y[j]]]++;
          leftTotal++;
        } else {
          rightCounts[LABEL_TO_INDEX[y[j]]]++;
          rightTotal++;
        }
      }

      // Skip if split is trivial
      if (leftTotal === 0 || rightTotal === 0) continue;

      // Calculate information gain
      const gain = informationGain(labelCounts, n, leftCounts, leftTotal, rightCounts, rightTotal);

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = threshold;
      }
    }
  }

  if (bestFeature === -1) return null;

  return {
    feature: bestFeature,
    featureName: featureNames[bestFeature],
    threshold: bestThreshold,
    gain: bestGain,
  };
}

/**
 * Decision Tree Node.
 */
class TreeNode {
  constructor() {
    this.isLeaf = false;
    this.label = null;
    this.confidence = 0;
    this.labelCounts = null;

    this.feature = -1;
    this.featureName = '';
    this.threshold = 0;
    this.left = null;   // <= threshold
    this.right = null;  // > threshold
  }
}

/**
 * Build a decision tree recursively.
 */
function buildTree(X, y, featureNames, maxDepth = 8, minSamples = 5, currentDepth = 0) {
  const node = new TreeNode();
  const n = X.length;

  // Count labels
  const labelCounts = new Array(LABELS.length).fill(0);
  for (const label of y) {
    labelCounts[LABEL_TO_INDEX[label]]++;
  }
  node.labelCounts = labelCounts;

  // Find majority label
  let maxCount = 0;
  let majorityLabel = LABELS[0];
  for (let i = 0; i < LABELS.length; i++) {
    if (labelCounts[i] > maxCount) {
      maxCount = labelCounts[i];
      majorityLabel = LABELS[i];
    }
  }

  // Check stopping conditions
  const pureNode = labelCounts.filter(c => c > 0).length === 1;

  if (pureNode || currentDepth >= maxDepth || n < minSamples) {
    node.isLeaf = true;
    node.label = majorityLabel;
    node.confidence = maxCount / n;
    return node;
  }

  // Find best split
  const split = findBestSplit(X, y, featureNames);

  if (!split || split.gain < 0.001) {
    node.isLeaf = true;
    node.label = majorityLabel;
    node.confidence = maxCount / n;
    return node;
  }

  // Split data
  const leftX = [], leftY = [];
  const rightX = [], rightY = [];

  for (let i = 0; i < n; i++) {
    if (X[i][split.feature] <= split.threshold) {
      leftX.push(X[i]);
      leftY.push(y[i]);
    } else {
      rightX.push(X[i]);
      rightY.push(y[i]);
    }
  }

  // Check if split is useful
  if (leftX.length === 0 || rightX.length === 0) {
    node.isLeaf = true;
    node.label = majorityLabel;
    node.confidence = maxCount / n;
    return node;
  }

  // Create split node
  node.feature = split.feature;
  node.featureName = split.featureName;
  node.threshold = split.threshold;
  node.left = buildTree(leftX, leftY, featureNames, maxDepth, minSamples, currentDepth + 1);
  node.right = buildTree(rightX, rightY, featureNames, maxDepth, minSamples, currentDepth + 1);

  return node;
}

/**
 * Predict label for a single sample.
 */
function predict(node, features) {
  if (node.isLeaf) {
    return {
      label: node.label,
      confidence: node.confidence,
      counts: node.labelCounts,
    };
  }

  if (features[node.feature] <= node.threshold) {
    return predict(node.left, features);
  } else {
    return predict(node.right, features);
  }
}

/**
 * Evaluate model accuracy.
 */
function evaluate(tree, X, y) {
  let correct = 0;
  const confusion = {};
  for (const label of LABELS) {
    confusion[label] = {};
    for (const pred of LABELS) {
      confusion[label][pred] = 0;
    }
  }

  for (let i = 0; i < X.length; i++) {
    const result = predict(tree, X[i]);
    confusion[y[i]][result.label]++;
    if (result.label === y[i]) {
      correct++;
    }
  }

  return {
    accuracy: correct / X.length,
    correct,
    total: X.length,
    confusion,
  };
}

/**
 * Export tree to TypeScript code.
 */
function exportToTypeScript(node, indent = 0) {
  const pad = '  '.repeat(indent);

  if (node.isLeaf) {
    const mode = node.label.toLowerCase();
    return `${pad}return { mode: '${mode}', confidence: ${node.confidence.toFixed(4)}, tier: 5, method: 'ml' };`;
  }

  const featureName = node.featureName;
  const threshold = node.threshold.toFixed(6);

  let code = `${pad}if (features[${node.feature}] /* ${featureName} */ <= ${threshold}) {\n`;
  code += exportToTypeScript(node.left, indent + 1) + '\n';
  code += `${pad}} else {\n`;
  code += exportToTypeScript(node.right, indent + 1) + '\n';
  code += `${pad}}`;

  return code;
}

/**
 * Generate full TypeScript module.
 */
function generateTypeScriptModule(tree, featureNames) {
  const treeCode = exportToTypeScript(tree, 1);

  return `/**
 * ML Query Router - Auto-generated from Decision Tree
 *
 * DO NOT EDIT - This file is auto-generated by train.js
 * Generated: ${new Date().toISOString()}
 *
 * Target: <50μs inference
 */

export interface MLRouteResult {
  mode: 'lexical' | 'semantic' | 'structural' | 'hybrid';
  confidence: number;
  tier: number;
  method: string;
}

/**
 * Feature indices for reference:
${featureNames.map((name, i) => ` * ${i.toString().padStart(2)}: ${name}`).join('\n')}
 */

/**
 * Route query using trained ML model.
 * @param features - 25-element feature vector from extractAllFeatures()
 * @returns Routing decision with confidence
 */
export function routeQueryML(features: Float32Array | number[]): MLRouteResult {
${treeCode}
}

export default routeQueryML;
`;
}

/**
 * Train model from training data file.
 */
async function trainFromFile(dataPath, outputPath, options = {}) {
  const { maxDepth = 10, minSamples = 3 } = options;

  console.log('\nLoading training data...');
  const rawData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const samples = rawData.samples || rawData.data || rawData;

  console.log(`  Loaded ${samples.length} samples`);

  // Extract features for all samples
  console.log('\nExtracting features...');
  const X = [];
  const y = [];
  const featureNames = getAllFeatureNames();

  for (const sample of samples) {
    const features = extractAllFeatures(sample.query);
    X.push(Array.from(features));
    y.push(sample.label);
  }

  console.log(`  Extracted ${featureNames.length} features for ${X.length} samples`);

  // Shuffle with fixed seed for reproducibility
  function shuffleWithSeed(arr, seed = 42) {
    const indices = arr.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = Math.floor((seed / 233280) * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.map(i => arr[i]);
  }

  // Create paired array and shuffle together
  const paired = X.map((x, i) => ({ x, y: y[i] }));
  const shuffled = shuffleWithSeed(paired);
  const shuffledX = shuffled.map(p => p.x);
  const shuffledY = shuffled.map(p => p.y);

  // Split into train/test (80/20)
  const splitIdx = Math.floor(shuffledX.length * 0.8);
  const trainX = shuffledX.slice(0, splitIdx);
  const trainY = shuffledY.slice(0, splitIdx);
  const testX = shuffledX.slice(splitIdx);
  const testY = shuffledY.slice(splitIdx);

  console.log(`  Train: ${trainX.length}, Test: ${testX.length}`);

  // Build tree
  console.log('\nTraining decision tree...');
  console.log(`  Max depth: ${maxDepth}, Min samples: ${minSamples}`);
  const startTrain = performance.now();
  const tree = buildTree(trainX, trainY, featureNames, maxDepth, minSamples);
  const trainTime = performance.now() - startTrain;
  console.log(`  Training time: ${trainTime.toFixed(2)}ms`);

  // Evaluate on training set
  console.log('\nTraining set evaluation:');
  const trainEval = evaluate(tree, trainX, trainY);
  console.log(`  Accuracy: ${(trainEval.accuracy * 100).toFixed(2)}% (${trainEval.correct}/${trainEval.total})`);

  // Evaluate on test set
  console.log('\nTest set evaluation:');
  const testEval = evaluate(tree, testX, testY);
  console.log(`  Accuracy: ${(testEval.accuracy * 100).toFixed(2)}% (${testEval.correct}/${testEval.total})`);

  // Per-class accuracy
  console.log('\nPer-class accuracy (test):');
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
    predict(tree, X[i % X.length]);
  }
  const inferTime = performance.now() - startInfer;
  const perQuery = (inferTime / iterations) * 1000; // microseconds
  console.log(`  ${iterations} predictions in ${inferTime.toFixed(2)}ms`);
  console.log(`  Average: ${perQuery.toFixed(2)}μs per query`);
  console.log(`  Target: <50μs`);
  if (perQuery < 50) {
    console.log('  ✓ Target met!');
  }

  // Export to TypeScript
  if (outputPath) {
    console.log(`\nExporting to TypeScript: ${outputPath}`);
    const tsCode = generateTypeScriptModule(tree, featureNames);
    fs.writeFileSync(outputPath, tsCode);
    console.log('  ✓ Exported!');
  }

  // Save model as JSON for debugging
  const modelPath = outputPath ? outputPath.replace('.ts', '.json') : 'model.json';
  fs.writeFileSync(modelPath, JSON.stringify({
    metadata: {
      trainedAt: new Date().toISOString(),
      samples: samples.length,
      trainAccuracy: trainEval.accuracy,
      testAccuracy: testEval.accuracy,
      inferenceLatency_us: perQuery,
      maxDepth,
      minSamples,
    },
    featureNames,
    // Note: Not serializing tree structure, only metadata
  }, null, 2));

  return {
    tree,
    trainAccuracy: trainEval.accuracy,
    testAccuracy: testEval.accuracy,
    inferenceLatency_us: perQuery,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Decision Tree Trainer

Usage:
  node decision-tree.js train --data <file> --output <file.ts>
  node decision-tree.js predict "<query>"

Options:
  --data <file>     Training data JSON file
  --output <file>   Output TypeScript file
  --max-depth <n>   Maximum tree depth (default: 10)
  --min-samples <n> Minimum samples per leaf (default: 3)

Examples:
  node decision-tree.js train --data ../output/training_data.json --output ../output/query_router_ml.ts
  node decision-tree.js predict "AuthService"
`);
    process.exit(0);
  }

  if (args[0] === 'train') {
    let dataPath = '';
    let outputPath = '';
    let maxDepth = 10;
    let minSamples = 3;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--data' && args[i + 1]) {
        dataPath = args[++i];
      } else if (args[i] === '--output' && args[i + 1]) {
        outputPath = args[++i];
      } else if (args[i] === '--max-depth' && args[i + 1]) {
        maxDepth = parseInt(args[++i], 10);
      } else if (args[i] === '--min-samples' && args[i + 1]) {
        minSamples = parseInt(args[++i], 10);
      }
    }

    if (!dataPath) {
      console.error('Error: --data is required');
      process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('SEARCH 100x ML Query Router Training');
    console.log('='.repeat(60));

    trainFromFile(dataPath, outputPath, { maxDepth, minSamples })
      .then(result => {
        console.log('\n' + '='.repeat(60));
        console.log('Training Complete!');
        console.log('='.repeat(60));
        console.log(`Train accuracy: ${(result.trainAccuracy * 100).toFixed(2)}%`);
        console.log(`Test accuracy:  ${(result.testAccuracy * 100).toFixed(2)}%`);
        console.log(`Inference:      ${result.inferenceLatency_us.toFixed(2)}μs`);
      })
      .catch(console.error);
  } else if (args[0] === 'predict') {
    const query = args.slice(1).join(' ');
    console.log(`Query: "${query}"`);

    const features = extractAllFeatures(query);
    console.log('\nFeatures:');
    const featureNames = getAllFeatureNames();
    for (let i = 0; i < features.length; i++) {
      if (features[i] !== 0) {
        console.log(`  ${featureNames[i]}: ${features[i].toFixed(4)}`);
      }
    }
  }
}

export {
  TreeNode,
  buildTree,
  predict,
  evaluate,
  exportToTypeScript,
  generateTypeScriptModule,
  trainFromFile,
  LABELS,
  LABEL_TO_INDEX,
};
