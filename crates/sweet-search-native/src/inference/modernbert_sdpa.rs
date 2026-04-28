//! ModernBERT with SDPA-fused attention (vendored).
//!
//! Copy of candle-transformers 0.10.2 modernbert.rs with the attention
//! forward replaced by `candle_nn::ops::sdpa` on Metal (fused Q@K^T → softmax
//! → @V kernel ported from MLX). CPU path retains the naive upstream
//! implementation byte-for-byte.
//!
//! Why: upstream naive attention materializes O(seq_len²) scratch tensors
//! per layer. For ModernBERT's 22 layers and typical LI batches this
//! dominates index time.
//!
//! Source: candle-transformers/src/models/modernbert.rs (v0.10.2)

use candle_core as candle;
use candle_core::{DType, Device, IndexOp, Result, Tensor, D};
use candle_nn::{
    embedding, layer_norm_no_bias, linear, linear_no_bias, ops::softmax, Embedding, LayerNorm,
    Linear, Module, VarBuilder,
};
use serde::Deserialize;

use core::f32;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Config {
    pub vocab_size: usize,
    pub hidden_size: usize,
    pub num_hidden_layers: usize,
    pub num_attention_heads: usize,
    pub intermediate_size: usize,
    pub max_position_embeddings: usize,
    pub layer_norm_eps: f64,
    pub pad_token_id: u32,
    pub global_attn_every_n_layers: usize,
    pub global_rope_theta: f64,
    pub local_attention: usize,
    pub local_rope_theta: f64,
    #[serde(default)]
    #[serde(flatten)]
    pub classifier_config: Option<ClassifierConfig>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Copy, Default)]
#[serde(rename_all = "lowercase")]
pub enum ClassifierPooling {
    #[default]
    CLS,
    MEAN,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ClassifierConfig {
    pub id2label: HashMap<String, String>,
    pub label2id: HashMap<String, String>,
    pub classifier_pooling: ClassifierPooling,
}

#[derive(Debug, Clone)]
struct RotaryEmbedding {
    sin: Tensor,
    cos: Tensor,
}

impl RotaryEmbedding {
    fn new(dtype: DType, config: &Config, rope_theta: f64, dev: &Device) -> Result<Self> {
        let dim = config.hidden_size / config.num_attention_heads;
        let inv_freq: Vec<_> = (0..dim)
            .step_by(2)
            .map(|i| 1f32 / rope_theta.powf(i as f64 / dim as f64) as f32)
            .collect();
        let inv_freq_len = inv_freq.len();
        let inv_freq = Tensor::from_vec(inv_freq, (1, inv_freq_len), dev)?.to_dtype(dtype)?;
        let max_seq_len = config.max_position_embeddings;
        let t = Tensor::arange(0u32, max_seq_len as u32, dev)?
            .to_dtype(dtype)?
            .reshape((max_seq_len, 1))?;
        let freqs = t.matmul(&inv_freq)?;
        Ok(Self {
            sin: freqs.sin()?,
            cos: freqs.cos()?,
        })
    }

    fn apply_rotary_emb_qkv(&self, q: &Tensor, k: &Tensor) -> Result<(Tensor, Tensor)> {
        let q_embed = candle_nn::rotary_emb::rope(&q.contiguous()?, &self.cos, &self.sin)?;
        let k_embed = candle_nn::rotary_emb::rope(&k.contiguous()?, &self.cos, &self.sin)?;
        Ok((q_embed, k_embed))
    }
}

#[derive(Clone)]
struct ModernBertAttention {
    qkv: Linear,
    proj: Linear,
    num_attention_heads: usize,
    attention_head_size: usize,
    rotary_emb: Arc<RotaryEmbedding>,
    /// Sliding-window radius (each query attends to keys within ±this many
    /// positions). `None` for global-attention layers, `Some(N/2)` for
    /// local-attention layers where `N = config.local_attention`. Used by
    /// the flash-attn varlen path; the naive path applies the window via
    /// the precomputed `combined_attention_mask` instead.
    /// Marked dead-code when flash-attn isn't compiled in, since the only
    /// reader of this field lives behind `#[cfg(feature = "flash-attn")]`.
    #[cfg_attr(not(feature = "flash-attn"), allow(dead_code))]
    local_window: Option<usize>,
}

impl ModernBertAttention {
    fn load(
        vb: VarBuilder,
        config: &Config,
        rotary_emb: Arc<RotaryEmbedding>,
        uses_local_attention: bool,
    ) -> Result<Self> {
        let num_attention_heads = config.num_attention_heads;
        let attention_head_size = config.hidden_size / config.num_attention_heads;

        let qkv = linear_no_bias(config.hidden_size, config.hidden_size * 3, vb.pp("Wqkv"))?;
        let proj = linear_no_bias(config.hidden_size, config.hidden_size, vb.pp("Wo"))?;

        // ModernBERT's local_attention is the total window size; the
        // symmetric per-side radius is half of it (an N=128 window means
        // each query sees 64 left + 64 right keys, including itself).
        let local_window = if uses_local_attention {
            Some(config.local_attention / 2)
        } else {
            None
        };

        Ok(Self {
            qkv,
            proj,
            num_attention_heads,
            attention_head_size,
            rotary_emb,
            local_window,
        })
    }

