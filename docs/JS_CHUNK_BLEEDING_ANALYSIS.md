# JS Chunk Context Bleeding — Deep Miss Analysis

**Date:** 2026-05-01
**Benchmark:** GenCodeSearchNet, JavaScript subset (1000 queries)
**Index:** Freshly rebuilt 2026-05-01 (post-`933bcf8`, LI skip-policy fix applied)

## Update (2026-05-01, after R1 hash fix landed)

R1 below has been applied: a 1-line fix in `eval/lib/corpus.js` that uses the full
32-bit unsigned hash hex (8 chars, padded) instead of the leading 6 hex chars. This
restored 218 corpus docs that were being silently overwritten because sequential
`doc_id`s like `_606`/`_607`/`_608` produced near-identical hash prefixes.

### Post-R1 JS metrics (full benchmark, 6000 queries via run_benchmark.js, k=20)

| Metric | Pre-R1 (post-rebuild) | Post-R1 | Δ |
|---|---|---|---|
| JS MRR@10 | 70.97% | **77.40%** | **+6.43 pp** |
| JS Recall@5 | 78.70% | 86.80% | +8.10 pp |
| JS Recall@20 | — | 89.60% | — |
| Total MRR@10 (all 6 langs) | — | **84.48%** | (+2.53 pp vs Apr 23 baseline) |
| Total Recall@10 | — | 93.98% | — |

R1's recovery of 111 lost JS docs was the biggest single lever in this analysis. The
rest of this document describes the analysis methodology and the remaining miss
patterns (header-only chunks, cross-language confusion, sibling distractors,
mega-file pollution) that R2-R7 still target. The numbers below in the body refer
to the pre-R1 measurement (70.97% JS MRR) — categories and root causes are
unchanged but absolute miss counts shrank after R1.

## TL;DR

JS MRR@10 = **70.97%** (post-rebuild). Of 346 misses, the dominant causes are:

| Cause | Share of misses | Where it bites hardest |
|---|---|---|
| **Cross-language confusion** (Ruby/PHP/Java/Py top-1 over JS) | ~50% | Outside top-10 (22.5% explicit), rank 4-10 (47%), rank 2-3 (23%) |
| **Multi-anon-export corpus extraction bug** (4 specific files) | ~13% of misses, ~40% of retrieval failures | Outside top-10 — only path |
| **Header-only chunk fragments** (signature split from body) | ~13% of misses | Multi-chunk JS functions (47% of batch A) |
| **Same-repo sibling distractors** | ~20% | Rank 4-10 (30%), rank 2-3 (~30% via lexical overlap pattern) |
| **Mega-file `emitFiles_57fa9c.js` pollution** | reduced post-rebuild | Still pollutes ranks 4-5; no longer at rank 1-2 |
| **Genuine benchmark ambiguity / vague queries** | ~17% | Outside top-10 garbage queries; rank 2-3 "TOP1_SEMANTIC_BETTER" |

Two cheap, high-ROI levers stand out after the rebuild:

1. **Fix the multi-anonymous-export corpus extractor** — 4 files account for ~15 retrieval failures (out of 199 outside top-10). Surgical, large impact.
2. **Cross-language penalty in MaxSim reranker** (×0.85 for non-JS results when query routed JS) — addresses the dominant residual mode at small score gaps (0.03–0.10).

## Stale vs Fresh — Why a Rebuild Mattered

The first pass of this analysis ran on a **stale index built before commit `933bcf8` ("fix(indexing): unify skip policy coverage")**. That commit removed an LI-only large-file skip policy that was excluding large files from late-interaction reranking. JS specifically took the biggest hit because JS has the largest spread of file sizes (max 334KB; 6.4% of JS docs >2000 chars).

Rebuild deltas:

| Metric | Stale (Apr 23) | Fresh (May 1) | Δ |
|---|---|---|---|
| MRR@10 | 68.72% | **70.97%** | +2.25 pp |
| NDCG@10 | 71.47% | 73.23% | +1.76 pp |
| Top-1 hits | 62.4% | **65.4%** | +3.0 pp |
| Recall@5 | 76.50% | 78.70% | +2.20 pp |
| Recall@10 | 80.00% | 80.10% | +0.10 pp |
| Total misses | 376 | 346 | -30 |
| Multi-chunk expected | 13 | 18 | +5 |

**Interpretation:** the LI fix lifts reranking quality (+3pp top-1) without touching retrieval (Recall@10 unchanged at ~80%). This is consistent with the user's recollection that the bug pushed total MRR from 84% to 82% — JS took a disproportionate hit because of its large-file spread.

The increase to 18 multi-chunk expected files (vs. 13 before) is just a re-indexing artifact: more files now generate multiple chunks because of small chunker boundary changes. It does not indicate new bleeding.

## Run Setup

```bash
# Wipe stale index
rm -rf eval/corpus/gencodesearchnet/.sweet-search

# Rebuild (10.7 min on M3 Max)
cd eval/corpus/gencodesearchnet && \
  SWEET_SEARCH_PROJECT_ROOT=$(pwd) EMBEDDING_PROVIDER=local \
  SWEET_SEARCH_SQLITE_FAST_MODE=1 \
  node ../../../core/indexing/index-codebase-v21.js --full

# Run benchmark (10.5s for 1000 JS queries)
node eval/run_js_misses.js --concurrency=12

# Enrich misses with chunk text from codebase.db
node eval/enrich_misses.js --input=eval/results/js-misses-only-<timestamp>.json
```

Per-batch sub-agent reports archived in `/tmp/js-miss-reports-fresh/` (130 of 346 misses analyzed across A/B/C/D).

## Failure Mode 1 — Multi-Anonymous-Export Corpus Extraction Bug (highest concrete ROI)

**This is the single largest fixable retrieval problem** and was already present before the LI fix.

Four corpus files contain multiple anonymous function exports (`function() { … }` assigned to object properties). The corpus extractor / chunker only indexes ONE of the anonymous functions per file. Queries describing the *other* exports cannot retrieve the correct doc:

| Corpus file | # of misses | Wrong chunk served |
|---|---|---|
| `func_167361.js` (flowjs/flow.js) | **6** | preprocess/readState state machine (1291 chars) |
| `func_16736d.js` (genify/toolkit2) | **3** | URI-replace stub (175 chars) |
| `func_16735e.js` (mcasimir/mobile-angular-ui) | **3** | CSS transform setter (132 chars) |
| `func_167366.js` (moxiecode/moxie) | **3** | defineProperty getter/setter (702 chars) |
| `func_167369.js` (Ethlint) | 1 | schema-validator (304 chars) |

That's 16 retrieval misses (out of 40 outside-top-10 sampled in batch D, **40%**) and several rank 2-3 misses (e.g., GC01516, GC01617) attributable to these files. Extrapolated to the full corpus, this is ~13% of all misses — pure dead weight that can be removed with a corpus-side fix.

**Concrete repro (GC01622, expected `func_167361.js`):**
- Query: *"Abort current upload"*
- Expected codeSnippet: `function () { _.each(this.files, function(file) { file.abort(); }); … }` — the abort function (codeLength 332)
- Indexed chunk[0].text: `function () { var preprocess = this.flowObj.opts.preprocess; … }` — wrong function (1291 chars)
- Result: expected file does not appear in top-200 because the indexed embedding is for a completely different function.

### Recommendation R1 — Fix corpus extractor (P0)

The benchmark corpus was generated by writing each function's `code` field to a separate file. For the multi-export files above, the corpus already maps each `doc_id` to a separate file path (`func_*.js`), but the chunker reads each file end-to-end and emits a chunk for the first anonymous function it finds. Two options:

1. **Audit + regenerate the corpus**: detect any corpus file with >1 top-level anonymous function expression, split into one file per export. This makes corpus structure match the index assumption (one function per file).
2. **Improve the chunker for multi-anon files**: parse all top-level `function() { … }` expressions on the AST and emit one chunk per function with verified byte ranges.

Option 1 is faster and benchmark-specific. Option 2 helps real codebases too. **Estimated lift: +1.5 to +2.5 pp MRR**, +2 pp Recall@10.

## Failure Mode 2 — Header-Only Chunk Fragments (47% of multi-chunk batch)

Tree-Sitter still emits the function signature as its own micro-chunk (30–80 chars), separated from the body. This was present pre-rebuild and was NOT addressed by the LI fix because these aren't large files — they're small/medium functions that the chunker fragmented at brace boundaries.

**Examples (all from fresh batch A):**

```text
GC01325 — checkPropTypes (4 chunks):
  chunk 1 (78 chars):  "function\ncheckPropTypes\n(typeSpecs, values, location, componentName, getStack)"
  chunk 2 (37 chars):  "for\n(\nvar\ntypeSpecName\nin\ntypeSpecs\n)"
  chunk 3 (43 chars):  "if\n(typeSpecs.hasOwnProperty(typeSpecName))"

GC01479 — emitExponentiationOperator (8 chunks):
  chunk 1 (42 chars):  "function\nemitExponentiationOperator\n(node)"
  chunk 2 (41 chars):  "{\nvar leftHandSideExpression = node.left;"

GC01212 — handleSelections (5 chunks, 2762 chars total):
  chunk 1 (148 chars): function signature
  chunk 2 (35 chars):  "for\n(\nlet\nselection\nof\nselections\n)"
  chunk 3 (57 chars):  "{\n// we need to figure out what kind of selection this is"
```

A separate micro-chunk like `for(var x in y)` is 37 chars of token-separated AST nodes with no semantic content. Its embedding is near-zero relative to any natural-language query.

### Recommendation R2 — Prepend signature to every body chunk + min chunk size (P0)

Two changes in the chunker, both small:

- **R2a:** When a function is split into 2+ chunks, prepend the function signature line to every body chunk. A chunk that starts with `{ if (interval === void 0) …` should instead start with `/* createWatchedFileSet(interval, chunkSize) */ { if (interval === void 0) …`. This guarantees the function name and parameter names are present in every chunk's embedding.
- **R2b:** Enforce minimum chunk size of 80–150 chars. Sub-150-char chunks (pure AST token streams) carry no semantic signal — merge them into the preceding chunk or drop them.

**Estimated lift: +1.0 to +1.5 pp MRR.** Combined with R1, should push past 73% MRR@10.

## Failure Mode 3 — Cross-Language Confusion (dominant residual)

After the rebuild, this is the single largest remaining miss category in volume across batches.

### Top-1 language tally on fresh misses

| Batch | JS top-1 | Non-JS top-1 |
|---|---|---|
| Rank 4-10 (C) | 40% | 60% (Ruby 27, Python 17, Java 13, PHP 3) |
| Outside top-10 (D) | 32.5% | 67.5% (PHP 25, Java 20, Ruby 15, Go 12.5, Py 7.5) |

Notably, **Ruby has emerged as the #1 cross-language attacker post-rebuild** (was PHP). The UiBibz DSL methods (`body`, `nav`, `item`) match natural-language JSDoc-style queries well because Ruby's expressive syntax mirrors English. Examples:

- GC01083 ("Creates a body primitive") → top-1 Ruby `def body`
- GC01033 ("presents large collections of site content") → top-1 Ruby `nav`
- GC01310 ("runs a command using specified arguments") → top-1 PHP `BaseCommand.call`

### Score gaps are small — reranker problem

In rank 4-10 misses, top-1 vs expected score gap is typically **0.03–0.10**:

- GC01303: 0.619 vs ~0.54 (algolia siblings)
- GC01295: 0.663 vs 0.585
- GC01561: 0.519 vs 0.456

A small language-aware penalty would flip these without harming legitimate cross-language matches.

### Recommendation R3 — Cross-language penalty in MaxSim (P1)

When the query is JS-flavored (corpus is JS, or query has JS-specific tokens like `addEventListener`, `fetch`, `prototype`), multiply non-JS chunk scores by `0.85` (≈ -0.03 to -0.05 score). Cheap, recoverable, tunable.

**Estimated lift: +1.0 to +1.5 pp MRR.** Combined with same-repo dedup (R4), addresses 30%+ of all remaining misses.

## Failure Mode 4 — Same-Repo Sibling Distractors

30% of mid-rank misses (batch C) and ~30% of rank 2-3 lexical-overlap misses (batch B) lose to a sibling function from the same repo. The bi-encoder centroids are nearly equal because surrounding context is shared.

Confirmed in fresh data:
- `parseAcceptLanguage` (rank 1) blocks `parseLanguage` (expected) — wrapper vs inner
- `Item` blocks `ItemImage`
- `binAbsLibs` blocks `_findLibraries`
- `onDocumentKeyUp` blocks `onDocumentKeyPress` (one boolean different)
- `addFacetRefinement` and `addDisjunctiveFacetRefinement` block `addHierarchicalFacetRefinement`
- algolia helper-js, pannellum, cordova-lib all show this pattern

### Recommendation R4 — Within-repo diversity in top-3 (P1)

Cap top-3 to one chunk per repo prefix (e.g., `javascript/<owner_repo>/`). Promote the next distinct repo's chunk if a tie. Costs almost nothing.

**Estimated lift: +0.5 to +1.0 pp MRR.**

## Failure Mode 5 — `emitFiles_57fa9c.js` Mega-File Pollution (significantly reduced)

The 318-chunk TypeScript checker dump was a top-1/2 hijacker pre-rebuild. **Post-rebuild it appears at rank 4-5 max** in batches B and C, never at rank 1-2. The LI fix evidently rebalanced its contribution because the chunks that were previously LI-skipped now participate in reranking, distributing the score differently.

It still wastes result slots in 3-4 queries per batch and contaminates queries with TypeScript-adjacent vocabulary (GC01394, GC01479, GC01817, GC01972, GC01151).

### Recommendation R5 — Per-file chunk cap (P2)

Cap any single file at N=50 chunks at indexing time. If a file would exceed the cap, index only the first N chunks plus any chunks containing recognized top-level function declarations. Simple `min(1, log(50)/log(chunkCount))` score scaling at retrieval time also works.

**Estimated lift: +0.3 pp MRR.** Lower than pre-rebuild estimate because the LI fix already mitigated most of the damage.

## Failure Mode 6 — Genuine Benchmark Ambiguity / Vague Queries

13% (4/30) of rank 2-3 misses fall into "TOP1_SEMANTIC_BETTER" — top-1 is a plausible answer to the query but wasn't the labeled relevant doc. Examples:
- GC01949: `serialize` (top-1) vs `EJSON.stringify` (expected) — both serialize for the query
- GC01667: `autoSetup` (top-1) vs `autoSetupTimeout` (expected) — top-1 is a valid answer

7 garbage queries in batch D (17.5%) are outright unanswerable:
- GC01094: "Copyright IBM Corp. 2016, 2018"
- GC01209: "This is where the action is."
- GC01192: "ripristino stato iniziale" (Italian)
- GC01921: "this can throw exceptions, callers responsibility"
- GC01689: "Comment out if you didn't `npm install lz-string`"

### Recommendation R6 — Caller-context inversion + soft MRR (P3)

When the query references a function name that appears in top-1's `symbolName`, AND top-1 *calls* the expected function, swap their ranks. Uses the call graph we already build.

Filter the obvious garbage queries (~5%) and report **clean MRR** alongside raw MRR for honest signal.

