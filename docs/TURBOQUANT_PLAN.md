# TurboQuant-Inspired Late Interaction Compression Plan

> **Goal**: Minimize memory footprint, disk size, load time, and MaxSim
> scoring latency of the late interaction index so Sweet Search runs well
> on developer laptops with 8-16 GB RAM, while preserving retrieval
> quality (NDCG@10 regression < 0.5 pp).

**Status**: Research complete, ready for Phase 0 implementation.

### Performance Impact Summary

| Component | Speed Improvement | Why |
|-----------|-------------------|-----|
| **MaxSim scoring** | ~30-40% faster | Pre-stored norms eliminate redundant d_norm_sq (currently computed Q*D times instead of D times), 4-bit centroid LUT replaces dequant FMA chain, no per-thread Vec allocation, 2x smaller napi buffer copies |
| **Index load** | ~5-10x faster | Binary format replaces JSON parse of 1.34 GiB, direct typed-array read vs `Array.from()` + `new Int8Array()` |
| **Embedding model inference** | No change | TurboQuant compresses stored vectors, not the model itself. ONNX forward pass is unchanged. |
| **Weak-machine experience** | Dramatically better | 1.34 GiB → ~210 MiB reduces memory pressure, eliminates swapping on 8 GB laptops |

### Native Binary Strategy

All new kernels (4-bit dequant, WHT-rotated scoring) ship as:
1. **Native N-API addon** per platform (`@sweet-search/native-{platform}-{arch}`) — Rayon parallel + NEON/AVX2 SIMD
2. **WASM SIMD fallback** (universal, `core/maxsim.wasm`) — single-threaded f32x4
3. **Pure JS fallback** — always available

This follows the existing 3-tier architecture from INIT_PLAN.md and matches how `native-maxsim/` is already built and shipped.

---

## Background

