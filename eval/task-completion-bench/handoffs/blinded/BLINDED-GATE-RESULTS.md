# BLINDED GATE RESULTS — three derivation gates

**Run:** 2026-08-13. **Spend: `$0`.** No model rollouts, no paid calls, no pilots. Every number
below comes from deterministic replay over artifacts that already existed.

---

## 0. Declaration and lock hashes

> I did not open `handoffs/improve/`, the named memory files, or any `tasks_full_*.json` before
> writing and hashing my lock files.

```
3daea0b40d65777a7cd2814ee737d8eecfecff311c74401d6d25ed53a350d08d  lockA-obligations.md
62b911c00a96330ef08b1b8d130acb814782733d2c6dfcc001627ee9ef4b40fe  lockB-contracts.md
742646c4c973cc9c0cfe9a01b3077bada92ee9081cd410de0e3c79aefdd37659  lockC-referee.md
```

### 0.1 One contamination, declared before the results

The declaration above is true as written. It is not the whole truth, and the gap matters.

The session memory index (`MEMORY.md`) loads automatically at session start — **before** the brief
was read, and therefore before its blinding rule could be obeyed. That index carries a one-line
hook for two of the three forbidden memory files. One of those lines is about Gate A's tuning task:

> `no-retrieval-headroom` — rotate20 ~zero retrieval headroom; **bingo-274 files don't exist at base**

That sentence pre-confirms the answer to Gate A's central question on `joshuakgoldberg__bingo-274`:
that the accepted solution authors modules absent from the base tree. The memory file itself was
never opened, and no line named the two rotation tasks or any Gate B/C task.

**Consequence, applied throughout:** the `bingo-274` result is reported but **not counted as
evidence**. Gate A's verdict rests on the two rotation tasks, which the leak does not touch. Gates B
and C are unaffected.

### 0.2 One input I refused, which made the gates harder

The brief permits the visible `run_tests` output recorded in the rollouts as a Gate B input. I did
not read it, for any task. `run_tests` runs the canonical suite, so its recorded output can name the
grader's own fail-to-pass tests — and a contract shaped by those names is a contract read off the
answer, which is this gate's kill condition. Every contract was derived from issue text and base
tree alone.

### 0.3 A label correction that changed the results

My first scoring pass took per-candidate correctness from `<RUN>/<arm>/report.json`. That source
disagrees with the run ledger `rows.json` on **32 of 96 rows**, always in one direction
(`report.json` says fail, `rows.json` says resolved with `f2pFrac=1`). `report.json` predates the
grader repairs; `rows.json` `resolved` is authoritative. Every number below uses `rows.json`.

Under the wrong labels Gate C scored 2/8. Under the correct labels it scores 5/8. Both fail, but
the failure has a different shape, so the correction is recorded rather than quietly applied.

---

## 1. Gate A — obligation graph derivation

> **Bar.** After revealing the accepted solution: if it adds any new source modules, **every one**
> must appear in your graph with the correct owning package; **every** cross-package export or
> overload obligation it relies on must appear; documentation changes do not count in either
> direction; exact filenames are **not** required. What scores is owning module, public export, and
> dependency direction.
>
> **Rotation, required before this passes.** Repeat on two DEV-RET tasks outside the twenty listed
> in §4 — chosen without looking at their solutions first.

### 1.1 Rotation task selection, fixed before inspection

Of the 200 DEV-RET tasks in `select/tasks_heldout.jsonl`, 28 lie outside `tasks_luna_rotate20.json`
**and** have both a recorded rollout (so the issue text is recoverable at `$0`) **and** a golden
base checkout on the box. Rule locked before opening any of them: sort `instance_id` ascending, take
indices `floor(n/3)` and `floor(2n/3)`; n=28 → 9 and 18 → `holoviz__holoviews-6534` and
`pennylaneai__pennylane-3651`.

### 1.2 Rotation task 1 — `holoviz__holoviews-6534`

**Derived (lock A, nodes H1–H5):** no new source module; no export or public-surface change; one
guard added inside the existing private method `CDSCallback._process_msg`; the guard must establish
`values[2]` is a `str` **before** the membership test, because `in` on a numpy array is what raises;
wrong-kind input must **fall through unchanged, not raise**; the existing byte-order decode path
must survive. Four of six node kinds asserted **not** to apply.

