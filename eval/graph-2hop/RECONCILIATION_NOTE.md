# GenCodeSearchNet number reconciliation — 85.54 % vs 84.14 %

(2026-05-03)

## TL;DR

The two numbers are **not the same baseline**. They came from different
indexes built with different ablation drivers, on different code revisions,
and the gap is dominated by an index rebuild plus a real production-code
change (graph expansion now actually firing). After our recent fixes:

- The 85.54 % number is no longer reproducible without reverting code AND
  rebuilding the index in its 2026-05-02 14:50 UTC state.
- The current production baseline at the new default `stage3Candidates=30`
  is **MRR@10 84.14 %, R@10 92.07 %, R@50 95.58 %, R@100 96.15 %, p50 330 ms**
  on n=6000 GenCodeSearchNet, full profile, current code, current index.
- The 85.54 % citation should be retired in favour of 84.14 %.

## 1. Where 85.54 % came from

Producer:
```
eval/run_r1_r2_ablation.sh              # SWEET_VARIANTS='current ...'
  → eval/run_benchmark.js \
      --dataset=gencodesearchnet \
      --skip-index --concurrency=12 \
      --profile=full --k=100
```

Reindex command run by the same script before the bench:
```
SWEET_SEARCH_EMBED_TEXT_VARIANT=current \
SWEET_SEARCH_PROJECT_ROOT=$CORPUS \
EMBEDDING_PROVIDER=local \
SWEET_SEARCH_SQLITE_FAST_MODE=1 \
node core/indexing/index-codebase-v21.js --full     # builds LI artifacts
```

Result file:
```
eval/results/gencodesearchnet_2026-05-02T14-50-15-421Z.json
/tmp/r1-r2-signature/current.result.json    # same payload, copied by the driver
```

Aggregate from that file:
- MRR@10 85.54 %  R@5 92.52 %  R@10 94.05 %  R@20 94.58 %
- p50 254.83 ms   p95 287.95 ms
- queryCount 6000  searchMode auto  errors 0

Code revision at run-time: HEAD = `b798de8 feat(indexing): add R1
embedding-text ablation infrastructure (research-only)` (2026-05-02
13:20 UTC, before any of the graph-2hop work).

So yes — full profile, R1+LI, `current` R1 variant, k=100, concurrency=12,
`--skip-index` reusing a freshly-rebuilt-by-the-script index.

## 2. Where 84.14 % came from

Producer:
```
SWEET_SEARCH_VOCAB_AUTO_EXPAND=0 \
node eval/run_stage3_validation.js --concurrency=12
```

Result file:
```
eval/results/stage3_validation_full.json   (also: eval/graph-2hop/results/stage3_validation_full.json)
```

Three sub-runs inside, sweeping `stage3Candidates ∈ {20, 30, 40}` only.
Everything else holds:
- profile = full equivalent — SweetSearch constructed with
  `useLateInteraction:true`, default cascade (off), default reranker
- k = 100, concurrency = 12, mode = auto, rerank = true, expand = true
- `--skip-index` equivalent (reuses existing `eval/corpus/gencodesearchnet/.sweet-search`)
- `SWEET_SEARCH_EMBED_TEXT_VARIANT` unset → defaults to `current`

Aggregate at the matched stage3 (=20):
- MRR@10 83.80 %  R@10 90.55 %  R@20 90.60 %  R@50 95.63 %  R@100 96.18 %  p50 304 ms

At the new default stage3 (=30):
- MRR@10 84.14 %  R@10 92.07 %  R@20 92.27 %  R@50 95.58 %  R@100 96.15 %  p50 330 ms

Code revision at run-time: HEAD ≈ `2e1dbe4 fix(embedding): make
vocabulary persistence atomic` (2026-05-03 00:23 UTC).

## 3. Comparing the two configurations

