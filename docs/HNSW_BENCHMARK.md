# Vector search benchmark: sweet-search vs FAISS, USearch, hnswlib

Status: 2026-10-08. Sections 1–4.2 are measured on two machines: an Apple
M3 Max (12 performance cores, 128 GB) and an x86 AMD EPYC Milan server
(Hetzner CCX33, 8 vCPU, AVX2, no AVX-512). Sections 4.3–4.7 are the
2026-10-07 (v3) measurements on the M3 Max only.

## 1. Summary

- **Speed at equal quality.** On held-out GCSN queries, sweet-search
  reaches its MRR faster than every rival at 6.9k, 20k and 140k vectors,
  on both machines:

  | set | M3 Max: sweet / fastest rival | x86 EPYC: sweet / fastest rival |
  |---|---|---|
  | GCSN 6.9k | **52 µs** / 76 µs (USearch i8 + rescore) | **81 µs** / 109 µs (FAISS f32) |
  | GCSN + distractors 20k | **103 µs** / 168 µs (USearch i8 + rescore) | **166 µs** / 246 µs (USearch b1 cascade) |
  | GCSN + distractors 140k | **236 µs** / 1,072 µs (FAISS SQ8 + refine) | **482 µs** / 1,673 µs (hnswlib) |
  | AdvTest 21.7k (never tuned) | 111 µs / **108 µs** (USearch i8 + rescore) | 182 µs / **141 µs** (USearch b1 cascade) |

- **One loss.** AdvTest, the set we never tuned on: USearch is about as
  fast on the M3 Max (108 vs 111 µs) and 1.3× faster on x86, and slightly
  better inside our time budget (4.2). Most of our AdvTest time is the
  full-vector stage: above 16,384 vectors the full 768-d vectors are read
  from SQLite, not kept in RAM (kept on purpose, for memory).
- **Lead:** 1.35–1.5× at 6.9k and 20k, 3.5–4.5× at 140k.
- **Quality.** We are 0.3–0.6 MRR points below exact 768-d cosine search.
  In our time budget, no rival reaches our GCSN quality.
- **Memory.** Our index structures take 197 MB at 157k (section 4.5).
  At 140k the rivals' M64 / efC800 indexes take 241 MB (USearch i8) to
  482–585 MB (hnswlib, FAISS f32, FAISS SQ8).
- **Fair claim:** "fastest at near-exact quality on code search, on ARM
  and x86". Not "best quality", and not "fastest everywhere".

## 2. What is compared

**sweet-search** (production code, `semanticSearch3Stage`):
1. Stage 1: the exact Hamming top 1,000 over 512-bit sign codes (a full
   scan, up to 150,000 vectors); above that, a binary HNSW walk (M=64,
   efC=800).
