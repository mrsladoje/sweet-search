# MaxSim paper — request for an independent critique

**For:** an independent reviewer (Astra). **From:** the owner of sweet-search, 2026-10-15.
**What we want from you:** a hard critique of the paper plan *before* we spend money and
run the held-out benchmarks. After the held-out runs start, we cannot change the method
(held-out discipline), so problems are cheap to fix now and expensive later.

Attach with this file: `eval/maxsim-bench/PAPER_PLAN.md` (the full plan; not pushed yet),
`eval/maxsim-bench/RESULTS.md` and `eval/maxsim-bench/README.md`. The code is public:
<https://github.com/mrsladoje/sweet-search> (Apache-2.0). Kernel:
`crates/sweet-search-native/src/maxsim/`. Benchmark: `eval/maxsim-bench/`.

---

## 1. The paper in short

- **Type:** arXiv technical report plus a Zenodo data DOI (wanted by about 2026-11-10).
  Later, an extended version for a workshop (ReNeuIR) or a reproducibility / resource
  track (SIGIR, ECIR).
- **Scope:** CPU only, reranking only (the owner's decision).
- **Claim:** at the sizes of real late-interaction rerank calls, fixed costs (thread
  wake-up, data transfer) are larger than compute. An exact int4 MaxSim kernel built for
  that is faster than the CPU libraries we tested, on five CPUs, with its losses reported.
- **Not claimed:** "fastest MaxSim", "state of the art", "first", GPU results, end-to-end
  search speedups.
- **The kernel:** engineering, not a new algorithm. SIMD register blocking (NEON 4×4,
  AVX2 4×2), int4 per-token storage decoded in L1-sized tiles inside the kernel, ragged
  batches without padding, its own lock-free worker pool, and a gate that keeps scores
  bit-identical between kernel versions. "Exact" means exact over the stored int4 data.

## 2. What exists

- Held-out results on Apple M3 Max and AMD EPYC (Hetzner CCX33), kernel commit
  `66e4f08d`. Replayed real rerank calls: `agent-ho` (2,004 calls from a coding agent on
  11 public repositories), `gcsn-ho` (2,385 calls, GenCodeSearchNet queries), and a size
  sweep (84 cells). Dev and held-out are split; the kernel was developed on dev only.
- Headline (warm, all cores, ratio = rival time / sweet time, > 1 = sweet faster):

  | set, CPU | NumPy | PyTorch | maxsim-cpu | NumKong (approx.) |
  |---|---|---|---|---|
  | agent, M3 Max | 2.00x | 4.24x | 6.51x | 2.64x |
  | GCSN, M3 Max | 2.05x | 6.65x | 6.86x | 2.56x |
  | agent, EPYC | 1.44x | 1.89x | 2.44x | 2.65x |
  | GCSN, EPYC | 1.57x | 2.80x | 2.69x | 2.70x |

- Known losses: cold calls on x86 (NumPy about 1.5x faster); large compute-bound calls
  on the M3 Max (Accelerate uses the AMX coprocessor; up to 1.6x, one doc 2.8x); NumKong
  on some large sweep cells; one-core tables on Apple are not one core against one core.
- Method: one arm per process; two rounds in reversed order; an idle-CPU gate; every arm
  checked against a float64 reference on every call (max abs error, top-1 agreement);
  geometric-mean ratios with 95% bootstrap intervals; each rival at its fastest
  configuration, chosen on dev data. Two upstream correctness bugs found in maxsim-cpu
  (issues #1 and #5).
- Kernel p50 per call: 22–44 µs (M3 Max), 44–102 µs (EPYC).

## 3. What the plan adds (PAPER_PLAN.md)

1. Two public ColBERT models (answerai-colbert-small-v1, colbertv2.0) on BEIR SciFact and
   NFCorpus (maybe FiQA), with BM25 top k ∈ {10, 25, 50, 100, 200} as candidates, through
   the same benchmark.
2. Quality per latency budget (nDCG@10 against p50 rerank time), and int4 vs float32
   quality with a paired bootstrap.
3. Three more CPUs on AWS: Intel Granite Rapids (c8i), AMD Zen 5 (c8a), Graviton4 (c8g).
4. Phase C0: a short dev-only tuning phase on the new CPUs. Cheap, mechanistic fixes only;
   two-round A/B; keep a fix if it is ≥ 3% faster on the target machine and ≤ 1% slower
   on the others, and if accuracy does not fall. Then the kernel freezes at one "paper
   commit", and every paper number comes from that commit (M3 Max and EPYC run again).
5. An ablation by commit (five historical builds plus the C0 fixes).
6. Parallel callers (1, 4, 16): throughput and p99.
7. The time share of MaxSim in the full production rerank pipeline.
8. Input-size fairness: rivals on int8 / bf16 / float16 where they support them, and a
   "bytes read per call" column.
9. Cluster bootstrap (by repository or query), the BLAS of each rival recorded (MKL arm on
   Intel), licence checks of the released data, a second cloud instance per CPU type as a
   noise floor, and contact with the rival maintainers before the upload.

## 4. Questions for you

Answer each one. Be specific; say "no problem" where there is none.

1. **Contribution.** Is this enough for an arXiv technical report? For a SIGIR / ECIR
   reproducibility or resource track? For ReNeuIR? What one addition would raise it most?
2. **The claim.** Is the claim in section 1 supported by the planned experiments? Which
   word in it would a reviewer attack first?
3. **Fairness to rivals.** Which rival configuration, library, BLAS back end, or input
   type is missing, so that a reviewer can say the comparison is weak? Are there CPU
   MaxSim implementations we do not list (for example in PyLate, FastPLAID, Vespa,
   Qdrant, LanceDB, Weaviate, FAISS, or a Rust crate)?
4. **Method.** Problems with: replayed calls as the workload, the dev / held-out split,
   two rounds, the idle gate, geometric means, the bootstrap, cloud machines (shared
   hosts, turbo, SMT)?
5. **Phase C0.** Does dev-only tuning on the target CPUs before the held-out runs harm
   credibility, even with the log published? Are the thresholds (≥ 3% gain, ≤ 1% loss,
   two rounds) sound, or too loose / too strict?
6. **Workload.** Is a coding-agent workload plus BEIR enough to call the finding general?
   ColBERT pads queries to 32 tokens; production queries have a median of 14. Is that a
   problem?
7. **Related work.** Which papers must we cite or compare with? We know: ColBERT,
   ColBERTv2, PLAID, WARP (SIGIR 2025), EMVB (ECIR 2024), token pooling, maxsim-cpu (blog),
   Flash-MaxSim, TileMaxSim (arXiv 2606.26439), ErikKaum/maxsim (GPU), Col-Bandit, DESSERT,
   CrossQ (2026). Is any "first" claim safe?
8. **Citations.** What would make other people cite this (a named benchmark, a pip
   package, a leaderboard, integration in PyLate)? Which of those are cheap?
9. **Anything else** that would make a reviewer reject it, in order of severity.

## 5. Output we want

- A ranked list of problems: severity (blocking / major / minor), the problem in one
  sentence, and the fix with its cost (hours or dollars).
- A verdict on questions 1 and 2 in three sentences or fewer.
- Say what you checked and what you only assumed.
