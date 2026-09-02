# E3 — why the gutter forms differ in price

**Scope.** The 792 fresh-pool rollouts of epoch C (`fp-*` 2026-08-26 and the `rp-oc-*` repair
pass 2026-08-27): 22 tasks × 3 reps × (native + sweet TAB + sweet NONE + sweet PIPE) × 3
harnesses. Read-only over the traces on the evidence box. No rollout was launched. Nothing
under `results/` was written.

**Method.** Every rollout was re-priced from its own transcript, never from `turns/` and never
from `rows.json` on claude-code. Every fenced `ss-*` code block the agent received was
re-tokenised with `o200k_base` in four renderings — as delivered, with the gutter removed,
with `N<TAB>`, with `N| ` — inside its real fence context. That gives the delimiter's own
token cost exactly, and gives the counterfactual cost of the other two delimiters with
behaviour held fixed.

Tags: **[M]** measured (script and numbers named), **[C]** read from source or a deployed
binary, **[I]** inferred.

---

## 0. Verdict

**The gutter's own token cost is real, small, and the same size on all three harnesses:
`$0.00030`–`$0.00044` per rollout for the shipped tab, which is 2.1–3.7% of a rollout.
It explains half of codex PIPE's `+3.4%`, half of opencode NONE's `−7.4%`, and none at all
of claude-code PIPE's `−14.3%` — where it points the other way.** [M]

Three specific findings.

1. **Codex PIPE `+3.4%` is the delimiter.** [M] Most of the gap is on the input side
   (`+$0.000302` of `+$0.000424`), and **72% of that input increase is literally the extra
   pipe-and-space character**: `+$0.000217` predicted from the delivered bytes alone.

2. **Claude-code PIPE `−14.3%` reverses sign once delegation is held fixed.** [M] On the 12
   tasks that never spawned a subagent in any form, PIPE costs **`+3.5%`** against TAB, and
   that `+3.5%` is what the extra pipe tokens predict. The published `−14.3%` is carried by
   10 tasks; `bfgroup__b2-259` alone carries 62% of it.

3. **NONE loses no ability.** [M][C] Under NONE the agent still issues range reads at the
   same rate — TAB/NONE/PIPE is 7.7/7.3/7.7 on codex, 6.6/6.0/5.5 on opencode, 6.2/6.8/6.6
   on claude-code. The line numbers it needs sit in the **header** lines,
   `# ss-read <file> (lines 280-386 of 386)` and `## #1 <file>:352-385`, which are outside
   the code fence and which `SS_READ_LINENUMS` never touches.

**The cheapest possible gutter is no gutter, and it is worth `$0.00030` (codex, `−2.45%`),
`$0.00034` (opencode, `−3.65%`) and `$0.00044` (claude-code, `−2.12%`) per rollout** if
behaviour does not move. That is `$0.30`–`$0.44` per thousand rollouts. It is not a lever.

---

## 1. What reproduces, and one number that does not

Ten of the twelve published cells reproduce to the last printed digit from the transcripts.

| harness | form | this report | FRESH-POOL-RESULTS | agrees |
|---|---|---:|---:|---|
| codex | native | `$0.012287` | `$0.012287` | exact |
| codex | TAB | `$0.012330` | `$0.012330` | exact |
| codex | NONE | `$0.012319` | `$0.012319` | exact |
| codex | PIPE | `$0.012754` | `$0.012754` | exact |
| opencode | native | `$0.008969` | `$0.008968` | exact (rounding) |
| opencode | TAB | `$0.009265` | `$0.009265` | exact |
| opencode | NONE | `$0.008584` | `$0.008584` | exact |
| opencode | PIPE | `$0.008764` | `$0.008764` | exact |
| claude-code | TAB | `$0.020727` | `$0.020727` | exact |
| claude-code | PIPE | `$0.017761` | `$0.017761` | exact |
| claude-code | NONE | `$0.019424` | `$0.019480` | **−0.29%** |
| claude-code | native | `$0.021437` | `$0.021558` | **−0.56%** |

Sidechain totals reproduce exactly: `$0.185518` / `$0.122539` / `$0.116536` per 66 sweet
rollouts, `$0.284326` on native. Delegating task-cells reproduce exactly: 6 / 6 / 2 sweet,
15 native. [M] `scripts/e3-extract.mjs`

**Two accounting rules were needed to get there, and both are load-bearing.** [C]

- **Codex must not be charged the 1.25× cache-creation surcharge.** `turnsFromRollout`
  (`harness/ideal-cost.mjs:118`) emits `{in, cached, out}` only — it drops
  `cache_write_input_tokens` — so `realFromTurnsUsd` never applies the surcharge on codex.
  Applying it makes every codex cell **7.0% too dear** and it does so uniformly, so the
  form-to-form comparison survives but the cross-harness one does not. Claude-code goes the
  other way: `turnsFromTranscriptFile` does emit `cacheWrite`, and the published claude
  reconstruction charges it.
