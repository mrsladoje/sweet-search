# Panel review — COST lane (tag `p1`)

**Task.** Refute the cost claims of `09-synthesis-draft.md` and its evidence files `02` and `03`.
Default to *weakened* where I could not verify a number myself.

**Method.** I re-derived the cost of all **1,311 rollouts** from the raw transcripts with my own
parsers and my own re-implementation of the three price columns. I imported nothing from
`harness/` and nothing from the `e2-*` / `e3-*` scripts; the price formula was re-typed from the
contract read in `ideal-cost.mjs`. The gutter was re-tokenised locally with `o200k_base` from the
raw delivered block bodies, with my own strip-and-re-render code, not from `blocks-tok.ndjson`.

**Scripts** (local copies, box copies under `/tmp/fp-inv/p1/`):

| script | what it does | log |
|---|---|---|
| `scripts/p1-harvest.mjs` | re-prices 1,311 rollouts from their own transcripts (codex `token_count`, opencode `step_finish`, claude assistant `message.usage` deduped by id) | — |
| `scripts/p1-analyse.mjs` | validation vs `rows.json`, cell table, component split, paired deltas + bootstrap, first-turn delta, output asymmetry, delegation, spend | `logs/p1-analyse.txt` |
| `scripts/p1-conventions.mjs` | the three claude transcript-selection conventions, delegation subsets, medians, `contextRewrites`, spend | `logs/p1-conventions.txt` |
| `scripts/p1-stats.mjs` | real bootstrap CIs, exact sign tests, cache hit/write, cross-harness ratios, opencode calls-per-request, cap census | `logs/p1-stats.txt` |
| `scripts/p1-codexcap.mjs` | codex cap census from codex's own `Original token count:` field | `logs/p1-codexcap.txt` |
| `scripts/p1-capreplay.mjs` | bytes-per-token calibration and the epoch-A cap replay | `logs/p1-capreplay.txt` |
| `scripts/p1-gutter.py` | independent `o200k_base` re-tokenisation of every delivered `ss-*` block in four renderings | `logs/p1-gutter.txt` |
| `scripts/p1-rep.mjs`, `scripts/p1-artefacts.mjs` | rep-index spread, solve counts, concurrency, repair substitution, `degenReran` | `logs/p1-rep.txt`, `logs/p1-artefacts.txt` |

---

## 0. Headline of this review

**The draft's cost arithmetic is sound where it is measured and soft where it is modelled. Three
numbers do not survive.**

1. **The codex cap counterfactual (claim 6) is not reproducible.** [M] Codex tool output
   tokenises at **3.99 bytes per token** (measured on 1,327 untruncated outputs against codex's
   own token counts). `02` converted epoch A's over-cap bytes at **2.67 B/token for native and
   3.69 for sweet** — two different rates for the two arms of one counterfactual. At the measured
   common rate the replay moves codex from `−6.4%` to **`+6.3%`, CI `[−5.2%, +19.6%]`**, an
   interval that includes zero. `+11.5%` with a CI of `[+1.7%, +22.2%]` is only reachable at
   ~2.7 B/token.
2. **"18 tasks where neither arm delegated" (claim 9) is exactly inverted.** [M] 18 of the 22
   tasks are the ones where *at least one* arm delegated. Only **4** tasks are clean, and on them
   sweet is **+26.3%** (CI `[+5.0%, +51.9%]`, excludes zero). The `+6.8%` quoted is numerically
   the leave-one-task-out figure for dropping `devlooped__moq-1262` (I reproduce `+6.83%`), and
   the CI's lower bound `−9.7%` is numerically the other leave-one-out extreme (`−9.66%`, dropping
   `bfgroup__b2-259`). The direction of the draft's conclusion survives and is stronger; the
   subset, the n and the interval do not.
3. **The run's spend (claim 19) is `$11.40`, not `$11.76`.** [M] `$11.76` is the sum that uses the
   *dearest-3* claude convention the draft itself rejects two sections earlier. On the draft's own
   preferred row-matched convention the total is **`$11.4023`**; on every dollar actually paid it
   is **`$11.9805`**. "Including the deleted rows" is not possible — the 18 deleted opencode
   rollouts have no `rows.json` record and contribute `$0`.

Everything else in the cost lane reproduces, in several cases to the sixth decimal.

---

## 1. Validation of the reconstruction

[M] `p1-analyse.mjs` §1. My independent parse ties to the harness's own columns:

