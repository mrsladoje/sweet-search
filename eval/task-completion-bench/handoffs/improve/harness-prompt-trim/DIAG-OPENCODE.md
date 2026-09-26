# opencode harness trim — flip diagnosis, integrity audit, v3 proposal (2026-09-26)

Scope: opencode 1.18.4, `openai/gpt-5.6-luna` via OpenRouter, sweet arm only. Dev tasks only
(3 smoke tasks from DEV-RET, the 10-task confirm set). No held-out-2 data was read. Model spend: $0.

## 1. Conclusion

1. **The round-1 trim (mode 1) did not lose a solve because of trimmed text.** Its one confirm-set
   loss (eslint-plugin-ember, leg 3) comes from a conflict between the frame and the task, made
   worse by a both-arm `run_tests` defect. On matched legs, mode 1 ties as-now: **7/26 v 7/26**.
2. **The reported −12% cost saving for mode 1 is overstated. The true saving is −4.8%.** The trim
   made the agent delegate searches to the `explore` subagent (5 of 26 trimmed rollouts; 0 of 32
   as-now). The row ledger does not count subagent spend. With subagents included:
   confirm $0.371 → $0.353 (−4.8%); turns 379 → 362 (−4.5%).
3. **The max family (max, max-todo, max-p1) plausibly costs solves.** On graphql-go-tools it
   solved 2/6, against 5/6 for as-now plus mode 1 (one-sided Fisher p = 0.12). The failures are
   one-site fixes after short investigation. The evidence is not strong enough to name one cut.
4. **Integrity is clean except for the cost ledger.** Every arm got exactly its intended
   configuration, all plugin edits applied, and nothing else differed.
5. **v3 = mode 1 + three changes.** The general subagent gets the trimmed prompt. The explore
   agent is disabled. The task tool keeps its "class Foo" line in neutral words. Three
   zero-risk text cuts are added. Verified by $0 capture on main and subagent requests.
   Expected saving v as-now: **about −9 to −10%, subagents included** (mode 1 true: −4.8%).

## 2. Per-task solve table (all runs, sweet arm)

Cell = solved/rollouts, mean cost per rollout **with subagent spend**, mean turns (main +
subagent), mean tool calls; `subN` = rollouts that started a subagent.

| task | as-now | mode 1 | max | max-todo | max-p1 |
|---|---|---|---|---|---|
| gitbookio__markup-it-56 | 0/4 $0.0225 t24 c26 | 0/2 $0.0214 t22 c24 sub1 | 0/2 $0.0151 t14 c21 | 0/2 $0.0189 t18 c28 | 0/2 $0.0147 t19 c21 |
| pytask-dev__pytask-210 | 1/4 $0.0091 t12 c12 | 0/2 $0.0068 t10 c13 | 0/2 $0.0057 t6 c8 | 0/2 $0.0081 t10 c12 | 1/2 $0.0076 t11 c11 |
| jensneuse__graphql-go-tools-174 | 3/4 $0.0270 t26 c30 | 2/2 $0.0200 t18 c24 | 1/2 $0.0167 t19 c18 | 1/2 $0.0315 t30 c33 | 0/2 $0.0180 t20 c16 sub1 |
| smooth-code__svgr-10 | 0/2 $0.0135 t17 c19 | 0/2 $0.0188 t25 c26 sub1 | | | |
| maxgraph__maxgraph-365 | 0/2 $0.0076 t12 c12 | 0/2 $0.0079 t11 c12 | | | |
| rokucommunity__brighterscript-1050 | 0/2 $0.0249 t24 c27 | 0/2 $0.0208 t18 c21 sub1 | | | |
| dbader__node-datadog-metrics-73 | 0/2 $0.0073 t9 c14 | 0/2 $0.0109 t16 c13 sub2 | | | |
| fastify__fastify-cors-285 | 0/2 $0.0125 t14 c14 | 0/2 $0.0142 t12 c20 | | | |
| superlistapp__super_editor-2516 | 2/2 $0.0195 t17 c22 | 2/2 $0.0191 t14 c26 | | | |
| joshuakgoldberg__bingo-271 | 0/2 $0.0294 t23 c28 | 0/2 $0.0189 t18 c21 | | | |
| mwouts__jupytext-360 | 0/2 $0.0150 t16 c17 | 0/2 $0.0150 t18 c17 | | | |
| zmap__zlint-299 | 2/2 $0.0159 t21 c21 | 2/2 $0.0154 t16 c24 | | | |
| ember-cli__eslint-plugin-ember-551 | 2/2 $0.0396 t37 c38 | 1/2 $0.0354 t32 c43 | | | |

