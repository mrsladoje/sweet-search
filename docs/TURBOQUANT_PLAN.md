# TurboQuant-Inspired Late Interaction Compression Plan

> **Goal**: Minimize memory footprint, disk size, load time, and MaxSim
> scoring latency of the late interaction index so Sweet Search runs well
> on developer laptops with 8-16 GB RAM, while preserving retrieval
> quality (NDCG@10 regression < 0.5 pp).

**Status**: Research complete, ready for Phase 0 implementation.
**Related**: `INFERENCE_SPEEDUP_PLAN.md` covers ONNX forward-pass speedups (worker threads, warmup, session config) for both the embedding and LI models. That plan speeds up inference; this plan speeds up storage, loading, and MaxSim scoring. Gains are multiplicative.

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

This follows the existing 3-tier architecture from INIT_PLAN.md and matches how `crates/sweet-search-native/` is already built and shipped.

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
- Tier 1: Native Rust + Rayon (`crates/sweet-search-native/src/lib.rs`) — 47x JS
- Tier 2: WASM SIMD (`crates/wasm-maxsim/src/lib.rs`) — 16x JS
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

**Current redundant work in `crates/sweet-search-native/src/lib.rs`:**
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

#### Native N-API Kernel (`crates/sweet-search-native/src/lib.rs`)

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

#### WASM SIMD Kernel (`crates/wasm-maxsim/src/lib.rs`)

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
- `crates/sweet-search-native/src/lib.rs`: New `maxsim_score_batch_4bit()` with norm params, centroid LUT, zero-alloc scoring
- `crates/wasm-maxsim/src/lib.rs`: New `maxsim_dequant_4bit()` with SIMD nibble extract + swizzle
- `simd-distance.js`: Tier detection for 4-bit kernel availability, new JS fallback
- `config.js`: `LATE_INTERACTION_CONFIG.quantization` = `'wht-int4'`
- Binary format: `quantBits` header field = 4
- `crates/sweet-search-native/Cargo.toml`: Keep existing INT8 entry points for backward compat

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

## Community Research Addendum (March 2026)

> **Added after deep research sweep across 30+ papers, community
> implementations, and production deployments (Oct 2025 – Mar 2026).**
> These are optimizations discovered *beyond* the original TurboQuant
> paper that are relevant to our pipeline.
>
> **CRITICAL RULE: Every optimization below MUST be A/B tested against
> the previous baseline before being accepted.** No optimization ships
> without empirical proof that it helps *our* specific pipeline
> (LateOn-Code, d=128, code retrieval). Academic gains do not guarantee
> gains on our data. The eval harness (`eval/retrieval-harness.js`) is
> the single source of truth. Each item below includes its specific A/B
> test protocol.

---

### CRA-1: Hierarchical Token Pooling (Upgrades Phase 3)

**What**: Replace our three Phase 3 options (consecutive-pair pooling,
norm-based pruning, attention-score pruning) with **hierarchical token
pooling** as the primary strategy.

**Why**: LIR'26 Workshop (Johns Hopkins, [arXiv 2603.22434](https://arxiv.org/abs/2603.22434),
March 2026) conclusively proved that **token pooling is strictly superior
to token pruning** for multi-vector retrieval. The gap is large:

| Method | Keep ratio | Rel. nDCG@10 | Rel. Recall@100 |
|--------|-----------|-------------|-----------------|
| **Hierarchical Pooling** | 20% (5x) | **95.7%** | **98.1%** |
| IDF Pruning | 50% (2x) | 92.4% | 98.9% |
| Attention Pruning | 20% | ~75% | ~80% |

Pooling achieves **2.5x better compression than pruning at equal quality**.
At extreme compression (10-20% keep), pruning catastrophically fails
while pooling degrades gracefully.

Two pooling variants worth testing:
1. **Hierarchical pooling** (Ward clustering + cosine distance) — best
   overall quality, O(L² · d + L² log L) per document
