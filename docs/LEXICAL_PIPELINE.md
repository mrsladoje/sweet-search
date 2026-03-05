# Lexical Pipeline Fix Plan

**Status**: Complete
**Created**: 2026-03-05
**Goal**: Make the lexical pipeline conditional — fast for exact hits, smarter for ambiguous queries.

## Current State

The lexical path today:

```
sweet-search.js:211  ->  lexicalSearch(query, { k, expand })
  graph-search.js:983  ->  graphExpandedSearch(query, options)
    |-- isIdentifierQuery(query)?
    |   YES -> hybridDefinitionSearch() -> isExactMatchResult()?
    |   |       YES -> return direct hits (no expansion)     [mode: definition_first_exact]
    |   |       NO  -> graph expand from definitions         [mode: definition_first_graph]
    |   NO  -> bm25Search() -> isExactMatchResult()?
    |           YES -> return direct hits (no expansion)     [mode: bm25_exact_match]
    |           NO  -> graph expand from BM25 results        [mode: bm25_graph]
    +-- returns { results, stats }

search-postprocess.js:60  ->  applyPostRetrieval()
  |-- graph expansion (expandResults)      -- only when graphExpand != 'none' (default: 'none')
  |-- late interaction (MaxSim blend)      -- runs on ALL modes if LI index available
  |-- translation fallback
  |-- quality scoring
  |-- intent policy
  +-- token budget
```

### What works

1. **Definition-first path** (`graph-search.js:1000`): Identifier queries (`AuthService`,
   `getUserById`, `get_employee`) route to `hybridDefinitionSearch()` which runs definition
   lookup and BM25 in parallel, merging with definitions guaranteed in top positions.

2. **Exact match short-circuit** (`graph-search.js:935`): `isExactMatchResult()` skips
   graph expansion when the top result is a clear winner (exact name match, BM25 > 30,
   or 2x score gap over #2).

3. **Post-expansion MaxSim** (`search-postprocess.js:185`): Late interaction already runs
   on lexical results post-expansion. The TODO Section 26.5 claim "lexical gets ZERO
   reranking" is stale.

### What's wrong

1. **MaxSim runs unconditionally**: Even when `isExactMatchResult` fires and the result
   is clearly the right answer, postprocess still runs MaxSim on it. For exact identifier
   hits, MaxSim is pure overhead — it will confirm the BM25 ranking.

2. **No confidence signal propagated**: `graphExpandedSearch` knows whether the query was
   exact (via `isExactMatchResult`) or ambiguous, but this signal stays inside graph-search
   as a `stats.mode` string. The postprocess pipeline doesn't use it to decide whether
   MaxSim should run.

3. **Duplicate expansion when graphExpand is enabled**: When intent routing or explicit
   options set `graphExpand` to `1hop`/`2hop`, `expandResults()` runs in postprocess
   on top of graph-search's internal expansion. This is conditional (default `graphExpand`
   is `'none'`, set at `sweet-search.js:161`), not a universal bug, but when it happens
   the two expansions use different strategies and scoring. The internal expansion
   (hop-based, `rel_weight * relMultiplier * 0.8`) is simpler than postprocess
   `expandResults()` (adaptive hop2, edge-type alpha decay, degree normalization,
   query-dependent cosine scoring via `queryInt8`).

4. **Cross-encoder never runs on lexical** (correct behavior, but not by design): The
   cross-encoder lives inside `semanticSearch3Stage` and lexical never enters that path.
   This is the right outcome but it's accidental — there's no explicit "no cross-encoder
   for lexical" policy. If Section 26 ever moves the cross-encoder to postprocess,
   lexical would start paying for it unless we add a gate.

## Design Principles

**Expansion ownership rule**: Each lexical query expands in at most one place.

| Confidence | Internal expansion (graph-search) | Postprocess expansion (expandResults) | MaxSim |
|------------|----------------------------------|---------------------------------------|--------|
| **Exact**  | No                               | No                                    | No     |
| **High**   | No                               | No                                    | No     |
| **Ambiguous** | No (defer to postprocess)     | Yes (when graphExpand enabled)        | Yes    |

**Definition-first is always preserved**. Even for ambiguous identifiers (`config`,
`auth`), `hybridDefinitionSearch` still runs to ensure definition entities rank above
mere usages. "Ambiguous" means "defer expansion," not "drop definition-first."

