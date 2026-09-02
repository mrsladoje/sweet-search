## Cell economics [M rows.json via extract-events]
| cell | rollouts | priced rollouts | $/request | tool tokens (in+out, o200k) |
|---|---:|---:|---:|---:|
| claude-code native | 66 | 38 | 0.000614 | 2,081,273 |
| claude-code sweet | 66 | 57 | 0.000702 | 1,920,738 |
| codex native | 66 | 66 | 0.000652 | 1,235,986 |
| codex sweet | 66 | 66 | 0.000629 | 1,042,773 |
| opencode native | 66 | 66 | 0.000550 | 1,393,962 |
| opencode sweet | 66 | 66 | 0.000470 | 1,138,153 |

## Capability census: claude-code / native (n=66 rollouts) [M]
| capability | via | ops | ops/rollout | rollouts with | tokens (attributed) | share of arm tool tokens | top sub / tags |
|---|---|---:|---:|---:|---:|---:|---|
| read.range | native | 1249 | 18.92 | 66 | 1,031,063 | 49.5% | Read-tool:1245, sed-n:4 — test-path:227, build-path:132, manifest:41 |
| grep.regex | native | 273 | 4.14 | 51 | 378,992 | 18.2% | grep:241, rg:32 — scoped:273, multi-pattern:254, ere:149, head-limited:149, test-path:117, type-filter:58 |
| test | native | 207 | 3.14 | 66 | 208,412 | 10.0% | shim:207 —  |
| list | native | 99 | 1.50 | 50 | 98,478 | 4.7% | find-enumerate:94, ls:5 — post-filter:79, maxdepth:76, head-limited:37, test-path:10, counted:2, dep-path:1 |
| grep.literal | native | 152 | 2.30 | 47 | 97,400 | 4.7% | grep:148, rg:4 — scoped:151, multi-pattern:94, head-limited:87, test-path:56, defn:30, build-path:12 |
| edit | native | 312 | 4.73 | 66 | 75,342 | 3.6% | Edit:304, Write:7, sed-i:1 —  |
| glob | native | 43 | 0.65 | 28 | 54,727 | 2.6% | find-name:24, find-enumerate:18, git-ls-files:1 — name-filter:21, post-filter:19, maxdepth:12, head-limited:12, test-path:11, dep-path:3 |
| git.state | native | 206 | 3.12 | 60 | 39,605 | 1.9% | diff:108, status:75, remote:11, branch:11 —  |
| delegate | native | 96 | 1.45 | 27 | 37,128 | 1.8% | SendMessage:65, Agent:31 —  |
| plan | native | 139 | 2.11 | 42 | 28,625 | 1.4% | TaskUpdate:80, TaskCreate:55, TaskOutput:2, TaskList:1 —  |
| git.history | native | 52 | 0.79 | 23 | 12,348 | 0.6% | log:39, show:8, tag:4, blame:1 — head-limited:9, tail-limited:3, grep-filtered:1 |
| runtime | native | 34 | 0.52 | 10 | 11,916 | 0.6% | inline:34 — regex-probe:17, imports:15 |
| web | native | 11 | 0.17 | 4 | 4,114 | 0.2% | WebSearch:7, WebFetch:4 —  |
| git.other | native | 23 | 0.35 | 9 | 2,355 | 0.1% | -C:10, add:6, checkout:4, fsck:2 — head-limited:3 |
| read.whole | native | 1 | 0.02 | 1 | 504 | 0.0% | cat:1 — manifest:1 |
| build | native | 4 | 0.06 | 4 | 224 | 0.0% | lint-format:3, build:1 —  |
| misc | native | 84 | 1.27 | 54 | 38 | 0.0% | shell:78, fs-probe:2, Skill:2, probe-tool:1 — dep-path:1 |

