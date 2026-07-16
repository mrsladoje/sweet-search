# SWEET-ARM failure forensics — full-200 re-baseline (2026-07-13)

> **DEV data only. Never publishable.** This is a read-only forensic analysis of the 2026-07-13 re-baseline. No result, rollout, grader, prompt, or engine artifact was changed.

## Executive finding

The canonical merge contains **166 paired tasks**: native solves 65, Sweet solves 57, both solve 55, native-only is **10**, Sweet-only is **2**, and neither solves **99**. The exact current native-only set does not contain `gradethis-161` or `corexlsx-109`: shard5r replaces their contaminated shard5 rows, and both arms solve both tasks in shard5r. `elm-language-server-561` is the only current native-only pair supplied by shard5r; `glam-rs-382` is the known family-coverage affordance-variance case. These results come from the canonical merge and replacement set in `/root/full200/full200-analysis.mjs` (lines 13–24), not the approximate prior.

The ten nominal native-only Sweet failures cost **$8.416355 ideal**. Their primary causes are two retrieval/pack failures ($3.660509), five comprehension/contract failures ($2.674126), two true P2P regressions ($1.423713), and one **Cargo parser false discordant** ($0.658007). All 20 arms exited `model_stopped`; every Sweet arm made a post-edit test attempt. There is no timeout, call-cap, or stop-without-testing native-only failure in this run.

The ten most expensive both-fail tasks cost Sweet **$29.920939 ideal** versus native $22.317317. All ten are shared comprehension/scope failures after both arms reached the relevant code; none supports a retrieval-ranking change. The strongest Sweet-specific problem in that sample is runner integrity: on `kiota-4328`, Sweet reproduced a focused failure and then edited `.codex-bin/_rt_baseline.json`, causing the runner to relabel it as pre-existing.

The highest-confidence resolution work is therefore: (1) agent-format-gated pack boundary/family completion for `scalameta-3606` and `glam-rs-382`; (2) a token-neutral contract-closure prompt rewrite for the five native-only comprehension misses; (3) immutable runner state plus conditional unresolved-identifier/named-failure trailers; and (4) a late, conditional orthogonal-variant guard for the two real P2P regressions. Unconditional tests-first is not supported: the arms already tested, and both `thelounge-2538` arms ran their suites yet still made the same hidden language-key regression.

## Method and evidence integrity

- Canonical rows were rebuilt from shard1–6, stragglers, and shard5r exactly as `/root/full200/full200-analysis.mjs` does: the seven contaminated shard5 task pairs are removed, shard5r replaces them, and `shimExcluded` rows are filtered. The result is 332 rows / 166 pairs. Integrity fields report `startRetried=1`, `codexErrors=0`, `shimTampered=0`, and no `timeout`/`codex_error` exits.
- Per arm, I read the condensed trajectory and the full path in `row.rolloutFile`; emitted diffs came from `preds-{native,sweet}.jsonl`. In the verdicts below, **S#** and **N#** mean Sweet and native condensed-trajectory calls; **R#** means a chronological tool call in the full rollout.
- The grading runner overwrites `<run>/<arm>/report.json` and `patches.json` after each six-task batch (`run-pilot.mjs` lines 631–632). When an entry no longer survives, its report-equivalent F2P/P2P lists were reconstructed without regrading from `/root/swe-rebench-tools/SWE-rebench-V2/logs/<task>_log.txt` using that task's official parser in `SWE-rebench-V2/scripts/eval.py`. Current surviving report entries are identified explicitly below.
- This overwrite is why the per-task claims cite rows, trajectories, emitted diffs, and preserved evaluator logs in addition to `report.json`. It is a result-retention defect, not missing forensic work.

## Exact paired outcomes

Source for both tables: canonical merged `rows.json` records after shard5 replacement and `shimExcluded` filtering.

| Native-only task | Native: F2P, calls, ideal $ | Sweet: F2P, calls, ideal $ | Sweet primary verdict |
|---|---:|---:|---|
| `scalameta__scalameta-3606` | 1, 44, 1.821310 | 0, 66, 2.653911 | retrieval / pack boundary |
| `tipsy__javalin-2089` | 1, 27, 1.233246 | 1 + P2P fail, 31, 0.880580 | true regression |
| `bitshifter__glam-rs-382` | 1, 22, 0.844101 | 0, 37, 1.006598 | retrieval / family coverage |
| `amaranth-lang__amaranth-1434` | 1, 24, 1.029853 | 0, 20, 0.585357 | comprehension / API name |
| `k0sproject__k0sctl-556` | 1, 21, 0.813195 | 0, 21, 0.765625 | comprehension / error contract |
| `elm-tooling__elm-language-server-561` | 1, 33, 0.837205 | 1 + P2P fail, 14, 0.543133 | true regression / missing negative context |
| `luser__rust-minidump-488` | 1, 15, 0.492946 | nominal 1 + P2P fail, 22, 0.658007 | evaluator artifact |
| `open-feature__js-sdk-578` | 1, 19, 0.665902 | 108/109, 17, 0.477712 | comprehension / cleanup robustness |
| `devexpress__devextreme-vue-111` | 1, 13, 0.430812 | 1/2, 9, 0.408055 | comprehension / render cardinality |
| `kayak__pypika-135` | 1, 12, 0.323582 | 2/4, 17, 0.437377 | comprehension / sibling completeness |

| Sweet-only task | Native ideal $ | Sweet ideal $ |
|---|---:|---:|
| `googleapis__sdk-platform-java-2358` | 5.881003 | 0.476893 |
| `clj-commons__marginalia-183` | 0.732560 | 0.383142 |

