# c02 verify (mechanism lens) — structured `ss-*` surface for opencode, reopening register A4

Verifier: `verify-c02-mechanism`. Date 2026-09-02. Cost $0. Box scratch: `/tmp/wf-slatec/verify-c02-mechanism/` (`pair.py`, `pair.out`, `rederive.py`). Local scratch: `scratchpad/pair.py`, `scratchpad/rederive.py`. Results tree untouched. No grading logs opened. No HO2 file opened.

## 0. Verdict

**Refuted as stated (confidence 0.75).** The measured gap is real and reproduces to the digit. The remedy is not shown in any trace, and the headline ceiling is two to four times the bound the candidate's own source calls honest. Vehicle (a), the plugin intercept, can only make the sweet arm behave like native, so its true ceiling is cost parity, not −10.1% to −12.7%. Vehicle (b), custom structured tools, has a sequence-respecting ceiling of −4.5% of the sweet cell before schema cost, which nets to roughly parity with native. The concrete trace pair shows the model paging through one file in dependent windows, which no tool surface merges. Half of all serial single-read pairs in the sweet arm are that pattern. The "byte advantage up to −8%" is a relabelled request figure, not a byte measurement. The claude-code −4% contradicts its own cited source. Codex 0.0 is correct. What survives is narrow: opencode only, vehicle (b), a ceiling of about parity with native, unbenchmarked, and a user decision.

## 1. What I re-derived and what reproduced [M]

All from `slate-c/forensics/scripts-opencode-calls-per-request/data/requests.json` (66 native rows from `fp-opencode-tab-20260826`; 66 sweet rows = 33 from `fp-opencode-tab-20260826` + 33 from `rp-oc-tab-20260827`), with `rederive.py`, unless marked box.

| claim in the candidate | re-derived value | status |
|---|---|---|
| requests per rollout native 16.32, sweet 19.70 (+3.38) | 16.32 / 19.70 | reproduces |
| calls per request 1.546 / 1.106 | 1.546 / 1.106 | reproduces |
| cost per rollout $0.008969 / $0.009265 | $0.008969 / $0.009265 | reproduces; +$0.000296 = +3.3% |
| native structured-bearing requests before first edit: 327, 64.2% multi, 2.657 calls/request | 327, 64.2%, 2.657 (869 calls) | reproduces |
| native after first edit: 85, 17.6%, 1.247 | 85, 17.6%, 1.247 (106 calls) | reproduces; 106/975 = 10.9% ("11%") |
| sweet ss-bearing before first edit: 500, 13.8%, 1.298 | 500, 13.8%, 1.298 (649 envelopes) | reproduces |
| sweet after first edit: 62, 1.6%, 1.016 | 62, 1.6%, 1.016 | reproduces |
| moq pair marginal $0.002202 for four removable requests | $0.002202 (box, `pair.py`; message ids `msg_044c18b6f001yTr8PxF5SxMkqT`, `msg_044c1985b001U5RPw32047UcKF`, `msg_044c1b3c0001KEUwaIycQYfjSh`, `msg_044c1bf02001GH70pJh154rDwp`) | reproduces |
| `ss-grep`+`ss-find` share of opencode ss ops 29.2% | 29.7% on the canonical 66 rows (234 of 788) | ratio holds; absolute count does not (see §4.3) |
| MCP server registers 8 tools, no `grep`, no `find` | 8 tools at `mcp/server.js` lines 171–334: search, trace, index, health, repo-map, vocab-prewarm, read, read-semantic | holds, with one nuance (§4.4) |
| bench preflight rejects plugins | `opencode-task-runner.mjs` lines 74–75 throw on `resolved.plugin.length !== 0` [C] | holds |

Every measured input the candidate cites is sound. The refutation is about what those inputs show and about the ceiling built on them.

## 2. Do the cited traces show the mechanism? No.

### 2.1 The concrete pair, opened on the box [M `pair.py`, `pair.out`]

Sweet: `rp-oc-tab-20260827/agent-state/devlooped__moq-1262-sweet/opencode-retained/session-1787859832153-1442751-bb37c5b1/attempt-1.stdout.ndjson`, 42 requests, replayed cost $0.030294 (3.3× the sweet cell mean), unresolved. Native: `fp-opencode-tab-20260826/agent-state/devlooped__moq-1262-native/opencode-retained/session-1787762148033-1040662-2528fbd9/attempt-1.stdout.ndjson`, 22 requests, $0.013015, unresolved. The task is on the brief's dead-everywhere list (0/3 in every opencode cell).

