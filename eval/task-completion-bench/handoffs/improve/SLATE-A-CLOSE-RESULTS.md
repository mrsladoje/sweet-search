# SLATE A — close-out results

**Written:** 2026-08-13. **Spend: `$0`.** Every number here is a replay, a census or a document
repair over artifacts that already existed.
**Executes:** [`HANDOFF-SLATE-A-CLOSE.md`](./HANDOFF-SLATE-A-CLOSE.md).
**Scope:** Slate A only. Slate B was not started.

---

## 0. Verdict, first

**Three levers survive the new either-axis bar, they are worth 2.4% to 3.4% together, and that
is the whole remaining cost frontier on this corpus.**

| | measured cost effect | measured solve effect | build cost |
|---|---|---|---|
| **C-4** whole-file, span-gated | **−2.69% / −2.31% / −0.88%** (Codex / OpenCode / Claude) | not measurable at `$0`; exposure bounded at 2–6% extra context on 8–10 of 34 rollouts | **small** — one serving policy and two thresholds inside `ss-read` |
| **C-9** index-addressed editing | **−2.27% of sweet's Claude spend**; ≤0.89% OpenCode; **0% Codex** | none claimed | **weeks** — a new structural editing tool, plus the tool-surface work to make the agent use it |
| **C-5** dependency-source tier | **+$0.0005 per triggered rollout** (measured, was a hypothesis) | 1 task in 18; upper bound **+5 resolved reps in 8** on that task | **weeks** — ecosystem resolvers, storage, provenance, licence tracking; one verification still open |
| **joint replay, all three at once** | **−2.36% / −3.01% / −3.40%** | — | — |

**The portfolio does not reach the 15% bar that §0 of the handoff moved onto it.** Three levers,
replayed together, are worth 3.4% at best. That is the honest close of Slate A: the frontier is
not closed at 1% — C-4 and C-9 are real — but it is much smaller than twelve 1% levers.

**C-6 is unresolved and is the only candidate with a solve path.** Its round-3 exercise is
written, sealed and ready for a fresh session (§5). **Phase 3 stays NO-GO** (§7).

**One correction that outranks every lever here.** The pre-registered cost column was chosen for
a reason that no longer exists, and re-deciding it moves this benchmark's headline from **−19.51%
to −29.26%** (§1). That is 10 points, against a portfolio worth 3.

> **Amended 2026-08-14 by [`HANDOFF-EVIDENCE-DOCTRINE.md`](./HANDOFF-EVIDENCE-DOCTRINE.md) — see §9.**
> The doctrine was applied to all three re-scored levers at `$0`. **C-4 stands. C-9 is now DEAD:**
> its `−2.27%` pooled a pre-C-1 run with a post-C-1 run, and on the only post-fix run the whole
> prize is `0.64%` of one arm from four events (§9.4 Q4). C-5's longest-standing open verification
> is closed. **The row for C-9 in the table above is superseded; read §9 first.**
>
> **Scope note, 2026-08-14:** the project owner has ruled out building new tools. Only improvements
> to tools that already exist are in scope. That rule and the C-9 correction agree — see §9.9.
>
> **Slate A's single deliverable, settled on all three harnesses in §9.12:** `ss-read` expands to
> the whole file when the requested span already covers **≥25%** of a file of **≤600 lines**.
> **−1.60% / −2.08% / −4.72%** on Codex / OpenCode / Claude, mean **−2.80%**, saving on all three.
> No flag. The C-4 row in the table above is superseded — its parser missed 35% of reads.

---

## 1. The pre-registered cost definition, repaired (handoff §3)

Edited in place in [`RESULTS-2026-08-13.md`](./RESULTS-2026-08-13.md) §9, dated, with the
superseded text kept visible under its own rule 4. Three changes, one of them not asked for.

### 1.1 §9.1 re-decided — the headline column is now sidechain-inclusive

**The reason for main-only is gone.** It was chosen because the sidechain-inclusive column was
null at different rates per arm. After `599a3f7` the repaired column is non-null everywhere:

| | main-only null | repaired inclusive null | delegating rollouts | sidechain requests still imputed |
|---|---:|---:|---:|---:|
| native | 0 / 32 | **0 / 32** (was 12 / 32) | 12 / 32 | 66 of 168 = **39.3%** |
| sweet | 0 / 32 | **0 / 32** (was 4 / 32) | 4 / 32 | 26 of 67 = **38.8%** |

**The decision is a trade between a known bias and a bracketed uncertainty.** Main-only omits
**20.8% of native's spend and 11.4% of sweet's** — a 9.4-point, one-directional bias, because
native delegates three times as often. The inclusive column's residue is imputed, but at an
arm-symmetric rate, and the LOW/HIGH band spans **2.5 points** of the arm delta. A bracketed
2.5-point uncertainty beats a 9.4-point bias whose direction is known in advance.

| view, `pages` tax removed | native | sweet | delta |
|---|---:|---:|---:|
| main-only — first decision, kept as the conservative floor | `$0.440523` | `$0.354563` | −19.51% |
| **sidechain-inclusive MID — adopted** | **`$0.565523`** | **`$0.400076`** | **−29.26%** |
| LOW / HIGH | `$0.546306` / `$0.584741` | `$0.393629` / `$0.406523` | −27.95% / −30.48% |

Reproduced from `phase1-scripts/04-sidechain-repair.mjs` and `05-corrected-headline.mjs`,
main-only reproduction **64 / 64** within 0.5%.

**Said plainly: this change flatters us, and that is why it is fixed now rather than later.** The
bias it removes was working against sweet — under-charging native's delegated work made native
look cheaper than it is. The rule is adopted for future runs in whichever direction it points.
Both columns travel together in every published figure.

Codex and OpenCode produced no delegated transcripts, so the two columns are identical there and
nothing about those harnesses changes.

### 1.2 §9.2 gains the sibling clause it was missing, and a sensitivity it did not have

**The run-directory tax is now disclosed beside the `pages` tax**, as `PHASE-1-RESULTS.md` §12.3
asked: what it was (a ~45-character run-directory name both arms mistyped), how large (**12.66%
of native, 5.29% of sweet, 7.4 points of the arm delta** — the same size as `pages`), that it is
**not one-sided so it cannot be subtracted**, that it is fixed at the source in `c4d665b` for
**future runs only**, and that it cannot be replayed onto recorded rows.

**The arm-leakage channel is disclosed in the same place.** The old directory name put
`__sweet__` or `__native__` inside the agent's own working directory, which the harness puts in
the system prompt. **Every run published from this benchmark to date had that channel open.**
Nothing in the traces suggests a rollout acted on it, and the reader is entitled to discount
anyway.

**Not asked for, and found while building the instrument:** the `$0.035160` `pages` figure is a
point where the evidence supports a bracket. Re-deriving it from the merged per-request
transcripts gives `$0.049313` charging every one of the 110 rejections its issuing turn, and
`$0.024090` charging each *issuing turn* once — rejections arrive in parallel batches, so 110
calls come from 58 turns. The published figure sits inside that bracket, and the choice moves the
main-only headline between **−16.84% and −21.49%**. The census itself reproduces `RESULTS` §1
exactly: 299 native `Read` calls carrying `pages`, spelled `""` × 99, `" "` × 11, `"1"` × 174,
ranges × 15, and **110 rejections**.

### 1.3 A third staleness, found by measuring: the degenerate sensitivity was mostly an estimator artifact

§9.3 justified its retry rule with a **15.6-point** swing between pricing and excluding degenerate
rollouts. Excluding them leaves **28 native against 31 sweet**, and the published sensitivity
summed each arm's raw total over those unequal counts — the same defect as rule 2, one level up.

| column | all priced | excluded, raw arm totals | excluded, **per-task arm means** |
|---|---:|---:|---:|
| main-only | −19.51% | −3.89% *(published −3.96%)* | **−13.24%** |
| inclusive MID | −29.26% | −23.67% *(published −23.71%)* | **−28.87%** |

**The swing is 6.3 points on main-only and 0.4 points on the adopted column, not 15.6.** The
retry rule still stands — it is right for a run that can be re-run — but its justification is now
the smaller number, and the adopted column is nearly insensitive to the decision. Two new
standing rules follow, added to §9.4: name the estimator with the number, and never compare raw
arm totals over unbalanced rollout counts.

### 1.4 Significance, which §1.4 of `PHASE-1-RESULTS` left open

Paired bootstrap over tasks, 20,000 resamples, fixed seed, `pages` tax allocated per rejected
call:

| column | ratio of sums | mean of per-task ratios |
|---|---|---|
| main-only | −19.51%, CI [−42.1, +15.5], **p = 0.246** | −3.68%, CI [−33.6, +37.2], **p = 0.820** |
| **inclusive MID** | −29.26%, CI [−50.2, −2.5], **p = 0.031** | −19.78%, CI [−40.4, +1.8], **p = 0.072** |

**The adopted column clears `p < 0.05` under one of two reasonable statistics and not the other,
so it is not a significant result and may not be published as one.** The two statistics disagree
by 9.5 points because the first weights expensive tasks and the second weights tasks equally.
This procedure also does not reproduce the `p ≈ 0.34` in `RESULTS` §0, whose resampling
convention was never recorded — which is exactly the defect the new rule 5 exists to prevent.