- **"Take the 3 dearest transcripts per cell" is right for claude-code and wrong for
  opencode.** [M] 13 of 264 cells retained a retry. On opencode, `rows.json` is complete and
  agrees with the reconstruction to `1e-6`, so the three rows *are* the three reps; the blunt
  dearest-3 rule over-charged exactly one cell — `bfgroup__b2-259` opencode PIPE at
  `$0.051474` against the run's own `$0.044784` — and that single cell is the entire
  difference between `$0.008865` and the published `$0.008764`.

**Selection sensitivity on claude-code, stated because it is material.** [M] Under the
published dearest-3 convention the claude spread is TAB `$0.020727`, NONE `$0.019424`
(`−6.3%`), PIPE `$0.017761` (`−14.3%`). Under a rep-from-project-slug rule (keep the dearest
transcript per `-r<N>-` slug) it is `$0.020106` / `$0.018908` (`−6.0%`) / `$0.017685`
(`−12.0%`). **Two points of the claude PIPE gap are a transcript-selection choice, not a
delimiter effect.**

---

## 2. Section A — the direct gutter token cost

### 2.1 The gutter's own bytes, priced

Per rollout, sweet arm. `gutter tok` is `tokens(delivered) − tokens(same block with the
prefix removed)` summed over every fenced `ss-*` block, `o200k_base`, in fence context. Each
block's tokens are charged once at `$0.10/M` in the request after the call, then at `$0.01/M`
in every later request of that rollout. [M] `scripts/e3-tokenise.py`, `scripts/e3-analyse.py`

| harness | form | `$`/rollout | vs TAB | gutter tok | gutter `$` | ingest `$` | resident `$` | gutter share of `$` |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| codex | TAB | `0.012330` | — | 1,163 | `0.000302` | `0.000116` | `0.000186` | 2.45% |
| codex | NONE | `0.012319` | `−0.1%` | 0 | `0` | `0` | `0` | 0% |
| codex | PIPE | `0.012754` | `+3.4%` | 1,903 | `0.000496` | `0.000190` | `0.000306` | 3.89% |
| opencode | TAB | `0.009265` | — | 1,265 | `0.000338` | `0.000126` | `0.000212` | 3.65% |
| opencode | NONE | `0.008584` | `−7.4%` | 0 | `0` | `0` | `0` | 0% |
| opencode | PIPE | `0.008764` | `−5.4%` | 1,973 | `0.000493` | `0.000197` | `0.000296` | 5.63% |
| claude-code | TAB | `0.020727` | — | 1,448 | `0.000440` | `0.000145` | `0.000295` | 2.12% |
| claude-code | NONE | `0.019424` | `−6.3%` | 0 | `0` | `0` | `0` | 0% |
| claude-code | PIPE | `0.017761` | `−14.3%` | 2,267 | `0.000648` | `0.000227` | `0.000421` | 3.65% |

**Two thirds of the gutter's cost is rent, not purchase.** [M] Resident re-sending is 61–67%
of the bill on every harness. A delivered gutter token stays in context for a mean of 15.0 to
19.6 further requests, and `15 × $0.01/M` already exceeds the `$0.10/M` it cost to put there.
This is why a per-line prefix is dearer than its face value: the cache rate is one tenth of
the input rate, so the break-even residence is 10 turns and every rollout here passes it.

### 2.2 The per-line overhead, and one window rendered three ways

| form | tokens per delivered code line | overhead vs no gutter |
|---|---:|---:|
| none | — | 0 |
| `N<TAB>` | +1.341 (codex) · +1.350 (opencode) · +1.345 (claude) | +1.34 |
| `N\| ` | +2.267 · +2.288 · +2.268 | +2.27 |

**PIPE − TAB = +0.93 tokens per line** on all three harnesses. [M] That is the same 0.93 the
2026-08-26 mechanism investigation measured on golden files, recovered here from the bytes
the agents actually received.

The clean exhibit — one 363-line `ss-read` window of `fastify-cors/index.js` delivered in all
three forms, tokenised in fence context: [M] `scripts/e3-exhibits.py`

| form | first delivered line | tokens |
|---|---|---:|
| none | `'use strict'` | 2,313 |
| tab | `1\t'use strict'` | 2,739 (+426, **+1.174/line**, +18.4%) |
| pipe | `1\| 'use strict'` | 3,087 (+774, **+2.132/line**, +33.5%) |

`PIPE − TAB = 0.959 tokens/line` on this window; a second 324-line window
(`markup-it/lib/index.js`) gives `0.932`.

### 2.3 Epoch C numbers every `ss-*` surface — the epoch-B measurement no longer applies

[C] The deployed wrapper `/root/sweet-search-private/eval/agent-read-workflows/bin/_ss-helpers.mjs`
(mtime **2026-08-26 14:15**, before every `fp-*`/`rp-*` run) calls `gutter(...)` at line 454
(`ss-find`), 745 (`ss-search`) and 857 (`ss-semantic`), not only in `cmdRead`. [M] The traces
agree: in the claude-code TAB cell 386 of 422 `ss-search` blocks, 94 of 102 `ss-find` blocks
and 4 of 4 `ss-semantic` blocks carry the delimiter; the other five sweet TAB/PIPE cells are
the same shape.

