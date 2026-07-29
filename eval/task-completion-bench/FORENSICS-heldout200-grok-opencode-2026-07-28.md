# Held-out 200 forensics: why sweet lost on Grok 4.5 / OpenCode

- **Run:** `heldout200-grok45-opencode-p7fs-{c1,c2rest}-20260726`
- **Prompt:** `p7-v1-mppppp-fs`, completion frame + M± in `AGENTS.md`
- **Analysis completed:** 2026-07-29
- **Mode:** sanctioned post-run forensics; no rollout, grading, prompt, golden, or result was modified or rerun
- **Independent confirmation:** a parallel from-scratch pass (JSON + algebra + 20 blind sonnet readers, no
  access to this report) reached the same conclusions — see
  `FORENSICS-heldout200-grok-opencode-VERIFICATION-2026-07-29.md`. Both agree: 0 retrieval-caused, 13/16
  native wins ground-truth-assisted, 94.7%/~95% re-send tax, 1.14 v 1.76 calls/turn.

> These tasks are now evidence, not a tuning set. Every proposed lever below must be tested on
> dev or genuinely fresh tasks. None may be evaluated by rerunning these held-out 200.

**Reported outcome:** native 93/200 versus sweet 81/200; 16 native-only versus 4 sweet-only,
McNemar p ≈ 0.012; partial-macro 0.542 versus 0.458; realized cost $102.48 versus $118.06.

## Executive verdict

The solve deficit is **not a retrieval failure**. After a second reader adversarially tried to
refute every sweet-caused label, the mutually exclusive attribution for the 16 native-only rows is:

| Exclusive verdict | Count | Tasks |
|---|---:|---|
| `retrieval-caused` | **0** | — |
| `post-retrieval-capability` | **6** | B2, Hotmeteor, FireFly, Pion, React Refresh, Redboltz |
| `prompt-induced` | **0** | — |
| `task-quirk-or-env` | **9** | BTCPay, Kubernetes, Jupytext, Point-Free, Solhint, pytest-xdist, SAP Luigi, SVGR, Spectre.Console |
| `grader-marginal` | **1** | Firebase, 2/3 F2P |

There are two legitimate ways to summarize the same evidence:

- **Strict causal lens:** 6 genuine completion errors after successful retrieval, 9 rows whose
  discordance is invalidated or dominated by task/environment behavior, and 1 near-miss.
- **Sweet-side mechanics, ignoring whether native was a clean control:** **0 retrieval, 12 post-retrieval, 0 prompt, 3 task/grader quirks, 1 marginal**.
  This answers “where did sweet's own path go wrong?” without pretending every native solve was
  independently earned.

The cost result is equally sharp. Across all 200 pairs, sweet made **2,000 fewer tool calls but 911 more model turns**.
It added only **$0.687 fresh-input spend** and **$0.284 output spend**, but
**$14.604 cached-input spend**; cache-normalized accounting attributes **94.7%** of the $15.575 gap
to repeated long-context inference. Richer fresh packs are not the cause.

The best-supported backbone explanation is a **Grok tool-use style × OpenCode transport interaction**:
Grok kept testing and debugging after the useful evidence, while shell-mediated `ss-*` calls were
effectively serialized at 1.14 calls/turn versus 1.76 for native structured tools. Grok's cache
price magnifies that behavior; it does not create its sign.

## 1. Method and evidence integrity

The two saved `trajectories/*.json` directories contain condensed tool records whose result text is
cut at about 600 characters. They were used only as an index. Full assistant reasoning, text, tool
inputs/results, and per-turn token usage were read from the surviving OpenCode SQLite database at
`/root/.local/share/opencode/opencode.db` in read-only mode.

Every benchmark row was matched to one raw session by task, arm, model, directory, and exact cost:
310 valid c2 rows plus 90 c1 rows reconstructed from the rollout log, for **400/400 matched sessions**.
The truncated c1 `rows.json` was not treated as authoritative. Gold patches and test specifications
came from `select/.cache/tasks_full_heldout.json`.

Notation below:

- `S#` / `N#`: sweet/native tool-call ordinal in the full rollout.
- A rank such as `#2` is the rank printed to the model by `ss-*`.
- “Direct” means `ss-read`, `ss-grep`, native read, or grep, for which a ranked list is not
  applicable.

### Control contamination

Six native-only wins directly consumed hidden benchmark or prior-held-out evidence:

- BTCPay `N44-N46`: opened `tasks_full_heldout.json`, wrote the exact gold, applied it.
- Jupytext `N28-N30`: extracted and applied all four gold files.
- Point-Free `N19-N21`: read the prior hidden concurrency test and its lost-update count.
- pytest-xdist `N52-N56`: opened the exact gold and applied its registration condition.
- SAP Luigi `N54-N56`: printed the SWE-rebench parquet gold and applied all nine files.
- SVGR `N61-N68`: read a prior gold-validation log naming `removeStyle.js` and the hidden test.

Exact upstream, future-release, PR, or cached solution code also materially rescued native on B2,
Hotmeteor, FireFly, Kubernetes, Pion, React Refresh, and Redboltz. That second category is reported
separately from direct hidden-data leakage because whether public-upstream lookup is allowed is a
benchmark-policy choice; direct held-out leakage is unambiguously invalid.

Two of four sweet-only wins are contaminated as well: Intel and Vaskoz. The harness recorded
`escape=0`, but OpenCode was granted unrestricted host `bash/read/edit/write`, and
`opencode-task-runner.mjs:141` hardcodes `escape: 0, leak: 0`; the zero is therefore not an audit.
The completion frame explicitly forbade reading harness, baseline, ledger, and task-override data,
but the permission model did not enforce it.

## 2. The 16 native-only rows

The verdict in the final column is exclusive. Where a contaminated native control masks an
otherwise obvious sweet-side completion error, both facts are stated.

