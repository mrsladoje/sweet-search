# ss-search under the Codex harness: forensic read of 53 calls

Group: `tool == ss-search`, `harness == codex` (model gpt-5.6-luna). Labels: `ss-search-codex.labels.jsonl` (same folder).

## Conclusion

Most of an ss-search result is not used. Only 32 of 53 calls (60%) moved the task forward, and even those wasted about two thirds of their characters.

- Usefulness (n=53): yes 17 (32%), partly 15 (28%), no 21 (40%). One of the 21 "no" rows is an exec failure that was not caused by the tool.
- The agent uses three things: rank-1 code (19 of 53 calls), ranks 2-3 previews (12 calls), and the path or line range of one-line summary entries (10 calls). It used `### related` in 1 call, `same file:` in 2 calls, imports in 1 call.
- The agent never used the header line, `score=`, the `# confidence=` line, `sufficient=`, `shown-full:` or `route=`. It never cites them: 0 of 902 agent messages in these rollouts contain the words confidence, sufficien-, score, 1-hop, shown-full or same file.
- Estimated waste: 79.7% of the output characters in the 53 calls (202,674 of 254,454). Inside the 32 yes/partly calls the waste is 67.5%. A "no" call wastes all of its output.
- A larger `-k` adds only one-line summaries. The number of code entries stays at 2.2 (k<=6) versus 2.5 (k=8-10).
- The first ss-search is enough in only 37% of rollouts. In 93 of 156 Codex rollouts (60%) the agent searched again, or switched tool, before it read a result path (`first-call-success.json`).
- A safe cut is 24% of all ss-search characters with no loss seen in the labelled set. A cut of 34% needs a small A/B on the dev set. Section "Proposals" gives the list.

## Method

- Population: 287 ss-search calls of 155 Codex rollouts (30 runs, 13 tasks). Four calls have no usable output (2 exec errors, 1 empty capture, 1 syntax error). 283 calls were used for the counts below.
- Sample: stratified random, seed 42, strata = task x solved x (first or later ss call), round robin, 54 calls drawn. Row `hsmoke-codex-20260926-0301-L2/jensneuse__graphql-go-tools-174/r0#9` has an empty captured output (batched script), so I dropped it. 53 calls are labelled.
- Mix: 14 calls from solved rollouts, 39 from unsolved; 28 first-or-second ss calls, 25 later; 16 calls with variant `baseline`, 37 with a harness variant (the Codex group has many variants; none changes the ss-search printer).
- Reading: for each call I read the full output, the agent text before, and the next 6-10 actions in the raw Codex session (thinking is encrypted). "Used" means a later action shows it: a read window that starts or ends at a printed line number, a path or symbol taken from the result, or a quote in the agent state summary. I cannot prove intent. Where evidence is weak I wrote "partly".
- Counts over all 283 calls (the "group-wide" numbers) come from a script that matches result paths to the next 6 calls, up to the next ss-search. They are upper bounds of use, because a path can appear in a later call by chance.

## 1. Usefulness

| label | n | share | output chars | waste share |
|---|---|---|---|---|
| yes | 17 | 32% | 89,251 | 61% |
| partly | 15 | 28% | 69,147 | 75% |
| no | 21 | 40% | 96,056 | 100% |
| all | 53 | | 254,454 | 80% |

What the agent did next: drill down with ss-read 19, switched to another ss tool (almost always ss-grep) 21, searched again with a new phrasing 7, edited or answered 6.

Usefulness falls late in a rollout. Calls at ss#0 or ss#1: yes 13, partly 8, no 7 (n=28). Later calls: yes 4, partly 7, no 14 (n=25). Late calls are usually "confirmation" searches or fourth rewordings.

Solved and unsolved rollouts look alike (solved: 5 yes, 5 partly, 4 no; unsolved: 12 yes, 10 partly, 17 no). Search quality does not separate them. In the unsolved yes cases the search found the right file; the fix itself failed later (for example `fastify__fastify-cors-285`, `dbader__node-datadog-metrics-73`).

## 2. Which parts the agent used and ignored

Counts over the 53 labelled calls. "Present" is the count of calls whose output holds the part.

| part | used (n) | ignored (n) | note |
|---|---|---|---|
| rank-1 code | 19 | 33 | used in 19 of 52 calls that had it |
| rank 2-3 code previews | 12 | 32 | the path, not the text, is what the agent takes |
| one-line summary entries | 10 | 37 | path and line range; never the second line |
| `### related` | 1 | 29 | decisive once (see pattern 5) |
| `same file:` line | 2 | 13 | line numbers set a read window twice |
| `### imports` | 1 | 40 | 26% of blocks repeat the code block |
| continuation code and `# continues at` | 0 | 17 | |
| header, `score=`, trailer | 0 | 52 | |
| `# confidence=` and `sufficient=` | 0 | 48 | agent never cites them |

