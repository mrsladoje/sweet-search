

# codex  runs={'run': 'fp-codex-tab-20260826'}  tasks=12  rollouts native=36 sweet=36  boundary=read
solved-everywhere tasks: absinthe-graphql__absinthe-998, apigee__registry-961, asynkron__protoactor-dotnet-1909, aws-actions__configure-aws-credentials-42, axelrod-python__axelrod-671, callstack__react-native-paper-972, celestiaorg__nmt-192, final-form__final-form-64, jazzband__tablib-454, locationtech__jts-622, mathnet__mathnet-numerics-1072, mirumee__ariadne-codegen-218

## Per-phase means per rollout (native | sweet | sweet-native mean over tasks | median | tasks S>N of 12)
| phase | metric | native | sweet | Δ mean | Δ median | S>N |
|---|---|---:|---:|---:|---:|---:|
| localize | req | 2.9 | 3.6 | +0.7 | +0.2 | 6 |
| localize | newIn | 15,842.6 | 17,780.5 | +1,937.9 | +1,880.8 | 11 |
| localize | resent | 31,611.5 | 45,401.5 | +13,790.0 | +6,902.2 | 10 |
| localize | out | 383.2 | 405.1 | +21.9 | -11.2 | 5 |
| localize | cost | 0.002130 | 0.002475 | +0.000345 | +0.000232 | 10 |
| understand | req | 4.6 | 3.5 | -1.1 | -1.3 | 2 |
| understand | newIn | 7,430.9 | 3,769.1 | -3,661.8 | -3,502.2 | 0 |
| understand | resent | 91,500.1 | 68,432.4 | -23,067.8 | -29,690.8 | 4 |
| understand | out | 731.9 | 516.2 | -215.8 | -197.0 | 1 |
| understand | cost | 0.002097 | 0.001371 | -0.000726 | -0.000838 | 1 |
| edit | req | 1.2 | 1.2 | +0.0 | +0.0 | 2 |
| edit | newIn | 1,496.7 | 1,235.9 | -260.9 | -325.5 | 5 |
| edit | resent | 30,298.4 | 28,803.5 | -1,494.8 | -1,727.2 | 4 |
| edit | out | 503.8 | 528.0 | +24.2 | +41.5 | 9 |
| edit | cost | 0.000755 | 0.000728 | -0.000026 | -0.000016 | 5 |
| verify | req | 4.9 | 5.4 | +0.6 | +0.0 | 5 |
| verify | newIn | 3,845.2 | 3,804.9 | -40.3 | -22.7 | 6 |
| verify | resent | 133,564.0 | 144,936.9 | +11,372.9 | -8,457.0 | 4 |
| verify | out | 825.8 | 939.8 | +113.9 | -94.5 | 3 |
| verify | cost | 0.002216 | 0.002394 | +0.000178 | -0.000188 | 4 |
| narrate | req | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | newIn | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | resent | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | out | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | cost | 0.000000 | 0.000000 | +0.000000 | +0.000000 | 0 |
| finalize | req | 1.0 | 1.0 | +0.0 | +0.0 | 0 |
| finalize | newIn | 367.3 | 267.1 | -100.2 | -7.8 | 4 |
| finalize | resent | 28,615.4 | 26,590.4 | -2,025.0 | -2,214.5 | 3 |
| finalize | out | 116.2 | 123.2 | +7.1 | -0.2 | 6 |
| finalize | cost | 0.000393 | 0.000367 | -0.000026 | -0.000035 | 3 |
| TOTAL | req | 14.6 | 14.7 | +0.1 | -1.2 | 4 |
| TOTAL | newIn | 28,982.8 | 26,857.6 | -2,125.2 | -2,358.5 | 3 |
| TOTAL | resent | 315,589.5 | 314,164.8 | -1,424.7 | -44,984.0 | 4 |
| TOTAL | out | 2,560.9 | 2,512.2 | -48.6 | -238.8 | 4 |
| TOTAL | cost | 0.007591 | 0.007335 | -0.000256 | -0.000984 | 4 |