## Capability census: claude-code / sweet (n=66 rollouts) [M]
| capability | via | ops | ops/rollout | rollouts with | tokens (attributed) | share of arm tool tokens | top sub / tags |
|---|---|---:|---:|---:|---:|---:|---|
| grep.regex | ss | 316 | 4.79 | 46 | 540,024 | 28.1% | ss-grep:162, ss-find:154 — with-query:154, scoped:97, defn:25, build-path:25, test-path:14, positional-path:9 |
| read.range | ss | 429 | 6.50 | 63 | 373,332 | 19.4% | ss-read:422, ss-semantic:7 — test-path:57, build-path:22, manifest:9, semantic:7 |
| search.semantic | ss | 207 | 3.14 | 58 | 332,067 | 17.3% | ss-search:198, ss-find:9 — scoped:2, head-limited:1, test-path:1 |
| test | native | 200 | 3.03 | 66 | 201,782 | 10.5% | shim:200 —  |
| read.range | native | 138 | 2.09 | 23 | 153,444 | 8.0% | Read-tool:138 — build-path:44, test-path:17 |
| grep.literal | ss | 332 | 5.03 | 62 | 127,314 | 6.6% | ss-grep:303, ss-find:29 — scoped:141, build-path:45, defn:33, with-query:29, icase:11, test-path:11 |
| edit | native | 245 | 3.71 | 65 | 58,195 | 3.0% | Edit:241, Write:4 —  |
| grep.regex | native | 13 | 0.20 | 6 | 38,278 | 2.0% | grep:13 — ere:13, multi-pattern:13, scoped:13, head-limited:9, manifest:3, icase:2 |
| symbol | ss | 15 | 0.23 | 13 | 21,690 | 1.1% | ss-trace:15 — scoped:13 |
| glob | native | 21 | 0.32 | 10 | 17,734 | 0.9% | find-name:13, find-enumerate:5, git-ls-files:2, ls:1 — head-limited:8, maxdepth:8, post-filter:6, name-filter:5, build-path:4, pattern:2 |
| git.state | native | 77 | 1.17 | 43 | 14,642 | 0.8% | diff:52, status:23, branch:1, check-ignore:1 — post-filter:1 |
| list | native | 9 | 0.14 | 6 | 13,184 | 0.7% | find-enumerate:8, ls:1 — maxdepth:6, post-filter:2, head-limited:2, test-path:1, dirs:1, counted:1 |
| delegate | native | 30 | 0.45 | 9 | 12,636 | 0.7% | SendMessage:19, Agent:11 —  |
| runtime | native | 20 | 0.30 | 7 | 5,198 | 0.3% | inline:20 — imports:12, regex-probe:9 |
| read.whole | ss | 7 | 0.11 | 1 | 4,902 | 0.3% | ss-read:7 — test-path:2 |
| plan | native | 128 | 1.94 | 47 | 4,570 | 0.2% | TaskUpdate:73, TaskCreate:52, TaskList:2, TaskGet:1 —  |
| git.other | native | 11 | 0.17 | 5 | 645 | 0.0% | -C:9, add:1, rm:1 — tail-limited:1 |
| git.history | native | 6 | 0.09 | 4 | 552 | 0.0% | log:6 — head-limited:1 |
| misc | native | 64 | 0.97 | 13 | 493 | 0.0% | probe-tool:32, shell:28, unknown:2, fs-mutate:2 — grep-filtered:2, post-filter:2, head-limited:1 |
| build | native | 2 | 0.03 | 2 | 56 | 0.0% | lint-format:1, build:1 —  |

## Capability census: codex / native (n=66 rollouts) [M]
| capability | via | ops | ops/rollout | rollouts with | tokens (attributed) | share of arm tool tokens | top sub / tags |
|---|---|---:|---:|---:|---:|---:|---|
| read.range | native | 862 | 13.06 | 66 | 500,589 | 40.5% | sed-n:786, nl:70, cat:6 — test-path:131, build-path:96, piped-sed:75, numbered:70, manifest:11, piped-head:2 |
| grep.regex | native | 277 | 4.20 | 66 | 216,860 | 17.5% | rg:277 — multi-pattern:274, scoped:273, head-limited:149, type-filter:120, test-path:100, defn:79 |
| test | native | 199 | 3.02 | 66 | 167,504 | 13.6% | shim:199 — post-filter:1 |
| read.whole | native | 155 | 2.35 | 59 | 99,321 | 8.0% | cat:155 — manifest:22, test-path:5, multi-file:2, build-path:1, glob-arg:1 |
| glob | native | 125 | 1.89 | 63 | 65,232 | 5.3% | rg-files:120, ls:3, find-enumerate:1, find-name:1 — rg-files:120, type-filter:107, head-limited:56, post-filter:17, name-filter:13, sed-filtered:9 |
| poll | native | 38 | 0.58 | 18 | 48,736 | 3.9% | write_stdin:38 —  |
| git.state | native | 160 | 2.42 | 57 | 45,477 | 3.7% | diff:96, status:64 — sed-filtered:1 |
| edit | native | 131 | 1.98 | 66 | 37,377 | 3.0% | apply_patch:130, heredoc-write:1 —  |
| plan | native | 273 | 4.14 | 64 | 22,732 | 1.8% | update_plan:273 —  |
| grep.literal | native | 39 | 0.59 | 24 | 19,077 | 1.5% | rg:39 — scoped:39, head-limited:18, type-filter:15, test-path:12, ctx:3, build-path:2 |
| list | native | 11 | 0.17 | 10 | 7,518 | 0.6% | ls:6, find-enumerate:5 — head-limited:4, maxdepth:4, test-path:4, post-filter:3, sed-filtered:2 |
| runtime | native | 8 | 0.12 | 5 | 4,024 | 0.3% | inline:7, script-file:1 — regex-probe:5, imports:3 |
| git.history | native | 2 | 0.03 | 2 | 1,240 | 0.1% | log:2 —  |
| build | native | 2 | 0.03 | 1 | 298 | 0.0% | syntax-check:2 —  |
| misc | native | 392 | 5.94 | 66 | 0 | 0.0% | shell:379, fs-probe:5, fs-mutate:4, probe-tool:3 — dep-path:2, head-limited:1 |

