# ss-grep forensics (group `ss-grep`, all harnesses)

## Conclusion

ss-grep finds the right file in most calls, but its output shows the matched fragment, not the source line. This forces a follow-up read after about half of all hits. The output is also flooded by test files and generic tokens in about one call in nine.

- The agent understands the tool and its flags. Flag errors are 12 of 3,462 calls. The failures come from the patterns the agent writes, not from `-k` or `--in`.
- Usefulness (my judgement, 72 deep reads): yes 16, partly 32, no 24, harmful 0. Weighted to the real mix of calls (see Method): yes 31%, partly 45%, no 24%.
- Judged waste: about half of the characters in normal outputs and about 65% over all outputs. The weighted figure is dominated by flood outputs.
- ss-grep is 5.8% of all amplified tool-output tokens (8.2M of 140.5M). Every output change below therefore moves total context cost by at most about 2%. The larger gain is fewer follow-up reads and fewer re-searches.

## Method

- Population: 3,462 ss-grep calls with a known output (dossiers.jsonl; opus 1,166, claudecode-luna 589, codex-luna 601, opencode-luna 1,106). 13 tasks, 1,160 rollouts.
- Sample: 72 calls, seed 42, read in full (call, output, agent text before and after, next four calls). Strata per harness: solved/unsolved x early/late (2 each), empty output (3), large output over 1,800 chars (2). Extra strata: error (4), `--in` scoped (4), alternation (4), regex note (4), truncated (4). Baseline variant preferred: 66 rows are `baseline`, 6 are `base-2.8.2`. No variant rows. 58 rollouts, 13 tasks.
- Because empty, large and error calls are over-sampled, I weight the labels by the true share of each class among all calls: normal 72.7%, empty 14.4%, big (hits, 1,500 chars or more) 10.9%, error 2.1%.
- Script counts (all 3,462 calls) back the patterns. They use the first follow-up call that is not in the same model response.
- Limits: 13 tasks only. Opus runs are mostly the `baseline` variant, where opus reads with native `sed`/`cat` more than with ss-read. Waste figures are my estimates, not measurements, unless marked "measured".

## 1. Usefulness

| class | n in sample | yes | partly | no | share of all calls |
|---|---|---|---|---|---|
| normal (hits, under 1,500 chars) | 37 | 16 | 17 | 4 | 72.7% |
| empty (zero matches) | 13 | 0 | 5 | 8 | 14.4% |
| big (1,500 chars or more) | 18 | 0 | 9 | 9 | 10.9% |
| error | 4 | 0 | 1 | 3 | 2.1% |
| all (raw) | 72 | 16 | 32 | 24 | |
| all (weighted) | | 31% | 45% | 24% | |

By harness key (raw): opus-claudecode 3 yes / 8 partly / 3 no (n=14). luna-claudecode 1 / 11 / 9 (n=21). luna-codex 7 / 6 / 3 (n=16). luna-opencode 5 / 7 / 9 (n=21).

"partly" mostly means: the call named the right files, then the agent had to read to see the code. "no" means the output was unused or the call returned nothing.

Zero-hit calls are not always waste. In my sample, 5 of 13 were a correct "this does not exist" answer (for example the name of a rule that the task asks the agent to create). The other 8 were guessed names or content greps for a path.

## 2. Which parts of the output the agent uses

Sample counts, with weighted share in brackets (parts used by the agent, parts present but ignored):

| part | used | ignored |
|---|---|---|
| file paths | 38 (61%) | 17 (22%) |
| hit line numbers | 28 (51%) | 25 (29%) |
| header `N total match(es) ... across M files` | 14 (24%) | 13 (17%) |
| matched fragment text | 1 (2%) | 49 (72%) |
| `(+N more in this file)` marker | 0 | 18 (19%) |
| `# +N more file(s)` tail | 0 | 9 (7%) |
| `regex note:` line | 0 | 9 (15%) |
| `# same file (siblings of ...)` line | 0 | 2 (4%) |

Measured over all calls:

- Match-line characters: path 53.2%, `:line: ` separator 9.3%, matched text 21.7%, header 9.7%, truncation note 1.9%, `+N more file(s)` note 1.8%, regex note 0.8%, sibling line 1.2% (opus only: 4.6%).
- 96.3% of hit lines carry the same fragment as another line in the same output. In 77% of outputs with hits (2,226 of 2,888), all lines carry one single fragment. That fragment is the pattern literal. It adds no information.
- 33% of hit lines (34.7% of hit-line characters) are in test, spec or fixture paths. When at least half of the hits are in such paths, the next read opens a source file 87% of the time (566 vs 85).
- The first follow-up after a call with hits: ss-read or native read of a hit file 55% (ranged read that covers a hit line 44.1%, whole file 7.8%, range that misses the hit 3.5%), read of a non-hit file 12.6%, edit 9.4%, another ss-grep 7.3%, native grep or find 1.4%. Median ranged read is 86 lines (p75 130, p90 200).
- The recovery hint `--in <file>` is almost never used. Of 586 outputs that show a truncation or "raise -k" marker, 3 are followed by the same pattern with `--in` inside the next 3 calls.

## 3. Recurring patterns

### P1. The output shows the matched fragment, not the source line

The code prints `matchText` (the first regex submatch, cut at 140 chars). The full line (`content`) is already fetched and then dropped.

- `hc-claudecode-20260929-1820-L1/zmap__zlint-299/r0#3`: the hit line shows `Poison`. The real identifier is `CtPoisonOID`. The agent ran `sed -n 25,40p util/oid.go` to learn the name.
- `hc-codex-20260929-1542-L1/rokucommunity__brighterscript-1050/r0#9`: 39 hits of `IndexedGetExpression`. All 30 shown lines read `IndexedGetExpression`. The agent then opened four ranges of two files.
- `hsmoke-claudecode-luna-20260926-1000-L1/superlistapp__super_editor-2516/r0#34`: pattern `\[.*\]` shows `[0]`, `[1]`, `[0]`, ... 23 times. No line is usable.
- `hsmoke-claudecode-luna-20260925-2153-L4/pytask-dev__pytask-210/r0#9`: the first `Edit` after a grep on `__tracebackhide__ =` failed with "String to replace not found". The grep had shown only a fragment of that line. This is one case, not a measured rate.
- 25 times the agent ran a native `grep -n` on a file that ss-grep had just listed, to see the lines. Example: `ss-grep "isLayer\(|isRoot\(|getRoot\(" ...` then `grep -n "isLayer\|isRoot\|getRoot(" packages/core/src/view/GraphDataModel.ts`.

### P2. Floods from generic tokens, alternations and test files

10.9% of calls print 1,500 chars or more. They carry 38% of all ss-grep characters. Alternations with 3 or 4 branches give a large output in 22-26% of calls, against 8.5% for one branch.

- `hc-opencode-20260929-0612-L1/joshuakgoldberg__bingo-271/r0#11`: `logRerunSuggestion|process.argv|templatePackageData.name|from`. 971 hits, 234 files. The agent wrote: "my search may be too broad and not yielding useful results".
- `hsmoke-claudecode-luna-20260925-2153-L1/gitbookio__markup-it-56/r0#55` and `hsmoke-claudecode-luna-20260925-2153-L4/gitbookio__markup-it-56/r0@side:aa7b666b#22`: a branch that is a lone `@` or `[^\w\s@]*@` prints 300 lines of `@`. The agent moved to natural language search.
- `hsmoke-opencode-20260926-0648-L4/zmap__zlint-299/r0#15`: pattern `ct\.`, 91 hits in 67 files, 2,900 chars. The agent did not use it.
- `hsmoke-claudecode-luna-20260925-2153-L1/jensneuse__graphql-go-tools-174/r0#2`: `__typename`, 43 hits. Only 2 hits are in source files. The rest are in `*_test.go`.
- `hsmoke-claudecode-luna-20260926-1000-L1/mwouts__jupytext-360/r0#60`: `--in tests` returns 40 generated `.ipynb` fixture hits out of 48.

### P3. Path-order truncation hides the definition and the scoped directory

85% of multi-file outputs are sorted by path (1,261 of 1,478). When hits exceed `-k`, the first `k` paths in alphabetical order win. Relevance plays no part.

- `hc-opencode-20260929-1640-L3/zmap__zlint-299/r0#6`: `IsSubscriberCert`, 37 hits in 36 files. The definition is in `util/`. The shown lines are `lints/...`. The agent wrote: "`ss-grep` was truncated and didn't show a definition due to ranking issues".
- `hsmoke-opencode-20260926-0648-L4/zmap__zlint-299/r0#11`: same shape. The agent then ran `ss-find ... --regex "func IsSubscriberCert"` to find the definition.
- `hc-opencode-20260929-0208-L1/rokucommunity__brighterscript-1050/r0#11`: `--in src/parser src`. All 20 shown lines are `src/astUtils/...`. No `src/parser` hit shows.

