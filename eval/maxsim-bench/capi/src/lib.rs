//! C ABI for the benchmark: the production kernel source, unchanged.

#[allow(dead_code)]
#[path = "../../../../crates/sweet-search-native/src/maxsim/kernel.rs"]
mod kernel;

use kernel::PerTokenDoc;

/// Scores `n` per-token docs (`bits` 4 or 8) against `query` (`num_q` × `dim`
/// f32) into `out[0..n]`. Doc `i` has `num_tokens[i]` tokens at `tokens[i]`
/// and f32 arrays `mins[i]`, `scales[i]`, `norms[i]`.
///
/// # Safety
/// Every pointer must be valid for the lengths implied by the arguments.
#[no_mangle]
pub unsafe extern "C" fn ss_maxsim_per_token(
    query: *const f32,
    num_q: u32,
    dim: u32,
    bits: u32,
    n: u32,
    tokens: *const *const u8,
    mins: *const *const f32,
    scales: *const *const f32,
    norms: *const *const f32,
    num_tokens: *const u32,
    out: *mut f64,
) {
    let (num_q, dim, n) = (num_q as usize, dim as usize, n as usize);
    let token_bytes = if bits == 4 { (dim + 1) / 2 } else { dim };
    let docs: Vec<PerTokenDoc> = (0..n)
        .map(|i| {
            let nt = *num_tokens.add(i) as usize;
            PerTokenDoc {
                tokens: std::slice::from_raw_parts(*tokens.add(i), nt * token_bytes),
                mins: std::slice::from_raw_parts(*mins.add(i), nt),
                scales: std::slice::from_raw_parts(*scales.add(i), nt),
                norms: std::slice::from_raw_parts(*norms.add(i), nt),
                num_tokens: nt,
            }
        })
        .collect();
    let scores = kernel::score_per_token(std::slice::from_raw_parts(query, num_q * dim), num_q, dim, bits, &docs);
    std::ptr::copy_nonoverlapping(scores.as_ptr(), out, n);
}

/// Wakes the worker pool ahead of a batch (see the kernel's `prewarm`).
#[no_mangle]
pub extern "C" fn ss_maxsim_prewarm(window_us: u32) {
    kernel::prewarm(std::time::Duration::from_micros(window_us as u64));
}
