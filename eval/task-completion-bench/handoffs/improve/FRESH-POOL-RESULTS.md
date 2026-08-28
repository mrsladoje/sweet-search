# Fresh-rotation gutter run — full report

**Executes:** [`FRESH-ROTATION-PREREGISTRATION.md`](./FRESH-ROTATION-PREREGISTRATION.md) and
its Amendment 1, both committed before any rollout.
**891 rollouts, `$6.9`.** 22 unselected tasks × 3 reps × (3 sweet gutter forms + native) ×
3 harnesses, plus a 99-rollout repair pass. Ledger `fresh-pool-v4`, gold re-swept under the
current config. **Every denominator is complete.**

---

## 0. Verdict

**The gutter delimiter is not a lever. Three forms, three harnesses, 198 rollouts per form —
they land within 2 rollouts of each other and every harness ranks them differently. And sweet
is at parity with native on tasks nobody selected.**

**Keep `N<TAB>`.** Not because it wins — nothing wins — but because it is the cheapest
numbered form, it is the only form with a demonstrated mechanism anywhere, and changing it
would mean shipping a `p = 0.72` result.

## 1. Resolution and price together

22 unselected tasks × 3 reps = 66 rollouts per cell. Every denominator complete.
Claude-code cost is the **transcript reconstruction**, never the ledger (see §2).

| harness | form | solved | rate | `$`/rollout | cell total | vs native |
|---|---|---:|---:|---:|---:|---:|
| codex | native | 41/66 | 62.1% | `$0.012287` | `$0.8110` | — |
| codex | **TAB** | 39/66 | 59.1% | `$0.012330` | `$0.8138` | `+0.3%` |
| codex | NONE | 41/66 | 62.1% | `$0.012319` | `$0.8131` | `+0.3%` |
| codex | PIPE | 42/66 | 63.6% | `$0.012754` | `$0.8418` | **`+3.8%`** |
| opencode | native | 41/66 | 62.1% | `$0.008968` | `$0.5919` | — |
| opencode | **TAB** | 41/66 | 62.1% | `$0.009265` | `$0.6115` | `+3.3%` |
| opencode | NONE | 39/66 | 59.1% | `$0.008584` | `$0.5665` | `−4.3%` |
| opencode | PIPE | 38/66 | 57.6% | `$0.008764` | `$0.5784` | `−2.3%` |
| claude-code | native | 43/66 | 65.2% | `$0.021558` | `$1.4228` | — |
| claude-code | **TAB** | 40/66 | 60.6% | `$0.020727` | `$1.3680` | `−3.9%` |
| claude-code | NONE | 41/66 | 62.1% | `$0.019480` | `$1.2857` | `−9.6%` |
| claude-code | PIPE | 39/66 | 59.1% | `$0.017761` | `$1.1722` | `−17.6%` |

**Totals across the three harnesses:** native **125/198**, TAB **120/198**, NONE **121/198**,
PIPE **119/198**.

**Each harness ranks the forms differently** — codex prefers PIPE, opencode TAB, claude-code
NONE. That is what noise looks like sliced three ways. Every pairwise Fisher test is
`p ≥ 0.72` against a pre-registered bar of **≥ +6 rollouts**; the largest observed difference
is 3.

**Reading the price column honestly.** The only cost difference with a mechanism behind it is
codex `PIPE` at **`+3.8%`** — pipe is ~0.9 tokens per line dearer than tab, and at n=66 that
shows where resolution differences do not. Opencode's `NONE` looks `−4.3%` cheaper but also
solves 2 fewer; claude-code's `PIPE` looks `−17.6%` cheaper but that tracks **subagent spawn
counts, not gutter tokens** (§2). Cheaper-and-worse is not a saving.

**Cost per solved task is deliberately not in this table.** The pre-registration forbids it
unless solve counts differ by ≥6, and they differ by at most 3. Dividing a flat numerator by a
noisy denominator is exactly what made every earlier cost-per-solved figure flip sign.

## 2. Claude-code cost had to be reconstructed, and the ledger reads backwards

**The published column cannot be summed.** 28 of 66 native rollouts and 9 sweet ones carry
`null` inclusive cost, because a delegated (subagent) transcript was incomplete. Subagent use
is arm-asymmetric — native delegated in 15 task-cells against sweet's 6 — so summing nulls as
`$0` undercharges native on exactly its dearest rollouts.

| | ledger as published | main (rebuilt) | sidechain | **true total** | `$`/rollout |
|---|---:|---:|---:|---:|---:|
| native | `$0.386325` | `$1.130494` | `$0.292341` | **`$1.422835`** | `$0.021558` |
| sweet TAB | `$0.862258` | `$1.182496` | `$0.185518` | **`$1.368014`** | `$0.020727` |
| sweet NONE | `$0.781220` | `$1.163153` | `$0.122539` | **`$1.285692`** | `$0.019480` |
| sweet PIPE | `$0.795297` | `$1.055723` | `$0.116536` | **`$1.172259`** | `$0.017761` |

