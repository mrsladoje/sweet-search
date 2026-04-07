#!/usr/bin/env node

/**
 * Gradient Boosting Classifier for Query Router (SOTA 2025)
 *
 * Pure JavaScript implementation of gradient boosting with symmetric trees.
 * Inspired by CatBoost's symmetric tree approach for fast inference.
 *
 * Features:
 * - Symmetric decision trees (same split at each level)
 * - Softmax gradient boosting for multi-class
 * - Histogram-based split finding (fast)
 * - Exports to optimized JavaScript if/else tree
 * - Target: <5μs inference
 *
 * Why symmetric trees?
 * - All leaves at same depth → predictable memory access
 * - Same feature split at each level → fewer branches
 * - Easy to export to branchless code
 * - 30-60x faster than asymmetric XGBoost trees
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAllFeatures, getAllFeatureNames } from '../features/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CONFIGURATION
// =============================================================================

const LABELS = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];
const NUM_CLASSES = LABELS.length;
const LABEL_TO_INDEX = Object.fromEntries(LABELS.map((l, i) => [l, i]));

const DEFAULT_CONFIG = {
  // Number of boosting rounds (trees per class)
  numRounds: 30,

  // Tree depth (symmetric trees have 2^depth leaves)
  maxDepth: 4,

  // Learning rate (shrinkage)
  learningRate: 0.1,

  // Minimum samples in a leaf
  minSamplesLeaf: 5,

  // L2 regularization on leaf values
  lambda: 1.0,

  // Subsampling ratio (bagging)
  subsampleRatio: 0.8,

  // Feature subsampling ratio
  featureSubsampleRatio: 0.8,

  // Number of histogram bins for continuous features
  numBins: 64,

  // Early stopping patience (0 = disabled)
  earlyStoppingRounds: 5,

  // Validation split ratio
  validationRatio: 0.2,
};

// =============================================================================
// SOFTMAX & GRADIENT UTILITIES
// =============================================================================

/**
 * Softmax function for multi-class probabilities
 */
function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exp = logits.map((l) => Math.exp(l - maxLogit));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}

/**
 * Cross-entropy loss for multi-class
 */
function crossEntropyLoss(probs, labels) {
  let loss = 0;
  for (let i = 0; i < labels.length; i++) {
    const trueClass = labels[i];
    loss -= Math.log(Math.max(probs[i][trueClass], 1e-10));
  }
  return loss / labels.length;
}

/**
 * Compute gradients for softmax cross-entropy
 * Gradient: p_k - y_k (where y_k is 1 for true class, 0 otherwise)
 */
function computeGradients(probs, labels) {
  const n = labels.length;
  const gradients = Array(n)
    .fill(null)
    .map(() => Array(NUM_CLASSES).fill(0));

  for (let i = 0; i < n; i++) {
    for (let k = 0; k < NUM_CLASSES; k++) {
      gradients[i][k] = probs[i][k] - (labels[i] === k ? 1 : 0);
    }
  }

  return gradients;
}

/**
 * Compute Hessians for softmax (p_k * (1 - p_k))
 */
function computeHessians(probs) {
  const n = probs.length;
  const hessians = Array(n)
    .fill(null)
    .map(() => Array(NUM_CLASSES).fill(0));

  for (let i = 0; i < n; i++) {
    for (let k = 0; k < NUM_CLASSES; k++) {
      hessians[i][k] = Math.max(probs[i][k] * (1 - probs[i][k]), 1e-6);
    }
  }

  return hessians;
}

// =============================================================================
// SYMMETRIC TREE
// =============================================================================

/**
 * Symmetric Decision Tree
 *
 * All nodes at the same depth use the same feature and threshold.
 * This makes the tree structure very regular and fast to evaluate.
 */
class SymmetricTree {
  constructor(depth) {
    this.depth = depth;
    this.numLeaves = 1 << depth; // 2^depth

    // Each level stores: { featureIndex, threshold }
    this.splits = Array(depth).fill(null);

    // Leaf values (one per leaf)
    this.leafValues = Array(this.numLeaves).fill(0);
  }

