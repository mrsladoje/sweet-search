# Replication study — pre-registration (written 2026-10-19, before any replication data exist)

**Purpose.** The main study's speed results are descriptive: the held-out queries were examined several times,
our defaults were tuned on the code queries, and four harness flaws were found after the freeze (`paper/draft`,
Appendix "Deviations"). This study tests the main speed claim once, on two sets that no earlier step used, with a
corrected harness, rules fixed here before any data exist, and one held-out look.

## 1. Sets and model

- **cqadup:** CQADupStack, the 12 BEIR subforums merged into one corpus (457,199 documents; ids `<forum>/<id>`),
  BEIR `qrels/test.tsv` of every forum.
- **msmarco1m:** MS MARCO passages: every passage judged for a BEIR dev query, plus a seeded random sample of
  the other passages, 1,000,000 passages in total; BEIR dev queries and qrels (`sets_rep.py`).
- **Model:** bge-base-en-v1.5 only (768-d), embedded on one machine with the pinned revision (`MODELS.json`).
- **Split:** 60/40 dev / held-out over query ids, seed 42 (`sets.split_ids`), stratified by forum for cqadup;
  query ids that are also corpus ids are self-matches and removed before the cut, as for Quora; cluster = query; ground truth
  `gt.py` (float64 exact), `k_v` from `kv.py` on dev.

## 2. Systems and builds

- **Ours:** the production cascade (scan up to 150k vectors, walk above), production build ($M = 64$,
  efC = 800, seed 42). Grid: $S_1 \in \{50, 100, 150, 200, 300, 400, 600, 1000, 1500, 2000, 3000\}$, only values
  at or above the product's own stage-1 floor for $k = k_v$ (no bench-only override), ef = max($S_1$, 50); our
  shipped default ($S_1 = 400$) is also timed on held-out as a separate, descriptive row.
- **Rivals:** every family of the main study that runs on the CPU type, with ONE build per family: the build
  parameters most often frozen for that family on Quora and csn1m in the main study (all CPUs, all fractions):
  diskann R96/L200; faiss_bin_hnsw M64/efC800; faiss_hnsw_flat M64/efC800; faiss_hnsw_sq8 M64/efC800;
  faiss_rabitq_hnsw M64/efC200; hnswlib M64/efC200; usearch_b1_rescore M32/efC800; usearch_f16 M64/efC800;
  usearch_i8 M32/efC800; scann tree-AH with SOAR, leaves = round(sqrt n); svs LVQ/LeanVec degree 64 (Intel);
  faiss_ivfpq_fs and faiss_rabitq_ivf nlist = round(sqrt n); faiss_bin_flat, faiss_rabitq_flat (approximate with refine; eligible as the rival). Exact float32 search is not
  timed.
  Search grids: the main study's declared grids (`plan.py b_points`), except that every effort-type knob (ef,
  DiskANN L, SVS window) takes the same 11 values as our $S_1$ grid. No build tuning on these sets for any system.
- **Comparison:** (B) only (each library's own search; refine as in the main study).

## 3. Harness corrections (relative to the frozen main-study harness)

1. The rival timer computes only the query forms the family uses (binary families: the sign code; all: the
   normalised float query); no int8 or float64 query for comparison (B).
2. Paired blocks: every plan file holds all systems of one (set, round) and runs on one instance, in a random
   order (seeded shuffle, seed 1000 + round).
3. Validity rule, every system alike: a job with more than 1,000 major page faults in its timed pass (after the
   warm-up) runs once more; if the rerun also exceeds 1,000 the job is invalid and its block is dropped (both
   counts are recorded). Each job pre-reads only the files it opens.
4. Our native-only clocks are recorded (separate `native` jobs) and reported descriptively.

## 4. Dev selection

For every system and f = 0.99: the fastest configuration whose one-sided 97.5% cluster-bootstrap lower bound of
mean(Q_sys − 0.99 Q_exact) is ≥ 0 (10,000 resamples, seed 42). Latency on dev = median over **3 rounds** of the
per-round median (not one round). The rival of the primary test is the rival system with the lowest dev latency
among those with a qualifying point (exact search excluded). Points and the rival are frozen in
`shortlists/shortlist-rep-<cpu>.json` before any held-out job.

## 5. Held-out run and primary hypotheses

- **CPUs and units:** the three AWS types (c8i Intel, c8a AMD, c8g Graviton; .4xlarge, 16 vCPU, 32 GiB), **6
  instances per type**, each a fresh instance running 2 paired blocks (rounds 2i and 2i+1) of both sets. The unit
  of the test is the instance.
- **Primary latency hypothesis (6 tests: 2 sets × 3 CPUs):** ours is faster than the dev-chosen rival at
  f = 0.99. Statistic: per block, log(median rival / median ours) of the two jobs of the block (same instance);
  per instance, the mean over its blocks; one-sided t-test over the 6 instances (df 5), H0: mean ≤ 0; Holm over
  the fixed family of 6 tests at α = 0.025 (an unavailable test counts as p = 1). Blocks whose job is invalid by
  the fault rule after its rerun, or whose two jobs ran on different instances, are dropped and reported.
- **Joint claim:** "faster at f = 0.99" for a (set, CPU) requires the latency test AND the quality test to pass
  (intersection-union; no further correction). Held-out points that miss f are reported as such.
- **Primary quality hypothesis (same 6 pairs):** non-inferiority with a relative margin: H0: mean(Q_ours −
  Q_rival + 0.005 · Q_exact) ≤ 0, jointly bootstrapped over query clusters (10,000, seed 42), one-sided at 0.025;
  Holm over the fixed family of 6. Quality from the round-0 lists; list hashes must be equal across rounds.
- **Reported descriptively:** the geometric mean ratio over instances with a paired bootstrap interval over instances; whether each frozen point
  meets f on held-out (point estimate and bound); p95/p99; our native share; our shipped default; memory;
  major page faults.
- **No re-selection** after held-out data. All results are reported, including failures.

## 6. Analysis code

`rep_select.py` (dev selection, rival choice, freeze file) and `rep_analyze.py` (held-out tests) are written and
committed **before** the held-out run, and run unchanged on the held-out records.

## 7. Budget and stop

USD 80 at most for this study (spend ledger ceiling raised accordingly); machines have hard stops.
