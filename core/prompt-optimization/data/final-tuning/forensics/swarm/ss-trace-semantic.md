# ss-trace and ss-semantic forensics (group `ss-trace-semantic`)

## Conclusion

Keep both tools. Change the output of both. Do not remove either.

- ss-trace helps in about 1 call in 9 (sample). It helps when it lists the real calling functions of a symbol. In every other case it costs tokens and sends the agent to ss-grep or ss-read.
- ss-semantic helps in about 1 call in 3. It helps when the query names a method and the file is large. It fails when the query is long natural language on a big file, or when the file is the wrong one.
- Together they are small: each is 0.2% to 1.5% of all amplified tokens per harness. Cleaning them saves little. The accuracy question matters more than the token question.
- This data cannot explain the Codex loss of 1.9 points when ss-find, ss-semantic and ss-trace were removed together. The data holds only fix-a-bug tasks, from 13 repositories. It holds no retrieval questions. See "What the data cannot tell".

## Method

- Population: 192 calls (138 ss-trace, 54 ss-semantic) from 13 tasks. Two tasks hold half of all calls: bingo-271 (53 calls) and brighterscript-1050 (43 calls).
- Sample: all 13 Opus calls, plus 67 calls drawn at random with seed 42. The draw was stratified by tool and harness. Total 80 calls (56 trace, 24 semantic). 44 of 80 come from baseline or max style variants. The rest come from prompt variants. Tool output does not change between variants.
- I read each call: the full output, the text before it, and the next four calls. I also ran deterministic counts over all 192 calls. These counts are marked "population" below.
- Labels: `swarm/ss-trace-semantic.labels.jsonl` (80 lines). Each line also holds `variant` and `task`.
- Caution: the labels are my judgement. Thinking text is empty for Opus and encrypted for Codex. I judged from visible text and next actions.

## Usefulness rates (sample)

| tool | n | yes | partly | no | harmful |
|---|---|---|---|---|---|
| ss-trace | 56 | 6 (11%) | 7 (12%) | 43 (77%) | 0 |
| ss-semantic | 24 | 9 (38%) | 4 (17%) | 11 (46%) | 0 |
| both | 80 | 15 | 11 | 54 | 0 |

No call was harmful in the sense of a wrong answer. One message was misleading (see pattern 6).

By model:

| group | n | yes | partly | no |
|---|---|---|---|---|
| Opus ss-trace | 6 | 0 | 0 | 6 |
| Opus ss-semantic | 7 | 4 | 1 | 2 |
| Luna ss-trace (3 harnesses) | 50 | 6 | 7 | 37 |
| Luna ss-semantic (3 harnesses) | 17 | 5 | 3 | 9 |

By ss-trace mode (sample): callers 6 yes, 4 partly, 24 no (n=34). callees 0 yes, 2 partly, 11 no (n=13). impact 0 yes, 1 partly, 6 no (n=7). Only callers mode produced a yes, and only when real caller edges existed.

Population view of ss-trace (n=138):

I classed each call by the requested section in its output (the `callers`, `callees` or `impactPaths` count in the META line), not by the `fan-in` header. The header can say `fan-in=0` while the callers section lists real callers (same-file scan, or `--in` on the real definition).

| result kind | calls | share of calls | share of output chars | share of amplified tokens |
|---|---|---|---|---|
| requested section has rows | 61 | 44.2% | 77.1% | 68.4% |
| ambiguous name, picked a test mock, section empty | 44 | 31.9% | 16.8% | 21.9% |
| symbol not found | 16 | 11.6% | 1.5% | 1.5% |
| section empty, name not ambiguous | 10 | 7.2% | 4.6% | 8.2% |
| shell or tool error, no output seen | 7 | 5.1% | 0 | 0 |

So 77 of 138 ss-trace calls (55.8%) return nothing the agent can use. STATS counted only 11.6% as empty, because it did not count the ambiguous-name case or the section-empty case. 42 of the 44 ambiguous-empty calls are one task (bingo-271), but the defect is general: it hits any symbol that has both a real definition and a test stub. Without bingo-271, 41 of 96 calls (43%) are still unproductive.

Callers mode (85 calls): 28 had caller rows (33%), 44 hit the ambiguous test mock, 7 had an empty section, 5 not found, 1 error. Callees mode (31 calls): 22 had rows, and 11 of those 22 held only external callees (library or standard-library calls). 6 calls used brackets as in the usage line; the shell rejected them (see misuse).

