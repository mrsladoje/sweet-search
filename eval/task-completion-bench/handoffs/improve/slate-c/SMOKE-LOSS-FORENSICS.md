# SMOKE LOSS FORENSICS — where sweet lost the 2026-09-02 smoke, and the one lever left

**Written 2026-09-03.** Full-transcript read of all 360 smoke rollouts plus the 24 squashql
ablation rollouts (384 total), four independent Opus passes, every claim cited to a step number
in `forensics/smoke-losses/`. Spend for this document: $0. The raw transcripts live only on the
box; `forensics/smoke-losses/normalize-transcripts.py` regenerates the readable per-rollout
files from `results/sm-*/agent-state/`.

**Audience: the owner deciding what to build next.** §5 is the ranked list. §6 is the test plan.

---

## 0. Verdict in six sentences

1. **Sweet's rep deficit is one task, not a pattern.** After correcting a grader artifact (§2.3),
   the smoke is native 65/180 vs sweet 59/180 reps; squashql alone is −6, and it is the only
   task with a sweet-specific, mechanically traceable cause.
2. **On squashql the cause is a same-file sibling that sweet's precision-first search hides.**
   Across 42 rollouts, `resolved` equals "the patch also changes the `toSubQuery` measures
   argument" in 42/42. Native had the field's constructor line in view before its first edit in
   20/21 rollouts; sweet in 3/21. Inside sweet, the only significant discriminator is whether the
   agent ever grepped the identifier `subQueryMeasures` (4 solved / 0 failed vs 2 / 15,
   p=0.0025).
3. **getmoto is a remedy coin-flip with zero test feedback, not retrieval.** All 18 rollouts saw
   the mutation site and the aliasing site before editing; counter-reset solved 15/15, deepcopy
   failed 3/3; `run_tests` returned `exit=4 trustworthy=no` in every rollout. No tool line
   helps.
4. **gleam is two things:** a real `ss-find` ranking miss (gold site at rank 9 as a name-only
   summary, wrong site at rank 2 with its body; the flat `ss-grep` form went 0/4 wrong) and a
   cargo-log grader artifact that flipped one native and one sweet codex rollout from solved to
   failed.
5. **The "widen on a low sufficiency verdict" lever (handoff §7.2) is dead.** The pooled
   association reproduces but is task difficulty; held at one task it is 2 right / 1 wrong /
   3 ties, and after a `no`/`unknown` verdict the agent already searches again 52% of the time
   and edits straight away 3%.
6. **The one lever left is tool-side and costs nothing in prompt or cache:** make the same-file
   identifier family visible on singleton hits and above the read window. It reaches 14 of 15
   squashql failures at step 3-9; the form that worked in the transcripts (three sites co-listed
   with their code lines) converted 4/4, the bare-name form converted 0/2. Cost is 0.26-0.44% of
   sweet prompt tokens, about a tenth of that in dollars.

---

## 1. The tally, corrected

| harness | native reps | sweet reps | native tasks | sweet tasks |
|---|---:|---:|---:|---:|
| opencode | 23/60 | 18/60 | 8/20 | 8/20 |
| claude-code | 21/60 | 22/60 | 8/20 | 8/20 |
| codex (as graded) | 20/60 | 18/60 | 8/20 | 8/20 |
| codex (grader artifact corrected, §2.3) | 21/60 | 19/60 | 8/20 | 8/20 |

Per-task rep deltas, sweet minus native, summed over harnesses (only tasks with a non-zero
delta): squashql **−6**, getmoto **−3**, gleam **−1** (opencode −2, codex +1), yasson **+2**,
graphql-go-tools **+1**, uniforms **+1**, markdown **0** (opencode −1, claude-code +1). The
census counts 9 tasks solvable by at least one arm and 11 never solved by anyone (the handoff
said 8/12; the data says 9/11 because yasson solves on codex sweet).

The squashql deficit pools to native 18/21 vs sweet 6/21 when the 24 same-day ablation rollouts
are added (z=3.74 in the handoff). It is real.

---

## 2. Task by task

### 2.1 squashql-295 — one line, and how each arm got it into view

Evidence: `forensics/smoke-losses/squashql-42-rollouts.md` (per-rollout table, 42 rows).

