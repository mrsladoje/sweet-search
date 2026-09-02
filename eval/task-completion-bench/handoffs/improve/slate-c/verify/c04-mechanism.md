# Verify c04 (mechanism lens): guide and tool-surface removal

Date: 2026-09-02. Agent: c04-mechanism (Slate C verify). Spend: $0. Nothing under `results/` was written. Box scratch: `/tmp/wf-slatec/c04-mechanism/`. No grading log was opened. No HO2 task was read.

Tags: **[M]** measured (script named), **[C]** read from code, **[W]** web, **[I]** inferred.

## 0. Verdict

**Refuted.** Confidence 0.85. The cited traces do not show the claimed mechanism, and the behavioural half of the ceiling is wrong by more than a factor of two.

The candidate's largest component says the mapping-call paragraph drives a chain of useless post-edit probes on claude-code. The three cited rollouts show something else. Two of them are hunts for files the index did not hold (`.eslintrc`, `dist/index.js`). Those are register E1/E2 and the phase-anatomy seed S2, not the guide paragraph. The third is a test re-read after a visible test failure. The source report itself tags the attribution to the paragraph as inferred, not read.

The ceiling arithmetic fails on the fresh-pool cells. Over all solved claude-code rollouts, sweet's post-edit probes cost **less** than native's: $0.001031 against $0.001128 per solved rollout [M]. The +0.24 request excess sits entirely inside the two index-gap tasks (45 of sweet's 87 probes). Without those two tasks sweet probes 0.71 **fewer** times per rollout than native [M]. The most generous residual is −0.37% on a 9-task subset. The candidate claims −0.6% to −3.1%.

The subagent-sentence component has a false mechanism. The +1,516 tokens it wants to save are Claude Code loading the rules file into general-purpose subagents. The sentence itself was fully obeyed 0 of 27 times [M]. Deleting it saves nothing there, and its own source report advises against touching it.

`ss-batch` off PATH is a $0 change by construction: 0 calls, not in the guide, not in npm. `ss-semantic` retirement survives its own kill test (3 of 58, below 30%) but its incremental ceiling after the shipped E1 fix is about zero.

What survives is a token trim of 133 to 164 tokens, worth −0.24% to −0.5% per harness, inside the owner-protected guidance block. That is register B2's class. Solve effect is unmeasured, and the paragraph is the guide's only completeness instruction.

## 1. What I re-derived

### 1.1 Post-edit probe census, claude-code, all 22 tasks, solved rollouts

Script: my re-implementation of `postedit-search-yield.py` over `forensics/scripts-phase-anatomy/data/anatomy-alltasks.json`, per task [M].

| arm | solved rollouts | probes | per rollout | new-file | re-edit | none | probe cost per rollout | per probe |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | 43 | 83 | 1.93 | 33 | 26 | 24 | $0.001128 | $0.000584 |
| sweet | 40 | 87 | 2.17 | 0 | 50 | 37 | $0.001031 | $0.000474 |

The raw counts 0/87 and 33/83 reproduce. Their reading does not. Sweet spends $0.000097 **less** per solved rollout on post-edit probes than native. There is no dollar excess to remove on the fresh-pool cell.

Where sweet's 87 probes sit [M]: `callstack__react-native-paper-972` 24, `aws-actions__configure-aws-credentials-42` 21, `mathnet__mathnet-numerics-1072` 12, `jazzband__tablib-454` 10, `awslabs__aws-embedded-metrics-node-21` 8, six other tasks 12. The two index-gap tasks hold 45 of 87 (52%).

Where native's 33 new-file yields sit [M]: `bfgroup__b2-113` 15 (one solved native rollout; sweet never solved it), `aio-libs__aiohttp-8038` 9 (one solved native rollout; the brief's "won by grinding, 125 calls"), `aws-actions` 5 (native can see the bundle; sweet's index could not), `accenture__sfmc-devtools-1974` 4. So 29 of 33 yields are a composition and index-coverage artifact. The contrast says nothing about the guide paragraph.

Excluding the two index-gap tasks (20 tasks) [M]: native 37 rollouts, 1.95 probes per rollout, $0.001200; sweet 34 rollouts, 1.24 probes, $0.000649. Sweet probes **less**.

### 1.2 The solved-everywhere subset the candidate quotes

`anatomy.json`, 11 tasks, 33 rollouts per arm [M]: native 1.03 probes ($0.000505), sweet 2.21 ($0.001024). This is the source of "2.21 vs 1.03". Minus the two index-gap tasks (9 tasks, 27 rollouts per arm): native 0.85 ($0.000465), sweet 1.04 ($0.000542). Residual excess +0.19 probes = +$0.000077 per rollout = 0.37% of the sweet claude-code cell ($0.020727). That is the ceiling for the behavioural half if every residual probe were the paragraph's and 100% removable. Both conditions are unproven.

The candidate pairs 2.21/1.03 (11-task subset) with 0/87 and 33/83 (all 22 tasks). The two pairs have different denominators. The synthesis must not present them as one measurement.

### 1.3 The three cited transcripts, opened on the box

Files under `results/fp-claudecode-tab-20260826/agent-state/<task>-sweet/claude-home/projects/`. Read with `/tmp/wf-slatec/c04-mechanism/showreqs.py` (main-thread assistant records grouped by `message.id`, `tool_use` deduplicated by id) [M].

**callstack sweet rep2** (`-root--ss-eval-runs-r2-64/a8e70dc0-….jsonl`, 37 requests). Requests 10–21, 25–28, 33–34 are one Bash `ss-*` call each. They search for `color: _`, `_color`, `no-unused-vars`, `argsIgnorePattern`, `eslint`, `eslintConfig`, and read `package.json`. This is a hunt for the repository's unused-variable lint convention after the destructuring fix. The model's own text at request 23 talks about validating the edit, not about siblings. Native ran the same hunt in 2–3 requests (`native/rep1` requests 7–9, `native/rep2` requests 6–8) because it can `grep` and `Read .eslintrc`. The index does not admit `.eslintrc` [C `core/infrastructure/config/search.js`, per phase-anatomy S2]. The nearest guide text is the Fix-discipline sentence "match that local convention" (line 61–62), which the candidate keeps. The mapping paragraph (line 54) is not what this chain implements.

**aws-actions sweet rep1** (`-root--ss-eval-runs-r1-33/59292a49-….jsonl`, 24 requests). Requests 7–21: seven `ss-grep … --in dist/index.js` with zero hits, `ss-read dist/index.js 1 8`, `ss-read dist/index.js 34500 35000`, `ss-find "bundled distribution source generation"`. This is the bundle hunt on an index-excluded file. Register E1 (re-admit git-tracked build output) and E2 ("not indexed" note) shipped on 2026-08-28 for exactly this. Native edits the bundle in 3 of 3 reps, so checking it is task-intrinsic, not guide-induced.

**tablib sweet rep1** (`-root--ss-eval-runs-r1-106/abd105b5-….jsonl`, 15 requests). Requests 8–12: two reads of the legacy tests, one `ss-find … --regex "def (lpush|rpush|append)"`, two re-reads of the edited function. The model's text at request 8 says the visible tests assert the old behaviour and it is "checking the surrounding API". One probe (request 10) is plausibly a name-family check, and two (11–12) plausibly "read the function to its end". This is the only cited rollout where the paragraph is even a plausible driver. It is 3 of 5 probes on one rollout. Native also re-read the tests after its edit (`native/rep0` request 7, `native/rep2` request 6).

Score: of the 36 cited probe requests, at most 3 plausibly implement the deleted paragraph. The rest are index-gap hunts and test re-reads.

### 1.4 Subagent sentence

Script: `/tmp/wf-slatec/c04-mechanism/delegations.py` over the sweet main-thread transcripts of the three fresh-pool claude-code runs [M].

| run | delegations | Explore | general-purpose | prompt mentions `ss-` | prompt carries guide text | prompt contains "verbatim" |
|---|---:|---:|---:|---:|---:|---:|
| tab | 11 | 8 | 3 | 11 | 0 | 0 |
| none | 9 | 7 | 2 | 9 | 0 | 0 |
| pipe | 7 | 6 | 1 | 6 | 0 | 0 |
| total | 27 | 21 | 6 | 26 | 0 | 0 |

The candidate's "21 of 27 Explore" is correct. Its saving is not. The +1,516 tokens in general-purpose subagents come from Claude Code loading `.claude/rules/sweet-search.md` into non-built-in subagents [M `claude-subagents.md` §2.3 table; W https://code.claude.com/docs/en/sub-agents]. Delegation prompts are 176 to 304 characters; the guide file is 6,433 bytes. The sentence never caused a copy. Deleting it changes zero tokens in any subagent.

The same source report (`claude-subagents.md` §7) says: "Not recommended: rewording the guide's 'with this system prompt verbatim' sentence." It notes the sentence may add delegation friction. Sweet's nine tab-run delegations changed 0 of 6 task outcomes and cost 2.5 to 4.5 times their sibling reps on solved tasks [M cited]. The sweet claude-code cost lead is entirely native's subagent spend (brief §1). Deleting the sentence carries a cost-increasing risk with no measured saving.

### 1.5 `ss-semantic` and `ss-batch`

Census over `anatomy-alltasks.json` request summaries, 198 sweet rollouts [M]: `ss-read` 1,379, `ss-grep` 728, `ss-search` 399, `ss-find` 120, `ss-semantic` 58, `ss-trace` 33, `ss-batch` 0. The summaries are truncated at about 120 characters, so my totals run below `guidesyntax.py`'s 3,064; the `ss-semantic` and `ss-batch` counts match (58 vs the candidate's 59; 0 vs 0).

