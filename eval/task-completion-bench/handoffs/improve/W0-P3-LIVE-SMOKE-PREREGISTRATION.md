# P3 live smoke — pre-registered bar, and why the run is BLOCKED rather than pending

**Executes:** [`W0-P3-GATE-RESULTS.md`](./W0-P3-GATE-RESULTS.md) §7 and
[`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §4 P3 *"Later GO gate"*.
**Date:** 2026-08-24. **Model spend: `$0`.** Nothing has been run under this bar.

---

## 0. Position

**The bar below is pre-registered and ready. The run is blocked, and it is blocked on two
things that were already established rather than on anything discovered late.**

1. **P3's deliverable does not exist.** `ss-oracle`, `ss-witness` and `ss-finish` are not
   implemented — `eval/agent-read-workflows/bin/` holds `ss-search`, `ss-grep`, `ss-find`,
   `ss-read`, `ss-semantic`, `ss-trace`, `ss-batch` and nothing else, and no source file in
   the repo references the three names. The `$0` gate tested **hand-authored** witnesses run
   by a gate script. A live smoke needs the tool, and P3 is *sweet-only by vehicle*, so the
   differential it claims cannot be produced by a harness change.
2. **The prompt-level form of P3 is already CLOSED, twice, with a named mechanism.** The
   obvious cheap substitute — instruct the agent to author an executable spec before fixing —
   is *tests-first spec anchoring*, smoke-tested in two rounds on 10 tasks in 2026-07 and
   **rejected both times**, with all seven ship surfaces reverted:

   | round | targeted | controls | ideal cost | why rejected |
   |---|---|---|---|---|
   | 1 | 4/5 spec-anchored, `gradethis-161` flipped | **3/5** | **+23.7%** | opener displacement; addition-not-substitution; failing-suite red herring |
   | 2 | 7/10, `elm-ls-561` new flip | 5/5 | **+40.4%** | **off-trigger firing** — the paragraph primes tests-first on every fix task |

   The recorded conclusion is the one that matters here: *"Prompt text cannot gate this
   tightly enough,"* and *"deliver it as an **affordance**, not an instruction."* Re-running
   the instruction form under a new name would be rediscovering a closed result, and the
   discard log exists precisely to stop that.

**So this document registers the bar and stops.** Spending on a smoke whose treatment is
either non-existent or already refuted would be spending to re-derive what is written down.

## 1. The bar, for when P3 has something to run

Cohort: the **13 admissible tasks** of the rotation, `opencode` / `openai/gpt-5.6-luna`,
2 arms where applicable, **3 reps**, matched caps, behind a **v4** green ledger.

### 1a. The primary kill is solve preservation, not the win

This is the point the `$0` gate made and the reason it is first here.

> On Akinsho the witness rejects **11 rollouts the benchmark scores as solved**, and rejects
> the reference fix as well. *"P3's ceiling arithmetic counts the tasks such a mechanism might
> win and never counts the ones it can lose."*

| # | criterion | bar |
|---|---|---|
| **K1** | **solve preservation** — tasks solved under the control condition that are NOT solved under P3 | **0**. Any single lost task kills the smoke outright, regardless of what was won. |
| **K2** | **control tasks** — every control task solves in every rep, both conditions | no control regression |
| **K3** | **terminal refusal rate** — rollouts that produced a patch the grader resolves but that `ss-finish` refused to certify | **0**. This is K1's mechanism, measured directly, so a near miss is visible before it costs a task. |

**K1 and K3 are checked before any win is read.** If either fires, the result is a failure and
the win column is not reported as a headline.

### 1b. Only then, the win

| # | criterion | bar |
|---|---|---|
| W1 | tasks majority-solved | **≥ +1** over the control condition |
| W2 | the flip must be **Dashbitco-shaped** — a rejection landing on a coherence property, not on a guess about the fix | inspected per rollout on dev |
| W3 | cost per rollout | **≤ +10%** |

W1 at `+1` rather than `+2` is deliberate: the `$0` gate's stated ceiling is *"+1 on codex and
+1 on opencode"*, narrowly, on one task's mechanism. Registering `+2` would register a bar the
candidate's own evidence says it cannot meet.

### 1c. Disclosure that must ship with any number

- **The witness compiler is unproven.** Two of three hand-authored witnesses missed the
  benchmark's notion of correct, in **opposite** directions, from the same authoring
  discipline. Any live result on Dashbitco is a result about Dashbitco.
- **A delta-based finish gate is silent on most of this benchmark.** 119 of 184 failing
  screens carry no expected/actual pair at all.
- **Akinsho rep stabilization is withdrawn as support** by the `$0` gate's own evidence and
  may not be counted toward any ceiling.

## 2. The one P3-adjacent thing that is available at `$0`, surfaced not built

The `$0` gate found that `run_tests` already prints a `[run_tests baseline-diff]` trailer
separating introduced from pre-existing failures, that it works on Lua, Swift and R, and that
**on the Dashbitco screens it reports `introduced_failures=0 pre_existing_failures=0
trustworthy=yes introduced_signatures=none` while one test is failing** — its ExUnit signature
extraction produces nothing.

**The one task P3's resolution ceiling rests on is the one where the existing instrument is
blind.** Repairing that extraction is the affordance form the tests-first rejection explicitly
asked for, it is testable at `$0` against the recorded screens, and it needs no new tool.

It is recorded here and **not built**, for one reason that must not be glossed: the trailer is
**harness content, so it reaches both arms**. It is a validity fix in the same class as D2, it
carries **zero head-to-head differential**, and it must never be booked as a sweet win. It
belongs on the defect track, not in this candidate's ceiling.

## 3. What would unblock this

In order, cheapest first:

1. Repair the ExUnit branch of the existing `baseline-diff` extraction — `$0`, arm-universal,
   validity only.
2. Build `ss-finish` as a thin **runner and reporter** over an agent-authored witness file:
   no witness compiler, no oracle, no delta classifier. That is the smallest thing that makes
   the bar above runnable, and it keeps the sweet-only vehicle P3 needs.
3. Only then run this smoke, K1 and K3 first.

A witness **compiler** is not on this path and is not warranted by the `$0` gate.
