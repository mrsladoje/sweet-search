# Trace read — opencode 1.18.4 + GPT-6.1 Sol high (ChatGPT subscription), final comparison (DEV questions)

Runs: `results/r282-oc-sol61-high-final-r1` (native, after, before) and `-r2` (after, before). `after` = arm `sweet` (6b50d7c5, index b7e7ea70), `before` = d013b492, `native` = no sweet-search (r1 only, one rep).
Per-request token data comes from the opencode databases `~/.ss-eval/r282/oc-sol61-high-final-r{1,2}/oc-data-<arm>/opencode.db` (`part` rows of type `step-finish`; one row per model request). The per-request sums match `runs.jsonl` `usage.in` for all 150 runs.
Prices fitted from `costRealizedUsd` (exact fit, max error $0.0000004): uncached input $2.00/M, cached input $0.10/M, output (incl. reasoning) $10.00/M. These are the same prices as the Codex report.
Findings reused from TRACES-cc.md and TRACES-codex.md: judge noise on no-match questions, "stops one hop early" model paths, the `-g` basename-glob behaviour. opencode has no exec yield, so the Codex poll-turn effect does not exist here. Cold-daemon first calls cost wall time only, not tokens.

## Bottom line

- The hard-tier score loss against native is not an after-code regression. Three questions carry 65% of it. One of them (composer-07) is native's off-ledger explore subagent plus one after-arm coverage miss. The other two (typedoc-16, sequel-08) are judge noise on equal substance.
- The native arm's ledger leaves out its subagent spend. Native delegated to the `explore` subagent in 3 of 30 questions. That spend ($0.27 in total) is not in `costRealizedUsd`. With it counted, after−native billed is about **−30%** (not −15%), and no-cache is about **+2%** (not +23%).
- Billed is cheaper because the opencode cache plugin keeps the first request warm and because ss-* output is smaller. No-cache is more expensive because the after arm makes 1.2 more model requests per question for the same number of tool calls. The average prompt per request is equal in the two arms.
- The stop rules in the rules text are not implicated. In all three loss questions, the after arm made as many or more calls than native's main agent. The facts that it lost were either on screen and left out, or missed by every arm.

## (1) Hard-tier score loss against native

Gap per question, native − mean(after r1, r2), hard tier (18 questions): mean +0.046 (the reported −5.3%).

| Question | Native − after | Share of gap |
|---|---:|---:|
| r3hb-composer-07 | +0.28 | 34% |
| r3h-typedoc-16 | +0.175 | 21% |
| r3hb-sequel-08 | +0.10 | 12% |
| 12 others | −0.07 … +0.075 (mean +0.018) | 33% |

Noise reference: on the hard tier, the same arm and code differs between r1 and r2 by a mean absolute 0.083 (after) and 0.124 (before). Native has one rep. Native also beats **before** by 0.089 (r1) and 0.048 (r2), so the gap is older than the after code.

