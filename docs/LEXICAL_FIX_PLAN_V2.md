# LEXICAL_FIX_PLAN_V2: Latency and Accuracy Improvements

**Status**: PLANNED
**Priority**: HIGH
**Date**: 2026-03-31 (research updated 2026-04-02)
**Builds on**: LEXICAL_FIX_PLAN (V1, now fully implemented)

---

## What V1 Already Shipped

These are done and should not be revisited:

- Weighted BM25F: `bm25(entities_fts, 10.0, 4.0, 5.0, 1.0)`
- Sanitization: `+` stripping, trigram quote escaping
- FTS5 error logging parity
- Prefix indexes: `prefix='2 3 4'`
- `name_alias` normalized identifier field with camelCase/snake_case splitting
- FTS5 schema: `name, name_alias, signature, doc_comment`

V1 established the foundation. V2 targets the remaining latency and accuracy gaps using post-hoc scoring techniques that work within our existing SQLite FTS5 architecture — no neural encoder required at query time. Research basis reviewed April 2026; learned sparse retrieval (SPLADE-Code, SEISMIC) was evaluated and excluded due to encoder-size constraints (see "Evaluated and Excluded").

---

## Research Basis

This plan is grounded in recent IR research and SQLite FTS5 internals. All citations verified April 2026.

### Primary References (directly inform fixes)

| Paper | Date | Key Contribution | Informs |
|-------|------|-------------------|---------|
| **BMX** (arXiv 2408.06643, PolyU/Mixedbread) | Aug 2024 | Entropy-weighted BM25 variant. Outperforms BM25 on BEIR/LoCo/BRIGHT with comparable latency. Score normalization via max-score estimator. 12 citations. | Fix 5, Fix 8 |
| **RankEvolve** (arXiv 2602.16932, Santa Clara/Walmart) | Feb 2026 | LLM-evolved BM25*. Both evolutionary seeds independently discover bigram channels, coordination bonus, log-dampened length normalization, rare-term anchoring. | Fix 2, Fix 4, Fix 6, Fix 9 |
| **Identifier Splitting** (arXiv 2201.01988, SMU) | Jan 2022 | Foundational (not current SOTA). Hybrid split strategy: +6.23% MRR on identifiers. Naive splitting hurts. V1 already implemented the key insight. | V1 (done) |
| **Query-side BM25** (Ge et al.) | Sep 2025 | BM25-style TF normalization applied to query term vectors. Relevant for long/repetitive queries from LLM-generated contexts. | Fix 4 |

### Context References (validate approach, do not directly inform fixes)

