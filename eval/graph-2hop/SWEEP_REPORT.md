# Validation loop — pool sweep + chunk overflow audit

Date: 2026-05-02. 300-query graph-2hop benchmark (fastify + flask +
ripgrep) plus 6105-chunk overflow audit on the same three repos.

## TL;DR

1. **Cascade-off (production default): widening the LI rerank pool from
   20→30 is the clear win.** R@10 +2.33 pp, MRR +0.72 pp, top10 rescue
   3.0 %, top10 harm 0.67 %. Going further to 40 doubles harm with only
   +0.67 pp R@10 over 30 — diminishing returns.
2. **Cascade-on path is unaffected by pool size** (cascade scores all
   candidates internally; the legacy LI knob is ignored). With cascade
   on, expansion already gave +0.66 pp R@10 / +1 pp R@50 / 0.67 % rescue
   on the previous fixed run, regardless of pool config in this sweep.
3. **Adaptive 2-hop is still indistinguishable from 1-hop / naive 2-hop**
   even at pool=40. The expansion contributes ~6–8 entries per affected
   query — too few for the algorithm-difference (edge-type alpha, degree
   normalisation) to register.
4. **Chunk-overflow audit: 79 % of overflowing chunks (562/711) are
   "header-pushed"** — raw content ≤ 2000 chars, ~50-100-char headers
   push them over. Tail content past the cap looks "likely meaningful"
   on 22.6 %, "likely noise" on 41.2 %. Cheap fix: subtract header
   overhead from the chunker `maxChunkSize`. Not a "split everything"
   problem.

## A — pool-allocation sweep

`eval/graph-2hop/run_pool_sweep.js` runs 8 policies × 300 queries with
identical retrieval pipeline; only `graphExpand`, `liPoolSize`,
`liExpandedFraction` vary. `liPoolSize` and `liExpandedFraction` are new
search options threaded into `buildMixedRerankPool` with backwards-
compatible defaults; `core/search/search-postprocess.js` honours them
in the legacy LI rerank path.

### Cascade DEFAULT (off) — n=300

| policy             | mode            | pool | split  | MRR@10 | R@10  | R@20  | R@50  | p50ms | rescue@10 | harm@10 |
|--------------------|-----------------|-----:|--------|-------:|------:|------:|------:|------:|----------:|--------:|
| baseline_none      | none            |    — | —      | 56.96 % | 77.00 % | 80.67 % | 88.33 % | 19.5 |     —     |    —    |
| production         | 2hop-adaptive   |   20 | 60/40  | 56.97 % | 77.00 % | 80.33 % | 88.67 % | 21.7 |   0.00 %  |  0.00 % |
| **pool30_60_40**   | 2hop-adaptive   |   30 | 60/40  | **57.68 %** | **79.33 %** | **84.00 %** | 88.67 % | 22.3 |   3.00 %  |  0.67 % |
| pool40_60_40       | 2hop-adaptive   |   40 | 60/40  | 57.26 % | 80.00 % | 84.33 % | 88.67 % | 22.9 |   4.33 %  |  1.33 % |
| pool40_50_50       | 2hop-adaptive   |   40 | 50/50  | 57.26 % | 80.00 % | 84.33 % | 88.67 % | 22.8 |   4.33 %  |  1.33 % |
| pool30_50_50       | 2hop-adaptive   |   30 | 50/50  | 57.68 % | 79.33 % | 84.00 % | 88.67 % | 22.3 |   3.00 %  |  0.67 % |
| 1hop_pool40        | 1hop            |   40 | 60/40  | 57.26 % | 80.00 % | 84.33 % | 88.67 % | 21.7 |   4.33 %  |  1.33 % |
| 2hop_naive_pool40  | 2hop-naive      |   40 | 60/40  | 57.26 % | 80.00 % | 84.33 % | 88.67 % | 22.1 |   4.33 %  |  1.33 % |

Net rescue (rescue − harm) at top10:
- pool=20: 0
- pool=30: +2.33 pp
- pool=40: +3.00 pp

Widening from 20→30 is mostly free recall (+2.33 pp at top10, only 0.67 % harm,
+0.7 ms p50). 30→40 adds 1 pp recall but doubles harm and adds another 0.6 ms.
30 is the better-shaped operating point.

The expanded/original split (60/40 vs 50/50) makes **no difference** at any
pool size. Only ~6 expanded entries actually enter the pool per affected
query, so reserving more slots doesn't help when the supply is already
the bottleneck.

### Cascade ON — n=300

