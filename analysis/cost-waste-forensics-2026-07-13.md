# SWEET-ARM cost-waste forensics — full-200 re-baseline (2026-07-13)

> **DEV DATA ONLY — NEVER PUBLISHABLE.** This report inspects per-task DEV trajectories and rollouts. All costs are cache-normalized `idealCostUsd`; `costRealizedUsd` is never used.

## Executive finding

The merge is clean at 332 rows: 166 tasks × two arms. Sweet remains cheaper in aggregate ($133.596324 vs $151.065748, -11.56%) and much cheaper on the 55 both-solved pairs ($32.092381 vs $40.180308, -20.13%), but it resolves fewer tasks (57 vs 65). Consequently, ideal dollars per solve are effectively a wash: $2.3438 sweet vs $2.3241 native (+0.85%).

The remaining sweet-specific waste is not primarily duplicate searching. Across all 166 sweet rollouts there was only one exact repeated search, worth $0.014843. The material pools are:

- non-canonical/manual test reconstruction: $2.542345 sweet vs $0.480254 native;
- reads that repeat code already present in a recent result pack: $0.746605 for 34 fully contained reads, or $1.397024 including duplicate portions of partial reads;
- verbose machine route trailers: an estimated $0.514510 after downstream context re-sends;
- a small number of extreme result packs/traces that amplify every later turn; a blanket 6,000-character cap models $3.688461, but is **not admissible** because it would trim initial evidence and could reduce resolution;
- validation/harness and post-validation wandering, although those also occur in native and therefore are not exclusively a sweet-arm regression.

The safe stack is therefore behavioral and information-preserving: make `run_tests` a hard authority boundary, enable the existing anti-thrash appendix, tell the agent exactly which spans a pack already showed, and replace the verbose agent-facing route JSON with a compact actionable trailer. No ranking change is warranted.

## Dataset integrity and accounting

The merge reused the top-of-file logic in `/root/full200/full200-analysis.mjs`:

| source run | raw rows | rows retained |
|---|---:|---:|
| shard1 | 52 | 52 |
| shard2 | 48 | 48 |
| shard3 | 46 | 46 |
| shard4 | 56 | 56 |
| stragglers | 18 | 18 |
| shard5 | 56 | 42 after removing the seven contaminated pairs |
| shard5r | 14 | 14 replacement rows |
| shard6 | 56 | 56 |
| **merged** | **346** | **332** |

Every source had zero `shimExcluded` rows. The merged set has 166 native and 166 sweet rows, one of each arm per task, no duplicates, and all seven replacement tasks sourced only from shard5r.

Outcome partition:

| partition | pairs | native ideal$ | sweet ideal$ | sweet delta |
|---|---:|---:|---:|---:|
| both solved | 55 | 40.180308 | 32.092381 | -8.087927 |
| native only | 10 | — | — | resolution-discordant |
| sweet only | 2 | — | — | resolution-discordant |
| both failed | 99 | 95.779725 | 92.227553 | -3.552172 |
| all rows | 166 | 151.065748 | 133.596324 | -17.469424 |

The adverse tails are still large: all 15 both-solved sweet-costlier pairs sum to +$2.312026; 42 both-failed sweet-costlier pairs sum to +$15.367895.

### Turn apportionment

Each rollout's `token_count.last_token_usage` was replayed with the harness's exact formula:

```text
newIn_t = max(0, input_t - input_(t-1))
resent_t = input_t - newIn_t
C_t = (5*newIn_t + 0.5*resent_t + 30*output_t) / 1,000,000
```

The reconstructed totals equal every row's `idealCostUsd` and the merged arm totals to six decimals. Direct call-category cost is apportioned as `C_t × classified calls / all tool calls in turn`; asynchronous poll turns are included. Output-amplification estimates use four characters per token and replay later input context, resetting removed payload only at an observed context compaction.

`stepsToFirstEdit` is not reliable for these runs when Codex edits through `apply_patch`: the row falls back to `calls`. First-edit analysis therefore uses the first rollout `custom_tool_call` named `apply_patch`, measured in model turns.

