# Metric Forge — Phase 5 RESULTS: the `USD` tool-response usefulness metric, run on the vault

**Author:** metric-implementer (Opus), 2026-06-03. Implements + runs
`core/prompt-optimization/data/metric-forge/final-spec.md`. Real runs only; no
fake data; nothing committed; DeepSeek always direct; conc=1; daemons reaped
between batches (0 orphans at finish).

> **Headline in one line.** At matched size the per-token signal-density edge of
> ss-* over native **does NOT survive length-control** (caliper-matched paired
> `content_noD3` Δ = **+0.018, 95% CI [−0.116, 0.146]**, N=46 paired probes, 41
> matched on common token support) — so the pre-registered **falsifier (a) FIRES**
> and the "denser useful context **per token**" thesis is **refuted at N=46**. The
> raw (un-length-matched) edge is real and significant (+0.120 [0.016, 0.223]) but
> it is a **length/shape** effect: ss responses are ~2.3× longer at the median, and
> the content advantage tracks that length. Separately, the intrinsic metric **does
> predict downstream** usefulness (its DIV-2 / C-gate-free variants: `USD_noC`
> ρ=0.535 [0.426, 0.639], `content_noD3` ρ=0.480 [0.332, 0.604], grounding ρ=0.571
> [0.410, 0.716], all surviving length-control) — but **plain `USD` does NOT
> validate** (ρ=0.190, lower-CI 0.118 < the 0.30 bar) because its in-scalar
> `signal_purity` gate collapses to 0 at episode granularity. Net: ss carries
> **more usable signal per RESPONSE and converts to a small (+2pp, near-parity)
> downstream edge, but NOT more signal per TOKEN.**

---

## 1. What ran (coverage — no silent caps)

| | Value |
|---|---|
| Metric | `USD` per `final-spec.md` (v1 hardened), `core/prompt-optimization/sweep/usd-metric.mjs` |
| Unit tests | **41/41 green** incl. all G1–G9 gaming cases + 2 new server-noise-strip tests (see §6) |
| Capture agent | DeepSeek-V4-Pro bare-API **direct** (`deepseek/deepseek-v4-pro`), reasoning=high, conc=1, max_turns=probe cap |
| Arms | **ss** (Mpp.md policy, ss-* only) vs **native** (neutral rg/grep/find+read policy); both arms' raw tool outputs captured verbatim |
| Judge panel | **3-panel disjoint families**: deepseek-v4-flash (DeepSeek **direct**) + gemini-3.1-flash-lite (Google **direct**) + minimax-m2.7 (via OpenRouter; DeepSeek stays direct per the locked rule) — median per criterion |
| Off-panel solver (Layer B) | **claude-haiku-4-5** (Anthropic) — disjoint from the USD panel ⇒ de-circularized |
| rubricHash | `0x46dea0229bdd7370` (φ=0.25, α=2, τ=400, caliper=0.2, θ_floor=0.5) — frozen, unchanged all run |
| **N completed** | **46 / 60 probes** (92 episodes) fully captured + scored + Layer-B-graded |
| Strata covered | literal-lookup 16, behavioral 13, multi-file-flow 10, no-match 7 (all 4 strata) |
| Languages | **all 18** incl. all 5 OOD regex-fallback langs (Dart, Elixir, Lua, Scala, Zig) |
| Not covered | **14 probes** (`cpp-v60-02` partial + 13 unrun: the vault-order tail from `csharp-v60-*` on). The two background capture passes were each killed by the 10-min task budget; the run is resumable and the remaining 14 are simply un-captured, not dropped. |

**Pre-committed-slice discipline (honored).** The task pre-authorized: if the full
60 cannot finish in one pass, run a pre-committed slice N≥20 at full rigor and log
exactly what was covered. **N=46 ≫ 20**, spans every stratum and every language;
all N=46 are at full rigor (3-panel, paired bootstrap, length-control,
Layer-B). The remaining 14 are listed above. Held-out discipline preserved: dev
(24)/held-out (36) split is seed=42 stratified; held-out reported **aggregate
only** (§4); per-probe inspection used only on dev.

