#!/usr/bin/env node
/**
 * Extract CatBoost tree data and generate compact Rust representation.
 *
 * Each tree has:
 * - 4 split features (indices)
 * - 4 split thresholds (f32)
 * - 16 leaf values × 4 classes = 64 f32 values
 *
 * Output: Rust source with static tree data arrays
 */

import fs from 'fs';

const jsFile = process.argv[2] || '../training/output/v45_router_d4.js';
const content = fs.readFileSync(jsFile, 'utf8');

// Parse trees
const trees = [];
const treeRegex = /\/\/ Tree (\d+)[\s\S]*?const leafIdx = \(\(features\[(\d+)\] > ([\d.e+-]+)\) << 0\) \| \(\(features\[(\d+)\] > ([\d.e+-]+)\) << 1\) \| \(\(features\[(\d+)\] > ([\d.e+-]+)\) << 2\) \| \(\(features\[(\d+)\] > ([\d.e+-]+)\) << 3\);[\s\S]*?switch \(leafIdx\) \{([\s\S]*?)\}/g;

let match;
while ((match = treeRegex.exec(content)) !== null) {
  const [, treeNum, f0, t0, f1, t1, f2, t2, f3, t3, switchBody] = match;

  // Parse leaf values from switch cases
  const leafValues = new Array(16).fill(null).map(() => [0, 0, 0, 0]);
  const caseRegex = /case (\d+): scores\[0\] \+= ([\d.e+-]+); scores\[1\] \+= ([\d.e+-]+); scores\[2\] \+= ([\d.e+-]+); scores\[3\] \+= ([\d.e+-]+);/g;

  let caseMatch;
  while ((caseMatch = caseRegex.exec(switchBody)) !== null) {
    const [, caseNum, s0, s1, s2, s3] = caseMatch;
    leafValues[parseInt(caseNum)] = [
      parseFloat(s0),
      parseFloat(s1),
      parseFloat(s2),
      parseFloat(s3),
    ];
  }

  trees.push({
    features: [parseInt(f0), parseInt(f1), parseInt(f2), parseInt(f3)],
    thresholds: [parseFloat(t0), parseFloat(t1), parseFloat(t2), parseFloat(t3)],
    leafValues,
  });
}

console.error(`Parsed ${trees.length} trees`);

// Generate Rust code
let rust = `//! CatBoost Decision Trees - Auto-generated
//!
//! Trees: ${trees.length}
//! Classes: 4 (LEXICAL, SEMANTIC, STRUCTURAL, HYBRID)
//! Depth: 4 (16 leaves per tree)
//!
//! Data format:
//! - SPLIT_FEATURES: [tree_idx * 4 + bit] -> feature index
//! - SPLIT_THRESHOLDS: [tree_idx * 4 + bit] -> threshold value
//! - LEAF_VALUES: [tree_idx * 64 + leaf_idx * 4 + class] -> score delta

/// Number of trees
pub const NUM_TREES: usize = ${trees.length};

/// Split feature indices (4 per tree)
pub static SPLIT_FEATURES: [u8; ${trees.length * 4}] = [
`;

// Split features
for (let i = 0; i < trees.length; i++) {
  const t = trees[i];
  rust += `    ${t.features.join(', ')},${i < trees.length - 1 ? ' // ' + i : ' // ' + i}\n`;
}
rust += `];

/// Split thresholds (4 per tree)
pub static SPLIT_THRESHOLDS: [f32; ${trees.length * 4}] = [
`;

// Split thresholds
for (let i = 0; i < trees.length; i++) {
  const t = trees[i];
  rust += `    ${t.thresholds.map(v => v.toFixed(8)).join(', ')},\n`;
}
rust += `];

/// Leaf values (64 per tree = 16 leaves × 4 classes)
pub static LEAF_VALUES: [f32; ${trees.length * 64}] = [
`;

// Leaf values (compacted)
for (let i = 0; i < trees.length; i++) {
  const t = trees[i];
  rust += `    // Tree ${i}\n`;
  for (let leaf = 0; leaf < 16; leaf++) {
    const vals = t.leafValues[leaf];
    rust += `    ${vals.map(v => v.toFixed(6)).join(', ')},\n`;
  }
}
rust += `];

/// Route a query using CatBoost model
/// Returns: (class_index, confidence, [scores])
pub fn route_catboost(features: &[f32; 50]) -> (usize, f32, [f32; 4]) {
    let mut scores = [0.0f32; 4];

    for tree_idx in 0..NUM_TREES {
        let base = tree_idx * 4;

        // Compute leaf index from 4 splits
        let leaf_idx =
            ((features[SPLIT_FEATURES[base] as usize] > SPLIT_THRESHOLDS[base]) as usize) |
            ((features[SPLIT_FEATURES[base + 1] as usize] > SPLIT_THRESHOLDS[base + 1]) as usize) << 1 |
            ((features[SPLIT_FEATURES[base + 2] as usize] > SPLIT_THRESHOLDS[base + 2]) as usize) << 2 |
            ((features[SPLIT_FEATURES[base + 3] as usize] > SPLIT_THRESHOLDS[base + 3]) as usize) << 3;

        // Add leaf values to scores
        let leaf_base = tree_idx * 64 + leaf_idx * 4;
        scores[0] += LEAF_VALUES[leaf_base];
        scores[1] += LEAF_VALUES[leaf_base + 1];
        scores[2] += LEAF_VALUES[leaf_base + 2];
        scores[3] += LEAF_VALUES[leaf_base + 3];
    }

    // Find winning class
    let mut max_idx = 0;
    let mut max_score = scores[0];
    for i in 1..4 {
        if scores[i] > max_score {
            max_score = scores[i];
            max_idx = i;
        }
    }

    // Calculate confidence via softmax
    let exp_scores: [f32; 4] = [
        scores[0].exp(),
        scores[1].exp(),
        scores[2].exp(),
        scores[3].exp(),
    ];
    let sum_exp = exp_scores[0] + exp_scores[1] + exp_scores[2] + exp_scores[3];
    let confidence = exp_scores[max_idx] / sum_exp;

    (max_idx, confidence, scores)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tree_count() {
        assert_eq!(NUM_TREES, ${trees.length});
    }

    #[test]
    fn test_data_sizes() {
        assert_eq!(SPLIT_FEATURES.len(), NUM_TREES * 4);
        assert_eq!(SPLIT_THRESHOLDS.len(), NUM_TREES * 4);
        assert_eq!(LEAF_VALUES.len(), NUM_TREES * 64);
    }
}
`;

console.log(rust);
