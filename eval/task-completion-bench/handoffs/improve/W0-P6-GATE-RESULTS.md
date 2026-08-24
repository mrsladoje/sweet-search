# W0 gate — P6 runtime public-surface probe: PASSES, and two of its three claimed properties did nothing

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §4 P6 *"Cheapest `$0` falsifier"* and §9 W0
row *"P6 runtime surface"*, under [`W0-P6-PREREGISTRATION.md`](./W0-P6-PREREGISTRATION.md)
(committed at `10eb2fd`, **before** the probe existed and before any figure existed).
**Date:** 2026-08-24. **Model spend: `$0`.** No agent, no grading, no rollout.
**Protected state:** goldens materialized with `git archive` into temp dirs and deleted, never
written to. `results/` not mutated. HO2 untouched.
**Artifacts:** [`p6-20260824/`](./p6-20260824/) — `certificate-replay.txt`,
`w0-p6-certificate.json`, `discrimination.txt`.
**Instruments:** [`p6-surface-certificate.js`](./phase1-scripts/p6-surface-certificate.js),
[`p6-surface-replay.mjs`](./phase1-scripts/p6-surface-replay.mjs).

---

## 0. Verdict

**P6 passes all four pre-registered predictions and the kill condition does not fire. It
separates all 14 trees correctly. But the separation comes entirely from ENUMERABILITY and
OWNERSHIP — the ordering and timing properties P6 is built around discriminated nothing at
all, and no recorded rollout ever passed, so the certificate has never been tested against a
correct-but-different fix.**

| pre-registered prediction | result |
|---|---|
| **P6-1** non-enumerable aliases observed as present-but-not-enumerable | **4 cells** — `opencode/native/r1`, `opencode/sweet/r1`, `claudecode/native/r0`, `claudecode/native/r1` |
| **P6-2** helper-owned `comment` absent from the actor entirely | **9 of 12** evaluable cells |
| **P6-3** the reference fix passes; the unfixed base tree fails | **YES / YES** |
| **P6-4** the certificate agrees with the grader | **12 / 12** evaluable cells |
| **KILL** — can the public name be derived without grader-only facts? | **does not fire** |

```
target                    resolved  surface  say / comment / remark
BASE (no patch)           null      FAIL     say=absent  comment=absent  remark=absent
codex/native/r0           false     FAIL     say=absent  comment=absent  remark=absent
codex/sweet/r0            false     FAIL     say=absent  comment=absent  remark=absent
codex/native/r1           false     FAIL     say=absent  comment=absent  remark=absent
codex/sweet/r1            false     FAIL     say=absent  comment=absent  remark=absent
opencode/native/r0        false     FAIL     say=absent  comment=absent  remark=absent
opencode/sweet/r0         false     FAIL     say=absent  comment=absent  remark=absent
opencode/native/r1        false     FAIL     say=[enum:false defer:true bytes:0]
opencode/sweet/r1         false     FAIL     comment=[enum:false defer:true bytes:0]
claudecode/native/r0      false     FAIL     say=[enum:false] comment=[enum:false] remark=[enum:false]
claudecode/native/r1      false     FAIL     comment=[enum:false] remark=[enum:false]
claudecode/sweet/r0       false     FAIL     say=absent  comment=absent  remark=absent
claudecode/sweet/r1       false     FAIL     say=absent  comment=absent  remark=absent
GOLD (reference fix)      true      PASS     say=[enum:true  defer:true bytes:0]
```

`claudecode/native/r0` is the slate's account, observed rather than asserted: all three names
present, all three **non-enumerable**. It is exactly the move the write-up describes — native
added enumerable aliases, a visible exact-key test failed, and it made them non-enumerable.

## 1. The kill condition does not fire, and this is the finding that matters most

P6's whole extra claim over P3 is that reading the RUNTIME tells the agent the public name
that reading the issue does not. That only helps if the name is derivable at all.

```
occurrences of "say" in the BASE tree (lib/bin/docs, no tests) : 1
present as a public output primitive in lib/output.js          : true
    lib/output.js:89:  say: (message) => {
```

