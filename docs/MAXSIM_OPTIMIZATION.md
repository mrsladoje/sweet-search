# MaxSim Optimization

**Last synced with the code:** 2026-10-13
**Current kernel:** 2026-10-13 pass (AVX2 block kernel, worker pool, packed entry point,
slab-backed docs), on top of the NEON 4×4 kernel `f1ee878b` (2026-10-06) and the tiled
SIMD rewrite `3343e949` (2026-07-04). Every change of the 2026-10-13 pass keeps every
score bit-identical to the kernel before it, on each platform.
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
| 1 | Native Rust addon (worker pool + explicit SIMD) | int4 per-token, int8 per-token, int8 per-doc | One batch call per format group, all performance cores. Per-token formats go through the packed entry point `maxsimScorePacked`; per-doc int8 through `maxsimScoreBatch` |
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
- `core/infrastructure/simd-distance.js` — native/WASM loader, `nativeMaxSimPacked`, `nativeMaxSimPrewarm`, WASM query session, tier report
- `core/infrastructure/maxsim-pack.js` — builds the packed entry point's buffer list and descriptor
- `core/infrastructure/native-resolver.js` — locates the platform `.node` addon
- `crates/sweet-search-native/src/maxsim/kernel.rs` — the kernels, worker pool and scheduler (pure Rust, no N-API)
- `crates/sweet-search-native/src/maxsim/mod.rs` — N-API entry points (`maxsimScorePacked`, `maxsimPrewarm`, `maxsimScoreBatch4Bit`, `maxsimScoreBatchPertoken`, `maxsimScoreBatch`, `maxsimScoreSingle`)
- `eval/maxsim-bench/` — replay capture, bit-exact gate (`parity.mjs`), A/B tools and the benchmark against other implementations
- `crates/wasm-maxsim/src/lib.rs` — WASM kernels (`maxsim_f32`, `maxsim_dequant`, `maxsim_dequant_pertoken`, `maxsim_dequant_4bit`)
- `core/infrastructure/webgpu-maxsim.js` — WebGPU 4-bit shader; **not wired in** (no import in `core/`)
- `scripts/benchmark-maxsim.js` — microbenchmark sweep (doc length × query length × candidate count)
- `tests/infrastructure/simd-distance.test.js` — tier detection
- `tests/infrastructure/maxsim-native-parity.test.js` — native kernels vs a JS reference of the contract; packed vs object entry point, bit for bit; malformed descriptors

---

## What is implemented

### Native kernel (tier 1)

Scores are bit-identical across all changes since `f1ee878b` (gate:
`eval/maxsim-bench/parity.mjs`, every f64 compared with `Object.is` on seeded fixtures
for every kernel branch and on every replayed production call, both entry points, int4
and int8).

1. **NEON 4 query × 4 doc block** (aarch64, `f1ee878b`). 16 f32x4 accumulators over a
   row-major dequantized tile: 8 loads per 16 FMAs. Pairwise adds fold a block into one
   f32x4 of 4 doc similarities per query row. The last 1-3 query rows use the same block
   with fewer rows instead of padding to 4 (padded rows were 8.6% of all work).
2. **AVX2 4 query × 2 doc block** (x86_64, runtime-detected AVX2 + FMA). The old x86
   kernel summed each pair with `dot_avx2_fma`: four 8-lane FMA chains, `(c0+c1)+(c2+c3)`,
   then two lane folds. The block computes the same chains for 8 pairs at once and folds
   all 8 with shuffles: the same additions in the same order, so every score matches the
   old x86 kernel bit for bit. The fold of block j runs while block j+1's FMAs execute
   (software pipelined); chain loops have compile-time trip counts for dims 128 / 96 /
   64 / 48 / 32. 2.1-2.7x per core over the old x86 kernel.