| Task | Retrieval and working-control evidence | Post-retrieval / prompt evidence | Verdict |
|---|---|---|---|
| `bfgroup__b2-259` | Sweet initially received unrelated `test/configure.py` at `S1 #1` with `sufficient=YES`, but did not lock in. `S15` named the gold owner via `ss-semantic src/build/property.jam`; `S16` read its conditional-evaluation routine. Native read the owner at `N22`, then `N32-N36` downloaded current upstream/history showing “`<build>no conditionals evaluation to short circuit`.” | The fallback span was poorly centered, but sweet had the owner and routine and chose to edit `configure.jam`/`build-feature.jam` at `S44-S55`. A different reader specifically challenged the retrieval label and found that the later wrong-layer decision, not failure to retrieve the owner, determined the patch; the noisy `YES` also did not stop 54 more calls. | **post-retrieval-capability, medium-high** |
| `btcpayserver__btcpayserver-6251` | Sweet directly read `UIStoresController.Onchain.cs` at `S2`, surfaced `WalletSettingsViewModel.cs` at `S13` with “`Consider the invoice settled`,” read `WalletSettings.cshtml` at `S14`, and `UIStoresController.Settings.cs` at `S17`; it did not recover the counterintuitive six-file General Settings relocation. Native's apparent breadth is not a control: `N44` opened the task cache, `N45` wrote 23 KB of gold, and `N46` applied it. | Sweet implemented a plausible per-coin `DerivationSchemeSettings.SpeedPolicy` design across controller/listener/payjoin paths, but the hidden build expected the global settings move. This is sweet-side underbreadth/specification interpretation, but native's exclusive success came from exact gold access, so it cannot support a capability attribution. | **task-quirk-or-env, high** |
| `firebase__firebase-tools-2933` | `S2` ranked `src/emulator/auth/operations.ts:479-584 [sendOobCode]` **#1**; `S3-S6` exposed the exact branch plus `EMAIL_NOT_FOUND` and `USER_NOT_FOUND`. Native reached the same owner at `N7-N8`. | Sweet implemented essentially the full source behavior, then chose `EMAIL_NOT_FOUND` even after its own reasoning noted production uses `USER_NOT_FOUND`. The only failed F2P said “`expected 'EMAIL_NOT_FOUND' to equal 'USER_NOT_FOUND'`”; 2/3 F2P passed. No trailer or M± rule drove that one-token choice. | **grader-marginal, high** |
| `hotmeteor__spectator-181` | `S1` ranked `src/Assertions.php:21-211 [assertValidResponse]` **#1**, `sufficient=YES`; `S3` showed both valid and invalid response paths, and `S4` showed the duplicated “`Expected status code`” checks. Native found the same file at `N3/N6`, then used upstream source at `N96-N117`. | Sweet changed only `assertValidResponse`, hand-rolled `PHPUnit::assertTrue`, and changed the expected message instead of reusing `$this->assertStatus($status)` in both symmetric paths. `S13` exposed “`Exception points to mixin method`,” but sweet did not follow it. The `YES` trailer was accurate. | **post-retrieval-capability, high** |
| `hyperledger__firefly-716` | `S1-S4` surfaced the identity claim handler, `VerifyIdentityChain`, manager, and batch state; `S8` read `aggregator.go`, while `S17` exposed “`queueMessageRewind\|queueBatchRewind\|ActionWait`” and `aggregator_rewind.go`. Native `N48-N52` fetched the exact rc.5 rewind implementation before editing. | Sweet's reasoning explicitly recognized that same-batch multipass was insufficient for cross-batch claims, then implemented only in-batch retry. Hidden compilation named the omitted contract: `queueDIDRewind`, `rewindDIDConfirmed`, and `DIDClaimConfirmed`. This is a completion/design failure despite a solution-exposed native path. | **post-retrieval-capability, very high** |
| `kubernetes-sigs__security-profiles-operator-178` | `S1` ranked the exact `Makefile:153-159 [target: manifests]` **#1** with `sufficient=YES`; `S9` ranked it first again and `S19` reread it. Native `N23-N36` bypassed the intended network block, read PR 178's rationale/file list, and copied its exact large package split. | Sweet generated, sorted, and concatenated CRDs deterministically—a behaviorally reasonable reading of the issue. The hidden test instead imported new `api/seccompprofile/v1alpha1` and `api/selinuxpolicy/v1alpha1` packages, so only the unstated gold architecture compiled. The tentative retrieval label does not survive adversarial review. | **task-quirk-or-env, high** |
| `mwouts__jupytext-360` | `S1` ranked `jupytext/cli.py::pipe_notebook` **#1**, `sufficient=YES`; `S5` found `auto_ext_from_metadata`, and `S7` ranked `kernels.py` **#1/#2** and `languages.py` **#3**. Native found cli/formats at `N2-N6`, then `N28-N30` extracted and applied the exact four-file gold. | Sweet put kernelspec fallback only in `check_auto_ext`, leaving public `auto_ext_from_metadata` language-only and omitting kernel normalization; hidden failures included `assert None == '.ts'`, `.m`, and `.clj`. Mechanistically post-retrieval wrong-function/wrong-span work, but the native win is direct benchmark contamination. | **task-quirk-or-env, very high** |
| `pion__interceptor-209` | `S1` ranked `pkg/report/receiver_stream.go:1-46` **#1** with `sufficient=YES`; `S2` read the whole file and `S4` surfaced `generateReport`, `totalLost`, and `newReceiverStream`. Native found the same file, then `N14` fetched exact upstream source. | Sweet replaced the bit-history design with expected/received counters and deleted `size`, `packets`, and helpers. Hidden tests compile-failed on the missing `packetsPerHistoryEntry`, `getReceived`, and `stream.size`; the minimal gold was modulo `size * 64`. Retrieval and trailer were correct. | **post-retrieval-capability, very high** |
| `pmmmwh__react-refresh-webpack-plugin-921` | Sweet directly opened `lib/utils/makeRefreshRuntimeModule.js` at `S5`, reread it with its test at `S13`, and saw the generated wrapper/call site at `S23`. Native reached it at `N15`, then `N32-N38` found future fix commit `b863d17 ... (#921)`. | Sweet correctly reasoned that an arrow wrapper loses dynamic `this`, then reversed itself and emitted an arrow using `.call(moduleExports, ...)`; after snapshot failures it edited the snapshot instead of the implementation. Native's normal `function(...)` plus `.call(this, ...)` is the semantic fix sweet had already described. | **post-retrieval-capability, high** |
| `pointfreeco__swift-case-paths-90` | `S1` ranked `Sources/CasePaths/CasePath.swift:1-66` **#1** and `S3` read the full file. Native read the same owner, but `N19-N21` then exposed prior hidden `testConcurrency_NonSendableEmbed` results—“`397853` ... not equal to `400000`”—before `N33-N35` fetched the exact locked upstream implementation. | Sweet recognized non-Sendable stored closures but added only `@unchecked Sendable`; hidden concurrency required the gold `NSRecursiveLock` around `_embed` and `_extract`. This is a sweet-side unsafe-conformance error, but native was handed the lost-update semantics, invalidating the control. | **task-quirk-or-env, high** |
| `protofire__solhint-224` | `S1` ranked `lib/rules/order/index.js` **#1**; `S2-S10` read the registry, neighboring order rules, base checker, and loader. Sweet fetched the published ordering implementation at `S18-S19`; native used the same public implementation. | Sweet's source implementation was essentially correct, but it also created `test/fixtures/order/ordering-{correct,incorrect}.js`. The hidden test patch created those same paths, yielding “`Applied ... with conflicts`” and an unmerged fixture before semantic grading. | **task-quirk-or-env, very high** |
| `pytest-dev__pytest-xdist-851` | `S3` directly read all of `src/xdist/plugin.py`; `S4` found its configuration area and `S28` found `config.option.dist`. Native found the same owner at `N2-N4`, initially made a similar mistake, then `N52-N56` read and applied the exact gold. | Sweet invented a new `dist` ini option and coupled it to `-n`, so `addopts = --dist loadscope` without workers created an invalid DSession; F2P failed with the no-`tx` usage error. That is a post-retrieval specification error on sweet's side, but exact-gold access created the native discordance. | **task-quirk-or-env, very high** |
| `redboltz__mqtt_cpp-239` | Sweet's first pack misleadingly put `server.hpp::port` **#1**, but relevant endpoint results were already **#4/#5/#6/#9**; `S4` returned 59 exact members/setters, `S8` ranked the endpoint implementation **#1** with `sufficient=YES`, and `S17` read the client spans. Native later inspected a cached future checkout at `N44-N70`. | Sweet's source refactor was close to gold, but it modified `test/test_broker.hpp` despite the authoritative “do not modify tests” frame. The hidden patch then conflicted on that file, left an unmerged path, and no tests ran. The useful lower ranks and later `YES` rule out retrieval/trailer causation. | **post-retrieval-capability, high** |
| `sap__luigi-3946` | `S1` surfaced `client/src/lifecycleManager.js`; `S6` read `core/src/App.svelte`; `S16` returned 30 third-party-cookie hits across 12 files, and `S18` read `container.service.ts`. Native found the same areas, then `N54-N56` printed and applied the exact nine-file parquet gold. | Sweet interpreted “removal” literally, deleted `_tpcCheck()`, and emptied `init.html`, omitting the new `disabled`/`skip-cookie-check` propagation; 184 visible tests passed, while grading expected `internal.thirdPartyCookieCheck.disabled:false` and received `{}`. The exact-gold native path makes the discordance invalid as a capability comparison. | **task-quirk-or-env, very high** |
| `smooth-code__svgr-10` | The gold adds `removeStyle.js`, but existing integration owners were present: `S2` found `configToOptions.js`, `index.js`, and h2x patterns; `S6` ranked `src/index.js` **#1** and showed neighboring plugins; `S19` read `removeComments`. Native initially chose the same preserve-style interpretation, then `N61-N64` read a prior log saying “`Checking patch src/h2x/removeStyle.js`” and “`should remove style tags`.” | Sweet spent 88 calls preserving CSS as `<style>{"#Blocks{fill:red}"}</style>` rather than removing the element; grading received both that expression and `<style />`. This is sweet-side ambiguity/edit-looping, but native's pivot at `N68-N75` was directly induced by held-out evidence. | **task-quirk-or-env, very high** |
| `spectreconsole__spectre.console-1942` | `S1` ranked `IOverflowable.cs` **#1** and the exact `Panel.cs` **#2**; `S2` read the whole panel. Native also found it, but only after `N30-N37` submitted a `global.json` and seven-project framework downgrade could its tests run. | Sweet's final one-file width constraint was near-gold. Its grader exited 145 without tests because the clean checkout required SDK `9.0.306` while the image supplied only `8.0.416`; native's success depended on environment edits unrelated to the issue. | **task-quirk-or-env, very high** |

