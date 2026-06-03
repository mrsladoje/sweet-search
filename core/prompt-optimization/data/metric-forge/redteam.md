# Metric Forge — Phase 3 (RED-TEAM): adversarial tear-down of the `USD` tool-response usefulness metric

**Author:** metric-redteam (Opus), 2026-06-03.
**Input:** `design.md` (the `USD` spec), `research.md`, the harness, the 60-probe vault.
**External adversaries consulted (disjoint families, RAW critiques in §6):** DeepSeek-V4-Pro (direct API, `DEEPSEEK_API_KEY`, never OpenRouter — reasoning model, 32k budget) and Gemini-3.1-pro-preview (direct REST, gemini-api-key auth).
**Posture:** hostile. Goal = a metric that survives a motivated competitor + a NeurIPS area chair. Verbosity/padding gaming and arm symmetry were attacked first, per the workflow mandate.

> **Verdict in one line:** the design is well-constructed and many guards work — but the central anti-verbosity mechanism (the density shaper) is **neutralized by a single judge habit** (whole-block citation), the **no-match stratum is trivially gameable for USD=1**, the **chrome-stripping accounting breaks arm symmetry**, and the **length-matched regression extrapolates across non-overlapping token supports**. These four are **SHIP-BLOCKING**. All three reviewers (me, DeepSeek, Gemini) converged on the citation-extent break independently; DeepSeek independently elevated the no-match loophole; Gemini independently produced the regression-extrapolation break.

---

## 0. How to read this

Each break: **severity** (SHIP-BLOCKING = must fix before the powered run; ACCEPT-WITH-MITIGATION = disclose + monitor), a **concrete adversarial example** (a real `R` sketch or scenario that scores high while being worse, or low while being better), the **mechanism** (which formula term it exploits), and a **fix**. Breaks are ordered by severity × likelihood. The §6 raw external critiques are verbatim; §7 maps agreement/divergence.

I verified the load-bearing arithmetic numerically (density shaper bounds, citation-union behavior, chrome accounting) rather than asserting it — see the inline `[verified]` tags.

---

## 1. SHIP-BLOCKING breaks (must fix before the powered run)

### B1. Citation Sprawl — the density shaper is neutralized by whole-block judge citation
**Severity: SHIP-BLOCKING. The single most dangerous flaw. All three reviewers converged here independently.**

**The claim it breaks:** "padding inflates `total_tokens` but not `used_tokens` ⇒ `purity_ratio` falls ⇒ `USD` falls" (§4a). This is the *entire* in-scalar anti-verbosity defense.

**Concrete adversarial example.** Probe `go-002`: "Which function picks the request binding implementation…". 
- **Native arm** returns the tight answer: `binding/binding.go:95` + the 12-line `Default` switch body. `total_tokens≈60`, judge cites the 12 lines, `used_tokens≈55`, `purity_ratio≈0.92`.
- **ss arm (adversarial)** returns the **entire `binding.go` file (1 cohesive 1200-line block)** under one `[full]` result, answer buried inside. When the judge scores D2 (`workable_code` — "complete symbol body present") it quotes a span; for a function *textually nested* in a monolithic block, judges routinely quote the **enclosing block** (the whole file) because that is the smallest self-evidently "complete" unit they perceive. Same for D5 (`sufficiency`) and D3 (`navigability` — every neighbor is in the file). `used_spans = union(D2,D3,D5 spans) = whole file`. `used_tokens = total_tokens ⇒ purity_ratio = 1.0`.

