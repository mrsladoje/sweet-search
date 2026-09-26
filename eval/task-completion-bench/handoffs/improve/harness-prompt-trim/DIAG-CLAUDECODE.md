# Claude Code 2.1.281 harness trim — integrity, behaviour and flip forensics (2026-09-26)

Scope: sweet arm only. Opus 5.5 medium (subscription) and `openai/gpt-5.6-luna` (OpenRouter).
Mac, `SS_ISOLATION=0`. Dev tasks only (smoke 3 = DEV-RET; confirm10 = DEV-RET + multilingual dev).
No held-out-2 file was read. Model spend: $0 (local-proxy captures that answer 400, the free
`count_tokens` endpoint, and the free OpenRouter `/generation` read of already-billed requests).

Files in this folder: `parse.py` (per-rollout parser), `rollouts.json` (its output),
`table.py` (condition table), `ROLLOUTS.md` (one row per rollout), `dump.py` (readable
transcript), `errs.py`, `discarded.py` + `discarded.jsonl` (cost of discarded attempts),
`billed-*.jsonl` (OpenRouter bill), `runner.diff` + `tests.diff` (proposed mode), `proto/`
(patched copy of `harness/` and `tests/`, the rest symlinks), `cap/` (captures, `count.py`,
`count-table.md`).

## 1. Conclusion

