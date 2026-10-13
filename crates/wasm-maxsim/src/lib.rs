//! WASM SIMD MaxSim kernel for Sweet Search.
//!
//! Entry points:
//!   - `maxsim_f32`:     float32 query × float32 doc → MaxSim score
//!   - `maxsim_dequant`: float32 query × int8 doc (fused dequant) → MaxSim score
//!
//! Compiled: RUSTFLAGS="-C target-feature=+simd128" cargo build --target wasm32-unknown-unknown --release

#![no_std]

use core::arch::wasm32::*;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

extern "C" {
    fn sqrtf(x: f32) -> f32;
}

#[inline(always)]
fn sqrt(x: f32) -> f32 {
    unsafe { sqrtf(x) }
}

#[inline(always)]
unsafe fn hsum(v: v128) -> f32 {
    f32x4_extract_lane::<0>(v)
        + f32x4_extract_lane::<1>(v)
        + f32x4_extract_lane::<2>(v)
        + f32x4_extract_lane::<3>(v)
}

/// Compute dot product and d_norm_sq for the scalar tail (dim % 4 remainder).
#[inline(always)]
unsafe fn scalar_tail(
    qb: *const f32,
    db: *const f32,
    start: usize,
    end: usize,
    dot: &mut f32,
    d_norm_sq: &mut f32,
) {
    for i in start..end {
        let qv = *qb.add(i);
        let dv = *db.add(i);
        *dot += qv * dv;
        *d_norm_sq += dv * dv;
    }
}

/// Compute q_norm_sq for the scalar tail.
#[inline(always)]
unsafe fn scalar_tail_norm(qb: *const f32, start: usize, end: usize, acc: &mut f32) {
    for i in start..end {
        let v = *qb.add(i);
        *acc += v * v;
    }
}

// =============================================================================
// MaxSim on pre-dequantized float32 data
// =============================================================================

#[no_mangle]
pub unsafe extern "C" fn maxsim_f32(
    q_ptr: *const f32,
    d_ptr: *const f32,
    num_q: u32,
    num_d: u32,
    dim: u32,
) -> f32 {
    let nq = num_q as usize;
    let nd = num_d as usize;
    let d = dim as usize;
    let simd_end = d & !3; // round down to multiple of 4
    let steps = simd_end / 4;
    let mut total: f32 = 0.0;

    for qi in 0..nq {
        let qb = q_ptr.add(qi * d);

        // Query norm: SIMD + scalar tail
        let mut qacc = f32x4_splat(0.0);
        for k in 0..steps {
            let qv = v128_load(qb.add(k * 4) as *const v128);
            qacc = f32x4_add(qacc, f32x4_mul(qv, qv));
        }
        let mut q_norm_sq = hsum(qacc);
        scalar_tail_norm(qb, simd_end, d, &mut q_norm_sq);
        let qn = sqrt(q_norm_sq);

        let mut best: f32 = -1.0;

        for di in 0..nd {
            let db = d_ptr.add(di * d);
            let mut dot_a = f32x4_splat(0.0);
            let mut nrm_a = f32x4_splat(0.0);

            for k in 0..steps {
                let qv = v128_load(qb.add(k * 4) as *const v128);
                let dv = v128_load(db.add(k * 4) as *const v128);
                dot_a = f32x4_add(dot_a, f32x4_mul(qv, dv));
                nrm_a = f32x4_add(nrm_a, f32x4_mul(dv, dv));
            }

            let mut dot = hsum(dot_a);
            let mut d_norm_sq = hsum(nrm_a);
            scalar_tail(qb, db, simd_end, d, &mut dot, &mut d_norm_sq);

            let sim = dot / (qn * sqrt(d_norm_sq) + 1e-8);
            if sim > best {
                best = sim;
            }
        }

        if best > 0.0 {
            total += best;
        }
    }

    total / nq as f32
}

// =============================================================================
// MaxSim with fused int8 dequantization (SIMD widening pipeline)
// =============================================================================

