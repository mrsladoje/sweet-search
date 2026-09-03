# HANDOFF — everything since `HANDOFF-SLATE-C-FIXES.md`, and where every trace lives

**Written 2026-09-03.** Covers the window from `b669674` (the Slate C code fixes, already landed
when this session started) through the multi-file smoke, two cost-measurement repairs, and a
forensic read of why sweet lost the reps it lost.

**Audience: a session that will propose fixes.** §7 is the open list. Everything before it is
evidence, and §6 tells you how to reach the raw traces without re-running anything.

**Spend in this window: $13.43 of model traffic** (the smoke), plus $0 for every analysis.

---

## 1. What actually happened, in order

| # | | |
|---|---|---|
| 1 | **The box had none of the eleven fixes.** `/root/sweet-search-private` is an rsync target with no `.git`, so nothing about it was visible from a commit log. Deployed from `b669674` **without `--delete`** (which would have destroyed box-local task caches). Dependencies were byte-identical, so no `npm install`. | `9829ffa` |
| 2 | **Seven goldens rebuilt on the M3 Max, not RunPod** (owner instruction), forced onto the ORT INT8 CPU path so the document encoder matches the queries and the thirteen reused goldens. 90 minutes, serial. Trees bit-identical, pushed checksum-verified, index-build stamped. | `9829ffa` |
| 3 | **Green ledger swept** as `luna-smoke20-v5`: 20/20 `gold-valid`. The first pass failed six tasks on `derived-image-missing` because the docker-save tar vault had moved to `/mnt/benchvol/tar-vault`. | — |
| 4 | **Smoke ran**: 20 tasks × 3 reps × 2 arms × 3 harnesses = **360 rollouts, all recorded**, 21:05Z → 06:56Z. | `47658fd` |
| 5 | **Two cost defects found and fixed** — claude-code's delegated spend was unpriceable, and luna was priced at half. | `11fca0f`, `6f7ba9d` |
| 6 | **Loss forensics** on the three tasks where sweet lost reps. | this file, §5 |
| 7 | **Ablation**: does the golden rebuild explain squashql's loss? | this file, §5.4 |

Commits in this window, oldest first: `9829ffa` `47658fd` `11fca0f` `6f7ba9d` `9230c7f`.

---

## 2. The headline result

**The pre-registered expectation held. No cell clears the ±6-of-60 solve bar, and task-level
resolution is tied 8/20 in every arm of every harness.**

| harness | native solved reps | sweet solved reps | native tasks | sweet tasks |
|---|---:|---:|---:|---:|
| opencode | 23/60 | 18/60 | 8/20 | 8/20 |
| claude-code | 21/60 | 22/60 | 8/20 | 8/20 |
| codex | 20/60 | 18/60 | 8/20 | 8/20 |

On opencode and claude-code the **same eight tasks** solve on both sides (native-only 0,
sweet-only 0). On codex the arms trade one each: `squashql__squashql-295` native-only,
`eclipse-ee4j__yasson-395` sweet-only. Twelve of twenty are solved by neither arm anywhere.

This is the retrieval-headroom finding on the population chosen *in advance* as the most
favourable one — multi-file patches in larger repositories, declared before the run as the last
place the retrieval story could live. It shows no solve effect.

**Cost, at corrected prices, is where sweet wins:**

| harness | native | sweet | delta |
|---|---:|---:|---|
| opencode | $1.3523 | $1.2902 | sweet −4.6% (CI spans zero) |
| codex | $1.7651 | $1.5471 | **sweet −12.3%**, %CI [+1.3%, +22.0%], p=0.029 |
| claude-code | $4.2411 | $3.1184 | **sweet −26.5%**, %CI [−46.9%, +0.6%] |

Only codex's interval excludes zero, and it is uncorrected for three harnesses. Read this as
**efficiency at parity**: the same tasks get solved for less. It is not evidence that sweet
solves more.

**One row favours native and must not be dropped when quoting the rest:** on opencode sweet's
**cost per resolved rep is 21.9% WORSE** ($0.0717 against $0.0588), because it solved five fewer
reps on the same total spend.