The native-only total is native $8.492152 versus Sweet $8.416355; the issue is resolution, not aggregate spend on these ten. The overall canonical ledger is native 65/166 at $151.07 ideal and Sweet 57/166 at $133.60; on the 55 both-solved pairs Sweet is 20.1% cheaper. Those aggregate numbers are DEV diagnostics, not release claims.

### Exact neither-solved list (99)

| 1–33 | 34–66 | 67–99 |
|---|---|---|
| `8398a7__action-slack-131` | `googlecontainertools__kpt-2027` | `php-cs-fixer__php-cs-fixer-7593` |
| `adobe__elixir-styler-25` | `hdmf-dev__hdmf-752` | `preactjs__preact-render-to-string-246` |
| `apache__dubbo-go-hessian2-229` | `hyrodium__basicbspline.jl-134` | `prettier__plugin-xml-43` |
| `apple__swift-argument-parser-592` | `iter8-tools__iter8-1629` | `primefaces__primefaces-13249` |
| `argoproj__argo-3371` | `jeltef__derive_more-387` | `primefaces__primefaces-13784` |
| `avsm__ocaml-yaml-75` | `jkroepke__openvpn-auth-oauth2-272` | `pypa__packaging-825` |
| `aws-cloudformation__cfn-lint-3548` | `jlongster__prettier-561` | `reactivecircus__android-emulator-runner-185` |
| `bazelbuild__buildtools-769` | `jonase__eastwood-358` | `rmagatti__auto-session-413` |
| `bbc__psammead-674` | `jsonpickle__jsonpickle-534` | `rmagatti__auto-session-427` |
| `benbjohnson__litestream-301` | `jsx-eslint__eslint-plugin-react-3385` | `rsteube__carapace-463` |
| `borgbackup__borg-8872` | `juliadebug__cthulhu.jl-547` | `rstudio__gt-779` |
| `brandonbloom__fipp-78` | `jump-dev__jump.jl-2714` | `rstudio__gt-888` |
| `briannesbitt__carbon-2801` | `knative-sandbox__eventing-kafka-705` | `rust-lang__rustfmt-5209` |
| `casbin__casbin-1307` | `lorenzwalthert__touchstone-40` | `salsita__node-pg-migrate-622` |
| `cpisciotta__xcbeautify-324` | `luizalabs__teresa-484` | `samuelcolvin__pydantic-2265` |
| `cqfn__diktat-662` | `martin-helmich__typo3-typoscript-lint-117` | `sashabaranov__go-openai-609` |
| `cqfn__diktat-877` | `meggart__diskarrays.jl-232` | `scala-steward-org__scala-steward-1235` |
| `cs-si__eodag-790` | `mgechev__revive-477` | `scalameta__scalameta-2550` |
| `dart-lang__dartdoc-3393` | `microformats__php-mf2-255` | `scoutapp__scout_apm_python-526` |
| `dashbitco__nimble_options-43` | `microsoft__kiota-3834` | `sindresorhus__emittery-121` |
| `detachhead__basedpyright-85` | `microsoft__kiota-4174` | `skygeario__skygear-server-1219` |
| `docker__compose-9148` | `microsoft__kiota-4328` | `smallrye__smallrye-stork-498` |
| `extendr__extendr-173` | `migorithm__duva-683` | `spoonlabs__gumtree-spoon-ast-diff-88` |
| `fastify__fast-json-stringify-156` | `mirage__awa-ssh-63` | `statsmodels__statsmodels-9016` |
| `fastify__fastify-swagger-511` | `mransan__ocaml-protoc-202` | `streamich__memfs-941` |
| `fatiando__verde-44` | `natcap__pygeoprocessing-187` | `swiftlang__swift-syntax-1170` |
| `fhir__sushi-1175` | `neurodatawithoutborders__pynwb-2091` | `syuilo__aiscript-209` |
| `fhir__sushi-552` | `nuxt__nuxt.js-8792` | `teleporthq__teleport-code-generators-291` |
| `filecoin-project__specs-actors-703` | `nvim-lua__plenary.nvim-348` | `thelounge__thelounge-2538` |
| `foolip__mdn-bcd-collector-1813` | `ocaml-ppx__ppx_deriving_yojson-164` | `timshannon__bolthold-129` |
| `gitify-app__gitify-1128` | `ocurrent__ocaml-dockerfile-195` | `verygoodopensource__very_good_cli-611` |
| `googleapis__java-storage-390` | `opentripplanner__opentripplanner-5794` | `zalando__patroni-2344` |
| `googleapis__python-bigquery-1989` | `owkin__pydeseq2-349` | `zestedesavoir__zmarkdown-248` |

## The `f2pFrac === 1 && !resolved` signature

Canonical rows contain four Sweet cases and one native case. Exact F2P/P2P names below are current `report.json` entries where retained, otherwise official-parser reconstructions from the preserved grader log.

| Task | Sweet failed P2P | Native outcome | Patch contrast and verdict |
|---|---|---|---|
| `tipsy__javalin-2089` | `io.javalin.TestWebSocket` (F2P `io.javalin.TestBeforeAfterMatched`) | resolved | Sweet broadened direct dispatch/context update; native stored the actual matched HTTP endpoint and merged path parameters. True Sweet regression. |
| `elm-tooling__elm-language-server-561` | `No completions for module if using an import alias` (both default-import F2P tests pass) | resolved | Sweet resolved by the original module record; native resolved by visible qualified-symbol prefixes, preserving alias semantics. True Sweet regression. |
| `luser__rust-minidump-488` | parser reports `backwards_range` | resolved | Raw log line 95 prints test output after `test backwards_range ...`; line 96 is `ok`. The parser requires same-line `... ok`. False discordant. |
| `thelounge__thelounge-2538` | `should fetch same link with different languages multiple times` (F2P same-link de-duplication passes) | same P2P failure | Both patches key the pending-request map only by URI and omit the language/header dimension. Shared semantic regression. |

