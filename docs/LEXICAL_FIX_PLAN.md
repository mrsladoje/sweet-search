# Lexical (BM25) Fix Plan

Targeted fixes for the pure BM25 lexical search path. No architectural changes — all fixes operate within the existing FTS5 + trigram + LIKE pipeline.

---

## Fix 1: Add FTS5 Column Weights to `bm25()` (HIGH IMPACT)

**File:** `core/graph-search.js` — lines 104, 153, 285, 336

**Problem:** All four `bm25()` calls pass zero weight arguments. SQLite FTS5 defaults every column to weight 1.0, so a match in `doc_comment` scores identically to a match in `name`. For code search, entity name is far more important than a passing mention in a comment.

**FTS5 column order** (from `graph-extractor.js:1720-1728`):
1. `name`
2. `signature`
3. `doc_comment`

**Fix:** Replace all instances of:
```sql
bm25(entities_fts) AS score
```
with:
```sql
bm25(entities_fts, 10.0, 5.0, 1.0) AS score
```

And for trigram:
```sql
bm25(entities_trigram) AS score
```
with:
```sql
bm25(entities_trigram, 10.0, 3.0) AS score
```
(trigram table only indexes `name`, `signature` — 2 columns)

**Rationale:**
- `name` (10.0): Primary search target. A function *named* `authenticate` is almost always what the user wants.
- `signature` (5.0 / 3.0): Contains parameter types, return types — useful but secondary.
- `doc_comment` (1.0): Contextual. Should contribute but not dominate.

**Risk:** None. This is native FTS5 API. No schema change, no reindex.

**Validation:** Query "AuthService" — verify that entity with `name=AuthService` outranks entities that merely mention "AuthService" in a doc comment.

---

## Fix 2: Field-Restricted Queries for Identifier Lookups (MEDIUM IMPACT)

**Files:** `core/graph-search.js` — `sanitizeFtsQuery()` (line 1291), `bm25Search()` (line 80)

**Problem:** Identifier queries like `AuthService` or `handleRequest` search across all three FTS5 columns equally. This pulls in noise from signature/comment matches when the user clearly wants a name match.

**Prerequisite:** Fix 1 (column weights) partially addresses this, but field restriction is faster and more precise.

**Fix:** When `isIdentifierQuery()` returns true, prefix the FTS5 query with `name:`:
```js
sanitizeFtsQuery(query) {
  let sanitized = query.replace(/[":*^~()\-]/g, ' ');
  const words = sanitized.trim().split(/\s+/).filter(w => w.length > 0);

  // For single-word identifier queries, restrict to name column
  if (words.length === 1 && this.isIdentifierQuery(query)) {
    return `name:"${words[0]}"*`;
  }

  if (words.length === 1) {
    return `"${words[0]}"*`;
  }

  return words.map((w, i) =>
    i === words.length - 1 ? `"${w}"*` : `"${w}"`
  ).join(' ');
}
```

**Fallback:** If `name:`-restricted query returns 0 results, fall through to unrestricted query (existing behavior). This avoids breaking queries where the term appears only in signature/comments.

**Risk:** Low. `isIdentifierQuery()` already exists and is well-tested. FTS5 column filters are native.

**Validation:** Query "GraphSearch" — verify it hits the class definition, not a comment that says "see GraphSearch".

---

## Fix 3: Phrase Boosting for Multi-Word Queries (MEDIUM IMPACT)

**File:** `core/graph-search.js` — `sanitizeFtsQuery()` (line 1291), `bm25Search()` (line 80)

**Problem:** Multi-word queries like `user service` are converted to `"user" "service"*` (AND logic). This matches documents containing both tokens anywhere, but doesn't prefer documents where the tokens are adjacent. FTS5 natively supports phrase queries (`"user service"`) which match only adjacent tokens.

**Fix:** For multi-word queries, run two FTS5 queries:
1. **Phrase query** (`"user service"`) — boost results by 1.5×
2. **AND query** (`"user" "service"*`) — existing behavior, no boost

Merge results, dedup by entity ID, keep higher score.

```js
// In bm25Search(), after the primary FTS5 query:
if (words.length >= 2 && words.length <= 4) {
  const phraseQuery = `"${words.join(' ')}"`;
  const phraseRows = stmt.all(phraseQuery, limit);
  for (const row of phraseRows) {
    const existing = results.find(r => r.id === row.id);
    const phraseScore = Math.abs(row.score) * 1.5;
    if (existing) {
      existing.score = Math.max(existing.score, phraseScore);
    } else {
      results.push({ ...formatRow(row), score: phraseScore, source: 'fts5_phrase' });
    }
  }
}
```

