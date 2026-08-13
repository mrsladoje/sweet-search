# SESSION B — resolution-first slate for crushing native

This is a `$0` forensic slate. I read existing artifacts only. I did not launch a rollout, run a
benchmark, build code, or mutate the remote box. `HO2` remains untouched.

## 1. Inversion first

> **I am a smart engineer hired to make NATIVE crush SWEET. I have the same 204 traces. What do I
> exploit?**

I would not attack sweet's search quality. I would exploit what happens after sweet has already
found the right code:

1. **Make sweet commit to the first locally plausible patch.** On Apple, sweet's first search already
   returned both `sendPushPromise` and `receivePushPromise`, yet it changed only the one state named
   in the issue. On YARP, it found the exact nested loop and still encoded the wrong cardinality.
   Native can keep wandering with arbitrary reads, shell probes, and independent agents; sweet's
   strong localization makes it easier to anchor.
2. **Choose tasks whose missing work does not exist in the index.** Every Bingo rollout implemented
   two plausible helpers in an existing file. The required public modules and shared predicate did
   not exist at base. Retrieval can rank only existing nodes, so an authoring task neutralizes
   sweet's core advantage.
3. **Exploit green but incomplete visible suites.** Akinsho sweet r0 made an invalid recursive patch,
   passed all nine visible offset tests, and stopped. Native r0 made a different bad patch, but its
   mistake triggered four visible failures; that counterexample caused a repair and a solve. Native's
   extra exploration can accidentally manufacture the evidence sweet never sees.
4. **Exploit stale tests to induce compatibility shims.** In Dashbitco, both arms first wrote the
   requested `:integer` support. Five of six cells then optimized around the old exact-string
   assertion by hiding or special-casing `:integer`. A native attacker wants sweet to trust the
   visible oracle more than the requested public behavior.
5. **Use independent causal workers and let the ledger miss their cost.** On Ocean Parcels, native's
   Claude subagent returned the complete `funcvars -> kernel_vars -> missing C declaration` chain and
   the exact one-line fix. On YARP, another subagent stated the correct ownership rule: endpoints
   create destinations, not routes. Claude's subagent spend is off-ledger, so native gets both an
   operational and a measured-cost advantage.
6. **Force exact external contracts that are absent from the checkout.** In pytask, both arms found
   the right function. Native passed a frame to a callable hook; sweet Codex passed the exception-info
   object and solved. This was not a localization difference. It was an unobserved dependency
   protocol, guessed two different ways.

The inversion says the useful attack surface is not another retrieval/ranking/rendering knob. Sweet
needs capabilities that create new evidence or new code: executable witnesses, domain models,
artifact authoring, dependency behavior experiments, and a local patch executor. Those are the
inversions below.

### Current line to beat

The live `rows.json` files give these all-17, both-rep break-priced totals:

| Harness | Native cost | Sweet cost | Native tasks | Sweet tasks | Required domination move |
|---|---:|---:|---:|---:|---|
| codex | $0.289332 | $0.270644 | 9/17 | 10/17 | preserve both leads |
| opencode | $0.270888 | $0.222779 | 9/17 | 9/17 | at least +1 sweet task |
| claude-code | $0.398435 | $0.407928 | 9/17 | 9/17 | at least +1 task and save more than $0.009493 |

Task ceilings below are task-level, but every gate is rep-level. A single lucky rep is not evidence.
Dollar “exposure” is the current sweet spend on the named task(s), not an automatic saving. Candidate
ceilings overlap and must not be added together.

## 2. Trace log and discarded ideas

### Full rollouts read end to end

I read **20 complete main rollouts** with `dump-trace.mjs` at its unlimited-result default. I do not
count detached sidechain transcripts as rollouts. Synchronous subagent results present in a main
trace were read as part of that main trace.

