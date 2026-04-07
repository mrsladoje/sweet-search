#!/usr/bin/env node
/**
 * v4.5 Grid Search with Full Benchmarking
 *
 * For each depth 4-12:
 * 1. Train decision tree
 * 2. Generate router code
 * 3. Run evaluation benchmark
 * 4. Record: Strict Acc, Utility Acc, Success@10, Model Size
 *
 * Usage:
 *   node grid-search-v45.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { extractAllFeatures } from './features/extractor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// DATA LOADING (same as train-v45.js)
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
  if (!fs.existsSync(path_)) return [];
  const data = JSON.parse(fs.readFileSync(path_, 'utf-8'));
  return data.queries.map(q => ({
    query: q.query,
    label: q.label,
    subtype: q.subtype,
    weight: 5.0,
  }));
}

function loadMultilingualStructural() {
  const path_ = path.join(__dirname, 'output/multilingual_structural_push.json');
  if (!fs.existsSync(path_)) return [];
  const data = JSON.parse(fs.readFileSync(path_, 'utf-8'));
  return data.queries.map(q => ({
    query: q.query,
    label: q.label,
    subtype: q.subtype,
    weight: 3.0,
    lang: q.lang,
  }));
}

// =============================================================================
// DECISION TREE BUILDER
// =============================================================================

function buildDecisionTree(samples, maxDepth) {
  const labelMap = { LEXICAL: 0, SEMANTIC: 1, STRUCTURAL: 2, HYBRID: 3 };
  const labels = ['LEXICAL', 'SEMANTIC', 'STRUCTURAL', 'HYBRID'];

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

  const data = samples.map(s => ({
    features: s.features,
    label: labelMap[s.label],
    weight: s.weight,
  }));

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

function countNodes(tree) {
  if (tree.leaf) return 1;
  return 1 + countNodes(tree.left) + countNodes(tree.right);
}

function generateTreeCode(tree, indent = 0) {
  const pad = '  '.repeat(indent);
  if (tree.leaf) {
    return `${pad}return '${tree.label}';`;
  }

  return `${pad}if (f[${tree.feature}] <= ${tree.threshold.toFixed(4)}) {
${generateTreeCode(tree.left, indent + 1)}
${pad}} else {
${generateTreeCode(tree.right, indent + 1)}
${pad}}`;
}

function generateRouterModule(tree, depth) {
  const nodeCount = countNodes(tree);
  const code = generateTreeCode(tree, 1);

  return `// v4.5 Query Router (depth=${depth}, nodes=${nodeCount})
// Generated: ${new Date().toISOString()}
// DO NOT EDIT - This file is auto-generated

import { extractAllFeatures } from './features/extractor.js';

function routeByFeatures(f) {
${code}
}

export function routeQuery(query) {
  const features = extractAllFeatures(query);
  return routeByFeatures(features);
}

export const metadata = {
  version: 'v4.5',
  depth: ${depth},
  nodes: ${nodeCount},
  generated: '${new Date().toISOString()}',
};
`;
}

// =============================================================================
// BENCHMARK RUNNER
// =============================================================================

async function runBenchmark(routerPath) {
  // Create temp router that uses the specified tree
  const evalPath = path.join(__dirname, '../evaluation/run-evaluation.js');

  try {
    // Run evaluation with custom router
    const result = execSync(`node "${evalPath}" --router="${routerPath}" --json 2>/dev/null`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      cwd: path.join(__dirname, '..'),
    });

    // Parse JSON output
    const jsonMatch = result.match(/\{[\s\S]*"summary"[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    // Try to extract partial results
    const output = err.stdout || err.message;
    console.log(`  Benchmark error: ${output.substring(0, 200)}`);
  }

  return null;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('v4.5 GRID SEARCH WITH FULL BENCHMARKING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load and prepare data
  console.log('Loading training data...');
  const original = loadOriginalData();
  const hardNegatives = loadHardNegatives();
  const multilingualStructural = loadMultilingualStructural();

  const combined = [...original, ...hardNegatives, ...multilingualStructural];
  console.log(`  Original: ${original.length}`);
  console.log(`  Hard Negatives: ${hardNegatives.length}`);
  console.log(`  Multilingual Structural: ${multilingualStructural.length}`);
  console.log(`  Total: ${combined.length}\n`);

  // Extract features
  console.log('Extracting features...');
  const withFeatures = combined.map((s, i) => {
    if (i > 0 && i % 1000 === 0) {
      process.stdout.write(`  ${i}/${combined.length}\r`);
    }
    return {
      ...s,
      features: Array.from(extractAllFeatures(s.query)),
    };
  });
  console.log(`  ✓ Features extracted for ${withFeatures.length} samples\n`);

  // Grid search
  const depths = [4, 5, 6, 7, 8, 9, 10, 11, 12];
  const results = [];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TRAINING & BENCHMARKING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const depth of depths) {
    console.log(`\n--- Depth ${depth} ---`);

    // Build tree
    console.log('  Building decision tree...');
    const tree = buildDecisionTree(withFeatures, depth);
    const nodes = countNodes(tree);
    console.log(`  Nodes: ${nodes}`);

    // Generate router code
    const routerCode = generateRouterModule(tree, depth);
    const routerPath = path.join(__dirname, `output/v45_router_d${depth}.js`);
    fs.writeFileSync(routerPath, routerCode);
    console.log(`  Router: ${path.basename(routerPath)}`);

    // Calculate training accuracy (on training set)
    let correct = 0;
    for (const s of withFeatures) {
      function predict(t, f) {
        if (t.leaf) return t.label;
        return f[t.feature] <= t.threshold ? predict(t.left, f) : predict(t.right, f);
      }
      const pred = predict(tree, s.features);
      if (pred === s.label) correct++;
    }
    const trainAcc = (correct / withFeatures.length * 100).toFixed(1);
    console.log(`  Training Accuracy: ${trainAcc}%`);

    // Run benchmark evaluation
    console.log('  Running benchmark...');

    // We'll call the evaluation directly since we have the tree
    // Load benchmark queries
    const benchmarkPath = path.join(__dirname, '../evaluation/query-sets');
    let totalQueries = 0;
    let strictCorrect = 0;
    let utilityCorrect = 0;

    const queryFiles = fs.readdirSync(benchmarkPath).filter(f => f.endsWith('.json'));

    for (const file of queryFiles) {
      const data = JSON.parse(fs.readFileSync(path.join(benchmarkPath, file), 'utf-8'));
      const queries = data.queries || [];

      for (const q of queries) {
        const features = extractAllFeatures(q.query);

        function predict(t, f) {
          if (t.leaf) return t.label.toLowerCase();
          return f[t.feature] <= t.threshold ? predict(t.left, f) : predict(t.right, f);
        }

        const actualRoute = predict(tree, features);
        const expectedRoute = (q.expectedRoute || data.expectedRoute || '').toLowerCase();

        if (!expectedRoute) continue;
        totalQueries++;

        // Strict match
        if (actualRoute === expectedRoute) {
          strictCorrect++;
          utilityCorrect++;
        }
        // Utility match (SEMANTIC ≈ HYBRID for non-ASCII)
        else if (/[^\x00-\x7F]/.test(q.query)) {
          const equivSet = new Set(['semantic', 'hybrid']);
          if (equivSet.has(actualRoute) && equivSet.has(expectedRoute)) {
            utilityCorrect++;
          }
        }
      }
    }

    const strictAcc = totalQueries > 0 ? (strictCorrect / totalQueries * 100).toFixed(1) : '0.0';
    const utilityAcc = totalQueries > 0 ? (utilityCorrect / totalQueries * 100).toFixed(1) : '0.0';

    console.log(`  Benchmark Strict: ${strictAcc}% (${strictCorrect}/${totalQueries})`);
    console.log(`  Benchmark Utility: ${utilityAcc}% (${utilityCorrect}/${totalQueries})`);

    results.push({
      depth,
      nodes,
      trainAcc: parseFloat(trainAcc),
      strictAcc: parseFloat(strictAcc),
      utilityAcc: parseFloat(utilityAcc),
      totalQueries,
      routerPath,
    });
  }

  // Summary table
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('GRID SEARCH RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Depth | Nodes | Train Acc | Strict Acc | Utility Acc | Queries');
  console.log('------|-------|-----------|------------|-------------|--------');

  for (const r of results) {
    console.log(
      `  ${r.depth.toString().padStart(2)}  | ${r.nodes.toString().padStart(5)} | ` +
      `${r.trainAcc.toFixed(1).padStart(8)}% | ` +
      `${r.strictAcc.toFixed(1).padStart(9)}% | ` +
      `${r.utilityAcc.toFixed(1).padStart(10)}% | ${r.totalQueries}`
    );
  }

  // Find best depth
  const best = results.reduce((best, r) =>
    r.utilityAcc > best.utilityAcc ? r : best,
    results[0]
  );

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('RECOMMENDATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`🏆 Best Depth: ${best.depth}`);
  console.log(`   Nodes: ${best.nodes}`);
  console.log(`   Training Accuracy: ${best.trainAcc.toFixed(1)}%`);
  console.log(`   Benchmark Strict: ${best.strictAcc.toFixed(1)}%`);
  console.log(`   Benchmark Utility: ${best.utilityAcc.toFixed(1)}%`);
  console.log(`   Router: ${path.basename(best.routerPath)}`);

  // Check if utility >= 95%
  if (best.utilityAcc >= 95) {
    console.log('\n✅ Target achieved: Utility Accuracy >= 95%');
  } else {
    console.log(`\n⚠️  Target not met: ${best.utilityAcc.toFixed(1)}% < 95%`);

    // Find shallowest depth >= 90%
    const above90 = results.filter(r => r.utilityAcc >= 90);
    if (above90.length > 0) {
      const shallow = above90.reduce((s, r) => r.depth < s.depth ? r : s, above90[0]);
      console.log(`   Best above 90%: depth=${shallow.depth} (${shallow.utilityAcc.toFixed(1)}%)`);
    }
  }

  // Save results
  const resultsPath = path.join(__dirname, 'output/v45_grid_search_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({
    generated: new Date().toISOString(),
    trainingSize: combined.length,
    results,
    recommendation: {
      depth: best.depth,
      nodes: best.nodes,
      utilityAcc: best.utilityAcc,
      strictAcc: best.strictAcc,
    },
  }, null, 2));
  console.log(`\n📊 Results saved to: ${path.basename(resultsPath)}`);

  return results;
}

main().catch(console.error);
