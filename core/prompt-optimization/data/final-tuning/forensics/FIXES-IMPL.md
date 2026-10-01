# ss-* product output fixes — implementation (branch `ft-fixes`)

**Conclusion.** All fixes from `SYNTHESIS.md` bundle A and the owner-approved part of bundle B are
built as default-off environment switches. With every switch unset, the output of every ss-* command is
byte-identical to the main checkout code (checked on 35 calls, see Verification). One exception is a
bug fix, not a switch: the final-tuning code crashes in `ss-find` (see "Bug found in final-tuning").

Branch `ft-fixes` (worktree `../sweet-search-ft-fixes`) was created from `final-tuning` @ fe5fe90e.
Nothing was pushed to main and nothing was edited in the final-tuning worktree or the main checkout.

## Bug found in final-tuning (read this first)

`final-tuning` commit 60141293 (variant `SS_VARIANT_SEARCH_DEDUPE`) put `DEDUPE &&` into `cmdFind`, but
`DEDUPE` is a local constant of `cmdAgentSearch`. Result: **`ss-find` crashes with
`ReferenceError: DEDUPE is not defined` whenever any result is a summary entry** (4 of 4 test calls on
gin; summary entries are in almost every ss-find answer). Any final-tuning run that uses ss-find is
affected: the agent sees a stack trace instead of results. This branch hoists `DEDUPE` to module
scope. With the variant off, ss-find then prints exactly what the main checkout prints. The same
change makes `SS_VARIANT_SEARCH_DEDUPE=1` work in ss-find as the commit intended.

## Switches (all default off)

| Switch | Fix | Commands |
|---|---|---|
| `SS_FIX_A=1` | A1 drop score, presentation/kind tag, header, confidence+sufficient line, `route=` and `shown-full:` trailers | ss-search, ss-find |
| | A2 one-line summary entries, V3 dedupe of covered / repeated summary entries | ss-search, ss-find |
| | A3 "already shown above" for code the same thread saw | ss-search, ss-find (ss-read, ss-semantic only record) |
| | A4 compact ss-trace, ambiguity prefers non-test, wrong `--in` falls back | ss-trace |
| | A5 regex parse error retried as literal; zero hits retried case-insensitively | ss-grep |
| `SS_FIX_SUMMARY_CAP=<n>` | B1 at most n summary-only entries; `-k` caps all entries | ss-search, ss-find |
| `SS_FIX_ONE_PER_FILE=1` | B2 one entry per file, rest as `also in this file:` | ss-search |
| `SS_FIX_GREP_ORDER=1` | B7 source before test, per-file counts at >= 50 hits, no repeated text column | ss-grep |
| (not built) | B3 read cap — **dropped by owner decision** | — |
| `SS_READ_GUTTER=none` (exists) | B4 gutter off — confirmed (below) | ss-read, ss-search, ss-find, ss-semantic |

Owner decision 2026-10-01: ss-read output is not changed by any switch. Confirmed: `ss-read` printed
byte-identical output with `SS_FIX_A=1` on and off, with a Claude Code key, an opencode key and no key.

## What changed (files)

- `core/search/agent-output-fixes.js` (new, pure functions): flag parsing, thread key, test-path test,
  `selectEntries` (A2/B1/B2), `renderSummaryLine`, `formatTraceCompact` (A4), grep helpers (A5/B7).
- `eval/agent-read-workflows/bin/_ss-helpers.mjs`: wiring. New fixed renderer `writeFixedBlocks` is used
  **only** when a switch needs it; otherwise the original loops run untouched. Also the DEDUPE hoist.
- `core/search/agent-span-ledger.js`: one new export `collectAgentShownSpansIndexed` (existing
  functions unchanged).
- `core/search/grep-output-shaping.js`: `renderGrepBody` got an optional 4th argument; absent = same output.
- `tests/search/agent-output-fixes.test.js` (new, 28 tests).
- `forensics/fixes-verify/*.sh`: the scripts used below.

### A1 + A2 (ss-search, ss-find)

Kept: rank number, `file:start-end`, `[kind: symbol]`, `STALE`, imports, code, related, `# same file`,
`# continues at`, family manifest. Dropped: see table. Summary entries become one line
`path:start-end symbol (kind)` without rank number; a summary whose text says more than its header keeps
that text on a second line (none seen in 14 search/find calls).

### A3 — why it fired on Codex only

The shown-span ledger lives in the daemon and is keyed by a session id. `resolveAgentSessionId` reads
`SWEET_SEARCH_SESSION_ID`, `CODEX_THREAD_ID` and `CLAUDE_SESSION_ID`.

- Codex sets `CODEX_THREAD_ID` itself, so it worked there.
- Claude Code exports **`CLAUDE_CODE_SESSION_ID`**, not `CLAUDE_SESSION_ID` (checked in the live Bash tool
  environment and in the claude 2.1.281 binary). The product only gets a key through the `init`
  SessionStart hook, which the bench harness does not install.
- opencode exports `OPENCODE_PID` (checked in the opencode 1.18.33 binary) and no session key.

With `SS_FIX_A=1` a wider key is used (`resolveThreadKey`: the three old names, then
`CLAUDE_CODE_SESSION_ID`, then `opencode-<OPENCODE_PID>`). The original lookup is not changed, so ss-read
behaves as before. ss-search / ss-find send the receipts with the `read` operation and print
`(lines a-b already shown above)` for each block the daemon proves identical (same file, same lines,
same hash, last 30 calls). ss-read and ss-semantic only record (`observe`), so a later ss-search knows
what they showed. Fail open: no key, no daemon or a changed file prints the code.
I used an ASCII hyphen in `a-b` (the brief shows an en dash) so the range can be pasted into `ss-read`.

