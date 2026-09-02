# Harness, gutter and cost on the fresh pool — canonical analysis (2026-08-28)

**Object.** The 891-rollout fresh-pool run reported in `FRESH-POOL-RESULTS.md`: 22 unselected DEV tasks × 3 reps × (native + three sweet gutter forms) × 3 harnesses, plus the 99-rollout opencode repair pass. Every harness ran `openai/gpt-5.6-luna` through OpenRouter [M `logs/final-boxcheck.txt`, the `model` field of every `rows.json`].

**Inputs.**
- The evidence files `01`–`08` and the synthesis draft `09` in `harness-gutter-cost-20260828/`.
- The four panel reviews `10-panel-cost.md`, `10-panel-gutter.md`, `10-panel-resolution.md` and `10-panel-sol.md`. All four are present and complete.
- The standing reports: `FRESH-POOL-RESULTS.md`, `GUTTER-MECHANISM-INVESTIGATION.md`, `GUTTER-AB-RESULTS.md`, `REBASELINE-RESULTS.md`.
- The discard logs: `SLATE-A-UBER.md` section 9 and `SLATE-B-UBER.md` section 8.
- The preamble-trim gate: `handoffs/lever3-eviction/PREAMBLE-TRIM-GATE.md`.
- Two read-only checks I ran on the box: `scripts/final-boxcheck.sh` → `logs/final-boxcheck.txt`, and `logs/final-gatecheck.txt`.

**Tags.** [M] measured, with the script or log that holds the number. [C] read from source, a deployed binary or a contract. [I] inferred. [W] web source with URL.

**Plain names for internal terms.** "The tool guide" is the 1,457-token sweet-search tool guide appended to `AGENTS.md` (codex, opencode) or `CLAUDE.md` (claude-code) in the sweet arm. Older documents call it "M±". "TAB / NONE / PIPE" are the three line-number forms the `ss-*` tools render: `N<TAB>`, no gutter, `N| `. "Epoch A / B / C" are the 2026-08-11, 2026-08-24/25 and 2026-08-26/27 runs. "Row-matched" prices each claude-code rollout from the transcript the harness graded. "Dearest-3" takes the three most expensive transcripts per cell. "Every-dollar" adds the discarded degeneration re-runs. "The bar" is the pre-registered difference of at least 6 solved rollouts of 66. "The hygiene package" is the set of `ss-*` wrapper fixes listed in section 5.1. "The index-coverage fix" is: index `.jam` files and stop excluding `src/build/`.

---

## 0. Verdict

1. **Keep `N<TAB>` on codex, opencode and claude-code.** No form clears the bar. All six form-to-form cost differences sit inside task-bootstrap intervals that contain zero [M `03` section 5; `logs/p1-stats.txt` B].
2. The tab has one real defect: on tab-indented files the model keeps the gutter tab in its anchor. Claude-code's exact-match `Edit` then fails; codex and opencode absorb it and silently write one extra indent character [M `01` section 2; `logs/p2-silentcarry.txt`; `logs/final-boxcheck.txt` item 4]. It fired in 3 of 22 tasks and changed no solve.
3. **Top cost drivers, sweet minus native, per rollout.** (a) Codex's harness now caps tool output at about 2,500 tokens. That deletes 35% of native's tool tokens for free, worth up to about $0.0018 per native rollout [M `logs/p1-codexcap.txt`; I arithmetic]. (b) Opencode's native tools run 1.55 calls per request against sweet's 1.11, so sweet pays +3.4 requests = +$0.00091 (+10.2%) [M `logs/synth-ocparallel.txt`; `02` section 3.2]. (c) Three sweet-only constants sit on every harness. The tool guide costs $0.00042–0.00051 (2.6–4.5%). The gutter costs $0.00030–0.00039 (2.0–3.7%). Requests that react to failed `ss-*` calls cost at most $0.00020–0.00037 (about 2%) [M `logs/p1-analyse.txt` 4; `logs/p1-gutter.txt`; `logs/synth-*wasted.txt`].
4. On claude-code sweet is 8.8% cheaper on the graded transcript. That whole win is native's subagent spend; on the four tasks where neither arm delegated, sweet is 26% dearer [M `logs/p1-conventions.txt` B; `logs/p1-stats.txt` A].
5. **The biggest fixable driver is the index-coverage defect.** `.jam` is not indexed and `**/build/**` excludes `src/build/`. The two Boost.Build tasks carry the codex and opencode cost flips: drop one task and codex moves +0.3% → −3.3%, opencode +3.3% → −0.1% [M `04-resolution-codex.md` section 2.4; `logs/p1-analyse.txt` 3].
6. **Top levers, all at $0, none needing an A/B.** Fix index coverage and rebuild the affected goldens. Say "not indexed" instead of "(no matches)". Ship the hygiene package.
7. **Closed:** the gutter as a cost lever (a −15% saving needs about 5,300 numbered lines per rollout, six times the 878 delivered); the tool-guide shrink (gated and dropped on 2026-08-10, with the guidance block excluded from trimming by the owner); call packing on opencode (every mechanism closed on record).
8. **Next run:** no paid gutter arm and no paid guide arm. After the $0 fixes land, run one contemporaneous sweet-versus-native re-baseline. Pool: a fresh, uninspected 22-task pool plus the five fixed control tasks, three harnesses, three reps. Size: about 486 rollouts, about $7.5 at the registered price, about $15 at today's listed price [M `FRESH-POOL` section 1 cell totals; `06` section 1.1].

---

## 1. How each harness reads and edits

**Conclusion.** The read surface and the edit surface are harness-specific. Only claude-code matches anchors byte for byte, so only claude-code turns a carried delimiter into a failed call. Codex and opencode absorb the same carry and write it into the file.

| harness | read surface, native arm → sweet arm | edit tool | context matching | rollouts with ≥1 failed edit / 66: native · TAB · NONE · PIPE | delimiter mechanism |
|---|---|---|---|---|---|
| **codex 0.146.1** | none of its own: `sed -n` 3.05, `rg` 2.68, `cat` 1.41, `nl` 0.65 calls per rollout at 8.1–8.6 kB → `ss-read` 4.4 calls, 8.2 invocations, 6.1 kB; every output over ~2,500 tokens is cut middle-out [M `01` section 3] | `exec_command` heredoc `apply_patch <<'PATCH'`, 480 of 480 edit calls [M `01` section 1.1] | four-pass seek (exact → trim_end → trim → unicode) from a forward-only moving index; 952 of 952 hunks carry a bare `@@` [C][M `04-resolution-codex.md` section 3.2] | 7 · 5 · 2 · 4 [M `01` section 1.2] | **carry present, absorbed**: 0 whitespace failures, 0 residue in 3,911 anchor lines; 15 gutter-tab lines carried into patches in 4 of 66 TAB rollouts, 0 under NONE and PIPE [M `01` section 2.1; `logs/p2-silentcarry.txt`] |
| **opencode 1.18.4** | `read` renders `N: `, 9.03 calls at 4.4 kB, plus `glob` 2.11, `grep` 3.64 → `ss-read` 5.7 calls at 5.0 kB, native `read` 0.27 [M `01` section 3.1] | `apply_patch(patchText)`, 467 of 467; the nine-replacer fuzzy `edit` tool was called 0 times [M] | the same four-pass seek, TypeScript port; 869 of 869 bare `@@` [C][M `04-resolution-opencode.md` section 3.3] | 3 · **0** · 6 · 4 | **carry present, absorbed**: 0 whitespace failures, 0 residue in 3,885 lines; 15 lines carried in 3 of 66 TAB rollouts, 0 under NONE and PIPE [M `logs/p2-silentcarry.txt`] |
| **claude-code 2.1.218** | `Read` renders `N<TAB>`, 19.4 calls per rollout (10.45 main thread + 8.94 inside subagents) at 3.1 kB → `ss-read` 4.6 calls, 6.3 invocations, 5.3 kB; native `Read` 0.8 on the main thread [M `01` section 3; `logs/synth-ccwasted.txt`] | `Edit(old_string)` 1,019 of 1,055 (96.6%), `Write` 20, `python` rewrite 15 [M] | exact substring, must be unique; the only tolerance is `\uXXXX` escape swapping; no whitespace normalisation [C `05` section 1.1] | 18 · 19 · 15 · 16 (`01`); 17 · 17 · 15 · 15 counting `Edit` only (`04-resolution-claude-code.md` section 5.3) | **carry fails the call**: TAB 8 of 61 edits in tab-indented repos, PIPE 6 of 144 in space-indented repos, native `Read` 6 of 79 [M `01` section 2.3] |

### 1.1 The claude-code carry, with bytes

In a tab-indented file the model strips the digits and keeps the gutter tab [M `01` section 2.3]:

```
ss-read showed :  '245\t\t\t\tthis.RenderExpression = renderExpression.Body.Apply(EvaluateCaptures.Rewriter);'
Edit old_string:  '\t\t\t\tthis.RenderExpression = …'      (4 tabs)
on disk        :  '\t\t\tthis.RenderExpression = …'        (3 tabs)
→ "String to replace not found in file."
```

Under PIPE in a space-indented file the model keeps the delimiter's space: shown `135|       clearIcon,`, anchor 7 spaces, on disk 6 [M `logs/p2-carrycases.txt` cases 18–19].

**Counts at the edit level.** TAB carried in 8 of 61 edits in tab-indented repos, against PIPE 0 of 62 (Fisher `p = 0.0029`). PIPE carried in 6 of 144 edits in space-indented repos, against TAB 0 of 195 (`p = 0.0055`). NONE carried in 0 of 269. Native `Read` carried in 6 of 79 [M `01` section 2.3; re-derived in `10-panel-resolution.md` claim 3].

**Counts at the rollout level.** This programme uses the rollout as the unit for failures. The 20 carry calls are 14 distinct (rollout, file, anchor) events in 8 rollouts and 3 tasks [M `logs/p2-carrycases.txt`]. TAB's 8 calls are 5 events in 3 rollouts of one task (`devlooped__moq-1262`). PIPE's 6 calls are 5 events in 3 rollouts of two tasks. Native's 6 calls are 4 events in 2 rollouts of one task. At the rollout unit, TAB is 3 of 9 against PIPE 0 of 9 (`p = 0.21`). PIPE is 3 of 57 against TAB 0 of 57 (`p = 0.24`) [M `10-panel-gutter.md` claim 3]. Neither is significant. One PIPE case (`cli.js`, case 14) would have failed without the carry: its first anchor line occurs 16 times in the file [M `logs/p2-carrycases.txt`].

**Exposure.** Three of 22 tasks are tab-indented (`moq` 98%, `registry` 99.9%, `nmt` 100% of code lines); 19 are space-indented [M `01` section 2.4]. Under TAB, 13.9% of delivered `ss-read` lines are tab-indented [M `04-resolution-claude-code.md` section 3.3].

**What it costs.** The 20 carries cost $0.0327 whole-episode (an upper bound) or $0.0126 on the one-extra-request bound. Per 66-rollout cell that is $0.000220 / $0.000076 (TAB), $0.000114 / $0.000043 (PIPE) and $0.000161 / $0.000071 (native) [M `01` section 4; `10-panel-gutter.md` claim 3]. Zero solves changed: `moq-1262` is 0 of 3 in every claude-code condition and `registry-961` is 3 of 3 [M `04-resolution-claude-code.md` section 1].

### 1.2 The codex and opencode carry, with bytes — the same behaviour, absorbed

The draft said codex and opencode "have no mechanism". That is wrong. The carry happens; the seek hides it. I verified one case myself [M `logs/final-boxcheck.txt` item 4], codex sweet TAB, `devlooped__moq-1262`, rollout `rollout-2026-08-27T00-34-45-01a040a4-…jsonl`, call `call_ADEK3QSj7eIywkhn1mkeUSfv`:

```
ss-read showed :  '36\t\t\t\tif (x is MemberExpression)'      ("36" + gutter tab + 3 content tabs)
patch line     :  '-\t\t\t\tif (x is MemberExpression)'       (4 tabs)
on disk        :  '\t\t\tif (x is MemberExpression)'          (3 tabs)
apply_patch    :  Success. Updated the following files: M src/Moq/ExpressionComparer.cs
```

Pass three of `seek_sequence` compares `line.trim()` to `pattern.trim()`, so the extra tab cannot fail the seek [C `05` section 1.3]. `apply_patch` writes `+` lines verbatim, and the same rollout emitted `+\t\t\t\tif (x is MemberExpression)` as an added line [M `logs/p2-carryproof.txt`]. So on these harnesses the carry writes one extra indent character into the file.

Census over every context and removed line whose stripped text has one unique indentation in the golden file [M `logs/p2-silentcarry.txt`]:

| cell | lines tested | on tab-indented lines | gutter-tab carries | rollouts with a carry |
|---|---:|---:|---:|---:|
| codex sweet TAB | 528 | 98 | **15** | **4 of 66** (`registry-961`, `moq-1262`) |
| codex sweet NONE | 625 | 113 | 0 | 0 of 66 |
| codex sweet PIPE | 539 | 78 | 0 | 0 of 66 |
| opencode sweet TAB | 598 | 76 | **15** | **3 of 66** (same two tasks) |
| opencode sweet NONE | 529 | 90 | 0 | 0 of 68 |
| opencode sweet PIPE | 559 | 57 | 0 | 0 of 67 |
| codex native | 665 | 97 | 0 | — |
| opencode native | 199 | 3 | 0 | — |

Pooled, TAB 7 of 132 rollouts against 0 of 265 under the other forms, `p = 0.0004` [M `10-panel-gutter.md` claim 4]. The counts the draft quoted still hold: 0 whitespace failures and 0 gutter residue across 7,796 anchor lines [M `01` sections 1.4, 2.1]. They are near-tautological, because the seek cannot fail on whitespace.

**Consequence.** An extra tab is harmless in C# and Go, which is where all 30 carries sat. It is not harmless in a tab-indented Python, Haskell or F# file. Whether a carried `+` line ever reached a shipped patch is unchecked: the three codex TAB `moq` reps shipped empty patches [M `10-panel-gutter.md` section 4] [I].

### 1.3 What the tokeniser says, corrected

`05` section 3.4 reported the tab as "0% ambiguous". Its test looked only for a fused run of spaces. The symmetric test asks one question. Is the token after the number a homogeneous run of the delimiter's last character, in a file whose indentation starts with that character? [M `logs/p2-ambiguity.txt`, five golden files, 3,052 lines]:

| form | ambiguous share | on tab-indented lines | on space-indented lines |
|---|---:|---:|---:|
| `N<TAB>` | **9.9%** | 9.9% | 0.0% |
| `N| `, `N: `, `N ` | 64.1% | 0.0% | 64.1% |
| `N:`, `N|` | **0.0%** | 0.0% | 0.0% |

The corpus is 64.1% space-indented and 15.0% tab-indented. The tab is ambiguous on 302 of its 458 tab-indented lines, the ones with two or more tabs of indent. Those are exactly the lines behind every carry in section 1.1 and section 1.2. The tab's advantage is exposure, not kind: 15% of a mixed corpus against 64%, and about 100% inside a tab-indented repository.

Per-line cost on the same corpus [M `logs/p2-tok.txt`, reproducing `05` section 3.1 to four decimals]: none 8.52 tokens, `N<TAB>` +1.48, `N:` +2.19, `N|` +2.23, `N| ` +2.40. The tab is 0.92 tokens per line cheaper than `N| ` and 0.71 cheaper than `N:`.

### 1.4 The read-before-edit gate is switched off by the model's name

The draft said the gate "does not bind". The measurement holds. 218 of 259 sweet TAB edits (84%) had no prior native `Read` of the file, and 205 of them had only an `ss-read`. Zero gate errors fired in 1,044 edit calls across 264 rollouts [M `logs/synth-readgate.txt`]. The reason is model identity, not tool design [C `logs/final-gatecheck.txt`, deployed binary `/root/.local/share/claude/versions/2.1.218`]:

```js
function MSy({absoluteFilePath:e,fileContents:t,lastRead:r,oldString:n,replaceAll:o,model:i,readNotAutoAllowed:s}){
  if(!r){ if(!rji(i)&&!s()) return !1; throw new j1e(veo) }   // veo = "File has not been read yet. Read it first before writing to it."
function rji(e){ return grg.has(oa(e)) }
grg = new Set(["claude-opus-4-6","claude-haiku-4-5","claude-opus-4-5","claude-opus-4-1","claude-opus-4-0",
               "claude-sonnet-4-5","claude-sonnet-4-0","claude-3-7-sonnet","claude-3-5-sonnet","claude-3-5-haiku"])
```

With no prior read, the gate returns quietly only when the model is outside that set. The benchmark ran `openai/gpt-5.6-luna`, so the gate was off. On any Anthropic model, every one of those 218 edits would throw and force a `Read`. That is one failed call plus one read per file per rollout for every real claude-code user of sweet-search. It is a product risk, not a benchmark artefact, and it must be measured before any claude-code efficiency claim is published [I].

The `Edit` prompt's separator sentence is gated too. `FPt=qr(()=>Xe("tengu_tab_read_sep",!1))`: the default is off, so the model is told "line number + tab"; on, it is told "a single tab or `:`" [C `logs/final-boxcheck.txt` item 1].

### 1.5 Edit failure as a cost line, and the six-task anchor result

Edit-failure retries cost 4–11% of a claude-code cell on the one-extra-request bound and under 1.6% of a codex or opencode cell [M `01` section 1.5]. Claude-code retries succeed 17 of 39 times under TAB; codex and opencode retry successfully 36 of 41 times, because their seek trims whitespace.

`GUTTER-AB-RESULTS.md` adopted the tab on six tasks (TAB 1.6% against PIPE 7.6% of edits failing on an anchor). At 66 rollouts per cell the like-for-like anchor rates are lower everywhere. Native fails 24 of 323 (7.4%). TAB fails 15 of 256 (5.9%). NONE fails 12 of 270 (4.4%). PIPE fails 9 of 206 (4.4%) [M `01` section 1.2, column "anchor fails"]. All-failure rates are TAB 16.5–18.4%, NONE 14.8–15.4%, PIPE 12.4–12.6%, native 16.7–17.2% [M `01`; `04-resolution-claude-code.md` section 5.3]. Rollouts with at least one failure are 18 / 19 / 15 / 16 (native / TAB / NONE / PIPE), `p = 0.69` TAB against PIPE [M `01`]. The six-task figure is withdrawn; it was three transcripts of one task.

---

## 2. Why sweet is no longer cheaper on codex and opencode, and why claude-code never flipped

**Conclusion.** Every cell was re-priced from its own transcript by two independent parsers. Both tie to the harness: codex and opencode ideal within $0.0000005 on 901 rows, claude-code main-only within $0.0000005 on 342 rows [M `02` section 1; `logs/p1-analyse.txt` 1]. The three harnesses moved for three different reasons. The sweet-side constant terms did not change between epochs.

### 2.1 The cost model, with each harness's numbers

`cost = 0.10·INGEST + 0.01·Σ PREFIX + 0.60·OUTPUT` per million tokens [C `harness/ideal-cost.mjs:83`]. INGEST counts every token once when first sent; Σ PREFIX is everything re-sent; OUTPUT includes reasoning. The break-priced column equals it on all 792 epoch-C rollouts, because no arm rewrote context [M `03` section 6]. Cache hit is 90.6–92.4% of all input and 99.3–100.0% of re-sent tokens; no rollout compacted [M `logs/p1-stats.txt` C; `06` section 0].

| harness / arm | $ per rollout | INGEST tok · $ · share | Σ PREFIX tok · $ · share | OUTPUT tok · $ · share | re-sends per ingested token | sidechain $ | realized − ideal $ |
|---|---:|---|---|---|---:|---:|---:|
| codex sweet TAB | 0.012330 | 34,541 · 0.003454 · 28.2% | 548,952 · 0.005490 · 44.8% | 5,524 · 0.003315 · 27.0% | 15.9 | — | 0.000072 |
| codex native | 0.012287 | 35,942 · 0.003594 · 29.4% | 515,269 · 0.005153 · 42.2% | 5,786 · 0.003472 · 28.4% | 14.3 | — | 0.000069 |
| opencode sweet TAB | 0.009265 | 28,315 · 0.002832 · 30.6% | 424,150 · 0.004242 · 45.8% | 3,645 · 0.002187 · 23.6% | 15.0 | — | 0.000005 |
| opencode native | 0.008969 | 30,359 · 0.003036 · 33.9% | 376,466 · 0.003765 · 42.0% | 3,606 · 0.002164 · 24.1% | 12.4 | — | 0.000004 |
| claude-code sweet TAB (row-matched) | 0.019125 | 38,551 · 0.003855 · 22.0% | 773,481 · 0.007735 · 44.1% | 5,248 · 0.003149 · 17.9% | 20.1 | 0.002811 | 0.001575 |
| claude-code native (row-matched) | 0.020972 | 36,562 · 0.003656 · 18.5% | 782,429 · 0.007824 · 39.6% | 6,415 · 0.003849 · 19.5% | 21.4 | 0.004429 | 0.001213 |

[M `logs/p1-analyse.txt` 2, which reproduces `02` section 2.1 to the last digit.] Re-sent context is the largest term everywhere, 40–46% of spend. A token put into context costs 2.2–3.1 times its sticker price, and the break-even residence against ingest is 10 requests, which every cell passes [M `06` section 7.3].

**The cache-write surcharge is charged on claude-code only, and it is not neutral between arms.** `costFromTurns` multiplies a `cacheWrite` field by 1.25. Only `claude-code-accounting.mjs:103` supplies that field. The opencode runner folds `cache.write` into `in`, and codex's `turnsFromRollout` emits none [C `ideal-cost.mjs:94`; `opencode-task-runner.mjs:160`]. Cache-write tokens per rollout differ by arm: codex 35,899 native against 34,498 sweet, opencode 30,356 against 28,312, claude-code 39,105 against 43,812 [M `logs/p1-stats.txt` C]. Charging the surcharge everywhere would move opencode from +3.31% to +2.52% and codex from +0.35% to +0.06%. Whether OpenRouter really bills luna cache writes at 1.25× rests on a web statement [W `06` section 2.3, <https://openrouter.ai/docs/guides/best-practices/prompt-caching>] and no bill was checked.

### 2.2 Ranked drivers of the sweet − native delta, per harness

Class: **H** harness version or contract · **P** pool composition · **S** sweet product · **A** measurement artefact. The dollar rows are a classification, not a second sum. The guide, gutter and wasted-call terms overlap the turn and context terms of the additive split in `02` section 3.

**Codex** — native $0.012287, sweet TAB $0.012330, **+0.35%**, task-bootstrap interval [−11.6%, +12.9%]; sweet cheaper on 14 of 22 tasks, median −$0.001119 [M `logs/p1-analyse.txt` 3].

