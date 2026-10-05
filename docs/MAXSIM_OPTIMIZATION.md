# MaxSim Optimization

**Last synced with the code:** 2026-10-06
**Current kernel:** tiled SIMD rewrite, `3343e949` (2026-07-04, shipped in 2.6.11).
**History:** first 3-tier version `74f2edd6` (2026-03-24, 47x vs naive JS).

MaxSim is the late-interaction rerank score. Each query token takes its best cosine
match over the document tokens; the score is the mean of those maxima, with negative
maxima clamped to 0:

```
score = (1/Q) · Σ_q max(0, max_d  q·d / (|q|·|d| + 1e-8))
```

`|d|` is the stored pre-quantization norm of each document token (`tokenNorms`). All
tiers must keep this contract: f32 math, same clamp, same epsilon.

---

## Where MaxSim runs

`LateInteractionIndex.scoreWithLateInteraction()` (`core/ranking/late-interaction-index.js`)
is the single entry point. Callers:

- `core/search/search-postprocess.js` — rerank of the top candidates in `ss-search` / `search`
- `core/search/search-read-semantic.js` — `ss-semantic`
- `core/search/search-pattern.js` — pattern mode (`ss-find`, `--mode pattern`)
- `core/ranking/cascaded-scorer.js` — cascaded LI → cross-encoder path (the cross-encoder is off by default)

No production caller passes the opt-in pruning options (see below). Every candidate
with tokens in the index gets a full MaxSim score.

## Production storage format

| Setting | Production value | Source |
|---|---|---|
| Model | `lateon-code` (149M, 128-dim tokens); `lateon-code-edge` (17M, 48-dim) on low-RAM hosts | `LATE_INTERACTION_CONFIG` in `core/infrastructure/config/ranking.js` |
| Quantization | **int4, per-token** min/scale, nibble-packed (`quantBits: 4`) | `LATE_INTERACTION_CONFIG.quantization = 'int4'` |
| Token norms | stored per token (`tokenNorms`, pre-quantization) | `add()` |
| WHT rotation | off (`whtSeed = 0`) | `SWEET_SEARCH_LI_WHT_SEED` |
| Token pooling | off (`poolFactor = 1`) | indexer option |
| Matryoshka truncation, token weights, WUSH | off | constructor options |
| Layout | segmented index with tombstones | `.segments` directory |

Overrides for A/B work: `SWEET_SEARCH_LI_QUANT_BITS` (4 / 8 / 32),
`SWEET_SEARCH_LI_WHT_SEED`, `SWEET_SEARCH_LI_WHT_ORDERING`. The query side reads the
format from the persisted index metadata, so a query never mixes formats.

---

## Tier dispatch

`scoreWithLateInteraction()` groups the candidates by storage format, then tries
each tier in order. A candidate falls through to the next tier only when the
earlier tier is not available.

| Tier | Engine | Formats | Notes |
|---|---|---|---|
| 1 | Native Rust addon (rayon + explicit SIMD) | int4 per-token, int8 per-token, int8 per-doc | One batch call per format group, all CPU cores |
| 2 | WASM SIMD (`core/infrastructure/maxsim.wasm`, 8.2 KB) | int8 per-token and int4 per-token (fused dequant); f32 after JS dequant | One call per candidate; query staged once per pass. The int8 per-doc kernel `maxsim_dequant` exists, but the dispatch does not call it: per-doc int8 goes through JS dequant + `maxsim_f32` |
| 3 | JS | all | int4: implicit 16-entry LUT scorer; others: dequant to a pooled f32 buffer, then WASM f32 or JS |

`getMaxSimTier()` in `core/infrastructure/simd-distance.js` reports the active tier
(`native` / `wasm` / `js`).

The native and WASM tiers are skipped when `useTokenWeights` is on, because only the
JS tier implements token weighting. They are also skipped when `maxDocTokens` is set,
because doc-token subsampling needs the non-flat JS path.

### Native addon distribution

The addon ships prebuilt in the npm optional dependencies
`@sweet-search/native-{darwin-arm64, darwin-x64, linux-x64-gnu, linux-arm64-gnu}`,
plus `-cuda` variants for Linux. `core/infrastructure/native-resolver.js` resolves it in
this order: local dev build → local package template → installed npm package (the CUDA
variant first on Linux, with a CPU fallback). The same addon also holds the tokenizer,
native grep, and native inference. A local build is only needed for development:
`npm run build:native`.

### Key files

