# First ss-search call of each trajectory: forensic reading

Group `first-search`. Scope: the first ss-search call of each of 565 rollouts (3 rollouts had no result path). Read by hand: 87 calls. Labels: `first-search.labels.jsonl` (same folder).

## Conclusion

1. The deterministic success rule (34.3%) is a poor judge of first-call value. It agreed with my reading in 44 of 74 stratified calls (59%).
2. Weighted back to the 565 calls, the first search was clearly useful in about 44%, partly useful in about 31%, and not useful or harmful in about 26%. Uncertainty is about +/- 11 points (n = 74).
3. The rule fails in both directions. It marks 34% of its "failures" as clearly useful (13 of 38), because the next call is a normal follow-up (callers, other occurrences, sibling file). It marks 14% of its "successes" as no effect (5 of 36), because the agent already knew the path.
4. In 61% of all 565 first searches the file that most agents finally edit is at rank 1. It is in the result list with code in 73%, and in the list at all in 83%. The rule credits only 34%.
5. Rule success depends mostly on the task. It is 1% (svgr, 83 calls) and 2% (ember, 57 calls) on tasks that add new code. It is 81% to 85% on tasks with one obvious function. The rule measures how many things the task needs next, not search quality.
6. The true failures (about 26%) have four main causes: wrong file at rank 1 (13 of 18 no/harmful calls), the right file only as a one-line summary (7 of 18), a vague natural-language query (4 of 18), and test or doc files above source (3 of 18).
7. Top product changes, in order: put code slots on files, not ranks (collapse same-file summaries); shrink the output when `sufficient=no`; size the rank-1 block to the whole function or small file. Details in section 9.

## 1. How I sampled

- Population: `first-call-success.json`, 568 first ss-search calls. Three have no rank-header path and are excluded. 565 remain: 194 rule-success, 371 rule-failure.
- Stratified sample, seed 42, quota per harness and rule label, round-robin across the 13 tasks:
  - rule-success: Claude Code 8, Codex 12, opencode 16 (36 total).
  - rule-failure: Claude Code 10, Codex 12, opencode 16 (38 total).
- Extra reading of 13 calls: 10 Claude Code + Opus 5.5 calls (Opus calls ss-search rarely, 35 in total) and 3 more "read-other-path-first" calls.
- Variants: 22 of the 74 stratified calls are `baseline`. The rest come from hc and hsmoke variants (instructions, batch-read, prompt trims). The first-search output format is the same in all of them. I did not see a variant effect.
- Model mix of the 87 reads: 75 gpt-5.6-luna (Claude Code 17, Codex 25, opencode 33) and 12 Opus 5.5.
- For each call I read: the query, the full output, the text before, the text after, and the next 4 calls. I judged "useful" by what the agent said and did next.
- Fix-file proxy (for the numbers in section 3): a file counts as a "fix file" when at least 25% of the rollouts of that task edited it (tests and docs excluded). There are only 13 tasks. All shares below are per call, not per task, and one task can dominate a share.
- The shared scratchpad folder was overwritten by other agents during my work. I rebuilt my files in a private folder. The labels use the same seed-42 sample.

## 2. Was the rule right?

Stratified sample, n = 74 (my judgement vs the rule):

| rule label | n | yes | partly | no | harmful |
|---|---|---|---|---|---|
| success (used a result path, no other search first) | 36 | 20 | 11 | 5 | 0 |
| failure (searched again or read another path first) | 38 | 13 | 12 | 12 | 1 |

Reweighted to the 565 calls (strata: harness x rule label): yes 43.6%, partly 30.7%, no 24.3%, harmful 1.4%.

Why the rule is wrong:

- **"Searched again first" is mostly a normal ss-grep.** In 271 of 326 such rollouts (83%) the next search is `ss-grep`. Only 17 (5%) are another `ss-search`. In about 64% of those greps (174 of 271) the grep term also appears in the first output (loose substring match). That is the workflow the rules text asks for ("anchor on the symbol that surfaces").
- **The follow-up often needs something a search cannot give.** Examples: all callers of the function (`bingo-271#1`), every `_text.length` site (`super_editor-2516#0`), sibling plugin files as a template (`svgr-10`, all Opus calls), the registry file for a new rule (`ember-551`).
- **"Read other path first" is mostly a sibling or template read.** Opus calls ss-search in parallel with other calls, then reads sibling files with `cat` and `ls`. In all 8 extra Opus svgr calls rank 1 or 2 held a fix file (`src/index.js` or `src/configToOptions.js`).
- **"Success" can be luck.** In 5 of 36 sampled successes the agent had already located the file with an earlier ss-grep and ss-read, or in the same response (`maxgraph-365`, all three harnesses; `super_editor-2516#11`). The search output was ignored.
- **Parallel and late calls.** 22% of first searches share a response with another search. 23% are not the first retrieval call at all (132 of 565). Success is 30% for those, against 36% for true first retrievals.
- **Rule success by task** (calls, success): svgr 83/1%, ember 57/2%, brighterscript 55/7%, graphql 19/16%, super_editor 51/25%, zlint 69/30%, markup-it 24/33%, bingo 52/42%, fastify 51/69%, datadog 32/81%, maxgraph 11/82% (mostly false), jupytext 48/83%, pytask 13/85%.

A better metric for "first-call quality": fix file at rank 1 (61%), fix file with code in ranks 1 to 3 (73%), and number of follow-up calls before the first edit.

## 3. What the 565 outputs hold (deterministic complement)

| measure | all 565 | rule-success 194 | rule-failure 371 |
|---|---|---|---|
| fix file at rank 1 | 61.4% | 73.7% | 55.0% |
| fix file with code (full or preview) | 72.9% | 88.7% | 64.7% |
| fix file only as a summary line | 10.3% | 9.8% | 10.5% |
| fix file absent | 16.8% | 1.5% | 24.8% |
| rank 1 is a test file | 4.8% | 4.6% | 4.9% |
| confidence line says `low` | 62.3% | 54.6% | 66.3% |
| `sufficient=YES` | 20.4% | 35.1% | 12.7% |

- "Absent" is mostly the new-code tasks and the vocabulary-gap task: ember 51%, zlint 55%, markup-it 62%, graphql 47%.
- Presentation is fixed: in 98% of outputs there is 1 `full` entry, at most 2 `preview` entries, and the rest are summaries (median 1 / 2 / 5).
- Which rank gave the first path the agent used, in the 193 rule-successes: rank 1 70%, ranks 2-3 19%, ranks 4-5 8%, rank 6 or more 3%. By presentation: full 70%, preview 17%, summary 13%. Summary lines do deliver, so do not drop them.
- Share of output characters in entries that sit on a fix file or on a path read in the next 4 calls: full entries 74%, preview entries 43%, summary entries 27%. Pooled: 51%. So at least 49% of the characters are on files nobody used.
- The `sufficient` flag is calibrated well but rare. `YES` (115 calls): fix file in the list 88% with code, absent 7%. `no` (66 calls): fix file at rank 1 only 23%. The `confidence=low (many_candidates)` text is not informative: it fires on 62% of calls and rank 1 is right in 58% of them, against 67% for the other reasons.
- Mean first-call output is 5,134 characters (about 1,280 tokens). Each is re-read about 15 more times (mean `turnsRemaining` 15.0, median 12).
- After the rank-1 block the agent reads more. In 165 calls an `ss-read` of the same file followed within 4 calls and covered the rank-1 block. The block had a median of 41 lines. The read had a median of 93 lines. In 54% of these cases the read covered at least 60% of the file. In 60 of 165 the file has 150 lines or fewer.

## 4. True successes: which rank and which part

Of 43 "yes" calls (87 read), the code of rank 1 was used in 40, ranks 2-3 code in 17, and summary lines in 8. The `sufficient=YES` line was used in 11 calls.