Next call after an unproductive trace (population, n=77): ss-grep 39, ss-read 22, run_tests 4, ss-search 2, ss-trace 2, an edit 2, other 6. The agent followed the hint in the output ("map its sites with one broad ss-grep") in half of the cases. That is cheap, but it is one wasted call and one wasted turn each time. After a trace that had rows (n=61): ss-read 22, ss-grep 14, edit or patch 12, todowrite 5, other 8. So 12 of 61 were followed at once by an edit, and the output was not used.

ss-semantic population (n=54): 43 calls return one span, 9 return two, 2 return an error or nothing. 20 of 54 hit the 600-token cap. 12 of 54 start at line 5 or earlier (file head, imports or class prologue). No call used `--max-tokens`.

## Which output parts the agent used and ignored

ss-trace output has these parts. Counts are from the 56 reviewed calls.

| part | used | ignored or redundant | note |
|---|---|---|---|
| callers section (names, lines) | 9 | 7 | used only when it named a function in a file the agent then read |
| callers with code bodies | 2 | 7 | bodies of 2 callers cost 3.7k chars; agents read the file anyway |
| fan-in count | 5 | - | used in state summaries ("two callers pass cells"), never followed |
| callees section | 3 | 6 | mostly external calls (log.fine, Map.from, Popen, subprocess) |
| impact rows | 1 | 4 | repeats callers three times (cues, critical paths, rows) |
| `answer checklist` and `answer cues` lines | 0 | 56 | never quoted by any agent; restates the section |
| `critical paths` line | 0 | 56 | never quoted; often lists unrelated hops |
| `ambiguous ... alternatives:` line | 0 | 16 | the real definition was named and never used |
| `SS_TRACE_META` JSON line | 0 | 56 | machine data in the model context |

Share of ss-trace output chars that are not the requested section (population, content outputs): the answer lines are 31.8% and the META line is 7.5%. Over all non-error outputs the figures are 34.8% and 12.7%. Together this is 39% to 47%.

My waste estimate: ss-trace 86% of output chars (110,750 of 129,005 in the sample). ss-semantic 64% (32,350 of 50,734). Treat these as upper bounds. They are my estimates, not a measured count.

ss-semantic parts: the span code was used in 13 calls and ignored in 16. Line numbers and trailers were never an issue. The waste is in what the span contains. A span often holds a class prologue, an import block, a neighbour function, or the start of a long function that stops before the matching lines.

## Recurring failure and waste patterns

### 1. ss-trace picks the wrong definition for an ambiguous name (44 population calls, all with an empty section; 42 are one task)

The output says `ambiguous: using first match; alternatives: ...`. The first match is a test mock (`vi.mock` stub). The tool then reports 0 callers and 0 callees. The real definition is named in the same output and is ignored by the tool.

- `hc-codex-20260929-1523-L1/joshuakgoldberg__bingo-271/r0#3`: output `fan-in=0 fan-out=0 ... runModeTransition.test.ts:84-86`. The agent ran `ss-grep "logRerunSuggestion" -k 20` next.
- `tg-20261001-0657-v2-L1/joshuakgoldberg__bingo-271/r0#4` (Opus, shipped build 2.8.2): same output. The agent read the real files by hand.
- `hc-claudecode-20260929-0423-L1/joshuakgoldberg__bingo-271/r0#3` (Opus): the agent dropped to native `cat` after the grep.

All 6 Opus ss-trace calls are this case. When the agent passed `--in <real file>` the same task gave 11 real callers in 2 files, and the agent read both (`...-1100-L1/...bingo-271/r0#3`, `...-2014-L3/...r0#4`). That is the best use of ss-trace in the data.

### 2. `--in` points at the file that uses the symbol, not the file that defines it (14 of 16 "not found")

`No indexed symbol found for "IndexedGetExpression".` appears when `--in src/parser/Parser.ts` is given for a class defined in `Expression.ts`. The same happens for an import alias (`h2x`).

- `hc-opencode-20260929-1714-L3/rokucommunity__brighterscript-1050/r0#8`: dead end, 324 chars, then ss-grep.
- `hc-opencode-20260929-2126-L2/...brighterscript-1050/r0#9` and `hsmoke-claudecode-luna-20260926-1525-L1/...brighterscript-1050/r0#21`: same mistake in other runs.
- `hsmoke-claudecode-luna-20260926-1525-L2/smooth-code__svgr-10/r0@side:a0531a09#4`: `h2x` is an import binding, not a symbol.

The call is cheap (about 300 chars). The cost is one wasted turn. The rules text says `--in <file>` without saying that it must be the defining file.

### 3. Callers mode returns zero for classes, structs and visitor functions; callees and impact return noise

