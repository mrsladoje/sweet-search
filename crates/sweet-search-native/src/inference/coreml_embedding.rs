//! CoreML-backed NomicBERT embedding wrapper.
//!
//! Wraps a fixed-shape (b32×s512) .mlpackage that takes int32 `input_ids`
//! and `attention_mask` and emits the final 2D [batch, 768] L2-normalised
//! embedding tensor. Mean pooling and L2 normalisation are traced into
//! the model itself by the conversion script
//! (scripts/spike-coreml/convert_to_coreml.py), so the Rust side just
//! runs the model and copies the output directly — no pooling or norm
//! on the Rust side.
//!
//! Loaded only when `SWEET_SEARCH_COREML_EMBED_MLPACKAGE` is set.
//! `embedding_model.rs` reads that env var at `load()` time and calls
//! `CoremlEmbedding::load` alongside the candle backbone; at
//! `embed_batch` time the dispatch is:
//!   - If CoreML is loaded AND the batch fits the fixed shape → CoreML
//!   - Otherwise → candle (existing Metal/CPU path)
//!
//! The .mlpackage is pinned to CPU_AND_NE inside the shim — the CoreML
//! GPU compute units miscompile the NomicBERT attention/MLP/norm chain.
//! Spike measurement: GPU cosine 0.56 vs CPU_AND_NE cosine 0.9998
//! against the candle BF16 reference
//! (scripts/spike-coreml/test_coreml_parity.py).

#![cfg(feature = "coreml")]

use std::path::Path;

use super::coreml_shim::CoremlModel;

/// Fixed batch size traced into the .mlpackage. Matches the indexer's
/// tokenizer bucket ceiling — larger batches fall back to candle rather
/// than splitting across multiple CoreML calls, so this constant also
/// defines the CoreML fast-path eligibility criterion.
const MAX_BATCH: usize = 32;

/// Fixed sequence length traced into the .mlpackage. Matches the
/// embedding model's `max_length` default (512). Shorter sequences are
/// padded with zeroed ids and mask=0, so the mean pool inside the
/// traced model naturally ignores the padding.
const MAX_SEQ: usize = 512;

/// NomicBERT hidden size. Hardcoded — this wrapper is only ever used
/// with CodeRankEmbed / NomicBERT-style 768-dim models.
const HIDDEN_SIZE: usize = 768;

/// Fixed-shape CoreML wrapper for NomicBERT embedding inference.
///
/// Thread safety: delegated to `CoremlModel`, which serialises predict
/// calls through an internal `Mutex<()>`. This struct takes `&self` for
/// `embed`, so it is fine to share across libuv worker threads via
/// `Arc<EmbeddingInner>`.
pub struct CoremlEmbedding {
    model: CoremlModel,
}

impl CoremlEmbedding {
    /// Load a .mlpackage for NomicBERT embedding.
    ///
    /// Expects the mlpackage to have feature names
    /// `input_ids` / `attention_mask` / `embeddings`, with shapes
    /// [b32, s512] for the int32 inputs and [b32, 768] for the float32
    /// output. The shim compiles `.mlpackage` → `.mlmodelc` on first
    /// load (~15–30s cold start) and pins compute units to CPU_AND_NE.
    pub fn load(mlpackage_path: &Path) -> Result<Self, String> {
        let model = CoremlModel::load(
            mlpackage_path,
            "input_ids",
            "attention_mask",
            "embeddings",
            MAX_BATCH,
            MAX_SEQ,
            HIDDEN_SIZE,
            0, // output is 2D → signal via output_dim1 == 0
        )?;
        Ok(Self { model })
    }

    pub fn hidden_size(&self) -> usize {
        HIDDEN_SIZE
    }

    pub fn max_batch(&self) -> usize {
        MAX_BATCH
    }

    pub fn max_seq(&self) -> usize {
        MAX_SEQ
    }

    /// True if a batch of the given shape fits the fixed .mlpackage
    /// shape. Callers use this to decide whether to dispatch to CoreML
    /// or fall back to candle.
    pub fn fits(&self, batch_size: usize, seq_len: usize) -> bool {
        batch_size <= MAX_BATCH && seq_len <= MAX_SEQ
    }

    /// Run embedding inference on a pre-tokenized batch.
    ///
    /// Pads the inputs up to [MAX_BATCH, MAX_SEQ], runs CoreML, and
    /// returns the first `batch_size * HIDDEN_SIZE` floats of the
    /// output — i.e. the rows corresponding to the real batch items.
    /// The padded rows are discarded via `Vec::truncate` so the caller
    /// can hand the returned buffer straight into
    /// `Float32Array::new(..)` without any additional copy.
    pub fn embed(
        &self,
        input_ids: &[Vec<i64>],
        attention_mask: &[Vec<i64>],
    ) -> Result<Vec<f32>, String> {
        let batch_size = input_ids.len();
        if batch_size == 0 {
            return Ok(Vec::new());
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

        // Build padded int32 input/mask buffers for the shim. Rows
        // beyond `batch_size` and positions beyond `seq_len` in each
        // row stay zeroed — `ids=0` is the pad token and `mask=0`
        // tells the traced mean pool to drop the position entirely.
        let total = MAX_BATCH * MAX_SEQ;
        let mut ids_padded = vec![0i32; total];
        let mut mask_padded = vec![0i32; total];
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
            for s in 0..seq_len {
                ids_padded[dst_base + s] = ids_row[s] as i32;
                mask_padded[dst_base + s] = mask_row[s] as i32;
            }
        }

        let mut output = vec![0.0f32; MAX_BATCH * HIDDEN_SIZE];
        self.model
            .predict(&ids_padded, &mask_padded, &mut output)
            .map_err(|e| format!("predict: {e}"))?;

        output.truncate(batch_size * HIDDEN_SIZE);
        Ok(output)
    }
}