    /// `global_attention_mask` is the pure-padding mask `(B, 1, 1, S)`.
    /// `combined_attention_mask` adds the sliding-window restriction as
    /// additive `-1e4` on out-of-window positions. The flash-attn path
    /// uses ONLY the global mask (window applied via kernel argument);
    /// the naive path uses the combined mask (window baked into bias).
    /// On builds without the flash-attn feature, only `combined_attention_mask`
    /// is read — silence the unused-arg warning at the top of the body.
    fn forward(
        &self,
        hidden_states: &Tensor,
        global_attention_mask: &Tensor,
        combined_attention_mask: &Tensor,
    ) -> Result<Tensor> {
        // Silence unused-arg warning on non-flash-attn builds without
        // splattering a #[cfg_attr] on the function signature.
        #[cfg(not(feature = "flash-attn"))]
        let _ = global_attention_mask;
        let xs = hidden_states.clone();
        let (b, seq_len, d) = xs.dims3()?;
        let qkv = xs
            .apply(&self.qkv)?
            .reshape((
                b,
                seq_len,
                3,
                self.num_attention_heads,
                self.attention_head_size,
            ))?
            .permute((2, 0, 3, 1, 4))?;

        let q = qkv.get(0)?;
        let k = qkv.get(1)?;
        let v = qkv.get(2)?;

        let (q, k) = self.rotary_emb.apply_rotary_emb_qkv(&q, &k)?;

        // SDPA on Metal requires contiguous inputs; `v` is still a view on qkv.
        let v = v.contiguous()?;

        // Backend enablement:
        //   - Metal SDPA: Apple-Silicon fused kernel; uses combined mask
        //     so the window restriction is applied via additive bias.
        //   - CUDA flash-attn: Ampere+ with F16/BF16; uses GLOBAL mask and
        //     applies the window via the kernel's window_size_left/_right
        //     arguments (flash_attn_varlen_windowed). For global-attention
        //     layers, local_window=None and the kernel runs full attention.
        //   - Naive: portable fallback; uses combined mask (window baked in).
        let use_metal_sdpa = {
            let _ = hidden_states;
            let mut yes = false;
            #[cfg(feature = "metal")]
            {
                yes |= matches!(hidden_states.device(), Device::Metal(_));
            }
            yes && seq_len > 8
        };

        let use_flash_attn_cuda = {
            let _ = hidden_states;
            let mut yes = false;
            #[cfg(feature = "flash-attn")]
            {
                let on_cuda = matches!(hidden_states.device(), Device::Cuda(_));
                let sm_supports = super::cuda_compute_capability_from_env() >= 8.0;
                let dtype_supports = matches!(q.dtype(), DType::F16 | DType::BF16);
                yes |= on_cuda && sm_supports && dtype_supports;
            }
            yes && seq_len > 8
        };

        // For naive / Metal-SDPA paths, the additive mask already carries
        // the layer's attention pattern: combined for local layers (padding
        // + sliding-window bias), global for global layers (padding only,
        // unrestricted attention). The original ModernBertLayer::forward
        // selected this mask before calling attention; when I moved both
        // masks into the attention forward signature for the flash-attn
        // path, I incorrectly hard-coded `combined_attention_mask` here for
        // ALL layers. That made naive global layers run with the local
        // window's additive bias — silently restricting them to a 129-key
        // window instead of full attention. Kept self-consistent within
        // the BF16 baseline (both CPU and CUDA naive had the same bug,
        // so parity passed within drift), but as soon as flash-attn
        // started computing TRUE global attention on CUDA, the CPU side
        // stayed wrong and parity diverged 7pp on the median per-token
        // cosine. HF transformers picks the mask per-layer-type via
        // `attention_mask_mapping[encoder_layer.attention_type]`; this
        // restores that selection.
        let additive_attention_mask = if self.local_window.is_some() {
            combined_attention_mask
        } else {
            global_attention_mask
        };

        let xs = if use_metal_sdpa {
            // Fused Metal SDPA. Mask broadcast view (no copy) — candle-nn
            // SDPA reads stride directly, saving B×H×S×S F16 writes per layer.
            let mask_expanded = additive_attention_mask.broadcast_as((
                b,
                self.num_attention_heads,
                seq_len,
                seq_len,
            ))?;
            let scale = 1.0 / (self.attention_head_size as f64).sqrt();
            candle_nn::ops::sdpa(&q, &k, &v, Some(&mask_expanded), false, scale as f32, 1.0)?
        } else if use_flash_attn_cuda {
            // CUDA flash-attn. Pass the GLOBAL mask (padding only) plus the
            // window argument; flash-attn applies the window via its kernel
            // argument, NOT via additive bias. See varlen.rs for the
            // pack/unpack contract around cu_seqlens.
            #[cfg(feature = "flash-attn")]
            {
                let scale = 1.0 / (self.attention_head_size as f64).sqrt();
                super::varlen::flash_attn_padded(
                    &q,
                    &k,
                    &v,
                    global_attention_mask,
                    scale as f32,
                    self.local_window,
                )?
            }
            #[cfg(not(feature = "flash-attn"))]
            unreachable!("use_flash_attn_cuda requires the flash-attn feature")
        } else {
            // Portable naive attention. Uses additive_attention_mask
            // (combined for local layers, global for global layers) —
            // matches upstream HF transformers' attention_mask_mapping
            // selection.
            let scale = (self.attention_head_size as f64).powf(-0.5);
            let q = (q * scale)?;
            let att = q.matmul(&k.transpose(D::Minus2, D::Minus1)?)?;
            let att = att.broadcast_add(additive_attention_mask)?;
            let att = softmax(&att, D::Minus1)?;
            att.matmul(&v)?
        };

        let xs = xs.transpose(1, 2)?.reshape((b, seq_len, d))?;
        let xs = xs.apply(&self.proj)?;
        let xs = xs.reshape((b, seq_len, d))?;

        Ok(xs)
    }
}

#[derive(Clone)]
pub struct ModernBertMLP {
    wi: Linear,
    wo: Linear,
}

impl ModernBertMLP {
    fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        let wi = linear_no_bias(
            config.hidden_size,
            config.intermediate_size * 2,
            vb.pp("Wi"),
        )?;
        let wo = linear_no_bias(config.intermediate_size, config.hidden_size, vb.pp("Wo"))?;
        Ok(Self { wi, wo })
    }
}

