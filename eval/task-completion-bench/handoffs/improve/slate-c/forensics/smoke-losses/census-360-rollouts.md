# Retrieval census: 360 rollouts, sweet vs native

- rollouts parsed: **360** (20 tasks x 2 arms x 3 reps x 3 harnesses); every rollout has a first edit.
- tasks with >=1 **sweet** solve anywhere: **9** -> eclipse-ee4j__yasson-395, getmoto__moto-6716, gleam-lang__gleam-3458, jensneuse__graphql-go-tools-174, python-markdown__markdown-1294, raphlinus__pulldown-cmark-754, rust-analyzer__rust-analyzer-2616, squashql__squashql-295, vazco__uniforms-787
- tasks with >=1 solve in **either** arm: **9**; never solved by anyone: **11** -> chaijs__chai-990, firebase__firebase-tools-2933, intel__rohd-458, joshuakgoldberg__bingo-271, maxgraph__maxgraph-365, mirumee__ariadne-codegen-223, projectlombok__lombok-3619, rokucommunity__brighterscript-1050, singapore__renovate-1153, sqlkata__querybuilder-557, yargs__yargs-1422
- (the brief said 8 solvable / 12 never-solved; the data says **9 / 11**.)

## Headline

1. **Sweet reads a much narrower slice of the repo before it edits, but not a narrower slice of the file it edits.** Pooled, sweet sees 58 distinct code locations before its first edit against native's 113 (median 51 vs 100), 4.3 files against 6.7, 49k output characters against 59k, and 11.9 tool calls against 15.0; on codex and opencode the reference gap is about 2.5x. Inside the file it finally patches, sweet is if anything better covered -- 0.86 median fraction in view against native's 0.75 -- though native reads that file end to end more often (36.7% vs 21.7%). The narrowing is lateral: fewer neighbouring files, not fewer lines of the target.
2. **The `trust the top hit and stop` instruction is not what sweet mostly does, but where it does, it hurts.** Only 5.0% of sweet rollouts open with a single-hit content search, and the median first search returns 11 hits. What sweet actually drops is pattern breadth, not search count: 64.4% of sweet rollouts use a broad pattern before editing against 93.3% of native, at 4.9 vs 4.4 searches. The clearest single failure in the whole set is the literal case: `codex/squashql__squashql-295-sweet-r0` ran `ss-grep "sub-query in a sub-query is not supported"`, got exactly 1 hit, read 66 of `QueryResolver.java`'s 468 lines, saw 3 code references, and failed -- while all 9 native reps on that task solved it.
3. **No pre-edit retrieval measure separates a solved sweet rollout from a failed one once task difficulty is held fixed.** Only 6 of 20 tasks have both a sweet solve and a sweet failure. Across those 6, the best measure is *chars of tool output pre-edit* at 5 tasks up / 1 down, sign-test p = 0.219, and it points the wrong way for a narrowing lever: the rollouts that solved read MORE. The eye-catching pooled odds ratios in B1/B3 are task mix, not behaviour.
4. **The sufficiency-verdict lever is aimed at a behaviour the agent already has.** After a `sufficient=no` or `sufficient=unknown` verdict the agent's next action is another search 52% of the time and a read 29% of the time; it goes straight to an edit 3% of the time. There is no population of rollouts that sees a low verdict and charges ahead.
5. **All three candidate levers are cheap.** Re-send-corrected, one extra ss-grep costs 0.26% of the sweet arm's prompt tokens, a footer on singleton hits 0.44%, and reading the whole edited file when it is under 500 lines 0.22% (0.41% among the 94/180 rollouts where it fires). At ~93% cache hits the dollar effect is roughly a tenth of that. Cost is not what should decide these.

## A. sweet vs native


**A1 pooled (180 vs 180)**

| measure | POOL native | POOL sweet |
|---|---|---|
| 1 first content-search hits | 57.61 / 54 | 17.2 / 11 |
| 1 singleton_first (content) % | 2.4% (n=168) | 5.0% (n=180) |
| 1 singleton_first (as-spec) % | 11.8% (n=169) | 5.0% (n=180) |
| 2 broad search pre-edit % | 93.3% (n=180) | 64.4% (n=180) |
| 3 distinct code refs pre (norm) | 113.17 / 99.5 | 58.24 / 51 |
| 3 distinct refs, spec regex only | 67.73 / 41.5 | 58.24 / 51 |
| 4 edited-file frac in view pre | 0.64 / 0.75 | 0.67 / 0.86 |
| 5 whole edited file read pre % | 36.7% (n=180) | 21.7% (n=180) |
| 6 files read pre-edit | 6.66 / 6 | 4.26 / 4 |
| 6 chars of tool output pre-edit | 59465.2 / 57955.5 | 48990.5 / 43193 |
| 6 tool calls pre-edit | 14.98 / 14 | 11.91 / 11 |
| - searches pre-edit (content) | 4.37 / 4 | 4.88 / 4 |
| - steps to first edit | 19.22 / 19 | 17.65 / 16 |
| - subagent tool calls | 8.33 / 0 | 1.49 / 0 |
| - subagent output chars | 28413.6 / 0 | 6121.41 / 0 |

<sub>numeric cells are mean / median; share cells are % true (n with a defined value).</sub>

**A2 per harness (30 vs 30 each)**