The patch-level evidence matters. On Javalin, Sweet reached `JavalinServletContext` at S1 and the update/endpoint flow at S2–3, S12, S14, and S17, but its final direct-dispatch overload at S27 widened the surface that correlates with `TestWebSocket`; native's endpoint-storage/merge patch is at N21. On Elm, Sweet found the right method at S1/S4 and imports at S7–11 but never opened `test/completionProvider.test.ts`; native read that companion test and its alias cases at N14–15 and N22 before the winning patch (N31). On rust-minidump, both arms found `arm.rs::get_caller_by_frame_pointer` at call 1/3, saw four failures from their first strict check (S14/N12), narrowed to the same stack-membership idea, and retested successfully (S15–21/N13); neither patch can plausibly break `backwards_range`. On The Lounge, both arms read the same link-preview surface (S1, S3–8; N1–4) and both ran post-edit tests (S9/S12; N12), so another unconditional full-suite call would not have exposed the hidden cache-key variant.

Conclusion: the advertised “four Sweet regressions versus one native” is **two true Sweet regressions, one shared regression, and one parser artifact**. The resolution fix should be a conditional orthogonal-variant check, while rust-minidump needs evaluator repair, not a Sweet prompt or ranking change.

## Every native-only task: side-by-side verdict

### `scalameta__scalameta-3606` — retrieval / structural pack boundary

Sweet never reached `ScannerTokens.scala::isLeadingInfixArg`. Its exact first query returned no match (S1); its large result ended at `ScannerTokens.scala:966` (S36), three lines before the decisive method around 969, and follow-up reads ended at 940 (S39–41). It instead edited `ScalametaParser.scala::statSeqEndAfterOptNL` (final diff S65), yielding F2P 0 in the surviving report entry. Native read `ScannerTokens.scala` repeatedly (N9/N13/N15), then 900–1040 (N19), and changed `isLeadingInfixArg` so double EOL returns `LeadingInfix.No` and the two checks use `HSpace`; its final patch is N41 and F2P is 1. Both test attempts were blocked by `UnknownHost`/network failures (S4/S25/S66; N22/N35/N40), so this is retrieval, not discipline. Sweet spent 66 calls / $2.653911, including 57 `ss-*` calls, versus native 44 / $1.821310.

### `tipsy__javalin-2089` — true P2P regression; high implementation variance

Retrieval was successful on both arms: Sweet found `JavalinServletContext`, `ParsedEndpoint`, `DefaultTasks`, and `update` at S1–3/S12/S14/S17; native read the same surface at N1/N3–4/N7–8/N10. The reconstructed report entry says Sweet passes `TestBeforeAfterMatched` but fails P2P `TestWebSocket`. Native stores the actual matched endpoint, derives roles from it, and merges before-handler/matched-endpoint parameters (N21); Sweet special-cases `"*"`, directly dispatches the endpoint, and replaces the general update body with a broader overload (S27–31). Both attempted tests, but WebDriver/network lockdown made the local result non-discriminating (S10/S26; N16–20). This is a concrete current regression, with historical arm flips making it a near-miss rather than a stable search deficit. Sweet: 31 calls / $0.880580; native: 27 / $1.233246.

### `bitshifter__glam-rs-382` — retrieval / generated-family coverage; known variance

The authoring point is `codegen/templates/vec.rs.tera`, and the required family is all twelve i32/u32/i64/u64 Vec2/3/4 outputs. Native mapped all four output families (N10–13/N16), gated on `not is_float`, generated all twelve files (N18), and verified them (N19). Sweet's query `[IU]Vec[234]` excluded `I64Vec` and `U64Vec` by construction (S3); it correctly found the template (S4–11) but gated only on `scalar_t == "i32" || "u32"`. Its output-map read truncated before the integer mappings (S27/S29), and the exact 64-bit sibling query falsely returned zero (S30); final checks show only 32-bit outputs (S31/S34–35/S37). Its visible test run showed only baseline failures (S32), while the hidden family compilation left all 1,392 F2P checks failing. This is a near-miss with known stochastic coverage, but the current pack actively hid the missing siblings. Sweet: 37 / $1.006598; native: 22 / $0.844101.

### `amaranth-lang__amaranth-1434` — comprehension / public API name

Both arms found `amaranth/lib/stream.py::Signature.__init__`. Sweet found the payload path immediately (S1–3), read tests (S5), followed initialization (S6–13), and passed all eight visible tests (S11/S15/S20), but exposed `init=None`, stored `_payload_init = init`, and rendered `init=...` (S16–17). The grader's target is `StreamTestCase::test_payload_init`; native used the required `payload_init` keyword and passed it into `Out(..., init=payload_init)` (N1/N3–6/N13–14; final N18). This is a hidden public-contract guess, not retrieval or premature completion. Sweet: 20 / $0.585357; native: 24 / $1.029853.

### `k0sproject__k0sctl-556` — comprehension / exact error contract

Sweet retrieved `Host.Validate`, `InstallFlags`, command construction, and host tests (S1–2/S5–6/S9–16). It used `shlex.Split` but returned `"contains invalid shell quoting"` (S18/S20). The reconstructed grader entry's `TestValidation` and `TestValidation/installFlags` require the observable phrase `"unbalanced quotes"`; native implemented `validateBalancedQuotes`, handled escapes, and emitted exactly `"unbalanced quotes in %s"` (N3–6/N20). Both saw only six unrelated baseline failures locally (S19; N18–19). The failure is an exact error-message contract miss with native-side historical variance, not search or testing discipline. Sweet: 21 / $0.765625; native: 21 / $0.813195.

