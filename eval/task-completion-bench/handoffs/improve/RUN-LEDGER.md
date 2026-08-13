# RUN-LEDGER — lever hunt for sweet cost + resolution on all three harnesses

**Date:** 2026-08-12 · **Data:** 204 rollouts (17 rotated DEV-RET tasks x 2 arms x 2 reps x 3
harnesses, Luna backbone), read-only · **Spend this session: $0.** No rollouts launched, nothing in
`results/` mutated, HO2 untouched.

**Panel:** 3 model families x max reasoning effort. **30 proposals · 0 survivors** · 36 subagents +
6 direct GPT calls · ~4.5M subagent tokens.

---

## Verdict

**Two routes flip claude-code, and either one alone is enough. Sweet can be cheaper on all three
harnesses. Resolution does not move, and this task set has almost no retrieval-shaped headroom left
to move it.**

> **Correction, made after the first draft of this ledger.** The first draft reported an empty slate.
> That was an error of calibration, not of measurement. Every lever was judged **alone** against a bar
> of "3% of sweet's total cost", when the thing that must be closed on claude-code is the **gap** of
> $0.00475 (2.38%). No single lever had to clear 3%. Two levers that died narrowly are **additive and
> sweet-relevant**, and stacked they flip the sign. The individual measurements below were correct;
> the conclusion drawn from them was not.

> **Second correction, after GPT-5.6 Sol adjudicated the portfolio (verdict: UNPROVEN, high
> confidence).** The claude-code gap this whole hunt tried to close **is not statistically
> distinguishable from zero.** Across the 17 paired task deltas the per-task SD is $0.003567 and the
> standard error $0.000865; the 95% interval on the aggregate runs from about **−$0.0264 to
> +$0.0359**, and the sign-flip p-value is about **0.79**. The handoff's own §0 table says the same
> thing: p = 0.909 both-solved, p = 0.784 all-paired. Rep 0 alone puts sweet at **+26.24%** and rep 1
> at **−17.28%**. So the honest statement is not "sweet loses on claude-code" and not "these levers
> fix it" — it is **"at n=17 the claude-code comparison cannot resolve a difference in either
> direction."** Everything below is a plan for a target that may not exist.

**Route 1 — product (levers A + B).** Honest stacked arithmetic, with B applied fairly to both arms:

| step | native | sweet | gap |
|---|---|---|---|
| today | $0.19922 | $0.20396 | **+2.38%** |
| + static-prefix cache-key alignment (both arms) | $0.17224 | $0.17456 | +1.35% |
| + envelope density pass (sweet only) | $0.17224 | $0.17060 | **−0.95%** |

Note the denominator shrinks too, so the naive "133% of the gap" reading overstates it. The honest
result is about **−1%**, a thin margin well inside the n=17 noise band. It needs a real run.

**Route 2 — accounting (F-1), $0 and independent of any code change.** The claude-code ledger
excludes subagent spend; native uses subagents 3.25 times more than sweet. Correcting it moves
claude-code from **+2.2% to −3.0%**.

The two routes are independent and both are real. Route 2 is cheaper, larger and already verified;
Route 1 is a genuine product improvement that must be earned in a live run.

Three claims, each verified independently by me against the artifacts this session:

1. **The claude-code ledger does not count subagent spend.** Native spawns subagents in 8 of its 17
   claude-code task-arm cells; sweet in 2. Native's off-ledger spend is $0.0319 against sweet's
   $0.0098 — a ratio of 3.25 to 1. Folding it back in moves claude-code from **+2.21% to −3.02%**.
   Cost then reads as a clean sweep: codex −6.5%, opencode −17.8%, claude-code about −3%.
2. **Resolution has no retrieval-shaped headroom on these 17 tasks.** The single best case for a
   "find the sibling fix sites" lever was `joshuakgoldberg__bingo-274`. Three of its missing code
   files **do not exist at base** — they are new files. No retrieval mechanism can surface a file
   that is not there.
