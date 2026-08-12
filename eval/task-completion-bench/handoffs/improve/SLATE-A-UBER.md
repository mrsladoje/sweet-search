# SLATE A — adjudicated combined plan

> **Phase 0 has since been executed — see [`PHASE-0-RESULTS.md`](./PHASE-0-RESULTS.md) (2026-08-12, `$0`).**
> The cost figures in §4.1 and the ceilings in §5 reproduce exactly and remain valid as the
> *pre-repair* baseline, but three of them are now superseded:
> **D-2** moves Claude from `+2.4%` sweet-worse to `−9.4%` sweet-cheaper and closes 62% of the
> Claude cost gap; **D-1** is repaired at the root (the rollout grader never passed
> `--reapply-install-seds`) but uncovered a second defect — `dotnet__yarp-2825`'s own gold
> patch fails the `PASS_TO_PASS` gate in 4 of 8 identical runs — so every `+1 task` YARP
> scenario in §4.1 is void and that task carries no solve number; **D-4/D-5** are fixed.
> Read that document before acting on any number below.

**Sources:** [`SLATE-A.md`](./SLATE-A.md) and [`SLATE-A-FABLE.md`](./SLATE-A-FABLE.md) — **Lens:** cost first, resolution second<br>
**Status:** research and planning only; no paid GO<br>
**Spend during both source sessions and this merge:** `$0`<br>
**Protected state:** no rollout launched; remote `results/` not mutated; HO2 untouched

This is a curated merger, not a concatenation. It preserves every actionable suggestion from both source slates, corrects conflicts between them, keeps rejected ideas with their killing evidence, and separates four kinds of statement that must not be blurred:

1. **confirmed defects** that invalidate or contaminate the current scoreboard;
2. **gated product levers** that have a cheap `$0` falsifier;
3. **moonshots** whose value is plausible but whose build or evaluation cost is substantial; and
4. **reserve ideas** worth retaining but not qualified for the ranked slate.

The central correction is that `dotnet__yarp-2825` is not currently evidence of a semantic model failure. Its grader never ran a test. Any ceiling or diagnosis that treated its recorded zero as a real behavioral failure has been corrected below.

---

## 0. Executive verdict

The two source slates are complementary:

- Fable found the strongest concrete facts: the broken YARP grading oracle, the `ss-read` gutter causing exact-anchor errors, repeated small-file reads, and the inaccessible dependency source that decides `pytask`.
- The first slate contributed the stronger capability architecture: adaptive native/sweet routing, causal work delegated outside the growing main context, executable issue contracts, authoring obligations for files that do not exist, and counterfactual patch search.

The combined conclusion is **NO-GO for a paid rollout today**. There is a good immediate plan, but the current artifacts do not prove that any stack makes sweet both cheaper and more resolving than native on all three harnesses.

The required order is:

1. repair and rederive the scoreboard;
2. run the deterministic `$0` replay gates;
3. build only mechanisms that survive those gates;
4. then run a pre-registered DEV pilot; and
5. use a fresh task set or sufficient new tasks/reps before making a domination claim.

One additional rep set is not assumed to prove anything. Reps reduce within-task randomness; they do not by themselves resolve generalization across only 17 tasks.

---

## 1. Inversion: how native would crush sweet

> **I am a smart engineer hired to make NATIVE crush SWEET. I have the same 204 traces. What do I exploit?**

1. **Charge sweet for a protocol before it earns its keep.** Native can start with shell, grep, whole-file reads, or a cheap delegated diagnosis. Sweet carries an additional tool policy and often serializes search → read → edit.
2. **Exploit shell composability.** Native can put multiple dependent or independent probes into a single shell call. Sweet's unread trailers invite another `ss-read` call.
3. **Exploit byte-unsafe rendering.** Native's Claude Read gutter is delimiter-separated. Sweet emits `NNN| `, which the model visually absorbs into indentation and then copies into exact-match edit anchors.
4. **Exploit whole-file completeness.** Native can see documentation, domain lists, validators, and exports in one file view. Sweet may reconstruct a 500-line file through several partial reads.
5. **Exploit semantic ambiguity after successful localization.** On `pytask`, `apple`, `dash`, and `bingo`, the important choice is not the file. It is callable contract, state symmetry, public projection, or architecture.
6. **Exploit an inaccessible reference corpus.** The exact upstream implementation linked by the `pytask` issue is absent from the filesystem and network access is blocked. Native has no legal route to it at rollout time.
7. **Exploit off-ledger sidechains.** Claude native delegates more often, while current rows price only the main session.
8. **Exploit benchmark and harness defects.** YARP is auto-failed without an SDK; native Claude wastes many Reads on an empty `pages` parameter. Both distort the comparison in different directions.
9. **Exploit sweet's bias toward existing artifacts.** Search cannot retrieve the new modules that `bingo` requires.
10. **Exploit undefined tasks asymmetrically.** On the zero-character `mransan` issue, native burns calls inventing a task while sweet refuses cheaply. That flatters sweet's cost without improving task completion.

The inversion says the opportunity is not another rank weight or denser result. It lies in tool selection, compute topology, edit addressing, corpus scope, executable semantics, and code authoring.

---

## 2. Evidence base and trace-derived task picture

### 2.1 Trace coverage

