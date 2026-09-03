# SMOKE RESULTS — 20 multi-file, larger-repo tasks (DEV-RET)

**Run 2026-09-02 21:05Z → 2026-09-03 06:56Z. 360 of 360 rollouts recorded, every cell full.
Spend $4.09** against the pre-registered "about $4.5". Pre-registration and its pre-launch
amendment: `SMOKE-MULTIFILE-PREREGISTRATION.md` (§9A). Raw analyzer output:
`SMOKE-ANALYSIS-RAW.txt`. Rows: `smoke-rows/`.

**One sentence.** The pre-registered expectation held on every harness: **no cell clears ±6 of
60 on solves**, task-level resolution is 8 of 20 in both arms almost everywhere, and the only
cost figure whose interval excludes zero is codex at **sweet −12.3%**.

---

## 1. Primary outcome — solved rollouts per cell, bar ±6 of 60

| harness | native | sweet | Δ | clears ±6? |
|---|---:|---:|---:|---|
| opencode | 23/60 | 18/60 | −5 | no |
| claude-code | 21/60 | 22/60 | +1 | no |
| codex | 20/60 | 18/60 | −2 | no |

**Pre-registered expectation confirmed.** Read the bar as the pre-registration wrote it: at 60
rollouts per cell this run has *less* power than the 66-rollout run that set ±6, so a null here
is weaker evidence than a null there, not a clean threshold.

**Task-level resolution is flatter still**, and this is the more stable read because a task
carried by one rep of three is noise:

| harness | native | sweet | both | native-only | sweet-only |
|---|---:|---:|---:|---|---|
| opencode | 8/20 | 8/20 | 8 | — | — |
| claude-code | 8/20 | 8/20 | 8 | — | — |
| codex | 8/20 | 8/20 | 7 | `squashql__squashql-295` | `eclipse-ee4j__yasson-395` |

Two arms, three harnesses, and **the same eight tasks solve on both sides** in two of the three
legs. On codex the arms trade exactly one task each. Twelve of the twenty tasks are solved by
neither arm in any harness.

**This is the retrieval-headroom finding, on the population chosen because the effect was most
likely to live there.** The stratum was picked in advance for multi-file patches in larger
repositories, declared as the last place the retrieval story could live, and pre-registered to
expect no effect. It shows none.

## 2. Secondary — cost per rollout

Ledger basis `cache-write-1.25x-all-harnesses` (D1) throughout; the legacy basis is in the raw
output for the disclosure row and moves nothing by more than 0.1pp on opencode or codex.

| harness | all paired (n=20) realized | p | both-solved (n=7-8) | note |
|---|---|---|---|---|
| codex | **sweet −12.3%** ($0.2942 → $0.2579), %CI [+1.3%, +22.0%] | **0.029** | sweet −9.0%, p=0.408 | the only interval excluding zero |
| opencode | sweet −4.6% ($0.2254 → $0.2150), %CI [−2.9%, +11.4%] | 0.223 | sweet −1.1%, p=0.848 | interval spans zero |
| claude-code | **unavailable** | — | unavailable | 18 of 20 paired tasks have missing row costs |

`idealCost` and `breakPriced` track realized within 0.3pp on both usable legs, and breakPriced
equals idealCost exactly because context is measured append-only.

**Do not read codex's −12.3% as a sweet win yet.** It is one leg of three, on a 20-task pool, at
p=0.029 with no multiplicity correction across the three harnesses; the both-solved stratum on
the same leg is −9.0% at p=0.408. It is a point estimate that survived its own interval, and
nothing more.

**Claude-code's cost is not reportable from this run.** 43 of 60 native rows and 9 of 60 sweet
rows carry no inclusive cost, so 18 of 20 paired tasks drop out. The analyzer refuses a number
rather than printing a biased one, which is the correct behaviour: the missingness is
concentrated on native, so any figure computed from the survivors would flatter sweet. The
construction is ROW-MATCHED; the published fresh-pool figure was dearest-3, and the two are
never comparable.

---

## 2A. Cost, corrected — added 2026-09-03 after two measurement defects were found and fixed

§2 above is what the harness reported at the time. Both of its problems are now closed, and the
corrected picture is below. **No percentage in §2 changed**: one defect was a scalar and the
other only ever affected claude-code.

**Defect 1 — luna was priced at the `:batch` rate.** `MODEL_PRICES` carried
`{in .10, cache .01, out .60}`, byte-identical to `openai/gpt-5.6-luna:batch`; the bench uses
the standard endpoint at `{in .20, cache .02, out 1.20}`. Correct when fetched 2026-08-04, stale
since. Verified against the provider's own billing, not its price list: a real request
(prompt 8524, cached 0, completion 159) was billed $0.002322 and cacheWrite 0.25 / cacheRead
0.02 / out 1.20 predicts $0.002322 — 0.009% match, with a second generation matching to 0.004%.
Plain input at 0.20 is off by 18.4%, so **the provider really does bill every uncached prompt
token as a cache write at 1.25x input, confirming D1 from the provider side.** A 2026-08-27
fresh-pool generation prices identically, so **every luna figure this bench published from at
least 2026-08-26 is half the real cost.** Exact scalar 2.0, so no ratio, interval or p-value
moves. Fixed in `6f7ba9d`.

