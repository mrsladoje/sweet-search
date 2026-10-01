Hand checks (done 2026-10-01 with `handcheck.py`, which re-reads the raw store with plain json/sqlite and prints it next to the dossiers):

| harness | rollout | what was compared |
|---|---|---|
| Claude Code, Opus | `tg-20261001-0440-L1/zmap__zlint-299/r0` | All 6 requests. Four compound commands (`ss-grep a; ss-grep b`). The raw result of the first command has 319 chars. The two dossiers hold 252 + 67 chars. The `after` text of the last two calls is the final answer of turn 6. |
| Claude Code, Opus | `hc-claudecode-20260930-0042-L3/rokucommunity__brighterscript-1050/r0` | 13 requests. A heredoc script followed by `ss-grep` (the call after `EOF` is real and is kept). A `$(ss-grep ...)` substitution (recorded with no output, because the model never sees it). A piped `ss-read ... \| head`. A `ss-grep --help \| head -0` whose output is gone (boundary `unmatched`). |
| Claude Code, gpt-5.6-luna | `hsmoke-claudecode-luna-20260926-1525-L1/maxgraph__maxgraph-365/r0` | 6 requests. ss-trace, ss-search, ss-read, ss-grep. The `<state_summary>` notes the model writes as visible text appear in `before` and `after`. Two parallel tool calls of one request share one `before`. |
| Codex | `hc-codex-20260929-1618-L3/maxgraph__maxgraph-365/r0` | A cell `ss-read ...; run_tests` returned "Script running" and delivered its output through a later `wait` call. The dossier holds the ss-read part only (boundary `trimmed`) and counts turnsRemaining from the wait turn. An `apply_patch` cell with no `cmd:` is an edit record. |
| Codex | `hc-codex-20260929-1523-L1/ember-cli__eslint-plugin-ember-551/r0` | Cells with `Promise.all` of 3 `exec_command` calls: one output part per command, mapped 1:1 (4391 + 2589 + 3521 chars). `{}` parts and a failed `apply_patch` cell. |
| Codex | `hc-codex-20260929-1542-L1/smooth-code__svgr-10/r0` | A cell that prints its own `text("<state_summary>...")` before the tool call. The note is removed from the ss output and added to the text of the request. |
| opencode | `hc-opencode-20260929-0345-L3/fastify__fastify-cors-285/r0` | 6 requests, parallel tool calls, `todowrite`, `apply_patch`. Result lengths equal the database `state.output`. |
| opencode | `hc-opencode-20260929-1356-L1/joshuakgoldberg__bingo-271/r0` | 26 requests, four parallel bash calls in one request, a `task` sub-agent (second session, thread `side:...`). |
| opencode | `hsmoke-opencode-20260926-0648-L2/dbader__node-datadog-metrics-73/r0` | 11 requests, ss-read and ss-search results compared by length and tail. |

Where the full text lives:

- Claude Code: `agent-state/<task>-sweet/claude-home/projects/<cwd>/<session>.jsonl`. Sub-agents: `<session>/subagents/agent-*.jsonl`. Results longer than the context limit are replaced for the model by a 2 KB preview; the full text is in `<session>/tool-results/*.txt`. This happened for 8 tool results, 2 of them ss-* calls (`persisted: true` in the dossier; `output` is what the model saw, `persistedFullChars` is the full size).
- Codex: `agent-state/<task>-sweet/codex-home/sessions/**/rollout-*.jsonl`. One model request = one `token_count` event. The tool is the `exec` cell; the commands are the `cmd:` strings of its JavaScript. The result is in `custom_tool_call_output`, or in the `function_call_output` of a later `wait` call.
- opencode: `agent-state/<task>-sweet/opencode-data/opencode.db` (SQLite; copied to a temp folder before it is opened). One model request = one assistant message. `part.data.state.output` is the model-visible result.
- The condensed `trajectories/*.json` cut every result at 600 chars (checked on all rollouts: longest result 600). They are not used.

Caveats:

1. Thinking text. Claude Code with Opus 5.5 stores thinking blocks with an empty text (signature only): 1042 of 1138 blocks. Codex stores encrypted reasoning. So `thinking` is empty for most of `claudecode-opus` and all of `codex-luna`. The visible text of the model is complete. The `<state_summary>` notes that gpt-5.6-luna writes are in the text.
2. Tokens are `ceil(chars / 4)`. Digits and gutter characters tokenize worse than prose, so code with a gutter is probably under-counted.
3. A rollout that was re-run after a degenerate result keeps only the session that matches the final row (40 rollouts; `notes` in `trajectories.jsonl`). For `hsmoke-claudecode-luna-20260926-1000-L4/rokucommunity__brighterscript-1050` the turns file says 30 turns but the chosen session has 120; the tool-call count 195 matches `rows.json`.
4. Output split. About 92% of the ss calls split exactly and 3% more split after a tail trim (table above). `trimmed` and `heuristic` calls had other commands after them in the same Bash command; their tail was cut at the known end of the tool output. Calls with `unmatched` or `piped-unknown` have no known output and are left out of all size statistics. `piped-filtered` calls are measured on the filtered text and left out of the composition tables.
5. Codex outputs delivered by a `wait` call count their re-reads from the wait turn. A codex cell that never collected its output has `outputKind=not-collected` (none occurred in the ss calls).
6. Command substitution `$(ss-grep ...)` is recorded as a call with `boundary=substitution` and no output (2 calls). Their output goes to the shell, not to the model.
7. `ss-batch` was never called in any source. No `sweet-search batch` command appears either.
8. ss-read prints a line gutter only for reads of 15 or more lines. Codex prints no gutter at all. Gutter chars are measured only where the numbering is consecutive.
9. Cross-call duplication compares line numbers of code shown by earlier ss-* calls. Edits that shift line numbers are not modelled. Codex omits an exact re-read (43 ss-read outputs in the sources hold the omission note instead of code); those are small outputs and not counted as re-shown code.
10. Claude Code with Opus uses ss-search rarely (35 calls), so every ss-search figure for `claudecode-opus` rests on few outputs. Read those columns with that in mind. The other three harness keys have 200 or more ss-search outputs each.
11. The hsmoke runs (2026-09-25/26) are older than the hc runs. Their ss-* output has the same format (same headers, trailers and entry lines). Section B4 shows that the main numbers do not differ between the groups.
12. Code fences inside code (a README entry with a line ```) can end a fence early in codex output, which has no gutter. About 0.3% of codex ss-search characters land in `other` for this reason.
13. Rollouts are `rep` 0 only. Each run folder holds one rollout per task and arm.
14. For Codex the runner counts `exec_command` commands in `rows.json` `calls`, not cells. The count of commands matches in 193 of 210 rollouts; the other 17 differ by 1 to 3 (the runner skips some failed cells). For Claude Code and opencode the tool-call count equals `calls` (opencode differs only where a sub-agent session exists, because the runner counts the main session).