**[verified numerically]** with the spec formula: ss scores `USD = g·C·content·(0.5+0.5·1.0) = USD_raw·1.0`; native scores `≈USD_raw·0.96`. The 1200-line dump gets the *full* density multiplier and additionally wins D3 (native rg can't surface neighbors in one shot — see B5). **The metric ranks the context-window-destroying dump above the 12-line answer** — the exact inversion the metric exists to prevent.

**Why the spec's own guard does NOT stop it [verified].** §4a constrains span *extent* only on **D1 and D4** (must overlap `C^G`). D2/D3/D5 spans are substring-checked only — **no extent cap**. `used_spans` is the UNION over D1–D5, so one generous D2 or D5 citation pulls the whole file into `used_tokens`. The gold-overlap guard is real but covers the wrong dimensions.

**Why C (signal_purity) doesn't save it.** C is the backstop, but (i) it is a single binary judge call, and (ii) it is *correlated* with the very citations that caused the sprawl: a judge that just quoted the whole file as "sufficient" (D5=1) is cognitively primed to not then call the same block "padded" (C=1). The two defenses are not independent, so C cannot be assumed to fire when sprawl happens.

**Mechanism:** `used_tokens = estimateTokens(concat(union of judge-cited spans))` with no minimality constraint on D2/D3/D5 spans.

**Fix (required).** Remove judge discretion from the density *numerator*:
1. **Programmatic minimal span.** Define `used_tokens` from the **gold/AST-derived minimal span**, not judge citations: for each satisfied criterion, clip the cited span to the intersection with (a) the `C^G` gold range where it exists, else (b) the tree-sitter AST node that contains the matched `expectedSymbol`. The union of these *clipped* spans is `used_tokens`. Judges still cite (for auditability and the v=1 decision) but cannot inflate the denominator-of-purity.
2. If keeping judge citations, **enforce span minimality in the rubric AND machine-check it**: reject any cited span whose length > (k × the gold/AST minimal span); demote that criterion's contribution to `used_tokens` to the clipped length. Without a machine-enforced minimality cap, the rubric instruction "quote the smallest span" is unverified and judges ignore it.
3. **Strengthen the shaper exponent** (see B6): `(used/total)^α` with α>1 so sprawl is punished super-linearly, *and* gate density on an absolute-length penalty for responses far above the gold-sufficient length.

---

### B2. No-match stratum awards USD=1 to arbitrary garbage that dodges a substring check
**Severity: SHIP-BLOCKING. DeepSeek's #1. Matches spec self-identified weakness #7, but worse than the spec admits.**

**The claim it breaks:** that no-match collapse to `USD=g` "only tests that the metric does not punish a terse-correct native 'no match'" (§2.1). In fact it *rewards* a verbose-wrong ss response identically to a correct empty one.

**Concrete adversarial example.** No-match probe (e.g. a fabricated `parse_config` symbol). The ss arm, unable to find it, dumps **15,000 tokens** of the entire `database/` dir + README + docker-compose "just in case," never emitting the fabricated symbol string. The inverted programmatic floor passes (`R` does not contain the expected symbol), the panel sees `EXPECTED: no match` and — facing a giant pile of real-but-irrelevant code with no false claim — may well agree there's "no confident match." Then **`content := g = 1`, `purity_ratio := 1` ⇒ USD = 1.0**, with density *skipped*. A 15k-token context-bomb scores a perfect victory; the 9/60 no-match probes (15% of the set) are exempt from every anti-verbosity tooth.

**Mechanism:** §2.1 hard-codes `content := g` and `purity_ratio := 1` for no-match, bypassing D1–D5, C, and the shaper entirely.

**Fix (required).** No-match correctness ≠ no-match usefulness. A correct no-match response should be **near-empty or a canonical "no match" statement**. Score no-match probes as: `USD = g · max(0, 1 − total_tokens / τ)` (τ = a small budget, e.g. 300–500 tokens) so a terse-correct native "nothing here" keeps USD≈g and a 15k dump collapses to 0. Keep them in the density statistics (you *can* length-control a "no match" response — the ideal length is small and constant, which is exactly the comparison you want). This also closes the "ss behaves differently on no-match invisibly" gap the spec flagged.

---

### B3. Chrome-stripping token accounting breaks arm symmetry (penalizes ss; can zero native)
**Severity: SHIP-BLOCKING. DeepSeek #3 + Gemini #4 both hit this from opposite directions — which is precisely why it's a symmetry break: it can be argued to hurt *either* arm depending on the probe, i.e. it is not neutral.** Matches spec weakness #8.

**The break has two faces:**

**(a) ss is double-penalized [verified].** `total_tokens` uses UN-stripped bytes; the judge sees STRIPPED bytes. So ss's chrome (`<<SS_ROUTE_META>>`, tier labels, the 1-hop-graph meta) inflates the denominator but can *never* enter `used_tokens` (the judge can't cite what it can't see). Identical code, ss vs native: ss `purity_ratio = 16/20 = 0.8 ⇒ USD=0.9`, native `= 16/16 = 1.0 ⇒ USD=1.0` (DeepSeek's worked example, numbers reproduced). The metric declares native denser on byte-identical content. Worse: if ss's *navigability* signal lives in the stripped meta line, ss pays the tokens for D3 **and** loses the D3 credit those tokens buy.

