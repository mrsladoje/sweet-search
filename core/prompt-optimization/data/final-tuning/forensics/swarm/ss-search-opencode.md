# ss-search in opencode: how the agent uses the output

Group: tool `ss-search`, harness `opencode` (model gpt-5.6-luna). 478 calls in 316 rollouts over 13 tasks.
Labels: `ss-search-opencode.labels.jsonl` (56 calls read one by one: output, text before, text after, next calls).

## Conclusion

1. About 40% of the sampled calls moved the task forward by nothing. Only 21% were fully useful. The labels are: yes 12, partly 22, no 22, harmful 0 (n=56).
2. The agent uses little of the output. It uses the rank-1 code (24 of 56 calls), ranks 2-3 code (15), and summary lines as path pointers (13). It never used `score=`, the trailer lines or the gutter numbers.
3. My estimate: 74% of the characters in the sampled outputs were not needed (51% in "yes" calls, 92% in "no" calls). A low-risk cut of about 33% of all characters is possible. A cut of about 44% needs two medium-risk changes.
4. A larger `-k` does not help. It adds one-line summaries. The agent opened a result path in 57% of the `-k 5` calls and 44% of the `-k 8..10` calls.
5. The first ss-search is not enough in about half of the calls. The agent then reads the whole file (29 of 56) or switches to `ss-grep`/`ss-find` (12 of 56). The agent understood the tool in all 56 calls.

## How I sampled

- Group size 478 calls. Random seed 42.
- Round-robin over the 13 tasks (4 or 5 calls each). Inside one task, round-robin over the strata: baseline or variant, solved or not, first search or later search.
- Result: 56 calls. 36 baseline rows, 20 variant rows. 28 first searches, 28 later searches. 13 calls from solved rollouts, 43 from unsolved rollouts.
- The solved share is lower than in the group (23% against 38%). Unsolved rollouts search more, so they carry more rows.
- Share numbers on 56 calls have a margin of about plus or minus 13 percentage points. Numbers marked "all 478" are counts over the whole group, made by script on the dossiers.

## 1. Usefulness (n=56)

| label | n | share |
|---|---|---|
| yes | 12 | 21% |
| partly | 22 | 39% |
| no | 22 | 39% |
| harmful | 0 | 0% |

| split | yes | partly | no |
|---|---|---|---|
| first ss-search of the rollout (n=28) | 11 | 10 | 7 |
| later ss-search (n=28) | 1 | 12 | 15 |
| header says `sufficient=YES` (n=10) | 2 | 6 | 2 |
| header says `sufficient=unknown` (n=40) | 10 | 13 | 17 |
| header says `sufficient=no` (n=6) | 0 | 3 | 3 |
| baseline rows (n=36) | 8 | 14 | 14 |
| variant rows (n=20) | 4 | 8 | 8 |

- The first search of a task works best. A precise query often puts the right function at rank 1. Examples: `hc-opencode-20260929-0345-L3/mwouts__jupytext-360/r0#1`, `hc-opencode-20260929-0247-L1/superlistapp__super_editor-2516/r0#1`, `hsmoke-opencode-20260926-0002-L1/pytask-dev__pytask-210/r0#1`.
- Later searches are mostly noise. The agent already knows the file and the search shows it again.
- The `sufficient` flag is a weak guide. In all 478 calls, `sufficient=YES` appears in 17% of outputs, `unknown` in 68%, `no` in 14%.

Next action after the call (n=56): drill down with `ss-read` or native read 29, switch to another ss tool 12, edit or answer 9, native fallback 3, ignore 2, re-run ss-search 1.

## 2. Which parts the agent uses

Counts are calls in which the part was present and used, and calls in which it was present and ignored (n=56).

| part | used | ignored | note |
|---|---|---|---|
| rank-1 code | 24 | 32 | used when it is the right file; ignored when the hit is off-target |
| ranks 2-3 code | 15 | 37 | used mainly when they are the test file or the second site |
| one-line summaries | 13 | 39 | used only as a `path:line` plus symbol pointer to pick an `ss-read` window |
| `### related` | 4 | 25 | used once as a caller list (`caller primary <- Parser.ts:2654`) |
| `same file:` and siblings line | 5 | 17 | used to choose a read window |
| continuation block (`# continues at` plus code) | 0 | 11 | never used |
| `### imports` | 0 | 48 | never used. 1.1% of all characters repeat code lines that follow |
| header and confidence line | 5 | 0 | `results=`, `routed=` rarely matter |
| `sufficient=` and `confidence=` | 1 | 54 | the agent usually checks the code, not the flag |
| `score=` | 0 | 56 | never used |
| trailer (`shown-full:` and `route=...`) | 0 | 56 | `route=` repeats the header line |
| line-number gutter | 0 | 51 | reads use the `path:start-end` from the rank header |