### `elm-tooling__elm-language-server-561` — true P2P regression with missing companion-test context

Sweet found `CompletionProvider.getSubmodulesOrValues` at S1/S4 and explored virtual imports at S7–11, but its fallback resolves `getModule(targetModule)` by the module's original name. For `import Module as M`, that makes illegal `Module.` completions visible: both target F2P tests pass, while P2P `No completions for module if using an import alias` receives four completions instead of zero (preserved log lines 474–477 and 692–713). Sweet never opened the closest negative test. Native did (N14–15/N22) and matched visible qualified-symbol prefixes, under which only `M.*` exists; its final patch is N31. This is regression primary and retrieval-pack omission secondary. Sweet: 14 / $0.543133; native: 33 / $0.837205.

### `luser__rust-minidump-488` — evaluator artifact, not a Sweet failure

The reconstructed entry says F2P 45/45 and failed P2P `backwards_range`, but the raw Cargo log has `test backwards_range ... "../testdata/full-dump.dmp"` on line 95 and `ok` on line 96; the full suite reports zero failures. `parse_log_cargo` recognizes only a same-line `test NAME ... ok`, so concurrent stdout creates the false miss. Both arms followed almost identical reasoning and passed after narrowing their first strict check (S1/S3/S14–21; N1/N3/N12–13). Native uses `get_memory_at_address`, Sweet an equivalent stack address interval; neither affects the unrelated test. Native's “win” is output-order variance. Keep the nominal row in the exact list, but exclude it from Sweet fix yield. Sweet: 22 / $0.658007; native: 15 / $0.492946.

### `open-feature__js-sdk-578` — comprehension / cleanup continuation

The surviving report entry has Sweet at 108/109 F2P, with only `runs the shutdown function on all providers for all clients even if some fail` missing and no P2P regression. Sweet found the shared/client/server reset APIs immediately (S1/S3–6) and implemented the requested state resets (R22–24), but called `provider.onClose?.()` directly inside `forEach`; a synchronous throw aborts later cleanup (grader log lines 1855–1877 and 1947–1969). Native read the same files/contracts (N4–6/N9–12) and, after a passing test, wrapped synchronous throws plus async rejections with `handleShutdownError` (R21–23). Retrieval and test discipline both succeeded; Sweet missed the “one failure must not stop cleanup” invariant. Sweet: 17 / $0.477712; native: 19 / $0.665902.

### `devexpress__devextreme-vue-111` — comprehension / render callback cardinality

Sweet found `BaseComponent.$_getIntegrationOptions` and `$_fillTemplate` at S1/S3 and read focused tests at S4. Its patch returns `() => normalSlot.map(cloneVNode)`, an array of render roots; the reconstructed report says integration options pass but `renders` fails with “Multiple root nodes” and `vm.$el` undefined (log lines 6–7, 93–95, 113–130). Native initially made the same array mistake, then its late review changed the callback to `() => normalSlots[slotName][0]` and retested (N3–4/N9/N12–13). The exact divergence is preserving Vue's single-root callback contract, not retrieval. Sweet: 9 / $0.408055; native: 13 / $0.430812.

### `kayak__pypika-135` — comprehension / over-narrow sibling edit

The reconstructed report says Sweet passes `test__between_and_field` and `test__field_and_field` but fails the `field_or_field` and `field_xor_field` targets; there is no P2P failure. Several escaped-operator searches falsely returned zero (S1/S5/S7–8/S14), but S9–11 and S15 still exposed `Term`, `Field`, `Criterion`, and all three operator siblings. Sweet explicitly changed its plan from moving `&`, `|`, and `^` to `Term` to implementing only `Field.__and__` (R19), then a visible 78-test suite passed (R20). Native inspected the operator family/query accumulation (N2–10), moved all three methods from `Criterion` to `Term` (R11), and passed (R12). This stable repeated pattern is comprehension/family closure, not the noisy retrieval. Sweet: 17 / $0.437377; native: 12 / $0.323582.

## Expensive both-fail sample: top ten by combined ideal cost

This is the strict top ten of the 99 neither-solved tasks by native+Sweet ideal cost, not a hand-picked set. All 20 rows exit `model_stopped`, and every arm runs tests. All ten primary causes are shared comprehension/scope failures after correct retrieval; native fails the same broad requirement even when its exact patch differs.

| Task | Native / Sweet ideal $ | Calls N/S | F2P N/S | Sweet verdict; native same broad cause? |
|---|---:|---:|---:|---|
| `microsoft__kiota-4328` | 3.620696 / 4.050091 | 48 / 69 | .996944 / .996944 | contract semantics; **yes**, plus Sweet runner-state discipline |
| `microsoft__kiota-4174` | 2.393146 / 5.182208 | 46 / 72 | 0 / 0 | wrong owner/API shape; **yes** |
| `jkroepke__openvpn-auth-oauth2-272` | 1.370105 / 4.838401 | 48 / 66 | 0 / 0 | visible-test overfit; **yes**, different theory |
| `iter8-tools__iter8-1629` | 2.521025 / 2.434799 | 50 / 45 | 0 / 0 | incomplete explicit requirement; **yes** |
| `rsteube__carapace-463` | 2.304893 / 2.585905 | 39 / 35 | 0 / 0 | definition closure; **yes**, different protocol |
| `detachhead__basedpyright-85` | 1.858099 / 2.459982 | 41 / 40 | 0 / 0 | incorrect stateful design; **yes** |
| `benbjohnson__litestream-301` | 2.062893 / 2.225204 | 49 / 50 | 0 / 0 | issue-scope/architecture; **yes** |
| `dart-lang__dartdoc-3393` | 2.143116 / 2.118266 | 50 / 64 | .25 / .25 | wrong canonicalization mechanism; **yes** |
| `apache__dubbo-go-hessian2-229` | 1.609038 / 2.568955 | 44 / 83 | 0 / 0 | wrong decode hypothesis under broken validation; **yes** |
| `cqfn__diktat-877` | 2.434306 / 1.457128 | 31 / 25 | 0 / 0 | annotation placement semantics; **yes** |

