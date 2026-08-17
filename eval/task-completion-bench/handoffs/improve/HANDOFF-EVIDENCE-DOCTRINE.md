# HANDOFF — evidence doctrine for small levers

**Written:** 2026-08-13. **Spend authorised:** `$0`. **Status:** binding.

**What this amends.** [`HANDOFF-SLATE-A-CLOSE.md`](./HANDOFF-SLATE-A-CLOSE.md) §0 changed the
acceptance bar: a lever is kept if it genuinely improves either axis, and one percent counts. That
rule is correct. This document supplies the part it is missing — **how you establish that a one
percent lever is real**, given an instrument that cannot see one percent.

**Scope.** Binding on Slate A close-out, on Slate B when it starts, and on every lever proposed
afterwards. It is a measurement doctrine, not a candidate list.

**Read §9 for the drop-in §0 text and §10 for what to do with the three re-scored candidates.**

---

## 0. The problem, stated once

The new bar keeps a lever that saves 1%. The benchmark cannot measure 1%.

The most recent cost figure is **−15.85% at p = 0.335**. A two-sided p of 0.335 corresponds to
z ≈ 0.965, so the standard error is 15.85 / 0.965 ≈ **16.4 percentage points**. The 95% interval
runs roughly **−48% to +16%**.

That instrument cannot distinguish 1% from 0%, and it cannot distinguish 1% from 10%. The spread
is dominated by task heterogeneity, not by rep noise — `ontodev__robot-710` alone sits at +257%.
So more reps do not help. Only far more tasks would, and that is not affordable.

**Two bad responses, both available and both wrong.**

1. Restore a large bar, so only measurable levers survive. This kills real levers for being small.
   It is the error that produced an empty slate in the first place.
2. Keep levers on non-significant point estimates. This admits levers on noise. It is worse than
   (1), because an over-strict bar rejects while a noise-admitting bar **accumulates** — and the
   accumulation is only detected after the build cost is sunk.

**The correct response is neither.** Stop trying to measure the outcome. Measure the behaviour.

---

## 1. Proximal and distal

Every lever has two effects.

- **Distal** — dollars and solves. What you want. Aggregated over 16 tasks × 2 arms × 2 reps.
  Roughly 32 noisy observations of a sum. Standard error 16 points.
- **Proximal** — the thing the lever directly changes. Corrupted anchors. Empty results. Bytes per
  first touch. Re-reads of an already-served file. Fires many times **per rollout**.

**The whole trick is that proximal and distal are measured on the same runs, but proximal has ten
to a hundred times the observations.** Same money. Vastly more power.

**Worked example — the line-number gutter, which is the template.**

The distal question was "does this save money." Unanswerable: the effect is a few percent and the
instrument's spread is 16 points.

The proximal question was "how often does an edit anchor come out corrupted." Answerable, on the
same runs: **15.4% → 0.0%, p = 0.0049, 52 trials**, then **0 of 184** in an independent screen.

Nothing about the budget changed. The counted quantity changed.

**So the doctrine is:** measure proximal, write the conversion to distal as arithmetic, and check
the arithmetic once at the end on the whole stack.

---

## 2. The `$0` pre-flight census — run this before spending anything

Before proposing evidence for a lever, count how often its mechanism fires across the 204 recorded
rollouts. This costs nothing and it decides what evidence is possible.

| mechanism fires across the corpus | what is possible |
|---|---|
| **200+** | a microsmoke resolves it. Proceed normally. |
| **20–50** | a microsmoke resolves a large proximal effect only. Proceed, and pre-declare a wide expected effect. |
| **under ~10** | no affordable run will ever resolve it. It is **undecidable** — see §6. Do not pretend otherwise. |

**How to run the census.** Use the retained artifacts, not new runs:
`rows.json` (per-rep outcome, calls, usage, cost), `turns/<task>-<arm>.jsonl` (per-turn prices),
`preds-<arm>.jsonl` (final patches), `rt-dedup/` (repeat-test audit), and `/root/dump-trace.mjs`
for full untruncated transcripts. **Reuse `phase1-scripts/`; do not rewrite the replays.**

