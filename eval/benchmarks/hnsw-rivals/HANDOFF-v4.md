# HNSW rivals benchmark v4 — handoff (2026-10-14)

Status: the measurement runs are finished, except for the Mac 1M set, which the owner stopped after round 1
plus most of round 2. The paper write-up is NOT started. The owner wants to discuss the results and the
product improvements in a new session before more runs.

Rules that apply: held-out sets give aggregate numbers only (no per-query inspection); choose any knob on
DEV queries, never on held-out; never trade MRR for speed; commit + push to main; one heavy job per machine;
no CPU embedding model and GPU model at the same time; do not mention benchmark wall time to the owner.

## 1. Conclusions

1. Up to 140k vectors, our cascade beats every HNSW library (FAISS HNSW, USearch, hnswlib) at our MRR, on
   both the M3 Max and the x86 box. The best HNSW rival needs 1.2x–2.0x our time; many configs never reach
   our MRR at any setting tested.
2. One baseline beats us at <=140k: FAISS IndexBinaryFlat over OUR 512-bit codes + exact rescore
   ("binflat"). It is our own algorithm in tight C++, with all full vectors in RAM. It is 0.36x–0.93x our time.
3. At 1M the picture changes. On the M3 Max (partial run) only USearch int8 beats us (0.75x). On x86, FAISS
   HNSW-SQ8+refine (0.33x), USearch int8 (0.51x), hnswlib M64 (0.56x) and FAISS HNSW-Flat M64 (0.81x) beat us.
   The binflat baseline loses to us at 1M (1.38x on x86, 3.54x on the Mac), as expected.
4. At 1M, our stage 1 (binary HNSW walk) is ~80% of our time, and its cost is set by stage1Candidates=1000
   (production default, core/infrastructure/config/vector-store.js:64), which forces a walk with ef ~1000.
   S1=250 keeps MRR on all 5 sets and cuts 1M latency by ~2.8x on x86 and ~1.8x on the Mac. NOT yet safe to
   ship — see section 5.
5. Our x86 graph walk is ~4.5x slower than on the M3 Max (stage 1: ~1,400 us vs ~310 us at 1M). The rivals
   are only ~1–1.8x slower on x86. The x86 box is ALSO noisy: identical back-to-back runs of our 1M arm gave
   p50 1,253 / 1,854 / 1,228 us.

## 2. Setup (what was measured)

- Embeddings: CodeRankEmbed 768-d, unit vectors. Our index uses the first 512 dims as sign bits.
- Our arm (`ours.mjs`): production `semanticSearch3Stage` in Node, same q768 query vectors as the rivals
  (injected into the embedding LRU; the run throws if a query is not served from cache). 200 warmup queries,
  median of 3 runs per query. Production point: S1=1000, EF=400, POOL=1, W=0.8 (0.8 full + 0.2 int8), SCAN=1.
  - n <= 150,000 (EXACT_SCAN_MAX_VECTORS, binary-hnsw-index.js:71): exact Hamming scan; above: binary HNSW
    walk (M64, efC800, efSearch 400).
  - stage 2: int8 rescore, adaptive pool 40–400. Stage 3: full 768-d rescore.
  - full vectors resident in RAM only up to 16,384 (EMBEDDING_CACHE_MAX_VECTORS, codebase-repository.js:34);
    above that they are read from SQLite (codebase.db) per query.
- Rivals (`rivals.cpp`, C++): FAISS 1.15.1, USearch 2.26.4 (+NumKong), hnswlib. 19 configs (see run4.sh
  CONFIGS): exact, HNSW-Flat M16/32/64, HNSW-SQ8+refine, binary HNSW cascade, binflat cascade, RaBitQ
  (flat/IVF/HNSW), IVF-Flat, IVF-PQ192x4fs+RFlat, USearch f16/i8/i8+rescore/b1 cascade, hnswlib M16/M64.
  Each swept over efSearch / nprobe / k_factor_rf. Queries single-threaded; builds use all cores.
- Statistics (`score4.py`): MRR@10 + recall@10 with 95% bootstrap CIs (2000 resamples, seed 42); "time to
  our quality" = fastest point whose MRR is not significantly below ours (paired bootstrap of dQ); p50 is the
  median of per-round p50s; ratio CI from per-query median latencies; Pareto frontier.
