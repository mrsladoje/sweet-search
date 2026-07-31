# Turn-economy lever — full handoff report (2026-07-30 → 2026-07-31)

Self-contained briefing for a fresh analyst session. Covers what was attempted, why, what every
number was, what is confounded, and where every raw artifact lives. Companion to the working note
`TURN-ECONOMY-2026-07-30.md` (design rationale, research, wording history).

**Bottom line up front:** the lever was tested in two stages for $9.14 total and the predeclared
adjudicator returned **REVERT**. But the mechanism story is *not* "the instruction made things
worse" — retrieval was flat (143 → 143 operations, `ss-*` 56 → 54). The turn regression is edit /
test thrash concentrated in **one task**, and the headline packing metric turned out to be
confounded. The honest state is **"inert on its target, underpowered, one outlier"**, with one
live untested hypothesis (§7).

---

## 1. The problem being attacked

From a retired Grok-4.5 / OpenCode held-out 200 run, sweet-search **lost** to the native arm:
81 v 93 solves, **+15.2% cost**, −23.3% tool calls. Forensics attributed **94.7% of the cost gap
to re-send tax from turn inflation**: sweet ran 1.14 calls/turn vs native 1.76, because `ss-*`
commands are shell-routed and the model issues ~1 bash call per turn by habit.

Evidence that it was habit and not a harness limit: 383 sweet / 481 native assistant messages
already carried ≥2 parallel bash calls. But 85.7% of sweet turns carried a single tool call
(native 52%). Greedy collapsible turns in the sweet arm: **797 of 5,790 (13.8%)**, worth ~$11.4 —
551 search→read pairs, 292 edit→run_tests pairs, 38 adjacent single-`ss` turns.

