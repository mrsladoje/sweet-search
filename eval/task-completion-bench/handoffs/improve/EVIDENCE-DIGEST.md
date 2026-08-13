# EVIDENCE PACK — 204 rollouts, 17 DEV-RET tasks x 2 arms x 2 reps x 3 harnesses (2026-08-11)
# All numbers below are DERIVED FROM THE ARTIFACTS, not copied from prose.

## A. COST — paired break-priced, per harness (negative = sweet CHEAPER)
| harness | both-solved n | both-solved % | all-paired n | all-paired % | sum native $ | sum sweet $ |
|---|---|---|---|---|---|---|
| codex | 9 | -9.6% | 17 | -6.5% | 0.1447 | 0.1353 |
| opencode | 8 | -15.7% | 17 | -17.8% | 0.1354 | 0.1114 |
| claude-code | 8 | 0.2% | 17 | 2.4% | 0.1992 | 0.2040 |

## B. SOLVE — task counts (a task counts SOLVED if any rep resolved)
| harness | native | sweet | both | native-only | sweet-only | neither |
|---|---|---|---|---|---|---|
| codex | 9/17 | 10/17 | 9 | 0 | 1 | 7 |
| opencode | 9/17 | 9/17 | 8 | 1 | 1 | 7 |
| claude-code | 9/17 | 9/17 | 8 | 1 | 1 | 7 |

### Per-REP solve detail (exposes coin-flip tasks: 1/2 means one rep solved)
| task | codex n/s | opencode n/s | claude-code n/s |
|---|---|---|---|
| akinsho__nvim-bufferline.lua-173 | 2/2 vs 2/2 | 2/2 vs 2/2 | 2/2 vs 1/2 |
| apple__swift-nio-http2-145 | 0/2 vs 0/2 | 0/2 vs 0/2 | 0/2 vs 0/2 |
| codeception__codeceptjs-367 | 0/2 vs 0/2 | 0/2 vs 0/2 | 0/2 vs 0/2 |
| dart-lang__http-1114 | 0/2 vs 0/2 | 0/2 vs 0/2 | 0/2 vs 0/2 |
| dashbitco__nimble_options-43 | 0/2 vs 0/2 | 0/2 vs 0/2 | 0/2 vs 1/2 |
| dotnet__yarp-2825 | 0/2 vs 0/2 | 0/2 vs 0/2 | 0/2 vs 0/2 |
| epiforecasts__scoringutils-229 | 2/2 vs 2/2 | 2/2 vs 2/2 | 2/2 vs 2/2 |
| jashkenas__underscore-2757 | 2/2 vs 2/2 | 2/2 vs 2/2 | 0/2 vs 0/2 |
| joshuakgoldberg__bingo-274 | 0/2 vs 0/2 | 0/2 vs 0/2 | 0/2 vs 0/2 |
| mransan__ocaml-protoc-202 | 0/2 vs 0/2 | 0/2 vs 0/2 | 0/2 vs 0/2 |
| oceanparcels__parcels-617 | 2/2 vs 2/2 | 2/2 vs 2/2 | 2/2 vs 2/2 |
| ontodev__robot-710 | 2/2 vs 2/2 | 2/2 vs 2/2 | 2/2 vs 2/2 |
| pytask-dev__pytask-210 | 0/2 vs 2/2 | 1/2 vs 0/2 | 1/2 vs 0/2 |
| redboltz__mqtt_cpp-466 | 2/2 vs 2/2 | 2/2 vs 2/2 | 2/2 vs 2/2 |
| rstudio-education__gradethis-161 | 2/2 vs 2/2 | 2/2 vs 2/2 | 1/2 vs 1/2 |
| statamic__cms-9029 | 2/2 vs 2/2 | 2/2 vs 2/2 | 2/2 vs 2/2 |
| teleporthq__teleport-code-generators-291 | 2/2 vs 1/2 | 0/2 vs 1/2 | 1/2 vs 1/2 |

## C. COST MECHANICS — per harness x arm means (turn-level, derived from turns/*.jsonl)
| harness | arm | calls | ss-* | grep | turn-1 in | turn-1 UNCACHED | growth | out tok | turns | cache-breaks | ctxRewrites | break-priced $ | ideal $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| codex | native | 7.5 | 0.0 | 1.6 | 13277 | 4467 | 18628 | 4024 | 11.9 | 0.24 | 0.00 | 0.0085 | 0.0085 |
| codex | sweet | 9.3 | 6.5 | 0.0 | 14734 | 5337 | 14095 | 4145 | 12.1 | 0.12 | 0.00 | 0.0080 | 0.0080 |
| opencode | native | 22.8 | 0.0 | 5.6 | 6911 | 6911 | 22134 | 3655 | 15.7 | 0.00 | 0.00 | 0.0080 | 0.0080 |
| opencode | sweet | 17.0 | 8.2 | 0.1 | 8368 | 8368 | 14818 | 2901 | 14.4 | 0.00 | 0.00 | 0.0066 | 0.0066 |
| claude-code | native | 29.5 | 0.0 | 4.1 | 17630 | 17630 | 17022 | 6226 | 20.0 | 0.00 | 0.00 | 0.0117 | 0.0117 |
| claude-code | sweet | 19.7 | 8.6 | 0.2 | 19217 | 19217 | 15074 | 3176 | 17.7 | 0.00 | 0.00 | 0.0120 | 0.0120 |

### Exit reasons (ALL cells) — confirms "no doomed tail"
- codex/native: {"model_stopped":34}
- codex/sweet: {"model_stopped":34}
- opencode/native: {"model_stopped":34}
- opencode/sweet: {"model_stopped":34}
- claude-code/native: {"model_stopped":34}
- claude-code/sweet: {"model_stopped":34}

### Tool composition totals (sum over all cells)
- codex/native: {"ss":0,"nativeGrep":53,"nativeRead":86,"edit":0,"bash":46,"test":71}
- codex/sweet: {"ss":220,"nativeGrep":1,"nativeRead":0,"edit":0,"bash":15,"test":79}
- opencode/native: {"ss":0,"nativeGrep":191,"nativeRead":247,"edit":0,"bash":251,"test":86}
- opencode/sweet: {"ss":280,"nativeGrep":4,"nativeRead":0,"edit":0,"bash":219,"test":74}
- claude-code/native: {"ss":0,"nativeGrep":141,"nativeRead":403,"edit":150,"bash":216,"test":93}
- claude-code/sweet: {"ss":294,"nativeGrep":6,"nativeRead":38,"edit":141,"bash":102,"test":88}

