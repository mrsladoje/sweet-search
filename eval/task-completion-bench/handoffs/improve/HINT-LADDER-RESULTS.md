# Hint ladder — does delivered information raise resolution?

**Date:** 2026-08-18 · **Arm:** sweet only · **Harness:** opencode · **Backbone:** `openai/gpt-5.6-luna`
**Ledger:** `/root/env-ledger/luna-rotate20-v3/ledger.jsonl`, 8/8 gold-FULL under the current config
**Scripts (frozen at `aece0be`, before any rollout):** `phase1-scripts/hint-ladder.mjs`,
`hint-ladder-round2.mjs`, `general-clauses.mjs`, `hint-ladder-report.mjs`
**Artifacts:** `ladder-20260818/`

---

## Why this exists

Four zero-cost gates have now asked the same question — *could a tool derive the right fact
from the base tree at `$0`?* — and four times the answer was yes. Not one of them asked the
question that decides whether any of those tools is worth building: **when the model is handed
the fact, does the task flip?**

The P4 gate ended precisely on that gap. Its checker named the four states of the reference
fix set-exactly, blind, and the write-up had to close with: *not established, that an agent
handed the counterexample list would act on it.* All six sweet and native cells had the state
machine file in reach and every one still wrote the same one-quadrant patch.

This experiment answers it. The first round cost `$0.51`; everything below, 24 pilots and 369
rollouts on two backbones, cost `$4.72`.

## Design

`TASKS_FILE` already feeds `problem_statement` straight into the prompt, so a hint is delivered
by generating a derived task file and changing no harness code. Four conditions, run as four
separate pilots over the same five chronically-unsolved targets:

| | what the model is given | derivable at `$0`? |
|---|---|---|
| **L0** | nothing added | baseline |
| **L1** | a **blind certificate** — only facts readable from the base tree and the issue | **yes — this is the shippable rung** |
| **L2** | the **files and symbols** the reference patch touches, no semantics | no, gold-derived: an upper bound |
| **L3** | a prose **specification** of the required behaviour, no code | no, gold-derived: the ceiling probe |

They are conditions, not a monotone ladder, and the results below show why that distinction
was worth making: on Apple the blind certificate is *more* specific than the prose spec.

**Targets** are the five tasks recorded 0/2 in both arms on all three harnesses (YARP is
excluded as ungradeable, mransan as broken). **Controls** are three tasks already solved 2/2,
carried at L0 to prove the rig reproduces.

## The rig reproduced before anything was interpreted

| control | L0 |
|---|---|
| `oceanparcels__parcels-617` | 3/3 |
| `ontodev__robot-710` | 3/3 |
| `epiforecasts__scoringutils-229` | 2/2 |

and every target came back 0/3, matching the recorded 0/2-everywhere baseline exactly.

**Delivery check (the micro-smoke `$0` exposure gate, verified after the fact).** The hint
reaches the model only through the issue text, so its arrival is visible as a step in
first-turn prompt tokens: **+195 to +455 tokens at L1, on exactly the five hinted tasks and
on no control.** This was not an accidental A/A.

## Result

Solves out of reps, sweet arm:

| task | L0 | L1 blind | L2 localise | L3 spec |
|---|---|---|---|---|
| `apple__swift-nio-http2-145` | 0/3 | **4/4** | 0/2 | 0/3 |
| `codeception__codeceptjs-367` | 0/3 | 0/4 | 0/3 | **2/3** |
| `dashbitco__nimble_options-43` | 0/3 | **1/4** | 0/2 | 0/3 |
| `joshuakgoldberg__bingo-274` | 0/3 | 0/4 | 0/3 | 0/3 |
| `dart-lang__http-1114` | 0/3 | 0/4 | 0/3 | 0/3 |
| mean f2p fraction (partial credit) | 0.133 | 0.390 | 0.000 | 0.400 |
| mean ideal cost per rollout | `$0.00737` | `$0.00660` | `$0.00766` | `$0.00739` |