Never census from `trajectories/` — results truncate at 600 characters and inputs at 200, so
absence there proves nothing.

**This census permanently ends the "we need a bigger run" conversation.** Either the mechanism is
frequent enough to see on the runs you can afford, or no budget helps and the lever is decided on
principle.

---

## 3. The per-lever protocol

Six steps. Every kept lever carries all six in writing.

1. **Mechanism.** One sentence on why it should work, naming the causal path.
2. **Census.** How often the mechanism fires across the 204. Tier from §2.
3. **Proximal metric, pre-registered.** The counted quantity and its direction, written down
   **before** any run. This is the load-bearing step — see §3.1.
4. **Microsmoke.** Two diagnostic tasks plus controls, per the `/microsmoke` skill. Standing
   invariants: REPS ≥ 2, `CONCURRENCY=1`, matched `MAX_TOOL_CALLS` across arms, read `idealCost`
   never realized cost. Judge on the **proximal** metric. **Never on the arm cost delta.**
5. **Conversion arithmetic.** How the proximal change becomes dollars or solves — see §4.
6. **Solve non-inferiority.** The control set result — see §5.

### 3.1 Why pre-registration is the load-bearing step

Reading traces after a change to see whether behaviour "looks better" is confirmation bias with
extra steps, especially when the reader is the agent that proposed the lever.

Pre-registering the metric converts the trace read from a **judgment** into a **count**. The
gutter got this right: "corrupted anchor rate" was defined by the failure mechanism before the A/B
ran, so the number was not negotiable afterwards.

The cost is one sentence per lever. It is the difference between evidence and a vibe.

**Template — fill this in before the run, not after:**

```
LEVER:            <name>
MECHANISM:        <one sentence, names the causal path>
CENSUS:           fires <N> times across 204 rollouts  →  tier <200+ | 20-50 | <10>
PROXIMAL METRIC:  <exact counted quantity>
DIRECTION:        <must go up | must go down>
EXPECTED EFFECT:  <magnitude you would accept as confirming>
KILL LINE:        <result that ends the lever>
CONVERSION:       <proximal delta> x <unit cost> = <dollars or solve-probability>
CONTROL SET:      <tasks that must not regress>
```

---

## 4. Conversion arithmetic

A proximal win is not automatically a distal win. State the chain and make it falsifiable.

**Form:** `<proximal delta> × <cost per event> = <distal effect>`.

**Gutter example:** 8 corrupted anchors removed per 52 attempts × (one failed edit + one retry
turn, at the measured per-turn token mass) = the claimed dollar saving.

Write it down. It is a claim, and the joint replay in §7 will test it.

**The failure mode this prevents — a proximal metric that is a correlate, not a cause.** Turn
packing is the recorded example: 84% of sweet's tool calls already packed two or more operations,
so the proximal measure looked improvable. But the residual turns were **dependent** hops
(search → read → edit), which cannot be packed at all. The proximal metric moved with the target
without causing it. **The metric must sit on the causal path, not beside it.**

---

## 5. Solve is checked as non-inferiority, not improvement

Proximal metrics say nothing about whether you broke a solve. And solve is low-rate, so proving
improvement is expensive.

**Do not try to prove improvement. Prove non-breakage.**

Maintain a fixed **control set**: tasks that currently solve **2 of 2 reps**. Every lever runs
against it. Breaking a reliable solve is a kill, and it shows up fast and cheap.

The asymmetry is deliberate and it matches the risk. A 1% lever that is really 0% costs build
time. A 1% lever that is really −3%, or that costs a solve, is the expensive one. So the guards
belong on breakage, not on size.

**Report solve as resolved-rep rate, not task count** — 34 observations rather than 17. A lever
that turns a coin-flip task into a reliable pass is a real gain even when any-rep aggregation
shows no new task. `HANDOFF-SLATE-A-CLOSE.md` §0 already requires this; it is repeated here
because it is the same power argument applied to the other axis.

