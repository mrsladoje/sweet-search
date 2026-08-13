# Phase 1 — deterministic `$0` gate results

**Executes:** [`HANDOFF-SLATE-A-PHASE-1.md`](./HANDOFF-SLATE-A-PHASE-1.md) — gates 2 through 10 of
[`SLATE-A-UBER.md`](./SLATE-A-UBER.md) §8 Phase 1<br>
**Date:** 2026-08-13 — **Model spend: `$0`.** No rollout was launched, no paid A/B was run.<br>
**Protected state:** nothing under remote `results/` was modified. Every artifact written by this
session lives in `/tmp` on the evidence box. HO2 untouched. No held-out result was inspected.

---

## 0. Verdict

**Nine gates were taken up. Seven produced a verdict and two are blocked. Five candidates are
dead, four are held, none is cleared — and one accounting repair moved a published number by more
than any candidate would have.**

| # | gate | candidate | result | the number that decided it |
|---|---|---|---|---|
| 2 | C-4 | whole-file on first touch | **FAIL** | best case `−2.35%` on Codex; bar is `−5%` |
| 3 | C-2 | selective superset routing | **FAIL** | loses solve on 2 of 3 harnesses; costs more on 2 of 3 |
| 4 | C-3 | ephemeral causal coprocessor | **FAIL** | saves only on rollouts that never solve; costs `+2.7%` to `+7.5%` on solved ones |
| 5 | C-9 | index-addressed structural editing | **FAIL** | 44–86% addressable, 70% most faithfully; bar is 90% |
| 6 | C-5 | dependency-source index tier | **CAPPED** | 1 dependency case in 18 tasks, not 3 |
| 7 | C-6 | change-obligation compiler | **BLOCKED** | blinding destroyed by the plan document itself |
| 8 | C-7 | executable issue-contract compiler | **BLOCKED** | same contamination |
| 9 | C-8 | counterfactual patch tournament | **BLOCKED** | precondition holds after all — see §11.5 |
| 10 | R-1 | turn-0 retrieval dossier | **PARTIAL FAIL** | economics work; localisation 66%, not a strong majority |

**Every verdict above was re-tested under a variant sweep before this document was finished — see
§11.** The first pass swept one parameter on three gates and nothing on two, which is not the
many-variants protocol. The second pass ran 27 policy variants on gate 2, 148 on gate 4, four
classifiers on gate 5, a second router family on gate 3, and three diversity grains on gate 9.
**One verdict flipped (gate 9), one published number was badly overstated (gate 5), and the
reasoning behind gate 4's kill turned out to be wrong even though the kill stands.**

**The §3 blocker is repaired, and that is the largest result in this document.** The
sidechain-inclusive cost column is no longer null anywhere. Both Claude runs now reproduce
main-only cost on 100% of rows and carry a complete inclusive column. On the repaired column the
`screen-v3` headline moves from **−19.51% to −29.26%**, and — the part that matters — the
degenerate-rollout sensitivity that used to swing the answer by 15.6 points now swings it by 5.6.

**No candidate is cleared for Phase 2 implementation.** The plan's §12 named C-1 first (shipped
last session), then "C-2 and C-3 if retrospective gates generalize". They do not.

---

## 1. The §3 blocker — repaired, option 1

The handoff offered three options and recommended option 1. **Option 1 was taken and it worked.**

### 1.1 The cause was a reader defect, not missing data

Claude Code writes **one transcript record per content block**, and every record for one served
request repeats the same `message.id`. `transcriptMetricsFromFile`
(`harness/claude-code-accounting.mjs:36`) de-duplicates by `message.id` and keeps the **first**
record, taking its `usage`. For many requests the first record is a `redacted_thinking` block
whose `usage` is all zeros, while a later record for the same id carries the real numbers.

Measured over both Claude runs:

| | requests | first record has usage | recoverable by merging | absent everywhere |
|---|---:|---:|---:|---:|
| `screen-v3` main transcripts | 1206 | **1206** | 0 | 0 |
| `screen-v3` sidechains | 235 | 67 | **76** | **92** |
| `sb-claudecode` main transcripts | 1280 | **1280** | 0 | 0 |
| `sb-claudecode` sidechains | 156 | 50 | **67** | **39** |

**Main transcripts are clean, so no published main-only number was ever wrong.** Sidechains lose
between a quarter and a half of their requests to the first-record rule. Merging by id and taking
the usage-bearing record raises the priced sidechain mass by **+116% input / +95% output** on
`screen-v3` and **+179% / +105%** on `sb-claudecode`, with no estimation at all.

### 1.2 The residue needs imputation, and the imputation is narrow

Requests whose every record is zeroed have no usage anywhere — checked against every record type
in the subagent file, the parent session's `Agent` tool result, and the rest of the private
`claude-home`. Nothing carries it. They are priced as a band:

- context `T(N)`: LOW = previous known context, MID = linear interpolation, HIGH = next known;
- output tokens: LOW = 0, MID = a regression on visible content, HIGH = twice MID.

The band is narrow for a structural reason worth recording: in the cache-normalized `ideal`
column the fresh-input term **telescopes to the final context size**, so it is invariant to how
the missing requests are placed. Only the re-sent term — priced at one tenth of fresh input — and
the output term move. Across the whole `screen-v3` arm delta, LOW to HIGH spans **2.5 points**.

The output regression is `out = 0.810 × (visible chars / 3.5) + 119.2`, fitted on all 260
known sidechain requests across both runs: R² = 0.792, MAPE 41.5% per request. Per-request error
of 41% is poor; over 92 requests it is the aggregate that is used, and the LOW/HIGH band brackets
it either way.

**Fairness check:** the imputed share is **39% of native's sidechain requests and 39% of
sweet's** on `screen-v3` (66/168 and 26/67). The imputation is arm-symmetric in rate, so it
cannot tilt the comparison by construction.

### 1.3 Acceptance gate

`main-only cost recomputed here must match the recorded row within 0.5%` — the D-2 bar.

| run | rows | reproduced |
|---|---:|---:|
| `screen-v3-20260812` | 64 | **64 / 64** |
| `sb-claudecode-20260811` | 68 | **68 / 68** |

`sb-claudecode` reproduces on the `ideal` column rather than `realized`, because that run predates
the cache-write premium (`7562b42`); the realized column it recorded omits the 1.25× cache-creation
charge and differs by a systematic ~10%. `ideal` never involved that premium, so it is the right
witness for a pre-premium run.

### 1.4 What the repair does to the published headline

`screen-v3`, pre-registered definition (`RESULTS-2026-08-13` §9): cache-normalized `ideal`,
`pages` tax of `$0.035160` removed from native only.

| view | native | sweet | delta |
|---|---:|---:|---:|
| main-only — **as published** | `$0.440523` | `$0.354563` | `−19.51%` |
| **sidechain-inclusive, MID** | `$0.565523` | `$0.400076` | **`−29.26%`** |
| sidechain-inclusive, LOW | `$0.546306` | `$0.393629` | `−27.95%` |
| sidechain-inclusive, HIGH | `$0.584741` | `$0.406523` | `−30.48%` |
| **inclusive MID, degenerates excluded** | `$0.440729` | `$0.336233` | **`−23.71%`** |

