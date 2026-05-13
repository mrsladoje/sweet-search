# Stage 0 — Benchmark-design audit for ss-semantic (Phase 6 v2 prep)

**Date**: 2026-05-13
**Author**: Claude (Phase 6 v2 audit session)
**Status**: STOP-RULE TRIPPED — escalating to user before any rank-time work
**Discipline**: DEV-ONLY (per CLAUDE.md BEIR/CoIR methodology; held-out NOT inspected)

---

## Headline

Two independent issues with the v1 sweep data:

1. **Sweep-instrumentation drift** (~6.7% of dev rows): 6 of 90 dev rows have stale `goldRange` because the v1 sweep ran BEFORE preprocess.mjs's chunks[0]→bySymbol fix (lines 219-246). 4 of 6 had wrong verdicts.
2. **Benchmark-shape strictness over-penalizes useful returns**: 58.3% of dev FAILs (14/24) returned a span FULLY containing the gold range — the tool found the right region, IoU≥0.5 just punished "wider than gold" spans. **Stage 0 stop-rule is tripped (>50% of FAILs are benchmark-shape).**

Per the handoff:

> Stop rule: if Stage 0 reveals that >50% of the dev failures are benchmark-shape artifacts, escalate to the user before doing rank-time fix work. The right move there might be benchmark redesign (or co-existence: keep the strict IoU benchmark + add a behavioral-query benchmark).

Escalating now.

---

## Stage 0 §1 — Sweep-instrumentation drift (the ss-find Mode A analogue)

| goldId | lang | v1 sweep goldRange | current containingChunk | symbol | impact |
|---|---|---|---|---|---|
| C-002 | c | 1-44 (file hdr) | 815-832 | redisConnectWithOptions | hidden PARTIAL (was FAIL) |
| C-005 | c | 1-44 (file hdr) | 882-927 | redisConnect | still FAIL but now max_iou=0.438 not 0 |
| CPP-003 | cpp | 1-14 (file hdr) | 166-207 | ChosenTarget | still FAIL (genuine miss) |
| **CS-001** | csharp | 1-11 (file hdr) | 279-340 | NetworkSET | **hidden PASS** (top1=0.939) |
| **CS-002** | csharp | 1-19 (file hdr) | 45-57 | RespServerSession | **hidden FAIL** (v1 PASS was fictitious) |
| **CS-005** | csharp | 1-10 (file hdr) | 12-27 | LoaderBlockCache | **hidden PASS** (top1=0.824) |

Net dev verdict shifts (best-query slice, V1/V2 by family):

| metric | v1 sweep | corrected | Δ |
|---|---|---|---|
| PASS | 28 (31.1%) | 29 (32.2%) | +1 |
| PARTIAL | 38 (42.2%) | 39 (43.3%) | +1 |
| FAIL | 24 (26.7%) | 22 (24.4%) | -2 |

Effect is small in aggregate but the **v1 dev numbers are not load-bearing**: 4 of 6 drifted rows had their verdict flip. This mirrors the ss-find Stage 3 finding that v1 PASSes were partly noise. Recommendation: **re-run the sweep** with current preprocess output before any rank-time fix work, so we're not chasing fixes against stale verdicts.

Root cause: preprocess.mjs was patched at lines 219-246 ("Mode A fix 2026-05-13") to scan chunks for the expected symbol before falling back to chunks[0]. The 6 drifted golds are exactly the cases where `candidate?.startLine` was null (code-graph lookup returned no candidate) AND chunks[0] was the file header, so old preprocess emitted file-header as `containingChunk`. The fix landed AFTER the v1 sweep.

---

## Stage 0 §2 — Hand-inspection of 10 dev FAIL cases (probe-intent fit)

Inspected 10 dev FAILs (drawn from `wider-span-contains-gold` and `partial-overlap-only` classes — these are the ambiguous cases the audit was designed to surface). All FAILs listed in `stage0-failures.jsonl`. Verdicts:

| goldId | gold | top-1 span | best-overlap span | useful return? | benchmark-shape? |
|---|---|---|---|---|---|
| C-001 | 742-793 (52L) | 288-330 (wrong) | 740-794 IoU=0.945 | **YES** | yes (right region at #4) |
| CPP-008 | 302-370 (69L) | 183-211 (wrong) | 300-382 IoU=0.831 | **YES** | yes (right region at #2) |
| CS-003 | 479-528 (50L) | 282-307 (wrong) | 428-530 IoU=0.485 | **YES** | yes (right region at #2) |
| JV-002 | 91-102 (12L) | **1-46 (FILE HEADER)** | 89-119 IoU=0.387 | partial | mixed (header bug + wide span) |
| KT-005 | 495-512 (18L) | 199-242 (wrong) | 493-514 IoU=0.818 | **YES** | yes (right region at #3) |
| RB-001 | 971-994 (24L) | **1-41 (FILE HEADER)** | 969-996 IoU=0.857 | **YES** | mixed (header bug + right region at #2) |
| RB-004 | 2078-2096 (19L) | **1-32 (FILE HEADER)** | 2076-2174 IoU=0.192 | partial | mixed (header bug + mega-chunk) |
| RB-006 | 286-302 (17L) | 165-226 (wrong) | 284-304 IoU=0.810 | **YES** | yes (right region at #2) |
| RS-005 | 2255-2268 (14L) | 860-864 (wrong) | 2253-2311 IoU=0.237 | **YES** | yes (right region at #3, 59L span vs 14L gold) |
| TSL-006 | 167-188 (22L) | 94-156 (wrong) | 165-190 IoU=0.846 | **YES** | yes (right region at #2) |

**Eyeball-grade conclusion**: 8 of 10 inspected FAILs returned a span that an agent would find useful (right region exists, well-bounded). The remaining 2 (JV-002, RB-004) had file-header as top-1 — a real ranker bug analogous to ss-find Mode A.

**Pattern split among ALL 24 dev FAILs**:

| pattern | count | %of FAILs | benchmark-shape vs tool-floor |
|---|---|---|---|
| `wider-span-contains-gold` (right region at rank ≥ 2; span wider than gold) | 14 | 58.3% | **benchmark-shape** (mostly) |
| `tool-miss` (no overlap anywhere) | 9 (3 after drift correction) | 12.5% | **tool-floor** |
| `partial-overlap-only` (some overlap < 0.5 IoU, no wider containing span) | 1 | 4.2% | mixed |
| Sub-pattern: top-1 is file header (subset of above) | 3 | 12.5% | **ranker bug** (Mode A analogue) |
| Sub-pattern: gold is ≤4 lines (Scala one-liners; subset of `wider-span-contains-gold`) | 4 of 5 Scala FAILs | — | **benchmark-shape** (IoU≥0.5 near-impossible for 2-line golds) |

The Scala 2-line-gold cluster (SC-001, SC-004, SC-005, SC-008 — `case class X(...)` one-liners) is the strongest single benchmark-shape signal: for a 2-line gold, IoU≥0.5 requires the returned span to be 2-4 lines, which gives the agent zero context. Any reasonable span (e.g., 6 lines = 2 lines context each side) gets IoU=0.333 → graded FAIL.

---

## Stage 0 §3 — Behavioural rewrites (skipped pending decision)

The protocol called for hand-authoring 10 alternative behavioural probes and eyeball-grading them. **Skipped intentionally**: the §1 + §2 evidence already trips the stop-rule (58.3% > 50%), and the Stage 0.5 protocol (LLM-rewritten parallel behavioural benchmark via DeepSeek) is a more rigorous version of the same exercise. If the user approves Stage 0.5, we author 30-50 behavioural probes systematically rather than 10 by hand.

---

## Stage 0 §4 — Decision matrix

| Option | What it means | Cost | Risk |
|---|---|---|---|
| **A. Stage 0.5 (parallel behavioural benchmark)** | Author 30-50 DeepSeek-rewritten behavioural probes alongside existing strict-IoU golds; report Stage 4 fixes on BOTH benchmarks | ~$0.02 + 30 min implementation | low — original benchmark preserved, gain a calibration anchor |
| **B. Benchmark redesign** | Replace IoU≥0.5 with a softer rubric (e.g., "any returned span covers ≥X% of gold AND span:gold ratio ≤Y") OR adjust per-language gold granularity | 1-2 days authoring | medium — loses comparability to v1 numbers |
| **C. Keep strict IoU, accept lower ceiling** | Proceed with rank-time fixes; explain in writeup that ~58% of FAILs are useful-but-graded-FAIL artifacts | 0 | high — Stage 4 fix work targets symptoms (chasing wider→narrower spans) instead of real ranker bugs (file-header top-1, wrong-chunk-wins) |

The handoff text explicitly anticipated this fork:

> If the answer is "yes, the benchmark is under-measuring the tool," that's a publishable observation in itself, and it may change which fixes you prioritize (e.g., span-broadening might already work; we just don't credit it).

**Strong recommendation: A + re-run the 6 drifted rows.** Reasons:
- Option A is cheap and reversible; preserves original benchmark
- A second benchmark calibrates which Stage 4 fixes are real (a win on both = real; a win only on IoU = symptom-fit)
- Without it, we risk Stage 4 fixes that "improve IoU" by narrowing returned spans (bad UX for agents) without actually helping the ranker

---

## What I'd do next (pending user OK)

1. **Re-run v1 sweep** with current preprocess output (cheap — child-per-language pattern already in track-a-runner-ss-semantic.mjs).
2. **Stage 0.5**: author behavioural-rewrite system prompt at `core/prompt-optimization/scripts/ss-semantic/probe-rewrite-system-prompt.md`; reuse `deepseek-client.mjs` (V4-Flash); validate via existing `validator.mjs` shape=V5 (without-symbol leak check) + new behavioural-verb regex; write to `eval/ast-tester-probes/gold-behavioral/<lang>.json` with `rewrittenFrom: <orig-id>`; 30-50 probes stratified 6-10 per family.
3. **Stage 2/3 deep-dive** on the corrected sweep, with both benchmarks side-by-side.

Stop here for user input. The genuine ranker bugs (file-header-top-1, wrong-chunk-wins-when-right-chunk-exists) will get worked, but I don't want to misclassify the 58% benchmark-shape signal as tool problems.

---

## Reproducibility

| Artifact | Path |
|---|---|
| audit script | `core/prompt-optimization/scripts/ss-semantic/stage0-audit.mjs` |
| summary JSON | `core/prompt-optimization/data/query-shapes/ss-semantic/failure-analysis/stage0-summary.json` |
| 24 dev FAILs with metadata | `core/prompt-optimization/data/query-shapes/ss-semantic/failure-analysis/stage0-failures.jsonl` |
| v1 sweep JSONL | `core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-a-phase6-redo-ss-semantic-v1.jsonl` |
| splits | `eval/ast-tester-probes/splits/manifest.json` (seed=42) |
| input drift cause | preprocess.mjs lines 219-246 ("Mode A fix 2026-05-13") |
