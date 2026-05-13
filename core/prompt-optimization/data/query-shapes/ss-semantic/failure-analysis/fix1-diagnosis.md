# Fix 1 diagnosis — "file-header top-1" splits into two distinct issues

**Date**: 2026-05-13
**Tool**: `diagnose-file-header.mjs` (verbose readSemantic + signal dump on JV-002, RB-001, RB-004)
**Status**: Diagnosed. Ship decision pending (separate from Stage 0.5).

## Three cases, three different stories

### JV-002 "get constructor" — purely a grading-rubric bug

| chunk | score | lex | sym | maxsim | symbol | line range |
|---|---|---|---|---|---|---|
| 103-103 (top-1 pre-merge) | 0.569 | 1.00 | 0.00 | 0.569 | (null) | 1L code |
| 103-117 | 0.556 | 2.00 | 5.00 | 0.556 | get | 15L method |
| **★ 91-102 (GOLD)** | 0.542 | 2.58 | 5.00 | 0.542 | get | 12L method |
| 1-44 (file header) | 0.505 | 1.00 | 0.00 | 0.505 | (null) | 44L code |

After `_expandAndMergeSpans` + `_enforceCharBudget`:
- merged 89-173 (score 0.569) ← contains gold, **highest score**
- merged 1-47 (score 0.505) ← file header + class chunk
- 449-466 (score 0.496)

Then `_enforceCharBudget` re-sorts merged spans **by line** for output readability:
1. 1-47 ← line-sorted first
2. 89-173 ← line-sorted second (but **highest-score span**, contains gold)
3. 449-466

`gradeSpans` takes `spans[0]` = 1-47 → IoU(1-47, 91-102) = 0 → FAIL.

**But the highest-score span (89-173) contains the gold with IoU=12/85=0.141 (PARTIAL).** This is a **grading-rubric instrumentation bug**, not a tool bug. The tool found the right region as the highest-score answer; the benchmark just looked at the wrong span.

### RB-004 "find Sinatra::Application" — same grading-rubric bug

| chunk | score | line range | contains gold? |
|---|---|---|---|
| **★ 2078-2096 (pre-merge top-1, GOLD)** | 0.532 | 19L | YES |
| 1-41 (file header) | 0.491 | 41L | no |

After merge + budget, spans returned line-sorted:
1. 1-41 (score 0.491)
2. 279-287
3. 969-996
4. **2076-2174 (score 0.532, contains gold, IoU=19/99=0.192)** ← actual top by score

`gradeSpans` looks at spans[0]=1-41 → IoU=0 → FAIL. Score-correct grading: span 2076-2174 → IoU=0.192 → PARTIAL.

### RB-001 "show Sinatra::Base" — genuine ranker issue

| chunk | score | maxsim | symbol | line range |
|---|---|---|---|---|
| 28-30 (`module Sinatra` decl) | **0.569** | **0.569** | (null) | 3L module |
| **★ 971-994 (Base class, GOLD)** | 0.531 | 0.531 | Base | 24L class |
| 28-39 | 0.522 | 0.522 | Sinatra | 12L module |
| 2078-2096 | 0.512 | 0.512 | Application | 19L class |
| 1-26 (file header) | 0.509 | 0.509 | (null) | 26L code |

Here the file-header-adjacent `module Sinatra` chunk (lines 28-30) **genuinely scored higher** than the gold (Base class, lines 971-994) on MaxSim (0.569 vs 0.531). This is a **real tool bug**, not a grading artifact. The bi-encoder's MaxSim is rewarding the dense `Sinatra` token presence in a tiny 3-line module-decl chunk over the actual Base class body.

Even with score-correct grading, RB-001 stays FAIL because the wrong-region chunk has the highest score.

## Categorical split of the 3 dev "file-header top-1" cases

| case | category | fix needed |
|---|---|---|
| JV-002 | **grading-rubric only** | gradeSpans top-1 = max-score, not first-by-line |
| RB-004 | **grading-rubric only** | same |
| RB-001 | **real ranker bug** | MaxSim-on-tiny-chunks demotion, or symbol-presence boost on per-file scoring |

So of my Stage 0 "3 file-header-top-1 FAILs", **2 are grading-rubric bugs (cheap to fix in 5 lines)** and **1 is a real ranker bug (deeper fix)**.

## Why this matters for Stage 0.5 calibration

The grading-rubric fix is interesting under our two-benchmark methodology. Re-grading with score-correct top-1 likely improves BOTH benchmarks (strict + behavioural), because the bug applies equally to any query shape. This is the cleanest sort of fix — pure instrumentation correction, no ranker change, no format-gating needed (it's the BENCHMARK that's miscounting).

The MaxSim-on-tiny-chunks fix (RB-001 type) is more delicate. Format-gating it for ss-semantic only is correct (don't disturb ss-search). Need to check that the demotion doesn't hurt cases where a short chunk is genuinely the right answer.

## Proposed fix

### Fix 1a (grading-rubric, ~5 lines)

In `track-a-runner-ss-semantic.mjs:gradeSpans`:

```js
// Re-sort spans by score-desc for top-1 grading. The runner's `spans` array
// is delivered in line-order by `_enforceCharBudget` (intentional, for human
// readability), but for top-1 IoU the highest-scoring span is the real
// "top-1 answer".
const byScore = [...spans].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
const top = byScore[0];
```

Expected dev impact (re-grade v2 sweep on best-shape):
- JV-002: FAIL → PARTIAL (top1 0 → 0.141)
- RB-004: FAIL → PARTIAL (top1 0 → 0.192)
- Likely additional flips on golds I haven't inspected — need to re-run audit

Cost: re-runs are free (just re-grades existing spans). No new tool calls.

### Fix 1b (ranker, format-gated)

For chunks with no symbol AND line range either (a) at file head (startLine ≤ 50) AND (b) short (≤ 5 lines) AND (c) chunk type ∈ {'code', 'module', 'namespace'}, apply a small MaxSim demotion (multiplicative factor ~0.85, say).

Rationale: such chunks are usually module/namespace declarations that carry the file's main identifier token (`module Sinatra` ↔ "Sinatra"), and their MaxSim inflates from concentrated literal-token presence in a very small window. Real intent of an agent searching "show Sinatra::Base" is the Base class body, not the module wrapper declaration.

Tunable: 0.85 is a guess. Should be validated by:
- Re-running both benchmarks on dev
- Confirming retrieval-probes hold (zero PASS→FAIL)
- Spot-check that no other golds regress

## Why I'm not shipping Fix 1a today

The grading-rubric change touches `gradeSpans` which is the source of TRUTH for every dev verdict in this Phase 6 v2 work. Changing it mid-stream invalidates the v2 sweep comparison numbers I just landed. Worth one extra session to:
1. Update `gradeSpans`
2. Re-run audit on both v2 strict + behavioural tracks
3. Get a clean new baseline
4. THEN proceed to ranker fixes against that baseline

Equally important: I want a sanity check from the user that "top-1 = highest-score span" matches their intent for `ss-semantic` UX. There's an alternate view: the agent reads spans in line-order (which is what `_enforceCharBudget` produces today), so "top-1 IoU" by line-order matches what an agent actually USES first. If that's the user's mental model, the current rubric is correct and JV-002/RB-004 are real failures.

This is a 2-minute user question that decides the whole methodology.