- **Rank 1 delivered (19 yes calls).** The agent writes the answer from the rank-1 code. Examples: `pytask-210#1` ("treats any truthy `__tracebackhide__` as hidden"), `jupytext-360#1` ("`pipe_notebook`: stderr not captured"), `bingo-271#1` (codex, "`logRerunSuggestion` hardcodes `npx bingo`"), `fastify-cors-285#1` ("registers only `fastify.options('/*')`").
- **Rank 2 delivered (2 yes calls).** Example: `graphql-go-tools-174#2` (opencode): rank 1 was `introspection.go`, rank 2 preview held `astvalidation.go`. The agent used rank 2.
- **Summary lines delivered (2 yes calls, 2 partly).** Examples: `graphql-go-tools-174#1` (claudecode-luna) and `graphql-go-tools-174#1` (codex-luna). Rank 1 was wrong. Three to five summary lines for `astvalidation.go` (ranks 2 to 6) named `EnterField`. The agent used only those. This is the "same file many times" case.
- **Follow-up need (20 yes calls).** Rank 1 was right and the next call enumerated callers (6), other literal occurrences (5), or sibling templates (9).
- Compact outputs worked well. `ember-551#1` (opencode, 2.8k chars) gave the two registry files at low cost. The 1.4k-char `zlint-299#1` output only echoed a file name that the query already held (labelled partly).

## 5. True failures: why the first search failed

18 calls were `no` or `harmful`; 26 were `partly`. Cause counts (a call can have two causes):

| cause | no/harmful (18) | partly (26) | examples (id suffix, one-line quote) |
|---|---|---|---|
| wrong file ranked first | 13 | 6 | `zlint-299#5` (claudecode-luna): rank 1 a province test file, fix file `util/ca.go` at rank 13. `markup-it-56#1`: `unescapeMarkdown` is rank 1 for every HTML/markdown query (score 0.864 vs 0.859, flat). `maxgraph-365#0`: vendored `stashed/grapheditor/Graph.js` fills ranks 1 to 3 |
| fix file only as one-line summary | 7 | 7 | `brighterscript-1050` (4 calls): `Parser.ts` holds ranks 4 to 18 as summaries; code went to `AstEditor.removeFromArray` or `ArrayLiteralExpression`. `maxgraph-365`: `GraphDataModel.ts` only at rank 4 |
| vague natural-language query, no symbol | 4 | 4 | "parse array indexing with comma-separated dimensions" |
| test, doc or CI file above source | 3 | 1 | `ember-551#1` (codex): rank 1 `.travis.yml`. `ember-551#1` (opencode): tests of unrelated rules fill 9.6k chars |
| exact symbol was in the task text, so ss-grep was the right first tool | 3 | 6 | `graphql-go-tools-174#0` (`__typename`), `maxgraph-365` (`isLayer`), `super_editor-2516` (`_text.length`) |
| task creates new code, nothing to find | 1 | 5 | `svgr-10`: `ss-grep "style"` returned 0 matches; `zlint-299`: three greps for `IsPrecert`, `Precertificate`, `Precert` returned 0 |
| right file, wrong chunk shown as code | 0 | 4 | `fastify-cors-285#1` (claudecode-luna): rank 1 `validateHook` (file head) while the route code is `fastifyCors` |
| rule false positive (agent already knew the path) | 5 | 0 | `maxgraph-365` (3 harnesses) |
| false `sufficient=YES` | 1 (harmful) | 0 | `markup-it-56#1` (codex): `YES (query_evidence_moderate_margin)` on a wrong file |
| file lookup done with semantic search | 1 | 0 | `super_editor-2516#9`: "package release version pubspec changelog" |

Not seen as a cause: truncated output (never), and distrust of a correct, `sufficient=YES` rank 1 (never; agents confirm with one grep or read).

## 6. Parts used and ignored (87 calls read)

| part | used | ignored |
|---|---|---|
| rank-1 code | 50 | 37 |
| summary lines | 35 | 49 |
| ranks 2-3 code | 21 | 53 |
| `sufficient` / confidence line | 11 | not counted |
| header, path and symbol | 7 | not counted |
| `### imports` | 1 | 45 |
| `### related` | 0 | 38 |

