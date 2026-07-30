# Held-out 2 — selection rules (pre-registration)

**Status:** written and committed BEFORE the seed was used. Nothing below may change
after the draw except through the replacement policy in §7.
**Date:** 2026-07-30
**Seed:** `20260731`
**Amendment 1 (2026-07-30), before any task content was inspected:** the first draw under
seed `20260730` exposed a degenerate deficit rule and an exclusion rule that is more
expensive than it is protective. Both were amended (§2, §3), the burned seed was retired
with its draw (kept at `select/discarded-draw-20260730/`), and a fresh seed was taken. The
amendment rests only on per-language repo counts; no task diff, patch, statement or result
was consulted. Full disclosure in `FAIRNESS.md` §7.
**Implementation:** `select/select_heldout2.py` — this document is the specification,
that script is its mechanical execution and nothing else.
**Fairness statement:** `select/FAIRNESS.md` (the pre-registration snapshot the paper cites).

Held-out 1 (`tasks_heldout.jsonl`, seed 20260715) is RETIRED as frozen evidence and is not
touched by any step here. This set exists because held-out 1's environment was porous
(PLAN.md §2) and its 200 tasks have since been read task-by-task during forensics.

---

## 1. Population

- `nebius/SWE-rebench-V2`, revision pinned to
  `475dd5e8703bb5fb22dd3c60b5d038b019eba1e0` — the same snapshot as the dev-200 and
  held-out 1, so all three sets draw from one identical pool. Pinning is what makes the
  draw reproducible from a committed artifact rather than from whatever the Hub serves
  later.
- V2 only. The V1 leaderboard population (`nebius/SWE-rebench-leaderboard`) is Python-only
  and is used for the separate recency check; drawing from it would distort the language
  quotas. Its drawn instance ids are on the tier-A exclusion list (§3).
- Base filters, unchanged from both previous sets: `meta.llm_metadata.code == 'A'`;
  non-empty `FAIL_TO_PASS`; full date range.

## 2. Quotas — external source only

Language quotas are the **same fixed, Octoverse-2025-anchored weights used for held-out 1**
(`HELDOUT_PREREGISTRATION.md` §"Language distribution"), reused verbatim rather than
re-derived, so no new judgement enters the set:

| lang | n | | lang | n |
|------|---|-|------|---|
| ts | 30 | | c | 8 |
| python | 30 | | php | 8 |
| js | 26 | | kotlin | 6 |
| java | 20 | | swift | 4 |
| go | 18 | | scala | 2 |
| rust | 18 | | dart | 2 |
| csharp | 12 | | elixir | 2 |
| cpp | 10 | | julia | 2 |
| | | | r | 1 |
| | | | clojure | 1 |
| | | | lua, ocaml | 0 |

Total = 200. The anchor is GitHub Octoverse 2025 most-used-language rankings, mapped onto
the 20 languages SWE-rebench-V2 carries. **No quota, in either direction, is derived from
any sweet-vs-native performance profile, per-language result, or forensic finding.**

**Deficit rule (AMENDED 2026-07-30 — proportional):** if a language's post-exclusion pool is
smaller than its quota, that quota is cut to the pool size and the pooled shortfall is
redistributed over the languages that still have spare pool, **in proportion to their
pre-registered quota**, by largest remainder, capped at each language's spare pool, with
unplaced slots going round again. Remainder ties break by larger pre-registered quota, then
alphabetically. Applied deterministically inside the selector and logged in the manifest as
`{shortfall, given_up_by, absorbed_by}` — pooled, not pairwise, because a pairwise arrow
would be an invention.

*Why amended:* held-out 1's rule moved the shortfall one slot at a time to "the largest-quota
language with spare pool" evaluated against the **running** quota, so the language that had
just received a slot was the largest again. Under held-out 1's tiny deficits this never
showed; here the C-family shortfall is large, and the first draw put **all 26 freed slots on
python** (56 python, 28% of the set, against a pre-registered 30). Proportional
redistribution keeps the shape of the external anchor instead of silently replacing it with
one language.

## 3. Exclusions — two tiers, applied before the draw (AMENDED 2026-07-30)

Held-out 2 must be independent of what we have actually learned from, which is not the same
as every repo we have ever touched. The frozen snapshot
`select/HELDOUT2_EXCLUDED_REPOS.json`, built by `select/heldout2_exclusions.py` from
committed inputs, therefore carries two tiers.

**Tier A — instance id, excluded unconditionally (730 ids).** Every task ever drawn or run:
dev-200; held-out 1 (final roster, `.prereplace-2026-07-21` roster, and both sides of every
promotion in `HELDOUT_REPLACEMENTS_2026-07-21.json`); the reserve-101 population; the
decontam population; and every `instance_id` appearing in any `rows.json`, `preds-*.jsonl`
or env-ledger file on the box or the Mac (`exclusion-sources/run-history-instance-ids.txt`),
which catches pilots, smokes and probes that never became a named set. Non-negotiable: those
tasks' gold patches, failure modes and per-task narratives are written into `PLAN.md` and the
forensics documents.

**Tier B — whole repo, for repos we have task-level knowledge of (268 repos).**
1. **dev-200 repos** — every lever, prompt variant and per-task override was tuned with these
   in view.
2. **Repos of tasks read call-by-call in forensics** — extracted mechanically from `PLAN.md`
   and `FORENSICS-*.md` (27 repos). We know these codebases and their gold fixes in detail.
