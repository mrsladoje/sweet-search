# Tail census (primary: after the LAST edit attempt)


## Variant: last_edit

| harness | arm | n | no-edit | tail req mean | median | p90 | max | tail req share | tail $ mean | tail $ share | removable req mean | removable $ mean | removable $ share | tail $/req | head $/req | ratio |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | native | 66 | 0 | 4.86 | 5.0 | 6 | 10 | 25.8% | $0.002723 | 22.2% | 3.86 | $0.002237 | 18.2% | $0.000558 | $0.000643 | 0.87 |
| codex | sweet | 66 | 0 | 5.05 | 5.0 | 7 | 11 | 25.7% | $0.002697 | 21.9% | 4.05 | $0.002237 | 18.1% | $0.000540 | $0.000637 | 0.85 |
| opencode | native | 66 | 0 | 5.21 | 5.0 | 7 | 11 | 31.9% | $0.002352 | 26.2% | 4.21 | $0.001949 | 21.7% | $0.000453 | $0.000553 | 0.82 |
| opencode | sweet | 66 | 0 | 4.77 | 5.0 | 6 | 13 | 24.2% | $0.001953 | 21.1% | 3.77 | $0.001558 | 16.8% | $0.000419 | $0.000454 | 0.92 |
| claude-code | native | 66 | 0 | 4.38 | 4.0 | 7 | 10 | 18.0% | $0.002475 | 15.0% | 3.38 | $0.001914 | 11.6% | $0.000555 | $0.000685 | 0.81 |
| claude-code | sweet | 65 | 1 | 4.23 | 4.0 | 7 | 14 | 18.0% | $0.002444 | 14.8% | 3.23 | $0.001862 | 11.3% | $0.000587 | $0.000736 | 0.80 |

## Variant: last_ok_edit

| harness | arm | n | no-edit | tail req mean | median | p90 | max | tail req share | tail $ mean | tail $ share | removable req mean | removable $ mean | removable $ share | tail $/req | head $/req | ratio |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | native | 66 | 0 | 4.86 | 5.0 | 6 | 10 | 25.8% | $0.002723 | 22.2% | 3.86 | $0.002237 | 18.2% | $0.000558 | $0.000643 | 0.87 |
| codex | sweet | 66 | 0 | 5.05 | 5.0 | 7 | 11 | 25.7% | $0.002697 | 21.9% | 4.05 | $0.002237 | 18.1% | $0.000540 | $0.000637 | 0.85 |
| opencode | native | 66 | 0 | 5.21 | 5.0 | 7 | 11 | 31.9% | $0.002352 | 26.2% | 4.21 | $0.001949 | 21.7% | $0.000453 | $0.000553 | 0.82 |
| opencode | sweet | 66 | 0 | 4.77 | 5.0 | 6 | 13 | 24.2% | $0.001953 | 21.1% | 3.77 | $0.001558 | 16.8% | $0.000419 | $0.000454 | 0.92 |
| claude-code | native | 66 | 0 | 4.38 | 4.0 | 7 | 10 | 18.0% | $0.002475 | 15.0% | 3.38 | $0.001914 | 11.6% | $0.000555 | $0.000685 | 0.81 |
| claude-code | sweet | 65 | 1 | 4.29 | 4.0 | 7 | 14 | 18.3% | $0.002770 | 16.8% | 3.29 | $0.002189 | 13.3% | $0.000633 | $0.000723 | 0.88 |

## Solved vs unsolved (primary variant)