impl Module for ModernBertMLP {
    fn forward(&self, xs: &Tensor) -> Result<Tensor> {
        let xs = xs.apply(&self.wi)?;
        let xs = xs.chunk(2, D::Minus1)?;
        let xs = (&xs[0].gelu_erf()? * &xs[1])?.apply(&self.wo)?; // GeGLU
        Ok(xs)
    }
}

#[derive(Clone)]
pub struct ModernBertLayer {
    attn: ModernBertAttention,
    mlp: ModernBertMLP,
    attn_norm: Option<LayerNorm>,
    mlp_norm: LayerNorm,
    // `uses_local_attention` used to live on the layer to decide which mask
    // to pass to attention. Now lives on ModernBertAttention (as the
    // local_window field) since the flash-attn path needs the per-side
    // window radius, not just a boolean. The layer always passes both
    // masks; the attention picks based on which kernel runs.
}

impl ModernBertLayer {
    fn load(
        vb: VarBuilder,
        config: &Config,
        rotary_emb: Arc<RotaryEmbedding>,
        uses_local_attention: bool,
    ) -> Result<Self> {
        // ModernBertAttention needs uses_local_attention to derive its
        // local_window radius for the flash-attn windowed kernel.
        let attn =
            ModernBertAttention::load(vb.pp("attn"), config, rotary_emb, uses_local_attention)?;
        let mlp = ModernBertMLP::load(vb.pp("mlp"), config)?;
        let attn_norm = layer_norm_no_bias(
            config.hidden_size,
            config.layer_norm_eps,
            vb.pp("attn_norm"),
        )
        .ok();
        let mlp_norm =
            layer_norm_no_bias(config.hidden_size, config.layer_norm_eps, vb.pp("mlp_norm"))?;
        Ok(Self {
            attn,
            mlp,
            attn_norm,
            mlp_norm,
        })
    }

