# Cross-Tool Benchmark-Shape Audit — ss-search + ss-find

**Date**: 2026-05-13
**Author**: Claude (cross-tool audit session, picking up after ss-semantic Stage 0)
**Status**: STOP-RULE TRIPPED — both tools' PARTIAL bucket is dominated by chunker-label artifacts; recommend secondary metric (no production code changes proposed)
**Discipline**: DEV-only (BEIR/CoIR; held-out NOT inspected)

---

## Headline

After auditing the existing v1 (ss-search) and v8 (ss-find) sweep artifacts on the **dev split only**, the strict `symbolRecallAt1` rubric is materially under-reporting both tools' quality.

| Tool | Strict PASS | Strict PARTIAL | Strict FAIL | Hidden-PASS PARTIALs (DEF-only) | Hidden-PASS PARTIALs (DEF+REF) | FAILs with file at rank 2-5 |
|---|---|---|---|---|---|---|
| **ss-search** | 51 / 90 (56.7%) | 18 / 90 (20.0%) | 21 / 90 (23.3%) | 12 / 18 (**66.7%**) | 15 / 18 (**83.3%**) | 16 / 21 (**76.2%**) |
| **ss-find**   | 63 / 89 (70.8%) | 13 / 89 (14.6%) | 13 / 89 (14.6%) | 12 / 13 (**92.3%**) | 13 / 13 (**100%**)  | 11 / 13 (**84.6%**) |

Stop-rule from the handoff (Stage 2):

> If > 30% of PARTIALs would flip to PASS under text-contains, recommend the user adopt that as a published secondary metric.

Both tools blow past 30% — by **2.2× / 3.1×** under the strict DEF-only reading, and by **2.8× / 3.3×** under DEF+REF.

Equivalent relaxed PASS rates:

| Tool | Strict PASS | DEF-only relaxed PASS | DEF+REF relaxed PASS |
|---|---|---|---|
| ss-search | 56.7% | 70.0% (Δ **+13.3pp**) | 73.3% (Δ **+16.6pp**) |
| ss-find   | 70.8% | 84.3% (Δ **+13.5pp**) | 85.4% (Δ **+14.6pp**) |

`file_recall@5` − `file_recall@1` gap is also large:

| Tool | file_recall@1 | file_recall@5 | Δ |
|---|---|---|---|
| ss-search | 76.7% | 94.4% | **+17.7pp** |
| ss-find   | 85.4% | 97.8% | **+12.4pp** |

---

## Stage 1 — Top-1 ordering: NOT a problem here

The ss-semantic Fix 1A landmine (`gradeSpans` was reading first-by-line as top-1 because `_enforceCharBudget` line-sorted merged spans for readability) **does NOT reproduce in ss-search or ss-find**:

- **ss-search** (`core/prompt-optimization/scripts/track-a-runner.mjs:115-165`) grades `results[0]` from `searcher.search(...)`. Path:
  - `_applyPostRetrieval` re-sorts by score after every score-modifying step (legacy LI rerank at `search-postprocess.js:670`, quality scoring at `:717`, intent boosts at `:752/:764`, `applyFileKindRanking` at `file-kind-ranking.js:2419`, `applyResultDemotions` at `:2283`).
  - `packageForAgent` (`context-expander.js:1890`) preserves `rankedResults[0]` as top-1; the locality-clustering block at `:1940-1967` only swaps ranks 2-3, with the explicit comment "Top-1 is never moved."
- **ss-find** (`core/prompt-optimization/scripts/ss-find/track-a-runner-ss-find.mjs:171-211`) grades `patternSearch(...).results[0]`. `patternSearch` sorts by `lateInteractionScore` descending at `search-pattern.js:314`, then `applyFileKindRanking`/`applyResultDemotions`, then `slice(0, k)`, then `packageForAgent` (preserves top-1). Score-max → top-1.

So `gradeResult()`'s `results[0]` is already the highest-score result — no rubric bug analogous to ss-semantic's. The Stage 1 audit is **negative** on this dimension.

(Per the handoff, this stop-rule would have been the headline finding if positive — confirming negative result was the cheapest, highest-leverage check.)

---