| harness | arm | outcome | n | tail req mean | median | p90 | tail $ mean | tail $ share | removable req mean | removable $ share | run_tests reqs in tail (total) | rollouts with >=2 run_tests in tail |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | native | solved | 41 | 5.15 | 5.0 | 8 | $0.002577 | 29.5% | 4.15 | 24.7% | 44 | 5 |
| codex | native | unsolved | 25 | 4.40 | 4.0 | 6 | $0.002962 | 16.3% | 3.40 | 13.1% | 24 | 1 |
| codex | sweet | solved | 39 | 5.15 | 5.0 | 7 | $0.002440 | 26.8% | 4.15 | 22.4% | 43 | 6 |
| codex | sweet | unsolved | 27 | 4.89 | 5.0 | 6 | $0.003069 | 18.1% | 3.89 | 14.9% | 34 | 6 |
| opencode | native | solved | 41 | 5.17 | 5.0 | 6 | $0.002073 | 33.6% | 4.17 | 28.0% | 46 | 5 |
| opencode | native | unsolved | 25 | 5.28 | 5.0 | 8 | $0.002810 | 20.7% | 4.28 | 17.1% | 28 | 3 |
| opencode | sweet | solved | 41 | 5.07 | 5.0 | 6 | $0.001805 | 29.3% | 4.07 | 23.9% | 45 | 4 |
| opencode | sweet | unsolved | 25 | 4.28 | 4.0 | 6 | $0.002196 | 15.3% | 3.28 | 11.8% | 26 | 2 |
| claude-code | native | solved | 43 | 4.02 | 4.0 | 6 | $0.001977 | 16.6% | 3.02 | 12.2% | 43 | 3 |
| claude-code | native | unsolved | 23 | 5.04 | 4.0 | 9 | $0.003406 | 13.5% | 4.04 | 11.0% | 29 | 5 |
| claude-code | sweet | solved | 40 | 4.50 | 4.0 | 8 | $0.002169 | 21.9% | 3.50 | 16.8% | 42 | 2 |
| claude-code | sweet | unsolved | 25 | 3.80 | 4.0 | 6 | $0.002883 | 10.7% | 2.80 | 8.1% | 25 | 3 |

## Tail request classes (primary variant; requests classified by priority run_tests > rt_poll > direct_test > edit > git_revert > git_diff/status > git_other > reread_edited > ss_read_other > ss_search > native_read > native_find > delegate > poll > plan > other > text_only)

| cell | n | tail reqs | run_tests | rt_poll | direct_test | git_diff_status | git_other | git_revert | reread_edited | ss_read_other | ss_search | native_read | native_find | delegate | poll | plan | other | text_only |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/native | 66 | 321 | 68 | 15 | 1 | 50 | 0 | 0 | 0 | 0 | 0 | 20 | 2 | 0 | 0 | 99 | 0 | 66 |
| codex/sweet | 66 | 333 | 77 | 16 | 0 | 44 | 0 | 0 | 0 | 11 | 7 | 1 | 0 | 0 | 0 | 111 | 0 | 66 |
| opencode/native | 66 | 344 | 74 | 0 | 0 | 57 | 1 | 0 | 5 | 0 | 0 | 11 | 12 | 0 | 0 | 118 | 0 | 66 |
| opencode/sweet | 66 | 315 | 71 | 0 | 0 | 56 | 1 | 0 | 0 | 8 | 5 | 0 | 0 | 0 | 0 | 108 | 0 | 66 |
| claude-code/native | 66 | 289 | 72 | 0 | 1 | 55 | 1 | 1 | 5 | 0 | 0 | 24 | 4 | 0 | 1 | 52 | 4 | 69 |
| claude-code/sweet | 65 | 275 | 67 | 0 | 1 | 35 | 0 | 0 | 2 | 15 | 30 | 0 | 0 | 1 | 0 | 54 | 2 | 68 |

Per-rollout means:

| cell | run_tests | rt_poll | direct_test | git_diff_status | git_other | git_revert | reread_edited | ss_read_other | ss_search | native_read | native_find | delegate | poll | plan | other | text_only |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/native | 1.03 | 0.23 | 0.02 | 0.76 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.30 | 0.03 | 0.00 | 0.00 | 1.50 | 0.00 | 1.00 |
| codex/sweet | 1.17 | 0.24 | 0.00 | 0.67 | 0.00 | 0.00 | 0.00 | 0.17 | 0.11 | 0.02 | 0.00 | 0.00 | 0.00 | 1.68 | 0.00 | 1.00 |
| opencode/native | 1.12 | 0.00 | 0.00 | 0.86 | 0.02 | 0.00 | 0.08 | 0.00 | 0.00 | 0.17 | 0.18 | 0.00 | 0.00 | 1.79 | 0.00 | 1.00 |
| opencode/sweet | 1.08 | 0.00 | 0.00 | 0.85 | 0.02 | 0.00 | 0.00 | 0.12 | 0.08 | 0.00 | 0.00 | 0.00 | 0.00 | 1.64 | 0.00 | 1.00 |
| claude-code/native | 1.09 | 0.00 | 0.02 | 0.83 | 0.02 | 0.02 | 0.08 | 0.00 | 0.00 | 0.36 | 0.06 | 0.00 | 0.02 | 0.79 | 0.06 | 1.05 |
| claude-code/sweet | 1.03 | 0.00 | 0.02 | 0.54 | 0.00 | 0.00 | 0.03 | 0.23 | 0.46 | 0.00 | 0.00 | 0.02 | 0.00 | 0.83 | 0.03 | 1.05 |

