//! NomicBERT with fused Metal SDPA attention.
//!
//! Vendored from candle-transformers 0.10.2 src/models/nomic_bert.rs with
//! the attention forward pass replaced by `candle_nn::ops::sdpa` on Metal.
//!
//! Rationale:
//!   The upstream implementation uses naive O(N^2) attention that materializes
//!   the full attention matrix. At batch=32 × seq=512 on Metal, this is the
//!   dominant bottleneck (measured: ~4.2s per batch, ~10% slower than ORT CPU).
//!
//!   Candle's Metal backend ships a fused SDPA kernel (metal-sdpa) ported from
//!   MLX that supports head_dim=64 and F16 inputs — exactly our config. Using
//!   it avoids materializing the attention matrix and should yield large
//!   speedups on long sequences.
//!
//! CPU behavior is unchanged (uses the same naive attention as upstream) since
//! the SDPA kernel has no CPU implementation.

use candle_core::{DType, Device, Result, Tensor, D};
use candle_nn::{embedding, layer_norm, linear, linear_no_bias, Embedding, LayerNorm, Linear, Module, VarBuilder};
use serde::Deserialize;

// Matches nomic-ai/nomic-embed-text-v1.5 config.json field names.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default)]
pub struct Config {
    pub vocab_size: usize,
    pub n_embd: usize,
    pub n_head: usize,
    pub n_layer: usize,
    pub n_inner: usize,
    pub n_positions: usize,
    pub type_vocab_size: usize,
    pub layer_norm_epsilon: f64,
    pub rotary_emb_fraction: f64,
    pub rotary_emb_base: f64,
    pub rotary_emb_interleaved: bool,
    pub qkv_proj_bias: bool,
    pub mlp_fc1_bias: bool,
    pub mlp_fc2_bias: bool,
    pub activation_function: String,
    pub prenorm: bool,
    pub model_type: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            vocab_size: 30528,
            n_embd: 768,
            n_head: 12,
            n_layer: 12,
            n_inner: 3072,
            n_positions: 8192,
            type_vocab_size: 2,
            layer_norm_epsilon: 1e-12,
            rotary_emb_fraction: 1.0,
            rotary_emb_base: 1000.0,
            rotary_emb_interleaved: false,
            qkv_proj_bias: false,
            mlp_fc1_bias: false,
            mlp_fc2_bias: false,
            activation_function: "swiglu".to_string(),
            prenorm: false,
            model_type: Some("nomic_bert".to_string()),
        }
    }
}

impl Config {
    fn head_dim(&self) -> usize {
        self.n_embd / self.n_head
    }

    fn rotary_emb_dim(&self) -> usize {
        (self.head_dim() as f64 * self.rotary_emb_fraction) as usize
    }
}

// Precomputed cos/sin tables for rotary position embeddings.
// Shared across all attention layers since they use identical frequencies.
#[derive(Clone, Debug)]
struct RotaryEmbedding {
    cos: Tensor,
    sin: Tensor,
    interleaved: bool,
}

impl RotaryEmbedding {
    fn new(
        dim: usize,
        max_seq_len: usize,
        base: f64,
        interleaved: bool,
        dtype: DType,
        device: &Device,
    ) -> Result<Self> {
        let half_dim = dim / 2;
        let inv_freq: Vec<f32> = (0..half_dim)
            .map(|i| 1f32 / (base as f32).powf(2.0 * i as f32 / dim as f32))
            .collect();
        let inv_freq = Tensor::new(inv_freq.as_slice(), device)?;
        let positions = Tensor::arange(0u32, max_seq_len as u32, device)?
            .to_dtype(DType::F32)?
            .reshape((max_seq_len, 1))?;
        let freqs = positions.matmul(&inv_freq.unsqueeze(0)?)?;
        // Cache cos/sin in the target model dtype so `apply` can avoid the
        // per-call `.to_dtype(x.dtype())?` (24 Metal dispatches per forward
        // across 12 layers otherwise).
        let cos = freqs.cos()?.to_dtype(dtype)?;
        let sin = freqs.sin()?.to_dtype(dtype)?;
        Ok(Self {
            cos,
            sin,
            interleaved,
        })
    }