Group-wide (n=283 calls, upper bounds):

- The rank-1 file is touched in the next calls in 108 calls (38%). In 74 of the 108 the agent re-reads the whole span rank 1 had just printed with `ss-read`. In 13 more it uses grep or an edit. So rank 1 mostly acts as a pointer.
- Use by entry type (first occurrence of each path): rank 1 code 38%; ranks 2-3 code 12%; summary ranks 4-5 15%; ranks 6-8 4.5%; ranks 9-10 9.9%; ranks 11 and up 2.6%.
- 146 of 283 calls print `### related`. A path that appears only in related lines is touched in 2 of 62 such calls. 45% of related lines (427 of 942) have no file target, for example `calls _log.fine (referenced at line 482)`.
- `sufficient=YES` (42 calls) goes with rank-1 use in 60% of calls. `sufficient=no` (37 calls) goes with 8%. The link is about result quality, not about the agent reading the line. After `sufficient=YES` the agent still searched again in 48% of calls.
- Composition of the 1,378,231 characters: code 49.3%, rank-header lines 19.0%, summary second lines 9.5%, related 4.6%, continuation 4.0%, imports 3.9%, trailers 2.8%, `# ss-search:` line 1.9%, `# confidence=` 1.6%.

## 3. Does a larger -k help?

No evidence that it does. It adds summaries, and the agent rarely uses them.

| -k asked | calls | mean entries | mean code entries | mean summaries | mean chars | any summary path touched next |
|---|---|---|---|---|---|---|
| 4-6 | 98 | 6.9 | 2.2 | 4.7 | 4,394 | 16% |
| 8-10 | 178 | 11.2 | 2.5 | 8.7 | 5,076 | 30% |
| 12 and up | 7 | 20+ | 2.6 | 17.6 | 6,291 | 57% |

- `-k` is not a cap. `-k 5` returned more than 5 entries in 37 of 91 calls (41%). `-k 8` and `-k 10` give nearly the same size (11.1 and 11.2 entries). Example: `hc-codex-20260929-1933-L1/ember-cli__eslint-plugin-ember-551/r0#0` asked `-k 5` and printed 15 entries.
- Agents choose `-k 8` or `-k 10` in 178 of 283 calls (63%).
- The extra summaries are touched more often (16% to 30%) but rank-1 use falls (55% to 29%). The two effects are confounded: agents pick a larger `-k` for broad, vague queries. I cannot say that a larger `-k` causes more use. It costs about 680 characters (15%) more per call.
- If summaries of rank 6 and lower were dropped, a later path from those ranks would be lost in at most 30 of 283 calls (10.6%). The agent can still find such a path with ss-grep.

## 4. Is the first ss-search enough?

Rarely. Reasons seen in the 53 calls, in order of frequency:

1. The query was conceptual and the results were wrong. The agent drops the output and runs ss-grep with an exact string from the issue (21 "no" calls).
2. The top hit was right but the agent wants the whole file or the test. It reads with `ss-read`. This is normal and not a failure (19 drill-downs).
3. The agent already knew the answer and searched to confirm (`pytask-dev__pytask-210`, `maxgraph__maxgraph-365`).
4. The useful file was only a one-line summary at rank 4 to 10, and the agent took the path from it.

Group-wide: after a search, the next call is ss-grep in 44% of cases, ss-read in 31%, ss-search in 9%, an edit in 6%. Searches per rollout: mean 1.8, maximum 4. In 8.5% of searches the rank-1 span is identical to an earlier search in the same rollout. In 11.7% the rank-1 file was already read with `ss-read`.

## 5. Recurring waste and failure patterns

**Pattern 1. Wrong-target natural-language query; the whole output is waste (21 of 53 calls, 40%).**
The query describes behaviour. The index returns plausible but wrong files. The agent goes to ss-grep.
- `hsmoke-codex-20260925-2342-L1/jensneuse__graphql-go-tools-174/r0#0`: "the first semantic search did not yet identify the validation path"; next call `ss-grep "field:.*not defined on type"`. Output: 15 entries, 2,895 chars.
- `hsmoke-codex-20260926-0301-L2/jensneuse__graphql-go-tools-174/r0#2`: 20 entries, four of them the same span `introspection_normalized.graphql:1-242`; agent reworded the query.
- `hsmoke-codex-20260926-1839-L1/smooth-code__svgr-10/r0#2`: rank 1 is a README section; two previews hold complete SVG samples (about 1,500 chars each).