Artifacts: captures `…/metric-forge/captures/run-v1/`, scores
`…/scores/run-v1/`, Layer-B `…/layerb/run-v1/`, aggregate
`…/run-aggregate-run-v1.json`, Layer-B summary `…/layerb-run-v1.json`. Run
scripts: `scripts/usd-capture-run.mjs` (capture+score, resumable),
`scripts/usd-aggregate.mjs` (§7.3 report), `scripts/usd-layerb-validate.mjs`.

---

## 2. HEADLINE — does the ss-vs-native gap survive length-matching? (§5b, the crux)

Per-arm means (N=46 paired, USD on [0,1]):

| | USD | **USD_noC** (DIV-2) | content | **content_noD3** | signal_purity (C) | grounding g | purity_ratio | mean tokens |
|---|---|---|---|---|---|---|---|---|
| **ss** | 0.014 | 0.086 | 0.326 | **0.315** | 0.103 | 0.652 | 0.223 | 2467 |
| **native** | 0.013 | 0.054 | 0.213 | **0.196** | 0.128 | 0.500 | 0.188 | 2446 |

Token distribution (the support that length-matching operates on):

| | min | q25 | median | q75 | max | mean |
|---|---|---|---|---|---|---|
| ss | 12 | 996 | **2229** | 3318 | 6855 | 2467 |
| native | 76 | 553 | **988** | 1769 | 18023 | 2446 |

ss is ~2.3× longer at the **median** (2229 vs 988); means coincide only because
one native outlier (18k-tok full-file read) pulls the native mean up.

### The two comparisons (the whole anti-gaming point):

**RAW same-probe paired Δ (ss − native), NOT length-controlled** — paired bootstrap 95% CI, B=20000:

| metric | Δ | 95% CI | excludes 0? |
|---|---|---|---|
| **content_noD3** | **+0.120** | **[0.016, 0.223]** | **YES** |
| content | +0.113 | [0.013, 0.213] | YES |
| USD_noC | +0.032 | [0.005, 0.059] | YES |
| USD | +0.000 | [−0.019, 0.022] | no |

**CALIPER-MATCHED paired Δ on common token support (THE HEADLINE, §5b)** — caliper=0.2 nat-log, 41/46 ss matched (ssSupportFrac 0.89, natSupportFrac 0.76 ⇒ length-matchable):

| metric | Δ | 95% CI | excludes 0? |
|---|---|---|---|
| **content_noD3** | **+0.018** | **[−0.116, 0.146]** | **NO** |
| content | −0.000 | [−0.122, 0.117] | NO |
| USD_noC | +0.001 | [−0.033, 0.034] | NO |
| USD | +0.002 | [−0.017, 0.023] | NO |

**Verdict on length-control: the gap does NOT survive.** The raw content edge
(+0.120, CI excludes 0) **collapses to +0.018 (CI includes 0)** once ss and native
responses are matched for token length. This is exactly the design's decisive
anti-gaming gate doing its job: the apparent "richer ss" advantage was **verbosity /
shape, not per-token signal**. Per the pre-committed FALSIFICATION criterion (a),
the **per-token-density thesis is refuted at N=46**.

**Quantile (median) twin** (guards against mean-pull): per-probe median Δ = 0.00
for content_noD3 / USD_noC / grounding — but the win/loss counts favor ss
(content_noD3: **20 ss-wins, 7 native-wins, 19 ties**; USD_noC: 21/9/16; grounding:
10/3/33). So ss **wins more often per response**, consistent with the raw edge; the
matched analysis shows that edge is length-coupled.

---

## 3. Per-stratum, per-criterion, per-language, no-match (sub-scores ship with the scalar)

**Per content criterion (non-no-match, panel-median, ss − native):**
`D1 answer_grounding +0.231` · `D2 workable_code +0.103` · `D3 navigability +0.103`
· `D4 edit_locality +0.128` · `D5 sufficiency +0.103` · `C signal_purity −0.026`.
ss leads every content dimension; the **largest edge is D1 (+0.231)** = ss more
often literally contains the answer span — which is precisely the dimension
length-control neutralizes (a longer response is more likely to contain the span).
`signal_purity` is the only **native**-favoring criterion and is near-floor for both
(0.10 / 0.13).

**Per stratum (RAW USD_noC / content_noD3 / grounding):**