3. **Every one of the 30 proposed levers is dead.** 17 died at the $0 exposure gate; 13 were refuted
   by an adversarial panel drawn from families that did not propose them. Nine were first killed by a
   faulty regex screen; all nine were recovered and re-judged on their merits, and two of them
   reached the panel as genuine live candidates before dying there.

Solve is the veto dimension, so no cost number here is offered without its solve number beside it.
**Every solve number below is zero.** Sweet leads on solve only on codex (10 of 17 against 9) and
ties 9-9 on the other two harnesses. Nothing in this hunt changes that.

---

## Ranked slate — SURVIVORS (as a PORTFOLIO, not individually)

No single lever clears the 3% bar alone. **Two clear it together, and together is what the goal
requires.** Both are sweet-relevant and both are solve-neutral, so neither risks the veto dimension.

### 1. Envelope density pass · sweet-only · $0.00396 = 83% of the gap · evidence DIRECT (replayed)

**Mechanism.** Thinner ss-* result rendering in the agent-format renderer only — the *result set* is
unchanged, only its presentation. Drop repeated line-number prefixes, collapse blank runs, collapse
**non-documentation** comment runs.
**Why it is credible.** Not estimated. A gate replayed the proposed renderer over **all 1,204,262
recorded ss-* output characters** and measured 5.7%. A refuter then re-ran it enforcing the gate's own
requirement that doc comments survive, and the ceiling fell to **1.9%**. Both numbers come from the
same replay over real recorded output; they agree on the payload and differ only on what may legally
be removed. **1.9% is the number to plan against, not 5.7% and certainly not the 18.95% that raw
ss-* payload share suggests.**
**Applicability.** All three harnesses; measured on claude-code, where it matters.
**Solve effect.** Intended zero — it removes presentation, not results. This is the risk to watch:
it does remove characters the model reads.
**Next experiment.** $0 first: re-replay with the doc-comment guard and confirm 1.9% independently,
then diff a sample of before/after renderings for information loss. Only then a micro-smoke on 2
diagnostic tasks plus a control, REPS≥2, matched caps. **Pre-registered bar: no control regresses on
solve, and the measured payload drop is at least 1.5%.**

### 2. Static-prefix cache-key alignment · both arms, differential $0.00243 = 51% of the gap

**Mechanism.** Deliver the existing sweet tool descriptor and memory bytes as one byte-identical
provider-cacheable system-prefix segment placed **before** task-specific content. No trimming, no
text change — that distinguishes it from the dead preamble-trim lever.
**Why it is credible — there is an existence proof in the data.** Turn-1 cache serving already
happens on **codex**: 66.4% of native turn-1 and 63.8% of sweet turn-1 are served from cache. On
**opencode and claude-code it is 0.0%**. So cross-rollout turn-1 prefix caching is not hypothetical;
one harness does it today. The sweet prefix is exactly +1457 tokens (codex/opencode) and +1589
(claude-code, ranging 1,585-1,590) with **near-zero variance across all 17 tasks**, which is close to the stability a cache key
needs.
**The fairness point, stated plainly.** Applied honestly this helps **both** arms: it saves native
$0.02697 and sweet $0.02940 on claude-code — about 13.5% of the bill, a large absolute win. The
*differential* is only the difference, $0.00243, because sweet's prefix is bigger. Do not report the
absolute number as a sweet win.
**Solve effect.** Zero. No content changes.
**Next experiment.** $0: instrument what the claude-code runner actually sends and determine why
turn-1 is 0% cached there when it is 66% on codex. That diagnosis is the whole lever. If the cause is
task-specific content preceding the stable block, reordering is the fix; if the harness cannot
cache-serve a first request at all, the lever is dead and costs nothing to have asked.

### Adversarial verdict on the portfolio — GPT-5.6 Sol, high effort: **UNPROVEN** (high confidence)

The portfolio framing was mine, added after the panel closed, so I put it to the third family
separately. Sol confirmed two things and demolished a third.

