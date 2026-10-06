# Vector search benchmark: sweet-search vs FAISS, USearch, hnswlib

Status: 2026-10-07, main after `977bc3e2` (exact scan, bucket queues, no
float-512 stage) and the float-512 store removal. All numbers are measured
on an Apple M3 Max (12 performance cores, 128 GB).

## 1. Summary

- **Speed at equal quality.** On held-out GCSN queries, sweet-search
  reaches its MRR faster than any rival at every size: 78 µs vs 89 µs
  (FAISS) at 6.9k vectors, 207 µs vs 555 µs at 20k, and 320 µs vs 1.48 ms
  at 157k (both USearch i8).
- **One loss.** On AdvTest, the one set we never tuned on, USearch i8 is
  faster (193 µs vs 227 µs) and slightly better (0.471 vs 0.469 MRR) in our
  time budget.
- **Quality.** We are 0.4–1.3 MRR points below exact 768-d cosine search.
  The gap grows with index size. In our time budget, no rival reaches our
  GCSN quality: we lead by 0.2 (6.9k), 1.3 (20k) and 1.4 (157k) points. A
  rival that spends 20–70× our latency reaches exact quality and beats us
  by those 0.4–1.3 points.
- **Kernel.** Our binary HNSW walk is 5–8× faster than FAISS
  `IndexBinaryHNSW` and USearch b1 on identical inputs, at the same
  stage-1 recall as an exact Hamming scan.
- **Memory.** Our index structures at 157k take 197 MB, vs 242 MB for
  USearch i8 and 541 MB for FAISS / hnswlib at the same build budget.
- **Fair claim:** "fastest at near-exact quality on code search". Not
  "best quality", and not "fastest everywhere".

## 2. What is compared

**sweet-search** (production code, `semanticSearch3Stage`):
1. Stage 1: binary HNSW over 512-bit sign codes (M=64, efC=800), 1,000
   candidates. Up to 15,000 vectors: an exact Hamming scan instead of the
   walk.
2. Stage 2: int8 (512-d) rescore of the top 100–150 candidates
   (adaptive pool).
3. Full-vector stage: exact 768-d dot on the top 30–50, blended 0.8 × full
   + 0.2 × int8 (min-max normalised).

**Rivals:** each builds HNSW from the full 768-d float vectors its own
documented way, and returns its top 10 directly (no rescore):

| library | index | build configs (M / efConstruction) |
|---|---|---|
| FAISS 1.15.1 | `IndexHNSWFlat` f32, inner product | 16/40 (default), 32/200, 64/800 |
| hnswlib | f32, cosine | 16/200 (README), 64/800 |
| USearch 2.26.4 | f16, cosine | 16/128 (default), 64/800 |
| USearch 2.26.4 | i8, cosine | 64/800 |

M=64 / efC=800 is our own build budget, so every rival also gets an
equal-budget build. efSearch is swept 16 → 2048 (stops at recall 0.999 or
15 ms p50).

## 3. Method

- **Embeddings:** CodeRankEmbed, the same vectors for every system.
- **Data:**
  - GCSN held-out: the 2,400 GenCodeSearchNet held-out queries (seed-42
    split). Aggregate metrics only; no per-query inspection.
  - Distractor sets: the 6,918 GCSN documents plus chunks from our
    non-held-out dev eval repos, at 20k and 157k vectors. Queries still
    have GCSN gold labels.
  - AdvTest: 3,000 queries (seed 42) over the full AdvTest index (21,731
    chunks). We report AdvTest but never tuned on it.
  - CoSQA+ is never used (it is a reported benchmark).
- **Latency:** 1 thread, median of 3 runs per query, p50 / p99 over all
  queries, query embedding excluded. sweet-search runs in Node; rivals run
  from Python, which adds a per-call floor of about 5–15 µs (FAISS,
  USearch) and about 48 µs (hnswlib).
- **Quality:** MRR@10 at document level (main metric). Recall@10 against
  exact 768-d cosine kNN is also reported.
- **Scripts:** `eval/benchmarks/hnsw-rivals/` (export, our cascade, rival
  grid, memory, throughput, summary).

## 4. Results

### 4.1 Latency at which each system reaches our MRR

p50, 1 thread. Rivals: the fastest of their build configs.

