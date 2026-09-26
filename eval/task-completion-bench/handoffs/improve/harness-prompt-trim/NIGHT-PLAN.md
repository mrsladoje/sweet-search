# Night A/B plan — best sweet-only harness trim per harness (2026-09-26 night)

Owner asleep; loop wakes every 20 min. Read this file first on every wake-up.

## MORNING SUMMARY (best option per harness, 09:05 — updated as the last cells finish)

| harness | best option | evidence | status |
|---|---|---|---|
| Claude Code, Opus 5.5 | **`CC_HARNESS_TRIM=max-batch`** | confirm 10x2: 8/20 → 9/20 (no task lost); −22% realized, −26% ideal; turns +5% (max alone: +25%) | confirmed — best option. Caveat: its legs ran after the as-now legs, not interleaved |
| Claude Code, Luna | `CC_HARNESS_TRIM=max` | confirm 10x2: 6/20 → 6/20 (identical per task); −71% billed; 0 subagent requests (as-now 140) | confirmed — best Luna option. max-batch lost: 5/20, +10% billed (below) |
| Codex, Luna | `CODEX_HARNESS_TRIM=1` (max) | confirm 10x2: 6/20 → 4/20, −10% cost, turns flat; pooled with screen 6/26 → 7/26 | NOT a proven solve win; small cost saving. max-wait loses (+17% cost) |
| opencode, Luna | `OC_HARNESS_TRIM=1` (round-1 trim) | confirm 10x2: 6/20 → 5/20, −12% realized/ideal, −13% turns. Screens: max/max-todo/max-p1 each 1/6 (lost solves) | confirmed: cost + turn saving, solves ≈ equal |

Reading: every trim cuts cost; none shows a reliable solve gain at these sample sizes; the more
aggressive opencode cuts (max) lost solves on the screen, so opencode keeps the lighter trim.
All numbers: 6-20 rollouts per condition — directions, not publishable findings.

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
| CC Opus 5.5 | **max-batch** (trim legs 09:07–10:00, v the as-now legs of the same set) | 8/20 → **9/20** (eslint 1→2, no task lost) | $3.79 → $2.95 (**−22%**) | $4.19 → $3.11 (**−26%**) | 155 → 163 (+5%) | 27/68 → 63/36; cache writes −34% |
| Codex Luna | 1 (max) | 6/20 → 4/20 (eslint 2→1, zlint 2→1; both look like variance: alternate fix / self-added P2P break) | $0.374 → $0.335 (−10%) | $0.350 → $0.315 | 355 → 356 | all ss-* both arms |
| opencode Luna | 1 (round-1 trim) | 6/20 → 5/20 | $0.371 → $0.326 (−12%) | $0.344 → $0.302 (−12%) | 379 → 331 (−13%) | 0 tamper |
| CC Luna | max | 6/20 → 6/20 (identical per task) | $1.779 → $0.524 billed (**−71%**) | main-only ideal −33% (lower bound: as-now subagents excluded) | main turns 437 → 495; subagent requests 140 → 0 | |
| CC Luna | max-batch (trim legs 15:25–18:02) | 6/20 → 5/20 (eslint 2/2 → 1/2; max had 2/2) | $0.577 billed (−68% v as-now, **+10% v max**) | | main requests 419 (max 495); subagent requests 91, all in one svgr rollout ($0.174 of $0.577) | 180 / 0 |

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

- 18:05 CC Luna max-batch: 5/20 (one eslint solve lost v max and as-now), $0.577 billed v max $0.524; one svgr rollout delegated 91 subagent requests. → CC Luna best stays **max**; max-batch is Opus-only. Queue empty; next runs wait for the owner. Interim transcript audit (not yet verified here): Opus eslint +1 is harness-infra (as-now L1 ran in the disk fault); counting the discarded degeneration re-run attempts, Opus max ≈ −0.3% and max-batch ≈ −18% realized; untrimmed Mac arm had live WebFetch (one Explore subagent fetched the upstream fix, rollout still unsolved).

- 15:36 CC Luna confirm: max 6/20 = as-now 6/20, −71% billed (subagents 140 → 0) → confirmed. max-batch trim legs running.

- 10:03 Opus max-batch: 9/20 v as-now 8/20, −22% realized / −26% ideal, turns +5% → CC Opus best = max-batch. CC Luna confirm (max) running.

- 09:08 opencode confirm done: 6/20 → 5/20, −12% cost, −13% turns → opencode best = 1. Opus max-batch running (~10:10); CC Luna confirm last (~13:00-14:00).

- 07:05 Codex confirm: trim −2 solves (6/20 → 4/20), −10% cost, turns flat. Pooled with the
  round-2 screen (same trim): as-now 6/26 v trim 7/26, cost ≈ −8%. Verdict: NOT a proven solve
  win for Codex; solves ≈ equal, small consistent cost saving. opencode confirm running.

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