---

## 3. The two cost defects — both real, both fixed, both retroactive

### 3.1 claude-code's delegated spend was unpriceable (`11fca0f`)

Claude Code reaches luna through OpenRouter's Anthropic-compatible skin. In **sidechain
(subagent) transcripts that skin writes a `usage` object that is structurally present but all
zeros and nulls**. `transcriptMetricsFromFile` therefore counts the message and cannot count its
tokens, `instrumentationComplete` goes false on all 61 subagent files, and
`addSidechainCostsChecked` correctly nulls the row rather than publish an under-count.

**It is arm-asymmetric, which is what made it dangerous.** Native issued 873 delegated requests,
sweet 213 → 43 of 60 native rows nulled against 9 of 60 sweet. Summing the column with nulls as
zero reads native $0.26 / sweet $0.85; the truth is native $4.24 / sweet $3.12. A sign flip from
a column behaving exactly as designed.

**The fix.** `message.id` in those records is an **OpenRouter generation id**, and
`/api/v1/generation?id=<id>` returns the authoritative billed cost and native token split.
`harness/reprice-openrouter-generations.mjs <run>` harvests them per (task, arm, rep) and prices
the run from the actual bill. **4,827 of 4,827 ids resolved, zero unresolved.** Arm-symmetric by
construction. **Retroactive** — a 2026-08-26 fresh-pool id still resolves.

**opencode and codex transcripts carry no generation ids**, so this repricing does not reach
them.

### 3.2 luna was priced at the `:batch` rate (`6f7ba9d`)

`MODEL_PRICES['openai/gpt-5.6-luna']` held `{in .10, cache .01, out .60}` — byte-identical to
the `openai/gpt-5.6-luna:batch` variant. The bench uses the standard endpoint, now
`{in .20, cache .02, out 1.20}`. Correct when fetched 2026-08-04; the rate moved under it.

Verified against the provider's **billing**, not its price list: a real request (prompt 8524,
cached 0, completion 159) was billed $0.002322, and `cacheWrite .25 / cacheRead .02 / out 1.20`
predicts $0.002322 — a **0.009% match**, with a second generation matching to 0.004%. Plain
input at .20 is off by 18.4%, so **the provider really does bill every uncached prompt token as
a cache write at 1.25× input — D1's convention, confirmed from the provider side.**

A 2026-08-27 fresh-pool generation prices on the same rates, so **every luna figure this bench
published from at least 2026-08-26 is half the real cost.** The correction is an **exact scalar
2.0**, so absolute dollars double and **no ratio, interval or p-value moves.**

Also stale and fixed: `gpt-5.6-sol` came *down*, 2.50/0.25/15.0 → 2.00/0.20/10.0. No run used it.
Checked OK: gpt-5.5, anthropic/claude-sonnet-5, x-ai/grok-4.5, meta/muse-spark-1.1, gpt-5.6-terra.

### 3.3 The reconciliation, which is what closes the question

| | |
|---|---:|
| harness reported, all three legs | $4.0898 |
| corrected (claude-code billed; opencode + codex at the fixed rate) | **$13.3142** |
| the account's cumulative usage across the run window | **$13.4330** |
| residual | $0.119 (**0.9%**) |

A 0.9% residual means opencode and codex capture is ~98% complete once the price is right, and
claude-code's subagent blindness was the *only* missing-instrumentation defect. **Nothing else
is hiding.**

---

## 4. Harness economics, measured

Per rollout. **opencode and codex figures come from `turns/` files, which hold ONE rep per cell,
not all three** — multiply by 3 or you undercount 3×. claude-code is from OpenRouter billing and
is already per rollout.