## Requests per rollout by phase (compact)
| phase | native | sweet | Δ | share of Δ total |
|---|---:|---:|---:|---:|
| localize | 2.89 | 3.56 | +0.67 | +480% |
| understand | 4.64 | 3.53 | -1.11 | -800% |
| edit | 1.19 | 1.22 | +0.03 | +20% |
| verify | 4.86 | 5.42 | +0.56 | +400% |
| narrate | 0.00 | 0.00 | +0.00 | +0% |
| finalize | 1.00 | 1.00 | +0.00 | +0% |
| TOTAL | 14.58 | 14.72 | +0.14 | +100% |

## Request classes per rollout, by phase (native / sweet)
| phase | edit | test | exec | delegate | read | search | git | poll | plan | other | text |
|---|---|---|---|---|---|---|---|---|---|---|---|
| localize | · | 0.08/0.36 | · | · | 1.25/0.22 | 0.36/1.61 | · | 0.08/0.08 | 1.11/1.28 | · | · |
| understand | · | 0.92/0.64 | 0.03/0.00 | · | 2.36/1.42 | 0.03/0.28 | · | 0.22/0.28 | 1.08/0.92 | · | · |
| edit | 1.19/1.22 | · | · | · | · | · | · | · | · | · | · |
| verify | · | 1.25/1.33 | · | · | 0.94/0.50 | 0.06/0.50 | 0.39/0.72 | 0.36/0.42 | 1.86/1.92 | 0.00/0.03 | · |
| narrate | · | · | · | · | · | · | · | · | · | · | · |
| finalize | · | · | · | · | · | · | · | · | · | · | 1.00/1.00 |

### Class deltas summed over phases (sweet − native requests per rollout)
| class | Δ req/rollout |
|---|---:|
| read | -2.42 |
| search | +1.94 |
| git | +0.33 |
| poll | +0.11 |
| test | +0.08 |
| plan | +0.06 |
| edit | +0.03 |
| exec | -0.03 |
| other | +0.03 |
| delegate | +0.00 |
| text | +0.00 |

## Arm-level facts
- native: requests 14.58/rollout, tool calls 13.58/rollout (0.93 calls/request); first-request context 14,276 tokens; error-bearing requests 0.03/rollout; failed-edit requests 0.00/rollout; rollouts that never READ the edited file 0/36; first_sight idx mean 1.75, first_read idx mean 3.11 (n=36), first_edit idx mean 7.53; sidechain files 0, sidechain requests 0.00/rollout (no-usage 0), sidechain cost 0.000000/rollout
- sweet: requests 14.72/rollout, tool calls 13.72/rollout (0.93 calls/request); first-request context 15,732 tokens; error-bearing requests 0.19/rollout; failed-edit requests 0.03/rollout; rollouts that never READ the edited file 1/36; first_sight idx mean 1.83, first_read idx mean 3.63 (n=35), first_edit idx mean 7.08; sidechain files 0, sidechain requests 0.00/rollout (no-usage 0), sidechain cost 0.000000/rollout

## Largest per-task per-phase request gaps (sweet − native, mean per rollout)
| task | phase | native | sweet | Δ | rollouts (native req by phase) | rollouts (sweet req by phase) |
|---|---|---:|---:|---:|---|---|
| apigee__registry-961 | verify | 8.33 | 13.67 | +5.33 | rep0:5; rep1:5; rep2:15 | rep0:9; rep1:7; rep2:25 |
| aws-actions__configure-aws-credentials-42 | verify | 5.67 | 10.33 | +4.67 | rep0:4; rep1:7; rep2:6 | rep0:10; rep1:12; rep2:9 |
| mirumee__ariadne-codegen-218 | understand | 4.33 | 0.67 | -3.67 | rep0:6; rep1:4; rep2:3 | rep0:2; rep1:0; rep2:0 |
| axelrod-python__axelrod-671 | understand | 4.67 | 1.67 | -3.00 | rep0:5; rep1:4; rep2:5 | rep0:1; rep1:3; rep2:1 |
| mirumee__ariadne-codegen-218 | localize | 3.00 | 6.00 | +3.00 | rep0:3; rep1:3; rep2:3 | rep0:5; rep1:8; rep2:5 |
| locationtech__jts-622 | localize | 1.33 | 4.00 | +2.67 | rep0:2; rep1:1; rep2:1 | rep0:3; rep1:6; rep2:3 |
| jazzband__tablib-454 | verify | 3.67 | 5.67 | +2.00 | rep0:4; rep1:3; rep2:4 | rep0:5; rep1:6; rep2:6 |
| callstack__react-native-paper-972 | understand | 5.00 | 3.00 | -2.00 | rep0:4; rep1:5; rep2:6 | rep0:2; rep1:4; rep2:3 |
| mathnet__mathnet-numerics-1072 | verify | 8.67 | 6.67 | -2.00 | rep0:9; rep1:12; rep2:5 | rep0:7; rep1:7; rep2:6 |
| mirumee__ariadne-codegen-218 | verify | 5.67 | 4.00 | -1.67 | rep0:3; rep1:7; rep2:7 | rep0:4; rep1:4; rep2:4 |
| absinthe-graphql__absinthe-998 | understand | 4.33 | 2.67 | -1.67 | rep0:3; rep1:5; rep2:5 | rep0:3; rep1:2; rep2:3 |
| celestiaorg__nmt-192 | understand | 5.67 | 4.33 | -1.33 | rep0:6; rep1:5; rep2:6 | rep0:5; rep1:4; rep2:4 |

