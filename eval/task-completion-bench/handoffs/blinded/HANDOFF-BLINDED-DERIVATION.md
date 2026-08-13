# HANDOFF — three blinded derivation gates

**Written:** 2026-08-13. **Spend:** `$0` — no model rollouts, no paid work of any kind.
**Deliverable:** `eval/task-completion-bench/handoffs/blinded/BLINDED-GATE-RESULTS.md`.

---

## 0. THE BLINDING RULE — read this before anything else

**Do not open `eval/task-completion-bench/handoffs/improve/`.** Not any file in it, not at any
point, not for any reason, until §6 of this document tells you to.

That directory contains the project's planning and research documents. **Those documents print
the answers to the three exercises below, inside the very sections that specify them.** A
previous session ran seven of the ten gates in that plan and had to record these three as
BLOCKED, because by then it had read the answer key. This is not a hypothetical risk — it has
already cost the project one attempt at each of these gates.

Specifically forbidden until §6:

- every file under `eval/task-completion-bench/handoffs/improve/`
- `git log` / `git show` on commits whose subject begins `bench(handoffs)`, `bench(phase0)`,
  `bench(cost)`, or `bench(results)`
- these memory files, if your memory index surfaces them:
  `project_phase1_gate_results`, `project_no_retrieval_headroom_rotate20`,
  `project_task_completion_bench_design`
- any file matching `select/.cache/tasks_full_*.json` — **these contain gold patches**

Permitted and expected: this file, the repository source tree, the base checkouts named below,
issue text, recorded agent patches, and grader logs.

**You must open your results document with a signed declaration:**

> I did not open `handoffs/improve/`, the named memory files, or any `tasks_full_*.json`
> before writing and hashing my lock files. Lock hashes: `<sha256 …>`.

If you break blinding by accident, **say so plainly and stop**. A contaminated gate reported as
clean is worse than an unrun gate, because it looks like evidence.

---

## 1. Why the brief is this thin

Each gate asks you to derive something from an issue statement and a base source tree, write it
down, *then* look at the accepted solution and score yourself. The whole value is in the order.

So this document deliberately tells you the **procedure and the bar**, and nothing about the
domain. If a sentence here seems to be withholding context you would find useful — it is. That
is the point. Do not go looking for it.

The reason these gates matter: the project's publication bar is *sweet must be cheaper **and**
solve strictly more tasks on every harness*. Four candidate mechanisms have already been
discarded on `$0` evidence, and none of the survivors raises solve. These three are the
remaining untested ideas that could.

---

## 2. Gate A — obligation graph derivation

**Question:** given only an issue and a base tree, can the required *shape* of the change be
derived before writing any code — including work that is not an edit to an existing file?

**Task:** `joshuakgoldberg__bingo-274`
**Base commit:** `aa2363da6dae89bb322beb9916358b3865bd68e4`
**Base checkout:** on the evidence box at
`/root/.ss-eval/golden/JoshuaKGoldberg__bingo@aa2363da6dae89bb322beb9916358b3865bd68e4`
(401 files). Note there are two `bingo` checkouts on the box — **use the `aa2363da` one.**
It is not present on the Mac; copy it down or work over ssh.

**Inputs you may use:** the problem statement, and the base tree. Nothing else. In particular
not the accepted patch, not the test patch, not any recorded agent attempt.

**Produce:** an obligation graph — the set of things that must be true for the requested
capability to exist and be reachable by a consumer. Node kinds to consider, all generic:

| node kind | what you must state |
|---|---|
| author a new source module | owning package, public or internal, why it cannot live in an existing file |
| add or change an export | which package's public surface, and the direction of the edge |
| preserve an overload | the signature that must keep working |
| add a type predicate or guard | what it narrows, and where it belongs |
| update a public enumeration or union | which one, and the ordering rule if any |
| prove a wrong-kind input is rejected | the input class and the expected behaviour |

For every node give **owning package, public/internal, and dependency direction.** Not every
kind will apply; asserting a kind that does not apply counts against you as much as missing one
that does.

