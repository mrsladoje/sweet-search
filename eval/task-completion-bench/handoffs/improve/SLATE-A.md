# Session A: domination slate

## 1. Inversion

> **I am a smart engineer hired to make NATIVE crush SWEET. I have the same 204 traces. What do I exploit?**

I would not try to make native rank code better. I would exploit differences in the *kind of work* each arm can perform and in when it commits to a hypothesis.

1. **Make sweet pay for an interaction protocol before it has earned that cost.** Native can begin with ordinary reads, grep, shell, or a cheap delegated diagnosis. Sweet pays its memory/tool-policy tax and often serializes search, read, grep, edit, and test. In `oceanparcels__parcels-617` (Claude, rep 0), native's main-agent ledger is `$0.004547` while sweet costs `$0.007543`; both solve. In `dart-lang__http-1114` (Claude, rep 0), sweet spends `$0.031187` versus native's `$0.018089`; neither solves. I would route easy or already-localized work away from sweet and reserve sweet only for cases where its index changes the decision.

2. **Keep alternative semantic hypotheses alive longer.** In `pytask-dev__pytask-210` (OpenCode, rep 0), native reads both `traceback.py` and the sibling debugger path and calls the predicate with `exc_info`; it solves. Sweet sees the same neighborhood, declares that “the relevant logic is isolated in `src/_pytask/traceback.py`,” admits “My current blind spot is the exact callable contract,” chooses a zero-argument call anyway, and fails. I would make native exploit its less-opinionated tools to delay editing until the behavior contract—not merely the edit locus—is known.

3. **Turn cheap delegation into causal diagnosis, not more retrieved text.** In `oceanparcels__parcels-617`, native's Explore subagent returns the causal chain—`dt` enters `kernel_vars`, is removed from `funcvars`, and is not a generated-function argument—before the main agent edits one line. Sweet retrieves a 480-line span and reconstructs the same chain in the expensive main model. The benchmark currently omits native subagent cost, so I would exploit that accounting gap to win the displayed metric; for a real product win I would preserve the division of labor but include every request in the cost ledger.

4. **Use executable semantics where sweet offers static evidence.** In `apple__swift-nio-http2-145` (Codex, rep 0), both arms make the same one-line state-machine edit and fail. Sweet receives only “Script running with cell ID 5” from `run_tests` and nevertheless says “run_tests completed successfully.” In `dotnet__yarp-2825` (OpenCode, rep 0), both arms make the same guard insertion and neither executes the zero/one/many-match boundary cases implied by the issue. I would make native use its unrestricted execution surface to manufacture counterexamples before trusting a plausible patch.

5. **Exploit sweet's bias toward existing artifacts.** `joshuakgoldberg__bingo-274` requires a new multi-file API shape. Both arms find and edit the obvious existing `handlebars.ts`; sweet says it is “adding explicit `handlebarsFile` and `handlebarsDirectory` wrappers,” gets 421 visible tests green, and still fails. Search cannot retrieve files that do not exist. I would have native reason from package conventions and author the missing architecture while sweet keeps asking the index for predecessors.

6. **Select the surface per task instead of accepting an arm-wide average.** The per-task wins are not nested: sweet alone gets the Codex `pytask` cell, native alone gets the OpenCode/Claude `pytask` cells, sweet gets a Claude `dash` rep and an OpenCode `teleport` rep, and native gets the complementary failures. A smart native team would learn observable pre-edit signals for when semantic search helps and otherwise use the cheaper primitive path. The post-hoc oracle is not a deployable rule, but it is the correct upper bound to attack.

7. **Refuse undefined work instead of doing expensive archaeology.** On `mransan__ocaml-protoc-202` (OpenCode, rep 0), sweet makes zero calls and stops at `$0.000858` because the prompt is empty. Native spends `$0.005646`, searches TODOs, invents an unrelated lexer patch, and still fails. This is currently a sweet advantage; to make native crush sweet I would copy it immediately. It also warns that “more exploration” is not intrinsically useful.

The inversions implied by this opponent view are therefore not another ranking weight, context pack, prompt doctrine, or compact result. They must change at least one of: who performs diagnosis, which interaction surface is selected, whether behavior is executed before editing, or whether the system can author structures absent from the corpus. The slate below will be generated only from those attack surfaces.

## 2. Trace log and discarded ideas