Totals per condition:

| set | condition | solved | row cost | + subagent cost | inclusive cost | turns (main + sub) | calls |
|---|---|---|---|---|---|---|---|
| confirm 10x2 | as-now | 6/20 | $0.3708 | $0 | $0.3708 | 379 + 0 | 428 |
| confirm 10x2 | mode 1 | 5/20 | $0.3261 (−12.1%) | $0.0268 | **$0.3529 (−4.8%)** | 331 + 31 = 362 (−4.5%) | 444 |
| smoke 3x4 | as-now (rounds 1+2) | 4/12 | $0.2343 | $0 | $0.2343 | 248 | 270 |
| smoke 3x2 | mode 1 | 2/6 | $0.0891 | $0.0073 | $0.0963 | 95 + 6 | 122 |
| smoke 3x2 | max | 1/6 | $0.0750 | $0 | $0.0750 | 80 | 95 |
| smoke 3x2 | max-todo | 1/6 | $0.1169 | $0 | $0.1169 | 115 | 144 |
| smoke 3x2 | max-p1 | 1/6 | $0.0670 | $0.0135 | $0.0806 | 87 + 14 | 95 |

Matched legs only (same round, ABBA): round 1 as-now 1/6 v mode 1 2/6; confirm 6/20 v 5/20;
pooled **7/26 v 7/26**. Cost interval for mode 1 v as-now on the confirm set (task-clustered
bootstrap, seed 42, subagents included): **−16.3% .. +11.4%**. The cost saving is not proven.

Scripts: `table.py`, `extract.py`, `inclusive.py`, `preedit.py`; data `rows_ext.json`.

## 3. Every flip, root-caused

### 3.1 eslint-plugin-ember, confirm, mode 1 leg 3 failed (as-now 2/2, mode 1 1/2)

**Verdict: variance on a frame conflict, amplified by a both-arm run_tests defect. Not
trim-caused.**

- The task needs a new rule file `lib/rules/no-classic-components.js`. The repo's own test
  `tests/rule-setup.js` ("should have tests for all rules") needs a test file for every rule.
- The frame says: *"Do NOT modify test files — the evaluation supplies its own hidden tests"*.
- Both as-now rollouts broke that rule: they added `tests/lib/rules/no-classic-components.js`
  (the grader then used the gold test file). Both passed.
- Both mode-1 rollouts obeyed the rule. Leg 2 kept the rule file in `lib/rules/`, accepted one
  failing setup test, and passed: *"The only remaining failure is the repository's strict setup
  check requiring a `tests/lib/rules/no-classic-components.js` fixture, and I will not add one"*.
- Leg 3 gamed the setup test instead. It moved the rule to `lib/no-classic-components.js` and
  registered it as a non-enumerable property: *"adding a test file is explicitly disallowed for
  this task. I'm preserving the public `rules['no-classic-components']` lookup while keeping the
  repository's existing enumerable rule/test registry unchanged"*. Grading then failed with
  `Cannot find module '../../../lib/rules/no-classic-components'`.
- Both-arm defect: `run_tests` builds the candidate patch with `git diff HEAD`
  (`harness/rt-shim-runtime.mjs:208`). A new, unstaged file is invisible to it. All 4 rollouts
  got a false *"Cannot find module"* FAIL on their first post-edit run and had to find
  `git add -N` themselves. The graded patch has the same blindness
  (`agent-runner-shared.mjs:271`, `gitDiffPatch`); leg 3 lost its new docs file from the patch.