What the 478 outputs contain (opencode column of STATS, same parser): code text 46.5%, rank header lines 18.7%, one-line summaries 9.8%, gutter 5.1%, related 5.2%, imports 3.9%, continuation 3.6%, trailers 2.6%. Mean output 5,300 characters (about 1,300 tokens). Mean 11.9 later model requests re-read each output.

Rank of the first result path the agent opens (read or edit, within the next 4 calls, all 478): rank 1 in 130 calls, ranks 2-5 in 78, rank 6 or lower in 24, none in 242 (51%).

Share of calls with rank-1 path opened, by header flag (all 478): `sufficient=YES` 55% of 83, `unknown` 32% of 324, `no` 7% of 67. The agent follows the flag, which is correct: `no` outputs were off-target in my labels.

## 3. Does a larger -k help? No.

| `-k` asked (all 478) | calls | entries returned | of which one-line summaries | mean chars | any result path opened | only a rank 6+ path opened |
|---|---|---|---|---|---|---|
| 5 or 6 | 176 | 6.5 | 4.3 | 4,630 | 57% | 1% |
| 8 to 12 | 276 | 10.5 to 12.5 | 8 to 10 | 5,600 | 44% | 5% |
| 15 or 20 | 26 | 20 | 18 | 6,900 | 50% | 21% |

- The extra entries are summaries. The number of entries with code stays near 2.3 for every `-k`.
- The agent picks a larger `-k` for harder queries, so this is not a controlled test. Even so, I found no gain in path opening.
- `-k` is not a hard limit. 235 of 478 outputs return more entries than `-k`. Example: `-k 8` returned 18 entries (`hsmoke-opencode-20260926-0002-L4/gitbookio__markup-it-56/r0#2`).
- A larger `-k` helped in a few calls. In that example the target (`isHTMLBlock`) was only the rank-6 summary line. The agent read that file next.
- Summary entries repeat the same symbol. One output listed `encodeCell` three times and `ArrayLiteralExpression` twice.

## 4. Recurring waste and failure patterns

**P1. One-line summaries cost much and say little (80% of all entries).** The line restates the rank header or says only `code block (code)`. The agent uses at most the path and the symbol. 3,819 of 4,911 entries are summaries (all 478).
- `hc-opencode-20260929-0208-L1/dbader__node-datadog-metrics-73/r0#1`: rank 2 says `lib/reporters.js:43 — code block (code)`. The agent read the whole file.
- `hc-opencode-20260929-1100-L1/ember-cli__eslint-plugin-ember-551/r0#1`: 5 of 8 entries read `RuleTester (component)`.
- `hc-opencode-20260929-0612-L1/superlistapp__super_editor-2516/r0#12`: 5 pubspec lines and 6 unrelated summaries.

**P2. An off-target rank-1 chunk fills the output when the ranking is flat.** The header says `confidence=low` and `sufficient=unknown` or `no`. The scores are flat (0.60 for five entries, or 0.127 to 0.125). The agent ignores the result. 22 of 56 calls were "no".
- `hc-opencode-20260929-0612-L1/ember-cli__eslint-plugin-ember-551/r0#6`: 9,104 characters, a 187-line test file of an unrelated rule. The next calls did not use it.
- `hc-opencode-20260929-1714-L3/maxgraph__maxgraph-365/r0#6`: 10,517 characters. Three chunks of a legacy `stashed/grapheditor` file and 17 summaries. The agent edited at once.
- `hc-opencode-20260929-1356-L1/joshuakgoldberg__bingo-271/r0#13`: 9,591 characters. A 150-line function plus a 200-token related list. The agent then ran `ss-grep` and `ss-find`.
- In all 478 calls, 117 code chunks have more than 60 lines. 96 of them are in outputs where `sufficient` is not `YES`.

