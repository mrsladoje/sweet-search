# FAIRNESS — held-out 2 (task-completion bench)

This is the pre-registration snapshot for the held-out-2 evaluation set: what the set is,
how it was drawn, and what was deliberately never allowed to influence it. Sections 1–6
were written and committed **before** the seed was used; section 7 records the realized
counts produced by the draw and was filled in immediately after it, with no rule changed.

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
fix the seed (`20260730`, the freeze date) → commit all of it → run the draw. The draw is a
deterministic function of committed artifacts; anyone with the repo and the pinned dataset
revision reproduces `tasks_heldout2.jsonl` byte-for-byte. Nothing changed after the draw
except through the replacement policy (§6), and every replacement is logged with its reason.

## 5. Exclusions — independence from everything already touched

Excluded at **repo** level before the draw, from the committed snapshot
`HELDOUT2_EXCLUDED_REPOS.json` (per-source counts and marginal contributions inside):

| source | repos | new repos it contributed |
|---|---:|---:|
| dev-200 (iterated against) | 168 | 168 |
| held-out 1: final + pre-replacement + promotions | 224 | 224 |
| held-out 1 reserve-101 population | 95 | 48 |
| decontam population | 146 | 135 |
| Mac golden vault inventory | 221 | 0 |
| eval-box staged goldens | 181 | 0 |
| run/smoke history (every instance id in any result artifact) | 402 | 72 |
| **union** | **647** | |

730 instance ids are excluded as well, which a repo exclusion already implies; both are
asserted in the selector, which refuses to emit an overlapping set.

## 6. Replacement is mechanical only

A drawn task may be replaced only because its golden will not build, its suite will not
reach gold-FULL under the exact run config after ordinary environment repair, or the repo
has vanished upstream. It is then replaced by the lowest-rank unused reserve of the same
language (cross-language fallback deterministic and pre-registered). Replacement happens
before any rollout on that task; nothing is replaced, added or dropped once an outcome
exists. **"This task looks weird" is not a reason.**

Similarly, if sweet-search cannot index a drawn task's file types, the fix is to sweet's
indexing config — never dropping the task, which would tilt the set toward sweet.

## 7. Realized counts

*Placeholder at pre-registration time — filled in from `MANIFEST_heldout2.json` immediately
after the draw, with no rule changed. Empty here is the point: these numbers are outputs of
the rules above, and this section is committed before they exist so that they cannot be
selected for.*

- Dataset: `nebius/SWE-rebench-V2` @ `475dd5e8703bb5fb22dd3c60b5d038b019eba1e0`
- Seed: `20260730` · N = 200 primary + 67 reserve
- Pool after base filters and exclusions, before the rejection gate: TO BE FILLED
- Rejected by the task gate: TO BE FILLED → `REJECTED_heldout2.json`
- Dropped by the one-task-per-repo rule: TO BE FILLED
- Language quota deficits requiring reassignment: TO BE FILLED
- Selected: TO BE FILLED
- `tasks_heldout2.jsonl` sha256: TO BE FILLED (recorded in `PLAN.md`)

## 8. Known limitations of this set

- N = 200, one replication per (task, arm). The achievable claim from a null result is "no
  significant difference", not proven equivalence.
- Language slices are descriptive only; at these quotas no per-language inference is powered.
- The pinned dataset revision is shared with dev-200 and held-out 1, so held-out 2 is
  independent by repo, not by dataset snapshot. Pre-training contamination of the underlying
  pull requests is not addressed by this set; it is the separate decontam population's job.
- Excluding 647 repos removes some of the largest, most-worked-on codebases from the pool,
  since those are the ones earlier sets drew. The set skews slightly toward less
  frequently-sampled repos as a consequence. This is a cost of independence and applies to
  both arms identically.