| harness | column | rows | max absolute error |
|---|---|---:|---|
| codex | `idealCostUsd` | 410 | `$0.0000005` (rounding) |
| codex | `costRealizedUsd` | 410 | `$0.00093` — the two epoch-A rows `02` §1 already names |
| opencode | `idealCostUsd` | 491 | `$0.0000005` |
| opencode | `costRealizedUsd` | 491 | `$0.0000005` |
| claude-code | `costRealizedMainOnlyUsd` | **342** | **`$0.0000005`** |
| claude-code | `costSidechainUsd` | 270 | **`$0.000000`** |

So `02`'s claim that the row-matched claude reconstruction "ties on 342 of 342 rows" is
independently confirmed. `contextRewrites` is 0 on every epoch-C row of `rows.json`; my own
reconstruction finds one shrinking turn (`fp-claudecode-none` / `mathnet-numerics-1072` / sweet /
rep 2) whose `breakPriced − ideal` is `$0.000000`. `breakPricedUsd == idealUsd` in every cell.

**Cell reproduction, epoch C** [M]:

| harness | native | TAB | NONE | PIPE |
|---|---:|---:|---:|---:|
| codex (mine = published) | `0.012287` | `0.012330` | `0.012319` | `0.012754` |
| opencode (mine) | `0.008969` | `0.009265` | `0.008584` | `0.008764` |
| claude row-matched (mine) | `0.020972` | `0.019125` | `0.017345` | `0.016730` |
| claude dearest-3 (mine) | `0.021437` | `0.020727` | `0.019424` | `0.017761` |
| claude every-dollar (mine) | `0.021819` | `0.022243` | `0.020715` | `0.018155` |

All twelve claude figures of `02` §9.1 reproduce exactly. The published FRESH-POOL claude native
(`0.021558`) and NONE (`0.019480`) reproduce under **no** convention I can construct — confirming
`03` §1's `−0.56%` / `−0.29%` residual.

Solve counts, null rows and the ledger artefacts all reproduce: claude TAB carries 28 null
`costRealizedUsd` on native and 9 on sweet; `degenReran` is native 1 / sweet 5 (TAB), 4 (NONE),
2 (PIPE) — **12 in the fresh pool**, 13 across every run in the report (the thirteenth is a native
row in `rb-claudecode-20260824`). Codex and opencode have **0** `degenReran` and **0** multi-attempt
rows in epoch C, so the transcript-selection question is claude-only.

---

## 2. Verdicts

### Claim 1 — the tab gutter is `$0.00030`–`$0.00044` per rollout (2.1–3.7%), two thirds resident; R1/R2 understate 2.5–4× because of the epoch-B line count

**WEAKENED.** [M] `p1-gutter.py`, independent `o200k_base` re-tokenisation of 7,515 delivered blocks.

| harness | gutter tok/rollout | gutter `$`/rollout | resident share | `03` says |
|---|---:|---:|---:|---|
| codex TAB | 1,163.3 | **`$0.000302`** | 61.5% | 1,163 · `$0.000302` |
| opencode TAB | 1,264.7 | **`$0.000338`** | 62.6% | 1,265 · `$0.000338` |
| claude TAB (n = 62 with blocks) | 1,408.2 | `$0.000417` | 66.2% | 1,448 · `$0.000440` |
| claude TAB (n = 66, the cell) | 1,322.8 | **`$0.000392`** | 66.2% | — |