**P3. The agent re-reads code that the output already showed, and a later search repeats an earlier chunk.**
- Of 188 calls where the agent opened a file whose code was shown (within the next 4 calls, all 478), 57 (30%) read a range of which 90% or more was already shown. Overall 18% of the lines read were already on screen. The median read is 91 lines. The median shown chunk is 42 lines.
- `hc-opencode-20260929-2143-L1/joshuakgoldberg__bingo-271/r0#1`: rank 1 showed `logRerunSuggestion.ts` lines 1-43 whole. The agent ran `ss-read` on lines 1-80 next.
- `hsmoke-opencode-20260926-0002-L4/pytask-dev__pytask-210/r0#1`: rank 2 showed lines 66-100. The agent read `traceback.py` lines 1-115 (100 lines total).
- Cross-call repeats: 20% of non-first ss-search calls (33 of 162) start with a rank-1 chunk already shown in the same rollout. Examples: `hsmoke-opencode-20260926-0205-L2/pytask-dev__pytask-210/r0#5` (same chunk for the fourth time), `hc-opencode-20260929-0345-L3/mwouts__jupytext-360/r0#8` (2.3k characters repeated).

**P4. The agent used a semantic search for a token it already knew, then used `ss-grep`.** The product rules say to use `ss-grep` for an exact token. The agent put the symbol in a prose query, and the symbol did not appear in the 15 to 20 results.
- `hc-opencode-20260929-0208-L1/maxgraph__maxgraph-365/r0#4` and `hc-opencode-20260929-1443-L1/maxgraph__maxgraph-365/r0#5`: query "GraphDataModel isLayer null ...". `isLayer` never appears in the output. The agent had named `isLayer` before the call and edited right after.
- `hc-opencode-20260929-2051-L1/zmap__zlint-299/r0#5` and `hc-opencode-20260929-1356-L1/zmap__zlint-299/r0#9`: "precertificate poison extension". The output is unrelated lint tests (rank-1 chunk with 24 license-header lines). `ss-grep precert` found the real hit.
- The agent also searched for file-listing facts (a changelog, tests, a version): `hc-opencode-20260929-0612-L1/superlistapp__super_editor-2516/r0#12`. Native `glob` was the right tool.

**P5. The right file is found but the needed lines are cut or hidden.** The agent then reads the whole file.
- `hc-opencode-20260929-0208-L1/dbader__node-datadog-metrics-73/r0#1`: the preview of `index.js` ends with `module.exports = { ... }`. This is the exact content that the task needs. The agent read `index.js` next.
- A false "sufficient" claim: `hsmoke-opencode-20260926-0205-L1/jensneuse__graphql-go-tools-174/r0#1` returned one unrelated struct file with `confidence=high (single_result)` and `sufficient=YES`. The agent did not trust it.

**P6. Peripheral blocks are almost never used.** Present in the output of 29 sampled calls, `### related` was used in 4. The continuation block was used in 0 of 11. The imports block was used in 0 of 48 calls. Example: `hsmoke-opencode-20260926-0648-L3/smooth-code__svgr-10/r0#5` prints 14 import lines, then the same 14 lines as the first lines of the chunk. `hc-opencode-20260929-0247-L1/superlistapp__super_editor-2516/r0#1`: related block of 15 lines with four copies of `calls _log.fine`, plus a continuation block of unrelated comment text.

## 5. Does the agent understand the tool?

Yes, in 56 of 56 calls. The tool choice and the flags were reasonable. I found no wrong flag. These misuse cases recur:

| misuse | calls (of 56) | example |
|---|---|---|
| prose query when a literal or symbol was already known | 5 | maxgraph `#4`, `#5`; zlint `#5`, `#9`; bingo `#13` |
| re-read a file that the result showed whole | 6 | bingo `#1`, `#5`; pytask `#1`; jupytext `#1` |
| re-query the same topic after the answer was known | 4 | jupytext `#8` (two rollouts); pytask `#5`; fastify `#11` |
| guessed a path that does not exist (`ENOENT`) | 3 | graphql `#10`; svgr `#5`; zlint `#9` |
| parallel speculative search with no use | 2 | super_editor `#3`; maxgraph `#1` |
| search for a file-listing fact (changelog, tests, version) | 3 | super_editor `#12`; fastify `#3`, `#4` |

Why the agent drills down instead of trusting the chunk: the chunk shows a function but the agent wants its callers, its file head or the exported block. It then reads 90 lines on average. It does not trust `sufficient=unknown` (68% of calls).

Why the agent switches tool: the result is off-target and the header says `unknown` or `no`. The agent then falls back to `ss-grep` on a literal or to `ss-find` with a regex. This is the right reaction.

## 6. How much could be cut

