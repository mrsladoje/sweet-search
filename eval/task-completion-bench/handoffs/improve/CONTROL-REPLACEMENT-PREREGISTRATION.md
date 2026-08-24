# Replacement control tasks — pre-registered selection rule

**Committed BEFORE any null arm ran and before any candidate was chosen.**
Executes [`VACUITY-PRESCREEN-RESULTS.md`](./VACUITY-PRESCREEN-RESULTS.md) §5.2 and
[`SLATE-A-RESIDUE-RESULTS.md`](./SLATE-A-RESIDUE-RESULTS.md) §7.6.
**Date:** 2026-08-24. **Budgeted model spend: `$0`** — a null arm makes zero tool calls.

---

## 1. Why

The control set is three tasks (`robot-710`, `scoringutils-229`, `parcels-617`), all 12/12,
after two were removed as vacuous. **An instrument that never moves cannot detect a
regression**, and three is thin. Two replacements are wanted.

The trap is structural and it has already fired once: a control set is defined as *"always
solves in both arms"*, which is very close to a filter **for** tasks that cannot fail. That is
how the last set ended up 40% vacuous.

## 2. The rule, in order

1. **Not flagged by the vacuity pre-screen.** Free, static.
2. **A null arm grades it UNRESOLVED.** `AGENT_TIMEOUT_MS=1000`, empty patch, behind a green
   ledger. This is the authority; the pre-screen is not.
3. **Solved at or near ceiling by both arms** in recorded evidence.

Drawn from **DEV-RET** (`tasks_full_heldout.json`, reclassified as dev) after removing its
**9** flagged tasks. **Not** from HO2.

## 3. Three additional exclusions, declared before selecting

Each is a validity rule already established elsewhere in this programme, applied here rather
than rediscovered later:

- **Not name-locked.** A naming lottery cannot serve as a control: it is noise no number of
  reps removes, so it would move for reasons unrelated to any change under test.
  ([`NAME-LOCK-CENSUS.md`](./NAME-LOCK-CENSUS.md))
- **Not on the static blocklist, and not `excludeFromAgentRuns`.**
- **Not already in the 18-task rotation.** A treatment task cannot also be a control.

## 4. Tie-break, declared before selecting

Among survivors, prefer **a language not already represented in the control set**
(`robot-710` java, `scoringutils-229` r, `parcels-617` python). A control set that is three
Python-family suites cannot detect a regression that only touches one toolchain.

Where several languages qualify equally, prefer the candidate whose golden checkout is
already materialized on the box, so gold verification costs container time and nothing else.

## 5. Bar

A candidate is **accepted** only if all of 1, 2 and 3 hold **and** it is gold-`FULL` in a
ledger built under the current fingerprint (**version 4**, which hashes the generated
`run_tests` shim). Two accepted candidates are adopted.

**If fewer than two survive the null arm, fewer than two are adopted.** The control set is
allowed to stay at three rather than take a task that cannot fail. That is the exact mistake
this rule exists to prevent, and "we needed two" is not evidence.

## 6. Reporting

Every candidate that reaches the null arm is reported with its verdict, including the ones
that fail. A shortlist that quietly drops its failures is a filtered denominator.