- Rounds: 3 timing rounds, rival order rotated per round, our arm timed at start and end of each round.
  Index cache: box reuses one built index across rounds; the Mac rivals binary is OLDER and caches only the
  FAISS factory indexes, so on the Mac every HNSW graph is rebuilt per round (disclose in the paper).
- Machines: Apple M3 Max (Mac), AMD EPYC-Milan 8 vCPU KVM, 30 GB, Hetzner CCX33 (box).

### Sets (all held-out query splits)

| Set | Vectors | Queries | Exact MRR@10 |
|---|---|---|---|
| gcsn-ho (GenCodeSearchNet) | 6,918 | 2,400 | 0.8367 |
| d20k-ho (GCSN + distractors) | 20,000 | 2,400 | 0.8245 |
| advtest (CodeXGLUE AdvTest) | 21,731 | 3,000 | 0.4742 |
| dall-ho (GCSN + all distractors) | 140,449 | 2,400 | 0.7918 |
| csn1m-ho (GCSN + 997,821 CodeSearchNet functions) | 1,004,739 | 2,400 | 0.5360 |

1M set: CodeXGLUE code-to-text functions, the 30 GCSN source repos excluded, whitespace-normalised dedup,
seed-42 shuffle; text `${repo}/${path} ${func_name}\n${code[:1500]}`, maxLength 512; embedded on a RunPod
RTX 5090 in f32 (bf16 was garbage — CUDA flash-attn bug, fixed in 05d13122). Vectors sha256 561c7d51…
Built by `build-1m.mjs`. A dev split `csn1m-dev` exists (same corpus, GCSN dev queries) — use it for tuning.

## 3. Results

Ratio = rival p50 / our p50 at our MRR (>1 = rival slower). "never" = no setting reached our MRR.
Ours = production point. All held-out, aggregate only.

### M3 Max

| Set | Ours p50 | Ours MRR@10 | Best HNSW rival | binflat | Rivals that never reach our MRR |
|---|---|---|---|---|---|
| 6.9k | 59 us | 0.8333 | x1.46 USearch b1 cascade | x0.77 | 2 |
| 20k | 102 us | 0.8191 | x1.58 USearch i8 | x0.61 | 4 |
| AdvTest | 111 us | 0.4685 | x1.64 USearch i8 | x0.41 | 4 |
| 140k | 237 us | 0.7854 | x4.46 FAISS SQ8+refine | x0.93 | 9 |
| 1M (partial: r1 + most of r2) | 442 us | 0.5306 | x0.75 USearch i8 | x3.54 | 0 |

Mac 1M detail: USearch i8 334 us (x0.75), USearch i8+rescore 350 (x0.79), FAISS SQ8+refine 588 (x1.34),
FAISS binary HNSW cascade 957 (x2.19), USearch f16 M64 991 (x2.27), FAISS Flat M64 1,125 (x2.57),
binflat 1,547 (x3.54), IVF-PQ-fs 1,872 (x4.28), hnswlib M64 2,671 (x6.14), exact 53,966 (x123).

### x86 box (EPYC Milan)

| Set | Ours p50 | Best HNSW rival | binflat | Other notable |
|---|---|---|---|---|
| 6.9k | 80 us | x1.18 hnswlib M64 | x0.76 | IVF-PQ-fs x0.96 |
| 20k | 159 us | x1.54 USearch b1 | x0.59 | |
| AdvTest | 175 us | x1.07 USearch i8+rescore | x0.36 | |
| 140k | 465 us | x1.96 FAISS SQ8+refine | x0.78 | 9 configs never |
| 1M | 1,809 us (rounds 1,308–2,107) | **x0.33 FAISS SQ8+refine (584 us)** | x1.38 | USearch i8 x0.51, hnswlib M64 x0.56, FAISS Flat M64 x0.81 |

### Our knob sweep (single timing run per point; prod point is a median of rounds)

M3 Max, p50 us / MRR@10:

| Point | 6.9k | 20k | AdvTest | 140k | 1M |
|---|---|---|---|---|---|
| prod S1=1000 | 58.8 / .8333 | 102.4 / .8191 | 111.2 / .4685 | 236.8 / .7854 | 442 / .5306 |
| S1=100 | 53.5 / .8326 | 98.0 / .8178 | 104.8 / .4677 | 229.9 / .7826 | 253 / .5276 |
| S1=250 | 55.2 / .8335 | 98.9 / .8197 | 107.6 / .4687 | 231.0 / .7856 | 251 / .5300 |
| S1=500 | 56.5 / .8335 | 100.5 / .8197 | 108.5 / .4687 | 234.2 / .7856 | 272 / .5304 |
| S1=2000 | 63.4 / .8329 | 105.0 / .8182 | 114.9 / .4686 | 241.0 / .7850 | 602 / .5301 |
| POOL=0.5 | 52.5 / .8290 | 77.3 / .8160 | 82.0 / .4653 | 203.4 / .7809 | 348 / .5275 |
| POOL=2 | 88.5 / .8343 | 161.9 / .8208 | 174.8 / .4704 | 313.6 / .7880 | 548 / .5328 |
| W=1 (pure exact rescore) | 62.3 / .8335 | 102.9 / .8197 | 110.7 / .4709 | 237.1 / .7850 | 400 / .5312 |
| walk instead of scan | 106.6 | 149.5 | 166.0 | 260.3 | (1M always walks) |

Mac stage-1 time at 1M: prod ~310 us of 442; S1=250 ~139 of 251; S1=2000 ~477 of 602.

x86 1M sweep: S1=250 637 us / .5300; S1=100 682 / .5276; S1=500 737 / .5304; W=1 1,173 / .5312;
POOL=0.5 1,158 / .5275; S1=2000 2,101 / .5301. Stage 1 = ~1,000–1,600 us of the prod total.
x86 140k: walk 452 us vs scan 464 us (equal); on the Mac the scan wins (237 vs 260).
CIs on MRR@10 are about ±0.017 everywhere, so no S1 change from 250 to 2000 is visible in MRR@10.

## 4. Hypotheses (ranked; none proven)

H1 — Stage-1 width is oversized at 1M. stage1Candidates=1000 forces ef ~1000 over a 2xM=128-neighbour
  layer 0: ~10^5 random 64-byte reads per query. Stage 2 keeps at most 400, so most of the 1,000 are dropped.
  Evidence: MRR@10 flat for S1 100–2000 on all sets; latency scales with S1 at 1M only. Risk: the product
  may consume more than the top 10 (hybrid fusion with BM25, agent formats with larger k), where recall@100
  could fall. Candidate fix: S1 = f(n) or S1 tied to the stage-2 pool size, chosen on DEV.

H2 — The x86 walk is memory-latency bound and suffers more than the rivals. Our walk does random reads into
  a 64 MB code slab + ~512 MB neighbour lists, from JS-allocated buffers with 4 KB pages (THP is "madvise"
  on the box, so V8 ArrayBuffers get no huge pages). M3 uses 16 KB pages and has a stronger memory
  subsystem. Popcount is NOT the cause: `walk_v3` (hnsw_search.rs:824) is already compiled with
  avx2/popcnt/bmi and selected at runtime; the box loads our fresh local release build.
  THP test (box, 1M, prod point, interleaved, after `echo 1 > /proc/sys/vm/compact_memory`):
  madvise 1,228 us (stage 1: 1,009) | always 1,086 (877) | madvise 1,289 (1,057) | always 1,133 (915).
  Huge pages: ~11% faster total, ~13% faster stage 1, in both pairs, although the kernel gave only
  40–141 MB of huge pages (of ~3.2 GB RSS; memory is fragmented after 80 days uptime). So the full effect
  may be larger. THP was reset to madvise/madvise afterwards (verified). Outputs: sets/thp2-*.json on the box.
  Conclusion: page size explains part of the x86 gap, not 4.5x. The rest is likely the walk's access
  pattern (~10^5 random reads per query at ef ~1000).
  Possible fixes: madvise(MADV_HUGEPAGE) on the slab + graph from Rust (allocate in Rust, not V8); store each
  node's neighbour codes contiguously (USearch/FAISS layouts are more cache-friendly); prefetch deeper;
  int8 or compressed neighbour ids.