**Accepted solution:** one file, `holoviews/plotting/bokeh/callbacks.py`, one added line:

```python
+                and isinstance(values[2], str)
```

**Score:** new modules 0/0. Cross-package export or overload obligations 0/0. Every kind asserted
to apply, applied; every kind asserted not to apply, did not. **PASS.**

### 1.3 Rotation task 2 — `pennylaneai__pennylane-3651`

**Derived (lock A, nodes P1–P6):** the load-bearing node is *update a public enumeration* —
`DefaultMixed.operations` in `pennylane/devices/default_mixed.py`, public, **ordering rule: none**
because it is a `set` literal. No export change, no new module. Node P6, filed at **low confidence**
and justified only by the task's 127 failing tests: *"if the repo carries a parallel list … the same
string must be added there too, or support is inconsistent."*

**Accepted solution:** `"SpecialUnitary"` added to `DefaultMixed.operations` **and** to
`NullQubit.operations` in `pennylane/devices/null_qubit.py`. Remaining files are a changelog entry
and two docstring typo fixes in `special_unitary.py` — documentation, which does not count.

**Score:** new modules 0/0. Export/overload obligations 0/0. The primary enumeration node is exact.
The second enumeration — the one thing a single-file reading would have missed — was in the graph,
found by reasoning from the failing-test count rather than from the answer. **PASS.**

### 1.4 Tuning task — `joshuakgoldberg__bingo-274` — reported, not counted

**Accepted solution, non-documentation files:**

| file | kind |
|---|---|
| `packages/bingo-fs/src/isFile.ts` | **new module** |
| `packages/bingo-fs/src/index.ts` | **new runtime export** `export * from "./isFile.js"` |
| `packages/bingo-handlebars/src/handlebarsDirectory.ts` | **new module** |
| `packages/bingo-handlebars/src/handlebarsFile.ts` | **new module** |
| `packages/bingo-handlebars/src/executeTemplatesRecursive.ts` | three overload declarations added |
| `packages/bingo-handlebars/src/handlebars.ts` | `!source` → `source === undefined` |

| lock A node | outcome |
|---|---|
| A1, A2 — two new public modules in `bingo-handlebars` | **correct** |
| A4 — type predicate, primary claim **`bingo-fs`, public**, direction `bingo-handlebars` → `bingo-fs`, must decide four cases including `false` and `undefined` | **correct** — gold is `isFile.ts` in `bingo-fs`, and **ten of the twelve** failing tests are `isFile` cases, including the `false` and `undefined` arms the lock names |
| A5 — `bingo-fs/src/index.ts` must gain a **runtime** export, flagged in the lock as "the cross-package export obligation most likely to be missed" | **correct**, and it is the third new module |
| A6 — `handlebars()` signature and thrown message preserved | correct |
| A7 — wrong-kind input throws | correct, both directions |
| A8 — return type narrowed at the boundary so `as CreatedDirectory` disappears | correct in substance; gold's **mechanism** is an overload set on the internal `executeTemplatesRecursive`, which I did not name |
| "update a public enumeration or union" asserted **not** to apply | correct |
| A3 — `bingo-handlebars/src/index.ts` would change | **wrong.** Gold never exports the new functions from the package index |
| A9 — `loadHandlebars` variants, filed at low confidence | **wrong.** Not in gold |

All three new modules appear with the correct owning package, and the cross-package export
obligation appears. Under the bar this passes. **It is not counted**, per §0.1.

### 1.5 Gate A verdict

**PASS** — 2/2 on uncontaminated rotation, 3/3 new modules and 1/1 cross-package export on the
contaminated tuning task.

**The limitation, stated plainly.** Both rotation tasks are edit-an-existing-file tasks. They test
*precision* — correctly declining four and five of the six node kinds — and on `pennylane` they test
recall of a second enumeration. Neither tests recall of **absent modules**, which is the capability
that would resolve `bingo`. The only test of that capability is the contaminated one. A clean
replication needs a rotation task whose accepted solution authors a new module, chosen blind.

---

## 2. Gate B — executable contract derivation

