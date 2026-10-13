//! Sweet Search native addon — MaxSim kernel + tokenizer + future pipelines.
//!
//! MaxSim (`maxsim/`): scores candidates in parallel across CPU cores (its own
//! worker pool), with register-blocked SIMD kernels (NEON on aarch64,
//! runtime-detected AVX2+FMA on x86_64) over L1-tiled dequantized doc tokens.
//! Tokenizer: HuggingFace `tokenizers` crate for native tokenization.
//!
//! Falls back gracefully: native > WASM SIMD > JS

// In test builds the crate type is lib (not cdylib), so #[napi]-exported
// functions/structs and everything they transitively reference appear unused.
// All warned items are reachable from JS in the production cdylib build.
#![cfg_attr(test, allow(dead_code, unreachable_code))]

mod dedup;
mod grep_file_cache;
mod hnsw_search;
mod inference;
mod lane;
mod maxsim;
mod native_grep;
mod regex_literals;
mod rescore;
mod simd_intersect;
mod sqlite_ext;
mod sparse_gram;
mod tokenizer;