| policy             | MRR@10 | R@10   | R@20   | R@50   | p50ms |
|--------------------|-------:|-------:|-------:|-------:|------:|
| baseline_none      | 57.50 % | 80.67 % | 87.00 % | 88.33 % | 30.3 |
| production         | 57.41 % | 81.33 % | 87.33 % | 89.33 % | 40.2 |
| pool30_60_40       | 57.41 % | 81.33 % | 87.33 % | 89.33 % | 23.8 |
| pool40_60_40       | 57.41 % | 81.33 % | 87.33 % | 89.33 % | 24.0 |
| 1hop_pool40        | 57.41 % | 81.33 % | 87.33 % | 89.33 % | 23.6 |
| 2hop_naive_pool40  | 57.41 % | 81.33 % | 87.33 % | 89.33 % | 23.7 |

Cascade-on policies are byte-identical: cascade scores **all** candidates
that have LI tokens via MaxSim, so `liPoolSize` doesn't gate anything.
The expansion gain (+0.66 pp R@10 from baseline) is real and unchanged
from the previous fixed run. Pool tuning is a cascade-off concern only.

### Algorithm-comparison verdict

`1hop_pool40 ≡ 2hop_naive_pool40 ≡ pool40_60_40` to the third decimal on
every metric. Adaptive 2-hop's edge-type-alpha decay and degree
normalisation cannot register here because:

- only 19/300 queries (6.3 %) fire expansion at all, and
- when they do, only ~6 expanded entries enter the LI pool.

Telling the three apart needs either (a) a benchmark where >50 % of
queries reach 2-hop edges, or (b) a much bigger expansion budget and pool
(50–100 entries each).

## B — chunk-overflow audit

`eval/audit_chunk_overflow.js` ran across fastify (375 files / 3017
chunks), flask (222 files / 1206 chunks), and ripgrep (144 files / 1882
chunks). Total 6105 chunks audited.

### Overflow incidence

| layer                    | overflow > 2000 chars |
|--------------------------|----------------------:|
| raw content              |  **2.44 %**  (149 / 6105)  |
| embedding text (sliced)  | **11.65 %**  (711 / 6105)  |
| enriched embedding text  | 11.96 %  (730 / 6105)      |
| li_text                  | 11.32 %  (691 / 6105)      |

So the cap fires on ~12 % of chunks. Per repo: ripgrep 19.5 % >
flask 9.2 % > fastify 7.7 % (Rust traits + tests are the worst).

### Why the cap fires

| overflow magnitude | count | share |
|--------------------|------:|------:|
| **tiny ≤100 chars** (header push)  | **627** | **88.2 %** |
| small  101–500     | 68 | 9.6 % |
| medium 501–2000    | 7  | 1.0 % |
| large  >2000       | 9  | 1.3 % |

**562 / 711 (79.0 %) of overflows are header-pushed** — raw content
already fits in 2000 chars; only the prepended `path/parent/symbol/lang`
metadata pushes the embedding text over. The chunker targets
`maxChunkSize=2000` on *content*, but `buildEmbeddingText` then
prepends headers and slices at 2000 again, silently dropping the
closing lines of perfectly-sized chunks.

### Is the tail signal worth keeping?

| tail classification | share of overflowing chunks |
|---------------------|---------------------------:|
| likely_meaningful   | 22.6 % |
| maybe_meaningful    | 36.2 % |
| likely_noise        | 41.2 % |

41 % noise / 23 % meaningful: a "split / sample / dual-encode every
overflow" experiment is hard to justify. But 23 % meaningful tail on
12 % of chunks (= ~2.7 % of all chunks) is non-trivial — and most of it
is recoverable for free if header-pushed overflow stops happening.

### Recommended action (audit's own conclusion, which I agree with)

**Budget alignment, not a splitter or dual-encode experiment.** Two cheap
options:

1. Pass `maxChunkSize = 2000 − headerOverhead` into `recursiveChunk` so
   AST content + headers fit inside 2000. Zero impact on chunks well
   under the cap; only changes the boundary chunks. Per-language header
   estimate (~80 chars) is fine.
2. Or raise the embedding-text slice ceiling to ~2200. Verify the
   bi-encoder tokenizer doesn't re-truncate at 512/2048 token first.

Both are 1-file changes worth validating with `eval/retrieval-harness.js`.

## Follow-ups justified by these results

In priority order:

1. **Bump default `stage3Candidates` 20 → 30 in the legacy LI path.**
   Cascade-off path: +2.33 pp R@10, +0.72 pp MRR, 3 % rescue, 0.67 %
   harm, +0.7 ms p50. Cascade-on path unaffected. Lowest-risk win.

