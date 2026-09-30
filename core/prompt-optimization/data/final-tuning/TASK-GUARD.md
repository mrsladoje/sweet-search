# Task guard for V1 (`SS_VARIANT_CC_RULES_IN_PROMPT=1`) — prepared 2026-10-01, NOT launched

**Conclusion.** The guard is ready to launch, but two things block it now: the retrieval queue keeps ss-* daemons alive, and the Colima VM carries unrelated containers. The wiring is proven at $0. The ledger is already green. No model call was made.

What the guard can show: no solve loss on the four tasks Opus always solves, no new failure modes, and the cache-write drop that V1 should cause. What it cannot show: a cost effect. The expected effect (about −5%, my estimate) is far below the minimum detectable effect (15–19% for 20 pairs; `noise-floor` memory `project_microsmoke_noise_floor`).

## 1. Tasks (10, all DEV, none in HO2)

Source: `eval/task-completion-bench/handoffs/improve/harness-prompt-trim/HILLCLIMB.md` lines 25–28 ("Rotations"). Full task records: `eval/task-completion-bench/results/confirm10/specs.json` (main checkout; `results/` is gitignored). Pools: `CONFIRM10.md` (9 tasks DEV-RET = `select/.cache/tasks_full_heldout.json`, retired to dev on 2026-07-31; super_editor from the multilingual dev pool). `CONFIRM10.md` states none is an HO2 task. HO2 files were not opened.

| Rotation | Task id | Lang | Opus 5.5 sweet history (34 rollouts each, hill-climb cells 2026-09-29/30) | Mean ideal $ |
|---|---|---|---|---|
| A (4) | `zmap__zlint-299` | go | 33/34 solved (control task) | 0.143 |
| A | `superlistapp__super_editor-2516` | dart | 34/34 | 0.205 |
| A | `ember-cli__eslint-plugin-ember-551` | js | 34/34 | 0.212 |
| A | `joshuakgoldberg__bingo-271` | ts | 0/34 | 0.316 |
| B (6) | `smooth-code__svgr-10` | js | 18/34 (the only solve lottery) | 0.238 |
| B | `maxgraph__maxgraph-365` | ts | 0/34 | 0.111 |
| B | `rokucommunity__brighterscript-1050` | ts | 0/34 | 0.260 |
| B | `dbader__node-datadog-metrics-73` | js | 34/34 | 0.124 |
| B | `fastify__fastify-cors-285` | js | 0/34 | 0.147 |
| B | `mwouts__jupytext-360` | python | 0/34 | 0.240 |

Reading: four tasks always pass (datadog, eslint-ember, super_editor, zlint). Five never pass (cost and behaviour only). Only svgr can flip. Opus used ss-* on average 0–2.7 times per rollout and never delegated (0 of 340 rollouts had a subagent).

## 2. Wiring (worktree only, uncommitted)

- `eval/task-completion-bench/harness/claude-code-task-runner.mjs` (+28 / −5 lines). With `SS_VARIANT_CC_RULES_IN_PROMPT=1` on the sweet arm the runner (a) writes no `.claude/rules/sweet-search.md`, (b) passes the switch to `installClaudeLeanHarness` through its `env` argument. **The env did NOT reach it before:** the runner passes its own `routingEnv`, not `process.env`, so the switch was invisible to the installer. (c) Refuses to run if the lean harness is off, if `SWEET_RULES_PLACEMENT` is set, or if the MPP text differs from the product rules (`getPolicyBody('cli')`; today the two are byte-equal). (d) Checks the agent file holds the rules exactly once and that no rules file exists. (e) Stamps `ccRulesInPrompt: true` on the row, only when on.
- New: `final-tuning/scripts/task-guard.sh` (launcher), `task-guard-compare.py` (read-out), `task-guard-zero-cost-check.mjs` ($0 proof).
- Worktree only: `eval/task-completion-bench/.venv-grade/` is a directory of symlinks to the main checkout's venv (grading needs it; it is gitignored).
- The existing `hc-smoke.sh` / `mac-smoke.sh` hard-code the MAIN checkout (`REPO=/Users/admin/Projects/sweet-search-private`). They would run the main runner without the wiring. Use `task-guard.sh`.
- The existing `SWEET_RULES_PLACEMENT=system` is a different treatment (rules appended at the END of the main, general-purpose and Plan agent files). V1 puts the rules in the main agent file only, BEFORE the per-repo memory section.

