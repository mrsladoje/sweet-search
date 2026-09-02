# Synthesis — harness, gutter and cost on the fresh pool (draft, 2026-08-28)

**Inputs.** The eight evidence and research files of this directory (`01`–`08`), `FRESH-POOL-RESULTS.md`,
`GUTTER-MECHANISM-INVESTIGATION.md`, `GUTTER-AB-RESULTS.md`, `REBASELINE-RESULTS.md`, and the discard logs
(`SLATE-A-UBER.md` §9, `SLATE-B-UBER.md` §8). Sol's ideation (`08`) completed after the task list was written;
it holds 22 numbered claims and is answered in §5.4.

**New measurements in this pass.** Six read-only scripts ran on the box from `/tmp/fp-inv/synth/`; local copies
are `scripts/synth-*.{mjs,py}`, full output in `logs/synth-*.txt`. They (1) test claude-code's Read-before-Edit
precondition against the sweet arm, (2) count tool calls per request on opencode, (3) price every request that
follows a wasted `ss-*` call on all three harnesses, (4) measure the `<state_summary>` block, (5) verify the
degeneration re-run counts behind the claude-code cost dispute, and (6) re-sum the run's spend. The harness
pricing code was read to settle the cache-write disagreement.

**Tags.** [M] measured (script and numbers named) · [C] read from source, a binary or a contract ·
[I] inferred · [W] web source. "The guide" is the M± tool guide, the ~1,457-token text appended to
`AGENTS.md`/`CLAUDE.md` in the sweet arm. "TAB / NONE / PIPE" are the `ss-read` gutter forms `N<TAB>`, no
gutter, `N| `. "Epoch A/B/C" are the 2026-08-11, 2026-08-24/25 and 2026-08-26/27 runs.

---

## 0. Verdict

**Keep `N<TAB>` on all three harnesses, do not spend on the gutter again, and spend the next run on the guide.**

1. **The delimiter is a 2–4% cost term and a claude-code-only edit mechanism that costs calls, never solves.**
   [M] The tab gutter is `$0.00030`–`$0.00044` per rollout (2.1–3.7%) on every harness (`03`). On claude-code
   it carries into 8 of 61 edits in tab-indented files, the pipe carries into 6 of 144 in space-indented files,
   and native's own `Read` has the same tab carry (`01`). Twenty carries cost `$0.033` and changed 0 solves.
   Codex and opencode have no mechanism at all: 0 whitespace failures, 0 residue in 7,796 anchor lines (`01`).
2. **Sweet stopped being cheaper for three different reasons, and none is a sweet regression.** [M] Codex's
   harness began capping tool output at ~2,500 tokens between epoch A and B; that deletes 40% of native's tool
   payload and 15% of sweet's, worth about 16% of a native rollout, and replaying epoch A under the cap moves
   codex from −6.5% to +11.5% (`02`). Opencode's native tools run 1.55 calls per request against sweet's 1.11
   (25% of native steps carry 2–4 parallel `read`/`grep`/`glob` calls); the harder pool raised sweet's serial
   call count from 17.0 to 21.8 and that is the +3.4 turns, +10.2% (`02`, `synth-oc-parallel`). Claude-code
   never flipped: priced on the graded transcript it is −8.8%, and the win is delegation suppression (`02`).
3. **Three sweet-only cost terms of the same size sit on every harness.** [M] The guide (1,457 tokens on every
   request: 3.5% / 4.6% / 2.5% of the sweet arm), the gutter (2.45% / 3.65% / 2.12%), and requests spent
   reacting to `ss-*` errors — crashes, usage rejections, `ENOENT`, scoped empty results on files already read
   (2.4% / 2.2% / 2.3%, `synth-*-wasted`). Together 7–10% of the sweet arm, larger than any observed gap.
   Only the third has zero behavioural risk.
4. **Resolution is at parity within 3 rollouts per cell, and one sweet defect decides rollouts.** [M] The index
   cannot see `.jam` files (321 in `bfgroup/b2`, 0 indexed) and excludes every `src/build/` path; on the two
   Boost.Build tasks the gold file was invisible to every `ss-*` retrieval surface in at least 26 of 27 sweet rollouts
   across the harnesses (the 27th saw two unnamed `.jam` paths), and native solved 1 of 3 on each (`04` ×3). Everything else is an arm-universal wrong fix.
5. **The next paid run is a guide-shrink A/B**, three harnesses × 22 tasks × 3 reps × (native, sweet full guide,
   sweet minimal guide), with the `$0`-falsified hygiene fixes shipped in both sweet arms. About `$8.5` at the
   registered price, `$17` at today's listed price (§6).

---

## 1. How each harness reads and edits

**Conclusion.** The read surface is harness-specific, the edit surface is harness-specific, and only claude-code
consumes whitespace exactly. That is why only claude-code has a delimiter mechanism.

| harness | read surface, native arm → sweet arm (calls per rollout, bytes per call) | edit tool | context matching | rollouts with ≥1 failed edit / 66: native · TAB · NONE · PIPE | retries: failed → retried → retry OK | delimiter mechanism |
|---|---|---|---|---|---|---|
| **codex 0.146.1** | none of its own: `sed -n` 3.05, `rg` 2.68, `cat` 1.41, `nl` 0.65 (8.1–8.6 kB per read) → `ss-read` 4.4 calls, 8.2 invocations, 6.1 kB; every read over ~2,500 tokens is cut middle-out [M `01` §3] | `exec_command` heredoc `apply_patch <<'PATCH'`, 480 of 480 edit calls [M] | 4-pass seek (exact → trim_end → trim → unicode) from a forward-only moving line index; 952 of 952 hunks carry a bare `@@` [C][M `04-codex`] | 7 · 5 · 2 · 4 | native 9→9→8 · TAB 8→10→7 · NONE 4→4→4 · PIPE 4→4→4 [M `01` §1.5] | **none**: 0 whitespace failures in 28 failed-anchor records, 0 residue in 3,911 anchor lines [M] |
| **opencode 1.18.4** | `read` renders `N: `, 9.03 calls at 4.4 kB, plus `glob` 2.11, `grep` 3.64 → `ss-read` 5.7 calls at 5.0 kB, native `read` 0.27 [M] | `apply_patch(patchText)`, 467 of 467; the nine-replacer fuzzy `edit` tool was called 0 times [M] | same 4-pass seek, TypeScript port; 869 of 869 bare `@@` [C][M `04-opencode`] | 3 · **0** · 6 · 4 | native 3→3→3 · TAB 0 · NONE 7→7→6 · PIPE 4→4→4 | **none**: 0 whitespace, 0 residue in 3,885 lines; opencode's own `N: ` read carried nothing either [M] |
| **claude-code 2.1.218** | `Read` renders `N<TAB>`, 19.4 calls per rollout (10.45 main thread + 8.94 inside subagents) at 3.1 kB → `ss-read` 4.6 calls, 6.3 invocations, 5.3 kB; native `Read` 0.8 on the main thread (2.03 with subagents) [M `01`, `synth-cc-readgate`, `synth-cc-wasted`] | `Edit(old_string)` 1,019 of 1,055 (96.6%), `Write` 20, `python` rewrite 15 [M] | exact substring, must be unique; the only tolerance is `\uXXXX` escape swapping; no whitespace normalisation [C] | 18 · 19 · 15 · 16 (`01`; `04` counts `Edit` only: 17 · 17 · 15 · 15) | native 54→54→30 · TAB 47→39→17 · NONE 40→31→20 · PIPE 26→22→15 | **yes**: the delimiter character is carried into the anchor — see below |