3. **Vector dequantization.** NEON and AVX2 int4 / int8 dequant for any `dim % 16 == 0`
   (mul then add, the scalar path's rounding). The 48-dim edge model was on the scalar
   path before; 1.5x on that model.
4. **64-token tiles** dequantized once per tile into a per-thread buffer and shared by
   all query blocks. Norms are the stored pre-quantization norms.
5. **Worker pool** (`kernel.rs: mod pool`). One thread per performance core
   (`hw.perflevel0.logicalcpu` on Apple Silicon, all logical CPUs elsewhere;
   `SS_MAXSIM_THREADS` overrides), user-interactive QoS on macOS. The calling thread
   scores too, from the first microsecond. Hand-off is lock-free: the caller publishes a
   pointer to its stack-owned job and bumps an epoch; spinning workers join without a
   lock, count themselves in `active` around their use of the pointer, and the caller
   returns only when `active` is 0. Parked workers are woken with one broadcast; a worker
   that finishes spins 200 µs before parking. Under rayon, the caller slept until the
   pool woke, and woke its helpers one system call at a time (cold calls 1.7x slower on
   M3 Max); a first mutex-based version of this pool made 11 woken workers queue on one
   lock per call (warm calls 17% slower, and prewarm barely helped).
6. **Work units.** Candidates are cut into whole-tile units, about 4 per thread, claimed
   largest first from one atomic counter. Each unit keeps its own per-query maxima; a
   candidate's units are merged in tile order. A maximum is exact in any order, so the
   split never changes a score; it stops one long doc from finishing last on its own.
7. **Packed entry point** `maxsimScorePacked(query, numQ, dim, bits, buffers, desc)`.
   The object-per-candidate entry points spent ~1-1.7 µs per candidate in N-API property
   reads. Here a few shared buffers and one `Uint32Array` describe the whole pool (10 u32
   per doc: tokens, dim, and buffer + offset of each array); every range, alignment and
   dim is checked, and a bad descriptor is a JS error. Result: a `Float64Array`.
8. **Prewarm** `maxsimPrewarm()`: the rerank stage calls it on entry, so the pool's
   wake-up overlaps the ~0.1 ms of JS work before the kernel call. On M3 Max, a call
   after 5 ms of other work drops from 0.065 to 0.042 ms p50 with a 0.1 ms lead
   (0.5-1 ms leads: the same; warm back-to-back: 0.032 ms).

### Documents in shared slabs (JS, always on)

`scoreWithLateInteraction` passes the docs straight to `nativeMaxSimPacked`, which hands
the native side one buffer per slab. Every load path lays the docs out that way: the SSLX
segment reader copies a segment's docs into one ArrayBuffer (stale docs skipped), and
`_packDocsIntoSlabs()` repacks docs from the JSON single-file format (indexes under
10,000 docs) and legacy LISE segments into slabs of up to 64 MB. Per 25-candidate call
the N-API work drops from ~24 µs (objects) or ~17 µs (one buffer per array) to ~4.5 µs
(M3 Max). The heap holds one ArrayBuffer per slab instead of four per doc.

### WASM kernel (tier 2)

1. **f32x4 SIMD** for f32, int8 per-doc, and int8 per-token, with a scalar tail for
   dimensions that are not a multiple of 4. The int8 paths widen i8 → f32 in registers.
2. **Query session** (`wasmMaxSimPrepareQuery`). The query is copied into WASM memory
   once per scoring pass. The per-candidate calls skip the Q × dim × 4 byte copy when
   the session id matches. The session is not keyed on the array identity, because the
   pooled query buffer changes between queries.
3. **int4 per-token, tiled** (`maxsim_dequant_4bit_tiled`, 2026-10-13). The plain
   `maxsim_dequant_4bit` dequantized every doc token again for every query token and summed
   each pair as one scalar chain. The tiled export dequantizes each doc token once per
   64-token tile into a transposed scratch buffer (the JS glue passes scratch after the
   inputs), and f32x4 lanes hold 4 doc tokens, so each lane runs that same scalar chain
   for its own pair: bit-identical, 7.4x faster on the agent replay. When the scratch
   does not fit in the module's 1 MB memory, the plain export runs.

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

### Current kernel vs other implementations (2026-10-13, held-out)

Full tables, method and raw data: [`eval/maxsim-bench/RESULTS.md`](../eval/maxsim-bench/RESULTS.md).
Warm, all cores, each rival at its fastest configuration; other / sweet (> 1 = sweet faster):

| held-out set | NumPy | PyTorch | maxsim-cpu | previous sweet path |
|---|---|---|---|---|
| agent calls, M3 Max | 2.00x | 4.24x | 6.51x | 3.36x |
| GCSN calls, M3 Max | 2.05x | 6.65x | 6.86x | 4.47x |
| agent calls, EPYC Milan | 1.44x | 1.89x | 2.44x | 3.63x |
| GCSN calls, EPYC Milan | 1.57x | 2.80x | 2.69x | 4.32x |

Not fastest: cold x86 calls (OpenBLAS keeps its threads spinning ~0.1 s; NumPy ~1.5x
faster), M3 Max cold calls without prewarm, large 32-64 query-token calls on the M3 Max
(Accelerate's AMX coprocessor; up to 1.6x), and NumKong (approximate) on the largest
cells. Native vs plain JS: 170-196x (M3 Max), 77-84x (EPYC).

### Earlier kernel — native A/B (2026-07-03, `3343e949`)

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

2026-10-13 pass (each measured with the A/B tools in `eval/maxsim-bench`):

- **x86: start each FMA chain with a multiply** (skip zeroing the accumulators): the
  compiler had already removed the zeroing; cycles per pair unchanged.
- **x86: 32-token tiles** (the 64-token tile plus queries overflows Zen 3's 32 KB L1):
  within noise.
- **x86: one thread per physical core on SMT machines**: 6-24% faster on tiny cold
  calls, 8-16% slower on large and on typical warm calls; the default stays all logical CPUs.
- **x86: 4 query x 3 doc block**: estimated at ≤7% fewer instructions (the fold, the
  chain spills and the loads that the bit-identical summation order requires stay);
  not built.
- **Apple Silicon: an AMX path** (Accelerate's matrix units): not needed, the NEON kernel
  beats Accelerate NumPy by 1.3-2.1x on the tested shapes on a quiet M3 Max; and
  Accelerate's summation order is not ours.
- **rayon as the helper pool**: as fast as the lock-free pool on warm calls in one run,
  slower in another, and 1.7x slower on cold calls.
- **Bigger helper counts on Apple Silicon (16 = with efficiency cores)**: no gain.

Earlier:

- **Block-Max MaxSim** — Cauchy-Schwarz upper bounds per block. The bounds stay near 1.0
  for unit-normalized ColBERT-style vectors, while real similarities are near 0.3, so
  nothing gets pruned. It would only help with a model whose token norms vary (>0.05 range).
- **Fused int8 dequant in WASM (first try, March)** — the i8 → i16 → i32 → f32 widening
  cost more than the copy it saved. The later per-token kernels widen in registers and
  are the tier-2 path now.
- **PLAID / EMVB** — built for ColBERT-scale corpora. Not justified at reranker scale.
- NEON transposed 4x8 kernel (0.97x), small batches on the calling thread only
  (0.39-0.90x), QoS-only change (no effect) — `f1ee878b`.

## Open work

- AVX-512 path (two 8-lane chains per register, same summation order): not built, no
  AVX-512 machine to measure on. AVX-512 CPUs run the AVX2 kernel.
- WASM int8 per-token kernel: still scalar per pair (production indexes are int4; the
  int4 WASM kernel is tiled, `maxsim_dequant_4bit_tiled`).
- JS around the kernel call in `scoreWithLateInteraction`: ~30-45 µs per call on M3 Max
  (20-35% of the rerank stage; `eval/maxsim-bench/js-overhead.mjs`).
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
npx vitest run tests/infrastructure/maxsim-native-parity.test.js tests/infrastructure/simd-distance.test.js tests/ranking
# a kernel change must be bit-identical to the build before it (every f64, Object.is):
node eval/maxsim-bench/parity.mjs old.node new.node ~/.ss-eval/maxsim-replay/agent-dev ~/.ss-eval/maxsim-replay/gcsn-dev
node eval/maxsim-bench/wasm-parity.mjs old.wasm core/infrastructure/maxsim.wasm ~/.ss-eval/maxsim-replay/agent-dev
```

Replay sets, A/B tools and the benchmark against other implementations:
[`eval/maxsim-bench/README.md`](../eval/maxsim-bench/README.md).