**So the 27–36% un-numbered share reported for epoch B is gone.** Delivered code lines per
rollout now split 63–75% `ss-read`, 17–26% `ss-search`, 4–16% `ss-find`, 0.4–5%
`ss-semantic`. The gutter footprint measured here is therefore about **45% larger** than an
`ss-read`-only footprint would have been, and this is the first run in which the delimiter's
price is measured on the whole retrieval surface.

The residue is small and explained: 345 of 4,973 blocks in TAB/PIPE cells carry no gutter, and
246 of those are under 15 lines — the `ss-read`-only `>= 15` threshold [C]
`_ss-helpers.mjs:606` (the library mirror is `search-read.js:701`; neither gate applies to
search, find or semantic blocks, which `numberCodeLines` numbers at any length).
Sub-15 `ss-read` blocks are 3.1–7.7% of `ss-read` blocks per cell — 35 of 453 on codex TAB,
23 of 426 on opencode TAB, 27 of 414 on claude TAB. [M] Numbering them too would add about
four delivered lines per rollout, which is **under `$0.000002`**; the threshold is immaterial
either way.

**Integrity check on the whole measurement.** [M] Of 4,628 gutter-bearing blocks, **4,628
start at the exact line number their own header declared** and **0 mismatch**. No native
`cat -n` or `nl` output was mistaken for an `ss-*` gutter. 166 blocks carry a non-consecutive
number run; 165 are codex TAB/PIPE and are the codex middle-out truncation, which deletes a
span and leaves the numbers jumping.

---

## 3. Section B — behaviour per form

Mean per rollout, sweet arm, 66 rollouts per cell. [M] `scripts/e3-analyse.py`

| harness | form | turns | calls | ss-read | ss-search | range reads | whole-file reads | code lines | re-reads | files | codex truncations | edits | edit fails | output tok | new-in tok | re-sent tok |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | TAB | 19.6 | 18.6 | 8.2 | 1.9 | 7.7 | 0.5 | 878 | 1.6 | 4.7 | 1.6 | 1.7 | 0.1 | 5,524 | 34,541 | 548,952 |
| codex | NONE | 19.4 | 18.4 | 7.3 | 2.1 | 7.3 | 0.1 | 905 | 1.2 | 4.3 | 1.5 | 1.9 | 0.1 | 5,676 | 34,183 | 542,398 |
| codex | PIPE | 19.8 | 18.8 | 8.0 | 1.8 | 7.7 | 0.3 | 851 | 1.7 | 4.6 | 1.8 | 1.8 | 0.1 | 5,728 | 35,785 | 566,607 |
| codex | native | 18.8 | 17.8 | — | — | — | — | — | — | — | 3.6 | 1.9 | 0.1 | 5,786 | 35,942 | 515,269 |
| opencode | TAB | 19.7 | 21.8 | 6.6 | 1.5 | 6.6 | 0.0 | 948 | 0.9 | 4.7 | 0 | 1.9 | 0.0 | 3,645 | 28,316 | 424,150 |
| opencode | NONE | 18.9 | 21.9 | 6.0 | 1.7 | 6.0 | 0.0 | 926 | 0.6 | 4.3 | 0 | 1.6 | 0.1 | 3,647 | 26,582 | 373,290 |
| opencode | PIPE | 18.4 | 20.5 | 5.5 | 1.6 | 5.5 | 0.0 | 872 | 0.7 | 3.9 | 0 | 1.8 | 0.1 | 3,479 | 27,260 | 381,596 |
| opencode | native | 16.3 | 25.2 | — | — | — | — | — | — | — | 0 | 1.8 | 0.0 | 3,607 | 30,359 | 376,466 |
| claude-code | TAB | 23.4 | 22.7 | 6.2 | 2.7 | 6.2 | 0.0 | 1,097 | 1.0 | 4.1 | 0 | 3.8 | 0.7 | 7,669 | 38,735 | 786,165 |
| claude-code | NONE | 23.2 | 22.8 | 6.8 | 2.0 | 6.8 | 0.0 | 1,129 | 1.5 | 4.4 | 0 | 4.1 | 0.6 | 8,161 | 37,402 | 778,642 |
| claude-code | PIPE | 21.6 | 21.2 | 6.7 | 2.3 | 6.6 | 0.1 | 1,011 | 1.1 | 4.4 | 0 | 3.1 | 0.4 | 6,009 | 38,862 | 724,568 |
| claude-code | native | 24.3 | 26.4 | — | — | — | — | — | — | — | 0 | 4.7 | 0.8 | 7,395 | 36,534 | 782,770 |

**Range reads do not depend on the gutter.** [M] `ss-read` invocations carrying two explicit
line arguments are 7.7 / 7.3 / 7.7 on codex, 6.6 / 6.0 / 5.5 on opencode, 6.2 / 6.8 / 6.6 on
claude-code. Whole-file `ss-read` calls stay at 0.0–0.5 in every form. NONE does not push the
agent toward whole-file reads. The mechanism is visible in the bytes: under NONE an `ss-read`
result still opens with `# ss-read lib/absinthe/type/built_ins/introspection.ex (lines 280-386
of 386)` and an `ss-search` hit still opens with
`## #1 lib/absinthe/type/built_ins/introspection.ex:352-385 [function: render_default_value]`.
Both are outside the fence, and `numberCodeLines` only ever touches text inside it. [C]

