//! Exact rescoring kernels for the semantic cascade (stages 2 and 2.5).
//!
//! Each function reproduces the JS arithmetic bit for bit: int8 dots are
//! integer sums (order-free), and float dots accumulate in f64 in the same
//! sequential order as `float32BatchDot` (no FMA, no reassociation). The gain
//! is no per-candidate copies or typed-array views, and all candidate rows
//! are prefetched before the first dot, so scattered rows load in parallel.

use napi::bindgen_prelude::{Float32Array, Float64Array, Int8Array, Uint32Array};
use napi_derive::napi;

#[inline(always)]
fn prefetch(p: *const u8) {
    // SAFETY: prefetch hints never fault, even on invalid addresses.
    #[cfg(target_arch = "aarch64")]
    unsafe {
        std::arch::asm!("prfm pldl1keep, [{0}]", in(reg) p, options(nostack, readonly, preserves_flags));
    }
    #[cfg(target_arch = "x86_64")]
    unsafe {
        std::arch::x86_64::_mm_prefetch::<{ std::arch::x86_64::_MM_HINT_T0 }>(p as *const i8);
    }
}

fn prefetch_rows(base: *const u8, row_bytes: usize, rows: &[u32]) {
    for &r in rows {
        let p = base.wrapping_add(r as usize * row_bytes);
        let mut off = 0;
        while off < row_bytes {
            prefetch(p.wrapping_add(off));
            off += 64;
        }
    }
}

/// True when the CPU has the x86-64-v3 set these kernels use (AVX2, FMA,
/// POPCNT, BMI1/2, LZCNT). The release build targets baseline x86-64, so
/// hot loops are compiled a second time with these features and picked at
/// run time. Detected once; `SS_FIX_X86_V3=0` forces the baseline code.
#[cfg(target_arch = "x86_64")]
pub(crate) fn x86_v3() -> bool {
    use std::sync::OnceLock;
    static V3: OnceLock<bool> = OnceLock::new();
    *V3.get_or_init(|| {
        std::env::var("SS_FIX_X86_V3").as_deref() != Ok("0")
            && is_x86_feature_detected!("avx2")
            && is_x86_feature_detected!("fma")
            && is_x86_feature_detected!("popcnt")
            && is_x86_feature_detected!("bmi1")
            && is_x86_feature_detected!("bmi2")
            && is_x86_feature_detected!("lzcnt")
    })
}