Codex and opencode reproduce to the last digit. **Claude does not.** The blocks file holds
62 of 66 claude TAB rollouts (and 62 NONE, 64 PIPE); dividing by the rollouts that carry blocks
rather than by the cell overstates the claude gutter by `66/62 = 6.5%`, and even before that my
per-block-bearing-rollout figure is 5% under `03`'s. The honest claude number is
**`$0.000392`, 2.05% of the row-matched cell**. So the range is `$0.00030`–`$0.00039`
(2.1–3.7% still holds only because opencode's 3.65% is the top).

"Two thirds resident" is 61.5–66.2%, i.e. **62–66%**, not two thirds on codex or opencode.

**The residency model itself is verified** [M]: the block file's `T` equals my measured request
count on 198/198 codex, 198/198 opencode and 184/188 claude rollouts, and the weight
`(0.10 + 0.01·resid)/1e6` reproduces on all 7,515 blocks with 0 mismatches.

**The understatement is 2.1–3.3×, not 2.5–4×, and it has three causes, not one.** [M] R1
(`logs/r1-price.txt`) prices the tab at `$0.000092` (codex), `$0.000144` (opencode),
`$0.000187` (claude) — ratios to my figures of **3.28× / 2.35× / 2.10×**. The line count explains
only about `2.0–2.2×` of that (394 → 859 gutted lines on codex); the rest is R1's
`resend_frac = 0.5` assumption and its use of *calls* (12.5) where the billing unit is *requests*
(19.6). Attributing the whole gap to the epoch-B line count, as the claim does, is wrong.

### Claim 2 — codex PIPE's `+$0.000424` is 51% the delimiter's bytes (`+$0.000217`, 72% of the input side); PIPE − TAB is `+0.93` tokens per line on all three harnesses

**UPHELD on the per-line constant, WEAKENED on the share.** [M] `p1-gutter.py`.

Per gutted line, my tokenisation: tab `+1.354` … `+1.363`, pipe `+2.283` … `+2.303`,
**difference `+0.926` to `+0.940` on all six gutter-bearing cells.** `+0.93` confirmed.

Direct TAB→PIPE, behaviour held at TAB's behaviour: codex **`+$0.000207`** (not `+$0.000217`),
opencode `+$0.000236` (not `+$0.000248`), claude `+$0.000287` (not `+$0.000328`). Against the
observed codex `+$0.000424` that is **48.8%**, and against the input-side `+$0.000302` it is
**68.5%**. The claim's 51% / 72% are each ~5% high. Direction and size class stand.

### Claim 6 — codex's flip is the ~2,500-token output cap; it deletes 10,505 of native's 26,302 tool tokens (40%) and 2,357 of sweet's 15,558 (15%); replaying epoch A under the cap moves codex `−6.5%` → `+11.5%`, CI `[+1.7%, +22.2%]`

**REFUTED as stated; the mechanism survives, the magnitude and the interval do not.** [M]
`p1-codexcap.mjs`, `p1-capreplay.mjs`.

What reproduces exactly:

- truncated outputs: native **238** in **61 of 66** rollouts (3.61/rollout), sweet TAB **105** in
  **39 of 66** (1.59/rollout);
- the cap bracket: largest untruncated / smallest truncated original token count
  **2,495 / 2,509** (epoch C) and **2,489 / 2,511** (epoch B);
- produced tool tokens **26,302** (native) and **15,558** (sweet TAB) — codex's own counts;
- epoch A has **no `Original token count` field at all** (0 of 353 and 0 of 388 outputs) and
  only 8 truncations, all native, in 7 of 34 rollouts.

What does not:

- **Deleted by the cap, computed directly from codex's own counts** (`Σ max(0, N − 2500)` over
  truncated outputs): **native 9,244 tok/rollout (35.1%), sweet 1,647 (10.6%)** — against the
  claim's 10,505 (40%) and 2,357 (15%). `02` reached its figures by the subtraction
  `newIn − firstTurn − output`, which I reproduce exactly (15,797 native, 13,201 sweet) and which
  under-counts delivered tokens because roughly an eighth of the model's own output never
  re-enters the prefix. The subtraction inflates the native deletion by 14% and the sweet
  deletion by 43%.
- **The byte→token conversion.** [M] Codex tool output tokenises at **3.989 B/token** on native
  (565 untruncated outputs) and **3.987** on sweet (762). `02` converted 24,639 over-cap native
  bytes to "≈9,234 tokens" (**2.67 B/token**) and 3,184 sweet bytes to "≈866" (**3.68 B/token**).
  The over-cap byte counts themselves reproduce (mine 24,639 / 3,184 against 24,654 / 3,196).
- **The replay.** [M] Residency-aware replay of the epoch-B/C cap over epoch A's own transcripts,
  bootstrapped over the 17 tasks:

| bytes/token | removed tok/rollout native · sweet | epoch A as run → capped | 95% CI |
|---|---|---|---|
| 2.67 (`02`'s native rate) | 9,228 · 1,192 | `−6.4%` → `+14.2%` | `[+2.5%, +28.1%]` |
| 3.0 | 8,213 · 1,061 | `−6.4%` → `+11.4%` | `[−0.1%, +25.1%]` |
| 3.5 | 7,040 · 910 | `−6.4%` → `+8.4%` | `[−3.1%, +21.9%]` |
| **3.99 (measured)** | **6,160 · 796** | `−6.4%` → **`+6.3%`** | **`[−5.2%, +19.6%]`** |

At the measured rate the interval includes zero. The claim's `+11.5%` sits at ~3.0 B/token and its
interval `[+1.7%, +22.2%]` only at ~2.7. **The bound the draft wants — "the harness change alone is
more than sufficient to explain the flip" — still holds** (a 12.7-point swing against an observed
6.8), but it must be stated as `+6.3%` with an interval that includes zero, not as a
significant `+11.5%`.