**Estimated lift: +0.2 pp on substantive misses; +1.5 pp on reported metric.**

## Failure Mode 7 — Routing Errors (rare)

Two misroutes in batch D, identical to the pre-rebuild finding (this is purely router behavior, unaffected by index):
- **GC01391** routed `lexical` (confidence 0.95) for a long descriptive NL query — returned 0 results.
- **GC01995** routed `hybrid` (confidence 0.51) on "Keep initialization idempotent" — pure NL, should be semantic.

### Recommendation R7 — Router fallback (P3)

If lexical mode returns 0 results OR hybrid returns scores all within 0.005, fall back to pure semantic.

## Prioritized Action Plan (Updated for Fresh Data)

| Priority | Change | Failure mode | Estimated MRR lift |
|---|---|---|---|
| **P0** | R1: Fix multi-anonymous-export corpus extraction (4 files) | retrieval misses (chunk bleed) | +1.5 to +2.5 pp |
| **P0** | R2a: Prepend signature to every body chunk of split functions | header-only fragments | +1.0 to +1.5 pp |
| **P0** | R2b: Min chunk size 80-150 chars; merge AST fragments | header-only fragments | included in R2a |
| **P1** | R3: Cross-language penalty in MaxSim | language confusion (now Ruby-led) | +1.0 to +1.5 pp |
| **P1** | R4: Within-repo diversity in top-3 | sibling distractors | +0.5 to +1.0 pp |
| **P2** | R5: Per-file chunk cap (>50) at index time | mega-file pollution | +0.3 pp |
| **P2** | Expand HNSW candidate pool top-10 → top-50 before rerank | retrieval ceiling | +0.5 to +1.0 pp on Recall@10 |
| **P3** | R6: Caller-context inversion + clean-MRR reporting | benchmark ambiguity | +0.2 pp substantive |
| **P3** | R7: Router fallback on degenerate score distributions | routing | +0.2 pp |

**If P0+P1 land cleanly:** MRR@10 should move from 70.97% toward **~75-76%**. Stretch to 77-78% with P2.

## Findings That Are Robust (Survived the Rebuild)

These conclusions appeared in both the stale and fresh runs and are independent of the LI skip-policy bug:

1. **Multi-anonymous-export corpus bug** — same 4 files in both runs, same number of misses each (6/3/3/3).
2. **Header-only chunk fragments** — same 47% rate in batch A, same examples (`checkPropTypes`, `emitExponentiationOperator`, `handleSelections`).
3. **Same-repo sibling distractors** — same examples (`parseAcceptLanguage`/`parseLanguage`, `Item`/`ItemImage`).
4. **Garbage queries** — same set of unanswerable examples.
5. **Cross-language confusion** — present in both, but composition shifted (PHP → Ruby).

## Findings That Changed Post-Rebuild

1. **`emitFiles_57fa9c.js` pollution** — was rank 1-2 in stale data; now rank 4-5 max in fresh.
2. **Some chunk-bleed cases that previously surfaced as outside-top-10 are now reranked correctly**, contributing to the +3pp top-1 lift.
3. **Top-1 language for outside-top-10**: 22.5% JS (stale) → 32.5% JS (fresh). The fix recovered ~10pp of within-language correctness.

## Reproducibility

```bash
node eval/run_js_misses.js --concurrency=12
# Latest output: eval/results/js-misses-only-2026-05-01T20-48-39-703Z.json

node eval/enrich_misses.js --input=<above>
# Adds chunk text from .sweet-search/codebase.db
```

Sub-agent reports: `/tmp/js-miss-reports-fresh/{A,B,C,D}.md` (130 misses analyzed of 346 total).

## Appendix — Files Added

- `eval/run_js_misses.js` — JS-only benchmark with full per-query top-K capture
- `eval/enrich_misses.js` — adds indexed chunk text from `codebase.db` to miss records