| Paper | Date | Relevance |
|-------|------|-----------|
| **CLARC** (arXiv 2603.04484) | Mar 2026 | New C/C++ code search benchmark. Latest dense models (Nomic-emb-code 7B, Voyage-code-3) dominate; BM25 is weak baseline. Validates our hybrid approach. |
| **Li-LSR** (SIGIR '25, Nardini et al.) | 2025 | Inference-free learned sparse retrieval. Surpasses SPLADE-v3-Doc by +1pt mRR@10. Eliminates query encoding bottleneck — but requires model infrastructure we don't have. |
| **LACONIC** (arXiv 2601.01684) | Jan 2026 | Dense-level effectiveness for scalable sparse retrieval via two-phase training. State-of-the-art LSR, but requires neural encoder. |
| **Revisiting Text Ranking in Deep Research** (arXiv 2602.21456) | Feb 2026 | Agent-issued queries favor lexical and learned sparse retrievers. Validates investing in lexical quality. |
| **BM25F in code search** (Sourcegraph engineering) | 2024-2025 | Per-field boosting (filename, symbol, body) yields ~20% ranking improvement in production code search. Validates our existing BM25F approach. |

---

## Core Principle: A/B Test Everything

Every change in this plan MUST be validated with before/after benchmarks on a fixed regression query set. No change ships on theory alone.

### A/B Testing Protocol

1. **Baseline capture**: Before any change, run the full benchmark suite and snapshot results.
2. **Single-variable changes**: Each fix is tested in isolation against the baseline. No stacking untested changes.
3. **Regression query set**: Fixed set of queries across these categories:
   - Exact identifier (`AuthService`, `getUserName`)
   - Prefix identifier (`Auth`, `req`)
   - Cross-style identifier (`user service` -> `UserService`)
   - Multi-token natural language (`authentication error handler`)
   - Path-sensitive (`auth controller`, `config loader`)
   - Abbreviation (`auth`, `cfg`, `repo`)
   - Malformed (`foo"bar`, `a+b`)
   - Long code entities (files > 200 lines)
4. **Metrics per test**:
   - Recall@5, Recall@10, Recall@20
   - MRR@10
   - nDCG@10
   - p50 and p95 query latency (ms)
   - Index size delta (bytes)
5. **Ship criteria**: A change ships only if:
   - No recall regression on any query category
   - No p95 latency regression > 10% without compensating recall gain
   - No index size growth > 20% without compensating recall gain
6. **Rollback**: Every change must be independently revertable.

### Benchmark Fixture

Create `evaluation/lexical-ab-fixture.js` containing:
- A fixed SQLite DB with ~5000 indexed entities from a real codebase
- The regression query set with expected top-k entity IDs
- Automated before/after comparison with delta reporting
- Machine-readable JSON output for CI integration

This fixture is a prerequisite for all subsequent work. Build it first.

---

## Fix 1: Use `ORDER BY rank` with Pre-configured Weights (P0)

**Impact**: Latency reduction, zero accuracy change
**Risk**: None
**A/B metric**: p50/p95 latency only

### Problem

Current queries use:

```sql
SELECT ... bm25(entities_fts, 10.0, 4.0, 5.0, 1.0) AS score
...
ORDER BY score
```

SQLite FTS5 docs explicitly state that `ORDER BY rank` is faster than calling `bm25()` in the SELECT because it uses an optimized internal code path.

### Change

```sql
-- Configure rank once after table creation or connection
INSERT INTO entities_fts(entities_fts, rank) VALUES('rank', 'bm25(10.0, 4.0, 5.0, 1.0)');

-- Then query with:
SELECT
  e.id, e.file_path, e.type, e.name, e.signature,
  e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
  rank AS score
FROM entities_fts
JOIN entities e ON entities_fts.rowid = e.rowid
WHERE entities_fts MATCH ?
  AND e.stale_since IS NULL
ORDER BY rank
LIMIT ?
```

### Why P0

- Zero accuracy impact
- Pure latency win
- Native SQLite optimization
- One-line config change + query rewrite

---

## Fix 2: Coordination Bonus for Multi-Token Queries (P1)

**Impact**: Accuracy improvement for multi-term queries
**Risk**: Low
**A/B metric**: MRR@10, nDCG@10 on multi-token query subset

### Problem

BM25 sums per-term scores independently. A document matching 3 of 4 query terms weakly can outscore a document matching 2 of 4 strongly. For code search, matching more distinct query terms is a strong relevance signal.

RankEvolve (2602.16932) independently discovered this as a fundamental scoring motif across two different evolutionary seeds.

### Change

Add a post-hoc coordination multiplier after BM25 scoring:

```js
// After BM25 retrieval, before returning results
const queryTerms = extractQueryTerms(query);
for (const result of results) {
  const matchedTerms = countMatchedTerms(result, queryTerms);
  const coverage = matchedTerms / queryTerms.length;
  // Soft coordination: tanh for robust bounded signal
  result.score *= (1.0 + 0.5 * Math.tanh(2 * coverage - 1));
}
```

The multiplier shape is deliberately conservative:
- coverage = 0.0 -> 0.76x (penalty for zero coverage, shouldn't happen post-FTS)
- coverage = 0.5 -> 1.0x (neutral)
- coverage = 1.0 -> 1.24x (bonus for full coverage)

### A/B Test

Compare MRR@10 specifically on multi-token queries (2+ terms). Must not regress single-token queries.

Sweep the multiplier strength: `0.25, 0.5, 0.75, 1.0` for the `0.5` coefficient. Pick the value with best MRR@10 gain and no single-token regression.

---

## Fix 3: Character Trigram Channel for Rare/Unknown Terms (P2 — moved to Phase 3)

**Impact**: Accuracy improvement for partial identifier matching
**Risk**: Medium (index size growth)
**A/B metric**: Recall@10 on partial/typo query subset, index size delta

### Problem

FTS5 prefix indexes help with prefix queries (`aut*` -> `AuthService`) but cannot match:
- Substrings: `Service` inside `AuthService`
- Typos: `AuhService`
- Partial identifiers: `servi`

The existing `entities_trigram` table handles this, but it only indexes `name` and `signature` and uses a separate code path from the main FTS5 query.

RankEvolve discovered that character 3-gram channels gated by IDF (only fire for rare terms) provide surgical fuzzy matching without noise.

### Change

Enhance the trigram fallback path with IDF gating:

```js
// Only use trigram channel when:
// 1. FTS5 primary path returns < threshold results
// 2. Query contains terms not in the FTS5 vocabulary (rare/unknown)
const ftsResults = this._searchFTS5(query, limit);
if (ftsResults.length < minResultsThreshold) {
  const trigramResults = this._searchTrigram(query, limit);
  // Merge with FTS5 results, trigram scores weighted lower
  results = mergeResults(ftsResults, trigramResults, trigramWeight);
}
```

Additionally, consider adding `name_alias` to the trigram table so that split forms also get fuzzy matching.

### A/B Test

1. Measure recall on queries where FTS5 returns 0-2 results
2. Measure p95 latency impact of the merged path
3. Sweep `trigramWeight`: `0.3, 0.5, 0.7`
4. Sweep `minResultsThreshold`: `1, 3, 5`

---

## Fix 4: Log-Dampened Length Normalization for Code (P1)

**Impact**: Accuracy improvement for long code entities
**Risk**: Low-Medium
**A/B metric**: Recall@10 on queries whose correct answer is in a long entity

### Problem

BM25's document length normalization (the `b` parameter) penalizes long documents linearly. Code entities are naturally longer than natural language documents — a 200-line class definition is not "bloated", it's normal.

RankEvolve (2602.16932) independently discovered that a **logarithmic length dampener** addresses BM25's known over-penalization of long documents. Both evolutionary seeds converged on this.

The current FTS5 uses SQLite's default `b = 0.75`. For code search, this is too aggressive.

### Change

SQLite FTS5 does not expose `b` directly. But we can approximate gentler length normalization via:

**Option A**: Post-hoc score adjustment based on entity line count:

```js
// After retrieval, adjust for entity length
const avgLength = getAverageEntityLength(); // cache this
for (const result of results) {
  const lengthRatio = result.lineCount / avgLength;
  // Log dampening: penalty grows logarithmically, not linearly
  const lengthFactor = 1.0 / (1.0 + 0.3 * Math.log(1 + lengthRatio));
  // Only apply dampening upward (don't penalize short entities more)
  if (lengthRatio > 1.5) {
    result.score *= (1.0 + 0.15 * (1.0 - lengthFactor));
  }
}
```

**Option B (NOT available)**: SQLite FTS5 hardcodes `k1 = 1.2` and `b = 0.75`. These are not configurable. The only way to change length normalization behavior is post-hoc (Option A) or via a custom FTS5 auxiliary function written in C (out of scope). Stick with Option A.

### A/B Test

1. Partition the regression query set by target entity length (short < 50 lines, medium 50-150, long > 150)
2. Measure Recall@10 per partition
3. Sweep `b` values or dampening coefficients
4. Must not regress short-entity recall while improving long-entity recall

---

## Fix 5: Entropy-Weighted Term Scoring (P3 — demoted, most speculative)

**Impact**: Accuracy improvement for informative-vs-common term discrimination
**Risk**: Medium
**Caveat**: BMX demonstrated gains on text IR benchmarks (BEIR), but code corpora have different term distributions. This is the least certain fix in V2 — skip if Phase 2+3 already hit targets.
**A/B metric**: MRR@10, nDCG@10 across full query set

### Problem

BM25's IDF component treats all terms with the same document frequency identically. But in code search, some terms are highly informative (`OAuth`, `WebSocket`) while others are common but less useful (`error`, `handler`, `service`).

BMX (2408.06643) shows that **entropy-weighted similarity** can outperform BM25 on 11/15 BEIR datasets with comparable latency. The key insight: weight each term's contribution by its information content (entropy), not just document frequency.

### Change

Add a post-hoc entropy-weighted re-scoring layer:

```js
// Pre-compute term entropy from the corpus (cache at index time)
// entropy(t) = -sum(p * log(p)) over documents containing t
// Higher entropy = term appears in diverse contexts = less discriminative

function entropyRerank(results, queryTerms, corpusStats) {
  for (const result of results) {
    let entropyBonus = 0;
    let matchedCount = 0;
    for (const term of queryTerms) {
      if (resultContainsTerm(result, term)) {
        const termEntropy = corpusStats.getEntropy(term);
        // Low entropy = highly informative = bigger bonus
        const informativeness = 1.0 - (termEntropy / corpusStats.maxEntropy);
        entropyBonus += informativeness;
        matchedCount++;
      }
    }
    if (matchedCount > 0) {
      const avgInformativeness = entropyBonus / matchedCount;
      // beta scales with corpus size, following BMX
      const beta = 1.0 / Math.log(1 + corpusStats.totalDocs);
      result.score *= (1.0 + beta * avgInformativeness);
    }
  }
}
```

### A/B Test

1. Measure MRR@10 on full query set
2. Specifically measure on queries containing mix of common + rare terms
3. Sweep `beta` scaling: `auto`, `0.1`, `0.3`, `0.5`
4. Compare against a simpler IDF-based variant (just use existing IDF, skip entropy computation)

---

## Fix 6: Bigram Index for Adjacent-Term Proximity (P2)

**Impact**: Accuracy improvement for multi-word queries matching compound identifiers
**Risk**: Medium (index size, schema change)
**A/B metric**: Recall@10 on cross-style queries (`user service` -> `UserService`)

### Problem

V1's `name_alias` field helps `user service` find `UserService` by indexing the split form `user service userservice`. But FTS5 with `porter unicode61` tokenization treats `user` and `service` as independent terms — it does not know they appeared adjacent in the alias.

RankEvolve discovered that a **bigram channel** (indexing adjacent token pairs) provides strong proximity signal without the complexity of FTS5 `NEAR()` queries.

### Change

Add a bigram-derived field to the FTS5 schema:

```sql
-- New derived field: bigrams from name_alias
-- "user service userservice" -> "user_service service_userservice"
-- Stored as underscore-joined pairs
```

At index time:

```js
function generateBigrams(nameAlias) {
  const tokens = nameAlias.split(/\s+/);
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i+1]}`);
  }
  return bigrams.join(' ');
}
```

At query time, generate bigrams from multi-token queries and boost matches.

### A/B Test

1. Measure Recall@10 specifically on cross-style queries
2. Measure index size growth
3. Measure p95 latency impact
4. Compare bigram approach vs NEAR() query approach — pick the one with better accuracy/latency ratio

---

## Fix 7: Contentless FTS5 Table (P2)

**Impact**: Latency reduction via smaller index
**Risk**: Medium (rebuild complexity)
**A/B metric**: p50/p95 latency, index file size

### Problem

The current FTS5 table stores content redundantly — the actual text is already in the `entities` table. A content-synced FTS5 table (`content='entities'`) stores content pointers but still occupies space for content verification during deletes.

A **contentless** FTS5 table (`content=''`) eliminates this overhead entirely, at the cost of requiring manual delete/update handling.

### Change

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name,
  name_alias,
  signature,
  doc_comment,
  content='',
  tokenize='porter unicode61',
  prefix='2 3 4'
);
```