71 rollouts, `$0.5045` ideal / `$0.5066` realized.

### 1. The P4 checker's output flips Apple, 0/3 → 4/4

This is the first live resolution gain in the whole SLATE-B program, and it is the strongest
form the gate could take: the certificate is the literal output of a checker **committed at
`193ff9b` before it had ever met a patch**, containing no gold and no test knowledge.

All four rollouts wrote a genuine four-quadrant fix, each with different surface syntax — the
gold tripwire reports **0/5 patches near-identical to gold**, so this is the model doing the
work, not copying text.

### 2. Prose describing the same fix does NOT work — and the failure is exactly diagnostic

Apple at L3 is **0/3**, with the certificate's 4/4 sitting next to it. Reading the patches
explains why. At L3 every rollout adds `halfClosedRemoteLocalIdle` **and** its mirror
`halfClosedLocalPeerIdle` — the mirror half of the rule survives being stated in prose — and
every rollout **omits both `halfOpen*Idle` states**. The end-of-stream sibling half does not
survive prose.

That is the value of the tool stated precisely: the mirror rule is a sentence; the
end-of-stream closure is a computation, and only the computation gets the last two states.

### 3. Localisation buys nothing at all

L2 flips nothing and scores **0.000** mean f2p, below the untouched baseline. Handing these
models the file and function list is not help — they already find the right file. Any product
framing that sells "we find the right code faster" as the path to resolution is not supported
here.

### 4. CodeceptJS: the certificate got everything except one runtime fact

At baseline every rollout put a `comment()` method on the wrong object in the wrong file
(`lib/helper.js`, the Helper class). With the blind certificate, **all four rollouts** wrote:

- the right file — `lib/actor.js`
- the right name — `say`, the verb the project already owns
- the right mechanism — `recorder.add(...)` around `output.say(...)`

and then attached it with `Object.defineProperty`, which defaults to **non-enumerable**; two
of the four set `enumerable: false` explicitly. The grader checks the actor's enumerable keys.

The certificate carried every static fact and stopped one fact short, and the missing fact is
a runtime property of the object. That is P6's claim — *static types cannot observe
enumerability* — reproduced live rather than argued. L3, which states the enumerability
requirement in prose, flips the task **2/3**.

### 5. NimbleOptions: the residue certificate lands, then the model breaks its own fix

At L1 **all four** rollouts hit the three residue sites the certificate named (documentation
list, valid-type list, `validate_type/3` clause) — the P2 residue analysis is confirmed live.
Only one solved. The other three then added a fourth, unrequested edit rewriting the
error-message generator (`Enum.map(@basic_types -- [:integer], ...)`) and broke the suite.

The retrieval half of this task is solved and the loss is stop-discipline, which is what the
stop-at-first-green frame clause targets. That combination is queued as a follow-up.

### 6. Two targets are not purchasable with information at this backbone

`bingo-274` and `dart-lang__http-1114` are 0 at **every** level, including a full prose
specification of the required behaviour. Their `+1 task per harness` ceilings in the slate
arithmetic are not supported by any evidence here. For Dart the baseline failure is
instructive: the model invents `headersAll` and cascades it across `base_request.dart`,
`base_response.dart`, `browser_client.dart` and more, where the reference fix is one extension
in one file. It is not missing a fact; it is choosing a different design.

---

## Second experiment: is the certificate even necessary?

Each per-task certificate is an instance of a rule that can be stated once, in general, for
every task. A general clause costs nothing to ship — no parser, no language front end, no
per-project semantics, which is exactly what P4's rotation killed its checker on. So the same
five targets and all three controls were re-run with one general clause appended to **every**
task, three reps each, four clause sets. Every clause is written to be true of any
repository: no file name, no symbol, nothing bench-specific.

