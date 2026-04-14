"""
Minimal PyTorch port of NomicBERT for the CoreML conversion spike.

Mirrors crates/sweet-search-native/src/inference/nomic_bert_sdpa.rs exactly:
- 12-layer post-norm encoder
- Fused QKV with no bias
- RoPE (non-interleaved, base=1000.0, full head_dim coverage)
- SwiGLU FFN: fc2(fc11(x) * silu(fc12(x))), no biases
- Pre-encoder LayerNorm (emb_ln) on word + token_type embeddings
- Mean pooling with attention mask, then L2 normalize

Loads directly from CodeRankEmbed safetensors (matches Rust key naming).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import json
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from safetensors.torch import load_file


@dataclass
class NomicBertConfig:
    vocab_size: int = 30528
    n_embd: int = 768
    n_head: int = 12
    n_layer: int = 12
    n_inner: int = 3072
    n_positions: int = 8192
    type_vocab_size: int = 2
    layer_norm_epsilon: float = 1e-12
    rotary_emb_fraction: float = 1.0
    rotary_emb_base: float = 1000.0
    rotary_emb_interleaved: bool = False
    qkv_proj_bias: bool = False
    mlp_fc1_bias: bool = False
    mlp_fc2_bias: bool = False
    activation_function: str = "swiglu"
    prenorm: bool = False

    @property
    def head_dim(self) -> int:
        return self.n_embd // self.n_head

    @property
    def rotary_emb_dim(self) -> int:
        return int(self.head_dim * self.rotary_emb_fraction)

    @classmethod
    def from_json(cls, path: str) -> "NomicBertConfig":
        with open(path) as f:
            data = json.load(f)
        return cls(
            vocab_size=data["vocab_size"],
            n_embd=data["n_embd"],
            n_head=data["n_head"],
            n_layer=data["n_layer"],
            n_inner=data["n_inner"],
            n_positions=data["n_positions"],
            type_vocab_size=data["type_vocab_size"],
            layer_norm_epsilon=data["layer_norm_epsilon"],
            rotary_emb_fraction=data["rotary_emb_fraction"],
            rotary_emb_base=float(data["rotary_emb_base"]),
            rotary_emb_interleaved=data["rotary_emb_interleaved"],
            qkv_proj_bias=data["qkv_proj_bias"],
            mlp_fc1_bias=data["mlp_fc1_bias"],
            mlp_fc2_bias=data["mlp_fc2_bias"],
            activation_function=data["activation_function"],
            prenorm=data["prenorm"],
        )


def _build_rotary_cache(dim: int, max_seq_len: int, base: float, dtype: torch.dtype, device: torch.device):
    """Precompute cos/sin tables for non-interleaved RoPE.

    Returns cos, sin of shape (max_seq_len, dim/2). The half-width is what
    candle_nn::rotary_emb::rope expects for the non-interleaved variant.
    """
    half_dim = dim // 2
    inv_freq = 1.0 / (base ** (torch.arange(0, half_dim, dtype=torch.float32, device=device) * (2.0 / dim)))
    positions = torch.arange(max_seq_len, dtype=torch.float32, device=device)
    freqs = torch.outer(positions, inv_freq)  # (max_seq_len, half_dim)
    return freqs.cos().to(dtype), freqs.sin().to(dtype)


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """Non-interleaved RoPE matching candle_nn::rotary_emb::rope.

    x: (batch, n_heads, seq_len, head_dim)
    cos/sin: (max_seq_len, head_dim/2)

    Convention: x is split into x1 = x[..., :half] and x2 = x[..., half:].
    The rotation is:
        out[..., :half] = x1 * cos - x2 * sin
        out[..., half:] = x1 * sin + x2 * cos
    """
    seq_len = x.shape[-2]
    half = x.shape[-1] // 2
    cos_s = cos[:seq_len].view(1, 1, seq_len, half)
    sin_s = sin[:seq_len].view(1, 1, seq_len, half)
    x1 = x[..., :half]
    x2 = x[..., half:]
    return torch.cat([x1 * cos_s - x2 * sin_s, x1 * sin_s + x2 * cos_s], dim=-1)


class NomicBertEmbeddings(nn.Module):
    def __init__(self, config: NomicBertConfig):
        super().__init__()
        self.word_embeddings = nn.Embedding(config.vocab_size, config.n_embd)
        self.token_type_embeddings = (
            nn.Embedding(config.type_vocab_size, config.n_embd)
            if config.type_vocab_size > 0
            else None
        )

    def forward(self, input_ids: torch.Tensor, token_type_ids: torch.Tensor | None = None) -> torch.Tensor:
        x = self.word_embeddings(input_ids)
        if self.token_type_embeddings is not None:
            if token_type_ids is None:
                token_type_ids = torch.zeros_like(input_ids)
            x = x + self.token_type_embeddings(token_type_ids)
        return x


class NomicBertAttention(nn.Module):
    def __init__(self, config: NomicBertConfig):
        super().__init__()
        self.num_heads = config.n_head
        self.head_dim = config.head_dim
        self.n_embd = config.n_embd
        self.Wqkv = nn.Linear(config.n_embd, 3 * config.n_embd, bias=config.qkv_proj_bias)
        self.out_proj = nn.Linear(config.n_embd, config.n_embd, bias=config.qkv_proj_bias)

    def forward(self, hidden: torch.Tensor, attn_mask: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
        bsz, seq, _ = hidden.shape
        qkv = self.Wqkv(hidden)  # (B, S, 3*n_embd)
        q, k, v = qkv.split(self.n_embd, dim=-1)
        # (B, S, H, D) -> (B, H, S, D)
        q = q.view(bsz, seq, self.num_heads, self.head_dim).transpose(1, 2).contiguous()
        k = k.view(bsz, seq, self.num_heads, self.head_dim).transpose(1, 2).contiguous()
        v = v.view(bsz, seq, self.num_heads, self.head_dim).transpose(1, 2).contiguous()
        q = apply_rope(q, cos, sin)
        k = apply_rope(k, cos, sin)
        # SDPA: softmax(qk^T * scale + mask) @ v. The mask has shape
        # (B, 1, 1, S) with 0/-1e4, broadcasting over heads and rows.
        scale = 1.0 / math.sqrt(self.head_dim)
        scores = torch.matmul(q, k.transpose(-2, -1)) * scale
        scores = scores + attn_mask
        probs = torch.softmax(scores, dim=-1)
        attn_out = torch.matmul(probs, v)  # (B, H, S, D)
        attn_out = attn_out.transpose(1, 2).contiguous().view(bsz, seq, self.n_embd)
        return self.out_proj(attn_out)


class NomicBertSwiGLU(nn.Module):
    def __init__(self, config: NomicBertConfig):
        super().__init__()
        self.fc11 = nn.Linear(config.n_embd, config.n_inner, bias=config.mlp_fc1_bias)
        self.fc12 = nn.Linear(config.n_embd, config.n_inner, bias=config.mlp_fc1_bias)
        self.fc2 = nn.Linear(config.n_inner, config.n_embd, bias=config.mlp_fc2_bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Matches candle: y = fc11(x); gate = silu(fc12(x)); fc2(y * gate)
        y = self.fc11(x)
        gate = F.silu(self.fc12(x))
        return self.fc2(y * gate)


class NomicBertBlock(nn.Module):
    def __init__(self, config: NomicBertConfig):
        super().__init__()
        self.attn = NomicBertAttention(config)
        self.mlp = NomicBertSwiGLU(config)
        self.norm1 = nn.LayerNorm(config.n_embd, eps=config.layer_norm_epsilon)
        self.norm2 = nn.LayerNorm(config.n_embd, eps=config.layer_norm_epsilon)
        self.prenorm = config.prenorm

    def forward(self, hidden: torch.Tensor, attn_mask: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
        if self.prenorm:
            residual = hidden
            h = self.norm1(hidden)
            h = residual + self.attn(h, attn_mask, cos, sin)
            residual = h
            h = self.norm2(h)
            return residual + self.mlp(h)
        # Post-norm (CodeRankEmbed default).
        attn_out = self.attn(hidden, attn_mask, cos, sin)
        h = self.norm1(hidden + attn_out)
        mlp_out = self.mlp(h)
        return self.norm2(h + mlp_out)


class NomicBertEncoder(nn.Module):
    def __init__(self, config: NomicBertConfig):
        super().__init__()
        self.layers = nn.ModuleList([NomicBertBlock(config) for _ in range(config.n_layer)])

    def forward(self, hidden: torch.Tensor, attn_mask: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
        for layer in self.layers:
            hidden = layer(hidden, attn_mask, cos, sin)
        return hidden


class NomicBertModel(nn.Module):
    def __init__(self, config: NomicBertConfig):
        super().__init__()
        self.config = config
        self.embeddings = NomicBertEmbeddings(config)
        self.emb_ln = nn.LayerNorm(config.n_embd, eps=config.layer_norm_epsilon)
        self.encoder = NomicBertEncoder(config)
        cos, sin = _build_rotary_cache(
            config.rotary_emb_dim,
            config.n_positions,
            config.rotary_emb_base,
            torch.float32,
            torch.device("cpu"),
        )
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)

    def _extended_mask(self, attention_mask: torch.Tensor, dtype: torch.dtype) -> torch.Tensor:
        """(B, S) [1=attend/0=pad] -> (B, 1, 1, S) [0/-1e4]. Matches candle's get_extended_attention_mask."""
        m = attention_mask.unsqueeze(1).unsqueeze(1).to(dtype)
        return torch.where(m > 0, torch.zeros_like(m), torch.full_like(m, -1e4))

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor, token_type_ids: torch.Tensor | None = None) -> torch.Tensor:
        x = self.embeddings(input_ids, token_type_ids)
        x = self.emb_ln(x)
        ext_mask = self._extended_mask(attention_mask, x.dtype)
        return self.encoder(x, ext_mask, self.rope_cos.to(x.dtype), self.rope_sin.to(x.dtype))

    @torch.no_grad()
    def encode(self, input_ids: torch.Tensor, attention_mask: torch.Tensor, token_type_ids: torch.Tensor | None = None) -> torch.Tensor:
        """Full pipeline: forward → mean pool → L2 normalize. Returns (B, n_embd)."""
        hidden = self.forward(input_ids, attention_mask, token_type_ids)
        mask_f = attention_mask.to(hidden.dtype).unsqueeze(-1)
        summed = (hidden * mask_f).sum(dim=1)
        denom = mask_f.sum(dim=1).clamp_min(1e-9)
        pooled = summed / denom
        return F.normalize(pooled, p=2, dim=-1)


def load_nomic_bert(safetensors_path: str, config_path: str, device: str = "cpu") -> NomicBertModel:
    config = NomicBertConfig.from_json(config_path)
    model = NomicBertModel(config)
    state = load_file(safetensors_path)
    missing, unexpected = model.load_state_dict(state, strict=True)
    if missing or unexpected:
        raise RuntimeError(f"State dict mismatch — missing: {missing}, unexpected: {unexpected}")
    model.eval()
    model.to(device)
    return model