| harness | arm | requests | prompt tok | cache% | out tok | tool calls | $/rollout |
|---|---|---:|---:|---:|---:|---:|---:|
| opencode | native | 19.2 | 477,210 | 92.8 | 4,149 | 29.5 | $0.0225 |
| opencode | sweet | 20.7 | 481,224 | 93.1 | 4,167 | 22.8 | $0.0215 |
| codex | native | 20.4 | 602,580 | 93.1 | 6,288 | 13.1 | $0.0294 |
| codex | sweet | 19.8 | 541,296 | 93.2 | 6,162 | 12.5 | $0.0258 |
| claude-code | native | 47.1 | 1,659,562 | 94.6 | 14,182 | 56.3 | $0.0707 |
| claude-code | sweet | 33.4 | 1,139,552 | 94.9 | 13,114 | 30.3 | $0.0520 |

`promptTok × cache% × $0.02/M + promptTok × (1−cache%) × $0.25/M + outTok × $1.20/M`
**reproduces every row to 0.2–3.5%.** Use it to sanity-check a cost figure without touching the
billing API.

**opencode is cheapest because it does the least work**, not because it is discounted. It is
**not clearly better at solving** — 23/60, 21/60, 20/60 native reps across the three, all 8/20
at task level; those gaps are noise at n=60.

**claude-code is 3.1× opencode because of subagent fan-out**: 47 requests per rollout against 19,
3.4× the output tokens, and **40.2% of native's spend on delegated Task subagents against
sweet's 8.7%**. Sweet answers with `ss-*` instead of delegating. That is the mechanism behind its
largest win — and it couples that win to F2 (§7.1).

---

## 5. Why sweet lost the reps it lost

### 5.1 It is three tasks, not a pattern

| task | opencode | codex | claude-code | net |
|---|---|---|---|---:|
| `squashql__squashql-295` | 3/1 | 3/0 | 3/2 | **−6** |
| `getmoto__moto-6716` | 3/2 | 3/1 | 3/3 | −3 |
| `gleam-lang__gleam-3458` | 3/1 | 1/2 | 3/3 | −1 |
| gains: yasson +2, graphql-go-tools +1, vazco +1, markdown +1 | | | | +4 |

### 5.2 Every failure is a WRONG FIX, not a retrieval miss

Every failing sweet rollout produced a patch, **in the right file, in the right method**.

On squashql both arms edit `QueryResolver.checkSubQuery`. **Native makes two edits; sweet makes
one.** Sweet misses
`new DatabaseQuery(queryScope, new ArrayList<>(this.subQueryMeasures.values()))` four lines
above — which is the substantive fix. Sweet **had those lines in context** (it read 170–235 and
1–175) and did not recognise them. Native additionally opened `DatabaseQuery.java` and
`CompiledTable.java`; sweet opened neither.

### 5.3 Sweet stops reading too early, and its own tool says so

Mean read characters per rollout, sweet **solved vs failed**: opencode 8031 vs 6481, codex 6138
vs 4401, claude-code 8906 vs 8406. For **native** the same split is flat or reversed (opencode
6508 vs 6292, codex 5080 vs 5250). **Sweet-specific, not task difficulty.**

Across 180 sweet rollouts:

| | solved | FAILED |
|---|---:|---:|
| saw `confidence=low` | 66% | **84%** |
| last verdict `sufficient=unknown` | 47% | **65%** |
| last verdict `sufficient=YES` | **33%** | 17% |
| mean steps after the last verdict | 11.8 | 12.8 |

**The signal predicts the outcome and changes nothing about behaviour.** This is direct evidence
for the pre-registered §8 adaptive-budgeting census, and it points the lever the opposite way
from how that census was framed: **widen on a low verdict**, not trim on a high one.

### 5.4 The gutter is exonerated — do not re-open it

`squashql` fails on **all three** harnesses, which run three different gutter forms (claude-code
`N<TAB>`, opencode `N:`, codex none). `getmoto` fails on opencode and codex — colon and none.
**Every failing patch applied cleanly at the correct lines.** A gutter defect would be
harness-specific and would show as misapplied edits; neither is present.

### 5.5 Ablation: does the golden rebuild explain squashql?

`squashql` and `gleam` are two of the seven goldens rebuilt on 2026-09-02; `getmoto` is not, and
it still loses 3 reps, so the effect exists on an untouched golden. But the confound deserved a
direct test.

