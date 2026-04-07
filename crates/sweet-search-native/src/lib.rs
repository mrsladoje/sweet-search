//! Sweet Search native addon — MaxSim kernel + tokenizer + future pipelines.
//!
//! MaxSim: Scores candidates in parallel across CPU cores (rayon + NEON/AVX2).
//! Tokenizer: HuggingFace `tokenizers` crate for native tokenization.
//!
//! Falls back gracefully: native > WASM SIMD > JS

// In test builds the crate type is lib (not cdylib), so #[napi]-exported
// functions/structs and everything they transitively reference appear unused.
// All warned items are reachable from JS in the production cdylib build.
#![cfg_attr(test, allow(dead_code, unreachable_code))]

mod tokenizer;
mod simd_intersect;
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

/// Dequantize int8 with per-token min/scale arrays.
#[inline(always)]
fn dequantize_per_token(
    int8_data: &[i8], min_arr: &[f32], scale_arr: &[f32],
    num_tokens: usize, dim: usize, out: &mut Vec<f32>,
) {
    out.clear();
    out.reserve(num_tokens * dim);
    for t in 0..num_tokens {
        let off = t * dim;
        let tmin = min_arr[t];
        let tscale = scale_arr[t];
        for d in 0..dim {
            out.push((int8_data[off + d] as f32 + 128.0) * tscale + tmin);
        }
    }
}

/// Dequantize 4-bit nibble-packed data with per-token min/scale.
/// Packing: low nibble = even index, high nibble = odd index.
#[inline(always)]
fn dequantize_4bit_per_token(
    packed: &[u8], min_arr: &[f32], scale_arr: &[f32],
    num_tokens: usize, dim: usize, out: &mut Vec<f32>,
) {
    out.clear();
    out.reserve(num_tokens * dim);
    let packed_dim = (dim + 1) / 2;
    for t in 0..num_tokens {
        let p_off = t * packed_dim;
        let tmin = min_arr[t];
        let tscale = scale_arr[t];
        for d in (0..dim).step_by(2) {
            let byte = packed[p_off + d / 2];
            out.push((byte & 0x0F) as f32 * tscale + tmin);
            if d + 1 < dim {
                out.push(((byte >> 4) & 0x0F) as f32 * tscale + tmin);
            }
        }
    }
}

/// MaxSim with pre-stored document token norms (avoids redundant d_norm_sq).
/// Saves ~40% inner-loop FLOPs when Q=32: d_norm_sq computed D times instead of Q*D.
fn maxsim_one_with_norms(
    query: &[f32],
    query_norms: &[f32],
    num_q: usize,
    doc: &[f32],
    doc_norms: &[f32],
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

            for i in 0..dim {
                dot += q_slice[i] * d_slice[i];
            }

            let sim = dot / (q_norm * doc_norms[di] + 1e-8);
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

/// Candidate with per-token min/scale arrays and pre-stored norms.
#[napi(object)]
pub struct MaxSimCandidatePerToken {
    pub tokens: Buffer,
    pub num_tokens: u32,
    pub dim: u32,
    pub min_array: Float32Array,
    pub scale_array: Float32Array,
    pub token_norms: Float32Array,
}

/// Batch scoring with per-token quantization and pre-stored norms.
/// Eliminates redundant d_norm_sq computation (~40% fewer inner-loop FLOPs).
#[napi]
pub fn maxsim_score_batch_pertoken(
    query_flat: Float32Array,
    num_q: u32,
    dim: u32,
    candidates: Vec<MaxSimCandidatePerToken>,
) -> Vec<f64> {
    let query = query_flat.as_ref();
    let num_q = num_q as usize;
    let dim = dim as usize;

    let mut query_norms = vec![0.0f32; num_q];
    for qi in 0..num_q {
        let q_slice = &query[qi * dim..(qi + 1) * dim];
        let mut norm_sq: f32 = 0.0;
        for &v in q_slice { norm_sq += v * v; }
        query_norms[qi] = norm_sq.sqrt();
    }

    let cand_data: Vec<(Vec<i8>, Vec<f32>, Vec<f32>, Vec<f32>, usize, usize)> = candidates
        .iter()
        .map(|c| {
            let int8: Vec<i8> = c.tokens.iter().map(|&b| b as i8).collect();
            let mins: Vec<f32> = c.min_array.as_ref().to_vec();
            let scales: Vec<f32> = c.scale_array.as_ref().to_vec();
            let norms: Vec<f32> = c.token_norms.as_ref().to_vec();
            (int8, mins, scales, norms, c.num_tokens as usize, c.dim as usize)
        })
        .collect();

    cand_data
        .par_iter()
        .map(|(int8_data, mins, scales, norms, num_d, d)| {
            let mut doc_f32 = Vec::with_capacity(*num_d * *d);
            dequantize_per_token(int8_data, mins, scales, *num_d, *d, &mut doc_f32);
            let score = maxsim_one_with_norms(query, &query_norms, num_q, &doc_f32, norms, *num_d, *d);
            score as f64
        })
        .collect()
}

/// Candidate with 4-bit nibble-packed tokens, per-token min/scale, and norms.
#[napi(object)]
pub struct MaxSimCandidate4Bit {
    pub tokens: Buffer,
    pub num_tokens: u32,
    pub dim: u32,
    pub min_array: Float32Array,
    pub scale_array: Float32Array,
    pub token_norms: Float32Array,
}

/// Batch scoring with 4-bit quantization, per-token params, and pre-stored norms.
/// Nibble unpack + dequant + MaxSim with norm reuse.
#[napi]
pub fn maxsim_score_batch_4bit(
    query_flat: Float32Array,
    num_q: u32,
    dim: u32,
    candidates: Vec<MaxSimCandidate4Bit>,
) -> Vec<f64> {
    let query = query_flat.as_ref();
    let num_q = num_q as usize;
    let dim = dim as usize;

    let mut query_norms = vec![0.0f32; num_q];
    for qi in 0..num_q {
        let q_slice = &query[qi * dim..(qi + 1) * dim];
        let mut norm_sq: f32 = 0.0;
        for &v in q_slice { norm_sq += v * v; }
        query_norms[qi] = norm_sq.sqrt();
    }

    let cand_data: Vec<(Vec<u8>, Vec<f32>, Vec<f32>, Vec<f32>, usize, usize)> = candidates
        .iter()
        .map(|c| {
            let packed: Vec<u8> = c.tokens.to_vec();
            let mins: Vec<f32> = c.min_array.as_ref().to_vec();
            let scales: Vec<f32> = c.scale_array.as_ref().to_vec();
            let norms: Vec<f32> = c.token_norms.as_ref().to_vec();
            (packed, mins, scales, norms, c.num_tokens as usize, c.dim as usize)
        })
        .collect();

    cand_data
        .par_iter()
        .map(|(packed, mins, scales, norms, num_d, d)| {
            let mut doc_f32 = Vec::with_capacity(*num_d * *d);
            dequantize_4bit_per_token(packed, mins, scales, *num_d, *d, &mut doc_f32);
            let score = maxsim_one_with_norms(query, &query_norms, num_q, &doc_f32, norms, *num_d, *d);
            score as f64
        })
        .collect()
}