**Confirmed — the two levers are genuinely additive, zero overlap.** B acts on the fixed prefix
present in request 1, before any tool result exists; A acts on the later ss-* result stream (302,207
tokens). "Cache hashing may couple later requests operationally, but it does not double-count these
spans."

**Confirmed — B is physically possible.** Today's 0% turn-1 cache rate "demonstrates no current
cross-session reuse, not impossibility."

**Demolished — three corrections I owe:**

1. **My "variance zero" claim was wrong for claude-code.** The prefix delta is **1,585–1,590 tokens**
   (mean 1,587.5, total 26,988), not invariant at 1,589. It is exactly 1,457 on codex and opencode.
   B is therefore $0.0024289.
2. **B cannot recover its full ceiling, by construction.** "The first request against a cold cache
   cannot read the prefix it is simultaneously creating, so its premium is structurally unavoidable."
   A sequential 17-task run recovers **at most 16/17** of B, less under TTL expiry, concurrency, or
   cache-scope isolation. Sol's sharpest constraint: **with A fully realized, at least 6 of the 17
   task starts must cache-hit for the portfolio merely to cross zero.**
3. **A's solve risk is real, quantified, and unmeasured.** A changes all 17 tasks, all 34 reps, all
   294 ss-* calls, and **every one of the 14 successful sweet reps**. Critically: **four of sweet's
   nine claude-code task solves rest on a single successful rep.** Losing one takes the tie from 9-9
   to 8-9 and **fails the solve veto**. Preserving doc comments reduces the risk without establishing
   equivalence — line-number prefixes, blank structure and non-doc comments can carry navigation or
   intent. The replay measured cost, not solve.

**Sol's closing judgement, quoted:** "there is no double-counting and a flip is physically possible,
but the evidence does not support claiming it will survive a real run with the solve veto intact."
The portfolio must realize **at least 74.3%** of the combined ceiling to flip at all; A alone leaves
$0.00079 unrecovered.

**Replicated.** Sol was run twice, independently, at `xhigh` and at `high`. Both returned
**unproven / high confidence** with separately derived arithmetic. The second run supplies the number
that settles it: after stacking both levers the mean advantage is **$0.0000966 per task against a
standard error of $0.000865 — 0.11 SE**, with an approximate task-level 95% interval of −$0.00193 to
+$0.00174. It also sharpened two figures: the gross transform removes 68,643 of 1,204,262 characters,
and **38.7% of the collapsible comment mass carries no doc marker yet may still be semantic**; and
even granting B in full, **A must realize more than 58.5% of its ceiling merely to cross zero**.
Claude-code's solve baseline is 15 native against 14 sweet solved reps — one lost sweet task takes
the veto result to 8-9.

**Where that leaves it.** The portfolio is a *hypothesis worth one cheap test*, not a fix — and the
target it aims at is inside the noise. −0.95% is descriptive of these recorded cells, not a
population result. Do not spend on it before deciding whether a claude-code cost difference is worth
resolving at all. **Resolving it needs more tasks or more reps, not more levers.**

---

What follows in "Findings that do survive" are **not levers** — they are defects and corrections.
They change the scoreboard or the code, not the agent's behaviour. I keep them separate deliberately
so nobody reads a bug fix as a product win.

---

## Findings that DO survive (not levers — defects and corrections)

### F-1. Claude-code's cost loss is off-ledger subagent spend · evidence DIRECT · verified by me

**What is wrong.** The claude-code runner records only the main session. When the model uses its
subagent tool, that subagent runs as a separate session and its tokens never reach `rows.json`.
Native uses the tool far more than sweet, so the ledger under-charges native.