## Capability census: codex / sweet (n=66 rollouts) [M]
| capability | via | ops | ops/rollout | rollouts with | tokens (attributed) | share of arm tool tokens | top sub / tags |
|---|---|---:|---:|---:|---:|---:|---|
| read.range | ss | 565 | 8.56 | 65 | 409,858 | 39.3% | ss-read:519, ss-semantic:46 — test-path:93, build-path:49, semantic:46, force:20, manifest:14 |
| search.semantic | ss | 123 | 1.86 | 48 | 180,279 | 17.3% | ss-search:123 —  |
| test | native | 197 | 2.98 | 66 | 146,000 | 14.0% | shim:197 —  |
| grep.regex | ss | 95 | 1.44 | 35 | 70,278 | 6.7% | ss-grep:71, ss-find:24 — with-query:24, defn:15, scoped:14, build-path:2 |
| grep.literal | ss | 151 | 2.29 | 59 | 63,442 | 6.1% | ss-grep:148, ss-find:3 — defn:19, scoped:12, build-path:4, with-query:3, test-path:2, positional-path:1 |
| poll | native | 45 | 0.68 | 23 | 53,516 | 5.1% | write_stdin:45 —  |
| edit | native | 113 | 1.71 | 66 | 32,692 | 3.1% | apply_patch:113 —  |
| plan | native | 259 | 3.92 | 66 | 22,215 | 2.1% | update_plan:259 —  |
| git.state | native | 120 | 1.82 | 50 | 22,204 | 2.1% | diff:94, status:25, check-ignore:1 —  |
| symbol | ss | 13 | 0.20 | 11 | 15,615 | 1.5% | ss-trace:13 — scoped:10 |
| read.whole | ss | 23 | 0.35 | 1 | 9,198 | 0.9% | ss-read:23 — test-path:3, force:3, manifest:1 |
| glob | native | 20 | 0.30 | 13 | 5,838 | 0.6% | rg-files:18, git-ls-files:2 — rg-files:18, type-filter:15, head-limited:12, sed-filtered:3, pattern:2, name-filter:2 |
| read.range | native | 13 | 0.20 | 4 | 5,280 | 0.5% | sed-n:11, nl:2 — build-path:4, test-path:2, numbered:2, piped-sed:2 |
| grep.regex | native | 8 | 0.12 | 4 | 2,628 | 0.3% | rg:8 — head-limited:8, scoped:8, multi-pattern:7, build-path:4, test-path:3, defn:1 |
| runtime | native | 5 | 0.08 | 2 | 2,096 | 0.2% | inline:5 — regex-probe:3, imports:2 |
| grep.literal | native | 3 | 0.05 | 2 | 1,169 | 0.1% | rg:3 — build-path:3, scoped:3, ctx:2, head-limited:1 |
| git.history | native | 1 | 0.02 | 1 | 402 | 0.0% | log:1 —  |
| misc | native | 97 | 1.47 | 20 | 65 | 0.0% | shell:92, fs-probe:3, fs-mutate:2 — dep-path:2 |