## Tail CALL classes (every tool call inside tail requests; opencode/claude pack several calls per request)

| cell | tail calls | run_tests | rt_poll | direct_test | git_diff_status | git_other | git_revert | reread_edited | ss_read_other | ss_search | native_read | native_find | delegate | poll | plan | other | sweet-specific (ss-*) | native-specific (Read/Grep/Glob/cat/sed) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/native | 255 | 68 | 15 | 1 | 50 | 0 | 0 | 0 | 0 | 0 | 20 | 2 | 0 | 0 | 99 | 0 | 0 | 22 |
| codex/sweet | 267 | 77 | 16 | 0 | 44 | 0 | 0 | 0 | 11 | 7 | 1 | 0 | 0 | 0 | 111 | 0 | 18 | 1 |
| opencode/native | 353 | 74 | 0 | 0 | 94 | 1 | 0 | 17 | 0 | 0 | 21 | 28 | 0 | 0 | 118 | 0 | 0 | 49 |
| opencode/sweet | 274 | 71 | 0 | 0 | 79 | 1 | 0 | 0 | 9 | 6 | 0 | 0 | 0 | 0 | 108 | 0 | 15 | 0 |
| claude-code/native | 221 | 72 | 0 | 1 | 55 | 1 | 1 | 5 | 0 | 0 | 25 | 4 | 0 | 1 | 52 | 4 | 0 | 29 |
| claude-code/sweet | 207 | 67 | 0 | 1 | 35 | 0 | 0 | 2 | 15 | 30 | 0 | 0 | 1 | 0 | 54 | 2 | 45 | 0 |

## Paired per-task comparison of mean tail requests (sweet - native), per harness

| harness | tasks | sweet longer | native longer | tie | mean diff (req) | mean diff ($) | sum tail $ sweet | sum tail $ native |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | 22 | 12 | 8 | 2 | 0.18 | $-0.000026 | $0.1780 | $0.1797 |
| opencode | 22 | 3 | 14 | 5 | -0.44 | $-0.000399 | $0.1289 | $0.1552 |
| claude-code | 22 | 7 | 13 | 2 | -0.16 | $-0.000046 | $0.1588 | $0.1634 |

## Ten largest tails per harness (by tail requests; primary variant)


### codex

| rank | rollout id | arm | solved | patch | total req | tail req | tail $ | tail share | tail class mix | last req |
|---:|---|---|---|---|---:|---:|---:|---:|---|---|
| 1 | `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0` | sweet | yes | 3 hunks | 22 | 11 | $0.005501 | 50.0% | ss_search 4, git_diff_status 3, run_tests 1, ss_read_other 1, plan 1 | text_only |
| 2 | `fp-codex-tab-20260826/devlooped__moq-1262/native/r1` | native | yes | 2 hunks | 28 | 10 | $0.008262 | 38.3% | native_read 3, plan 2, run_tests 2, git_diff_status 2, text_only 1 | text_only |
| 3 | `fp-codex-tab-20260826/mathnet__mathnet-numerics-1072/native/r0` | native | yes | 4 hunks | 18 | 10 | $0.005401 | 53.3% | plan 2, run_tests 2, rt_poll 2, native_read 2, git_diff_status 1 | text_only |
| 4 | `fp-codex-tab-20260826/aio-libs__aiohttp-8038/sweet/r1` | sweet | no | 1 hunks | 19 | 9 | $0.006262 | 49.1% | ss_read_other 3, plan 2, run_tests 1, ss_search 1, git_diff_status 1 | text_only |
| 5 | `fp-codex-tab-20260826/apigee__registry-961/sweet/r1` | sweet | yes | 2 hunks | 28 | 8 | $0.005056 | 28.9% | plan 2, run_tests 2, rt_poll 2, git_diff_status 1, text_only 1 | text_only |
| 6 | `fp-codex-tab-20260826/mathnet__mathnet-numerics-1072/sweet/r0` | sweet | yes | 4 hunks | 16 | 8 | $0.004753 | 46.6% | plan 2, run_tests 2, rt_poll 2, git_diff_status 1, text_only 1 | text_only |
| 7 | `fp-codex-tab-20260826/mathnet__mathnet-numerics-1072/native/r1` | native | yes | 4 hunks | 22 | 8 | $0.004409 | 35.6% | plan 2, run_tests 2, rt_poll 2, native_read 1, text_only 1 | text_only |
| 8 | `fp-codex-tab-20260826/mirumee__ariadne-codegen-218/native/r1` | native | yes | 1 hunks | 16 | 8 | $0.004035 | 47.2% | plan 2, run_tests 2, git_diff_status 2, native_read 1, text_only 1 | text_only |
| 9 | `fp-codex-tab-20260826/mathnet__mathnet-numerics-1072/sweet/r1` | sweet | yes | 4 hunks | 15 | 8 | $0.003781 | 48.4% | plan 2, run_tests 2, rt_poll 2, git_diff_status 1, text_only 1 | text_only |
| 10 | `fp-codex-tab-20260826/mirumee__ariadne-codegen-218/native/r2` | native | yes | 1 hunks | 15 | 8 | $0.003553 | 47.6% | native_read 3, plan 2, run_tests 1, git_diff_status 1, text_only 1 | text_only |

