# c10 — adversarial verify, HISTORY lens

**Verdict: REFUTED as a Slate-C lever. Confidence 0.88.** Both halves have a recorded
killing fact. The guide half proposes to weaken the single clause that the prompt-optimization
tournament built, measured, and shipped **to close the largest cost gap sweet had against
native** — the no-match stratum — and the record names five variants that weakened it and
spiralled. The code half is register row **E2**, which is SHIPPED, whose ceiling was measured at
0.99% of cost and under one task, and which was booked "as correctness with no benchmark value
claimed". A precedent inside the same class, the BRE `\|` false-zero bug, ran at 10–15 times
c10's population, was explicitly flagged as interacting with this same guide sentence, was fixed
with both a retry and an honest note, and produced no measured benchmark value. One sub-item
(the alternation prefilter) is a genuinely new and real code defect; I reproduced it. It belongs
on the product-correctness backlog under E2, never in a cost-or-solve slate.

---

## 1. What I verified in code first, so the refutation is not about the facts

The candidate's three code claims are true. I confirmed each one myself.

`[M script /private/tmp/.../scratchpad/c10-probe.mjs, run locally, $0]` The native literal
extractor drops a short alternation branch instead of abandoning the prefilter:

| pattern | `extractRegexLiteralClauses` returns | JS heuristic returns |
|---|---|---|
| `foo\|ab` | `{"clauses":[["foo"]]}` | `[]` (correct) |
| `handleRequest\|on` | `{"clauses":[["handleRequest"]]}` | `[]` (correct) |
| `toString\|id` | `{"clauses":[["toString"]]}` | `[]` (correct) |
| `parseConfig\|fmt` | `{"clauses":[["parseConfig"],["fmt"]]}` | `[]` |

`extractLiteralClauses` prefers the native result, so the safe JS branch never runs
`[C core/search/search-pattern-prefilter.js:153-176]`. A file that matches only the dropped
branch is excluded before the regex ever sees it. The defect is real and it is new.

`[C core/search/grep-output-shaping.js:17-19, 67-68]` `pathSegments('.')` returns `[]`, and the
next line rejects an empty scope, so `--in .` matches no file at all.

`[C eval/agent-read-workflows/bin/_ss-helpers.mjs:251]` `excludedScopeNote` returns `null` when
the path does not exist, so line 380 prints `(no matches)` for a scope that was never searched.

`[C core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md:45-46]` The guide
sentence is where the candidate says it is, under the heading "A confirmed absence is a complete
search answer".

So the refutation below is not about whether the defects exist. It is about whether this
mechanism is new, and whether it can move the two numbers Slate C is asked to move.

---

## 2. Killing fact 1 — the guide sentence is a measured, tournament-won clause built to fix
the exact stratum where sweet was most expensive

This is the finding the candidate does not mention and does not escape.

`[M memory project_p7_gen2_postmortem.md]` The gen-2 post-mortem (2026-05-30) measured the
champion prompt against native by query stratum. Multi-file flow was 0.52 times native cost.
Behavioural was 0.70 times. **Literal lookup was 1.83 times and no-match was 4.73 times.** The
recorded counterfactual: "fix no-match→native lifts finalScore 0.294→**0.3675**". That single
stratum was worth about a quarter of the whole optimization objective.

`[M same file]` The remedy drafted in response was seed candidate **A**, described verbatim as
"no-match sufficiency ('two complementary empty probes = conclusive, STOP')". **That is the
sentence at line 46.** Its wording survives into the shipped `p7-final` guide almost unchanged,
and into every M-lineage variant in `p7-gen3-candidates/` `[C 22 of 42 gen-3 variant files
carry it; the 20 that do not are A, Astar, B, C, D, E, F, G, H, I, J, K, L, N, O, P, R and the
three Mpp-gpt / Mpp-gemini / Mpp-manual re-drafts]`.

`[M memory project_p7_gen2_postmortem.md]` A then became the gen-3 champion and beat native
overall: "Sonnet 0.63×, GPT 0.58×". The residual gap was again "literal 1.49× ✗, **no-match
2.42× ✗**".