**Defect 2 — claude-code's delegated spend was invisible.** Claude Code reaches luna through
OpenRouter's Anthropic skin, which writes an all-zero `usage` object into every SIDECHAIN
transcript. `instrumentationComplete` therefore goes false on all 61 subagent files and
`addSidechainCostsChecked` correctly nulls the row rather than under-count. Native delegates far
more than sweet (873 delegated requests against 213), so 43 of 60 native rows nulled against 9
of 60 sweet, and summing that column as zero inverted the comparison. But `message.id` in those
records is an **OpenRouter generation id**, and `/api/v1/generation` returns the billed cost.
`harness/reprice-openrouter-generations.mjs` recovers it: **4,827 of 4,827 ids resolved, zero
unresolved**, arm-symmetric by construction. Retroactive — 2026-08-26 ids still resolve. Fixed
in `11fca0f`.

**Reconciliation, which is what closes the question.**

| | |
|---|---:|
| harness reported, all three legs | $4.0898 |
| corrected (claude-code billed; opencode + codex at the fixed rate) | **$13.3142** |
| the account's cumulative usage across the run window | **$13.4330** |
| residual | $0.119 (**0.9%**) |

A 0.9% residual means opencode and codex capture is ~98% complete once the price is right, and
claude-code's subagent blindness was the *only* missing-instrumentation defect. Nothing else is
hiding.

### 2A.1 Native versus sweet, corrected

| harness | metric | native | sweet | sweet vs native |
|---|---|---:|---:|---|
| **opencode** | total cost | $1.3523 | $1.2902 | **sweet −4.6%** |
| | cost / rollout | $0.0225 | $0.0215 | sweet −4.6% |
| | cost / resolved rep | $0.0588 | $0.0717 | native better, −21.9% |
| | solved rollouts /60 | 23 | 18 | native +5 |
| | solved tasks /20 | 8 | 8 | tie |
| | tool calls | 1769 | 1368 | sweet −22.7% |
| **codex** | total cost | $1.7651 | $1.5471 | **sweet −12.3%**, %CI [+1.3%, +22.0%], p=0.029 |
| | cost / rollout | $0.0294 | $0.0258 | sweet −12.3% |
| | cost / resolved rep | $0.0883 | $0.0860 | sweet −2.6% |
| | solved rollouts /60 | 20 | 18 | native +2 |
| | solved tasks /20 | 8 | 8 | tie |
| | tool calls | 783 | 750 | sweet −4.2% |
| **claude-code** | total cost | $4.2411 | $3.1184 | **sweet −26.5%**, %CI [−46.9%, +0.6%] |
| | cost / rollout | $0.0707 | $0.0520 | sweet −26.5% |
| | cost / resolved rep | $0.2020 | $0.1417 | **sweet −29.8%** |
| | solved rollouts /60 | 21 | 22 | **sweet +1** |
| | solved tasks /20 | 8 | 8 | tie |
| | tool calls | 3378 | 1818 | **sweet −46.2%** |
| | mean wall | 4.0m | 3.2m | sweet −18.5% |
| **pooled** | total cost | $7.3585 | $5.9557 | sweet −19.1% |
| | solved rollouts /180 | 64 | 58 | native +6 |
| | cost / resolved rep | $0.1150 | $0.1027 | sweet −10.7% |

Pooling three harnesses is descriptive only — they are different populations and claude-code
carries 55% of the spend. Read the per-harness rows.

### 2A.2 How to read this, including against it

**Cost favours sweet on all three harnesses**, and the claude-code figure is the most
trustworthy number in the run because it is the provider's own bill rather than a
reconstruction. The mechanism is visible and consistent: **sweet issues 46.2% fewer tool calls
on claude-code** and native spends **40.2% of its cost on delegated subagents against sweet's
8.7%** — sweet answers with `ss-*` where native fans out into Task subagents.

**But solves do not move, and one cell is worse.** Task-level resolution is **8 of 20 in every
arm of every harness**. At rep level sweet is down 6 of 180. On opencode sweet solved 5 fewer
reps, so its **cost per resolved rep is 21.9% WORSE** even though total cost is lower — the one
row in this table that clearly favours native, and it should not be dropped when quoting the
rest.

**Only codex's interval excludes zero** (p=0.029, uncorrected for three harnesses).
Claude-code's −26.5% grazes zero at [−46.9%, +0.6%] on n=20 tasks, and its both-solved stratum
is −34.4% with a far wider interval.

