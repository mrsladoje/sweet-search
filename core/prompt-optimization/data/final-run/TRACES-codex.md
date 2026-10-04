# Trace read — Codex CLI 0.159.2 + GPT-6.1 Sol high, final comparison (DEV questions)

Runs: `results/r282-codex-sol61-high-final-r1` (native, after, before) and `-r2` (after, before). `after` = arm `sweet` (6b50d7c5 / f3fc7f95), `before` = d013b492, `native` = no sweet-search.
Per-request token data comes from the Codex rollouts in `~/.ss-eval/r282/codex-sol61-high-final-r{1,2}/codex-home/sessions/**` (one `token_usage_record` per model request). The per-request sums match `runs.jsonl` usage for all 150 runs.
Prices fitted from `costRealizedUsd` (exact fit): uncached input $2.00/M, cached input $0.10/M, output $10.00/M. A cached token costs 1/20 of an uncached token, so cache behaviour sets the bill.

## Bottom line

- Native is cheaper on Codex because of two harness-level effects, not because ss-* output is large. The ss-* output is smaller than native rg/sed output.
- Effect 1 (cache prefix): the sweet arms replace the stock Codex base prompt (`model_instructions_file`, trim `instructions-conflict+batch-yt3batch2`). The trimmed text differs from stock at character 37. Native gets 12,288 cached tokens on 30/30 first requests and on every mid-session cache fallback. The sweet arms get 7,168–14,208 (mostly 8,064 or 11,776). Each sweet session pays about 2.5k more uncached prompt tokens at start and about 3k more at fallbacks.
- Effect 2 (poll turns): an ss-* call that runs longer than the 10-second Codex exec yield returns empty with a `session_id`. The model then spends one or more `write_stdin` requests to collect the result. That is 1.40 extra requests per question in the after arm (0.47 in r1, 2.33 in r2). Native has 0.
- Counterfactual on the same rollouts: if every after request had native's 12,288-token cache floor, after−native drops from +24.6% to +8.4%. Without the poll requests it drops to +8.8%. With both, after is **−6.0%** against native (r1 alone: −10.6%).
- No score loss traces to an after-code regression. The score swings are judge variance on equal substance, or the model stopping one fact short in all arms.

## Cost decomposition (mean per question, after = both reps, n=60; native n=30)

| Component | native | after | before | after − native | share of +24.6% |
|---|---:|---:|---:|---:|---:|
| Total billed | $0.0432 | $0.0538 | $0.0563 | +$0.0106 | 100% |
| First request, uncached prompt | $0.0037 (1,858 tok) | $0.0087 (4,350 tok) | $0.0106 | +$0.0050 | +47% |
| Later requests, uncached re-billed prefix (cache fallback) | $0.0063 (3,158 tok) | $0.0141 (7,037 tok) | $0.0125 | +$0.0078 | +74% |
| Later requests, uncached new content (tool output + model text) | $0.0188 (9,411 tok) | $0.0124 (6,198 tok) | $0.0130 | −$0.0064 | −60% |
| Cached prompt reads | $0.0070 (70k tok) | $0.0111 (111k tok) | $0.0121 | +$0.0041 | +39% |
| Output incl. reasoning | $0.0073 (732 tok) | $0.0075 (755 tok) | $0.0080 | +$0.0002 | +2% |
| Model requests | 4.37 | 6.87 | 7.42 | +2.50 | — |
| of which exec calls | 3.37 | 4.47 | 5.03 | +1.10 | — |
| of which `write_stdin` polls | 0 | 1.40 | 1.38 | +1.40 | — |
| Tool output chars | 37.9k | 25.4k | 26.6k | −33% | — |

Notes:
- "Calls +2.3% ns" in the aggregate counts logical calls. Model round trips are +57% (4.37 → 6.87). The extra trips are 1.1 more exec cells and 1.4 poll cells.
- Poll requests alone cost $0.0068 per question in after (64% of the gap). They overlap with the fallback line, because a poll request often lands on a cache fallback.
- Prefix size: the first request is 15.2k tokens (after) against 14.1k (native). The rules developer text is about 1.4k tokens. When cached, it costs about $0.001 per question (2%). The cost of the rules is in its cache misses, not in its size.
- Reasoning and output tokens are equal across arms. They are not a cause.
- r1 against r2: after−native is +17.4% in r1 and +31.8% in r2. r2 had 2.3 polls per question and r1 had 0.47.

### Why the sweet prefix loses cache (evidence and hypothesis)