2. **Attention-based pooling** — nearly as good, much cheaper O(L·L̃·d),
   better for online indexing scenarios

Our existing `poolTokens()` averages consecutive pairs — this is the
*worst* pooling strategy (no semantic awareness). It should be replaced
with similarity-based clustering.

**A/B test protocol**:
1. Index the eval corpus with each strategy at keep ratios [0.20, 0.33, 0.50, 0.75]
2. Measure: nDCG@10, MRR@10, Recall@100, index time, index size
3. Compare: hierarchical pooling vs attention pooling vs current consecutive-pair pooling vs no pooling baseline
4. **Ship only if**: nDCG@10 regression < 2pp at 2x+ token reduction
5. **Reject if**: Index-time cost > 3x increase with no quality gain over attention pooling

---

### CRA-2: Quantile-Based (Non-Uniform) Bucket Boundaries (Upgrades Phase 4)

**What**: Replace uniform INT4 quantization boundaries with
**quantile-based bucket boundaries** that allocate more quantization
levels to densely populated data regions.

**Why**: WARP ([arXiv 2501.17788](https://arxiv.org/abs/2501.17788),
ETH Zurich/Stanford, Jan 2025) uses quantile-based boundaries for their
4-bit residual quantization, contributing to their 7.3x memory reduction
and 3x speedup over PLAID. The insight: embedding coordinate values are
NOT uniformly distributed after rotation — they follow a near-Gaussian
distribution. Uniform quantization wastes levels in the sparse tails.
Quantile boundaries match level density to data density.

**Implementation**: During index build, collect a sample of coordinate
values post-rotation, compute 16 quantile boundaries (for 4-bit),
store the 16 boundary values in the binary header (16 × f32 = 64 bytes).
Quantization becomes: `bucket = bisect(boundaries, value)` instead of
`bucket = clamp(floor((value - min) / scale * 16), 0, 15)`.

**Cost**: Zero runtime cost — same 4-bit storage, same LUT scoring.
The only change is *which* 16 centroids the LUT contains.

**A/B test protocol**:
1. Build two indexes: uniform INT4 vs quantile INT4 (same WHT rotation seed)
2. Measure: Kendall tau vs float32, nDCG@10, MRR@10
3. **Ship if**: Any measurable quality improvement (even 0.1pp)
4. **Reject if**: Quality is identical or worse (quantile overhead wasted)

---

### CRA-3: WUSH Data-Aware Calibrated Rotation (Upgrades Phase 2)

**What**: Augment the Phase 2 Walsh-Hadamard rotation with a
**data-dependent scaling step** calibrated on actual embedding statistics,
following the WUSH transform.

**Why**: WUSH ([arXiv 2512.00956](https://arxiv.org/abs/2512.00956),
ETH Zurich/ISTA/Red Hat, Nov 2025) proved that a pure data-oblivious
Hadamard rotation is the *orthogonal component* of the optimal transform,
but the full optimal transform is:

```
T_wush = H × S^(-1/2) × U^T × W'^T
```

where S, U come from SVD of the data's second-moment matrix. This adds
a **non-orthogonal scaling** step that compensates for non-uniform
dimension variance in the actual embeddings. Reported gain: **+2.8
average accuracy points** over pure Hadamard at W4A4 quantization.

**Implementation** (~40 lines):
1. During index build, collect a sample of N=10K token embeddings
2. Compute covariance matrix C = (1/N) × X^T × X
3. SVD: C = U × S × V^T
4. Pre-multiply the Hadamard rotation: T = H × diag(S^(-1/2)) × U^T
5. Apply T instead of bare H at index time; apply T to queries at search time
6. Store the calibration matrix in the index file (128×128 × f32 = 64 KB)

**Caution**: This violates TurboQuant's "data-oblivious" property. If
our embeddings are already well-distributed post-WHT (which L2-normalized
embeddings tend to be), the gain may be negligible. The academic gain
was measured on LLM weight/activation quantization, NOT retrieval
embeddings. Must A/B test.

**A/B test protocol**:
1. Build three indexes: no rotation (baseline), pure WHT (Phase 2), WUSH-calibrated
2. Measure: Kendall tau vs float32, nDCG@10, MRR@10 at both 8-bit and 4-bit
3. **Ship if**: Kendall tau improvement >= 0.002 OR nDCG@10 improvement >= 0.3pp
4. **Reject if**: Gains < noise floor (~0.1pp), since WUSH adds calibration
   complexity and 64KB to the index

---

### CRA-4: Sequency-Ordered Walsh Matrices (Upgrades Phase 2)

**What**: Replace standard Hadamard ordering in `fastRotate()` with
**sequency-ordered Walsh matrices** (GSR).

**Why**: GSR ([arXiv 2505.03810](https://arxiv.org/abs/2505.03810),
Seoul National University, May 2025) showed that sequency ordering
clusters similar-frequency components together, reducing quantization
error compared to standard Hadamard. The block-diagonal variant (e.g.,
32×32 blocks) isolates outlier impact and matches optimization-based
*learned* rotations — without any training. Especially effective at
extreme low bit-widths (2-bit).

**Implementation**: Change the Hadamard matrix construction to use
Walsh (sequency) ordering instead of natural ordering. Same O(d log d)
transform, same butterfly structure, different permutation. Optionally
use block-diagonal structure (four 32×32 blocks for d=128).

**Cost**: Zero — identical computation, different matrix ordering.

**A/B test protocol**:
1. Build indexes with: natural Hadamard vs sequency Walsh vs block-diagonal Walsh (32×32)
2. Test at both 8-bit (Phase 1) and 4-bit (Phase 4)
3. Measure: Kendall tau vs float32, coordinate variance uniformity, nDCG@10
4. **Ship if**: Measurable quality improvement at either bit-width
5. **Reject if**: No difference (our d=128 already concentrates well enough)

---

### CRA-5: Implicit Decompression / Zero-Alloc Scoring (Upgrades Phase 4)

**What**: Score MaxSim **directly from packed nibbles without ever
materializing f32 vectors**, following WARP's implicit decompression
pattern.

**Why**: Our Phase 4 plan already eliminates the per-thread Vec<f32>
allocation via centroid LUT scoring, but the WARP paper's algebraic
decomposition goes further: the dot product between a float32 query
token and a quantized document token can be computed as:

```
dot(q, d_quantized) = dot(q, centroid) + Σ_i q[i] × bucket_weight[bucket[i]]
```

The centroid contribution is **pre-computed once** per (query_token,
cluster) pair and reused across all documents in that cluster. Only the
residual sum needs per-document computation. This eliminates even the
LUT gather-and-accumulate step for the centroid component.

**A/B test protocol**:
1. Implement both: (a) standard LUT scoring (Phase 4 plan), (b) implicit decompression
2. Measure: MaxSim latency (native + WASM), numerical equivalence to float32
3. **Ship if**: Latency improvement > 10% on the 50-candidate benchmark
4. **Reject if**: Complexity increase not justified by latency gain, or
   numerical divergence from standard path

---

### CRA-6: Learned Token Importance Weights for MaxSim (New — All Phases)

**What**: Add **per-token learned importance weights** to the MaxSim
scoring function, changing it from:

```
score(Q, D) = Σ_i max_j (q_i^T · d_j)
```

to:

```
score(Q, D) = Σ_i w_i × max_j (q_i^T · d_j)
```

**Why**: [arXiv 2511.16106](https://arxiv.org/abs/2511.16106) (Nov 2025)
showed that adding token importance weights (analogous to IDF in BM25)
improves late interaction retrieval quality. Two approaches:
1. **Zero-shot (IDF-based)**: Weight each document token by its inverse
   document frequency. No training needed.
2. **Few-shot (learned)**: Learn weights via contrastive loss on a small
   labeled set.

This is **orthogonal to compression** — it improves quality at any
quantization level. The weights cost only 4 bytes per token (stored
alongside tokenNorms in the binary format). The weights could also
**guide adaptive bit allocation**: important tokens get more bits.

**A/B test protocol**:
1. Implement IDF-based weighting (zero-shot, no training needed)
2. Measure: nDCG@10, MRR@10 on GenCodeSearchNet with and without weights
3. Test at multiple compression levels: uncompressed, INT8, INT4
4. **Ship if**: nDCG@10 improvement >= 0.5pp at any compression level
5. **Reject if**: No improvement on code retrieval (IDF may not help for
   code tokens the way it helps natural language)

---

### CRA-7: Metal Constant Memory for Centroid LUT (Upgrades Phase 4)

**What**: Place the 4-bit centroid LUT in **Metal constant memory** on
Apple Silicon, rather than shared or device memory.

**Why**: TheTom/turboquant_plus ([sparse-v-dequant.md](https://github.com/TheTom/turboquant_plus/blob/main/docs/papers/sparse-v-dequant.md))
discovered that constant memory has dedicated hardware caching on M-series
chips. The 16-entry f32 LUT for 4-bit quantization (64 bytes) fits
perfectly. This is a single annotation change in the Metal/Rust kernel.

**A/B test protocol**:
1. Benchmark native kernel on M3 Max with LUT in: shared memory vs constant memory
2. Measure: MaxSim latency over 1000 queries, 50 candidates each
3. **Ship if**: Measurable latency reduction (even 5%)
4. **Reject if**: No difference (M3 cache hierarchy may already optimize this)

---

### CRA-8: Matryoshka + Quantization Combo (Upgrades Phase 5)

**What**: If LateOn-Code supports (or can be fine-tuned to support)
**Matryoshka-style dimensional truncation**, combine dimension reduction
with 4-bit quantization for extreme compression.

**Why**: SMEC ([arXiv 2510.12474](https://arxiv.org/abs/2510.12474),
EMNLP 2025) showed Matryoshka embeddings allow flexible truncation where
prefixes retain semantic utility. Combined with quantization:

| Dimensions | Bits | Bytes/token | Compression vs d=128 INT8 |
|-----------|------|-------------|---------------------------|
| 128 | 8 | 128 | 1x (baseline) |
| 128 | 4 | 64 | 2x |
| 64 | 4 | 32 | **4x** |
| 32 | 4 | 16 | **8x** |

At d=64 + 4-bit + pool=2, the index shrinks to ~30 MiB for 17K docs —
**45x** smaller than current JSON INT8.

**Caution**: Requires model-level changes (Matryoshka fine-tuning of
LateOn-Code). This is a Phase 5+ direction, not a drop-in optimization.

**A/B test protocol**:
1. Fine-tune LateOn-Code with Matryoshka objective (if pursued)
2. Evaluate at d=[32, 64, 96, 128] × bits=[4, 8] on GenCodeSearchNet
3. Plot Pareto frontier of nDCG@10 vs bytes/token
4. **Ship if**: d=64 achieves nDCG@10 within 1pp of d=128
5. **Reject if**: Truncation below d=96 causes > 2pp regression on code retrieval

---

### CRA-9: Voronoi-Guided Token Importance (Upgrades Phase 3)

**What**: Use **Voronoi cell volume** in embedding space as the token
importance metric for pruning decisions.

**Why**: [arXiv 2603.09933](https://arxiv.org/abs/2603.09933) (Sorbonne,
March 2026) formalized token pruning as a Voronoi estimation problem.
Tokens with larger Voronoi regions are more "unique" and harder to
replace by neighboring tokens. Achieves **70% token removal with <1.5%
nDCG drop** on in-domain data.

**Use case**: Hybrid strategy — use Voronoi importance to identify tokens
that are safe to prune (tiny Voronoi cells = redundant tokens), then
pool the remaining tokens. This could outperform pure pooling.

**A/B test protocol**:
1. Implement Voronoi cell estimation for document token sets
2. Compare: Voronoi pruning vs norm pruning vs IDF pruning (all at same keep ratio)
3. Test hybrid: Voronoi prune bottom 30% → hierarchical pool remaining to target count
4. **Ship if**: Hybrid outperforms pure hierarchical pooling by >= 0.3pp nDCG@10
5. **Reject if**: Voronoi computation cost (O(L² · d) per doc) not justified by gain

---

### CRA-10: SAQ-Style Adaptive Bit Allocation per Dimension (Upgrades Phase 4)

**What**: After WHT rotation, allocate **non-uniform bits per dimension
segment** using dynamic programming optimization.

**Why**: SAQ ([arXiv 2509.12086](https://arxiv.org/abs/2509.12086),
Wuhan/CUHK/Huawei, Sep 2025) partitions PCA-projected vectors into
segments and allocates more bits to high-magnitude segments, fewer to
trailing segments. Uses DP to minimize total quantization error under a
fixed bit budget.

**Nuance**: After WHT rotation, dimensions *should* be near-uniform —
that's the whole point. So the gain may be minimal. But if any residual
non-uniformity remains (e.g., from the structure of code embeddings),
adaptive allocation captures it.

**A/B test protocol**:
1. After WHT rotation, measure per-dimension variance across 10K tokens
2. If variance ratio (max/min) > 1.5, implement DP bit allocation
3. Compare: uniform 4-bit vs adaptive (avg 4-bit, range 3-6 per segment)
4. **Ship if**: Kendall tau improvement >= 0.002
5. **Reject if**: Post-WHT dimensions are already uniform (ratio < 1.2), skip entirely

---

### CRA-11: ConstBERT Fixed-Count Embeddings (Future Direction)

**What**: Train the model to produce a **fixed number of document
embeddings** (e.g., 32 per document) via learned pooling projection.

**Why**: ConstBERT ([arXiv 2504.01818](https://arxiv.org/abs/2504.01818),
U Glasgow/Pinecone, Apr 2025) achieves >50% index size reduction with
comparable nDCG@10 on BEIR. The killer benefit: **uniform memory layout**
(every document has exactly C vectors), which eliminates variable-length
token slabs, simplifies the binary format, enables perfect SIMD
alignment, and dramatically improves OS paging and cache behavior.

**Caution**: Requires model architecture changes to LateOn-Code. This is
a future model generation decision, not a compression technique.

**A/B test protocol** (if pursued):
1. Train ConstBERT variant of LateOn-Code with C=[16, 32, 64]
2. Evaluate on GenCodeSearchNet: nDCG@10, MRR@10
3. Compare total system performance: index size + load time + query latency
4. **Ship if**: C=32 matches baseline nDCG@10 within 1pp
5. **Reject if**: Code retrieval quality degrades (code tokens may be more
   diverse than natural language, requiring more embeddings)

---

### CRA-12: Per-Vector Learned Quantizers / NVQ (Upgrades Phase 5)

**What**: Replace uniform scalar quantization with **per-vector learned
nonlinear quantizers** individually calibrated for each indexed vector.

**Why**: NVQ ([arXiv 2509.18471](https://arxiv.org/abs/2509.18471),
IBM, Sep 2025) achieves 3x storage reduction with <0.01 recall impact
above 0.95. Each vector gets its own quantization function (not just its
own min/scale as in Phase 1).

**Caution**: Encoding cost is very high (4,000µs per 1536-d vector for
Extended RaBitQ's approach). May be prohibitive for our 3.14M tokens.
Weaviate's RQ approach simplifies encoding to 2µs by falling back to
scalar quantization.

**A/B test protocol**:
1. Implement per-token nonlinear quantization with calibration
2. Compare: per-token linear (Phase 1) vs per-token nonlinear at 4-bit
3. Measure: Kendall tau, encoding time, nDCG@10
4. **Ship if**: Quality improvement >= 0.5pp AND encoding time < 10µs/token
5. **Reject if**: Encoding too slow for re-indexing or quality gain < noise

---

### CRA-13: Fused Kernel with L1 Cache-Resident LUT (Upgrades Phase 4)

**What**: Design the Phase 4 native kernel explicitly for **L1 cache
residency** of the centroid LUT, and **fuse dot-product + max-reduce**
into a single pass.

**Why**: The dejan.ai Triton kernel implementation demonstrated that the
optimal pattern is:
1. Pre-rotate query (single matmul)
2. Load uint8 indices from HBM (4x less bandwidth than f32)
3. Gather centroids from L1-cached LUT (16 entries = 64 bytes = 1 cache line)
4. Fused dot-product + max-reduce in one kernel launch → ~1.2x speedup

The critical insight: the 16-entry LUT is **reused across all sequence
positions**, so the bottleneck is HBM bandwidth for index loading, not
compute. Our kernel should be designed bandwidth-first.

**A/B test protocol**:
1. Implement two kernel variants: (a) separate dequant + score, (b) fused
2. Benchmark on M3 Max: 50 candidates, Q=32, D=100, d=128
3. **Ship if**: Fused kernel is >= 15% faster
4. **Reject if**: Fusion complexity hurts maintainability with < 10% gain

---

### CRA-14: Fast Pseudo-Random Rotation (Weaviate RQ Approach)

**What**: Evaluate Weaviate's **fast pseudo-random rotation** (7µs) as
an alternative to full WHT matrix-vector multiply (~1,700µs for dense).

**Why**: Weaviate's 8-bit Rotational Quantization
([blog](https://weaviate.io/blog/8-bit-rotational-quantization)) uses
simplified pseudo-random rotations that achieve >99% recall on
high-dimensional datasets while being **~240x faster** to apply than
standard matrix-vector multiplication. Trades theoretical unbiased
guarantees for practical performance.

**Applicability**: Our `fastRotate()` uses the O(d log d) butterfly
WHT, which is already fast (~0.01ms for d=128). The Weaviate approach
may not offer meaningful speedup at our dimensionality. More relevant
if we scale to d=768+ with future models.

**A/B test protocol**:
1. Implement Weaviate-style fast rotation alongside WHT
2. Measure: rotation latency, quantization quality (Kendall tau), nDCG@10
3. **Ship if**: Equivalent quality with measurable latency improvement
4. **Reject if**: Quality regression > 0.1pp (theoretical guarantees matter for us)

---

### CRA-15: WebGPU Compute Shader Tier (Future — New Tier 0)

**What**: Add a **WebGPU compute shader** tier above the existing 3-tier
architecture for GPU-accelerated MaxSim scoring in-browser.

**Why**: WebGPU 1.1 (2025 Q1) added subgroup operations enabling
wave-level parallelism. For 4-bit nibble operations, WebGPU uses bit
manipulation (`(x >> 4) & 0xF`) in compute shaders. Benchmarks show
10x+ speedup over CPU for large array operations.

**Tier architecture** (updated):
- Tier 0: WebGPU compute — GPU-accelerated, in-browser
- Tier 1: Native N-API (Rust + Rayon + NEON/AVX2) — existing
- Tier 2: WASM SIMD — existing
- Tier 3: Pure JS fallback — existing

**Applicability**: Only relevant if Sweet Search runs in-browser. Low
priority for server-side CLI search.

**A/B test protocol**:
1. Implement WebGPU MaxSim kernel with 4-bit support
2. Benchmark vs WASM SIMD tier in Chrome/Safari
3. **Ship if**: >= 3x speedup over WASM SIMD in supported browsers
4. **Reject if**: Browser support too fragmented or < 2x gain

---

### Updated Projected Impact (With Community Research Additions)

**Scenario**: 17K docs, 3.14M tokens, d=128, on an 8 GB laptop.
Assumes CRA-1 (hierarchical pooling) and CRA-2 (quantile boundaries)
pass A/B testing.

| Phase | CRA Additions | Index Size | Cumulative |
|-------|--------------|-----------|------------|
| Current (JSON INT8) | — | 1.34 GiB | — |
| Phase 0 (binary) | — | 396 MiB | 3.4x |
| Phase 1 (per-token quant) | — | 419 MiB | 3.2x |
| Phase 2 (WHT rotation) | +CRA-3 (WUSH calibration), +CRA-4 (sequency ordering) | 419 MiB | 3.2x (quality++) |
| Phase 3 | **+CRA-1 (hierarchical pooling at 20% keep)** | **84 MiB** | **16x** |
| Phase 4 (4-bit) | +CRA-2 (quantile buckets), +CRA-5 (implicit decomp), +CRA-7 (Metal LUT) | **47 MiB** | **28.5x** |
| Phase 5 | +CRA-8 (Matryoshka d=64) | **~24 MiB** | **~56x** |

With CRA-1's 5x token reduction (vs Phase 3's original 2x), the
combined pipeline could achieve **28x** compression through Phase 4
alone — up from 11.4x in the original plan. If CRA-8 (Matryoshka)
proves viable, **56x** is possible.

---

## Community Research References (Added)

- [WUSH: Near-Optimal Adaptive Transforms (arXiv 2512.00956)](https://arxiv.org/abs/2512.00956)
- [GSR: Grouped Sequency-Arranged Rotation (arXiv 2505.03810)](https://arxiv.org/abs/2505.03810)
- [LIR'26: Token Pooling vs Pruning (arXiv 2603.22434)](https://arxiv.org/abs/2603.22434)
- [Voronoi Cell Token Pruning (arXiv 2603.09933)](https://arxiv.org/abs/2603.09933)
- [Token Importance Weighting (arXiv 2511.16106)](https://arxiv.org/abs/2511.16106)
- [ConstBERT: Fixed-Count Embeddings (arXiv 2504.01818)](https://arxiv.org/abs/2504.01818)
- [SAQ: Dimension Segmentation (arXiv 2509.12086)](https://arxiv.org/abs/2509.12086)
- [NVQ: Per-Vector Quantizers (arXiv 2509.18471)](https://arxiv.org/abs/2509.18471)
- [SMEC: Matryoshka Compression (arXiv 2510.12474)](https://arxiv.org/abs/2510.12474)
- [Lossless ColBERT Token Pruning (arXiv 2504.12778)](https://arxiv.org/abs/2504.12778)
- [ROSAQ: Saliency-Aware Rotation (arXiv 2506.13472)](https://arxiv.org/abs/2506.13472)
- [OptRot: Data-Free Rotation (arXiv 2512.24124)](https://arxiv.org/abs/2512.24124)
- [QuEPT: Elastic Precision (arXiv 2602.12609)](https://arxiv.org/abs/2602.12609)
- [Extended RaBitQ (GitHub)](https://github.com/VectorDB-NTU/Extended-RaBitQ)
- [Weaviate 8-bit RQ (blog)](https://weaviate.io/blog/8-bit-rotational-quantization)
- [Milvus IVF_RABITQ (blog)](https://milvus.io/blog/bring-vector-compression-to-the-extreme-how-milvus-serves-3%C3%97-more-queries-with-rabitq.md)
- [dejan.ai TurboQuant Triton Kernel (blog)](https://dejan.ai/blog/turboquant/)
- [turboquant_plus sparse-v-dequant (GitHub)](https://github.com/TheTom/turboquant_plus/blob/main/docs/papers/sparse-v-dequant.md)
- [ColBERT-Att: Late Interaction + Attention (arXiv 2603.25248)](https://arxiv.org/abs/2603.25248)
- [RSQ: Learning from Important Tokens (arXiv 2503.01820)](https://arxiv.org/abs/2503.01820)

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
Phase 3 + CRA-1 (hier.pool)  ████████   5x tokens (up from 2x), proven superior
Phase 2 + CRA-4 (seq. Walsh) ██████     Free quality win, zero kernel changes
CRA-2 (quantile buckets)     ██████     Free quality win, zero runtime cost
Phase 4 + CRA-5 + CRA-13     █████      New kernels, implicit decomp, L1 LUT
CRA-3 (WUSH calibration)     ████       A/B test after Phase 2 — may or may not help
CRA-6 (token weights)        ████       Orthogonal quality win, low effort
CRA-7 (Metal constant mem)   ███        Single annotation, Apple Silicon only
Phase 5 / CRA-8 (Matryoshka) ██         Only if model-level changes justified
CRA-9/10/11/12 (future)      █          Research directions, high effort
```

The Pareto-optimal order is: **binary storage first, token count second,
rotation third, bit reduction last.** This matches the expert consensus:
systems people say fix the serialization format; retrieval people say
reduce token count; vector DB people say rotation + simple scalar
quantization is proven; hardware people say 4-bit is the sane target.

**Critical addition from community research**: every CRA optimization
MUST be A/B tested before shipping. Academic gains on LLM KV caches
or natural language retrieval do **not** guarantee gains on code
retrieval with L2-normalized embeddings at d=128. The eval harness
is the single source of truth. Ship what passes; reject what doesn't.

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

### Community Research (Added March 2026)

- [WUSH: Near-Optimal Adaptive Transforms (arXiv 2512.00956)](https://arxiv.org/abs/2512.00956)
- [GSR: Grouped Sequency-Arranged Rotation (arXiv 2505.03810)](https://arxiv.org/abs/2505.03810)
- [LIR'26: Token Pooling vs Pruning Comparison (arXiv 2603.22434)](https://arxiv.org/abs/2603.22434)
- [Voronoi Cell Token Pruning (arXiv 2603.09933)](https://arxiv.org/abs/2603.09933)
- [Token Importance Weighting for ColBERT (arXiv 2511.16106)](https://arxiv.org/abs/2511.16106)
- [ConstBERT: Constant-Space Multi-Vector (arXiv 2504.01818)](https://arxiv.org/abs/2504.01818)
- [SAQ: Dimension Segmentation VQ (arXiv 2509.12086)](https://arxiv.org/abs/2509.12086)
- [NVQ: Per-Vector Learned Quantizers (arXiv 2509.18471)](https://arxiv.org/abs/2509.18471)
- [SMEC: Matryoshka Embedding Compression (arXiv 2510.12474)](https://arxiv.org/abs/2510.12474)
- [Lossless ColBERT Token Pruning (arXiv 2504.12778)](https://arxiv.org/abs/2504.12778)
- [ROSAQ: Saliency-Aware Rotation (arXiv 2506.13472)](https://arxiv.org/abs/2506.13472)
- [Extended RaBitQ Multi-Bit (GitHub)](https://github.com/VectorDB-NTU/Extended-RaBitQ)
- [Weaviate 8-bit Rotational Quantization (blog)](https://weaviate.io/blog/8-bit-rotational-quantization)
- [Milvus IVF_RABITQ (blog)](https://milvus.io/blog/bring-vector-compression-to-the-extreme-how-milvus-serves-3%C3%97-more-queries-with-rabitq.md)
- [dejan.ai TurboQuant Triton Kernel (blog)](https://dejan.ai/blog/turboquant/)
- [turboquant_plus sparse-v-dequant (GitHub)](https://github.com/TheTom/turboquant_plus/blob/main/docs/papers/sparse-v-dequant.md)

### Working Implementations (as of March 2026)

| Implementation | Language | Status | Notes |
|---|---|---|---|
| TheTom/turboquant_plus | Python + Metal | 141 tests, turbo3/turbo4 | 8-13x speed regression on WHT |
| llama.cpp C (veritatisquaesitoressumus) | C | 18/18 tests passing | Lloyd-Max codebooks for d=128 |
| mudler/llama.cpp feat/turbo-quant | C++ | Builds, evaluating | Experimental branch |
| MLX experiments | Python | 5x compression, 99.5% quality | Community reports |
| Google official | — | Not released | Expected Q2 2026 |
