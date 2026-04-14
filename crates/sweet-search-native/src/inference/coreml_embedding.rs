//! CoreML-backed NomicBERT embedding wrapper — variant cascade.
//!
//! Holds a cascade of fixed-shape NomicBERT `.mlpackage`s, one per
//! (batch, seq) stair-step the sweet-search indexer's cache-aware
//! bucketer actually produces in practice (see
//! `core/infrastructure/onnx-session-utils.js:computeWeightsAwareBatchCap`
//! and the embed bucketer in `core/embedding/embedding-local-model.js`
//! for the formula — this module mirrors its output shape set).
//!
//! The original single-shape implementation traced at b32×s512 but
//! the indexer NEVER called with `batch ≤ 32`, so `fits()` returned
//! false on every call and the CoreML path was dead code. With the
//! cascade, `pick()` returns the smallest variant where
//! `v.batch ≥ real_batch && v.seq ≥ real_seq`, so any batch that
//! does not exceed the largest variant has a matching mlpackage.
//!
//! Lazy loading: each variant compiles .mlpackage → .mlmodelc on
//! first use via `[MLModel compileModelAtURL:error:]`, which takes
//! ~15–30 s per variant. Eager-loading 6 variants would add ~2 min
//! to every startup. We use `OnceLock<Result<CoremlModel, String>>`
//! so each variant pays its compile cost only the first time it is
//! picked — across a long indexing run the overhead amortises to
//! noise and startup stays fast.
//!
//! Gating: loaded only when the JS caller passes an explicit
//! `coreml_cascade_dir` to `NativeEmbeddingModel::load` that points
//! at a directory containing one or more
//! `nomic_bert_b{B}_s{S}_fp16.mlpackage` files. The JS side
//! (`core/infrastructure/coreml-cascade.js::getCoremlCascadeResolvedDirs`)
//! decides whether to pass this arg based on hardware capability
//! and cache state — see docs/INIT_STRATEGY.md for the full
//! delivery strategy. Any batch that does not fit the largest
//! variant falls through to candle.
//!
//! Compute units are pinned to CPU_AND_NE inside `coreml_shim.m` —
//! both CoreML GPU paths miscompile NomicBERT's attention/MLP/norm
//! chain (verified in scripts/spike-coreml/test_coreml_parity.py:
//! GPU cosine 0.56 vs CPU_AND_NE cosine 0.9998).

#![cfg(feature = "coreml")]

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

use super::coreml_shim::CoremlModel;

/// NomicBERT hidden size. Hardcoded — this cascade is only ever used
/// with CodeRankEmbed / NomicBERT-style 768-dim models.
const HIDDEN_SIZE: usize = 768;

/// A single traced shape variant. Owns its `.mlpackage` path; the
/// underlying `CoremlModel` is constructed lazily on first use so
/// unused variants never pay their ~15–30 s compile cost.
///
/// The cell holds `Result<..>` rather than `Option<..>` so that a
/// variant which failed to compile (missing file, bad mlpackage,
/// shim error) stays failed — callers see `Err` and can decide to
/// fall back to candle or to a larger variant. Recomputing on every
/// call would thrash the expensive compile path.
pub struct CoremlEmbeddingVariant {
    pub batch: usize,
    pub seq: usize,
    pub path: PathBuf,
    model: OnceLock<Result<CoremlModel, String>>,
    /// Number of times `pick()` selected this variant. Monotonic, reset
    /// only when the cascade is dropped. Incremented inside `embed()`
    /// so the counter reflects actual dispatch, not just shape fit.
    /// Used by the dispatch report to prove each variant is pulling
    /// its weight: a variant with zero dispatches across a full index
    /// run is dead weight and should be cut from the cascade.
    dispatch_count: AtomicU64,
}

impl CoremlEmbeddingVariant {
    /// Build a new uncompiled variant. The underlying `.mlpackage` is
    /// not touched until the first call to `model()`, so this is cheap.
    pub fn new(batch: usize, seq: usize, path: PathBuf) -> Self {
        Self {
            batch,
            seq,
            path,
            model: OnceLock::new(),
            dispatch_count: AtomicU64::new(0),
        }
    }