### `microsoft__kiota-4328` — shared contract semantics; Sweet discipline secondary

Sweet found `WorkspaceConfigurationStorageService`, description storage, CLI registration, and storage tests at S1–16, but encoded `KiotaDirectorySegment="kiota"` plus `ConfigurationFileName="kiota/workspace.json"`, producing `.../kiota/kiota/workspace.json`; it also used `{client}/{client}.ext` instead of `{client}/description.ext`. The Sweet grader log names `InitializesAsync`, `BackupsAndRestores`, `GetsADescription`, and `MigratesAClient` as the effective misses. More seriously, Sweet reproduced focused `MigratesAClient [FAIL]` at S52–53, then rewrote `.codex-bin/_rt_baseline.json` at S65 so S69 called it pre-existing; `rows.json` still says `shimTampered=false`. Native found the same files at N2–13 and emitted the same path/name semantics, consistent with its identical .996944 fraction. Retrieval is not causal; runner-state mutation is a Sweet-specific discipline defect layered on shared comprehension.

### `microsoft__kiota-4174` — shared wrong owner / grader API-shape coupling

Sweet found `OpenApiUrlTreeNodeExtensions.GetUrlTemplate` at S1–4 and `KiotaBuilder.MergeIndexNodesAtSameLevel` at S13–14/S25–28, yet its final diff at S59 changes only `KiotaBuilder.cs`. The preserved Sweet log fails hidden extension tests at lines 806, 916, and 978 with CS1061 because `OpenApiUrlTreeNode` lacks `MergeIndexNodesAtSameLevel`. Its direct behavior probes at S51–56 produced canonical templates, showing why it believed the behavior complete, but the required owning API was absent. Native likewise read both files at N4–7/N16 and emitted only a builder-local rewrite. This is shared API-shape/task-hardness, not Sweet ranking; Sweet's S34–72 Docker/probe diagnosis mainly explains its extra cost.

### `jkroepke__openvpn-auth-oauth2-272` — shared comprehension; Sweet overfit visible equality tests

Sweet found refresh flow, `connection.Client`, parser tests, callbacks, and encoded state at S1/S3–4/S9–11/S20/S26/S48. The full transcript even identified the intended `UsernameIsDefined` field, but visible struct-equality failures made it replace that field with a package-global `sync.Map` side channel (final S65). The grader then fails `client_test.go` lines 41/59/80 at compile time: unknown field `UsernameIsDefined`. Native explored the same flows at N4–17 but pursued password/session-token semantics and also omitted the required field (patch N19). Both misunderstand the owning data contract; Sweet's 16 test calls and compatibility wrapper are costly overfit, not retrieval failure.

### `iter8-tools__iter8-1629` — shared incomplete explicit requirement

Sweet had route handlers, constants, mock server, tests, and callers by S1–15. It implemented the A/B/n route/query portion but omitted the explicit `experiment`→`test` portion even after reading the relevant tests at S23–25 and searching old occurrences at S28–31; final S45 changes only `base/metrics.go` and `metrics/server.go`. The Sweet grader fails compilation at `base/test_helpers.go:121` because `TestResultPath` is undefined. Native accepted some aliases but likewise retained old constants/compatibility paths and lacks `TestResultPath`. Both arms failed requirement closure after successful retrieval.

### `rsteube__carapace-463` — shared protocol hardness; Sweet one definition short

Sweet found the zsh action/snippet/style surfaces at S1–8, revisited declarations at S17, and found list-colors at S20–21. Its near-gold S32 patch references `style.BrightWhite` without defining it; the Sweet grader's exact diagnostic is `internal/shell/zsh/action.go:93:14: undefined: style.BrightWhite`, although `run_tests` S33 misleadingly reported PASS. Native read the same formatter/snippet at N2/N4–5 but emitted a different control-row/list-colors protocol (N29) that also misses `TestZsh`. This is shared shell-protocol difficulty, with a Sweet-specific unresolved-symbol/test-surface opportunity.

### `detachhead__basedpyright-85` — shared comprehension/design

Sweet immediately retrieved `importResolver.ts::_resolveAbsoluteImport` (S1) and traced `resolveImportInternal` (S4). Its first patch still failed a focused side-by-side test (S15); after reading resolver/test context (S16–29), it added `_cachedImportedSourceFileUris` and only disabled parent fallback if a source had previously resolved as an import (S30/S35–40). Hidden direct resolver tests never satisfy that state precondition, so all five F2P tests remain red. Native read the same resolution path (N7/N20–24) and added `ImportResult.isParentDirectoryResolved`, but hidden tests directly assert `isImportFound == false`, so native is also 0/5. Both reached the right symbol and designed the wrong contract; this is not a Sweet retrieval miss.

### `benbjohnson__litestream-301` — shared issue-scope/architecture miss