### Full end-to-end reads

The required access check returned **68, 68, 68, 14, 104**. I then read **14 complete raw rollouts**, every message and every untruncated tool result, as seven arm-paired cases. I used `/root/dump-trace.mjs`; none of these counts comes from `trajectories/`.

| # | task | harness / rep | arms read | observed outcome |
|---:|---|---|---|---|
| 1 | `pytask-dev__pytask-210` | OpenCode / 0 | native + sweet | native solves; sweet fails |
| 2 | `dashbitco__nimble_options-43` | Claude / 1 | native + sweet | native fails; sweet solves |
| 3 | `apple__swift-nio-http2-145` | Codex / 0 | native + sweet | neither solves; byte-identical one-line source change |
| 4 | `dotnet__yarp-2825` | OpenCode / 0 | native + sweet | neither solves; byte-identical patch |
| 5 | `oceanparcels__parcels-617` | Claude / 0 | native + sweet | both solve |
| 6 | `mransan__ocaml-protoc-202` | OpenCode / 0 | native + sweet | neither solves; sweet correctly refuses an empty issue |
| 7 | `joshuakgoldberg__bingo-274` | OpenCode / 0 | native + sweet | neither solves; both converge on the same existing file |

This covers both-solved, neither-solved, sweet-win, and native-win pairs. I also did a tools-only skim of both Claude rep-0 `dart-lang__http-1114` arms; I do **not** include those two in the full-read count.

### What the rollouts changed in my model

- Sweet's primary failure is usually **not failure to retrieve the locus**. On `apple` and `dotnet`, both arms edit the exact substantive file and still encode the wrong behavior. On `pytask`, sweet's first search already returns `traceback.py`, its visible test, and `debugging.py`; the model still makes the wrong callable-contract decision.
- Sweet often converts “sufficient retrieval” into **premature semantic closure**. The `pytask` sweet trace says both “the relevant logic is isolated” and “My current blind spot is the exact callable contract” immediately before committing the unverified zero-argument hypothesis.
- Native's best Claude behavior is a different compute topology. Its `oceanparcels` Explore worker derives a causal explanation before the main model reads or edits; sweet makes the main model carry a long source span and perform that diagnosis itself.
- Existing-code search cannot solve an authoring problem. Both `bingo` traces correctly name the two desired APIs, but both append them to `handlebars.ts`. Three necessary implementation modules do not exist at base.
- Visible-suite success is weak evidence. `bingo` is 421/421 green and wrong; `dotnet` has only known baseline failures and is wrong; sweet `apple` never observes completion at all but asserts success.

### Generated, then discarded

1. **“Make `run_tests` synchronous and forbid an unobserved success claim.” — discarded as the slate lever.** The `apple` sweet trace gets only “Script running with cell ID 5” and later claims “`run_tests` completed successfully.” That is a real product defect. But native *does* observe the stale failure and still lands the same incomplete patch. Polling would improve evidence honesty, not supply the missing send/receive and half-open cases; putting completion discipline in the FRAME also gives both arms the change and zero differential.

2. **“Retrieve sibling sites before editing.” — discarded at the mechanism level.** `pytask` sweet's first `ss-search` already includes `debugging.py`. `bingo` needs three modules that do not exist. Every `dart` cell already finds `base_response.dart`, the one substantive gold file. More retrieval attacks none of those failures and would worsen the Dart scope explosion.

3. **“Arbitrate stale visible tests in favor of the issue.” — discarded.** It looks excellent on `dash`: native says “available types should logically include integers,” then subtracts `:integer` from its error enumeration to keep the old assertion green and fails; sweet leaves the semantic change intact and solves one rep. But it is a single-rep event, it is already in the dead prompt/verification surface, and a mechanism keyed to stale benchmark assertions is explicitly banned. The product-level invariant belongs in an executable contract, not an oracle-override doctrine.

4. **“Cap the edit to the first high-confidence file.” — discarded.** The Claude `dart` tools show sweet editing seven files and spending `$0.031187`, so a cap looks tempting. Yet merely restricting the same wrong `headersAll` design to `base_response.dart` does not synthesize the required cookie-aware API. Across all cells native also adds more wrong files than sweet (31 versus 27), so a sweet-only static cap has neither a clean differential nor a demonstrated solve path.

