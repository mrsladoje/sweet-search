# Forensics "phase-anatomy": where sweet spends more requests than native on tasks both arms solve

Date: 2026-09-02. Agent: phase-anatomy (Slate C forensics). Spend: $0 (trace reading and arithmetic only). Nothing under `results/` was written. No grading log was opened. No HO2 task was read.

Tags: **[M]** measured (script named), **[C]** read from code, **[I]** inferred.

## 0. Verdict

On the tasks that both arms solve 3 of 3, sweet does not spend more requests than native in total, and it costs less on two harnesses. Codex: 14.72 sweet requests per rollout against 14.58 native (+0.14), cost −3.4%. Opencode: 13.78 against 12.58 (+1.19), cost −3.7%. Claude-code main thread: 15.67 against 15.70 (−0.03), cost +2.1% [M `phase-anatomy.py`, `aggregate.py --boundary sight`; 12, 12 and 11 tasks, 72, 72 and 66 rollouts]. The pool-wide premium (+0.3%, +3.3%, −3.9%) therefore lives in the ten tasks that are not solved everywhere, where sweet spends +1.50 (codex) and +6.00 (opencode) more requests per rollout [M `extras.py` (c)].

By phase, the only place where sweet spends more requests on all three harnesses is **verify**, the requests after the first edit that are not edits: +0.56 codex, +0.86 opencode, +1.03 claude-code per rollout. Sweet's **localize** is shorter on opencode (−0.97) and claude-code (−0.79), and its **understand** is shorter on codex (−0.53) [M]. The verify excess has three concrete sources, read in the transcripts. First, on `aws-actions__configure-aws-credentials-42` sweet hunts an index-excluded 35,000-line bundle (`dist/index.js`) after its edit: +5.3 to +8.7 verify requests per rollout on every harness; the index and the "not indexed" note shipped on 2026-08-28 target exactly this (register E1, E2). Second, on claude-code sweet runs its post-edit due diligence as a chain of single-probe `ss-grep`/`ss-find`/`ss-search`/`ss-read` requests: 2.21 such requests per solved rollout against native's 1.03, and none of sweet's 87 post-edit probes on solved rollouts preceded an edit of a file not yet edited, while 33 of native's 83 did [M `postedit-search-yield.py`]. One instance is an extensionless dot-config file (`.eslintrc`) that the index does not admit; native read it in two requests, sweet searched around it for up to 12 requests. Third, both arms interleave `run_tests` and `write_stdin` polls on codex identically; that part is arm-symmetric.

Two facts distort the head-to-head and are not levers. Claude-code native still loses 2.67 `Read` calls per rollout to `Invalid pages parameter: ""` (176 failed calls in 66 rollouts); those are 1.39 wasted requests per solved-everywhere rollout, 5.9% of native's main-thread cost, which flatters sweet on claude-code by about 4% [M `claude-errors.py`, `extras.py` (a)]. And the harness plan tools (`update_plan`, `todowrite`, `TaskCreate`/`TaskUpdate`) each take a request of their own, 3.8 to 4.1 per rollout on codex and opencode in both arms; the sibling report `verify-tail.md` (§5, §10) records this and seeds it, so this report only adds its cost share by class and a solve screen.

## 1. Scope, data and method

Runs [M]: `fp-codex-tab-20260826` (132 rows), `fp-opencode-tab-20260826` (native 66 rows; sweet rows of the 11 non-repair tasks) plus `rp-oc-tab-20260827` (sweet rows of the 11 repair tasks listed in `/root/fresh-run/repair-tasks.txt`, the canonical composition of `e4-opencode-lib.py`), `fp-claudecode-tab-20260826` (132 rows). The solve matrix reproduces the brief: native 41/41/43, sweet 39/41/40.

Selection [M]: a task is "solved everywhere" when both arms resolve it in 3 of 3 reps. Codex and opencode: 12 tasks (`absinthe-graphql__absinthe-998`, `apigee__registry-961`, `asynkron__protoactor-dotnet-1909`, `aws-actions__configure-aws-credentials-42`, `axelrod-python__axelrod-671`, `callstack__react-native-paper-972`, `celestiaorg__nmt-192`, `final-form__final-form-64`, `jazzband__tablib-454`, `locationtech__jts-622`, `mathnet__mathnet-numerics-1072`, `mirumee__ariadne-codegen-218`). Claude-code: the same minus `celestiaorg__nmt-192` (sweet rep 0 stopped without an edit), 11 tasks. Four of the twelve opencode tasks (`apigee`, `asynkron`, `aws-actions`, `mathnet`) take their sweet rows from the repair pass.

Requests are rebuilt from the raw transcripts, never from `turns/` [M `phase-anatomy.py`]. Codex: one `event_msg/token_count` (`info.last_token_usage`) per request; the `function_call` items since the previous `token_count` are its calls; codex emits exactly one call per request (0 of 2,538 requests with two). Opencode: one `step_finish` per request, `tokens.input + cache.read + cache.write` as context, `output + reasoning` as output. Claude-code: one assistant `message.id` per request, usage from the record with the largest input+output, `tool_use` blocks deduplicated by id; subagent files under `subagents/` are parsed the same way and attributed to the phase of the parent request that spawned them (`.meta.json` `toolUseId`). Codex rollout file: `rows[].rolloutFile`. Opencode: `rows[].openCodeRawAttempts[].stdout`. Claude-code: the project directory whose name carries `r<rep>-`; when a rep has two transcripts, the one whose aggregate usage matches `rows[].usage` [M, rule copied from `e2-harvest.mjs`].

Validation [M]: request counts equal `idealTurns` on every codex and opencode row and on every claude-code row where `idealTurns` is not null; the per-request realized cost reproduces `costRealizedUsd` exactly on opencode and within 8% on codex (the ledger prices cache writes at a premium; requests and tokens are unaffected); 0 rollouts with a non-empty patch and no detected edit request; 0 rollouts without a transcript.

Edited files: `<arm>/patches.json` (rep 0) and `<arm>/rep-N/patches.json`, `diff --git` headers [M]. `preds-<arm>.jsonl` holds one line per task, not per rep.

Phase rule (per request, 0-based index i) [C `phase-anatomy.py` docstring]:
- **localize**: i is before the first request in which the agent sees a file the final patch edits. Two boundaries are computed. *read*: the first request with a read-class call (`Read`, opencode `read`, `ss-read`, `cat`/`sed`/`head`/`tail`/`nl`) whose target is an edited file, as the task statement says. *sight*: the first request whose tool output or call target names an edited file (an `rg -n` hit, an `ss-search` body, a `glob` listing). The **sight** boundary is the primary one, because on sweet the search result already carries the file body and the agent often edits from it without a separate read (section 6.2). The read boundary moves 0.6 to 0.8 requests per sweet rollout from understand into localize and is reported as a sensitivity.
- **understand**: from that request up to the first request that carries an edit call (`apply_patch` heredoc or tool, `Edit`/`MultiEdit`/`Write`, opencode `edit`/`write`/`apply_patch`, `sed -i`, a redirect into a repo file).
- **edit**: a request at or after the first edit that carries an edit call, failed or not.
- **verify**: a request after the first edit that carries a tool call but no edit call (`run_tests`, polls, `git diff`, re-reads, searches, plan updates).
- **finalize**: a text-only request after the last tool call. **narrate**: a text-only request after the first edit that is not terminal (0.06 per rollout, claude-code native only).

