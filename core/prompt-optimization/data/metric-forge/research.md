# Metric Forge — Phase 0 (Empirical Characterization) + Phase 1 (SOTA Research)

**Metric to forge:** an **intrinsic 0–1 score on a tool RESPONSE** (ss-search / ss-find / ss-trace / ss-grep / ss-semantic / ss-read vs native `rg`+`grep`+`read`) that captures **usable code-awareness signal per token**, is **anti-gaming / length-controlled / symmetric**, and whose **validity is established by correlation with the task-completion bench**.

**Author:** metric-researcher (Opus), 2026-06-03.
**Builds on (does NOT repeat):** `docs/useful-answer-grading-research-2026.md` (the answer-grading SOTA v1 — its §3 ranked approaches and §4 dual-rubric design are adopted as the *foundation*; this report sharpens them into a **tool-response** metric, adds the **Phase-0 empirical reality**, the **token-normalization mechanism**, and an updated, **independently-verified** citation base). Also builds on `docs/USEFUL_ANSWER_COLGREP_PLAN.md` (B1.5/B2 metrics) and `docs/TASK_COMPLETION_BENCH_PLAN.md` (the downstream bench).

**Scope note on dates:** searches date-scoped to the last 6–12 months. Every 2026 arXiv ID below was re-verified this session against the live arXiv/ADS/HF abstract page (the prior doc flagged its 2026 IDs as "lightly corroborated"; I re-confirmed the load-bearing ones and corrected one numeric detail — see §6). Two foundational anchors (CodeRAG-Bench `2406.14497`, LC-AlpacaEval `2404.04475`) are 12–24 mo old and flagged; not superseded.

---

## 0. Bottom line (one paragraph)

The right ground-truth **anchor** is a **two-layer human-derived anchor**: a small, frozen, hand-annotated set of **"minimal sufficient context" gold blocks** per probe (the researcher's call, gold-sufficiency style) used to *calibrate* the metric, with the **downstream task-completion bench as the external validity arbiter** (the metric is only trusted to the extent its per-probe scores predict the bench's resolve/sub-task-success delta). The **draft metric** is an intrinsic, evidence-anchored, **token-normalized usefulness density** score, `USD`, gated behind a correctness/groundedness floor and reported as a **per-dimension vector plus a single 0–1 scalar**, with five content dimensions (`answer_grounding`, `workable_code`, `navigability`, `edit_locality`, `sufficiency`) and one explicit **anti-padding counterweight** (`signal_purity`). The single most important mechanism — **token-normalization** — is NOT "divide score by tokens" (that would reward terseness blindly and break symmetry). It is a **length-matched, regression-residual comparison plus a span-attributed density**: (a) every positive criterion must cite the verbatim span that satisfies it (RULERS-style), and the **used-span tokens** (not total tokens) are what enter the density denominator, so padding inflates the denominator without raising the numerator; (b) at analysis time we regress `usefulness` on `log(response_tokens)` and report the **length-matched arm gap** (the residual), so the ss-*-vs-native claim is only credited if it **survives length-control** — symmetric to both arms. Phase-0 confirms this is the only defensible design: on 3 verbatim-captured probes the arms genuinely differ in *shape* (ss-* packs ranked symbol-complete blocks + a 1-hop graph; native emits `file:line` lists the agent must triage and read), but **native won one of the three on density** when the agent knew the symbol name — so a naive "richer = better" metric would be wrong and gameable, and only a length-controlled, span-attributed score can tell the real signal from verbosity.

---

## 1. Phase 0 — what ss-* ACTUALLY returns today vs native (verbatim, measured)

Method: put `eval/agent-read-workflows/bin` on PATH; resolve each repo with `resolveRepoCwd` (exported from `core/prompt-optimization/sweep/gepa-evaluate.mjs`); run BOTH arms on the same query; capture verbatim outputs; count tokens with the harness's own `estimateTokens` (`variant-loader.mjs`, ~4 chars/token, the same estimator the budgeter uses). Indexes confirmed present for all repos. Daemons reaped after (kill `cli.js --serve` + `kill -9` the `index-maintainer.mjs` survivors, per `project_node_serve_indexer_orphans`).

Probes (chosen to span the strata): **cpp-006** (multi-file-flow / medium — header/impl split), **go-002** (literal-lookup / medium — a function with branching logic), **csharp-009** (behavioral / **hard** / `hard_for_tools` — the surface term "fast-path parser" is NOT a symbol name).