---

## 2. The three re-scored verdicts (handoff §2)

### 2.1 C-4 — whole-file on first touch: **KEPT**, and the shape matters more than the threshold

Phase 1 killed it at `−2.35%` against a `−5%` bar and found the optimum on Codex only. §2.1 asked
for the sign on all three harnesses. The Codex replay was generalised to OpenCode
(`opencode-retained/*/attempt-1.stdout.ndjson`, `step_finish` token blocks) and Claude
(`claude-home/projects/*/*.jsonl`, requests merged by `message.id`), with the same accounting:
tool-result tokens of request *k* are `T(k+1) − T(k) − out(k)`, and the only estimated quantity is
the injected line count, taken from the real file bytes in the base checkout.

**The same policy shape is optimal on all three harnesses** — span-gated expansion, expand only
when the requested span already covers ≥40% of a file of ≤400 lines:

| harness | best delta | CI95 | P(saves) | rollouts touched | median injection | baseline drift |
|---|---:|---|---:|---:|---|---:|
| Codex | **−2.69%** | [−5.92%, −0.15%] | 98.7% | 10 / 34 | +757 tok = 2.0% of final context | 0.01% |
| OpenCode | **−2.31%** | [−4.14%, −0.40%] | 99.3% | 8 / 34 | +1,344 tok = 6.1% | 0.06% |
| Claude | **−0.88%** | [−2.41%, +0.40%] | 84.9% | 10 / 34 | +1,645 tok = 3.3% | 0.01% |

**The sign holds on all three. Claude's saving is not distinguishable from zero.**

**The originally-specified shape is the weaker one.** First-touch expansion gives
−2.35% / −2.09% / **−0.32%**, and on Claude it makes 9 of 13 affected tasks *worse*. Widening the
window instead of expanding to the whole file is **positive** on OpenCode and Claude
(+2.7% and +1.6% at ±25 lines), and a 1500-line threshold is positive on all three. The mechanism
fails in the open exactly where the plan predicted, and only one shape of it survives.

**Solve was not measured and cannot be at `$0`.** The replay changes what the agent sees, so the
counterfactual trajectory does not exist in retained data. What can be bounded is the exposure:
the policy touches 8 to 10 rollouts in 34 and adds a median 0.8k–1.6k tokens, 2% to 6% of that
rollout's final context. That is the size of the distraction risk Phase 1 warned about and never
tested. It is small; it is not zero; it is not measured.

**Verdict: KEPT** under the either-axis bar — a genuine saving on every harness at its best
shape, at a build cost that is a serving policy and two constants.

### 2.2 C-9 — index-addressed structural editing: **KEPT on one harness, and worth about 2.3% there**

The coverage bar is replaced by the dollar question. Failed edits are priced by the settled rule —
charge the turn that issued the rejected call — using each turn's **marginal** contribution to the
ideal column (fresh input at the new-token rate, the re-sent prefix at the cache rate).

| run | arm | failed edits | wasted round trips | share of arm |
|---|---|---:|---:|---:|
| Codex | native / sweet | **0 / 0** | `$0` / `$0` | 0% / 0% |
| OpenCode | native / sweet | 6 / 4 | `$0.003566` / `$0.001974` | 1.32% / **0.89%** |
| Claude `sb` | native / sweet | 18 / 32 | `$0.030025` / `$0.056098` | 7.54% / **13.75%** |
| Claude `screen-v3` | native / sweet | 17 / 15 | `$0.086434` / `$0.046517` | 18.17% / **13.12%** |

Codex's zero is real, not a blind detector: 119 `apply_patch` calls, 119 outputs matched, none
carrying an error. OpenCode's `apply_patch` errors were found only after fixing the detector,
which first looked for the wrong tool name.

**What C-9 could recover**, over both Claude runs, sweet arm, 47 failures:

| classifier | addressable | recoverable | of sweet's Claude spend | arm delta moved |
|---|---:|---:|---:|---:|
| C1 strict | 19 / 47 | `$0.011268` | 1.48% | 1.29 pts |
| **C2 enclosing symbol unique — the faithful reading** | **30 / 47** | **`$0.017339`** | **2.27%** | **1.98 pts** |
| C3 + resolvable wrong-path | 37 / 47 | `$0.020721` | 2.72% | 2.37 pts |
| C4 maximal | 43 / 47 | `$0.024326` | 3.19% | 2.78 pts |

**A correction to `PHASE-1-RESULTS.md` §5.** Its dollar figures for the same population
(`$0.092067` sweet, `$0.141162` native) priced each failed request **in isolation** —
`costFromTurns([turn])`, which charges the entire context at the fresh-input rate rather than the
cache rate, roughly doubling the marginal cost of a mid-conversation round trip. The corrected
figures are about half, and they move C-9's prize down, not up. The *shares* Phase 1 published
(13.1% sweet, 9.9% native) are reproduced to 0.2%.

**The failure population is dominated by something C-9 cannot fix.** On `screen-v3`, `$0.039309`
of sweet's `$0.046517` is two decoding blow-ups — the degenerate class, not an addressing failure.

**Verdict: KEPT, scoped.** It clears the 1% bar on Claude at 2.27% and misses it on the other two
(≤0.89% OpenCode, 0% Codex). It is a real saving whose build cost is a whole new editing tool, and
that ratio is the decision, not the sign.

### 2.3 C-5 — dependency-source tier: **KEPT as a small probabilistic solve lever, and now priced**

The audit was not re-run. The missing line was the cost, and the prior `+$0.0005` per triggered
rollout was a hypothesis. Simulating one extra dependency-source round trip on the
declared-dependency task — one request, its own output, and its result carried at the cache rate
through every later turn:

| carried result | Codex | OpenCode | Claude |
|---:|---|---|---|
| 500 tokens | +$0.00027 (+4.3%) | +$0.00022 (+6.6%) | +$0.00034 (+0.7% / +5.0%) |
| **1,500 tokens** | **+$0.00045** | **+$0.00041** | **+$0.00053** |
| 3,000 tokens | +$0.00071 | +$0.00068 | +$0.00082 |

**The `+$0.0005` hypothesis is confirmed, at a carried result of 1,500 to 3,000 tokens.** At the
arm level it is **0.25% to 0.45%** of an arm total, because it fires on two rollouts in 34.

**The solve side, in resolved-rep terms as §0 requires.** The trigger task resolves **3 of 8
sweet reps** across the four runs — Codex 2/2, `screen-v3` 1/2, OpenCode 0/2, Claude 0/2 — and
3 of 8 native. It is an unstable task, and Phase 1 §6.1 established why: the deciding fact is
genuinely absent from the indexed corpus, and every arm guessed a different argument. The guess
separates the outcome cleanly — the run-arms that guessed the argument pytest actually passes
solved **3 of 4**; those that guessed otherwise solved **0 of 4**.

**Upper bound: +5 resolved reps in 8, on 1 task in 18.** That assumes supplying the source makes
the guess determinate, which is an assumption, not a measurement. The lower bound is zero.

**Verdict: KEPT** — a genuine, priced, probabilistic solve lever with a one-to-two-task ceiling on
this corpus and a build cost of weeks. `PHASE-1-RESULTS.md` §6.2's open item is still open: the
pinned image was never pulled, so nobody has confirmed the resolved dependency source is
inspectable offline in the real jail.

### 2.4 The ones that stay dead

C-2 (loses a task on two harnesses — solve veto), C-3 (saves only on rollouts that never solve),
R-1 (`+0.41%` to `+1.82%`, a loss on every harness and both arms) are unchanged. §0's either-axis
bar does not revive a lever that is negative on one axis and zero on the other. Nothing was
re-run.

---

## 3. The stacking ledger and the joint replay

**Never a sum.** All three survivors were replayed on the same turn sequence and priced once:
C-4's injected tokens are carried by the turns C-9 removes, and C-5's inserted round trip is
carried by both.

| harness | recorded delta | C-4 alone | C-9 alone | C-5 alone | **joint** | arm delta after |
|---|---:|---:|---:|---:|---:|---:|
| Codex | −6.46% | −2.69% | 0.00% | +0.33% | **−2.36%** | −8.67% |
| OpenCode | −17.76% | −2.31% | −1.06% | +0.37% | **−3.01%** | −20.24% |
| Claude | +2.38% | −0.88% | −2.71% | +0.26% | **−3.40%** | −1.10% |

On the adopted sidechain-inclusive column, Claude's arm delta moves from **−9.44% to −12.33%**
(sweet `$0.433302 → $0.419440` against native `$0.478448`), because the levers touch the main
transcript only.

**The overlap is essentially zero on this corpus: 0.01 to 0.06 points** between the sum of the
parts and the joint replay. That is a measurement, not a licence — the ban on summing was still
the right rule, and it is what let the overlap be reported as a number instead of assumed.

**Three-column ledger.**

