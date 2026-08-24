# Name-lock census — wired into task selection, and what it says about the current pool

**Executes:** the disposition of [`HINT-LADDER-RESULTS.md`](./HINT-LADDER-RESULTS.md),
which found that two chronically-unsolved targets flip at **no** hint level — a full prose
specification of the required behaviour included — and that a 20x-larger backbone buys 0/10
on one of them.
**Date:** 2026-08-24. **Model spend: `$0`.** Static analysis of task records and base trees.
**Artifacts:** [`name-lock-20260824/`](./name-lock-20260824/) — `census-rotation18.txt`,
`admissible-cross.txt`.
**Instruments:** [`select/name-lock.mjs`](../../select/name-lock.mjs),
[`select/stamp-name-lock.mjs`](../../select/stamp-name-lock.mjs).

---

## 0. Verdict

**4 of the 18 rotation tasks are naming lotteries — 22.2%. Two of those four are already
inadmissible for other reasons, so of the 13 admissible tasks, 2 are lotteries and 11 are
measurable.**

| task | language | identifiers the hidden test needs that nothing in the base tree mentions |
|---|---|---|
| `dart-lang__http-1114` | dart | `headersSplitValues`, `Path` |
| `mransan__ocaml-protoc-202` | ocaml | `Constant_literal` |
| `litestar-org__polyfactory-405` | python | `__check_model__` |
| `joshuakgoldberg__bingo-274` | ts | `isFile`, `handlebarsDirectory`, `handlebarsFile` — **and the module paths too**: `./isFile.js ./types.js ./handlebarsDirectory.js ./handlebarsFile.js` |

```
pool                      18
name-locked in pool        4
admissible                13
name-locked & admissible   2   dart-lang__http-1114, joshuakgoldberg__bingo-274
measurable                11
```

`bingo-274` is the strong form: the hidden test imports by **relative module path**, so the
agent must choose the file names exactly as well as the symbols.

## 1. The rule

Locked = the hidden test names the identifier, **and** the reference patch introduces it,
**and** the base tree has never heard of it, **and** the issue text does not spell it out.

The last clause is load-bearing. `rstudio-education__gradethis-161` solves 2/2 everywhere and
still contains an invented identifier — because the issue hands it to the agent. Without that
clause the census would call a spelled-out request a lottery.

Two more guards keep the claim honest, both asserted in `tests/task-gates.mjs`:

- **The base vocabulary is deliberately generous.** Every identifier occurring anywhere in
  the checkout counts, plus every file's own basename — `isModeExecutable.ts` teaches the
  `is<Thing>` convention even where the symbol never appears in prose. Over-generosity can
  only ever make a lock claim harder to sustain.
- **A one-word English noun is not an API name.** A compound shape is required — camelCase,
  snake_case, or a leading capital — so `comma` and `declared` stop counting.

## 2. Why this is a validity rule and not a difficulty preference

An agent that produces a **functionally identical** fix under any other name fails. No
analyzer, index, ranking change, witness or certificate can close that gap, because there is
nothing to retrieve: the answer is a name a maintainer chose and never wrote down. Such a
task does not measure retrieval, and no number of reps averages the coin away.

Its effect on the programme is concrete rather than theoretical. Every ceiling number that
counts one of these tasks as winnable is fiction, and every head-to-head that includes one is
paying reps to sample a coin. `bingo-274` was one of the hint ladder's two immovable targets.

## 3. How it is wired, and the one design constraint

Unlike the F2P/P2P rules, this one **cannot be computed from a task record alone**: deciding
"invented" needs the base tree, and the reference patch, and the hidden test patch. Those are
legitimately in scope at recruitment and must never be in scope at run time.

So the measurement happens **once, at recruitment**, and stamps the record:

| where | what |
|---|---|
| `select/name-lock.mjs` | the rule, as a reusable module |
| `select/stamp-name-lock.mjs` | the recruitment step: reports the census, writes `name_locked` + `name_locked_identifiers` into each record |
| `select/task-gates.json` | `reject_name_locked: true` — one source of truth, both languages read it |
| `select/task_gates.py` | selection-side rejection, before the seeded draw |
| `harness/task-gates.mjs` | run-pilot's defence-in-depth WARN, plus `reportNameLockCensus` |
| `harness/run-pilot.mjs` | prints the census on every run |

**UNSTAMPED IS NOT CLEAN.** A task whose base tree is not materialized is left unstamped, and
both gates treat an absent field as *not yet measured* rather than as a pass. A wholly
unstamped set prints `UNSTAMPED … never clean` rather than `0%`. Stamping `false` for a
checkout that could not be read would be precisely the error this programme keeps finding.

## 4. What it does not claim

The rule sees identifiers. A task can be a lottery in other ways — an exact output string, a
required file layout, an ordering the issue never states — and this census is silent on all
of them. `22.2%` is a floor on the rotation, not an estimate of it.
