# Forensics "verify-tail": the post-edit request tail on the three production fresh-pool runs

Date: 2026-09-02. Agent: verify-tail (slate C forensics). Cost of this work: $0 (trace reading only).

## 0. Verdict

Sweet's post-edit tail is not longer than native's on any harness. After the last edit, every arm on every harness spends 4.2 to 5.2 more requests, which is 15 to 26 percent of the rollout's cost, and the composition of that tail is the same in both arms: one verification `run_tests`, half to one `git diff`/`git status`, one to two plan-tool bookkeeping requests, and the final answer. Paired per task, sweet's tail is shorter than native's on opencode (3 tasks longer, 14 shorter, 5 tied; −0.44 requests, −$0.000399 per rollout) and on claude-code (7 longer, 13 shorter, 2 tied; −0.16 requests) and equal on codex (12 longer, 8 shorter, 2 tied; +0.18 requests, −$0.000026). The whole sweet premium therefore lives before the last edit: the opencode head costs +10.5 percent in sweet ($0.007312 against $0.006616) while its tail costs −17 percent. Unsolved rollouts do not have longer tails than solved ones (4 of 6 cells show the opposite), so there is no doomed tail to cut. Two facts are new. First, the harness plan tools (`update_plan` on codex, `todowrite` on opencode, `TodoWrite` on claude-code) are always a request of their own: 3.8 to 4.1 such requests per rollout on codex and opencode (19 to 24 percent of all requests) and 1.9 to 2.1 on claude-code; removing them would save 10.9 to 13.1 percent of a codex or opencode rollout and 3.7 percent of a claude-code rollout. That class is on no register row and no document priced it; it is arm-symmetric today, and the sweet-only tool guide is the only sweet-only vehicle for it. Second, the largest sweet tails on all three harnesses are one task's hunt through a 35,000-line committed bundle, driven by `ss-grep --in dist/index.js` answering "0 total match(es)" on a file the index never held; the "not indexed" hint shipped on 2026-08-28 targets exactly this case, so the mechanism is recorded (register rows E1 and E2) and this report only prices it. Rollouts that end on a failed edit with no retry: 1 of 396. Rollouts whose last message is a state summary and whose patch is empty: 1 of 396 (the known premature stop on `celestiaorg__nmt-192`). The 2026-08-28 claim that cost is flat by request position holds: the last quarter of requests costs 1.00 to 1.18 times the first quarter at the cache-normalised price, and the tail costs 0.80 to 0.92 times as much per request as the head.

## 1. Scope, data and method

Runs: `fp-codex-tab-20260826` (132 rows), `fp-opencode-tab-20260826` (66 native rows plus the 33 sweet rows of the 11 non-repair tasks), `rp-oc-tab-20260827` (33 sweet rows of the 11 repair tasks; this is the opencode repair pass and supersedes the 30 fp sweet rows of those tasks), `fp-claudecode-tab-20260826` (132 rows). Total 396 rollouts, 66 per cell [M `tail_census.py`]. Solved counts reproduce the brief exactly: codex 41/39, opencode 41/41, claude-code 43/40 (native/sweet) [M].

Requests are rebuilt from the raw transcripts, not from `turns/` (which rep 1 overwrites). Alignment rules [M, verified on raw event dumps]: codex, every `function_call` between two `token_count` events belongs to the later one, and codex never emits two calls in one request (0 of 2,538 requests); opencode, one `step_finish` is one request and its `tool_use` parts are its calls (447 of 3,015 requests carry several calls); claude-code, one `message.id` is one request, usage taken from the record with the largest input+output, tool_use blocks deduplicated by id, main thread only. Price vector: $0.10 per million new input, $0.01 cached, $0.60 output including reasoning; claude-code cache writes at 1.25 times, as in `e2-harvest.mjs`.

Validation [M `tail_census.py` validation pass]: the per-request cost sum matches `costRealizedUsd` (codex, opencode) or `costRealizedMainOnlyUsd` (claude-code) within 0.01 percent on all 396 rollouts; request counts equal `idealTurns` on all 264 codex and opencode rows; every rollout with a non-empty patch has at least one detected edit request (0 misses). The 66 claude-code rows whose request count differs from `idealTurns` all have `idealTurns` and `costRealizedUsd` null (incomplete sidechain accounting), and their main-thread cost matches exactly.