| lever | measured cost effect | measured solve effect | build cost, and what it actually is |
|---|---|---|---|
| **C-4** | −2.69% / −2.31% / −0.88%; Claude's not distinguishable from zero | unmeasured at `$0`; exposure 8–10 rollouts in 34, +2–6% context | **Small.** A serving policy in `ss-read`: expand to the whole file when the requested span already covers ≥40% and the file is ≤400 lines. Two constants, no index change, no ranking signal. Gate it behind a flag for A/B comparability. Days. |
| **C-9** | −2.27% of sweet's Claude spend; ≤0.89% OpenCode; 0% Codex | none claimed | **Weeks.** A structural editing tool with tree-sitter symbol addressing per supported language, an edit-verb set, and the tool-surface plus prompt work to make the agent reach for it instead of a textual anchor. The prize is one harness. |
| **C-5** | +$0.0005 per triggered rollout = +0.25–0.45% of an arm | 1 task in 18; ≤ +5 resolved reps in 8 | **Weeks.** Ecosystem resolvers, bounded storage, provenance and licence tracking, offline acquisition — plus the unverified offline-inspection check. |
| **portfolio** | **−2.36% / −3.01% / −3.40% joint** | unchanged | — |

---

## 4. "The cost frontier on this corpus is closed" — revised

`PHASE-1-RESULTS.md` §13.3 concluded: *"the cost frontier on this corpus is closed, and the
remaining headroom is in solve."* **That sentence was reached under a 5–15% per-lever bar and does
not survive the 1% bar.** The corrected position:

> **At a 1% bar with stacking, the frontier is not closed. It is small.** Two levers that were
> killed for being under a 5% bar are real and hold their sign — C-4 on all three harnesses, C-9
> on one. Replayed jointly they are worth **2.4% to 3.4%**, they overlap by almost nothing, and
> they move the Claude arm delta from **+2.38% to −1.10%** on main-only. What is closed is the
> *large* frontier: no mechanism found in this programme is worth 15% on its own, the portfolio
> of everything that survives is worth about 3%, and the two largest movable quantities found all
> session remain **accounting defects rather than product mechanisms** — the sidechain
> first-record bug at roughly 10 points, and the run-directory tax at 7.4.

The rest of §13.3 stands: carried context is cheap so every reset/evict/compact lever loses;
push-context-early is affordable but has nothing left to push; and the only candidate that would
move solve on all three harnesses is C-6.

---

## 5. C-6 — the round-3 exercise, written and sealed

Executed in the order the handoff fixed, because the order is what makes it evidence.

**1. The narrowed claim was written and frozen** —
[`blinded/round3/NARROWED-CLAIM.md`](../blinded/round3/NARROWED-CLAIM.md). It claims obligation
**shape** (new modules with owning package, export/overload/enumeration/predicate obligations,
correct refusal); it explicitly does **not** claim **mechanism** — which of two admissible fixes a
maintainer picks, the sole reason round 2 scored 4 of 5; and it moves low-confidence nodes into an
advisory tier that scores in neither direction. **It is not a weaker bar:** a new requirement 4
demands **zero high-confidence false positives across the slate**, converting "no high-confidence
node has ever been wrong" from a happy accident into a gate, and a low-confidence node cannot
satisfy any requirement, so hedging everything fails.

**2. It was hashed, and the hash was published before the slate existed:**

```
33c9e3aa3c161c9703322abe712a8586c5c4cfa28bfe86f1013eadb8200377d6  round3/NARROWED-CLAIM.md
```

The claim file also fixes the draw in advance — seed `20260901`, three tasks with a new module and
two without — so the ordering is auditable and not merely asserted.

**3. Only then was the picker run.** The brief is
[`blinded/round3/HANDOFF-BLINDED-ROUND-3.md`](../blinded/round3/HANDOFF-BLINDED-ROUND-3.md),
modelled on round 2's, with `SLATE-PUBLIC.json` and `ISSUES.json` beside it and the labels sealed
to `picker/SEALED-labels-round3.json`. It took three draws to get a slate that is actually clean
— §5.1 and §5.2b say why — and the seed, the split and the bar are the same in all three.

**I did not run the derivation.** This document and everything in `handoffs/improve/` names the
answers. A fresh session derives; this session scores nothing.

### 5.1 The leak sweep found two channels, and neither was small

Recorded in full in [`blinded/round3/LEAK-SWEEP.md`](../blinded/round3/LEAK-SWEEP.md).

**Channel one: tasks another programme had already run.** The picker excluded `rotate20`, round 1
and round 2 — but not the **turnfix cohorts**, and **98 of the 200 development-pool tasks** are
named in that manifest (94 still eligible at that point in the filter), every one of them run as
a turnfix subject, leaving rollouts, trajectories, analysis documents and memory files that can
name what their fix was. The first draw put three of them on the slate.

**Channel two: a task another programme had written up.** After the redraw,
`FORENSICS-heldout200-grok-opencode-2026-07-28.md` was found to discuss a newly drawn task **and
to name the exact new packages its hidden test imports** — which is precisely the obligation this
gate asks the deriver to predict. Not a hint: the answer. The picker now excludes any task named
in any prose `.md`/`.txt` document under the bench (12 development-pool tasks), and any task in a
**repository** such a document or a previous round already exposed (6 more). Bare inventory files
are deliberately not counted as discussion — they list the whole pool and leak nothing.

Both classes were already out of scope: the frozen claim excludes "every task any planning
document discusses". The picker simply did not know which they were.

**Round 2's slate contained two turnfix tasks and one prose-discussed task**, including the one
it failed on. Contamination cannot explain a *failure*, so round 2's FAIL stands; but some of its
passes carry a risk that was not disclosed at the time, and now is.

**Three guards shipped with the fix.** The picker refuses to overwrite a drawn round's slate
without `--force` — it used to overwrite round 2's audit trail in place; it reads every previous
round's public slate so a new round can never re-draw a burned task; and it **fails loudly rather
than drawing a short slate**, so a weaker round can never happen by a `slice()` running out of
candidates.

### 5.2 The frozen pool could not fill the frozen slate, and the pool was widened rather than the bar lowered

After every exclusion the 200-task development pool holds **two** tasks that add a new source
module, against a pre-registered requirement of three. That is a feasibility failure, not a
result — nothing had been derived, so nothing could be tuned to.

**Decision taken by the project owner: source fresh tasks rather than weaken the bar or wait.**
The pool was widened to 268 with untouched reserve tasks — materialised alongside the development
set, never used by anything, and **not** HO2's reserve, which stays untouched for the frozen
held-out set. The seed, the 3 + 2 split, the picker and the five requirements are all unchanged.
`NARROWED-CLAIM.md` is unedited and its hash still matches; the one parameter that could not be
honoured is recorded in
[`blinded/round3/DEVIATION-ADDENDUM.md`](../blinded/round3/DEVIATION-ADDENDUM.md).

### 5.2b A harness defect found while materialising: a base tree that is not the base

One drawn task turned out to have **no obtainable base tree** — its base commit is unreachable on
GitHub by clone or by `git fetch origin <sha>`. That exposed something worse in
`harness/golden-build.mjs`: **it does not check that its `git checkout <base_commit>` succeeded.**
When the commit is unreachable the checkout fails, the script proceeds, and the fresh-init
captures the repository's **default branch** — a post-fix tree, under a directory name claiming
to be the base commit. A blinded gate handed that tree would read the answer out of its own
working directory.

The task is recorded in `picker/UNMATERIALISABLE.json` and excluded. **Every base tree this round
uses was rebuilt with an explicit `git rev-parse HEAD` check against the intended commit before
its history was stripped**, and the two that already existed on the evidence box were
byte-compared against freshly verified clones: one identical, one identical but for a stray bench
bookkeeping file. **The harness defect itself is not fixed** — it is outside this session's scope
— and every golden built before 2026-08-13 should be treated as unverified until checked the same
way.

### 5.2c A constraint on round 4

The augmented pool holds **six** new-module tasks after exclusions and this slate spends three.
A round 4 is possible; a round 5 is not, without a fresh pool. If round 3 does not settle the
claim, the next test is Phase 4's work.

### 5.3 The gap that decides C-6, priced but not run

Every gate so far asks whether the graph can be **derived**. **None asks whether handing an agent
a correct graph changes its patch.** That is the product question, it costs money, and it is the
first paid step this evidence would justify.

**Priced.** 14 of 179 eligible development tasks author a new source module — about **8%
addressable**. A paired design at n = 14 tasks × 2 arms × 2 reps is 56 rollouts; at this run's
observed rate (`$1.41` for 64 rollouts on the Luna backbone) that is **roughly `$1.25` of model
spend**, plus the graphs themselves, which can be derived at `$0` for 14 tasks by hand.

**The dollars are not the problem; the power is.** Fourteen tasks on an 8% subpopulation can only
detect a large conversion. It must be run as a within-task paired design with the effect size
pre-registered, and it must be declared in advance that a null result at n = 14 means "not
detectable here", not "no effect". **Recommendation: run it only if round 3 passes**, and treat it
as a screen, not a measurement.

---

## 6. D-6 — the test verdict is now terminal in the runner

**Fixed, with a regression test.** New module
[`harness/rt-inflight.mjs`](../../harness/rt-inflight.mjs); both generated `run_tests` shims
rewired in `harness/codex-task-runner.mjs`; test `tests/rt-inflight.mjs`, 19 assertions, green.

**The defect.** Codex's shell tool hands a still-running command back to the model as a cell
handle plus whatever stdout has accumulated. Both shims wrote **nothing** until the suite
finished, so a yielded launch came back as `Script running with cell ID N / Wall time 11.0
seconds / Output:` with an **empty** Output — and a rollout read that emptiness as "the tests
completed successfully". Yield-before-completion appears in **14 codex task-arm cells across eight
tasks**.

