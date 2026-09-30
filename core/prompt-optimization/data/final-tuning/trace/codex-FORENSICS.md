# codex-sol61-high — cache and cost forensics (r282, 2026-09-30 data, analysed 2026-10-01)

**Conclusion.** The fixed prefix and cache misses decide the Codex bill. The prefix is 54% of the billed cost in both arms. Cache misses are 38% (sweet) and 41% (native) of the bill. Sweet is 10.5% cheaper billed, but the paired 95% interval includes zero, and sweet is 1.9% dearer when the cache is normalised.

Scope: 130 questions x 2 arms, Codex 0.159.2 with GPT-6.1 Sol (high effort). Prices per million tokens: $2.00 input, $0.10 cache read, $10.00 output. S = sweet, N = native. Every number comes from `results/final-tuning-trace/codex-sol61-high.trace.jsonl`. `analyze-codex.mjs` (same folder) makes the tables. `normalize-codex.mjs` makes the trace.

## 0. Validation of the trace

| check | result |
|---|---|
| runner rows joined to exactly one session (key: arm + question text + clone path) | 260 / 260, 0 errors, 0 unjoined sessions |
| arm of each session (sweet rules message + base prompt hash) | 130 sweet (one prompt hash), 130 native (one prompt hash); agrees with runs.jsonl for all 260 |
| reconciliation, sum of request costs vs runner `costRealizedUsd` | 260 / 260 rollouts within 1e-13 %; pooled $7.041766 vs $7.041766 (0.00%) |
| token totals of the trace vs runner `usage` (input, cached, output) | equal for 260 / 260 |
| `token_usage_record` vs `token_count` events (921 requests) | equal in count and value; no zero-delta event |
| calls vs runner `calls`; call result sizes vs capture `textChars`; answer vs capture answer | 260 / 260 each |
| hand check (raw store read separately) | native c-ood-01, native c-ood-04, sweet c-ood-01, sweet c-v60-02: tokens, commands, costs match |

Why reconciliation is exact: the runner priced the final cumulative usage. The trace prices each request from `last_token_usage` with the same formula. Output tokens already contain reasoning tokens, so reasoning is never added again.

## 1. Headline

| per question (n = 130 paired) | S | N | S vs N |
|---|---|---|---|
| billed $, mean | $0.0256 | $0.0286 | -10.5% |
| billed $, median | $0.0221 | $0.0252 | -12.3% |
| naive $ (all input at full price), sum | $16.625 | $15.065 | +10.4% |
| ideal-cache $ (request 0 at full price, re-sent context at cache price), sum | $5.810 | $5.701 | +1.9% |
| billed $ sum | $3.327 | $3.715 | -$0.389 |
| score (runner) | 0.957 | 0.957 | equal |

Paired billed difference per question: -$0.0030, 95% CI [-$0.0062, +$0.0002] (stratified paired bootstrap, B = 20000, seed 42). The ideal-cache difference is +$0.0008, CI [-$0.0003, +$0.0020].

## 2. Cache forensics

### 2.1 By request position (mean per request, S / N)

| req | n | inTotal | inUncached | cacheRead | out | hit ratio | zero-hit | $ per request |
|---|---|---|---|---|---|---|---|---|
| 0 | 130 / 130 | 15,339 / 14,366 | 3,095 / 4,148 | 12,244 / 10,217 | 70.9 / 94.2 | 79.8% / 71.1% | 5% / 17% | 0.0081 / 0.0103 |
| 1 | 130 / 130 | 16,502 / 15,483 | 2,069 / 2,378 | 14,432 / 13,105 | 79.9 / 87.1 | 87.5% / 84.6% | 2% / 5% | 0.0064 / 0.0069 |
| 2 | 106 / 126 | 17,283 / 17,372 | 1,422 / 2,571 | 15,861 / 14,801 | 170.6 / 124.8 | 91.8% / 85.2% | 0% / 2% | 0.0061 / 0.0079 |
| 3 | 56 / 51 | 18,437 / 18,951 | 2,250 / 2,369 | 16,187 / 16,582 | 100.0 / 154.6 | 87.8% / 87.5% | 4% / 2% | 0.0071 / 0.0079 |
| 4 | 31 / 11 | 19,639 / 22,698 | 2,128 / 1,682 | 17,511 / 21,015 | 140.2 / 204.8 | 89.2% / 92.6% | 3% / 0% | 0.0074 / 0.0075 |
| 5+ | 20 / 0 | 22,235 / - | 2,210 / - | 20,026 / - | 170.2 / - | 90.1% / - | 0% / - | 0.0081 / - |
| all | 473 / 448 | 17,034 / 16,262 | 2,237 / 2,928 | 14,797 / 13,334 | 107.9 / 110.4 | 86.9% / 82.0% | 3% / 7% | 0.0070 / 0.0083 |