**How I verified it — exact, not inferred.** I walked every assistant record under
`results/sb-claudecode-20260811/agent-state/*/claude-home/projects/*/*/*.jsonl`, deduplicated on
requestId, and split on the `isSidechain` flag. Cross-check on `redboltz__mqtt_cpp-466` native: the
main-session-only totals are input 69, cache-write 51,829, cache-read 445,319, output 4,327. The two
`rows.json` reps sum to input 42+27=69, cache-write 28,168+23,661=51,829, cache-read
288,451+156,868=445,319, output 2,734+1,593=4,327. **Exact match on all four counters.** The
sidechain records appear nowhere in the ledger. Exclusion is proven, not assumed.

| | cells with a subagent | subagent requests | cache-read | output | off-ledger cost |
|---|---|---|---|---|---|
| claude-code native | **8 of 17** | 121 | 581,083 | 18,681 | **$0.03194** |
| claude-code sweet | **2 of 17** | 35 | 325,588 | 5,603 | **$0.00982** |
| codex, both arms | 0 of 68 rollouts | 0 | — | — | — |
| opencode, both arms | 0 of 68 rollouts | 0 | — | — | — |

**Effect, at the ledger's own prices ($0.10/M in, $0.01/M cache-read, $0.60/M out):**

| basis | native | sweet | result |
|---|---|---|---|
| as published, from `rows.json` `breakPricedCostUsd` | $0.1992 | $0.2040 | **+2.4%** |
| my recomputation of the same main-session-only mass | $0.40444 | $0.41340 | **+2.21%** |
| plus subagent spend | $0.43639 | $0.42322 | **−3.02%** |

Read the table this way: rows 1 and 2 are **the same quantity**, measured two ways. The published
+2.4% and my +2.21% differ only because I price cache-creation at the input rate rather than calling
the runner's own pricing function; the dollar columns differ in scale because rows 2 and 3 sum raw
per-cell token mass while row 1 is the runner's per-rollout figure. Row 3 is the only new
information: it is row 2 with the excluded subagent tokens added back. **The sign flip is the
finding; the exact magnitude is not.** A refuter working from the published baseline computed the
same flip as +2.38% → about −2.9%.

**Effect on solve: ZERO.** No rollout and no patch changes. Claude-code stays 9 of 17 both arms.

**Honest caveats.** (a) This is a token audit re-priced by me, not by the runner's own pricing
function; my recomputed main-only totals run about 1.4% above the recorded ones, biased the same way
on both arms, so the differential is safe but the absolute figures are not exact. (b) `agent-state`
is stored per task-arm, not per rep, so this is a cell-level analysis. (c) One confounder remains:
sweet's low subagent use may be *caused* by having ss-* tools, which would make the saving real and
causal — or it may be incidental, which would still be a real bill but a weaker product claim. Either
way **the currently published claude-code number is wrong.**

**Exact next step — $0, no rollouts.** Fold sidechain usage into the runner's existing pricing
function so it lands in `breakPricedCostUsd`, re-derive the claude-code column from the retained
session store, and republish. **Pre-registered bar:** with sidechain records excluded, the recomputed
arm totals must reproduce today's values to within 0.5%. If they do not, there is a second ledger
defect and the flip is not publishable.

### F-2. `ss-grep --in` returns false zeros for any directory · evidence DIRECT · verified by me

`core/search/grep-output-shaping.js` `matchesGrepFileFilter` is
`target === f || target.endsWith('/' + f)` — a whole-path or trailing-segment test. A directory value
such as `lib/` can therefore never match `lib/actor.js`. The output prints `0 total match(es) ... (no
matches)`, which an agent reads as a statement about the code rather than about the filter.
`tests/search/grep-output-shaping.test.js:51` **locks the defect in**, asserting
`matchesGrepFileFilter('tests/testthat/test_x.R', 'tests/testthat')` is `false`.
`eval/agent-read-workflows/bin/_ss-helpers.mjs:260` maps `--in` straight onto it.

Measured exposure: 15 ss-grep calls pass a directory to `--in`, across 11 cells and 9 tasks, on all
three harnesses; every readable result is a zero.