Definitions. Edit request: a request with an `apply_patch` (heredoc or tool), `Edit`/`MultiEdit`/`Write`, opencode `edit`/`write`/`patch`, or a shell write (`sed -i`, redirection into a repo file, script write). Tail: every request after the last edit request (failed or not). The variant "after the last successful edit" changes only claude-code sweet (4.29 instead of 4.23 tail requests) [M `tail_report.py`]. Removable tail: the tail minus the final text-only answer. A request's class is the highest-priority class among its calls: `run_tests` > poll of a run_tests session > direct test runner > edit > git revert > git diff/status > other git > re-read of an already-edited file > `ss-read` of another file > `ss-search`/`ss-grep`/`ss-find`/`ss-semantic`/`ss-trace` > native read (`cat`/`sed`/`nl`/`Read`/opencode `read`) > native find (`rg`/`grep`/`find`/`Grep`/`Glob`) > delegate > poll > plan tool > other > text only.

Scripts (part of the evidence): `scripts-verify-tail/tail_census.py` (parser, runs on the box), `tail_report.py` (tables), `tail_extras.py` (head/tail split, plan tool, bundle hunt, unverified edits), `harness_prompt_check.py`. Outputs: `tail-report-tables.md`, `tail-extras-output.md`, `tail-summary.json`. The 7.3 MB per-request census is at `/tmp/wf-slatec/verify-tail/tail-census.json` on the box.

## 2. Tail length and cost per arm

| harness | arm | n | tail requests mean / median / p90 / max | tail share of requests | tail $ per rollout | tail share of $ | removable requests | removable $ share | tail $/request ÷ head $/request |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| codex | native | 66 | 4.86 / 5 / 6 / 10 | 25.8% | $0.002723 | 22.2% | 3.86 | 18.2% | 0.87 |
| codex | sweet | 66 | 5.05 / 5 / 7 / 11 | 25.7% | $0.002697 | 21.9% | 4.05 | 18.1% | 0.85 |
| opencode | native | 66 | 5.21 / 5 / 7 / 11 | 31.9% | $0.002352 | 26.2% | 4.21 | 21.7% | 0.82 |
| opencode | sweet | 66 | 4.77 / 5 / 6 / 13 | 24.2% | $0.001953 | 21.1% | 3.77 | 16.8% | 0.92 |
| claude-code | native | 66 | 4.38 / 4 / 7 / 10 | 18.0% | $0.002475 | 15.0% | 3.38 | 11.6% | 0.81 |
| claude-code | sweet | 65 | 4.23 / 4 / 7 / 14 | 18.0% | $0.002444 | 14.8% | 3.23 | 11.3% | 0.80 |

All [M `tail_report.py`]. Claude-code sweet has one rollout with no edit (`fp-claudecode-tab-20260826/celestiaorg__nmt-192/sweet/r0`), excluded from the tail basis.

Paired per task (22 tasks, means over 3 reps per arm) [M]: codex sweet longer 12, native longer 8, tie 2, mean +0.18 requests, mean −$0.000026 per rollout; opencode 3 / 14 / 5, −0.44 requests, −$0.000399; claude-code 7 / 13 / 2, −0.16 requests, −$0.000046.

Where the sweet premium lives [M `tail_extras.py` §1]. Head cost (through the last edit): codex native $0.009565 vs sweet $0.009633 (+0.7%); opencode native $0.006616 vs sweet $0.007312 (+10.5%, on 11.11 vs 14.92 head requests, which is +3.8 requests); claude-code main thread native $0.014067 vs sweet $0.014057 (−0.1%). Tail cost: codex −1.0%, opencode −17.0%, claude-code −1.3% for sweet. The opencode +3.3 percent headline is entirely pre-edit; the brief's "+3.4 requests" driver sits in the head, and the tail gives back a third of it.

Tail token anatomy per rollout [M]: the tail re-sends 122k to 167k billed input tokens, ingests only 2.2k to 3.6k new tokens and emits 0.75k to 1.24k output tokens. Of codex native's $0.002723 tail, $0.001638 is re-send at the cached price, $0.000722 is output and $0.000344 is ingest. Tail requests are cheap in ingest and dear in re-send, which is why they cost 0.80 to 0.92 times a head request.

## 3. Solved versus unsolved

| harness | arm | solved n / tail req | unsolved n / tail req | tail $ share solved / unsolved | run_tests requests in tail solved / unsolved |
|---|---|---|---|---|---|
| codex | native | 41 / 5.15 | 25 / 4.40 | 29.5% / 16.3% | 44 / 24 |
| codex | sweet | 39 / 5.15 | 27 / 4.89 | 26.8% / 18.1% | 43 / 34 |
| opencode | native | 41 / 5.17 | 25 / 5.28 | 33.6% / 20.7% | 46 / 28 |
| opencode | sweet | 41 / 5.07 | 25 / 4.28 | 29.3% / 15.3% | 45 / 26 |
| claude-code | native | 43 / 4.02 | 23 / 5.04 | 16.6% / 13.5% | 43 / 29 |
| claude-code | sweet | 40 / 4.50 | 25 / 3.80 | 21.9% / 10.7% | 42 / 25 |

