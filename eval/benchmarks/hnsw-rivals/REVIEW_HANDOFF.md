# HNSW / binary-cascade paper — request for an independent critique

**For:** an independent reviewer (Astra). **From:** the owner of sweet-search, 2026-10-15.
**What we want:** a hard critique of the paper plan *before* we spend money and run the held-out
benchmark. After the held-out runs start we cannot change the method, so problems are cheap to fix
now and expensive later.

Read with this file: `eval/benchmarks/hnsw-rivals/PAPER_PLAN.md` (the plan),
`eval/benchmarks/hnsw-rivals/HANDOFF-v5.md` (kernel rules and log),
`eval/benchmarks/hnsw-rivals/HANDOFF-v4.md` §2–3 (current benchmark method and results) and, for the
method we copied, `eval/maxsim-bench/PAPER_PLAN.md` §4–5 (and its section 15, your earlier critique).
Code: `crates/sweet-search-native/src/hnsw_search.rs`, `rescore.rs`,
`core/vector-store/binary-hnsw-index.js`, `core/search/search-semantic.js`; harness:
`eval/benchmarks/hnsw-rivals/` (`rivals.cpp`, `run4.sh`, `score4.py`, `ours.mjs`, `ab.sh`).

## 1. The paper in short

- **Type:** method-neutral benchmark paper ("experiment, analysis and benchmark"), arXiv first,
  data and harness with a Zenodo DOI. The owner chooses the venue.
- **Subject:** binary-code cascades (sign bits → int8 → full vector) against graph and partition
  indexes at equal retrieval quality, 7k to 1M (maybe 2.68M) vectors, code and text, five CPUs.
- **Current result (held-out, previously examined, x86 KVM box):** ours is Pareto-best from its
  fastest point upward on all five code sets; closest rival at our MRR is ×1.62 (140k, hnswlib)
  to ×4.85 (AdvTest) slower. Below our fastest point, rivals (FAISS binary flat) are faster at lower
  MRR.

## 2. Questions

Answer each one. Be specific; say "no problem" where there is none.

1. **Contribution.** Is a method-neutral benchmark with these findings enough for a strong arXiv
   paper and a journal? What one addition would raise it most?
2. **Equal-quality protocol** (plan §4). Are targets relative to exact search, dev-chosen frozen
   operating points and non-inferiority with δ = 0.002 sound? Is δ too loose or too strict for
   MRR@10 on 2,400 queries? Would a reviewer prefer recall@k vs exact as the primary axis?
3. **Fairness to rivals** (plan §8). Which library, config, build grid, SIMD build or rescore
   option is missing? Is the build grid enough, given we cannot afford a full grid at 2.68M?
   Is it fair that our build is single-threaded and theirs are parallel?
4. **Timing method** (plan §5). Shuffled single passes vs back-to-back repeats; R from an A/A run;
   SMT on c8i; THP `madvise` for all plus one `always` run; JS harness for ours.
5. **Previously examined data** (rule 4). Is labelling enough, or must the code sets get fresh
   held-out queries (for example new queries from the same repositories)?
6. **Phase K and C0** (plan §7). Does kernel tuning on the target CPUs (AVX-512 paths) before the
   held-out run harm credibility, even with the log published?
7. **Models and sets** (plan §9). Are two extra models (one without nested dimensions) and one
   or two BEIR sets enough to call the finding general? Which BEIR set would you take?
8. **Hardware and statistics.** Problems with five CPUs (three AWS 4xlarge, M3 Max, KVM box),
   replicas, paired bootstrap over queries, cluster bootstrap over repositories?
9. **Related work.** Which papers must we cite or compare with? Is any "first" safe?
10. **Schedule and cost** (plan §11–12). Is anything on the critical path missing? Anything to
    cut without hurting the paper?
11. **Anything else** that would make a reviewer reject it, in order of severity.

## 2b. Round 2 (plan v2)

Your round-1 points and their fixes are in `PAPER_PLAN.md` section 17. For round 2: (a) check each
fix; say if it is wrong or incomplete; (b) review the new parts: the common-rescoring comparison
(§1, §8 A), the selection and head-to-head tests and the power analysis (§4), the controlled
experiments H1–H2 (§9), the uncertainty plan (§10), the pilot and the workload table (§11 S1, S3a);
(c) tell us what to cut first if the owner wants the shortest schedule without losing credibility.

## 3. Output we want

- A ranked list of problems: severity (blocking / major / minor), the problem in one sentence,
  the fix and its cost (hours or dollars).
- A verdict on questions 1 and 2 in three sentences or fewer.
- Say what you checked in the code and what you only assumed.