**No cross-encoder for lexical by default.** BM25 exact matching and definition-first
ranking are the correct signals for identifier lookup. MaxSim serves as a cheap
tiebreaker for ambiguous lexical sets only.

## Target Pipeline

```
lexicalSearch(query)
  -> graphExpandedSearch(query)
       -> [always] isIdentifierQuery? -> hybridDefinitionSearch() : bm25Search()
       -> [always] isExactMatchResult()?
            exact    -> return hits, confidence: 'exact'
            high     -> return hits, confidence: 'high'       [BENCHMARK-GATED thresholds]
            ambiguous -> return hits WITHOUT internal expansion, confidence: 'ambiguous'
  -> applyPostRetrieval()
       -> [ambiguous only, when graphExpand enabled] expandResults()
       -> [ambiguous only] MaxSim late interaction
       -> [never] cross-encoder
       -> budget
```

## Implementation Steps

### Step 1: Propagate confidence signal from graph-search

**File**: `core/graph-search.js`

Add a `confidence` field to the stats object returned by `graphExpandedSearch`.

The three levels:
- `exact`: `isExactMatchResult()` returned true
- `high`: Benchmark-gated heuristic (see Open Questions). Until benchmarked, treat as
  `exact` — same criteria, no separate threshold. We split this out as a concept now so
  we have a place to put a softer threshold later.
- `ambiguous`: All other cases (flat BM25 scores, common terms, many definition matches)

All existing return points in `graphExpandedSearch` already have a `mode` field in stats.
Add `confidence` alongside it:

- `definition_first_exact` -> `confidence: 'exact'`
- `bm25_exact_match` -> `confidence: 'exact'`
- `definition_first_graph` -> `confidence: 'ambiguous'`
- `definition_first_only` (no results to expand) -> `confidence: 'exact'`
- `bm25_only` (expand=false or no results) -> `confidence: 'exact'`
- `bm25_graph` -> `confidence: 'ambiguous'`

### Step 2: Defer internal expansion for ambiguous queries

**File**: `core/graph-search.js`

When confidence is `ambiguous`, `graphExpandedSearch` currently runs its own expansion
(hop-based, `rel_weight * relMultiplier * 0.8`). This is simpler than `expandResults()`
in `graph-expansion.js` which has adaptive hop2, edge-type alpha decay, degree
normalization, and query-dependent cosine scoring.

For the ambiguous-identifier path (definition-first, non-exact): return the
definition-merged results WITHOUT running the internal graph expansion loop
(`graph-search.js:1040-1067`). Tag with `confidence: 'ambiguous'` so postprocess
knows to expand if `graphExpand` is enabled.

Important: **keep `hybridDefinitionSearch` results intact.** Definition-priority ranking
is valuable even for ambiguous identifiers. We only skip the expansion hop, not the
definition merge.

For the ambiguous-non-identifier path (plain BM25, non-exact): same — return BM25
results without the expansion loop (`graph-search.js:1168-1200`), tagged
`confidence: 'ambiguous'`.

### Step 3: Thread confidence through sweet-search.js

**File**: `core/sweet-search.js`

`lexicalSearch()` currently returns just the results array and logs stats. Refactor to
return `{ results, stats }` like the other search paths, so confidence propagates:

```js
case 'lexical': {
  const lexResult = await this.lexicalSearch(query, { k, expand });
  results = lexResult.results;
  stats.path = 'lexical';
  stats.confidence = lexResult.stats?.confidence;
  stats.lexicalMode = lexResult.stats?.mode;
  break;
}
```

Update `lexicalSearch` to return `{ results, stats }` instead of just the mapped array.

**Callers that need updating** (verified via grep — only 2 callers, 0 test references):

| Caller | File:Line | Change needed |
|--------|-----------|---------------|
| Main search dispatch | `sweet-search.js:212` | Unwrap `{ results, stats }` (this step) |
| Legacy `hybridSearch` | `search-hybrid.js:122` | Unwrap: `const lexResult = await this.lexicalSearch(...); const lexicalResults = lexResult.results;` |

`hybridSearchV2` is NOT affected — it calls `graphExpandedSearch` directly, not
`lexicalSearch`.

### Step 4: Gate postprocess expansion on confidence

**File**: `core/search-postprocess.js`

When `stats.path === 'lexical'` AND confidence is `exact` or `high`, skip
`expandResults()`. For ambiguous lexical, let the existing guard (`graphExpand !== 'none'`)
decide — postprocess expansion runs only if intent routing or explicit options enable it.