| Question | Scores native / after r1, r2 / before r1, r2 | What native had that after did not | Cause |
|---|---|---|---|
| r3hb-composer-07 (completeness) | 0.88 / 0.75, 0.45 / 0.60, 0.70 | Native's main agent made 5 calls. Its first call was a `task` to the `explore` subagent, which made 29 tool calls over 7 requests and cost **$0.148**, off the row ledger. Native's true cost is $0.208, 3.2× after's $0.064. Native's answer has the same facts as after r1: runCleanup/abortJobs, FileDownloader, ArchiveDownloader, VcsDownloader reapply. After r1 adds CreateProjectCommand (not in gold). | After r1 vs native: judge noise on equal substance. After r2: model coverage miss. Its broad `ss-grep 'SignalHandler::create\|function cleanup\|function abortJobs' -k 60` printed `VcsDownloader.php:113: public function cleanup(...)`, but the model never read it. The answer lost the CRITICAL VcsDownloader reapply fact. It made 16 calls, so it did not stop early. No arm states the ZipDownloader "aborted by another operation" fact. After r2 read ZipDownloader 155–199 and left it out. Not a tool defect. |
| r3h-typedoc-16 (cross-layer) | 0.675 / 0.60, 0.40 / 0.75, 0.65 | Nothing of substance. All five answers give both CRITICAL facts: `commentStyle` values with default jsdoc, and `permittedRange` with exactly three slashes. They also name `collectCommentRanges`. No arm names `Converter._buildCommentParserConfig` or the `comments/index.ts` handoff, native included. Native and before r2 add "later lines are not checked individually". After r2 does not cite `typedoc.ts` (the option registration). | Judge noise. The after ss-search was better than before's: it returned `CommentStyle` and `CommentParserConfig` against CSS selectors and tests. See defect 1 for a small output fault. |
| r3hb-sequel-08 (decoy) | 1.0 / 0.85, 0.95 / 0.90, 0.90 | Nothing. All five answers have `[]` → `primary_key_lookup`, the cached `SELECT * FROM … WHERE pk = ` prefix + `literal_append` + `fetch_rows` without LIMIT, and the `dataset.first(primary_key_hash)` fallback. They also give the same fallback configurations. No arm names the `sql_comments` plugin. After r1's answer is close to word-for-word with native's. | Judge noise. After r1 also lost one call to `-g 'lib/sequel/model*'`, which matched only `lib/sequel/model.rb` (ripgrep glob semantics, as in the CC report). |

Verdict per category:
- Tool defect: none that cost a gold fact.
- Rules effect (stopping too early): not visible. composer-07 after made 19 and 16 calls, and sequel-08 after made 15 and 15. Native's main agent made 5 and 13. On typedoc-16, every arm, native included, stopped at the same depth.
- Judge noise: typedoc-16, sequel-08, and composer-07 after r1 against native.
- Off-ledger spend: native's composer-07 score was bought with a subagent run that costs 2.3× the whole after session.

## (2) Why billed is cheaper but no-cache is more expensive than native

Means per question, all 30 questions (after = 60 sessions, native = 30).

| Component | native | after | before | after − native |
|---|---:|---:|---:|---:|
| **Billed (row ledger)** | $0.0419 | $0.0356 | $0.0391 | −$0.0063 (−15%) |
| First request, uncached prompt | $0.0104 (5,224 tok) | $0.0058 (2,884 tok) | $0.0052 | −$0.0046 |
| Later requests, uncached new content (tool output + model text) | $0.0154 (7.7k tok) | $0.0107 (5.3k tok) | $0.0131 | −$0.0047 |
| Later requests, uncached re-billed prefix (cache misses) | $0.0056 (2.8k tok) | $0.0081 (4.0k tok) | $0.0085 | +$0.0025 |
| Cached prompt reads | $0.0030 (30k tok) | $0.0045 (45k tok) | $0.0052 | +$0.0015 |
| Output incl. reasoning | $0.0075 | $0.0065 | $0.0070 | −$0.0010 |
| **No-cache (all input at $2/M)** | $0.0988 | $0.1215 | $0.1388 | +$0.0227 (+23%) |
| Model requests | 4.5 | 5.7 | 5.9 | +1.2 |
| Tool calls | 7.4 | 7.5 | 7.8 | +0.1 |
| Tool calls per request | 1.64 | 1.32 | 1.32 | — |
| Mean prompt per request | 10.1k | 10.1k | 11.2k | 0 |
| First-request prompt | 5.9k | 7.0k | 7.1k | +1.1k (rules) |
| Cache hit share, all requests | 65.6% | 78.7% | 79.6% | +13 pp |
| Tool output chars | 30.4k | 23.1k | 26.1k | −24% |
| Explore subagent spend, off ledger | $0.0090 (3 of 30 questions) | 0 | 0 | — |
| No-cache subagent spend, off ledger | $0.0205 | 0 | 0 | — |