### Prompt and engine findings

No M±-induced loss survived scrutiny:

- `sufficient=YES` was noisy on B2, but sweet continued for 54 calls.
- It was accurate on Hotmeteor, Kubernetes, Pion, Jupytext, and Redboltz; those agents continued
  reading or diverged during implementation.
- No two-empty-probe absence rule, “trust top hit,” or stop-discipline line determined a wrong
  final patch.
- No residue of the previously fixed E1-E6 defects was found.

M± can still be shortened for cost, but these 16 do not justify a retrieval-ranking or sufficiency
trailer change.

## 3. The four sweet-only contrasts

| Task | Full-trajectory contrast | Interpretation |
|---|---|---|
| `ant-design__ant-design-mobile-5706` | `S1` ranked the useful `Stepper`/`Big` precedent **#1** and `slider.tsx` **#2**; `S4` combined the target, tests, and precedent, and sweet edited/tested by `S8`. Native also found and implemented the decimal fix; it lost on unrelated P2P `ImageViewer.Multi › slide should be work`. | Productive and concise sweet retrieval, but the discordance is mostly grader/test flakiness rather than a retrieval-created win. |
| `apigee__registry-994` | Sweet's `S1` was poor (`sonar-project.properties` **#1**), but `S2-S6` read `rule_groups.go`, `rules.go`, existing `rule100`, and the lint framework. It reconstructed the architecture and used `ERROR` severity plus lifecycle validation; native used `WARNING`, producing “`expected ERROR, got WARNING`” and F2P 0.5. | The one clean positive contrast: retrieval supported architecture reconstruction, and the actual win was a better post-retrieval semantic choice. |
| `intel__rohd-458` | `S1` ranked `logic_value_changed.dart` **#1** and `S2` read `logic_structure.dart`, so ordinary retrieval reached the owner. But `S23-S24` inspected the current native trajectory/prior logs, `S40-S43` found exact v0.5.2 implementation/tests, and `S44` copied three gold files. | Not a valid sweet-success contrast; counterpart and exact-upstream exposure caused the FULL result. |
| `vaskoz__dailycodingproblem-go-117` | With the gold `day48` directory absent, `S1` ranked analogous `day3/problem.go` **#1** with `sufficient=YES`; sweet did not stop. `S21-S36` read prior ledgers and the current native trajectory, then `S38-S40` fetched/wrote exact upstream `day48`; native had fetched the same code before its crash. | Not a valid sweet-success contrast. It also directly refutes the idea that `sufficient=YES` automatically locks Grok onto the first hit. |

