# Phase 0 — scoreboard repair results

**Executes:** [`SLATE-A-UBER.md`](./SLATE-A-UBER.md) §8 Phase 0 (items 1–5)<br>
**Date:** 2026-08-12 — **Model spend:** `$0` (no agent rollout was launched)<br>
**Protected state:** no existing file under remote `results/` was modified; every new artifact
lives in `results/phase0-regrade-20260812/` or in a `rows-*.json` written beside the original.
HO2 untouched.

---

## 0. Verdict

**Three of the four defects are repaired and the corrected ledger reproduces every unaffected
published number exactly.** The fourth (D-1) turned out to have a second, deeper cause that the
plan did not anticipate, and it changes the recommendation.

| item | status | effect on the scoreboard |
|---|---|---|
| D-1 grader outage | root cause found and fixed; **a second defect found** | YARP still cannot carry a solve number — for a new reason |
| D-2 sidechain pricing | **repaired and applied** | Claude flips from `+2.4%` sweet-worse to `−9.4%` sweet-cheaper |
| D-4 empty `pages` | **fixed in the adapter** | no retrospective effect; applies to the next run |
| D-5 empty-task sensitivity | **published as a first-class flag** | OpenCode `−17.8%` / `−13.8%` |
| rebuild | **done and reproducible** | all ceilings recomputed by script, not by hand |

**The Phase-0 stop rule is satisfied for publication of cost, and NOT satisfied for
publication of solve.** Cost derivations reproduce to the last digit. The solve column still
rests on a grader that fails its own reference solution half the time on one task.

---

## 1. Reproduction check (the gate for everything else)

Before changing anything, the rebuilt derivation was run against the recorded rows. It
reproduces the published table exactly, so any later movement is attributable to a repair and
not to a new pipeline.

| harness | native | sweet | delta | matches `SLATE-A-UBER` §4.1 |
|---|---:|---:|---:|:--:|
| Codex | `$0.144666` | `$0.135322` | `−6.5%` | yes |
| OpenCode | `$0.135444` | `$0.111390` | `−17.8%` | yes |
| Claude (main-only) | `$0.199217` | `$0.203964` | `+2.4%` | yes (`$0.199218` published) |

Solve counts reproduce as well: Codex 9/17 vs 10/17, OpenCode 9/17 vs 9/17, Claude 9/17 vs 9/17.
The published baseline is the **idealCost** column; realized differs slightly and is now printed
beside it at full precision.

The C-2 selector ceilings reproduce from the same script: Codex `$0.127502` / 20 of 34 reps
(`−11.9%`), OpenCode `$0.112547` / 18 of 34 (`−16.9%`), Claude `$0.186907` / 16 of 34 (`−6.2%`).

---

## 2. D-1 — the grader outage, and the defect underneath it

### 2.1 Root cause: two different grader configurations

`eval.py` runs `git reset --hard HEAD` before applying patches. That reverts the image author's
**uncommitted working-tree edits**, which for `dotnet__yarp-2825` include the line that pins the
SDK the container actually has:

```
sed -i 's/10.0.100-preview.3.25201.16/8.0.416/g' global.json
```

Upstream already carries the repair — the `--reapply-install-seds` flag. The gold-validation
sweep (`env-ledger-sweep.mjs`) **has always passed it**. The rollout grader
(`evaluator-runtime.mjs`) **never did**. Gold was therefore certified under one configuration
and the agents were graded under another, and nothing in the pipeline compared the two.

`dotnet__yarp-2825` is the **only** task of the 18 in the rotate20 set with `sed -i` install
steps, so the blast radius is exactly the 12 rows already suspected and no others. That is why
every other row reproduces untouched.

### 2.2 What the 12 patches actually do

After the fix, all 12 regraded patches execute the suite — about **2150 test results each**,
against **zero** before.

**Every arm on every harness passes the target test.** `FAIL_TO_PASS` is 1/1 in all 12 cells,
and in all 8 gold runs. The recorded `f2pFrac = 0` was not a partial result; it was an artifact.

The differences between cells are entirely in `PASS_TO_PASS` regressions.

### 2.3 The second defect: the PASS_TO_PASS gate is noise

Grading the **same gold patch** eight times gives:

| gold run | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| tests recovered | 2151 | 2152 | 2153 | 2153 | 2152 | 2153 | 2153 | 2153 |
| `PASS_TO_PASS` failures | 2 | 3 | 0 | 0 | 5 | 0 | 1 | 0 |