## Per-task total requests per rollout (native | sweet | Δ) and cost
| task | req N | req S | Δ req | cost N | cost S | Δ cost |
|---|---:|---:|---:|---:|---:|---:|
| absinthe-graphql__absinthe-998 | 13.67 | 11.67 | -2.00 | 0.007727 | 0.006408 | -0.001319 |
| apigee__registry-961 | 26.33 | 31.67 | +5.33 | 0.016523 | 0.018798 | +0.002275 |
| asynkron__protoactor-dotnet-1909 | 13.00 | 12.33 | -0.67 | 0.005537 | 0.005364 | -0.000173 |
| aws-actions__configure-aws-credentials-42 | 16.00 | 22.00 | +6.00 | 0.007864 | 0.010011 | +0.002147 |
| axelrod-python__axelrod-671 | 12.33 | 8.67 | -3.67 | 0.005946 | 0.004789 | -0.001157 |
| callstack__react-native-paper-972 | 13.67 | 12.00 | -1.67 | 0.006865 | 0.005570 | -0.001294 |
| celestiaorg__nmt-192 | 13.33 | 12.33 | -1.00 | 0.006742 | 0.005709 | -0.001033 |
| final-form__final-form-64 | 12.33 | 11.00 | -1.33 | 0.006348 | 0.005413 | -0.000935 |
| jazzband__tablib-454 | 11.00 | 13.00 | +2.00 | 0.005322 | 0.006435 | +0.001113 |
| locationtech__jts-622 | 10.67 | 13.67 | +3.00 | 0.005250 | 0.005753 | +0.000503 |
| mathnet__mathnet-numerics-1072 | 17.67 | 15.67 | -2.00 | 0.009627 | 0.007813 | -0.001815 |
| mirumee__ariadne-codegen-218 | 15.00 | 12.67 | -2.33 | 0.007335 | 0.005954 | -0.001381 |


# opencode  runs={'run': 'fp-opencode-tab-20260826', 'repair': 'rp-oc-tab-20260827', 'repair_tasks': '/root/fresh-run/repair-tasks.txt'}  tasks=12  rollouts native=36 sweet=36  boundary=read
solved-everywhere tasks: absinthe-graphql__absinthe-998, apigee__registry-961, asynkron__protoactor-dotnet-1909, aws-actions__configure-aws-credentials-42, axelrod-python__axelrod-671, callstack__react-native-paper-972, celestiaorg__nmt-192, final-form__final-form-64, jazzband__tablib-454, locationtech__jts-622, mathnet__mathnet-numerics-1072, mirumee__ariadne-codegen-218

