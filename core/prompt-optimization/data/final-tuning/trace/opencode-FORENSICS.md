# opencode cells: cache and cost forensics (r282 data, 2026-09-30)

Cells: `oc-dsflash41` (opencode 1.18.4 + DeepSeek V4.1 Flash) and `oc-sol61-high` (opencode 1.18.4 + GPT-6.1 Sol, variant high).
Both arms, 130 questions each. Numbers come from `<cell>.trace.jsonl`, built by `normalize-opencode.mjs` and read by `analyze-opencode-forensics.mjs` (same folder).

## Bottom line

- **DeepSeek: the +54.6% is a bench artifact, not a product effect.** The sweet arm pays full input price for about 6.2k of its 8.2k prefix tokens on every question. The prefix cache stops at token 2,048 because opencode writes a per-rollout random folder name into the system prompt (`Instructions from: <abs path>`).
- With the prefix cached like native, the DeepSeek gap becomes +1.5% (native cache pattern) and −7.8% at best. Everything after the first request costs the same in both arms ($0.1607 vs $0.1609).
- **Sol: the +6.8% is not significant** (paired 95% CI crosses zero) and the path artifact explains little of it (+6.8% becomes about +5.3%). The sweet prefix is +1,143 tokens bigger and costs +$0.47. The rest of the rollout is 9.9% cheaper (−$0.23).
- **Sol loses 23% of its bill to provider cache misses in both arms** ($0.82 native, $0.85 sweet of uncached input is earlier context billed again). The prefix is byte-stable; the misses come from the provider.
- Sweet cuts Sol calls by 24% but turns by only 2.5% (3.57 vs 3.66), so the call cut buys little. Turns, not calls, multiply the context cost.

## 0. Method and validation

| Check | oc-dsflash41 | oc-sol61-high |
|---|---|---|
| Runner rows joined to exactly one session | 260 / 260 | 260 / 260 |
| Join errors, orphan sessions, sessions claimed twice | 0 | 0 |
| Session turns = runner `usage.turns`; tool parts = runner `calls` | 260 / 260 ; 260 / 260 | 260 / 260 ; 260 / 260 |
| Runner `ssCalls` = ss tool calls found by the basename rule | 260 / 260 rows | 260 / 260 rows |
| Sum of request costs vs runner `costRealizedUsd` (pooled / native / sweet) | 0.0000% / 0.0000% / 0.0000% | 0.0000% / 0.0000% / 0.0000% |
| Per-rollout difference, rollouts within ±2% | 260 / 260 (max 0.152%, from 6-decimal rounding of tiny costs) | 260 / 260 (max 0.004%) |
| Runner `wallMs` ≥ session span (process start-up included) | 260 / 260, median gap 555 ms | 260 / 260, median gap 544 ms |
| Incomplete assistant messages, subagent sessions | 0, 0 | 0, 0 |
| Hand-checked against a separate raw SQL read (`handcheck-opencode.mjs`) | native `c-ood-03`; sweet `c-v60-03`, `c-v60-01`: all MATCH | native `cpp-009`; sweet `c-v60-01`, `csharp-009`: all MATCH |

