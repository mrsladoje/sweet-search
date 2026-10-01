# ss-* product output fixes — implementation (branch `ft-fixes`)

**Conclusion.** All approved fixes from `SYNTHESIS.md` and the three Opus reviews are built as
default-off environment switches. With every switch unset, the output of every ss-* command is
byte-identical to `final-tuning`, with one intended exception: the ss-trace usage text (printed only on a
usage error) no longer shows the `[callers|callees|impact]` form. ss-read output does not change under any
switch on any harness; the one deliberate limit is under B1/B2 (see "ss-read proof").

Branch `ft-fixes` (worktree `../sweet-search-ft-fixes`) was created from `final-tuning` @ fe5fe90e and
rebased onto `origin/final-tuning` @ 7d2a44b5 on 2026-10-01. Nothing was pushed to main and nothing was
edited in the final-tuning worktree or the main checkout.

## Bug found in final-tuning (fixed there in fff75887)

`final-tuning` commit 60141293 (variant `SS_VARIANT_SEARCH_DEDUPE`) put `DEDUPE &&` into `cmdFind`, but
`DEDUPE` was a local constant of `cmdAgentSearch`. Result: `ss-find` crashed with
`ReferenceError: DEDUPE is not defined` whenever a result was a summary entry. final-tuning fixed this in
fff75887 by restoring the 2.8.2 ss-find line (`else if (r.summary)`). After the rebase, ft-fixes uses that
same 2.8.2 line, so the two branches no longer differ on it (review finding M6). `DEDUPE` is now a module
constant that only ss-search reads; under the fixed renderer, ss-find ignores it as well.

## Switches (all default off)

| Switch | Fix | Commands | Status |
|---|---|---|---|
| `SS_FIX_A=1` | Umbrella for bundle A: A1, A2, A7, plus A4 and A5 unless their own switch is `0`. **Not A3.** | ss-search, ss-find, ss-trace, ss-grep | test |
| (in A) A1 | One-line header `# ss-search: N results for "<query>"` / `# ss-find: N results for "<query>" /<regex>/`; no score, presentation/kind tag, budget/route header, confidence line, `shown-full:` trailer; compact `# sufficient=YES` (only when YES and a confidence verdict exists); the ss-search route trailer goes to stderr | ss-search, ss-find | test |
| (in A) A2 | Summary-only entries on one line `path:start-end symbol (kind)`; a summary-only entry is dropped only under an earlier entry **with code** that contains it, or under an **identical** span | ss-search, ss-find | test |
| (in A) A7 | The `### imports` block is dropped when the entry's own code block already shows those lines; a shared tail is cut | ss-search, ss-find | test |
| `SS_FIX_TRACE_COMPACT=1\|0` | A4 compact ss-trace + definition resolution. Default: value of `SS_FIX_A` | ss-trace | test |
| `SS_FIX_GREP_RETRY=1\|0` | A5 regex repair per alternative + one case-insensitive retry on zero hits. Default: value of `SS_FIX_A` | ss-grep | test |
| `SS_FIX_ALREADY_SHOWN=1` | A3 "already shown" omission, own ledger namespace (see limits) | ss-search, ss-find (ss-read, ss-semantic only record) | own A/B, Codex first |
| `SS_FIX_DROP_SUFFICIENCY=1` | Drops the compact `# sufficient=YES` line. Acts only with `SS_FIX_A=1` | ss-search, ss-find | kept in code, **not tested** (review: reject the A/B) |
| `SS_FIX_SUMMARY_CAP=<n>` | B1 at most n summary-only entries; `-k` caps entries. `0` or unset = off | ss-search, ss-find | **REJECTED** (TRIED-LEVERS 1.10); kept off |
| `SS_FIX_ONE_PER_FILE=1` | B2 one entry per file; the kept entry is the file's code entry; others become `also in this file: sym (l.a-b)`. **Compress only; does not reassign code budget** | ss-search | off by default |
| `SS_FIX_GREP_ORDER=1` | B7 source before tests with a test-file quota; at >= 50 hits a line list per file; repeated matched-text column dropped | ss-grep | test |
| (not built) | B3 read cap, B6 fold ss-find into ss-search — **rejected**; B8 grep `-A/-B/-C` — not built (needs data) | — | — |
| `SS_READ_GUTTER=none` (exists) | B4 gutter off — confirmed | ss-read, ss-search, ss-find, ss-semantic | — |

All switches accept `1/true/on/yes`; the two sub-switches also accept `0/false/off/no` to turn their fix
off inside `SS_FIX_A`. A failed bundle guard can then be split with `$0` replays:
`SS_FIX_A=1 SS_FIX_TRACE_COMPACT=0 SS_FIX_GREP_RETRY=0` is A1 + A2 + A7 alone.

