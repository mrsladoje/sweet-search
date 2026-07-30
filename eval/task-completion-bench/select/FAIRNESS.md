# FAIRNESS — held-out 2 (task-completion bench)

This is the pre-registration snapshot for the held-out-2 evaluation set: what the set is,
how it was drawn, and what was deliberately never allowed to influence it. Sections 1–6
were written and committed **before** any seed was used; section 7 discloses the one protocol
amendment and the draw discarded by it; section 8 records the realized counts, filled in
immediately after the final draw with no rule changed.

Rules in full: `HELDOUT2_RULES.md`. Selector: `select_heldout2.py`.

---

## 1. The claim this set has to support

A comparison of two arms — sweet-search tooling vs the harness's native tools — on the same
tasks, same model, same harness. The set must therefore be **neutral toward both arms by
construction**, not by our later assurance that we were even-handed. Neutrality here is
procedural: it comes from the order in which things were decided, and from the fact that
every rule is checkable against committed artifacts.

## 2. Quotas come from outside this project

Language quotas are the GitHub Octoverse 2025 most-used-language weights, reused **verbatim**
from held-out 1's pre-registration (`HELDOUT_PREREGISTRATION.md`) rather than re-derived, so
no new judgement entered them. They were not adjusted, in either direction, using any
per-language result, any forensic finding, or any profile of where either arm does well or
badly. TypeScript 30 · Python 30 · JavaScript 26 · Java 20 · Go 18 · Rust 18 · C# 12 · C++ 10
· C 8 · PHP 8 · Kotlin 6 · Swift 4 · Scala 2 · Dart 2 · Elixir 2 · Julia 2 · R 1 · Clojure 1.
Sum 200. A ~5% long-tail slice is retained deliberately so the claim is not "top languages
only".

## 3. Only arm-neutral metadata was consulted

The selector reads exactly: language, repo, instance id, base commit, image name, license,
created-at, and the **lengths** of `FAIL_TO_PASS` / `PASS_TO_PASS`. That is the whole input.

**No task diff, gold patch, test patch, problem statement or issue text was read — by a
human or by the selector — to include or exclude any specific task.** No task was ever
assessed for whether it looked favourable or unfavourable to either arm; that form of
reasoning is prohibited by the rules in both directions, and no artifact in this set build
contains it.

The one content-shaped filter, the task-rejection gate, is metadata-only: reject
`FAIL_TO_PASS >= 100` (whole suite red at baseline — "solving" would mean repairing the
build) or `PASS_TO_PASS == 0` (no baseline regression signal for the grader). Thresholds and
their motivating cases live in `task-gates.json`; the gate predates this set, was written
against held-out 1's post-mortem, and is applied identically to primary and reserve, before
the draw.

## 4. Rules, then seed, then draw

The order was: write every rule, exclusion list and quota → freeze the exclusion snapshot →
fix the seed → commit all of it → run the draw. The draw is a deterministic function of
committed artifacts; anyone with the repo and the pinned dataset revision reproduces
`tasks_heldout2.jsonl` byte-for-byte.

This happened twice. The first pass (seed `20260730`) is disclosed and discarded in §7; its
rules, its draw and the reason for discarding it are all committed. The second pass (seed
`20260731`) is the set. After the final draw nothing changed except through the replacement
policy (§6), and every replacement is logged with its reason.

## 5. Exclusions — independence from what we actually learned from

Two tiers, both frozen in `HELDOUT2_EXCLUDED_REPOS.json` and applied before the draw.

**Tier A — instance id, unconditional: 730 ids.** Every task ever drawn or run — dev-200
(200), held-out 1 including its pre-replacement roster and both sides of every promotion
(240), the reserve-101 population (101), the decontam population (215), and every instance id
appearing in any `rows.json`, `preds-*.jsonl` or env-ledger artifact on the box or the Mac
(475), which catches pilots and smokes that never became a named set.

**Tier B — whole repo: 268 repos**, those we have task-level knowledge of:

| source | repos | new repos it contributed |
|---|---:|---:|
| dev-200 (levers, prompt variants and 121 per-task overrides tuned with these in view) | 168 | 168 |
| repos of tasks read call-by-call in forensics (from `PLAN.md` + `FORENSICS-*.md`) | 27 | 27 |
| repos of tasks with a hand-written `task-overrides.json` entry | 110 | 73 |
| **union** | **268** | |

**Deliberately not excluded at repo level: 379 repos** we ran only in aggregate or merely
golden-indexed. A different pull request in one of them leaks nothing we hold, and the golden
index and any environment repair are identical for both arms — they move attrition, not the
comparison. Their identities are recorded in the snapshot under
`audit_only_repos_NOT_excluded_at_repo_level`, so a reader can check that choice rather than
take it on trust. The selector refuses to emit a set overlapping either tier.

**What this does not buy back.** SWE-rebench-V2 holds only 12 C++ and 17 C# repos at quality
A. Held-out 1 and dev-200 reached their C-family quotas by drawing several tasks from the same
repos (b2 ×3, moq ×3, zeek ×4, kiota ×5) and consumed most of the rest. Under one-task-per-repo
(rules §5), even zero repo exclusions would leave at most 4 C++ and 6 C# candidates. The
C-family shortfall in this set is a property of the population, not of our exclusion policy,
and it is redistributed by the deficit rule rather than papered over.

