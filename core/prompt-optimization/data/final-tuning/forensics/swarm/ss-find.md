# ss-find forensics (group `ss-find`)

## Conclusion

ss-find is a low-value tool in its current form. About 85% of its output characters were not needed.
The agents mostly use it as a slow `ss-grep`, or as a repeat of code they already hold.
Keep the regex-plus-rerank ability, but trim the output and stop sending exact-token lookups to it.
Whether to keep the separate tool name is a judgement call. My answer is: fold it into `ss-search --regex`, or keep the name but remove it from the "exact token" rule.

Numbers (all from the dossier file; labels in `ss-find.labels.jsonl`):

- 335 real ss-find calls in 12 tasks. (The file has 340 rows. Five rows are `command -v ss-find` shell checks, not calls.)
- Opus made only 4 calls, all in one task with one query. Luna models made 331 calls.
- 74 calls read in depth: all 4 Opus calls and 70 others. Seed 42. Strata: harness x (empty / at least 50% of code lines already shown / other), in proportion.
  By harness: opencode 34, claudecode-luna 20, codex 16, claudecode-opus 4. Variant rows: 43. Baseline rows: 31.
- Usefulness of the 74 calls: yes 11 (15%), partly 33 (45%), no 27 (36%), harmful 3 (4%).
- Estimated waste: 86% of characters in the 74 calls. The same test on all 283 non-empty calls gives 84%. See "Which parts are used".

## 1. Usefulness (n = 74)

| harness | n | yes | partly | no | harmful |
|---|---|---|---|---|---|
| claudecode-opus | 4 | 3 | 1 | 0 | 0 |
| claudecode-luna | 20 | 1 | 7 | 9 | 3 |
| codex-luna | 16 | 2 | 5 | 9 | 0 |
| opencode-luna | 34 | 5 | 20 | 9 | 0 |
| all | 74 | 11 | 33 | 27 | 3 |

- "Yes" calls had one thing in common. The regex named a real symbol or a multi-term set, and rank 1 or rank 2 was the code the agent edited next. Examples: `hsmoke-opencode-20260926-1928-L1/mwouts__jupytext-360/r0#8` (stderr + Popen regex led to the `pipe_notebook` fix) and `hsmoke-claudecode-luna-20260926-1525-L2/zmap__zlint-299/r0#11` (rank 1 `IsExtInCert` appears in the final patch).
- 7 of the 11 "yes" calls were exact-token calls. `ss-grep` plus a narrow `ss-read` would have done the same job. Only 4 gained from ranking over a multi-term regex: `...jupytext-360/r0#8` (above), `hc-opencode-20260929-1640-L2/ember-cli__eslint-plugin-ember-551/r0#5`, `hsmoke-codex-20260925-2342-L4/gitbookio__markup-it-56/r0#16` and `...zlint-299/r0#11` (above). Ranking over a multi-term regex is the one thing `ss-grep` cannot do.
- The four Opus calls are the same call in four runs: `ss-find "auto_ext_from_metadata" --regex "def auto_ext_from_metadata"`. Each returns 2.5k characters. The function is 6 lines. The chunk opens 27 lines earlier, on an unrelated function, and carries an 1.1k imports block. One run also ran a native `grep -A25` on the same symbol in the same response. Opus does not use ss-find otherwise (4 of 2000 Opus ss calls; `ss-grep` is 1201).
- All 4 Opus rollouts are unsolved. The task, not the tool, is the likely reason. I make no causal claim.

## 2. Which parts of the output are used

Test used for the whole population (283 non-empty calls): does a later call (the next 4) touch a file named in the result?

| what the agent touched next | calls | share |
|---|---|---|
| only a file that had a code block | 70 | 25% |
| only a file that had a summary-only entry | 60 | 21% |
| both | 45 | 16% |
| no result file at all | 108 | 38% |

Character composition of all 283 non-empty outputs (2.05M characters):

| part | share of characters |
|---|---|
| code in entries whose file the agent touched next (used) | 15.9% |
| code in entries the agent never touched | 45.3% |
| summary-only entries | 24.8% |
| `### imports` blocks | 3.6% |
| `### related` blocks | 3.0% |
| header line and confidence line | 2.8% |
| rank headers, fences, blank lines | about 4.6% |