## Per-phase means per rollout (native | sweet | sweet-native mean over tasks | median | tasks S>N of 12)
| phase | metric | native | sweet | Δ mean | Δ median | S>N |
|---|---|---:|---:|---:|---:|---:|
| localize | req | 2.4 | 3.2 | +0.8 | +0.8 | 10 |
| localize | newIn | 8,560.0 | 10,368.9 | +1,809.0 | +2,198.7 | 11 |
| localize | resent | 13,446.1 | 21,814.5 | +8,368.4 | +8,711.7 | 11 |
| localize | out | 348.1 | 348.0 | -0.1 | +3.0 | 7 |
| localize | cost | 0.001199 | 0.001464 | +0.000265 | +0.000319 | 11 |
| understand | req | 3.8 | 3.2 | -0.6 | -0.8 | 3 |
| understand | newIn | 9,882.6 | 4,150.8 | -5,731.9 | -4,897.2 | 0 |
| understand | resent | 49,723.8 | 37,714.1 | -12,009.7 | -10,042.2 | 3 |
| understand | out | 563.4 | 498.8 | -64.6 | -141.0 | 4 |
| understand | cost | 0.001824 | 0.001091 | -0.000732 | -0.000705 | 2 |
| edit | req | 1.1 | 1.2 | +0.1 | +0.0 | 3 |
| edit | newIn | 1,283.7 | 1,929.1 | +645.4 | +203.8 | 8 |
| edit | resent | 21,997.3 | 20,152.9 | -1,844.4 | -1,913.3 | 4 |
| edit | out | 492.8 | 533.4 | +40.6 | +32.0 | 7 |
| edit | cost | 0.000644 | 0.000714 | +0.000070 | +0.000051 | 7 |
| verify | req | 4.3 | 5.1 | +0.9 | -0.2 | 4 |
| verify | newIn | 3,293.2 | 4,456.2 | +1,162.9 | -154.7 | 5 |
| verify | resent | 89,371.3 | 98,411.5 | +9,040.2 | -6,770.3 | 5 |
| verify | out | 805.5 | 798.9 | -6.7 | -100.2 | 5 |
| verify | cost | 0.001706 | 0.001909 | +0.000203 | -0.000206 | 4 |
| narrate | req | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | newIn | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | resent | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | out | 0.0 | 0.0 | +0.0 | +0.0 | 0 |
| narrate | cost | 0.000000 | 0.000000 | +0.000000 | +0.000000 | 0 |
| finalize | req | 1.0 | 1.0 | +0.0 | +0.0 | 0 |
| finalize | newIn | 420.9 | 400.7 | -20.2 | -23.5 | 6 |
| finalize | resent | 23,019.6 | 20,905.0 | -2,114.6 | -2,324.7 | 3 |
| finalize | out | 100.7 | 115.0 | +14.3 | +4.7 | 6 |
| finalize | cost | 0.000333 | 0.000318 | -0.000015 | -0.000020 | 3 |
| TOTAL | req | 12.6 | 13.8 | +1.2 | +0.5 | 7 |
| TOTAL | newIn | 23,440.4 | 21,305.7 | -2,134.7 | -2,245.2 | 2 |
| TOTAL | resent | 197,558.0 | 198,997.9 | +1,439.9 | -10,967.3 | 5 |
| TOTAL | out | 2,310.4 | 2,293.9 | -16.5 | -118.2 | 3 |
| TOTAL | cost | 0.005706 | 0.005497 | -0.000209 | -0.000412 | 3 |

## Requests per rollout by phase (compact)
| phase | native | sweet | Δ | share of Δ total |
|---|---:|---:|---:|---:|
| localize | 2.42 | 3.22 | +0.81 | +67% |
| understand | 3.78 | 3.22 | -0.56 | -47% |
| edit | 1.11 | 1.19 | +0.08 | +7% |
| verify | 4.28 | 5.14 | +0.86 | +72% |
| narrate | 0.00 | 0.00 | +0.00 | +0% |
| finalize | 1.00 | 1.00 | +0.00 | +0% |
| TOTAL | 12.58 | 13.78 | +1.19 | +100% |

## Request classes per rollout, by phase (native / sweet)
| phase | edit | test | exec | delegate | read | search | git | poll | plan | other | text |
|---|---|---|---|---|---|---|---|---|---|---|---|
| localize | · | 0.11/0.28 | · | · | 0.31/0.11 | 0.94/1.75 | · | · | 1.06/1.08 | · | · |
| understand | · | 0.89/0.72 | · | · | 1.47/1.47 | 0.33/0.25 | 0.03/0.03 | · | 1.06/0.75 | · | · |
| edit | 1.11/1.19 | · | · | · | · | · | · | · | · | · | · |
| verify | · | 1.17/1.22 | 0.00/0.03 | · | 0.33/0.53 | 0.31/0.33 | 0.47/1.00 | · | 2.00/2.00 | 0.00/0.03 | · |
| narrate | · | · | · | · | · | · | · | · | · | · | · |
| finalize | · | · | · | · | · | · | · | · | · | · | 1.00/1.00 |

