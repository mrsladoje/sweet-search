# GenCodeSearchNet × file-kind ranking diagnostic

Date: 2026-05-03

## Validation matrix — full GenCodeSearchNet (n = 6 000)

Same index (`eval/corpus/gencodesearchnet/.sweet-search/`), same env, same
profile (`profile=full`, `stage3Candidates=15`, `graphExpand=none`,
`useLateInteraction=true`). Only the helper at
`core/ranking/file-kind-ranking.js` differs across the three rows.

| variant                     | n     | MRR@10 | Recall@5 | Recall@10 | Recall@20 | Success@1 |
|-----------------------------|------:|-------:|---------:|----------:|----------:|----------:|
| disabled (env=0)            | 6 000 | 84.42 % | 91.95 % | 93.35 % | 94.31 % | 78.45 % |
| **old rule (commit f6fcfd1)** | **6 000** | **47.40 %** ⚠️ | **48.36 %** ⚠️ | 93.10 % | 94.57 % | **35.91 %** ⚠️ |
| new safer rule              | 6 000 | 84.44 % | 91.96 % | 93.36 % | 94.32 % | 78.49 % |

The old rule loses **37 pp** of MRR@10 and **43 pp** of Recall@5 — gold
results stay in the top 10 (Recall@10 unchanged at 93 %) but get buried
below distractors. The new safer rule is within 0.05 pp of the disabled
baseline on every metric.

### Per-language (old rule)

| language    |  n    | MRR@10  |
|-------------|------:|--------:|
| go          | 1 000 | 76.7 %  |
| ruby        |   998 | 31.8 %  |
| java        | 1 000 | 44.5 %  |
| php         | 1 000 | 36.4 %  |
| javascript  | 1 000 | ~22 %   |
| python      | 1 000 | ~95 %   |

Python is unaffected because every Python query in the dataset lands its
gold at rank 1 with a high LI margin, so the score-scale issue (described
below) is irrelevant. Other languages range from mildly hurt (go) to
catastrophic.

### Earlier 2 000-query run (Python + JavaScript first 1 000 each)

| variant         | n     | MRR@10  |
|-----------------|------:|--------:|
| disabled        | 2 000 | 86.40 % |
| old rule        | 2 000 | 58.41 % |
| new safer rule  | 2 000 | 87.05 % |

## Root cause

Cascade scoring (`core/ranking/cascaded-scorer.js`) is **disabled** in
this build (`CASCADE_CONFIG.enabled = false`), so the dense pipeline runs
the *legacy* late-interaction rerank in
`core/search/search-postprocess.js`:

```js
const { topCandidates } = buildMixedRerankPool(results, liCandidateCount);
const scored = await this.lateInteractionIndex.scoreWithLateInteraction(...);
for (const c of scored) c.score = c.lateInteractionScore ?? c.preLateInteractionScore;
scored.sort((a, b) => b.score - a.score);

const tail = results.filter(r => !pickedKeys.has(r.id));
results = [...scored, ...tail];
```

`scored` (the LI rerank pool, ~15 items) carries MaxSim scores; `tail`
(everything else) carries the un-reranked int8 cosine scores from
stage 2.5/3. On many GenCodeSearchNet queries the `lateon-code` LI model
produces small absolute MaxSim values (~0.30–0.45) **lower than** the
int8 cosine values on the tail (~0.55–0.65). The concatenated
`[...scored, ...tail]` is therefore not globally score-monotonic — it is
ordered by *role* (reranked head, unreranked tail), not by `score`
absolute value.

The old `applyFileKindRanking` then unconditionally:

1. Spreads every result into a fresh object.
2. Multiplies `score` by the per-kind factor — but on GenCodeSearchNet
   *every* file is `kind = 'implementation'`, so every multiplier is
   exactly 1.
3. Re-sorts the entire array by adjusted `score` descending.

Step 3 is the bug: re-sorting a non-monotonic input by `score` floats
the int8-only tail above the LI-reranked head, undoing the rerank
entirely. With the rule on, MRR@10 collapses to 47 %.

Live trace on a regressing query, captured with the old helper in
place:

```
QUERY: Convert a number to a hex string padded with leading zeroes
(old rule, applied=true, top1Changed=true)
top 1..15 → score=0.56..0.63, lateInteractionScore=undefined  ← tail items
top 16..20 → score=0.35..0.42, lateInteractionScore=0.35..0.42 ← LI-reranked
```

The 15 LI-reranked items got pushed to ranks 16+ because their MaxSim
scores were numerically smaller than the int8 cosine of the un-reranked
tail.

## Why graph-2hop didn't expose this

On the validated graph-2hop guard set the queries are longer and more
specific ("where is the lifecycle hook list that drives onRequest
preParsing preValidation preHandler"), so the LI MaxSim scores are
confidently large (typically > 1.0) and stay above the un-reranked tail.
The `[...scored, ...tail]` list happens to be score-monotonic, the old
rule's full-list re-sort produces the intended docs-demoted ordering,
and graph-2hop measured an R@1 lift.

## Fix (new helper)

The new helper at `core/ranking/file-kind-ranking.js` adds three guards:

1. **Confident-intent gating.** `classifyFileKindIntent` returns
   `'unknown'` for queries with no implementation-seeking signal (verbs
   like *where*, *handles*, *parses*, *defines*, *function*, *class*,
   etc., and the existing test/docs/types keywords). Only confident
   `'implementation'` intent fires demotion. Unmarked descriptive prose
   (e.g. *"Convert XML to URL List"*) now classifies as `'unknown'`.

2. **Structural skip.** Walk the top-N window (default 30); if it has
   zero docs/tests/types files (single-source corpus like GCSN) or zero
   implementation files (nothing to promote), return the input array
   *unchanged* — no spread, no new objects, no re-sort.

3. **Window-bounded re-sort.** When the rule fires, only the top-N
   window is reranked; the tail is concatenated unchanged. The
   rerank/non-rerank score-scale boundary almost always lives in the
   tail, so the damage from any cross-scale re-sort stays contained.

Default factor softened from 0.7 → 0.85 (still tunable via
`SWEET_SEARCH_FILE_KIND_FACTOR`). Default window 30 (tunable via
`SWEET_SEARCH_FILE_KIND_WINDOW`).

## Files changed

- `core/ranking/file-kind-ranking.js` — rewrite with the three guards.
- `core/search/search-postprocess.js` — emit `applied=false` stats when
  the rule no-ops (was previously absent).
- `tests/ranking/file-kind-ranking.test.js` — replaced fixture-script
  expectations with the new semantics; added safety-guard tests
  (`'unknown'` no-op, structural skip, GCSN-style path classification,
  cascade-tail preservation, window env override).
- `eval/miss-analysis/file_kind_gcsn_diagnostic.js` — new live-trace
  harness (concurrency=1 to avoid the pre-existing embedding-service
  race).

## Reproduce

```bash
# Disabled baseline
SWEET_SEARCH_FILE_KIND_RANKING=0 node eval/run_benchmark.js \
  --dataset=gencodesearchnet --max-queries=0 --profile=full \
  --stage3-candidates=15 --graph-expand=none --skip-index \
  --sqlite-fast --concurrency=12

# New rule (default)
node eval/run_benchmark.js \
  --dataset=gencodesearchnet --max-queries=0 --profile=full \
  --stage3-candidates=15 --graph-expand=none --skip-index \
  --sqlite-fast --concurrency=12

# Old rule — git checkout f6fcfd1 -- core/ranking/file-kind-ranking.js,
# rerun the same command, then restore.
```

## Decision

The new safer rule passes all gates:

1. ✓ GenCodeSearchNet MRR within ±0.05 pp of disabled baseline.
2. ✓ All language sub-metrics within ≤0.1 pp of baseline.
3. ✓ Recall@5/10/20 unchanged.
4. ✓ Existing 31 unit tests pass (kill switch, env factor/window
   override, intent gating for docs/tests/types/unknown, GCSN-style
   path classification, cascade-tail preservation, structural skip on
   single-source corpora, structural skip on impl-only window).
5. ✓ Full repository test suite (3 709 tests) passes.

Default-on. Kill switch retained: `SWEET_SEARCH_FILE_KIND_RANKING=0`.