5. **“Force exploration when no edit is made.” — discarded by the empty-prompt trace.** `mransan` sweet says, “The issue description is empty. Please provide the actual bug report,” costs `$0.000858`, and stops. Native spends `$0.005646`, mines TODOs, patches an unrelated lexer rule, and fails. An exploration floor would make sweet strictly worse.

6. **“Use Claude subagents because their cost is absent from the ledger.” — discarded as an accounting exploit.** It would improve the displayed score, not the product. The viable descendant below includes every sidechain request in cost and survives only if the delegation is still cheaper.

## 3. Ranked slate

### Portfolio bar: what “domination” means here

The slate is a set of hypotheses, not a claim that domination is already proven. I use the handoff's “aim big” rule and set the cost bar at **15% below native**, stricter than mere sign-flipping. Costs below are the paired task-mean sums used by the evidence pack.

| harness | native | current sweet | 15%-below-native ceiling | additional cut sweet needs | native solve | required sweet solve |
|---|---:|---:|---:|---:|---:|---:|
| Codex | `$0.144666` | `$0.135322` | `≤$0.122966` | `$0.012356` | 9/17 | ≥10/17 |
| OpenCode | `$0.135444` | `$0.111390` | `≤$0.115127` | already `$0.003738` under | 9/17 | ≥10/17 |
| Claude | `$0.199218` | `$0.203964` | `≤$0.169335` | `$0.034629` | 9/17 | ≥10/17 |

The Claude column is a conservative target against the published main-session-only ledger. Native has more uncharged sidechain use; all-request accounting must be fixed before a paid comparison. A future gate must report both task solve and resolved reps, not exploit the any-rep rule. Current native resolved-rep counts are 18/34 Codex, 17/34 OpenCode, and 15/34 Claude.

The OpenCode pass is not robust to the zero-character `mransan` artifact. Excluding it gives native `$0.128252` and sweet `$0.110528` (`−13.82%`); the 15%-below-native target is `$0.109014`, leaving a `$0.001513` gap. I carry that sensitivity into the portfolio gates rather than funding a strategy that wins by refusing a missing issue.

### 1. Selective Superset: native-first, sweet-on-demand

- **Class:** `NEW CLASS — adaptive interaction control plane`. This is not a guard or prompt tweak: it changes which tool protocol exists for each phase of the task.
- **Tier:** `GATED`.
- **Trace evidence — TRACE-ONLY ORIGIN #1:** In the pre-edit `pytask` sweet state summary (OpenCode, rep 0), after one `ss-search` and immediately before `apply_patch`, the model says, “My current blind spot is the exact callable contract,” but chooses a zero-argument callable and fails at `$0.003288`. Native says, “The traceback filter has access to exception info, which is the natural argument,” checks surrounding paths, passes `exc_info`, and solves at `$0.005778`. The direction reverses elsewhere: `dash` sweet (Claude, rep 1) retains the semantically complete change and solves for `$0.009086`, while native preserves the old enumeration and fails for `$0.011561`. On empty `mransan` (OpenCode, rep 0), sweet's zero-call refusal is the right route.
- **Mechanism:** Ship sweet as a superset with three phase-selectable surfaces: native file primitives, `ss-*`, and candidate 2's diagnosis transaction. A controller outside the expensive model starts with issue text and cheap repository metadata and exposes only the selected surface. A switch starts a fresh session with the new tool allowlist and a typed handoff, rather than appending another policy and schema set to the same context. It must not inject the sweet tool policy or schemas until it selects sweet. Training and gating features may include issue shape, language, repo topology, whether the first probe names an exact symbol, disagreement between retrieved tests and source, and explicit uncertainty before an edit. They may not include task ID, repo memorization, hidden results, or final outcome. An empty issue routes to refusal.
- **Vehicle and differential:** Sweet-only wrapper/controller; native remains unchanged. A routing paragraph in the shared FRAME would have zero differential and is not the vehicle.
- **Quantified ceiling:** A post-hoc **task-level, rep-count-first** selector—choose the arm with more resolved reps for a task, then the cheaper arm on ties—would produce:

  | harness | native | selector ceiling | cost vs native |
  |---|---:|---:|---:|
  | Codex | 18/34 reps, `$0.144666` | 20/34 reps, `$0.127502` | `−$0.017165` (`−11.9%`) |
  | OpenCode | 17/34 reps, `$0.135444` | 18/34 reps, `$0.112547` | `−$0.022897` (`−16.9%`) |
  | Claude | 15/34 reps, `$0.199218` | 16/34 reps, `$0.186907` | `−$0.012311` (`−6.2%`) |

  Those selections yield 10/17 task cells on each harness versus native's 9/17, but the new OpenCode and Claude task cells are single-rep events. This is an upper bound proving complementarity, not evidence that a predictor exists. It also misses the 15% cost bar on Codex and Claude. Excluding empty `mransan`, its OpenCode cost is `$0.111685` versus a `$0.109014` target, so it misses there too. It needs candidate 2 even at its ceiling.
