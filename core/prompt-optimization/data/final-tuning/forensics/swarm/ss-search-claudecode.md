# ss-search on Claude Code: forensic read (Opus 5.5 and gpt-5.6-luna)

## Conclusion

The agent uses the code of rank 1 and rank 2. It does not use the confidence line, the sufficient verdict, the score, the budget header, the trailers or the gutter numbers.
A cut of about 16-19% of the characters loses nothing. The cut can grow to about 40% if the unused one-line entries and related lines also go.
The first ss-search call is rarely the last search for the Luna model. The Opus model never searches twice.

## How I sampled

- Group: tool `ss-search`, harness `claudecode`. The dossier file holds 258 such calls: 35 Opus and 223 Luna (187 in the main thread).
- I read all 35 Opus calls. This is the full population, not a sample.
- I read 32 Luna calls from the main thread. The sample is stratified by task (12 tasks), solved or unsolved, and early, middle or late position. Seed 42. Round robin over 40 strata.
- Total deep reads: 67. I read the full output, the agent text and thinking before and after, and the next 8 calls of the same rollout.
- Variants: Opus rows are mostly `baseline` and the `product+batch-read*` family. Luna rows are `baseline`, `max` and `max-batch` (the hsmoke runs of 2026-09-25 and 09-26).
- Opus caveat: 30 of the 35 Opus calls are on one task (smooth-code svgr-10), 4 on markup-it-56, 1 on graphql-go-tools-174. Read the Opus numbers as one task seen 30 times.
- Opus caveat: Opus writes almost no visible text and its thinking is empty. I judged from the actions that followed. Where a listing (`ls`, `git ls-files`) ran in the same turn, I mark a file name as "probably from the output" and not as proof.
- Luna caveat: the Luna variant prompts ask for search "probes" and a state summary. Some Luna calls exist to meet that rule.
- Besides the 67 reads, I ran scripts over all 258 calls. These give the population rates below. They match paths in the next 3 turns. They miss code the agent used without reading a file again, so they under-count use.

## Usefulness rates (my labels, n = 67)

| group | n | yes | partly | no | harmful |
|---|---|---|---|---|---|
| Opus 5.5 (all 35 calls) | 35 | 20 (57%) | 13 (37%) | 2 (6%) | 0 |
| Luna (sample of 32) | 32 | 13 (41%) | 6 (19%) | 13 (41%) | 0 |
| both | 67 | 33 (49%) | 19 (28%) | 15 (22%) | 0 |

- "yes" for Opus means the agent acted on shown code without reading it again, or read only the lines the output did not show.
- No call was harmful. One Opus call was piped through `head`, which hid ranks 2 to 12. One Luna call carried a STALE flag that the agent ignored.
- Population check on all 187 Luna main-thread outputs: 34% have no result path used in the next 3 turns (20% in the next 6). My "no" share of 41% is close to this.
- Population check on 35 Opus outputs: 66% have no result path used in 3 turns. This is misleading. The Opus agent used the shown code in place. Section "Parts used" shows the proof.

## Parts used and ignored

Counts are from my 67 labels.

| part | used | ignored (when present) | note |
|---|---|---|---|
| rank 1 code | Opus 33/35, Luna 16/32 | Opus 2, Luna 16 | the main value |
| rank 2-3 code | Opus 22, Luna 6 | Opus 3, Luna 21 | Opus used rank 2 (a file listing plugins). Rank 3 was used 0 times in 27 |
| `path:range` in the rank header | Opus 30, Luna 15 | | agents read only the unseen lines: `head -26`, `sed -n 1,20p` |
| `### imports` | Opus 28, Luna 3 | 1, 3 | Opus probably read the plugin files it names; two edits copy an import line. A parallel `ls` shows the same names |
| one-line summary entries | 3 + 3 | 6 + 21 | used as an anchor in 6 of 37 outputs that had them |
| `### related` | 0 | 8 + 17 | 28 of 260 related targets (11%) appear in later commands |
| `# same file` lines | Luna 3 | Luna 14 | used in the 3 cases where rank 1 was the wrong sibling |
| `# confidence=` and `sufficient=` | 0 | 67 | never mentioned in any visible text or thinking |
| `score=` | 0 | 67 | never mentioned |
| `# ss-search:` header (budget, used, subMode, routed) | 0 | 67 | never mentioned |
| `shown-full:` and `route=` trailers | 0 | 67 | `route=` repeats the confidence line |
| gutter line numbers | no proof | 67 | agents take ranges from the header, not the gutter |