Ten largest by tail cost:

| rank | rollout id | arm | solved | tail req | tail $ | tail share | rollout $ |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | `fp-codex-tab-20260826/devlooped__moq-1262/native/r1` | native | yes | 10 | $0.008262 | 38.3% | $0.021559 |
| 2 | `fp-codex-tab-20260826/devlooped__moq-1262/native/r0` | native | no | 5 | $0.006570 | 12.0% | $0.054617 |
| 3 | `fp-codex-tab-20260826/aio-libs__aiohttp-8038/sweet/r1` | sweet | no | 9 | $0.006262 | 49.1% | $0.012761 |
| 4 | `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0` | sweet | yes | 11 | $0.005501 | 50.0% | $0.011004 |
| 5 | `fp-codex-tab-20260826/mathnet__mathnet-numerics-1072/native/r0` | native | yes | 10 | $0.005401 | 53.3% | $0.010143 |
| 6 | `fp-codex-tab-20260826/devlooped__moq-1262/native/r2` | native | no | 5 | $0.005295 | 14.9% | $0.035421 |
| 7 | `fp-codex-tab-20260826/apigee__registry-961/sweet/r1` | sweet | yes | 8 | $0.005056 | 28.9% | $0.017474 |
| 8 | `fp-codex-tab-20260826/apigee__registry-961/sweet/r2` | sweet | yes | 7 | $0.005008 | 18.0% | $0.027808 |
| 9 | `fp-codex-tab-20260826/protofire__solhint-224/native/r0` | native | no | 4 | $0.004885 | 26.5% | $0.018419 |
| 10 | `fp-codex-tab-20260826/devlooped__moq-1262/sweet/r1` | sweet | no | 3 | $0.004785 | 12.0% | $0.039866 |

### opencode

| rank | rollout id | arm | solved | patch | total req | tail req | tail $ | tail share | tail class mix | last req |
|---:|---|---|---|---|---:|---:|---:|---:|---|---|
| 1 | `rp-oc-tab-20260827/aws-actions__configure-aws-credentials-42/sweet/r0` | sweet | yes | 3 hunks | 21 | 13 | $0.004949 | 63.9% | git_diff_status 3, ss_read_other 3, plan 2, ss_search 2, run_tests 1 | text_only |
| 2 | `fp-opencode-tab-20260826/gitbookio__markup-it-56/native/r1` | native | no | 1 hunks | 20 | 11 | $0.004988 | 47.0% | native_find 3, native_read 3, plan 2, run_tests 1, git_diff_status 1 | text_only |
| 3 | `fp-opencode-tab-20260826/bfgroup__b2-259/native/r0` | native | no | 1 hunks | 25 | 9 | $0.004057 | 36.5% | plan 2, native_read 2, native_find 2, run_tests 1, git_diff_status 1 | text_only |
| 4 | `fp-opencode-tab-20260826/devlooped__moq-1262/native/r0` | native | no | 1 hunks | 22 | 8 | $0.004503 | 34.6% | plan 2, native_find 2, run_tests 1, git_diff_status 1, native_read 1 | text_only |
| 5 | `fp-opencode-tab-20260826/bfgroup__b2-259/sweet/r2` | sweet | no | 1 hunks | 33 | 8 | $0.004004 | 30.0% | ss_search 3, plan 2, run_tests 1, git_diff_status 1, text_only 1 | text_only |
| 6 | `fp-opencode-tab-20260826/devlooped__moq-1262/native/r1` | native | no | 6 hunks | 46 | 7 | $0.007034 | 17.5% | run_tests 2, git_diff_status 2, native_read 1, plan 1, text_only 1 | text_only |
| 7 | `fp-opencode-tab-20260826/mathnet__mathnet-numerics-1072/native/r1` | native | yes | 4 hunks | 14 | 7 | $0.003348 | 48.5% | plan 2, run_tests 2, git_diff_status 2, text_only 1 | text_only |
| 8 | `fp-opencode-tab-20260826/mirumee__ariadne-codegen-218/native/r2` | native | yes | 1 hunks | 13 | 7 | $0.002906 | 45.4% | plan 2, run_tests 2, reread_edited 1, git_diff_status 1, text_only 1 | text_only |
| 9 | `fp-opencode-tab-20260826/hotmeteor__spectator-181/native/r0` | native | no | 1 hunks | 12 | 7 | $0.002665 | 41.7% | plan 2, run_tests 1, git_diff_status 1, native_find 1, native_read 1 | text_only |
| 10 | `fp-opencode-tab-20260826/absinthe-graphql__absinthe-998/sweet/r2` | sweet | yes | 1 hunks | 13 | 7 | $0.002571 | 45.0% | plan 2, run_tests 2, git_diff_status 2, text_only 1 | text_only |

