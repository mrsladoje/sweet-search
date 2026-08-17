# W0 gate — P3 executable issue witnesses and evidence closure

**Executes:** [`SLATE-B-UBER.md`](./SLATE-B-UBER.md) §9 W0, row "P3 witnesses/finish"<br>
**Date:** 2026-08-17 — **Model spend: `$0`** (no agent rollout; compute was `git archive`,
two small container images, and greps over recorded artifacts)<br>
**Protected state:** remote `results/` not mutated; golden checkouts never written to —
every tree was materialised with `git archive` into a temp dir and deleted; HO2 untouched.<br>
**Freeze point:** the three witnesses were committed at `96686fa` **before** they met any
patch, any reference fix, or this script. Two mechanical repairs after that point are
disclosed in §5.

---

## 0. Verdict

**P3 survives both kill conditions, but one of its three witnesses works and the other two
miss in opposite directions.**

| W0 required output | result |
|---|---|
| three independently authored witnesses | **3 authored**, blind; 1 separates every tree perfectly, 1 under-specifies, 1 over-specifies |
| six Dashbitco delta replays | **12 cells replayed** (both arms); 9 yielded a parsed failure, 10 failures in all, **verdicts consistent** |
| 27 solved-cell negative controls | **76 resolved cells**, **0 false stale classifications** |
| kill: needs hidden or gold facts | **not met** — the Dashbitco witness is 13/13 with no gold |
| kill: mislabels a solved-cell failure as stale | **not met** — 0 of 76 |

**But the gate found a cost P3 never priced.** A witness can be *stricter* than the task,
and a completion gate driven by one then converts solves into non-solves. On Akinsho this
is not hypothetical: the witness rejects **11 rollouts the benchmark scores as solved**,
and rejects the reference fix as well.

---

## 1. Falsifier 1 — the three hand-authored witnesses

Each witness was written from the issue text, the base tree, and recorded visible test
output. `patch`, `test_patch`, `FAIL_TO_PASS` and `PASS_TO_PASS` were not read while
authoring, and each assertion carries an inline justification naming which of those three
sources licenses it. Then each was run against the base tree, all twelve recorded patches,
and — only after the freeze — the reference fix.

### 1a. Dashbitco `nimble_options#43` — clean separation, 13 of 13

| tree | witness | grader |
|---|---|---|
| base, unpatched | **REJECT** (8 of 8 assertions fail) | — |
| 11 recorded patches that did not resolve | **REJECT, 11 of 11** | unresolved |
| 1 recorded patch that resolved (claude sweet r1) | **ACCEPT** | resolved |
| reference fix | **ACCEPT** | resolved |

No error in either direction, on a witness that never saw the answer.

**All eleven rejections fail the same single assertion: "the advertised type list names
`:integer`".** That is the coherence property, and it is the whole point:

```elixir
# @basic_types feeds BOTH type/1 (what is accepted) and available_types/0 (what is
# advertised), so "accepted but not advertised" is an internal inconsistency — detectable
# with no knowledge of what the right answer is.
assert advertised_message() =~ ":integer"
```

Eleven rollouts added `:integer` handling **without** adding it to `@basic_types`. That
keeps the old exact-string assertion green and leaves the library accepting a type it does
not advertise. The witness catches every one of them by asking the library to agree with
itself.

Two other assertions carry their weight even though nothing tripped them here: a negative
integer must be accepted (the only behaviour `:non_neg_integer` and `:pos_integer` cannot
already express, so it refuses an alias fix), and a float and a string must be rejected.

### 1b. Codeception `CodeceptJS#367` — under-specified, accepts 4 of 12 losers

Base rejected, reference fix accepted, and the split across the twelve recorded patches is
not random:

| what the patch edited | witness | grader |
|---|---|---|
| `lib/helper.js` (8 patches) | **REJECT** | unresolved |
| `lib/actor.js` (4 patches) | **ACCEPT** | **unresolved** |
| reference fix — `lib/actor.js`, `lib/codecept.js`, `package.json` | ACCEPT | resolved |

The eight rejections are correct and interesting: adding `comment()` to the `Helper` base
class does not put it on the actor, because `methodsOfObject(helper, 'Helper')` excludes
the base class's own methods. Those patches never delivered `I.comment()` at all.

