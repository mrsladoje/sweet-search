# Claude Code cells — trace forensics (r282, dev data)

Cells: `cc-opus55-medium` (priority) and `cc-sonnet55-high`. Claude Code 2.1.281, 130 questions x 2 arms each.
Every table shows native / sweet side by side. Numbers come from `normalize-claude.mjs` (traces) and
`analyze-claude.mjs` (every table below is one of its `--section` outputs; `sbs` = the side-by-side tables).
Prices: `ideal-cost.mjs` list prices. Opus 5.5: $4 in / $0.20 cache read / $20 out. Sonnet 5.5: $2 / $0.20 / $10.
"Runner basis" = cache write at 1.25x input, as in `runs.jsonl`. "2x basis" = 1h cache write at 2x input (see finding 2).

## 0. Validation

| check | Opus | Sonnet |
|---|---|---|
| runner rows joined to exactly one session (key: arm + question text + clone cwd) | 260 / 260 | 260 / 260 |
| session cwd = clone path the runner derived | 260 / 260 | 260 / 260 |
| tool-call count = runner `calls` | 260 / 260 | 260 / 260 |
| rebuilt `rawResponse` length = runner `rawLen` (proves same parsing) | 260 / 260 | 260 / 260 |
| request count = `transcriptMetricsFromFile` turns | 260 / 260 | 260 / 260 |
| per-rollout cost vs `costRealizedUsd`: rollouts within 2% | 260 / 260 (max 0.0014%) | 260 / 260 (max 0.0019%) |
| pooled cost native / sweet vs runner | $6.8869 / $8.4325, diff 0.0000% | $5.5085 / $5.4725, diff 0.0000% |
| Claude Code own ledger (`cost-state.totalCostUSD`) vs my 2x-basis recompute | $9.2122 / $11.8182 = exact | $6.8581 / $7.2266 = exact |

- Hand-checked against an independent regex read of the raw JSONL (`handcheck-claude.mjs`): Opus native `cpp-003`,
  sweet `cpp-001`, sweet `c-ood-01` (cold start); Sonnet native `cpp-009`, sweet `c-v60-01`, sweet `c-ood-02`
  (2 parallel calls, native Read). Every request tuple (uncached, read, write, out) and cost matched.
- Sidechains: none. 0 subagent transcripts, 0 `Agent`/`Task` calls, 0 `isSidechain` records in all four arms.
  Sidechain count and cost are 0 everywhere. No request lacks usage. Parallel calls share one `message.id` (Sonnet sweet: 46 requests carry 2-3 calls).
- Thinking blocks exist but their text is empty (encrypted): readable thinking chars = 0. No reasoning text to read.

## 1. Cache forensics

### 1a. Per request position, main thread, mean tokens (native / sweet)

Opus

| req | n | inUncached | cacheRead | cacheWrite | out | hit ratio |
|---|---|---|---|---|---|---|
| 0 | 130 / 130 | 2 / 2 | 11,493 / 11,547 | 4,338 / 6,042 | 121 / 92 | 72.6% / 65.6% |
| 1 | 130 / 130 | 2 / 2 | 15,831 / 17,589 | 350 / 1,468 | 127 / 134 | 97.8% / 92.3% |
| 2 | 115 / 98 | 2 / 2 | 16,134 / 18,710 | 730 / 1,129 | 169 / 269 | 95.7% / 94.3% |
| 3 | 77 / 32 | 2 / 2 | 16,786 / 20,322 | 847 / 1,004 | 276 / 337 | 95.2% / 95.3% |
| 4 | 18 / 10 | 2 / 2 | 17,535 / 21,708 | 867 / 710 | 321 / 403 | 95.3% / 96.8% |
| 5+ | 2 / 4 | 2 / 2 | 17,921 / 22,540 | 487 / 609 | 544 / 746 | 97.3% / 97.4% |

Sonnet

