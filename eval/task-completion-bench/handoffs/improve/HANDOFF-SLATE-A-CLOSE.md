# HANDOFF — close out Slate A

**Written:** 2026-08-13. **Spend authorised:** `$0`. **Deliverable:** `SLATE-A-CLOSE-RESULTS.md`
beside this file.
**Executes:** [`SLATE-A-UBER.md`](./SLATE-A-UBER.md) §8 Phase 2, plus a re-scoring of two Phase 1
verdicts under a bar the user has changed.

**Scope:** Slate A only. Slate B is the next session's work, not yours. Do not start it.

**Do not edit `SLATE-A-UBER.md` or `SLATE-B-UBER.md`.** They are the audit trail. Your findings go
in your own results document; if a plan section is superseded, say so in your document and point
at it.

Read §0 first. It reverses two verdicts that Phase 1 recorded as kills.

---

## 0. The bar has changed on both axes — a genuine 1% is kept

Slate A kills levers two ways that are **no longer policy**:

1. a **materiality bar per lever** — 15% in the plan, `−5%` as applied to gate 2 — which killed
   levers that **saved money**; and
2. a **must-do-both requirement**, cost *and* solve, which discounted levers that genuinely
   improved one axis and were merely neutral on the other.

**The new rule, binding on every verdict you write. A lever is kept if it is a genuine improvement
on EITHER axis.**

| at its best measured shape, the lever… | verdict |
|---|---|
| saves cost — **1% counts** — and does not lose a solve | **KEPT** |
| improves solve — **including a 1% improvement in the chance of a solve** — and does not regress cost by more than that is worth | **KEPT** |
| improves one axis and is **neutral** on the other | **KEPT.** "Does not do both" is not a kill. |
| costs more **and** does not improve solve | **DEAD** |
| saves money **and loses a solve** | **DEAD.** Solve is still the veto. |
| measures **zero** on both axes | **DEAD** |

**Solve improvement is probabilistic and counts as such.** A lever that stabilises an unstable
task — turning a coin flip into a reliable pass — is a real gain even when any-rep task
aggregation shows no new task. Report it as a change in **resolved-rep rate**, not only in task
count.

**"Cannot alone deliver domination" is not a kill.** It is a statement about one lever's size, and
it says nothing about whether the lever is real. `SLATE-A-UBER.md` uses that phrasing to discount
C-5; treat it as a size note, not a verdict.

**The 15% bar moves from the lever to the portfolio**, and the both-axes requirement moves to the
**publication claim**, where §4.3 and §12 already put it. No individual mechanism has to carry
either.

**What has not changed — `SLATE-A-UBER.md` §7's ban on summing ceilings.** Four 3% levers are
**not** 12%. They overlap, and carried context makes some of them interact. A portfolio number
comes from a **joint replay** with all survivors applied at once, or it does not exist.

### 0.1 How a 1% lever is established — added by `HANDOFF-EVIDENCE-DOCTRINE.md` §9

The bar above keeps a lever that saves 1%. **The benchmark cannot measure 1%** — the most recent
cost figure is `−15.85%` at `p = 0.335`, a standard error of about 16 percentage points. The rule
below is how a small lever is shown to be real anyway. It is binding on every verdict in this
document, and the full argument is in
[`HANDOFF-EVIDENCE-DOCTRINE.md`](./HANDOFF-EVIDENCE-DOCTRINE.md).

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

**What this obliges you to do that the old bar did not:** every kept lever needs an **engineering
cost note**. Deliver a three-column ledger — measured cost effect, measured solve effect, build
cost. Whether to build twelve 1% levers is the user's decision, not yours; your job is to make it
a priced decision instead of a guess.

---

## 1. Where Slate A actually stands

**Phase 0: complete** (`PHASE-0-RESULTS.md`, `ab4f252`).
**Phase 1: complete** — ten gates, ten verdicts. The three that were blocked by document
contamination were re-run blind and scored.