### Class deltas summed over phases (sweet − native requests per rollout)
| class | Δ req/rollout |
|---|---:|
| search | +0.75 |
| git | +0.53 |
| plan | -0.28 |
| edit | +0.08 |
| test | +0.06 |
| exec | +0.03 |
| other | +0.03 |
| delegate | +0.00 |
| read | +0.00 |
| poll | +0.00 |
| text | +0.00 |

## Arm-level facts
- native: requests 12.58/rollout, tool calls 18.28/rollout (1.45 calls/request); first-request context 6,811 tokens; error-bearing requests 0.14/rollout; failed-edit requests 0.03/rollout; rollouts that never READ the edited file 0/36; first_sight idx mean 2.42, first_read idx mean 2.42 (n=36), first_edit idx mean 6.19; sidechain files 0, sidechain requests 0.00/rollout (no-usage 0), sidechain cost 0.000000/rollout
- sweet: requests 13.78/rollout, tool calls 14.64/rollout (1.06 calls/request); first-request context 8,268 tokens; error-bearing requests 0.00/rollout; failed-edit requests 0.00/rollout; rollouts that never READ the edited file 0/36; first_sight idx mean 1.44, first_read idx mean 3.36 (n=36), first_edit idx mean 6.44; sidechain files 0, sidechain requests 0.00/rollout (no-usage 0), sidechain cost 0.000000/rollout

## Largest per-task per-phase request gaps (sweet − native, mean per rollout)
| task | phase | native | sweet | Δ | rollouts (native req by phase) | rollouts (sweet req by phase) |
|---|---|---:|---:|---:|---|---|
| aws-actions__configure-aws-credentials-42 | verify | 4.33 | 13.00 | +8.67 | rep0:4; rep1:4; rep2:5 | rep0:12; rep1:11; rep2:16 |
| apigee__registry-961 | verify | 4.33 | 7.00 | +2.67 | rep0:5; rep1:4; rep2:4 | rep0:5; rep1:11; rep2:5 |
| aws-actions__configure-aws-credentials-42 | understand | 3.33 | 5.67 | +2.33 | rep0:4; rep1:3; rep2:3 | rep0:4; rep1:7; rep2:6 |
| apigee__registry-961 | localize | 6.33 | 8.67 | +2.33 | rep0:8; rep1:7; rep2:4 | rep0:8; rep1:9; rep2:9 |
| apigee__registry-961 | understand | 3.67 | 2.00 | -1.67 | rep0:2; rep1:4; rep2:5 | rep0:4; rep1:0; rep2:2 |
| callstack__react-native-paper-972 | understand | 5.00 | 3.33 | -1.67 | rep0:7; rep1:4; rep2:4 | rep0:3; rep1:4; rep2:3 |
| mathnet__mathnet-numerics-1072 | understand | 4.33 | 2.67 | -1.67 | rep0:7; rep1:3; rep2:3 | rep0:3; rep1:2; rep2:3 |
| absinthe-graphql__absinthe-998 | understand | 4.00 | 2.67 | -1.33 | rep0:3; rep1:5; rep2:4 | rep0:2; rep1:4; rep2:2 |
| locationtech__jts-622 | localize | 2.00 | 3.33 | +1.33 | rep0:2; rep1:2; rep2:2 | rep0:4; rep1:3; rep2:3 |
| absinthe-graphql__absinthe-998 | verify | 4.67 | 5.67 | +1.00 | rep0:5; rep1:4; rep2:5 | rep0:7; rep1:4; rep2:6 |
| asynkron__protoactor-dotnet-1909 | localize | 2.00 | 3.00 | +1.00 | rep0:2; rep1:2; rep2:2 | rep0:3; rep1:3; rep2:3 |
| aws-actions__configure-aws-credentials-42 | localize | 2.00 | 3.00 | +1.00 | rep0:2; rep1:2; rep2:2 | rep0:3; rep1:3; rep2:3 |

