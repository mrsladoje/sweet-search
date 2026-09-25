# Harness-trim micro-smokes — sweet as now v sweet + trim (2026-09-25, owner's Mac)

## 1. Conclusion

The trim is **safe** — 0 solves lost in 36 rollouts on three harnesses — but it is **not yet a
proven win**. On the two Luna harnesses the sweet arm got cheaper (Codex −40%, opencode −21%
realized) and gained one solve each (1/6 → 2/6). On Claude Code with Opus 5.5 solves were equal
(4/6 v 4/6) and cost did not move (ideal −0.6%, realized +8%): the predicted fixed-token saving
(about −14% realized) is smaller than the run-to-run spread, and one trimmed rollout alone cost
$0.60 against $0.31–0.39 for the same task untrimmed. With 6 rollouts per condition every number
here is a **direction, not a finding**. Native did not run, so nothing here compares sweet with
native.

## 2. Design

- Sweet arm only. Condition A = sweet exactly as the held-out legs ran it (switch 0).
  Condition B = the same + the harness trim (switch 1). The sweet rules file (p7-final), the
  override and the frame are byte-identical in both.
- 3 dev tasks (DEV-RET, `tasks_heldout.jsonl`; none in HO2): `gitbookio__markup-it-56` (JS),
  `pytask-dev__pytask-210` (Python), `jensneuse__graphql-go-tools-174` (Go). Gold-valid under
  the local ledger `results/ledger-trim-mac-20260925c`; 0 of 3 name-locked.
- 2 reps x 2 conditions x 3 tasks = 12 rollouts per harness, four legs in A-B-B-A order.
- `openai/gpt-5.6-luna` via OpenRouter, reasoning medium, pinned Codex 0.146.1 and opencode
  1.18.4 (PATH shims under `~/.ss-eval/`). `SS_ISOLATION=0` (no jail on macOS: disclosed),
  ORT INT8 query path, `scripts/mac-smoke.sh <harness>`, report by `scripts/analyze_trim_smoke.py`.
- Run ids: `results/trim-smoke-codex-20260925-1804-*`, `results/trim-smoke-opencode-20260925-1845-*`.

## 3. Validity checks

- **The treatment reached the agent.** Codex: the session log's base instructions are 8,062
  chars on every trimmed rollout (17,730 untrimmed) and the "reach first for `rg`" line is
  absent. opencode: every trimmed row records `prompt:gpt+tools+tooldesc` and the plugin report
  bash 4/4, read 2/2, task 2/2 edits applied, none missing.
- 0 of 24 rollouts SHIM-TAMPERED; every rollout graded.
- Earlier attempts were discarded, not pooled: Codex leg 1 of the first attempt (stopped to
  check a grading question — grading was sound) and the first opencode attempt (all rollouts
  wrongly SHIM-TAMPERED by an unjailed-path bug, fixed in `cef871e`).

## 4. Results (Luna)

### Codex 0.146.1

| condition | solved | realized $ | ideal $ | cache-write tokens | tool calls | wall (sum) |
|---|---|---|---|---|---|---|
| sweet as now | 1/6 | 0.146 | 0.138 | 167,172 | 95 | 12.7 min |
| sweet + trim | 2/6 | 0.088 (−40%) | 0.083 (−40%) | 113,170 (−32%) | 68 (−28%) | 8.8 min |

Per task, as-now → trim: markup-it 0/2 → 1/2, graphql-go-tools 1/2 → 1/2, pytask 0/2 → 0/2.
Search behaviour: both conditions searched ONLY with `ss-*` (54 v 48 ss-* calls before the first
edit, 0 shell searches, 0 shell reads) — Luna on Codex did not double-search even untrimmed, so
the Codex effect is cost and turn count, not a switch of search tool.

### opencode 1.18.4

| condition | solved | realized $ | ideal $ | cache-write tokens | tool calls | wall (sum) |
|---|---|---|---|---|---|---|
| sweet as now | 1/6 | 0.113 | 0.106 | 153,583 | 136 | 14.4 min |
| sweet + trim | 2/6 | 0.089 (−21%) | 0.082 (−23%) | 137,251 (−11%) | 122 (−10%) | 11.9 min |

Per task: graphql-go-tools 1/2 → 2/2, markup-it 0/2 → 0/2, pytask 0/2 → 0/2.
Whole-rollout tool counts: ss-* 76 → 62, other bash 46 → 46, run_tests 14 → 14; 0 native
grep/read in both.

### Reading

