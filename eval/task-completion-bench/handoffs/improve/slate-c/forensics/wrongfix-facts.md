# Wrong-fix facts — the one fact per task that would most plausibly flip the fresh-pool losses

**Date:** 2026-09-02 · **Spend:** `$0` (trace reading, patch reading, base-tree reading, arithmetic) ·
**Scope:** the six dead-everywhere fresh-pool tasks and the four discordant tasks named in the brief, across
`fp-codex-tab-20260826`, `fp-opencode-tab-20260826` (+ `rp-oc-tab-20260827` repair rows), `fp-claudecode-tab-20260826`.
**Scripts and data:** `scripts-wrongfix-facts/` next to this file (`extract-cells.mjs`, `census-wrongfix.mjs`,
`data/cells.json`, `data/census-output.txt`, `data/cell-digest.tsv`). Box scratch: `/tmp/wf-slatec/wrongfix-facts/`.

## 0. Verdict

The ten tasks lose for four different reasons, and only one of them is new to the record. Of the 136 losing cells
(180 canonical cells, 44 solved) `[M]`, **72 (53%) are locked by the hidden tests** and no delivered fact can flip
them: `fastify-cors-285` (a one-token route literal the visible tests pin the wrong way), `spectator-181` (an exact
message string owned by an uninstalled dependency), `solhint-224` (the scope of an authoring task set by the hidden
tests plus a rule-id guess) and the exact merge shape in `markup-it-56`. **34 losing cells (25%) share one
computable fact class that the hint ladder never tested: argument provenance along the call graph** — "the
parameter you are guarding is bound to X at its only call site" (`b2-259`, 12 cells), "a sibling caller passes an
intentionally empty list into the shared method you guarded" (`accenture-1974`, 6 cells), "the equality that drives
override marking runs a different comparer than the one you patched" (`moq-1262`, 16 cells). **7 cells (5%) are a
definition-coherence loss** exactly like the hint ladder's `dashbitco` class (`aiohttp-8038`: two definitions of
"persistent connection" that must agree). **3 cells are a static observation-site loss** (`awslabs-21`: existing
tests observe the context object, not the serializer). The rest are misreadings of the issue (8 `aiohttp` cells
that never retry), one recorded edit-mechanics defect (3 sweet-only wrong-site hunks on `accenture`, register D3),
one recorded premature stop (`nmt-192`), and 9 assorted cells. In every computable case the deciding code was
already on screen: 11/18 `b2` cells (12 if one extra opencode-native session is the lost attempt) had the dispatch
loop body in their transcript, 18/18 `moq` cells had the override site, 3 native `spectator` transcripts held the
README line that names the intended method `[M]`. Evidence
presence did not force the choice, which is the hint ladder's finding again: the fact must be **computed and
stated**, not merely shown. The one candidate seed this produces is a **provenance certificate** (call-site
binding + caller argument ranges + consumer dispatch) as an F9-class computed fact; its ceiling on this pool is
three tasks, and its cheapest falsifier is a hint-ladder L1 rung on `accenture` and `b2`.

## 1. Data, denominators and how the cells were read

- Cells: 10 tasks × 3 harnesses × 2 arms × 3 reps = 180 canonical cells `[M]`. For opencode, the sweet rows of the
  five tasks in `/root/fresh-run/repair-tasks.txt` (`accenture`, `aiohttp`, `awslabs`, `moq`, `solhint`) come from
  `rp-oc-tab-20260827`; the matching `fp-opencode-tab` sweet rows were lost to the preflight race and are dropped
  (`FRESH-POOL-RESULTS.md` §"repair"; `census-wrongfix.mjs` implements the drop).
- Patches: `<run>/<arm>/patches.json` (rep 0) and `<run>/<arm>/rep-N/patches.json` (reps 1, 2). Hunk counts were
  re-derived from the patch text and matched `rows.json.patchHunks` in 180/180 cells `[M]`. The brief's
  `preds-<arm>.jsonl` holds one patch per task (22 rows, no rep field), so it is not a per-rep source.
- Issue text: `problem_statement` from `<run>/sweet/tasks.json`. Gold and hidden-test fields were counted, never
  read into this report. Grading logs (`<run>/<arm>/logs`, `rep-N/logs`) were opened only to classify a recorded
  outcome; no test name or expected string is reproduced here.