Owner decisions 2026-10-01: ss-read output is not changed by any switch; sufficiency is kept in A as the
compact YES line, and dropping it is a separate switch.

## What changed (files)

- `core/search/agent-output-fixes.js` (new): flag parsing, thread key and A3 namespace, test-path test,
  `selectEntries` (A2/B1/B2), the fixed renderer `renderFixedBlocks` (moved here from the wrapper so it can
  be tested), A7 `dedupeImports`, the A3 protocol (`printedSpanCandidates`, `decideAlreadyShown`,
  `readSpansForAlreadyShown`, `resultsForOriginalLedger`), A1 `renderCompactSufficiency`, A4
  `formatTraceCompact` / `alternativesAfterSwitch`, A5 `repairRegexBranches`, B7 ordering and line lists.
- `eval/agent-read-workflows/bin/_ss-helpers.mjs`: wiring only. The original loops run untouched when no
  switch needs the fixed renderer. The ss-trace usage text changed (see Conclusion).
- `eval/agent-read-workflows/bin/ss-trace`: usage comment only.
- `core/search/agent-span-ledger.js`: one new export `collectAgentShownSpansIndexed` (optional `include`
  filter); existing functions unchanged.
- `core/search/grep-output-shaping.js`: `renderGrepBody` got an optional 4th argument; absent = same output.
- `scripts/retrieval-bench-282.mjs`: new row field `ssDeliveredChars` (characters of all ss-* output).
- `tests/search/agent-output-fixes.test.js` and `tests/search/agent-output-fixes-wiring.test.js`.
- `forensics/fixes-verify/*.sh`: the scripts used for the byte-identity runs.

### A1 + A2 + A7 (ss-search, ss-find)

Kept: the one-line query header, rank number on code entries, `file:start-end`, `[kind: symbol]`, `STALE`,
imports (unless A7 drops them), code, related, `# same file`, `# continues at`, family manifest,
`# sufficient=YES`. Dropped: see the table. The one-line header keeps a boundary between chained ss-*
outputs in one shell command (131 of 1,349 recorded commands chain two ss-* calls) and echoes the query of
an empty result. Summary entries become one line without a rank number; a summary whose text says more
than its header keeps that text on a second line.

### A3 — "already shown" (`SS_FIX_ALREADY_SHOWN=1`, not part of A)

- The thread key (`resolveThreadKey`) reads `SWEET_SEARCH_SESSION_ID`, `CODEX_THREAD_ID`,
  `CLAUDE_CODE_SESSION_ID`, `CLAUDE_SESSION_ID`, then `opencode-<OPENCODE_PID>`. The original
  `resolveAgentSessionId` is not changed.
