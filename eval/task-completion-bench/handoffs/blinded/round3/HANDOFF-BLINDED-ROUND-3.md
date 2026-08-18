# HANDOFF — obligation-graph gate, rotation round 3

**Written:** 2026-08-13. **Spend:** `$0` — no model rollouts, no paid work of any kind.
**Deliverable:** `eval/task-completion-bench/handoffs/blinded/round3/ROUND-3-RESULTS.md`.
**One gate. Five tasks. Everything you need is in this directory.**

---

## 0. THE BLINDING RULE — read before anything else

This exercise asks you to derive something from an issue and a base tree, write it down, **and
only then** look at the accepted solution. All the value is in that order.

### 0.1 Your memory index is already contaminating you — check it first

**`MEMORY.md` loads automatically at session start, before you can read any brief.** In an
earlier round, one line in that index printed the answer to one of the tasks. The session could
not un-read it and had to discard that task.

**Before you do anything else**, open your `MEMORY.md` index and check whether any line names a
repository, symbol, filename, or finding belonging to the five tasks in `SLATE-PUBLIC.json`. If
one does, **say so in your results and treat that task as contaminated.** Do not open any memory
*file* whose one-line hook mentions the benchmark task corpus.

Blinding has been broken **three times** in this programme — a planning document that printed its
own answer key, the auto-loaded memory index naming a task's answer, and a brief that quoted the
deciding fact in its own body — and the sweep for THIS round caught two more before anyone
derived anything: tasks another programme had already run, and a forensics write-up that printed
the exact new packages one candidate's hidden test imports. The session that wrote this brief ran a leak sweep over the
memory index and over this directory for every task id, repository name and path token in the
slate, and recorded the result in [`LEAK-SWEEP.md`](./LEAK-SWEEP.md). **That sweep is evidence,
not a guarantee. Assume there is another channel nobody has found, and say so if you trip over
one.**

### 0.2 Forbidden until §5

- **`eval/task-completion-bench/handoffs/improve/`** — every file. It discusses the task corpus
  by name and prints deciding facts.
- **`eval/task-completion-bench/handoffs/blinded/picker/`** — this round's sealed labels live
  there, in `SEALED-labels-round3.json`. It is one directory away from you. Do not open it.
- **`handoffs/blinded/BLINDED-GATE-RESULTS.md`**, the `lock*.md` files beside it, and
  **`handoffs/blinded/round2/`** in its entirety — earlier rounds' answers.
- **any `select/.cache/tasks_full_*.json`** — these contain gold patches. The issue text you
  need has already been extracted for you; see §2.
- `git log` / `git show` on commits whose subject begins `bench(`.
- **Anything that reports on rollouts already run against this corpus**, because a rollout
  transcript can name the fix: `eval/task-completion-bench/results/`,
  `eval/task-completion-bench/analysis/`, `TURNFIX*.md`, `TURN-ECONOMY*.md`,
  `EDIT_THRASHING.md`, `FORENSICS-*.md`, `RESULTS-*.md`, `FIX-REPORT.md`, `PLAN.md`, and
  `select/MANIFEST_*.json`. **This class is what the round-3 sweep caught** — the first draw
  put three tasks on the slate that another programme had already run and written up. They
  were excluded and the slate was redrawn at the same fixed seed. No task on your slate now
  appears in any of those, but the rule stands for the ones you might reach for anyway.
- **Memory files.** Your index may link to a memory whose one-line hook says nothing about the
  task corpus while the file itself names tasks by id. Round 3 found exactly that. Read the
  index; do not open the files.

You **may** read [`NARROWED-CLAIM.md`](./NARROWED-CLAIM.md) in this directory. It is the frozen
claim and bar you are testing. It was written and hashed **before** your slate was drawn, and it
names no task, no repository and no symbol.

### 0.3 The declaration

Open your results document with this, before any finding:

> I did not open `handoffs/improve/`, `handoffs/blinded/picker/`, `handoffs/blinded/round2/`,
> the earlier round's results or lock files, or any `tasks_full_*.json` before writing and
> hashing my lock file. I checked my memory index for contamination and found:
> `<none | the specific line>`.
> Lock hash: `<sha256 …>`.

**If you break blinding, say so plainly and stop.** A contaminated gate reported as clean is
worse than an unrun gate, because it looks like evidence and cannot be distinguished from it
later.