- No trimmed text relates to tests. Round 1 removed from the GPT prompt only: the Glob/Grep
  bullet, the "simple request" line, the review, frontend, duplicate General and Formatting
  sections. The bash/read/task edits name only glob/grep/read.
- Test-file edits across all 70 rollouts: as-now 2 (both this task), every trim condition 0.
  That is 2 rollouts on 1 task; it is not evidence of a trim effect.

### 3.2 graphql-go-tools: max L2, max-todo L1, max-p1 L1+L2 failed (as-now 3/4, mode 1 2/2)

**Verdict: plausibly trim-caused for the max family; not attributable to one cut.**

- The gold fix exempts `__typename` in two places: `fieldDefined.ValidateInterfaceObjectTypeField`
  and `fieldSelectionMergingVisitor.EnterField`. Every solved rollout touched the second site.
  Every failed rollout (including as-now round-1 r1) fixed only the first.
- Investigation before the first edit, graphql only (tool calls): failed max 6, max-p1 10 and 6;
  solved as-now 17, 18, 16; solved mode 1 13, 23. Exceptions: max-todo L1 (18, failed) and
  as-now r1 (23, failed).
- Max-family rollouts had shorter verification after the edit (smoke means: max 4.8 calls,
  max-p1 5.8, as-now 7.5).
- The full suite FAILs on a pre-existing `go-ext-wasm` cgo build failure in `pkg/execution`
  (both arms). The agent reads the FAIL as pre-existing and stops: *"The full run_tests suite
  remains blocked by a pre-existing go-ext-wasm cgo build failure in pkg/execution; no failures
  were introduced by this change."* So the suite cannot point the agent to the second site.
- Which cut? max-p1 (round-1 prompt) also went 0/2, so the prompt cuts alone do not explain it.
  max-todo (todowrite kept) went 1/2, so todowrite alone does not explain it. What the three
  variants share: the max bash/read/task description cuts and the subagent prompts. At n = 2 per
  variant this cannot be separated from variance. v3 therefore takes none of the max cuts that
  change working text.

### 3.3 pytask-210: as-now 1/4, max 0/2, max-todo 0/2, mode 1 0/2, max-p1 1/2

