# c08 — adversarial verify, DIFFERENTIAL + MEASURABILITY lens

**Candidate:** "Put the guide inside claude-code's delegation path with an init-written
project agent definition" (rank 8; `candidates/DEDUP.md` c08; `candidates/real-user-product.md` RU-2).

**Verdict: REFUTED as a cost lever. Confidence 0.88.**
Cost of this study: `$0` (trace reading, `rows.json` arithmetic, static code reading, local
binary strings). Box scratch: `/tmp/wf-slatec/c08-measurability/`. Nothing written under
`results/`. No HO2 file opened. No grading log opened.

Tags: `[M]` measured with a named script or command, `[C]` read from code, `[W]` web with URL,
`[I]` inferred.

---

## 0. Conclusion first

The vehicle is clean but the number is not measurable. c08 passes both differential tests: the
vehicle is sweet-only, and the mechanism changes *which* requests happen rather than re-rendering
the same lines. It fails the measurability test on four independent counts, and one of them is
fatal on its own.

1. **The effect lives entirely inside rows the cost ledger refuses to price.** In
   `fp-claudecode-tab-20260826/rows.json`, the set of rollouts with a subagent and the set of
   rollouts with a null cost are **the same set, symmetric difference 0**, in both arms `[M]`.
   Nine of 66 sweet rollouts, 28 of 66 native. Every one carries
   `sidechainAccountingComplete: false` and `costSidechainUsd: null`. This is B18's killing fact,
   still literally true in the run c08 draws its evidence from. **c08's register check is wrong:
   B18's revival condition is not met.**
2. **The claimed effect is 12% of the free run-to-run variation in the very quantity it moves.**
   Sweet TAB, NONE and PIPE cost `$0.020727 / $0.019480 / $0.017761` per rollout, a spread of
   `$0.002966` `[M FRESH-POOL-RESULTS.md §2]`, and that document states the spread "tracks
   subagent spawn counts, not gutter tokens". The claimed effect is `$0.00035`.
3. **One extra delegation erases the whole saving.** A sweet subagent costs `$0.0169` on the tab
   run `[M, $0.185518 / 11]`. The re-priced net saving is about `$0.0199` across the whole arm.
   Sweet subagent launches across four claude-code runs were 11, 9, 7 and **0** `[M]`. The lever's
   sign is set by an integer that varies more between runs than the lever moves.
4. **The re-ingest term is under-priced 2.0 to 3.6 times.** Priced on the measured 231 Explore
   requests, the net lands at **0.3% to 1.5% of the claude-code sweet arm**, not 1.7% `[M]+[I]`.
   That straddles the candidate's own 1% kill line from below.

The lever is worth `$0.00` on codex and opencode `[M]`, the only two harnesses where sweet is
measured dearer. It cannot advance the workflow goal.

**Keep three things.** The `[C]` correction that Explore is not tool-starved is verified here and
is right. The config-file vehicle genuinely escapes the instruction-deafness kills. The
underlying defect is a real product-hygiene item, exactly as the originating study said.

---

## 1. Differential test: PASSES

**Is the vehicle sweet-only, or does it reach both arms?** Sweet-only.

`harness/claude-code-task-runner.mjs:310-316` `[C]`: the runner writes `CLAUDE.md` with
`{ sweet: false }` for **both** arms, then writes `.claude/rules/sweet-search.md` for the sweet
arm only. `injectedFiles` is `['CLAUDE.md']` plus, on sweet, `.claude/rules/sweet-search.md`. An
`init`-written `.claude/agents/Explore.md` would be a sweet-arm artifact in the bench and a
sweet-arm artifact in production. There is no shared-FRAME leak. c08's `sweet_only: yes` is correct.

**Does it change which requests happen, or re-render the same content?** It changes which requests
happen, so it is not the banned same-information class (`SLATE-A-UBER` §9.6, `SLATE-B-UBER` §8).
The measured target is 46 requests: 31 in the pre-first-`ss-*` phase and 15 whose every `ss-*` call
failed `[M forensics/claude-subagents.md §5]`. Those requests would stop existing. That is admissible.