| measure | codex native | codex sweet | opencode native | opencode sweet | claudecode native | claudecode sweet |
|---|---|---|---|---|---|---|
| 1 first content-search hits | 66.93 / 64 | 25.47 / 10 | 60.93 / 61 | 14.05 / 11 | 42.2 / 39 | 12.08 / 13 |
| 1 singleton_first (content) % | 0.0% (n=60) | 5.0% (n=60) | 3.4% (n=59) | 5.0% (n=60) | 4.1% (n=49) | 5.0% (n=60) |
| 1 singleton_first (as-spec) % | 0.0% (n=60) | 5.0% (n=60) | 30.0% (n=60) | 5.0% (n=60) | 4.1% (n=49) | 5.0% (n=60) |
| 2 broad search pre-edit % | 100.0% (n=60) | 63.3% (n=60) | 100.0% (n=60) | 63.3% (n=60) | 80.0% (n=60) | 66.7% (n=60) |
| 3 distinct code refs pre (norm) | 149.22 / 141.5 | 54.58 / 51 | 136.5 / 121 | 64.32 / 52 | 53.78 / 46 | 55.83 / 51.5 |
| 3 distinct refs, spec regex only | 149.22 / 141.5 | 54.58 / 51 | 0.2 / 0 | 64.32 / 52 | 53.78 / 46 | 55.83 / 51.5 |
| 4 edited-file frac in view pre | 0.68 / 0.95 | 0.65 / 0.86 | 0.62 / 0.65 | 0.7 / 0.89 | 0.61 / 0.74 | 0.65 / 0.81 |
| 5 whole edited file read pre % | 50.0% (n=60) | 16.7% (n=60) | 26.7% (n=60) | 25.0% (n=60) | 33.3% (n=60) | 23.3% (n=60) |
| 6 files read pre-edit | 8.27 / 7 | 4.45 / 3.5 | 7.1 / 7 | 4.23 / 4 | 4.6 / 4 | 4.1 / 3 |
| 6 chars of tool output pre-edit | 69873.4 / 67255 | 45532.2 / 40860.5 | 65323.9 / 65336.5 | 50649.8 / 47251 | 43198.4 / 36685.5 | 50789.7 / 44696.5 |
| 6 tool calls pre-edit | 11.47 / 11 | 11.57 / 11 | 18.9 / 18.5 | 12.87 / 12 | 14.57 / 15 | 11.28 / 9.5 |
| - searches pre-edit (content) | 5.98 / 6 | 4.67 / 4 | 4.22 / 4 | 4.78 / 4 | 2.9 / 2.5 | 5.2 / 4 |
| - steps to first edit | 20.27 / 20 | 22.32 / 22 | 21.82 / 21 | 16.57 / 15.5 | 15.57 / 16 | 14.07 / 12 |
| - subagent tool calls | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 25 / 28 | 4.47 / 0 |
| - subagent output chars | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 85240.8 / 74958 | 18364.2 / 0 |

<sub>numeric cells are mean / median; share cells are % true (n with a defined value).</sub>

## B. within-arm: solved vs failed


**B1 sweet, all 20 tasks** (n=180, solved=58)

| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |
|---|---|---|---|---|---|
| 1 first content-search hits | 11 | 39 / 59 | 19 / 63 | 2.19 | - |
| 1 singleton_first (content) % | true | 3 / 6 | 55 / 116 | 1.05 | - |
| 1 singleton_first (as-spec) % | true | 3 / 6 | 55 / 116 | 1.05 | - |
| 2 broad search pre-edit % | true | 37 / 79 | 21 / 43 | 0.96 | - |
| 3 distinct code refs pre (norm) | 51 | 27 / 66 | 31 / 56 | 0.74 | - |
| 3 distinct refs, spec regex only | 51 | 27 / 66 | 31 / 56 | 0.74 | - |
| 4 edited-file frac in view pre | 0.86 | 25 / 68 | 33 / 54 | 0.60 | - |
| 5 whole edited file read pre % | true | 8 / 31 | 50 / 91 | 0.47 | - |
| 6 files read pre-edit | 4 | 26 / 67 | 32 / 55 | 0.67 | - |
| 6 chars of tool output pre-edit | 43193 | 27 / 63 | 31 / 59 | 0.82 | - |
| 6 tool calls pre-edit | 11 | 31 / 61 | 27 / 61 | 1.15 | - |
| - searches pre-edit (content) | 4 | 33 / 80 | 25 / 42 | 0.69 | - |
| - steps to first edit | 16 | 31 / 67 | 27 / 55 | 0.94 | - |

strongest separator: **1 first content-search hits** (crude OR 2.19, MH -)

**B2 sweet, restricted to the 9 sweet-solvable tasks** (n=81, solved=58)

| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |
|---|---|---|---|---|---|
| 1 first content-search hits | 13 | 32 / 9 | 26 / 14 | 1.91 | 1.62 (7 strata) |
| 1 singleton_first (content) % | true | 3 / 3 | 55 / 20 | 0.36 | 0.50 (2 strata) |
| 1 singleton_first (as-spec) % | true | 3 / 3 | 55 / 20 | 0.36 | 0.50 (2 strata) |
| 2 broad search pre-edit % | true | 37 / 9 | 21 / 14 | 2.74 | 1.17 (7 strata) |
| 3 distinct code refs pre (norm) | 38 | 32 / 10 | 26 / 13 | 1.60 | 7.00 (4 strata) |
| 3 distinct refs, spec regex only | 38 | 32 / 10 | 26 / 13 | 1.60 | 7.00 (4 strata) |
| 4 edited-file frac in view pre | 0.62 | 30 / 11 | 28 / 12 | 1.17 | 1.83 (5 strata) |
| 5 whole edited file read pre % | true | 8 / 5 | 50 / 18 | 0.58 | 0.00 (2 strata) |
| 6 files read pre-edit | 3 | 33 / 15 | 25 / 8 | 0.70 | 0.50 (6 strata) |
| 6 chars of tool output pre-edit | 41941 | 29 / 12 | 29 / 11 | 0.92 | 2.50 (5 strata) |
| 6 tool calls pre-edit | 11 | 31 / 11 | 27 / 12 | 1.25 | 1.75 (8 strata) |
| - searches pre-edit (content) | 4 | 33 / 10 | 25 / 13 | 1.72 | 1.38 (5 strata) |
| - steps to first edit | 16 | 31 / 13 | 27 / 10 | 0.88 | 0.86 (9 strata) |

strongest separator: **3 distinct refs, spec regex only** (crude OR 1.60, MH 7.00)

**B3 native, all 20 tasks** (n=180, solved=64)

| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |
|---|---|---|---|---|---|
| 1 first content-search hits | 54 | 27 / 58 | 33 / 50 | 0.71 | - |
| 1 singleton_first (content) % | true | 1 / 3 | 59 / 105 | 0.59 | - |
| 1 singleton_first (as-spec) % | true | 8 / 12 | 53 / 96 | 1.21 | - |
| 2 broad search pre-edit % | true | 61 / 107 | 3 / 9 | 1.71 | - |
| 3 distinct code refs pre (norm) | 99.5 | 31 / 59 | 33 / 57 | 0.91 | - |
| 3 distinct refs, spec regex only | 41.5 | 29 / 61 | 35 / 55 | 0.75 | - |
| 4 edited-file frac in view pre | 0.75 | 25 / 65 | 39 / 51 | 0.50 | - |
| 5 whole edited file read pre % | true | 14 / 52 | 50 / 64 | 0.34 | - |
| 6 files read pre-edit | 6 | 27 / 71 | 37 / 45 | 0.46 | - |
| 6 chars of tool output pre-edit | 57955.5 | 32 / 58 | 32 / 58 | 1.00 | - |
| 6 tool calls pre-edit | 14 | 33 / 61 | 31 / 55 | 0.96 | - |
| - searches pre-edit (content) | 4 | 34 / 68 | 30 / 48 | 0.80 | - |
| - steps to first edit | 19 | 29 / 68 | 35 / 48 | 0.58 | - |

strongest separator: **5 whole edited file read pre %** (crude OR 0.34, MH -)

**B4 native, restricted to the 9 native-solvable tasks** (n=81, solved=64)

| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |
|---|---|---|---|---|---|
| 1 first content-search hits | 46.5 | 31 / 7 | 29 / 9 | 1.37 | 0.56 (9 strata) |
| 1 singleton_first (content) % | true | 1 / 1 | 59 / 15 | 0.25 | - |
| 1 singleton_first (as-spec) % | true | 8 / 1 | 53 / 15 | 2.26 | - |
| 2 broad search pre-edit % | true | 61 / 16 | 3 / 1 | 1.27 | 4.00 (4 strata) |
| 3 distinct code refs pre (norm) | 100 | 31 / 10 | 33 / 7 | 0.66 | 0.40 (8 strata) |
| 3 distinct refs, spec regex only | 39 | 32 / 10 | 32 / 7 | 0.70 | 0.53 (9 strata) |
| 4 edited-file frac in view pre | 0.65 | 29 / 12 | 35 / 5 | 0.35 | 0.00 (4 strata) |
| 5 whole edited file read pre % | true | 14 / 9 | 50 / 8 | 0.25 | 2.00 (5 strata) |
| 6 files read pre-edit | 6 | 27 / 14 | 37 / 3 | 0.16 | 0.50 (8 strata) |
| 6 chars of tool output pre-edit | 65051 | 28 / 13 | 36 / 4 | 0.24 | 0.63 (6 strata) |
| 6 tool calls pre-edit | 14 | 33 / 11 | 31 / 6 | 0.58 | 0.87 (8 strata) |
| - searches pre-edit (content) | 4 | 34 / 8 | 30 / 9 | 1.27 | 1.33 (8 strata) |
| - steps to first edit | 18 | 35 / 12 | 29 / 5 | 0.50 | 1.33 (8 strata) |

strongest separator: **2 broad search pre-edit %** (crude OR 1.27, MH 4.00)

**B5 sweet, within-task sign test** - discriminating tasks (both a solve and a failure in this arm): 6 of 20 -> eclipse-ee4j__yasson-395, getmoto__moto-6716, gleam-lang__gleam-3458, jensneuse__graphql-go-tools-174, python-markdown__markdown-1294, squashql__squashql-295

| measure | tasks where solved > failed | solved < failed | tie | two-sided sign-test p |
|---|---|---|---|---|
| 1 first content-search hits | 3 | 3 | 0 | 1.000 |
| 1 singleton_first (content) % | 0 | 1 | 5 | 1.000 |
| 1 singleton_first (as-spec) % | 0 | 1 | 5 | 1.000 |
| 2 broad search pre-edit % | 1 | 2 | 3 | 1.000 |
| 3 distinct code refs pre (norm) | 4 | 2 | 0 | 0.688 |
| 3 distinct refs, spec regex only | 4 | 2 | 0 | 0.688 |
| 4 edited-file frac in view pre | 2 | 4 | 0 | 0.688 |
| 5 whole edited file read pre % | 0 | 1 | 5 | 1.000 |
| 6 files read pre-edit | 3 | 3 | 0 | 1.000 |
| 6 chars of tool output pre-edit | 5 | 1 | 0 | 0.219 |
| 6 tool calls pre-edit | 2 | 3 | 1 | 1.000 |
| - searches pre-edit (content) | 3 | 2 | 1 | 1.000 |
| - steps to first edit | 2 | 4 | 0 | 0.688 |
| - subagent tool calls | 0 | 0 | 6 | - |
| - subagent output chars | 0 | 0 | 6 | - |

**B6 native, within-task sign test** - discriminating tasks (both a solve and a failure in this arm): 4 of 20 -> gleam-lang__gleam-3458, jensneuse__graphql-go-tools-174, python-markdown__markdown-1294, vazco__uniforms-787

| measure | tasks where solved > failed | solved < failed | tie | two-sided sign-test p |
|---|---|---|---|---|
| 1 first content-search hits | 1 | 2 | 0 | 1.000 |
| 1 singleton_first (content) % | 0 | 0 | 3 | - |
| 1 singleton_first (as-spec) % | 0 | 0 | 3 | - |
| 2 broad search pre-edit % | 1 | 0 | 3 | 1.000 |
| 3 distinct code refs pre (norm) | 2 | 2 | 0 | 1.000 |
| 3 distinct refs, spec regex only | 3 | 1 | 0 | 0.625 |
| 4 edited-file frac in view pre | 2 | 2 | 0 | 1.000 |
| 5 whole edited file read pre % | 1 | 1 | 2 | 1.000 |
| 6 files read pre-edit | 2 | 2 | 0 | 1.000 |
| 6 chars of tool output pre-edit | 2 | 2 | 0 | 1.000 |
| 6 tool calls pre-edit | 2 | 2 | 0 | 1.000 |
| - searches pre-edit (content) | 2 | 1 | 1 | 1.000 |
| - steps to first edit | 3 | 1 | 0 | 0.625 |
| - subagent tool calls | 0 | 1 | 3 | 1.000 |
| - subagent output chars | 0 | 1 | 3 | 1.000 |

## C. within-task contrasts (tasks where sweet loses reps)


**squashql__squashql-295** (gold source files = 14)