## D. PER-TASK break-priced cost, mean over reps ($; pct = sweet vs native)
| task | harness | native $ | sweet $ | delta $ | pct | n calls | s calls | n ss | s grep->0? | solved n/s |
|---|---|---|---|---|---|---|---|---|---|---|
| akinsho__nvim-bufferline.lua-173 | codex | 0.0072 | 0.0072 | 0.0000 | 0.7% | 6.5 | 7.5 | 5.0 | 0.5 | 2/2 |
| akinsho__nvim-bufferline.lua-173 | opencode | 0.0076 | 0.0056 | -0.0019 | -25.8% | 21.5 | 13.5 | 6.0 | 0.0 | 2/2 |
| akinsho__nvim-bufferline.lua-173 | claude-code | 0.0123 | 0.0074 | -0.0049 | -40.1% | 40.5 | 10.5 | 6.0 | 0.0 | 2/1 |
| apple__swift-nio-http2-145 | codex | 0.0106 | 0.0056 | -0.0049 | -46.5% | 7.5 | 6.0 | 3.0 | 0.0 | 0/0 |
| apple__swift-nio-http2-145 | opencode | 0.0088 | 0.0081 | -0.0006 | -7.1% | 19.5 | 16.0 | 8.0 | 0.0 | 0/0 |
| apple__swift-nio-http2-145 | claude-code | 0.0158 | 0.0117 | -0.0041 | -26.1% | 21.5 | 15.0 | 9.0 | 0.0 | 0/0 |
| codeception__codeceptjs-367 | codex | 0.0065 | 0.0053 | -0.0011 | -17.7% | 7.0 | 7.0 | 5.5 | 0.0 | 0/0 |
| codeception__codeceptjs-367 | opencode | 0.0086 | 0.0075 | -0.0011 | -12.9% | 30.0 | 21.0 | 10.5 | 0.5 | 0/0 |
| codeception__codeceptjs-367 | claude-code | 0.0086 | 0.0061 | -0.0025 | -28.8% | 46.0 | 11.5 | 5.5 | 0.0 | 0/0 |
| dart-lang__http-1114 | codex | 0.0199 | 0.0175 | -0.0024 | -12.1% | 12.0 | 19.0 | 14.5 | 0.0 | 0/0 |
| dart-lang__http-1114 | opencode | 0.0169 | 0.0145 | -0.0024 | -14.1% | 38.0 | 36.0 | 20.0 | 0.0 | 0/0 |
| dart-lang__http-1114 | claude-code | 0.0240 | 0.0353 | 0.0112 | 46.7% | 53.5 | 73.0 | 24.5 | 0.5 | 0/0 |
| dashbitco__nimble_options-43 | codex | 0.0064 | 0.0097 | 0.0033 | 52.1% | 6.5 | 12.5 | 8.0 | 0.0 | 0/0 |
| dashbitco__nimble_options-43 | opencode | 0.0064 | 0.0060 | -0.0004 | -6.3% | 17.0 | 16.5 | 6.0 | 0.0 | 0/0 |
| dashbitco__nimble_options-43 | claude-code | 0.0110 | 0.0108 | -0.0001 | -1.2% | 22.5 | 20.5 | 5.5 | 0.0 | 0/1 |
| dotnet__yarp-2825 | codex | 0.0062 | 0.0060 | -0.0002 | -2.7% | 5.5 | 7.0 | 4.5 | 0.0 | 0/0 |
| dotnet__yarp-2825 | opencode | 0.0060 | 0.0065 | 0.0005 | 8.5% | 17.0 | 18.0 | 9.5 | 0.0 | 0/0 |
| dotnet__yarp-2825 | claude-code | 0.0123 | 0.0100 | -0.0023 | -18.4% | 42.0 | 17.5 | 9.0 | 0.0 | 0/0 |
| epiforecasts__scoringutils-229 | codex | 0.0042 | 0.0046 | 0.0004 | 9.4% | 3.5 | 4.5 | 2.0 | 0.0 | 2/2 |
| epiforecasts__scoringutils-229 | opencode | 0.0050 | 0.0036 | -0.0013 | -26.7% | 15.5 | 10.0 | 2.0 | 0.0 | 2/2 |
| epiforecasts__scoringutils-229 | claude-code | 0.0041 | 0.0044 | 0.0003 | 6.5% | 7.0 | 7.0 | 2.0 | 0.0 | 2/2 |
| jashkenas__underscore-2757 | codex | 0.0078 | 0.0065 | -0.0014 | -17.3% | 8.5 | 8.5 | 6.0 | 0.0 | 2/2 |
| jashkenas__underscore-2757 | opencode | 0.0062 | 0.0067 | 0.0005 | 8.4% | 21.5 | 19.5 | 9.5 | 0.0 | 2/2 |
| jashkenas__underscore-2757 | claude-code | 0.0056 | 0.0078 | 0.0022 | 38.4% | 11.5 | 14.5 | 9.0 | 0.0 | 0/0 |
| joshuakgoldberg__bingo-274 | codex | 0.0078 | 0.0070 | -0.0007 | -9.2% | 6.5 | 8.5 | 6.0 | 0.0 | 0/0 |
| joshuakgoldberg__bingo-274 | opencode | 0.0076 | 0.0067 | -0.0010 | -12.5% | 27.0 | 18.5 | 11.0 | 0.0 | 0/0 |
| joshuakgoldberg__bingo-274 | claude-code | 0.0103 | 0.0095 | -0.0008 | -7.7% | 23.0 | 19.0 | 11.5 | 0.0 | 0/0 |
| mransan__ocaml-protoc-202 | codex | 0.0107 | 0.0130 | 0.0023 | 21.9% | 8.5 | 14.0 | 10.0 | 0.0 | 0/0 |
| mransan__ocaml-protoc-202 | opencode | 0.0072 | 0.0009 | -0.0063 | -88.0% | 18.0 | 0.0 | 0.0 | 0.0 | 0/0 |
| mransan__ocaml-protoc-202 | claude-code | 0.0073 | 0.0060 | -0.0012 | -16.9% | 36.0 | 21.5 | 4.0 | 2.5 | 0/0 |
| oceanparcels__parcels-617 | codex | 0.0093 | 0.0049 | -0.0043 | -46.6% | 7.0 | 4.5 | 3.5 | 0.0 | 2/2 |
| oceanparcels__parcels-617 | opencode | 0.0070 | 0.0055 | -0.0015 | -21.3% | 18.0 | 13.0 | 5.0 | 0.0 | 2/2 |
| oceanparcels__parcels-617 | claude-code | 0.0069 | 0.0079 | 0.0010 | 14.4% | 24.0 | 11.5 | 6.0 | 0.0 | 2/2 |
| ontodev__robot-710 | codex | 0.0086 | 0.0066 | -0.0020 | -23.0% | 9.0 | 7.5 | 5.5 | 0.0 | 2/2 |
| ontodev__robot-710 | opencode | 0.0079 | 0.0061 | -0.0019 | -23.4% | 21.5 | 13.0 | 5.5 | 0.0 | 2/2 |
| ontodev__robot-710 | claude-code | 0.0068 | 0.0085 | 0.0017 | 25.5% | 20.5 | 12.0 | 6.5 | 0.0 | 2/2 |
| pytask-dev__pytask-210 | codex | 0.0052 | 0.0064 | 0.0012 | 23.9% | 5.5 | 7.5 | 5.0 | 0.0 | 0/2 |
| pytask-dev__pytask-210 | opencode | 0.0056 | 0.0034 | -0.0022 | -39.3% | 20.0 | 11.5 | 2.0 | 0.0 | 1/0 |
| pytask-dev__pytask-210 | claude-code | 0.0243 | 0.0265 | 0.0022 | 9.0% | 32.0 | 12.5 | 5.0 | 0.0 | 1/0 |
| redboltz__mqtt_cpp-466 | codex | 0.0058 | 0.0055 | -0.0003 | -5.1% | 9.0 | 6.5 | 4.0 | 0.0 | 2/2 |
| redboltz__mqtt_cpp-466 | opencode | 0.0057 | 0.0048 | -0.0009 | -16.4% | 19.0 | 15.0 | 5.5 | 0.0 | 2/2 |
| redboltz__mqtt_cpp-466 | claude-code | 0.0060 | 0.0064 | 0.0004 | 6.4% | 14.0 | 11.0 | 5.5 | 0.0 | 2/2 |
| rstudio-education__gradethis-161 | codex | 0.0143 | 0.0138 | -0.0005 | -3.4% | 13.0 | 17.0 | 13.5 | 0.0 | 2/2 |
| rstudio-education__gradethis-161 | opencode | 0.0142 | 0.0122 | -0.0019 | -13.7% | 37.5 | 26.5 | 17.5 | 0.0 | 2/2 |
| rstudio-education__gradethis-161 | claude-code | 0.0237 | 0.0268 | 0.0031 | 12.9% | 48.0 | 45.5 | 18.5 | 0.0 | 1/1 |
| statamic__cms-9029 | codex | 0.0097 | 0.0091 | -0.0006 | -6.3% | 7.0 | 12.0 | 10.0 | 0.0 | 2/2 |
| statamic__cms-9029 | opencode | 0.0097 | 0.0087 | -0.0010 | -9.9% | 27.0 | 26.5 | 16.0 | 1.5 | 2/2 |
| statamic__cms-9029 | claude-code | 0.0134 | 0.0131 | -0.0004 | -2.7% | 44.0 | 20.5 | 14.0 | 0.0 | 2/2 |
| teleporthq__teleport-code-generators-291 | codex | 0.0048 | 0.0065 | 0.0017 | 35.9% | 5.5 | 8.0 | 4.0 | 0.0 | 2/1 |
| teleporthq__teleport-code-generators-291 | opencode | 0.0053 | 0.0046 | -0.0007 | -12.4% | 19.5 | 14.0 | 6.0 | 0.0 | 0/1 |
| teleporthq__teleport-code-generators-291 | claude-code | 0.0069 | 0.0059 | -0.0009 | -13.7% | 15.5 | 11.5 | 5.5 | 0.0 | 1/1 |