**The claude-code mechanism, with bytes.** [M `01` §2.3] In a tab-indented file the model strips the digits and
keeps the gutter tab: shown `245\t\t\t\tthis.RenderExpression = …`, anchor `\t\t\t\tthis.RenderExpression…`
(4 tabs), on disk 3 tabs. Under PIPE in a space-indented file it keeps the delimiter's space: shown
`135|       clearIcon,`, anchor 7 spaces, on disk 6. Carries split exactly by the file's own indent character:
TAB 8/61 in tab-indented repos vs PIPE 0/62 (`p = 0.0029`); PIPE 6/144 in space-indented repos vs TAB 0/195
(`p = 0.0055`); NONE 0/269; native `Read` 6/79 in tab-indented repos. The tokeniser explains it [M `05` §3.3]:
every space-terminated gutter fuses its space into the file's own indentation token, one space longer, on 64%
of lines; the tab fuses too but the token begins with a character the file's indentation cannot contain, so
the boundary is marked. Exposure is 3 of 22 tasks for the tab carry and 19 of 22 for the pipe carry [M].

**What the mechanism is worth.** [M] 20 carries, `$0.0327` whole-episode or `$0.0126` one-extra-request, across
three cells; 0 solves changed (`moq-1262` is 0/3 in every claude-code condition; `registry-961` is 3/3).
Rollouts-with-failure is flat: claude 18/19/15/16 (`p = 0.69` TAB vs PIPE). The six-task figure that adopted the
tab (1.6% vs 7.6% of edits, `GUTTER-AB-RESULTS.md`) reverses at 66 rollouts per cell — TAB 16.5–18.4%, NONE
14.8–15.4%, PIPE 12.4–12.6%, native 16.7–17.2% [M `01`, `03`, `04-claude-code`]; the reversal is three transcripts
of one task at n = 18.

**A harness precondition that turned out not to bind.** [C][M `synth-cc-readgate`] The deployed claude-code
binary carries `File has not been read yet. Read it first before writing to it.` If that gate applied to `Edit`,
every sweet edit would force one native `Read` per file. It does not: 218 of 259 sweet TAB edits (84%) had no
prior native `Read` of the file, 205 of them only an `ss-read`, and 0 gate errors fired in 1,044 edit calls
across 264 rollouts. The 0.8 native `Read` calls per sweet rollout are the model's choice (77% of them on a file
it later edits), not the harness's.

**Edit failure is a claude-code cost line and nothing else.** [M `01` §1.5] Retries cost 4–11% of a claude-code
cell on the one-extra-request bound and under 1.6% of a codex or opencode cell. On claude-code only 17 of 39
TAB retries succeed; codex and opencode retry successfully 36 of 41 times, because their seek trims whitespace.

---

## 2. Why sweet is no longer cheaper on codex and opencode, and why claude-code "flipped"

**Conclusion.** Every cell was re-priced from its own transcript and ties to the harness (codex and opencode ideal
to `$0.000001` on 901 rows; claude-code main-only to `$0.000000` on 342 rows) [M `02` §1]. The three
harnesses moved for three different reasons; the sweet-side terms are constant across epochs.

### 2.1 The cost model, with each harness's numbers

`cost = 0.10·INGEST + 0.01·Σ PREFIX + 0.60·OUTPUT` per million tokens, where INGEST is every token counted once
when first sent, Σ PREFIX is everything re-sent, and OUTPUT includes reasoning [C `ideal-cost.mjs:83`]. It equals
the break-priced column on every one of the 792 epoch-C rollouts, because no arm rewrote context
(`contextRewrites = 0`) [M `03` §6]. Cache hit is 99.3–100.0% and no rollout compacted (largest context 100,624
of 1,050,000 tokens) [M `06` §0].

| harness / arm | `$`/rollout | INGEST tok · `$` · share | Σ PREFIX tok · `$` · share | OUTPUT tok · `$` · share | re-sends per ingested token R | effective price of an ingested token | sidechain `$` | realized surcharge `$` |
|---|---:|---|---|---|---:|---:|---:|---:|
| codex sweet TAB | 0.012330 | 34,541 · 0.003454 · 28.2% | 548,952 · 0.005490 · 44.8% | 5,524 · 0.003315 · 27.0% | 15.9 | `$0.259`/M | — | 0.000072 |
| codex native | 0.012287 | 35,942 · 0.003594 · 29.4% | 515,269 · 0.005153 · 42.2% | 5,786 · 0.003472 · 28.4% | 14.3 | `$0.243`/M | — | 0.000069 |
| opencode sweet TAB | 0.009265 | 28,316 · 0.002832 · 30.6% | 424,150 · 0.004242 · 45.8% | 3,645 · 0.002187 · 23.6% | 15.1 | `$0.251`/M | — | 0.000005 |
| opencode native | 0.008969 | 30,359 · 0.003036 · 33.9% | 376,466 · 0.003765 · 42.0% | 3,606 · 0.002164 · 24.1% | 12.4 | `$0.224`/M | — | 0.000005 |
| claude-code sweet TAB | 0.019125 | 38,550 · 0.003855 · 22.0% | 773,500 · 0.007735 · 44.1% | 5,248 · 0.003149 · 17.9% | 20.1 | `$0.301`/M | 0.002811 | 0.001575 |
| claude-code native | 0.020972 | 36,560 · 0.003656 · 18.5% | 782,400 · 0.007824 · 39.6% | 6,415 · 0.003849 · 19.5% | 21.4 | `$0.314`/M | 0.004429 | 0.001213 |

[M `02` §2.1; `06` §7.2 for codex and opencode tokens; claude-code tokens are derived from `02`'s row-matched
dollars because `06` priced the three-dearest transcripts, which carry 46% more sweet output]. Residency is the largest term everywhere (40–46%). A token put into context costs
2.2–3.1× its sticker price, and break-even against ingest is exactly 10 remaining requests, which every cell
passes [M `06` §7.3]. Output is under 1% of tokens and 18–28% of the bill.

**The surcharge column is asymmetric by construction, and that is a measurement fact, not a provider fact.**
[C] `costFromTurns` multiplies `cacheWrite` by 1.25 (`ideal-cost.mjs:94`), but only the claude-code accounting
passes a `cacheWrite` field (`claude-code-accounting.mjs:103`); the opencode runner folds `cache.write` into `in`
with no such field (`opencode-task-runner.mjs:160`) and codex's `turnsFromRollout` emits none. OpenRouter states
GPT-5.6 and later bill cache writes at 1.25× "even with automatic caching" [W `06` §2.3]. So the codex and
opencode realized columns are lower bounds by roughly the 7.6% opencode's own `cache.write` volume implies
(27,909 tokens per rollout) [M `06` §4.4]. The shortfall is uniform across arms, so no A/B moves; the
cross-harness comparison must be read on the ideal column (§2.3).