## Stage 2 — PARTIAL → chunk text contains expected symbol

### Method

- DEV split (`eval/ast-tester-probes/splits/manifest.json`, seed=42).
- For each dev gold, pick the row corresponding to the winning shape per `recommendations-v2*.json`:
  - **ss-search**: default `V7`, override JS-mobile→`V2`, override C-family→`V4`
  - **ss-find**: default `R2|Q3`, override JS-mobile→`R3|Q4`
- For each PARTIAL row, read `top1.file[startLine..endLine]` from the locked AST-tester-probes repo (SHA-pinned at `eval/ast-tester-probes/repos.json`), then scan for the expected symbol with a word-boundary regex.
- Refined classifier (`scripts/cross-tool-audit-spotcheck-v2.mjs`) distinguishes:
  - **strong** — chunk contains the actual *definition* of the expected symbol (def-keyword immediately precedes; or C-style `Type *symbol(args)` signature)
  - **weak** — chunk references the symbol in code (`new X(...)`, `Context | None`, etc.) but does not define it
  - **comment-only** — only mentioned inside `//` / `/**` / `///` / `"""` / `#` comments

### Headlines

**ss-search (n=18 dev PARTIALs under winning shapes):** 12 strong, 3 weak, 1 comment-only.
**ss-find  (n=13 dev PARTIALs):** 12 strong, 1 weak, 0 comment-only.

### What "PARTIAL means hidden PASS" actually looks like

Sample of strong hidden PASSes (the chunker labelled the chunk with a *sibling-symbol* — i.e., a different symbol that happens to live in the same chunk's bounds — even though the chunk genuinely contains the gold's definition):

| Gold | Tool | Chunker label | Actual def at line | Expected symbol |
|---|---|---|---|---|
| TS-008 | both | `regularPrompt` | 66: `export const systemPrompt = ({` | `systemPrompt` |
| RS-004 | ss-search | `ViolationMetadata` | 49: `pub trait Violation: ViolationMetadata + Sized {` | `Violation` |
| CS-002 | ss-search | `LatencyMetrics` | 45: `internal sealed unsafe partial class RespServerSession : ServerSessionBase` | `RespServerSession` |
| CPP-003 | both | `hwy` | 341: `struct ChosenTarget {` | `ChosenTarget` |
| CPP-006 | both | `hwy` | 73: `class AlignedDeleter {` | `AlignedDeleter` |
| C-002 | both | `redisContext` | 815: `redisContext *redisConnectWithOptions(...)` | `redisConnectWithOptions` |
| C-005 | both | `timeval` | 885: `redisContext *redisConnect(...)` | `redisConnect` |
| JV-005 | ss-find | `GsonBuilder` | 739: `public GsonBuilder registerTypeAdapter(Type, Object)` | `registerTypeAdapter` |
| RB-002 | ss-find | `Sinatra` | 31: `class Request < Rack::Request` | `Request` |
| DR-008 | ss-find | `BaseResponseWithUrl` | 150: `extension HeadersWithSplitValues on BaseResponse {` | `HeadersWithSplitValues` |

The chunker frequently picks one symbol-name from a sibling-merge chunk (often the first-defined or outermost) and labels the whole chunk with it; the *other* symbols in the same chunk become "invisible" to strict symbol-recall even though their source is in the returned span.

This is the **same F1 pattern** identified by the ss-find Phase 6 v2 audit (project_ssfind_phase6_v2_audit_2026_05_13.md). What's new: it dominates the PARTIAL bucket on both tools.

### The 3 ss-search + 1 ss-find weak/comment-only cases