All [M `tail_report.py`]. Unsolved rollouts have shorter or equal tails in 4 of 6 cells; the two exceptions (codex native, claude-code native) differ by less than one request. The tail's share of cost is lower on unsolved rollouts because unsolved rollouts have longer, dearer heads. Rollouts with two or more `run_tests` in the tail: 5 to 12 per cell of 66, split evenly between outcomes. Unsolved rollouts end one to two requests after their last edit the same way solved ones do; this matches the "no doomed tail" fact behind register row A7 (thrash levers) and adds per-arm post-edit numbers to it.

## 4. Tail composition and which calls are arm-specific

Tail requests per rollout by class [M `tail_report.py`]:

| cell | run_tests | run_tests poll | git diff/status | re-read edited file | ss-read other file | ss-search family | native read | native find | plan tool | text only | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/native | 1.03 | 0.23 | 0.76 | 0.00 | 0 | 0 | 0.30 | 0.03 | 1.50 | 1.00 | 0.02 direct test |
| codex/sweet | 1.17 | 0.24 | 0.67 | 0.00 | 0.17 | 0.11 | 0.02 | 0 | 1.68 | 1.00 | 0 |
| opencode/native | 1.12 | 0 | 0.86 | 0.08 | 0 | 0 | 0.17 | 0.18 | 1.79 | 1.00 | 0.02 git other |
| opencode/sweet | 1.08 | 0 | 0.85 | 0.00 | 0.12 | 0.08 | 0 | 0 | 1.64 | 1.00 | 0.02 git other |
| claude-code/native | 1.09 | 0 | 0.83 | 0.08 | 0 | 0 | 0.36 | 0.06 | 0.79 | 1.05 | 0.14 (git other 0.02, git revert 0.02, poll 0.02, other 0.06, direct test 0.02) |
| claude-code/sweet | 1.03 | 0 | 0.54 | 0.03 | 0.23 | 0.46 | 0 | 0 | 0.83 | 1.05 | 0.06 (delegate 0.02, other 0.03, direct test 0.02) |

Sweet-specific tail calls are `ss-read` of a file the agent did not edit and `ss-grep`/`ss-search`/`ss-find`/`ss-semantic`: 18 calls on codex, 15 on opencode, 45 on claude-code, per 66 (65) rollouts [M]. Native-specific tail calls are `cat`/`sed`/`nl`/`rg`/`grep` and the structured `Read`/`Grep`/`Glob`/opencode `read`/`grep`/`glob` tools: 22 on codex, 49 on opencode, 29 on claude-code [M]. Sweet arms almost never fall back to native tools in the tail (1 call codex, 0 opencode, 0 claude-code), which shows the tool guide's tool-choice directives are obeyed. Re-reading the file just edited is rare in both arms: 0 calls in both codex arms, 17 calls (5 requests) opencode native against 0 sweet, 5 against 2 on claude-code; agents inspect their edit with `git diff` instead, 0.54 to 0.86 requests per rollout. The only arm-asymmetric retrieval pattern is on claude-code, where sweet spends 0.72 retrieval requests per rollout in the tail against native's 0.50 ($0.000412 against $0.000290) [M `tail_extras.py` §3]; half of sweet's 30 `ss-search`-family tail requests belong to one task (section 6). On opencode the direction is reversed (sweet 0.20, native 0.42).

## 5. New fact: the plan tool is a standalone billed request, 19 to 24 percent of all requests on codex and opencode

Every plan-tool call sat in a request of its own: codex 273 of 273 (native) and 259 of 259 (sweet), opencode 259 of 259 and 250 of 250, claude-code 135 of 135 and 126 of 126 [M `tail_extras.py` §2]. On codex this is structural (one call per request). On opencode and claude-code the model may emit several calls per request and does so 447 times on opencode, yet it never paired a plan call with a working call.

| cell | plan-only requests per rollout | share of requests | attributed realized $ share | counterfactual saving per request | saving per rollout | share of rollout $ | first request is a plan | plan requests in the tail (of 66) | back-to-back plan→plan |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/native | 4.14 | 21.9% | 28.0% | $0.000390 | $0.001615 | 13.1% | 63 | 99 | 0 |
| codex/sweet | 3.92 | 20.0% | 27.4% | $0.000374 | $0.001469 | 11.9% | 66 | 111 | 0 |
| opencode/native | 3.92 | 24.0% | 26.5% | $0.000289 | $0.001132 | 12.6% | 66 | 118 | 0 |
| opencode/sweet | 3.79 | 19.2% | 23.2% | $0.000266 | $0.001006 | 10.9% | 66 | 108 | 0 |
| claude-code/native | 2.05 | 8.4% | 12.4% | $0.000296 | $0.000605 | 3.7% | 40 | 52 | 28 |
| claude-code/sweet | 1.91 | 8.2% | 15.6% | $0.000318 | $0.000606 | 3.7% | 47 | 54 | 14 |

