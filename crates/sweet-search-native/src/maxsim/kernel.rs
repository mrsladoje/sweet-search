//! MaxSim kernels (pure Rust, no N-API): late-interaction scoring of a query
//! against a batch of quantized candidate documents, in parallel across CPU
//! cores, with explicit SIMD (NEON on aarch64, runtime-detected AVX2+FMA on
//! x86_64) over L1-tiled dequantized doc tokens. `super` (the N-API layer)
//! and the benchmark's C ABI (eval/maxsim-bench/capi) call the public
//! functions at the end of this file.

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

/// AVX2 + FMA present (detected once per process).
#[cfg(target_arch = "x86_64")]
#[inline(always)]
fn have_avx2_fma() -> bool {
    use std::sync::OnceLock;
    static HAVE_AVX2_FMA: OnceLock<bool> = OnceLock::new();
    *HAVE_AVX2_FMA.get_or_init(|| is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma"))
}

/// AVX-512F (with AVX2 + FMA) present (detected once per process).
#[cfg(target_arch = "x86_64")]
#[inline(always)]
fn have_avx512() -> bool {
    use std::sync::OnceLock;
    static HAVE_AVX512: OnceLock<bool> = OnceLock::new();
    *HAVE_AVX512.get_or_init(|| have_avx2_fma() && is_x86_feature_detected!("avx512f"))
}

/// x86_64 dot: AVX2+FMA when the CPU has it, scalar otherwise.
#[cfg(target_arch = "x86_64")]
#[inline(always)]
fn dot_f32(a: &[f32], b: &[f32]) -> f32 {
    if have_avx2_fma() {
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

/// Tiled MaxSim over quantized doc tokens `[from, to)` (`from` a multiple of
/// `MAXSIM_TILE`): raises `best[qi]` to the largest similarity of query token
/// `qi` with any of those doc tokens. `best` holds `qb.norms.len()` entries
/// (padded query rows included), seeded at -1.0; `score_from_best` turns it
/// into the score.
///
/// `fill_tile(start, len, tile)` dequantizes doc tokens [start, start+len)
/// into `tile` (len × dim f32, row-major). `stored_norms` are the
/// pre-quantization per-token L2 norms; `None` computes norms from the
/// dequantized rows (legacy per-doc-min/scale path).
///
/// Output contract (unchanged): mean over query tokens of
/// `max(0, max_di dot(q, d_di) / (||q||·||d_di|| + 1e-8))`. A maximum is
/// exact whatever order it is taken in, so a doc split into several ranges
/// gets the same per-query maxima as one pass over it.
fn maxsim_range<F: FnMut(usize, usize, &mut [f32])>(
    qb: &QueryBlock,
    from: usize,
    to: usize,
    stored_norms: Option<&[f32]>,
    mut fill_tile: F,
    best: &mut [f32],
) {
    #[cfg(target_arch = "aarch64")]
    if qb.dim % 4 == 0 {
        return maxsim_range_neon(qb, from, to, stored_norms, fill_tile, best);
    }
    #[cfg(target_arch = "x86_64")]
    if qb.dim % 8 == 0 && have_avx512() {
        // SAFETY: AVX-512F + AVX2 + FMA verified at runtime.
        return unsafe { maxsim_range_x86::<true, F>(qb, from, to, stored_norms, fill_tile, best) };
    }
    #[cfg(target_arch = "x86_64")]
    if qb.dim % 8 == 0 && have_avx2_fma() {
        // SAFETY: AVX2 + FMA verified at runtime.
        return unsafe { maxsim_range_x86::<false, F>(qb, from, to, stored_norms, fill_tile, best) };
    }
    let (query, query_norms, num_q, dim) = (qb.query, &qb.norms[..qb.num_q], qb.num_q, qb.dim);
    let tile_rows = MAXSIM_TILE.min((to - from).max(1));
    let mut tile = vec![0.0f32; tile_rows * dim];
    let mut computed_norms = if stored_norms.is_none() {
        vec![0.0f32; tile_rows]
    } else {
        Vec::new()
    };

    let mut start = from;
    while start < to {
        let len = MAXSIM_TILE.min(to - start);
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
}

/// The score from per-query-token maxima: mean over the `num_q` real query
/// tokens of `max(0, best)`, summed in ascending query order.
fn score_from_best(best: &[f32], num_q: usize) -> f32 {
    let mut total = 0.0f32;
    for &b in &best[..num_q] {
        if b > 0.0 {
            total += b;
        }
    }
    total / num_q as f32
}

/// Query tokens once per batch: the raw rows and norms for the portable
/// kernel, plus a copy padded to a multiple of 4 rows (zero rows, norm 1) for
/// the NEON 4×4 and AVX2 4×2 blocks. Built on the calling thread and shared
/// read-only by every candidate of the batch.
struct QueryBlock<'a> {
    query: &'a [f32],
    num_q: usize,
    dim: usize,
    /// `num_q` real norms followed by 1.0 padding.
    norms: Vec<f32>,
    #[cfg_attr(not(any(target_arch = "aarch64", target_arch = "x86_64")), allow(dead_code))]
    padded: Vec<f32>,
}

impl<'a> QueryBlock<'a> {
    fn new(query: &'a [f32], num_q: usize, dim: usize) -> Self {
        let rows = (num_q + 3) / 4 * 4;
        let mut norms = compute_query_norms(query, num_q, dim);
        norms.resize(rows, 1.0);
        let padded = if cfg!(any(target_arch = "aarch64", target_arch = "x86_64")) {
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

#[cfg(any(target_arch = "aarch64", target_arch = "x86_64"))]
thread_local! {
    /// Per-thread dequantization tile, reused across candidates and batches.
    static TILE: std::cell::RefCell<Vec<f32>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// NEON register-blocked `maxsim_range`.
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
fn maxsim_range_neon<F: FnMut(usize, usize, &mut [f32])>(
    qb: &QueryBlock,
    from: usize,
    to: usize,
    stored_norms: Option<&[f32]>,
    mut fill_tile: F,
    best: &mut [f32],
) {
    let dim = qb.dim;
    let mut norms_pad = [1.0f32; MAXSIM_TILE];

    TILE.with(|cell| {
        let mut tile = cell.borrow_mut();
        if tile.len() < MAXSIM_TILE * dim {
            tile.resize(MAXSIM_TILE * dim, 0.0);
        }
        let mut start = from;
        while start < to {
            let len = MAXSIM_TILE.min(to - start);
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

            // Full 4-row query blocks, then one block of the 1-3 rows left
            // (padded query rows are never computed).
            let mut q0 = 0usize;
            while q0 < qb.num_q {
                let tp = tile.as_ptr();
                // SAFETY: NEON is baseline on aarch64; dim % 4 == 0 (checked by
                // the caller). Loads stay inside qb.padded (q_rows × dim), the
                // first len_pad rows of the tile, and norms_pad[..len_pad].
                unsafe {
                    match qb.num_q - q0 {
                        1 => neon_rows::<1>(qb, q0, tp, len_pad, &norms_pad, best),
                        2 => neon_rows::<2>(qb, q0, tp, len_pad, &norms_pad, best),
                        3 => neon_rows::<3>(qb, q0, tp, len_pad, &norms_pad, best),
                        _ => neon_rows::<4>(qb, q0, tp, len_pad, &norms_pad, best),
                    }
                }
                q0 += 4;
            }
            start += len;
        }
    });
}

/// One NEON block row of `maxsim_range_neon`: query rows `q0..q0 + R` against
/// tile rows `0..len_pad` in blocks of 4 docs. Each pair is summed the same way
/// for every R (four f32x4 FMA chains over `dim`, then pairwise adds), so a
/// 1-3 row remainder gives the same dots as the padded 4-row block did.
///
/// SAFETY: aarch64 NEON; `dim % 4 == 0`; `tp` holds `len_pad` (a multiple of
/// 4) rows of `dim` floats; `q0 + R <= qb.padded.len() / dim`.
#[cfg(target_arch = "aarch64")]
#[inline(always)]
unsafe fn neon_rows<const R: usize>(qb: &QueryBlock, q0: usize, tp: *const f32, len_pad: usize, norms_pad: &[f32; MAXSIM_TILE], best: &mut [f32]) {
    use std::arch::aarch64::*;
    let dim = qb.dim;
    let eps = vdupq_n_f32(1e-8);
    let qp = qb.padded.as_ptr().add(q0 * dim);
    let mut bmax = [vdupq_n_f32(-1.0); R];
    let mut d0 = 0usize;
    while d0 < len_pad {
        let tp = tp.add(d0 * dim);
        let mut acc = [[vdupq_n_f32(0.0); 4]; R];
        let mut d = 0usize;
        while d < dim {
            let t = [
                vld1q_f32(tp.add(d)),
                vld1q_f32(tp.add(dim + d)),
                vld1q_f32(tp.add(2 * dim + d)),
                vld1q_f32(tp.add(3 * dim + d)),
            ];
            for r in 0..R {
                let q = vld1q_f32(qp.add(r * dim + d));
                for j in 0..4 {
                    acc[r][j] = vfmaq_f32(acc[r][j], q, t[j]);
                }
            }
            d += 4;
        }
        let nv = vld1q_f32(norms_pad.as_ptr().add(d0));
        for r in 0..R {
            let dots = vpaddq_f32(vpaddq_f32(acc[r][0], acc[r][1]), vpaddq_f32(acc[r][2], acc[r][3]));
            let qn = vdupq_n_f32(qb.norms[q0 + r]);
            let sim = vdivq_f32(dots, vaddq_f32(vmulq_f32(qn, nv), eps));
            // maxnm: a NaN similarity never wins, as with `sim > b`.
            bmax[r] = vmaxnmq_f32(bmax[r], sim);
        }
        d0 += 4;
    }
    for r in 0..R {
        let m = vmaxnmvq_f32(bmax[r]);
        if m > best[q0 + r] {
            best[q0 + r] = m;
        }
    }
}

/// AVX2 register-blocked `maxsim_range`, bit-identical to the portable kernel
/// on AVX2 CPUs (the portable kernel with `dot_avx2_fma`).
///
/// `dot_avx2_fma` sums a pair in a fixed order: four 8-lane FMA chains (chain
/// `k` takes the 8 floats at `32m + 8k`; chain 0 also takes the trailing
/// 8-float chunks), then `(c0 + c1) + (c2 + c3)`, then lanes `l` and `l + 4`,
/// then `(s0 + s2) + (s1 + s3)`. This kernel computes the same chains for a 4
/// query × 2 doc block (8 pairs share every q and doc load), keeps each chain
/// in its own accumulators, and does the lane folds for all 8 pairs at once
/// with shuffles — the same additions in the same order, so every dot, every
/// similarity and every score is the same f32. Padding is as in the NEON
/// kernel: zero query rows are not summed, and a zero doc row can only lift a
/// per-query maximum to 0, which contributes 0 either way.
///
/// `W512`: the 4 × 2 block runs with 16-lane registers (`avx512_rows`; the
/// caller verified AVX-512F), with the same chains and the same fold, so the
/// scores are the same f32 as with the 8-lane block (`avx2_rows`).
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
unsafe fn maxsim_range_x86<const W512: bool, F: FnMut(usize, usize, &mut [f32])>(
    qb: &QueryBlock,
    from: usize,
    to: usize,
    stored_norms: Option<&[f32]>,
    mut fill_tile: F,
    best: &mut [f32],
) {
    let dim = qb.dim;
    let mut norms_pad = [1.0f32; MAXSIM_TILE];

    TILE.with(|cell| {
        let mut tile = cell.borrow_mut();
        if tile.len() < MAXSIM_TILE * dim {
            tile.resize(MAXSIM_TILE * dim, 0.0);
        }
        let mut start = from;
        while start < to {
            let len = MAXSIM_TILE.min(to - start);
            let len_pad = (len + 1) / 2 * 2;
            fill_tile(start, len, &mut tile[..len * dim]);
            tile[len * dim..len_pad * dim].fill(0.0);
            for ti in 0..len {
                norms_pad[ti] = match stored_norms {
                    Some(n) => n[start + ti],
                    None => {
                        let row = &tile[ti * dim..(ti + 1) * dim];
                        dot_avx2_fma(row, row).sqrt()
                    }
                };
            }
            norms_pad[len..len_pad].fill(1.0);

            // Full 4-row query blocks, then one block of the 1-3 rows left
            // (padded query rows are never computed).
            let mut q0 = 0usize;
            while q0 < qb.num_q {
                let tp = tile.as_ptr();
                match (W512, qb.num_q - q0) {
                    (true, 1) => avx512_rows::<1>(qb, q0, tp, len_pad, &norms_pad, best),
                    (true, 2) => avx512_rows::<2>(qb, q0, tp, len_pad, &norms_pad, best),
                    (true, 3) => avx512_rows::<3>(qb, q0, tp, len_pad, &norms_pad, best),
                    (true, _) => avx512_rows::<4>(qb, q0, tp, len_pad, &norms_pad, best),
                    (false, 1) => avx2_rows::<1>(qb, q0, tp, len_pad, &norms_pad, best),
                    (false, 2) => avx2_rows::<2>(qb, q0, tp, len_pad, &norms_pad, best),
                    (false, 3) => avx2_rows::<3>(qb, q0, tp, len_pad, &norms_pad, best),
                    (false, _) => avx2_rows::<4>(qb, q0, tp, len_pad, &norms_pad, best),
                }
                q0 += 4;
            }
            start += len;
        }
    });
}

/// One block row of `maxsim_range_x86`: query rows `q0..q0 + R` against tile
/// rows `0..len_pad` (a multiple of 2) in 2-doc blocks. Rows `R..4` of the
/// block are absent: their chains stay zero and their lanes never update a
/// query maximum. Each present pair is summed exactly as for R = 4.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
#[inline]
unsafe fn avx2_rows<const R: usize>(qb: &QueryBlock, q0: usize, tile: *const f32, len_pad: usize, norms_pad: &[f32; MAXSIM_TILE], best: &mut [f32]) {
    use std::arch::x86_64::*;
    let dim = qb.dim;
    let eps = _mm256_set1_ps(1e-8);
    let qp = qb.padded.as_ptr().add(q0 * dim);
    let qn4 = _mm_loadu_ps(qb.norms.as_ptr().add(q0));
    let qn = _mm256_set_m128(qn4, qn4);
    let mut bmax = _mm256_set1_ps(-1.0);
    // Software-pipelined by one block: the FMA chains of block j run while
    // block j-1 (chains already finished) is folded, divided and max-reduced,
    // so the fold's dependency tail never stalls the FMAs.
    let mut chains = [[[_mm256_setzero_ps(); 8]; 4]; 2];
    let finish = |d0: usize, ch: &[[__m256; 8]; 4], bmax: &mut __m256| {
        // Lanes: [q0·d0, q1·d0, q2·d0, q3·d0, q0·d1, q1·d1, q2·d1, q3·d1].
        let dots = fold_4x2_avx2(ch);
        let dn = _mm256_set_m128(_mm_set1_ps(norms_pad[d0 + 1]), _mm_set1_ps(norms_pad[d0]));
        // mul then add (no FMA), then div: the portable kernel's rounding.
        let sim = _mm256_div_ps(dots, _mm256_add_ps(_mm256_mul_ps(qn, dn), eps));
        // max_ps(sim, b) = sim > b ? sim : b — `if sim > b`, NaN never wins.
        *bmax = _mm256_max_ps(sim, *bmax);
    };
    let mut d0 = 0usize;
    while d0 < len_pad {
        let cur = (d0 / 2) & 1;
        let tp = tile.add(d0 * dim);
        // Fixed trip counts for the model dims (LateOn-Code 128, edge 48, ...).
        match dim {
            128 => chains_4x2_avx2::<128, R>(qp, tp, dim, &mut chains[cur]),
            96 => chains_4x2_avx2::<96, R>(qp, tp, dim, &mut chains[cur]),
            64 => chains_4x2_avx2::<64, R>(qp, tp, dim, &mut chains[cur]),
            48 => chains_4x2_avx2::<48, R>(qp, tp, dim, &mut chains[cur]),
            32 => chains_4x2_avx2::<32, R>(qp, tp, dim, &mut chains[cur]),
            _ => chains_4x2_avx2::<0, R>(qp, tp, dim, &mut chains[cur]),
        }
        if d0 > 0 {
            finish(d0 - 2, &chains[cur ^ 1], &mut bmax);
        }
        d0 += 2;
    }
    if len_pad > 0 {
        finish(len_pad - 2, &chains[((len_pad - 2) / 2) & 1], &mut bmax);
    }
    let mut m = [0.0f32; 4];
    _mm_storeu_ps(m.as_mut_ptr(), _mm_max_ps(_mm256_castps256_ps128(bmax), _mm256_extractf128_ps(bmax, 1)));
    for r in 0..R {
        if m[r] > best[q0 + r] {
            best[q0 + r] = m[r];
        }
    }
}

/// The FMA chains of 4 query rows (`qp`, stride `dim`) × 2 doc rows (`tp`,
/// stride `dim`), each as `dot_avx2_fma` builds them (`dim % 8 == 0`):
/// `chains[k][2r + j]` is chain `k` of the pair (query r, doc j). Only the
/// first `R` query rows are computed; the other pairs stay zero. `DIM` > 0
/// fixes `dim` at compile time so the loops unroll fully.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
#[inline]
unsafe fn chains_4x2_avx2<const DIM: usize, const R: usize>(qp: *const f32, tp: *const f32, dim: usize, chains: &mut [[std::arch::x86_64::__m256; 8]; 4]) {
    use std::arch::x86_64::*;
    let d = if DIM > 0 { DIM } else { dim };
    let (main, extra) = (d / 32, (d % 32) / 8);
    #[inline(always)]
    unsafe fn step<const R: usize>(qp: *const f32, tp: *const f32, dim: usize, off: usize, acc: &mut [__m256; 8]) {
        let d0 = _mm256_loadu_ps(tp.add(off));
        let d1 = _mm256_loadu_ps(tp.add(dim + off));
        for r in 0..R {
            let q = _mm256_loadu_ps(qp.add(r * dim + off));
            acc[2 * r] = _mm256_fmadd_ps(q, d0, acc[2 * r]);
            acc[2 * r + 1] = _mm256_fmadd_ps(q, d1, acc[2 * r + 1]);
        }
    }
    for (k, chain) in chains.iter_mut().enumerate() {
        let mut acc = [_mm256_setzero_ps(); 8];
        for m in 0..main {
            step::<R>(qp, tp, dim, 32 * m + 8 * k, &mut acc);
        }
        if k == 0 {
            // Chain 0's trailing chunks follow the 32-float blocks, as in dot_avx2_fma.
            for e in 0..extra {
                step::<R>(qp, tp, dim, 32 * main + 8 * e, &mut acc);
            }
        }
        *chain = acc;
    }
}

/// Folds `chains_4x2_avx2` output into the 8 dots, summed exactly as
/// `dot_avx2_fma` sums them. Returns
/// `[q0·d0, q1·d0, q2·d0, q3·d0, q0·d1, q1·d1, q2·d1, q3·d1]`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
#[inline]
unsafe fn fold_4x2_avx2(chains: &[[std::arch::x86_64::__m256; 8]; 4]) -> std::arch::x86_64::__m256 {
    use std::arch::x86_64::*;
    // (c0 + c1) + (c2 + c3) per pair, then lanes l + (l + 4): two pairs per vector.
    let s = |p: usize| _mm256_add_ps(_mm256_add_ps(chains[0][p], chains[1][p]), _mm256_add_ps(chains[2][p], chains[3][p]));
    let half = |a: __m256, b: __m256| _mm256_add_ps(_mm256_permute2f128_ps(a, b, 0x20), _mm256_permute2f128_ps(a, b, 0x31));
    // Pair order A..H = (q0,d0), (q0,d1), (q1,d0), (q1,d1), (q2,d0), (q2,d1), (q3,d0), (q3,d1).
    let t_ab = half(s(0), s(1));
    let t_cd = half(s(2), s(3));
    let t_ef = half(s(4), s(5));
    let t_gh = half(s(6), s(7));
    // [s0 + s2, s1 + s3] for each pair.
    let fold = |a: __m256, b: __m256| _mm256_add_ps(_mm256_shuffle_ps(a, b, 0b01_00_01_00), _mm256_shuffle_ps(a, b, 0b11_10_11_10));
    let v_abcd = fold(t_ab, t_cd);
    let v_efgh = fold(t_ef, t_gh);
    // (s0 + s2) + (s1 + s3): lanes [A, C, E, G, B, D, F, H].
    _mm256_add_ps(_mm256_shuffle_ps(v_abcd, v_efgh, 0b10_00_10_00), _mm256_shuffle_ps(v_abcd, v_efgh, 0b11_01_11_01))
}

/// `avx2_rows` with 16-lane registers. A pair's four 8-lane chains sit in two
/// registers, `[chain 0 | chain 1]` and `[chain 2 | chain 3]`: lanes 0-7 and
/// 8-15 of a 16-float load at `32m` are exactly the floats chains 0 and 1 take
/// (`32m + 8k`). The chains, the trailing chunks of chain 0 and the fold are
/// those of `dot_avx2_fma`, so every dot, similarity and maximum is the same
/// f32 as in `avx2_rows`; only half as many FMA and load instructions run.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f,avx2,fma")]
unsafe fn avx512_rows<const R: usize>(qb: &QueryBlock, q0: usize, tile: *const f32, len_pad: usize, norms_pad: &[f32; MAXSIM_TILE], best: &mut [f32]) {
    use std::arch::x86_64::*;
    let dim = qb.dim;
    let eps = _mm256_set1_ps(1e-8);
    let qp = qb.padded.as_ptr().add(q0 * dim);
    let qn4 = _mm_loadu_ps(qb.norms.as_ptr().add(q0));
    let qn = _mm256_set_m128(qn4, qn4);
    let mut bmax = _mm256_set1_ps(-1.0);
    // Software-pipelined by one block, as in avx2_rows.
    let mut chains = [[[_mm512_setzero_ps(); 2]; 8]; 2];
    let finish = |d0: usize, ch: &[[__m512; 2]; 8], bmax: &mut __m256| {
        // Lanes: [q0·d0, q1·d0, q2·d0, q3·d0, q0·d1, q1·d1, q2·d1, q3·d1].
        let dots = fold_4x2_avx512(ch);
        let dn = _mm256_set_m128(_mm_set1_ps(norms_pad[d0 + 1]), _mm_set1_ps(norms_pad[d0]));
        let sim = _mm256_div_ps(dots, _mm256_add_ps(_mm256_mul_ps(qn, dn), eps));
        *bmax = _mm256_max_ps(sim, *bmax);
    };
    let mut d0 = 0usize;
    while d0 < len_pad {
        let cur = (d0 / 2) & 1;
        let tp = tile.add(d0 * dim);
        match dim {
            128 => chains_4x2_avx512::<128, R>(qp, tp, dim, &mut chains[cur]),
            96 => chains_4x2_avx512::<96, R>(qp, tp, dim, &mut chains[cur]),
            64 => chains_4x2_avx512::<64, R>(qp, tp, dim, &mut chains[cur]),
            48 => chains_4x2_avx512::<48, R>(qp, tp, dim, &mut chains[cur]),
            32 => chains_4x2_avx512::<32, R>(qp, tp, dim, &mut chains[cur]),
            _ => chains_4x2_avx512::<0, R>(qp, tp, dim, &mut chains[cur]),
        }
        if d0 > 0 {
            finish(d0 - 2, &chains[cur ^ 1], &mut bmax);
        }
        d0 += 2;
    }
    if len_pad > 0 {
        finish(len_pad - 2, &chains[((len_pad - 2) / 2) & 1], &mut bmax);
    }
    let mut m = [0.0f32; 4];
    _mm_storeu_ps(m.as_mut_ptr(), _mm_max_ps(_mm256_castps256_ps128(bmax), _mm256_extractf128_ps(bmax, 1)));
    for r in 0..R {
        if m[r] > best[q0 + r] {
            best[q0 + r] = m[r];
        }
    }
}

/// `chains_4x2_avx2` with 16-lane registers: `chains[2r + j][0]` holds chains
/// 0 and 1 of the pair (query r, doc j), `chains[2r + j][1]` chains 2 and 3.
/// Each lane takes the same floats in the same order as in `chains_4x2_avx2`;
/// chain 0's trailing 8-float chunks go to lanes 0-7 only (masked FMA).
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f,avx2,fma")]
#[inline]
unsafe fn chains_4x2_avx512<const DIM: usize, const R: usize>(qp: *const f32, tp: *const f32, dim: usize, chains: &mut [[std::arch::x86_64::__m512; 2]; 8]) {
    use std::arch::x86_64::*;
    let d = if DIM > 0 { DIM } else { dim };
    let (main, extra) = (d / 32, (d % 32) / 8);
    let mut acc = [[_mm512_setzero_ps(); 2]; 8];
    for m in 0..main {
        let off = 32 * m;
        let d0a = _mm512_loadu_ps(tp.add(off));
        let d0b = _mm512_loadu_ps(tp.add(off + 16));
        let d1a = _mm512_loadu_ps(tp.add(dim + off));
        let d1b = _mm512_loadu_ps(tp.add(dim + off + 16));
        for r in 0..R {
            let qa = _mm512_loadu_ps(qp.add(r * dim + off));
            let qb = _mm512_loadu_ps(qp.add(r * dim + off + 16));
            acc[2 * r][0] = _mm512_fmadd_ps(qa, d0a, acc[2 * r][0]);
            acc[2 * r][1] = _mm512_fmadd_ps(qb, d0b, acc[2 * r][1]);
            acc[2 * r + 1][0] = _mm512_fmadd_ps(qa, d1a, acc[2 * r + 1][0]);
            acc[2 * r + 1][1] = _mm512_fmadd_ps(qb, d1b, acc[2 * r + 1][1]);
        }
    }
    // Chain 0's trailing chunks follow the 32-float blocks, as in dot_avx2_fma.
    const LO: __mmask16 = 0x00FF;
    for e in 0..extra {
        let off = 32 * main + 8 * e;
        let d0 = _mm512_maskz_loadu_ps(LO, tp.add(off));
        let d1 = _mm512_maskz_loadu_ps(LO, tp.add(dim + off));
        for r in 0..R {
            let q = _mm512_maskz_loadu_ps(LO, qp.add(r * dim + off));
            acc[2 * r][0] = _mm512_mask3_fmadd_ps(q, d0, acc[2 * r][0], LO);
            acc[2 * r + 1][0] = _mm512_mask3_fmadd_ps(q, d1, acc[2 * r + 1][0], LO);
        }
    }
    *chains = acc;
}

/// Folds `chains_4x2_avx512` output into the 8 dots with the additions of
/// `fold_4x2_avx2` (`dot_avx2_fma`): per pair `s = (c0 + c1) + (c2 + c3)`,
/// `t_l = s_l + s_{l+4}`, `dot = (t0 + t2) + (t1 + t3)`. Each step works on
/// several pairs per register; the grouping of every addition is unchanged.
/// Returns `[q0·d0, q1·d0, q2·d0, q3·d0, q0·d1, q1·d1, q2·d1, q3·d1]`.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f,avx2,fma")]
#[inline]
unsafe fn fold_4x2_avx512(chains: &[[std::arch::x86_64::__m512; 2]; 8]) -> std::arch::x86_64::__m256 {
    use std::arch::x86_64::*;
    // Pair p = 2r + j. Slots 0..7 hold pairs 0, 4, 1, 5, 2, 6, 3, 7, so the
    // last step leaves the dots in the order above.
    // [s_p | s_q] = ([c0_p | c0_q] + [c1_p | c1_q]) + ([c2_p | c2_q] + [c3_p | c3_q]).
    let s2 = |p: usize, q: usize| {
        let (a, b) = (chains[p][0], chains[q][0]);
        let x = _mm512_add_ps(_mm512_shuffle_f32x4(a, b, 0b01_00_01_00), _mm512_shuffle_f32x4(a, b, 0b11_10_11_10));
        let (a, b) = (chains[p][1], chains[q][1]);
        let y = _mm512_add_ps(_mm512_shuffle_f32x4(a, b, 0b01_00_01_00), _mm512_shuffle_f32x4(a, b, 0b11_10_11_10));
        _mm512_add_ps(x, y)
    };
    let s01 = s2(0, 4);
    let s23 = s2(1, 5);
    let s45 = s2(2, 6);
    let s67 = s2(3, 7);
    // 128-bit lane i of t_lo = t of slot i, of t_hi = t of slot i + 4 (lanes l + (l + 4) of s).
    let t = |a: __m512, b: __m512| _mm512_add_ps(_mm512_shuffle_f32x4(a, b, 0b10_00_10_00), _mm512_shuffle_f32x4(a, b, 0b11_01_11_01));
    let t_lo = t(s01, s23);
    let t_hi = t(s45, s67);
    // Lane i: [t0 + t2, t1 + t3] of slot i, then of slot i + 4.
    let w = _mm512_add_ps(_mm512_shuffle_ps(t_lo, t_hi, 0b01_00_01_00), _mm512_shuffle_ps(t_lo, t_hi, 0b11_10_11_10));
    // (t0 + t2) + (t1 + t3) per slot; slot order 0, 4, 1, 5, 2, 6, 3, 7.
    let even = _mm512_permutexvar_ps(_mm512_setr_epi32(0, 2, 4, 6, 8, 10, 12, 14, 0, 0, 0, 0, 0, 0, 0, 0), w);
    let odd = _mm512_permutexvar_ps(_mm512_setr_epi32(1, 3, 5, 7, 9, 11, 13, 15, 0, 0, 0, 0, 0, 0, 0, 0), w);
    _mm256_add_ps(_mm512_castps512_ps256(even), _mm512_castps512_ps256(odd))
}

/// Dequantize int4 nibble rows `[start, start+len)` into `tile` (row-major).
/// Values are bit-identical to the scalar `nib * scale + min`.
#[inline(always)]
fn dequant_int4_rows(packed: &[u8], mins: &[f32], scales: &[f32], dim: usize, start: usize, len: usize, tile: &mut [f32]) {
    let packed_dim = (dim + 1) / 2;
    #[cfg(target_arch = "aarch64")]
    if dim % 16 == 0 {
        use std::arch::aarch64::*;
        // 16 nibbles (in element order) -> 16 floats at `out`.
        #[inline(always)]
        unsafe fn put16(nib: uint8x16_t, sv: float32x4_t, mv: float32x4_t, out: *mut f32) {
            let w0 = vmovl_u8(vget_low_u8(nib));
            let w1 = vmovl_high_u8(nib);
            let quads = [vmovl_u16(vget_low_u16(w0)), vmovl_high_u16(w0), vmovl_u16(vget_low_u16(w1)), vmovl_high_u16(w1)];
            for (k, v) in quads.iter().enumerate() {
                // mul then add (no FMA): same rounding as the scalar path.
                vst1q_f32(out.add(k * 4), vaddq_f32(vmulq_f32(vcvtq_f32_u32(*v), sv), mv));
            }
        }
        for ti in 0..len {
            let t = start + ti;
            let row = &packed[t * packed_dim..(t + 1) * packed_dim];
            let dst = &mut tile[ti * dim..(ti + 1) * dim];
            // SAFETY: dim % 16 == 0, so the row is whole 16-byte chunks plus at
            // most one 8-byte chunk, and dst holds 2 floats per row byte.
            unsafe {
                let sv = vdupq_n_f32(scales[t]);
                let mv = vdupq_n_f32(mins[t]);
                let mask = vdupq_n_u8(0x0F);
                let mut b = 0usize;
                while b + 16 <= packed_dim {
                    let bytes = vld1q_u8(row.as_ptr().add(b));
                    let lo = vandq_u8(bytes, mask);
                    let hi = vshrq_n_u8::<4>(bytes);
                    // Low nibble first: element 2p = lo, 2p+1 = hi.
                    let out = dst.as_mut_ptr().add(b * 2);
                    put16(vzip1q_u8(lo, hi), sv, mv, out);
                    put16(vzip2q_u8(lo, hi), sv, mv, out.add(16));
                    b += 16;
                }
                if b < packed_dim {
                    // dim % 32 == 16: one 8-byte chunk left.
                    let bytes = vcombine_u8(vld1_u8(row.as_ptr().add(b)), vdup_n_u8(0));
                    put16(vzip1q_u8(vandq_u8(bytes, mask), vshrq_n_u8::<4>(bytes)), sv, mv, dst.as_mut_ptr().add(b * 2));
                }
            }
        }
        return;
    }
    #[cfg(target_arch = "x86_64")]
    if dim % 16 == 0 && have_avx2_fma() {
        // SAFETY: AVX2 verified at runtime.
        unsafe { dequant_int4_rows_avx2(packed, mins, scales, dim, start, len, tile) };
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
    #[cfg(target_arch = "x86_64")]
    if dim % 8 == 0 && have_avx2_fma() {
        // SAFETY: AVX2 verified at runtime.
        unsafe { dequant_int8_rows_avx2(int8, mins, scales, per_token, dim, start, len, tile) };
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

/// AVX2 `dequant_int4_rows` (`dim % 16 == 0`): same values, mul then add.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn dequant_int4_rows_avx2(packed: &[u8], mins: &[f32], scales: &[f32], dim: usize, start: usize, len: usize, tile: &mut [f32]) {
    use std::arch::x86_64::*;
    let packed_dim = dim / 2;
    let mask = _mm_set1_epi8(0x0F);
    for ti in 0..len {
        let t = start + ti;
        let row = &packed[t * packed_dim..(t + 1) * packed_dim];
        let dst = &mut tile[ti * dim..(ti + 1) * dim];
        let sv = _mm256_set1_ps(scales[t]);
        let mv = _mm256_set1_ps(mins[t]);
        // 16 nibbles (in element order) -> 16 floats at `out`.
        let put16 = |nib: __m128i, out: *mut f32| {
            for k in 0..2 {
                let v = _mm256_cvtepu8_epi32(if k == 0 { nib } else { _mm_srli_si128::<8>(nib) });
                _mm256_storeu_ps(out.add(k * 8), _mm256_add_ps(_mm256_mul_ps(_mm256_cvtepi32_ps(v), sv), mv));
            }
        };
        let mut b = 0usize;
        while b + 16 <= packed_dim {
            let bytes = _mm_loadu_si128(row.as_ptr().add(b) as *const __m128i);
            let lo = _mm_and_si128(bytes, mask);
            let hi = _mm_and_si128(_mm_srli_epi16::<4>(bytes), mask);
            // Low nibble first: element 2p = lo, 2p+1 = hi.
            let out = dst.as_mut_ptr().add(b * 2);
            put16(_mm_unpacklo_epi8(lo, hi), out);
            put16(_mm_unpackhi_epi8(lo, hi), out.add(16));
            b += 16;
        }
        if b < packed_dim {
            // dim % 32 == 16: one 8-byte chunk left.
            let bytes = _mm_loadl_epi64(row.as_ptr().add(b) as *const __m128i);
            put16(_mm_unpacklo_epi8(_mm_and_si128(bytes, mask), _mm_and_si128(_mm_srli_epi16::<4>(bytes), mask)), dst.as_mut_ptr().add(b * 2));
        }
    }
}

/// AVX2 `dequant_int8_rows` (`dim % 8 == 0`): same values, add 128, mul, add.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn dequant_int8_rows_avx2(int8: &[i8], mins: &[f32], scales: &[f32], per_token: bool, dim: usize, start: usize, len: usize, tile: &mut [f32]) {
    use std::arch::x86_64::*;
    let c128 = _mm256_set1_ps(128.0);
    for ti in 0..len {
        let t = start + ti;
        let pi = if per_token { t } else { 0 };
        let src = &int8[t * dim..(t + 1) * dim];
        let dst = &mut tile[ti * dim..(ti + 1) * dim];
        let sv = _mm256_set1_ps(scales[pi]);
        let mv = _mm256_set1_ps(mins[pi]);
        let mut d = 0usize;
        while d < dim {
            let v = _mm256_cvtepi8_epi32(_mm_loadl_epi64(src.as_ptr().add(d) as *const __m128i));
            let f = _mm256_add_ps(_mm256_mul_ps(_mm256_add_ps(_mm256_cvtepi32_ps(v), c128), sv), mv);
            _mm256_storeu_ps(dst.as_mut_ptr().add(d), f);
            d += 8;
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

/// Reinterpret a byte slice as i8 without copying (`u8 as i8` is the same bit
/// pattern this view produces).
#[inline(always)]
fn bytes_as_i8(bytes: &[u8]) -> &[i8] {
    // SAFETY: u8 and i8 have identical size/alignment.
    unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const i8, bytes.len()) }
}

// =============================================================================
// Batch scheduling
// =============================================================================

/// Batch worker pool for the MaxSim kernels.
///
/// The calling thread always works on its own batch; the pool only adds
/// helpers. Workers wait on one condition variable, so a batch wakes every
/// parked worker with one broadcast (rayon wakes its threads one system call
/// at a time, ~5 µs each on the caller before it can start). A worker that
/// finishes spins for `SPIN` before it parks, so back-to-back batches find it
/// awake, and `prewarm` wakes the pool ahead of a batch so the wake-up latency
/// overlaps the caller's own preparation. Default size: one thread per
/// performance core (Apple Silicon:
/// `hw.perflevel0.logicalcpu`; elsewhere every logical CPU), caller included;
/// `SS_MAXSIM_THREADS` overrides it. On macOS the workers run at the
/// user-interactive QoS class, which keeps them on performance cores.
mod pool {
    use std::sync::atomic::{AtomicPtr, AtomicU64, AtomicUsize, Ordering::*};
    use std::sync::{Arc, Condvar, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    /// How long a worker that finished a batch keeps looking for the next one
    /// before it parks.
    const SPIN: Duration = Duration::from_micros(200);
    /// Upper bound on a `prewarm` spin window.
    const MAX_WARM: Duration = Duration::from_millis(5);

    /// One batch, owned by the calling thread's stack frame for the whole call.
    struct Job {
        next: AtomicUsize,
        done: AtomicUsize,
        n: usize,
        task: *const (dyn Fn(usize) + Sync),
    }

    impl Job {
        fn work(&self) {
            loop {
                let k = self.next.fetch_add(1, Relaxed);
                if k >= self.n {
                    return;
                }
                // SAFETY: `run_batch` returns only after all n claimed indices
                // are done, so the task outlives this call. Late workers claim
                // k >= n and never dereference it.
                unsafe { (*self.task)(k) };
                self.done.fetch_add(1, Release);
            }
        }
    }

    /// Lock-free hand-off: the caller publishes a pointer to its stack `Job`
    /// and bumps `epoch`; spinning workers see the bump and join without any
    /// lock. A worker counts itself in `active` before it reads `job` and out
    /// after it is done with it, and the caller returns only once it has
    /// unpublished the job and `active` is 0, so no worker touches a dead job.
    /// The mutex and condvar are used only to park and to wake parked workers.
    struct Shared {
        epoch: AtomicU64,
        job: AtomicPtr<Job>,
        active: AtomicUsize,
        parked: AtomicUsize,
        /// Workers keep spinning until this time (ns after `start`) when a
        /// prewarm asked for a longer window than `SPIN`.
        warm_until: AtomicU64,
        start: Instant,
        lock: Mutex<()>,
        wake: Condvar,
    }

    struct Pool {
        shared: Arc<Shared>,
        workers: usize,
    }

    fn threads() -> usize {
        // SS_MAXSIM_THREADS: thread count, caller included (0 or unset = default).
        if let Some(n) = std::env::var("SS_MAXSIM_THREADS").ok().and_then(|v| v.parse::<usize>().ok()).filter(|&n| n > 0) {
            return n;
        }
        #[cfg(target_os = "macos")]
        {
            let mut n: libc::c_int = 0;
            let mut len = std::mem::size_of::<libc::c_int>();
            // SAFETY: valid NUL-terminated name and an int-sized out buffer.
            let rc = unsafe {
                libc::sysctlbyname(c"hw.perflevel0.logicalcpu".as_ptr(), &mut n as *mut _ as *mut libc::c_void, &mut len, std::ptr::null_mut(), 0)
            };
            if rc == 0 && n > 0 {
                return n as usize;
            }
        }
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
    }

    fn pool() -> &'static Pool {
        static POOL: OnceLock<Pool> = OnceLock::new();
        POOL.get_or_init(|| {
            let shared = Arc::new(Shared {
                epoch: AtomicU64::new(0),
                job: AtomicPtr::new(std::ptr::null_mut()),
                active: AtomicUsize::new(0),
                parked: AtomicUsize::new(0),
                warm_until: AtomicU64::new(0),
                start: Instant::now(),
                lock: Mutex::new(()),
                wake: Condvar::new(),
            });
            let mut workers = 0;
            for i in 0..threads() - 1 {
                let shared = Arc::clone(&shared);
                let spawned = std::thread::Builder::new()
                    .name(format!("ss-maxsim-{i}"))
                    .stack_size(256 * 1024)
                    .spawn(move || worker(&shared));
                if spawned.is_err() {
                    // Fewer helpers only means less parallelism; the caller
                    // always finishes its own batch.
                    break;
                }
                workers += 1;
            }
            Pool { shared, workers }
        })
    }

    fn worker(shared: &Shared) {
        #[cfg(target_os = "macos")]
        // SAFETY: plain FFI call on the current thread.
        unsafe {
            libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE, 0);
        }
        let mut seen = shared.epoch.load(SeqCst);
        loop {
            let warm = shared.start + Duration::from_nanos(shared.warm_until.load(Relaxed));
            let spin_until = (Instant::now() + SPIN).max(warm);
            let mut spins = 0u32;
            while shared.epoch.load(Acquire) == seen {
                std::hint::spin_loop();
                spins = spins.wrapping_add(1);
                if spins % 64 == 0 && Instant::now() >= spin_until {
                    // Park. `parked` is raised before the epoch re-check, and
                    // a publisher bumps `epoch` before reading `parked` (both
                    // SeqCst), so either it sees us parked and wakes us, or we
                    // see its bump here and do not wait.
                    let mut g = shared.lock.lock().unwrap_or_else(|e| e.into_inner());
                    shared.parked.fetch_add(1, SeqCst);
                    while shared.epoch.load(SeqCst) == seen {
                        g = shared.wake.wait(g).unwrap_or_else(|e| e.into_inner());
                    }
                    shared.parked.fetch_sub(1, SeqCst);
                    break;
                }
            }
            seen = shared.epoch.load(Acquire);
            shared.active.fetch_add(1, SeqCst);
            let job = shared.job.load(SeqCst);
            if !job.is_null() {
                // SAFETY: we are counted in `active`, so the publisher has not
                // returned (it waits for `active == 0` after unpublishing).
                unsafe { (*job).work() };
            }
            shared.active.fetch_sub(1, Release);
        }
    }

    fn publish(shared: &Shared) {
        shared.epoch.fetch_add(1, SeqCst);
        if shared.parked.load(SeqCst) > 0 {
            let _g = shared.lock.lock().unwrap_or_else(|e| e.into_inner());
            shared.wake.notify_all();
        }
    }

    /// Helper threads the pool adds to a calling thread.
    pub fn helpers() -> usize {
        pool().workers
    }

    /// Wakes every parked worker and keeps the pool spinning for up to
    /// `window` (capped at `MAX_WARM`), so a batch that starts within it finds
    /// the workers awake.
    pub fn prewarm(window: Duration) {
        let p = pool();
        if p.workers == 0 {
            return;
        }
        let until = (p.shared.start.elapsed() + window.min(MAX_WARM)).as_nanos() as u64;
        p.shared.warm_until.fetch_max(until, Relaxed);
        publish(&p.shared);
    }

    /// Runs `task(0..n)` on the calling thread plus every pool worker, each
    /// index exactly once, and returns when all are done.
    pub fn run_batch(n: usize, task: &(dyn Fn(usize) + Sync)) {
        if n == 0 {
            return;
        }
        // SAFETY: lifetime erasure only; see `Job::work`.
        let task: *const (dyn Fn(usize) + Sync) = unsafe { std::mem::transmute::<&(dyn Fn(usize) + Sync), &'static (dyn Fn(usize) + Sync)>(task) };
        let job = Job { next: AtomicUsize::new(0), done: AtomicUsize::new(0), n, task };
        let p = pool();
        let shared = &p.shared;
        let me = &job as *const Job as *mut Job;
        let helped = n > 1 && p.workers > 0;
        if helped {
            shared.job.store(me, SeqCst);
            publish(shared);
        }
        job.work();
        while job.done.load(Acquire) < n {
            std::hint::spin_loop();
        }
        if helped {
            // Unpublish (unless another caller has published since), then wait
            // until no worker can still be reading this job.
            let _ = shared.job.compare_exchange(me, std::ptr::null_mut(), SeqCst, SeqCst);
            while shared.active.load(SeqCst) > 0 {
                std::hint::spin_loop();
            }
        }
    }
}

/// Scores candidates `0..sizes.len()` (`sizes[i]` = doc tokens of candidate
/// `i`) and returns the scores in candidate order. `range(i, from, to, best)`
/// runs `maxsim_range` for candidate `i` over doc tokens `[from, to)`.
///
/// Work is cut into units of whole tiles, about four units per thread, so no
/// thread is left with one long doc at the end (on Apple Silicon a long doc on
/// an efficiency core finishes ~3× late). Each unit keeps its own per-query
/// maxima; a candidate's units are merged in tile order afterwards. A maximum
/// is exact in any order, so the scores do not depend on the split.
///
/// The calling thread starts scoring at once and the `pool` workers join as
/// they wake. Units are claimed from one atomic counter, largest first. A
/// sleeping pool costs ~30-200 µs to wake: the caller works through that
/// latency instead of blocking on it, and it never sleeps itself.
fn score_batch<F: Fn(usize, usize, usize, &mut [f32]) + Sync>(sizes: &[usize], q_rows: usize, num_q: usize, range: F) -> Vec<f64> {
    let tiles = |n: usize| n.div_ceil(MAXSIM_TILE).max(1);
    let threads = pool::helpers() + 1;
    let total: usize = sizes.iter().map(|&n| tiles(n)).sum();
    let unit_tokens = total.div_ceil(4 * threads).max(1) * MAXSIM_TILE;
    // (candidate, from, to); a candidate's units are contiguous and in tile order.
    let mut units: Vec<(u32, u32, u32)> = Vec::with_capacity(total);
    for (i, &n) in sizes.iter().enumerate() {
        let mut from = 0usize;
        loop {
            let to = (from + unit_tokens).min(n);
            units.push((i as u32, from as u32, to as u32));
            from = to;
            if from >= n {
                break;
            }
        }
    }
    let nu = units.len();
    let mut unit_best = vec![-1.0f32; nu * q_rows];
    if nu > 0 {
        let mut order: Vec<u32> = (0..nu as u32).collect();
        order.sort_by_key(|&u| {
            let (_, from, to) = units[u as usize];
            std::cmp::Reverse(to - from)
        });
        let best_ptr = unit_best.as_mut_ptr() as usize;
        pool::run_batch(nu, &|k: usize| {
            let u = order[k] as usize;
            let (i, from, to) = units[u];
            // SAFETY: each unit is claimed once, so each q_rows-long slice has
            // one writer; `unit_best` outlives the batch.
            let best = unsafe { std::slice::from_raw_parts_mut((best_ptr as *mut f32).add(u * q_rows), q_rows) };
            range(i as usize, from as usize, to as usize, best);
        });
    }

    let mut out = Vec::with_capacity(sizes.len());
    let mut merged = vec![0.0f32; q_rows];
    let mut u = 0usize;
    while u < nu {
        let i = units[u].0;
        let first = &unit_best[u * q_rows..(u + 1) * q_rows];
        u += 1;
        if u == nu || units[u].0 != i {
            out.push(score_from_best(first, num_q) as f64);
            continue;
        }
        // Same as one pass: seeded at -1.0, raised in tile order.
        merged.fill(-1.0);
        u -= 1;
        while u < nu && units[u].0 == i {
            for (m, &b) in merged.iter_mut().zip(&unit_best[u * q_rows..(u + 1) * q_rows]) {
                if b > *m {
                    *m = b;
                }
            }
            u += 1;
        }
        out.push(score_from_best(&merged, num_q) as f64);
    }
    out
}

// =============================================================================
// Public API
// =============================================================================

/// A per-token quantized doc: int4 nibble-packed (`ceil(dim/2)` bytes per
/// token) or int8 (`dim` bytes per token), per-token min/scale and the stored
/// pre-quantization token norms. Slices hold at least `num_tokens` entries.
#[derive(Clone, Copy)]
pub struct PerTokenDoc<'a> {
    pub tokens: &'a [u8],
    pub mins: &'a [f32],
    pub scales: &'a [f32],
    pub norms: &'a [f32],
    pub num_tokens: usize,
}

/// An int8 doc with one min/scale for the whole doc (legacy layout); token
/// norms are computed from the dequantized rows.
#[derive(Clone, Copy)]
pub struct PerDocInt8<'a> {
    pub tokens: &'a [i8],
    pub min: f32,
    pub scale: f32,
    pub num_tokens: usize,
}

/// Scores per-token docs (`bits` 4 or 8) against `query` (`num_q` × `dim`
/// f32): mean over query tokens of `max(0, max_d cos(q, d))`, one f64 per doc.
pub fn score_per_token(query: &[f32], num_q: usize, dim: usize, bits: u32, docs: &[PerTokenDoc]) -> Vec<f64> {
    let qb = QueryBlock::new(query, num_q, dim);
    let sizes: Vec<usize> = docs.iter().map(|d| d.num_tokens).collect();
    score_batch(&sizes, qb.norms.len(), qb.num_q, |i, from, to, best| {
        let d = docs[i];
        if bits == 4 {
            maxsim_range(&qb, from, to, Some(d.norms), |start, len, tile| {
                dequant_int4_rows(d.tokens, d.mins, d.scales, dim, start, len, tile)
            }, best)
        } else {
            maxsim_range(&qb, from, to, Some(d.norms), |start, len, tile| {
                dequant_int8_rows(bytes_as_i8(d.tokens), d.mins, d.scales, true, dim, start, len, tile)
            }, best)
        }
    })
}

/// Scores per-doc-quantized int8 docs (legacy layout), as `score_per_token`.
pub fn score_per_doc_int8(query: &[f32], num_q: usize, dim: usize, docs: &[PerDocInt8]) -> Vec<f64> {
    let qb = QueryBlock::new(query, num_q, dim);
    let sizes: Vec<usize> = docs.iter().map(|d| d.num_tokens).collect();
    score_batch(&sizes, qb.norms.len(), qb.num_q, |i, from, to, best| {
        let d = docs[i];
        let (mins, scales) = ([d.min], [d.scale]);
        maxsim_range(&qb, from, to, None, |start, len, tile| {
            dequant_int8_rows(d.tokens, &mins, &scales, false, dim, start, len, tile)
        }, best)
    })
}

/// Scores one f32 doc (`num_d` × `dim`) on the calling thread.
pub fn score_single_f32(query: &[f32], doc: &[f32], num_q: usize, num_d: usize, dim: usize) -> f64 {
    let query_norms = compute_query_norms(query, num_q, dim);
    maxsim_f32(query, &query_norms, num_q, doc, num_d, dim) as f64
}

/// Wakes the worker pool ahead of a batch; see `pool::prewarm`.
pub fn prewarm(window: std::time::Duration) {
    pool::prewarm(window)
}
