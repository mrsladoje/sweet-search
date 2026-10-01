# ss-read forensics: what agents read, and what they used

## Conclusion

- ss-read is accurate and agents use it correctly. It wastes tokens, because most of the text it returns is never used.
- In 77 deep reads, 28 were useful (36%), 27 partly useful (35%), 22 not useful (29%). None harmed accuracy.
- About 81% of the returned characters were not needed (my estimate, 254k of 314k). A script gives the same picture over all 4,964 reads.
- Four causes give most of the waste: reads that start at line 1 of a large file, wide ranges around a small edit, test files, and re-reads of lines already in context.
- The line-number gutter was used in 0 of 52 sampled reads. The `# unread below` trailer was followed exactly in 3 of 41.
- The default range (no start, no end) is not the problem. Only 1% to 11% of calls omit the range. The agents choose wide explicit ranges.

## Method

- Population: 5,369 ss-read calls in `dossiers.jsonl`. 5,162 have a normal output. All four harness and model keys are included.
- Sample: stratified random, seed 42. Strata: harness and model (4) x early or late in the run (turn index below or above half) x small (under 2,000 characters) or large (4,500 or more).
- Rule: at most one call per rollout. At most 7 per task. Base variants were taken first. 74 of 77 rows are base variants (`baseline`, `base-2.8.2`, `product+batch-read6`, `product+batch-read6fs`). 3 rows come from variants (id 72 is one: `max:prompt:gpt+subagents+tools+tooldesc`).
- Coverage: 77 reads, 13 tasks, 48 rollouts. 37 claudecode (17 Opus 5.5, 20 gpt-5.6-luna), 20 codex, 20 opencode. 24 reads are from solved runs and 53 from unsolved runs.
- For every row I read the call, its output, the agent text before and after, the next calls, and the later edits. The edits come from the raw sessions (old text of each Edit, apply_patch hunks, script edits).
- Used characters were measured by a script over all 4,964 reads. A line counts as used when it lies inside a later edit hunk, or when later agent text quotes it or cites its line number. A wider measure adds 10 lines around each hunk.
- Files: labels are in `ss-read.labels.jsonl`. Each row also holds the script numbers (`autoStrictUsedChars`, `autoNeighbourhoodChars`, `autoCodeChars`).
- Limits: the 13 tasks are the task bench pool, not open traffic. Edit detection misses edits made by unusual scripts. Orientation reads have real value that no script can see. For that reason the waste figure is "not demonstrably needed".

## 1. Usefulness (n = 77, deep reads)

| group | n | yes | partly | no | harmful | waste share of chars |
|---|---|---|---|---|---|---|
| all | 77 | 28 | 27 | 22 | 0 | 81% |
| Claude Code, Opus 5.5 | 17 | 8 | 5 | 4 | 0 | 86% |
| Claude Code, luna | 20 | 4 | 9 | 7 | 0 | 84% |
| Codex, luna | 20 | 11 | 5 | 4 | 0 | 69% |
| opencode, luna | 20 | 5 | 8 | 7 | 0 | 84% |
| early in run | 40 | 17 | 10 | 13 | 0 | 82% |
| late in run | 37 | 11 | 17 | 9 | 0 | 80% |
| large output (4.5k+) | 37 | 16 | 13 | 8 | 0 | 83% |
| small output (under 2k) | 40 | 12 | 14 | 14 | 0 | 70% |
| source files | 61 | 27 | 19 | 15 | 0 | 78% |
| test files | 16 | 1 | 8 | 7 | 0 | 92% |
| solved runs | 24 | 12 | 7 | 5 | 0 | 80% |
| unsolved runs | 53 | 16 | 20 | 17 | 0 | 82% |

- "Yes" means an edit, a quote or a decision came directly from the lines read. "No" means nothing from the read was used.
- Next action after the read: 45 answered or edited, 25 drilled down with another read, 7 switched to another ss tool.
- Large reads are useful as often as small ones. They cost about 7,200 characters on average, so they dominate the waste.
- Test-file reads are the weakest group: 1 of 16 clearly useful, 92% waste.

## 2. Characters returned against characters used

Sample (77 reads): 314,215 characters returned.

| measure | share of returned code characters |
|---|---|
| lines inside an edit hunk or quoted (strict) | 2.5% |
| strict plus 10 lines around each hunk | 18.2% |
| my judgement of needed text | 19% (waste 81%) |

