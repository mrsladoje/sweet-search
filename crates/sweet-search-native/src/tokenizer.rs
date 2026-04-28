//! Native tokenizer via HuggingFace `tokenizers` crate.
//!
//! Loads tokenizer.json files and exposes encode/encode_batch/encode_pair
//! via napi-rs. Thread-safe singleton cache keyed by file path.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Mutex;
use tokenizers::tokenizer::Tokenizer;
use tokenizers::{EncodeInput, PaddingParams, PaddingStrategy, TruncationParams};

// ---------------------------------------------------------------------------
// Global tokenizer cache — keyed by file path, never evicted
// ---------------------------------------------------------------------------

static CACHE: std::sync::LazyLock<Mutex<HashMap<String, Tokenizer>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn get_or_load(path: &str) -> Result<Tokenizer> {
    let mut cache = CACHE
        .lock()
        .map_err(|e| Error::from_reason(format!("Tokenizer cache lock poisoned: {e}")))?;

    if let Some(tok) = cache.get(path) {
        return Ok(tok.clone());
    }

    let tok = Tokenizer::from_file(path)
        .map_err(|e| Error::from_reason(format!("Failed to load tokenizer from {path}: {e}")))?;

    cache.insert(path.to_string(), tok.clone());
    Ok(tok)
}

// ---------------------------------------------------------------------------
// Output struct
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct TokenizeResult {
    /// Flattened token IDs (batch_size * seq_len)
    pub input_ids: Vec<i64>,
    /// Flattened attention mask (batch_size * seq_len)
    pub attention_mask: Vec<i64>,
    /// Flattened token type IDs (batch_size * seq_len) — relevant for pair encoding
    pub token_type_ids: Vec<i64>,
    /// Shape: [batch_size, seq_len]
    pub dims: Vec<u32>,
}

// ---------------------------------------------------------------------------
// NativeTokenizer class
// ---------------------------------------------------------------------------

#[napi]
pub struct NativeTokenizer {
    path: String,
}

#[napi]
impl NativeTokenizer {
    /// Load a tokenizer from a tokenizer.json file.
    #[napi(factory)]
    pub fn from_file(path: String) -> Result<Self> {
        // Eagerly validate the file loads
        get_or_load(&path)?;
        Ok(Self { path })
    }

    /// Encode a single text.
    #[napi]
    pub fn encode(
        &self,
        text: String,
        max_length: u32,
        add_special_tokens: bool,
    ) -> Result<TokenizeResult> {
        let mut tok = get_or_load(&self.path)?;
        configure_tokenizer(&mut tok, max_length as usize, true);

        let encoding = tok
            .encode(text.as_str(), add_special_tokens)
            .map_err(|e| Error::from_reason(format!("Encode failed: {e}")))?;

        let ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        let mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|&m| m as i64)
            .collect();
        let type_ids: Vec<i64> = encoding.get_type_ids().iter().map(|&t| t as i64).collect();
        let seq_len = ids.len() as u32;

        Ok(TokenizeResult {
            input_ids: ids,
            attention_mask: mask,
            token_type_ids: type_ids,
            dims: vec![1, seq_len],
        })
    }

    /// Encode a batch of texts with padding to longest.
    #[napi]
    pub fn encode_batch(
        &self,
        texts: Vec<String>,
        max_length: u32,
        add_special_tokens: bool,
    ) -> Result<TokenizeResult> {
        let mut tok = get_or_load(&self.path)?;
        configure_tokenizer(&mut tok, max_length as usize, true);

        let inputs: Vec<EncodeInput> = texts.iter().map(|t| t.as_str().into()).collect();
        let encodings = tok
            .encode_batch(inputs, add_special_tokens)
            .map_err(|e| Error::from_reason(format!("Batch encode failed: {e}")))?;

        let batch_size = encodings.len();
        let seq_len = encodings.first().map_or(0, |e| e.get_ids().len());

        let mut all_ids = Vec::with_capacity(batch_size * seq_len);
        let mut all_mask = Vec::with_capacity(batch_size * seq_len);
        let mut all_type_ids = Vec::with_capacity(batch_size * seq_len);

        for enc in &encodings {
            all_ids.extend(enc.get_ids().iter().map(|&id| id as i64));
            all_mask.extend(enc.get_attention_mask().iter().map(|&m| m as i64));
            all_type_ids.extend(enc.get_type_ids().iter().map(|&t| t as i64));
        }

        Ok(TokenizeResult {
            input_ids: all_ids,
            attention_mask: all_mask,
            token_type_ids: all_type_ids,
            dims: vec![batch_size as u32, seq_len as u32],
        })
    }

    /// Encode a query-document pair (for cross-encoder rerankers).
    #[napi]
    pub fn encode_pair(
        &self,
        text: String,
        text_pair: String,
        max_length: u32,
    ) -> Result<TokenizeResult> {
        let mut tok = get_or_load(&self.path)?;
        configure_tokenizer(&mut tok, max_length as usize, true);

        let encoding = tok
            .encode((text.as_str(), text_pair.as_str()), true)
            .map_err(|e| Error::from_reason(format!("Pair encode failed: {e}")))?;

        let ids: Vec<i64> = encoding.get_ids().iter().map(|&id| id as i64).collect();
        let mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|&m| m as i64)
            .collect();
        let type_ids: Vec<i64> = encoding.get_type_ids().iter().map(|&t| t as i64).collect();
        let seq_len = ids.len() as u32;

        Ok(TokenizeResult {
            input_ids: ids,
            attention_mask: mask,
            token_type_ids: type_ids,
            dims: vec![1, seq_len],
        })
    }

    /// Look up a single token string → token ID (for skiplist building).
    #[napi]
    pub fn token_to_id(&self, token: String) -> Result<Option<u32>> {
        let tok = get_or_load(&self.path)?;
        Ok(tok.token_to_id(&token))
    }

    /// Get vocabulary size.
    #[napi]
    pub fn get_vocab_size(&self) -> Result<u32> {
        let tok = get_or_load(&self.path)?;
        Ok(tok.get_vocab_size(true) as u32)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn configure_tokenizer(tok: &mut Tokenizer, max_length: usize, pad: bool) {
    let _ = tok.with_truncation(Some(TruncationParams {
        max_length,
        ..Default::default()
    }));

    if pad {
        tok.with_padding(Some(PaddingParams {
            strategy: PaddingStrategy::BatchLongest,
            ..Default::default()
        }));
    } else {
        tok.with_padding(None);
    }
}