Mechanism:
- **Cache plugin (first request).** The after arm sends a stable `prompt_cache_key`. Its first request reads 6,656 cached tokens in 36 of 60 sessions. Native has no plugin, and its first request reads 0 in 24 of 30 sessions. This alone is −$0.0046 per question, about 73% of the billed gap.
- **Smaller tool output.** ss-* puts 24% fewer characters into context than native `read`/`grep`. Native reads whole files. This gives −$0.0047 of new uncached content.
- **More requests.** Native's 1.64 tool calls per request means that it sends several `read` and `grep` calls in parallel in one turn. The after arm sends 1.32 per request, mostly one `ss-read` per turn (3.8 `ss-read` per session). The tool call count is equal. No-cache cost is about requests × mean prompt. The mean prompt is equal (10.1k), so the +27% requests give the whole +23% no-cache gap. Under caching, each extra request costs only its new content plus cache misses, so the billed figure does not show this.
- **Cache misses.** 21 of 60 after sessions had a cold first request despite the plugin, and 0.2 later requests per question read 0 cached tokens. The re-billed prefix (+$0.0025) comes from these misses multiplied by the extra requests.
- **Rules size.** About 1.1k extra first-request tokens. When cached, this costs about $0.0001. It is not a driver.
- **Off-ledger subagent.** With native's subagent spend counted, native billed is $0.0509 and no-cache is $0.1193. After − native is then about **−30% billed** and **+1.8% no-cache**. Hard tier: native $0.0585 billed and $0.1394 no-cache against after $0.0408 and $0.1374, which is −30% and −1.4%. The bench comment at `opencode-task-runner.mjs:254` already notes that "subagent spend is off the row ledger". The cost preregistration says sidechain-inclusive.

## (3) Swings, after − before

| Question | Scores / costs (after r1, r2 / before r1, r2) | One-line cause |
|---|---|---|
| r3h-ocelot-24 (score) | 1.0, 1.0 / **0.0**, 1.0 | Judge noise on a no-match probe. Before r1's answer states the same negative as the other four ("ConfigureWebSockets omits authentication middleware"), as in the Codex report. |
| r3h-typedoc-16 (score) | 0.60, 0.40 / 0.75, 0.65 | Judge noise. All four answers have the same substance. After's ss-search was more on target than before's (CSS and test hits). |
| r3-ocelot-03 (score) | 1.0, 1.0 / **0.70**, 1.0 | Model path. Before r1 stopped at `DownstreamUrlCreatorMiddleware._replacer.Replace` and never named `DownstreamPathPlaceholderReplacer` (an expected file). It also lost a call to a guessed path (`…/Middleware/DownstreamUrlCreatorMiddleware.cs`). |
| r3-dgraph-29 (score) | 1.0, 0.90 / **0.70**, 0.90 | Model path. After r1 ran `ss-trace calculateSnapshot callers` and read `proposeSnapshot` (CDC minimum). Before r1 stopped after one read and named neither `proposeSnapshot` nor the CDC half. |
| r3-zipkin-02 (score) | 1.0, 1.0 / 0.95, 0.80 | Judge noise. All four name `getTraces` → `GetSpansByTraceId` → `groupByTraceId` with the same filters. Before r2 read only 22 lines and relied on the search pack, but its answer has the same facts. |
| r3hb-composer-11 (cost) | $0.031, $0.024 / $0.040, $0.064 | Full-line `ss-grep 'process-timeout\|setTimeout\(\|…' -k 65` mapped the setting chain in one call: 11 and 8 calls against 18 and 14. Before r2 also had a cold first request and a 0-cache fifth request ($0.038 of its $0.064). |
| r3-typedoc-10 (cost) | $0.053, $0.039 / $0.025, $0.019 | Retrieval. Before's top ss-search hit was an old over-long chunk `getFileComment 233-289`, which also held `getConstructorParamPropertyComment` (273-289). The after chunker splits the functions correctly, but that function did not reach the top 5. After needed 7 and 9 calls (8 and 10 requests), and r1 also had two 0-cache requests. |
| r3hb-sequel-08 (cost) | $0.088, $0.051 / $0.077, $0.079 | Cache misses. After r1 and r2 both made 9 requests. In r1, requests 1, 2 and 9 read 0 cached tokens, and the re-billed prefix was $0.045 against $0.004 in r2. |