**The most important line is the last one.** Under main-only pricing, whether the five degenerate
rollouts are priced or removed moved the answer by **15.6 points** (−19.51% against −3.96%), and
`RESULTS-2026-08-13` §9.3 had to pre-register a retry rule precisely because that one choice
dominated the result. On the repaired column the same choice moves it by **5.6 points**
(−29.26% against −23.71%), and both views now say the same thing.

The reason is delegation asymmetry: **native delegated on 12 of 32 rollouts, sweet on 4**. That
spend was recorded at roughly zero. None of native's four degenerate rollouts delegated, so
removing them removes main-session blow-ups while leaving native's delegated spend in place.

The `−23.71%` figure keeps the published treatment of the `pages` tax, which pro-rates it to the
surviving rollouts (`$0.315729` native main-only, from `RESULTS-2026-08-13` §0 view 2). Removing
the full `$0.035160` instead gives `−22.61%`. The 1.1-point difference is immaterial and both sit
inside the imputation band.

**Three standing caveats survive the repair unchanged.** n = 16. `p ≈ 0.34` on the main-only
column and this document did not re-run the paired bootstrap on the inclusive one. Solve is still
tied 9/16. A larger cost gap does not move the veto dimension.

### 1.5 The live adapter — FIXED 2026-08-13

The repair above began as an offline recomputation. **It is now in the harness**, so future Claude
runs price delegated work correctly. What was wrong: `transcriptMetricsFromFile` kept the first
record per message id, so every Claude run mis-priced its sidechains. The fix is confined to that
one function: group records by `message.id`, union their content blocks, and take the token counts
from the record that carries them rather than from the first.

`addSidechainCostsChecked` then stops nulling most rows, because `instrumentationComplete` starts
passing wherever the zeroing was a first-record artefact. The genuinely-absent class still needs
the documented band, so the `incompleteSidechains` escape hatch must stay.

Two second-order consequences of the same defect, both smaller and both worth a line in the fix:

- **`retainedOutputChars` and `payloads` from a transcript file are under-counted 6.6×** (80,961
  chars recovered against 535,187 present, on `screen-v3` main transcripts). Main-session
  degeneration is computed from the live stdout stream, which has no de-duplication, so the five
  flagged rollouts are unaffected. Only the **sidechain** contribution to
  `classifyRollout` is distorted, and it is distorted in both limbs at once.
- The content limb of the degeneration detector scans only the first block of each delegated
  message, so it can miss a runaway repeat that appears in a later block.

**Three safety properties were measured before the change, not assumed:**

| check | result |
|---|---|
| ids whose several non-zero records **disagree** on any token category | **0 of 1,939** |
| ids reused or interleaved, where merging would collapse two requests | **0 of 2,877** |
| duplicate content blocks within an id, where unioning would double-count | **0 of 7,078** |
| flagged degenerate rollouts that change classification | **0** — `robot-710` moves 13.29 → 10.19, still far above the 4.0 threshold |

The recovery is therefore **exact, not an estimate**. A `repeatedToolUseBlocks` tripwire is now
emitted: the writer is append-only today, and if a future Claude Code writes cumulative records
instead, that counter goes positive rather than the character totals silently doubling.

**A second defect surfaced the moment the first was fixed.** `reprice-claude-sidechains.mjs`
checked its reproduction against `costRealizedUsd`, which on a post-D-2 run is the *inclusive*
column and is null wherever a delegated transcript was unreadable. Its drift guard treated a null
as a pass, so **16 of 64 rows on `screen-v3` were scoring vacuous matches** — the null-rate trap
again, this time inside the tool built to avoid it. It now prefers the explicit main-only column,
reports `UNVERIFIED` rather than counting a match it cannot make, and diagnoses the pre-premium
case in its own output.

Verification after both fixes:

| run | main-only reproduction | note |
|---|---|---|
| `screen-v3-20260812` | **64 / 64** on realized | arm totals now add up: `$0.517027 + $0.081821 = $0.598844` |
| `sb-claudecode-20260811` | 0 / 68 on realized, **68 / 68 on ideal** | pre-dates the cache-write premium; the tool now says so itself |

Regression coverage: `tests/claude-code-cost.mjs` gains nine assertions over a fixture whose first
record is zeroed and whose usage arrives on a later record. **The old fixture could never have
caught this** — it wrote identical usage on every record. Confirmed against a re-implementation of
the old logic, which recovers **0 turns, 0 characters and 0 payloads** from the new fixture.

Full repository suite green: 348 test files, 7,341 tests, 0 failures.

**Still outstanding:** requests whose every record is zeroed remain genuinely unrecoverable — 25%
to 39% of delegated requests — and still need the documented LOW/MID/HIGH band. The
`incompleteSidechains` escape hatch is deliberately kept so that residue stays visible rather than
being priced at zero.

---

## 2. Gate 2 — C-4, whole-file on first touch

> **Bar** (`SLATE-A-UBER` §5 C-4): *"replay every nibble group at token level. Count later calls as
> removed only when their content was subsequently used and already present in the whole-file
> response. Include the cost of carrying extra lines through all later requests. **Kill if replayed
> billed cost does not fall ≥5% on Codex.**"*

**Result: FAIL.** Best case `−2.35%`.

The replay ran the **optimistic** bound first: every later read of an already-whole-file-served
file is deleted, whether or not its content was later used. The strict gate can only remove fewer
calls, so an optimistic miss is a decisive miss.

Token accounting used measured context growth, not an estimator: the tool-result tokens of request
*k* are `T(k+1) − T(k) − out(k)`, read off the recorded turn sequence. The only estimated quantity
is the size of the extra lines the policy injects, computed from the real file bytes in the base
checkout at `/root/.ss-eval/golden`.

Baseline reproduction: worst drift against the recorded `idealCost` = **0.01%** across 34 Codex
sweet rollouts.

| threshold | nibble files | later reads deleted | extra tokens injected | replayed delta |
|---:|---:|---:|---:|---:|
| ≤200 lines | 21 | 5 | 7,269 | `−0.46%` |
| **≤400 lines** | 21 | 17 | 29,015 | **`−2.35%`** ← best |
| ≤600 lines (as specified) | 21 | 21 | 42,204 | `−2.22%` |
| ≤900 lines | 21 | 21 | 47,611 | `−1.88%` |
| ≤1500 lines | 21 | 25 | 121,633 | **`+1.60%`** |

The 1500-line row is the mechanism failing in the open: the carrying cost of the extra lines
overtakes the calls it removes and the policy becomes a net loss. The plan predicted exactly this
("earlier extra content is carried through later turns") and the replay confirms the size of it.

**Coverage check.** Codex sweet issues 204 `ss-read` calls and 2 shell reads across all retained
rollout files; the replay parsed 102, which is the same population once the duplicate relaunch
rollout per cell is excluded. `ss-read` is sweet's entire read surface on Codex, so nothing is
outside the replay.

Command: `node /tmp/g2b.mjs sb-codex-20260811 sweet <threshold>` (script:
`phase1-scripts/gate2-c4-wholefile-replay.mjs`).

---

## 3. Gate 3 — C-2, selective superset routing