| gate | candidate | Phase 1 verdict | status under §0 |
|---|---|---|---|
| 1 | C-1 anchor rendering | SHIPPED `116ca2b` | done |
| 2 | C-4 whole-file first touch | DISCARD, `−2.35%` vs a `−5%` bar | **RE-OPEN — §2.1** |
| 3 | C-2 selective superset | DISCARD, loses a solve on 2 of 3 harnesses | **stays dead** (solve veto) |
| 4 | C-3 causal coprocessor | DISCARD, `+2.7%` to `+7.5%` on solved rollouts | **stays dead** (negative) |
| 5 | C-9 structural editing | DISCARD, 70% addressable vs a 90% bar | **RE-OPEN — §2.2** |
| 6 | C-5 dependency tier | CAPPED, 1 case in 18 tasks | **KEPT as a small solve lever — §2.3** |
| 7 | C-6 obligation compiler | blocked → run blind, survives with a scope cut | **live — §4** |
| 8 | C-7 contract compiler | blocked → run blind, **FAIL** 1 of 8 vs a bar of 3 | dead |
| 9 | C-8 referee | blocked → run blind, **FAIL** 5 of 8 vs 80% | dead |
| 10 | R-1 turn-0 dossier | DISCARD, `+0.41%` to `+1.82%` | **stays dead** (a loss) |

**Phase 2 is what remains, and five of its seven steps point at candidates now dead or shipped.**
What is left is §2, §3, §4 and §5 of this document.

---

## 2. Re-score the three verdicts that §0 changes

These were killed for being **small or partial**, not for being wrong. Re-measure each at its best
shape and put the survivors in the ledger.

### 2.1 C-4 — whole-file on first touch

**Killed at `−2.35%` against a `−5%` bar. `−2.35%` is a saving.** Under §0 it is kept if the sign
holds.

What Phase 1 established and you should not redo: 27 policy variants, thresholds swept 200 to 1500
lines, carrying cost measured rather than assumed, and past roughly 900 lines the policy turns
into a net loss. That part stands.

**What is left to measure:** the optimum threshold was found on Codex. Confirm the **sign on all
three harnesses** — `−2.35%` on one harness and `+1%` on the others is not a kept lever. Then
check solve: Phase 1 warned that more context can distract, and never tested it. If solve is
neutral and cost is negative on every harness, C-4 is kept at its optimum threshold, not at the
first-touch shape the original gate used.

Script: `phase1-scripts/v2-c4-variants.mjs`.

### 2.2 C-9 — index-addressed structural editing

**The 90% was a coverage bar, not a cost bar**, and the coverage question is the wrong one now.
Replace it with the dollar question: **what is 70% addressability worth, after C-1 already removed
the gutter class?**

Phase 1 §11.4 found the arm asymmetry C-9 existed to fix was already gone. So the honest answer
may be near zero, and near zero is dead. **Measure it rather than inheriting a pass/fail.** The
residual after C-1 is sub-symbol fragments, which symbol addressing cannot name — so expect a
small number, and be willing to write "dead, for a reason that is now different".

Script: `phase1-scripts/v5-c9-generous.mjs`.

### 2.3 C-5 — dependency-source index tier

Capped at **1 declared-dependency case in 18 tasks**, and the plan calls it "cannot alone deliver
all-harness domination". Under §0 that sentence is a size note. **One case in eighteen is a real
solve lever**, and it is kept as such.

**Do not re-run the audit** — Phase 1 §6 did it. What is missing is the cost line: what does the
extra corpus and the extra call cost on the rollouts that trigger it? The prior `+$0.0005` per
triggered rollout is a hypothesis, never measured. Measure it, then file C-5 in the ledger with a
build-cost note — the plan estimates weeks of corpus, version and licence work for a one-task
ceiling, and that ratio is the actual decision.

### 2.4 These stay dead, and §0 does not revive them

Each is negative or solve-negative at its best shape, not small:

- **C-2 pre-run routing** — loses a task on OpenCode and Claude. Solve veto. Note for later: the
  oracle gap is real, so a **runtime-signal** router is not refuted; only a **pre-run** one is.
- **C-3 context reset** — the saving exists only on rollouts that never solve; on solved rollouts
  the reset costs 2.7% to 7.5% more. Report the **net on the arm**, not the subset, if you touch
  it at all.
- **R-1 turn-0 dossier** — `+0.41%` to `+1.82%`, a loss on every harness and both arms. It closed
  the whole push-context-early family for a reason that flatters the product: sweet has 8%
  precomputable early requests against native's 20%. There is nothing at turn 0 left to remove.

**One sentence you must revise in your results.** `PHASE-1-RESULTS.md` §13.3 concluded "the cost
frontier on this corpus is closed." **That was reached under a 5–15% bar and does not survive
§0.** State the corrected position: at a 1% bar with stacking, the frontier is not closed, and
here is the ledger.

---

## 3. Repair the pre-registered cost definition — do this first, it is the cheapest item

`RESULTS-2026-08-13.md` §9 is **binding on every future cost claim from this benchmark** and is
now stale in two places. Until it is fixed, no figure here is publishable.

**§9.1 must be re-decided.** It chose the main-only column *because* the sidechain-inclusive
column was null at different rates per arm — 12 of 32 native against 4 of 32 sweet. Commit
`599a3f7` removed that reason: the null pattern was a **reader defect**, not missing data, and the
column is non-null everywhere now. The reason for the choice is gone, so take the choice again on
current facts. What hangs on it: `−19.51%` main-only against `−29.26%` sidechain-inclusive.

**§9.2 needs a sibling clause for the run-directory tax.** The `pages` tax has a clause; this one
does not, and it is the same size — **7.4 points** of the Claude arm delta, inside every Claude
figure already published. `PHASE-1-RESULTS.md` §12.3 says explicitly that it belongs beside the
`pages` line. Write it there: what it was, how large, fixed in `c4d665b` for future runs only,
unreplayable onto recorded rows.

**Disclose the arm-leakage channel in the same place.** The old run-directory name put
`__sweet__` or `__native__` inside the agent's own working directory, which the harness puts in
the system prompt. Every run to date had that channel open. Nothing in the traces suggests a
rollout acted on it — say that too, and let the reader decide.

---

## 4. C-6 — the only live candidate, and the one that decides Slate A

C-6 is the sole surviving candidate with a solve path, and the only one that alone clears the
solve bar on all three harnesses.

### 4.1 Where it stands

- **Round 1: PASS**, 2 of 2 — but every task edited existing files, so it showed precision, not
  recall of absent structure.
- **Round 2: FAIL** against a bar requiring five of five — 4 of 5.
- **On the question round 2 existed to answer: 6 of 6.** Four new source modules across three
  tasks, all four predicted with the correct owning package, and no module claimed on the two
  tasks that add none.
- **False positives 2 of 21 nodes**, both pre-marked low confidence. **Across both rounds no
  high-confidence node has been wrong.**
- The one failure was a judgment about maintainer intent, not blindness: the derivation concluded
  a fix must preserve a value; the accepted fix deletes the construct. The lock **named** that
  alternative and predicted against it.

**FAIL is the recorded verdict and it stays.** §0 keeps small *measured* gains; it does not
re-cut a pre-registered bar after seeing the result. Four candidates have died on gates like this
one, and re-cutting now would retroactively devalue all four.

### 4.2 What to do, in this order — the order is load-bearing

1. **Write the narrowed claim and freeze it.** The blinded session's own proposal: claim
   obligation *shape*, gate *mechanism* separately, and move low-confidence nodes into a tier that
   is not an assertion.
2. **Hash it and publish the hash.**
3. **Then** run `handoffs/blinded/picker/pick-newmodule-slate.mjs` with a new seed.