> **Bar:** correct discrimination on at least three tasks, and **zero** rejections of a patch that
> was in fact accepted. A contract that rejects a correct solution is worse than one that decides
> nothing.

Pools: 12 stored agent patches per task (3 harnesses × 2 arms × 2 reps) plus the accepted solution,
13 candidates, opaque IDs assigned by content hash, provenance sealed until reveal. All 104
candidates applied.

**Validity control, run before the reveal.** Every contract was executed against the *unpatched*
base tree. None returned ACCEPT. Two — the runtime ones — returned REJECT on the base, which is the
strongest form. No contract is vacuous.

### 2.1 Result

| task | pool correct | ACC-correct | ACC-wrong | REJ-wrong | REJ-correct | UNDECIDED | discriminates |
|---|---:|---:|---:|---:|---:|---:|:--:|
| `apple__swift-nio-http2-145` | 1/13 | 1 | **5** | 0 | 0 | 7 | no |
| `codeception__codeceptjs-367` | 1/13 | 1 | **4** | 0 | 0 | 8 | no |
| `dashbitco__nimble_options-43` | 2/13 | 2 | **6** | 0 | 0 | 5 | no |
| `pytask-dev__pytask-210` | 5/13 | 5 | **8** | 0 | 0 | 0 | no |
| `jashkenas__underscore-2757` | 9/13 | 9 | 0 | 0 | 0 | 4 | **yes** |
| `epiforecasts__scoringutils-229` | 13/13 | 11 | 0 | 0 | **1** | 1 | n/a |
| `redboltz__mqtt_cpp-466` | 13/13 | 13 | 0 | 0 | 0 | 0 | n/a |
| `statamic__cms-9029` | 13/13 | 5 | 0 | 0 | 0 | 8 | n/a |

**Discriminating tasks: 1 of 8. Bar: ≥3. Rejections of an accepted patch: 1. Bar: 0.**

Three pools are all-correct, so discrimination is not defined there. On the five pools where it is
defined, the score is **1 of 5**.

### 2.2 Gate B verdict: **FAIL**, on both clauses independently

### 2.3 The one success, and why it succeeded

`jashkenas__underscore-2757` discriminated perfectly: nine ACCEPT, all nine correct; four
UNDECIDED, all four wrong; zero errors either way. The four it declined fixed `_.groupBy` only and
left `_.countBy` broken. The grader's fail-to-pass set is `["groupBy", "countBy"]` — precisely the
observables my probes P1 and P3 test, derived from the base tree alone by noticing that both call
sites use the same widened `_.has`.

This is the shape that works: **a runtime probe over an observable named in the issue.**

### 2.4 The rejection of an accepted patch — a translator defect, not a contract defect

`epiforecasts__scoringutils-229`, candidate K07, labelled resolved, contract REJECT.

K07 hoists a new variable computed before the filter:

```r
+  all_length_one <- length(vars) > 0 && all(lengths == 1)
-  if (length(unique(lengths)) != 1) {
+  if (length(unique(lengths)) != 1 && !(one_allowed && all_length_one)) {
```

Lock B translates the extracted guard to an evaluable predicate and refuses to decide when it
cannot translate. The refusal check tested for untranslated **function calls** and not for
untranslated **free identifiers**. `one_allowed` and `all_length_one` survived translation as
undefined names, evaluation threw, test T3 read the throw as "does not error", and the REJECT arm
fired. The contract's stated semantics were right; its implementation of "translate the guard" was
unsound.

Repairing that — unresolved identifier → UNDECIDED — takes false rejections from 1 to 0. It does
**not** rescue the gate: `scoringutils` is an all-correct pool, so discrimination there stays
undefined and the count stays 1 of 8 against a bar of 3. Recorded because the brief asks whether the
mechanism or one configuration of it was tested. Here it was one configuration, and fixing it
changes one clause and not the verdict.

### 2.5 The three failure modes, which are the actual finding

**(a) A static contract encodes a repair *shape*; the accepted patch often uses a different one.**
On `scoringutils` the accepted solution does not touch the guard at all — it returns early inside
the `one_allowed` block:

```r
+    if (all(lengths == 1)) {
+      return(invisible(NULL))
+    }
```

My contract inspected only the guard, so it under-decided on the very patch it was built to
recognise. Same on `statamic`: gold landed in tier B. Static contracts that name a mechanism cannot
see a fix that arrives by a different route.