- Estimated waste (my reading, characters the agent did not need): 66% of 459,813 output characters. By label: yes 52%, partly 69%, no 93%, harmful 97%.
- Deterministic lower bound: 49% of characters are in entries on files that no agent edited or read.
- The `### imports` block is fully repeated inside the code fence in 155 of 565 calls (27%, 296 characters each on average). It is small (about 1.6% of output) but it is pure duplication.
- I saw no case where the agent used a `### related`, `same file` or `continues at` line. I saw one indirect use of the imports (the svgr agent named the `h2x` plugin from the import list).

## 7. Does the agent understand the tool?

- Right tool and flags: 71 of 87 yes, 11 partly, 5 unclear.
- Misuse seen:
  - An identifier mixed into a natural-language query where the identifier alone should go to ss-grep (several `maxgraph-365` and `graphql-go-tools-174` calls; `ember-551` "`@ember/component` ... tests").
  - Semantic search for a file-name or config lookup (`super_editor-2516#9`).
  - Speculative ss-grep names for code that does not exist (`zlint-299`: `IsPrecert`, `Precertificate`, `Precert` returned 0 matches in 3 runs).
  - A confirming `ss-read` of a range the search already printed in full (6 calls; Codex omits an exact re-read, the other harnesses do not).
  - Opus uses `cat` and `ls` for follow-up reads, not `ss-read`.
- Query style (weak evidence, 565 calls, task-adjusted): queries with 4 words or fewer did 9 points better on rank-1 fix file than the task mean. Queries with an identifier-like token did 7 points better, and their rule success was 50% against 29%. Adding the identifier or file stem to the query helps ranking. It does not replace ss-grep when the literal is all you need.

## 8. Recurring patterns

1. **Same file fills the list, code goes elsewhere.** 119 of 565 outputs (21%) hold 6 or more entries from one file; 182 more hold 3 to 5. Code slots follow rank, not file, so the best chunk of the dominant file is often only a summary. Ids: `brighterscript-1050` (opencode, rank-1 `arrayLiteral`; 12 `Parser.ts` entries), `graphql-go-tools-174#1`, `maxgraph-365#4`.
2. **Generic-word hub chunk wins rank 1.** `src/markdown/utils.js` was rank 1 in 20 markup-it first calls for different queries; `AstEditor.ts` 16 times (brighterscript); `introspection.go` 14 times (graphql). Scores are flat (0.600 / 0.600 / 0.600 in `markup-it-56#1`). The agent learns nothing and re-searches.
3. **Low-evidence output is printed in full.** `sufficient=no` calls (66, 12%) print 3 code blocks anyway (mean 4.2k chars, 279k chars in total). In my reading only 23% have rank 1 on the fix file. Ids: `zlint-299#5`, `ember-551#1`, `super_editor-2516#9`.
4. **The rank-1 block is smaller than what the agent reads next.** Median 41 lines shown, 93 read; 54% of the reads cover most of the file. Ids: `bingo-271#1` (codex, 43-line function already whole, then re-read), `fastify-cors-285#1`.
5. **New-code tasks cannot be located.** svgr and ember are 25% of first calls (140 of 565). The feature does not exist. The agent greps its own guessed names and gets 0 matches. The useful hits are the registry and sibling files. Ids: `ember-551#1` (opencode, good: `recommended-rules.js` rank 1, `index.js` rank 5), `svgr-10` Opus calls.
6. **Concept with no matching token.** "precertificate" is not a word in the code (the code checks a poison extension OID). Ids: `zlint-299#4` (codex), `#5` (claudecode-luna, opencode). Semantic search cannot bridge it; the fix file appears at rank 10 to 13 as a summary.

## 9. Product proposals, ranked

Ranked by (tokens saved x how often) and by lift in first-call success. All wording is general. Every ranking change must be gated on agent format (`_isAgentFormat`) and be tried on the dev split first, per the repository rules. I did not run anything.