**Pattern 2. The summary tail (7.5 one-line entries per call, 23.9% of characters).**
Each summary entry prints a header line and a second line that restates the header (99.9% of cases). Ranks 6 and lower are used in 2.6% to 10% of cases. Many entries repeat a span or a symbol.
- `hc-codex-20260929-2014-L1/ember-cli__eslint-plugin-ember-551/r0#3`: ranks 6, 7 and 8 are the same span `new-module-imports.js:40-120`.
- `hc-codex-20260930-0110-L3/zmap__zlint-299/r0#0`: ranks 2, 3 and 4 repeat rank 1's span.
- `hc-codex-20260929-1542-L3/maxgraph__maxgraph-365/r0#3`: 20 entries; ranks 11 to 14 are four tiny `Cell.ts` getters.

**Pattern 3. Repeat and confirmation searches (8.5% to 11.7% of all calls; most of the 14 late "no" calls).**
The rank-1 file is already read or already known. The new output adds nothing.
- `hsmoke-codex-20260926-0301-L1/gitbookio__markup-it-56/r0#17`: rank 1 `inlines/html.js` was read 8 calls earlier; the agent then read unrelated block files.
- `hsmoke-codex-20260926-0518-L4/mwouts__jupytext-360/r0#13`: same rank 1 (`pipe_notebook`) for the third time; next action is the patch.
- `hc-codex-20260929-2000-L3/fastify__fastify-cors-285/r0#5`: rank 1 is the chunk the agent had just edited, tagged STALE.

**Pattern 4. The agent re-reads what the search printed.**
In 74 of 108 touches of the rank-1 file the later `ss-read` window covers the whole printed span. The agent does this even when rank 1 or a preview already holds the whole small file.
- `hsmoke-codex-20260926-1839-L2/dbader__node-datadog-metrics-73/r0#2`: rank 2 `index.js` printed all 49 lines; the agent ran `ss-read index.js 1 90`.
- `hsmoke-codex-20260926-1839-L2/joshuakgoldberg__bingo-271/r0#1`: rank 1 printed the whole 43-line file; next `ss-read ... 1 80`.
- `ss-read` already answers `[unchanged reread omitted]` for repeats (seen in `hc-codex-20260929-2000-L3/mwouts__jupytext-360/r0#0` and `hsmoke-codex-20260925-2342-L3/pytask-dev__pytask-210/r0#3`), so the cost of the re-read is small. The cost sits in the first print.

**Pattern 5. Metadata and extras the agent does not read.**
Score, kind labels, confidence, `sufficient=`, `route=`, `shown-full:` and continuation code were never used in the 53 calls. Related lines were used once, and that use was decisive: in `hsmoke-codex-20260926-1839-L1/rokucommunity__brighterscript-1050/r0#1` rank 1 was the wrong class, but the line `caller primary <- Parser.ts:2654-2727` is the only place `primary` appears. The agent then wrote "parsing is likely in Parser.primary" and read lines 2580-2730. That line has a file target. Lines like `calls elements.push (referenced at line 2735)` have none.

**Pattern 6. The useful hit is a low-rank one-line entry, or the test ranks above the implementation.**
- `hc-codex-20260930-0110-L3/zmap__zlint-299/r0#0`: rank 1 is an 84-line test; the implementation file is a one-line rank-5 entry. The agent said "the implementation is in lints/lint_ct_sct_policy_count_unsatisfied.go" and read that file.
- `hc-codex-20260929-1618-L3/rokucommunity__brighterscript-1050/r0#0`: the useful `IndexedGetExpression` is a rank-3 summary; ranks 1-2 print unrelated classes with code.
- `hsmoke-codex-20260925-2342-L4/pytask-dev__pytask-210/r0#0`: rank 1 is the 30-line test file, rank 2 the implementation.
This pattern shows that the path, line range and symbol of an entry have value. The second line of a summary does not.

## 6. Does the agent understand the tool?

Yes for the flags and the commands. In all 283 calls the agent used valid syntax and only the `-k` flag (no `--full`, `--xl` or `--mode` in any call). It often combines ss-search with ss-read and ss-grep in one script.

What it gets wrong:
- It writes a conceptual query when the issue gives an exact string or identifier. It then falls back to ss-grep (pattern 1). Search with identifier-heavy text also fails: `hc-codex-20260929-1618-L3/maxgraph__maxgraph-365/r0#1` asked for `GraphDataModel isLayer null cell getParent` and got a stashed legacy `Graph.js` at rank 1.
- It re-runs equivalent queries with new wording instead of reading the file it already has (pattern 3).
- It treats `-k` as a size limit (it is not) and picks 8 or 10 by habit.
- It does not use `sufficient=YES` to stop. After it, 48% of calls search again.
- It almost never follows the `# same file: ... sweep: ss-semantic` hint. The hint is printed in 55 of 283 calls; `ss-semantic` is the next call in 2 of 283. The hint costs about 100 characters where printed.