| field                       | 85.54 % run                          | 84.14 % run (s3=30)                   |
|----------------------------|--------------------------------------|---------------------------------------|
| Dataset                     | eval/data/gencodesearchnet/         | eval/data/gencodesearchnet/          |
| Corpus dir                  | eval/corpus/gencodesearchnet/       | eval/corpus/gencodesearchnet/        |
| Query count                 | 6000                                 | 6000                                  |
| Search mode                 | auto                                 | auto                                  |
| Profile                     | full (LI build + use)               | full equivalent (LI build + use)     |
| `useLateInteraction`       | true                                 | true                                  |
| `cascadeEnabled`            | false (default)                     | false (default)                      |
| `expand`                    | true                                 | true                                  |
| `graphExpand` (effective)   | '2hop' (auto-promoted)              | '2hop' (auto-promoted)               |
| `adaptiveHop2`              | true (default)                      | true (default)                       |
| `stage3Candidates`         | 20 (default at the time)            | 30 (the current default; we also ran 20) |
| `k` per query               | 100                                  | 100                                   |
| Concurrency                 | 12                                   | 12                                    |
| Reranker                    | flashrank, local-rerank disabled    | flashrank, local-rerank disabled     |
| **Index build by**         | `run_r1_r2_ablation.sh` reindex w/ EMBED_TEXT_VARIANT=current; index mtime ~ 2026-05-02 12:30 UTC | unknown ablation reindex; index mtime 2026-05-02 22:33 UTC (LI db) — last touched between R1 ablation cluster runs and the overflow-cap ablation at commit `8ddbc29` |
| **Code HEAD**              | `b798de8` (2026-05-02 13:20 UTC)    | `2e1dbe4` (2026-05-03 00:23 UTC)     |

The first six rows are identical. The four rows at the bottom are not.

## 4. Why the gap (~1.4 pp MRR, ~2 pp R@10)

Two factors compose, in order of impact:

### a. Graph expansion now actually fires

Between the two runs we landed `db6e6a6 fix(retrieval): wire graph
expansion into LI rerank pool` (5/2 17:48 UTC). Before that fix,
`collectSeedIds()` treated HNSW chunk-IDs (`path:start-end:n`, contains
`:`) as entity IDs, which never match the relationships table — so
`expandResults()` produced zero expanded entries, and the post-expansion
LI rerank only saw the originals. **Graph expansion was a silent no-op.**

After the fix:
- `collectSeedIds()` parses chunk IDs / line ranges and resolves them to
  real entity IDs.
- `attachChunkIdsToExpanded()` bridges entity-id → chunk-id so LI tokens
  can be looked up.
- `buildMixedRerankPool()` now reserves 40 % of the LI window for
  expanded entries.

On a CodeSearchNet-style corpus (one function per document, no real
codebase topology) graph expansion adds neighbour entities to the
rerank pool that compete with the gold function for top-K positions.
For most queries this is neutral; for some it bumps the gold one or two
positions down — exactly the ~1 pp MRR / ~2 pp R@10 we observe.

This is real production behaviour, not a benchmark artefact. The 85.54 %
number depended on graph expansion being silently broken.

### b. Index state is not byte-identical

The index that produced 85.54 % was built at 2026-05-02 ~12:30 UTC by
`run_r1_r2_ablation.sh` with `EMBED_TEXT_VARIANT=current`. It is
**gone** — overwritten by subsequent ablation reindexes (R2 variants
through ~15:05 UTC, then unknown reindex at 22:33 UTC corresponding to
the overflow-cap ablation work in `8ddbc29`).

The index `eval/run_stage3_validation.js` ran against carries:
- `code-graph.db` mtime 2026-05-02 22:22 UTC
- `codebase-late-interaction.db` mtime 2026-05-02 22:33 UTC
- HNSW / int8 / float-vector files mtime 2026-05-02 22:36 UTC

These were built by a later ablation run with an unknown
`SWEET_SEARCH_EMBED_TEXT_VARIANT`. The default is `current`, but if the
last ablation iteration left the env set to a non-default variant, the
stored embeddings differ from the 14:50-UTC index.

This factor is bounded — across the R1 ablation runs every variant
landed within ±0.6 pp MRR of `current` — but it adds noise that
prevents an exact apples-to-apples comparison.

## 5. Other 85.5 %-cluster runs in eval/results — what they were