- Base trees: `/root/.ss-eval/golden/<Owner>__<repo>@<base_commit>` (read-only; several repos have three goldens,
  the task's `base_commit` selects the right one).
- Notation below: `c:s1` = codex sweet rep 1, `o:n2` = opencode native rep 2, `cc:s0` = claude-code sweet rep 0.

Solve matrix `[M]` (solved / 18 cells): fastify 0, spectator 0, markup-it 0, b2-259 0, solhint 0, moq 2,
accenture 9, awslabs 14, aiohttp 2, nmt 17.

## 2. Per-task cards

Each card gives: what the losing patches did (counted from the agents' own patch text), the ONE fact whose
delivery would most plausibly have flipped the wrong fix, its class, whether the evidence was already on screen,
and novelty against the register / the 08-28 forensics.

### 2.1 `fastify__fastify-cors-285` — 0/18, hidden-test-only (locked literal + stale visible assertion)

- Losing pattern `[M]`: **18/18 cells kept the existing `/*` OPTIONS route and added a second route** (`/` under a
  prefix, or `/:path*`); 0/18 wrote the wildcard-only literal that the issue text itself names ("previously, this
  was just `*`"). No transcript in any cell contains that literal `[M]`.
- Base tree `[M]`: the visible suite pins the current literal — `test/preflight.test.js:192` and `:209` assert the
  OPTIONS route url equals `/*`. An agent that made the one-token revert would have seen two visible tests fail.
  `node_modules` is absent from the golden.
- The one fact: "the route table must contain exactly the wildcard-only OPTIONS route and nothing more; the
  visible assertions on `/*` are stale." Class: **hidden-test-only**. The additive fix is functionally correct for
  the issue's own reproduction (an OPTIONS request to the prefix root) `[I]`, so a dependency runtime probe
  ("does `*` match the prefix root?") would not stop the additive design. The stale-assertion doctrine is register
  **F11 BANNED**.
- Novelty: **already-recorded** (`04-resolution-opencode.md` §2.6 says the issue names the fix and 12/12 added a
  route). Extends it with the visible-test pin lines and 0/18 attempts at the revert across 18 cells.

### 2.2 `hotmeteor__spectator-181` — 0/18, hidden-test-only (dependency-owned exact string)

- Losing pattern `[M]`: 14/18 moved or added the status check ahead of the exception check and **hand-rolled their
  own message text** (12 in the assertions file only, 2 also rewrote the validator message); 4/18 only rewrote the
  validator's exception message.
- Base tree `[M]`: `README.md:244` says the project's assertion is used "instead of using the built-in
  `->assertStatus($status)` method"; the golden has no `vendor/` tree. The container did have one: native cells'
  transcripts mention `vendor/` in 3 (codex), 4 (opencode), 2 (claude) files; sweet 0/0/0 `[M]`. The README line
  itself was read in 2 opencode-native and 1 claude-native transcript; none of the three changed design `[M]`. The
  single sweet hit for the framework's message wording is the model's own thinking text composing a message
  (`cc:s1`), not a tool result `[M]`.
- The one fact: "delegate to the framework's own status assertion; the expected failure text is defined by the
  dependency, not by this repository." Class: **hidden-test-only** in its exact form; the discriminating fact is
  a **dependency-source** fact (register E5 area). An index confined to the checkout cannot supply it
  (08-28 already stated this). Evidence present (README) did not force the choice.
- Novelty: **already-recorded**; extends with the 3-cell "README read, still hand-rolled" count.

### 2.3 `gitbookio__markup-it-56` — 0/18, two obligations: one runtime-probe, one hidden

- Losing pattern `[M]`: 7 cells added a block-level HTML rule, 5 changed the inline HTML regex, 3 changed how the
  inline deserializer splits the tag, 2 changed the inline serializer's text source, 1 patched the HTML-input
  parser. 0/18 merged adjacent raw-HTML fragments into one node.
- Grading-log class (read to classify only) `[M]`: every loser fails the same three ways — two document-shape
  mismatches where the actual document has 7 or 13 inline nodes and the expected has 3 or 5 (fragments not
  merged), and one `TypeError: node.shift is not a function` from the inline HTML serializer.
- Base tree `[M]`: `src/markdown/inlines/html.js:46-50` calls `node.shift().write(node.text)` on the peeked node;
  every sibling serializer in `src/markdown/inlines/` and `blocks/` calls `state.shift()`. The base fixture set
  `test/from-markdown/html/` has two directories (`span`, `with-alt`) and does not exercise the crash.
- Transcripts `[M]`: 18/18 cells ran a node evaluation containing the issue's own input, and **0/18 saw the
  `shift` TypeError** — every reproduction ran the parse direction only, never the round trip back to markdown.
  The issue's error is an image, so the agents never had the error text.
- The one fact: "round-tripping the issue's input crashes in the inline HTML serializer (method called on the
  node where every sibling calls the state), and the parse direction produces 7 raw-HTML fragments where the
  document should carry one." Class: **runtime probe (round-trip reproduction)**; the receiver bug is also
  **computable by sibling consistency**; the exact merged shape is **hidden-test-only**. Even with the crash fact,
  the two cells that touched the serializer (`c:s1`, `o:n0`) changed the text source and kept the wrong receiver,
  so the crash fact alone would not have flipped them.
- Novelty: **extends** 08-28 ("wrong direction / incomplete"). New: the round-trip-only class and the 18/18
  parse-only reproduction count.

### 2.4 `bfgroup__b2-259` — 0/18, computable: argument provenance at the dispatch loop

- Losing pattern `[M]`: 5 cells put an `if <build>no in $(properties)` guard **inside the check worker's `check`
  rule** (`c:n0 o:s2 cc:s0 cc:s1 cc:s2`); 4 guarded other `configure.jam` rules (`builds`, `find-builds`,
  `builds-raw`, the relevance filter); 3 guarded `targets.jam` on the build request; 5 (all native: `c:n1 c:n2
  cc:n0 cc:n1 cc:n2`) made the `build` feature `incidental` in its declaration; 1 (`c:s2`) edited the adjacent
  relevance rule in `property.jam`. The claude sweet rep 0 spent 224 calls and still guarded `check` `[M]`.
- Base tree `[C]`: `src/build/property.jam:67-149` is the loop that evaluates conditional requirements. Direct
  conditionals are tested against `$(context)` and their results are appended to `properties` for the next pass
  (lines 96-124); indirect rules are invoked as `indirect.call $(i) $(context)` (line 129). So the `check` rule's
  `properties` parameter is bound to the **context**, never to the values sibling conditionals produced in the
  same evaluation. A `<build>no` produced by a `requires` conditional lives in `properties`/`result`, and no
  guard inside `check`, on the build request, or in the relevance filter can observe it. The only place that
  sees the accumulated value is the loop itself. Callers of the loop: `property-set.jam:226`,
  `configure.jam:520,578`, `targets.jam:1107,1109`, `ac.jam:313` `[M]`.
- Transcripts `[M]`: all 18 cells' transcripts contain the loop's name; the loop's body line (`indirect.call`) is
  in the transcript of 11/18 cells, counted per rep (codex native 0/3, codex sweet 2/3, opencode native 2/3
  conservative — its cell directory holds 4 sessions for 3 reps and one session has no hit —, opencode sweet 2/3,
  claude native 2/3, claude sweet 3/3). The deciding code was on screen in a majority and the guard still went
  to the callee. Of the 5 `check`-guard cells, the 3 claude-code ones are among the 11; `c:n0` and `o:s2` are
  not `[M]`.
- The one fact: "the parameter you are guarding is bound to the evaluation context at the single call site
  (`property.jam:129`); the value you test for accumulates in `properties`, one level up." Class: **computable —
  call-graph argument provenance** (binding of the guarded parameter at its call site). The 5 `incidental` cells
  hold a different theory (configuration identity) that a configure-check count test does not reward `[I]`.
- Retrieval: the `.jam` index gap (register E1, shipped) is real but was not the decider here — 15/18 saw the loop
  through the harness's own tools.
- Novelty: **new** as a fact class. 08-28 recorded "not-localised + wrong-fix" and the index gap; it did not name
  the binding fact or count who saw the loop.

### 2.5 `protofire__solhint-224` — 0/18, hidden-test-only scope plus a rule-id lottery

- Losing pattern `[M]`: 16/18 cells named the new rule `ordering`, 1 `order` (`c:s1`), 1 `order-of-layout`
  (`cc:n1`). 14 enforce contract-member order only; 2 also enforce pragma/import order at file level; 0 enforce
  function-visibility order or the order of contract kinds within a file. `f2pFrac` plateaus at 0.4 in 12 cells;
  the 2-of-18 with a different id and 2 `ordering` cells with an AST traversal that never fires (`o:s0` iterates
  `node.children`; `rp o:s1` iterates `node.body`) score 0.
- Grading-log class (read to classify only) `[M]`: the assertions that fail at the 0.4 plateau are of the form
  "expected 1 report, got 0" and fall into two classes: function ordering by visibility (five titles), and
  file-level ordering of contract kinds and enums (four titles). The base tree's sibling rule
  `lib/rules/order/func-order.js` already implements function-visibility ordering `[C]`; the hidden tests
  re-target that behaviour to the new rule `[I]`.
- The one fact: "the new rule must absorb the sibling rule's function-visibility ordering and add file-level
  ordering of contract kinds; its id must be the one the tests reference." Class: **hidden-test-only**
  (authoring scope) with a **naming-lottery** component (2/18 lost on the id alone; the issue does not spell it).
  The style guide the issue links is external (network banned; register E6 DEAD).
- Novelty: **extends** 08-28 ("authoring obligation, 0.4 plateau"). New: what the plateau consists of and the
  16/18 id convergence.

### 2.6 `devlooped__moq-1262` — 2/18, runtime or computable: which equality actually runs

- Losing pattern `[M]`: 13 cells changed `Match.Equals` and/or gave `ExpressionComparer` a "do not evaluate
  captures" mode; 2 changed setup selection/specificity; 1 swapped the matcher expression in `MatcherFactory`.
  The two winners (`c:n1`, `c:s2`) never touched `Match.Equals`: one made `MethodExpectation.Equals` treat two
  distinct matcher instances as unequal, the other skipped override-marking in `SetupCollection.Add` when a setup
  has non-constant matchers.
- Grading-log class `[M]`: every cell, winners included, fails the same two pre-existing tests; losers fail
  exactly one more, the single added test. No compile errors, no other regressions (1687 tests; losers 1680
  pass, winners 1681).
- Why the 13 lose `[C][I]`: override marking happens in `SetupCollection.Add` through a hash set keyed on the
  expectation; `MethodExpectation.Equals` compares `partiallyEvaluatedArguments[i]` with `ExpressionComparer.Default`,
  which folds captured fields to their current values at each recursion level. For an `It.Is(...)` argument this
  comparison decides equality before any `Match` object is compared, so a capture toggle inside `Match.Equals`
  never executes on the deciding path. The winners changed the code that does run.
- Transcripts `[M]`: 18/18 cells' transcripts contain the override site (`MarkOverriddenSetups`/`activeSetups`)
  and `partiallyEvaluatedArguments`. Evidence present, choice not forced.
- The one fact: "for this input, the equality that drives override marking is `MethodExpectation.Equals` over the
  partially evaluated argument expressions; `Match.Equals` is not on that path." Class: **runtime probe**
  (execution-path trace of the issue's reproduction) or **computable argument provenance** through the partial
  evaluator (harder: it needs the evaluator's descent rule for quoted lambdas).
- Novelty: **new** as a fact class. 08-28 recorded "wrong-fix, semantic depth" and four passing designs.

### 2.7 `accenture__sfmc-devtools-1974` — 9/18, two loss classes

- Losing pattern `[M]`: **3 cells landed the hunk at line 1593** (inside `fixKeys`) instead of the shared method
  at 1740+ — `c:s1`, `rp o:s0`, `rp o:s1`; all sweet, codex 1/3, opencode 2/3, claude-code 0/3 (its `Edit` rejects
  ambiguous anchors). **6 cells added a guard that also rejects an EMPTY selection** (`c:s0 c:n0 c:n1 c:n2 o:n1
  cc:s1`): their F2P passes and a visible sibling test fails. 9 solved by guarding on a falsy value only or by
  scoping the guard to the issue's method.
- Base tree `[C]`: `lib/index.js:1585-1647` — `fixKeys` filters out an unsupported type and then calls the shared
  method with `selectedTypesArr || selectedTypesObj`, which is an empty array when the only requested type was
  the unsupported one. A visible test pins that path (P2P count 8). The shared method has seven callers
  (`refresh`, `execute`, `publish`, `validate`, `pause`, `stop`, `replaceCbReference`, `fixKeys`; lines 738-1642).
- The one fact (blanket-guard class): "a sibling caller passes an intentionally empty selection into the method
  you guarded; absent and empty must be distinguished there." Class: **computable — call-graph argument
  provenance at the callers of the shared callee** (the same analysis as b2, seen from the other end).
- The one fact (wrong-site class): "your hunk landed at line 1593, in `fixKeys`." Class: **edit mechanics**
  (register **D3, MEASURE ONLY**: "decided one task at n=1"); canonical count is now 3 sweet cells on the same
  single task, still one task.
- Novelty: wrong-site **extends D3** (n=1 → 3, still one task, sweet-only). Blanket guard: **new** classification
  (08-28 named it "wrong-fix: blanket guard" without the caller-provenance fact).

### 2.8 `awslabs__aws-embedded-metrics-node-21` — 14/18, computable: observation-site projection

- Losing pattern `[M]`: 3 cells deduplicated in the serializer (`c:s1 o:n0 cc:n2`); 1 cell (`c:s2`) fixed the
  context correctly and lost a P2P test to a 1 ms timestamp difference (08-28 §2.1, not a wrong fix).
- Base tree `[M]`: the existing tests for the method the issue names observe the context's own accessor right
  after the call — `src/logger/__tests__/MetricsContext.test.ts:26-30, 55-60, 69-72` (`context.putDimensions(...)`
  then `expect(context.getDimensions()...)`). The serializer's tests construct a context and serialize it
  (`src/serializers/__tests__/LogSerializer.test.ts:16, 43`), so a serializer-only fix is invisible at the layer
  the method's own tests observe.
- The one fact: "the observable contract of the named method is the context's dimension list, where its existing
  tests look; a fix at emit time is not observed there." Class: **computable — observation-site projection**
  (project the issue's named symbol onto the existing tests that exercise it and report what they assert on).
  08-28 already showed the evidence was on screen (PIPE rep 1 read the context file and patched the serializer).
- Novelty: **extends** 08-28 ("wrong layer") with the static analysis that names the layer. Register neighbours:
  F5 (runtime public-surface probe; only enumerability discriminated) — this is the static cousin.

### 2.9 `aio-libs__aiohttp-8038` — 2/18, two loss classes

- Losing pattern `[M]`: **7 cells conditioned the retry on the response's keep-alive header** (threading a new
  protocol flag through `client_proto.py`/`connector.py`); **8 cells never retry** and instead tweak close detection
  at release or EOF (`not protocol.is_connected()` in `_release`, `_should_close = True` in `eof_received`, a
  response-layer header check); 1 cell (`cc:n2`) produced no patch after 78 calls. The two winners retry once
  without looking at the header: `rp o:s1` keys the retry on "connection came from the pool" (44 calls,
  8 `run_tests`), `cc:n1` keys it on the method being idempotent (125 calls).
- Grading-log class `[M]`: all four losers sampled fail the same three added tests regardless of design.
- Base tree `[C]`: persistence is decided by `should_close` — the parser sets close only on `Connection: close` or
  HTTP/1.0 (`aiohttp/http_parser.py:505-511, 619-625, 700-702`), the connector releases on `protocol.should_close`
  (`aiohttp/connector.py:667`). "Has a keep-alive header" is a second definition of persistence that disagrees
  with the codebase's own (HTTP/1.1 is persistent with no header at all).
- The one fact (header class): "this codebase's definition of a persistent connection is `not should_close`;
  a retry conditioned on a keep-alive header disagrees with it and never fires on a header-less HTTP/1.1
  response." Class: **computable — definition coherence** (two definitions that must agree), the hint ladder's
  `dashbitco` class.
- The one fact (no-retry class): the issue's own packet trace shows the server's FIN arriving after the response
  and the RST on the next request, so the close is not visible at release time; only a request-time retry can
  recover. This is in the issue text; the 8 cells misread it. Class: **issue misreading**, not a missing fact.
- Novelty: **extends** 08-28 ("over-conditioned") with the coherence classification and the 8-cell no-retry class.

### 2.10 `celestiaorg__nmt-192` — 17/18, no missing fact

- The single loss is `cc:s0`: 4 tool calls (`TaskCreate`, `run_tests`, `ss-grep`, `ss-read proof.go 45 125`), then
  a `<state_summary>` block that correctly names the predicate and its gap, then `model_stopped` with no edit
  `[M]`. No compaction marker in the 22-record transcript. All 17 other cells wrote the same one-line predicate
  change.
- Class: **stop discipline**, already-recorded (`04-resolution-claude-code.md` §2.5 "premature stop"). Nothing to
  deliver.

## 3. Census of the 136 losing cells by fact class `[M]`

| class | cells | share | tasks (cells) |
|---|---:|---:|---|
| hidden-test-only / locked literal / dependency-owned string / authoring scope | 72 | 53% | fastify 18, spectator 18, solhint 18, markup-it 18 (merge shape) |
| computable: call-graph argument provenance (binding at call site, caller argument range, consumer dispatch) | 34 | 25% | b2 12, accenture 6, moq 16 |
| issue misreading (no retry although the issue shows the timing) | 8 | 6% | aiohttp 8 |
| computable: definition coherence | 7 | 5% | aiohttp 7 |
| computable: observation-site projection via existing tests | 3 | 2% | awslabs 3 |
| edit mechanics (ambiguous anchor, register D3) | 3 | 2% | accenture 3 (all sweet) |
| other (different theory 5, adjacent rule 1, flake 1, no patch 1, premature stop 1) | 9 | 7% | b2 6, awslabs 1, aiohttp 1, nmt 1 |

Notes. `markup-it` is counted once under hidden-test-only because the merge shape is required for any solve; its
runtime-probe fact (round-trip crash) is necessary but not sufficient. `moq`'s 16 are counted as provenance
because all 16 patched code that is not on the deciding path; 13 of them share the same wrong path. Losses are
arm-universal in every class except edit mechanics (3/3 sweet) — consistent with the brief's "wrong-fix is
arm-universal" (memory `resolution-floor`).

## 4. Generalisation — which computations recur, and do they match the hint ladder's classes?

The hint ladder flipped tasks with three computed facts: **state-space closure** (apple, 18/18), **enumerability**
(codeception, a runtime property), **definition coherence** (dashbitco, a residue certificate). Against this pool:

1. **Argument provenance along the call graph recurs in three tasks and is the largest computable class (34
   cells, 25% of losses).** It is not one of the ladder's three classes. Its three faces are the same analysis
   read from different ends: (a) *binding* — what the guarded parameter is bound to at its call site (b2:
   `properties` = `context`, `property.jam:129`); (b) *caller range* — what values the callers of a shared callee
   can pass (accenture: an empty list from `fixKeys`, `lib/index.js:1630-1647`); (c) *consumer dispatch* — which
   implementation of an equality/visitor actually runs for the concrete argument kind (moq: `MethodExpectation.Equals`
   over partially evaluated arguments, not `Match.Equals`). (a) and (b) are ordinary static call-graph work over
   the base tree; (c) needs either a runtime trace or a data-flow model of the evaluator.
2. **Definition coherence recurs once** (aiohttp, 7 cells): a new predicate ("has keep-alive header") that must
   agree with an existing one (`should_close`). Same class as dashbitco.
3. **Observation-site projection is a static cousin of the ladder's enumerability fact** (awslabs, 3 cells): where
   the existing tests observe the named symbol. The ladder's codeception needed a runtime property; here the
   layer is readable from the test files.
4. **Sibling consistency (mirror)** appears once as a necessary-but-insufficient fact (markup-it serializer
   receiver). The ladder's prose "check the twin" clause scored 0/6; the computed counterexample flipped apple.
   Nothing here contradicts that: no cell acted on the sibling pattern that was one directory away.
5. **State-space closure does not appear** in this pool. Its one-file-in-152,270 prevalence (P4 rotation) holds.
6. **Localisation is never the decider**, again: 11/18 b2 cells had the loop body on screen (3 of the 5 that guarded
   the callee did), 18/18 moq cells had the override site, 3 native spectator transcripts held the README
   guidance, awslabs' PIPE rep 1 read the context file. This matches the ladder's L2 result (0.000 f2p) and register E14.
7. **Hidden-test-only is the majority class (53%)**, and its three forms are already on the register as unwinnable
   or banned: locked literal / stale assertion (F11, F20), dependency-owned string (E5 negative on this pool),
   authoring scope (F4 family). Any ceiling argument that credits fastify, spectator or solhint to a tool credits
   a coin flip.

## 5. Candidate seed — provenance certificate (the only mechanism here not already on the register)

- **Mechanism.** For the function an agent is editing or guarding, compute and print three facts from the base
  tree: (a) every call site and the expression bound to each parameter there; (b) for a shared callee, every
  caller and the range of values it can pass (literal, filtered list, possibly empty); (c) for an
  equality/hash/visitor consumer, which concrete implementation runs for the argument kinds in the issue's
  reproduction. Deliver it the way the P4 certificate was delivered (a computed, specific statement, not a rule).
- **Harnesses affected.** All three; the loss is arm-universal.
- **Vehicle and differential.** If delivered through an `ss-*` analyzer it is sweet-only; if delivered through the
  issue text (as in the hint ladder) it is a zero-differential experiment that only measures whether the fact
  flips the task. The `ss-trace` surface is the natural home (register E7 records its cross-file edge gap as an
  OPEN DEFECT, so the plumbing is partly missing).
- **Trace evidence.** b2: 12 cells guard a parameter that is bound to `context` (`c:n0 o:s2 cc:s0-2`, plus 7
  guarding neighbours); accenture: 6 blanket-guard cells (`c:s0 c:n0 c:n1 c:n2 o:n1 cc:s1`); moq: 13 cells on the
  non-deciding path plus 3 others. Paths in `data/cell-digest.tsv`; codex rollout files in `data/cells.json`.
- **Ceiling with arithmetic.** If the fact flips a cell at the ladder's best rate (apple 16/16) the pool ceiling is
  +12 (b2) +6 (accenture) +16 (moq) = 34/180 cells, i.e. three tasks. At the ladder's realistic rates for
  non-closure facts (nimble 1-2/4, codeception 2/4) it is roughly a third of that `[I]`. Per harness the tasks
  are dead everywhere (b2, moq) or 3/6 (accenture), so the per-harness ceiling is +2 tasks (b2, moq) plus
  accenture's 2 losing cells per harness.
- **Cheapest `$0` falsifier and kill condition.** Build the JavaScript face first (accenture): a script that lists
  the callers of the shared method and the argument expression each passes, and check that it prints the
  empty-list caller without being told the task. Kill if it cannot name that caller from the base tree alone,
  or if the same script on the 22-task pool flags a "possibly empty argument" on more than ~5 shared callees per
  task (noise). For b2 the Jam face needs a Jam front end (the index reads `.jam` only since E1 shipped);
  register the Jam face as language-gated. The moq face (c) is the expensive one; do not build it first.
- **Paid falsifier (not authorised by this report).** A hint-ladder L1 rung: the certificate text appended to the
  issue for accenture and b2, 4 reps, sweet arm, opencode. Pre-register: kill if accenture blanket-guard cells
  do not fall below 1/4 and b2 stays 0/4, and if any control task regresses.
- **Build cost.** JS face: one day (callers + argument expressions via the existing code graph). Jam face: a
  small parser, two to three days. Consumer-dispatch face: unknown; likely a runtime trace, not static.
- **Register check.** Nearest recorded levers: **B9** completeness card (DEAD: "missed siblings were already in
  context") — different, because here too the sites were in context and what is missing is the computed binding,
  not the site; **E12** cross-file reference completeness (OPEN `$0`) and **E7** `ss-trace` gap — these are
  retrieval completeness (which files to show), not a computed fact; **F9** delivered computed certificate (WORKS
  when computed) — this seed is a new instance of F9's class, alongside F3's state closure. Not a repeat of
  F8 (general clauses DEAD): the clause "check the callers" is exactly what the ladder showed does not work; the
  computed list is what did.
- **Flags.** `new_tool: false` if surfaced through `ss-trace`; `new_tool: true` if a separate `ss-provenance`.
  `needs_user_decision: true` (owner scope rule 11).

Two smaller items are noted, not seeded. **Observation-site projection** (awslabs, 3 cells, one task) is the
static cousin of F5; ceiling 3 cells. **Definition coherence** (aiohttp, 7 cells) is a second live instance of the
ladder's dashbitco class and strengthens F3/F9's "coherence certificate" arm; it is not new.

## 6. Traps met while measuring (each cost a wrong number before it was fixed)

- `preds-<arm>.jsonl` holds one patch per task (22 rows, no rep field). Per-rep patches are `<arm>/patches.json`
  (rep 0) and `<arm>/rep-N/patches.json`; hunk recounts matched `rows.json` 180/180.
- `fp-opencode-tab-20260826` has 129 rows; the 15 sweet rows of the five repaired tasks are superseded by
  `rp-oc-tab-20260827` (`/root/fresh-run/repair-tasks.txt`). Pooling both double-counts opencode sweet.
- moq: every cell, winners included, fails the same two pre-existing tests. They are not regressions; the loser
  signature is exactly one extra failure.
- markup-it logs show "3 failing" against an F2P count of 2; the fixture runner counts differently. Read the
  failure classes, not the count.
- A grep for the framework's message wording in spectator transcripts hit the model's own thinking text
  (`cc:s1`), not a tool result. Confirm the record type before counting a "saw the fact" hit.
- Grading logs print hidden test names in their summary lines (aiohttp, moq, solhint). Read for class, never
  copy into a report.
- Codex transcripts double-escape `$(...)` in Jam code; a fixed-string grep for `indirect.call` is safer than a
  pattern with `$`.
- Three `bfgroup__b2` goldens exist; `base_commit` from `tasks.json` selects `7cf7bdab…` for b2-259.
- Claude and opencode rows carry no `rolloutFile`; cite `agent-state/<task>-<arm>/` plus the rep, and use the
  patch source (`rep-N/patches.json`) as the exact anchor.

## 7. What was not finished

- No cell-by-cell reading of *reasoning text* for why agents chose the callee over the loop (b2) or
  `Match.Equals` over `MethodExpectation.Equals` (moq). The counts of "deciding code on screen" are grep-based
  presence counts, not proof the agent read the lines.
- The moq consumer-dispatch claim (§2.6) is read from the base code and the two winners' diffs `[C][I]`; it was
  not confirmed with a runtime trace ($0 rule: no rollouts, and no .NET build was run on the box).
- The solhint plateau composition (§2.5) rests on the classes of failing titles in three logs, not on running the
  hidden tests against the agents' rules.
- Native `spectator` cells mention `vendor/` in 9 transcript files; what they found there was not read.
- No web check of the Solidity style-guide order or the HTTP idempotent-retry rule (would be `[W]`; the network
  is banned inside the bench and these facts do not change any classification).

## 8. Artifacts

- This report: `eval/task-completion-bench/handoffs/improve/slate-c/forensics/wrongfix-facts.md`
- Scripts: `.../slate-c/forensics/scripts-wrongfix-facts/{extract-cells.mjs, census-wrongfix.mjs, README.md}`
- Data: `.../scripts-wrongfix-facts/data/{cells.json, census-output.txt, cell-digest.tsv}`
- Box scratch: `/tmp/wf-slatec/wrongfix-facts/{extract-cells.mjs, cells.json}`
- Prior forensics extended here: `handoffs/improve/harness-gutter-cost-20260828/04-resolution-{codex,opencode,claude-code}.md`,
  `HINT-LADDER-RESULTS.md`, `W0-P4-GATE-RESULTS.md`, `FRESH-POOL-RESULTS.md`.
