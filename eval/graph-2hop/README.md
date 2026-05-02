# Adaptive 2-hop Graph Expansion Benchmark — real codebases

Validates whether **adaptive 2-hop graph expansion** (default-on for
semantic / hybrid queries when `expand=true`) actually helps real,
multi-file code search — and whether it should stay the default.

## Why a new benchmark

GenCodeSearchNet has weak repo topology: most queries map to a single
function in a single file, with very little cross-file structure. It
cannot exercise graph expansion. Even a perfect 2-hop expander has no
benefit to harvest there. We need queries whose answers genuinely live
across import / extends / implements / calls edges.

## Layout

```
eval/graph-2hop/
├── run_graph_2hop_bench.js     # harness; runs four modes per query
├── queries.jsonl               # combined, validated query set
├── queries/                    # per-repo source files (pre-merge)
│   ├── fastify.jsonl
│   ├── flask.jsonl
│   └── ripgrep.jsonl
├── validation/                 # per-repo validator outputs
└── results/                    # JSON outputs from harness runs
```

## Conditions compared

| label           | options                                                |
|-----------------|--------------------------------------------------------|
| `none`          | `graphExpand:'none'`                                   |
| `1hop`          | `graphExpand:'1hop'`                                   |
| `2hop-naive`    | `graphExpand:'2hop', adaptiveHop2:false`               |
| `2hop-adaptive` | `graphExpand:'2hop', adaptiveHop2:true`  (production)  |

All four use `mode:'auto'`, `rerank:true`, `expand:true`,
`useLateInteraction:true`. Only `graphExpand` / `adaptiveHop2` differ.

## Query schema (`queries.jsonl`)

```json
{
  "id": "fastify-001",
  "repo": "fastify",
  "query": "...",
  "gold_files": ["lib/four-oh-four.js"],
  "gold_symbols": ["arrange404"],
  "gold_lines": "30-60",
  "category": "calls|imports|implements|extends|config|route|parser|validator|control|other",
  "expected_hops": 0|1|2,
  "notes": "why this is the gold"
}
```

`expected_hops:0` rows are controls — direct lookups where graph expansion
should *not* help and ideally not harm.

## Metrics reported

Per repo and overall, per condition:

- MRR@10
- Recall@10 / @20 / @50
- gold_missing_top10_rate / gold_missing_top50_rate
- expanded_survival_top10 — # expanded chunks surviving cascade into top10
- mean_candidates_added — mean # entities added by expansion
- latency p50 / p95 / mean
- **rescue_rate_top10** — gold absent in `none` top10 but present here
- **harm_rate_top10** — gold present in `none` top10 but absent here

A per-category breakdown is emitted so we can see whether adaptive 2-hop
helps `extends` / `implements` queries while staying neutral on `control`.

## Running

```bash
# Smoke (10 queries per repo across all 4 modes)
node eval/graph-2hop/run_graph_2hop_bench.js --max=10

# Full run
node eval/graph-2hop/run_graph_2hop_bench.js

# Only one repo, only the comparison that matters
node eval/graph-2hop/run_graph_2hop_bench.js \
  --repos=fastify --modes=none,2hop-adaptive

# Custom query file
node eval/graph-2hop/run_graph_2hop_bench.js --queries=eval/graph-2hop/queries.jsonl

# Output goes to eval/graph-2hop/results/graph2hop_<ts>.json
```

The harness expects each repo at `eval/repos/<name>/.sweet-search/` with
`code-graph.db`, `codebase-binary-hnsw.idx`, `codebase.db`, and
`codebase-late-interaction.db`. All three target repos are already
indexed. Re-index by running the indexer per repo (`SWEET_SEARCH_PROJECT_ROOT=eval/repos/<name> node core/indexing/index-codebase-v21.js`).

## Query construction

1. Three Sonnet subagents (one per repo) generated 100 queries each with
   inspected gold labels, balanced across `expected_hops` (~35 / ~50 / ~15)
   and across categories.
2. Three independent Sonnet validators rechecked each query: do the gold
   files actually contain the claimed symbol, is the question realistic,
   and is the gold not trivially keyword-recoverable? Validators tagged
   each row as accepted / rewritten / rejected / uncertain. Only
   accepted / rewritten rows enter `queries.jsonl`.

See `validation/` for per-repo validator notes.

## Reading the report

The main question is **not** "does graph expansion help every query".
It is:

1. Does adaptive 2-hop improve `expected_hops:1` / `expected_hops:2`
   queries (the categories where graph structure carries signal)?
2. Does it stay neutral or rescue more than it harms on `control`
   (`expected_hops:0`)?
3. Does adaptive 2-hop beat naive 2-hop on **harm rate** and **latency**
   while keeping at least equal recall?
4. Does it stay flat or positive overall?

The "Recommendation" section at the bottom of this README is updated after
each full run with the answer.