**Read windows are the same size in every form.** [M] Median delivered `ss-read` block: codex
70 / 82 / 71 lines, opencode 90 / 91 / 87, claude 81 / 81 / 72. p90: 189 / 215 / 187,
218 / 222 / 241, 195 / 181 / 180.

**Codex truncation is a native problem, not a gutter problem.** [M] Tool outputs carrying
`Warning: truncated output (original token count:` — sweet TAB 105 (39/66 rollouts), NONE 100
(34/66), PIPE 120 (34/66); **native 238 (61/66)**. Native `sed -n` reads are unbudgeted and
hit the ~2,500-token cap 2.3× as often as budgeted `ss-read` output does. Between the sweet
forms the difference is 20 truncations across 66 rollouts. The cap itself was measured at
2,459/2,511 tokens by the 2026-08-26 mechanism investigation; this run does not re-measure it.

**Edit failures carry no delimiter signal, and one census defect was found and fixed.** [M]

| harness | form | edit calls | failed | rollouts with ≥1 failure | classes |
|---|---|---:|---:|---:|---|
| codex | TAB | 112 | 8 | 5/66 | seek_lines 4, parse 1, seek_context 1, other 2 |
| codex | NONE | 124 | 5 | 3/66 | seek_lines 4, other 1 |
| codex | PIPE | 121 | 4 | 4/66 | seek_lines 4 |
| codex | native | 124 | 8 | 7/66 | seek_lines 8 |
| opencode | TAB | 123 | 0 | 0/66 | — |
| opencode | NONE | 106 | 7 | 6/66 | seek_lines 7 |
| opencode | PIPE | 120 | 4 | 4/66 | seek_lines 4 |
| opencode | native | 117 | 3 | 3/66 | seek_lines 3 |
| claude-code | TAB | 252 | 45 | 19/66 | not-found 15, ambiguous 11, noop 13, invalid-input 6 |
| claude-code | NONE | 269 | 40 | 15/66 | not-found 12, noop 16, ambiguous 5, invalid-input 6, other 1 |
| claude-code | PIPE | 206 | 26 | 16/66 | not-found 9, ambiguous 9, noop 4, invalid-input 3, other 1 |
| claude-code | native | 312 | 54 | 18/66 | not-found 24, ambiguous 12, noop 14, invalid-input 3, other 1 |

**The census defect:** opencode writes a failed tool's message into `state.error` and leaves
`state.output` empty. A parser reading only `output` classifies every one of these failures as
"other, status=error" with **zero bytes to show** — 11 on the sweet arm here and 3 more on
native. The bytes are there:

```
"error": "apply_patch verification failed: Error: Failed to find expected lines in
 /root/.ss-eval/runs/r0-16/src/serializers/LogSerializer.ts:\n      // future it may make
 sense to introduce a higher-order\n      // representation for sink-specific validations\n
 const keys = Object.keys(d).slice(0, Constants.MAX_DIMENSIONS);…"
```
Path: `rp-oc-none-20260827/agent-state/awslabs__aws-embedded-metrics-node-21-sweet/`
`opencode-retained/session-1787864928692-1854659-d7ee94b6/attempt-1.stdout.ndjson`

Every opencode failure in every form is `Failed to find expected lines` — the 4-pass seek
missing its context. [C] Pass three of that seek compares `line.trim()` to `pattern.trim()`
(`packages/opencode/src/patch/index.ts`), so a leaked leading space cannot cause it. **No
opencode edit failure in this run can be a gutter effect.**

Claude-code's ranking is TAB 17.9% > NONE 14.9% > PIPE 12.6% of edit calls — the **opposite**
of the 2026-08-13 anchor result that the tab was adopted for, and at 19/15/16 rollouts-with-
failure it is flat. That is worth its own note but it is not a cost mechanism: `noop` and
`invalid-input` are not delimiter-related, and `not-found`/`ambiguous` are equally common on
native, which never sees a gutter at all.

---

## 4. Section C — delegation on claude-code

[M] `scripts/e3-budget.py`

| form | rollouts | delegating rollouts | delegating task-cells | sidechain `$` total | sidechain `$`/rollout | main `$`/rollout | total `$`/rollout |
|---|---:|---:|---:|---:|---:|---:|---:|
| TAB | 66 | 9 | 6 | `0.185518` | `0.002811` | `0.017917` | `0.020727` |
| NONE | 66 | 9 | 6 | `0.122539` | `0.001857` | `0.017567` | `0.019424` |
| PIPE | 66 | 6 | **2** | `0.116536` | `0.001766` | `0.015996` | `0.017761` |
| native | 66 | 27 | 15 | `0.284326` | `0.004308` | `0.017129` | `0.021437` |

The delegating cells are named, and they barely overlap:

- TAB: `asynkron__protoactor-dotnet-1909`, `awslabs__aws-embedded-metrics-node-21`,
  `bfgroup__b2-113`, `bfgroup__b2-259`, `fastify__fastify-cors-285`, `final-form__final-form-64`