### 2.2 Ranked drivers of the sweet − native delta, per harness

The paired delta over 22 tasks splits additively into turns, guide, other context, and output (`02` §3); I add the
measured gutter and wasted-call terms, which are part of "other context" and "turns" respectively, so the rows
below are a classification, not a second sum. Class: **A** measurement artefact · **H** harness version or
contract · **P** pool composition · **S** sweet product.

**Codex** — native `$0.012287`, sweet TAB `$0.012330`, **+0.3%**, bootstrap CI over tasks [−11.1%, +13.1%];
sweet is cheaper on 14 of 22 tasks and the median Δ is −`$0.00111` [M `02` §5].

| rank | `$`/rollout | % of native | driver | class | evidence |
|---|---:|---:|---|---|---|
| 1 | ≈ −0.0020 to native | ≈ 16% of native | codex's delivered-output ceiling fell to 10,214 B (~2,500 tokens) between epoch A and B; it deletes ~10,505 of native's 26,302 tool tokens per rollout (40%) and ~2,357 of sweet's 15,558 (15%). Replaying epoch A under the cap: −6.5% → **+11.5%** (CI [+1.7%, +22.2%]), more than the +6.8 points observed | **H** | [M `02` §3.1]; the cap is the unified-exec truncation policy, config key unset [C `05` §1.3] |
| 2 | +0.000426 | +3.5% | the guide, 1,457 tokens on every request | **S** | [M `02` §4]; constant on 132 codex rollouts |
| 3 | +0.000386 | +3.1% | +0.76 turns; concentrated on `b2-113` (+12.0 turns) and `b2-259` (+11.3), where sweet grinds against an index that holds no `.jam` and no `src/build/` | **S**, pool-sensitive | [M `02` §5, `04-codex` §2.4]; dropping `b2-113` alone gives −3.3% |
| 4 | +0.000302 | +2.45% | the tab gutter itself (1,163 tokens, two thirds of it rent) | **S** | [M `03` §2.1] |
| 5 | +0.000294 | +2.4% | requests spent reacting to a wasted `ss-*` call: 8 crashes, 1 usage rejection, 14 `ENOENT`, 6 scoped empty results on already-read files; 0.44 per rollout, 17 of 66 rollouts | **S** | [M `synth-codex-wasted`; cell ties to `$0.012330`] |
| 6 | −0.000603 | −4.9% | retrieval payload other than the guide — what `ss-*` still saves | **S** credit | [M `02` §8.1] |
| 7 | −0.000157 | −1.3% | output and reasoning tokens (sweet emits 5,524 vs 5,786) | **S** credit | [M `02` H4] |
| — | 0 | — | artefacts: none material; rows tie to `$0.000001`; price vector is 2× stale with ratios intact [W]; the unrecorded cache-write surcharge is uniform | **A** | [M `02` §1, `06` §1] |

**Opencode** — native `$0.008968`, sweet TAB `$0.009265`, **+3.3%**, CI [−8.3%, +16.1%]; cheaper on 13 of 22
tasks, median −`$0.000208` [M].