| rank | $ per rollout | share of native | driver | class | basis |
|---|---:|---:|---|---|---|
| 1 | up to ≈ −0.0018 for native | ≈ 15% | codex's output cap. The cap sits between 2,496 and 2,502 tokens [M `logs/p2-cap.txt`]. Native hits it 3.61 times per rollout in 61 of 66 rollouts, sweet 1.59 times in 39 of 66. By codex's own token counts the cap deletes 9,244 of native's 26,302 tool tokens (35.1%) and 1,647 of sweet's 15,558 (10.6%) [M `logs/p1-codexcap.txt`]. The dollar figure is a static upper bound at the measured re-send multiplier [I]. Replaying epoch A's own transcripts under the cap at the measured 3.99 bytes per token moves codex from −6.4% to +6.3%, interval [−5.2%, +19.6%] [M `logs/p1-capreplay.txt`]. The cap is large enough to explain the +6.8-point flip; it is not identified as the sole cause. Whether it arrived with a version or with the OpenRouter path is unknown: `rows.json` records neither [M `logs/final-boxcheck.txt` item 2] | **H** | `02` section 3.1 gave 10,505 / 2,357 tokens and +11.5% with interval [+1.7%, +22.2%]; those used a subtraction that over-counts and two different byte-per-token rates for the two arms. Retired. |
| 2 | +0.000417 | +3.4% | the tool guide, exactly 1,457 tokens on 66 of 66 rep-matched pairs, ingested once and re-sent 18.6 times [M `logs/p1-analyse.txt` 4] | **S** | `02` section 4 printed $0.000426, the Shapley term of the paired split; the arithmetic figure is the one to quote |
| 3 | +0.000386 | +3.1% | +0.76 requests, concentrated on `b2-113` (+12.0) and `b2-259` (+11.3) where sweet grinds against an index that holds no `.jam` and no `src/build/` [M `02` section 5] | **S**, pool-sensitive | dropping `b2-113` alone gives −3.3% |
| 4 | +0.000302 | +2.45% | the tab gutter (1,163 tokens per rollout, 61.5% of it re-send) [M `logs/p1-gutter.txt`; `03` section 2.1] | **S** | two independent tokenisations agree to the last digit |
| 5 | ≤ +0.000294 | ≤ 2.4% | requests that follow a failed `ss-*` call: 8 crashes, 1 usage rejection, 14 ENOENT, 6 scoped empty results on already-read files; 0.44 per rollout in 17 of 66 rollouts [M `logs/synth-codexwasted.txt`] | **S** | an association and an upper envelope, not removable spend (section 5.1) |
| 6 | −0.000603 | −4.9% | retrieval payload other than the guide — what `ss-*` still saves [M `02` section 8.1] | **S** credit | |
| 7 | −0.000157 | −1.3% | output and reasoning (5,524 against 5,786 tokens) [M] | **S** credit | |
| — | 0 | — | artefacts: rows tie to $0.0000005; price vector 2× stale with ratios intact [W `06` section 1.1]; cache-write surcharge unrecorded, worth 0.3 points against sweet if charged | **A** | |

**Opencode** — native $0.008969, sweet TAB $0.009265, **+3.31%**, interval [−8.5%, +16.4%]; cheaper on 13 of 22 tasks, median −$0.000208 [M `logs/p1-analyse.txt` 3].

| rank | $ per rollout | share | driver | class | basis |
|---|---:|---:|---|---|---|
| 1 | +0.000914 | +10.2% | **+3.38 requests** (19.70 against 16.32). Native issues 1.546 tool calls per request: 25.2% of its steps carry 2–4 parallel `read`/`grep`/`glob` calls and 55.6% of its calls sit in such steps. Sweet issues 1.106 (8.1% of steps) [M `logs/synth-ocparallel.txt`; `logs/p1-stats.txt` E]. The ratio was the same in epoch A (1.50 against 1.15). At the operation level the picture flips: sweet performs 28.6 operations per rollout against native's 27.5, because 20.8% of its bash envelopes chain two or more `ss-*` calls with `&&` [M `logs/p3-ops-per-envelope.txt`]. "Fewer calls" is an envelope count. One opencode request costs about $0.000341 in re-sent context plus output [M `10-panel-cost.md` claim 7] | **H** contract | the +$0.000914 is the Shapley turn term; the direct estimate $0.000341 × 3.38 = $0.00115 agrees in size |
| 2 | +0.000418 | +4.5% | the tool guide; opencode's fixed preamble is the smallest (6,498 tokens), so the same 1,457 tokens weigh most [M `logs/p1-analyse.txt` 4; `02` section 7] | **S** | |
| 3 | +0.000338 | +3.65% | the tab gutter (1,265 tokens; 62.6% re-send) [M `logs/p1-gutter.txt`] | **S** | |
| 4 | ≤ +0.000204 | ≤ 2.2% | requests after failed `ss-*` calls: 6 usage rejections, 7 empty bodies, 12 ENOENT, 3 scoped empty results, 3 crashes; 0.47 per rollout in 16 of 66 [M `logs/synth-ocwasted.txt`] | **S** | upper envelope |
| 5 | +0.000374 of the mean delta | — | `b2-259` alone; without it +3.3% → −0.1% [M `logs/p1-analyse.txt` 3] | **S**, pool-sensitive | |
| 6 | −0.001074 | −12.0% | retrieval payload — sweet's largest credit on any harness [M `02` section 8.1] | **S** credit | |
| — | ≈ +0.17 points | — | artefacts: half of each sweet cell is the repair pass at `CONCURRENCY=1`, which is 0.34% dearer than the surviving `CONCURRENCY=2` rows on the same 11 tasks [M `logs/p1-artefacts.txt`]; one PIPE row (`b2-259` rep 2) was never graded [M `04-resolution-opencode.md` section 1.1] | **A** | |