`ss-semantic` by harness: codex 46, opencode 6, claude-code 6. Codex rollouts with any call: 19 of 66. Concentration: `devlooped__moq-1262` rep 0 (failed) 18 calls, rep 2 (solved) 5 calls. One task holds 23 of 46 codex calls.

The candidate's own $0 falsifier, run here [M]: the next `ss-*` call after `ss-semantic` is `ss-read` of the same file in 15 of 58. Next-call distribution: `ss-read` 24, `ss-semantic` 14, `ss-grep` 12, `ss-search` 4, `ss-trace` 2, none 2. The agent keeps retrieving after 56 of 58 calls, so a substitute call would replace it one for one.

The candidate's kill condition, run here [M]: `ss-semantic` is the last retrieval before an edit of that file in 3 of 58 (5%). Below the 30% bar. The component survives its own test.

Ceiling correction. The candidate's floor (−0.1%) is the 7 `[FALLBACK]` calls on index-excluded files. Register E1 re-admits those files, so that floor is already collected by a shipped fix. The upper bound (−2.1%) assumes no substitute call; the falsifier shows a substitute in 56 of 58. Incremental ceiling after E1: about 0 to −0.1% on codex, 0 elsewhere. The candidate's per-request price of $0.000374 is also low: ideal main-thread cost over requests is $0.000573 on the 66 codex sweet rollouts [M]. This changes only the hypothetical upper bound.