**(b) native can be zeroed by un-stripped noise.** Native stdout is stripped of *nothing* (§7.6). A real `rg` run routinely captures one stray `test_config.py:…` line or a binary-file match alongside the right hit. The judge sees that unmarked false positive and, per the C rubric ("dock to 0 if … unmarked false-positive matches"), sets **C=0 ⇒ USD=0** — total wipeout — while the ss arm had its analogous noise (low-relevance 5th result) presented as a labeled `[summary]` tier that gets *stripped* before judging, so the judge never sees ss's noise. The stripping policy launders ss's noise and exposes native's.

**Mechanism:** asymmetric pre-processing (`stripChrome(R, 'ss')` is lossy; `stripChrome(R,'native')` is identity) feeding (i) a denominator computed on un-stripped bytes and (ii) a binary purity multiplier.

**Fix (required).** Make pre-processing symmetric and consistent:
- Compute `total_tokens` on the **same bytes the judge sees** (stripped for both). If chrome is "a real token cost the agent pays," then it must also be *visible and citable* — you cannot have it both ways (count it but hide it). Pick one: either strip-and-don't-count, or keep-and-count-and-show.
- Apply an **identical, documented artifact filter to native stdout** (drop binary-match lines, dedup, drop `Binary file … matches`) so native's incidental noise is treated like ss's labeled-and-stripped noise. Symmetry means *both* arms get the same noise-handling, or *neither* does.
- Treat the 1-hop graph decision explicitly: if it's signal for D3, it must be visible to the judge (don't strip it) and counted; if it's chrome, strip it and don't count it. The current split (strip but count) is the worst of both.

---

### B4. Length-matched regression extrapolates across non-overlapping token supports
**Severity: SHIP-BLOCKING (statistics). Gemini's #3 — a genuinely new break not in the spec's weakness list and not in my first pass. This invalidates the HEADLINE number.**

**The claim it breaks:** that `β_arm` from `content_i = β0 + β_arm·1[ss] + β_len·log(total_tokens) + ε` is a *length-matched* gap (§4b), "the single decisive anti-gaming gate."

**Concrete scenario.** Native averages ~200 tokens; ss averages ~2000. Their `log(total_tokens)` supports barely overlap. OLS with a single global `β_len` slope **extrapolates** the within-ss slope into native's token range (and vice versa). If, inside the ss arm, shorter responses happen to score slightly higher (plausible — less dilution), `β_len` is estimated negative and the model *imputes* that ss "would have scored 1.4 at 200 tokens" — out-of-sample fantasy. `β_arm` (the gap at a matched length neither arm actually occupies) becomes spuriously large and "significant." You publish a length-matched victory built entirely on extrapolation. The bootstrap CI will happily exclude 0 because the extrapolation is stable across resamples — **the CI-excludes-0 gate does not catch this**; it's a model-misspecification error, not a noise error.

**Mechanism:** a single linear `β_len` term assumed valid over a region where the two arms have near-disjoint support; OLS imputes counterfactuals in the gap.

**Fix (required).**
1. **Common-support diagnostic first, gate the claim on it.** Plot/quantify the overlap of `log(total_tokens)` between arms (e.g. the proportion of ss responses with ≥1 native response within a caliper). If overlap is poor, the regression is inadmissible.
2. **Propensity-score / caliper matching** instead of (or alongside) OLS: pair each ss response to native response(s) within a strict `log(total_tokens)` caliper; ss responses with no in-caliper native partner are **dropped from the gap analysis** (and reported as "off-support, not length-matchable"). Report the matched paired Δ.
3. The spec's "adaptive length-bin tercile" twin partly addresses this **only if** terciles are computed on the *pooled* distribution and within-bin both arms are present; report per-bin N per arm so empty cells are visible. Trust the matched estimate, not the regression, when supports are thin.

---

## 2. ACCEPT-WITH-MITIGATION (disclose + monitor; not run-blocking, but reviewers will ask)