3. **Repos of tasks with a hand-written `harness/task-overrides.json` entry** (110 repos) —
   writing an override required inspecting that task's suite.

**Not excluded at repo level (tier A only): 379 repos** we ran in aggregate or merely
golden-indexed — most of held-out 1, the reserve population, decontam, and the golden
inventories. A *different* pull request in such a repo leaks nothing we possess: the golden
index and any environment repair are identical for both arms, so they move attrition, not
the comparison. Their identities are still recorded in the snapshot under
`audit_only_repos_NOT_excluded_at_repo_level` so the choice is auditable.

*Why amended:* full repo-level exclusion of all 647 touched repos costs essentially nothing
for the eight big languages (100–650 candidate repos against quotas of 8–30) but exhausts the
C family. It also does not rescue it: SWE-rebench-V2 holds only **12 C++ and 17 C# repos at
quality A in total**, and under the one-task-per-repo rule (§5) even *zero* repo exclusions
would yield at most 4 C++ and 6 C# tasks. Held-out 1 and dev-200 reached their C-family
quotas by repeating repos (b2 ×3, moq ×3, zeek ×4, kiota ×5) and consumed most of the rest.
The C-family shortfall is therefore a property of the population, not of the exclusion
policy, and the exclusion policy is set on its own merits: keep it where we genuinely learned
something, drop it where we did not.

The snapshot is committed **before** the seed is used. Regenerating it after the freeze would
silently change the draw and is not permitted for this set.

## 4. Task-rejection gate — before the seeded draw

`select/task-gates.json` via `select/task_gates.py`, exactly as wired for the dev and
held-out-1 selectors: reject `FAIL_TO_PASS >= 100` or `PASS_TO_PASS == 0`. Metadata-only
and outcome-blind — it reads list lengths in the task spec, never a run result. Applied to
the primary **and** the reserve, since a reserve can be promoted into the set. Every
rejection is logged with id + counts and written to `select/REJECTED_heldout2.json`.

## 5. One task per repo

At most one task per repo across the primary 200 **and** the reserve. Held-out 1 did not
have this rule and carried 17 repos with more than one task, plus 40 repos shared between
primary and reserve — so a promoted reserve could put the same codebase in the set twice.
Two tasks from one codebase are not independent draws, which the paired tests assume.

Mechanically: within each language, tasks are grouped by repo (repos visited in sorted
order), each group is shuffled with the run seed and its first task kept. Selection then
proceeds on the deduplicated pool. This is deliberately a seeded pick rather than
"lowest instance id", which would systematically favour older pull requests.

## 6. Sampling

- Pool built, exclusions applied, gate applied, one-per-repo dedup applied — in that order.
- Within each language: candidates sorted by `instance_id`, shuffled with
  `random.Random(20260731)` (one RNG shared across languages, languages visited in sorted
  order — same scheme as dev-200 and held-out 1), then the quota is taken from the front.
- **Seed = 20260731**, fixed in this document before the draw. (`20260730`, the freeze
  date, was the first draw's seed and is retired with it — see Amendment 1.)
- Selection is **outcome-blind**: language, repo, instance id, `FAIL_TO_PASS` /
  `PASS_TO_PASS` counts, base commit, image name and license are the only fields consulted.
  No task diff, problem statement or issue text is read by a human or by the selector to
  include or exclude any specific task.

## 7. Reserve and replacement policy

- Reserve = `ceil(0.3 x primary quota)` per language, minimum 1 where the quota is
  non-zero → **67 tasks**, drawn from the next ranks of the same seeded shuffle, so the
  primary 200 is byte-identical whether or not the reserve is drawn. Held-out 1 used 50%
  (101) and consumed 40 of them (33 promotions + 7 reserve refills); 67 is roughly double
  the observed need.
- **A task may be replaced only for a mechanical, arm-neutral reason:**
  (a) the golden image or checkout will not build; (b) the suite will not reach gold-FULL
  under the exact run config after reasonable environment repair
  (`harness/task-overrides.json`); (c) the repo or commit has vanished upstream.
  **"The task looks odd / hard / easy / unrepresentative" is not a reason**, and neither is
  anything derived from inspecting a diff or an issue.
- Order: lowest-rank unused reserve of the same language; if exhausted, the reserve of the
  largest-primary-quota language with reserves left, ties alphabetical.
- Replacement happens strictly BEFORE any arm rollout on that task. No task is replaced,
  added or dropped once an outcome exists.
- Every replacement is logged with its reason in `select/HELDOUT2_REPLACEMENTS.json`
  (`HELDOUT_REPLACEMENTS_2026-07-21.json` is the format precedent).

## 8. Indexing coverage is fixed in sweet, never by dropping a task

If sweet-search cannot index a drawn task's language or file extensions, the remedy is a
change to the indexing config (`FILE_PATTERNS` glob + `EXTENSION_MAP`, case-sensitive
globs — the Zeek `.bif` precedent), committed as an ordinary code change. Dropping the task
instead would tilt the set toward sweet, so it is prohibited. Coverage is audited against
the drawn 200 after the freeze; no coverage finding may trigger a re-draw.

## 9. What is frozen by this document

`select/select_heldout2.py` + this file + `HELDOUT2_EXCLUDED_REPOS.json` + the seed fully
determine `tasks_heldout2.jsonl`, `tasks_heldout2_reserve.jsonl`,
`MANIFEST_heldout2.json` and `REJECTED_heldout2.json`. The manifest hash is recorded in
`PLAN.md` at freeze time.