[TurboQuant](https://arxiv.org/abs/2504.19874) (ICLR 2026) is a
data-oblivious vector quantization algorithm from Google that compresses
vectors to 3-4 bits with near-zero quality loss. Its core insight:
**random orthogonal rotation (Walsh-Hadamard) equalizes coordinate
variance, making aggressive scalar quantization safe.**

A multi-agent research swarm (6 specialists: quantization math, WASM
engineering, IR quality, performance, devil's advocate, architecture)
analyzed TurboQuant's applicability to Sweet Search's late interaction
pipeline. This plan synthesizes those findings with additional review
from Codex.

### Why Not Full TurboQuant?

Full TurboQuant (PolarQuant + QJL) is **not** the right first move:

| Concern | Detail |
|---------|--------|
| **Wrong validation domain** | Validated on LLM KV caches (unnormalized), not L2-normalized retrieval embeddings. Distributional assumptions may differ. |
| **d=48 disqualified** | The edge model (`lateon-code-edge`, d=48) is outside the high-dimensional concentration regime. Full TurboQuant cannot be a universal solution across both model tiers. |
| **QJL complexity for marginal gain** | With asymmetric scoring (float32 query x quantized doc), QJL's bias correction is less critical. Adds 16 bytes/token overhead + random projection matrix management. |
| **3-bit packing is SIMD-hostile** | No native 3-bit extract in NEON or WASM SIMD. turbo3 decoding is ~1.5x slower than INT8; turbo4 (nibble) is at parity. |
| **No JS/WASM implementation exists** | Multi-week effort with high rejection risk (the fused WASM dequant was already rejected for simpler INT8 widening — see `docs/MAXSIM_OPTIMIZATION.md`). |
| **Bigger wins available first** | JSON storage overhead and token count are higher-leverage targets. |

### What We Take From TurboQuant

The **rotation insight** is real and proven in production (Weaviate's
[8-bit Rotational Quantization](https://weaviate.io/blog/8-bit-rotational-quantization)):
random rotation equalizes dimension variance so that scalar quantization
captures more information per bit. We already ship the infrastructure
(`walshHadamardTransform`, `fastRotate`, `generateSignVector` in
`core/embedding-service.js:392-451`).

---

## Current State

**Index artifact**: `codebase-late-interaction.json` (streamed JSON)

**Quantization**: Global per-document min/scale INT8
(`core/late-interaction-index.js:21-48`). Single `min` and `scale` across
ALL tokens of a document — outlier dimensions waste quantization bins for
every other dimension.

**On-disk format**: JSON arrays via `Array.from(doc.tokens)` (line 582).
Int8 byte values are serialized as decimal ASCII integers with commas and
brackets. Measured overhead: **~3.4x** bloat vs raw payload.

**Measured on a real index** (Codex-verified):
- 17,034 documents, 3,141,806 tokens (184.4 avg tokens/doc)
- Raw INT8 payload: **383.5 MiB** (3.14M tokens x 128 bytes)
- On-disk JSON file: **1.343 GiB** (3.4x overhead from JSON encoding)

**Scoring kernels** (3-tier, `core/simd-distance.js`):
- Tier 1: Native Rust + Rayon (`native-maxsim/src/lib.rs`) — 47x JS
- Tier 2: WASM SIMD (`wasm-maxsim/src/lib.rs`) — 16x JS
- Tier 3: Pure JS fallback

**Models**:
- `lateon-code`: 149M params, d=128 (2^7, WHT-friendly)
- `lateon-code-edge`: 17M params, d=48 (NOT power-of-2, needs padding to 64)

---

## Phased Plan

### Phase 0: Binary LI Storage Format

**What**: Replace JSON serialization with a packed binary format.

**Why**: The single highest-leverage change. Zero quality risk, zero
kernel changes, ~3.4x disk reduction and faster load times. On an 8 GB
laptop, going from 1.34 GB to ~400 MB on disk (and in I/O buffer during
load) is the difference between usable and not.

**Format** (`codebase-late-interaction.bin`):
```
HEADER (fixed 64 bytes):
  [0..3]    magic: "SSLX" (Sweet Search Late indeX)
  [4..5]    version: u16 = 3
  [6..6]    quantBits: u8 (8 = int8, 4 = future)
  [7..7]    tokenDim: u8 (128 or 48)
  [8..11]   numDocuments: u32
  [12..15]  poolFactor: u8, reserved[3]
  [16..47]  modelId: 32 bytes utf8 (zero-padded)
  [48..51]  whtSeed: u32 (0 = no rotation, >0 = WHT rotation applied)
  [52..63]  reserved (zero)

DOCUMENT TABLE (numDocuments x 20 bytes):
  Per entry:
    [0..3]   tokenDataOffset: u32 (byte offset into token slab)
    [4..5]   numTokens: u16
    [6..9]   min: f32
    [10..13] scale: f32
    [14..19] reserved

ID TABLE:
  [0..3]   totalIdBytes: u32
  Per document:
    [0..1]   idLen: u16
    [2..N]   id: utf8 bytes

TOKEN SLAB (contiguous):
  Per document (in order):
    numTokens * tokenDim bytes (int8)
    numTokens * 4 bytes (tokenNorms as f32)

FOOTER:
  [0..3]  checksum: CRC32 of everything above
```

**Estimated sizes** (17K docs, 3.14M tokens, d=128):

| Component | Size |
|-----------|------|
| Header | 64 B |
| Doc table | 17K x 20 = 340 KB |
| ID table | ~500 KB (avg 30-byte IDs) |
| Token slab (int8) | 3.14M x 128 = 383.5 MiB |
| Token norms | 3.14M x 4 = 12.0 MiB |
| **Total** | **~396 MiB** (vs 1.343 GiB JSON = **3.4x smaller**) |

**Backward compatibility**: `load()` checks magic bytes. If first bytes
are `{` (JSON), use legacy path. If `SSLX`, use binary path. `save()`
always writes binary v3. No migration tool needed — re-indexing produces
the new format; old JSON indexes still load.

**Changes**:
- `late-interaction-index.js`: New `_saveBinary()` / `_loadBinary()` methods
- `config.js`: No changes needed

**Go/no-go**: Load time < 2s for 17K docs. File size within 5% of theoretical minimum.

---

### Phase 1: Per-Token Quantization

**What**: Change INT8 quantization from per-document min/scale to
per-token min/scale.

**Why**: The current scheme (`quantizeToInt8` at line 21) uses a single
`min` and `scale` across the **entire flattened token buffer** of a
document. If one token has an outlier dimension at -0.4 and another has
all values in [-0.1, 0.1], the latter uses only ~25% of the INT8 range.
Per-token quantization eliminates this waste.

**Storage cost**: Two extra f32 values per token (8 bytes). At 128d,
token size goes from 128 to 136 bytes (+6.25%). But quantization error
drops significantly — each token uses the full INT8 range.

**Quality impact**: Strictly positive. Better quantization fidelity at
the same bit-width. No kernel changes needed since min/scale are already
per-document metadata passed to dequant.

**Changes**:
- `quantizeToInt8()`: Accept mode flag for per-token vs per-document
- `add()`: Quantize per-token, store per-token min/scale arrays
- Binary format: Extend token slab with per-token min/scale (or pack
  into doc table extension)
- WASM/Rust kernels: Already receive per-element min/scale — just need
  to index by token instead of using a single value

**Go/no-go**: MaxSim score correlation (Kendall tau) >= 0.998 vs float32
ground truth on eval corpus.

---

### Phase 2: WHT Rotation + INT8 ("Poor Man's TurboQuant")

**What**: Apply Walsh-Hadamard rotation before INT8 quantization.

**Why**: After WHT rotation, coordinate values become near-Gaussian with
equalized variance. This makes per-coordinate scalar quantization
near-optimal. Weaviate reports 99.4% recall with this approach.
Combined with per-token quantization from Phase 1, this squeezes maximum
quality from 8 bits.

**The key mathematical insight**:
```
<q, Pi^T * y> = <Pi*q, y>    (Pi orthogonal)
```
Rotate query tokens once at query time (cost: ~0.1ms for 32 tokens at
128d). Score in the rotated domain. No inverse rotation ever needed.
**Zero changes to the scoring kernels** — they're agnostic to whether
vectors are in original or rotated space.

**Implementation** (~40 lines of changes):

At **index time** (in `add()`):
```js
import { fastRotate, generateSignVector } from './embedding-service.js';

// Generate deterministic sign vector on first add
if (!this.signVector) {
  this.signVector = generateSignVector(this.tokenDim, this.whtSeed);
}
// Rotate each token before quantization
for (let t = 0; t < truncated.length; t++) {
  truncated[t] = fastRotate(truncated[t], this.signVector);
}
// Then quantize as before (per-token from Phase 1)
```

At **query time** (in `scoreWithLateInteraction()`):
```js
// Rotate query tokens once (amortized across all candidates)
const rotatedQuery = queryTokens.map(q =>
  fastRotate(new Float32Array(q), this.signVector)
);
// Score with existing MaxSim kernels — no changes needed
```

**d=48 handling**: Pad to 64 (next power-of-2) for WHT, truncate result
back to 48. `fastRotate()` already handles this (line 439-450).

**Binary format**: Store `whtSeed` in header (already reserved at
offset 48-51). If `whtSeed > 0`, query-time rotation is required.

**Go/no-go**: Kendall tau >= 0.995 on eval corpus. Latency overhead
< 0.5ms per query.

---

### Phase 3: Token Count Reduction

**What**: Reduce average tokens per document from 184 to ~92 via pooling
or learned pruning.

**Why**: Token count is a **multiplicative** lever — halving tokens
halves storage regardless of bit-width. The infrastructure already
exists: `poolTokens()` in `late-interaction-model.js:320` and
`poolFactor` config. ColBERTv2's headline was 6-10x reduction from token
compression, not from sub-byte coding.

**Options** (evaluated independently):
1. **poolFactor=2**: Average consecutive token pairs. Already
   implemented. Instant 2x token reduction. Quality impact: ~1-2pp
   MRR regression (based on ColBERT pooling literature).
2. **Norm-based pruning**: Drop tokens with L2 norm below threshold.
   `tokenNorms` already stored. Low-norm tokens carry little signal.
3. **Attention-score pruning**: Keep only tokens that the model's
   attention mechanism deemed important (requires model modification).

**Concrete impact** (Phase 0+1+3 combined):

| Configuration | Bytes/token | Tokens (17K docs) | Total |
|---|---|---|---|
| Current JSON INT8 | ~440 on disk | 3.14M | 1.34 GiB |
| Phase 0 (binary) | 132 | 3.14M | 396 MiB |
| Phase 0+1 (per-token quant) | 140 | 3.14M | 419 MiB |
| Phase 0+1+3 pool=2 | 140 | 1.57M | 210 MiB |

**Go/no-go**: MRR@10 regression < 2pp on GenCodeSearchNet. User-visible
latency improvement from fewer MaxSim comparisons.

---

### Phase 4: WHT + 4-bit Quantization + Native Kernel Rewrite

**What**: Drop from 8-bit to 4-bit per coordinate in the WHT-rotated
domain, and simultaneously rewrite the MaxSim kernel for speed (both
native and WASM).

**Why**: After rotation, coordinate values are near-Gaussian with
well-characterized variance. 4-bit (16 levels) captures sufficient
information for near-float quality. Combined with per-token
quantization, this gives **2x compression vs INT8**. The kernel rewrite
eliminates redundant norm computation and per-thread allocations.

**Storage format**: Packed nibbles (2 values per byte). 128d = 64
bytes/token. Plus 4 bytes min + 4 bytes scale per token = 72 bytes/token
(vs 140 for Phase 1 INT8).

#### MaxSim Kernel Optimizations (applies to all bit-widths)

**Current redundant work in `native-maxsim/src/lib.rs`:**
```rust
// d_norm_sq recomputed for every (qi, di) pair — Q*D times
// when it only needs D times. With Q=32, D=100: 3200 vs 100.
for qi in 0..num_q {
    for di in 0..num_d {
        let mut d_norm_sq: f32 = 0.0;  // redundant!
        for i in 0..dim { d_norm_sq += d_slice[i] * d_slice[i]; }
    }
}
```

**Fix**: Accept pre-stored `tokenNorms` from the binary format (Phase 0
already stores them). Eliminates ~40% of inner-loop FLOPs.

**Current per-thread allocation:**
```rust
// Line 141: allocates Vec<f32> per candidate per Rayon thread
let mut doc_f32 = Vec::with_capacity(*num_d * *d);
dequantize(int8_data, *min, *scale, &mut doc_f32);
```

**Fix with 4-bit**: Centroid LUT scoring works directly on packed data.
No dequantization buffer needed. Replace per-thread `Vec<f32>` with
in-place centroid lookup during the dot-product loop.

**Current napi bridge overhead:**
```rust
// Line 131: copies entire Int8Array from JS heap per candidate
let int8: Vec<i8> = c.tokens.iter().map(|&b| b as i8).collect();
```

**Fix with 4-bit**: 2x smaller copy (64 bytes/token vs 128). Consider
zero-copy via shared ArrayBuffer for the token slab.

#### Native N-API Kernel (`native-maxsim/src/lib.rs`)

New entry point: `maxsim_score_batch_4bit()` with:

- **Pre-stored norms**: `tokenNorms: Float32Array` passed from JS
  alongside token data. Eliminates d_norm_sq from inner loop.
- **Centroid LUT scoring**: 16-entry f32 table in registers.
  On NEON: `TBL` with 4-register 64-byte table — one instruction
  per 16 centroid lookups.
  On x86-64: `_mm256_i32gather_ps` for 8-wide AVX2 gather.
- **No dequant allocation**: Score directly from packed nibbles.
- **Rayon parallelism**: Unchanged (parallel across candidates).

Estimated speedup over current native INT8 kernel: **~30-40%** from
combined norm reuse + eliminated alloc + smaller copies.

Ships as `@sweet-search/native-darwin-arm64`, `@sweet-search/native-darwin-x64`,
`@sweet-search/native-linux-x64`, `@sweet-search/native-linux-arm64`
(same platform packages from INIT_PLAN.md).

#### WASM SIMD Kernel (`wasm-maxsim/src/lib.rs`)

New entry point: `maxsim_dequant_4bit()` with:

- Nibble extract: `v128.and(v, 0x0F)` + `i8x16.shr_u(v, 4)` — 2 ops per 32 values
- Centroid lookup: `i8x16.swizzle` with 16-entry LUT — 1 instruction per 16 values
- Pre-stored norms via pointer parameter (no d_norm_sq accumulation)
- Compiled with `RUSTFLAGS="-C target-feature=+simd128"`

#### JS Fallback (`core/simd-distance.js`)

Pure JS `maxsimDequant4bit()` with manual nibble unpacking + LUT array
indexing. Slower but always available.

#### Performance Projections (M3 Max, 50 candidates, Q=32, D=100, d=128)

| Metric | Current INT8 | Phase 4 (WHT+4bit+norms) | Improvement |
|--------|-------------|--------------------------|-------------|
| MaxSim latency (native) | 5.9ms | ~3.5-4.0ms (est.) | **30-40%** |
| MaxSim latency (WASM) | ~30ms (est.) | ~20ms (est.) | ~33% |
| Bytes/token | 128 | 64+8 (norms) = 72 | 1.8x smaller |
| Token slab (3.14M tokens) | 383.5 MiB | 215 MiB | 1.8x smaller |
| Total index (binary fmt) | ~396 MiB | ~230 MiB | 1.7x smaller |
| napi buffer copy | 128 B/token | 72 B/token | 1.8x less |

**Quality analysis** (from research swarm IR specialist):

Inner product variance at 4-bit, d=128: `sigma_cosine ~ 0.012`

Rank inversion probability:

| Score gap | P(inversion) |
|-----------|-------------|
| 0.01 | 5.2% |
| 0.02 | 0.19% |
| 0.03 | ~0% |

Expected NDCG@10 loss: **< 0.2%**. Safe for production.

**Required changes**:
- `late-interaction-index.js`: New `quantizeToInt4()` / `dequantizeFromInt4()` functions
- `native-maxsim/src/lib.rs`: New `maxsim_score_batch_4bit()` with norm params, centroid LUT, zero-alloc scoring
- `wasm-maxsim/src/lib.rs`: New `maxsim_dequant_4bit()` with SIMD nibble extract + swizzle
- `simd-distance.js`: Tier detection for 4-bit kernel availability, new JS fallback
- `config.js`: `LATE_INTERACTION_CONFIG.quantization` = `'wht-int4'`
- Binary format: `quantBits` header field = 4
- `native-maxsim/Cargo.toml`: Keep existing INT8 entry points for backward compat

**Go/no-go**: NDCG@10 regression < 0.5pp. MaxSim score Kendall tau
>= 0.990 vs float32.

---

### Phase 5 (Future): Full TurboQuant

**When**: Only if Phase 4 quality is insufficient or we need > 2x
compression beyond 4-bit.

**What**: PolarQuant (optimal per-coordinate scalar quantization using
Lloyd-Max codebooks) + optional QJL (1-bit residual correction for
unbiased inner products).

**Why we might need it**: At 3.25 bits (turbo3), storage drops to ~52
bytes/token vs 72 for WHT+INT4. For million-doc indexes, this saves
another ~60 MiB.

**Why we might not**: The gap between WHT+INT4 and full TurboQuant
turbo3 is only ~36 MiB on a 3.14M-token corpus. Token count reduction
(Phase 3) is a bigger lever.

**Prerequisites**:
- Empirical validation that LateOn-Code embeddings (L2-normalized) match
  TurboQuant's distributional assumptions at d=128
- Reference implementation available (expected Q2 2026)
- 3-bit packing SIMD kernel proven viable on WASM

**Open questions on QJL**: Google explicitly describes QJL as balancing
high-precision queries with low-precision data (asymmetric scoring).
This is exactly our use case. The swarm dismissed QJL too quickly — it
deserves empirical evaluation in Phase 5, not upfront dismissal.

---

## Projected Impact (All Phases Combined)

**Scenario**: 17K docs, 3.14M tokens, d=128, on an 8 GB laptop

| Phase | Index Size | vs Current | Cumulative |
|-------|-----------|------------|------------|
| Current (JSON INT8) | 1.34 GiB | baseline | — |
| Phase 0 (binary format) | 396 MiB | **3.4x smaller** | 3.4x |
| Phase 1 (per-token quant) | 419 MiB | ~1x (quality improvement, slight size increase) | 3.2x |
| Phase 2 (WHT rotation) | 419 MiB | 1x (quality improvement, no size change) | 3.2x |
| Phase 3 (poolFactor=2) | 210 MiB | 2x | 6.4x |
| Phase 4 (WHT + 4-bit) | 118 MiB | 1.8x | **11.4x** |
| Phase 5 (full TurboQuant) | ~95 MiB | 1.2x | **14.1x** |

**Extrapolated to 100K docs** (~18.4M tokens at 184 avg/doc):

| Configuration | Size | Fits in 8 GB? |
|---|---|---|
| Current JSON INT8 | ~7.9 GiB | No |
| Phase 0 only | ~2.3 GiB | Barely |
| Phase 0+3 (pool=2) | ~1.2 GiB | Yes |
| Phase 0+1+2+3+4 | ~0.7 GiB | Comfortably |

---

## Validation Strategy

### Score Correlation Test

New script: `eval/scripts/maxsim-quant-correlation.js`

For each phase, measure:
1. **Kendall tau** rank correlation of MaxSim scores vs float32 ground truth
2. **Spearman rho** on the same
3. **MRR@10 / NDCG@10** on GenCodeSearchNet eval set
4. **P(rank inversion)** for score gaps in [0.01, 0.02, 0.03, 0.05, 0.08]

### Go/No-Go Gates

| Phase | Gate | Threshold |
|-------|------|-----------|
| 0 | Load time | < 2s for 17K docs |
| 0 | File size | Within 5% of theoretical min |
| 1 | Kendall tau vs float32 | >= 0.998 |
| 2 | Kendall tau vs float32 | >= 0.995 |
| 2 | Latency overhead | < 0.5ms per query |
| 3 | MRR@10 regression | < 2pp |
| 4 | NDCG@10 regression | < 0.5pp |
| 4 | Kendall tau vs float32 | >= 0.990 |

### A/B Framework

The eval harness (`eval/retrieval-harness.js`) supports the `--li-quant`
flag to select quantization scheme. Run identical benchmarks across
configurations and compare metrics side-by-side.

---

## Implementation Priority

```
Phase 0 (binary storage)     ██████████ Highest ROI, zero quality risk
Phase 1 (per-token quant)    ████████   Free quality win, small effort
Phase 3 (token pooling)      ███████    Multiplicative compression lever
Phase 2 (WHT rotation)       ██████     Prepares for Phase 4, zero kernel changes
Phase 4 (4-bit quantization) █████      Requires new WASM/Rust kernels
Phase 5 (full TurboQuant)    ██         Only if Phase 4 insufficient
```

The Pareto-optimal order is: **binary storage first, token count second,
rotation third, bit reduction last.** This matches the expert consensus:
systems people say fix the serialization format; retrieval people say
reduce token count; vector DB people say rotation + simple scalar
quantization is proven; hardware people say 4-bit is the sane target.

---

## Key References

- [TurboQuant Paper (arXiv 2504.19874)](https://arxiv.org/abs/2504.19874)
- [Google Research Blog](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
- [Weaviate 8-bit Rotational Quantization](https://weaviate.io/blog/8-bit-rotational-quantization)
- [QuIP# Hadamard Incoherence (arXiv 2402.04396)](https://arxiv.org/abs/2402.04396)
- [PolarQuant KV Cache (arXiv 2502.02617)](https://arxiv.org/html/2502.02617v1)
- [ColBERTv2 (arXiv 2112.01488)](https://arxiv.org/abs/2112.01488)
- [WARP Multi-Vector Execution (arXiv 2501.17788)](https://arxiv.org/abs/2501.17788)
- [TheTom/turboquant_plus (Metal implementation)](https://github.com/TheTom/turboquant_plus)
- [llama.cpp TurboQuant Discussion #20969](https://github.com/ggml-org/llama.cpp/discussions/20969)
- [OpenSearch Random Rotation Benefits](https://opensearch.org/blog/the-benefits-of-random-rotation-in-quantized-vector-search/)

### Working Implementations (as of March 2026)

| Implementation | Language | Status | Notes |
|---|---|---|---|
| TheTom/turboquant_plus | Python + Metal | 141 tests, turbo3/turbo4 | 8-13x speed regression on WHT |
| llama.cpp C (veritatisquaesitoressumus) | C | 18/18 tests passing | Lloyd-Max codebooks for d=128 |
| mudler/llama.cpp feat/turbo-quant | C++ | Builds, evaluating | Experimental branch |
| MLX experiments | Python | 5x compression, 99.5% quality | Community reports |
| Google official | — | Not released | Expected Q2 2026 |