hit ratio = sum(cacheRead) / sum(inTotal). zero-hit = share of requests with cacheRead = 0. One request is one `token_usage_record`.

### 2.2 Fixed prefix and request 0

| | S | N |
|---|---|---|
| fixed prefix (tokens) = request-0 input minus the user message | **15,158** | **14,185** |
| request-0 input, mean (range) | 15,339 (15,315-15,362) | 14,366 (13,757-14,394) |
| request-0 cacheRead, mean | 12,244 | 10,217 |
| rollouts with request-0 cacheRead > 0 | 95% | 83% |
| typical request-0 cacheRead values (value: count) | 14,336: 83; 8,192: 29; 15,232: 10; 0: 7 | 12,416: 105; 0: 22; 8,192: 3 |
| prefix tokens read at full price, all requests | 568,033 | 738,160 |
| prefix cost if every prefix token were a cache read, per request | $0.0015 | $0.0014 |
| prefix cost at full price, per request | $0.0303 | $0.0284 |

Method for the prefix. The rollout file does not store tool definitions. So the prefix is measured from the first request: request-0 input minus the user message (frame and question). The user message is estimated at 4 characters per token, about 260 tokens, with an error near 40 tokens (0.3% of the prefix). The prefix holds the system prompt, tool definitions, developer messages and environment block. Sweet is 973 tokens (6.9%) larger. The shipped base prompt is 3.3k characters shorter than the stock one. The sweet rules add 6.0k characters. One native rollout (c-ood-02, the second of the run) has request-0 input of 13,757, about 620 tokens lower than the rest; cause not examined.

Is the prefix byte-stable? Yes inside the rollout, and across rollouts up to the repository path. Evidence:
- All 130 rollouts of an arm share one base-prompt hash and identical text in all three developer messages. The first byte that differs between two rollouts is the repository path, at character 118 of the 501-character environment block; the user message then differs from the question.
- Inside a rollout the prompt only grows. Input grew at every one of the 661 later requests. 78% of them, in both arms, read all but 128 tokens of the previous input from cache (2.3).
- Request 0 already reads cache in 95% (S) and 83% (N) of rollouts. That is a cross-rollout hit. It is partial: the hit stops near 14,336 (S) and 12,416 (N) tokens, well below the prefix. The same-repository hit reaches 15,232 in sweet (10 of 130); native never exceeds 14,000.
- Cause of the partial hit: not visible in the rollout files. A $0 capture of two requests (the runner already supports a local proxy) would show the first differing byte. This is an open item.

### 2.3 How much of the previous context the next request reads (requests n >= 1)

| outcome of request n | S requests | S tokens not reused | S excess $ | N requests | N tokens not reused | N excess $ |
|---|---|---|---|---|---|---|
| full reuse (cacheRead >= previous input - 128) | 267 (78%) | 25,979 | $0.049 | 248 (78%) | 19,987 | $0.038 |
| only the fixed prefix (or less) read | 41 (12%) | 121,594 | $0.231 | 43 (14%) | 101,223 | $0.192 |
| between prefix and previous input | 29 (8%) | 40,548 | $0.077 | 17 (5%) | 14,247 | $0.027 |
| zero read | 6 (2%) | 96,603 | $0.184 | 10 (3%) | 147,558 | $0.280 |
| all | 343 | 284,724 | $0.541 | 318 | 283,015 | $0.538 |