- Prefix items are byte-identical inside each arm (hashes checked). Only the per-repo `environment_context` changes.
- Native first-request cache reads: 12,288 in 30/30. Native fallbacks: 19/19 land on 12,288.
- After first-request cache reads: r1 {8064: 11, 13952: 10, 11776: 4, 7168: 3, …}; r2 {11776: 16, 14208: 9, 8064: 3, 7168: 2}. After fallbacks land on 11,776, 8,064, 7,168 and once on 0.
- The `before` arm shows the same pattern. The cause is the shared Codex harness configuration, not the after code.
- Hypothesis (not verified): the stock Codex prefix (tools + stock base instructions + stock developer messages) stays hot in the provider cache because all Codex traffic shares it. The stock tool block comes first and gives the 7–8k floor in the sweet arms. The custom base text after it depends on this run's own traffic.
- Test before acting (paid, a few cents, needs owner approval): 10 one-turn `codex exec` sessions with the stock base prompt plus `developer_instructions`, and 10 with the trimmed prompt. Compare `cached_input_tokens` of the first request.

### Why ss-* calls exceed the 10-second yield

| Tool | r1 median / p90 wall (s) | r2 median / p90 wall (s) |
|---|---|---|
| ss-search (after) | 3.5 / 10.6 | 8.7 / 11.8 |
| ss-grep (after) | 1.7 / 11.4 | 6.0 / 13.9 |
| ss-read alone | 0.1–0.2 / 0.6–2.0 | same |
| native rg / sed | 0.0 / 0.0 | — |

- The first ss-* call of a session yields in 37 of 120 sessions (31%). Later calls yield in 20–23%.
- Worst cases: dgraph-29 after r2, `ss-grep "TruncateEntriesUntil"` gave no output for about 65 s (12 polls). dgraph-31 before r2, `ss-search` gave no output for 35 s and `ss-grep` hit two 30-s waits.
- The model polls with `yield_time_ms: 1000`. A slow call can thus cost several requests. The trimmed prompt has a wait template for builds and tests, but the model does not apply it to ss-* calls.
- r2 interleaved about 15 repos × 2 arms, so up to 30 project daemons. Daemon cold starts or fleet eviction are the likely cause. This is not verified from logs, because the runtime directory keeps only `daemons.json`.

### Is ss-* output larger than what the agent uses?

No, not against native. After puts 33% fewer tool-output characters into context than native. New uncached content per question is 6.2k tokens against 9.4k.
Within ss-*: an ss-search call returns about 1.1k tokens, and an ss-grep call about 0.4k. About 30% of the files these calls return show up in the answer or in a later call (rough parse). Halving ss-search packs would save at most about 3% of the bill.

## Per swing

| Question | Scores native / after r1, r2 / before r1, r2 | One-line cause |
|---|---|---|
| r3h-ocelot-24 (negative-decoy) | 1.0 / 0.95, **0.0** / 1.0, 1.0 | Judge variance. All five answers state the same negative: the WebSocket branch (`ConfigureWebSockets`) omits `AuthenticationMiddleware`. For no-match probes, the judge sees only "EXPECTED: no match exists". After r2 lists files and symbols first and never writes "No match found", so the judges read it as a match claim. Native's answer opens with "No match found." Bench defect, not a tool change. |
| r3hb-composer-07 | 0.75 / 0.45, 0.50 / 0.75, 0.60 | Model path plus judge variance. All arms cover runCleanup/abortJobs and the FileDownloader, ArchiveDownloader and VcsDownloader cleanups. All arms miss the ZipDownloader "aborted by another operation" fact. Both after answers add RequireCommand/CreateProject manifest-revert material that is not in gold. After r2 also spent 2 polls. |
| r3-dgraph-29 | 0.70 / 0.70, 0.70 / 1.0, 0.85 | Model path. After and native both miss the CDC-tracker half of the minimum and `proposeSnapshot`. Before r1 ran a second ss-search that surfaced `proposeSnapshot` (draft.go:1122). After r2 cost $0.099 against $0.031 native because of 17 polls (see the defect section). |
| r3-tortoise-orm-22 | 0.80 / 0.75, 0.80 / 1.0, 1.0 | Judge variance. All five answers name `_analyze_db_default_fields`, the sentinel/explicit split and the `OperationalError` advice. All five omit the omit-set fact. After r1 cost 2× because of 2 polls (first ss-search and ss-grep each took >10 s). |
| r3h-tortoise-orm-06 | 1.0 / 0.95, 0.60 / 0.89, 0.95 | Judge variance. After r2 has the same files, symbols and chain as after r1 (bool cast, `get_client_class`, `create_connection`, REGEXP/MATCH overrides). |
| r3-ocelot-27 | 1.0 / 0.80, 0.80 / 1.0, 1.0 | Judge variance. All five answers say `Host` and `Transfer-Encoding` in `RequestMapper.UnsupportedHeaders`, checked by `IsSupportedHeader`. |
| r3hb-sequel-08 (cost) | $0.046 / $0.121, $0.077 | Polls plus turns. After r1: 14 requests (8 exec + 5 polls), and its first request had 0 cached tokens. Native read 8 `sed` ranges plus an `rg` in one exec (20k chars) and finished in 6 requests. |
| r3hb-okhttp-12 (cost) | $0.035 / $0.060, $0.087 | Polls. 4 and 8 polls. Even `ss-read` cells returned empty at 10 s (r1 call 4), so the machine or daemon was slow, not the tool's work. Native: 3 requests. |
| r3-dgraph-29 (cost) | $0.031 / $0.037, $0.099 | r1 is at parity. r2: 23 requests, 17 of them polls (an ss-grep without output for about 65 s). |
| r3h-jj-12 (cost) | $0.051 / $0.074, $0.097 | Turns, no polls. Sweet follows search → grep → read pack (5 and 7 execs). Native merged `rg` and `sed` in the same cells (3 execs). After r2 also had a miss (`ss-grep "auto-advance"`, 16 tokens) and a second ss-search. |
| r3hb-composer-11 (cost) | $0.040 / $0.066, $0.075 | r1: 2 more exec turns than native. r2: 7 polls (12 requests). |
| r3-dgraph-31 (after < before) | after $0.027, $0.032 / before $0.051, $0.082 | After stopped after the two absence probes (ss-search + ss-grep → "No match found"). Before r1 chased the `Login` decoy (7 calls). Before r2 had 10 polls. Partly the absence rule, partly variance. |
| r3hb-grdb-07 (after < before) | after $0.060, $0.066 / before $0.094, $0.098 | Before r2 had 4 polls (every cell hit the 10-s yield). Before r1 read larger packs over 6 execs. After r2 joined its reads into 4 execs. Mostly polls plus variance. |