## E. LOCALIZATION vs GOLD — final patch file sets (per harness x arm)
| task | gold files | gold hunks | lang | h | arm | got | hit | wrong | class | resolved |
|---|---|---|---|---|---|---|---|---|---|---|
| akinsho__nvim-bufferline.lua-173 | 1 | 3 | lua | codex | native | 1 | 1 | 0 | loc-ALL | true |
| akinsho__nvim-bufferline.lua-173 | 1 | 3 | lua | codex | sweet | 1 | 1 | 0 | loc-ALL | true |
| akinsho__nvim-bufferline.lua-173 | 1 | 3 | lua | opencode | native | 1 | 1 | 0 | loc-ALL | true |
| akinsho__nvim-bufferline.lua-173 | 1 | 3 | lua | opencode | sweet | 1 | 1 | 0 | loc-ALL | true |
| akinsho__nvim-bufferline.lua-173 | 1 | 3 | lua | claude-code | native | 1 | 1 | 0 | loc-ALL | true |
| akinsho__nvim-bufferline.lua-173 | 1 | 3 | lua | claude-code | sweet | 1 | 1 | 0 | loc-ALL | true |
| apple__swift-nio-http2-145 | 1 | 3 | swift | codex | native | 1 | 1 | 0 | loc-ALL | false |
| apple__swift-nio-http2-145 | 1 | 3 | swift | codex | sweet | 1 | 1 | 0 | loc-ALL | false |
| apple__swift-nio-http2-145 | 1 | 3 | swift | opencode | native | 1 | 1 | 0 | loc-ALL | false |
| apple__swift-nio-http2-145 | 1 | 3 | swift | opencode | sweet | 1 | 1 | 0 | loc-ALL | false |
| apple__swift-nio-http2-145 | 1 | 3 | swift | claude-code | native | 1 | 1 | 0 | loc-ALL | false |
| apple__swift-nio-http2-145 | 1 | 3 | swift | claude-code | sweet | 1 | 1 | 0 | loc-ALL | false |
| codeception__codeceptjs-367 | 3 | 5 | js | codex | native | 1 | 0 | 1 | WRONG-LOC | false |
| codeception__codeceptjs-367 | 3 | 5 | js | codex | sweet | 1 | 0 | 1 | WRONG-LOC | false |
| codeception__codeceptjs-367 | 3 | 5 | js | opencode | native | 1 | 0 | 1 | WRONG-LOC | false |
| codeception__codeceptjs-367 | 3 | 5 | js | opencode | sweet | 1 | 0 | 1 | WRONG-LOC | false |
| codeception__codeceptjs-367 | 3 | 5 | js | claude-code | native | 1 | 1 | 0 | loc-some | false |
| codeception__codeceptjs-367 | 3 | 5 | js | claude-code | sweet | 1 | 0 | 1 | WRONG-LOC | false |
| dart-lang__http-1114 | 4 | 5 | dart | codex | native | 9 | 1 | 8 | loc-some | false |
| dart-lang__http-1114 | 4 | 5 | dart | codex | sweet | 7 | 1 | 6 | loc-some | false |
| dart-lang__http-1114 | 4 | 5 | dart | opencode | native | 6 | 1 | 5 | loc-some | false |
| dart-lang__http-1114 | 4 | 5 | dart | opencode | sweet | 7 | 1 | 6 | loc-some | false |
| dart-lang__http-1114 | 4 | 5 | dart | claude-code | native | 8 | 2 | 6 | loc-some | false |
| dart-lang__http-1114 | 4 | 5 | dart | claude-code | sweet | 7 | 1 | 6 | loc-some | false |
| dashbitco__nimble_options-43 | 1 | 3 | elixir | codex | native | 1 | 1 | 0 | loc-ALL | false |
| dashbitco__nimble_options-43 | 1 | 3 | elixir | codex | sweet | 1 | 1 | 0 | loc-ALL | false |
| dashbitco__nimble_options-43 | 1 | 3 | elixir | opencode | native | 1 | 1 | 0 | loc-ALL | false |
| dashbitco__nimble_options-43 | 1 | 3 | elixir | opencode | sweet | 1 | 1 | 0 | loc-ALL | false |
| dashbitco__nimble_options-43 | 1 | 3 | elixir | claude-code | native | 1 | 1 | 0 | loc-ALL | false |
| dashbitco__nimble_options-43 | 1 | 3 | elixir | claude-code | sweet | 1 | 1 | 0 | loc-ALL | true |
| dotnet__yarp-2825 | 1 | 2 | csharp | codex | native | 1 | 1 | 0 | loc-ALL | false |
| dotnet__yarp-2825 | 1 | 2 | csharp | codex | sweet | 1 | 1 | 0 | loc-ALL | false |
| dotnet__yarp-2825 | 1 | 2 | csharp | opencode | native | 1 | 1 | 0 | loc-ALL | false |
| dotnet__yarp-2825 | 1 | 2 | csharp | opencode | sweet | 1 | 1 | 0 | loc-ALL | false |
| dotnet__yarp-2825 | 1 | 2 | csharp | claude-code | native | 1 | 1 | 0 | loc-ALL | false |
| dotnet__yarp-2825 | 1 | 2 | csharp | claude-code | sweet | 1 | 1 | 0 | loc-ALL | false |
| epiforecasts__scoringutils-229 | 1 | 1 | r | codex | native | 1 | 1 | 0 | loc-ALL | true |
| epiforecasts__scoringutils-229 | 1 | 1 | r | codex | sweet | 1 | 1 | 0 | loc-ALL | true |
| epiforecasts__scoringutils-229 | 1 | 1 | r | opencode | native | 1 | 1 | 0 | loc-ALL | true |
| epiforecasts__scoringutils-229 | 1 | 1 | r | opencode | sweet | 1 | 1 | 0 | loc-ALL | true |
| epiforecasts__scoringutils-229 | 1 | 1 | r | claude-code | native | 1 | 1 | 0 | loc-ALL | true |
| epiforecasts__scoringutils-229 | 1 | 1 | r | claude-code | sweet | 1 | 1 | 0 | loc-ALL | true |
| jashkenas__underscore-2757 | 1 | 9 | js | codex | native | 1 | 1 | 0 | loc-ALL | true |
| jashkenas__underscore-2757 | 1 | 9 | js | codex | sweet | 1 | 1 | 0 | loc-ALL | true |
| jashkenas__underscore-2757 | 1 | 9 | js | opencode | native | 1 | 1 | 0 | loc-ALL | true |
| jashkenas__underscore-2757 | 1 | 9 | js | opencode | sweet | 1 | 1 | 0 | loc-ALL | true |
| jashkenas__underscore-2757 | 1 | 9 | js | claude-code | native | 1 | 1 | 0 | loc-ALL | false |
| jashkenas__underscore-2757 | 1 | 9 | js | claude-code | sweet | 1 | 1 | 0 | loc-ALL | false |
| joshuakgoldberg__bingo-274 | 9 | 10 | ts | codex | native | 1 | 1 | 0 | loc-some | false |
| joshuakgoldberg__bingo-274 | 9 | 10 | ts | codex | sweet | 1 | 1 | 0 | loc-some | false |
| joshuakgoldberg__bingo-274 | 9 | 10 | ts | opencode | native | 1 | 1 | 0 | loc-some | false |
| joshuakgoldberg__bingo-274 | 9 | 10 | ts | opencode | sweet | 1 | 1 | 0 | loc-some | false |
| joshuakgoldberg__bingo-274 | 9 | 10 | ts | claude-code | native | 1 | 1 | 0 | loc-some | false |
| joshuakgoldberg__bingo-274 | 9 | 10 | ts | claude-code | sweet | 1 | 1 | 0 | loc-some | false |
| mransan__ocaml-protoc-202 | 19 | 33 | ocaml | codex | native | 1 | 0 | 1 | WRONG-LOC | false |
| mransan__ocaml-protoc-202 | 19 | 33 | ocaml | codex | sweet | 1 | 0 | 1 | WRONG-LOC | false |
| mransan__ocaml-protoc-202 | 19 | 33 | ocaml | opencode | native | 1 | 0 | 1 | WRONG-LOC | false |
| mransan__ocaml-protoc-202 | 19 | 33 | ocaml | opencode | sweet | 0 | 0 | 0 | no-edit | false |
| mransan__ocaml-protoc-202 | 19 | 33 | ocaml | claude-code | native | 1 | 0 | 1 | WRONG-LOC | false |
| mransan__ocaml-protoc-202 | 19 | 33 | ocaml | claude-code | sweet | 0 | 0 | 0 | no-edit | false |
| oceanparcels__parcels-617 | 1 | 1 | python | codex | native | 1 | 1 | 0 | loc-ALL | true |
| oceanparcels__parcels-617 | 1 | 1 | python | codex | sweet | 1 | 1 | 0 | loc-ALL | true |
| oceanparcels__parcels-617 | 1 | 1 | python | opencode | native | 1 | 1 | 0 | loc-ALL | true |
| oceanparcels__parcels-617 | 1 | 1 | python | opencode | sweet | 1 | 1 | 0 | loc-ALL | true |
| oceanparcels__parcels-617 | 1 | 1 | python | claude-code | native | 1 | 1 | 0 | loc-ALL | true |
| oceanparcels__parcels-617 | 1 | 1 | python | claude-code | sweet | 1 | 1 | 0 | loc-ALL | true |
| ontodev__robot-710 | 3 | 9 | java | codex | native | 1 | 0 | 1 | WRONG-LOC | true |
| ontodev__robot-710 | 3 | 9 | java | codex | sweet | 1 | 0 | 1 | WRONG-LOC | true |
| ontodev__robot-710 | 3 | 9 | java | opencode | native | 1 | 0 | 1 | WRONG-LOC | true |
| ontodev__robot-710 | 3 | 9 | java | opencode | sweet | 1 | 0 | 1 | WRONG-LOC | true |
| ontodev__robot-710 | 3 | 9 | java | claude-code | native | 1 | 0 | 1 | WRONG-LOC | true |
| ontodev__robot-710 | 3 | 9 | java | claude-code | sweet | 1 | 0 | 1 | WRONG-LOC | true |
| pytask-dev__pytask-210 | 2 | 4 | python | codex | native | 2 | 1 | 1 | loc-some | false |
| pytask-dev__pytask-210 | 2 | 4 | python | codex | sweet | 1 | 1 | 0 | loc-some | true |
| pytask-dev__pytask-210 | 2 | 4 | python | opencode | native | 2 | 1 | 1 | loc-some | true |
| pytask-dev__pytask-210 | 2 | 4 | python | opencode | sweet | 1 | 1 | 0 | loc-some | false |
| pytask-dev__pytask-210 | 2 | 4 | python | claude-code | native | 1 | 1 | 0 | loc-some | true |
| pytask-dev__pytask-210 | 2 | 4 | python | claude-code | sweet | 1 | 1 | 0 | loc-some | false |
| redboltz__mqtt_cpp-466 | 1 | 2 | cpp | codex | native | 1 | 1 | 0 | loc-ALL | true |
| redboltz__mqtt_cpp-466 | 1 | 2 | cpp | codex | sweet | 1 | 1 | 0 | loc-ALL | true |
| redboltz__mqtt_cpp-466 | 1 | 2 | cpp | opencode | native | 1 | 1 | 0 | loc-ALL | true |
| redboltz__mqtt_cpp-466 | 1 | 2 | cpp | opencode | sweet | 2 | 1 | 1 | loc-ALL | true |
| redboltz__mqtt_cpp-466 | 1 | 2 | cpp | claude-code | native | 2 | 1 | 1 | loc-ALL | true |
| redboltz__mqtt_cpp-466 | 1 | 2 | cpp | claude-code | sweet | 2 | 1 | 1 | loc-ALL | true |
| rstudio-education__gradethis-161 | 4 | 12 | r | codex | native | 3 | 3 | 0 | loc-some | true |
| rstudio-education__gradethis-161 | 4 | 12 | r | codex | sweet | 3 | 3 | 0 | loc-some | true |
| rstudio-education__gradethis-161 | 4 | 12 | r | opencode | native | 3 | 3 | 0 | loc-some | true |
| rstudio-education__gradethis-161 | 4 | 12 | r | opencode | sweet | 3 | 3 | 0 | loc-some | true |
| rstudio-education__gradethis-161 | 4 | 12 | r | claude-code | native | 4 | 4 | 0 | loc-ALL | true |
| rstudio-education__gradethis-161 | 4 | 12 | r | claude-code | sweet | 3 | 3 | 0 | loc-some | true |
| statamic__cms-9029 | 24 | 32 | php | codex | native | 1 | 0 | 1 | WRONG-LOC | true |
| statamic__cms-9029 | 24 | 32 | php | codex | sweet | 1 | 1 | 0 | loc-some | true |
| statamic__cms-9029 | 24 | 32 | php | opencode | native | 1 | 1 | 0 | loc-some | true |
| statamic__cms-9029 | 24 | 32 | php | opencode | sweet | 1 | 1 | 0 | loc-some | true |
| statamic__cms-9029 | 24 | 32 | php | claude-code | native | 1 | 1 | 0 | loc-some | true |
| statamic__cms-9029 | 24 | 32 | php | claude-code | sweet | 1 | 1 | 0 | loc-some | true |
| teleporthq__teleport-code-generators-291 | 3 | 4 | ts | codex | native | 1 | 1 | 0 | loc-some | true |
| teleporthq__teleport-code-generators-291 | 3 | 4 | ts | codex | sweet | 1 | 1 | 0 | loc-some | true |
| teleporthq__teleport-code-generators-291 | 3 | 4 | ts | opencode | native | 1 | 1 | 0 | loc-some | false |
| teleporthq__teleport-code-generators-291 | 3 | 4 | ts | opencode | sweet | 1 | 1 | 0 | loc-some | true |
| teleporthq__teleport-code-generators-291 | 3 | 4 | ts | claude-code | native | 1 | 1 | 0 | loc-some | true |
| teleporthq__teleport-code-generators-291 | 3 | 4 | ts | claude-code | sweet | 1 | 1 | 0 | loc-some | true |