Excess $ = tokens not reused x ($2.00 - $0.10) per million. Mean previous context read from cache: 95.0% (S), 94.3% (N). Mean previous context not cached: 830 tokens (S), 890 tokens (N) per request; only 80 and 51 tokens of that are the unavoidable 128-token block remainder.

Timing does not explain the misses. The zero-read share is 0-6% in every gap class from 3 s to over 20 s, in both arms. A zero read can follow a request that read 15,232 tokens (sweet c-v60-02, request 1 after request 0). The prompt had only grown. So the miss is a provider cache effect, not a prompt change.

### 2.4 Where the billed dollars go (sum over 130 rollouts)

| bucket | S $ | S share | N $ | N share | S - N | as % of N total |
|---|---|---|---|---|---|---|
| uncached input (full price) | 2.116 | 63.6% | 2.623 | 70.6% | -0.507 | -13.6% |
| cache read | 0.700 | 21.0% | 0.597 | 16.1% | +0.103 | +2.8% |
| output (incl. reasoning) | 0.510 | 15.3% | 0.494 | 13.3% | +0.016 | +0.4% |
| total | 3.327 | 100% | 3.715 | 100% | -0.389 | -10.5% |

Per question: uncached $0.0163 / $0.0202; cache read $0.0054 / $0.0046; output $0.0039 / $0.0038.

| token bucket (sum) | S | N | S vs N |
|---|---|---|---|
| input tokens | 8,057,192 | 7,285,436 | +10.6% |
| uncached input tokens | 1,058,152 | 1,311,676 | -19.3% |
| cache-read tokens | 6,999,040 | 5,973,760 | +17.2% |
| output tokens | 51,038 | 49,445 | +3.2% |
| requests | 473 | 448 | +5.6% |

### 2.5 The same dollars by content

| bucket | S $ | S share | N $ | N share | S - N $ |
|---|---|---|---|---|---|
| fixed prefix (cache reads + full-price misses) | 1.796 | 54.0% | 2.038 | 54.9% | -0.242 |
| conversation read from cache | 0.040 | 1.2% | 0.036 | 1.0% | +0.004 |
| conversation at full price (question, new results, missed cache) | 0.980 | 29.5% | 1.147 | 30.9% | -0.167 |
| output | 0.510 | 15.3% | 0.494 | 13.3% | +0.016 |

Full-price misses are 63% of the prefix cost in sweet (568k tokens, $1.14). They are 72% in native (738k tokens, $1.48). Cache reads are the rest.

### 2.6 Why uncached tokens exist (sum over 130 rollouts)

| component | S tokens | N tokens | S - N | S excess $ | N excess $ |
|---|---|---|---|---|---|
| request 0: prefix not read from cache | 379,587 | 515,812 | -136,225 | 0.721 | 0.980 |
| request 0: user message (unavoidable) | 23,488 | 23,488 | 0 | - | - |
| n >= 1: previous context not read from cache | 284,724 | 283,015 | +1,709 | 0.541 | 0.538 |
| n >= 1: new tokens (tool result + previous output) | 371,096 | 489,361 | -118,265 | - | - |
| sum | 1,058,895 | 1,311,676 | | | |
| actual uncached | 1,058,152 | 1,311,676 | | | |

The S sum differs by 743 tokens (0.07%) because the prefix is an estimate. Excess $ = tokens x $1.90 per million, the loss against a cache read.

### 2.7 Warm-up over the run (rollouts ranked by start time inside each arm)

| quarter | S req-0 cacheRead | S zero-hit | S $/question | N req-0 cacheRead | N zero-hit | N $/question |
|---|---|---|---|---|---|---|
| 1-33 | 10,771 | 3% | $0.0295 | 7,269 | 39% | $0.0368 |
| 34-65 | 11,604 | 6% | $0.0272 | 10,344 | 16% | $0.0269 |
| 66-98 | 13,122 | 6% | $0.0234 | 10,911 | 12% | $0.0297 |
| 99-130 | 13,496 | 6% | $0.0222 | 12,416 | 0% | $0.0206 |