## Per-task total requests per rollout (native | sweet | Δ) and cost
| task | req N | req S | Δ req | cost N | cost S | Δ cost |
|---|---:|---:|---:|---:|---:|---:|
| absinthe-graphql__absinthe-998 | 13.00 | 13.33 | +0.33 | 0.006180 | 0.006404 | +0.000223 |
| apigee__registry-961 | 17.00 | 20.67 | +3.67 | 0.012081 | 0.010970 | -0.001111 |
| asynkron__protoactor-dotnet-1909 | 12.67 | 12.67 | +0.00 | 0.004220 | 0.004059 | -0.000162 |
| aws-actions__configure-aws-credentials-42 | 12.00 | 24.33 | +12.33 | 0.005442 | 0.010594 | +0.005152 |
| axelrod-python__axelrod-671 | 11.00 | 11.67 | +0.67 | 0.004291 | 0.004041 | -0.000250 |
| callstack__react-native-paper-972 | 13.67 | 12.33 | -1.33 | 0.004952 | 0.004377 | -0.000574 |
| celestiaorg__nmt-192 | 11.67 | 10.33 | -1.33 | 0.004809 | 0.003593 | -0.001216 |
| final-form__final-form-64 | 11.00 | 11.67 | +0.67 | 0.004937 | 0.003976 | -0.000961 |
| jazzband__tablib-454 | 12.00 | 13.00 | +1.00 | 0.004477 | 0.004581 | +0.000104 |
| locationtech__jts-622 | 11.00 | 12.67 | +1.67 | 0.004275 | 0.004109 | -0.000167 |
| mathnet__mathnet-numerics-1072 | 14.00 | 11.33 | -2.67 | 0.007092 | 0.004638 | -0.002454 |
| mirumee__ariadne-codegen-218 | 12.00 | 11.33 | -0.67 | 0.005714 | 0.004622 | -0.001092 |


# claude-code  runs={'run': 'fp-claudecode-tab-20260826'}  tasks=11  rollouts native=33 sweet=33  boundary=read
solved-everywhere tasks: absinthe-graphql__absinthe-998, apigee__registry-961, asynkron__protoactor-dotnet-1909, aws-actions__configure-aws-credentials-42, axelrod-python__axelrod-671, callstack__react-native-paper-972, final-form__final-form-64, jazzband__tablib-454, locationtech__jts-622, mathnet__mathnet-numerics-1072, mirumee__ariadne-codegen-218

## Per-phase means per rollout (native | sweet | sweet-native mean over tasks | median | tasks S>N of 11)
| phase | metric | native | sweet | Δ mean | Δ median | S>N |
|---|---|---:|---:|---:|---:|---:|
| localize | req | 3.2 | 3.8 | +0.5 | +0.3 | 7 |
| localize | newIn | 19,830.0 | 21,929.9 | +2,099.8 | +2,569.3 | 10 |
| localize | resent | 43,525.7 | 58,288.8 | +14,763.1 | +13,229.7 | 8 |
| localize | out | 305.8 | 376.9 | +71.0 | +77.3 | 8 |
| localize | cost | 0.002602 | 0.003002 | +0.000400 | +0.000486 | 8 |
| understand | req | 4.5 | 3.2 | -1.3 | -1.3 | 1 |
| understand | newIn | 5,474.1 | 3,645.2 | -1,828.9 | -1,585.3 | 1 |
| understand | resent | 99,105.2 | 80,403.5 | -18,701.7 | -31,434.7 | 2 |
| understand | out | 568.6 | 377.5 | -191.2 | -102.7 | 4 |
| understand | cost | 0.001880 | 0.001395 | -0.000485 | -0.000549 | 1 |
| edit | req | 2.6 | 2.3 | -0.3 | +0.0 | 3 |
| edit | newIn | 2,521.5 | 1,981.0 | -540.5 | -462.0 | 3 |
| edit | resent | 84,253.3 | 75,311.6 | -8,941.6 | +1,057.0 | 6 |
| edit | out | 961.3 | 881.7 | -79.6 | -10.0 | 5 |
| edit | cost | 0.001671 | 0.001480 | -0.000191 | -0.000020 | 5 |
| verify | req | 4.2 | 5.3 | +1.0 | +0.0 | 5 |
| verify | newIn | 2,528.5 | 3,046.3 | +517.8 | +25.0 | 6 |
| verify | resent | 130,805.9 | 152,156.8 | +21,350.9 | +3,797.3 | 6 |
| verify | out | 584.3 | 971.9 | +387.6 | -5.0 | 5 |
| verify | cost | 0.001911 | 0.002409 | +0.000498 | +0.000037 | 6 |
| narrate | req | 0.1 | 0.0 | -0.1 | +0.0 | 0 |
| narrate | newIn | 32.4 | 0.0 | -32.4 | +0.0 | 0 |
| narrate | resent | 1,529.5 | 0.0 | -1,529.5 | +0.0 | 0 |
| narrate | out | 52.8 | 0.0 | -52.8 | +0.0 | 0 |
| narrate | cost | 0.000050 | 0.000000 | -0.000050 | +0.000000 | 0 |
| finalize | req | 1.0 | 1.1 | +0.1 | +0.0 | 1 |
| finalize | newIn | 415.1 | 352.2 | -62.9 | -79.3 | 4 |
| finalize | resent | 31,523.9 | 33,320.5 | +1,796.5 | +506.0 | 6 |
| finalize | out | 257.5 | 255.5 | -2.0 | -28.0 | 5 |
| finalize | cost | 0.000511 | 0.000522 | +0.000010 | -0.000026 | 3 |
| TOTAL | req | 15.7 | 15.7 | -0.0 | -1.0 | 3 |
| TOTAL | newIn | 30,801.5 | 30,954.5 | +153.0 | -117.7 | 5 |
| TOTAL | resent | 390,743.5 | 399,481.2 | +8,737.8 | -17,481.3 | 4 |
| TOTAL | out | 2,730.4 | 2,863.5 | +133.1 | -99.3 | 4 |
| TOTAL | cost | 0.008626 | 0.008808 | +0.000183 | -0.000193 | 5 |