| stratum | n | ss noC / noD3 / g / tok | native noC / noD3 / g / tok |
|---|---|---|---|
| literal-lookup | 16 | 0.123 / 0.438 / 0.75 / 1617 | 0.084 / 0.313 / 0.56 / 833 |
| behavioral | 13 | 0.070 / 0.327 / 0.69 / 2846 | 0.027 / 0.096 / 0.62 / 2843 |
| multi-file-flow | 10 | 0.105 / 0.325 / 0.70 / 3868 | 0.078 / 0.275 / 0.60 / 5808 |
| no-match | 7 | 0.000 / 0.000 / 0.29 / 1708 | 0.000 / 0.000 / 0.00 / 592 |

ss leads (raw) in all three match strata and on grounding everywhere. The
behavioral stratum shows the widest raw content_noD3 gap (+0.231) — and behavioral
queries are where ss-search's semantic routing earns its keep vs lexical rg.

**Per language (RAW content_noD3 Δ, ss − native):** positive on most —
python +0.50, csharp +0.38, go/lua +0.33, php/zig +0.25, ts +0.17, java/elixir/ruby/swift +0.13,
rust/scala +0.08; **negative on cpp −0.42 and C −0.17** (the header/impl-split and
macro probes where ss-search ranked a defensible-but-different region and lost the
grounding floor). Dart/js = 0.00. The **5 OOD langs did not crash** — the AST-snap
degraded to the deterministic line-floor (spec §5a clause c, residual risk B11) and
ss even led on Lua/Zig/Scala/Elixir. (Per-language N is 2–3 — directional only.)

**No-match stratum (7 probes):** **confident-false-positive rate = 0% for BOTH
arms** (the §3.1 context-bomb guard held — neither arm fabricated an answer to a
nonexistent symbol). meanUSD = 0 for both, because the agent episodes were verbose
(ss median 1708 tok, native 592) and the τ=400 no-match budget zeroes anything
over ~400 tokens. ss declared no-match correctly on 2/7 (g=0.29) vs native 0/7
(g=0.00) — ss slightly better at *saying* "no match", but both over-explored for
the length budget. **Disclosed limitation:** at episode granularity the τ=400 budget
is too tight for an agent's multi-call no-match trajectory; in v2 τ should be set on
the *terminal* declaration, not the whole episode.

---

## 4. Held-out discipline + the dev/held-out divergence (reported, NOT tuned)

Caliper-matched `content_noD3` Δ, split by the seed=42 dev/held-out partition:

| subset | paired probes | RAW noD3 Δ [CI] | MATCHED noD3 Δ [CI] (matched pairs) |
|---|---|---|---|
| dev (inspectable) | 17 | +0.000 [−0.191, 0.176] | **−0.386 [−0.682, −0.091]** (11) — native wins |
| held-out (aggregate-only) | 29 | +0.190 [0.078, 0.310] | +0.156 [0.000, 0.302] (24) — borderline, includes 0 |
| **all** | **46** | **+0.120 [0.016, 0.223]** | **+0.018 [−0.116, 0.146]** (41) — **null** |

The dev and held-out **matched** gaps point in **opposite directions** (dev native
wins, held-out borderline-ss) with tiny matched-pair counts (11 / 24). Per the
CLAUDE.md methodology and `feedback_heldout_discipline_strict`, this is **not tuned
to** — it is reported as the small-N instability it is. Read straight: the
length-matched comparison is **underpowered per-split**; the only stable statement
is the **combined N=46 verdict — null at matched size.** A future full N=60 run with
≥3 judge reps is the fix, not a parameter change.

---

## 5. Layer-B validation — does USD predict downstream usefulness? (§8.4, PROVISIONAL)

**Structural constraint (disclosed).** The execution-grounded task-completion bench
(`eval/task-completion-bench/`) runs on **SWE-bench-Lite task IDs** (`pallets__flask-*`,
`pylint-dev__*`) with **no per-probe join** to the 60-probe vault, and its n=14
variance pilot shows **resolve-rate parity** (4/14 both arms — "efficiency-at-parity").
So the spec's reserved **"validated"** label (correlation with the F2P∧P2P
resolve-delta) is **NOT yet attainable**. Per spec §8 we ran the **minimal external
signal — the answer-fed-solver on the 46 probes**: feed each arm's captured tool
response R to an **off-panel** solver (Claude Haiku 4.5, disjoint from the USD
panel ⇒ de-circularized), have it answer *from R alone*, grade that answer for
correctness with the 3-panel judge ⇒ `solverSuccess ∈ {0,1}`. Then correlate
per-episode metric value with `solverSuccess` (Spearman ρ + paired bootstrap CI +
a length-controlled partial-ρ). **This is "provisional validity," not "validated."**