Ten largest by tail cost:

| rank | rollout id | arm | solved | tail req | tail $ | tail share | rollout $ |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | `fp-opencode-tab-20260826/devlooped__moq-1262/native/r1` | native | no | 7 | $0.007034 | 17.5% | $0.040190 |
| 2 | `fp-opencode-tab-20260826/gitbookio__markup-it-56/native/r1` | native | no | 11 | $0.004988 | 47.0% | $0.010616 |
| 3 | `rp-oc-tab-20260827/aws-actions__configure-aws-credentials-42/sweet/r0` | sweet | yes | 13 | $0.004949 | 63.9% | $0.007748 |
| 4 | `fp-opencode-tab-20260826/devlooped__moq-1262/native/r0` | native | no | 8 | $0.004503 | 34.6% | $0.013015 |
| 5 | `fp-opencode-tab-20260826/bfgroup__b2-259/native/r0` | native | no | 9 | $0.004057 | 36.5% | $0.011102 |
| 6 | `fp-opencode-tab-20260826/bfgroup__b2-259/sweet/r2` | sweet | no | 8 | $0.004004 | 30.0% | $0.013353 |
| 7 | `fp-opencode-tab-20260826/accenture__sfmc-devtools-1974/native/r2` | native | yes | 6 | $0.003763 | 34.8% | $0.010813 |
| 8 | `fp-opencode-tab-20260826/accenture__sfmc-devtools-1974/native/r0` | native | yes | 6 | $0.003750 | 25.9% | $0.014488 |
| 9 | `fp-opencode-tab-20260826/apigee__registry-961/native/r1` | native | yes | 5 | $0.003457 | 25.4% | $0.013634 |
| 10 | `rp-oc-tab-20260827/devlooped__moq-1262/sweet/r1` | sweet | no | 4 | $0.003354 | 9.8% | $0.034155 |

### claude-code

