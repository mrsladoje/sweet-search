# Adaptive Lexical Suppression Plan

**Status**: Draft
**Created**: 2026-03-25
**Goal**: Add corpus-adaptive DF-threshold suppression on the lexical/BM25 path only. Keep dense + late-interaction queries untouched, and treat any `STOP_WORDS` cleanup as a separate follow-on decision.

## Problem

`core/vocab-miner-utils.js:16` defines a static `STOP_WORDS` set with two sections:

1. **English filler** (~70 words): `the`, `a`, `is`, `of`, `with`, etc. — universally low-value, fine to keep static.
2. **Code keywords** (~18 words): `var`, `let`, `const`, `function`, `return`, `class`, `new`, `true`, `false`, `null`, `undefined`, `void`, `typeof`, `instanceof`, `import`, `export`, `default`, `require`, `module` — these are over-aggressive.

The code keywords are stripped during vocabulary mining (identifier splitting, NL tokenization, export/import extraction, etc.) but **not** during live BM25 queries. This creates an asymmetry in the prewarm/mining pipeline, but it does **not** directly change the live FTS5 lexical index:

- In vocab mining / prewarm: `function` is dropped from mined terms
- In live lexical search: user searches "async function handler" → FTS5 still sees all three tokens from the `entities_fts` index

Meanwhile, c-TF-IDF in `vocab-miner-nl.js:92-161` already computes corpus-adaptive document frequency per community. And `vocab-ranker.js:86` already has `computeIDF()`. The repo already has DF-style thinking, but it is not wired into the live BM25 query path.

The live lexical path uses SQLite FTS5 with `tokenize='porter unicode61'` in `core/graph-extractor.js:137-145`. That means any DF-based suppression must align with **FTS-analyzed terms**, not naive whitespace tokens, or we risk suppressing the wrong thing.

## What We're NOT Doing

- Not adding more stopwords to the static list
- Not filtering dense or late-interaction queries
- Not touching the ColBERT skiplist (`late-interaction-model.js:108`) — that's punctuation-level, correct as-is
- Not touching token pooling (`late-interaction-model.js:305`) — orthogonal concern
- Not building SPLADE/BM42 — those are separate tracks in TODO.md
- Not changing `STOP_WORDS` in the first rollout — that is a separate vocab/prewarm decision

## Design

### Phase 0: Measure Baseline

Before touching anything, capture current eval metrics so we can detect regressions.

```bash
node eval/run_all.js --suite lexical --output baseline-before-suppression.json
```

Record: Recall@5, Recall@10, Recall@20, MRR@10, p50/p95 latency for lexical and hybrid modes.

### Phase 1: Expose Per-Term DF From Existing FTS5 Index

**Files**: `core/graph-extractor.js`, `core/graph-search.js`

Use FTS5's existing vocabulary view instead of inventing a new DF store. `fts5vocab` can produce analyzed term statistics directly from `entities_fts`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts_vocab
  USING fts5vocab(entities_fts, 'row');