| rank | `$`/rollout | % | driver | class | evidence |
|---|---:|---:|---|---|---|
| 1 | +0.000914 | +10.2% | **+3.38 turns.** Mechanism: native issues 1.546 tool calls per request — 25.2% of its steps carry 2–4 parallel `read`/`grep`/`glob` calls and 55.6% of its calls sit in such steps — while sweet issues 1.106 (8.1% of steps, 21.5% of calls). The ratio was the same in epoch A (1.50 vs 1.15); the harder pool raised sweet's call count 17.0 → 21.8 and every added call was a request | **H** contract × **P** | [M `synth-oc-parallel`, `02` §2.2, §3.2] |
| 2 | +0.000408 | +4.6% | the guide (opencode's preamble is the smallest, so the same 1,457 tokens weigh most) | **S** | [M `02` §4] |
| 3 | +0.000338 | +3.65% | the tab gutter | **S** | [M `03`] |
| 4 | +0.000204 | +2.2% | wasted `ss-*` calls: 6 usage rejections, 7 empty bodies, 12 `ENOENT`, 3 scoped empty results, 3 crashes; 0.47 per rollout | **S** | [M `synth-oc-wasted`; cell ties to `$0.009265`] |
| 5 | +0.000374 | +3.0% of the mean Δ | `b2-259` alone; without it +3.3% → −0.1% | **S**, pool-sensitive | [M `02` §5] |
| 6 | −0.001074 | −12.0% | retrieval payload — sweet's largest credit on any harness | **S** credit | [M `02` §8.1] |
| — | ≈ 0 | — | artefacts: the `opencode --version` preflight race deleted 18 sweet rollouts at concurrency 2, repaired at concurrency 1 (0 lost of 99; concurrency itself is a 0.3% effect); one PIPE row (`b2-259` rep 2) carries `resolved=false` with null test results and was never graded | **A** | [M `FRESH-POOL` §6, `02` H6, `04-opencode` §1.1] |

**Claude-code** — three numbers exist and each is right about a different thing [M `02` §9.1]: **−3.9%**
(published; the "three dearest transcripts" rule, which substitutes 13 discarded degeneration re-runs — 11 of
them sweet — for the graded attempt), **−8.8%** (`$0.019125` vs `$0.020972`; the transcript the harness graded,
ties to `costRealizedMainOnlyUsd` on 342 of 342 rows), **+1.9%** (every dollar actually spent, because sweet
triggered 11 of the 13 re-runs). I verified the re-run counts in `rows.json`: `degenReran` sweet 5 / 4 / 2 for
TAB / NONE / PIPE, native 1, codex and opencode 0 [M]. CI over tasks [−39.4%, +24.8%]; cheaper on 13 of 22.

| rank | `$`/rollout | % of native | driver | class | evidence |
|---|---:|---:|---|---|---|
| A1 | 127-point swing | — | 28 of 66 native rows carry null inclusive cost (incomplete subagent transcripts); summed as `$0` the ledger reads **+123.2%** | **A** | [M `FRESH-POOL` §2] |
| A2 | 4.9 points | — | transcript-selection convention, above | **A** | [M `02` §9.1] |
| A3 | lower bound | — | 205 native delegated requests carry no usage at all (165/74/106 on the sweet forms); true native cost is higher | **A** | [M `02` §9.2] |
| 1 | −0.001619 | −7.7% | **delegation suppression**: delegating rollouts sweet/native 3/11 (A), 0/20 (B), 9/28 (C); task-cells 6 vs 15 in C. On the 18 tasks where neither arm delegated, main-only is **+6.8%** (CI [−9.7%, +29.4%]) | **S** | [M `02` §3.3] |
| 2 | −0.000700 | −3.3% | output and reasoning (5,248 vs 6,415 tokens) | **S** credit | [M `02` H4] |
| 3 | +0.000530 | +2.5% | the guide plus its `.claude/rules` wrapper, 1,570 tokens | **S** | [M `02` §4] |
| 4 | +0.000440 | +2.1% | the tab gutter | **S** | [M `03`] |
| 5 | +0.000370 | +2.3% | wasted `ss-*` calls: 12 crashes, 12 usage rejections, 8 `ENOENT`, 12 scoped empty results; 0.67 per rollout, 21 of 66 rollouts; PIPE 0.91 per rollout, 5.6% | **S** | [M `synth-cc-wasted`] |
| 6 | −0.000335 | −1.6% | −1.14 turns | **S** credit | [M `02`] |
| 7 | +0.000109 | +0.5% | retrieval payload — on claude-code retrieval saves nothing net | **S** | [M `02` §8.1] |
| 8 | +0.001144 of the cross-harness gap | — | the 1.25× cache-write surcharge is charged on claude-code only (§2.1) | **A** | [C] |

### 2.3 The cross-harness absolute gap

Claude-code costs 1.71× codex and codex 1.37× opencode on the realized column (`$0.020972 / 0.012287 / 0.008969`
native) [M `02` §7]. The `$0.008685` claude−codex gap decomposes exactly: subagents `+$0.004429`, fixed preamble
`+$0.001898` (measured 17,273 vs 13,959 vs 6,498 tokens, additive-model residual 4 tokens), the asymmetric
cache-write surcharge `+$0.001144`, other context `+$0.000836`, output `+$0.000377`. On the ideal column, which
charges no surcharge anywhere, claude-code is 1.62× codex. Opencode is cheap because its tool schemas and system
prompt are 47% of codex's and 38% of claude-code's; it buys that with more calls (25.2 vs 17.8), which cost
little because they are packed into fewer requests — the same mechanism that punishes sweet there (§2.2).

### 2.4 Two standing readings that the numbers do not support

- **"Native narrows its own reads on harder tasks" (`FRESH-POOL` §4) is wrong on codex.** [M `02` H2] Native's
  bytes per read fell 46% (13,661 → 7,345) because the harness cap cut them; its read count doubled and its total
  read payload rose 9%. The "adaptive output budgeting" lever inherits that misreading; the true codex story is
  the cap, and the true opencode story is requests, not bytes.
- **"13–28% fewer tool calls" is true and does not pay.** [M] Calls: opencode 21.8 vs 25.2 (−13%), claude-code
  29.9 vs 41.8 (−28%). Requests: opencode 19.7 vs 16.3 (**+21%**), claude-code 23.2 vs 24.3 (−4.5%). Cost
  follows requests. The honest efficiency claim is "fewer calls, not fewer requests", and on opencode it costs
  money.

---

## 3. Why the gutter forms differ in price per harness

**Conclusion.** [M `03` §7] The delimiter's own tokens are the same size on every harness; what differs is
behaviour and, on claude-code, delegation. Every dollar of every form-to-form gap, assigned (`direct` = the TAB
cell's own delivered blocks re-tokenised with the other delimiter, behaviour held fixed; `delegation` = the
sidechain bill; `behaviour` = the remainder):

| harness | pair | observed `$` | direct gutter tokens `$` | delegation `$` | behaviour `$` | 95% CI on observed | direct inside CI |
|---|---|---:|---:|---:|---:|---|---|
| codex | TAB→NONE | −0.000011 | −0.000302 | 0 | +0.000291 (NONE delivered 27 more code lines) | [−0.000964, +0.001172] | yes |
| codex | TAB→PIPE | +0.000424 | **+0.000217** (72% of the input-side +0.000302) | 0 | +0.000207 (0.2 turns, 204 output tokens) | [−0.000600, +0.001447] | yes |
| opencode | TAB→NONE | −0.000681 | −0.000338 | 0 | −0.000343 (6.0 vs 6.6 `ss-read`, 926 vs 948 lines, 18.9 vs 19.7 turns) | [−0.001512, +0.000050] | yes |
| opencode | TAB→PIPE | −0.000501 | +0.000248 | 0 | −0.000749 (fewest reads of any cell: 5.5 `ss-read`, 3.9 files) | [−0.001320, +0.000238] | no, by `$0.00001` |
| claude-code | TAB→NONE | −0.001304 | −0.000440 | −0.000954 | +0.000091 | [−0.005690, +0.003184] | yes |
| claude-code | TAB→PIPE | −0.002966 | **+0.000328** | −0.001045 | −0.002248 (1,660 fewer output tokens, −22%) | [−0.008137, +0.001151] | yes |

Per-line cost measured on the delivered blocks: `N<TAB>` +1.34 tokens, `N| ` +2.27, difference 0.93 on all three
harnesses [M `03` §2.2]. Two thirds of the gutter's cost is rent (61–67% resident re-sends), because a delivered
token stays for 15–20 further requests [M].

**Reading it per harness.** Codex: the delimiter, cleanly — half of PIPE's +3.4% is its own bytes. Opencode:
half token, half fewer reads for NONE; PIPE's saving is an unlucky draw (its direct term falls outside the
interval by one hundredth of a cent). Claude-code: the published −14.3% for PIPE is delegation plus verbosity
with the delimiter pointing the other way — on the 12 tasks that never delegated in any form, PIPE is **+3.5%
dearer** than TAB (`$0.011297` vs `$0.010913`), within `$0.00024` of what its extra tokens predict; NONE holds
−6.3% on both subsets, a third of it the tab's own tokens [M `03` §4]. Two of the −14.3 points are a
transcript-selection choice (a rep-slug rule gives −12.0%) [M]. Not one of the six intervals excludes zero, and a
single rep of a single form moves 23% (opencode TAB reps: `$0.008634 / 0.010612 / 0.008549`) [M `03` §5].

**Noise floor.** Every gutter effect is `$0.0003`–`$0.0004`; the task-bootstrap interval of a 66-rollout cell is
±`$0.001`–`$0.005`. No affordable run can rank the forms on cost.

---

## 4. Gutter recommendation now, and new designs

### 4.1 Recommendation per harness

| harness | keep | the evidence bar it rests on | what would change it |
|---|---|---|---|
| **claude-code** | `N<TAB>` | contract says "line number + tab" (gate off) and renders it itself [C `05` §1.1]; the tab is the cheapest zero-ambiguity form [M `05` §3.4]; the tab carry is real but costs calls only, exposure 3/22 tasks, and native has it too [M]; resolution 40/41/39 vs native 43, `p ≥ 0.72` | the `tengu_tab_read_sep` gate defaulting on (then `N:` becomes the safer form), or a carry that changes a solve |
| **codex** | `N<TAB>` | no edit mechanism (trim seek) [C][M]; price is the only axis; NONE's `$0.000302` direct saving was not realised (−0.1% observed, behaviour ate it) [M `03`]; NONE loses the only clue to a middle-out truncation gap (the numbers jump) [M `01` §3.5] | NONE realising ≥ its direct saving on ≥ 44 tasks with solves within the bar |
| **opencode** | `N<TAB>` | no edit mechanism; TAB is the cleanest cell in the run (0 failed edits in 123 `apply_patch` calls; NONE 6 rollouts, `p = 0.028`) [M `01`]; NONE solved 2 fewer | same as codex |