- NONE: `aio-libs__aiohttp-8038`, `bfgroup__b2-113`, `bfgroup__b2-259`,
  `devlooped__moq-1262`, `gitbookio__markup-it-56`, `protofire__solhint-224`
- PIPE: `bfgroup__b2-113`, `bfgroup__b2-259`

**Only two tasks delegate in all three forms. Four TAB cells and four NONE cells delegate
where the other forms do not. That is a coin flip with a large stake.** [M][I]

### Delegation held fixed

Twelve of the 22 tasks spawned no subagent in any form, in any rep. Pairing on those twelve
(36 rollouts per form) removes the coin flip entirely:

| task set | form | main `$`/rollout | sidechain `$`/rollout | total | vs TAB |
|---|---|---:|---:|---:|---:|
| zero-delegation, n=12 | TAB | `0.010913` | `0` | `0.010913` | — |
| zero-delegation, n=12 | NONE | `0.010223` | `0` | `0.010223` | **`−6.3%`** |
| zero-delegation, n=12 | PIPE | `0.011297` | `0` | `0.011297` | **`+3.5%`** |
| the other 10 | TAB | `0.026321` | `0.006184` | `0.032505` | — |
| the other 10 | NONE | `0.026380` | `0.004085` | `0.030465` | `−6.3%` |
| the other 10 | PIPE | `0.021634` | `0.003885` | `0.025519` | `−21.5%` |

**On the clean twelve, PIPE is `+3.5%` dearer than TAB — the sign the delimiter's own tokens
predict, and close to their size.** The direct prediction on that subset is `+$0.000142` per
rollout against an observed `+$0.000385`, and the bootstrap CI of the observed delta is
`[−0.000304, +0.001025]`, so the direct token cost sits inside it. [M]

**NONE holds its `−6.3%` on both subsets.** That is the one claude-code form difference that
does not move when delegation is removed, and about a third of it (`$0.000201` of `$0.000689`
on the clean subset) is the tab's own tokens.

---

## 5. Section D — is any of it outside noise?

Bootstrap over tasks: resample the 22 task ids with replacement, 10,000 draws, seed 20260828,
all reps of a drawn task travel together. [M] `scripts/e3-analyse.py`, `scripts/e3-budget.py`

| harness | pair | delta `$`/rollout | 95% CI | % vs TAB | CI excludes 0 |
|---|---|---:|---|---:|---|
| codex | TAB→NONE | `−0.000011` | `[−0.000964, +0.001172]` | `−0.1%` | no |
| codex | TAB→PIPE | `+0.000424` | `[−0.000600, +0.001447]` | `+3.4%` | no |
| opencode | TAB→NONE | `−0.000681` | `[−0.001512, +0.000050]` | `−7.4%` | no |
| opencode | TAB→PIPE | `−0.000501` | `[−0.001320, +0.000238]` | `−5.4%` | no |
| claude-code | TAB→NONE | `−0.001304` | `[−0.005690, +0.003184]` | `−6.3%` | no |
| claude-code | TAB→PIPE | `−0.002966` | `[−0.008137, +0.001151]` | `−14.3%` | no |

**Not one of the six intervals excludes zero.** [M]

**The direct answer to the question asked: yes, claude-code PIPE `−14.3%` is inside the CI
once delegation is held fixed — and it is inside the CI even when it is not.** The
`TAB→PIPE` interval on the full pool runs from `−$0.0081` to `+$0.0012`, and the delimiter's
own predicted cost, `+$0.000328`, lies inside it. Holding delegation fixed, the main-only
interval on the clean twelve is `[−0.000304, +0.001025]` around `+$0.000385`, and the
prediction `+$0.000142` is inside that too. **The same data are compatible with PIPE being
14% cheaper and with PIPE being 3.5% dearer. Only the second has a mechanism.**

Paired sign test over the 22 tasks (mean of 3 reps per cell), two-sided exact binomial: [M]

| harness | pair | cheaper | dearer | p |
|---|---|---:|---:|---:|
| codex | TAB→NONE | 13 | 9 | 0.523 |
| codex | TAB→PIPE | 9 | 13 | 0.523 |
| opencode | TAB→NONE | 10 | 12 | 0.832 |
| opencode | TAB→PIPE | 13 | 9 | 0.523 |
| claude-code | TAB→NONE | 14 | 8 | 0.286 |
| claude-code | TAB→PIPE | **11** | **11** | **1.000** |

**Claude-code PIPE is cheaper on exactly eleven of twenty-two tasks.** Its `−14.3%` is
carried by three tasks (82% of the gap) and by one task (`bfgroup__b2-259`, `−$0.0407` per
rollout, 62% of the gap). [M] `scripts/e3-pertask.py`

Concentration on the other two harnesses is milder but present: codex's `+3.4%` has its top
three tasks at 46% of the gap, opencode's PIPE gap 50%.

