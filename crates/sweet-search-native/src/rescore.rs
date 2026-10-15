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

pub(crate) fn prefetch_rows(base: *const u8, row_bytes: usize, rows: &[u32]) {
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

/// AVX2: sign-extend 16 bytes at a time to i16 and multiply-add pairs into
/// i32 lanes (`vpmaddwd`). Each pair sum is at most 2 * 127 * 128, so it is
/// exact, and integer sums do not depend on order: the same value as the
/// portable loop, which the compiler widens to slow 32-bit multiplies.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn int8_dot_avx2(q: &[i8], v: &[i8]) -> i32 {
    use std::arch::x86_64::*;
    let n = q.len().min(v.len());
    let (qp, vp) = (q.as_ptr(), v.as_ptr());
    let mut acc0 = _mm256_setzero_si256();
    let mut acc1 = _mm256_setzero_si256();
    let mut i = 0;
    while i + 32 <= n {
        let a = _mm256_loadu_si256(qp.add(i) as *const __m256i);
        let b = _mm256_loadu_si256(vp.add(i) as *const __m256i);
        let a_lo = _mm256_cvtepi8_epi16(_mm256_castsi256_si128(a));
        let b_lo = _mm256_cvtepi8_epi16(_mm256_castsi256_si128(b));
        let a_hi = _mm256_cvtepi8_epi16(_mm256_extracti128_si256::<1>(a));
        let b_hi = _mm256_cvtepi8_epi16(_mm256_extracti128_si256::<1>(b));
        acc0 = _mm256_add_epi32(acc0, _mm256_madd_epi16(a_lo, b_lo));
        acc1 = _mm256_add_epi32(acc1, _mm256_madd_epi16(a_hi, b_hi));
        i += 32;
    }
    let acc = _mm256_add_epi32(acc0, acc1);
    let s = _mm_add_epi32(_mm256_castsi256_si128(acc), _mm256_extracti128_si256::<1>(acc));
    let s = _mm_add_epi32(s, _mm_shuffle_epi32::<0b01_00_11_10>(s));
    let s = _mm_add_epi32(s, _mm_shuffle_epi32::<0b10_11_00_01>(s));
    let mut dot = _mm_cvtsi128_si32(s);
    while i < n {
        dot += *qp.add(i) as i32 * *vp.add(i) as i32;
        i += 1;
    }
    dot
}

/// Integer dot of two int8 rows (exact, so every path agrees).
#[inline(always)]
pub(crate) fn int8_dot(q: &[i8], v: &[i8]) -> i32 {
    #[cfg(target_arch = "x86_64")]
    if x86_v3() {
        // SAFETY: AVX2 presence checked at run time.
        return unsafe { int8_dot_avx2(q, v) };
    }
    #[cfg(target_arch = "aarch64")]
    if arm_dotprod() {
        // SAFETY: dotprod presence checked at run time.
        return unsafe { int8_dot_sdot(q, v) };
    }
    int8_dot_portable(q, v)
}

/// True when the CPU has the Armv8.2 dot-product instructions (`sdot`).
/// Detected once; `SS_FIX_ARM_DOTPROD=0` forces the portable loop.
#[cfg(target_arch = "aarch64")]
pub(crate) fn arm_dotprod() -> bool {
    use std::sync::OnceLock;
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| {
        std::env::var("SS_FIX_ARM_DOTPROD").as_deref() != Ok("0")
            && std::arch::is_aarch64_feature_detected!("dotprod")
    })
}

/// `sdot`: four signed 8-bit products summed into each i32 lane.
#[cfg(target_arch = "aarch64")]
#[inline(always)]
unsafe fn sdot(acc: std::arch::aarch64::int32x4_t, a: std::arch::aarch64::int8x16_t,
               b: std::arch::aarch64::int8x16_t) -> std::arch::aarch64::int32x4_t {
    let mut r = acc;
    // The intrinsic (vdotq_s32) is not stable yet; the instruction is.
    std::arch::asm!("sdot {r:v}.4s, {a:v}.16b, {b:v}.16b",
        r = inout(vreg) r, a = in(vreg) a, b = in(vreg) b, options(pure, nomem, nostack));
    r
}