Ship nothing on the delimiter. The FRESH-POOL verdict stands, now with the mechanism measured on both sides.

### 4.2 New designs, ranked by expected `$` per rollout against TAB, then risk

Expected savings are the measured tab overhead (`$0.000302 / 0.000338 / 0.000440` codex / opencode / claude,
[M `03`]) scaled by each design's per-line cost [M `05` §3.1]. None exceeds 3.7% of a rollout; none is
detectable in a 66-rollout cell.

| rank | design | mechanism | tokens per line | expected `$`/rollout saved (codex · opencode · claude) | surfaces touched | cheapest falsifier | pre-registered kill line | risk |
|---|---|---|---|---|---|---|---|---|
| 1 | **sparse-10 tab**: number line 1 and every 10th line, tab-delimited | addressing survives at ±10 lines; every unnumbered line is byte-transparent | +0.148 (vs +1.34) | 0.00027 · 0.00030 · 0.00039 | `numberCodeLines` in `search-read.js` and `_ss-helpers.mjs` (one renderer since `ba5b4ee`) | `$0`: over the fresh-pool traces, count `ss-read` range arguments whose bounds could only have come from a gutter line ≥ 5 lines from a multiple of 10 (not from a header, grep line or search hit) | `ss-read` calls per rollout up by > 0.5 on any harness, or one anchor failure traceable to a miscounted line, or solves −6 | new shape the model has never seen from any harness; miscount shows up as extra reads, not as an edit error |
| 2 | **header-only** (NONE plus the existing `lines A-B` header) | the address is already in the header; `SS_READ_LINENUMS=0` never touched it | ≈ 0 | 0.00030 · 0.00034 · 0.00044 | none — this is the NONE arm | already run: 198 rollouts per form | did not clear the bar (codex +2, opencode −2, claude +1 vs TAB); on codex the direct saving was eaten by 27 more delivered lines | measured flat; loses the truncation clue on codex; NONE's roxygen transcription failures on claude-code in epoch B were never explained |
| 3 | **landmark tab**: number only lines that open a symbol | the number marks something meaningful; 5.0% of lines | +0.067 | 0.00029 · 0.00032 · 0.00042 | renderer plus the parser's symbol table | `$0`: share of `ss-read` ranges in the traces that start at a symbol boundary | below "most" of ranges symbol-aligned, or any of the sparse-10 kills | highest: parse misses silently change the format; a fourth shape |
| 4 | **indent-aware delimiter**: tab files get `N:`, space files keep `N<TAB>` | a delimiter equal to the file's own indent character is ambiguous; one that is not cannot be | +0.71 on 13.9% of lines | −0.00003 (a cost) | renderer needs the file's indent style (leading-tab scan) | `$0`: re-render the 14 TAB and 9 PIPE failed anchors under the candidate and check the strip is unique | 0 rollouts saved — which is the current reading; carries cost calls only | removes a measured defect that native's `Read` shares; not a cost lever |
| 5 | **`N:` everywhere** | the only dense form that is both zero-ambiguity and 94.8% token-transparent; contract-legal under the claude gate; the API-level editor's own form | +2.19 (vs +1.34) | −0.00016 · −0.00018 · −0.00023 (a cost) | `GUTTER_DELIMITER` enum | read the claude-code binary at each version for the gate's default | gate default off; `:` collisions (`::` in R/Rust, YAML, Python annotations) rise above 0 carries | trades a 0% hazard for a 0% hazard at +48% gutter cost until the gate flips |
| — | `N| `, `N |`, `N: `, padded `cat -n` | dominated: `N| `/`N: ` ambiguous on 64% of lines and dearer than `N|`; padding +3.26/line | — | negative | — | — | — | do not revisit; opencode upstream already moved its space in front of the pipe for our reason [W `05` §1.4] |

Sol's "sidecar ruler" (raw code plus an external tick map) is header-only plus sparse ticks; rank it with design 1
and give it the same falsifier.

---

## 5. Cost and resolution levers beyond the discard logs

Each lever names the mechanism, the evidence, the expected size, whether it is sweet-only (shared = zero A/B
differential), and a `$0` falsifier. All were checked against `SLATE-A-UBER.md` §9 and `SLATE-B-UBER.md` §8.

### 5.1 Cost levers

**C1 — `ss-*` hygiene package (sweet-only, zero behavioural risk).** Mechanism: a wasted call costs the request
that reacts to it. Evidence [M `synth-*-wasted`, `04` ×3]: crashes on a literal-looking regex that print a Node
stack trace and 830 bytes of model-load banner (37 calls / 27 rollouts claude, 18 / 17 codex, 15 / 12 opencode);
usage rejections of grep-shaped invocations (`ss-grep "<pat>" <path>`, `ss-find … --in`) 70 / 33 on claude;
`ss-read` `ENOENT` with no hint (51 claude, 27 codex, 30 opencode); empty bodies with `status=error` (15 opencode);
`(no matches)` on a scope the rollout had already read (69 claude, 26 codex scoped). Priced at the following
request: **`$0.000294` (2.4%) codex, `$0.000204` (2.2%) opencode, `$0.000370` (2.3%) claude-code** per sweet
TAB rollout; PIPE on claude 5.6%. Fixes: compile the pattern before any engine work and fall back to `-F` with the
`rg` diagnostic; accept a trailing positional path as `--in`; give `ss-find` `--in`; never print the banner; never
return an empty body; say `not indexed: <path>` when the scope exists on disk but holds no indexed content.
`$0` falsifier: replay the recorded failing commands against the goldens with the fixed wrappers; kill any fix
that recovers fewer than half of its cases. Discard-log check: absent from both logs; the BRE `\|` half is a
known bug with a shipped hint and no retry (`04-opencode` D6).

**C2 — shrink the guide to a tool list (sweet-only).** Mechanism: 1,457 tokens ingested once and re-sent on
every request: `$0.000426 / 0.000408 / 0.000530` (3.5% / 4.6% / 2.5%) [M `02` §4]; larger than the whole
observed gap on every harness [M `06` §7.5]. Two 2026 controlled studies find repository context files raise
cost 20–23% at −0.5% to −2% resolution, because instructions are obeyed and the agent does more work [W `07`
§5.1]. Note: "no guide at all" is not a meaningful arm on the CLI delivery — without the tool list the model does
not know the `ss-*` binaries exist — so the arm is a ~200-token list plus one usage line. Expected: ~1,250
tokens ≈ `$0.00035`–`$0.00045` (3–4%) by arithmetic, plus whatever share of the turn excess the guide's mandated
actions cause (the confirming `ss-read`, the mapping call, the state summary) [I]. Risk: the guide carries the
stop discipline, the `sufficient=` trust rule and the verbatim-to-subagents clause; removal can change solves.
Falsifier: the run in §6. Discard-log check: the logs kill *adding* text (`SLATE-A` §9.11, `SLATE-B` §8 ×4, the
clause graveyard); nobody has removed it.