| req | n | inUncached | cacheRead | cacheWrite | out | hit ratio |
|---|---|---|---|---|---|---|
| 0 | 130 / 130 | 2 / 2 | 22,581 / 16,826 | 5,193 / 6,148 | 99 / 83 | 81.3% / 73.2% |
| 1 | 130 / 130 | 2 / 2 | 27,774 / 22,974 | 315 / 1,321 | 122 / 144 | 98.9% / 94.6% |
| 2 | 121 / 100 | 2 / 2 | 28,078 / 23,944 | 798 / 1,360 | 191 / 248 | 97.2% / 94.6% |
| 3 | 67 / 41 | 2 / 2 | 28,528 / 25,211 | 897 / 1,129 | 229 / 298 | 96.9% / 95.7% |
| 4 | 18 / 14 | 2 / 2 | 29,585 / 26,504 | 1,175 / 1,025 | 280 / 401 | 96.2% / 96.3% |
| 5+ | 6 / 3 | 2 / 2 | 30,177 / 27,659 | 990 / 575 | 375 / 521 | 96.8% / 98.0% |

Main thread only; there are no sidechain requests to show separately. Hit ratio = cacheRead / total input.
`inUncached` is 2 tokens on every request, so uncached input is 0.0-0.1% of cost.

### 1b. Dollars, 130 rollouts per arm (native / sweet)

| bucket | Opus native | Opus sweet | Opus delta | Sonnet native | Sonnet sweet | Sonnet delta |
|---|---|---|---|---|---|---|
| uncached input | $0.0038 | $0.0032 | -$0.0005 | $0.0019 | $0.0017 | -$0.0002 |
| cache read | $1.4103 | $1.3158 | -$0.0946 | $2.5137 | $1.8112 | -$0.7025 |
| cache write (1.25x) | $3.8754 | $5.6429 | +$1.7675 | $2.2493 | $2.9234 | +$0.6741 |
| output | $1.5974 | $1.4706 | -$0.1268 | $0.7436 | $0.7362 | -$0.0073 |
| TOTAL runner basis | $6.8869 | $8.4325 | +22.4% | $5.5085 | $5.4725 | -0.7% |
| TOTAL 2x basis | $9.2122 | $11.8182 | +28.3% | $6.8581 | $7.2266 | +5.4% |
| naive, no cache | $32.91 | $32.30 | -1.8% | $27.68 | $21.19 | -23.5% |
| share of total: read / write / output | 20.5 / 56.3 / 23.2% | 15.6 / 66.9 / 17.4% | | 45.6 / 40.8 / 13.5% | 33.1 / 53.4 / 13.5% | |

Tokens (all rollouts, millions): Opus write 0.775 / 1.129 (+45.6%), read 7.05 / 6.58 (-6.7%), total input 7.83 / 7.71 (-1.5%).
Sonnet write 0.900 / 1.169 (+30.0%), read 12.57 / 9.06 (-28.0%), total input 13.47 / 10.23 (-24.1%).
All cache writes are 1h-TTL (`ephemeral_1h`); 5m writes are 0 tokens in all four arms.

### 1c. Fixed prefix and its stability

Measure: `prefixTokens` = request-0 total input minus ceil(first user message chars / 4). It covers tool definitions,
system prompt and all `<system-reminder>` context blocks. The store has no request body, so tool definitions
cannot be measured alone.

| | Opus native | Opus sweet | Sonnet native | Sonnet sweet |
|---|---|---|---|---|
| prefix tokens, mean (min-max) | 15,652 (15,477-16,542) | 17,410 (17,381-17,433) | 27,595 (27,420-28,485) | 22,795 (22,766-22,818) |
| system prompt chars | 5,763 | 6,956 | 27,152 | 6,956 |
| rules file `.claude/rules/sweet-search.md` chars | 0 | 6,004 | 0 | 6,004 |
| req-0 cacheRead / cacheWrite, warm rollout | 11,742 / 4,091 | 12,130 / 5,460 | 23,814 / 3,962 | 17,551 / 5,424 |
| req-0 cacheRead / cacheWrite, first touch of a repo | 10,202 / 5,616 (n=21) | 9,942 / 7,639 (n=18) | 18,587 / 9,181 (n=17) | 15,361 / 7,606 (n=19) |
| req-0 cold (nothing read) | 0 | 3 (17,604 written) | 3 (27,737 written) | 3 (22,989 written) |
| rollouts with req-0 cacheRead > 0 | 100% | 97.7% | 97.7% | 97.7% |

