# Metric Forge — Phase 3 FINAL HARDENED SPEC: the `USD` tool-response usefulness metric

**Author:** metric-designer (Opus), 2026-06-03 — post adversarial loop.
**Inputs reconciled:** `design.md` (the v1 spec), `redteam.md` (4 SHIP-BLOCKING + 7 ACCEPT-WITH-MITIGATION breaks; DeepSeek-V4-Pro + Gemini-3.1-pro external voices), `rederive.md` (independent re-derivation: architecture convergent; 1 REQUIRED change + 3 strongly-recommended; DIV-4 = AST-snapped denominator), `research.md`, `SKILL.md`, the harness.
**Status:** RUN-READY *after* the §13 implementation + reliability-probe gate passes. Every SHIP-BLOCKING break is resolved (not deferred). Residual accepted risks are enumerated in §12 with their disclosure plan.

> **What changed from v1 (the one-screen diff).** The red-team and re-deriver converged, from disjoint model families plus verified arithmetic, on a single crux: **the in-scalar density numerator was left to judge citation, which inverts the metric** (a whole-file dump gets `purity_ratio→1`). The fix is **DIV-4: `used_tokens` is now a deterministic, AST/gold-snapped programmatic quantity — the judge never sizes the denominator.** Three more SHIP-BLOCKERS are fixed: no-match is length-controlled (`B2`), token accounting is made symmetric and computed on the bytes the judge sees (`B3`), and the headline gap moves from an extrapolating OLS to **caliper-matched paired Δ on common support** (`B4`). D3 navigability is reframed as a disclosed *capability* axis, not a density claim (`B5`). The architecture (floor → six binary evidence-anchored dims → bounded density shaper + length-matched gap → two-layer anchor → pre-registered falsifier) is **unchanged and certified** by the independent re-derivation.

---

## 0. Locked decisions (honored verbatim; not re-litigated)

- **Intrinsic 0–1 score on the RAW TOOL RESPONSE** (the bytes a tool returns *before* the agent reasons), not the agent's final answer.
- **Validity = correlation with the task-completion bench** (`TASK_COMPLETION_BENCH_PLAN.md`); intrinsic for cheap reuse, extrinsic for proof.
- **Anchor = the researcher's call** — hand-annotated minimal-sufficient-context gold spans `C^G`.
- **Anti-gaming is the crux:** token-normalized / length-controlled, explicit no-padding counterweight, **symmetric to both arms**, the ss-vs-native gap **must survive length-matching**, never reward verbosity/format per se, never unfairly penalize a terse-but-sufficient native response.
- **DeepSeek ALWAYS via the direct API** (`DEEPSEEK_API_KEY`), never OpenRouter. **No Claude-family model is ever a sole judge.**
- **Full build on the 60-probe vault** (`core/prompt-optimization/data/frozen/p7-vault-probes-v60.json`); both arms' raw outputs captured. No commits; real runs only; reap orphaned `cli.js --serve` / `index-maintainer.mjs` between batches; conc=1.

Verified harness facts this spec binds to: `estimateTokens(text) = round(text.length/4)` (`variant-loader.mjs:68`); `JUDGE_PANEL = [{deepseek-v4-flash, deepseek-api}, {gemini-3.1-flash-lite, google-api}, {abab6.5s-chat, minimax}]` (`gepa-evaluate.mjs:166`); vault = 60 probes, strata `{literal-lookup:21, behavioral:16, multi-file-flow:14, no-match:9}`, each probe carries `{id, repo, language, stratum, difficulty, query, expectedFiles, expectedSymbols, expectedFacts, expectedNoMatch, max_turns, notes}`.

---

## 1. The object being scored

Per probe `p`, per arm `a`, the metric scores **one retrieval episode** `R` = the raw tool-response bytes that arm produced for that probe, with the arm label hidden from every scorer (§9.3). No downstream agent prose is scored. Two frozen, symmetric arms:

- **`ss` arm** — the verbatim stdout of the ss-* calls the deployed policy (`Mpp.md`) makes for the probe, restricted to ss-* tools, captured as emitted.
- **`native` arm** — a **competence-gated** native episode (`rg`/`grep`/`find` + `read`) produced by a real bare-API agent under the neutral native policy, capped at the probe's `max_turns`. Native competence is now **mechanically verified on all 60** (§6.3), not just human-spot-checked — this closes the strawman-native attack (`B-native`, red-team `B-fairness`/§11.4).

---

## 2. The metric at a glance (the whole function)

```
INPUT  (per probe p, per arm a):  R = raw tool response (string), arm label hidden from scorers
GOLD   (per probe p):             expected{Files,Symbols,Facts} (all 60) + C^G gold spans (all 60, §6)

FLOOR  (gate):   g  = grounding(R, gold) ∈ {0,1}                         # §3  — wrong/empty ⇒ USD := 0
CONTENT:         D1..D5 ∈ {0,1} each (panel-median), content = mean(D1..D5)   # §4
PURITY:          C  = signal_purity ∈ {0,1} (panel-median)                    # §4
DENSITY:         purity_ratio = used_tokens_AST / total_tokens ∈ (0,1]        # §5a  PROGRAMMATIC, AST/gold-snapped

# Standard (match/non-no-match) probes:
USD_raw = g · C · content
USD     = USD_raw · ( φ + (1−φ) · purity_ratio^α )        ∈ [0,1]             # §5a  φ=0.25, α=2 (pre-committed, §5c)

# no-match probes (§3.1):
USD     = g · max(0, 1 − total_tokens / τ)                                    # τ=400 tok, pre-committed

# Reported ALONGSIDE USD, never folded in (§7):
sub-scores = {g, D1..D5, C, content, purity_ratio}
content_noD3 = mean(D1,D2,D4,D5)         # the per-token-DENSITY claim rests on this; D3 is the capability axis (§4, B5)
tokens     = {total_tokens, used_tokens_AST, used_token_breakdown_per_criterion}
arm-gap    = caliper-MATCHED paired Δ of content / content_noD3 / USD on common token support  # §5b (the HEADLINE)
```

`USD` is the single 0–1 scalar; the sub-score vector + token counts ship with it (mirrors `relaxed-grading.mjs`; mandated by `project_gold_rubric_under_credits_correct_behavior`). **The headline comparative claim is NOT `mean(USD_ss) − mean(USD_native)`; it is the caliper-matched paired Δ on common support (§5b).** That separation is the anti-gaming crux.

---