- `core/ranking/late-interaction-index.js` — scoring entry point, format grouping, tier dispatch, JS kernels
- `core/infrastructure/simd-distance.js` — native/WASM loader, WASM query session, tier report
- `core/infrastructure/native-resolver.js` — locates the platform `.node` addon
- `crates/sweet-search-native/src/lib.rs` — native kernels (`maxsim_score_batch`, `maxsim_score_batch_pertoken`, `maxsim_score_batch_4bit`, `maxsim_score_single`)
- `crates/wasm-maxsim/src/lib.rs` — WASM kernels (`maxsim_f32`, `maxsim_dequant`, `maxsim_dequant_pertoken`, `maxsim_dequant_4bit`)
- `core/infrastructure/webgpu-maxsim.js` — WebGPU 4-bit shader; **not wired in** (no import in `core/`)
- `scripts/benchmark-maxsim.js` — microbenchmark sweep (doc length × query length × candidate count)
- `tests/infrastructure/simd-distance.test.js` — tier detection only; there is no cross-tier score parity test in the repo (the July parity fixture lived outside it)

---

## What is implemented

### Native kernel (tier 1, rewrite `3343e949`)

1. **Zero-copy buffers.** The batch entry points borrow the JS `Buffer` / `Float32Array`
   memory directly into the rayon workers. The call is synchronous, so V8 cannot move or
   free the memory during the call. The old path copied the whole candidate pool per query.
2. **64-token L1 tiles.** Each document is dequantized one 64-token tile at a time into a
   per-thread buffer. The full document is never expanded to f32.
3. **Explicit SIMD dot product.** NEON with 4 × f32x4 FMA accumulators on aarch64.
   AVX2 + FMA on x86_64, detected at runtime once (`OnceLock`). A scalar 4-accumulator
   fallback covers other CPUs.
4. **Direct int4 dequant.** `nibble * scale + min` per tile. The old per-candidate 16-entry
   LUT rebuild is gone, and the odd-dimension branch is outside the inner loop.
5. **Stored norms.** Per-token formats use `tokenNorms`; only the per-doc int8 format
   computes norms per tile.

### WASM kernel (tier 2)

1. **f32x4 SIMD** for f32, int8 per-doc, and int8 per-token, with a scalar tail for
   dimensions that are not a multiple of 4. The int8 paths widen i8 → f32 in registers.
2. **Query session** (`wasmMaxSimPrepareQuery`). The query is copied into WASM memory
   once per scoring pass. The per-candidate calls skip the Q × dim × 4 byte copy when
   the session id matches. The session is not keyed on the array identity, because the
   pooled query buffer changes between queries.
3. **int4 per-token** exists but its nibble unpack is scalar (no simd128 unpack yet).

### JS and index-side work (always on)

1. **Norm caching** — query and document norms are computed once, not per pair.
2. **Flat buffer scoring** — `maxSimScoreFlat()` reads a contiguous `Float32Array` by
   offset; no per-token sub-arrays.
3. **Pooled dequant buffer** — one reused `Float32Array` for the int8 dequant path.
4. **Implicit int4 scorer** (`_maxSimScore4BitImplicit`) — scores from packed nibbles
   with a per-query-token 16-entry table; no f32 document copy.
5. **Tombstone memo** (`_staleQueryMemo`) — one tombstone freshness `statSync` per
   segment per scoring pass, not one per candidate.
6. **Graph-expanded candidates** — `_liChunkId` maps an expanded entity to its chunk,
   so expanded candidates get a MaxSim score too.
7. **`quantizeToInt8` fix** — no `Math.min(...array)` stack overflow on long documents.

### Opt-in options (not used in production)

Options of `scoreWithLateInteraction(query, candidates, options)`:

| Option | Effect | Quality impact (March 2026 measurements) |
|--------|--------|---------------|
| `maxCandidates: N` | MaxSim-score only the top N by initial score; the rest keep that score | Risky when the initial scores do not correlate |
| `maxQueryTokens: N` / `normThreshold` | Keep the N highest-norm query tokens / drop low-norm tokens | <1% at a 75% budget |
| `maxDocTokens: N` | Stride-subsample document tokens; forces the JS tier | −1.5% to −8% |

Index-side options from the TurboQuant work (WHT and sequency WHT, WUSH calibration,
adaptive bit allocation, Matryoshka truncation, token pooling, Voronoi pruning, token
weights) also exist and are all off by default.

---

## Benchmark results

### Current kernel — native A/B (2026-07-03, `3343e949`)

Old native kernel vs the tiled rewrite, same machine, arms interleaved. Synthetic data:
Q = 32 query tokens, dim = 128, production quantization formats.

