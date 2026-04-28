//! Flash-attention variable-length packing helpers.
//!
//! `candle_nn::ops::sdpa` has no CUDA backend (the v2.3.0 release fell
//! through to a naive matmul→softmax→matmul attention because of this).
//! `candle_flash_attn::flash_attn_varlen` is the CUDA-native fused kernel
//! we want — it keeps online-softmax statistics in F32 internally so BF16
//! input runs without the precision drift the naive path produces (LI
//! per-token min cosine dropped to 0.69 in v2.3.0 BF16 testing).
//!
//! The catch: flash-attn expects packed inputs `(total_tokens, H, D)`
//! plus a `cu_seqlens` array of cumulative per-batch lengths, instead of
//! the padded `(B, H, S, D)` + additive mask we use everywhere else.
//! This module owns that conversion in both directions.
//!
//! Performance:
//!   - Common case (all sequences in batch full, no padding): pack/unpack
//!     are zero-copy reshapes; the only cost is computing the mask sum.
//!   - Padded case (cache-aware bucketer boundary batches): per-batch
//!     `narrow` + `cat`, dominated by H2D copies for cu_seqlens.
//!
//! Activation gate (in nomic_bert_sdpa.rs / modernbert_sdpa.rs):
//!   - cfg(feature = "flash-attn")    — kernel must be compiled in
//!   - device is Cuda                  — kernel is CUDA-only
//!   - SM ≥ 8.0                        — flash-attn-v2 has no Volta/Turing path
//!   - dtype is F16 or BF16            — flash-attn rejects F32 inputs
//!   - seq_len > 8                     — match the existing short-seq gate

#![cfg(feature = "flash-attn")]

use candle_core::{DType, Device, Result, Tensor, D};

/// Threshold below which a mask value is treated as padding.
///
/// `get_extended_attention_mask` in upstream BERT-style models writes
/// `0.0` for valid positions and `-1e4` (or `-3.4e38` for some variants)
/// for padding. Anything more negative than -100 is unambiguously padding;
/// anything closer to 0 is valid. Avoids equality checks that can break
/// after BF16 round-tripping.
const PADDING_THRESHOLD: f32 = -100.0;

/// Read per-batch valid sequence lengths from an additive padding mask.
///
/// Accepts both common 4D mask layouts:
///   - `(B, 1, 1, S)`  — NomicBERT / get_extended_attention_mask style.
///                        Padding info is in the last dim.
///   - `(B, 1, S, S)`  — ModernBERT / prepare_4d_attention_mask style.
///                        The padding pattern is replicated across the
///                        query dim. We `max(query_dim)` to recover the
///                        per-key padding pattern; for combined masks
///                        that mix padding + sliding-window restriction
///                        as additive bias, this picks up only the
///                        positions that are valid for AT LEAST ONE
///                        query — i.e., true padding columns.
///
/// Padding sentinel: any value `< PADDING_THRESHOLD` (-100). `0.0` for
/// valid positions and large negatives (-1e4 typically) for padding.
///
/// Forces a CPU sync (the seqlens are needed as Rust integers for slicing
/// and for the cu_seqlens tensor build). Cost is small (~50-200µs) and
/// pays for itself even for short sequences once the fused attention
/// kernel takes over.
pub fn extract_seqlens_from_mask(attention_mask: &Tensor) -> Result<Vec<u32>> {
    let dims = attention_mask.dims();
    if dims.len() != 4 {
        return Err(candle_core::Error::Msg(format!(
            "extract_seqlens_from_mask: expected 4D mask (B, 1, ?, S), got {:?}",
            dims
        )));
    }

    let mask = attention_mask.to_dtype(DType::F32)?;
    let mask_2d = match (dims[1], dims[2]) {
        (1, 1) => {
            // (B, 1, 1, S) — squeeze both size-1 middle dims.
            mask.squeeze(1)?.squeeze(1)?
        }
        (1, _) => {
            // (B, 1, S, S) — squeeze head dim, then max over query dim.
            // Reducing with max (rather than picking row 0) is robust to
            // combined padding+window masks: a key column is "valid" iff
            // ANY query can attend to it, which is exactly the padding
            // criterion. Taking row 0 would mis-classify columns outside
            // query 0's window as padding.
            mask.squeeze(1)?.max(1)?
        }
        _ => {
            return Err(candle_core::Error::Msg(format!(
                "extract_seqlens_from_mask: unsupported mask shape {:?}",
                dims
            )));
        }
    };

    let valid = mask_2d.ge(PADDING_THRESHOLD)?; // u8 (B, S)
    valid.to_dtype(DType::U32)?.sum(D::Minus1)?.to_vec1::<u32>()
}

/// Build the cumulative-seqlen tensor flash_attn_varlen consumes.
///
/// Shape: `(B+1,)` with `cu[0] = 0` and `cu[i+1] - cu[i] = seqlens[i]`.
pub fn cu_seqlens(seqlens: &[u32], device: &Device) -> Result<Tensor> {
    let mut cu = Vec::with_capacity(seqlens.len() + 1);
    cu.push(0u32);
    let mut sum: u32 = 0;
    for &len in seqlens {
        sum = sum.saturating_add(len);
        cu.push(sum);
    }
    Tensor::from_vec(cu, (seqlens.len() + 1,), device)
}