`ss-batch` reaches the agent PATH because the bench puts the whole `eval/agent-read-workflows/bin` directory on PATH [C `harness/agent-runner-shared.mjs:134-141`, `buildAgentEnv({ssBinDir})`]. The guide mentions it 0 times [C]. npm `files` excludes it [C `package.json`]. It was called 0 times [M]. Removing it from PATH changes no request and no token. It is not a lever.

### 1.6 Token count of the three passages

`tiktoken` cl100k_base and o200k_base agree within 1 token [M]. Guide body without frontmatter: 1,457 tokens, equal to the brief's 1,457.

| passage | tokens |
|---|---:|
| line 54 mapping paragraph | 87 |
| line 24 subagent sentence | 22 |
| line 31 `ss-semantic` bullet | 24 |
| subtotal (candidate's "about 95") | **133** |
| line 27 clause `ss-semantic returns the top ranked spans in one file;` | 15 |
| line 43 clause `ss-semantic it for the import or handoff symbol, then` | 16 |
| total if lines 27 and 43 are also rewritten | **164** |

The candidate understates the deletion by 1.4× to 1.7×. Token saving: 133/1,457 = 9.1% of the guide's cost; the guide is 2.6% to 4.5% of sweet spend (brief §1.1); so −0.24% to −0.41% per harness. With 164 tokens: −0.29% to −0.51%. The candidate says −0.2% to −0.3%. Within a factor of two, but low.

## 2. Ceiling check against the fresh-pool cells

| component | candidate ceiling | re-derived ceiling | status |
|---|---|---|---|
| mapping paragraph, behaviour, claude-code | −0.6% to −3.1% (−0.24 to −1.18 requests) | 0 on the fresh-pool cell (sweet's probes already cost $0.000097 less than native's); at most −0.37% on a 9-task subset, attribution inferred | refuted (>2× off; mechanism not shown) |
| mapping paragraph, behaviour, codex/opencode | ≈0 (candidate's own kill fires) | ≈0 | agreed |
| subagent sentence | "+1,516 uncached tokens where it fires" | 0 (tokens come from harness rules-loading); risk of more delegation | refuted (false mechanism) |
| `ss-semantic` retirement | codex −0.1% to −2.1% | codex 0 to −0.1%, floor already collected by E1; kill condition not met (3/58) | ceiling overstated at the top, floor double-counted |
| `ss-batch` off PATH | (part of tool-surface reduction) | $0, 0 calls | not a lever |
| guide tokens | −0.2% to −0.3% | −0.24% to −0.41% (133 tokens); −0.29% to −0.51% (164) | understated, within 2× |
| **total** | codex covers gap 0.6×–6×; claude-code 1.3×–5.3× | claude-code −0.3% to −0.8%; codex/opencode −0.3% to −0.5%; solves unmeasured | refuted as ranked |

Solve check. The candidate predicts flat solves and calls the risk low. No measurement exists. The paragraph is the guide's only instruction about covering all sites of a fix. About 30% of losses are wrong-location plus incompleteness (brief §1.2). Removing the only completeness instruction for a −0.3% to −0.5% token saving is an unmeasured trade of solve risk for noise-level cost. Solve is the veto.

## 3. Corrections the synthesis must adopt

1. Separate the denominators. "2.21 vs 1.03 probes per rollout" is the 11-task solved-everywhere subset (33 rollouts per arm). "0 of 87 vs 33 of 83" is all 22 tasks, solved rollouts only (40 sweet, 43 native).
2. Add the dollar figure: sweet's post-edit probes cost $0.001031 per solved rollout, native's $0.001128. Sweet is lower.
3. State that 45 of sweet's 87 probes are the `callstack` (`.eslintrc`) and `aws-actions` (`dist/index.js`) index-gap hunts, and that 29 of native's 33 new-file yields are on `b2-113`, `aiohttp` and `aws-actions`.
4. Behavioural ceiling on claude-code: 0 on the fresh-pool cell; at most −0.37% on the 9-task subset; attribution to the paragraph is inferred.
5. Drop the subagent-sentence saving. The +1,516 tokens are Claude Code's rules-file loading into general-purpose subagents. 0 of 27 prompts carried the guide or the word "verbatim". Deletion risks more sweet delegation.
6. `ss-batch`: $0. Bench-only PATH hygiene, not a lever.
7. `ss-semantic`: kill condition not met (3 of 58 = 5%); next call is a same-file `ss-read` in 15 of 58; 23 of 46 codex calls are in `moq-1262`; the 7 fallback calls are already covered by E1; incremental ceiling about 0 to −0.1% on codex.
8. Token count: 133 tokens (164 if lines 27 and 43 are rewritten), not about 95. Saving −0.24% to −0.41% (−0.29% to −0.51%).
9. Codex per-request ideal price: $0.000573, not $0.000374.
10. What remains is a B2-class guide trim inside the owner-protected block, with an unmeasured solve effect. If the synthesis keeps a row, it should be "token-only trim, −0.24% to −0.5%, needs_user_decision", not rank 4.

## 4. What I could not do at $0

- I could not measure the paragraph's solve effect; that needs a paid ablation.
- I could not separate the subagent sentence's delegation-friction effect from `ss-search` substitution; the source report says the same.
- My tool census reads truncated request summaries, so totals other than `ss-semantic` and `ss-batch` run below `guidesyntax.py`'s.

## 5. Evidence opened

Local: `slate-c/BRIEF.md`; `slate-c/DEAD-LEVER-REGISTER-DRAFT.md`; `slate-c/candidates/inversion-and-removal.md` (§B2, §B3, §C1, §C4); `slate-c/candidates/DEDUP.md` (c04 rows); `slate-c/forensics/phase-anatomy.md` (§0, §1, §4, §5, §6.1, §6.5, §7 S1–S3); `slate-c/forensics/claude-subagents.md` (§2.1, §2.3, §4, §5, §7, §8); `slate-c/forensics/claude-main-thread.md` (calls per request); `slate-c/forensics/scripts-phase-anatomy/{postedit-search-yield.py, phase-anatomy.py, data/anatomy.json, data/anatomy-alltasks.json, data/postedit-search-yield.md, data/req-claude-code-{callstack__react-native-paper-972,jazzband__tablib-454,aws-actions__configure-aws-credentials-42,apigee__registry-961}.txt}`; `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` (lines 24, 27, 31, 43, 54, 57–64); `eval/task-completion-bench/harness/agent-runner-shared.mjs:134-141`; `scripts/inject-agent-instructions.js`; `package.json` `files`; `eval/agent-read-workflows/bin/` listing.

Box (read-only): `results/fp-claudecode-tab-20260826/agent-state/callstack__react-native-paper-972-sweet/claude-home/projects/-root--ss-eval-runs-r2-64/a8e70dc0-5ecf-48fd-ab01-a648e38e3841.jsonl`; `…/jazzband__tablib-454-sweet/claude-home/projects/-root--ss-eval-runs-r1-106/abd105b5-6eaf-4ec8-b4b7-5ac3ff1fc549.jsonl`; `…/aws-actions__configure-aws-credentials-42-sweet/claude-home/projects/-root--ss-eval-runs-r1-33/59292a49-e299-4039-9aa6-225f43b4d1b9.jsonl` (via the request table); all sweet main-thread transcripts of `fp-claudecode-{tab,none,pipe}-20260826` for the delegation census. Scripts: `/tmp/wf-slatec/c04-mechanism/{showreqs.py, delegations.py}`.

Web: none opened by me; the Claude Code sub-agents documentation URL is cited from `claude-subagents.md`.