> **Bar** (`SLATE-A-UBER` §5 C-2): *"build a pre-edit feature table from retained traces, lock a
> simple rule, and evaluate leave-one-task-and-repo-out. **Kill unless it beats native in both task
> solve and resolved reps on every harness while remaining cheaper with sidechains included.**"*

**Result: FAIL on all three harnesses.**

Because §3's blocker is repaired, this ran on the column the bar actually names: Claude uses the
repaired sidechain-inclusive `ideal` (MID band); Codex and OpenCode have no delegated transcripts,
so main-only is already inclusive there. `dotnet__yarp-2825` is held out — its grading gate fails
its own gold patch in 4 of 8 runs (`PHASE-0-RESULTS` §2.3).

Features are pre-run only — issue text shape and repo topology, never task identity. This is a
**turn-0 router**: the arm is chosen before the rollout starts. Mid-rollout switching has no
counterfactual in retained data and is not claimed.

| harness | native | sweet | LOTO router | oracle ceiling |
|---|---|---|---|---|
| Codex | `$0.138485` 9/16, 18 reps | `$0.129307` 10/16, 19 | `$0.139199` 10/16, 20 | `$0.121486` 10/16, 20 |
| OpenCode | `$0.129426` 9/16, 17 | `$0.104859` 9/16, 17 | **`$0.114635` 8/16, 16** | `$0.106529` 10/16, 18 |
| Claude | `$0.225985` 9/16, 15 | `$0.208587` 9/16, 14 | **`$0.233220` 8/16, 13** | `$0.192207` 10/16, 16 |

- Codex: solve and reps clear the bar, **cost does not** — the router is `+0.5%` against native.
- OpenCode: the router **loses a task** (8 against 9) and a resolved rep.
- Claude: the router loses a task and two reps, and costs `+3.2%`.

**The oracle is real; the predictor is not.** The recomputed Claude oracle on the repaired column
is `−14.9%` against native, which cross-checks `PHASE-0-RESULTS` §6's `−15.9%`. But every rule the
selection procedure locked collapsed to a single threshold that mostly picks native, and picked
wrong on the tasks that mattered.

**Robustness, because one attempt is not a refutation.** The gate was re-run with a per-harness
rule and a 13,892-rule family including two-feature conjunctions. Codex then passes at `−10.7%`
with 10/16; OpenCode and Claude still fail. Selecting the best of 13,892 rules on 15 training
tasks carries no generalisation guarantee, and the gate requires **every** harness regardless.

Command: `node /tmp/g3.mjs` (script: `phase1-scripts/gate3-c2-routing-loto.mjs`).

---

## 4. Gate 4 — C-3, ephemeral causal coprocessor

> **Bar** (`SLATE-A-UBER` §5 C-3): *"reprice all retained sidechains with the exact runner function,
> mark the earliest correct causal handoff, and simulate a context reset using recorded turns…
> **Require ≥15% net saving on exposed cells and zero causal errors on solved controls.**"*

**Result: FAIL. The mechanism makes cost worse on two of three harnesses.**

The handoff point is the request that issued the first edit. Requests before it are the diagnosis
phase and keep their own context; requests from it onward start a fresh session carrying only the
system prompt plus a handoff object. Each context is priced as its own growing prefix, exactly as
sidechains are. The diagnosis phase is priced at the same model — pricing it on a cheaper backbone
would be a model swap available to both arms, so it carries no differential (`SLATE-A-UBER` §4.3).

| harness | exposed rollouts | baseline | with context reset | delta | bar |
|---|---:|---:|---:|---:|---:|
| Codex | 34 | `$0.270642` | `$0.296271` | **`+9.47%`** | `≤ −15%` |
| OpenCode | 32 | `$0.221056` | `$0.219043` | `−0.91%` | `≤ −15%` |
| Claude | 33 | `$0.403659` | `$0.415997` | **`+3.06%`** | `≤ −15%` |

Baseline reproduction: worst drift 0.0% (Codex, Claude), 0.1% (OpenCode).

**Why it loses.** The cache-normalized column already charges carried context at one tenth of
fresh input. A reset throws away that discount: the base prefix and the handoff object are re-paid
at the full input rate, and the apply phase gives up a cache position it had already bought. The
existence proof in `SLATE-A-UBER` §5 C-3 — `oceanparcels` native at 25.5% below sweet — was one
rep of a *comparison between arms*, not a measurement of the reset itself.

Sensitivity on the handoff size, which is the only free parameter:

| handoff | Codex | Claude |
|---:|---:|---:|
| 100 tokens | `+7.99%` | `+1.78%` |
| 300 tokens | `+8.36%` | `+2.10%` |
| 900 tokens | `+9.47%` | `+3.06%` |

Even a 100-token handoff — smaller than any object that could carry a causal chain, source
anchors, uncertainties, a reproducer and an edit constraint — does not reach break-even, let alone
`−15%`.

The second half of the bar, *zero causal errors on solved controls*, was not reached: the cost half
already fails, and the error half cannot be established from retained data without a rollout.

Command: `node /tmp/g4.mjs <handoff-tokens> sweet` (script: `phase1-scripts/gate4-c3-context-reset.mjs`).

---

## 5. Gate 5 — C-9, index-addressed structural editing

> **Bar** (`SLATE-A-UBER` §5 C-9): *"resolve each of the 20 observed failed edits against the current
> index. **Require ≥90% to be unambiguously addressable by symbol + operation** and confirm that
> intended sub-symbol edits do not require brittle textual anchors."* Plus §8 Phase 2: build C-9
> *"only if… C-1 leaves material residual cost."*

**Result: FAIL. 40% addressable against a 90% bar.**

The handoff asked for a re-census first, because C-1 shipped and removed the whitespace-carry
class. Post-C-1 population on `screen-v3`, over 1,297 tool results:

| | edit calls | edit failures | anchor-not-found | wrong-path | no-op | oversized payload |
|---|---:|---:|---:|---:|---:|---:|
| native | 144 | 17 | 7 | 2 | 4 | 4 |
| sweet | 119 | **15** | **6** | 5 | 2 | 2 |

**The arm asymmetry that motivated C-9 is gone.** The pre-C-1 evidence was 20 sweet anchor
failures against 7 native. It is now **6 sweet against 7 native**.

Addressability, judged per failure against the base checkout:

- **13 of 15 sweet failures target a fragment inside a symbol**, not a whole symbol — a mid-call
  argument list, a constructor parameter run, a partial statement. `replace-body` and
  `insert-after member` cannot address them. This is exactly the condition the bar names as a
  disqualifier.
- 5 wrong-path failures resolve to a unique file by path suffix, so an index-backed editor would
  fix those.
- **Verdict: 6 of 15 = 40%.** Excluding the two oversized-payload failures, which are decoding
  blow-ups rather than addressing failures, gives 6 of 13 = 46%.

**The residual cost is material, but C-9 is not what collects it.** Pricing each failed edit's
wasted round trip by the settled `pages`-tax rule — charge the turn that issued the rejected call:

| | all failures | excluding decoding blow-ups | share of arm total |
|---|---:|---:|---:|
| sweet | `$0.092067` | `$0.046621` | **13.1%** |
| native | `$0.141162` | `$0.046981` | 9.9% |