### $0 proof (run: `node core/prompt-optimization/data/final-tuning/scripts/task-guard-zero-cost-check.mjs`, about 1 s)
A fake `claude` on PATH records what the real `runClaudeCodeTask` installs (sweet arm, product lean harness, unjailed). Three cases: committed runner (`git show HEAD:`), working-tree runner off, working-tree runner on. Result 2026-10-01: **17/17 PASS.**
- OFF: committed runner == working-tree runner for all 10 installed files, argv and env (byte-identical). The bench agent file also equals what `installClaudeLeanHarness` writes for `init` (promptEdits true).
- ON: the only removed file is the rules file. The changed files are the main agent file (+6,006 bytes: the rules text, before `# Session context`) and the harness manifest hash. Everything else is identical: general-purpose and Plan agent files, `CLAUDE.md` frame, settings, argv, env. The bench ON agent file equals what `init` would write with the switch on.
- Existing tests still pass: `tests/claude-code-cost.mjs`, `sweet-rules-placement.mjs`, `frame-invariants.mjs`, `harness-batch-variants.mjs`, `env-ledger-gate.mjs`.
- Known side effects: (1) the operator env reaches the agent (`buildAgentEnv` spreads `process.env`), so the agent can see the switch name; every other `CC_*` switch does the same today. (2) In the variant the subagent files (general-purpose, Plan) carry no rules and no rules file exists, so a subagent would lose the rules. Opus never delegated in 340 rollouts, so this cannot matter here. It matters for the product decision.

## 3. Infra status (checked 2026-10-01 01:40, nothing started or changed)