---

## 1. Why this brief tells you so little

It gives you the procedure and the bar and nothing about the domain. If a sentence seems to
withhold context you would find useful — it does, deliberately. Do not go looking for it.

This is the third rotation of a gate that has been run twice. You are told the claim and the bar
because you are being scored against them. You are **not** told what the earlier rounds
concluded per task, because knowing it would shape what you look for.

---

## 2. The gate

**Question:** given only an issue statement and a base source tree, can the required *shape* of
the change be derived before any code is written?

**The five tasks** are in [`SLATE-PUBLIC.json`](./SLATE-PUBLIC.json), with their issue text
already extracted into [`ISSUES.json`](./ISSUES.json) so that you never have to open a file
containing gold.

They were chosen by a script with a seed fixed and published in advance
(`NARROWED-CLAIM.md` §4, seed `20260901`), from a 268-task pool — the 200-task development set
plus 68 untouched reserve tasks — after excluding every task used in a previous round, every task
another programme has run, every task any prose document discusses, every task in a repository
either of those already exposed, and every task whose base tree cannot be obtained. **The slate
is a constructed mixture, not a natural sample.** Do not try to infer its composition, and do
not calibrate to a base rate — over-asserting is penalised exactly as much as missing, so
guessing at the mix cannot help you.

**Inputs you may use:** the issue statement, and the base tree at the given commit. Nothing
else. Not the accepted patch, not the test patch, not any recorded agent attempt, not the
repository's later history.

---

## 3. What to produce

For each of the five tasks, an **obligation graph** — the set of things that must be true for
the requested capability to exist and be reachable by a consumer. Node kinds, all generic:

| node kind | what you must state |
|---|---|
| author a new source module | owning package, public or internal, and why it cannot live in an existing file |
| add or change an export | which package's public surface, and the direction of the edge |
| preserve an overload or existing signature | the signature that must keep working |
| add a type predicate or guard | what it narrows, and where it belongs |
| update a public enumeration or union | which one, and the ordering rule if any |
| prove a wrong-kind input is rejected | the input class and the expected behaviour |
| modify existing behaviour in place | the function or method, and the observable change |

For every node give **owning package, public or internal, and dependency direction.**

Not every kind applies to every task. **Asserting a kind that does not apply counts against you
exactly as much as missing one that does.**

### 3.1 Confidence is now part of the artefact, and it is scored

Every node is filed at **high confidence** or **low confidence**, and the two are different
objects:

- **High confidence is an assertion.** It scores in both directions: it earns the hit, and if it
  is wrong it is a false positive that fails the gate outright (`NARROWED-CLAIM.md` §3
  requirement 4).
- **Low confidence is an advisory.** It is reported and counted and **scores in neither
  direction** — it cannot be wrong, and it also **cannot satisfy any requirement**.

That second half is the trap, so it is spelled out: **hedging everything fails.** A new source
module filed at low confidence does not satisfy requirement 1, because requirement 1 asks for an
assertion. Use low confidence for what you genuinely cannot call, and stand behind the rest.

---

## 4. Lock, then reveal

1. Write all five graphs to `round3/lock-obligations.md`.
2. Record `shasum -a 256 round3/lock-obligations.md` in your results.
3. **Do not edit the lock file afterwards.** If you realise something later, note it in the
   results as a post-lock observation and score it as a miss.

### The bar

**The bar is `NARROWED-CLAIM.md` §3. Read it there; it is frozen and hashed.** In summary, PASS
requires, on every one of the five tasks:

1. every new source module the accepted solution adds, asserted, with the correct owning package;
2. no missing export, overload, enumeration or predicate obligation it relies on;
3. no new source module asserted on a task whose accepted solution adds none;
4. **zero high-confidence false positives across the whole slate**;
5. all of 1–4 on all five tasks — four of five is a FAIL.

Documentation, test, fixture, lint and coverage-configuration files count in **neither**
direction. Exact filenames are not required: owning module, public or internal, and dependency
direction are what score.

**Which of two admissible fixes the maintainer picked is NOT part of the claim** (see
`NARROWED-CLAIM.md` §2.2). If the accepted solution achieves the capability by removing a
construct where you predicted adding one, record it — but it is a scope note, not a miss.

**Do not soften the bar after seeing a result.** A near miss is a miss. Report the per-task
result either way: "four of five, and here is the one that failed and why" is a more useful
result than a bare verdict.