## Required offender rankings

### Both solved, sweet costs more — all 15

| # | task | run | Δ ideal$ | Δ calls | native $ / calls | sweet $ / calls |
|---:|---|---|---:|---:|---:|---:|
| 1 | `networknt__json-schema-validator-1124` | shard4 | +0.475067 | +20 | 0.888293 / 23 | 1.363360 / 43 |
| 2 | `arkivanov__decompose-916` | shard5 | +0.282325 | +4 | 0.724619 / 20 | 1.006944 / 24 |
| 3 | `analysis-dev__diktat-1206` | shard4 | +0.259919 | +7 | 0.761211 / 17 | 1.021130 / 24 |
| 4 | `astropenguin__xarray-dataclasses-51` | shard4 | +0.238592 | +5 | 0.674987 / 23 | 0.913579 / 28 |
| 5 | `elixir-ecto__ecto-2438` | shard1 | +0.205855 | +12 | 0.459791 / 12 | 0.665646 / 24 |
| 6 | `gfx-rs__wgpu-6354` | shard4 | +0.151495 | -8 | 1.141154 / 30 | 1.292649 / 22 |
| 7 | `damienharper__auditor-133` | shard4 | +0.150226 | +7 | 0.403148 / 14 | 0.553374 / 21 |
| 8 | `elixir-plug__plug-1154` | shard2 | +0.144905 | +4 | 0.518216 / 19 | 0.663121 / 23 |
| 9 | `devexpress__devextreme-vue-201` | shard4 | +0.130411 | +4 | 0.190242 / 10 | 0.320653 / 14 |
| 10 | `projectevergreen__wcc-50` | shard4 | +0.085770 | 0 | 0.274951 / 10 | 0.360721 / 10 |
| 11 | `samtools__htslib-1800` | shard1 | +0.079746 | +1 | 0.267195 / 9 | 0.346941 / 10 |
| 12 | `jomei__notionapi-184` | shard4 | +0.038000 | -3 | 0.334493 / 17 | 0.372493 / 14 |
| 13 | `juliadiff__finitedifferences.jl-223` | shard6 | +0.025635 | -2 | 0.257963 / 8 | 0.283598 / 6 |
| 14 | `graphql-java-kickstart__graphql-java-tools-593` | shard3 | +0.024156 | +6 | 0.457545 / 11 | 0.481701 / 17 |
| 15 | `openmined__pysyft-250` | shard2 | +0.019924 | -6 | 0.322711 / 18 | 0.342635 / 12 |

### Both failed, sweet burns more — top 15 of 42

| # | task | run | Δ ideal$ | Δ calls | native $ / calls | sweet $ / calls |
|---:|---|---|---:|---:|---:|---:|
| 1 | `jkroepke__openvpn-auth-oauth2-272` | shard3 | +3.468296 | +18 | 1.370105 / 48 | 4.838401 / 66 |
| 2 | `microsoft__kiota-4174` | shard5 | +2.789062 | +26 | 2.393146 / 46 | 5.182208 / 72 |
| 3 | `rust-lang__rustfmt-5209` | shard3 | +1.223099 | +26 | 0.578080 / 16 | 1.801179 / 42 |
| 4 | `microsoft__kiota-3834` | shard4 | +1.006045 | +26 | 0.823804 / 22 | 1.829849 / 48 |
| 5 | `apache__dubbo-go-hessian2-229` | shard5 | +0.959917 | +39 | 1.609038 / 44 | 2.568955 / 83 |
| 6 | `smallrye__smallrye-stork-498` | shard4 | +0.779690 | +16 | 1.008254 / 25 | 1.787944 / 41 |
| 7 | `detachhead__basedpyright-85` | stragglers | +0.601883 | -1 | 1.858099 / 41 | 2.459982 / 40 |
| 8 | `fhir__sushi-552` | shard1 | +0.435125 | +8 | 0.771449 / 27 | 1.206574 / 35 |
| 9 | `microsoft__kiota-4328` | shard6 | +0.429395 | +21 | 3.620696 / 48 | 4.050091 / 69 |
| 10 | `cqfn__diktat-662` | shard6 | +0.349092 | +3 | 1.096837 / 24 | 1.445929 / 27 |
| 11 | `scala-steward-org__scala-steward-1235` | shard4 | +0.290258 | +10 | 0.798559 / 21 | 1.088817 / 31 |
| 12 | `scoutapp__scout_apm_python-526` | shard1 | +0.289762 | +13 | 0.283764 / 10 | 0.573526 / 23 |
| 13 | `rsteube__carapace-463` | shard4 | +0.281012 | -4 | 2.304893 / 39 | 2.585905 / 35 |
| 14 | `docker__compose-9148` | shard4 | +0.277585 | +17 | 1.661768 / 39 | 1.939353 / 56 |
| 15 | `argoproj__argo-3371` | shard6 | +0.269039 | +22 | 1.802527 / 39 | 2.071566 / 61 |