#[no_mangle]
pub unsafe extern "C" fn maxsim_dequant(
    q_ptr: *const f32,
    d_ptr: *const i8,
    num_q: u32,
    num_d: u32,
    dim: u32,
    min: f32,
    scale: f32,
) -> f32 {
    let nq = num_q as usize;
    let nd = num_d as usize;
    let d = dim as usize;
    let steps16 = d / 16;
    let simd_end16 = steps16 * 16;
    // Remaining elements after 16-wide pass, in groups of 4
    let tail_start4 = simd_end16;
    let tail_end4 = d & !3;
    let scalar_start = tail_end4;

    let off128 = f32x4_splat(128.0);
    let sv = f32x4_splat(scale);
    let mv = f32x4_splat(min);

    let mut total: f32 = 0.0;

    for qi in 0..nq {
        let qb = q_ptr.add(qi * d);

        // Query norm (float32, SIMD + tail)
        let simd_end_q = (d & !3) / 4;
        let mut qacc = f32x4_splat(0.0);
        for k in 0..simd_end_q {
            let qv = v128_load(qb.add(k * 4) as *const v128);
            qacc = f32x4_add(qacc, f32x4_mul(qv, qv));
        }
        let mut q_norm_sq = hsum(qacc);
        scalar_tail_norm(qb, d & !3, d, &mut q_norm_sq);
        let qn = sqrt(q_norm_sq);

        let mut best: f32 = -1.0;

        for di in 0..nd {
            let db = d_ptr.add(di * d);
            let mut dot_a = f32x4_splat(0.0);
            let mut nrm_a = f32x4_splat(0.0);

            // 16-wide pass: load 16 int8, widen to 4 groups of f32x4
            for s in 0..steps16 {
                let byte_off = s * 16;
                let float_off = s * 16;

                let raw = v128_load(db.add(byte_off) as *const v128);
                let lo16 = i16x8_extend_low_i8x16(raw);
                let hi16 = i16x8_extend_high_i8x16(raw);

                // Group 0: elements 0-3
                let fv0 = f32x4_convert_i32x4(i32x4_extend_low_i16x8(lo16));
                let dv0 = f32x4_add(f32x4_mul(f32x4_add(fv0, off128), sv), mv);
                let qv0 = v128_load(qb.add(float_off) as *const v128);
                dot_a = f32x4_add(dot_a, f32x4_mul(qv0, dv0));
                nrm_a = f32x4_add(nrm_a, f32x4_mul(dv0, dv0));

                // Group 1: elements 4-7
                let fv1 = f32x4_convert_i32x4(i32x4_extend_high_i16x8(lo16));
                let dv1 = f32x4_add(f32x4_mul(f32x4_add(fv1, off128), sv), mv);
                let qv1 = v128_load(qb.add(float_off + 4) as *const v128);
                dot_a = f32x4_add(dot_a, f32x4_mul(qv1, dv1));
                nrm_a = f32x4_add(nrm_a, f32x4_mul(dv1, dv1));

                // Group 2: elements 8-11
                let fv2 = f32x4_convert_i32x4(i32x4_extend_low_i16x8(hi16));
                let dv2 = f32x4_add(f32x4_mul(f32x4_add(fv2, off128), sv), mv);
                let qv2 = v128_load(qb.add(float_off + 8) as *const v128);
                dot_a = f32x4_add(dot_a, f32x4_mul(qv2, dv2));
                nrm_a = f32x4_add(nrm_a, f32x4_mul(dv2, dv2));

                // Group 3: elements 12-15
                let fv3 = f32x4_convert_i32x4(i32x4_extend_high_i16x8(hi16));
                let dv3 = f32x4_add(f32x4_mul(f32x4_add(fv3, off128), sv), mv);
                let qv3 = v128_load(qb.add(float_off + 12) as *const v128);
                dot_a = f32x4_add(dot_a, f32x4_mul(qv3, dv3));
                nrm_a = f32x4_add(nrm_a, f32x4_mul(dv3, dv3));
            }

            let mut dot = hsum(dot_a);
            let mut d_norm_sq = hsum(nrm_a);

            // Scalar tail for remaining elements (dim % 16)
            for i in tail_start4..d {
                let raw_val = *db.add(i) as f32;
                let dv = (raw_val + 128.0) * scale + min;
                let qv = *qb.add(i);
                dot += qv * dv;
                d_norm_sq += dv * dv;
            }

            let sim = dot / (qn * sqrt(d_norm_sq) + 1e-8);
            if sim > best {
                best = sim;
            }
        }

        if best > 0.0 {
            total += best;
        }
    }

    total / nq as f32
}

