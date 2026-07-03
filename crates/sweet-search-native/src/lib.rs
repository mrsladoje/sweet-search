//! Sweet Search native addon — MaxSim kernel + tokenizer + future pipelines.
//!
//! MaxSim: Scores candidates in parallel across CPU cores (rayon), with
//! explicit SIMD dot products (NEON on aarch64, runtime-detected AVX2+FMA on
//! x86_64) over L1-tiled dequantized doc tokens.
//! Tokenizer: HuggingFace `tokenizers` crate for native tokenization.
//!
//! Falls back gracefully: native > WASM SIMD > JS

// In test builds the crate type is lib (not cdylib), so #[napi]-exported
// functions/structs and everything they transitively reference appear unused.
// All warned items are reachable from JS in the production cdylib build.
#![cfg_attr(test, allow(dead_code, unreachable_code))]

mod dedup;
mod inference;
mod native_grep;
mod regex_literals;
mod simd_intersect;
mod sparse_gram;
mod tokenizer;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;

// =============================================================================
// SIMD dot product
// =============================================================================
//
// The dot products below reassociate the f32 sum across 4 partial accumulators
// (and FMA rounding on supporting CPUs). Scores therefore drift at ~1e-7
// relative vs the previous strictly-sequential kernels — ranking-equivalent,
// not bit-identical.

/// Scalar dot with 4 partial accumulators (fallback / non-SIMD arches).
#[inline(always)]
#[allow(dead_code)]
fn dot_scalar(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let (mut s0, mut s1, mut s2, mut s3) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    let mut i = 0usize;
    while i + 4 <= n {
        s0 += a[i] * b[i];
        s1 += a[i + 1] * b[i + 1];
        s2 += a[i + 2] * b[i + 2];
        s3 += a[i + 3] * b[i + 3];
        i += 4;
    }
    let mut dot = (s0 + s1) + (s2 + s3);
    while i < n {
        dot += a[i] * b[i];
        i += 1;
    }
    dot
}

/// NEON dot: 4 × f32x4 accumulators (16 floats/iter) + FMA.
#[cfg(target_arch = "aarch64")]
#[inline(always)]
fn dot_f32(a: &[f32], b: &[f32]) -> f32 {
    use std::arch::aarch64::*;
    let n = a.len().min(b.len());
    // SAFETY: NEON is baseline on aarch64; all loads stay within `n` elements
    // of both slices.
    unsafe {
        let mut acc0 = vdupq_n_f32(0.0);
        let mut acc1 = vdupq_n_f32(0.0);
        let mut acc2 = vdupq_n_f32(0.0);
        let mut acc3 = vdupq_n_f32(0.0);
        let mut i = 0usize;
        while i + 16 <= n {
            let pa = a.as_ptr().add(i);
            let pb = b.as_ptr().add(i);
            acc0 = vfmaq_f32(acc0, vld1q_f32(pa), vld1q_f32(pb));
            acc1 = vfmaq_f32(acc1, vld1q_f32(pa.add(4)), vld1q_f32(pb.add(4)));
            acc2 = vfmaq_f32(acc2, vld1q_f32(pa.add(8)), vld1q_f32(pb.add(8)));
            acc3 = vfmaq_f32(acc3, vld1q_f32(pa.add(12)), vld1q_f32(pb.add(12)));
            i += 16;
        }
        while i + 4 <= n {
            acc0 = vfmaq_f32(acc0, vld1q_f32(a.as_ptr().add(i)), vld1q_f32(b.as_ptr().add(i)));
            i += 4;
        }
        let mut dot = vaddvq_f32(vaddq_f32(vaddq_f32(acc0, acc1), vaddq_f32(acc2, acc3)));
        while i < n {
            dot += a[i] * b[i];
            i += 1;
        }
        dot
    }
}