| set | vectors | exact-kNN MRR | **sweet** p50 · MRR | FAISS HNSWFlat f32 | USearch f16 | USearch i8 | hnswlib f32 |
|---|---|---|---|---|---|---|---|
| GCSN held-out | 6.9k | 0.837 | **78 µs** · 0.833 | 89 µs (M32, ef64) | 356 µs (M64, ef64) | 93 µs (M64, ef64) | 949 µs (M64, ef64) |
| GCSN held-out + distractors | 20k | 0.829 | **207 µs** · 0.820 | never (max 0.820) | 1.74 ms (M64, ef512) | 555 µs (M64, ef512) | 1.86 ms (M64, ef128) |
| GCSN held-out + distractors | 157k | 0.798 | **320 µs** · 0.785 | 2.15 ms (M64, ef512) | 1.83 ms (M64, ef256) | 1.48 ms (M64, ef512) | 4.32 ms (M64, ef256) |
| AdvTest (never tuned) | 21.7k | 0.474 | 227 µs · 0.469 | 409 µs (M64, ef128) | 758 µs (M64, ef128) | **193 µs** (M64, ef128) | 1.86 ms (M16, ef256) |

- FAISS never reaches our MRR at 20k: its recall stalls at 0.989 even at
  M=64 / efC=800 / efSearch=2048. The 20k set contains real-repo chunks with
  near-duplicate code, a known weak spot of HNSW graphs.
- At their default build budgets, FAISS (M16, M32), hnswlib M16 and
  USearch f16 M16 never reach our MRR at 157k.

### 4.2 Quality at equal latency, and at any latency

| set | sweet MRR @ p50 (p99) | best rival within our p50 | best rival at any latency | exact kNN |
|---|---|---|---|---|
| GCSN 6.9k | 0.8330 @ 78 µs (114 µs) | 0.8307 (FAISS M64 ef32, 67 µs) | 0.8369 (hnswlib M16 ef256, 1.62 ms) | 0.8367 |
| GCSN 20k | 0.8200 @ 207 µs (286 µs) | 0.8074 (USearch i8 M64 ef128, 169 µs) | 0.8277 (hnswlib M64 ef2048, 8.23 ms) | 0.8286 |
| GCSN 157k | 0.7849 @ 320 µs (430 µs) | 0.7714 (USearch i8 M64 ef128, 310 µs) | 0.7980 (hnswlib M64 ef2048, 22.97 ms) | 0.7980 |
| AdvTest 21.7k | 0.4685 @ 227 µs (306 µs) | **0.4710** (USearch i8 M64 ef128, 193 µs) | 0.4742 (FAISS M64 ef1024, 2.84 ms) | 0.4742 |

### 4.3 Recall@10 against exact 768-d kNN

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

### 4.4 Binary kernels on identical inputs

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

### 4.5 Memory and build time

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
| v3: exact scan ≤15k, bucket queues, no float-512 (`977bc3e2`) | **79 µs** | **204 µs** | **317 µs** | MRR within 0.1 pp |

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
| `SS_FIX_HNSW_SCAN=0` | on | graph walk instead of the exact scan up to 15k vectors |
| `SS_FIX_HNSW_BUCKET=0` | on | JS-exact heaps instead of bucket queues |
| `SS_FIX_HNSW_FREEZE=0` | on | keep the JS graph arrays after the native snapshot |
| `SS_FIX_RESCORE_NATIVE=0` | on | JS/WASM int8 and float scoring |
| `SS_FIX_FLOAT512=1` | off | restore the float-512 stage, its store and its upkeep |
| `SS_FIX_EMBED_CACHE=0` | on | no resident full-768 cache (≤16,384 vectors) |

## 7. Caveats

- One machine (M3 Max). x86 and Linux are not measured; the NEON paths
  fall back to scalar code there.
- Rivals run through Python. Their per-call overhead matters most at the
  smallest index and on hnswlib.
- The distractor sets are built from our dev repos, and GCSN-like data
  favours code-tuned settings. AdvTest is the check against that, and we
  lose it to USearch i8.
- Throughput (4.6) predates the v3 changes.
- MRR differences under about 0.2 pp are within noise for 2,400–3,600
  queries.