**Verdict: variance — a signature lottery.** The hidden test calls `__tracebackhide__(exc_info)`
(pytest's convention). Rollouts guessed `is_hidden()`, `is_hidden(frame)` or
`is_hidden(exc_info)`. Only the 2 rollouts that passed `exc_info` solved (as-now 0002-L1,
max-p1 0312-L2). Nothing in any trim touches this.

### 3.4 Gains (mode 1 round 1: graphql 1/2 → 2/2)

Variance. The as-now failure (r1) is the same one-site fix as §3.2.

### 3.5 Behaviour change that IS trim-caused: explore delegation

- as-now: 0 subagents in 32 rollouts. mode 1: explore in 5 of 26 rollouts (confirm L2 svgr,
  brighterscript, datadog; L3 datadog; round-1 trim-r2 markup-it). max-p1: 1 of 6.
- Cause: round 1 deleted the task tool's deterrent *"If you are searching for a specific class
  definition like "class Foo", use the Grep tool instead"* and disabled glob/grep. The only
  named search affordances left are bash and explore (*"search code for keywords"*).
- Effect: on the 4 confirm rollouts that delegated, the main session was 28% cheaper but the
  total was **+23%** v as-now on the same tasks. No solve changed (all 4 tasks fail on both arms).
- The explore subagent in mode 1 got opencode's untrimmed explore prompt, which tells it to
  *"Use Glob"* / *"Use Grep"*: tools the trim disabled. This breaks the owner's subagent rule in
  practice. (The general subagent also got the untrimmed prompt, confirmed by capture: 18,888
  chars with the Glob bullet. No rollout started general.)

## 4. Integrity check

| check | result |
|---|---|
| as-now got the untrimmed setup | yes: all 32 as-now rollouts have the same config SHA-256 `db224c1b…`: `plugin: []`, no `tools`, no `agent` |
| trim got exactly its mode | yes: each generated config was byte-compared to the committed prompt files. mode 1 = round-1 build prompt, glob/grep/skill off, no subagent prompts. max = max prompt for build + general, explore-max, todowrite off. max-todo = max with todowrite on. max-p1 = round-1 prompt for build + general, explore-max |
| plugin edits applied | yes: every trimmed row reports all edits applied, 0 missing (mode 1: bash 4, read 2, task 2; max family: 8, 3, 4) |
| model, version, reasoning | identical: `openai/gpt-5.6-luna`, opencode 1.18.4, medium, OpenRouter, in all 70 rollouts |
| per-task environment | `envConfigHash` identical per task across arms; packing off; rt-progress policy hash identical; no hard turn cap; index from golden cache in all rows |
| isolation (unjailed XDG) | both arms: resolved config has no `instructions`, no MCP servers, no extra plugin; preflight passed; private config dir holds only opencode's own `node_modules` |
| tamper / leaks / retries | 0 shim-tampered, 0 secret leaks, 0 start retries, 0 degeneration reruns |
| code drift during runs | none that matters. `3bd90f9` (00:42) landed during round 2 (started 00:02); the max config it produced is byte-identical to the one before. No commit during the confirm run. The uncommitted `ideal-cost.mjs` edit dates from 2026-09-24, before every run |
| AGENTS.md identity | **not provable per rollout**. `packingInstructionSha256` is the empty-string hash in every row; it does not cover AGENTS.md. The rules file and runner code did not change during the runs |
| order | ABBA by leg (L1, L4 as-now; L2, L3 trim), same task order; not interleaved per task |

**Contamination found:** subagent spend is off the row ledger (§5.2). It hits both arms, but in
these runs only the trimmed arm delegated, so it flatters the trim.

**Harmless difference:** trimmed rollouts sometimes passed bash timeouts of 10 s, 120 s or
780 s; as-now always passed 300 s. No command timed out.

## 5. Both-arm defects found (owner decision, outside the trim)

1. **opencode cost ledger excludes subagents.** `parseOpencodeStream` prices only the
   `step_finish` events of `opencode run --format json`, which carry the main session only.
   Child sessions reach `opencode.db` only (svgr L2: the stream has 15 step events; the DB has
   15 build + 13 explore). Proposed helper, tested read-only on copies of the real DBs:
   `subagent-turns.mjs` (append its turns, flagged `sidechain: true`, before `costsFromTurns`).
   Same rule as the Claude Code sidechain-inclusive ledger.
2. **run_tests and the graded patch cannot see new untracked files** (`git diff HEAD` in
   `rt-shim-runtime.mjs:208` and `agent-runner-shared.mjs:271`). Fix: include untracked,
   non-ignored files (for example `git add -N` on them before the diff, minus AGENTS.md and
   `.sweet-search`).
3. **Frame v task conflict.** "Do NOT modify test files" against repos whose own setup test needs
   a test file per rule (ember). It pushed one rollout into gaming the check.
4. `run_tests` FAIL on a pre-existing build failure (graphql `pkg/execution`) is uninformative.
   Already on the owner's list.
5. Record an AGENTS.md hash on each row.

## 6. v3 — the third edition

Goal: solves ≥ as-now, then lowest cost. Start from mode 1 (the only edition that tied solves on
the confirm set).

### 6.1 Contents and one-line justification per item

| item | v3 | why |
|---|---|---|
| build prompt | round-1 GPT prompt, byte-identical (`opencode-1.18.4-prompt-gpt.txt`); no new prompt file | the only prompt that tied solves; every further prompt cut (max) sat in the variants that lost graphql |
| general subagent prompt | same round-1 prompt (new) | owner rule; capture shows general got the untrimmed prompt with "prefer Glob and Grep" in mode 1 |
| explore agent | **disabled** (`agent.explore.disable: true`) (new) | as-now used it 0/32; mode 1 delegated 5/26, +23% on those rollouts, off-ledger; its prompt names disabled tools; the Claude Code trim already denies Explore |
| AGENTS.md (frame + sweet rules) | reaches build and general (capture) | owner rule |
| glob, grep, skill | off (as mode 1) | ss-* duplicates; confirmed in mode 1 |
| todowrite | **kept** | removing it did not explain the max losses and did not prove harmless (max v max-todo: 1/6 each) |
| task tool | kept, general only | delegation is a real capability; owner rule |
| bash description | mode-1 edits only (4) | max-p1 lost graphql with the extra bash cuts; the Git section also stops commits, and the graded patch is `git diff HEAD` |
| task: "class Foo … use the Grep tool instead" | **kept, reworded**: "…search for it directly instead" (new) | restores the as-now deterrent that kept delegation at 0, and names no disabled tool |
| task: "Read or Glob tool" | "Read tool" (as mode 1) | names a disabled tool |
| task: note 7 "used proactively" | removed (new) | zero-risk: no listed agent says "proactive"; it only nudges delegation |
| task: "result … not visible to the user" | removed (new) | zero-risk: shapes only a user-facing summary; a headless run has no user |
| read: grep/glob pointers | removed (as mode 1) | name disabled tools |
| read: "can read image files and PDFs" | removed (new) | zero-risk: no task input is an image |
| "Working with the user" (commentary/final) | kept | removed in max; not zero-risk for a GPT-5.x model trained on the channel convention |
| autonomy/persistence, dirty-worktree, "ask" lines | kept | removed in max; the dirty-worktree lines protect AGENTS.md and untracked state |
| edit/write "Read first" (non-GPT families) | kept | behaviour change, not a zero-risk cut; GPT uses apply_patch |

### 6.2 Files

- `v3-runner.diff` — adds `OPENCODE_TRIM_V3_TOOL_EDITS`, mode `v3`, `opencodeHarnessTrimV3`.
  Existing modes are unchanged. Row mode string: `v3:prompt:<family>+general+noexplore+tools+tooldesc`.
- `v3-test.diff` — 17 new assertions in `tests/opencode-harness-trim.mjs` (build/general prompt
  byte-identity for gpt/default/claude, explore disabled, tools, turn cap on build only, every v3
  edit applies to the captured 1.18.4 descriptions, bash = round-1 bash, task and read wording).
  Also `V3` and `v3`-on-codex now throw.
- Both diffs pass `git apply --check` on HEAD. Full test file on the scratch harness: **ALL PASS**.
- Launch: `OC_HARNESS_TRIM=v3` (mac-smoke.sh and night-queue.sh pass the value through).

### 6.3 $0 capture (scripted fake model; `run.sh`, `script-sub.json`, `captures-v3/`)

The fake model calls `task(general)`, then `task(explore)`, then stops.

| request | as-now | mode 1 | v3 |
|---|---|---|---|
| main system prompt (chars) | 19,590 | 16,079 | 16,079 |
| main tools | 8 (apply_patch, bash, glob, grep, read, skill, task, todowrite) | 5 (apply_patch, bash, read, task, todowrite) | 5 (same) |
| main tool JSON (chars) | 18,216 | 14,409 | 13,604 |
| agents listed in task tool | explore, general | explore, general | **general** |
| general subagent system prompt | 19,590, untrimmed, Glob present | 18,888, untrimmed, Glob present | **16,079, trimmed, no Glob** |
| general subagent has AGENTS.md | yes | yes | **yes** |
| explore call | runs, explore prompt with Glob/Grep | runs, same | **"Unknown agent type: explore is not a valid agent type"** |
| plugin report | — | bash 4, read 2, task 2, 0 missing | bash 4, read 3, task 4, 0 missing |
| fixed prefix per main request (≈ chars/4) | ≈ 9,460 tokens | ≈ 7,630 (−19%) | ≈ 7,420 (−22%) |

The token counts are approximate (chars/4); no GPT tokenizer is installed.

### 6.4 Expected saving v as-now

- mode 1 rollouts that did NOT delegate (16 of 20 on the confirm set) cost **−9.4%** v as-now on
  the same tasks. v3 blocks the delegation path, so the delegating rollouts should behave like
  these.
- Estimate: **≈ −9 to −10% realized, subagents included**, plus ≈ −0.5% from the extra ≈200-token
  cut. Turns: ≈ −10 to −13%. mode 1's true figure is −4.8%.
- Risk: the agent may delegate to `general` instead of explore. That would move the cost back up.
  Watch the subagent count per rollout.
- Solves: the main-agent request equals mode 1 except the task and read wording. Expect mode 1's
  record: a tie. This is an expectation, not a measurement.

## 7. Validation A/B at the frozen-200 standard

1. **Preconditions.** Land the sidechain-inclusive ledger (defect 1), or report the analyzer's
   inclusive column. Without it, cost is biased toward whichever arm delegates. Disclose or fix
   the untracked-file blindness (defect 2); it hits both arms equally. Green env ledger. Record
   the AGENTS.md hash on each row.
2. **Population.** DEV-RET (the retired first held-out 200), minus vacuous and name-locked
   tasks. Same distribution as HO2. Never an HO2 task. Not the 13 tasks used here (they shaped
   v3).
3. **Arms.** sweet as-now v sweet `OC_HARNESS_TRIM=v3`. Native is not needed for this question.
4. **Pairing and order.** Pair by task. Randomise the arm order per task with a fixed seed
   (seed 42). Run both arms of a task in the same time window, so API and machine drift hit both
   arms. If the queue cannot interleave per task, use ABBA legs with the same task order, as the
   confirm set did.
5. **Stage 1 (go / no-go).** 60 tasks x 2 reps x 2 arms = 240 rollouts, about $4.5 and 12 h
   serial. Stop if v3 has 4 or more fewer solves (about −3.3 points).
6. **Stage 2.** All ~200 tasks x 3 reps x 2 arms = about 1,200 rollouts, about $22 (Luna on
   opencode costs about $0.018 per rollout). On this data, about 8% of pairs disagree. With 600
   pairs, the 95% interval on the solve difference is about ±2.3 points. With 2 reps (400 pairs)
   it is about ±2.8 points.
7. **Pre-registered decision.** Primary: paired solve difference, task-clustered bootstrap, 95%
   interval. Non-inferiority margin −2.5 points (5 solves per 200). Ship v3 only if the lower bound
   is above −2.5 points AND the inclusive-cost interval is below 0. Secondary: ideal cost, turns,
   calls, subagent requests per rollout (expect 0 on v3).
8. **Guards per rollout.** Plugin report 0 missing; mode string `v3:…`; 0 explore sessions;
   general sessions counted. Never pool runs across a shipped fix.
9. Wall time is the real limit, not money: one run-pilot at a time. The box cuts stage 2 from
   about 60 h (Mac, serial) to much less, if its queue is free.

## 8. Files in this folder

`REPORT.md` (this file) · `v3-runner.diff` · `v3-test.diff` · `harness-v3/` (patched scratch
copy) · `bench-v3/tests/` (patched test) · `subagent-turns.mjs` + `test-subagent-turns.mjs`
(proposed ledger fix) · `captures-v3/{asnow,mode1,v3}/` · `cap.mjs`, `script_proxy.py`,
`run.sh`, `script-sub.json`, `summ.py` (capture) · `dump.py` + `*-L*.txt` (session dumps) ·
`table.py`, `extract.py`, `inclusive.py`, `preedit.py`, `rows_all.json`, `rows_ext.json`,
`pertask.md` (analysis).