-- Columns: term, doc (document count), cnt (total occurrences)
```

This is effectively free relative to building a second DF system, and it stays aligned with the actual FTS index.

If the vocab table already exists in an indexed DB, `GraphSearch` can read it directly. If not, graph extraction should create it when building the FTS schema.

### Phase 2: Build An FTS-Aligned Query Analyzer

**File**: `core/graph-search.js`

Do **not** use naive `query.toLowerCase().split(/\s+/)`. The live FTS path uses `porter unicode61`, so the suppression gate must work on the same analyzed terms that `fts5vocab.term` stores.

Practical approach:

1. Keep the main code graph DB read-only, as it is today.
2. Create a small in-memory SQLite sidecar analyzer DB at `init()` time.
3. In that sidecar, create a single-column FTS5 table with the same tokenizer:

```js
CREATE VIRTUAL TABLE query_fts USING fts5(text, tokenize='porter unicode61');
CREATE VIRTUAL TABLE query_fts_vocab USING fts5vocab(query_fts, 'row');
```

To analyze a query:

1. Clear the one-row temp table.
2. Insert the raw query string.
3. Read analyzed terms from `query_fts_vocab`.

This yields the same kind of token normalization/stemming that the main FTS index uses, without opening the production DB read-write.

At the same time, load `entities_fts_vocab` into a cached `Map<string, number>` of `term -> df_ratio`.

### Phase 3: DF-Gated BM25 Query Rewriting

**File**: `core/graph-search.js` — new private method `_suppressHighDfTokens(query)`

For BM25 queries (both `bm25Search` and `bm25SearchRaw`), before sending to FTS5:

1. Preserve `rawQuery` exactly as entered
2. Analyze `rawQuery` through the sidecar FTS5 analyzer to get `analyzedTerms`
3. For each analyzed term, look up `_tokenDfRatio`
4. If `df_ratio > threshold` (default: 0.70), mark that analyzed term as suppressible
5. **But**: never suppress if the original query is identifier-shaped (`camelCase`, `snake_case`, `PascalCase`, dotted path, etc.)
6. **But**: never suppress if the rewrite would leave fewer than `minKeptTerms` analyzed terms
7. **But**: never suppress quoted / phrase-like queries in v1
8. Rebuild an FTS query string from the kept terms only for the FTS5 branch

Important: suppression is an **FTS-query rewrite**, not a user-query rewrite. The original `rawQuery` must still be used for trigram fallback, logs, and any non-FTS path.

```js
_rewriteFtsQueryWithDfSuppression(rawQuery, threshold = 0.70) {
  if (this.isStrictIdentifierQuery(rawQuery)) return { rewritten: rawQuery, suppressed: [], kept: [] };
  if (looksQuotedOrPhraseLike(rawQuery)) return { rewritten: rawQuery, suppressed: [], kept: [] };

  const analyzedTerms = this._analyzeFtsTerms(rawQuery);
  if (analyzedTerms.length <= 2) return { rewritten: rawQuery, suppressed: [], kept: analyzedTerms };

  const suppressed = [];
  const kept = [];

  for (const term of analyzedTerms) {
    const dfRatio = this._tokenDfRatio?.get(term) ?? 0;
    if (dfRatio > threshold) suppressed.push({ term, dfRatio });
    else kept.push(term);
  }

  if (kept.length < 2) {
    suppressed.sort((a, b) => a.dfRatio - b.dfRatio);
    while (kept.length < 2 && suppressed.length > 0) kept.push(suppressed.shift().term);
  }

  return {
    rewritten: kept.join(' '),
    suppressed: suppressed.map(x => x.term),
    kept,
  };
}
```

Note: identifier exemption must inspect the **original** `rawQuery`, not a lowercased copy, or camelCase/PascalCase detection breaks.

### Phase 4: Wire Into BM25 Path Only

**File**: `core/graph-search.js`

In `bm25SearchRaw()` and `bm25Search()`, keep two variables:

- `rawQuery`: untouched user query
- `ftsQueryInput`: BM25-only rewritten query after DF suppression

Then, before calling `sanitizeFtsQuery()`:

```js
const rawQuery = query;
let ftsQueryInput = rawQuery;