Narrowing after seeing which claim failed is legitimate. Narrowing after the next slate is drawn
is tuning to the observed failure. The picker is seeded, so the order is enforceable — enforce it.

### 4.3 You may not run the derivation yourself

**This document names the answers.** So does everything in `handoffs/improve/`. Write a sealed
brief into `handoffs/blinded/round3/`, modelled on
`handoffs/blinded/round2/HANDOFF-BLINDED-ROUND-2.md`, and let a **fresh session** derive. You
score the reveal.

Blinding has now broken **three times**: `SLATE-A-UBER.md` printing its own answer key,
`MEMORY.md`'s auto-loaded index naming a task's answer, and a brief quoting the deciding fact in
its own body. **Before handing any brief over, grep `MEMORY.md` and the brief itself for every
task ID, repository name and symbol in the exercise.** Assume there is a fourth channel you have
not found.

### 4.4 The gap that actually decides C-6, and which nobody has measured

Every gate so far asks whether the graph can be **derived**. **None asks whether handing an agent
a correct graph changes its patch.** A perfect obligation graph the agent ignores is worth
nothing.

That is the product question. It costs money, and it is the first paid step in this programme that
the evidence would justify. **Do not run it — recommend it, priced.** Temper it with scale:
**14 of 179** eligible development tasks author a new source module, about **8%** addressable.

---

## 5. D-6 — make the test verdict terminal in the runner

The last unfinished correctness fix from Phase 2 step 1.

Codex Apple sweet received `Script running with cell ID N / Wall time 11.0 seconds / Output:` —
empty — then claimed the tests completed successfully. Yield-before-completion appears in **14
codex task-arm cells across eight tasks**.

The long-yield instruction in `codex-task-runner.mjs` covers the mechanism at the prompt level and
shipped in `540f76c`. **The FRAME already told the agent to wait and the agent ignored it**, so
another prompt sentence is not the fix. The runner must force the blocking behaviour, or return a
handle the harness itself resolves before another model step.

Zero head-to-head differential by construction — it applies to both arms. Do it for validity, and
never book it as a sweet win.

---

## 6. What Phase 2 looks like after you are done, and what gates Phase 3

Write this section of your results as a recommendation, not an action.

- **Phase 2 survivors** are whatever §2 keeps, plus C-6 if round 3 clears its narrowed bar. Give
  each a build-cost note so the build decision is priced.
- **Phase 3 stays NO-GO.** The publication bar is cost at least 15% below native **and** strictly
  more solves on every harness. Solve is tied 9 of 16. No lever in §2 raises solve, and C-6's
  derivation-to-solve conversion is unmeasured. §0 changes what you keep; it does not change what
  may be published.
- **Phase 4** — a fresh, stratified task set — is where Slate A ends, and it is the same work as
  the new held-out plan. Name it; do not start it.
- **Slate B is the next session's scope.** Note only that four of its eight W0 gates already have
  answers under Slate A names (P1↔C-5, P3↔C-7, P5↔C-6, P7↔C-8), so that session does not
  re-run them. Nothing more.

---

## 7. Environment and evidence

**Evidence box:** `ssh root@167.233.69.121`. Do not launch pilots, do not spend, do not mutate
`results/`. **Copying files either direction is fine** — most indexes are also on the Mac.
Analyses that write nothing to the host:

```bash
ssh root@167.233.69.121 'node -' < your-script.mjs
```

Disk was 55G free on 2026-08-13; abort below 12G. Another agent may be using the host.

**Runs:** `/root/sweet-search-private/eval/task-completion-bench/results/{sb-codex-20260811,sb-opencode-20260811,sb-claudecode-20260811}` and `screen-v3-20260812`.
Expect 68 main rollouts per harness, 14 Claude sidechains, 104 grading logs.

**Reader:** `/root/dump-trace.mjs`, local copy beside this file, untruncated by default.

```bash
node dump-trace.mjs --list
node dump-trace.mjs <task> <native|sweet> --harness <codex|opencode|claude-code> --rep <0|1> --subagents
```