A lever that would rescue an *unstable* task stays invisible under this scheme. Accept that.

---

## 6. The undecidable tier

Some levers are mechanistically sound and permanently unprovable at this corpus size — the census
in §2 puts them under ten firings.

**They are not automatically dead.** File them as **UNDECIDABLE**, with:

- the mechanism;
- the census count that makes them unmeasurable;
- the build cost;
- what corpus size or task population *would* decide them.

The user accepts or declines them on principle. That is a legitimate decision and it is theirs.

Filing a lever honestly as undecidable is better than either pretending you measured it or
discarding a sound mechanism because the instrument is too coarse. **Do not launder an
undecidable lever into a measured one by finding a proximal metric that fires often but sits off
the causal path.** That is the §4 failure mode wearing a disguise.

---

## 7. The joint replay — once, at the end

Levers interact. The recorded case: **P and V3 each held solves alone; stacked with C, kompendium
went 1 of 2 to 0 of 2.** Individually clean, together regressive.

So: build on proximal evidence, then run **one** joint replay with every survivor applied at once,
plus one confirmation cohort.

**That is the only large run in the entire programme.** It happens after the building, not before
each brick.

**`SLATE-A-UBER.md` §7's ban on summing ceilings stands and matters more under the new bar.** Four
3% levers are not 12%. Under a 1% rule you will accumulate many small levers, and the temptation
to add them will be proportionally stronger. The portfolio number comes from the joint replay or
it does not exist.

---

## 8. Failure modes this doctrine exists to prevent

| failure mode | the guard |
|---|---|
| judging a 1% lever on a 16-point instrument | §1 — measure proximal |
| "we need a bigger run" | §2 — census decides measurability at `$0` |
| reading traces to see if you like them | §3.1 — pre-register the metric |
| a proximal metric that is a correlate, not a cause | §4 — state the conversion; the turn-packing case |
| accumulating levers on non-significant estimates | §2 + §7 — tier them, then one joint check |
| a saving that costs a solve | §5 — control set, solve is the veto |
| discarding a sound but unmeasurable mechanism | §6 — the undecidable tier |
| summing ceilings into a portfolio number | §7 — joint replay only |

---

## 9. Drop-in text for `HANDOFF-SLATE-A-CLOSE.md` §0

Add after the summing-ban paragraph. Do not edit `SLATE-A-UBER.md`.

> **Evidence type is fixed by mechanism frequency, not by effect size.** Before proposing a lever,
> count how often its mechanism fires across the 204 recorded rollouts. That census is `$0` and it
> decides what evidence is possible.
>
> Every lever declares a **proximal metric** — the thing it directly changes — and its direction,
> **before** any A/B runs. Corrupted-anchor rate, empty-result rate, billed tokens per first touch,
> redundant re-read count. The lever is judged on that metric from a microsmoke, never on the arm
> cost delta, which cannot resolve anything under about 10% on this corpus.
>
> Every lever also states its **conversion arithmetic**: how the proximal change becomes dollars or
> solves. Write it down. It is a claim, and it is falsifiable at the joint replay.
>
> **Solve is checked as non-inferiority, not improvement.** A fixed control set of reliably-solving
> tasks runs against every lever. Breaking one is a kill. Failing to improve an unstable task is
> not.
>
> A lever whose mechanism fires too rarely to measure is not dead. It is **undecidable**, and it is
> filed as such with its build cost, for the user to accept or decline on principle.

---

## 10. Immediate application — the three re-scored candidates

`HANDOFF-SLATE-A-CLOSE.md` re-opens C-4, C-9 and C-5. Each needs a proximal metric before it is
re-scored. **Two of the three need no paid run at all.**

### C-4 whole-file-on-first-touch — `$0`, pure replay, no model

The −2.35% that killed it is about **one seventh of the noise floor**. It was never measurable as
a cost delta, and re-running it as an A/B would produce another unreadable number.