| task | L0 | G1 family completeness | G2 public surface + vocabulary | G3 symmetry and siblings | GALL all three |
|---|---|---|---|---|---|
| `apple__swift-nio-http2-145` | 0/3 | 0/3 | 0/3 | 0/2 | 0/3 |
| `codeception__codeceptjs-367` | 0/3 | 0/3 | 0/3 | 0/2 | 0/3 |
| `dashbitco__nimble_options-43` | 0/3 | **1/3** | 0/3 | 0/3 | 0/3 |
| `joshuakgoldberg__bingo-274` | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| `dart-lang__http-1114` | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| `oceanparcels__parcels-617` (control) | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| `ontodev__robot-710` (control) | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| `epiforecasts__scoringutils-229` (control) | 2/2 | 3/3 | 3/3 | 3/3 | 3/3 |

**No control regressed under any clause.** That is the only good news a general clause earned.

### The comparison that decides whether the tool is worth building

Apple with the **general symmetry clause**: **0/2**. Apple with the **computed certificate**:
**4/4**. The clause says, correctly and in general, *check the twin and check the siblings*.
It does not produce the fix. Neither does the gold-derived prose specification (0/3). Only the
computed closure — the two states nobody states in a sentence — does.

That is `ss-statecheck`'s value, isolated: **not the rule, the computation.**

### The placebo holds the headline up

A flip produced by a long analysis block invites one obvious objection: any long analysis
block might raise effort. So Apple was re-run with a **placebo certificate** — the same tool,
the same format, the same length, reporting truthfully on
`Sources/NIOHTTP2/ConnectionStateMachine/ConnectionStateMachine.swift`: 19 operations, eight
armed mirror pairs, no end-of-stream axis derivable, **zero counterexamples**. A real report
about a file the reference fix never touches.

**Apple under the placebo: 0/4.** The flip is content, not attention.

### The dose-response, on one task, from five conditions

Removing the computed counterexamples from Apple's certificate and leaving only its two rules
— still file-specific, still naming the sibling pairs — gives **1/4**. So:

| what Apple is given | solves |
|---|---|
| a truthful certificate about a different file (placebo) | 0/4 |
| a general "check the twin and the siblings" clause | **0/6** (2 runs) |
| a gold-derived prose specification of the fix | 0/3 |
| this file's two rules, no computed counterexamples | 1/4 |
| this file's rules **plus the computed counterexamples** | **8/8** (2 runs) |

The rules are worth a quarter of the way. The closure is worth the rest. Nothing else on that
list is worth anything at all. **0/6 against 8/8** is the whole case for building the analyzer
instead of writing a sentence.

### NimbleOptions: the clause matches the certificate, and both stall on the same fourth edit

G1 flips it 1/3, the certificate flips it 1/4 — indistinguishable at these reps. Reading the
patches shows why neither does better: **the exact three-site patch SOLVES** (rep 1, three
hunks, `f2p` 1.000). Two of the three G1 rollouts produced that same patch and then added a
fourth hunk rewriting the error-message generator so `:integer` would stay out of an existing
list, which drops `f2p` to 0.667. Three of the four certificate rollouts did the same.

The retrieval half of this task is finished. The loss is a fourth edit nobody asked for, and
it earned a fifth clause (`G4`, minimal change) which is queued.

### Stacking clauses destroys the one effect there was

`GALL` — all three clauses together — is **0/3 on NimbleOptions**, losing G1's flip. More
instruction is not more compliance.

### The Apple flip replicates, and stop-at-first-green is the wrong lever

Running the certificate again with the stop-at-first-green frame clause attached gives Apple
**4/4 a second time** — two independent runs, **8/8 rollouts**, different run IDs, different
days' worth of sampling noise. This is not one lucky cell.

The clause itself does nothing useful: NimbleOptions goes **1/4 → 0/4** under it. The fourth
edit that breaks that task is not "editing after green", it is a defensive rewrite made before
any test is run, so a stop-at-green rule never fires. That is what `G4` targets instead.