Numbers are shares of all characters in the 478 outputs (script, same parser as STATS). Shares overlap a little; the sums are rounded.

| change | saved characters | risk to accuracy |
|---|---|---|
| render summary entries as one compact list line (`path:line symbol`) | 16.3% | low |
| drop `score=`, `(presentation kind=...)`, the `route=` trailer, `shown-full:`, the imports block, the continuation block | 14.5% | low |
| drop summary entries with a score below half of the top score (after compaction) | 2.1% | low |
| **safe subtotal** | **about 33%** | low |
| cap a code chunk to 40 lines when `sufficient` is not `YES` (keep a `continues` pointer) | 8.6% | medium |
| cap the related block to 6 lines and merge repeated callee names | about 3% | low to medium |
| drop the line-number gutter | 5.1% | medium (agents may cite lines) |
| **subtotal with the medium-risk items (without the gutter)** | **about 44%** | |

My label-based estimate of unneeded characters is higher (74%). It counts whole off-target rank-1 chunks, which only a better ranking or a refusal to print weak hits can remove.

In tokens: 478 calls carry 7.4 million amplified tokens (size times later re-reads). A 33% cut saves about 2.4 million, or 5,000 per call.

## 7. Product-fix proposals, ranked (tokens saved x frequency)

General wording only. No fix names a task, a repo or a symbol.

1. **Compact tail for summary entries.** Print entries without code as one list: `also: path:start-end symbol`. Drop the `## #N` header, `score=`, `(summary)` and the restating line. Drop entries below half of the top score. Remove entries that repeat the same symbol. Saves about 18% of characters in 80% of entries. Risk to accuracy: low. Keep the path, the line range and the symbol, because the agent reads windows from them (13 of 56 calls).
2. **Remove fields that the agent never uses.** Drop `score=`, the `(presentation kind=...)` text, the `route=` trailer line (it repeats the header), the `shown-full:` line, the imports block (always, or when the chunk starts in the first lines), and the continuation block. Keep `confidence=` and `sufficient=`: the agent follows `YES`. Saves about 14%. Risk: low.
3. **Weak-evidence output budget.** When `confidence=low` and `sufficient` is `unknown` or `no`, and the top scores are flat, do not print a full chunk. Print at most 40 lines per chunk and a `continues` pointer, or a short "no strong match" list. Never raise the budget to 8,000 tokens for `sufficient=no`. Saves up to 8.6% and removes the 9k-10k character outputs (P2). Risk: medium. Always keep the first 40 lines and the symbol header, so a long correct hit stays readable. Test on the dev split only.
4. **Say when the chunk is complete.** When rank 1 shows a whole function or file range, print one short line: `complete: lines a-b`. Add `ss-read` only if the agent needs lines outside. 30% of reads of shown files re-read 90% or more of shown lines. Saves read output, not search output. Cost: about 25 characters. Risk: none.
5. **Cross-call dedupe.** If a chunk was already printed earlier in this rollout, print `already shown: path:a-b (call N)` instead of the code. 20% of later calls repeat their rank-1 chunk. Saves about 2% of characters. Risk: low to medium (the earlier text must still be in context).
6. **Exact-token hint, no ranking change.** When the query holds an identifier-shaped token (camelCase, snake_case, a dot path) and no printed span contains it, add one line: `no result contains <token>; use ss-grep`. Fixes P4 for 5 of 56 calls and saves the follow-up search. Risk: low. A ranking change (lexical rescue for rare identifiers) may help more, but it needs held-out evidence and format gating (`opts._isAgentFormat`).
7. **Make `-k` a real limit.** Count summary entries inside `-k` (235 of 478 outputs return more) and keep the compact tail short (10 entries at most). Larger `-k` gave no gain in path opening. Risk: low to medium. In 5% of the `-k 8..10` calls the only opened path was at rank 6 or lower, so keep the compact tail.
8. **Do not elide export or registry blocks in previews** (`module.exports = { ... }`, a list of exports, an index of rules). The agent needs these lines to answer, and the elision forced a full read. Risk: low. It adds a few lines.

## 8. Limits of this study

- 56 labels are my reading of the next calls and the agent text. Thinking text is partly hidden. "Used" means the next action or the text shows it.
- The sample over-represents unsolved rollouts. Of 13 solved-rollout calls, 6 were "no". The sample is too small to link search usefulness to the solve.
- The `-k` comparison is not randomized. The agent chose `-k`.
- I did not run any tool. All numbers come from `dossiers.jsonl` and the existing parsers.