```js
// search-postprocess.js:135 — modify the guard:
const isConfidentLexical = stats.path === 'lexical'
  && stats.confidence !== 'ambiguous';

const shouldExpand = effectiveGraphExpand !== 'none'
  && this.hasGraphIndex
  && Array.isArray(results) && results.length > 0
  && !isConfidentLexical;
```

### Step 5: Gate MaxSim on confidence

**File**: `core/search-postprocess.js`

When `stats.path === 'lexical'` AND confidence is `exact` or `high`, skip the late
interaction block:

```js
// search-postprocess.js:190 — add to shouldRunLateInteraction:
const isConfidentLexical = stats.path === 'lexical'
  && stats.confidence !== 'ambiguous';

const shouldRunLateInteraction = this.hasLateInteractionIndex
  && (options.useLateInteraction ?? this.useLateInteraction)
  && !this.lateInteractionIndex.modelMismatch
  && Array.isArray(results) && results.length > 0
  && !isConfidentLexical;
```

(Reuse `isConfidentLexical` from Step 4 — compute once at the top of `applyPostRetrieval`.)

### Step 6: Explicit no-cross-encoder policy

**File**: `core/search-postprocess.js`

Add a policy annotation. No code change needed today — the cross-encoder doesn't run in
postprocess. This is defensive for when Section 26 (pipeline restructuring) lands:

```js
// POLICY: Lexical queries never invoke the cross-encoder by default.
// BM25 exact matching + definition-first ranking are the correct signals
// for identifier lookup. MaxSim serves as a tiebreaker for ambiguous sets only.
// If Section 26 moves the cross-encoder to postprocess, gate it on:
//   stats.path !== 'lexical'
```

## Testing

1. **Exact identifier** (`AuthService`): Verify no expansion, no MaxSim, definition at #1
2. **High-confidence** (`getUserById`): Same — direct hit, no extras
3. **Ambiguous single word** (`config`): Verify definition-first ranking preserved,
   expansion runs (when graphExpand enabled), MaxSim runs as tiebreaker
4. **Ambiguous partial** (`auth`): Same as config — common term, flat BM25 scores
5. **Non-identifier ambiguous** (`error handling`): Multi-word, falls to plain BM25 path,
   verify expansion + MaxSim for ambiguous case
6. **Regression**: Run full CodeSearchNet benchmark, compare lexical MRR before/after
7. **No double expansion**: With `graphExpand: '1hop'`, verify expansion happens in
   postprocess only (not internal + postprocess)

## Performance Expectations

| Query type | Current latency | Target latency | Change |
|------------|----------------|----------------|--------|
| Exact identifier | ~5-15ms (BM25 + skip expand + MaxSim overhead) | ~3-8ms (BM25 only) | -40-50% |
| Ambiguous word | ~15-30ms (BM25 + expand + MaxSim) | ~15-30ms (single expand + MaxSim) | neutral |

## Open Questions

1. **`high` confidence threshold**: Currently there is no separate `high` level — it maps
   to the same criteria as `exact` via `isExactMatchResult()`. A softer threshold
   (e.g., BM25 > 15 AND gap > 1.5x) is plausible but risky — common single-word
   identifiers like `config`, `auth`, `service` could easily trip it. **Benchmark-gated**:
   analyze BM25 score distributions on real queries before introducing a separate `high`
   threshold. Until then, `high` = `exact`.

2. **Should `isIdentifierQuery` expand its patterns?** Currently misses SCREAMING_SNAKE
   (`MAX_RETRIES`), dotted paths (`auth.service`), and hyphenated (`my-component`).
   The vocab-ranker already classifies these as lexical (`vocab-ranker.js:181-203`)
   but `isIdentifierQuery` doesn't recognize them. This means they fall to the plain
   BM25 path and miss definition-first ranking.

3. **Definition-first bail-out for highly ambiguous identifiers**: A single word like
   `config` passes `isIdentifierQuery` (line 1301: single lowercase word >= 3 chars)
   and enters definition-first. But if there are dozens of config-named entities,
   `hybridDefinitionSearch` still merges them all ahead of BM25. Should there be a
   "too many definitions" threshold that reclassifies to ambiguous and skips
   definition-priority? Or is definition-first always the right default even for
   common names?