The first slate documents **14 complete raw rollouts** as seven native/sweet pairs:

- OpenCode rep 0: `pytask`, `dotnet`, `mransan`, `bingo`;
- Claude rep 0: `oceanparcels`;
- Claude rep 1: `dashbitco`; and
- Codex rep 0: `apple`.

Fable reports **8 full trace reads** plus structured reads and three dataset-wide measurements, including Codex `pytask`, Claude `pytask`, Claude `dart`, Codex `dash`, all 12 YARP grading logs, all 102 grading logs, and the Claude Edit-error census. The two lists overlap on Claude `dash` and OpenCode `mransan`; they are intentionally reported separately rather than summed into a misleading union count.

All full-trace claims came from `/root/dump-trace.mjs` or raw JSONL, never from truncated `trajectories/`.

### 2.2 What the traces establish

#### YARP: recorded failure is invalid

- All **12** YARP grading logs die before any test result because the grading image has no compatible .NET SDK.
- All 12 corresponding rows say `gradeable=true`, `f2pFrac=0`, `resolved=false`.
- The merge independently reconfirmed both facts read-only.
- The six harness × arm predictions all contain the near-gold `routeAdded` guard. They place the guard outside the subset loop; gold resets it inside. That difference may matter generally, but it was **not tested by the grader**, so it cannot be named as the cause of the recorded zero.

Status: **grading unknown pending regrade**, not behaviorally failed.

#### Pytask: one contract argument decides the cell

All arms find the right traceback logic. The decisive variation is what the callable receives:

| harness / arm | argument written | recorded solved reps |
|---|---|---:|
| Codex native | `frame` | 0/2 |
| Codex sweet | `exc_info` | 2/2 |
| OpenCode native | `exc_info` | 1/2 |
| OpenCode sweet | no argument | 0/2 |
| Claude native | `exc_info` in the solving rep | 1/2 |
| Claude sweet | `frame` | 0/2 |

One Claude native rep tried Python, importing `_pytest`, filesystem grep, filesystem find, and WebFetch. Every route to the linked reference failed. It then changed the callable form repeatedly and used 37 calls versus 27 in the rep that guessed correctly. This is both a resolution ambiguity and contract-thrash cost.

#### Apple: localization succeeds; behavioral coverage does not

Both Codex arms make the same one-line `receivePushPromise` change and fail the recorded grader. Sweet's first search exposes send and receive paths plus half-open/half-closed states, but the patch covers only `halfClosedLocalPeerIdle`. Sweet receives only `Script running with cell ID 5` from its test invocation and later claims the tests completed successfully. Native observes a stale visible assertion but still lands the same incomplete source change.

#### Dash: public projection is part of the domain change

The Claude sweet solving rep adds `:integer` to the domain list and leaves it in the advertised types despite a stale visible string assertion. Native explicitly reasons that the type should be advertised, then implements `(@basic_types -- [:integer])` to preserve the old output and fails. Other reps also expose ordering mistakes. This is not a license for a benchmark-specific stale-test override; it is evidence that an executable public invariant is missing.

#### Bingo: the missing implementation does not exist at base

Both OpenCode arms correctly identify `handlebarsFile` and `handlebarsDirectory`, append wrappers to the existing `handlebars.ts`, pass 421 visible tests, and fail. Three required implementation files are new at gold: `isFile.ts`, `handlebarsDirectory.ts`, and `handlebarsFile.ts`. The change also requires export and overload obligations in existing modules. Retrieval alone cannot produce absent files.

#### Dart: scope explosion after finding the right file

Every cell finds `base_response.dart`, the single substantive gold file, then edits five to eight additional files around an incorrect `headersAll`-style design. Claude sweet rep 0 costs `$0.031187` versus native `$0.018089`; neither solves. More sibling retrieval would intensify the failure.

#### Oceanparcels: causal delegation is an existence proof

Claude native's Explore worker reports the whole causal chain before the main edit: `dt` is in `kernel_vars`, removed from `funcvars`, and absent from generated-function arguments. It supplies the exact one-line fix. Sweet retrieves a large generator span and reconstructs that chain in its main context. Both solve.

#### Mransan: refusal is correct for an empty issue

The issue has zero characters. OpenCode sweet makes no calls and asks for the missing report at `$0.000858`. Native searches TODOs, invents an unrelated lexer patch, spends `$0.005646`, and fails. This task must remain in solve accounting as unsolved, but cost publications need an explicit with/without-empty-task sensitivity.

---

## 3. Confirmed defects and scoreboard repairs

These are not product levers. They must be fixed or disclosed before evaluating product levers.

### D-1. YARP grader SDK outage — highest priority

**Evidence:** 12/12 logs have no test-result line and end with an empty installed-SDK list while 12/12 rows say `gradeable=true`.

**Plan:**

1. Add a grader tripwire: a row cannot be `gradeable=true` unless its log contains at least one framework test-result line.
2. Fix the grading image or pin `global.json` to an installed SDK.
3. Regrade all 12 retained YARP patches without launching new agent rollouts.
4. Rebuild rows, solve tables, both-solved cost subsets, and every candidate ceiling below.

**Stop rule:** if main-session reproduction does not match the current rows when side effects are excluded, halt publication and audit for a second grading defect.

