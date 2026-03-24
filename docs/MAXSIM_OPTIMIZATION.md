# MaxSim Optimization

**Implemented:** 2026-03-24
**Result:** 47x speedup on MaxSim scoring, zero quality regression.
**Benchmark:** GenCodeSearchNet MRR@10 83.64% (unchanged), latency p50 942ms → 502ms.

---

## Architecture

Three-tier MaxSim acceleration with automatic fallback:

| Tier | Engine | Speedup | Portability |
|------|--------|---------|-------------|
| 1 | Native Rust + Rayon | 47x | Platform-specific `.node` addon |
| 2 | WASM SIMD (Rust/LLVM) | 16x | Universal — `core/maxsim.wasm` (2.9KB) |
| 3 | JS (norm-cached flat buffer) | 3.5x | Universal — pure JS fallback |

Auto-detected at startup. Tier 1 requires building with `npm run build:native`.
Tier 2 ships in the package. Tier 3 is always available.

### Key files

- `core/late-interaction-index.js` — MaxSim scoring, 3-tier dispatch
- `core/simd-distance.js` — WASM/native loader, tier routing
- `core/maxsim.wasm` — Rust-compiled WASM SIMD kernel
- `wasm-maxsim/` — Rust source for WASM kernel
- `native-maxsim/` — Rust source for native addon (rayon + NEON/AVX2)

---

## What was implemented

### Always-on (no quality impact)

1. **`quantizeToInt8` bugfix** — fixed `Math.min(...floatArray)` stack overflow for 1024+ token documents at 128d.
2. **Norm caching** — pre-computes L2 norms for query and document tokens. Avoids 3x redundant FLOPs per cosine similarity.
3. **Flat buffer scoring** — `maxSimScoreFlat()` operates on contiguous Float32Array with offset indexing, avoiding N sub-array allocations per candidate.
4. **Pooled dequantization buffer** — reuses a single Float32Array across candidates instead of allocating 256KB per candidate.
5. **WASM SIMD kernel** (`core/maxsim.wasm`) — Rust-compiled f32x4 SIMD with LLVM optimization. Handles arbitrary dimensions (scalar tail for non-multiple-of-4).
6. **Native Rust + Rayon** (`native-maxsim/`) — parallel candidate scoring across all CPU cores. Zero-copy buffer access via napi-rs.
7. **`tokenNorms` persistence** — computed at `add()` time, reconstructed on `load()` via `_rebuildTokenNorms()`.

### Opt-in (quality/speed tradeoff)

Available via `scoreWithLateInteraction(query, candidates, options)`:

| Option | Effect | Quality impact |
|--------|--------|---------------|
| `maxCandidates: N` | Only MaxSim-score top N by initial score | Risky if initial scores don't correlate |
| `maxQueryTokens: N` | Keep N highest-norm query tokens | <1% at 75% budget |
| `maxDocTokens: N` | Stride-subsample document tokens | -1.5% to -8% depending on aggressiveness |

### Evaluated and not shipped

- **Block-Max MaxSim** — component-wise Cauchy-Schwarz upper bounds. Mathematically correct but ineffective for unit-normalized ColBERT-style vectors (bounds always ~1.0 while actual similarities ~0.3). Would activate for models with varying token norms (>0.05 range).
- **Fused WASM dequantization** — dequantize int8→f32 inside the WASM kernel. Slower than JS dequant + WASM f32 scoring because the per-element widening pipeline (i8→i16→i32→f32) costs more than the float32 copy savings.
- **PLAID/EMVB** — ColBERT-scale infrastructure. Not justified at reranker scale.

Do not promote if the result is only a faster micro-benchmark with no real search impact.

---

## Benchmark results

### Microbenchmark (synthetic, 512 tokens, Q=32, dim=128)

| Candidates | Original JS | Native Rust+Rayon | Speedup |
|------------|------------|-------------------|---------|
| 10 | 55ms | 1.3ms | 42x |
| 20 | 109ms | 2.5ms | 45x |
| 50 | 273ms | 5.9ms | 47x |
| 100 | 546ms | 14ms | 41x |
| 231 | 1,261ms | 27ms | 47x |

### GenCodeSearchNet (6000 queries, profile=full, concurrency=12)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| MRR@10 | 83.5% | 83.64% | +0.1pp |
| Recall@20 | 93.8% | 94.25% | +0.5pp |
| Latency p50 | 942ms | 502ms | -47% |

Per-language: Python 98.0%, Go 94.4%, Java 84.8%, JS 71.6%, PHP 77.6%, Ruby 75.4%.
Zero regressions.

### Key learnings

1. **Sub-array allocation was the hidden bottleneck.** `Array.from()` per token per candidate cost more than the dot products.
2. **V8 JIT optimizes regular Arrays better than Float32Array.** Packed doubles with TurboFan beat typed array accessors.
3. **Block-Max requires non-uniform norms.** For L2-normalized ColBERT outputs, Cauchy-Schwarz bounds are trivially loose (~1.0 vs actual ~0.3).
4. **Fused WASM dequant is slower than JS dequant + WASM scoring.** The i8→i16→i32→f32 widening pipeline costs more than copying 256KB of float32.
5. **f32 precision improves quality.** The WASM kernel using f32 (model's native precision) produces marginally better rankings than JS f64.

## Build

```bash
# WASM kernel (ships in package, universal)
npm run build:wasm

# Native addon (local build, platform-specific, optional)
npm run build:native
```
