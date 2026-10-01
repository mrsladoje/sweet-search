# Code review — branch `ft-fixes` (02c1fee1, 835e268d, 5000cdec) against `final-tuning`

Reviewer: Opus 5.5, independent static review plus targeted unit tests. Date: 2026-10-01.
No ss-* command, no benchmark, no agent and no full test suite was run.

## Conclusion

**Ship to test: yes, with conditions.** With every switch unset, the branch is safe to merge. The output is
byte-identical to the branch point, apart from the intended `DEDUPE` crash fix. I found no variable used
outside its scope (the `DEDUPE` bug class) in any flag path.

Two defects must be fixed before some runs:

- **Already-shown omission (A3) on Claude Code and opencode makes false claims.** Subagents share the
  thread key with their parent, so the parent can be told "already shown above" about code that only a
  subagent saw (H1). Do not run `SS_FIX_A=1` on Claude Code or opencode without a guard, or turn A3 off there.
- **A3 combined with `SS_FIX_ONE_PER_FILE` or `SS_FIX_SUMMARY_CAP` records code that it then hides** (H2).
  Fix this before any stacked A + B run.

`SS_FIX_A=1` on Codex is usable. It breaks the owner rule "ss-read byte-identical with every switch" in a
small way (M1).

## What I checked

| Check | Result |
|---|---|
| Switches off: every ss-* code path | Same output as fe5fe90e (branch point). The only difference is the hoisted `DEDUPE`: ss-find no longer crashes. No new daemon calls, no stderr changes, no new process work. The `renderGrepBody` refactor gives the same lines (it is equivalent with `opts` absent). `missingScopes()` now runs before the scoped fetch, but it only reads the filesystem and prints nothing. |
| Scope / undefined variables | ESLint `no-undef` + `no-use-before-define` on `_ss-helpers.mjs`, `agent-output-fixes.js`, `grep-output-shaping.js`, `agent-span-ledger.js`: **0 issues**. The same check on fe5fe90e finds the original bug (`'DEDUPE' is not defined`, line 591). So the check works, and the branch is clean. `k`, `file`, `shownSpans`, `missingScopes` and `DEDUPE` are all in scope wherever the new code reads them. |
| ss-read code path | Only one new statement: an extra `observe` call when A3 is on and the original key is missing (`_ss-helpers.mjs:957`). Its reply is ignored. The output is unchanged on Claude Code, on opencode and with no key. **It changes on Codex through shared ledger state (M1).** |
| Targeted tests | `npx vitest run tests/search/agent-output-fixes.test.js tests/search/grep-output-shaping.test.js tests/search/agent-span-ledger.test.js` with an isolated `SWEET_SEARCH_RUNTIME_DIR`: 3 files, **90/90 pass**. The new tests cover only the pure functions. No test exercises the wiring in `_ss-helpers.mjs`, where the `DEDUPE` bug lived. |
| Session key of a Claude Code subagent | Verified live. This review runs as a subagent, and its `CLAUDE_CODE_SESSION_ID` is the same as the parent session id (`cc25c43a-…`, the main `.jsonl`, with `subagents/` under it). |

## Findings (most severe first)

### HIGH

**H1. A3 tells a Claude Code (and opencode) agent that it saw code it never saw — subagents share the key.**
`agent-output-fixes.js:60-64` (`resolveThreadKey`), used at `_ss-helpers.mjs:205-207`.
Every Claude Code subagent inherits the parent's `CLAUDE_CODE_SESSION_ID` (I verified this). Every opencode
`task` subagent runs in the same process, so it shares `OPENCODE_PID` (I inferred this; I did not verify it).
The daemon ledger cannot tell the parent from its subagents.
*Scenario:* the parent spawns an Explore subagent. The subagent runs `ss-search "retry policy"` and receives
`client.go:120-180` in full. The parent receives only the subagent's prose summary. Later the parent runs
`ss-find "retry" --regex Retry`, and the block prints as `(lines 120-180 already shown above)`. The parent
never had those lines. It must guess, or spend an `ss-read`. Subagents also inherit the parent's receipts,
the other way round.
`retrieval-bench-282.mjs` launches `claude -p` with no tool restriction, so subagents are possible in the bench.
*Fix:* keep A3 off for Claude Code and opencode (Codex has no subagents in `exec`), or find a per-agent key.
FIXES-IMPL lists this under "Risks". It is not a risk to measure; it is a certain false statement whenever a subagent searches.

