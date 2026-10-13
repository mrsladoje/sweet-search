//! MaxSim N-API entry points over `kernel`: late-interaction scoring of a
//! query against a batch of quantized candidate documents.

mod kernel;

use kernel::{PerDocInt8, PerTokenDoc};
use napi::bindgen_prelude::*;
use napi_derive::napi;

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

// =============================================================================
// NAPI entry points
// =============================================================================
//
// All batch entry points borrow the JS-owned buffers directly (`&[u8]` /
// `&[f32]` are Send) instead of copying them: the functions are synchronous,
// so the JS thread is blocked for the whole call and V8 cannot collect or
// move the backing stores while the pool's workers read them.

/// Reinterpret a byte slice as i8 without copying (`u8 as i8` is the same bit
/// pattern this view produces).
#[inline(always)]
fn bytes_as_i8(bytes: &[u8]) -> &[i8] {
    // SAFETY: u8 and i8 have identical size/alignment.
    unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const i8, bytes.len()) }
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

/// Score all candidates in parallel.
///
/// Returns an array of MaxSim scores (one per candidate). Each candidate is
/// dequantized tile-by-tile with its per-doc min/scale.
#[napi]
pub fn maxsim_score_batch(
    query_flat: Float32Array,
    num_q: u32,
    dim: u32,
    candidates: Vec<MaxSimCandidate>,
) -> Result<Vec<f64>> {
    let dim = dim as usize;
    check_candidate_dims(candidates.iter().map(|c| c.dim), dim)?;
    let docs: Vec<PerDocInt8> = candidates
        .iter()
        .map(|c| {
            let num_tokens = c.num_tokens as usize;
            let tokens: &[u8] = c.tokens.as_ref();
            assert!(tokens.len() >= num_tokens * dim, "maxsim: tokens buffer too small");
            PerDocInt8 { tokens: bytes_as_i8(tokens), min: c.min as f32, scale: c.scale as f32, num_tokens }
        })
        .collect();
    Ok(kernel::score_per_doc_int8(query_flat.as_ref(), num_q as usize, dim, &docs))
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
    kernel::score_single_f32(query_flat.as_ref(), doc_flat.as_ref(), num_q as usize, num_d as usize, dim as usize)
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

/// Per-token docs from candidate objects (`token_bytes` bytes per token).
fn per_token_docs<'a>(
    cands: impl Iterator<Item = (&'a Buffer, u32, &'a Float32Array, &'a Float32Array, &'a Float32Array)>,
    token_bytes: usize,
) -> Vec<PerTokenDoc<'a>> {
    cands
        .map(|(tokens, num_tokens, mins, scales, norms)| {
            let num_tokens = num_tokens as usize;
            let tokens: &[u8] = tokens.as_ref();
            let (mins, scales, norms): (&[f32], &[f32], &[f32]) = (mins.as_ref(), scales.as_ref(), norms.as_ref());
            assert!(tokens.len() >= num_tokens * token_bytes, "maxsim: tokens buffer too small");
            assert!(
                mins.len() >= num_tokens && scales.len() >= num_tokens && norms.len() >= num_tokens,
                "maxsim: per-token arrays too small"
            );
            PerTokenDoc { tokens, mins, scales, norms, num_tokens }
        })
        .collect()
}

/// Batch scoring with per-token quantization and pre-stored norms.
#[napi]
pub fn maxsim_score_batch_pertoken(
    query_flat: Float32Array,
    num_q: u32,
    dim: u32,
    candidates: Vec<MaxSimCandidatePerToken>,
) -> Result<Vec<f64>> {
    let dim = dim as usize;
    check_candidate_dims(candidates.iter().map(|c| c.dim), dim)?;
    let docs = per_token_docs(candidates.iter().map(|c| (&c.tokens, c.num_tokens, &c.min_array, &c.scale_array, &c.token_norms)), dim);
    Ok(kernel::score_per_token(query_flat.as_ref(), num_q as usize, dim, 8, &docs))
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
    let dim = dim as usize;
    check_candidate_dims(candidates.iter().map(|c| c.dim), dim)?;
    let docs = per_token_docs(candidates.iter().map(|c| (&c.tokens, c.num_tokens, &c.min_array, &c.scale_array, &c.token_norms)), (dim + 1) / 2);
    Ok(kernel::score_per_token(query_flat.as_ref(), num_q as usize, dim, 4, &docs))
}