| # | proposal | frequency | expected effect | risk to accuracy |
|---|---|---|---|---|
| 1 | **Give code to files, not ranks.** Print one entry per file: the best-matching chunk as code, the other hits of that file as one line of names with line numbers. When 3 or more entries share a file, give that file the first code slot. Keep distinct files for the other slots. | 53% of calls have 3+ entries in one file; 10% have the fix file only as a summary | Fix-file-with-code rises from 73% toward 83% (the summary-only share, 10%). Saves part of the 10% of characters spent on summary lines that restate the header. Summary lines still deliver 13% of successes, so keep names. | Low. It changes the display, not the ranking. Keep the rank number on each name. |
| 2 | **Compact output when `sufficient=no`.** Print rank-1 code only, plus one name line per other hit, plus one hint: "no strong match; `ss-grep` the rarest literal". | 12% of calls, 4.2k chars each; each char is re-read about 15 times | About 3k chars saved on 66 of 565 calls, about 1.4k amplified tokens per first call on average. | Medium-low. In 35% of these calls the fix file did have code (at some rank). Keeping rank-1 code and all names limits the loss. |
| 3 | **Size the rank-1 block to its use.** If the file has 150 lines or fewer, or the hit is a function, print the whole function (or the whole small file) and say "whole file shown". Otherwise print the enclosing function and the file length. | 29% of first calls are followed by a read that covers the rank-1 block; 60 of 165 are small files | Saves one `ss-read` call in about 1 of 4 first calls. | Medium. Output grows by 0.5 to 1.5k chars when it fires. Fire it only when `sufficient=YES` or the margin is clear, so a wrong rank 1 costs little. |
| 4 | **Rules text (query guidance), then test with the micro-smoke protocol.** (a) "If the task text holds an identifier, a string or a file stem, run `ss-grep` on it first. Do not put it into a natural-language query." (b) "Do not add words like tests or docs unless you want them." (c) "If `ss-grep` on the feature name returns nothing, the feature is new: look for the registry and the closest sibling, do not guess more names." | 27% of queries carry an identifier-like token; 25% of calls are new-code tasks | Fewer wasted 5k-char outputs (cases `maxgraph-365`, `graphql-go-tools-174`, `ember-551`). Not measured. I have evidence of the pattern, not of the effect of this wording. | Low. Cost is prompt size (about 80 words). Do not pool with earlier runs. |
| 5 | **Ranking, agent format only.** (a) Lift a file whose basename equals a query token (`GraphDataModel.ts` was a summary at rank 4 for a query that began with `GraphDataModel`). (b) Demote README, docs, CI yaml and dotfiles as rank 1 for code-change queries (README rank 1 in 20 first calls, `.travis.yml` in 4). (c) Treat tied scores as no evidence: do not let one generic hub chunk take rank 1 across different queries. | wrong file at rank 1 in about 39% of calls; 13 of 18 true failures | The main lever for true failures (26% of calls). | Medium-high. Past silent regressions (-0.07 pp and -27.57 pp) came from ungated signals. Gate on agent format. Use dev only; hold-out only at a milestone. |
| 6 | **Make the confidence line informative.** Replace `many_candidates` (fires on 62%, no discrimination) with one fact the agent can check, for example "top file also holds N of the top 5 hits" or "rank 1 score margin vs rank 2". Require lexical agreement before `sufficient=YES` (`markup-it-56#1` was a false YES). | 62% of calls show `low (many_candidates)` | Small token saving. Better trust: today 58% (low) and 67% (medium) are the same for rank-1 accuracy. | None for ranking. |
| 7 | **Drop the repeated `### imports` block when the code fence already holds those lines.** | 27% of calls, about 300 chars each | About 1.6% of output. | None. |

Not recommended: cutting the number of summary lines. Summary entries gave the first used path in 13% of successes and a lead in 11 of 44 partly or failed calls I read. Collapse them by file (proposal 1) instead.

## 10. Caveats

- 13 tasks only. Four tasks (svgr, zlint, ember, brighterscript) are 44% of the calls. Per-call shares are task-weighted.
- The fix-file proxy is "edited in at least 25% of the rollouts of the task". For tasks that nobody solved it can be a wrong fix (bingo, jupytext, brighterscript, maxgraph, markup-it, fastify).
- "Useful" is my reading of the next actions. Thinking text was empty (Opus) or encrypted (Codex), so I used visible text and next calls.
- The sample is stratified by harness and rule label, not proportional. I reweighted by stratum size for the population rates.
- No held-out data and no HO2 data were opened. I ran no agent, no benchmark and no ss-* tool.