- Solves: +1 on each harness, 0 lost. Two single flips at n = 6 are consistent with noise.
- Cost: both drops exceed the fixed-token share alone (Codex request −37% chars, opencode −19%),
  and both harnesses made fewer calls. Part of the Codex drop is likely the removed
  commentary/progress-update rules (fewer preamble turns) — a harness-diet effect, not retrieval.
- pytask failed in all 12 Luna rollouts (a real partial fix: one `ValueError-True` variant of
  the hidden test fails). It is a floor task for Luna; it says nothing about the trim.

## 5. Claude Code 2.1.281, Opus 5.5 medium (owner's subscription)

> **CONTAMINATED — do not use for decisions.** An independent audit found that all 12 rollouts
> (both arms) loaded the operator's own `~/.claude/CLAUDE.md` as a "project" instruction file:
> Claude Code walks every ancestor of the working dir, and the Mac run dirs sit under `$HOME`.
> The private CLAUDE_CONFIG_DIR did not cover that path. Fixed after the run (runner writes
> `claudeMdExcludes` for every ancestor instruction file on unjailed runs; verified by capture).
> The run ids also named the condition (`...-trim-r1`) inside the memory path the model sees;
> the launcher now uses neutral ids. The same audit found that the cost difference is driven by
> one outlier (markup-it trim r2, a degeneration re-run) and that a 3x2 smoke cannot resolve a
> ~10% cost effect. Re-run before reading anything from this section.

Run ids `results/trim-smoke-claudecode-20260925-1915-*`. Treatment verified: every trimmed row
records `tools+steer`; first request 10,611–10,842 tokens trimmed v 19,470–19,701 untrimmed
(the box's held-out median is 19,194). 0 of 12 SHIM-TAMPERED; private config dir on every
rollout; 0 subagent requests.

| condition | solved | realized $ (sum / median) | ideal $ (sum / median) | turns | output tokens |
|---|---|---|---|---|---|
| sweet as now | 4/6 | 1.937 / 0.314 | 2.011 / 0.325 | 85 | 31,179 |
| sweet + trim | 4/6 | 2.094 / 0.361 (+8%) | 1.999 / 0.336 (−0.6%) | 99 | 36,122 |

Per task, realized $ (rep 1, rep 2), as-now → trim:
markup-it 0.388, 0.315 → 0.306, **0.601** (unsolved in all 4);
graphql-go-tools 0.677, 0.313 → 0.540, 0.416 (solved in all 4);
pytask 0.123, 0.121 → 0.109, 0.122 (solved in all 4).

Calls before the first edit (all 6 rollouts, Claude transcripts):

| | ss-* | shell search | shell read | Read tool |
|---|---|---|---|---|
| sweet as now | 14 | 16 | 19 | 0 |
| sweet + trim | 32 | 13 | 13 | 2 |

Reading: the trim moved search toward ss-* (+18 calls) with fewer shell searches and reads
(−9), in the direction the bash-first hypothesis predicts — but the agent still made 26 shell
search/read calls, so the duplication is reduced, not removed. The fixed-token saving (~8,800
tokens per request) did not show in the cost totals; the trimmed arm made more turns (99 v 85)
and one long markup-it rollout. Decisive reading needs more tasks and reps (Gate 4), not this
smoke.

## 6. Defects found and fixed while running

1. Unjailed rollouts that called `run_tests` were all marked SHIM-TAMPERED (`_rt_inflight` in
   the runner bin dir) and excluded — every harness except Codex (`cef871e`).
2. Luna runs Codex in "code mode": all calls are JavaScript inside one `exec` tool, so
   `rows.toolCounts` reports `ss = 0` for Luna Codex rollouts. The analyzer now reads the
   commands from the session logs. **Earlier Luna Codex rows (box legs) likely carry the same
   ss = 0 undercount — check before quoting any Luna Codex ss-* count.**
3. On the Mac, all three harnesses read the operator's home config (global CLAUDE.md / AGENTS.md,
   skills, MCP servers, auth). Each runner now isolates it on the unjailed path (`0749caa`,
   `a84b079`, `1574f2b`).
   **Correction:** Claude Code's ancestor-directory CLAUDE.md walk was NOT covered by
   `0749caa`; the operator's `~/.claude/CLAUDE.md` reached every Claude Code smoke rollout (§5).
   Fixed with `claudeMdExcludes` (unjailed only).
4. Run ids named the condition and appear in agent-visible paths on the Mac (Claude Code memory
   path; Codex skill paths in the untrimmed arm). The launcher now uses neutral ids (`hsmoke-*-L1..4`).
