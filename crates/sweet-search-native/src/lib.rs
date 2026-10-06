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
mod grep_file_cache;
mod hnsw_search;
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
    qb: &QueryBlock,
    num_d: usize,
    stored_norms: Option<&[f32]>,
    mut fill_tile: F,
) -> f32 {
    #[cfg(target_arch = "aarch64")]
    if qb.dim % 4 == 0 {
        return maxsim_tiled_neon(qb, num_d, stored_norms, fill_tile);
    }
    let (query, query_norms, num_q, dim) = (qb.query, &qb.norms[..qb.num_q], qb.num_q, qb.dim);
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

/// Query tokens once per batch: the raw rows and norms for the portable
/// kernel, plus a copy padded to a multiple of 4 rows (zero rows, norm 1) for
/// the NEON 4×4 blocks. Built on the calling thread and shared read-only by
/// every candidate of the batch.
struct QueryBlock<'a> {
    query: &'a [f32],
    num_q: usize,
    dim: usize,
    /// `num_q` real norms followed by 1.0 padding.
    norms: Vec<f32>,
    #[cfg_attr(not(target_arch = "aarch64"), allow(dead_code))]
    padded: Vec<f32>,
}

impl<'a> QueryBlock<'a> {
    fn new(query: &'a [f32], num_q: usize, dim: usize) -> Self {
        let rows = (num_q + 3) / 4 * 4;
        let mut norms = compute_query_norms(query, num_q, dim);
        norms.resize(rows, 1.0);
        let padded = if cfg!(target_arch = "aarch64") {
            let mut p = Vec::with_capacity(rows * dim);
            p.extend_from_slice(&query[..num_q * dim]);
            p.resize(rows * dim, 0.0);
            p
        } else {
            Vec::new()
        };
        QueryBlock { query, num_q, dim, norms, padded }
    }
}

