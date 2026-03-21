# Lexical (BM25) Fix Plan

Revised March 2026 plan for the pure lexical search path.

This plan is intentionally scoped to lexical retrieval only:

- FTS5 / BM25
- trigram fallback
- LIKE fallback
- definition-first lexical retrieval

Non-goals:

- No changes to hybrid fusion
- No changes to semantic retrieval
- No changes to cross-encoder / reranker behavior
- No MMR or fusion retuning in this document

The current hybrid fusion path has already been benchmarked and is out of scope.

---

## Current State

### Current lexical stack

- `entities_fts` uses SQLite FTS5 with columns: `name`, `signature`, `doc_comment`
- Tokenizer: `porter unicode61`
- `entities_trigram` indexes `name`, `signature`
- `search_text` is only `name + signature + doc_comment`, lowercased
- Identifier queries already benefit from a definition-first lexical pass

### Important constraints

1. `porter unicode61` does **not** split `camelCase` / `PascalCase` into separate tokens.
2. Because of that, phrase or `NEAR()` matching on `user service` does **not** solve `UserService` by itself.
3. `search_text` is currently redundant with existing FTS columns and should not be added to FTS as-is.

---

## Summary Verdict

The original plan was a good conservative patch set, but it was not optimal for March 2026.

What remains correct:

- Column-weighted BM25 is the highest-value immediate fix.
- Logging and sanitization fixes are worth shipping immediately.
- Accepting SQLite FTS5's built-in `k1/b` is the right default.
- Adding raw `search_text` to FTS is not worthwhile.

What needed correction:

- Phrase boosting is not the right primary fix for multi-word code-style queries under the current tokenizer.
- Identifier routing should be narrower and more code-aware.
- The plan missed native FTS5 prefix indexes.
- The real gap for `user service -> UserService` is normalized identifier aliases, not more BM25 tricks.

---

## Recommended Priority Order

| Priority | Fix | Impact | Effort | Risk |
|----------|-----|--------|--------|------|
| **P0** | Fix 1: Weighted BM25 / BM25F | High | Small | Low |
| **P0** | Fix 2: Sanitization + trigram correctness | High | Small | Low |
| **P0** | Fix 3: FTS5 error logging parity | Low | Tiny | None |
| **P1** | Fix 4: Narrow identifier routing | Medium | Small | Low |
| **P1** | Fix 5: FTS5 prefix indexes | High | Schema rebuild | Medium |
| **P1** | Fix 6: Path-aware lexical signal | Medium | Small-Med | Low |
| **P2** | Fix 7: Normalized identifier alias field | High | Schema rebuild | Medium |
| **P2** | Fix 8: Identifier variant expansion | Medium | Small-Med | Low |
| **P3** | Fix 9: Abbreviation expansion dictionary | Medium | Small | Low |
| **P3** | Fix 10: Clarify FTS5 `k1/b` mismatch | Low | Tiny | None |
| **P3** | Fix 11: Lexical path observability | Low | Small | Low |
| **DROP** | Old Fix: phrase dual-query boosting | Low | — | — |
| **DROP** | Old Fix: add raw `search_text` to FTS | None | — | — |

---

## Fix 1: Weighted BM25 / BM25F (P0)

**Files:** `core/graph-search.js`, optionally `core/graph-extractor.js`

**Problem:** Current FTS5 ranking gives equal importance to `name`, `signature`, and `doc_comment`.

Current code:

```sql
bm25(entities_fts) AS score
```

Recommended:

```sql
bm25(entities_fts, 10.0, 5.0, 1.0) AS score
```

For trigram:

```sql
bm25(entities_trigram, 10.0, 3.0) AS score
```

Suggested weights:

- `name`: `10.0`
- `signature`: `5.0`
- `doc_comment`: `1.0`

For trigram:

- `name`: `10.0`
- `signature`: `3.0`

### Optional optimization

SQLite FTS5 documents that `ORDER BY rank` is faster than calling `bm25()` directly in the sort. If we want the best native FTS5 path, switch to:

```sql
SELECT
  e.id, e.file_path, e.type, e.name, e.signature,
  e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
  rank AS score
FROM entities_fts
JOIN entities e ON entities_fts.rowid = e.rowid
WHERE entities_fts MATCH ?
  AND rank MATCH 'bm25(10.0, 5.0, 1.0)'
  AND e.stale_since IS NULL
ORDER BY rank
LIMIT ?
```

If simplicity matters more than micro-optimization, keeping `bm25(...)` inline is acceptable. The weighting itself is the important change.

### Why this is P0

- Highest impact
- No behavioral downside
- Native FTS5 feature
- No schema change required if only query text changes

---

## Fix 2: Sanitization + Trigram Correctness (P0)

**File:** `core/graph-search.js`

### 2A. Strip missing FTS5 special characters

Current sanitization does not strip `+`, which is an FTS5 phrase-concatenation operator.

Current:

```js
query.replace(/[":*^~()\-]/g, ' ')
```

Recommended:

```js
query.replace(/[":*^~()+\-]/g, ' ')
```

### 2B. Escape embedded double quotes in trigram MATCH

Current trigram query wraps raw input with:

```js
`"${query}"`
```

If `query` contains `"`, the MATCH expression can break.

Recommended:

```js
const escaped = query.replace(/"/g, '""');
const trigramRows = this._stmtTrigram.all(`"${escaped}"`, limit);
```

### Why this is P0

- Correctness issue
- Tiny change
- Zero product risk

---

## Fix 3: FTS5 Error Logging Parity (P0)

**File:** `core/graph-search.js`

`bm25SearchRaw()` already logs FTS5 / trigram failures. `bm25Search()` should do the same instead of silently degrading.

Recommended:

```js
} catch (err) {
  if (this.log) {
    this.log(`[bm25Search] FTS5 query failed: ${err.message}`);
  }
  results = [];
}
```

And similarly for trigram if desired.

### Why this is P0

- Helps debugging degraded lexical quality
- Very low risk

---

## Fix 4: Narrow Identifier Routing (P1)

**Files:** `core/graph-search.js`

**Problem:** The current identifier heuristic is too broad for FTS field restriction.

Right now, even a single lowercase word of length `>= 3` is considered an identifier. That is acceptable for definition-first routing, but too aggressive for forcing a `name:`-restricted FTS query.

### Recommended rule

Use field restriction only for clearly code-shaped identifiers:

- `PascalCase`
- `camelCase`
- `snake_case`
- `SCREAMING_SNAKE_CASE`
- optionally dotted identifiers like `foo.bar`

Do **not** restrict generic single lowercase words like `cache`, `error`, `token`, `login`.

### Recommended behavior

For eligible identifier-shaped queries:

1. Run restricted FTS query on `name`
2. If zero results, fall back to unrestricted FTS query
3. Keep the existing definition-first lexical path unchanged

Example:

```js
name : authservice*
```

or:

```js
name : ^ authservice*
```

if start-of-column anchoring proves beneficial in testing.

### Important note

Do not replace the existing definition-first lexical retrieval. This fix complements it for `bm25Search()` / `bm25SearchRaw()` only.

---

## Fix 5: FTS5 Prefix Indexes (P1)

**File:** `core/graph-extractor.js`

**Problem:** The query builder emits prefix queries constantly, but the FTS5 table has no prefix indexes.

SQLite FTS5 documents that prefix-token queries are slower without `prefix=` indexes because they require range scans over the token space.

### Recommended schema change

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name,
  signature,
  doc_comment,
  content='entities',
  content_rowid='rowid',
  tokenize='porter unicode61',
  prefix='2 3 4'
)
```

### Why `2 3 4`

- `2`: short prefixes like `db`, `ui`, `id`
- `3`: common code-search prefixes like `aut`, `req`, `res`
- `4`: longer identifier prefixes without too much bloat

This should be benchmarked on index size and query latency, but it is the most important missing native FTS5 optimization.

### Cost

- Requires rebuild
- Modest index growth

---

## Fix 6: Path-Aware Lexical Signal (P1)

**Files:** `core/graph-search.js`, optionally `core/graph-extractor.js`

Modern code search engines treat file name / path as a first-class lexical signal.

### Recommended first step

Add a post-hoc path boost before considering schema changes.

Examples of boostable matches:

- file basename contains query
- directory segment contains query
- file basename exactly equals identifier stem

Example heuristics:

- exact basename match: `1.5x`
- basename contains token: `1.25x`
- directory segment contains token: `1.1x`

### Optional schema experiment

If post-hoc boosts are not enough, add `file_path` as a dedicated low-weight FTS column:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name,
  signature,
  doc_comment,
  file_path,
  content='entities',
  content_rowid='rowid',
  tokenize='porter unicode61',
  prefix='2 3 4'
)
```