- A3 keeps its receipts under the session id `a3:<thread key>`. The original ledger gets exactly the calls
  it got before (same operation, same spans, same order). So the Codex ss-read omission text ("N calls
  ago"), the `--force` override and the query-aware ss-read trailers are byte-identical with A3 on.
- ss-search / ss-find plan the printed entries first. Only spans of blocks that print (after dedupe,
  one-per-file and caps; a continuation only when its header prints) go to the A3 `read` operation.
- A block is omitted only when the thread saw it within **8** A3-ledger calls. An older copy prints again
  and is recorded again (one extra `observe`).
- The omission line says how to see the lines again:
  `(lines 50-80 already shown above — re-read: ss-read a.go 50 80)`.
- ss-read and ss-semantic only record what they printed in the A3 namespace (their reply is ignored). A
  range the original ledger omitted (Codex) is not recorded; output above 10,000 characters is not recorded
  (the harness may cut it).
- Fail open: no key, no daemon, a bad reply or a changed file prints the code.
- Without `SS_FIX_A`, the `shown-full:` trailer still lists an omitted block; its lines were shown in full
  earlier, so the trailer stays true.

**Limit — subagents (review H1). Not solved; the switch stays default off.** A Claude Code subagent
inherits its parent's `CLAUDE_CODE_SESSION_ID` (verified by the reviewer in a live subagent). opencode
subagents run in the same process, so they share `OPENCODE_PID`. I found no variable that is verified to
differ between a parent and its subagent. A subagent shell in this session shows `CLAUDE_CODE_CHILD_SESSION=1`,
but I could not verify that the parent lacks it, so it is not used. Consequence: on Claude Code and opencode,
a parent can be told "already shown above" about code that only a subagent saw, and the reverse. Codex
`exec` has no subagents, so test A3 on Codex first; on Claude Code or opencode, run it only with subagents
disabled, and count omissions in subagent threads (bar: 0).

Other limits: after context compaction the ledger still counts code the model no longer has (the 8-call
window limits this); output piped through `head` or `grep` counts as shown; ss-search / ss-find output that
the harness cuts is still recorded. With A3 on Codex, each thread uses two of the daemon's 32 ledger
sessions, so more than 16 concurrent threads on one daemon can evict an original session earlier.

### A4 ss-trace (`SS_FIX_TRACE_COMPACT`, in A)

Rows only (`name [type] file:line call@n`), no bodies, no cue lines, no budget/latency line, no importance
numbers. A mode word (`callers`, `callees` or `impact`) prints only that section. External callees are
not listed; one line says how many. Impact paths that end in an external symbol are dropped. Without a mode
word, a one-hop impact path is dropped only if its other end is already a printed row. Ambiguous name: if
the first match is a test file and a non-test alternative exists, the non-test definition is used (one
`note:` line), and the `ambiguous:` line still names the test definition. `--in <file>` with no such
symbol: repo-wide fallback (one `note:` line). The `<<SS_TRACE_META>>` line goes to stderr.

### A5 ss-grep (`SS_FIX_GREP_RETRY`, in A)

- Regex parse error: the pattern is split on top-level `|` (and the GNU `\|`). An alternative that parses
  stays as it is. A broken alternative gets only its broken parts escaped (lone `(` `)` `[` `{` `}`, a
  leading quantifier); if that still does not parse, or it uses look-around / back-references, it is
  searched as literal text. Alternatives are never merged into one literal string (the old build turned
  `a|b{}|c` into one literal and printed a false `(no matches)` for 18 of 49 recorded parse errors).
- Notes: one alternative → `(invalid regex "func(" — searched it as literal text instead)`; otherwise
  `(invalid regex "…" — escaped only the part(s) that did not parse; the header shows the pattern searched)`.
- A repaired pattern with zero hits prints `(no matches — note: the regex did not parse as written; …)`,
  never a bare `(no matches)`. If the repair does not parse either, one hint line and exit code 2.
- A repaired call is not recorded in the original ledger, because with the switch off it crashed before
  recording. So ss-read's query-aware trailers stay byte-identical.
- Zero hits: one retry with `(?i)` and one line `(no case-sensitive matches — showing case-insensitive matches)`.
  No retry when `--in` names a path that does not exist.

### B1 / B2 / B7

- B1 (REJECTED): kept in code, default off, `0` = off.
- B2 (compress only): per file, the entry with code is kept (first by rank); without code, the first entry.
  The others become `also in this file: sym (l.120-140)`. The freed pack budget is NOT re-spent, so a fix
  file that sat in the pack as a summary stays a summary.
- B7: unscoped ss-grep fetches up to 100 files (not k). Source files first; when there are more files than
  k, `round(0.3 × k)` file slots (at least 1) go to test files so test hits never vanish. At >= 50 hits:
  `file: lines 13, 19, 48 (+10 more)` per file (most hits first, at most k rows with the same test quota),
  then one tail line per class for the files beyond k. Below 50 hits: normal lines, but when every shown hit
  has the same matched text, the text column is dropped. Scoped (`--in`) output gets the ordering and the
  text-column rule only. Measure p50/p95 ss-grep latency of the 100-file fetch before shipping.

### B4

`SS_READ_GUTTER=none` removes the line numbers from ss-read, ss-search, ss-find and ss-semantic code
blocks (checked on gin; ss-read already skips the gutter for ranges under 15 lines).

## Samples (gin clone, all numbers are characters of stdout)

**These samples and the measured reductions below come from the build BEFORE the review fixes**
(commits fd34731e..eece884f). After the review fixes: A3 is no longer in A, A1 keeps a one-line query
header, A2 drops fewer entries, A7 is new, B7 prints line lists instead of counts. The numbers were not
measured again: no ss-* command could run during this change (the machine was indexing on the GPU).
Re-run `fixes-verify/battery.sh` and `seq.sh` before any table is quoted.


`ss-search "logger formatter default"` — 2545 → 1600 with `SS_FIX_A=1` (summary part shown):

```
before (calls #3-#10, two lines each)        after (one line each, no rank)
## #3 logger_test.go:150-180 [function:        logger_test.go:150-180 TestLoggerWithFormatter (function)
   TestLoggerWithFormatter] (summary kind=chunk)  logger_test.go:234-285 TestDefaultLogFormatter (function)
   score=0.587                                  .golangci.yml:62-76 formatters (topKey)
logger_test.go:150 — TestLoggerWithFormatter    ...
   (function)
```
Also removed: the two header lines and the `shown-full:` and `route=` trailers.
Top of "before": `# ss-search: routed=hybrid conf=0.95 budget=3000 used=293 results=10 subMode=agent_preview` /
`# confidence=low (many_candidates) sufficient=unknown (evidence_without_margin)` /
`## #1 logger.go:228-233 [function: LoggerWithFormatter] (full kind=full) score=0.600`.
Top of "after": `## #1 logger.go:228-233 [function: LoggerWithFormatter]`.

`ss-trace Next callees` — 1575 → 110:

```
before: # trace Next [method] context.go:188-196 / fan-in=24 fan-out=0 budget=5779/12000 (...) latency=39ms /
        3 'answer checklist' lines, 5 'answer cues' lines / mode=callees — showing only this section; ... /
        ## callees (1) / ### safeInt8 [function] importance=0.368 / safeInt8 [function] utils.go:174 /
        <6-line body in a fence> / <<SS_TRACE_META>>{...}
after:  # trace Next [method] context.go:188-196
        fan-in=24 fan-out=0

        ## callees (1)
        safeInt8 [function] utils.go:174
```

`ss-grep "func("` — before: stack trace `[ss-*] crash: Error: ripgrep failed (code 2): rg: regex parse error` and
no result. After:
```
# ss-grep: 532 total match(es) for /func\(/ across 38 files
(invalid regex "func(" — searched it as literal text instead)
...
```
`ss-grep "abortindex"` — before `0 total` / `(no matches)`; after 13 hits on `abortIndex` with the one-line note.

A3, second identical `ss-search` in the same thread (Claude Code key; after an `ss-read context.go 505 570`):

```
## #1 context.go:507-568 [method: AddParam]
### imports
...
(lines 507-568 already shown above)
# continues at context.go:580 GetQueryArray
(lines 580-584 already shown above)
```

B1 `SS_FIX_SUMMARY_CAP=3` (A off), `ss-search "how does the router handle path parameters"`: 13 entries → ranks 1-5
(3 code + 2 summary) and `(+8 lower-ranked entries not shown)`.
B2 `SS_FIX_ONE_PER_FILE=1`: rank 2 `tree.go:70-78 [method: addChild]` followed by
`also in this file: addRoute (l.135), getValue (l.418), insertChild (l.288)` (ranks 4-6 are gone as entries).
B7 `SS_FIX_GREP_ORDER=1`, `ss-grep "Context"` (988 hits, 28 files): 1232 → 612:

```
# ss-grep: 988 total match(es) for /Context/ across 28 files
# per-file counts (988 hits); first hit shown — list one file's hits: ss-grep "<regex>" --in <file>
context.go:49 (174 matches)
gin.go:51 (18 matches)
...
# test/spec/fixture files: 18 file(s), 776 match(es): context_test.go (452), gin_test.go (72), ...
```
`ss-grep "ServeHTTP" -k 8` (42 hits): `context.go:1298`, `gin.go:661 (+1 more in this file)`, ... test files last.

## Measured reductions (gin, 10 ss-search, 4 ss-find, 8 ss-grep, 7 ss-trace calls; stdout chars)

Per-call table: run `fixes-verify/sizes.sh`. Totals vs the main-checkout code (switches off):

| Class | A | cap=3 | one-per-file | grep-order | all four |
|---|---|---|---|---|---|
| ss-search (10) | −24.4% | −18.3% | −18.2% | 0 | −33.6% |
| ss-find (4) | −10.2% | −1.6% | 0 (not applied) | 0 | −10.4% |
| ss-trace (7) | −77.0% | 0 | 0 | 0 | −77.0% |
| ss-grep (8) | +41.9% | 0 | 0 | −25.0% | −0.1% |
| ss-read (3), ss-semantic (3) | 0 | 0 | 0 | 0 | 0 |

How to read it:
- ss-grep under A grows because two calls changed from "no answer" (crash, zero hits) to a real answer
  (+1262 and +469 chars). That is the point of A5, not a cost. With A5 calls excluded, A leaves ss-grep unchanged.
- ss-trace: 5 of 7 calls are pure format savings (−84.7% on those). `trace4` (+2.6%) and `trace5` (295 → 2626) grew
  because the non-test definition / repo-wide fallback now returns real content instead of a test mock / "No indexed symbol".
- A3 saved nothing on 10 unrelated queries. On a repeat-heavy 11-call thread (search, read, search, find, read, find,
  semantic, read, read, search, search) total output was 45428 (off), 40116 (A, no thread key), 33236 (A, Claude Code
  or opencode key), 30629 (A, Codex key; Codex already omitted some ss-read re-reads). So A3 is worth ~15 points only
  when the agent re-visits the same code; real task rates were 3-4% (ss-search) and ~27% (ss-find) in the forensic study.
- These are characters, not tokens, and one repo. The forensic estimates were 16-34% (ss-search), 27%+ (ss-find),
  ~33% (ss-trace); this run is in the same range for ss-search and above it for ss-trace (heavy symbols with many callers).

## Verification (pre-review build)

1. **Byte-identical off.** Fresh APFS clone of `eval/repos/gin` at `~/ss-ft-fixes-scratch/gin`,
   `SWEET_SEARCH_PROJECT_ROOT` set, own `SWEET_SEARCH_RUNTIME_DIR` (own daemon registry). 35 calls
   (10 ss-search, 4 ss-find, 8 ss-grep, 3 ss-read, 3 ss-semantic, 7 ss-trace; `fixes-verify/battery.sh`).
   Normalised diff (`latency=Nms`, worktree path in stack traces; the "Vocabulary loaded (N terms)" boot line
   in one crash trace is run-state noise): ft-fixes vs main checkout — identical. ft-fixes vs final-tuning —
   identical except the 4 ss-find calls where final-tuning crashes. Same check with a Codex thread key and an
   11-call same-thread sequence (`seq.sh`) — identical, including the existing ss-read omission text.
2. On: samples and numbers above. All with `SS_FIX_*` set explicitly.
3. Tests (inside this worktree, `SWEET_SEARCH_RUNTIME_DIR` isolated, no full suite): new file (28) +
   `grep-output-shaping`, `agent-span-ledger`, `agent-span-client.integration`, `gutter-form`,
   `query-sufficiency`, `ss-argparse`, `agent-bench-policy`, `trace-read-daemon-guards`,
   `query-aware-unread-symbols`, `p7-variants`, `p7-runners`, `ort-thread-sharing` — all pass.
4. The one daemon I started (project root = my gin clone, own runtime dir) was stopped at the end.

## What the rules text must change (only with the matching switch)

`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`:

1. **Sufficiency: no change.** Keep the sentence "On `sufficient=YES`, trust the top ranked result …":
   `SS_FIX_A` prints `# sufficient=YES`. (The earlier instruction to delete it is withdrawn. It would apply
   only together with `SS_FIX_DROP_SUFFICIENCY=1`, which is not going to be tested.)
2. One short sentence for each new line, only when its switch is on: `(lines a-b already shown above — re-read: …)`
   (A3); `also in this file:` (B2); per-file line lists in ss-grep (B7): "list a file's hits with `--in <file>`".
3. A6 from SYNTHESIS (rules text, not code): write `ss-trace <symbol> callers --in <defining file>` and say
   "mode word: callers, callees or impact" — never `[callers|callees|impact]` and never
   `callers|callees|impact` (an agent that copies it runs a shell pipe). Say "regexes match file content,
   not paths" for ss-find `--regex` and ss-grep.

## Risks and limits

- A3: see the A3 section (subagents, compaction, piped output, harness cuts, ledger sessions).
- A3 covers only blocks the daemon packs as `full` and complete. `preview` blocks are always printed.
  ss-read ranges over 256 lines carry no per-line proof, so they cannot cover a later contained block.
- A4 drops the target body and caller bodies; a task that needs a caller's body needs one `ss-read`.
  `isTestLikePath` treats `mock/`, `mocks/` and `testing/` directories as test code (testify's `mock/` is
  product code).
- B2 prints no code for a later hit in an already listed file, even if the daemon had packed it.
- B7 line lists show the first 3 hit lines per file; a later hit line needs `--in <file>`.
- Under A1 the bench metric `ssDeliveredTokens` falls back to chars/4 for ss-search, ss-find and ss-trace
  (the route trailer, budget header and META line are gone from stdout). Compare arms on the new
  `ssDeliveredChars` field instead.
- Not done: the Rust product CLI / MCP server print their own ss-* output (`crates/sweet-search-cli`,
  `core/search/search-server.js` formatting). These switches cover the bench wrappers in
  `_ss-helpers.mjs` only; the shipped path needs the same change and a byte-parity test if a variant wins.
  `STATS` / `ss_parse.py` / `build_dossiers.py` parsers expect the old header lines.
- ss-find regex parse errors are not repaired (A5 covers ss-grep only).

## Review fixes (2026-10-01)

Three Opus reviews (`review/opus-code-review-ft-fixes.md`, `review/opus-review-trace-grep-rules.md`,
`review/opus-review-search-find.md`) and the lead's decisions. Fixed:

| Finding | Fix |
|---|---|
| H1 A3 false claims across subagents | A3 moved out of `SS_FIX_A` into `SS_FIX_ALREADY_SHOWN` (default off). No subagent detection is verified, so none is invented; the limit is documented above. |
| H2 A3 recorded hidden entries | The entry plan runs first; only printed blocks go to the A3 ledger. Under B1/B2 the original ledger also gets only printed blocks (lead decision: option 1). |
| M1 ss-read changed on Codex under A3 | A3 uses its own ledger namespace `a3:<key>`; the original `observe` is kept unchanged. A repaired A5 grep is not recorded (matches the crash path). |
| M2 no recovery from an omission | The line carries `re-read: ss-read <file> a b`; 8-call window; ss-read output over 10,000 characters is not recorded. |
| M3 B2 hid the code entry | B2 keeps the file's code entry; `also` lines carry line ranges. |
| M4 delivered-token metric not comparable | `ssDeliveredChars` added to the bench row; ss-search route trailer goes to stderr under A1. |
| M5 stale doc, sufficiency details | Doc rewritten; `SS_FIX_DROP_SUFFICIENCY` accepts every on-value; the YES line needs a confidence verdict (L6); unit tests added. |
| M6 ss-find line differs from final-tuning | Rebased onto final-tuning; ss-find uses the 2.8.2 line. |
| L1 `SS_FIX_SUMMARY_CAP=0` turned the renderer on | `0` = off. |
| L2 A2 dropped same-name definitions | The same-symbol rule is gone (review 3, item 2). |
| L3 `ambiguous:` line lost after the mock switch | The alternatives list now names the test definition. |
| Review 2: sub-switches | `SS_FIX_TRACE_COMPACT`, `SS_FIX_GREP_RETRY` (inherit `SS_FIX_A`, `0` turns off). |
| Review 2: A5 false "no matches" on alternations | Per-alternative repair; repaired zero-hit line is never a bare `(no matches)`. |
| Review 2: B7 counts removed hit lines; tests vanished | Line lists (3 lines + `(+N more)`); test-file quota of 30% of k. |
| Review 2: ss-trace usage `[callers\|callees\|impact]` | Usage text in the wrapper names each mode word on its own line (README not edited). |
| Review 3: A1 lost the output boundary | One-line query header kept. |
| Review 3: A2 large spans swallowed methods | Only a code entry or an identical span covers a summary entry. |
| Review 3: A7 imports duplicated in code | New, in A. |
| Review 3: B1 / B2 / B6 / sufficiency A/B | B1 marked rejected (kept off); B2 "compress only"; B6 not built; drop-sufficiency kept in code, not tested. |

Deliberately left:

- **L4** opencode key is a PID with no time limit. A3 is default off; the 8-call window bounds the effect.
- **L5** A4 drops the target body and the external-callee count rule. This is the reviewed A4 design; a
  `--full` flag and a call-site line per caller are new features, not fixes.
- **L7** an omitted A3 block keeps its `### imports` block. The imports may not have been shown with it.
- **L8** one extra socket call (at most 500 ms) per ss-read / ss-semantic with A3 on. Output does not change.
- **L9** B7 line-list mode starts at 50 hits even with a large `-k`. Not a defect of correctness.
- **L10 / product parity** the switches exist only in the bench wrappers (see Risks).
- Review 2: "counts mode only when files > k", a 12-line cap per file, and the A5 repair for ss-find
  `--regex` — not asked for by the lead; B7 follows the lead's "up to 3 lines" rule.
- Review 3: keep `# sufficient=no`, keep `#N` on summary lines — optional in the review; not built.

### ss-read proof (static, every switch, every harness)

ss-read prints from two inputs only: `readFile()` and `receiptResponse`, the reply of the ORIGINAL ledger
(`recordAgentToolCall`, session `AGENT_SESSION_ID`). Its code has one new statement,
`recordForAlreadyShown(...)`. That function returns at once unless A3 is effective; otherwise it sends one
`observe` under `a3:<key>` inside `try/catch`, ignores the reply and mutates nothing (the payload builder
copies the spans). So ss-read's text depends only on the ORIGINAL ledger state. That state is changed only
by the `recordAgentToolCall` calls of all ss-* commands. Per switch:

| Switch | Original-ledger calls vs switches off |
|---|---|
| none | identical code path |
| `SS_FIX_A` (A1, A2, A7) | same calls, same spans: A2 drops only summary-only entries, which carry no receipt span (receipts need `presentation: 'full'` and code; continuations attach only to full code entries) |
| `SS_FIX_TRACE_COMPACT` | same record (`symbol` + query hint), before and after the resolution re-runs |
| `SS_FIX_GREP_RETRY` | zero-hit retry: records the original regex, as before. Parse-error repair: no record, as before (the call crashed before recording) |
| `SS_FIX_ALREADY_SHOWN` | same calls, same spans; A3 calls go to `a3:<key>` only |
| `SS_FIX_DROP_SUFFICIENCY`, `SS_FIX_GREP_ORDER` | same calls, same spans |
| `SS_FIX_ONE_PER_FILE`, `SS_FIX_SUMMARY_CAP` | **differs by design:** a code block that the switch hides is not recorded, so a later Codex ss-read prints those lines instead of a false "already shown" (lead decision, option 1) |

Per harness: Codex has an original key, and the table applies. Claude Code, opencode and the no-key case
have no original key, so `recordAgentToolCall` sends nothing and ss-read never omits; A3 adds only the
ignored `a3:` call. One limit stays: with A3 on Codex, more than 16 concurrent threads on one daemon can
evict an original session earlier (32-session LRU shared by both namespaces).

### Verification of the review fixes

- Unit + wiring tests (inside this worktree, isolated `SWEET_SEARCH_RUNTIME_DIR`):
  `agent-output-fixes.test.js` and `agent-output-fixes-wiring.test.js` — 64/64 pass. The wiring file checks
  the fixed renderer against verbatim copies of the original ss-search / ss-find loops (non-compact = the
  same bytes, with and without `SS_VARIANT_SEARCH_DEDUPE`), and runs the A3 protocol through the real
  client payload builder and the real daemon handler: Codex ss-read text identical with A3 on/off (M1),
  hidden B2 blocks not recorded (H2), the 8-call window, the Claude Code path, fail-open. Neighbouring
  files `grep-output-shaping`, `agent-span-ledger`, `trace-read-daemon-guards`, `trace-mode-word`: 89/89 pass.
- ESLint `no-undef` + `no-use-before-define` on every changed file: 0 errors in the changed code (two
  pre-existing `no-use-before-define` hits in untouched lines of `retrieval-bench-282.mjs`).
- Not run: no ss-* command, no benchmark (the machine was indexing on the GPU). The byte-identity battery
  (`fixes-verify/battery.sh`, `seq.sh`) must be re-run against `final-tuning` before the first bench run.

## Product port (2026-10-01): Bundle A default ON

The ss-* tools that `sweet-search` ships ARE `eval/agent-read-workflows/bin/ss-*` + `_ss-helpers.mjs`
(package.json "files"), so the product default and the bench switch run the same code and the same
renderer. `readFixFlags` precedence for Bundle A:

1. an explicit `SS_FIX_A=1|0` (bench reproducibility);
2. else `SWEET_SEARCH_COMPACT_OUTPUT=0|false|off|no` (the product opt-out: every switch off, the previous bytes);
3. else ON: A1, A2, A7, A5, and (second commit) A4.

**Bench consequence:** an unset `SS_FIX_A` now means the product default. A "no-fix" arm must set
`SS_FIX_A=0`. Sub-switch-only arms (`SS_FIX_TRACE_COMPACT=1` alone, `SS_FIX_GREP_RETRY=1` alone) also need
`SS_FIX_A=0` to keep A1/A2/A7 off. A3, `SS_FIX_DROP_SUFFICIENCY`, B1, B2, B7 stay default off (bench only).
`scripts/retrieval-bench-282.mjs` stamps every sweet row with `ssOutput` (`compact`, `legacy` or
`mixed(...)`, from `readFixFlags` of that arm's env). Rows without the field predate the change: never
pool them with `ssOutput: 'compact'` rows. The task-bench runners record no SS_* variants on rows, so they
carry no stamp.

The native `sweet-search "<q>"` agent text (daemon `renderAgentSearchResponse`) uses the same compact
renderer with a `# sweet-search:` header. Its opt-out is read from the DAEMON's environment (inherited
from the process that spawned it); restart the daemon after changing it. MCP output is unchanged.

A5 change in the port: a `|` inside an unclosed group (`app.(get|post`) stays literal (`[|]`) instead of
becoming a top-level alternative that matched every `post`; the engine's "used unchanged" regex-dialect
note is not printed after a repair (it described the wrapper's escaped pattern). See the review below
for the escape form and the retry note.

A4 (second commit): the product default now includes the compact ss-trace. Its section headings use
the full trace's count (every row, plus `N call sites, M distinct callers` when they differ; commit
062997d8), so the heading agrees with `fan-in=` / `fan-out=`; external rows are counted and named in
the `(+N external ...)` line. The native `sweet-search trace` text (daemon formatStructuralContext) is
unchanged.

## Product port review (2026-10-01, after 794ab856)

Fixed in ea94eb35 (tests: `agent-output-fixes*.test.js`, `bundle-a-product.test.js`):

| Finding | Fix |
|---|---|
| A5 repair was not literal-safe. On zero hits the engine's GNU-dialect retry (`regex-dialect.js`) rewrites the backslash forms of `(` `)` `+` `{m,n}` and of the pipe, so it turned the wrapper's escapes back into operators. `ss-grep 'functio\(n)'` printed 3163 hits (every `function`) under "searched it as literal text"; the port's note suppression made this silent. | A repair escape is a one-character class (`[(]` `[)]` `[{]` `[}]` `[+]` `[?]`, and the same for the pipe); the retry never rewrites it. Now: 0 hits + the repaired-no-match note. After a repair the dialect note still prints when the ENGINE retried (its hits are then shown); only "used unchanged" stays suppressed. |
| A2 dropped summaries of lines the agent never saw. "Covered by a code entry" used the entry's `startLine..endLine`, but a body cut at the token cap, a sandwich with elided lines or a preview prints only part of that span. | `shownCodeSpan`: the packer's `shownStartLine/shownEndLine`, or a full body whose line count equals the span (a sandwich only with zero elision). An identical span still drops the summary (the header names it). |
| The daemon's agent text read only `SWEET_SEARCH_COMPACT_OUTPUT`. A legacy bench arm (`SS_FIX_A=0`) got compact `sweet-search "<q>"` text while its `ssOutput` stamp said `legacy`. | `renderAgentSearchResponse` uses `readFixFlags` (same precedence as the ss-* tools). |
| `bundle-a-product.test.js` fixture run could reuse, then `--stop`, another session's daemon: sockets are keyed by project root, not by `SWEET_SEARCH_RUNTIME_DIR`. | Private `SWEET_SEARCH_SOCKET_PATH` / `SWEET_SEARCH_PID_FILE` in the test's runtime dir. |

Checked and found correct: A1 keeps `# <tool>: N results for "<q>"` and `# sufficient=YES` (only with a
confidence verdict); A7 cuts only import lines that the entry's code shows; A4 prints the same caller /
callee rows as the full trace (both print the packed rows; the heading counts every row), keeps the
ambiguous and wrong-`--in` fallbacks; the opt-out paths (`SWEET_SEARCH_COMPACT_OUTPUT=0`, `SS_FIX_A=0`) run
the previous code in the wrappers and in the daemon (unit tests pin the daemon bytes); the rules text
(`p7-final/sweet-search-system-prompt.md`, hooks) names no removed field and keeps the `sufficient=YES`
sentence. ss-* wrapper output changes need no restart and no native rebuild (no Rust change).

Left open (owner decisions, not fixed here):

- **Native `sweet-search "<q>"` agent text is compact but was never benchmarked.** The bench measured the
  ss-* wrappers only. The blocks come from the same renderer; the surface is new.
- **Daemon restart on upgrade.** `renderAgentSearchResponse` runs in the daemon. There is no code-version
  check: a warm daemon keeps the old renderer until its idle TTL (`SWEET_SEARCH_DAEMON_IDLE_TTL_MS`,
  default 20 min, `search-server.js:1454`) or `sweet-search --stop`. The opt-out and `SS_FIX_A` are read from
  the daemon's env, so interleaved bench arms that share one daemon (same repo) share its native-text mode
  (the warm-up's `sweet` arm env); the ss-* wrapper output is per call and per arm.
- **Older runners flip silently.** `cc-batch`, `ba-batch`, `oc-batch` and the other `SS_BIN` scripts set no
  `SS_FIX_*` and stamp no `ssOutput`: a rerun is compact. The task-completion bench runner was not touched
  (out of scope). A run to compare with rows before 69c8e2fe must set `SS_FIX_A=0`.
- **ss-* PATH gap (answer).** A user install does not put the ss-* tools on PATH. `package.json:36-39`
  `bin` exposes only `sweet-search` and `sweet-search-mcp`; `package.json:78-86` ships
  `eval/agent-read-workflows/bin/ss-*`, but no installer links or exports that directory (`scripts/init.js`,
  `scripts/install-*.js`, `scripts/hooks/`, `inject-agent-instructions.js`: no reference to
  `agent-read-workflows`, no PATH change). The rules tell the agent to run `ss-*` via Bash
  (`p7-final/sweet-search-system-prompt.md:26-34`; `scripts/hooks/remind-tools.mjs:26-31`;
  `scripts/hooks/intercept-read.mjs:25`). Only the benches put the directory on PATH
  (`scripts/retrieval-bench-282.mjs:126,258`; `scripts/cc-batch.mjs:26,68`). So in a user install an agent
  gets `command not found` for `ss-search` unless the user adds
  `node_modules/sweet-search/eval/agent-read-workflows/bin` to PATH; the only shipped command it can reach
  is `sweet-search` (the daemon's agent text above).