### Claim 7 — opencode's flip is requests: native 1.546 calls per request (25.2% multi-call steps, 55.6% of calls), sweet 1.106; same in epoch A (1.50 vs 1.15); sweet's calls 17.0 → 21.8; +3.38 turns, +`$0.000914` (+10.2%)

**UPHELD.** [M] `p1-stats.mjs` §E. Counting every `tool_use` record and dividing by the request
count (`step_finish` records, text-only requests included, which is the billing unit):

| cell | calls | requests | calls/request | multi-call requests | calls in them |
|---|---:|---:|---:|---|---|
| C native | 1,665 | 1,077 | **1.546** | 271 (**25.2%**) | 925 (**55.6%**) |
| C sweet TAB | 1,438 | 1,300 | **1.106** | 105 (8.1%) | 309 (21.5%) |
| A native | 775 | 518 | **1.496** | 128 | 419 (54.1%) |
| A sweet | 577 | 503 | **1.147** | 55 | 163 (28.2%) |

Every published figure reproduces. Calls per rollout 16.97 → 21.79; turns 16.32 native vs 19.70
sweet, Δ `+3.38`. The `+$0.000914` is a Shapley split I did not re-derive, but a direct estimate
agrees on size: sweet's mean context per request is 22,968 tokens (`$0.00023` of re-send) plus 185
output tokens (`$0.000111`) = **`$0.000341` per request**, × 3.38 = `$0.00115`, of which the split
assigns `$0.000914` to turns and the rest to context growth.

### Claim 8 — claude never flipped: `−8.8%` (`$0.019125` vs `$0.020972`), ties on 342/342 rows; the published `−3.9%` substitutes 13 discarded degeneration re-runs; per dollar spent sweet is `+1.9%`

**UPHELD, with one count corrected.** [M] `p1-conventions.mjs` §A. I reproduce all three
conventions independently and to six decimals, including the published `$0.020727` and
`$0.017761`. `$0.022243` vs `$0.021819` is **+1.94%**. The tie to `costRealizedMainOnlyUsd` is
confirmed on 342 rows at `$0.0000005`.

Correction: **12**, not 13, discarded sessions sit inside the fresh-pool claude cells (extra
sessions per cell: native TAB 1, sweet TAB 5, NONE 4, PIPE 2). The thirteenth `degenReran` is in
`rb-claudecode-20260824` and does not touch the fresh-pool figure.

### Claim 9 — delegation suppression is `−$0.001619`/rollout (`−7.7%`); delegating rollouts 3/11, 0/20, 9/28; on the 18 tasks where neither arm delegated the main-only delta is `+6.8%`, CI `[−9.7%, +29.4%]`

**REFUTED on the subset; UPHELD, and strengthened, on the direction.** [M] `p1-analyse.mjs` §6,
`p1-conventions.mjs` §B, `p1-stats.mjs` §A.

Delegating rollouts reproduce exactly: **A 3/34 sweet vs 11/34 native; B 0/39 vs 20/39; C 9/66 vs
28/66** (task-cells 6 vs 15). Sidechain `$`/rollout C: `$0.002811` vs `$0.004429`, Δ
**`−$0.001618`** (claim: `−$0.001619`), `−7.7%` of native.

The subset is wrong. **18 of 22 tasks are the tasks where at least one arm DID delegate.** Native
delegated on 15 task-cells of 22, so at most 7 tasks can be native-clean, and exactly **4** are
clean in both arms: `callstack__react-native-paper-972`, `jazzband__tablib-454`,
`locationtech__jts-622`, `mathnet__mathnet-numerics-1072`.

| subset | n | main-only Δ | 95% CI (20,000 task bootstraps) |
|---|---:|---:|---|
| all 22 tasks | 22 | `−1.38%` | `[−20.1%, +27.0%]` |
| **4 tasks with no delegation anywhere** | 4 | **`+26.29%`** | **`[+5.0%, +51.9%]`** |
| 34 rep-matched rollout pairs where neither delegated (17 tasks) | 17 | `+10.29%` | `[−11.7%, +43.9%]` |
| 22 minus `devlooped__moq-1262` (leave-one-out) | 21 | **`+6.83%`** | `[−12.0%, +34.3%]` |