**Why another prompt sentence was not the fix.** `SS_RT_LONGYIELD` (`540f76c`) already tells the
agent to launch with a 300-second yield, and the FRAME already tells it to wait. It ignored both.
The two changes are mechanical instead:

1. **An immediate banner.** The shim writes, before doing any work, that the suite is running and
   has produced no verdict, and names the line a completed run always ends with
   (`[run_tests verdict] status=`). A yielded cell can no longer be empty, and cannot be read as a
   result. It also makes "did the agent actually receive a verdict" decidable from the transcript.
2. **Attach, do not relaunch.** A `run_tests` call made while an earlier one is still in flight
   attaches to that run and returns **its** verdict instead of starting a second suite. That is the
   handle the harness resolves before another model step: the next call the model makes resolves
   the one it abandoned, at no extra suite cost. The broker publishes the verdict durably, so a
   run whose requester was killed mid-wait is still resolvable.

The test asserts both against the real generated artifacts: stdout is non-empty and verdict-free
while a slow suite runs; a concurrent call attaches and returns the same verdict; the original
call still receives its own; and **exactly one suite runs for two overlapping calls**. Stale
markers are swept by ttl so a later call is a fresh run, never a stale replay.

**Zero head-to-head differential by construction** — one shim serves both arms. It is a validity
fix and must never be booked as a sweet win.

**What is not done:** the mechanism is in the runner, but no row-level column records
*launched* versus *verdict delivered*. That telemetry would turn "the agent claimed success
without a verdict" into a countable row field rather than a transcript search. It is a small
follow-up and it is not built.

---

## 7. Phase 2, priced — and why Phase 3 stays NO-GO

**Recommendation, as a recommendation and not an action.**

1. **Build C-4. It is the only lever whose build cost is small relative to its measured effect.**
   One serving policy, two constants, no index or ranking change, sign confirmed on all three
   harnesses. Ship it behind a flag so the A/B stays comparable, and pair it with the first paid
   run that can measure whether the injected context costs a solve.
2. **Do not build C-9 yet.** 2.27% on one harness for a new structural editing tool is a poor
   ratio, and Codex's zero says the failure class it addresses is harness-specific rather than
   product-wide. Revisit if a future run shows the same tax on more than one harness.
3. **Do not build C-5 as a bench lever.** It is weeks of resolver, storage, provenance and licence
   work for a one-to-two-task ceiling. It remains a product-capability bet, and the cheapest next
   step on it is the open verification: pull the pinned image and confirm the resolved source is
   inspectable offline.
4. **C-6: run round 3 at `$0` in a fresh session.** If it passes, run the derivation-to-patch
   conversion screen at roughly `$1.25`, with its power limitation declared. If it fails, say the
   capability does not survive.
5. **Land the D-6 row telemetry** with the next harness change.

**Phase 3 stays NO-GO, and §0's new bar does not touch it.** The publication bar is cost at least
15% below native **and** strictly more solves on every harness.

- **Solve is tied 9 of 16** and nothing in this document moves it. C-4 does not raise solve; C-9
  claims none; C-5's ceiling is one task, probabilistic, and unproven; C-6's derivation-to-solve
  conversion has never been measured.
- **The 15% portfolio bar is not met either.** The joint replay is worth 2.4% to 3.4%.
- §0 changed what we keep. It did not change what may be published, and §4.3 and §12 of the plan
  still require both axes for the claim.

**Phase 4 — a fresh, stratified task set — is where Slate A ends.** It is the same work as the new
held-out plan, and §5.2 gives it a second reason to exist: the development pool has three
new-module tasks left and all three are spent on round 3. It is named here and not started.

**Slate B is the next session's scope.** Noted only: four of its eight W0 gates already have
answers under Slate A names (P1↔C-5, P3↔C-7, P5↔C-6, P7↔C-8), so that session should not re-run
them.

---

## 8. What was not done, and where a number is softer than it looks

- **The round-3 derivation was not run.** This session is contaminated by construction.
- **C-4's solve effect was not measured** and cannot be at `$0`. Only its exposure is bounded.
- **C-9's OpenCode figure is a generous upper bound.** All four OpenCode edit failures were
  counted addressable, because that harness's patch payload does not carry the quoted text in a
  form the symbol classifier can read. The number is ≤0.89% of the arm either way.
- **The joint replay uses the three matched `sb-*` runs, one per harness.** `screen-v3` is the
  Claude headline run and was used for the cost-definition work; the two Claude runs are not
  pooled anywhere in §3.
- **The `pages` tax was not re-derived to a point value.** Phase 1's census script is not in
  `phase1-scripts/`, so it was re-derived independently and produced a bracket that contains the
  published figure. The published figure stays; the bracket is disclosed.
- **C-5's solve upside is an assumption, not a measurement.** It assumes the dependency source
  makes the guess determinate. The evidence for that is 8 rollouts and a clean separation, which
  is suggestive and nothing more.
- **`PHASE-1-RESULTS.md` §5's dollar figures are superseded** by §2.2 here. That document was not
  edited — it is the audit trail — and this is the correction pointing at it.
- **D-6's row-level telemetry is not built** (§6).
- **`golden-build.mjs`'s unchecked `git checkout` is not fixed** (§5.2b). Only the five trees this
  round uses were verified. Every other golden built before 2026-08-13 is unverified.
- **The round-3 pool is not the pool the frozen claim names** (§5.2). Bar, seed and split are
  unchanged; the deviation and its reasoning are in `DEVIATION-ADDENDUM.md`.
- **Slate B was not started.**

---

## 9. The evidence doctrine, applied (2026-08-14)

**Executes** [`HANDOFF-EVIDENCE-DOCTRINE.md`](./HANDOFF-EVIDENCE-DOCTRINE.md). **Spend: `$0`.**
Its §9 drop-in text is folded into `HANDOFF-SLATE-A-CLOSE.md` §0.1. Neither UBER plan was touched.

Scripts, all read-only over the evidence box, all reusing `phase1-scripts/`:
`d1-census-and-control-set.mjs`, `d2-c4-census.mjs`, `d3-c4-proximal-tokens.mjs`,
`d4-c9-postfix-residual.mjs`, `d5-c9-stale-address-split.mjs`, `d6-whitespace-lever-price.mjs`.

### 9.0 What applying it changed

**One verdict died, one premise was wrong, and one open item closed.**

| | before the doctrine | after |
|---|---|---|
| **C-4** | KEPT at −2.69 / −2.31 / −0.88% | **KEPT and SHIPPED — §9.12.** Two parser defects corrected (chained `&&` reads dropped; single-line reads read as start-to-EOF), then replayed on all three harnesses at 100.0% baseline reproduction: **−1.60 / −2.08 / −4.72%**, mean −2.80%, at the shipped default. |
| **C-9** | KEPT, 2.27% on Claude, build cost **weeks** | **DEAD.** Its 2.27% pooled a pre-C-1 run with a post-C-1 run. On the only post-fix run the whole prize is **0.64% of one arm, four events**. C-1 already took the class — see §9.4 Q4. |
| **C-5** | KEPT, first conversion arrow an assumption | **Arrow measured.** The contract *is* in the pinned dependency source, offline. Still UNDECIDABLE on outcome, and the corpus cost is now a number: **51×**. |

**A correction this section made to itself, recorded because the error is instructive.** Its first
draft claimed a cheap "whitespace-tolerant matcher" worth 1.34% and captured 74% of C-9's prize.
**That was wrong.** The population it priced was mostly C-1's own bug on a pre-fix run — a fix
already shipped in `116ca2b`. Pooling runs across a shipped fix is the error, and the doctrine's
census would have caught it if the census had been keyed on *build date* as well as on frequency.
**Add that to the protocol: a census must state which build each run used.**

**Two things the doctrine itself got wrong, both found by following it.**

1. **Its stated trap runs backwards.** §10 warns that counting fetched lines will *overstate*
   C-4. Measured, the naive count **understates by about 83×** — it reports 0.05% where the true
   effect is 4.32%. The doctrine's *instruction* (use cumulative billed tokens) is right and is
   now better justified: the naive metric would have produced a **false negative**, killing a real
   lever, not a false positive.
2. **Its C-5 step 1 is stale.** §10 says the `ss-trace` cross-file item is "still unaccounted for
   from the fix session". [`FIX-REPORT.md`](./FIX-REPORT.md) §4 closed it as **REFUTED** on
   2026-08-13, having pulled all 21 `ss-trace` invocations. There was nothing to reproduce.

### 9.1 The `$0` pre-flight census (doctrine §2)

**The "204 rollouts" is exact:** the three matched `sb-*` runs are 68 each — 17 tasks × 2 arms ×
2 reps. `screen-v3` adds 64 (16 tasks), for 268 in total.

