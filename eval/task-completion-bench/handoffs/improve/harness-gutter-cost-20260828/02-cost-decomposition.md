# E2 — Why sweet is expensive now: a cost decomposition over three epochs and three harnesses

**Method.** Every one of **1,311 rollouts** was re-priced from its own transcript, per turn, at
`$0.10/M` new input, `$0.01/M` re-sent (cached) input, `$0.60/M` output including reasoning.
Nothing is taken from `rows.json` cost columns except as a check.
**Scripts:** `scripts/e2-*.mjs` (copies on the box at `/tmp/fp-inv/e2/`).
**Per-rollout components:** `02-cost-decomposition.json` here, and
`/tmp/fp-inv/e2/rollout-costs.json` on the box (that copy also keeps the per-turn arrays).
**Raw script output:** `logs/e2-*.txt`.

Tags: **[M]** measured in a trace, **[C]** read from source or a deployed binary,
**[I]** inferred, **[W]** web.

---

## 0. Verdict

**Sweet is not expensive. Sweet stopped being cheap, and on codex the reason is that the
harness started doing sweet's job for free.** Between the 2026-08-11 runs and the
2026-08-25/26 runs, codex tightened its per-output ceiling to about 2,500 tokens
(10,212–10,216 delivered bytes). Epoch A truncated too, but far higher — a 10,274-token
output was still being truncated there, and its largest delivered output was 41,301 bytes.
Native's reads are the ones that hit the new ceiling; sweet's budgeted reads mostly sit
under it. Replaying epoch A's own transcripts under the new ceiling moves codex from
**−6.5% to +11.5%** — a bigger swing than the +6.8 points actually observed. [M]

The three harnesses flipped for three different reasons, and only one of them is about
sweet-search at all:

| harness | epoch A → C | the single largest cause, measured |
|---|---|---|
| codex | −6.5% → +0.3% | codex's delivered-output ceiling fell to a hard 10,214 B (largest epoch-A output: 41,301 B); it now deletes **40% of native's tool payload for free** and only 15% of sweet's [M] |
| opencode | −17.8% → +3.3% | sweet now takes **+3.38 turns** per task against native (it took −0.44 in epoch A); that alone is **+10.2%** of the arm [M] |
| claude-code | +2.2% → −1.4% main-only, −8.9% → −8.8% inclusive | no flip at all; the inclusive figure is stable and is a **delegation** effect, not a retrieval effect [M] |

**Three facts that must be carried into every later reading.**

1. **The instruction file costs exactly 1,457 tokens on every turn of every sweet rollout.**
   It is the same number on codex and opencode, on every task, in every epoch: a constant,
   not an estimate. That is **+3.5%** of a codex rollout and **+4.6%** of an opencode one,
   before retrieval has saved anything. [M][C]
2. **Epoch C is not the same treatment as epoch B.** Commit `ba5b4ee` landed at
   2026-08-26 16:14 and the first fp-* rollout started at 22:27, so the fresh-pool sweet arm
   numbers search hits that epoch B left raw: **4.7% of search-surface code lines were
   numbered in epoch B, 94–96% in epoch C.** [M]
3. **The published claude-code fresh-pool cost used a transcript-selection rule that
   substitutes discarded work for graded work.** Re-pricing each rollout against the
   transcript the harness itself graded reproduces `rows.json` to six decimals on 342 of 342
   rows and moves claude-code TAB from **−3.9% to −8.8%**. On a third convention — every
   dollar actually spent — it becomes **+1.9%**. [M]

---

## 1. Method and validation

Per-turn usage was read from each harness's own records:

| harness | turn record | fields |
|---|---|---|
| codex | `token_count` → `payload.info.last_token_usage` | `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens` |
| opencode | `step_finish` → `part.tokens` | `input`, `output`, `reasoning`, `cache.read`, `cache.write` |
| claude-code | assistant `message.usage`, deduped by `message.id`, usage-bearing record wins | `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens` |

Each rollout was matched to its own transcript, never to a cell average:

- **codex** — `rows.json` names `rolloutFile`. The `cwd` inside every file encodes the rep
  (`/root/.ss-eval/runs/r<rep>-<slot>`). **132 of 132 checked, 0 mismatches.** [M]
- **opencode** — `rows.json` names `openCodeRawAttempts[].stdout`. [M]
- **claude-code** — the project directory slug encodes the rep
  (`-root--ss-eval-runs-r<rep>-<slot>`; epoch A uses `--r<rep>--<slot>`). Where a cell holds
  more sessions than reps, the row's own `usage` aggregate identifies the graded one. [M]

**Validation against the harness's own columns:**

| harness | rows compared | agreement |
|---|---:|---|
| codex | 410 | `idealCostUsd` max abs error **$0.000001** (rounding) |
| opencode | 491 | `idealCostUsd` max abs error **$0.000001** |
| claude-code | 342 (every row that carries the column) | `costRealizedMainOnlyUsd` max abs error **$0.000000** |
| claude-code sidechain | 270 | `costSidechainUsd` matches on 269; one `rb` row differs by $0.006524 (see §9.2) |

Two codex rows in `sb-codex-20260811` differ by ≤ $0.000935 on realized while matching
exactly on ideal; that column came from a different source in epoch A. Everything else ties.

---

## 2. Where the money goes

### 2.1 One rollout, epoch C, decomposed (per rollout, mean)