**Ceiling: about 1% of sweet spend, 0 solved tasks.** It was correctly killed as a bench lever. Ship
it as a **correctness fix** with a unit test asserting that a substring query can never return fewer
hits than a query containing it, and **claim no benchmark value for it.** Do **not** ship the
source-priority reranking that was bundled with the proposal — that is a structural ranking signal,
and ungated structural signals have cost this project −0.07 and then −27.57 percentage points on
GenCodeSearchNet.

### F-3. Opencode's −17.8% is inflated by a refusal · evidence DIRECT · cuts AGAINST sweet

On `mransan__ocaml-protoc-202` — the task whose problem statement is zero characters — opencode sweet
made **0 tool calls in 1 turn on both reps**, cost $0.00086, and produced no patch. Native made 14 and
22 calls at $0.0057 and $0.0087. Dropping that one task takes opencode from **−17.76% to −13.82%**.
So about 26% of the opencode advantage is a refusal, not efficiency. The same refusal appears on
claude-code sweet. **Publish opencode with this caveat attached.**

---

## Killed — with reasons

### (a) Dead-list hits, removed mechanically before any agent saw them

The blunt regex screen killed 9 proposals. **All 9 were false positives**, and the failure mode is
systematic and worth recording: the regex matched text in which the proposer was explicitly
*disclaiming* the dead idea. The screen therefore punishes exactly the most careful proposals.

| proposal | pattern | what it actually matched |
|---|---|---|
| Coalesced independent lookups | `/\bpack(ing\|ed)?\b/i` | "…this is not dead-list fusion or **packing**" |
| Duplicate-span elision | same | "…not **packing** (no transcript rewriting)" |
| Envelope density pass | same | "…not **packing** (call scheduling untouched)" |
| Symbol-complete first read | same | "This is not **packing**…" |
| Redundant-tool retirement | `/\bpreamble\b/i` | "This is NOT the dead **preamble**-trim lever" |
| run_tests result compaction | same | the dependency/collection **preamble** *of test output* |
| Per-turn output ceiling | `/\bthrash/i` | "…and not **thrash** reduction (dead)" |
| Post-edit type-contract verifier | `/tests.?first/i` | "neither a search reranker nor **tests-first** prompting" |
| Reverse-import package-contract pack | `/\bpack\b/i` | the noun "**pack**", meaning a bundle of context |

**All nine were recovered and judged on their merits.** None was silently dropped. Their outcomes
appear in groups (b) and (c). **Recommendation: replace the regex screen with a semantic check, or at
minimum strip negated clauses before matching.** As written it is anti-correlated with proposal
quality.

### (b) Killed at the $0 exposure gate

| lever | verdict | the number that killed it |
|---|---|---|
| Post-edit type-contract verifier | **dead-no-exposure** | The three target tasks produce **no compiler diagnostics at all**. `dotnet__yarp-2825`: 0 error lines. `dashbitco`: 0. `apple__swift-nio-http2-145`: its 9 "error:" lines are XCTest *behavioural* assertions (BadStreamStateTransition, NoFrameReceived); the Swift compiles cleanly. Both arms emit byte-identical failures. |
| Caller Set Inline | dead-no-exposure | trigger never fires |
| Test-to-source primary-locus reranker | dead-ceiling-too-small | The one cell that DID localize correctly on codeception still failed. Correct localization has been observed to buy zero solves there. |
| Reverse-import package-contract pack | dead-ceiling-too-small | same |
| Source-anchored test-witness (pytask) | dead-ceiling-too-small | Both native successes are **one rep of two** — a coin flip, not a task. |
| Schema-to-consumer closure (teleport) | dead-ceiling-too-small | Proposer conceded it: sweet already solves the task, so the ceiling is under one task by construction. |
| Stale-Test Annotation in run_tests | dead-ceiling-too-small | exposure 211 but no differential |
| Dep-Source Reach · Zero-Edit Floor Guard · Delegation retrieval brief · Scope and flag honesty · Scope-Honest Retrieval | dead-ceiling-too-small | all below the 3% / 1-task bar |

### (c) Refuted by the adversarial panel