**Pairing is done per task, not per rep.** Reps are independent stochastic samples of the
same (task, form) cell; rep 1 of TAB and rep 1 of PIPE share nothing but their index, so a
per-rep pairing adds no matching and only removes degrees of freedom. Rep index is still
worth printing, as a noise floor. [M] Cost per rollout by rep index inside one cell —
opencode TAB reads `$0.008634` / `$0.010612` / `$0.008549` across reps 0/1/2. **A single rep
of a single form moves 23%, which is larger than every form-to-form difference in this
report.** (On claude-code the dearest-3 convention breaks the rep mapping, so its per-rep
counts are 23/21/22 rather than 22/22/22; the figures are in the JSON under
`exhibits.costByRepIndex`.)

---

## 6. Section E — the same table on `idealCost` and `breakPriced`

[M] `contextRewrites` is 0 on every one of the 792 rollouts, so `breakPricedUsd` equals
`idealUsd` by construction — no form deletes, evicts or reorders context. The gutter is an
append-only change, which is exactly the case in which the two columns agree.

| harness | form | realized `$` | ideal `$` | breakPriced `$` | ideal vs TAB | breakPriced vs TAB |
|---|---|---:|---:|---:|---:|---:|
| codex | TAB | `0.012330` | `0.012258` | `0.012258` | — | — |
| codex | NONE | `0.012319` | `0.012248` | `0.012248` | `−0.1%` | `−0.1%` |
| codex | PIPE | `0.012754` | `0.012681` | `0.012681` | `+3.5%` | `+3.5%` |
| opencode | TAB | `0.009265` | `0.009260` | `0.009260` | — | — |
| opencode | NONE | `0.008584` | `0.008579` | `0.008579` | `−7.4%` | `−7.4%` |
| opencode | PIPE | `0.008764` | `0.008630` | `0.008630` | `−6.8%` | `−6.8%` |
| claude-code | TAB | `0.020727` | `0.019333` | `0.019333` | — | — |
| claude-code | NONE | `0.019424` | `0.018299` | `0.018299` | `−5.3%` | `−5.3%` |
| claude-code | PIPE | `0.017761` | `0.016398` | `0.016398` | `−15.2%` | `−15.2%` |

Realized runs above ideal by 0.05% on opencode, 0.59% on codex and 7.21% on claude-code —
the claude gap is the 1.25× cache-creation surcharge, which the cache-normalised column does
not charge. **No conclusion in this report changes column to column.**

---

## 7. Section F — the mechanistic budget

Every dollar of every form-to-form gap, assigned. `direct` is measured on the TAB cell's own
delivered blocks with the other delimiter substituted, so behaviour is held at TAB's
behaviour. `delegation` is the sidechain bill. `behaviour` is the remainder. [M]
`scripts/e3-budget.py`

| harness | pair | observed | direct (gutter tokens) | delegation | behaviour | 95% CI on observed | direct inside CI |
|---|---|---:|---:|---:|---:|---|---|
| codex | TAB→NONE | `−0.000011` | `−0.000302` | `0` | `+0.000291` | `[−0.000964, +0.001172]` | yes |
| codex | TAB→PIPE | `+0.000424` | `+0.000217` | `0` | `+0.000207` | `[−0.000600, +0.001447]` | yes |
| opencode | TAB→NONE | `−0.000681` | `−0.000338` | `0` | `−0.000343` | `[−0.001512, +0.000050]` | yes |
| opencode | TAB→PIPE | `−0.000501` | `+0.000248` | `0` | `−0.000749` | `[−0.001320, +0.000238]` | **no (just)** |
| claude-code | TAB→NONE | `−0.001304` | `−0.000440` | `−0.000954` | `+0.000091` | `[−0.005690, +0.003184]` | yes |
| claude-code | TAB→PIPE | `−0.002966` | `+0.000328` | `−0.001045` | `−0.002248` | `[−0.008137, +0.001151]` | yes |

The behaviour term splits cleanly into "the model wrote more" and "the model read more":

| harness | form | output tok | output `$` | input `$` | sidechain `$` | Δ output | Δ input | Δ sidechain | Δ total |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | TAB | 5,524 | `0.003315` | `0.009016` | 0 | — | — | — | — |
| codex | NONE | 5,676 | `0.003406` | `0.008914` | 0 | `+0.000091` | `−0.000102` | 0 | `−0.000011` |
| codex | PIPE | 5,728 | `0.003437` | `0.009317` | 0 | `+0.000122` | `+0.000302` | 0 | `+0.000424` |
| opencode | TAB | 3,645 | `0.002187` | `0.007078` | 0 | — | — | — | — |
| opencode | NONE | 3,647 | `0.002188` | `0.006396` | 0 | `+0.000001` | `−0.000682` | 0 | `−0.000681` |
| opencode | PIPE | 3,479 | `0.002088` | `0.006676` | 0 | `−0.000099` | `−0.000402` | 0 | `−0.000501` |
| claude-code | TAB | 7,669 | `0.004601` | `0.013315` | `0.002811` | — | — | — | — |
| claude-code | NONE | 8,161 | `0.004897` | `0.012671` | `0.001857` | `+0.000295` | `−0.000645` | `−0.000954` | `−0.001304` |
| claude-code | PIPE | 6,009 | `0.003605` | `0.012391` | `0.001766` | `−0.000996` | `−0.000925` | `−0.001045` | `−0.002966` |

### The budget in words, per harness