In callers mode, 51 of 85 calls (60%) returned an empty callers section (44 of them the mock case). Class targets show it clearly: `IndexedGetExpression` returned `callers (0)` in 5 of its 18 trace calls (the others used callees or impact, or hit not-found). The real construct site (`new IndexedGetExpression` at Parser.ts:2455) is a call edge that the index does not hold. `FieldDefinition` (a Go struct) also returned nothing.

Callees mode on a leaf function lists library calls:

- `hc-opencode-20260929-0108-L3/superlistapp__super_editor-2516/r0#5`: callees of `copyAndAppend` are 5 rows of `_log.fine (external)` and `Map.from`. The agent read the file next.
- `hsmoke-codex-20260926-0518-L3/mwouts__jupytext-360/r0#3`: impact of `pipe_notebook` is 64 paths, mostly `Popen`, `communicate`, `split`.

### 4. Output has the same facts three or four times, plus machine metadata

For a 2-caller symbol the output is 5.5k chars. The header lines `answer checklist`, `answer cues` and `critical paths` come first. Then `mode=callers - showing only this section`. Then the section. Then a JSON `SS_TRACE_META` line. The mode flag does not filter the header: a `callees` call still prints the callers cue line.

- `hsmoke-claudecode-luna-20260926-1000-L1/maxgraph__maxgraph-365/r0#3`: 5,572 chars for `isLayer callers`. The agent used one fact (two callers exist) and then read the 3-line function with `ss-read 380 415`.
- `hc-codex-20260929-1557-L3/superlistapp__super_editor-2516/r0#3`: 6,420 chars for `copyAndAppend impact`. Agent quote: "The mapping confirms copyAndAppend() is widely used". It opened none of the 5 listed callers.
- Five runs of the same maxGraph task received the same 5.5k output and edited the same 3-line method.

### 5. ss-semantic returns a wrong or prologue span for long natural-language queries on large files

On brighterscript `Parser.ts` (3,370 lines) the population has 13 calls. 8 contained the `indexedGet` method or its call site. 5 did not. The wrong spans were: class fields 99-132, class head 99-243, function parameters 881-936, throw and dim statements 1695-1748, an unrelated method 2727-2777. Two more calls returned the class fields as span 1 and the right call site as span 2.

- `hc-opencode-20260929-1714-L3/...brighterscript-1050/r0#6`: query "parse postfix bracket indexing, optional chaining, and comma-separated indexes" returned `throwStatement`. Agent thinking: "the search doesn't seem to return the expected results".
- `hsmoke-codex-20260926-0518-L4/...brighterscript-1050/r0#4`: returned the class field block. Agent switched to `ss-grep "openingSquare"`, then `ss-read` three ranges.
- `hc-codex-20260929-1618-L2/...brighterscript-1050/r0#17`: returned the import block `BrsFileValidator.ts:1-16` as the best span.

The good case: `hsmoke-claudecode-luna-20260926-1000-L2/rokucommunity__brighterscript-1050/r0#3` and `hc-codex-20260929-1542-L3/rokucommunity__brighterscript-1050/r0#3` returned `indexedGet` 2435-2480, the first with the call site 2502-2509. Queries with a method-like phrase ("indexed access square bracket") worked. Queries with many concepts did not.

### 6. ss-semantic has no "nothing relevant" answer and one false message

If the file has no good span, the tool still returns a span. The agent then wastes 2.5k chars and a turn.

- `hsmoke-claudecode-luna-20260926-1000-L2/...brighterscript-1050/r0#10`: query about indexed assignment on `Statement.ts` returned `IncrementStatement` and print separators (2,898 chars).
- `...brighterscript-1050/r0#9`: a test file `Call.spec.ts`, 190 unrelated lines.
- Opus `jupytext/formats.py "auto_ext_from_metadata"` (symbol not in the file, 3 runs): returned `read_format_from_metadata` and `guess_format`. Opus ignored it.
- `hc-opencode-20260929-2051-L2/zmap__zlint-299/r0#12`: the message says `file not indexed ... returning whole file via plain read`. The output holds only that message. No file text came back. The agent had to switch to ss-find.

Also: spans can stop before the lines that matter. `jupytext/cli.py` query about `--pipe` returned lines 48-161 and 108-161 of `parse_jupytext_args`. The `--pipe-fmt` lines were after the cut, so the agent read 100-190 next (labels 21 and 64). Files under about 170 lines often come back whole, so the call equals `ss-read` (label 58 `runCLI.ts` 1-63; also `runModeTransition.ts` 1-169 and `parseProcessArgv.ts` 1-52 in the population).

## Did the agent understand the tools and flags

Yes, mostly. The agent chose a suitable tool for the need in 42 of 56 trace calls and 19 of 24 semantic calls (my label `agentUnderstoodTool=yes`). The failures are about arguments, not about intent.