## Defects

1. **ss-* latency exceeds the Codex 10-s exec yield** (product or bench environment). 31% of first ss-* calls and 20–23% of later calls return empty and need `write_stdin` polls. In the worst case, ss-grep/ss-search on dgraph gave no output for 35–65 s. It costs 1.4 requests per question, about 16 percentage points of the gap. The likely cause is a daemon cold start or eviction across about 30 interleaved project clones. This is not verified.
2. **The custom Codex base prompt loses the stock-prefix cache** (bench and `init --codex`). The cache floor is 7–8k tokens instead of 12,288, at session start and after every fallback. It costs about 16 percentage points.
3. **No-match judge prompt** (bench). The gold for a no-match probe is only "no match exists", and `expectedFacts` is hidden. A correct negative written as a file list scores 0 (ocelot-24 after r2). This is noise in the score columns, not a sweet-search defect.

## Levers, ranked by expected $ effect on Codex

Estimates come from replaying the observed rollouts with the one change, so model behaviour is held fixed.

1. **Keep the stock Codex prefix byte-identical.** Drop the `model_instructions_file` trim for Codex, or move its lines (wait template, join-reads line) into `developer_instructions`. Expected effect: −10 to −16 percentage points of cost (replay: +24.6% → +8.4%; r1: +17.4% → −4.0%). The full effect needs the rules to sit after the stock developer messages. In the current layout the rules come before the stock skills text, so expect the lower end. Risk: the trim's measured task-bench effect was −5 to −6% and not significant ([[harness-hillclimb-result]]), so the trade looks favourable. Run the cache test above before the change.
2. **Keep ss-* calls under 10 s on Codex.** Find the r2 stall (daemon start/eviction, dgraph). Make the first call of a session return under 10 s (pre-warm or a faster cold path). A Codex-only option: let the ss-* shim print a short "still running" notice before the yield. Do not add prompt lines for this, because generic wait/batch wording is dead ([[harness-hillclimb-result]]). Expected effect: −8 percentage points (r1-like) to −16 (r2-like). In single-repo real use the effect is probably smaller.
3. **Both levers together.** Replay: after −6.0% against native (r1 alone: −10.6%), at the same score. That is the target state.
4. **Rules text size (about 1.4k tokens).** At most −2 to −3 percentage points once lever 1 is in place. Today about half of it is in the first-request cache miss, which lever 1 already removes.
5. **ss-search pack size and ss-grep -k.** At most −3 percentage points. ss-* output is already 33% smaller than native output. Not worth a retune for Codex cost.

Not proposed: generic "batch your calls" wording or join-more lines, to cut the +1.1 exec turns. Memory marks them dead (+7..+60%) and the yt3batch2 join line is already in the prompt.
