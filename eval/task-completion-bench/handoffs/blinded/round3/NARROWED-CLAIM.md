# C-6 — the narrowed claim, frozen before the round-3 slate exists

**Written:** 2026-08-13, by the Slate-A close-out session.
**Status:** FROZEN. This file is hashed and the hash is published *before*
`pick-newmodule-slate.mjs` is run. Nothing here may be edited afterwards. If something is
wrong with it, that is a finding for round 4, not an edit to this file.

**Why the order matters.** Narrowing a claim after seeing *which* claim failed is legitimate.
Narrowing it after the next slate is drawn is tuning to the observed failure. The picker is
seeded, so the order is enforceable — and it is enforced here by fixing the seed, the bar and
the scope in this document, then hashing it, then drawing.

---

## 1. What round 2 established, and what it did not

Round 2 scored **4 of 5** against a bar that required 5 of 5, so its recorded verdict is
**FAIL** and that verdict stands. It is not re-cut here.

Underneath the verdict, two results point in opposite directions and the narrowing follows
from the split:

- **On absent structure — the capability the gate exists to test — 6 of 6.** Four new source
  modules across three tasks, every one with the correct owning package, and no module claimed
  on the two tasks that add none.
- **On maintainer intent — 0 of 1.** The one failing task was not a failure to read the tree.
  The derivation named the package, the directory, the new module, the export and the wiring
  line, then predicted the accepted fix would preserve an existing construct. The accepted fix
  deletes it. The lock had named that alternative and predicted against it.

Across both rounds, false positives are **2 of 21 nodes**, and **every one was marked
low-confidence before the reveal. No high-confidence node has yet been wrong.**

---

## 2. The claim, narrowed

### 2.1 CLAIMED — obligation *shape*

Given only an issue statement and a base source tree, the obligation graph states, as
assertions:

1. **Every new source module** the accepted solution adds, with its **correct owning package**,
   and whether it is public or internal.
2. **Every export, overload, enumeration, predicate or in-place behaviour obligation** the
   accepted solution relies on, with the **direction of the dependency edge**.
3. **Correct refusal:** no new source module is asserted on a task whose accepted solution adds
   none.

### 2.2 NOT CLAIMED — mechanism

**Which of two admissible fixes a maintainer picks is outside the claim.** Where a capability
can be made to exist by adding a construct or by removing one, the graph claims the surface
that must change, not the direction the maintainer chose.

This is a scope boundary, not an excuse. It is the sole reason round 2 scored 4 of 5, and it is
being removed from the claim rather than argued away. **If a downstream use needs mechanism, it
needs its own gate with its own bar, and this document does not supply one.**

### 2.3 A SEPARATE, NON-ASSERTED TIER — low-confidence nodes

A node marked low confidence at lock time is an **advisory**, not an assertion. It is reported,
it is counted, and it does not score in either direction.

The evidence for the split is the only reason it is allowed: across two rounds the
low-confidence mark sorted every false positive correctly, and no high-confidence node has been
wrong. **This tier is therefore load-bearing in the opposite direction too — see the bar.**

---

## 3. The bar for round 3, pre-registered

Five tasks, one slate, same protocol. **PASS requires all five of the following.**

| # | requirement | why it is here |
|---|---|---|
| 1 | Every new source module in every accepted solution appears, with the correct owning package | the capability under test |
| 2 | No export, overload, enumeration or predicate obligation the accepted solution relies on is missing | round 2 missed none; the bar holds that |
| 3 | No new source module is asserted on a task whose accepted solution adds none | over-assertion is penalised exactly as much as missing |
| 4 | **Zero high-confidence false positives across the whole slate** | the claim in §2.3 is that high confidence means something; this is where it is tested |
| 5 | Every task passes 1–4 — four of five is a FAIL | unchanged from round 2 |

**This is not a weaker bar. Requirement 4 is new and is strictly harder:** it converts the
observation "no high-confidence node has ever been wrong" from a happy accident into a gate.
Mechanism is removed from the scored set, and a false confidence mark is added to it.

**Scoring rules, fixed here.**

- Documentation, test, fixture, lint and coverage-configuration files count in **neither**
  direction. Round 2 recorded that the graph says nothing about that class of file; it is
  excluded explicitly rather than silently.
- Exact filenames are not required. Owning module, public or internal, and dependency direction
  are what score.
- Low-confidence nodes are reported with a count and do **not** score.
- **A near miss is a miss.** The bar is not softened after the reveal, by anyone, for any
  reason.

---

## 4. The draw, fixed before it happens

| parameter | value |
|---|---|
| picker | `handoffs/blinded/picker/pick-newmodule-slate.mjs` |
| seed | **`20260901`** |
| slate | `--n-with 3 --n-without 2` — five tasks, a constructed mixture |
| pool | `select/.cache/tasks_full_heldout.json` (DEV-RET) |
| excluded | every task used in round 1 or round 2, everything in `rotate20`, and every task any planning document discusses |
| output | `handoffs/blinded/round3/SLATE-PUBLIC.json` and `ISSUES.json`; labels sealed to `picker/SEALED-labels-round3.json` |

**Three with a new module and two without**, rather than round 2's two and three, because
requirement 1 is the claim and a slate needs enough of it to test. The mixture is still a
mixture, so its composition tells the deriving session nothing it can use: over-asserting is
penalised exactly as much as missing.

---

## 5. What a PASS and a FAIL each mean

**PASS** — the shape claim survives three independent blind rotations. That is the point at
which the next question is worth paying for, and the next question is **not** another
derivation gate. It is the one nobody has measured: *does handing an agent a correct obligation
graph change its patch?* A perfect graph the agent ignores is worth nothing.

**FAIL** — the capability does not survive, and the honest disposition is to say so and stop.
Four candidates in this programme have already died on gates like this one. That is the system
working.