**LOCK before revealing.** Write the graph to
`handoffs/blinded/lockA-obligations.md`, then record `shasum -a 256` of it in your results
document. Do not edit it afterwards.

**Bar.** After revealing the accepted solution:

- if it adds any new source modules, **every one** must appear in your graph with the correct
  owning package;
- **every** cross-package export or overload obligation it relies on must appear;
- documentation changes do not count in either direction;
- exact filenames are **not** required. What scores is owning module, public export, and
  dependency direction.

**Kill condition:** the derivation only reproduces paths that already exist in the base tree,
or it needs knowledge of the accepted solution to be produced.

**Rotation, required before this passes.** Repeat on two DEV-RET tasks outside the twenty listed
in §4 — chosen without looking at their solutions first. Winning only on the tuning task is
overfit, not a result.

---

## 3. Gate B — executable contract derivation

**Question:** can a discriminating, executable property be derived from an issue plus base
source, and does it separate correct from incorrect solutions?

**Tasks** — derive for **all eight**, they are a deliberate mixture and you are not told which
are which:

```
apple__swift-nio-http2-145      codeception__codeceptjs-367
dashbitco__nimble_options-43    epiforecasts__scoringutils-229
pytask-dev__pytask-210          jashkenas__underscore-2757
redboltz__mqtt_cpp-466          statamic__cms-9029
```

**Inputs you may use:** problem statement, base source tree, and the *visible* test output
recorded in the rollouts. **Not** the hidden test patch, not the accepted patch, not the grader
verdicts.

**Produce:** for each task, one or more properties expressible as a runnable check — inputs,
observations, invariants that must hold, and the axis along which a wrong solution would differ.
Write them as executable probes if you can; precise prose is acceptable where a runtime is not
available offline.

**LOCK** to `handoffs/blinded/lockB-contracts.md` and hash it.

**Then** execute each contract against the stored candidate patches for its task, in disposable
checkouts, **with the outcome labels hidden**. Only after recording each verdict do you reveal
which patches were accepted.

**Bar:** correct discrimination on at least three tasks, and **zero** rejections of a patch that
was in fact accepted. A contract that rejects a correct solution is worse than one that decides
nothing.

**Kill condition:** any contract that cannot be derived without the hidden tests or the accepted
patch. If you find yourself reasoning "the answer must be X because otherwise the task would be
trivial", you are pattern-matching on the benchmark, not deriving from the issue.

---

## 4. Gate C — referee selection over a candidate pool

**Question:** given several candidate patches for one task, can a referee pick the correct one
without seeing the labels?

**Tasks:** the same eight as Gate B. Candidate pools are the stored agent patches per task,
across arms and repetitions, plus the accepted solution — **labels stripped before you look.**

**Procedure:** define the mutation dimensions and the referee's decision rule, **lock them**, and
only then run the referee over the pools.

**LOCK** to `handoffs/blinded/lockC-referee.md` and hash it.

**Bar:** ≥80% correct selections, no rejected correct solutions, and projected cost within
budget if this were ever built.

**One methodology finding from a previous attempt, safe to know because it is about method
rather than answers:** measure candidate diversity at **added-line grain**, never by file set.
A prior pass measured which files each patch touched, concluded the pools were degenerate, and
killed the candidate. That conclusion was **withdrawn** — two patches touching the same file
routinely encode different choices, and at line grain most pools are in fact diverse. Do not
repeat that error, and do not trust a diversity metric you have not inspected by hand on one
pool.

**Known limitation, stated so you do not rediscover it as a finding:** on the tasks where every
stored agent patch failed, the best a referee restricted to those patches can do is pick the
least-wrong one. The interesting question is whether the referee can *rank* them sensibly, not
whether selection alone flips an outcome.

---

## 5. Environment

**Evidence box:** `ssh root@167.233.69.121`. Read-only in the sense that matters: **do not
launch pilots, do not spend money, do not mutate `results/`.** Copying files in either direction
is fine. Disk was 55G free on 2026-08-13; abort if it drops below 12G. Another agent may be
using the host, so never run two pilots concurrently.

**Run an analysis without writing to the host:**