**Expected effect:** cost unchanged; absolute solve may rise for both arms. No sweet differential may be claimed until the regrade is observed.

### D-2. Claude sidechain cost is excluded

Native uses sidechains in 8/17 Claude task cells; sweet in 2/17. Prior audit measured approximately `$0.03194` native versus `$0.00982` sweet off-ledger. Repricing those requests moved the descriptive Claude sign from about `+2.4%` sweet-worse to about `−3%` sweet-cheaper, but that was not folded through the runner's exact pricing function.

**Plan:** include every `isSidechain:true` request in per-rep usage and break-priced cost; reproduce today's totals within 0.5% when sidechains are intentionally excluded, then publish the inclusive ledger.

**Effect:** cost scoreboard only; solve unchanged.

### D-3. `ss-read` line-number gutter corrupts exact edit anchors

The agent renderer at `eval/agent-read-workflows/bin/_ss-helpers.mjs:559` currently emits `` `${lineNumber}| ${line}` ``. Fable counted 20 sweet Claude anchor failures versus 7 native, with 14/14 sampled failed→successful pairs showing one extra leading space in the failed anchor. The merge directly inspected the renderer and one representative trace: five leading spaces failed, four succeeded.

**Plan:** this is implemented as candidate C-1, with a deterministic replay and unit coverage before any rollout.

### D-4. Claude native Read sends an invalid empty `pages` parameter

Fable's deduped error census found 68 native and 6 sweet `pages` errors. This inflates native's Claude cost for a harness-adapter reason; fixing it may improve native's Claude result by roughly 2–4% with no product change, so a later rerun must not label that movement a sweet regression.

**Plan:** fix the adapter for both arms, retain the old and corrected cost views, and do not describe a future native improvement as a sweet regression.

### D-5. Empty-issue refusal flatters OpenCode sweet cost

Recorded OpenCode totals are native `$0.135444`, sweet `$0.111390` (`−17.8%`). Excluding `mransan` gives native `$0.128252`, sweet `$0.110528` (`−13.82%`). Publish both.

### D-6. Asynchronous test completion can be reported falsely

In Codex `apple`, sweet receives only a running cell identifier but claims success. Make the test transaction return a terminal verdict or a resumable handle that must be polled before a success claim. This improves evidence honesty, but it is shared completion machinery and therefore has zero head-to-head differential if delivered in the FRAME or to both arms. Keep it as a correctness task, not a domination lever.
Fable also measured OpenCode sweet's remaining non-`ss` Bash workload as exactly 74 `run_tests` calls plus 47 git diff/status calls; there is no hidden third workload for sweet to absorb. On Claude, sweet reaches first edit about 44% sooner, but its post-edit tail is arm-similar and carries the extra C-1 anchor retries: the early retrieval lead is given back through mechanics rather than an undiscovered verification workload.

---

## 4. Baseline and domination gates

### 4.1 Recorded baseline before repairs

| harness | native cost | sweet cost | sweet delta | native solve | sweet solve |
|---|---:|---:|---:|---:|---:|
| Codex | `$0.144666` | `$0.135322` | `−6.5%` | 9/17 | 10/17 |
| OpenCode | `$0.135444` | `$0.111390` | `−17.8%` | 9/17 | 9/17 |
| Claude | `$0.199218` | `$0.203964` | `+2.4%` main-only | 9/17 | 9/17 |

If YARP regrades solved for both arms, the corresponding descriptive task counts become 10/17 vs 11/17, 10/17 vs 10/17, and 10/17 vs 10/17. That is only a scenario, not a result.

### 4.2 Cost target

The measurable planning target remains **at least 15% below native on every harness**, with solve strictly above native:

| harness | 15%-below-native target from recorded ledger | current additional cut needed |
|---|---:|---:|
| Codex | `≤$0.122966` | `$0.012356` |
| OpenCode | `≤$0.115127` | already below; excluding empty task, target is `$0.109014` and gap `$0.001513` |
| Claude | `≤$0.169335` | `$0.034629` on main-only ledger; recompute after D-2 |

These are targets, not predictions.

### 4.3 Non-negotiable evaluation rules

- Solve is the veto dimension. Report cost beside task solve and resolved reps.
- Price all requests, including sidechains and retries.
- Do not use the any-rep rule as a mechanism or hide single-rep instability.
- Do not use task ID, repo memorization, gold, retained tests, or final outcome as runtime inputs.
- DEV-RET only for development. HO2 remains frozen.
- Any ranking signal must be gated on `opts._isAgentFormat`.
- Call-count reduction is a proxy, not a cost result. Replay billed token mass and preserve solve.
- No paid pilot until the grader, ledger, and deterministic gates are clean.
- No mechanism whose advantage is shared FRAME text may be called a sweet differential.

---

## 5. Ranked core slate

### C-1. Anchor-fidelity rendering

