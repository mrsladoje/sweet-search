//! Proof-of-life napi export for the CoreML shim.
//!
//! Exposes a single `coremlShimSmokeTest(mlpackagePath, batch, seq,
//! outputDim0, outputDim1)` function that loads the .mlpackage, runs
//! one prediction with zeroed inputs (attention_mask all ones) and
//! returns the first 8 output floats plus the model load time and the
//! single-call prediction time.
//!
//! This file is the minimal smoke test used to verify that the
//! Objective-C shim compiles, links, loads a real .mlpackage and
//! emits real output — nothing more. It will be replaced by the
//! production coreml_embedding.rs / coreml_li.rs modules once those
//! are built on top of the same shim.

#![cfg(feature = "coreml")]

use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;

use super::coreml_shim::CoremlModel;

#[napi(object)]
pub struct CoremlSmokeResult {
    pub load_ms: f64,
    pub predict_ms: f64,
    pub output_elements: u32,
    /// First 8 floats of the output as a Vec<f64> (napi-friendly).
    pub first_8: Vec<f64>,
}

/// Load an .mlpackage via the shim, run one prediction with zeroed
/// input_ids and all-ones attention_mask, return timing + a preview of
/// the output. Used from JS smoke tests only — production code uses
/// the production modules being built on top of this shim.
///
/// Input/output feature names are hardcoded to the ones used by our
/// spike conversions ("input_ids", "attention_mask", "embeddings"
/// for NomicBERT or "token_vectors" for LI). Caller picks which
/// output name to use via the `outputName` parameter.
#[napi(ts_return_type = "Promise<CoremlSmokeResult>")]
pub fn coreml_shim_smoke_test(
    mlpackage_path: String,
    output_name: String,
    batch: i64,
    seq: i64,
    output_dim0: i64,
    output_dim1: i64,
) -> Result<CoremlSmokeResult> {
    let path = PathBuf::from(&mlpackage_path);

    let t_load = std::time::Instant::now();
    let model = CoremlModel::load(
        &path,
        "input_ids",
        "attention_mask",
        &output_name,
        batch as usize,
        seq as usize,
        output_dim0 as usize,
        output_dim1 as usize,
    )
    .map_err(|e| {
        Error::from_reason(format!("[coreml-shim smoke] load failed: {e}"))
    })?;
    let load_ms = t_load.elapsed().as_secs_f64() * 1000.0;

    let n = model.batch() * model.seq();
    let ids: Vec<i32> = vec![0; n];
    let mask: Vec<i32> = vec![1; n];
    let mut output: Vec<f32> = vec![0.0; model.output_elements()];

    let t_pred = std::time::Instant::now();
    model
        .predict(&ids, &mask, &mut output)
        .map_err(|e| Error::from_reason(format!("[coreml-shim smoke] predict failed: {e}")))?;
    let predict_ms = t_pred.elapsed().as_secs_f64() * 1000.0;

    let first_8: Vec<f64> = output.iter().take(8).map(|&x| x as f64).collect();

    Ok(CoremlSmokeResult {
        load_ms,
        predict_ms,
        output_elements: model.output_elements() as u32,
        first_8,
    })
}