**Gold — the reference solution — fails the grading gate in 4 of 8 identical runs.** Eleven
distinct `PASS_TO_PASS` tests failed gold at least once. They are timing-heavy proxy tests
(`WebSocketVersionNegotiation`, `RequestConnectTimedOut_Returns504`, `Expect100Continue`,
`ActivityCancellationTokenSource`) and have nothing to do with the Kubernetes ingress converter
the patch edits. Excluding that gold-derived set, gold grades FULL 8 of 8.

The flaky set was derived from **gold runs only**. No agent patch was inspected to build it, so
the exclusion cannot be tuned toward an outcome.

### 2.4 Consequence

`dotnet__yarp-2825` cannot contribute a solve number to any published table in its current
state. A single grading run of it is a coin flip whose bias is unknown. It is now held out of
the solve tables by the analyzer and named in the output, rather than silently scored zero for
both arms as before.

Per-cell majority verdicts over repeated gradings are recorded in
`results/phase0-regrade-20260812/stability/verdicts.json` for the record. They are evidence
about the task, not a solve column to publish.

### 2.5 The tripwire

A row can no longer be `gradeable = true` without proof that tests ran. `eval.py` now reports
`n_test_results` — the count its own log parser recovered — and the harness refuses to score any
item where that count is zero.

The two evidence-free causes are separated rather than merged, because collapsing them would
create a new bias:

- **task-wide** (no patch on the task, on any arm or rep, produced a test result) — an
  image or grader defect. The task is held out of the solve tables until it is regraded.
- **patch-specific** (a sibling row on the same task did run tests) — the agent's own patch
  broke the build. That is a real failure and stays in the denominator as unresolved.
  Excluding it would flatter whichever arm broke the build.

Covered by an assertion in `tests/evaluator-integrity.mjs`, which now also fails if the
`--reapply-install-seds` flag is ever dropped again.

---

## 3. D-2 — delegated subagents were billed and priced at zero

Claude Code writes each delegated subagent's conversation to
`<session-id>/subagents/agent-*.jsonl`, **not** into the main session transcript, and its
aggregate `result` usage excludes them too. The adapter read only the main transcript, so every
delegated request was paid for and recorded as free.

Recomputed from the retained per-rollout state with the same shared cost math:

| | native | sweet |
|---|---:|---:|
| rows that delegated (of 34) | 11 | 3 |
| delegated contexts | 11 | 3 |
| main-only total | `$0.404442` | `$0.413398` |
| delegated spend | `$0.071632` | `$0.021547` |
| inclusive total | `$0.476073` | `$0.434945` |

**Acceptance check: 68 of 68 rows reproduce their published main-only cost within 0.5%**, which
is what makes the corrected number trustworthy rather than merely different.

Claude head-to-head, per-task means:

| view | native | sweet | delta |
|---|---:|---:|---:|
| main-only (as published) | `$0.199217` | `$0.203964` | `+2.4%` |
| **sidechain-inclusive** | `$0.239224` | `$0.216651` | **`−9.4%`** |

Realized cost moves the same way, `−8.6%`. The paired confidence interval still crosses zero
(`p = 0.39`), so this is a corrected point estimate, not a demonstrated win.

Each subagent is priced as its own growing prefix and the totals are summed. Folding subagent
turns into the main sequence would destroy the prefix diff that `breakPriced` and
`contextRewrites` depend on.

Live adapter fixed for future runs; retrospective repair via
`harness/reprice-claude-sidechains.mjs`; regression tests in `tests/claude-code-cost.mjs`.

---

## 4. D-4 — the empty `pages` parameter

Confirmed exactly as reported: **68 native and 6 sweet** Read calls died with
`Invalid pages parameter: ""`. The backbone driving Claude Code here is not a Claude model, and
it fills the optional PDF-only string instead of omitting it.

Fixed with a tool-argument note appended to the system prompt of **both** arms, byte-identical,
naming only the malformed parameter. A test asserts it carries no retrieval or strategy content,
so it cannot quietly become an unmeasured prompt lever.

This changes agent behaviour, so it cannot be replayed onto the recorded rows. It takes effect
on the next run, where it is expected to **reduce native's Claude cost**. That movement is the
repair of our own defect and must never be reported as a sweet regression.

---

## 5. D-5 — the empty-issue task