| id | arm | res | fcs prog | fcs hits | broad | refs | frac | whole | files | chars | calls | patch/gold |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claudecode-r0 | native | Y | rg | 17 | Y | 42 | 0.8248 | n | 1 | 33256 | 12 | 1/14 |
| claudecode-r1 | native | Y | grep | 26 | Y | 57 | 0.7244 | n | 4 | 45526 | 14 | 1/14 |
| claudecode-r2 | native | Y | None | - | n | 55 | 0.938 | n | 4 | 43955 | 13 | 1/14 |
| codex-r0 | native | Y | rg | 21 | Y | 56 | 0.812 | n | 7 | 62159 | 10 | 1/14 |
| codex-r1 | native | Y | rg | 17 | Y | 147 | 0.812 | n | 14 | 100942 | 14 | 1/14 |
| codex-r2 | native | Y | rg | 19 | Y | 112 | 0.9829 | n | 8 | 81494 | 11 | 1/14 |
| opencode-r0 | native | Y | grep-tool | 100 | Y | 108 | 0.5449 | n | 11 | 79089 | 18 | 1/14 |
| opencode-r1 | native | Y | grep-tool | - | Y | 67 | 0.7244 | n | 7 | 51005 | 16 | 1/14 |
| opencode-r2 | native | Y | grep-tool | 29 | Y | 46 | 0.735 | n | 8 | 70981 | 15 | 1/14 |
| claudecode-r0 | sweet | n | ss-grep | 13 | n | 13 | 0.6004 | n | 1 | 21031 | 12 | 1/14 |
| claudecode-r1 | sweet | Y | ss-search | 12 | n | 14 | 0.9487 | n | 2 | 29900 | 5 | 1/14 |
| claudecode-r2 | sweet | Y | ss-search | 18 | n | 21 | 0.9487 | n | 1 | 35050 | 9 | 1/14 |
| codex-r0 | sweet | n | ss-grep | 1 | n | 3 | 0.141 | n | 1 | 10682 | 8 | 1/14 |
| codex-r1 | sweet | n | ss-grep | 1 | n | 7 | 0.1645 | n | 1 | 11819 | 7 | 1/14 |
| codex-r2 | sweet | n | ss-search | 7 | n | 16 | 0.9487 | n | 1 | 18197 | 7 | 1/14 |
| opencode-r0 | sweet | Y | ss-grep | 1 | n | 17 | 0.9487 | n | 2 | 31007 | 7 | 1/14 |
| opencode-r1 | sweet | n | ss-search | 18 | n | 19 | 0.9487 | n | 1 | 35071 | 7 | 1/14 |
| opencode-r2 | sweet | n | ss-grep | 1 | n | 17 | 0.9487 | n | 1 | 32905 | 7 | 1/14 |

**C-within sweet on squashql__squashql-295** (n=9, solved=3)

| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |
|---|---|---|---|---|---|
| 1 first content-search hits | 7 | 2 / 3 | 1 / 3 | 2.00 | - |
| 1 singleton_first (content) % | true | 1 / 3 | 2 / 3 | 0.50 | - |
| 1 singleton_first (as-spec) % | true | 1 / 3 | 2 / 3 | 0.50 | - |
| 2 broad search pre-edit % | true | 0 / 0 | 3 / 6 | 1.86 | - |
| 3 distinct code refs pre (norm) | 16 | 2 / 3 | 1 / 3 | 2.00 | - |
| 3 distinct refs, spec regex only | 16 | 2 / 3 | 1 / 3 | 2.00 | - |
| 4 edited-file frac in view pre | 0.95 | 3 / 3 | 0 / 3 | 7.00 | - |
| 5 whole edited file read pre % | true | 0 / 0 | 3 / 6 | 1.86 | - |
| 6 chars of tool output pre-edit | 29900 | 3 / 2 | 0 / 4 | 12.60 | - |
| 6 tool calls pre-edit | 7 | 2 / 6 | 1 / 0 | 0.13 | - |
| - searches pre-edit (content) | 2 | 2 / 3 | 1 / 3 | 2.00 | - |
| - steps to first edit | 11 | 1 / 5 | 2 / 1 | 0.10 | - |

strongest separator: **6 chars of tool output pre-edit** (crude OR 12.60, MH -)

**getmoto__moto-6716** (gold source files = 3)

| id | arm | res | fcs prog | fcs hits | broad | refs | frac | whole | files | chars | calls | patch/gold |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claudecode-r0 | native | Y | grep | 100 | Y | 176 | 0.2034 | n | 4 | 117012 | 20 | 1/3 |
| claudecode-r1 | native | Y | grep | 34 | Y | 91 | 1 | Y | 5 | 69593 | 26 | 1/3 |
| claudecode-r2 | native | Y | grep | 33 | Y | 23 | 0.1242 | n | 3 | 37193 | 14 | 1/3 |
| codex-r0 | native | Y | rg | 79 | Y | 284 | 0.1032 | n | 6 | 111921 | 15 | 1/3 |
| codex-r1 | native | Y | rg | 99 | Y | 223 | 0.187 | n | 5 | 55416 | 10 | 1/3 |
| codex-r2 | native | Y | rg | 122 | Y | 179 | 0.2152 | n | 4 | 50092 | 8 | 1/3 |
| opencode-r0 | native | Y | grep-tool | 100 | Y | 141 | 0.1588 | n | 2 | 48009 | 16 | 1/3 |
| opencode-r1 | native | Y | grep-tool | 100 | Y | 209 | 0.2395 | n | 5 | 75270 | 16 | 1/3 |
| opencode-r2 | native | Y | grep-tool | 100 | Y | 243 | 0.1661 | n | 5 | 73981 | 15 | 1/3 |
| claudecode-r0 | sweet | Y | ss-search | 20 | Y | 51 | 0.139 | n | 4 | 45982 | 16 | 1/3 |
| claudecode-r1 | sweet | Y | ss-search | 11 | Y | 125 | 0.2328 | n | 4 | 70124 | 17 | 1/3 |
| claudecode-r2 | sweet | Y | ss-search | 14 | Y | 120 | 0.207 | n | 3 | 71578 | 19 | 1/3 |
| codex-r0 | sweet | n | ss-search | 15 | n | 97 | 0.2295 | n | 2 | 41341 | 10 | 1/3 |
| codex-r1 | sweet | Y | ss-grep | 366 | Y | 103 | 0.2225 | n | 2 | 43302 | 15 | 1/3 |
| codex-r2 | sweet | n | ss-search | 7 | Y | 86 | 0.3895 | n | 5 | 81056 | 18 | 1/3 |
| opencode-r0 | sweet | Y | ss-grep | 15 | Y | 164 | 0.4077 | n | 4 | 83179 | 20 | 1/3 |
| opencode-r1 | sweet | n | ss-search | 7 | Y | 73 | 0.1214 | n | 4 | 60571 | 11 | 1/3 |
| opencode-r2 | sweet | Y | ss-search | 11 | Y | 85 | 0.201 | n | 3 | 66405 | 23 | 1/3 |