Flag use over all 138 trace calls: `callers` 85, `--in` 69, `callees` 31, `impact` 16, no mode 6. `--query`, `--depth` and `--budget` were never used. ss-semantic: no flag in any of 54 calls.

Misuse seen (sample, 18 of 80 calls):

- Wrong `--in` file (patterns 1 and 2). This is the most common error.
- Literal brackets from the usage line: `ss-trace copyText [callers,callees] --in ...`, `ss-trace h2x [callees] ...` (6 population calls). zsh treats `[callees]` as a glob and fails with `no matches found` before ss-trace starts. The agent never retried the call with a plain mode word. The usage line in the rules text is `ss-trace <symbol> [callers|callees|impact] [--in <file>]`, so the agent copies the brackets.
- Trace on a file name (`"rule-function"`), on an import alias (`h2x`), and on a directory (`--in src`).
- `ss-semantic` on the wrong file for the question (4 calls), and a symbol name as query when the symbol does not exist (3 Opus runs).
- Pre-edit mapping call as a ritual: 19 of 138 trace calls (14%) have the words "mapping" or "siblings" in the text just before them. They follow the rules text "Before editing a symbol with visible siblings ... spend ONE mapping call: ss-trace <symbol>". In several of these the whole edit was inside one file, and the call returned external calls or a count. Examples: sample rows 1, 13, 31, 55 and 62 (line numbers in the labels file, counting from 0).

When the agent does not know the right symbol, it runs trace on the wrong thing. Labels 71 and 78 are two runs where the real need was "find the existing helper for X". The agent used `ss-trace IsSubscriberCert callees` and got 35 unrelated callers.

## Situations where each tool is uniquely good

ss-trace (callers mode, with `--in <defining file>`, on a function):

- Names the calling functions and their lines in one call. For `logRerunSuggestion` it returned `runModeSetup:40` and `runModeTransition:35`. The agent opened exactly those two files (labels 50, 56, 57, 66). A literal ss-grep returned 21 matches in 5 files, tests included.
- In Python the same-file scan printed the one caller with its body. That was the edit site (pytask labels 4 and 46, both solved).
- The fan-in count (8, 35) tells the agent that an edit has wide reach. Agents used it in state summaries. This is the only role of impact and callees that I saw agents use. ss-grep of the stem gives the same count with less text.

ss-semantic (known large file, query close to a method name):

- Returns one method body without line numbers to guess. Opus used it four times on `pipe_notebook` and got the 36-line function at once (labels 9, 32, 40, 54). ss-grep plus ss-read would take two calls, because ss-read needs line numbers.
- Two spans can show both the method and its call site (brighterscript 2435-2480 and 2502-2509, labels 69, 72).
- On a mid-size JS file it returned `onopentag` and `getData`, and the agent followed `getData` (label 25).

Situations where they waste tokens:

- ss-trace on classes, structs, leaf functions, visitor or plugin functions, import aliases, or any symbol with a test stub of the same name.
- ss-trace callees and impact in any single-file edit.
- ss-semantic with a long multi-concept query on a file over about 1,000 lines. ss-semantic on a file under about 100 lines. ss-semantic on a file that is not where the code lives.

Would ss-grep or ss-read have done the same job? Of the 9 semantic yes calls, 4 (Opus, function known by name) need ss-grep plus ss-read: one more call. The other 5 found a method from a description, which ss-grep cannot do without the right word. ss-grep alone would not have done the 6 trace yes calls cheaply, because it lists matches, not the calling function. So the unique value is real but small.

## What the data cannot tell

- The Codex loss of 1.9 points on retrieval questions has no direct evidence here. These runs are bug-fix tasks. In retrieval questions ("what does X call", "how does X dispatch") the callees and impact modes could be the answer itself. My finding that callees gave 0 yes in 13 sample calls is for fix tasks. Do not remove callees or impact on this evidence.
- The loss could also come from ss-find, which has 335 calls (1.7 times the trace and semantic calls together) and is outside this group.
- The 13 tasks repeat across 190 calls. Half the calls come from 2 tasks. The rates above hold for these tasks. They would move on other repositories.
- The sample has 64 of 80 calls from unsolved rollouts. I cannot say whether a trace or semantic call changed a solve. Solve flips need paired runs, not forensics.

## Fix proposals, ranked by expected tokens saved times frequency

Token figures use the population. Trace output is 87k tokens and 1.5M amplified tokens. Semantic output is 30k tokens and 0.58M amplified tokens. Accuracy risk is stated for each fix.