**But the same change also adds mass to every surviving request**, and that half is mispriced.
See §3.

**Rule sweep.** No HO2 file opened or needed. No gold, task identity or hidden test is a runtime
input. No ranking signal is touched, so the `_isAgentFormat` gate does not apply. `new_tool: false`
is correct: nothing new is added to the `ss-*` surface. `needs_user_decision: Yes` is correctly
flagged, and it is the right flag, because the file overrides a first-party built-in agent by name
in every user's project. **No hard rule violation found.**

---

## 2. Measurability test: FAILS

### 2.1 Every rollout the lever touches is null in the ledger

Script: `/tmp/wf-slatec/c08-measurability/c08_nulls.mjs`, run on the box against
`results/fp-claudecode-tab-20260826/rows.json` `[M]`.

| arm | rows | null `costRealizedUsd` | `sidechainTurns > 0` | symmetric difference |
|---|---:|---:|---:|---:|
| sweet | 66 | 9 | 9 | **0** |
| native | 66 | 28 | 28 | **0** |

All 37 of those rows carry `sidechainAccountingComplete: false`, `costSidechainUsd: null`,
`idealCostUsd: null` and `breakPricedCostUsd: null`. The 57 sweet rows that *are* priced all carry
`costSidechainUsd: 0.000000` — they had no subagent at all.