**Founding guardrail (verbatim from the brief):** *"on this backbone the cost sign lives in
context-width-per-turn as much as turn count — the lever must make turns FEWER, not WIDER, and
must not increase total calls (sweet's −23% call advantage must survive)."*

---

## 2. What was built

### 2.1 The instruction block (CLI variant, 77 tokens)

Lives ONLY in `core/prompt-optimization/data/p7-turn-economy/sweet-search-system-prompt.turn-economy.md`.

```
## Turn economy
Independent probes you already intend go in ONE message — usually two or three, never a probe
you had not planned. Join them in a single bash call separated by `;` (`&&` only when a later
step should be skipped if an earlier fails). A probe needing another's result goes in a later
message.
```

MCP variant (53 tok) in the sibling `-mcp.turn-economy.md` — never benchmarked.

**Production M± was NEVER modified.** `p7-final/sweet-search-system-prompt.md` hash
`65a29f6a57f23eba0a0228909d1565af1f119e22391bd567c0e8cd9404289255` verified byte-identical before
and after every run. Variant hash `3e3128044cdc6c6fb29ad0cac9258710db84f6180a81be3d8a7340351bafcc28`.
Arm A loads the frozen champion; arm B loads the variant. Nothing to revert in production.

### 2.2 Two harness facts verified free, before any spend

- **OpenCode 1.18.4 does NOT serialize tool calls within one assistant message.** Two independent
  methods: the compiled binary shows `GZ({toolCall:T,...}).then().catch().finally()` un-awaited,
  no completion barrier; and in the retired run's DB, 23 of 30 messages containing a ≥1s non-final
  call had a later call start before it finished (`grep` at 710ms inside a `run_tests` spanning
  0→180,121ms); 445/2,996 multi-call messages had a later-declared call start first.
  **⇒ the "edit and test in the same message" clause was CUT.**
- **Variant plumbing** already supported via the `MPP` env var — zero code change.

### 2.3 `&&` vs `;` — measured, not assumed

`ss-grep` with no match exits **0** (safe), but `ss-read` on a missing file, `ss-grep` with a bad
regex, `ss-semantic` on a missing file, and **`ss-trace` on an unknown symbol all exit 1** — and
M± treats an empty trace as a normal outcome. So `ss-trace X && ss-grep Y` drops the grep exactly
when it matters. **⇒ the block uses `;`.**

---

## 3. Chronology of what was attempted and why

| # | Action | Why | Outcome |
|---|---|---|---|
| 1 | Research + 2 harness verifications | brief phases 1–2, no spend | ordering clause cut |
| 2 | Draft block, 5 review rounds | external reviewer (Codex) | see §3.1 |
| 3 | Staged design replaces one-shot 36 | user cost challenge | $42 → expected $14–20 |
| 4 | Eligibility audit of dev pool | needed goldens | **pool is 20, not 39** |
| 5 | Smoke, 5 pairs | mechanism kill-switch | mechanism "moved" (later shown confounded) |
| 6 | Offline frame clause | 9/10 rollouts attempting upstream fetch | **escape 265 → 0** |
| 7 | Two-sided operations gate | smoke showed ops FALLING | fixture proves it fires |
| 8 | Stage 1, 7 pairs | interim + variance | **REVERT** |
| 9 | Post-hoc decomposition | user challenged the mechanism | §6 — story changed |

### 3.1 Five review rounds — what was wrong and fixed

1. "wasted turn" contradicted M±'s own "ONE `ss-grep` … trust the top hit and stop"; the
   `ss-grep && ss-read` example showed two *independent* probes, teaching the opposite of its own
   sentence; "EVERY … about three" wasn't a limit.
2. The claim "only `&&` keeps calls flat" was **false** (omitted the serial baseline) — withdrawn.
   Also established the harness counts **envelopes**, so the 1.14 vs 1.76 gap is mostly packaging;
   the "much larger addressable pool" claim was withdrawn.
3. Parser blind spots, no executable decision rule, `TOTAL_RUNS` bug, PLAN.md self-contradiction.
4. Operations gate never wired (`evaluated:false`), ctx double-counted `in + cached`, admission
   silently accepted partial pairs.
5. `solved: !!r.resolved` turned `resolved:null` (ungradeable) into a loss, and an ungradeable
   A-side into a phantom B *gain*. Admission now requires a boolean.

### 3.2 Bugs found in the harness along the way (all fixed, all committed)

- **`golden-vault.sh push` staged only the FIRST key.** `ssh` inside `while read … done <<< "$keys"`
  inherited the here-string as stdin and ate the remaining keys — printed "verified / restored +
  locked read-only" and exited 0 for a partial stage. This is the goldens-not-staged blind spot
  that aborted an earlier run 14/200 tasks in. Fix: `ssh -n` throughout + a post-condition that
  dies unless staged == requested. Commit `6227d98`.
- **Leaked `sweet-search-maintainer` pegged at 100% CPU for 1 d 8 h** (child of an orphaned jail),
  plus 5 orphaned `agent-jail-init.mjs`. Killed by explicit PID.
  **Gotcha: `pkill -f <pattern>` over ssh is unusable here** — the pattern matches the ssh command
  line itself and the shell kills itself, silently doing nothing.
- **`analysis/env-ledger-dev200-2026-07-10.json` is NOT a usable preflight ledger** — wrong shape
  (object keyed by id, not JSONL rows) AND no `configHash`, so every entry fails staleness even
  after conversion. The real one is `/root/env-ledger/dev200/ledger.jsonl` on the box.
- **`CONCURRENCY=2` is safe** for run-pilot: in-process workers over per-task isolated golden
  copies (`run-pilot.mjs:525-538`), default is 4, `reapServers()` only after the pool drains. The
  standing `concurrency=1` rule is for the *search* benchmark. Two concurrent run-pilot
  *processes* remain forbidden (git dubious-ownership bug).

### 3.3 The eligible-task pool is far smaller than assumed

Of 40 dev-200 tasks with a vaulted golden:

| filter | survivors |
|---|---|
| vaulted golden | 40 |
| + ledger `gold-valid` **with current `configHash`** | 25 |
| + passes selection task-gate (`F2P<100` and `P2P≥1`) | **20** |

14 stale configHash (harness changed since the 2026-07-10 gold grade — needs re-sweep, not
rebuild), 1 excluded, 5 build-repair tasks (`P2P=0`). **The pre-existing 36-task set cannot be run
as written.** Stage 2 at 36 pairs requires re-sweeps or fresh goldens first.

---

## 4. The runs

Config for all four: Grok-4.5 / OpenCode / OpenRouter, `ARMS=sweet`, `REPS=1`, `CONCURRENCY=2`,
isolation jail ON, `run_tests` dedup ON, `TASK_FRAME` ON, `REASONING=standard`, ledger
`/root/env-ledger/dev200/ledger.jsonl`, preflight green in both cases.

### 4.1 Smoke — 5 pairs, PRE-frame, $6.28

Tasks (seed 20260730, distinct languages): `ontodev__robot-710` (java),
`jsx-eslint__eslint-plugin-react-3385` (js), `rstudio-education__gradethis-161` (r),
`mransan__ocaml-protoc-202` (ocaml), `dashbitco__nimble_options-43` (elixir).

Raw per-rollout (`probes / envelopes / turns / fused`):

```
        control                    variant
robot    18 / 11 / 11 /  6        17 / 10 / 10 /  6
eslint   37 / 32 / 28 / 11        23 / 25 / 24 /  8
grade    46 / 47 / 30 / 14        59 / 36 / 31 / 18
nimble   43 / 47 / 37 / 14        12 /  8 /  6 /  3
ocaml   169 / 87 / 80 / 51       143 / 76 / 55 / 34
```

Reported at the time: ops/envelope 1.397 → 1.639 (+17.3%); turns 186 → 126 (−32.3%); operations
313 → 254 (−18.8%); solve 4/5 → 3/5; ideal cost $3.742 → $2.119.

**⚠ Two of those numbers are now known to be misleading — see §5 and §6.3.**

`nimble_options` control logged `escape=27 leak=1` — it burned most of its 47 calls on refused
upstream fetches. Excluding it: ops/env +7.9%, turns −19.5%, operations −10.4%.

### 4.2 Stage 1 — 7 pairs, POST-frame, $2.86

Tasks (seed 20260731, from the 15 unused eligible): `oceanparcels__parcels-617` (python),
`epiforecasts__scoringutils-229` (r), `elm-tooling__elm-language-server-561` (ts),
`sindresorhus__emittery-121` (js), `akinsho__nvim-bufferline.lua-173` (lua),
`thelounge__thelounge-2538` (ts), `teleporthq__teleport-code-generators-291` (ts).

**Adjudicator verdict — `stats/turn-economy-ab.mjs`, seed 20260730, 10,000 resamples:**

```
turns       B/A  1.146 [0.789, 1.705]   above 0.90
operations  B/A  1.000 [0.832, 1.243]   GATE 0.85 <= bounds <= 1.05 (two-sided)
ctx/turn    B/A  1.138 [1.034, 1.260]   GATE upper must be <= 1.10
envelopes   B/A  1.257 [0.901, 1.671]   (reported only)
idealCost   B/A  1.314 [0.913, 1.928]   (reported only)
solve: +0 / -0  net 0
REVERT triggers: operations upper 1.243 > 1.05
                 operations lower 0.832 < 0.85
                 ctx/turn upper   1.260 > 1.10
VERDICT: REVERT
```

Realized cost $1.217 → $1.640 (+34.8%); avg calls 14.4 → 18.1. Solve **identical**: 5/7 both
sides, the *same* five tasks (failures: `elm-language-server`, `thelounge`).

---

## 5. The offline frame clause — the one unambiguous win

Added to `FRAME_CLOSE`, identical on both arms (the frame never names a search tool):

> **THIS ENVIRONMENT IS OFFLINE:** Every outbound request will be REFUSED — curl, wget, git
> fetch/clone/pull, and package installs (pip, npm, go get, cargo, gem, mix) alike. Mirrors, CDNs,
> proxies and archives are refused too. Do not attempt them and do not retry: everything needed to
> solve the issue is already in the working directory.
> Solve the issue from the repository source and the issue text. Do not go looking for the
> upstream fix — not over the network, and not in git history, refs, tags, stashes, or packed
> objects. A fix copied from a later commit does not count.

Added to **both** frame copies: `harness/codex-task-runner.mjs` (used by codex/claudecode/opencode
via `agent-runner-shared.mjs`) and the private copy in `harness/api-task-runner.mjs`.

| | smoke (pre-frame) | stage 1 (post-frame) |
|---|---|---|
| rollouts attempting upstream fetch | **9 of 10** | **0 of 14** |
| escape events | 265 control / 274 variant | 0 / 0 |
| git-history leaks | 11 / 10 | 0 / 1 |

The egress allowlist was already refusing every route (`api.github.com` 265, `github.com` 119,
`raw.githubusercontent.com` 106, `cdn.jsdelivr.net` 59, `proxy.golang.org` 27, `pypi.org` 24,
`unpkg.com` 21, plus ghproxy / raw.githack / web.archive.org / r.jina.ai / gitlab / bitbucket) — so
this was wasted spend and variance, not contamination. **Keep this clause permanently.**

**⚠ Comparability warning:** the frame change alone moves cost. Pre-frame baselines — including
the retired held-out 200 — are no longer cost-comparable. Any such comparison must disclose it.

---

## 6. Post-hoc decomposition — why the REVERT is NOT what it looks like

### 6.1 Retrieval was flat; the regression is edit/test thrash

```
             search      edits       tests      operations
control        56          30          14          143
variant        54          49          20          143
              -3.6%       +63%        +43%        0.0%
```

Total retrieval-and-test **operations were exactly flat, 143 → 143**. The instruction targets
probes. It did not inflate probing. The turn inflation is in the **edit → test → edit** loop,
which is inherently sequential and which the block never addresses.

### 6.2 One task carries the entire result

| task | turns | envelopes | operations | edits |
|---|---|---|---|---|
| nvim-bufferline-173 | 7 → 8 | 7 → 9 | 15 → 12 | 2 → 3 |
| elm-language-server-561 | 27 → **18** | 27 → 25 | 50 → 45 | 2 → 4 |
| scoringutils-229 | 6 → 7 | 6 → 8 | 7 → 6 | 2 → 2 |
| parcels-617 | 9 → **7** | 10 → 7 | 21 → 15 | 1 → 1 |
| emittery-121 | 16 → 22 | 28 → 38 | 25 → 29 | 16 → 21 |
| teleport-code-generators-291 | 6 → **5** | 7 → 5 | 8 → 9 | 2 → 1 |
| **thelounge-2538** | 11 → **28** | 16 → 35 | 17 → 27 | 5 → **17** |

Totals 82 → 95 (+15.9%). **Excluding `thelounge`: 71 → 67, a 5.6% DECREASE.** `thelounge` failed
in both arms — it is a rabbit hole, and edit-thrash is the dominant variance source on this bench.

### 6.3 The packing metric was confounded — correction

`operations/envelope` counts EVERY tool call as an envelope, but an **edit contributes an envelope
and zero operations**. So a run with 63% more edits shows collapsing ops/envelope mechanically,
with no change in probe batching at all.

Recomputed against **retrieval envelopes only** (`ss` + `test`):

```
control  143 ops / 70 retrieval envelopes = 2.043
variant  143 ops / 74 retrieval envelopes = 1.932   (-5.4%, not the -20% first reported)
```

**The same flaw inflates the smoke's +17.3%.** The block neither fused nor de-fused probes
meaningfully — it was **roughly inert on its own target**. Any re-analysis must restrict the
denominator to retrieval envelopes.

---

## 7. The one live hypothesis, untested and free to test

Two candidates explain the edit thrash and **cannot be separated at n=7**:

1. **Task noise.** Two thrashers out of seven produce this entire result. The measured
   `operations` interval [0.832, 1.243] — ±20% at n=7 — was warning about exactly this.
2. **A real indirect defect.** The block says *"never a probe you had not planned"* and *"a probe
   needing another's result goes in a later message."* That discourages opportunistic mid-fix
   re-investigation. If the model front-loads retrieval then stops searching during the repair
   loop, a failed edit gets answered with another blind edit instead of a new lookup. **This
   predicts exactly the observed signature: search DOWN, edits UP.**

**Proposed $0 test:** instrument *when* in each trajectory searches occur (early vs. interleaved
with edits) using the transcripts already on disk. If the variant's searches are front-loaded
relative to control, (2) has support and the block has a real failure mode — it optimizes the
locate phase and starves the repair phase. If distribution is unchanged, it is noise and the
honest verdict is "inert and underpowered."

**A second confound to state plainly:** stage 1 changed BOTH the frame AND the task set relative
to the smoke, so the sign flip on turns (−32% → +14.6%) cannot be attributed to the frame alone.
Disentangling costs ~$6 (re-run the 5 smoke tasks under the new frame).

---

## 8. Where every artifact lives

### 8.1 Box (`root@167.233.69.121`) — all four runs

```
R=/root/sweet-search-private/eval/task-completion-bench/results
$R/te-smoke-control-20260730     5 rollouts, PRE-frame,  control M±
$R/te-smoke-variant-20260730     5 rollouts, PRE-frame,  turn-economy variant
$R/te-s1-control-20260731        7 rollouts, POST-frame, control M±
$R/te-s1-variant-20260731        7 rollouts, POST-frame, turn-economy variant
```

Each run directory contains:

| path | contents |
|---|---|
| `rows.json` | one row per rollout: `resolved`, `gradeable`, `patchHunks`, `idealCostUsd`, `calls`, `exitReason` |
| `trajectories/<task>-sweet-r0.json` | **`toolCounts`, `escapeExamples`, `exitReason`, full `trajectory`** |
| `turns/<task>-sweet.jsonl` | per-turn token ledger — `in` is FULL input context incl. cached; **do NOT add `cached`** |
| `agent-state/<task>-sweet/opencode-data/opencode.db` | **the complete raw OpenCode transcript** (sqlite) |
| `preds-sweet.jsonl` | final patches |
| `progress.log`, `gold-tripwire.json`, `rt-dedup/` | run metadata, tamper checks |

Console logs: `/root/te-smoke-all.log`, `/root/te-s1-all.log`,
`/root/te-{smoke,s1}-{control,variant}-2026073{0,1}.log`.

Egress denial log (all runs, appended): `/root/.ss-eval/egress-guard/denials.ndjson`.

### 8.2 Pulling the raw transcripts

The box has **no `sqlite3` CLI** and its Node 20 has **no `node:sqlite`** — copy the DB out first
(`.db` + `-wal` + `-shm`) rather than reading in place:

```bash
# whole run's transcripts to your machine
R=/root/sweet-search-private/eval/task-completion-bench/results
rsync -az root@167.233.69.121:$R/te-s1-variant-20260731/ ./te-s1-variant/

# one rollout's raw conversation, locally
sqlite3 ./te-s1-variant/agent-state/thelounge__thelounge-2538-sweet/opencode-data/opencode.db \
  "SELECT id, data FROM kv WHERE id LIKE 'session/message/%' ORDER BY id;"
```

`stats/probe-count.mjs` already does the copy-then-read dance via python3 and exports
`analyzeRollout(dir)` → `{envelopes, probes, turns, fused}`.

### 8.3 Reproducing every number in this report

```bash
cd /root/sweet-search-private
R=eval/task-completion-bench/results

# adjudicated verdict (§4.2) — note --expect must match pair count
node eval/task-completion-bench/stats/turn-economy-ab.mjs \
  $R/te-s1-control-20260731 $R/te-s1-variant-20260731 --expect 7

# mechanism report (§4.1) — takes RUN IDs, resolves paths itself
node eval/task-completion-bench/stats/turn-economy-smoke.mjs \
  te-smoke-control-20260730 te-smoke-variant-20260730

# escape counts (§5)
grep -oE 'escape=[0-9]+ leak=[0-9]+' /root/te-s1-{control,variant}-20260731.log
```

⚠ `turn-economy-ab.mjs` takes **directory paths**; `turn-economy-smoke.mjs` takes **run IDs**.
Inconsistent — worth unifying.

### 8.4 Repo (all pushed to `main`)

```
3121508  adjudicator rejects ungradeable rows
6227d98  golden-vault push staged only the first key (ssh stdin slurp)
66d2e10  staged validation design; eligible dev pool is 20 not 39
1af8be0  mechanism-only smoke report
52ad810  smoke result — mechanism moves, two new concerns
0becb3a  offline frame clause + two-sided operations gate
abeb832  stage 1 REVERTs the lever; recommend stopping
```

Key files: `TURN-ECONOMY-2026-07-30.md` (design note), `stats/turn-economy-ab.mjs` (adjudicator,
25 assertions in `tests/`), `stats/probe-count.mjs` (operation counter, 50 assertions),
`stats/turn-economy-smoke.mjs`, `harness/codex-task-runner.mjs` (frame),
`harness/golden-vault.sh` (golden staging).

---

## 9. Constraints in force

- **No edits** to: frozen prompt files, ranking/sufficiency logic, isolation jail, egress guard,
  turn logs, `run_tests` dedup, grader. *(Frame text was on this list; the user explicitly
  reopened it to add the offline clause.)*
- **Never** held-out 1 or held-out 2 for lever validation. The retired held-out 200 is **evidence,
  not a tuning set**. Dev tasks only.
- Read-only on the retired run's data and DB.
- One thing on the box at a time; never two concurrent run-pilot processes.
- Solo repo — commit direct to `main`, no feature branches.

## 10. Open questions for a fresh analyst

1. **Is the block front-loading retrieval?** (§7, $0, decides whether the lever has a real defect
   or just lost a coin flip.)
2. **Is `ops/retrieval-envelope` the right packing metric**, and does the smoke's conclusion
   survive recomputation under it? (§6.3)
3. **Was the smoke→stage-1 sign flip caused by the frame or the task set?** (~$6 to separate.)
4. **How large must stage 2 be** given operations noise of ±20% at n=7? The original 36 looks too
   small, not too large.
5. **Is edit/test thrash the real cost driver on this bench**, rather than search packaging? If so
   the whole turn-economy framing targets the wrong phase — 292 of the 797 collapsible turns were
   edit→run_tests pairs, and those are out of reach for a prompt-only treatment.
