//! CoreML-backed ModernBERT late-interaction wrapper.
//!
//! Wraps a fixed-shape (b32×s512) .mlpackage that takes int32 `input_ids`
//! and `attention_mask` and emits a 3D [batch, 512, 128] tensor of
//! projected, per-token L2-normalised vectors. The backbone forward,
//! 768→128 projection and per-token normalize are all traced into the
//! model by scripts/spike-coreml/convert_li_to_coreml.py, so the Rust
//! side just runs the model and slices each batch row down to its
//! active token count before handing the buffer to
//! `Float32Array::new(..)`.
//!
//! Loaded only when `SWEET_SEARCH_COREML_LI_MLPACKAGE` is set.
//! `li_model.rs` reads that env var at `load()` time and calls
//! `CoremlLi::load` alongside the candle backbone. The dispatch in
//! `encode_batch` is: if CoreML is loaded AND the batch fits, use
//! CoreML; otherwise fall back to candle.
//!
//! The .mlpackage is pinned to CPU_AND_NE inside the shim — both
//! CoreML GPU compute units miscompile the ModernBERT sliding-window
//! attention / GeGLU chain. Spike measurement: GPU cosine 0.40 vs
//! CPU_AND_NE cosine 0.9999 against the candle BF16 reference
//! (scripts/spike-coreml/test_coreml_li_parity.py).

#![cfg(feature = "coreml")]

use std::path::Path;

use super::coreml_shim::CoremlModel;

/// Fixed batch size traced into the .mlpackage. Matches the LI
/// indexer's batcher — larger batches fall back to candle.
const MAX_BATCH: usize = 32;

/// Fixed sequence length traced into the .mlpackage. The indexer's
/// LI pipeline truncates to 512 by default, so this is the common
/// case; longer inputs fall back to candle.
const MAX_SEQ: usize = 512;

/// Per-token embedding dimension emitted by the projection head.
/// Hardcoded — LateOn-Code projects 768d backbone down to 128d.
const TOKEN_DIM: usize = 128;

/// Fixed-shape CoreML wrapper for ModernBERT LI inference.
///
/// Thread safety: delegated to `CoremlModel`, which serialises predict
/// through an internal `Mutex<()>`. Encode takes `&self`, so it is
/// safe to share across libuv worker threads via `Arc<LiInner>`.
pub struct CoremlLi {
    model: CoremlModel,
}

impl CoremlLi {
    /// Load a .mlpackage for ModernBERT LI.
    ///
    /// Expects feature names `input_ids` / `attention_mask` /
    /// `token_vectors` with shapes [b32, s512] int32 for the inputs
    /// and [b32, 512, 128] float32 for the output. The shim compiles
    /// `.mlpackage` → `.mlmodelc` on first load and pins compute
    /// units to CPU_AND_NE.
    pub fn load(mlpackage_path: &Path) -> Result<Self, String> {
        let model = CoremlModel::load(
            mlpackage_path,
            "input_ids",
            "attention_mask",
            "token_vectors",
            MAX_BATCH,
            MAX_SEQ,
            MAX_SEQ,   // output_dim0 = seq length
            TOKEN_DIM, // output_dim1 = per-token dim
        )?;
        Ok(Self { model })
    }

    pub fn token_dim(&self) -> usize {
        TOKEN_DIM
    }

    pub fn max_batch(&self) -> usize {
        MAX_BATCH
    }

    pub fn max_seq(&self) -> usize {
        MAX_SEQ
    }

    /// True if a batch of the given shape fits the fixed .mlpackage
    /// shape. Callers use this to decide CoreML vs candle dispatch.
    pub fn fits(&self, batch_size: usize, seq_len: usize) -> bool {
        batch_size <= MAX_BATCH && seq_len <= MAX_SEQ
    }

    /// Encode a batch of variable-length inputs into per-token vectors.
    ///
    /// Returns `(vectors, counts)` matching the candle LI task contract:
    /// `vectors` is a flat f32 buffer of length `sum(counts) * TOKEN_DIM`
    /// holding only active (non-padding) tokens, packed per batch item
    /// in order; `counts` is the active token count per batch item.
    pub fn encode(
        &self,
        input_ids: &[Vec<i64>],
        attention_mask: &[Vec<i64>],
    ) -> Result<(Vec<f32>, Vec<u32>), String> {
        let batch_size = input_ids.len();
        if batch_size == 0 {
            return Ok((Vec::new(), Vec::new()));
        }
        if batch_size != attention_mask.len() {
            return Err(format!(
                "batch mismatch: ids={} mask={}",
                batch_size,
                attention_mask.len()
            ));
        }
        let seq_len = input_ids[0].len();
        if !self.fits(batch_size, seq_len) {
            return Err(format!(
                "shape ({}, {}) exceeds fixed ({}, {})",
                batch_size, seq_len, MAX_BATCH, MAX_SEQ
            ));
        }

        // Build padded int32 buffers and count active tokens per row.
        // We do both in the same loop because we already touch every
        // mask entry here — a second pass would just repeat the work.
        let total = MAX_BATCH * MAX_SEQ;
        let mut ids_padded = vec![0i32; total];
        let mut mask_padded = vec![0i32; total];
        let mut active_counts: Vec<usize> = Vec::with_capacity(batch_size);
        for b in 0..batch_size {
            let ids_row = &input_ids[b];
            let mask_row = &attention_mask[b];
            if ids_row.len() != seq_len || mask_row.len() != seq_len {
                return Err(format!(
                    "ragged row {}: ids={} mask={} expected={}",
                    b,
                    ids_row.len(),
                    mask_row.len(),
                    seq_len
                ));
            }
            let dst_base = b * MAX_SEQ;
            let mut active = 0usize;
            for s in 0..seq_len {
                ids_padded[dst_base + s] = ids_row[s] as i32;
                mask_padded[dst_base + s] = mask_row[s] as i32;
                if mask_row[s] != 0 {
                    active += 1;
                }
            }
            active_counts.push(active);
        }

        // Full [MAX_BATCH, MAX_SEQ, TOKEN_DIM] output buffer. We pay
        // the full 2 MiB allocation even for small batches because the
        // shim demands a buffer sized to the traced output shape; the
        // slicing pass below drops it to active tokens only.
        let mut raw_output = vec![0.0f32; MAX_BATCH * MAX_SEQ * TOKEN_DIM];
        self.model
            .predict(&ids_padded, &mask_padded, &mut raw_output)
            .map_err(|e| format!("predict: {e}"))?;

        // Pack active token slices into a contiguous output buffer
        // that matches `LiEncodeTask::compute` on the candle path, so
        // the caller assembles the same `LiEncodingResult` regardless
        // of which backend ran the encode.
        let total_active: usize = active_counts.iter().sum();
        let mut all_vectors: Vec<f32> = Vec::with_capacity(total_active * TOKEN_DIM);
        let mut token_counts: Vec<u32> = Vec::with_capacity(batch_size);
        for (b, &active) in active_counts.iter().enumerate() {
            token_counts.push(active as u32);
            if active == 0 {
                continue;
            }
            let row_base = b * MAX_SEQ * TOKEN_DIM;
            let row_end = row_base + active * TOKEN_DIM;
            all_vectors.extend_from_slice(&raw_output[row_base..row_end]);
        }

        Ok((all_vectors, token_counts))
    }
}