All [M `tail_extras.py` §2]. The attributed share counts the full realized cost of each plan request, but that overstates the saving: the new tool output ingested by a plan request would be ingested by the next request anyway. The counterfactual saving per removed request is its output ($0.60 per million on 150 to 290 tokens including reasoning) plus its re-send of the cached prefix ($0.01 per million on 16k to 22k tokens), i.e. $0.00027 to $0.00039 [I, arithmetic on measured tokens]. The plan JSON appended to the prefix (about 100 to 150 tokens per call, re-sent at $0.01 per million) is a second-order term below $0.00002 per rollout and is ignored.

Where they occur [M]: the first response of every codex and opencode rollout is a plan (63 to 66 of 66); on codex and opencode the request right after 45 to 51 percent of edit requests is a plan update (edit → plan → run_tests); 1.5 to 1.8 plan requests per rollout fall in the tail; claude-code emits two plan requests back to back 28 (native) and 14 (sweet) times.

Why it exists [C, I]: the codex base instructions carry a "## Planning" section: "You have access to an `update_plan` tool ... Using the tool helps demonstrate that you've understood the task ... Do not use plans for simple or single-step queries ... make sure to mark it as completed before moving on to the next step" [C `harness_prompt_check.py` reading `session_meta.base_instructions`, 21,084 chars]. Opencode keeps a `todo` table in `opencode.db` (12 rows in the sampled cell) and its default prompt recommends `todowrite` [I; the opencode system prompt is not persisted in the traces]. Claude Code's system prompt promotes `TodoWrite` [I; not persisted]. The sweet tool guide (1,016 words) never mentions plans or todos; none of the nine guide variants under `core/prompt-optimization/data/p7-*` did; the 2026-08-28 documents and logs contain no plan-family row [M `grep`, zero hits]. The register has no row for this class.

Differential: zero today, because both arms carry the same harness prompt. The only sweet-only vehicle is the tool guide (AGENTS.md / `.claude/rules/sweet-search.md`), which is delivered to the sweet arm alone. See section 10 for the candidate.

## 6. The ten largest tails per harness and the bundle-hunt mechanism

Rollout id format: `<run>/<task>/<arm>/r<rep>`. Ranked by tail requests; ties by tail cost [M `tail_report.py`].

Codex: (1) `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0` 11 of 22 requests, $0.005501 = 50.0% of the rollout, solved (ss-search family 4, git 3, run_tests 1, ss-read 1, plan 1); (2) `.../devlooped__moq-1262/native/r1` 10 of 28, $0.008262, 38.3%, solved; (3) `.../mathnet__mathnet-numerics-1072/native/r0` 10 of 18, 53.3%, solved; (4) `.../aio-libs__aiohttp-8038/sweet/r1` 9 of 19, 49.1%, unsolved (ss-read 3, plan 2, run_tests 1, ss-search 1, git 1); (5) `.../apigee__registry-961/sweet/r1` 8 of 28, 28.9%, solved; (6) `.../mathnet__mathnet-numerics-1072/sweet/r0` 8 of 16, 46.6%, solved; (7) `.../mathnet__mathnet-numerics-1072/native/r1` 8 of 22, 35.6%, solved; (8) `.../mirumee__ariadne-codegen-218/native/r1` 8 of 16, 47.2%, solved; (9) `.../mathnet__mathnet-numerics-1072/sweet/r1` 8 of 15, 48.4%, solved; (10) `.../mirumee__ariadne-codegen-218/native/r2` 8 of 15, 47.6%, solved. Five sweet, five native. By tail cost the top three are `devlooped__moq-1262/native/r1` ($0.008262), `devlooped__moq-1262/native/r0` ($0.006570, 12.0% of a $0.054617 rollout) and `aio-libs__aiohttp-8038/sweet/r1` ($0.006262).