    /// Apply rotary embeddings to x of shape (batch, n_heads, seq_len, head_dim).
    fn apply(&self, x: &Tensor) -> Result<Tensor> {
        if self.interleaved {
            candle_nn::rotary_emb::rope_i(x, &self.cos, &self.sin)
        } else {
            candle_nn::rotary_emb::rope(x, &self.cos, &self.sin)
        }
    }
}

// Word embeddings + optional token type embeddings.
#[derive(Clone, Debug)]
struct NomicBertEmbeddings {
    word_embeddings: Embedding,
    token_type_embeddings: Option<Embedding>,
}

impl NomicBertEmbeddings {
    fn new(vb: VarBuilder, config: &Config) -> Result<Self> {
        let word_embeddings =
            embedding(config.vocab_size, config.n_embd, vb.pp("word_embeddings"))?;
        let token_type_embeddings = if config.type_vocab_size > 0 {
            Some(embedding(
                config.type_vocab_size,
                config.n_embd,
                vb.pp("token_type_embeddings"),
            )?)
        } else {
            None
        };
        Ok(Self {
            word_embeddings,
            token_type_embeddings,
        })
    }

    fn forward(&self, input_ids: &Tensor, token_type_ids: Option<&Tensor>) -> Result<Tensor> {
        let embeddings = self.word_embeddings.forward(input_ids)?;
        if let Some(tte) = &self.token_type_embeddings {
            let tt_ids = match token_type_ids {
                Some(ids) => ids.clone(),
                None => {
                    let (b, s) = input_ids.dims2()?;
                    Tensor::zeros((b, s), DType::U32, input_ids.device())?
                }
            };
            let tt_emb = tte.forward(&tt_ids)?;
            return embeddings + tt_emb;
        }
        Ok(embeddings)
    }
}

// Self-attention with fused QKV projection and rotary embeddings.
//
// On Metal, uses `candle_nn::ops::sdpa` for a fused scaled-dot-product
// attention kernel that avoids materializing the [B, H, N, N] attention
// matrix. On CPU, falls back to the naive attention path since candle's
// SDPA op has no CPU implementation.
#[derive(Clone, Debug)]
struct NomicBertAttention {
    wqkv: Linear,
    out_proj: Linear,
    num_heads: usize,
    head_dim: usize,
    n_embd: usize,
}

impl NomicBertAttention {
    fn new(vb: VarBuilder, config: &Config) -> Result<Self> {
        let wqkv = if config.qkv_proj_bias {
            linear(config.n_embd, 3 * config.n_embd, vb.pp("Wqkv"))?
        } else {
            linear_no_bias(config.n_embd, 3 * config.n_embd, vb.pp("Wqkv"))?
        };

        let out_proj = if config.qkv_proj_bias {
            linear(config.n_embd, config.n_embd, vb.pp("out_proj"))?
        } else {
            linear_no_bias(config.n_embd, config.n_embd, vb.pp("out_proj"))?
        };

        Ok(Self {
            wqkv,
            out_proj,
            num_heads: config.n_head,
            head_dim: config.head_dim(),
            n_embd: config.n_embd,
        })
    }