Part counts in the 74 labelled calls (used / present):

| part | used | present |
|---|---|---|
| rank 1 code | 26 | 59 |
| rank 2-3 code | 8 | 42 |
| summary line used as a `path:range` pointer | 13 | 50 |
| same-file line | 1 | 18 |
| related block | 0 | 28 |
| imports block | 0 | 58 |
| `shown-full:` trailer | 0 | 52 |
| line numbers (gutter) | 0 | 46 |
| header `budget= used=`, `score=`, `confidence=`, `sufficient=` | 0 | 74 |

- The header metadata is never used. In the 334 calls, the agent text after the call mentions `sufficient` once. It never mentions `confidence` or `score`.
- The `sufficient` verdict does not change behaviour. Next tool after `YES` (145 calls): ss-read 35%, ss-grep 16%, ss-find 10%. Next tool after `unknown` (129 calls): ss-read 35%, ss-grep 22%, ss-find 13%.
- Summary-only lines are useful as a file list, and nothing else. When the agent used them, it read their `path:range`. Example: `hc-opencode-20260929-1226-L1/rokucommunity__brighterscript-1050/r0#2` read lines 2491-2775, which is the union of rank 3 (2729-2775) and rank 4 (2491-2559). Rank 4 was the most used summary rank (17 of 60). Ranks beyond 6 add little.
- 84% of entries are summary-only (11.6 per call; only 2.15 entries per call have code). These lines restate the rank header. They repeat: one output listed the same `AttributedText` class span 7 times.

## 3. Recurring failure and waste patterns

### P1. Exact token sent through ss-find (about 20% of calls)

68 calls use a regex that is one identifier or one `def X` / `func X` pattern. 59 have the regex equal to a single literal. The median output is 4.5k characters. The median `ss-grep` output is 364 characters.

- `hsmoke-codex-20260925-2342-L4/gitbookio__markup-it-56/r0#11`: `"htmlclean" --regex "htmlclean"` returned 8.3k characters, a 157-line parse function. The agent used none of it.
- `hc-codex-20260929-2000-L2/maxgraph__maxgraph-365/r0#2`: `"isLayer" --regex "isLayer"` returned 11.3k characters. The agent edited the rank 2 method. A `ss-grep` plus a 55-line `ss-read` is about 1.5k.
- The shipped rules cause this. The rules text says: "ONE `ss-grep` on that literal or `ss-find` `\b<symbol>\b`".

### P2. Confirmation probe: code the agent already holds (34% of calls, 41% of characters)

113 of 334 calls had at least half of their code lines shown earlier in the same thread. The earlier tool was ss-read (34 calls), ss-grep (27), ss-find (22), ss-search (13). This matches the 31.5% in STATS.

- `hc-codex-20260929-2038-L3/rokucommunity__brighterscript-1050/r0#2`: `ss-find "IndexedGetExpression"` right after an `ss-search` that showed the same chunks (100% of lines). The next `ss-read` came back: "[unchanged reread omitted; ... already shown 3 sweet-search calls ago]".
- `hsmoke-claudecode-luna-20260926-1000-L4/mwouts__jupytext-360/r0#5`: `ss-find "pipe_notebook"` after the agent had read `cli.py` lines 515-580. The next action was the edit.
- `hsmoke-claudecode-luna-20260926-1000-L4/superlistapp__super_editor-2516/r0#18`: 11k characters for names the agent already held. Four edits followed.
- Why it happens: (a) the exact-token rule in P1; (b) a re-probe after a failed concept hunt (the `h2x` token was probed again and again in the svgr task); (c) `ss-read` has an exact-reread omission, but `ss-find` and `ss-search` do not.

### P3. Wide-net regex, large -k, long summary tail

The agents ask `-k 20` in 142 of 334 calls (default is 6) and `-k 30` or more in 56 calls. The median output is 2.2k characters for -k 5 or less, 5.2k for 6-12, 6.1k for 13-20, and 10.2k above 20.
The regex is often a set of generic words (`style|css|text`, `function|export|plugins`, `html|HTML|markdown`). Such a regex matches almost every chunk, so the rank order carries little signal.