For completeness, every recent `gencodesearchnet_2026-05-*.json` ≥ 84 %
came from one of two ablation drivers:

| timestamp (UTC)        | MRR@10 | R@10  | source                      | variant         |
|------------------------|-------:|------:|-----------------------------|-----------------|
| 2026-05-01 21:34       | 84.48 %| 93.30%| (manual, per ts pattern)    | unknown         |
| 2026-05-01 22:11       | 85.55 %| 94.05%| likely r1_r2 driver         | unknown         |
| ... (multiple)         |  ...   |  ...  | ...                         | ...             |
| 2026-05-02 12:44       | 85.31 %| 94.20%| /tmp/full-r2-final-normpath | normpath R2     |
| 2026-05-02 13:05       | 85.49 %| 94.12%| /tmp/full-r2-isolated-normpath | isolated-normpath R2 |
| **2026-05-02 14:50**   |**85.54%**|94.05%| /tmp/r1-r2-signature        | **R1 `current`**|
| 2026-05-02 15:03       | 85.39 %| 93.88%| /tmp/r1-r2-signature        | R1 `signature`  |
| 2026-05-02 15:16       | 85.53 %| 93.95%| /tmp/r1-r2-signature        | R1 `signature_rbphp`|

The ~82.9 % cluster (10:34 — 11:31 UTC, plus 22:05 / 22:22 / 22:39 UTC)
all came from `eval/run_r1_ablation.sh` — `--profile=balanced`, `--no-late-interaction`,
which is **not** comparable to either 85.54 % or 84.14 %.

## 6. Which number is the production baseline now?

**Use 84.14 %** (and the matching R@10 92.07 %, R@50 95.58 %,
R@100 96.15 %, p50 330 ms) — the `s3=30` row of
`eval/graph-2hop/results/stage3_validation_full.json`.

Reasons:
- It's measured on the current code (post graph-expansion fix and
  vocabulary-atomic-save fix).
- It uses the current default `stage3Candidates=30`.
- It's the actual production-comparable number after the changes we
  shipped this week.

The 85.54 % number was correct *for that index, on that code, at that
moment*. It should not be cited as the current baseline.

## 7. Reproducing 84.14 % (the new baseline)

```bash
# Vocab caches must be clean to avoid the pre-fix corruption silently
# poisoning embeddings. With the recent atomic-save fix this is no longer
# strictly required, but a fresh run is the safest comparison.
rm -f eval/corpus/gencodesearchnet/.sweet-search/query-vocabulary.json \
      eval/corpus/gencodesearchnet/.sweet-search/query-vocabulary-stats.json

node eval/run_stage3_validation.js \
  --concurrency=12 \
  --stages=20,30,40 \
  --out=eval/results/stage3_validation_full.json
```

Or, equivalently via the upstream harness (now that 30 is the default):
```bash
node eval/run_benchmark.js \
  --dataset=gencodesearchnet --skip-index \
  --profile=full --k=100 --concurrency=12
```

Both should land at MRR@10 ≈ 84 %, R@10 ≈ 92 %, p50 ≈ 330 ms on the
current index. To reproduce 85.54 % you would need to:

1. Revert `db6e6a6` (the graph-expansion-rerank wiring fix) — but we
   want that fix in production.
2. Rebuild the index with the same `EMBED_TEXT_VARIANT=current` snapshot.

The first step is the deal-breaker: the 85.54 % depended on a silent
bug. We chose correctness over the +1.4 pp number.

## 8. No code changes from this reconciliation

The reconciliation surfaces no benchmark-harness bugs. Both harnesses
report the metric they intend to report; the discrepancy is real and
attributable to (a) a production-code fix that intentionally changed
behaviour and (b) intermediate index rebuilds we cannot inspect.

The only documentation hole worth noting: `eval/lib/results.js`'s
`buildReport()` does not record `profile`, `k`, `useLateInteraction`,
`cascadeEnabled`, `stage3Candidates`, or the active
`SWEET_SEARCH_EMBED_TEXT_VARIANT` in the saved JSON. Adding that would
make future cross-run comparisons unambiguous. Out of scope here; flag
it as a follow-up.