Opencode: (1) `rp-oc-tab-20260827/aws-actions__configure-aws-credentials-42/sweet/r0` 13 of 21, $0.004949 = 63.9%, solved (git 3, ss-read 3, plan 2, ss-search 2, run_tests 1); (2) `fp-opencode-tab-20260826/gitbookio__markup-it-56/native/r1` 11 of 20, 47.0%, unsolved (native find 3, native read 3); (3) `.../bfgroup__b2-259/native/r0` 9 of 25, unsolved; (4) `.../devlooped__moq-1262/native/r0` 8 of 22, unsolved; (5) `.../bfgroup__b2-259/sweet/r2` 8 of 33, unsolved (ss-search 3); (6) `.../devlooped__moq-1262/native/r1` 7 of 46, $0.007034, unsolved; (7) `.../mathnet__mathnet-numerics-1072/native/r1` 7 of 14, solved; (8) `.../mirumee__ariadne-codegen-218/native/r2` 7 of 13, solved; (9) `.../hotmeteor__spectator-181/native/r0` 7 of 12, unsolved; (10) `.../absinthe-graphql__absinthe-998/sweet/r2` 7 of 13, solved. Three sweet, seven native.

Claude-code: (1) `fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r1` 14 of 24, $0.005467 = 47.4%, solved (ss-search family 6, ss-read 2, git 2, plan 2, run_tests 1); (2) `.../awslabs__aws-embedded-metrics-node-21/native/r2` 10 of 31, unsolved (git 4, text only 3); (3) `.../mathnet__mathnet-numerics-1072/sweet/r0` 10 of 15, 54.4%, solved (ss-search family 5); (4) `.../gitbookio__markup-it-56/native/r1` 9 of 29, $0.006781, unsolved; (5) `.../protofire__solhint-224/native/r2` 9 of 26, unsolved; (6) `.../final-form__final-form-64/sweet/r2` 9 of 20, solved (text only 4, plan 3); (7) `.../aws-actions__configure-aws-credentials-42/sweet/r2` 9 of 17, solved (ss-search family 4); (8) `.../gitbookio__markup-it-56/native/r2` 8 of 43, unsolved; (9) `.../mirumee__ariadne-codegen-218/native/r1` 8 of 16, solved; (10) `.../jazzband__tablib-454/sweet/r1` 8 of 15, solved (ss-read 4). By tail cost the top is `devlooped__moq-1262/sweet/r2` ($0.010221, 5 requests, 29.8% of $0.034334, unsolved).

The one sweet-specific mechanism in these lists is `aws-actions__configure-aws-credentials-42`, which holds the largest sweet tail on all three harnesses. The repository commits a compiled webpack bundle `dist/index.js` of 35,000 lines. Native edited `dist/index.js` alongside `index.js` in 9 of 9 rollouts; sweet did so in 3 of 9 [M `tail_extras.py` §3, `edited_files`]. In the other 6 sweet rollouts the agent, after editing `index.js`, tried to check the bundle: `ss-grep "AWS_ACCESS_KEY_ID" --in dist/index.js -k 10` returned `# ss-grep: 0 total match(es) ... (scope: --in dist/index.js) (no matches)` while `rg -n -F "AWS_ACCESS_KEY_ID" dist/index.js` in a native rollout returned matches at lines 222 to 224 [M, output heads in `tail-extras-output.md`]. The file existed on disk (`ss-read dist/index.js 1 20` returned "lines 1-20 of 35000") but was excluded from the index as build output. The agent read the silent zero as "the bundle does not contain this code", probed with `ss-semantic`, `ss-read dist/index.js 34500 35000` (truncated at 71 KB on claude-code) and more `ss-grep --in` calls, and stopped without patching the bundle. Cost [M]: sweet tails on this task sum to 71 requests against native's 38, +$0.0153 over 9 sweet rollouts; per 66-rollout cell that is +$0.000059 codex (0.5% of a rollout), +$0.000063 opencode (0.7%), +$0.000110 claude-code (0.7%). All 18 rollouts solved, so this is cost and real-world correctness (an Action runs from `dist/`), not bench resolution. Commit 36b802e (2026-08-28, after these runs) added `excludedScopeNote` in `eval/agent-read-workflows/bin/_ss-helpers.mjs:247-268`, which on a zero-result answer with a scope that exists on disk but is excluded by the admission policy prints "(not indexed: <path> is excluded from the index — build output, a dependency, or an unsupported file type ...)"; its comment names `dist/index.js` as the motivating case [C]. The same commit re-admits git-tracked files under build-output directories, so `dist/index.js` would now be indexed [C commit message]. This mechanism is therefore recorded (register rows E1, E2); this report adds its price and the 6-of-9 versus 9-of-9 bundle-edit asymmetry.