- **Class:** result rendering, one candidate in the swept class.
- **Tier:** `GATED`.
- **Evidence:** 20 sweet vs 7 native Claude anchor failures; 14/14 sampled sweet recovery pairs have the extra-space signature; `dash` and `dart` show repeated failed anchors followed by the same text with one fewer leading space.
- **Mechanism:** in the agent-format path, replace `NNN| ` with a delimiter the model cannot absorb into code indentation, preferably a tab-aligned gutter matching native Read, or a gutter-free body plus line map. Apply consistently to read/search/grep blocks used as edit sources. Human CLI output remains unchanged.
- **Vehicle and differential:** sweet-only renderer; native unchanged.
- **Ceiling:** observed call-error exposure supports an upper band of roughly 4–7% of Claude sweet cost and near zero on Codex/OpenCode. This is **not** a measured dollar saving until replayed.
- **Cheapest `$0` falsifier:** regenerate every recorded read with the candidate gutter and apply the observed model copy rule. Require the derived anchors to byte-match their target files. Then replay exact tool transcripts to count eliminated calls and their turn-level billed mass.
- **Solve/cost:** expected solve-neutral or positive, but only a regression test can establish that; cost should fall by removing retries. Kill if native failures show the same signature or if any successful quoted anchor becomes ambiguous.

### C-2. Selective Superset: native-first, sweet-on-demand

- **Class:** `NEW CLASS — adaptive interaction control plane`.
- **Tier:** `GATED`.
- **Evidence:** `pytask` OpenCode favors native; `dash` Claude favors sweet; empty `mransan` favors refusal; several both-solved cells have large cost differences in opposite directions.
- **Mechanism:** expose native primitives, `ss-*`, or C-3's diagnosis transaction by phase. A switch starts a fresh session with a typed handoff and new allowlist rather than appending more schemas to the old context. Features may use issue shape, language, repo topology, exact-symbol confidence, source/test disagreement, and explicit uncertainty. They may not identify benchmark tasks. Empty or malformed issues route to clarification/refusal and remain explicit in sensitivity reporting.
- **Vehicle and differential:** sweet-only wrapper/controller. A routing paragraph in FRAME is not the vehicle.
- **Recorded pre-regrade oracle ceiling:** choose the arm with more resolved reps for each task, then lower cost on ties:

| harness | native | selector ceiling | cost vs native |
|---|---:|---:|---:|
| Codex | 18/34 reps, `$0.144666` | 20/34, `$0.127502` | `−11.9%` |
| OpenCode | 17/34 reps, `$0.135444` | 18/34, `$0.112547` | `−16.9%` |
| Claude | 15/34 reps, `$0.199218` | 16/34, `$0.186907` | `−6.2%` |

It yields 10/17 recorded task cells on each harness versus native's 9/17. OpenCode and Claude's incremental cells are single-rep events. Recompute after D-1/D-2.

- **Cheapest `$0` falsifier:** build a pre-edit feature table from retained traces, lock a simple rule, and evaluate leave-one-task-and-repo-out. Kill unless it beats native in both task solve and resolved reps on every harness while remaining cheaper with sidechains included.
- **Solve/cost:** this is the only current mechanism with an exact complementary-arm ceiling, but no deployable predictor has been demonstrated. Wrong routing can lose solves.

### C-3. Ephemeral causal coprocessor with context reset

- **Class:** `NEW CLASS — compute topology / delegated diagnosis`.
- **Tier:** `GATED`.
- **Evidence:** native's `oceanparcels` Explore worker supplies the complete causal chain and exact edit before the main model acts; sweet reconstructs it through a large read in the expensive main context. Both solve.
- **Mechanism:** `ss-diagnose` launches a stateless cheap specialist with index, AST, and test access. It must return a causal chain, source anchors, live uncertainties, a falsifying command or minimal reproducer, and an edit constraint. A fresh apply/prove session receives only that object. All nested requests are priced. A shorter rendering without new reasoning invalidates the candidate.
- **Vehicle and differential:** sweet-only diagnosis service.
- **Observed fair-cost existence proof:** ocean native main `$0.004547` + approximately `$0.001071` sidechain = `$0.005618`, still `$0.001925` (`25.5%`) below sweet `$0.007543`, both solved. It is one rep, not a harness result.
- **Cheapest `$0` falsifier:** reprice all retained sidechains with the exact runner function, mark the earliest correct causal handoff, and simulate a context reset using recorded turns. On Codex/OpenCode, use earliest retained causal statements as optimistic handoffs. Require ≥15% net saving on exposed cells and zero causal errors on solved controls.
- **Portfolio cost requirement after C-2's recorded oracle:** save at least `$0.004535` Codex, `$0.002671` OpenCode with empty `mransan` excluded, and `$0.017572` Claude. Without C-2, require the full gaps in §4.2.
- **Solve/cost:** direct target is cached-context mass; solve upside is possible but unproven.

### C-4. Whole-file-on-first-touch for bounded small files

- **Class:** retrieval expansion / read granularity. It is conservatively counted inside the swept retrieval surface, not called a new class.
- **Tier:** `GATED — provisional`.
- **Evidence:** Codex `dash` reads the same 508-line file six times. Fable's census found collapsible repeat calls: Codex 34, OpenCode 26, Claude 34. Nibbles fetched 4,723 lines versus 5,529 for one whole file on Codex, but 4,481 versus 4,126 on Claude because spans overlap.
- **Mechanism:** on first agent-format read of a file ≤600 lines, return the whole file; subsequent reads return only unserved regions. Larger files retain span behavior. Threshold must be derived from token economics, not fixed by intuition.
- **Vehicle and differential:** sweet-only read semantics; native already approximates whole-file behavior.
- **Ceiling:** 34/26/34 fewer calls is an operation ceiling, **not** a dollar saving. Fable estimated 5–9% Codex and 3–5% elsewhere, but that estimate remains unproven because earlier extra content is carried through later turns.
- **Cheapest `$0` falsifier:** replay every nibble group at token level. Count later calls as removed only when their content was subsequently used and already present in the whole-file response. Include the cost of carrying extra lines through all later requests.
- **Solve/cost:** more context can distract; solve is not guaranteed non-decreasing. Kill if replayed billed cost does not fall ≥5% on Codex or if a blinded trace review predicts later targeted reads would still occur.