| Item | Status |
|---|---|
| colima | `default` profile RUNNING (4 CPU, 8 GiB, docker socket `~/.colima/default/docker.sock`). Not started by me. |
| docker | reachable; server 29.2.1 |
| 10 task images | all 10 present locally (`swerebenchv2/...`, 1.8–5.9 GB each); 10 tars in `~/.ss-eval/image-tars/` |
| CLI | `~/.ss-eval/bin-claude-2.1.281/claude` reports 2.1.281 (points at `~/.ss-eval/claude-2.1.281-pkg`, outside the auto-updater folder) |
| token | `~/.ss-eval/claude-sub.env` exists, mode 600, has one `CLAUDE_CODE_OAUTH_TOKEN=` line (not printed) |
| goldens, model cache | present for all 10 (run-pilot preflight checks both and passed) |
| Model / effort | `claude-opus-5-5`, `REASONING=medium` (what every hill-climb cell and `mac-smoke.sh` / `hc-smoke.sh` use) |
| RISK: VM sharing | unrelated containers run in the same VM: `semantic-os` (2.5 GiB) and 15 `sensortracker-*`. Available VM memory 4.4 GiB. Cell B runs 6 emulated x86 test containers at once. |
| RISK: VM disk | `/var/lib/docker` 84% used, 16 GB free. A disk-full on 2026-09-26 04:10 broke 4 of 10 gradings. Do not pull or build new images. |
| BLOCKER: ss-* daemons | 20 `sweet-search-daemon` / `sweet-search-maintainer` processes alive, cwd `sweet-search-final-tuning/core/search` (the retrieval queue). `task-guard.sh` refuses to start while they live (CPU ORT and GPU paths must not coexist; run-pilot's end-of-run reap could also hit them). Wait for the queue to finish. |

## 4. Green ledger

- **Green now.** `results/bsmoke-ledger-fix5/ledger.jsonl` (main checkout, swept 2026-09-29 23:18): 10/10 `gold-valid`, FULL. `PREFLIGHT_ONLY=1` run from THIS worktree on 2026-10-01, for both arms' env, both cells: `pre-flight OK: 4/4` and `6/6 ... gold-FULL under current config`.
- **The variant does not change the fingerprint.** `taskConfigHash` covers: image, image id, test command, network, excluded tests, install seds, and the hashes of `rt-*.mjs`, the grader files (`evaluator-runtime.mjs`, `sr-eval.py`, `upstream-patches/eval.py`, `cargo_log_parser.py`) and the generated run_tests shim text (`harness/env-ledger.mjs`). `claude-code-task-runner.mjs`, `install-claude-lean-harness.js` and `_ss-helpers.mjs` are not in it. The preflight above ran after my runner edit and still passed.
- **Do not use** `results/confirm10/ledger/ledger.jsonl`: stale (all 10 hashes differ from current code).
- **If a later harness or grader edit makes it stale**, re-sweep (gold grading, no model, about 17 min upper bound from `CONFIRM10.md` grade times, so NOT run now):
  ```
  cd /Users/admin/Projects/sweet-search-final-tuning/eval/task-completion-bench
  M=/Users/admin/Projects/sweet-search-private/eval/task-completion-bench
  DOCKER_HOST=unix:///Users/admin/.colima/default/docker.sock SR_EVAL_DIR=$HOME/swe-rebench-tools/SWE-rebench-V2 TMPDIR=$HOME/.ss-eval/tmp \
    node harness/env-ledger-sweep.mjs --tasks $M/results/confirm10/specs.json --ids $M/results/confirm10/ids.json \
    --out results/tg-ledger-$(date +%Y%m%d) --batch 1 --max-workers 1
  # then: GUARD_LEDGER=$PWD/results/tg-ledger-<date>/ledger.jsonl bash <script> ...
  ```
  The sweep removes task images after grading; `task-guard.sh` reloads them from the tars.

## 5. Design (microsmoke gates)

- Gate 0 ($0 exposure): done (section 2). The treatment takes effect, and the off path is byte-identical.
- Arms: `base` = shipped 2.8.2 sweet (switch unset: product lean harness + read6fs, rules in `.claude/rules/sweet-search.md`). `var` = switch on. Both run this worktree's code.
- Cells: A (4 tasks, concurrency 4) and B (6 tasks, concurrency 6), as in every hill-climb cell. One pilot per cell per rep (reps of one task share a state dir). **REPS = 2** (skill minimum): 8 pilots, 40 rollouts (20 per arm).
- Order is interleaved; it flips on rep 2: rep 1 = A-base, A-var, B-base, B-var; rep 2 = A-var, A-base, B-var, B-base. Drift falls on both arms (Opus was stable in test-retest, but cost drift is large on other harnesses).
- Matched caps: `MAX_TOOL_CALLS` default 60 in both arms; the launcher unsets `MAX_TOOL_CALLS`, `MPP`, `SWEET_RULES_PLACEMENT`, `CC_HARNESS_TRIM`, `CC_TRIM_BATCH`, `CC_PRODUCT_*` for both arms. Fix switches as in every cell since fix5: `BENCH_INCLUDE_UNTRACKED=1`, `RT_ATTACH_REQUIRE_SAME_DIFF=1`. Never pool these rows with runs before fix5.
- Run ids are neutral (`tg-<stamp>-L<n>`); the arm map is in `results/tg-<stamp>.manifest`.
- Power: 20 pairs give a cost MDE of 15–19% (80% power). Use `GUARD_REPS=3` (12 pilots, about 1.5 h) only if you want 12–15%; the expected effect is still below it.

### Decision rule (fixed before any result)
1. **FAIL (V1 is not safe for tasks):** var loses 2 or more solves on the four always-solve tasks (zlint, super_editor, eslint-ember, datadog; 8 rollouts per arm; prior failure rate 1 of 136, so two losses in 8 are not noise). One loss: read the transcript; re-run that task once if the cause is infra or a degenerate re-run, not the variant.
2. **svgr** (53% prior): report only. 0/2 vs 2/2 is not evidence (p about 0.2).
3. **Never-solved five:** a solve in either arm is luck or signal; report, do not decide on it.
4. **Flags (each needs a transcript look, none is a fail alone):** ss-* share of search and read calls down more than 5 points; tool calls up more than 15%; more degenerate or re-run rollouts; patch file set differs from base on a task that did not solve; any subagent request in var; request-1 cache write not lower in var.
5. **Cost:** direction only. A CI that spans zero is expected. Use `idealCostUsd` (cache-normalised), never realized cost, for the A/B (microsmoke Gate 3; in `p8` one arm paid a one-off +10k cache-write artefact).

## 6. Commands

Run in this order, from `/Users/admin/Projects/sweet-search-final-tuning`. All are safe to read; only steps 2–3 spend subscription.

```
# 0. $0 proof and $0 preflight (both already PASS; repeat right before launch)
node core/prompt-optimization/data/final-tuning/scripts/task-guard-zero-cost-check.mjs
bash core/prompt-optimization/data/final-tuning/scripts/task-guard.sh preflight

# 1. dry run: prints the 8 pilot commands, runs nothing
GUARD_DRY=1 bash core/prompt-optimization/data/final-tuning/scripts/task-guard.sh both

# 2. RECOMMENDED: baseline and variant in one interleaved run, then the read-out prints by itself
GUARD_STAMP=$(date +%Y%m%d-%H%M) bash core/prompt-optimization/data/final-tuning/scripts/task-guard.sh both

# 2b. or as two commands (same stamp, run in this order: base legs first, then var legs; legs keep their interleave position)
export GUARD_STAMP=$(date +%Y%m%d-%H%M)
bash core/prompt-optimization/data/final-tuning/scripts/task-guard.sh base     # baseline run: 4 pilots, 20 rollouts
bash core/prompt-optimization/data/final-tuning/scripts/task-guard.sh var      # variant run:  4 pilots, 20 rollouts

# 3. read-out (also printed at the end of `both`)
python3 core/prompt-optimization/data/final-tuning/scripts/task-guard-compare.py eval/task-completion-bench/results/tg-<stamp>.manifest
```
Prefer 2 over 2b: 2b gives up the drift control. To resume after a usage-limit stop, re-run the same command with the same `GUARD_STAMP`: finished legs are skipped.

**Expected cost.** About 6 minutes per pilot (earlier 3-leg Opus cells took 11–35 min), so 8 pilots take about 50–80 minutes, plus a first-run warm-up. Claude Code on the subscription (no cash): 40 rollouts of 4–17 tool calls each, about $8 API-equivalent (20 × $0.20 per arm; hill-climb mean $0.1996 per rollout). The box's HIGH leg shares the subscription; a usage-limit hit stops the script and keeps finished rows (`results/tg-<stamp>.status`).

## 7. How to read the result

`task-guard-compare.py` prints: per arm (n, solved, ideal $, real $, turns, calls, ss / native-grep / native-read / bash calls, subagent requests, degenerate re-runs, run_tests without verdict, ungraded, request-1 cache-write and input tokens); the paired ideal-$ geometric mean (bootstrap, seed 42; with and without svgr and bingo); a per-task table; automatic RED FLAGS.
- **Mechanism check (did V1 fire?):** request-1 cache-write tokens per rollout should be lower in var by about 1.4–2.3k (retrieval smoke: −2.3k). If it is not lower, the rules did not move; stop and inspect the agent file in `~/.ss-eval/runs/...` before reading anything else.
- **Solves:** section 5 rule. Solves per arm, then per task.
- **New failure modes:** wrong-file edits (patch-file sets differ; open `results/<run>/trajectories/<task>-sweet-r0.json` and the preds file); more native fallbacks (ss-* share falling, `nativeGrep` / `nativeRead` rising); degenerate loops (`degenReran`, `degenerate`, calls up 15% or more, `exitReason` other than `model_stopped`); missing run_tests verdicts (`rtNoVerdict`); SHIM-TAMPERED or ungraded rows (infra; never count as a variant result; re-run with `GRADE_ONLY_FROM` if only grading failed).
- Row stamps: var rows carry `ccRulesInPrompt: true` and `sweetRulesPlacement: file`; base rows carry neither `ccRulesInPrompt`.
- This guard is dev-tuned data. Do not publish its numbers. No held-out data is involved.

## 8. Blockers and risks (owner actions)

1. Retrieval queue alive (ss-* daemons): wait, or the owner stops it. The launcher refuses otherwise.
2. Unrelated containers in the same Colima VM (`semantic-os`, `sensortracker-*`): owner decides whether to pause them for the run. I did not touch them.
3. VM disk 16 GB free: check `docker system df` before launch; no image pulls.
4. Worktree edits are uncommitted by instruction: `claude-code-task-runner.mjs` (modified); `task-guard.sh`, `task-guard-compare.py`, `task-guard-zero-cost-check.mjs`, `TASK-GUARD.md` (new); `.venv-grade/` (ignored symlink dir). The worktree also holds unrelated uncommitted files (retrieval runner, r3 verify data) that are not mine.
5. Product note for V1 (not a guard issue): with the rules only in the main agent file, subagents lose the rules. Decide before shipping whether `init` should also append them to the general-purpose and Plan agent files.