The four acceptances are the honest miss. They do what the issue asks — a comment step on
the actor, deferred into the recorder queue rather than printed immediately — and still
lost. The reference fix touches two files they never touch, and the hidden test patch
touches `examples/github_test.js`. **Reading the issue is not sufficient to reconstruct
this task's definition of solved.** That is a limit on a general witness compiler, stated
without needing to open the hidden tests.

### 1c. Akinsho `nvim-bufferline#173` — over-specified, and this one can cost tasks

The witness drives the public `M.get(prefs)` over layouts a real neovim produces, with the
whole `vim` surface stubbed. Per assertion:

| assertion | base | reference fix | recorded patches that RESOLVED (of 11) |
|---|---|---|---|
| a flat NvimTree sidebar still offsets on the left | pass | pass | 11 pass |
| a nested undotree sidebar offsets on the left | **fail** | pass | 11 pass |
| a nested undotree sidebar offsets on the right | **fail** | pass | **5 pass, 6 fail** |
| a row nested inside a column still finds the sidebar | **fail** | **fail** | **0 pass, 11 fail** |
| no sidebar means no offset | pass | pass | 11 pass |

Two separate problems, and neither is a coding slip:

**The fourth assertion over-reaches.** The reference fix fails it too. Both the base and
the fix require `layout[1] == "row"` at the top level, so a quickfix window below the
whole layout defeats them. Drop that assertion and the witness is sound against the
reference fix.

**The third assertion is stricter than the benchmark.** The reference fix passes it, but
six rollouts that the grader scored as **resolved** fix only the left boundary and fail
it. Both assertions came straight from P3's own prescription — "exercise nested row/column
layouts and both boundaries" — so this is P3's specification producing a witness the
benchmark disagrees with, not an invention of this gate.

**The consequence names itself.** `ss-finish` is a *terminal* gate: it decides whether the
agent may finish. Wired to this witness, it blocks eleven rollouts that were already
correct by the benchmark's own standard. P3's ceiling arithmetic counts the tasks such a
mechanism might win and never counts the ones it can lose.

---

## 2. Falsifier 2a — the Dashbitco delta replay

Every Dashbitco screen from all twelve cells was put through the frozen expected/actual
parser. Nine cells yielded a parsed failure and ten failures came out in total, one cell
having produced two; the other three cells never printed a failure the parser could read.

**Consistency is judged per (task, test, delta), not per screen**, because the screens
capture different trees. Grouped that way: **6 distinct groups, 0 with more than one
verdict.**

| group | verdict | count |
|---|---|---|
| Dashbitco, the ArgumentError assertion, delta `[:integer]` | STALE-CANDIDATE | 8 |
| Dashbitco, same assertion, destructive delta | REAL | 1 |
| Dashbitco, same delta via the generic reader | STALE-CANDIDATE | 1 |
| Codeception, actor keys, delta `[comment, remark]` | STALE-CANDIDATE | 1 |
| Codeception, actor keys, deltas containing `say` | REAL | 2 |

The single REAL on Dashbitco is claude sweet r0 at screen 19, after it mangled the
advertised-type clause:

```
destructive: the assertion pinned [":fun","arity",":one_of","choices",":custom","mod"]
and the code no longer produces it
```

That is the classifier refusing exactly the move P3 exists to refuse, without being told
it happened.

**The Codeception split is the production-safety rule earning its keep.** The issue names
`I.comment()` and `I.remark()`. A patch that also invents `say` gets **REAL — "not named
in the issue: [say]"**. You do not get to call an old assertion obsolete because of an API
you added on your own initiative.

---

## 3. Falsifier 2b — the solved-cell negative controls

The kill condition, operationally: on a cell that ended **resolved**, a failure called
STALE-CANDIDATE that is **gone from the cell's last screen** is a false stale — it went
green, so the agent fixed it in code, and calling it an obsolete assertion would have
licensed shipping a repairable break.

| population | count |
|---|---|
| resolved admissible cells (both arms) | **76** (38 sweet, 38 native) |
| **FALSE stale — the kill condition** | **0**, on 0 cells |
| correct stale — still red at the end of a cell that resolved anyway | 1 |

The single correct stale is `claude-code/sweet/r1/dashbitco`, the one rollout that shipped
red and was right to. Counting that as an error would make the gate unpassable by
construction, so it is reported separately.

**Denominator note.** SLATE-B says "27 currently resolved cells". The artifacts hold 76
resolved admissible cells, 38 of them sweet — the same 38 the P2 gate used. The larger,
complete denominator is the one used here; the origin of 27 could not be reconstructed and
is not relied on.