- **Join key.** Runner rows carry no start time. The key is: arm (which `opencode.db`), clone path (from the probe's repo, same function as the runner), and the exact `Question: <query>` text of the first user message. Session time is a cross-check only (wall ≥ span).
- **Turn = request = one assistant message = one `step-finish`.** Every assistant message has exactly one step.
- **Tokens.** `inUncached = tokens.input`, `cacheRead = tokens.cache.read`, `cacheWrite = 0` (neither provider bills a write premium). `out = tokens.output + tokens.reasoning` (the billed completion tokens; the runner adds them too). `reasoning` is a provider-reported count. It is disjoint from `output`: 51 and 99 DeepSeek requests report reasoning above output.
- **Cost** uses the runner's price table (`ideal-cost.mjs`: DeepSeek 0.15 / 0.003 / 0.60, Sol 2.00 / 0.10 / 10.00 USD per M tokens for uncached / cache read / output) and its per-turn formula.
- **Prefix size** = request-0 `inTotal` minus `ceil(user message chars / 4)`. The store does not keep the request body, so the absolute size is an estimate (about ±150 tokens). The **sweet − native difference is exact**: both arms send the same user message, and the paired request-0 `inTotal` difference is 1,147–1,150 tokens (DeepSeek) and 1,141–1,145 (Sol) on all 130 questions.
- **Cache granularity.** Every `cacheRead` value is a multiple of 64 (DeepSeek) or 128 (Sol).
- **Sol reasoning text** is empty: the store holds only `reasoningEncryptedContent`. DeepSeek `reasoning` parts hold the full raw text (kept in `reasoningText`).

## 1. oc-dsflash41 (DeepSeek V4.1 Flash)

### 1a. Cache forensics

**total cost (trace sum = runner costRealizedUsd, 130 questions per arm)**

| arm | total $ (130 questions) | $ / question | naive $/question (no cache, runner) |
|---|---:|---:|---:|
| native | $0.1887 | $0.00145 | $0.00740 |
| sweet | $0.2917 | $0.00224 | $0.00780 |

sweet vs native: realised +54.6%; naive +5.4%
paired sweet - native $/question: mean $0.00079, 95% CI [$0.00062, $0.00098] (stratified by set, B=20000, seed 42)

**per request position (mean tokens per request; hit = sum cacheRead / sum inTotal)**

| req | arm | n | inUncached | cacheRead | cacheWrite | out(incl. reasoning) | reasoning | inTotal | hit | $/req |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | native | 130 | 981 | 6,254 | 0 | 106 | 21 | 7,235 | 86.4% | $0.00023 |
| 0 | sweet | 130 | 6,355 | 2,029 | 0 | 106 | 23 | 8,384 | 24.2% | $0.00102 |
| 1 | native | 130 | 1,480 | 7,269 | 0 | 137 | 23 | 8,749 | 83.1% | $0.00033 |
| 1 | sweet | 130 | 1,759 | 8,430 | 0 | 158 | 51 | 10,190 | 82.7% | $0.00038 |
| 2 | native | 123 | 1,373 | 8,645 | 0 | 165 | 37 | 10,017 | 86.3% | $0.00033 |
| 2 | sweet | 108 | 1,665 | 10,135 | 0 | 216 | 84 | 11,799 | 85.9% | $0.00041 |
| 3 | native | 90 | 1,606 | 9,830 | 0 | 176 | 53 | 11,437 | 86.0% | $0.00038 |
| 3 | sweet | 60 | 1,111 | 12,284 | 0 | 264 | 114 | 13,395 | 91.7% | $0.00036 |
| 4 | native | 57 | 1,241 | 11,533 | 0 | 230 | 88 | 12,775 | 90.3% | $0.00036 |
| 4 | sweet | 39 | 1,133 | 13,158 | 0 | 281 | 118 | 14,290 | 92.1% | $0.00038 |
| 5+ | native | 59 | 1,013 | 15,239 | 0 | 277 | 122 | 16,252 | 93.8% | $0.00036 |
| 5+ | sweet | 62 | 1,051 | 19,510 | 0 | 394 | 221 | 20,561 | 94.9% | $0.00045 |

**fixed prefix and first request**

| arm | prefix tokens (mean) | prefix min-max | req0 inTotal | req0 cacheRead (mean) | req0 hit>0 | req0 cacheRead values (count) | req0 cache ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| native | 7,053 | 7,040-7,065 | 7,235 | 6,254 | 100.0% | 7040x111 1664x19 | 86.4% |
| sweet | 8,202 | 8,188-8,214 | 8,384 | 2,029 | 100.0% | 2048x111 1920x19 | 24.2% |

**Prefix composition (approximate, from the harness source and the 2026-09 request captures).** Native: default-family system prompt 8.5k chars + 9 tool definitions ~19.5k chars. Sweet: the shipped `conflict3+todo3eff3k` trim. It swaps in the GPT-family prompt (9.9k chars, even for DeepSeek), adds the rules file (6,005 chars) through `instructions`, turns `grep` and the explore subagent off, and shortens the bash/read/task/glob tool texts. The ss-* tools have no tool definition; they run through `bash`, so all ss guidance sits in the rules file.

**prefix reuse inside a rollout (request n vs context of request n-1)**

| arm | requests n>=1 | cacheRead(n) / inTotal(n-1) | mean deficit tok | median deficit | breaks (deficit > 128) | mean deficit of breaks | mean new tok since n-1 | mean inUncached | median gap s (t1(n-1)->t0(n)) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 459 | 100.8% | -76 | -64 | 8 (1.7%) | 159 | 1,462 | 1,386 | 0.0 |
| sweet | 399 | 100.9% | -100 | -67 | 0 (0.0%) | - | 1,565 | 1,465 | 0.0 |

(deficit = inTotal(n-1) - cacheRead(n), signed. Positive = earlier context re-billed as uncached input; negative = the provider also cached part of the previous response. Exact identity for n>=1: inUncached(n) = new(n) + deficit(n), with new(n) = inTotal(n) - inTotal(n-1).)

**What the first-request numbers mean.**
- Native: 111 of 130 rollouts read 7,040 tokens of cache (the whole prefix). The other 19 read 1,664: the first rollout in each of the 18 repos, plus one that started while the first was still running. Only the system prompt before the working-directory line is shared there.
- Sweet: 111 rollouts read 2,048 tokens and 19 read 1,920 (same 19 situations). Never more, even when the previous rollout in the same repo ended seconds earlier.
- Cause: the system message is [prompt][env block with cwd][`Instructions from: <abs path of the rules file>` + rules]. The tool definitions and the user message come after it (inferred from where the cache stops). In the runner the rules file sits in a fresh `mkdtemp` folder per rollout (`…/oc-state-dFxaTh/sweet-search-rules.md`). All 130 sweet rollouts have different folder names (`opencode.log`), and the bundled 1.18.4 source prints `Instructions from: ${path}` with the absolute path. The prompt before the env block is ~1,920 tokens, and the env block plus the path stem add ~128 tokens. That matches the 1,920 / 2,048 plateau. Everything after it (rules, tools, the question) can never be cached across rollouts.
- Inside a rollout the prefix is stable: `cacheRead(n) / inTotal(n−1)` is 100.8% (native) and 100.9% (sweet), because DeepSeek also caches the previous response. Sweet has 0 cache breaks in 399 requests; native has 8 of 459.
- Hypothesis "tool results are large and new": **rejected.** Sweet delivers fewer new tokens after request 0 (4,804 vs 5,162 per question) and fewer result tokens (3,715 vs 3,871).
- Product check: `init --opencode` installs the rules at the stable project path `.opencode/sweet-search.md`, so the product does not have this problem. (`SS_BENCH_STABLE_RULES_PATH=1` in the runner sets one path per run.)

**where the dollars go (total over 130 questions per arm)**

| bucket | native $ | native share | sweet $ | sweet share | sweet - native $ | relative |
|---|---:|---:|---:|---:|---:|---:|
| uncached input | $0.1146 | 60.7% | $0.2116 | 72.5% | $0.0970 | 94% of gap |
| cache read | $0.0158 | 8.4% | $0.0147 | 5.1% | -$0.0010 | -1% of gap |
| cache write | $0.0000 | 0.0% | $0.0000 | 0.0% | $0.0000 | 0% of gap |
| output (visible text + tool args) | $0.0419 | 22.2% | $0.0391 | 13.4% | -$0.0028 | -3% of gap |
| reasoning | $0.0164 | 8.7% | $0.0263 | 9.0% | $0.0099 | 10% of gap |
| TOTAL | $0.1887 | 100.0% | $0.2917 | 100.0% | $0.1030 | +54.6% |

Tokens per question (native | sweet): inUncached 5,876 | 10,851; cacheRead 40,481 | 37,800; inTotal 46,357 | 48,651; out(incl reasoning) 748 | 838

**uncached input split: first request vs later requests (new content vs cache deficit)**

| component (tokens per question) | native | sweet | native $ (130 q) | sweet $ (130 q) |
|---|---:|---:|---:|---:|
| req 0 uncached (prefix + question not cached across rollouts) | 981 | 6,355 | $0.0191 | $0.1239 |
| req >=1 new tokens since the previous request (its assistant output + tool results) | 5,162 | 4,804 | $0.1007 | $0.0937 |
| req >=1 cache deficit, signed (+ earlier context re-billed; - provider also cached part of the previous response) | -267 | -308 | -$0.0052 | -$0.0060 |
| sum = inUncached | 5,876 | 10,851 | $0.1146 | $0.2116 |

(check: measured inUncached per question native 5,876, sweet 10,851)

**fixed prefix vs everything else (prefix = system prompt + tool definitions + rules, measured in the first-request table)**

| arm | total $ | prefix $ (approx.) | prefix share | of which request 0 (mostly uncached) | of which re-reads in requests >=1 | everything else $ |
|---|---:|---:|---:|---:|---:|---:|
| native | $0.1887 | $0.0277 | 14.7% | $0.0180 | $0.0097 | $0.1609 |
| sweet | $0.2917 | $0.1310 | 44.9% | $0.1212 | $0.0098 | $0.1607 |

sweet - native: prefix $0.1032, everything else -$0.0002, total $0.1030.

**counterfactual: sweet first request cached like native**

| scenario | sweet total $ | vs native |
|---|---:|---:|
| observed | $0.2917 | +54.6% |
| every sweet request 0 caches its whole prefix (floor to granularity)  [upper bound on the fix] | $0.1740 | -7.8% |
| only rollouts that already hit the head cache (native pattern: all but the first rollout per repo) | $0.1915 | +1.5% |
| native (reference) | $0.1887 | 0.0% |

### 1b. Turns and calls per question

**turns (requests), calls, calls per turn, per question**

| metric | native mean | native median | native p90 | sweet mean | sweet median | sweet p90 | paired sweet-native mean [95% CI, stratified boot B=20000 seed 42] |
|---|---:|---:|---:|---:|---:|---:|---:|
| turns (requests) | 4.53 | 4.0 | 6.0 | 4.07 | 3.0 | 6.0 | -0.46 [-0.80, -0.09] * |
| tool calls | 5.62 | 5.0 | 9.0 | 5.09 | 4.0 | 9.0 | -0.52 [-1.07, 0.08] |
| calls per turn | 1.19 | 1.2 | 1.6 | 1.16 | 1.0 | 1.6 | -0.03 [-0.08, 0.02] |

Pooled calls per request: native 1.24, sweet 1.25. Calls per tool-using request: native 1.59, sweet 1.66. Requests with >=2 parallel calls: native 43.3%, sweet 44.8%. Requests with 0 calls (final answer): native 22.1%, sweet 24.6%.

Result size (chars/4 estimate): tokens per call native mean 689 (median 332, p90 1,771), sweet mean 729 (median 406, p90 1,911); result tokens per question native 3,871, sweet 3,715. Mean argument chars per call native 94, sweet 85.

Tool mix (calls per question): read 1.82|1.14; grep 2.28|0.00; ss-grep 0.00|2.04; ss-search 0.00|0.84; bash/ls 0.70|0.12; ss-read 0.00|0.67; glob 0.34|0.06; bash/rg 0.30|0.00; bash/grep 0.09|0.04; ss-find 0.00|0.11; bash/find 0.05|0.02; ss-semantic 0.00|0.05  (native|sweet)

### 1c. Output and reasoning tokens

Source: provider-reported counts in `step-finish` (`tokens.output`, `tokens.reasoning`). They are counts, not estimates. DeepSeek raw reasoning text is in `reasoningText`; its length is consistent with the counts (4.2–4.4 chars per reasoning token).

**output and reasoning tokens (provider-reported COUNTS from step-finish: tokens.output, tokens.reasoning)**

| arm | out tok / q (incl. reasoning) | reasoning tok / q | visible out tok / q | median reasoning tok / q | out tok / turn | reasoning tok / turn | reasoning share of out | reasoning text chars / q | answer+text chars / q |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 748 | 210 | 538 | 133 | 165.0 | 46.3 | 28.1% | 886 | 534 |
| sweet | 838 | 337 | 502 | 214 | 206.0 | 82.7 | 40.2% | 1,388 | 721 |

Reasoning tokens of request n by the tool used in request n-1 (mean and n); native | sweet:

| previous request used | native mean reasoning | native n | sweet mean reasoning | sweet n |
|---|---:|---:|---:|---:|
| grep | 30 | 121 | - | 0 |
| mixed | 55 | 135 | 104 | 164 |
| read | 71 | 141 | 154 | 85 |
| bash | 63 | 55 | 114 | 6 |
| glob | 17 | 7 | 109 | 1 |
| ss-grep | - | 0 | 48 | 82 |
| ss-read | - | 0 | 101 | 46 |
| ss-search | - | 0 | 63 | 10 |
| ss-semantic | - | 0 | 208 | 2 |
| ss-find | - | 0 | 84 | 3 |

Reasoning in request 0 (before any tool result): native mean 21, sweet mean 23.
DeepSeek raw reasoning text: mean chars per reported reasoning token native 4.37, sweet 4.21 (text is the full raw reasoning; the token number is provider-reported).
Requests with reasoning>0: native 80.5%, sweet 91.7%.

### 1d. Why sweet costs more on DeepSeek

- Uncached input is 94% of the gap (+$0.097 of +$0.103). The whole of it is request 0: 6,355 uncached tokens per question vs 981 (+5,374). Later requests are slightly cheaper in sweet.
- The fixed prefix is 44.9% of the sweet bill and 14.7% of the native bill. Everything that is not prefix costs the same ($0.1607 vs $0.1609).
- Reasoning adds $0.0099 (10% of the gap): sweet reasons 337 tokens per question vs 210 (82.7 vs 46.3 per turn), and 91.7% of sweet requests contain reasoning vs 80.5%. The extra comes after `read` and `ss-read` results (sweet: 154 and 101 tokens in the following request; native after `read`: 71). After `ss-grep` it is 48 vs 30 after native `grep`.
- Sweet needs fewer turns (4.07 vs 4.53; paired −0.46, CI [−0.80, −0.09]) and about the same number of calls (5.09 vs 5.62; CI crosses zero).
- Sweet still uses the native `read` tool 1.14 times per question (ss-read 0.67). `glob` (0.06 per question) and `bash` `ls` (0.12) remain.

## 2. oc-sol61-high (GPT-6.1 Sol, reasoning variant high)

### 2a. Cache forensics

**total cost (trace sum = runner costRealizedUsd, 130 questions per arm)**

| arm | total $ (130 questions) | $ / question | naive $/question (no cache, runner) |
|---|---:|---:|---:|
| native | $3.4871 | $0.02682 | $0.06112 |
| sweet | $3.7259 | $0.02866 | $0.06618 |

sweet vs native: realised +6.8%; naive +8.3%
paired sweet - native $/question: mean $0.00184, 95% CI [-$0.00041, $0.00406] (stratified by set, B=20000, seed 42)

**per request position (mean tokens per request; hit = sum cacheRead / sum inTotal)**

| req | arm | n | inUncached | cacheRead | cacheWrite | out(incl. reasoning) | reasoning | inTotal | hit | $/req |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | native | 130 | 3,581 | 2,308 | 0 | 65 | 0 | 5,889 | 39.2% | $0.00804 |
| 0 | sweet | 130 | 5,310 | 1,721 | 0 | 57 | 0 | 7,032 | 24.5% | $0.01137 |
| 1 | native | 130 | 2,116 | 4,504 | 0 | 103 | 5 | 6,620 | 68.0% | $0.00572 |
| 1 | sweet | 130 | 2,811 | 5,564 | 0 | 75 | 14 | 8,375 | 66.4% | $0.00693 |
| 2 | native | 128 | 3,088 | 5,517 | 0 | 127 | 5 | 8,605 | 64.1% | $0.00800 |
| 2 | sweet | 101 | 2,051 | 7,031 | 0 | 176 | 40 | 9,082 | 77.4% | $0.00657 |
| 3 | native | 54 | 2,829 | 7,694 | 0 | 140 | 11 | 10,524 | 73.1% | $0.00783 |
| 3 | sweet | 53 | 2,044 | 8,083 | 0 | 101 | 10 | 10,128 | 79.8% | $0.00590 |
| 4 | native | 23 | 2,450 | 9,238 | 0 | 147 | 10 | 11,689 | 79.0% | $0.00729 |
| 4 | sweet | 28 | 2,217 | 9,189 | 0 | 159 | 32 | 11,405 | 80.6% | $0.00694 |
| 5+ | native | 11 | 2,636 | 11,520 | 0 | 121 | 4 | 14,156 | 81.4% | $0.00764 |
| 5+ | sweet | 22 | 2,800 | 10,199 | 0 | 142 | 17 | 12,999 | 78.5% | $0.00804 |

**fixed prefix and first request**

| arm | prefix tokens (mean) | prefix min-max | req0 inTotal | req0 cacheRead (mean) | req0 hit>0 | req0 cacheRead values (count) | req0 cache ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| native | 5,707 | 5,694-5,720 | 5,889 | 2,308 | 63.1% | 3456x74 0x48 5504x6 5632x2 | 39.2% |
| sweet | 6,849 | 6,837-6,862 | 7,032 | 1,721 | 58.5% | 2944x76 0x54 | 24.5% |

**Prefix composition.** Same sweet trim as above (GPT-family prompt, rules file 6,005 chars, `grep` and explore off). Native uses opencode's stock GPT-family prompt and the full tool set. The sweet prefix is +1,143 tokens (+20%).

**prefix reuse inside a rollout (request n vs context of request n-1)**

| arm | requests n>=1 | cacheRead(n) / inTotal(n-1) | mean deficit tok | median deficit | breaks (deficit > 256) | mean deficit of breaks | mean new tok since n-1 | mean inUncached | median gap s (t1(n-1)->t0(n)) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 346 | 83.4% | 1,181 | 202 | 107 (30.9%) | 3,436 | 1,445 | 2,626 | 0.0 |
| sweet | 334 | 84.6% | 1,274 | 211 | 82 (24.6%) | 4,638 | 1,135 | 2,409 | 0.0 |

(deficit = inTotal(n-1) - cacheRead(n), signed. Positive = earlier context re-billed as uncached input; negative = the provider also cached part of the previous response. Exact identity for n>=1: inUncached(n) = new(n) + deficit(n), with new(n) = inTotal(n) - inTotal(n-1).)

**What the cache numbers mean.**
- Sol cache hits across rollouts are a lottery in both arms. Request 0 reads 0 tokens in 37% (native) and 42% (sweet) of rollouts. When it hits, it reads the shared head only: 3,456 tokens (native) and 2,944 (sweet). The head is shared by all 130 rollouts.
- Native goes above the head in 8 of its 82 hits (5,504 or 5,632 tokens, same-repo prefix). Sweet goes above the head in 0 of its 76 hits. If sweet had native's chance, the probability of seeing 0 is (1 − 8/82)^76 ≈ 0.0004. This fits the random rules path. The effect on money is small, because native itself rarely gets that hit (see the counterfactual table).
- Inside a rollout the prefix is byte-stable, and the provider still misses. Only 69% (native) and 75% (sweet) of requests n ≥ 1 reuse the full earlier context. 32 (native) and 21 (sweet) requests read 0 tokens. 35 of the 37 zero-read requests that have a next request are followed by a request that reads the full pre-miss context again, so the prefix did not change. Example: sweet `csharp-009`, request 1 reads 0 of 9,502 tokens ($0.0196, 37% of that rollout), request 2 reads 6,912 again.
- The cost of these misses is the "cache deficit" row below: $0.82 (native) and $0.85 (sweet), 23.4% and 22.8% of the bill.
- In the 1.18.4 request capture, `prompt_cache_key` is the opencode session id (a new key per rollout). This is a harness property and applies to product users too.

**where the dollars go (total over 130 questions per arm)**

| bucket | native $ | native share | sweet $ | sweet share | sweet - native $ | relative |
|---|---:|---:|---:|---:|---:|---:|
| uncached input | $2.7480 | 78.8% | $2.9898 | 80.2% | $0.2418 | 101% of gap |
| cache read | $0.2346 | 6.7% | $0.2567 | 6.9% | $0.0221 | 9% of gap |
| cache write | $0.0000 | 0.0% | $0.0000 | 0.0% | $0.0000 | 0% of gap |
| output (visible text + tool args) | $0.4827 | 13.8% | $0.4029 | 10.8% | -$0.0798 | -33% of gap |
| reasoning | $0.0218 | 0.6% | $0.0765 | 2.1% | $0.0547 | 23% of gap |
| TOTAL | $3.4871 | 100.0% | $3.7259 | 100.0% | $0.2388 | +6.8% |

Tokens per question (native | sweet): inUncached 10,569 | 11,499; cacheRead 18,049 | 19,748; inTotal 28,618 | 31,248; out(incl reasoning) 388 | 369

**uncached input split: first request vs later requests (new content vs cache deficit)**

| component (tokens per question) | native | sweet | native $ (130 q) | sweet $ (130 q) |
|---|---:|---:|---:|---:|
| req 0 uncached (prefix + question not cached across rollouts) | 3,581 | 5,310 | $0.9310 | $1.3807 |
| req >=1 new tokens since the previous request (its assistant output + tool results) | 3,846 | 2,916 | $1.0001 | $0.7582 |
| req >=1 cache deficit, signed (+ earlier context re-billed; - provider also cached part of the previous response) | 3,142 | 3,273 | $0.8169 | $0.8509 |
| sum = inUncached | 10,569 | 11,499 | $2.7480 | $2.9898 |

(check: measured inUncached per question native 10,569, sweet 11,499)

**fixed prefix vs everything else (prefix = system prompt + tool definitions + rules, measured in the first-request table)**

| arm | total $ | prefix $ (approx.) | prefix share | of which request 0 (mostly uncached) | of which re-reads in requests >=1 | everything else $ |
|---|---:|---:|---:|---:|---:|---:|
| native | $3.4871 | $1.1111 | 31.9% | $0.9137 | $0.1975 | $2.3760 |
| sweet | $3.7259 | $1.5845 | 42.5% | $1.3557 | $0.2288 | $2.1414 |

sweet - native: prefix $0.4734, everything else -$0.2346, total $0.2388.

**counterfactual: sweet first request cached like native**

| scenario | sweet total $ | vs native |
|---|---:|---:|
| observed | $3.7259 | +6.8% |
| every sweet request 0 caches its whole prefix (floor to granularity)  [upper bound on the fix] | $2.4754 | -29.0% |
| sweet head-hit rollouts get native's chance (9.8% of native head hits went above the head) to hit the whole prefix (expected value) | $3.6718 | +5.3% |
| native (reference) | $3.4871 | 0.0% |

### 2b. Turns and calls per question

**turns (requests), calls, calls per turn, per question**

| metric | native mean | native median | native p90 | sweet mean | sweet median | sweet p90 | paired sweet-native mean [95% CI, stratified boot B=20000 seed 42] |
|---|---:|---:|---:|---:|---:|---:|---:|
| turns (requests) | 3.66 | 3.0 | 5.0 | 3.57 | 3.0 | 5.0 | -0.09 [-0.33, 0.15] |
| tool calls | 4.02 | 3.0 | 7.0 | 3.05 | 2.0 | 6.0 | -0.97 [-1.36, -0.60] * |
| calls per turn | 1.05 | 1.0 | 1.6 | 0.78 | 0.7 | 1.1 | -0.27 [-0.33, -0.21] * |

Pooled calls per request: native 1.10, sweet 0.85. Calls per tool-using request: native 1.51, sweet 1.19. Requests with >=2 parallel calls: native 20.8%, sweet 9.7%. Requests with 0 calls (final answer): native 27.3%, sweet 28.0%.

Result size (chars/4 estimate): tokens per call native mean 809 (median 473, p90 2,038), sweet mean 822 (median 596, p90 1,859); result tokens per question native 3,247, sweet 2,504. Mean argument chars per call native 127, sweet 79.

Tool mix (calls per question): read 2.11|0.00; grep 1.66|0.00; ss-read 0.00|1.06; ss-search 0.00|0.72; ss-grep 0.00|0.68; ss-semantic 0.00|0.26; glob 0.25|0.00; ss-trace 0.00|0.16; ss-find 0.00|0.16  (native|sweet)

### 2c. Output and reasoning tokens

Source: provider-reported counts in `step-finish`. Counts, not estimates. The reasoning text is encrypted and not in the store, so there is no per-token text to check against. `thinkingChars` (61 and 105 chars per question) comes from a few summary parts.

**output and reasoning tokens (provider-reported COUNTS from step-finish: tokens.output, tokens.reasoning)**

| arm | out tok / q (incl. reasoning) | reasoning tok / q | visible out tok / q | median reasoning tok / q | out tok / turn | reasoning tok / turn | reasoning share of out | reasoning text chars / q | answer+text chars / q |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 388 | 17 | 371 | 0 | 106.0 | 4.6 | 4.3% | 61 | 598 |
| sweet | 369 | 59 | 310 | 45 | 103.3 | 16.5 | 16.0% | 105 | 800 |

Reasoning tokens of request n by the tool used in request n-1 (mean and n); native | sweet:

| previous request used | native mean reasoning | native n | sweet mean reasoning | sweet n |
|---|---:|---:|---:|---:|
| grep | 5 | 140 | - | 0 |
| read | 5 | 132 | - | 0 |
| glob | 2 | 20 | - | 0 |
| mixed | 15 | 54 | 36 | 24 |
| ss-search | - | 0 | 16 | 85 |
| ss-semantic | - | 0 | 39 | 23 |
| ss-read | - | 0 | 27 | 88 |
| ss-grep | - | 0 | 16 | 77 |
| ss-trace | - | 0 | 26 | 19 |
| ss-find | - | 0 | 22 | 18 |

Reasoning in request 0 (before any tool result): native mean 0, sweet mean 0.
Requests with reasoning>0: native 12.8%, sweet 37.3%.

### 2d. Why sweet costs more on Sol (and why it is not significant)

- Paired difference per question: +$0.0018, 95% CI [−$0.0004, +$0.0041]. By set: vault +13.6%, held-out +12.6%, OOD −5.4%.
- **Prefix +$0.473:** the prefix is +1,143 tokens, and only 24.5% of request-0 input is cached (native 39.2%). Request 0 costs $1.356 (sweet) vs $0.914 (native) in prefix terms.
- **Everything else −$0.235 (−9.9%):** 24% fewer calls (3.05 vs 4.02), 23% fewer result tokens (2,504 vs 3,247 per question), 24% fewer new tokens after request 0 (2,916 vs 3,846 per question), and −$0.080 visible output.
- Reasoning goes the other way: 59 vs 17 tokens per question (+$0.055; 37% vs 13% of requests contain reasoning).
- Turns barely change (3.57 vs 3.66), and sweet makes fewer parallel calls (9.7% vs 20.8% of requests have ≥ 2 calls). So the call cut does not cut context re-reads.

## 3. Findings (ranked by money)

1. **DeepSeek sweet prefix cache is broken by a random rules path in the bench, worth about 53 points of the +54.6%.** Fix: one fixed rules path per run (`SS_BENCH_STABLE_RULES_PATH=1`). Expect about +1.5% vs native (native cache pattern), or −7.8% if every sweet first request hit. These are recomputations, not measurements; a re-run with the fixed path is the test. In real use the first request of a session hits the cache only if a similar session ran recently.
2. **On DeepSeek the prefix is the only cost difference.** Non-prefix cost is identical ($0.1607 vs $0.1609). Uncached input is 72.5% of the sweet bill at a 50× price ratio between uncached and cached input, so any token outside the cache dominates.
3. **Sol loses about 23% of its bill to provider cache misses in both arms** (prefix stable; 25–31% of requests n ≥ 1 miss part or all of the earlier context). The harness does not control this. The levers are fewer turns and a smaller context.
4. **The sweet prefix is +1.15k tokens (+16% DeepSeek, +20% Sol).** It is the GPT-family prompt (9.9k chars) plus the rules file (6.0k chars), minus the grep tool and edited tool texts. Each extra prefix token costs one uncached price on request 0 and one cached price on each later request. For the +1.15k tokens that is about $0.00017 (DeepSeek) and $0.0023 (Sol) per question when request 0 is uncached, and about $0.00001 and $0.0004 when it is cached.
5. **Sol: sweet cuts calls by 24% but turns by only 2.5%** (turns CI [−0.33, +0.15] crosses zero). **DeepSeek: turns fall 10%** (−0.46, CI [−0.80, −0.09]) and calls 9% (CI crosses zero).
6. **Sweet reasons more per turn** (DeepSeek 83 vs 46 tokens, Sol 16.5 vs 4.6). It costs +10% of the gap on DeepSeek and 23% of the gap on Sol. The extra reasoning follows read-type results (DeepSeek: `read` 154, `ss-read` 101 tokens; Sol: `ss-semantic` 39, `ss-read` 27).
7. **Result size is not the problem.** Result tokens per question are 3,715 vs 3,871 (DeepSeek) and 2,504 vs 3,247 (Sol); median result per call is larger in sweet (406 vs 332; 596 vs 473).
8. **The sweet arm on DeepSeek still calls native `read` more than `ss-read`** (1.14 vs 0.67 per question).

## 4. Reproduce

```
node core/prompt-optimization/data/final-tuning/trace/normalize-opencode.mjs oc-dsflash41
node core/prompt-optimization/data/final-tuning/trace/normalize-opencode.mjs oc-sol61-high
node core/prompt-optimization/data/final-tuning/trace/analyze-opencode-forensics.mjs [cell]
node core/prompt-optimization/data/final-tuning/trace/handcheck-opencode.mjs oc-dsflash41 native:c-ood-03 sweet:c-v60-03 sweet:c-v60-01
```
The normaliser copies each `opencode.db` (+ WAL) to a temp folder and opens the copy read-only. It writes `<cell>.trace.jsonl` and `<cell>.validation.json` to `core/prompt-optimization/data/results/final-tuning-trace/`.