- Stability inside a rollout: 100% of 1,246 consecutive request pairs satisfy cacheRead(n+1) = cacheRead(n) + cacheWrite(n).
  The whole earlier context is read back every time. No request inside a rollout ever lost cache.
- Stability across rollouts: warm rollouts of one repo read exactly the same number of tokens at request 0 (spread 0
  tokens, every repo, both arms). The sweet prefix varies by only 52 tokens across all 130 rollouts (question length).
  The native Opus prefix varies by 1,065 tokens across repos (likely per-repo context such as git status; not verified).
  So the sweet prefix is byte-stable. It is not the source of the extra cost.
- What is cached across rollouts is only the front part: tool definitions + system prompt (Opus 11.5k of 17.4k sweet tokens).
  The rest of the prefix is written again at request 0 of every rollout (native 4.1k, sweet 5.5k tokens, warm).
  Evidence: the `instructions` attachment (the rules file) and the other reminders (skill list, agent list, deferred tools,
  environment, date) arrive as `<system-reminder>` blocks in the user message. The system prompt snapshot (6,938 chars)
  does not contain the rules. Request-0 cacheRead for warm rollouts equals the cached front part only.
  (Claude Code puts its cache marker on the system prompt and on the last message block, so nothing in between is reusable.
  This is an inference from token counts; the request body is not stored.)
- The Opus native arm started with a warm cache (no cold rollout). The first three Opus sweet rollouts started cold,
  probably because the sweet front part differs (9,942 vs 10,202 cached tokens). Sonnet: 3 cold rollouts in each arm.
  This one-time cost is a benchmark artifact (section 4).
- The per-repo part of the sweet system prompt (memory directory path) costs one extra write per repo: first-touch request 0
  writes 7.6k tokens instead of 5.5k. A single-repo user pays this once per hour of inactivity.

## 2. Turns, calls, sidechains (native / sweet)

| | Opus | Sonnet |
|---|---|---|
| turns (requests) per question, mean / median | 3.63 / 4 vs 3.11 / 3 (-14.4%, CI excludes 0) | 3.63 / 4 vs 3.22 / 3 (-11.4%, CI excludes 0) |
| tool calls per question, mean / median | 2.63 / 3 vs 2.11 / 2 (-19.9%) | 2.75 / 3 vs 2.59 / 2 (-5.9%, CI includes 0) |
| calls per turn, pooled | 0.72 vs 0.68 | 0.76 vs 0.81 |
| requests with 2+ parallel calls | 0 / 0 | 14 / 46 (of 342 / 288 tool requests) |
| sidechains per question; sidechain $ | 0; $0 | 0; $0 |
| tool result tokens per call (chars/4), mean | 283 / 678 (x2.4) | 292 / 581 (x2.0) |
| tool result tokens per question | 744 / 1,428 | 804 / 1,506 |
| turn count 2 / 3 / 4 / 5 / 6 (rollouts) | 15/38/59/16/2 vs 32/66/22/6/4 | 9/54/49/12/6 vs 30/59/27/11/3 |

Tool mix, Opus: native = Bash grep 216, sed 89, ls 17, cat 7, find 3, other 9, Read 1. Sweet = ss-read 107, ss-grep 104,
ss-search 40, ss-find 15, ss-semantic 7, ss-trace 1; no native tool call at all.
Tool mix, Sonnet: native = Bash grep 253, Read 66, sed 22, ls 8, cat 7. Sweet = ss-grep 150, Read 69, ss-read 68, ss-search 47,
ss-find 1; 46 of 130 sweet rollouts call native Read (43 without any ss-read). 2 sweet calls used a non-existent tool name
(`ss-grep`, `ss-read` as tool names): the harness returned an error result.

Result size per call, tokens (chars/4), mean / median (Opus; Sonnet in the paired file): ss-search 1,554 / 1,339,
ss-find 1,851 / 1,517, ss-read 616 / 489, ss-grep 214 / 102. Native: sed 519 / 422, grep 186 / 65.
ss-search + ss-find are 20% of Opus sweet calls and 48.5% of its result tokens.

