# General engineering clauses — 17-task screen: PRE-REGISTRATION

**Written before the run.** No figure below was chosen after seeing a result.
**Why this exists:** the hint ladder produced one unplanned candidate — four general
engineering clauses that need no analyzer, no parser and no corpus. On five rotation tasks at
four reps they read `L0 11/20` against `GALL 15/20`, with no control regression in 100+
control rollouts. **`n=20` is not a result.** This screen is what turns it into one, or kills
it.

---

## 1. The vehicle, and why this is a product test rather than a science test

The ladder delivered the clauses through `problem_statement`, which reaches **both arms**.
That measured whether the rule helps anyone; it could not measure a sweet advantage.

Here the clauses are appended to the **`MPP` memory file**, which `agent-runner-shared.mjs`
writes into `AGENTS.md` / `CLAUDE.md` **only when `sweet` is true**. That is the same channel
`ss init` ships to a real user, so a win here is a product change.

**Stated plainly and in advance: the mechanism is arm-neutral.** These are general
engineering rules, not retrieval. If native shipped the same memory file it would plausibly
gain the same amount. The advantage claimed is a *product packaging* advantage — sweet writes
this file and a bare native setup does not — and it must never be reported as a retrieval or
search-quality result.

## 2. Conditions

| condition | `MPP` | arm | reps |
|---|---|---|---:|
| `NAT` | n/a (native gets no memory file) | native | 3 |
| `C0` | production prompt, unchanged | sweet | 3 |
| `CG` | production + G1 + G2 + G3 | sweet | 3 |
| `C14` | production + G1 + G4 | sweet | 3 |

`G1` family completeness · `G2` public surface and existing vocabulary · `G3` symmetry and
siblings · `G4` minimal change. Text frozen at `phase1-scripts/general-clauses.mjs`, unchanged
since the ladder. Every variant is produced by appending to the production file, so everything
else is byte-identical.

**Tasks:** the 18-task rotation pool, **less `dotnet__yarp-2825`** (ungradeable, D1) = **17**.
Model `openai/gpt-5.6-luna`, harness opencode, `CONCURRENCY=2`
(`pinned OpenCode 1.18.4 is unavailable` costs rollouts at 3), ledger
`/root/env-ledger/luna-rotate20-v3/ledger.jsonl`.
**Total: 17 × 3 × 4 = 204 rollouts.**

**Not fresh, and disclosed:** five of these 17 were used to select `GALL` in the first clause
screen. Results are reported **split** — the 12 unused tasks are the honest number, the 5
reused ones are reported separately and never pooled into the headline.

## 3. Pre-registered bars

**Primary (attribution).** Task-level, majority of 3 reps:

- **PASS:** `CG` (or `C14`) solves **at least 2 more tasks** than `C0` on the 12 unused tasks,
  **and no task drops from majority-solved to majority-unsolved.**
- **FAIL:** fewer than 2, or any control regression.

Any-rep counts are reported too, but the bar is on majority-rep. A single lucky rep is not
evidence, per §1.3 of the slate.

**Secondary (product).** `CG` versus `NAT` on task solves and on realized cost per solved
task. Reported, not a gate — the treatment cannot be judged against a bar it was not designed
to move in one screen.

**Cost guard.** The clauses add roughly 420 prompt tokens to every turn. **A cost increase
above 10% per rollout fails the screen even if resolution improves**, because the whole
argument for this candidate is that it is free.

## 4. What would make me discard the result rather than believe it

- Ledger not green at preflight → no run.
- More than 5 of 204 rollouts lost to harness errors → rerun, do not patch around it.
- A win carried entirely by the 5 reused tasks → not a result, report as selection.
- A win carried by a single task → report as a single-task effect, never as a rate.