- `pytask-dev__pytask-210` — codex native r0; codex sweet r0.
- `akinsho__nvim-bufferline.lua-173` — claude-code native r0; sweet r0; sweet r1.
- `dashbitco__nimble_options-43` — claude-code native r0; sweet r0; sweet r1.
- `mransan__ocaml-protoc-202` — opencode native r0; sweet r0.
- `apple__swift-nio-http2-145` — claude-code native r1; sweet r1.
- `dotnet__yarp-2825` — claude-code native r1; sweet r1.
- `oceanparcels__parcels-617` — claude-code native r0; sweet r0.
- `joshuakgoldberg__bingo-274` — claude-code native r0; sweet r0.
- `codeception__codeceptjs-367` — claude-code native r0; sweet r0.

That is nine same-task, side-by-side arm comparisons: Ocean Parcels covers a both-solve case;
Apple, YARP, Bingo, and Codeception cover neither-solve cases; and pytask covers the codex sweet-win
case. Akinsho and Dashbitco expose rep-sensitive repair divergence, and mransan exposes the zero-tool
refusal.

I also inspected the corresponding per-rep rows, recorded patches, and grader logs. Those supporting
artifacts are not counted as additional rollouts.

### Promising ideas generated and discarded

1. **Discarded: retrieve the symmetric sibling methods.** Apple sweet's first `ss-search` already
   returned the full `sendPushPromise` body, identified `receivePushPromise`, and listed the relevant
   caller test. Its state summary still said the blind spot was “whether related stream-state cases
   need adjustment,” then it edited only `receivePushPromise(.halfClosedLocalPeerIdle)`. Native read
   the same whole state machine and made the same one-quadrant edit. More sibling context is not the
   missing capability.
2. **Discarded: stale-test annotation or an “ignore this assertion” doctrine.** Dashbitco sweet r1
   solved after saying the sole failure “hard-codes the list” and stopping red, but that is not a
   general rule: the same advice belongs in the FRAME for both arms and therefore has zero
   differential. It would also turn product correctness into benchmark-oracle guessing. Candidate 1
   instead creates an independent executable behavior contract.
3. **Discarded: faster first edit or a tighter edit-scope guard.** Akinsho sweet r0 localized and
   edited early, touched one source file, passed the visible tests, and failed hidden behavior. Native
   r0 was slower and initially broke four visible tests, then repaired and solved. Speed and scope
   were anti-correlated with the useful counterexample in this pair.
4. **Discarded: auto-refuse vague issues as a cost lever.** For the zero-character mransan issue,
   opencode sweet used zero tools and cost $0.000858; native spent $0.005646 on a speculative lexer
   patch. Neither resolved, and the issue has 19 gold files. This flatters cost without creating a
   valid solve path and would be a benchmark-only win.
5. **Discarded: give the model the YARP architectural rule in a prompt.** Native's own subagent
   already said, “endpoints determine destinations, not routes” and recommended moving route
   creation outside endpoint enumeration. The main agent still installed `routeAdded` inside the
   loop. The missing step was not prose availability; it was an executable cardinality witness.
6. **Discarded: return the Ocean causal slice more compactly.** Sweet's first search already exposed
   `kernel_vars = [..., 'dt', ...]` and the declaration-removal loop. It then read 480 lines and made
   two more searches. Compacting the same evidence is explicitly banned and would not address the
   failing resolution frontier.

## 3. Ranked slate

### 1. Compile the issue into an executable witness before accepting a patch

- **Class:** `NEW CLASS — issue-to-executable-spec compilation`.
- **Tier:** `MOONSHOT`.
- **Trace evidence:**
  - In `dashbitco__nimble_options-43`, claude-code sweet r0, the first post-edit `run_tests` turn
    showed the implementation's actual list contained `:atom, :integer, :non_neg_integer`, while the
    old assertion omitted `:integer`. The model then hid the new type and finalized with: “Preserved
    existing compatibility behavior for invalid-schema ‘Available types’ errors.” That patch failed
    the new behavior.
  - In sweet r1, the same post-edit failure was described as “one existing assertion that hard-codes
    the list,” and the model kept the complete behavior. That rep resolved.
  - In `akinsho__nvim-bufferline.lua-173`, claude-code sweet r0's edit used `is_left` in the recursive
    branch even though that local existed only in the leaf branch. All nine visible offset tests
    passed. Sweet r1 used a dedicated `get_boundary_window(windows, is_left)` recursion and resolved.
  These outcomes are invisible in aggregates: the useful fact is the exact wrong second edit in
  Dashbitco and the green, invalid first recursion in Akinsho.