    fn forward(
        &self,
        xs: &Tensor,
        global_attention_mask: &Tensor,
        combined_attention_mask: &Tensor,
    ) -> Result<Tensor> {
        let residual = xs.clone();
        let mut xs = xs.clone();
        if let Some(norm) = &self.attn_norm {
            xs = xs.apply(norm)?;
        }

        // ModernBertAttention now takes BOTH masks and chooses internally:
        //   - flash-attn path: global mask + window kernel argument
        //   - naive/Metal path: combined mask (window in additive bias)
        // The mask selection used to live here, but the flash-attn path
        // needs the global mask while the naive path needs the combined
        // one — let the attention layer pick based on which kernel runs.
        let xs = self
            .attn
            .forward(&xs, global_attention_mask, combined_attention_mask)?;
        let xs = (xs + residual)?;
        let mlp_out = xs.apply(&self.mlp_norm)?.apply(&self.mlp)?;
        let xs = (xs + mlp_out)?;
        Ok(xs)
    }
}

#[derive(Clone)]
pub struct ModernBertHead {
    dense: Linear,
    norm: LayerNorm,
}

impl ModernBertHead {
    fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        let dense = linear_no_bias(config.hidden_size, config.hidden_size, vb.pp("dense"))?;
        let norm = layer_norm_no_bias(config.hidden_size, config.layer_norm_eps, vb.pp("norm"))?;
        Ok(Self { dense, norm })
    }
}

impl Module for ModernBertHead {
    fn forward(&self, xs: &Tensor) -> Result<Tensor> {
        let xs = xs.apply(&self.dense)?.gelu_erf()?.apply(&self.norm)?;
        Ok(xs)
    }
}

#[derive(Clone)]
pub struct ModernBertDecoder {
    decoder: Linear,
}

impl ModernBertDecoder {
    fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        // The decoder weights are tied with the embeddings layer weights
        let decoder_weights = vb.get(
            (config.vocab_size, config.hidden_size),
            "model.embeddings.tok_embeddings.weight",
        )?;
        let decoder_bias = vb.get(config.vocab_size, "decoder.bias")?;
        let decoder = Linear::new(decoder_weights, Some(decoder_bias));
        Ok(Self { decoder })
    }
}

impl Module for ModernBertDecoder {
    fn forward(&self, xs: &Tensor) -> Result<Tensor> {
        let xs = xs.apply(&self.decoder)?;
        Ok(xs)
    }
}

// Global attention mask calculated from padded token inputs.
//
// The mask value must stay within F16 range (|x| < 65504) because candle's
// Metal SDPA kernel downcasts to F16 internally even when activations are F32.
// Upstream candle-transformers modernbert.rs uses `f32::MIN` (-3.4e38), which
// saturates to -Inf in F16 and poisons every padded row with NaN after softmax
// — LI encoding of any batched mixed-length input silently produced NaN
// vectors, collapsing gencodesearchnet MRR to 25%. -1e4 is large enough to
// zero padding contributions after softmax and small enough to survive the
// F16 downcast; this matches what `nomic_bert_sdpa` uses for the embedding
// model and what upstream HF transformers does for bf16-aware masks.
fn prepare_4d_attention_mask(
    mask: &Tensor,
    dtype: DType,
    tgt_len: Option<usize>,
) -> Result<Tensor> {
    let bsz = mask.dim(0)?;
    let src_len = mask.dim(1)?;
    let tgt_len = tgt_len.unwrap_or(src_len);

    let expanded_mask = mask
        .unsqueeze(1)?
        .unsqueeze(2)?
        .expand((bsz, 1, tgt_len, src_len))?
        .to_dtype(dtype)?;

    let inverted_mask = (1.0 - expanded_mask)?;

    (inverted_mask * -1e4_f64)?.to_dtype(dtype)
}

