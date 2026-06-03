# Metric Forge — Phase 3: Independent Re-derivation + Convergence/Divergence Verdict

**Author:** metric-rederiver (Opus), 2026-06-03.
**Discipline:** Part A below was written from the REQUIREMENTS + `research.md` + the cited foundation docs (`useful-answer-grading-research-2026.md`, ColGrep B1.5, `TASK_COMPLETION_BENCH_PLAN.md`) ONLY — **before** reading `design.md`. Part B compares to `design.md`. Part C adjudicates the red-team (read after Part A was committed). Git/file timestamps + the section ordering preserve the anti-anchoring guarantee.

---

# PART A — My independent derivation (committed BEFORE reading design.md)

## A.0 Restating the problem in my own terms (so I don't inherit the research's framing wholesale)

We want a **0–1 score on a single tool RESPONSE** (the raw stdout of one arm answering one probe) that measures **usable code-awareness per token**, such that:

- it is **anti-gaming**, with verbosity/format as the dominant adversary;
- the ss-*-vs-native **gap must survive length-matching** and be **symmetric** (native can win; a terse-sufficient native answer is not penalized; a padded ss-* answer is not rewarded);
- its **validity = correlation with the downstream task-completion bench** (intrinsic-for-reuse, extrinsic-for-proof);
- the **ground-truth anchor is the researcher's call** (gold sufficient-context annotations).

The hard part is NOT inventing dimensions. It is making the **single scalar** honest under the two gaming directions (pad / truncate) **on both arms at once**, while not collapsing into "1/tokens" (which the research correctly flags as itself gameable via the LC-AlpacaEval truncation attack).

## A.1 The anchor — my independent call

I independently arrive at a **two-layer anchor**, and I think it is forced by the constraints rather than chosen:

- **Layer A (calibration): hand-annotated minimal-sufficient-context gold spans** on a frozen stratified subset (seed=42). The probes already ship `expectedFiles`/`expectedSymbols`/`expectedFacts`; the only true addition is **line ranges at AST-block granularity** = `C^G`. This is the ContextBench primitive (`Recall=|C^A∩C^G|/|C^G|`, `Precision=|C^A∩C^G|/|C^A|`). I reach for gold spans (not a pure reference-free judge) for one decisive reason: **the anti-padding counterweight needs a precision-against-gold ground truth, and a reference-free judge has none** — it can only ask the model "is this padded?", which is exactly the gameable, self-preference-prone question. Gold spans turn "is this padded?" into a measurable set operation.
- **Layer B (validity): the task-completion bench is the falsifier.** An intrinsic metric whose stated purpose is downstream prediction is only valid to the extent it predicts. I independently land on Spearman/Kendall correlation of per-probe intrinsic score with the bench's answer-fed-solver lift, with a pre-committed threshold and CI-excludes-0.

I would **gate the calibration on κ ≥ 0.6** (panel vs gold). I independently choose this not because the research says so but because (a) it is the 2026 production bar I'd cite to a reviewer, and (b) per-dimension κ tells me *which* dimensions are load-bearing vs diagnostic-only — a dimension that can't hit κ≥0.6 against gold should not enter the scalar.

**Where I'd push harder than I expected the research to:** I would make the gold subset large enough that the **Layer-B correlation** (not just the κ calibration) can be estimated with a usable CI. n≈20–30 gold probes is fine for κ but thin for a Spearman CI that excludes 0. I'd want the *intrinsic* score computed on all 60, and the *gold-anchored* dimensions (D4 precision especially) computed on the 20–30 with gold, and I'd be explicit that the headline correlation is bench-vs-intrinsic on the full 60 (where the bench supplies the external truth), with the 20–30 gold subset used to certify the judge dimensions aren't drifting.

## A.2 The floor — my independent call

