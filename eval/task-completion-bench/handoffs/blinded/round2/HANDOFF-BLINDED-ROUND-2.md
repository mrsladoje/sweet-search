# HANDOFF — obligation-graph gate, rotation round 2

**Written:** 2026-08-13. **Spend:** `$0` — no model rollouts, no paid work of any kind.
**Deliverable:** `eval/task-completion-bench/handoffs/blinded/round2/ROUND-2-RESULTS.md`.
**One gate. Five tasks. Everything you need is in this directory.**

---

## 0. THE BLINDING RULE — read before anything else

This exercise asks you to derive something from an issue and a base tree, write it down, **and
only then** look at the accepted solution. All the value is in that order.

### 0.1 Your memory index is already contaminating you — check it first

**`MEMORY.md` loads automatically at session start, before you can read any brief.** In the
previous round, one line in that index printed the answer to one of the tasks. The session could
not un-read it and had to discard that task.

**Before you do anything else**, open your `MEMORY.md` index and check whether any line names a
repository, symbol, filename, or finding belonging to the five tasks in `SLATE-PUBLIC.json`. If
one does, **say so in your results and treat that task as contaminated.** Do not open any memory
*file* whose one-line hook mentions the benchmark task corpus.

This is the second time a blinded gate has been broken by a document that publishes its own
answer key. Assume there is a third.

### 0.2 Forbidden until §5

- **`eval/task-completion-bench/handoffs/improve/`** — every file. It discusses the task corpus
  by name and prints deciding facts.
- **`eval/task-completion-bench/handoffs/blinded/picker/`** — this round's sealed labels live
  there. It is one directory away from you. Do not open it.
- **`eval/task-completion-bench/handoffs/blinded/BLINDED-GATE-RESULTS.md`** and the `lock*.md`
  files beside it — the previous round's answers.
- **any `select/.cache/tasks_full_*.json`** — these contain gold patches. The issue text you
  need has already been extracted for you; see §2.
- `git log` / `git show` on commits whose subject begins `bench(`.

### 0.3 The declaration

Open your results document with this, before any finding:

> I did not open `handoffs/improve/`, `handoffs/blinded/picker/`, the previous round's results
> or lock files, or any `tasks_full_*.json` before writing and hashing my lock file. I checked
> my memory index for contamination and found: `<none | the specific line>`.
> Lock hash: `<sha256 …>`.

**If you break blinding, say so plainly and stop.** A contaminated gate reported as clean is
worse than an unrun gate, because it looks like evidence and cannot be distinguished from it
later.

---

## 1. Why this brief tells you so little

It gives you the procedure and the bar and nothing about the domain. If a sentence seems to
withhold context you would find useful — it does, deliberately. Do not go looking for it.

This is a rotation round for a gate that has been run once before on a smaller sample. You are
not told what that round concluded, because knowing it would shape what you look for.

---

## 2. The gate

**Question:** given only an issue statement and a base source tree, can the required *shape* of
the change be derived before any code is written?

**The five tasks** are in [`SLATE-PUBLIC.json`](./SLATE-PUBLIC.json), with their issue text
already extracted into [`ISSUES.json`](./ISSUES.json) so that you never have to open a file
containing gold.

They were chosen by a script with a seed fixed in advance, from a 200-task development pool,
after excluding every task that any planning document discusses and every task used in a
previous round. **The slate is a constructed mixture, not a natural sample.** Do not try to
infer its composition, and do not calibrate to a base rate — over-asserting is penalised exactly
as much as missing, so guessing at the mix cannot help you.

**Inputs you may use:** the issue statement, and the base tree at the given commit. Nothing else.
Not the accepted patch, not the test patch, not any recorded agent attempt, not the repository's
later history. If you clone a repo, check out the base commit and **do not read forward.**

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
exactly as much as missing one that does.** Where you are unsure, file the node and mark it
low-confidence rather than omitting it or asserting it flatly — a calibrated low-confidence node
is worth more than a confident wrong one, and will be scored as such.

---

## 4. Lock, then reveal

1. Write all five graphs to `round2/lock-obligations.md`.
2. Record `shasum -a 256 round2/lock-obligations.md` in your results.
3. **Do not edit the lock file afterwards.** If you realise something later, note it in the
   results as a post-lock observation and score it as a miss.

### The bar

Scored per task, then reported both per task and overall:

- **If the accepted solution adds any new source modules**, every one must appear in your graph
  with the correct owning package.
- **Every** export, overload, enumeration or predicate obligation it relies on must appear.
- Documentation and test files count in neither direction.
- **Exact filenames are not required.** What scores is owning module, public or internal,
  and dependency direction.
- A node you asserted that the accepted solution does not need is a **false positive**; report
  the count. A gate that passes by asserting everything has not passed.

**PASS requires getting every task right.** Report the per-task result either way — "four of
five, and here is the one that failed and why" is a more useful result than a bare verdict.

---

## 5. Reveal protocol

Only after the lock file exists and its hash is recorded:

1. Read the accepted patch for each task from the sealed labels at
   `handoffs/blinded/picker/SEALED-labels.json`, and the full patches from the development pool
   file it names.
2. Score against the bar exactly as written. **Do not soften a bar after seeing a result.** A
   near miss is a miss; record the number.
3. *Now* you may read `handoffs/blinded/BLINDED-GATE-RESULTS.md` and `handoffs/improve/`, to
   reconcile. Note where you agree and where you differ.

---

## 6. Environment

**Base checkouts — all five are on the evidence box at the exact base commits:**

```
/root/.ss-eval/golden/Konstantin8105__c4go@2afb0ebe7c5c40f54810f15ccfc19192a27c54c8
/root/.ss-eval/golden/smooth-code__svgr@cc3d80d6bdb163686bf8b898b62ed35dc1e0c985
/root/.ss-eval/golden/aws__aws-lambda-dotnet@c8298c5ce0c37cbbac49e0899fdeb01f685ffb46
/root/.ss-eval/golden/vuejs__eslint-plugin-vue@4dfb4d7966ea49da9252e99ef80cca9a37302d74
/root/.ss-eval/golden/JoshuaKGoldberg__create-typescript-app@91824c6ad00ba56122a32df5fc40b19349299b65
```

`smooth-code__svgr` is also on the Mac at `~/.ss-eval/golden/`. Copy the others down, or work
over ssh.

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
- **Never use `ss-*` commands to develop sweet-search.** Native file tools only. Running `ss-*`
  as the system under test against a non-sweet-search corpus, with scripted assertions, is
  testing and is fine.
- **The working tree is dirty** — roughly 30 files belong to concurrent daemon and maintainer
  work. Do not revert, stash or clean them. To commit a file that mixes your work with theirs,
  stage by hunk: `git diff -U3 <file>`, filter, `git apply --cached`. Zero-context
  (`-U0 --unidiff-zero`) mis-places hunks.
- **Git:** solo project, commit direct to `main`, no feature branches, and only when asked.
- **Never route the Sol model through OpenRouter** — metered at roughly 50× subscription cost.

---

## 8. Deliverable

`round2/ROUND-2-RESULTS.md`, containing:

1. **The declaration and the lock hash, first, before any result.**
2. Per task: what you derived, what the reveal showed, **PASS / FAIL**, and the false-positive
   count.
3. An overall verdict against §4's bar.
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