/// Batch scoring from packed descriptors: the production entry point.
///
/// The object-per-candidate entry points cost ~1-1.7 µs per candidate in N-API
/// property reads and type checks alone. Here the candidates' arrays live in a
/// few shared buffers (one slab per index segment) and one `Uint32Array`
/// describes them, so the N-API work per call is one typed-array read per
/// distinct buffer.
///
/// `bits` is 4 (int4 nibble-packed, `ceil(dim/2)` bytes per token) or 8 (int8,
/// `dim` bytes per token); both use per-token min/scale and stored norms.
/// `desc` holds 10 u32 per candidate: `numTokens, dim, tokensBuf,
/// tokensOffset, minBuf, minOffset, scaleBuf, scaleOffset, normBuf,
/// normOffset` (buffer indices into `buffers`, byte offsets into them). Every
/// range is bounds-checked, every f32 array must be 4-byte aligned and every
/// dim must equal the query dim; a bad descriptor is a JS error. Scores are the same as `maxsimScoreBatch4Bit` /
/// `maxsimScoreBatchPertoken` on the same data.
#[napi]
pub fn maxsim_score_packed(
    query_flat: Float32Array,
    num_q: u32,
    dim: u32,
    bits: u32,
    buffers: Vec<Uint8Array>,
    desc: Uint32Array,
) -> Result<Float64Array> {
    let dim = dim as usize;
    let token_bytes = match bits {
        4 => (dim + 1) / 2,
        8 => dim,
        _ => return Err(Error::new(Status::InvalidArg, format!("maxsim: bits must be 4 or 8, got {bits}"))),
    };
    let desc: &[u32] = desc.as_ref();
    if desc.len() % 10 != 0 {
        return Err(Error::new(Status::InvalidArg, "maxsim: desc length must be a multiple of 10".to_string()));
    }
    check_candidate_dims(desc.chunks_exact(10).map(|d| d[1]), dim)?;
    let bufs: Vec<&[u8]> = buffers.iter().map(|b| b.as_ref()).collect();
    let bytes = |buf: u32, off: u32, len: usize| -> Result<&[u8]> {
        let b = bufs.get(buf as usize).ok_or_else(|| Error::new(Status::InvalidArg, format!("maxsim: buffer index {buf} out of range")))?;
        let off = off as usize;
        off.checked_add(len)
            .filter(|&end| end <= b.len())
            .map(|end| &b[off..end])
            .ok_or_else(|| Error::new(Status::InvalidArg, format!("maxsim: range {off}+{len} outside buffer {buf}")))
    };
    let floats = |buf: u32, off: u32, n: usize| -> Result<&[f32]> {
        let b = bytes(buf, off, n * 4)?;
        if n == 0 {
            // An empty JS array may report a dangling (unaligned) data pointer.
            return Ok(&[]);
        }
        if (b.as_ptr() as usize) % std::mem::align_of::<f32>() != 0 {
            return Err(Error::new(Status::InvalidArg, format!("maxsim: f32 array at {off} in buffer {buf} is not 4-byte aligned")));
        }
        // SAFETY: in bounds, aligned, and any bit pattern is a valid f32.
        Ok(unsafe { std::slice::from_raw_parts(b.as_ptr() as *const f32, n) })
    };
    let mut docs: Vec<PerTokenDoc> = Vec::with_capacity(desc.len() / 10);
    for d in desc.chunks_exact(10) {
        let num_tokens = d[0] as usize;
        docs.push(PerTokenDoc {
            tokens: bytes(d[2], d[3], num_tokens * token_bytes)?,
            mins: floats(d[4], d[5], num_tokens)?,
            scales: floats(d[6], d[7], num_tokens)?,
            norms: floats(d[8], d[9], num_tokens)?,
            num_tokens,
        });
    }
    Ok(Float64Array::new(kernel::score_per_token(query_flat.as_ref(), num_q as usize, dim, bits, &docs)))
}

/// Wakes the MaxSim worker pool ahead of a batch: call it when scoring is
/// about to start (e.g. on entering the rerank stage) so the ~0.1-1 ms it takes
/// sleeping threads and idle cores to come up overlaps the caller's own
/// preparation. Workers spin for up to `window_us` (default 1000, max 5000)
/// waiting for the batch, then park again. Scores are unaffected.
#[napi]
pub fn maxsim_prewarm(window_us: Option<u32>) {
    kernel::prewarm(std::time::Duration::from_micros(window_us.unwrap_or(1000) as u64));
}