Population (4,964 reads, 13.4 million code characters):

| reads of | share of characters | strict used | within 10 lines of use |
|---|---|---|---|
| files edited later in the run | 53% | 5.6% | 29.1% |
| files never edited | 47% | 0.8% | 0.8% |
| all | 100% | 3.6% (with quotes) | 15.6% |

Per harness, strict used and within 10 lines: Opus 7.0% and 25.3%; Claude Code luna 2.5% and 11.6%; Codex 2.7% and 17.8%; opencode 2.5% and 14.2%. Opus edits through python and perl scripts, which the script only partly matches.

How wide are the reads against the edit?

- For 1,596 reads that contain an edit hunk, the median read is 63 lines. The median hunk span is 7 lines.
- The median read starts 20 lines before the first hunk and ends 21 lines after the last hunk.
- 58% of these reads are at least 5 times wider than the hunk span.

Range size (lines, calls with an explicit range):

| key | median | p90 | p99 | no-range calls | no-range share of chars |
|---|---|---|---|---|---|
| Opus | 36 | 76 | 156 | 10.8% | 10.1% |
| Claude Code luna | 56 | 151 | 323 | 5.6% | 4.5% |
| Codex luna | 60 | 168 | 301 | 2.3% | 1.6% |
| opencode luna | 65 | 180 | 595 | 1.1% | 0.7% |

- No-range reads cover a median of 51 to 58 lines and never more than 373 lines. A default window changes at most 10% of Opus characters and under 5% for luna.
- The luna agents ask for ranges like `1 180`, `1 190` and `1 240` even on files of 13 to 60 lines. This is harmless.

## 3. Output parts: used and ignored

ss-read has these parts: header, fences, gutter, code, and the trailers `# unread below` and `# unread above`.

| part | share of chars (all) | use seen |
|---|---|---|
| code | 87.4% | used in 49 of 77 reads (partly or fully) |
| gutter | 6.9% (0% on Codex, 8% to 10% elsewhere) | 0 of 52 sampled reads |
| `# unread below/above` trailers | 3.2% | exact continue in 3 of 41 sampled reads; about 5% over all reads |
| header | 2.0% | none needed |
| fences | 0.5% | none needed |

- Gutter evidence: agents edit with the old text (Edit, apply_patch), not with line numbers. Final answers cite line numbers in 39% of Codex runs (no gutter) and 28% of Opus runs. Those numbers come from ss-grep and ss-search output, not from the gutter.
- Trailer evidence: after a trailer, a later read of the same file past the window follows in 22% (Opus) to 44% (Claude Code luna) of cases. The agent almost never uses the printed continue range. It picks its own range (exact match about 0.5% Opus, 2.5% Claude Code luna, 7% opencode, 11% Codex).

## 4. Re-reads of lines already shown

Share of ss-read code characters that an earlier ss tool call had already shown in the same run:

| key | share | source of the earlier copy |
|---|---|---|
| Opus | 0.1% | almost none |
| Claude Code luna | 13.3% | ss-read 225k, ss-search 93k, ss-find 13k |
| Codex luna | 6.8% | ss-search 121k, ss-read 91k, ss-find 10k |
| opencode luna | 7.0% | ss-search 290k, ss-read 100k, ss-find 51k |
| all | 7.5% | |

- In Claude Code luna, 185 of 1,182 reads (16%) repeat only lines that an earlier ss-read had shown. In opencode it is 52 of 2,044. In Codex it is 42 of 1,220.
- Codex prints a short omission note instead of the code in 43 reads: "unchanged reread omitted; ... use --force". No Claude Code or opencode output shows this note.
- Cause (code reading): the omission needs a session id. The id comes from `CODEX_THREAD_ID`, `CLAUDE_SESSION_ID` or `SWEET_SEARCH_SESSION_ID` (`core/search/agent-span-ledger.js`). opencode has no source for an id. In these Claude Code bench runs the id was not present either. I did not verify the environment of the runs. The data shows the effect only.
- The agent does not "see" its earlier copy. Examples: a 36-line range re-read 25 calls after the same lines were shown inside a wider read (`hsmoke-claudecode-luna-20260926-1000-L4/rokucommunity__brighterscript-1050/r0#30`), with no context compaction (only 17 calls before).

## 5. Recurring waste patterns

### A. Head-of-file read of a large file (about 36% of read characters)