Native ran first (17:55-18:41 UTC); sweet ran second (18:43-19:31 UTC). Both ran the same probes in the same order.

## 3. Turns and calls (mean / median; paired difference S - N with 95% CI)

| metric | S | N | paired S - N |
|---|---|---|---|
| turns (requests) per question | 3.64 / 3 | 3.45 / 3 | +0.19 [-0.01, +0.40] |
| calls per question | 2.64 / 2 | 2.76 / 3 | -0.12 [-0.35, +0.11] |
| calls per turn (calls / turns) | 0.69 / 0.67 | 0.79 / 0.75 | -0.10 [-0.14, -0.07] |
| calls per call-emitting turn | 1.00 / 1 | 1.13 / 1 | -0.13 [-0.18, -0.09] |
| shell sub-commands per question (`;` and `&&` counted) | 3.29 / 2 | 4.85 / 4 | -1.56 [-1.95, -1.19] |

A turn is one request. A call is one `exec_command` (the runner counts the same unit). Sweet never issues two calls in one turn. Native does in 12% of call-emitting turns, and 41% of native calls chain several shell commands (`sed ...; sed ...`). Tool use, calls S / N: ss-read 111, ss-search 86, ss-grep 79, ss-semantic 30, ss-find 19, ss-trace 18 / rg 220, sed 117, nl 17, cat 5. Sweet made no native shell call.

Turn count share of rollouts (S / N): 2 turns 18% / 3%; 3 turns 38% / 58%; 4 turns 19% / 31%; 5 turns 12% / 8%; 6 turns 9% / 0%; 7 turns 3% / 0%.

Result size that reached the model (visible characters / 4, wrapper included): S mean 938, median 692, p90 2,116 tokens per call, 2,476 per question. N mean 1,139, median 642, p90 2,828 per call, 3,127 per question. Measured context growth between requests: S 1,082 (median 812), N 1,539 (median 857) tokens; per question S 2,855, N 3,764 tokens. The Codex wrapper cuts long native outputs: visible text is 35% of the raw text for native and 104% for sweet (wrapper overhead).

## 4. Reasoning and output tokens (reasoning is already inside output)

| metric | S mean / median | N mean / median | paired S - N |
|---|---|---|---|
| output tokens per question | 392.6 / 348 | 380.3 / 340 | +12.3 [-6.1, +30.1] |
| of which reasoning tokens | 65.0 / 50.5 | 27.0 / 0 | +38.0 [+28.2, +48.1] |
| of which text + call tokens | 327.6 / 306.5 | 353.3 / 322 | -25.7 [-41.9, -10.0] |
| output tokens per turn | 110.9 / 107 | 109.2 / 99 | +1.7 [-5.2, +8.5] |
| reasoning tokens per turn | 19.2 / 14.5 | 7.8 / 0 | +11.4 [+8.2, +14.7] |

| per request | S | N |
|---|---|---|
| requests with reasoning > 0 | 40.6% | 13.8% |
| mean reasoning when > 0 | 44.0 | 56.6 |
| reasoning share of output tokens | 16.6% | 7.1% |
| output tokens, final-answer request / other requests | 187.0 / 77.9 | 156.4 / 91.6 |
| final answer text, characters | 578 | 517 |

Reasoning text is encrypted and the summary is empty, so only counts exist. Reasoning after the previous tool (S): ss-read 30.4, ss-semantic 33.3, ss-trace 31.5, ss-search 25.4, ss-find 17.4, ss-grep 12.7 tokens per following request. (N): sed 20.9, nl 17.2, rg 5.8, cat 0.

## 5. Explanation of the cost difference (sweet -10.5% billed, +10.4% naive)

Billed, S minus N = -$0.389 (-10.5%):
- Uncached input: -$0.507. Request-0 prefix misses fall by 136k tokens (-$0.27). New tool-result tokens fall by 118k (-$0.24). Missed earlier context is equal (285k vs 283k tokens).
- Cache read: +$0.103. Sweet re-reads a 973-token larger prefix in 25 more requests.
- Output: +$0.016. Sweet reasons more and answers longer.