**C-within sweet on getmoto__moto-6716** (n=9, solved=6)

| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |
|---|---|---|---|---|---|
| 1 first content-search hits | 14 | 4 / 1 | 2 / 2 | 4.00 | - |
| 1 singleton_first (content) % | true | 0 / 0 | 6 / 3 | 0.54 | - |
| 1 singleton_first (as-spec) % | true | 0 / 0 | 6 / 3 | 0.54 | - |
| 2 broad search pre-edit % | true | 6 / 2 | 0 / 1 | 7.80 | - |
| 3 distinct code refs pre (norm) | 97 | 4 / 1 | 2 / 2 | 4.00 | - |
| 3 distinct refs, spec regex only | 97 | 4 / 1 | 2 / 2 | 4.00 | - |
| 4 edited-file frac in view pre | 0.22 | 3 / 2 | 3 / 1 | 0.50 | - |
| 5 whole edited file read pre % | true | 0 / 0 | 6 / 3 | 0.54 | - |
| 6 files read pre-edit | 4 | 3 / 2 | 3 / 1 | 0.50 | - |
| 6 chars of tool output pre-edit | 66405 | 4 / 1 | 2 / 2 | 4.00 | - |
| 6 tool calls pre-edit | 17 | 4 / 1 | 2 / 2 | 4.00 | - |
| - searches pre-edit (content) | 10 | 4 / 1 | 2 / 2 | 4.00 | - |
| - steps to first edit | 23 | 4 / 1 | 2 / 2 | 4.00 | - |

strongest separator: **2 broad search pre-edit %** (crude OR 7.80, MH -)

**gleam-lang__gleam-3458** (gold source files = 1)

| id | arm | res | fcs prog | fcs hits | broad | refs | frac | whole | files | chars | calls | patch/gold |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claudecode-r0 | native | Y | None | - | n | 2 | 0.0372 | n | 1 | 15198 | 5 | 1/1 |
| claudecode-r1 | native | Y | grep | 4 | Y | 13 | 0.0553 | n | 1 | 17269 | 7 | 1/1 |
| claudecode-r2 | native | Y | grep | 2 | Y | 131 | 0.1982 | n | 6 | 63926 | 18 | 1/1 |
| codex-r0 | native | n | rg | 65 | Y | 208 | 0.3333 | n | 8 | 128444 | 19 | 2/1 |
| codex-r1 | native | Y | rg | 70 | Y | 320 | 0.2531 | n | 8 | 114666 | 16 | 2/1 |
| codex-r2 | native | n | rg | 81 | Y | 387 | 0.5444 | n | 12 | 169609 | 23 | 2/1 |
| opencode-r0 | native | Y | grep-tool | 100 | Y | 372 | 0.2841 | n | 9 | 137004 | 40 | 1/1 |
| opencode-r1 | native | Y | grep-tool | 100 | Y | 166 | 0.3091 | n | 7 | 79186 | 22 | 2/1 |
| opencode-r2 | native | Y | grep-tool | 100 | Y | 197 | 0.2511 | n | 7 | 90886 | 24 | 2/1 |
| claudecode-r0 | sweet | Y | ss-search | 14 | Y | 82 | 0.1841 | n | 7 | 100838 | 25 | 1/1 |
| claudecode-r1 | sweet | Y | ss-search | 14 | n | 38 | 0.1346 | n | 7 | 41941 | 6 | 1/1 |
| claudecode-r2 | sweet | Y | ss-search | 15 | n | 85 | 0.3039 | n | 8 | 113433 | 15 | 1/1 |
| codex-r0 | sweet | n | ss-search | 15 | Y | 65 | 0.2874 | n | 6 | 62003 | 15 | 1/1 |
| codex-r1 | sweet | Y | ss-search | 15 | n | 60 | 0.2428 | n | 8 | 67192 | 15 | 1/1 |
| codex-r2 | sweet | Y | ss-search | 14 | n | 48 | 0.436 | n | 7 | 65162 | 12 | 1/1 |
| opencode-r0 | sweet | n | ss-search | 14 | Y | 95 | 0.3382 | n | 6 | 136247 | 24 | 1/1 |
| opencode-r1 | sweet | n | ss-search | 15 | n | 37 | 0.2675 | n | 4 | 48030 | 12 | 2/1 |
| opencode-r2 | sweet | Y | ss-search | 16 | n | 38 | 0.147 | n | 6 | 49375 | 14 | 1/1 |

**C-within sweet on gleam-lang__gleam-3458** (n=9, solved=6)

| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |
|---|---|---|---|---|---|
| 1 first content-search hits | 15 | 3 / 2 | 3 / 1 | 0.50 | - |
| 1 singleton_first (content) % | true | 0 / 0 | 6 / 3 | 0.54 | - |
| 1 singleton_first (as-spec) % | true | 0 / 0 | 6 / 3 | 0.54 | - |
| 2 broad search pre-edit % | true | 1 / 2 | 5 / 1 | 0.10 | - |
| 3 distinct code refs pre (norm) | 60 | 3 / 2 | 3 / 1 | 0.50 | - |
| 3 distinct refs, spec regex only | 60 | 3 / 2 | 3 / 1 | 0.50 | - |
| 4 edited-file frac in view pre | 0.27 | 2 / 3 | 4 / 0 | 0.08 | - |
| 5 whole edited file read pre % | true | 0 / 0 | 6 / 3 | 0.54 | - |
| 6 files read pre-edit | 7 | 5 / 0 | 1 / 3 | 25.67 | - |
| 6 chars of tool output pre-edit | 65162 | 4 / 1 | 2 / 2 | 4.00 | - |
| 6 tool calls pre-edit | 15 | 3 / 2 | 3 / 1 | 0.50 | - |
| - searches pre-edit (content) | 4 | 3 / 2 | 3 / 1 | 0.50 | - |
| - steps to first edit | 23 | 3 / 2 | 3 / 1 | 0.50 | - |

