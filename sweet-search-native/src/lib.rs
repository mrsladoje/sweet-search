//! Sweet Search native addon — MaxSim kernel + tokenizer + future pipelines.
//!
//! MaxSim: Scores candidates in parallel across CPU cores (rayon + NEON/AVX2).
//! Tokenizer: HuggingFace `tokenizers` crate for native tokenization.
//!
//! Falls back gracefully: native > WASM SIMD > JS

mod tokenizer;
mod sparse_gram;
mod regex_literals;
mod native_grep;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;

/// Compute MaxSim score for one candidate.
/// query_norms[qi] = pre-computed L2 norm of query token qi.
fn maxsim_one(
    query: &[f32],     // Q × dim flat
    query_norms: &[f32], // Q norms
    num_q: usize,
    doc: &[f32],       // D × dim flat (dequantized)
    num_d: usize,
    dim: usize,
) -> f32 {
    let mut total: f32 = 0.0;

    for qi in 0..num_q {
        let q_slice = &query[qi * dim..(qi + 1) * dim];
        let q_norm = query_norms[qi];
        let mut best: f32 = -1.0;

        for di in 0..num_d {
            let d_slice = &doc[di * dim..(di + 1) * dim];
            let mut dot: f32 = 0.0;
            let mut d_norm_sq: f32 = 0.0;

            for i in 0..dim {
                dot += q_slice[i] * d_slice[i];
                d_norm_sq += d_slice[i] * d_slice[i];
            }

            let sim = dot / (q_norm * d_norm_sq.sqrt() + 1e-8);
            if sim > best {
                best = sim;
            }
        }

        if best > 0.0 {
            total += best;
        }
    }

    total / num_q as f32
}

/// Dequantize int8 to f32: val = (int8 + 128) * scale + min
#[inline(always)]
fn dequantize(int8_data: &[i8], min: f32, scale: f32, out: &mut Vec<f32>) {
    out.clear();
    out.reserve(int8_data.len());
    for &v in int8_data {
        out.push((v as f32 + 128.0) * scale + min);
    }
}

/// Candidate data passed from JS
#[napi(object)]
pub struct MaxSimCandidate {
    /// Raw int8 token data
    pub tokens: Buffer,
    /// Number of tokens
    pub num_tokens: u32,
    /// Token dimension
    pub dim: u32,
    /// Quantization min
    pub min: f64,
    /// Quantization scale
    pub scale: f64,
}

/// Score all candidates in parallel using rayon.
///
/// Returns an array of MaxSim scores (one per candidate).
/// Each candidate is dequantized and scored against the query tokens
/// on a separate thread.
#[napi]
pub fn maxsim_score_batch(
    query_flat: Float32Array,
    num_q: u32,
    dim: u32,
    candidates: Vec<MaxSimCandidate>,
) -> Vec<f64> {
    let query = query_flat.as_ref();
    let num_q = num_q as usize;
    let dim = dim as usize;

    // Pre-compute query norms (shared across all candidates)
    let mut query_norms = vec![0.0f32; num_q];
    for qi in 0..num_q {
        let q_slice = &query[qi * dim..(qi + 1) * dim];
        let mut norm_sq: f32 = 0.0;
        for &v in q_slice {
            norm_sq += v * v;
        }
        query_norms[qi] = norm_sq.sqrt();
    }

    // Extract raw data from napi types (napi Buffer isn't Send, so extract first)
    let cand_data: Vec<(Vec<i8>, usize, usize, f32, f32)> = candidates
        .iter()
        .map(|c| {
            let int8: Vec<i8> = c.tokens.iter().map(|&b| b as i8).collect();
            (int8, c.num_tokens as usize, c.dim as usize, c.min as f32, c.scale as f32)
        })
        .collect();

    // Score ALL candidates in parallel with rayon
    cand_data
        .par_iter()
        .map(|(int8_data, num_d, d, min, scale)| {
            // Dequantize on this thread (thread-local allocation)
            let mut doc_f32 = Vec::with_capacity(*num_d * *d);
            dequantize(int8_data, *min, *scale, &mut doc_f32);

            let score = maxsim_one(query, &query_norms, num_q, &doc_f32, *num_d, *d);
            score as f64
        })
        .collect()
}

/// Single-candidate MaxSim score (for benchmarking / fallback).
#[napi]
pub fn maxsim_score_single(
    query_flat: Float32Array,
    doc_flat: Float32Array,
    num_q: u32,
    num_d: u32,
    dim: u32,
) -> f64 {
    let query = query_flat.as_ref();
    let doc = doc_flat.as_ref();
    let num_q = num_q as usize;
    let num_d = num_d as usize;
    let dim = dim as usize;

    let mut query_norms = vec![0.0f32; num_q];
    for qi in 0..num_q {
        let q_slice = &query[qi * dim..(qi + 1) * dim];
        let mut norm_sq: f32 = 0.0;
        for &v in q_slice {
            norm_sq += v * v;
        }
        query_norms[qi] = norm_sq.sqrt();
    }

    maxsim_one(query, &query_norms, num_q, doc, num_d, dim) as f64
}