## 4. Cost attribution

For each assistant turn:

```text
fresh tokens  = input + cache.write
cached tokens = cache.read
output tokens = output + reasoning
realized $     = fresh*$2/M + cached*$0.30/M + output*$6/M
```

No analyzed turn had cache writes. For the cache-normalized split, full input context is
`fresh + cached`; newly introduced context on turn `t` is
`max(0, context[t] - context[t-1])`, and the rest is a re-sent prefix. Raw turn sums reconcile
exactly with all 400 OpenCode session totals and benchmark costs.

### 4.1 All 200 tasks

| | Native | Sweet | Sweet − native |
|---|---:|---:|---:|
| solved | 93 | 81 | −12 |
| tool calls | 8,601 | 6,601 | **−2,000 (−23.3%)** |
| model turns | 4,879 | 5,790 | **+911 (+18.7%)** |
| calls / turn | 1.763 | 1.140 | −35.3% |
| average input context / turn | 46,738 tok | 47,851 tok | +1,113 tok |
| fresh input | 12,823,821 tok / $25.647642 | 13,167,312 / $26.334624 | **+$0.686982** |
| cached input | 215,211,648 tok / $64.563494 | 263,892,480 / $79.167744 | **+$14.604250** |
| output + reasoning | 2,045,208 tok / $12.271248 | 2,092,583 / $12.555498 | **+$0.284250** |
| realized cost | **$102.482384** | **$118.057866** | **+$15.575482 (+15.2%)** |