### Taxonomy tally (51 cells per arm = 17 tasks x 3 harnesses)
- native: {"SOLVED":27,"loc-ALL":10,"WRONG-LOC":5,"loc-some":9}
- sweet: {"SOLVED":28,"loc-ALL":9,"WRONG-LOC":4,"loc-some":8,"no-edit":2}

### Gold file lists + what was MISSED (multi-site tasks, gold>=3 files)
- **codeception__codeceptjs-367** (js, 3 gold files, 5 hunks, F2P=null, problem=587ch)
  gold: lib/actor.js, lib/codecept.js, package.json
  codex/native: hit 0/3, wrong 1 [lib/helper.js]
  codex/sweet: hit 0/3, wrong 1 [lib/helper.js]
  opencode/native: hit 0/3, wrong 1 [lib/helper.js]
  opencode/sweet: hit 0/3, wrong 1 [lib/helper.js]
  claude-code/native: hit 1/3, wrong 0 
  claude-code/sweet: hit 0/3, wrong 1 [lib/helper.js]
- **dart-lang__http-1114** (dart, 4 gold files, 5 hunks, F2P=null, problem=846ch)
  gold: pkgs/http/CHANGELOG.md, pkgs/http/lib/http.dart, pkgs/http/lib/src/base_response.dart, pkgs/http/pubspec.yaml
  codex/native: hit 1/4, wrong 8 [pkgs/http/lib/retry.dart, pkgs/http/lib/src/base_request.dart, pkgs/http/lib/src/browser_client.dart, pkgs/http/lib/src/io_client.dart, pkgs/http/lib/src/io_streamed_response.dart, pkgs/http/lib/src/mock_client.dart, pkgs/http/lib/src/response.dart, pkgs/http/lib/src/streamed_response.dart]
  codex/sweet: hit 1/4, wrong 6 [pkgs/http/lib/src/base_request.dart, pkgs/http/lib/src/browser_client.dart, pkgs/http/lib/src/io_client.dart, pkgs/http/lib/src/io_streamed_response.dart, pkgs/http/lib/src/response.dart, pkgs/http/lib/src/streamed_response.dart]
  opencode/native: hit 1/4, wrong 5 [pkgs/http/lib/src/base_request.dart, pkgs/http/lib/src/io_client.dart, pkgs/http/lib/src/io_streamed_response.dart, pkgs/http/lib/src/response.dart, pkgs/http/lib/src/streamed_response.dart]
  opencode/sweet: hit 1/4, wrong 6 [pkgs/http/lib/src/base_request.dart, pkgs/http/lib/src/browser_client.dart, pkgs/http/lib/src/io_client.dart, pkgs/http/lib/src/io_streamed_response.dart, pkgs/http/lib/src/response.dart, pkgs/http/lib/src/streamed_response.dart]
  claude-code/native: hit 2/4, wrong 6 [pkgs/http/lib/src/base_client.dart, pkgs/http/lib/src/base_request.dart, pkgs/http/lib/src/browser_client.dart, pkgs/http/lib/src/client.dart, pkgs/http/lib/src/io_client.dart, pkgs/http/lib/src/response.dart]
  claude-code/sweet: hit 1/4, wrong 6 [pkgs/http/lib/src/base_request.dart, pkgs/http/lib/src/browser_client.dart, pkgs/http/lib/src/io_client.dart, pkgs/http/lib/src/io_streamed_response.dart, pkgs/http/lib/src/response.dart, pkgs/http/lib/src/streamed_response.dart]