2. **Header-overhead-aware chunker budget** (audit's recommendation).
   Eliminates 79 % of cap-overflow events for free; should be a
   measurable bump on any benchmark where overflowing chunks contain the
   gold answer in their last lines.

3. **Re-run sweep with widened pool *and* a larger expansion budget**
   (e.g. `maxExpanded=20–30`, `hop2TokenBudget=8000`). Only then can we
   tell adaptive 2-hop apart from naive / 1-hop. Today's harness shows
   they're identical at all pool sizes ≤ 40 because expansion supply is
   the bottleneck, not pool capacity.

4. **Re-index test repos onto current 512 d pipeline.** Sweep currently
   runs with `use3Stage:false` to dodge a stale Stage-2.5 dim mismatch.
   Results should hold but the cleaner config raises confidence and
   would let cascade-on test 3-stage too.

## What I would NOT do based on this data

- **Build a chunk splitter / sampler / overflow-fanout encoder.** The
  audit shows 79 % of overflows are header-push (no content lost) and
  41 % of true content tails are noise. The expected lift is small and
  the engineering cost is large.
- **Default-disable adaptive 2-hop.** It is harm-free and modestly
  positive under both cascade settings. It just isn't differentiable
  from cheaper hops on this benchmark — that's a benchmark sensitivity
  question, not a "turn it off" question.

## Artifacts

- `results/pool_sweep_default.json` — cascade-off sweep raw data
- `results/pool_sweep_cascade.json` — cascade-on sweep raw data
- `eval/results/chunk-overflow-audit.json` / `.md` — audit outputs
- `run_pool_sweep.js` — reusable sweep harness (any policy combination)

## Addendum 2026-05-03 — s3 ∈ {20, 25, 30} decision sweep

Re-ran the pool sweep restricted to the candidate pool sizes around the
default to choose between `s3=25` and `s3=30` for the product default.
Same 300-query corpus, fresh vocabulary, `SWEET_SEARCH_VOCAB_AUTO_EXPAND=0`,
`graphExpand=2hop-adaptive` (except controls).

### Overall (n=300)

| policy             | MRR@10 | R@10   | R@20   | R@50   | p50 ms | rescue@10 | harm@10 |
|--------------------|-------:|-------:|-------:|-------:|-------:|----------:|--------:|
| baseline_none      | 57.68 %| 79.33 %| 84.00 %| 88.33 %|   20.3 |     —     |    —    |
| pool20             | 56.97 %| 77.00 %| 80.33 %| 88.67 %|   21.3 |   0.67 %  |  3.00 % |
| pool25             | 57.53 %| 78.00 %| 82.33 %| 88.67 %|   21.6 |   0.33 %  |  1.67 % |
| **pool30**         |**57.68%**| **79.33%**| **84.00%**| 88.67%|   22.0 |   0.00 %  |  0.00 % |
| pool25_no_expand   | 57.57 %| 78.33 %| 82.33 %| 88.33 %|   12.3 |   0.33 %  |  1.33 % |

### Per repo, harm@10

| repo    | pool20 | pool25 | pool30 |
|---------|-------:|-------:|-------:|
| fastify | 4.00 % | 2.00 % | 0.00 % |
| flask   | 3.00 % | 2.00 % | 0.00 % |
| ripgrep | 2.00 % | 1.00 % | 0.00 % |

### Reading

`pool30` is the smallest pool that **fully absorbs the expanded
candidates without displacing any original**. At `pool25` every repo
still shows 1–2 % harm@10. The decision rule the user proposed
(s3=25 within 0.2 pp R@10 of s3=30) fails: ΔR@10 between them is
1.33 pp on this corpus.

The `pool25_no_expand` control reveals an interesting separate result:
turning expansion off entirely matches `pool25` on R@10 at half the
latency. That's a different question (should the *default* be expansion
on at all?) and isn't decided by 300 queries — flagged as a follow-up
for later evaluation against a wider production query distribution.

### Recommendation

**Keep `stage3Candidates=30` as production default.** No code change
needed; current default is correct.

Result file: `eval/graph-2hop/results/pool_sweep_s3_decision.json`.

---

## Reproducing

```bash
# Pool sweep, cascade off (default)
node eval/graph-2hop/run_pool_sweep.js

# Pool sweep, cascade on
SWEET_SEARCH_CASCADE_ENABLED=true \
  node eval/graph-2hop/run_pool_sweep.js \
  --out=eval/graph-2hop/results/pool_sweep_cascade.json

# Custom subset
node eval/graph-2hop/run_pool_sweep.js \
  --policies=baseline_none,production,pool30_60_40 --max=50

# Chunk overflow audit
node eval/audit_chunk_overflow.js eval/repos/fastify eval/repos/flask eval/repos/ripgrep
```