**solverSuccess rate: ss 0.76, native 0.74** (+2pp ss — near-parity, consistent
with the bench's resolve-parity).

| metric → solverSuccess | Spearman ρ | 95% CI | length-controlled ρ | passes ρ≥0.30 lower-CI? |
|---|---|---|---|---|
| **grounding** | **0.571** | [0.410, 0.716] | 0.464 | **YES** |
| **USD_noC** (DIV-2) | **0.535** | [0.426, 0.639] | 0.388 | **YES** |
| content | 0.502 | [0.347, 0.631] | 0.346 | YES |
| **content_noD3** | **0.480** | [0.332, 0.604] | 0.329 | **YES** |
| **USD** (in-scalar C-gate) | **0.190** | [0.118, 0.262] | 0.210 | **NO** (0.118 < 0.30) |

**Verdict on validity (falsifier b): SPLIT, and it indicts the C-gate, not the
metric idea.**
- The **C-gate-free variants validate**: `USD_noC`, `content_noD3`, and `grounding`
  all clear the pre-committed **ρ lower-CI ≥ 0.30** bar **and survive
  length-control** (partial ρ ≥ 0.33). The intrinsic signal **does** predict the
  downstream answer-fed-solver.
- **Plain `USD` FAILS** (lower-CI 0.118 < 0.30). This is **exactly the DIV-2
  fallback the spec pre-registered**: at episode granularity the in-scalar
  `signal_purity` (C) multiplicative gate collapses to ≈0.1 for **both** arms (an
  episode = concatenated tool calls incl. full-file reads is almost never "free of
  content not needed"), so plain USD ≈ 0.013 for both and discriminates nothing.
  Per spec §12 DIV-2, **report USD with AND without C**; the **without-C variant is
  the load-bearing, validated one.** This is the metric telling us, on real data, to
  drop/soften the in-scalar C-gate in v2 — not a tuning, a finding.

**Substitution check (Dietz):** at the system level, `USD_noC`, `grounding`, and the
solver all rank **ss > native** — but the solver edge is +2pp and the matched-size
content gap is null, so the agreement is **length-driven, not per-token**. Faithful
cheap proxy for *which arm the solver prefers* (yes), **not** evidence of per-token
density.

---

## 6. Anti-gaming audits on real data + one fairness fix found in the wild

**The 12 required-green gaming unit tests (G1–G9) all pass** (41/41) — including the
B1 crux (whole-file-cite snaps to the answering node, dump does NOT beat the terse
answer), the ≥0.30 padding-drop, terse-native-not-penalized (purity_ratio≥0.85),
byte-identical ss-vs-native symmetry, disjoint-support ⇒ claim-withheld, no-match
15k context-bomb ⇒ USD≈0, and span-spoof demotion.

**On the real run the guards fired as designed:**
- **Symmetric grounding floor, native legitimately wins it:** ss g=0 on cpp-001/cpp-006
  (ss-search ranked a defensible-but-different region for the header/impl-split
  queries) while native got g=1 — the metric **can and does refute the ss-favorable
  thesis**, it is not rigged. cpp content_noD3 Δ = −0.42 (native wins).
- **Length-control killed the raw edge** (§2) — the headline guarantee G1/G3 on live data.
- **No-match context-bomb guard:** 0% confident-false-positive on both arms.

**FAIRNESS FIX discovered in run-v1 (disclosed).** The first ss tool call per probe
leaked **ss server cold-start chrome** into its stdout (`BinaryHNSW: Loaded …`,
`LateInteraction: Streaming load …`, `Warming up embedding service…`, `exit 0`).
**100% of ss captures carried it; 0% of native** — an arm-asymmetric pollution (the
B3 symmetry-break class) that inflated ss's `total_tokens` denominator and fed boot
noise to the judge, **biasing AGAINST ss.** I added a precise, content-preserving,
ss-arm-only `SS_SERVER_NOISE_RE` to `stripChrome` (server-lifecycle log lines only;
2 new unit tests assert code like `if (rc != 0) exit 1;` / `HNSW_index_t idx` is
**kept**, idempotent), and **re-scored all 46 pairs** under the fixed filter
(verified: 0/46 ss scores carry boot-chrome in R_judge; total_tokens consistent).
This is removing a confound that **hurt** ss — i.e., it makes the still-null matched
gap *more* credible, not less. (It changes the scored bytes, not the rubricHash
inputs; for a clean publishable run the rubricHash bundle should include the
stripChrome version — a v2 bookkeeping note.)

---

## 7. Residual risks observed on real data (disclosed, monitored)

1. **In-scalar C-gate collapse (DIV-2 confirmed live).** C≈0.1 for both arms ⇒ plain
   USD≈0.01 ⇒ non-discriminating + fails Layer B. **Action: v2 drops/softens the
   multiplicative C (e.g. additive penalty), reports `USD_noC` as primary.** Not
   tuned away — reported as the pre-registered fallback firing.
2. **C^G gold spans not annotated on the vault (0/60).** D1/D4/density ran on the
   line-floor + symbol/fact anchoring (graceful degradation per §5a clause c). The
   density numerator is therefore the *conservative* line-floor; purity_ratio is
   low for both arms by construction. **Annotating C^G on all 60 is the top v2 input.**
3. **N=46 (77%), not 60; per-split matched analysis underpowered** (dev/held-out sign
   flip, §4). The combined verdict is stable; the split is not. **Finish the 14
   remaining + ≥3 judge reps.**
4. **τ=400 no-match budget too tight for multi-call agent episodes** (§3) — both arms
   USD=0 on no-match. v2: score the terminal declaration, not the whole episode.
5. **Provisional validity only** — the answer-fed-solver is a within-vault proxy; the
   execution-grounded F2P∧P2P resolve-delta needs a per-probe-joinable
   task-completion bench (the current bench is SWE-bench-Lite, disjoint IDs).
6. **OOD AST-snap = line-floor** for Dart/Elixir/Lua/Scala/Zig (B11) — handled, did
   not crash; per-language N is small.

---

## 8. HONEST VERDICT

**Does ss-* carry significantly MORE usable signal at MATCHED size?**
**NO — not per token.** The caliper-matched paired `content_noD3` Δ = +0.018, 95% CI
**[−0.116, 0.146]** (N=46, 41 matched pairs) **includes 0**. The pre-registered
falsifier (a) fires. The raw +0.120 edge (CI excludes 0) is real but is a
**length/shape** effect — ss is ~2.3× longer at the median and the content edge
tracks that length. **What ss-* genuinely provides** is (i) **better grounding**
(g 0.65 vs 0.50 — it lands on the right region more often, raw), (ii) **more content
per RESPONSE** (it wins per-probe 20:7 on content_noD3, raw), and (iii) a real
**single-shot navigability (D3)** capability (the disclosed B5 capability axis, not a
density claim). These convert to a **small (+2pp), near-parity** downstream
answer-fed-solver edge — consistent with the task-completion bench's resolve-parity.
The "same accuracy, **denser useful context per token**" half of the thesis is **not
supported at N=46**; the "**more usable context per call / better-targeted**" half is.

**Does the intrinsic metric predict task success?**
**YES for the C-gate-free variants, NO for plain USD.** `USD_noC` (ρ=0.535
[0.426, 0.639]), `content_noD3` (0.480 [0.332, 0.604]), and grounding (0.571
[0.410, 0.716]) all clear the pre-committed ρ≥0.30 lower-CI bar and survive
length-control; plain `USD` fails (0.190, lower-CI 0.118) because of the C-gate
collapse. **Calibrated and provisionally valid (USD_noC variant); "validated"
remains reserved** for the execution-grounded resolve-delta correlation (blocked on a
per-probe-joinable bench). The honest conclusion the metric forces, on its own real
data: **adopt `USD_noC`, drop the in-scalar C-gate, annotate C^G, finish N=60 with
reps — and report ss-* as "better-grounded, more-per-call, near-parity downstream,"
NOT "denser per token."**