- **Proximal metric:** total **billed input tokens** across the whole rollout, replayed
  deterministically from `turns/` plus the recorded reads.
- **The trap that must be in the metric:** lines delivered early are re-sent on every later turn.
  So the metric is **cumulative billed tokens**, not lines fetched once. Counting fetched lines
  will overstate the win.
- **The sign genuinely flips by harness.** Recorded: codex nibbles 4,723 lines vs 5,529 for one
  whole file — whole-file **worse**. claude 4,481 vs 4,126 — whole-file **better**. Confirm the
  sign on all three harnesses separately and never report a pooled figure.
- **Census:** collapsible repeat calls are 34 codex / 26 opencode / 34 claude, so about 94 events.
  Tier 20–50 per harness. Enough for a deterministic replay; **not** enough for a cost A/B.
- **Verdict route:** decided entirely by replay. Spend `$0`.

### C-9 structural editing — re-census first, on post-fix data

70% coverage was scored against a **pre-gutter** baseline. C-1 has since shipped and taken
corrupted anchors to **0 of 184**. That class of failure is gone.

- **The question is not "what is 70% worth."** It is: **what edit failures remain after C-1?**
- **Proximal metric:** count of failed edit attempts on **post-fix** runs, split by cause — stale
  address, wrong path, sub-symbol ambiguity. Anchor corruption should now be absent.
- **Do the census before any modelling.** The 184-trial screen may already contain the data. If the
  post-fix residual is near zero, C-9 is closed because C-1 ate it, and that is a clean result.
- **Scoring it against the original 20 anchor failures will overstate it several-fold.** That is
  the specific error to avoid.

### C-5 dependency tier — a solve lever with a cheap predecessor that is still unrun

1 case in 18 is a real solve lever under the new bar. It is also far too rare to resolve by A/B —
§2 tier "under 10". So it is decided by a **deterministic retrieval test**, not an outcome test.

- **Step 1, and do this first: reproduce item 4 from `HANDOFF-FIX-SWEET.md`** — the `ss-trace`
  cross-file fallback. It targets the **same** pytask contract and is costed in hours, against
  C-5's weeks. The callers in `report.py`, `build.py` and `graph.py` hold two literal
  `sys.exc_info()` flows. If repaired tracing surfaces them, you get the contract with no new
  corpus and C-5 may not be needed. **This item is still unaccounted for from the fix session.**
- **Step 2, proximal metric, `$0`, no model:** does the contract become retrievable? Concretely,
  can the tool return `tbh(None if self._excinfo is None else self._excinfo)` from the pinned
  pytest in image `swerebenchv2/pytask-dev-pytask:210-3022733`? Yes or no.
- **Step 3, the only part needing a model:** a two-task microsmoke with the pre-registered proximal
  metric **"does the final patch pass `exc_info`"** — not "does the task solve." The recorded
  discriminator is perfect: `exc_info` resolved 4 of 4, `()` or frame resolved 0 of 8. So the
  patch-shape metric is a valid proxy and it is far higher-rate than the solve outcome.
- **Conversion:** contract retrievable → model uses it → patch passes `exc_info` → task resolves.
  Each arrow is a separate claim. Steps 2 and 3 test the first two. The third is already
  established by the 4/4 vs 0/8 record.

---

## 11. Deliverable

Fold §9 into `HANDOFF-SLATE-A-CLOSE.md` §0, then in `SLATE-A-CLOSE-RESULTS.md` report, per lever:

- the six-step protocol block from §3.1, filled in;
- the census count and tier;
- the proximal result;
- the conversion arithmetic;
- the control-set result;
- the three-column ledger `HANDOFF-SLATE-A-CLOSE.md` §0 already requires — measured cost effect,
  measured solve effect, build cost.

Levers that come back **UNDECIDABLE** get their own section with build costs, so the user can
accept or decline them on principle.

State total spend. Under this doctrine, C-4 and C-9 should both be `$0`.

**Do not edit `SLATE-A-UBER.md` or `SLATE-B-UBER.md`.** They are the audit trail.