- **Cheapest $0 falsifier:** Extract only features observable before the first edit from the retained paired traces. Pre-register a simple route rule, evaluate it leave-one-task-and-repo-out, and score the selected full outcomes with all sidechain cost included. Kill it unless it beats native task solve **and** resolved-rep count on every harness, remains cheaper on every harness, and does not derive its gain from identifying benchmark tasks or reps. This requires no rollout.
- **Effect on both:** Potentially improves solve by keeping each surface's complementary wins and lowers cost by avoiding sweet's tax where it adds no information. A wrong route can lose a solve; the current data contain no deployable predictor, so this is `GATED`, not a recommendation to ship.

### 2. Ephemeral causal coprocessor with context reset

- **Class:** `NEW CLASS — compute topology / delegated causal diagnosis`. It is not result compaction: a separate worker performs new reasoning and produces executable evidence; merely summarizing the same retrieved span would invalidate the candidate.
- **Tier:** `GATED`.
- **Trace evidence — TRACE-ONLY ORIGIN #2:** Native's first Explore worker on `oceanparcels` Claude rep 0 reports: “`KernelGenerator.kernel_vars` ... contains `'dt'`,” `generate()` removes it from `funcvars`, and “The generated kernel function does **not** receive `dt` as an argument,” then gives the exact one-line fix. Sweet first retrieves the code generator, says its “Current blind spot” is the exact assignment path, reads a 480-line span, searches again, and eventually reaches the same edit in the expensive main context. Both solve.
- **Mechanism:** Add an `ss-diagnose` transaction. It launches one or more stateless, cheaper specialists with index, AST, and test access; their searches and discarded hypotheses never enter the main model's growing context. The returned object contains a causal chain with source anchors, an uncertainty list, a minimal reproducer or falsifying command, and an edit constraint. The main session is reset to a short apply-and-prove phase. Every nested request is recorded and priced. If the object contains only a shorter rendering of code the main model would have read, reject the design—it has fallen back into the banned compaction class.
- **Vehicle and differential:** Sweet-only tool backed by a diagnosis service. Native receives neither the service nor its memory. This is not FRAME text.
- **Quantified ceiling:** For the observed `oceanparcels` rep, native main costs `$0.004547`. Its omitted Explore request used 3 input tokens, 8,535 cache-creation tokens, and 362 output tokens; at the ledger rates that is about `$0.001071`. Fair total is therefore about `$0.005618`, still `$0.001925` (`25.5%`) below sweet's `$0.007543`, with both solved. That is one-cell evidence, not a harness result. On Claude, sweet's cached-input mass is `$0.0897`, about 43% of its bill. A measurable 15% cut to sweet is `$0.030595`, or 34.1% of that cached-input pool; reaching this slate's stricter 15%-below-native target requires `$0.034629`, or 38.6%. The absolute ceiling is large enough; exposure is unproven.
- **Cheapest $0 falsifier:** Re-price all 14 retained Claude sidechain files with the runner's exact pricing function, align them with their main traces, and label whether the specialist supplied the causal edit before the main model did. For Codex and OpenCode, use the earliest causal statement in the retained paired trace as a best-case handoff, then simulate resetting the recorded main trajectory at that point. Kill the candidate if all-request cost does not fall at least 15% on diagnosis-exposed DEV cells or if the diagnosis is wrong on any previously solved cell. For the portfolio, require projected savings of at least the selector's residual gaps—`$0.004535` Codex, `$0.002671` OpenCode with empty `mransan` excluded, and `$0.017572` Claude. Without an independently surviving selector, require the full `$0.012356`, `$0.001513`, and `$0.034629`, respectively. No model call or rollout is needed.
- **Effect on both:** Direct cost target is fewer expensive cached-context turns; solve may improve when a specialist preserves alternative hypotheses, but the only fully read existence proof is solve-neutral. A wrong diagnosis could make both metrics worse, so the causal object and reproducer are veto gates.