Proof for "rank 1 and rank 2 code are used in place" (Opus, svgr-10). In 22 calls the output showed `configToOptions.js:27-72`. In 10 of them the agent read only the missing top lines (`head -20`, `head -26`, `sed -n 1,26p`). In 9 it never read the file again and went on to edit. In 3 it read the whole file. In the 8 calls where the output did not show that file, the agent read the whole file every time. In 2 of the 9 no-read cases the edit pattern is an import line copied from the imports block (`perl -0pi ... import removeComments from './h2x/removeComments'`). The Edit and Write tools hide their text, so I cannot check the other 7. The first-call success figure in STATS.md (11% for Opus) misses this pattern.

Proof for "the verdict is not used". After `sufficient=YES` the Opus agent read more files in 94% of 18 calls. After `sufficient=no` it did the same in 100% of 4 calls. After `unknown` it did so in 92% of 13 calls. For Luna the re-search rate in the next turn is 14% after YES, 12% after no, 23% after unknown. A higher confidence bucket gives more re-search (high 31%, medium 20%, low 18%). The agent does not follow the system-prompt rule "on sufficient=YES trust the top result".

Rank order and use (path used in the next 3 turns, files other than the rank-1 file):

| rank | Opus | Luna |
|---|---|---|
| 1 | 9/35 (26%) | 61/187 (33%) |
| 2 | 6/30 (20%) | 21/105 (20%) |
| 3 | 0/27 (0%) | 24/121 (20%) |
| 4-6 | 4/21 (19%) | 59/382 (15%) |
| 7-10 | 0/2 | 72/447 (16%) |
| 11 and later | none | 67/712 (9%) |

Other population numbers over the 222 outputs:
- Within 2 turns the agent reads a range that overlaps the code it just saw: 24% for Luna, 14% for Opus.
- Two ss-search calls in a row in one rollout show the same rank-1 span in 22 of 119 pairs (18%).
- A Luna rollout makes 2.8 ss-search calls on average (187 calls, 68 rollouts). Only 10 rollouts make one call.

## How much output could go

Share of output characters. Shares are by group over all outputs in the group.

| tier | what goes | Opus (n=35) | Luna (n=187) | accuracy risk |
|---|---|---|---|---|
| A: no information lost | `# ss-search:` header line, `route=` trailer (repeats the confidence line), `shown-full:` trailer, `score=`, summary line that restates its header, imports block that repeats lines inside the numbered code | 15.8% | 18.6% | none |
| A + gutter | the line-number prefix | 22.8% | 23.9% | low: no use found, but the numbers help citing lines |
| B | tier A, gutter, unused summary entries, unused related and same-file lines, the confidence line (keep one verdict line) | about 24% | about 41% | low to moderate: summaries gave an anchor in 6 of 37 outputs |
| C (upper bound) | tier B plus rank 2-n code blocks whose file is not used in 3 turns | about 61% | about 60% | moderate: Opus used rank 2 in place in 22 calls |

My per-call waste estimates in the labels add the rule "a call with label no wastes all its output". This gives 48% for Opus (n=35) and 77% for the Luna sample (n=32). The Luna figure is high because 13 of 32 calls were fully ignored. Use the tier table for planning.

Per-output cost: the mean output is 4.4K chars for Opus and 5.4K for Luna. Each output is re-read by every later request (median 8 later turns for Opus, 22 for Luna).

## Recurring patterns

1. **The agent trusts code that is shown and reads only the gap.** The Opus agent reads `head -26` after a span that starts at line 27. In two runs it edits with an import line copied from the imports block. Examples: `hc-claudecode-20260929-0405-L1/smooth-code__svgr-10/r0#1` ("sed -n 1,20p src/configToOptions.js"), `hc-claudecode-20260929-0405-L2/smooth-code__svgr-10/r0#2` ("head -20"), `tg-20261001-0657-v2-L3/smooth-code__svgr-10/r0#2` ("head -26"). The shown code and the header range are the real value. The imports block is probably used.