### C-5. Dependency-source index tier

- **Class:** retrieval expansion — corpus boundary. Conservatively counted in the existing class, even though the files do not exist in the working tree.
- **Tier:** `MOONSHOT`.
- **Evidence:** `pytask` is decided by the upstream callable contract. One native rep tried five legal verification routes; dependency source and network were both unavailable, then the rep flip-flopped for ten extra calls.
- **Mechanism:** during network-legal index construction, resolve declared dependency sources and issue-linked immutable references into a separate, size-bounded tier. At runtime provide `ss-search --deps` offline. Record provenance, dependency version/commit, and license metadata. Auto-trigger only for agent formats and explicit dependency/spec cues.
- **Vehicle and differential:** sweet-only indexed corpus. Native cannot read files absent from its filesystem under a network ban.
- **Ceiling:** clean current exposure is approximately +1 task on OpenCode and Claude (`pytask`), with a possible secondary Dart/RFC case. Cost upside from removing `pytask` thrash is small. This cannot alone deliver all-harness domination.
- **Cheapest `$0` falsifier:** audit all 17 issues and stored losing patches for a deciding ambiguity settled only by dependency source, cited specification, or linked implementation. Confirm that the exact referenced version can be acquired legally at index time. If no third case exists, cap current-bench expectations at one to two tasks.
- **Build truth conditions:** ecosystem resolvers, bounded storage, immutable provenance, license tracking, and evidence that product users need cross-dependency navigation. This is weeks rather than days and is justified primarily as a new product capability, not by this 17-task sample alone.

### C-6. Change-obligation compiler for absent code

- **Class:** `NEW CLASS — architectural obligation synthesis / authoring`.
- **Tier:** `GATED`.
- **Evidence:** both `bingo` arms name the desired APIs, edit only `handlebars.ts`, pass 421 visible tests, and miss three new modules plus cross-package export and overload behavior.
- **Mechanism:** `ss-plan-change` builds a typed obligation graph from package boundaries, export conventions, domain unions, overloads, and public projections. Nodes can require authoring a new module, exporting it, preserving an overload, adding a type predicate, updating a public enumeration, and proving wrong-kind rejection. It may materialize typed skeletons in an isolated overlay.
- **Vehicle and differential:** sweet-only planning/authoring service. A prompt saying “check exports” is not the mechanism.
- **Ceiling:** solving `bingo` is +1/17 on every harness. At unchanged cost that would produce the required recorded task lead on OpenCode and Claude. The task itself is only 4.7–6.0% of sweet spend, so this is a resolution lever, not the cost answer.
- **Cheapest `$0` falsifier:** hide gold, derive and lock the obligation graph from issue + base tree only, then reveal DEV gold roles. Require prediction of all three novel modules and both existing cross-package/overload obligations; documentation does not count. Repeat on other DEV feature-addition tasks with new files.
- **Solve/cost:** plausible one-task upside; planning overhead must be paid by C-2/C-3. Kill if it degenerates into sibling retrieval or predicts architecture only after gold is visible.

### C-7. Executable issue-contract compiler

- **Class:** `NEW CLASS — executable specification synthesis`.
- **Tier:** `MOONSHOT`.
- **Evidence:** `pytask` edits through an admitted callable-contract blind spot; `apple` covers one state but not send/receive × body/no-body symmetry; `dash` accepts a type while hiding it from the public list. YARP is excluded pending regrade.
- **Mechanism:** compile issue examples, public types, and state/loop structure into a temporary Contract DSL of inputs, observations, preserved invariants, and variation axes. Language adapters execute disposable probes in an overlay against base and candidate patches. Runtime sees no gold or hidden tests.
- **Example contracts:** callable receives current `exc_info`; accepted primitive types must appear in public enumeration; HTTP/2 send and receive behavior must be symmetric for end-stream true and false; Dart cookie splitting must preserve commas inside cookie attributes; after D-1, YARP duplicate-port and multi-subset cases must preserve one route per ingress while accumulating all destinations.
- **Vehicle and differential:** sweet-only executable-spec service. Shared tests-first guidance has zero differential and is rejected.
- **Ceiling:** clean traced non-YARP exposure is +2/17 Codex, +3/17 OpenCode, +2/17 Claude across `apple`, `dash`, and `pytask`; Dart adds at most one secondary task. This overlaps C-5 and C-8.
- **Cheapest `$0` falsifier:** hide DEV test patches and gold, derive and lock contracts, execute them against stored native/sweet/gold patches in disposable checkouts, then reveal retained labels. Require correct discrimination on at least three exposed tasks and no rejection of solved controls.
- **Solve/cost:** aimed at whole-task flips. It initially adds work and must pair with C-3 or replace wrong-edit loops to meet cost goals.
- **Build cost/truth conditions:** roughly two to three engineers for two quarters for the DSL, sandbox, and useful multi-language adapters. It works only when issue/base semantics are sufficient to derive discriminating properties.