**H2. A3 with B2 / B1 records spans for entries that are then hidden.** `_ss-helpers.mjs:232-248` and `254-261`.
`decideAlreadyShown(response.results)` sends a receipt for **every** result. The daemon `read` op stores every
block that it does not omit. After that, `writeFixedBlocks → selectEntries` hides entries: B2 hides later
same-file hits, even ones with full code, and B1 hides entries after `k`.
*Scenario (`SS_FIX_A=1 SS_FIX_ONE_PER_FILE=1`):* call 1 returns `a.go:50-80` with code as the second hit in
`a.go`. B2 prints only `also in this file: Fix (l.50)`, but the ledger now holds `a.go:50-80`. Call 3 returns
the same block as rank 1 and prints `(lines 50-80 already shown above)`. The agent never saw it. On Codex,
`ss-read a.go 50 80` also omits it ("already shown 2 calls ago"), and the agent needs `--force`.
*Fix:* run `selectEntries` first, then send only the spans of the entries that are printed (filter `indexed`
by the kept `index` values).

### MEDIUM

**M1. ss-read output changes on Codex under `SS_FIX_A=1`. This breaks the owner rule.**
`_ss-helpers.mjs:752-756`, `1095-1097`, and the ledger at `agent-span-ledger.js` `decideAndObserveAtCall`.
On Codex, `THREAD_KEY == AGENT_SESSION_ID`, so ss-read and ss-search share one ledger. With A3, ss-search
and ss-find switch from `observe` to `read`. Blocks that are omitted are not recorded again, and an override
entry is set for them.
*Scenario:* call 1 is ss-search, which shows `a.go:10-40`. Call 2 is ss-find with the same block. Call 3 is
`ss-read a.go 10 40`. With the switch off, ss-read says "already shown **1** sweet-search call ago". With
`SS_FIX_A=1`, it says "**2** calls ago". At the 30-call window edge, ss-read prints the full body where it
used to omit it. A second path does the same thing: A5 now records the query of an invalid-regex ss-grep
that used to crash before it recorded anything. That changes `queryEvidence`, which drives ss-read's
query-aware "unread below/above" trailers.
FIXES-IMPL line 46 says "byte-identical … with a Claude Code key, an opencode key and no key". The Codex
key was not tested, and "Risks" admits the text change.
*Fix:* run A3 in its own ledger namespace (for example `sessionId = "a3:" + THREAD_KEY`). Keep the original
`observe` under `AGENT_SESSION_ID` exactly as it is. Make ss-read and ss-semantic always `observe` into the
A3 namespace when A3 is on. ss-read is then byte-identical on every harness, for the cost of one extra
socket call.

**M2. Compaction and harness truncation can desync the "already shown" claim; ss-search has no escape hatch.**
`_ss-helpers.mjs:290`, `304`. The window is 30 ledger calls (`RECEIPT_TTL_CALLS`). On Claude Code, only
ss-search, ss-find, ss-read and ss-semantic advance the counter (ss-grep and ss-trace use the original key,
which is null there), so the window covers a long stretch of a task.
- After auto-compaction, the code is gone from the context, but the ledger still counts it as shown.
- Claude Code cuts Bash output above about 30 000 characters. Codex cuts long tool output in the middle. Blocks in a cut region are recorded but were never delivered. (I did not measure the exact Codex limit for the current CLI version.)

The omission line gives no recovery command. ss-read works on Claude Code and opencode. On Codex it can be
omitted again and needs `--force`.
*Fix:* use a short window for search/find omissions (for example 8 calls), or reset on compaction. Write the
line as `(lines a-b already shown above; ss-read <file> a-b to see them again)`. Do not record spans when
the output is longer than the harness cut-off.

**M3. B2 keeps a summary-only entry and hides a later code entry of the same file.**
`agent-output-fixes.js:126-139`. B2 keeps the *first* entry of a file. When that entry is summary-only and
a later same-file entry has full code, the code is hidden. Its `continuation` and `familyManifest` are
hidden too, because `agent-pack-completion.js` attaches them to entries that have code. I confirmed this
with a probe: `[x.go full, a.go summary, a.go full+manifest]` gives `[x.go, a.go summary (also: Fix)]`.
This is the opposite of SYNTHESIS B2 ("fixes 'fix file only as summary'").
*Fix:* for each file, keep the entry that has code (choose by rank), or never hide an entry that has code.

**M4. The bench's delivered-token metric is not comparable between switch on and off.**
`scripts/retrieval-bench-282.mjs:219-230` (`ssDelivered`). With the switch off, ss-search is measured by
the route metadata `tokensUsed`, ss-find by its `# ss-find: … used=` header, and ss-trace by
`<<SS_TRACE_META>>`. `SS_FIX_A` removes all three, so all three fall back to `ss-other` = chars/4.
`ssDeliveredTokens` then compares an engine estimate with a character count. FIXES-IMPL mentions only
ss-trace. *Fix:* report characters for both arms, or write a meta line to stderr for ss-search and ss-find
as well.