Requires:
- Manual delete-before-reinsert for updates
- Full rebuild instead of incremental updates
- Cannot use `highlight()` or `snippet()` auxiliary functions (we don't use them)

### A/B Test

1. Measure index file size (expect 20-40% reduction)
2. Measure p50/p95 query latency
3. Measure full rebuild time vs incremental update time
4. Only ship if latency wins justify rebuild complexity

---

## Fix 8: Score Normalization for Hybrid Fusion (P1)

**Impact**: Accuracy improvement in hybrid (lexical + semantic) pipeline
**Risk**: Low
**A/B metric**: Hybrid search MRR@10, nDCG@10

### Problem

BM25 scores are unbounded and scale-dependent — they vary with corpus size, document length distribution, and query length. This makes it impossible to set reliable relevance thresholds and makes score fusion with semantic retrieval scores (which are typically cosine similarity in [0, 1]) unstable.

BMX (2408.06643) solves this with a maximum-score estimator that normalizes to [0, 1].

### Change

```js
function normalizeBM25Score(score, queryTerms, corpusStats) {
  // Estimate maximum possible score for this query
  // Max IDF per term * number of terms + constant for BMX-style components
  let maxScore = 0;
  for (const term of queryTerms) {
    const maxIDF = Math.log((corpusStats.totalDocs + 1) / 1);
    // Max TF contribution assuming saturated TF and zero length penalty
    const maxTF = (corpusStats.k1 + 1); // TF saturation ceiling
    maxScore += maxIDF * maxTF;
  }
  // Apply column weight ceiling (name column weight = 10.0)
  maxScore *= 10.0;
  return Math.min(1.0, score / maxScore);
}
```

This enables:
- Reliable threshold-based filtering (e.g., "only show results above 0.3")
- Stable fusion with semantic scores: `finalScore = α * normalizedBM25 + (1-α) * semanticScore`
- Cross-query score comparability for cache decisions

### A/B Test

1. Measure hybrid pipeline MRR@10 with raw vs normalized BM25 scores in fusion
2. Sweep fusion weight `α`: `0.3, 0.5, 0.7`
3. Measure threshold stability: what threshold value gives consistent precision across query types?

---

## Fix 9: Rare-Term Anchoring (P1)

**Impact**: Accuracy improvement when queries contain a mix of common and rare terms
**Risk**: Low
**A/B metric**: MRR@10 on mixed-rarity queries

### Problem

When a query like `OAuth refresh token handler` is issued, `handler` and `token` are common across the codebase, while `OAuth` and `refresh` are rare and highly discriminative. BM25's IDF partially handles this, but it treats all matching terms as additive — it doesn't give extra credit for matching the rare, anchoring terms.

RankEvolve (2602.16932) discovered "rare-term anchoring" as a bounded multiplier in both evolutionary seeds.

### Change

```js
function applyRareTermAnchoring(results, queryTerms, corpusStats) {
  // Identify rare query terms (top quartile of IDF among query terms)
  const termIDFs = queryTerms.map(t => ({
    term: t,
    idf: corpusStats.getIDF(t)
  }));
  const idfThreshold = percentile(termIDFs.map(t => t.idf), 75);
  const rareTerms = termIDFs.filter(t => t.idf >= idfThreshold).map(t => t.term);

  if (rareTerms.length === 0) return; // all terms have similar IDF

  for (const result of results) {
    const matchedRare = rareTerms.filter(t => resultContainsTerm(result, t));
    const rareRatio = matchedRare.length / rareTerms.length;
    // Bounded bonus: up to 1.3x for matching all rare terms
    result.score *= (1.0 + 0.3 * rareRatio);
  }
}
```

### A/B Test

1. Construct query subset with known rare+common term mixes
2. Measure MRR@10 improvement on that subset
3. Sweep anchoring bonus: `0.15, 0.3, 0.5`
4. Verify no regression on single-term or all-common-term queries

---

## Fix 10: Path-Aware Lexical Signal (P1)

**Impact**: Accuracy improvement for queries matching file/directory names
**Risk**: Low
**A/B metric**: MRR@10 on path-sensitive query subset

### Problem

Modern code search engines treat file path as a first-class signal. A query for `auth controller` should rank entities in `auth/controller.js` higher than unrelated files with `auth` in a comment.

This was V1 Fix 6 (P1) and was not implemented.

### Change

Add post-hoc path boost before final ranking:

```js
function applyPathBoost(results, queryTerms) {
  for (const result of results) {
    const basename = path.basename(result.file_path, path.extname(result.file_path));
    const dirSegments = result.file_path.split('/');

    let pathBoost = 1.0;
    for (const term of queryTerms) {
      const lowerTerm = term.toLowerCase();
      if (basename.toLowerCase() === lowerTerm) {
        pathBoost = Math.max(pathBoost, 1.5);   // exact basename match
      } else if (basename.toLowerCase().includes(lowerTerm)) {
        pathBoost = Math.max(pathBoost, 1.25);  // basename contains
      } else if (dirSegments.some(s => s.toLowerCase().includes(lowerTerm))) {
        pathBoost = Math.max(pathBoost, 1.1);   // directory contains
      }
    }
    result.score *= pathBoost;
  }
}
```

### A/B Test

1. Measure MRR@10 on path-sensitive queries (`auth controller`, `config loader`, `utils/string`)
2. Sweep boost values: `1.25/1.15/1.05` vs `1.5/1.25/1.1` vs `2.0/1.5/1.2`
3. Must not regress queries where path is irrelevant

---

## Fix 11: FTS5 Maintenance Operations (P0)

**Impact**: Latency reduction over time (prevents index degradation)
**Risk**: None
**A/B metric**: p50/p95 latency before/after optimize

### Problem

SQLite FTS5 uses an internal b-tree structure with multiple segments. As entities are inserted, updated, and deleted, the segment count grows, increasing query latency. SQLite provides `optimize` and `automerge` commands to control this, but we may not be using them.

### Change

```js
// After full index rebuild
db.exec("INSERT INTO entities_fts(entities_fts) VALUES('optimize')");

// Configure automerge for ongoing incremental indexing
// Value 0-16; higher = more aggressive merging (4 is a reasonable default)
db.exec("INSERT INTO entities_fts(entities_fts) VALUES('automerge=4')");
```

Run `optimize` after:
- Initial index build
- Full re-index / rebuild
- Bulk entity updates (> 100 entities)

### A/B Test

1. Build an index, measure p50/p95
2. Run optimize, measure again
3. Insert 1000 entities without optimize, measure degradation
4. Run optimize, confirm recovery

---

## Fix 12: Lexical Path Observability (P1)

**Impact**: Diagnostic capability (no direct accuracy/latency change)
**Risk**: None
**A/B metric**: N/A — this is infrastructure

### Problem

When lexical quality degrades, we currently have no visibility into which code path produced the results. Was FTS5 the primary source? Did trigram kick in? Was identifier routing applied? Did the restricted query fall back to unrestricted?

This was V1 Fix 11 (P3) and was not implemented.

### Change

Return or log lightweight metadata per search:

```js
// Internal diagnostic object, returned alongside results
const searchMeta = {
  lexicalPath: 'fts5' | 'trigram' | 'like',     // which path produced results
  identifierRestricted: boolean,                   // was name: restriction used
  restrictionFellBack: boolean,                    // did restricted search fall back
  ftsResultCount: number,                          // raw FTS5 hit count
  trigramMerged: boolean,                          // was trigram channel merged in
  coordinationApplied: boolean,                    // was coordination bonus applied
  pathBoostApplied: boolean,                       // was path boost applied
  queryTermCount: number,                          // how many terms in query
  matchedTermAvg: number,                          // avg matched terms across top-k
};
```

Expose via:
- Debug log (when verbose/debug logging enabled)
- Optional `searchQuality` field in response: `'exact' | 'fuzzy' | 'fallback'`

### A/B Test

No A/B test needed — this is pure instrumentation. Verify it does not add measurable latency (< 0.1ms overhead).

---

## Fix 13: Narrow Identifier Routing Tightening (P1)

**Impact**: Accuracy improvement for identifier-shaped queries
**Risk**: Low
**A/B metric**: MRR@10 on identifier vs natural language query subsets

### Problem

V1 planned this (Fix 4) but it may not be fully implemented or may be too broad. The current heuristic for deciding "is this an identifier?" should be strict.

### Change

Use field restriction (`name:`) only for clearly code-shaped identifiers:

```js
function isCodeIdentifier(query) {
  // PascalCase: AuthService, UserController
  if (/^[A-Z][a-z]+[A-Z]/.test(query)) return true;
  // camelCase: getUserName, authService
  if (/^[a-z]+[A-Z]/.test(query)) return true;
  // snake_case: get_user_name
  if (/^[a-z]+_[a-z]+/.test(query)) return true;
  // SCREAMING_SNAKE: MAX_RETRY_COUNT
  if (/^[A-Z]+_[A-Z]+/.test(query)) return true;
  // dotted: auth.service, foo.bar
  if (/^[a-z]+\.[a-z]+/.test(query)) return true;
  return false;
}
```

Generic single lowercase words (`cache`, `error`, `token`) must NOT be field-restricted.

### A/B Test

1. Measure MRR@10 on identifier queries with and without field restriction
2. Measure MRR@10 on generic word queries to confirm no regression
3. Sweep: restrict to `name:` only, vs `name: OR name_alias:`

---

## Explicitly Deferred

These are interesting but out of scope for V2:

| Idea | Why Deferred |
|------|-------------|
| LLM-based query expansion (BMX WQA) | Requires LLM call per query. Latency cost too high for local-first architecture. |
| Custom FTS5 tokenizer (code-aware) | SQLite custom tokenizer API is C-only. Major engineering effort. |
| Abbreviation expansion dictionary (V1 Fix 9) | Low priority until V2 fixes are measured. Carry forward to V3 if needed. |
| Full RankEvolve-style evolved scoring | Fascinating but requires significant infrastructure. Revisit after V2 measurements. |
| Sigmoid-capped TF (BMX) | Interesting for repetitive code, but requires replacing BM25 internals. Evaluate if entropy weighting (Fix 5) already covers this. |

### Evaluated and Excluded

These were investigated during V2 research (April 2026) and determined to be incompatible with our architecture:

| Idea | Why Excluded |
|------|-------------|
| SPLADE-Code (arXiv 2603.22008) + SEISMIC index (arXiv 2404.18812) | SEISMIC is the ideal serving layer for learned sparse vectors (microsecond retrieval, 21x faster than graph-based alternatives, Rust implementation). However, the smallest code-aware SPLADE model is 600M params (~2.4GB, 50-200ms CPU inference) — 4x our LI model and incompatible with our <100ms p99 latency budget. Text-only distilled SPLADE models (15-66M params) exist but are not trained on code. **Revisit only when a <100M code-aware sparse encoder is published.** |
| Li-LSR inference-free sparse retrieval | Eliminates query encoding bottleneck but still requires a trained sparse model and custom index infrastructure. Same encoder-size constraint as SPLADE-Code. |
| LACONIC (arXiv 2601.01684) | Dense-level sparse retrieval effectiveness, but requires neural encoder at query time. Same constraint. |

---

## Execution Order

### Phase 0: A/B Test Infrastructure (prerequisite for everything)

Build `evaluation/lexical-ab-fixture.js` with fixed corpus, query set, and automated comparison.

### Phase 1: Free Wins (parallel, no schema changes, zero risk)

| Fix | Domain | File(s) | Risk |
|-----|--------|---------|------|
| Fix 1: `ORDER BY rank` | graph | `core/graph/graph-search.js` | None |
| Fix 11: FTS5 optimize/automerge | graph | `core/graph/graph-extractor.js` | None |
| Fix 12: Lexical path observability | search | `core/search/sweet-search.js`, `core/graph/graph-search.js` | None |

### Phase 2: Post-hoc Scoring (no schema changes)

Each fix is A/B tested **individually** first. Then winning fixes are combined and tested as a stack to check for interaction effects (multiplier compounding, score distribution shifts).

| Fix | Domain | File(s) | Risk |
|-----|--------|---------|------|
| Fix 2: Coordination bonus | ranking | `core/ranking/` (new post-hoc scorer) | Low |
| Fix 4: Length normalization | ranking | `core/ranking/` (new post-hoc scorer) | Low-Med |
| Fix 8: Score normalization | search | `core/search/search-fusion.js` | Low |
| Fix 9: Rare-term anchoring | ranking | `core/ranking/` (new post-hoc scorer) | Low |
| Fix 10: Path-aware lexical signal | ranking | `core/ranking/` (new post-hoc scorer) | Low |
| Fix 13: Narrow identifier routing | query | `core/query/intent-detector.js` or `core/graph/graph-search.js` | Low |

**DDD note**: Fixes 2, 4, 9, 10 are all post-BM25 re-scoring. They belong in `core/ranking/` as a new lexical post-hoc scorer module, not in the graph domain. Fix 8 (score normalization) belongs in `core/search/search-fusion.js` since it enables hybrid fusion. Fix 13 (identifier routing) is a query classification concern.

**Interaction testing**: After individual A/B passes, stack all winning fixes and run the full regression suite again. If the combined effect regresses any category, bisect to find the conflicting pair and drop the lower-impact fix. Document the final post-hoc pipeline order (multipliers are not commutative when combined with normalization).

### Phase 3: Schema Changes (depends on Phase 2 A/B results)

| Fix | Domain | File(s) | Risk |
|-----|--------|---------|------|
| Fix 3: Trigram channel enhancement | graph | `core/graph/graph-search.js` | Medium |
| Fix 6: Bigram index | graph | `core/graph/graph-extractor.js`, `core/graph/graph-search.js` | Medium |
| Fix 7: Contentless FTS5 | graph | `core/graph/graph-extractor.js` | Medium |

### Phase 4: Advanced Scoring (depends on Phase 3 A/B results, most speculative)

| Fix | Domain | File(s) | Risk | Note |
|-----|--------|---------|------|------|
| Fix 5: Entropy-weighted scoring | ranking + graph | `core/ranking/` (scorer), `core/graph/graph-extractor.js` (index-time stats) | Medium | Demoted from Phase 3. BMX showed gains on text benchmarks but code corpora have different term distributions. Most speculative fix — skip if Phase 2+3 gains are sufficient. |

### Decision Gates

- After Phase 1: measure baseline latency improvement. If p95 drops > 15%, proceed.
- After Phase 2: measure accuracy gains. Each fix ships independently based on its own A/B results. Fixes that regress any metric are dropped. **Watch for multiplier stacking** — three 1.2x boosts compound to 1.73x, which can blow out score distributions.
- After Phase 3: measure combined accuracy and index size. If index size growth > 25%, drop Fix 6 (bigrams). If diminishing returns, skip Phase 4.
- After Phase 4 (if attempted): measure entropy weighting in isolation. Skip if Phase 2+3 already hit the 3% MRR@10 target. This is the most speculative fix.
- Final: benchmark total V2 improvement against V1 baseline.

---

## Success Criteria

1. p95 lexical query latency reduced by at least 15% vs V1 baseline
2. MRR@10 improved by at least 3% on the regression query set
3. Recall@10 on multi-token and cross-style queries improved by at least 5%
4. No recall regression on any query category
5. Every shipped change has A/B test evidence in `evaluation/results/`
6. Index size growth stays under 25%

---

## References

### Primary
- Li et al. "BMX: Entropy-weighted Similarity and Semantic-enhanced Lexical Search." arXiv 2408.06643, Aug 2024.
- Nian et al. "RankEvolve: Automating the Discovery of Retrieval Algorithms via LLM-Driven Evolution." arXiv 2602.16932, Feb 2026.
- Shi et al. "Can Identifier Splitting Improve Open-Vocabulary Language Model of Code?" arXiv 2201.01988, Jan 2022. (Foundational, not current SOTA.)
- Ge et al. "Query-side BM25 normalization for long queries." Sep 2025.

### Context (validated approach, not directly applied)
- Lupart et al. "On the Challenges and Opportunities of Learned Sparse Retrieval for Code." arXiv 2603.22008, Mar 2026. (Excluded: no small code-aware model.)
- Bruch et al. "Efficient Inverted Indexes for Approximate Retrieval over Learned Sparse Representations (SEISMIC)." arXiv 2404.18812, SIGIR 2024 Best Paper. (Excluded: depends on SPLADE encoder.)
- Nardini et al. "Effective Inference-Free Retrieval for Learned Sparse Representations (Li-LSR)." SIGIR 2025. (Excluded: requires trained sparse model.)
- Xu et al. "LACONIC: Dense-Level Effectiveness for Scalable Sparse Retrieval." arXiv 2601.01684, Jan 2026. (Excluded: requires neural encoder.)
- Meng et al. "Revisiting Text Ranking in Deep Research." arXiv 2602.21456, Feb 2026.
- CLARC: "C/C++ Benchmark for Robust Code Search." arXiv 2603.04484, Mar 2026.