## Ten paired trajectory audits

The top five from each requested cohort were read side by side. Full rollouts were used for complete tool outputs, patch turns, asynchronous polls, test-result equivalence, and per-turn cost.

| task | cohort | model turns N/S | first patch N/S | principal verified waste | conservative dollar evidence |
|---|---|---:|---:|---|---:|
| `networknt__json-schema-validator-1124` | both solved | 11 / 33 | 7 / 20 | 19 sweet pre-edit turns; later reads of `run_tests` internals; four test invocations, but edits occurred between them | +$0.152869 adverse pre-edit delta; $0.068648 harness calls; $0.004664 route metadata |
| `arkivanov__decompose-916` | both solved | 16 / 24 | 6 / 11 | a sufficient `ss-find` already showed `ChildrenFactory.kt:18-61,110-155`; the next read overlapped 56.8% | +$0.133030 adverse pre-edit delta; $0.011073 duplicate-span turn cost |
| `analysis-dev__diktat-1206` | both solved | 11 / 26 | 6 / 18 | two sufficient utility lookups; subsequent reads repeated parts of those packs; later search addressed a genuinely new subproblem | +$0.159835 adverse pre-edit delta; $0.022354 duplicate-span cost |
| `astropenguin__xarray-dataclasses-51` | both solved | 17 / 22 | 7 / 5 | sweet edits earlier; every repeated test followed an edit, so no test spin; excess is post-edit implementation/refinement | $0.007897 span overlap; $0.005194 route metadata; no safe turn deletion identified |
| `elixir-ecto__ecto-2438` | both solved | 9 / 16 | 6 / 11 | broader pre-edit exploration and partial pack re-reads; the post-sufficiency probes investigated join semantics, not a duplicate target | +$0.155279 adverse pre-edit delta; $0.033625 duplicate-span cost |
| `jkroepke__openvpn-auth-oauth2-272` | both failed | 28 / 71 | 6 / 14 | 16 test invocations; `ss-search` for the test harness returned 17,037 characters; after the last edit, manual/targeted tests and status loops made no further source change | +$0.221850 adverse pre-edit delta; $0.127993 harness + $0.061540 manual-test calls; $0.024692 route metadata |
| `microsoft__kiota-4174` | both failed | 40 / 81 | 8 / 16 | 30,553-character `ss-trace impact`; repeated same-revision canonical test; long Docker/harness reconstruction after authoritative failures; fully redundant test-file read | $1.392151 manual tests + $0.431453 harness + $0.127545 repeated test + $0.134862 duplicate-span cost |
| `rust-lang__rustfmt-5209` | both failed | 12 / 44 | 7 / 4 | final source edit at turn 34, then canonical test/diff, followed by benchmark-harness inspection, baseline mutation, and another unchanged run | $0.319341 harness calls; the final no-edit harness tail is a subset, not additive |
| `microsoft__kiota-3834` | both failed | 17 / 45 | 8 / 7 | repeated same-revision failure; snapshots, baseline deletion, direct Docker execution, and shim reading before returning to source | $0.290240 manual tests + $0.197946 harness + $0.065000 repeated test |
| `apache__dubbo-go-hessian2-229` | both failed | 28 / 35 | 12 / 23 | 60 sweet-search calls before a very late patch; repeated same-revision canonical test and some harness/manual test work | +$0.915688 adverse pre-edit delta; $0.046838 repeated test; $0.068169 harness; $0.050358 span overlap |