The claim's `+6.8%` is the last row — the leave-one-out figure, which has nothing to do with
delegation — and its interval `[−9.7%, +29.4%]` has a lower bound numerically identical to the
*other* leave-one-out extreme in `02` §5 (`−9.66%`, dropping `bfgroup__b2-259`). The delegation
control, done properly, is worse for sweet than the draft reports, by 1 to 20 points.

### Claim 10 — the guide is exactly 1,457 tokens at the wire on 261 rollouts; `$0.000426` / `$0.000408` / `$0.000530` (3.5% / 4.6% / 2.5%), larger than the whole observed gap on every harness

**UPHELD on the constant; WEAKENED on the price and on "larger than the gap".** [M]
`p1-analyse.mjs` §4. Rep-matched first-turn differences:

- codex: **1,457 on 66 of 66 pairs**, one distinct value, min = median = max;
- opencode: **1,457 on 66 of 66 pairs**, one distinct value;
- claude-code: 1,565 or 1,570, median 1,570.

Priced by the claim's own formula (`tok × (0.10 + 0.01·(T−1))/1e6`, T = the cell's mean request
count) the guide is **`$0.000417` / `$0.000418` / `$0.000505`** = **3.4% / 4.5% / 2.6%** of the
sweet inclusive arm. The draft's `$0.000426` / `$0.000408` / `$0.000530` are the *Shapley terms of
the paired decomposition*, not this arithmetic; they differ by `−2%` to `+5%` and are not one
formula (codex and claude high, opencode low). Use the arithmetic figures when the claim is
"a constant we control".

"Larger than the whole observed sweet-vs-native gap on every harness" is **false on claude-code**:
the observed inclusive gap there is `−$0.001847` (`−8.8%`), 3.7× the guide. It is true only on the
main-only convention (`−1.38%`). The draft's §0.3 variant — the three sweet-only terms are
"larger than any observed gap" — fails the same way (6.9% of terms against an 8.8% gap).

### Claim 11 — requests reacting to wasted `ss-*` calls cost `$0.000294` / `$0.000204` / `$0.000370` (2.4% / 2.2% / 2.3%) at 0.33–0.91 calls per rollout; the cells tie to the published totals

**WEAKENED.** [C] `logs/synth-*wasted.txt`. The codex and opencode cells do tie: their
denominators are `$0.012330` and `$0.009265`, the published cells. The claude cell's denominator is
**`$0.015908`**, which ties to no published column — not the published `$0.020727`, not the
row-matched inclusive `$0.019125`, not my main-only realized `$0.016314`, not my main-only ideal
`$0.014739`. Against the published cell the claude waste is **1.79%**; against the row-matched
cell **1.93%**. Not 2.3%.

The term is also unstable across forms in a way the claim does not report: codex TAB 2.38% but
PIPE 1.43%; claude TAB 2.32% but PIPE 5.63%; opencode NONE 1.95% but PIPE 2.49%. At 0.33–0.91
events per rollout in 12–24 of 66 rollouts, the spread is the estimator, not the product.
"Removing them carries zero behavioural risk" is a design argument, not a measurement.

### Claim 12 — the `<state_summary>` is 71–120 output tokens (0.89–1.29 blocks), never its own request, under 0.5%, and sweet's total output is already below native's

**UPHELD except the last clause.** [C] `logs/synth-statesum*.txt`: 120 output tokens per rollout at
the top end, `$0.000072` of output and `$0.00009` with residency — under 0.5% on every harness; 84
of 85 claude blocks ride inside a tool-calling turn, standalone share of the cell `0.05%`.

[M] `p1-analyse.mjs` §5, output tokens per rollout: codex **5,524 sweet vs 5,786 native**,
claude **5,248 vs 6,415** — sweet below native. **Opencode is the exception: 3,645 sweet against
3,606 native, sweet 1.1% higher.** "Sweet's total output is already below native's" is false on
one of three harnesses.

### Claim 13 — "13–28% fewer tool calls" is true and does not pay; requests 19.7 vs 16.3 opencode (+21%) and 23.2 vs 24.3 claude; one opencode request costs about `$0.000326`

**UPHELD.** [M] Requests: opencode 19.70 vs 16.32 (**+20.7%**), claude 23.17 vs 24.30 (`−4.6%`),
codex 19.61 vs 18.85 (`+4.0%`). Calls: opencode 21.79 vs 25.23 (`−13.6%`), claude 29.86 vs 41.85
(`−28.6%`). My direct per-request price on opencode sweet is `$0.000341` (22,968 re-sent tokens at
`$0.01/M` plus 185 output tokens at `$0.60/M`) against the claim's `$0.000326`.