- **Mechanism:** add an `ss-witness` capability that turns concrete issue claims into a small,
  repo-native executable contract. It must synthesize inputs, execute base and patched behavior, and
  return an observed counterexample, not a checklist. For Dashbitco it would check all three public
  facts together: `-1` validates as `:integer`, a non-integer fails, and the advertised type list
  contains `:integer` exactly once in domain order. For Akinsho it would construct a nested
  row/column layout and exercise both left and right boundaries. A patch is handed back with the
  witness and its output; a green legacy suite alone cannot certify it.
- **Why this is not the dead verification/annotation class:** it does not label existing tests,
  score a diff, or remind the model to be complete. It authors and runs behavior that did not exist
  in the visible suite. It changes the required deliverable from “patch” to “patch plus independently
  generated executable witness.”
- **Vehicle and differential:** sweet-only daemon/CLI capability. Nothing goes in the shared FRAME;
  native receives no witness unless it independently builds one. Differential is non-zero.
- **Quantified ceiling:** Dashbitco plus Codeception (candidate 4's runtime form) are 0/2 sweet on
  codex and opencode; Codeception is 0/2 on claude-code, while Dashbitco is 1/2. A general witness
  compiler therefore has a gross ceiling of **+2 tasks on codex, +2 on opencode, +1 on claude-code**,
  plus two rep-stabilizations. Dashbitco + Codeception + Akinsho currently expose
  **$0.044528 / $0.038150 / $0.048685** of sweet spend on codex/opencode/claude-code. I book **$0**
  savings until a gate shows that local witness execution removes paid turns.
- **Cheapest `$0` falsifier:** using only issue text, base source, and recorded patches, have a human
  write one distinguishing witness for each of Dashbitco, Akinsho, and Codeception without consulting
  gold source changes. Kill the idea if those witnesses cannot reject every recorded wrong patch, or
  if the required expectation comes only from hidden-test knowledge. A later implementation gate
  belongs on stratified DEV/fresh tasks, never HO2.
- **Effect on solve and cost:** resolution is the primary upside and is large enough to measure. Cost
  should be flat or lower because execution is local, but witness generation may add latency and
  context; enforce no solve loss and no paid-cost increase. Build cost is high: multiple language
  adapters, sandboxing, fixture synthesis, and months of engineering. It works only if issue prose
  contains enough observable behavior to compile.

### 2. Add a state-machine model checker that returns missing transitions and counterexamples

- **Class:** `NEW CLASS — domain state-space model checking`.
- **Tier:** `GATED`.
- **Trace evidence:** in `apple__swift-nio-http2-145`, claude-code sweet r1's first search returned
  `sendPushPromise` in full and pointed directly to `receivePushPromise`. Its state summary said:
  “The remaining blind spot is the exact transition/effect expected ... and whether related
  stream-state cases need adjustment.” It nevertheless added only
  `.halfClosedLocalPeerIdle` to receive. The post-edit test then reported: “Expected stream error ...
  got succeed.” Native r1 made the same one-state edit after reading the full file. Grader behavior
  later failed both no-body and possible-body scenarios. The complete behavior is a four-quadrant
  matrix: send/receive crossed with body still possible/END_STREAM already sent.
- **Mechanism:** `ss-statecheck <symbol>` parses enum states and switch transitions, identifies
  directionally paired operations, and runs or symbolically evaluates every reachable state/action
  pair. It returns a transition table and concrete paths that violate an issue-derived invariant.
  Here it must surface the two send states and two receive states together, so a one-quadrant patch
  cannot look complete.
- **Why this is not sibling retrieval:** both siblings and the entire switch were already present.
  The new output is a computed reachable-state matrix and executable counterexamples, not more code
  context.
- **Vehicle and differential:** sweet-only analyzer exposed through `ss-*`; no FRAME or M± change.
- **Quantified ceiling:** Apple is 0/2 for both arms on all three harnesses. A correct checker has a
  clean **+1 task out of 17 on each harness** ceiling. Current sweet Apple spend is
  **$0.011298 / $0.016274 / $0.023329**. Treat that as exposed spend, not savings; the initial cost
  gate is non-increase.
- **Cheapest `$0` falsifier:** on the existing checkout, statically enumerate the four expected
  state/action paths and verify that the checker design would reject all six recorded one-state
  patches. Then test the same algorithm against rotated DEV state-machine changes. Kill it if the
  state representation cannot be recovered without project-specific handwritten semantics.
- **Effect on solve and cost:** potentially +1 task everywhere, which by itself takes resolution to
  11/17 vs 9 on codex and 10/17 vs 9 on both opencode and claude-code. Local analysis should be cheap,
  but no dollar benefit is assumed.

### 3. Let sweet author a public API's missing artifact graph, not just edit ranked files

- **Class:** `NEW CLASS — artifact-graph authoring`.
- **Tier:** `GATED`.
- **Trace evidence:** in `joshuakgoldberg__bingo-274`, claude-code sweet r0 explicitly reasoned,
  “hidden tests probably expect those specific names,” then added `handlebarsDirectory` and
  `handlebarsFile` to the existing `handlebars.ts`. Native r0 made the same two functions in the same
  existing file. Both visible suites were 421/421 green. The grader artifact then failed to import
  `./isFile.js`, `./handlebarsDirectory.js`, and `./handlebarsFile.js`: all were new modules absent at
  base. All six benchmark cells followed the existing-file shape.
- **Mechanism:** add `ss-author-api`, whose input is a requested public capability and whose output is
  an editable artifact graph: public symbols, owning packages, one-module-per-export conventions,
  barrel exports, shared predicates, and compile-level contract tests. It creates skeletons and
  typed imports for missing nodes. For Bingo, the graph should place each public helper in its own
  package module and place reusable entry-kind detection in `bingo-fs`, instead of stuffing
  everything into the one retrieved file.
- **Why this is not retrieval expansion or a completeness prompt:** the decisive files have no base
  representation to retrieve. The capability creates code and dependency edges; it does not rank
  additional siblings or tell the model to “check exports.”
- **Vehicle and differential:** sweet-only authoring operation. No shared prompt change.
- **Quantified ceiling:** Bingo is 0/2 sweet on all three harnesses, so the solve ceiling is **+1 task
  on each**. Current sweet spend is **$0.014091 / $0.013326 / $0.018978**. Cost credit is $0 until the
  generated graph proves it reduces paid authoring turns.
- **Cheapest `$0` falsifier:** on DEV public-API changes whose accepted commits add new source files,
  compare an artifact-only manifest generated from the base tree and issue against the accepted file
  graph. Do not score exact gold docs/tests; score owning module, public export, and dependency
  direction. Kill it if it merely parrots existing filenames or needs future-commit knowledge.
- **Effect on solve and cost:** a credible full-task flip across harnesses. It may initially increase
  edit volume and paid review cost, so the release gate is solve gain with no material cost regression.

### 4. Probe the runtime public surface and temporal behavior, not just static types

- **Class:** `NEW CLASS — runtime public-surface conformance`.
- **Tier:** `GATED`.
- **Trace evidence:** in `codeception__codeceptjs-367`, claude-code native r0 noticed the dormant
  primitive: “the existing output uses `.say` deliberately,” and first added enumerable `say`,
  `comment`, and `remark`. The visible exact-key test failed, so it changed all three to
  non-enumerable properties. The grader expected `say` in the actor's public keys. Sweet r0 likewise
  read `output.say()` but concluded, “I’ll add a public `Helper.comment()` method,” producing the wrong
  public name and ownership. Both arms understood deferred output; both guessed the public contract.
- **Mechanism:** `ss-surface-probe` loads the public factory in an isolated process and produces a
  behavioral surface certificate: enumerable methods before/after, generated definition output,
  call ordering through the recorder, and captured output timing. It should turn the issue's
  “or similar” ambiguity plus the existing dormant `output.say` vocabulary into one enumerable
  `I.say(message)` contract. It also reports which existing test expectation must change; it does not
  silently suppress that failure.
- **Why this is not the dead type-contract verifier or stale-test annotation:** types alone cannot
  observe enumerability or deferred output order. This executes the public object and creates a new
  temporal contract. It does not classify a test as stale for scoring purposes.
- **Vehicle and differential:** sweet-only runtime probe. No FRAME content; non-zero differential.
- **Quantified ceiling:** Codeception is 0/2 sweet on all harnesses: **+1 task on codex, opencode, and
  claude-code**. Current sweet spend is **$0.010678 / $0.014953 / $0.012288**. This overlaps candidate
  1's Codeception ceiling and cannot be added to it.
- **Cheapest `$0` falsifier:** replay the probe contract against the recorded patches without a model:
  native's non-enumerable aliases must fail the key check; sweet's helper-only `comment` must fail the
  `say` check; a direct enumerable queued `say` must satisfy both surface and ordering. Kill the tool
  if it cannot derive the name without grader-only facts.
- **Effect on solve and cost:** +1 task everywhere if the narrow mechanism generalizes. Runtime
  process startup adds local latency but negligible API dollars; book no savings.

### 5. Build a version-matched dependency behavior emulator

- **Class:** `NEW CLASS — dependency behavior experimentation`.
- **Tier:** `MOONSHOT`.
- **Trace evidence:** in `pytask-dev__pytask-210`, codex native r0's pre-edit reasoning said the
  callable hide marker should receive “the traceback entry/frame,” and its patch invoked
  `is_hidden(frame)`. It failed hidden behavior. Codex sweet r0, after reading the same local
  traceback implementation, said: “The callable should follow pytest's contract: it receives the
  exception-info object,” threaded `exc_info` through the filter, and resolved. The checkout lacked
  an importable pytest source tree; native's attempted local import produced `ModuleNotFoundError`.
  This was a protocol experiment nobody could run, not a missing local sibling.
- **Mechanism:** maintain hermetic, version-addressed dependency sandboxes from lockfiles. An
  `ss-dep-probe` operation instruments a callback or boundary with sentinels, drives the upstream
  behavior, and reports observed argument types/order and effects. For pytask it would execute the
  matching pytest traceback filter with a sentinel `__tracebackhide__` callable and record whether
  the callback receives exception-info or a frame. Its output is an experiment transcript, not a
  source excerpt.
- **Why this is not the dead “dependency-source reach” retrieval idea:** it does not add upstream
  text to search results. It executes the locked dependency and returns new observed behavior,
  making source availability optional.
- **Vehicle and differential:** sweet-only daemon service backed by a local dependency store. No
  shared FRAME. It requires normal task-relevant package metadata, not benchmark labels.
- **Quantified ceiling:** sweet pytask is already 2/2 on codex, but is 0/2 on opencode and
  claude-code. Ceiling: **+0 codex tasks, +1 opencode, +1 claude-code**, with codex stability. Sweet
  spend is **$0.012807 / $0.006745 / $0.052958**. If the two Claude reps were capped at the observed
  cheap sweet r1 cost (`2 x $0.006595 = $0.013190`), the ceiling saving is **$0.039768**, or 9.7% of
  total Claude sweet spend. That would move Claude from $0.407928 to $0.368160, 7.6% below native;
  this is a conditional ceiling, not a forecast.
- **Cheapest `$0` falsifier:** inspect lock metadata and already cached dependency source for several
  DEV callback-protocol tasks, then hand-build sentinel experiments without a model. Kill the idea
  if exact versions are unrecoverable, behavior cannot be triggered in isolation, or most disputes
  are semantic rather than observable.
- **Effect on solve and cost:** it can remove a native-only task on both currently tied harnesses and
  erase the measured Claude cost deficit. Build cost is substantial: ecosystem-specific environment
  builders, storage, licensing review, and likely one to two engineer-months per initial ecosystem.
  It works only when the dependency version is pinned and the disputed contract is dynamically
  observable.

### 6. Trace configuration generators as relations with explicit cardinalities

- **Class:** `NEW CLASS — data/cardinality simulation`.
- **Tier:** `GATED`.
- **Trace evidence:** in `dotnet__yarp-2825`, claude-code sweet r1 correctly observed, “a loop adds a
  route for every matching endpoint port.” It added `routeAdded`, then after a noisy test result
  changed the rule to `!routeAdded || !int.TryParse(servicePort.TargetPort, out _)`; hidden grading
  remained unresolved. Native r1's subagent gave the stronger rule: “endpoints determine
  destinations, not routes” and recommended moving route creation outside endpoint enumeration. The
  main turn still chose the same boolean guard inside the loop.
- **Mechanism:** `ss-cardinality` interprets fixture/config inputs and generator loops as relations.
  It emits identity keys and multiplicities, for example: one ingress path -> one `RouteId`, one
  service -> many matching endpoint ports, one route -> many destinations. It symbolically runs the
  issue's YAML and returns duplicate-key and empty-endpoint witnesses. That makes loop placement an
  observed invariant rather than a prose suggestion.
- **Why this is not a guard or ranking tweak:** it neither caps edits nor changes retrieval order. It
  computes output identities and multiplicities from code plus a concrete input.
- **Vehicle and differential:** sweet-only analysis operation; no FRAME or memory doctrine.
- **Quantified ceiling:** YARP is 0/2 in every arm/harness, giving a conditional **+1 task on each
  harness** ceiling. Current sweet spend is **$0.012030 / $0.013062 / $0.020026**. No savings are
  booked.
- **Cheapest `$0` falsifier:** statically simulate the supplied YAML through the base loop and the
  recorded boolean patches. Require the model to expose both duplicate-route and no-matching-endpoint
  behavior. First, however, repair the DEV test environment: the inspected Claude rep-1 grader log
  terminates because the requested .NET preview SDK is unavailable, so that cell is not clean
  behavioral evidence. Kill or defer the candidate if a working DEV fixture cannot distinguish the
  implementations.
- **Effect on solve and cost:** potentially +1 task everywhere, but this is the lowest-confidence
  resolution candidate because of the grader-environment caveat. Local simulation should not add API
  cost; prove that before promotion.

### 7. Move patch generation and selection into a local multi-patch forge

- **Class:** `NEW CLASS — local repair execution and patch tournaments`.
- **Tier:** `MOONSHOT`.
- **Trace evidence:** in `oceanparcels__parcels-617`, claude-code sweet r0's very first search already
  showed `kernel_vars = [..., 'dt', ...]` and the loop that removes those names from declarations.
  Sweet then read the entire 480-line generator region, searched `funcvars`, read `kernel.py`, grepped
  343 `dt` matches, and finally made the one-line edit. Native r0 delegated once; its worker returned:
  “Remove `'dt'` from `KernelGenerator.kernel_vars` ... [so it is] declared by the existing
  declaration logic,” after which the main agent edited and tested. Both solved, but measured Claude
  cost was $0.007543 sweet versus $0.004547 native before charging native's hidden subagent spend.
  On Apple, YARP, and Dashbitco, localization was likewise already complete; patch choice, not search,
  was the unresolved step.
- **Mechanism:** after one paid model turn states the issue and accepts a causal slice, the sweet
  daemon creates isolated worktrees and uses a local code model plus AST/domain transforms to propose
  several semantically distinct patches. It runs canonical tests and candidates 1/2/4/6-style
  witnesses locally, rejects destructive compatibility shims, and returns one patch with a
  proof bundle. The paid agent reviews the bundle and final diff. This is not a cheaper rendering of
  retrieval; it moves the repair loop itself out of paid-model turns and explores alternatives the
  main agent never wrote.
- **Vehicle and differential:** sweet-only local execution service. It must account for its GPU/CPU
  consumption separately, but it changes API-dollar head-to-head directly. No FRAME change.
- **Quantified ceiling:** define the observed addressable pool as (a) tasks where sweet solved both
  reps plus (b) the six traced frontier tasks Apple, YARP, Dashbitco, Codeception, Bingo, and pytask.
  Its current sweet spend is **$0.196625 codex, $0.182728 opencode, $0.229551 claude-code**. Halving
  paid spend only in that pool saves **$0.0983125 / $0.091364 / $0.1147755**, or
  **36.3% / 41.0% / 28.1%** of each full sweet total. Resulting totals would be
  **$0.1723315 / $0.131415 / $0.2931525**, cheaper than native on all three. This is an architectural
  ceiling. The qualification threshold is at least 15% on every harness with no solve loss.
- **Cheapest `$0` falsifier:** replay the 204 traces at the first-edit checkpoint and classify whether
  the eventual required change was already localized and whether recorded failures distinguish
  alternate patch semantics. On DEV only, inspect whether a small candidate set containing the
  accepted principle could have been generated from that checkpoint. Kill the project if fewer than
  30% of paid dollars sit behind sufficiently specified checkpoints; at 50% savings, less than 30%
  addressability cannot reach the required 15% total move.
- **Effect on solve and cost:** this is the only candidate with a direct, dataset-wide 15%+ cost
  thesis on all three harnesses. Resolution must be a hard veto: release only if it preserves every
  robust solve and produces at least one 2/2 DEV/fresh-task flip. Build cost is very high—several
  engineer-months, sandbox orchestration, local model serving/GPU capacity, language runners, and
  proof-certificate design. It works only if local candidate diversity is real and the verifier is
  stronger than the generator.

### Portfolio implication

The ceilings are alternatives, not an additive promise. A minimally sufficient domination path is:

- Candidate 2 flips Apple 2/2 on each harness: sweet resolution becomes **11/17 vs 9** on codex and
  **10/17 vs 9** on both opencode and claude-code.
- Candidate 7 cuts paid spend by 50% within its stated addressable pool: the displayed totals make
  sweet materially cheaper on all three while preserving solves.

A cheaper first program is to gate candidates 2, 3, and 4 on DEV/fresh tasks while doing the `$0`
forge replay. Do not run a paid pilot until one resolution mechanism survives its `$0` falsifier and
the cost design has an explicit solve-preservation gate.

## 4. Self-audit against Section 5

### Class distribution

| Candidate | Class | Existing §0.5 row? | Tier |
|---:|---|---|---|
| 1 | issue-to-executable-spec compilation | no | MOONSHOT |
| 2 | domain state-space model checking | no | GATED |
| 3 | artifact-graph authoring | no | GATED |
| 4 | runtime public-surface conformance | no | GATED |
| 5 | dependency behavior experimentation | no | MOONSHOT |
| 6 | data/cardinality simulation | no | GATED |
| 7 | local repair execution and patch tournaments | no | MOONSHOT |

- **Existing-class quota:** zero candidates occupy any §0.5 row; therefore no existing row has more
  than two. The “NEW CLASS” labels are substantive: these operations execute, model, author, or run
  repair loops rather than adjust retrieval, rendering, prompts, annotations, limits, ranking, or
  cache prefixes.
- **Four-new-class quota:** seven candidates fit no existing row.
- **Moonshot quota:** candidates 1, 5, and 7 are `MOONSHOT`.
- **Trace-only quota:** candidates 1 through 7 all depend on rollout sequence and include direct
  quoted turn evidence. The critical facts—correct first patch followed by a
  destructive edit, green invalid recursion, one-quadrant transition, missing new modules,
  enumerability retreat, callback argument guess, and post-localization wandering—cannot be derived
  from aggregate rows.
- **Banned compactness move:** none presents the same information more compactly. Each returns new
  executable evidence, authored artifacts, observed dependency behavior, or an actual patch.
- **Banned grading move:** none relies on any-rep scoring, test stripping, or hidden-test labels as
  its product mechanism. Grader artifacts were used to diagnose recorded failures; all proposed
  gates are behavioral and must run on DEV or fresh tasks. Rep instability is reported rather than
  counted as a win.
- **Vehicle check:** every lever is sweet-only and therefore can move the head-to-head. No candidate
  is placed in the shared FRAME. M± remains general and unchanged. HO2 remains frozen.
- **Resolution/cost check:** solve is a veto for every cost claim. Candidates 1–6 earn their place by
  a plausible full-task flip; candidate 7 earns it by a quantified 15%+ cost move with an explicit
  no-solve-loss gate.

**Verdict:** this is a research slate, not approval to build or spend. The first GO gate is a `$0`
DEV/fresh-task falsification of candidates 2–4 plus the candidate-7 checkpoint replay. Until then:
**NO-GO for a paid pilot.**