**(b) Robustness that erases the discriminating axis.** On `pytask-dev__pytask-210` the contract
ACCEPTed all thirteen candidates while only five are correct. The accepted solution changes the
signature to `_is_internal_or_hidden_traceback_frame(frame, exc_info)`, threads `exc_info` down from
`remove_internal_traceback_frames_from_exc_info`, and calls `is_hidden(exc_info)`. The grader's one
failing test is `test_hide_traceback_from_error_report[lambda...]`. My probes deliberately used
`lambda *args, **kwargs` so the contract would not assume an arity — and that choice made the probe
blind to *what the callable is handed*, which is the whole task. **The robustness measure destroyed
the discrimination.** This is the generalisable lesson: a probe made insensitive to an interface
detail cannot test a change whose content is that interface detail.

**(c) The issue can name one code path and the accepted patch fix its mirror.**
`apple__swift-nio-http2-145` is the clean case. The issue describes a client **receiving** a
PUSH_PROMISE in `halfClosedLocalPeerIdle`, quotes the error `receivePushPromise` returns, and names
that state. The accepted patch never mentions `receivePushPromise`. It relaxes **`sendPushPromise`**,
adding `.halfOpenRemoteLocalIdle` and `.halfClosedRemoteLocalIdle` to the server's accepting list;
the failing tests are `testSimpleServerPush` and two `testAllowPushPromiseBeforeReceivingHeaders*`.
My derivation followed the issue exactly and aimed at the wrong direction. It ACCEPTed five patches
that relaxed the receive side and are all wrong. Had my locked REJECT arm — "reject if the only edit
is inside `sendPushPromise`" — been reached, gold would have been rejected outright. It was not
reached only because an earlier clause returned UNDECIDED first. **The safety rule saved this gate
from a second false rejection by luck, not by design.**

---

## 3. Gate C — referee selection over a candidate pool

> **Bar:** ≥80% correct selections, no rejected correct solutions, and projected cost within budget
> if this were ever built.

On eight tasks, ≥80% means at least 7 of 8.

### 3.1 The methodology finding, independently confirmed

Diversity was measured at added-line grain, never file set, and one pool was inspected by hand
before any conclusion was drawn from the metric.

Hand inspection of `jashkenas__underscore-2757`: all thirteen candidates touch exactly one file,
`underscore.js`. **At file-set grain the pool is perfectly degenerate.** At added-line grain there
are three genuinely different choices — one candidate introduces an internal shallow `has()` and
swaps all eight internal call sites while keeping the public path-aware `_.has`; four fix `groupBy`
alone; eight fix `groupBy` and `countBy`. The automated metric reported `distinctAddedSets=3`,
median pairwise Jaccard 0.5, which matches the hand reading exactly.

No pool of the eight is degenerate. Distinct added-line sets range from 2 to 13 of 13.

### 3.2 Result

| task | pool correct | ranked | rank-1 correct | gold's rank |
|---|---:|---:|:--:|---|
| `apple__swift-nio-http2-145` | 1/13 | 6 | ✗ | 6/6 — **last** |
| `codeception__codeceptjs-367` | 1/13 | 5 | ✗ | 5/5 — **last** |
| `dashbitco__nimble_options-43` | 2/13 | 8 | ✓ | 2/8 |
| `epiforecasts__scoringutils-229` | 13/13 | 11 | ✓ | not ranked — contract put gold in tier B |
| `pytask-dev__pytask-210` | 5/13 | 13 | ✗ | 13/13 — **last** |
| `jashkenas__underscore-2757` | 9/13 | 9 | ✓ | 9/9 — **last** |
| `redboltz__mqtt_cpp-466` | 13/13 | 13 | ✓ | 13/13 — **last** |
| `statamic__cms-9029` | 13/13 | 5 | ✓ | not ranked — contract put gold in tier B |

**Correct selections: 5 of 8 = 62.5%. Bar: ≥80% = 7 of 8.**
**Accepted patches eliminated at step 1: 1.** Bar: 0. (The `scoringutils` false reject of §2.4,
inherited.)

Three of the five successes come from all-correct pools where any pick wins. On the five pools with
a genuine choice to make, the referee scores **2 of 5 = 40%**.

