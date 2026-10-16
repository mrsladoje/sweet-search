# HNSW / binary-cascade paper — plan and handoff (v3)

**Version 3, 2026-10-15.** v2 applied Astra's first critique; v3 applies the second (section 17 maps
each point to its fix). No benchmark has run under this plan yet. After the review rounds, a new Claude Code session executes this file as it is.

**For:** a new Claude Code session. Read all of it before you start. Then read `HANDOFF-v5.md`
(log §15; its §0 decision table is **replaced** by section 4 of this file for all remaining work),
`HANDOFF-v4.md` §2 and §8, the wiki artifact https://claude.ai/artifact/M1SCsePXYngJba19gvcnve (§09,
§13 rival playbook, §14 paper strategy; read it with the Artifact tool, `action: "read"`), the MaxSim
plan `eval/maxsim-bench/PAPER_PLAN.md` §4–5 (same harness rules), and the memory notes
`project_hnsw_bench_v4_handoff.md`, `reference_maxsim_aws_bench.md`,
the memory note on keeping cloud-account details out of this public repository, and `feedback_heldout_discipline_strict.md`.

**Owner decisions still open (ask at the step that needs it):** (1) models (S0); (2) BEIR sets (S0;
proposal Quora + FiQA, NQ only after the pilot); (3) a fresh code query set or exploratory-only
code results (S0); (4) shared-index throughput in or out (S0); (5) vCPU and GPU limit requests (S0);
(6) the go for the paid pilot (S3a) and then for the full run with a ceiling (S3b); (7) the maximum
acceptable losses δ and δ_K (S0, before any output-changing work); (8) the Zenodo upload (S12); (9)
every commit, push, tag, quota change, reindex or release (rule 13).

**S0 decisions (owner, 2026-10-15):** (1) three models: CodeRankEmbed, jina-embeddings-v2-base-code,
bge-base-en-v1.5; (2) BEIR Quora + FiQA, no NQ; (3) no fresh code set: all code results exploratory;
(4) shared-index throughput out; (5) vCPU limit request 64 → 128 (standard, on-demand) approved; no
AWS GPU request: embeddings run on a RunPod GPU (paid; S3a go still needed); (7) δ = 0.005, δ_K =
0.001; short track plus **H2 (ties, dev only)** added back.

**Later owner decisions (2026-10-15/16):** re-embed every set with every model (RunPod GPU, done); S4 + S5 go
with a **$350 ceiling** for the full HNSW cloud run; vCPU 256 → 512 requested (300 granted so far), shared with
the MaxSim paper; a bench-only IAM key (`hnsw-bench`) for HNSW launches. **Local scope (box + Mac, 10-16):
reduced** — the frozen operating points of the primary comparisons only (ours vs the best rival of each family
at the 3 frozen recall fractions, (A) and (B)), all 7 sets, one model per set kind (CodeRankEmbed for code,
bge-base-en-v1.5 for BEIR), R = 5, plus memory and cold start. Paper wording: local rows are "secondary
platforms, reduced grid"; the full grid runs on the three AWS CPUs.

