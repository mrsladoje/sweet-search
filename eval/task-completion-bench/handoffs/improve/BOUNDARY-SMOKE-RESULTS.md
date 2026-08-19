# Boundary micro-smoke — can a prompt sentence recover dependency reach?

**Dates:** 2026-08-18/19 · **Harness:** opencode · **Backbone:** `openai/gpt-5.6-luna`
**192 rollouts, `$0.964`** · Ledger `/root/env-ledger/luna-rotate20-v3/ledger.jsonl`, green throughout

## Verdict

**No. The programme is dead, and the hypothesis it rested on does not survive its own
measurement.**

Seven prompt wordings across 111 sweet rollouts produced **1 raw-tool rollout and 1 dependency
read**. Native, in the identical conditions, uses raw `grep`/`find` in **18 of 18**.

## What was tested

The shipped guide says two things that are false outside the working tree — *"the index covers
every file"*, and that two empty probes settle absence with *"no native scan"*. The P1 gate had
measured sweet reaching for dependency source in 6/102 rollouts against native's 17/102 and
concluded that demand, not supply, was the constraint.

So: put the dependencies on disk (`dep-materialise.mjs`, `SS_DEPS=1`, **both arms** — a corpus
only sweet can reach is a manufactured differential), then try to talk the agent into reading
them.

| variant | what it added |
|---|---|
| B1 | the index stops at the project boundary |
| B2 | B1 + read outside code with ordinary shell tools + absence rule scoped (a paragraph) |
| B3 | B2 + resolve an external blind spot before choosing |
| V1 | one sentence ending in an action: *if `ss-*` comes back empty, retry with raw `grep`/`find`* |
| V2 | V1 + a three-word scope fix to the absence rule |
| V3 | V1 + a trigger bullet naming `node_modules/`, `.venv/`, `vendor/` and one `grep -rn` |

## Exposure — the only table that matters

| cell | rollouts | raw `grep`/`find` | dependency read |
|---|---:|---:|---:|
| B1 | 18 | 0/18 | 0/18 |
| B2 | 16 | 0/16 | 0/16 |
| B3 | 18 | 0/18 | 0/18 |
| V1 | 15 | 0/15 | 0/15 |
| V2 | 18 | 1/18 | 0/18 |
| V3 | 18 | 0/18 | 1/18 |
| V2 confirmation | 8 | 0/8 | 0/8 |
| **sweet, production prompt** | 18 | **0/18** | 0/18 |
| **native, same conditions** | 18 | **18/18** | 0/18 |

Wording was not the variable. Five of the seven differ in mechanism, not dose — abstract
category, concrete command, trigger bullet, action verb, contradiction removal — and every one
lands in the same place.

## The near-miss, and why it was not one

V2 returned pytask **3/3** against a 0/3 baseline: the best cell in the programme. The exposure
check said **0 of 18 rollouts read a dependency**, so the flip could not be the mechanism V2
exists for. pytask sweet across every cell run is 0/3, 1/3, 1/3, 2/4, 1/1, 3/3 — a coin at
n=3, where both 0/3 and 3/3 carry p≈0.125.

Pre-registered before the run: eight reps, control and treatment, **real only if V2 ≥ 6/8 and
control ≤ 3/8**.

| pytask, 8 reps | solved | raw grep | dependency read |
|---|---:|---:|---:|
| deps + production prompt | 2/8 | 0/8 | 0/8 |
| deps + V2 | 3/8 | 0/8 | 0/8 |

**3/8 against 2/8. The bar is missed and the 3/3 was the coin.** Had this been reported off the
first cell it would have been a shipped false positive.

## A correction to the P1 gate's framing

The gate reported native "REACHED" dependency source in 17/102 rollouts and read that as
appetite sweet lacks. With dependencies actually present, **native reads them 0/18 times.** It
greps constantly, but over project code. The 17 were *attempts* — the recorded
`ModuleNotFoundError` — against source that was not on disk. So dependency reach does not
explain native's edge, because native does not have dependency reach either.

## What survives

- **A robust behavioural fact:** sweet's agent essentially never uses raw shell search
  (1 rollout in 111) while native always does (18/18). That is real and worth knowing; it is
  not the resolution lever.
- **`dep-materialise.mjs`**, working and default-off: asks the toolchain where packages live
  rather than guessing, lands them where the ecosystem expects, excludes them via
  `.git/info/exclude` so neither the index nor the graded patch sees them.
- **Head-to-head, 6 tasks × 3 reps, both arms:** sweet 11/18 vs native 13/18 without deps,
  13/18 vs 15/18 with. Same −2 gap, sweet cheaper both ways (`$0.085` vs `$0.109`).

## Recommendation

**Do not build `ss-deps`.** Supply was manufactured, permission was granted seven ways, and
demand never appeared. Building a corpus for a query the agent does not issue buys nothing.

**Do not spend another sentence on this.** The next honest question is not "how do we word it"
but "why does this agent never leave the `ss-*` toolbox" — and that is a training//M±-shape
question, not a wording one.
