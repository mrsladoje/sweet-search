# HANDOFF — fix the seven defects that decide the sweet-vs-native scoreboard

**You are an implementation session.** The discovery phase is over. Three prior sessions read
204 agent rollouts and produced two research slates. This document is the distilled, verified
result. Your job is to fix seven specific things — four product defects in sweet-search, three
measurement defects in the benchmark.

**Do not** rerun discovery, rebuild the slates, or build any of the sixteen "programs" the
slates propose. Most of those are multi-engineer-month capability builds that turn sweet-search
into a different product. They are explicitly out of scope.

---

## Orientation — read this even if you think you know the project

**sweet-search** is a local code-retrieval tool. It exposes a small command family to coding
agents: `ss-search`, `ss-grep`, `ss-read`, `ss-find`, `ss-trace`, `ss-semantic`. The repository is
`/Users/admin/Projects/sweet-search-private`.

**The task-completion benchmark** is SWE-bench-shaped. An agent gets an issue text and a
repository at a base commit. It writes a patch. A hidden `test_patch` grades the patch with
`FAIL_TO_PASS` and `PASS_TO_PASS` test lists. The agent never sees the hidden tests or the gold
patch.

**Two arms.** The `native` arm gives the agent grep, file reads, and bash. The `sweet` arm gives
it the `ss-*` commands plus a fixed instruction prefix of roughly 1,457 tokens. Everything else
is matched: same model, same caps, same issue text, same framing.

**Three harnesses.** `codex`, `opencode`, `claude-code`. The model backbone is `gpt-5.6-luna`
across all three. Each harness ran 17 tasks × 2 arms × 2 reps = 68 rollouts. Total 204.

**Vocabulary you will meet.**
- **M±** — instructions delivered to the sweet arm only, through a memory file
  (`CLAUDE.md` / `AGENTS.md`). Must stay general, never benchmark-specific.
- **FRAME** — instructions delivered to *both* arms. A FRAME change produces **zero**
  head-to-head differential by construction. Never count a FRAME change as a sweet win.
- **DEV-RET** — the development task pool. Iterate here freely.
- **HO2** — the frozen held-out set. Never touch it. Never inspect per-query results from it.
- **break-priced cost** — cost recomputed with a normalized cache assumption, so cache-warmth
  differences between arms do not fake a win.

**The current scoreboard**, two reps, all 17 tasks, break-priced:

| harness | native | sweet | delta | native solves | sweet solves |
|---|---:|---:|---:|---:|---:|
| codex | $0.289332 | $0.270644 | sweet −6.5% | 9/17 | 10/17 |
| opencode | $0.270888 | $0.222779 | sweet −17.8% | 9/17 | 9/17 |
| claude-code | $0.398435 | $0.407928 | sweet +2.4% | 9/17 | 9/17 |

**Reading trap.** `SLATE-A-UBER.md` prints these same figures halved, because it reports a
per-rep mean. `SLATE-B-UBER.md` reports the two-rep total shown above. Every one of the six
numbers matches exactly under ×2. They are not in conflict. Do not spend time reconciling them.

**The goal.** sweet must be cheaper **and** solve more than native on all three harnesses.

---

## 1. Status of every claim you will act on

Separate what is proven from what is asserted. Three of the seven items were verified against
source code in this repository. The rest are trace measurements from the research sessions that
you should re-confirm before you rely on them.

### Verified in code, this repository