Important negative findings:

- No audited offender repeated an exact sweet-search command.
- No audited offender made a clearly matching re-search after `sufficient=YES`; apparent cases were a permitted read or a new subproblem. Stronger global sufficiency stopping is not supported.
- Repeated test text alone is not enough to call a spin. In `astropenguin`, for example, all test outputs matched, but each validation followed a source edit and was retained.

## Taxonomy ranked by measured dollar pool

These rows are deliberately non-additive: a post-validation turn can also be a harness or manual-test turn, while output bloat amplifies later categories.

| rank | category | sweet measurement | native comparator | finding |
|---:|---|---:|---:|---|
| 1 | harness inspection/mutation | $2.593294, 68 calls | $3.499351, 83 calls | Pure task-irrelevant waste, but not a sweet-vs-native gap by itself. L2's authority banner did not prevent it. |
| 2 | manual test reconstruction | $2.542345, 42 calls | $0.480254, 11 calls | The clearest sweet-specific gap: +$2.062091. Docker/direct runner loops dominate Kiota. |
| 3 | recent pack span re-read | $1.397024 partial-line direct cost; $0.746605 for 34 fully contained reads | not applicable | Confirmed. Within three turns and the same source revision, 213 reads repeated some shown lines; 34 asked only for already-shown lines. |
| 4 | post-validation wandering | $1.258626, 44 calls | $2.017130, 75 calls | After final-revision `run_tests` reported no new failure, calls continued despite no later edit; $0.597835 is on resolved sweet runs. |
| 5 | unchanged same-revision canonical test | $0.664897, 9 repeats | $1.097929, 12 repeats | Purely removable but not sweet-specific overall. Top sweet cases: `kiota-4328`, `iter8`, `kiota-4174`. |
| 6 | verbose route metadata amplification | $0.514510 estimated from 158,104 trailer characters | not applicable | Machine JSON is repeatedly re-sent even though the actionable confidence/sufficiency line is already present. |
| 7 | exact repeated search | $0.014843, one call | $0 | Negligible. Seven other lexical near-matches were mainly legitimate `--in` narrowing or changed targets. |
| 8 | matching search after `sufficient=YES` | $0 confirmed in the ten audits | — | Expected taxonomy item was not verified; do not tighten this globally. |

Two large diagnostics are not safe savings pools:

- **Giant result packs:** losslessly replaying a hypothetical 6,000-character cap on search/find/trace packs estimates $3.688461. The largest were `kiota-4174` trace (30,553 chars), `auditor-133` trace (28,761), and `parcels-617` trace (27,380). A blanket cap would remove initial evidence and is rejected.
- **Late first edit:** sweet's first patch occurs later in turn count on average (9.34 vs 6.93), with $7.564062 of positive-side pre-edit exposure across 73 pairs. But sweet pre-edit cost is lower in net aggregate ($51.378479 vs $55.319840, -$3.941360). Earlier-edit pressure would trim initial retrieval and is rejected under the resolution constraint.

## Zero-resolution-risk proposals

### 1. PROMPT — authoritative validation boundary

Add a short section to M+++++:

```text
VALIDATION IS AUTHORITATIVE:
- Use run_tests for validation. Never inspect, search, read, or modify .codex-bin,
  _run_tests*, _rt_*, benchmark harness files, baseline files, the env ledger, or
  task-overrides; never reconstruct the suite with docker or a host test runner.
- Re-run run_tests only after a source/test edit. If the source diff is unchanged,
  the result cannot improve. Use run_tests' supported targeted mode for diagnosis.
```

Mechanism: removes infrastructure investigation and non-authoritative reruns while preserving canonical full and targeted validation after every edit.