- `hsmoke-claudecode-luna-20260925-2153-L4/gitbookio__markup-it-56/r0@side:a7f71669#6`: `-k 100` returned 20.2k characters with 97 summary-only entries. The agent read one file next.
- `hc-opencode-20260929-2143-L3/superlistapp__super_editor-2516/r0#12`: regex `CHANGELOG|changelog|pubspec\.yaml|version` returned 12.3k characters of unrelated example-app code. The agent ignored it.
- `hc-opencode-20260929-1714-L1/smooth-code__svgr-10/r0#5`: regex `function|export|plugins`; every code line had been shown before.

### P4. Regex used as a file-name filter, and empty results (12.5% of calls)

`--regex` matches file content, not paths. Agents write paths into it. 28 calls have a path-shaped regex. 16 of the 42 empty results come from this.

| empty-result cause (42 calls) | calls |
|---|---|
| true negative: the word `style` does not exist in the indexed svgr source (the dependency is in `node_modules`, not indexed) | 19 |
| path or file-name regex | 16 |
| vendored code is not indexed | 2 |
| guessed phrase used as regex | 5 |

- `hsmoke-opencode-20260926-1928-L1/superlistapp__super_editor-2516/r0@side:DCQDKh#15`: regex `attributed_text/test/.*\.dart$`.
- `hsmoke-claudecode-luna-20260925-2153-L4/gitbookio__markup-it-56/r0#17`: regex `input\.md|output\.yaml`.
- The empty output is 160-220 characters, so the character cost is small (0.4% of output). The cost is the wasted round. After an empty result the agent called ss-read (12), ss-grep (8), ss-find again (6), ss-search (4), or a native tool.
- The agent cannot tell "regex matched nothing" from "query found nothing". The output says only `(no matches)`.
- For vendored code, `ss-grep` prints "(not indexed ...)". `ss-find` does not (`hc-opencode-20260929-0612-L3/zmap__zlint-299/r0#19`).
- The true-negative case is a good result. It is partly useful (the agent used the absence in `hsmoke-opencode-20260926-0648-L2/smooth-code__svgr-10/r0@side:OzqQ6Y#11`).

### P5. `--in` scope not honoured, and `--help` not accepted

Of 29 non-empty calls with `--in`, only 7 returned entries all inside the scope. 22 returned entries outside it. 13 of those come from one Claude Code sub-agent that used a git worktree path.

- `hsmoke-claudecode-luna-20260926-1000-L4/fastify__fastify-cors-285/r0@side:aa772832#47`: `--in .../test/preflight.test.js` returned `vary.js`, `benchmark/vary.js` and `index.js`. This sub-agent made 30 ss-find calls, many of them rewordings of the same query. I labelled this call, `...aa772832#42` and one markup-it sub-agent call "harmful": the output looks scoped, and it is not.
- `ss-grep` prints "(scope not found ...)". `ss-find` stays silent.
- `ss-find --help` exits with code 2 and a usage line (4 calls; `hsmoke-claudecode-luna-20260925-2153-L4/gitbookio__markup-it-56/r0@side:aa7b666b#11` tried `--help` on four tools in one response).
- `--regex '.*' --in <dir>` (23 calls, all Claude Code sub-agents) is a directory-scoped semantic search. `ss-search` has no `--in`. This is the only job where ss-find has no cheaper substitute, and it is the one that failed in worktrees.

### P6. Header and chunk mismatch

- `hsmoke-codex-20260925-2342-L2/jensneuse__graphql-go-tools-174/r0#15`: rank 1 header says `[struct: FieldDefinition]` but the code shown is `PrintDirective`. The agent ignored the result.
- Opus jupytext (P1): the chunk opens 27 lines before the matched `def`.
- Rank-1 code often opens with a licence header (the first lines of `util/ca.go` in the 58-line chunk).

## 4. Does the agent understand the tool?

Mostly yes for the flags. No for the regex-plus-query split.

- Flags: `--regex` is present in 330 of 335 calls. `-k` is in 325. Syntax errors are rare (4 `--help` calls, no bad flags).
- The split: 118 of 330 queries are one word. In 88 calls the query text also sits inside the regex. In the labelled sample the semantic query almost never added a signal that the regex did not.
- Regex shapes (all 335 calls): literal tokens only 142 (43%), structured or generic-word regex 136 (41%), path-shaped 28 (8%), `.*` 23 (7%), none 5.
- Agents treat the regex as a net, as a file filter, or as the query repeated. They do not use it as a precise filter. They do not read the header meta.
- Next action after the 74 labelled calls: drill down 37, answered or edited 12, native fallback 9, switched ss tool 8, re-searched with ss-find 8.