/// AVX2+FMA dot: 4 × f32x8 accumulators (32 floats/iter).
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
unsafe fn dot_avx2_fma(a: &[f32], b: &[f32]) -> f32 {
    use std::arch::x86_64::*;
    let n = a.len().min(b.len());
    let mut acc0 = _mm256_setzero_ps();
    let mut acc1 = _mm256_setzero_ps();
    let mut acc2 = _mm256_setzero_ps();
    let mut acc3 = _mm256_setzero_ps();
    let mut i = 0usize;
    while i + 32 <= n {
        let pa = a.as_ptr().add(i);
        let pb = b.as_ptr().add(i);
        acc0 = _mm256_fmadd_ps(_mm256_loadu_ps(pa), _mm256_loadu_ps(pb), acc0);
        acc1 = _mm256_fmadd_ps(_mm256_loadu_ps(pa.add(8)), _mm256_loadu_ps(pb.add(8)), acc1);
        acc2 = _mm256_fmadd_ps(_mm256_loadu_ps(pa.add(16)), _mm256_loadu_ps(pb.add(16)), acc2);
        acc3 = _mm256_fmadd_ps(_mm256_loadu_ps(pa.add(24)), _mm256_loadu_ps(pb.add(24)), acc3);
        i += 32;
    }
    while i + 8 <= n {
        acc0 = _mm256_fmadd_ps(
            _mm256_loadu_ps(a.as_ptr().add(i)),
            _mm256_loadu_ps(b.as_ptr().add(i)),
            acc0,
        );
        i += 8;
    }
    let sum = _mm256_add_ps(_mm256_add_ps(acc0, acc1), _mm256_add_ps(acc2, acc3));
    let s = _mm_add_ps(_mm256_castps256_ps128(sum), _mm256_extractf128_ps(sum, 1));
    let s = _mm_add_ps(s, _mm_movehl_ps(s, s));
    let s = _mm_add_ss(s, _mm_shuffle_ps(s, s, 1));
    let mut dot = _mm_cvtss_f32(s);
    while i < n {
        dot += a[i] * b[i];
        i += 1;
    }
    dot
}