Naive, S minus N = +$1.56 (+10.4%): no cache discount, so the larger prefix (+6.9% per request) and the extra requests (+5.6%) raise input tokens by 10.6%. Sweet's smaller tool results do not offset that.

## 6. Findings

1. The fixed prefix is 54% of the bill in both arms: $1.80 of $3.33 (S), $2.04 of $3.72 (N). Sweet carries 973 more prefix tokens (15,158 vs 14,185). At the observed hit mix, 1,000 prefix tokens cost about $0.0009 per question, or 3.6% of the sweet bill.
2. Cache misses cost more than the prefix reads. Full-price tokens that were already sent are 665k in sweet (request-0 prefix 380k + earlier context 285k), $1.26 or 38% of the bill. In native they are 799k, $1.52 or 41%.
3. Sweet wins on billed cost through two effects. Its request-0 cross-rollout hit is higher (95% vs 83% of rollouts; 14,336 vs 12,416 typical tokens). Its tool results are smaller (new tokens -24%, context growth 2,855 vs 3,764 per question). The larger prefix and 25 more requests give back $0.10.
4. The billed saving is not firm. The paired interval [-$0.0062, +$0.0002] includes zero. With the cache normalised, sweet is +1.9% dearer. Cost by run quarter swings from -22% to +7% for sweet against native. Cache state, not prompt design, moves the result.
5. The cache is partly cold at the start of a run. Native request 0 had zero cache read in 39% of the first 33 rollouts and 0% in the last 32. Native cost per question fell from $0.0368 to $0.0206 over the run; sweet fell from $0.0295 to $0.0222.
6. Mid-rollout misses are few but dear. 14% (S) and 17% (N) of requests read only the prefix or nothing. They carry 77% (S) and 88% (N) of the tokens that missed. One zero read costs about $0.03, against $0.005 for a normal request. Gap length does not predict them; the prompt only grew. This is provider-side cache routing.
7. Sweet needs more round trips. Turns are +0.19 per question (interval touches zero) although calls are fewer, because sweet never batches calls and native chains shell commands (4.85 sub-commands vs 3.29 per question). Each extra turn re-sends about 16-17k tokens.
8. Reasoning is small in money: 65 vs 27 tokens per question, output 15.3% vs 13.3% of the bill. Sweet reasons in 41% of requests, native in 14%, mostly after `ss-read`, `ss-semantic` and `ss-trace` results.
9. The cross-rollout prefix hit is partial in both arms. The cause is unknown. Native caches 12,416 of about 14,000 byte-stable tokens. Sweet caches 14,336 of about 15,000. A request capture would show the first differing byte. Native pays 516k full-price prefix tokens ($0.98 of loss); sweet pays 380k ($0.72). A better hit is worth more than a token cut.
10. Suggested lever order: (a) raise the prefix hit, (b) shrink the prefix, (c) cut round trips, (d) shrink tool results. The data does not test (c). Native batches calls in 12% of turns; sweet never does.

## Appendix — definitions used

- Request: one `token_usage_record` (= one `token_count` event). Turn = request. Call = one `exec_command` inside an `exec` cell (1-3 per cell).
- Cost per request: `((input - cached) x 2.00 + cached x 0.10 + output x 10.00) / 1e6`; no cache-write charge.
- Naive cost: `(input x 2.00 + output x 10.00) / 1e6`. Ideal-cache cost: `costFromTurns().idealUsd` from `eval/task-completion-bench/harness/ideal-cost.mjs`. It bills new tokens at full price and re-sent context at cache price.
- Tool name: basename of the first command word after `cd`/`pwd`/env assignments/`timeout`; `ss-*` tools keep their name with `sub = shell`; native shell calls are `exec_command` with `sub` = first word (`rg`, `sed`, `nl`, `cat`).
- Additive fields in the trace (not in SCHEMA.md): request `x` {respId, ts, dtMs, ctxGrowth, reasoningItems, reasoningEncChars, phases, final}; call `exitCode`, `chain`, `visibleChars`, `reportedResultTokens`, `cellCalls`; rollout `file`, `usageMatch`, `captureAnswerMatch`, `sessionWallMs` and others.