## 3. The floor (gate): `grounding` — the existing correctness signal, unchanged

`USD` is conditional on correctness. Wrong file/symbol, hallucination, or empty ⇒ `g=0` ⇒ `USD=0`, regardless of density or formatting. Symmetric at the gate: a padded ss block naming the wrong symbol fails exactly like a native `rg` that matched the wrong file.

**Measurement (hybrid, binary `g ∈ {0,1}`):**
- **Programmatic pre-check (necessary, not sufficient):** `R` contains a path matching some `expectedFiles[i]` (suffix, case-insensitive) OR a token matching some `expectedSymbols[j]` (word-boundary). Inverted for `expectedNoMatch` probes (§3.1).
- **Judge confirmation:** the existing 3-panel `JUDGE_SYSTEM_PROMPT` (verbatim, `gepa-evaluate.mjs:183`) scores correctness in [0,1] via `judgePanelScore`. `g = 1` iff `panel_median_correctness ≥ θ_floor` AND the pre-check passes.
- **θ_floor = 0.5**, pre-registered, locked in the rubric hash (§9.5). Sensitivity sweep θ_floor ∈ {0.4, 0.5, 0.6} reported as robustness (§11), never tuned-to.

Reuse-verbatim rationale: the floor is the locked production correctness signal; reusing it guarantees `Δcorrectness` is measured by the *same* instrument as P7, making the "same accuracy" half of the thesis apples-to-apples. The grounding floor is the part both external adversaries praised; it is kept exactly.

### 3.1 `expectedNoMatch` probes (9/60) — now length-controlled (resolves SHIP-BLOCKER B2)