`[M same file]` The record then states what happens when the clause is weakened, twice:

- "no prior candidate combined anchor-first/trace-first ROUTING with A's FULL emphatic PROSE
  absence rule (**B/R/N/T5/T6 all compressed the stop rule → Sonnet spiral**)".
- "keep ... the FULL emphatic no-match absence rule (**NEVER compress — D/R/N failure**)".

`[M same file]` The mechanism of the spiral is named: raw shell defection. "11.1% of A's calls
(239/2158) are raw shell, **67% of it in no-match = the spiral itself** (Sonnet defects to
find/xargs grep/ls/cat after index probes empty)."

The candidate proposes to "replace" that sentence with a "searchability-conditioned rule". A
condition on a stop rule is a weakening of a stop rule. The record has five to six named
variants that did that and spiralled, in the one stratum where sweet was already 2.4 to 4.7
times dearer than native. The candidate's own ceiling agrees on the direction: "requests
expected to rise".

**Honest limit on this fact.** Those measurements are on the retrieval-probe benchmark, with
Sonnet and GPT-5.5 backbones, in 2026-05. They are not the task-completion bench and not the
luna backbone `[I]`. The clause has never been ablated on the task bench. But the register's own
rule is that a row is revived only by its revival condition, and c10 supplies no evidence that
post-dates or bypasses this record. It does not cite it at all.

## 3. Killing fact 2 — the pendulum on this exact rule has already swung both ways

`[M memory project_p7_consumer_clean_variants.md:16]` An earlier pass removed a hard
"no-match after 2 attempts" cap for precisely the reason c10 raises: the cap "contradicted EAS
windows [3,6] and **manufactured false negatives — the no-match-precision risk**". It was
replaced with "verify absence before no-match". The M lineage then re-introduced the two-probe
rule, and that version won the tournament. The false-negative objection is therefore not new
information; it was raised, acted on, and reversed by measurement.

## 4. Killing fact 3 — register rows P1 and P2 kill the clause family

`[M register §7 P2]` The retrieval-discipline "exemplar stop" clause is **DEAD**. Its record:
"A clean −13% cost win alone on 6 tuning tasks went **neutral** on 6 fresh never-tuned tasks,
which is overfitting. Combined with the read-fix lever it **regressed one task's solve
(1/2 → 0/2) twice independently in two separate waves**."

That is the same shape as c10: a read/grep correctness fix plus a stop-clause edit, shipped as a
pair. The recorded outcome of that pairing is a solve regression, twice. Solve is the veto.

`[M register §7 P1, CLAUSE-SCREEN-RESULTS.md]` General engineering clauses in the guide are
**DEAD** on a 153-rollout screen: every condition solved exactly 3 of 8 tasks and 9 of 24
rollouts. A "searchability-conditioned rule" is a general engineering clause.

`[M register A1, A6]` The current backbone is instruction-deaf to efficiency and mid-task
guidance: an external replication measured explicit efficiency instruction at zero change,
p=1.0, and mid-task advisories were refuted 3 of 3.

`[M register 0.1, owner decision 2026-08-10 / 2026-08-13]` The guidance block is owner-protected.
The candidate flags this correctly, but a needs-user-decision flag does not answer a measurement.

---

## 5. Killing fact 4 — the code half is register row E2, already priced and already booked as
carrying no benchmark value

`[M register §5 E2, SHIPPED]` The row reads: "A separate census found 251 grep calls, 31 with a
scope flag, 11 directory scopes, of which **10 (91%) returned a false zero match**; that lever's
**ceiling was 0.99% of cost and under one task**, so it **shipped as correctness with no
benchmark value claimed**. The review panel explicitly rejected the zero-behavioural-risk
framing."

The shipped fix for that census is visible in the code the candidate cites. The comment above
`matchesGrepFileFilter` names the identical symptom `[C grep-output-shaping.js:38-43]`: "The
previous rule required the run to end at the final segment, so a directory scope matched nothing
at all: `ss-grep … --in tests/testthat` printed '(no matches)' — indistinguishable from a regex
that genuinely misses."