### Claim 14 — the 1.25× cache-write surcharge is charged on claude-code only; codex and opencode realized are ~7% lower bounds, uniform across arms; the gap is 1.62× ideal, 1.71× realized

**WEAKENED.** The code facts are confirmed [C]: `costFromTurns` (`ideal-cost.mjs:94`) multiplies
`cacheWrite` by 1.25; `claude-code-accounting.mjs:103` is the only supplier of that field;
`opencode-task-runner.mjs:160` folds `cache.write` into `in`; codex's `turnsFromRollout` emits
`{in, cached, out}` only. Note that all three harnesses ran the *same* OpenAI model, so the
surcharge is applied to one harness on the strength of a rule the code documents as Anthropic's;
whether luna is really billed 1.25× on cache writes rests on a web source I cannot verify here.

Two things in the claim fail:

1. **It is not uniform across arms.** [M] `p1-stats.mjs` §C, cache-write tokens per rollout:
   codex 35,899 native vs 34,498 sweet; opencode 30,356 vs 28,312; claude 39,105 vs 43,812.
   Charging the surcharge would move **opencode from `+3.31%` to `+2.52%`** and **codex from
   `+0.35%` to `+0.06%`**. That is a quarter of the opencode headline and most of the codex one.
   "The shortfall is uniform across arms, so no A/B moves" is wrong.