### B5. D3 (navigability) is a structurally arm-favoring criterion, independent of verbosity
**Severity: HIGH, accept-with-stated-mitigation — but it is the most important *validity* caveat.**

**Mechanism, not gaming.** D3 credits "relevant neighbors reachable without another retrieval round." ss-* emits a 1-hop graph / ss-trace checklist *by construction*; a native `rg`+`read` episode almost never surfaces callers/callees in one response unless the agent happened to grep for them. So `content` (which includes D3) is **systematically higher for ss for reasons that are real but not "per-token density"** — they're a *capability* difference, not a verbosity artifact. The length-matched gate (B4, once fixed) will *not* remove this, because D3's advantage is uncorrelated with length. This is arguably the *true* ss edge — but the design frames the whole thesis as "denser per token," and D3 is "has a feature native lacks." A hostile reviewer will say: "you proved ss has a call graph, which we knew; you did not prove per-token density."

**Mitigation (disclose, don't hide).** Report `content` **with and without D3** (and per-criterion Δ, which the design already does — good). State explicitly that D3 measures a *capability* the native arm cannot match single-shot, and that the per-token-density claim rests on D1/D2/D4/D5+C, while D3 is reported as a separate "single-shot navigability" advantage. This is the honest framing and it is still a strong result — just not the one the one-liner currently claims. Tie D3's legitimacy to Layer-B: if D3-bearing responses predict downstream lift, the neighbor context is genuinely useful, not padding.

### B6. The 0.5 floor caps the worst-case padding penalty at 50% — verbosity is "cheap"
**Severity: MEDIUM-HIGH, accept-with-mitigation. DeepSeek #6; I verified the bound.**

**[verified]** A response that is 99.9% padding but contains the answer and keeps C=1 scores `USD = USD_raw·(0.5+0.5·~0) = 0.5·USD_raw`. So a perfectly-padded-but-correct ss response with `content=1` scores **0.5**, beating a terse native response that legitimately scores `content=0.4` (e.g. missing D3). The shaper's lower bound (0.5) is *above* many honest content scores. The floor was added to dodge the LC-AlpacaEval truncation-attack collapse — a real concern — but it leaves verbosity under-punished whenever C survives (and B1 shows C often survives sprawl).

**Mitigation.** Make the shaper a tunable, steeper penalty: `USD = USD_raw · (φ + (1−φ)·purity_ratio^α)` with a *smaller* floor φ (e.g. 0.25) and α>1, **selected on the 24-probe gold/dev set by requiring the padding reliability probe to drop USD by a pre-committed margin** (≥X pp), not by argument. Crucially this fix only bites *after* B1 is fixed — while `used_tokens` can be inflated by citation, no floor value matters because `purity_ratio` stays ≈1. **B1 is the prerequisite; B6 is the tuning.**

### B7. D2 tree-sitter "complete AST node" gate penalizes native for not being an AST tool
**Severity: MEDIUM, accept-with-mitigation. Gemini's #2 (it called it ship-blocking; I downgrade — see why).** Matches spec weakness #6.

**Example.** Native `rg -C 5 "def calculate_tax"` returns 11 of a 15-line function — highly actionable, but the trailing `return` is cut, so the tree-sitter "complete AST node" check fails ⇒ D2=0 regardless of judge. ss returns the byte-perfect symbol ⇒ D2=1. Native is penalized for a property (emitting exact AST boundaries) it structurally can't produce.

**Why MEDIUM not SHIP-BLOCKING:** D2 is one of six criteria, and the *competent* native arm (§5.2) is an *agent* that issues `read` with chosen ranges, not a fixed `-C 5` grep — a competent native read can capture the full symbol. The break is real but partly mitigated by the native arm being agentic. Still: the programmatic-gates-judge rule means a near-complete, actionable native span gets hard-zeroed.
**Mitigation.** Relax the D2 gate from "complete AST node" to "contains the symbol's signature + a non-trivial body fraction (≥70% of the AST node's lines, including the closing brace OR an explicit `// …(N more)` truncation marker)"; let the judge adjudicate completeness above that floor. Equivalently, the spec's own weakness-#6 note — don't hard-zero a 3-line config constant or a 90%-present function. And confirm in the native-arm audit (§5.2) that the native agent is *allowed and prompted* to read full symbol ranges.

### B8. Layer-B validity has a shared-family circularity AND may be unobtainable on timeline
**Severity: MEDIUM-HIGH, accept-with-mitigation. Spec weakness #3, sharpened.**

**New observation (circularity) [analysis].** The USD judge panel includes **deepseek-v4-flash**; the task-completion bench's answer-fed-solver pilot model is **deepseek-v4-pro** (`TASK_COMPLETION_BENCH_PLAN` §1). DeepSeek appears on *both* sides of the validity correlation. A positive ρ could partly reflect "DeepSeek-judge agrees with DeepSeek-solver" (shared inductive bias / shared blind spots) rather than "USD predicts real resolve-rate." The substitution check doesn't catch this if both instruments share the bias.
**Timeline (spec #3).** The real arbiter (SWE resolve-delta) is at pilot; the fallback answer-fed-solver is itself an LLM-solver signal, and if that solver is DeepSeek it's doubly entangled.

**Mitigation.** (1) Use a **solver from a family NOT on the USD panel** for the Layer-B answer-fed-solver (e.g. an OpenAI/Anthropic solver, or at minimum hold DeepSeek out of the USD panel for the validation run). (2) Report Layer-B against the deterministic F2P∧P2P resolve-delta as soon as the bench produces it; until then, label the metric **"calibrated, not validated"** exactly as the spec says, and do not publish a validity claim. (3) Pre-register that falsifier (b) is evaluated only against the execution-grounded signal, with the LLM-solver fallback reported as suggestive-only.

### B9. κ ≥ 0.6 gate is unstable/undefined on rare-positive criteria
**Severity: MEDIUM, accept-with-mitigation. Spec weakness #5.**

On probes with no neighbors, D3's positive class is near-empty; Cohen's κ is undefined or wildly variable when one class is rare (the base-rate problem). The same for D4 on probes where the gold span is the whole file. A criterion could be silently demoted to "diagnostic-only" (or kept) on a κ estimate driven by 2–3 instances.
**Mitigation.** Report κ **with its bootstrap CI and the positive-class count per criterion**; pre-commit a minimum positive-N (e.g. ≥8) below which κ is "insufficient data," not "failed." Stratify κ by criterion-applicability (only score D3 where the gold actually has neighbors), and report prevalence-adjusted κ (PABAK) alongside raw κ so a reviewer sees the base-rate effect.

### B10. Span-citation extent bias differs *by arm formatting* even under blinding
**Severity: MEDIUM, accept-with-mitigation. DeepSeek #5 — subtle and worth monitoring.**

Blinding hides the *label* but not the *format*: ss responses are visually block-structured (header + code + related), native is flat text. Judges may habitually cite whole blocks for ss and tight lines for native — a systematic `used_tokens` bias driven by format, not content, that blinding cannot remove. The determinism probe (§9) checks binary verdict flips, **not span extent**, so this is invisible to the current reliability suite.
**Mitigation.** Fixing B1 (programmatic `used_tokens`) eliminates this entirely. If judge citation is retained, **add a span-extent stability probe**: re-present the same content in both arms' formats and measure cited-span-length divergence; flag >X% as format-driven extent bias. Report the per-arm distribution of `used_token/total_token` so a systematic gap is auditable.

### B11. Single rubric across 18 languages; "complete symbol"/"neighbor" don't transfer uniformly
**Severity: LOW-MEDIUM, accept-with-mitigation. Spec weakness #9.**

tree-sitter AST granularity differs per grammar (a Rust `impl` block vs a C macro vs an Elixir `defmodule`); "complete symbol" and "neighbor" mean different things, and the gold annotation is one researcher's per-grammar call. D2/D4's programmatic gates will behave differently across languages, adding a language confound to the arm comparison if language correlates with arm difficulty.
**Mitigation.** Report `β_arm` **stratified by language** (the spec already strata-splits — extend to language for D2/D4); pre-commit that a language showing anomalous D2/D4 base rates is flagged, not silently pooled. Have a second annotator spot-check AST-granularity calls on ≥2 languages and report annotator agreement on the gold spans themselves.

---

## 3. Where the metric is ROBUST (attacks that FAIL — stated explicitly)

A hostile review should also confirm what holds, so the surviving claims are credible:

- **The grounding floor `g` (programmatic file/symbol match AND panel correctness ≥0.5) is excellent and both externals praised it.** It blocks the "eloquent but wrong" hallucination: a beautifully formatted ss block naming the wrong symbol fails the programmatic pre-check ⇒ USD=0, symmetric to a native rg that matched the wrong file. Attack: "pad with the right symbol name in a comment to pass the pre-check then dump garbage" — the pre-check is necessary-not-sufficient; the judge correctness median still has to clear 0.5, and the C-purity teeth (once B3-symmetric) still bite. The floor is sound.
- **D4's gold-overlap gate is the right pattern** (programmatic overlap with `C^G` can't be talked around by the judge). The fix for B1 is literally "apply D4's rigor to `used_tokens`" — the design already contains the correct mechanism; it just didn't extend it to the density numerator.
- **The two-mechanism split (in-scalar shaper + analysis-only `β_arm`) is the right architecture** and the falsification criteria are honestly pre-committed (the metric *can* refute its own thesis — Phase-0 shows native won go-002). Once B1 (programmatic `used_tokens`) and B4 (common-support matching) are fixed, this is a defensible design.
- **Arm-blinding + disjoint-family panel + per-criterion median + locked rubric hash** are all correct, standard, and protect against the biases they target. Self-preference/position bias attacks largely fail here.
- **Binary criteria + span-before-score** is the right anti-verbosity backbone (per RULERS); the failure is not the principle but that the span's *extent* was left to the judge (B1).

---

## 4. The single most dangerous flaw (consensus)

**B1 — Citation Sprawl (judge-cited `used_tokens` has no minimality constraint on D2/D3/D5).** All three reviewers reached this independently. It converts the metric from anti-verbosity to **verbosity-rewarding** whenever the answer sits in a cohesive block: the ss arm can dump the whole file, the judge cites the whole block, `purity_ratio→1`, and the dump *beats* the terse answer it should lose to. Every other fix is moot until the density numerator is taken out of the judge's hands and pinned to gold/AST-derived minimal spans. **No powered run should start before B1 is fixed and its fix is proven by the padding reliability probe dropping USD by the pre-committed margin.**

---

## 5. Prioritized fix list (run-gating order)

| # | Break | Severity | Prereq | Fix (one line) |
|---|---|---|---|---|
| B1 | Citation Sprawl | SHIP-BLOCK | — | `used_tokens` from gold/AST-clipped spans, not raw judge citations; machine-enforce span minimality |
| B2 | No-match USD=1 garbage | SHIP-BLOCK | — | Score no-match as `g·max(0,1−tok/τ)`; keep in density stats |
| B3 | Chrome-strip asymmetry | SHIP-BLOCK | — | Count tokens on the bytes judges see; apply identical artifact filter to native; decide graph=signal-or-chrome consistently |
| B4 | Regression extrapolation | SHIP-BLOCK | — | Common-support diagnostic + caliper/propensity matching; drop off-support ss rows; trust matched Δ over OLS |
| B5 | D3 arm-favoring | HIGH/disclose | — | Report `content` with/without D3; reframe one-liner; tie D3 to Layer-B |
| B6 | 0.5 floor too soft | MED-HIGH | B1 | Tunable `φ+(1−φ)·pr^α`, φ↓, α>1, tuned on the padding probe |
| B7 | D2 AST gate | MED | — | Relax to signature + ≥70% body or truncation marker; confirm native may read full ranges |
| B8 | Layer-B circularity/timeline | MED-HIGH | — | Solver from off-panel family; "calibrated≠validated" until F2P∧P2P exists |
| B9 | κ on rare positives | MED | — | Report κ CI + positive-N; min-N gate; PABAK + applicability stratification |
| B10 | Format-driven extent bias | MED | B1 | Subsumed by B1; else add span-extent stability probe |
| B11 | Cross-language rubric | LOW-MED | — | Stratify β_arm by language; second-annotator AST spot-check |

**Gate to proceed (my recommendation):** fix **B1–B4** (all SHIP-BLOCKING) and **disclose B5**, then re-run the padding + truncation reliability probes; only then capture both arms and run the powered comparison. B6/B7 should be folded into the same patch since they share code paths.

---

## 6. RAW external critiques (verbatim, unedited)

### 6.1 DeepSeek-V4-Pro (direct API, reasoning model, finish=stop, content 14.1k chars)
> *(Stored verbatim at `_deepseek-pro-critique.txt`. First retry hit the known `project_deepseek_max_tokens_reasoning` failure — 8192 tokens all consumed by `reasoning_content`, empty `content`; re-run at 32k budget with an explicit "produce a written answer" instruction succeeded.)*

DeepSeek's six breaks, in its own ordering:
1. **SHIP-BLOCKING — No-match probes award USD=1 to any garbage that sidesteps a trivial regex.** (Its #1 / "single most dangerous flaw.") Example: a Shakespeare sonnet or a 10k dump that avoids the blacklisted symbol string ⇒ `g=1, content:=g, purity:=1 ⇒ USD=1`. Fix: require empty/canonical NO_MATCH; or run the full pipeline and require C=1 ∧ content=0.
2. **SHIP-BLOCKING — Unrestricted judge-span length ⇒ massive-verbosity responses score purity_ratio=1.** Whole-file mega-block ⇒ judge cites it whole for D2/D3/D5 ⇒ `used=total`. Fix: span-minimality requirement (tightest substring), extend C^G overlap to all dims, or replace judge-citation union with programmatic minimal-token extraction.
3. **SERIOUS — Chrome-stripping asymmetry systematically penalizes ss-\*.** Unstripped `total_tokens` + stripped judge view ⇒ ss meta inflates denominator, never enters numerator ⇒ permanent native purity advantage on byte-identical content (worked the 0.9 vs 1.0 example). Fix: count tokens on stripped bytes, or keep+show chrome, or symmetric overhead budget.
4. **HIGH — signal_purity C unanchored on the 36 held-out probes** ⇒ borderline-relevant "neighbor" padding slides through where no C^G exists. Fix: annotate all 60, or an automated minimal-context surrogate before judging.
5. **HIGH — judge citation-extent bias weaponized by tool-specific formatting** (whole-block for ss, point-precise for native); the verdict-flip probe checks binary scores not span extent. Fix: programmatic minimal spans; remove judge subjectivity from the numerator.
6. **MEDIUM — the 0.5 floor makes verbosity cheap** (USD only halves at worst; pad *inside* the cited block to keep C=1 and the floor never bites). Fix: `(used/total)^α` continuous penalty.

### 6.2 Gemini-3.1-pro-preview (direct REST, finish=STOP, 6.8k chars)
> *(Stored verbatim at `_gemini-pro-critique.txt`.)*

Gemini's five breaks:
1. **SHIP-BLOCKING — "Citation Sprawl" exploit.** ss returns the entire 1000-line file; judges cite the whole file/outermost boundary for D2/D5 ⇒ `used=total ⇒ purity=1.0`, wins D3 too, beats the terse native answer "despite dumping 100x more tokens." "Fatal misunderstanding of LLM judge behavior." Fix: `used_tokens` = intersection with C^G + small allowance; cannot trust LLM citation.
2. **SHIP-BLOCKING — D2 AST-gate asymmetry.** Native `grep -C5` returns 11/15 lines (actionable, missing `return`) ⇒ fails tree-sitter gate ⇒ D2=0; ss=1. "Penalizing native for not being a tree-sitter tool." Fix: remove the gate or give native a tree-sitter formatter.
3. **SHIP-BLOCKING — collinear regression extrapolation artifact.** Disjoint token supports (native ~200, ss ~2000) ⇒ OLS extrapolates the slope into the gap ⇒ spuriously large `b_arm`. "Statistically illiterate if the distributions don't overlap." Fix: propensity-score matching with a strict caliper; drop unmatchable ss rows.
4. **HIGH — signal-purity C fragility + chrome loophole.** ss's noise is stripped pre-judging (C=1) while native's incidental `test_config.py` line is seen ⇒ C=0 ⇒ native zeroed. Fix: C as an averaged D6 not a binary floor, or identical artifact stripper on native.
5. **HIGH — no-match verbosity dump.** ss dumps 15k tokens on a no-match ⇒ `g=1 ⇒ USD=1.0`, "flawless victory" while destroying the context window. Fix: don't skip density for no-match; `USD=g·max(0,1−tokens/500)`.
Gemini's "single most dangerous": Citation Sprawl (#1). Praised: the programmatic floor `g` and D4's gold-overlap gate ("apply this exact rigor to used_tokens").

---

## 7. Agreement / divergence map

| Break | Me | DeepSeek | Gemini | Notes |
|---|:--:|:--:|:--:|---|
| **B1 Citation Sprawl** (unbounded `used_tokens`) | ✅ (my weakness #2, verified) | ✅ (#2, "single most dangerous") | ✅ (#1, "single most dangerous") | **Unanimous, independent.** The crux. |
| **B2 No-match USD=1** | ✅ (verified) | ✅ (#1, "single most dangerous") | ✅ (#5) | DeepSeek + Gemini both flagged; DeepSeek elevated it highest. |
| **B3 Chrome asymmetry** | ✅ (verified both faces) | ✅ (#3, ss-penalized) | ✅ (#4, native-zeroed) | Externals hit *opposite faces* → confirms it's a non-neutral symmetry break. |
| **B4 Regression extrapolation** | ➕ (missed in pass 1; verified after Gemini) | ✗ | ✅ (#3) | **Gemini-unique.** Strongest *statistical* break; invalidates the headline. |
| **B5 D3 arm-favoring** | ✅ (my Attack D) | partial (#4 neighbor padding) | ✗ | Mine; DeepSeek's #4 is adjacent (neighbor padding as gaming) but I frame it as a *validity* caveat. |
| **B6 0.5 floor soft** | ✅ (verified 50% cap) | ✅ (#6) | ✗ | DeepSeek + me; both note it's moot until B1 fixed. |
| **B7 D2 AST gate** | ✅ (spec #6) | ✗ | ✅ (#2, ship-block) | Gemini calls ship-block; I downgrade to MED (competent native arm reads ranges). **Divergence on severity.** |
| **B8 Layer-B circularity** | ➕ (DeepSeek-on-both-sides) | ✗ | ✗ | **Mine.** Neither external had the cross-doc context (panel vs solver family). |
| **B9 κ rare-positive** | ✅ (spec #5) | ✗ | ✗ | Mine/spec; externals didn't reach the calibration layer. |
| **B10 format extent bias** | ✅ | ✅ (#5) | ✗ | DeepSeek + me. |
| **B11 cross-language** | ✅ (spec #9) | ✗ | ✗ | Mine/spec. |

**Key divergences:** (i) Gemini rates the D2 AST gate (B7) ship-blocking; I and DeepSeek don't (the competent native arm can read full ranges, so it's a relaxable gate, not a structural wall). (ii) Only Gemini produced the regression-extrapolation break (B4) — a real gap in both my first pass and DeepSeek's, and a reminder that the statistics layer needs its own adversary. (iii) Only I had the cross-document Layer-B family-circularity (B8), because it requires reading the task-completion bench plan alongside the judge panel. (iv) On C (signal_purity): Gemini wants it demoted from binary-floor to an averaged D6; DeepSeek wants a continuous purity penalty; I keep it as a floor but demand symmetric pre-processing (B3) — these are three different fixes for the same fragility, and the designer should pick one explicitly.

**Strong consensus (3/3, independent):** B1, B2, B3 are real and serious. That triple-overlap, from disjoint model families plus my own verified arithmetic, is the credible core of this red-team.

---

## 8. Verdict

**Do NOT start the powered run on the current spec.** Four SHIP-BLOCKING breaks (B1 citation sprawl, B2 no-match garbage, B3 chrome asymmetry, B4 regression extrapolation) each independently invalidate either the anti-gaming guarantee or the headline number; B1 inverts the metric's core purpose. They are all fixable without re-architecting — B1/B6/B7 share the scoring code path, B2 is a no-match branch, B3 is the chrome/token-accounting seam, B4 is the stats layer. The grounding floor, blinding, disjoint panel, locked rubric, and the two-mechanism architecture are sound and should be kept. After fixing B1–B4 and **disclosing B5** (the D3 capability-vs-density framing, which is the most important honesty point for a hostile reviewer), re-run the padding/truncation reliability probes and require the pre-committed USD drops; then the metric is run-ready and the surviving ss-vs-native gap will be credible.