**Risk:** Low. Adds one extra FTS5 query for multi-word inputs. FTS5 phrase matching is fast (same inverted index, just checks positional data).

**Validation:** Query "user service" — verify `UserService` class outranks a function with `user` in name and `service` in doc comment.

---

## Fix 4: Surface the k1/b Parameter Mismatch (LOW IMPACT, HIGH AWARENESS)

**Files:** `core/vocab-ranker.js` (lines 21-22), `core/graph-search.js`

**Problem:** `vocab-ranker.js` defines code-optimized BM25 parameters (k1=1.5, b=0.5) but these are only used for **prewarm ranking**. The live `bm25()` calls use SQLite FTS5's hardcoded defaults (k1=1.2, b=0.75).

- k1=1.2 vs 1.5: Minor difference. Both are in the reasonable range for code.
- b=0.75 vs 0.5: **This matters.** b=0.75 penalizes long documents more aggressively. Code files vary wildly in length (10-line utils vs 500-line modules). A lower b means a 500-line file containing `AuthService` isn't unfairly penalized relative to a 20-line file.

**Options (pick one):**

**(A) Accept the mismatch.** Add a comment in `vocab-ranker.js` documenting that these constants are prewarm-only, not live-search. FTS5 defaults are fine for most queries, and column weights (Fix 1) will have much more impact.

**(B) Post-hoc BM25 rescoring.** Use FTS5 for retrieval only (candidate generation), then rescore in JS with custom k1/b. This means:
- Fetch more candidates from FTS5 (e.g., `LIMIT 100` instead of `LIMIT 20`)
- Rescore using the `bm25Score()` function from `vocab-ranker.js` with k1=1.5, b=0.5
- Re-sort and take top-N

This requires term frequency and doc length data, which FTS5 doesn't directly expose. You'd need auxiliary queries or precomputed stats. **Not recommended unless benchmarks show b=0.75 is measurably hurting ranking.**

**Recommendation:** Option A for now. Fix 1 (column weights) will have 10× more impact than tuning k1/b.

---

## Fix 5: Log FTS5 Errors in `bm25Search()` (LOW IMPACT, CORRECTNESS)

**File:** `core/graph-search.js` — lines 131-134

**Problem:** `bm25Search()` silently swallows FTS5 errors and falls through to trigram/LIKE. `bm25SearchRaw()` logs errors but `bm25Search()` does not. A malformed query silently degrades to a much worse search path with no diagnostic trail.

**Fix:**
```js
} catch (err) {
  if (this.log) {
    this.log(`[bm25Search] FTS5 query failed: ${err.message}`);
  }
  results = [];
}
```

**Risk:** None.

---

## Fix 6: Add `search_text` to FTS5 Index (OPTIONAL, EVALUATE FIRST)

**Files:** `core/graph-extractor.js` (line 1720), `core/graph-search.js`

**Problem:** The `search_text` column contains concatenated/normalized content but is only used by the LIKE fallback. The FTS5 index never sees it.

**Before implementing:** Check what `search_text` actually contains vs `name + signature + doc_comment`. If it's just a concatenation of those three, adding it would be redundant and bloat the index. If it contains additional normalized content (e.g., split camelCase tokens, expanded abbreviations), it could improve recall.

**If valuable:** Add as a 4th column with low weight:
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name,
  signature,
  doc_comment,
  search_text,
  content='entities',
  content_rowid='rowid',
  tokenize='porter unicode61'
)
```
Update `bm25()` calls: `bm25(entities_fts, 10.0, 5.0, 1.0, 0.5)`

**Risk:** Requires FTS5 table rebuild (`DROP` + `CREATE` + `rebuild`). Index size will increase. Only worth it if `search_text` adds recall that the other three columns miss.

---

## Implementation Order

| Priority | Fix | Impact | Effort | Risk |
|----------|-----|--------|--------|------|
| **P0** | Fix 1: Column weights | High | 4 lines of SQL | None |
| **P1** | Fix 5: Error logging | Low | 3 lines of JS | None |
| **P1** | Fix 2: Field-restricted queries | Medium | ~15 lines of JS | Low |
| **P2** | Fix 3: Phrase boosting | Medium | ~20 lines of JS | Low |
| **P3** | Fix 4: k1/b mismatch | Low | Comment or ~30 lines | Low-Med |
| **P3** | Fix 6: search_text in FTS5 | Unknown | Schema change | Medium |

Fixes 1 + 5 can ship together immediately. Fix 2 and Fix 3 should be validated with before/after queries on a real codebase index.
