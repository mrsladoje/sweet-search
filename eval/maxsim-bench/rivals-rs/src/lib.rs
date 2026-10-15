//! C-ABI shim over two rival MaxSim implementations, for eval/maxsim-bench.
//!
//! * NextPlaid (`next-plaid` 1.8.5, `maxsim::maxsim_score`): raw dot products, no normalisation,
//!   no clamp, SUM over query tokens (f32 accumulation).
//! * NumKong 7.8.5 (`nk_maxsim_*`): sum over query tokens of angular distance (1 - cosine, clamped >= 0),
//!   best doc token chosen by an int8 coarse screen. Pack outside the timer; score inside.
//!
//! Thread pools: a rayon pool is built ONCE per library on the first call with threads > 1 and is keyed
//! by that first size. Later calls with a different size reuse the first pool (a bench process must use one
//! thread count per library). threads == 1 runs a plain loop on the calling thread.

use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::ffi::c_char;
use std::sync::OnceLock;

use ndarray::ArrayView2;
use numkong::{bf16, f16};
use rayon::prelude::*;
use rayon::{ThreadPool, ThreadPoolBuilder};

// ---------------------------------------------------------------- build info
const BLAS: &str = if cfg!(feature = "accelerate") {
    "accelerate"
} else if cfg!(feature = "openblas") {
    "openblas"
} else {
    "default(no-blas)"
};

#[no_mangle]
pub extern "C" fn rv_build_info() -> *const c_char {
    static INFO: OnceLock<std::ffi::CString> = OnceLock::new();
    INFO.get_or_init(|| {
        std::ffi::CString::new(format!(
            "rivals-rs {}; next-plaid 1.8.5 blas={}; numkong 7.8.5; arch={}",
            env!("CARGO_PKG_VERSION"),
            BLAS,
            std::env::consts::ARCH
        ))
        .unwrap()
    })
    .as_ptr()
}