**Summing the ledger naively says sweet is `+123.2%` more expensive. The truth is `−3.9%`.**
A 127-point sign flip, from a column behaving exactly as designed — it refuses to publish a
number rather than undercharge, and a careless reader turns that refusal into `$0`.

**Two caveats on these figures, both against sweet's favour and stated for that reason.**
The reconstruction is a **lower bound**: 205 native delegated requests carry no usage record
at all (against 165/74/106 for the sweet forms), so **native's true cost is higher than shown**
and sweet's advantage is understated. And the spread across sweet forms (`−3.9%` to `−17.6%`)
tracks **subagent spawn counts** (6, 6, 2 cells), not gutter tokens — **the claude-code cost
differences between forms are a delegation coin flip and must not be read as a delimiter
effect.**

## 3. Efficiency: the one place sweet is unambiguously ahead

Tool calls per rollout, sweet TAB against native:

| harness | native | sweet | delta |
|---|---:|---:|---:|
| codex | 11.6 | 12.5 | +8% |
| opencode | 25.2 | 21.8 | **−13%** |
| claude-code | 41.8 | 29.9 | **−28%** |

On claude-code sweet reaches the same 14/22 tasks on **30% fewer calls**, and `NONE` cuts that
further to 26.5 (−37% vs native). Codex is the exception because it packs several shell
operations into one envelope, so its counts are not comparable to the others.

## 4. Why the old `−10%` cost lead disappeared — it was never a fix that broke

Decomposing codex old (13 rotation tasks) against new (22 fresh tasks), per call:

| | old | new | change |
|---|---|---|---|
| native `sed -n` | 3.3× @ **11,500B** | 5.5× @ **7,806B** | **−32%/call** |
| native `grep/rg` | 1.2× @ **12,767B** | 1.3× @ **4,741B** | **−63%/call** |
| sweet `ss-read` | 2.6× @ 5,783B | 3.8× @ **6,091B** | +5% |
| sweet `ss-search` | 1.2× @ 7,116B | 1.5× @ **7,362B** | +3% |

**On harder tasks the model narrows its own reads by a third to two thirds. Sweet's per-call
output is budget-governed and stays flat.** Sweet still returns 18% fewer total tool bytes
(57k vs 70k per rollout) — it simply no longer returns *dramatically smaller calls*, which is
where `−10%` came from. The advantage was real and **pool-dependent**, measured where it looked
best.

**That points at the only cost lever this run surfaced: adaptive output budgeting.** Native
behaves as if it has a *context* budget; sweet behaves as if it has a *per-call* budget.

## 5. Corrections to earlier claims in this programme

1. **The per-harness delimiter recommendation is withdrawn.** I proposed shipping `N| ` to
   codex and opencode on a six-task result. At proper power that is **−3 rollouts on opencode**
   and **+3.4% cost on codex**.
2. **"`NONE` everywhere" is also withdrawn** — it is the *worst* form on opencode.
3. **The cross-harness census never counted codex edits.** Its codex branch had no edit
   detection, so "codex 0/0 edits, `apply_patch` has no string anchor" was the instrument not
   looking. Codex does fail edits at a comparable rate.
4. **The `+3` was never significance-tested.** It reproduced at `+3` on codex and is
   `p = 0.72`. Two harnesses landing the same way is not replication.
5. **My pool screen omitted run-pilot's own selection gate**, which rejects 7 of the original
   25 tasks as build repairs or naming lotteries.

## 6. Measurement defects found and their status

| defect | status |
|---|---|
| `opencode --version` preflight race deletes rollouts at `CONCURRENCY=2` | **diagnosed**; 18 losses, all sweet-side; repaired at `CONCURRENCY=1` (0 missing of 99). Needs retry-with-backoff — a preflight probe must never delete a rollout |
| claude-code inclusive cost nulls, arm-asymmetric | **fixed** (`ab0824d`): labelled lower bound + missing-request count now published on both paths |
| `ss-search`/`ss-find`/`ss-semantic` emitted code **raw** while `ss-read` numbered | **fixed** (`ba5b4ee`): 27–36% of delivered code lines were unnumbered; all surfaces now share `numberCodeLines` |
| reading `rows.json` before grading completes | procedural; every cell now prints missing + ungraded counts before any solve number is read |

**The repair is the proof the bias was real:** the same 11 tasks lost 3 rollouts at
concurrency 2 and **0 of 33** at concurrency 1. Uncorrected, opencode's `NONE` arm read
**61.4%**; repaired it reads **59.1%** and drops from best form to second-worst. The arm with
the most losses had the easiest surviving subset, exactly as suspected.