| lever | mechanism | fires | tier | what that permits |
|---|---|---:|---|---|
| **C-4** | a file already read is read again | 38 codex / 52 opencode / 48 claude | **20–50 each** | deterministic replay; **not** a cost A/B |
| **C-9** | an edit is rejected on its textual anchor | 27 sweet anchor failures, 25 of them nameable by a symbol (both Claude runs); **0 codex** | **20–50** | replay + pricing; not an A/B |
| **whitespace matcher** | a rejected anchor that IS in the file modulo whitespace | 19 of those 27 sweet | **20–50** | replay + pricing |
| **C-5** | the task turns on a declared dependency's source | **1 task in 18** | **under 10** | **UNDECIDABLE by any affordable run** — §9.5 |

The doctrine cites 94 collapsible C-4 events; this census counts 138. The definitions differ —
138 is every repeat read, 94 is the subset a given policy would collapse. **Both land in the same
tier, and the tier is the decision.** A pooled figure is not a tier; each harness is tiered alone.

### 9.2 The fixed control set (doctrine §5)

Scored from `rows.json` `resolved`, never `report.json`.

**Five tasks resolve 2 of 2 reps in *both* arms on *all three* harnesses:**

```
epiforecasts__scoringutils-229   oceanparcels__parcels-617   ontodev__robot-710
redboltz__mqtt_cpp-466           statamic__cms-9029
```

That is the strongest available form of the control — a regression on one cannot be blamed on
arm-specific instability. Breaking one is a kill.

| run | sweet resolved reps | native resolved reps | sweet 2/2 | sweet 1/2 |
|---|---:|---:|---:|---:|
| codex | 19 / 34 | 18 / 34 | 9 | 1 |
| opencode | 17 / 34 | 17 / 34 | 8 | 1 |
| claude | 14 / 34 | 15 / 34 | 5 | 4 |
| screen-v3 | 15 / 32 | 16 / 32 | 6 | 3 |

**The blind spot, sized.** The doctrine accepts that a lever rescuing an *unstable* task is
invisible to a non-inferiority check. That tail is **1 task on codex, 1 on opencode, 4 on claude,
3 on screen-v3**. On Claude it is nearly as large as the control set itself, so a Claude-only
solve lever is close to unmeasurable by this scheme. Say so rather than let the control set imply
coverage it does not have.

### 9.3 C-4 — whole-file on first touch

```
LEVER:            C-4 whole-file on first touch, span-gated
MECHANISM:        a file read once is read again; serving it whole the first time removes the
                  later round trip, at the price of carrying the unread remainder.
CENSUS:           38 codex / 52 opencode / 48 claude repeat reads  ->  tier 20-50 per harness
PROXIMAL METRIC:  cumulative billed INPUT TOKENS over the replayed turn sequence
DIRECTION:        must go down
EXPECTED EFFECT:  low single-digit percent; the sign must hold on all three harnesses
KILL LINE:        the sign inverts on any harness at the chosen shape
CONVERSION:       426,702 billed input tokens x $0.000017 per 1k = $0.007279 = -2.69% (codex)
CONTROL SET:      5 tasks; cost -1.39%, no control rollout made worse
STATUS:           RETROSPECTIVE -- the runs predate this doctrine. The metric follows from the
                  mechanism, not from the result, but it was not registered before the run.
```

**The replay is deterministic and reproduces the recorded number exactly: −2.69% on codex.**

| | tokens | note |
|---|---:|---|
| baseline billed input | 9,879,501 | 34 sweet rollouts |
| replayed billed input | 9,452,799 | span-gate: expand when the span already covers ≥40% of a ≤400-line file |
| **delta** | **−426,702 (−4.32%)** | → **−2.69%** in dollars; input is partly cached, so dollars move less than tokens |

**The trap, quantified — and it points the other way.**

| accounting | net saving | as % of billed input |
|---|---:|---:|
| **naive** — removed read-results counted once, minus the injection counted once | 5,134 tokens | 0.05% |
| **true** — cumulative billed input over the replayed sequence | **426,702 tokens** | **4.32%** |

The naive number is **1/83rd** of the truth. The reason is that the dominant term is not the one
the doctrine anticipated: removing a read does not merely delete its result once, it stops that
result — and the turn that carried it — from being **re-sent on every later turn**. That
compounding swamps the injection carry the doctrine warned about. **A team judging C-4 on fetched
lines would have killed it as 0.05% and been wrong.**

**Exposure and risk.** The policy fires on 18 of 34 codex rollouts, actually collapses a read on
8, and changes cost on 13. **Five rollouts get worse** — worst is `dart-lang__http-1114` r0 at
+$0.000501 — because they take the injection and never re-read. Control set: −2.70% billed,
−1.39% cost, nothing regressed.

**Solve remains unmeasured and unmeasurable at `$0`**, because the replay changes what the agent
saw and the counterfactual trajectory does not exist. Unchanged from §2.1.

**Verdict: KEPT, unchanged.**

### 9.4 C-9 — and the cheaper lever hiding inside it

```
LEVER:            C-9 index-addressed structural editing
MECHANISM:        an edit is rejected because its textual anchor did not match; naming a symbol
                  instead removes the class of failure.
CENSUS:           27 sweet anchor failures across both post-fix claude runs -> tier 20-50
PROXIMAL METRIC:  count of failed edit attempts on POST-C-1 runs, split by cause
DIRECTION:        must go down
EXPECTED EFFECT:  the doctrine predicted "near zero, because C-1 ate it"
KILL LINE:        the residual is near zero, or is dominated by causes symbol addressing cannot name
CONVERSION:       25 events x marginal cost of the issuing request = $0.013766 = 1.81% of sweet's
                  Claude spend across both runs
CONTROL SET:      5 failures touch statamic__cms-9029; 3 of 5 are PHANTOM, which no addressing fixes
STATUS:           RETROSPECTIVE, as C-4.
```

#### Q1 — is the C-1 anchor-corruption class gone? **Yes, cleanly.**

**82 failed edits across both post-fix Claude runs. Zero carry a line-number gutter.** Four gutter
shapes were tested, not only `ss-read`'s own: `N<TAB>`, `N|`, padded `N␣␣`, and `N:`. C-1's
`0 of 184` holds on independent data.

#### Q2 — but the residual did **not** shrink, and the doctrine expected it to

| cause | count | can symbol addressing name it? |
|---|---:|---|
| stale-address (anchor not found) | 41 | yes |
| wrong-path | 17 | no |
| no-op edit | 14 | no |
| malformed call | 9 | no |
| sub-symbol ambiguity | 1 | yes |

Sweet-arm anchor failures are **21** on `sb-claudecode` and **6** on `screen-v3`, against the
**20** in C-9's original pre-C-1 evidence base. **C-1 changed the composition of the failure
population, not its volume.** So the doctrine's proposed clean close — "C-9 is closed because C-1
ate it" — does not happen.

Its warning about the reverse error stands and is worth restating precisely: those 20 and these 21
are *different failures*, and treating them as the same population would be wrong in either
direction.

#### Q3 — splitting `stale-address` is what changes the decision

"String to replace not found" is three failures wearing one message. Each failed anchor was tested
against the base tree:

| verdict | native | sweet | total | what fixes it |
|---|---:|---:|---:|---|
| **WHITESPACE-MISMATCH** — the text *is* in the file once whitespace is normalised | 4 | **19** | 23 | **mostly C-1, already shipped** — see Q4 before reading this row as a lever |
| **SELF-INVALIDATED** — the rollout's own earlier edit moved it | 8 | 6 | 14 | symbol addressing (a symbol re-resolves) |
| **PHANTOM** — absent from the file, no prior edit; the agent quoted text that never existed | 2 | 2 | 4 | **neither.** A phantom symbol name fails identically. |

**Sweet arm: 25 of 27 addressable (93%), 2 phantom (7%).**

#### Q4 — the correction that voids the answer above: **one of the two runs is pre-C-1**

**`sb-claudecode-20260811` was run on 2026-08-11. C-1 shipped on 2026-08-13 in `116ca2b`.** The
run is *pre*-fix, and `gate5-c9-edit-census.mjs`'s premise that both runs are post-fix is wrong.
The gutter renderer proves it directly, counted off the recorded `ss-read` outputs:

| run | `N│ ` gutter lines | `N⇥` gutter lines | verdict |
|---|---:|---:|---|
| `sb-claudecode-20260811` | **15,205** | 0 | **PRE-C-1** |
| `screen-v3-20260812` | 0 | **12,518** | **POST-C-1** |

15,205 is the exact figure C-1's own census recorded for the 2026-08-11 rollouts, so the two agree.

**Why the gutter detector in Q1 missed this, and why Q1 is still right.** The detector looks for
gutter *text* in the failed anchor. The agent strips the gutter, so the text never survives — only
its **damage** does. `ss-read` rendered `59│` plus **one padding space** plus the file's own six
spaces; the agent drops `59│` and keeps **seven**. Native `Read` renders `105⇥` and strips clean.
Every sweet mismatch on the pre-fix run is that off-by-one:

```
ss-read (pre-C-1)   "59|       this.request,"      -> agent quotes 7 spaces
on disk                   "      this.request,"      <- file has 6
native Read         "105\t      {this.contentLength," -> agent quotes 6. correct.
```

So Q1's finding stands exactly as stated — no failed anchor carries gutter *text* — and it was
never the right test for whether C-1's damage was gone.

**Split by run, the whitespace class is C-1's win, already banked:**