#[cfg(target_arch = "aarch64")]
thread_local! {
    /// Per-thread dequantization tile, reused across candidates and batches.
    static NEON_TILE: std::cell::RefCell<Vec<f32>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// NEON register-blocked MaxSim (same output contract as `maxsim_tiled`).
///
/// Each 4 query × 4 doc block keeps 16 f32x4 accumulators over the row-major
/// tile, so a pass over `dim` loads 8 vectors per 16 FMAs instead of 2 per 1
/// (the per-pair `dot_f32`). Pairwise adds then fold a block into one f32x4 of
/// four doc similarities for each query row. Padding (query rows to a multiple
/// of 4, doc rows to a multiple of 4) scores 0 and never changes the result:
/// padded query rows are not summed, and a padded doc can only lift a
/// per-query maximum to 0, which contributes 0 either way. Scores drift ≤ ~4e-7
/// relative vs the portable kernel (summation order), ranking-equivalent.
#[cfg(target_arch = "aarch64")]
fn maxsim_tiled_neon<F: FnMut(usize, usize, &mut [f32])>(
    qb: &QueryBlock,
    num_d: usize,
    stored_norms: Option<&[f32]>,
    mut fill_tile: F,
) -> f32 {
    use std::arch::aarch64::*;
    let (num_q, dim) = (qb.num_q, qb.dim);
    let q_rows = qb.norms.len();
    let mut best_stack = [-1.0f32; 64];
    let mut best_heap;
    let best: &mut [f32] = if q_rows <= best_stack.len() {
        &mut best_stack[..q_rows]
    } else {
        best_heap = vec![-1.0f32; q_rows];
        &mut best_heap
    };
    let mut norms_pad = [1.0f32; MAXSIM_TILE];

    NEON_TILE.with(|cell| {
        let mut tile = cell.borrow_mut();
        if tile.len() < MAXSIM_TILE * dim {
            tile.resize(MAXSIM_TILE * dim, 0.0);
        }
        let mut start = 0usize;
        while start < num_d {
            let len = MAXSIM_TILE.min(num_d - start);
            let len_pad = (len + 3) / 4 * 4;
            fill_tile(start, len, &mut tile[..len * dim]);
            tile[len * dim..len_pad * dim].fill(0.0);
            for ti in 0..len {
                norms_pad[ti] = match stored_norms {
                    Some(n) => n[start + ti],
                    None => {
                        let row = &tile[ti * dim..(ti + 1) * dim];
                        dot_f32(row, row).sqrt()
                    }
                };
            }
            norms_pad[len..len_pad].fill(1.0);

            // SAFETY: NEON is baseline on aarch64; dim % 4 == 0 (checked by
            // the caller). Loads stay inside qb.padded (q_rows × dim), the
            // first len_pad rows of the tile, and norms_pad[..len_pad].
            unsafe {
                let eps = vdupq_n_f32(1e-8);
                let mut q0 = 0usize;
                while q0 < q_rows {
                    let qp = qb.padded.as_ptr().add(q0 * dim);
                    let mut bmax = [vdupq_n_f32(-1.0); 4];
                    let mut d0 = 0usize;
                    while d0 < len_pad {
                        let tp = tile.as_ptr().add(d0 * dim);
                        let mut acc = [[vdupq_n_f32(0.0); 4]; 4];
                        let mut d = 0usize;
                        while d < dim {
                            let q = [
                                vld1q_f32(qp.add(d)),
                                vld1q_f32(qp.add(dim + d)),
                                vld1q_f32(qp.add(2 * dim + d)),
                                vld1q_f32(qp.add(3 * dim + d)),
                            ];
                            let t = [
                                vld1q_f32(tp.add(d)),
                                vld1q_f32(tp.add(dim + d)),
                                vld1q_f32(tp.add(2 * dim + d)),
                                vld1q_f32(tp.add(3 * dim + d)),
                            ];
                            for r in 0..4 {
                                for j in 0..4 {
                                    acc[r][j] = vfmaq_f32(acc[r][j], q[r], t[j]);
                                }
                            }
                            d += 4;
                        }
                        let nv = vld1q_f32(norms_pad.as_ptr().add(d0));
                        for r in 0..4 {
                            let dots = vpaddq_f32(
                                vpaddq_f32(acc[r][0], acc[r][1]),
                                vpaddq_f32(acc[r][2], acc[r][3]),
                            );
                            let qn = vdupq_n_f32(qb.norms[q0 + r]);
                            let sim = vdivq_f32(dots, vaddq_f32(vmulq_f32(qn, nv), eps));
                            // maxnm: a NaN similarity never wins, as with `sim > b`.
                            bmax[r] = vmaxnmq_f32(bmax[r], sim);
                        }
                        d0 += 4;
                    }
                    for r in 0..4 {
                        let m = vmaxnmvq_f32(bmax[r]);
                        if m > best[q0 + r] {
                            best[q0 + r] = m;
                        }
                    }
                    q0 += 4;
                }
            }
            start += len;
        }
    });

    let mut total = 0.0f32;
    for &b in &best[..num_q] {
        if b > 0.0 {
            total += b;
        }
    }
    total / num_q as f32
}

/// Dequantize int4 nibble rows `[start, start+len)` into `tile` (row-major).
/// Values are bit-identical to the scalar `nib * scale + min`.
#[inline(always)]
fn dequant_int4_rows(packed: &[u8], mins: &[f32], scales: &[f32], dim: usize, start: usize, len: usize, tile: &mut [f32]) {
    let packed_dim = (dim + 1) / 2;
    #[cfg(target_arch = "aarch64")]
    if dim % 32 == 0 {
        use std::arch::aarch64::*;
        for ti in 0..len {
            let t = start + ti;
            let row = &packed[t * packed_dim..(t + 1) * packed_dim];
            let dst = &mut tile[ti * dim..(ti + 1) * dim];
            // SAFETY: dim % 32 == 0, so the row is whole 16-byte chunks and
            // dst is whole 32-float chunks.
            unsafe {
                let sv = vdupq_n_f32(scales[t]);
                let mv = vdupq_n_f32(mins[t]);
                let mask = vdupq_n_u8(0x0F);
                let mut b = 0usize;
                while b < packed_dim {
                    let bytes = vld1q_u8(row.as_ptr().add(b));
                    let lo = vandq_u8(bytes, mask);
                    let hi = vshrq_n_u8::<4>(bytes);
                    // Low nibble first: element 2p = lo, 2p+1 = hi.
                    let halves = [vzip1q_u8(lo, hi), vzip2q_u8(lo, hi)];
                    let out = dst.as_mut_ptr().add(b * 2);
                    for (h, nib) in halves.iter().enumerate() {
                        let w0 = vmovl_u8(vget_low_u8(*nib));
                        let w1 = vmovl_high_u8(*nib);
                        let quads = [vmovl_u16(vget_low_u16(w0)), vmovl_high_u16(w0), vmovl_u16(vget_low_u16(w1)), vmovl_high_u16(w1)];
                        for (k, v) in quads.iter().enumerate() {
                            // mul then add (no FMA): same rounding as the scalar path.
                            let f = vaddq_f32(vmulq_f32(vcvtq_f32_u32(*v), sv), mv);
                            vst1q_f32(out.add(h * 16 + k * 4), f);
                        }
                    }
                    b += 16;
                }
            }
        }
        return;
    }
    let pairs = dim / 2;
    for ti in 0..len {
        let t = start + ti;
        let row = &packed[t * packed_dim..(t + 1) * packed_dim];
        let tmin = mins[t];
        let tscale = scales[t];
        let dst = &mut tile[ti * dim..(ti + 1) * dim];
        for p in 0..pairs {
            let byte = row[p];
            dst[2 * p] = (byte & 0x0F) as f32 * tscale + tmin;
            dst[2 * p + 1] = ((byte >> 4) & 0x0F) as f32 * tscale + tmin;
        }
        if dim % 2 == 1 {
            dst[dim - 1] = (row[pairs] & 0x0F) as f32 * tscale + tmin;
        }
    }
}

/// Dequantize int8 rows into `tile`: per-token min/scale (`per_token`) or one
/// pair for the whole doc (1-element slices). Bit-identical to the scalar
/// `(x + 128) * scale + min`.
#[inline(always)]
fn dequant_int8_rows(int8: &[i8], mins: &[f32], scales: &[f32], per_token: bool, dim: usize, start: usize, len: usize, tile: &mut [f32]) {
    #[cfg(target_arch = "aarch64")]
    if dim % 16 == 0 {
        use std::arch::aarch64::*;
        for ti in 0..len {
            let t = start + ti;
            let pi = if per_token { t } else { 0 };
            let src = &int8[t * dim..(t + 1) * dim];
            let dst = &mut tile[ti * dim..(ti + 1) * dim];
            // SAFETY: dim % 16 == 0; src and dst hold exactly dim elements.
            unsafe {
                let sv = vdupq_n_f32(scales[pi]);
                let mv = vdupq_n_f32(mins[pi]);
                let c128 = vdupq_n_f32(128.0);
                let mut d = 0usize;
                while d < dim {
                    let v = vld1q_s8(src.as_ptr().add(d));
                    let w0 = vmovl_s8(vget_low_s8(v));
                    let w1 = vmovl_high_s8(v);
                    let quads = [vmovl_s16(vget_low_s16(w0)), vmovl_high_s16(w0), vmovl_s16(vget_low_s16(w1)), vmovl_high_s16(w1)];
                    for (k, q) in quads.iter().enumerate() {
                        let f = vaddq_f32(vmulq_f32(vaddq_f32(vcvtq_f32_s32(*q), c128), sv), mv);
                        vst1q_f32(dst.as_mut_ptr().add(d + k * 4), f);
                    }
                    d += 16;
                }
            }
        }
        return;
    }
    for ti in 0..len {
        let t = start + ti;
        let pi = if per_token { t } else { 0 };
        let src = &int8[t * dim..(t + 1) * dim];
        let tmin = mins[pi];
        let tscale = scales[pi];
        let dst = &mut tile[ti * dim..(ti + 1) * dim];
        for d in 0..dim {
            dst[d] = (src[d] as f32 + 128.0) * tscale + tmin;
        }
    }
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

/// Every candidate must have the query's dim: the kernels slice query and doc
/// rows with one stride. A JS error, not a panic (a panic would abort the daemon).
fn check_candidate_dims(dims: impl Iterator<Item = u32>, dim: usize) -> Result<()> {
    for d in dims {
        if d as usize != dim {
            return Err(Error::new(Status::InvalidArg, format!("maxsim: candidate dim {d} != query dim {dim}")));
        }
    }
    Ok(())
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
) -> Result<Vec<f64>> {
    let qb = QueryBlock::new(query_flat.as_ref(), num_q as usize, dim as usize);
    check_candidate_dims(candidates.iter().map(|c| c.dim), qb.dim)?;

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

    Ok(cand_data
        .par_iter()
        .map(|&(int8, num_d, cdim, min, scale)| {
            let (mins, scales) = ([min], [scale]);
            maxsim_tiled(&qb, num_d, None, |start, len, tile| {
                dequant_int8_rows(int8, &mins, &scales, false, cdim, start, len, tile)
            }) as f64
        })
        .collect::<Vec<f64>>())
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
) -> Result<Vec<f64>> {
    let qb = QueryBlock::new(query_flat.as_ref(), num_q as usize, dim as usize);
    check_candidate_dims(candidates.iter().map(|c| c.dim), qb.dim)?;

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

    Ok(cand_data
        .par_iter()
        .map(|&(int8, mins, scales, norms, num_d, cdim)| {
            maxsim_tiled(&qb, num_d, Some(norms), |start, len, tile| {
                dequant_int8_rows(int8, mins, scales, true, cdim, start, len, tile)
            }) as f64
        })
        .collect::<Vec<f64>>())
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
) -> Result<Vec<f64>> {
    let qb = QueryBlock::new(query_flat.as_ref(), num_q as usize, dim as usize);
    check_candidate_dims(candidates.iter().map(|c| c.dim), qb.dim)?;

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

    Ok(cand_data
        .par_iter()
        .map(|&(packed, mins, scales, norms, num_d, cdim)| {
            maxsim_tiled(&qb, num_d, Some(norms), |start, len, tile| {
                dequant_int4_rows(packed, mins, scales, cdim, start, len, tile)
            }) as f64
        })
        .collect::<Vec<f64>>())
}