## Requests per rollout by phase (compact)
| phase | native | sweet | Δ | share of Δ total |
|---|---:|---:|---:|---:|
| localize | 3.24 | 3.79 | +0.55 | -1800% |
| understand | 4.48 | 3.21 | -1.27 | +4200% |
| edit | 2.64 | 2.30 | -0.33 | +1100% |
| verify | 4.24 | 5.27 | +1.03 | -3400% |
| narrate | 0.06 | 0.00 | -0.06 | +200% |
| finalize | 1.03 | 1.09 | +0.06 | -200% |
| TOTAL | 15.70 | 15.67 | -0.03 | +100% |

## Request classes per rollout, by phase (native / sweet)
| phase | edit | test | exec | delegate | read | search | git | poll | plan | other | text |
|---|---|---|---|---|---|---|---|---|---|---|---|
| localize | · | 0.82/0.73 | · | 0.21/0.03 | 0.88/0.21 | 0.45/1.97 | · | · | 0.88/0.85 | · | · |
| understand | · | 0.18/0.27 | · | · | 4.21/2.30 | 0.06/0.61 | · | · | 0.03/0.03 | · | · |
| edit | 2.64/2.30 | · | · | · | · | · | · | · | · | · | · |
| verify | · | 1.36/1.39 | 0.03/0.00 | · | 0.88/0.61 | 0.15/1.61 | 0.88/0.64 | 0.06/0.00 | 0.88/1.00 | 0.00/0.03 | · |
| narrate | · | · | · | · | · | · | · | · | · | · | 0.06/0.00 |
| finalize | · | · | · | · | · | · | · | · | · | · | 1.03/1.09 |

### Class deltas summed over phases (sweet − native requests per rollout)
| class | Δ req/rollout |
|---|---:|
| search | +3.52 |
| read | -2.85 |
| edit | -0.33 |
| git | -0.24 |
| delegate | -0.18 |
| plan | +0.09 |
| poll | -0.06 |
| test | +0.03 |
| exec | -0.03 |
| other | +0.03 |
| text | -0.00 |

## Arm-level facts
- native: requests 15.70/rollout, tool calls 16.36/rollout (1.04 calls/request); first-request context 17,579 tokens; error-bearing requests 2.03/rollout; failed-edit requests 0.36/rollout; rollouts that never READ the edited file 0/33; first_sight idx mean 2.61, first_read idx mean 3.24 (n=33), first_edit idx mean 7.73; sidechain files 7, sidechain requests 2.67/rollout (no-usage 0), sidechain cost 0.002070/rollout
- sweet: requests 15.67/rollout, tool calls 14.67/rollout (0.94 calls/request); first-request context 19,149 tokens; error-bearing requests 1.36/rollout; failed-edit requests 0.58/rollout; rollouts that never READ the edited file 2/33; first_sight idx mean 1.82, first_read idx mean 3.71 (n=31), first_edit idx mean 7.00; sidechain files 2, sidechain requests 0.88/rollout (no-usage 0), sidechain cost 0.000964/rollout