1. **Resolve ambiguous names to the non-test definition, and fall back from a wrong `--in`.**
   - Rule: when several definitions match, rank test files, mocks and fixtures last. Print callers for all same-name definitions, or say "3 definitions, showing the one in `<path>`".
   - Rule: when `--in <file>` holds no definition, search the repository and say which file defines the symbol.
   - Effect: it turns about 44 + 14 dead calls (42% of trace calls) into real results. It saves the follow-up ss-grep call for each. It may also raise accuracy, because the agent would get callers it does not get now. I have no paired run to prove that.
   - Risk: low. Wrong picks in mixed definitions are possible. Keep the alternates line.

2. **Cut the model-facing trace output to the requested section.**
   - Remove `answer checklist`, `answer cues`, `critical paths` and the `SS_TRACE_META` line from stdout. Keep META in a log file. Make the mode flag filter the header too.
   - Effect: 39% to 47% of trace chars, about 0.5M to 0.7M of the 1.5M amplified trace tokens in this data. No agent text cited those lines. The same caller names appear in the section.
   - Risk: low. A prompt variant might rely on the checklist. I saw no such use in 56 calls. Check one held-out probe that reads `key symbols` before shipping.

3. **One row per caller, no bodies by default.**
   - Print `callerName path:line (call lines 95,110,125)` and a one-line snippet at the call site. Do not print full bodies for more than one caller. Drop external and standard-library nodes from callees and impact. If only external callees exist, print one line: "no in-repo callees".
   - Effect: 5.5k chars for 2 callers becomes under 1k. bingo prints the same caller five times. 26 of 138 trace calls print more than 4k chars.
   - Risk: medium for flow questions. Agents on retrieval questions may need caller bodies. Keep a `--full` flag for bodies.

4. **ss-semantic: add a relevance floor and an outline fallback.**
   - If the best score is low, or the query terms match nothing in the file, return "no strong span" and a 5-line outline (top symbol names with line ranges) instead of a wrong body.
   - Never return an import block or a class prologue as a span. Centre the window on the lines that match the query terms, not on the start of the function. Return up to 3 spans when scores are close.
   - Fix the not-indexed message: either return the file head or say "not indexed, use ss-read".
   - Effect: about 20 of 54 calls (37%) return a useless or misplaced span, about 2.5k chars each, and those calls are followed by a second call. It also raises the hit rate on large files.
   - Risk: medium. A floor that is too high will turn near-hits into misses. Test on a dev split before use.

5. **Change the rules text for trace.**
   - Replace "Before editing a symbol with visible siblings ... `ss-trace <symbol>`" with "`ss-trace <symbol> callers --in <defining file>`, or a broad `ss-grep` of the stem". Say that `--in` takes the file that defines the symbol. Say that the mode word is bare (no brackets). Add: "Use ss-trace on functions and methods, not on classes, types or aliases."
   - Replace "Prefer callees over impact" with a rule based on what the agent needs: callers for "who uses X", callees only for "what does X depend on".
   - Effect: removes up to 19 ritual calls (14% of trace calls) and the 6 bracket errors and 14 wrong-`--in` calls.
   - Risk: medium to high. The mapping rule was added to stop agents from fixing only the first site. Hold-out evidence is needed. Do not ship on this data alone. Gate the change by an A/B on fix tasks with sibling sites.

6. **Remove brackets from the usage line in the rules text.** Write `ss-trace <symbol> callers|callees|impact (optional) --in <file> (optional)` or give two plain examples. The tool cannot fix this itself, because zsh fails before the tool starts. Effect: small (6 calls). Risk: none.

7. **Class and struct targets.** For a class, treat `new X(` and `X{` sites as callers. For a type with no edges, print "type: no call edges. Use `ss-grep 'new X'`" instead of the full header. Effect: 6 brighterscript runs plus the Go struct cases. Risk: low.

8. **Do not merge ss-semantic into ss-read now.** It would save one line of tool text. It would also remove the one pattern where Opus uses it as a function-body fetch by name. Revisit after fix 4.

## Per-tool verdict

| tool | verdict | reason |
|---|---|---|
| ss-trace | keep, change output, fix resolution | useful only for real callers; 56% of calls return nothing; output is about 40% to 47% repeated or machine text |
| ss-trace callees, impact | keep, filter externals, do not prefer in the rules text | 0 yes in 20 sample calls on fix tasks; half of the callees outputs hold only external calls; retrieval questions may need them |
| ss-semantic | keep, change ranking and the empty case | works for method-sized queries on large files; fails on long queries and wrong files |
| merge or remove either | no | no evidence that removal saves accuracy; token share is about 1% each |