### C-8. Counterfactual patch tournament with mutation referee

- **Class:** `NEW CLASS — bounded search over program states`.
- **Tier:** `MOONSHOT`.
- **Evidence:** `pytask` has multiple concrete callable hypotheses; `apple` has state-symmetry alternatives; `dash` has public-projection alternatives; both YARP arms independently chose the same loop lifetime, although its grade is unknown.
- **Mechanism:** create 2–4 ephemeral overlays whose generators must vary the disputed semantic dimension, not wording. A mutation referee runs C-7 contracts and generated boundary cases, minimizes the winner, and gives a fresh main session one proof-carrying patch. Failed branch transcripts never enter main context.
- **Vehicle and differential:** sweet-only tournament service.
- **Ceiling:** the existing-arm selector ceiling is C-2's bound; novel branches share C-7's task exposure. Do not add those ceilings. Multiple full-price Luna branches would make cost worse.
- **Cheapest `$0` falsifier:** use stored native, sweet, and gold DEV patches as a candidate pool, but hide labels while generating mutation dimensions and locking the referee. Require ≥80% correct selections on exposed cases, no rejected solved controls, and all-request projected cost within the portfolio budget.
- **Solve/cost:** could turn semantic coin flips into deterministic wins and isolate discarded work; could also multiply spend. Referee accuracy and cheap branch generation are hard vetoes.
- **Build cost/truth conditions:** four to six engineer-months for overlay isolation, mutation adapters, cheap synthesis workers, and proof capture.

### C-9. `ss-edit`: index-addressed structural editing

- **Class:** `NEW CLASS — edit addressing`.
- **Tier:** `MOONSHOT`.
- **Evidence:** 20 sweet Claude anchor failures plus stale-anchor and mistyped-path retries; Codex's fuzzy `apply_patch` has no analogous failure in the sampled cells.
- **Mechanism:** support symbol-addressed operations such as `replace-body`, `insert-after member`, or patching a tree-sitter node. The index resolves the address to current bytes and returns the actual unified diff. Native editor remains available.
- **Vehicle and differential:** sweet-only index-backed editor.
- **Ceiling:** overlaps C-1 completely for gutter errors, then adds stale-address/path failures. Fable estimated 8–12% Claude and 0–3% elsewhere; treat that as an upper bound pending offline addressability and turn-cost replay.
- **Cheapest `$0` falsifier:** resolve each of the 20 observed failed edits against the current index. Require ≥90% to be unambiguously addressable by symbol + operation and confirm that intended sub-symbol edits do not require brittle textual anchors.
- **Solve/cost:** removes editor failure modes and retries; no independent solve flip is claimed.
- **Build truth conditions:** tree-sitter coverage, collision rules, stale-index invalidation, dry runs, and atomic diff verification.

---

## 6. Reserve concept retained for later

### R-1. Turn-0 retrieval dossier

This preserves Fable's third moonshot but does not count it in the core class quota.

- **Concept:** before the first model turn, use issue text with the existing index to prepare a tool-result-shaped dossier of likely files/symbols and a repo map. Empty issues receive only the map.
- **Potential:** could eliminate query-issuing turns and move the agent directly to read/verify. Fable's ceiling was 8–14% of verbose-harness spend and ~5% Codex, but early turns are cheap and pushed context may be ignored.
- **Why reserve:** it is close to the swept retrieval/pushed-context surface; its current `$0` falsifier is weak; and it may duplicate C-2/C-4.
- **Gate before promotion:** rebuild DEV indexes without model calls, replay issue-text search, and require the eventual first-edit file in top five for a strong majority of solved rollouts. Price the injected dossier through every later turn. Reject if the same localization is already achieved in one model turn or if irrelevant context increases total billed mass.
- **Vehicle:** sweet-only precomputation. Operator must adjudicate whether precomputed context is task framing; if fairness requires the same facility for both arms, report only the differential created by each arm's own tools.

---

## 7. Dependencies and double-counting rules

| relationship | rule |
|---|---|
| D-1 vs every solve ceiling | regrade first; recompute all ceilings |
| D-2 vs C-3 | price every worker; never use omitted sidechain cost |
| C-1 vs C-9 | C-9 inherits C-1's anchor savings; do not add them |
| C-2 vs C-8 | existing-arm selection ceiling is shared |
| C-3 vs C-7/C-8 | C-3 is the proposed way to pay for semantic work, not an extra solve ceiling |
| C-5 vs C-7 | both may solve `pytask`; count the task once |
| C-6 vs other candidates | `bingo` authoring is a distinct resolution path |
| C-4 vs R-1 | both change early context/read turns; replay jointly before stacking |
| D-6 vs product levers | terminal test verdict improves honesty but has zero shared-FRAME differential |

No portfolio total may be published by summing candidate upper bounds. A stack needs a joint replay or observed run with overlap accounted explicitly.

---

## 8. Combined `$0` work plan

### Phase 0 — repair measurement before product work