**S1 status (2026-10-15, done on the box and the Mac; nothing committed).** Harness in `paper/` (formats:
`paper/DESIGN.md`). Sets: 7 set definitions (`sets.py`; AdvTest split 60/40 seed 42, cluster = query id; dev
and held-out code queries share 198 of 240 repositories). Quality: `gt.py`, `quality.py`, `stats.py`,
`fixtures_quality.py` 20/20, `check_irmeasures.py` max diff 0.0 on dev. Harness: `rivals5` (+ `rivals5-ext`
for DiskANN/SVS: MKL ILP64 and FAISS's OpenBLAS cannot share a binary), `py5.py` (ScaNN), `ours5.mjs`,
`run.py`, `jobs.py`, `check_complete.py`, `plan.py`, `grid.py`, `workload.py` → `WORKLOAD.md`;
`test_harness.sh` 10/10 on both machines; smoke plan complete on both. (A) shared path: bit-identical to
the addon (`bitident.cpp`) at code/int8 widths 512/512, 768/768, 512/768, on x86 and ARM. Adapters correct
on 6.9k dev: 14 FAISS/hnswlib/USearch families (box + Mac), DiskANN, SVS f32, ScaNN (box). Awaiting
platform: SVS LVQ/LeanVec (`intel`), DiskANN and ScaNN on ARM (Graviton; DiskANN needs a source patch),
AVX-512 / SVE builds. Phase K (dev, box, 3–5 interleaved rounds, all outputs identical): K1 (native query
step) no gain (1M 182 = 182 µs) → dropped; K2 walk visited-byte prefetch no gain → dropped; K3 int8 rows
mapped from the index file: −487 MB anonymous at 1M, same speed, load 1.93 → 1.69 s → kept; K4 widths as
build parameters → kept (12-word fast path not done: 768-bit codes 141 vs 83 µs at 6.9k); K5 in the
harness. K3/K4: 4,667 box tests + 3 new tests pass; ARM parity identical. H2 (gcsn dev): tie runs split at
the C = 400 cut on 97.8% of queries; tie order changes the retained set on ~28%, top-10 documents on ~1.6%,
MRR@10 range 0.0001 over 5 orders. k_v gcsn/CodeRankEmbed = 36 (re-embedded vectors, 10-16: see set.json). S5a on
`amd` (c8a, Zen 5, 10-16): K6 AVX-512 VPOPCNTDQ Hamming (scan + walk): v1 (one horizontal add per code) identical lists
but AMD +1.6% slower, Intel −6 to −7% → reworked; v2 (8 codes per transposed reduction) identical lists in every
round pair, AMD dall scan 287.0 → 278.6 µs and csn1m walk 270.4 → 241.8 µs, Intel (c8i) dall 474.6 → 442.2 µs and
csn1m walk 352.3 → 336.2 µs (AVX-512 off → on, 3 interleaved rounds, medians) → kept (`SS_HNSW_NO_AVX512=1` turns
it off); parity: paper/phasek/k6_parity.py (random, 0/512, single bit, tails) on Intel and AMD;
K7 skipped by its rule (perf, dall scan C 400: Hamming scan 54% of samples, int8 dot 6%: not dot-bound). K8 on `arm` (c8g,
Graviton4): result lists byte-identical to x86 (gcsn and dall dev scan, our own build on each CPU); perf: scan 50%,
int8 sdot 4.7%; SVE vector length on Neoverse V2 is 128 bits (= NEON), so no SVE2 path → K8 closed, no change. Findings for the owner: d20k/dall
distractor texts do not reproduce the stored vectors; stored CodeRankEmbed vectors mix Metal bf16 documents
and ORT INT8 queries; builds per CPU vs once.

**Short track (default unless the owner adds items back):** no shared-index throughput, no NQ, no
exhaustive held-out sweeps, no optional mechanism studies (H1, H2, the page-policy 2 × 2 arms; H3 and
H4 are then discussed only from the main runs), code results exploratory (no fresh code set). The venue is the owner's choice.

---

## 1. Research question and claim

**Research question (narrowed in v3).** **Which candidate generators give the best latency and task
quality under a common rescoring procedure**, and how does the answer change with corpus size and
CPU? A secondary, descriptive dev result: what the int8 screen adds, from identical candidate lists
with and without it (the H = C arm of comparison A).

**Main experiment: the common-rescoring comparison (A).** Every candidate generator (our binary HNSW
walk, our exact binary scan, FAISS binary HNSW, FAISS binary flat, USearch b1, hnswlib and FAISS HNSW
on float32, FAISS RaBitQ, ScaNN, DiskANN) feeds **the same** int8 screen and the same full-vector
rescoring, with the same codes and the same vector precision, at **fixed, matched budgets**: a
declared grid of (C, H) pairs with C ≥ H (C candidates → int8 screen keeps H → full-vector rescoring
of the H). Every generator is reported at every budget pair; nothing is selected per generator in
(A). Independently optimised operating points are a separate report (B, "as shipped").

**Timing boundary (both comparisons):** from the query float vector in memory to the top-10
document list: query conversion (normalisation, sign bits, int8), candidate generation, candidate
transfer between stages, int8 screen, full-vector rescoring, document aggregation. Embedding the
query text is excluded for every system.

**The claim we can make now** (narrow; use it unless the results support more):

> On the tested CPUs, datasets and models, under a common rescoring procedure, [ranking of the
> candidate generators from (A)]; and, as shipped, within the declared quality margin, the tested
> binary cascade answered single queries faster than the tested graph and partition configurations
> from 7k to 1M vectors, with the losses reported per CPU.

**Hypotheses** (exploratory; in the short track they are reported only from data the main runs
produce, or dropped): (H1) a size crossover where a flat binary scan stops beating graph generators —
controlled sampling (section 9); (H2) Hamming ties at the stage-1 cut change which candidates survive
(scoring every stage-1 candidate removes only the *later* int8 cut effect; it cannot recover
candidates lost at the stage-1 cut) — tie-order randomisation on dev; (H3) page size explains part of
the walk's cost inside a VM — page-policy arms (section 5 item 12); these arms cannot show that
virtualisation itself causes the difference (that needs bare metal: a stated limit); (H4) graph
recall stalls on near-duplicate code — no controlled experiment defined: exploratory only.

**Do not claim:** "fastest ANN", "state of the art", any "first", that nobody has compared these
methods at task quality (Iceberg, Operational Advice for Dense and Sparse Retrievers, Bang for the
Buck and Recall What Matters cover parts of that space), "equal quality" (say "within the declared
quality margin"), GPU results, end-to-end speedups, results beyond the tested sizes, dimensions
other than 768, or generality beyond the tested models and tasks.

## 2. Rules (read before any run)

1. **Kernel freeze.** The kernel may change only in phase K (section 7), which ends before the dev
   selection (S5b). At S7 it freezes at one commit, the **paper commit** (tag
   `hnsw-paper-freeze-YYYYMMDD`). Every paper number comes from that commit.
2. **One freeze for everything.** At S7 freeze together: the kernel, the build code, every rival
   adapter, build flag and binary hash, every operating point (`shortlist.json`), the analysis
   scripts, set definitions, splits, evaluation unit, quality fractions, δ, the repetition plan,
   the thread counts. Record all of it in `FREEZE.json` (commit hashes and SHA-256 per file).
3. **Held-out discipline.** Before the freeze use dev data only. You may *build* held-out
   artefacts (embeddings, ground truth, indexes), but compute or read no held-out quality or timing
   before the freeze. Never inspect per-query held-out rows.
4. **Previously examined data.** The held-out aggregates of the GCSN-based code sets (6.9k, 20k,
   140k, 1M) and AdvTest with CodeRankEmbed were read at milestones on 2026-10-13 to 10-15 while
   choices were made on dev. Those queries stay "previously examined" on every CPU and with every
   model; their results are **exploratory, not confirmatory**. The four GCSN sizes share one query
   set (`build-1m.mjs:55` copies the splits): they are scale conditions, not four confirmations.
   Confirmatory evidence: the BEIR sets, and the fresh code set if the owner takes it (section 9).
5. **One benchmark per machine.** Never run two matrices, or a matrix and a build, on one machine
   at the same time. Runners hold a lock. Build-cost numbers come from isolated runs only.
6. **The Mac:** heavy work only in a quiet window (two readings 30 min apart, 5- and 15-min load < 5)
   or a window the owner gives. **The Hetzner box** is ours.
7. **Paid machines: prepare, then stop and ask** before each launch step (S3a pilot, S3b full run).
   GPU rentals and API models are paid too.
8. **AWS:** rule 8 of `eval/maxsim-bench/PAPER_PLAN.md` applies unchanged (us-east-1 only; never touch
   the production region). Tag every resource `Project=hnsw-bench`.
9. **Nothing about the AWS account goes into git** (public repository). Scripts read account values
   from `aws/env.local` (git-ignored). Before any commit run the grep of the MaxSim plan rule 9.
10. **Account changes are recorded and undone** in `~/.ss-eval/maxsim-cloud/original-state/RESTORE.md`.
11. **No product reindex or release** until the owner says tuning is done.
12. **Prose:** ASD-STE100 Simplified Technical English, conclusion first (global `CLAUDE.md`).
13. **Git, quotas, reindex, release: only with the owner's explicit approval.** Ask before every
    commit, push or tag (then commit only your own paths, `git commit -- <paths>`), every account or
    quota change, any product reindex and any release.

## 3. What exists

| Asset | Where |
|---|---|
| Kernel, shipped state | main after `9a571b17`: format-3 index file, f16 vector file, fused native cascade, pruned level 0, early stop. 1M x86 dev since phase A: p50 215 → ~170 µs, load 35 → 1.8 s, anonymous RAM 2.65 → 1.52 GB, vector data 9.2 → 2.8 KB/vector (+ SQLite copy) |
| Code sets (CodeRankEmbed 768-d) | `gcsn` 6,918, `d20k` 20,000, `dall` 140,449, `csn1m` 1,004,739 (one GCSN query set: dev 3,600, held-out 2,400); `advtest` 21,731 (3,000 queries, no split). Box `/root/hnsw-x86/sets`, Mac `~/.ss-eval/hnsw-bench` |
| Rival harness | `rivals.cpp` (FAISS 1.15.1, USearch 2.26.4 + NumKong, hnswlib; 19 configs in `run4.sh`), `prep.py`, `score4.py`, `closest.py`, `front.py` |
| Our harness | `ours.mjs`, `ab.sh`, `abscore.py`, `split.mjs`, `oursmem.mjs`, `buildtime.mjs`, `tput-ours.mjs` (one index per worker: unusable) |
| Known defects (Astra, checked) | binary cascades in `rivals.cpp` rescore at most 150 candidates (`CASCADE_R`) with no int8 stage; the harness keeps a float32 corpus copy beside each library's index (`rivals.cpp:77`); `prep.py` ground truth in float32 with no tie rule; `score4.py` drops duplicate documents *after* the 10-vector cut (fewer than 10 documents) and picks rival points by point estimates on held-out; `run4.sh` continues after `FAILED`; each query timed 3 times back to back |

## 4. Quality contract (blocking; replaces HANDOFF-v5 §0 "CI contains 0")

**Evaluation unit and output contract.** The unit is the document. Code sets: a document = a
function; chunks map to it by `chunkDoc`. BEIR: one vector per document. A document's score = the
maximum score of its vectors; its rank follows that score. Every system returns its **actual
retained vector list** with scores: in (A) the H rescored vectors (H ≥ 10; budgets with C < H are not
in the grid); in (B) the library's top k_v vectors after its own refine step, with k_v fixed per set
on dev before the freeze (the smallest k_v at which the exact list yields 10 distinct documents for
≥ 99.9% of dev queries; refine depth ≥ k_v). The shared aggregation code turns every list into
documents and cuts at 10. A list with fewer than 10 documents counts the missing ranks as
non-relevant; its frequency is reported per system. Our cascade in (B) runs with the requested k_v,
so its adaptive budgets follow k_v: this is a new workload, and the v4 speed ratios do not describe
it.

**Ground truth = exact document ranking.** For every document, the maximum cosine of its vectors over
the **whole corpus** (stored float32 vectors, normalised in float64, float64 accumulation); documents
ranked by that score, ties by the lower document id; top 100 documents kept. Written by `gt.py`
(new; replaces `prep.py`), SHA-256 in the manifest. Recall@10 of vectors uses a separate exact top
100 of vectors (same arithmetic, ties by vector id). Per-model contract (stored precision,
normalisation, f16 rounding of our vector file) in `MODELS.json`.

**BEIR self-matches:** a document whose id equals the query id is removed, for exact and approximate
results alike (BEIR's `ignore_identical_ids` default; it matters for Quora). The removal happens
before the cut at 10; systems therefore return k_v + 1 vectors on Quora.

**Metrics.** Primary task quality: MRR@10 (code sets), nDCG@10 (BEIR). Secondary, separate experiment
(descriptive, never a selection rule): recall@10 of vectors against the exact top 10. Cross-check our
scorer against `ir_measures` / `pytrec_eval` on every set (identical to 1e-9).

**Fixtures** (`fixtures_quality.py`, plain Python, no shared code with the scorer): duplicate
documents in a list, fewer than 10 documents, ties in score, a query with no relevant document, a
self-match, f16 rounding that swaps two neighbours, a document whose best vector is outside the
exact top 100 vectors. Scorer, ground truth and aggregation pass all before S3a.

**The maximum acceptable loss comes first (owner, at S0, before any output-changing work).**
Proposal: δ = 0.005 absolute MRR@10 / nDCG@10 for the paper comparisons, and δ_K = 0.001 for kernel
items that change output (phase K). These are judgements about what loss matters to a user, stated
in the paper with their reason; they are not derived from the data.

**Power, then the sets.** On dev, from the paired per-query differences of each **primary pair**
(below), with repository clustering on code sets, estimate the power of the held-out test at δ for a
true difference of 0. A pair with power < 80% gets descriptive results only (no "within margin"
statement), or more queries if the set has them. Report the power per pair.

**Selection of operating points in (B) (dev only).** For a retained fraction f ∈ {0.98, 0.99, 0.995}
of exact-search quality: per query, d_q = Q_sys,q − f · Q_exact,q. A point qualifies when the one-sided
97.5% lower bootstrap bound of mean(d) is ≥ 0 (cluster bootstrap over repositories
for code sets, over queries for BEIR; 10,000 resamples, seed 42). The operating point = the fastest
qualifying point on dev **with the final binaries on that CPU** (S5b). Frozen in `shortlist.json`.
Held-out measures the frozen points; a point that misses on held-out is reported as missed.

**Primary comparisons, predeclared before the freeze:** per CPU and confirmatory set (BEIR; the fresh
code set if taken), at f = 0.99 in (B): ours against the fastest rival at that point. Test:
non-inferiority of ours against that rival at δ, one-sided α = 0.025 (the lower bound of a two-sided
95% interval). Holm correction over all primary comparisons. Everything else is descriptive (no
multiplicity claim). If an equivalence statement is wanted: two one-sided tests at α = 0.05 each,
which corresponds to a two-sided 90% interval inside ±δ; say "equivalent within ±δ (TOST, α = 0.05)".
Wording otherwise: "within the declared quality margin δ".

**Negative results stay.** A configuration with poor recall is a result. Investigate low recall
for harness errors; never drop a valid point.

## 5. Harness repairs (blocking before any paid run)

1. **Job identity:** job key = SHA-256 over: set manifest (corpus membership, frozen independently
   of any model-specific vector deduplication), query split, model manifest (model and tokenizer
   revisions, prompts / prefixes, pooling, truncation length, inference precision), comparison type
   (A or B), system + full configuration (build and search parameters, budget pair), build seed,
   serialised-index SHA-256, binary hashes, all options, round, instance ID. **The file name is the
   job hash** (`<machine>/<set>/<model>/<jobhash>.json`, with the key fields inside), so two
   operating points can never overwrite each other. Reuse only on a full key match and a valid file;
   otherwise move to `stale/`.
2. **Fail loudly, against an explicit job list:** the runner writes `jobs-expected.json` (every job
   key of the step) before it starts; `check_complete.py` compares results with that list, and any
   failed system or missing job → non-zero exit; scoring refuses to run until it passes.
2b. **No result-dependent stopping in held-out runs.** Held-out runs execute exactly the frozen job
   list. The current sweep stops (`STOP_US` latency limit and recall stops, `rivals.cpp:287`) stay
   for dev sweeps only and are disabled (and checked off) in held-out mode.
3. **No back-to-back repeats:** per round, one pass over all queries in a seeded random order
   (seed 42 + round), each query timed once; warm-up 500 dev queries per process.
4. **Keep every request timing.** Tail percentiles (p95, p99) come from all individual request
   timings, never from per-query medians. Per-query medians are a separate statistic, named so.
5. **One rivals binary per machine** from the same `rivals.cpp` and pinned library commits, each
   library at its best SIMD build on that CPU (`-O3 -march=native`; FAISS opt level avx512 /
   avx512_spr on Intel, avx512 on Zen 5, sve on Graviton; USearch / NumKong dispatch recorded). Record
   `lscpu`, compiler, flags, commits, binary SHA-256.
6. **Pinned dependencies:** Python lock files with hashes, git commits for C++ libraries,
   `Cargo.lock`, `package-lock.json`; pinned binary packages with hashes where no source build
   exists (SVS, section 8).
7. **Memory (serving vs inputs).** Builds run in their own process and serialise the index. Timing
   and memory runs are fresh **query-only processes** that load the serialised index and keep the
   original vectors only when the method itself needs them for rescoring (counted then). Benchmark
   inputs (query vectors, ground truth) are counted separately. Report per system: construction
   peak RSS (build process), loaded memory, memory after the timed rounds, each split into
   anonymous and file-backed (`/proc/self/smaps_rollup`; macOS `footprint`); disk = bytes of every
   file the serving process opens.
8. **Load time and cold start:** fresh process, `drop_caches` before load (Linux; macOS `purge`):
   load time, first-query latency, the first 100 queries.
9. **Shared-index throughput (owner decision S0).** The current `HnswSearcher`
   (`hnsw_search.rs:631`) holds index data and per-query state in one object, with `&mut self`
   search. To measure concurrency: split into shared, read-only index data (codes, CSR, int8, vector
   file map) behind `Arc`, and per-thread query state (visited bytes, heaps, scratch). Estimate
   1–3 working days with tests. Without it, the paper reports single-query latency only and states
   the limit. A lock around the current object is not acceptable (it serialises).
10. **Build cost:** isolated runs, all physical cores for libraries that build in parallel; ours is
    single-threaded JS (stated). Record build attempts and compute used per library (tuning budget,
    section 8).
11. **Harness overhead:** our timing includes Node and the JS around the native calls; keep it (it
    is against us) and add a native-only timing of the same cascade.
12. **Page policy, two comparisons.** (a) *As deployed:* THP `madvise`, every system as shipped (ours
    requests huge pages and 2 MB alignment through `madvise`; `hnsw_search.rs:13`). (b) *Controlled,
    for H3 only:* ours in four arms (alignment on/off × huge pages on/off; today's switch changes
    both together) and every rival under THP `always` (optional; cut in the short track). Measure actual backing per process
    (`AnonHugePages` from `/proc/<pid>/smaps`) and record alignment; dTLB-miss counters where the
    instance exposes them (`perf stat`), otherwise say they were not available.
13. **Failure tests on purpose** (`test_harness.sh`, Mac, before S3a): interrupted output, missing
    queries, failing system, changed binary (→ `stale/`), resume after a stop.

## 6. Hardware

| Name | Type | CPU | Cores × threads | Vector units | ~$/h |
|---|---|---|---|---|---|
| `intel` | c8i.4xlarge | Intel Xeon 6 (Granite Rapids) | 8 × 2 (SMT) | AVX-512 (VPOPCNTDQ, VNNI), AMX | 0.75 |
| `amd` | c8a.4xlarge | AMD EPYC 5th gen (Zen 5) | 16 × 1 | AVX-512 (VPOPCNTDQ, VNNI) | 0.75 |
| `arm` | c8g.4xlarge | AWS Graviton4 (Neoverse V2) | 16 × 1 | NEON, SVE2 | 0.64 |
| `build` | memory-sized from the pilot (S3a) | — | — | — | — |
| `gpu` | g6.xlarge (L4) or a RunPod GPU | — | — | — | 0.8 |
| M3 Max (Mac) | — | Apple M3 Max | 12 P + 4 E | NEON | — |
| EPYC box (Hetzner CCX33, KVM) | — | AMD EPYC Milan | 8 vCPU | AVX2 | — |

Single-thread timing pins to one physical core. Every table names cores and threads. A second
instance per AWS type is a **replication**, not proof of a different host; record the host ID from
instance metadata where AWS exposes it, and say what it shows. Record CPU flags.

**Limits:** 64 standard vCPUs, shared with the MaxSim work; GPU limit 0. Owner decides the requests
at S0.

## 7. Phase K — kernel work, finished before dev selection

Each item needs one sentence of mechanism and a measurement that shows the cost it removes.
Decision rules: identical output → parity 0 diffs on all dev sets and a gain above the A/A noise
band in 3 interleaved rounds on `csn1m-dev` and `dall-dev`; output-changing → the section 4
non-inferiority test on dev (no "CI contains 0").

| # | Item | Output | Mechanism / evidence |
|---|---|---|---|
| K1 | One native call: query int8 encode + upper-level descent + ef rule inside `cascadeStage1` | identical | JS around native calls = 11 of 52 µs at 6.9k, 14 of 169 µs at 1M (split, 10-15) |
| K2 | Prefetch head full vectors during int8 (B2); next node's visited byte / offsets (W2/W4) | identical | stage 1 at 1M is memory-latency bound (124 µs) |
| K3 | int8 rows from the index file (mmap) instead of an anonymous copy (C4) | identical | −~490 MB anonymous at 1M; risk: 400 random rows per query |
| K4 | Code and int8 widths as parameters (512 or all dims) with fast paths for 12-word codes | identical at 512 | other models (section 9); today both stages use the first 512 dims (`search-semantic.js:287`) |
| K5 | Stage-1 size below 150 for the bench sweep only | bench only | curve to the low-quality end |
| K6 | AVX-512 VPOPCNTDQ Hamming for scan and walk (one 512-bit code = one zmm) | identical | the ≤150k scan is compute-bound (140k: 250 µs stage 1) |
| K7 | AVX-512 VNNI int8 dot — **only if a profile shows the int8 stage is dot-bound** | identical | the x86 widened-query kernel gave no gain (HANDOFF-v5 §15), so the stage may be bound elsewhere (gather, sort) |
| K8 | Graviton4: NEON paths (sdot, fcvtl) parity and timing; SVE2 only if a profile shows a gap | identical | ARM parity also owed from the Mac |

**AVX-512 parity tests** (K6, K7): signed values at the int8 extremes (−128 is never produced; test
−127 and 127), lengths not a multiple of the vector width (tails), the horizontal reductions, and the
final result order with ties, against the scalar kernel, on random and adversarial inputs; then 0
diffs on every dev set.

Order: K on the box first (K1–K5); K6–K8 need the target CPUs and run in S5a (C0, time box 6 hours).
Phase K ends before S5b. Cut (owner, 10-15): C1, W13/B5 (native parallel build), W7, W9, W10, W11, W12,
D3, phase E.

## 8. Systems

**Two comparisons.** (A) *Common rescoring* (section 1): each generator returns its top C
candidates; the shared int8 screen (same int8 codes) keeps H; the shared full-vector rescoring (same
f16 vectors, float64 sums) orders the H. Fixed budget grid, the same for every generator, declared in
S1 from dev (proposal: C ∈ {100, 200, 400, 1000} × H ∈ {50, 100}, plus H = C as the "no int8 screen"
arm); always C ≥ H ≥ 10. Generators with a search-effort knob (ef, nprobe, L) run at the smallest
effort that returns C candidates and at one declared higher effort. Implemented once in `rivals.cpp`
(a C++ copy of our int8 and f16 kernels, checked bit-identical against the addon on dev). (B) *As
shipped:* each library's own search and rescoring options, operating points selected on dev
(section 4).

| Library | (B) configs | Build grid (dev) | Search grid |
|---|---|---|---|
| FAISS | HNSW Flat, HNSW SQ8 + refine, binary HNSW + refine, binary flat + refine, RaBitQ flat / IVF / HNSW + refine, IVF-PQ fast-scan + refine, exact | M ∈ {16, 32, 64}, efC ∈ {200, 800}; nlist ∈ {√n, 4√n} | efSearch, nprobe, k_factor_rf; refine depth swept (no fixed 150) |
| hnswlib | HNSW f32 | M ∈ {16, 32, 64}, efC ∈ {200, 800} | ef |
| USearch | f16, i8, i8 + rescore, b1 + rescore | M ∈ {16, 32, 64}, efC ∈ {200, 800} | expansion_search; rescore depth swept |
| ScaNN | brute force (< 20k), AH without partitioning (< 100k), tree + AH + reorder (≥ 100k), per its guide | leaves ∈ {√n, 2√n}, SOAR on/off | leaves_to_search, reorder |
| DiskANN (in-memory Vamana, official C++) | f32 | R ∈ {32, 64, 96}, L ∈ {100, 200}, α = 1.2 | L_search |
| Intel SVS | Vamana + LVQ / LeanVec, **`intel` only**, from the pinned binary package (its compressed components are proprietary and Intel-only); on `amd` and `arm` declared unavailable | degree ∈ {32, 64} | search window |
| ours | production cascade | M 64, efC 800 | S1 ∈ {50 … 1000} |

**Tuning budget, recorded:** per library and set: number of builds, number of search settings,
build compute (core-hours), dev timing compute. Reported in an appendix table; a library that got
less budget is named.

Engines (Elastic BBQ, Qdrant BQ, Weaviate, Milvus): related work and limits only.

## 9. Models, sets and controlled experiments

- **Models (owner picks at S0).** Proposal: CodeRankEmbed (current), jina-embeddings-v2-base-code
  (code), bge-base-en-v1.5 (text). All 768-d (stated limit; dimensions other than 768 are out). Our
  use of the first 512 dims of CodeRankEmbed is an **empirical choice**: its model card and paper
  describe contrastive training, not nested-dimension training. Per model on dev: code width and
  int8 width ∈ {512, 768} (K4), frozen at S7.
- **BEIR (owner picks):** Quora (523k docs; 4,000 held-out queries at 40%) + FiQA (57k; ~259 held-out,
  descriptive unless δ allows). NQ (2.68M) only if the S3a pilot shows the embedding and our build
  fit the budget. Test queries split 60/40, seed 42, before any run.
- **Fresh code set (owner decides, S0).** For confirmatory code results: a CoIR code-retrieval task
  never used here (candidate: CodeSearchNet docstring → function test queries from repositories
  disjoint from GCSN and from `csn1m`), split 60/40 seed 42. Without it, all code results are
  exploratory (rule 4).
- **AdvTest:** split 60/40 seed 42 now; previously examined (rule 4).
- **H1 size crossover, controlled sampling (optional; cut in the short track):** nested random
  subsets of one corpus (Quora and `csn1m`: 10k, 30k, 100k, 300k, full; seed 42), each subset
  containing every relevant document of the evaluated queries (check first that they fit the
  smallest subset; otherwise start at the smallest size that holds them), same queries, same model.
  Membership changes with size (more random distractors), so this is controlled sampling, not fixed
  composition; say so.
- **H2 ties (optional; cut in the short track):** at the stage-1 cut, rerun dev with the tie order
  randomised (5 seeds); report the spread of MRR and of the surviving candidate set; dev only.
- **H4 duplicates:** exploratory only (no controlled experiment).
- **Shared query identities:** every analysis that pools sets, sizes, models or CPUs keeps query
  ids and bootstraps queries (and repositories) once; never treats configurations as extra samples.
- **Licences:** CodeSearchNet, CodeXGLUE AdvTest, GCSN sources, CoIR task, BEIR sets, models →
  `LICENSES.md` before release.

## 10. Uncertainty and repetitions

Four components, reported separately: between queries (bootstrap); between timing rounds (R
rounds); between machine instances (two per AWS type; descriptive with n = 2); between independently
built indexes (two builds with different seeds for every graph system at its operating points on
`csn1m` and Quora; descriptive).

**Repetitions from a pilot, for the reported statistic.** After phase K ends (S5a), with the
**final binaries**, an A/A run (same build as two arms, 5 rounds) on every machine that reports
numbers: the three AWS machines in S5b, the box and the Mac in S6. Each machine gets its own R by the
rule below. For the main statistic (ratio of median latencies at an operating
point) estimate its standard error per round count. Choose R so that the 95% interval half-width of
the ratio is ≤ 2% where the noise allows; cap R at 10. If the cap prevents that, report the wider
interval; never claim a precision the data does not have.

## 11. Execution sequence

**S0 — owner questions:** models; BEIR sets; fresh code set; throughput in/out; δ and δ_K; the
short track or items added back; limit requests (the owner approves each request; then record it
in RESTORE.md).

**S1 — box + Mac, free:** section 4 tooling (`gt.py`, aggregation, scorer, fixtures,
`ir_measures` cross-check, selection and head-to-head tests, power analysis); section 5 repairs and
`test_harness.sh`; the common-rescoring path in `rivals.cpp` with its bit-identity check; ScaNN,
DiskANN, SVS adapters (x86 on the box, arm on the Mac); K1–K5 on the box; AdvTest split; the
**workload table** (every build and every timed run: models × sets × systems × builds × points ×
rounds × machines × conditions) with an estimate per row; `aws/` scripts (bootstrap, run, launch,
collect, teardown; memory-admission scheduler for builds; idle watchdog 60 min; 72-hour stop;
terminate on finish). *Exit:* every fixture and failure test passes; every adapter that can run on
the box (x86 AVX2) or the Mac (ARM) returns correct results on the 6.9k dev set; adapters that need
another platform (Intel SVS: `intel` only; AVX-512 builds) are listed as **awaiting platform** and
are checked in S3a; the workload table exists.

**S2 — bundle and data:** code bundle of HEAD; code sets; manifests; upload.

**S3a — pilot (owner go, small ceiling ~$15):** `gpu`: embed 50k Quora documents and 50k code
functions with each new model (throughput, output size); `build` candidate: one 1M build of ours and
of each rival family (time, peak memory, size); a short `intel` instance (≤ 2 hours): the
awaiting-platform adapters (SVS package install and correctness on the 6.9k dev set, AVX-512 rival
builds), no timing. From it: the cost and time of every row of the workload table. **S3b — launch report and the go** with a spending ceiling for the full run.

**S4 — embeddings and builds:** `gpu`: models over all sets; ground truth; splits. `build`: every
build in the grid, admitted by a memory budget (peak RSS from the pilot); build-cost numbers from
isolated runs. No held-out number. *Exit:* every index in S3 with its manifest; `gpu` terminated.

**S5a — kernel C0 on `intel`, `amd`, `arm` (dev):** K6–K8 with parity tests (a noise band from a
short A/A run on the pre-C0 build decides the A/Bs only). Phase K ends here. **S5b — dev selection with the final binaries** on all three AWS machines: the
A/A run → R per machine; the full dev matrix of (A) and (B); operating points per fraction →
`shortlist.json` per machine; power per primary pair at the owner's δ. Terminate the machines.

**S6 — dev check on the box and the Mac** with the final binaries (Mac only in a quiet window):
parity, the A/A run → R per machine, the selection on these two machines. If the Mac stays busy, the owner decides whether to
freeze without it.

**S7 — freeze:** parity per platform; product GCSN dev MRR unchanged; the primary comparisons and
their power recorded; `FREEZE.json`; then ask the owner to approve the commit, tag and push.

**S8 — held-out, once, unattended:** the frozen operating points for (A) and (B) on every set ×
model × CPU, R rounds, memory, load, cold start, the page-policy arms, throughput if in; replicas;
the box; the Mac in a quiet window. Exhaustive held-out sweeps are out in the short track. *Exit:* `check_complete.py` passes; no paid machine running.

**S9 — analysis (Mac):** per CPU and set: time at each fraction with CIs; head-to-head tests; the
generator comparison (A); memory, disk, load, build; the hypotheses that the runs support; where
we lose (main text); tuning-budget table. `RESULTS-paper.md` with sample sizes, seeds, R, noise.

**S10 — paper draft; S11 — release kit** (vectors, splits, qrels, ground truth, harness, "add a
system" guide, one command per table, a small example under 10 minutes on a laptop); **S12 —
Zenodo** (owner); **S13 — teardown and restore.**

## 12. Schedule

No end date is committed until the S3a pilot has measured the workload. Working estimate: S1 3–4
working days (the common-rescoring path, three new adapters, the quality tooling and the harness
repairs dominate; +1–3 days if throughput is in); S3a–S4 1–2 days; S5–S7 1–2 days; S8 1 day; S9–S11
2 days. Short track (the default): about 7–9 working days from the go; each item added back costs
more (throughput +1–3 days, NQ and the fresh code set by the pilot's numbers). Do not cut fairness
controls (section 4, section 5 items 1–7, section 8 (A)).

## 13. Cost

Unvalidated until S3a. Order of magnitude from v1: €100–200 for the full run plus ~$15 for the
pilot. The owner sets the ceiling at S3b from the pilot numbers.

## 14. Paper outline

1. Introduction and the research question (section 1).
2. Related work: ANN-Benchmarks, Big-ANN, Wang et al. (VLDB 2021), Azizi et al. (SIGMOD 2025), Iceberg
   (arXiv 2512.12980), Operational Advice for Dense and Sparse Retrievers (ACL 2025 industry), Bang
   for the Buck (arXiv 2505.07621), Recall What Matters (arXiv 2606.04522), Lin (HNSW or flat?),
   Lucene Is All You Need, RaBitQ, ScaNN / SOAR, DiskANN / Vamana, SVS LVQ / LeanVec, CRouting,
   Ada-ef, DARTH, VSAG. Repeat the search with a Semantic Scholar key before submission.
3. Benchmark and protocol: units, ground truth, fractions, dev selection, margins and power.
4. Systems; the common-rescoring design.
5. Results: (A) generator comparison; (B) as shipped; memory, disk, load, build; cold start;
   throughput if in.
6. Controlled analyses: H1–H4.
7. Where the cascade loses (main text).
8. Limits: sizes; 768-d only; three models; cloud / VM machines; single-threaded build; tested
   interfaces; JS harness for ours; previously examined code queries.

## 15. Out of scope

GPU indexes; engines as arms; billion-scale sets; filtered search; streaming updates; dimensions
other than 768; any kernel change outside phase K; any new dataset, rival or experiment not listed.

## 16. Reviewer attacks addressed (summary)

One embedding model and domain (§9); rival builds and missing rivals (§8); operating points picked on
held-out (§4); "CI contains 0" as equality (§4); held-out reuse and non-independent sets (rule 4, §9);
back-to-back repeats (§5.3); noise (§10); SIMD builds (§5.5, K6–K8); throughput (§5.9); memory
measures (§5.7); single-threaded build (§5.10, limits); size limit (§9, limits); huge pages (§5.12);
JS vs C++ (§5.11); AdvTest split (§9); silent failures and pins (§5.1, 5.2, 5.6, 5.13); licences (§9);
the source of the advantage (§8 (A)).

## 17. Review rounds → fixes

| Round.# | Astra point | Fix in v2 |
|---|---|---|
| 1.1 | Fraction vs absolute target confused; two systems passing a target ≠ equal; non-inferiority ≠ equality; δ unvalidated; recall role unclear | §4: d_q = Q_sys − f·Q_exact; head-to-head tests; "within the margin" / TOST wording; δ from a power analysis with repository clustering; recall secondary and separate |
| 1.2 | Rival binary cascades skip int8 and cap rescoring at 150; ScaNN small-corpus modes; SVS proprietary, Intel-only; grid ≠ equal budget | §1 and §8 (A) common rescoring; refine depth swept; ScaNN modes by size; SVS pinned binary on `intel` only; tuning-budget table |
| 1.3 | Harness keeps a float32 corpus copy; memory phases mixed | §5.7: query-only processes over serialised indexes; build / loaded / after-query; anonymous vs file-backed |
| 1.4 | `prep.py` float32, no ties; `score4.py` dedup after cut; recall < 0.5 rule; selection used point estimates | §4: `gt.py` float64 + tie rule; evaluation unit and aggregation before the cut; fixtures; `ir_measures` check; negative results stay; §3 records the current defect |
| 1.5 | Operating points chosen before C0; inherited "CI contains 0"; `HnswSearcher` not shareable | S5a before S5b, selection with final binaries; §4 replaces HANDOFF-v5 §0; §5.9 split design, owner decides in/out |
| 1.6 | Four sizes share one query set; labels make results exploratory, not confirmatory | rule 4; optional fresh code set; shared query ids in pooled analyses |
| 1.7 | R cap cannot reach 1%; variance components; replica ≠ new host; tails from all timings | §10; §5.4; §6 replica wording |
| 1.8 | THP `madvise` keeps our advantage; `always` not equal; switch mixes alignment and page size | §5.12: as-deployed + controlled arms (2 × 2 for ours), measured backing |
| 1.9 | Novelty too broad; ties and crossover explanations exceed evidence | §1 research question (common rescoring), do-not-claim list, H1–H4 with controlled experiments (§9) |
| 1.10 | CodeRankEmbed nested dims unverified; dims of both stages; 768-d only; Quora + FiQA | §9 empirical wording; K4 per-stage widths; 768-d limit; BEIR proposal |
| 1.11 | No measured workload; one-build-per-core vs 26 GB; dates not credible | §11 workload table, S3a pilot, memory admission; §12 no date before the pilot; cut order |
| 1.— | AVX-512 parity needs real tests; int8 not shown dot-bound | §7 parity tests; K7 only after a profile |
| 2.1 | Power-derived δ makes noisy sets lenient; pairs for power; primary comparisons and correction; TOST level; kernel margin late | §4: δ and δ_K set by the owner first (S0) with a stated reason; power per primary pair; under-powered pairs descriptive; predeclared primary comparisons with Holm; non-inferiority at one-sided 0.025, TOST at 0.05 (90% interval) |
| 2.2 | 100-vector output vs H = 20; exact list may hold < 10 documents; BEIR self-matches; adaptive budgets change | §4 output contract (actual retained lists, C ≥ H ≥ 10, k_v per set from dev), exact document ranking by max vector score over the corpus, self-match removal for all, v4 ratios not reused |
| 2.3 | Common rescoring cannot attribute all three stages; budgets could differ per generator; timing boundary | §1 narrowed question; fixed matched budget grid (§8 A) with an H = C no-screen arm; timing boundary defined |
| 2.4 | File names collide; index and model identity; expected-job list; result-dependent stopping | §5.1 job hash as file name with full key; §5.2 `jobs-expected.json`; §5.2b no stops in held-out |
| 2.5 | Intel-only adapters cannot pass on free machines; R with final binaries per machine; push without approval | S1 exit "awaiting platform", S3a `intel` check; §10 A/A after phase K on every machine; rule 13 |
| 2.— | Size sampling wording; VM causality; H4 without experiment; shortest track | §9 controlled sampling wording and fit check; §1 H3 limit; H4 exploratory; short track as the default |
