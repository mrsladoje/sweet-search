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
| Codex Luna | max-wait (exec yield 30 s; screen) | 3/6 (= max) | +17% v max | turns 91 → 107 — worse; max stays |
| opencode Luna | 1, round 1 | 1/6 → 2/6 | −21% | −10% |
| opencode Luna | max (todowrite off), round 2 | 3/6 → 1/6 | −38% | −39% — shorter, narrower fixes |
| opencode Luna | max-todo (screen, trim legs only) | 1/6 (graphql 1/2) v baselines 1/6, 3/6 | ≈ 0% ($0.117) | calls ≈ as-now — todowrite is NOT the cause, and keeping it removes the saving |
| opencode Luna | max-p1 (max tools/desc + round-1 prompt; screen) | 1/6 | $0.067 | not better on solves → opencode best stays 1 |
| CC Luna | max | 3/6 → 2/6 | −67% (OpenRouter bill, kept attempts) | 0 subagents v 2/6 delegating |
| CC Luna | lean (no Agent tool; screen) | 2/6 (graphql 2/2) | ≈ max: $0.297 v $0.308 billed | tie with max; max keeps delegation, so max stays |
| CC Opus | 1 | void (owner CLAUDE.md leaked) | | |
| CC Opus | max | 3/6 → 4/6 (graphql 1/2 → 2/2; as-now r2 graphql TIMED OUT at 30 min) | −22% (transcript cost, all 12) | calls 81 → 75; before 1st edit ss 16→37, shell search 29→13, shell read 12→5 |

## Confirm results (10 tasks x 2 reps per condition, confirm10 set)

| harness | variant | solves as-now → variant | realized cost | ideal cost | turns | before 1st edit (ss / shell search+read) |
|---|---|---|---|---|---|---|
| CC Opus 5.5 | max | 8/20 → 8/20 (eslint 1→2, svgr 1→0) | $3.79 → $3.40 (−10%) | $4.19 → $3.58 (−15%) | 155 → 194 (+25%) | 27/68 → 56/30 |

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

- 05:25 Opus confirm done (0 ungraded, 0 timeouts): max ties solves, −10% realized / −15% ideal,
  but +25% turns (Edit + separate run_tests + single-range ss-read instead of one batched shell
  call). By the owner's ranking (solves, cost, turns) → CC Opus best = max. Codex confirm running.

- 04:10 Colima VM disk FULL ("no space left on device") → 4/10 tasks of the Opus confirm leg 1
  graded NO-TEST-EVIDENCE. Freed ~30 GB by removing only swerebenchv2 images the night no longer
  needs (10 dropped candidates + 3 smoke images; tars kept); moved the smoke tars out of the
  launcher's load folder. Recovered the 4 ungraded rollouts with GRADE_ONLY_FROM (retained
  patches, no model calls): leg 1 as-now = 3/10. Original rows kept as rows.orig-before-regrade.json.

- 03:45 confirm-opus/confirm-codex failed at preflight (eslint-plugin-ember golden still building
  at 03:26); golden now complete. Re-queued as c2-opus (max), c2-codex (1), c2-opencode (1),
  c2-cc-luna (max). opencode max-p1 = 1/6 → opencode best = 1.

- 03:25 Codex max-wait loses to max (same solves, +17% cost, +18% turns) → Codex best = 1.
  confirm10 ready (10 gold-valid: svgr, maxgraph, brighterscript, datadog, fastify-cors,
  super_editor, bingo-271, jupytext-360, zlint-299, eslint-plugin-ember-551; 7/10 JS/TS).
  Queued confirm-opus (CC Opus as-now v max) then confirm-codex (as-now v 1); opencode confirm
  after max-p1; CC Luna confirm last if time.

- 03:05 CC Luna lean = tie with max (2/6, −3.5% cost, noise) → keep max. Codex max-wait screen running.

- 02:43 opencode ranking so far: mode 1 (2/6, $0.089) > max (1/6, $0.075) ≈ max-todo (1/6, $0.117).
  Next opencode test: max-p1 (queued).

- 02:25 opencode max-todo r1: 0/3 (graphql failed despite 2 files) — todowrite alone does not
  restore solves; queued max-p1 to test the second-pass prompt cuts.

- RULE: never edit mac-smoke.sh or night-queue.sh while bash runs them (bash reads scripts
  incrementally). 01:55 a stale Opus launcher picked up an edited mac-smoke.sh and started a
  stray run-pilot (killed; its golden build was interrupted — checking flask/pdm goldens).

- 00:35 night plan written; queue + prep agent + loop started (cron every 20 min).
- 00:50 added Codex mode max-wait (verified at $0) and queued its screen.
- 01:50 Opus smoke complete: max = best Claude Code (Opus) variant so far — +1 solve, −22% cost, search shifted to ss-*.
- 01:23 Opus max legs done (2/3, 2/3, both cheaper than as-now r1); waiting for as-now r2. Confirm-set prep sweeping the ledger.

## Morning follow-ups (not part of the A/B)

- ~/.ss-eval/golden/pallets__flask@4c288bc… is PARTIAL: the stray run-pilot (01:49–01:55) was
  indexing it when it was killed. Rebuild (ORT INT8 recipe) before any run uses that task.
- Both-arm items for the owner (outside tonight's scope): run_tests' self-contradicting verdict
  on build-failed packages; ss-search sufficient=YES on weak results; Luna code-mode exec wait
  (tested sweet-only as Codex max-wait: no gain); gitDiffPatch against the recorded base SHA.