## Largest per-task per-phase request gaps (sweet − native, mean per rollout)
| task | phase | native | sweet | Δ | rollouts (native req by phase) | rollouts (sweet req by phase) |
|---|---|---:|---:|---:|---|---|
| callstack__react-native-paper-972 | verify | 4.33 | 11.67 | +7.33 | rep0:2; rep1:7; rep2:4 | rep0:9; rep1:3; rep2:23 |
| aws-actions__configure-aws-credentials-42 | verify | 6.33 | 12.33 | +6.00 | rep0:3; rep1:6; rep2:10 | rep0:14; rep1:15; rep2:8 |
| jazzband__tablib-454 | verify | 2.00 | 6.67 | +4.67 | rep0:2; rep1:1; rep2:3 | rep0:5; rep1:7; rep2:8 |
| aws-actions__configure-aws-credentials-42 | edit | 7.33 | 3.00 | -4.33 | rep0:5; rep1:5; rep2:12 | rep0:3; rep1:3; rep2:3 |
| aws-actions__configure-aws-credentials-42 | understand | 6.00 | 2.67 | -3.33 | rep0:6; rep1:8; rep2:4 | rep0:4; rep1:1; rep2:3 |
| axelrod-python__axelrod-671 | verify | 6.00 | 2.67 | -3.33 | rep0:10; rep1:5; rep2:3 | rep0:2; rep1:2; rep2:4 |
| locationtech__jts-622 | understand | 7.00 | 4.33 | -2.67 | rep0:9; rep1:8; rep2:4 | rep0:6; rep1:2; rep2:5 |
| apigee__registry-961 | verify | 7.00 | 4.67 | -2.33 | rep0:11; rep1:6; rep2:4 | rep0:5; rep1:3; rep2:6 |
| callstack__react-native-paper-972 | localize | 1.67 | 4.00 | +2.33 | rep0:1; rep1:3; rep2:1 | rep0:4; rep1:5; rep2:3 |
| apigee__registry-961 | localize | 7.33 | 9.33 | +2.00 | rep0:9; rep1:3; rep2:10 | rep0:11; rep1:11; rep2:6 |
| mathnet__mathnet-numerics-1072 | verify | 6.33 | 8.33 | +2.00 | rep0:4; rep1:6; rep2:9 | rep0:9; rep1:7; rep2:9 |
| absinthe-graphql__absinthe-998 | understand | 5.00 | 3.00 | -2.00 | rep0:6; rep1:3; rep2:6 | rep0:3; rep1:2; rep2:4 |

## Per-task total requests per rollout (native | sweet | Δ) and cost
| task | req N | req S | Δ req | cost N | cost S | Δ cost |
|---|---:|---:|---:|---:|---:|---:|
| absinthe-graphql__absinthe-998 | 12.33 | 10.33 | -2.00 | 0.006713 | 0.006195 | -0.000518 |
| apigee__registry-961 | 28.33 | 30.33 | +2.00 | 0.020418 | 0.020654 | +0.000235 |
| asynkron__protoactor-dotnet-1909 | 11.00 | 9.33 | -1.67 | 0.005087 | 0.004894 | -0.000193 |
| aws-actions__configure-aws-credentials-42 | 25.00 | 22.00 | -3.00 | 0.012095 | 0.009894 | -0.002201 |
| axelrod-python__axelrod-671 | 16.00 | 11.00 | -5.00 | 0.008210 | 0.005989 | -0.002221 |
| callstack__react-native-paper-972 | 14.00 | 22.33 | +8.33 | 0.007279 | 0.011377 | +0.004099 |
| final-form__final-form-64 | 14.00 | 14.00 | +0.00 | 0.007511 | 0.007060 | -0.000451 |
| jazzband__tablib-454 | 9.67 | 14.67 | +5.00 | 0.005518 | 0.008703 | +0.003185 |
| locationtech__jts-622 | 12.00 | 11.00 | -1.00 | 0.005384 | 0.005687 | +0.000304 |
| mathnet__mathnet-numerics-1072 | 18.33 | 17.33 | -1.00 | 0.010176 | 0.010658 | +0.000482 |
| mirumee__ariadne-codegen-218 | 12.00 | 10.00 | -2.00 | 0.006493 | 0.005780 | -0.000713 |