H3 — Box noise. Identical runs of our 1M arm vary 1.2–1.9 ms; KVM neighbours share memory bandwidth/L3.
  Rivals were timed at other times, so 1M x86 ratios carry this noise. The rotated rounds reduce bias but
  not variance. For the paper: interleave our arm more often at 1M, or use a dedicated bare-metal x86.

H4 — SQLite full-vector reads above 16,384 vectors cost a fixed part of every query (stage 3 reads
  ~40–400 full vectors through the ss_full_dots aggregate). This is why binflat (all in RAM) beats us at
  <=140k. Subtraction on x86: scan 27/60/62 us vs the rest 53/101/111 us at 6.9k/20k/AdvTest.
  Fix options: mmap a flat f32 (or f16) vector file next to the index; or raise the resident cap.

H5 — The int8 stage + 0.8/0.2 blend adds time for no quality gain: W=1 (pure exact rescore) gives equal or
  higher MRR at equal or lower time on every set (1M x86: 1,173 vs 1,809 us). Check on DEV first.

H6 — Node per-query overhead (embedding-cache lookup, promise hops, result objects) is a fixed ~20–40 us.
  Not measured directly. A per-stage profile on a quiet machine is still owed.

## 5. Before changing the product

1. Profile our cascade per stage at 1M on both machines (walk, int8, SQLite reads, JS overhead).
2. For S1 and W: tune on csn1m-dev and the GCSN dev split only; check recall@100 and the full hybrid
   search pipeline on GCSN dev (the paper's headline MRR); find every caller that asks for > 10 vector
   results. Only then change the default.
3. Fix the largest measured cost; rerun ONLY our arm on all held-out sets, 3 rounds, both machines (the
   rival results stay valid; same indexes, same queries).
4. Mac 1M: rerun with a rivals binary rebuilt from the current rivals.cpp (it caches every library's index),
   so 3 rounds take ~7 h instead of ~18 h.

## 6. Paper framing (current evidence)

- Claim: at equal MRR, our binary-code cascade beats the standard HNSW libraries up to 140k vectors on ARM
  and x86, and ties/beats most of them at 1M on ARM.
- Must also report: the binflat baseline (our method in FAISS C++) is faster at <=140k; at 1M on x86 we lose
  to FAISS SQ8 and USearch int8; memory per system (index_mb is in the rival JSON; our rss_mb in ours-*.json).
- The Mac 1M result is partial (1–2 rounds) and the Mac rebuilt graphs per round.

## 7. Files and locations

Repo (eval/benchmarks/hnsw-rivals/): rivals.cpp, build-native.sh (Mac, absolute rpath), build-native-linux.sh,
ours.mjs, score4.py (fixed sweep key), run4.sh (default + INNER=1 low-disk mode), build-1m.mjs, prep.py.

Mac:
- ~/.ss-eval/hnsw-bench/v4/<set>/ — runs/r<k>/*.jsonl, ours-*.json, load.log, env-r*.txt, summary.txt,
  scored4.json. csn1m-ho stopped 2026-10-14 15:0x; the partial r2 faiss_sq8 output was moved to the
  session scratchpad (r2partial/).
- ~/.ss-eval/hnsw-bench/{rivals/ (OLD binary, see section 2), venv/, queue4-mac.sh, csn1m/ (root)}
- ~/.ss-eval/hnsw-idxcache/csn1m-ho/ — ~16 GB of FAISS factory indexes; delete when done.
- ~/.ss-eval/hnsw-1m/ — csn_texts.jsonl, mk_texts.py, embed.mjs, pod/vec768.f32.

Box (root@167.233.69.121):
- /root/hnsw-x86/sets/v4/<set>/ — same layout; score with /root/hnsw-x86/hb/score4b.py (the fixed scorer;
  hb/score4.py on the box is the OLD one).
- /root/hnsw-x86/{repo (HEAD bb111075, addon built locally), riv4/ (current rivals binaries), csn1m/, idxcache/}
- thp*-*.json in sets/ are the huge-page test outputs.
- 446 idle leftover `_rt_broker.mjs` node processes (task-bench, ~7 days old, 1.5 GB RSS, 0% CPU) — ask
  the owner before killing.
- Disk ~20–26 GB free.

## 8. Kernel A/B round (2026-10-14, after this handoff)

Driver `ab.sh` (arms interleaved, order rotated per rep), scorer `abscore.py` (MRR@10 with a paired bootstrap CI
vs a base arm, recall@10 vs exact, overlap, identical-output share, p50 per run). `ours.mjs` gained `K`.
Choices made on csn1m-dev (GCSN dev queries over the 1M corpus, 3,600 queries) and the 6.9k/20k/140k dev sets;
held-out read once, aggregate only, after the choice.

Shipped (default on):
1. Code slab, CSR graph and visited bytes in 2 MB-aligned blocks with MADV_HUGEPAGE on Linux (blocks >= 4 MB;
   smaller ones 64-byte aligned). Output identical on every query. 1M dev p50: x86 1,386 -> 719 us (3 reps
   each), M3 Max equal (418 vs 417). 140k dev x86 458 -> 435. Legacy: `SS_FIX_HNSW_HUGE=0`.
2. stage1Candidates 1000 -> 250, raised to the largest stage-2 pool for k (k=10: 250, ef = max(250, 400) = 400;
   k>=27: 400). 1M dev: MRR@10 .5483 -> .5490 (+.0007 [+.0001, +.0015]), recall@10 vs exact .833 -> .842;
   k=50: MRR -.0001 [-.0004, +.0001], top-50 overlap 98.4%. 6.9k/20k/140k dev: -.0000/+.0001/+.0001 (all CIs
   cross 0). Legacy: `stage1Candidates: 1000` in vector-store.js.
Final code vs the tested arms: 0 result diffs on 3,600 queries (Mac and box); legacy switches vs old code: 0 diffs.
Combined, 1M dev p50: x86 1,249 -> 417 us, Mac 414 -> 249 us.
Held-out csn1m-ho (aggregate only, 1 run): MRR .5306 -> .5300 (-.0006 [-.0020, +.0006]), recall@10 vs exact
.832 -> .839, p50 x86 1,291 -> 428 us, Mac 415 -> 255 us.

Rejected: windowed code prefetch (8/16 ahead): Mac +41% time; x86 helps only without huge pages, hurts with them.
Level-0 re-prune to 128 (heuristic, no back-fill; mean level-0 degree is 180): MRR -.0014 [-.0026, -.0003] vs
S1=250. Re-prune at 96: worse. Tie stop (`>=`): same MRR, changes 0.6% of queries, no clear time gain.
Open: re-prune WITH back-fill: MRR -.0003 [-.0010, +.0001] vs S1=250 on Mac dev, x86 ~17% faster (412 -> 343 us).
Kept as an off-by-default switch (`SS_HNSW_PRUNE0=128 SS_HNSW_PRUNE0_FILL=1`); not adopted.

### 8b. MRR round (2026-10-14, same day): weight 1 + int8 on all stage-1 candidates + stage 1 = 1000

Read-only checks first (brute-force cascade sims on csn1m-dev: sim-int8.py (1,000 queries), sim-centre.py and
sim-depth.py (3,600 queries)):
- int8 scale: |q| p50/p99/max = 4/15/47 of 127 (81 levels used). A global p99.99 scale or a per-vector scale
  picks the same stage-2.5 pool as exact 512-d scoring -> no gain; NO reindex for item 2.
- Centring before the sign bit (bits are unbalanced: mean |p-0.5| = 0.116, corpus mean-vector norm 0.43):
  stage-1 recall .910 -> .896, MRR -0.0011 [-0.0037, +0.0012]; centred cosine for the final score -0.0136.
  Rejected; NO reindex for item 4.
- Where MRR is lost: all at stage 1 / the stage-2 cut. Brute Hamming top-M then exact: M=250 .5523, 500 .5539,
  1000 .5554, 2000 .5555 = exact 768-d search .5555. Pool sizes after stage 2 change nothing (+-0.0000).
  The product int8-scored only the adaptive pool (k=10: top 100 of stage 1) and dropped the rest.

Box A/B (x86, 3,600 dev queries per set, MRR identical on the Mac):
| arm vs prod (S1=250, W=0.8) | 1M | 140k | 20k | 6.9k |
|---|---|---|---|---|
| W=1 | +.0028 [+.0012,+.0046] | +.0016 [-.0000,+.0034] | +.0017 [+.0000,+.0035] | +.0019 [+.0002,+.0036] |
| POOL=2 | +.0016 | +.0014 | +.0015 | +.0004 |
| POOL25=2 (full-vector pool only) | +.0003 (ns) | +.0001 | +.0003 | +.0003 |
| W=1 + int8-all S1=1000 | +.0068 [+.0045,+.0094] | +.0049 (MRR diff) | +.0036 | +.0022 |
Within W=1 + int8-all at 1M: S1 1000 vs 400 +.0018 [+.0006,+.0032]; S1 600 vs 400 +.0012. Small sets: 1000 vs 400
ns. x86 p50 1M: prod 414, W=1 406, all-250 437, all-400 445, all-600 580, all-1000 847 us.

Shipped: FULL_VECTOR_STAGE_WEIGHT 0.8 -> 1 (legacy `SWEET_SEARCH_FULL_VECTOR_STAGE_WEIGHT=0.8`); stage 2 int8-scores
every stage-1 candidate (legacy `SS_FIX_INT8_ALL=0`); stage1Candidates 250 -> 1000.
Final code = tested arm on 3,600 queries (0 diffs); legacy switches + S1=250 = old prod (0 diffs).
k=50 (1M dev): +.0047 [+.0025,+.0069], p50 977 -> 1,599 us.
Full pipeline GCSN dev (run_benchmark --profile=full, LI on, Mac): MRR@10 87.00 -> 87.06 (+.0006 [-.0005,+.0019]),
1% of queries change.
Held-out (aggregate only, one run, box): csn1m-ho .5300 -> .5353 (+.0054 [+.0021,+.0090]); gcsn-ho +.0030
[+.0004,+.0057]; d20k-ho +.0038 [+.0013,+.0066]; dall-ho +.0043 [+.0012,+.0075]; advtest +.0049 [+.0019,+.0079].
Recall@10 vs exact: 1M .839 -> .967, AdvTest .805 -> .958.
Cost (x86 p50, held-out): 1M 414 -> 880 us (still below this morning's 1,291); 140k 458 -> 521; 20k 159 -> 225;
6.9k 80 -> 133; AdvTest 176 -> 236. Mac 1M dev p50 253 -> 463 us (2 interleaved runs).
Tests: vector-store, indexing, search, embedding: 4,410 pass (the full suite stalled in one idle worker; not traced). Cheaper option kept open: S1=400 gives ~3/4 of the 1M gain at 445 us.
The full-vector stage is skipped for format 'agent' (search-semantic.js), so W=1 does not touch agent output;
int8-all does.

### 8c. Pareto cut (same day): stage1Candidates 1000 -> 400

Owner: the 1000 point is too slow for its MRR; goal = Pareto knee. 1M dev x86 frontier (p50 / MRR@10):
morning 414 / .5490; W=1 406 / .5518; +int8-all S1=250 437 / .5527; S1=400 445 / .5540; S1=600 580 / .5552;
S1=1000 847 / .5558. 400 is the knee (above it: +.0012 for +135 us, then +.0006 for +267 us). Kept W=1 and int8-all.
Final code = tested S1=400 arm on all 4 dev sets (0 diffs). vs morning build, 1M dev: +.0050 [+.0030, +.0071];
x86 417 -> 444 us, Mac 248 -> 263 us. k=50 1M dev: .5512 -> .5540, 977 -> 915 us (faster than legacy).
Held-out guard (aggregate, one run, vs legacy): 1M +.0032 [+.0002, +.0063] 414 -> 455 us; gcsn +.0024 [-.0000,
+.0050]; d20k +.0023 [+.0000, +.0047]; dall +.0026 [-.0001, +.0055]; advtest +.0044 [+.0016, +.0073].
S1=1000 stays reachable by config (`stage1Candidates: 1000`): +.0018 more on 1M at ~1.9x time.
Knee check (3 interleaved runs per point, both machines, csn1m-dev, W=1, int8-all; p50 x86 / Mac, MRR@10):
S1 250 433/263 .5527; 300 428/262 .5532; 400 441/261 .5540; 500 507/303 .5544 (+.0004 ns vs 400); 600 576/325 .5552
(+.0012 [+.0004,+.0022]). Adaptive pool S1 250: 407/262 .5518. 250-400 cost the same (walk ef = max(S1, 400) = 400),
so 400 = widest stage 1 that does not widen the walk. int8-all costs ~34 us on x86, ~0 on the Mac.

### 8d. Re-prune on by default above 150k + x86 rival rescore (same day, box only; Mac busy)

Box A/B, 3 interleaved runs, vs current main (S1 400, W=1, int8-all):
- Level-0 re-prune to 128 WITH back-fill (load time, Rust): csn1m-dev MRR@10 -.0002 [-.0010, +.0004], R@10 .9389
  -> .9393, p50 447 -> 378 us (stage 1 254 -> 188), RSS -220 MB, index load 24 -> 35 s (8 vCPU). SHIPPED as the default
  when the index has > 150,000 vectors (below that the exact scan answers; the graph is not searched). Legacy:
  `SS_HNSW_PRUNE0=0`; `SS_HNSW_PRUNE0_FILL=0` = no back-fill. Parity: default = tested arm on csn1m-dev (0 diffs of
  3,600); PRUNE0=0 = old main (0 diffs); d20k-dev unchanged (0 diffs). Held-out csn1m-ho (aggregate, 3 runs):
  .5331 -> .5330 (-.0001 [-.0014, +.0011]), R@10 .9381 -> .9379, p50 442 -> 372 us.
  Committed .node binaries are not rebuilt (as for the earlier Rust commits); release CI builds them.
- Walk floor 300 (S1 = EF = 300): -.0008 [-.0017, -.0001], p50 -13%. REJECTED (significant MRR loss).
- Half the full-vector head (POOL25=0.5): MRR -.0001..-.0003 (all ns) on 5 dev sets, p50 -8..-17%, but recall@10 vs
  exact -3 pp (1M .939 -> .909, AdvTest .912 -> .880). REJECTED: a faster read is the better fix (below).
- Full vectors resident in RAM (SWEET_SEARCH_EMBEDDING_CACHE_MAX_VECTORS=2000000, identical output): p50 20k 175 -> 124,
  AdvTest 192 -> 137, 140k 459 -> 399 us, 6.9k unchanged (already resident); RSS 140k +460 MB. NOT SHIPPED (RAM).
  Micro-bench (AdvTest, x86): stage 3 via ss_full_dots = 71 us for 30 ids, 123 us for 60; the id seek alone 24 us;
  rows are ~4 KB (embedding + text + metadata), one page each. Plan item #7 (node-ordered f32 file, mmap) would
  remove ~50 us/query on every index > 16,384 vectors; needs an append path for incremental updates and costs
  3 KB/vector of disk. Owner decision pending.
- Profile (AdvTest x86, cpu-prof): _extensionDotScores 36% self, native stage 1 21%, int8Stage 9%.

x86 rival rescore with the shipped build (held-out, our arm 3 runs tonight; rival runs 13-14 Oct, same box and
binaries; score4b.py; ratio = rival p50 / ours at the first sweep point reaching our MRR@10):
  csn1m-ho  ours 372 us .5330: usearch_i8 x2.39, faiss_sq8_refine x3.08, faiss_flat M64 x3.79, hnswlib M64 x5.34,
            binflat x6.44; bin_cascade / usearch_b1 never.
  dall-ho   ours 457 us .7881: binflat x1.07, hnswlib M64 x3.70, sq8 x4.08; 8 configs never.
  d20k-ho   ours 178 us .8220: binflat x1.02, RaBitQ-flat x2.05, sq8 x2.56, flat M32 x2.63.
  advtest   ours 191 us .4731: RaBitQ-flat x2.15, binflat x2.30, sq8 x2.79, usearch_i8_rescore x3.28.
  gcsn-ho   ours 96 us .8359: binflat x1.34, RaBitQ-flat x1.39, hnswlib M64 x1.82.
No rival is faster than us at our MRR on any x86 set; binflat ties at 20k and 140k (within box noise, H3).
Mac not rerun (owner's machine busy). Backups: v4/<set>/scored4.pre-1014b.json; ours-final-r{1,2,3}.json = ab-ho4-fin.