- **joshuakgoldberg__bingo-274** (ts, 9 gold files, 10 hunks, F2P=null, problem=1071ch)
  gold: packages/bingo-fs/src/index.ts, packages/bingo-fs/src/isFile.ts, packages/bingo-handlebars/src/executeTemplatesRecursive.ts, packages/bingo-handlebars/src/handlebars.ts, packages/bingo-handlebars/src/handlebarsDirectory.ts, packages/bingo-handlebars/src/handlebarsFile.ts, packages/site/src/content/docs/build/packages/bingo-fs.mdx, packages/site/src/content/docs/engines/handlebars/about.mdx, packages/site/src/content/docs/engines/handlebars/handlebars.mdx
  codex/native: hit 1/9, wrong 0 
  codex/sweet: hit 1/9, wrong 0 
  opencode/native: hit 1/9, wrong 0 
  opencode/sweet: hit 1/9, wrong 0 
  claude-code/native: hit 1/9, wrong 0 
  claude-code/sweet: hit 1/9, wrong 0 
- **mransan__ocaml-protoc-202** (ocaml, 19 gold files, 33 hunks, F2P=null, problem=0ch)
  gold: .gitignore, .merlin, benchs/benchs.ml, src/compilerlib/compilerlib.odocl, src/compilerlib/dune, src/compilerlib/pb_codegen_backend.ml, src/compilerlib/pb_codegen_sig.ml, src/compilerlib/pb_codegen_util.ml, src/compilerlib/pb_logger.mli, src/compilerlib/pb_option.ml, src/compilerlib/pb_option.mli, src/compilerlib/pb_parsing_parser.mly, src/compilerlib/pb_typing_resolution.ml, src/compilerlib/pb_util.ml, src/compilerlib/pb_util.mli, src/include/ocaml-protoc/.gitignore, src/ocaml-protoc/ocaml_protoc_cmdline.ml, src/ocaml-protoc/ocaml_protoc_generation.ml, src/ocaml-protoc/ocaml_protoc_generation.mli
  codex/native: hit 0/19, wrong 1 [src/runtime/pbrt.ml]
  codex/sweet: hit 0/19, wrong 1 [src/compilerlib/pb_codegen_decode_bs.ml]
  opencode/native: hit 0/19, wrong 1 [src/compilerlib/pb_parsing_lexer.mll]
  opencode/sweet: hit 0/19, wrong 0 
  claude-code/native: hit 0/19, wrong 1 [src/runtime/pbrt.ml]
  claude-code/sweet: hit 0/19, wrong 0 
- **ontodev__robot-710** (java, 3 gold files, 9 hunks, F2P=null, problem=1553ch)
  gold: CHANGELOG.md, docs/extract.md, robot-core/src/main/java/org/obolibrary/robot/MireotOperation.java
  codex/native: hit 0/3, wrong 1 [robot-core/src/main/java/org/obolibrary/robot/OntologyHelper.java]
  codex/sweet: hit 0/3, wrong 1 [robot-core/src/main/java/org/obolibrary/robot/OntologyHelper.java]
  opencode/native: hit 0/3, wrong 1 [robot-core/src/main/java/org/obolibrary/robot/OntologyHelper.java]
  opencode/sweet: hit 0/3, wrong 1 [robot-core/src/main/java/org/obolibrary/robot/OntologyHelper.java]
  claude-code/native: hit 0/3, wrong 1 [robot-core/src/main/java/org/obolibrary/robot/OntologyHelper.java]
  claude-code/sweet: hit 0/3, wrong 1 [robot-core/src/main/java/org/obolibrary/robot/OntologyHelper.java]
- **rstudio-education__gradethis-161** (r, 4 gold files, 12 hunks, F2P=null, problem=583ch)
  gold: R/detect_mistakes.R, R/grade_code.R, R/message_generators.R, man/grade_code.Rd
  codex/native: hit 3/4, wrong 0 
  codex/sweet: hit 3/4, wrong 0 
  opencode/native: hit 3/4, wrong 0 
  opencode/sweet: hit 3/4, wrong 0 
  claude-code/native: hit 4/4, wrong 0 
  claude-code/sweet: hit 3/4, wrong 0 
- **statamic__cms-9029** (php, 24 gold files, 32 hunks, F2P=null, problem=15599ch)
  gold: CHANGELOG.md, config/assets.php, resources/js/bootstrap/globals.js, resources/js/components/assets/AssetManager.vue, resources/js/components/fieldtypes/CodeFieldtype.vue, resources/js/components/fieldtypes/assets/AssetsFieldtype.vue, resources/js/components/fieldtypes/replicator/ManagesPreviewText.js, resources/js/components/fieldtypes/replicator/PreviewHtml.js, resources/js/components/globals/Listing.vue, resources/js/components/inputs/relationship/Item.vue, src/Assets/AssetUploader.php, src/Assets/FileUploader.php, src/Http/Controllers/CP/Assets/AssetsController.php, src/Http/Controllers/CP/Fields/FieldsController.php, src/Http/Controllers/CP/Fieldtypes/FilesFieldtypeController.php, src/Http/Controllers/FormController.php, src/Http/Resources/CP/Concerns/HasRequestedColumns.php, src/Licensing/Outpost.php, src/Search/Commands/Update.php, src/StaticCaching/NoCache/Controller.php, src/Support/Html.php, src/Tags/Collection/Entries.php, src/Tags/Range.php, src/Validation/AllowedFile.php
  codex/native: hit 0/24, wrong 1 [src/Providers/CacheServiceProvider.php]
  codex/sweet: hit 1/24, wrong 0 
  opencode/native: hit 1/24, wrong 0 
  opencode/sweet: hit 1/24, wrong 0 
  claude-code/native: hit 1/24, wrong 0 
  claude-code/sweet: hit 1/24, wrong 0 