/// NEON dot product (`sdot`), four accumulators. Integer sums, so the value
/// equals the portable loop.
#[cfg(target_arch = "aarch64")]
#[target_feature(enable = "dotprod")]
unsafe fn int8_dot_sdot(q: &[i8], v: &[i8]) -> i32 {
    use std::arch::aarch64::*;
    let n = q.len().min(v.len());
    let (qp, vp) = (q.as_ptr(), v.as_ptr());
    let mut a = [vdupq_n_s32(0); 4];
    let mut i = 0;
    while i + 64 <= n {
        for k in 0..4 {
            a[k] = sdot(a[k], vld1q_s8(qp.add(i + 16 * k)), vld1q_s8(vp.add(i + 16 * k)));
        }
        i += 64;
    }
    while i + 16 <= n {
        a[0] = sdot(a[0], vld1q_s8(qp.add(i)), vld1q_s8(vp.add(i)));
        i += 16;
    }
    let mut dot = vaddvq_s32(vaddq_s32(vaddq_s32(a[0], a[1]), vaddq_s32(a[2], a[3])));
    while i < n {
        dot += *qp.add(i) as i32 * *vp.add(i) as i32;
        i += 1;
    }
    dot
}

/// IEEE f16 bits to f32 (exact for every value: subnormals, infinities, NaN payloads).
#[inline(always)]
pub(crate) fn f16_bits_to_f32(h: u16) -> f32 {
    let sign = ((h & 0x8000) as u32) << 16;
    let e = ((h >> 10) & 0x1f) as u32;
    let mut m = (h & 0x3ff) as u32;
    let bits = if e == 0 {
        if m == 0 {
            sign
        } else {
            let mut ee = 113u32;
            while m & 0x400 == 0 {
                m <<= 1;
                ee -= 1;
            }
            sign | (ee << 23) | ((m & 0x3ff) << 13)
        }
    } else if e == 0x1f {
        sign | 0x7f80_0000 | (m << 13)
    } else {
        sign | ((e + 112) << 23) | (m << 13)
    };
    f32::from_bits(bits)
}

/// Widen f16 values to f32 (exact on every path, so x86 and ARM agree).
pub(crate) fn f16_to_f32(src: &[u16], dst: &mut [f32]) {
    let n = src.len().min(dst.len());
    let mut i = 0;
    #[cfg(target_arch = "x86_64")]
    if x86_f16c() {
        // SAFETY: F16C and AVX checked at run time.
        i = unsafe { f16_to_f32_f16c(&src[..n], &mut dst[..n]) };
    }
    #[cfg(target_arch = "aarch64")]
    {
        // SAFETY: fcvtl is base Armv8 Advanced SIMD.
        i = unsafe { f16_to_f32_neon(&src[..n], &mut dst[..n]) };
    }
    while i < n {
        dst[i] = f16_bits_to_f32(src[i]);
        i += 1;
    }
}

#[cfg(target_arch = "x86_64")]
fn x86_f16c() -> bool {
    use std::sync::OnceLock;
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| is_x86_feature_detected!("f16c") && is_x86_feature_detected!("avx"))
}

/// `vcvtph2ps`, 8 values per step; returns how many it widened.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx,f16c")]
unsafe fn f16_to_f32_f16c(src: &[u16], dst: &mut [f32]) -> usize {
    use std::arch::x86_64::*;
    let mut i = 0;
    while i + 8 <= src.len() {
        let h = _mm_loadu_si128(src.as_ptr().add(i) as *const __m128i);
        _mm256_storeu_ps(dst.as_mut_ptr().add(i), _mm256_cvtph_ps(h));
        i += 8;
    }
    i
}