| rank | rollout id | arm | solved | patch | total req | tail req | tail $ | tail share | tail class mix | last req |
|---:|---|---|---|---|---:|---:|---:|---:|---|---|
| 1 | `fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r1` | sweet | yes | 3 hunks | 24 | 14 | $0.005467 | 47.4% | ss_search 6, ss_read_other 2, git_diff_status 2, plan 2, run_tests 1 | text_only |
| 2 | `fp-claudecode-tab-20260826/awslabs__aws-embedded-metrics-node-21/native/r2` | native | no | 2 hunks | 31 | 10 | $0.005928 | 33.2% | git_diff_status 4, text_only 3, run_tests 1, native_read 1, other 1 | text_only |
| 3 | `fp-claudecode-tab-20260826/mathnet__mathnet-numerics-1072/sweet/r0` | sweet | yes | 1 hunks | 15 | 10 | $0.005245 | 54.4% | ss_search 5, run_tests 2, git_diff_status 2, text_only 1 | text_only |
| 4 | `fp-claudecode-tab-20260826/gitbookio__markup-it-56/native/r1` | native | no | 1 hunks | 29 | 9 | $0.006781 | 35.7% | native_read 4, run_tests 1, git_diff_status 1, other 1, plan 1 | text_only |
| 5 | `fp-claudecode-tab-20260826/protofire__solhint-224/native/r2` | native | no | 2 hunks | 26 | 9 | $0.006296 | 34.3% | run_tests 2, git_diff_status 2, native_find 1, git_other 1, plan 1 | text_only |
| 6 | `fp-claudecode-tab-20260826/final-form__final-form-64/sweet/r2` | sweet | yes | 1 hunks | 20 | 9 | $0.003968 | 37.6% | text_only 4, plan 3, run_tests 1, git_diff_status 1 | text_only |
| 7 | `fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r2` | sweet | yes | 3 hunks | 17 | 9 | $0.003220 | 37.5% | ss_search 4, plan 2, run_tests 1, git_diff_status 1, text_only 1 | text_only |
| 8 | `fp-claudecode-tab-20260826/gitbookio__markup-it-56/native/r2` | native | no | 1 hunks | 43 | 8 | $0.005263 | 23.3% | plan 3, native_read 2, run_tests 1, git_diff_status 1, text_only 1 | text_only |
| 9 | `fp-claudecode-tab-20260826/mirumee__ariadne-codegen-218/native/r1` | native | yes | 1 hunks | 16 | 8 | $0.004360 | 44.6% | text_only 2, run_tests 1, git_diff_status 1, plan 1, native_read 1 | text_only |
| 10 | `fp-claudecode-tab-20260826/jazzband__tablib-454/sweet/r1` | sweet | yes | 1 hunks | 15 | 8 | $0.004234 | 46.3% | ss_read_other 4, run_tests 1, ss_search 1, plan 1, text_only 1 | text_only |

Ten largest by tail cost:

| rank | rollout id | arm | solved | tail req | tail $ | tail share | rollout $ |
|---:|---|---|---|---:|---:|---:|---:|
| 1 | `fp-claudecode-tab-20260826/devlooped__moq-1262/sweet/r2` | sweet | no | 5 | $0.010221 | 29.8% | $0.034334 |
| 2 | `fp-claudecode-tab-20260826/devlooped__moq-1262/native/r2` | native | no | 6 | $0.007095 | 6.6% | $0.108251 |
| 3 | `fp-claudecode-tab-20260826/gitbookio__markup-it-56/native/r1` | native | no | 9 | $0.006781 | 35.7% | $0.018988 |
| 4 | `fp-claudecode-tab-20260826/protofire__solhint-224/native/r2` | native | no | 9 | $0.006296 | 34.3% | $0.018332 |
| 5 | `fp-claudecode-tab-20260826/devlooped__moq-1262/sweet/r1` | sweet | no | 7 | $0.006209 | 29.2% | $0.021250 |
| 6 | `fp-claudecode-tab-20260826/awslabs__aws-embedded-metrics-node-21/native/r2` | native | no | 10 | $0.005928 | 33.2% | $0.017867 |
| 7 | `fp-claudecode-tab-20260826/devlooped__moq-1262/native/r0` | native | no | 5 | $0.005470 | 14.8% | $0.036874 |
| 8 | `fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r1` | sweet | yes | 14 | $0.005467 | 47.4% | $0.011523 |
| 9 | `fp-claudecode-tab-20260826/gitbookio__markup-it-56/native/r2` | native | no | 8 | $0.005263 | 23.3% | $0.022597 |
| 10 | `fp-claudecode-tab-20260826/mathnet__mathnet-numerics-1072/sweet/r0` | sweet | yes | 10 | $0.005245 | 54.4% | $0.009640 |

## Rollouts that end on a failed edit with no retry (last edit request failed; no later edit request)

| cell | count | of which empty patch | of which solved | rollout ids |
|---|---:|---:|---:|---|
| codex/native | 0 | 0 | 0 | — |
| codex/sweet | 0 | 0 | 0 | — |
| opencode/native | 0 | 0 | 0 | — |
| opencode/sweet | 0 | 0 | 0 | — |
| claude-code/native | 0 | 0 | 0 | — |
| claude-code/sweet | 1 | 0 | 0 | `fp-claudecode-tab-20260826/protofire__solhint-224/sweet/r0` (tail 2) |

## Rollouts whose LAST assistant text is a `<state_summary>` block