**Codex — the delimiter, cleanly.** Observed `+$0.000424` for PIPE. `+$0.000302` of it is on
the input side and `+$0.000217` of *that* is the extra pipe character itself: **72% of the
input-side penalty is the delimiter's own tokens**. The remaining `+$0.000085` of input is
0.2 more turns and 3.2% more re-sent context (566,607 tokens against 548,952) on 26 *fewer*
delivered code lines. The `+$0.000122` output-side term is 204 more output tokens, which
is noise at this n. **TAB→NONE should have saved `$0.000302` and saved only `$0.000011`:
the behaviour term ate the rest, because codex NONE delivered 27 more code lines per rollout
than TAB.**
So on codex the delimiter has a measurable price and the gutter itself does not.

**Opencode — half token, half fewer reads.** TAB→NONE `−$0.000681` is 50% the tab's own
tokens (`−$0.000338`) and 50% fewer retrieved bytes: 6.0 `ss-read` calls against 6.6, 926 code
lines against 948, 18.9 turns against 19.7. TAB→PIPE is the awkward one: the delimiter
predicts `+$0.000248` and the cell came in `−$0.000501`, so behaviour must supply
`−$0.000749`. It does — opencode PIPE issued the fewest reads of any cell (5.5 `ss-read`, 872
code lines, 3.9 distinct files, 18.4 turns) — but nothing about a pipe character causes that,
and this is the only budget line whose direct term falls outside the resampling interval, by
`$0.00001`. **[I] Read it as an unlucky draw on a 22-task pool, not as a mechanism.**