---

## 4. Is the quiet real?

The parser read 13 of 184 admissible failing screens, so the zero above is worth nothing
until every unread screen is attributed.

| category | screens | correct silence? |
|---|---:|---|
| PARSED | 13 | — |
| no failing assertion at all — build break, load error, missing dependency, timeout | 51 | yes; there is no delta to reason about |
| a real failing test carrying no expected/actual pair — uncaught exception, R error, a tape summary line | 119 | yes; the stale question is not askable |
| **SHAPE-MISS — expected/actual language present, parser found nothing** | **1** | see below |

**Checked, not assumed: 0 of the 51 no-failing-assertion screens contain expected/actual
language.** So the parser read every screen that carried a delta, bar one.

The single SHAPE-MISS is `claude-code/native/r1/pytask` screen 28, a containment assertion
— `assert ('This variable should not be shown.' in <output>) is not False`. There is no
two-sided delta in it, so silence is right; only the detector's marker was over-broad.

The large NO-DELTA bucket is a finding in its own right. Underscore, teleport,
epiforecasts and gradethis fail with exceptions and summary counts, not comparisons.
**A delta-based finish gate is silent on most of this benchmark's failures.**

### The existing harness trailer is language-blind where it matters most

`run_tests` already prints a `[run_tests baseline-diff]` line separating introduced from
pre-existing failures. It works on Lua, Swift and R. On the Dashbitco screens it reports
`introduced_failures=0 pre_existing_failures=0 trustworthy=yes introduced_signatures=none`
**while one test is failing** — its ExUnit signature extraction produces nothing. The one
task P3's resolution ceiling rests on is the one where the existing instrument is blind.

---

## 5. Falsifier 3 — the ss-oracle trigger census

P3's own bar: fewer than five realistic triggers across the run demotes `ss-oracle` to an
adapter.

| measure | count |
|---|---:|
| admissible cells that read a test file at least once | **84 of 156** (46 native, 38 sweet) |
| total test-file reads | **160** |
| cells that read a test file **before their first edit** | **77** |
| tasks where it happens | 13 of 16 |

Roughly thirty times the bar. Agents already go and read tests to learn what they pin, so
the behaviour `ss-oracle` would serve is real. That is demand, not proof of value.

---

## 6. Instrument reliability

The P1 probe was wrong five times and the P2 replay carried two defects. P3's classifier
can fail in two directions with opposite consequences — a false stale kills the proposal in
production, a missed stale flatters this gate's own numbers — so both were controlled.

**15 controls**, anchored to text copied verbatim from recorded screens, with a final
control that re-reads the artifact to prove the fixtures are not paraphrases. They caught
four defects:

| defect | direction | effect if unfixed |
|---|---|---|
| the generic Expected/Actual reader ran alongside the language parsers | over-report | every Elixir failure counted twice |
| the mocha block regex ended at `$` under the `m` flag | under-report | **zero** chai failures parsed |
| the chai legend line `+ expected - actual` was read as content | **under-report** | the words "expected"/"actual" entered every chai delta and turned a genuine additive delta into REAL |
| the witness's own probe atom leaked back out of the error message it parses | over-reject | the Dashbitco witness rejected every tree, including a correct one |

Three defects outside the controls, in the extraction layer, each caught by a cross-check
rather than by inspection:

- **Trajectories truncate every tool result at 600 characters.** An ExUnit assertion diff
  does not survive that. All screens come from each harness's own session record instead.
- **Codex runs commands asynchronously.** `exec` returns only `Script running with cell ID
  3` and the real stdout arrives later through a `wait` on that cell id. Before stitching
  them, 50 codex screens were under 200 characters. After: 16, all genuinely empty output.
- **Screen detection must be restricted to shell commands.** An opencode `todowrite` whose
  todo text reads "Run baseline test suite with run_tests" is a plan, not a test run, and a
  claude `TaskCreate` description mentioning `run_tests` is not one either. Both were being
  counted as screens.

Together those three fixes took the disagreement with the independently recorded
trajectories from **126 of 202 cells to 25**. The extraction now matches on 177 of 202. Of
the 25 that differ, 24 are cases where this extraction found **more** — compound commands
such as `ss-grep … && run_tests` that the trajectory classifier labels as a search, not a
test. One cell finds fewer, on `mqtt_cpp`, which is blocked. Two cells have no session
record at all, both `mransan__ocaml-protoc-202`, already blocked.