    fn forward(
        &self,
        hidden_states: &Tensor,
        attention_mask: &Tensor,
        rotary_emb: &RotaryEmbedding,
    ) -> Result<Tensor> {
        let (batch_size, seq_len, _) = hidden_states.dims3()?;

        let qkv = self.wqkv.forward(hidden_states)?;
        let q = qkv.narrow(D::Minus1, 0, self.n_embd)?;
        let k = qkv.narrow(D::Minus1, self.n_embd, self.n_embd)?;
        let v = qkv.narrow(D::Minus1, 2 * self.n_embd, self.n_embd)?;

        // Reshape to (batch, seq_len, num_heads, head_dim) then transpose
        // to (batch, num_heads, seq_len, head_dim) for attention + rope.
        // Q/K contiguous is required by rope_apply; V contiguous is required
        // by SDPA's matmul path. Candle's SDPA reads Q/K/V strides via
        // {q,k,v}_l.stride() but the fused Metal path assumes contiguous
        // layout for the inner matmul — keep .contiguous() on V. For Q/K
        // we can defer contiguous until after rope_apply since rope requires
        // contiguous input too (no stride win there either). Net: the three
        // .contiguous() calls stay, but the reshape+transpose+contiguous
        // sequence is now a metadata op + a single memcpy per tensor.
        let q = q
            .reshape((batch_size, seq_len, self.num_heads, self.head_dim))?
            .transpose(1, 2)?
            .contiguous()?;
        let k = k
            .reshape((batch_size, seq_len, self.num_heads, self.head_dim))?
            .transpose(1, 2)?
            .contiguous()?;
        let v = v
            .reshape((batch_size, seq_len, self.num_heads, self.head_dim))?
            .transpose(1, 2)?
            .contiguous()?;

        let q = rotary_emb.apply(&q)?;
        let k = rotary_emb.apply(&k)?;

        // SDPA routes q_seq ≤ 8 to the vector kernel, which does NOT apply
        // the attention mask. For padded inputs or masked layers that would
        // silently break correctness. Require the full (masked) kernel by
        // gating on seq_len > 8; naive handles the short-seq case.
        //
        // Backend enablement:
        //   - Metal: always on when available (candle-nn SDPA via MLX kernels).
        //   - CUDA:  only when the `flash-attn` Cargo feature is compiled in
        //            AND the runtime compute capability is Ampere+ (SM 8.0+).
        //            flash-attn-v2 kernels have no Turing/Volta path — running
        //            them on pre-Ampere crashes at dispatch. Runtime-gating on
        //            the env-propagated CC lets a single -cuda binary cover
        //            SM 7.0–9.0, with pre-Ampere falling through to the naive
        //            matmul path (slower but correct).
        let use_sdpa = {
            let _ = hidden_states;
            let mut yes = false;
            #[cfg(feature = "metal")]
            {
                yes |= matches!(hidden_states.device(), Device::Metal(_));
            }
            #[cfg(feature = "flash-attn")]
            {
                yes |= matches!(hidden_states.device(), Device::Cuda(_))
                    && super::cuda_compute_capability_from_env() >= 8.0;
            }
            yes && seq_len > 8
        };

        let attn_output = if use_sdpa {
            // Fused SDPA kernel: softmax(qk^T * scale + mask) @ v in one op.
            //
            // Mask shape contract (candle-nn SDPA): (bs, qheads, qseq, kseq).
            // The incoming `attention_mask` has shape (batch, 1, 1, seq_len) with
            // 0 for valid tokens and -1e4 for padding (see get_extended_attention_mask).
            // Broadcast to (batch, num_heads, seq_len, seq_len) as a stride view
            // — no `.contiguous()`: candle-nn SDPA reads `mask_l.stride()` and
            // accepts broadcast layouts natively, saving a mask memcpy per layer.
            let mask = attention_mask
                .broadcast_as((batch_size, self.num_heads, seq_len, seq_len))?;
            let scale = 1.0 / (self.head_dim as f64).sqrt();
            candle_nn::ops::sdpa(&q, &k, &v, Some(&mask), false, scale as f32, 1.0)?
        } else {
            // CPU path + short-seq fallback: naive attention
            // (matches upstream nomic_bert byte-for-byte).
            let scale = (self.head_dim as f64).sqrt();
            let attn_scores = (q.matmul(&k.t()?)? / scale)?;
            let attn_scores = attn_scores.broadcast_add(attention_mask)?;
            let attn_probs = candle_nn::ops::softmax_last_dim(&attn_scores)?;
            attn_probs.matmul(&v)?
        };

        let attn_output = attn_output.transpose(1, 2)?.contiguous()?;
        let attn_output = attn_output.flatten_from(D::Minus2)?;

        self.out_proj.forward(&attn_output)
    }
}

// SwiGLU feed-forward network.
#[derive(Clone, Debug)]
struct NomicBertSwiGLU {
    fc11: Linear,
    fc12: Linear,
    fc2: Linear,
}