strongest separator: **6 files read pre-edit** (crude OR 25.67, MH -)

## D. the sufficiency-verdict claim

| population | n(with verdicts) | metric | solved | failed |
|---|---|---|---|---|
| sweet, all 20 tasks | 169 | saw conf=low | 67.2% (n=58) | 92.8% (n=111) |
| sweet, all 20 tasks | 169 | saw conf=high | 29.3% (n=58) | 21.6% (n=111) |
| sweet, all 20 tasks | 169 | saw sufficient=YES | 44.8% (n=58) | 34.2% (n=111) |
| sweet, all 20 tasks | 169 | LAST verdict overall = YES | 34.5% (n=58) | 18.9% (n=111) |
| sweet, all 20 tasks | 169 | LAST pre-edit verdict = YES | 34.5% (n=58) | 18.0% (n=111) |
| sweet, all 20 tasks | 169 | any pre-edit verdict | 100.0% (n=58) | 99.1% (n=111) |
| sweet, 9 solvable tasks | 79 | saw conf=low | 67.2% (n=58) | 90.5% (n=21) |
| sweet, 9 solvable tasks | 79 | saw conf=high | 29.3% (n=58) | 23.8% (n=21) |
| sweet, 9 solvable tasks | 79 | saw sufficient=YES | 44.8% (n=58) | 23.8% (n=21) |
| sweet, 9 solvable tasks | 79 | LAST verdict overall = YES | 34.5% (n=58) | 19.0% (n=21) |
| sweet, 9 solvable tasks | 79 | LAST pre-edit verdict = YES | 34.5% (n=58) | 14.3% (n=21) |
| sweet, 9 solvable tasks | 79 | any pre-edit verdict | 100.0% (n=58) | 95.2% (n=21) |
| sweet, squashql__squashql-295 | 7 | saw conf=low | 100.0% (n=3) | 100.0% (n=4) |
| sweet, squashql__squashql-295 | 7 | saw conf=high | 33.3% (n=3) | 25.0% (n=4) |
| sweet, squashql__squashql-295 | 7 | saw sufficient=YES | 66.7% (n=3) | 25.0% (n=4) |
| sweet, squashql__squashql-295 | 7 | LAST verdict overall = YES | 33.3% (n=3) | 25.0% (n=4) |
| sweet, squashql__squashql-295 | 7 | LAST pre-edit verdict = YES | 33.3% (n=3) | 0.0% (n=4) |
| sweet, squashql__squashql-295 | 7 | any pre-edit verdict | 100.0% (n=3) | 75.0% (n=4) |
| sweet, getmoto__moto-6716 | 9 | saw conf=low | 100.0% (n=6) | 100.0% (n=3) |
| sweet, getmoto__moto-6716 | 9 | saw conf=high | 83.3% (n=6) | 0.0% (n=3) |
| sweet, getmoto__moto-6716 | 9 | saw sufficient=YES | 16.7% (n=6) | 0.0% (n=3) |
| sweet, getmoto__moto-6716 | 9 | LAST verdict overall = YES | 0.0% (n=6) | 0.0% (n=3) |
| sweet, getmoto__moto-6716 | 9 | LAST pre-edit verdict = YES | 0.0% (n=6) | 0.0% (n=3) |
| sweet, getmoto__moto-6716 | 9 | any pre-edit verdict | 100.0% (n=6) | 100.0% (n=3) |
| sweet, gleam-lang__gleam-3458 | 9 | saw conf=low | 50.0% (n=6) | 100.0% (n=3) |
| sweet, gleam-lang__gleam-3458 | 9 | saw conf=high | 100.0% (n=6) | 100.0% (n=3) |
| sweet, gleam-lang__gleam-3458 | 9 | saw sufficient=YES | 0.0% (n=6) | 33.3% (n=3) |
| sweet, gleam-lang__gleam-3458 | 9 | LAST verdict overall = YES | 0.0% (n=6) | 33.3% (n=3) |
| sweet, gleam-lang__gleam-3458 | 9 | LAST pre-edit verdict = YES | 0.0% (n=6) | 33.3% (n=3) |
| sweet, gleam-lang__gleam-3458 | 9 | any pre-edit verdict | 100.0% (n=6) | 100.0% (n=3) |

**next tool after a verdict**