### 3. Executable issue-contract compiler

- **Class:** `NEW CLASS — executable specification synthesis`. This does not annotate or verify an existing patch. It creates and executes a product behavior contract *before* the first edit and changes the agent's required deliverable.
- **Tier:** `MOONSHOT`.
- **Trace evidence — TRACE-ONLY ORIGIN #3:** Four traces expose missing behavior, not missing code. `pytask` sweet (OpenCode, rep 0) explicitly edits through an admitted callable-contract blind spot. After editing, `dotnet` sweet (OpenCode, rep 0) says, “The source fix now emits one route per ingress path, only after the first endpoint port actually matches, while still adding destinations from all matching ports and subsets.” But it puts `routeAdded` outside the subset loop and never executes a multi-subset boundary table. `apple` sweet (Codex, rep 0) localizes the exact state and adds only `halfClosedLocalPeerIdle`; its first `ss-search` shows both `sendPushPromise` and `receivePushPromise`, yet it never tests the send/receive × body/no-body symmetry. On `dash` native (Claude, rep 1), after the visible assertion fails, the model reasons that available types “should logically include integers” but deliberately subtracts the new type to satisfy that old string assertion.
- **Mechanism:** Compile issue prose, included examples, public types, and nearby state/loop structure into a temporary `Contract` DSL: inputs, expected observations, preserved invariants, and explicit variation axes. Language adapters materialize the contract as disposable probes in an overlay and run it against the unmodified program and candidate patch. Examples from these traces are: invoke `__tracebackhide__` with the current exception and observe its Boolean result; instantiate the YARP YAML reproduction with duplicate ports and multiple subsets while asserting one route plus all destinations; enumerate HTTP/2 send/receive and end-stream true/false states; assert that every accepted NimbleOptions primitive is also advertised. The production mechanism sees only issue and base repository—never hidden tests or gold.
- **Vehicle and differential:** Sweet-only executable-spec service. A shared “write tests first” instruction would be FRAME-level and zero differential; that is explicitly not this mechanism.
- **Quantified ceiling:** The four exposed tasks (`apple`, `dotnet`, `dash`, `pytask`) currently consume 20.5% of sweet Codex cost, 21.6% of OpenCode, and 28.9% of Claude. If a correct contract flipped every currently unsolved exposed task, the task ceiling is **+3/17 Codex, +4/17 OpenCode, +3/17 Claude**. This is an exposure ceiling, not an expected effect, and overlaps candidate 5. Contract execution adds local compute and may add model turns; it is not a cost win unless it replaces wrong-edit iterations or uses candidate 2's reset topology.
- **Cheapest $0 falsifier:** On these four DEV tasks, hide `test_patch` and gold, derive a product contract from issue plus base only, and lock it. Then run the locked contract against the stored native, sweet, and gold patches in disposable local checkouts; reveal retained tests only after scoring. Require the contract to distinguish the behaviorally correct patch from the stored losing patches on at least three tasks and not reject successful control patches. Using retained tests as an after-the-fact DEV label is allowed; using them in the mechanism is not. HO2 remains untouched.
- **Effect on both:** The intended move is one or more whole task solves, especially at perfect localization. Cost is initially neutral-to-worse; domination requires it to remove enough blind exploration or pair with candidate 2. It must be killed if generated contracts are brittle or benchmark-shaped.
- **Moonshot cost and truth conditions:** Roughly two to three engineers for two quarters for a DSL, sandbox, and useful Python/C#/Swift/Elixir/TypeScript adapters. It works only if issue text and source expose enough semantics to generate discriminating properties and the probes are much cheaper than extra Luna turns.

### 4. Change-obligation compiler that can author absent code