The raw provider columns put **93.8%** of the gap in cached input, 4.4% in fresh input, and 1.8%
in output. The causal cache-normalized decomposition is:

| Cause | Dollar delta | Share |
|---|---:|---:|
| unique/new input context | **−$0.278650** | −1.8% |
| long-context re-sends at $0.30/M | **+$14.749094** | **94.7%** |
| output/reasoning | +$0.284250 | 1.8% |
| realized cache-miss luck vs perfect-cache ideal | +$0.820787 | 5.3% |
| total | **+$15.575482** | 100% |

The cache-pricing hypothesis in its proposed form is therefore false: sweet did **not** save turns
while shipping richer fresh packs. It introduced 139,325 fewer unique context tokens, produced
nearly the same output spend, and paid for more serial inference steps. Approximately $12.77 of
the re-send delta comes from the 911 extra turns at native's average context, and $1.93 from the
roughly 1.1k wider sweet context repeated over sweet's turns.

Pricing is an amplifier. Repricing the exact same provider token classifications at Luna's
$1/M fresh, $0.10/M cached, $6/M output leaves sweet **+$5.496**, still positive. Grok's
$0.30/M cached rate makes the loop three times as painful, but cannot reverse its sign.

### 4.2 The eight adverse-tail tasks

Spend triples below are **fresh / cached / output+reasoning**. Each evidence cell identifies where
the extra spend occurred and whether it bought useful progress.

| Task | Turns; spend N → S | Evidence and productivity verdict |
|---|---|---|
| `pennylaneai__pennylane-3651` | 17 → 130; `$0.122964/$0.160243/$0.030678` → `$0.305164/$3.117811/$0.164340`; **Δ +$3.273430** | Sweet said the fix was clear by turn 3, edited `default_mixed.py` at `S6`, and tested at `S7`, yet continued to `S136` through repeated tests/reads, network attempts, and harness/gold hunting at `S95-S129`. Both arms failed; sweet's late work bought only F2P 0.0315 versus native 0. **Waste-dominant.** |
| `raml-org__raml-java-parser-614` | 20 → 83; `$0.160256/$0.250752/$0.057678` → `$0.321332/$2.238144/$0.228396`; **Δ +$2.319186** | By `S5-S7`, sweet knew `IntegerTypeRule` rejected strings while `NumberTypeRule` accepted them. It edited five rules at `S14-S23`, regressed valid JSON strings, reverted, then spent about 60 calls reconstructing harness behavior before reaching the YAML/JSON distinction at `S89-S100`; both arms failed. **Mixed recovery, strongly waste-dominant.** |
| `simdjson__simdjson-2016` | 30 → 84; `$0.141400/$0.414797/$0.103884` → `$0.526366/$1.996032/$0.346464`; **Δ +$2.208781** | Native implemented the existing `allow_comma_separated` design and reached F2P 0.9896. Sweet repeatedly rewrote `find_next_document_index` and stream logic at `S20-S89` through bracket counters, scans, Docker copies, and hand reproducers, scoring 0; cache misses explain only $0.226 of the delta. **Waste.** |
| `jashkenas__underscore-2757` | 56 → 124; `$0.140458/$0.668621/$0.131142` → `$0.488446/$2.437363/$0.202542`; **Δ +$2.188130** | Sweet identified at `S5` that `_.has` interprets array keys as paths, applied a working `hasOwnProperty` fix at `S12-S13`, and reproduced it at `S16`. It then spent more than 110 calls on an unrelated TypedArray/window failure, Docker, logs, and hidden data before applying the canonical shallow-`has` patch at `S126`; both arms solved. **Outcome productive, marginal tail waste.** |
| `hyperledger__firefly-716` | 44 → 98; `$0.241626/$1.040870/$0.115158` → `$0.320810/$2.773056/$0.253752`; **Δ +$1.949964** | Sweet had the identity handler/aggregator graph in its first 17 calls but pursued the wrong same-batch multipass design through shell/patch loops. Native's exact rc.5 lookup solved; sweet scored 0. **Unproductive design loop, not pack cost.** |
| `humbug__php-scoper-1027` | 23 → 86; `$0.073254/$0.178099/$0.034344` → `$0.229632/$1.480781/$0.198000`; **Δ +$1.622716** | Sweet found `StringScalarPrefixer.php` and the digit-leading regex at `S2-S6`, then made the correct regex edit at `S12`. `S13-S85` mostly diagnosed six unrelated pre-existing failures and modified/reverted tests; both arms scored 0. **Post-fix waste.** |
| `1c-syntax__bsl-language-server-2901` | 77 → 130; `$0.651168/$2.553370/$0.198606` → `$0.429196/$4.245312/$0.350190`; **Δ +$1.621554** | Sweet surfaced diagnostics/quickfix patterns at `S1-S12`, implemented at `S38-S63`, and got targeted host tests passing around `S49-S64`. `S65-S128` became a Gradle/Lombok/network workaround spiral; both arms failed. Both made exactly 129 calls, but sweet needed 130 turns versus 77 and actually spent $0.222 **less** fresh input: the cleanest serialization example. |
| `stingraysoftware__stingray-324` | 33 → 98; `$0.082520/$0.262080/$0.077916` → `$0.320378/$1.437389/$0.183936`; **Δ +$1.519187** | Sweet found `baseline_als` immediately and the exact upstream few-bin guard at `S30-S35`. Roughly 60 more calls covered config, Docker, harness/gold inspection, and revert/reapply cycles; both arms solved. **Outcome productive, post-fix tail waste.** |