// =============================================================================
// MaxSim with per-token int8 dequant + pre-stored norms (Phase 4)
// Eliminates d_norm_sq recomputation — uses pre-stored norms instead.
// =============================================================================

#[no_mangle]
pub unsafe extern "C" fn maxsim_dequant_pertoken(
    q_ptr: *const f32,
    d_ptr: *const i8,
    min_ptr: *const f32,
    scale_ptr: *const f32,
    norm_ptr: *const f32,
    num_q: u32,
    num_d: u32,
    dim: u32,
) -> f32 {
    let nq = num_q as usize;
    let nd = num_d as usize;
    let d = dim as usize;
    let steps16 = d / 16;
    let simd_end16 = steps16 * 16;
    let mut total: f32 = 0.0;

    for qi in 0..nq {
        let qb = q_ptr.add(qi * d);

        let simd_end_q = (d & !3) / 4;
        let mut qacc = f32x4_splat(0.0);
        for k in 0..simd_end_q {
            let qv = v128_load(qb.add(k * 4) as *const v128);
            qacc = f32x4_add(qacc, f32x4_mul(qv, qv));
        }
        let mut q_norm_sq = hsum(qacc);
        scalar_tail_norm(qb, d & !3, d, &mut q_norm_sq);
        let qn = sqrt(q_norm_sq);

        let mut best: f32 = -1.0;

        for di in 0..nd {
            let db = d_ptr.add(di * d);
            let tmin = *min_ptr.add(di);
            let tscale = *scale_ptr.add(di);
            let d_norm = *norm_ptr.add(di);

            let off128v = f32x4_splat(128.0);
            let sv = f32x4_splat(tscale);
            let mv = f32x4_splat(tmin);
            let mut dot_a = f32x4_splat(0.0);

            for s in 0..steps16 {
                let byte_off = s * 16;
                let float_off = s * 16;
                let raw = v128_load(db.add(byte_off) as *const v128);
                let lo16 = i16x8_extend_low_i8x16(raw);
                let hi16 = i16x8_extend_high_i8x16(raw);

                let fv0 = f32x4_convert_i32x4(i32x4_extend_low_i16x8(lo16));
                let dv0 = f32x4_add(f32x4_mul(f32x4_add(fv0, off128v), sv), mv);
                dot_a = f32x4_add(dot_a, f32x4_mul(v128_load(qb.add(float_off) as *const v128), dv0));

                let fv1 = f32x4_convert_i32x4(i32x4_extend_high_i16x8(lo16));
                let dv1 = f32x4_add(f32x4_mul(f32x4_add(fv1, off128v), sv), mv);
                dot_a = f32x4_add(dot_a, f32x4_mul(v128_load(qb.add(float_off + 4) as *const v128), dv1));

                let fv2 = f32x4_convert_i32x4(i32x4_extend_low_i16x8(hi16));
                let dv2 = f32x4_add(f32x4_mul(f32x4_add(fv2, off128v), sv), mv);
                dot_a = f32x4_add(dot_a, f32x4_mul(v128_load(qb.add(float_off + 8) as *const v128), dv2));

                let fv3 = f32x4_convert_i32x4(i32x4_extend_high_i16x8(hi16));
                let dv3 = f32x4_add(f32x4_mul(f32x4_add(fv3, off128v), sv), mv);
                dot_a = f32x4_add(dot_a, f32x4_mul(v128_load(qb.add(float_off + 12) as *const v128), dv3));
            }

            let mut dot = hsum(dot_a);
            for i in simd_end16..d {
                let raw_val = *db.add(i) as f32;
                dot += *qb.add(i) * ((raw_val + 128.0) * tscale + tmin);
            }

            let sim = dot / (qn * d_norm + 1e-8);
            if sim > best { best = sim; }
        }

        if best > 0.0 { total += best; }
    }

    total / nq as f32
}

// =============================================================================
// MaxSim with 4-bit nibble-packed dequant + pre-stored norms (Phase 4)
// =============================================================================