`mransan__ocaml-protoc-202` has a zero-character issue. Refusing is the correct answer and costs
almost nothing, so leaving the task in flatters whichever arm refuses. Both views are now
produced by the analyzer itself (`--exclude`), not by hand:

| OpenCode view | native | sweet | delta |
|---|---:|---:|---:|
| all 17 tasks | `$0.135444` | `$0.111390` | `−17.8%` |
| excluding the empty task | `$0.128252` | `$0.110528` | `−13.8%` |

---

## 6. Rebuilt targets and ceilings

Cost target from §4.2 — at least 15% below native, recomputed on the corrected ledger:

| harness | 15%-below-native target | sweet today | remaining gap |
|---|---:|---:|---:|
| Codex | `$0.122966` | `$0.135322` | `$0.012356` |
| OpenCode (all 17) | `$0.115127` | `$0.111390` | already below |
| OpenCode (excl. empty task) | `$0.109014` | `$0.110528` | `$0.001514` |
| **Claude (sidechain-inclusive)** | **`$0.203340`** | **`$0.216651`** | **`$0.013311`** |

The Claude gap was `$0.034629` on the main-only ledger. Pricing the delegated requests closes
**62%** of it without any product change.

C-2 selector oracle, recomputed by script:

| harness | native | oracle | oracle vs native | oracle reps |
|---|---:|---:|---:|---:|
| Codex | `$0.144666` | `$0.127502` | `−11.9%` | 20/34 |
| OpenCode | `$0.135444` | `$0.112547` | `−16.9%` | 18/34 |
| Claude (main-only) | `$0.199217` | `$0.186907` | `−6.2%` | 16/34 |
| **Claude (sidechain-inclusive)** | `$0.239224` | `$0.201127` | **`−15.9%`** | 16/34 |

Every oracle gain of one task rests on a single resolved rep, and the analyzer now prints the
resolved-rep counts beside the task counts so that instability cannot hide behind an any-rep
number.

---

## 7. Two findings the plan did not predict

### 7.1 Cross-rep verdict instability is broad

Comparing rep 0 with rep 1 on the same task and arm, **10 of 102 cells flip**:

| harness | flipping cells |
|---|---:|
| Codex | 1 / 34 |
| OpenCode | 2 / 34 |
| Claude | 7 / 34 |

`teleporthq__teleport-code-generators-291` flips in **5 of its 6** harness-by-arm cells. That
pattern — the same task unstable across three independent harnesses and both arms — looks like
the YARP defect rather than agent variance, and it should get the same gold-repetition probe
before any solve claim rests on it.

### 7.2 The grader was never checked against itself

The deeper lesson of D-1 is not the SDK pin. It is that **gold validation and rollout grading
ran different configurations for months** and no invariant compared them. The green ledger was
honestly green; it was green about a different grader. A single assertion that both paths build
the same argument vector would have caught it.

---

## 8. What is now publishable

**Publishable:** every cost number in this document, on all three harnesses, in both the
inclusive and the excluded views. They reproduce the recorded rows exactly where nothing was
repaired and move only where a named defect was fixed.

**Not publishable:** any solve number involving `dotnet__yarp-2825`, and any claim that rests on
a single resolved rep. The `+1 task` scenarios in `SLATE-A-UBER` §4.1 are void — not because the
patches fail, but because the task's grading gate cannot tell a passing patch from a failing one
at better than a coin flip.

**Phase-0 stop rule:** satisfied for cost. For solve, the rule fires — one task marked gradeable
did not have trustworthy test evidence, and it is now held out rather than scored.

---

## 9. Recommended next step

Phase 1's `$0` gates are unblocked for every candidate whose evidence is cost or trace
structure — C-1, C-3, C-4, C-9 and the C-2 routing simulation can all start now.

Two things should be settled first, both `$0`:

1. **Run the gold-repetition probe on `teleporthq__teleport-code-generators-291`** and on any
   other task whose reps disagree. If more graders are noise-dominated, the 17-task solve column
   is weaker than any candidate ceiling built on it.
2. **Decide `dotnet__yarp-2825`'s fate** — deflake it by pinning the eleven timing-dependent
   tests out of `PASS_TO_PASS` via the existing `excludeP2P` override, or drop it from the set.
   Leaving it in as a coin flip means one sixth of the both-solved stratum is noise.

Neither needs a model rollout, and neither should wait for one.