Not tool misuse but seen: 4 of 287 calls failed to run (zsh exec errors; syntax error), and an apply_patch path slip (`hsmoke-codex-20260926-0518-L3/ember-cli__eslint-plugin-ember-551/r0#1`) that is unrelated to search.

## 7. Proposals, ranked by expected tokens saved times frequency

Sizes are shares of the 1,378,231 characters of the 283 Codex ss-search outputs. Mean output is 4,870 characters (about 1,218 tokens). Each token is re-read on every later turn (about 8 to 20 turns), so a cut in the first print has a multiplied effect.

| # | Change | Estimated saving | Frequency | Accuracy risk |
|---|---|---|---|---|
| 1 | Print each summary entry as one line `#N path:start-end symbol (kind)`. Drop the second line that restates the header. | 9.5% | every call (7.5 entries per call) | none: the line carries no new data (99.9% restate) |
| 2 | Drop `score=`, the `(preview kind=...)` tag, `# confidence=...`, `route=...`, `shown-full:`. Keep one short token `sufficient=YES/NO`. | about 8% | every call | low: never cited in 902 agent messages. Keep `sufficient=` because it tracks result quality. |
| 3 | In agent mode, make `-k` a real cap on entries. Show at most 3 summaries (ranks 4-6) and merge the rest into one line `also: path:line sym; ...` or drop them. | 10% on top of #1 (16.9% if applied alone) | every call with k>=8 (63%) | low to medium: a rank 6+ path was touched in up to 10.6% of calls. Agent can ss-grep. A/B on dev set first. |
| 4 | Related: print only lines that have a `file:line` target; cap at 5 lines. Remove continuation code blocks and `# continues at`. | 5.5% (1.5% + 4.0%) | 52% of calls print related; continuation in many | low: the one decisive use (a caller with a target) stays. Continuation used 0 of 17. |
| 5 | Repeat suppression. If rank 1 equals an earlier call top-1 or lies in a file already read or edited this session, print one line `top-1 unchanged: path:range (call #n)`. Dedupe entries whose span is inside an earlier entry. | 3% to 4% | 8.5% to 11.7% of searches; each saves about half of its output | low |
| 6 | Imports block: skip it when its lines already appear in the code block (26% of blocks). Option: skip it for non-top-1 ranks. | 1.3% to 3.9% | about 80% of calls print one | low |
| 7 | Confidence-adaptive output. When confidence is low and many_candidates (72% of calls), print compact `path:range symbol` lines for ranks 2 and up, and clip rank-1 code to about 20 lines. | 15% to 25% in those calls | 205 of 283 calls | medium: rank 1 is used in 33% of low-confidence calls. Needs dev A/B. |
| 8 | Clip rank 2-3 previews to 12 lines (median is 20, mean 26). | 14% | 393 preview blocks | medium: previews gave the agent file structure in 12 of 53 calls (for example `ember-cli__eslint-plugin-ember-551` at ss#0, the `new-module-imports` test pattern). Test on dev. |
| 9 | Prompt rule: if the issue text has an exact error string or identifier, run ss-grep first; use ss-search for behaviour. | up to 40% of search calls become one cheaper call | 21 of 53 calls | low; prompt only. It trades a wrong search for a grep, so check on dev. |

Combined effect of #1, #2, #4, #6 (no known loss): 24.3% of characters (1,218 to about 920 tokens per call). Add #3 to reach 34.4% (about 800 tokens per call). #7 and #8 are further experiments. All figures are measured on this group, not on the whole data set. No proposal names a task, repo or symbol.

Rules from the project guidance apply: run any change on the dev split first, and check the regression probes before any held-out run. These changes touch only the agent-format printer, so they do not touch ranking.

## 8. Limits of this read

- 53 labelled calls from 13 tasks. The Codex model is gpt-5.6-luna only. The Opus rows behave differently (3.4 entries per output).
- Codex thinking is encrypted. "Used" is inferred from actions.
- The group-wide counts use "path appears in the next 6 calls", which over-counts use.
- The `-k` table is confounded by query type and position in the rollout.
- Waste per call counts whole unused entries. An entry whose path was used counts as used even when the agent needed only its path. The true waste is therefore higher than 67.5% in useful calls.