## 5. Would `ss-grep` plus a narrow `ss-read` have been enough?

For exact-token calls (68, about 20%): yes. Estimated saving per call: about 3.5k characters (4.5k median output against 364 for `ss-grep` plus about 1.5k for the read). Cost: one more model turn. The lines delivered are the same.

For wide-net and multi-term calls: partly. `ss-grep` returns hits in file order, with no ranking. In 4 of the 11 "yes" calls, ranking was the reason for the success. For path-shaped regexes and `.*`-scoped searches, no: `ss-grep` cannot do them either.

Is ss-find worth a separate tool? My reading:

- Its output format is the ss-search format. It is 5.7% of all amplified tool-output tokens (STATS, section A). Output per call is 1,522 tokens median, larger than ss-search (about 1,200).
- It is rare for Opus (0.8% of rollouts). Luna models use it in 23-41% of rollouts.
- The prompt line for it costs tokens in every run. A `--regex` option on `ss-search` would remove one tool name and keep the capability.
- I cannot say what removing it does to solve rate. This study has no outcome test. Test on the dev set first.

## 6. Product fixes, ranked by (tokens saved x frequency)

Estimates are upper bounds on ss-find amplified characters (output chars x re-reads). The base is 31.8M amplified characters over 334 calls. The effects overlap; do not add them.

| rank | fix | saving | frequency | accuracy risk |
|---|---|---|---|---|
| 1 | Omit code already shown in the same thread from ss-find and ss-search blocks. Print one pointer line: `path:range already shown in call N`. Reuse the ss-read rule. | up to 27% | 34% of calls | Low. Risk: if the harness drops the old output, the pointer leaves a gap. Same risk as ss-read today. |
| 2 | Cut summary-only entries beyond rank 5. Drop entries that repeat the same span. Keep ranks 4-5 as one-line `path:range symbol`. Cap `-k` at 20. | 21-25% | 84% of entries; 52% of calls with -k 20 or more | Low to medium. Summary lines were the file pointer in 21% of calls (rank 4 most). Check on the dev set. |
| 3 | Change the rules text: exact token goes to `ss-grep`, then a narrow `ss-read`. Remove "or `ss-find` `\b<symbol>\b`". Say that `--regex` matches file content, not file names. | up to 16% | about 20% of calls | Low. One extra turn per lookup. |
| 4 | When a literal or `def X` regex has few hits, return only the matched span plus 3-5 lines, not the whole chunk. Drop the licence or imports block. | 3-5k per exact call; overlaps with 3 | about 20% of calls | Low. Keep the full chunk when the regex is structured. |
| 5 | Diagnose zero results. Say how many lines the regex matched. Say "regex looks like a path: use `--in`". Say "not indexed: vendor/..." as `ss-grep` does. Honour `--in`, or print "scope not found". Accept `--help`. | few characters; saves rounds and stops sub-agent loops (one loop was 30 calls) | 12.5% of calls empty; 22 scope leaks | None. |
| 6 | Drop `### imports`, `### related`, `budget= used=`, `score=` from the default ss-find output. | about 6-7% | every call | Low. Never used in the 74 labelled calls. Related lines may help a harness that I did not see. |
| 7 | Make the `sufficient=` verdict act, or remove it. It does not change what the agent does. | about 1% | every call | None if removed. |
| 8 | Header symbol must name the matched symbol, not the chunk label. | small | rare (3 of 74) | None. |

## 7. Limits of this study

- All 335 calls come from 12 tasks. The task `smooth-code__svgr-10` holds 74 calls (22%). It is a task where the key word is absent from the indexed tree, so it inflates the empty and wide-net counts.
- Labels use visible text and the next actions. Opus text is empty. Codex thinking is encrypted.
- The "touched in the next 4 calls" test is generous: it counts a file as used if any later call names it. The true waste share is probably higher than 84%.
- The harness mix is skewed to opencode-luna (165 calls) and claudecode-luna (107). Opus and codex have few rows.
- No outcome is tied to any proposal. The rank order is by token effect only.