// Attention mask caused by the sliding window.
//
// Uses -1e4 instead of `f32::NEG_INFINITY` because Metal SDPA downcasts the
// mask to F16 internally. Real -Inf becomes F16::NEG_INFINITY and then
// combines with the global mask via `broadcast_add`, which produces -Inf
// tensors that `softmax` then turns into NaN on padded rows. -1e4 is small
// enough to zero out attention weights after softmax (exp(-1e4)≈0) and large
// enough to survive any internal F16 downcast.
fn get_local_attention_mask(
    seq_len: usize,
    max_distance: usize,
    dtype: DType,
    device: &Device,
) -> Result<Tensor> {
    let mask: Vec<_> = (0..seq_len)
        .flat_map(|i| {
            (0..seq_len).map(move |j| {
                if (j as i32 - i as i32).abs() > max_distance as i32 {
                    -1e4_f32
                } else {
                    0.
                }
            })
        })
        .collect();
    Tensor::from_slice(&mask, (seq_len, seq_len), device)?.to_dtype(dtype)
}

// ModernBERT backbone
#[derive(Clone)]
pub struct ModernBert {
    word_embeddings: Embedding,
    norm: LayerNorm,
    layers: Vec<ModernBertLayer>,
    final_norm: LayerNorm,
    local_attention_size: usize,
    // Target compute dtype (F16 on Metal, F32 on CPU). Captured from VarBuilder
    // so attention-mask preparation can match the hidden-state dtype. The
    // upstream candle-transformers modernbert.rs hardcodes DType::F32 here,
    // which is the bug upstream PR #2872 fixed in bert.rs but never ported.
    dtype: DType,
    // Per-seq-len cache for the sliding-window mask. Deterministic given
    // (seq_len, max_distance, device, dtype), so rebuilding every forward
    // was pure waste (extra Metal dispatches + tensor alloc).
    local_mask_cache: Arc<Mutex<HashMap<usize, Tensor>>>,
}

impl ModernBert {
    pub fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        let word_embeddings = embedding(
            config.vocab_size,
            config.hidden_size,
            vb.pp("model.embeddings.tok_embeddings"),
        )?;
        let norm = layer_norm_no_bias(
            config.hidden_size,
            config.layer_norm_eps,
            vb.pp("model.embeddings.norm"),
        )?;
        let global_rotary_emb = Arc::new(RotaryEmbedding::new(
            vb.dtype(),
            config,
            config.global_rope_theta,
            vb.device(),
        )?);
        let local_rotary_emb = Arc::new(RotaryEmbedding::new(
            vb.dtype(),
            config,
            config.local_rope_theta,
            vb.device(),
        )?);

        let mut layers = Vec::with_capacity(config.num_hidden_layers);
        for layer_id in 0..config.num_hidden_layers {
            let layer_uses_local_attention = layer_id % config.global_attn_every_n_layers != 0;
            layers.push(ModernBertLayer::load(
                vb.pp(format!("model.layers.{layer_id}")),
                config,
                if layer_uses_local_attention {
                    local_rotary_emb.clone()
                } else {
                    global_rotary_emb.clone()
                },
                layer_uses_local_attention,
            )?);
        }

        let final_norm = layer_norm_no_bias(
            config.hidden_size,
            config.layer_norm_eps,
            vb.pp("model.final_norm"),
        )?;