## 7. Disposition

- **Ship nothing on the delimiter.** Keep `N<TAB>`.
- **Keep the surface fix** (`ba5b4ee`) — it removes a real inconsistency (two formats for one
  job) and is measured neutral on resolution.
- **The honest product claim is efficiency, not cost or resolution:** parity on solves, 13–28%
  fewer tool calls on the two harnesses where calls are comparable.
- **The next cost lever, if there is one, is adaptive output budgeting** — §5 is the first
  mechanism with measured support in weeks.

---

# Appendix A — the full agentic traces, and how to read them

Every rollout in this run is retained end to end: prompts, every tool call with its full
input, every tool result untruncated, model messages, per-turn token usage, the final patch,
and the grader log. **4.1 GB across 12 run directories.** Nothing was sampled or summarised.

## A.1 Where

**Box:** `root@167.233.69.121` (ssh key configured).
**Base:** `/root/sweet-search-private/eval/task-completion-bench/results/<RUN_ID>/`

| RUN_ID | harness | arms | gutter form |
|---|---|---|---|
| `fp-codex-tab-20260826` | codex | sweet + native | `N<TAB>` |
| `fp-codex-none-20260826` | codex | sweet | no gutter |
| `fp-codex-pipe-20260826` | codex | sweet | `N\| ` |
| `fp-opencode-tab-20260826` | opencode | sweet + native | `N<TAB>` |
| `fp-opencode-none-20260826` | opencode | sweet | no gutter |
| `fp-opencode-pipe-20260826` | opencode | sweet | `N\| ` |
| `fp-claudecode-tab-20260826` | claude-code | sweet + native | `N<TAB>` |
| `fp-claudecode-none-20260826` | claude-code | sweet | no gutter |
| `fp-claudecode-pipe-20260826` | claude-code | sweet | `N\| ` |
| `rp-oc-tab-20260827` | opencode | sweet | `N<TAB>` — **repair pass**, `CONCURRENCY=1` |
| `rp-oc-none-20260827` | opencode | sweet | no gutter — repair pass |
| `rp-oc-pipe-20260827` | opencode | sweet | `N\| ` — repair pass |

**The task pool** (22 ids) is `/root/fresh-run/pool.txt`; the 11 tasks the repair replaced are
`/root/fresh-run/repair-tasks.txt`. The ledger is `/root/env-ledger/fresh-pool-v4/ledger.jsonl`.

## A.2 What is in a run directory

| path | contents |
|---|---|
| `rows.json` | one record per rollout: outcome, `resolved`, `f2pFrac`, calls, `toolCounts`, usage, every cost column, `rolloutFile`, `turnsFile`, `stepsToFirstEdit`, escape audit |
| `agent-state/<task>-<arm>/` | the raw agent transcripts — format differs per harness, see A.3 |
| `turns/<task>-<arm>.jsonl` | per-turn `{t, in, cached, cacheWrite, out}` + a `meta` line with the price. **Written once per (task,arm): with 3 reps the last rep overwrites the others.** To price a specific rep, rebuild from its own transcript |
| `<arm>/patches.json`, `<arm>/rep-N/patches.json` | the final `model_patch` per task, per rep |
| `preds-<arm>.jsonl` | rep-0 predictions (back-compat) |
| `<arm>/logs/<task>_log.txt`, `<arm>/rep-N/logs/` | **grader output — contains hidden-test expectations. Never read these for anything blind.** |
| `trajectories/` | condensed view. Results truncate at 600 chars and inputs at 200 — **never infer absence from a trajectory** |
| `rt-dedup/<task>-<arm>.jsonl` | repeat-`run_tests` audit |

## A.3 Trace formats — they differ per harness, and one changed mid-programme

**codex** — `agent-state/<task>-<arm>/codex-home/sessions/YYYY/MM/DD/rollout-*.jsonl`

**CRITICAL:** on the OpenRouter path (every run in this document) codex emits
`function_call` / `function_call_output` records, with the command in `payload.arguments`
as JSON (`{"cmd": "...", "workdir": ..., "yield_time_ms": ..., "max_output_tokens": ...}`).
The **older 2026-08-11 runs on the OpenAI path emitted `custom_tool_call` /
`custom_tool_call_output` with the command inside `payload.input`.** A parser written for
one shape silently reports **zero tool calls** on the other — this cost a previous analysis a
false finding ("codex never produces an edit"). Handle both. Turn boundaries are
`token_count` records carrying `payload.info.last_token_usage`. Reasoning is encrypted.