    /// Number of calls that have dispatched through this variant so far.
    pub fn dispatches(&self) -> u64 {
        self.dispatch_count.load(Ordering::Relaxed)
    }

    /// Return the underlying CoremlModel, compiling on first call.
    /// The inner Result is borrowed — the error message is owned by
    /// the OnceLock so repeated failures return the same string.
    fn model(&self) -> Result<&CoremlModel, &String> {
        self.model
            .get_or_init(|| {
                let t0 = std::time::Instant::now();
                let result = CoremlModel::load(
                    self.path.as_path(),
                    "input_ids",
                    "attention_mask",
                    "embeddings",
                    self.batch,
                    self.seq,
                    HIDDEN_SIZE,
                    0, // 2D output → output_dim1 == 0
                );
                match &result {
                    Ok(_) => eprintln!(
                        "[CoremlEmbedding] variant b{}×s{} compiled in {:.0}ms",
                        self.batch,
                        self.seq,
                        t0.elapsed().as_secs_f64() * 1000.0,
                    ),
                    Err(e) => eprintln!(
                        "[CoremlEmbedding] variant b{}×s{} FAILED to compile: {}",
                        self.batch, self.seq, e
                    ),
                }
                result
            })
            .as_ref()
    }
}

/// Fixed-shape cascade wrapper for NomicBERT embedding inference.
///
/// Thread safety: each variant's `CoremlModel` serialises concurrent
/// predict calls through an internal `Mutex<()>` (see coreml_shim.rs).
/// Concurrent calls to `embed()` from multiple libuv worker threads
/// on DIFFERENT variants run in parallel because each variant has
/// its own `CoremlModel` and therefore its own mutex. Calls on the
/// SAME variant serialise — acceptable because each call is a full
/// ANE submission and ANE is a single hardware resource anyway.
pub struct CoremlEmbedding {
    /// Variants sorted ascending by (batch, seq). `pick()` walks this
    /// in order and returns the first one where both bounds fit — so
    /// the `(64, 96)` variant is preferred over the `(64, 192)` one
    /// for a `(48, 80)` call, even though both would work.
    variants: Vec<CoremlEmbeddingVariant>,
    /// Calls whose shape exceeded the largest variant and fell through
    /// to candle. A large number here is the signal the cascade needs
    /// additional upper-range variants.
    fallthrough_count: AtomicU64,
}

impl CoremlEmbedding {
    /// Build the cascade from a list of `(batch, seq, path)` tuples.
    /// Does NOT load any `.mlpackage` — that happens lazily when a
    /// variant is first picked. The constructor is cheap (microseconds)
    /// so the outer `embedding_model.rs::load` can call this without
    /// adding startup latency. `embedding_model.rs` is responsible for
    /// running a parity check against `parity_variant()` before
    /// admitting the cascade for dispatch.
    pub fn from_variants(mut variants: Vec<CoremlEmbeddingVariant>) -> Self {
        variants.sort_by_key(|v| (v.batch, v.seq));
        Self {
            variants,
            fallthrough_count: AtomicU64::new(0),
        }
    }

    /// Count a shape that didn't fit the cascade. Called by the
    /// outer `embedding_model.rs::embed_batch` on the `!fits()`
    /// path so the stats report covers both dispatched and
    /// fell-through calls.
    pub fn record_fallthrough(&self) {
        self.fallthrough_count.fetch_add(1, Ordering::Relaxed);
    }

    /// Format a multi-line dispatch summary suitable for logging at
    /// index-end. One line per variant with dispatch count and
    /// compile status, plus a summary line for fell-through calls.
    pub fn dispatch_report(&self) -> String {
        let mut total_dispatched: u64 = 0;
        let mut lines = Vec::with_capacity(self.variants.len() + 2);
        for v in &self.variants {
            let count = v.dispatches();
            total_dispatched += count;
            let compiled = if v.model.get().is_some() { "compiled" } else { "never compiled" };
            lines.push(format!(
                "  b{}×s{}\t{} dispatches\t[{}]",
                v.batch, v.seq, count, compiled
            ));
        }
        let fallthrough = self.fallthrough_count.load(Ordering::Relaxed);
        lines.insert(
            0,
            format!(
                "[CoremlEmbedding] dispatch stats ({} variants, {} dispatched, {} fell through)",
                self.variants.len(),
                total_dispatched,
                fallthrough,
            ),
        );
        lines.join("\n")
    }