**Mechanism, 42/42.** The gold fix has two parts inside `QueryResolver.java`: remove the nested
rejection in `checkSubQuery` (L210), and stop `toSubQuery` (L191-208) from building the
sub-query's `DatabaseQuery` out of `this.subQueryMeasures` (L207), a field declared at L35 and
assigned once in the constructor at L55 from the top-level query's direct sub-query. Every
resolved rollout in either arm changes L207; every failed one does not. No exceptions.

**How native saw it (20/21 before the first edit).** Two free, wide cues: a family grep such as
`rg -n -i "sub.?query|subquery|nested"` that lists L35 and L55 next to L207 in one output (7
rollouts), or a head-of-file slab read `sed -n '1,380p'` / `read offset=1 limit=380` (the rest).
Native's first search returns 89-131 lines; sweet's returns 1. 16/21 native rollouts made the
two-site edit in their FIRST patch.

**How sweet did not (3/21).** The guided path is `ss-grep "<exact error string>"` (1 hit, L212,
no siblings printed) then `ss-read QueryResolver.java 170 235`, whose only trailer is
`# unread below (236-468): compileCriteria, compileMeasure …`. Nothing names what is above the
window. Sweet's failed rollouts edited `checkSubQuery` after a median 10.8k characters of tool output
(its solved ones after 16.9k); native's solved rollouts after 72.6k. Sweet's best rollout read
less than native's worst.

**What separated sweet's 6 solves from its 15 failures.** Only one variable is significant:

| variable (within sweet, n=21) | solved / failed if yes | if no | p |
|---|---|---|---|
| ever searched FOR `subQueryMeasures` | **4 / 0** | 2 / 15 | **0.0025** |
| L35/L55 in view before first edit | 2 / 1 | 4 / 14 | 0.18 |
| whole file read before first edit | 1 / 0 | 5 / 15 | 0.29 |
| any `sufficient=YES` seen | 3 / 5 | 3 / 10 | 0.63 |
| called `ss-trace` | 2 / 4 | 4 / 11 | 1.00 |

Three of the four identifier searches happened AFTER a wrong first edit, during verification;
the search converted a wrong patch into the gold one within 2-7 steps each time.