| next action | after sufficient=no/unknown | after sufficient=YES |
|---|---|---|
| ss-grep | 215 (36%) | 31 (25%) |
| ss-read | 170 (29%) | 52 (42%) |
| ss-find | 51 (9%) | 5 (4%) |
| ss-search | 40 (7%) | 9 (7%) |
| Bash | 16 (3%) | 8 (7%) |
| EDIT | 18 (3%) | 6 (5%) |
| todowrite | 19 (3%) | 0 (0%) |
| update_plan | 12 (2%) | 6 (5%) |
| ss-semantic | 13 (2%) | 0 (0%) |
| ss-trace | 10 (2%) | 0 (0%) |
| bash | 4 (1%) | 5 (4%) |
| git | 7 (1%) | 0 (0%) |
| exec_command | 6 (1%) | 0 (0%) |
| TaskUpdate | 6 (1%) | 0 (0%) |
| node | 2 (0%) | 0 (0%) |
| {"session_id": | 2 (0%) | 0 (0%) |
| shell-apply_patch | 0 (0%) | 1 (1%) |
| **total** | 591 | 123 |

**the same two metrics, one row per discriminating task (both a solve and a failure in sweet)**

| task | solved reps | failed reps | saw conf=low: solved / failed | last verdict = YES: solved / failed |
|---|---|---|---|---|
| eclipse-ee4j__yasson-395 | 2 | 7 | 100% / 100% | 0% / 0% |
| getmoto__moto-6716 | 6 | 3 | 100% / 100% | 0% / 0% |
| gleam-lang__gleam-3458 | 6 | 3 | 50% / 100% | 0% / 33% |
| jensneuse__graphql-go-tools-174 | 7 | 2 | 100% / 100% | 29% / 0% |
| python-markdown__markdown-1294 | 7 | 2 | 14% / 0% | 100% / 100% |
| squashql__squashql-295 | 3 | 4 | 100% / 100% | 33% / 25% |

last-verdict-YES points the right way on **2** tasks, the wrong way on **1**, ties on **3**. With task difficulty held fixed the verdict carries no usable signal.

**plain answer.** The original numbers reproduce: pooled, 67.2% of solved sweet rollouts saw a `confidence=low` verdict against 92.8% of failed, and 34.5% ended on `sufficient=YES` against 18.9%. Restricting to the 9 sweet-solvable tasks keeps the direction (67.2 vs 90.5, and 34.5 vs 14.3). But the association is between the verdict and *how hard the task is*, not between the verdict and the outcome of a given attempt: the 11 tasks nobody ever solves are the tasks where every search comes back low-confidence. Held at one task the signal disappears or reverses, and the proposed remedy -- widen the search when the verdict is low -- describes what the agent already does in 52% of cases.

## E. the cells where sweet gained reps over native

| harness | task | native solves /3 | sweet solves /3 | delta |
|---|---|---|---|---|
| codex | eclipse-ee4j__yasson-395 | 0 | 2 | +2 |
| codex | gleam-lang__gleam-3458 | 1 | 2 | +1 |
| opencode | jensneuse__graphql-go-tools-174 | 2 | 3 | +1 |
| claudecode | python-markdown__markdown-1294 | 2 | 3 | +1 |
| claudecode | vazco__uniforms-787 | 2 | 3 | +1 |

<sub>the brief named 4 gain cells; the data has **5** (gleam-lang__gleam-3458 on codex, 1 -> 2, was missing).</sub>

| cell | arm-rep | solved | pre-edit calls | code refs | edited-file frac in view | files read | output chars | patched file(s) |
|---|---|---|---|---|---|---|---|---|
| codex/yasson-395 | native-r0 | n | 16 | 146 | 1.0 | 19 | 108495 | SerializerBuilder.java |
| codex/yasson-395 | native-r1 | n | 11 | 107 | 1.0 | 18 | 91610 | SerializerBuilder.java |
| codex/yasson-395 | native-r2 | n | 13 | 99 | 1.0 | 13 | 83884 | SerializerBuilder.java |
| codex/yasson-395 | sweet-r0 | n | 9 | 16 | 0.9769 | 3 | 33949 | Marshaller.java |
| codex/yasson-395 | sweet-r1 | Y | 19 | 74 | 0.9827 | 11 | 77894 | Marshaller.java |
| codex/yasson-395 | sweet-r2 | Y | 15 | 67 | 0.9827 | 7 | 64290 | Marshaller.java |
| codex/gleam-3458 | native-r0 | n | 19 | 208 | 0.3333 | 8 | 128444 | engine.rs, type_.rs |
| codex/gleam-3458 | native-r1 | Y | 16 | 320 | 0.2531 | 8 | 114666 | engine.rs, type_.rs |
| codex/gleam-3458 | native-r2 | n | 23 | 387 | 0.5444 | 12 | 169609 | typed.rs, engine.rs |
| codex/gleam-3458 | sweet-r0 | n | 15 | 65 | 0.2874 | 6 | 62003 | type_.rs |
| codex/gleam-3458 | sweet-r1 | Y | 15 | 60 | 0.2428 | 8 | 67192 | type_.rs |
| codex/gleam-3458 | sweet-r2 | Y | 12 | 48 | 0.436 | 7 | 65162 | type_.rs |
| opencode/graphql-go-tools-174 | native-r0 | Y | 13 | 98 | 0.2528 | 5 | 57035 | astvalidation.go, planning.go |
| opencode/graphql-go-tools-174 | native-r1 | n | 21 | 212 | 0.1904 | 6 | 99546 | astvalidation.go |
| opencode/graphql-go-tools-174 | native-r2 | Y | 21 | 287 | 0.5221 | 5 | 83848 | astvalidation.go, execution.go, planning.go |
| opencode/graphql-go-tools-174 | sweet-r0 | Y | 22 | 113 | 0.4976 | 6 | 81526 | astvalidation.go, planning.go |
| opencode/graphql-go-tools-174 | sweet-r1 | Y | 8 | 62 | 0.1549 | 1 | 32744 | astvalidation.go, planning.go |
| opencode/graphql-go-tools-174 | sweet-r2 | Y | 20 | 218 | 0.392 | 4 | 62433 | astvalidation.go, planning.go |
| claudecode/markdown-1294 | native-r0 | Y | 6 | 42 | 0.6244 | 1 | 30492 | toc.py |
| claudecode/markdown-1294 | native-r1 | Y | 7 | 41 | 0.6244 | 2 | 27078 | toc.py |
| claudecode/markdown-1294 | native-r2 | n | 5 | 0 | 0.7637 | 1 | 22433 | toc.py |
| claudecode/markdown-1294 | sweet-r0 | Y | 8 | 26 | 0.5746 | 3 | 29640 | toc.py |
| claudecode/markdown-1294 | sweet-r1 | Y | 4 | 9 | 0.5796 | 1 | 19289 | toc.py |
| claudecode/markdown-1294 | sweet-r2 | Y | 5 | 4 | 0.9577 | 1 | 25793 | toc.py |
| claudecode/uniforms-787 | native-r0 | n | 7 | 0 | 0.8738 | 1 | 12279 | GraphQLBridge.ts |
| claudecode/uniforms-787 | native-r1 | Y | 19 | 14 | 1.0 | 8 | 33859 | GraphQLBridge.ts |
| claudecode/uniforms-787 | native-r2 | Y | 13 | 16 | 1.0 | 3 | 19472 | GraphQLBridge.ts |
| claudecode/uniforms-787 | sweet-r0 | Y | 7 | 17 | 1.0 | 2 | 32610 | GraphQLBridge.ts |
| claudecode/uniforms-787 | sweet-r1 | Y | 9 | 17 | 0.9029 | 3 | 26389 | GraphQLBridge.ts |
| claudecode/uniforms-787 | sweet-r2 | Y | 9 | 8 | 1.0 | 2 | 25370 | GraphQLBridge.ts |

**did the rollout run one broad symbol-family search before its first edit?**

| cell | native yes/3 | sweet yes/3 |
|---|---|---|
| codex/yasson-395 | 3 | 2 |
| codex/gleam-3458 | 3 | 1 |
| opencode/graphql-go-tools-174 | 3 | 1 |
| claudecode/markdown-1294 | 3 | 2 |
| claudecode/uniforms-787 | 2 | 2 |

## F. token cost of the candidate levers

| observed tool-output size (chars) | n | p25 | median | p75 | median tokens @4 chars/token |
|---|---|---|---|---|---|
| ss-grep step output | 541 | 413 | 885 | 1981 | 221 |
| ss-read step output | 1018 | 2463 | 4422 | 7276 | 1106 |

sanity check on the denominator: mean sweet prompt tokens per rollout measured from rows.json = codex 530,299 (brief 541k), claudecode 908,965 (brief 1,140k); opencode rows carry only a turn count, so its 481k comes from the brief. The tables below use the brief's figures.

measured line cost: median **37 chars per source line** of ss-read output (n=279 ranged reads), i.e. ~9 tokens per line.

**cost model.** A tool output of T tokens produced at call k of N is re-sent in the N-k+1 later requests, so its cost against the rollout's prompt-token total is T x (N-k+1), not T.

| lever | added tokens once | re-send multiplier (mean/median) | added prompt tokens per rollout (mean) | % of sweet prompt tokens |
|---|---|---|---|---|
| (i) one extra ss-grep of a stem in the edited file, just before the first edit | 221 | 8.6 / 8 | 1,906 | 0.26% |
| (ii) +30-token footer on every singleton ss-grep and every ranged ss-read (8.5 such calls per rollout) | 30 x 8.5 | 12.5 / - | 3,190 | 0.44% |
| (iii) read the whole edited file when under 500 lines (applies to 94/180 sweet rollouts; mean 37 unseen lines when it applies, 19 averaged over all) | 181 | 8.6 / 8 | 1,559 | 0.22% |
| (iii) restricted to the 94 rollouts where the rule fires | 346 | 8.6 / 8 | 2,985 | 0.41% |

<sub>edited files with a known length (n=207 file-instances in the sweet arm): median 469 lines, 52% under 500 lines. Cache: ~93% of prompt tokens are cache hits, so the dollar effect is roughly 1/10 of the token percentages above.</sub>


### E, in plain terms

On yasson-395 the gain is a file-selection win, not a depth win: all three codex native reps edit `SerializerBuilder.java` and all three fail, while all three sweet reps edit `Marshaller.java`, the file the gold patch touches, because the first `ss-search` named it. The sweet rep that still failed (codex sweet-r0) did 9 pre-edit calls and saw 16 references, against 19/74 and 15/67 for the two that solved. On uniforms-787 and markdown-1294 the failing native rep is the shallow one (7 and 5 pre-edit calls, 0 code references) while every sweet rep ran a symbol-family `ss-grep` before editing.
A rule of *always run one broad stem grep of the symbol family in the edited file before the first edit* would have changed the path in exactly one of these 15 sweet rollouts: codex/yasson sweet-r0, the only sweet failure among them, which went straight from one `ss-search` to ranged reads. In the other 14 it either fires on a search the rollout already made or adds one call. Native already satisfies the rule in 14 of 15 of these rollouts, sweet in 8 of 15 -- so the rule mostly closes a gap sweet opened, at the cost in F(i): about 220 tokens once, 1.9k prompt tokens after re-send, 0.26%.

## Method, and what these numbers cannot say

- Source: the 360 normalised transcripts in `$S/norm/<harness>/`, the three `rows.json` outcome files, `$S/traces/<run>/{native,sweet}[/rep-N]/patches.json` for the final patch file list, and `$S/gold/*.gold.diff`. Scripts: `$S/census/{parselib,census,report,ef}.py`; per-rollout records in `$S/census/rollouts.jsonl`. Re-run with `python3 census.py && python3 report.py`.
- **Edits are not always a tool call.** codex applies some patches as `apply_patch <<'PATCH'` inside a shell call, so 5 rollouts had no `EDIT` heading; shell-level `apply_patch`/`sed -i` now counts as the first edit. Without that fix those rollouts measure their whole trajectory as pre-edit.
- **`sufficient=YES` is uppercase** in the tool output while `no`/`unknown` are lowercase. A case-sensitive scan finds zero YES verdicts. There are 135.
- **Measure 3 is harness-shaped.** opencode's grep tool prints `<path>:` then `  Line N:` instead of `path:line`, so the brief's regex scores opencode native at 0.2 refs. The reported figure normalises that format; the raw-regex row is kept beside it.
- **Measure 4 and 5 denominators had to be repaired.** `ss-read` prints a true file length (`lines a-b of N`); native never calls `ss-read`, so on native alone the only denominator available is the highest line number the transcript happens to show, which scored 129 native file-instances as a whole-file read purely because nothing deeper was ever mentioned. True lengths are therefore harvested from every `ss-read` header in **any** rollout of the same task and applied to both arms: 479 of 480 edited-file instances now have a real line count. With the broken denominators the whole-file rate read 55.0% native / 47.2% sweet; corrected it is **36.7% / 21.7%**. Do not use the earlier figure.
- **claudecode subagents** are reported in their own columns and excluded from the pre-edit measures. claudecode native puts 25 tool calls and 85k output chars per rollout inside a subagent; 10 of its 60 native rollouts run no search at all in the main transcript because the subagent did it.
- Hit counts for native shell searches come from the step output; 68 of 180 native rollouts issue their first content search inside a compound `a && b; c` command, so that count can include other commands' lines. ss-* hit counts are exact (`# ss-grep: N total match(es)`, `results=N`).
- Nine rollouts per task-arm cell is too few for a within-task test. Section C tables are evidence for reading trajectories, not significance claims.
