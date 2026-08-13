# LOCK C — referee over a candidate pool, defined before reveal

**Written:** 2026-08-13. Same eight tasks as Lock B. Locked before any pool was opened and
before any label, provenance or gold patch entered the analysis.

---

## 1. Pool construction

Per task, the pool is every stored agent patch across harnesses, arms and repetitions —
3 harnesses (`sb-codex-20260811`, `sb-opencode-20260811`, `sb-claudecode-20260811`) × 2 arms
(native, sweet) × 2 reps, read from `<RUN>/<arm>/patches.json` and
`<RUN>/<arm>/rep-1/patches.json` — **plus the accepted solution**, for up to 13 candidates.

**How gold enters without breaking blinding.** The lock files are written and hashed first. A
script then reads the accepted patch, shuffles it into the pool under an opaque ID, runs the
referee, and prints only opaque IDs with scores. The referee is a deterministic program, so it
can read gold without the analyst reading gold. The identity map is written to a sealed file
that is opened only at reveal. Empty patches and patches that do not apply are dropped and
counted.

Opaque IDs are assigned by sorting candidates on `sha256(patch_text)` — content-derived, so
neither arm, harness, rep nor gold occupies a predictable slot.

---

## 2. Mutation dimensions

The dimensions along which two candidates for the same task are held to differ. All are computed
from the unified diff, **at added-line grain**, never at file-set grain — per the methodology
finding in the brief, two patches touching the same file routinely encode different choices.

| dimension | definition |
|---|---|
| **D1 added-line content** | multiset of added lines, normalised: leading/trailing whitespace collapsed, blank lines dropped, comment-only lines dropped |
| **D2 removed-line content** | same normalisation over removed lines |
| **D3 edit sites** | set of `(file, hunk-anchor-symbol)` pairs, where the anchor is the nearest preceding declaration line |
| **D4 breadth** | number of distinct non-test files touched |
| **D5 magnitude** | total added + removed lines |
| **D6 test-file contact** | whether any path under a test directory is modified |

**Diversity metric.** For candidates *a*, *b*: `J(a,b) = |D1a ∩ D1b| / |D1a ∪ D1b|` over the
normalised added-line multisets. A pool is **degenerate** iff every pair has `J ≥ 0.95`.
Reported per task, and **inspected by hand on one pool** before any conclusion is drawn from it.

---

## 3. Referee decision rule

Deterministic. No model call — the whole gate runs at `$0`.

**Step 0 — admissibility.** Drop candidates that are empty or fail to apply to the base
checkout. Record how many.

**Step 1 — contract tiering.** Run the task's Lock B contract on each admissible candidate.

- verdict `REJECT` → **eliminated**
- verdict `ACCEPT` → **tier A**
- verdict `UNDECIDED` → **tier B**

The referee scores only the best non-empty tier: tier A if it is non-empty, otherwise tier B.
Elimination is the only way the referee discards a candidate, so *"no rejected correct
solutions"* is measured as: no candidate that turns out to be accepted was eliminated at Step 1.

**Step 2 — scoring within the surviving tier.** For candidate *c* in a surviving tier of size
*m*, drawn from an admissible pool of size *n*:

- `consensus(c)` = (number of admissible candidates *d ≠ c* with `J(c,d) ≥ 0.60`) / (n − 1)
- `locality(c)` = fraction of *c*'s changed lines that fall in the task's **issue-implicated
  file set** — fixed below, derived in Lock B from issue text and base tree alone
- `parsimony(c)` = 1 / (1 + log10(1 + D5(c)))
- `penalty(c)` = −1.0 if D6(c) is true, else 0

`score(c) = 2.0·consensus + 2.0·locality + 1.0·parsimony + penalty`

Weights are locked here and are not tuned after any result is seen.

**Step 3 — selection.** Rank by `score` descending. Ties break on smaller D5, then on the
lexicographically smaller opaque ID. The referee's **selection** is rank 1. The full ranking is
reported, because the brief's stated interesting question is whether the referee ranks sensibly,
not only whether rank 1 is right.

### Issue-implicated file sets (locked)

| task | paths |
|---|---|
| `apple__swift-nio-http2-145` | `Sources/NIOHTTP2/StreamStateMachine.swift`, `Sources/NIOHTTP2/ConnectionStateMachine/**` |
| `codeception__codeceptjs-367` | `lib/actor.js`, `lib/output.js`, `lib/recorder.js`, `lib/step.js` |
| `dashbitco__nimble_options-43` | `lib/nimble_options.ex`, `lib/nimble_options/**` |
| `epiforecasts__scoringutils-229` | `R/input-check-helpers.R` |
| `pytask-dev__pytask-210` | `src/_pytask/traceback.py`, `src/_pytask/debugging.py` |
| `jashkenas__underscore-2757` | `underscore.js`, `modules/**` |
| `redboltz__mqtt_cpp-466` | `include/mqtt/**` |
| `statamic__cms-9029` | `src/Licensing/Outpost.php`, `src/Licensing/**` |

Each set is the file named or unambiguously implicated by the issue, plus its immediate
neighbours. None was chosen after seeing a patch.

---

## 4. Bar, as quoted from the brief

> ≥80% correct selections, no rejected correct solutions, and projected cost within budget if
> this were ever built.

On eight tasks, ≥80% means **at least 7 of 8** selections correct. Tasks where the accepted
solution is the only correct candidate in the pool still count: the referee must select it.

**Known limitation, restated so it is not rediscovered as a finding.** On tasks where every
stored agent patch failed, a referee restricted to those patches can at best pick the
least-wrong one. Because gold is in the pool here, the selection question stays live on every
task; the ranking question is reported separately.

---

## 5. Cost projection, for the version that would actually be built

The rule above costs `$0` — it is diffing and pattern matching. A deployed referee would
plausibly replace Step 2 with a model judgement over the surviving tier. Projected at that
shape: ~12 candidates × ~1.5k tokens of diff, plus the issue (~0.6k) and a rubric (~0.4k),
judged pairwise-free in one call per candidate ≈ 12 × 2.5k ≈ 30k input tokens and ~4k output per
task. The gate reports whether the `$0` rule already clears the bar, because if it does, the
model version is unnecessary; if the `$0` rule fails, the gap it fails by is what a model would
have to close, and that number is the finding.

---

## 6. What would kill this candidate

- The referee's rank-1 pick is wrong on more than one task of eight.
- Step 1 eliminates a candidate that turns out to be accepted.
- Pools prove genuinely degenerate at added-line grain, so there is nothing to referee — a
  conclusion admissible **only** after hand-inspecting a pool, per the brief.