**The rebuild's entire effect on this golden is ONE 23 KB minified CSS file**
(`server/src/test/resources/public/static/css/main.1adff166.css`) dropped from the index. An
ablation index built with `SS_INDEX_SKIP_MINIFIED=0` **reproduces the pre-rebuild state exactly
— 486 files / 2,399 chunks, matching the July index; the shipped one is 485 / 2,397.** Same git
tree in both (`57702ae5acb98650584a7221c9fb1d652be5db8c`).

**Result: the rebuild is EXONERATED, and the squashql deficit is real and reproducible.**
Two conditions, same day, both harnesses, 24 rollouts, ~$0.5.

| run | harness | index | native | sweet |
|---|---|---|---:|---:|
| smoke 09-02 | codex | new | 3/3 | 0/3 |
| smoke 09-02 | opencode | new | 3/3 | 1/3 |
| smoke 09-02 | claude-code | new | 3/3 | 2/3 |
| **ablation B** | codex | **OLD** | 1/3 | 1/3 |
| **ablation B** | opencode | **OLD** | 3/3 | 0/3 |
| **ablation A** | codex | new (control) | 2/3 | 1/3 |
| **ablation A** | opencode | new (control) | 3/3 | 1/3 |

| | native | sweet |
|---|---|---|
| OLD index (pre-rebuild) | 4/6 (67%) | 1/6 (17%) |
| new index (shipped) | 14/15 (93%) | 5/15 (33%) |
| **pooled** | **18/21 (86%)** | **6/21 (29%)** |

Sweet is **not** better on the pre-rebuild index — it is 1/6 there against 5/15 on the shipped
one. **The dropped 23 KB minified CSS file explains nothing.** Pooled two-proportion
**z = 3.74**, so the sweet deficit on this task is real, not noise.

**A second finding fell out of the control, and it matters more than the ablation.** Native went
**3/3 → 1/3 → 2/3 on codex across three runs of an identical cell.** Native has no `ss-*` tools,
so the index cannot touch it: that swing is pure run-to-run variance. On opencode native was
stable at 3/3 three times, so the instability is codex-specific, not task-specific.

**Consequence for how single cells are read.** Last night's headline "codex squashql 3/3 vs 0/3"
overstated a gap that pools to 6/9 vs 2/9 once the same cell is re-run twice. Three reps on one
harness is not enough to call a task, and **the codex leg specifically needs more reps or a
variance disclosure before any per-task claim is made from it.** The pooled 18/21 vs 6/21 stands
because it has 21 rollouts behind it, not 3.

Artifacts: `/root/ablation/` on the box (driver log + four run dirs
`ab-sq-{oldidx,newidx}-{codex,opencode}-20260903`), indexes preserved at
`/root/.ss-eval/{ablation-index,shipped-index}/`. The golden was restored to the shipped index
(485 files / 2,397 chunks) and re-locked — **verified after the run**.


---

## 6. Where every trace lives

### 6.1 In the repo (committed, no box access needed)

| what | path |
|---|---|
| pre-registration + pre-launch amendment (§9A) | `handoffs/improve/slate-c/SMOKE-MULTIFILE-PREREGISTRATION.md` |
| results, including the corrected cost tables (§2A) | `handoffs/improve/slate-c/SMOKE-RESULTS.md` |
| raw analyzer output, all three legs, both bases | `handoffs/improve/slate-c/SMOKE-ANALYSIS-RAW.txt` |
| **per-rollout rows, all 360** | `handoffs/improve/slate-c/smoke-rows/sm-{opencode,claudecode,codex}-20260902-rows.json` |
| **claude-code billed truth, per rollout** | `handoffs/improve/slate-c/smoke-rows/sm-claudecode-20260902-openrouter-billed.json` |
| the repricing tool | `harness/reprice-openrouter-generations.mjs` |
| golden rebuild scripts + keys | `handoffs/improve/slate-c/fixes/golden-{rebuild-local.sh,reindex-ort-cpu.sh,rebuild-keys.txt}` |
| the smoke driver as run | `handoffs/improve/slate-c/fixes/smoke20-driver.sh` |
| the 20 task ids | `handoffs/improve/slate-c/smoke20.txt` / `.json` |