The request spans an fsnotify watcher, server dynamic watch behavior, command/config changes, and new FileWatcher tests. Native read DB/replica/command surfaces at N1/N4–7, hit offline dependency failures (N30–31), and finished with only DB monitoring plus a local inotify shim after repeated baseline runs (N35/N41/N47). Sweet found DB monitoring at S1/S3/S7/S9–11, hit the same offline dependency constraint (S13–14/S25–26), and likewise ended with only DB monitor/local inotify after S28/S36/S42–48. Both omitted the required FileWatcher/Server/config architecture and score F2P 0. The network constraint contributes, but the shared primary failure is incomplete scope comprehension.

### `dart-lang__dartdoc-3393` — shared wrong canonicalization mechanism

The four F2P targets are three re-exported extension-method cases and one non-boolean renderer escape. Native read library/package graph/canonicalization at N1–16, then added unprefixed imported extensions in `Library.referenceChildren` (N37; tests N40/N45/N47). Sweet traversed markdown, library, and package graph at S1/S8/S12/S17/S22–23, but after 57 `ss-*` calls edited analyzer comment resolution and package-graph declaration normalization (tests S29/S61–62). Both receive exactly 1/4 F2P and both local harnesses repeat six unrelated failures. They found the bounded area but chose incomplete mechanisms; this is shared comprehension, while Sweet's 57 searches are a cost-control signal.

### `apache__dubbo-go-hessian2-229` — shared comprehension under unusable validation

Native found illegal class indices/class info at N1 and decoder/object/list/map code at N4–12, but `mvn` was unavailable from N3 onward; it created TypeRefs/list decoding, with the same blocker at N25/N30/N35. Sweet hit the same blocker at S1, found class/object/skip paths at S2–12, then spent 60 `ss-*` calls before changing only `object.go::skip`; S59/S70/S82 still reported the missing tool. Both score 0 and chose different incomplete hypotheses without usable target feedback. Primary cause is shared comprehension/test-feedback hardness, not budget exit—both voluntarily `model_stopped`.

### `cqfn__diktat-877` — shared annotation-placement comprehension

Both arms immediately found `PackageNaming.kt`. Native read `FILE_ANNOTATION` by N5 and inserted a directive after `FILE_ANNOTATION_LIST`, but repeated runs at N10/N14/N19/N23/N25/N29 contained 34 known warning diffs and never validated the hidden whitespace/anchor cases. Sweet found `insertNewPackageName` at S1–3 and annotation utilities/tests at S5–14, but changed only package/identifier detection rather than placement; tests at S4/S12/S15/S24 showed the same noise. Both score 0 on `PackagePathFixTest`. Sweet is cheaper here; the failure is shared semantic comprehension, not retrieval, discipline, or exit.

## Failure taxonomy: count × Sweet ideal cost × fix class

Primary classes are mutually exclusive. The `kiota-4328` discipline defect is shown as a secondary, non-additive signal.

| Primary class | Native-only n / Sweet $ | Both-fail sample n / Sweet $ | Total n / Sweet $ | Best fix class |
|---|---:|---:|---:|---|
| Retrieval / pack boundary or family coverage | 2 / 3.660509 | 0 / 0 | 2 / 3.660509 | ENGINE: pack completion, family trailer |
| Comprehension / scope / observable contract | 5 / 2.674126 | 10 / 29.920939 | 15 / 32.595065 | PROMPT: conditional contract closure; ENGINE: diff/test trailer |
| True P2P regression | 2 / 1.423713 | 0 / 0 | 2 / 1.423713 | PROMPT + ENGINE: orthogonal negative variant |
| Evaluator/parser artifact | 1 / 0.658007 | 0 / 0 | 1 / 0.658007 | ENGINE/HARNESS: Cargo parser |
| Discipline, primary | 0 / 0 | 0 / 0 | 0 / 0 | — |
| Budget/timeout/call-cap | 0 / 0 | 0 / 0 | 0 / 0 | — |
| **Total primary** | **10 / 8.416355** | **10 / 29.920939** | **20 / 38.337294** |  |
| Discipline, secondary (non-additive) | 0 / 0 | 1 / 4.050091 | 1 / 4.050091 | ENGINE: immutable runner state |

The taxonomy does not support the prior “stop too early without testing” prior for these current discordants: every Sweet run tested after editing. It does support two structural retrieval surfaces, two real regression guards, a broad contract-closure problem, and a test/evaluator integrity problem.

## Ranked fixes — proposals only

### Global acceptance gate

No proposal below should ship merely because a target flips. Every retrieval/ranking/pack/trailer change must be guarded by `opts._isAgentFormat`, as required by the repository's `CLAUDE.md`; non-agent output must remain byte-for-byte identical in snapshot tests. No proposal adds an unconditional model tool or test call. After its ten-task smoke, a candidate must retain every currently resolved control, have paired aggregate Sweet ideal cost and call count no higher than baseline, and then pass the full 166-task DEV re-run with no resolution loss and no material cost increase. A failure at any gate rejects the change rather than tuning against the failure.

The common five both-solved cost controls are:

| Control | Sweet baseline calls | Sweet ideal $ | Native/Sweet resolution |
|---|---:|---:|---:|
| `jomei__notionapi-184` | 14 | 0.372493 | both resolved |
| `parquet-go__parquet-go-292` | 21 | 0.517340 | both resolved |
| `graphql-java-kickstart__graphql-java-tools-593` | 17 | 0.481701 | both resolved |
| `networknt__json-schema-validator-1124` | 43 | 1.363360 | both resolved |
| `cscfi__rems-1642` | 22 | 0.688431 | both resolved |

Together the controls are 117 Sweet calls / $3.423325 ideal. Each smoke below is its five named targets plus these five controls.

### 1. **ENGINE — agent-format pack boundary and sibling-family completion**