**Surfacing alone is not enough — two hard counterexamples.** `claudecode sweet r0` read L1-160
at step 12 (both lines verbatim), then edited only the guard at step 16 and never named the field.
`codex sweet r0` derived the bug in reasoning at step 28 ("the inner toSubQuery continues using
the same resolver and those root immediate measures. I wonder if this approach is really okay")
and dismissed it at step 29 ("am I overfitting?"), shipping a null guard. Bare-name cues also
failed: `ss-trace toSubQuery callees` printed `calls subQueryMeasures.values (external)` once and
the next sentence dismissed the question.

**The form that worked.** In all four rollouts that acted, the agent saw the three sites together
with their code — `:35 private final Map<…> subQueryMeasures;`, `:55 this.subQueryMeasures =
… compileMeasures(query.table.subQuery.measures, false)`, `:207 new ArrayList<>(this.subQueryMeasures.values())`
— in one `ss-grep` output. That co-listing makes "compiled once, read at every depth" legible as a
shape. A name in a list did not.

**Two more findings on this task.** The `<state_summary>` blind-spot field named "measure
resolution" in 5 of 24 blocks, two of them in rollouts that then failed without checking it: the
field is descriptive, nothing discharges it. And `ss-trace checkSubQuery callees` reports
`fan-in=0 fan-out=4` with all callees `.isEmpty` leaves, which reads as "no state coupling" — the
wrong conclusion, delivered confidently.

The golden rebuild is exonerated (handoff §5.5); the ablation's 12 extra sweet rollouts show the
identical shape.

### 2.2 getmoto-6716 — a coin-flip under zero feedback

Evidence: `forensics/smoke-losses/getmoto-and-gleam.md` Task A.

All 18 rollouts had `ManagedPolicy.attach_to` (`self.attachment_count += 1`, L334) and
`_init_managed_policies` (`dict((p.arn, p) for p in self.aws_managed_policies)`, L1802) in a
tool output before their first edit. Fix choice predicts the outcome perfectly: reset the
counter in `IAMBackend.reset()` → 15/15 solved; `deepcopy` the already-mutated list → 3/3 failed
(codex sweet r0 and r2, opencode sweet r1). `run_tests` could not run the graded file
(`test_iam_resets.py` is absent until grading): `exit=4 trustworthy=no` in every rollout, so
nobody got feedback. One failing rollout diagnosed it exactly ("Resetting then reuses the
mutated object") and deep-copied anyway; another proposed the counter reset and rejected it
"in case hidden tests assert the policy state is fully reset". Sufficiency verdicts: 32 of 33
pre-edit verdicts read `no`/`unknown` in solved and failed reps alike.

**Counterfactual: no tool-output line helps.** Every cue was on screen. The only lever is
executable feedback for the issue's own scenario (register F12, shared and arm-symmetric).

### 2.3 gleam-3458 — a ranking miss plus a grader artifact

Evidence: `forensics/smoke-losses/getmoto-and-gleam.md` Task B.

**Ranking.** `ss-find "definition_location" --regex "definition_location" -k 10` returned the gold
site `type_.rs:954-1014` at **rank 9, score 0.380, summary only** (name and line, no body) and the
wrong site `ast/typed.rs:367-406` at **rank 2, score 0.588, body printed**, under
`confidence=low (many_candidates) sufficient=unknown`. The two opencode sweet reps that relied on
that pack edited the rank-2 file; one never saw the gold arm at any point. The four sweet reps
that ran the flat `ss-grep "definition_location"` all hit the right file. Wrong-file editing is
not sweet-specific — `codex native r2` shipped the identical wrong patch — corrected tally native
1/9, sweet 2/9.

**Grader artifact, arm-agnostic, verified in the logs.** gleam's `build_lock::*` tests print
`Locked!` to stdout while other tests report, so cargo emits lines like
`test dependencies::provided_local_to_manifest ... okLocked!`. `harness/cargo_log_parser.py`
(`_TEST_HEADER_RE` + `_STANDALONE_STATUS`) does not recognise `okLocked!` as a status, leaves the
test unresolved, and the grader counts it as a PASS_TO_PASS failure. `grep -c '^test result:
FAILED'` is 0 in both logs; `n_test_results` drops by exactly the number of corrupted lines
(2615→2614 native, 2615→2613 sweet), and the recorded `failed_from_pass_to_pass` names are the
corrupted ones. Exposure: 3 of 18 gleam rollouts carried a glued status line (codex native r0,
codex sweet r0, opencode sweet r1); the first two had f2p=1.0 and were graded `NO`. Corrected:
codex native 2/3, sweet 3/3. `cargo_log_parser.py` is NOT in the ledger fingerprint
(`GRADER_SOURCE_NAMES` lists `evaluator-runtime.mjs`, `sr-eval.py`, `upstream-patches/eval.py`
only), so a fix would not force a re-sweep and would not be noticed by one either.

---

## 3. What sweet does differently, pool-wide (360 rollouts)

Evidence: `forensics/smoke-losses/census-360-rollouts.md`; per-rollout records in
`forensics/smoke-losses/census/rollouts.jsonl.gz`.

| measure, before the first edit | native | sweet |
|---|---:|---:|
| distinct code locations seen (mean / median) | 113 / 100 | 58 / 51 |
| files read | 6.7 | 4.3 |
| tool-output chars | 59k | 49k |
| used a broad search pattern (case-insensitive, alternation, stem) | 93.3% | 64.4% |
| opened with a single-hit search | 2.4% | 5.0% |
| fraction of the edited file in view (median) | 0.75 | 0.86 |
| read the edited file end to end | 36.7% | 21.7% |

Sweet narrows **laterally** — fewer neighbouring files and fewer identifier-family listings —
not vertically: inside the file it patches it is better covered than native. The singleton
opening is rare (5%); pattern breadth is the real gap (64% vs 93%).

**Within a task, nothing separates a solved sweet rollout from a failed one.** Only 6 of 20 tasks
have both; the best measure is pre-edit output chars at 5 tasks up / 1 down (p=0.219), and it
points the wrong way for any narrowing lever — the winners read more. Every eye-catching pooled
odds ratio is task mix.

**Footers are acted on about one time in three.** Across 902 `# unread below` trailers in 149
sweet rollouts, the agent later read into the named remainder 35% of the time and mentioned a
named symbol in a later command 21% of the time (40% / 32% follow rate in solved / failed
rollouts). A new footer should be expected to perform like that, not like an instruction.

---

## 4. The sufficiency-verdict lever is dead

Handoff §5.3/§7.2 proposed widening the search on a low verdict. Recomputed:

| population | saw `confidence=low`, solved / failed | last verdict YES, solved / failed |
|---|---|---|
| all 20 tasks (n=169 with verdicts) | 67.2% / 92.8% | 34.5% / 18.9% |
| 9 solvable tasks | 67.2% / 90.5% | 34.5% / 14.3% |
| squashql | 100% / 100% | 33% / 25% |
| getmoto | 100% / 100% | 0% / 0% |
| gleam | 50% / 100% | 0% / 33% |

The pooled numbers reproduce, and they measure task difficulty: the 11 never-solved tasks are the
tasks where every search returns low confidence. Across the 6 tasks with both outcomes,
last-verdict-YES points the right way on 2, the wrong way on 1, ties on 3. And the remedy
describes existing behaviour: after `sufficient=no`/`unknown` the next action is another search
52% of the time, a read 29%, an edit 3%. Verdicts are emitted only by `ss-search`/`ss-find`
(about 30% of sweet's tool calls; `ss-grep` and `ss-read` print none). Do not build on it.

---

## 5. Levers, ranked

Register cross-check against `DEAD-LEVER-REGISTER-DRAFT.md`: B12 (whole-file on first touch)
is INVERTED and stays dead — sweet already covers 0.86 of the edited file; F8 (new guide clauses)
stays dead — the shipped P2 clause ("before editing a symbol with visible siblings … spend ONE
mapping call") has the right intent and an unsatisfiable trigger, because the tool never makes the
siblings visible; B9 (completeness card) died on "missed siblings were already in context" with
revival at "≥2 independent starved cases on a new cohort" — this cohort supplies 18 starved
rollouts on squashql but on ONE task, plus a partial on gleam; E4 ("ambient presence did not
produce action") is consistent with the 0/2 bare-name counterexamples and is answered by the 4/4
co-listing evidence. The within-file design note chose below-only "because the miss shape in
evidence was below"; squashql is the first documented above-window miss, with 18 rollouts.

### L1 — same-file identifier family on `ss-grep` singletons and above the `ss-read` window (BUILD, then microsmoke)

Tool-side, sweet-only by construction, no prompt change. Evidence: `forensics/smoke-losses/tool-side-audit.md`.

What exists today: a 1-match `ss-grep` takes no enrichment path at all (`buildIndexedGrepFamilyManifest`
returns null on `results.length < 2` and is a digit-family compactor anyway; the "across N files"
header needs >1 file). `ss-read` computes only `unreadBelow`. The `# same file:` span map is
directionally symmetric but lives inside `packageForAgent`, reachable only from `ss-search`/`ss-find`.
Java fields ARE indexed as `type: 'field'` entities (`subQueryMeasures` is entity L35 in the
squashql golden's `code-graph.db`; verified on the box).

Two lines to add, in this order of expected effect:

(a) **Singleton sibling line on `ss-grep`/`ss-find` (agent format, no `--in`).** When a hit's
enclosing entity has same-file entities sharing its stem (`familyStem` / `informativeSubtokens`)
or field entities its body references, print their lines WITH code, grep-style:
```
# same file (subQuery family): 35: private final Map<Measure, CompiledMeasure> subQueryMeasures; · 55: this.subQueryMeasures = … compileMeasures(query.table.subQuery.measures, false) · 191: private DatabaseQuery toSubQuery(QueryDto subQuery) {
```
Cap 3-4 lines, rank with `selectUnreadSymbols` against the query evidence. This is the exact
artefact that converted 4/4 in the transcripts. Reaches 14/15 squashql failures at step 3-9.
~70-100 LOC (`agent-pack-completion.js`, `search-pattern.js`, `_ss-helpers.mjs`); gate is the
existing `options._isAgentFormat === true && !options.fileFilter`. The line is additive (a
singleton has no body lines to reclaim), ~40-60 tokens.

(b) **`# unread above (1-169): subQueryMeasures, QueryResolver(constructor), resolveField … — continue: ss-read F 1 169`** on ranged `ss-read`, mirroring `unreadBelow` (`search-read.js:454-486`, `renderUnreadBelow`). ~45-60 LOC across `search-read.js`, `_ss-helpers.mjs`, `mcp/read-tool.js`. Gate on `command === 'ss-read'`, NOT `format === 'agent'` (agent is the CLI default, so a format gate leaks into human output). Render before the code fence; `tests/search/within-file-affordances.test.js:489` pins the below-trailer as the last line. Reaches the 15th failure. Expect the footer-follow rate (~35%), not obedience.

Cost, re-send corrected: (a)+(b) ≈ 0.44% of sweet prompt tokens per rollout, ~0.05% in dollars at
93% cache hits. The codex −12.3% and claude-code −26.5% cost figures are untouched. Neither
change requires a ledger re-sweep (`env-ledger.mjs` hashes only `rt-*`, the three grader files
and the shim text) — which also means the ledger offers no protection against an ss-* output
regression; `tests/search/` and the A/B are the only guards.

Expected yield on the smoke's 9 squashql sweet cells: +2 (footer-follow rate) to +5 (co-listing
rate) reps. On codex that moves the task-level tally to sweet 9/20 vs native 8/20 (squashql joins
yasson as sweet-solved) at −12.3% cost — the only path in this pool to "cheaper AND more
resolved". It does not touch the 11 never-solved tasks.

### L2 — cargo parser glued-status fix (SHIP as grader correctness, both arms)

`harness/cargo_log_parser.py`: accept a header suffix matching `^(ok|FAILED)\S` as that status
(concurrent stdout glued to the status token; a genuine test name cannot follow `ok` without a
space). Unit-test with the literal `test dependencies::provided_local_to_manifest ... okLocked!`
line. Add `cargo_log_parser.py` to `GRADER_SOURCE_NAMES` so the fingerprint sees it. Re-grade
the two affected rows and restate the codex leg as 21/60 vs 19/60 with disclosure. Zero
differential; do not book it as a lever.

### L3 — flat hit list beside a low-confidence `ss-find`/`ss-search` pack ($0 screen first)

When the pack's own verdict is `confidence=low sufficient=unknown|no` and the query is an
identifier-shaped literal, append the flat `file:line` list of regex hits (the `ss-grep` form).
Evidence is n=2 (gleam opencode sweet r0/r1). Before building: replay all 180 sweet rollouts'
`ss-find`/`ss-search` calls against the goldens and count the packs where a gold source file is
in the regex hit set but absent from the top-3 rendered bodies. Bar: ≥3 distinct tasks.

### L4 — `ss-trace` correctness on Java (SHIP, zero token cost, low yield)

`structural-source-definitions.js:5-16` `definitionPattern` matches no Java field or method, so
`answer checklist: related definitions=` is blind on Java while the entities table holds the
field. Replace the regex closure with an entity-table lookup (`findEntitiesInRange` by name),
keep the regex as fallback for unindexed files. Also consider a `fields read:` line for the
target method; on `checkSubQuery` the current output ("fan-out=4, all leaves") is actively
misleading. `ss-trace` was called in 6/21 squashql sweet rollouts, so expect little yield.

### Not levers

- getmoto: nothing tool-side. Executable issue witnesses (F12) are the only thing that changes a
  remedy coin-flip, and they are shared.
- The 11 never-solved tasks: firebase (0.67 f2p both arms everywhere), brighterscript (0.50),
  yargs (0.33), rohd (0.25-0.50), ariadne (0.13) are identical across arms; no sweet-specific
  cause.

---

## 6. Test plan (per `/microsmoke`)

**Gate 0, $0, mandatory.** Build L1(a)+(b) behind `SS_SIBLING_LINE=1` / `SS_UNREAD_ABOVE=1`
defaults-on-for-agent. Then: (1) unit tests rendering both lines on a fixture; (2) an offline
replay against the squashql shipped index on the box (`/root/.ss-eval/shipped-index/…`) that
re-issues every `ss-grep`/`ss-read` call from the 21 sweet rollouts and asserts the new line names
`subQueryMeasures` before the first edit in ≥14 of the 15 failures; (3) a replay over all 180
sweet rollouts' ss-* calls to measure added tokens (bar: ≤0.6% of prompt tokens) and to confirm
JSON/raw/GCSN paths are byte-identical. If (2) does not clear 14/15 the trigger is wrong — stop.

**Gate 1, diagnostic and controls (DEV-RET only).** Diagnostic: squashql-295 on codex and opencode
(sweet 0/3 and 1/3 in the smoke; 1/3 and 1/3 in the same-day ablation control). Controls that
must not regress: pulldown-cmark-754 and uniforms-787 (sweet 3/3), rust-analyzer-2616
(multi-file, 3/3), and yasson-395 on codex (sweet's file-selection win, the one place a sibling
line could redirect it).

**Gate 2.** Treatment vs same-day sweet baseline (native has no ss-*, but the ablation showed a
codex cell swing 3/3→1/3→2/3 across identical runs, so a same-day control is not optional).
REPS=3, CONCURRENCY=1 on the box, matched caps, green ledger `luna-smoke20-v5` (no re-sweep needed
for core/search changes). 5 tasks × 3 reps × 2 conditions × 2 harnesses = 60 rollouts ≈ $1.5 at
corrected luna prices. Read on solve flips, not cost: pass if squashql sweet ≥ 4/6 and the four
controls lose ≤1 rep in total; read `breakPricedCostUsd` as well as realised.

**Then, and only then:** the pre-registered fresh-pool rebaseline (`SLATE-C-UBER.md` §6) with L1
on in the sweet arm. squashql is now burned for any blinded claim; it is a diagnostic task only.

---

## 7. Do not

- Do not re-open the gutter, the golden rebuild, or the sufficiency-verdict lever.
- Do not add a guide clause about siblings; the shipped P2 clause already says it and cannot
  fire without the tool cue.
- Do not "read the whole file"; B12 is inverted and sweet already covers 0.86 of the edited
  file.
- Do not quote the −6 rep deficit without the grader correction and the squashql attribution.
- Do not pool a post-L1 run with this smoke.

---

## 8. Evidence paths

| what | path |
|---|---|
| squashql, 42-row table, 2x2s, quotes, counterfactual per failure | `forensics/smoke-losses/squashql-42-rollouts.md` |
| getmoto (18) and gleam (18), reasoning quotes, ranking dump, grader artifact | `forensics/smoke-losses/getmoto-and-gleam.md` |
| 360-rollout census, all tables, cost model | `forensics/smoke-losses/census-360-rollouts.md`, scripts in `forensics/smoke-losses/census/` |
| tool code audit with file:line citations | `forensics/smoke-losses/tool-side-audit.md` |
| footer-follow measurement (902 footers) | `forensics/smoke-losses/census/footer-follow.json` |
| transcript normaliser (box `agent-state/` → per-rollout markdown) | `forensics/smoke-losses/normalize-transcripts.py` |
| raw transcripts | box `results/sm-*-20260902/agent-state/`, `results/ab-sq-*-20260903/agent-state/` |
| glued cargo lines | box `results/sm-codex-20260902/{native,sweet}/logs/gleam-lang__gleam-3458_log.txt` lines 26 / 15 |

Measurement traps met and fixed in the census (keep): `sufficient=YES` is uppercase while
`no`/`unknown` are lowercase; codex sometimes applies patches as a shell heredoc with no tool
call; opencode's grep prints `path:` then `  Line N:`; native never calls `ss-read`, so file
lengths must be harvested from any rollout's `ss-read` header for the same task.

---

## 9. Implementation status (2026-09-03, same day)

Built from §5, in the order the register ranks them. Every item below has unit tests
(`tests/search/grep-output-shaping.test.js`, `tests/search/within-file-affordances.test.js`,
`tests/graph/structural-context.test.js`, `eval/task-completion-bench/tests/evaluator-integrity.mjs`)
and was replayed live against a fresh local index of squashql at `5e866a8` (the parent of the
#295 merge; `QueryResolver.java` is line-for-line the shape in §2.1: field L35, assignment L55,
`toSubQuery` L191, read L207, `checkSubQuery` L210, error string L212).

| lever | shipped as | live output on the transcript's own calls |
|---|---|---|
| L1(a) singleton sibling line | `buildSingletonSiblingLine` (`agent-pack-completion.js`), wired in `bareGrep` → `sweet-search.js` grep case → daemon JSON → `ss-grep` print. Gate: agent format, no `--in`, exactly one result. New repo method `findEntitiesInFile`. | `ss-grep "sub-query in a sub-query is not supported"` now appends `# same file (siblings of checkSubQuery): 35: private final Map<Measure, CompiledMeasure> subQueryMeasures; · 55: this.subQueryMeasures = … · 183: protected void checkQuery(…) { · 191: private DatabaseQuery toSubQuery(QueryDto subQuery) {` — the three-site co-listing that converted 4/4, plus one extra family sibling. Measured 321 chars ≈ 92 tokens on this call with the 90-char per-site cap (the §5 estimate of 40-60 was low; four sites, and the L55 line is long). |
| L1(b) `# unread above` | `unreadAbove` field in `readFile` (chunks ∪ code-graph entities, so fields count; sniff fallback), `renderUnreadAbove` gated on `command === 'ss-read'`, printed before the fence by the wrapper. `mcp/read-tool.js` schema extended. | `ss-read QueryResolver.java 170 235` → `# unread above (1-169): subQueryMeasures, QueryResolver, query, storesByName, cteTableNames +12 more — continue: ss-read … 1 169` (182 chars ≈ 52 tokens). `subQueryMeasures` leads ONLY under an agent session (the span ledger's query evidence ranks it); with no session the list is file-ordered and the field is in the `+12 more`. |
| L2 cargo glued status | `_GLUED_STATUS_RE = ^(ok\|FAILED)(?=[^a-z0-9_])` on header suffix AND standalone line; `cargo_log_parser.py` added to `GRADER_SOURCE_NAMES`; fingerprint **version 5**. | Parser unit fixtures include the literal `test dependencies::provided_local_to_manifest ... okLocked!`. **Consequence: every ledger row is now stale by construction. A gold re-sweep (→ `luna-smoke20-v5`) is required before Gate 1/2, and the two gleam rows (codex native r0, codex sweet r0) still need re-grading on the box.** |
| L4 ss-trace Java definitions | `findSameFileDefinition` consults the entity table first (`_findIndexedSameFileDefinition`), regex scan is the unindexed-file fallback. Plus: `this.x` / `self.x` / `self::x` / `@x` member reads get +4 in `rankedTerms` — the audit's §5 claim that `this.subQueryMeasures` was already a target term was wrong (it ranked below `FIXME` and `private`, past the 24-term cap). | `ss-trace toSubQuery` → `related definitions=resolveField [method] …:85 … \| subQueryMeasures [field] …:35`. `checkSubQuery` still shows nothing here, as §2.1 predicted (its body does not read the field). |
| L3 flat hit list | **Not built.** It is a $0 screen first (replay all 180 sweet rollouts' `ss-find`/`ss-search` calls against the goldens; bar ≥3 distinct tasks) and the transcripts live only on the box. | — |

**Off-switches.** `SS_SIBLING_LINE=0` and `SS_UNREAD_ABOVE=0`, read in the wrapper's own
process. The first cut read them in core and that was wrong: the warm daemon inherits the env of
whichever client spawned it, so one `SS_SIBLING_LINE=0` call pinned the line off for every later
call until the daemon died (reproduced live). The grep switch now travels as the `_siblingLine`
request option (`siblingLine=false` URL param); the read switch gates render only, the field is
always computed.

**Gate 0 status — CLEARED (box, 2026-09-03, $0).** Replay tooling: `/root/replay-squashql.py`
(21 squashql sweet rollouts, all ss-* calls re-issued in order against a writable copy of the
shipped golden, per-rollout session ids so the span ledger's query evidence flows) and
`/root/replay-all.py` + `/root/replay-tokens{,2}.py` (all 180 sweet smoke rollouts, 1,973 ss-*
calls; results `/root/replay/all-replay-v3.jsonl`).

(2) *named before first edit*, bar ≥14/15 failures. First cut (singleton grep + unconditional
above-line): **11/15**. The misses were a 2-hit same-file `ss-grep "checkSubQuery"`, two packs
(`ss-search` top-1 was the class; `ss-find "checkSubQuery"` top-1 a method chunk), a read whose
session had no query evidence (native `rg` first), and claude-code r0, which made **no ss-* call
before its first edit** (unreachable by any tool-side lever). Trigger widened in `03d2401`:
1-3 hits in one file (families merged), a pack-side line on a method/function top-1 keyed on
the symbol's own declaration line, and window-referenced symbols ranked first in the above-list.
Result **14/15**, i.e. every reachable failure; 19/21 overall.

(3) *added tokens ≤0.6% of prompt tokens* under the pessimistic re-send model (an added line
is re-sent on every later turn; prompt tokens from `rows.json` for codex, `turns/` for
opencode, the OpenRouter billed json for claude-code):

| version | what fired | codex | opencode | claude-code |
|---|---|---:|---:|---:|
| v1 (`03d2401`) | above-line on every ranged read (80% of reads, 78% of all added tokens) | 0.402% | 0.724% | 0.521% |
| v2 (`739b376`) | above-line only when the window names an above symbol or the query does | 0.364% | 0.657% | 0.472% |
| v3 (`04b3d50`) | signal = a STATE read (field/constant in window, or `this.x`/`self.x`) or query evidence | **0.327%** | **0.577%** | **0.418%** |

v3 clears the bar on all three harnesses; squashql stays 14/15 (its 170-235 window reads
`this.subQueryMeasures`). One-shot (no re-send) pooled share is 0.079%. The §5 estimate of
0.26-0.44% was for the singleton form only and did not count the above-line's fire rate.

Byte-identity: `readFile` JSON carries an `unreadAbove` key on range reads (structured, mirrors
`unreadBelow`, `referenced` flag per symbol); grep/pack JSON carries `siblingLine` only under
agent format; raw and GCSN paths untouched (`tests/search` + `tests/graph` + `tests/mcp` green).

**Gate 1/2 — RUN 2026-09-03 15:19-16:47Z, VERDICT: L1 IS DEAD ON SOLVES.** Realised spend $0.65.

| leg | squashql (diagnostic) | pulldown-cmark | uniforms | rust-analyzer | yasson | calls | ideal $ |
|---|---:|---:|---:|---:|---:|---:|---:|
| codex, lines ON | **0/3** | 3/3 | 3/3 | 3/3 | 0/3 | 175 | 0.161 |
| codex, lines OFF | 0/3 | 3/3 | 3/3 | 3/3 | 0/3 | 189 | 0.173 |
| opencode, lines ON | **0/3** | 3/3 | 3/3 | 3/3 | 0/3 | 311 | 0.135 |
| opencode, lines OFF | 1/3 | 3/3 | 3/3 | 3/3 | 2/3 | 301 | 0.135 |

Diagnostic pooled: ON 0/6 vs OFF 1/6 against a bar of ≥4/6. Exposure was complete — every ON
squashql rollout had `subQueryMeasures` named before its first edit (codex: r1 and r2 by the
sibling line at call 1-2, r0 by the above-line at call 2; opencode: r1 by the sibling line at
call 2, r0 and r2 by the above-line at call 3) — and every one of the six patched only the
`checkSubQuery` guard. Two codex agents wrote the same sentence: "the compiler already recurses
through `compileTable` → `toSubQuery`; the explicit guard is the sole blocker." The 4/4
co-listing conversion in the smoke transcripts was therefore an effect of intent (those agents
had already searched FOR the field), not a cause; §2.1's two "surfacing is not enough"
counterexamples were the rule. Controls: the three passing tasks stayed 3/3 in all four legs;
yasson and squashql OFF > ON by 2 and 1 rep, inside the codex-cell variance the ablation
documented (native 3/3 → 1/3 → 2/3), not evidence of harm. Cost: ON is 7% cheaper on codex
(ideal, and 14 fewer calls) and equal on opencode; noise at n=15.

**Disposition (`3e2ee4a`).** Both lines are now OPT-IN (`SS_SIBLING_LINE=1`,
`SS_UNREAD_ABOVE=1`); code, unit tests and the $0 replay tooling stay for a future cohort with
a different failure shape (the mechanism does deliver the fact; the model declines it). L2
(grader) and L4 (ss-trace Java + receiver-member term boost) are correctness and stay on.
Register: F21. Still owed: re-grade of the two gleam rows under the fixed cargo parser; the
gold re-sweep of the full 20-task ledger under fingerprint v5 (only the five Gate-1 tasks were
re-swept, `/root/env-ledger/luna-gate1-fp5`).

*(Launch record follows.)* **LAUNCHED 2026-09-03 15:19Z** (`/root/gate12-driver.sh`, logs `/root/gate1/`, ledger
`/root/env-ledger/luna-gate1-fp5` re-swept 5/5 gold-valid under fingerprint v5, preflight
green). Four legs staggered 15 min, each `CONCURRENCY=1 REPS=3 ARMS=sweet`, luna via OpenRouter,
`REASONING=medium`, default caps: `g1-{on,off}-{codex,opencode}-20260903`. Control = same
code with `SS_SIBLING_LINE=0 SS_UNREAD_ABOVE=0` in the leg env (client-side switches; the
codex-task-runner spreads `process.env` into the rollout, so they reach the wrappers). Read:
squashql sweet ≥4/6 pooled over the two `on` legs, and the four controls lose ≤1 rep in total
versus `off`; `breakPricedCostUsd` beside realised.