| Claim | Where |
|---|---|
| The `ss-read` line gutter renders as `` `${n}| ${line}` `` and is on by default | `eval/agent-read-workflows/bin/_ss-helpers.mjs:554-559`, `core/search/search-read.js:505-535` |
| The gutter was adopted as a −16% agent-cost win with solves held | `eval/task-completion-bench/TURNFIX-PHASE0-REPLAY-RESULTS-2026-08-03.md:587` |
| `cat -n` padded numbering was deliberately rejected | code comment at `core/search/search-read.js:507-509`, cites Claude Code issue #36654, "miscalibrates edit wrapping" |
| `ss-grep --in` accepts exactly one value | `_ss-helpers.mjs:247` — `readValueFlag(args, '--in', null, GREP_USAGE)`; header echoes one scope at line 275 |
| `matchesGrepFileFilter` returns false for a directory prefix | `core/search/grep-output-shaping.js:25`; a test **locks the bug in** at `tests/search/grep-output-shaping.test.js:51` |
| claude-code cost ledger excludes subagent (`isSidechain`) spend | verified by walking `agent-state/*/claude-home/projects/*/*/*.jsonl`, deduping on `requestId`; four-counter exact match |

### Measured from traces, not re-verified by this session

| Claim | Source | Confidence |
|---|---|---|
| 20 sweet vs 7 native edit-anchor failures on claude-code | Fable, deduped error census | mechanism confirmed; **count not re-checked** |
| 14 of 14 sampled failed→successful anchor pairs differ by one leading space | Fable | strong, single source |
| All 12 YARP grading logs stop at a missing .NET SDK before any test runs | both sessions independently | high — convergent |
| Claude native `Read` sends an invalid empty `pages` parameter, 68 native vs 6 sweet errors | Fable | single source |
| `ss-trace` falls back to a same-file scan on Python, Lua, TypeScript | both sessions | medium — mechanism unverified |
| At least five claude-code rollouts show decoding degeneration | Slate B | single source |
| pytask: passing `exc_info` solved 4/4, passing `()` or a frame solved 0/8 | Slate B corrected Fable's count | high — perfect discriminator across 12 rollouts |

**Rule:** re-confirm a measured claim before you build on it. Confirm it from raw traces, never
from `trajectories/` — those truncate results at 600 characters and inputs at 200 characters, so
absence there proves nothing.

---

## 2. The seven work items

Items 1–4 are sweet-only product defects. They should improve sweet on **every** harness. Items
5–7 are measurement repairs. They make the scoreboard honest. Never publish a measurement repair
as a product win.

---

### Item 1 — the read gutter corrupts exact edit anchors

**Priority: highest. This is the single best finding from the whole effort.**

**Mechanism.** `ss-read` prefixes each line with number, pipe, one space. A line indented four
spaces renders as `123|` plus five spaces plus content. A model that copies the body to build an
exact-match edit anchor must strip five characters (`123| `). If it strips four (`123|`), it
carries one extra leading space into the anchor, and the harness edit tool fails to match.

That predicted signature — exactly one extra leading space — is what Fable found in 14 of 14
sampled failure/recovery pairs.

**The trap that makes this hard.** Two obvious remedies are already closed.

1. **Do not delete the gutter.** It is a validated −16% agent-cost lever with solves held. See
   the replay results file cited above. Deleting it trades a measured cost win for an unmeasured
   error-rate win.
