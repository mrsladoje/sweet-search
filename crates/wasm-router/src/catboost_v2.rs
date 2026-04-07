//! CatBoost Decision Trees - Optimized v2
//!
//! Key optimizations:
//! 1. Unsafe array access (skip bounds checks)
//! 2. Loop unrolling (4 trees at a time)
//! 3. Fast confidence approximation (no exp())
//! 4. SIMD-style score accumulation

use super::catboost::{NUM_TREES, SPLIT_FEATURES, SPLIT_THRESHOLDS, LEAF_VALUES};

/// Route a query using optimized CatBoost inference
/// Returns: (class_index, confidence, [scores])
#[inline]
pub fn route_catboost_fast(features: &[f32; 50]) -> (usize, f32, [f32; 3]) {
    let mut scores = [0.0f32; 3];

    // Process 4 trees at a time for better ILP
    let full_batches = NUM_TREES / 4;
    let remainder = NUM_TREES % 4;

    // Main loop - 4 trees per iteration
    for batch in 0..full_batches {
        let tree_base = batch * 4;

        // Tree 0 of batch
        let base0 = tree_base * 4;
        let leaf_idx0 = unsafe { compute_leaf_unsafe(features, base0) };
        let leaf_base0 = tree_base * 48 + leaf_idx0 * 3;
        unsafe { accumulate_scores_unsafe(&mut scores, leaf_base0); }

        // Tree 1 of batch
        let base1 = (tree_base + 1) * 4;
        let leaf_idx1 = unsafe { compute_leaf_unsafe(features, base1) };
        let leaf_base1 = (tree_base + 1) * 48 + leaf_idx1 * 3;
        unsafe { accumulate_scores_unsafe(&mut scores, leaf_base1); }

        // Tree 2 of batch
        let base2 = (tree_base + 2) * 4;
        let leaf_idx2 = unsafe { compute_leaf_unsafe(features, base2) };
        let leaf_base2 = (tree_base + 2) * 48 + leaf_idx2 * 3;
        unsafe { accumulate_scores_unsafe(&mut scores, leaf_base2); }

        // Tree 3 of batch
        let base3 = (tree_base + 3) * 4;
        let leaf_idx3 = unsafe { compute_leaf_unsafe(features, base3) };
        let leaf_base3 = (tree_base + 3) * 48 + leaf_idx3 * 3;
        unsafe { accumulate_scores_unsafe(&mut scores, leaf_base3); }
    }

    // Handle remainder trees
    for tree_idx in (full_batches * 4)..NUM_TREES {
        let base = tree_idx * 4;
        let leaf_idx = unsafe { compute_leaf_unsafe(features, base) };
        let leaf_base = tree_idx * 48 + leaf_idx * 3;
        unsafe { accumulate_scores_unsafe(&mut scores, leaf_base); }
    }

    // Find winning class with fast confidence
    let (max_idx, confidence) = find_winner_fast(&scores);

    (max_idx, confidence, scores)
}

/// Compute leaf index without bounds checks
#[inline(always)]
unsafe fn compute_leaf_unsafe(features: &[f32; 50], base: usize) -> usize {
    let f0 = *SPLIT_FEATURES.get_unchecked(base) as usize;
    let f1 = *SPLIT_FEATURES.get_unchecked(base + 1) as usize;
    let f2 = *SPLIT_FEATURES.get_unchecked(base + 2) as usize;
    let f3 = *SPLIT_FEATURES.get_unchecked(base + 3) as usize;

    let t0 = *SPLIT_THRESHOLDS.get_unchecked(base);
    let t1 = *SPLIT_THRESHOLDS.get_unchecked(base + 1);
    let t2 = *SPLIT_THRESHOLDS.get_unchecked(base + 2);
    let t3 = *SPLIT_THRESHOLDS.get_unchecked(base + 3);

    ((*features.get_unchecked(f0) > t0) as usize) |
    ((*features.get_unchecked(f1) > t1) as usize) << 1 |
    ((*features.get_unchecked(f2) > t2) as usize) << 2 |
    ((*features.get_unchecked(f3) > t3) as usize) << 3
}

/// Accumulate scores without bounds checks
#[inline(always)]
unsafe fn accumulate_scores_unsafe(scores: &mut [f32; 3], leaf_base: usize) {
    scores[0] += *LEAF_VALUES.get_unchecked(leaf_base);
    scores[1] += *LEAF_VALUES.get_unchecked(leaf_base + 1);
    scores[2] += *LEAF_VALUES.get_unchecked(leaf_base + 2);
}

/// Find winner and compute proper softmax confidence (matches JS exactly)
#[inline]
fn find_winner_fast(scores: &[f32; 3]) -> (usize, f32) {
    // Find max score and index
    let mut max_idx = 0;
    let mut max_score = scores[0];
    for i in 1..3 {
        if scores[i] > max_score {
            max_score = scores[i];
            max_idx = i;
        }
    }

    // Proper stable softmax (matches JS implementation)
    // Subtract max for numerical stability
    let exp0 = (scores[0] - max_score).exp();
    let exp1 = (scores[1] - max_score).exp();
    let exp2 = (scores[2] - max_score).exp();
    let sum_exp = exp0 + exp1 + exp2;

    let confidence = match max_idx {
        0 => exp0 / sum_exp,
        1 => exp1 / sum_exp,
        _ => exp2 / sum_exp,
    };

    (max_idx, confidence)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features_v2::extract_features;
    use crate::catboost::route_catboost;

    #[test]
    fn test_fast_vs_original() {
        let queries = [
            "AuthService",
            "how does authentication work",
            "what calls JwtService",
            "jwt token",
        ];

        for query in &queries {
            let features = extract_features(query);
            let (idx_fast, _, _) = route_catboost_fast(&features);
            let (idx_orig, _, _) = route_catboost(&features);
            assert_eq!(idx_fast, idx_orig, "Mismatch for query: {}", query);
        }
    }

}