#[inline(always)]
fn int8_dot_portable(q: &[i8], v: &[i8]) -> i32 {
    let mut dot = 0i32;
    for i in 0..q.len().min(v.len()) {
        dot += q[i] as i32 * v[i] as i32;
    }
    dot
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn int8_dot_avx2(q: &[i8], v: &[i8]) -> i32 {
    int8_dot_portable(q, v)
}

/// Integer dot of two int8 rows (exact, so every path agrees).
#[inline(always)]
pub(crate) fn int8_dot(q: &[i8], v: &[i8]) -> i32 {
    #[cfg(target_arch = "x86_64")]
    if x86_v3() {
        // SAFETY: AVX2 presence checked at run time.
        return unsafe { int8_dot_avx2(q, v) };
    }
    int8_dot_portable(q, v)
}

fn check_rows(rows: &[u32], dim: usize, len: usize) -> napi::Result<()> {
    if dim == 0 || rows.iter().any(|&r| (r as usize + 1) * dim > len) {
        return Err(napi::Error::from_reason("rescore: row out of range"));
    }
    Ok(())
}

/// `int8BatchDotScores(query, rows of slab)`: raw int8 dot * (1 / 127^2),
/// written to `out[0..rows.len()]` (a reused caller buffer, so no per-call
/// allocation reaches the JS heap's external-memory accounting).
#[napi]
pub fn int8_dot_scores(slab: Int8Array, dim: u32, query: Int8Array, rows: Uint32Array, mut out: Float64Array) -> napi::Result<()> {
    let dim = dim as usize;
    if query.len() != dim || out.len() < rows.len() {
        return Err(napi::Error::from_reason("int8_dot_scores: bad query or output length"));
    }
    check_rows(&rows, dim, slab.len())?;
    prefetch_rows(slab.as_ptr() as *const u8, dim, &rows);
    let scale = 1.0f64 / (127.0 * 127.0);
    let q: &[i8] = &query;
    let out = out.as_mut();
    for (o, &r) in out.iter_mut().zip(rows.iter()) {
        let v = &slab[r as usize * dim..(r as usize + 1) * dim];
        *o = int8_dot(q, v) as f64 * scale;
    }
    Ok(())
}

/// Sequential f64 dot of `q` with f32 rows (each row keeps its own
/// accumulator and order, exactly as in `float32BatchDot`), written to
/// `out[0..rows.len()]`.
#[napi]
pub fn f32_dot_scores(data: Float32Array, dim: u32, query: Float64Array, rows: Uint32Array, mut out: Float64Array) -> napi::Result<()> {
    let dim = dim as usize;
    if query.len() != dim || out.len() < rows.len() {
        return Err(napi::Error::from_reason("f32_dot_scores: bad query or output length"));
    }
    check_rows(&rows, dim, data.len())?;
    prefetch_rows(data.as_ptr() as *const u8, dim * 4, &rows);
    f64_dots(&data, dim, &query, &rows, out.as_mut());
    Ok(())
}

pub(crate) fn f64_dots(data: &[f32], dim: usize, q: &[f64], rows: &[u32], out: &mut [f64]) {
    let mut c = 0;
    #[cfg(target_arch = "aarch64")]
    {
        // A query whose values are all f32 makes every product exact in f64,
        // so a fused multiply-add rounds exactly like multiply-then-add.
        let fused = q.iter().all(|&x| (x as f32) as f64 == x);
        while c + 16 <= rows.len() {
            unsafe { pairs::<8>(data, dim, q, &rows[c..c + 16], &mut out[c..c + 16], fused) };
            c += 16;
        }
        while c + 2 <= rows.len() {
            unsafe { pairs::<1>(data, dim, q, &rows[c..c + 2], &mut out[c..c + 2], fused) };
            c += 2;
        }
    }
    #[cfg(target_arch = "x86_64")]
    if x86_v3() {
        let fused = q.iter().all(|&x| (x as f32) as f64 == x);
        while c + 16 <= rows.len() {
            unsafe { quads_avx2::<4>(data, dim, q, &rows[c..c + 16], &mut out[c..c + 16], fused) };
            c += 16;
        }
        while c + 4 <= rows.len() {
            unsafe { quads_avx2::<1>(data, dim, q, &rows[c..c + 4], &mut out[c..c + 4], fused) };
            c += 4;
        }
    }
    while c < rows.len() {
        let v = &data[rows[c] as usize * dim..(rows[c] as usize + 1) * dim];
        let mut d = 0f64;
        for i in 0..dim {
            d += q[i] * v[i] as f64;
        }
        out[c] = d;
        c += 1;
    }
}

/// `2 * P` rows at once: rows (2p, 2p + 1) share one f64x2 accumulator,
/// lane 0 for the first row and lane 1 for the second, so each row is still
/// one sequential sum over i (lane-wise multiply then add, or a fused
/// multiply-add when `fused` says that rounds the same).
#[cfg(target_arch = "aarch64")]
#[inline(always)]
unsafe fn pairs<const P: usize>(data: &[f32], dim: usize, q: &[f64], rows: &[u32], out: &mut [f64], fused: bool) {
    use std::arch::aarch64::*;
    let base = data.as_ptr();
    let ptr: [(*const f32, *const f32); P] =
        std::array::from_fn(|p| (base.add(rows[2 * p] as usize * dim), base.add(rows[2 * p + 1] as usize * dim)));
    let mut acc = [vdupq_n_f64(0.0); P];
    let qp = q.as_ptr();
    let mut i = 0;
    macro_rules! step {
        ($x:expr, $qi:expr) => {
            for p in 0..P {
                acc[p] = if fused { vfmaq_f64(acc[p], $x[p], $qi) } else { vaddq_f64(acc[p], vmulq_f64($x[p], $qi)) };
            }
        };
    }
    while i + 4 <= dim {
        let mut x0 = [vdupq_n_f64(0.0); P];
        let mut x1 = [vdupq_n_f64(0.0); P];
        let mut x2 = [vdupq_n_f64(0.0); P];
        let mut x3 = [vdupq_n_f64(0.0); P];
        for p in 0..P {
            let a = vld1q_f32(ptr[p].0.add(i));
            let b = vld1q_f32(ptr[p].1.add(i));
            let lo = vzip1q_f32(a, b); // a0 b0 a1 b1
            let hi = vzip2q_f32(a, b); // a2 b2 a3 b3
            x0[p] = vcvt_f64_f32(vget_low_f32(lo));
            x1[p] = vcvt_high_f64_f32(lo);
            x2[p] = vcvt_f64_f32(vget_low_f32(hi));
            x3[p] = vcvt_high_f64_f32(hi);
        }
        step!(x0, vdupq_n_f64(*qp.add(i)));
        step!(x1, vdupq_n_f64(*qp.add(i + 1)));
        step!(x2, vdupq_n_f64(*qp.add(i + 2)));
        step!(x3, vdupq_n_f64(*qp.add(i + 3)));
        i += 4;
    }
    while i < dim {
        let mut x = [vdupq_n_f64(0.0); P];
        for p in 0..P {
            x[p] = vcvt_f64_f32(vset_lane_f32::<1>(*ptr[p].1.add(i), vdup_n_f32(*ptr[p].0.add(i))));
        }
        step!(x, vdupq_n_f64(*qp.add(i)));
        i += 1;
    }
    for p in 0..P {
        out[2 * p] = vgetq_lane_f64::<0>(acc[p]);
        out[2 * p + 1] = vgetq_lane_f64::<1>(acc[p]);
    }
}

/// x86 form of `pairs`: `4 * P` rows at once, rows 4p..4p + 4 in the four
/// f64 lanes of one accumulator, so each row is still one sequential sum
/// over i. Four dims of the four rows load as a 4x4 f32 block and are
/// transposed, so lane r of `x[j]` is row r at dim i + j.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,fma")]
unsafe fn quads_avx2<const P: usize>(data: &[f32], dim: usize, q: &[f64], rows: &[u32], out: &mut [f64], fused: bool) {
    use std::arch::x86_64::*;
    let base = data.as_ptr();
    let ptr: [[*const f32; 4]; P] = std::array::from_fn(|p| std::array::from_fn(|r| base.add(rows[4 * p + r] as usize * dim)));
    let mut acc = [_mm256_setzero_pd(); P];
    let qp = q.as_ptr();
    macro_rules! step {
        ($x:expr, $qi:expr) => {
            for p in 0..P {
                acc[p] = if fused { _mm256_fmadd_pd($x[p], $qi, acc[p]) } else { _mm256_add_pd(acc[p], _mm256_mul_pd($x[p], $qi)) };
            }
        };
    }
    let mut i = 0;
    while i + 4 <= dim {
        let mut x = [[_mm256_setzero_pd(); P]; 4];
        for p in 0..P {
            let r0 = _mm_loadu_ps(ptr[p][0].add(i));
            let r1 = _mm_loadu_ps(ptr[p][1].add(i));
            let r2 = _mm_loadu_ps(ptr[p][2].add(i));
            let r3 = _mm_loadu_ps(ptr[p][3].add(i));
            let t0 = _mm_unpacklo_ps(r0, r1); // a0 b0 a1 b1
            let t1 = _mm_unpacklo_ps(r2, r3); // c0 d0 c1 d1
            let t2 = _mm_unpackhi_ps(r0, r1); // a2 b2 a3 b3
            let t3 = _mm_unpackhi_ps(r2, r3); // c2 d2 c3 d3
            x[0][p] = _mm256_cvtps_pd(_mm_movelh_ps(t0, t1));
            x[1][p] = _mm256_cvtps_pd(_mm_movehl_ps(t1, t0));
            x[2][p] = _mm256_cvtps_pd(_mm_movelh_ps(t2, t3));
            x[3][p] = _mm256_cvtps_pd(_mm_movehl_ps(t3, t2));
        }
        step!(x[0], _mm256_set1_pd(*qp.add(i)));
        step!(x[1], _mm256_set1_pd(*qp.add(i + 1)));
        step!(x[2], _mm256_set1_pd(*qp.add(i + 2)));
        step!(x[3], _mm256_set1_pd(*qp.add(i + 3)));
        i += 4;
    }
    while i < dim {
        let mut x = [_mm256_setzero_pd(); P];
        for p in 0..P {
            x[p] = _mm256_set_pd(
                *ptr[p][3].add(i) as f64,
                *ptr[p][2].add(i) as f64,
                *ptr[p][1].add(i) as f64,
                *ptr[p][0].add(i) as f64,
            );
        }
        step!(x, _mm256_set1_pd(*qp.add(i)));
        i += 1;
    }
    for (p, a) in acc.iter().enumerate() {
        _mm256_storeu_pd(out.as_mut_ptr().add(4 * p), *a);
    }
}