**Phase 1's scripts are in `phase1-scripts/`.** Reuse them; do not rewrite the replays.

**Four traps that have each cost a wrong conclusion here:**

1. **Never infer absence from `trajectories/`** — results truncate at 600 characters, inputs at
   200.
2. **`report.json` is not authoritative.** It disagrees with `rows.json` one-directionally on
   roughly a third of rows because it predates the grader repairs. **Score from `rows.json`
   `resolved`.** Using the wrong file moved one blinded gate from 2/8 to 5/8.
3. **Check the `degenerate` flag before opening a cost outlier's trace.** One task was published
   as a sweet regression when it was a single degenerate rollout, billed-to-retained output ratio
   13.29.
4. **Golden checkouts are single-commit repositories** — all 456. `git init`, one commit named
   `base`, at a synthetic SHA that is not the upstream commit. The directory name
   `<repo>@<upstream_sha>` is a label, not a resolvable ref, so `git checkout <base_commit>` always
   fails. **The tree already is base and is clean — read it as it is and verify pre-fix state by
   content.** Upside worth preserving: `git log` shows only `base`, so a session cannot read
   forward. That is free blinding.

---

## 8. Standing constraints

- **Spend `$0`.** Every step here is a replay, a census, or a document repair. If a step seems to
  need a model rollout, you have misread it.
- **HO2 is frozen.** Never run it, never inspect it. The pool here is the development set.
- **Never use `ss-*` commands to develop sweet-search.** Native file tools only. Running `ss-*` as
  the system under test against a non-sweet-search corpus, with scripted assertions, is testing
  and is fine.
- **The working tree is dirty** — roughly 30 files belong to concurrent daemon and maintainer
  work. Do not revert, stash or clean. To commit a file that mixes your work with theirs, stage by
  hunk: `git diff -U3 <file>`, filter, `git apply --cached`. Zero-context (`-U0 --unidiff-zero`)
  mis-places hunks — it has done so in this repository.
- **Git:** solo project, commit direct to `main`, no feature branches, and only when asked.
- **Never route the Sol model through OpenRouter** — roughly 50× subscription cost.
- **Any new ranking signal that detects structured-query patterns must gate on
  `opts._isAgentFormat`.** Ungating has cost held-out MRR twice, once by 27.57 points.

---

## 9. Method, carried forward

**Sweep the shape of a mechanism, not one parameter of it.** Phase 1's second pass cost nothing,
flipped one verdict outright, restated two killing facts, and proved one of its own hypotheses
wrong. Before you write DEAD, ask whether you tested the capability or one way of expressing it.
This matters more under §0, not less: a lever that misses at one shape may be a kept 2% at
another.

**Write the hypothesis as a falsifiable prediction with two halves, then measure both.** The
run-directory tax was found exactly that way — the first half held, the second inverted, and the
inversion was the finding.

**Report what you did not do.** A step you skipped, a task you excluded, a bar you could not meet
— say it. A contaminated or partial result reported as clean is worse than an unrun one, because
it looks like evidence and cannot be told apart later.

---

## 10. Deliverable

`SLATE-A-CLOSE-RESULTS.md` beside this file, containing:

1. **The re-scored verdicts** from §2 — C-4, C-9, C-5 — each with cost effect, solve effect, and
   build cost.
2. **The stacking ledger**, and the **joint replay** number for everything kept. Never a sum.
3. **An explicit revision** of the "cost frontier is closed" sentence under the new bar.
4. **What changed in the pre-registered cost definition** (§3), quoted.
5. **The sealed round-3 brief** for C-6, written outside this directory, with its leak check
   recorded — and the frozen, hashed narrowed claim.
6. **D-6's fix**, or a statement of why it could not be made in the runner.
7. **A priced recommendation** for Phase 2, and the explicit reason Phase 3 remains NO-GO.

**Implement only the correctness fixes in §3 and §5.** Building a product lever is a separate
decision, taken after this is read.