## Capability census: opencode / native (n=66 rollouts) [M]
| capability | via | ops | ops/rollout | rollouts with | tokens (attributed) | share of arm tool tokens | top sub / tags |
|---|---|---:|---:|---:|---:|---:|---|
| read.range | native | 596 | 9.03 | 66 | 730,443 | 52.4% | read-tool:596 — test-path:130, build-path:44, manifest:33 |
| grep.regex | native | 202 | 3.06 | 65 | 212,563 | 15.2% | grep-tool:202 — type-filter:202, scoped:125, defn:35, test-path:31, build-path:6, manifest:1 |
| test | native | 179 | 2.71 | 66 | 186,528 | 13.4% | shim:179 —  |
| glob | native | 107 | 1.62 | 52 | 74,509 | 5.3% | glob-tool:107 —  |
| plan | native | 259 | 3.92 | 66 | 60,286 | 4.3% | todowrite:259 —  |
| list | native | 33 | 0.50 | 32 | 50,358 | 3.6% | glob-tool:32, ls:1 — enumerate:32, dep-path:1 |
| edit | native | 117 | 1.77 | 66 | 31,956 | 2.3% | apply_patch:117 —  |
| git.state | native | 154 | 2.33 | 60 | 23,576 | 1.7% | diff:88, status:66 —  |
| grep.literal | native | 38 | 0.58 | 23 | 20,441 | 1.5% | grep-tool:38 — type-filter:38, scoped:25, defn:7, test-path:4, build-path:3 |
| runtime | native | 9 | 0.14 | 3 | 3,232 | 0.2% | inline:9 — regex-probe:9 |
| git.other | native | 3 | 0.05 | 2 | 42 | 0.0% | add:3 —  |
| git.history | native | 2 | 0.03 | 2 | 27 | 0.0% | log:2 —  |
| misc | native | 1 | 0.02 | 1 | 0 | 0.0% | shell:1 —  |

## Capability census: opencode / sweet (n=66 rollouts) [M]
| capability | via | ops | ops/rollout | rollouts with | tokens (attributed) | share of arm tool tokens | top sub / tags |
|---|---|---:|---:|---:|---:|---:|---|
| read.range | ss | 444 | 6.73 | 64 | 464,513 | 40.8% | ss-read:438, ss-semantic:6 — test-path:82, build-path:30, manifest:12, semantic:6 |
| test | native | 193 | 2.92 | 66 | 202,846 | 17.8% | shim:193 —  |
| search.semantic | ss | 102 | 1.55 | 53 | 170,081 | 14.9% | ss-search:102 —  |
| grep.regex | ss | 117 | 1.77 | 40 | 93,855 | 8.2% | ss-grep:91, ss-find:26 — with-query:26, scoped:25, defn:17, build-path:9, test-path:8, positional-path:3 |
| plan | native | 250 | 3.79 | 66 | 56,918 | 5.0% | todowrite:250 —  |
| read.range | native | 18 | 0.27 | 5 | 44,428 | 3.9% | read-tool:18 — build-path:12, test-path:3 |
| grep.literal | ss | 117 | 1.77 | 52 | 37,562 | 3.3% | ss-grep:108, ss-find:9 — scoped:17, defn:11, build-path:11, with-query:9, positional-path:2 |
| edit | native | 123 | 1.86 | 66 | 29,921 | 2.6% | apply_patch:123 —  |
| git.state | native | 162 | 2.45 | 63 | 25,779 | 2.3% | diff:91, status:71 —  |
| symbol | ss | 8 | 0.12 | 7 | 6,264 | 0.6% | ss-trace:8 — scoped:5 |
| glob | native | 24 | 0.36 | 13 | 3,948 | 0.3% | glob-tool:22, git-ls-files:2 — pattern:2 |
| runtime | native | 6 | 0.09 | 3 | 1,765 | 0.2% | inline:6 — regex-probe:6, imports:1 |
| grep.regex | native | 1 | 0.02 | 1 | 106 | 0.0% | grep-tool:1 — build-path:1, defn:1, scoped:1, type-filter:1 |
| grep.literal | native | 1 | 0.02 | 1 | 83 | 0.0% | rg:1 — build-path:1, scoped:1 |
| build | native | 1 | 0.02 | 1 | 42 | 0.0% | build:1 —  |
| git.history | native | 1 | 0.02 | 1 | 31 | 0.0% | log:1 —  |
| misc | native | 4 | 0.06 | 3 | 10 | 0.0% | shell:2, count:1, probe-tool:1 — build-path:1, line-count:1 |

## Sweet-arm capabilities still performed with raw shell / harness tools, ranked by attributed tokens [M] (prices [I])