Shares are of each arm's raw main-only `ideal` total (`$0.354563` sweet, `$0.475683` native, no
`pages` correction on either side). Removing native's `pages` tax first raises native's share to
10.7%.

So edit failures cost sweet **13.1%** of its Claude spend against native's **9.9%** raw, or 10.7%
once native's `pages` tax is removed — a residual tax of 3.3 or 2.5 points depending on that
choice, on a population C-9's mechanism can address 40% of.

**A cheaper finding fell out of this census, and it is worth more than C-9.** Five of sweet's 15
failures and 2 of native's 17 are the agent writing an absolute run-directory path with `--`
where the real directory has `__`:

```
/root/.ss-eval/runs/pytask-dev__pytask-210__sweet__r0--51/src/_pytask/traceback.py
                                                     ^^ should be __
```

The working directory is already that run directory, so a relative path would have worked. Seven
wasted round trips across 32 rollouts come from one separator typo in a path the agent did not
need to write at all.

Command: `node /tmp/g5.mjs screen-v3-20260812` and `node /tmp/g5b.mjs screen-v3-20260812`
(scripts: `phase1-scripts/gate5-c9-edit-census.mjs`, `phase1-scripts/gate5-c9-addressability.mjs`).

---

## 6. Gate 6 — C-5, dependency-source index tier

> **Bar** (`SLATE-A-UBER` §5 C-5): *"audit all 17 issues and stored losing patches for a deciding
> ambiguity settled only by dependency source, cited specification, or linked implementation.
> Confirm that the exact referenced version can be acquired legally at index time. **If no third
> case exists, cap current-bench expectations at one to two tasks.**"*

**Result: CAPPED at one to two tasks. No third case exists.**

Every problem statement was scanned for external references. Three of eighteen carry a link to an
implementation, and they are not the same kind of link:

| task | linked reference | is it a dependency source? |
|---|---|---|
| `pytask-dev__pytask-210` | `github.com/pytest-dev/pytest/blob/483f239d…/src/_pytest/…` | **yes** — a declared dependency, pinned |
| `joshuakgoldberg__bingo-274` | `github.com/bingo-examples/create-handlebars-example/blob/bca1bd40…` | no — an example repo, not declared anywhere |
| `epiforecasts__scoringutils-229` | `github.com/epiforecasts/scoringutils/blob/cc7bd737…` | no — the project's own history |

`ontodev__robot-710` cites five W3C OWL URLs, which is the "cited specification" clause, but its
cells are already solved 2/2 on both arms on every harness, so it carries no headroom.

**Exactly one declared-dependency case in eighteen tasks.** The mechanism's second clause,
"issue-linked immutable references", covers `bingo` as well, giving at most two. The gate's own
instruction then applies.

### 6.1 A correction to the handoff's §4.6 finding 2

The handoff records: *"The agent already saw `exc_info` in tool output in 100% of rollouts… So the
failure is not retrieval of what exists."* **The count is right and the conclusion drawn from it is
not.** `exc_info` does appear in tool output in all 16 `pytask` rollouts across all four runs,
between 15 and 308 times. Reading the surrounding text shows what it is:

```
def render_exc_info(exc_type: type[BaseException], …
def format_exception_without_traceback(exc_info: ExceptionInfo) -> str:
def remove_traceback_from_exc_info(exc_info: ExceptionInfo) -> ExceptionInfo:
```

That is **pytask's own local parameter naming** inside `_pytask/traceback.py`. It is not evidence
about what a callable `__tracebackhide__` receives. Every occurrence of `__tracebackhide__` in the
base tree is the boolean form `__tracebackhide__ = True`; the only text mentioning a callable is
the issue statement itself, which links to pytest.

So C-5's premise on `pytask` **holds**: the deciding fact is genuinely absent from the indexed
corpus. What the four arms wrote confirms the ambiguity is live — every arm guessed differently:

| run | native argument | sweet argument |
|---|---|---|
| `sb-codex` | `frame` | `exc_info` |
| `sb-opencode` | `None` then `exc_info` | none |
| `sb-claudecode` | `exc_info` | `frame` |
| `screen-v3` | none | `exc_info` |

### 6.2 Acquirability at index time

The `pytask` base checkout contains **no vendored dependency source** — no `_pytest`, no
`site-packages`, no `.venv`. It does contain `pyproject.toml`, `setup.cfg` and `setup.py`, which
is what a resolver would read. So the source is acquirable in principle at index time, on the
network-legal path the mechanism specifies.

**Not demonstrated:** the pinned image `swerebenchv2/pytask-dev-pytask:210-3022733` is still not on
the box, so no one has yet confirmed the resolved pytest source is inspectable offline in the real
jail. That check needs an image pull and remains the one open item.

**Disposition:** C-5 stays a product-capability bet, not a bench lever. Its ceiling on this corpus
is one to two tasks, its tier is MOONSHOT, and its build truth conditions in `SLATE-A-UBER` §5 —
ecosystem resolvers, bounded storage, provenance, license tracking — are unchanged and are weeks
of work. It does not enter Phase 2 on this evidence.

Command: `node /tmp/g6.mjs` (script: `phase1-scripts/gate6-c5-dependency-audit.mjs`).

---

## 7. Gates 7 and 8 — C-6 and C-7: BLOCKED, and the blocker is our own document

> **C-6 bar** (`SLATE-A-UBER` §5 C-6): *"hide gold, derive and lock the obligation graph from issue +
> base tree only, then reveal DEV gold roles. Require prediction of all three novel modules and both
> existing cross-package/overload obligations."*
>
> **C-7 bar** (§5 C-7): *"hide DEV test patches and gold, derive and lock contracts, execute them
> against stored native/sweet/gold patches in disposable checkouts, then reveal retained labels."*

**Result: BLOCKED. Neither gate can be run by anyone who has read the planning documents, because
those documents publish the answers.**

`SLATE-A-UBER` §2.2 states: *"Three required implementation files are new at gold: `isFile.ts`,
`handlebarsDirectory.ts`, and `handlebarsFile.ts`."* That is C-6's entire prediction target, printed
in the file that specifies the blinded exercise.

§5 C-7 does the same for contracts: *"Example contracts: callable receives current `exc_info`;
accepted primitive types must appear in public enumeration; HTTP/2 send and receive behavior must be
symmetric…"* Those are the contracts to be derived.

There is no uncontaminated substitute inside this corpus. All eighteen tasks are discussed by name,
with their deciding facts, across `SLATE-A-UBER`, `SLATE-A.md`, `SLATE-A-FABLE.md`,
`EVIDENCE-DIGEST.md` and `RESULTS-2026-08-13.md`.

**What unblocks it**, cheapest first:

1. Run the derivation with a reader who has **not** read this directory — a fresh session given
   only the issue text and the base checkout, with the prediction written to a file before any
   planning document is opened. The box already has the base tree
   (`JoshuaKGoldberg__bingo@aa2363da6dae89bb322beb9916358b3865bd68e4`, 401 files).
2. Or move the exercise to DEV-RET tasks outside `rotate20`, which no planning document names.
3. And, going forward, **keep the answer key out of the gate specification.** A gate that prints
   its own solution can be run once, by the person who wrote it, and never again.