### P4. Zero-hit calls re-search

499 calls (14.4%) return `(no matches)`. The first follow-up is another ss-grep 18%, ss-search 16%, ss-find 5%, native search 4%, ss-read 23%, native read 13%, edit 10%. Most zero hits come from guessed identifiers.

- `hc-codex-20260929-1523-L1/zmap__zlint-299/r0#3` and `hc-opencode-20260929-2143-L1/zmap__zlint-299/r0#5`: `IsPrecertificate`. The agent then ran two to four more probes before it found `CtPoisonOID`.
- Case: a later call in the same rollout shows the same word in a different case in at least 43 of 387 zero-hit calls with literal branches (11%, lower bound). Examples: `Precert` vs `precert`, `poison` vs `Poison`, `CTPoison` vs `CtPoison` (`hc-opencode-20260929-0108-L2/zmap__zlint-299/r0#6`, `hc-codex-20260929-1933-L3/zmap__zlint-299/r0#5`). `-i` is used in 16 of 3,462 calls.
- Path-like patterns: ss-grep searches file contents only. A pattern such as `from-markdown/html` returns 0 and looks like absence (`hsmoke-claudecode-luna-20260925-2153-L4/gitbookio__markup-it-56/r0#11`, `hsmoke-claudecode-luna-20260925-2153-L1/gitbookio__markup-it-56/r0#12`). The tool prints no hint.

### P5. Regex crash on a literal with a parenthesis

43 calls (1.2%) die with a ripgrep parse error and a Node stack trace. 32 are "unclosed group" (`isLayer(`, `callable(`), 7 are "repetition quantifier" (`runCLI({`, `runModeSetup({`), 3 are a leading repeat operator. The trace is 21.9k characters in total. It follows an irrelevant "Vocabulary loaded" line.

- `hc-opencode-20260929-1804-L1/maxgraph__maxgraph-365/r0#4`, `hsmoke-claudecode-luna-20260925-2153-L4/pytask-dev__pytask-210/r0#5`, `hc-opencode-20260929-1226-L1/smooth-code__svgr-10/r0#5`.
- After the crash, 16 of 43 agents re-ran ss-grep, 13 went to ss-read, 7 to edit. Some never retried (`maxgraph r0#4`).
- A call name followed by `(` is the most natural literal that an agent writes.

### P6. Notes and markers that nobody uses

- Regex note: 197 outputs. The BRE-to-ERE retry rescues 154 of them (the retry returns hits). It is a good safety net. But luna agents do not learn from it. In 94 rollouts that got the note, 100 later calls use `\|` again. Opus never writes `\|` (0 of 1,166). Total cost 0.8% of ss-grep characters.
- Sibling line `# same file (siblings of ...)`: 152 outputs, 130 from opus. After it the next call is ss-read in 55% of cases. For singleton hits without it, 49%. No visible effect on behaviour. It may help edits. I cannot judge that from the next call.
- `(+N more in this file)=truncated — see the rest: ss-grep ... --in <file>` header line: 1.9% of characters. Drill-in use is 3 of 586 (see section 2).

## 4. Does the agent understand the tool and its flags?

Yes. 58 of 72 sampled calls are clean. Over all calls:

- `-k` is on 82% of calls. The default is 20. Among calls with an explicit `-k` and hits, `-k` is at least the number of hits in 76%, so it rarely limits. Agents ask for 10-50 and sometimes 80-100. Output size grows with `-k` (average 694 chars at k=20, 1,250 at k=50, 2,451 at k=100).
- `--in` is on 313 calls (9%), used correctly, including repeated scopes. Positional scopes work through the argument absorber.
- Misuse is rare (12 usage errors): `--help` (4), an extra positional path or a `--regex` flag copied from ss-find (4), a stray `--` separator (1).
- The agent follows the rules text: one ss-grep on the rarest escaped token. Remaining failures are the pattern itself: guessed names (P4), generic alternatives (P2), `name(` (P5), `\|` (P6), content grep for a path (P4).
- Follow-up choice: after hits, the agent reads. It rarely re-greps (7.3%) and rarely falls back to native search (1.4%). Opus reads with native `sed`/`cat` 42% and ss-read 38% (baseline variant); luna harnesses use ss-read 54-62%.