| cell | last text is state_summary | ... and empty patch | empty patch (any last text) | rollout ids (state_summary last) |
|---|---:|---:|---:|---|
| codex/native | 0 | 0 | 0 | — |
| codex/sweet | 0 | 0 | 0 | — |
| opencode/native | 0 | 0 | 0 | — |
| opencode/sweet | 1 | 0 | 0 | `rp-oc-tab-20260827/mathnet__mathnet-numerics-1072/sweet/r0` solved |
| claude-code/native | 0 | 0 | 1 | — |
| claude-code/sweet | 1 | 1 | 1 | `fp-claudecode-tab-20260826/celestiaorg__nmt-192/sweet/r0` EMPTY |

Empty-patch rollouts (any last text):

- claude-code/native: `fp-claudecode-tab-20260826/aio-libs__aiohttp-8038/native/r2` (edits 19)
- claude-code/sweet: `fp-claudecode-tab-20260826/celestiaorg__nmt-192/sweet/r0` (edits 0)

## Cost by request position (replicates r2-turn-profile-and-subagents.mjs: ideal price, rollouts with >= 8 requests)

| cell | n(>=8 req) | first quarter share | last quarter share | ratio last:first | first request share | last request share | tail (post-edit) $ share | tail req share | tail-share / req-share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/sweet | 65 | 24.5% | 24.9% | 1.02x | 13.7% | 3.7% | 21.9% | 25.7% | 0.85 |
| codex/native | 66 | 23.5% | 23.9% | 1.02x | 12.7% | 3.9% | 22.2% | 25.8% | 0.86 |
| opencode/sweet | 66 | 21.6% | 25.5% | 1.18x | 10.1% | 4.3% | 21.1% | 24.2% | 0.87 |
| opencode/native | 66 | 22.8% | 22.9% | 1.00x | 8.8% | 4.5% | 26.2% | 31.9% | 0.82 |
| claude-code/sweet | 63 | 25.8% | 26.2% | 1.02x | 13.0% | 3.8% | 14.8% | 18.0% | 0.82 |
| claude-code/native | 65 | 24.7% | 24.7% | 1.00x | 11.8% | 3.6% | 15.0% | 18.0% | 0.83 |

Same table at REALIZED price (what the ledger bills; claude includes the 1.25x cache-write premium):

| cell | first quarter share | last quarter share | ratio |
|---|---:|---:|---:|
| codex/sweet | 24.5% | 24.9% | 1.02x |
| codex/native | 23.5% | 23.9% | 1.02x |
| opencode/sweet | 21.6% | 25.5% | 1.18x |
| opencode/native | 22.8% | 22.9% | 1.00x |
| claude-code/sweet | 28.0% | 24.9% | 0.89x |
| claude-code/native | 27.4% | 23.6% | 0.86x |

## Tail token anatomy (per rollout means, primary variant)

| cell | tail req | tail billed input (re-sent context, sum over tail requests) | tail new input (ingested in tail) | tail output | tail $ | of which output $ | of which resend $ | of which ingest $ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/native | 4.86 | 167249 | 3436 | 1204 | $0.002723 | $0.000722 | $0.001638 | $0.000344 |
| codex/sweet | 5.05 | 165747 | 3060 | 1242 | $0.002697 | $0.000745 | $0.001627 | $0.000306 |
| opencode/native | 5.21 | 148930 | 3559 | 902 | $0.002352 | $0.000541 | $0.001454 | $0.000356 |
| opencode/sweet | 4.77 | 122237 | 3086 | 753 | $0.001953 | $0.000452 | $0.001192 | $0.000309 |
| claude-code/native | 4.38 | 156726 | 2376 | 1025 | $0.002475 | $0.000615 | $0.001543 | $0.000238 |
| claude-code/sweet | 4.23 | 156756 | 2207 | 853 | $0.002444 | $0.000512 | $0.001545 | $0.000221 |

## Claude-code sidechain (subagent) position relative to the last main-thread edit

- native: rollouts that delegated = 28; delegation only before the last edit = 28, only after = 0, both = 0; sidechain requests = 519, sidechain $ = 0.2923 (main-thread requests are the tail basis; sidechain requests are excluded from the tail counts)
- sweet: rollouts that delegated = 9; delegation only before the last edit = 8, only after = 1, both = 0; sidechain requests = 364, sidechain $ = 0.1855 (main-thread requests are the tail basis; sidechain requests are excluded from the tail counts)