**M5. FIXES-IMPL is stale after 5000cdec.** `FIXES-IMPL.md:227-230` still says "`sufficient=YES` no longer
exists under A1" and asks for the rules sentence to be deleted. The table at line 25 still lists
"confidence+sufficient line" as dropped. The code (`_ss-helpers.mjs:1006-1009`) prints `# sufficient=YES`
under `SS_FIX_A` (owner decision). If someone follows the doc, the A variant's rules and its output disagree.
Three smaller points:
- No test covers `compactSufficiencyLine` or `SS_FIX_DROP_SUFFICIENCY`.
- `SS_FIX_DROP_SUFFICIENCY` accepts only `'1'`. The other switches also accept `true`, `on` and `yes`.
- `SS_FIX_DROP_SUFFICIENCY` does nothing without `SS_FIX_A=1`, and the doc does not say so.

**M6. ft-fixes and final-tuning HEAD now differ on the same ss-find line.** `_ss-helpers.mjs:794`.
final-tuning fixed the crash on its own: it removed `DEDUPE` from ss-find (fe5fe90e→HEAD, `else if (r.summary)`).
ft-fixes keeps the filter and hoists `DEDUPE`. A merge conflicts on that line. With
`SS_VARIANT_SEARCH_DEDUPE=1`, the two branches print different ss-find output. "Off = byte-identical to
final-tuning" is true only against the branch point. Choose one fix before you merge.

### LOW

- **L1. `SS_FIX_SUMMARY_CAP=0` switches the fixed renderer ON with cap 0.** `agent-output-fixes.js:30-31`.
  In this codebase, `0` usually means off (`SS_SIBLING_LINE=0`, `SS_FIX_A=0`). With a result that has only
  summaries, the whole body is `(+N lower-ranked entries not shown)` and no entries (probe-verified).
  Treat `0` as off, or reject it.
- **L2. A2 dedupe drops a same-name definition at a different span.** `agent-output-fixes.js:120`
  (`r.symbol && x.symbol === r.symbol`). Go `String()` / `Error()` on two receivers in one file, or Java
  overloads, are different definitions. The second one disappears (probe-verified). The rule comes from
  the old variant, but it now sits inside "Bundle A — no information loss".
- **L3. A4/A5 "prefer the non-test definition" side effects.** `_ss-helpers.mjs:1363-1372`.
  - The trace runs again with `--in alt.file`, so the new response has no `disambiguation`. The `ambiguous:` line that named the test definition disappears.
  - `isTestLikePath` (`agent-output-fixes.js:70`) treats any `mock/`, `mocks/` or `testing/` directory as test code. In testify, `mock/mock.go` is product code. B7 also files it under tests.
- **L4. The opencode key is a PID, and receipts expire by call count, not by time.** A stale session stays
  in the daemon's 32-session list, and its receipts never age. If a later opencode process on the same
  repo daemon gets the same PID, it inherits the receipts. This is unlikely, but possible in runs that last
  hours. *Fix:* add a time limit, or add more to the key.
- **L5. A4 also drops content beyond the cue lines** (`agent-output-fixes.js:185-239`):
  - The target body and the `target callsite hints` go even when there is no mode word. The doc says so; SYNTHESIS A4 did not ask for it.
  - The `## callers (N)` count subtracts only the external items that were packed, not all external items.
- **L6. `compactSufficiencyLine` prints YES even when `response.confidence` is missing.**
  `_ss-helpers.mjs:1006-1009`. The off path printed the sufficiency line only together with `confidence`.
- **L7. An omitted A3 block still prints its `### imports` block.** `_ss-helpers.mjs:286-291`.
- **L8. Extra latency on Claude Code and opencode.** Under A3, ss-read and ss-semantic make one more
  socket call. It can wait up to 500 ms when the daemon is busy. The output does not change.
- **L9. B7 counts mode starts at 50 or more hits even with a large explicit `-k`.** The agent cannot get
  the flat list, except file by file with `--in`.
- **L10. The bench wrappers are the only path that has these switches.** `ss-batch` and `sweet-search` go
  through `core/cli.js`, which has none of them. The doc says so for the Rust CLI and the MCP server.

## Edge cases checked with no defect found

- Zero results: `(no matches)` prints in both renderers.
- Results that are all summaries (A only): one line per entry.
- `-k` larger than the result count: the cap is a no-op.
- Daemon down or no key: the code fails open and prints the code.
- More than 20 spans: the decision indexes stay aligned, because both sides slice the first 20.
- A5 retry errors:
  - A literal retry that throws again propagates as before.
  - An error in the case-insensitive retry is swallowed.
  - A scope that does not exist gets no retry.
- Windows paths go through `normalizeSpanFile` / `isTestLikePath`.
- Non-ASCII text is hashed as UTF-8.
- `process.exit(0)` after `stdout.write`: the code already did this before the branch. It is not new.

Parallel calls in one thread: one call can print "already shown" for a block that a sibling call in the
same turn printed. The content is in the context, so the only problem is the word "above".
