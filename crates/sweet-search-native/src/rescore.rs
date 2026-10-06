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
        let mut dot = 0i32;
        for i in 0..dim {
            dot += q[i] as i32 * v[i] as i32;
        }
        *o = dot as f64 * scale;
    }
    Ok(())
}

/// Sequential f64 dot of `q` with f32 rows, eight rows at a time (each row
/// keeps its own accumulator and order, exactly as in `float32BatchDot`),
/// written to `out[0..rows.len()]`.
#[napi]
pub fn f32_dot_scores(data: Float32Array, dim: u32, query: Float64Array, rows: Uint32Array, mut out: Float64Array) -> napi::Result<()> {
    let dim = dim as usize;
    if query.len() != dim || out.len() < rows.len() {
        return Err(napi::Error::from_reason("f32_dot_scores: bad query or output length"));
    }
    check_rows(&rows, dim, data.len())?;
    prefetch_rows(data.as_ptr() as *const u8, dim * 4, &rows);
    let q: &[f64] = &query;
    let row = |r: u32| &data[r as usize * dim..(r as usize + 1) * dim];
    let out = out.as_mut();
    let mut c = 0;
    while c + 8 <= rows.len() {
        let v: [&[f32]; 8] = std::array::from_fn(|j| row(rows[c + j]));
        let mut d = [0f64; 8];
        for i in 0..dim {
            let x = q[i];
            for j in 0..8 {
                d[j] += x * v[j][i] as f64;
            }
        }
        out[c..c + 8].copy_from_slice(&d);
        c += 8;
    }
    while c < rows.len() {
        let v = row(rows[c]);
        let mut d = 0f64;
        for i in 0..dim {
            d += q[i] * v[i] as f64;
        }
        out[c] = d;
        c += 1;
    }
    Ok(())
}
