# NOTICE — harness prompts shipped by `sweet-search init`

`sweet-search init` replaces the system prompt of Claude Code, Codex (`--codex`) and opencode
(`--opencode`) with the version measured in the sweet-search task-completion benchmark. Two files in
this directory are **modified copies of third-party text**; the rest is our own code and text.
`index.js` builds the shipped prompts from them, and the benchmark imports `index.js`, so the
benchmarked prompt and the shipped prompt are the same bytes.

## `codex-0.146.1-instructions-conflict-gpt-5.6-luna.md`

- **Source:** the base instructions that `codex-cli` **0.146.1** (https://github.com/openai/codex)
  sends for model gpt-5.6-luna, captured at $0 through a local proxy (17,730 chars, sha256
  `cbefa6b0bede0e332d957fca70ccacf9f12f4c0ecdf81b819e5cbe1a3b16e265`).
- **License:** Apache License 2.0 (`LICENSE-Apache-2.0.txt` in this directory). The package
  `@openai/codex@0.146.1` declares `"license": "Apache-2.0"`.
- **Modified by:** the sweet-search project, 2026-09-27. Two source lines are deleted: line 78
  ("When you search for text or files, you reach first for `rg` or `rg --files`…"), which
  contradicts the sweet-search rules, and line 83 (a verbatim duplicate of line 124). Nothing else.
- **Build:** `node eval/task-completion-bench/harness/trim/build-codex-instructions.mjs` rebuilds
  the file from the capture; `--check` fails if the file differs.
- **Shipped form:** `index.js` (`codexInstructions`) strips the `<!-- … -->` header and replaces
  the two tool-grouping lines with our own text (`CODEX_SHIPPED_BATCH_LINES`). `init --codex`
  writes the result to `.codex/sweet-search-instructions.md`.

## `opencode-1.18.4-prompt-gpt-original.txt`

- **Source:** the unmodified gpt-family system prompt that opencode **1.18.4**
  (https://github.com/anomalyco/opencode) sends, from a $0 capture.
- **License:** MIT (text below).
- **Shipped form:** `index.js` (`opencodePrompt`) replaces the bullet "When searching for text or
  files, prefer using Glob and Grep tools (they are powered by `rg`)" with its Glob half ("When
  searching for files by name, prefer using the Glob tool (it is powered by `rg`)"; rules v2,
  `rules-v2.js`), deletes the words " - especially file reads", and adds our own lines after the
  parallel-calls bullet. `init --opencode` writes the
  result to `.opencode/sweet-search-prompt.txt`.

## Claude Code (`scripts/install-claude-lean-harness.js`)

- **Source:** the system prompt of Claude Code (Anthropic PBC), extracted from the Claude Code
  binary and edited. The main-agent, general-purpose and Plan prompts that `init` writes to
  `.claude/agents/` follow the stock prompt section by section, without its search steer. Some
  sentences are close to the stock wording. Since rules v2 (`rules-v2.js`) the main agent carries
  one line for the `find` half of the stock bypass-mode steer.
- **License:** Claude Code is proprietary. It is **not** under Apache-2.0 or any open-source license.
- **Mechanism:** documented Claude Code settings (`agent`, `permissions.deny`, output styles) and
  three undocumented environment switches (`CLAUDE_CODE_THRIFTY_SONIC`,
  `CLAUDE_CODE_TOTAL_TOKENS_REMINDER`, `CLAUDE_CODE_PARCHMENT_FERN`).

## `opencode-trim-plugin.mjs`

Our own code. An opencode plugin that edits the descriptions of built-in tools through opencode's
documented `tool.definition` hook (the edits: `OPENCODE_TOOL_EDITS` in `index.js`).
`init --opencode` copies it to `.opencode/plugins/sweet-search.mjs`.

## MIT License (opencode)

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