### 7.1 What was established without breaking blinding further

Reading only the **base** tree, never gold:

| file | at base commit |
|---|---|
| `isFile.ts` | **absent** |
| `handlebarsDirectory.ts` | **absent** |
| `handlebarsFile.ts` | **absent** |
| `handlebars.ts` | present, `packages/bingo-handlebars/src/handlebars.ts` |

So C-6's premise holds: the work requires authoring modules that do not exist, in a 13-package
workspace.

**And the failure is universal.** Across all four runs, both arms, both reps — 8 stored `bingo`
patches — **not one creates a new file**, and all 8 touch exactly one file, `handlebars.ts`. One
distinct file set out of eight patches.

**C-6 remains the single highest-leverage resolution candidate, which is what makes the blocked
blinding expensive.** It is the only candidate whose success alone would satisfy the solve half of
the publication bar on every harness:

| harness | native solves | sweet solves | sweet if it also solved `bingo` |
|---|---:|---:|---:|
| Codex | 9/16 | 10/16 | **11/16** |
| OpenCode | 9/16 | 9/16 | **10/16** |
| Claude | 9/16 | 9/16 | **10/16** |

That arithmetic is not a result — it is the reason the blinded exercise is worth doing properly
rather than being written off.

Command: `node /tmp/g789.mjs` (script: `phase1-scripts/gate789-preconditions.mjs`).

---

## 8. Gate 9 — C-8, counterfactual patch tournament

> **Bar** (`SLATE-A-UBER` §5 C-8): *"use stored native, sweet, and gold DEV patches as a candidate
> pool, but hide labels while generating mutation dimensions and locking the referee. **Require ≥80%
> correct selections on exposed cases**, no rejected solved controls, and all-request projected cost
> within the portfolio budget."*

**Result: FAIL on a precondition, measured without reading gold.**

C-8 selects among candidates that "must vary the disputed semantic dimension". Its stated ceiling
from existing arms is C-2's selector bound. So the pool has to contain genuinely different
structural choices. It does not, on the tasks C-8 names:

| task | stored patches | distinct patch bodies | **distinct file sets** | patches creating a new file |
|---|---:|---:|---:|---:|
| `apple__swift-nio-http2-145` | 8 | 8 | **1** | 0 |
| `joshuakgoldberg__bingo-274` | 8 | 8 | **1** | 0 |
| `dashbitco__nimble_options-43` | 8 | **3** | **1** | 0 |
| `codeception__codeceptjs-367` | 8 | 8 | 2 | 0 |
| `pytask-dev__pytask-210` | 8 | 7 | 2 | 0 |
| `mransan__ocaml-protoc-202` | 8 | 7 | 5 | 0 |
| `dart-lang__http-1114` | 8 | 8 | 6 | 0 |

On `apple`, `bingo` and `dash` — the three tasks §5 C-8 names as its evidence — every one of the 8
stored patches edits the same file set, and `dash` produces only 3 distinct bodies from 8 patches.
**A referee has nothing to choose between.** The existing-arm half of C-8's value is zero on
exactly its own cases, so all of its value would have to come from novel generated branches: the
expensive half, unproven, and the one that "could also multiply spend".

The label-blinded referee half of the gate was not run, and the same contamination as §7 applies to
it. It does not need to be: the pool precondition fails first, and it fails on uncontaminated
evidence.

Where diversity does exist — `dart-lang__http` at 6 distinct file sets, `mransan` at 5 — every
candidate is wrong on both arms in every run, so a perfect referee still selects a losing patch.

---

## 9. Gate 10 — R-1, turn-0 retrieval dossier

> **Bar** (`SLATE-A-UBER` §6 R-1): *"rebuild DEV indexes without model calls, replay issue-text
> search, and **require the eventual first-edit file in top five for a strong majority of solved
> rollouts.** Price the injected dossier through every later turn. **Reject if the same localization
> is already achieved in one model turn or if irrelevant context increases total billed mass.**"*

**Result: PARTIAL FAIL — the two reject clauses do not fire, the positive requirement is not met.**

### 9.1 Reject clause 1 — is localisation already achieved in one turn? No.

For each rollout, the number of tool calls before the file it eventually edits first appears in any
tool result:

| sweet arm | 1st call | 2nd call | 3rd–4th | 5th+ |
|---|---:|---:|---:|---:|
| all 130 rollouts | 17 | 49 | 54 | 10 |
| 65 solved | 15% | — | — | — |

15% of solved sweet rollouts locate on the very first tool call and 57% within two. A dossier is
redundant for the first group and saves at most one or two calls for the rest. The clause does not
fire outright.

### 9.2 Reject clause 2 — does the carried dossier cost more than it saves? Not below ~3,000 tokens.

Best case, the dossier removes the early query-issuing requests; it always adds its own tokens to
every later request.

| harness | max saving, 1 request removed | max saving, 2 removed | carry cost @500 tok | **net @500 tok** | break-even |
|---|---:|---:|---:|---:|---:|
| Codex | `−6.98%` | `−12.55%` | `+1.34%` | **`−11.21%`** | ~4,700 tok |
| OpenCode | `−3.71%` | `−10.61%` | `+1.82%` | **`−8.80%`** | ~2,900 tok |
| Claude | `−3.36%` | `−8.18%` | `+1.13%` | **`−7.05%`** | ~3,600 tok |

**This is the only positive economic result among the nine gates.** A dossier under about 3,000
tokens is affordable on all three harnesses.

### 9.3 The positive requirement — 66%, and that is an upper bound

The gate wants an index rebuild plus a raw-issue-text query. A cheaper and strictly more generous
proxy is already in the retained data: the agent's **first retrieval call**, whose query the model
wrote *after* reading the issue. If a model-refined query does not put the first-edit file in its
top five, a raw-issue-text query of the same style will not.

| sweet arm | top-1 | **top-5** | top-10 | absent |
|---|---:|---:|---:|---:|
| all 130 | 23% | 54% | 59% | 41% |
| **65 solved** | 23% | **66%** | 69% | 31% |

Per harness, solved only: Codex **53%**, OpenCode 71%, Claude 64%, `screen-v3` 80%.

**66% is a bare majority, not a strong one, and the worst harness is at 53%.** The requirement is
not met.

**Honest limit on the upper-bound argument:** it bounds a dossier built from the *same query
style*. Several first calls were narrow keyword greps (`ss-grep "__tracebackhide__"`). A dossier
running full-issue semantic retrieval is a different query shape and is not bounded by this
measurement. Settling that needs the specified index rebuild.