### CodeceptJS: adding the one runtime fact buys the task

The certificate was extended with the fact a runtime probe can observe and source cannot —
that the actor's public contract is its **enumerable** own keys, that every existing method is
installed by plain assignment and is therefore enumerable, and that `Object.defineProperty`
defaults `enumerable` to false.

**CodeceptJS goes 0/4 → 2/4**, matching what the gold-derived prose specification achieved
(2/3) — and the mechanism is visible in the diffs rather than inferred: **both solving
rollouts install `say` by plain assignment and neither calls `defineProperty`; both failing
rollouts still reach for `defineProperty` without `enumerable: true`.**

That is P6 bought, and its price is one runtime probe, not a language front end. `bingo` under
the same treatment stays 0/4 — see below for why nothing can move it.

---

## Third finding: two of the five targets are a naming lottery

`bingo-274` and `dart-1114` flip at no level, including a full prose specification, and their
hidden tests explain it. They import an identifier the reference patch invented and the base
tree has never mentioned:

- `packages/bingo-fs/src/isFile.test.ts` → `import { isFile } from "./isFile.js"` — so the
  **file name** is locked, not only the symbol. At L3 the model wrote a functionally correct
  implementation and named it `isCreatedFile` in `handlebars.ts`. Nothing about that is wrong;
  it just is not the name the test imports.
- `pkgs/http/test/response_test.dart` → `response.headersSplitValues`. The baseline model
  invents `headersAll` and cascades it across four files.

`phase1-scripts/name-lock-census.mjs` measures this across the whole task file. It counts a
name as locked only when the hidden test needs it, the reference patch adds it, the base tree
never mentions it, **and the issue text does not spell it out** — that last clause matters,
because without it `gradethis` looks locked and it solves 2/2 everywhere, since its issue
hands the agent the name.

**4 of 18 tasks are name-locked.** Two were already excluded for other reasons (`mransan`
broken, `polyfactory` unfixable in the shim). The remaining two are `bingo` and `dart` — and
both are 0/2 in both arms on all three harnesses.

No candidate in the slate can address a name lottery. **P5's `+1 task on each harness` and the
Dart half of P7's cost pool rest on tasks that measure a coin flip.**

---

## Fourth finding: the clauses point the other way on tasks they were not written for

The micro-smoke protocol's rotation gate exists to catch a lever that only wins on its tuning
tasks. This one failed in the opposite direction. On five DEV tasks that took no part in
designing any clause, two reps each:

| fresh task | L0 | GALL |
|---|---|---|
| `jashkenas__underscore-2757` | 1/2 | **2/2** |
| `pytask-dev__pytask-210` | 1/2 | **2/2** |
| `rstudio-education__gradethis-161` | 1/2 | 1/2 |
| `akinsho__nvim-bufferline.lua-173` | 1/1 | 1/2 |
| `teleporthq__teleport-code-generators-291` | 0/2 | 0/2 |
| **rollouts solved** | **4/9** | **6/10** |

Two reps is not a result — at this size the difference is comfortably inside noise, and
`akinsho` even lands on unequal denominators because a rollout was lost. But it is the
opposite of overfitting, so it earned a deeper rotation at four reps:

| fresh task | L0 | G1 alone | GALL |
|---|---|---|---|
| `jashkenas__underscore-2757` | 2/4 | 3/4 | **4/4** |
| `teleporthq__teleport-code-generators-291` | 0/4 | 1/4 | **3/4** |
| `akinsho__nvim-bufferline.lua-173` | 4/4 | 4/4 | 4/4 |
| `rstudio-education__gradethis-161` | 3/4 | 3/4 | 3/4 |
| `pytask-dev__pytask-210` | 2/4 | 1/4 | 1/4 |
| **rollouts solved** | **11/20** | **12/20** | **15/20** |

`teleport-291` is the interesting one: **0/4 at baseline here and 0/2 on every arm of every
harness in the recorded slate, and 3/4 under the clauses.** `underscore` goes from flaky to
robust. `pytask` moves the other way.