## 6. Replacement is mechanical only

A drawn task may be replaced only because its golden will not build, its suite will not
reach gold-FULL under the exact run config after ordinary environment repair, or the repo
has vanished upstream. It is then replaced by the lowest-rank unused reserve of the same
language (cross-language fallback deterministic and pre-registered). Replacement happens
before any rollout on that task; nothing is replaced, added or dropped once an outcome
exists. **"This task looks weird" is not a reason.**

Similarly, if sweet-search cannot index a drawn task's file types, the fix is to sweet's
indexing config — never dropping the task, which would tilt the set toward sweet.

## 7. Amendment 1 — the discarded first draw (2026-07-30)

Disclosed in full because a protocol amendment after a draw is exactly the kind of thing a
pre-registration exists to make visible.

**What happened.** Rules, exclusions and seed `20260730` were committed
(commit `9be3169`), then the draw ran. It produced a valid set under those rules and a
degenerate language histogram: **56 python (28%)** against a pre-registered 30, with C# 12→1,
C++ 10→1 and C 8→2.

**Why.** Two independent causes, both visible in the language counts alone:
1. Excluding all 647 touched repos exhausts the C family — but so does any policy, since the
   population holds only 12 C++ and 17 C# repos at quality A (§5).
2. The deficit rule inherited from held-out 1 reassigns freed slots to "the largest-quota
   language with spare pool" measured against the **running** quota, so the language that had
   just received a slot was the largest again. All 26 freed slots snowballed onto python.
   Held-out 1's deficits were too small for this to show.

**What was changed** (rules §2 and §3): proportional redistribution of the shortfall, and the
two-tier exclusion policy in §5 above. A fresh seed, `20260731`, was taken; `20260730` is
retired with its draw.

**What was NOT consulted.** No task diff, gold patch, test patch, problem statement, or any
run result. The amendment rests only on the per-language repo-count table and the histogram of
the discarded draw. Nothing about either arm entered the decision.

**Evidence kept.** The discarded draw is committed verbatim at
`select/discarded-draw-20260730/` — task list, reserve, manifest and rejection sidecar — so
the second draw can be compared against the first rather than taken on trust.

## 8. Realized counts

*This section was committed empty, before the numbers existed, so that they could not be
selected for. Filled in from `MANIFEST_heldout2.json` immediately after the draw, with no
rule changed.*

- Dataset: `nebius/SWE-rebench-V2` @ `475dd5e8703bb5fb22dd3c60b5d038b019eba1e0`
- Seed: `20260731` · N = 200 primary + 67 reserve
- Pool after base filters and exclusions, before the rejection gate: **17,830 tasks**
  (9,011 dropped as quality != A; 5,026 on an excluded repo; 212 on an excluded instance id)
- Rejected by the task gate: **4,047** — 2,212 on `FAIL_TO_PASS >= 100`, 2,973 on
  `PASS_TO_PASS == 0`, 1,138 on both → `REJECTED_heldout2.json`
- Dropped by the one-task-per-repo rule: **11,199**, leaving **2,584 candidates in 2,584
  distinct repos**
- Language deficits: **19 primary slots** freed by exhausted pools (C# 9, C++ 7, C 3) and
  redistributed proportionally — python +4, ts +3, js +3, go +2, java +2, rust +2, kotlin +1,
  php +1, swift +1. The reserve freed 12 more (C# 4, C 3, C++ 3, kotlin 2) the same way.
- Realized mix: python 34 · ts 33 · js 29 · java 22 · go 20 · rust 20 · php 9 · kotlin 7 ·
  swift 5 · c 5 · csharp 3 · cpp 3 · scala 2 · dart 2 · elixir 2 · julia 2 · r 1 · clojure 1
- Selected: 200 primary in 200 distinct repos, 67 reserve in 67 further distinct repos; zero
  overlap with either exclusion tier, zero primary/reserve overlap, zero gate violations —
  all asserted in the selector, which refuses to write a set that breaks any of them
- `tasks_heldout2.jsonl` sha256:
  `67d83ded531112a0ce7ff8082e99a8d10014df3ff24ff4cfe755e97932f148c8`
- `tasks_heldout2_reserve.jsonl` sha256:
  `113994d5ce1b2ce5e8e9264269c0b593db9854d603d85d2adeec00356963a307`

## 9. Known limitations of this set

- N = 200, one replication per (task, arm). The achievable claim from a null result is "no
  significant difference", not proven equivalence.
- Language slices are descriptive only; at these quotas no per-language inference is powered.
- The pinned dataset revision is shared with dev-200 and held-out 1, so held-out 2 is
  independent by repo, not by dataset snapshot. Pre-training contamination of the underlying
  pull requests is not addressed by this set; it is the separate decontam population's job.
- Excluding 268 repos removes some of the largest, most-worked-on codebases from the pool,
  since those are the ones earlier sets drew. The set skews slightly toward less
  frequently-sampled repos as a consequence. This is a cost of independence and applies to
  both arms identically.
