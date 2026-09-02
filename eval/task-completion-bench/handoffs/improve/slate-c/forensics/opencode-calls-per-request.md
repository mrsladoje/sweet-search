# Opencode: tool calls per request, inside the sweet arm (Slate C forensics, 2026-09-02)

**Verdict.** On opencode the sweet arm pays for 3.38 more requests per rollout than native (19.70 against 16.32) while performing fewer tool calls (21.79 against 25.23) and, after fixing a segmenter bug in the 08-28 scripts, also fewer shell operations (23.79 against 25.74; the 08-28 claim "sweet does 4% more operations" was an artefact of splitting on `|` inside quoted regex patterns). The same model, in the same rollouts, parallel-emits structured `read`/`grep`/`glob` calls in 54.6% of the native requests that carry them, parallel-emits Bash calls in 12.0% (native) and 12.7% (sweet) of Bash-bearing requests, and parallel-emits Bash `ss-*` calls in 12.5% of ss-bearing requests (width 2-6, mode 3). In sweet rollouts it never parallel-emitted a structured read-like tool (0 of 41 requests). The request gap is mostly search requests (+3.03 per rollout of single `ss-grep`/`ss-search`/`ss-find` requests) and read requests (+1.27); after a search, sweet issues another search 44% of the time (native 13%). The 08-28 ceilings reproduce at the envelope level (-20% at their price, -18.4% at the measured marginal price) but the operation-level figure rises from -9.5% to -15% once the operation count is corrected; both are the wrong estimator because they let edits, test runs, todo updates and the final message compress too. A dependency-respecting ceiling that merges only consecutive exploration requests at native's width is -8.4% (prefix re-send only) to -11.1% (prefix plus output) per sweet rollout, or -3.4% to -4.5% if searches and the reads that follow them may not merge; the strictly observed pattern the task asks about (runs of consecutive single `ss-read` requests) is worth only -2.2% to -2.8%. Opencode 1.18.4's tool contract explains the asymmetry: the harness's own `read` and `glob` descriptions tell the model to call them in parallel, its GPT system prompt says "Parallelize tool calls whenever possible - especially file reads" and "Never chain together bash commands with separators", and its Bash description says "DO NOT use it for file operations". Parallel emission is a model behaviour conditioned on the tool text the harness sends; a structured `ss-*` tool (opencode custom tool file, not MCP) would sit in the same list under the same system-prompt instruction and would drop the Bash counter-instruction. That is the register's A4 mechanism (owner-excluded, `needs_user_decision`); the non-MCP vehicle and the corrected ceilings extend it, they do not make it new. One off-register, arm-symmetric sink appeared on the way: `todowrite`-only requests cost 10.9% (sweet) and 12.6% (native) of each arm at the marginal price, with zero head-to-head differential.

Tags: [M] measured (script named), [C] read from code, [W] web, [I] inferred.

## 1. Data, definitions, verification

- Runs [M]: `fp-opencode-tab-20260826` (native, 22 tasks x 3 reps = 66 rows; sweet 63 rows, of which the 11 non-repair tasks = 33 are used) and `rp-oc-tab-20260827` (sweet only, the 11 repair tasks x 3 reps = 33). Canonical cells: native 66, sweet TAB 66, the same selection the 08-28 `e4-opencode-lib.py` used (`/root/fresh-run/pool.txt`, `/root/fresh-run/repair-tasks.txt`).
- Transcript per row [M]: `rows.json` -> `openCodeRawAttempts[-1].stdout` -> `agent-state/<task>-<arm>/opencode-retained/<session>/attempt-1.stdout.ndjson`. No row had a second attempt (0 of 132).
- A **request** is one assistant message. Every `step_start` part in these files carries a distinct `messageID`, and every tool part carries the `messageID` of its request (checked on `aio-libs__aiohttp-8038` native rep 0: 25 step_starts, 25 distinct ids, 34/34 tool parts with ids; sweet rep 0: 35/35). Tokens come from the `step_finish` part of the same message: `tokens.{input, output, reasoning, cache.write, cache.read}` [M].
- Cost check [M]: summing the per-request tokens at the registered luna price ($0.10 in and cache-write, $0.01 cache-read, $0.60 output+reasoning per million) reproduces `costRealizedUsd` for all 132 rows; max relative deviation 0.0001, median 0.0000. So the transcript-to-row mapping is exact and the per-request prices below are on the ledger's own scale.
- "Marginal" price of a request = its cache-read tokens x $0.01/M + its output+reasoning tokens x $0.60/M. This is what vanishes when a request is merged into its predecessor; the new tokens it ingests (cache-write) are ingested by the merged request anyway. "Prefix-only" drops the output term (the merged request still emits tool-call arguments).
- Scripts (local, part of the evidence): `slate-c/forensics/scripts-opencode-calls-per-request/oc-request-census.py` (per-request classification -> `data/requests.json`, `data/census.txt`, `data/agg.json`) and `oc-ceiling-align.py` (ceilings, transitions, alignment, per-task table -> `data/ceiling-align.txt`, `data/alignment.json`, `data/sequences.txt`). Copies and outputs on the box under `/tmp/wf-slatec/opencode-calls-per-request/`. Results tree untouched.
- Segmenter [C]: shell commands are split on `&&`, `||`, `;` and newline with quoted strings masked and heredoc bodies dropped; a pipeline counts as one operation. The 08-28 `p3-ops-per-envelope.mjs` split on `|` too, including inside quotes, so `ss-grep "a|b|c"` counted as three operations. Both old definitions are kept as columns (`ops_p3`, `ops_raw`) for the reconciliation in section 6.