impl NomicBertSwiGLU {
    fn new(vb: VarBuilder, config: &Config) -> Result<Self> {
        let (fc11, fc12) = if config.mlp_fc1_bias {
            (
                linear(config.n_embd, config.n_inner, vb.pp("fc11"))?,
                linear(config.n_embd, config.n_inner, vb.pp("fc12"))?,
            )
        } else {
            (
                linear_no_bias(config.n_embd, config.n_inner, vb.pp("fc11"))?,
                linear_no_bias(config.n_embd, config.n_inner, vb.pp("fc12"))?,
            )
        };
        let fc2 = if config.mlp_fc2_bias {
            linear(config.n_inner, config.n_embd, vb.pp("fc2"))?
        } else {
            linear_no_bias(config.n_inner, config.n_embd, vb.pp("fc2"))?
        };
        Ok(Self { fc11, fc12, fc2 })
    }
}

impl Module for NomicBertSwiGLU {
    fn forward(&self, xs: &Tensor) -> Result<Tensor> {
        let y = self.fc11.forward(xs)?;
        let gate = self.fc12.forward(xs)?.silu()?;
        self.fc2.forward(&(y * gate)?)
    }
}

// Transformer block: attention → norm → MLP → norm (post-norm),
// or norm → attention → norm → MLP (pre-norm).
#[derive(Clone, Debug)]
struct NomicBertBlock {
    attn: NomicBertAttention,
    mlp: NomicBertSwiGLU,
    norm1: LayerNorm,
    norm2: LayerNorm,
    prenorm: bool,
}

impl NomicBertBlock {
    fn new(vb: VarBuilder, config: &Config) -> Result<Self> {
        let attn = NomicBertAttention::new(vb.pp("attn"), config)?;
        let mlp = NomicBertSwiGLU::new(vb.pp("mlp"), config)?;
        let norm1 = layer_norm(config.n_embd, config.layer_norm_epsilon, vb.pp("norm1"))?;
        let norm2 = layer_norm(config.n_embd, config.layer_norm_epsilon, vb.pp("norm2"))?;
        Ok(Self {
            attn,
            mlp,
            norm1,
            norm2,
            prenorm: config.prenorm,
        })
    }

    fn forward(
        &self,
        hidden_states: &Tensor,
        attention_mask: &Tensor,
        rotary_emb: &RotaryEmbedding,
    ) -> Result<Tensor> {
        if self.prenorm {
            let residual = hidden_states;
            let hidden_states = self.norm1.forward(hidden_states)?;
            let attn_out = self
                .attn
                .forward(&hidden_states, attention_mask, rotary_emb)?;
            let hidden_states = (residual + attn_out)?;

            let residual = hidden_states.clone();
            let hidden_states = self.norm2.forward(&hidden_states)?;
            let mlp_out = self.mlp.forward(&hidden_states)?;
            residual + mlp_out
        } else {
            let attn_out = self
                .attn
                .forward(hidden_states, attention_mask, rotary_emb)?;
            let hidden_states = self.norm1.forward(&(hidden_states + attn_out)?)?;
            let mlp_out = self.mlp.forward(&hidden_states)?;
            self.norm2.forward(&(hidden_states + mlp_out)?)
        }
    }
}

#[derive(Clone, Debug)]
struct NomicBertEncoder {
    layers: Vec<NomicBertBlock>,
    rotary_emb: RotaryEmbedding,
}

impl NomicBertEncoder {
    fn new(vb: VarBuilder, config: &Config) -> Result<Self> {
        let layers = (0..config.n_layer)
            .map(|i| NomicBertBlock::new(vb.pp(format!("layers.{i}")), config))
            .collect::<Result<Vec<_>>>()?;
        let rotary_emb = RotaryEmbedding::new(
            config.rotary_emb_dim(),
            config.n_positions,
            config.rotary_emb_base,
            config.rotary_emb_interleaved,
            vb.dtype(),
            vb.device(),
        )?;
        Ok(Self { layers, rotary_emb })
    }

    fn forward(&self, hidden_states: &Tensor, attention_mask: &Tensor) -> Result<Tensor> {
        let mut xs = hidden_states.clone();
        for layer in &self.layers {
            xs = layer.forward(&xs, attention_mask, &self.rotary_emb)?;
        }
        Ok(xs)
    }
}