- **Every trimmed rollout got the intended mode.** All 162 rollouts carry the expected system
  prompt (hash-checked from the transcript's `prompt_snapshot`). The frame (3,016 chars) and the
  rules (6,004 chars) are byte-identical in every rollout of every condition. The operator's
  `~/.claude/CLAUDE.md` reached only the 12 contaminated S0 rollouts (both arms).
- **No solve flip was caused by the trim.** Opus eslint (+1 for max and max-batch) is a
  harness fault: the as-now rollout ran during the disk-full fault and never got a test
  verdict. Opus svgr and Luna pytask are design and signature lotteries. The Luna max-batch
  eslint loss is a frame dilemma (no test edits v a suite that stays red) that max resolved both
  ways. Opus graphql is a
  wrong-fix rollout that a Mac-only zsh glob error and a 30-minute wall timeout made worse.
- **Best Claude Code configuration, Opus 5.5: `max-batch` (keep).** 9/20 v as-now 8/20, with the
  one as-now loss explained by the fault. Cost −22% realized on kept attempts and −18% when the
  discarded re-run attempts are counted. Turns +5%. The same accounting turns `max`'s −10% into
  −0.3%, so `max-batch`, not `max`, carries the Opus saving.
- **Best Claude Code configuration, Luna: `max` is confirmed; `lean-batch` (new) is the better
  candidate.** Luna fills every optional Agent parameter, so each delegation becomes
  background worktree subagents. They cost money and never changed a solve (0 of 9 delegating
  rollouts flipped). `lean-batch` removes the Agent tool and keeps the batching line. It must
  pass a screen before it replaces `max`.
- **Luna max-batch is not better than max: 5/20 v 6/20, billed $0.58 v $0.52 (+10%).** One
  rollout (svgr, leg 2) delegated to 3 background subagents (91 subagent requests, $0.17, 30% of
  the cell's bill). Without svgr, max-batch is 18% cheaper than max ($0.39 v $0.48) and makes
  15% fewer main requests. The delegation trigger was a blind spot (the library the fix needs is
  not installed), not the batching line (max 0/26 v max-batch 1/20 delegating rollouts). The
  lost solve (eslint, leg 2) is a frame dilemma, not trim text (§4).
- **Four both-arm harness defects decide more solves than any trim text.** New files are
  invisible to `run_tests` and the grader until the agent stages them. On the Mac, zsh breaks
  `grep --include=*.ext`. Unjailed as-now subagents used the live web and fetched the upstream
  fix. Discarded re-run attempts are missing from every cost row.

## 2. Integrity (task 1)

Method: `parse.py` reads the kept main transcript of every rollout, its subagent transcripts
and `rows.json`. The transcript records the system prompt (`prompt_snapshot`), the loaded
instruction files, the agent listing, the bypass-mode steer (`auto_mode`), `gitStatus` and the
per-turn token reminder. Tools are not in the transcript, so the tool set was checked by $0
capture of the same code (`cap/count-table.md`) and by the tools that were called.

| check | as-now (Opus / Luna) | mode 1 (S0) | max / max-batch | lean |
|---|---|---|---|---|
| system block 0 | Anthropic prompt, 12 / 11 blocks | Anthropic, 11 blocks | our base prompt, sha `2cb77a04` / batch `d508c737`, 2 blocks | `2cb77a04` |
| bash-first steer (`auto_mode`) | Opus: `relaxed`, bypass, all 32 rollouts. **Luna: absent in all 26** | absent | absent | absent |
| `# Memory`, gitStatus, attribution, `<total_tokens>` | present | present | absent | absent |
| agent listing | claude, Explore, general-purpose, Plan, statusline-setup | claude, Plan | general-purpose only, our description | none |
| frame / rules sha | `b7e68cc8` / `77230e7a` | same + operator CLAUDE.md `0ebc7c33` | same | same |
| tools called | incl. none outside the trim set in main threads | — | Agent, Bash, Edit, Read, Write only | Bash, Edit, Read, Write |

- **Luna never received the bash-first steer, also untrimmed.** Claude Code picks the steer
  variant for Opus 5.5 only. The `THRIFTY_SONIC=0` part of every trim is a no-op on Luna.
- **Subagents.** Trimmed: 3 subagents (Luna max-batch L2 svgr). All 3 ran
  `CLAUDE_TRIM_SUBAGENT_PROMPT` and loaded the frame and the rules. As-now: 9 subagents. 7 were
  Explore or Plan, which Claude Code starts WITHOUT CLAUDE.md, so they had neither the frame
  nor the rules. They searched with `grep`/`find` and Read, and 2 of them used the web. The
  owner rule (every sweet subagent carries the rules) held on the trimmed arm and failed on
  as-now.
- **Contamination.** S0 (all 12 rollouts, both arms): operator CLAUDE.md, as known. New:
  - **Live web on the as-now arm.** Luna confirm as-now L4 brighterscript: an Explore subagent
    made 10 WebFetch calls to `raw.githubusercontent.com/rokucommunity/brighterscript/master/…`
    and 1 WebSearch. The results contain the upstream fix (`additionalIndexes` on
    `IndexedGetExpression`). The rollout timed out unsolved. Luna smoke as-now L4 markup-it: 1
    WebSearch (succeeded) and 1 WebFetch of the upstream issue (refused). The trim denies both
    tools, so this vector exists on the as-now arm only.
  - **Host visibility.** Three trimmed Opus svgr rollouts ran `find / -name h2x-plugin-jsx` and
    one ran `ls ~/.ss-eval` (it listed the eval folders and a credentials file name). Nothing
    useful was found. The same vector exists on both arms on the Mac.
- **Versions and settings.** Claude Code 2.1.281 on all 162 rollouts (the box's Luna leg used
  2.1.218 — disclose). Model and effort constant per backbone. `envConfigHash` identical per task
  across arms. Private `CLAUDE_CONFIG_DIR` on all. 0 SHIM-TAMPERED.
- **Timeouts.** 2, both as-now: Opus smoke L4 graphql and Luna confirm L4 brighterscript
  (30 minutes each).
- **Regrade.** Opus confirm L1 (as-now): 4 rollouts got `INFRA` from both of their `run_tests`
  calls ("no space left on device"). The regrade repaired the grading only. The agents worked
  without a verdict. One of them is the eslint loss (§4).
- **Degeneration re-runs: 16 rollouts, cost not in the rows.** The runner keeps the retry and
  drops the first attempt's cost from the row. Reason on every kept flag:
  `output-visibility-mismatch` (billed output far above retained output). On Opus, bingo trips it
  in every condition, which suggests the detector counts hidden reasoning, not a decoding
  blow-up. Discarded-attempt cost (Opus: token-priced from the transcript; Luna: OpenRouter bill):

| condition | discarded $ | kept $ | kept + discarded | v as-now |
|---|---|---|---|---|
| Opus confirm as-now | 0.41 | 3.79 | 4.20 | — |
| Opus confirm max | 0.78 | 3.40 | 4.18 | −0.3% (kept only: −10%) |
| Opus confirm max-batch | 0.50 | 2.95 | 3.46 | −18% (kept only: −22%) |
| Luna confirm as-now | 0.27 billed | 1.78 billed | 2.05 | — |
| Luna confirm max | 0 | 0.52 | 0.52 | −74% |
| Luna confirm max-batch | 0.32 | 0.58 | 0.90 | −56% (v max +72%) |

- **Luna sidechain cost.** On the OpenRouter route the transcripts carry zero usage for
  subagents, so the row costs miss them. All Luna dollars here are the OpenRouter bill of the
  kept attempt (main + subagents).
- **Order.** Opus as-now and max legs ran 03:43–05:18; the max-batch legs 09:07–10:00. Luna
  as-now and max 10:00–15:25; max-batch 15:25–17:xx. Arms were not interleaved within a task.

## 3. Behaviour (task 2)

### Condition totals

| condition | n | solved | $ | turns | calls | before 1st edit ss / shell search / shell read / Read | after 1st edit ss / search / read / Read | edits Edit-tool / shell | run_tests (FAIL) | subagent calls / turns | new file lost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus S0 as-now (contaminated) | 6 | 4 | 1.94 | 85 | 80 | 12/8/12/0 | 2/6/8/0 | 1/11 | 25 (9) | 0 | 0 |
| Opus S0 mode 1 (contaminated) | 6 | 4 | 2.09 | 99 | 99 | 30/4/3/2 | 8/5/5/0 | 10/5 | 24 (14) | 0 | 0 |
| Opus smoke as-now | 6 | 3 | 1.56 | 84 | 81 | 14/21/7/0 | 2/1/2/1 | 2/11 | 22 (9) | 0 | 0 |
| Opus smoke max | 6 | 4 | 1.30 | 79 | 75 | 26/1/2/0 | 10/2/3/0 | 2/7 | 23 (10) | 0 | 0 |
| Opus confirm as-now | 20 | 8 | 3.79 | 155 | 137 | 27/29/18/0 | 1/4/2/0 | 0/31 | 42 (13 + 8 INFRA) | 0 | 1 (shell-created) |
| Opus confirm max | 20 | 8 | 3.40 | 194 | 183 | 53/9/4/4 | 15/3/7/0 | 11/36 | 62 (24) | 0 | 0 |
| Opus confirm max-batch | 20 | 9 | 2.95 | 163 | 147 | 60/10/9/1 | 5/4/3/0 | 4/25 | 40 (16) | 0 | 0 |
| Luna smoke as-now | 6 | 3 | 0.93 billed | 354 | 348 | 107/0/0/0 | 81/0/0/7 | 49/13 | 20 (11) | 3 / 86 | 0 |
| Luna smoke max | 6 | 2 | 0.31 | 196 | 245 | 119/0/0/0 | 56/0/0/3 | 32/0 | 20 (11) | 0 | 0 |
| Luna smoke lean | 6 | 2 | 0.30 | 189 | 230 | 112/0/0/0 | 62/0/0/0 | 22/0 | 19 (9) | — | 0 |
| Luna confirm as-now | 20 | 6 | 1.78 | 691 | 751 | 224/0/0/9 | 152/1/0/13 | 177/1 | 91 (44) | 6 / 140 | 1 |
| Luna confirm max | 20 | 6 | 0.52 | 495 | 592 | 238/0/0/3 | 77/0/0/12 | 148/0 | 73 (35) | 0 | 2 |
| Luna confirm max-batch | 20 | 5 | 0.58 | 419 | 489 | 173/0/0/15 | 74/1/0/3 | 115/2 | 74 | 3 / 91 | 2 (eslint L2, svgr L2) |

Classes: a Bash call is split on `;`, `&&`, `|` and newlines after heredoc bodies are removed,
and `cd …` is dropped, so `cd x; ss-grep …` counts as ss (unlike `rows.toolCounts`). Priority:
shell edit > run_tests > ss > shell search > shell read. "First edit" = the first Edit/Write
call or shell edit. Per-rollout rows: `ROLLOUTS.md`.

### Opus

- **The trim moves search to ss-\*.** Before the first edit, shell search + shell read fall from
  47 (as-now) to 13 (max) and 19 (max-batch); ss-* rises from 27 to 53 and 60. The residual
  shell calls are mostly batched `cat`/`sed -n` of known files, `git status`, and — in svgr — a
  hunt for an uninstalled library (`ls node_modules`, `find /`).
- **max adds turns; the batching line removes them.** max switches edits to the Edit tool (11)
  and runs `run_tests` more (62 v 42). max-batch returns to shell-script edits combined with the
  check (25 shell edits, 4 Edit) and 40 `run_tests`. Median turns: as-now 7, max 9.5, max-batch
  7.5.
- **run_tests verdicts.** After a FAIL verdict the next step was another call in most cases (as-now
  11/13, max 21/24, max-batch 13/16). Rollouts that finished on a red full run: as-now 4, max 6,
  max-batch 6. All of them are bingo, jupytext or brighterscript, which no Opus rollout solved,
  and the as-now count is low because 4 as-now rollouts never got a verdict (INFRA). No early
  stop on a solvable task in any trimmed rollout.
- **New files.** All 12 Opus confirm rollouts that needed a new file (eslint, svgr) met the
  untracked-file defect. 11 found the cause and used `git add -N` or moved the code into a
  tracked file. The as-now eslint L1 rollout never got a verdict and lost its new rule file
  from the patch.

### Luna

- **Search is ss-only in every condition** (0–1 shell search/read calls in 52 main threads).
  The trim does not change Luna's search tools; it changes delegation and per-request cost.
- **Delegation.** As-now delegated in 8 of 26 rollouts (9 subagents, 226 subagent turns), always
  with `run_in_background: true`, `isolation: "worktree"` and a `model` value. max: 0 of 26.
  lean: no Agent tool. max-batch: 1 rollout (§5).
- **Per-request cost halves.** Main-thread bill per request: as-now 2.08 m$, max 1.06 m$. The
  first request is not cached on OpenRouter (as-now 15,573 prompt tokens, max 4,624), and every
  later request re-reads the prefix. Subagent spend on as-now: $0.34 of $1.78.
- **Tool errors (both arms).** Read with `pages: ""`: as-now 11, max 6, max-batch 13 (the note
  does not stop Luna). Edit "String to replace not found": 8–10 per 20 rollouts.
- **New files.** Luna writes new files with the Write tool and stages some of them with
  `git add`. Lost from the graded patch: as-now 1 (svgr), max 2 (svgr; bingo, 4 writes of one
  file), max-batch 2 (svgr; eslint L2, which un-staged its own files with `git reset`). No lost file was on a task that another rollout solved.

## 4. Solve flips (task 3)

| flip | evidence | class |
|---|---|---|
| **Opus eslint-551: as-now 1/2 → max 2/2, max-batch 2/2** | As-now L1 ran during the Colima disk-full fault. Both `run_tests` calls returned `status=INFRA` ("no space left on device"). The agent wrote: "The test environment can't start … so there's no pass/fail result". It created `lib/rules/no-classic-components.js` with `cat >` and never staged it, so the graded patch has only README.md, lib/index.js and lib/recommended-rules.js, and fails `should have documentation for all rules`. All 5 other Opus eslint rollouts wrote the same 6 files and solved it. | **harness-infra** (disk fault + untracked-file defect) |
| **Opus svgr-10: as-now 1/2 → max 0/2 → max-batch 1/2** | The hidden test is `should remove style tags`. The two solvers (as-now L4, max-batch L1) added `src/h2x/removeStyle.js` modelled on `removeComments`. The four failures kept the CSS as a string or template literal (`styleToTemplateLiteral.js`, `styleToString`, `inlineStyle.js`, `plugins/h2x.js`). max L2 first wrote `removeStyle.js` and then chose the string form. All six met the untracked-file defect and worked around it. The issue text does not say which behaviour is wanted. | **variance** (design-choice lottery) |
| **Opus graphql-174 (smoke): as-now 1/2 → max 2/2** | As-now L4 chose the base-schema route. Its `grep -rn "__typename" pkg --include=*.go` failed with zsh `no matches found: --include=*.go`, so it never listed the validator sites that the fix needs. A loop of per-package `run_tests` passed Bash's 600 s limit, the agent ran `pkill`, and the rollout hit the 30-minute wall (`exitReason=timeout`). | **variance**, made worse by a Mac-only zsh artefact and the wall timeout; trim-related only indirectly (the bash-first steer favours `grep`) |
| **Luna pytask-210 (smoke): as-now 1/2 → max 0/2, lean 0/2** | The hidden test calls the callable with `exc_info`. The solver passed `is_hidden(exc_info)`; the failures passed `frame` or nothing (same split as on Codex). The solver was a degeneration re-run. | **variance** (signature lottery) |
| **Luna eslint-551: as-now 2/2, max 2/2 → max-batch 1/2** (L2 lost) | The full suite stays red after a correct fix: the repo invariant "every rule has a test file" fails until the hidden tests add one, and the frame says "Do NOT modify test files". The six Luna rollouts took three routes. Wrote a test file anyway, ended green, solved: as-now L1, L4, max L2. Ended on the red full run, solved: max L3, max-batch L1. max-batch L2 refused both. It moved the rule out of `lib/rules/` into `lib/no-classic-components.js` as a "non-enumerable plugin rule", ran `git reset` on the new rule and docs paths, got a green run, and finished. Graded patch: `lib/index.js`, `lib/no-classic-components.js` — no `lib/rules/no-classic-components.js`, no docs. It was also a degeneration re-run (the first attempt cost $0.18). | **variance** on a both-arm frame dilemma (the frame's no-test-edit rule v a red suite that only hidden tests fix); not trim text — max took both of the other routes |

Mac artefact, both arms: `grep --include=*.ext` fails under zsh ("no matches found") in 8
calls, 7 of them in as-now Opus rollouts. It penalises the shell-search habit (as-now and
native) on the Mac only; the box shell must be checked before a Mac result is read as a box
result.

## 5. Luna max-batch delegation (task 4)

| Luna confirm | solved | billed kept $ | without svgr | discarded re-run $ | main requests | subagent requests |
|---|---|---|---|---|---|---|
| as-now | 6/20 | 1.779 | 1.711 | 0.268 | 691 | 140 |
| max | 6/20 | 0.524 | 0.475 | 0 | 495 | 0 |
| max-batch | 5/20 | 0.577 | 0.391 | 0.321 | 419 | 91 (all svgr L2) |

The svgr L2 rollout cost $0.174 (main $0.077, subagents $0.097), the most expensive trimmed Luna
rollout of the confirm set. Three degeneration re-runs (svgr L1, bingo L2, eslint L2) cost
another $0.32 that no cost row shows.

What happened (leg 2, `smooth-code__svgr-10`):
1. Search went ss-only: `ss-grep "plugins" --in node_modules/h2x-core` → "scope not found";
   `ss-grep … --in yarn.lock` → "not indexed". Read of `node_modules/h2x-core/package.json`
   failed twice (`pages: ""`, then "File does not exist"). `node_modules` is not installed in
   the working tree.
2. The agent's `<state_summary>` named the blind spot: "the available h2x extension point and the
   exact minimal source-level workaround". It then launched 3 general-purpose subagents, each
   with `run_in_background: true`, `isolation: "worktree"`, `model: "sonnet"`/`"haiku"` (both
   map to Luna on OpenRouter), `team_name: ""`, `mode: "default"`.
3. The subagents ran our subagent prompt with the frame and the rules. They made 69 ss-* calls,
   and two of them edited files and ran `run_tests` in their worktrees although the task said
   "do not edit files".
4. The main agent meanwhile created `src/h2x/escapeStyle.js`; `run_tests` failed with "Cannot
   find module './h2x/escapeStyle'" (untracked-file defect). It moved the code into
   `configToOptions.js` and told the third subagent "new untracked files are not picked up by
   validation". The final fix escapes the braces; the hidden test wants the style removed.

Cause:
- **Not the batching line.** The line is about shell steps. The parallel-calls line and the
  subagent description are identical in max, which never delegated in 26 rollouts. 0/26 v 1/20
  (Fisher two-sided p ≈ 0.43) is not a difference.
- **The trigger is a blind spot that search cannot close** (an uninstalled dependency). As-now
  delegations have the same shape: all 9 as-now subagent tasks were investigation or review
  ("Investigate …", "Confirm …", "Analyze …", "Review …", "Resolve …", "Assess …",
  "Diagnose …", "Audit …").
- **The mechanism is Luna's argument filling.** Luna fills every optional Agent parameter, so
  each delegation is a background worktree agent. The same filling makes Luna send
  `pages: ""` to Read.
- **Solves: no effect.** svgr is unsolved in every Luna rollout of every condition. Across all
  Luna runs, 9 rollouts delegated; none flipped a task (the two solved ones, eslint and
  super_editor, are solved in every condition).

## 6. Proposals (task 5)

The sweet rules, the frame, the 298-char override and native are untouched by every proposal
(verified by capture: rules sha `12e05cbb`, frame `1e48a18d`, override present verbatim, pages
note present, in all captures). Existing modes are byte-identical (the existing 114 test
assertions pass unchanged in the prototype).

### Opus 5.5: keep `CC_HARNESS_TRIM=max-batch`

- It is the only Opus mode whose saving survives full accounting (−18% including discarded
  attempts; max −0.3%). No solve lost; the one as-now loss is the disk fault.
- Nothing further is worth changing on the evidence:
  - **Restore text:** no trimmed Opus rollout shows a failure that a removed Anthropic paragraph
    would have prevented. The one behaviour change the trim caused (Edit-tool edits and more
    turns under max) is already fixed by the batching line.
  - **Remove more:** only the Agent tool was never used (0 subagents in 56 trimmed and 36 as-now
    Opus rollouts). `lean-batch` removes it: 7,738 → 6,575 first-request tokens (−15%). On the
    subscription route this prefix is cached for an hour across rollouts, so the saving is under
    about 2% per rollout. Optional, not recommended as a separate Opus cell.
  - **Batching line:** keep it as is. It returned turns to +5% and cut cache writes −34%.

### Luna: `CC_HARNESS_TRIM=lean-batch` (new mode) — screen it against `max`

`lean-batch` = `lean` + the batching line: our base prompt with the batching line, no Agent
tool, the same deny list and the same five env switches. Measured by $0 capture
(`cap/count-table.md`, Anthropic tokenizer, Luna route — the real OpenRouter tokenizer differs):

| mode | first request tokens | tools | agent listing |
|---|---|---|---|
| as-now (Luna route, no tool search) | 25,893 | 20 | 5 types |
| max | 7,664 | Agent, Bash, Edit, Read, Write | general-purpose |
| max-batch | 7,708 | same | general-purpose |
| lean | 6,507 | Bash, Edit, Read, Write | — |
| **lean-batch** | **6,545** | Bash, Edit, Read, Write | — |

Why: it keeps the two measured Luna gains (the per-request diet of max; the batching line's
15% fewer main requests, −18% without the delegating rollout) and removes the one Luna cost tail
(background worktree subagents: $0.17 on one max-batch rollout, $0.34 on as-now) that never
bought a solve. The batching gain on Luna rests on one confirm cell, so the screen must show it
again; if it does not, plain `lean` is the fallback. The owner rule holds trivially: there are no subagents. Risk: one
capability less; lean tied max on the smoke (2/6 v 2/6, $0.297 v $0.308). If the owner wants
delegation kept, `max` stays the Luna choice.

Exact diffs (`runner.diff`, `tests.diff`; apply with `patch -p0` in the repo root):

```diff
--- eval/task-completion-bench/harness/claude-code-task-runner.mjs
+++ harness/claude-code-task-runner.mjs
@@ -135,7 +135,7 @@
 // Mode values: unset/'0' = off (args and env byte-identical), 'tools', 'steer', '1' = both,
-// 'max' / 'lean' = the second pass below.
+// 'max' / 'max-batch' / 'lean' / 'lean-batch' = the second pass below.
@@ -219,11 +219,15 @@
-  if (m === 'lean') {
+  if (m === 'lean' || m === 'lean-batch') {
     // lean also drops the Agent tool (no delegation): opt-in only, reported separately.
+    // lean-batch = lean + the max-batch batching line. For Luna: Luna fills every optional Agent
+    // parameter (run_in_background, isolation: worktree, model), so a delegation becomes background
+    // worktree subagents — 140 subagent requests on the as-now confirm set and 91 subagent turns on
+    // one max-batch rollout, none of them changing a solve (DIAG-CLAUDECODE.md).
     return {
       mode: m,
-      args: ['--system-prompt', CLAUDE_TRIM_BASE_PROMPT, '--disallowedTools',
+      args: ['--system-prompt', m === 'lean-batch' ? CLAUDE_TRIM_BASE_PROMPT_BATCH : CLAUDE_TRIM_BASE_PROMPT, '--disallowedTools',
@@ -241,7 +245,7 @@
-  if (!['1', 'tools', 'steer'].includes(m)) throw new Error(`CC_HARNESS_TRIM=${m}: expected 0, 1, tools, steer, max, max-batch or lean`);
+  if (!['1', 'tools', 'steer'].includes(m)) throw new Error(`CC_HARNESS_TRIM=${m}: expected 0, 1, tools, steer, max, max-batch, lean or lean-batch`);
```

Tests (`tests/claude-code-cost.mjs`): 3 new assertions — max-batch = max + the batching line
(it had no test), lean-batch = lean + the batching line with the whole Agent tool LAST and no
`--agents`, lean-batch uses the max env and lean is unchanged. Prototype: 117/117 pass; the
current repo: 114/114.

### Rejected ideas (with the reason)

- **A subagent description that forbids investigation.** It would put search advice into
  harness text; the rules already cover sub-agents. Removing the tool is cleaner.
- **Deny Read on Luna** (6–11 `pages: ""` errors per 20 rollouts). It removes the native reader
  on the sweet arm only, which is a retrieval treatment, not a harness diet.
- **`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`** to stop background subagents. It also removes the
  Bash auto-background that keeps a long `run_tests` alive. Not worth the risk.
- **A prompt line about `git add -N`.** It would give the sweet arm a task-environment hint that
  native lacks. Fix the harness instead (§7).

## 7. Both-arm defects to fix before the next A/B (owner; outside the trim)

1. **Untracked new files** are invisible to `run_tests` and the grader (`git diff HEAD`). On
   Claude Code: 12 of 12 Opus confirm rollouts that needed a new file met it; one lost its rule file
   (eslint as-now L1); Luna lost files in svgr and bingo. Fix: `git add -N` for untracked,
   non-excluded files before each diff (as DIAG-CODEX §7 proposes).
2. **zsh on the Mac** breaks `grep --include=*.ext` (8 calls, 7 as-now). Run Claude Code with
   `SHELL=/bin/bash` on the Mac, or check which shell the box uses and match it.
3. **Unjailed web and host access.** As-now Explore subagents fetched the upstream fix; trimmed
   and as-now agents listed `~/.ss-eval` and ran `find /`. Mac runs need network denial and a
   host-path boundary on both arms, or they are not comparable with box runs.
4. **Discarded re-run attempts** are not in any cost column; record them per row. Check the
   `output-visibility-mismatch` detector on Opus (bingo trips it in every condition).
5. Also seen (known): `run_tests` FAIL verdict with `exit=0 introduced_failures=2` on
   brighterscript in every condition; zero-test targeted runs reported PASS (1–2 per condition).

## 8. Validation plan (task 6)

1. Fix §7 items 1–4 first. Never pool rollouts across those fixes.
2. Choose movable dev tasks: as-now solve rate between about 20% and 80%, at least 25% that need
   a new file, drop design/signature lotteries found here (svgr, pytask) or report them apart.
   The confirm10 set had 7 of 10 tasks that never moved.
3. **Interleave per task**: both arms back to back, seeded order, alternating which arm runs
   first. No leg-blocked A-B-B-A across hours.
4. **Integrity gate per rollout, automatic** (`parse.py` does it in seconds): system block 0 hash =
   the mode's prompt; no `auto_mode` on trimmed; no `# Memory`/gitStatus on trimmed; instruction
   files = run-dir CLAUDE.md + rules only; every subagent runs the trim subagent prompt and loads
   the rules; zero WebFetch/WebSearch; no path outside the run dir in any command.
5. **Luna screen** ($, OpenRouter): as-now v max v lean-batch, 30–40 movable tasks × 2 reps,
   interleaved. About $0.03 per trimmed rollout and $0.09 per as-now rollout on the confirm set:
   roughly $10–13 in total. Pass rule for lean-batch: solves ≥ max − 2, no rise in the guard
   metrics (lost new files, finished on red after green, zero-test PASS), cost ≤ max.
6. **Opus confirm** (subscription): as-now v max-batch on the same movable set, 2 reps. Report
   cost with discarded attempts included.
7. Pre-register the frozen-200 run only after 5–6 pass: one-sided non-inferiority on the
   per-task paired solve rate (lower bound ≥ −3 pp, task-cluster bootstrap), cost as the primary
   outcome, the trim reported as a harness diet, never as a retrieval gain.