1. Implement D-1's grader evidence tripwire and regrade the 12 retained YARP patches.
2. Implement D-2's inclusive sidechain pricing and reproduce current main-only rows.
3. Fix D-4's empty `pages` adapter behavior for both arms.
4. Publish OpenCode with and without the empty `mransan` task.
5. Rebuild the evidence digest, selector oracle, resolved-rep counts, and candidate ceilings.

**Phase-0 stop rule:** no product pilot if the corrected derivation cannot reproduce unaffected rows or if any task marked gradeable lacks test evidence.

### Phase 1 — deterministic gates, no model spend

Run in this order because earlier results can kill later work:

1. C-1 gutter/anchor replay and byte-match proof.
2. C-4 whole-file token replay, including future-turn carrying cost.
3. C-2 leave-one-task-and-repo-out routing simulation.
4. C-3 sidechain/context-reset simulation with exact pricing.
5. C-9 structural-address coverage over the 20 failed edits.
6. C-5 dependency/spec corpus audit across all 17 issues.
7. C-6 blinded `bingo` obligation-graph exercise.
8. C-7 locked-contract discrimination over stored patches.
9. C-8 blinded referee selection over the stored candidate pool.
10. R-1 issue-text dossier localization and token-carry replay.

**Phase-1 stop rule:** candidates that miss their own pre-registered gate move to the discard log; do not soften the bar after seeing results.

### Phase 2 — implementation order for survivors

1. Ship correctness-only fixes first: D-1 tripwire, D-2 pricing, D-4 adapter, D-6 terminal verdict.
2. Implement C-1 if replay proves the anchor mechanism; it is the smallest sweet product change.
3. Implement C-2 and/or C-3 only if retrospective rules generalize without task identity.
4. Implement C-4 only if token replay—not call counts—shows ≥5% Codex saving.
5. Choose one primary resolution program:
   - C-5 for reference-contract tasks;
   - C-6 for absent-code authoring; and/or
   - C-7 + C-8 as a unified executable-semantics program.
6. Build C-9 only if structural addressability covers ≥90% of observed failures and C-1 leaves material residual cost.
7. Promote R-1 only after it beats C-2/C-4 jointly in replay.

### Phase 3 — later paid DEV pilot, only after explicit GO

- DEV-RET rotated tasks only; HO2 frozen.
- Fixed seed, matched caps, identical FRAME, and all-request pricing.
- Report per harness: task solve, resolved reps, cost all-17, cost both-solved, and cost excluding malformed tasks.
- Pre-register no-regression controls and candidate-specific kill lines.
- Require sweet cost ≤85% of native **and** sweet task solve strictly greater on each harness.
- Treat single-rep task flips as unstable until replicated.
- Do not tune to a held-out failure.

### Phase 4 — credible generalization

The current 17 tasks are dominated by authoring, empty-specification, infrastructure, and semantic coin-flip failures. Before publishing domination, add a fresh, stratified task set whose problem statements and graders are validated in advance. Include tasks that genuinely exercise dependency contracts, absent-code authoring, state machines, and ordinary localization. Run power analysis to choose task and rep counts; do not assume one more rep set is sufficient.

---

## 9. Combined discard log

These ideas remain recorded so later sessions do not regenerate them under new names.

1. **Zero-edit floor / force exploration.** Empty `mransan` proves refusal can be correct; every native speculative patch is wrong and costs 6–8× more.
2. **Rollout-time WebFetch or dependency install.** Network and installs are banned; the observed exact WebFetch fails. Only C-5's index-time offline corpus survives.
3. **More sibling retrieval.** `pytask` already contains the sibling preview, Dart already finds the substantive file, and `bingo` needs files that do not exist.
4. **Stale-assertion override doctrine.** `dash` makes it tempting, but a benchmark-specific oracle rule is banned and the flip is one rep. C-7's product invariant is the valid descendant.
5. **Static first-file edit cap.** Dart's wrong design remains wrong in one file; scope control alone has no solve path and native adds more wrong files overall.
6. **Git-diff absorber / compact self-state.** Native and sweet git-self-state calls are arm-similar, the differential is zero, and the mechanism is banned compaction.
7. **Insertion-position oracle.** The deciding adjacency is already in context in failing `dash`; evidence presence does not force the correct choice.
8. **Mirror-switch echo.** Apple send/receive switches are adjacent and both arms still ignore the mirror. This is dead structural closure.
9. **Synchronous `run_tests` as a domination lever.** It is a real correctness fix (D-6), but shared machinery has zero head-to-head differential and does not supply missing behavior.
10. **Free Claude subagents.** Omitted cost is an accounting exploit. C-3 survives only with every request priced.
11. **Prompt-only routing, tests-first, completeness cards, and checkpoint doctrines.** They live in the swept prompt surface and may be shared FRAME text.
12. **Free-argument call packing.** Operation-count improvements are not cost/solve evidence, and dependent search→read arguments are unknown before search executes.

---

## 10. Self-audit

### Core candidate distribution

- Result rendering: C-1 only.
- Retrieval expansion: C-4 and C-5 only.
- `NEW CLASS — adaptive control`: C-2.
- `NEW CLASS — compute topology`: C-3.
- `NEW CLASS — authoring obligations`: C-6.
- `NEW CLASS — executable specification`: C-7.
- `NEW CLASS — bounded program-state search`: C-8.
- `NEW CLASS — edit addressing`: C-9.
- Reserve, not quota-counted: R-1 retrieval timing.