`G1` alone lands at 12/20, indistinguishable from baseline, so whatever is happening needs all
three sentences — the exact opposite of the design set, where the stack lost `G1`'s only flip.
At the rollout level 15/20 against 11/20 is not significant on its own, and neither is the
ordering. But this is the same
three sentences that did nothing on the five tasks they were written against, and the shape —
no control regression anywhere, a dead task turning over, one task degrading — is a real
candidate rather than a tuning artifact. It is the cheapest lever in the whole slate: no
parser, no index, no tool, and it applies to both arms.

---

## Fifth: what the best-known configuration buys on each target

Stacking the certificate with the family-completeness clause (`r4-L1G1`) gives Apple **4/4 a
third time — 12/12 rollouts across three independent runs** — and lifts NimbleOptions to its
best figure, **2/4**. It does nothing for CodeceptJS, which needs the runtime fact instead.

| target | best condition found | baseline → best |
|---|---|---|
| `apple__swift-nio-http2-145` | blind state-space certificate | 0/3 → **16/16** |
| `codeception__codeceptjs-367` | certificate + runtime surface fact | 0/3 → **2/4** |
| `dashbitco__nimble_options-43` | certificate + family-completeness clause | 0/3 → **2/4** |
| `joshuakgoldberg__bingo-274` | nothing found | 0/3 → 0 everywhere (name-locked) |
| `dart-lang__http-1114` | nothing found | 0/3 → 0 everywhere (name-locked) |

**Three of the five chronically-unsolved targets are reachable with delivered information. The
two that are not are benchmark artifacts rather than product gaps.** No single condition wins
all three — each needs a different derived fact, which is the argument for three narrow
analyzers rather than one prompt.

### Apple is now 16/16, and every stack past the first hurts NimbleOptions

Four independent runs have now put the certificate in front of Apple — alone, with the
stop-at-green clause, with the family clause, and with the family plus minimal-change clauses.
**Every one returned 4/4: 16 rollouts, 16 solves, four run IDs.** Against 0/6 for the general
clause and 0/4 for the placebo, the certificate's effect is not a sampling artifact.

NimbleOptions moves the other way as clauses pile up: **2/4** on certificate + family clause,
**1/4** once minimal-change is added on top, **0/4** with stop-at-green instead. The pattern
matches `GALL` losing `G1`'s flip. More instruction is not more compliance.

### The minimal-change clause does not rescue NimbleOptions on its own

`G4` alone flips nothing — NimbleOptions 0/3 — while all three controls stay 3/3. Naming the
failure mode in general terms is not enough to stop it; the best NimbleOptions figure remains
2/4, on the certificate stacked with the family clause.

---

## Sixth: a 20x-priced backbone buys nothing, and the certificate still works on it

Everything above is one cheap model, so the five targets were re-run on
`openai/gpt-5.6-terra` — twenty times luna's per-token price — twice, baseline and blind
certificate, two reps each.

| target | terra baseline | terra + certificate |
|---|---|---|
| `apple__swift-nio-http2-145` | 0/2 | **2/2** |
| `codeception__codeceptjs-367` | 0/2 | 0/2 |
| `dashbitco__nimble_options-43` | 0/2 | 0/2 |
| `joshuakgoldberg__bingo-274` | 0/2 | 0/2 |
| `dart-lang__http-1114` | 0/2 | 0/2 |
| | 0/10, `$1.19` | 2/10, `$1.00` |

**A twenty-fold increase in backbone price buys zero resolution on these tasks. The derived
fact buys one of them outright.** Apple is now **18/18 across five runs on two backbones** — against
**0/13** for the three conditions that carry no computed closure (placebo 0/4, general
symmetry clause 0/6, gold-derived prose specification 0/3). The checker is not a cheap-model
crutch.

---

## Scale and spend