#[no_mangle]
pub unsafe extern "C" fn maxsim_dequant_4bit(
    q_ptr: *const f32,
    d_ptr: *const u8,
    min_ptr: *const f32,
    scale_ptr: *const f32,
    norm_ptr: *const f32,
    num_q: u32,
    num_d: u32,
    dim: u32,
) -> f32 {
    let nq = num_q as usize;
    let nd = num_d as usize;
    let d = dim as usize;
    let packed_dim = (d + 1) / 2;
    let mut total: f32 = 0.0;

    for qi in 0..nq {
        let qb = q_ptr.add(qi * d);

        let simd_end_q = (d & !3) / 4;
        let mut qacc = f32x4_splat(0.0);
        for k in 0..simd_end_q {
            let qv = v128_load(qb.add(k * 4) as *const v128);
            qacc = f32x4_add(qacc, f32x4_mul(qv, qv));
        }
        let mut q_norm_sq = hsum(qacc);
        scalar_tail_norm(qb, d & !3, d, &mut q_norm_sq);
        let qn = sqrt(q_norm_sq);

        let mut best: f32 = -1.0;

        for di in 0..nd {
            let db = d_ptr.add(di * packed_dim);
            let tmin = *min_ptr.add(di);
            let tscale = *scale_ptr.add(di);
            let d_norm = *norm_ptr.add(di);

            let mut dot: f32 = 0.0;
            for dd in (0..d).step_by(2) {
                let byte = *db.add(dd / 2);
                let lo = (byte & 0x0F) as f32 * tscale + tmin;
                dot += *qb.add(dd) * lo;
                if dd + 1 < d {
                    let hi = ((byte >> 4) & 0x0F) as f32 * tscale + tmin;
                    dot += *qb.add(dd + 1) * hi;
                }
            }

            let sim = dot / (qn * d_norm + 1e-8);
            if sim > best { best = sim; }
        }

        if best > 0.0 { total += best; }
    }

    total / nq as f32
}

// =============================================================================
// 4-bit MaxSim, tiled across pairs: same scores as maxsim_dequant_4bit
// =============================================================================
//
// `maxsim_dequant_4bit` sums each (query token, doc token) pair as one scalar
// chain, `dot = ((0 + q0*v0) + q1*v1) + ...`, and dequantizes every doc token
// again for every query token. Here each doc token is dequantized once per
// 64-token tile into a transposed buffer (`scratch`, element-major, 64 floats
// per element), and f32x4 lanes hold 4 different doc tokens: lane l of an
// accumulator runs exactly that scalar chain for its own pair (mul, then add,
// in element order), so every dot, similarity and score is the same f32. Four
// query rows × 8 doc tokens give 8 independent chains. The per-query maximum
// uses `pmax` (b < a ? a : b, i.e. `if sim > best`: a NaN never wins); padded
// lanes (zero doc rows, norm 1) can only lift a maximum to 0, which contributes 0.

const T4_TILE: usize = 64;

/// One block: query rows `q0..q0+R` (row stride `d`) × 4·B doc tokens of the
/// transposed tile starting at column `t0`. Returns the updated per-row maxima.
#[inline(always)]
unsafe fn t4_block<const R: usize, const B: usize>(
    q_ptr: *const f32,
    qn: *const f32,
    tile_t: *const f32,
    norms: *const f32,
    d: usize,
    q0: usize,
    t0: usize,
    best: &mut [v128; 4],
) {
    let mut acc = [[f32x4_splat(0.0); B]; R];
    for k in 0..d {
        let row = tile_t.add(k * T4_TILE + t0);
        let mut dv = [f32x4_splat(0.0); B];
        for b in 0..B {
            dv[b] = v128_load(row.add(4 * b) as *const v128);
        }
        for r in 0..R {
            let qv = f32x4_splat(*q_ptr.add((q0 + r) * d + k));
            for b in 0..B {
                acc[r][b] = f32x4_add(acc[r][b], f32x4_mul(qv, dv[b]));
            }
        }
    }
    let eps = f32x4_splat(1e-8);
    for r in 0..R {
        let qnv = f32x4_splat(*qn.add(q0 + r));
        for b in 0..B {
            let nv = v128_load(norms.add(t0 + 4 * b) as *const v128);
            let sim = f32x4_div(acc[r][b], f32x4_add(f32x4_mul(qnv, nv), eps));
            best[r] = f32x4_pmax(best[r], sim);
        }
    }
}

