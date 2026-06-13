//! CoreML-backed ModernBERT late-interaction wrapper — variant cascade.
//!
//! Holds a cascade of fixed-shape ModernBERT LI `.mlpackage`s, one
//! per (batch, seq) stair-step the sweet-search LI bucketer produces
//! (see `core/indexing/indexer-pool.js:planAllocation` for the
//! cache-aware upper-cap derivation — this module mirrors its
//! shape set). Output is a 3D `[batch, seq, token_dim]` tensor of
//! projected, per-token L2-normalised vectors; the projection head
//! and per-token normalise are traced into each variant by
//! `scripts/spike-coreml/trace_cascade.py`. `token_dim` is set per
//! cascade — 128 for the standard `lateon-code` cascade, 48 for the
//! `lateon-code-edge` cascade — and every variant in a single cascade
//! must share the same `token_dim` (enforced by `from_variants`).
//!
//! See `coreml_embedding.rs` for the full rationale behind the
//! cascade design (the short version: the old single-shape approach
//! never fired because `fits()` was false on every production call).
//! This module follows the same lazy-loading pattern via
//! `OnceLock<Result<CoremlModel, String>>` per variant.
//!
//! Gating: loaded only when the JS caller passes an explicit
//! `coreml_cascade_dir` to `NativeLateInteractionModel::load` that
//! points at a directory containing one or more
//! `li_modernbert_b{B}_s{S}_fp16.mlpackage` (standard) or
//! `li_modernbert_edge_b{B}_s{S}_fp16.mlpackage` (edge) files.
//! Standard and edge cascades live in separate dirs (`coreml-cascade/li/`
//! vs `coreml-cascade/li-edge/`) so a single `try_load_coreml_li_from_dir`
//! call only ever sees one family. Compute units are pinned to
//! CPU_AND_NE inside `coreml_shim.m` — both CoreML GPU paths miscompile
//! ModernBERT's sliding-window local attention / GeGLU chain
//! (scripts/spike-coreml/test_coreml_li_parity.py: GPU cosine 0.40 vs
//! CPU_AND_NE cosine 0.9999).

#![cfg(feature = "coreml")]

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use super::coreml_shim::CoremlModel;

pub struct CoremlLiVariant {
    pub batch: usize,
    pub seq: usize,
    pub token_dim: usize,
    pub path: PathBuf,
    model: OnceLock<Result<CoremlModel, String>>,
    /// Number of calls that dispatched through this variant. See
    /// matching doc in coreml_embedding.rs::CoremlEmbeddingVariant.
    dispatch_count: AtomicU64,
}

impl CoremlLiVariant {
    /// Build a new uncompiled variant. The underlying `.mlpackage` is
    /// not touched until the first call to `model()`, so this is cheap.
    ///
    /// `token_dim` is the per-token output dim (128 for the standard
    /// LateOn-Code, 48 for LateOn-Code-edge). It MUST match the actual
    /// output shape baked into the .mlpackage; mismatches surface at
    /// CoremlModel::load time as predict-buffer size errors.
    pub fn new(batch: usize, seq: usize, token_dim: usize, path: PathBuf) -> Self {
        Self {
            batch,
            seq,
            token_dim,
            path,
            model: OnceLock::new(),
            dispatch_count: AtomicU64::new(0),
        }
    }

    pub fn dispatches(&self) -> u64 {
        self.dispatch_count.load(Ordering::Relaxed)
    }

    fn model(&self) -> Result<&CoremlModel, &String> {
        self.model
            .get_or_init(|| {
                let t0 = std::time::Instant::now();
                let result = CoremlModel::load(
                    self.path.as_path(),
                    "input_ids",
                    "attention_mask",
                    "token_vectors",
                    self.batch,
                    self.seq,
                    self.seq,           // output_dim0 = seq length
                    self.token_dim,     // output_dim1 = per-token dim
                );
                match &result {
                    // Per-variant compile timing is DEBUG-only noise during indexing.
                    Ok(_) => {
                        if std::env::var_os("DEBUG").is_some() {
                            eprintln!(
                                "[CoremlLi] variant b{}×s{} compiled in {:.0}ms",
                                self.batch,
                                self.seq,
                                t0.elapsed().as_secs_f64() * 1000.0,
                            );
                        }
                    }
                    Err(e) => eprintln!(
                        "[CoremlLi] variant b{}×s{} FAILED to compile: {}",
                        self.batch, self.seq, e
                    ),
                }
                result
            })
            .as_ref()
    }
}

/// Fixed-shape cascade wrapper for ModernBERT LI inference.
///
/// Thread safety is handled the same way as `CoremlEmbedding` — see
/// the comment on that struct for details.
pub struct CoremlLi {
    variants: Vec<CoremlLiVariant>,
    /// Per-token output dim shared by every variant in this cascade
    /// (128 for LateOn-Code, 48 for LateOn-Code-edge). Set at
    /// construction from the first variant; `from_variants` refuses
    /// mixed-dim inputs.
    token_dim: usize,
    /// Calls whose shape exceeded the largest variant and fell through
    /// to candle. A large number here is the signal the cascade needs
    /// additional upper-range variants.
    fallthrough_count: AtomicU64,
}