The core slate therefore has six candidates outside the seven swept §0.5 rows, no existing row has more than two, and four candidates are explicitly `MOONSHOT` (C-5, C-7, C-8, C-9).

### Forcing-function checks

- **Inversion first:** preserved in §1.
- **Trace log:** preserved in §2, with source counts kept separate rather than inflated.
- **Three trace-only candidates:** C-1, C-3, C-5, C-6, C-7, C-8, and C-9 all depend on rollout sequences or quotes unavailable from aggregates.
- **No same-information compaction:** none. C-3 performs new causal work; C-4 expands reads; C-7/C-8 execute semantics.
- **No grading exploit:** D-1 repairs the oracle; no candidate sees gold or hidden tests at runtime.
- **Solve veto:** cost claims include solve status; unstable reps and malformed tasks are disclosed.
- **Differential:** each core candidate states its sweet-only vehicle. Shared defects are not counted as product wins.
- **Ranking safety:** no candidate changes ranking without an `opts._isAgentFormat` gate.
- **Spend/data:** `$0`; no rollout; no remote mutation; HO2 untouched.

### Source-suggestion preservation map

- **Fable:** YARP grader → D-1/Phase 0; anchor gutter → D-3/C-1; whole-file first → C-4; structural editor → C-9; dependency corpus → C-5; turn-0 dossier → R-1; sidechain, `pages`, empty-issue, and undisplaced-Bash findings → D-2/D-4/D-5/D-6.
- **First slate:** selective superset → C-2; causal coprocessor → C-3; executable contract → C-7; obligation author → C-6; patch tournament → C-8; asynchronous-test observation → D-6.
- **Both sources:** inversions → §1; trace facts → §2; cost/solve gates → §4; overlap rules → §7; all proposed work → §8; every rejected idea and its killing fact → §9.

Every actionable suggestion from both source documents is therefore retained either as a defect, core candidate, reserve concept, evaluation requirement, or explicit discard with a resurrection condition.

## 11. Operational continuation contract

- **Canonical decision/action plan:** this file. Do not independently execute either source slate where this adjudication changes its confidence, ordering, or arithmetic.
- **Required provenance, not competing plans:** `SLATE-A.md`, `SLATE-A-FABLE.md`, `HANDOFF-CRUSH-NATIVE.md`, `EVIDENCE-DIGEST.md`, `evidence-pack.json`, and `RUN-LEDGER.md` in this directory, plus retained raw traces and grading artifacts. Keep them; this file summarizes conclusions but does not replace evidence.
- **Workspace:** `/Users/admin/Projects/sweet-search-private`. **Evidence host:** `ssh root@167.233.69.121`, read-only.
- **Run roots:** `/root/sweet-search-private/eval/task-completion-bench/results/{sb-codex-20260811,sb-opencode-20260811,sb-claudecode-20260811}`; expect 68 main rollouts per harness, 14 Claude sidechains, and 104 grading logs.
- **Transcript reader:** `/root/dump-trace.mjs` (local copy: `dump-trace.mjs` beside this plan). Run from `/root`, for example `node dump-trace.mjs <task> <native|sweet> --harness <codex|opencode|claude-code> --rep <0|1> --subagents`; default results are untruncated.
- **Primary retained inputs:** each run's `rows.json`, `preds-<arm>.jsonl`, `turns/`, `<arm>/logs/`, and `rt-dedup/`. Gold is `/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_luna_rotate20.json`; use it only in the retrospective DEV gates exactly as specified, never as a runtime input.
- **Current authority:** planning/audit only. Do not edit code or grader state, regrade, launch a rollout, spend money, mutate `results/`, or touch HO2 without a separate explicit GO.
- **First work after GO:** execute Phase 0 in order, preserve the old ledger, and stop unless unaffected rows reproduce and every `gradeable=true` row has framework test evidence. Then run Phase 1's `$0` gates in order; only survivors may enter Phase 2.
- **Global stop:** stop immediately if a proposed check needs a new model rollout, held-out inspection, benchmark identity at runtime, hidden-test leakage, or a softened post-result gate. Paid DEV work requires a second explicit GO after Phases 0–2.

Thus this is the single canonical plan, but it is deliberately not the sole artifact: the originals and raw evidence remain the audit trail needed to verify it.

## 12. Final decision

**Immediate GO:** scoreboard repair and deterministic `$0` gates only.<br>
**Immediate NO-GO:** paid rollouts, HO2 access, or a domination claim.<br>
**First product candidate:** C-1, if byte-replay confirms the anchor mechanism.<br>
**First cost architecture candidates:** C-2 and C-3, if retrospective gates generalize.<br>
**Resolution program:** C-5 for inaccessible contracts, C-6 for absent-code authoring, and C-7/C-8 for executable semantics; count overlaps once.<br>
**Publication bar:** observed sweet cost at least 15% below native and strictly more task solves on each of Codex, OpenCode, and Claude, with repaired graders and all requests priced.

The plan is intentionally broader than a single implementation proposal. Its next move is narrow: fix measurement, run the zero-cost falsifiers, and let most candidates die before any paid work.