| harness / arm | inclusive $ | INGEST $ | % | RESIDENT $ | % | OUTPUT $ | % | sidechain $ | % | billing surcharge $ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex native | 0.012287 | 0.003594 | 29.4% | 0.005153 | 42.2% | 0.003472 | 28.4% | — | — | 0.000069 |
| codex sweet TAB | 0.012330 | 0.003454 | 28.2% | 0.005490 | 44.8% | 0.003315 | 27.0% | — | — | 0.000072 |
| opencode native | 0.008969 | 0.003036 | 33.9% | 0.003765 | 42.0% | 0.002164 | 24.1% | — | — | 0.000005 |
| opencode sweet TAB | 0.009265 | 0.002832 | 30.6% | 0.004242 | 45.8% | 0.002187 | 23.6% | — | — | 0.000005 |
| claude-code native | 0.020972 | 0.003656 | 18.5% | 0.007824 | 39.6% | 0.003849 | 19.5% | 0.004429 | 22.4% | 0.001213 |
| claude-code sweet TAB | 0.019125 | 0.003855 | 22.0% | 0.007735 | 44.1% | 0.003149 | 17.9% | 0.002811 | 16.0% | 0.001575 |

INGEST + RESIDENT + OUTPUT is the exact `idealCostUsd` identity. "Billing surcharge" is
realized minus ideal: the provider's 1.25× charge on cache-creation tokens plus any real
cache miss. It is negligible on codex and opencode (≤ 0.6% of the arm) and is **7.3% of
claude-code's native main cost and 9.7% of its sweet main cost**. [M]
The percentage columns are shares of `ideal + sidechain`, which is the quantity the three
components add up to; the surcharge is shown separately so the identity stays exact.

**Re-sent context is the largest single line item in every arm** — 40–46% of spend. The
model pays $0.01/M to re-read its own transcript on every turn, and it does that 16 to 24
times.

### 2.2 Full cell table (per rollout, mean)

| epoch | harness | arm | n | solved | realized $ | ideal $ | breakPriced $ | inclusive $ | turns | calls | context integral (tok) | first turn (tok) | tool bytes |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | codex | native | 34 | 18 | 0.008592 | 0.008510 | 0.008510 | 0.008592 | 11.4 | 10.4 | 307,414 | 13,277 | 68,435 |
| A | codex | sweet | 34 | 19 | 0.008040 | 0.007960 | 0.007960 | 0.008040 | 12.4 | 11.4 | 290,574 | 14,734 | 43,847 |
| B | codex | native | 39 | 20 | 0.010836 | 0.010775 | 0.010775 | 0.010836 | 16.7 | 15.7 | 441,334 | 14,147 | 66,114 |
| B | codex | sweet | 39 | 16 | 0.010236 | 0.010177 | 0.010177 | 0.010236 | 16.3 | 15.3 | 417,285 | 15,604 | 49,315 |
| C | codex | native | 66 | 41 | 0.012287 | 0.012218 | 0.012218 | 0.012287 | 18.8 | 17.8 | 551,210 | 14,359 | 70,234 |
| C | codex | sweet TAB | 66 | 39 | 0.012330 | 0.012258 | 0.012258 | 0.012330 | 19.6 | 18.6 | 583,492 | 15,816 | 57,490 |
| C | codex | sweet NONE | 66 | 41 | 0.012319 | 0.012248 | 0.012248 | 0.012319 | 19.4 | 18.4 | 576,581 | 15,816 | 57,019 |
| C | codex | sweet PIPE | 66 | 42 | 0.012754 | 0.012681 | 0.012681 | 0.012754 | 19.8 | 18.8 | 602,393 | 15,816 | 59,792 |
| A | opencode | native | 34 | 17 | 0.007971 | 0.007967 | 0.007967 | 0.007971 | 15.2 | 22.8 | 330,240 | 6,911 | 64,805 |
| A | opencode | sweet | 34 | 17 | 0.006556 | 0.006552 | 0.006552 | 0.006556 | 14.8 | 17.0 | 268,279 | 8,368 | 44,996 |
| B | opencode | native | 39 | 19 | 0.008705 | 0.008701 | 0.008701 | 0.008705 | 15.9 | 26.2 | 363,942 | 6,653 | 73,187 |
| B | opencode | sweet | 39 | 17 | 0.008465 | 0.008460 | 0.008460 | 0.008465 | 18.1 | 20.1 | 378,319 | 8,110 | 52,931 |
| C | opencode | native | 66 | 41 | 0.008969 | 0.008964 | 0.008964 | 0.008969 | 16.3 | 25.2 | 406,824 | 6,898 | 71,912 |
| C | opencode | sweet TAB | 66 | 41 | 0.009265 | 0.009260 | 0.009260 | 0.009265 | 19.7 | 21.8 | 452,466 | 8,355 | 63,369 |
| C | opencode | sweet NONE | 66 | 39 | 0.008584 | 0.008579 | 0.008579 | 0.008584 | 18.9 | 21.9 | 399,872 | 8,355 | 57,675 |
| C | opencode | sweet PIPE | 66 | 38 | 0.008764 | 0.008630 | 0.008630 | 0.008764 | 18.4 | 20.5 | 408,855 | 8,355 | 57,791 |
| A | claude-code | native | 34 | 15 | 0.012783 | 0.011719 | 0.011719 | 0.015096 | 19.5 | 21.8 | 563,686 | 17,630 | 50,779 |
| A | claude-code | sweet | 34 | 14 | 0.013063 | 0.011998 | 0.011998 | 0.013759 | 18.1 | 17.6 | 573,740 | 19,217 | 49,591 |
| B | claude-code | native | 39 | 18 | 0.014949 | 0.013774 | 0.013774 | 0.018668 | 22.7 | 25.2 | 691,043 | 17,432 | 58,296 |
| B | claude-code | sweet | 39 | 16 | 0.012896 | 0.011820 | 0.011820 | 0.012896 | 18.5 | 17.9 | 580,308 | 19,002 | 55,668 |
| C | claude-code | native | 66 | 43 | 0.016542 | 0.015329 | 0.015329 | 0.020972 | 24.3 | 26.4 | 818,991 | 17,674 | 60,077 |
| C | claude-code | sweet TAB | 66 | 40 | 0.016314 | 0.014739 | 0.014739 | 0.019125 | 23.2 | 22.4 | 812,032 | 19,243 | 65,047 |
| C | claude-code | sweet NONE | 66 | 41 | 0.015488 | 0.014359 | 0.014359 | 0.017345 | 22.4 | 22.1 | 770,431 | 19,243 | 59,607 |
| C | claude-code | sweet PIPE | 66 | 39 | 0.014964 | 0.013708 | 0.013708 | 0.016730 | 21.3 | 21.0 | 752,783 | 19,243 | 63,628 |