**One caveat that could move the headline.** Native's claude-code cost advantage for sweet comes
substantially from native's subagent fan-out, and **F2 — the empty-`pages` repair aimed at
exactly that subagent traffic — failed its acceptance (§5)**. If fixing F2 changes how much
native delegates, this number moves. Root-cause F2 before quoting −26.5% anywhere.

This supports the registered headline of **efficiency at parity**: the same tasks get solved for
less money. It is not evidence that sweet solves more.

---

## 3. Stop rules — all four pass

| rule | verdict |
|---|---|
| 1 green ledger on the new fingerprint | PASS. Swept post-deploy: 20/20 `gold-valid`. Each leg's own preflight printed `20/20 selected tasks gold-FULL`. |
| 2 stale golden where a rebuild was needed | PASS. 7 rebuilt 2026-09-02, stamped, pushed checksum-verified. |
| 3 codex authentication dead | DOES NOT FIRE. The expired ChatGPT token is only read under `CODEX_SUBSCRIPTION=1`; the leg ran through OpenRouter and completed 120/120. |
| 4 >4 of 20 flagged by the trustworthy-verdict census | PASS, **2 of 20**: `getmoto__moto-6716` and `jensneuse__graphql-go-tools-174`, ALL-UNTRUSTED in both arms of all three legs. Consistent across harnesses, so it is a property of those two tasks, not of a leg. |

## 4. The overlap deviation cost nothing

The three legs were staggered 20 minutes apart and overlapped (§9A.3). **`exitReason` is
`model_stopped` for all 360 rollouts — zero timeouts, zero degeneration re-runs.** Wall medians
1.9 / 2.9 / 2.2 minutes, worst single rollout 14.4 minutes against a 30-minute hang guard. The
asymmetric-contention risk flagged before launch did not materialise and the solve column can be
read as it stands.

## 5. Fixes: what this run proves and what it disproves

**F4 works in production.** `rtInfra=0` across all 360 rollouts. The false `INFRA` label that
zeroed accenture's baseline diff is gone, and nothing else started classifying as infra.

**F5 works.** `rtTrustworthy` / `rtInfra` present on 120/120 rows in every leg
(345/302, 418/367, 315/273 launched/trustworthy). The per-cell census is now a one-line read
over `rows.json`, as designed.

**F1 works.** Every cost table prints `ledger basis: cache-write-1.25x-all-harnesses`, and the
legacy basis reproduces behind `--ledger-basis`.

**F2 FAILED its post-smoke acceptance, and this is the one thing to fix next.** The acceptance
was "subagent transcripts show no `Invalid pages parameter` on either arm". Measured on this
run's `agent-state` transcripts:

| | native main | native subagent | sweet main | sweet subagent |
|---|---:|---:|---:|---:|
| fresh pool 2026-08-26 (66 rollouts/arm) | 358 | 240 (33 transcripts) | 50 | 36 (11) |
| this run (60 rollouts/arm) | 294 | **334** (52 transcripts) | 42 | **12** (9) |

`buildClaudeCliArgs` does emit `--append-subagent-system-prompt` — that is code-verified and the
pinned 2.1.218 does register the flag. But the failures did not go away, and **the native/sweet
asymmetry F2 existed to remove is still there** (334 against 12 in subagents). Whether the note
is not reaching subagents or is reaching them and not changing behaviour cannot be settled from
the transcripts: they do not record the system prompt at all, in this run *or* in the fresh pool
where `--append-system-prompt` is known to work, so absence there proves nothing either way.
Root-cause it directly before the frozen run. Until then the `pages` defect still sits on the
arm that uses `Read` more, and it still flatters sweet.

Counting caveat: claude-code transcripts store each tool result twice, so these absolute counts
are likely doubled. Both runs were counted identically, so the comparison stands.

## 6. Still open

- **The `$0` adaptive-budgeting census (§8)** is pre-registered against these traces and has NOT
  been run. It is an analysis, not a lever, and it gates nothing.
- **F2 root cause** (§5), the one blocking item before the frozen run.
- The two owner decisions the previous session flagged: name-lock stamping plus a null-arm sweep
  over HO2's 7 vacuity flags, and whether `promptCacheTtl: "5m"` becomes a documentation
  recommendation.
- `DIAGNOSTIC INSTRUMENTATION INCOMPLETE` fires on 120/120 opencode and codex rows and 52/120
  claude-code rows, so the analyzer fails closed and reports no exclusion sensitivities. Raw
  untrimmed cost stays the sole headline, which is by design, but the attestation field is worth
  wiring so the sensitivity rows come back.

**Nothing here may be published as a sweet win.** Every fix in the batch is shared measurement
repair or sweet-only product correctness with a zero benchmark claim, and F2 in particular is
arm-symmetric by construction.