- Definition: the read starts at line 1, covers 60 or more lines, and the file has 150 or more lines.
- It is 3.4% of Opus calls (9% of Opus characters). It is 11.5% to 19.3% of luna calls and 27% to 44% of luna characters.
- Only 9% to 17% of that text lies within 10 lines of any later use.
- In 86% to 96% of these reads, an earlier ss-search, ss-find or ss-grep had already named the file and a hit line. The agent still read from line 1.
- 19% to 23% of these reads are followed within 7 calls by a read deeper in the same file.
- If the window started 15 lines before the first known hit and was at most 120 lines, it would remove 49% to 54% of these characters (luna keys).
- Examples:
  - `hsmoke-claudecode-luna-20260925-2153-L4/jensneuse__graphql-go-tools-174/r0#3`: `ss-read ... 1 180` on a 1,367-line file. The next reads are 180-275 and 300-370. All edits lie past line 180. Quote: imports and type declarations only.
  - `hc-codex-20260929-1557-L1/superlistapp__super_editor-2516/r0#3`: lines 1-180 of 819, 7,132 characters. No edit and no quote falls inside it.
  - `hsmoke-codex-20260926-0518-L4/maxgraph__maxgraph-365/r0#2`: lines 35-75 (import and class doc block). The target method is at line 401. Next read: 385-415.

### B. A wide window where one site, or a grep, would do

- Example: `hc-claudecode-20260930-0022-L2/superlistapp__super_editor-2516/r0#2`. Opus read 661 lines (28,034 characters) at turn 2 of 8. It then edited blind with `perl -0pi` and ran `ss-grep "_text\.length"`. About 115 characters were used. The grep returned the same sites in about 300 characters.
- The same task shows a scan-by-reading habit in luna agents. Codex read 1-180, 60-185, 240-300, 400-520 and 680-720 of one 819-line file to find 7 sites of one token. `ss-grep` lists all 7 in one call (`hc-codex-20260929-1523-L1/superlistapp__super_editor-2516/r0#5`: "state_summary already names the file; next reads 240-445 and 680-725").
- Opus reads a whole 154-line file (6,314 characters) in four runs to edit one 3-line function (`hc-claudecode-20260929-1321-L3/zmap__zlint-299/r0#2` and three more). The edit hunk is 163 characters.
- Over 1,596 reads that contain an edit, the median read is 6.7 times wider than the hunk span.

### C. Test files read for conventions (about 19% of read characters)

- 17% of calls and 19% of characters (luna keys 17% to 24%) read test or spec files. Only 2% of such reads are followed by an edit of that file. 0.9% to 3.1% of their lines lie near any use. Source files reach 14% to 27%.
- Sample: 16 test reads, 1 yes, 8 partly, 7 no, 92% waste.
- Examples: `hsmoke-claudecode-luna-20260926-1000-L1/rokucommunity__brighterscript-1050/r0#17` (whole 284-line spec, 12,061 characters; nothing used). `hc-codex-20260929-1542-L1/fastify__fastify-cors-285/r0#5` (lines 1-190; no edit, no quote). `hc-opencode-20260929-0647-L1/fastify__fastify-cors-285/r0#9` (whole 362-line file; about 30 lines mattered).
- Counter-example: in two fastify runs the test read gave a real contract ("existing tests confirm the compatibility constraint: adding an unconditional `OPTIONS /` route would collide", id `hc-opencode-20260929-2126-L1/fastify__fastify-cors-285/r0#7`). So a test read can matter. One grep for the symbol in the test file would have given it for less text.

### D. Re-reads of lines already in context (7% of characters)

- Examples: `hsmoke-claudecode-luna-20260926-1000-L1/mwouts__jupytext-360/r0#3` (1,284 of 1,472 characters already shown; state_summary already named the line). `hsmoke-claudecode-luna-20260926-1000-L4/fastify__fastify-cors-285/r0#23` (range 68-96, 100% shown earlier by ss-search and ss-read). `hsmoke-claudecode-luna-20260926-1000-L1/joshuakgoldberg__bingo-271/r0#104` (turn 59 of 63, 100% shown earlier).
- See section 4 for the cause.

### E. Small sibling surveys (low cost, many calls)

- In the svgr task, three harnesses read 4 to 6 tiny plugin files in a row (11 to 22 lines each). The fix discipline text says to read at most two examples. Cost per call is under 400 characters. Total effect on tokens is small.

