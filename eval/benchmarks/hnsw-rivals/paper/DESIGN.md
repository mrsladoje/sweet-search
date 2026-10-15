# Paper harness v5 — formats and interfaces (S1)

The contract between the parts of `PAPER_PLAN.md` step S1. Every script in `paper/` reads and
writes these formats. Change this file first when a format changes.

## 1. Data layout

`DATA` = `~/.ss-eval/hnsw-paper` (Mac), `/root/hnsw-paper` (box), `/opt/hnsw-data` (AWS).

```
DATA/sets/<set>/                    model-independent definition of a set
    set.json                        see 1.1
    vectors.jsonl                   one line per vector, vector-id order: {"vid": "<vector key>", "doc": "<doc key>"}
    queries.jsonl                   one line per query: see 1.2
DATA/emb/<model>/<set>/             one model's vectors of one set
    model.json                      the model manifest (section 2)
    corpus.f32                      n_vec x 768 float32, vector-id order, stored precision
    queries.f32                     n_q x 768 float32, queries.jsonl order
    gt/<split>.json                 manifest of the ground truth files (hashes, arithmetic, counts)
    gt/<split>.docs.i32 / .docs.f64 n_q(split) x 100 exact document ids / scores (section 3)
    gt/<split>.vecs.i32 / .vecs.f64 n_q(split) x 100 exact vector ids / scores
    export/                         our index's own data for the shared C++ path (section 5.3)
        codes.u8                    n_vec x 64   (512 sign bits, our byte order)
        int8.i8                     n_vec x W8   (W8 = 512 by default; K4)
        f16.u16                     n_vec x 768  (our vector file, node -> vector-id order)
        export.json                 index file SHA-256, widths, counts, check sums
    index/.sweet-search/            our production index (codebase-binary-hnsw.idx + vector file)
DATA/builds/<machine>/<set>/<model>/<system>/<buildhash>/   serialised rival indexes + build.json
```

### 1.1 `set.json`

```
{ "name": "gcsn", "kind": "code" | "beir",
  "n_vectors": 6918, "n_docs": 6918, "n_queries": {"dev": 3600, "ho": 2400},
  "membership_sha256": "<sha256 of vectors.jsonl>",      // corpus membership, model independent
  "queries_sha256": "<sha256 of queries.jsonl>",          // the split is inside: changes with it
  "split": {"seed": 42, "dev": 0.6, "stratify": "language" | null, "source": "..."},
  "self_match": false,                                    // true for Quora (rule of PAPER_PLAN §4)
  "previously_examined": true,                            // rule 4 label
  "k_v": null                                             // set on dev before the freeze (§4)
}
```

**Document ids.** Doc keys are numbered in the order of their first vector (vector-id order).
`doc_id` is that number. A vector with no document of its own (a distractor) is its own document
(key `__v<vid>`). The doc-id order is the tie rule everywhere: lower doc id first.

### 1.2 `queries.jsonl`

`{"qid": "GC01304", "text": "...", "split": "dev" | "ho", "rel": {"<doc key>": 1}, "cluster": "<repo>"}`.
`rel` holds graded relevance (BEIR qrels as given; code sets grade 1). `cluster` = the source
repository for code sets (from the vector key `<lang>/<owner_repo>/...` of the gold document), the
query id for BEIR. Rows are in a fixed order; the split never changes after S1.

## 2. Model manifest (`model.json`)

`{ "model": "CodeRankEmbed", "hf_id": "...", "revision": "<commit>", "tokenizer_revision": "...",
   "query_prefix": "...", "doc_prefix": "...", "pooling": "cls|mean", "max_length": 512,
   "inference_precision": "fp32", "normalised": true, "dim": 768,
   "stored_precision": "float32", "our_f16_rounding": "nearest-even", "code_width": 512, "int8_width": 512,
   "embedder": {"script": "...", "sha256": "...", "machine": "...", "torch": "..."},
   "corpus_sha256": "...", "queries_sha256": "..." }`

`MODELS.json` (paper/) lists the three models with the per-model contract (PAPER_PLAN §4).

## 3. Ground truth (`gt.py`)

For every query of a split: cosine of every stored float32 vector, normalised in float64, float64
accumulation (`numpy` float64 matmul of normalised float64 arrays). Document score = maximum over its
vectors. Documents ranked by score, ties by the lower doc id; top 100 kept. Exact vector top 100:
same arithmetic, ties by the lower vector id. BEIR self-match: when `set.json:self_match`, the
document whose key equals the query id is removed before the cut (documents and vectors).
`gt/<split>.json` holds the SHA-256 of every output file and of the inputs.

## 4. Evaluation unit and metrics (`quality.py`)

**Aggregation (the shared code).** A system returns its retained vector list `(vid, score)` in its
own order. `to_docs(list)`: drop self-matches; map vids to doc ids; document score = max of its
vector scores in the list; order documents by score descending, ties by the lower doc id; cut at 10.
Missing ranks count as non-relevant; the share of lists with fewer than 10 documents is reported.

**Metrics.** MRR@10 (code sets; first relevant document), nDCG@10 (BEIR; graded `rel`, gain
`rel`, log2 discount, ideal from all judged documents of the query, `ir_measures`/`pytrec_eval`
convention). Recall@10 of vectors: |retained top-10 vids ∩ exact top-10 vids| / 10.
`check_irmeasures.py` checks `quality.py` against `ir_measures` on every set: max abs diff ≤ 1e-9.