### 1.1 Measured results (this session, real runs)

| Probe | ss-search response | ss `tokensUsed` (self-report) | NATIVE (rg matches + minimal sufficient reads) tokens (estimateTokens) | Who is denser-on-target |
|---|---|---|---|---|
| **cpp-006** | rank#1 = full `AllocateAlignedBytes` **definition** body (`aligned_allocator.cc`, the over-allocate/header-stash/aligned-payload logic = the expectedFact) + rank#2 = the `.h` **declaration** with `HWY_DLLEXPORT` + a **1-hop graph** (AllocPtr/FreePtr/AllocationHeader/AlignedDeleter with file:line). `sufficient=YES`. | **2251** | **975** (rg returns 10 match lines incl. **6 call-site false positives**; agent must read cc:69–110 + h:50–62) | **ss** (both decl+def+types in ONE call; native needs triage + 2 reads, and the rg list is 60% noise) |
| **go-002** | rank#1 = the **binder table** (`var ( JSON=… )`) + the `Default` **doc-comment**, but the actual `Default` **switch body** (the expectedFact) was chunk-split into rank#2 **as a summary line only**. `sufficient=YES` (debatably over-claimed). | **1134** | **195** (rg `func Default` → binding.go:95 instantly; read 95–128 = the exact switch body) | **NATIVE** (when the symbol name is guessable, `rg func Default` + 1 tiny read is far denser; ss returned *context around* the answer but demoted the answer itself) |
| **csharp-009** | rank#1 = full `FastParseCommand` body (exact expectedSymbol/expectedFile), routed **semantically** despite the surface term not being a symbol. `sufficient=no` (chunk truncated `// …(32 more lines)`, missing the `ParseCommand`→fallback caller). | **2788** | **3504** (naive `rg fast.?path` / `fast.*pars` return 14 lines across the right file PLUS test files + AsyncPool/LightEpoch false positives; agent must try multiple phrasings, then read the 708–821 body + the 2806–2820 caller) | **ss** (one call, rank#1 = the answer; native requires query-reformulation + heavy triage; this is the `hard_for_tools` case where lexical alone misleads) |

**ss-trace characterization (csharp `FastParseCommand`):** a *different signal shape* — front-loads an "answer checklist" (key symbols, **related definitions** with bodies, **target terms**, **top callees**, **critical paths**) + the target body; `budget=1313/12000`. Note `fan-in=0 fan-out=0` (the call-graph-sparsity finding from `project_ss_trace_phase6_redo_stage1`; 64% of call edges unresolved on these repos) — so ss-trace's *navigational map* can be thin where the call graph is incomplete. The metric must not assume the graph is always populated.

### 1.2 Concrete structural / signal differences (the metric must reflect THESE, not the ColGrep-plan ideal)

1. **ss-* returns ranked, symbol-complete code blocks with a tier system** (`full` / `preview` / `summary`) + a **1-hop graph of related symbols** (file:line) + **confidence/sufficiency signals** (`confidence`, `sufficient`, `sufficiencyReasons`, a machine-readable `<<SS_ROUTE_META>>` line). Native returns **`file:line:matchText`** lines and (after the agent decides) **raw byte ranges** from `read`. This is the core "code-awareness per token" difference — but it is a *shape* difference, and shape is exactly what a verbosity-biased metric over-rewards.
2. **ss-* triage is done for the agent; native triage is the agent's job.** The native rg list contains **call-site / test-file / cross-module false positives** the agent must filter (6/10 on cpp-006; ~half on csharp-009). ss-* ranks the answer to rank#1. *This is real signal density* — but it only matters if the agent would otherwise have spent tokens/turns triaging, which is precisely what the downstream bench measures.
3. **ss-* sometimes packs the wrong granularity.** go-002: the chunk boundary split the `Default` function so the *answer* became a summary line while *context* got the `full` tier. So ss-* is NOT uniformly denser-on-target; a fair metric must be able to **score native higher** here, or it is gamed/biased.
4. **`sufficient` is self-reported and occasionally over/under-claimed** (go-002 `YES` despite demoting the answer; csharp-009 honestly `no`). The metric must measure sufficiency against the **gold/answer**, not trust the tool's flag.
5. **Token cost is comparable, not lopsided.** ss `tokensUsed` ∈ {1134, 2251, 2788}; native minimal-sufficient ∈ {195, 975, 3504}. There is **no free verbosity** to penalize on either side by construction here — which is *why* length-control is the crux: the arms are already in the same token ballpark, so a real gap must survive matching, and a fake gap (ss just being longer) would not.