fn pool(cell: &'static OnceLock<ThreadPool>, threads: u32) -> &'static ThreadPool {
    cell.get_or_init(|| {
        ThreadPoolBuilder::new()
            .num_threads(threads as usize)
            .build()
            .expect("rayon pool")
    })
}

struct SendPtr<T>(*const T);
unsafe impl<T> Send for SendPtr<T> {}
unsafe impl<T> Sync for SendPtr<T> {}

// ---------------------------------------------------------------- NextPlaid
static NP_POOL: OnceLock<ThreadPool> = OnceLock::new();

/// out[i] = sum over query tokens of the max raw dot product with doc i (NextPlaid `maxsim_score`, f32 sum).
/// `query`: nq x dim row-major f32. `docs[i]`: doc_tokens[i] x dim row-major f32.
///
/// # Safety
/// All pointers must be valid for the stated sizes.
#[no_mangle]
pub unsafe extern "C" fn rv_nextplaid_scores(
    query: *const f32,
    nq: u32,
    dim: u32,
    n: u32,
    docs: *const *const f32,
    doc_tokens: *const u32,
    threads: u32,
    out: *mut f64,
) {
    let (nq, dim, n) = (nq as usize, dim as usize, n as usize);
    let q = ArrayView2::from_shape_ptr((nq, dim), query);
    let docs: Vec<SendPtr<f32>> = std::slice::from_raw_parts(docs, n).iter().map(|&p| SendPtr(p)).collect();
    let toks = std::slice::from_raw_parts(doc_tokens, n);
    let out = std::slice::from_raw_parts_mut(out, n);
    let one = |i: usize| -> f64 {
        let d = ArrayView2::from_shape_ptr((toks[i] as usize, dim), docs[i].0);
        next_plaid::maxsim::maxsim_score(&q, &d) as f64
    };
    if threads <= 1 {
        for (i, o) in out.iter_mut().enumerate() {
            *o = one(i);
        }
    } else {
        pool(&NP_POOL, threads).install(|| {
            out.par_iter_mut().enumerate().for_each(|(i, o)| *o = one(i));
        });
    }
}

// ---------------------------------------------------------------- NumKong
static NK_POOL: OnceLock<ThreadPool> = OnceLock::new();
static NK_CONFIGURED: OnceLock<bool> = OnceLock::new();

#[link(name = "numkong")]
extern "C" {
    fn nk_maxsim_packed_size_f32(n: usize, depth: usize) -> usize;
    fn nk_maxsim_pack_f32(v: *const f32, n: usize, depth: usize, stride: usize, packed: *mut u8);
    fn nk_maxsim_packed_f32(q: *const u8, d: *const u8, nq: usize, nd: usize, depth: usize, r: *mut f64);
    fn nk_maxsim_packed_size_f16(n: usize, depth: usize) -> usize;
    fn nk_maxsim_pack_f16(v: *const f16, n: usize, depth: usize, stride: usize, packed: *mut u8);
    fn nk_maxsim_packed_f16(q: *const u8, d: *const u8, nq: usize, nd: usize, depth: usize, r: *mut f32);
    fn nk_maxsim_packed_size_bf16(n: usize, depth: usize) -> usize;
    fn nk_maxsim_pack_bf16(v: *const bf16, n: usize, depth: usize, stride: usize, packed: *mut u8);
    fn nk_maxsim_packed_bf16(q: *const u8, d: *const u8, nq: usize, nd: usize, depth: usize, r: *mut f32);
}

/// dtype codes: 0 = f32, 1 = f16, 2 = bf16.
pub struct Packed {
    ptr: *mut u8,
    size: usize,
    n: usize,
    depth: usize,
    dtype: u32,
}
unsafe impl Send for Packed {}
unsafe impl Sync for Packed {}
const ALIGN: usize = 64;

impl Drop for Packed {
    fn drop(&mut self) {
        if self.size > 0 {
            unsafe { dealloc(self.ptr, Layout::from_size_align_unchecked(self.size, ALIGN)) }
        }
    }
}

/// Packs `n` x `dim` f32 row-major vectors (converted to `dtype` first). Call OUTSIDE the timer.
/// Returns an opaque handle, or null on bad dtype. Free with `rv_numkong_free`.
///
/// # Safety
/// `vecs` must hold n*dim f32.
#[no_mangle]
pub unsafe extern "C" fn rv_numkong_pack(dtype: u32, vecs: *const f32, n: u32, dim: u32) -> *mut Packed {
    // NumKong's Python module does this at import. On Linux x86 it requests the AMX tile
    // permission (arch_prctl, process-wide); without it the AMX kernels raise SIGILL on
    // Granite Rapids. It changes no floating-point settings.
    NK_CONFIGURED.get_or_init(numkong::configure_thread);
    let (n, dim) = (n as usize, dim as usize);
    let src = std::slice::from_raw_parts(vecs, n * dim);
    let size = match dtype {
        0 => nk_maxsim_packed_size_f32(n, dim),
        1 => nk_maxsim_packed_size_f16(n, dim),
        2 => nk_maxsim_packed_size_bf16(n, dim),
        _ => return std::ptr::null_mut(),
    };
    let ptr = alloc_zeroed(Layout::from_size_align(size.max(1), ALIGN).unwrap());
    match dtype {
        0 => nk_maxsim_pack_f32(src.as_ptr(), n, dim, dim * 4, ptr),
        1 => {
            let h: Vec<f16> = src.iter().map(|&x| f16::from_f32(x)).collect();
            nk_maxsim_pack_f16(h.as_ptr(), n, dim, dim * 2, ptr)
        }
        _ => {
            let h: Vec<bf16> = src.iter().map(|&x| bf16::from_f32(x)).collect();
            nk_maxsim_pack_bf16(h.as_ptr(), n, dim, dim * 2, ptr)
        }
    }
    Box::into_raw(Box::new(Packed { ptr, size: size.max(1), n, depth: dim, dtype }))
}

/// # Safety
/// `h` must come from `rv_numkong_pack` and not be freed twice.
#[no_mangle]
pub unsafe extern "C" fn rv_numkong_free(h: *mut Packed) {
    if !h.is_null() {
        drop(Box::from_raw(h));
    }
}

unsafe fn nk_pair(q: &Packed, d: &Packed) -> f64 {
    match q.dtype {
        0 => {
            let mut r = 0f64;
            nk_maxsim_packed_f32(q.ptr, d.ptr, q.n, d.n, q.depth, &mut r);
            r
        }
        1 => {
            let mut r = 0f32;
            nk_maxsim_packed_f16(q.ptr, d.ptr, q.n, d.n, q.depth, &mut r);
            r as f64
        }
        _ => {
            let mut r = 0f32;
            nk_maxsim_packed_bf16(q.ptr, d.ptr, q.n, d.n, q.depth, &mut r);
            r as f64
        }
    }
}

/// out[i] = NumKong `maxsim_packed(q, docs[i])` = sum over query tokens of angular distance (1 - cos, >= 0).
/// Query and docs must share dtype and dim. Pure scoring: no packing inside.
///
/// # Safety
/// Handles must be valid; `out` holds n f64.
#[no_mangle]
pub unsafe extern "C" fn rv_numkong_scores(
    q: *const Packed,
    n: u32,
    docs: *const *const Packed,
    threads: u32,
    out: *mut f64,
) {
    let n = n as usize;
    let q = &*q;
    let docs = std::slice::from_raw_parts(docs, n);
    let out = std::slice::from_raw_parts_mut(out, n);
    if threads <= 1 {
        for (o, d) in out.iter_mut().zip(docs) {
            *o = nk_pair(q, &**d);
        }
    } else {
        let docs: Vec<SendPtr<Packed>> = docs.iter().map(|&p| SendPtr(p)).collect();
        pool(&NK_POOL, threads).install(|| {
            out.par_iter_mut().zip(docs.par_iter()).for_each(|(o, d)| *o = nk_pair(q, &*d.0));
        });
    }
}
