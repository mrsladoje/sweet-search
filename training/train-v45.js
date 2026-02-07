#!/usr/bin/env node
/**
 * v4.5 Grid Search Training Script
 *
 * Clean data mix (no "Intent Salad" bloat):
 * - Original LLM Labeled Data (4,311 samples)
 * - Hard Negatives (330 samples, weight 5.0)
 * - Multilingual Structural Push (1,500 samples, weight 3.0)
 *
 * Total: ~6,141 high-signal samples
 *
 * Usage:
 *   node train-v45.js --depth=6              # Train with depth 6
 *   node train-v45.js --depth=6 --dry-run    # Extract features only, no training
 *   node train-v45.js --grid                 # Run grid search for depths 4-12
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { extractAllFeatures } from './features/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// DATA LOADING
// =============================================================================

function loadOriginalData() {
  const originalPath = path.join(__dirname, 'output/llm_labeled_data.json');
  const data = JSON.parse(fs.readFileSync(originalPath, 'utf-8'));
  return (data.samples || data).map(s => ({
    query: s.query,
    label: s.originalLabel || s.label,
    subtype: s.subtype || 'original',
    weight: 1.0,
  }));
}

function loadHardNegatives() {
  const path_ = path.join(__dirname, 'output/hard_negatives.json');
  if (!fs.existsSync(path_)) {
    console.log('  Warning: Hard negatives not found');
    return [];
  }
  const data = JSON.parse(fs.readFileSync(path_, 'utf-8'));
  return data.queries.map(q => ({
    query: q.query,
    label: q.label,
    subtype: q.subtype,
    weight: 5.0,  // High weight for hard negatives
  }));
}

function loadMultilingualStructural() {
  const path_ = path.join(__dirname, 'output/multilingual_structural_push.json');
  if (!fs.existsSync(path_)) {
    console.log('  Warning: Multilingual structural push not found');
    return [];
  }
  const data = JSON.parse(fs.readFileSync(path_, 'utf-8'));
  return data.queries.map(q => ({
    query: q.query,
    label: q.label,
    subtype: q.subtype,
    weight: 3.0,  // Higher weight to enforce structural patterns
    lang: q.lang,
  }));
}

// =============================================================================
// FEATURE EXTRACTION
// =============================================================================

function extractFeaturesForDataset(samples) {
  console.log(`  Extracting 50 features for ${samples.length} samples...`);
  const withFeatures = samples.map((s, i) => {
    if (i > 0 && i % 1000 === 0) {
      process.stdout.write(`    ${i}/${samples.length}\r`);
    }
    return {
      ...s,
      features: Array.from(extractAllFeatures(s.query)),
    };
  });
  console.log(`    ✓ Done`);
  return withFeatures;
}

// =============================================================================
// CATBOOST TRAINING (via Python)
// =============================================================================

function trainCatBoost(samples, depth, outputName) {
  // Prepare data for CatBoost Python script
  const labelMap = { LEXICAL: 0, SEMANTIC: 1, STRUCTURAL: 2, HYBRID: 3 };

  const X = samples.map(s => s.features);
  const y = samples.map(s => labelMap[s.label] ?? 1);
  const weights = samples.map(s => s.weight);

  // Save temp files
  const tempDir = path.join(__dirname, '.temp_catboost');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const xPath = path.join(tempDir, 'X.json');
  const yPath = path.join(tempDir, 'y.json');
  const wPath = path.join(tempDir, 'w.json');

  fs.writeFileSync(xPath, JSON.stringify(X));
  fs.writeFileSync(yPath, JSON.stringify(y));
  fs.writeFileSync(wPath, JSON.stringify(weights));

  // Generate Python training script
  const pythonScript = `
import json
import numpy as np
from catboost import CatBoostClassifier
from sklearn.model_selection import train_test_split

# Load data
with open('${xPath}') as f:
    X = np.array(json.load(f))
with open('${yPath}') as f:
    y = np.array(json.load(f))
with open('${wPath}') as f:
    weights = np.array(json.load(f))

# Train/test split
X_train, X_test, y_train, y_test, w_train, w_test = train_test_split(
    X, y, weights, test_size=0.2, random_state=42, stratify=y
)

# Train CatBoost
model = CatBoostClassifier(
    iterations=500,
    depth=${depth},
    learning_rate=0.1,
    loss_function='MultiClass',
    random_seed=42,
    verbose=0,
    early_stopping_rounds=50,
    use_best_model=True,
    sample_weight=w_train.tolist(),  # Use weights during training
)

model.fit(X_train, y_train, eval_set=(X_test, y_test), sample_weight=w_train)

# Evaluate
train_acc = model.score(X_train, y_train)
test_acc = model.score(X_test, y_test)

# Get model size (number of trees)
model_info = model.get_all_params()
tree_count = model.tree_count_

# Export tree structures
trees = []
for i in range(model.tree_count_):
    tree = model.get_tree_leaf_values()[i] if hasattr(model, 'get_tree_leaf_values') else []
    trees.append(tree)

# Save model
model.save_model('${path.join(tempDir, outputName + '.cbm')}')

# Output metrics
print(json.dumps({
    'train_acc': float(train_acc),
    'test_acc': float(test_acc),
    'tree_count': int(tree_count),
    'depth': ${depth},
    'iterations': model.get_best_iteration() if model.get_best_iteration() else 500,
}))
`;

  const pyScriptPath = path.join(tempDir, 'train.py');
  fs.writeFileSync(pyScriptPath, pythonScript);

  // Run Python
  try {
    const result = execSync(`python3 ${pyScriptPath}`, {
      cwd: tempDir,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    // Parse metrics from output
    const lines = result.trim().split('\n');
    const metricsLine = lines[lines.length - 1];
    return JSON.parse(metricsLine);
  } catch (err) {
    console.error('CatBoost training failed:', err.message);
    return null;
  }
}

// =============================================================================
// DECISION TREE (ID3-style) DISTILLATION
// =============================================================================

function distillToDecisionTree(samples, maxDepth) {
  // Build a simple decision tree using information gain
  const labelMap = { LEXICAL: 0, SEMANTIC: 1, STRUCTURAL: 2, HYBRID: 3 };
  const labels = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];

  // Prepare data
  const data = samples.map(s => ({
    features: s.features,
    label: labelMap[s.label],
    weight: s.weight,
  }));

  // Feature names for interpretability
  const featureNames = [
    'hasCamelBoundary', 'hasUnderscoreWord', 'startsWithUppercase', 'hasConsecutiveUppercase',
    'isSingleToken', 'hasDotNotation', 'hasParentheses', 'hasFileExtension', 'hasPathSeparator',
    'tokenCount', 'avgTokenLength', 'uppercaseRatio', 'digitRatio', 'nonAsciiRatio', 'hasNonLatinScript',
    'hasCallerPattern', 'hasCalleePattern', 'hasImplementationPattern', 'hasImpactPattern', 'hasIdentifierInQuery',
    'startsWithQuestionWord', 'endsWithQuestionMark', 'hasSemanticConceptWord', 'hasExplanationRequest', 'hasHowDoesWorkPattern',
    'hasNonAsciiIdentifier', 'hasMixedScriptToken', 'hasStructuralKeywordNonEn', 'hasSemanticKeywordNonEn', 'hasCrossScriptConcept',
    'identifierAtStart', 'identifierAtEnd', 'hasExplicitStructuralKeyword', 'hasUnknownTrailingContent',
    'identifierIndex', 'hasActionVerb', 'hasQuestionIdentifier', 'structuralKeywordCount',
    'hasVerifiedAsciiIdentifier', 'structuralTemplateMatch', 'hasNonEnglishConceptStem', 'pureNativeLanguageScore', 'expandedStructuralKeywordPresence',
    'cjkDensity', 'effectiveTokenCount', 'isComplexQuestion', 'isStructuralQuestion', 'tokenCharacterDensity', 'hasNonLatinIdentifier', 'isAllCapsConstant',
  ];

  function entropy(counts, total) {
    if (total === 0) return 0;
    let e = 0;
    for (const c of Object.values(counts)) {
      if (c > 0) {
        const p = c / total;
        e -= p * Math.log2(p);
      }
    }
    return e;
  }

  function buildTree(subset, depth) {
    if (depth >= maxDepth || subset.length < 10) {
      // Return leaf with majority class
      const counts = {};
      let total = 0;
      for (const d of subset) {
        counts[d.label] = (counts[d.label] || 0) + d.weight;
        total += d.weight;
      }
      let maxCount = 0;
      let maxLabel = 1; // Default SEMANTIC
      for (const [label, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          maxLabel = parseInt(label);
        }
      }
      return { leaf: true, label: labels[maxLabel], confidence: total > 0 ? maxCount / total : 0 };
    }

    // Find best split
    let bestGain = 0;
    let bestFeature = -1;
    let bestThreshold = 0.5;

    const parentCounts = {};
    let parentTotal = 0;
    for (const d of subset) {
      parentCounts[d.label] = (parentCounts[d.label] || 0) + d.weight;
      parentTotal += d.weight;
    }
    const parentEntropy = entropy(parentCounts, parentTotal);

    for (let f = 0; f < 50; f++) {
      // Try threshold 0.5 for binary features, median for continuous
      const values = subset.map(d => d.features[f]).sort((a, b) => a - b);
      const threshold = values[Math.floor(values.length / 2)];

      const leftCounts = {};
      const rightCounts = {};
      let leftTotal = 0;
      let rightTotal = 0;

      for (const d of subset) {
        if (d.features[f] <= threshold) {
          leftCounts[d.label] = (leftCounts[d.label] || 0) + d.weight;
          leftTotal += d.weight;
        } else {
          rightCounts[d.label] = (rightCounts[d.label] || 0) + d.weight;
          rightTotal += d.weight;
        }
      }

      if (leftTotal === 0 || rightTotal === 0) continue;

      const leftEntropy = entropy(leftCounts, leftTotal);
      const rightEntropy = entropy(rightCounts, rightTotal);
      const weightedEntropy = (leftTotal * leftEntropy + rightTotal * rightEntropy) / parentTotal;
      const gain = parentEntropy - weightedEntropy;

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = threshold;
      }
    }

    if (bestFeature === -1 || bestGain < 0.001) {
      // No good split found
      const counts = {};
      let total = 0;
      for (const d of subset) {
        counts[d.label] = (counts[d.label] || 0) + d.weight;
        total += d.weight;
      }
      let maxCount = 0;
      let maxLabel = 1;
      for (const [label, count] of Object.entries(counts)) {
        if (count > maxCount) {
          maxCount = count;
          maxLabel = parseInt(label);
        }
      }
      return { leaf: true, label: labels[maxLabel], confidence: total > 0 ? maxCount / total : 0 };
    }

    const left = subset.filter(d => d.features[bestFeature] <= bestThreshold);
    const right = subset.filter(d => d.features[bestFeature] > bestThreshold);

    return {
      leaf: false,
      feature: bestFeature,
      featureName: featureNames[bestFeature] || `f${bestFeature}`,
      threshold: bestThreshold,
      left: buildTree(left, depth + 1),
      right: buildTree(right, depth + 1),
    };
  }

  return buildTree(data, 0);
}

function generateTreeCode(tree, indent = 0) {
  const pad = '  '.repeat(indent);
  if (tree.leaf) {
    return `${pad}return '${tree.label}'; // confidence: ${(tree.confidence * 100).toFixed(1)}%`;
  }

  return `${pad}if (f[${tree.feature}] <= ${tree.threshold.toFixed(4)}) { // ${tree.featureName}
${generateTreeCode(tree.left, indent + 1)}
${pad}} else {
${generateTreeCode(tree.right, indent + 1)}
${pad}}`;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  const depthArg = args.find(a => a.startsWith('--depth='));
  const depth = depthArg ? parseInt(depthArg.split('=')[1]) : 6;
  const dryRun = args.includes('--dry-run');
  const gridSearch = args.includes('--grid');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('v4.5 TRAINING SCRIPT (Clean Data Mix)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load data
  console.log('Loading data...');
  const original = loadOriginalData();
  console.log(`  Original: ${original.length} samples`);

  const hardNegatives = loadHardNegatives();
  console.log(`  Hard Negatives: ${hardNegatives.length} samples (weight 5.0)`);

  const multilingualStructural = loadMultilingualStructural();
  console.log(`  Multilingual Structural: ${multilingualStructural.length} samples (weight 3.0)`);

  // Combine
  const combined = [...original, ...hardNegatives, ...multilingualStructural];
  console.log(`\n  Total: ${combined.length} samples`);

  // Show distribution
  const labelDist = {};
  for (const s of combined) {
    labelDist[s.label] = (labelDist[s.label] || 0) + 1;
  }
  console.log('  Label distribution:', labelDist);

  // Extract features
  console.log('\nExtracting features...');
  const withFeatures = extractFeaturesForDataset(combined);

  if (dryRun) {
    console.log('\n  Dry run mode - skipping training');
    const outputPath = path.join(__dirname, 'output/v45_features.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      counts: { original: original.length, hardNegatives: hardNegatives.length, multilingual: multilingualStructural.length },
      samples: withFeatures,
    }, null, 2));
    console.log(`  Saved features to ${outputPath}`);
    return;
  }

  if (gridSearch) {
    // Run grid search
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('GRID SEARCH: depths 4-12');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const results = [];

    for (const d of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      console.log(`\n--- Training depth=${d} ---`);

      // Distill to decision tree
      const tree = distillToDecisionTree(withFeatures, d);
      const treeCode = generateTreeCode(tree);

      // Count nodes
      function countNodes(t) {
        if (t.leaf) return 1;
        return 1 + countNodes(t.left) + countNodes(t.right);
      }
      const nodeCount = countNodes(tree);

      // Save tree
      const treePath = path.join(__dirname, `output/v45_tree_d${d}.js`);
      const jsCode = `// v4.5 Decision Tree (depth=${d}, nodes=${nodeCount})
// Generated: ${new Date().toISOString()}
// Training data: ${combined.length} samples

export function routeQuery(f) {
${treeCode}
}

export const metadata = {
  depth: ${d},
  nodes: ${nodeCount},
  trainingSize: ${combined.length},
};
`;
      fs.writeFileSync(treePath, jsCode);

      results.push({
        depth: d,
        nodes: nodeCount,
        treePath,
      });

      console.log(`  Nodes: ${nodeCount}`);
      console.log(`  Saved: ${treePath}`);
    }

    // Summary table
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('GRID SEARCH RESULTS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\nDepth | Nodes | File');
    console.log('------|-------|-----');
    for (const r of results) {
      console.log(`  ${r.depth.toString().padStart(2)}  | ${r.nodes.toString().padStart(5)} | ${path.basename(r.treePath)}`);
    }

    console.log('\n\nNext: Run benchmarks with ./run-v45-benchmark.sh');
    return results;
  }

  // Single depth training
  console.log(`\nTraining decision tree (depth=${depth})...`);
  const tree = distillToDecisionTree(withFeatures, depth);
  const treeCode = generateTreeCode(tree);

  function countNodes(t) {
    if (t.leaf) return 1;
    return 1 + countNodes(t.left) + countNodes(t.right);
  }
  const nodeCount = countNodes(tree);

  // Save tree
  const treePath = path.join(__dirname, `output/v45_tree_d${depth}.js`);
  const jsCode = `// v4.5 Decision Tree (depth=${depth}, nodes=${nodeCount})
// Generated: ${new Date().toISOString()}
// Training data: ${combined.length} samples

export function routeQuery(f) {
${treeCode}
}

export const metadata = {
  depth: ${depth},
  nodes: ${nodeCount},
  trainingSize: ${combined.length},
};
`;
  fs.writeFileSync(treePath, jsCode);

  console.log(`\n✓ Generated decision tree`);
  console.log(`  Depth: ${depth}`);
  console.log(`  Nodes: ${nodeCount}`);
  console.log(`  Output: ${treePath}`);

  return { depth, nodes: nodeCount, treePath };
}

// Run
main().catch(console.error);