**369 rollouts across 24 pilots for `$4.72`** in ideal cost: 349 on `openai/gpt-5.6-luna` for
`$2.53`, and 20 on `openai/gpt-5.6-terra` for `$2.19`. OpenCode, sweet arm only. Every pilot
ran against the same green ledger and the same matched cap (`MAX_TOOL_CALLS=60`, never binding
— every rollout exited `model_stopped` at a mean 12-20 tool calls).

---

## Honest limits

- **One harness, one arm.** Everything here is OpenCode, sweet arm. The backbone limit is now
  partly answered — the Apple flip reproduces on a 20x-priced model — but codex and
  claude-code are untested, and so is the native arm. Hints travel through the issue text, so
  a hint result is not itself a sweet differential; the *analyzer* is what only sweet would
  ship.
- **3 of 74 attempted rollouts (4.1%) were lost** to `pinned OpenCode 1.18.4 is unavailable`
  at `CONCURRENCY=3` — the same failure the micro-smoke skill records from 2026-08-04 and
  describes as fixed by the global install. It is not fixed. It hit L0 once and L2 twice, and
  it costs reps rather than biasing outcomes, but the skill's claim needs correcting.
- **L2 and L3 are gold-derived and can never ship.** They are ceiling probes. Only L1 is a
  product claim.
- **`ss-statecheck` is not built.** L1 delivers a certificate that the frozen analyzer
  produces; it does not prove an agent would invoke a tool to obtain it, and P4's own rotation
  found the shape on exactly one file in 152,270.

## What this changes

| candidate | before tonight | after |
|---|---|---|
| P4 state checker | "predicts the fix, delivery unproven" | **delivery proven: 0/3 → 18/18 across five runs and two backbones** |
| P6 runtime surface | "trace evidence suggests enumerability matters" | **isolated to one runtime fact; adding it gives 2/4, and the solving diffs differ from the failing ones exactly there** |
| P2 residue | "$0 replay finds `countBy`" | **residue sites land 4/4 live; the loss moved to a defensive fourth edit, and no clause tried tonight stops it** |
| P5 artifact graph | "+1 task ceiling on bingo" | **structurally unreachable: the hidden test imports `./isFile.js` by relative path** |
| P7 / Dart | "+1 task ceiling" | **structurally unreachable: the hidden test reads `headersSplitValues`** |
| any localisation lever | assumed useful | **0 flips, f2p 0.000 — dead** |
| general prompt clauses | not on the slate | **new candidate: no control regression in 100+ control rollouts, 15/20 vs 11/20 on five rotation tasks, one dead task turned over. Costs nothing to ship.** |
| "buy a better backbone" | untested | **0/10 on a 20x-priced model — buys nothing here** |

## What to do next

1. **Build `ss-statecheck` for real.** It is the only thing on this slate with a replicated
   flip behind it, and its blind output is worth more than a gold prose specification. The
   known limit stands: P4's rotation found the shape on one file in 152,270, so scope it as a
   narrow gated analyzer and do not promise generality.
2. **Screen the general clauses properly.** They are free, they broke nothing across more than
   a hundred control rollouts, and on tasks they were not written for they turned over
   `teleport-291`, which is 0/2 on every arm of every harness in the recorded slate. This is an
   18-task screen, not another micro-smoke.
3. **Take `bingo` and `dart` out of every ceiling argument.** They are name lotteries. Either
   exclude them the way YARP was excluded, or state plainly that any candidate crediting them
   with `+1 task` is crediting a coin flip. Run `name-lock-census.mjs` over any new task slate
   before it is adopted.
4. **`ss-surface-probe` is cheaper than it looked.** The whole CodeceptJS gap is one runtime
   property. That is a small local process that loads a module and reports its enumerable
   keys, not the language-runner fleet P6 sketched.
5. **Nothing here authorises a paid pilot.** Phase 0 still owes two gold-verified replacement
   control tasks, and the control set is still 40% vacuous.