v1 collapsed no-match to `content:=g, purity_ratio:=1 ⇒ USD=g`, which awarded `USD=1` to a 15k-token "context bomb" that dodged the symbol regex (red-team B2, DeepSeek #1, Gemini #5 — independent). **Fixed:** a *correct* no-match response is near-empty or a canonical "no match" statement; a verbose dump is *not* a useful no-match answer.

- `g = 1` iff the response correctly supports "no confident match": **programmatic** — `R` asserts no high-confidence match on a fabricated symbol (ss `sufficient` is NOT `YES` on a fabricated symbol; native is empty/near-empty with no read of a fabricated location) AND **contains no fabricated-symbol code block presented as an answer** (a new explicit confident-false-positive check, resolving §11.7); AND the panel agrees (it sees `EXPECTED: no match`).
- **Score:** `USD = g · max(0, 1 − total_tokens / τ)`, `τ = 400` tokens (pre-committed). A terse-correct "nothing here" keeps `USD ≈ g`; a 15k dump collapses to 0.
- **No-match probes stay IN the density/length statistics** (you *can* length-control a no-match response — its ideal length is small and constant, which is exactly the comparison we want). They are also reported as a **named stratum** with a per-arm **no-match confident-false-positive rate**, so "ss emits confident-wrong blocks on no-match" is now visible, not hidden.

---

## 4. Content dimensions D1–D5 + `signal_purity` (binary, evidence-anchored)

Five content dimensions + one anti-padding counterweight, all **binary** (more stable κ, harder to game with verbosity; Autorubric `2603.00077`, RULERS `2601.08654`). Each is scored by the 3-panel judge under the verbatim rubric (§9.2) **with mandatory span-citation before the 0/1** (no quotable span ⇒ 0). The cited span is used for the v=1 decision and for audit; **it does NOT size the density denominator** (that is now programmatic — §5a, the DIV-4 fix).

| # | Dimension | Binary question | Measurement | Arm it can favor |
|---|---|---|---|---|
| D1 | `answer_grounding` | Does R contain the **specific code/fact that answers the query** (not merely point near it)? | judge + programmatic cross-check (cited span must overlap `C^G` or `expectedSymbols` def) | go-002: **native can win**, ss can lose (answer demoted to a summary line) |
| D2 | `workable_code` | Is **edit-ready code** present (runnable snippet / self-contained symbol body), not a `path:line` pointer or bare name? | **hybrid**, *relaxed* gate (B7): the cited span contains the symbol signature **AND ≥70% of the AST node's body lines** including the closing delimiter, OR a judge-confirmed self-contained editable region; a `// …(N more lines)` truncation marker **fails** D2 even on a "complete" node | ss edge; native earns it iff its `read` span includes a near-complete body |
| D3 | `navigability` | Are the **relevant neighbors reachable** (callers/callees/related types/the relation) **without another retrieval round**? | judge (cited span = the neighbor reference) | ss 1-hop graph / ss-trace; native earns it iff its rg lines already expose neighbors. **Disclosed capability axis, not a density claim (B5) — see below.** |
| D4 | `edit_locality` | Does R pin the **specific site** (function/region + file), not just the file? | **mostly programmatic**: cited span overlaps `C^G`'s file+line range (ContextBench precision, `2602.05892`); judge adjudicates only near-misses | both arms can earn it; separates "found the file" from "found the spot" |
| D5 | `sufficiency` | Could a competent engineer **act now without re-searching**, judged vs **gold** (NOT the tool's self-reported `sufficient`)? | judge, anchored to `C^G` recall | counterweight to C so the score is not monotone-decreasing in length |
| C | `signal_purity` | Is R **free of content not needed** for the query (no irrelevant blocks; no unmarked false-positive matches; no duplicated/boilerplate filler)? | judge, with the programmatic `purity_ratio` (§5a) as a corroborating covariate | **symmetric teeth**: docks ss for a low-relevance 5th result AND docks native for an unfiltered rg list full of false positives |

**Aggregation (the existing median-of-panel pattern):**
```
For each k ∈ {D1,D2,D3,D4,D5,C}:  k = median over the 3 panelists of their binary verdict   # majority vote ∈ {0,1}
content      = mean(D1, D2, D3, D4, D5)        # ∈ {0, .2, .4, .6, .8, 1}
content_noD3 = mean(D1, D2, D4, D5)            # the per-token-DENSITY claim rests on THIS (B5)
```
**programmatic-gates-judge** for D2/D4: if the AST/overlap check is *false*, the criterion is 0 regardless of the judge; if *true*, the judge majority decides (it may still dock a complete-but-truncated span). This makes D2/D4 maximally objective and minimally gameable.

**B5 — D3 is a CAPABILITY axis, disclosed, not a per-token-density claim (accepted-with-mitigation).** ss-* emits a 1-hop graph by construction; a native `rg`+`read` episode rarely surfaces callers/callees single-shot. So D3 is systematically higher for ss for a *real but non-density* reason. The length-matched gate (§5b) will not remove it because D3's advantage is uncorrelated with length. **Mitigation (binding):** the per-token-density headline rests on `content_noD3` + C; D3 is reported separately as a "single-shot navigability" advantage and its legitimacy is tied to Layer B (if D3-bearing responses predict downstream lift, the neighbor context is genuinely useful, not padding). The one-liner (§14) is reworded accordingly. This is the single most important honesty disclosure for a hostile reviewer.

---

## 5. Token-normalization / anti-verbosity — THE crux (two coupled mechanisms; neither is "score ÷ tokens")

A naive `score/tokens` rewards terseness blindly, breaks symmetry, and is itself gameable (LC-AlpacaEval truncation attack, `2404.04475`: naive length-correction pushed win-rate 3.7→25.9). We use two mechanisms.

### 5a. Span-attributed density — now PROGRAMMATIC and AST/gold-snapped (resolves SHIP-BLOCKER B1, DIV-4)

**The v1 break (unanimous, 3/3 independent reviewers — the crux).** v1 set `used_tokens = union of judge-cited spans`. For a function textually nested in a monolithic block, judges routinely cite the *enclosing* block as the "complete unit," so an ss arm dumping the whole 1200-line file gets `used_tokens = total_tokens ⇒ purity_ratio = 1.0` and *beats* the 12-line native answer it should lose to. The metric inverted into verbosity-rewarding. C did not save it (C is one binary judge call, correlated with the same generous citation).

**The fix (REQUIRED — adopted from rederive DIV-4 + red-team B1).** Remove judge discretion from the density *numerator*. `used_tokens` is computed **programmatically** from deterministic, boundary-snapped spans — the judge still cites for the v=1 decision and audit, but **cannot size the denominator**:

```
total_tokens   = estimateTokens(R_judge)                       # the bytes the judge SEES (stripped both arms — §5d, B3)
For each criterion k satisfied by the panel-MAJORITY:
    raw_span_k = the panel-majority-cited span (verbatim substring of R; else dropped+logged)
    snap_k     = clip(raw_span_k) to:
                   (a) the C^G gold range it overlaps, if any; ELSE
                   (b) the tree-sitter AST node that contains the matched expectedSymbol / cited identifier; ELSE
                   (c) the single physical line(s) of raw_span_k that lexically overlap an expectedSymbol/expectedFact token
    # (c) is the floor: a span citing no gold, no resolvable AST node, and no expected token contributes 0 tokens.
used_spans     = dedup-union of {snap_k}                       # overlapping snaps merged once
used_tokens_AST = estimateTokens(concat(used_spans))
purity_ratio   = clamp( used_tokens_AST / total_tokens , 0, 1 )      # ∈ [0,1]
```

Density shaping into the scalar (steeper than v1 — resolves B6):
```
USD_raw = g · signal_purity · content
USD     = USD_raw · ( φ + (1−φ) · purity_ratio^α )      with  φ = 0.25,  α = 2   (pre-committed, §5c)
```

Why each piece, now that the numerator is judge-proof:
- **Padding inflates `total_tokens` but never `used_tokens_AST`** (snapped spans are bounded by gold/AST node, not by what a judge feels like quoting) ⇒ `purity_ratio` falls ⇒ `USD` falls. The whole-file dump now scores `purity_ratio = (answer node tokens)/(whole file tokens) → ~0` and is *destroyed*, not rewarded. The "pad inside a cited span" attack (§11.1) also dies: you cannot pad inside a tree-sitter node boundary without breaking the node.
- **A terse native answer whose every token is a snapped span gets `purity_ratio ≈ 1`, NOT penalized for being short** — the explicit "never unfairly penalize a terse-but-sufficient native response" guarantee, as a formula. go-002 (native wins) lands correctly: native's ~195 tokens are the `Default` switch body ⇒ snapped span ≈ whole response ⇒ `purity_ratio ≈ 1`.
- **The shaper is a bounded multiplicative shaper in [φ, 1] = [0.25, 1], deliberately NOT the dominant term** (avoids the 1/tokens truncation-attack collapse). The steeper `φ=0.25, α=2` (vs v1's `0.5 + 0.5·pr`) ensures a 99%-padding-but-correct response can no longer floor at 0.5·USD_raw; at `purity_ratio=0.1` the multiplier is `0.25 + 0.75·0.01 = 0.2575`. `φ` and `α` are **selected on the gold/dev set by the padding reliability probe** (§5c), not by argument.

**Span-citation integrity (anti-spoof, RULERS):** a cited span only enters scoring if it is a verbatim substring of `R_judge` (programmatic exact-match; non-substring citations dropped + logged); for D1/D4 it must overlap `C^G`. This + the snapping is the full defense against the relevant-padding adversarial example (rederive Part C: "ss puts the gold span verbatim plus a large on-topic-redundant dump" — the redundant dump is on-topic but lives outside the gold/AST snap, so it inflates `total_tokens` only).

### 5b. Length-matched gap — caliper-MATCHED on common support (resolves SHIP-BLOCKER B4)

**The v1 break (Gemini-unique, verified).** v1 regressed `content_i = β0 + β_arm·1[ss] + β_len·log(total_tokens) + ε` and called `β_arm` the length-matched gap. But native averages ~200 tokens, ss ~2000; the `log(total_tokens)` supports barely overlap, so a single global `β_len` slope **extrapolates** into a region neither arm occupies and imputes counterfactuals. The bootstrap CI does not catch this (it is model-misspecification, not noise), so v1 could publish a "length-matched victory" built entirely on extrapolation.

**The fix (REQUIRED).** The headline gap is a **caliper-matched paired Δ on common support**, not an extrapolating regression:

1. **Common-support diagnostic FIRST, and the claim is gated on it.** Quantify the overlap of `log(total_tokens)` between arms (proportion of ss responses with ≥1 native response within the caliper, and vice versa). If overlap is poor (pre-committed: <40% of either arm on support), the within-arm gap is reported **"not length-matchable"** and the comparative claim is *withheld* — an honest, reportable outcome.
2. **Caliper matching.** Pair each ss response to native response(s) within a strict `log(total_tokens)` caliper (pre-committed caliper = 0.2 on natural log, ≈ ±22% tokens). ss responses with no in-caliper native partner are **dropped from the gap analysis** and reported as "off-support." Report the **matched paired Δ** of `content_noD3`, `content`, and `USD` with a **paired bootstrap 95% CI** (resample probes with replacement, keeping the within-probe ss/native pair together — `scripts/vault-stats.mjs`).
3. **Regression kept ONLY as a robustness twin, never the headline**, and only reported with per-bin per-arm N so empty cells are visible. The adaptive length-bin tercile twin (`2606.01629`) is computed on the *pooled* distribution; a bin with an empty arm cell is flagged, not pooled.
4. **Quantile (median) twin** to guard against mean-pull by a few huge ss responses.

**This is symmetric and is the single decisive anti-gaming gate.** If the raw gap favors ss but the matched paired Δ CI includes 0 (or the supports do not overlap enough to match), the "richness" was verbosity/shape → the claim is dropped. Phase-0 proves this can fire (native won go-002), which is what makes the gate credible. The matched Δ is reported on **`content_noD3` (the density claim)**, `content`, and `USD`; if they disagree, all three are reported and none is trusted alone.

### 5c. φ, α, τ, caliper, θ_floor — pre-committed parameters and how they are set (anti p-hacking)

Every free parameter is fixed **before** the powered run and locked in the rubric hash (§9.5):
- **`φ = 0.25`, `α = 2`** (density shaper). Selected on the **24-probe gold/dev subset** (§6) by the single requirement: the **padding reliability probe must drop `USD` by ≥ a pre-committed margin (≥0.30 absolute)** while leaving D1–D5 unchanged. If `(φ, α)` cannot meet that on dev, the shaper is demoted to analysis-only (DIV-2 fallback) — it never silently passes.
- **`τ = 400` tokens** (no-match length budget): a correct canonical "no match" + a one-line locator fits well under 400; chosen before any run.
- **caliper = 0.2** (natural-log token caliper for §5b matching), **min common-support = 40%**.
- **`θ_floor = 0.5`** (§3), with the {0.4,0.5,0.6} sweep as robustness.

These are read on the dev set only; the 36 held-out probes are aggregate-only (§6, `feedback_heldout_discipline_strict`). No optional stopping; stop at N=60.

### 5d. Symmetric token accounting + symmetric noise filter (resolves SHIP-BLOCKER B3)

**The v1 break (both faces, both externals, opposite directions — proving it is a non-neutral symmetry break).** v1 computed `total_tokens` on UN-stripped bytes but the judge saw STRIPPED bytes: (a) ss chrome inflated ss's denominator but could never enter `used_tokens` (judge can't cite what it can't see) ⇒ ss declared *less* dense on byte-identical content; (b) native stdout was stripped of *nothing*, so one stray `test_config.py` false-positive line the judge sees sets C=0 ⇒ native zeroed, while ss's analogous noise was stripped away before judging. The stripping laundered ss's noise and exposed native's.

**The fix (REQUIRED — make pre-processing symmetric and self-consistent):**
1. **`total_tokens` is computed on the SAME bytes the judge sees** (`R_judge`, stripped for both arms). You cannot count chrome you hide. This removes the ss double-penalty.
2. **Identical, documented artifact filter applied to BOTH arms** before judging: drop `Binary file … matches` lines and binary-match lines, dedup identical lines, and — symmetric to stripping ss tier labels — drop nothing that is *content*. Native's incidental noise is treated like ss's: if it is a genuine match line it stays and `signal_purity` may dock it (symmetric teeth); if it is a non-content artifact (binary-match notice) it is filtered for both.
3. **The 1-hop graph decision is made explicitly and consistently:** the graph's `file:line → symbol` references ARE navigability signal (they earn D3), so they are **kept and visible to the judge and counted in `total_tokens`** (not stripped). Only true chrome — the `<<SS_ROUTE_META>>` machine line, the `confidence:`/`sufficient:` self-report strings, and the rank/tier *label tokens* (`rank#N`, `[full]`/`[preview]`/`[summary]`) — is stripped from ss. A single `path:line` locator before a code block is content and is KEPT for both arms. The v1 "strip-but-count" worst-of-both is gone.
4. **`R_judge` (the post-strip, post-filter bytes) is the single canonical object**: the judge sees it, `total_tokens = estimateTokens(R_judge)`, and `used_tokens_AST` snaps spans within it. One object, no asymmetric accounting.

`stripChrome`/`artifactFilter` are pure functions with unit tests (§13) including idempotence and a "native code is never dropped" assertion. D3 is additionally reported under both kept-graph and stripped-graph as a sensitivity twin (§12, rederive §11.8): if ss's navigability edge only appears with the graph visible, that is disclosed as partly-format.

---

## 6. Anchor / calibration (Layer A) — gold sufficient-context, κ-gated

Per the locked decision and `research.md` §2: hand-annotate **minimal sufficient context** gold spans `C^G` = `{file, startLine, endLine}` AST-block spans a competent engineer needs to fully answer the probe (ContextBench/SWE-ContextBench primitive, `2602.05892`/`2602.08316`). The probes already ship `expectedFiles/Symbols/Facts` + a verifying `grep` in `notes`; `C^G` is the thin line-range extension.

**Change from v1 (adopted from rederive DIV-1 + B-coverage): annotate `C^G` on ALL 60 probes, not 24.** The red-team's B4 (no `C^G` on the 36 held-out ⇒ unanchored signal_purity / D1 / D4 there — DeepSeek #4) and the Layer-B power concern (rederive B.3.1) both require gold on the full set. Annotation cost is small (line ranges over fields that already exist). The **dev/held-out discipline is preserved by inspection rule, not by annotation coverage**:
- **24-probe stratified gold/dev subset** (40% of 60, seed=42, stratified proportional: ~8 literal-lookup, ~6 behavioral, ~6 multi-file-flow, ~4 no-match): used for κ calibration, parameter selection (§5c), and per-probe inspection.
- **36-probe held-out:** `C^G` annotated (so D1/D4/density are anchored everywhere) but **aggregate-only, never inspected per-probe during design** (`feedback_heldout_discipline_strict`).
- **Annotate *sufficient*, not exhaustive** (multi-hop incompleteness mitigation); on multi-hop probes record the minimal *combination*.
- **Second-annotator spot-check** on ≥2 languages of the AST-granularity calls; report annotator agreement on the gold spans themselves (B11).

**Calibration gate (κ):** compute **Cohen's κ** (binary criteria) between each panelist and the gold-derived label, and panel-median-vs-gold, per dimension. **Require κ ≥ 0.6** before a dimension is load-bearing; below 0.6 ⇒ diagnostic-only. **κ is reported with its bootstrap CI and the positive-class count per dimension** (B9): pre-commit a **minimum positive-N = 8** below which κ is "insufficient data," not "failed"; report **prevalence-adjusted κ (PABAK)** alongside raw κ; stratify κ by criterion-applicability (only score D3 where the gold actually has neighbors). Pre-register which criteria are expected rare-positive per stratum (e.g., D3 on literal-lookup) so a low κ there is anticipated.

### 6.3 The native arm must be COMPETENT, MECHANICALLY verified, and frozen (resolves the fairness break)

A strawman native arm rigs the headline. v1 used a 10-capture human spot-check; the red-team (B-fairness/§11.4) and rederive (B.3.5, ruled "ship-blocker for the COMPARATIVE claim") demand mechanization. **Fixed:**
- Native captures are produced by a bare-API agent with **only** native tools (`rg`/`grep`/`find` + `read`) under the **frozen, documented neutral native policy string** (persisted with the run), capped at the probe's `max_turns`, full tool transcript persisted (`toolCalls`).
- **Mechanized competence gate on ALL 60:** for each native capture, compute the **gold-recall of the *read* bytes** = `|read_span ∩ C^G| / |C^G|`. If a capture's read-gold-recall is below a pre-committed floor **on a probe whose gold is reachable**, it is **auto-flagged for re-run** before scoring. This turns the fairness linchpin from "auditor catches it" into "metric catches it, auditor confirms."
- **Human confirmation** of the auto-flagged set + a 10-capture spot-check, logged. `max_turns` parity with ss is verified (same cap both arms).
- Frozen native captures are reused across re-scores so judge/rubric iteration never silently changes the native arm.

---

## 7. Outputs (typed)

### 7.1 Capture (`core/prompt-optimization/data/metric-forge/captures/<run-id>/<probe-id>.<arm>.json`)
```
{ probeId, arm, runId, rawResponse, R_judge,            # rawResponse = pre-strip; R_judge = post-strip+filter (the scored bytes)
  toolCalls:[{name,command,...}], ssTokensUsed|null,    # ssTokensUsed = diagnostic only, NOT used in scoring
  readGoldRecall|null,                                   # native competence gate (§6.3)
  capturedAt, harness, seed, nativePolicyHash|null }
```
### 7.2 Score (`core/prompt-optimization/data/metric-forge/scores/<run-id>/<probe-id>.<arm>.json`)
```
{ probeId, arm, runId, rubricHash,
  USD, grounding:0|1, D1..D5:0|1, signal_purity:0|1,
  content, content_noD3, purity_ratio,
  total_tokens, used_tokens_AST, usedTokenByCriterion:{D1:n,...},
  citedSpans:{D1:[...],...}, snappedSpans:{D1:[...],...},   # both, for audit (raw cite vs AST-snap)
  panel:[{model,lineage,verdictByCriterion,input_tokens,output_tokens,isError}, x3],
  programmatic:{astBodyFraction:float, goldOverlap:float, confidentFalsePositive:bool},
  isNoMatch:bool }
```
### 7.3 Aggregate report (`core/prompt-optimization/data/metric-forge/report-<run-id>.md`)
Per-arm mean USD + sub-scores; **the §5b caliper-matched paired Δ on `content_noD3` / `content` / `USD` with CI + the common-support diagnostic (the HEADLINE)**; the regression + length-bin + quantile robustness twins with per-bin per-arm N; per-stratum breakdown (literal-lookup / behavioral / multi-file-flow / no-match); per-language Δ for D2/D4 (B11); the no-match confident-false-positive rate per arm; the Layer-A κ table (with CI, positive-N, PABAK); the **per-dimension correlation matrix** (rederive B.3.3 — flag dims with ρ>0.9 for v2 merge); the Layer-B correlation (§8); the reliability-probe deltas (§11); the tokenizer-fidelity check (§12). Report N, seed, panel, rubricHash, cache-aware cost.

---

## 8. Validation plan (pre-registered) + falsification

Pre-commit N, reps, panel, rubricHash, parameters (§5c), correlation threshold, and the falsifier BEFORE the powered run; git-tag the prereg (P7 `prereg/` pattern; **prereg artifact, NOT a commit of results**). Never inspect held-out per-probe.

1. **Capture both arms on the 60-probe vault**, seed=42, conc=1, native arm mechanically competence-gated (§6.3). Reap daemons between batches.
2. **Calibrate (Layer A, §6):** panel-vs-gold κ/PABAK + CI + positive-N per dimension on the 24-probe gold/dev subset; gate κ ≥ 0.6 or diagnostic-only. Select `(φ, α)` via the padding probe (§5c).
3. **Intrinsic comparison:** per-probe paired `USD`, per-dimension Δ, **headline = the §5b caliper-matched paired Δ on common support (CI must exclude 0), reported on `content_noD3` first**.
4. **External validity (Layer B — the proof):** correlate per-probe `USD` (and the matched arm Δ) with the task-completion bench's per-probe answer-fed-solver lift / resolve-delta (`TASK_COMPLETION_BENCH_PLAN.md`). Report **Spearman ρ + Kendall τ + bootstrap CI**; run the **substitution check** (Dietz 2025: does swapping `USD` for the bench's own gold-context-recall change system rankings?).
   - **De-circularization (resolves B8 — verified live: the bench solver is `deepseek-v4-pro`, the USD panel includes `deepseek-v4-flash`):** for the Layer-B answer-fed-solver, use a solver from a family **NOT on the USD panel** (OpenAI or Anthropic solver), OR hold DeepSeek out of the USD panel for the validation run. The shared-DeepSeek correlation is reported only as a flagged secondary.
   - **Length-control Layer B too (rederive B.3.2):** regress solver-success on `log(response_tokens)`; a USD↔solver correlation that vanishes under length-control is the verbosity confound re-entering at the validity layer and is disclosed as such.
   - **Power / MDE pre-commit (rederive B.3.1):** state the detectable ρ at N=60 (≈51 after no-match for density-coupled analyses); pre-commit a **ρ threshold (lower-CI ≥ 0.3), not merely ≠0**, and **accept "inconclusive at N=60" as a real, reportable outcome** (inherited from the task-completion plan's discipline).
5. **Pre-committed N / power:** N = 60 × 2 arms, paired; ≥3 judge reps per response (per-criterion majority across reps folded before the panel median; report rep-variance). Significant only if the relevant CI excludes 0. No optional stopping.

**Validity labeling (resolves B8 timeline + rederive label discipline):** the metric is **"calibrated, not validated"** until Layer B's ρ CI excludes the threshold **against the execution-grounded F2P∧P2P resolve-delta**. Until the bench produces per-probe resolve-deltas, Layer B runs against the **off-panel-solver answer-fed-solver on the 60 probes** as the minimal external signal, reported as **"provisional validity"** only. The word "validated" is reserved for the deterministic-bench correlation.

**FALSIFICATION (pre-committed — the thesis is REFUTED if EITHER):**
- **(a)** the **caliper-matched** Δ (on `content_noD3` / `USD`) CI **includes 0**, OR the arms **lack common token support** to match — the apparent ss edge was verbosity/shape, not per-token signal (Phase-0 shows this is live: native won go-002); OR
- **(b)** `USD` does **not** predict the downstream bench lift (ρ lower-CI < 0.3, or negative) under length-control — then `USD` is not a valid usefulness proxy and per the NeurIPS-2025 rating-indeterminacy result we must not ship it as a decision metric.

We do NOT tune to a held-out failure; we fix the principle and re-run.

**Publishable claim shape:** "On N=60 vault probes (seed=42, 3-panel disjoint judges, κ=… ≥0.6 vs gold), ss-* tool responses score a caliper-matched paired Δ`content_noD3` = X [CI lo,hi] over a mechanically-competence-gated native arm on common token support; ss additionally provides a single-shot navigability (D3) advantage of Y; per-probe `USD` predicts the task-completion answer-fed-solver lift at ρ = Z [CI] (provisional pending the F2P∧P2P resolve-delta)." Held-out aggregate only at the milestone.

---

## 9. Judge protocol (verbatim)

### 9.1 Panel — reuse the existing `JUDGE_PANEL` (disjoint families, median)
```
deepseek-v4-flash      (lineage deepseek-api)   — DeepSeek DIRECT API (DEEPSEEK_API_KEY), never OpenRouter
gemini-3.1-flash-lite  (lineage google-api)
abab6.5s-chat          (lineage minimax)
```
Per-criterion median over 3 disjoint families ⇒ family-specific self-preference/verbosity biases partially cancel; one outlier cannot flip a criterion. **No Claude-family model is ever a sole judge.** Panelist error after retries ⇒ median over survivors; all error ⇒ throw `AllJudgesFailedError` (existing behavior — never coerce to 0). **For the Layer-B validation run, DeepSeek is held out of the panel (or the solver is off-panel)** per §8.

### 9.2 The rubric (verbatim — hashed and frozen, §9.5)

> **System.** You are a strict, evidence-anchored grader of a CODE-SEARCH TOOL RESPONSE. You are NOT grading prose quality, length, or formatting. You are judging whether the returned code/context carries the signal an engineer needs to act on the query. A LONGER RESPONSE IS NOT BETTER; a longer response that buries the answer is WORSE. Score CONTENT, never length or style. For every criterion you mark 1, you MUST first quote the **smallest** verbatim span of the response that proves it — do NOT quote an enclosing block when a tighter span proves the criterion, and do NOT quote the whole response. If you cannot quote a span, the criterion is 0.
>
> **You are given:** the QUERY; the GOLD (the minimal code spans / expected files+symbols+facts that answer it, or "no match expected"); and the RESPONSE (raw tool output, tool chrome removed). Judge the RESPONSE against the GOLD.
>
> **Score each criterion 0 or 1, citing the smallest verbatim span before each 1:**
> 1. `answer_grounding` — Does the RESPONSE contain the SPECIFIC code or fact that ANSWERS the query (the gold answer span itself), not merely something near it or a pointer to it? (1 only if the answering code/fact is literally present.)
> 2. `workable_code` — Is EDIT-READY code present — a complete or near-complete (signature + body) runnable symbol, not only a `file:line` pointer or a bare name? A span ending in a truncation marker like `// …(N more lines)` is NOT edit-ready. (1 only if you can quote a runnable code block.)
> 3. `navigability` — Does the RESPONSE make the RELEVANT NEIGHBORS reachable (callers, callees, related types, or the stated relation) well enough to understand the change site WITHOUT issuing another search? (1 only if you can quote the neighbor reference.)
> 4. `edit_locality` — Does the RESPONSE pin the SPECIFIC site (the function/region AND file) where an edit would go, not just the file? (1 only if you can quote a span that names the specific region.)
> 5. `sufficiency` — Could a competent engineer ACT NOW on this RESPONSE without searching again, judged against the GOLD (NOT against any self-reported "sufficient" flag in the response)? (1 only if the gold answer is fully covered.)
> 6. `signal_purity` — Is the RESPONSE FREE of content not needed for this query — no irrelevant code blocks, no unmarked false-positive matches, no duplicated or boilerplate filler? Dock this to 0 if the response pads, repeats, or includes matches that do not concern the query. This criterion penalizes BOTH a bloated multi-block dump AND an unfiltered match list full of unrelated hits. (1 only if essentially all of the response is on-target.)
>
> **Output ONLY this JSON:**
> `{"answer_grounding":{"span":"<verbatim>","v":0|1},"workable_code":{"span":"...","v":0|1},"navigability":{"span":"...","v":0|1},"edit_locality":{"span":"...","v":0|1},"sufficiency":{"span":"...","v":0|1},"signal_purity":{"span":"...","v":0|1}}`
> Use `"span":""` for any criterion you score 0.

### 9.3 Blinding & evidence-anchoring
- **Arm-blind:** the judge never sees `arm`; it sees only `R_judge` (§5d). Chrome stripped per §5d so structure/format cannot be read as "thoroughness" (format bias is the dominant judge bias, 0.76–0.92).
- **Span-before-score** is mandatory and machine-checked: a `v:1` with a span that is not a verbatim substring of `R_judge` is **demoted to 0** programmatically (and logged). The span does NOT size the density denominator (§5a).

### 9.4 Aggregation
Per-criterion median over the 3 panelists. `used_tokens_AST` is computed from the **panel-majority-cited** spans, **AST/gold-snapped** (§5a) — a span cited by one panelist alone does not enter; even a unanimously-cited generous span is clipped to its snap. Programmatic gates (D2 ≥70%-body, D4 gold-overlap) apply AFTER the median and can only lower a criterion to 0.

### 9.5 Locked rubric bundle (anti rubric-drift p-hacking — RULERS L5)
The rubric string + criteria list + `θ_floor` + `φ` + `α` + `τ` + caliper + panel + the D2 body-fraction threshold are concatenated and hashed with `hashContent` into `rubricHash`, frozen per run-id. Any edit forces a new run-id; scores carry their `rubricHash`. No re-judging under an edited rubric within a run.

---

## 10. Anti-gaming guarantees (explicit + testable — the deliverable's core)

Each guarantee names the mechanism, the arm it protects, and the **unit test / reliability probe that proves it** (all required-green before the powered run; §13).

| # | Guarantee | Mechanism | Testable proof |
|---|---|---|---|
| **G1 — Verbosity is never rewarded (the headline guarantee).** Appending real-but-irrelevant code to a correct response must LOWER `USD`. | §5a programmatic AST/gold-snapped `used_tokens_AST` (padding cannot enter the numerator) + steeper shaper `φ=0.25,α=2` + §5b matched gap drops a verbosity-only edge. | **Padding reliability probe (run on BOTH arms):** take a correct terse capture, append an irrelevant real symbol ⇒ `signal_purity→0`, `purity_ratio` drops, `USD` drops by ≥0.30; D1–D5 unchanged. Block ship if `USD` rises or holds. |
| **G2 — Terse-but-sufficient native is never penalized.** A short native answer where every token does work scores `purity_ratio≈1`. | §5a: snapped span ≈ whole response ⇒ ratio≈1; the shaper multiplier ≈1. | **Unit test:** terse-correct native capture ⇒ `purity_ratio ≥ 0.9`, `USD = USD_raw·(≈1)`; NOT penalized vs a longer same-content response. (go-002 native fixture.) |
| **G3 — The gap survives length-matching or it is dropped.** | §5b caliper-matched paired Δ on common support; common-support gate; CI-excludes-0. | **Stats unit test:** synthetic arms with disjoint token support ⇒ pipeline reports "not length-matchable," withholds the claim (does NOT extrapolate). |
| **G4 — Symmetric to both arms.** Both arms scored on identical `R_judge`, identical artifact filter, identical token denominator; same noise teeth (C docks both); native can win. | §5d symmetric accounting; §3 symmetric floor; Phase-0 go-002 native win. | **Unit tests:** byte-identical content in ss vs native formatting ⇒ equal `purity_ratio` and equal `USD` (B3 regression); native-code-never-dropped assertion. |
| **G5 — Format/structure cannot buy score.** Chrome, tier labels, confidence strings stripped before judging and removed from `total_tokens`. | §5d; §9.3 blinding. | **Unit test:** `stripChrome` idempotence + label-removal + `path:line`-kept + graph-kept; a response that differs from another ONLY in chrome scores identically. |
| **G6 — Under-answering is penalized (no terseness reward loophole).** | D1/D2/D5 anchored to gold; truncation marker fails D2. | **Truncation reliability probe (BOTH arms):** cut a high-`USD` capture to ~40% ⇒ `sufficiency`/`workable_code`→0, `USD` falls. |
| **G7 — Citation cannot be spoofed.** | §5a substring check + D1/D4 gold-overlap + AST snap. | **Unit tests:** span-not-substring ⇒ criterion 0; cite-the-whole-file ⇒ snapped to answer node ⇒ `used_tokens_AST` ≈ answer node, NOT whole file (the B1 regression test). |
| **G8 — No-match cannot be won by a context bomb.** | §3.1 `USD=g·max(0,1−tok/τ)` + confident-false-positive check. | **Unit test:** 15k-token no-match dump ⇒ `USD≈0`; terse-correct no-match ⇒ `USD≈g`. |
| **G9 — Anchor/rubric/params cannot drift mid-run (no p-hacking).** | §9.5 hashed bundle incl. φ/α/τ/caliper/θ_floor; pre-committed N; CI-excludes-0; held-out never inspected. | **Unit test:** any rubric/param edit changes `rubricHash`; held-out inspection guard. |
| **G10 — The validity correlation is not a verbosity artifact and not circular.** | §8 length-controlled Layer B + off-panel solver. | **Reported:** USD↔solver ρ before and after length-control; DeepSeek held out of one side. A ρ that vanishes under length-control is disclosed as the confound. |

**The anti-verbosity guarantee in one sentence (testable):** *a response that adds any token not inside a gold/AST-snapped answering span raises `total_tokens` but never `used_tokens_AST`, so `purity_ratio` and therefore `USD` strictly decrease — verified by the padding probe on BOTH arms dropping `USD` by ≥0.30, by the byte-identical-content symmetry test, and by the whole-file-cite snapping test, all required-green before the run.*

---

## 11. Standing reliability probes (controlled pairs — pre-committed directions, scored by the frozen pipeline, run BOTH arms — rederive DIV-5)

- **Padding probe (G1):** correct terse capture + appended irrelevant real block ⇒ `signal_purity→0`, `purity_ratio` drops, `USD` drops ≥0.30; D1–D5 unchanged. Used to **select `(φ,α)`** (§5c). Run on an ss capture AND a native capture.
- **Truncation probe (G6):** high-`USD` capture cut to ~40% ⇒ `sufficiency`/`workable_code`→0, `USD` falls. Both arms.
- **Whole-file-cite probe (G7/B1 regression):** an ss capture that returns the answer inside a monolithic file block ⇒ `used_tokens_AST` snaps to the answer node, `purity_ratio` low, the dump does NOT beat the terse answer. This is the explicit test that the crux break is fixed.
- **Threshold sensitivity:** re-report the headline matched Δ at θ_floor ∈ {0.4,0.5,0.6}; sign flip ⇒ fragile, disclose.
- **Determinism / judge-stability (`2604.16790`):** re-run the panel on a 10-response sample; report per-criterion verdict-flip rate; flag >20% flips as unstable. (Span-extent bias is moot now that `used_tokens` is programmatic — B10 subsumed by B1's fix.)

---

## 12. Residual accepted risks (disclosed, monitored — NOT ship-blocking)

These survive into the run with an explicit disclosure/monitoring plan; none inverts the metric or invalidates the headline once §5a/§5b/§5d/§6.3 are in.

1. **B5 — D3 navigability is a capability advantage, not per-token density.** *Mitigation (binding):* the density headline rests on `content_noD3`+C; D3 reported separately and tied to Layer B; one-liner reworded (§14). A reviewer who wants "ss has a call graph, which we knew" is answered honestly — the density claim does not depend on D3.
2. **B6 — the shaper floor still caps padding penalty at `φ=0.25`.** *Mitigation:* `φ`/`α` are data-selected on the padding probe (§5c), not argued; once B1 is fixed (programmatic numerator), padding cannot keep `purity_ratio` high regardless of the floor, so this is the tuning, not a hole.
3. **B7 — D2's body-fraction gate may still mis-rule edge cases** (a 3-line config constant; a huge complete symbol). *Mitigation:* relaxed to "≥70% body OR judge-confirmed self-contained region; truncation marker fails"; native arm is agentic and prompted to read full ranges; report D2 per-language base rates.
4. **B8 — Layer-B circularity + timeline.** *Mitigation:* off-panel solver, length-controlled Layer B, "validated" reserved for the F2P∧P2P resolve-delta; "provisional validity" labeling until then; "inconclusive at N=60" accepted.
5. **B9 — κ unstable on rare-positive criteria.** *Mitigation:* κ + CI + positive-N + PABAK + applicability-stratified + pre-registered rare-positive expectations + min positive-N=8.
6. **B11 — single rubric across 18 languages; AST granularity varies per grammar; 5 OOD languages (Dart/Elixir/Lua/Scala/Zig) use the regex-fallback chunker (no tree-sitter grammar) — so the D2/D4 AST snap degrades to the line-level floor (§5a clause (c)) there.** *Mitigation:* report Δ and κ stratified by language; the AST-snap floor (clause c) is deterministic even without a grammar, so the metric does not crash on OOD languages — it just snaps to gold/expected-token lines; disclose lower-confidence languages; second-annotator spot-check on ≥2 languages.
7. **Tokenizer fidelity (rederive B.3.4):** `estimateTokens = len/4` mis-estimates code per arm. *Mitigation:* report `purity_ratio` under `len/4` AND a real BPE tokenizer on a sample; confirm per-arm bias < a pre-committed tolerance. Internal consistency (same estimator both arms) is preserved regardless.
8. **Per-dimension collinearity (rederive B.3.3):** D5/C/`purity_ratio` may be three handles on one verbosity axis; D1/D5 may be near-collinear. *Mitigation:* report the per-dimension correlation matrix as a standing diagnostic; pre-commit to merging dims with empirical ρ>0.9 in v2 (simpler, less double-counting) — a v2 simplification, not a v1 blocker.
9. **DIV-2 — in-scalar density vs analysis-only.** *Mitigation:* report `USD` with AND without the density shaper; if the shaper never moves a verdict, drop it in v2; if it does, that movement must itself survive length-control. Cheap robustness twin, not a redesign.

---

## 13. Implementation map (drop-in, behind existing seams; no production search code touched)

- New `core/prompt-optimization/sweep/usd-metric.mjs`: `JUDGE_USD_SYSTEM_PROMPT` (§9.2 verbatim), `buildUsdJudgePrompt({probe, R_judge, gold})`, `usdPanelScore()` (clone of `judgePanelScore`, per-criterion vectors + spans), `stripChrome(R, arm)` + `artifactFilter(R, arm)` → `R_judge` (§5d, symmetric, pure, unit-tested), `snapSpan(rawSpan, {goldSpans, astNode, expectedTokens})` (§5a AST/gold-snap, the DIV-4 numerator), `computeDensity({R_judge, snappedSpans})` (§5a), `scoreUSD({probe, R_judge, gold, arm})` → the §7.2 object, `scoreNoMatch(...)` (§3.1).
- Reuse: `JUDGE_PANEL`, `runJudge`, `normalizeJudgeUsage`, `hashContent`, `estimateTokens`, `scripts/vault-stats.mjs` (extend with the §5b caliper matcher + common-support diagnostic + paired bootstrap; regression/length-bin/quantile as robustness twins), the tree-sitter symbol-completeness / AST-node check (B1.5 lineage; the regex-fallback floor for the 5 OOD grammars).
- Capture stage (§6.1/§6.3) extends `p7-api-agent-runner.mjs` (already Bash-read-only + Read): add ss-only vs native-only tool gates, full-stdout persistence, and the native `readGoldRecall` competence gate. Reap `cli.js --serve` / `index-maintainer.mjs` between batches; conc=1.
- **Required-green unit/gaming tests before any real run** (each maps to a §10 guarantee): (1) padding → `USD` drops ≥0.30 [G1]; (2) truncation → `sufficiency` drops [G6]; (3) span-not-substring → criterion 0 [G7]; (4) **whole-file cite → `used_tokens_AST` snaps to answer node, dump does NOT beat terse answer [G7/B1 — the crux regression]**; (5) D2 truncation-marker span → D2=0 [G6]; (6) D4 non-overlapping span → D4=0; (7) terse-correct native → `purity_ratio≥0.9`, not penalized [G2]; (8) **byte-identical content ss-vs-native → equal `purity_ratio` and `USD` [G4/B3]**; (9) no-match 15k dump → `USD≈0`; terse no-match → `USD≈g` [G8]; (10) **disjoint-support synthetic arms → "not length-matchable", claim withheld [G3/B4]**; (11) chrome-strip idempotence + native-code-never-dropped [G5]; (12) `rubricHash` changes on any rubric/param edit [G9].

---

## 14. One-line summary (reworded for the B5 honesty disclosure)

`USD` = a floor-gated (`grounding`), evidence-anchored, **binary** six-criterion score where the density numerator `used_tokens_AST` is now a **deterministic AST/gold-snapped programmatic quantity (not judge-sized)** so padding inflates only the denominator; the in-scalar shaper `0.25 + 0.75·purity_ratio²` is a bounded, data-tuned anti-verbosity multiplier; the **headline comparative claim is a caliper-matched paired Δ on common token support (CI must exclude 0, claim withheld if the arms don't overlap)** computed on **`content_noD3`** so the per-token-density claim rests on answer/code/locality/sufficiency+purity while ss's **single-shot navigability (D3) is disclosed as a separate capability advantage**; token accounting is **symmetric** (both arms scored on the identical stripped+filtered `R_judge`, same denominator, same noise teeth, native can and does win — go-002); the native arm is **mechanically competence-gated on all 60**; calibrated on gold spans annotated for all 60 with a 24/36 dev/held-out inspection split (κ≥0.6, PABAK, positive-N); and **validated** (provisional until the execution-grounded F2P∧P2P resolve-delta, off-panel solver, length-controlled Layer B) against the task-completion bench — **refuted if the matched Δ CI includes 0 or the arms lack common support, OR if `USD` fails to predict the bench under length-control.**
