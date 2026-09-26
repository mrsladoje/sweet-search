# Night A/B plan — best sweet-only harness trim per harness (2026-09-26 night)

Owner asleep; loop wakes every 20 min. Read this file first on every wake-up.

## Goal and rules (from the owner)

- Find the BEST sweet-arm harness configuration for each harness: Claude Code (Opus 5.5 and
  Luna), Codex (Luna), opencode (Luna).
- Rank: **solves first, then cost, then turns** (then tool calls).
- Change ONLY the harness's own prompt / tools / settings on the sweet arm. NEVER touch the
  sweet-search rules file (p7-final), the frame, the ss-* engine, run_tests, or native.
  Every sweet subagent must carry the trimmed harness prompt AND the sweet rules.
- Opus on the owner's subscription: allowed freely.
- Design: screen on the 3 smoke tasks (trim legs only, baseline reused), confirm the best 1-2 per
  harness on ~10 fresh dev / held-out-1 (DEV-RET) tasks x 2 reps, as-now v best.
- Never a held-out-2 task. One run-pilot at a time. Commit + push to main.

## Machinery

- Queue: `scripts/night-queue.sh results/night-queue.txt` (running in the background). Append a
  line `<id>|<env>|<harness>|<trim>` to add a cell. Status: `results/night-queue.txt.status`;
  per-cell log `results/night-<id>.log`; rows under `results/hsmoke-*`.
- Report per cell: `python3 scripts/analyze_trim_smoke.py results/<run dirs>`; Claude Code +
  Luna costs: `scratchpad/kept_billed.py` (OpenRouter bill of the KEPT attempt only).
- Baselines (sweet as now, 3 tasks x 2 reps each round): Codex r1 1/6 $0.146, r2 0/6 $0.104;
  opencode r1 1/6 $0.113, r2 3/6 $0.121; CC-Luna 3/6 $0.930 billed; CC-Opus (running).

## Results so far (3 tasks x 2 reps per condition, direction only)

| harness | variant | solves (as-now → variant) | cost v as-now | calls / turns |
|---|---|---|---|---|
| Codex Luna | 1 (first trim), round 1 | 1/6 → 2/6 | −40% | −28% |
| Codex Luna | 1 (= max since e9a888b), round 2 | 0/6 → 3/6 | −3% | −4% |
| opencode Luna | 1, round 1 | 1/6 → 2/6 | −21% | −10% |
| opencode Luna | max (todowrite off), round 2 | 3/6 → 1/6 | −38% | −39% — shorter, narrower fixes |
| CC Luna | max | 3/6 → 2/6 | −67% (OpenRouter bill, kept attempts) | 0 subagents v 2/6 delegating |
| CC Opus | 1 | void (owner CLAUDE.md leaked) | | |
| CC Opus | max | 3/6 → 4/6 (graphql 1/2 → 2/2; as-now r2 graphql TIMED OUT at 30 min) | −22% (transcript cost, all 12) | calls 81 → 75; before 1st edit ss 16→37, shell search 29→13, shell read 12→5 |

## Queue (screens first)

1. oc-maxtodo: opencode max with todowrite kept (isolates the todowrite lever).
2. cc-luna-lean: Claude Code Luna, max without the Agent tool (delegation cost 86 subagent
   requests on as-now; max already stopped delegating).
3. codex-maxwait: Codex 1 + features.code_mode_buffered_exec=true (exec yield 10 s -> 30 s;
   verified by capture: the exec tool text says "Defaults to 30000 ms").
4. oc-maxp1: opencode max-todo tools/descriptions + ROUND-1 GPT prompt (isolates the
   second-pass prompt cuts).
5. Then decide; confirm best per harness on the 10-task set (prep running in parallel).

## Decision log

- 02:25 opencode max-todo r1: 0/3 (graphql failed despite 2 files) — todowrite alone does not
  restore solves; queued max-p1 to test the second-pass prompt cuts.

- RULE: never edit mac-smoke.sh or night-queue.sh while bash runs them (bash reads scripts
  incrementally). 01:55 a stale Opus launcher picked up an edited mac-smoke.sh and started a
  stray run-pilot (killed; its golden build was interrupted — checking flask/pdm goldens).

- 00:35 night plan written; queue + prep agent + loop started (cron every 20 min).
- 00:50 added Codex mode max-wait (verified at $0) and queued its screen.
- 01:50 Opus smoke complete: max = best Claude Code (Opus) variant so far — +1 solve, −22% cost, search shifted to ss-*.
- 01:23 Opus max legs done (2/3, 2/3, both cheaper than as-now r1); waiting for as-now r2. Confirm-set prep sweeping the ledger.