  /**
   * Get leaf index for a sample
   */
  getLeafIndex(features) {
    let idx = 0;
    for (let d = 0; d < this.depth; d++) {
      const split = this.splits[d];
      if (split && features[split.featureIndex] > split.threshold) {
        idx |= 1 << (this.depth - 1 - d);
      }
    }
    return idx;
  }

  /**
   * Predict value for a sample
   */
  predict(features) {
    return this.leafValues[this.getLeafIndex(features)];
  }

  /**
   * Predict values for multiple samples
   */
  predictBatch(X) {
    return X.map((features) => this.predict(features));
  }
}

// =============================================================================
// HISTOGRAM-BASED SPLIT FINDING
// =============================================================================

/**
 * Build histograms for gradient statistics
 */
function buildHistograms(X, gradients, hessians, indices, numBins, featureThresholds) {
  const numFeatures = X[0].length;
  const histograms = [];

  for (let f = 0; f < numFeatures; f++) {
    const thresholds = featureThresholds[f];
    const bins = thresholds.length;

    // Initialize histogram bins
    const gradHist = Array(bins).fill(0);
    const hessHist = Array(bins).fill(0);
    const countHist = Array(bins).fill(0);

    // Accumulate statistics
    for (const i of indices) {
      const value = X[i][f];
      // Find bin index
      let binIdx = 0;
      while (binIdx < bins - 1 && value > thresholds[binIdx]) {
        binIdx++;
      }

      gradHist[binIdx] += gradients[i];
      hessHist[binIdx] += hessians[i];
      countHist[binIdx]++;
    }

    histograms.push({ gradHist, hessHist, countHist, thresholds });
  }

  return histograms;
}

/**
 * Find best split using histograms
 */
function findBestSplit(histograms, totalGrad, totalHess, totalCount, lambda, minSamplesLeaf) {
  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;

  const numFeatures = histograms.length;

  for (let f = 0; f < numFeatures; f++) {
    const { gradHist, hessHist, countHist, thresholds } = histograms[f];

    let leftGrad = 0;
    let leftHess = 0;
    let leftCount = 0;

    for (let b = 0; b < thresholds.length - 1; b++) {
      leftGrad += gradHist[b];
      leftHess += hessHist[b];
      leftCount += countHist[b];

      const rightGrad = totalGrad - leftGrad;
      const rightHess = totalHess - leftHess;
      const rightCount = totalCount - leftCount;

      // Skip if leaf would be too small
      if (leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) {
        continue;
      }

      // Calculate gain (XGBoost-style)
      const gain =
        0.5 *
        ((leftGrad * leftGrad) / (leftHess + lambda) +
          (rightGrad * rightGrad) / (rightHess + lambda) -
          (totalGrad * totalGrad) / (totalHess + lambda));

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = thresholds[b];
      }
    }
  }

  return { gain: bestGain, featureIndex: bestFeature, threshold: bestThreshold };
}

/**
 * Compute feature thresholds for histogram binning
 */
function computeFeatureThresholds(X, numBins) {
  const numFeatures = X[0].length;
  const thresholds = [];

  for (let f = 0; f < numFeatures; f++) {
    const values = [...new Set(X.map((row) => row[f]))].sort((a, b) => a - b);

    if (values.length <= numBins) {
      // Use all unique values as thresholds
      thresholds.push(values);
    } else {
      // Use quantile-based binning
      const step = Math.ceil(values.length / numBins);
      const binThresholds = [];
      for (let i = step; i < values.length; i += step) {
        binThresholds.push(values[i]);
      }
      thresholds.push(binThresholds);
    }
  }

  return thresholds;
}

// =============================================================================
// GRADIENT BOOSTING CLASSIFIER
// =============================================================================