## 2. Every request classified by the tool calls it carries

Per arm, 66 rollouts each [M `oc-request-census.py`]:

| | native | sweet TAB |
|---|---:|---:|
| requests / rollout (tool-bearing) | 16.32 (15.32) | 19.70 (18.70) |
| tool calls (envelopes) / rollout | 25.23 | 21.79 |
| shell operations / rollout (pipeline = 1) | 25.74 | 23.79 |
| calls / request (all; tool-bearing only) | 1.546; 1.647 | 1.106; 1.165 |
| operations / request (all; tool-bearing only) | 1.578; 1.681 | 1.208; 1.272 |
| multi-call requests | 271 = 25.2% of requests, 55.6% of calls | 105 = 8.1%, 21.5% of calls |
| structured read-like calls / rollout (`read`,`grep`,`glob`,`list`) | 14.77 | 0.62 |
| structured edit calls / rollout (`apply_patch`) | 1.77 | 1.86 |
| Bash calls / rollout | 4.76 | 15.52 |
| `ss-*` envelopes / operations / ss-bearing requests per rollout | 0 | 10.79 / 11.94 / 8.52 |
| Bash envelopes chaining >= 2 `ss-*` operations | - | 53 of 712 ss envelopes (7.4%); joiners `&&` 73, `;` 3 |
| cost / rollout | $0.008969 | $0.009265 |

Request classes by tool family (count, share of requests, calls per request, share multi-call, mean full cost, mean cache-read tokens, mean output+reasoning tokens) [M]:

| class | native | sweet |
|---|---|---|
| structured only (`read`/`grep`/`glob`/`apply_patch`) | 477, 44.3%, 2.080, 40.5%, $0.000605, 23,712, 294 | 162, 12.5%, 1.000, 0.0%, $0.000670, 28,466, 426 |
| Bash carrying `ss-*` | - | 560, 43.1%, 1.300 calls (1.452 ops), 13.6%, $0.000418, 19,531, 159 |
| Bash without `ss-*` | 223, 20.7%, 1.143, 11.7%, $0.000424, 27,185, 118 | 260, 20.0%, 1.127, 10.4%, $0.000386, 25,262, 116 |
| mixed structured + Bash | 52, 4.8%, 3.058, 100%, $0.000491 | 2, 0.2%, 2.500, 100%, $0.000278 |
| todo only (`todowrite`) | 259, 24.0%, 1.000, 0%, $0.000605, 17,127, 195 | 250, 19.2%, 1.000, 0%, $0.000567, 16,001, 176 |
| text only (final message) | 66, 6.1%, $0.000403 | 66, 5.1%, $0.000395 |

Request kinds by what the operations do (R read-only, S search-only, RS mixed exploration, E edit, T test run, O other, N todo-only, X text-only), count and operations per request [M]:

| kind | native | sweet |
|---|---|---|
| R | 156, 2.154 | 240, 1.567 |
| S | 180, 1.961 | 380, 1.229 |
| RS | 108, 3.833 | 42, 2.929 |
| E | 117, 1.000 | 123, 1.000 |
| T | 179, 1.140 | 191, 1.168 |
| O | 12, 1.333 | 7, 1.000 |
| N | 259, 1.000 | 251, 1.000 |
| X | 66 | 66 |

Sweet's structured-only class is `apply_patch` (123 requests, always one per request in both arms) plus 41 requests with a native `read`/`grep`/`glob`.

## 3. Parallel emission inside the sweet arm, by tool family

The question was whether the same model parallel-emits native tools in sweet rollouts. Same model (`openai/gpt-5.6-luna`), same harness, same 22 tasks [M `oc-request-census.py`, `census.txt`]:

| population | requests | with >= 2 calls of that family | rate |
|---|---:|---:|---:|
| native: requests carrying structured read-like tools | 412 | 225 | **54.6%** (2.37 such calls per request) |
| native: requests carrying Bash | 275 | 33 | 12.0% |
| sweet: requests carrying structured read-like tools | 41 | 0 | **0.0%** |
| sweet: requests carrying Bash | 822 | 104 | 12.7% |
| sweet: requests carrying Bash `ss-*` | 562 | 70 (>= 2 ss envelopes) | **12.5%** |
| sweet: requests carrying Bash `ss-*` | 562 | 53 (a chained envelope) | 9.4% |

- Parallel `ss-*` emission exists. It is concentrated: 31 of 66 sweet rollouts have at least one such request (distribution 0:35, 1:12, 2:9, 3:6, 4:2, 7:2). Widths: 2 envelopes 17 requests, 3 -> 31, 4 -> 18, 5 -> 3, 6 -> 1. Compositions: `ss-read` x3 (17), `ss-read` x4 (13), `ss-grep`+`ss-search` (5), `ss-grep`+2 `ss-read` (5) [M]. Example: `rp-oc-tab-20260827/agent-state/devlooped__moq-1262-sweet` rep 2 (session-1787859832153-1442751-bb37c5b1) issues `[ss-read,ss-read,ss-grep,ss-grep]` then `[ss-read,ss-read,ss-read,ss-read]` as single requests [M `sequences.txt`].
- The Bash parallel rate is tool-agnostic: 12.0% native, 12.7% sweet. The structured rate is 4.4x higher (54.6%). This is the whole asymmetry: the model's parallel habit follows the tool family it is calling, not the arm.
- The 41 sweet requests with a native structured read-like tool were all single-call. n is small (0.62 per rollout) and these were fallbacks (e.g. `glob` after an `ss-find` miss), so this number says the habit was not carried over, not that it is impossible.
- Chaining inside one Bash call is rare: 7.4% of ss envelopes chain two or more `ss-*` operations, almost always with `&&` (73 of 76 joins). The 08-28 figure "20.8% of bash envelopes chain two or more ss-* calls with &&" counted 213 of 1,024 envelopes with more than one naive segment; 160 of those are single `ss-grep`/`ss-find` commands whose quoted regex contains `|` [M section I of `ceiling-align.txt`].
- Solve is unaffected by parallelism in this pool: native (1.55 calls per request) and sweet (1.11) both solved 41 of 66 [M `rows.json`].

## 4. Where the +3.38 requests come from

Gap by request kind, sweet minus native, per rollout [M `ceiling-align.txt` section F]:

| kind | native / rollout | sweet / rollout | gap | sweet marginal $ / rollout |
|---|---:|---:|---:|---:|
| S search-only | 2.73 | 5.76 | **+3.03** | $0.001668 |
| R read-only | 2.36 | 3.64 | **+1.27** | $0.001151 |
| RS mixed exploration | 1.64 | 0.64 | -1.00 | $0.000229 |
| E edit | 1.77 | 1.86 | +0.09 | $0.001144 |
| T test run | 2.71 | 2.89 | +0.18 | $0.000828 |
| N todo-only | 3.92 | 3.80 | -0.12 | $0.001010 |
| X final text | 1.00 | 1.00 | 0 | $0.000354 |
| total | 16.32 | 19.70 | **+3.38** | |