impl CoremlLi {
    /// Build a cascade. All variants must share the same `token_dim`
    /// (mixing standard 128d and edge 48d variants in one cascade is a
    /// loader bug — they live in separate dirs so this should never
    /// happen, but we hard-fail rather than silently returning wrong
    /// outputs). Returns `None` if `variants` is empty or mixed-dim.
    pub fn from_variants(mut variants: Vec<CoremlLiVariant>) -> Option<Self> {
        if variants.is_empty() {
            return None;
        }
        variants.sort_by_key(|v| (v.batch, v.seq));
        let token_dim = variants[0].token_dim;
        if !variants.iter().all(|v| v.token_dim == token_dim) {
            return None;
        }
        Some(Self {
            variants,
            token_dim,
            fallthrough_count: AtomicU64::new(0),
        })
    }

    pub fn token_dim(&self) -> usize {
        self.token_dim
    }

    pub fn len(&self) -> usize {
        self.variants.len()
    }

    /// Count a shape that didn't fit the cascade. Mirrors
    /// `CoremlEmbedding::record_fallthrough` — callers should invoke
    /// this from the `!fits()` branch in li_model.rs.
    pub fn record_fallthrough(&self) {
        self.fallthrough_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Format a multi-line dispatch summary suitable for logging at
    /// index-end.
    pub fn dispatch_report(&self) -> String {
        let mut total_dispatched: u64 = 0;
        let mut lines = Vec::with_capacity(self.variants.len() + 2);
        for v in &self.variants {
            let count = v.dispatches();
            total_dispatched += count;
            let compiled = if v.model.get().is_some() {
                "compiled"
            } else {
                "never compiled"
            };
            lines.push(format!(
                "  b{}×s{}\t{} dispatches\t[{}]",
                v.batch, v.seq, count, compiled
            ));
        }
        let fallthrough = self.fallthrough_count.load(Ordering::Relaxed);
        lines.insert(
            0,
            format!(
                "[CoremlLi] dispatch stats ({} variants, {} dispatched, {} fell through)",
                self.variants.len(),
                total_dispatched,
                fallthrough,
            ),
        );
        lines.join("\n")
    }

    /// Variant selected for the startup parity check. See the
    /// matching comment in `CoremlEmbedding::parity_variant` — returns
    /// the smallest-batch, largest-seq variant so a single-row
    /// fixture dispatches to it via `pick()`.
    pub fn parity_variant(&self) -> Option<&CoremlLiVariant> {
        self.variants.first()
    }

    /// Variant with the largest `(batch, seq)` tuple in sort order,
    /// used only for error messages when a call exceeds the cascade's
    /// shape bounds.
    pub fn upper_bound_variant(&self) -> Option<&CoremlLiVariant> {
        self.variants.last()
    }

    pub fn variant_shapes(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.variants.iter().map(|v| (v.batch, v.seq))
    }

    fn pick(&self, batch_size: usize, seq_len: usize) -> Option<&CoremlLiVariant> {
        self.variants
            .iter()
            .find(|v| v.batch >= batch_size && v.seq >= seq_len)
    }

    pub fn fits(&self, batch_size: usize, seq_len: usize) -> bool {
        self.pick(batch_size, seq_len).is_some()
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

        let variant = self.pick(batch_size, seq_len).ok_or_else(|| {
            format!(
                "no variant fits ({}, {}); upper bound is {:?}",
                batch_size,
                seq_len,
                self.upper_bound_variant().map(|v| (v.batch, v.seq)),
            )
        })?;

        // Count the dispatch before compiling — a variant that failed
        // to compile still "dispatched" from the cascade's point of
        // view, so stats reflect real call patterns.
        variant.dispatch_count.fetch_add(1, Ordering::Relaxed);

        let model = variant
            .model()
            .map_err(|e| format!("variant b{}×s{}: {}", variant.batch, variant.seq, e))?;

        let v_batch = variant.batch;
        let v_seq = variant.seq;
        let total = v_batch * v_seq;
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
            let dst_base = b * v_seq;
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

        let token_dim = self.token_dim;
        let mut raw_output = vec![0.0f32; v_batch * v_seq * token_dim];
        model
            .predict(&ids_padded, &mask_padded, &mut raw_output)
            .map_err(|e| format!("variant b{}×s{} predict: {}", v_batch, v_seq, e))?;

        // Slice the [v_batch, v_seq, token_dim] output to the active
        // tokens per batch item, packed contiguously. Padding batch
        // rows (b >= batch_size) are dropped entirely.
        let total_active: usize = active_counts.iter().sum();
        let mut all_vectors: Vec<f32> = Vec::with_capacity(total_active * token_dim);
        let mut token_counts: Vec<u32> = Vec::with_capacity(batch_size);
        for (b, &active) in active_counts.iter().enumerate() {
            token_counts.push(active as u32);
            if active == 0 {
                continue;
            }
            let row_base = b * v_seq * token_dim;
            let row_end = row_base + active * token_dim;
            all_vectors.extend_from_slice(&raw_output[row_base..row_end]);
        }

        Ok((all_vectors, token_counts))
    }
}