| Format | Speedup | Example |
|---|---|---|
| int8 per-token | 3.8–5.2x | — |
| int4 per-token (production) | 5.3–6.4x | 20 docs × 512 tokens: 2.74 → 0.52 ms; 1000 docs × 512 tokens: 170 → 30 ms |

The machine (M3 Max) was under load during the run. The ratios are robust because the
arms were interleaved. The absolute milliseconds are less reliable.

**Parity:** scores match the old kernel within 4e-7 relative error, with identical
rankings on a 12-case fixture (odd dimension, tile boundaries 63/64/65/257, clamp,
zero-scale tokens, empty documents). The reassociated SIMD sum makes the scores
ranking-equivalent, not bit-identical.

**Release fix in the same change:** the shipped `maxsim.wasm` was an older build without the
per-token and int4 exports. The WASM fast paths for those formats were dead on every
install without the native addon. The file was rebuilt.

### Original version — vs naive JS (2026-03-24, `74f2edd6`)

Synthetic, 512 tokens, Q = 32, dim = 128, int8.

| Candidates | Original JS | Native Rust+Rayon | Speedup |
|------------|------------|-------------------|---------|
| 10 | 55ms | 1.3ms | 42x |
| 20 | 109ms | 2.5ms | 45x |
| 50 | 273ms | 5.9ms | 47x |
| 100 | 546ms | 14ms | 41x |
| 231 | 1,261ms | 27ms | 47x |

WASM SIMD was 16x and the optimized JS tier 3.5x on the same sweep. The July rewrite
multiplies on top of the native numbers above. Nobody has re-run this table on the
current kernel, so the end-to-end factor vs naive JS is not measured.

GenCodeSearchNet at that time (6000 queries, all queries, before the dev / held-out
split): MRR@10 83.5% → 83.64%, Recall@20 93.8% → 94.25%, latency p50 942 → 502 ms.
These numbers are historical. The current published GenCodeSearchNet number is the
held-out score (86.1 MRR@10); it measures the whole pipeline, not this kernel.

---

## Evaluated and not shipped

- **Block-Max MaxSim** — Cauchy-Schwarz upper bounds per block. The bounds stay near 1.0
  for unit-normalized ColBERT-style vectors, while real similarities are near 0.3, so
  nothing gets pruned. It would only help with a model whose token norms vary (>0.05 range).
- **Fused int8 dequant in WASM (first try, March)** — the i8 → i16 → i32 → f32 widening
  cost more than the copy it saved. The later per-token kernels widen in registers and
  are the tier-2 path now.
- **PLAID / EMVB** — built for ColBERT-scale corpora. Not justified at reranker scale.

## Open work

- Vertical max kept in SIMD lanes across document tokens (estimate: ~10% more; large rewrite).
- Native-resident document store, so JS does not hand buffers per query (architectural).
- simd128 nibble unpack for the WASM int4 kernel (only matters without the native addon).
- x86_64 AVX2 + FMA path: compiles and is runtime-detected, but nobody has validated or benchmarked it on x86 hardware.
- Head-to-head with `mixedbread-ai/maxsim-cpu` on a quiet machine. The July run was
  under contention, so its numbers are not quotable.
- `webgpu-maxsim.js`: wire it in behind a measured gain, or delete it.

Do not promote a change that is only faster in a microbenchmark with no real search impact.

## Key learnings

1. **Allocation was the first bottleneck.** `Array.from()` per token per candidate cost
   more than the dot products.
2. **Copies were the second.** After the 47x step, the per-query copy of the candidate
   pool into Rust was a large share of native time; borrowing the buffers removed it.
3. **Tile, do not materialize.** Dequantizing 64 tokens into an L1-resident buffer beats
   expanding the whole document to f32.
4. **Dot products do not auto-vectorize** without reassociation; explicit SIMD was needed.
   The cost is ~1e-7 score drift, which cannot change rankings in practice.
5. **Check shipped binaries.** A stale `maxsim.wasm` silently disabled two fast paths for
   months. Rebuild with `npm run build:wasm` after any kernel change.
6. **Block-Max needs non-uniform norms.** It does nothing for L2-normalized outputs.

## Build

```bash
# WASM kernels (ship in the package, universal)
npm run build:wasm

# Native addon (local dev build; releases ship prebuilt platform packages)
npm run build:native
```

## Verify

```bash
npx vitest run tests/infrastructure/simd-distance.test.js tests/ranking/sslx-binary-format.test.js tests/ranking/wht-rotation.test.js
node scripts/benchmark-maxsim.js            # SWEET_SEARCH_LI_QUANT_BITS=4 for the production format
```