Epoch C opencode sweet cells merge the `fp-*` rows for the 11 non-repair tasks with the
`rp-*` rows for the 11 repair tasks, as the run report requires. Every cell is 66 rollouts.

`breakPricedUsd` equals `idealUsd` in **every cell**: no arm rewrites or evicts context, so
the prefix cache is never broken. The cost columns therefore cannot disagree on rank for
that reason.

---

## 3. Why the sign changed, one harness at a time

The paired delta (sweet minus native, averaged over tasks) splits additively into four
parts: extra turns, the instruction-file offset, every other context-size change, and output
tokens. The context integral is split by a symmetric (Shapley) rule between the turn count
and the mean context per turn.

| harness | epoch | tasks | paired Δ ideal $ | Δ% | turns $ | guide $ | context-rest $ | output $ | sum (check) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | A | 17 | −0.000550 | −6.5% | +0.000232 | +0.000319 | **−0.001202** | +0.000040 | −0.000610 |
| codex | B | 13 | −0.000598 | −5.6% | −0.000056 | +0.000387 | −0.000839 | −0.000115 | −0.000624 |
| codex | C | 22 | +0.000040 | +0.3% | +0.000386 | +0.000426 | **−0.000603** | −0.000157 | +0.000052 |
| opencode | A | 17 | −0.001415 | −17.8% | −0.000080 | +0.000364 | −0.001426 | −0.000319 | −0.001461 |
| opencode | B | 13 | −0.000241 | −2.8% | +0.000579 | +0.000393 | −0.001377 | +0.000045 | −0.000359 |
| opencode | C | 22 | +0.000296 | +3.3% | **+0.000914** | +0.000408 | −0.001074 | +0.000023 | +0.000271 |
| claude-code | A | 17 | +0.000279 | +2.4% | −0.000229 | +0.000458 | +0.000005 | +0.000100 | +0.000334 |
| claude-code | B | 13 | −0.001955 | −14.2% | −0.001122 | +0.000480 | −0.000490 | −0.000809 | −0.001941 |
| claude-code | C | 22 | −0.000591 | −3.9% | −0.000335 | +0.000530 | +0.000109 | −0.000700 | −0.000397 |

The A→C change in each part:

| harness | turns $ | guide $ | context-rest $ | output $ | total change | observed change |
|---|---:|---:|---:|---:|---:|---:|
| codex | +0.000154 | +0.000107 | **+0.000599** | −0.000197 | +0.000663 | +0.000590 |
| opencode | **+0.000994** | +0.000044 | +0.000352 | +0.000342 | +0.001732 | +0.001711 |
| claude-code | −0.000106 | +0.000072 | +0.000104 | −0.000800 | −0.000730 | −0.000511 (inclusive) |

The claude-code row's four parts are ideal-based and exclude sub-agent spend, whose own A→C
change is **−$0.000001**; add it and the total is −$0.000731 against an observed inclusive
change of −$0.000511. The residual is the cache-creation surcharge, which the ideal identity
does not carry.

### 3.1 codex — the harness started capping tool output

**[M] The codex output envelope changed between epoch A and epoch B.** Epoch A wrote
`Script completed / Wall time N seconds / Output:`. Epochs B and C write
`Chunk ID / Wall time / Process exited with code N / Original token count: N / Output:`
and enforce a hard ceiling.

Delivered tool-output size per call, codex:

| epoch / arm | outputs | p50 | p90 | p99 | max |
|---|---:|---:|---:|---:|---:|
| A native | 353 | 3,236 B | 18,873 B | 40,773 B | **41,301 B** |
| A sweet | 388 | 2,528 B | 9,721 B | 17,608 B | 21,239 B |
| B native | 612 | 2,946 B | 10,212 B | 10,214 B | **10,216 B** |
| C native | 1,178 | 2,625 B | 10,212 B | 10,212 B | **10,216 B** |
| C sweet TAB | 1,228 | 1,879 B | 9,546 B | 10,212 B | 10,212 B |

The ceiling is 10,212–10,216 delivered bytes, about 2,500 tokens, which matches the
independent bracket in the mechanism report (largest untruncated 2,489/2,495 tokens,
smallest truncated 2,509/2,511). Epoch A had no such ceiling.

**[M] The cap is worth far more to native than to sweet.** Codex reports its own token count
for every output, so the payload can be priced exactly:

| codex epoch C | tool tokens produced | reached the context | deleted by the cap | truncated calls / rollout |
|---|---:|---:|---:|---:|
| native | 26,302 | ~15,797 | **~10,505 (40%)** | 3.61 (61 of 66 rollouts) |
| sweet TAB | 15,558 | ~13,201 | ~2,357 (15%) | 1.59 (39 of 66 rollouts) |

Sweet still returns **41% fewer tool-output tokens** than native (15,558 v 26,302). After
codex's own cap the advantage that reaches the context is only **16%**.
(The `−18% of tool bytes` in the run report is reproduced here — 57,443 v 70,185 B — but
bytes are the wrong unit: native's `rg --files` listings cost about **1.02 bytes per token**
against sweet's rendered blocks at 3.5.)

**[M] Counterfactual.** Applying the epoch-B/C ceiling to epoch A's own transcripts removes
24,654 over-cap bytes per native rollout (≈9,234 tokens) and 3,196 per sweet rollout
(≈866 tokens). Re-pricing:

- epoch A as run: **−6.5%**
- epoch A with the epoch-B/C cap: **+11.5%**, bootstrap CI over 17 tasks **[+1.7%, +22.2%]**
- epoch C as run: **+0.3%**

This is a static replay. It holds the trajectory fixed, so it over-states the effect — the
model would answer a truncated read with another read. The correct reading is a **bound**:
the harness change alone is more than sufficient to explain the flip, and the observed
+0.3% sits inside the interval it opens.

### 3.2 opencode — sweet takes 3.4 more turns

Sweet's retrieval still returns less: **−$0.001074** of context per rollout, 12.0% of the
arm. It is spent, and more, on turns. [M]

| epoch | Δ turns (sweet − native) | Δ calls | turn cost $ | % of arm |
|---|---:|---:|---:|---:|
| A | **−0.44** | −5.82 | −0.000080 | −1.0% |
| B | +2.10 | −6.18 | +0.000579 | +6.6% |
| C | **+3.38** | −3.44 | **+0.000914** | **+10.2%** |

Sweet still makes **3.4 fewer tool calls** than native, and still spends more, because a
turn costs about 21,800 re-sent tokens plus its output whether it carries one call or three.
**Calls are not the billing unit; turns are.** Opencode's own call-count advantage
(−13% in the run report) is real and does not pay. One extra opencode turn costs about
**$0.000270** in re-sent context alone, and about $0.000381 once its own output is added.

### 3.3 claude-code — no flip, and a delegation story

The inclusive figure never flipped: **−8.9% (A), −30.9% (B), −8.8% (C)**. What flipped is the
main-only column, and only because native's sub-agent spend moved off it.

| epoch | delegating rollouts sweet / native | sidechain $/rollout sweet / native | inclusive Δ | main-only Δ on rollouts where **neither** arm delegated |
|---|---|---|---:|---|
| A | 3/34 · 11/34 | 0.000696 · 0.002313 | −8.9% | **−0.7%** (n=13 tasks) CI [−9.6%, +7.6%] |
| B | 0/39 · 20/39 | 0.000000 · 0.003718 | −30.9% | **−11.6%** (n=10) CI [−21.7%, −1.1%] |
| C | 9/66 · 28/66 | 0.002811 · 0.004429 | −8.8% | **+6.8%** (n=18) CI [−9.7%, +29.4%] |

**Sweet's claude-code cost advantage is a delegation artefact.** Remove the sub-agents and
epoch C reverses to +6.8%, well inside noise. Sub-agent spend is **−$0.001619 per rollout,
7.7% of the native baseline** — the largest single driver of the claude-code delta and the
only one that is not about tokens the main agent chose to fetch.

**One number here disagrees with an earlier report.** The 2026-08-11 claude-code
sidechain-inclusive delta was published as "about −3%". Attributing each sub-agent transcript
to the session directory that owns it gives **−8.9%** on the same rollouts. The main-only
figure (+2.2% here, +2.4% published) agrees, so the difference is sidechain attribution, not
main-agent pricing.

The direction is stable and the mechanism is plain: native spawns a sub-agent to go and look
for code; sweet does not need to. That is a genuine product claim. It is not a retrieval-
payload claim.

---

## 4. The instruction-file tax: exactly 1,457 tokens, on every turn

**[M] The sweet arm's first prompt is larger than native's by a constant.** Across 22 tasks
in epoch C the paired difference in first-turn context is:

| harness | min | median | max |
|---|---:|---:|---:|
| codex | **1,457** | **1,457** | **1,457** |
| opencode | **1,457** | **1,457** | **1,457** |
| claude-code | 1,565 | **1,570** | 1,570 |

Bytes, one task, codex TAB, `absinthe-graphql__absinthe-998` rep 0, first `token_count`:

```
sweet   {"input_tokens":16856,"cached_input_tokens":0,"cache_write_input_tokens":16813,"output_tokens":133,"reasoning_output_tokens":29,"total_tokens":16989}
native  {"input_tokens":15399,"cached_input_tokens":0,"cache_write_input_tokens":15356,"output_tokens":161,"reasoning_output_tokens":47,"total_tokens":15560}
```
16,856 − 15,399 = **1,457**.

**[C] Independent confirmation.** `tiktoken` `o200k_base` over
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` with the YAML
frontmatter stripped gives **1,457 tokens** — the exact number. The frontmatter's
`token_count: 1307` understates the real cost by **11%**; do not quote it.
`buildInstructionFile` appends `\n\n${mppText}` for sweet and nothing for native, so the
whole difference is the guide. Claude-code's extra 113 tokens are its
`.claude/rules/sweet-search.md` wrapper.

**Price.** The guide is ingested once at $0.10/M and re-sent on every later turn at $0.01/M:

| harness | tokens | turns | cost $/rollout | % of the sweet arm |
|---|---:|---:|---:|---:|
| codex | 1,457 | 19.6 | **0.000426** | **3.5%** |
| opencode | 1,457 | 19.7 | **0.000408** | **4.6%** |
| claude-code | 1,570 | 23.2 | **0.000530** | **2.5%** |

**On codex the guide alone costs ten times the entire observed +0.3% delta.** Sweet pays a
3.5% tax and still lands at parity, which means retrieval is buying about 3.2%. On opencode
the guide is 4.6% of a 3.3% loss. A shorter guide is the only lever in this report that is
free of behavioural risk, because it does not change what the agent can do — only how many
words it is told about it.

---

## 5. Paired per-task deltas, epoch C (sweet TAB minus native)

Full tables in `logs/e2-paired.txt`; per-task records in `02-cost-decomposition.json`.
Bootstrap CI over tasks, 20,000 resamples, seed 20260828:

| harness | mean Δ inclusive $ | Δ% | 95% CI | median Δ $ | tasks cheaper / dearer |
|---|---:|---:|---|---:|---|
| codex | +0.000043 | **+0.3%** | [−11.1%, +13.1%] | **−0.001110** | 14 / 8 |
| opencode | +0.000297 | **+3.3%** | [−8.3%, +16.1%] | −0.000208 | 13 / 9 |
| claude-code | −0.001847 | **−8.8%** | [−39.4%, +24.8%] | −0.000485 | 13 / 9 |

**Every mean is dominated by a short right tail, and every median is negative.** On the
typical task of this pool sweet is cheaper on all three harnesses. The arithmetic mean is
positive on two of them because of a handful of runaway rollouts.

Codex, the five extreme tasks (Δ inclusive $ per rollout):

| task | solved S/N | Δ$ | Δ turns | Δ context integral | Δ tool bytes |
|---|---|---:|---:|---:|---:|
| `bfgroup__b2-113` | 0/1 | **+0.009396** | +12.0 | +678,299 | +58,377 |
| `bfgroup__b2-259` | 0/0 | **+0.008224** | +11.3 | +536,999 | +23,605 |
| `devlooped__moq-1262` | 1/1 | +0.004269 | +10.3 | +413,717 | −19,869 |
| `aio-libs__aiohttp-8038` | 0/0 | −0.004832 | −5.0 | −252,087 | −30,429 |
| `accenture__sfmc-devtools-1974` | 1/0 | −0.004375 | −4.7 | −249,483 | −52,570 |

Leave-one-task-out on the realized delta:

| harness | epoch | full | drop one task → min | drop one task → max |
|---|---|---:|---|---|
| codex | A | −6.4% | `dashbitco__nimble_options-43` → −9.6% | `oceanparcels__parcels-617` → −3.0% |
| codex | C | +0.3% | **`bfgroup__b2-113` → −3.3%** | `aio-libs__aiohttp-8038` → +2.3% |
| opencode | C | +3.3% | **`bfgroup__b2-259` → −0.1%** | `protofire__solhint-224` → +5.5% |
| claude-code | C | −1.4% | `bfgroup__b2-259` → −9.7% | `devlooped__moq-1262` → +6.8% |

(The leave-one-out column is realized **main-only**, so the claude-code row reads −1.4%, not
the −8.8% inclusive figure.)

**H1 is partly true and does not rescue the story.** One task (`bfgroup__b2-113`) turns
codex's +0.3% into −3.3%, and one task (`bfgroup__b2-259`) turns opencode's +3.3% into
−0.1%. Both are `bfgroup/b2`, both are unsolved by every arm, and on both sweet runs 11–17
turns longer than native without solving. That is a real behaviour — sweet grinding on a
hopeless task — not a pool artefact to be excluded. It is also the **single most actionable
resolution-independent finding in this report**: a stop rule on unproductive rollouts would
have returned codex to −3.3% and opencode to −0.1% by itself.

---

## 6. The twelve hypotheses, each with a number

**H1 — pool composition.** *Partly.* Median Δ is negative on all three harnesses in epoch C;
the positive means are carried by 2–3 tasks (§5). Dropping the single worst task moves codex
+0.3% → −3.3% and opencode +3.3% → −0.1%. But the delta distribution also moved wholesale:
codex's per-task Δ was cheaper on 11 of 17 tasks in epoch A and 14 of 22 in epoch C — the
share barely changed, the tail grew.

**H2 — native's per-call read size shrank.** *True per call, false in aggregate, and the
cause is the harness.* [M]

| codex | epoch A | epoch B | epoch C |
|---|---:|---:|---:|
| native `nativeRead` calls/rollout | 3.62 | 6.92 | 7.32 |
| native `nativeRead` bytes/call | **13,661** | 7,376 | **7,345** |
| native `nativeRead` bytes/rollout | 49,420 | 51,065 | **53,750** |
| sweet `ss-read` bytes/call | 8,289 | 6,274 | 5,931 |

Native's per-call size fell 46%, its call count doubled, and its **total** payload rose 9%.
The per-call fall is the codex cap (§3.1), not the model choosing narrower reads. Priced:
the cap removes ~10,505 tokens per native rollout — $0.001051 of ingest plus about
$0.000989 of residency ≈ **$0.002 per native rollout, 16% of a codex rollout, handed to
native for free.**

**H3 — instruction-file tax.** *Confirmed exactly.* 1,457 tokens, constant, 3.5%/4.6%/2.5%
of the sweet arm (§4).

**H4 — output-token asymmetry.** *Sweet emits fewer, not more.* Output per turn, epoch C:
codex 282 (sweet) v 307 (native); opencode 185 v 221; claude-code 227 v 264. Per rollout:
codex 5,524 v 5,786; opencode 3,645 v 3,606; claude-code 5,248 v 6,415. The
`<state_summary>` block does not show up as an output-token cost. It is worth −$0.000157
(codex) and −$0.000700 (claude-code) per rollout **in sweet's favour**.

**H5 — turn count.** *The dominant driver on opencode.* Δ turns A/B/C: codex +0.97/−0.44/+0.76,
opencode −0.44/+2.10/**+3.38**, claude-code −1.41/−4.21/−1.14. One extra opencode turn costs
about $0.000270.

**H6 — cache-hit asymmetry and concurrency.** *No effect.* Cache-hit ratio, epoch C: codex
0.9197 native v 0.9194 TAB; opencode 0.9056 v 0.9138; claude-code 0.9244 v 0.9191. Cache-miss
turns are **0 in 66 rollouts** in 9 of 12 cells; the worst cell has 4 of 66. Concurrency is
not a cost factor: the same 11 repair tasks at `CONCURRENCY=2` (`fp-*`, 81 surviving sweet
rollouts) versus `CONCURRENCY=1` (`rp-*`, 99) give hit 0.9222 v 0.9223 and ideal
**$0.010845 v $0.010882** — a 0.3% difference.

**H7 — failed-edit retries.** *Real but arm-neutral, and it is a symptom of hard tasks.*
Epoch C rollouts with at least one failed edit: codex 7/66 native v 5/66 TAB; opencode 3/66 v
**0/66**; claude-code 17/66 v 16/66. A rollout that fails an edit costs about **2.4× a clean
one** (codex C: $0.027260 v $0.010434 native, $0.024627 v $0.011244 sweet), but the
causation runs the other way — hard, long rollouts are where edits fail.

**H8 — ss-\* latency and poll turns.** *Latency is real, cost is zero.* Codex records wall
time per call. Epoch C sweet TAB: `ss-read` 0.340 s (205 calls), `ss-search` 0.554 s (116),
`ss-find` 0.835 s (21), `ss-grep` 0.393 s (156), `ss-semantic` 0.095 s (38) — about
**3.4 s per rollout**. Every native `sed`/`cat`/`rg` call records **0.000 s** (483 calls).
Poll turns (`write_stdin`) are 0.68/rollout sweet against 0.58 native and average **66.8 s**
each: they poll `run_tests`, not ss-\*. Poll output is 2,921 B/rollout sweet v 2,646 native.
Priced, the whole poll difference is under $0.00002.

**H9 — verification tails.** *Identical.* Calls after the first successful edit as a share of
all calls, epoch C: codex 37.9% native v 37.1% sweet; opencode 30.7% v 33.9%; claude-code
39.0% v 38.8%. Sweet reaches its first edit sooner on opencode (13.4 v 16.5 calls) and
claude-code (12.9 v 15.1) and later on codex (10.7 v 10.1). No cost lever here.

**H10 — claude-code delegation.** *Confirmed: the advantage is delegation.* §3.3. On
rollouts where neither arm delegated, epoch C main-only is **+6.8%** (CI [−9.7%, +29.4%]).

**H11 — newly-numbered ss-search / ss-find / ss-semantic.** *Live in epoch C, and cheap.*
`ba5b4ee` committed 2026-08-26 16:14:59 +0200; the first fp-* rollout ran at 22:27. Share of
search-surface code lines carrying a gutter:

| harness | epoch A | epoch B | epoch C TAB |
|---|---:|---:|---:|
| codex | (no fenced blocks recorded) | 11.4% | **94.1%** |
| opencode | 4.0% | 0.0% | **95.0%** |
| claude-code | 3.7% | 4.7% | **95.5%** |

Cost: 305 / 242 / 394 newly numbered lines per rollout × 1.45 tokens = 443 / 351 / 571
tokens ≈ **$0.000088 / $0.000070 / $0.000123 per rollout, 0.7–0.8% of the sweet arm.**
It is not the explanation, but epoch B and epoch C are **not the same treatment** and no
B-versus-C comparison may be read as pool-only.

**H12 — which cost column the published table used.** *Realized.* The fresh-pool table's
codex and opencode figures reproduce `costRealizedUsd` exactly (codex native $0.012287,
codex PIPE $0.012754, opencode native $0.008968 v my $0.008969). Claude-code is a transcript
reconstruction of realized main plus sidechain. **The rank order of the forms is identical on
realized, ideal and breakPriced in every harness.** The only cell that moves is opencode PIPE,
−2.3% realized against −3.7% ideal, caused by 3 of its 66 rollouts taking a genuine provider
cache miss. `breakPricedUsd == idealUsd` everywhere, because no arm rewrites context.

---

## 7. The cross-harness gap: claude-code costs 1.7× codex on the same model

Epoch C, native arm, per rollout:

| harness | inclusive $ | fixed preamble (tok) | turns | context integral (tok) | output (tok) | tool bytes | calls | sidechain $ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | 0.012287 | **13,959** | 18.8 | 551,210 | 5,786 | 70,234 | 17.8 | — |
| opencode | 0.008969 | **6,498** | 16.3 | 406,824 | 3,606 | 71,912 | 25.2 | — |
| claude-code | 0.020972 | **17,273** | 24.3 | 818,991 | 6,415 | 60,077 | 26.4 | 0.004429 |

**The fixed preamble is measured, not estimated.** The same 22 issues ran on all three
harnesses, so the native first-turn prompt fits an additive model
`firstTurn(h,t) = preamble(h) + issue(t)`. It fits to a **mean absolute residual of 4 tokens**
(max 35) over 66 cells. Issue text spans 0–2,046 tokens (median 250). The preamble — system
prompt, tool schemas and the shared frame — is **13,959 / 6,498 / 17,273** tokens.
Claude-code carries **3,315 more preamble tokens than codex and 10,775 more than opencode**.

Priced, ingested once and re-sent every turn, the preamble alone is:

| harness | $/rollout | % of the arm |
|---|---:|---:|
| codex | 0.004027 | **33.0%** |
| opencode | 0.001710 | **19.1%** |
| claude-code | 0.005925 | **30.0%** |

**The $0.008685 gap between claude-code and codex decomposes exactly:** sub-agents
**+$0.004429**, the fixed preamble **+$0.001898**, the provider's cache-creation surcharge
**+$0.001144**, all other context **+$0.000836**, output tokens **+$0.000377**.
Sub-agents are the largest single term and the preamble is the second.
Opencode is cheap for one reason above all others — its tool schemas and system prompt are
47% of codex's and 38% of claude-code's — and it buys that with more tool calls
(25.2 v 17.8), which cost almost nothing because they are packed into fewer turns.

---

## 8. Ranked cost drivers and what a −15% lever must move

### 8.1 Drivers of the sweet-minus-native delta, epoch C, paired over 22 tasks

**codex** (native baseline $0.012287/rollout)

| $ | % of baseline | driver |
|---:|---:|---|
| −0.000603 | **−4.9%** | context payload other than the guide — what retrieval still saves |
| +0.000426 | **+3.5%** | instruction-file tax |
| +0.000386 | **+3.1%** | turn count (+0.76) |
| −0.000157 | −1.3% | output and reasoning tokens |
| **+0.000052** | **+0.4%** | sum (measured +0.3%) |

**opencode** (native baseline $0.008969/rollout)

| $ | % | driver |
|---:|---:|---|
| −0.001074 | **−12.0%** | context payload other than the guide |
| +0.000914 | **+10.2%** | turn count (+3.38) |
| +0.000408 | +4.6% | instruction-file tax |
| +0.000023 | +0.3% | output and reasoning tokens |
| **+0.000271** | **+3.0%** | sum (measured +3.3%) |

**claude-code** (native baseline $0.020972/rollout)

| $ | % | driver |
|---:|---:|---|
| −0.001619 | **−7.7%** | sub-agent (sidechain) spend |
| −0.000700 | **−3.3%** | output and reasoning tokens |
| +0.000530 | +2.5% | instruction-file tax |
| −0.000335 | −1.6% | turn count (−1.14) |
| +0.000109 | +0.5% | context payload other than the guide |
| **−0.002015** | **−9.6%** | sum (measured −8.8%) |

### 8.2 The size of a −15% lever

| harness | arm $/rollout | target saving | via context alone | via output alone | via turns alone |
|---|---:|---:|---|---|---|
| codex | 0.012258 | 0.001839 | **−9,285 tokens** of payload = 26.9% of everything the arm ingests, and **76% of every token the ss-\* tools return** (12,271) | −3,065 output tokens = 55.5% of the arm's output | −4.4 turns of 19.6 (22.2%) |
| opencode | 0.009260 | 0.001389 | −6,998 tokens = 24.7% of ingest | −2,315 tokens = 63.5% of output | −4.6 turns of 19.7 (23.3%) |
| claude-code | 0.017550 | 0.002632 | −12,197 tokens = 31.6% of ingest | −4,387 tokens = 83.6% of output | −6.1 turns of 23.2 (26.2%) |

**No payload lever can reach −15% on codex.** Deleting every byte the ss-\* tools return
buys 12,271 tokens, and 9,285 of them are needed. Trimming the render is arithmetically
out of reach: at 1.45 tokens per gutter line, −15% is **6,403 numbered lines per rollout**,
about twenty times the 305 lines the numbering fix actually added.

**Three levers are the right size, and they are all behavioural:**

1. **Stop rules on unproductive rollouts.** The two `bfgroup/b2` tasks alone move codex
   +0.3% → −3.3% and opencode +3.3% → −0.1%. Sweet runs 11–17 turns longer than native there
   and solves nothing.
2. **Turn packing on opencode.** +3.38 turns is +10.2%. Sweet already makes 3.4 fewer calls;
   it just spreads them over more turns. (Note the discard log: free-argument call packing
   was killed on operation-count evidence. This is a different quantity — the price is per
   turn, and the measurement is now in dollars.)
3. **A shorter instruction file.** 1,457 tokens is 3.5% of codex and 4.6% of opencode, paid
   on every turn of every sweet rollout, and it is the only line item that is fully under our
   control with no behavioural risk. Halving it returns 1.8% and 2.3%.

Delegation suppression on claude-code is already worth −7.7% and is the only place where
sweet has a large, mechanically explained cost win. It cannot be exported: opencode and codex
have no comparable sub-agent surface.

---

## 9. Measurement defects found

### 9.1 The claude-code fresh-pool cost used the wrong transcript on 13 rollouts

**[M] The published `main (rebuilt)` column is exactly reproducible as "the three dearest
transcripts in each cell".** My replay of that rule returns `$1.130494` (native),
`$1.182496` (TAB), `$1.163153` (NONE), `$1.055723` (PIPE) — the four published figures, to
the last digit. It also returns the REBASELINE self-check figure `$0.502954`.

That rule is wrong when a cell holds more sessions than reps. **It does, on 13 rollouts, and
the cause is `degenReran`** — the degeneration detector fired and the runner re-ran the
rollout. The re-run is what was graded; the first attempt was discarded. Taking the three
dearest substitutes the discarded attempt for a graded one.

`degenReran` by run and arm, every run in this report:

| run | sweet | native |
|---|---:|---:|
| `fp-claudecode-tab-20260826` | **5** | 1 |
| `fp-claudecode-none-20260826` | **4** | — |
| `fp-claudecode-pipe-20260826` | **2** | — |
| `rb-claudecode-20260824` | 0 | 1 |
| every codex and opencode run | 0 | 0 |

Six examples, with the kept transcript and both prices:

```
aio-libs__aiohttp-8038  sweet rep1  r1-17/608e67a6…  kept $0.043001  discarded $0.047364
aio-libs__aiohttp-8038  sweet rep2  r2-21/fe8316dd…  kept $0.009327  discarded $0.050091
fastify__fastify-cors-285 sweet rep0 r0-78/05b1eb42… kept $0.021450  discarded $0.029798
protofire__solhint-224  sweet rep0  r0-128/51394869… kept $0.035197  discarded $0.040438
protofire__solhint-224  sweet rep2  r2-133/1e312eb9… kept $0.026004  discarded $0.038107
protofire__solhint-224  native rep2 r2-138/0a02dc5b… kept $0.018332  discarded $0.055906
```
Pilot log, the trigger: `[degenerate aio-libs__aiohttp-8038 sweet] output-visibility-mismatch
— 0 payload(s), 0 chars, billed/retained=8.98x`.

**Three conventions, one cell (`fp-claudecode-*`, 66 rollouts each):**

| arm | row-matched $/rollout | published (3 dearest) | every dollar spent |
|---|---:|---:|---:|
| native | **0.020972** | 0.021558 | 0.021819 |
| sweet TAB | **0.019125** (−8.8%) | 0.020727 (−3.9%) | 0.022243 (**+1.9%**) |
| sweet NONE | **0.017345** (−17.3%) | 0.019480 (−9.6%) | 0.020715 (−5.1%) |
| sweet PIPE | **0.016730** (−20.2%) | 0.017761 (−17.6%) | 0.018155 (−16.8%) |

**The row-matched column is the one that ties to the harness on every row.** But note the
third: because sweet triggered 11 of the 13 degeneration re-runs, the arm that is 8.8%
cheaper per graded rollout is **1.9% dearer per dollar the benchmark actually paid**. Any
published claude-code cost number must say which of the three it is.

### 9.2 The claude-code sub-agent lower bound, quantified

Delegated requests whose transcript record carries no usage at all — these are billed and
unpriced, so every sidechain figure is a lower bound:

| run | arm | sub-agent files | requests | with no usage |
|---|---|---:|---:|---:|
| `fp-claudecode-tab` | native | 33 | 519 | **205 (39.5%)** |
| `fp-claudecode-tab` | sweet | 11 | 364 | 165 (45.3%) |
| `fp-claudecode-none` | sweet | 9 | 249 | 74 (29.7%) |
| `fp-claudecode-pipe` | sweet | 7 | 209 | 106 (50.7%) |
| `rb-claudecode` | native | 21 | 302 | 105 (34.8%) |

Native's absolute gap is the largest (205 requests), so the true native cost is higher than
shown and sweet's inclusive advantage is understated — the same direction the run report
states, now with a per-run count.

### 9.3 `token_count: 1307` in the guide frontmatter is wrong

The real cost is **1,457** `o200k_base` tokens, confirmed twice: by tokenizing the file and by
the constant first-turn difference in 132 codex and 129 opencode rollouts. Any budget built
on 1,307 understates the guide by 11%.

---

## 10. What I could not finish

- **Epoch A codex fenced-block census.** The epoch-A output envelope has no markdown fences
  in the retained shape my counter recognises, so the ss-\* gutter census reads 0/0 there.
  Epoch A opencode and claude-code are measured. This does not affect any priced result.
- **The `implied delivered` token figures in §3.1** (15,797 and 13,201) are a subtraction —
  `newIn − firstTurn − output` — not a direct count, because codex reports the token size of
  a tool output *before* truncation. They are accurate to a few hundred tokens; the
  *produced* figures (26,302 and 15,558) are codex's own exact counts.
- **The epoch-A cap counterfactual is a static replay.** It does not model the extra reads a
  truncated output would provoke, so +11.5% is an upper bound, not a prediction.

---

## 11. Reproduction

```bash
ssh root@167.233.69.121
cd /tmp/fp-inv/e2
node harvest.mjs --out /tmp/fp-inv/e2/rollout-costs.json   # 1,311 rollouts, ~2 s
node headline.mjs      # cell table + vs-native on every cost column
node paired.mjs        # per-task paired deltas, bootstrap CI, leave-one-out
node hypo.mjs          # H1..H12
node drivers.mjs       # ranked drivers + the -15% lever sizing
node census.mjs        # tool-family bytes/call + the gutter census
node convention.mjs    # reproduces the published 3-dearest claude reconstruction
node counterfactual.mjs # the epoch-A cap replay
node firstturn.mjs     # preamble vs issue split
node degen.mjs         # degeneration re-runs and discarded spend
```

Local copies: `scripts/e2-*.mjs`. Outputs: `logs/e2-*.txt`.
Per-rollout components: `02-cost-decomposition.json` (local) and
`/tmp/fp-inv/e2/rollout-costs.json` (box, with per-turn arrays).