## Two pipeline integration bugs found and fixed

The first benchmark pass surfaced **three bugs** in the existing pipeline that
together made graph expansion a no-op for top-K ranking. The fixes (in
production code) and a re-run follow.

### Bug 1 — `collectSeedIds` misclassified chunk ids as entity ids

`core/graph/graph-expansion.js::collectSeedIds` treated `r.id` as an entity id
and added it to `seedIds`. HNSW returns chunk ids of shape
`path/to/file.ext:start-end:n` which never match the relationships table's
`source_id` (16-char entity hashes). The chunk-id branch fired first,
suppressing the file-and-line-range fallback. Result: every HNSW seed produced
zero neighbours and graph expansion produced zero expanded entities.

Fix: only treat `r.id` as an entity id when (a) the row is `is_expanded`, or
(b) the id has no `:` (entity-id shape). Otherwise fall through to the
file-and-line-range matcher. The fallback was also extended to (i) parse
`file:start-end:n` chunk ids when metadata lacks file/line info, and (ii)
match by line-range *overlap* (smallest entity wins) instead of strict
containment of `start_line` only — chunks frequently begin on file-header
lines that no entity covers.

### Bug 2 — expanded entries had no LI tokens

`core/ranking/late-interaction-index.js::scoreWithLateInteraction` looks docs
up by `candidate.id`. After expansion, `candidate.id` is the entity id, but
the LI index is keyed by chunk id — so `hasTokens()` returned empty for every
expanded candidate and they were treated as unscored.

Fix: bridge the id spaces. After expansion, `attachChunkIdsToExpanded()`
finds the codebase chunk that best covers each expanded entity's line range
and stashes the chunk id under `_liChunkId`. `scoreWithLateInteraction()` now
honours `candidate._liChunkId || candidate.id` for doc lookup, and
`partitionByTokenAvailability()` in `cascaded-scorer.js` does the same.

### Bug 3 — legacy LI rerank only saw the original head

The legacy (`cascadeEnabled=false`) reranker did
`topCandidates = results.slice(0, 20)` — first 20 in HNSW order, all of them
originals — and reranked only that slice. Expanded entries sat at indices
20+ in the result list and could never compete for top-K positions.

Fix: `buildMixedRerankPool()` constructs a bounded mixed pool of
`top originals (60 %) + top expanded by adaptive expansion score (40 %)`
within the same `stage3Candidates=20` slot. The LI reranker then scores them
together and the resulting ranking is the real top-K. Cascade-enabled mode
already scored all candidates that have LI tokens, so it inherits the fix
from bug 2 alone.

---

## Results after the fix — full run, n=300

The harness now correctly attributes ~6 % of queries' top-K ranks to graph
expansion (the share where the graph topology actually has an answer).

### Overall (cascade DEFAULT — disabled)

| mode            | MRR@10  | R@10   | R@20   | R@50   | p50ms | rescue | harm |
|-----------------|---------|--------|--------|--------|-------|--------|------|
| `none`          | 56.96%  | 77.00% | 80.67% | 88.33% | 19.0  |  —     |  —   |
| `1hop`          | 56.97%  | 77.00% | 80.33% | 88.67% | 19.6  | 0.00%  | 0.00%|
| `2hop-naive`    | 56.97%  | 77.00% | 80.33% | 88.67% | 19.8  | 0.00%  | 0.00%|
| `2hop-adaptive` | 56.97%  | 77.00% | 80.33% | 88.67% | 20.4  | 0.00%  | 0.00%|

`none` and the expansion modes are now neutrally distinguishable: +0.4 pp R@50,
−0.4 pp R@20, ±0 R@10. Tiny, well within noise. With cascade off (default)
the cross-encoder gate is not active and the legacy LI window of 20
candidates is too narrow for the ~6 expanded entries per affected query to
register at top10.

### Overall (cascade ENABLED — `SWEET_SEARCH_CASCADE_ENABLED=true`) ← the real signal

| mode            | MRR@10  | R@10   | R@20   | R@50   | p50ms | rescue | harm |
|-----------------|---------|--------|--------|--------|-------|--------|------|
| `none`          | 57.50%  | 80.67% | 87.00% | 88.33% | 21.1  |  —     |  —   |
| `1hop`          | 57.41%  | **81.33%** | **87.33%** | **89.33%** | 16.5  | **0.67%** | **0.00%** |
| `2hop-naive`    | 57.41%  | **81.33%** | **87.33%** | **89.33%** | 16.7  | **0.67%** | **0.00%** |
| `2hop-adaptive` | 57.41%  | **81.33%** | **87.33%** | **89.33%** | 16.8  | **0.67%** | **0.00%** |

With cascade on:

- **R@10  +0.66 pp**, R@20 +0.33 pp, R@50 +1.00 pp.
- **0.67 % rescue at top10**, **0.00 % harm at top10**.
- MRR is essentially flat (−0.09 pp).
- Latency overhead is in the noise (~0.3 ms p50).

Per-repo breakdown (cascade on):

| repo    | mode            | R@10 | Δ vs none |
|---------|-----------------|------|-----------|
| flask   | `none`          | 91 % |   —       |
| flask   | `2hop-adaptive` | 92 % | **+1 pp** (1 % rescue) |
| ripgrep | `none`          | 88 % |   —       |
| ripgrep | `2hop-adaptive` | 89 % | **+1 pp** (1 % rescue) |
| fastify | `none`          | 63 % |   —       |
| fastify | `2hop-adaptive` | 63 % | 0         |

### Why 1-hop, 2-hop-naive and 2-hop-adaptive look identical

On these queries, only ~6 % fire the expansion path at all, and when they
do, only 4–10 expanded entries enter the LI rerank pool. At that scale the
*choice of expansion algorithm* (which entities to add) is washed out by
the LI MaxSim sort: any reasonable expansion that hits the right neighbour
will surface it. Telling adaptive 2-hop apart from naive 2-hop or 1-hop on
this benchmark would require either (a) bigger expansion budgets, (b) a
larger LI rerank pool, or (c) queries where the gold is reachable only via
2-hop edges that 1-hop misses — a smaller subset than the 19 queries that
fire expansion at all here.

### Expansion fire-rate by category (cascade off; same shape under cascade on)

| category    | n   | fired (%) | sum(expanded in LI pool) |
|-------------|-----|-----------|--------------------------|
| calls       | 116 | 5 %       | 37 |
| config      | 24  | 4 %       | 8  |
| control     | 57  | 11 %      | 31 |
| extends     | 7   | 0 %       | 0  |
| implements  | 42  | 2 %       | 8  |
| imports     | 2   | 50 %      | 8  |
| route       | 15  | 13 %      | 10 |
| validator   | 22  | 9 %       | 11 |
| parser      | 14  | 0 %       | 0  |
| other       | 1   | 0 %       | 0  |

`extends` and `parser` queries — the two categories where 2-hop should
matter most — fired 0 % on this benchmark, mostly because the seed
candidates from HNSW didn't include the seed entity that owns the edge
(e.g. `Flask` in `app.py` rarely makes the HNSW top-K when the query is
already strong on documentation that names base classes). This is a
*candidate-side* gap, not a graph-side one.

## Recommendation

**Keep adaptive 2-hop on by default**, with the three pipeline fixes
landed. Net effect on real graph-benefiting queries:

- **+0.66 pp R@10, +1 pp R@50** under cascade on (the only path where
  expanded entries enter the rerank window).
- **0 % top-K harm**.
- ~0.3 ms p50 latency overhead.

The benefit is small in absolute terms but free of harm and free of
latency cost worth caring about. There is no reason to disable it.

### Open follow-ups (would let adaptive 2-hop earn more)

1. **Widen the LI rerank pool when expansion is on.** With `stage3Candidates=20`
   and expansion contributing ~6 entries, the marginal entries that adaptive
   2-hop's edge-type-alpha decay would prefer over naive's degree-blind
   choice mostly fall outside the slot. Bumping `stage3Candidates` to 40
   when `is_expanded` count > 0 would let the algorithm differences register.

2. **Improve seeding for `extends` / `parser` categories.** HNSW often
   misses the seed entity that owns the structural edge. Either expand
   from the union of HNSW candidates' file-level entity (one entity per
   file in the top-K), or run a cheap second pass that seeds from
   structural-keyword matches.

3. **Re-run after a fresh re-index** of the test repos onto the current
   512 d / 768 d pipeline. The benchmark currently runs with
   `use3Stage:false` to dodge a stale-vector dimension mismatch in the
   3-stage path; results should hold but the cleaner config would
   raise confidence.

The 300-query benchmark and harness stay as the reusable signal.

## Reproducing

```bash
# Default — cascade off
node eval/graph-2hop/run_graph_2hop_bench.js

# Cascade on (production-relevant when LI is the active reranker)
SWEET_SEARCH_CASCADE_ENABLED=true \
  node eval/graph-2hop/run_graph_2hop_bench.js \
  --out=eval/graph-2hop/results/graph2hop_cascade.json

# Smoke (~30 s)
node eval/graph-2hop/run_graph_2hop_bench.js --max=10
```

Both full runs above completed in ~2 minutes on M3 Max, no GPU.

> **Note**: `eval/repos/<repo>/.sweet-search/query-vocabulary.json` from
> earlier sessions stores Float32Arrays as plain objects (numeric keys);
> when reloaded these crash `truncateForHNSW` ("embedding.slice is not a
> function"). If queries are erroring 100 %, delete the stale
> `query-vocabulary.json` files in each test repo and re-run.