export class GradientBoostingClassifier {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trees = []; // trees[round][class]
    this.featureThresholds = null;
    this.featureNames = null;
    this.trainHistory = [];
  }

  /**
   * Train the classifier
   */
  fit(X, y, featureNames = null) {
    const n = X.length;
    const numFeatures = X[0].length;

    this.featureNames = featureNames || Array.from({ length: numFeatures }, (_, i) => `f${i}`);

    // Convert labels to indices
    const labels = y.map((label) => LABEL_TO_INDEX[label]);

    // Split into train/validation
    const validationSize = Math.floor(n * this.config.validationRatio);
    const indices = Array.from({ length: n }, (_, i) => i);

    // Shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const valIndices = indices.slice(0, validationSize);
    const trainIndices = indices.slice(validationSize);

    const X_train = trainIndices.map((i) => X[i]);
    const y_train = trainIndices.map((i) => labels[i]);
    const X_val = valIndices.map((i) => X[i]);
    const y_val = valIndices.map((i) => labels[i]);

    // Compute feature thresholds
    this.featureThresholds = computeFeatureThresholds(X_train, this.config.numBins);

    // Initialize predictions (log-odds)
    let trainPreds = X_train.map(() => Array(NUM_CLASSES).fill(0));
    let valPreds = X_val.map(() => Array(NUM_CLASSES).fill(0));

    let bestValLoss = Infinity;
    let roundsWithoutImprovement = 0;

    // Boosting rounds
    for (let round = 0; round < this.config.numRounds; round++) {
      // Compute probabilities
      const trainProbs = trainPreds.map(softmax);
      const valProbs = valPreds.map(softmax);

      // Compute loss
      const trainLoss = crossEntropyLoss(trainProbs, y_train);
      const valLoss = crossEntropyLoss(valProbs, y_val);

      this.trainHistory.push({ round, trainLoss, valLoss });

      // Early stopping
      if (valLoss < bestValLoss) {
        bestValLoss = valLoss;
        roundsWithoutImprovement = 0;
      } else {
        roundsWithoutImprovement++;
        if (
          this.config.earlyStoppingRounds > 0 &&
          roundsWithoutImprovement >= this.config.earlyStoppingRounds
        ) {
          console.log(`Early stopping at round ${round} (val loss: ${valLoss.toFixed(4)})`);
          break;
        }
      }

      // Compute gradients
      const gradients = computeGradients(trainProbs, y_train);
      const hessians = computeHessians(trainProbs);

      // Subsample training data
      let sampleIndices = Array.from({ length: X_train.length }, (_, i) => i);
      if (this.config.subsampleRatio < 1) {
        const sampleSize = Math.floor(X_train.length * this.config.subsampleRatio);
        sampleIndices = sampleIndices
          .sort(() => Math.random() - 0.5)
          .slice(0, sampleSize);
      }

      // Train one tree per class
      const roundTrees = [];

      for (let k = 0; k < NUM_CLASSES; k++) {
        const tree = this.trainTree(
          X_train,
          gradients.map((g) => g[k]),
          hessians.map((h) => h[k]),
          sampleIndices
        );
        roundTrees.push(tree);

        // Update predictions
        for (let i = 0; i < X_train.length; i++) {
          trainPreds[i][k] += this.config.learningRate * tree.predict(X_train[i]);
        }
        for (let i = 0; i < X_val.length; i++) {
          valPreds[i][k] += this.config.learningRate * tree.predict(X_val[i]);
        }
      }

      this.trees.push(roundTrees);

      if (round % 5 === 0 || round === this.config.numRounds - 1) {
        console.log(
          `Round ${round}: train_loss=${trainLoss.toFixed(4)}, val_loss=${valLoss.toFixed(4)}`
        );
      }
    }

    // Compute final accuracy
    const trainAcc = this.computeAccuracy(X_train, y_train);
    const valAcc = this.computeAccuracy(X_val, y_val);

    console.log(`\nFinal: train_acc=${(trainAcc * 100).toFixed(2)}%, val_acc=${(valAcc * 100).toFixed(2)}%`);

    return { trainAcc, valAcc, numRounds: this.trees.length };
  }

  /**
   * Train a single symmetric tree
   */
  trainTree(X, gradients, hessians, sampleIndices) {
    const tree = new SymmetricTree(this.config.maxDepth);

    // Build tree level by level
    let nodeIndices = [sampleIndices]; // Indices in each node

    for (let depth = 0; depth < this.config.maxDepth; depth++) {
      // Aggregate statistics across all nodes at this level
      let totalGrad = 0;
      let totalHess = 0;
      let totalCount = 0;

      const allIndices = nodeIndices.flat();
      for (const i of allIndices) {
        totalGrad += gradients[i];
        totalHess += hessians[i];
        totalCount++;
      }

      // Build histograms
      const histograms = buildHistograms(
        X,
        gradients,
        hessians,
        allIndices,
        this.config.numBins,
        this.featureThresholds
      );

      // Find best split
      const split = findBestSplit(
        histograms,
        totalGrad,
        totalHess,
        totalCount,
        this.config.lambda,
        this.config.minSamplesLeaf
      );

      if (split.featureIndex < 0) {
        // No valid split found
        break;
      }

      tree.splits[depth] = {
        featureIndex: split.featureIndex,
        threshold: split.threshold,
      };

      // Split nodes
      const newNodeIndices = [];
      for (const indices of nodeIndices) {
        const left = [];
        const right = [];
        for (const i of indices) {
          if (X[i][split.featureIndex] <= split.threshold) {
            left.push(i);
          } else {
            right.push(i);
          }
        }
        newNodeIndices.push(left, right);
      }
      nodeIndices = newNodeIndices;
    }

    // Compute leaf values
    for (let leafIdx = 0; leafIdx < tree.numLeaves; leafIdx++) {
      const indices = nodeIndices[leafIdx] || [];
      if (indices.length === 0) {
        tree.leafValues[leafIdx] = 0;
      } else {
        let sumGrad = 0;
        let sumHess = 0;
        for (const i of indices) {
          sumGrad += gradients[i];
          sumHess += hessians[i];
        }
        // Newton step with L2 regularization
        tree.leafValues[leafIdx] = -sumGrad / (sumHess + this.config.lambda);
      }
    }

    return tree;
  }

  /**
   * Predict class probabilities
   */
  predictProba(X) {
    const predictions = X.map(() => Array(NUM_CLASSES).fill(0));

    for (const roundTrees of this.trees) {
      for (let k = 0; k < NUM_CLASSES; k++) {
        const tree = roundTrees[k];
        for (let i = 0; i < X.length; i++) {
          predictions[i][k] += this.config.learningRate * tree.predict(X[i]);
        }
      }
    }

    return predictions.map(softmax);
  }

  /**
   * Predict class labels
   */
  predict(X) {
    const probs = this.predictProba(X);
    return probs.map((p) => {
      const maxIdx = p.indexOf(Math.max(...p));
      return LABELS[maxIdx];
    });
  }

  /**
   * Compute accuracy
   */
  computeAccuracy(X, y) {
    const predictions = this.predict(X);
    const yLabels = y.map((idx) => (typeof idx === 'number' ? LABELS[idx] : idx));
    let correct = 0;
    for (let i = 0; i < predictions.length; i++) {
      if (predictions[i] === yLabels[i]) {
        correct++;
      }
    }
    return correct / predictions.length;
  }

  /**
   * Export model to JSON
   */
  toJSON() {
    return {
      config: this.config,
      featureNames: this.featureNames,
      trees: this.trees.map((roundTrees) =>
        roundTrees.map((tree) => ({
          depth: tree.depth,
          splits: tree.splits,
          leafValues: tree.leafValues,
        }))
      ),
      trainHistory: this.trainHistory,
    };
  }

  /**
   * Load model from JSON
   */
  static fromJSON(json) {
    const model = new GradientBoostingClassifier(json.config);
    model.featureNames = json.featureNames;
    model.trainHistory = json.trainHistory;
    model.trees = json.trees.map((roundTrees) =>
      roundTrees.map((treeData) => {
        const tree = new SymmetricTree(treeData.depth);
        tree.splits = treeData.splits;
        tree.leafValues = treeData.leafValues;
        return tree;
      })
    );
    return model;
  }

  /**
   * Export to optimized JavaScript code
   */
  exportToJS() {
    const lines = [];

    lines.push('/**');
    lines.push(' * Gradient Boosting Query Router - Auto-generated');
    lines.push(` * Generated: ${new Date().toISOString()}`);
    lines.push(` * Rounds: ${this.trees.length}, Depth: ${this.config.maxDepth}`);
    lines.push(' */');
    lines.push('');
    lines.push('const LABELS = ["LEXICAL", "SEMANTIC", "STRUCTURAL", "HYBRID"];');
    lines.push(`const LEARNING_RATE = ${this.config.learningRate};`);
    lines.push('');

    // Generate tree evaluation functions
    for (let round = 0; round < this.trees.length; round++) {
      for (let k = 0; k < NUM_CLASSES; k++) {
        const tree = this.trees[round][k];
        lines.push(`function tree_${round}_${k}(f) {`);
        lines.push(this.generateTreeCode(tree, '  '));
        lines.push('}');
        lines.push('');
      }
    }

    // Generate main prediction function
    lines.push('export function predictGBM(features) {');
    lines.push('  const scores = [0, 0, 0, 0];');
    lines.push('');

    for (let round = 0; round < this.trees.length; round++) {
      for (let k = 0; k < NUM_CLASSES; k++) {
        lines.push(`  scores[${k}] += LEARNING_RATE * tree_${round}_${k}(features);`);
      }
    }

    lines.push('');
    lines.push('  // Softmax');
    lines.push('  const maxScore = Math.max(...scores);');
    lines.push('  const exp = scores.map(s => Math.exp(s - maxScore));');
    lines.push('  const sum = exp.reduce((a, b) => a + b, 0);');
    lines.push('  const probs = exp.map(e => e / sum);');
    lines.push('');
    lines.push('  // Find best class');
    lines.push('  let maxIdx = 0;');
    lines.push('  for (let i = 1; i < 4; i++) {');
    lines.push('    if (probs[i] > probs[maxIdx]) maxIdx = i;');
    lines.push('  }');
    lines.push('');
    lines.push('  return {');
    lines.push('    label: LABELS[maxIdx],');
    lines.push('    confidence: probs[maxIdx],');
    lines.push('    probs: { LEXICAL: probs[0], SEMANTIC: probs[1], STRUCTURAL: probs[2], HYBRID: probs[3] }');
    lines.push('  };');
    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Generate code for a single tree
   */
  generateTreeCode(tree, indent) {
    // For symmetric trees, we can use a more efficient lookup approach
    const lines = [];

    lines.push(`${indent}let idx = 0;`);

    for (let d = 0; d < tree.depth; d++) {
      const split = tree.splits[d];
      if (split) {
        const bit = tree.depth - 1 - d;
        lines.push(
          `${indent}if (f[${split.featureIndex}] > ${split.threshold}) idx |= ${1 << bit};`
        );
      }
    }

    // Generate leaf value lookup
    lines.push(`${indent}const leaves = [${tree.leafValues.map((v) => v.toFixed(6)).join(', ')}];`);
    lines.push(`${indent}return leaves[idx];`);

    return lines.join('\n');
  }
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Gradient Boosting Classifier for Query Router

Usage:
  node gradient-boosting.js --train <data.json> --output <model.json>
  node gradient-boosting.js --export <model.json> --js <output.js>
  node gradient-boosting.js --test

Options:
  --train <file>     Train on JSON data file
  --output <file>    Output model file
  --export <file>    Export model to JavaScript
  --js <file>        JavaScript output file
  --rounds <N>       Number of boosting rounds (default: 30)
  --depth <D>        Tree depth (default: 4)
  --lr <R>           Learning rate (default: 0.1)
  --test             Run test with synthetic data
`);
    process.exit(0);
  }

  if (args.includes('--test')) {
    console.log('Testing Gradient Boosting Classifier...\n');

    // Generate synthetic data
    const testData = [
      // LEXICAL: single tokens with code patterns
      { query: 'AuthService', label: 'LEXICAL' },
      { query: 'getUserById', label: 'LEXICAL' },
      { query: 'MAX_CONNECTIONS', label: 'LEXICAL' },
      { query: 'config.yaml', label: 'LEXICAL' },
      { query: 'UserController.java', label: 'LEXICAL' },

      // SEMANTIC: conceptual questions
      { query: 'how does authentication work', label: 'SEMANTIC' },
      { query: 'password reset flow', label: 'SEMANTIC' },
      { query: 'explain the caching mechanism', label: 'SEMANTIC' },
      { query: 'why is rate limiting needed', label: 'SEMANTIC' },
      { query: 'user login process', label: 'SEMANTIC' },

      // STRUCTURAL: dependency queries
      { query: 'what calls AuthService', label: 'STRUCTURAL' },
      { query: 'callers of LoginController', label: 'STRUCTURAL' },
      { query: 'implementations of UserRepository', label: 'STRUCTURAL' },
      { query: 'impact of changing Employee', label: 'STRUCTURAL' },
      { query: 'dependencies of EmailService', label: 'STRUCTURAL' },

      // HYBRID: mixed
      { query: 'AuthService login flow', label: 'HYBRID' },
      { query: 'session management', label: 'HYBRID' },
      { query: 'employee tracking', label: 'HYBRID' },
      { query: 'config encryption', label: 'HYBRID' },
      { query: 'user validation logic', label: 'HYBRID' },
    ];

    // Duplicate data for training (20 samples is too few)
    const trainingData = [];
    for (let i = 0; i < 10; i++) {
      for (const item of testData) {
        trainingData.push({ ...item });
      }
    }

    console.log(`Training on ${trainingData.length} samples...`);

    // Extract features
    const featureNames = getAllFeatureNames();
    const X = trainingData.map((d) => extractAllFeatures(d.query));
    const y = trainingData.map((d) => d.label);

    // Train model
    const model = new GradientBoostingClassifier({
      numRounds: 20,
      maxDepth: 3,
      learningRate: 0.1,
      earlyStoppingRounds: 0,
      validationRatio: 0.2,
    });

    model.fit(X, y, featureNames);

    // Test predictions
    console.log('\n--- Test Predictions ---');
    for (const item of testData.slice(0, 10)) {
      const features = extractAllFeatures(item.query);
      const pred = model.predict([features])[0];
      const match = pred === item.label ? '✓' : '✗';
      console.log(`${match} "${item.query}" → ${pred} (expected: ${item.label})`);
    }

    // Export to JS
    const jsCode = model.exportToJS();
    console.log(`\n--- Exported JS (${jsCode.length} bytes) ---`);
    console.log(jsCode.slice(0, 500) + '...');

    process.exit(0);
  }

  // Training mode
  const trainIdx = args.indexOf('--train');
  if (trainIdx !== -1 && args[trainIdx + 1]) {
    const inputFile = args[trainIdx + 1];
    const outputIdx = args.indexOf('--output');
    const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : 'gbm_model.json';

    const roundsIdx = args.indexOf('--rounds');
    const depthIdx = args.indexOf('--depth');
    const lrIdx = args.indexOf('--lr');

    const config = {
      numRounds: roundsIdx !== -1 ? parseInt(args[roundsIdx + 1], 10) : 30,
      maxDepth: depthIdx !== -1 ? parseInt(args[depthIdx + 1], 10) : 4,
      learningRate: lrIdx !== -1 ? parseFloat(args[lrIdx + 1]) : 0.1,
    };

    console.log(`Loading data from ${inputFile}...`);
    const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

    const samples = data.samples || data;
    console.log(`Loaded ${samples.length} samples`);

    const featureNames = getAllFeatureNames();
    const X = samples.map((d) => extractAllFeatures(d.query));
    const y = samples.map((d) => d.label);

    console.log(`Extracted ${X[0].length} features`);
    console.log(`Config: rounds=${config.numRounds}, depth=${config.maxDepth}, lr=${config.learningRate}`);

    const model = new GradientBoostingClassifier(config);
    const result = model.fit(X, y, featureNames);

    // Save model
    fs.writeFileSync(outputFile, JSON.stringify(model.toJSON(), null, 2));
    console.log(`\nModel saved to ${outputFile}`);

    process.exit(0);
  }

  // Export mode
  const exportIdx = args.indexOf('--export');
  if (exportIdx !== -1 && args[exportIdx + 1]) {
    const modelFile = args[exportIdx + 1];
    const jsIdx = args.indexOf('--js');
    const jsFile = jsIdx !== -1 ? args[jsIdx + 1] : 'gbm_router.js';

    console.log(`Loading model from ${modelFile}...`);
    const json = JSON.parse(fs.readFileSync(modelFile, 'utf-8'));
    const model = GradientBoostingClassifier.fromJSON(json);

    const jsCode = model.exportToJS();
    fs.writeFileSync(jsFile, jsCode);
    console.log(`Exported to ${jsFile} (${jsCode.length} bytes)`);

    process.exit(0);
  }

  console.log('Usage: node gradient-boosting.js --help');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