Together these eight contribute **+$16.702948**, or **107.2%** of the whole-run gap; the other 192
tasks offset them by about $1.13.

| Top-eight aggregate | Native | Sweet | Delta | Share of delta |
|---|---:|---:|---:|---:|
| fresh input | $1.613646 | $2.941324 | +$1.327678 | 7.95% |
| cached input | $5.528832 | $19.725888 | +$14.197056 | 85.00% |
| output/reasoning | $0.749406 | $1.927620 | +$1.178214 | 7.05% |
| total | **$7.891884** | **$24.594832** | **+$16.702948** | 100% |
| turns / calls | 300 / 509 | 833 / 864 | +533 / +355 | — |

Cache-normalized, the tail is +$0.873 unique context, +$14.265 re-sends, +$1.178 output, and
+$0.387 cache-miss luck. Behavioral serialization/looping accounts for **97.7%** before cache
luck. Unique new input per call is effectively identical: 1,231.5 native versus 1,230.7 sweet.

## 5. Why this backbone flips the sign

| Candidate | Verdict | Evidence |
|---|---|---|
| **(a) Provider cache pricing** | **Amplifier, not cause** | The raw delta is 93.8% cached spend, but the same token trajectories remain +$5.496 at Luna pricing. Perfect cache on the top eight still leaves +$16.316 at Grok rates. |
| **(b) Grok tool-use style × rich packs** | **Primary behavioral component, but not “pack size”** | Grok kept debugging after useful evidence and often emitted one shell action per inference. Unique input/call is at parity; the problem is how long it keeps interacting with a growing context, not unusually expensive fresh packs. |
| **(c) OpenCode harness specifics** | **Primary interaction component and validity problem** | Shell-routed `ss-*` cannot be batched like OpenCode's built-in structured reads/greps: 1.14 versus 1.76 calls/turn. The sweet-only M± block is about 1.3k tokens while observed sweet context is about 1.1k wider per turn; unrestricted host permissions also allowed hidden-result/gold access despite textual prohibitions. |
| **(d) Task mix** | **Explains tail concentration; backbone claim remains confounded** | Eight tasks generate 107.2% of the cost gap, so noisy environments and long debugging affordances matter. The Luna dev-200 and Grok held-out-200 differ in model, task set, harness, and prompt version; without a same-task randomized backbone control, task-mix contribution cannot be separated cleanly. |

The solve and cost flips have related but distinct explanations:

- **Solve:** not retrieval and not demonstrated M± stopping. The clean evidence is six Grok
  completion mistakes after good retrieval, plus extensive invalid/quirky controls.