Other large tails are arm-symmetric: `mathnet__mathnet-numerics-1072` (8 to 10 tail requests in both arms on codex; the agent runs `run_tests` twice and reads results), `devlooped__moq-1262` native (post-edit test-fixture reading), `gitbookio__markup-it-56` native (post-edit exploration of fixtures; unsolved), and `final-form__final-form-64/sweet/r2`, whose four text-only tail requests are replies to a background subagent that returned after the main answer (section 7).

## 7. Failed edits with no retry, state-summary stops, empty patches, unverified last edits

Rollouts that end on a failed edit with no retry (last edit request failed, no later edit request): 1 of 396, `fp-claudecode-tab-20260826/protofire__solhint-224/sweet/r0` (an earlier edit succeeded, patch non-empty, 2 tail requests, unsolved, `degenerate: true` in rows) [M `tail_report.py`]. Every other failed edit was retried. This confirms that failed-edit turns (register row D1, 13.4 percent of claude sweet's turns per the W0-P7 measure) are a retry cost, not an abandonment cost.

Rollouts whose last assistant text is a `<state_summary>` block: 2 of 396. `rp-oc-tab-20260827/mathnet__mathnet-numerics-1072/sweet/r0` has a 4-hunk patch and is solved. `fp-claudecode-tab-20260826/celestiaorg__nmt-192/sweet/r0` has zero edits and an empty patch; it is the premature stop the brief already lists [M]. With no patch: 1 of 396. Register row B4 (state summary under 0.5 percent of spend) stands.

Empty patches: 2 of 396. The second is `fp-claudecode-tab-20260826/aio-libs__aiohttp-8038/native/r2`: 19 edit requests whose net diff is empty (the agent restored the original code; final text "the existing check remains explicitly present"), `strippedTestPaths` empty [M rows]. Not a tail effect.

Last edit never followed by a `run_tests` (no `run_tests` in the tail and none in the edit request itself) [M `tail_extras.py` §4]: codex 0 native / 1 sweet, opencode 1 / 1, claude-code 4 / 5; 5 of these 12 are solved (4 native, 1 sweet). Ids: `fp-codex-tab-20260826/devlooped__moq-1262/sweet/r0`; `fp-opencode-tab-20260826/gitbookio__markup-it-56/native/r2`; `fp-opencode-tab-20260826/bfgroup__b2-113/sweet/r2`; claude-code native `accenture__sfmc-devtools-1974/r1`, `aws-actions__configure-aws-credentials-42/r2`, `awslabs__aws-embedded-metrics-node-21/r1`, `mathnet__mathnet-numerics-1072/r1`; claude-code sweet `aio-libs__aiohttp-8038/r1`, `devlooped__moq-1262/r0`, `mathnet__mathnet-numerics-1072/r2`, `protofire__solhint-224/r0`, `protofire__solhint-224/r1`. The rows' `rtEndedUnverified` flag is false on all 12; that flag measures a launched run with no verdict, not an unlaunched one. Any fix here is the shared FRAME or shim (zero differential).

Text-only requests beyond the final answer: 3 rollouts, all claude-code, 2 to 4 extra text requests each, all replies to subagent results that arrived after the main answer (`final-form__final-form-64/sweet/r2` 4, `awslabs__aws-embedded-metrics-node-21/native/r2` 3, `mirumee__ariadne-codegen-218/native/r1` 2) [M `tail_extras.py` §5]. Nudges are 0 on all 396 rows [M rows]. All 28 native and 8 of 9 sweet delegations on claude-code happen before the last main-thread edit; sidechain requests (519 native, 364 sweet) are excluded from the tail basis [M `tail_report.py`].

## 8. The 2026-08-28 "cost is flat by request position" claim

The claim (`06-research-cost-mechanics.md` §7.8, from `r2-turn-profile-and-subagents.mjs`): sweet arm, cache-normalised price, rollouts with at least 8 requests, last quarter of requests over first quarter = 1.02× codex, 1.13× opencode, 1.08× claude-code. Replication with the same rule on the canonical rollout set [M `tail_report.py`]:

| cell | n (≥8 requests) | first quarter | last quarter | last:first | first request alone | last request alone | post-edit tail $ share | tail request share | tail $ share ÷ request share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| codex/sweet | 65 | 24.5% | 24.9% | 1.02× | 13.7% | 3.7% | 21.9% | 25.7% | 0.85 |
| codex/native | 66 | 23.5% | 23.9% | 1.02× | 12.7% | 3.9% | 22.2% | 25.8% | 0.86 |
| opencode/sweet | 66 | 21.6% | 25.5% | 1.18× | 10.1% | 4.3% | 21.1% | 24.2% | 0.87 |
| opencode/native | 66 | 22.8% | 22.9% | 1.00× | 8.8% | 4.5% | 26.2% | 31.9% | 0.82 |
| claude-code/sweet | 63 | 25.8% | 26.2% | 1.02× | 13.0% | 3.8% | 14.8% | 18.0% | 0.82 |
| claude-code/native | 65 | 24.7% | 24.7% | 1.00× | 11.8% | 3.6% | 15.0% | 18.0% | 0.83 |

The claim holds: 1.00× to 1.18× at the cache-normalised price on both arms. The small differences from the published ratios (opencode 1.18× against 1.13×, claude-code 1.02× against 1.08×) come from the rollout set: the original script pooled every main transcript in the fp cells, including the 30 superseded opencode repair-task rows and 2 abandoned claude-code attempts, and it read claude-code usage through `claude-code-accounting.mjs` [C `r2-turn-profile-and-subagents.mjs`]. At the realized price the claude-code ratio inverts to 0.89× (sweet) and 0.86× (native) because the first quarter carries the 1.25× cache-write premium on the preamble [M]. Two nuances the flat claim hides: the first request alone is 8.8 to 13.7 percent of the rollout, and the post-edit tail costs 0.80 to 0.92 times per request what the head costs. "Trimming the verification tail" stays rejected: the removable tail (11 to 22 percent of cost) contains the mandated verification run, is arm-symmetric, and any trim would be a shared FRAME or shim change with zero differential.

## 9. Register check per finding

1. Tail equal or shorter in sweet; the premium is pre-edit — extends the 2026-08-28 rejection of "trimming the verification tail" (HARNESS-GUTTER-COST-ANALYSIS §5.1) and the brief's opencode "+3.4 requests" driver by locating it in the head; no register row covers tail length.
2. No doomed tail on unsolved rollouts — extends A7 (thrash levers dead, "no doomed tail on luna").
3. Same composition in both arms; sweet's only tail-side retrieval excess is claude-code +0.22 requests, half of it one task — new detail, no lever.
4. Plan-tool standalone requests — new; absent from the register, the 2026-08-28 documents, the guide and every guide variant.
5. Bundle hunt on `aws-actions` via silent zero on an un-indexed scope — extends E1 and E2 (both SHIPPED 2026-08-28) with a price and the 6-of-9 bundle-edit asymmetry.
6. Failed-edit-no-retry 1/396 — extends D1 (failed edits are retried, not abandoned). State-summary stop with no patch 1/396 — already recorded (B4; brief §1.2 names the `nmt-192` premature stop).
7. Flat-by-position claim reproduced — already recorded (`06` §7.8), with the realized-price inversion on claude-code added.
8. Unverified last edit 12/396 and `rtEndedUnverified` blind to it — new measurement note; shared vehicle only.
9. Late subagent returns cause 2 to 4 extra text-only requests — new tiny fact, claude-code only, both arms.

## 10. Candidate seed (the only mechanism not on the register)

Name: plan-tool request suppression through the sweet-only tool guide.

Mechanism: the harness's plan tool (`update_plan` codex, `todowrite` opencode, `TodoWrite` claude-code) is always emitted alone, so every bookkeeping update is a full billed request that re-sends the whole prefix. A guide clause that tells the agent to keep its plan in its head (or in the already-mandated `<state_summary>`) and not to call the plan tool would remove 3.8 to 4.1 requests per rollout on codex and opencode and 1.9 to 2.1 on claude-code, in the sweet arm only. It changes which requests happen; it is not same-information compaction.

Harnesses: codex and opencode (large), claude-code (small).

Vehicle and differential: the tool guide, delivered only to the sweet arm (AGENTS.md; `.claude/rules/sweet-search.md`). Sweet-only, so the full saving is a head-to-head differential. A runner or harness setting that disables the tool would be shared or unfair and is not the proposal.

Trace evidence: every plan call is its own request in all six cells (see section 5 table); ids with the most plan requests are visible in `tail-census.json` (`cls == 'plan'`), for example `fp-codex-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r0` (plan requests at positions 0, 6, 10, 21 of 22) [M].

Ceiling per harness (100 percent compliance, zero solve effect) [M tokens, I arithmetic]: codex sweet −$0.001469 per rollout = −11.9% (native cost would stay at $0.012287, so sweet would read −11.6% against native instead of +0.3%); opencode sweet −$0.001006 = −10.9% (sweet would read −7.9% against native instead of +3.3%); claude-code sweet −$0.000606 = −3.7%. Realistic compliance is unknown; the guide's tool-choice directives are obeyed nearly completely (sweet's tail uses native grep/read 1, 0 and 0 times against 18, 15 and 45 `ss-*` calls), but a "do not use tool X" clause competes with the harness's own "## Planning" instruction.