/// `fcvtl` / `fcvtl2`, 8 values per step; returns how many it widened.
#[cfg(target_arch = "aarch64")]
unsafe fn f16_to_f32_neon(src: &[u16], dst: &mut [f32]) -> usize {
    use std::arch::aarch64::*;
    let mut i = 0;
    while i + 8 <= src.len() {
        let h = vld1q_u16(src.as_ptr().add(i));
        let lo: float32x4_t;
        let hi: float32x4_t;
        std::arch::asm!("fcvtl {lo:v}.4s, {h:v}.4h", "fcvtl2 {hi:v}.4s, {h:v}.8h",
            lo = out(vreg) lo, hi = out(vreg) hi, h = in(vreg) h, options(pure, nomem, nostack));
        vst1q_f32(dst.as_mut_ptr().add(i), lo);
        vst1q_f32(dst.as_mut_ptr().add(i + 4), hi);
        i += 8;
    }
    i
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

/// The last fewer-than-16 rows as one full block of 16: the padding repeats
/// the first of them and its scores are dropped. A short block keeps only
/// one or two dependent sums in flight, so it waits on add latency; a full
/// block keeps four (x86) or eight (ARM). Each row's own sum is unchanged.
#[cfg(any(target_arch = "aarch64", target_arch = "x86_64"))]
#[inline(always)]
fn padded16(rest: &[u32]) -> ([u32; 16], [f64; 16]) {
    let mut pr = [rest[0]; 16];
    pr[..rest.len()].copy_from_slice(rest);
    (pr, [0f64; 16])
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
        if c < rows.len() {
            let (pr, mut po) = padded16(&rows[c..]);
            unsafe { pairs::<8>(data, dim, q, &pr, &mut po, fused) };
            out[c..rows.len()].copy_from_slice(&po[..rows.len() - c]);
            c = rows.len();
        }
    }
    #[cfg(target_arch = "x86_64")]
    if x86_v3() {
        let fused = q.iter().all(|&x| (x as f32) as f64 == x);
        while c + 16 <= rows.len() {
            unsafe { quads_avx2::<4>(data, dim, q, &rows[c..c + 16], &mut out[c..c + 16], fused) };
            c += 16;
        }
        if c < rows.len() {
            let (pr, mut po) = padded16(&rows[c..]);
            unsafe { quads_avx2::<4>(data, dim, q, &pr, &mut po, fused) };
            out[c..rows.len()].copy_from_slice(&po[..rows.len() - c]);
            c = rows.len();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int8_kernels_match_the_portable_loop() {
        let mut seed = 0x9e3779b97f4a7c15u64;
        let mut rnd = || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for &dim in &[1usize, 15, 16, 17, 63, 64, 65, 512, 768] {
            for _ in 0..50 {
                // Full range, including the extremes -128 and 127.
                let q: Vec<i8> = (0..dim).map(|_| rnd() as u8 as i8).collect();
                let v: Vec<i8> = (0..dim).map(|_| rnd() as u8 as i8).collect();
                let want = int8_dot_portable(&q, &v);
                assert_eq!(int8_dot(&q, &v), want, "int8_dot dim {dim}");
            }
        }
    }

    #[test]
    fn f16_widening_is_exact_for_every_value() {
        let src: Vec<u16> = (0..=u16::MAX).collect();
        let mut dst = vec![0f32; src.len()];
        f16_to_f32(&src, &mut dst);
        for (&h, &f) in src.iter().zip(&dst) {
            let want = f16_bits_to_f32(h);
            assert!(f.to_bits() == want.to_bits() || (f.is_nan() && want.is_nan()), "f16 {h:#06x}");
        }
        // Spot values.
        assert_eq!(f16_bits_to_f32(0x3c00), 1.0);
        assert_eq!(f16_bits_to_f32(0xc000), -2.0);
        assert_eq!(f16_bits_to_f32(0x0001), 2f32.powi(-24));
        assert_eq!(f16_bits_to_f32(0x7bff), 65504.0);
        assert_eq!(f16_bits_to_f32(0x7c00), f32::INFINITY);
    }
}