**`--in .` is that bug, one instance short of its own fix.** It is not a new class. The test file
already exercises `./tests/testthat/test_x.R` and `./tests/testthat` and passes, because the
leading `./` is stripped and real segments remain; only the bare `.` case is untested
`[C tests/search/grep-output-shaping.test.js:45, 56]`. The absent-scope item is classed by the
candidate's own source document as "extends E2", not as new
`[M forensics/claude-main-thread.md §7]`.

## 6. Killing fact 5 — the same mechanism at 10 to 15 times the population produced nothing

`[M memory project_failure_forensics_review_2026_07_14.md:14]` The BRE dialect bug: agents write
`foo\|bar`; the Rust regex crate treats `\|` as a literal pipe, so `ss-grep` returned **silent
false zeros in 30 of 166 sweet rollouts, 78 calls**. The record names the interaction the
candidate rediscovers: "**Interacts badly with M+++++ settled-absence rule.**" Its prescribed
remedy is c10's remedy: "agent-gated BRE→ERE retry-on-zero + dialect trailer note".

`[M memory project_cost_forensics_results.md:22]` The re-audit widened it to **85 rollouts, 175
calls, 113 zero answers**, and priced the cost side at $4.20 plus $0.92 of reformulation.

`[C core/search/regex-dialect.js:305-327; _ss-helpers.mjs:321-324]` Both halves shipped: the
retry (`retryAttempted` / `retryMatched`) and the honest note ("Rust syntax treats `\|` as a
literal pipe").

Outcome recorded for that work: E2, "no benchmark value claimed", ceiling 0.99% of cost.

c10's population is a fraction of that. `[M forensics/claude-main-thread.md §6.1-6.2, denominator
198 sweet claude-code rollouts across `fp-claudecode-{tab,none,pipe}-20260826`]`: 692 single
`ss-grep` calls, 219 zero answers, 71 false-negative candidates, of which **64 are index-coverage
exclusions already fixed by E1**, **2 are genuine**, and 5 are mixed. The alternation defect is
**1 event in 198 rollouts**. `--in .` is 5 calls. Absent scope is 11 calls.

A class that was fixed at 175 calls and yielded no measurable benchmark value will not yield one
at 17.

## 7. Killing fact 6 — the candidate's headline instance is recorded as already fixed, and it
solved anyway

`[M forensics/verify-tail.md §6]` On `aws-actions__configure-aws-credentials-42`, sweet edited
the committed 35,000-line bundle in 3 of 9 rollouts against native's 9 of 9, and sweet's tails
there ran 71 requests against native's 38, +$0.0153 over 9 sweet rollouts. The same paragraph
then says, in its own words: "Commit 36b802e (2026-08-28, after these runs) added
`excludedScopeNote` ... its comment names `dist/index.js` as the motivating case. The same commit
re-admits git-tracked files under build-output directories ... **This mechanism is therefore
recorded (register rows E1, E2); this report adds its price**."

And: "**All 18 rollouts solved**, so this is cost and real-world correctness ..., not bench
resolution."

Per-cell price of the whole bundle hunt: +0.5% of a codex rollout, +0.7% opencode, +0.7%
claude-code `[M verify-tail §6]`. That is inside E2's already-recorded 0.99% ceiling.

## 8. Killing fact 7 — the one genuine false negative sat on a rollout that solved

`[M forensics/claude-main-thread-timelines.md:106]`
`fp-claudecode-tab-20260826/callstack__react-native-paper-972/sweet/rep2` — 37 requests,
$0.020387 realized, **resolved = true**.

`[M forensics/claude-main-thread.md:72]` The fix edit landed at **request 9**. The alternation
false negative happened inside requests 10–28, a tail hunting a lint convention, which ended in
"three edits at 29–31 that add and revert the same rename". No solve was at stake. Whether an
honest answer would have shortened that tail or instead have driven the rename that was added
and reverted is not determined by the record `[I]`. The brief's own trap list applies: a
fixed-trajectory replay "gets the direction of a context change right about as often as not and
never the size".

## 9. Two sub-items are mis-classified, not new

`[M forensics/phase-anatomy.md §6.5]` The 7 `ss-semantic` `[FALLBACK]` results and the 13,396-token
`ss-read dist/index.js 1 1000` are **not false zeros**. Both return the full content. The agent
is not told an absence; it is told too much, with a weak label. Of the 7 fallback instances, 5
were `dist/index.js` and 2 were `src/build/targets.py` and `src/build/property.jam` — and those
two are exactly what E1 (36b802e) fixed by indexing `.jam` and re-admitting git-tracked source
under build directories `[C commit message; register E1]`. Filing these under "absence honesty"
inflates the candidate's population by conflating a labelling gap with a false-negative.

Note also that a **larger** absence-shaped population sits in a different Slate-C candidate:
c11 records seven consecutive claude-code result deletions ending in a report that "ss-* searches
find only tests" — a size failure read as an absence `[M candidates/DEDUP.md c11]`. If the
synthesis wants an absence-honesty lever, that population is bigger than c10's.

## 10. The candidate's own falsifier has already been run, and it is what refutes it

The stated `$0` falsifier is: "Replay every recorded zero-result `ss-grep` from `fp-*` and
`fixval-*` against goldens with `grep -E`, same flags and scope
(`/tmp/wf-slatec/claude-main-thread/ss-grep-nomatch-audit.mjs`)".

That script has run `[M forensics/claude-main-thread.md §6, outputs
`scripts-claude-main-thread/out/ss-grep-nomatch-audit-fp-claudecode-{tab,none,pipe}-20260826.json`]`.
Its answer is section 6 above: 2 genuine misses in 198 rollouts, 64 of 71 candidates already
closed by E1. The falsifier did not survive; it fired.

The stated kill condition also cannot discriminate. It reads "genuine false absences still above
**1 per 200 rollouts** after the fixes". The measured **pre-fix** alternation rate is 1 per 198
rollouts. A bar set at the pre-fix rate cannot separate a fixed system from an unfixed one.

The guide half's kill condition — "raises `ss-*` calls per sweet rollout >10% in a later paired
run" — requires a paid run. Slate C is `$0`. And the p7 record already ran that experiment on
five variants and recorded the spiral.

---

## 11. What survives, and where it belongs

One item survives as a **product-correctness backlog entry**, not a lever:

- **The alternation prefilter false negative.** New mechanism, not in E2's list, reproduced by me
  above. It silently drops matches for any pattern of the form `long|short` where the second
  branch has no 3-character literal — a common agent spelling. The fix is small: make
  `extractRegexLiteralClauses` return no clauses when any branch yields none, matching the JS
  heuristic's documented behaviour. It has no measured cost or solve prize on this bench, and it
  must not be booked as one.

The `--in .` fix is a one-line completion of an already-shipped fix and should ship with it, as
correctness, with the same "no benchmark value claimed" label E2 carries.

**The guide edit should not be made.** It weakens a clause with a measured provenance, in the
direction the record calls a spiral, against a stratum where sweet's disadvantage was largest.

---

## 12. What I could not finish

- I did not settle whether `dist/index.js` is indexed after fb9f936. Commit 36b802e re-admits
  git-tracked build output, while fb9f936 skips committed bundles by content shape; the two
  documents assert opposite outcomes for a 35,000-line webpack bundle `[C conflict between
  verify-tail §6 and the fb9f936 commit description]`. It changes the size of the residual
  `ss-semantic` fallback item, not the verdict.
- I did not re-run `ss-grep` end to end. The house rule forbids using `ss-*` to develop
  sweet-search, so I exercised the pure functions directly instead.
- I did not open the box. Everything here is local code, local forensics documents, the register,
  and memory notes.
- I did not ablate the absence sentence on the task bench. Nobody has. That is the honest gap in
  killing fact 1, and it would cost money to close.