### 3.3 Gate C verdict: **FAIL**, on both clauses

### 3.4 The finding that is worth more than the verdict

**The referee ranked the accepted solution *last* in 5 of the 6 pools where it ranked gold at all.**

This is not noise, it is the scoring rule working as specified. Two of its three terms are actively
anti-correlated with being the maintainer's patch:

- **consensus** rewards agreeing with other candidates. Gold is one patch among thirteen and the
  twelve agents converge on each other, not on it. On `underscore`, gold is the only candidate that
  introduces an internal `has()` and repairs all eight call sites; its consensus term is 0 while
  eight look-alike patches score high.
- **parsimony** rewards small diffs. Gold is routinely the *largest* correct patch, because
  maintainers fix the class of bug and agents fix the instance.

Any referee built on agreement and minimality will systematically prefer the popular small edit over
the correct thorough one. That is a property of the objective, not of this implementation, and no
amount of weight tuning removes it — reversing the sign would simply prefer large lonely patches.

**Cost.** The `$0` rule as built costs nothing and misses the bar by 17.5 percentage points overall
and 40 points on contested pools. A model-based referee over these pools projects to roughly 30k
input and 4k output tokens per task. That is the spend a model version would have to justify, and it
would have to close a 40-point gap on exactly the pools where consensus and parsimony mislead.

---

## 4. Reconciliation with the seven gates already run

Read after all three locks were hashed, per §6 of the brief.

**Where I agree.**

- **The withdrawn degeneracy finding was right to withdraw.** `PHASE-1-RESULTS.md` §11.5 replaced
  file-set diversity with added-line diversity and reversed its own kill. My independent hand
  inspection of the `underscore` pool reproduces that exactly: one file, three real choices. Do not
  cite "degenerate pool" against a referee candidate.
- **C-6's premise holds and is now measured uncontaminated.** §7.1 established that the three
  `bingo` modules are absent at base and that no stored patch creates a file. My Gate A adds the
  part that matters: the derivation recovers not just the two obvious `bingo-handlebars` modules but
  the third module in `bingo-fs` **and** the runtime export that publishes it — which is the piece
  every agent patch misses, since all of them define the two functions inside the existing file.
- **The blocked-blinding diagnosis was correct and the prescribed remedy works.** §7's unblock
  option 2 was "move the exercise to DEV-RET tasks outside `rotate20`". That is what Gate A's
  rotation did, and it produced 2 clean passes.

**Where I differ.**

- **"On every one of these tasks all eight stored patches fail" does not hold on the three-harness
  pool.** Over 12 agent patches per task (3 harnesses × 2 arms × 2 reps), labelled from `rows.json`:
  `mqtt_cpp` 12/12 correct, `statamic` 12/12, `scoringutils` 12/12, `underscore` 8/12, `pytask`
  4/12, `nimble` 1/12, `swift-nio` 0/12, `codeceptjs` 0/12. The blanket statement is true for two of
  my eight tasks. The prior claim was made over a smaller pool; on the full pool the "perfect referee
  still selects a loser" argument applies to `swift-nio` and `codeceptjs` only.
- **C-8 now has a killing fact, and it is not the one that was withdrawn.** The pool is diverse, as
  §11.5 says. The referee still fails — 62.5% against 80%, 40% on contested pools — because
  consensus and parsimony rank the accepted patch last 5 times in 6. That is a new, measured
  objection to the *referee*, not to the pool.
- **C-7's own example contract was better than the one I derived.** `SLATE-A-UBER` §5 C-7 lists
  *"callable receives current `exc_info`"* — which is exactly the axis the accepted `pytask` patch
  turns on, and exactly the axis my arity-agnostic probe erased. On `pytask` the specification was
  right and my execution blunted it. That is evidence a sharper contract could discriminate there;
  it is not evidence the gate passed, and I have not softened the bar to accommodate it.
- **`SLATE-A-UBER` §5 C-7's third example — "HTTP/2 send and receive behavior must be symmetric" —
  is the one that would have caught `swift-nio`.** My derivation read the issue literally and aimed
  at receive. Gold fixes send. A symmetry contract spans both.

---

## 5. What should happen next