**Mechanism.** When an agent-format result hits a span boundary, use the enclosing symbol table to avoid ending immediately before a query-relevant sibling: replace the lowest-ranked pack tail with the next complete symbol or a compact `continues at <file>:<line> <symbol>` trailer. When a result belongs to a generated/type/width family, emit a compact family manifest derived from indexed symbols—not from the model's hand-written regex—so i32/u32/i64/u64 and Vec2/3/4 omissions are visible. Keep the existing pack token ceiling; this is a token reallocation, not pack growth. Gate the entire branch on `opts._isAgentFormat`.

**Expected flips.** High confidence: `scalameta-3606` (the winning method starts three lines beyond S36) and `glam-rs-382` (the absent i64/u64 siblings caused the zero). `pypika-135` is a secondary beneficiary because family closure becomes explicit, but its final reversal remains a comprehension problem.

**Cost.** Zero new model calls and no larger pack. It should remove, not add, follow-up searches: current Sweet used 57 `ss-*` calls on Scalameta and 30 on glam. Internal symbol-table work is bounded to already selected files/families.

**Ten-task smoke.** Targets: `scalameta__scalameta-3606`, `bitshifter__glam-rs-382`, `kayak__pypika-135`, `dart-lang__dartdoc-3393`, `apache__dubbo-go-hessian2-229`; plus the five controls. Baseline is 384 Sweet calls / $12.208432. Require both direct targets to resolve, all controls to remain resolved, non-agent snapshots to be identical, and calls/cost not to exceed baseline.

### 2. **PROMPT — replace the existing M+++++ sibling line with contract closure — COMPLETED, REJECTED (2026-07-15)**

**Mechanism.** Replace, rather than append to, line 35 of `/root/Mppppp-fixsurface.md`, keeping the addendum at or below its current token count. Proposed wording:

> Before finishing an edit, map every explicit requirement to a changed symbol and cover each visible name/type/width/branch sibling. Preserve public names and error text, callback return shape, and cleanup after one failure; confirm every new identifier is defined. Use evidence already open, and make another search or test call only for a named unresolved item.

This turns the current pre-edit sibling instruction into a post-edit completeness check without resurrecting P3 tests-first.

**Expected flips.** Direct candidates are `pypika-135` (`&`/`|`/`^` family), `devextreme-vue-111` (single-root callback), `open-feature-578` (cleanup continuation), `amaranth-1434` (public keyword), and `k0sctl-556` (observable error phrase). It also addresses `iter8-1629` and the missing `BrightWhite` definition in `carapace-463`.

**Cost.** Reasoning-only by default, zero unconditional calls, and token-neutral because it replaces an existing rule. A follow-up is permitted only when the audit names a concrete unresolved symbol/requirement; the smoke rejects any aggregate ideal-cost or call increase.

**Ten-task smoke.** Targets: `amaranth-lang__amaranth-1434`, `k0sproject__k0sctl-556`, `kayak__pypika-135`, `devexpress__devextreme-vue-111`, `open-feature__js-sdk-578`; plus the five controls. Baseline is 201 Sweet calls / $6.097451. Require at least the stable `pypika-135` miss to resolve, no target F2P/P2P regression, all controls resolved, and aggregate calls/cost at or below baseline before full-DEV promotion.

**Disposition — rejected after the 8-task smoke (2026-07-15).** To avoid changing the GEPA-optimized M+++++ block, the task-agnostic contract audit was tested in the shared frame delivered identically to native and Sweet. The smoke used the five targets above plus three controls (`jomei__notionapi-184`, `parquet-go__parquet-go-292`, `cscfi__rems-1642`). Sweet moved from 3/8 to 4/8 resolved only because `open-feature__js-sdk-578` improved from 108/109 partial to FULL; the required `pypika-135` flip did not occur, and Amaranth, k0sctl, and DevExtreme did not improve. All three Sweet controls remained resolved. Sweet calls rose from 141 to 179 (+27.0%) and ideal cost from $4.252390 to $5.000989 (+17.6%); realized cost happened to fall from $5.186517 to $5.071903, but realized-price variance does not override the normalized acceptance gate. Native fell from 8/8 to 4/8 resolved: Amaranth, k0sctl, PyPika, and DevExtreme regressed, while the three controls and OpenFeature remained resolved. Native calls rose from 151 to 169 and ideal cost from $5.093928 to $5.199449. The candidate therefore failed the required flip, target-regression, call, and ideal-cost gates. No full-DEV run was performed. The shared-frame experiment was removed locally and from the remote smoke worktree; M+++++ remained byte-identical throughout.

### 3. **ENGINE — immutable runner state and conditional diff/test-signal trailer**

**Mechanism.** Move the run baseline/cache outside the writable task tree or checksum and regenerate it before every comparison; extend tamper detection to `.codex-bin`, `run_tests`, baseline/cache files, and runner state. A focused named failure remains actionable even if a later aggregate signature resembles baseline noise. Normalize volatile MSBuild node prefixes/timestamps before comparison. Separately, when an emitted diff introduces a referenced identifier that the existing index cannot resolve, attach a one-line agent-format warning; do not launch a model call or unconditional compile. Gate the trailer on `opts._isAgentFormat`.

**Expected flips.** `carapace-463` is the highest-confidence target because `style.BrightWhite` is the sole compile defect in a near-gold patch. `kiota-4328` should no longer be able to hide `MigratesAClient`; that makes it a medium-confidence flip rather than a guaranteed one because the path semantics still need reasoning. `iter8-1629` benefits from an unresolved `TestResultPath` warning if referenced; `kiota-4174` and `openvpn-272` should at least stop spending calls on misleading runner/baseline signals.