So the published cost column prices **zero** of the rollouts in which c08's mechanism can act.
The `$0.020727` headline comes from a hand reconstruction outside the ledger
(`FRESH-POOL-RESULTS.md` §2: "Claude-code cost is the transcript reconstruction, never the
ledger"), and that reconstruction is itself labelled a lower bound.

**Consequence for the register check.** c08 claims it "meets B18's own revival condition
(re-score on-ledger, exposure 38/44)". B18's killing fact is: *"at measurement time the subagent
segment was off-ledger, so a richer brief could not move the published number at all"*
(`register/DEAD-LEVER-REGISTER.md:96`). That fact is unchanged in `fp-claudecode-tab-20260826`.
G1b ("subagent spend excluded from the cost ledger — SHIPPED", `register:217`) refers to the
manual reconstruction in `FRESH-POOL-RESULTS.md` §2, not to a non-null `costSidechainUsd` column.
**The revival condition is not met.**

### 2.2 Three reconstructions of the same segment disagree by six times the effect

The sweet TAB sidechain total has three published values, all `[M]`:

| source | sweet TAB sidechain | per rollout |
|---|---:|---:|
| `FRESH-POOL-RESULTS.md` §2 (realized, reconstructed) | `$0.185518` | `$0.002811` |
| `forensics/claude-subagents.md` §6.3 (ideal, recorded only) | `$0.1977` | `$0.002995` |
| `forensics/claude-subagents.md` §6.3 (ideal, neighbour-imputed) | `$0.3281` | `$0.004971` |

Band = `$0.1426` = **`$0.002161` per rollout**. The claimed effect is `$0.00035` per rollout.
**The accounting uncertainty on the segment is 6.2 times the effect.** 45.3% of sweet subagent
requests carry no usage record at all `[M forensics §6.3]`, so this band is not a rounding
artefact; it is the honest width of the quantity.

### 2.3 The effect is far below the per-rollout noise the brief itself states

Script: `/tmp/wf-slatec/c08-measurability/c08_noise.mjs` `[M]`. Sweet arm,
`fp-claudecode-tab-20260826`, the 57 priceable rows:

| statistic | value |
|---|---:|
| mean `costRealizedUsd` per rollout | `$0.015127` |
| standard deviation per rollout | `$0.011330` |
| standard error of the 57-rollout mean | `$0.001501` |
| within-task pooled standard deviation across reps (19 tasks, df 35) | `$0.005947` |

The claimed effect of `$0.00035` per rollout is 0.031 rollout standard deviations, 0.23 standard
errors of the arm mean, and 0.059 of the rep-to-rep noise on a fixed task. The brief's own stated
resolution is "cost intervals of about ±$0.001-0.005 per rollout": the effect is **2.9 to 14 times
smaller than the lower edge of that interval**.

### 2.4 The run-to-run spread on the same quantity is eight times the effect

`FRESH-POOL-RESULTS.md` §2 `[M]`, three sweet forms on the same 22 tasks × 3 reps, differing only
in a gutter delimiter that C3/C4 already proved is not a cost lever:

| form | sweet `$`/rollout | vs native `$0.021558` | sweet subagents |
|---|---:|---:|---:|
| TAB | `$0.020727` | −3.9% | 11 |
| NONE | `$0.019480` | −9.6% | 9 |
| PIPE | `$0.017761` | −17.6% | 7 |

Spread `$0.002966` per rollout. `$0.00035 / $0.002966 = 11.8%`. The source document names the
cause: "the claude-code cost differences between forms are a delegation coin flip". c08 proposes
to move the coin-flip term by one eighth of the coin flip.

### 2.5 One extra delegation erases the saving

Per-subagent sidechain cost `[M, derived from the table above]`: TAB `$0.185518 / 11 = $0.016865`;
NONE `$0.122539 / 9 = $0.013615`; PIPE `$0.116536 / 7 = $0.016648`. Take `$0.0169`.

The re-priced net saving (§3) is about `$0.000302` per rollout = **`$0.0199` across the 66-rollout
arm**. One additional subagent launch costs `$0.0169`, which is **85% of the entire net**. Two
launches make the lever negative.

Observed sweet subagent launches, four claude-code runs `[M, box one-liner over
`agent-state/*-sweet/**/subagents/agent-*.jsonl` and `subagent_type` in the parent transcripts]`:

| run | rollouts | sweet subagents | Explore | general-purpose |
|---|---:|---:|---:|---:|
| `fp-claudecode-tab-20260826` | 66 | 11 | 8 | 3 |
| `fp-claudecode-none-20260826` | 66 | 9 | 7 | 2 |
| `fp-claudecode-pipe-20260826` | 66 | 7 | 6 | 1 |
| `rb-claudecode-20260824` | 39 | **0** | 0 | 0 |

The launch count varies by 4 across three runs of the identical pool, and by 11 against the
adjacent pool. A lever whose net is worth 1.2 launches cannot be read off a count that swings by 4.

---

## 3. Re-pricing: the re-ingest term is 2.0 to 3.6 times larger than claimed

**Measured base.** Script `/tmp/wf-slatec/c08-measurability/c08_explore.mjs` `[M]`. The 8 sweet
`Explore` subagents in `fp-claudecode-tab-20260826` issued **231 requests**
(14, 11, 15, 58, 34, 54, 30, 15), matching `forensics §2.1`.

**Tokens the override adds to every one of those requests.** A user-authored agent loads the whole
CLAUDE.md hierarchy; the built-in `Explore` skips it `[W https://code.claude.com/docs/en/sub-agents]`.
Verified in the shipped binary: `O0={agentType:"Explore", disallowedTools:[...], source:"built-in",
model:"inherit", omitClaudeMd:!0, ...}` `[C /Users/admin/.local/share/claude/versions/2.1.258,
`strings` match on `omitClaudeMd`]`. So the addition is the guide (**+1,516 tokens**, measured as
the sweet-minus-native delta on general-purpose subagents `[M forensics §2.2]`) plus the inherited
`CLAUDE.md` frame (**about 754 tokens** `[C]`) = **2,270 tokens**. If the agent body *also* carries
the guide, as c08's own frontmatter says ("the guide as prompt"), add another 1,457 = **3,727 tokens**.

**Price.** First request of each subagent is ingest at `$0.10/M`; the rest are cache reads at
`$0.01/M`. Assume the lever removes its 46 target requests, so 185 to 204 requests survive `[I]`.

| shape | tokens added per request | arm total | per rollout |
|---|---:|---:|---:|
| inheritance only (no guide in the body) | 2,270 | `$0.005834` | `$0.0000884` |
| c08 as written (guide in the body **and** inherited) | 3,727 | `$0.010287` | `$0.0001559` |
| **c08's stated figure** | — | `$0.002884` | `$0.0000437` |

**Under-priced by 2.0× to 3.6×.** c08 appears to have charged the guide at the cache rate only and
to have omitted the inherited `CLAUDE.md` hierarchy, which is the mechanism's whole point.

**Saving.** c08 takes the full `$0.00039`. That number is a **union upper bound** on one run
(`forensics §5` says "at most" three times); pooled over the three forms it is **1.56%**, not
2.0%. And guided subagents do not reach zero failure: the three subagents that had the guide still
failed **5.9%** of `ss-*` calls against 14.0% guide-less `[M forensics §2.1]`, so the realistic
saving floor is 58% of the gross.

**Net, re-priced:**

| case | saving/rollout | added mass/rollout | net/rollout | % of `$0.020727` |
|---|---:|---:|---:|---:|
| best (gross saving, inheritance only) | `$0.00039` | `$0.0000884` | `$0.000302` | **1.46%** |
| worst (guided floor, guide in body too) | `$0.000226` | `$0.0001559` | `$0.0000703` | **0.34%** |

**Range 0.3% to 1.5%. The headline −1.7% is not reachable under any pricing I can construct.**
The candidate's own kill line is 1%; the range straddles it.

---

## 4. The `$0` falsifier and the kill conditions

| item as written | assessment |
|---|---|
| "Passed: Explore share ≥ half (86.4%)" | **Wrong denominator, and self-passing.** 38/44 pools both arms; 30 of the 38 Explore launches are native's `[M]` and the lever cannot reach them. Sweet-only: **8 of 11 launches = 72.7%**, **8 launches in 66 rollouts = 0.121 per rollout**, 6 of 22 task-cells. A falsifier that can pass on the other arm's behaviour is not a falsifier. |
| "confirm via `/agents` that the project `Explore.md` is active" | **Real, cheap, and not done.** `forensics §10` lists it as unfinished. I confirmed `omitClaudeMd:!0` and the `disallowedTools` deny list on the built-in `Explore` in 2.1.258 `[C]`, but I could **not** confirm override-by-name from the binary at `$0`. Shape A's premise is still unverified. |
| kill: "dilution under 1% of arm (measured 2.0%)" | **Cannot kill.** It is evaluated on a number already in hand, and c08 quotes the largest of three available values (2.0% tab union bound; 1.56% pooled; both are upper bounds, not estimates). Re-priced against the added mass, the net is 0.3%-1.5%, so this condition *fires* on the honest figure. |
| kill: "Shape A dead if a project file cannot override built-in Explore" | Real and binary, but untested (row above). |
| kill: "live: Explore `ss-*` failure rate not below 8% with guide present" | **Needs a paid run, and can return zero data.** Sweet delegated 0 times in 39 rollouts on `rb-claudecode-20260824` `[M]`. On an adjacent pool the falsifier yields an empty denominator. |

---

## 5. Two measurement traps the synthesis must carry

### 5.1 The evidence predates a shipped fix

The 14.0% `Explore` failure rate is from `fp-*` (2026-08-26/27). Commit `36b802e` (2026-08-28)
shipped the `ss-*` wrapper hygiene package, whose own message says "ss-* wrapper hygiene (~2% of
sweet cost on the bench)" and which added `absorbPositionalPaths` to `_ss-argparse.mjs` with 5 new
tests `[C git show 36b802e]`. The argparse comment now reads: "rejecting the whole call wastes a
turn when the token is unambiguously a path" `[C _ss-argparse.mjs:255-258]`. That directly removes
the **"extra positional path not consumed"** class, which is **8 of the 36 measured subagent
failures (22%)** `[M forensics §2.1]`. `forensics §2.1` says the same in its own words. The
register's trap list says: never pool runs across a shipped fix. At least a fifth of the failure
signal c08 prices is already gone in production and would not appear in the next paid run.