- **teleporthq__teleport-code-generators-291** (ts, 3 gold files, 4 hunks, F2P=null, problem=874ch)
  gold: packages/teleport-component-generator/src/index.ts, packages/teleport-project-generator/src/utils.ts, packages/teleport-uidl-validator/src/uidl-schemas/component.json
  codex/native: hit 1/3, wrong 0 
  codex/sweet: hit 1/3, wrong 0 
  opencode/native: hit 1/3, wrong 0 
  opencode/sweet: hit 1/3, wrong 0 
  claude-code/native: hit 1/3, wrong 0 
  claude-code/sweet: hit 1/3, wrong 0 

### Tasks NOBODY ever solved (any arm, any harness)
- apple__swift-nio-http2-145 (swift, 1 gold files, 3 hunks): codex/native=loc-ALL(1/1) codex/sweet=loc-ALL(1/1) opencode/native=loc-ALL(1/1) opencode/sweet=loc-ALL(1/1) claude-code/native=loc-ALL(1/1) claude-code/sweet=loc-ALL(1/1)
- codeception__codeceptjs-367 (js, 3 gold files, 5 hunks): codex/native=WRONG-LOC(0/3) codex/sweet=WRONG-LOC(0/3) opencode/native=WRONG-LOC(0/3) opencode/sweet=WRONG-LOC(0/3) claude-code/native=loc-some(1/3) claude-code/sweet=WRONG-LOC(0/3)
- dart-lang__http-1114 (dart, 4 gold files, 5 hunks): codex/native=loc-some(1/4) codex/sweet=loc-some(1/4) opencode/native=loc-some(1/4) opencode/sweet=loc-some(1/4) claude-code/native=loc-some(2/4) claude-code/sweet=loc-some(1/4)
- dotnet__yarp-2825 (csharp, 1 gold files, 2 hunks): codex/native=loc-ALL(1/1) codex/sweet=loc-ALL(1/1) opencode/native=loc-ALL(1/1) opencode/sweet=loc-ALL(1/1) claude-code/native=loc-ALL(1/1) claude-code/sweet=loc-ALL(1/1)
- joshuakgoldberg__bingo-274 (ts, 9 gold files, 10 hunks): codex/native=loc-some(1/9) codex/sweet=loc-some(1/9) opencode/native=loc-some(1/9) opencode/sweet=loc-some(1/9) claude-code/native=loc-some(1/9) claude-code/sweet=loc-some(1/9)
- mransan__ocaml-protoc-202 (ocaml, 19 gold files, 33 hunks): codex/native=WRONG-LOC(0/19) codex/sweet=WRONG-LOC(0/19) opencode/native=WRONG-LOC(0/19) opencode/sweet=no-edit(0/19) claude-code/native=WRONG-LOC(0/19) claude-code/sweet=no-edit(0/19)

## F. rt-dedup (repeat run_tests audit) — rows per cell
{"codex/native":116,"codex/sweet":122,"opencode/native":120,"opencode/sweet":109,"claude-code/native":128,"claude-code/sweet":124}

## G. FIXED-PREFIX analysis — turn-1 input tokens, sweet minus native, per task
| task | h | native t1_in | sweet t1_in | delta | native t1_uncached | sweet t1_uncached | delta_uncached |
|---|---|---|---|---|---|---|---|
| akinsho__nvim-bufferline.lua-173 | codex | 13027 | 14484 | 1457 | 3043 | 4500 | 1457 |
| akinsho__nvim-bufferline.lua-173 | opencode | 6661 | 8118 | 1457 | 6661 | 8118 | 1457 |
| akinsho__nvim-bufferline.lua-173 | claude-code | 17386 | 18975 | 1589 | 17386 | 18975 | 1589 |
| apple__swift-nio-http2-145 | codex | 13102 | 14559 | 1457 | 3118 | 4575 | 1457 |
| apple__swift-nio-http2-145 | opencode | 6735 | 8192 | 1457 | 6735 | 8192 | 1457 |
| apple__swift-nio-http2-145 | claude-code | 17452 | 19039 | 1587 | 17452 | 19039 | 1587 |
| codeception__codeceptjs-367 | codex | 12977 | 14434 | 1457 | 2993 | 4450 | 1457 |
| codeception__codeceptjs-367 | opencode | 6611 | 8068 | 1457 | 6611 | 8068 | 1457 |
| codeception__codeceptjs-367 | claude-code | 17326 | 18912 | 1586 | 17326 | 18912 | 1586 |
| dart-lang__http-1114 | codex | 13021 | 14478 | 1457 | 3037 | 4494 | 1457 |
| dart-lang__http-1114 | opencode | 6654 | 8111 | 1457 | 6654 | 8111 | 1457 |
| dart-lang__http-1114 | claude-code | 17369 | 18955 | 1586 | 17369 | 18955 | 1586 |
| dashbitco__nimble_options-43 | codex | 12893 | 14350 | 1457 | 12893 | 4366 | -8527 |
| dashbitco__nimble_options-43 | opencode | 6526 | 7983 | 1457 | 6526 | 7983 | 1457 |
| dashbitco__nimble_options-43 | claude-code | 17253 | 18841 | 1588 | 17253 | 18841 | 1588 |
| dotnet__yarp-2825 | codex | 13295 | 14752 | 1457 | 3311 | 4768 | 1457 |
| dotnet__yarp-2825 | opencode | 6929 | 8386 | 1457 | 6929 | 8386 | 1457 |
| dotnet__yarp-2825 | claude-code | 17643 | 19230 | 1587 | 17643 | 19230 | 1587 |
| epiforecasts__scoringutils-229 | codex | 13160 | 14617 | 1457 | 3176 | 4633 | 1457 |
| epiforecasts__scoringutils-229 | opencode | 6793 | 8250 | 1457 | 6793 | 8250 | 1457 |
| epiforecasts__scoringutils-229 | claude-code | 17517 | 19106 | 1589 | 17517 | 19106 | 1589 |
| jashkenas__underscore-2757 | codex | 13184 | 14641 | 1457 | 3200 | 4657 | 1457 |
| jashkenas__underscore-2757 | opencode | 6819 | 8276 | 1457 | 6819 | 8276 | 1457 |
| jashkenas__underscore-2757 | claude-code | 17534 | 19121 | 1587 | 17534 | 19121 | 1587 |
| joshuakgoldberg__bingo-274 | codex | 13113 | 14570 | 1457 | 3129 | 4586 | 1457 |
| joshuakgoldberg__bingo-274 | opencode | 6748 | 8205 | 1457 | 6748 | 8205 | 1457 |
| joshuakgoldberg__bingo-274 | claude-code | 17462 | 19051 | 1589 | 17462 | 19051 | 1589 |
| mransan__ocaml-protoc-202 | codex | 12846 | 14303 | 1457 | 2862 | 4319 | 1457 |
| mransan__ocaml-protoc-202 | opencode | 6480 | 7937 | 1457 | 6480 | 7937 | 1457 |
| mransan__ocaml-protoc-202 | claude-code | 17201 | 18789 | 1588 | 17201 | 18789 | 1588 |
| oceanparcels__parcels-617 | codex | 12989 | 14446 | 1457 | 3005 | 4462 | 1457 |
| oceanparcels__parcels-617 | opencode | 6623 | 8080 | 1457 | 6623 | 8080 | 1457 |
| oceanparcels__parcels-617 | claude-code | 17346 | 18935 | 1589 | 17346 | 18935 | 1589 |
| ontodev__robot-710 | codex | 13356 | 14813 | 1457 | 3372 | 14813 | 11441 |
| ontodev__robot-710 | opencode | 6994 | 8451 | 1457 | 6994 | 8451 | 1457 |
| ontodev__robot-710 | claude-code | 17713 | 19299 | 1586 | 17713 | 19299 | 1586 |
| pytask-dev__pytask-210 | codex | 12905 | 14362 | 1457 | 2921 | 4378 | 1457 |
| pytask-dev__pytask-210 | opencode | 6538 | 7995 | 1457 | 6538 | 7995 | 1457 |
| pytask-dev__pytask-210 | claude-code | 17253 | 18841 | 1588 | 17253 | 18841 | 1588 |
| redboltz__mqtt_cpp-466 | codex | 13106 | 14563 | 1457 | 3122 | 4579 | 1457 |
| redboltz__mqtt_cpp-466 | opencode | 6740 | 8197 | 1457 | 6740 | 8197 | 1457 |
| redboltz__mqtt_cpp-466 | claude-code | 17456 | 19042 | 1586 | 17456 | 19042 | 1586 |
| rstudio-education__gradethis-161 | codex | 12996 | 14453 | 1457 | 3012 | 4469 | 1457 |
| rstudio-education__gradethis-161 | opencode | 6629 | 8086 | 1457 | 6629 | 8086 | 1457 |
| rstudio-education__gradethis-161 | claude-code | 17354 | 18942 | 1588 | 17354 | 18942 | 1588 |
| statamic__cms-9029 | codex | 16707 | 18164 | 1457 | 16707 | 8180 | -8527 |
| statamic__cms-9029 | opencode | 10341 | 11798 | 1457 | 10341 | 11798 | 1457 |
| statamic__cms-9029 | claude-code | 21055 | 22640 | 1585 | 21055 | 22640 | 1585 |
| teleporthq__teleport-code-generators-291 | codex | 13028 | 14485 | 1457 | 3044 | 4501 | 1457 |
| teleporthq__teleport-code-generators-291 | opencode | 6661 | 8118 | 1457 | 6661 | 8118 | 1457 |
| teleporthq__teleport-code-generators-291 | claude-code | 17386 | 18976 | 1590 | 17386 | 18976 | 1590 |