**opencode** — `agent-state/<task>-<arm>/opencode-retained/session-*/attempt-1.stdout.ndjson`
Records: `{type:"tool_use", part:{tool, callID, state:{input, output, status}}}`,
`{type:"text"}`, `{type:"step_finish", part:{tokens}}` (= turn boundary).
**The editor tool is `apply_patch` with a `patchText` field — not `edit`/`write`.**

**claude-code** — `agent-state/<task>-<arm>/claude-home/projects/<slug>/<sessionId>.jsonl`
Sub-agent transcripts: `.../<sessionId>/subagents/agent-*.jsonl`.
The same assistant message is streamed repeatedly, each copy growing — **dedupe by BLOCK
(`tool_use.id`, `tool_result.tool_use_id`), never by record**, or late-arriving tool_use
blocks are lost. A turn is one assistant message id, counting only usage-bearing ids.

## A.4 The reader

`/root/dump-trace.mjs` renders any rollout fully. Local copy:
`eval/task-completion-bench/handoffs/improve/dump-trace.mjs`. Default `--max-result 0` means
untruncated.

```bash
ssh root@167.233.69.121
cd /root
node dump-trace.mjs --list
node dump-trace.mjs aio-libs__aiohttp-8038 sweet --harness codex
node dump-trace.mjs devlooped__moq-1262 native --harness claude-code --subagents
node dump-trace.mjs bfgroup__b2-113 sweet --harness opencode --tools-only --max-result 800
```

**Its `RUNS` map is hardcoded to the 2026-08-11 runs** — edit it to point at the `fp-*` /
`rp-*` ids above, or copy the per-harness parsers out of it.

## A.5 Analysis scripts already written against these traces

All under `eval/task-completion-bench/handoffs/improve/phase1-scripts/`:

| script | what it does |
|---|---|
| `gutter-cross-report.mjs` | three-form comparison + gutter census + anchor failures. **Its codex branch has no edit detection — fix before reusing** |
| `w0-p7-addressability.mjs` | per-harness trace normalisation, turn indexing, cost split at a checkpoint. The most complete multi-harness parser here |
| `w0-p7-discriminability.mjs` | parses the uniform `[run_tests verdict] status=… scope=…` line |
| `p2-residue-gate.mjs` | applies a rollout's patch to its golden and greps for residue |
| `vacuity-prescreen.mjs`, `name-lock-census.mjs` | the `$0` task screens used to build this pool |
| `rebaseline-report.mjs`, `gutter-ab-report.mjs` | solve matrices with Fisher tests and sign tests |

## A.6 Traps that have each cost a wrong conclusion in this programme

1. **Grading runs AFTER the last rollout.** Until the pilot exits, every `resolved` is
   `undefined`. Reading `rows.json` early reports **0 solved including controls**. Check
   `rows.filter(r => r.resolved == null).length === 0` first.
2. **Claude-code cost cannot be summed from `rows.json`.** 28 of 66 native rollouts here carry
   `null` inclusive cost and only 9 sweet ones do; nulls-as-zero gives **sweet +123.2%** where
   the truth is **−3.9%**. Use `costRealizedLowerBoundUsd` (added `ab0824d`) or rebuild from
   transcripts with `turnsFromTranscriptFile` + `costFromTurns`.
3. **`turns/` holds only the last rep.** Rebuild per-rep usage from each rep's own transcript.
4. **`toolCounts.edit` is not ground truth.** It reads 0 on codex, which packs `apply_patch`
   inside `exec`. Use a non-empty `model_patch` to prove the checkout was mutated.
5. **A cell may hold more transcripts than reps** — a retry leaves an extra. Taking the 3
   dearest per cell is the convention used here.
6. **`pgrep -f <pattern>` matches its own shell.** Use `pgrep -f "[p]attern"`.
7. **Trajectories truncate.** Absence in `trajectories/` is not absence in the trace.
8. **`opencode --version` preflight races at `CONCURRENCY=2`** and deletes rollouts silently —
   18 of them here, all on the sweet arm. Run opencode at `CONCURRENCY=1` until that probe
   retries.

## A.7 Environment to reproduce a run

```
export DOCKER_HOST=unix:///var/run/docker.sock      # defaults to a macOS path; every pull fails silently otherwise
export PATH=/root/.local/bin:$PATH                  # claude is not on the non-interactive PATH
REASONING=medium                                    # codex rejects the default 'standard'
ENV_LEDGER=/root/env-ledger/fresh-pool-v4/ledger.jsonl
TASKS_FILE=…/select/.cache/tasks_full_heldout.json
MODEL=openai/gpt-5.6-luna  PROVIDER=openrouter      # do NOT set CODEX_SUBSCRIPTION
SS_READ_GUTTER=tab|pipe    SS_READ_LINENUMS=0       # the gutter arms
```