`rows.json` is the per-rollout authority. Useful fields: `resolved`, `f2pFrac`, `resolveStatus`,
`calls`, `ss`, `patchHunks`, `patchFiles`, `exitReason`, `wallMs`, `costRealizedUsd`,
`idealCostUsd`, `breakPricedCostUsd`, `rtLaunched`, `rtTrustworthy`, `rtInfra`, `usage`.

### 6.2 On the box (`root@167.233.69.121`) — the only place the full traces exist

| what | path |
|---|---|
| run dirs (467M / 161M / 507M) | `/root/sweet-search-private/eval/task-completion-bench/results/sm-{opencode,claudecode,codex}-20260902/` |
| **per-rollout tool-call traces** | `<run>/trajectories/<task>-<arm>-r<rep>.json` |
| per-cell turn/usage records (**ONE rep per file**) | `<run>/turns/<task>-<arm>.jsonl` |
| **claude-code raw transcripts** | `<run>/agent-state/<task>-<arm>/claude-home/projects/*-r<rep>-*/*.jsonl` |
| **claude-code subagent transcripts** | `…/<session>/subagents/agent-*.jsonl` |
| codex raw transcripts | `<run>/agent-state/<task>-<arm>/codex-home/sessions/…` |
| opencode state | `<run>/agent-state/<task>-<arm>/opencode-data/` |
| generated patches | `<run>/preds-{native,sweet}.jsonl` |
| green ledger | `/root/env-ledger/luna-smoke20-v5/ledger.jsonl` |
| driver + leg logs, analysis, billed json | `/root/smoke20/` |
| the ablation | `/root/ablation/`, indexes in `/root/.ss-eval/{ablation-index,shipped-index}/` |

**A trajectory record is `{call, name, kind, input, result, isError}`.** `kind` is `ss`,
`nativeRead`, `bash` or `test`. This is the fastest way to read agent behaviour — §5.2 and §5.3
were both derived from it.

### 6.3 Reproducing the analyses in this file

- §5.1 rep table, §5.3 read volumes and sufficiency counts: iterate `<run>/trajectories/*.json`
  and join to `rows.json` on `(taskId, arm, rep)`.
- §5.2 diff comparison: `preds-{native,sweet}.jsonl`, filter on `instance_id`.
- §3 repricing: `node harness/reprice-openrouter-generations.mjs <run>` with
  `OPENROUTER_API_KEY` set. Costs nothing; the generation endpoint is free.
- §4 economics: `turns/` for opencode/codex (**×3**), the billed json for claude-code.

### 6.4 Box gotchas that will otherwise cost an hour

- `/root/sweet-search-private` has **no `.git`**. Compare files, not commits.
- `SS_DERIVED_BACKUP=/mnt/benchvol/tar-vault` for both the sweep and the run, or the six
  prep-warmed tasks record `derived-image-missing` and the run refuses. `/mnt/benchvol` is 100%
  full — read-only use.
- `HARNESS=claudecode`, not `claude-code`. `PROVIDER=openrouter`, `REASONING=medium` — the
  defaults are deepseek/standard. `export PATH=/root/.local/bin:$PATH`.
  `DOCKER_HOST=unix:///var/run/docker.sock`. Key is in `/root/.openrouter.env`.
- Codex subscription auth is dead (token expired 2026-08-06) and **this does not matter** — that
  token is only read under `CODEX_SUBSCRIPTION=1`. The codex leg ran 120/120 via OpenRouter.
- Goldens are `chmod a-w`. Unlock before touching, relock after.
- Disk was down to 13G at one point during the run; a guard pruned. Currently ~33G.

---

## 7. Open, ranked — this is the list to think about

### 7.1 F2 failed its acceptance, and it is coupled to the biggest cost number — BLOCKING

The pre-registered acceptance was "subagent transcripts show no `Invalid pages parameter` on
either arm". Measured on this run's `agent-state`:

| | native main | native subagent | sweet main | sweet subagent |
|---|---:|---:|---:|---:|
| fresh pool 2026-08-26 (66 rollouts/arm) | 358 | 240 (33 transcripts) | 50 | 36 (11) |
| this run (60 rollouts/arm) | 294 | **334** (52 transcripts) | 42 | **12** (9) |

`buildClaudeCliArgs` does emit `--append-subagent-system-prompt` and 2.1.218 does register it,
but the failures did not go away and **the native/sweet asymmetry F2 existed to remove is still
there**. Transcripts never record the system prompt — in this run *or* in the fresh pool where
`--append-system-prompt` is known to work — so absence there proves nothing either way. Find a
direct test of delivery.

**Why it is blocking:** native's subagent fan-out drives most of claude-code's −26.5%. If fixing
F2 changes how much native delegates, that number moves. Do not quote −26.5% until F2 is
understood. (Counts are likely doubled — claude-code stores each tool result twice — but both
runs were counted identically.)

### 7.2 The sufficiency signal is predictive and ignored — the most promising lever

§5.3. The tool already knows when it has not found enough. Nothing consumes that. The obvious
shapes: make a low verdict *force* a widening step; or feed `sufficient=`/`confidence=`/margin
into the guide as an explicit "do not stop" condition. Note the direction — **widen on low**,
which is the opposite of the trimming framing in the pre-registered §8 census.

### 7.3 Sweet under-edits when the gold patch needs a second site

§5.2. Sweet's precision is real and is what makes it cheap; the failure mode is that a confident
single hit ends the search. Worth checking against `patchFiles` versus gold file counts across
the whole pool before designing anything.

### 7.4 codex rep-variance makes single cells unreadable — NEW, found by the ablation control

An identical codex cell (squashql, native, 3 reps) returned 3/3, then 1/3, then 2/3 across three
runs. Native uses no `ss-*`, so nothing about the index or the treatment can explain it. opencode
was stable at 3/3 three times. Until this is characterised, **do not quote a per-task codex
result from 3 reps**, and consider whether the codex leg needs more reps than the other two.

### 7.5 The §8 adaptive-budgeting census is still unrun

Pre-registered against these traces, gates nothing. §5.3 has already answered its first question
in the negative-for-trimming direction; the second question (trimmable surplus on repos above
1,000 files) is untouched.

### 7.6 Smaller

- `DIAGNOSTIC INSTRUMENTATION INCOMPLETE` fires on 120/120 opencode and codex rows and 52/120
  claude-code rows, so the analyzer fails closed and prints no exclusion sensitivities. The
  attestation field is worth wiring.
- `golden-rebuild-need.mjs` re-reports `srcBuild` after a successful rebuild because that column
  is a **tree** property a reindex cannot clear. It is a pre-rebuild selector; its verdict column
  should not be read as a post-rebuild acceptance. Index **membership** is the acceptance.
- **Re-audit `MODEL_PRICES` against live OpenRouter before every publishable run.** Prices move
  silently and nothing notices.
- Two tasks are flagged ALL-UNTRUSTED by the verdict census in every leg
  (`getmoto__moto-6716`, `jensneuse__graphql-go-tools-174`) — 2 of 20, under the bar of 4, but
  consistent across harnesses, so it is a property of those tasks.
- The two owner decisions from the previous session are still open: name-lock stamping plus a
  null-arm sweep over HO2's 7 vacuity flags, and whether `promptCacheTtl: "5m"` becomes a
  documentation recommendation.

---

## 8. What NOT to redo

- **The gutter.** §5.4. Exonerated with cross-harness evidence.
- **Re-running the smoke to "get better solve numbers".** Task-level resolution is tied and the
  12 unsolved tasks are unsolved by both arms. There is no solve signal to recover here.
- **Quoting any pre-2026-09-03 luna dollar figure.** All of them are half. The percentages are
  fine.
- **Pooling this run with the fresh pool.** Different pool, different ledger version, different
  shim fingerprint, and F1/F2 moved the harness between them.