### codex sweet (n=66; $/request 0.000629; $/ingested token 0.259/M)
| capability | ops | rollouts | tokens | est. token $ / rollout | requests touched | sole-native requests | est. request $ / rollout | attribution | absent features / failure kinds | programs |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| git.state | 120 | 50 | 22,204 | 0.000087 | 67 | 57 | 0.000543 | feature-absent:116, after-ss-failure:4 | git.state:116, 0 total match(es):2, [ss-read] error:1, [ss-*] crash:1 | git:120 |
| glob | 20 | 13 | 5,838 | 0.000023 | 13 | 13 | 0.000124 | feature-absent:18, after-ss-failure:2 | glob:18, [ss-*] crash:1, [ss-read] error:1 | rg:18, git:2 |
| read.range | 13 | 4 | 5,280 | 0.000021 | 10 | 10 | 0.000095 | plain-fallback:7, feature-absent:6 | build-path:4, numbered:2 | sed:11, nl:2 |
| grep.regex | 8 | 4 | 2,628 | 0.000010 | 8 | 8 | 0.000076 | plain-fallback:4, feature-absent:3, after-ss-failure:1 | build-path:3, 0 total match(es):1 | rg:8 |
| runtime | 5 | 2 | 2,096 | 0.000008 | 5 | 5 | 0.000048 | feature-absent:4, after-ss-failure:1 | runtime:4, [ss-read] error:1 | node:5 |
| grep.literal | 3 | 2 | 1,169 | 0.000005 | 3 | 2 | 0.000019 | feature-absent:3 | build-path:3, ctx:2 | rg:3 |
| git.history | 1 | 1 | 402 | 0.000002 | 1 | 1 | 0.000010 | feature-absent:1 | git.history:1 | git:1 |
| misc | 97 | 20 | 65 | 0.000000 | 53 | 17 | 0.000162 | plain-fallback:89, after-ss-failure:8 | 0 total match(es):7, No indexed symbol:1 | printf:77, pwd:7, echo:5, [:2, true:2 |

### opencode sweet (n=66; $/request 0.000470; $/ingested token 0.250/M)
| capability | ops | rollouts | tokens | est. token $ / rollout | requests touched | sole-native requests | est. request $ / rollout | attribution | absent features / failure kinds | programs |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| read.range | 18 | 5 | 44,428 | 0.000168 | 18 | 18 | 0.000128 | feature-absent:9, plain-fallback:6, after-ss-failure:3 | build-path:9, 0 total match(es):3 | read:18 |
| git.state | 162 | 63 | 25,779 | 0.000098 | 88 | 82 | 0.000584 | feature-absent:160, after-ss-failure:2 | git.state:160, 0 total match(es):2 | git:162 |
| glob | 24 | 13 | 3,948 | 0.000015 | 24 | 24 | 0.000171 | feature-absent:13, after-ss-failure:11 | glob:13, 0 total match(es):7, [ss-read] error:2, error:1, [ss-*] crash:1 | glob:22, git:2 |
| runtime | 6 | 3 | 1,765 | 0.000007 | 6 | 6 | 0.000043 | feature-absent:5, after-ss-failure:1 | runtime:5, [ss-read] error:1 | node:6 |
| grep.regex | 1 | 1 | 106 | 0.000000 | 1 | 1 | 0.000007 | after-ss-failure:1 | 0 total match(es):1 | grep:1 |
| grep.literal | 1 | 1 | 83 | 0.000000 | 1 | 1 | 0.000007 | feature-absent:1 | build-path:1 | rg:1 |
| git.history | 1 | 1 | 31 | 0.000000 | 1 | 1 | 0.000007 | feature-absent:1 | git.history:1 | git:1 |
| misc | 4 | 3 | 10 | 0.000000 | 3 | 2 | 0.000014 | plain-fallback:3, feature-absent:1 | line-count:1 | wc:1, command:1, true:1, pwd:1 |

### claude-code sweet (n=66; $/request 0.000702; $/ingested token 0.301/M)
| capability | ops | rollouts | tokens | est. token $ / rollout | requests touched | sole-native requests | est. request $ / rollout | attribution | absent features / failure kinds | programs |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| read.range | 138 | 23 | 153,444 | 0.000700 | 114 | 114 | 0.001212 | plain-fallback:73, after-ss-failure:37, feature-absent:28 | 0 total match(es):30, build-path:28, Usage: ss-:3, (no matches):2, [ss-read] error:1, No indexed symbol:1 | Read:138 |
| grep.regex | 13 | 6 | 38,278 | 0.000175 | 13 | 13 | 0.000138 | plain-fallback:12, after-ss-failure:1 | 0 total match(es):1 | grep:13 |
| glob | 21 | 10 | 17,734 | 0.000081 | 20 | 20 | 0.000213 | feature-absent:19, after-ss-failure:2 | glob:19, 0 total match(es):2 | find:18, git:2, ls:1 |
| git.state | 77 | 43 | 14,642 | 0.000067 | 57 | 52 | 0.000553 | feature-absent:64, after-ss-failure:13 | git.state:64, 0 total match(es):7, [ss-*] crash:2, Usage: ss-:2, (no matches):2 | git:77 |
| list | 9 | 6 | 13,184 | 0.000060 | 8 | 8 | 0.000085 | feature-absent:8, after-ss-failure:1 | list:8, [ss]:1 | find:8, ls:1 |
| runtime | 20 | 7 | 5,198 | 0.000024 | 20 | 20 | 0.000213 | feature-absent:15, after-ss-failure:5 | runtime:15, 0 total match(es):3, [ss-read] error:1, No indexed symbol:1 | node:12, python3:6, python:2 |
| git.other | 11 | 5 | 645 | 0.000003 | 7 | 7 | 0.000074 | after-ss-failure:6, feature-absent:5 | git.other:5, 0 total match(es):5, [ss]:1 | git:11 |
| git.history | 6 | 4 | 552 | 0.000003 | 5 | 5 | 0.000053 | feature-absent:4, after-ss-failure:2 | git.history:4, 0 total match(es):2 | git:6 |
| misc | 64 | 13 | 493 | 0.000002 | 21 | 21 | 0.000223 | plain-fallback:62, after-ss-failure:2 | 0 total match(es):1, (no matches):1 | command:32, true:18, pwd:7, printf:3, compgen:2 |

## Retrieval-fallback totals per harness (grep/read/glob/list performed by raw shell or harness tools in the sweet arm) [M tokens; I prices]
| harness | thread | ops | tokens | token $ / rollout | sole-native requests | request $ / rollout | sum $ / rollout | mean sweet $ / rollout | share |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| codex | main | 44 | 14,914 | 0.000059 | 23 | 0.000219 | 0.000278 | 0.012330 | 2.3% |
| codex | side | 0 | 0 | 0.000000 | 0 | 0.000000 | 0.000000 | 0.012330 | 0.0% |
| opencode | main | 44 | 48,566 | 0.000184 | 43 | 0.000306 | 0.000490 | 0.009265 | 5.3% |
| opencode | side | 0 | 0 | 0.000000 | 0 | 0.000000 | 0.000000 | 0.009265 | 0.0% |
| claude-code | main | 54 | 38,170 | 0.000174 | 51 | 0.000542 | 0.000716 | 0.015127 | 4.7% |
| claude-code | side | 127 | 184,470 | 0.000841 | 91 | 0.000967 | 0.001809 | 0.015127 | 12.0% |

## Same-pattern re-grep census (sweet arm: raw grep/rg/harness grep whose pattern an earlier ss-grep/ss-find had already run) [M]

### codex: raw content greps in sweet arm = 11; pattern already run through ss-grep/ss-find: 2 exact + 0 case-only + 2 substring = 4 in 3 rollouts; no prior ss pattern: 7
  ss result when it happened: {'hits': 2, 'zero': 2}
  raw grep feature delta: {('build-path', 'ctx', 'scoped'): 1, ('scoped',): 1, ('build-path', 'scoped'): 2}
  same-file re-read (native read of a file an earlier ss-read had shown): 6 in 3 rollouts; ss-read outcome then: {'ok': 6}

### opencode: raw content greps in sweet arm = 2; pattern already run through ss-grep/ss-find: 2 exact + 0 case-only + 0 substring = 2 in 2 rollouts; no prior ss pattern: 0
  ss result when it happened: {'hits': 1, 'zero': 1}
  raw grep feature delta: {('build-path', 'scoped'): 1, ('build-path', 'scoped', 'type-filter'): 1}
  same-file re-read (native read of a file an earlier ss-read had shown): 4 in 2 rollouts; ss-read outcome then: {'ok': 4}

### claude-code: raw content greps in sweet arm = 13; pattern already run through ss-grep/ss-find: 0 exact + 0 case-only + 8 substring = 8 in 3 rollouts; no prior ss pattern: 5
  ss result when it happened: {'zero': 8}
  raw grep feature delta: {('build-path', 'scoped'): 1, ('scoped',): 5, ('icase', 'scoped'): 2}
  same-file re-read (native read of a file an earlier ss-read had shown): 24 in 9 rollouts; ss-read outcome then: {'ok': 17, 'enoent': 7}

wrote report-out