- Sweet's extra requests are search requests first, read requests second. Native folds searches into wide requests (`[glob,glob,grep]`, 1.96 operations per search request) and folds reads into `[read,read,read,read]` (2.15 per read request) or mixes them (`[grep,read,read,read]`, 3.83). Sweet issues 1.23 operations per search request and 1.57 per read request.
- Fan-out after a search [M section D]: after a native search-only request the next request is a read request 51% of the time (carrying 2.28 reads, 45.9% with >= 2) and another search 13%. After a sweet search-only request the next request is another search 44% of the time and a read 36% (carrying 1.63 reads, 29.2% with >= 2). Sweet walks search -> search -> read serially where native emits `[glob,glob,grep]` -> `[read x4]`.
- Edits, tests, todo updates and the final message are one call per request in both arms (E 1.000, T 1.14-1.17, N 1.000). They are 49% of sweet's requests (638 of 1,300) and cannot be compressed by any parallel-emission mechanism.

## 5. Concrete sequences: N single `ss-read` requests against one parallel native request

Sweet runs of consecutive single-`ss-read` requests (one Bash call, exactly one `ss-read`, no chain): 33 runs of length >= 2 across 66 rollouts (lengths 2:24, 3:7, 4:1, 5:1), 78 requests in them (1.18 per rollout); 22 consecutive pairs read the same file in two spans [M section C]. Native has 144 multi-read requests (>= 2 file paths in one request). Path-matched pairs on the same task with >= 2 shared files: 12 pairs across 5 tasks [M section E, `alignment.json`]. Paths are repo-relative source paths from the agents' own commands.

1. `aio-libs__aiohttp-8038`. Sweet `rp-oc-tab-20260827/agent-state/aio-libs__aiohttp-8038-sweet` rep 0 (session-1787855170125-1442751-294e0a0a), requests 10-11 (`msg_04479fbba001L5086qsc4i8eSW`, `msg_0447a04700016iKzlW9Q2Gcf4M`): `ss-read aiohttp/client_proto.py 1 150` then `ss-read aiohttp/connector.py 94 190`. Native `fp-opencode-tab-20260826/agent-state/aio-libs__aiohttp-8038-native` rep 0 (session-1787755067101-1040662-f1242589), request 2 (`msg_03e819b02001AWTZaO2h5SYK5j`): one request reading `AGENTS.md`, `aiohttp/client_proto.py`, `aiohttp/connector.py` (two spans). Marginal saving if the sweet pair were one request: $0.000234.
   The full sequences of these two rollouts [M `sequences.txt`]:
   native (25 requests, 34 calls): `[todowrite] [glob,glob,grep] [read,read,read,read] [todowrite] [run_tests] [grep,grep,read,read] [read] [grep] [read] [apply_patch] ...`
   sweet (35 requests, 34 calls): `[todowrite] [ss-search] [ss-read] [ss-read] [todowrite] [run_tests] [ss-grep] [ss-read] [ss-read] [ss-grep] [ss-read] [ss-read] [ss-grep] [ss-read] [ss-read] [ss-grep] [ss-read] [ss-grep] [apply_patch] ...`