Paired difference per question (n=130, stratified bootstrap by set, B=20000, seed 42): Opus cost +$0.0119 [+0.0096, +0.0143];
turns -0.52 [-0.70, -0.35]. Sonnet cost -$0.0003 [-0.0017, +0.0012] (runner basis), +$0.0028 [+0.0010, +0.0047] (2x basis).

## 3. Output tokens and thinking

| per question (native / sweet) | Opus | Sonnet |
|---|---|---|
| output tokens per question | 614 / 566 (-7.9%) | 572 / 566 (-1.0%) |
| output tokens per turn | 169 / 182 | 158 / 176 |
| final-answer request, output tokens | 310 / 373 (+20%) | 273 / 320 (+17%) |
| split: visible text / tool_use / thinking (calibrated) | 303 / 298 / 13 vs 360 / 184 / 22 | 272 / 297 / 3 vs 319 / 241 / 6 |
| API `thinking_tokens` per question | 11.9 / 24.0 | 3.8 / 5.7 |
| requests that carry a thinking block | 44 (9.3%) / 81 (20.0%) | 10 (2.1%) / 12 (2.9%) |

- Method for thinking. The spec formula (output - chars/4 of text and tool_use) gives about 300 tokens per question.
  It is wrong by 20x: text costs 0.40 tokens per char (not 0.25), tool arguments 0.5-0.75 tokens per char, and each
  tool_use block adds 25-50 tokens of envelope. I fitted those costs on requests with no thinking block (n = 70-317 per arm;
  sanity residual on those requests about 0 tokens per question). The calibrated estimate (13 / 23 tokens) matches the
  API field `usage.output_tokens_details.thinking_tokens` (11.9 / 24.0). The trace stores that field in `tok.reasoning`.
- Thinking is small in both cells: 2-4% of output on Opus medium, about 1% on Sonnet high. It is not a cost lever here.
- Output is mostly tool_use arguments and the final answer. Sweet final answers are 17-20% longer than native, but its tool_use output is 38% smaller on Opus (fewer calls).
  The rules ask for a `<state_summary>` block: 24 Opus sweet answers carry one (6.3k chars in total, about $0.05 over 130 questions).

## 4. Why sweet costs what it costs

### 4a. Opus: +22.4% billed, -1.8% naive

Plain answer: sweet sends about the same input tokens (-1.5%) but writes 46% more of them to the cache. A cache write costs
12.5x a cache read (1.25x vs 0.1x input price). The larger write outweighs all savings from fewer turns and less output.

Gap decomposition, runner basis, all 130 pairs (sum = +$1.5456):

| component | native | sweet | sweet - native | % of native total |
|---|---|---|---|---|
| request 0 cache write | $2.8194 | $3.9271 | +$1.1077 | +16.1% |
| request 1+ cache write (tool results, replies) | $1.0560 | $1.7158 | +$0.6597 | +9.6% |
| cache read (req 0 and 1+) | $1.4103 | $1.3158 | -$0.0946 | -1.4% |
| output | $1.5974 | $1.4706 | -$0.1268 | -1.8% |
| uncached input | $0.0038 | $0.0032 | -$0.0005 | 0.0% |

The request-0 write gap splits further (tokens x $5/M):

| part | $ | share of the +$1.5456 gap |
|---|---|---|
| rules file + other reminders: warm write 4,031 -> 5,457 tokens (+1,426), all 130 rollouts | +$0.927 | 60% |
| cold start: first 3 sweet rollouts read nothing (9.9k front part written 3 times; native started warm) | +$0.182 | 12% |
| first touch of each repo (repo-specific system prompt, 18 repos) | +$0.030 | 2% |
| warm rollouts, residual | -$0.031 | -2% |
| request 1+ write: tool results 2.4x larger per call (ss-search, ss-find, ss-read) | +$0.660 | 43% |
| fewer turns: cache reads | -$0.095 | -6% |
| less output | -$0.127 | -8% |

- The +1,426 warm tokens are consistent with the 6,004-char rules file (about 1.5-1.9k tokens) minus native-only reminders
  (session context, auto-mode). Exact split needs a request-body capture. It is not a cache-break: the sweet prefix is stable.