## H. GOLD spec shape per task (targets for resolution levers)
| task | lang | gold files | gold hunks | +/- lines | F2P tests | problem chars |
|---|---|---|---|---|---|---|
| akinsho__nvim-bufferline.lua-173 | lua | 1 | 3 | 18 | null | 723 |
| apple__swift-nio-http2-145 | swift | 1 | 3 | 14 | null | 949 |
| codeception__codeceptjs-367 | js | 3 | 5 | 15 | null | 587 |
| dart-lang__http-1114 | dart | 4 | 5 | 77 | null | 846 |
| dashbitco__nimble_options-43 | elixir | 1 | 3 | 7 | null | 203 |
| dotnet__yarp-2825 | csharp | 1 | 2 | 12 | null | 1819 |
| epiforecasts__scoringutils-229 | r | 1 | 1 | 5 | null | 1270 |
| jashkenas__underscore-2757 | js | 1 | 9 | 20 | null | 1212 |
| joshuakgoldberg__bingo-274 | ts | 9 | 10 | 156 | null | 1071 |
| mransan__ocaml-protoc-202 | ocaml | 19 | 33 | 226 | null | 0 |
| oceanparcels__parcels-617 | python | 1 | 1 | 2 | null | 533 |
| ontodev__robot-710 | java | 3 | 9 | 58 | null | 1553 |
| pytask-dev__pytask-210 | python | 2 | 4 | 21 | null | 167 |
| redboltz__mqtt_cpp-466 | cpp | 1 | 2 | 20 | null | 1050 |
| rstudio-education__gradethis-161 | r | 4 | 12 | 105 | null | 583 |
| statamic__cms-9029 | php | 24 | 32 | 268 | null | 15599 |
| teleporthq__teleport-code-generators-291 | ts | 3 | 4 | 18 | null | 874 |
---

## I. NEW DERIVED FINDINGS (2026-08-11, computed in this session; NOT in the handoff prose)

These four facts were derived from the artifacts and CORRECT or SHARPEN the handoff. Treat them as
higher authority than the handoff prose where they conflict, because they are reproducible from
`evidence-pack.json`.

### I-1. The gold file set is NOT the pass criterion. (biggest reframe)
25 of the 51 solved/partial cells RESOLVED while touching a strict subset of gold files — or none.
- `ontodev__robot-710`: SOLVED in **all 6** arm x harness cells while hitting **0 of 3** gold files
  (it edits `OntologyHelper.java`; gold edits `MireotOperation.java` + `CHANGELOG.md` + `docs/extract.md`).
- `statamic__cms-9029`: SOLVED in all 6 cells hitting **1 of 24** gold files.
- `rstudio-education__gradethis-161`: SOLVED hitting 3 of 4.

Gold patches routinely bundle `CHANGELOG.md`, `docs/*.mdx`, `.gitignore`, `pubspec.yaml`, `.merlin`
and other files no F2P test requires. **Therefore any "multi-site under-coverage" lever must compute
its ceiling against the TEST-RELEVANT file subset, not the gold file set.** The handoff's
"1 of 9 gold files" for `joshuakgoldberg__bingo-274` counts 3 `.mdx` documentation files among the 9.
A sibling-site lever that drove coverage from 1/9 to 9/9 would still not necessarily flip the task.
**Any proposal resting on gold-file coverage must state its ceiling in TEST-RELEVANT files.**

