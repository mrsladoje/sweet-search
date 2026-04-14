"""
Minimal PyTorch port of ModernBERT for the CoreML conversion spike.

Mirrors crates/sweet-search-native/src/inference/modernbert_sdpa.rs exactly:
- 22-layer post-norm encoder with dual RoPE scales (global theta=160000,
  local theta=10000) and sliding-window local attention (window=128).
- Fused QKV with no bias; no-bias LayerNorm throughout (eps=1e-5).
- GeGLU FFN: Wi(x).chunk(2,-1) → (gate.gelu() * up) → Wo.
- Layer 0 has NO `attn_norm` (optional in the HF layout, absent in the
  LateOn-Code weights); all other layers do.
- Mask values clamped to -1e4 (not -inf) to survive any BF16/F16 downcast
  in the downstream CoreML / Metal SDPA kernels.
- Adds a ModernBertLI wrapper that applies the 768→128 projection from
  1_Dense/model.safetensors + per-token L2 normalise (epsilon-before-sqrt
  to prevent 0/0 on fully-padded rows, same trick used in li_model.rs).

Loads directly from the LateOn-Code safetensors (top-level keys, no
"model." prefix — candle strips that prefix in li_model.rs, we just skip
the prefix entirely and use names matching the raw safetensors).
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
class ModernBertConfig:
    vocab_size: int = 50370
    hidden_size: int = 768
    num_hidden_layers: int = 22
    num_attention_heads: int = 12
    intermediate_size: int = 1152
    max_position_embeddings: int = 8192
    layer_norm_eps: float = 1e-5
    global_attn_every_n_layers: int = 3
    global_rope_theta: float = 160000.0
    local_attention: int = 128   # sliding window full width; half = 64
    local_rope_theta: float = 10000.0

    @property
    def head_dim(self) -> int:
        return self.hidden_size // self.num_attention_heads

    @classmethod
    def from_json(cls, path: str) -> "ModernBertConfig":
        with open(path) as f:
            data = json.load(f)
        return cls(
            vocab_size=data["vocab_size"],
            hidden_size=data["hidden_size"],
            num_hidden_layers=data["num_hidden_layers"],
            num_attention_heads=data["num_attention_heads"],
            intermediate_size=data["intermediate_size"],
            max_position_embeddings=data["max_position_embeddings"],
            layer_norm_eps=float(data["layer_norm_eps"]),
            global_attn_every_n_layers=data["global_attn_every_n_layers"],
            global_rope_theta=float(data["global_rope_theta"]),
            local_attention=data["local_attention"],
            local_rope_theta=float(data["local_rope_theta"]),
        )


# ──────────────────────────────────────────────────────────────────────
#  RoPE (non-interleaved / NeoX-style, matches candle_nn::rotary_emb::rope)
# ──────────────────────────────────────────────────────────────────────

def _build_rope_tables(dim: int, max_seq_len: int, rope_theta: float, dtype: torch.dtype, device: torch.device):
    """Precompute cos/sin tables.

    Mirrors the Rust `RotaryEmbedding::new`:
      inv_freq[i] = 1 / rope_theta^(i/dim)  for i in 0, 2, 4, ..., dim-2
      positions = [0, 1, ..., max_seq_len-1]
      freqs[m, j] = m * inv_freq[j]
    Returns cos/sin of shape (max_seq_len, dim/2).
    """
    half_dim = dim // 2
    # i ranges over 0, 2, 4, ..., dim-2 — i/dim goes 0, 2/dim, 4/dim, ...
    # Equivalent to 2*j/dim for j in 0..half_dim.
    exponents = torch.arange(0, half_dim, dtype=torch.float32, device=device) * (2.0 / dim)
    inv_freq = rope_theta ** (-exponents)
    positions = torch.arange(max_seq_len, dtype=torch.float32, device=device)
    freqs = torch.outer(positions, inv_freq)  # (max_seq_len, half_dim)
    return freqs.cos().to(dtype), freqs.sin().to(dtype)


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """Non-interleaved RoPE matching candle_nn::rotary_emb::rope.

    x: (batch, n_heads, seq_len, head_dim)
    cos/sin: (max_seq_len, head_dim/2)

    Convention (NeoX-style, split last dim in half):
        x1 = x[..., :half], x2 = x[..., half:]
        out[..., :half] = x1*cos - x2*sin
        out[..., half:] = x1*sin + x2*cos
    """
    seq_len = x.shape[-2]
    half = x.shape[-1] // 2
    cos_s = cos[:seq_len].view(1, 1, seq_len, half)
    sin_s = sin[:seq_len].view(1, 1, seq_len, half)
    x1 = x[..., :half]
    x2 = x[..., half:]
    return torch.cat([x1 * cos_s - x2 * sin_s, x1 * sin_s + x2 * cos_s], dim=-1)


# ──────────────────────────────────────────────────────────────────────
#  Attention
# ──────────────────────────────────────────────────────────────────────

class ModernBertAttention(nn.Module):
    def __init__(self, config: ModernBertConfig):
        super().__init__()
        self.num_heads = config.num_attention_heads
        self.head_dim = config.head_dim
        self.hidden_size = config.hidden_size
        self.Wqkv = nn.Linear(config.hidden_size, 3 * config.hidden_size, bias=False)
        self.Wo = nn.Linear(config.hidden_size, config.hidden_size, bias=False)

    def forward(
        self,
        hidden: torch.Tensor,
        attention_mask: torch.Tensor,  # (B, 1, S, S) additive, 0 or -1e4
        cos: torch.Tensor,
        sin: torch.Tensor,
    ) -> torch.Tensor:
        b, seq, d = hidden.shape
        # (B, S, 3*H*D) → (B, S, 3, H, D) → (3, B, H, S, D)
        qkv = self.Wqkv(hidden).view(b, seq, 3, self.num_heads, self.head_dim).permute(2, 0, 3, 1, 4).contiguous()
        q, k, v = qkv[0], qkv[1], qkv[2]
        q = apply_rope(q, cos, sin)
        k = apply_rope(k, cos, sin)

        # Scaled dot-product attention with additive mask.
        scale = 1.0 / math.sqrt(self.head_dim)
        scores = torch.matmul(q, k.transpose(-2, -1)) * scale
        scores = scores + attention_mask                 # broadcast across heads
        probs = torch.softmax(scores, dim=-1)
        out = torch.matmul(probs, v)                     # (B, H, S, D)

        out = out.transpose(1, 2).contiguous().view(b, seq, d)
        return self.Wo(out)


# ──────────────────────────────────────────────────────────────────────
#  MLP — GeGLU
# ──────────────────────────────────────────────────────────────────────

class ModernBertMLP(nn.Module):
    def __init__(self, config: ModernBertConfig):
        super().__init__()
        self.Wi = nn.Linear(config.hidden_size, 2 * config.intermediate_size, bias=False)
        self.Wo = nn.Linear(config.intermediate_size, config.hidden_size, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Wi: (B, S, 2*I) → chunk on last dim → [gate, up] each (B, S, I)
        # Gate through GELU (erf approximation), multiply by up, project down.
        gate, up = self.Wi(x).chunk(2, dim=-1)
        return self.Wo(F.gelu(gate, approximate="none") * up)


# ──────────────────────────────────────────────────────────────────────
#  Layer
# ──────────────────────────────────────────────────────────────────────

class ModernBertLayer(nn.Module):
    def __init__(self, config: ModernBertConfig, layer_idx: int):
        super().__init__()
        self.attn = ModernBertAttention(config)
        self.mlp = ModernBertMLP(config)
        # Layer 0 has no attn_norm in the LateOn-Code weights; the
        # embeddings.norm at the top of the encoder serves that role.
        # All other layers have it.
        self.attn_norm: Optional[nn.LayerNorm] = (
            nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps, bias=False)
            if layer_idx > 0
            else None
        )
        self.mlp_norm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps, bias=False)
        self.uses_local_attention = layer_idx % config.global_attn_every_n_layers != 0

    def forward(
        self,
        xs: torch.Tensor,
        global_mask: torch.Tensor,
        combined_mask: torch.Tensor,
        global_cos: torch.Tensor, global_sin: torch.Tensor,
        local_cos: torch.Tensor, local_sin: torch.Tensor,
    ) -> torch.Tensor:
        residual = xs
        h = xs if self.attn_norm is None else self.attn_norm(xs)
        if self.uses_local_attention:
            attn_out = self.attn(h, combined_mask, local_cos, local_sin)
        else:
            attn_out = self.attn(h, global_mask, global_cos, global_sin)
        xs = residual + attn_out
        mlp_out = self.mlp(self.mlp_norm(xs))
        return xs + mlp_out


# ──────────────────────────────────────────────────────────────────────
#  ModernBERT backbone
# ──────────────────────────────────────────────────────────────────────

class ModernBert(nn.Module):
    def __init__(self, config: ModernBertConfig):
        super().__init__()
        self.config = config
        self.embeddings = ModernBertEmbeddings(config)
        self.layers = nn.ModuleList(
            [ModernBertLayer(config, i) for i in range(config.num_hidden_layers)]
        )
        self.final_norm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps, bias=False)

        # Dual RoPE caches — global (theta=160k) and local (theta=10k).
        g_cos, g_sin = _build_rope_tables(
            config.head_dim, config.max_position_embeddings,
            config.global_rope_theta, torch.float32, torch.device("cpu"),
        )
        l_cos, l_sin = _build_rope_tables(
            config.head_dim, config.max_position_embeddings,
            config.local_rope_theta, torch.float32, torch.device("cpu"),
        )
        self.register_buffer("global_rope_cos", g_cos, persistent=False)
        self.register_buffer("global_rope_sin", g_sin, persistent=False)
        self.register_buffer("local_rope_cos", l_cos, persistent=False)
        self.register_buffer("local_rope_sin", l_sin, persistent=False)

    def _prepare_global_mask(self, attention_mask: torch.Tensor, dtype: torch.dtype) -> torch.Tensor:
        """(B, S) 1=attend/0=pad → (B, 1, S, S) additive 0/-1e4.

        Matches `prepare_4d_attention_mask` in modernbert_sdpa.rs: starts
        from the 2D mask, broadcasts to (B, 1, S, S), inverts to 1=pad,
        multiplies by -1e4, returns in the model dtype.
        """
        bsz, src = attention_mask.shape
        expanded = attention_mask.unsqueeze(1).unsqueeze(2).to(dtype)           # (B,1,1,S)
        expanded = expanded.expand(bsz, 1, src, src)                             # (B,1,S,S)
        inverted = 1.0 - expanded
        return inverted * -1e4

    def _local_mask(self, seq_len: int, dtype: torch.dtype, device: torch.device) -> torch.Tensor:
        """Sliding-window mask (S, S) with -1e4 outside ±half of diagonal.

        Mirrors `get_local_attention_mask` in modernbert_sdpa.rs with
        `max_distance = local_attention / 2`.
        """
        half = self.config.local_attention // 2
        idx = torch.arange(seq_len, device=device)
        diff = (idx.unsqueeze(0) - idx.unsqueeze(1)).abs()      # (S, S)
        mask = torch.where(diff > half, torch.full_like(diff, -1, dtype=dtype) * 1e4, torch.zeros_like(diff, dtype=dtype))
        return mask

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        xs = self.embeddings(input_ids)
        dtype = xs.dtype
        seq_len = xs.shape[1]

        global_mask = self._prepare_global_mask(attention_mask, dtype)
        local_mask = self._local_mask(seq_len, dtype, xs.device)
        combined_mask = global_mask + local_mask         # broadcasts (B,1,S,S) + (S,S)

        g_cos, g_sin = self.global_rope_cos.to(dtype), self.global_rope_sin.to(dtype)
        l_cos, l_sin = self.local_rope_cos.to(dtype), self.local_rope_sin.to(dtype)

        for layer in self.layers:
            xs = layer(xs, global_mask, combined_mask, g_cos, g_sin, l_cos, l_sin)

        return self.final_norm(xs)


class ModernBertEmbeddings(nn.Module):
    """Word embeddings + post-embedding LayerNorm.

    Matches the LateOn-Code safetensors layout with key prefix
    `embeddings.tok_embeddings.*` and `embeddings.norm.*`.
    """

    def __init__(self, config: ModernBertConfig):
        super().__init__()
        self.tok_embeddings = nn.Embedding(config.vocab_size, config.hidden_size)
        self.norm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps, bias=False)

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        return self.norm(self.tok_embeddings(input_ids))


# ──────────────────────────────────────────────────────────────────────
#  Late-interaction wrapper — projection + per-token L2 normalise
# ──────────────────────────────────────────────────────────────────────

class ModernBertLI(nn.Module):
    """Full LI forward: ModernBERT backbone → 768→128 projection → L2 normalise per token.

    Mirrors li_model.rs's compute() forward pass exactly. The projection
    weight is loaded separately from the 1_Dense/model.safetensors file
    with key `linear.weight` (shape [128, 768]). Applied via matmul with
    the transpose (standard linear layer semantics).

    The L2 normalise uses epsilon-before-sqrt to prevent 0/0 NaN on
    fully-padded token positions — same pattern as li_model.rs and as
    the NomicBERT l2_normalize fix in nomic_bert_sdpa.rs.
    """

    def __init__(self, config: ModernBertConfig, token_dim: int = 128):
        super().__init__()
        self.backbone = ModernBert(config)
        # Projection: [token_dim, hidden_size] → nn.Linear is
        # Linear(hidden_size, token_dim, bias=False) which stores
        # weight as (token_dim, hidden_size) — matches safetensors layout.
        self.projection = nn.Linear(config.hidden_size, token_dim, bias=False)
        self.token_dim = token_dim

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        hidden = self.backbone(input_ids, attention_mask)                    # (B, S, 768)
        projected = self.projection(hidden)                                   # (B, S, 128)
        # L2 normalise per token with epsilon-before-sqrt (matches li_model.rs).
        squared = projected * projected
        norm = (squared.sum(dim=-1, keepdim=True) + 1e-12).sqrt()
        return projected / norm


# ──────────────────────────────────────────────────────────────────────
#  Weight loader
# ──────────────────────────────────────────────────────────────────────

def load_modernbert_li(
    backbone_safetensors: str,
    projection_safetensors: str,
    config_json: str,
    device: str = "cpu",
) -> ModernBertLI:
    """Load a ModernBertLI from LateOn-Code safetensors.

    Remaps keys from the backbone safetensors to the PyTorch module tree:
      embeddings.tok_embeddings.weight  → backbone.embeddings.tok_embeddings.weight
      embeddings.norm.weight            → backbone.embeddings.norm.weight
      final_norm.weight                 → backbone.final_norm.weight
      layers.N.attn.Wqkv.weight         → backbone.layers.N.attn.Wqkv.weight
      layers.N.attn.Wo.weight           → backbone.layers.N.attn.Wo.weight
      layers.N.attn_norm.weight         → backbone.layers.N.attn_norm.weight  (optional, only N>0)
      layers.N.mlp.Wi.weight            → backbone.layers.N.mlp.Wi.weight
      layers.N.mlp.Wo.weight            → backbone.layers.N.mlp.Wo.weight
      layers.N.mlp_norm.weight          → backbone.layers.N.mlp_norm.weight
    Then the projection weight from the separate 1_Dense safetensors:
      linear.weight                     → projection.weight
    """
    config = ModernBertConfig.from_json(config_json)
    model = ModernBertLI(config)

    backbone_state = load_file(backbone_safetensors)
    projection_state = load_file(projection_safetensors)

    remapped: dict[str, torch.Tensor] = {}
    for k, v in backbone_state.items():
        remapped[f"backbone.{k}"] = v

    if "linear.weight" not in projection_state:
        raise RuntimeError(
            f"projection safetensors missing 'linear.weight'; got keys: {list(projection_state.keys())}"
        )
    remapped["projection.weight"] = projection_state["linear.weight"]

    missing, unexpected = model.load_state_dict(remapped, strict=True)
    if missing or unexpected:
        raise RuntimeError(f"state_dict mismatch — missing={missing}, unexpected={unexpected}")
    model.eval()
    model.to(device)
    return model