**Phase-0 verdict:** the hypothesis ("more usable code-awareness per token") is *directionally visible* (2/3 probes favor ss strongly, especially the hard/`hard_for_tools` case) but **not free** — native wins when the symbol is guessable, and ss can mis-granularize. This is the *ideal* situation for forging a hard-to-game metric: the signal is real but **conditional and symmetric**, so the metric earns its keep only if it length-controls and can credit either arm.

---

## 2. Recommended ground-truth ANCHOR (the researcher's call, with evidence + trade-offs)

**Recommendation: a two-layer anchor — (A) a frozen, hand-annotated "minimal sufficient context" gold set as the CALIBRATION anchor, and (B) the task-completion bench as the EXTERNAL VALIDITY anchor — never collapsed.**

### Layer A — gold minimal-sufficient-context blocks (calibration / κ anchor)
For a small frozen subset (20–30 of the 60 vault probes, stratified, seed=42), the researcher hand-annotates the **minimal set of code spans** (file + line range, at AST-block granularity) that a competent engineer needs to fully answer the probe — i.e., the *gold context* `C^G`. This is exactly the annotation primitive **ContextBench (`2602.05892`, verified)** uses (`Recall = |C^A ∩ C^G| / |C^G|`, `Precision = |C^A ∩ C^G| / |C^A|`, at file/AST-block/line granularity, tree-sitter-mapped) and **SWE-ContextBench (`2602.08316`, verified)** uses (human-verified gold contexts as intermediate signals). The probes already ship `expectedFiles` / `expectedSymbols` / `expectedFacts` — gold blocks are a thin extension (the line ranges), and the `notes` fields already record the verifying `grep`. The metric's per-dimension judge is **calibrated against this gold** and we report **panel-vs-gold Cohen's κ / QWK; require κ ≥ 0.6** before trusting the metric for any decision (the 2026 production bar — Galtea/confident-ai 2026, SWE-PRBench κ=0.75; "report κ not raw accuracy, κ is harder to fake").