Cheapest `$0` falsifier: none decisive; the class is behavioural. Pre-registered live kill condition for a smoke: plan-only requests per sweet rollout not reduced by at least 50 percent against native on the same tasks, or solved count outside the ±6 bar on 66 rollouts; also kill if the removed requests are replaced one-for-one by text-only or `git diff` requests (count requests, not plan calls).

Build cost: one guide sentence plus a re-run of the prompt-optimisation length check; no product code.

Register check: nearest rows are A1 (prompt-steered call packing, DEAD: luna instruction-deaf to efficiency instructions), A6 (mid-task advisories, REFUTED) and F8 (general clauses, DEAD). This differs in kind: it is a static prohibition of one tool, like the guide's obeyed "use `ss-*` for all search" directive, not a request to acquire a capability (packing) or a mid-task nudge. B2 (guide trim, CLOSED) is about removing words; this adds one sentence. The risk that luna ignores it is real and is why the ceiling is an upper bound.

Flags: `new_tool: false`. `needs_user_decision: true` — the guide's wording is owned by the prompt-optimisation process, plan rendering has user-facing value outside the bench, and the clause fights the harness prompt.

## 11. Measurement traps met in this work

1. Claude-code rows that delegated have `idealTurns` and `costRealizedUsd` null; validate per-request sums against `costRealizedMainOnlyUsd`, never against `costRealizedUsd`.
2. `fp-opencode-tab-20260826` holds only 63 sweet rows and 30 of them are superseded; the canonical sweet set is fp rows for the 11 non-repair tasks plus `rp-oc-tab-20260827` for the 11 repair tasks (`/root/fresh-run/repair-tasks.txt`). Pooling all fp sweet cells shifts quarter ratios (1.13× vs 1.18×).
3. Codex tool output has three wrapper headers: `Process exited with code N`, `Process running with session ID N` (async, the real stdout arrives on a later `write_stdin`), and `Script running with cell ID N`; a parser that accepts only the first drops every async `run_tests` body.
4. `preds-<arm>.jsonl` has one line per task (22), not per rep; per-rep patches are `<arm>/patches.json` (rep 0) and `<arm>/rep-N/patches.json`.
5. A pre-2026-08-28 `ss-grep --in <path>` zero on an excluded path means "not searchable", not "absent"; do not read fp-era `ss-grep` zeros as evidence of absence.
6. Attributing a request class's full realized cost overstates its removal saving; the ingest it carries moves to the next request. Plan requests read 27 percent attributed but 12 percent counterfactual on codex.
7. `toolCounts.edit` is unreliable on codex (heredoc `apply_patch`); the detector here was validated against non-empty patches (0 misses).
8. `rtEndedUnverified` does not flag a final edit that no `run_tests` follows.