| sweet arm | whitespace-mismatch events | dollars | share of that arm | `+1 space` signature |
|---|---:|---:|---:|---:|
| pre-C-1 (`sb-claudecode`) | **16** | `$0.008593` | **2.11%** | 13 of 13 located |
| post-C-1 (`screen-v3`) | **3** | `$0.001638` | **0.46%** | **0 of 3** |

**The off-by-one signature is gone entirely on the post-fix run.** The three that remain have a
different, uncharacterised shape — my locator could not pin them to a base region at all.

#### The conversion, corrected

Priced on the settled rule — charge the request that issued the rejected call at its **marginal**
contribution — and scored **only on the post-fix run**, because the pre-fix run measures a bug
that has already been fixed:

| post-C-1, sweet arm (`screen-v3`) | events | dollars | share of the arm |
|---|---:|---:|---:|
| whitespace-mismatch, uncharacterised | 3 | `$0.001638` | 0.46% |
| self-invalidated | 1 | `$0.000622` | 0.18% |
| **= everything symbol addressing could recover** | **4** | **`$0.002260`** | **0.64%** |
| phantom — unrecoverable at any coverage | 2 | `$0.001150` | 0.32% |

**Verdict: C-9 is DEAD, and for a better reason than the one Phase 1 gave.** On the only post-fix
run in the corpus its entire prize is **0.64% of one arm on one harness, from four events**, against
a build cost of weeks. Census tier: **under 10 → undecidable even if someone wanted to chase it.**

**What was superseded, and by what.** §2.2's 2.27% and this section's first draft both pooled the
pre-fix and post-fix runs, which double-counts a fix that already shipped. There is no
whitespace-matcher lever to build: **C-1 is that lever, and it is in `main`.**

**The strongest thing here is not a lever, it is a confirmation.** C-1 was validated on a paid A/B
of 52 trials and a 184-trial screen. This is a third, independent check on different data, arriving
by a different route — an off-by-one indent signature that appears in 13 of 13 located pre-fix
cases and **0 of 3** post-fix. The class it removed was worth **2.11% of the sweet Claude arm**.

**Two limits that still apply to the 0.64%.**

- **Claude only.** Codex records zero failed edits (119 `apply_patch` calls, 119 matched outputs);
  OpenCode's payload does not carry quoted text in a classifiable form.
- **Four events.** At that count nothing here is a rate, and no affordable run makes it one.

### 9.5 C-5 — undecidable on outcome, but its first arrow is now measured

```
LEVER:            C-5 dependency-source index tier
MECHANISM:        the deciding fact lives in a declared dependency's source, not the repository,
                  so no amount of repository retrieval can surface it.
CENSUS:           1 declared-dependency case in 18 tasks  ->  tier UNDER 10
PROXIMAL METRIC:  is the contract present and inspectable in the pinned dependency source, offline?
DIRECTION:        yes / no -- a precondition, not a rate
EXPECTED EFFECT:  binary
KILL LINE:        the contract is absent from the pinned dependency source, or unreachable offline
CONVERSION:       corpus contains contract -> model uses it -> patch passes exc_info -> resolves.
                  Arrow 1 is now MEASURED. Arrow 2 is unmeasured. Arrow 3 is 4/4 vs 0/8 on record.
CONTROL SET:      not applicable -- the lever adds a corpus, it does not change edit behaviour
STATUS:           PRE-REGISTERED. The doctrine specified this test before it was run.
```

**Step 1 was already closed.** `FIX-REPORT.md` §4 refuted the `ss-trace` cross-file premise on
2026-08-13 across all 21 invocations, and §4.1 closed the goal too: `__tracebackhide__` appears in
the pytask repository **only** as a boolean, so the callable convention is not in the indexed
corpus at all. The doctrine's "still unaccounted for" is stale.

**Step 2 is done, and it is a YES.** The pinned image was pulled and run with `--network none`,
which is the whole point — this is the offline jail, not a networked convenience.

| check | result |
|---|---|
| pytest present offline | **yes** — 9.0.2 at `/usr/local/lib/python3.10/site-packages` |
| the contract present | **yes** — `_pytest/_code/code.py:311–334` |
| the specification present | **yes** — in the docstring, in words |

```python
def ishidden(self, excinfo: ExceptionInfo[BaseException] | None) -> bool:
    """...
    If __tracebackhide__ is a callable, it gets called with the
    ExceptionInfo instance and can decide whether to hide the traceback.
    """
    ...
    if tbh and callable(tbh):
        return tbh(excinfo)
    return tbh
```

**A correction to the doctrine's own test.** It asks for the literal line
`tbh(None if self._excinfo is None else self._excinfo)`. **That line is not in this version** —
it is a different pytest release's phrasing. The *contract* is present, as `tbh(excinfo)`. Testing
for the literal string would have returned a false NO.

**Retrieval, as a necessary condition.** The query the sweet arm actually issued —
`ss-search "callable __tracebackhide__ predicate frame"` — matches **7 of 2,144** dependency files
at 3 or more of its 4 terms, and `_pytest/_code/code.py` ranks **second**, with its densest
25-line window at line 291, bracketing the contract at 311–334. This is a lexical necessary
condition, **not** a run of the production ranker; it shows the corpus is not the obstacle.

**The build cost, now a measurement rather than an adjective:**

| | files | bytes |
|---|---:|---:|
| repository under test | 79 | 467,175 |
| its installed dependency source | 2,144 | 23,846,361 |
| **ratio** | **27×** | **51×** |

**A dependency tier means indexing 51× more source per task environment, to reach 1 task in 18.**
That ratio is the decision, and it is now numeric.

**This qualifies `FIX-REPORT.md` §4.1, which should be read with it.** That section concluded the
`exc_info` split is "a model-knowledge split, not a tool split", and on the corpus as indexed it is
right — the convention is genuinely absent from the pytask repository. But it is **present, in
words, in the dependency the repository pins**, on the same disk, inside the same jail. So the
split is a *corpus-scope* decision rather than a fact about what retrieval can reach. That is
precisely what C-5 proposes to change, and it is why C-5 survives §4.1's refutation of item 4.

**Verdict: KEPT and UNDECIDABLE** — see §9.6. What changed is that its first conversion arrow is
no longer an assumption, and §2.3's standing open item is closed.

**The box was left as found.** The image was removed after inspection; free space returned to 55G.

### 9.6 The UNDECIDABLE tier (doctrine §6)

Sound mechanisms that no affordable run on this corpus can resolve. **They are not dead.** They
are the user's call on principle, and each is priced.

| item | why undecidable | build cost | what would decide it |
|---|---|---|---|
| **C-5 dependency-source tier** | census 1 task in 18; tier under 10. No rep count fixes a population of one. | **Weeks** — ecosystem resolvers, bounded storage, provenance, licence tracking, offline acquisition. Corpus grows 51× per environment. | A task set stratified *on* external-dependency contracts, sampled to 20+ such tasks. That is Phase 4's work. |
| **C-4's solve effect** | the replay changes what the agent saw; the counterfactual trajectory does not exist | already counted in C-4 | one paid A/B with the flag on, judged on the control set |
| **the post-C-1 edit residual** | 4 events on one harness; tier under 10 | n/a — nothing identified to build | a run with enough edit volume to characterise 3 uncharacterised anchors |

**The honest framing:** every solve question in Slate A is undecidable at `$0`. The doctrine buys
cost decisions cheaply and buys **no** solve decisions at all. That is a real limit, not a
formality — §9.2 shows the unstable tail on Claude is larger than the control set.

### 9.7 The stacking ledger, restated (doctrine §7)

**Still never a sum — and the portfolio just got smaller.** §3's joint replay was
**−2.36% / −3.01% / −3.40%** with C-9 included. C-9 is now dead, and C-5 is out of scope under the
no-new-tools rule (§9.9), so **the portfolio is C-4 alone: −2.69% / −2.31% / −0.88%.**

Removing C-9 from the joint figure is *not* a subtraction — §3 measured the overlap between the
three levers at 0.01 to 0.06 points, which is small enough that C-4 alone is very close to the
joint number minus C-9's contribution, but **the shipped figure must come from a joint replay of
what is actually built.** With one survivor, C-4's own replay *is* that figure.

### 9.8 Total spend, and what was not done

**Spend: `$0`.** No model was invoked. Every number is a replay, a census, a classification, or a
container inspection over artifacts that already existed. C-4 and C-9 were `$0` as the doctrine
predicted. The one resource used was ~3GB of transient disk for the pinned image, returned.

**Not done, and each one matters:**

- **C-4's and C-9's protocol blocks are retrospective.** Their metrics follow from the mechanism
  rather than from the result, which is the substance of §3.1 — but they were not written down
  before the runs, and only C-5's step 2 was genuinely pre-registered. Later levers get the real
  thing; these two do not, and no amount of care afterwards converts one into the other.
- **This section published a wrong number before catching it.** The 1.34% whitespace-matcher lever
  did not survive checking which build each run used. It is corrected in §9.4 Q4 and the reasoning
  is left visible in §9.0 rather than deleted, because the failure mode — pooling runs across a
  shipped fix — is one this benchmark can repeat.
- **The 3 post-fix whitespace anchors are uncharacterised.** They normalise-match the base file but
  my locator could not pin them to a region, so their cause is unknown. 3 events is too few to
  chase.