**Claude-code — delegation and verbosity, with the delimiter pointing the other way.**
Observed `−$0.002966` for PIPE decomposes as `−$0.001045` sidechain, `−$0.000996` output
tokens (1,660 fewer per rollout, `−22%`), `−$0.000925` input. The delimiter predicts
`+$0.000328` on the input side, so **the entire `−14.3%` is behaviour and delegation, and the
delimiter works against it.** Held at zero delegation the residual disappears and PIPE reads
`+3.5%`. TAB→NONE is different: `−$0.000954` of its `−$0.001304` is sidechain, `−$0.000645`
is input (of which `−$0.000440` is the tab's own tokens), and `+$0.000295` is 492 more output
tokens. **NONE is the only claude-code form difference with a token mechanism pointing the
right way, and it is `$0.00044` per rollout of mechanism inside a `$0.0013` observed gap.**

---

## 8. Section G — what the cheapest gutter would save

Behaviour held fixed, measured on the delivered blocks of each cell. [M]

| harness | shipped (`N<TAB>`) `$`/rollout | drop the gutter entirely | % | per 1,000 rollouts | switching a PIPE deployment back to TAB |
|---|---:|---:|---:|---:|---:|
| codex | `0.012330` | `−$0.000302` | `−2.45%` | `−$0.30` | `−$0.000194` (`−1.52%`) |
| opencode | `0.009265` | `−$0.000338` | `−3.65%` | `−$0.34` | `−$0.000196` (`−2.24%`) |
| claude-code | `0.020727` | `−$0.000440` | `−2.12%` | `−$0.44` | `−$0.000258` (`−1.46%`) |

**The whole gutter, on every surface, on the harness where it is dearest, is 3.65% of a
rollout.** Removing it from every numbered cell of this run — the six sweet TAB and PIPE
cells, 396 rollouts — would have saved **`$0.179`** of the run's `$6.9`.

For scale: the delivered `ss-*` code payload itself — the lines, not their prefixes — costs
`$0.0021`–`$0.0030` per rollout, which is 14–24% of a rollout. **The tab gutter is about 15%
of the code payload it decorates (14.6% codex, 15.1% opencode, 14.9% claude-code), and the
payload, not the prefix, is where a retrieval-side cost lever would have to live.** [M]

---

## 9. What this changes in FRESH-POOL-RESULTS

1. **"Codex PIPE `+3.4%` is the one cost difference with a mechanism" is confirmed and now
   quantified.** [M] 72% of its input-side penalty is the delimiter's own tokens,
   `+0.93 tok/line`, `+$0.000217` per rollout.
2. **"The claude-code spread tracks subagent spawn counts, not gutter tokens" is confirmed,
   and is stronger than stated.** [M] Held at zero delegation the claude PIPE difference
   *reverses* to `+3.5%`. The report's caution — "must not be read as a delimiter effect" —
   should be sharpened to "reads backwards".
3. **`−14.3%` should carry a selection caveat.** [M] Two of those points come from the
   dearest-3 transcript convention; a rep-slug rule gives `−12.0%`.
4. **The published opencode PIPE figure `$0.008764` is right and my first reconstruction was
   wrong.** The dearest-3 rule mis-picks one opencode cell. Use `rows.json` on opencode and
   codex; use transcripts on claude-code.
5. **The epoch-B statement "only ss-read carries a gutter in the benchmark" no longer holds
   for this run.** [C][M] Every `ss-*` surface was numbered during epoch C. 98.7% of delivered
   code lines in the TAB and PIPE cells carry the gutter; `ss-read` supplies only 63–75% of
   them, so an `ss-read`-only measurement would have missed a third of the footprint.
6. **The opencode edit-failure census needs `state.error`.** [M] Reading only `state.output`
   loses the text of every failed `apply_patch` — 14 in this run, 11 sweet and 3 native.

---

## 10. Threats to these numbers

- **Attribution model.** [I] The ingest/resident split assumes append-only context, one
  ingest at the request after the call and cache-rate re-sends afterwards. That is exactly
  what `costFromTurns` computes [C], and `contextRewrites = 0` everywhere confirms nothing
  rewrote context [M]. On claude-code the realized ingest is 1.25× on tokens written into the
  prompt cache, so the claude gutter figures are a **lower bound by at most 25% of their
  ingest third**, i.e. up to `+$0.00004` per rollout.
- **Block attribution.** 345 of 4,973 blocks in the TAB/PIPE cells were captured with no
  gutter — **4,646 of 362,604 delivered lines, 1.3%**. 246 blocks (1,686 lines, 0.46%) are
  sub-15-line `ss-read` results; the other 99 blocks (2,960 lines, 0.82%) are fences emitted
  by a later command on the same shell line, inheriting the `ss-*` header. They contribute
  exactly 0 to every gutter figure, and they bound the over-count of "delivered code lines"
  at 0.8%. [M]
- **n = 22 tasks.** Every interval in §5 contains zero. Nothing here should be read as a
  ranking of the forms.
- **Delegation subsetting is post-hoc.** The 12 zero-delegation tasks were chosen by looking
  at the outcome. It is the right control for the mechanism question and the wrong one for a
  headline; I report it as a decomposition, not as a result.
- **One residual outside its interval.** opencode TAB→PIPE, direct `+$0.000248` against a CI
  upper bound of `+$0.000238`. Marginal, one-sided, one cell of six.

## 11. Reproduction

Scripts, all under
`eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/scripts/`:

| script | what it does | runs on |
|---|---|---|
| `e3-sample.mjs` | dumps one `ss-read` / `ss-search` result per harness × form, so the delivered form is read not assumed | box |
| `e3-extract.mjs` | re-prices every rollout from its own transcript; extracts every fenced `ss-*` block with its ingest/resident weights and behaviour counters. `CLAUDE_SELECT=rep` switches the claude transcript-selection rule | box |
| `e3-validate.mjs` | reconstruction vs `rows.json`, per run and arm; transcripts-per-cell histogram | box |
| `e3-ocpipe-recon.mjs` | isolates the one cell behind the opencode PIPE discrepancy | box |
| `e3-editfail.mjs` | prints the bytes of every sweet-arm edit failure | box |
| `e3-tokenise.py` | `o200k_base` counts of each block in four renderings | local (`/tmp/tk` venv) |
| `e3-analyse.py` | sections A, B, C, D, E, F, H, I; writes the JSON | local |
| `e3-budget.py` | the mechanistic budget, the delegation split, the counterfactual | local |
| `e3-pertask.py` | per-task pairing, gap concentration, resident profile | local |
| `e3-exhibits.py` | one window in three forms, header exhibit, threshold census, integrity check | local |
| `e3-appendjson.py` | folds the exhibits into the JSON | local |

```bash
# box side (read-only)
ssh root@167.233.69.121 'mkdir -p /tmp/fp-inv/e3'
for f in e3-extract.mjs e3-validate.mjs e3-ocpipe-recon.mjs e3-editfail.mjs e3-sample.mjs; do
  ssh root@167.233.69.121 "cat > /tmp/fp-inv/e3/$f" < scripts/$f
done
ssh root@167.233.69.121 'cd /tmp/fp-inv/e3 && node --max-old-space-size=8192 e3-extract.mjs \
  && CLAUDE_SELECT=rep node --max-old-space-size=8192 e3-extract.mjs \
  && gzip -kf blocks.ndjson rollouts.ndjson rollouts-repsel.ndjson'
for f in blocks.ndjson.gz rollouts.ndjson.gz rollouts-repsel.ndjson.gz; do
  scp root@167.233.69.121:/tmp/fp-inv/e3/$f data/; done

# local side
python3 -m venv /tmp/tk && /tmp/tk/bin/pip install tiktoken
/tmp/tk/bin/python scripts/e3-tokenise.py data/blocks.ndjson.gz data/blocks-tok.ndjson
/tmp/tk/bin/python scripts/e3-analyse.py   > logs/e3-analysis.txt
/tmp/tk/bin/python scripts/e3-budget.py    > logs/e3-budget.txt
/tmp/tk/bin/python scripts/e3-pertask.py   > logs/e3-pertask.txt
/tmp/tk/bin/python scripts/e3-exhibits.py  > logs/e3-exhibits.txt
/tmp/tk/bin/python scripts/e3-appendjson.py
```

Intermediates kept in `data/` (4.1 MB of blocks, 86 KB of rollouts, gzipped). Full console
output in `logs/e3-*.txt`. Every number in this report is in `03-gutter-form-cost.json`.

`/tmp/fp-inv/e2/rollout-costs.json` did not exist on the box when this task ran, so all
costs here are computed from scratch by `e3-extract.mjs`; §1 is the reconciliation against
the published figures that a shared file would otherwise have supplied.