## 12. What was not finished

- The opencode and claude-code system prompts are not persisted in the traces; their plan-tool encouragement is inferred from upstream defaults, not read from the runs.
- No solve-effect estimate exists for suppressing plan requests; only a live smoke can give one, and this work was `$0`.
- Sidechain (subagent) request tails on claude-code were not analysed beyond their position relative to the last main-thread edit.
- Whether the post-fix index (fixval, 2026-08-28) now holds `aws-actions`' `dist/index.js` was not verified; that task is not in the 6-task fixval smoke.
- Edit requests that pack `apply_patch` and `run_tests` in one codex command count the verification inside the edit request; 12 such rollouts are listed in section 7 as "unverified" only when neither the edit request nor the tail carries a `run_tests`.

## 13. Evidence paths

- Box (read-only runs): `/root/sweet-search-private/eval/task-completion-bench/results/{fp-codex-tab-20260826,fp-opencode-tab-20260826,rp-oc-tab-20260827,fp-claudecode-tab-20260826}/` (`rows.json`, `agent-state/`, `<arm>/rep-N/patches.json`).
- Box scratch: `/tmp/wf-slatec/verify-tail/tail-census.json` (7.3 MB, per-request census), `tail_census.py`, `harness_prompt_check.py`.
- Local: `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-verify-tail/` — `tail_census.py`, `tail_report.py`, `tail_extras.py`, `harness_prompt_check.py`, `tail-report-tables.md`, `tail-extras-output.md`, `tail-summary.json`.
- Code read: `eval/agent-read-workflows/bin/_ss-helpers.mjs:241-268` (`excludedScopeNote`), commit 36b802e; `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (guide, 1,016 words, no plan/todo mention); `handoffs/improve/harness-gutter-cost-20260828/scripts/r2-turn-profile-and-subagents.mjs`; codex `session_meta.base_instructions` "## Planning".