        Ok(Self {
            word_embeddings,
            norm,
            layers,
            final_norm,
            local_attention_size: config.local_attention,
            dtype: vb.dtype(),
            local_mask_cache: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn forward(&self, xs: &Tensor, mask: &Tensor) -> Result<Tensor> {
        let seq_len = xs.shape().dims()[1];
        let global_attention_mask =
            prepare_4d_attention_mask(mask, self.dtype, None)?.to_device(xs.device())?;

        let local_attention_mask = {
            let mut cache = self.local_mask_cache.lock().unwrap();
            if let Some(cached) = cache.get(&seq_len) {
                cached.clone()
            } else {
                let built = get_local_attention_mask(
                    seq_len,
                    self.local_attention_size / 2,
                    self.dtype,
                    xs.device(),
                )?;
                cache.insert(seq_len, built.clone());
                built
            }
        };

        // Precompute combined mask (global + local) once per forward. Layers
        // that use local attention re-use this; global-only layers read the
        // bare global mask. The old code did this broadcast_add in every
        // local layer, burning ~15 extra kernel dispatches per forward.
        let combined_attention_mask = global_attention_mask.broadcast_add(&local_attention_mask)?;

        let mut xs = xs.apply(&self.word_embeddings)?.apply(&self.norm)?;
        for layer in self.layers.iter() {
            xs = layer.forward(&xs, &global_attention_mask, &combined_attention_mask)?;
        }
        let xs = xs.apply(&self.final_norm)?;
        Ok(xs)
    }
}

// ModernBERT for the fill-mask task
#[derive(Clone)]
pub struct ModernBertForMaskedLM {
    model: ModernBert,
    decoder: ModernBertDecoder,
    head: ModernBertHead,
}

impl ModernBertForMaskedLM {
    pub fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        let model = ModernBert::load(vb.clone(), config)?;
        let decoder = ModernBertDecoder::load(vb.clone(), config)?;
        let head = ModernBertHead::load(vb.pp("head"), config)?;
        Ok(Self {
            model,
            decoder,
            head,
        })
    }

    pub fn forward(&self, xs: &Tensor, mask: &Tensor) -> Result<Tensor> {
        let xs = self
            .model
            .forward(xs, mask)?
            .apply(&self.head)?
            .apply(&self.decoder)?;
        Ok(xs)
    }
}

#[derive(Clone)]
pub struct ModernBertClassifier {
    classifier: Linear,
}

impl ModernBertClassifier {
    fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        // The decoder weights are tied with the embeddings layer weights
        let classifier = linear(
            config.hidden_size,
            config
                .classifier_config
                .as_ref()
                .map(|cc| cc.id2label.len())
                .unwrap_or_default(),
            vb.pp("classifier"),
        )?;
        Ok(Self { classifier })
    }
}

impl Module for ModernBertClassifier {
    fn forward(&self, xs: &Tensor) -> Result<Tensor> {
        let xs = xs.apply(&self.classifier)?;
        softmax(&xs, D::Minus1)
    }
}

#[derive(Clone)]
pub struct ModernBertForSequenceClassification {
    model: ModernBert,
    head: ModernBertHead,
    classifier: ModernBertClassifier,
    classifier_pooling: ClassifierPooling,
}

impl ModernBertForSequenceClassification {
    pub fn load(vb: VarBuilder, config: &Config) -> Result<Self> {
        let model = ModernBert::load(vb.clone(), config)?;
        let classifier = ModernBertClassifier::load(vb.clone(), config)?;
        let head = ModernBertHead::load(vb.pp("head"), config)?;
        Ok(Self {
            model,
            head,
            classifier,
            classifier_pooling: config
                .classifier_config
                .as_ref()
                .map(|cc| cc.classifier_pooling)
                .unwrap_or_default(),
        })
    }

    pub fn forward(&self, xs: &Tensor, mask: &Tensor) -> Result<Tensor> {
        let output = self.model.forward(xs, mask)?;
        let last_hidden_state = match self.classifier_pooling {
            ClassifierPooling::CLS => output.i((.., 0, ..))?.contiguous()?,
            ClassifierPooling::MEAN => {
                let unsqueezed_mask = &mask.unsqueeze(D::Minus1)?.to_dtype(DType::F32)?;
                let sum_output = output.broadcast_mul(unsqueezed_mask)?.sum(1)?;
                sum_output.broadcast_div(&mask.sum_keepdim(1)?.to_dtype(DType::F32)?)?
            }
        };
        let xs = self
            .head
            .forward(&last_hidden_state)?
            .apply(&self.classifier)?;
        Ok(xs)
    }
}
