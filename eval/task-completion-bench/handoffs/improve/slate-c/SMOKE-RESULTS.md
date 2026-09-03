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