- Cost attribution of tool results (write once + read later; tokens derived as next-request write minus this output):
  ss-read 6.7% of sweet cost, ss-search 6.6%, ss-find 2.8%, ss-grep 2.5%; native sed 5.3%, grep 6.0%.
  All tool results are 19.5% of the sweet bill vs 12.8% of native. Prefix, reminders and question are 63-64% of both bills.
- Cold-start asymmetry: native Opus had a warm cache at start, sweet did not. If both were cold, the gap is about +20%, not +22.4%.
- By set: vault +20.8%, held-out +21.6%, OOD +25.3%. The gap is not specific to one set.

### 4b. Sonnet: -0.7% billed (CI includes 0), +5.4% at the 2x write basis, -23.5% naive

- The stock Sonnet system prompt is large (27,152 chars, 27.6k-token prefix). The sweet agent file replaces it with a
  6,956-char prompt: the sweet prefix is 22.8k tokens, 4.8k smaller. Reads drop -$0.70 (-28%).
- The same two writes as on Opus push the other way: request-0 write +$0.31 net and
  request-1+ write +$0.36 (tool results 2.0x larger per call: ss-search 2.98k derived tokens per call).
- Net: the prefix saving pays for the rules and larger results. (Request-0 write: warm rollouts +1.5k tokens = +$0.49; first-touch and cold rollouts save -$0.18, because the native Sonnet prompt is larger to write.) Opus has no such saving because its stock prompt is already short (5,763 chars).

## 5. Why `content` drops (sweet -21% Sonnet, -37% Opus)

The drop is not caused by dropped tool output. Evidence follows.

- `responseFor` keeps only `ss` and `nativeRead` calls for sweet. The classifier is anchored at command start (`^ss-...`).
  Calls written as `cd <clone>; ss-read ...` fall to kind `bash` and are dropped. This hits 4 Opus calls (2 rollouts,
  content 0) and 3 Sonnet calls (3 rollouts). 98.4% (Opus) and 99.8% (Sonnet) of sweet tool-output characters reach `rawResponse`.
  The artifact costs at most 0.6% of mean content. The sweet `rawResponse` is longer than native (Opus 5,624 vs 3,324 chars).
- `content` = mean of five panel verdicts (D1 answer present, D2 workable code, D3 navigability, D4 edit locality, D5 sufficiency).
  D3 is equal across arms (Opus 0.608 / 0.592). The loss is in D1, D2, D4, D5 (Opus 0.648 / 0.354).
- Natural experiment, content by the format of the code a rollout read:

| arm | code read in the rollout | Opus n | Opus content | Sonnet n | Sonnet content |
|---|---|---|---|---|---|
| native | plain text only (`sed -n`, `cat`) | 88 | 0.780 | 25 | 0.832 |
| native | line-number gutter only (`Read`) | 1 | 0.200 | 53 | 0.442 |
| native | no code body (grep only) | 41 | 0.351 | 52 | 0.346 |
| sweet | plain text only | 0 | - | 1 | 1.000 |
| sweet | line-number gutter only (`ss-read` tab gutter, `Read`) | 88 | 0.480 | 91 | 0.435 |
| sweet | no code body (ss-grep / ss-search / ss-find only) | 42 | 0.238 | 38 | 0.226 |

- Reading code with a gutter scores 0.43-0.48 in every arm. Same format, same score: Sonnet native `Read` 0.442 vs sweet
  `ss-read`/`Read` 0.435. Plain reads score 0.78-0.83. Native Opus chose plain `sed -n` in 88 of 130 questions;
  sweet has no plain read tool, so it has 0 of 130. The gap is 0.238 on Opus; the read-format effect alone is
  (0.780 - 0.480) x 88/130 = 0.203 of it (85%). The no-code-body group adds 0.036 (0.351 vs 0.238).
- Likely cause (not proven): the judge must quote a verbatim span, and a span that is not a substring of the response is
  demoted to 0 (`aggregatePanel`, span-before-score). A multi-line code span cannot match lines that each start with
  `NNN<TAB>`. The panel verdicts and spans are not stored, so this cannot be checked from r282 data.
  92 of 107 Opus `ss-read` results also end with `# unread below (...) - continue: ss-read ...`, which the D2 rule
  ("a span ending in a truncation marker is not edit-ready") may read as truncation; results with and without the trailer
  score the same (0.479 vs 0.480, n=10 without), so the trailer is not the main cause.