**Disposition:** R-1 is the least-dead candidate. Its money works and its localisation does not,
which is the opposite of what the plan expected ("early turns are cheap and pushed context may be
ignored"). `SLATE-A-UBER` §8 Phase 2 item 7 promotes R-1 only after it beats C-2 and C-4 jointly in
replay; both are now dead, so that comparison no longer gates anything.

Commands: `node /tmp/g10.mjs`, `node /tmp/g10b.mjs`, `node /tmp/g10c.mjs` (scripts:
`phase1-scripts/gate10-r1-localization-timing.mjs`, `phase1-scripts/gate10-r1-breakeven.mjs`, `phase1-scripts/gate10-r1-top5.mjs`).

---

## 10. Survivors and the discard log

### 10.1 Nothing is cleared for Phase 2

| candidate | disposition | killing fact |
|---|---|---|
| **C-4** whole-file first touch | **DISCARD** | optimistic replay `−2.35%` at its best threshold, `+1.60%` at 1500 lines; bar `−5%` |
| **C-2** selective superset | **DISCARD** | LOTO router loses a task on OpenCode and Claude and costs more on Codex and Claude; oracle real, predictor absent |
| **C-3** causal coprocessor | **DISCARD** | the saving is real and dose-responsive in carried context, but it exists ONLY on rollouts that never solve; on solved rollouts the reset costs `+2.7%` to `+7.5%` more (§11.3) |
| **C-9** structural editing | **DISCARD** | 44–86% addressable against a 90% bar over 47 failures, 70% on the reading that matches C-9's own mechanism; the arm asymmetry it existed to fix was already removed by C-1 (§11.4) |
| **C-8** patch tournament | **HOLD, blocked** | the pool-degeneracy finding was WRONG (§11.5); the referee half is contaminated like C-7, so the gate is unrun |
| **C-5** dependency tier | **HOLD, capped** | 1 declared-dependency case in 18 tasks; product bet only, ceiling 1–2 tasks |
| **C-6** obligation compiler | **HOLD, blocked** | gate unrunnable under contamination; premise verified, and it is the only candidate that alone clears the solve bar on all three harnesses |
| **C-7** contract compiler | **HOLD, blocked** | same contamination; not independently evaluated |
| **R-1** turn-0 dossier | **HOLD, weakened** | economics pass; top-5 localisation 66% upper bound, 53% worst harness |

### 10.2 Added to the discard log so they are not regenerated

13. **Whole-file-on-first-touch at any threshold.** Swept 200 to 1500 lines under an optimistic
    deletion rule with measured carrying cost. The best point is `−2.35%`; past ~900 lines the
    policy is a net loss. Resurrection requires a corpus where repeat reads dominate and files are
    small — not this one.
14. **Turn-0 arm routing from pre-run features.** 11 features, 180 single-threshold rules and
    13,892 rules with conjunctions, evaluated leave-one-task-and-repo-out. No rule clears the bar on
    all three harnesses. The oracle gap is real, so a *runtime-signal* router is not refuted; a
    *pre-run* router is.
15. **Context reset as a cost lever under cache-normalized pricing.** Resetting forfeits a cache
    position already bought and re-pays the base prefix at ten times the re-send rate. This is the
    same arithmetic that killed eviction (`project_lever3_eviction_dropped`) and it will kill any
    future variant priced this way.
16. **Symbol-level edit addressing as a fix for anchor failures.** After C-1, the residual is
    sub-symbol fragments, which symbol addressing cannot name.
17. ~~**Tournaments over stored arm patches.**~~ **WITHDRAWN** — the pool-degeneracy claim was an
    artefact of measuring diversity by file set. At added-line grain five of seven pools are
    diverse (§11.5). C-8 is blocked, not discarded. What does hold: every stored patch on those
    tasks fails, so the existing-arm half of C-8 has a zero ceiling — which is C-2's bound
    restated, not an independent kill.

### 10.3 Two findings that are worth more than any candidate here

1. **Repair `transcriptMetricsFromFile`'s first-record-wins de-duplication** (§1.5). It is a few
   lines, it is exact rather than estimated, and on this bench it moved the headline by nearly ten
   points and cut the degenerate-rollout sensitivity from 17.5 points to 5.6. It also silently
   under-counts delegated retained content by 6.6×, which feeds the degeneration detector.
2. **A second harness tax, the same shape as `pages` and larger** (§12). Agents invent an
   absolute run-directory path and mistype its separators. It costs **12.66% of native's Claude
   spend and 5.29% of sweet's** — worth **7.4 points** of the arm delta, the same as the `pages`
   tax. It is a benchmark artifact, not a product defect, and it flatters sweet.

### 10.4 What the next session should not do

- **Do not run a cohort on the strength of `−29.26%`.** Solve is still tied 9/16, the bar is
  strictly more solves on every harness, and no candidate in this document raises solve.
- **Do not re-derive C-2's oracle as evidence for C-2.** The oracle is a ceiling; the gate is a
  predictor, and the predictor failed leave-one-out on two of three harnesses.
- **Do not attempt gates 7 or 8 after reading this directory.** Section 7 explains why, and this
  document now names the contaminating lines as well.

---

## 11. Second pass — the variant sweep the first pass skipped

The first pass swept **one** parameter on gates 2, 4 and 10, a rule family on gate 3, and
**nothing** on gates 5 and 9. That is not the many-variants protocol, and calling a mechanism dead
after one shape of it is the failure mode this project has paid for before. Every verdict was
re-tested. What follows changed.

### 11.1 Gate 2 — C-4, 27 policy variants. Verdict unchanged, and a hypothesis of mine was wrong

The first pass expanded to the whole file on **first** touch, which pays the carrying cost on files
that are read once and never re-read. Three further policy families were built:

| policy | idea | best result |
|---|---|---:|
| **P3 span-gated** | expand only when the requested span already covers ≥F of the file | **`−2.69%`** (F = 0.4, ≤400 lines) |
| P1 first-touch | as originally specified | `−2.35%` (≤400 lines) |
| P4 window | widen the span by ±K lines instead of to the whole file | `−2.19%` (K = 25) |
| **P2 second-touch** | expand only on the first *re-read*, so single-read files cost nothing | **`−0.41%`** — far worse |

**P2 was my hypothesis and it is wrong.** Most nibbled files are read exactly twice, so deferring
expansion to the second read forfeits the removal of that second read while still paying the
injection. The data corrected me.

Across all 27 variants the best is **`−2.69%`** against a `−5%` bar, and 5 of the 27 are net
positive. **The kill is unchanged and is now robust to policy shape, not just to threshold.**

### 11.2 Gate 3 — C-2, a second router family. Verdict unchanged

The first pass tested a **turn-0** router only. The mechanism is named "native-first,
sweet-on-demand", so it is allowed to switch after native's opening probe. A second router was
built on signals measured from that probe — result bytes, distinct paths returned, test-file
fraction, empty-result flag, path depth — evaluated leave-one-task-and-repo-out.

| harness | native | probe router | delta |
|---|---|---|---:|
| Codex | `$0.138485`, 9 solved, 18 reps | `$0.138666`, **9** solved, 17 reps | `+0.1%` |
| OpenCode | `$0.129426`, 9 solved, 17 reps | `$0.112273`, **9** solved, 17 reps | `−13.3%` |
| Claude | `$0.225985`, 9 solved, 15 reps | `$0.223375`, **9** solved, 15 reps | `−1.2%` |

**Solve is level on every harness, so the veto dimension is untouched and the gate still fails.**
Worth recording separately: the OpenCode router is **13.3% cheaper at solve parity**. That is not
a C-2 pass — the bar is strictly more solves — but it is the only routing result in this document
that is not simply negative.

### 11.3 Gate 4 — C-3, 148 configurations. **The kill stands but my reasoning was wrong**

The first pass fixed the reset at the first edit and treated every cell as exposed. The bar says
"≥15% net saving on **exposed cells**", and a lever may fire selectively. Reset point, handoff
size and exposure threshold were all swept.

**A subset does clear the bar.** Claude rollouts whose pre-reset context exceeds 40,000 tokens
save **`−17.17%`**. And it is not a cherry-pick — the response is monotone in carried context on
**all three** harnesses, which is exactly what the mechanism predicts:

| pre-reset context ≥ | Codex | OpenCode | Claude |
|---:|---:|---:|---:|
| 0 | `+8.73%` (34) | `−1.86%` (32) | `+2.42%` (33) |
| 20,000 | `+6.45%` (23) | `−7.07%` (14) | `+2.42%` (33) |
| 30,000 | `−0.91%` (7) | `−8.18%` (3) | `−6.16%` (14) |
| 40,000 | — | — | **`−17.17%`** (3) |

**Then split it by outcome, which is what the bar's second clause is for.**

| pre-reset context ≥ | **solved rollouts** | unsolved rollouts |
|---:|---:|---:|
| 0 | **`+7.47%`** (50) | `+0.23%` (49) |
| 20,000 | **`+6.30%`** (35) | `−1.25%` (35) |
| 30,000 | **`+2.69%`** (12) | `−9.83%` (12) |
| 40,000 | **`+5.54%`** (1) | `−21.33%` (2) |

**On rollouts that solve, the context reset costs more at every exposure level.** The entire
saving sits in rollouts that fail, and it is carried by `dart-lang__http-1114` — 48 to 51 turns,
`−23.5%` and `−19.6%`, and **unsolved on every arm and every harness**. This is the no-doomed-tail
rule: a lever that only cuts the cost of failures is not bankable, because it moves no solve and
because the pre-registered rule prices every rollout.

**The first pass got the right verdict for the wrong reason.** It reported "+9.47% Codex, +3.06%
Claude, done" and missed that there is a real, dose-responsive mechanism underneath. The correct
statement is: C-3 works exactly where the plan said it would, and the rollouts it works on are the
ones that never solve.

### 11.4 Gate 5 — C-9, four classifiers and twice the corpus. **The published 40% was the strictest end of a wide range**

The first pass used one shape classifier on one run — 15 failures. The corpus is now both Claude
runs, 47 sweet edit failures, under four readings of "unambiguously addressable by symbol +
operation":

| classifier | all 47 | excluding decoding blow-ups |
|---|---:|---:|
| C1 the quoted text **is** a whole declaration (first pass) | 40% | **44%** |
| C2 the region sits inside exactly one uniquely-named declaration | 64% | **70%** |
| C3 C2 plus wrong-path failures whose file resolves uniquely | 79% | **86%** |
| C4 maximal — the file resolves at all | 91% | 100% |

C4 is not a real classifier: it counts a failure as addressable because the file exists, which
addresses nothing. The defensible range is **44% to 86%**, and the reading that best matches C-9's
own mechanism text — which includes "patching a tree-sitter node", not only `replace-body` — is
**C2 at 70%**.

**The bar is 90%, so the kill holds under every defensible reading.** But reporting "40%" as *the*
number was wrong: it was the strictest of four, computed on a third of the available failures.
§5's headline should be read as **44–86%, most faithfully 70%**.

### 11.5 Gate 9 — C-8. **I was wrong, and the verdict changes to BLOCKED**

The first pass measured patch diversity by **file set** and concluded "a referee has nothing to
choose between". That measure conflates *same file* with *same choice*. Re-measured at three
grains — added lines, hunk anchors, identifiers — with mean pairwise Jaccard similarity:

| task | n | added-line J | hunk J | identifier J | reading |
|---|---:|---:|---:|---:|---|
| `mransan__ocaml-protoc-202` | 8 | **0.04** | 0.07 | 0.08 | diverse |
| `apple__swift-nio-http2-145` | 8 | **0.10** | 1.00 | 0.17 | **diverse** |
| `dart-lang__http-1114` | 8 | **0.15** | 0.62 | 0.37 | diverse |
| `pytask-dev__pytask-210` | 8 | **0.20** | 0.51 | 0.36 | diverse |
| `codeception__codeceptjs-367` | 8 | **0.30** | 0.51 | 0.53 | diverse |
| `joshuakgoldberg__bingo-274` | 8 | 0.51 | 0.88 | 0.83 | partly |
| `dashbitco__nimble_options-43` | 8 | 0.62 | 1.00 | 0.82 | **degenerate** |

On `apple` the eight patches share one file and one hunk anchor but are **almost disjoint in what
they add** — they cover different state cases (`halfClosedLocalPeerIdle` alone,
`halfClosedLocalPeerActive(localRole: .client…)`, and combinations). That *is* the disputed
semantic dimension, and the pool varies on it. **C-8's precondition is met on five of seven
tasks**, not violated.

`bingo` is the one place the first pass was right for the right reason: all eight patches export
`handlebarsDirectory` and `handlebarsFile` **as functions inside the existing file**. They differ
in wording and agree on the structural choice that decides the task.

**Corrected verdict: gate 9 is BLOCKED, not FAIL** — for the same reason as gate 8. The referee
half of the gate needs labels hidden while the mutation dimensions are locked, and this directory
publishes the answers. The pool precondition, measured properly, does not kill it.

What survives from the first pass, and is the stronger argument anyway: on every one of these
tasks **all eight stored patches fail**, so a perfect referee over the existing pool still selects
a loser. That bounds the *existing-arm* half of C-8 at zero — which is C-2's already-measured
ceiling restated, not new evidence. C-8's novel-branch generator remains untested and is the
expensive half.

### 11.6 What the second pass changes in §10

- **C-8 moves from DISCARD to HOLD (blocked).** Discard-log entry 17 is withdrawn: the pool is
  diverse on five of seven tasks. Do not cite "degenerate pool" as C-8's killing fact.
- **C-9's killing fact is restated** as 44–86% against a 90% bar, most faithfully 70% — not 40%.
- **C-3's killing fact is restated**: not "the reset costs more", which is false on long rollouts,
  but "the saving exists only on rollouts that never solve, and costs 2.7–7.5% more on the ones
  that do".
- **C-4 and C-2 are unchanged**, and both kills are now robust to mechanism shape rather than to a
  single parameter.

Scripts: `phase1-scripts/v2-c4-variants.mjs`, `v3-c2-nativefirst.mjs`, `v4-c3-variants.mjs`,
`v5-c9-generous.mjs`, `v9-c8-diversity.mjs`.

---

## 12. A second harness tax, found by chasing a wrong hypothesis

§5's census showed sweet writing malformed run-directory paths, and §10.3 first recorded that as
"seven wasted round trips from one separator — cheap to fix, needs no new mechanism". **That
framing was wrong.** Testing it properly changed both the size and the owner of the problem.

### 12.1 The hypothesis, and its refutation

Claude Code's `Edit` tool requires an **absolute** path. Native's `Read` tool hands the model an
absolute path it can copy; sweet's `ss-*` tools emit **repo-relative** paths (`src/_pytask/
traceback.py:70`), so the model must build the absolute path itself. The prediction followed:
sweet should mistype run directories and native should not, making this a sweet-only tool-output
defect with a cheap sweet-only fix.

Measured over both Claude runs, every tool, every `File does not exist` failure:

| | failures | path a tool had **printed** | run-directory segment malformed | wasted round trips |
|---|---:|---:|---:|---:|
| sweet | 12 | **0** | 11 | `$0.040321` |
| **native** | **42** | **1** | **34** | **`$0.110620`** |

**The prediction is refuted three ways.** Native fails 3.5× more often, not less. Both arms
*invent* the path — only 1 of 54 failing paths was ever printed by any tool, so this is not about
`ss-*` output at all. And the malformed-segment rate is the same in both arms.

### 12.2 What it actually is

An arm-universal transcription failure of a long, `__`-separated directory name that exists only
because the benchmark creates it:

```
/root/.ss-eval/runs/rstudio-education__gradethis-161__sweet__r0--59/R/grade_code.R
                                                            ^^ the real directory has __
```

The working directory already *is* that run directory, so a relative path would have worked in
every case. The model absolutizes anyway, and mistypes a name no real user would ever have.

| tax | native | sweet | arm delta contribution |
|---|---:|---:|---:|
| `pages` parameter (`RESULTS-2026-08-13` §1) | 7.4% | 0% | 7.4 points |
| **invented run-directory path** | **12.66%** | **5.29%** | **7.4 points** |

**It is the same class of defect as the `pages` tax, it is about 1.6× larger on native per run
(`$0.055` against `$0.035`), and it moves the headline by the same 7.4 points** — in sweet's favour.
Unlike `pages` it is not one-sided, so it cannot simply be subtracted from one arm; it has to be
measured on both.

### 12.3 What was done — FIXED 2026-08-13

- **Not fixed as a sweet product lever.** Making `ss-*` print absolute paths would have helped
  sweet's 12 failures and none of native's 42, shrinking the measured cost of the arm that is
  already cheaper. That is optimising the benchmark, not the product.
- **Fixed in the harness, where it comes from.** `makeRunDir` in `run-pilot.mjs` no longer names
  the directory `<taskId>__<arm>__r<rep>__<n>`. It is now `r<rep>-<n>` — **4 to 5 characters
  instead of about 45**, with no doubled separator to mangle. Both arms improve and native
  improves more, so the measured gap narrows. That is the validity-preserving direction, and it
  is the same call that was made on `pages`.

**A second defect was fixed by the same change, and it is the more serious one.** The old name
put the string `__sweet__` or `__native__` **inside the agent's own working directory**, which the
harness places in the system prompt. Every rollout could read its own arm at runtime. Nothing in
the traces suggests any rollout acted on it, but an arm-conditioned agent is precisely the
contamination this bench forbids, and the channel was open for every run to date. The new name is
arm-blind. A regression test asserts it:

```
✓ the run-directory name never reveals the arm — an arm-conditioned agent is forbidden
```

`rep` is kept in the name because `reprice-claude-sidechains.mjs` recovers it from Claude Code's
project-directory slug. Task and arm are already carried by `results/<run>/agent-state/<cell>/`,
so nothing downstream needed them in the path. `repOfSlug` moved into the testable accounting
module and now decodes **both** forms, because retained runs keep the long one:

| rundir | slug | rep |
|---|---|---:|
| `pytask-dev__pytask-210__sweet__r0__51` | `…-runs-pytask-dev--pytask-210--sweet--r0--51` | 0 |
| `r0-51` | `…-runs-r0-51` | 0 |

Nine assertions cover the decode, including multi-digit reps, hyphenated task names, and an
undecodable slug yielding `null` rather than `0`. Verified end-to-end: `screen-v3` still
reproduces **64 / 64** through the repricing tool after the change.

**Disclosure still required for existing figures.** Every cost number already published from a
Claude run of this bench carries the 7.4-point contribution from the old directory naming. The
fix applies to future runs only; it cannot be replayed onto recorded rows, exactly like the `pages`
adapter fix. That belongs beside the `pages` line in the pre-registered cost definition, not in
any candidate's ceiling.

**Method note.** This was found only by writing the hypothesis down as a falsifiable prediction —
"sweet's failing paths should be ones no tool printed, native's should not be malformed" — and
then measuring both halves. The first half held, the second inverted, and the inversion is the
finding. Script: `phase1-scripts/n2-path-absolutization.mjs`.

---

## 13. The adjacent-variant search, and what it closed

Gates ask "does the specified mechanism work?". They do not ask "is there a nearby mechanism that
works better?". Two adjacent variants were built from this session's own measurements rather than
from the slate.

### 13.1 Orientation dossier — dead, and it closes a family

R-1 failed on *what to put in the dossier*, not on affordability: carrying 500 tokens costs
1.1–1.8% while the first two requests are worth 8.2–12.6%. So the natural better variant replaces
R-1's ranked file list — a guess that can be wrong — with **facts that cannot be**: the base
checkout's directory tree and its dependency manifests, both static and model-free.

Classifying the first three requests of all 268 rollouts, with test execution, git state and
issue-driven search excluded from "precomputable" by construction:

| | run-tests | locate-symbol | read-file | manifest | tree | **precomputable share** |
|---|---:|---:|---:|---:|---:|---:|
| native, first 3 requests | 150 | 126 | 173 | 66 | 63 | **20%** |
| **sweet, first 3 requests** | 153 | 193 | 30 | 33 | 0 | **8%** |

Almost no rollout *opens* with a precomputable-only request, so the leading run that a dossier
could remove is 0 requests on Codex and OpenCode and 2 of 34 on Claude sweet. Priced at 500 to
2000 dossier tokens the result is **`+0.41%` to `+1.82%`** — a loss on every harness and both arms.

**The reason is a positive fact about the product.** The most common opening move is running the
tests, and sweet's second move is issue-driven search. **Sweet has 8% precomputable early
requests against native's 20% — it has already eliminated the orientation phase native still
pays for.** There is nothing left at turn 0 to remove.

This closes the whole *push-precomputed-context-early* family, not only R-1's ranked list. Script:
`phase1-scripts/n1-orientation-dossier.mjs`.

### 13.2 Absolute paths in agent output — refuted as a lever, promoted to a validity item

See §12. The variant was real, the measurement inverted it, and it left the bench with a disclosed
tax instead of the product with a lever.

### 13.3 What the search says about where value is left

Three of this session's measurements point the same way, and none of them points at retrieval:

1. Carried context is cheap (0.01/M) and fresh input is not, so **every lever that resets,
   evicts or compacts loses** (§11.3), and every lever that pushes more context early is
   affordable but has nothing to push (§13.1).
2. The two largest movable quantities found all session are **accounting defects** — the
   sidechain first-record bug (§1, ~10 points) and the run-directory path tax (§12, 7.4 points) —
   not product mechanisms.
3. The only candidate that would move **solve** on all three harnesses is C-6, and it is blocked
   on a blinding failure that costs nothing to repair (§7).

**The honest conclusion of the adjacent-variant search is that the cost frontier on this corpus is
closed, and the remaining headroom is in solve.** That matches the standing finding that
`rotate20` has near-zero retrieval headroom, and it is why no cohort run is justified until C-6's
exercise is run under real blinding.