| Gold | Tool | Why "weak / comment-only" |
|---|---|---|
| CS-005 | ss-search | Chunk 375-517 is a method body that *instantiates* `new LoaderBlockCache(...)` at line 471, but the type definition lives at line 20 (outside this chunk). For ss-find, the chunk is 15-518 and DOES contain the def — strong. |
| PY-004 | ss-search | Chunk top-1 (`<anonymous:decorator>` at 258-321) calls `command(cls=cls, **attrs)` at line 309 — uses the symbol but doesn't define it. The real def of `command` is upstream in click/decorators.py. |
| LU-001 | ss-search | `local c = _class(...)` at line 228 — instantiation. The def of `_class` is at line 70 of `class.lua`, outside the 220-237 top-1 chunk. |
| DR-008 | ss-search | Top-1 chunk 11-87 only mentions `HeadersWithSplitValues` in a docstring `[HeadersWithSplitValues.headersSplitValues]` (line 52). The actual `extension` def is at line 150, in a different chunk. Under ss-find this gold's top-1 IS the right chunk (118-171, strong). |
| PY-002 | ss-find | Chunk 1210-1245 contains `parent: Context | None = None,` (type annotation, ref) but the `class Context` def is at line 1054. |

**Even these "weak" cases are agent-useful** to a degree: the returned chunk contains *a* usage of the symbol with surrounding context. They're closer to "found a relevant span" than "wrong file". But they don't deserve strict-PASS credit under any reasonable rubric.

---

## Stage 3 — FAIL → expected file is in top-5

Both runners already store `fileRecallAt5` on every row, so this is free.

- **ss-search**: 16 of 21 dev FAILs (76.2%) have `fileRecallAt5 = 1` — i.e., the expected file appeared at rank 2-5 even though it missed rank 1. `file_recall@5 = 94.4%` vs `file_recall@1 = 76.7%` (Δ +17.7pp).
- **ss-find**: 11 of 13 dev FAILs (84.6%) have `fileRecallAt5 = 1`. `file_recall@5 = 97.8%` vs `file_recall@1 = 85.4%` (Δ +12.4pp).

Both gaps are above the handoff's 10pp threshold for "rubric under-credits multi-result retrievals".

---

## Recommendations

### What to do with the existing `recommendations-v2*.json` artifacts

**Do not republish** without user approval. The winning *cells* don't change under the relaxed rubrics — V7 / V2 / V4 (ss-search) and R2|Q3 / R3|Q4 (ss-find) win on both strict and relaxed PASS counts. What changes is the headline number reported alongside them. Specifically:

- The existing single-line PASS rate (`symbolRecallAt1`) understates real performance by 13–14pp under the conservative relaxed rubric.
- Publish a `symbolRecallAt1_strict` AND a `symbolRecallAt1_relaxed_def` (chunk contains expected symbol as definition) pair, with the strict number remaining the primary for backward comparability.

Worth considering: adding a third secondary metric `fileRecallAt5` so the FAIL bucket's "right file at rank 2-5" signal is visible. Currently it's stored in JSONL but not summarized.

### What this changes about Stage 4 (rank-time fix work)

If the user pursues further rank-time fixes after this audit, the **chunker-label artifact dominates the PARTIAL bucket on both tools**. The remediations split:

- **Chunker fix path** (ss-find audit identified Mode F1): re-label sibling-merged chunks so the chunker emits a separate label for each contained symbol, instead of one name for the whole sibling-merge block. Requires reindex of all 19 probe repos and the production indexes. Strong improvement but high cost.
- **Presentation-time re-labelling** (`context-expander.js` agent-format path): when the agent-mode top-1 chunk spans multiple symbols and the query mentions one of them verbatim, re-label the result with the matching symbol. Lower-risk, ranking-frozen, gated on `format=='agent'` per `feedback_format_gate_boosts`. Could lift the metric without reindexing.
- **None for the comment-only DR-008 ss-search case** — that one is a real chunker-decomposition shortfall: the `extension HeadersWithSplitValues on BaseResponse` def at line 150 is in a different chunk than the top-1's 11-87 range. Either the chunker needs to emit a chunk at 118-171 (which ss-find's chunk did), or the ranker needs to prefer it.

### What this DOESN'T change

- **Locked baselines** (GCSN dev 86.92% MRR, retrieval-probes post-perf-60): the production code paths aren't touched in this audit. No regression risk from this work itself.
- **Held-out (40% of probes)**: NOT inspected per-query, in line with `feedback_heldout_discipline_strict`. The held-out aggregate should be re-graded under both strict and relaxed rubrics at the next milestone — but only after the user signs off on the new rubric (BEIR/CoIR discipline forbids fitting to held-out signal).