/// Convert an attention mask from (batch, seq_len) with 1=attend/0=pad
/// to (batch, 1, 1, seq_len) with 0=attend/-1e4=pad, suitable for
/// adding to attention scores before softmax.
fn get_extended_attention_mask(attention_mask: &Tensor, dtype: DType) -> Result<Tensor> {
    let mask = attention_mask.unsqueeze(1)?.unsqueeze(1)?;
    let on_true = mask.zeros_like()?.to_dtype(dtype)?;
    let on_false = Tensor::new(-1e4f32, mask.device())?
        .to_dtype(dtype)?
        .broadcast_as(mask.shape())?;
    mask.where_cond(&on_true, &on_false)
}

/// NomicBert base model with SDPA-fused Metal attention.
pub struct NomicBertModel {
    embeddings: NomicBertEmbeddings,
    emb_ln: LayerNorm,
    encoder: NomicBertEncoder,
    pub device: Device,
}

impl NomicBertModel {
    pub fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        let load_inner = |vb: VarBuilder| -> Result<Self> {
            let embeddings = NomicBertEmbeddings::new(vb.pp("embeddings"), config)?;
            let emb_ln = layer_norm(config.n_embd, config.layer_norm_epsilon, vb.pp("emb_ln"))?;
            let encoder = NomicBertEncoder::new(vb.pp("encoder"), config)?;
            Ok(Self {
                embeddings,
                emb_ln,
                encoder,
                device: vb.device().clone(),
            })
        };

        // Try without prefix, then with model_type prefix (e.g. "nomic_bert").
        load_inner(vb.clone()).or_else(|err| {
            if let Some(model_type) = &config.model_type {
                load_inner(vb.pp(model_type)).map_err(|_| err)
            } else {
                Err(err)
            }
        })
    }

    pub fn forward(
        &self,
        input_ids: &Tensor,
        token_type_ids: Option<&Tensor>,
        attention_mask: Option<&Tensor>,
    ) -> Result<Tensor> {
        let hidden_states = self.embeddings.forward(input_ids, token_type_ids)?;
        let hidden_states = self.emb_ln.forward(&hidden_states)?;

        let attention_mask = match attention_mask {
            Some(mask) => mask.clone(),
            None => input_ids.ones_like()?,
        };
        let extended_mask = get_extended_attention_mask(&attention_mask, hidden_states.dtype())?;

        self.encoder.forward(&hidden_states, &extended_mask)
    }
}

/// Mean-pool token embeddings using the attention mask.
pub fn mean_pooling(hidden_states: &Tensor, attention_mask: &Tensor) -> Result<Tensor> {
    let (batch, seq_len, hidden_dim) = hidden_states.dims3()?;
    let mask = attention_mask.to_dtype(hidden_states.dtype())?;
    let mask_expanded = mask
        .unsqueeze(2)?
        .broadcast_as((batch, seq_len, hidden_dim))?;
    let sum_hidden = (hidden_states * &mask_expanded)?.sum(1)?;
    let sum_mask = mask
        .sum(1)?
        .unsqueeze(1)?
        .broadcast_as((batch, hidden_dim))?
        .clamp(1e-9, f64::MAX)?;
    sum_hidden / sum_mask
}

/// L2-normalize embeddings to unit length along the last dimension.
///
/// Adds a small epsilon to the sum-of-squares before taking the square root
/// so that all-zero rows (which can come from fully-padded batch slots after
/// `mean_pooling`) divide by ~1e-6 instead of 0, producing 0 outputs instead
/// of NaN. Mirrors the same trick used in `li_model.rs`'s projection
/// normalisation, and prevents silent NaN propagation into HNSW vectors when
/// the indexer submits a partial last batch padded with zero-mask rows.
pub fn l2_normalize(x: &Tensor) -> Result<Tensor> {
    let norm = x
        .sqr()?
        .sum_keepdim(D::Minus1)
        .and_then(|t| (t + 1e-12f64))
        .and_then(|t| t.sqrt())?;
    x.broadcast_div(&norm)
}
