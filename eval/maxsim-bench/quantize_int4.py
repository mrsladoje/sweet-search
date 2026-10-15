# Python copy of the production int4 per-token quantizer.
# Mirrors: core/ranking/late-interaction-index.js:quantizeToInt4PerToken
# Also gives the stored token norm as LateInteractionIndex.add() computes it
# (float64 sum of squares, in dimension order, sqrt, stored as float32).
import numpy as np


def quantize_int4_per_token(x):
    """x: float32 (nt, dim). Returns (raw uint8 (nt, ceil(dim/2)), mn f32, sc f32, nr f32).
    Low nibble = even index, high nibble = odd index. All arithmetic in float64."""
    x = np.ascontiguousarray(x, dtype=np.float32)
    nt, dim = x.shape
    x64 = x.astype(np.float64)
    packed = (dim + 1) // 2
    mn64 = x64.min(axis=1)
    mx64 = x64.max(axis=1)
    const = mx64 == mn64
    sc64 = np.where(const, 0.0, (mx64 - mn64) / 15.0)
    safe = np.where(const, 1.0, sc64)
    q = np.floor((x64 - mn64[:, None]) / safe[:, None] + 0.5)  # JS Math.round
    q = np.clip(q, 0, 15)
    q[const] = 0
    q = q.astype(np.uint8)
    if dim % 2:
        q = np.concatenate([q, np.zeros((nt, 1), np.uint8)], axis=1)
    raw = (q[:, 0::2] | (q[:, 1::2] << 4)).astype(np.uint8)
    assert raw.shape == (nt, packed)
    # norm: sequential float64 accumulation, like the JS loop
    acc = np.zeros(nt, np.float64)
    for d in range(dim):
        acc += x64[:, d] * x64[:, d]
    nr = np.sqrt(acc).astype(np.float32)
    return raw, mn64.astype(np.float32), sc64.astype(np.float32), nr