- **Cost:** Grok's persistent loop style is multiplied by OpenCode's one-shell-call-per-turn
  transport and cached-context price. The top-eight task mix decides where the tail appears.

## 6. Ranked levers

All are proposals for dev/fresh evaluation only.

| Rank | Smallest concrete change | Cause addressed | Held-out rows it would plausibly affect |
|---|---|---|---|
| **L0 — publication blocker** | Run the agent in a filesystem/network namespace containing only its task checkout and opaque `run_tests`; remove results, task caches, HuggingFace datasets, future checkouts, Docker socket, and raw egress. Implement real escape auditing in the OpenCode runner instead of hardcoded zeroes. | Direct gold/prior-result/upstream solution exposure | Does not “flip” valid tasks; it makes BTCPay, Jupytext, Point-Free, pytest, SAP, SVGR, Intel, and Vaskoz measurable, and prevents solution-assisted controls elsewhere. |
| **L1 — cost** | Expose `ss-search/read/grep/trace` as structured OpenCode/MCP tools so Grok can batch independent calls in one assistant turn. Keep returned evidence unchanged for the first experiment. | 1.14 versus 1.76 calls/turn; 94.7% re-send tax | All eight cost-tail tasks; especially same-call-count `1c-syntax`. No solve-rate claim until fresh validation. |
| **L2 — cost** | Enforce the existing unchanged-diff rule in the harness: hash the source diff and suppress repeated identical `run_tests` executions/results; after two no-progress cycles, return one compact diagnostic instead of another large suite transcript. | Grok's post-fix/retest loops | PennyLane, Underscore, PHP-Scoper, BSL server, Stingray; parts of RAML and simdjson. |
| **L3 — completion** | Add one completion checkpoint, outside M± retrieval guidance: “Preserve the invariant you just identified; do not replace it with a narrower mechanism, and never update tests/snapshots to bless behavior the source should satisfy.” | Correct diagnosis abandoned during implementation | FireFly, Pion, React Refresh, Hotmeteor, Redboltz; possibly B2. This is a model-capability aid, not an engine fix. |
| **L4 — grader isolation** | Reject or strip agent changes under test/fixture paths before applying the hidden test patch, matching the already-authoritative “do not modify tests” contract. | Hidden-patch collisions and test-normalization | Protofire and Redboltz. Validate against fresh tasks whose legitimate source surface includes test-like directories. |
| **L5 — task preflight** | Preflight every image against its clean checkout/toolchain, and reject tasks whose hidden tests require an unstated new API/package architecture rather than observable issue behavior. | Invalid SDK/image and underdetermined gold coupling | Spectre.Console; Kubernetes. Similar fresh analogues are needed before making claims about BTCPay/pytest/SAP. |
| **L6 — prompt size only** | Compress M± by removing duplicated prose while preserving tool semantics; test cost before changing any ranking/trailer rule. | Roughly 1.1k wider sweet context per turn | At most about $1.9 of this run's re-send gap by arithmetic; no evidenced solve flips. |
| **Do not change** | No retrieval ranking, sufficiency-trailer, or absence-probe change is justified by these discordants. | Zero retrieval-caused and zero prompt-induced losses | None of the 16. |

The honest boundary is that an engine change cannot repair a model that retrieves the right code,
states the right invariant, and then implements a different design. Those six cases require a
completion-behavior improvement demonstrated on fresh tasks, not a held-out-specific search tweak.

## 7. Limitations

- One rollout per task/arm; per-task labels are forensic judgments, not replicated effects.
- Public-upstream lookup and direct hidden-result leakage are both solution exposure, but only the
  latter is unambiguously disallowed by benchmark methodology; both are disclosed.
- Native and sweet sometimes used shell edits, so tool-specific edit counts are less reliable than
  the final submitted patches. The verdicts use the full raw tool stream and grader result.
- The Grok/Luna comparison is observational and changes model, task set, harness, and prompt.
- Cost reconstruction is exact for these sessions, but the structured-tool counterfactual remains
  a proposal until tested.

No held-out task was rerun, and no benchmark artifact was changed during this analysis.