/// x86_64 dot: AVX2+FMA when the CPU has it (detected once), scalar otherwise.
#[cfg(target_arch = "x86_64")]
#[inline(always)]
fn dot_f32(a: &[f32], b: &[f32]) -> f32 {
    use std::sync::OnceLock;
    static HAVE_AVX2_FMA: OnceLock<bool> = OnceLock::new();
    let have = *HAVE_AVX2_FMA
        .get_or_init(|| is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma"));
    if have {
        // SAFETY: feature presence verified at runtime above.
        unsafe { dot_avx2_fma(a, b) }
    } else {
        dot_scalar(a, b)
    }
}

#[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
#[inline(always)]
fn dot_f32(a: &[f32], b: &[f32]) -> f32 {
    dot_scalar(a, b)
}

// =============================================================================
// Tiled MaxSim core
// =============================================================================

/// Doc tokens per dequantization tile. 64 × dim=128 × 4B = 32 KB of f32 —
/// L1-resident on Apple Silicon, L1/L2-resident on x86 — so every query token
/// re-reads the tile from cache instead of streaming the whole doc from RAM.
const MAXSIM_TILE: usize = 64;

/// Tiled MaxSim over quantized doc tokens.
///
/// `fill_tile(start, len, tile)` dequantizes doc tokens [start, start+len)
/// into `tile` (len × dim f32, row-major). `stored_norms` are the
/// pre-quantization per-token L2 norms; `None` computes norms from the
/// dequantized rows (legacy per-doc-min/scale path).
///
/// Output contract (unchanged): mean over query tokens of
/// `max(0, max_di dot(q, d_di) / (||q||·||d_di|| + 1e-8))`. Doc-token maxima
/// are order-invariant, the final sum runs in ascending-qi order, and the
/// per-query best is seeded at -1.0 exactly like the untiled kernels.
fn maxsim_tiled<F: FnMut(usize, usize, &mut [f32])>(
    query: &[f32],
    query_norms: &[f32],
    num_q: usize,
    num_d: usize,
    dim: usize,
    stored_norms: Option<&[f32]>,
    mut fill_tile: F,
) -> f32 {
    let tile_rows = MAXSIM_TILE.min(num_d.max(1));
    let mut tile = vec![0.0f32; tile_rows * dim];
    let mut computed_norms = if stored_norms.is_none() {
        vec![0.0f32; tile_rows]
    } else {
        Vec::new()
    };
    let mut best = vec![-1.0f32; num_q];

    let mut start = 0usize;
    while start < num_d {
        let len = MAXSIM_TILE.min(num_d - start);
        fill_tile(start, len, &mut tile[..len * dim]);

        if stored_norms.is_none() {
            for ti in 0..len {
                let row = &tile[ti * dim..(ti + 1) * dim];
                computed_norms[ti] = dot_f32(row, row).sqrt();
            }
        }
        let norms_slice: &[f32] = match stored_norms {
            Some(n) => &n[start..start + len],
            None => &computed_norms[..len],
        };

        for qi in 0..num_q {
            let q = &query[qi * dim..(qi + 1) * dim];
            let q_norm = query_norms[qi];
            let mut b = best[qi];
            for ti in 0..len {
                let row = &tile[ti * dim..(ti + 1) * dim];
                let sim = dot_f32(q, row) / (q_norm * norms_slice[ti] + 1e-8);
                if sim > b {
                    b = sim;
                }
            }
            best[qi] = b;
        }

        start += len;
    }

    let mut total = 0.0f32;
    for &b in &best {
        if b > 0.0 {
            total += b;
        }
    }
    total / num_q as f32
}

/// MaxSim over already-dequantized f32 doc tokens (single-candidate path).
fn maxsim_f32(
    query: &[f32],
    query_norms: &[f32],
    num_q: usize,
    doc: &[f32],
    num_d: usize,
    dim: usize,
) -> f32 {
    let mut doc_norms = vec![0.0f32; num_d];
    for di in 0..num_d {
        let row = &doc[di * dim..(di + 1) * dim];
        doc_norms[di] = dot_f32(row, row).sqrt();
    }

    let mut total: f32 = 0.0;
    for qi in 0..num_q {
        let q = &query[qi * dim..(qi + 1) * dim];
        let q_norm = query_norms[qi];
        let mut best: f32 = -1.0;
        for di in 0..num_d {
            let row = &doc[di * dim..(di + 1) * dim];
            let sim = dot_f32(q, row) / (q_norm * doc_norms[di] + 1e-8);
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

fn compute_query_norms(query: &[f32], num_q: usize, dim: usize) -> Vec<f32> {
    let mut query_norms = vec![0.0f32; num_q];
    for qi in 0..num_q {
        let q = &query[qi * dim..(qi + 1) * dim];
        query_norms[qi] = dot_f32(q, q).sqrt();
    }
    query_norms
}

/// Reinterpret a byte slice as i8 without copying (`u8 as i8` is the same bit
/// pattern this view produces).
#[inline(always)]
fn bytes_as_i8(bytes: &[u8]) -> &[i8] {
    // SAFETY: u8 and i8 have identical size/alignment.
    unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const i8, bytes.len()) }
}

// =============================================================================
// NAPI entry points
// =============================================================================
//
// All batch entry points borrow the JS-owned buffers directly (`&[u8]` /
// `&[f32]` are Send) instead of copying them: the functions are synchronous,
// so the JS thread is blocked for the whole call and V8 cannot collect or
// move the backing stores while rayon workers read them.

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
/// Each candidate is dequantized tile-by-tile and scored against the query
/// tokens on a separate thread.
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
    let query_norms = compute_query_norms(query, num_q, dim);

    let cand_data: Vec<(&[i8], usize, usize, f32, f32)> = candidates
        .iter()
        .map(|c| {
            let num_d = c.num_tokens as usize;
            let cdim = c.dim as usize;
            let tokens: &[u8] = c.tokens.as_ref();
            assert!(tokens.len() >= num_d * cdim, "maxsim: tokens buffer too small");
            (bytes_as_i8(tokens), num_d, cdim, c.min as f32, c.scale as f32)
        })
        .collect();

    cand_data
        .par_iter()
        .map(|&(int8, num_d, cdim, min, scale)| {
            maxsim_tiled(query, &query_norms, num_q, num_d, cdim, None, |start, len, tile| {
                for ti in 0..len {
                    let src = &int8[(start + ti) * cdim..(start + ti + 1) * cdim];
                    let dst = &mut tile[ti * cdim..(ti + 1) * cdim];
                    for d in 0..cdim {
                        dst[d] = (src[d] as f32 + 128.0) * scale + min;
                    }
                }
            }) as f64
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
    let query_norms = compute_query_norms(query, num_q, dim);
    maxsim_f32(query, &query_norms, num_q, doc, num_d, dim) as f64
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
    let query_norms = compute_query_norms(query, num_q, dim);

    let cand_data: Vec<(&[i8], &[f32], &[f32], &[f32], usize, usize)> = candidates
        .iter()
        .map(|c| {
            let num_d = c.num_tokens as usize;
            let cdim = c.dim as usize;
            let tokens: &[u8] = c.tokens.as_ref();
            let mins: &[f32] = c.min_array.as_ref();
            let scales: &[f32] = c.scale_array.as_ref();
            let norms: &[f32] = c.token_norms.as_ref();
            assert!(tokens.len() >= num_d * cdim, "maxsim: tokens buffer too small");
            assert!(
                mins.len() >= num_d && scales.len() >= num_d && norms.len() >= num_d,
                "maxsim: per-token arrays too small"
            );
            (bytes_as_i8(tokens), mins, scales, norms, num_d, cdim)
        })
        .collect();

    cand_data
        .par_iter()
        .map(|&(int8, mins, scales, norms, num_d, cdim)| {
            maxsim_tiled(
                query,
                &query_norms,
                num_q,
                num_d,
                cdim,
                Some(norms),
                |start, len, tile| {
                    for ti in 0..len {
                        let t = start + ti;
                        let src = &int8[t * cdim..(t + 1) * cdim];
                        let tmin = mins[t];
                        let tscale = scales[t];
                        let dst = &mut tile[ti * cdim..(ti + 1) * cdim];
                        for d in 0..cdim {
                            dst[d] = (src[d] as f32 + 128.0) * tscale + tmin;
                        }
                    }
                },
            ) as f64
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

/// Batch scoring with 4-bit quantization, per-token params, and pre-stored
/// norms. Nibbles dequantize per tile as `nib * scale + min` (identical values
/// to the previous per-token LUT, computed once per doc token instead of once
/// per query token × doc token).
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
    let query_norms = compute_query_norms(query, num_q, dim);

    let cand_data: Vec<(&[u8], &[f32], &[f32], &[f32], usize, usize)> = candidates
        .iter()
        .map(|c| {
            let num_d = c.num_tokens as usize;
            let cdim = c.dim as usize;
            let packed_dim = (cdim + 1) / 2;
            let tokens: &[u8] = c.tokens.as_ref();
            let mins: &[f32] = c.min_array.as_ref();
            let scales: &[f32] = c.scale_array.as_ref();
            let norms: &[f32] = c.token_norms.as_ref();
            assert!(tokens.len() >= num_d * packed_dim, "maxsim: packed buffer too small");
            assert!(
                mins.len() >= num_d && scales.len() >= num_d && norms.len() >= num_d,
                "maxsim: per-token arrays too small"
            );
            (tokens, mins, scales, norms, num_d, cdim)
        })
        .collect();

    cand_data
        .par_iter()
        .map(|&(packed, mins, scales, norms, num_d, cdim)| {
            let packed_dim = (cdim + 1) / 2;
            maxsim_tiled(
                query,
                &query_norms,
                num_q,
                num_d,
                cdim,
                Some(norms),
                |start, len, tile| {
                    let pairs = cdim / 2;
                    for ti in 0..len {
                        let t = start + ti;
                        let row = &packed[t * packed_dim..(t + 1) * packed_dim];
                        let tmin = mins[t];
                        let tscale = scales[t];
                        let dst = &mut tile[ti * cdim..(ti + 1) * cdim];
                        for p in 0..pairs {
                            let byte = row[p];
                            dst[2 * p] = (byte & 0x0F) as f32 * tscale + tmin;
                            dst[2 * p + 1] = ((byte >> 4) & 0x0F) as f32 * tscale + tmin;
                        }
                        if cdim % 2 == 1 {
                            dst[cdim - 1] = (row[pairs] & 0x0F) as f32 * tscale + tmin;
                        }
                    }
                },
            ) as f64
        })
        .collect()
}