### Two repairs after the freeze, disclosed

Both are mechanical, neither uses gold knowledge, and both are commented in place:

1. **Dashbitco witness** — `advertised_atoms/0` scanned the whole error message and so read
   its own probe atom back out of `invalid option type :__w0_p3_definitely_not_a_type__`,
   then demanded the library accept it. The repair slices the message to the list between
   `Available types:` and `(in options …)`.
2. **Akinsho witness** — the `vim` stub stopped at `split` and `tbl_isempty`, so any tree
   whose fix reached for another `vim.tbl_*` helper died with "attempt to call a nil value"
   and was scored REJECT for a reason unrelated to its behaviour. The reference fix was one
   of them. The added helpers are neovim's own list functions.

### Contamination disclosure

The first file opened in this gate was `results/<run>/sweet/logs/dashbitco…_log.txt`, which
turned out to be a **grading** log — produced after the grader applies the hidden test
patch — and it showed one hidden assertion's expected string. Nothing downstream depends on
it: every screen used here comes from the agent's own session record, and the Dashbitco
witness asserts a coherence property between the advertised list and the accepted set
rather than any exact string or ordering. The grading logs are not read anywhere in the
scripts, and the header of `w0-p3-screens.mjs` says why.

---

## 7. Gate verdict, and what it does not support

**P3 is NOT killed.** Neither kill condition fired: the residue is derivable without gold
on the task the ceiling rests on, and the classifier never mislabelled a solved-cell
failure as stale in 76 chances.

**What the evidence actually supports, narrowly:**

- **A narrow Dashbitco-shaped witness works, and works blind.** 13 of 13, and every
  rejection lands on a coherence property rather than on a guess about the fix.
- **`ss-oracle` clears its own demand bar by roughly thirty times.** Retain it as a real
  component, not an adapter.
- **The delta classifier is safe.** Its production-safety rule — non-destructive,
  issue-named, and self-caused — is what makes it safe, and the Codeception `say` case
  shows the rule refusing an unearned stale.

**What it does not support:**

- **A general witness compiler.** Two of three witnesses miss the benchmark's notion of
  correct in opposite directions, from the same authoring discipline.
- **Treating a witness as a terminal gate without pricing rejection.** The Akinsho witness
  would have blocked 11 solved rollouts. Any `ss-finish` design must measure solves lost,
  not only tasks won.
- **A delta-based finish gate as broad coverage.** 119 of 184 failing screens carry no
  expected/actual pair at all.

**Ceiling:** unchanged and narrow. Dashbitco's mechanism is demonstrated at `$0` on 11 of
11 wrong patches, which supports P3's stated conditional `+1 on codex and +1 on opencode`.
Akinsho rep stabilisation is **withdrawn as support** by this gate's own evidence.

**Unchanged:** NO-GO for a paid pilot until Phase 0's remaining items close. Three `$0`
gates now stand: P1 (corpus broadly available, demand thin), P2 (mechanism clean), P3
(mechanism works narrowly, generality unproven, and over-specification is a live cost).

---

## 8. Artifacts

- `handoffs/improve/w0-p3-20260817/w0-p3-witness.txt`, `.json` — falsifier 1, every tree
- `handoffs/improve/w0-p3-20260817/w0-p3-sweep.txt` — falsifiers 2a, 2b and 3
- `handoffs/improve/w0-p3-20260817/w0-p3-silence.txt` — §4 coverage audit and consistency
- `handoffs/improve/w0-p3-20260817/w0-p3-survey.txt` — the failure-format survey
- `handoffs/improve/w0-p3-20260817/w0-p3-verdicts.json` — per-screen verdicts
- `handoffs/improve/w0-p3-20260817/w0-p3-screens.json.gz` — every extracted screen and call
- `phase1-scripts/witnesses/` — the three frozen witnesses (freeze commit `96686fa`)
- `phase1-scripts/w0-p3-screens.mjs` — extraction, with the three harness formats
- `phase1-scripts/w0-p3-delta.mjs` — the parser and classifier
- `phase1-scripts/w0-p3-controls.mjs` — the 15 controls; run this before trusting anything above
- `phase1-scripts/w0-p3-sweep.mjs`, `w0-p3-silence.mjs`, `w0-p3-witness-run.mjs` — scoring