The source documents index requests from 0. The five single `ss-read` requests are the 17th to 21st assistant messages. The message ids match the source, so the content claim is right and only the index is off by one.

The five sweet reads, in order: `ExpressionComparer.cs 240 300`, `ExpressionExtensions.cs 1 90`, `ExpressionComparer.cs 1 180`, `ExpressionComparer.cs 175 240`, `Match.cs 55 155`. Reads three and four page backwards through the file the first read opened. The model chose those windows after seeing lines 240–300. A structured tool does not tell the model in advance that it needs lines 1–240. The native request (`msg_03eee7625001lzj4XCmgDEARBl`) read `ExpressionComparer.cs` 240–320 and `ExpressionExtensions.cs` 1–130 plus `Setup.cs` 1–130 and one grep. Native never read `ExpressionComparer.cs` 1–240 anywhere in its 22 requests. Native paged the same file later, in a separate request (`145 85` at its 20th message). So of the five sweet reads, two are dependent paging, one targets a file native never opened in that request, and two map to native's request. The claim "five requests against one" overstates the removable count by about two times. The candidate text also says native read "three of those files"; native read three files, of which two are shared with the sweet run (the source's own `alignment.json` lists two shared files).

Bytes: the five sweet reads delivered 19,032 characters; native's one request delivered 17,628 (10,378 in reads plus a 7,250-character grep). The saving in this pair is round trips, not bytes.

### 2.2 The dependent-paging pattern is half of the observed serial-read floor [M `rederive.py`]

Sweet serial single-`ss-read` runs of length ≥2: 33 runs, 78 requests, 45 consecutive pairs. 22 pairs read the same file; 21 of those 22 use a different window (paging). 19 of the 33 runs contain a same-file pair. Native: 13 runs, 29 requests, 16 pairs, 3 same-file. The source's observed floor (C1 −2.2%, C2 −2.8%) is therefore about half dependent paging that no surface change merges. The independent remainder is worth about −1.1% to −1.4% [I from the pair counts].

### 2.3 No trace shows `ss-*` batching under any structured delivery

Register A4 is unbenchmarked. The 41 sweet requests carrying a native structured tool were all single-call (0 of 41 multi), and the source itself says that number "says the habit was not carried over, not that it is impossible". The supporting evidence is a within-arm tool-family contrast on opencode (Bash 37.3% native vs 36.1% sweet companion rate; `read` 84.5%). The counter-evidence is the same Bash tool on claude-code moving 3.5% → 41.3% between main thread and subagents with the tool fixed. Both are [M] in `research/structured-vs-shell-parallelism.md` §3. The inference "structured `ss-*` would batch like `read`" is [I], and the candidate's own source calls the 54.6% rate "an upper anchor, not a prediction".

## 3. Is the ceiling arithmetic right? No, by 2 to 4 times.

### 3.1 The headline belongs to a density counterfactual the source rejects

The −10.1% to −12.7% comes from 673 sweet retrieval calls regrouped at native's 2.370 calls per request, ignoring order (3.43 requests per rollout) [M sibling §4.1]. The DEDUP entry's −12.7% is the pre-edit variant: 649 envelopes at 2.657 = 244 requests instead of 500, 3.87 per rollout, at $0.000304 = $0.001178 = 12.7% of $0.009265 [M+I; arithmetic checks]. Both regroup calls freely across the sequence. The same source's sequence-respecting bound (`data/ceiling-align.txt` section B) is:

| estimator | requests saved / rollout | $ / rollout | share of $0.009265 |
|---|---:|---:|---:|
| B1 consecutive read-only runs at native read width 2.154 | 0.64 | −$0.000253 | −2.7% |
| B2 consecutive search-only runs at native search width 1.961 | 0.59 | −$0.000171 | −1.8% |
| B1+B2 dependency-strict | 1.23 | −$0.000424 | **−4.5%** (prefix-only −3.4%) |
| B3 all exploration runs at pooled width 2.484 (merges a search with the reads after it) | 3.06 | −$0.001030 | −11.1% |
| control: native at its own pooled width | 0.77 | | native does not merge search with following reads either |