    /// Number of registered variants. Used for startup logging only.
    pub fn len(&self) -> usize {
        self.variants.len()
    }

    /// Variant selected for the startup parity check.
    ///
    /// Returns `variants.first()` — the smallest-batch (therefore
    /// largest-seq in our cascade design) variant. A single-row
    /// fixture naturally dispatches to this variant via `pick()` (batch
    /// 1 matches first in sort order), so the parity check gets to
    /// test a real compile+predict+output path with the cheapest
    /// possible fixture (1 row instead of 64). See
    /// `embedding_model.rs::embedding_parity_cosine` for the full
    /// rationale — parity correctness transfers across variants
    /// because they are all traced from the same PyTorch model.
    pub fn parity_variant(&self) -> Option<&CoremlEmbeddingVariant> {
        self.variants.first()
    }

    /// Variant with the largest `(batch, seq)` tuple in sort order.
    /// Used only for error messages when a call exceeds the cascade's
    /// shape bounds — NOT for dispatch selection. Dispatch uses
    /// `pick()` which walks all variants in sorted order.
    pub fn upper_bound_variant(&self) -> Option<&CoremlEmbeddingVariant> {
        self.variants.last()
    }

    /// Iterate over the (batch, seq) of each variant — for startup
    /// logging so the user can see what the cascade covers.
    pub fn variant_shapes(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.variants.iter().map(|v| (v.batch, v.seq))
    }

    /// Pick the smallest variant whose shape fits `(batch_size, seq_len)`.
    /// Returns `None` when the call exceeds the largest variant — the
    /// caller (`embed_batch`) then falls back to candle.
    fn pick(&self, batch_size: usize, seq_len: usize) -> Option<&CoremlEmbeddingVariant> {
        self.variants
            .iter()
            .find(|v| v.batch >= batch_size && v.seq >= seq_len)
    }

    /// True if some variant fits. Equivalent to `pick().is_some()` but
    /// spelled out for readability at the dispatch site.
    pub fn fits(&self, batch_size: usize, seq_len: usize) -> bool {
        self.pick(batch_size, seq_len).is_some()
    }

    /// Run embedding inference on a pre-tokenized batch using the
    /// smallest cascade variant that fits. Pads the inputs up to the
    /// chosen variant's shape, runs CoreML, and returns the first
    /// `batch_size * HIDDEN_SIZE` floats of the output (the rows for
    /// the real batch items). Padded rows are discarded via
    /// `Vec::truncate` so the caller hands the returned buffer
    /// straight into `Float32Array::new` with no additional copy.
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
        // view, so stats reflect real call patterns. Compile-failure
        // counts are reflected separately through the "never compiled"
        // tag in `dispatch_report()`.
        variant.dispatch_count.fetch_add(1, Ordering::Relaxed);

        let model = variant
            .model()
            .map_err(|e| format!("variant b{}×s{}: {}", variant.batch, variant.seq, e))?;

        let v_batch = variant.batch;
        let v_seq = variant.seq;
        let total = v_batch * v_seq;
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
            let dst_base = b * v_seq;
            for s in 0..seq_len {
                ids_padded[dst_base + s] = ids_row[s] as i32;
                mask_padded[dst_base + s] = mask_row[s] as i32;
            }
            // positions [seq_len..v_seq] stay zeroed — mean pool drops them
        }
        // rows [batch_size..v_batch] stay fully zeroed — same reason.

        let mut output = vec![0.0f32; v_batch * HIDDEN_SIZE];
        model
            .predict(&ids_padded, &mask_padded, &mut output)
            .map_err(|e| format!("variant b{}×s{} predict: {}", v_batch, v_seq, e))?;

        output.truncate(batch_size * HIDDEN_SIZE);
        Ok(output)
    }
}