**Two of the three candidates are dead at `$0` in the shapes tested. One survives and is the only
one that ever cleared its bar.**

### 5.1 Gate A / obligation graphs — the survivor. Replicate before building.

The graph recovered every new module with the right owning package, the cross-package runtime
export, and the correct declining of node kinds on both rotation tasks. It is the only mechanism
here that produced information an agent did not already have: the `bingo-fs` module and its export
are precisely what all twelve stored `bingo` patches miss.

Before any implementation, run **one more rotation task whose accepted solution authors a new
module**, chosen blind by the same fixed index rule from the DEV-RET pool. Until that exists, the
absent-module recall claim rests on a contaminated task and must not be published. That replication
costs `$0`.

### 5.2 Gate B / executable contracts — dead in the static shape, not yet tested in the right one

The verdict is FAIL and stands. But the mechanism was not swept, only one configuration of it was,
and the evidence points somewhere specific:

- the single discriminating contract was a **runtime probe over an observable named in the issue**;
- every static, mechanism-shaped contract either under-decided or accepted wrong patches;
- the one contract that ACCEPTed everything did so because a robustness choice erased its axis.

If this is revisited, the sweep is: **runtime probes only, with probes that pin interfaces rather
than tolerate them.** Three of the eight contracts already ran at runtime — `underscore`, `pytask`,
`codeceptjs` — and only one discriminated, so runtime execution is necessary and not sufficient. The
offline runtimes available on the box cover node and python only; the other five tasks need PHP, R,
Elixir, Swift or Boost, none of which is installed. That bounds the mechanism's reachable exposure
at roughly a third of tasks even before its hit rate is counted, which is the honest reason to say
the contract compiler cannot carry the solve bar by itself, whatever its shape.

### 5.3 Gate C / referee selection — dead, and the objection is structural

Do not tune the weights. Consensus rewards agreeing with the crowd and parsimony rewards small
diffs; the accepted patch is usually neither. A referee that selects on those terms will keep
ranking the maintainer's fix last. Reversing the objective does not help. Any future referee must
score against a **derived observable** rather than against the other candidates — which makes it a
Gate B contract in a different costume, and Gate B failed.

There is no usable residue, and the tempting one does not survive checking. Across all eight tasks
the elimination step fired **exactly once** — on `scoringutils` K07 — and that one firing removed a
**correct** candidate. So the filter reading is: it removed nothing on seven tasks and the wrong
thing on the eighth. Tiering also left 5 to 13 survivors per pool, so even a sound filter would not
narrow a pool enough to matter.

### 5.4 Willing to write it

Two of three candidates die here, and the third needs one more `$0` replication before it can be
believed. Combined with the four already discarded, that is five of seven mechanisms killed on
deterministic evidence and none of the survivors yet shown to raise solve. On the publication bar —
cheaper **and** strictly more solves on every harness — **nothing in this document clears it, and
`bingo`-style absent-code authoring remains the only path that might.**

---

## 6. Reproduction

All work ran on the evidence box, read-only with respect to `results/`. No pilots, no writes to
`results/`, disk unchanged.

| artifact | path |
|---|---|
| candidate pools, opaque IDs | `/root/blinded-work/pools/<task>/K??.patch` |
| sealed identity map | `/root/blinded-work/SEALED-identity.json` |
| contract verdicts incl. base control | `/root/blinded-work/contract-verdicts.json` |
| referee ranking | `/root/blinded-work/referee-ranking.json` |
| revealed join | `/root/blinded-work/REVEALED.json` |

Scripts are archived in `handoffs/blinded/scripts/` and were each run as
`ssh root@167.233.69.121 'node -' < <script>`, in this order:

1. `pick-rotation.mjs` — DEV-RET rotation candidates for Gate A
2. `get-issues.mjs` — issue text out of recorded rollouts
3. `build-pools.mjs` — pool construction; **reads gold so the analyst does not**
4. `run-contracts.mjs` — Lock B contracts plus the unpatched-base validity control
5. `referee.mjs` — Lock C referee and diversity metrics
6. `reveal.mjs` — label join and gate scoring
7. `final-stats.mjs` — pool composition and gold-rank statistics

Labels come from `rows.json` `resolved`, not `report.json` — see §0.3.