Affected examples: `microsoft__kiota-4174`, `microsoft__kiota-4328`, `microsoft__kiota-3834`, `rust-lang__rustfmt-5209`, `jkroepke__openvpn-auth-oauth2-272`, and `apache__dubbo-go-hessian2-229`.

Estimated dataset saving: $5.135639 direct eligible cost ($2.593294 harness + $2.542345 manual tests), plus up to $0.664897 for unchanged canonical repeats. Report these separately from post-validation savings because they overlap.

Resolution-risk argument: no repository source, test, ranked hit, or canonical validation is removed. The forbidden files cannot contribute to the submitted patch, and direct runners are invalid in this prepared environment. A new validation remains allowed after every edit, and targeted diagnosis remains available through the authoritative shim.

### 2. PROMPT — promote the existing anti-thrash appendix into canonical M+++++

`codex-task-runner.mjs` already contains the right disabled appendix: do not `ss-read` a span already returned, do not reformulate a query whose top hit answers it, and use trace for call flow. `SS_NO_ANTITHRASH=1` removed it from these runs. Promote that text, with one precision edit: “same span in the current search iteration/source revision,” so compaction or later edits do not make the rule over-broad.

Affected examples: `arkivanov__decompose-916`, `analysis-dev__diktat-1206`, `elixir-ecto__ecto-2438`, `zestedesavoir__zmarkdown-248`, `scalameta__scalameta-3606`, and `ontodev__robot-710`.

Estimated dataset saving: $0.761448 direct for the safest subset ($0.746605 fully contained recent reads + $0.014843 exact repeated search). Partial duplicate-line suppression exposes a $1.397024 upper pool, but should be validated separately.

Resolution-risk argument: the initial result pack, its breadth, every unseen line, and every new target remain available. Only a query or source line already resident in the immediately preceding context is skipped.

### 3. ENGINE — agent-only shown-span trailer

For `opts._isAgentFormat`, append a deterministic trailer such as:

```text
shown-full: ChildrenFactory.kt:18-61,110-155
next-read: request only ranges outside shown-full; use --force to repeat
```

Do not auto-drop requested content in the first version. The trailer makes the existing prompt rule executable and gives an explicit escape hatch. A later agent-only `ss-read` optimization may replace overlapping lines with stable `already shown above` markers while returning every unseen line.

Affected examples and estimate are the same $0.761448 safe pool as proposal 2, so the two are **not additive**. The engine trailer should improve prompt capture; the $1.397024 partial-overlap pool is the ceiling for information-preserving clipping.

Resolution-risk argument: this first version only adds state; it changes neither ranking nor returned evidence. Any later clipping is restricted to ranges shown within three turns on the same source revision and retains `--force`. Gate the output shape on `_isAgentFormat`; no default/NL format changes.

### 4. ENGINE — compact the agent route trailer

For `opts._isAgentFormat`, replace `<<SS_ROUTE_META>>` JSON with one compact line retaining all agent-actionable fields:

```text
route=hybrid confidence=high sufficient=YES reason=clear_margin repo=ok results=9
```

Keep full JSON in non-agent/debug output. Preserve result bodies, ranks, scores, result count, repo-match state, confidence, sufficiency, and reason; remove repeated query text, absolute project roots, PID, latency, and duplicated internal routing fields from the agent context.

Affected examples: `docker__compose-9148` ($0.029484 modeled), `microsoft__kiota-4174` ($0.027432), `jkroepke__openvpn-auth-oauth2-272` ($0.024692), `microsoft__kiota-4328` ($0.019641), and `detachhead__basedpyright-85` ($0.017731).

Estimated dataset saving: $0.514510 after modeled downstream re-sends; direct trailer text was 158,104 characters.

Resolution-risk argument: no code evidence, hit identity, rank, or actionable routing verdict is removed. This is an agent-format serialization change only. It introduces no ranking signal; if any future ranking behavior is added, it must separately be gated on `opts._isAgentFormat` per repository policy.

### 5. PROMPT — finish after authoritative success and one no-edit review