### I-2. The fixed prefix is exactly constant — and it does NOT explain the short-trajectory loss.
Turn-1 input delta (sweet minus native) is **+1457 tokens on codex and opencode, +1586..1589 on
claude-code — identical on every one of the 17 tasks, variance zero.** It is also fully UNCACHED at
turn 1 even on codex (where ~10k of native's turn-1 IS cache-served).

Priced out: at codex rates ($0.10/M in, $0.01/M cached) over ~12 turns the prefix costs
≈ $0.00031 per rollout, against a mean sweet rollout of $0.0080 — a **ceiling of about 3.9%**.
On `dashbitco__nimble_options-43` (codex) sweet costs +$0.0033 (+52%). The prefix accounts for
≈$0.0003 of that, i.e. **~10% of the regression**. The other ~90% is that sweet made **12.5 tool
calls vs native's 6.5**. The handoff's reading that "the fixed prefix dominates on SHORT
trajectories" is NOT supported: extra tool calls dominate. A prefix-trimming lever has a hard
ceiling near 4% and cannot fix `dashbitco`.

### I-3. Why sweet halves output tokens on claude-code yet saves nothing there.
Billed-input decomposition (sum over all 34 cells per arm):

| harness | arm | cacheRatio | $ uncached-in | $ cached-in | $ out | out as % of bill |
|---|---|---|---|---|---|---|
| codex | native | 88.7% | 0.0584 | 0.0460 | 0.0410 | 28.2% |
| codex | sweet | 89.8% | 0.0490 | 0.0433 | 0.0423 | 31.4% |
| opencode | native | 91.7% | 0.0495 | 0.0545 | 0.0373 | 26.4% |
| opencode | sweet | 91.0% | 0.0395 | 0.0401 | 0.0296 | 27.1% |
| claude-code | native | 93.9% | 0.0623 | 0.0957 | 0.0635 | 28.7% |
| claude-code | sweet | 93.6% | 0.0616 | **0.0897** | 0.0324 | 17.6% |

Sweet **halves** claude-code output (105,834 → 53,996 tokens, −$0.0311) but moves cached input only
−6% (9.57M → 8.97M) and uncached input only −1% (623k → 616k). Cached input is **43%** of
claude-code's bill; output is only 29%. **The output win is real and is being eaten by an input mass
sweet does not touch.** Any claude-code cost lever must attack the ~9M cached input tokens, not
output and not tool-call count.

### I-4. Break-priced is degenerate on this dataset (but not wrong).
`breakPricedCostUsd === idealCostUsd` in **all 204 cells**, because `contextRewrites === 0` in all
204 cells. No rollout broke its prefix cache. The column is live and correct; it simply carries no
extra information here. It becomes load-bearing only for levers that reorder or evict context —
which is exactly why it was added. Do not claim a break-priced result differs from ideal on THIS run.

### I-5. Sweet reaches its first edit much sooner — on claude-code especially.
Mean `stepsToFirstEdit`: codex 7.5 native / 9.3 sweet; opencode 22.8 / 17.0;
claude-code **20.2 native / 11.4 sweet (−44%)**. Sweet localizes faster on the two verbose harnesses
and slower on codex.

### I-6. `mransan__ocaml-protoc-202` abandonment is TWO harnesses, not one.
Sweet produced **no edit at all** on BOTH opencode AND claude-code (handoff §0 flag 1 mentions only
opencode). Native always produced an edit (always wrong-loc). Task has 19 gold files, 33 hunks, and
a **problem statement of 0 characters** — it is unsolvable as specified; nobody solved it in 204
rollouts.

### I-7. `run_tests` / bash is NOT displaced by sweet on opencode.
Tool totals: opencode native bash=251, sweet bash=219 (−13%); test 86 → 74. But `nativeRead`
247 → 0 and `nativeGrep` 191 → 4. claude-code sweet still issues 141 `edit` and 38 `nativeRead`.
Sweet displaces READ and GREP completely; it does not displace BASH or TEST.

### I-8. FINDING A splits into TWO OPPOSITE failure modes. Do not treat them as one lever.

Traced to the exact files. `joshuakgoldberg__bingo-274` gold = **6 code files + 3 .mdx docs**, and the
F2P tests live in `isFile.test.ts`, `handlebarsDirectory.test.ts`, `handlebarsFile.test.ts`.

| gold file | change size | touched by any cell? |
|---|---|---|
| `bingo-handlebars/src/handlebars.ts` | **+1/-1** | **YES — all 6 cells, this is the only one** |
| `bingo-handlebars/src/handlebarsDirectory.ts` | +24/-0 | no |
| `bingo-handlebars/src/handlebarsFile.ts` | +21/-0 | no |
| `bingo-handlebars/src/executeTemplatesRecursive.ts` | +13/-1 | no |
| `bingo-fs/src/isFile.ts` | +5/-0 | no |
| `bingo-fs/src/index.ts` | +1/-0 | no |
| 3 x `site/.../*.mdx` | docs | no — and NOT test-relevant |

**Every cell found the single one-line change and missed all five files with real content.** The
correct denominator is 6 test-relevant code files, not 9. Under-coverage is real here: 1 of 6.

`dart-lang__http-1114` is the OPPOSITE. Gold = 4 files, but only `base_response.dart` (+68/-1) is
substantive; `http.dart` is +1/-1, `CHANGELOG.md` is a doc and `pubspec.yaml` is metadata.

| cell | hit | wrong files added |
|---|---|---|
| codex/native | `base_response.dart` | 8 |
| codex/sweet | `base_response.dart` | 6 |
| opencode/native | `base_response.dart` | 5 |
| opencode/sweet | `base_response.dart` | 6 |
| claude-code/native | `http.dart` + `base_response.dart` | 6 |
| claude-code/sweet | `base_response.dart` | 6 |

**Every single cell found the RIGHT substantive file.** dart-lang is not a localization failure at
all — it is a SCOPE-CONTROL failure. The agent finds the correct site, then edits six more files it
should not touch, and still fails. On claude-code sweet spends 21 edit calls to land 10.5 hunks while
native spends 10 to land 25.

**Consequence for lever design:** a "find the sibling sites" lever addresses bingo and would make
dart-lang WORSE, because dart-lang's problem is too many sites, not too few. Any lever must say which
of the two modes it targets. A lever claiming to fix both is almost certainly confused.

### I-9. FINDING C (the "sweet localizes worse" case) is noise. Downgrade it.
`codeception__codeceptjs-367`: **5 of the 6 cells — both arms, all harnesses — edited the same wrong
file, `lib/helper.js`.** The single exception is claude-code/native, which edited `lib/actor.js`
(a gold file) — **and still failed.** So this is arm-universal confusion about where the fix goes, not
a sweet-specific retrieval defect. The one differing cell bought nothing. Treat as noise; it is not a
program, and it is barely a look.

### I-10. Only SIX tasks are never solved by anyone — not seven.
Never solved in any arm, any harness, any rep: `apple__swift-nio-http2-145`,
`codeception__codeceptjs-367`, `dart-lang__http-1114`, `dotnet__yarp-2825`,
`joshuakgoldberg__bingo-274`, `mransan__ocaml-protoc-202`.
The per-harness "neither = 7" figure is larger because two tasks are HARNESS-SENSITIVE:
`dashbitco__nimble_options-43` solves only on claude-code (1 rep of 2, sweet arm) and
`jashkenas__underscore-2757` solves only on codex and opencode. Both are coin flips or
harness effects, not retrieval effects.

Of the six permanently unsolved: three (`apple`, `dotnet`, plus `dashbitco` on 2 of 3 harnesses) sit
at PERFECT localization — retrieval cannot help. One (`mransan`) has a ZERO-CHARACTER problem
statement and 19 gold files. One (`codeception`) is arm-universal confusion. That leaves
**`joshuakgoldberg__bingo-274` as the only never-solved task where a retrieval lever has a plausible
path** — and even there the win requires finding five more files, not one.

### I-11. DECISIVE: bingo-274's missing files DO NOT EXIST at base. Finding A is not a retrieval gap.

Surfaced by the GPT-family refuter, then verified directly against the gold patch `new file mode`
markers. Of `joshuakgoldberg__bingo-274`'s 9 gold files:

| file | status at base |
|---|---|
| `packages/bingo-handlebars/src/handlebars.ts` | EXISTING — **the +1/-1 change every cell found** |
| `packages/bingo-fs/src/index.ts` | EXISTING — not touched |
| `packages/bingo-handlebars/src/executeTemplatesRecursive.ts` | EXISTING — not touched |
| `packages/bingo-fs/src/isFile.ts` | **NEW FILE** |
| `packages/bingo-handlebars/src/handlebarsDirectory.ts` | **NEW FILE** |
| `packages/bingo-handlebars/src/handlebarsFile.ts` | **NEW FILE** |
| 3 x `packages/site/.../*.mdx` | EXISTING — documentation, not test-relevant |

All three F2P test files (`isFile.test.ts`, `handlebarsDirectory.test.ts`,
`handlebarsFile.test.ts`) are ALSO new files in the hidden test patch.

**No retrieval mechanism can surface a file that does not exist.** The task is not "given a fix site,
find the sibling sites" — it is "author three new modules and wire them into two packages." That is
authoring and design, not retrieval.

Consequences, and they are large:
1. **Finding A dies as a retrieval headroom.** `bingo-274` was its single cleanest case and the only
   never-solved task with a supposedly plausible retrieval path. It has none.
2. The honest denominator is not 1 of 9, nor 1 of 6. Of the three code files that EXIST at base,
   agents touched 1. The other five targets are three files to be created plus two existing files.
3. Every sibling-closure, structural-echo and 2-hop-expansion lever aimed at this task is refuted at
   the mechanism level, not merely on ceiling. They were all proposed against a case that cannot work.
4. Combined with I-1 (gold coverage is not the pass criterion), I-8 (dart-lang is scope control, not
   localization), I-9 (codeception is arm-universal noise) and I-10 (three never-solved tasks sit at
   perfect localization), **this task set contains essentially no retrieval-shaped resolution
   headroom for sweet.** That is the central negative result of this hunt.