**C3 — "not indexed", and `.jam` plus git-aware excludes, as a cost lever (sweet-only).** Mechanism: on the two
Boost.Build tasks sweet greps a corpus that holds no Jam: 49 of 69 scoped empty results on claude and 50 of 131
zero-match `ss-grep` calls on codex are those two tasks; one rollout burned 30 empty results [M `04`]. Sweet runs
11–17 turns longer than native there and solves nothing; the two tasks alone carry +6.5 points of codex's
relative cost and turn opencode's +3.3% into −0.1% [M `02` §5]. The stop-rule family is dead on record
(`project_thrash_levers_nogo_no_doomed_tail`); the upstream fix — tell the agent the scope is not indexed, and
index the file kind — removes the reason to grind. `$0` falsifier: of the 69 scoped empty results, how many are
followed within three calls by another `ss-*` call with the same scope (`04-claude-code` L2); kill below a third.

**C4 — parallel-friendly `ss-*` calls on opencode (sweet-only; prompt form closed).** Mechanism: §2.2 rank 1.
If sweet's 21.8 calls ran at native's 1.546 per request, it would take 14.1 requests instead of 19.7; at
`$0.000326` of residency-plus-output per request that is an upper bound of `$0.0018` (−20%) [M][I]. The prompt
form ("pack more probes") is closed (`SLATE-A` §9.12, `SLATE-B` §8, `turnfix` packing CLOSED) and the packing
treatment was off in every fresh-pool row [M `rows.json`]. Two forms are not closed: `ss-batch`, which is
deployed and was called 0 times in 198 opencode rollouts [M `04-opencode`], and the MCP delivery of the same
tools (`init --mcp`, unbenchmarked), under which the model would see harness-shaped tools it already
parallelises. `$0` falsifier first: count consecutive single-call sweet steps whose `ss-read`/`ss-grep` calls are
independent (different files, no argument derived from the previous result); kill if under 1.5 per rollout.

**C5 — payload budgeting by lifetime (sweet-only; admissible only as "different lines").** Mechanism: an early
read is 1.9× as dear as a late read of the same size [M `06` §7.3]. `SLATE-A` §9.6 bans compaction and
`SLATE-B` §8 bans "return the same slice more compactly"; a lever survives only if it changes which lines are
delivered. The concrete form with a `$0` falsifier is Sol's 15: on `sufficient=YES`, return the top-1 body and a
manifest of lower ranks. Falsifier: across the traces, the share of `sufficient=YES` `ss-search` calls after which
a lower-rank body is edited or re-read; kill above 20%. Check overlap with the shipped pointer tier first.
Expected ≤ 5%; resolution risk is real (the `aiohttp` winner ground its way there at 41 calls).

**Dead by measurement.** The `<state_summary>` block: 0.89–1.29 blocks per rollout, 71–120 output tokens, never
its own request (59 of 59 codex, 84 of 85 claude blocks ride inside a tool-calling turn) — under 0.5% [M
`synth-statesum`, `synth-statesum2`]. The gutter as a cost lever (−15% would need 6,403 numbered lines per
rollout [M `02` §8.2]). Cache engineering (already 99.3–100%). Compaction and eviction (never fire). Trimming
the verification tail (cost is flat by turn position, last quarter 1.02–1.13× the first [M `06` §7.8]).

### 5.2 Resolution levers

**R1 — index `.jam`, and exclude `build/`/`dist/`/`out/`/`target/` only when git does not track them
(sweet-only, new).** Evidence: 0 of 321 `.jam` files indexed in the b2 golden; `'**/build/**'` is unanchored and
deletes `src/build/**` [C `search.js`][M `04-codex` §2.4]; `stage.jam` never surfaced by an `ss-*` result in 9 of 9 codex, 9 of 9 claude-code and at least 8 of 9
opencode sweet rollouts; native reached it and solved 1 of 3 on each. Expected: at most +1 of 66 per
harness (`b2-259` is dead in both arms). The standing extension audit ("only zeek `.bif`") tested extensions,
never directory exclusions, and missed this. `$0` falsifier: re-index one b2 golden with the fix and replay the
59 recorded zero-match `ss-grep` and 9 `ss-search` queries; kill if `src/tools/stage.jam` is not in the top ten.
Also `dist/index.js` on `aws-actions` (13 wasted scoped greps, solved anyway). Ship as correctness.

**R2 — say "not indexed", never `(no matches)` (sweet-only, new).** Same evidence as C3; on b2 it is necessary
and demonstrably not sufficient. Ranking-neutral, so the `_isAgentFormat` gate does not apply.

**R3 — report where an edit's anchor is ambiguous (sweet-owned form: an `ss-read` trailer stating how many
times the window's text occurs in the file).** Evidence: 41 of 295 opencode first edits carry an ambiguous anchor,
arm-symmetric (native 12, TAB 12, NONE 11, PIPE 6); it decided `accenture-1974` only, where opencode sweet lost
5 of 9 to a silent landing in `fixKeys` against native 1 of 3, codex sweet 3 of 9 against native 0 of 3, claude
1 of 9 [M `04` ×3]. The existence proof is thin: of six rollouts that read `@@ -1593` in their own `git diff`,
one moved the hunk. `apply_patch` itself is harness-owned and the no-new-tools rule bars an `ss-edit`. Expected
≤ +1–2 of 66. `$0` falsifier: of the 41 ambiguous edits, how many were preceded by an `ss-read` covering the
region; kill below half. Discard-log check: `SLATE-A` §9.7 kills the insertion-position *oracle* (which site is
right); this reports where the edit *landed*, which is C-9's family, kept.

**R4 — never end a turn on a condenser summary.** One rollout in 264 (`nmt-192` TAB r0: four calls, no edit,
empty patch, last message a `<state_summary>`) [M `04-claude-code` §2.5]. A bug report, not a lever.

**R5 — the guide shrink (C2) as a resolution question.** Unknown sign; the run in §6 answers it.

**Where resolution actually goes.** [M `04-codex` §4] Of 101 unsolved cells on the 11 non-trivial codex tasks:
wrong-fix 50, not-localised 33 (21 of them the two b2 tasks, 9 of those the index gap), incomplete 14,
edit-mechanics 3, environment 1. Retrieval explains one task. The literature agrees: agents reach the right
file in 72–81% of failed trajectories and fail on a wrong belief; oracle localisation still leaves success below
50% [W `07` §1]. Any retrieval lever is bounded by that floor.

### 5.3 Rejected, with the killing fact