with weights:

```sql
bm25(entities_fts, 10.0, 5.0, 1.0, 2.0)
```

This is valuable, but should be treated as an experiment, not an automatic P0.

---

## Fix 7: Normalized Identifier Alias Field (P2, High Leverage)

**Files:** `core/graph-extractor.js`, `core/graph-search.js`

This is the real fix for cross-style identifier search.

**Problem:** `user service` should ideally find `UserService`, and `get_user_name` should ideally find `getUserName`, but the current tokenizer/index layout does not encode those aliases.

### Recommended new derived field

Add a derived alias field, for example:

- `name_alias`
- or `normalized_name`

Generated from `name` using:

- camelCase split
- PascalCase split
- snake_case split
- digit boundaries
- full collapsed form

Examples:

- `UserService` -> `user service userservice`
- `get_user_name` -> `get user name getusername`
- `HTMLParser2` -> `html parser 2 htmlparser2`

### Canonical normalization spec

The alias generator should be deterministic and shared between indexing and tests.

Recommended steps:

1. Preserve the original `name` separately. Do not overwrite it.
2. Split camelCase boundaries:
   - `getUserName` -> `get User Name`
3. Split PascalCase / acronym transitions:
   - `HTMLParser` -> `HTML Parser`
   - `OAuthToken` -> `OAuth Token`
4. Split `_`, `-`, `.`, `/`, and `:` into spaces:
   - `get_user-name` -> `get user name`
   - `auth.service` -> `auth service`
5. Split digit boundaries in both directions:
   - `Parser2` -> `Parser 2`
   - `v2Handler` -> `v 2 Handler`
6. Lowercase the split form.
7. Emit both:
   - split form tokens
   - collapsed alnum form with separators removed
8. Collapse duplicate whitespace and duplicate emitted tokens.

Recommended examples:

- `UserService` -> `user service userservice`
- `getUserName` -> `get user name getusername`
- `get_user_name` -> `get user name getusername`
- `HTMLParser2` -> `html parser 2 htmlparser2`
- `OAuth2Client` -> `oauth 2 client oauth2client`
- `auth.service` -> `auth service authservice`

### Guardrails

- Do not stem or otherwise mutate the original `name` column.
- Keep alias generation language-agnostic and deterministic.
- Keep the implementation in one helper so index build, rebuild, and tests cannot drift.