- **Class:** `NEW CLASS — architectural obligation synthesis / code authoring`. It is not retrieval expansion: its key output is a graph and typed skeletons for artifacts that do not yet exist.
- **Tier:** `GATED`.
- **Trace evidence — TRACE-ONLY ORIGIN #4:** In `bingo` sweet (OpenCode, rep 0), after baseline `run_tests` and immediately before `apply_patch`, the model says, “`handlebars` currently delegates both file and directory inputs to the same recursive executor,” then announces explicit file and directory wrappers. Paired native (OpenCode, rep 0) independently calls it “an API/type-surface feature.” Both append both wrappers to existing `handlebars.ts`, rely on the wildcard export, pass 421 visible tests, and fail. The missing architecture includes three new implementation modules plus existing export and overload obligations; no search result could have returned the new modules. The `dash` native trace (Claude, rep 1), after a visible exact-string failure, shows the complementary obligation failure: it registers and documents `:integer` but explicitly removes it from the public “available types” projection.
- **Mechanism:** Add `ss-plan-change`, which accepts a proposed API or invariant and builds a typed obligation graph from package boundaries, export conventions, discriminated unions, overloads, and every projection of the affected domain set. Nodes are actions such as `author module`, `export symbol`, `preserve overload`, `add type predicate`, `update public enumeration`, and `prove wrong-kind rejection`. It may materialize typed skeletons in an isolated overlay for the main agent to fill. For `bingo`, the graph must infer separate file/directory APIs, a reusable file predicate in the owning `bingo-fs` package, export wiring, and recursive return-type preservation. For `dash`, adding a primitive must update validation, documentation, and advertised-type projection as one atomic domain change.
- **Vehicle and differential:** Sweet-only planning/authoring tool in the owning bounded contexts; native remains plain tools. Prompting the main model to “check exports” would be dead doctrine and is not the vehicle.
- **Quantified ceiling:** `bingo` alone is a clean **+1/17 task on every harness** if solved. At unchanged per-task cost, that would move sweet to 11/17 vs 9/17 on Codex, 10/17 vs 9/17 on OpenCode, and 10/17 vs 9/17 on Claude. Its current sweet cost is only about `$0.0070`, `$0.0067`, and `$0.0095`, so even deleting all of that would save only 5.2%, 6.0%, and 4.7% of the respective sweet totals: this is a resolution lever, not the cost answer. A broader API-obligation exposure set (`bingo`, `dash`, `dart`) has a ceiling of +3/+3/+2 tasks and occupies 25.3%/24.4%/27.3% of sweet cost, but that broader generalization is unproven.
- **Cheapest $0 falsifier:** Hide the `bingo` gold and have an independent reviewer derive the obligation graph using only the issue, base tree, and package conventions. Lock it, then reveal the DEV gold code roles. Require it to predict all three novel modules and both existing cross-package/overload edges; documentation does not count. Repeat on other DEV feature-addition tasks with newly created files. Kill it if the architecture is not predictable without gold or if it degenerates into “retrieve more siblings.”
- **Effect on both:** Potentially supplies the one robust task needed for solve domination on OpenCode and Claude. Planning may add token cost, though it should prevent futile searches; candidates 1 and 2 must pay for it. Wrong architectural synthesis expands scope and can hurt both metrics.

### 5. Counterfactual patch tournament with a mutation referee

