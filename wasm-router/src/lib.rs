//! Ultra-fast Query Router for Code Search
//!
//! Target: <5μs per query (vs 237μs in JS)
//!
//! Architecture:
//! 1. Single-pass feature extraction with keyword bitmap (v2)
//! 2. Zero-allocation pattern matching
//! 3. CatBoost decision tree (499 trees, depth 4)
//! 4. Allocation-free reject option

use wasm_bindgen::prelude::*;

mod features;
mod features_v2;
mod catboost;
mod catboost_v2;
mod keywords;

pub use features_v2::extract_features;
pub use catboost_v2::route_catboost_fast as route_catboost;

/// Route labels
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum RouteMode {
    Lexical = 0,
    Semantic = 1,
    Structural = 2,
    Hybrid = 3,
}

impl RouteMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            RouteMode::Lexical => "lexical",
            RouteMode::Semantic => "semantic",
            RouteMode::Structural => "structural",
            RouteMode::Hybrid => "hybrid",
        }
    }
}

/// Routing result
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct RouteResult {
    pub mode: RouteMode,
    pub confidence: f32,
    pub rejected: bool,
}

#[wasm_bindgen]
impl RouteResult {
    #[wasm_bindgen(getter)]
    pub fn mode_str(&self) -> String {
        self.mode.as_str().to_string()
    }
}

/// Export features for debugging
#[wasm_bindgen]
pub fn extract_features_js(query: &str) -> Vec<f32> {
    let features = features_v2::extract_features(query);
    features.to_vec()
}

/// Main entry point - route a query string
#[wasm_bindgen]
pub fn route_query(query: &str) -> RouteResult {
    // Extract features (single-pass, optimized v2)
    let features = features_v2::extract_features(query);

    // Run CatBoost inference (optimized v2)
    let (mode_idx, confidence, scores) = catboost_v2::route_catboost_fast(&features);

    // Apply reject option
    let (final_mode, rejected) = apply_reject_option(mode_idx, confidence, &scores);

    RouteResult {
        mode: final_mode,
        confidence,
        rejected,
    }
}

/// Reject option thresholds (per class)
const REJECT_THRESHOLDS: [(f32, f32); 4] = [
    (0.92, 0.40),  // LEXICAL: aggressive rejection
    (0.75, 0.25),  // SEMANTIC: moderate
    (0.60, 0.15),  // STRUCTURAL: conservative
    (0.50, 0.10),  // HYBRID: rarely reject
];

/// Apply reject option - fall back to HYBRID when uncertain (zero-allocation)
#[inline]
fn apply_reject_option(mode_idx: usize, confidence: f32, scores: &[f32; 4]) -> (RouteMode, bool) {
    let mode = match mode_idx {
        0 => RouteMode::Lexical,
        1 => RouteMode::Semantic,
        2 => RouteMode::Structural,
        _ => RouteMode::Hybrid,
    };

    // HYBRID never gets rejected
    if mode_idx == 3 {
        return (mode, false);
    }

    let (conf_threshold, margin_threshold) = REJECT_THRESHOLDS[mode_idx];

    // Check confidence
    if confidence < conf_threshold {
        return (RouteMode::Hybrid, true);
    }

    // Find top-2 scores without sorting (zero allocation)
    let (max_score, second_score) = find_top2(scores);
    let margin = max_score - second_score;

    if margin < margin_threshold {
        return (RouteMode::Hybrid, true);
    }

    (mode, false)
}

/// Find top-2 scores without allocation
#[inline(always)]
fn find_top2(scores: &[f32; 4]) -> (f32, f32) {
    let (mut max, mut second) = if scores[0] > scores[1] {
        (scores[0], scores[1])
    } else {
        (scores[1], scores[0])
    };

    for &s in &scores[2..] {
        if s > max {
            second = max;
            max = s;
        } else if s > second {
            second = s;
        }
    }

    (max, second)
}

/// Initialize panic hook for better error messages
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lexical_routing() {
        let result = route_query("AuthService");
        assert_eq!(result.mode, RouteMode::Lexical);
    }

    #[test]
    fn test_semantic_routing() {
        let result = route_query("how does authentication work");
        assert_eq!(result.mode, RouteMode::Semantic);
    }

    #[test]
    fn test_structural_routing() {
        let result = route_query("what calls AuthService");
        assert_eq!(result.mode, RouteMode::Structural);
    }

    #[test]
    fn test_hybrid_routing() {
        let result = route_query("jwt token");
        assert_eq!(result.mode, RouteMode::Hybrid);
    }
}