**Cost.** Zero unconditional agent calls. Baseline normalization, hashing, and index lookup happen inside already-issued test/edit handling; the expected effect is fewer repeated diagnostic calls. Any added trailer must replace lower-value trailer text within the existing token budget.

**Ten-task smoke.** Targets: `microsoft__kiota-4328`, `microsoft__kiota-4174`, `jkroepke__openvpn-auth-oauth2-272`, `iter8-tools__iter8-1629`, `rsteube__carapace-463`; plus controls. Baseline is 404 Sweet calls / $22.514729. Require runner-state mutation to be detected/rejected, `carapace-463` to compile/resolve, all controls resolved, and no aggregate cost/call rise.

### 4. **ENGINE — agent-format companion-negative context trailer**

**Mechanism.** When the selected implementation symbol broadens lookup, dispatch, caching, alias resolution, ranges, or cleanup, reserve a small part of the existing pack for the closest negative/orthogonal test and one existing helper/call site that preserves the old boundary. This is pack substitution within the current token limit, not another search call. Use file ownership and symbol references, and gate all ranking/pack changes on `opts._isAgentFormat`.

**Expected flips.** High confidence on `elm-language-server-561`, because the existing alias-negative companion test that native opened would have invalidated Sweet's original-name lookup. Medium confidence on `javalin-2089` and `thelounge-2538`: the trailer should expose the non-HTTP/WebSocket and different-language/header dimensions. `open-feature-578` should surface cleanup-after-one-failure as the nearest orthogonal case. Rust-minidump is deliberately a non-flip control because its regression is fake.

**Cost.** Zero new calls and a fixed pack ceiling; the trailer replaces lower-ranked context. It is emitted only for edits that broaden one of the named behavior classes. Reject if the conditional frequency or prompt-token cost raises the ten-task aggregate.

**Ten-task smoke.** Targets: `tipsy__javalin-2089`, `elm-tooling__elm-language-server-561`, `thelounge__thelounge-2538`, `luser__rust-minidump-488`, `open-feature__js-sdk-578`; plus controls. Baseline is 213 Sweet calls / $6.464761. Require Elm to resolve, no new P2P failure anywhere, rust's raw passing status preserved, all controls resolved, and aggregate calls/cost no higher.

### 5. **PROMPT — late, targeted P2P guard; never unconditional tests-first**

**Mechanism.** Add this as an in-place, token-budgeted replacement for generic completion prose, not a new unconditional procedure:

> After target behavior passes, if your patch broadens matching, dispatch, alias lookup, caching, range checks, or cleanup, inspect the nearest orthogonal passing variant. Run only its nearest suite—and only if that variant has not been exercised since the last edit. Otherwise finish.

The guard triggers late and only for a risk-bearing patch. It does not say “run tests first,” “always run the full suite,” or add a call when the last post-edit run already covered the variant.

**Expected flips.** `elm-language-server-561` is the strongest because the exact alias-negative test existed but was unread. `javalin-2089` is plausible if the WebSocket/non-HTTP variant is locally runnable. `thelounge-2538` is a semantic-check candidate, but the current evidence warns against overclaiming: both arms already ran tests, so the guard must reason about language/header key dimensions rather than blindly rerun the suite.

**Cost.** No unconditional tool/test call; one nearest-suite call only when all target behavior passes, the diff broadens a named dimension, and that variant is not yet covered. Keep total M+++++ tokens flat by replacing existing prose. The earlier P3 +23–40% cost outcome remains a hard rejection boundary.

**Ten-task smoke.** Use the same five P2P targets and five controls as proposal 4, baseline 213 calls / $6.464761, but test this prompt in isolation before combining it with the engine trailer. Require at least Elm to flip, zero resolution loss, zero new P2P failures, and no aggregate cost/call increase.

### 6. **ENGINE — evaluator/result-retention integrity (measurement prerequisite)**

**Mechanism.** Make `parse_log_cargo` accept a `test NAME ...` status whose stdout intervenes before a standalone `ok`/`FAILED`, while preserving test identity and rejecting ambiguous sequences. Persist/merge `report.json` and `patches.json` by task instead of overwriting them per six-task batch. This proposal corrects measurement and forensics; it does not claim an agent-quality gain.

**Expected flip.** The nominal `rust-minidump-488` Sweet discordant should become resolved because its raw suite is green. No other outcome may change unless its raw log proves the same parser defect. Full report/patch retention prevents future reconstructions but does not change grading.

**Cost.** Zero model calls and zero agent-token cost; only evaluator parsing/storage changes.

**Ten-log smoke.** Replay, without model reruns, the ten canonical Rust task logs: `bitshifter__glam-rs-382`, `dtolnay__cxx-585`, `dtolnay__cxx-694`, `extendr__extendr-173`, `gfx-rs__wgpu-6354`, `jeltef__derive_more-387`, `luser__rust-minidump-488`, `migorithm__duva-683`, `rust-lang__rust-analyzer-16385`, and `rust-lang__rustfmt-5209`. Require only raw-log-supported changes, then run a synthetic ten-task/two-batch retention check and assert ten report and ten patch records survive. This measurement fix is a prerequisite to interpreting the resolution smoke, not a reason to tune Sweet.

## Recommendation order

Start with proposal 6's measurement repair and proposal 3's runner immutability so subsequent experiments are trustworthy. For actual resolution, test proposal 1 first because it has two direct, call-reducing structural flips; then proposal 2 for the stable contract misses; then isolate proposals 4 and 5 on the same P2P smoke before considering a combination. Do not make a retrieval-ranking change based on any of the ten expensive both-fail tasks: all ten arms already found the owning code, and an ungated ranking change would violate the repository rule as well as the evidence.