### 5.2 On the bench, the override hands one arm the benchmark frame

`CLAUDE.md` in the rundir is written with `{ sweet: false }` and carries `FRAME_OPEN` +
`FRAME_CLOSE` `[C agent-runner-shared.mjs:250; claude-code-task-runner.mjs:310]`. That text is the
benchmark's **authoritative task-completion rules**, including the `run_tests` protocol and the
stop rule `[C codex-task-runner.mjs:116-119]`. A custom project `Explore` inherits the CLAUDE.md
hierarchy `[W sub-agents]`; the built-in one does not. So on the bench, Shape A gives the sweet
arm's `Explore` subagents the benchmark's completion rules while native's `Explore` subagents keep
skipping them. Any measured result would mix the product claim (the guide reaches subagents) with a
bench artefact (the frame reaches one arm's subagents only). Removing the confound needs
`--append-subagent-system-prompt` carrying the frame on **both** arms — a shared harness setting
with zero differential (`forensics §7 M2(b)`). This conflicts with the standing rule that
bench-specific content must frame both arms.

Minor guard: `gitDiffPatch` excludes `.sweet-search`, `CLAUDE.md`, `AGENTS.md` and
`.claude/rules/sweet-search.md`, but not `.claude/agents/` `[C agent-runner-shared.mjs:263-275]`.
An untracked new file does not appear in `git diff HEAD`, so the risk is small, but the exclusion
list should be extended before any run.

---

## 6. Solve, the veto

c08 claims no solve gain, and the record supports that claim being the ceiling, not a floor.
Sweet's nine delegations changed **0 of 6 task outcomes** and cost 2.5 to 4.5 times their
non-delegating sibling reps on the solved tasks `[M forensics §4]`. The lever can touch at most
**9 of 66 rollouts (13.6%)** on the tab run and **0 of 39** on the rebaseline pool `[M]`. The
pre-registered solve bar is ±6 of 66, so a solve effect would need 6 of those 9 rollouts to flip —
two thirds of every delegating rollout — before it could be read at all. Shape A replaces a
first-party exploration prompt with a search policy; c08 calls that risk real and prices it at zero.

---

## 7. Numbers the synthesis must adopt

1. Exposure is **8 sweet `Explore` launches in 66 rollouts (0.121 per rollout), 6 of 22 task-cells**,
   not "38/44 = 86.4%". The 86.4% pools both arms and 30 of the 38 are native's `[M]`.
2. Net ceiling is **0.3% to 1.5% of the claude-code sweet arm** (`$0.00007` to `$0.00030` per
   rollout), not −1.7% `[M]+[I]`.
3. Re-ingest is **`$0.0000884` to `$0.0001559` per rollout**, not `$0.0000437` `[M]+[I]`.
4. Dilution is an **upper bound**: 2.0% on the tab run, **1.56% pooled over the three forms** `[M]`.
5. **B18's revival condition is not met**: subagent spend is still off the ledger column; every
   delegating rollout is null in `rows.json` `[M]`.
6. Codex and opencode: **`$0.00`**, no delegation at all in 264 fresh-pool rollouts `[M forensics §6.5]`.
7. The exemplar tool counts are wrong. `agent-a8d5f1d037a62e83b.jsonl` made **57 Bash calls, all
   57 of them `ss-*`**, plus 15 `Read` and 1 `SendMessage` `[M, box recount by de-duplicated
   `tool_use` block id]`. The stated ranges "Bash 14-61 and `ss-*` 25-95" are impossible: every
   `ss-*` call *is* a Bash call, so `ss-*` can never exceed Bash. The true per-subagent `ss-*`
   range across the 11 sweet subagents is **5 to 59** `[M forensics §2.1]`.
8. The `[C]` correction stands and should be kept verbatim: built-in `Explore` is defined with
   `omitClaudeMd:!0` and a `disallowedTools` deny list, with **no positive tool allowlist**
   `[C 2.1.258]`. It is not tool-starved. The gap is memory inheritance only.

## 8. Disposition

Not a cost lever. Keep it as **product hygiene**, which is where the originating study put it:
`forensics/claude-subagents.md` §7 M1 says "treat M1 as hygiene, not a cost lever". Pair it with
M3 (worktree-aware project-root resolution) and M4 (`--help` exits 0), which fix real defects at
the same place for less build cost and without overriding a first-party agent name.

## 9. What I could not finish

- I could not confirm at `$0` that a project `.claude/agents/Explore.md` overrides the built-in
  `Explore` by name. The 2.1.258 binary shows `activeAgents` and a `source` field, but I did not
  isolate the precedence merge, and running `/agents` needs an interactive session.
- I did not price the `Read` and raw-shell calls a guide-less `Explore` makes after its first
  working `ss-*` call, so the gross saving could be slightly larger than `$0.00039`. It would have
  to grow about 5 times before the effect cleared §2.3's noise floor.
- I did not verify how much of the "`--in` not accepted by `ss-trace`/`ss-find`" class (7 of 36
  failures) survives commit `36b802e`. `ss-trace` documents `--in` in its usage line `[C]`.

## Appendix. Exact paths, scripts and commands

- Box runs (read-only): `/root/sweet-search-private/eval/task-completion-bench/results/{fp-claudecode-tab-20260826,fp-claudecode-none-20260826,fp-claudecode-pipe-20260826,rb-claudecode-20260824,fixval-claude-code-20260828}`.
- My scripts (box copies under `/tmp/wf-slatec/c08-measurability/`, sources in this session's
  scratchpad): `c08_noise.mjs` (per-rollout cost mean/SD/SE, within-task pooled SD, null census),
  `c08_nulls.mjs` (null-cost versus delegating symmetric difference, per-row dump),
  `c08_explore.mjs` (per-subagent request and token census), `c08_exposure.mjs` (subagent counts).
- Box one-liner for subagent types:
  `grep -oh '"subagent_type":"[A-Za-z-]*"' <run>/agent-state/*-<arm>/claude-home/projects/*/*.jsonl | sort | uniq -c`.
- Exemplar recount: `.../fp-claudecode-tab-20260826/agent-state/bfgroup__b2-259-sweet/claude-home/projects/-root--ss-eval-runs-r0-52/dd934da6-fca2-4064-b8ac-575ab624dc05/subagents/agent-a8d5f1d037a62e83b.jsonl`.
- Local docs read: `slate-c/BRIEF.md`, `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`,
  `slate-c/register/DEAD-LEVER-REGISTER.md` (rows B16-B19, F15, G1b, G6),
  `slate-c/forensics/claude-subagents.md` (whole file), `slate-c/candidates/DEDUP.md` (c08),
  `slate-c/candidates/real-user-product.md` (RU-2), `slate-c/verify/c08-history.md`,
  `FRESH-POOL-RESULTS.md` §1-§3.
- Local code read: `harness/claude-code-task-runner.mjs:1-120,294-330`;
  `harness/agent-runner-shared.mjs:246-275`; `harness/codex-task-runner.mjs:116-119`;
  `eval/agent-read-workflows/bin/_ss-argparse.mjs:82-95,185-260`;
  `eval/agent-read-workflows/bin/ss-trace:4`; `git show 36b802e --stat` and its message.
- Local binary read: `/Users/admin/.local/share/claude/versions/2.1.258` (`strings -a`, matches on
  `omitClaudeMd`, `source:"built-in"`, `activeAgents`). Reported version `2.1.258 (Claude Code)`.
- Web: `https://code.claude.com/docs/en/sub-agents` (CLAUDE.md hierarchy loading; Explore and Plan
  skip it; override by name), cited via `forensics/claude-subagents.md` §2.2 and §7.