## 6. Does the agent understand the tool?

- Right tool for the need: 77 of 77 rows. No ss-read call used a wrong flag. ss-read has no flags. The problem is the size of the range, not the choice of tool.
- Common mistakes:
  - A path that does not exist (ENOENT): 118 of 5,369 calls (2.2%). The error text points to ss-grep and the agent recovers.
  - A file the index excludes (build output, snapshot, dot file): 27 calls. The tool refuses and says to use a native read.
  - Requests past the end of file (for example `1 240` on a 214-line file): common and harmless.
  - A guess at a start-count pair is accepted by the tool and treated as a range.
  - Codex only: 5 shell start-up failures printed "No such file or directory". These are environment errors, not agent errors.
- Parallel reads in one command are normal: 82% of Opus ss-read calls and 22% to 78% of luna calls share a command with another ss call. This is efficient for call count. It makes each wide range cost more, because all outputs enter the context at once.

## 7. Fix proposals, ranked

Savings are shares of the amplified characters (characters x later requests that re-read them) of ss-read. ss-read is 20% of Opus amplified tool output and 43% to 48% of luna amplified tool output. The estimates are counterfactuals on the existing runs, so agent behaviour is assumed not to change. The fixes overlap and cannot be added.

1. **Soft cap and anchor for wide ranges.**
   - Return at most about 120 lines per call and print the existing continue line. Add one rule line: when a search named the file, start near the hit line and do not start at line 1 of a file longer than 150 lines.
   - Saving: 14.8% amplified at a 120-line cap, 2.4% of it refetched, so 12.4% net. A cap of 80 lines gives 22% net, but 7.4% of reads then need one more call.
   - Calls added at 120 lines: 217 reads of 4,964 (4.4%) had edit-relevant lines past line 120.
   - Risk to accuracy: low to medium. The code history records a widen-thrash hazard for capped ranges. Test with a micro-smoke on luna harnesses first. Keep Opus unchanged, because it rarely reads wide (3% of reads above 120 lines).
2. **Test-file discipline.**
   - Rule text: to learn a test convention, `ss-grep` the tested symbol in the test file and read about 40 lines around the match. Never read a whole test file.
   - Saving: tests are 18.9% of amplified characters. Cutting them by two thirds gives up to about 12%. Real compliance will be lower.
   - Risk: medium. Tests carry contracts (the fastify case). Hidden tests may follow test conventions. Check with a held-out style gate before shipping.
3. **Omit lines already shown, for every harness.**
   - Extend the exact-reread omission to partial overlap, and make sure a session id exists in Claude Code and opencode runs.
   - Saving: 7.0% amplified overall (9.0% for Claude Code luna).
   - Risk: low, because `--force` already exists. One case needs care: an agent whose context was compacted. Keep the note short and name the earlier call.
4. **Drop the line-number gutter for harnesses that do not use it.**
   - Saving: 7.8% amplified overall. It is 8.1% for Opus, 9.7% for Claude Code luna and 8.9% for opencode. Codex already has none.
   - Evidence: 0 of 52 sampled reads used it; Codex shows no gutter and cites lines as often as the others.
   - Risk: medium and unmeasured. The gutter was added for exact-span edits and to match the native Read tool. Run one A/B on the Claude Code and opencode legs before any change.
5. **Shorten the trailers.**
   - Print only the continue command, without the symbol list. The symbol list is 3.2% of characters in total and about half of it is the list.
   - Saving: about 1.5% amplified. Risk: low. The list may guide a later `ss-grep`; no evidence for that was found.

Not recommended: changing the no-range default window. It covers under 5% of luna characters and 10% of Opus characters, and those reads are small files (median 51 to 58 lines). The parked `SS_READ_WINDOW` default would change little.

## 8. Notes for other groups

- ss-grep crash: id `hsmoke-opencode-20260926-0002-L1/jensneuse__graphql-go-tools-174/r0#15` is followed by `ss-grep "type Transformation\|Transform(data" -k 20`. The output was `[ss-*] crash: Error: ripgrep failed (code 2)`. The unescaped `(` in a basic-regex alternation looks like the cause. This belongs to the ss-grep group.
- The same first call repeats across runs. Opus runs read `lints/lint_ct_sct_policy_count_unsatisfied.go 1 160` first in all four sampled zlint runs. Treat these rows as one behaviour, not four independent samples.