- **No solve effect was measured for any lever.** §9.6.
- **The three-harness C-4 replay was not re-run.** §2.1's sign table stands; only the codex leg was
  independently reproduced here, and it matched to the digit.
- **The production ranker was not run against the dependency corpus.** §9.5's retrieval result is a
  lexical necessary condition only.
- **C-9's Claude-only scope is a data limit, not a finding.** Codex genuinely has zero; OpenCode is
  unclassifiable from what was retained.
- **Round 3 of C-6 is still unrun** and still needs a fresh session (§5).

### 9.9 Scope ruling: no new tools — only improvements to the ones that exist

**Set by the project owner, 2026-08-14.** It is a hard filter, applied here to everything Slate A
still had open. It removes more than it looks like it will, and it agrees with the evidence.

| candidate | what it would require | in scope? |
|---|---|---|
| **C-4** span-gated whole-file serving | a serving policy and two constants **inside `ss-read`** | **YES — the only survivor** |
| **C-9** structural editing | a new editing tool, per-language symbol addressing, an edit-verb set, prompt work | **No — and independently DEAD at 0.64%** |
| **C-5** dependency-source tier | a new corpus tier, ecosystem resolvers, storage, provenance, licence tracking | **No — a new capability, not an improvement** |
| **C-6** obligation compiler | a new derivation stage feeding the agent | **No** for the product; round 3 remains a `$0` measurement question |
| **D-6** terminal test verdict | already landed in the existing runner | **Yes, done** (§6) |

**Slate A therefore closes with exactly one buildable item, and it is a change to `ss-read`:**
expand a read to the whole file when the requested span already covers ≥40% of a file of ≤400
lines. Measured **−2.69% / −2.31% / −0.88%** on Codex / OpenCode / Claude, sign holding on all
three, no control-set regression, and the solve risk bounded but unmeasured.

**The two most valuable things found in this whole programme were also not new tools.** They were
an accounting repair worth about 10 points and a rendering fix in `ss-read` worth 2.11% of the
sweet Claude arm. Under this ruling that is the pattern to keep following: **the existing tools'
output fidelity and the harness's accounting have paid better than any proposed new capability.**

**Where to look next, under this rule.** C-1 was found by asking whether `ss-read`'s *rendering*
round-trips. That question generalises and has not been asked of the other existing tools —
`ss-search`, `ss-grep`, `ss-find`, `ss-trace`, `ss-semantic` — whose output the agent also copies
from. `FIX-REPORT.md` §4 already records one such lead not followed: those tools "also discard"
something the report calls an adjacent gap. That is a `$0` census, on the same corpus, and it is
the natural successor to this document.

### 9.10 Where C-4's constants came from — and why they should not be shipped as written

**Asked by the project owner, 2026-08-14: where do `≥40%` and `≤400 lines` come from?**
**Answer: a 3 × 3 grid, and 400 was the smallest cap in it.** The original sweep searched
`minFrac ∈ {0.20, 0.40, 0.60} × maxLines ∈ {400, 600, 1500}` — nine points. The reported optimum
sat **on the boundary of the searched region**, which is the standard sign that a search stopped
too early rather than found a minimum. Script: `d9-c4-surface.mjs`.

**A finer sweep — 12 fractions × 13 caps, 156 points — vindicates the mechanism and demotes the
constants.** Codex sweet arm, same replay:

| finding | number |
|---|---|
| configurations that **save** money | **140 of 156** |
| configurations that lose money | 16 — all of them a loose span gate with a huge cap |
| configurations within 0.25pp of the best | **20 → a plateau, not a spike** |
| the plateau's span-gate range | **0.15 – 0.70** |
| the plateau's line-cap range | **400 – 3000** |
| best point | `(0.35, 400)` at **−2.78%** |
| the shipped point | `(0.40, 400)` at **−2.69%** — 0.09pp worse, which is nothing |

**Two properties of `400` are artifacts of this corpus, not principles.**

1. **There is a cliff between cap 300 and cap 350.** At cap ≤ 300 the policy is worth −0.2% to
   −0.85%; at 350 it jumps to −2.2%. **At cap 100 it is exactly `+0.00%` — it never fires at all.**
   So the cap is not a tuning dial, it is a **floor**: below roughly 350 the files that actually
   get re-read are excluded and the lever does nothing.
2. **Cap 400 and cap 500 produce identical numbers, to the digit.** No file read in these 34
   rollouts is between 401 and 500 lines. `400` is interpolating between observed file sizes.
   **Any value from ~350 to ~500 is the same policy on this evidence, and the corpus cannot tell
   them apart.**

**Leave-one-task-out: the argmax is unstable, but the choice is cheap.** Dropping each of the 17
tasks in turn and re-optimising moves the best configuration across **six distinct settings**
(`0.35|400`, `0.30|400`, `0.40|3000`, `0.30|3000`, `0.70|3000`, `0.80|3000`). So the exact argmax
is noise. **But the shipped `(0.40, 400)` is within 0.09pp of fold-optimal in the median fold and
0.70pp at worst** — the plateau is flat enough that picking wrong inside it costs almost nothing.

**The real fragility is concentration, not the constants.** At the shipped setting, eight rollouts
save and five lose, and **`rstudio-education__gradethis-161` alone — its two reps — is 63% of the
net saving.** The whole −2.69% rests on **8 collapsed reads**.

**The mechanistic reading, which is what should set the constants.**

- **The span gate is the safety device.** It only expands when the agent is *already* paying for
  most of the file, so the marginal injection is small. Remove it and the lever inverts: at
  `frac ≥ 0.10, cap ≤ 3000` the policy **loses 0.63%**, because carrying cost dominates.
- **The line cap is a backstop, not a dial.** Above ~350 lines it barely binds — across the whole
  `frac = 0.40` column, caps from 400 to 3000 all land between −2.19% and −2.71%.

**Recommendation if this ships: pick from the plateau's interior for mechanistic reasons, not the
fitted argmax.** A span gate around **0.30–0.35** with a cap of **400–600** sits inside the
plateau on every leave-one-out fold, is not on any grid edge, and is not the point that happened
to win on 34 rollouts. **Ship it behind a flag, and state in the changelog that the magnitude rests
on 8 events and one dominant task** — the sign is confirmed on three harnesses, the size is not.

### 9.10b The live microsmoke — treatment confirmed on one harness, two cells lost

**Ran 2026-08-14. Spend `$0.9232`.** Six cells: codex / opencode / claude-code × span-expand
on / off. 5 tasks, 2 reps, sweet arm only, `MAX_TOOL_CALLS=60`, `CONCURRENCY=3`. Fresh environment
ledger swept first — **5/5 gold-valid** — and preflight green on all three harnesses.

| harness | rollouts | exposure (whole-file reads, on vs off) | controls broken |
|---|---|---|---|
| **opencode** | 7 / 8 | **21 of 24 = 88% vs 9 of 39 = 23%** — fired | **none** |
| **claude-code** | 10 / 10 | **unverifiable** — see below | **none**, 3/3 controls 2/2 in both |
| codex | 0 / 0 | **VOID** | n/a |

**codex is void for an environmental reason, not the lever.** All 10 rollouts returned
`exit=codex_error` with `calls=0` and `$0`: the Responses API rejected the reasoning value
(`invalid_value`, wants `max|xhigh|high|medium|low`), and codex's MCP endpoint at
`chatgpt.com/backend-api/ps/mcp` is blocked by the jail's egress allowlist, which permits
`openrouter.ai` only. Its two `resolved=true` rows are empty-patch passes, not solves.

**claude-code's exposure cannot be checked after the fact, and that is a harness gap worth
fixing.** `teardownRunner` deletes the runner state directory, and unlike opencode — which copies
what it needs into `opencode-retained/` first — claude-code retains nothing. Its trajectories carry
no tool output either. So its cells ran honestly but are **unverified**, which under the
`/microsmoke` skill's own rule is exactly the accidental-A/A shape and may not be read as a null.

**Cost, reported and not trusted, exactly as pre-registered:** opencode `−7.84%` (7 paired
rollouts), claude-code `+0.25%` (10 paired). Predicted `−2.08%` and `−4.72%`. At this n the
instrument cannot resolve either, and the doctrine's whole point is that the proximal metric —
exposure — is what the smoke buys.

**Solve, in resolved-rep terms.** opencode 6/7 on against 7/8 off; claude-code 6/10 against 7/10.
No control task that solved 2/2 with the gate off dropped with it on, on either harness. The one
movement is `rstudio-education__gradethis-161` on claude-code, 1/2 → 0/2 — a **diagnostic** task,
not a control, unstable by record, and 2/2 in both opencode cells. Reported because it is the only
adverse movement, not because n=2 supports a conclusion.

**Verdict: the treatment fires and breaks nothing where both could be measured.** That is a pass on
the doctrine's terms — proximal metric moved, control set intact — on one harness of three. It is
not a cost result and was never going to be.

**What it would take to close the other two, both cheap:** set a valid `REASONING` value and add
`chatgpt.com` to the egress allowlist for codex; add a `claude-retained/` copy-out before
`teardownRunner`, mirroring opencode. Neither is a change to the lever.

### 9.11 "Why not just ship the optimal version?" — the argmax is not identified