**The name is in the base tree**, as a public output primitive, before any patch. It is not a
grader-only fact. That is consistent with the slate's own trace evidence — native *"noticed
that the existing output uses `.say` deliberately"* — and it is what separates this task from
the four naming lotteries in [`NAME-LOCK-CENSUS.md`](./NAME-LOCK-CENSUS.md), where the
required identifier exists nowhere but the reference patch.

## 2. Two of P6's three properties did nothing

P6 is specified around four observables: enumerable methods, generated type surface, recorder
call ordering, and captured output timing. Across all 8 `(name, tree)` pairs where a name was
actually present:

| observable | distinct values observed |
|---|---|
| **enumerable** | `false`, `true` |
| deferred into the recorder | `true` — **constant** |
| bytes written at call time | `0` — **constant** |

**Every patch already got the deferral right.** Not one printed at call time; not one failed
to queue. The slate's own account says as much — *"both arms understood deferred output"* —
and this is that sentence measured. The entire discriminating signal is **enumerability plus
ownership**: is the name on the actor, and is it an enumerable own property.

That is a much smaller thing than "a runtime conformance probe". It is one property descriptor
and one prototype-chain question, and it is worth saying plainly before anyone scopes work
around recorder ordering or output timing.

## 3. The honest limit on P6-4

**12 of 12 agreement is real but weak, because 0 of the 12 cells resolved.** The second half
of the pre-registered clause — *"no resolved cell is called surface-wrong"* — is vacuously
true here: there were no resolved cells to test it against.

What is genuinely established is a **14-tree separation**: the certificate fails the unfixed
base, fails all 12 wrong patches, and passes the reference fix. A detector that always said
FAIL would score 12/12 on the cells and would fail gold, so this is not that.

What is **not** established is that the certificate would accept a *correct but differently
shaped* fix. That is the P3 over-specification risk transplanted, and the W0 P3 gate priced
exactly this failure on Akinsho: a witness that rejected **11 rollouts the benchmark scored as
solved**. P6's certificate demands `say`, on the actor, enumerable. If some other correct
shape exists, nothing here would have caught it — because nothing here ever produced one.

## 4. Disposition

Under the pre-registered decision rule — P6-1..P6-3 hold and the kill does not fire — **the
`$0` gate passes and a small local probe may be scoped.**

**Scope, stated narrowly, and it is not the fleet the slate imagined:**

- **One process, one language.** A node process that loads the public factory in the repo
  under test and reports, for each public name: is it an own property of the exported object,
  and is it enumerable. That is `Object.keys` versus `Object.getOwnPropertyNames` plus a
  prototype walk. No multi-language runner fleet, no corpus, no analyzer.
- **Report the surface; never assert a name.** The probe's output is *"these are the public
  names and their descriptors"*. It must not tell the agent which name to add — that is where
  a grader-only fact would enter, and this gate's whole standing rests on it not doing so.
- **Book `$0` of saving and `0` extra solves until a live pilot shows otherwise.** The ceiling
  the slate attaches to P6 (`+1 task on codex, opencode and claude-code`) is **not** supported
  by this gate. This gate shows the certificate observes the distinction; it does not show any
  agent would act on it. Those are different claims, and the difference is the same one the
  P1 dependency-reach gate and the boundary smoke both landed on: **the information was
  available and the agent did not ask for it.**
- **Before any paid pilot, price rejection.** Measure solves lost, not only tasks won, exactly
  as the P3 gate demands.

## 5. Instrument integrity

One defect, found and fixed before any figure was recorded: the first version of the
certificate deferred to the tree's real `container.translation()`, which returns an object
without `actionAliasFor` until a config is loaded, so `lib/actor.js` threw for every tree and
all 14 targets came back `ERROR`. The stub now always supplies a complete no-op translation.
No number in this document was produced by the broken version.

The certificate reads **no gold**. It stubs one helper, builds the actor through the tree's own
`lib/actor.js`, and reports what came out. The reference patch is applied only as the final
target, to confirm the check is satisfiable — the same use the P3 gate made of it.