Add:

```text
After run_tests reports zero NEW failures, review the source diff once. If that
review produces no source/test edit and you have no concrete edit planned, finish;
do not search, inspect the harness, or test the unchanged diff again.
```

Affected examples: `facelessuser__wcmatch-46`, `rstudio__gt-783`, `elixir-plug__plug-1154`, `nodatime__nodatime-1808`, and `phoenixframework__phoenix_html-282`.

Estimated dataset saving: $1.258626 gross ($0.597835 on resolved sweet runs). This overlaps proposal 1 and must not be added to it mechanically.

Resolution-risk argument: the trigger is post-validation and post-review, and only applies when the review produced no edit. The final source diff and authoritative test result are therefore identical; initial retrieval and implementation breadth are untouched.

## Rejected or deferred levers

- **Blanket pack/trace cap:** modeled $3.688461, rejected because it trims initial evidence. First build lossless deduplication or continuation semantics and validate on the smoke set.
- **Earlier-edit/search budget:** rejected. The positive late-edit tail is real on offenders, but sweet pre-edit cost is better in net and forced early edits can lose resolution.
- **Stronger global `sufficient=YES` stop:** deferred. The ten audits found no matching re-search to remove; subsequent probes usually addressed a new subproblem.
- **Ranking changes:** no evidence supports one. None is proposed. Any future signal must be agent-format gated on `opts._isAgentFormat`.
- **More query-dedupe machinery:** defer; one exact duplicate worth $0.014843 cannot justify a new behavioral surface beyond the existing appendix.

## Suggested 10-task smoke list

Use the same DEV tasks and compare resolution first, then `idealCostUsd`, model turns, and the classified call counts. A lever fails validation on any solved-to-failed flip.

| task | baseline signal to remove | principal lever | approximate measured pool |
|---|---|---|---:|
| `microsoft__kiota-4174` | Docker/harness loop, repeated test, redundant read, giant trace | validation boundary + span trailer + route compact | $1.951149 direct validation pool, plus $0.134862 read overlap |
| `microsoft__kiota-4328` | manual tests, harness reads, repeated canonical test | validation boundary | $1.093699 |
| `rust-lang__rustfmt-5209` | post-edit harness and baseline mutation | validation boundary | $0.319341 |
| `scalameta__scalameta-3127` | harness inspection and repeated shown spans; resolved canary | validation boundary + span trailer | $0.608585 direct before route metadata |
| `jkroepke__openvpn-auth-oauth2-272` | harness search/manual test tail | validation boundary + route compact | $0.214225 classified pool |
| `zestedesavoir__zmarkdown-248` | fully redundant recent `ss-read` | anti-thrash + span trailer | $0.058680 read turn; $0.036832 post-validation separately |
| `scalameta__scalameta-3606` | several fully redundant adjacent reads | anti-thrash + span trailer | $0.120564 |
| `ontodev__robot-710` | redundant reads on a resolved task | anti-thrash + span trailer | $0.071169 |
| `docker__compose-9148` | largest route-trailer amplification | route compact | $0.029484 route + $0.036964 harness |
| `facelessuser__wcmatch-46` | tools after final authoritative no-new-failure result; resolved canary | post-validation finish | $0.174407 |

Smoke acceptance criteria:

1. Zero resolved-to-failed flips, both per task and in aggregate.
2. The three currently resolved canaries in the list remain resolved.
3. The targeted call class visibly falls: no harness/manual reconstruction, no unchanged-diff `run_tests`, or no fully contained re-read, depending on lever.
4. Aggregate `idealCostUsd` falls; do not accept a call reduction that increases cost through larger outputs.
5. Treat all results as DEV-only and do not tune to any held-out per-query failure.

## Bottom line

The safe money is in removing invalid validation work and information duplication, not in shrinking initial search. Promote the existing anti-thrash wording, add a hard validation boundary, expose shown-span state, and compact route metadata. Those changes preserve the source diff and all retrieval evidence while attacking the resident-context mechanism that makes every wasted turn or byte recur.