2. **The agent never acts on confidence, sufficient, score or the budget header.** No label shows it. Examples: `hc-claudecode-20260929-1209-L3/smooth-code__svgr-10/r0#2` (sufficient=YES, then cat of 4 more paths and an `ls` of node_modules), `hsmoke-claudecode-luna-20260926-1525-L1/smooth-code__svgr-10/r0#4` (sufficient=YES, then ss-find, three ss-grep and more reading), `hc-claudecode-20260929-0229-L1/smooth-code__svgr-10/r0#1` (sufficient=no, same next moves as YES). These lines cost 4% of the characters plus the trailer repeat.

3. **The tail of one-line entries is rarely used.** 78% of entries are summaries. Each one restates its header. The agent used a summary 6 times in 37 outputs that had them. When it did, it took a symbol name or a span: `hsmoke-claudecode-luna-20260926-1525-L2/rokucommunity__brighterscript-1050/r0#10` (`ss-grep expectedRightSquareBraceAfterArrayOrObjectIndex`, a symbol from rank 5 of an earlier output) and `hsmoke-claudecode-20260926-0031-L2/gitbookio__markup-it-56/r0#2` (`ss-read ... 56 100`, the span of rank 2). Most big tails are noise: `hsmoke-claudecode-luna-20260926-1000-L2/superlistapp__super_editor-2516/r0#18` (28 entries, scores down to 0.001, yaml version lines), `hsmoke-claudecode-luna-20260926-1525-L2/maxgraph__maxgraph-365/r0#0` (20 entries, 9.4K chars, none used).