Every lever that reached the panel lost. The refutations were forensic, not stylistic — four were
killed by a fact re-derived from the artifacts that the gate had missed.

| lever | killer fact |
|---|---|
| **Stale-Oracle Override** (the strongest lever found) | Its whole +2-task ceiling rested on two sweet cells that "would be gold with one hunk deleted". **They would not.** Gold inserts `:integer` after `:atom` in `@basic_types`; codex/sweet inserts it after `:boolean`. The graded test asserts the rendered list as an exact ordered string, so deleting the warp hunk still fails. **I verified this myself against the gold and agent patches.** Second threat, unresolved: if the operator classifies the doctrine as completion discipline it goes in the FRAME for **both** arms and the differential collapses to zero. |
| Sibling-Site Echo | The sibling was **already in context**: `ss-read underscore.js 400 470` returned both lines 445 and 458; the cell edited 445 only. Native, reading the whole file, produced a byte-identical patch. |
| Diff-vs-Evidence Review | Unsupported-file trigger fires in **1 of 102** sweet rollouts. Relabelled completeness card. |
| Look-Before-API | Its own pre-registered falsifier fired: pre-edit test consultation has **p = 1.000** across the four design-shaped tasks, and inverts once the supporting task is removed (0 of 12 with consultation solved, against 6 of 24 without). It is tests-first prompting under a conditional name. |
| Stale-Assertion Arbitration | Trigger fires **0 of 11 times**: the losing agents keep the visible suite GREEN, so there is no failing assertion to arbitrate. |
| Atomic same-file edits | Premise reversed in the traces: native has 85 same-file edits to sweet's 81, and MultiEdit was used **0 times**. |
| Claude static edit-scope guard | Exposure is **3 cells, all one task**. Native adds *more* wrong files overall (31 to sweet's 27). Every dart cell already found the right file. |
| Public-facade closure (dart) | claude-code native reached **both** source files and still failed. |
| Agent-format semantic sibling closure · structural sibling closure | **Three of the five missing bingo files do not exist at base.** Nothing can retrieve them. |
| Static-prefix cache-key alignment | Maximum recoverable is **$0.00243 = 1.19%** of sweet's claude-code cost — 51% of the gap. Cannot flip the sign alone, and changes no solve. |

### (d) The two that nearly survived — recovered from the faulty screen, then killed on measurement

These are the closest this hunt came to a survivor. Both are sweet-only, so their savings would have
landed one-for-one on the head-to-head. Both were killed by refuters who re-measured the gate's own
number under the gate's own stated conditions.

**Envelope density pass** — thinner ss-* result rendering (drop repeated line-number prefixes,
collapse blank and comment runs). The gate did not estimate this: it **replayed the proposed renderer
over all 1,204,262 recorded ss-* output characters** and measured a 5.7% sweet-only diet on
claude-code, against a 2.4% gap. It looked like the answer.
Two refuters killed it on the same ground, independently. The gate required doc comments be preserved
and then never re-measured under that condition. Re-run with the guard applied: **61.3% of the
collapsible comment mass carries explicit documentation markers** (`///`, `/**`, `@param`, `:param`)
and 34.7% more is attached to the line it documents — 0.0% is free-standing banner text. With the
gate's own guard honoured, and minus a truncation variant already live-tested to "no cost win", the
ceiling falls to **$0.00396 = 1.9%** — below the 3% bar and **below the $0.0048 gap**. A further
38.8% of even the ungated saving sits on tasks nobody ever solves.

**Redundant-tool retirement** — stop shipping the harness's own retrieval-tool schemas in the sweet
arm, since ss-* replaced them. Killed twice, and the second kill is the most rigorous single act of
this hunt: a refuter **captured the exact API request the box's claude-code 2.1.218 sends** under the
runner's own flags, against a $0 localhost sink. **The Grep and Glob schemas do not exist in it** —
it carries a 24-tool roster. The only two tools the "ss-* replaced them" story justifies removing
contribute **zero** tokens; the gate's 928-char and 637-char figures were dead strings. The genuinely
removable set is WebFetch + WebSearch + NotebookEdit = 758 tokens = $0.0034, below the proposer's own
kill line — and sweet used WebSearch successfully twice in this very run. The first refuter added the
fairness point: applied honestly to **both** arms it moves claude-code the **wrong way**, because
native runs 20.0 turns to sweet's 17.7, so a shared prefix token is worth more to native. The gap
would widen from +2.38% to +2.92%.

**One recovered lever turned out to be genuinely dead-listed.** *Coalesced independent lookups*
(multi-target ss calls plus batching guidance) really is turn/context packing renamed. The adjudicator
found both of its vehicles individually closed in `TURN_PACKING_FINAL.md` (2026-08-06): free-argument
`ss-batch` batching, and prose packing prompts. Model-side batching is precisely what was killed;
server-side fusion was that document's survivor and died separately on 2026-08-10. Its exposure was
the largest in the hunt (583 adjacent ss-call pairs, reproduced exactly) and it still dies on
mechanism, not size. **The regex was right about this one by accident.**

Two more died for having **no differential at all**: *Per-turn output ceiling* and *run_tests result
compaction* are both FRAME-level, both arms. The second is worth 6-8% of sweet's absolute cost — and
exactly zero of the head-to-head, because native gets it too. Absolute savings are not the goal.

---

## What this run establishes about the ceiling

Be blunt about how little headroom is left on this task set.

- **Retrieval headroom is essentially nil.** Of the six never-solved tasks: three sit at *perfect*
  localization (`apple`, `dotnet`, and `dashbitco` on 2 of 3 harnesses) where both arms touched every
  gold file and still failed; one (`mransan`) has a zero-character problem statement and 19 gold
  files; one (`codeception`) is arm-universal confusion where 5 of 6 cells chose the same wrong file
  and the one correct cell still failed; and the last (`bingo-274`) needs **three files that do not
  exist at base to be authored**. Not one of the six is reachable by better retrieval.
- **Gold-file coverage is not the pass criterion.** 25 of 51 solved-or-partial cells resolved while
  touching a strict subset of gold files, or none at all. `ontodev__robot-710` solves in all six cells
  hitting **0 of 3** gold files. Any future lever measured in gold-file coverage is measuring the
  wrong thing.
- **The fixed prefix cannot explain the short-trajectory losses.** It is exactly +1457 tokens
  (codex/opencode, exactly) and 1,585-1,590 (claude-code). Full carrying cost on
  claude-code is $0.00721, of which only $0.00243 is recoverable. On `dashbitco` (+52% on codex) it
  explains about 10% of the regression; the rest is sweet making 12.5 tool calls against native's 6.5.
- **There is no doomed tail.** All 204 rollouts exit `model_stopped`. None hits a cap. This is now
  confirmed three times and should stop being re-proposed.
- **Break-priced equals ideal in all 204 cells**, because `contextRewrites` is 0 everywhere. The
  column is correct but carries no extra information on this dataset. It becomes load-bearing only
  for levers that reorder or evict context. Do not claim a break-priced-vs-ideal difference here.
- **The largest remaining sweet-only cost object is now measured, and it is mostly not addressable.**
  ss-* result payload is 302,207 tokens on claude-code = $0.07732 = **18.95% of sweet's spend** there
  (ss-read 117 results/165,577 tokens; ss-search 54/93,506; ss-grep 86/22,117; ss-find 7/14,166;
  ss-trace 8/5,721; ss-semantic 2/1,121). That sounds like a large prize. Once the renderer must keep
  documentation comments — which 61.3% of the collapsible mass turns out to be — the honest ceiling is
  **1.9%**, below both the 3% bar and the $0.0048 gap. This figure was replayed over the recorded
  characters twice, by a gate and by its refuter, and they agree on the payload and disagree only on
  what may legally be removed. **Anyone proposing result-diet work should start from 1.9%, not 18.95%.**
- **The cost frontier is closed for behavioural levers, and that was already the standing verdict.**
  This hunt confirms it from a third independent direction. What was *not* closed is the accounting,
  and that is where the remaining claude-code win actually lives (F-1).
- **Absolute savings are not the goal, and two of the largest candidates here were pure absolute.**
  run_tests output compaction is worth 6-8% of sweet's bill and **zero** of the head-to-head, because
  it is FRAME-level and native receives it too. Any future proposal must state its *differential*, not
  its absolute saving. This gate has been added to the recovery panel's schema for reuse.

---

## Method + caveats

**Panel.** Three model families at maximum reasoning effort, generating independently, with every
survivor refuted by families that did not propose it.

| stage | agents | models |
|---|---|---|
| Generation | 6 | Opus 5 x2, Fable 5 x2, GPT-5.6 x2 (cost and resolution lenses) |
| Exposure gate | 4 + 1 | Opus 5 max effort; Terra's 10 levers gated by my own direct measurement |
| Refutation | 18 | Opus 5, Fable 5 (+ 6 GPT slots lost to the capacity outage), cross-family |
| Synthesis | 1 | Opus 5 max effort |
| Recovery gate + refutation | 6 | Opus 5 + Fable 5 on the 9 wrongly-screened levers |
| GPT-family passes, direct | 6 calls | 2 generation lenses + 1 full refutation of all 11 survivors |

**Counts.** 30 proposals → 9 recovered from a faulty screen → 30 gated → 13 survivors reached
adversarial refutation → **0 survived**. Every refutation verdict was `refuted`, all but two at high
confidence.

**Disclosed substitution.** The handoff specifies **GPT-5.6 Sol** as the third family. Sol was **at
capacity for the whole session** and returned a hard error (`Selected model is at capacity`) to every
request, including the workflow's two carrier agents. I substituted **GPT-5.6 Terra** on the same
ChatGPT subscription — same disjoint family, same $0, same `xhigh` effort — and ran both generation
lenses and a full refutation pass through it outside the workflow. The three-family requirement
holds; the specific model does not match the handoff. Sol's transport pattern itself was verified
working before the capacity wall.

**Deterministic work was code, not models**: dedup, dead-list screening, set arithmetic and every
tally in the evidence pack are plain JavaScript.

**The evidence pack.** I built `evidence-pack.json` and `EVIDENCE-DIGEST.md` from the raw artifacts
before spawning anything, precisely because an agent asked to "measure exposure" from prose will
invent numbers. The pack reproduces every headline figure in the handoff exactly (−9.6% / −15.7% /
+0.2% both-solved; 9-10 / 9-9 / 9-9 solve; 204 of 204 `model_stopped`), which is why the handoff's
numbers can be trusted. Section I of the digest records 11 findings the handoff does not state, four
of which change what a good lever looks like.

**Statistical limits.** n = 17 tasks. The cost noise band is wide at this size, and three of the four
apparent solve "differences" in the source run are single-rep coin flips. No conclusion here rests on
an unreplicated solve flip. Nothing was measured against HO2, which remains frozen.

**Where evidence is weaker than it looks.** F-1's off-ledger totals are re-priced by me rather than by
the runner, and are cell-level rather than rep-level. The `Stale-Oracle Override` delivery-rule
question (general doctrine, or benchmark-aware completion discipline?) is a **classification decision
only the operator can make**, and it decides whether that whole family of levers can ever produce a
sweet-versus-native differential. It should be settled before anyone spends on this class again.

**Recommended order of work.** (1) Fix the claude-code subagent accounting and republish — $0, and it
is the only thing here that changes the headline. (2) Ship the `ss-grep --in` directory fix as a
correctness bug, claiming no benchmark value. (3) Attach the `mransan` refusal caveat to every
published opencode number. (4) Settle the delivery-rule classification. **Do not fund another
retrieval lever against this task set** — the headroom is not there.