/// Pack `(B, H, S, D)` → `(total_valid, H, D)` by dropping padded rows.
///
/// Fast path when no padding (`total_valid == B*S`): single transpose +
/// reshape, no per-row work. Slow path is per-batch `narrow` + `cat`.
fn pack(t: &Tensor, seqlens: &[u32], total_valid: u32) -> Result<Tensor> {
    let (b, h, s, d) = t.dims4()?;
    if b != seqlens.len() {
        return Err(candle_core::Error::Msg(format!(
            "pack: batch size mismatch (tensor B={}, seqlens len={})",
            b,
            seqlens.len()
        )));
    }

    // Fast path: every sequence is full length.
    let total_full = (b as u32).saturating_mul(s as u32);
    if total_valid == total_full {
        // (B, H, S, D) → (B, S, H, D) → (B*S, H, D)
        return t.transpose(1, 2)?.contiguous()?.reshape((b * s, h, d));
    }

    // Slow path: per-batch slice and concatenate.
    // (B, H, S, D) → (B, S, H, D) once, then narrow each batch row by its len.
    let t_bshd = t.transpose(1, 2)?.contiguous()?;
    let mut slices: Vec<Tensor> = Vec::with_capacity(b);
    for (i, &len) in seqlens.iter().enumerate() {
        if len == 0 {
            continue;
        }
        let row = t_bshd
            .narrow(0, i, 1)? // (1, S, H, D)
            .narrow(1, 0, len as usize)? // (1, len, H, D)
            .reshape((len as usize, h, d))?;
        slices.push(row);
    }
    if slices.is_empty() {
        // Edge case: every sequence is empty. Return an empty (0, H, D) tensor.
        return Tensor::zeros((0, h, d), t.dtype(), t.device());
    }
    Tensor::cat(&slices, 0)
}

/// Unpack `(total_valid, H, D)` flash-attn output back to `(B, H, S, D)`,
/// zero-filling padding positions.
fn unpack(packed: &Tensor, seqlens: &[u32], batch_size: usize, seq_len: usize) -> Result<Tensor> {
    let dims = packed.dims();
    if dims.len() != 3 {
        return Err(candle_core::Error::Msg(format!(
            "unpack: expected packed (total, H, D), got {:?}",
            dims
        )));
    }
    let (_total, h, d) = (dims[0], dims[1], dims[2]);
    let total_full = (batch_size as u32).saturating_mul(seq_len as u32);
    let total_valid: u32 = seqlens.iter().copied().sum();

    // Fast path: no padding to fill.
    if total_valid == total_full {
        return packed
            .reshape((batch_size, seq_len, h, d))?
            .transpose(1, 2)?
            .contiguous();
    }

    // Slow path: rebuild row by row, padding with zeros where seqlen < S.
    let mut rows: Vec<Tensor> = Vec::with_capacity(batch_size);
    let mut offset: u32 = 0;
    for &len in seqlens {
        if len == 0 {
            rows.push(Tensor::zeros(
                (1, seq_len, h, d),
                packed.dtype(),
                packed.device(),
            )?);
            continue;
        }
        let valid = packed.narrow(0, offset as usize, len as usize)?;
        offset = offset.saturating_add(len);
        let row = if (len as usize) < seq_len {
            let pad = Tensor::zeros(
                (seq_len - len as usize, h, d),
                packed.dtype(),
                packed.device(),
            )?;
            Tensor::cat(&[valid, pad], 0)?.reshape((1, seq_len, h, d))?
        } else {
            valid.reshape((1, seq_len, h, d))?
        };
        rows.push(row);
    }
    Tensor::cat(&rows, 0)?.transpose(1, 2)?.contiguous()
}

/// `(B, H, S, D)` → `(B*S, H, D)` keeping ALL query positions, including
/// padded ones. Used for full-attention (window=None) where padded queries
/// must still produce outputs that match the naive path's behavior — naive
/// computes `softmax(qk^T + mask) @ v` for every q row regardless of
/// whether that q is padding, just with the mask zeroing out padded keys.
/// Dropping padded q rows and unpacking them as zeros (the original
/// `pack` behavior) silently broke parity for any downstream consumer
/// that reads per-token outputs (e.g., late-interaction MaxSim) — those
/// positions returned 0 instead of the naive's "valid math over valid
/// keys" result.
fn pack_all_queries(t: &Tensor) -> Result<Tensor> {
    let (b, h, s, d) = t.dims4()?;
    t.transpose(1, 2)?.contiguous()?.reshape((b * s, h, d))
}

/// `(B*S, H, D)` → `(B, H, S, D)` reverse of `pack_all_queries`.
fn unpack_all_queries(packed: &Tensor, batch_size: usize, seq_len: usize) -> Result<Tensor> {
    let dims = packed.dims3()?;
    let (_total, h, d) = dims;
    packed
        .reshape((batch_size, seq_len, h, d))?
        .transpose(1, 2)?
        .contiguous()
}