2. Stage 2: int8 (512-d) rescore of the top 40–400 stage-1 candidates
   (adaptive pool). When the pool cutoff falls inside a run of equal
   Hamming distances, the run is ordered by the asymmetric score (the
   query's int8 values summed over the set code bits).
3. Full-vector stage: exact 768-d dot on the top 30–50, blended 0.8 × full
   + 0.2 × int8 (min-max normalised).

**Rivals** (native C++, `eval/benchmarks/hnsw-rivals/rivals.cpp`, no
Python in the timed path). Each indexes the full 768-d vectors its own
documented way. Configs marked "+ rescore" or "cascade" rescore with the
exact 768-d vectors, like our last stage:

| library | configs (M / efConstruction) |
|---|---|
| FAISS 1.15.1 `IndexHNSWFlat` f32 | 16/40 (default), 32/200, 64/800 |
| FAISS 1.15.1 SQ8 HNSW + exact refine | 64/800 |
| FAISS 1.15.1 binary HNSW cascade (our codes → exact 768-d) | 64/800 |
| USearch 2.26.4 (+ NumKong) f16 | 16/128 (default), 64/800 |
| USearch 2.26.4 i8, i8 + exact rescore, b1 cascade | 64/800 |
| hnswlib (master) f32 | 16/200 (README), 64/800 |

efSearch is swept 16 → 2048 (stops at recall 0.999 or 15 ms p50).

## 3. Method

- **Embeddings:** CodeRankEmbed, the same corpus vectors for every system.
- **Data:**
  - GCSN held-out: the 2,400 GenCodeSearchNet held-out queries (seed-42
    split). Aggregate metrics only; no per-query inspection.
  - Distractor sets: the 6,918 GCSN documents plus chunks from our
    non-held-out dev eval repos, at 20k and 140k vectors (the 140k set is
    the earlier 157k set with exact duplicate vectors removed).
  - AdvTest: 3,000 queries (seed 42) over the full AdvTest index (21,731
    chunks). Reported, never tuned on.
  - CoSQA+ is never used (it is a reported benchmark).
- **Latency:** 1 thread, median of 3 runs per query, p50 over all queries,
  query embedding excluded. sweet-search runs in Node; rivals run from C++
  (`-O3 -mcpu=native` / `-march=native`; FAISS with its AVX2 build and
  OpenBLAS on x86). Index builds use all cores.
- **Quality:** MRR@10 at document level.
- **x86 caveat:** on the x86 machine our arm embeds the queries with the
  CPU (ONNX Runtime) model, while the rivals read the query vectors
  exported on the Mac. Our x86 MRR therefore differs slightly from our
  Mac MRR (for example 0.8342 vs 0.8333 on GCSN 6.9k).
- **Scripts:** `eval/benchmarks/hnsw-rivals/` — `rivals.cpp`,
  `build-native.sh` / `build-native-linux.sh`, `run-all.sh` /
  `run-all-linux.sh`, `prep.py` (exact top 10), `score.py`.

## 4. Results

### 4.1 Latency at which each system reaches our MRR (held-out, p50)

**Apple M3 Max**

| set | exact MRR | **sweet** p50 · MRR | FAISS f32 | FAISS SQ8+refine | FAISS bin cascade | USearch f16 | USearch i8 | USearch i8+rescore | USearch b1 cascade | hnswlib f32 |
|---|---|---|---|---|---|---|---|---|---|---|
| GCSN 6.9k | 0.8367 | **52 µs** · 0.8333 | 92 (M32) | 264 | 89 | 359 (M16) | 88 | 76 | never (0.8316) | 165 (M64) |
| GCSN 20k | 0.8245 | **103 µs** · 0.8191 | 322 (M64) | 443 | 190 | 660 (M64) | 286 | 168 | never (0.8187) | 499 (M64) |
| GCSN 140k | 0.7918 | **236 µs** · 0.7854 | 1,889 (M64) | 1,072 | 3,705 | 1,688 (M64) | 1,113 | 1,228 | never (0.7840) | 1,668 (M64) |
| AdvTest 21.7k | 0.4742 | 111 µs · 0.4685 | 335 (M64) | 487 | 208 | 736 (M64) | 183 | **108** | 192 | 534 (M64) |

**x86 AMD EPYC Milan**

| set | exact MRR | **sweet** p50 · MRR | FAISS f32 | FAISS SQ8+refine | FAISS bin cascade | USearch f16 | USearch i8 | USearch i8+rescore | USearch b1 cascade | hnswlib f32 |
|---|---|---|---|---|---|---|---|---|---|---|
| GCSN 6.9k | 0.8367 | **81 µs** · 0.8342 | 109 (M32) | 137 | never (0.8337) | 267 (M64) | never (0.8336) | 118 | never (0.8332) | 163 (M64) |
| GCSN 20k | 0.8245 | **166 µs** · 0.8203 | 348 (M64) | 253 | 637 | 550 (M64) | 265 | 298 | 246 | 498 (M64) |
| GCSN 140k | 0.7918 | **482 µs** · 0.7865 | 2,310 (M64) | 1,876 | never (0.7853) | 4,734 (M64) | 3,378 | 3,366 | never (0.7841) | 1,673 (M64) |
| AdvTest 21.7k | 0.4742 | 182 µs · 0.4659 | 203 (M64) | 156 | 358 | 353 (M64) | 186 | 189 | **141** | 267 (M64) |

µs at the first efSearch that reaches our MRR; the fastest build config of
each library. "never (x)": the best MRR it reaches at any efSearch ≤ 2048.

### 4.2 Best rival quality inside our time budget (held-out)

| set | M3 Max: sweet MRR · best rival within our p50 | x86: sweet MRR · best rival within our p50 |
|---|---|---|
| GCSN 6.9k | 0.8333 · 0.8308 (USearch i8) | 0.8342 · 0.8307 (FAISS f32 M64) |
| GCSN 20k | 0.8191 · 0.8167 (FAISS bin cascade) | 0.8203 · 0.8181 (USearch i8) |
| GCSN 140k | 0.7854 · 0.7748 (USearch b1 cascade) | 0.7865 · 0.7791 (FAISS SQ8 + refine) |
| AdvTest 21.7k | 0.4685 · **0.4701** (USearch i8 + rescore) | 0.4659 · **0.4671** (FAISS SQ8 + refine) |

### 4.2b The 2026-10-08 speed pass (held-out p50)

Old = main before the pass; new = after it.

| set | M3 Max old → new | x86 old → new |
|---|---|---|
| GCSN 6.9k | 77 → 52 µs | 141 → 81 µs |
| GCSN 20k | 212 → 103 µs | 466 → 166 µs |
| GCSN 140k | 328 → 236 µs | 862 → 482 µs |
| AdvTest 21.7k | 238 → 111 µs | 480 → 182 µs |

With the two output changes below switched off (`SS_FIX_HNSW_TIEBREAK=0`
and the old 15k scan cap), every result object and every stat is identical
to old on all 10,200 held-out and 10,800 dev queries, on both machines.

What changed:
- Stages 1 and 2 run in one native call (`searchCascade`): walk or scan,
  stale filter, score spread, int8 scores and the stable sort. JS builds
  result objects only for the head it keeps.
- Exact scan: one sequential pass, four codes per step, four
  sub-histograms, SIMD compare in the collect pass (NEON and AVX2).
- Full 768-d dots: two (NEON) or four (AVX2) rows per f64 vector, each
  row still one sequential sum. FMA only when the query is f32-exact, so
  the products are exact and the rounding is unchanged.
- Above 16,384 vectors, the full-vector dots run inside SQLite: an
  aggregate function from the native addon, loaded into better-sqlite3's
  own connection (`SS_FIX_SQLITE_DOTS=0` turns it off).
- x86: the release build targets baseline x86-64, which has no POPCNT
  instruction. The walk, the scan and the dot kernels are now compiled a
  second time for x86-64-v3 (AVX2, FMA, POPCNT) and picked at run time
  (`SS_FIX_X86_V3=0` forces the baseline code; same output, slower).
  The 512-bit Hamming distance has a fixed 8-word form.

**Two output changes.**
- *Tie-break at the int8 pool cutoff.* A 512-bit Hamming distance takes
  only about 100 distinct values, so the int8 pool cutoff often falls
  inside a run of equal distances. Before, the members of that run that
  entered the pool depended on stage-1 order only. Now the run is ordered
  by the asymmetric score (the query's int8 values summed over the set
  code bits). It costs under 1 µs. `SS_FIX_HNSW_TIEBREAK=0` restores the
  old order.
- *Exact scan up to 150,000 vectors (was 15,000).* Stage 1 is then the
  exact Hamming top 1,000, not the walk's approximation. The scan is
  faster than the walk up to 140k vectors on the M3 Max (150 vs 180 µs at
  140k) and ties it at 140k on x86 (341 vs 343 µs); at 20k it is 2.2–2.7×
  faster. The cap is a fixed number, so rankings do not depend on the
  machine. It covers all 400 task-bench golden repos (largest 86,751
  vectors). `SS_FIX_HNSW_SCAN=0` keeps the walk at every size.

MRR@10 change, old → new (both changes on):

| set | dev M3 Max | dev x86 | held-out M3 Max | held-out x86 |
|---|---|---|---|---|
| GCSN 6.9k | +0.0001 | −0.0001 | +0.0003 | +0.0003 |
| GCSN 20k | −0.0001 | −0.0001 | +0.0004 | +0.0006 |
| GCSN 140k | +0.0003 | +0.0004 | +0.0001 | +0.0010 |
| AdvTest 21.7k | — | — | +0.0000 | +0.0003 |

Every held-out set improves or stays equal. The three small dev drops are
each under half of one query moving from rank 1 to rank 2 (noise; the
owner accepted them).

**Kept as is, by rule (no extra memory):** resident full vectors above
16,384. It would remove most of the SQLite time (about 70 µs of AdvTest's
111 µs), at about 3 KB of RAM per vector.

**Tried and rejected in this pass:** rowid hints for the SQLite fetch
(warm-cache gain only); deeper list and code prefetch in the walk (slower
on both machines, 2× slower on x86); the int8 dot as the tie-break key
(dev MRR −0.00001 on GCSN 6.9k); including the whole tie run in the pool
(mixed dev MRR).

### 4.3 Recall@10 against exact 768-d kNN (v3, 2026-10-07, M3 Max, 157k set)

| set | sweet | FAISS (at our MRR / max) | USearch f16 | USearch i8 | hnswlib |
|---|---|---|---|---|---|
| GCSN 6.9k | 0.873 | 0.989 / 1.000 | 0.992 / 0.997 | 0.937 / 0.941 | 0.986 / 1.000 |
| GCSN 20k | 0.839 | — / 0.989 | 0.988 / 0.995 | 0.933 / 0.936 | 0.982 / 0.997 |
| GCSN 157k | 0.765 | 0.984 / 0.991 | 0.978 / 0.993 | 0.922 / 0.927 | 0.970 / 0.994 |
| AdvTest 21.7k | 0.791 | 0.981 / 0.999 | 0.977 / 0.998 | 0.913 / 0.925 | 0.959 / 0.999 |

This metric is not like-for-like for us. Our last stage blends scores on
purpose, so our top 10 is a ranking, not an approximation of the exact kNN
list. The rivals must copy exact kNN closely (0.91–0.99) to reach our MRR;
our top 10 differs more and scores almost the same MRR.

### 4.4 Binary kernels on identical inputs (v3, M3 Max)

The same 512-bit codes (bit-for-bit our index codes), M=64, efC=800, 1,000
candidates, 1 thread, GCSN **dev** queries. Stage-1 recall = share of the
exact 768-d top 10 inside the 1,000 candidates. Our walk here is the
JS-exact heap version (before bucket queues and the exact scan).

| set | sweet walk | USearch b1 ef1000 | FAISS `IndexBinaryHNSW` ef1000 | stage-1 recall: sweet / exact Hamming scan / USearch / FAISS |
|---|---|---|---|---|
| 6.9k | **94 µs** | 592 µs | 924 µs | 0.996 / 0.996 / 0.994 / 0.996 |
| 20k | **117 µs** | 780 µs | 1,039 µs | 0.982 / 0.981 / 0.972 / 0.976 |
| AdvTest 21.7k | **138 µs** | 903 µs | 1,121 µs | 0.970 / 0.970 / 0.966 / 0.969 |
| 157k | **251 µs** | 1,400 µs | 1,387 µs | 0.947 / 0.947 / 0.946 / 0.926 |

With the same exact 768-d rescore of their candidates, the rival cascades
reach the same or slightly lower MRR than ours. Building our cascade on
their kernels would be slower and not better.

### 4.5 Memory and build time (v3, M3 Max, 157k set)

Index structures kept in RAM.

| vectors | sweet | FAISS M64/efC800 | USearch i8 M64/efC800 | USearch f16 M64/efC800 | hnswlib M64/efC800 |
|---|---|---|---|---|---|
| 6.9k | 29 MB | 24 MB | 16 MB | 32 MB | 24 MB |
| 20k | 25 MB | 69 MB | 48 MB | 80 MB | 69 MB |
| 21.7k (AdvTest) | 27 MB | 75 MB | 48 MB | 80 MB | 75 MB |
| 157k | **197 MB** | 541 MB | 242 MB | 370 MB | 542 MB |

- sweet at 157k: 10 MB binary codes, 110 MB graph, 77 MB int8. At 6.9k,
  20 MB of the 29 MB is the resident full-768 cache, which is kept only up
  to 16,384 vectors (`SS_FIX_EMBED_CACHE=0` turns it off).
- The full 768-d vectors stay in SQLite on disk; rivals keep theirs in RAM.
- Build time at 157k: sweet 192 s (1 JS thread), FAISS 104 s, USearch i8
  49 s, USearch f16 212 s, hnswlib 193 s (all 12 threads, M64/efC800).
  At the rivals' default budgets they build in 3.5–91 s.

### 4.6 Throughput (12 cores) — measured before the v3 changes

Rivals: one batched call with 12 threads, at the setting that reaches our
MRR. sweet: 12 Node worker threads, each with its own copy of the index.

| set | sweet (v2 pipeline) | FAISS | USearch | hnswlib |
|---|---|---|---|---|
| GCSN 6.9k | 26.8k q/s | **61.0k** | 26.9k (f16) | 10.8k |
| GCSN 20k | **17.9k** | 1.1k (max quality) | 15.5k (i8) | 4.4k |
| GCSN 157k | **8.1k** | 1.3k | 3.0k (f16) / 2.3k (i8) | 1.5k |
| AdvTest 21.7k | 7.7k | 5.3k | **25.7k** (i8) | — |

A rerun after the v3 changes was not reliable (machine load average
9–14), so these numbers predate it. Single-query latency fell 20–50%
since then.

### 4.7 End-to-end product quality (GCSN, full pipeline)

Full `ss-search` pipeline (hybrid, full-vector postprocess, late
interaction), `eval/run_benchmark.js --profile=full`.

| run | MRR@10 |
|---|---|
| dev 3,600, late interaction on: before → after v3 | 0.8703 → 0.8703 |
| dev 3,600, late interaction off: before → after v3 | 0.8541 → 0.8542 |
| held-out 2,400 (run once, aggregate): v3 on / v3 switches off | 0.8642 / 0.8641 |

The held-out 0.8651 of 2026-10-05 predates other commits; the
same-code comparison above shows the v3 changes are neutral.

## 5. How we got here: speed history

Vector cascade p50 on GCSN dev queries (embedding excluded):

| version | 6.9k | 20k | 157k | output |
|---|---|---|---|---|
| original JS walk | 544 µs | — | 1,569 µs | baseline |
| native exact-parity walk (`37534e57`) | 201 µs | 313 µs | 505 µs | identical |
| speed pass 2 (`aabeb4a5`) | 160 µs | 261 µs | 395 µs | identical |
| v3: exact scan ≤15k, bucket queues, no float-512 (`977bc3e2`) | 79 µs | 204 µs | 317 µs | MRR within 0.1 pp |
| 2026-10-08: fused native cascade, SIMD scan/dots, SQLite dots, cutoff tie-break, scan ≤150k | **51 µs** | **102 µs** | **237 µs** (140k) | MRR in 4.2b |

Memory over the same period (RSS after load + 300 queries, 157k):
1,007 MB (original) → 1,228 MB (first native pass) → 934 MB (direct native
load, `b33ca44e`) → minus the 308 MB float-512 store (v3).

**Changes that worked:**
- Native Rust walk over a CSR graph snapshot, built at load straight from
  the graph file (no JS graph arrays).
- Batched NEON Hamming, four vectors per step.
- A neighbor at or above the current result-set maximum is dropped
  before the queue test.
- The next candidate's neighbor list is prefetched one step ahead.
- Heap sift-down reads grandchildren with children (parity mode only).
- Bucket queues: one bucket per Hamming distance, O(1) per operation.
- Exact Hamming scan up to 15k vectors: counting sort, no extra RAM.
- Native int8 and float rescoring into reused buffers. Per-query typed
  arrays had caused full GCs and p99 spikes.
- Lazy stage-1 result objects.
- int8 vectors loaded straight into one node-ordered block.
- Float-512 stage removed, along with its store, from search, the
  indexer and the maintainer.

**Tried and rejected:**
- Branch-free or counted heap sift-up, two-level lookahead and leaf-first
  sift-down.
- A bit-set visited list, BFS relabelling and deeper vector prefetch.
- A learned id → rowid fetch cache (~10 µs) and a larger SQLite mmap.
- A smaller walk budget (ef): recall risk.
- A lower graph degree: needs a reindex and would weaken the graph.
- Swapping in another library: ruled out by the owner.
- A larger rescore chain (int8 on all 1,000 → 768-d on the top 50, no
  blend): +0.17 to +0.67 pp vector-only MRR on dev but only +0.03 pp end to
  end, at +20–90 µs. The postprocess full-vector rescore already captures it.

## 6. Switches

| env | default | effect |
|---|---|---|
| `SS_FIX_HNSW_NATIVE=0` | on | JS walk instead of the native walk |
| `SS_FIX_HNSW_SCAN=0` | on | graph walk instead of the exact scan up to 150k vectors |
| `SS_FIX_HNSW_BUCKET=0` | on | JS-exact heaps instead of bucket queues |
| `SS_FIX_HNSW_FREEZE=0` | on | keep the JS graph arrays after the native snapshot |
| `SS_FIX_RESCORE_NATIVE=0` | on | JS/WASM int8 and float scoring |
| `SS_FIX_FLOAT512=1` | off | restore the float-512 stage, its store and its upkeep |
| `SS_FIX_EMBED_CACHE=0` | on | no resident full-768 cache (≤16,384 vectors) |
| `SS_FIX_HNSW_TIEBREAK=0` | on | stage-1 order (not the asymmetric score) for the Hamming tie at the int8 pool cutoff |
| `SS_FIX_SQLITE_DOTS=0` | on | fetch full vectors to JS instead of the in-SQLite dot aggregate (>16,384 vectors) |
| `SS_FIX_X86_V3=0` | on | x86: baseline x86-64 kernels instead of the AVX2/FMA/POPCNT ones |

## 7. Caveats

- Sections 1–4.2b cover an M3 Max and one x86 server (EPYC Milan, AVX2).
  AVX-512 is not used or measured. Sections 4.3–4.7 are M3 Max only.
- The M3 Max is a shared workstation (load average 2–6 during the runs).
- The distractor sets are built from our dev repos, and GCSN-like data
  favours code-tuned settings. AdvTest is the check against that, and we
  lose it to USearch i8.
- Throughput (4.6) predates the v3 changes.
- MRR differences under about 0.2 pp are within noise for 2,400–3,600
  queries.