## (4) ss-* defects

0 tool errors in 450 after-arm ss-* calls.

1. **ss-search: tiny entity shows the wrong neighbour (minor, after code).** typedoc-16, both reps: `## #1 src/lib/utils/options/declaration.ts:41-41 [typeAlias: CommentStyle]` is a one-line alias. It is followed by `# continues at …:43 OutputSpecification`, an unrelated type. The same-name `CommentStyle` const at 34-40, which holds the values the question asks for, appears only as a name-only row. In r2 the model needed an extra `ss-read declaration.ts 30 42`. Fix: for a tiny entity, expand to the same-name sibling (or the declaration it aliases) before the next declaration in the file.
2. **ss-search ranking miss after the chunker change (DEV observation, not yet a defect).** typedoc-10: the query "constructor parameter property documentation comment description @param" does not put `getConstructorParamPropertyComment` in the top 5 on the after index. Before found it only through the over-long `getFileComment` chunk. This cost +4 to +6 calls in both after reps. Check whether identifier sub-tokens of a function name reach BM25 for split chunks.
3. **`-g` path glob without `**` (known, CC defect 3).** sequel-08 after r1: `-g 'lib/sequel/model*'` matched only `lib/sequel/model.rb`. It cost one call. A hint for "glob did not match files in subdirectories" would save it.
4. **Not defects (checked).** composer-07 after r2 had the gold hit on screen and did not read it. typedoc-16 `CommentParserConfig` was a name-only row, and no arm, native included, followed it.

## Levers to close the hard-tier gap without raising cost (ranked)

1. **Fix the measurement before tuning ($0).** Count subagent spend on the row (sidechain-inclusive, as preregistered). Give native a second rep. Mechanism: composer-07, the largest single gap (34%), was bought by a $0.148 off-ledger explore run. Native has one rep against the after arm's two, and same-arm rep noise (0.083) is larger than the mean gap (0.046). With composer-07 out, the gap is 0.032 per question.
2. **Answer-side family coverage (prompt, small cost).** The "visible siblings" rule today applies only to edits. A one-line extension is: "when the question asks for each or every case, account for every implementation hit of the broad grep, or say why it is out of scope". Mechanism: composer-07 r2 lost a CRITICAL fact (`VcsDownloader::cleanup`) that its own grep had printed. Expected cost: +1 `ss-read` only on enumeration questions. Do not tune it on these DEV questions alone. Validate it on held-out aggregates.
3. **Tiny-entity expansion fix (tool, $0).** Defect 1. It removes one call on alias-shaped hits and puts the value list on screen in the first result.
4. **Fewer requests per question (tool side, funds levers 2–3).** The +1.2 requests are the whole no-cache gap, and they come from one `ss-read` per turn. A multi-range `ss-read` (several file:range pairs in one call) would let the model read what native reads in parallel. Do not add generic "batch your calls" wording, because memory marks it dead. This is a cost lever, and it lets lever 2 run at equal cost.
5. **Typedoc-10 ranking check (tool).** Defect 2. It is a cost lever on the easy tier, not a hard-tier score lever.

**Stop rules:** not implicated by these traces. The rules say "Stop searching the instant your evidence answers … one confirmed file+symbol, or one named cross-file link, is enough" and "The trace is COMPLETE the moment you can name the link". In the three loss questions, the after arm searched as deep as or deeper than native's main agent. The lost facts were either on screen and left out (composer-07 r2), or missed by every arm (the ZipDownloader abort, typedoc's Converter handoff, sequel's `sql_comments`). Both rule texts (before and after) carry the same stop lines, and before shows the same gap against native. So a loosening of the stop rules is not supported by evidence. It would also raise requests, which are the cost driver here.
