# W0 gate — P6 runtime public-surface probe: pre-registered bar

**Committed BEFORE the probe was written and before any figure existed.**
Executes [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §4 P6, *"Cheapest `$0` falsifier"*, and
§9 W0 row *"P6 runtime surface"*.
**Date:** 2026-08-24. **Budgeted model spend: `$0`.** Recorded artifacts and materialized
base trees only; no agent, no grading, no rollout.

---

## 1. What P6 claims

`ss-surface-probe` loads the public factory in an isolated local process and emits a
**behavioural certificate**: enumerable methods before and after the change, recorder call
ordering, and captured output timing. The claim is that static types cannot observe
enumerability or temporal output, so a runtime probe supplies a fact the agent otherwise
guesses. On `codeception__codeceptjs-367` both arms understood deferred output and **guessed
the public contract**: native first added enumerable `say`/`comment`/`remark`, a visible
exact-key test failed, so it made them non-enumerable; sweet chose
`Helper.comment()` — the wrong name and the wrong owner.

## 2. The falsifier, as the slate states it

> Replay the behavioural certificate against recorded patches. Native's non-enumerable
> aliases and sweet's helper-only `comment` must fail; an enumerable queued `say` must
> satisfy surface and ordering. **Kill it if the public name cannot be derived without
> grader-only facts.**

## 3. Pre-registered predictions

The certificate is an OBSERVATION, not a verdict, so the bar is that it **separates** the
three shapes, on the recorded patches, without reading gold.

| # | prediction | measured as |
|---|---|---|
| **P6-1** | a patch that installs the aliases via `Object.defineProperty` leaves them **present but NOT enumerable** on the actor | `name in getOwnPropertyNames(I)` **and** `I.propertyIsEnumerable(name) === false` |
| **P6-2** | a patch that adds `comment` to the `Helper` base class leaves it **absent from the actor entirely** — `methodsOfObject(helper,'Helper')` walks the prototype chain only until the class named `Helper`, so the base class's own methods are excluded | `name` in neither `Object.keys(I)` nor `getOwnPropertyNames(I)` |
| **P6-3** | the reference fix leaves `say` **enumerable, on the actor, deferred into the recorder, and silent at call time** | `Object.keys(I)` contains it; calling it adds ≥1 recorder task and writes 0 bytes to stdout synchronously |
| **P6-4** | the certificate's verdicts agree with the grader on every recorded cell — every cell it calls surface-correct resolved, and no resolved cell is called surface-wrong | per-cell comparison against `rows.json` |

## 4. The kill condition, stated before looking

**P6 is KILLED if the public name `say` cannot be derived without grader-only facts.**

Operationally: `say` must occur in the **base tree**, outside every test file and outside the
reference patch, as a public output primitive. If the only place the name exists is the hidden
test patch or the gold diff, then a runtime probe cannot supply it either — the probe reports
what the surface IS, and no amount of that tells an agent what a maintainer will later call a
method that does not exist yet. In that case P6 is an adapter for P3 at best, and its
**+1 task on each of three harnesses** ceiling is fiction.

This is the same discipline the W0 P3 gate applied to itself and it is the reason that gate
recorded a miss rather than a win on this task: reading the issue is **not** sufficient to
reconstruct this task's definition of solved. P6's extra claim is that reading the RUNTIME is.
That claim is what P6-4 and the kill condition test.

## 5. Decision rule

- **P6-1, P6-2 and P6-3 all hold, and the kill does not fire** → the `$0` gate passes, and a
  **small local probe process** may be scoped. Explicitly NOT the multi-language runner fleet
  the slate imagined; one process, one language adapter, no corpus.
- **Any of P6-1..P6-3 fails** → the certificate does not observe the distinction it exists for.
  P6 is closed.
- **The kill fires** → P6 is closed regardless of P6-1..P6-3, because a probe that cannot
  supply the name cannot flip the task.
- **P6-4 fails** → the certificate is not a selection signal. It may still be reported as
  information, but no resolution ceiling may be attached to it.

## 6. Integrity constraints

- Trees are materialized with `git archive` into a temp dir and deleted. **The goldens are
  never written to.**
- The gold patch is applied ONLY as the last target, to confirm the certificate is
  satisfiable — the same use the P3 gate made of it.
- HO2 is untouched. `results/` is not mutated.
- No number in the resulting document may be quoted without being re-derived by the committed
  script.