### What you should NOT conclude from this audit

- **The tools are 13-14pp better than published** — only under the relaxed rubric. Under the strict rubric (which is what most search benchmarks use), the published numbers are honest. The audit's point is that the *strict rubric* is under-measuring agent-useful retrievals, not that the tools improved.
- **Recall@5 = published Recall@5** — this audit only computed file-recall@5 from existing JSONL fields; symbol-recall@5 was not computed (would require re-grading every top-5 result for symbol match). If we want a published Recall@5 number, we need a sweep rerun that emits top-5 symbols.

---

## Stage 5 — Behavioural-rewrite calibration (not done; recommended)

The ss-semantic Stage 0.5 produced 38 behavioural rewrites (via DeepSeek V4-Flash, ~$0.04) to calibrate strict vs. behavioural. That work established: every Stage 4 fix must report deltas on *both* benchmarks, and strict-only wins are suspect (likely riding on symbol-verbatim signal that real agent queries wouldn't have).

For ss-search and ss-find, the analog is even more valuable because:

- ss-search shapes V1-V7 already vary "with/without symbol verbatim" by construction (V2 = symbol-required short interrogative; V6 = no-symbol long NL). The behavioural-rewrite stage tests whether the *current best cell selection* would still hold under symbol-anonymized real-agent queries.
- ss-find requires a regex anchor; the question is whether the agent supplies a clean enough symbol to construct it. R5 (small-alternation, sibling-aware) tests one direction; behavioural rewrites can stress the regex construction itself.

**Not run in this audit** — would add ~$0.04 + 30 min implementation; skipped per the handoff's "high-leverage but low-cost" framing. If user approves, this is the natural next step.

---

## Artifacts

- Summary JSON: `core/prompt-optimization/data/query-shapes/cross-tool-audit-2026-05-13.json`
- Refined PARTIAL classifications: `core/prompt-optimization/data/query-shapes/cross-tool-audit-2026-05-13-spotcheck.json`
- This document: `core/prompt-optimization/data/query-shapes/cross-tool-benchmark-audit-2026-05-13.md`
- Audit script (Stages 2+3): `core/prompt-optimization/scripts/cross-tool-audit-2026-05-13.mjs`
- Spot-check script (Stage 2 strong-vs-weak): `core/prompt-optimization/scripts/cross-tool-audit-spotcheck-v2.mjs`

Inputs (read-only):

- Splits: `eval/ast-tester-probes/splits/manifest.json` (seed=42, n=95 dev / 57 held-out)
- ss-search sweep: `core/prompt-optimization/data/query-shapes/tracks/track-a-phase6-redo-v1.jsonl`
- ss-find sweep: `core/prompt-optimization/data/query-shapes/ss-find/tracks/track-a-phase6-redo-ss-find-v8.jsonl`
- Winners: `core/prompt-optimization/data/query-shapes/recommendations-v2.json` and `recommendations-v2-ss-find.json`
- Locked corpora: `eval/ast-tester-probes/_repos/<lang>/`

---

## Reproducibility checklist

```bash
# Run from repo root
node core/prompt-optimization/scripts/cross-tool-audit-2026-05-13.mjs
node core/prompt-optimization/scripts/cross-tool-audit-spotcheck-v2.mjs
```

Outputs deterministic — no LLM calls, no network, no DB writes.

---

## Stop here

Per handoff rules of engagement: **no production code changes proposed**, **verified against the locked repo files (not goldNotes)**, **DEV-only**. The Stage 2 stop-rule is tripped on both tools; the user makes the call on whether to (a) publish the relaxed rubric as secondary, (b) prioritize chunker re-labelling or presentation-time re-labelling, or (c) run Stage 5 behavioural calibration before either.

Related memory:
- [[project_sssemantic_phase6_v2_stage0_2026_05_13]] — prior art on ss-semantic
- [[project_ssfind_phase6_v2_audit_2026_05_13]] — Mode F1 chunker-label pattern already documented
- [[feedback_heldout_discipline_strict]] — held-out not touched in this audit
- [[feedback_taxonomy_classification_caveat]] — "would convert N" predictions verified against the locked source, not goldNotes