**Claude-code** — three numbers exist and each is right about a different thing [M `logs/p1-conventions.txt` A, reproducing `02` section 9.1 to six decimals]: **−8.8%** ($0.019125 against $0.020972, row-matched, the transcript the harness graded, ties to `costRealizedMainOnlyUsd` on 342 of 342 rows); **−3.9%** (published; dearest-3, which substitutes 12 discarded degeneration re-runs inside the fresh pool — sweet 5 / 4 / 2 for TAB / NONE / PIPE, native 1 [M `logs/final-boxcheck.txt` item 2]; the draft's 13th is a native row in `rb-claudecode-20260824`); **+1.9%** (every dollar spent, because sweet triggered 11 of those 12 re-runs). The interval on −8.8% is [−33.1%, +29.1%]; cheaper on 13 of 22 tasks.

| rank | $ per rollout | share of native | driver | class | basis |
|---|---:|---:|---|---|---|
| A1 | 127-point swing | — | 28 of 66 native rows carry null inclusive cost; summed as $0 the ledger reads +123.2% [M `FRESH-POOL` section 2] | **A** | never sum claude-code cost from `rows.json` |
| A2 | 4.9 points | — | the transcript-selection convention, above | **A** | |
| A3 | lower bound | — | 205 native delegated requests carry no usage at all (165 / 74 / 106 on the sweet forms); true native cost is higher [M `02` section 9.2] | **A** | |
| 1 | −0.001618 | −7.7% | **native's subagent spend.** Delegating rollouts sweet / native: 3 / 11 (A), 0 / 20 (B), 9 / 28 (C); task-cells 6 against 15 in C; sidechain $0.002811 against $0.004429 per rollout [M `logs/p1-analyse.txt` 6]. Only **4** of 22 tasks had no delegation in either arm; on them sweet's main-thread cost is **+26.3%**, interval [+5.0%, +51.9%]. On 34 rep-matched rollout pairs where neither delegated (17 tasks) it is +10.3%, interval [−11.7%, +43.9%]. On all 22 tasks main-only it is −1.4%, interval [−20.1%, +27.0%] [M `logs/p1-conventions.txt` B; `logs/p1-stats.txt` A] | **S** | `02` section 3.3 and the draft said "+6.8% on the 18 tasks where neither arm delegated". That subset is inverted: 18 is the number of tasks where at least one arm delegated, and +6.8% is the leave-one-out figure for dropping `moq-1262`. Retired. |
| 2 | −0.000700 | −3.3% | output and reasoning (5,248 against 6,415 tokens) [M] | **S** credit | |
| 3 | +0.000505 | +2.6% | the tool guide plus its `.claude/rules` wrapper, 1,565–1,570 tokens [M `logs/p1-analyse.txt` 4] | **S** | |
| 4 | +0.000392 | +2.0% | the tab gutter. The block file keys rollouts by (task, rep); the dearest-3 convention duplicated three keys, so 66 rows map to 63 keys and 62 carry blocks [M `data/blocks.ndjson.gz`, join in the session log]. Dividing the cell's gutter tokens by 66 gives $0.000392; `03`'s $0.000440 divided by 62 [M `logs/p1-gutter.txt`; `03` section 2.1] | **S** | |
| 5 | ≤ +0.000370 | ≤ 1.9% of the row-matched cell | requests after failed `ss-*` calls: 12 crashes, 12 usage rejections, 8 ENOENT, 12 scoped empty results; 0.67 per rollout in 21 of 66 [M `logs/synth-ccwasted.txt`]. The script's own denominator is a $0.015908 main-only column, which gives 2.3% | **S** | upper envelope |
| 6 | −0.000335 | −1.6% | −1.14 requests [M `02`] | **S** credit | |
| 7 | +0.000109 | +0.5% | retrieval payload — on claude-code retrieval saves nothing net [M `02` section 8.1] | **S** | |

"Delegation suppression" is an inference [I]. The sidechain difference is measured. The claim that sweet's retrieval removes the need to delegate rests on the direction across three epochs, not on a mediation test [M `logs/p1-analyse.txt` 6]. Two facts cut the other way: sweet still delegated in 9 rollouts of epoch C, and its main thread is dearer wherever neither arm delegated.

### 2.3 The cross-harness absolute gap

Claude-code costs 1.71× codex and codex 1.37× opencode on the realized column ($0.020972 / $0.012287 / $0.008969 native) [M `logs/p1-stats.txt` D]. The draft's "1.62× on the ideal column" mixed a claude ideal main thread with a realized sidechain. Ideal throughout gives 1.99×. That column prices a subagent's inherited prefix at the full input rate, so it is not meaningful for a sidechain. The $0.008685 claude-minus-codex gap decomposes as subagents +$0.004429, fixed preamble +$0.001898 (17,273 against 13,959 against 6,498 tokens, additive-model residual 4 tokens), the claude-only cache-write surcharge +$0.001144, other context +$0.000836, output +$0.000377 [M `02` section 7].

### 2.4 Three standing readings the numbers do not support

- **"Native narrows its own reads on harder tasks" (`FRESH-POOL` section 4) is half wrong on codex.** Native's p90 delivered output fell from 18,873 to 10,207 bytes between epochs A and C: that is the cap. Its read count roughly doubled (3.62 → 7.32 by `02`'s parse; 2.53 → 4.59 by `rows.json`'s `nativeRead`). Its total read payload rose 9% (`02`), and its total tool bytes rose 2.6% (`logs/p1-stats.txt` F). But its median output also fell from 3,139 to 2,617 bytes, below the cap. So part of the per-call fall is behaviour or pool [M `logs/p1-stats.txt` F]. The "adaptive output budgeting" lever inherits the wrong half.
- **"13–28% fewer tool calls" is true and does not pay.** Calls: opencode 21.8 against 25.2 (−13.6%), claude-code 29.9 against 41.8 (−28.6%, and the native count includes subagent calls). Requests: opencode 19.70 against 16.32 (**+20.7%**), claude-code 23.17 against 24.30 (−4.6%), codex 19.61 against 18.85 (+4.0%) [M `logs/p1-stats.txt`]. Cost follows requests. On opencode sweet also performs 4% more operations than native [M `logs/p3-ops-per-envelope.txt`].
- **"The guide is larger than the whole observed gap on every harness"** is true on codex (+0.35% observed against 3.4%) and opencode (+3.3% against 4.5%). It is false on claude-code, where the row-matched gap is −8.8%, 3.7 times the guide [M `logs/p1-analyse.txt`].

---

## 3. Why the gutter forms differ in price per harness

**Conclusion.** The delimiter's own tokens cost the same on every harness. What differs is behaviour and, on claude-code, delegation. Every dollar of every form-to-form gap, assigned [M `03` section 7; direct terms re-derived in `logs/p1-gutter.txt`]:

| harness | pair | observed $ | direct gutter tokens $ (`03` / `p1`) | delegation $ | behaviour $ | 95% task-bootstrap interval on observed | direct inside interval |
|---|---|---:|---|---:|---:|---|---|
| codex | TAB→NONE | −0.000011 | −0.000302 / −0.000302 | 0 | +0.000291 (NONE delivered 27 more code lines) | [−0.000955, +0.001207] | yes |
| codex | TAB→PIPE | +0.000424 | **+0.000217 / +0.000207** | 0 | +0.000207 (0.2 requests, 204 output tokens) | [−0.000609, +0.001436] | yes |
| opencode | TAB→NONE | −0.000681 | −0.000338 / −0.000338 | 0 | −0.000343 (6.0 against 6.6 `ss-read`, 926 against 948 lines) | [−0.001510, +0.000044] | yes |
| opencode | TAB→PIPE | −0.000501 | +0.000248 / +0.000236 | 0 | −0.000749 (fewest reads of any cell) | [−0.001293, +0.000254] | no, by $0.00001 |
| claude-code | TAB→NONE | −0.001304 (dearest-3) / −0.001780 (row-matched) | −0.000440 / −0.000417 | −0.000954 | +0.000091 | [−0.005565, +0.001461] | yes |
| claude-code | TAB→PIPE | −0.002966 (dearest-3) / −0.002395 (row-matched) | +0.000328 / +0.000287 | −0.001045 | −0.002248 (1,660 fewer output tokens) | [−0.007149, +0.001156] | yes |

Per delivered line the tab costs +1.34–1.36 tokens and the pipe +2.27–2.30; the difference is +0.93 on all three harnesses [M `03` section 2.2; `logs/p1-gutter.txt`]. About two thirds of the gutter's cost is re-send (61.5% codex, 62.6% opencode, 66.2% claude-code), because a delivered token stays for 15–20 further requests [M `logs/p1-gutter.txt`].

**Codex PIPE's premium.** The delimiter's own bytes are $0.000207–0.000217 of the observed +$0.000424 (49–51%). They are 69–72% of the input-side +$0.000302. The observed gap itself is not distinguishable from zero. So the share is a point estimate on a difference the run cannot confirm [M `03` section 7; `logs/p1-stats.txt` B].

**Claude-code.** The published −14.3% for PIPE is delegation plus verbosity with the delimiter pointing the other way. On the 12 tasks that never delegated in any form, PIPE is +3.5% dearer than TAB ($0.011297 against $0.010913). That is within $0.00024 of what its extra tokens predict. NONE holds −6.3% on both subsets, a third of it the tab's own tokens [M `03` section 4]. Two of the −14.3 points are a transcript-selection choice. The sign tests also depend on the convention: row-matched, TAB→PIPE is 12 cheaper / 10 dearer (`p = 0.83`), not 11 / 11 [M `logs/p1-stats.txt` B].

**Noise floor.** Every gutter effect is $0.0003–0.0004 per rollout. The task-bootstrap interval of a 66-rollout cell is ±$0.001 to ±$0.005, and none of the six excludes zero. A single rep of one form moves 24% (opencode TAB reps $0.008634 / $0.010612 / $0.008549) and 29% on claude-code [M `logs/p1-rep.txt`]. A −15% cost saving through the gutter would need 5,232–5,310 numbered lines per codex rollout against the 878 delivered [M `10-panel-cost.md` claim 20; `10-panel-gutter.md` claim 20]. The draft's 6,403 used a stale per-line constant. The direct token effect of any form is measurable at $0 by re-tokenising delivered blocks. What no affordable run can detect is whether behaviour eats the saving.

The gutter is 17.2–17.8% of the code payload it decorates, and that payload is 12.5–20.6% of a rollout [M `logs/p1-payload.txt`].

---

## 4. Gutter recommendation now, and the new designs

### 4.1 Recommendation per harness

| harness | keep | the evidence it rests on | what would change it |
|---|---|---|---|
| **claude-code** | `N<TAB>` | the contract says "line number + tab" and the harness renders it itself; the separator gate defaults off [C `05` section 1.1; `logs/final-boxcheck.txt`]. The tab is the cheapest dense form. Its carry is real on tab-indented files (3 of 22 tasks), costs calls only, and native's own `Read` has it; the pipe's carry is exposed on 19 of 22 tasks [M section 1.1]. Resolution 40 / 41 / 39 against native 43, `p ≥ 0.72` | the `tengu_tab_read_sep` gate defaulting on (then `N:` is the safer form), or a carry that changes a solve |
| **codex** | `N<TAB>` | price is the axis. NONE's direct saving of $0.000302 was not realised (−0.1% observed; NONE delivered 27 more lines) [M `03` section 7]. NONE loses the only clue to a middle-out truncation gap, the jump in the numbers [M `01` section 3.5]. The carry is absorbed and wrote an extra tab in 4 of 66 rollouts, all C# or Go [M section 1.2] | a silent carry in a whitespace-sensitive tab-indented file (then `N:` at +$0.00016 per rollout), or NONE realising ≥ its direct saving on ≥ 44 tasks with solves within the bar |
| **opencode** | `N<TAB>` | same as codex. TAB's 0 failed edits in 123 calls against NONE's 6 rollouts (`p = 0.028`) is one `p ≈ 0.03` event in nine cells and is not a reason by itself [M `01` section 1.2; `10-panel-resolution.md` section 6 item 12] | same as codex |

Ship nothing on the delimiter. The `FRESH-POOL-RESULTS.md` verdict stands, now with the mechanism measured on all three harnesses.

**The honest `N:` trade, per rollout** [M `logs/p2-tok.txt`, +0.706 tokens per line over the tab; `logs/p1-gutter.txt` lines per rollout]:
- codex: 859 lines × 0.706 = 607 tokens = +$0.000158 (1.3%);
- opencode: 930 × 0.706 = 657 tokens = +$0.000175 (1.9%);
- claude-code: about +$0.00021 (1.1%).

It would remove the 30 silent carries and the 8 claude-code TAB failures. `N:` and `N|` match 0 of 1,463,914 golden lines at line start, so their inverse strip is exact [M `10-panel-gutter.md` section 3.1]. It still should not ship: the claude-code gate is off, so the model is told "tab". Re-read the gate default at every claude-code version bump; that is a 30-second, $0 check.

### 4.2 New designs — none is worth a paid run

Expected savings are the measured tab overhead scaled by each design's per-line cost [M `logs/p2-tok.txt`]. None exceeds 3.7% of a rollout; none is detectable in a 66-rollout cell. The renderer constraints are read from source [C `core/search/search-read.js`; `tests/search/read-line-gutter.test.js`; `10-panel-gutter.md` section 3].

| rank | design | tokens per line | expected $ saved per rollout (codex · opencode · claude) | hard constraints | cheapest falsifier | disposition |
|---|---|---:|---|---|---|---|
| 1 | **sparse-10 tab**: number line 1 and every 10th line | +0.15 | 0.00027 · 0.00030 · 0.00035 | `GUTTER_DELIMITER` is a module-load constant with a test that forbids a runtime switch; two shipped tests assert every rendered line carries a prefix; strip hazard 104 of 1,522,150 golden lines (0.007%, one Jam debugger fixture); keeps the codex truncation clue (every tenth number survives) and buys 38 more lines per codex read before the cap (288 against 250) [M `logs/p2-cap.txt`] | $0: count `ss-read` range arguments in the traces that could only come from a gutter line ≥ 5 lines from a landmark, excluding headers, grep lines, search hits and the `unreadBelow` trailer | park: its kill lines ("`ss-read` calls up by > 0.5", "one anchor failure from a miscount") need a paid three-harness run |
| 2 | **header-only** (= NONE plus the existing `lines A–B` header) | ≈ 0 | 0.00030 · 0.00034 · 0.00039 | none — this is the NONE arm | already run, 198 rollouts per form | fired: codex +2, opencode −2, claude +1 against TAB; on codex the direct saving was eaten by 27 more delivered lines |
| 3 | **landmark tab**: number only lines that open a symbol | +0.07 to +0.15 (5.0% of lines by `05`, 10.5–11.3% by `logs/p2-tok.txt`) | 0.00029 · 0.00032 · 0.00037 | producible on `ss-read` only: `ss-search` and `ss-find` have one symbol per hit and no interior symbol table; degrades silently on unindexed files (the b2 golden holds 0 of 321 `.jam` files); cost uncertain by 2× | $0: share of `ss-read` ranges that start at a symbol boundary | park: would re-fragment the surfaces that `ba5b4ee` unified |
| 4 | **indent-aware delimiter**: tab files get `N:`, space files keep `N<TAB>` | +0.71 on 13.9% of lines | −0.00003 (a cost) | needs a new parameter on `numberCodeLines` through four call sites; cannot use the module-load hatch | $0: re-render the failed anchors under the candidate and check the strip is unique | dead: its own kill line ("0 rollouts saved") is the current reading |
| 5 | **`N:` everywhere** | +2.19 (against +1.48) | −0.00016 · −0.00018 · −0.00021 (a cost) | the only dense form ambiguous on neither indent style; 0 content collisions in 1.46 M golden lines | read the claude-code binary at each version for the gate default | hold until the gate flips on |
| — | `N| `, `N |`, `N: `, padded `cat -n`; Sol's "sidecar ruler" | dominated; the ruler is header-only plus sparse ticks | — | — | — | do not revisit |

Opencode's own `N: ` contract belongs to its `edit` tool, which the agent called 0 times; `apply_patch` declares no prefix [C `10-panel-gutter.md` section 3.4]. "Match opencode's own prefix" would match a contract the agent never reads.

---

## 5. Cost and resolution levers beyond the discard logs

Each lever names the mechanism, the evidence, the size, whether it is sweet-only (a shared change has zero A/B differential), and a $0 falsifier. All were checked against `SLATE-A-UBER.md` section 9, `SLATE-B-UBER.md` section 8 and `PREAMBLE-TRIM-GATE.md`.

### 5.1 Cost levers

**C1 — the `ss-*` hygiene package (sweet-only; low risk; ship as correctness).** Evidence [M `logs/synth-*wasted.txt`; `04-*` product-defect lists]:
- crashes on a literal-looking regex, printing a Node stack trace and about 830 bytes of model-load banner. Counts: 37 calls in 27 claude-code rollouts, 18 / 17 codex, 15 / 12 opencode;
- usage rejections of grep-shaped invocations (`ss-grep "<pat>" <path>`, `ss-find … --in`): 70 calls in 33 claude-code rollouts;
- `ss-read` ENOENT with no hint: 51 claude-code, 27 codex, 30 opencode;
- empty bodies with `status=error`: 15 opencode;
- `(no matches)` on a scope the rollout had already read: 69 claude-code, 26 codex scoped.

Fixes:
- compile the pattern before any engine work; on failure fall back to `-F` and print the `rg` diagnostic;
- accept a trailing positional path as `--in`; give `ss-find` `--in`;
- never print the banner; never return an empty body;
- say `not indexed: <path>` when the scope exists on disk but holds no indexed content.

Size: the requests that follow these calls total $0.000294 / $0.000204 / $0.000370 per sweet TAB rollout (2.4% / 2.2% / 1.9%). That figure prices the whole next request, which the agent may have needed anyway. So it is an association and an upper envelope [M `10-panel-sol.md` item 11]. It also moves with the form (codex PIPE 1.4%, claude-code PIPE 5.6%). The risk is low, not zero: a positional path, an `-F` fallback and a "not indexed" message each change the agent's next action [I]. $0 falsifier: replay the recorded failing commands against the goldens with the fixed wrappers. Kill any fix that recovers fewer than half of its cases. The BRE `\|` half is a known bug with a shipped hint and no retry [M `04-resolution-opencode.md` D6]. The scoped-empty class overlaps C3, so the two must not be summed.

**C2 — shrink the tool guide (closed as proposed).** The guide is exactly 1,457 tokens at the wire on all 66 codex pairs and all 66 opencode pairs, and 1,565–1,570 on claude-code. Priced by the formula `G × (0.10 + 0.01 × (T − 1))` it costs $0.000417 / $0.000418 / $0.000505 per rollout (3.4% / 4.5% / 2.6%) [M `logs/p1-analyse.txt` 4]. The frontmatter's `token_count: 1307` is 11% low. None of this is new. `PREAMBLE-TRIM-GATE.md` (2026-08-10) measured the same +1,457 tokens (4.1% of the sweet arm). It trimmed the tool docs at $0 and netted 23 tokens (0.07%). It ruled that a material saving means "deleting roughly 25 of the 30 rules — a solve-safety question needing per-rule ablation, not a trim" [C]. The owner's authorised scope that day was: "the guidance block is NOT trimmed". The guide is produced by the prompt-optimisation process and used verbatim. Every addition since shipped on a measured smoke [C memory `project_mpm_delivery_via_memory_file`, `project_mpp_shipped_2_5_3`]. A hand-written 200-token replacement discards those untested. It also removes the doctrine behind both measured sweet wins (no delegation on claude-code; fewer calls). Two 2026 studies find repository context files raise cost 20–23% at −0.5% to −2% resolution [W `07` section 5.1, <https://arxiv.org/abs/2602.11988>, <https://arxiv.org/abs/2607.27250>]. That is a reason to re-open the question inside the prompt process with a length term. It is not a reason to hand-author an arm. **Disposition: re-open only through the prompt-optimisation process, after the per-rule ablation the gate asked for.**

**C3 — the index-coverage fix and the "not indexed" message, as a cost lever (sweet-only; ship).** On the two Boost.Build tasks sweet greps a corpus that holds no Jam. On codex, 85 of the pool's 131 zero-match `ss-grep` calls are those two tasks (50 on `b2-113`, 35 on `b2-259`). On claude-code, 49 of 69 scoped empty results are those two tasks. One rollout burned 30 empty results [M `04-resolution-codex.md` section 2.4; `04-resolution-claude-code.md` section 2.2]. Sweet runs 11–17 requests longer than native there and solves nothing. Ceiling: two tasks of 22; it moves the pool mean, not the product. The stop-rule family is dead on record; the upstream fix removes the reason to grind. $0 falsifier: count how many of the 69 scoped empty results are followed within three calls by another `ss-*` call with the same scope. Kill below a third. **The fix is inert in any run until the goldens are rebuilt.** Every fresh-pool row carries `idxSource: golden-cache`, and the three b2 goldens date from 2026-07-16 [M `logs/final-boxcheck.txt` items 2–3].

**C4 — call packing on opencode (dead).** If sweet's calls ran at native's rate, the ceiling is −$0.0018 (−20%) by envelope count. At the operation level it is only −$0.00088 (−9.5%), because sweet already chains operations inside envelopes [M `logs/p3-ops-per-envelope.txt`]. Every mechanism to collect it is closed on record [C `TURN_PACKING_FINAL.md`; `TURN_FIX_PLAN.md`; `10-panel-resolution.md` section 2.1]. The prompt form: `SLATE-A` section 9 item 12, `SLATE-B` section 8 "pack more probes", and the turn-count programme's packing lever (closed). `ss-batch`: deployed, called 0 times in 198 opencode rollouts, 3 of 4 traps under a hardened guard. Mid-task advisories: channel-deaf 3 of 3. MCP delivery: scoped out by the owner on 2026-07-31.

**C5 — payload budgeting by lifetime (park at $0).** An early read is 1.9× as dear as a late read of the same size [M `06` section 7.3]. Admissible only as "different lines", never as "the same lines rendered smaller" (`SLATE-A` section 9 item 6; `SLATE-B` section 8). The one concrete form with a $0 falsifier is this: on `sufficient=YES`, return the top-1 body and a manifest of lower ranks. Falsify it by counting how often a lower-rank body is later edited or re-read. Kill above 20%. Check overlap with the shipped pointer tier first.

**Dead by measurement.** The `<state_summary>` block is 0.89–1.29 blocks per rollout and 71–120 output tokens. It never occupies its own request on codex (0 of 59) and once on claude-code (1 of 85, $0.000008 per rollout). It is under 0.5% of spend [M `logs/synth-statesum*.txt`]. The prompt-optimisation run (GEPA generation 3) already recorded it as "not removable". Text-only requests are 1.0–1.05 per rollout, 3.7–3.8% of the cell on codex and claude-code. That is the final answer message, and it is not removable [M `logs/synth-statesum2.txt`] [I]. Cache engineering (hit already 99.3–100% of re-sent tokens). Compaction and eviction (never fire; largest context 100,624 of 1,050,000 tokens). Trimming the verification tail (cost is flat by request position, last quarter 1.02–1.13× the first) [M `06` sections 0, 7.8]. Sweet's output is below native's on codex and claude-code and 1.1% above on opencode (3,645 against 3,606) [M `logs/p1-analyse.txt` 5].

### 5.2 Resolution levers

**R1 — index `.jam`; exclude `build/`, `dist/`, `out/`, `target/` only when git does not track them (sweet-only; ship as correctness).** Evidence: 0 of 321 `.jam` files are indexed in the b2 golden. `'**/build/**'` is unanchored and deletes `src/build/**` [C `core/infrastructure/config/search.js:51,188`][M `04-resolution-codex.md` section 2.4; `logs/final-boxcheck.txt` item 3]. `stage.jam` never appeared in an `ss-*` result in 9 of 9 codex sweet rollouts, 9 of 9 claude-code, and at least 8 of 9 opencode. Native reached it and solved 1 of 3 on each harness. That +1 of 66 per harness is native's observed count, not a ceiling for a repaired sweet [I]. The standing extension-coverage audit did test the directory deny list and judged `build/` exclusions legitimate [C memory `project_taskbench_extension_coverage_audit`]. b2 was outside its pool, so the instance is new and the class was known. $0 falsifier: re-index one b2 golden with the fix and replay the 59 recorded zero-match `ss-grep` and 9 `ss-search` queries. Kill if `src/tools/stage.jam` is not in the top ten. Also `dist/index.js` on `aws-actions` (13 wasted scoped greps, solved anyway). Rebuild the affected goldens on the box before any run; mac-built goldens are degraded [C memory `project_taskbench_extension_coverage_audit`].

**R2 — say "not indexed", never `(no matches)` (sweet-only; ship with C1).** Same evidence as C3. Ranking-neutral, so the agent-format gate for ranking signals does not apply.

**R3 — report where an edit's anchor is ambiguous (measure, do not build).** 41 of 295 opencode first edits carry an ambiguous anchor, arm-symmetric (native 12, TAB 12, NONE 11, PIPE 6). It decided `accenture-1974` only. There, 5 of 9 opencode sweet rollouts landed the guard in the wrong method, against 1 of 3 native [M `04-resolution-opencode.md` sections 2.1, 3.3]. Every losing rollout ran `git diff`, read `@@ -1593` — the harness already told them where the hunk landed — and 5 of 6 stopped [M]. That is the "evidence presence does not force the correct choice" family, killed in `SLATE-A` section 9 item 7 and by the completeness-card record. The task's direction also flips by harness (codex sweet 3 of 9 against native 0 of 3; claude-code 6 of 9 against 3 of 3). Existence proof n = 1. Keep the $0 count as a measurement.

**R4 — working-tree freshness for `ss-grep` (measure at $0 first).** `ss-grep` is index-backed. It cannot see a symbol the agent added in the same rollout, while `ss-read` in the same envelope can. Four clean rollouts on codex [M `04-resolution-codex.md` L3]. It decided no rollout. $0 falsifier: count `ss-grep` calls after the rollout's first successful edit that query a symbol the agent added. Kill if that population is under 5% of calls.

**R5 — index-selected regression tests (sweet-only if index-side; $0 census first).** This is the one published lever that is both sweet-only and has an effect size. It gave +8.0–12.9% relative resolution inside three agents at $0.02–0.05 per instance [W `07` L1, <https://arxiv.org/abs/2510.18270>, abstract only]. Not in either discard log; distinct from tests-first (rejected twice). $0 falsifier: count retained `run_tests` calls that ran a full suite when a symbol-scoped subset existed. Count rollouts that died after a timeout or an unreadable test dump. Kill below one exposed call per rollout. Re-price for this model before believing the effect.

**R6 — never end a turn on a condenser summary.** One rollout in 264 (`nmt-192` TAB rep 0: four calls, no edit, empty patch, last message a `<state_summary>`) [M `04-resolution-claude-code.md` section 2.5]. A bug report, not a lever.

**Where resolution actually goes.** Of 101 unsolved cells on the 11 non-trivial codex tasks, 50 are wrong-fix and 33 are not-localised. Of the 33, 21 are the two b2 tasks and 9 of those are the index gap. The rest are incomplete 14, edit-mechanics 3, environment 1 [M `04-resolution-codex.md` section 4]. On claude-code, the 29 lost cells on the five discordant tasks are not-localised 17 (11 of them `b2-113`), wrong-fix 9, incomplete 1, gave-up 1, other 1 [M `04-resolution-claude-code.md` section 4]. Retrieval explains one task. The literature agrees. Agents reach the right file in 72–81% of failed trajectories and fail on a wrong belief. Oracle localisation leaves success below 50% [W `07` section 1]. Every arm difference in this run is a sum of single rollouts [M `10-panel-resolution.md` section 5]:
- `b2-113` native rep 0: one solve per harness;
- `awslabs-21` TAB rep 2: a 1 ms timestamp flake;
- `accenture-1974` PIPE rep 2: the one rollout that moved its hunk;
- `aiohttp-8038` native rep 1: 125 calls, 36 edits, 2 subagents.

### 5.3 Rejected, with the killing fact

| idea | source | why not |
|---|---|---|
| dependency-source corpus | Sol 20, `SLATE-B` P1 | `spectator-181` has no `vendor/` tree and the string is nowhere in the checkout; network banned; the zero-cost dependency-source gate (W0 P1) had sweet reaching 6 of 102 against native 17 of 102 [M `04-resolution-opencode.md` section 2.6; memory] |
| issue→diff obligation checker; absent-artifact implementation graph | Sol 19, 22 | obligation graphs fail the blinded bar 4 of 5; the completeness card died at $0; `solhint` scores `f2p 0.4` in 11 of 12 cells in every arm [M memory; `04-*`] |
| executable public-surface witnesses | Sol 21 | the executable-witness gate (P6) discriminated only enumerability; the tests-first gate (P3) was blocked twice; over-specification would block 11 solved tasks [M memory] |
| `apply_patch` preflight / canonicaliser | Sol 18 | harness-owned surface; Cline's >10% order-invariance gain is an apply-side fix we do not own [W `05` section 1.9] |
| remove the `<state_summary>` | Sol 17 | measured under 0.5%; already recorded as not removable [M] |
| replace the guide with one typed `ss` operation | Sol 13 | a new tool changes the cached prefix (tool schemas sit inside it [W `06` section 2.1]) and breaks the no-new-tools rule; the same rule kills C4's MCP form |
| a stop rule on unproductive rollouts | `02` section 8.1 | thrash levers are no-go on record; the b2 grind has an upstream cause (C3, R1, R2) |
| more sibling retrieval; prompt clauses on hunk order or guard scoping | `04` ×3 | discard logs and the clause graveyard; `aws-embedded-metrics` PIPE rep 1 read the gold file at call 5 and patched the serializer at call 9 |
| semantic search as a grep replacement | `07` L9 | +6% to +118% token premium; agents pick it 0–6% of the time when free [W] |
| delegation for sweet on claude-code | `07` L2 | native already delegates (15 cells) and sweet's win is not needing to; the ledger prices subagents as a lower bound |
| raising codex's output cap to favour sweet | `05` section 4.3 | a harness setting shared by both arms; the default is what codex users get; raising it is a cost regression by construction and no measured failure waits behind it (0 of 6 never-shown anchors in a truncated span) |
| the gutter as a cost lever, any form | sections 3, 4 | $0.0003–0.0004 per rollout against ±$0.001–0.005 intervals; 5,300 lines needed for −15% |

### 5.4 Sol's 22 ideation claims — accepted, corrected, rejected

| # | verdict | reason |
|---|---|---|
| 1 | accept | the three cost components are published per harness and arm (section 2.1) |
| 2 | correct | on codex the cap is sufficient in size to explain the flip (+12.7 points on a static replay, interval including zero); on opencode the term is requests |
| 3 | correct | the guide is 1,457 tokens, not 1,307; $0.000418 and 4.5% on opencode, not $0.000353 and 3.8%; subagent inheritance of the guide is unresolved (minimum subagent bundle 5,353 against 5,346 tokens [M `06` section 5.4]) |
| 4 | accept the shape | sweet ingests less and re-sends more on every harness; whole-file `ss-read` is 47 of 4,113 invocations (1.1%) and is not a live mechanism |
| 5 | partial | contract facts hold; sweet's per-call payload is already smaller than native's on codex (5.3–6.4 kB against 7.8–8.6 kB); the excess is requests |
| 6 | correct | ordering NONE < TAB < PIPE holds (+1.34 / +2.27 per delivered line); "current code numbers surfaces that were unnumbered during the experiment" is false — `ba5b4ee` landed at 16:14 and the first rollout ran at 22:27; 94–96% of search-surface lines were numbered in epoch C [M `02` H11] |
| 7 | accept | codex: about half of PIPE's premium is its bytes; opencode: behaviour; claude-code: delegation plus verbosity, and PIPE is +3.5% on the twelve never-delegating tasks |
| 8 | reject as a ship decision | NONE on codex and opencode has a bounded $0.0003 upside that codex did not realise; no bar was cleared |
| 9 | accept as $0 screens only | sparse-10 and landmark are ranks 1 and 3 in section 4.2; both are parked |
| 10 | accept narrowly | the delimiter is a 2.0–3.7% cost term; "lever" overstates it because no affordable run can detect a change |
| 11 | accept | the −16% comment at `search-read.js:621` is stale |
| 12 | partial | "coin flip" is right about which tasks delegate; "mediation not proven" is right (section 2.2) |
| 13 | split | shrink: closed by scope (C2); typed operation: rejected |
| 14, 15 | accept with the discard-log constraint | C5 |
| 16 | reject | same as 8 |
| 17 | reject | measured dead |
| 18 | partial | R3, measurement only |
| 19–22 | reject | section 5.3 |

---

## 6. The recommended next run

**No paid gutter arm and no paid guide arm.** The gutter is below the noise floor of any affordable cell (section 3). The guide shrink was gated and dropped on 2026-08-10, with the guidance block excluded from trimming by the owner. A hand-written arm is outside the prompt process that owns the guide (section 5.1, C2). The draft's proposed guide A/B also had no power for its own bars [M `logs/p3-power.txt`]. 16–17 of the 22 tasks are solved everywhere or dead everywhere, so the resolution bar rides on 15–18 rollouts per harness. A treatment that loses one solve in four on those tasks crosses the bar 8–19% of the time. One that halves them crosses it 40–50% of the time. The false-kill rate is under 1% per harness. Its behaviour bar (Δ requests ≤ +1.0, Δ output ≤ +10%) sits inside the spread between the three sweet forms, which are one treatment (opencode requests 19.7 / 18.9 / 18.4; claude-code output 7,669 / 8,161 / 6,009 tokens) [M `03` section 3].

**Phase 1 — $0, before any spend.**
1. Run the C1 replay falsifier (recorded failing commands against the goldens with the fixed wrappers).
2. Re-index one b2 golden with the index-coverage fix and replay the recorded queries (R1 falsifier).
3. Count the scoped-empty retries (C3 falsifier) and the working-tree `ss-grep` exposure (R4 falsifier).
4. Run the `run_tests` scope census (R5 falsifier).
5. Rebuild every golden whose repository keeps tracked source under an excluded directory name.
6. Add the harness version and API path to every `rows.json` row. Today the box runs codex-cli 0.146.1, opencode 1.18.4 and claude 2.1.218 [M `logs/final-boxcheck.txt` item 5]. No row records any of them.
7. Count tab-indented files in whitespace-sensitive languages across the goldens, to bound the silent-carry hazard of section 1.2.

**Phase 2 — one contemporaneous re-baseline.** Two arms: native, and sweet with `N<TAB>` and the shipped fixes. Three harnesses, three reps. The pool: a fresh 22-task pool drawn by the existing outcome-blind selector, plus the five fixed control tasks (`scoringutils`, `parcels`, `robot`, `zlint`, `dot-prop`). The fresh-pool tasks are burned for any blinded claim. They are written up with gold files and failure modes. The index fix targets two of them, and the hygiene fixes were derived from their failures [C memory `project_blinded_pool_burned_by_turnfix`]. No control task ran in the fresh pool; the five appear in 0 of the 12 pilot logs [M `logs/final-boxcheck.txt` item 3]. Both arms must run in the same window. A harness-side change moved codex cost by more than the whole sweet-versus-native gap between epochs. Pooling an old native arm repeats that confound. Opencode at `CONCURRENCY=1` until the version-probe race is fixed. Ledger re-swept green. Note that the ledger fingerprint hashes only the generated `run_tests` shim. It says nothing about the wrappers or the index; their falsifiers are phase 1 [C memory `project_ledger_fingerprint_v4`].

**Pre-registered bars.** (1) Resolution: sweet within 6 rollouts of native on every harness. (2) Controls: 3 of 3 in both arms on every harness. A control cell below 2 of 3 voids that harness (environment, not treatment). A control that fails in one arm only is diagnosed blind before anything is voided. (3) Hygiene: failed `ss-*` calls per sweet rollout ≤ 0.2 on every harness, measured by the `synth-*-wasted` scripts. (4) Accounting: claude-code priced on the graded transcript per row and published with all three conventions. Codex and opencode priced from `rows.json`. The run's spend published as the sum of the cells. (5) Read-only rule: nothing per-query on the held-out set; the new pool is DEV.

**Cost.** The fresh-pool cell totals are codex $0.81, opencode $0.60 and claude-code $1.17–1.42 per 66 rollouts [M `FRESH-POOL` section 1]. The run is 2 arms × 27 tasks × 3 reps × 3 harnesses = 486 rollouts. It costs about **$7.5** at the registered price and about **$15** at today's listed luna price (2× the registered vector, ratios intact [W `06` section 1.1]). Add about 20% on claude-code for degeneration re-runs, and golden builds (CPU hours, no API spend).

**What it buys and what it does not.** It re-tests parity after the correctness fixes on tasks nobody has inspected. It re-measures the sweet-versus-native cost gap with controls and versions recorded. It does not buy a cost interval at ±4%; that needs about 130 tasks per harness. The cost claim rides on arithmetic and the paired interval, and the pre-registration must say so.

---

## 7. Panel dispositions

### 7.1 The twenty claims of the draft

| # | claim (short) | panel verdicts (cost / gutter / resolution / Sol) | disposition | why |
|---|---|---|---|---|
| 1 | tab gutter $0.00030–0.00044, 2.1–3.7%, two thirds re-send; earlier estimates 2.5–4× low | weakened / weakened / upheld / weakened | **accepted, corrected** | claude-code is $0.000392 at 66 rollouts (2.0%); re-send 61.5–66.2%; understatement 2.1–3.3× with three causes: the epoch-B line count (2.0–2.2×), a 0.5 re-send assumption, and calls used where requests belong [M `logs/p1-gutter.txt`; `logs/r1-price.txt`] |
| 2 | codex PIPE premium 51% delimiter bytes; +0.93 tokens per line | weakened / upheld / upheld / upheld | **accepted, qualified** | 49–51% and 69–72% by two tokenisations; the observed gap's interval includes zero, so the share is a point estimate on an unconfirmed difference |
| 3 | claude-code carry real and symmetric; 20 carries, $0.0327, 0 solves | weakened / weakened / upheld / weakened | **accepted, corrected** | edit-level counts and Fisher tests reproduce; add clustering (14 events, 8 rollouts, 3 tasks), rollout-level `p = 0.21 / 0.24`, one PIPE case misclassified, $0.0126–0.0327 as bounds; "symmetric" → mirror-image in kind, not in count |
| 4 | codex and opencode have no delimiter mechanism | — / **refuted** / upheld / upheld | **refuted; rejected the draft** | the carry fires under TAB on both (15 lines in 4 of 66 and 3 of 66 rollouts, 0 under NONE and PIPE, `p = 0.0004`), the seek absorbs it, and `+` lines write an extra indent character; verified on one call [M `logs/final-boxcheck.txt`]; the 0-failure and 0-residue counts stand |
| 5 | claude-code `Edit` does not force a prior `Read` | — / weakened / weakened / upheld | **accepted as a measurement; corrected as a statement** | the gate is disabled by model identity (`grg` holds ten Anthropic ids); on a Claude model all 218 edits would throw [C `logs/final-gatecheck.txt`] |
| 6 | codex flip is the cap; 40% / 15% deleted; replay −6.5% → +11.5%, interval [+1.7%, +22.2%] | **refuted** / — / weakened / weakened | **refuted on magnitude; accepted on mechanism** | codex's own counts give 35.1% / 10.6%; the replay at the measured 3.99 bytes per token gives +6.3%, interval [−5.2%, +19.6%]; the draft used a subtraction and two different byte rates; version against API path unrecorded |
| 7 | opencode flip is requests, not bytes | upheld / — / weakened / weakened | **accepted, extended** | request accounting reproduces exactly; at the operation level sweet does 4% more operations, so "serial against parallel" is an envelope artefact; the cross-epoch "harder pool" attribution is [I] |
| 8 | claude-code never flipped; −8.8% / −3.9% / +1.9%; 13 re-runs | upheld / — / upheld / weakened | **accepted, one count corrected** | 12 discarded re-runs inside the fresh pool, the 13th in the rebaseline run [M `logs/final-boxcheck.txt`] |
| 9 | delegation suppression −$0.001619; on the 18 non-delegating tasks +6.8% | **refuted** on the subset / — / weakened / weakened | **refuted; rejected the draft's subset** | 18 is the number of tasks where at least one arm delegated; 4 are clean and show +26.3%, interval [+5.0%, +51.9%]; the +6.8% is a leave-one-out figure; "suppression" downgraded to [I] |
| 10 | guide 1,457 tokens; $0.000426 / 0.000408 / 0.000530; larger than the gap everywhere | weakened / — / weakened / weakened | **accepted, corrected** | arithmetic price $0.000417 / 0.000418 / 0.000505; the constant was measured on 2026-08-10; "larger than the gap" false on claude-code |
| 11 | wasted-call requests $0.000294 / 0.000204 / 0.000370, zero behavioural risk | weakened / — / weakened / **refuted** | **accepted as a bound; rejected as removable spend and as zero risk** | prices the whole next request; claude denominator ties to no published column (1.9% row-matched); unstable across forms; fixes change behaviour |
| 12 | `<state_summary>` never its own request; under 0.5%; sweet output below native | upheld / — / weakened / weakened | **accepted, two corrections** | one standalone claude-code request ($0.000008 per rollout); sweet output 1.1% above native on opencode; disposition already on record |
| 13 | fewer calls does not pay | upheld / — / upheld / weakened | **accepted, qualified** | valid on opencode (+20.7% requests); the claude-code 41.8 includes subagent calls; operations +4% on opencode |
| 14 | 1.25× surcharge on claude-code only; uniform; 1.62× ideal | weakened / — / upheld / weakened | **accepted on code; corrected on uniformity and the ratio** | arms write different cache-token counts (opencode +3.31% → +2.52%); 1.62× was a mixed column; realized 1.707× and 1.370× |
| 15 | index coverage is the only sweet defect deciding rollouts; ceiling +1 of 66 | — / — / upheld / weakened | **accepted, two corrections** | +1 is native's observed count, not a ceiling for a repaired sweet; the extension audit did test the deny list; the fix is inert without a golden rebuild |
| 16 | the two b2 tasks carry the codex and opencode flips | upheld / — / upheld / weakened | **accepted, one count corrected** | codex zero-match calls on the two tasks are 85 of 131 (50 + 35), not 50 |
| 17 | `FRESH-POOL` section 4's "native narrows its reads" is wrong on codex | weakened / — / weakened / upheld | **accepted as half wrong** | the p90 fall is the cap; the median fell below the cap too; total payload +2.6% to +9% by measure |
| 18 | the six-task anchor result reverses at 66 rollouts | — / upheld / upheld / upheld | **accepted, metric corrected** | quote anchor-only rates like for like (7.4 / 5.9 / 4.4 / 4.4%); rollouts-with-failure flat at `p = 0.69` or `p = 0.84` by census |
| 19 | the run cost $11.76, not $6.9 | **refuted** on the number / — / upheld / **refuted** | **refuted; corrected** | $11.76 used the dearest-3 convention the draft rejects; graded-transcript total $11.40; every dollar $11.98; 12 published cells $10.87; the 18 deleted rollouts contribute $0; $6.9 is wrong by 1.6× either way [M `logs/p1-conventions.txt` E] |
| 20 | no gutter design is detectable in an affordable run | upheld / weakened / upheld / weakened | **accepted, two numbers corrected** | 5,232–5,310 lines, not 6,403; the direct token term is measurable at $0 — only the behavioural remainder is undetectable |

### 7.2 Panel findings beyond the twenty claims

| finding | source | disposition |
|---|---|---|
| the tab is ambiguous on 9.9% of a mixed corpus (all tab-indented lines with ≥2 tabs); `N:` and `N|` on 0% | `10-panel-gutter.md` section 2 | **accepted**; corrects `05` section 3.4 and the draft's tokeniser sentence |
| the guide shrink was gated and dropped on 2026-08-10; the guidance block is outside the owner's authorised scope | `10-panel-resolution.md` section 2.1 | **accepted**; verified in `PREAMBLE-TRIM-GATE.md`; the draft's next run is withdrawn |
| the proposed run has no power for its bars; false kill < 1%, power 8–19% against a one-in-four loss | `logs/p3-power.txt` | **accepted** |
| no control task ran in the fresh pool; the pre-registration's control clause was vacuous | `logs/final-boxcheck.txt` item 3 | **accepted**; five fixed controls added to the next run |
| harness version and API path are not recorded per row | `logs/final-boxcheck.txt` item 2 | **accepted**; phase-1 item |
| R1 is inert without a golden rebuild; the ledger fingerprint covers neither wrappers nor index | `10-panel-resolution.md` sections 4.4–4.5 | **accepted** |
| C4's ceiling halves at the operation level and every mechanism is closed | `logs/p3-ops-per-envelope.txt` | **accepted**; C4 dead |
| R3 belongs to the dead evidence-presence family | `10-panel-resolution.md` section 2.2 | **accepted**; measure only |
| opencode arms ran under different concurrency (about 0.17 points against sweet) | `logs/p1-artefacts.txt` | **accepted**; listed as an artefact |
| `03`'s claude-code sign tests are a transcript-selection artefact | `logs/p1-stats.txt` B | **accepted** |
| the codex cap clusters at 10,207–10,212 delivered bytes and may be a character budget | `10-panel-cost.md` section 3 item 2 | **noted as [I]**; the config key question stays open |
| index-selected regression tests were omitted from the lever list | `10-panel-sol.md` section 3 | **accepted**; R5 with a $0 census |
| working-tree freshness for `ss-grep` was dropped from the synthesis | `10-panel-sol.md` section 3 | **accepted**; R4 |
| opencode parallel delivery should precede a guide run | `10-panel-sol.md` section 3 | **rejected**; every delivery mechanism is closed on record and the guide run is withdrawn |
| the `+1 of 66` b2 figure is not a ceiling for a repaired sweet | `10-panel-sol.md` item 15 | **accepted** |
| "Sweet-min" arm removes the doctrine behind both measured wins | `10-panel-resolution.md` section 6 item 9 | **accepted**; the arm is withdrawn |

### 7.3 Corrections to the standing record

1. `FRESH-POOL-RESULTS.md` section 0: the $6.9 spend figure is wrong. The twelve published cells sum to $10.87; every graded rollout including the repair pass sums to $11.40; every dollar paid to $11.98 [M `logs/p1-conventions.txt` E].
2. `FRESH-POOL-RESULTS.md` sections 4 and 7: "adaptive output budgeting is the lever" rests on a half-wrong reading of codex. The true codex story is the cap, and the true opencode story is requests. The efficiency claim must say "fewer calls, not fewer requests", and on opencode it is an envelope count.
3. `FRESH-POOL-RESULTS.md` Appendix A: add a ninth trap: check `f2pFrac` and `testResults` for null, not only `resolved` (`b2-259` PIPE rep 2 on opencode). Add a tenth: `rows.json` records no harness version or API path.
4. `GUTTER-MECHANISM-INVESTIGATION.md` section 0 item 2 and section 4.2–4.3: "on codex and opencode the delimiter has no mechanism" is withdrawn. The carry is present and absorbed (section 1.2). Section 1.2's "config.toml sets no limit" is true of the deployment, not of the capability [C `05` section 1.3]. Section 5.4's "tab is cheapest by 0.93 tokens per line" holds against `N| `; against `N:` the margin is 0.71.
5. `GUTTER-AB-RESULTS.md` section 0: the claude-code anchor table is withdrawn at 66 rollouts (section 1.5).
6. `REBASELINE-RESULTS.md` section 2: "sweet used zero subagents" was true of epoch B only; in epoch C sweet delegated in 9 rollouts (6 cells).
7. `02` section 3.1 and `09` section 2.2: the codex cap counterfactual figures (10,505 / 2,357 tokens; +11.5%, interval [+1.7%, +22.2%]) are retired for the figures in section 2.2.
8. `02` section 3.3 and `09`: the "18 tasks where neither arm delegated, +6.8%" subset is retired for the figures in section 2.2.
9. `05` section 3.4: the tab's "0% ambiguous" is retired for the symmetric measure (9.9%).
10. The guide frontmatter `token_count: 1307` understates the real 1,457 by 11%. The −16% comment at `search-read.js:621` is stale.
11. `01` section 0 and `09` section 1: "codex and opencode show no delimiter mechanism at all" is withdrawn (section 1.2).

### 7.4 What I could not finish

- I did not re-run the four panels' bootstraps; I verified their inputs and their logs against each other and against the evidence files.
- I did not test whether a carried `+` line ever reached a shipped patch on codex or opencode. The three codex TAB `moq` reps shipped empty patches, so that task cannot answer it [I].
- The cause of the codex cap change (version or OpenRouter path) is unresolved. `rows.json` records neither, and the box rules forbid a smoke.
- Whether luna is really billed 1.25× on cache writes is a web claim. No provider bill was available.
- The C1, R1, C3, R4 and R5 falsifiers are specified, not run. They need write access to a scratch golden, which was outside this pass.

---

## 8. Evidence index

Every file under `eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/`, one line each.

**Reports and evidence files**

| file | what it establishes |
|---|---|
| `01-edit-mechanisms.md` / `.json` | edit census over 792 rollouts: per-cell failure rates, 20 carry cases with bytes, 0 residue in 14,249 anchor lines, read surfaces, codex truncation, un-gutted share 1.8–3.1% |
| `02-cost-decomposition.md` / `.json` | 1,311 rollouts re-priced; per-rollout INGEST / re-send / OUTPUT; paired deltas and leave-one-out; the 1,457-token guide; the three claude-code conventions; the codex cap replay (magnitude retired here) |
| `03-gutter-form-cost.md` / `.json` | every delivered `ss-*` block re-tokenised in four renderings; direct / delegation / behaviour budget of each form pair; task-bootstrap intervals; the 12 never-delegating tasks |
| `04-resolution-codex.md` / `.json` | codex solve matrix, per-task forensics, the b2 index gap measured on the golden index, tool-health defects D1–D10, the 101-cell failure taxonomy |
| `04-resolution-opencode.md` / `.json` | opencode solve matrix, the `accenture` hunk-misplacement mechanism, the `.jam` blind spot, defects D1–D10, the ungraded row, anchor ambiguity 41 of 295 |
| `04-resolution-claude-code.md` / `.json` | claude-code solve matrix, the b2 loss, the `nmt` premature stop, the TAB carry on `moq`, tool-health D1–D11, the anchor-rate reversal, the effort profile |
| `05-research-editing-interfaces.md` | tool contracts from the deployed binaries and vendor sources; tokeniser micro-study; the separator gate; codex `tool_output_token_limit`; literature on line numbers |
| `06-research-cost-mechanics.md` | price vector (2× stale), caching contracts, per-harness preamble sizes, residency model, the guide priced by formula, literature on agent cost |
| `07-research-resolution-levers.md` | 2025–2026 literature: localisation is a cost bottleneck, verification levers, context-file studies, index-selected tests (L1) |
| `08-sol-ideation.md` | 22 ideation claims from the Sol model; answered in section 5.4 |
| `09-synthesis-draft.md` | the draft this report revises |
| `10-panel-cost.md` | cost-lane review: independent re-pricing of 1,311 rollouts, the cap replay at 3.99 bytes per token, the delegation-subset correction, the spend re-sum |
| `10-panel-gutter.md` | gutter-lane review: the silent carry on codex and opencode, the symmetric ambiguity measure, the model-gated read gate, renderer constraints for the designs |
| `10-panel-resolution.md` | lever-lane review: the preamble-trim gate, power analysis, controls, harness versions, golden rebuild, operation-level call count |
| `10-panel-sol.md` | adversarial review by the Sol model: wasted-call bound, cost-basis coherence, omitted levers |
| `11-final-summary.md` | plain-language summary for the owner |
| `prompts/sol-ideation.md`, `prompts/sol-review.md` | the prompts given to the Sol model |

**Data**

| file | what it holds |
|---|---|
| `data/blocks.ndjson.gz` | every fenced `ss-*` block delivered in epoch C, keyed `harness|form|arm|task|rep`, with residency weight (7,515 blocks) |
| `data/blocks-tok.ndjson` | the same blocks with `o200k_base` counts in four renderings |
| `data/rollouts.ndjson.gz` | per-rollout cost and behaviour counters, dearest-3 convention (792 rows) |
| `data/rollouts-repsel.ndjson.gz` | the same under the rep-slug convention |

**Scripts** (local copies; box copies under `/tmp/fp-inv/<tag>/`)

| script | what it does |
|---|---|
| `e1_common.py` | run map, repair substitution, per-harness parsing, edit detection, failure classes, gutter regexes |
| `e1-census.py` | edit census, carry detection, retry linkage → `logs/census.log`, `census.json` |
| `e1-surfaces.py` | read surfaces, bytes per call, re-reads, codex truncation → `logs/surfaces.log`, `surfaces.json` |
| `e1-residue.py` | gutter residue over every edit payload; indentation split → `logs/residue.log`, `residue.json` |
| `e1-extras.py` | delimiter price from identical commands; repo indentation; never-shown anchors → `logs/extras.log`, `extras.json` |
| `e2-harvest.mjs` | re-prices 1,311 rollouts per turn from their own transcripts |
| `e2-headline.mjs` | cell table and sweet-versus-native on every cost column → `logs/e2-headline.txt` |
| `e2-paired.mjs` | per-task paired deltas, bootstrap, leave-one-out → `logs/e2-paired.txt` |
| `e2-hypo.mjs` | the twelve cost hypotheses H1–H12 → `logs/e2-hypo.txt` |
| `e2-drivers.mjs` | Shapley split of the delta; the −15% lever sizing → `logs/e2-drivers.txt` |
| `e2-census.mjs` | tool-family bytes per call and the gutter census |
| `e2-convention.mjs` | reproduces the published dearest-3 claude reconstruction → `logs/e2-convention.txt` |
| `e2-counterfactual.mjs` | the epoch-A cap replay (its byte-rate choice is retired) |
| `e2-firstturn.mjs` | preamble against issue split → `logs/e2-firstturn.txt` |
| `e2-degen.mjs` | degeneration re-runs and discarded spend → `logs/e2-degen.txt` |
| `e2-extras.mjs`, `e2-latency.mjs`, `e2-cells.mjs`, `e2-package.mjs`, `e2-cap.mjs`, `e2-tok.mjs`, `e2-trunc.mjs` | helpers: extra sessions, `ss-*` latency, cell map, JSON packaging, cap bracket, token counts, truncation shape → `logs/e2-extras.txt`, `logs/e2-latency.txt` |
| `e3-extract.mjs` | re-prices every rollout and extracts every fenced `ss-*` block with residency weights (box) |
| `e3-validate.mjs` | reconstruction against `rows.json`; transcripts-per-cell histogram |
| `e3-ocpipe-recon.mjs` | isolates the one cell behind the opencode PIPE discrepancy |
| `e3-editfail.mjs` | prints the bytes of every sweet-arm edit failure |
| `e3-sample.mjs` | one `ss-read` / `ss-search` result per harness × form, as delivered |
| `e3-tokenise.py` | `o200k_base` counts of each block in four renderings → `data/blocks-tok.ndjson` |
| `e3-analyse.py` | sections A–I of `03` → `logs/e3-analysis.txt`, `logs/e3-inout.txt`, `logs/e3-repindex.txt` |
| `e3-budget.py` | the mechanistic budget, delegation split, counterfactual → `logs/e3-budget.txt` |
| `e3-pertask.py` | per-task pairing and gap concentration → `logs/e3-pertask.txt` |
| `e3-exhibits.py` | one window in three forms; header exhibit; threshold census; integrity check → `logs/e3-exhibits.txt` |
| `e3-appendjson.py` | folds the exhibits into `03-gutter-form-cost.json` |
| `e4-codex-solve-matrix.py` | codex solve matrix and null assertion → `logs/e4-codex/solve-matrix.json` |
| `e4-codex-parse.py`, `e4-codex-storyline.py` | codex trace normaliser and per-rollout storyline |
| `e4-codex-taskcard.py`, `e4-codex-cellcard.py` | task spec, gold, per-cell patch and grader lines |
| `e4-codex-toolhealth.py`, `-toolhealth2.py`, `-toolhealth3.py` | tool-health census (v3 quoted) → `logs/e4-codex/toolhealth3.json` |
| `e4-codex-grepmiss.py`, `e4-codex-grepmiss2.py` | unscoped and scoped falsifier for zero-match `ss-grep` → `logs/e4-codex/grepmiss2.json` |
| `e4-codex-stale.py` | zero results for text the agent itself added → `logs/e4-codex/stale.json` |
| `e4-codex-indexcoverage.py`, `e4-codex-indexgap.py` | searched-versus-read file sets; indexed-versus-on-disk per golden → `logs/e4-codex/indexcov.json`, `indexgap.json` |
| `e4-codex-editcensus.py` | `apply_patch` calls, failures, anchor shape → `logs/e4-codex/editcensus.json` |
| `e4-codex-misplace.py` | stated `file:line` against produced hunk ranges → `logs/e4-codex/misplace.json` |
| `e4-codex-goldreach.py` | gold file named / shown / patched per arm → `logs/e4-codex/goldreach.json` |
| `e4-codex-build-json.py` | assembles `04-resolution-codex.json` |
| `e4-opencode-lib.py` | rollout index and NDJSON normaliser with repair rows substituted |
| `e4-opencode-solve-matrix.py`, `e4-opencode-ungraded.py` | solve matrix, completeness, the ungraded row |
| `e4-opencode-census.py`, `e4-opencode-toolhealth.py`, `e4-opencode-defects.py` | tool census, per-tool exits and latency, failure buckets → `logs/e4-toolhealth.json`, `logs/e4-defects.json` |
| `e4-opencode-grepcrash.py`, `e4-opencode-grepdialect.py`, `e4-opencode-banner.py` | engine crashes, BRE alternation, banner leak → `logs/e4-grepcrash.json` |
| `e4-opencode-ambiguity.py`, `e4-opencode-gutterresidue.py`, `e4-opencode-editanchors.py` | anchor ambiguity 41 of 295, residue and carry census, anchor extraction |
| `e4-opencode-b2dialect.py`, `e4-opencode-extgap.py` | `.jam` against `.py` in results; index blind-spot scan → `logs/e4-extgap.json` |
| `e4-opencode-fallback.py`, `e4-opencode-cellmap.py`, `e4-opencode-f2ptail.py`, `e4-opencode-exposure.py` | native-tool fallback, per-cell map, test-tail read, exposure → `logs/e4-cellmap.json`, `logs/e4-matrix-compact.json` |
| `e4-opencode-bundle.py`, `e4-opencode-digest.py`, `e4-opencode-storyline.py`, `e4-opencode-assemble.py` | bundling, digest, storyline, JSON assembly |
| `e4-claude-code-solve-matrix.mjs` | solve matrix with the null assertion → `logs/e4-claude-code-solve-matrix.json` |
| `e4-claude-code-parse.mjs`, `e4-claude-code-taskspec.mjs`, `e4-claude-code-cellcard.mjs` | transcript parser with block-level dedupe, task spec, per-cell card |
| `e4-claude-code-localisation.mjs`, `e4-claude-code-goldcoverage.mjs` | gold file surfaced / read / edited per cell → `logs/e4-claude-code-loc.json` |
| `e4-claude-code-indexgap.mjs`, `e4-claude-code-jamcheck.mjs`, `e4-claude-code-silentblind.mjs` | extension histogram of results, `.jam` reach, scoped empty results on read files |
| `e4-claude-code-anchors.mjs`, `e4-claude-code-anchorbytes.mjs`, `e4-claude-code-tabexposure.mjs` | anchor failures with indent deltas, bytes, tab-indented exposure → `logs/e4-claude-code-anchors.json`, `-tabexp.json` |
| `e4-claude-code-toolhealth.mjs`, `e4-claude-code-toolhealth2.mjs` | tool-health census → `logs/e4-claude-code-toolhealth.json`, `-toolhealth2.json` |
| `e4-claude-code-stopcensus.mjs`, `e4-claude-code-effort.mjs` | last-message census, effort profile → `logs/e4-claude-code-stopcensus.json` |
| `r1-gutter-tokens.py`, `r1-token-transparency.py`, `r1-gutter-price.py` | tokeniser micro-study over five golden files; transparency and space-run ambiguity; the (retired) 0.75–1.56% price → `logs/r1-tokens.txt`, `r1-tokens.json`, `r1-transparency.txt`, `r1-price.txt` |
| `r2-cost-decompose.mjs`, `r2-cache-hit.mjs`, `r2-turn1-preamble.mjs`, `r2-preamble-sizes.mjs` | INGEST / re-send / OUTPUT shares; cache hit and write volume; first-request sizes and the guide delta |
| `r2-context-shrink.mjs`, `r2-reasoning-residency.mjs`, `r2-turn-profile-and-subagents.mjs` | compaction detector (never fired); prior output re-entering the prefix; cost by turn position and sidechains |
| `r2-token-count-guide.py`, `r2-verify-arithmetic.py`, `r2-codex-binary-probe.sh` | guide token count; arithmetic checks; binary-string probe template |
| `synth-cc-readgate.mjs` | claude-code `Edit` precondition against the sweet arm → `logs/synth-readgate.txt` |
| `synth-oc-parallel.py` | opencode tool calls per request → `logs/synth-ocparallel.txt` |
| `synth-cc-wasted.mjs`, `synth-oc-wasted.py`, `synth-codex-wasted.mjs` | price of the request after a failed `ss-*` call → `logs/synth-ccwasted.txt`, `synth-ocwasted.txt`, `synth-codexwasted.txt` |
| `synth-statesum.mjs`, `synth-statesum2.mjs` | `<state_summary>` volume and standalone requests → `logs/synth-statesum.txt`, `synth-statesum2.txt` |
| `p1-harvest.mjs` | independent re-pricing of 1,311 rollouts from their transcripts |
| `p1-analyse.mjs` | validation against `rows.json`, cell table, component split, paired deltas, first-turn delta, output, delegation, spend → `logs/p1-analyse.txt` |
| `p1-conventions.mjs` | the three claude-code conventions, delegation subsets, medians, spend → `logs/p1-conventions.txt` |
| `p1-stats.mjs` | bootstrap intervals, sign tests, cache write, cross-harness ratios, calls per request, cap census → `logs/p1-stats.txt` |
| `p1-codexcap.mjs`, `p1-capreplay.mjs` | cap census from codex's own token counts; bytes per token; the epoch-A replay → `logs/p1-codexcap.txt`, `p1-capreplay.txt` |
| `p1-gutter.py` | independent re-tokenisation of every delivered block → `logs/p1-gutter.txt`, `p1-payload.txt` |
| `p1-rep.mjs`, `p1-artefacts.mjs` | rep-index spread, solve counts, concurrency, repair substitution, `degenReran` → `logs/p1-rep.txt`, `p1-artefacts.txt` |
| `p2-casebytes.py`, `p2-casebytes2.py` | the 20 claude-code carry cases re-read byte by byte → `logs/p2-carrycases.txt` |
| `p2-silentcarry.py`, `p2-carryroll.py`, `p2-carryproof.py` | the codex and opencode carry census, rollout counts, one case with outcome → `logs/p2-silentcarry.txt`, `p2-carryroll.txt`, `p2-carryproof.txt` |
| `p2-cxoc.py`, `p2-ocerr.py` | codex and opencode edit census rebuilt; opencode `state.error` bodies → `logs/p2-cxoc.txt` |
| `p2-tok.py`, `p2-transparency.py`, `p2-ambiguity2.py` | tokeniser re-derivation; transparency; the symmetric ambiguity measure → `logs/p2-tok.txt`, `p2-transparency.txt`, `p2-ambiguity.txt` |
| `p2-strip.py`, `p2-colon.py`, `p2-cap.py` | strip hazard over the goldens; `N:` / `N|` collisions; cap bracket on epoch C → `logs/p2-cap.txt` |
| `p3-power.py` | task-bootstrap null spread and parametric power of the 6-rollout bar → `logs/p3-power.txt` |
| `p3-ops-per-envelope.mjs` | opencode operations against envelopes per request → `logs/p3-ops-per-envelope.txt` |
| `final-boxcheck.sh` | this pass: read-gate code, separator gate, `rows.json` keys and re-run counts, pool and controls, golden dates, the codex carry bytes, harness versions → `logs/final-boxcheck.txt`, `logs/final-gatecheck.txt` |

**Logs not named above**

| file | what it holds |
|---|---|
| `logs/sol-ideation.log`, `logs/sol-ideation-openrouter.log` | the Sol ideation session (codex subscription token expired; OpenRouter fallback) |
| `logs/sol-review.log` | the Sol adversarial review session |
| `logs/e4-codex/` | the nine JSON artefacts of the codex forensics listed above |