4. **Ignored searches: wrong query, late sweep, duplicate.**
   - Exact identifier or regex sent to the semantic tool: `hsmoke-claudecode-luna-20260926-1525-L2/maxgraph__maxgraph-365/r0#0` ("GraphDataModel isLayer ..."; ss-grep gave the file at once), `hsmoke-claudecode-luna-20260926-1000-L1/mwouts__jupytext-360/r0#49` (regex `kernelspec.*language|main_language...`).
   - Search after the edit is done: `hsmoke-claudecode-luna-20260925-2153-L4/pytask-dev__pytask-210/r0#21` (turn 19 of 20, then the final answer), `hsmoke-claudecode-luna-20260926-1525-L2/joshuakgoldberg__bingo-271/r0#50` (file already edited two turns before).
   - Same query twice: `hsmoke-claudecode-luna-20260925-2153-L3/pytask-dev__pytask-210/r0#3` (same rank 1, 2 and 3 as call #1; the next call is Edit).
   - Vendored copy as rank 1: two maxgraph calls show `packages/html/stashed/.../Graph.js` with 79 code lines. The agent never opened it.

5. **Shown code is read again.** 24% of Luna outputs lead to a read of an overlapping range within 2 turns. Examples: `hsmoke-claudecode-luna-20260926-1525-L2/ember-cli__eslint-plugin-ember-551/r0#8` (`ss-read no-old-shims.js 245 277`, exactly the shown span), `hsmoke-claudecode-luna-20260926-1525-L1/dbader__node-datadog-metrics-73/r0#0` (two whole files re-read although the output showed 1-49 and 1-41), `hsmoke-claudecode-luna-20260926-1000-L2/mwouts__jupytext-360/r0#1`. The label "preview" does not tell the agent that a span is the whole file.

6. **Related and same-file lines help only in one case.** Related lines give a target path in 11% of cases. The same-file sibling line was used when rank 1 was the wrong sibling: `hsmoke-claudecode-luna-20260925-2153-L3/jensneuse__graphql-go-tools-174/r0#6` (the agent traced `fieldDefined`, the sibling at line 229, and ignored a 17-line related block of 369 tokens). Related lists also hold noise: `hsmoke-claudecode-luna-20260926-1000-L3/superlistapp__super_editor-2516/r0#0` has repeated `calls _log.fine` lines.

7. **Opus issues one blind probe.** 34 of 35 Opus calls run in turn 1, in parallel with `ls` or `git status`. The query comes from the task text only. Opus never calls ss-search twice in one rollout. After it, Opus uses `cat`, `ls` and `ss-read`, and it explores `node_modules` for what the index cannot show. The one later call (`hsmoke-claudecode-20260926-0031-L4/jensneuse__graphql-go-tools-174/r0#13`) was piped through `head`.

## Does the agent understand the tool?

- Yes for the main use. Both models send natural-language queries for concepts, as the rules text says. Opus: 33 of 35 "yes". Luna: 22 of 32 "yes", 9 "unclear", 1 "no".
- Common misuse:
  - Exact identifiers or file names in an ss-search query (3 of 32 Luna calls). The rules text says ss-grep.
  - A regex alternation in the query (1 of 32).
  - Piping ss-search to `head` (1 Opus call). It hid ranks 2 to 12.
  - Guessing file paths after a search and getting ENOENT (3 failed `ss-read` in `hsmoke-claudecode-luna-20260925-2153-L3/gitbookio__markup-it-56/r0#30`).
  - Late, duplicate or after-edit searches whose output was not used (8 of 32).
  - Opus reads results with native `cat` in 27 of 35 cases, not `ss-read`.
- The agent ignores the rule "on sufficient=YES, trust the top result". It also reads whole files that the output already showed.

## Fix proposals, ranked by expected tokens saved times frequency

General wording only. Gate every change on the agent format, as the repository rules require.

1. **Remove pure repetition from every ss-search output.** Print one verdict line. Drop the `route=` trailer, the `shown-full:` trailer, `score=`, the `# ss-search: routed=... budget=... used=...` line (keep `results=` only if needed), and any summary line that restates its header. Print the imports block only when its lines are not inside the numbered code. Saves 16-19% of characters on every call, about 700-1000 chars, times 7 to 14 re-reads. Accuracy risk: none found; no part was used in 67 reads. Check with the dev set.
2. **Cut the one-line tail.** Keep at most 5 summary entries, and drop entries with a score below a floor relative to rank 1 (for example under 50% of it) or whose span repeats an earlier entry (7.7% of entries). Do not show summaries of spans over 500 lines as pointers. Saves about 10-12% on Luna-style calls with `-k 8` to `-k 20`. Accuracy risk: low to moderate. A summary gave an anchor in 6 of 37 outputs. Test on the dev set with `-k 10` and `-k 20`.
3. **Make "already shown" explicit.** Add a short marker when the shown span is the whole file or the whole function. Mark when a later call repeats the same top 3 as the previous search ("same top results as your previous search"). Targets the 24% re-read rate and the 18% repeated-query rate. Saves 1-3K chars per event. Accuracy risk: none.
4. **Guard the query shape.** If the query is a single identifier, a file name or contains regex symbols, answer with the top hit and its span only, and print one line that names ss-grep. Frequency about 10% of Luna calls. Saves 4-9K chars per event. Accuracy risk: low, because the agent used ss-grep next in every such case.
5. **Trim related and same-file lines.** Cap `### related` at 5 lines. Drop lines for logging calls and for targets inside the shown span. Keep the siblings line, but only when rank 1 is not the best-matching sibling. Saves 2-4% of characters. Accuracy risk: low.
6. **Demote vendored or legacy folders** (names like `stashed`, `vendor`, `third_party`) below source folders. Two sampled maxgraph calls had a 79-line wrong rank 1 from such a folder. Frequency is repo-specific, so the saving is small overall. Accuracy risk: low if gated on the agent format.
7. **Fix the rules text, not the output.** The line "on sufficient=YES, trust the top result" does not change behavior. Either remove the rule and the `sufficient` text, or test a harder wording on the dev set. Saves the 1.4-1.8% line if removed. Accuracy risk: unknown. This needs a bench run, so I only prepare it. I run nothing.
8. **Keep rank 1 and rank 2 code.** In the Opus rows the agent used rank 2 in place in 22 of 35 calls. Do not cut it. A smaller fix is to drop the rank 3 preview when its score is far below rank 2: it was used 0 of 27 times for Opus and 20% for Luna.
9. **Tell agents never to pipe ss-search to `head` or `tail`.** One line in the rules text. Low frequency, small saving, no risk.

## Files

- Labels: `/Users/admin/Projects/sweet-search-final-tuning/core/prompt-optimization/data/final-tuning/forensics/swarm/ss-search-claudecode.labels.jsonl` (67 lines)
- This report: `/Users/admin/Projects/sweet-search-final-tuning/core/prompt-optimization/data/final-tuning/forensics/swarm/ss-search-claudecode.md`