```bash
ssh root@167.233.69.121 'node -' < your-script.mjs
```

**Artifacts you will need:**

| what | where |
|---|---|
| base checkouts | `/root/.ss-eval/golden/<repo>@<commit>/` — 456 on the box, 76 on the Mac at `~/.ss-eval/golden/` |
| recorded patches | `<RUN_ID>/preds-<arm>.jsonl` — untruncated `model_patch` |
| per-rollout rows | `<RUN_ID>/rows.json` |
| visible test output | raw transcripts under `<RUN_ID>/agent-state/<task>-<arm>/…` |
| grader logs | `<RUN_ID>/<arm>/logs/<task>_log.txt` |

`<RUN_ID>` ∈ `sb-codex-20260811`, `sb-opencode-20260811`, `sb-claudecode-20260811`, each 17
tasks × 2 arms × 2 reps, all under
`/root/sweet-search-private/eval/task-completion-bench/results/`.

**Never infer absence from `trajectories/`** — results truncate at 600 characters and inputs at
200. Read the raw JSONL, or use `/root/dump-trace.mjs`.

**The twenty-task cohort**, for orientation only — `eval/task-completion-bench/select/tasks_luna_rotate20.json`
holds instance IDs, languages and base commits, and **contains no gold**. It is safe to read.
The file at `select/.cache/tasks_full_luna_rotate20.json` **does** contain gold and is the
reveal artifact, not an input.

---

## 6. Reveal protocol

Only after **all three lock files exist and their hashes are recorded**:

1. Read the accepted patch and test patch for each task from
   `select/.cache/tasks_full_luna_rotate20.json` on the box.
2. Score each gate against its bar, exactly as written above. **Do not soften a bar after
   seeing a result.** A near miss is a miss; record the number.
3. *Now* you may read `eval/task-completion-bench/handoffs/improve/PHASE-1-RESULTS.md` and
   `SLATE-A-UBER.md`, to reconcile your findings with the seven gates already run. Note in your
   results where you agree and where you differ.

---

## 7. Standing constraints

- **Spend `$0`.** Every gate here is deterministic derivation and replay over artifacts that
  already exist. If a step seems to need a model rollout, you have misread it.
- **HO2 is frozen.** Never run it, never inspect per-query results from it. DEV-RET only.
- **Never use `ss-*` commands to develop sweet-search.** Native file tools only. Running `ss-*`
  as the system under test against a non-sweet-search corpus, with scripted assertions, is
  testing and is fine.
- **The working tree is dirty** — roughly 30 files belong to concurrent daemon and maintainer
  work. Do not revert, stash or clean them. If you must commit a file that mixes your work with
  theirs, stage by hunk: `git diff -U3 <file>`, filter, `git apply --cached`. Zero-context
  (`-U0 --unidiff-zero`) mis-places hunks.
- **Git:** solo project, commit direct to `main`, no feature branches, and only when asked.
- **Never route the Sol model through OpenRouter** — metered at roughly 50× subscription cost.

---

## 8. Deliverable

`eval/task-completion-bench/handoffs/blinded/BLINDED-GATE-RESULTS.md`, containing:

1. **The blinding declaration and the three lock hashes, first, before any result.**
2. Per gate: the bar as quoted from this document, what you derived, what the reveal showed,
   and **PASS / FAIL** with the specific number that decided it.
3. For Gate A, the rotation result on two tasks outside the twenty.
4. A short section on what should happen next — and be willing to write "nothing here survives",
   because four candidates have already died on gates like these and that is the system working.

**Do not implement anything you find.** Implementation is a separate decision, taken after this
document is read.

---

## 9. One last note on method

The session that ran the other seven gates recorded this, and it is the most useful thing it
learned: **sweep the shape of a mechanism, not one parameter of it.** Its second pass — which
cost nothing — reversed one kill outright, and materially restated two others. Before you write
FAIL, ask whether you tested the mechanism or merely one configuration of it.

And its other lesson, which is why this brief exists at all: **keep the answer out of the
specification.** A gate that prints its own solution can be run exactly once, by the person who
wrote it, and never again.