### A4 ss-trace

Rows only (`name [type] file:line call@n`), no bodies, no cue lines, no budget/latency line, no importance
numbers. `callers|callees|impact` prints only that section. External callees are not listed; one line
says how many (`(+5 external/unresolved callees not listed)`); impact paths that end in an external
symbol are dropped. Without a mode word, a one-hop impact path is dropped only if its other end is
already a printed row. Ambiguous name: if the first match is a test file and a non-test alternative
exists, the non-test definition is used (one `note:` line). `--in <file>` with no such symbol: repo-wide
fallback (one `note:` line). The `<<SS_TRACE_META>>` JSON line now goes to **stderr** (the wrapper
discards stderr on exit 0). `scripts/retrieval-bench-282.mjs` `ssDelivered()` then falls to its
`ss-other` branch (chars/4) for ss-trace; I did not edit it.

### A5 ss-grep

Regex parse error: one retry as an escaped literal and one line, e.g.
`(invalid regex "func(" — searched it as literal text instead)`. Zero hits: one retry with `(?i)` and one
line `(no case-sensitive matches — showing case-insensitive matches)`. No retry when `--in` names a path
that does not exist. A real engine failure still crashes as before.

### B1 / B2 / B7

- B1: after A2/B2, keep at most `k` entries (default k is 5 for ss-search, 6 for ss-find) and at most
  n summary-only entries; one line `(+N lower-ranked entries not shown)` if any were cut.
- B2: first entry of a file stays; later hits in that file become `also in this file: symA (l.120), ...`.
  Code that the daemon packed for a later same-file hit is not printed (display only; the pack budget
  is not re-spent).
- B7: unscoped ss-grep fetches up to 100 files (not k) so source files are not cut before ordering;
  source files first, test-like files (`_test.go`, `test_*.py`, `*.spec.ts`, `tests/`, `fixtures/`, ...)
  after. At >= 50 hits: header, one line of explanation, `file:firstLine (N matches)` per source file
  (most hits first, at most k rows), and one collapsed line for test files. Below 50 hits: normal lines,
  but when every shown hit has the same matched text, the text column is dropped.
  Scoped (`--in`) output gets the ordering and the text-column rule, no counts mode.

### B4

`SS_READ_GUTTER=none` removes the line numbers from ss-read, ss-search, ss-find and ss-semantic code
blocks (checked on gin; ss-read already skips the gutter for ranges under 15 lines).

## Samples (gin clone, all numbers are characters of stdout)

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

## Verification

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

## What the rules text must change (do it in the same variant as `SS_FIX_A=1`)

`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`:

1. **`sufficient=YES` no longer exists under A1.** Replace the sentence "On `sufficient=YES`, trust the top
   ranked result outright; confirm with at most one narrow `ss-read`, never a re-run of a matching hit." by
   "Trust the top ranked result; confirm with at most one narrow `ss-read`, never a re-run of a matching hit."
   (Readers saw Opus read more files after `sufficient=YES` in 94% of calls, so the line did not steer.)
   Keep the `same file:` sentence: the `# same file (siblings of …)` line is unchanged. "Lower ranks" still exist
   (code entries keep `#N`); summary entries lose their number.
2. One short sentence for the new lines (only when the matching switch is on): `(lines a-b already shown above)`
   means these lines are in an earlier tool result; `also in this file:` (B2); `(+N lower-ranked entries not shown)` (B1);
   per-file counts in ss-grep (B7): "list a file's hits with `--in <file>`".
3. A6 from SYNTHESIS (not code): write `ss-trace <symbol> callers`, no brackets; say `ss-find --regex` matches file content.
4. If B1 is on, say `-k N` is a hard cap on entries.

## Risks and limits

- **Subagents and compaction.** The key is per session. A Claude Code subagent that shares the session id can be
  told "already shown above" for code only its parent saw; after context compaction the model may have lost code that
  the ledger still counts as shown (window: 30 calls). Real tasks needed to measure this; use a guard run.
- A3 covers only blocks the daemon packs as `full` and complete. `preview` blocks (cut with `...`) are always printed.
  ss-read ranges over 256 lines carry no per-line proof, so they cannot cover a later contained block.
- Codex only: under A3 an `ss-read` omission can say "shown 4 calls ago" where it said "2 calls ago", because the
  omitted ss-find block is no longer re-recorded. The count is now the true distance to the last full print.
- A4 drops the target body and caller bodies. The readers judged them unused (callers mode with `--in` was the only
  useful trace form), but a task that needs a caller's body now needs one `ss-read`.
- B2 prints no code for a second hit in an already listed file, even if the daemon had packed it.
- B7 counts mode shows the first hit line of each file, not the matched text.
- Not done: the Rust product CLI / MCP server print their own ss-* output (`crates/sweet-search-cli`, `core/search/search-server.js`
  formatting). These switches cover the bench wrappers in `_ss-helpers.mjs` only; the shipped path needs the same
  change if the variant wins. `STATS` / `ss_parse.py` parsers expect the old header lines.
- ss-find regex parse errors are not retried (A5 names ss-grep only).