#[inline(always)]
unsafe fn t4_rows<const R: usize>(
    q_ptr: *const f32,
    qn: *const f32,
    tile_t: *const f32,
    norms: *const f32,
    d: usize,
    q0: usize,
    len_pad: usize,
    best_out: *mut f32,
) {
    let mut best = [f32x4_splat(-1.0); 4];
    let mut t0 = 0;
    while t0 + 8 <= len_pad {
        t4_block::<R, 2>(q_ptr, qn, tile_t, norms, d, q0, t0, &mut best);
        t0 += 8;
    }
    if t0 < len_pad {
        t4_block::<R, 1>(q_ptr, qn, tile_t, norms, d, q0, t0, &mut best);
    }
    for r in 0..R {
        let b = best_out.add(q0 + r);
        let lanes = [
            f32x4_extract_lane::<0>(best[r]),
            f32x4_extract_lane::<1>(best[r]),
            f32x4_extract_lane::<2>(best[r]),
            f32x4_extract_lane::<3>(best[r]),
        ];
        for v in lanes {
            if v > *b {
                *b = v;
            }
        }
    }
}

/// Same contract and result as `maxsim_dequant_4bit`. `scratch` must point to
/// `16 + 4 * (2 * num_q + 4 + T4_TILE * (dim + 1))` writable bytes (16-byte
/// aligned after rounding up) that do not overlap the inputs.
#[no_mangle]
pub unsafe extern "C" fn maxsim_dequant_4bit_tiled(
    q_ptr: *const f32,
    d_ptr: *const u8,
    min_ptr: *const f32,
    scale_ptr: *const f32,
    norm_ptr: *const f32,
    num_q: u32,
    num_d: u32,
    dim: u32,
    scratch: *mut f32,
) -> f32 {
    let nq = num_q as usize;
    let nd = num_d as usize;
    let d = dim as usize;
    let packed_dim = (d + 1) / 2;
    // Scratch: [tile_t: T4_TILE * d][norms: T4_TILE][qn: nq][best: nq], 16-byte aligned.
    let base = ((scratch as usize + 15) & !15) as *mut f32;
    let tile_t = base;
    let norms = tile_t.add(T4_TILE * d);
    let qn = norms.add(T4_TILE);
    let best = qn.add(nq);

    // Query norms: the same computation as maxsim_dequant_4bit.
    for qi in 0..nq {
        let qb = q_ptr.add(qi * d);
        let mut qacc = f32x4_splat(0.0);
        for k in 0..(d & !3) / 4 {
            let qv = v128_load(qb.add(k * 4) as *const v128);
            qacc = f32x4_add(qacc, f32x4_mul(qv, qv));
        }
        let mut q_norm_sq = hsum(qacc);
        scalar_tail_norm(qb, d & !3, d, &mut q_norm_sq);
        *qn.add(qi) = sqrt(q_norm_sq);
        *best.add(qi) = -1.0;
    }

    let mut start = 0;
    while start < nd {
        let len = if nd - start < T4_TILE { nd - start } else { T4_TILE };
        let len_pad = (len + 3) & !3;
        for t in 0..len {
            let di = start + t;
            let db = d_ptr.add(di * packed_dim);
            let tmin = *min_ptr.add(di);
            let tscale = *scale_ptr.add(di);
            for k in 0..d {
                let byte = *db.add(k / 2);
                let nib = if k & 1 == 0 { byte & 0x0F } else { (byte >> 4) & 0x0F };
                *tile_t.add(k * T4_TILE + t) = nib as f32 * tscale + tmin;
            }
            *norms.add(t) = *norm_ptr.add(di);
        }
        for t in len..len_pad {
            for k in 0..d {
                *tile_t.add(k * T4_TILE + t) = 0.0;
            }
            *norms.add(t) = 1.0;
        }
        let mut q0 = 0;
        while q0 < nq {
            match nq - q0 {
                1 => t4_rows::<1>(q_ptr, qn, tile_t, norms, d, q0, len_pad, best),
                2 => t4_rows::<2>(q_ptr, qn, tile_t, norms, d, q0, len_pad, best),
                3 => t4_rows::<3>(q_ptr, qn, tile_t, norms, d, q0, len_pad, best),
                _ => t4_rows::<4>(q_ptr, qn, tile_t, norms, d, q0, len_pad, best),
            }
            q0 += 4;
        }
        start += len;
    }

    let mut total: f32 = 0.0;
    for qi in 0..nq {
        let b = *best.add(qi);
        if b > 0.0 {
            total += b;
        }
    }
    total / nq as f32
}