- Other effect: 21 no-match probes have content 0 in both arms by construction. Sweet fails the no-match floor more often
  (Opus 16 vs 4 of 21) because `ss-search` always returns hits. This lowers USD, not `content`.
- Cheap test for the lead (needs judge calls, so it needs approval): re-judge about 40 sweet `rawResponse` texts from `captures/`
  with the `NNN<TAB>` gutter removed. If content rises toward 0.75, the gutter is the cause.

## 6. Findings

1. Cache writes decide the Opus bill. Writes are 56% of native cost and 67% of sweet cost. Sweet writes 1.13M tokens vs 0.78M
   (+46%). Reads and output are already lower in sweet (-6.7%, -7.9%); they cannot repay the write increase.
2. The runner basis understates write cost. Every write in r282 is a 1h cache entry, and Claude Code bills it at 2x input.
   Claude Code's own ledger equals the 2x recompute exactly. At that basis Opus is +28.3% and Sonnet changes from -0.7% to +5.4%
   (CI excludes 0). Quote both bases in any published figure.
3. The rules file is the largest single item: +1.4k tokens written at request 0 of every rollout (+$0.93, 60% of the Opus gap).
   It arrives as a user-message reminder after the cache marker, so it is re-written each rollout even though it never changes.
   Candidate lever: put the rules into the agent file body (system prompt), where it is cached. Expected saving on Opus:
   up to 60% of the gap (runner basis), more at the 2x basis. Estimate from token counts, not measured.
4. Sweet tool results are 2.0-2.4x larger per call (Opus 678 vs 283 tokens; ss-search 1.55k and ss-find 1.85k by chars/4).
   They are 19.5% of the sweet bill. Each result token is written once and read on every later turn.
   Fewer turns (-14%, -11%) save little because reads are cheap. A smaller `ss-search`/`ss-find` budget is a lever
   to test; accuracy (98.2% / 97.8% on Opus) must hold.
5. The sweet prefix is stable. It is not a cache-break problem. Within a rollout 100% of request pairs read back the full
   earlier context. Across rollouts of one repo the read size is identical. Cold start (3 rollouts) is a benchmark artifact
   worth about 2.4 points of the Opus gap.
6. Sonnet sweet is cheap only because the stock Sonnet system prompt is 27k chars and the sweet agent file replaces it.
   Part of that win is the harness trim, not retrieval. Opus has no such saving.
7. Sonnet sweet calls native `Read` in 46 of 130 rollouts (20% of calls) and two non-existent tool names. Opus sweet uses 0 native
   tools. The rules do not stop Sonnet from opening files natively.
8. No subagents, no parallel-call gain on Opus (max 1 call per request), thinking about 2-4% of output. None of these explain cost.
9. `content` drop = code shown with a line-number gutter scores 0.43-0.48 vs 0.78-0.83 for plain text; native Opus reads plain text
   in 68% of questions. Dropped tool output is a minor artifact (at most 0.6%). Cause inside the judge is likely, not proven.
10. Skill listing (6,094 chars, about 1.7-1.9k tokens) is also re-written every rollout in both arms. The v2 product
    no longer denies `Skill`. Denying it in the sweet arm would save a similar amount as finding 3 (estimate; it removes a user feature).

## Files

- `normalize-claude.mjs` — `node … <cell>` writes `core/prompt-optimization/data/results/final-tuning-trace/<cell>.trace.jsonl`
  (gitignored). Records follow SCHEMA.md. Extra fields: `tok.cacheWrite1h/5m`, `requestId`, `ts`, `stopReason`, `thinkingBlocks`,
  per call `rawTool`, `runnerKind`, `inRawResponse`, per rollout `ctx`, `req0`, `content*`, `grounding`, `tsStart`, `sessionFile`.
  `tok.reasoning` = API `thinking_tokens` (0 when absent, count where present).
- `analyze-claude.mjs <cell> [--section a|b|c|d|e|e2|f|g|sbs]` — prints every table in this note.
- `handcheck-claude.mjs <cell> <arm> <id>` — independent raw-store comparison used for the hand checks.