Native's own habit is `[glob,glob,grep]` then `[read×4]`: searches together, reads together, never a search merged with the reads that depend on it (after a native search-only request the next request is a read 51% of the time [M source §4]). "Pack like native" is therefore B1+B2, −4.5%. B3 credits sweet with a packing native itself does not perform. The headline −10.1% to −12.7% is 2.2× to 2.8× the −4.5% bound. With the §2.2 paging correction to B1 the bound is about −3.5% to −4.5%.

### 3.2 Vehicle (a) cannot produce any of it

Under the plugin intercept the model emits native `read`/`grep`/`glob` and the guide must go, or the model keeps calling Bash `ss-*`. Request count then equals native's by construction. Reads are "byte-identical by construction" per the candidate, so 61% of native's retrieval calls (606 of 993) carry no sweet content at all. Ceiling for (a): sweet cost → native cost, i.e. −3.2% of today's sweet cell and 0% against native. The candidate concedes this in its "honest expectation" but keeps −10.1% to −12.7% as the headline.

### 3.3 The "byte advantage up to −8%" is a relabelled request figure

The −8% is the source's B3 outcome "the speculative figure [moves sweet] to about −8%" against native (source §6 item 3). It is not a byte measurement. The real byte position today [M `rederive.py`]: sweet ingests 28,372 tokens per rollout against native 30,404 (first request 8,355 vs 6,898, the +1,457-token guide; later requests 20,017 vs 23,506, so sweet's tool results are 14.8% smaller). In dollars: ingest sweet $0.002837 vs native $0.003040 (−$0.000203, −2.2% of the sweet cell); re-send $0.004241 vs $0.003764 (+$0.000477); output $0.002187 vs $0.002164. Net +$0.000297 = the +3.3% gap. So a −2.2% byte advantage already exists and is already inside the +3.3%. Under vehicle (a) it is lost (reads become native bytes). Under vehicle (b) it persists but cannot be added again.

### 3.4 Schema cost is unpriced and eats most of vehicle (b)

Six structured `ss-*` schemas enter the cached prefix. Proxy [I]: the eight MCP tool definitions are 9,435 characters of source at `mcp/server.js` 171–334; the text sent to the model for six tools is roughly 1,000 tokens. At sweet's 19.7 requests per rollout that is about 18,700 cache-read tokens plus 1,000 ingested = $0.000287 = 3.1% of the sweet cell, unless the guide is cut by the same amount (the candidate's own kill condition). Vehicle (b) at full adoption: +$0.000297 − $0.000424 + $0.000287 = +$0.000160 against native (+1.7%) with no guide cut, or −$0.000127 (−1.4%) with an equal guide cut. That is parity, not −7%.

### 3.5 Claude-code −4% and codex 0.0

Claude-code: the −4% is built on a −6.4% to −9.1% counterfactual (2.82 requests) whose own author writes "the tool-mix explanation is wrong for claude-code" and "any claim that a structured `ss-*` surface would fix claude-code has to explain that 3.5%-versus-41.3% swing first" [M sibling §3]. The claude-code rows.json cost ($0.005853 / $0.013065) was never reconciled with the brief's ledger ($0.021558 / $0.020727) [flagged, unresolved, sibling §9]. No claude-code number is supportable. Codex 0.0 is right: 2,406 calls in 2,406 requests, both arms [M sibling §2]; I did not re-count it.

## 4. Denominators and smaller corrections

### 4.1 Cells
Ceilings are stated against the fresh-pool sweet TAB cell $0.009265 (66 rows) in the DEDUP entry, but the −10.1% uses $0.009201 (63 `fp-` rows only, sibling §4.1). The difference is under 1%. Use 66 rows and $0.009265 throughout.

### 4.2 Solves
Unmeasured, as the candidate says. Native 41/66 and sweet 41/66 in this pool at very different batching rates, which is neutral. The cited pair is on a task neither arm solves. The candidate trades no solve on paper, but the (a) vehicle removes the guide and 11% of native structured calls come after the first edit, where the index is stale (E3). Kill at ±6 of 66 stands.