- **Class:** `NEW CLASS — bounded search over program states`. It is not a post-edit verifier: sweet stops betting the whole rollout on one patch and instead executes mechanically distinct alternatives in isolated branches.
- **Tier:** `MOONSHOT`.
- **Trace evidence — TRACE-ONLY ORIGIN #5:** `pytask` sweet (OpenCode, rep 0) names its uncertainty immediately before its edit and commits the wrong zero-argument branch; paired native supplies a different branch that solves. Both `dotnet` OpenCode rep-0 rollouts verbalize the right high-level goal but place the Boolean guard at the same outer scope; moving the flag inside the subset loop is an untried, mechanically distinct hypothesis. Both `apple` Codex rep-0 rollouts choose the same one-state change despite source context containing dual send/receive methods and half-open/half-closed variants. `dash` native (Claude, rep 1) identifies the semantic alternative after the test failure, calls its own compatibility treatment a “hack,” and still commits it.
- **Mechanism:** Given an issue contract or reproducer, create 2–4 ephemeral overlays and require diverse patch generators to vary the disputed semantic dimension—not wording. Examples are callable arity/data flow, loop-variable lifetime, state-machine symmetry, and single-file wrapper versus package-level modules. A mutation referee runs the product contract plus generated boundary mutations, rejects patches that survive only the visible suite, minimizes the winning diff, and returns one proof-carrying patch to a fresh main session. Branch transcripts are not replayed into that session.
- **Vehicle and differential:** Sweet-only `ss-tournament` service. Native can manually make worktrees, but it does not receive the automated hypothesis generator, referee, or context reset. Shared test guidance is not the differential.
- **Quantified ceiling:** Selecting between only the *existing* native and sweet outcomes already has the rep-safe oracle ceiling reported for candidate 1: 20/34, 18/34, and 16/34 resolved reps at `$0.127502`, `$0.112547`, and `$0.186907`. Novel alternatives raise the resolution exposure ceiling to the same non-additive +3/+4/+3 tasks as candidate 3. To meet the 15% cost target after the existing-arm oracle, the service must still remove `$0.004535` on Codex and `$0.017572` on Claude; OpenCode has `$0.002580` of margin. If tournament branches use multiple full-price Luna sessions, cost necessarily moves the wrong way.
- **Cheapest $0 falsifier:** Use the stored native, sweet, and gold DEV patches as an unlabeled candidate pool. Generate mutation dimensions from issue and base source only, lock the referee, and ask it to select a patch before revealing resolution labels. Require correct selection on at least 80% of exposed cases, no rejection of previously solved controls, and a projected all-request cost below the portfolio ceilings. This tests the referee premise without a rollout; it does not license gold at runtime.
- **Effect on both:** It can turn semantic coin flips into solve gains and isolate failed branches from the costly main context. It can just as easily multiply cost while selecting the same wrong hypothesis; the cost ledger and referee accuracy are hard vetoes.
- **Moonshot cost and truth conditions:** Approximately four to six engineer-months for overlay isolation, multi-language mutation adapters, cheap local synthesis workers, and proof capture. It works only if correct patches appear in a small diverse pool, issue-derived mutations discriminate them, and branch generation is substantially cheaper than the current main-model trajectory.

### Portfolio interpretation

Candidates are **not additive by default**. Candidates 1 and 5 share the existing-arm oracle ceiling; candidates 3 and 5 share much of the resolution exposure; candidates 3 and 4 may generate overlapping obligations. The credible domination path is therefore conditional:

1. candidate 1 must demonstrate predictable complementarity without any-rep or task-identity leakage;
2. candidate 2 must pay the Codex/Claude cost gaps and the OpenCode no-empty sensitivity gap with fully accounted, ephemeral diagnosis; and
3. either candidate 3 or 4 must deliver at least one genuine task flip on both OpenCode and Claude without losing current solves.

No current artifact proves all three conditions. The correct output of Session A is a slate with cheap kill tests, not a GO for a paid rollout.

## 4. Self-audit

- **Candidates:** 5.
- **§0.5 class distribution:** retrieval expansion 0; rendering/compaction 0; prompt/memory 0; verification/annotation 0; guards/limits 0; ranking 0; cache/prefix 0.
- **New classes:** 5—adaptive interaction control, delegated compute topology, executable specification synthesis, architectural obligation authoring, and bounded program-state search. This exceeds the minimum of four; no §0.5 class has more than two.
- **Moonshots:** 2—candidates 3 and 5. Each states build cost, mechanical requirements, solve/cost ceiling, and what must be true.
- **Trace-only origins:** all five candidates cite rollout behavior and direct quotes; candidates 1–4 especially depend on facts that the aggregate tables cannot reveal. This exceeds the minimum of three.
- **Banned compacting move:** none. Candidate 2 is valid only when a separate worker computes a causal proof and executable evidence; if it merely shortens an existing result, it is explicitly killed.
- **Banned grading move:** none. Contracts, mutations, and obligation graphs are generated from issue plus base repository. DEV gold/test patches appear only after a gate is locked, as retrospective labels. No mechanism sees hidden tests, uses stale-assertion stripping, or relies on the any-rep task rule.
- **Solve veto:** every cost claim is paired with solve/rep status. The selector ceiling is reported in resolved reps as well as task cells; single-rep flips are disclosed rather than promoted as stable wins.
- **Differential:** every candidate is a sweet-only product capability. Any FRAME-only descendant is called out as zero differential and rejected.
- **Ranking safety:** none changes ranking. If any future obligation/query detector touches ranking, it must be gated on `opts._isAgentFormat` before evaluation.
- **Data/spend:** 14 complete rollouts read; 2 additional rollouts skimmed tools-only; `$0` spent; no rollout launched; no build performed; `results/` and HO2 untouched.