| idea | source | why not |
|---|---|---|
| dependency-source corpus | Sol 20, `SLATE-B` P1 | `spectator-181` has no `vendor/` tree and the string is nowhere in the checkout; network banned; W0 P1 gate: sweet reaches 6/102 vs native 17/102 [M `04-opencode` §2.6, memory] |
| issue→diff obligation checker; absent-artifact implementation graph | Sol 19, 22 | obligation graphs fail the blinded bar 4/5, C-7/C-8 fail structurally, the completeness card died at `$0`; `solhint` scores `f2p 0.4` in 11 of 12 cells in every arm [M memory, `04`] |
| executable public-surface witnesses | Sol 21 | C-7/P6/P3 already run: P6 discriminated only enumerability, P3 blocked twice, over-specification would block 11 solved tasks [M memory] |
| `apply_patch` preflight / canonicaliser | Sol 18 | harness-owned surface; Cline's >10% order-invariance gain is an apply-side fix we do not own [W `05` §1.9]; keep the `ss-read` trailer form only (R3) |
| remove the `<state_summary>` | Sol 17 | measured under 0.5%, never a standalone request; sweet's total output is already below native's [M] |
| replace the guide with one typed `ss` operation | Sol 13 | a new tool changes the cached prefix (tool schemas sit inside it [W `06` §2.1]) and breaks the no-new-tools rule; the shrink is kept (C2) |
| a stop rule on unproductive rollouts | `02` §8.1 | thrash levers are no-go on record; the b2 grind has an upstream cause (C3/R2) |
| more sibling retrieval; prompt clauses on hunk order or guard scoping | `04` ×3 | discard logs and the clause graveyard; `aws-embedded-metrics` PIPE rep1 read the gold file at call 5 and patched the serializer at call 9 |
| semantic search as a grep replacement | `07` L9 | negative evidence: +6% to +118% token premium, agents pick it 0–6% of the time when free [W] |
| delegation for sweet on claude-code | `07` L2 | native already delegates (15 cells) and sweet's win is not needing to; the ledger prices subagents as a lower bound |
| raising codex's output cap to favour sweet | `05` §4.3 | a harness setting shared by both arms; the default is what codex users get; raising it is a cost regression by construction and no measured failure waits behind it (0 of 6 never-shown anchors in a truncated span) |

### 5.4 Sol's 22 claims — accepted, corrected, rejected

| # | verdict | reason |
|---|---|---|
| 1 | accept | the three components are now published per harness and arm (§2.1) |
| 2 | correct | on codex the cap counterfactual explains the flip on its own (−6.5% → +11.5%); "native read shrink alone cannot explain parity" is wrong for codex and right for opencode, where the term is requests |
| 3 | correct | the guide is 1,457 tokens, not 1,307 (the frontmatter is wrong by 11%); `$0.000408` and 4.6% on opencode, not `$0.000353` / 3.8%; subagent inheritance of the guide is unresolved (the minimum subagent bundle is arm-identical, 5,353 vs 5,346 tokens [M `06` §5.4]) |
| 4 | accept the shape | sweet ingests less and re-sends more on every harness; but whole-file `ss-read` is 47 of 4,113 invocations (1.1%) and is not a live mechanism |
| 5 | partial | the contract facts hold; sweet's per-call payload is already smaller than native's on codex (5.3–6.4 kB vs 7.8–8.6 kB); the excess is requests |
| 6 | correct | ordering NONE < TAB < PIPE holds, measured +1.34/+2.27 per delivered line; but "current code applies the gutter to surfaces that were unnumbered during the fresh experiment" is false — `ba5b4ee` landed at 16:14, the first rollout at 22:27, and 94–96% of search-surface lines were numbered in epoch C [M `02` H11] |
| 7 | accept | codex: 51% of PIPE's premium is its bytes; opencode: behaviour; claude: the sidechain is 35% of the TAB→PIPE gap and the rest is main-chain behaviour on the same ten delegating tasks — and on the twelve that never delegated PIPE is +3.5% |
| 8 | reject as a ship decision | NONE on codex/opencode has a bounded `$0.0003` upside that codex did not realise; it is the right treatment arm if the gutter is ever retested |
| 9 | accept as candidates | sparse-10 and landmark are ranks 1 and 3 in §4.2; the sidecar ruler is header-only plus ticks |
| 10 | accept narrowly | the delimiter is a 2.1–3.7% cost term; "lever" overstates it because no affordable run can detect it |
| 11 | accept | the −16% comment at `search-read.js:621` is stale; `FRESH-POOL` retired the figure |
| 12 | partial | "coin flip" is the right reading of *which* tasks delegate (4 TAB cells and 4 NONE cells delegate where the other forms do not); "mediation not proven" is right about the main-chain share; the three-epoch direction (3/11, 0/20, 9/28 delegating rollouts) supports "sweet removes the need" as [I] |
| 13 | split | shrink: accept (C2); typed operation: reject (§5.3) |
| 14 | accept with the discard-log constraint | C5 |
| 15 | accept | the concrete, `$0`-falsifiable form of 14 |
| 16 | reject | same as 8 |
| 17 | reject | measured dead |
| 18 | partial | R3 in its `ss-read` form only |
| 19–22 | reject | §5.3 |

---

## 6. The recommended next paid run

**Design.** One run, three harnesses, the 22 unselected fresh-pool tasks, 3 reps, three arms:
**native**, **sweet-full** (the current 1,457-token guide), **sweet-min** (a ~200-token tool list with one usage
line per tool; no doctrine). Both sweet arms carry the C1 hygiene package and R1 index fix, each `$0`-falsified
before launch. Gutter fixed at `N<TAB>` in both sweet arms — no gutter arm. Opencode at `CONCURRENCY=1` (the
preflight race). Ledger re-swept green on the new shim fingerprint before any rollout (the ledger hashes the
generated shim, so the hygiene fixes force a re-sweep).

**Why this question.** The guide is the largest sweet-only cost term that is fully under our control, its cost
is a measured constant (so the saving needs no confidence interval), and its behavioural effect is the one
stochastic unknown — which a 66-rollout cell *can* answer at the pre-registered solve bar. Every other candidate
is either sub-noise (the gutter), a correctness fix that needs no A/B (C1, R1), or closed on record.

**Pre-registered bars.**
1. *Resolution*: sweet-min within 6 rollouts of sweet-full on every harness; a loss of ≥ 6 on any harness kills
   the minimal guide there. Sweet-full within 6 of native replicates parity.
2. *Behaviour*: paired Δ turns (sweet-min − sweet-full) ≤ +1.0 per harness and Δ output tokens ≤ +10%; if both
   hold, the arithmetic saving (`1,257 tokens × (0.10 + 0.01·(T−1))`, ≈ `$0.00036–0.00046`) is banked without
   a CI. If turns rise by more than 1.0, the guide's mandated actions were not the source of the turn excess and
   the saving is void.
3. *Controls*: the 11 solved-everywhere tasks stay 3/3 in every arm; any control cell below 2/3 voids the run
   (environment, not treatment).
4. *Hygiene*: wasted `ss-*` calls per sweet rollout ≤ 0.2 on every harness (from 0.33–0.91), measured by the
   `synth-*-wasted` scripts; above 0.2 the package did not land.
5. *Accounting*: claude-code priced on the graded transcript per row, published with all three conventions;
   codex and opencode on `rows.json`; the run's spend published as the sum of the cells, not a ledger figure.
6. *Read-only forensics rule*: nothing per-query is read on the held-out set; this pool is DEV-retired.