**Statistics (`stats.py`).** Cluster bootstrap: resample clusters (repositories for code sets,
queries for BEIR) with replacement, all queries of a drawn cluster, 10,000 resamples, seed 42; one
index matrix per (set, split), shared by every statistic of that set (shared query identities).
- Selection (B): `d_q = Q_sys,q − f · Q_exact,q`; qualifies when the 2.5% percentile of the
  bootstrap mean of d ≥ 0. f ∈ {0.98, 0.99, 0.995}.
- Non-inferiority (primary): `ours − rival`; pass when the 2.5% percentile > −δ (δ = 0.005).
  Holm over the declared primary comparisons. TOST (if asked): 5% and 95% percentiles inside ±δ.
- Power: from dev paired differences of a primary pair, the cluster-bootstrap SE scaled to the
  held-out cluster count, `power = Φ(δ / SE_ho − 1.96)` at a true difference of 0; checked by
  simulation (resample dev clusters to the held-out size, 2,000 draws).

## 5. Systems and the two comparisons

### 5.1 Timing protocol (both comparisons, every system)

One process per (system, build, round). It loads the serialised index (no build), warms up on 500
dev queries (seeded order), then times every query of the split **once**, in the order
`permutation(seed = 42 + round)`. Timing boundary: query float vector in memory → retained list
(PAPER_PLAN §1). Every individual timing is kept (`timings_ns`, query-index order). Held-out mode
(`--heldout`): no early stop of any sweep; the process refuses any stop option.

### 5.2 (A) common rescoring

Generator → top C vector ids → shared int8 screen keeps H → shared full-vector rescoring orders the
H → the retained list = those H with their full-vector scores.
- **int8 screen:** `dot_i32(q8, int8[vid])` over all C (exact integer); stable sort by dot
  descending (ties keep generator order); keep the first H. H = C: no screen.
- **full rescoring:** `full = Σ_i f64(q[i]) · f64(f16→f32(v[i]))`, i = 0..767 in order (one
  sequential f64 sum per row; FMA allowed, products are exact); min-max normalised over the H
  (`(f − min)/(max − min)`, clamped to [0, 1]; 0.5 when max = min); stable sort by normalised score
  descending (ties keep int8 order). Retained score = the raw f64 `full`.
- **query conversion (timed):** `t = q[0:512] / ‖q[0:512]‖` (norm in f64 from f32 values, result
  stored as f32); sign bits `t_i > 0`, MSB first per byte; `q8_i = floor(clamp(t_i, −1, 1) · 127 + 0.5)`
  (JavaScript `Math.round`). The full query = the f32 values as f64.
- Ours runs the same steps with the addon kernels (`ours5.mjs --mode A`); the C++ copy in
  `rivals5.cpp` must give bit-identical lists on every dev set (`check_bitident.py`).
- Budget grid (proposal, declared on dev in S1): C ∈ {100, 200, 400, 1000}, H ∈ {50, 100}, plus
  H = C; C ≥ H ≥ 10. Effort: graph generators at ef = C (smallest that returns C) and ef = 2C;
  partition generators at the smallest nprobe / leaves that return ≥ C candidates on ≥ 99.9% of dev
  queries, and twice that.
- Generators: ours walk, ours scan, FAISS binary HNSW, FAISS binary flat, USearch b1, hnswlib f32,
  FAISS HNSW f32, FAISS RaBitQ (flat, IVF), ScaNN, DiskANN.

### 5.3 (B) as shipped

Each library's own search and refine, returning its top k_v vectors (k_v per set, from dev, §4 of
the plan; Quora k_v + 1). Ours = the production `semanticSearch3Stage` with k = k_v.

### 5.4 Result record (one file per job)

`RESULTS/<machine>/<set>/<model>/<jobhash>.json`, written last by atomic rename, after its sidecar
`<jobhash>.lists.bin` (int32 vids then float32 scores, n_q x L each, query-index order). Fields:

```
{ "job_hash": "...", "key": {<every key field, 5.5>}, "complete": true,
  "system": "...", "comparison": "A"|"B", "split": "dev"|"ho", "round": 0,
  "params": {...}, "L": 50, "n_queries": 3600, "order_seed": 42,
  "timings_ns": [...], "lists_sha256": "...", "short_lists": 0,
  "memory": {"loaded": {...}, "after": {...}}, "load_s": 1.2, "env": {...} }
```

### 5.5 Job key (PAPER_PLAN §5.1)

SHA-256 over the JSON (sorted keys) of: set `membership_sha256`, `queries_sha256` (split), model
manifest SHA-256, comparison, system, full config (build and search parameters, C, H, k_v), build
seed, serialised-index SHA-256, binary hashes (rivals binary, addon, node, Python packages), all
options, round, instance id. `jobs-expected.json` lists every key of a step before it starts;
`check_complete.py` exits non-zero on any missing, failed or mismatched job.

## 6. Files

| File | Part |
|---|---|
| `sets.py` | builds `DATA/sets/<set>` from the v4 set dirs (code sets) or BEIR (Quora, FiQA); AdvTest split |
| `embed.py` | embeds a set with a model (GPU, S4); writes `DATA/emb/<model>/<set>` + `model.json` |
| `gt.py` | section 3 |
| `quality.py`, `stats.py` | section 4 |
| `fixtures_quality.py` | the plan's fixtures, plain Python, no import of `quality.py` |
| `check_irmeasures.py` | the cross-check |
| `export_index.mjs` | `export/` from our index |
| `ours5.mjs` | our arm, modes A and B, timing protocol 5.1 |
| `rivals5.cpp` | rival harness: build mode, query mode, (A) and (B), timing protocol 5.1 |
| `jobs.py`, `run.py`, `check_complete.py` | job identity, the runner, completeness |
| `test_harness.sh` | the failure tests (§5.13) |
| `workload.py` | the workload table |