Request class, highest priority first: edit > test (`run_tests` or a test runner) > exec (other program runs) > delegate > read > search (`ss-search`/`ss-semantic`/`ss-grep`/`ss-find`/`ss-trace`, `rg`/`grep`/`find`/`ls`, `Grep`/`Glob`/opencode `grep`/`glob`) > git > poll (`write_stdin`, `BashOutput`) > plan (`update_plan`, `todowrite`, `TaskCreate`/`TaskUpdate`/`TodoWrite`) > other > text. A request that packs several calls takes the highest class, so on opencode a native `git diff` packed with a `grep` counts as search; section 3.2 gives the call-level census that removes this effect.

Tokens per request: `in` (billed context), `newIn = max(0, in − previous in)` (tokens that entered context this request, the brief's INGEST), `resent = in − newIn` (the re-sent prefix), `out` (output including reasoning). Cost per request = `0.10·newIn + 0.01·resent + 0.60·out` per million tokens, the brief's formula. Claude-code sidechain requests are counted separately.

Scripts (part of the evidence): `scripts-phase-anatomy/phase-anatomy.py` (box; parser and segmenter; `--all-tasks` for the 22-task variant), `aggregate.py` (tables; `--boundary read|sight`), `callkinds.py` (call-level census), `classcost.py` (cost by class), `extras.py` (failed reads, sidechains, subset comparison, edit-before-read), `postedit-search-yield.py`, `showreq.py` (per-rollout request tables), `probe.py` (raw tool outputs of chosen requests), `claude-errors.py`, `dotfile-census.py`, `fallback-census.py`. Outputs under `scripts-phase-anatomy/data/` (`anatomy.json`, `anatomy-alltasks.json`, `aggregate-sight.md`, `aggregate-read.md`, `callkinds-sight.md`, `classcost.md`, `extras.md`, `postedit-search-yield.md`, `req-<harness>-<task>.txt`). Box scratch: `/tmp/wf-slatec/phase-anatomy/`.

## 2. Per-harness, per-phase table (sweet minus native, per rollout, sight boundary)

Means per rollout over the solved-everywhere rollouts. Δ is the mean over tasks of the per-task paired difference (3 reps per arm per task); "S>N" counts tasks where sweet's per-task mean is larger. All [M `aggregate.py --boundary sight`].

### 2.1 codex (12 tasks, 36 native and 36 sweet rollouts)

| phase | requests N / S / Δ (median, S>N) | ingest tokens N / S / Δ | re-sent tokens N / S / Δ | output tokens N / S / Δ | cost N / S / Δ |
|---|---|---|---|---|---|
| localize | 1.75 / 1.83 / +0.08 (0.0, 4) | 14,752 / 16,410 / +1,658 | 12,435 / 15,857 / +3,421 | 239 / 223 / −15 | 0.001743 / 0.001933 / +0.000191 |
| understand | 5.78 / 5.25 / −0.53 (−0.7, 4) | 8,522 / 5,140 / −3,382 | 110,676 / 97,977 / −12,699 | 877 / 698 / −179 | 0.002485 / 0.001913 / −0.000572 |
| edit | 1.19 / 1.22 / +0.03 (0.0, 2) | 1,497 / 1,236 / −261 | 30,298 / 28,804 / −1,495 | 504 / 528 / +24 | 0.000755 / 0.000728 / −0.000026 |
| verify | 4.86 / 5.42 / +0.56 (0.0, 5) | 3,845 / 3,805 / −40 | 133,564 / 144,937 / +11,373 | 826 / 940 / +114 | 0.002216 / 0.002394 / +0.000178 |
| finalize | 1.00 / 1.00 / 0.00 | 367 / 267 / −100 | 28,615 / 26,590 / −2,025 | 116 / 123 / +7 | 0.000393 / 0.000367 / −0.000026 |
| **total** | **14.58 / 14.72 / +0.14 (−1.2, 4)** | 28,983 / 26,858 / −2,125 | 315,590 / 314,165 / −1,425 | 2,561 / 2,512 / −49 | **0.007591 / 0.007335 / −0.000256 (−3.4%)** |

The +1,658 localize ingest is the tool guide (median +1,457 tokens, 12 of 12 tasks). Sweet's understand ingests 3,382 fewer tokens because `ss-search` bodies replace `sed` reads. Sweet's verify re-sends 11,373 more tokens because it has 0.56 more requests there.

### 2.2 opencode (12 tasks, 36 native and 36 sweet rollouts)

| phase | requests N / S / Δ (median, S>N) | ingest N / S / Δ | re-sent N / S / Δ | output N / S / Δ | cost N / S / Δ |
|---|---|---|---|---|---|
| localize | 2.42 / 1.44 / −0.97 (−0.7, 0) | 8,560 / 8,450 / −110 | 13,446 / 3,666 / −9,780 | 348 / 189 / −160 | 0.001199 / 0.000995 / −0.000204 |
| understand | 3.78 / 5.00 / +1.22 (+0.5, 7) | 9,883 / 6,069 / −3,813 | 49,724 / 55,863 / +6,139 | 563 / 658 / +95 | 0.001824 / 0.001560 / −0.000263 |
| edit | 1.11 / 1.19 / +0.08 (0.0, 3) | 1,284 / 1,929 / +645 | 21,997 / 20,153 / −1,844 | 493 / 533 / +41 | 0.000644 / 0.000714 / +0.000070 |
| verify | 4.28 / 5.14 / +0.86 (−0.2, 4) | 3,293 / 4,456 / +1,163 | 89,371 / 98,412 / +9,040 | 806 / 799 / −7 | 0.001706 / 0.001909 / +0.000203 |
| finalize | 1.00 / 1.00 / 0.00 | 421 / 401 / −20 | 23,020 / 20,905 / −2,115 | 101 / 115 / +14 | 0.000333 / 0.000318 / −0.000015 |
| **total** | **12.58 / 13.78 / +1.19 (+0.5, 7)** | 23,440 / 21,306 / −2,135 | 197,558 / 198,998 / +1,440 | 2,310 / 2,294 / −17 | **0.005706 / 0.005497 / −0.000209 (−3.7%)** |

Sweet spends more requests but less money: its understand ingests 3,813 fewer tokens, and its localize re-sends 9,780 fewer because it reaches the file in 1.44 requests where native needs 2.42 (a plan request plus a `glob`+`grep` batch).

### 2.3 claude-code main thread (11 tasks, 33 native and 33 sweet rollouts)

| phase | requests N / S / Δ (median, S>N) | ingest N / S / Δ | re-sent N / S / Δ | output N / S / Δ | cost N / S / Δ |
|---|---|---|---|---|---|
| localize | 2.61 / 1.82 / −0.79 (−0.7, 2) | 18,941 / 17,478 / −1,463 | 31,279 / 18,441 / −12,838 | 235 / 165 / −71 | 0.002348 / 0.002031 / −0.000317 |
| understand | 5.12 / 5.18 / +0.06 (−0.7, 3) | 6,363 / 8,097 / +1,734 | 111,352 / 120,252 / +8,900 | 639 / 590 / −49 | 0.002133 / 0.002366 / +0.000233 |
| edit | 2.64 / 2.30 / −0.33 (0.0, 3) | 2,522 / 1,981 / −541 | 84,253 / 75,312 / −8,942 | 961 / 882 / −80 | 0.001671 / 0.001480 / −0.000191 |
| verify | 4.24 / 5.27 / +1.03 (0.0, 5) | 2,529 / 3,046 / +518 | 130,806 / 152,157 / +21,351 | 584 / 972 / +388 | 0.001911 / 0.002409 / +0.000498 |
| narrate | 0.06 / 0.00 / −0.06 | 32 / 0 | 1,530 / 0 | 53 / 0 | 0.000050 / 0 |
| finalize | 1.03 / 1.09 / +0.06 (0.0, 1) | 415 / 352 / −63 | 31,524 / 33,321 / +1,797 | 258 / 256 / −2 | 0.000511 / 0.000522 / +0.000010 |
| **total** | **15.70 / 15.67 / −0.03 (−1.0, 3)** | 30,802 / 30,955 / +153 | 390,744 / 399,481 / +8,738 | 2,730 / 2,864 / +133 | **0.008626 / 0.008808 / +0.000183 (+2.1%)** |

Sidechains (subagents), attributed to the parent's phase [M `extras.py` (b)]: native 7 subagent files in 7 of 33 rollouts, 2.67 requests and $0.002070 per rollout, all spawned in localize; sweet 2 files in 2 of 33 rollouts, 0.88 requests and $0.000964 per rollout, also in localize. With sidechains the claude-code totals become native $0.010696 against sweet $0.009772 (−8.6%) [I, sum of the two measured rows]. The sidechain cost is a lower bound (register G6).

Verify is the one phase that is dearer for sweet on every harness: +$0.000178 codex, +$0.000203 opencode, +$0.000498 claude-code per rollout, driven by re-sent prefix (+11k, +9k, +21k tokens) and, on claude-code, +388 output tokens.

Sensitivity to the boundary [M `aggregate.py --boundary read`]: with the strict read boundary, localize/understand become codex 3.56/3.53 (sweet) against 2.89/4.64 (native), opencode 3.22/3.22 against 2.42/3.78, claude-code 3.79/3.21 against 3.24/4.48. The strict boundary makes sweet's localize look +0.55 to +0.81 requests longer and its understand −0.56 to −1.27 shorter; totals and post-edit phases are unchanged. Anyone segmenting sweet by "first read" will misread search-result reads as localization.

## 3. Where the request delta lives: classes and calls

### 3.1 Requests per rollout by class and phase (native / sweet) [M `aggregate.py`]

codex:

| phase | edit | test | read | search | git | poll | plan | text |
|---|---|---|---|---|---|---|---|---|
| localize | · | 0.03/0.08 | 0.39/0.14 | 0.31/0.50 | · | 0.03/0.06 | 1.00/1.06 | · |
| understand | · | 0.97/0.92 | 3.22/1.50 | 0.08/1.39 | · | 0.28/0.31 | 1.19/1.14 | · |
| edit | 1.19/1.22 | · | · | · | · | · | · | · |
| verify | · | 1.25/1.33 | 0.94/0.50 | 0.06/0.50 | 0.39/0.72 | 0.36/0.42 | 1.86/1.92 | · |
| finalize | · | · | · | · | · | · | · | 1.00/1.00 |

Class deltas summed (sweet − native, requests per rollout): read −2.42, search +1.94, git +0.33, poll +0.11, test +0.08, plan +0.06, edit +0.03.

opencode:

| phase | edit | test | read | search | git | plan | text |
|---|---|---|---|---|---|---|---|
| localize | · | 0.11/0.14 | 0.31/0.00 | 0.94/0.31 | · | 1.06/1.00 | · |
| understand | · | 0.89/0.86 | 1.47/1.58 | 0.33/1.69 | 0.03/0.03 | 1.06/0.83 | · |
| edit | 1.11/1.19 | · | · | · | · | · | · |
| verify | · | 1.17/1.22 | 0.33/0.53 | 0.31/0.33 | 0.47/1.00 | 2.00/2.00 | · |
| finalize | · | · | · | · | · | · | 1.00/1.00 |

Class deltas: search +0.75, git +0.53, plan −0.28, edit +0.08, test +0.06, read 0.00.

claude-code:

| phase | edit | test | delegate | read | search | git | poll | plan | text |
|---|---|---|---|---|---|---|---|---|---|
| localize | · | 0.73/0.55 | 0.18/0.03 | 0.58/0.09 | 0.24/0.30 | · | · | 0.88/0.85 | · |
| understand | · | 0.27/0.45 | 0.03/0.00 | 4.52/2.42 | 0.27/2.27 | · | · | 0.03/0.03 | · |
| edit | 2.64/2.30 | · | · | · | · | · | · | · | · |
| verify | · | 1.36/1.39 | · | 0.88/0.61 | 0.15/1.61 | 0.88/0.64 | 0.06/0.00 | 0.88/1.00 | · |
| finalize/narrate | · | · | · | · | · | · | · | · | 1.09/1.09 |

Class deltas: search +3.52, read −2.85, edit −0.33, git −0.24, delegate −0.18, plan +0.09, poll −0.06.

### 3.2 Tool calls (operations) per rollout by phase and kind (native / sweet) [M `callkinds.py`]

| harness | calls/request N / S | localize all | understand read / search | verify read / search / git | total read / search / git / plan |
|---|---|---|---|---|---|
| codex | 0.93 / 0.93 | 1.75 / 1.83 | 3.22/1.50 · 0.08/1.39 | 0.94/0.50 · 0.06/0.50 · 0.39/0.72 | 4.56/2.14 · 0.44/2.39 · 0.39/0.72 · 4.06/4.11 |
| opencode | 1.45 / 1.06 | 4.92 / 1.44 | 4.00/2.31 · 0.89/2.25 | 0.36/0.53 · 0.44/0.33 · 1.39/1.56 | 5.00/2.83 · 4.28/2.89 · 1.61/1.61 · 4.11/3.83 |
| claude-code | 1.04 / 0.94 | 2.94 / 1.85 | 5.73/2.42 · 0.45/2.33 | 0.88/0.61 · 0.15/1.61 · 0.91/0.64 | 7.30/3.12 · 1.06/4.24 · 0.91/0.64 · 1.79/1.88 |

Three readings. (1) Sweet swaps read operations for search operations roughly one for one: codex −2.42 reads, +1.95 searches; claude-code −4.18 reads, +3.18 searches; opencode −2.17 reads, −1.39 searches (native's `glob`/`grep` batches inflate its search count). (2) On opencode the extra sweet requests are not extra operations: sweet makes 14.64 calls in 13.78 requests, native 18.28 calls in 12.58 requests; the `git` calls are equal (1.61 each) but sweet spreads them over 1.03 requests against native's 0.47. This is the recorded opencode driver (brief §1; `opencode-calls-per-request.md`). (3) Tool-result bytes per rollout: sweet returns less on every harness in reads (codex 11.4 kB against 32.7 kB; opencode 18.3 against 26.2; claude-code 12.2 against 26.9) and more in searches (8.6 against 2.3; 8.9 against 11.4; 14.5 against 3.6) [M `callkinds.py`].

### 3.3 Cost by request class (share of the arm's cost, native / sweet) [M `classcost.py`]

| class | codex | opencode | claude-code |
|---|---|---|---|
| plan (includes request 0 and its preamble ingest) | 38.6% / 42.0% | 40.6% / 36.3% | 17.7% / 22.3% |
| plan, request 0 excluded, all 22 tasks [M `extras`] | 15.5% / 13.3% | 17.7% / 13.1% | 4.1% / 4.4% |
| read | 28.5% / 11.9% | 19.1% / 14.5% | 31.3% / 15.5% |
| search | 1.7% / 12.1% | 8.5% / 11.9% | 3.9% / 22.1% |
| test | 9.8% / 10.4% | 10.4% / 10.2% | 14.4% / 13.6% |
| edit | 9.9% / 9.9% | 11.3% / 13.0% | 19.4% / 16.8% |
| git | 2.9% / 4.9% | 4.2% / 8.0% | 5.1% / 3.7% |
| text (final answer) | 5.2% / 5.0% | 5.8% / 5.8% | 6.5% / 5.9% |

The first request of 94 to 100% of codex and opencode rollouts is a plan call, so the plan class absorbs the preamble ingest; the second row removes request 0. Sweet's read plus search share is below native's on codex (24.0% against 30.2%) and opencode (26.4% against 27.6%) and above it on claude-code (37.6% against 35.2%).

## 4. The largest per-task per-phase request gaps, read in the transcripts

Rollout id format: `<harness>/<task>/<arm>/rep<N>`; transcript paths are in `data/req-*.txt`. Request indices are 0-based positions in the rebuilt request sequence. All counts [M `showreq.py`, `probe.py`].

### 4.1 codex

| rank | task / phase | native | sweet | Δ |
|---|---|---:|---:|---:|
| 1 | `apigee__registry-961` / verify | 8.33 | 13.67 | +5.33 |
| 2 | `aws-actions__configure-aws-credentials-42` / verify | 5.67 | 10.33 | +4.67 |
| 3 | `mirumee__ariadne-codegen-218` / understand | 6.33 | 4.00 | −2.33 |
| 4 | `jazzband__tablib-454` / verify | 3.67 | 5.67 | +2.00 |
| 5 | `apigee__registry-961` / understand | 10.33 | 8.33 | −2.00 |

1. **apigee verify (+5.33)** is one rollout. `codex/apigee__registry-961/sweet/rep2` has 25 verify requests of 41: its first edit broke a legacy test in another package, and it iterated four edits, each followed by `run_tests pkg/wipeout` plus a `write_stdin` poll (requests 13–14, 16–17, 23–24, 27–28, 34–35, 37–38: six test+poll pairs), with `ss-read`/`ss-grep`/`ss-trace` reads of `names/spec.go`, `names/deployment.go`, `spec_revision.go` in between. `codex/apigee__registry-961/native/rep2` did the same repair loop with four edits and five test+poll pairs in 31 requests, and reps 0 and 1 of both arms stayed at 5 to 9 verify requests. The loop is a fix-design repair, present in both arms; the request cost is the codex test+poll pair (arm-symmetric, register A9).
2. **aws-actions verify (+4.67)** is the bundle hunt. After editing `action.yml` and `index.js`, all three sweet rollouts try to check the committed webpack bundle: `sweet/rep0` requests 12–19 (`git status && ss-read package.json`, `ss-grep "AWS_ACCESS_KEY_ID" --in dist/index.js` → `0 total match(es)`, `ss-read dist/index.js 1 20`, `ss-semantic dist/index.js …` → `[FALLBACK]` span 1–35000, `git diff`, two more `ss-grep --in`, `git diff --check`), `sweet/rep1` requests 12–20 (nine requests, ending with `rg -n -F "AWS_ACCESS_KEY_ID" dist/index.js` which finally shows lines 222–224 and an edit of the bundle), `sweet/rep2` requests 9–13. Native reads the bundle directly (`native/rep1` request 12 `sed -n '210,240p' dist/index.js`, one request, then edits it; `native/rep2` request 11 `rg -n … dist/index.js`) or does not touch it (`native/rep0`). `dist/index.js` was not in the index in these runs; the 2026-08-28 fixes (register E1, E2) re-admit git-tracked build output and print "not indexed" on a zero result. Recorded.
3. **ariadne understand (−2.33)** is sweet's retrieval win: `ss-search`/`ss-semantic` return the body of `result_fields.py`, so sweet edits after 3 to 5 understand requests where native runs 5 to 8 `sed -n` reads (`native/rep0` 8 understand requests).
4. **tablib verify (+2.00)**: after `run_tests` shows the two legacy visible tests failing, sweet reads them: `sweet/rep0` requests 8–9 (`ss-grep … && ss-semantic`, `ss-read src/tablib/core.py 440 480 && ss-read … 550 610 && ss-read tests/test_tablib.py 540 580`), `sweet/rep2` requests 8–10 (three search/read requests on `test_row_lpush`), `sweet/rep1` a failed `apply_patch` (request 5, context mismatch) then `ss-read src/tablib/core.py 55 85` and a retry (+2 requests). Native does the same check in 0 to 1 request (`native/rep0` request 8 `rg … && sed`, `native/rep2` request 9 `nl -ba … | sed`).
5. **apigee understand (−2.00)**: native's `rep0`/`rep1` read 10 to 12 files with `sed` in understand (15 requests each); sweet's `ss-search` bodies shorten it to 5 to 11.

### 4.2 opencode

| rank | task / phase | native | sweet | Δ |
|---|---|---:|---:|---:|
| 1 | `aws-actions__configure-aws-credentials-42` / verify | 4.33 | 13.00 | +8.67 |
| 2 | `apigee__registry-961` / understand | 3.67 | 8.67 | +5.00 |
| 3 | `aws-actions__configure-aws-credentials-42` / understand | 3.33 | 7.67 | +4.33 |
| 4 | `apigee__registry-961` / localize | 6.33 | 2.00 | −4.33 |
| 5 | `apigee__registry-961` / verify | 4.33 | 7.00 | +2.67 |

1. **aws-actions verify (+8.67)** is the same bundle hunt, larger. Native sees `dist/index.js` in its first `glob **/*` + `grep` batch and edits it together with the source in one `apply_patch` (`native/rep0` request 6 patches `action.yml,dist/index.js,index.js`; `rep1` request 5; `rep2` request 5), then verifies in 4 to 5 requests. Sweet's `ss-grep` never lists the bundle, so it discovers it after the edit: `sweet/rep0` (from `rp-oc-tab-20260827`) requests 10–18 (`git ls-files dist/index.js`, `ss-grep "AWS Access Key ID|aws-access-key-id"` → only `action.yml`, `index.js`, `index.test.js`, `wc -l dist/index.js`, `ss-read dist/index.js 1 5`, `ss-semantic dist/index.js` → `[FALLBACK]`, `ss-read dist/index.js 34500 35000` → 21,909 bytes truncated by the harness, `ss-read dist/index.js 500 850` → 5,704 new tokens); `sweet/rep1` requests 11–18 including `npm run package` (fails offline), `ss-read dist/index.js 1000 3000` (5,821 tokens) and `ss-read dist/index.js 1 1000` (13,396 tokens) before an `apply_patch dist/index.js`; `sweet/rep2` requests 12–22. Sweet edited the bundle in 2 of 3 reps here, native in 3 of 3. Recorded (E1, E2); section 6.5 adds what the fixes do not cover.
2. **apigee understand (+5.00)** is one probe per request. `sweet/rep0` requests 2–11 chain `ss-find`, `ss-read`, `todowrite`, `run_tests`, `ss-search && ss-grep`, three `ss-grep` in one request, three `ss-read` in one request, `ss-grep`, three `ss-grep`, three `ss-read` (10 requests, 21 calls). Native's understand is 2 to 4 requests because its localize already read the handlers in packed `read` batches (`native/rep0` request 3: four `read` calls, 9,675 new tokens). Native's localize is 6.33 requests against sweet's 2.00 (rank 4), and native's rollout costs more: $0.012081 against $0.010970 per rollout. Sweet spends +3.67 requests and −$0.001111 on this task.
3. **aws-actions understand (+4.33)**: native reads `action.yml`, `index.js`, `index.test.js`, `package.json` in one request with four `read` calls (`native/rep0` request 2); sweet reads them across 3 to 4 requests and adds probes for the build step (`sweet/rep1` request 7 `ss-grep "ncc build|dist/index|build"`, request 9 `glob dist/**`).
5. **apigee verify (+2.67)**: `sweet/rep1` re-reads `list.go` three times between two more edits (requests 12–19); native's verify is `todowrite`, `run_tests`, one packed `git diff || grep` request.

### 4.3 claude-code

| rank | task / phase | native | sweet | Δ |
|---|---|---:|---:|---:|
| 1 | `callstack__react-native-paper-972` / verify | 4.33 | 11.67 | +7.33 |
| 2 | `apigee__registry-961` / understand | 6.00 | 12.33 | +6.33 |
| 3 | `aws-actions__configure-aws-credentials-42` / verify | 6.33 | 12.33 | +6.00 |
| 4 | `jazzband__tablib-454` / verify | 2.00 | 6.67 | +4.67 |
| 5 | `aws-actions__configure-aws-credentials-42` / edit | 7.33 | 3.00 | −4.33 |

1. **callstack verify (+7.33)** is a lint-convention hunt that the index cannot answer. The fix destructures a prop to stop forwarding it, which leaves an unused variable; both arms then look for the repository's convention (`_color`, an eslint `no-unused-vars` setting). Native finds it in two to three requests: `native/rep1` requests 7–9 (`grep -RIn "color: _\|_color" src`, `grep -n "no-unused" .eslintrc`, `Read .eslintrc`), `native/rep2` requests 6–8. `sweet/rep2` spends 16 search/read requests (10–21, 25–28, 33–34): `ss-grep "no-unused-vars|unused-vars" -k 10` returns only `flow-typed/npm/eslint_vx.x.x.js` hits, `ss-grep "argsIgnorePattern|varsIgnorePattern|no-unused" -k 20` the same, `ss-grep 'eslint' -k 10` 1,088 matches in 20 files, `ss-read package.json 25 55`, `ss-find "lint configuration" --regex "eslintConfig|no-unused-vars"` a 10 kB result from the flow-typed stubs; `.eslintrc` is never shown. The file exists in the golden checkout (`/root/.ss-eval/golden/callstack__react-native-paper@3bba0304…/.eslintrc`, 682 bytes) [M `ls`] and is not admitted by `FILE_PATTERNS.include`, which lists only `.cursorrules`, `.clinerules`, `.roorules*`, `.windsurfrules`, `.aider.conf.yml` among dotfiles [C `core/infrastructure/config/search.js:51-160`]. `sweet/rep0` shows the same hunt in 6 requests (8–13); `sweet/rep1` skipped it (11 requests total). All 6 rollouts solved.
2. **apigee understand (+6.33)**: sweet's probes are single `ss-grep` requests, and five of them fail on unescaped regex parentheses: `sweet/rep0` requests 5–6 (`ss-grep "func (.*ListArtifacts"`, `ss-grep "ListArtifacts(ctx"`), `sweet/rep1` requests 8–9 and 14. That is the regex-crash hygiene item shipped on 2026-08-28 (register E2). Both arms then fail edits in streaks on the tab-indented Go file `server/registry/internal/storage/list.go`: `sweet/rep0` requests 18–26 are nine consecutive failed `Edit` calls, `native/rep0` requests 13–16 four; register C10/D1.
3. **aws-actions verify (+6.00)**: the bundle hunt again, `sweet/rep1` requests 7–21 (seven `ss-grep … --in dist/index.js` with zero hits, `ss-read dist/index.js 1 8`, `ss-read dist/index.js 34500 35000`); native `Read dist/index.js 210+100` in understand and edits it (`native/rep0` requests 7, 12–13).
4. **tablib verify (+4.67)**: sweet reads the legacy tests in 2 requests then searches once more and edits again (`sweet/rep0` requests 7–11: `ss-read tests/test_tablib.py 490 515`, `ss-find "row lpush append tests"`, `git diff`, `Edit`, `run_tests`; `sweet/rep1` requests 8–12 five read/search requests; `sweet/rep2` 6–8 then two more edits). Native reads the tests once (`native/rep0` request 7) or not at all.
5. **aws-actions edit (−4.33)**: `native/rep2` makes 12 edit requests (one failed) including `README.md` and the bundle; sweet makes 3 per rollout and never edits the bundle on this harness.

## 5. Ranked request-count mechanisms (solved-everywhere rollouts)

Requests per rollout, sweet minus native, with the vehicle and the register status.

| # | mechanism | codex | opencode | claude-code | sweet-only? | register |
|---|---|---:|---:|---:|---|---|
| 1 | Post-edit due diligence done as single-probe `ss-*` requests (verify-phase search+read requests; yield in section 6.1) | +0.00 | +0.22 | **+1.18** | yes | new as a cost mechanism; F8/B9 say the sibling clauses do not change solves |
| 2 | Bundle hunt on an index-excluded file (`aws-actions`, `dist/index.js`) | +4.7 on 1 task (+0.39 pooled) | +8.7 (+0.72) | +6.0 (+0.55) | yes | already recorded, E1/E2 SHIPPED; priced by `verify-tail.md` §6 |
| 3 | One probe per request in understand on opencode (native packs 3–4 structured calls per request) | — | **+1.22** | — | yes | already recorded (brief §1 opencode driver; `opencode-calls-per-request.md`) |
| 4 | Shorter localize: `ss-search` reaches the file in one request | +0.08 | **−0.97** | **−0.79** | yes (win) | extends 02 §8.1 "context payload" driver with a request count |
| 5 | Read→search swap in understand (bodies in search results replace reads) | −0.53 | +0.11 read, +1.36 search | +0.06 | yes | new framing; net request-neutral only on codex |
| 6 | Extensionless dot-config not indexed (`.eslintrc`) | 0 | 0 | +7.3 on 1 task (+0.67 pooled) | yes | extends E1 (index coverage class) |
| 7 | Plan-tool requests (`update_plan`/`todowrite`/`TaskCreate`) | +0.06 (4.06→4.11) | −0.28 (4.11→3.83) | +0.09 (1.79→1.88) | no (both arms) | new vs register; recorded and seeded by `verify-tail.md` §5/§10 |
| 8 | Test+poll pairs on codex (`run_tests` + `write_stdin`) | +0.19 (test +0.08, poll +0.11) | — | — | no | A9 SHIPPED |
| 9 | Failed `Read` requests on claude-code native (`pages: ""`) | — | — | **−0.97** (native 1.39, sweet 0.42) | native-only artifact | extends D4 (not fully fixed) and G6 |
| 10 | Failed-edit requests | +0.03 | −0.03 | +0.22 (0.36→0.58) | mixed | D1, C10 already recorded |
| 11 | `git diff`/`status` requests after the edit | +0.33 | +0.53 (calls equal, 1.61/1.61) | −0.24 | mixed sign | new tiny fact; opencode's is packing (#3) |

Pooled values in rows 2 and 6 divide the one-task gap by the 12 (11) tasks of the subset [I].

## 6. Cross-cutting facts

### 6.1 Post-edit probes: sweet's find nothing new on claude-code

For every request after the first edit whose class is search or read, `postedit-search-yield.py` checks whether a later edit request in the same rollout touches a file that no earlier edit touched [M]:

| cell (solved-everywhere) | probes per rollout | cost share | followed by an edit of a new file | followed by a re-edit | no further edit |
|---|---:|---:|---:|---:|---:|
| codex native | 1.00 | 7.2% | 7 | 3 | 26 of 36 |
| codex sweet | 1.00 | 7.2% | 7 | 15 | 14 of 36 |
| opencode native | 0.64 | 5.5% | 0 | 0 | 23 of 23 |
| opencode sweet | 0.86 | 7.4% | 18 | 2 | 11 of 31 |
| claude-code native | 1.03 | 5.9% | 5 | 15 | 14 of 34 |
| claude-code sweet | 2.21 | 11.6% | **0** | 43 | 30 of 73 |

On all 22 tasks, solved rollouts only: claude-code native 1.93 probes per rollout with 33 of 83 followed by a new-file edit; claude-code sweet 2.17 with **0 of 87**; codex sweet 1.44 with 25 of 56; opencode sweet 0.90 with 20 of 37 (the bundle). Unsolved rollouts probe two to three times more in both arms (claude-code sweet 6.54 per unsolved rollout, 18.1% of cost) and those probes do precede new-file edits (113 of 170), which is the grind on the dead tasks, not a resolution gain [M].

On claude-code the sweet arm's post-edit probing is therefore pure cost on the tasks it solves: $0.001024 per solved-everywhere rollout (11.6%), against native's $0.000505. The probes are the lint hunt (callstack), the bundle hunt (aws-actions), test re-reads (tablib) and sibling checks (`ss-grep "type Spec struct"`, `ss-trace ListArtifacts callers` on apigee). Native does the same diligence with fewer, broader calls (`grep -RIn … src | head -30`, `Read .eslintrc`). The guide's rules that plausibly drive the shape are "Before editing a symbol with visible siblings … spend ONE mapping call", "Read the function you edit to its end; a fix covering only the first matching site is not done" and "When your change alters a public contract, re-read the task's exact wording before finalizing" [C `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` lines 54–64]; the FRAME says nothing about post-edit checks beyond re-running `run_tests` after a source edit [C `codex-task-runner.mjs` FRAME_CLOSE]. Which rule the model is following is inferred, not read [I].

### 6.2 Sweet edits from search output; the read boundary misreads it

Rollouts that edited the target file before any read-class call on it: sweet 3/36 (codex), 1/36 (opencode), 2/33 (claude-code) against native 2/36, 0/36, 0/33; on all 22 tasks 7/66, 4/66, 4/65 against 3/66, 0/66, 1/66 [M `extras.py` (d)]. The mean number of requests between first sight and first read is 1.86 to 1.97 for sweet and 0.00 to 1.36 for native. Example: `codex/jazzband__tablib-454/sweet/rep0` sees `src/tablib/core.py` in request 1 (`ss-search`), edits it in request 5, and first `ss-read`s it in request 9 (after the edit). Under the strict read boundary this rollout has 5 "localize" requests and 0 "understand"; under the sight boundary 1 and 4.

### 6.3 Claude-code native's failed `Read` calls flatter sweet

In the 66 native rollouts of `fp-claudecode-tab-20260826` there are 176 `Read` tool results marked `is_error`: 154 `Invalid pages parameter: ""`, 9 `Invalid pages parameter: " "`, 12 `File does not exist`, 1 `EISDIR`; sweet has 26 (23 + 2 + 1) [M `claude-errors.py`]. Native fails 2.67 `Read` calls per rollout, sweet 0.39. Requests made only of failed reads: native 1.39 per solved-everywhere rollout, $0.000513 = 5.9% of its main-thread cost; sweet 0.42, $0.000157 = 1.8%; on all 22 tasks 1.52 against 0.52, 3.7% against 1.7% [M `extras.py` (a)]. Without the artifact native's claude-code cost would be about 4% lower on the solved-everywhere subset, and sweet's +2.1% would read about +6% [I]. The runner's own comment says the Read schema rejects `pages: ""` before the PreToolUse hook can act, so only the prompt note remains, and the note does not stop the model [C `claude-code-task-runner.mjs:42-45, 68-92, 332-334`]. Register D4 says "FIXED both arms"; the fix covers the `" "` form through the hook and leaves the `""` form, which is 154 of 176 failures here. Sweet is largely immune because `ss-read` runs under `Bash`.

### 6.4 Subset comparison: the pool premium is on the tasks not solved everywhere

Per-task paired means, ideal price, main thread [M `extras.py` (c), `anatomy-alltasks.json`]:

| harness | solved-everywhere tasks | other tasks | all 22 |
|---|---|---|---|
| codex | 12 tasks: requests 14.58→14.72 (+0.14), cost −3.4% | 10 tasks: 23.97→25.47 (+1.50), cost +2.5% | +0.3% |
| opencode | 12: 12.58→13.78 (+1.19), cost −3.7% | 10: 20.80→26.80 (+6.00), cost +7.0% | +3.3% |
| claude-code | 11: 15.70→15.67 (−0.03), cost +2.1% | 11: 32.91→30.67 (−2.24), cost −6.2% | −3.9% |

The 22-task column reproduces the brief's codex and opencode headlines exactly; the claude-code −3.9% here is main-thread only and coincides with the brief's sidechain-inclusive figure by chance.

### 6.5 `ss-semantic` on an excluded file returns a useless whole-file span

Across the 198 sweet rollouts, 58 `ss-semantic` calls were made; 7 came back `[FALLBACK]` with a single span starting at line 1 and covering the whole file (`dist/index.js` 1–35000 five times, `src/build/targets.py` 1–1523, `src/build/property.jam` 1–1011), about 2.8 kB each, and every one was on a file the index did not hold [M `fallback-census.py`; ids `codex/aws-actions/sweet/rep0,rep1`, `codex/bfgroup__b2-113/sweet/rep1`, `codex/bfgroup__b2-259/sweet/rep2`, `opencode/aws-actions/sweet/rep0,rep1,rep2`]. The `excludedScopeNote` shipped on 2026-08-28 is called on the `ss-read` ENOENT path and the `ss-grep` zero-result path, not on the `ss-semantic` fallback path, and `ss-read` reads any file from disk regardless of admission (`ss-read dist/index.js 1 1000` delivered 13,396 tokens of webpack output) [C `eval/agent-read-workflows/bin/_ss-helpers.mjs:247-268, 380, 628-645, 915-935`].

### 6.6 Dot-config files in this pool

Native targeted an extensionless dot-config file in 4 of 198 rollouts (`.eslintrc`, all on `callstack`, 2 codex + 2 claude-code); sweet never did (0 of 198), and sweet's searches for lint concepts that returned no dot-config path number 6 on claude-code (3 in `callstack/sweet/rep2`), 2 codex, 3 opencode (the opencode and two codex cases are `protofire__solhint-224`, a linter repository, so they are false positives of the pattern) [M `dotfile-census.py`]. Population in this pool: one task of 22.

## 7. Candidate seeds (mechanisms not on the register)

### S1. Scope the guide's sibling/mapping rule to before the edit (claude-code post-edit probe chain)

- Mechanism: on claude-code, sweet's post-edit due diligence runs as 2.21 single-probe `ss-*` requests per solved rollout (native 1.03), and 0 of 87 such probes on solved rollouts (all 22 tasks) preceded an edit of a new file. A guide sentence that limits the mapping/sibling rule to the pre-edit phase and tells the agent, after a green `run_tests`, to search again only when the test output names another file would remove the chain.
- Harnesses: claude-code (large), codex and opencode (small: +0.00 and +0.22 probes per rollout).
- Vehicle: the tool guide (`.claude/rules/sweet-search.md` + system override on claude-code; AGENTS.md elsewhere). Sweet-only, so the full saving is a differential.
- Trace evidence: `claude-code/callstack__react-native-paper-972/sweet/rep2` requests 10–21, 25–28, 33–34; `claude-code/jazzband__tablib-454/sweet/rep1` requests 8–12; `claude-code/apigee__registry-961/sweet/rep2` request 19; `claude-code/aws-actions__configure-aws-credentials-42/sweet/rep1` requests 7–21 [M].
- Ceiling: claude-code sweet −$0.00052 per solved-everywhere rollout (the excess over native's probe cost) = −5.9% of sweet's main thread; at 100% compliance and zero solve effect; over all solved sweet rollouts the excess is +0.24 probes only, so the pooled ceiling is −$0.0001 to −$0.0005 per rollout [I, arithmetic on M tokens]. Codex and opencode: ≈ 0.
- Cheapest `$0` falsifier: done here (yield census). Pre-registered kill for a live smoke: post-edit search+read requests per sweet claude-code rollout not reduced by at least 40%, or solved count outside the ±6 bar on 66 rollouts, or the removed probes replaced one-for-one by `git diff` or text requests.
- Build cost: one guide sentence plus the prompt-optimisation length check; no product code.
- Register check: nearest rows are F8 (general engineering clauses DEAD for resolution), B9 (completeness card DEAD), A1/A6 (prompt steering deaf) and B2 (guide trim CLOSED). This differs: it removes work the record already says does not buy solves, it is a scoping of an existing obeyed rule rather than a new capability request, and it is measured as a cost mechanism with a yield count. The instruction-deafness risk is real and caps the ceiling.
- Flags: `new_tool: false`; `needs_user_decision: true` (guide wording is owner-controlled; the clause changes the guide's editing doctrine).

### S2. Admit extensionless dot-config files to the index

- Mechanism: `.eslintrc`, `.prettierrc`, `.editorconfig`, `.babelrc`, `.flowconfig`, `.nvmrc` and similar are not in `FILE_PATTERNS.include`; `ss-grep` cannot show them, so a convention hunt returns stub noise (`flow-typed/npm/eslint_vx.x.x.js`) and the agent keeps probing. Native reads the file with `grep`/`Read` in two requests.
- Harnesses: claude-code in this pool (`callstack` sweet rep 2: 16 probe requests; rep 0: 6); codex and opencode sweet did not hunt on this task.
- Vehicle: indexer admission list (`core/infrastructure/config/search.js` FILE_PATTERNS). Sweet-only. Ranking-neutral, so the agent-format gate does not apply.
- Trace evidence: `claude-code/callstack__react-native-paper-972/sweet/rep2` requests 18, 20, 21, 34 (outputs in `probe.py` run, section 4.3); golden `.eslintrc` present [M].
- Ceiling: one task of 22; claude-code sweet on `callstack` costs +$0.0041 per rollout against native, so at most −$0.00019 per pooled claude-code rollout (−1.3%) [I]; zero on codex/opencode in this pool. The value is correctness of `ss-grep` on config files, not bench cost.
- Cheapest `$0` falsifier: count native reads of extensionless dot-config files across the `sb-*`, `rb-*`, `fp-*`, `fixval-*` runs (this pool: 4 rollouts, 1 task). Kill if fewer than 2 tasks in 40 need one.
- Build cost: a dozen globs; re-index goldens on the box (mac-built goldens are degraded, memory `ext-coverage-audit`).
- Register check: extends E1 (index coverage: `.jam`, `src/build/**`, bundles) with a new instance class; E1 did not list dotfiles.
- Flags: `new_tool: false`; `needs_user_decision: false`.

### S3. "Not indexed" on the `ss-semantic` fallback path and a minified-content guard in `ss-read`

- Mechanism: `ss-semantic <excluded-file>` returns a `[FALLBACK]` whole-file span (2.8 kB of bundle head) instead of the shipped "not indexed" note; `ss-read` on a bundle returns thousands of tokens of webpack output (13,396 in one call). Both prolong the bundle hunt after `ss-grep` has already said "not indexed".
- Harnesses: all three (7 `ss-semantic` fallbacks in 198 rollouts; `ss-read` bundle reads in 6 of 9 `aws-actions` sweet rollouts).
- Vehicle: `_ss-helpers.mjs` (`excludedScopeNote` on the semantic fallback and the read path; refuse or cap reads of files whose median line exceeds the bundle threshold unless `--force`). Sweet-only.
- Trace evidence: `codex/aws-actions/sweet/rep0` request 15; `opencode/aws-actions/sweet/rep0` requests 16–18, `sweet/rep1` requests 13–17 [M].
- Ceiling: the whole bundle hunt is +$0.000059 to +$0.000110 per pooled rollout (0.5–0.7%, `verify-tail.md` §6); this seed covers the part the shipped E2 note does not reach, so under 0.5% [I]. Correctness value: the agent stops reading 35,000-line bundles.
- Cheapest `$0` falsifier: replay the 7 fallback calls and the 9 `ss-read dist/index.js` calls against the fixed wrappers on the golden; kill if any still returns file body.
- Build cost: two branches in `_ss-helpers.mjs`; no ranking change.
- Register check: extends E2 (hygiene package SHIPPED) with two uncovered paths; not the same as C8/C9 (codex cap).
- Flags: `new_tool: false`; `needs_user_decision: false`.

### S4 (duplicate, for merging). Plan-tool request suppression through the guide

Recorded and seeded by `verify-tail.md` §5 and §10. This report adds: the plan class is 13.3% (codex sweet), 13.1% (opencode sweet) and 4.4% (claude-code sweet) of arm cost once request 0's preamble ingest is excluded [M `extras`]; a solve screen shows no positive association between plan requests and solving (claude-code native 0–1 plan requests: 20 of 26 solved; 2–3: 20 of 32; codex 2–3: 5/7 native and 7/18 sweet; 4–5: 32/55 and 32/48) [M], which is a confounded within-arm reading, not a causal one [I]. Merge with the sibling's seed; do not book twice.

## 8. Register check per finding

1. Sweet's total requests on solved-everywhere tasks equal native's (+0.14, +1.19, −0.03) and its cost is lower on codex and opencode — extends `02-cost-decomposition.md` §5 ("every median is negative") and H9 by phase and by subset; no register row.
2. Verify is the only phase with a sweet excess on all harnesses; localize/understand offset it — new segmentation; H9 measured calls after the first successful edit as a share and found them identical; requests by phase were not measured before.
3. Post-edit probe chain with zero new-file yield on claude-code — new cost mechanism; F8/B9 are its resolution-side record.
4. Bundle hunt — already recorded (E1, E2; `verify-tail.md` §6 priced it).
5. Read→search swap and shorter localize — extends 02 §8.1 "context payload other than the guide" with request counts.
6. Extensionless dot-config not indexed — extends E1.
7. `ss-semantic` fallback and `ss-read` on excluded files — extends E2.
8. Plan-tool requests — new vs register; duplicate of `verify-tail.md`.
9. Claude-code native failed `Read` (`pages: ""`) 2.67 per rollout — extends D4 (fix incomplete for the `""` form) and G6 (native cost caveats); measurement, not a lever.
10. Read-boundary sensitivity — new measurement trap.
11. Codex test+poll pairs, failed-edit streaks on tab-indented Go, opencode packing — already recorded (A9, C10/D1, brief §1).

## 9. Measurement traps met

1. The `turns/` ledger holds one file per task×arm and is overwritten by the last rep; every number here is from the raw transcripts.
2. `preds-<arm>.jsonl` has one line per task; per-rep patches are `<arm>/patches.json` and `<arm>/rep-N/patches.json`.
3. Opencode's canonical sweet set is `fp-opencode-tab` for the 11 non-repair tasks plus `rp-oc-tab-20260827` for the 11 repair tasks; `fp-opencode-tab` alone has 63 sweet rows, 30 of them superseded.
4. Segmenting by "first read of the edited file" moves 0.6–0.8 requests per sweet rollout from understand into localize, because sweet edits from `ss-search` bodies; use first sight of the path.
5. A request class taken by priority hides packed calls: opencode native's `git diff` inside a `grep` request counts as search. Read the call-level table (§3.2) before claiming an arm "runs more git".
6. The first request of almost every codex and opencode rollout is a plan call, so the plan class absorbs the preamble ingest (38–42% attributed against 13–15% marginal).
7. Claude-code rows with `idealTurns` null (delegated rollouts) have no usable `costRealizedUsd`; validate against main-thread rebuilds.
8. Claude-code native's cost carries 1.4–1.5 failed-`Read` requests per rollout from a harness/model defect the sweet arm mostly avoids; any claude-code head-to-head that ignores it overstates sweet's position by about 4%.
9. `ss-grep --in <excluded path>` zero results in fp-era runs mean "not searchable", not "absent" (the 2026-08-28 note post-dates these runs).
10. Codex `output_tokens` already includes `reasoning_output_tokens` (`total_tokens = input + output`); opencode's `output` excludes `reasoning`. Adding reasoning to codex output double-counts it.

## 10. What I could not finish

- No solve-effect estimate for S1 or S4 exists; only a paid smoke can give one, and this work was $0.
- The claude-code system prompt is not persisted, so which guide sentence drives the post-edit probe chain is inferred from the guide text, not read from the run.
- The five largest gaps per harness were read at request-table level (all 90 rollouts of the nine task-harness pairs) and at raw-output level only for the requests named in §4 and §6.5; the remaining rollouts' outputs were not opened.
- Sidechain requests on claude-code were attributed to the parent's phase but not segmented internally.
- Whether the post-2026-08-28 index admits `dist/index.js` on `aws-actions` was not verified (the fixval smoke does not contain the task).
- The dot-config census pattern flags `protofire__solhint-224` (a linter repository) as false positives; the count of real cases is 1 task.

## 11. Evidence paths

- Box (read-only): `/root/sweet-search-private/eval/task-completion-bench/results/{fp-codex-tab-20260826,fp-opencode-tab-20260826,rp-oc-tab-20260827,fp-claudecode-tab-20260826}/` (`rows.json`, `agent-state/`, `<arm>/patches.json`, `<arm>/rep-N/patches.json`); `/root/fresh-run/repair-tasks.txt`; golden `/root/.ss-eval/golden/callstack__react-native-paper@3bba0304e6b03e9a5bdc7baeb5547ac67bb32e7b/.eslintrc`.
- Box scratch: `/tmp/wf-slatec/phase-anatomy/` (`phase-anatomy.py`, `probe.py`, `claude-errors.py`, `dotfile-census.py`, `fallback-census.py`, `anatomy.json`, `anatomy-alltasks.json`, `dump-trace-fp.mjs`).
- Local: `eval/task-completion-bench/handoffs/improve/slate-c/forensics/scripts-phase-anatomy/` and its `data/` directory (listed in §1).
- Code read: `core/infrastructure/config/search.js:51-160` (FILE_PATTERNS); `eval/agent-read-workflows/bin/_ss-helpers.mjs:247-268, 380, 628-645, 915-935`; `eval/task-completion-bench/harness/claude-code-task-runner.mjs:42-45, 68-92, 100-120, 332-334`; `eval/task-completion-bench/harness/codex-task-runner.mjs:110-145` (FRAME); `eval/task-completion-bench/harness/agent-runner-shared.mjs:160-210`; `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md:24-64`.
- Sibling reports read for overlap: `forensics/verify-tail.md`, `forensics/opencode-calls-per-request.md` (verdicts), `forensics/codex-cap-x-ss.md`, `forensics/wrongfix-facts.md`, `research/structured-vs-shell-parallelism.md` (headers only).