**Cost.** From the fresh-pool cell totals — codex `$0.81`, opencode `$0.59–0.61`, claude-code `$1.17–1.42` per
66 rollouts [M `FRESH-POOL` §1] — 594 rollouts cost about **`$8.5`** at the registered price, **`$17`** at
today's listed luna price (2× the registered vector, ratios intact [W `06` §1.1]). Cheaper variant: pool the
native arm from the fresh pool under a green ledger on the same fingerprint (native never sees the shim), which
removes 198 rollouts and brings it to about `$5.7` / `$11.4`; admissible only if the preflight is green on all
22 tasks and no shared-arm file changed.

**What it does not buy.** A cost CI at ±4%: that needs ~130 tasks per harness. The run resolves the solve
question and the behaviour question, and the cost claim rides on arithmetic — state that in the pre-registration.

---

## 7. Where the evidence files disagree, and which number is right

1. **Gutter cost per rollout.** `03` measures `$0.00030–0.00044` (2.1–3.7%) on the delivered epoch-C blocks with
   the real residency; `05` estimates 0.75–1.56% and `06` 1.2%. `03` is right: `05` and `06` used the epoch-B
   `ss-read`-only line count (394 lines per rollout against 878 delivered in epoch C, where every `ss-*` surface
   is numbered) and `05` used call counts (12.5) in place of requests (19.6) for residency. The same error
   scales the codex PIPE attribution: `03`'s direct term is 51% of the observed premium (72% of its input side),
   not `05`'s 13–18% or `06`'s 0.77 points. `01` §3.6 independently counts 867 gutted lines per codex rollout,
   which corroborates `03`.
2. **Claude-code cost.** −8.8% (graded transcript) is the per-rollout number; −3.9% (published) includes 13
   discarded re-runs; +1.9% is per dollar spent. Verified in `rows.json`: `degenReran` 5/4/2 sweet, 1 native.
3. **Cache-write surcharge on opencode.** `02`'s `$0.000005` is what the harness's realized column charges; `06`'s
   `$0.000698` is what the provider contract bills. Both are right about their object; the runner code shows the
   1.25× is applied on claude-code only [C]. Consequence: codex and opencode realized are ~7% lower bounds,
   uniformly; the claude−codex gap is 1.62× on ideal, 1.71× on realized.
4. **Guide size.** 1,457 tokens (`02`, `06`, wire-measured on 261 rollouts); Sol's 1.3k is the stale frontmatter.
5. **Claude edit-failure counts.** `01` 256/47/19, `03` 252/45/19, `04` 255/42/17 (calls/failed/rollouts) differ by
   transcript selection and failure classes; all three agree on ranking (PIPE lowest, TAB ≈ native) and flatness.
6. **Is the codex cap configurable?** `05` says `tool_output_token_limit` would lift it; `06` says the
   `exec_command` path is governed by the per-model truncation policy and not by that key [I]. Unresolved. It is
   a shared harness setting and should stay at codex's default; the falsifier is the codex-rs source for the
   unified-exec path.
7. **Native `Read` count on claude-code.** `01`'s 18.9 per rollout includes subagent reads; main thread alone
   is 10.45, subagents 8.94 [M `synth-cc-wasted`].
8. **The run's spend.** `FRESH-POOL` §0 says `$6.9`; its own §1 cells sum to `$10.88`, and `rows.json` realized
   sums to `$3.28` (codex) + `$3.23` (opencode, including the repair pass and the deleted rows) + `$5.25`
   (claude reconstruction) = **`$11.76`** at the registered price, about `$23.5` at today's listed price [M].
9. **Sol 6 on the numbered surfaces.** Wrong; epoch C numbered them (item 6 in §5.4).
10. **`FRESH-POOL` §4 on native narrowing its reads.** Wrong on codex; the cap did it (§2.4).
11. **`GUTTER-AB` claude anchor table.** Withdrawn at 66 rollouts (§1).

---

## 8. Corrections to the standing record

1. `FRESH-POOL` §0/§7: the `$6.9` spend figure and "adaptive output budgeting is the lever" are both unsupported
   by the run's own data (§7 item 8, §2.4). The efficiency claim must say "fewer calls, not fewer requests".
2. `GUTTER-MECHANISM` §1.2 "config.toml sets no limit": true of the deployment, not of the capability [C `05`].
3. `GUTTER-MECHANISM` §5.4 "tab is cheapest by 0.93 tokens per line": true against `N| `; against the safe
   alternatives `N:`/`N|` the margin is 0.71–0.74 [M `05` §5].
4. `REBASELINE` §2 "sweet used zero subagents": epoch B only; in epoch C sweet delegated in 9 rollouts (6 cells).
5. The guide frontmatter `token_count: 1307` understates the real 1,457 by 11%; the `−16%` comment at
   `search-read.js:621` is retired; a ninth trap belongs in Appendix A — check `f2pFrac`/`testResults` for null,
   not only `resolved` (`b2-259` PIPE rep 2 on opencode).

---

## 9. What I could not finish

- **The codex cap's config key** (§7.6) is unresolved without the codex-rs source for the non-unified exec path or
  a one-task smoke, and the box rules forbid launching codex.
- **The C4 `$0` census** (independent consecutive single-call steps on opencode) was not run; the mechanism is
  measured, its ceiling is not.
- **Wasted-call pricing** charges only the request that reacts to the failure. The retry call itself and any
  further fallback are not included, so the 2.2–2.4% figures are lower bounds on the cost and the saving from
  C1 is between one and two of those requests per wasted call.
- **Sol's run** used the OpenRouter fallback after the codex subscription token expired (`logs/sol-ideation.log`);
  its 22 claims were read from the finished file, not from a live session.

---

## Appendix — new artifacts

| file | what it measures | key result |
|---|---|---|
| `scripts/synth-cc-readgate.mjs` → `logs/synth-readgate.txt` | claude-code Edit precondition against the sweet arm | 218/259 sweet TAB edits with no prior native Read; 0 gate errors in 1,044 edits |
| `scripts/synth-oc-parallel.py` → `logs/synth-ocparallel.txt` | opencode tool calls per request | native 1.546 (25.2% multi-call steps), sweet 1.106–1.157 |
| `scripts/synth-cc-wasted.mjs` → `logs/synth-ccwasted.txt` | claude-code: price of the request after a wasted `ss-*` call; native Read census incl. subagents | `$0.00037` (2.3%) TAB, `$0.00084` (5.6%) PIPE; Reads 10.45 main + 8.94 subagent |
| `scripts/synth-oc-wasted.py` → `logs/synth-ocwasted.txt` | opencode, same | `$0.000204` (2.2%) TAB |
| `scripts/synth-codex-wasted.mjs` → `logs/synth-codexwasted.txt` | codex, same; `--force` retries | `$0.000294` (2.4%) TAB; cell ties to `$0.012330` |
| `scripts/synth-statesum.mjs`, `synth-statesum2.mjs` → `logs/synth-statesum*.txt` | `<state_summary>` volume and whether it occupies its own request | 71–120 output tokens per rollout; 0–1 standalone in 144 blocks |
| box one-liners (this file §7) | `degenReran` counts; `packingTreatment`; realized spend per run; claude binary strings | 5/4/2 vs 1; off everywhere; `$11.76`; gate strings present |