---

## 5. Reveal protocol

Only after the lock file exists and its hash is recorded:

1. Read the accepted patch for each task from the sealed labels at
   `handoffs/blinded/picker/SEALED-labels-round3.json`, and the full patches from the
   development pool file it names.
2. Score against the bar exactly as written.
3. *Now* you may read the earlier rounds' results and `handoffs/improve/`, to reconcile. Note
   where you agree and where you differ.

---

## 6. Environment

**Base checkouts — all five are on the evidence box, and each one was verified to be AT its
base commit before its history was stripped (2026-08-13):**

```
/root/.ss-eval/golden/s-knibbs__dataclasses-jsonschema@0d222e9e01903f937d67bea2f6ab593bdde22818
/root/.ss-eval/golden/ember-cli__eslint-plugin-ember@eb62f6fbae3363f8f806f614df4fc0c65e313405
/root/.ss-eval/golden/phpactor__phpactor@9caee4baeecf43f20a1a2523f76f04ddcd7ec1a2
/root/.ss-eval/golden/CycloneDX__cyclonedx-core-java@f908d759647b6baf7c15705c9501d5f4d06cd559
/root/.ss-eval/golden/rrd108__vue-mess-detector@6ec303143ac2bdd8dc9d09563547c5d219ec4679
```

**READ THE TREE AS IT IS. Do not try to check out the base commit.** Every golden checkout is a
**single-commit repository**: `git init`, one commit named `base`, at a **synthetic SHA that is
not the upstream commit**. The `<repo>@<sha>` directory name is a label, not a resolvable ref,
so `git checkout <base_commit>` always fails — round 2 lost time to exactly this. The working
tree already **is** the base state; verify that by content, not by ref.

That property is also free blinding: `git log` shows one commit, so a session physically cannot
read forward from the base tree.

**One golden carries a stray `.vault-manifest.sha256`** at its root — a bench bookkeeping file
from image vaulting, not repository source. Ignore it; it is in no repository.

**Evidence box:** `ssh root@167.233.69.121`. Do not launch pilots, do not spend money, do not
mutate `results/`. Copying files either direction is fine. Run analyses without writing to the
host:

```bash
ssh root@167.233.69.121 'node -' < your-script.mjs
```

Disk was 55G free on 2026-08-13; abort below 12G. Another agent may be using the host.

---

## 7. Standing constraints

- **Spend `$0`.** This is derivation and inspection over artifacts that already exist. If a step
  seems to need a model rollout, you have misread it.
- **HO2 is frozen** — `tasks_full_heldout2.json` and anything derived from it. Never run it,
  never inspect it. The pool used here is the development set, which is a different file.
- **Never use `ss-*` commands to develop sweet-search.** Native file tools only.
- **The working tree is dirty** — roughly 30 files belong to concurrent daemon and maintainer
  work. Do not revert, stash or clean them. To commit a file that mixes your work with theirs,
  stage by hunk: `git diff -U3 <file>`, filter, `git apply --cached`. Zero-context
  (`-U0 --unidiff-zero`) mis-places hunks.
- **Git:** solo project, commit direct to `main`, no feature branches, and only when asked.
- **Never route the Sol model through OpenRouter** — metered at roughly 50× subscription cost.

---

## 8. Deliverable

`round3/ROUND-3-RESULTS.md`, containing:

1. **The declaration and the lock hash, first, before any result.**
2. Per task: what you derived, what the reveal showed, **PASS / FAIL**, and the counts of
   high-confidence and low-confidence false positives, kept separate.
3. An overall verdict against the bar in `NARROWED-CLAIM.md` §3.
4. A short section on what should happen next — and be willing to write "this capability does
   not survive". Four candidates in this programme have already died on gates like this one, and
   that is the system working rather than failing.

**Do not implement anything.** Implementation is a separate decision taken after this is read.

---

## 9. One note on method, carried from earlier rounds

**Sweep the shape of a mechanism, not one parameter of it.** A previous session's second pass —
which cost nothing — reversed one conclusion outright and materially restated two others. Before
you write FAIL, ask whether you tested the capability or merely one way of expressing it.

And the reason this directory exists at all: **keep the answer out of the specification.** A gate
that prints its own solution can be run once, by whoever wrote it, and never again.