- **Why this and not a pure reference-free judge:** a reference-free judge is the cheapest but most gameable (verbosity/self-preference). Anchoring criteria to *gold spans* lets us measure **precision against gold** directly (the anti-padding counterweight) and lets the LLM-judge dimensions be *calibrated*, not free-floating. The prior doc's §4 leans reference-free + length-control; this adds the cheap gold layer because Phase-0 showed the tool's own `sufficient` flag is unreliable and the `expected*` fields are *almost* gold already.
- **Trade-off:** annotation cost (small — 20–30 probes, the researcher's call as locked by the workflow). Gold can be incomplete on multi-hop probes (ContextBench: "chunks useful only in combination") — mitigate by annotating *sufficient* not *exhaustive* sets, and by treating recall-against-gold as a floor, not a ceiling.

### Layer B — task-completion bench as external validity (the arbiter)
The intrinsic `USD` is **validated** by correlating its per-probe value with the downstream **answer-fed-solver lift** / resolve-delta from `docs/TASK_COMPLETION_BENCH_PLAN.md` (the locked decision). This is the methodologically correct anchor for an *intrinsic* metric whose whole purpose is downstream prediction:
- **"Validating LLM-as-a-Judge Systems under Rating Indeterminacy" (NeurIPS 2025, verified):** a judge selected to maximize human-agreement is *not* guaranteed best on the **downstream-task** metric — so human-κ alone is insufficient; you must check the downstream criterion. This is the formal license for "calibrate on gold (Layer A), but *validate* on the bench (Layer B)."
- **"Principles and Guidelines for the Use of LLM Judges" (Dietz 2025, verified):** "Meta-Eval Trope #5 — high-level rank agreement obscures per-judgment differences"; recommends quantifying **downstream effects by substitution**. Our Layer-B correlation is exactly that substitution test.
- **CodeRAG-Bench (`2406.14497`, verified) + SWE-ContextBench (`2602.08316`, verified):** the field's consensus is that the least-gameable usefulness signal is **execution/task-grounded**, and that **compact-correct context beats volume** (SWE-ContextBench: No-Experience 26.26% → Oracle Summary 34.34% = +8pp, while "Free"/autonomous summary reuse *drops* to 22.22%). So Layer B is both the validity arbiter AND independent evidence that the metric *should* reward compact-targeted over voluminous — aligning the metric's incentives with reality.

**Anchor summary:** *Calibrate the intrinsic metric on hand-annotated gold sufficient-context (κ≥0.6); declare it valid only if it predicts the task-completion bench delta (pre-committed correlation threshold + CI excluding 0). The researcher's gold call is the calibration anchor; the bench is the falsifier.*

---

## 3. DRAFT 0–1 metric: `USD` (Usefulness-per-token, Span-attributed, length-controlled)

A **single 0–1 scalar reported alongside its per-dimension vector**, gated behind a floor. Mirrors the repo precedent (`relaxed-grading.mjs` reports relaxed alongside strict; `project_gold_rubric_under_credits_correct_behavior` mandates "score strict + secondaries, never strict alone"). It drops into `gepa-evaluate.mjs` behind the existing injectable judge seam and reuses the disjoint 3-panel + median pattern (`judgePanelScore`).

### 3.1 The floor (gate) — `correctness`/`grounding`
Reuse the existing `JUDGE_SYSTEM_PROMPT` recall/fact floor **unchanged**. `USD` is only meaningful when `grounding ≥ θ_floor` (a wrong/hallucinated/empty response = `USD := 0`). Symmetric: a native `file:line` answer that points at the wrong file fails the floor exactly like a padded ss-* block that names the wrong symbol. This preserves the existing correctness signal and makes "useful" strictly conditional on "correct."

### 3.2 The dimensions (analytic, binary, evidence-anchored — Autorubric `2603.00077` + RULERS `2601.08654`, both verified)
The judge sees: the query, the **gold sufficient-context blocks** (Layer A) when available else `expected*`, and the **full tool response** (the raw stdout of the arm — ss-* block(s) OR the rg lines + read bytes, captured identically for both arms). For each criterion it must **first quote the verbatim span of the response that satisfies it, then emit 0/1** (RULERS evidence-anchoring; no quotable span ⇒ 0). Binary (not Likert) — harder to game with verbosity, more stable κ (Autorubric; Hamel-Husain binary-verdict lineage).

| # | Dimension | Binary question | Why (and which arm it can favor) |
|---|---|---|---|
| D1 | **`answer_grounding`** | Does the response contain the *specific code/fact that answers the query* (not just point near it)? Cite the span. | The core. go-002 shows native can win this (the `Default` switch body), ss can lose it (demoted to summary). |
| D2 | **`workable_code`** | Is the actual **edit-ready code** present (a runnable snippet/full symbol), not merely a `path:line` pointer or a name? | The precise ss-* edge; recall-only grading is blind to it. Native earns it iff its `read` span includes the symbol body. |
| D3 | **`navigability`** | Does the response make the **relevant neighbors reachable** (callers/callees/related types/the relation), enough to understand the change site **without another retrieval round**? | ss-* 1-hop graph + ss-trace checklist target this. Native can earn it iff its rg lines already expose the neighbors. |
| D4 | **`edit_locality`** | Does it pin the **specific site(s)** (function/region + file), not just the file? | Both arms can earn this; it separates "found the file" from "found the spot." |
| D5 | **`sufficiency`** | Could a competent engineer **act now without re-searching**? (Measured vs gold, NOT the tool's self-reported `sufficient`.) | Penalizes under-answering; **counterweight to D6** so the score is not monotone-decreasing in length. |
| **C** | **`signal_purity`** (anti-padding counterweight) | Is the response **free of content not needed** for the query (no irrelevant blocks, no false-positive matches left unmarked, no duplicated/boilerplate filler)? | The anti-verbosity teeth. **Symmetric:** docks ss-* for dumping a low-relevance 5th `summary` result AND docks native for an unfiltered rg list full of call-site false positives. |

`content_score = mean(D1..D5)` (median across the 3-judge panel **per criterion**, then mean — matches `judgePanelScore`). `signal_purity` ∈ {0,1} similarly.

### 3.3 The aggregation into 0–1 (token-normalized) — **the crux**
Two coupled mechanisms; **neither is "score ÷ tokens."**

**(a) Span-attributed density (per-response, the intrinsic scalar).**
Each positive criterion's cited span has a token count (estimate via `estimateTokens`). Let `used_tokens` = tokens of the **union of all cited spans** (the part of the response that actually did work), and `total_tokens` = tokens of the whole response.
```
purity_ratio   = used_tokens / total_tokens        # in (0,1]; padding ↓ this
USD_raw        = signal_purity * content_score      # floor-gated content
USD            = USD_raw * (0.5 + 0.5 * purity_ratio)   # density shaping, bounded
```
- Padding raises `total_tokens` without raising `used_tokens` ⇒ `purity_ratio` falls ⇒ `USD` falls. A terse native answer whose every token is a cited span gets `purity_ratio≈1` and is **not penalized for being short** (this is the explicit "never unfairly penalize a terse-but-sufficient native response" guarantee). A long ss-* block is only rewarded for the *cited* portion; its uncited tail is pure denominator.
- The `0.5 +` floor on the density shaper prevents "one cited token" pathologies and keeps the metric from collapsing to raw 1/tokens (which the LC-AlpacaEval truncation attack, `2404.04475`, showed is itself gameable: naïve length-correction pushed a win-rate 3.7→25.9; we deliberately do **not** make density the dominant term).

**(b) Length-matched residual (per-arm gap, the validity audit).**
At analysis time, regress `content_score` on `log(total_tokens)` pooled across both arms (Dubois LC-style, `2404.04475`; and the adaptive length-bin method of "Benchmarking LLM-as-a-Judge for Long-Form Output" `2606.01629`, verified). Report the **length-matched arm gap** = the arm coefficient after conditioning on length, with a paired bootstrap CI (`scripts/vault-stats.mjs`). **The ss-*-vs-native claim is credited ONLY if this length-matched gap's CI excludes 0** (`feedback_format_gate_boosts` discipline: claims must survive the obvious confound). If the raw gap favors ss but the length-matched gap collapses to ~0, the "richness" was verbosity → drop the claim. *This is symmetric and is the single decisive anti-gaming gate.*

### 3.4 Per-dimension measurement (programmatic / judge / hybrid)
- **D1, D2, D3, D5, signal_purity:** LLM-judge, evidence-anchored, 3-panel median, calibrated against Layer-A gold. (Hybrid: D2 `workable_code` is partly programmatic — a tree-sitter check that the cited span is a complete AST node/symbol, reusing the B1.5 "symbol completeness" check from `USEFUL_ANSWER_COLGREP_PLAN.md` §10.2.)
- **D4 `edit_locality`:** mostly programmatic — does the response cite a span that overlaps the gold block's file+line range (ContextBench precision-against-gold, `2602.05892`)? Judge only adjudicates near-misses.
- **`used_tokens` / `total_tokens`:** programmatic (`estimateTokens` on cited spans vs full response). Deterministic, cheap, not on the judge's hot path.
- **Panel:** disjoint families (deepseek-v4-flash **direct** per `feedback_deepseek_direct_api`, gemini-3.1-flash-lite, an abab/minimax-class) — partial self-preference cancellation (the "Judging the Judges" / Adaline 2026 "use a different-provider judge" rule).

### 3.5 Anti-gaming controls (layered; each ~halves a bias, none removes it — stack them)
- **L1 evidence-anchoring (RULERS):** every positive criterion cites a span; this is also what makes `used_tokens` measurable. Strongest single control for code.
- **L2 explicit anti-length + `signal_purity` criterion (Autorubric "verbosity-bias length penalties"):** judge is told "score content, not length/format; a longer response is NOT better." Caveat (honesty): `2510.12462` (verified) found modern judges, when the rubric stresses correctness/relevance, score verbose/CoT answers *slightly lower* — so verbosity bias is **nuanced, not monotone**; we still control for it because it is dataset/judge-dependent, but we do not assume it always inflates.
- **L3 disjoint-family panel + median:** as above.
- **L4 length-matched residual (§3.3b):** the decisive audit. Non-negotiable before any ss-*-vs-native claim.
- **L5 locked rubric bundle (RULERS):** rubric string + criteria are hashed (`hashContent`) and frozen per run-id; edits force a new run (anti rubric-drift p-hacking).

### 3.6 Why this is not "reward verbosity" and is symmetric
D1–D5 reward *content the engineer needs*; `signal_purity` + the `purity_ratio` denominator + L4 actively punish length-without-substance on **both** arms; D1/D5 prevent the metric from rewarding terse-but-incomplete. Phase-0's go-002 case (native wins) and csharp-009 case (ss wins on the hard probe) both score correctly under this design — which is the test that it is not arm-biased.

---

## 4. Validation protocol (how it predicts downstream completion + the falsifier)

**Pre-registered, held-out-disciplined, no p-hacking.** Pre-commit N, reps, panel, rubric hash, and the correlation threshold before the powered run; git-tag the prereg (P7 `prereg/` pattern). Never inspect held-out per-probe (`feedback_heldout_discipline_strict`).

1. **Capture both arms' raw tool outputs on the 60-probe vault** (the locked full build), seed=42, conc=1. *Required runner change:* persist full `finalText` / raw tool stdout (the prior doc's §4.B "catch" — vault runners store scores, not text). Reap daemons between batches.
2. **Calibration (Layer A):** score `USD` + dimensions on the 20–30-probe gold subset; report **panel-vs-gold κ/QWK per dimension**; **gate: κ ≥ 0.6** or the dimension is reported diagnostic-only, not load-bearing.
3. **Intrinsic comparison:** per-probe paired `USD` (ss vs native), per-dimension Δ, with paired bootstrap CIs. Report the **length-matched residual gap** (§3.3b) as the headline — *the* number.
4. **External validity (Layer B — the proof):** correlate per-probe `USD` (and the length-matched arm Δ) with the task-completion bench's per-probe **answer-fed-solver lift** / resolve-delta. Report **Spearman ρ + Kendall τ + bootstrap CI** (the meta-eval association metrics — LLM-judge-in-healthcare scoping `2605.25273`, G-Eval lineage). Also run the **substitution check** (Dietz 2025): does swapping `USD` for the bench's own gold-context-recall change system rankings? If not, `USD` is a faithful cheap proxy.
5. **Reliability probes (standing):** a **truncation probe** (mechanically cut high-`USD` responses to ~40% → expect `sufficiency`/`workable_code` to drop) and a **padding probe** (append irrelevant boilerplate to a correct terse native answer → expect `signal_purity`/`purity_ratio` to drop, `USD` to fall). These are the controlled-pair method from "Judging the Judges" and the RULERS adversarial-perturbation stability test — they prove the metric reacts the right way to the two gaming directions.

**Publishable claim:** "On N=60 vault probes (seed=42, 3-panel disjoint judges, κ≥0.6 vs gold), ss-* tool responses score Δ`USD` = X [CI lo, hi] over native **after length-matching**, and per-probe `USD` predicts the task-completion answer-fed-solver lift at ρ=Y [CI]." Report held-out aggregate only at the milestone; report N, seed, panel, rubric hash, cache-aware cost.

**FALSIFICATION (pre-committed):** the core thesis is **refuted** if EITHER (a) the **length-matched** Δ`USD` CI **includes 0** (the apparent ss edge was verbosity/shape, not signal) — *this is the headline falsifier and Phase-0 shows it is a live possibility (native won go-002)*; OR (b) `USD` does **not** correlate with the downstream bench lift (ρ CI includes 0 or is negative) — then `USD` is not a valid usefulness proxy regardless of how clean it looks, and per the NeurIPS-2025 indeterminacy result we must not ship it as a decision metric. We **do not tune to** a held-out failure (`feedback_heldout_discipline_strict`); we fix the principle and re-run.

---

## 5. Failure modes an adversary could exploit (pre-empting the red-team)

1. **Verbosity laundering.** Pad a response with a real-but-irrelevant extra symbol so the judge sees "more code." → Defended by `signal_purity` (D-counterweight) + `purity_ratio` denominator (padding ↑ total, not used) + L4 length-matching. *Residual risk:* if the padding is *plausibly* relevant the judge may cite it as a span — mitigate with the gold-precision check (D4 against `C^G`) and the padding reliability probe.
2. **Evidence-anchoring spoof (RULERS' own caveat, verified):** "an evaluator might cite technically-correct evidence while applying the rubric inconsistently" / selectively anchor to a span that supports a preferred score. → Mitigate: require the cited span to **overlap gold** for D1/D4 (programmatic), use the median-of-disjoint-panel, and run the truncation probe.
3. **Self-preference / family bias** (judge favors ss-* output because it looks like model-generated structured text). → Disjoint-family panel + median; never let a Claude-family model be sole judge (the workflow's disjoint-model mandate).
4. **Format/structure bias** (the `<<SS_ROUTE_META>>` line, headers, "confidence" labels read as "thoroughness"). Style/format bias is the *dominant* bias (0.76–0.92 per "Judging the Judges"). → Strip tool-meta/formatting before judging (judge the *code content*, not the chrome); the padding probe catches residual format-reward.
5. **Native-arm strawman (asymmetry attack on us).** If we let the native arm be a *naive* single rg with no reads, ss-* wins trivially and unfairly. → Phase-0 mandates a **competent** native arm (reformulated queries + sufficient reads, as a real agent would); `signal_purity` must dock ss-* for its own noise too. The metric must be runnable with native winning (go-002 proves it can).
6. **Gold incompleteness on multi-hop** (ContextBench: chunks useful only in combination; CARE `2604.18234`). → Annotate *sufficient* sets; treat recall-vs-gold as floor; report multi-hop probes separately.
7. **Downstream-decoupling attack (the strongest external challenge):** "Coding Agents are Effective Long-Context Processors" (`2603.20432`, verified) argues native tool-proficiency + filesystem-familiarity already make raw agents strong, attributing efficacy to *executable tools, not passive semantic queries* — i.e., the ss-* density edge might **not** convert downstream. → This is exactly why Layer B (the bench) is the arbiter, not the intrinsic score; if `USD` doesn't predict the bench (falsifier b), we report H0 honestly. SWE-ContextBench's "Free retrieval ≈0/net-negative" is the same warning from the other side.
8. **Optional-stopping / rubric-drift p-hacking.** → L5 locked-hashed rubric, pre-committed N + reps, CI-excludes-0, no inspecting held-out.

---

## 6. Citations (dated; one-line relevance + honest strength; ✔ = abstract re-verified this session)

**Verified anchors (load-bearing):**
- **CodeRAG-Bench** `2406.14497` (NAACL Findings 2025) ✔ — fixed generator, varied context, **execution metrics**; +27.4% SWE-bench with gold docs; DeepSeekCoder "benefits less" (per-system). **High.** *Flag: ~12mo.*
- **SWE-ContextBench** `2602.08316` (Feb 2026) ✔ — No-Experience 26.26% → **Oracle Summary 34.34%** (+8pp); **Free/autonomous reuse drops to 22.22%** (compact-correct > volume; autonomous retrieval can hurt). 1,476 tasks/51 repos/9 langs; deterministic F2P∧P2P + cost/runtime. **High.** *(Corrected vs prior doc's "217 vs 25,633 tok" phrasing — the canonical headline is the 26.26→34.34 resolve numbers + "compact summaries > full trajectories".)*
- **ContextBench** `2602.05892` (Feb 2026) ✔ — process-oriented; **gold context at file/AST-block/line**; `Recall=|C^A∩C^G|/|C^G|`, `Precision=|C^A∩C^G|/|C^A|`, F1, Efficiency, **Usage Drop**; "Bitter Lesson" (scaffolding ≈ marginal); "LLMs favor recall over precision"; "gap between explored and utilized context." The annotation primitive for Layer A. **High.**
- **RULERS: Locked Rubrics & Evidence-Anchored Scoring** `2601.08654` (Jan 2026, WUSTL/ASU/FSU) ✔ — 3 failure modes (instability/unverifiable/misalignment); compiler→**versioned immutable bundles** + **structured-decoding evidence verification** + Wasserstein calibration; stable under adversarial rubric perturbation; small judges rival large. Backbone of §3.2/L1/L5. Names the evidence-spoof caveat. **High.**
- **Autorubric** `2603.00077` (Feb 2026, Stanford SCALE) ✔ — analytic **binary/ordinal/nominal** criteria, multi-judge ensemble + aggregation modes, few-shot calibration, **verbosity-bias length penalties**, per-criterion atomic eval; CHARM-100. Reference spec for §3.2. **High.**
- **Validating LLM-as-a-Judge under Rating Indeterminacy** (NeurIPS 2025) ✔ — judge picked for human-agreement ≠ best on downstream metric; license for Layer-B validation over κ-alone. **High.**
- **Principles & Guidelines for the Use of LLM Judges** (Dietz 2025, UNH) ✔ — Meta-Eval Tropes (esp. #5 agreement-hides-per-judgment); **quantify downstream effects by substitution** (our Layer-B substitution check). **High.**
- **Length-Controlled AlpacaEval** `2404.04475` (COLM 2024) — regression length-debiasing; corr-to-Arena 0.98; **truncation attack 3.7→25.9** (naïve length-correction is itself gameable → why §3.3a is bounded, not raw 1/tokens). **High.** *Flag: ~24mo, still standard.*

**Verified supporting (new this session, sharpen the metric):**
- **SCARLet — Utility-based Retriever via Shared-Context Attribution** (EMNLP 2025, 11 cites) ✔ — trains on **passage utility** via **perturbation-based attribution** (per-passage utility on shared context). The formal cousin of D4/`used_tokens` attribution. **Medium-high.**
- **AttriBoT — Efficient LOO Context Attribution** `2411.15102` ✔ — leave-one-out context attribution is principled but expensive; >300× speedup approximations. The practical engine if we want per-span counterfactual utility beyond span-citation. **Medium-high.**
- **SCORE: Specificity, Context Utilization, Robustness, Relevance** `2602.10017` (Feb 2026, UIC/Argonne) ✔ — reference-free multi-dim incl. **context-utilization** (does the retrieved context contribute) + robustness-to-paraphrase; "no single metric suffices." Validates the multi-dim, anti-single-number stance. **Medium-high.**
- **Benchmarking LLM-as-a-Judge for Long-Form Output** `2606.01629` (2026) ✔ — **adaptive length-bins** to test length-sensitivity across systems with very different lengths. Method for §3.3b. **Medium.**
- **Coding Agents are Effective Long-Context Processors** `2603.20432` (2026) ✔ — native tool-proficiency + filesystem-familiarity; "executable tools > passive semantic queries"; +17.3% avg. **The strongest external counter-thesis** → motivates falsifier (b) / failure-mode 7. **Medium-high (counter-evidence).**
- **Leveraging LLMs for Utility-Focused Annotation** (2025) ✔ — LLM-judged *utility* annotation cuts manual effort; supports the judge-as-utility-proxy + cheap gold. **Medium.**
- **Evaluating/Mitigating LLM-Judge Bias (pointwise)** `2510.12462` ✔ — **nuance:** modern judges scored verbose/CoT *lower* when rubric stresses correctness/relevance. Honest correction to "verbosity always inflates." **Medium-high.**
- **Bias in the Loop: Auditing LLM-as-Judge for SE** `2604.16790` ✔ — code-specific judge audit; semantics-preserving perturbations swing verdicts; "verbosity" → comment-density/complexity in code. Why determinism + perturbation probes. **Medium-high.**

**From the prior doc, retained as background (not re-verified this session; cite with the prior doc's flags):** DeR2 `2601.21937`, Beyond Resolution Rates `2604.02547`, Are-Solved-Issues-Really-Solved `2503.15223`, METR PR-merge study (2026-03), RAGAS `2309.15217`, ARES `2311.09476`, RAGChecker, CARE `2604.18234`, Deepchecks-RAG `2605.14488`, SWE-PRBench `2603.26130`, CodeVisionary (ASE 2025), Reward-Hacking survey `2604.13602`, Is-Summary-Useful `2305.15044`, Codebase-Memory (2026, the near-identical comparator).

**Disagreements / thin areas (honest):**
- **Verbosity bias is not monotone** (`2510.12462` vs the MT-Bench/Saito lineage): modern judges *can* dock verbosity when the rubric is correctness-first. We still length-control (L4) because it is judge/dataset-dependent, but we do not over-claim a verbosity tailwind for ss-*.
- **Intrinsic ⊥ extrinsic don't always agree** (Is-Summary-Useful `2305.15044`): hence the bench (Layer B) is the arbiter when they diverge.
- **The strongest counter-thesis** (`2603.20432`) says the density edge may not convert downstream — engaged head-on as the falsifier, not dismissed.
- **arXiv MCP search returned empty all session** (likely transient); 2026 IDs were verified via Tavily→arXiv/ADS/HF abstract pages instead. The NeurIPS-2025 indeterminacy and Dietz-2025 papers are verified by title/abstract but I did not pin their arXiv IDs — cite by title until pinned.

---

## 7. One-line summary
Anchor = **hand-annotated minimal-sufficient-context gold (calibration, κ≥0.6) + the task-completion bench (external validity arbiter)**; the metric = **`USD`, a floor-gated, evidence-anchored, span-attributed usefulness-density 0–1 score** with 5 content dimensions + a `signal_purity` anti-padding counterweight; token-normalization = **(a) the density denominator counts only *cited/used* span tokens (padding inflates the denominator, not the score) and (b) the ss-*-vs-native gap is credited only if it survives a length-matched regression residual with a CI excluding 0 — symmetric to both arms, and Phase-0 proves native can and does win that test sometimes.**
