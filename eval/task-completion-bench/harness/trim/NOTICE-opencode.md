# opencode 1.18.4 — edited copies for the harness trim (OC_HARNESS_TRIM)

Files in this folder that start with `opencode-` are used by `harness/opencode-task-runner.mjs`
when `OC_HARNESS_TRIM=1`, on the sweet arm only. This notice is not sent to the model.

## Source

- Product: opencode, npm `opencode-ai@1.18.4` (binary `opencode-darwin-arm64@1.18.4` / `opencode-linux-x64@1.18.4`),
  <https://github.com/anomalyco/opencode>.
- The four prompts are opencode's own model-family system prompts. The source text is what 1.18.4 sent
  in a $0 capture (`handoffs/improve/harness-prompt-trim/captures/opencode-1.18.4-request-sweet-trim-off-<family>.json`),
  not a reconstruction.
- `opencode-trim-plugin.mjs` is our own code (it uses opencode's documented `tool.definition` plugin hook).
  The tool-description edits it applies are listed in `OPENCODE_TRIM_TOOL_EDITS` in the runner.

## Licence

MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Files and which models get them

opencode chooses its base prompt from the provider model id. The runner mirrors that rule
(`opencodePromptFamily`) and refuses to run the trim for a family that has no copy here.

| file | opencode rule | bench models |
|---|---|---|
| `opencode-1.18.4-prompt-default.txt` | fallback (no other rule matches) | `x-ai/grok-4.5` |
| `opencode-1.18.4-prompt-muse.txt` | id contains `muse-spark` | `meta/muse-spark-1.1` |
| `opencode-1.18.4-prompt-gpt.txt` | id contains `gpt`, not `gpt-4`, not `codex` | not routed to opencode today (GPT → codex) |
| `opencode-1.18.4-prompt-claude.txt` | id contains `claude` | not routed to opencode today (Anthropic → claude-code) |

Not copied (the trim throws for them): `gpt-4`/`o1`/`o3`, `*codex*`, `gemini-`, `trinity`, `kimi`.

`OC_HARNESS_TRIM=max` uses `opencode-1.18.4-prompt-<family>-max.txt` for the build agent AND the
`general` subagent, and `opencode-1.18.4-prompt-explore-max.txt` for the `explore` subagent
(opencode's own explore prompt, any model; source text from
`captures/opencode-1.18.4-request-sweet-trim-off-explore-subagent.json`). The same build script
makes them: the family's round-1 list plus its `*_MAX` list.

## Changes

Rebuild with `handoffs/improve/harness-prompt-trim/scripts/build_oc_trim_prompts.py`; each edit must match
exactly once. Tags: **A** = contradicts the ss-* rules (search/read/delegation steering), **B** = text a
headless benchmark task never uses. Everything else is unchanged.

### default (8,528 → 5,897 chars)

- B: `/help` and feedback lines; "When the user directly asks about opencode … use the WebFetch tool …".
- B: "When you run a non-trivial bash command, you should explain what the command does …" (sentence removed; "You should be concise, direct, and to the point." kept).
- B: "Remember that your output will be displayed on a command line interface …"; the "preachy and annoying" refusal line; the emoji line.
- A+B: the six verbosity examples (2+2, prime, ls, …, and "[uses grep and glob search tools …]") and their lead-in sentence. The "fewer than 4 lines" rule is kept.
- B: "If you are unable to find the correct command, ask the user … writing it to AGENTS.md …" (lint/typecheck rule kept).
- A: "When doing file search, prefer to use the Task tool in order to reduce context usage."

### claude (8,212 → 5,188 chars) and muse (8,347 → 5,327 chars) — same body

- B: `ctrl+p` and feedback lines; "When the user directly asks about OpenCode … use the WebFetch tool …".
- B: emoji line; "Your output will be displayed on a command line interface … GitHub-flavored markdown …" → minimal edit to "Your responses should be short and concise."
- B: "# Professional objectivity" section.
- A: "When doing file search, prefer to use the Task tool …"; "You should proactively use the Task tool with specialized agents when the task at hand matches the agent's description."
- B: the WebFetch redirect line; "If the user specifies that they want you to run tools "in parallel" …".
- A: "Use specialized tools instead of bash commands when possible … Read for reading files instead of cat/head/tail … Reserve bash tools exclusively for actual system commands …" → minimal edit to "For file operations, use dedicated tools: Edit for editing instead of sed/awk, and Write for creating files instead of cat with heredoc or echo redirection. NEVER use bash echo …".
- A: "VERY IMPORTANT: … it is CRITICAL that you use the Task tool instead of running search commands directly." and its two examples.

### gpt (9,274 → 6,465 chars)

- A: "When searching for text or files, prefer using Glob and Grep tools (they are powered by `rg`)".
- B: the "asking for the time" and "review" paragraphs of "Special user requests" (the bug-report paragraph is kept).
- B: "## Frontend tasks", "## General" and "## Formatting rules" sections. "## Response channels" is kept (it governs GPT's commentary/final channels).

### Tool descriptions (plugin, all families)

- bash — A: "IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead."
- bash — A: " or Grep to search the full content" (the Grep tool is disabled).
- bash — A: "Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands" → "… the `sed`, `awk`, or `echo` commands"; the lines "File search: Use Glob", "Content search: Use Grep (NOT grep or rg)", "Read files: Use Read (NOT cat/head/tail)". The Edit, Write and Communication lines are kept.
- read — A: "Use the grep tool to find specific content …" and "use the glob tool to look up filenames …".
- task — A (the tool stays enabled; only pointers to the disabled glob/grep tools go): "use the Read or Glob tool instead of the Task tool" → "use the Read tool instead of the Task tool"; the line "If you are searching for a specific class definition like "class Foo", use the Grep tool instead, …" is removed. The rest of the description and the agent list are unchanged.
- Not edited: `edit`, `write`, `apply_patch`, `todowrite`.