if (this.config.lexicalSuppression.enabled) {
  const rewrite = this._rewriteFtsQueryWithDfSuppression(rawQuery, this.config.lexicalSuppression.dfThreshold);
  if (rewrite.kept.length > 0) {
    ftsQueryInput = rewrite.rewritten;
  }
}
```

**Not** applied to:
- `hybridDefinitionSearch()` — identifier queries, already name-restricted
- Semantic search — embedding model sees full query
- Late interaction — MaxSim sees full query
- Trigram fallback — fuzzy matching must continue using `rawQuery`

Also update the code paths so:

- FTS5 uses `sanitizeFtsQuery(ftsQueryInput)`
- Trigram uses `rawQuery`
- Abbreviation expansion continues to use `rawQuery` unless explicit experiments show the rewritten query is better
- Logs show both the original query and the suppression decision

### Phase 5: Eval + Threshold Tuning

Re-run the eval harness and compare against Phase 0 baseline:

```bash
node eval/run_all.js --suite lexical --output after-suppression-0.70.json
```

Sweep thresholds: 0.50, 0.60, 0.70, 0.80, 0.90. Measure Recall@10, MRR@10, latency, and query-class breakdowns. Pay special attention to:

- structural multi-word queries: `async function handler`, `class inheritance`
- identifier-like queries that should remain untouched
- short 1-2 term queries
- mixed NL/code queries

Success criteria:
- no measurable regression on identifier and short-query eval sets
- lexical/hybrid MRR improves or stays flat on structural mixed queries
- p95 lexical latency stays within budget
- suppression logs show that common structural filler is being dropped without collapsing the query

### Phase 6: Config + Observability

**File**: `core/config.js`

```js
lexicalSuppression: {
  enabled: false,
  dfThreshold: 0.70,     // suppress tokens in >70% of entities
  minKeptTerms: 2,        // never suppress below this
  exemptIdentifiers: true, // skip identifier-shaped raw queries
  skipPhraseQueries: true,
},
```

**Logging**: Add to `bm25Search`/`bm25SearchRaw` log lines:

```
[bm25Search] raw="async function handler" fts="async handler" suppressed=[function] kept=[async,handler] threshold=0.70
```

### Phase 7: Optional Follow-On: Revisit `STOP_WORDS`

**File**: `core/vocab-miner-utils.js`

This is explicitly **not** part of the first lexical suppression rollout.

After the BM25 experiment has been benchmarked independently, decide whether to shrink the hardcoded code-keyword section in `STOP_WORDS` for vocab/prewarm quality. That is a separate change because:

- it affects vocab mining and prewarm behavior, not live FTS5 indexing directly
- it requires its own tests and evals
- it should be judged on vocab/prewarm outcomes, not only lexical BM25 outcomes

## File Changes Summary

| File | Change | Risk |
|------|--------|------|
| `core/graph-extractor.js` | Ensure `fts5vocab` view exists for `entities_fts` | None — metadata view of existing index |
| `core/graph-search.js` | Add DF cache, in-memory FTS analyzer, BM25-only rewrite, raw/rewritten query split | Low-Medium — gated by config flag |
| `core/config.js` | Add `lexicalSuppression` config block | None |
| `tests/` | New tests for analyzed-term rewrite, rawQuery preservation, phrase/identifier exemptions | None |

## Rollback

If eval regresses: leave the DF cache and analyzer in place, but keep `lexicalSuppression.enabled = false`. No re-index is required for rollback because the first rollout does not change `STOP_WORDS` or the main FTS schema.

## Open Questions

1. **Threshold per-language?** A JS codebase has different DF distributions than Go or Rust. Start with one threshold, tune later.
2. **Phrase queries?** v1 should skip suppression for quoted / phrase-like queries entirely.
3. **FTS unit of frequency?** `fts5vocab` counts documents (entities), not files. That matches the retrieval unit for lexical search today.
4. **Analyzer sidecar cost?** Measure init-time and per-query overhead of the in-memory FTS analyzer before enabling by default.
5. **Abbreviation expansion ordering?** Use `rawQuery` first unless evals show that expanding from the rewritten FTS query is better.

## References

- Vespa stopword-limit: https://docs.vespa.ai/en/performance/feature-tuning.html
- Lucene QueryAutoStopWordAnalyzer: uses index DF to compute stopwords
- DF-FLOPS (2025): https://arxiv.org/abs/2505.15070 — DF-aware selective suppression > blunt removal
- KeyDAC: https://aclanthology.org/2023.eacl-main.262/ — preserving query keywords matters in code search
- Existing infra: `vocab-ranker.js:86` (`computeIDF`), `vocab-miner-nl.js:92` (c-TF-IDF), `late-interaction-model.js:108` (ColBERT skiplist)
