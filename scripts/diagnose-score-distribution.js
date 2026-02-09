#!/usr/bin/env node
/**
 * Diagnose actual Int8 score distribution for proper threshold calibration
 */

import { SmartSearch } from '../core/smart-search-v21.js';

async function diagnose() {
  const search = new SmartSearch({ verbose: false });
  await search.init();

  // Test queries representing different types
  const queries = [
    'AuthService',                        // exact identifier
    'how does authentication work',       // conceptual
    'employee time tracking',             // multi-word
    'BezierFitHeuristic',                 // exact match
    'implementations of DetectionHeuristic', // structural
    'mouse movement analysis',            // conceptual
    'LoginController',                    // exact
    'gRPC streaming',                     // technical
  ];

  console.log('=== INT8 SCORE DISTRIBUTION ANALYSIS ===\n');
  console.log('Goal: Calibrate shouldSkipRerank thresholds to actual Voyage code-3 score ranges\n');

  const allScores = [];

  for (const query of queries) {
    // Access internal search to see raw Int8 scores
    const result = await search.search(query, 20);
    const results = result.results || result;

    if (results.length === 0) {
      console.log(`Query: "${query}" → No results\n`);
      continue;
    }

    // Collect Int8 scores
    const int8Scores = results
      .filter(r => r.int8Score !== undefined)
      .map(r => r.int8Score);

    if (int8Scores.length === 0) {
      console.log(`Query: "${query}" → Lexical path (no Int8 scores)\n`);
      continue;
    }

    allScores.push(...int8Scores);

    const sorted = [...int8Scores].sort((a, b) => b - a);
    const max = sorted[0];
    const min = sorted[sorted.length - 1];
    const spread = max - min;
    const gap = sorted.length > 1 ? sorted[0] - sorted[1] : 0;
    const mean = int8Scores.reduce((a, b) => a + b, 0) / int8Scores.length;

    console.log(`Query: "${query}"`);
    console.log(`  Int8 scores (top 5): ${sorted.slice(0, 5).map(s => s.toFixed(4)).join(', ')}`);
    console.log(`  Max: ${max.toFixed(4)}, Min: ${min.toFixed(4)}, Spread: ${spread.toFixed(4)}`);
    console.log(`  Top gap (#1-#2): ${gap.toFixed(4)}`);
    console.log(`  Mean: ${mean.toFixed(4)}`);
    console.log();
  }

  if (allScores.length > 0) {
    allScores.sort((a, b) => b - a);
    const globalMax = allScores[0];
    const globalMin = allScores[allScores.length - 1];
    const p50 = allScores[Math.floor(allScores.length * 0.5)];
    const p90 = allScores[Math.floor(allScores.length * 0.1)];
    const p10 = allScores[Math.floor(allScores.length * 0.9)];

    console.log('=== GLOBAL STATISTICS ===');
    console.log(`Total scores collected: ${allScores.length}`);
    console.log(`Global Max: ${globalMax.toFixed(4)}`);
    console.log(`Global Min: ${globalMin.toFixed(4)}`);
    console.log(`P90: ${p90.toFixed(4)}`);
    console.log(`P50 (median): ${p50.toFixed(4)}`);
    console.log(`P10: ${p10.toFixed(4)}`);

    console.log('\n=== RECOMMENDED THRESHOLDS ===');
    console.log(`Current minScoreThreshold: 0.30 (way too high!)`);
    console.log(`Recommended minScoreThreshold: ${(globalMax * 0.3).toFixed(4)} (30% of max observed)`);
    console.log(`Recommended spreadThreshold: ${(globalMax * 0.1).toFixed(4)} (10% of max)`);
    console.log(`Recommended highConfidence: ${(globalMax * 0.8).toFixed(4)} (80% of max)`);
  }
}

diagnose().catch(console.error);