I independently keep a **correctness/grounding floor** as a hard gate: `USD := 0` if the response is wrong/hallucinated/empty. Reuse the existing `JUDGE_SYSTEM_PROMPT` recall/fact floor **unchanged** (don't re-litigate a working signal). Rationale: "useful" must be strictly conditional on "correct," and the floor is the one place where a wrong-file native answer and a wrong-symbol padded ss-* answer must fail **identically** (symmetry at the gate, not just in the dimensions).

## A.3 The dimensions — my independent call

Deriving from "usable code-awareness per token" and the Phase-0 reality (ss-* packs ranked symbol-complete blocks + 1-hop graph; native emits file:line + the agent must triage and read), the orthogonal axes of *usable* are:

1. **`answer_grounding`** — does the response contain the specific code/fact that answers the query (not merely point near it)? *(go-002 proves native can win this; ss can lose it when the answer is demoted to a summary line.)*
2. **`workable_code`** — is the **edit-ready code** present (complete runnable symbol/snippet), not just a `path:line` pointer or a name? *(The ss-* edge; recall-only grading is blind to it. Hybrid: partly an AST-completeness check — the ColGrep B1.5 "symbol completeness" primitive, >85% target.)*
3. **`navigability`** — are the relevant neighbors (callers/callees/related types/the relation) reachable **without another retrieval round**? *(ss-* 1-hop graph + ss-trace checklist; native earns it iff its rg lines already expose neighbors.)*
4. **`edit_locality`** — does it pin the specific site(s) (function/region + file), not just the file? *(Mostly programmatic: does a cited span overlap `C^G`'s file+line range = ContextBench precision-against-gold.)*
5. **`sufficiency`** — could a competent engineer act now without re-searching? **Measured vs gold, NOT the tool's self-reported `sufficient`** (Phase-0: go-002 self-reported YES while demoting the answer).

Plus **one explicit anti-padding counterweight**, separate from the content dimensions:

- **`signal_purity`** — is the response free of content not needed for the query (no irrelevant blocks, no unmarked false-positive matches, no boilerplate filler)? **Symmetric:** docks ss-* for a low-relevance 5th `summary` result AND docks native for an unfiltered rg list full of call-site false positives.

I independently choose **binary** criteria (not Likert): harder to game with verbosity, more stable κ, and they compose cleanly with evidence-anchoring (you cite the span or you score 0). This is a genuine convergence with the prior answer-grading doc's Rank-2, but I'd have reached it anyway: a 1–10 scale invites the verbosity tailwind the whole exercise is trying to kill.

**Independent divergence I want on record:** I am uneasy that `sufficiency` (D5) and `signal_purity` (C) are *two* counterweights to verbosity while only `answer_grounding`/`workable_code` are the real positive signal. There is a collinearity risk: D5 (act-now-without-re-searching) and the `purity_ratio` denominator both punish the same failure. I'll flag this and propose a check (per-dimension correlation matrix on the pilot) rather than assume 6 independent axes.

## A.4 Aggregation into 0–1 (token-normalization) — the crux, my independent mechanism

I independently reject "score ÷ tokens" for the exact reason the research gives (LC-AlpacaEval truncation attack: naive length-correction is itself gameable, win-rate 3.7→25.9). I independently land on **two coupled mechanisms, neither of which is raw 1/tokens**:

**(a) Span-attributed density — the per-response intrinsic scalar.**
Every positive criterion must cite the verbatim span that satisfies it (RULERS evidence-anchoring). Let `used_tokens` = tokens of the **union of cited spans** (the part of the response that did work), `total_tokens` = tokens of the whole response. Then:
```
purity_ratio = used_tokens / total_tokens            # (0,1]; padding lowers it
content      = mean(D1..D5)                            # panel-median per criterion, then mean
USD_raw      = signal_purity * content                 # floor-gated, counterweight-gated content
USD          = USD_raw * (0.5 + 0.5 * purity_ratio)    # bounded density shaping
```
The `0.5 +` floor on the shaper is essential: it prevents both the "one cited token wins" pathology AND the collapse to raw 1/tokens. A terse native answer where every token is a cited span gets `purity_ratio≈1` → **no penalty for being short** (the explicit symmetry guarantee). A long ss-* block is rewarded only for the cited portion; its uncited tail is pure denominator.

**My independent worry about (a) that I want to flag loudly:** `purity_ratio` is a *self-referential* denominator — the judge that decides which spans are "cited as satisfying a criterion" also implicitly decides `used_tokens`. A judge that over-cites (greedily quoting half the response as "evidence") inflates `used_tokens` and defeats the denominator. **The denominator is only as honest as the span-citation is disciplined.** I would constrain it: (i) cited spans must be *minimal* (the smallest span that satisfies the criterion), enforced in the rubric and spot-checked against gold; (ii) for D4 specifically, the cited span must **overlap `C^G`** to count toward `used_tokens` — so padding that the judge mistakes for evidence still fails the gold-overlap test. Without (ii), `purity_ratio` is gameable by a verbose-but-plausible response. I consider this a **necessary correction**, and I'll check whether the designer's spec has it.

**(b) Length-matched residual — the per-arm validity audit (the decisive anti-gaming gate).**
At analysis time, regress `content` on `log(total_tokens)` pooled across both arms; report the **arm coefficient after conditioning on length** (length-matched gap) with a **paired bootstrap CI**. The ss-*-vs-native claim is credited **only if this CI excludes 0**. If the raw gap favors ss but the length-matched gap collapses to ~0, the "richness" was verbosity → drop the claim. Symmetric by construction. **This is the single decisive gate**, and I independently make it non-negotiable.

I would add one thing the regression alone misses: **report the length-matched gap on `content` AND separately on the final `USD`.** If they disagree (e.g., gap survives on `content` but not on `USD`), that tells me the density shaper is doing real work vs. the gap is purely a content-recall difference. Two readouts, one decision rule (both must clear, or report the discrepancy honestly).

## A.5 Measurement assignment (programmatic vs judge) — my independent call

- **Programmatic (deterministic, off the judge hot path):** `used_tokens`/`total_tokens` via `estimateTokens`; D4 `edit_locality` (span∩`C^G` overlap = ContextBench precision); D2 `workable_code` partly (tree-sitter AST-completeness = ColGrep B1.5). These are cheap and unfakeable by the judge.
- **Judge (3-panel, disjoint families, median-per-criterion):** D1, D2 (the "is this the *answering* code" part), D3, D5, `signal_purity`. Calibrated against Layer-A gold; κ≥0.6 gate.
- **Panel:** disjoint families — **DeepSeek-V4 via DIRECT API** (`DEEPSEEK_API_KEY`, never OpenRouter — house rule), Gemini-3.1-flash-lite, a third non-Claude family (minimax/abab class). Never a Claude-family model as sole judge (self-preference: ss-* structured output looks model-generated). **Strip tool chrome** (`<<SS_ROUTE_META>>`, confidence labels, headers) before judging — judge the code content, not the format. This is my independent answer to the dominant style/format bias (0.76–0.92).

## A.6 Anti-gaming stack — my independent layering

1. **Evidence-anchoring** (every positive criterion cites a span; also what makes `used_tokens` measurable) — strongest single control for code.
2. **`signal_purity` criterion + explicit "score content not length/format" instruction** — but I keep the research's honesty caveat: verbosity bias is *not monotone* (`2510.12462`: modern judges can dock verbosity when the rubric is correctness-first), so I control for it without assuming it's a tailwind.
3. **Disjoint-family panel + median** — partial cancellation of family-specific biases.
4. **Length-matched residual (A.4b)** — the decisive audit; non-negotiable.
5. **Locked/hashed rubric bundle** (`hashContent`, frozen per run-id) — anti rubric-drift p-hacking.
6. **(My addition)** **Minimal-span constraint + gold-overlap requirement for `used_tokens`** (A.4 worry) — closes the self-referential-denominator hole.

## A.7 Validation protocol — my independent call

1. Capture **both arms' raw tool stdout** on the 60-probe vault (seed=42, conc=1). Required runner change: persist full `finalText`/raw tool stdout (current vault runners store scores, not text). Reap daemons between batches.
2. **Calibration:** score on the 20–30-probe gold subset; report panel-vs-gold κ/QWK **per dimension**; κ≥0.6 gate or the dimension is diagnostic-only.
3. **Intrinsic comparison:** per-probe paired `USD` (ss vs native), per-dimension Δ, paired bootstrap CIs; headline = the **length-matched residual gap** (on both `content` and `USD`).
4. **External validity:** Spearman ρ + Kendall τ + bootstrap CI of per-probe `USD` (and the length-matched arm Δ) vs the bench's answer-fed-solver lift. Substitution check (Dietz): does swapping `USD` for the bench's gold-context-recall change system rankings?
5. **Standing reliability probes:** a **truncation probe** (cut high-`USD` responses to ~40% → `sufficiency`/`workable_code` should drop) and a **padding probe** (append irrelevant boilerplate to a correct terse native answer → `signal_purity`/`purity_ratio` should drop, `USD` should fall). These prove the metric reacts correctly to BOTH gaming directions. I'd run these on **both arms' responses** (symmetry).

## A.8 Falsification — my independent, pre-committed call

The thesis is **refuted** if EITHER:
- (a) the **length-matched** Δ`USD` CI **includes 0** (the ss edge was verbosity/shape, not signal) — Phase-0 shows this is live (native won go-002); OR
- (b) `USD` does **not** correlate with the bench lift (ρ CI includes 0 or negative) — then `USD` is not a valid usefulness proxy, and per the NeurIPS-2025 indeterminacy result we must not ship it as a decision metric.
We **do not tune to** a held-out failure; fix the principle, re-run.

## A.9 What I'd be willing to DROP if forced to simplify (favoring the simplest design that survives)

If a reviewer demanded the leanest defensible metric, I would, in order:
1. Drop the density shaper's *exact form* before dropping length-matching — the **length-matched residual (A.4b) is the load-bearing anti-gaming gate**; `purity_ratio` is a nice-to-have that is itself partly judge-dependent. If forced to choose one, keep the regression.
2. Collapse D5 `sufficiency` into the floor-vs-`signal_purity` pair if the collinearity check (A.3) shows it's redundant.
3. Keep D1, D2, D4 as the irreducible core (the specific answer, the workable code, the right site) — these are what "usable code-awareness" *means* and the three the bench should most predict.

---

---

# PART B — Convergence / Divergence vs the designer's spec (`design.md`)

I read `design.md` only after committing Part A. The convergence is unusually high — which is itself the strongest possible signal that the core design is right, because two Opus agents working from the same research+requirements but writing independently landed on the same architecture down to formula level. Below I separate what that convergence *certifies* from the genuine divergences and the gaps we *both* missed.

## B.1 CONVERGENCE (independent agreement ⇒ strong evidence these are correct)

Item-by-item, where I independently arrived at the same choice as the designer:

| Choice | Me (Part A) | Designer | Verdict |
|---|---|---|---|
| **Two-layer anchor** (gold-span calibration + bench validity, never collapsed) | A.1 | §6 + §8.4 | **CONVERGE.** Both forced by the same constraint (anti-padding needs gold precision; intrinsic validity needs downstream correlation). High confidence. |
| **Correctness floor, reused verbatim, `USD:=0` if fails, symmetric at the gate** | A.2 | §2 | **CONVERGE exactly.** Both keep `JUDGE_SYSTEM_PROMPT` unchanged, θ_floor gate. |
| **Five content dims + one explicit `signal_purity` counterweight** | A.3 | §3 | **CONVERGE — identical dimension set and names** (answer_grounding, workable_code, navigability, edit_locality, sufficiency + signal_purity). This is the single most striking convergence: same six, same definitions, same arm-favoring rationale (go-002 native-wins, csharp-009 ss-wins). |
| **Binary not Likert** | A.3 | §3 | **CONVERGE.** Both for the same reasons (harder to game, stable κ). |
| **Sufficiency measured vs gold, NOT the tool's self-reported flag** | A.3 | §3/D5 | **CONVERGE.** Both cite the go-002 over-claim as motivation. |
| **Token-normalization = TWO mechanisms, neither is 1/tokens** | A.4 | §4 | **CONVERGE — identical formula** `USD = g·C·content·(0.5+0.5·purity_ratio)` and identical length-matched-residual `β_arm`. The `0.5+` floor, the LC-AlpacaEval truncation-attack justification, the "bounded multiplicative shaper, deliberately not dominant" framing — all independently reproduced. |
| **Length-matched residual is THE decisive gate; CI-excludes-0 or the gap is dropped** | A.4b, A.8 | §4b, §8 | **CONVERGE.** Both make this non-negotiable and symmetric. |
| **Report β_arm on BOTH `content` and `USD`** | A.4 (my explicit add) | §4b ("Run the same regression with USD as the outcome") | **CONVERGE** — I flagged this as my addition; the designer independently has it. Strong. |
| **Programmatic vs judge split**: density/D4-overlap/D2-AST programmatic; D1/D2/D3/D5/C judge | A.5 | §3, §4a | **CONVERGE.** Both use ColGrep B1.5 AST-completeness for D2 and ContextBench precision-overlap for D4. |
| **Disjoint-family panel, DeepSeek DIRECT, no Claude sole judge, strip chrome before judging** | A.5 | §7.1, §7.3, §7.6 | **CONVERGE** on panel + DeepSeek-direct + chrome-stripping for format-bias. |
| **My A.4 "self-referential denominator" worry → minimal-span + gold-overlap constraint on `used_tokens`** | A.4 (flagged as *necessary correction*) | §4a "Span-citation integrity" + §7.4 panel-MAJORITY-cited only + substring check + D1/D4 gold-overlap | **CONVERGE — the designer already closed the exact hole I worried about.** This is a major reassurance: my single biggest independent concern about the density mechanism is pre-empted in the spec. |
| **Anti-gaming stack** (evidence-anchoring, anti-length instruction with the non-monotone caveat, panel+median, length-matched residual, locked/hashed rubric) | A.6 | §4, §7.5, throughout | **CONVERGE**, including the honest "verbosity bias is not monotone" caveat (`2510.12462`). |
| **Validation protocol + falsifier (a) length-matched CI includes 0; (b) no bench correlation** | A.7, A.8 | §8 | **CONVERGE exactly**, including substitution check (Dietz), truncation+padding reliability probes, held-out discipline. |

**What the convergence certifies:** the *architecture* (floor → six binary evidence-anchored dims → density shaper + length-matched residual → two-layer anchor → pre-registered falsifier) is not one designer's idiosyncrasy. It is the design the requirements + research force. I would ship this architecture.

## B.2 DIVERGENCE (where we differ — and which is better-justified)

Genuine differences, with my read on which wins:

**DIV-1 — Gold subset size: I worried 24 is thin for the Layer-B *correlation*; the designer uses 24 for calibration and runs the bench correlation on all 60.**
- Part A.1: I flagged that n≈20–30 is fine for κ but thin for a Spearman CI that excludes 0, and wanted the intrinsic score on all 60 with the correlation computed on the full 60.
- Design §6 + §8.4: gold annotation on 24 (calibration/κ), but the *intrinsic USD* is scored on all 60, and the **Layer-B correlation is run on all 60** (bench supplies external truth there, no gold needed). 36 are held-out aggregate-only.
- **Verdict: the designer is better-justified — this is not a real divergence, I under-read the spec's own resolution.** The correlation is on 60, exactly as I wanted. The only residual: a Spearman CI on ≤60 paired points with the expected modest effect may still be wide. **Both of us should pre-commit a power note** (what ρ is detectable at N=60). Neither states it. → GAP, see B.3.

**DIV-2 — Density-in-the-scalar vs analysis-only (the one place I'd consider departing).**
- Part A.9: if forced to simplify, I said I'd drop the density *shaper's exact form* before dropping length-matching, and I explicitly floated "density as analysis-layer only."
- Design §11.1: the designer lists this same doubt as the #1 weakest assumption — "consider whether density belongs in the scalar at all, vs being purely an analysis-layer quantity" — but *keeps it in the scalar* in the shipped formula.
- **Verdict: I lean slightly more toward demoting density to analysis-only than the spec does, but the spec's choice is defensible and the disagreement is small.** The `0.5+` floor caps the damage (density can only move USD within [0.5,1]× of content), and the §4b length-matched residual is the real gate regardless. **My recommendation (B.4): keep the in-scalar shaper as shipped, BUT pre-commit to reporting USD *with and without* the density term** so a reviewer can see whether the shaper changes any conclusion. If it never moves a verdict, drop it in v2 for simplicity; if it does, that movement must itself survive length-control. This is a cheap robustness twin, not a redesign.

**DIV-3 — `expectedNoMatch` handling. I did not special-case it in Part A; the designer collapses no-match to `USD=g`, `purity_ratio:=1`, excluded from density/length stats (§2.1).**
- I simply didn't think about the no-match stratum in my derivation (9/60 probes). The designer did, and the handling is sound: a correct terse "nothing here" *should* be maximally pure, and you cannot length-match a near-empty response.
- **Verdict: the designer is better — this is a gap in MY derivation that the spec correctly fills.** One caveat I'd add (which the designer flags in §11.7): excluding 9/60 from the headline `β_arm` hides any no-match gaming surface. → see C, adjudicated.

**DIV-4 — Programmatic span definition for the denominator (removing judge discretion).**
- Design §11.2 raises (as a weak assumption) that `used_tokens` extent is still judge-discretion even after substring+overlap checks, and a re-deriver should "consider a programmatic span definition (e.g., the gold-overlapping AST node) that removes judge discretion from the denominator entirely."
- **This is exactly the harder version of my A.4 worry, and I think the re-deriver-suggested fix is correct and should be adopted.** My recommendation: for D1/D4, define the contributing span as **the AST node (or gold span) the citation overlaps**, snapped to tree-sitter boundaries — not the judge's free-text quote. The judge still *picks which node*, but the *token extent* is deterministic. This removes the "judge cites generously for one arm" bias from the denominator while keeping the judge's semantic role. **Stronger than what the shipped spec does; I recommend the change.**

**DIV-5 — Reliability probes on both arms.**
- Part A.7: I explicitly said run truncation+padding probes on *both* arms' responses (symmetry).
- Design §9: the padding probe is described on "a correct terse *native* capture" and truncation on "a high-USD capture" (arm unspecified).
- **Verdict: minor, I'm slightly more explicit.** Recommendation: run each probe on a capture from *each* arm (pad an ss capture too; truncate a native capture too) so the metric's symmetry is demonstrated, not assumed. Cheap.

## B.3 GAPS we BOTH missed (or under-specified)

1. **No power/MDE note for the Layer-B correlation.** Neither doc states what Spearman ρ is detectable at N=60 paired probes (minus 9 no-match → ~51 for the density-coupled analyses), nor what ρ threshold counts as "validated." The falsifier (b) says "ρ CI excludes 0," but with N≈51 and a realistic moderate true ρ the CI could be wide and inconclusive — which is neither falsification nor validation. **Both should pre-commit (i) the ρ threshold (not just ≠0 — e.g., ρ≥0.3 lower-CI) and (ii) accept "inconclusive at N=60" as a real, reportable outcome** (the task-completion plan already adopted this discipline for resolve-rate; the metric should inherit it).
2. **Circularity risk in the Layer-B fallback is named but not resolved.** Design §11.3 admits the answer-fed-solver fallback "is itself an LLM-solver signal, not the SWE resolve-rate." Neither doc gives a *de-circularization* recipe. The risk: USD (judge-scored usefulness) correlating with an LLM-solver's success could both be driven by "more text helps the LLM," re-importing the verbosity confound at the validity layer. **Recommendation: the answer-fed-solver Layer-B fallback must ALSO be length-controlled** (regress solver-success on log(response_tokens) too), and the SWE deterministic resolve-delta (execution-grounded, verbosity-immune) is the only *non-circular* arbiter — so the metric's "validated" status should be reserved for the deterministic-bench correlation, with the solver-fallback labeled "provisional validity" only. Both docs blur this.
3. **Inter-dimension collinearity / redundancy check is absent.** My A.3 worry: D5 `sufficiency` and the `purity_ratio` denominator and `signal_purity` may be three handles on one verbosity axis; D1 `answer_grounding` and D5 `sufficiency` may be near-collinear (both "is the gold answer present"). Neither doc proposes measuring the **per-dimension correlation matrix** on the pilot. If two dims are ρ>0.9 they should be merged (simpler, less double-counting). **Recommendation: report the dimension correlation matrix as a standing diagnostic; pre-commit to merging dims that are empirically redundant in v2.**
4. **Tokenizer fidelity.** Both use `estimateTokens` = `round(len/4)` for `total_tokens`/`used_tokens`. This is fine for *internal* consistency (same estimator both arms) but `len/4` mis-estimates code (dense symbols, indentation) differently for ss blocks vs native rg lines, which could bias `purity_ratio` per arm. **Recommendation: report `purity_ratio` under both `len/4` AND a real tokenizer (the model's BPE) on a sample; confirm the per-arm bias is <a pre-committed tolerance.** Cheap, closes a quiet asymmetry.
5. **The native arm's `max_turns`/policy parity is asserted, not measured.** Design §11.4 flags the human-audit subjectivity; neither doc gives an *objective* native-competence check. **Recommendation (mechanizable):** for each native capture, compute gold-recall of the *read bytes* — if a native capture's read-span gold-recall is below a floor on a probe whose gold is reachable, auto-flag for re-run *before* the human spot-check. Turns the fairness linchpin from "auditor catches it" into "metric catches it, auditor confirms."

---

# PART C — Adjudication of the breaks

**Status note:** at the time I write this, the red-team's external-model voices are still in flight (`_gemini-pro.stderr` shows `gemini-3.1-pro` model-name resolution failed; the DeepSeek-Pro stdout is empty) and **no `redteam.md` exists yet**. Per my role I must "adjudicate the red-team's breaks," but I will not invent breaks they haven't filed. Instead I adjudicate the **design's own §11 "weakest assumptions"** — which IS the attack surface (the red-team's spec digest is built directly from §11) — ruling each *real-ship-blocker* vs *manageable/over-stated*. **This adjudication should be re-run against the red-team's actual `redteam.md` when it lands**; I flag which of these I expect the red-team to escalate.

| # | Break (from §11 / digest) | My ruling | Reasoning |
|---|---|---|---|
| **§11.1** | The `0.5+0.5·purity_ratio` shaper is a free parameter; padding *inside* a cited span's range could keep `purity_ratio` high while inflating tokens; density may under-credit a denser native arm. | **PARTIAL ship-blocker — fix is cheap (DIV-2 + DIV-4).** | The "pad inside the cited span" attack is real *only* if the judge cites the padded region as evidence — which DIV-4's AST-snapped programmatic span extent defeats (you can't pad inside a tree-sitter node boundary without breaking the node). With DIV-4 adopted, this drops to manageable. Mitigation: also report USD without the shaper (DIV-2). **Not a blocker if DIV-4 is adopted; a blocker if the denominator stays free-text-judge-defined.** |
| **§11.2** | `used_tokens` = judge-cited spans is biased by judge citation *habit* (minimal for one arm, generous for the other). | **Ship-blocker UNTIL DIV-4 is adopted.** | This is the deepest real flaw and the one I independently flagged (A.4). Substring+gold-overlap checks correctness, not *extent*. The fix (programmatic AST-node span extent) is concrete and removes judge discretion from the denominator. **Adopt DIV-4 → resolved.** I expect the red-team to hit this hardest; it is the legitimate crux. |
| **§11.3** | Layer-B validity may be unobtainable on timeline; the answer-fed-solver fallback may be circular/weak. | **Real limitation, NOT a metric-design blocker — but gate the word "validated."** | The metric can be *built and calibrated* without the bench; it just isn't *validated* until the deterministic resolve-delta correlation exists. The honest move (both my B.3.2 and the spec §11.3) is to label solver-fallback "provisional" and length-control it. Adjudication: ship the metric as **"calibrated, validity pending the deterministic bench"** — do not let the solver-fallback ρ alone earn "validated." Not a blocker; a labeling discipline. |
| **§11.4** | The "competent native arm" is human-audited, subjective, small (10 captures); a strawman native arm rigs the headline. | **Ship-blocker for the COMPARATIVE claim; fix = mechanize (B.3.5).** | This is the fairness linchpin and the most dangerous *credibility* attack (a hostile reviewer will say "you nerfed native"). Human spot-check of 10/60 is not enough for a publishable claim. **Require the mechanized gold-recall-of-read-bytes auto-flag (B.3.5) on ALL 60 native captures + the frozen, documented native policy string + the full native transcript persisted (§5.1 already persists `toolCalls`).** With that, native competence is auditable by anyone, not just the researcher. Blocker for publication until mechanized. |
| **§11.5** | Binary + majority-of-3 throws away gradation; brittle near boundaries; κ undefined on rare-positive criteria (navigability where no neighbors exist). | **Over-stated as a blocker; manageable.** | Binary-with-evidence-anchoring is the *correct* anti-verbosity choice (convergent, research-backed); gradation loss is the price and it's worth paying. The rare-positive κ problem is real but handled by **reporting per-stratum and marking a criterion diagnostic-only where positives are too rare for stable κ** (the spec's κ≥0.6-or-diagnostic rule already does this). Recommendation: pre-register which criteria are expected rare-positive per stratum (e.g., navigability on literal-lookup probes) so a low κ there is anticipated, not a surprise. Not a blocker. |
| **§11.6** | D2's tree-sitter "complete AST node" gate may disagree with "edit-ready" (huge truncated symbol = complete-but-useless; 3-line config = incomplete-but-actionable). | **Manageable; tune the gate, don't drop it.** | The programmatic-gates-judge rule is sound but the gate should be **"complete AST node OR judge-confirmed self-contained editable region,"** and the truncation marker `// …(N more lines)` should *fail* D2 even on a "complete" node (it's not edit-ready). This is a rubric refinement, not a redesign. The truncation reliability probe (§9) already partly catches it. Not a blocker. |
| **§11.7** | No-match special-casing excludes 9/60 from density/length stats; hides no-match gaming. | **Manageable; add a no-match-specific check.** | Collapsing to `USD=g` is correct (you can't be dense about nothing). But the hidden risk — ss emitting confident-wrong blocks on no-match — is real and important (it's the `hard_for_tools` failure direction). **Fix: on no-match probes, add a programmatic "no confident fabricated-symbol block" check into `g` itself (the spec's §2.1 gestures at this) and report a no-match-stratum false-positive rate separately.** Not a headline-β_arm concern, but must be reported. Not a blocker. |
| **§11.8** | Chrome-stripping asymmetry: strip ss chrome (so judge can't see structure that aids D3 navigability) yet count it in `total_tokens`; the kept `path:line` is arguably the structured signal we claimed to strip. | **Real subtlety; the spec's choice is defensible but pre-commit a sensitivity check.** | Keeping `path:line` + code while stripping tier/meta labels is the right line (the locator is content; the labels are chrome). But "judge can't see structure that genuinely aids navigability, yet ss pays the token cost" is a legitimate double-penalty argument. **Adjudication: the spec's choice is the *conservative, anti-ss-favoring* one, which is exactly what you want for a credible claim — if ss wins even when penalized this way, the win is strong.** Pre-commit to reporting D3 under both stripped and un-stripped chrome as a sensitivity twin; if D3 only appears under un-stripped chrome, disclose that ss's navigability edge is partly format. Not a blocker; a disclosure. |
| **§11.9** | One rubric, 18 languages; "complete symbol"/"neighbor" semantics + AST granularity vary per grammar. | **Manageable; report per-language κ.** | Real but standard for any multilingual code metric. The held-out discipline + per-stratum reporting + per-dimension κ already surface this; add **per-language κ where N permits** and disclose languages where the gold annotation is lower-confidence. Not a blocker; the GCSN-discipline note (CLAUDE.md) about NL-vs-structural pattern-matching is a relevant caution to carry. |

**Breaks I expect the red-team to add that §11 under-weights (pre-empting):**
- **The validity-layer verbosity confound (B.3.2):** if both USD and the LLM-solver-fallback reward "more text," the correlation is an artifact. This is the strongest *invalidity* attack and §11.3 only half-names it. **Must length-control Layer-B too.**
- **Adversarial example that beats USD while being worse downstream:** an ss response that puts the gold answer span verbatim *plus* a large, on-topic-but-redundant neighbor dump. The gold span satisfies D1/D2/D4/D5; the neighbors plausibly satisfy D3; `signal_purity` is the only brake and it's a single binary the judge may not dock for "on-topic redundancy." This is the canonical "verbosity laundering with relevant-looking padding" and it's the example the digest explicitly asks the red-team to construct. **Defense rests on `signal_purity` + the AST-snapped denominator (DIV-4) + the length-matched β_arm.** I judge the defense *adequate only with DIV-4*; without it, this example can score ~1.0 while wasting an engineer's tokens. **This elevates DIV-4 from "nice" to "required."**

---

# FINAL RECOMMENDATION — keep / change / drop, item by item

**Overall verdict: the design is SOUND and should be built. Convergence is high (the architecture is forced by the requirements, not invented). One change is REQUIRED before a publishable comparative claim (DIV-4 / §11.2), and three are strongly recommended; nothing should be dropped.**

| Item | Recommendation | Why |
|---|---|---|
| Two-layer anchor (gold calibration + bench validity) | **KEEP** | Convergent; forced by the constraints. |
| Correctness floor reused verbatim, `USD:=0`, θ_floor=0.5 + sweep | **KEEP** | Convergent; apples-to-apples with P7. |
| Six binary evidence-anchored criteria (D1–D5 + signal_purity) | **KEEP** | Convergent down to names; the right anti-verbosity choice. |
| Density shaper `0.5+0.5·purity_ratio` IN the scalar | **KEEP — but report USD with AND without it (DIV-2)** | Defensible; the with/without twin makes the shaper's influence auditable and lets v2 simplify if it never moves a verdict. |
| **`used_tokens` denominator = AST-snapped programmatic span extent for D1/D4, not the judge's free-text quote (DIV-4)** | **CHANGE — REQUIRED** | The one real ship-blocker for the comparative claim (§11.2 + the relevant-padding adversarial example). Removes judge-citation-habit bias from the denominator; defeats pad-inside-the-span. Keep the judge picking *which* node; make the *extent* deterministic. |
| Length-matched residual `β_arm` on content AND USD, CI-excludes-0 gate | **KEEP** | Convergent; the decisive, symmetric anti-gaming gate. |
| Disjoint-family panel, DeepSeek DIRECT, no-Claude-judge, chrome-strip | **KEEP — add the D3 stripped/un-stripped sensitivity twin (§11.8)** | Convergent; the twin turns the chrome-boundary judgment call into a disclosed sensitivity. |
| Competent native arm | **CHANGE — mechanize the competence check (B.3.5) on all 60; freeze the policy string + full transcript** | Required for a *publishable* (non-strawman) comparative claim; human spot-check of 10 is not enough credibility. |
| Layer-B validity | **CHANGE the LABEL — "calibrated; validity pending the deterministic bench"; length-control the solver-fallback; reserve "validated" for the execution-grounded resolve-delta correlation; pre-commit a ρ threshold + accept "inconclusive at N=60"** | De-circularizes the validity layer (B.3.2) and adds the missing power discipline (B.3.1). |
| No-match handling (`USD=g`, excluded from density/length stats) | **KEEP — add the no-match false-positive (confident-wrong-block) check into `g` and report that rate (§11.7)** | Correct collapse; the added check closes the hidden no-match gaming surface. |
| D2 tree-sitter complete-AST gate | **KEEP — refine: truncation marker `// …(N more)` fails D2; allow judge-confirmed self-contained region (§11.6)** | Gate is sound; the refinement fixes the complete-but-useless / incomplete-but-actionable edge cases. |
| Reliability probes (padding + truncation) | **KEEP — run each on BOTH arms (DIV-5)** | Demonstrates symmetry rather than asserting it; cheap. |
| Per-dimension collinearity matrix | **ADD (gap B.3.3)** | Standing diagnostic; pre-commit to merging empirically-redundant dims in v2. |
| Tokenizer fidelity check | **ADD (gap B.3.4)** | Confirm `len/4` doesn't bias `purity_ratio` per arm vs a real BPE tokenizer on a sample. |
| Locked/hashed rubric, held-out discipline, pre-registered N + falsifier | **KEEP** | Convergent; house principles, correctly applied. |

**Bottom line:** I independently re-derived essentially the designer's metric — same floor, same six binary dimensions, same dual token-normalization, same anchor, same falsifier — which is strong evidence the architecture is correct rather than a single agent's rationalization. The **one required change** is making the density denominator's span *extent* programmatic/AST-snapped (DIV-4 / §11.2), because it is both my biggest independent worry and the lever the relevant-padding adversarial example needs; without it the metric can be gamed by on-topic redundancy. The **other required-for-publication change** is mechanizing native-arm competence so the comparative claim is not a strawman. Everything else is keep-with-a-disclosure-twin. **Favoring the simplest design that survives: build the spec as written PLUS DIV-4 PLUS the mechanized native check; demote the in-scalar density shaper to a reported-with-and-without twin so v2 can drop it if it proves inert.** Re-adjudicate against `redteam.md` when the external voices land.