### Recommended schema

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name,
  name_alias,
  signature,
  doc_comment,
  content='entities',
  content_rowid='rowid',
  tokenize='porter unicode61',
  prefix='2 3 4'
)
```

Suggested weights:

```sql
bm25(entities_fts, 10.0, 4.0, 5.0, 1.0)
```

This is more useful than adding raw `search_text`.

Initial weight guidance:

- `name`: strongest exact signal
- `name_alias`: below or near `name`, but not below the noise floor
- `signature`: still important, especially for methods and overloads
- `doc_comment`: weak contextual signal

The exact `name_alias` vs `signature` ordering should be decided by benchmark data, not preference. Start with `10.0, 4.0, 5.0, 1.0`, then test `10.0, 5.0, 4.0, 1.0` and `10.0, 6.0, 4.0, 1.0`.

### Why this matters

Without a normalized alias field, phrase / `NEAR()` tricks do not solve the main code-search variant problem.

---

## Fix 8: Identifier Variant Expansion (P2)

**File:** `core/graph-search.js`

Query-time identifier expansion is useful, but it must not replace the original query.

### Wrong approach

Do **not** convert:

- `getUserName`

into only:

- `get user name`

That can lose matches on the literal camelCase token stored in the current index.

### Correct approach

For code-shaped identifiers, preserve the original query and optionally add a secondary expanded variant.

Example strategy:

1. Primary query: original identifier
2. Secondary query: split identifier form
3. Merge / dedup results, preferring stronger primary matches

Examples:

- Primary: `"getUserName"*`
- Secondary: `"get" "user" "name"*`

This is most useful after `name_alias` exists. Before that, treat it as lower-priority and benchmark carefully.

---

## Fix 9: Abbreviation Expansion Dictionary (P3)

**Files:** `core/graph-search.js`, optional config/constants file

Add a small curated dictionary for high-frequency software abbreviations:

- `auth` -> `authentication`, `authorize`
- `cfg` -> `config`, `configuration`
- `btn` -> `button`
- `repo` -> `repository`
- `req` -> `request`
- `res` -> `response`
- `impl` -> `implementation`

### Recommended usage

- Query-time expansion only
- Keep dictionary small and hand-curated
- Apply primarily to alias/path fields or fallback lexical expansion
- Do not explode broad natural-language queries into huge OR expressions

This is a useful recall booster, but not a substitute for the core ranking/index fixes above.

---

## Fix 10: Clarify FTS5 `k1/b` Mismatch (P3)

**Files:** `core/vocab-ranker.js`, optional comment in `core/graph-search.js`

`vocab-ranker.js` defines:

- `k1 = 1.5`
- `b = 0.5`

but live FTS5 uses SQLite's built-in BM25 defaults.

### Recommendation

Accept the mismatch and document it clearly:

- prewarm ranking constants are not live-search constants
- do not add custom rescoring unless benchmark data proves a real win

Column weights and better lexical normalization matter far more here.

---

## Fix 11: Lexical Path Observability (P3)

**Files:** `core/graph-search.js`, optional telemetry surface

This is not a ranking fix, but it materially improves diagnosis and safe rollout.

### Recommended lightweight metadata

Expose or internally record:

- lexical path used: `fts5` | `trigram` | `like`
- whether identifier restriction was applied
- whether restricted search fell back to unrestricted search
- whether definition-first lexical retrieval contributed top results

Optional response field:

```js
searchQuality: 'exact' | 'fuzzy' | 'fallback'
```

Suggested mapping:

- `exact`: FTS5 primary path
- `fuzzy`: trigram contributed materially
- `fallback`: LIKE fallback used

If product/API churn is undesirable, keep this internal-only via debug logs or telemetry counters.

---

## Explicitly Dropped Ideas

### Drop: Old phrase dual-query boosting

The original phrase-boost plan was too optimistic under the current tokenizer.

- Exact phrase matching is too strict
- Dual-query merge adds complexity
- It does not solve `user service -> UserService` without alias normalization

### `NEAR()` is optional, not primary

`NEAR()` can still be useful **after** normalized alias fields exist, or for true multi-token natural-language-ish code queries.

Examples where `NEAR()` may help:

- `user auth`
- `request context`
- `config loader`

It should not be treated as the core fix for identifier-style matching.

### Drop: Add raw `search_text` to FTS

Current `search_text` is only:

- `name + signature + doc_comment`
- lowercased

That is redundant with existing indexed fields and not worth rebuilding for.

---

## Validation Matrix

Validate on a real indexed repository before and after each phase.

### Exact identifier

- `AuthService`
- expected: definition entity at top

### Prefix identifier

- `Auth`
- expected: `AuthService` / `AuthenticationService` surfaced strongly

### Cross-style identifier

- `getUserName`
- `get_user_name`
- expected after alias work: both retrieve same symbol family

### Split query to collapsed symbol

- `user service`
- expected after alias work: `UserService` retrieved strongly

### Path-sensitive query

- `auth controller`
- expected: files/classes under auth/controller paths boosted

### Abbreviation query

- `auth`
- `cfg`
- `repo`
- expected after dictionary work: improved recall without noisy explosion

### Malformed query

- `foo"bar`
- `a+b`
- expected: no parser break, graceful lexical fallback if needed

### Prefix-heavy query

- `aut`
- `req`
- `repo`
- expected after prefix indexes: lower p50/p95 latency with no recall loss

