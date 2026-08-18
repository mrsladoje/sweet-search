# Round 3 — deviation from the frozen claim, and why

`NARROWED-CLAIM.md` is **frozen and unedited**. Its hash is unchanged:
`33c9e3aa3c161c9703322abe712a8586c5c4cfa28bfe86f1013eadb8200377d6`. This file records the one
parameter of §4 that could not be honoured as written, what was changed instead, and what was
deliberately **not** changed.

---

## 1. What changed: the pool, and nothing else

| §4 parameter | frozen value | actual | changed? |
|---|---|---|---|
| seed | `20260901` | `20260901` | **no** |
| slate | 3 with a new source module + 2 without | 3 + 2 | **no** |
| bar | §3, five requirements | §3, five requirements | **no** |
| picker | `pick-newmodule-slate.mjs` | same | **no** |
| **pool** | `select/.cache/tasks_full_heldout.json` (200 development tasks) | **`select/.cache/tasks_full_round3_pool.json`** — those 200 **plus 68 untouched reserve tasks** | **yes** |

The bar was not softened, the seed was not re-rolled, and the with/without split was not reduced.
Only the pool was widened, and only because the frozen pool could not fill the frozen slate.

## 2. Why the frozen pool could not fill the frozen slate

§4 excludes "every task any planning document discusses". Enforcing that literally — which is
what `LEAK-SWEEP.md` did — leaves the 200-task development pool with **two** tasks that add a new
source module, against a requirement of three:

| exclusion, applied in order | tasks removed |
|---|---:|
| `rotate20` | 13 |
| round-1 subjects and the round-2 slate | 6 |
| **run by the turnfix programme** (`MANIFEST_turnfix_cohorts.json`) | 94 |
| **discussed in a prose document** (forensics, plans, results) | 12 |
| **a repository one of those already exposed** | 6 |
| **base tree cannot be obtained** | 1 |
| issue statement too short to derive from | 10 |

The decisive one is the prose rule. A forensics write-up names one candidate **and the exact new
packages its hidden test imports** — which is precisely the obligation this gate asks the deriver
to predict. Leaving that task in would have been handing over an answer key for a fifth of the
slate.

## 3. Why widening the pool is the smallest available deviation

Three options existed, and each breaks something in §4:

| option | what it costs |
|---|---|
| draw 2 + 3 instead of 3 + 2 | tests requirement 1 on two tasks instead of three — **a weaker bar**, which is the one thing the freeze exists to protect |
| wait for a fresh stratified set | the pre-registered strength is kept, at the cost of leaving C-6 unresolved indefinitely |
| **widen the pool** ← taken | the frozen pool name is not honoured; the bar, the seed and the split all are |

The added tasks come from `tasks_full_heldout_reserve.json` — reserve tasks materialised
alongside the development set and **never used by anything**: not in the development pool, not in
the run history, not in the turnfix cohorts, not discussed in any document, and not in a
repository any of those exposed. They are development-side, so **HO2 is untouched and its own
reserve was deliberately not used**, because those tasks are earmarked for the frozen held-out
set.

**Nothing had been derived when this decision was taken.** No result had been seen, so nothing
could be tuned to. The decision was taken by the project owner, not by the session, and it was
taken before the slate that follows from it existed.

## 4. What a reader should discount

- The pool is **not** the one named in the frozen document. A reader who wants the literal
  pre-registration should read this round as "3 + 2 at seed 20260901 from a 268-task pool", and
  compare it to round 2 knowing that round 2's pool was narrower and, as `LEAK-SWEEP.md` §2
  records, **contained two tasks another programme had already run**.
- Reserve tasks were materialised at the same time and by the same procedure as the development
  set, so they are not a different population in any way this gate can detect. That is an
  argument, not a measurement.
- One golden base tree carries a stray `.vault-manifest.sha256` at its root — a bench bookkeeping
  file, in no repository. It is noise, not signal.

## 5. A defect found while materialising, worth its own line

`harness/golden-build.mjs` runs `git checkout <base_commit>` **without checking that it
succeeded.** When a base commit is unreachable in a default clone — deleted branch, force-push,
unpreserved pull-request head — the checkout fails, the script proceeds, and the fresh-init
captures the repository's **default branch**: a post-fix tree, under a directory name that claims
to be the base commit.

One task on the first augmented draw was exactly that case; it is recorded in
`picker/UNMATERIALISABLE.json` and excluded. **Every base tree used by this round was rebuilt
with an explicit `git rev-parse HEAD` check against the intended commit before its history was
stripped**, and the two trees that already existed on the evidence box were byte-compared against
freshly verified clones: one identical, one identical but for the stray manifest file above.

The harness defect itself is **not fixed here** — it is outside this session's scope — but any
golden built before 2026-08-13 should be treated as unverified until it is checked the same way.