2. `aio-libs__aiohttp-8038`. Sweet rep 2 (session-1787855671429-1442751-56a79545), requests 3-6: `ss-read aiohttp/connector.py 230 390`, `... 490 650`, `ss-read aiohttp/client_proto.py 50 90`, `ss-read aiohttp/connector.py 650 710` (four requests, $0.000625 marginal) against the same native request 2 above.
3. `aws-actions__configure-aws-credentials-42`. Sweet `rp-oc-tab-20260827/.../aws-actions__configure-aws-credentials-42-sweet` rep 1 (session-1787857170849-1442751-be4edc1d), requests 3-4: `ss-read action.yml 1 80`, `ss-read index.js 1 180`. Native rep 0 (session-1787756493001-1040662-4702aee0) request 2 (`msg_03e976502001Cy6AG6BXaHTvaj`) read `index.js`, `action.yml`, `index.test.js`, `package.json` in one request.
4. `bfgroup__b2-113`. Sweet rep 2 (session-1787858728180-1442751-b4b96f81), requests 24-25: `ss-read test/stage.py 1 155`, `ss-read test/transitive_skip.py 1 180`. Native rep 2 (session-1787759552838-1040662-8ebd6d1d) request 4 (`msg_03ec92f6d001Dx0io1JUxYxzoK`) read both files in one request. Marginal $0.000687 (late in the rollout, large prefix).
5. `devlooped__moq-1262`. Sweet rep 2 (session-1787859832153-1442751-bb37c5b1), requests 16-20 (five requests, `msg_044c17d720012fmJnFpAFU0HPp` .. `msg_044c1bf02001GH70pJh154rDwp`): `ss-read src/Moq/ExpressionComparer.cs 240 300`, `ss-read src/Moq/ExpressionExtensions.cs 1 90`, `ss-read src/Moq/ExpressionComparer.cs 1 180`, `... 175 240`, `ss-read src/Moq/Match.cs 55 155`. Native rep 0 (session-1787762148033-1040662-2528fbd9) request 8 (`msg_03eee7625001lzj4XCmgDEARBl`) read `ExpressionComparer.cs`, `ExpressionExtensions.cs`, `Setup.cs` in one request. Marginal $0.002202 for the four removable requests (this is the single largest instance; the same rollout also contains the parallel `[ss-read x4]` request quoted in section 3, so the model can do both within one rollout).
6. `gitbookio__markup-it-56`. Sweet `fp-opencode-tab-20260826/.../gitbookio__markup-it-56-sweet` rep 2 (session-1787762733434-1040662-be6e45ee), requests 9-11: `ss-read src/markdown/re/inline.js 1 50`, `ss-read src/models/state.js 1 360`, `ss-read src/markdown/re/block.js 1 60`. Native rep 2 (session-1787763082138-1040662-44287b5b) request 4 read five files in one request including `src/models/state.js` and `src/markdown/re/block.js`.

Two cautions. The matched pairs are 12 of 33 runs; the other 21 runs read files native never read together. And the serial single-read pattern is only 59.2% of sweet's `ss-read`-bearing requests (158 of 267); the rest already carry two or more operations.

## 6. Request ceilings, re-derived and reconciled with 2026-08-28

Prices used [M]: sweet exploration request (kinds R, S, RS) marginal $0.000304, prefix-only $0.000208; sweet all-request mean full cost $0.000470; the 08-28 panel used $0.000341 per request. Sweet cost $0.009265 per rollout. Native widths: 1.546 calls and 1.578 operations per request over all requests; 2.154 operations per read-only request, 1.961 per search-only request, 2.484 per exploration request pooled.

| estimator | requests saved / rollout | at $0.000304 | at 08-28's $0.000341 | note |
|---|---:|---:|---:|---|
| A1 envelope level, all requests (08-28 "-20%") | 5.60 (28.4%) | -$0.001703 = **-18.4%** | -$0.001911 = -20.6% | reproduces 08-28 |
| A2 operation level, all requests (08-28 "-9.5%") | 4.62 (23.4%) | -$0.001403 = **-15.1%** | -$0.001575 = -17.0% | 08-28 had 2.8 requests because its sweet operation count was inflated to 28.56 (section I) |
| B1 consecutive read-only runs merged at native read width | 0.64 | -$0.000253 = -2.7% (prefix-only -1.9%) | | 156 runs, 240 requests |
| B2 consecutive search-only runs merged at native search width | 0.59 | -$0.000171 = -1.8% (prefix-only -1.5%) | | 236 runs, 380 requests |
| B1+B2 dependency-strict (a search never merges with the reads after it) | 1.23 | **-4.5%** (prefix-only -3.4%) | | |
| B3 consecutive exploration runs (R, S, RS) merged at native pooled width | 3.06 (15.5%) | -$0.001030 = **-11.1%** (prefix-only -$0.000780 = **-8.4%**) | | 197 runs, 662 requests; assumes native-style speculative reads alongside searches |
| control: native merged at its own pooled width | 0.77 | | | native itself is not fully packed |
| C1 observed single-`ss-read` runs merged at native read width | 0.53 | -$0.000203 = **-2.2%** | | 33 runs |
| C2 observed single-`ss-read` runs merged to one request each | 0.68 | -$0.000263 = **-2.8%** | | |

Reconciliation with `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` section 5.1 C4 and `logs/p3-ops-per-envelope.txt`:

1. The envelope-level numbers reproduce: 19.70 and 16.32 requests, 1.546 and 1.106 calls per request, 5.6 requests saved, -20% at $0.000341 [M]. At the request's own marginal price it is -18.4%; at mean full request cost it would be -28.4%, which over-counts because the merged request still ingests the tool output.
2. The operation-level figure does not reproduce because the 08-28 segmenter split on `|` inside quoted strings. Operations per rollout under the three definitions [M section I]: native 25.74 (pipeline = 1 operation, quotes masked), 25.76 (pipes split, quotes masked), 27.47 (naive, as run on 08-28); sweet 23.79, 23.85, 28.56. The "sweet performs 4% more operations" claim inverts: sweet performs **7.6% fewer** operations, 13.6% fewer calls and 20.7% more requests. Corrected, the operation-level ceiling is 4.62 requests, -15.1%, not -9.5%.
3. Both global-rate forms are the wrong estimator. They apply native's exploration width to edits, test runs, todo updates and the final message, which are 49% of sweet's requests and are one call per request in native too. Only 662 of 1,300 sweet requests are exploration requests, and within them the search -> read dependency limits merging. The honest range is -4.5% (dependency-strict) to -11.1% (native-style speculative reads), or -3.4% to -8.4% counting only the prefix re-send. Realised in full, the strict figure would move sweet from +3.3% to about -1.3% against native; the speculative figure to about -8%. Nothing here reaches a -15% lever, and the pattern the task asked about (serial single `ss-read` runs) is -2.2% to -2.8% on its own.
4. Any realised saving depends on the model emitting `ss-*` operations at native's width. Section 3 shows that today it does so in 12.5% of ss-bearing requests, against 54.6% for the harness's own `read`.

## 7. Opencode 1.18.4's tool contract, and whether parallel emission would extend to a structured `ss-*` tool