### Path/basename query

- `authservice`
- `auth/service`
- expected after path signal work: auth-related file basenames/directories rank higher

### Identifier alias equivalence

- `OAuth2Client`
- `oauth2client`
- `oauth 2 client`
- expected after alias work: same symbol family retrieved strongly

---

## Benchmark Gates

Every schema-changing phase must pass explicit before/after benchmarks before merging.

### Required measurements

- index build time
- index rebuild time
- database file size
- FTS table size if measurable
- lexical query p50 latency
- lexical query p95 latency
- top-5 / top-10 relevance on a fixed regression set

### Required benchmark sets

1. Exact identifier queries
2. Prefix identifier queries
3. Cross-style identifier queries
4. Path-sensitive queries
5. Abbreviation queries
6. Malformed/sanitization queries

### Merge criteria

- no correctness regressions on regression queries
- no unacceptable database growth
- no meaningful p95 regression without compensating relevance gain

If a schema change improves recall but hurts latency or size too much, keep it behind an experiment flag or drop it.

---

## Migration / Rebuild Strategy

Any FTS schema change requires an explicit rebuild plan.

### Required steps

1. Add any new source columns or derived fields to the base `entities` data model if needed.
2. Update index build code to populate the new field deterministically.
3. Recreate the FTS5 virtual table with the new schema.
4. Run `INSERT INTO entities_fts(entities_fts) VALUES('rebuild')`.
5. Run `INSERT INTO entities_fts(entities_fts) VALUES('optimize')` after rebuild.
6. Verify row counts and spot-check regression queries.

### Rollback requirement

Each schema-changing PR should document:

- previous schema
- new schema
- rebuild trigger
- rollback steps

No schema change should ship without a clear downgrade path.

---

## Test Plan

The validation matrix above should become executable tests, not just ad hoc manual checks.

### Required test layers

1. Unit tests
   - alias generation helper
   - sanitization helper
   - identifier routing helper
2. Integration tests
   - small SQLite fixture with `entities`, `entities_fts`, and `entities_trigram`
   - before/after ranking assertions for exact, prefix, alias, and malformed queries
3. Regression suite
   - fixed corpus and fixed query set
   - snapshot top-k names/files/sources for comparison across changes

### Must-have unit cases for alias generation

- `UserService`
- `getUserName`
- `get_user_name`
- `HTMLParser`
- `OAuth2Client`
- `auth.service`
- `v2Handler`

### Must-have integration assertions

- exact `AuthService` outranks doc-comment-only matches
- malformed quotes do not break trigram MATCH
- `user service` retrieves `UserService` after alias indexing
- generic lowercase words do not get over-restricted to `name:`

---

## Implementation Order

### Phase 1: Immediate safe wins

1. Weighted BM25 / BM25F
2. Sanitization + trigram escaping
3. Error logging parity
4. Narrow identifier routing

### Phase 2: Best native FTS5 upgrade

5. Add FTS5 prefix indexes and rebuild
6. Add path-aware post-hoc boost

### Phase 3: True code-search normalization

7. Add normalized alias field and rebuild
8. Add identifier variant expansion against alias field
9. Optionally add small abbreviation dictionary

### Phase 4: Guardrails and observability

10. Clarify `k1/b` mismatch comments
11. Add lexical path observability

### Phase 5: Ongoing discipline

12. Keep regression suite and benchmark gates mandatory for all lexical schema changes

---

## Final Recommendation

If we want the best lexical improvement without touching hybrid fusion, the plan should be:

1. Ship weighted BM25 immediately
2. Fix sanitization / escaping / logging immediately
3. Tighten identifier routing
4. Add FTS5 prefix indexes
5. Add path-aware lexical signal
6. Add a normalized identifier alias field

That is the closest thing to an optimal March 2026 lexical plan for this codebase without destabilizing the hybrid side that has already been benchmarked.

---

## Notes

- This document is intentionally conservative about hybrid changes.
- It assumes current fusion and reranking are already tuned and should remain untouched.
- Any schema-changing phase should be benchmarked on:
  - build time
  - index size
  - p50 / p95 lexical latency
  - top-k lexical relevance on a fixed regression query set