/// Build cu_seqlens for the all-queries case where every batch contributes
/// exactly `seq_len` queries: `[0, S, 2S, ..., B*S]`.
fn cu_fixed_seqlens(batch_size: usize, seq_len: usize, device: &Device) -> Result<Tensor> {
    let cu: Vec<u32> = (0..=batch_size).map(|i| (i * seq_len) as u32).collect();
    Tensor::from_vec(cu, (batch_size + 1,), device)
}

/// Run flash-attention on padded `(B, H, S, D)` Q/K/V with a pure-padding
/// additive mask, optionally restricted to a sliding local window.
///
/// `attention_mask` shape: `(B, 1, 1, S)` with `0.0` for valid and large
/// negative for padding. Window restrictions, if any, are NOT in the mask;
/// they are passed via `window_size` and applied by the flash-attn kernel.
///
/// `window_size = None` → full attention over the (unpadded) sequence.
/// `window_size = Some(w)` → each query token attends only to keys within
/// `±w` positions of itself (symmetric window, the standard local-attention
/// pattern used by ModernBERT and similar models). The flash-attn API
/// accepts asymmetric `window_size_left` / `window_size_right`; we expose
/// only the symmetric form for callers that don't need the asymmetry.
///
/// Caller must ensure the device + dtype + SM gate is satisfied (see the
/// activation conditions in this module's doc-comment).
pub fn flash_attn_padded(
    q: &Tensor,
    k: &Tensor,
    v: &Tensor,
    attention_mask: &Tensor,
    softmax_scale: f32,
    window_size: Option<usize>,
) -> Result<Tensor> {
    let (batch_size, _h, seq_len, _d) = q.dims4()?;
    let seqlens = extract_seqlens_from_mask(attention_mask)?;
    if seqlens.len() != batch_size {
        return Err(candle_core::Error::Msg(format!(
            "flash_attn_padded: seqlens length {} != batch size {}",
            seqlens.len(),
            batch_size
        )));
    }
    let total_valid: u32 = seqlens.iter().copied().sum();
    let max_seqlen_k = seqlens.iter().copied().max().unwrap_or(seq_len as u32) as usize;

    // total_valid==0 means all batch rows are fully padded, which would mean
    // the input is empty — bail with a zero output shaped like the expected
    // attention result so the caller's downstream ops don't crash.
    if total_valid == 0 {
        return Tensor::zeros(q.shape(), q.dtype(), q.device());
    }

    // K/V always get unpadded — softmax must NOT include padded keys.
    let cu_k = cu_seqlens(&seqlens, q.device())?;
    let k_packed = pack(k, &seqlens, total_valid)?;
    let v_packed = pack(v, &seqlens, total_valid)?;

    // Q handling depends on whether we're doing full attention or windowed:
    //
    //   - Full attention (window=None): pack ALL queries (including padded
    //     positions). Naive attention computes outputs for padded queries
    //     too — they just attend to the unpadded keys with no contribution
    //     from padding columns. Dropping padded q rows and unpacking as
    //     zeros silently broke late-interaction parity (LI per-token min
    //     dropped from ~0.69 to ~0.62 in BF16 testing) because LI consumes
    //     per-token outputs at every position, including padding. With
    //     pack_all_queries, padded q outputs are computed exactly as the
    //     naive path produces them, so downstream consumers see the same
    //     bytes regardless of which attention path ran.
    //
    //   - Windowed (Some(W)): keep packing both Q and K. With cu_q != cu_k
    //     in the windowed varlen call, padded query positions can land
    //     outside any valid key's window, leaving the kernel with nothing
    //     to attend to (undefined output behavior). For sliding-window
    //     models like ModernBERT's local layers, downstream MUST mask
    //     padded outputs anyway (the window structure makes them
    //     meaningless), so the zero-vs-garbage mismatch is harmless and
    //     accepted.
    let use_all_queries = window_size.is_none();
    let (q_packed, cu_q, max_seqlen_q) = if use_all_queries {
        (
            pack_all_queries(q)?,
            cu_fixed_seqlens(batch_size, seq_len, q.device())?,
            seq_len,
        )
    } else {
        (pack(q, &seqlens, total_valid)?, cu_k.clone(), max_seqlen_k)
    };

    // flash_attn_varlen_windowed: same args as flash_attn_varlen plus
    // window_size_left / window_size_right; both None = full attention.
    let out_packed = candle_flash_attn::flash_attn_varlen_windowed(
        &q_packed,
        &k_packed,
        &v_packed,
        &cu_q,
        &cu_k,
        max_seqlen_q,
        max_seqlen_k,
        softmax_scale,
        window_size,
        window_size,
    )?;

    if use_all_queries {
        unpack_all_queries(&out_packed, batch_size, seq_len)
    } else {
        unpack(&out_packed, &seqlens, batch_size, seq_len)
    }
}
