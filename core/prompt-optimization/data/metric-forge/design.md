# Metric Forge — Phase 2 (DESIGN): the `USD` tool-response usefulness metric — concrete, implementable spec

**Author:** metric-designer (Opus), 2026-06-03.
**Input:** `research.md` (anchor + draft `USD` + validation protocol + failure modes), the metric-forge SKILL, and the harness (`gepa-evaluate.mjs`, `variant-loader.mjs`, `p7-vault-probes-v60.json`, `vault-stats.mjs`).
**Status:** ready for the adversarial loop (`metric-redteam` ‖ `metric-rederiver`). Section 11 lists the weakest assumptions to target.

> **What this document is.** A build-ready specification. An engineer must be able to implement it with no design judgement left open: every dimension has a measurement procedure (programmatic / judge / hybrid), every aggregation step is a formula, the token-normalization is two named mechanisms with formulas, the judge rubric is verbatim, the panel + anchoring + reproducibility are pinned, the inputs/outputs are typed, the validation plan is pre-registered with an explicit falsifier, and each dimension has an anti-gaming analysis with a built-in defense. Locked decisions from the workflow are honored: **intrinsic 0–1 on the tool RESPONSE** (not the agent's final answer), **validity by correlation with the task-completion bench**, **anchor = researcher's gold call**, **anti-gaming is the crux** (token-normalized, length-matched, symmetric, explicit no-padding counterweight). DeepSeek is ALWAYS direct API. No commits.

---

## 0. The object being scored (precise, and the one place this departs from the prior answer-grading doc)

The prior doc (`useful-answer-grading-research-2026.md`) scored the **agent's final answer text**. **This metric scores the RAW TOOL RESPONSE** — the bytes a tool returns to the agent *before* the agent reasons over them. This is the locked decision ("an INTRINSIC score on the TOOL RESPONSE itself, not the agent's final answer") and it changes three things vs. the prior doc:

1. **The unit is a per-query *retrieval episode*, not an answer.** For one probe, one arm, we capture the concatenation of that arm's tool outputs for that probe (defined exactly in §5.1). We do NOT run a downstream agent to produce prose; we score the retrieved context itself.
2. **"Workable code present" is now nearly always literally true for ss-\* and conditionally true for native** — because ss-\* returns code blocks and native returns `file:line` + the bytes of whatever `read` the (simulated) competent agent issued. The metric must therefore measure *whether the returned bytes contain the answer span*, not *whether the responder mentioned it*.
3. **Symmetry is structural, not rhetorical.** Both arms produce a byte blob with the same captured fields (text + a token count). The judge and the programmatic checks never see which arm produced the blob (§7.3). The arm label exists only in the analysis layer.

**Two-arm definitions (frozen, symmetric).**
- **`ss` arm** — the verbatim stdout of the ss-\* call(s) the policy makes for the probe (the ranked, tiered, symbol-complete blocks + 1-hop graph + the `<<SS_ROUTE_META>>` line), captured as emitted. Tool *chrome* (the meta line, tier labels, confidence strings) is stripped before judging per L4/§7.6; it is retained for the token count and the purity denominator.
- **`native` arm** — a **competent** native episode: `rg`/`grep` match lines for the probe's natural query terms (plus up to 2 reformulations, mirroring what a real agent does), PLUS the byte ranges a competent engineer would `read` to confirm the answer. This is the Phase-0 "native minimal-sufficient" capture, NOT a single naive `rg`. The native arm being competent is a load-bearing fairness requirement (failure-mode 5); §5.2 pins how it is produced and frozen.

---

## 1. The metric at a glance (the whole function in one block)

```
INPUT  (per probe p, per arm a):  R = raw tool response (string), with arm label hidden from scorers
GOLD   (per probe p):             expected{Files,Symbols,Facts} (always) + C^G gold spans (subset, §6)

FLOOR  (gate):    g = grounding(R, gold) ∈ {0,1}        # §2.  wrong/empty ⇒ USD := 0
CONTENT:          D1..D5 ∈ {0,1} each (panel-median),  content = mean(D1..D5)   # §3
PURITY:           C = signal_purity ∈ {0,1} (panel-median)                       # §3
DENSITY:          purity_ratio = used_tokens / total_tokens ∈ (0,1]              # §4a (programmatic)

USD_raw  = g · C · content
USD      = USD_raw · (0.5 + 0.5 · purity_ratio)        ∈ [0,1]                    # §4a

# Reported alongside USD (never folded in):
sub-scores  = {grounding g, D1..D5, signal_purity C, purity_ratio, content}
tokens      = {total_tokens, used_tokens, used_token_breakdown_per_criterion}
arm-gap     = length-matched residual of content (and of USD) vs log(total_tokens)  # §4b (analysis only)
```

`USD` is the single 0–1 scalar; the sub-score vector and token counts ship with it (mirrors `relaxed-grading.mjs` reporting relaxed alongside strict; mandated by `project_gold_rubric_under_credits_correct_behavior`). The **headline comparative claim** is NOT `mean(USD_ss) − mean(USD_native)`; it is the **length-matched residual** (§4b). This separation is the anti-gaming crux.

---

## 2. The floor (gate): `grounding` — reuse the existing correctness signal, unchanged

`USD` is conditional on correctness. A response that points at the wrong file/symbol, hallucinates, or is empty earns `USD = 0` regardless of how dense or pretty it is. Symmetric: a padded ss-\* block naming the wrong symbol fails exactly like a native `rg` that matched the wrong file.

**Measurement (hybrid, binary `g ∈ {0,1}`):**
- **Programmatic pre-check (necessary, not sufficient):** does `R` contain a path matching some `expectedFiles[i]` (suffix match, case-insensitive) OR a token matching some `expectedSymbols[j]` (word-boundary)? For `expectedNoMatch` probes (9/60), the programmatic pre-check is inverted: `R` must NOT assert a confident match (see §2.1).
- **Judge confirmation:** the existing 3-panel `JUDGE_SYSTEM_PROMPT` (verbatim, unchanged — `gepa-evaluate.mjs:183`) scores correctness in [0,1] via `judgePanelScore`. Define `g = 1` iff `panel_median_correctness ≥ θ_floor` AND the programmatic pre-check passes; else `g = 0`.
- **θ_floor = 0.5**, pre-registered (the existing harness already treats ≥0.5 as "substantially correct"; chosen before any USD run, locked by rubric hash §7.5). A sensitivity sweep over θ_floor ∈ {0.4, 0.5, 0.6} is reported as a robustness check (§9), never tuned-to.

**Why reuse it verbatim:** it is the locked production correctness signal; the metric-forge mandate is to ADD usefulness, not re-litigate correctness. Reusing it guarantees that `Δcorrectness ≈ 0` (the "same accuracy" half of the thesis) is measured by the *same* instrument as P7, so the comparison is apples-to-apples.

### 2.1 `expectedNoMatch` probes (9/60) — the one branch that needs its own gate
For no-match probes there is no answer span to be dense about. Define:
- `g = 1` iff the response correctly supports a "no confident match" conclusion (programmatic: no high-confidence ss-\* `sufficient=YES` on a fabricated symbol; native: empty/near-empty rg with no read of a fabricated location) AND the panel agrees (it sees `EXPECTED: no match`).
- For no-match probes, **`content := g` and `purity_ratio := 1`** (a correct empty/sparse "nothing here" response is maximally pure by definition; there is no padding floor to fear because the correct response is near-zero tokens). So `USD = g` on no-match probes. These are reported as a **separate stratum** and excluded from the density and length-matched-gap statistics (you cannot length-match a near-empty correct response); they only test that the metric does not punish a terse-correct native "no match" — the explicit "never unfairly penalize a terse-but-sufficient native response" guarantee at its extreme.

---

## 3. The content dimensions D1–D5 + `signal_purity` (binary, evidence-anchored)

Five content dimensions + one anti-padding counterweight. All binary (not Likert): harder to game with verbosity, more stable κ (Autorubric `2603.00077`; RULERS `2601.08654`; Hamel-Husain binary-verdict lineage). Each is scored by the 3-panel judge under the verbatim rubric in §7, **with mandatory span-citation before the 0/1** (RULERS evidence-anchoring; no quotable span ⇒ 0 — this is also what makes `used_tokens` measurable in §4a).

| # | Dimension | Binary question (the judge answers this per §7 rubric) | Measurement | Which arm it can favor |
|---|---|---|---|---|
| D1 | `answer_grounding` | Does R contain the **specific code/fact that answers the query** (not merely point near it)? | judge + programmatic cross-check (cited span must overlap `C^G` or `expectedSymbols` def) | go-002 shows **native can win** (the `Default` switch body) and **ss can lose** (answer demoted to a summary line) |
| D2 | `workable_code` | Is **edit-ready code** present (a runnable snippet / complete symbol body), not just a `path:line` pointer or a bare name? | **hybrid**: tree-sitter check that the cited span is a complete AST node/symbol (B1.5 "symbol completeness", `USEFUL_ANSWER_COLGREP_PLAN.md` §10.2) + judge adjudication of partials | ss-\* edge; native earns it iff its `read` span includes the full symbol body |
| D3 | `navigability` | Are the **relevant neighbors reachable** (callers/callees/related types/the relation) **without another retrieval round**? | judge (cited span = the neighbor reference) | ss-\* 1-hop graph + ss-trace checklist; native earns it iff its rg lines already expose the neighbors |
| D4 | `edit_locality` | Does R pin the **specific site** (function/region + file), not just the file? | **mostly programmatic**: does a cited span overlap `C^G`'s file+line range (ContextBench precision-against-gold, `2602.05892`)? Judge only adjudicates near-misses (overlap ∈ (0, threshold)) | both arms can earn it; separates "found the file" from "found the spot" |
| D5 | `sufficiency` | Could a competent engineer **act now without re-searching**, measured vs **gold** (NOT the tool's self-reported `sufficient`)? | judge, anchored to `C^G` recall | penalizes under-answering; **counterweight to C** so the score is not monotone-decreasing in length |
| C | `signal_purity` | Is R **free of content not needed** for the query (no irrelevant blocks; no unmarked false-positive matches; no duplicated/boilerplate filler)? | judge, with the programmatic `purity_ratio` (§4a) as a corroborating covariate | **symmetric teeth**: docks ss-\* for a low-relevance 5th `summary` result AND docks native for an unfiltered rg list full of call-site false positives |

**Aggregation (per the existing `judgePanelScore` median-of-panel pattern):**
```
For each criterion k ∈ {D1,D2,D3,D4,D5,C}:
    k = median over the 3 panelists of their binary verdict     # 3 binaries → median ∈ {0,1}
content = mean(D1, D2, D3, D4, D5)                              # ∈ {0, 0.2, 0.4, 0.6, 0.8, 1.0}
```
Median of three binaries is itself binary (majority vote), which is exactly the robustness property we want: one outlier judge cannot flip a criterion. D2 and D4 have a programmatic component; the rule is **programmatic-gates-judge**: if the tree-sitter / overlap check is *false*, the criterion is 0 regardless of the judge (you cannot claim `workable_code` for a span that is not a complete AST node, nor `edit_locality` for a span that does not overlap gold); if the programmatic check is *true*, the judge's majority decides (it may still dock for, e.g., the right symbol but truncated to uselessness). This makes the two arms' D2/D4 maximally objective and minimally gameable.

---

## 4. Token-normalization / anti-verbosity — THE crux (two coupled mechanisms; neither is "score ÷ tokens")

The whole point is "**more usable signal per token**", not "more text". A naive `score / tokens` would blindly reward terseness, break symmetry, and is itself gameable (LC-AlpacaEval truncation attack, `2404.04475`: naive length-correction pushed win-rate 3.7→25.9). We use two mechanisms, with explicit formulas.

### 4a. Span-attributed density (per-response, programmatic — enters the scalar)

Each *positive* criterion (D1–D5, and `signal_purity`'s satisfying evidence) carries the **verbatim span the judge cited**. Compute token counts with the harness estimator `estimateTokens` (`variant-loader.mjs:68`, `round(len/4)` — the same estimator the budgeter uses, so units match the tool's own `tokensUsed`).

```
total_tokens = estimateTokens(R_raw)                                  # the FULL response incl. chrome
used_spans   = union of all spans cited by the panel-MAJORITY for any satisfied D1..D5  # dedup overlaps
used_tokens  = estimateTokens(concat(used_spans))                     # the part that did work
purity_ratio = used_tokens / total_tokens                            # ∈ (0,1]; clamp to (0,1]
```

Density shaping into the scalar:
```
USD_raw = g · signal_purity · content
USD     = USD_raw · (0.5 + 0.5 · purity_ratio)
```

Why each piece:
- **Padding inflates `total_tokens` but not `used_tokens`** ⇒ `purity_ratio` falls ⇒ `USD` falls. A long ss-\* block is rewarded only for its *cited* portion; its uncited tail is pure denominator. (Verbosity laundering, failure-mode 1, is structurally punished here, not just by the judge.)
- **A terse native answer whose every token is a cited span gets `purity_ratio ≈ 1` and is NOT penalized for being short.** This is the explicit "never unfairly penalize a terse-but-sufficient native response" guarantee, implemented as a formula. go-002 (native wins) lands correctly: native's 195 tokens are nearly all the `Default` switch body ⇒ `purity_ratio≈1`, full content.
- **The `0.5 +` floor on the shaper** prevents two pathologies: (i) "one cited token" responses cannot rocket the ratio to dominate; (ii) the metric never collapses to raw `1/tokens` (the truncation-attack hazard). Density is a **multiplicative shaper in [0.5, 1.0]**, deliberately NOT the dominant term. Span-citation precision is itself gold-checked (D1/D4 require overlap with `C^G`), so a judge cannot inflate `used_tokens` by citing the whole blob — only gold-overlapping spans for D1/D4 count, and the union is deduped.

**Span-citation integrity (anti-spoof, from RULERS' own caveat):** a cited span only contributes to `used_tokens` if (a) it is a verbatim substring of `R` (programmatic exact-match check; non-substring citations are dropped and logged), and (b) for D1/D4 it overlaps `C^G`. This kills "cite a plausible-but-irrelevant span to inflate density" (failure-mode 2).

### 4b. Length-matched residual (per-ARM gap, analysis-only — the decisive audit)

The comparative claim is credited ONLY if the ss-vs-native gap survives length-control. At analysis time, pool both arms' rows and regress (Dubois LC-style `2404.04475`; adaptive length-bins `2606.01629`):

```
content_score_i = β0 + β_arm · 1[arm_i = ss] + β_len · log(total_tokens_i) + ε_i
```
Report `β_arm` (the length-matched arm gap on content) with a **paired bootstrap 95% CI** (resample probes with replacement, keeping the within-probe ss/native pair together — reuse `scripts/vault-stats.mjs`). Run the same regression with `USD` as the outcome. **The headline number is `β_arm`, not the raw mean difference.**

Robustness twins (all pre-registered, none tuned-to):
- **Adaptive length-bin replication** (`2606.01629`): stratify pairs into ~3 `total_tokens` terciles; report the within-bin paired Δ. If the sign/significance disagrees with the regression, the regression's linearity assumption is suspect → report both, trust neither alone.
- **Quantile check:** also regress at the median (quantile regression) to guard against mean-pull by a few huge ss responses.

**This is symmetric and is the single decisive anti-gaming gate** (`feedback_format_gate_boosts` discipline). If the raw gap favors ss but `β_arm`'s CI includes 0, the "richness" was verbosity/shape → the claim is dropped. Phase-0 proves this can happen (native won go-002), which is exactly what makes the gate credible rather than ornamental.

---

## 5. Inputs / outputs (typed)

### 5.1 Capture (the required runner change — both prior docs flag it)
Vault runners persist scores, not text. To score tool responses we must persist them. **Add a capture stage** (not a re-architecture) that, per probe × arm, writes:
```
core/prompt-optimization/data/metric-forge/captures/<run-id>/<probe-id>.<arm>.json
{
  probeId, arm, runId,
  rawResponse: string,            # the exact bytes scored (R) — ss-* stdout, or native rg-lines+read-bytes
  toolCalls: [{name, command, ...}],   # provenance, for the native-competence audit & reproducibility
  ssTokensUsed: number|null,      # ss self-report when present (diagnostic only; NOT used in scoring)
  capturedAt, harness, seed
}
```
- **ss arm:** run the deployed policy (`Mpp.md`) bare-API agent restricted so its tool calls are ss-\* only; concatenate the verbatim ss-\* stdout for the probe. Reap daemons before/after; conc=1.
- **native arm:** see §5.2.

### 5.2 The native arm must be COMPETENT and frozen (fairness, failure-mode 5)
A naive single-`rg` native arm is a strawman that hands ss-\* an unearned win. The native capture is produced by a **fixed, documented native procedure** and frozen into the captures so it is auditable and reproducible:
- Run a bare-API agent with **only** native tools (`rg`/`grep`/`find` + `read`) under a neutral native policy (the deployed native baseline string), capped at the probe's `max_turns`, capturing its actual tool transcript as `R`. This is "what a real agent does with native tools," symmetric to the ss arm running a real policy.
- **Audit gate before scoring:** a reviewer (researcher) spot-checks 10 native captures to confirm they reformulated when the first query missed and read sufficient ranges (the Phase-0 competence bar). If a native capture is degenerate (1 rg, no read, on a probe the agent could have solved), it is re-run, not scored as-is. This audit is logged; it is the human guarantee that the comparison is not rigged against native.
- Frozen native captures are reused across `USD` re-scores so judge/rubric iteration never silently changes the native arm.

### 5.3 Output (per item)
```
core/prompt-optimization/data/metric-forge/scores/<run-id>/<probe-id>.<arm>.json
{
  probeId, arm, runId, rubricHash,
  USD: number ∈ [0,1],
  grounding: 0|1,
  D1,D2,D3,D4,D5: 0|1,            # panel-median per criterion
  signal_purity: 0|1,
  content: number,                # mean(D1..D5)
  purity_ratio: number,
  total_tokens, used_tokens,
  usedTokenByCriterion: {D1:n,...},
  citedSpans: {D1:[...], ...},    # verbatim, for audit/reproducibility
  panel: [{model,lineage,verdictByCriterion,input_tokens,output_tokens,isError}, x3],
  programmatic: {astComplete:bool, goldOverlap:float, ...},
  isNoMatch: bool
}
```
Aggregate report (`metric-forge/report-<run-id>.md`): per-arm mean USD + sub-scores; **`β_arm` length-matched gap (USD and content) with CI** (headline); per-stratum breakdown (literal-lookup / multi-file-flow / behavioral / no-match); the Layer-A κ table; the Layer-B correlation (§8); the two reliability-probe deltas (§9). Report N, seed, panel, rubricHash, cache-aware cost.

---

## 6. Anchor / calibration (Layer A) — gold sufficient-context, κ-gated

Per the locked decision (anchor = researcher's call) and `research.md` §2: hand-annotate **minimal sufficient context** gold spans `C^G` for a **frozen 24-probe stratified subset** (40% of 60), seed=42, stratified by the four strata (proportional: ~8 literal-lookup, ~6 multi-file-flow, ~6 behavioral, ~4 no-match). `C^G` = the set of `{file, startLine, endLine}` AST-block spans a competent engineer needs to fully answer the probe (ContextBench/SWE-ContextBench annotation primitive, `2602.05892`/`2602.08316`). The probes already ship `expectedFiles/Symbols/Facts` and a verifying `grep` in `notes`; gold spans are the thin line-range extension.

- **Annotate *sufficient*, not exhaustive** (mitigates multi-hop incompleteness, failure-mode 6). On multi-hop probes, record the minimal *combination*.
- **Calibration gate:** compute **Cohen's κ (binary criteria) / QWK** between each panelist and the gold-derived label, and panel-median-vs-gold. **Require κ ≥ 0.6 per dimension** before that dimension is load-bearing; a dimension below 0.6 is reported diagnostic-only (the 2026 production bar; SWE-PRBench κ=0.75). This is the standing reliability requirement; κ is reported, not raw accuracy ("κ is harder to fake").
- The remaining **36 probes are held-out**: aggregate-only, never inspected per-probe during design (`feedback_heldout_discipline_strict`). The κ calibration and any threshold sensitivity are read on the 24-probe gold/dev set only.

---

## 7. Judge protocol (verbatim)

### 7.1 Panel (disjoint families, median) — reuse the existing `JUDGE_PANEL`
```
deepseek-v4-flash      (lineage deepseek-api)   — DeepSeek DIRECT API (DEEPSEEK_API_KEY), never OpenRouter
gemini-3.1-flash-lite  (lineage google-api)
abab6.5s-chat          (lineage minimax)        — MiniMax family
```
Three disjoint families ⇒ family-specific self-preference/verbosity biases partially cancel; **per-criterion median** is robust to one outlier (matches `judgePanelScore`). **No Claude-family model is ever a sole judge** (workflow mandate). If a panelist errors after retries, median over the survivors; if all error, throw `AllJudgesFailedError` (existing behavior — never coerce to 0).

### 7.2 The rubric (verbatim — this string is hashed and frozen, §7.5)

> **System.** You are a strict, evidence-anchored grader of a CODE-SEARCH TOOL RESPONSE. You are NOT grading prose quality, length, or formatting. You are judging whether the returned code/context carries the signal an engineer needs to act on the query. A LONGER RESPONSE IS NOT BETTER. Score CONTENT, never length or style. For every criterion you mark 1, you MUST first quote the verbatim span of the response that satisfies it; if you cannot quote a span, the criterion is 0. Quote the smallest span that proves the criterion — do not quote the whole response.
>
> **You are given:** the QUERY; the GOLD (the minimal code spans / expected files+symbols+facts that answer it, or "no match expected"); and the RESPONSE (raw tool output, tool chrome removed). Judge the RESPONSE against the GOLD.
>
> **Score each criterion 0 or 1, citing a verbatim span before each 1:**
> 1. `answer_grounding` — Does the RESPONSE contain the SPECIFIC code or fact that ANSWERS the query (the gold answer span itself), not merely something near it or a pointer to it? (1 only if the answering code/fact is literally present.)
> 2. `workable_code` — Is EDIT-READY code present — a complete, runnable symbol body or snippet — rather than only a `file:line` pointer or a bare name? (1 only if you can quote a complete code block, not a reference.)
> 3. `navigability` — Does the RESPONSE make the RELEVANT NEIGHBORS reachable (callers, callees, related types, or the stated relation) well enough to understand the change site WITHOUT issuing another search? (1 only if you can quote the neighbor reference.)
> 4. `edit_locality` — Does the RESPONSE pin the SPECIFIC site (the function/region AND file) where an edit would go, not just the file? (1 only if you can quote a span that names the specific region.)
> 5. `sufficiency` — Could a competent engineer ACT NOW on this RESPONSE without searching again, judged against the GOLD (NOT against any self-reported "sufficient" flag in the response)? (1 only if the gold answer is fully covered.)
> 6. `signal_purity` — Is the RESPONSE FREE of content not needed for this query — no irrelevant code blocks, no unmarked false-positive matches, no duplicated or boilerplate filler? Dock this to 0 if the response pads, repeats, or includes matches that do not concern the query. This criterion penalizes BOTH a bloated multi-block dump AND an unfiltered match list full of unrelated hits. (1 only if essentially all of the response is on-target.)
>
> **Output ONLY this JSON:**
> `{"answer_grounding":{"span":"<verbatim>","v":0|1},"workable_code":{"span":"...","v":0|1},"navigability":{"span":"...","v":0|1},"edit_locality":{"span":"...","v":0|1},"sufficiency":{"span":"...","v":0|1},"signal_purity":{"span":"...","v":0|1}}`
> Use `"span":""` for any criterion you score 0.

### 7.3 Blinding & evidence-anchoring
- **Arm-blind:** the judge never sees `arm`. Tool chrome (`<<SS_ROUTE_META>>`, tier labels `full/preview/summary`, `confidence`/`sufficient` strings) is **stripped before judging** (§7.6) so structure/format cannot be read as "thoroughness" (format bias is the dominant judge bias, 0.76–0.92). Chrome is retained only for `total_tokens` and `purity_ratio`.
- **Span-before-score** is mandatory and machine-checked: a `v:1` with a span that is not a verbatim substring of `R` is **demoted to 0** programmatically (and logged). This is the RULERS evidence-verification mechanism and the anti-spoof for failure-mode 2.

### 7.4 Aggregation
Per-criterion median over the 3 panelists (§3). `used_tokens` is computed from the **panel-majority-cited** spans only (a span cited by just one panelist does not enter the density union). Programmatic gates (D2 tree-sitter, D4 gold-overlap) are applied AFTER the median and can only lower a criterion to 0, never raise it.

### 7.5 Locked rubric bundle (anti rubric-drift p-hacking — RULERS L5)
The rubric string + criteria list + θ_floor + panel + weights are concatenated and hashed with the existing `hashContent` into `rubricHash`, frozen per run-id. Any edit forces a new run-id; scores carry their `rubricHash`. No re-judging under an edited rubric within a run.

### 7.6 Chrome-stripping (deterministic, specified)
Before building the judge prompt, from the ss arm strip: the `<<SS_ROUTE_META>>...` line(s); leading `rank#N`/`[full]`/`[preview]`/`[summary]`/`confidence:`/`sufficient:` label tokens; and the file:line *header banner* lines that precede a code block (the code itself and a single `path:line` locator are KEPT — the locator is content an agent needs). From the native arm: nothing is stripped (rg `file:line:match` IS the content). The stripper is a pure function with unit tests (§10) and its output is what both the judge AND `estimateTokens(R)` for `used_tokens` see; `total_tokens` uses the UN-stripped bytes (chrome is real tokens the agent pays for — counting it in the denominator is the honest, anti-ss-favoring choice).

---

## 8. Validation plan (pre-registered) + falsification criterion

Pre-commit N, reps, panel, rubricHash, correlation threshold, and the falsifier BEFORE the powered run; git-tag the prereg (P7 `prereg/` pattern). Never inspect held-out per-probe.

1. **Capture both arms on the 60-probe vault** (`p7-vault-probes-v60.json`), seed=42, conc=1, native arm competence-audited (§5.2). Reap daemons between batches.
2. **Calibrate (Layer A, §6):** score on the 24-probe gold subset; report panel-vs-gold κ/QWK per dimension; **gate κ ≥ 0.6** or the dimension is diagnostic-only.
3. **Intrinsic comparison:** per-probe paired `USD` (ss vs native), per-dimension Δ, paired bootstrap CIs. **Headline = the length-matched residual `β_arm` (§4b), CI must exclude 0** for the gap to be credited.
4. **External validity (Layer B — the proof, the locked validity arbiter):** correlate per-probe `USD` (and the length-matched arm Δ) with the **task-completion bench's per-probe answer-fed-solver lift / resolve-delta** (`TASK_COMPLETION_BENCH_PLAN.md`). Report **Spearman ρ + Kendall τ + bootstrap CI**. Run the **substitution check** (Dietz 2025): does swapping `USD` for the bench's own gold-context-recall change system rankings? If not, `USD` is a faithful cheap proxy. *Sequencing note:* the task-completion bench is itself at pilot stage; until its per-probe lift exists, Layer B is run against the **answer-fed-solver sub-task** on the same 60 probes as the minimal viable external signal (the prior doc's §4.B protocol), and the SWE resolve-delta correlation is added when the bench produces it. The metric is **not declared valid** (only "calibrated") until Layer B's ρ CI excludes 0.
5. **Pre-committed N / power:** N = 60 probes × 2 arms, paired; ≥3 judge reps per response (judge is stochastic) with per-criterion majority across reps folded before the panel median (or report rep-variance). Significant only if the relevant CI excludes 0. No optional stopping; stop at N=60.

**Publishable claim shape:** "On N=60 vault probes (seed=42, 3-panel disjoint judges, κ=… ≥0.6 vs gold), ss-\* tool responses score Δ`USD` = X [CI lo,hi] over a competence-audited native arm **after length-matching** (`β_arm`), and per-probe `USD` predicts the task-completion answer-fed-solver lift at ρ=Y [CI]." Report held-out aggregate only at the milestone.

**FALSIFICATION (pre-committed — the thesis is REFUTED if EITHER):**
- **(a)** the **length-matched** Δ`USD` / `β_arm` CI **includes 0** — the apparent ss edge was verbosity/shape, not signal (Phase-0 shows this is live: native won go-002); OR
- **(b)** `USD` does **not** correlate with the downstream bench lift (ρ CI includes 0 or negative) — then `USD` is not a valid usefulness proxy regardless of how clean it looks, and per the NeurIPS-2025 rating-indeterminacy result we must not ship it as a decision metric.

We do NOT tune to a held-out failure; we fix the principle and re-run.

---

## 9. Standing reliability probes (controlled pairs — prove the metric reacts the right way)

Both run every milestone; both have pre-committed expected directions; both are scored by the SAME frozen pipeline.
- **Padding probe (anti-verbosity, the headline gaming direction):** take a correct *terse native* capture; append an irrelevant-but-real code block (a random symbol from the same repo). **Expect:** `signal_purity → 0`, `purity_ratio` drops, `USD` falls; D1–D5 unchanged. If `USD` rises or holds, the anti-padding mechanism is broken → block ship.
- **Truncation probe (anti-under-answering):** take a high-`USD` capture; mechanically cut to ~40%. **Expect:** `sufficiency`/`workable_code` → 0, `USD` falls. If `USD` holds, D5/D2 are not biting.
- **Threshold sensitivity:** re-report the headline `β_arm` at θ_floor ∈ {0.4,0.5,0.6}; if the sign flips on θ_floor the result is fragile → disclose.
- **Determinism / judge-stability** (`2604.16790`): re-run the panel on a 10-response sample; report verdict-flip rate per criterion; flag criteria with >20% flips as unstable.

---

## 10. Implementation map (drop-in, behind existing seams; no production search code touched)

- New `core/prompt-optimization/sweep/usd-metric.mjs`: `JUDGE_USD_SYSTEM_PROMPT` (§7.2 verbatim), `buildUsdJudgePrompt({probe, response, gold})`, `usdPanelScore()` (clone of `judgePanelScore`, returns per-criterion vectors + spans), `computeDensity({R, citedSpans})` (§4a, uses `estimateTokens`), `stripChrome(R, arm)` (§7.6), `scoreUSD({probe, response, gold, arm})` → the §5.3 object.
- Reuse: `JUDGE_PANEL`, `runJudge`, `normalizeJudgeUsage`, `parseJudgeScore`-analog, `hashContent`, `estimateTokens`, `scripts/vault-stats.mjs` (paired bootstrap + the §4b regression), the D2 tree-sitter symbol-completeness check from B1.5.
- Capture stage (§5.1/§5.2) extends the bare-API runner `p7-api-agent-runner.mjs` (already has Bash-read-only + Read; add the ss-only vs native-only tool gates + full-stdout persistence). Reap `cli.js --serve` / `index-maintainer.mjs` between batches; conc=1.
- **Unit tests (incl. gaming cases) — required before any real run:** (1) padding case → `purity_ratio` drops, `USD` falls; (2) truncation case → `sufficiency` drops; (3) span-not-substring → criterion demoted to 0; (4) D2 incomplete-AST span → D2=0 despite judge=1; (5) D4 non-overlapping span → D4=0; (6) terse-correct native → `purity_ratio≈1`, not penalized; (7) no-match probe → `USD=g`, density skipped; (8) all-judges-error → throws, not 0; (9) chrome-strip idempotence + native-untouched; (10) rubricHash changes on any rubric edit.

---

## 11. Weakest assumptions — explicit targets for the red-team / re-deriver

Ordered by how load-bearing × how likely to break:

1. **The `0.5 + 0.5·purity_ratio` shaper is a free parameter chosen by argument, not data.** Its job is to make density a *bounded shaper*, not the objective — but the `0.5` floor and the linear form are unjustified beyond "avoids the truncation-attack collapse." A red-teamer should ask: is there a padding strategy that keeps `purity_ratio` high while inflating `total_tokens` (e.g., padding *inside* a cited span's range so the union grows)? And: does the shaper let a genuinely-denser native arm get under-credited because ss's larger absolute `used_tokens` co-occurs with larger `total_tokens`? Consider whether density belongs in the scalar at all, vs. being purely an analysis-layer (§4b) quantity.
2. **`used_tokens` = union of judge-cited spans is only as good as the judges' citation behavior.** If panelists systematically cite minimal spans for native and generous spans for ss (or vice versa), the density is biased by judge habit, not content. The substring + gold-overlap checks constrain *correctness* of spans but not their *extent*. A re-deriver should consider a programmatic span definition (e.g., the gold-overlapping AST node) that removes judge discretion from the denominator entirely.
3. **Layer-B validity may be unobtainable on the needed timeline.** The task-completion bench is at pilot (Python-only, plumbing). If the per-probe resolve-delta does not exist, the metric stays "calibrated" but not "validated," and the falsifier (b) cannot be evaluated. The fallback (answer-fed-solver on the 60 probes) is itself an LLM-solver signal, not the SWE resolve-rate the thesis ultimately wants — a re-deriver should pressure-test whether that fallback is a strong enough arbiter or a circular one.
4. **The "competent native arm" is human-audited, not mechanized.** §5.2's spot-check (10 captures) is the fairness linchpin (failure-mode 5) and it is subjective + small. If the native agent under-reads on probes the auditor doesn't catch, ss wins unfairly and the whole headline is rigged. The red-team should attack the native-arm generation procedure specifically: is the native policy string a strawman? Is `max_turns` too tight for native but fine for ss?
5. **Binary criteria + majority-of-3 throws away gradation and can be brittle near boundaries.** A response that *almost* pins the site gets D4=0 just like one that names the wrong file; majority-of-3 binaries can flip on one judge. κ≥0.6 is required but κ on rare-positive criteria (e.g., navigability on probes with no neighbors) can be unstable / undefined.
6. **D2's tree-sitter "complete AST node" gate may disagree with "edit-ready" reality.** A complete symbol can still be useless (huge, truncated by the cap with `// …(N more lines)`), and an incomplete span can be perfectly actionable (a 3-line config constant). The programmatic-gates-judge rule could wrongly zero D2 for genuinely workable partial spans.
7. **`expectedNoMatch` special-casing (`USD=g`, density skipped) excludes 9/60 probes from the density/length-matched statistics** — a non-trivial fraction. If ss-\* behaves very differently on no-match (e.g., emits confident-but-wrong blocks), that risk is invisible to the headline `β_arm`. Is collapsing no-match to the floor the right call, or does it hide a gaming surface?
8. **Chrome-stripping asymmetry** (§7.6): we strip ss chrome but count it in `total_tokens`, and strip nothing from native. This is argued to be anti-ss-favoring, but a red-teamer could argue it double-penalizes ss (judge can't see the structure that genuinely aids navigability D3, yet ss still pays the token cost) OR that the `path:line` we keep is exactly the structured signal we claimed to strip — the keep/strip boundary is a judgment call that affects D3/D4 outcomes.
9. **Single rubric, single language of criteria, 18 languages of code.** κ and the criteria semantics ("complete symbol", "neighbor") may not transfer uniformly across C/Zig/Elixir/Scala; the gold annotation is one researcher's call on AST granularity that tree-sitter may chunk differently per grammar.

---

## 12. One-line summary
`USD` = a floor-gated (`grounding`), evidence-anchored, **binary** six-criterion score (D1 answer_grounding, D2 workable_code, D3 navigability, D4 edit_locality, D5 sufficiency, C signal_purity) where token-normalization is **two mechanisms**: (a) an in-scalar density *shaper* `0.5+0.5·(used_tokens/total_tokens)` that counts only judge-cited, substring-verified, gold-overlapping spans so padding inflates the denominator not the score, and (b) an analysis-only **length-matched regression residual `β_arm`** whose CI must exclude 0 before the ss-vs-native gap is credited — symmetric to both arms, with a human-audited competent native arm, calibrated on 24 gold probes (κ≥0.6) and validated against the task-completion bench (falsified if the length-matched gap CI includes 0 OR `USD` fails to predict the bench).