2. **Do not switch to `cat -n` padding.** The code comment records that this was tried and
   rejected: the padded field miscalibrates edit wrapping (Claude Code #36654). `SLATE-A-UBER.md`
   proposes exactly this remedy without knowing it was already rejected.

**A third constraint.** sweet does not own the edit tool. Editing belongs to the harness —
Claude Code's `Edit`, codex's `apply_patch`. So you cannot fix this by making the matcher
tolerant of leading whitespace. The fix must be on the render side.

**Candidate remedies worth designing.** A single tab after an unpadded number is materially
different from `cat -n`, because the recorded rejection was about the *padded field*, not the
tab. A gutter-free body with a separate line map is the other shape. Pick one, and say why.

**What $0 can and cannot prove.** A replay can prove the *mechanism*: regenerate the recorded
reads, apply the observed strip behaviour, and show the extra space originates in the gutter. A
replay **cannot** prove the *remedy*, because you cannot know what a model will strip from a
delimiter it has never seen. Say this plainly in your report. The remedy needs a live A/B.

**Path to a live A/B.** Use the `/microsmoke` skill. Its Gate 0 is a $0 exposure check; its
Gate 2 is the smallest paid run. Standing invariants from that skill: at least 2 reps,
`CONCURRENCY=1`, matched `MAX_TOOL_CALLS` across arms, and read `idealCost`, never realized cost.
**A paid run needs an explicit GO from the user. Do not launch one.**

**Preserve the existing format gate.** `lineGutterEnabled` in `core/search/search-read.js`
already disables the gutter for `benchmark`, `raw`, and `json` formats, to protect retrieval
measurement. Any change must keep that.

**Done when:** the mechanism is demonstrated by replay, a remedy is chosen with its rationale
written down, both renderers are changed consistently, the format gate still holds, and unit
tests cover the anchor round-trip.

---

### Item 2 — `ss-grep --in` silently drops extra scopes

**Evidence.** In codex/dashbitco/sweet, the agent passed two paths on one call:
`ss-grep ... --in lib/nimble_options.ex test/nimble_options_test.exs`. The result header printed
`(scope: --in lib/nimble_options.ex)`. The test file was dropped with no warning, and that file
held the exact-string assertion that decided the task.

**Confirmed in code.** `_ss-helpers.mjs:247` reads a single value. Line 275 echoes that single
value back, which makes the loss look like intended behaviour.

**Fix.** Either accept a repeated or list-valued `--in`, or reject extra values loudly with a
usage error. Silent truncation is the defect; either resolution removes it.

**Done when:** multi-scope either works or errors, the header reports every applied scope, and
tests cover one file, several files, and a rejected malformed value.

---

### Item 3 — `matchesGrepFileFilter` rejects directory scopes

**The function** at `core/search/grep-output-shaping.js:25` matches only an exact path or a
`/`-suffixed path ending. A directory such as `tests/testthat` therefore matches nothing.

**A test locks the bug in.** `tests/search/grep-output-shaping.test.js:51` asserts
`matchesGrepFileFilter('tests/testthat/test_x.R', 'tests/testthat')` is `false`. Update that
test to assert the corrected behaviour. Do not route around it.

**Related to item 2 but distinct.** Item 2 is about losing a second value. This is about a single
value that names a directory. Fix both.

**Done when:** directory scopes match their contents, the locking test asserts the new
behaviour, and traversal safety is covered (a scope must not escape the repository root).

---

### Item 4 — `ss-trace` falls back to a same-file scan

**Evidence, medium confidence.** Both research sessions report that `ss-trace` returned only a
same-file scan on Python (pytask), Lua (akinsho), and TypeScript. On pytask specifically, the
cross-file callers in `report.py`, `build.py`, and `graph.py` contain two literal `sys.exc_info()`
flows. Those flows are what let the native arm choose the winning contract.

**Why this one matters beyond the bug.** pytask is the task that gives native its only
task-level advantage on both opencode and claude-code. Across all 12 pytask rollouts, every
implementation passing `exc_info` to the callable resolved (4 of 4), and every implementation
passing `()` or a frame failed (0 of 8). The discriminator is perfect. If repaired cross-file
tracing surfaces those callers, this may be a solve flip on two harnesses with no new capability.

**Start by reproducing.** Run `ss-trace` on the pytask repository at its base commit and see
whether cross-file edges appear. If they do, the claim is wrong and this item closes. If they do
not, diagnose whether the cause is extraction, index persistence, or the fallback path, and make
the fallback state visible in the output rather than silent.

**Done when:** the behaviour is reproduced or refuted with evidence, any real defect is fixed,
and fallback status is prominent in the rendered result.

---

### Item 5 — the YARP grader never ran a test

**Evidence.** All 12 YARP grading logs across three harnesses, two arms, and two reps stop at
`A compatible .NET SDK was not found` for `10.0.100-preview.3.25201.16`. Zero tests execute. Yet
all 12 rows record `gradeable=true`, `f2pFrac=0`, `resolved=false`.

So one task in 17 is a fake zero for **both** arms. Both arms are charged for it — roughly
$0.012 to $0.020 of sweet spend per harness — and neither can score on it.

**Two pieces of work.**

1. **A tripwire, first.** A row must not be `gradeable=true` unless its log contains at least one
   framework test-result line. This is the durable fix: it prevents the next silent grader
   outage from being read as a solve failure. Build this before anything else.
2. **A regrade.** The 12 patches are already stored in `preds-<arm>.jsonl`. Regrading needs a
   working .NET SDK image, but **no new agent rollouts and no model spend**.

**Regrade constraints.** It runs containers and writes results, so it is not a read-only
operation. Work on a copy. Never mutate `results/` in place. Ask for a GO before running it.

**Expected effect.** Cost does not move. Absolute solves may rise for both arms. Removing YARP
entirely does not change any sign: codex stays 9 vs 10, opencode 9 vs 9, claude-code 9 vs 9. So
do not expect this to hand you a win. Expect it to stop one seventeenth of the benchmark from
measuring nothing.

**Done when:** the tripwire ships with tests, and the regrade is either completed on a copy or
blocked with the blocker named.

---

### Item 6 — decoding degeneration is not quarantined

**This is the most under-weighted number in either slate.**

pytask sweet rep 0 on claude-code emitted rejected edit payloads of roughly 127,666 bytes and
cost $0.0464. Its own sibling rep cost $0.0066. The excess is $0.0398.

The entire claude-code arm cost gap is $0.009493. **One broken rollout on sweet's side is about
four times the whole gap** that a previous session spent days trying to explain.

**Be honest about the direction.** Degeneration markers also appear on native cells (akinsho
native, YARP native) and on other sweet cells (dart sweet). Only the pytask sweet instance was
priced. So this is not established as one-sided — but the one large measured instance is on
sweet's side, and removing it helps sweet.

**Fix.** Detect pathological payloads before they reach the filesystem, record a structured
degeneration flag on the rollout, and publish cost in three views: raw, flagged, and excluded.
The detector applies to both arms, so it is a validity repair with zero head-to-head
differential. Never book the removed noise as a sweet saving.

**Done when:** the detector exists with tests, the flag is recorded, and cost is republished in
all three views.

---

### Item 7 — claude-code subagent spend is off-ledger

**Verified last session, four-counter exact match.** The claude-code runner records only the main
session. When the model spawns a subagent, that subagent runs as a separate session and its
tokens never reach `rows.json`.

**Proof method, if you want to re-confirm.** Walk assistant records under
`results/<run>/agent-state/*/claude-home/projects/*/*/*.jsonl`, dedupe on `requestId`, split on
the `isSidechain` flag. For `redboltz__mqtt_cpp-466` native, main-only totals (in 69, cache-write
51,829, cache-read 445,319, out 4,327) equal the sum of the two `rows.json` reps exactly on all
four counters. Sidechain records appear nowhere in the ledger.

**Asymmetry.** native spawns subagents in 8 of 17 task-arm cells (121 requests, $0.0319
off-ledger). sweet spawns them in 2 of 17 (35 requests, $0.0098). Ratio 3.25 to 1. codex and
opencode spawned zero across 68 rollouts each, so only claude-code is affected.

**Effect.** Folding the spend back in moves claude-code from +2.2% (sweet more expensive) to
−3.0% (sweet cheaper). Solve does not move.

**Fix it because the accounting is wrong, not because it wins a comparison.** At n=17 the
claude-code comparison cannot resolve a difference in either direction: per-task SD $0.003567,
SE $0.000865, aggregate 95% interval about −$0.0264 to +$0.0359, sign-flip p ≈ 0.79. Rep 0 alone
puts sweet at +26.24% and rep 1 at −17.28%.

**Fold sidechain usage into the runner's existing pricing function** so it lands in
`breakPricedCostUsd`, then re-derive from the retained session store.

**Pre-registered bar.** With sidechain records excluded, the recomputed arm totals must reproduce
today's values to within 0.5%. If they do not, you have a second accounting defect — stop and
find it.

**Caveats to keep attached.** The audit is cell-level, not rep-level, because `agent-state` is
stored per task-arm. And it is unresolved whether sweet's low subagent use is caused by having
`ss-*` tools or is incidental.

---

## 3. Sequencing

Items 1–4 are independent of each other. Items 5–7 are independent of each other. The two groups
are independent.

Suggested order, cheapest confirmation first:

1. **Item 3** — smallest, fully verified, a test already names the bug.
2. **Item 2** — small, fully verified in code.
3. **Item 7** — verified, mechanical, and it corrects a published number.
4. **Item 5 tripwire** — small and prevents the whole class of failure recurring.
5. **Item 4 reproduction** — cheap to check, potentially a solve flip on two harnesses.
6. **Item 6 detector** — moderate.
7. **Item 1** — highest value, most design work, and the only item whose remedy cannot be
   settled at $0.

Do not start item 1's implementation before its replay confirms the mechanism.

---

## 4. Hard constraints

**Spend.** $0 unless the user gives an explicit GO. No agent rollouts. No paid A/B. The `/microsmoke`
skill exists for when a GO arrives; read it before you propose a paid run.

**The evidence box.** `ssh root@167.233.69.121`, **read-only**. Do not launch pilots, spend money,
or mutate `results/`. Another agent may be using the host. Run one pilot at a time if a GO ever
arrives — concurrent pilots trigger a git uid-501 dubious-ownership bug. Abort if `df /` shows
under 12G available.

**HO2 is frozen.** Never run it, never inspect per-query results from it. Development happens on
DEV-RET only. If a held-out regression appears that dev did not show, fix the underlying
principle — do not tune to the held-out failure.

**Format gating.** Any new ranking signal that detects structured-query patterns must be gated on
`opts._isAgentFormat` (or `opts.format === 'agent' | 'agent_full' | 'agent_full_xl' |
'agent_preview'`). Ungated, this exact class of change cost −0.07pp on GCSN held-out MRR once,
and −27.57pp on GCSN dev MRR a second time. None of the seven items should need a new ranking
signal — if yours does, stop and reconsider.

**Never use `ss-*` commands to develop sweet-search.** Use native file tools. Dogfooding here
contaminates the thing under measurement.

**Working tree is dirty.** Roughly 24 modified files and 14 untracked files are already in
progress on `main`. Do not revert, stash, or clean them. Confirm with the user before touching
anything outside the files your items name.

**Git.** Solo project. Commit directly to `main`. No feature branches. Commit only when asked.

**Never route the Sol model through OpenRouter** — it is metered there at roughly 50× the
subscription cost.

---

## 5. Evidence access

**Runs.** `/root/sweet-search-private/eval/task-completion-bench/results/<RUN_ID>/` where
`RUN_ID` is `sb-codex-20260811`, `sb-opencode-20260811`, or `sb-claudecode-20260811`.

**Access check** — this must print `68, 68, 68, 14, 104`:

```bash
ssh root@167.233.69.121 'cd /root/sweet-search-private/eval/task-completion-bench/results
 ls sb-codex-20260811/agent-state/*/codex-home/sessions/*/*/*/rollout-*.jsonl | wc -l
 ls sb-opencode-20260811/agent-state/*/opencode-retained/*/attempt-1.stdout.ndjson | wc -l
 ls sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*.jsonl | wc -l
 ls sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*/subagents/*.jsonl | wc -l
 ls sb-*/[ns]*/logs/*_log.txt | wc -l'
```

**Read transcripts with the tested reader**, not by hand-parsing schemas. It is at
`/root/dump-trace.mjs` on the box, and a local copy sits beside this file at
`eval/task-completion-bench/handoffs/improve/dump-trace.mjs`. Default `--max-result 0` renders
every message and every untruncated tool result.

```bash
ssh root@167.233.69.121
cd /root
node dump-trace.mjs --list
node dump-trace.mjs pytask-dev__pytask-210 sweet --harness codex
node dump-trace.mjs dashbitco__nimble_options-43 sweet --harness claude-code --rep 1
node dump-trace.mjs dart-lang__http-1114 native --harness claude-code --subagents
```

Flags: `--harness codex|opencode|claude-code`, `--rep N`, `--max-result N`, `--tools-only`,
`--subagents`, `--list`.

**Three schema traps the reader already handles.** codex buries the real shell command inside
`tools.exec_command({cmd:"..."})` and its reasoning is encrypted. claude-code streams the *same*
assistant message repeatedly, each copy growing — deduping whole records silently drops
late-arriving `tool_use` blocks, so dedupe by block ID. claude-code alone has readable
`thinking`.

**Other retained artifacts per run:** `rows.json` (per-rep outcome, calls, usage, cost,
gradeability), `preds-<arm>.jsonl` (full untruncated `model_patch`), `turns/<task>-<arm>.jsonl`
(per-turn prices), `<arm>/logs/<task>_log.txt` (grader output), `rt-dedup/` (repeat-test audit).
Gold is `select/.cache/tasks_full_luna_rotate20.json` — retrospective analysis only, never a
runtime input.

**Prior documents in this directory,** in decreasing usefulness to you:
`SLATE-A-UBER.md` and `SLATE-B-UBER.md` (the two research slates, and their discard logs are
worth reading before you invent anything), `RUN-LEDGER.md` and `EVIDENCE-DIGEST.md` (the earlier
evidence pass), `HANDOFF-CRUSH-NATIVE.md` (the discovery brief that produced the slates).

---

## 6. What not to do

**Do not build the slate moonshots.** `ss-witness`, `ss-statecheck`, `ss-author-api`,
`ss-surface-probe`, dependency-source corpora, patch tournaments, a local repair forge. These are
SWE-agent capabilities, not retrieval capabilities. They cost engineer-months, they change what
the product is, and every one of their ceilings rests on a single task at 2 reps that nobody has
solved. Leave them in the slates.

**Do not regenerate the dead list.** Both slates carry discard logs — §9 in A, §8 in B — that
record roughly thirty ideas killed with the evidence that killed them. Read them before
proposing anything new. Notable dead ends: more sibling retrieval, turn packing, prompt-only
routing, tests-first, completeness cards, checkpoint doctrines, stale-test override rules, and
any lever whose vehicle is FRAME text.

**Do not count a shared fix as a sweet win.** Items 5, 6, and 7 repair measurement. They apply to
both arms or to the ledger. Report them as validity repairs.

**Do not hide a fix that helps native.** The claude-code native `Read` sends an invalid empty
`pages` parameter — Fable counted 68 native errors against 6 sweet. Fixing it will improve
native's claude-code cost by an estimated 2–4%. Fix it anyway, and when the number moves, do not
describe it as a sweet regression. It is a harness-adapter repair that was inflating native's
cost. Treat this as an eighth item if you have room; it is honesty work, not product work.

**Do not soften a bar after seeing a result.** Pre-register what would falsify each fix, then
keep it.

---

## 7. Deliverable

Write `eval/task-completion-bench/handoffs/improve/FIX-REPORT.md` covering, per item:

- what you changed, with `file:line` references;
- what evidence you confirmed or refuted, and how;
- the test you added;
- what remains unproven and what it would take to prove it;
- for item 1 specifically: the delimiter you chose, why, and the design of the paid A/B you
  would run — described, not launched.

State total spend. It should be `$0`.

If any item turns out to be wrong — the claim does not reproduce, the fix has no effect, the
defect is not real — say so plainly and move on. A refuted claim is a good outcome. Four of the
seven items came from a single source and were never independently checked.

**Finish every item you can. If one is blocked, complete the other six in full and say exactly
what you left out and why.**