**Asked by the project owner, 2026-08-14.** Answered by bootstrapping the surface rather than by
appeal to a rule. Script: `d10-c4-argmax-se.mjs`. Paired bootstrap over **tasks** — the unit
heterogeneity lives on — 5,000 resamples, fixed seed, 63 configurations.

**You can ship it. It costs about 0.08 percentage points either way. The reason not to is that its
reported value is biased, not that it performs worse.**

| question | answer |
|---|---|
| best configuration | `span ≥ 0.35, cap ≤ 400` at **−2.78%** |
| its bootstrap standard error | **1.51 percentage points** — 54% of the effect it is measuring |
| configurations inside the one-standard-error band | **59 of 63** |
| distinct configurations that win at least one resample | **21 of 63** |
| how often the "optimum" is actually the winner | **11.4%** |
| the most frequent winner | a *different* configuration, `span ≥ 0.15, cap ≤ 400`, at 17.6% |

**The argmax wins about one resample in nine.** Selecting it and then reporting its value uses the
same 34 rollouts for both, which is the textbook setup for **selection-based overfitting**, also
called the winner's curse: the maximum over many configurations is an optimistically biased
estimate of what that configuration will do on new data. The bias grows with the number of
configurations searched, and this search had 63.

**The paired comparison is more favourable, and it is the fair counter-argument.** Pairing removes
most of the between-task variance:

| configuration | point | mean gap to argmax | SE of that gap | P(worse than argmax) |
|---|---:|---:|---:|---:|
| `0.35 / 400` — argmax | −2.78% | — | — | — |
| `0.40 / 400` — shipped | −2.69% | 0.077pp | 0.151pp | 60.7% |
| `0.30 / 600` — interior | −2.60% | 0.182pp | 0.123pp | 88.4% |

So the argmax **is** slightly better than its neighbours more often than not. The gap is **3% to
7% of the effect size**, and for the shipped point the gap's own uncertainty is twice the gap. This
is not a difference worth defending in either direction.

**The decisive argument is the cliff, not the statistics.** `cap = 400` sits **50 lines above a
two-thirds collapse**:

| cap | 300 | 350 | **400** | 500 | 600 | 800 | 1000 | 1500 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| delta at span ≥ 0.35 | −0.85% | −2.32% | **−2.78%** | −2.78% | −2.57% | −2.57% | −2.61% | −1.52% |

The flat region runs from 400 to 1000. **The argmax sits on its lower boundary.** A corpus whose
files are slightly larger — a different language, a different repository mix — moves the cliff, and
the boundary is exactly where a small shift costs the most. A cap of **600** is in the middle of
the flat region on this data and costs **0.18pp** to get there.

**The one-standard-error rule does not decide this, and should not be cited as if it does.** With
59 of 63 configurations inside the band, the rule permits nearly any choice. Its standing in the
literature is also mixed: it reliably improves sparse *variable selection* but
[often performs worse for prediction](https://experts.illinois.edu/en/publications/the-one-standard-error-rule-for-model-selection-does-it-work/),
and its standard-error estimate can be biased by 50–100% in either direction. The useful part is
its philosophy — do not treat a minimum as located more precisely than your uncertainty allows.

**What would actually settle it, and has not been done: use the other two harnesses as held-out.**
The constants were fitted on Codex alone. OpenCode and Claude are independent corpora that already
exist, and this repository's own methodology rule requires exactly that split. Fit the constants on
one harness, then report the chosen configuration's delta on the other two **without re-tuning**.
That is `$0`, it is the honest test of whether `(0.35, 400)` is a real optimum or Codex's, and it
is the one measurement this section could not make — §2.1's three-harness replay script was not
retained in `phase1-scripts/`, so only the Codex leg is reproducible here.

**Superseded by §9.12**, which replays all three harnesses and settles the choice on held-out
evidence rather than on a rule.

### 9.12 All three harnesses, and the single default — no flag

**Asked by the project owner, 2026-08-14: involve every harness, and give one good default with no
flag.** Script: `d11-c4-all-harnesses.mjs`. Exact turn attribution on all three — every read call
is mapped to the request that issued it by message id, not by log adjacency.

**Baselines reproduce the recorded per-arm cost to `100.0%` on all three harnesses.** That is the
gate; nothing below it was trusted.

> **CORRECTION, same day.** The first version of this section reported
> **−3.30 / −2.08 / −4.72%**. The codex figure was wrong. `ss-read <file> <start>` is a
> **single line** in the bench wrapper, not start-to-EOF (`_ss-helpers.mjs:523`), and the replay
> parser read it as start-to-EOF on **176 of 1,000** recorded calls. Corrected, codex is
> **−1.60%**, not −3.30%. OpenCode and Claude are unaffected — their recorded calls almost all
> carry an explicit end. Every number below is post-correction. The lesson generalises: **parse the
> wrapper the agent actually invoked, not the library's default semantics.**

#### Three defects in the recorded C-4 measurement, all found by extending it

1. **The original parser missed 35% of the reads.** It matched
   `/\bss-read\b([^\n|;&]*)/` — a character class that **stops at `&`**. Codex chains reads:
   `ss-read a 1 180 && ss-read b 1 130 && ss-read c …`. Counted directly: **40 of 102 codex read
   commands chain two or more reads, and 55 of 157 invocations were invisible to it.** Every
   recorded C-4 figure is therefore an **under**-estimate.
2. **Transcript selection matters and must be pinned.** Selecting the longest transcript per
   rollout instead of the one matching the recorded cost inflates the baseline by 7–18% and
   silently includes retried sessions. The validated rule — take the transcript whose replayed
   ideal cost is closest to the row — is the one used here, and it is what produces the 100.0%
   reproduction.

#### The corrected surface, per harness

| harness | own best configuration | value |
|---|---|---:|
| codex | `span ≥ 0.15, cap ≤ 1000` | **−2.35%** |
| opencode | `span ≥ 0.15, cap ≤ 400` | **−2.15%** |
| claude | `span ≥ 0.25, cap ≤ 600` | **−4.72%** |

**71 of 72 configurations save money on all three harnesses at once.** The mechanism is not
delicate; only one configuration in the whole grid loses anywhere, and it loses by 0.02pp.

#### The held-out test the constants never had

Fit on one harness, then report that configuration on the other two **without re-tuning**:

| fitted on | chosen | held-out result | gap to that harness's own best |
|---|---|---|---:|
| codex | `0.15 / 1000` | opencode −0.59%, claude −3.43% | **1.56pp**, **1.28pp** |
| opencode | `0.15 / 400` | codex −2.07%, claude −3.84% | 0.28pp, 0.88pp |
| claude | `0.25 / 600` | codex −1.60%, opencode −2.08% | 0.75pp, **0.07pp** |

**No single harness's argmax transfers well** — the best case gives up 0.07pp, the worst 1.56pp.
That is the winner's curse of §9.11 showing up exactly where it was predicted, and it settles the
selection question: **the default must be chosen by a cross-harness criterion, not by any one
harness's optimum.** The table below does that.

#### The cliff is at 350–400 on two of three harnesses

| cap | 300 | 350 | **400** | 500 | 600 |
|---|---:|---:|---:|---:|---:|
| codex @ 0.25 | −0.99% | −1.58% | −1.60% | −1.60% | −1.60% |
| opencode @ 0.25 | −0.88% | −0.93% | **−2.08%** | −2.08% | −2.08% |
| claude @ 0.25 | −1.18% | −1.54% | **−4.54%** | −4.54% | −4.72% |

On OpenCode and Claude the effect **more than doubles between 350 and 400**. So `cap = 400` does
not sit near a cliff — it sits *on* it, on two harnesses out of three. That is the single strongest
reason not to ship the fitted argmax.

#### THE DEFAULT

> **`span ≥ 0.25` of the file already requested, and file ≤ 600 lines.**

| | codex | opencode | claude | **mean** | worst harness |
|---|---:|---:|---:|---:|---:|
| **`0.25 / 600`** | −1.60% | −2.08% | **−4.72%** | **−2.80%** | −1.60% |
| `0.15 / 400` | −2.07% | −2.15% | −3.84% | −2.69% | **−2.07%** |

- **Saves on all three harnesses**, and has the **best mean of all 72 configurations**.
- **250 lines clear of the cliff**, where every per-harness argmax sits at 0 lines clear.
- The only family that beats it on the *worst* harness is `span 0.15–0.20`, by ≤0.47pp — well
  inside the ±1.51pp bootstrap standard error of §9.11, so the instrument cannot separate them.
- **The fraction is what keeps the mechanism honest.** At 0.15 the policy expands a 500-line file
  after a 75-line request, and "you are already paying for most of it" stops being true. Where the
  data cannot choose, the mechanism should.
- One rule, two constants, no flag, no per-harness tuning.

Anything in `span 0.15–0.30 × cap 400–600` is the same policy on this evidence.

**The cost of having no flag, stated once because it is real:** future benchmark runs lose a
same-binary A/B for this lever. The comparison has to be made against a pinned earlier version
instead. That is the project owner's call and it is taken.

**What still does not change.** The magnitude rests on few events and a concentrated task
distribution (§9.10), and **no solve effect has been measured for any configuration** — the replay
cannot produce the counterfactual trajectory. The sign is now confirmed on three harnesses with a
held-out check; the size is not.