## 5. Product-fix proposals

Savings are amplified tokens (tokens x (1 + later turns), as in STATS.md), measured on all 3,462 calls. The three proposals overlap, so do not add them. Each fix must be gated on `_isAgentFormat` (the call sites already pass `_isAgentFormat: !fixedString`), per the repo rule. No fix names a task, repo or symbol.

| # | change | measured saving | frequency | accuracy risk |
|---|---|---|---|---|
| 1 | Order hits source first, then tests. Collapse test and fixture hits to one summary line (count, files, `--in` hint) when source hits exist. Rank files by relevance, not by path: definition lines first (use the index symbol table, not a keyword list), then fewer hits per file. Always list the explicitly scoped directory first. | 23% of ss-grep tokens (1.35% of all) from test lines alone. It also removes the hidden-definition failure in P3. | 30% of calls have test lines over 120 chars | Low to medium. Test-editing tasks need test hits. Keep a budget of 30% of `-k` for tests, and show tests in full when no source hit exists. 13% of reads after test-heavy outputs open a test file. |
| 2 | Flood guard. When hits are 50 or more, print per-file counts for the top 10 files (source first) and one line: "pattern matches N files; add a rarer token or use --in". Do not print `k` identical lines. | 12-18% of ss-grep tokens (0.7-1.05% of all) | 7% of calls (250 at 50 or more hits) | Low. Paths stay visible. Agent can raise `-k` as today. |
| 3a | Drop the fragment column when all fragments are equal. Print `path:line`. The header already names the pattern. | 12.5% of ss-grep tokens (0.73% of all). Free. | 77% of outputs | None. |
| 3b | Show the trimmed source line (100 chars) instead of the fragment when a call has 8 hits or fewer. | Costs +9.9% of ss-grep tokens (0.58% of all). Benefit unknown: it may remove part of the 55% of calls that are followed by a read of a hit file. | 44% of calls | Low risk to accuracy. Needs a small paired smoke before shipping, because net tokens can go up. |
| 4 | On a regex parse error, retry the pattern as a fixed string and say so in one line. Print no stack trace. | 2% of ss-grep tokens. Also removes a wasted turn in 43 calls. | 1.2% of calls | None. The result is exact for a literal. |
| 5 | On zero hits, retry once case-insensitively (like the BRE retry). When the pattern looks like a path, add: "ss-grep searches file contents, not paths". | Saves a re-search in at least 43 of 499 zero-hit calls (lower bound). Small in tokens. | 14% zero-hit calls | Low. Non-zero results stay byte-identical. Mark retried hits clearly. |
| 6 | Accept `\|` silently (no note). Drop the `--in` truncation header line, or shorten it. Consider removing the sibling line from ss-grep. | 1.2% (note) + 0.8% (sibling) of ss-grep tokens, under 0.1% of all | 5.7% of calls carry a regex note | None for the note and header. Sibling line: unknown effect on edits, so test it first. |

Ranking by expected tokens saved x how often: 1, then 2, then 3a, then 4 and 5 (small tokens, but they remove wasted turns), then 6. Proposal 3b needs a measured test.

## 6. Answers to the focus questions

- Output format. The headers are fine and short. The `file:line: token` lines are not what the agent needs, because the token is the pattern, not the line. Truncation markers and recovery hints are ignored. The `across N files` header is used in about a quarter of calls.
- Regex dialect. Opus writes Rust-style `|` and escapes. Luna writes GNU `\|` in 208 calls. The retry shim handles it, but the agent does not learn from it. Unescaped `(` and `{` crash (43 calls).
- `-k` and `--in`. Understood. `-k` is too generous for floods and does not cause them. `--in` works. The `--in` recovery advice after truncation is unused.
- After a hit. ss-read at the hit about half of the time, edit 9%, re-grep 7%, native fallback 1% (opus: native read 42% in the baseline variant). The agent reads because the line is not shown.
- Waste. Test files and fixtures are a third of hit lines. Generic tokens and alternations cause floods. The repeated fragment column carries no information.
- Missing information that forces calls. The source line (P1), the definition file when path order cuts it (P3), and a path hint when the pattern is a path (P4).
