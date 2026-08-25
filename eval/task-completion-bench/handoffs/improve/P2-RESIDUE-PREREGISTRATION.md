# P2 terminal residue audit — PRE-REGISTRATION

**Written before any code exists.** No threshold below was chosen after seeing a result.

## 0. Why this and nothing else

The 2026-08-24 re-baseline showed **no measurable resolution difference on either harness**.
The one task native beats sweet on *both* harnesses is `jashkenas__underscore-2757`, and its
traces settle what the failure is — and, decisively, what it is **not**:

- **Not retrieval.** All six rollouts, both arms, had the `countBy` twin in a tool result
  before their first edit. Sweet rep2 read one contiguous `ss-read underscore.js 390 480`
  spanning both sites and still edited one.
- **Not test feedback.** The failing sweet rollout and the winning native rollout received
  **byte-identical** final output: `1561 tests of 1562 passed`, `pre_existing_failures=1` on
  an unrelated typed-array test, and `[run_tests guidance] verdict=PASS action=none`. The
  suite's one failure has nothing to do with the fix. **The environment ends by telling the
  agent it is done.**
- **Not instructable.** The `G1` family-completeness clause said exactly "find the nearest
  existing member and edit every site" and moved nothing: 3/8 tasks in every condition.

Pooled over production-prompt runs, sweet patches both sites **10/24 = 42%** against native's
**18/23 = 78%** (z = 2.56, p = 0.011), and neither arm ever patches the twin alone.

**A static check on the agent's own diff is the only mechanism left that can see this.** It
needs no hidden test, no oracle, and no extra model turn.

## 1. Scope — deliberately one third of what the slate proposed

**BUILD:** string-residue only. Take the working-tree diff; for each removed line, extract the
literal stem that was replaced; report every remaining occurrence of that stem elsewhere in
the repository, with file and line.

**DO NOT BUILD:** structural-twin detection, SimHash/MinHash near-duplicate candidates,
`ss-oracle`, `ss-witness`, `ss-finish`, or any completion *gate*. The evidence supports the
string half. The rest is unfalsified scope.

**Vehicle:** a sweet-only command. **No FRAME change.** Any M± hook must be general text that
names the tool, never a task hint.

## 2. The `$0` gate, which runs BEFORE any live rollout

Replay every recorded sweet final diff against its base tree.

| requirement | bar |
|---|---|
| **sensitivity** | every recorded one-site `underscore` patch must report the `countBy` residue |
| **specificity** | on rollouts that RESOLVED, the false-positive rate must be **≤ 0.5 residues per rollout** |
| **generality** | the residue count must be computable on every language in the pool without per-language code |

**Kill conditions.** Missing `countBy` kills it outright. Above **2.0** false residues per
resolved rollout kills it: at that rate the report is noise and the agent will learn to ignore
it. Between 0.5 and 2.0 is a **redesign**, not a pass — narrow the stem extraction and re-gate.

**The specificity bar is the one that matters.** A residue list that fires on correct work is
worse than no list, because it spends turns and teaches the model to skip the section.

## 3. If the `$0` gate passes

Pre-registered live bar, to be run only after the gate:

- **Solve preservation first.** On the repaired 5-task control set, **zero** regressions. A
  control regression kills the lever regardless of what it gains elsewhere.
- **Gain:** ≥ 2 additional tasks majority-solved across the 13 admissible tasks, or an
  `underscore`-shaped 3/3 where baseline is ≤ 1/3.
- **Cost:** ≤ +10% per rollout. The audit is one call and a few hundred output tokens; more
  than that and it is not the cheap lever it claims to be.

## 4. What would make me abandon it

If the `$0` gate shows the residue is only findable when the stem is a long literal — i.e. it
works on `underscore` and nothing else — then this is a one-task tool and it should be
reported as such and dropped. **The slate's own ceiling for P2 was "+1 claude-code task".
That is the honest upper bound, and one task is not a product.**