### 4.3 The 1,014 / 3,273 census
`/tmp/wf-slatec/real-user-product/census.py` globs `*-sweet/**/*.ndjson` under both `fp-opencode-tab-20260826` and `rp-oc-tab-20260827`, so the 11 repair tasks are counted twice (about 96 opencode rollouts, not the canonical 66; 1,222 ops against the canonical 788). The share is robust (29.7% canonical against 29.2% reported). The absolute "1,014 of 3,273" is inflated by about 400 operations and should be re-stated on canonical rows.

### 4.4 MCP "no grep"
True for a bare-grep-shaped tool. The MCP `search` tool has a `regex` parameter (ColGrep: regex anchor plus semantic re-rank) [C `mcp/server.js` line 171 description]. So regex-anchored retrieval exists; what is missing is the compact `file:line match` output and `find`. Say "no bare-grep or find tool", not "no grep".

### 4.5 Indexing
Source request indices are 0-based. Cite message ids in the synthesis, not indices.

## 5. What survives, and the revised ceiling

- **Reproduced and new [M]:** on opencode the request gap is not a phase-mix artefact (13.8% against 64.2% before the first edit). It is a tool-family or harness-text effect, or a result-content effect (sweet issues a second search after a search 44% of the time against native 13%); these cannot be separated at $0.
- **Vehicle (a) plugin intercept:** ceiling = parity with native (−3.2% of the sweet cell, 0% against native). It cannot beat native. It deletes the sweet arm's existing −2.2% byte advantage. It is "make sweet into native", not a sweet lever.
- **Vehicle (b) custom structured tools, opencode only:** ceiling −3.5% to −4.5% of the sweet cell at full adoption of native's batching habit (B1+B2 less the paging share), minus about 3.1% for schemas unless the guide is cut equally. Net −0.4% to −4.5%, landing sweet between +2.9% and −1.2% against native. Realised fraction unknown; the native `read` rate is an upper anchor. Unbenchmarked; reopens A4; `needs_user_decision`; `new_tool: true`.
- **Codex:** 0.0 at the pinned 0.146.1.
- **Claude-code:** no supportable number; strike the −4%.
- **Withdraw:** "−10.1% to −12.7%", "byte advantage up to −8%", "three of those files", the absolute 1,014/3,273.

Revised ceiling, one line: **opencode only, vehicle (b): −0.4% to −4.5% of the sweet cell (about parity with native), unbenchmarked; (a) exactly parity; codex 0; claude-code unsupported.**

## 6. Evidence checked

Local: `slate-c/BRIEF.md`; `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`; `slate-c/register/DEAD-LEVER-REGISTER.md` row A4; `slate-c/candidates/DEDUP.md` c02 entry; `slate-c/candidates/cost-structural.md` §3.3, §4.2 (CS-2); `slate-c/candidates/real-user-product.md` §2.1, RU-4; `slate-c/forensics/opencode-calls-per-request.md` (full); `slate-c/research/structured-vs-shell-parallelism.md` (full); `slate-c/forensics/scripts-opencode-calls-per-request/{oc-request-census.py, data/requests.json, data/census.txt, data/ceiling-align.txt}`; `mcp/server.js` 155–334; `eval/agent-read-workflows/bin/ss-grep`; `eval/task-completion-bench/harness/opencode-task-runner.mjs` 69–98; `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` (grep for opencode bytes).

Box (read-only): `results/rp-oc-tab-20260827/agent-state/devlooped__moq-1262-sweet/opencode-retained/session-1787859832153-1442751-bb37c5b1/attempt-1.stdout.ndjson`; `results/fp-opencode-tab-20260826/agent-state/devlooped__moq-1262-native/opencode-retained/session-1787762148033-1040662-2528fbd9/attempt-1.stdout.ndjson`; `/tmp/wf-slatec/real-user-product/census.py`. Scripts: `/tmp/wf-slatec/verify-c02-mechanism/{pair.py, pair.out, rederive.py}`.

## 7. What I could not finish

- I did not re-count the codex 1.000 or the claude-code companion rates; I took them from the sibling [M].
- I did not verify the opencode 1.18.4 plugin hook API (`tool.execute.before/after`) against source; the sibling's [C] stands unverified here.
- I did not separate "serial because Bash" from "serial because ranked results invite a follow-up search"; both fit the 44% search-after-search figure and no $0 test separates them.
- The schema token cost is a proxy from the MCP source size, not a tokeniser count [I].
- I did not check whether the 23 different-file consecutive pairs were independent; the moq pair's file names were all known before the run started, which is one case, not a census.