Source: `anomalyco/opencode` tag `v1.18.4`, commit `49c69c5ed3ccf706b61b3febb43c8aaff7f8325e` [W https://api.github.com/repos/anomalyco/opencode/git/refs/tags/v1.18.4]. The deployed binary `/usr/lib/node_modules/opencode-ai/bin/opencode.exe` (package `opencode-ai` 1.18.4) contains each of the seven sentences quoted below exactly once (`grep -a -c -F`) [M], so the source and the bench binary agree.

What the model is told, per file [C]:

- `packages/opencode/src/tool/read.txt` line 12: "Call this tool in parallel when you know there are multiple files you want to read."
- `tool/glob.txt` line 6: "You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful."
- `tool/grep.txt` line 7: "If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`."
- `tool/shell/shell.txt` line 9 (the Bash tool's description): "IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead."
- `session/prompt/gpt.txt` line 5: "When searching for text or files, prefer using Glob and Grep tools (they are powered by `rg`)"; line 6: "Parallelize tool calls whenever possible - especially file reads. Use `multi_tool_use.parallel` to parallelize tool calls and only this. Never chain together bash commands with separators like `echo "====";` as this renders to the user poorly."
- Which system prompt the bench model gets [C]: `session/llm/request.ts` line 60 uses `input.agent.prompt` if the agent has one, else `SystemPrompt.provider(input.model)`; the `build` agent (`agent/agent.ts` lines 141-155) has no prompt; `session/system.ts` `provider()` returns `PROMPT_GPT` when `model.api.id` includes "gpt" and not "codex", "gpt-4", "o1" or "o3"; `provider/provider.ts` lines 1433 and 1616 set `api.id` from the model id. The runner passes `--agent build --model openai/gpt-5.6-luna` [C `opencode-task-runner.mjs` line 265]. So both arms ran under `gpt.txt` [I: the resolved api id string is not recorded in the transcripts; it is inferred from the runner flag and the provider code]. AGENTS.md (the frame, plus the tool guide in the sweet arm) is appended after it (`session/prompt.ts` lines 1257-1268).
- Editor selection [C `tool/registry.ts` lines 293-296]: for `gpt-` model ids `apply_patch` is the editor and `edit`/`write` are removed, which is why both arms edit with `apply_patch`.
- How tools are executed [C]: `session/tools.ts` lines 96-125 wrap every registry tool as an AI SDK `tool({description, inputSchema, execute})` with no lock or queue; `session/processor.ts` line 571-575 awaits outstanding calls with `concurrency: "unbounded"`. [M] In native, 199 of 271 multi-call requests have overlapping execution windows for `read`/`grep`/`glob` (these tools never call `ctx.metadata`, so their `time.start` is reliable). The Bash tool streams metadata (`tool/shell.ts` lines 475, 515, 525) and `tools.ts` line 77 resets `time.start` on every update, so Bash timing cannot be used; the sweet overlap count (36 of 105) is not interpretable. The harness starts calls as they arrive and does not serialize them.
- Custom tools, the non-MCP structured surface [C `tool/registry.ts` lines 178-198]: for every config directory (project `.opencode/` and the global config dir) the registry globs `{tool,tools}/*.{js,ts}`, imports each module, and pushes every exported `tool({description, args, execute})` (`packages/plugin/src/tool.ts`) into `custom`; `all()` returns `[...builtin, ...custom]` (line 253) and `request.ts` line 184 sorts the tool list by name. A custom tool therefore reaches the model as the same kind of entry as `read`: a name, a description, a JSON schema. No MCP server, no extra process. The bench preflight rejects ambient plugins (`resolved.plugin.length !== 0`, `opencode-task-runner.mjs` lines 69-77) but does not look at `.opencode/tool/` [C]. The runner's config has no `tools` key and `plugin: []` [M `opencode.generated.json`].
- Disabling a built-in tool [C]: opencode hides a tool from an agent by a permission rule; `agent/agent.ts` line 188 does this for the `general` subagent with `todowrite: "deny"`. [I] the same key in the bench's generated `permission` block would hide `todowrite` from `build`; not verified by running.

What this says about the question:

1. Parallel emission is a model behaviour conditioned on the tool text the harness sends. The harness never forces or forbids it; it passes a sorted tool list and executes whatever arrives, concurrently. The model reads three cues that favour parallel structured calls (`read.txt` 12, `glob.txt` 6, `gpt.txt` 6) and two that push against Bash for reading and against chaining Bash (`shell.txt` 9, `gpt.txt` 6). Every sweet `ss-*` call is issued against the Bash description's "DO NOT use it for file operations", and every `&&` chain the model emits (53 of 712 ss envelopes) is issued against "Never chain together bash commands with separators". The tool guide's "Chain inside the tools" (guide line 43) is about tool sequencing, not shell `&&`; the guide does not tell the model to pack, and the harness tells it not to. The guide wins on tool choice (10.79 ss envelopes against 0.62 structured read-like calls per rollout) but the model's parallel habit stays at the Bash rate (12.5%).
2. The same model does parallel-emit Bash `ss-*` at native-like widths when it does it at all (mode 3, up to 6), so the capability is present; the trigger rate is the tool family's. Under the register's A1 verdict ("luna instruction-deaf") the missing ingredient was never the model's ability; the packing instructions were competing with the harness's own contrary instructions, which a structured tool does not face. [I] This is a plausible partial explanation of A1's death on opencode; it cannot be separated at $0 from "the model simply likes `read`".
3. A structured `ss-*` tool would sit in the same list, under the same `gpt.txt` line 6, with a description we write (it can carry `read.txt`'s sentence verbatim), and without the Bash counter-instruction. The 54.6% rate of the harness's own `read` is the best available estimate of the attainable parallel rate; it is an upper anchor, not a prediction. This is the register's **A4 mechanism** (structured `ss-*` tools as the parallel-emission vehicle), owner-excluded on 2026-07-31 as "Bash/CLI only" and unbenchmarked. The custom-tool file is a different vehicle from MCP (no server, no protocol, same process) and is not named on the register, but the mechanism class is A4's. Reopening it is a `needs_user_decision`; the evidence that changed is the corrected ceiling (-4.5% to -11.1%, not -9.5% to -20%) and the within-arm proof that the parallel habit is tool-family-specific.
4. Two costs that a structured tool adds and that this analysis did not price: the tool schema enters the cached prefix on every request (A4's note), and a structured tool's output loses the shell's composability (the 7.4% chained envelopes and any `| head` pipelines). Solve is the veto; native's higher parallel rate did not change solves here (41/66 each), which is neutral evidence, not positive.

## 8. A shared sink noticed on the way: `todowrite`-only requests

Both arms spend a request on each todo-list update [M section G]: native 259 requests (3.92 per rollout, 24.0% of requests), sweet 251 (3.80, 19.3%). Each carries one `todowrite` call, about 176-195 output tokens and a 16-17k-token prefix; marginal $0.001132 (native, 12.6% of the arm) and $0.001010 (sweet, 10.9%) per rollout; full cost $0.002373 and $0.002154. Placement is ritual: 66 of 66 rollouts spend one of their first three requests on it and 65-66 of 66 one of their last three, with about 120-127 more in the middle. The `todowrite` description (`tool/todowrite.txt`, 2 kB) also sits in both arms' prefix. This is not on the register (no `todo` entry in `DEAD-LEVER-REGISTER-DRAFT.md` or in `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md`). Vehicle: a permission rule in the bench's generated opencode config, which is a shared harness setting; it reaches both arms and has zero head-to-head differential (brief rule 6). It is a cost fact about the harness, not a sweet lever. Whether the model would move the planning into text or reasoning tokens, or lose solves without the list, is unknown and is not answerable at $0.

## 9. Register check

- 08-28 C4 (call packing on opencode, dead) and register A1 (prompt-steered packing, DEAD x4): **extends**. The envelope ceiling reproduces; the operation ceiling was mis-measured (segmenter bug) and the "4% more operations" claim inverts; the honest dependency-respecting range is -4.5% to -11.1%; the observed serial-`ss-read` pattern is -2.2% to -2.8%.
- Register A4 (structured `ss-*` tools, owner-excluded): **extends**. New facts: within-arm parallel rates by tool family (54.6% structured against 12.0-12.7% Bash, 12.5% Bash `ss-*`), the harness's own text that steers parallel structured calls and steers against Bash file operations and Bash chaining, the non-MCP custom-tool vehicle in `tool/registry.ts`, and the widths the model already uses for parallel `ss-*` (mode 3).
- A2 (`ss-batch`): consistent; 0 `ss-batch` operations in the 66 sweet rollouts [M `ss ops by tool`].
- `todowrite`-only requests as a 10.9-12.6% arm-symmetric sink: **new**, zero differential, `needs_user_decision` on whether the bench should change a harness default.

## 10. Traps handled, limits, and what I could not finish

- Rep 1 overwrites rep 0 in `turns/`: not used; every per-request token record comes from the raw ndjson of the row's own attempt, and the cost check ties each transcript to its row.
- Repair-pass selection: the 11 repair tasks' sweet rows come from `rp-oc-tab-20260827` only; their `fp-opencode-tab-20260826` sweet rows are excluded, as in the 08-28 scripts.
- Grading logs were not opened. No hidden test names or gold patch content appear here; file paths are the agents' own commands.
- The segmenter is regex-based. It masks single and double quotes and drops heredoc bodies; it does not parse shell. Edge cases (unbalanced quotes, `$(...)`) may still miscount a few operations. Both older definitions are kept as columns so the effect is visible (section I).
- Bash tool timing is unusable (section 7); only the structured tools' concurrency is measured.
- The api model id string is inferred (section 7); the transcripts do not record it.
- Not finished: (a) a measurement of whether the parallel `read` rate is driven by the description sentence rather than by the tool being the harness's own `read` needs a paid rollout and is out of scope; (b) the prefix cost of adding a structured tool schema was not priced; (c) whether the `permission: { todowrite: "deny" }` route hides the tool for the `build` agent was read from code, not run.

## Appendix: paths

- Report: `eval/task-completion-bench/handoffs/improve/slate-c/forensics/opencode-calls-per-request.md`
- Scripts and data: `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-opencode-calls-per-request/{oc-request-census.py, oc-ceiling-align.py, data/census.txt, data/agg.json, data/ceiling-align.txt, data/alignment.json, data/sequences.txt, data/requests.json}`
- Box scratch (read-only results untouched): `/tmp/wf-slatec/opencode-calls-per-request/`
- Opencode sources read: `packages/opencode/src/{tool/tool.ts, tool/registry.ts, tool/read.txt, tool/grep.txt, tool/glob.txt, tool/shell/shell.txt, tool/shell.ts, session/prompt/gpt.txt, session/system.ts, session/llm/request.ts, session/tools.ts, session/processor.ts, agent/agent.ts, provider/provider.ts}` and `packages/plugin/src/tool.ts` at commit `49c69c5e`.