2. **`1.62×` is a mixed column.** [M] `1.62 = (claude ideal MAIN `$0.015329` + claude realized
   SIDECHAIN `$0.004429`) / codex ideal `$0.012218`. Ideal throughout gives **1.99×**, because the
   ideal identity charges a subagent's inherited prefix at the full input rate — `ideal` is not a
   meaningful column for a sidechain. Realized throughout gives **1.707×** (confirmed), and
   codex/opencode realized is **1.370×** (confirmed).

### Claim 16 — dropping `b2-113` moves codex `+0.3%` → `−3.3%` and dropping `b2-259` moves opencode `+3.3%` → `−0.1%`

**UPHELD.** [M] `p1-analyse.mjs` §3, leave-one-task-out on realized main-only: codex full
`+0.35%`, drop `bfgroup__b2-113` → **`−3.31%`** (max is `aio-libs__aiohttp-8038` → `+2.32%`);
opencode full `+3.31%`, drop `bfgroup__b2-259` → **`−0.08%`** (max `protofire__solhint-224` →
`+5.47%`). The paired per-task extremes reproduce: codex `b2-113` `+$0.009396`, `b2-259`
`+$0.008224`, `moq-1262` `+$0.004269`.

### Claim 17 — FRESH-POOL §4's "the model narrows its own reads" is wrong on codex: bytes per read fell 46% because the cap cut them, read count doubled, total read payload rose 9%

**WEAKENED.** [M] The *direction* holds: `toolCounts.nativeRead` per rollout goes 2.53 (A) → 4.64
(B) → 4.59 (C), i.e. roughly doubled between epochs A and B — `02`'s own parse says 3.62 → 6.92 →
7.32, and both agree the count roughly doubled. Total codex native tool bytes per rollout rose
68,337 → 70,128 (`+2.6%`), matching `02`'s `+2.6%` on the same quantity.

But "the per-call fall is the codex cap, not the model choosing narrower reads" is only half true.
[M] `p1-stats.mjs` §F, delivered output size per call, codex native: p90 **18,873 B → 10,207 B**
(that is the cap) but p50 **3,139 B → 2,617 B**, a 17% fall entirely *below* the cap, which the cap
cannot explain. Some of the per-call narrowing is real behaviour or pool composition. The flat
denial in §2.4 is too strong.

### Claim 19 — the run cost `$11.76`, not `$6.9`; the 12-cell table sums to `$10.88`; today's price doubles every absolute dollar

**REFUTED on the number, UPHELD on the correction of `$6.9`.** [M] `p1-conventions.mjs` §E:

| convention | codex | opencode | claude | total |
|---|---:|---:|---:|---:|
| row-matched (the draft's own preferred claude column) | `$3.2796` | `$3.2274` | `$4.8953` | **`$11.4023`** |
| dearest-3 (the convention the draft rejects) | `$3.2796` | `$3.2274` | `$5.2371` | `$11.7441` |
| every dollar actually paid | `$3.2796` | `$3.2274` | `$5.4735` | `$11.9805` |
| the 12 published cells only | — | — | — | `$10.8650` |

`$11.76` is the dearest-3 row. A report whose §7 item 2 says the dearest-3 convention "substitutes
discarded work for graded work" must not use it for its own spend total. Also: "including the
repair pass and **deleted rows**" is not achievable — the 18 rollouts the preflight race deleted
have no `rows.json` record and contribute `$0` to every figure above. `$6.9` is wrong by a factor
of 1.65 either way, which is the part worth keeping.

### Claim 20 — no gutter design is detectable in an affordable run: every effect is `$0.0003`–`$0.0004` against `±$0.001`–`$0.005` task-bootstrap intervals, none of six excludes zero, a single rep moves 23%, and `−15%` needs 6,403 numbered lines

**UPHELD.** [M] `p1-stats.mjs` §B, my own 20,000-draw task bootstrap and exact two-sided binomial
sign tests:

| harness | pair | Δ `$` | 95% CI on `$` | sign | p |
|---|---|---:|---|---|---:|
| codex | TAB→NONE | `−0.000011` | `[−0.000955, +0.001207]` | 13/9 | 0.523 |
| codex | TAB→PIPE | `+0.000424` | `[−0.000609, +0.001436]` | 9/13 | 0.523 |
| opencode | TAB→NONE | `−0.000681` | `[−0.001510, +0.000044]` | 10/12 | 0.832 |
| opencode | TAB→PIPE | `−0.000501` | `[−0.001293, +0.000254]` | 13/9 | 0.523 |
| claude (row-matched) | TAB→NONE | `−0.001780` | `[−0.005565, +0.001461]` | 13/9 | 0.523 |
| claude (row-matched) | TAB→PIPE | `−0.002395` | `[−0.007149, +0.001156]` | 12/10 | 0.832 |

**None of the six excludes zero.** The codex and opencode sign tests reproduce `03` exactly. The
claude ones do not, and that is a finding of its own — see §3.

Rep-index spread: opencode TAB reads `$0.008634 / $0.010612 / $0.008549` (24.1% max-over-min),
exactly the draft's exhibit; claude TAB is worse at 28.7% (`$0.021250 / $0.019618 / $0.016505`).

The `6,403` lines is soft. By my measured constants (1.354 tok per gutted line, gutter weight
`$2.596e-7` per token) a `−15%` codex saving needs **5,232 numbered lines per rollout**; `02`'s
6,403 assumes 1.45 tok/line and a mean residency of ~9.8 rather than the measured 16.0. The point —
five to seven times the 878 lines actually delivered — is unaffected.

---

## 3. New findings

1. **Codex tool output tokenises at 3.99 bytes per token, constant across arms and sizes.** [M]
   `p1-capreplay.mjs`: 3.989 (native, 565 untruncated outputs) and 3.987 (sweet, 762), 3.99 on
   outputs over 1,000 tokens. This settles two things the draft leaves open: the epoch-A
   counterfactual (§2, claim 6) and the "native's `rg --files` listings cost about 1.02 bytes per
   token against sweet's 3.5" line in `02` §3.1 (line 213), which is not consistent with anything
   I can measure — a 733-token path listing in the traces is 3,034 bytes including its envelope
   header, about 4 bytes per token, and the whole-arm figure is 3.989.
2. **The `~2,500-token` cap is implemented as a character budget.** [I from M] Delivered sizes
   cluster at 10,207–10,212 B across hundreds of outputs of very different content. A token cap on
   content that varies in bytes-per-token could not cluster in bytes like that; 2,500 tokens ×
   4 chars + envelope ≈ 10,200 chars can. Consequence: the cap bites in proportion to *characters*,
   so any arm whose output is denser per token loses more. It also means "raise the cap" is a
   character-budget change, and `05`'s `tool_output_token_limit` may not be the key at all.
3. **The claude gutter cost divides by 62, not 66.** [M] `data/blocks.ndjson.gz` holds 62 of 66
   claude TAB rollouts, 62 NONE and 64 PIPE (codex and opencode are 66/66/66). The four missing
   TAB rollouts are two reps each of `aio-libs__aiohttp-8038`, `celestiaorg__nmt-192`,
   `fastify__fastify-cors-285` and `protofire__solhint-224`. Every claude per-rollout figure in
   `03` §2.1 and §3 that is a mean over the blocks file is 6.5% high.
4. **The harness's own cache-write asymmetry is worth a quarter of the opencode headline.** [M]
   Charging the 1.25× everywhere moves opencode from `+3.31%` to `+2.52%` and codex from `+0.35%`
   to `+0.06%`. The draft treats this as a cross-harness issue only; it is also an A/B issue,
   because the arms do not write the same number of cache tokens (opencode native 30,356 vs sweet
   28,312 per rollout).
5. **`03`'s claude sign tests are a transcript-selection artefact.** [M] Under the row-matched
   (graded) convention, TAB→PIPE is 12 cheaper / 10 dearer (p = 0.832), not 11/11 (p = 1.000), and
   TAB→NONE is 13/9 (p = 0.523), not 14/8 (p = 0.286). "Claude-code PIPE is cheaper on exactly
   eleven of twenty-two tasks" is a fact about the dearest-3 rule, not about the delimiter.
6. **Text-only claude requests are a bigger term than the gutter, the guide's summary block and
   the wasted calls, and they are not on any lever list.** [C] `logs/synth-statesum2.txt`: 1.05
   requests per rollout that end with no tool call, `$0.000598` per rollout, **3.76% of the claude
   sweet cell** — versus 2.1% for the gutter and 1.9% for wasted calls. Whether they are removable
   is unknown, but they belong in the ranked table.
7. **Opencode's arms did not run under the same concurrency.** [M] `p1-artefacts.mjs`: the native
   arm is entirely `fp-*` at `CONCURRENCY=2`; half of each sweet cell is `rp-*` at
   `CONCURRENCY=1`, which is 0.34% dearer on the same 11 tasks (ideal `$0.010845` vs `$0.010882`,
   cache hit 0.9222 vs 0.9223). About 0.17 points of the opencode `+3.3%` is therefore a
   run-configuration artefact against sweet. Small, but it is an artefact the draft's class-**A**
   row calls "≈ 0" without a number.
8. **The claude paired median in `02` §5 matches neither column.** [M] `p1-conventions.mjs` §C:
   the inclusive per-task median is `−$0.002389` and the main-only median is `−$0.000535`; `02`
   prints `−$0.000485` beside a mean labelled inclusive. The codex (`−$0.001119` vs `−$0.001110`)
   and opencode (`−$0.000208`, exact) medians reproduce.
9. **The gutter is 17.2–17.8% of the code payload it decorates, not 14.6–15.1%.** [M]
   `logs/p1-payload.txt`: stripped payload `$0.001761` (codex), `$0.001904` (opencode),
   `$0.002385` (claude, n = 62) against gutter `$0.000302` / `$0.000338` / `$0.000417`. The payload
   itself is 12.5–20.6% of a rollout, below `03` §8's `$0.0021`–`$0.0030` / 14–24%.
10. **The repair pass did not hand sweet an easier subset.** [M] On the 11 repair tasks the
    surviving `fp-*` rollouts solved 44 of 81 (54.3%) and the `rp-*` rollouts 55 of 99 (55.6%).
    The `NONE` arm's uncorrected 61.4% reproduces exactly, which is the run report's own evidence
    that the deletion bias was real. This supports the draft's artefact classification.
11. **Confirmed clean:** `breakPricedUsd == idealUsd` in all 12 epoch-C cells; cache hit
    0.9056–0.9244 with no arm advantage above 0.8 points; codex and opencode carry zero
    `degenReran` and zero multi-attempt rows in epoch C; one opencode PIPE row
    (`bfgroup__b2-259` rep 2) carries null `f2pFrac` and null `testResults` while `resolved` is
    non-null — the ninth trap the draft proposes is real and I hit it independently.

---

## 4. What I could not finish

- **Whether OpenAI/OpenRouter really bills luna cache writes at 1.25×.** It is a web claim in `06`
  §2.3; I have no bill to check it against, and the runs store no provider-reported cost. The
  consequence (which harness's realized column is the biased one) flips on it.
- **The `+$0.000914` opencode turn term and the other Shapley components.** I checked their size
  by a direct per-request price (`$0.000341` × 3.38 turns) but did not re-implement the symmetric
  split.
- **The wasted-call classification.** I verified the denominators, the per-rollout dollars and the
  form-to-form instability, but did not re-classify the individual crashes, `ENOENT`s and empty
  results from the traces.
- **`03`'s exact fence context.** My re-tokenisation wraps each block in a bare ```` ``` ```` fence;
  `03` says it used "its real fence context". That is the most likely source of the residual 5%
  difference in the direct TAB→PIPE terms.
