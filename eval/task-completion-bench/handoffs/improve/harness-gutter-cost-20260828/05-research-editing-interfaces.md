# Line-number gutters, edit interfaces, and tokenisation — the primary sources

**Task R1.** Research deliverable for the harness-gutter-cost investigation, 2026-08-28.
**Method:** tool contracts read from the **deployed binaries on the evidence box** and from
vendor source or documentation; a tokeniser micro-study measured locally with `tiktoken`
`o200k_base` over five real golden source files; published literature from 2024-2026.
No rollout was launched. Nothing under `results/` was read or written except the run
configuration file quoted in §1.3.

Every claim is tagged. **[M]** measured here (script and numbers named) · **[C]** read from a
tool contract, source, or a deployed binary · **[I]** inferred · **[W]** web source with URL.

**Scripts:** `scripts/r1-gutter-tokens.py`, `scripts/r1-token-transparency.py`,
`scripts/r1-gutter-price.py`. **Logs:** `logs/r1-tokens.txt`, `logs/r1-transparency.txt`,
`logs/r1-price.txt`, `logs/r1-tokens.json`.

---

## 0. Verdict

**The tokeniser picks `N<TAB>` on its own, for a reason nobody in this programme had stated:
a tab is the only cheap delimiter that cannot fuse with the code's own indentation into a
single ambiguous whitespace token. Every space-terminated gutter — `N| `, `N: `, `N `,
padded `cat -n` — produces, on 64% of the lines in our corpus, one pure-space token exactly
one space longer than the token the file itself would produce. That is the +1-space carry,
visible in the token stream.** [M]

Four further results change what the programme should do next.

1. **Claude Code's own contract already admits a colon.** The deployed 2.1.218 binary carries
   two variants of the Edit prompt, chosen by a feature gate named `tengu_tab_read_sep`
   (default off): off says *"line number + tab"*; on says *"line number + a single separator
   character (a tab or `:`)"*. `N| ` appears in no variant. [C]
2. **A colon with no trailing space is the one delimiter that is both contract-legal and
   token-transparent.** `N:` leaves the file's own indentation token untouched on 94.8% of
   lines and produces an ambiguous space run on 0%. It costs +0.71 tokens per line more than
   the tab. [M][C]
3. **Codex's tool-output cap is configurable and we left it unset.** `tool_output_token_limit`
   is a top-level `config.toml` key in codex-cli 0.146.1. The benchmark's `/root/.codex/config.toml`
   does not set it, so codex fell back to a per-model policy that truncated at about 2,500
   tokens. This corrects "config.toml sets no limit" in the mechanism report, which was true
   of the deployment and not of the capability. [C][M]
4. **The gutter is 0.75-1.56% of a rollout's cost, and the tab-to-pipe difference is
   0.46-0.96%.** The fresh-pool run measured codex PIPE at +3.44% against TAB. The token
   arithmetic explains 13-18% of that. The rest is behavioural. **Do not attribute
   the measured codex pipe cost to gutter bytes.** [M][I]

Two independent projects have reported our exact failure mode in the wild, and one has already
shipped a fix that changes the delimiter in the direction the tokeniser predicts: OpenCode
moved the space from *after* the pipe to *before* it, explicitly to stop models carrying
line-number metadata into edit anchors. [W]

---

## 1. (a) Current tool contracts, from source or the deployed binaries

### 1.1 Claude Code 2.1.218 — `Read` and `Edit` [C]

Read from `/root/.local/share/claude/versions/2.1.218` on the evidence box with `strings` and
byte-window extraction. This is the exact build that ran every `fp-claudecode-*` cell.

**`Read` renders `N<TAB>content`, unpadded.** The tool description is built from two fragments:

> `- Results are returned using cat -n format, with line numbers starting at 1`

and, in the widened variant:

> `. Each line is the line number, a single separator (a tab or ` `` `:` `` `), then the verbatim file content (including any leading whitespace).`

A raw `Read` result in a native trace is `'1\t#\' Grade code against a solution\n2\t#\'…'`
(measured in `rb-claudecode-20260824`, mechanism report §1.1). So the rendered form is a tab.

**`Edit` requires an exact, unique match and has one tolerance only.** The prompt strings:

> `- \`old_string\` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (${t?"line number + a single tab or \`:\`":"line number + tab"}) before matching.`

> `- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${r}. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.`

The failure strings are `String to replace not found in file.` and
`Found ${g} matches of the string to replace, but replace_all is false.`. The only
normalisation the tool performs is escape swapping:

> `(note: Edit also tried swapping \uXXXX escapes and their characters; neither form matched, so the mismatch is likely elsewhere in old_string. Re-read the file and copy the exact surrounding text.)`

**There is no whitespace tolerance.** A single extra leading space fails the edit.

**The new finding — the separator is gated, and the gate admits a colon.** The declared prefix
is selected by a function `FPt`, defined in the binary as:

```
FPt = qr(() => Xe("tengu_tab_read_sep", !1))
```

`Xe(<gate>, !1)` is the feature-gate reader with a `false` default. So:

| gate `tengu_tab_read_sep` | Edit prompt declares |
|---|---|
| **off (default, and the state in our runs — the sandbox has no network)** | `line number + tab` |
| on | `line number + a single tab or `:`` / `line number + a single separator character (a tab or `:`)` |

A second gate, `tengu_edit_minimalanchor_jrn` (also default false), appends
*"Keep `old_string` minimal — usually 1-3 lines, only enough to be unique in the file.
Including excess context wastes tokens and is an error."*

**Consequences.** [I] `N<TAB>` is byte-identical in shape to the prefix the harness declares
and renders itself, under the default gate. `N:` is contract-legal under the widened gate and
is where Anthropic is evidently heading. `N| ` is legal under neither.

### 1.2 Anthropic `str_replace_based_edit_tool` (the API-level editor) [W]

Source: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool>

- Commands: `view`, `str_replace`, `create`, `insert`, `undo_edit` (`undo_edit` removed in
  `text_editor_20250429` and later). Versions: `text_editor_20241022`, `20250124`, `20250429`,
  `20250728`.
- `str_replace` parameter contract, quoted: **"`old_str`: The text to replace (must match
  exactly, including whitespace and indentation)"**. Uniqueness is enforced by the reference
  implementation, whose error is `"Error: Found 3 matches for replacement text. Please provide
  more context to make a unique match."`
- `view` takes `view_range` (1-indexed, `-1` = end of file), so **line numbers are the read
  addressing and strings are the write addressing** — the same split Claude Code uses.
- `max_characters` (only on `text_editor_20250728` and later) truncates `view` output.
- **The documented reference `view` output uses `N: `** — colon plus space. The worked example
  in the docs returns
  `"1: def is_prime(n):\n2:     \"\"\"Check if a number is prime.\"\"\"\n3:     if n <= 1:\n…"`.

**This is a genuine split inside Anthropic.** [I] The API-level reference editor numbers with
`N: ` (a space-terminated, ambiguous form). The Claude Code product numbers with `N<TAB>` and
tells the model so. The product form is the one the model is trained and reinforced against in
agentic use; it is also the safer of the two by the tokeniser (§3).

### 1.3 Codex CLI 0.146.1 — `apply_patch` and the exec output cap [C][M]

Binary: `/usr/lib/node_modules/@openai/codex/…/vendor/x86_64-unknown-linux-musl/bin/codex`,
`codex --version` = `codex-cli 0.146.1`.

**`apply_patch` context matching — a four-pass seek from a moving line index.** [C]
`codex-rs/apply-patch/src/seek_sequence.rs` runs, in order: exact; `trim_end` on both sides;
`trim` on both sides; unicode punctuation and space normalisation. `file_update.rs` applies
chunks in order against a **moving `line_index`**, locating a `@@` header first and then the
old lines, searching **forward only** from the current index. The compiled grammar is
`change_line: ("+" | "-" | " ") /(.*)/ LF`; the streaming parser rejects any other first
character. Both error strings — `Failed to find context '…' in …` and
`Failed to find expected lines in …` — are present in the 0.146.1 binary.

**Whitespace cannot fail it.** [C] Pass three compares `line.trim()` to `pattern.trim()`, so a
leaked leading space matches. The forward-only moving index is what makes **hunk order** fatal
instead.

**The exec output cap — the constant, and it IS configurable.** This is a correction.

- The tool schema in the binary: `max_output_tokens` — *"Output token budget. Defaults to
  10000 tokens; larger requests may be capped by policy."* and, for direct exec,
  *"`max_output_tokens` sets the token budget for direct `exec` results. Defaults to 10000
  tokens."* [C]
- The clamp is a **per-model** `truncation_policy` field. The binary's `ModelInfo` field list
  contains `apply_patch_tool_type`, `web_search_tool_type`, **`truncation_policy`**,
  `supports_parallel_tool_calls`, …; the type is `TruncationPolicyConfig`, a
  *"struct … with 2 elements"*, one of which is named `limit`. [C] The change that made
  unified exec respect it is openai/codex PR #19247,
  *"we were not respecting turn's `truncation_policy` to clamp output tokens for `unified_exec`
  and `write_stdin`"*. [W] <https://github.com/openai/codex/pull/19247>
- Truncation is **head-and-tail (middle-out)**; the strings in the binary are
  `Warning: truncated output (original token count: `, ` tokens truncated`,
  `Total output lines: `. [C]
- **`tool_output_token_limit` is a top-level `config.toml` key in this build.** [C] It sits in
  the `ConfigToml` field list between `project_doc_fallback_filenames` and
  `background_terminal_max_timeout`. The official reference gives its type as `number` and its
  description as *"Token budget for storing individual tool/function outputs in history."*
  [W] <https://learn.chatgpt.com/docs/config-file/config-reference>
- **The benchmark never set it.** [M] `/root/.codex/config.toml` on the box contains `model`,
  `model_reasoning_effort`, `[model_providers.openrouter]`, `[features]` and a list of
  `[projects.*]` trust entries. No `tool_output_token_limit`. So codex fell back to the model
  policy, which the prior investigation measured at about 2,500 tokens (largest untruncated
  output 2,459 tokens, smallest truncated 2,511, over 665 `exec_command` outputs).
- Community configurations set 12,000-25,000. [W] The upstream issue asking for the default to
  be user-configurable is #20861; the issue proposing token-based instead of line-based
  truncation (`MODEL_FORMAT_MAX_LINES` 256 / 10 KiB → `MODEL_FORMAT_MAX_TOKENS` 25,000, in
  `codex-rs/core/src/context_manager/truncate.rs`) is #6426. [W]
  <https://github.com/openai/codex/issues/20861> ·
  <https://github.com/openai/codex/issues/6426>

**What this means for the gutter.** [M] A plain read crosses 2,500 tokens at about 289 lines,
tab at 247, pipe at 226 (mechanism report §5.4). Raising `tool_output_token_limit` removes the
constraint entirely and is a one-line configuration change, not a render change.

### 1.4 OpenCode 1.18.4 — `read`, `edit`, `apply_patch` [C][W]

Binary: `/usr/lib/node_modules/opencode-ai/bin/opencode.exe`, `opencode --version` = `1.18.4`.

**`read` declares `N: `.** The exact prompt string in the deployed binary: [C]

> `- Contents are returned with each line prefixed by its line number as \`<line>: <content>\`. For example, if a file has contents "foo\n", you will receive "1: foo\n". For directories, entries are returned one per line (without line numbers) with a trailing \`/\` for subdirectories.`

The edit-side prompt adds *"The line number prefix format is: line number + colon + space
(e.g., `1: `). … Never include any part of the line number prefix in the oldString or
newString."* A raw native `read` in a trace is `1: #' Grade code against a solution`. [M]

**`edit` has nine fuzzy replacers** (line-trimmed, whitespace-normalised, indentation-flexible,
block-anchor, …) and was **called zero times** in these runs. [C][M] Every opencode edit went
through `apply_patch(patchText)`.

**`apply_patch` is a TypeScript port of codex's seek** — `packages/opencode/src/patch/index.ts`
`seekSequence`: exact → `trimEnd` → `trim` → `normalizeUnicode(trim)`; same error strings
prefixed `apply_patch verification failed: Error:`. [C] So opencode is whitespace-tolerant on
the write path and whitespace-*ambiguous* on the read path.

**Upstream is already moving the delimiter, for our reason.** [W] OpenCode PR #12030,
*"Improve `Read` tool output to aid subsequent uses of the `Edit` tool"*, changed:

```js
// before
`${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
// after
`${(index + offset + 1).toString().padStart(5, "0")} |${line}`
```

The space moved from **after** the pipe to **before** it. The stated rationale is that
everything before the pipe "should be discarded" and everything after it is verbatim content,
which *"prevents models from accidentally including line-number metadata when copying text for
edit operations, reducing the likelihood of edit failures where `oldString not found in
content`"*. <https://github.com/anomalyco/opencode/pull/12030/files>

**This is the same conclusion the tokeniser reaches from first principles** (§3.3): move the
space out of the boundary, and the file's own indentation token survives intact. Measured, the
`N |` form is 99.9% token-transparent and 0% ambiguous. [M]

**An independent field report of our exact failure.** [W] paperclipai/paperclip issue #3014,
*"adapter-opencode-local should avoid numbered read output as apply_patch context"*: the model
receives `1: const foo = 1`, copies it into a patch context line, and
`apply_patch verification failed: Error: Failed to find expected lines in …`. The report notes
this *"can poison heartbeat retries because resumed sessions keep reusing the same bad
context"*. Requested fixes: a raw read path, stripping `^\s*\d+:\s` before patch use, or a
prompt rule. <https://github.com/paperclipai/paperclip/issues/3014>

**Note the contrast with our traces.** [M] In our runs, gutter residue appeared in **0 of all
failed hunks and old_strings, in every condition** (mechanism report §3). Our model strips the
number reliably; the open question was only what it does with the character after it. The
paperclip report is the harder failure — a weaker model failing to strip at all.

### 1.5 Aider — the strongest published statement against line numbers [W]

- **No aider edit format uses line numbers for addressing.** `whole` returns the file;
  `diff` and `diff-fenced` use SEARCH/REPLACE blocks matched exactly; `udiff` uses unified-diff
  hunks **with the `@@` line numbers removed**. <https://aider.chat/docs/more/edit-formats.html>
- The unified-diffs post states it directly:

  > "GPT is terrible at working with source code line numbers. This is a general observation
  > about *any* use of line numbers in editing formats, backed up by many quantitative
  > benchmark experiments."

  and

  > "Aider tells GPT not to include line numbers, and just interprets each hunk from the
  > unified diffs as a search and replace operation."

  Measured effect on the laziness/refactoring benchmark: **20% → 61%**, and lazy-comment
  instances fell from 12 tasks to 4. <https://aider.chat/2023/12/21/unified-diffs.html>
- The code-editing leaderboard reports a second metric, *"percent using correct edit format"*,
  which is the malformed-edit rate. Top models reach 99.2% on `diff`; `whole` is 100% by
  construction; gemini-exp-1206 scores 84.2% with `diff` against 100% with `whole` — the format
  compliance gap is model-specific. <https://aider.chat/docs/leaderboards/edit.html>

**How to read this against our case.** [I] Aider's claim is about line numbers **inside the
edit format** — asking the model to *emit* `@@ -2,4 +3,5 @@`. Our gutter is line numbers in the
**read output**, which the model must *strip*. These are different asks and the literature
splits on them (§2). Aider's evidence does not argue against a read gutter.

### 1.6 SWE-agent — the ACI paper, and its ablations [W]

<https://arxiv.org/abs/2405.15793> · HTML: <https://arxiv.org/html/2405.15793v2>

- **File viewer: 100 lines per window, line numbers prepended to every visible line**, plus a
  count of lines omitted before and after the window.
- **Edit command uses line-range addressing** — start line, end line, replacement text. Line
  numbers are the *only* address; there is no string anchor.
- A **flake8 linter guardrail** rejects an edit that introduces a syntax error
  (F821, F822, F831, E111-E113, E999, E902); the edit is not executed.
- Ablations on SWE-bench Lite: linting **18.0%** with against **15.0%** without; window size
  **100 lines 18.0%**, 30 lines 14.3%, whole file 12.7%; search interface summarised 18.0%,
  iterative 12.0%, none 15.7%.
- Failed edits are common: **1,185 of 2,942 (51.7%)** GPT-4-Turbo trajectories contain at least
  one failed edit, and recovery probability after one failed edit drops to 57.2% from a 90.5%
  baseline.

**Relevance.** [I] SWE-agent is the strongest existing case *for* numbering the read surface —
it numbers everything and addresses edits by number. It is also the design in which a wrong
number is catastrophic rather than merely a failed match.

### 1.7 OpenHands — `str_replace_editor` and the reported line-number bug [W]

- The editor is `openhands-aci`'s `file_editor`, an implementation of Anthropic's
  `str_replace_based_edit_tool` contract (`view` / `str_replace` / `create` / `insert`), with
  `view_range`. <https://github.com/OpenHands/openhands-aci>
- **The failure is reported explicitly.** All-Hands-AI/OpenHands issue #7888,
  *"[Bug]: Line numbers are often included in `str_replace` commands"*:

  > "It checks the file content via `cat -n`. The output includes line numbers (due to `-n`).
  > It calls `str_replace` but it includes the line numbers in the argument strings. This
  > results in the `str_replace` command not finding a match in the file and therefore not
  > replace anything."

  Closed as stale / not planned. <https://github.com/All-Hands-AI/OpenHands/issues/7888>
- **There is whitespace tolerance, added later.** `openhands-aci` 0.3.2 release notes include
  *"strip whitespace if no occurrences are found in `str_replace`"* and *"clamp `view_range`
  end to file length with warnings instead of errors"*.
  <https://github.com/All-Hands-AI/openhands-aci/releases>
- Also reported: users asking for a line-number argument on `str_replace` so the uniqueness
  constraint can be bypassed (issue #8112), and `str_replace` failures with local Qwen3-coder
  and Devstral (#10039, #8958).

**Relevance.** [I] OpenHands is the closest analogue to our claude-code arm — a `cat -n` read
into an exact-match string edit — and it hit the same class of failure. Its chosen mitigation
was a *whitespace-stripping fallback in the tool*, not a delimiter change.

### 1.8 Gemini CLI [W]

<https://google-gemini.github.io/gemini-cli/docs/tools/file-system.html>

- `read_file` takes `offset` (0-based line) and `limit`; default maximum around 2,000 lines;
  truncation is announced in-band, e.g.
  `[File content truncated: showing lines 1-100 of 500 total lines...]`.
- `replace` requires *"The exact literal text to replace"* which *"must uniquely identify the
  single instance to change"*, with several lines of context either side.
- **Unique among these tools, it has a model-in-the-loop repair pass:** *"To significantly
  improve the success rate of edits, especially when the model-provided `old_string` might not
  be perfectly precise, the tool incorporates a multi-stage edit correction mechanism … the
  tool can leverage the Gemini model to iteratively refine `old_string`."*

**Relevance.** [I] Gemini CLI treats anchor imprecision as expected and pays a second model call
to fix it. That is the opposite trade from Claude Code's zero-tolerance exact match.

### 1.9 Cline and Cursor [W]

- **Cline** uses `replace_in_file` with SEARCH/REPLACE blocks matched exactly; the
  well-documented complaint is that it *"frequently fails because the SEARCH block requires an
  exact character-by-character match … even with minor differences like whitespace or line
  endings"* (issues #3183, #4011, #7600, #8779, #2126).
- Cline's own engineering post reports **>10% average improvement in `diffEditSuccess`** from
  two changes: an **order-invariant multi-diff apply** algorithm, and **model-specific diff
  formats** (`--/+++` markers for Anthropic models, `>>>/<<<` blocks for Gemini and xAI).
  Per-model gains: Claude 3.5 Sonnet ~25%, GPT-4.1 >21%, Claude Opus 4 ~15%. The root cause
  named is that *"many LLMs, despite being explicitly prompted to produce diffs in the correct
  order, would often return them out of sequence."*
  <https://cline.bot/blog/improving-diff-edits-by-10>
- **Cursor** splits the problem: the frontier model writes *what* to change and a separate
  fast **apply model** integrates it into the file, typically with speculative decoding over
  the original file. No line numbers are involved in the addressing.

**Relevance — this is the most actionable external result in the whole review.** [I] Cline's
number-one fix, worth >10% edit success, is **order invariance**, which is precisely the
`apply_patch` failure we measured on codex and opencode (moving forward-only `line_index`,
hunks out of file order — mechanism report §4.2). It is an *apply-side* fix, not a render-side
one, and it confirms the mechanism report's R7 reading: there is no render lever for those two
harnesses.

### 1.10 Summary of the contracts

| tool / harness | read numbering | edit addressing | whitespace tolerance on edit |
|---|---|---|---|
| **Claude Code 2.1.218** | `N<TAB>`, unpadded [C][M] | exact + unique `old_string` | **none** (only `\uXXXX` escape swap) [C] |
| Anthropic `str_replace_based_edit_tool` | reference `view` shows `N: ` [W] | exact + unique `old_str` | none documented [W] |
| **Codex CLI 0.146.1** | none of its own (model runs `sed -n`, `cat`, `nl`) [M] | `apply_patch` context hunks, moving forward index | 4-pass seek: exact → trim_end → trim → unicode [C] |
| **OpenCode 1.18.4** | `N: ` [C]; upstream moved `%05d\| ` → `%05d \|` [W] | `apply_patch` (used); `edit` with 9 fuzzy replacers (unused) [C][M] | same 4-pass seek [C] |
| Aider | none in any format | SEARCH/REPLACE blocks; udiff with `@@` numbers stripped [W] | format-dependent |
| SWE-agent | 100-line window, every line numbered [W] | **line ranges only** [W] | n/a — numeric address |
| OpenHands | `cat -n` style via `view` [W] | exact + unique `old_str`, `view_range` for read | whitespace-strip fallback since aci 0.3.2 [W] |
| Gemini CLI | offset/limit, no numbering documented [W] | exact + unique `old_string` | **model-in-the-loop repair pass** [W] |
| Cline | `read_file` | SEARCH/REPLACE, order-invariant apply since 2025 [W] | exact; per-model marker formats [W] |
| Cursor | n/a to the planner | separate apply model | n/a |

**The pattern.** [I] Every tool that addresses edits by **string** eventually grows a
tolerance — fuzzy replacers (OpenCode), whitespace stripping (OpenHands), a repair model
(Gemini CLI), order invariance (Cline), a four-pass seek (codex). **Claude Code is the only
one in this list with no tolerance at all**, which is exactly why it is the only harness where
the read delimiter has a measurable mechanism.

---

## 2. (b) Literature on line numbers, gutters, and formatting

**The field disagrees, and the disagreement is explained by where the number sits.**

**Line numbers in the *output* format hurt.** [W] Aider's position (§1.5) is the strongest
statement, and it is about the model *emitting* numbers. Diff-XYZ (arXiv:2510.12487, 2025)
qualifies it: comparing `udiff` (with `@@ -a,b +c,d @@` numbers), `udiff-h` (headers with
numbers removed), `udiff-l` (verbose ADD/DEL/CON markers) and `search-replace`, it finds
**search-replace strongest overall** (GPT-4.1 diff generation, 0.95 exact-match against 0.81
for udiff), and verbose markers catastrophic (udiff-l 0.08). But it also finds that removing
the numeric headers **degrades** performance, because *"standard udiff hunk headers … provide
numeric anchors and implicit ordering cues … they act as scaffolding that encourages hunks to
be segmented and emitted in file order."* <https://arxiv.org/html/2510.12487v2>

**Line numbers in the *input* help.** [W] SWE-Fixer (Findings of ACL 2025, arXiv:2501.05040)
ablates the editor model's input on SWE-bench Lite, Table 4: default (full file content **with**
line numbers) **20.0% resolved**; **"Remove Line Number" 14.0%** — a 6.0-point drop, the largest
single ablation in the table (only classes and functions: 18.0%; adding readme: 19.0%). The
authors' reading: *"Including line numbers acts as an anchor, helping LLMs locate and edit
specific code snippets more effectively."* Their editor emits JSON with the original block
**with** line numbers and the modified block **without** them.
<https://arxiv.org/html/2501.05040v2>

**Together these two results are the design rule.** [I] Number what the model *reads*; do not
make it *write* numbers. That is exactly what our benchmark does — the gutter is read-side, and
every edit surface is string- or context-anchored. It is also, independently, what Claude Code
does (`view_range` to read, `old_string` to write) and what SWE-Fixer does.

**The agent-computer-interface literature.** SWE-agent (arXiv:2405.15793, §1.6) is the founding
ACI ablation: window size and a linting guardrail each move SWE-bench Lite by 3 points, and
51.7% of trajectories contain a failed edit. Its lesson is that **interface design is worth as
much as model choice at the margin**, which is the premise of this whole programme. [W]

**Search-and-replace edit failure, measured in production.** Cline's >10% `diffEditSuccess`
gain from order-invariant apply plus per-model markers (§1.9) is the only published production
A/B on this axis I found. Its headline cause — hunks emitted out of file order — matches the
second of the two failure classes we measured on codex and opencode. [W]

**Tokenisation of whitespace and indentation.** [W] Pan et al. 2025, *"The Hidden Cost of
Readability: How Code Formatting Silently Consumes Your LLM Budget"* (arXiv:2508.13666),
measures formatting's share of the token count over four languages and ten models with
fill-in-the-middle on McEval: removing formatting cuts input tokens by **25.8% on average**
(Java 14.7%, C# 13.2%, C++ 13.2%, Python 4.0% — Python is low because its indentation is
syntax). Accuracy is **essentially unchanged**: DeepSeek-V3 averaged 79.1% Pass@1 formatted
against 80.0% unformatted. Output tokens fall only 2.5%, which caps the saving.
<https://arxiv.org/html/2508.13666v1>

**Token boundaries and the leading-space token.** [W] Hamilton and Mimno 2025, *"Lost in Space:
Finding the Right Tokens for Structured Output"* (arXiv:2502.14969), is the closest published
account of our mechanism. Tokenisers keep separate space-prefixed and non-prefixed variants of
the same string; when generation is constrained or the boundary is misaligned, a model
substitutes one variant for the other and emits syntactically wrong output. They call the
failure to recover a failure of **token healing**, and the mitigation is to make the constraint
engine aware of both variants. <https://arxiv.org/pdf/2502.14969>

**Our case is the uncontrolled version of the same thing.** [I] Nothing constrains our
decoding; the model simply reproduces the whitespace token it saw. Under a space-terminated
gutter, the token it saw is one space longer than the file's. §3.3 shows the bytes.

**Prompt caching, and why gutter tokens are nearly free.** [W] Anthropic prices a cache write
at 1.25x input and a cache read at 10% of input (a 90% discount), with a 5-minute default TTL;
OpenAI caches automatically above a 1,024-token stable prefix and bills the cached prefix at a
discount. This benchmark's own price table follows the same shape — `$0.10/M` newly-sent input
against `$0.01/M` cached re-sent input (`harness/ideal-cost.mjs`). A tool result is appended to
the prefix, so its tokens are billed **once at full price and thereafter at a tenth**. §3.5
turns that into dollars.

---

## 3. (c) Tokeniser micro-study — measured

**Encoder.** `tiktoken` `o200k_base`, vocabulary 200,019. **The exact tokenizer of
`openai/gpt-5.6-luna` is not public.** `o200k_base` is the public encoding of the GPT-4o /
GPT-4.1 / GPT-5 / o-series families; `o200k_harmony` (201,088 tokens, released with gpt-oss)
extends it only with special tokens for the Harmony chat format, so the byte-level merges that
govern whitespace are the same. [W] Treat every count below as the best available public proxy,
not as the billed count.

**Corpus.** Five real golden files fetched from `/root/.ss-eval/golden/` — the four that carried
the failures in the mechanism report, plus a tab-indented Go file:

| file | lines | bytes | indentation |
|---|---:|---:|---|
| `underscore.js` (jashkenas/underscore) | 1,688 | 58,221 | spaces (1,491 lines) |
| `detect_mistakes.R` (rstudio-education/gradethis) | 391 | 11,975 | spaces (340) |
| `grade_code.R` (same) | 167 | 5,515 | spaces (78) |
| `traceback.py` (pytask-dev/pytask) | 100 | 2,931 | spaces (46) |
| `eth.go` (0xPolygonHermez/zkevm-node) | 706 | 23,387 | **tabs (458)** |
| **total** | **3,052** | **101,929** | 64.1% space-indented |

### 3.1 Cost per line, all forms [M]

`scripts/r1-gutter-tokens.py`, aggregate over all 3,052 lines. Blocks are tokenised whole (as
they reach the model), not line by line.

| form | example | tokens/line | overhead/line | ratio |
|---|---|---:|---:|---:|
| none | `res <- f(` | 8.516 | — | 1.000 |
| **`N<TAB>` (shipped)** | `35→res <- f(` | **9.997** | **+1.481** | **1.174** |
| `N ` (single space) | `35 res <- f(` | 9.913 | +1.398 | 1.164 |
| `N:` (no trailing space) | `35:res <- f(` | 10.703 | +2.187 | 1.257 |
| `N\|` (no trailing space) | `35\|res <- f(` | 10.741 | +2.225 | 1.261 |
| `N \|` (space before pipe) | `35 \|res <- f(` | 10.754 | +2.238 | 1.263 |
| `N\| ` (the PIPE arm) | `35\| res <- f(` | 10.913 | +2.398 | 1.282 |
| `N: ` (opencode's own) | `35: res <- f(` | 10.913 | +2.398 | 1.282 |
| `%05d \|` (opencode PR 12030) | `00035 \|res <- f(` | 11.528 | +3.012 | 1.354 |
| `%5d<TAB>` | `   35→res <- f(` | 11.771 | +3.256 | 1.382 |
| `%5d  ` (`cat -n`) | `   35  res <- f(` | 11.774 | +3.258 | 1.383 |
| **sparse, every 5th line, tab** | | **8.816** | **+0.300** | **1.035** |
| **sparse, every 10th line, tab** | | **8.663** | **+0.148** | **1.017** |
| **landmark (symbol starts only, tab)** | | **8.582** | **+0.067** | **1.008** |

Per-file overheads vary from +1.14 (detect_mistakes.R, deeply indented R) to +1.57 (eth.go)
tokens per line for the tab; the ranking of forms is identical in every file.

**Reading it.** [M] `N<TAB>` is the cheapest *dense* form that is also boundary-safe (§3.4).
`N ` is 0.083 tokens/line cheaper but ambiguous. Every zero-ambiguity alternative to the tab —
`N:`, `N|`, `N |` — costs about **+0.71 to +0.76 tokens per line more**, roughly a 48% higher
gutter overhead. Padding is the worst possible choice on both axes and costs more than double
the tab's overhead.

**Sparse and landmark numbering collapse the cost.** Numbering one line in ten costs 10% of
what numbering every line costs; numbering only symbol starts costs 4.5%.

### 3.2 Where the token boundaries fall [M]

`scripts/r1-gutter-tokens.py` PART 2. `·` = space, `\t` = tab, each `[…]` is one token,
rendered in context (a preceding numbered line, then the probe line).

**No gutter — the baseline the model must reproduce:**

```
  0sp: [res] [·<-] [·detect] [_m] [ist] [akes] [(]
  2sp: [·] [·res] [·<-] …
  4sp: [···] [·res] …
  6sp: [·····] [·res] …
  8sp: [·······] [·res] …
  tab: [\tif] [·err] [·!=] [·nil] [·{]
 2tab: [\t] [\treturn] [·nil] [,] [·err]
```

Note the invariant: with *n* leading spaces, o200k_base emits an **(n−1)-space token** followed
by `·word`, because the word token carries its own leading space.

**`N<TAB>` — the tab absorbs the run but is never mistaken for it:**

```
  0sp: [35] [\tres] [·<-] …
  2sp: [35] [\t·] [·res] …
  4sp: [35] [\t···] [·res] …
  6sp: [35] [\t·····] [·res] …
  8sp: [35] [\t·······] [·res] …
  tab: [35] [\t] [\tif] [·err] …
 2tab: [35] [\t\t] [\treturn] …
```

**`N| ` — the delimiter's space joins the indentation, and the run is one longer:**

```
  0sp: [35] [|] [·res] [·<-] …
  2sp: [35] [|] [··] [·res] …          <- file's own token is [·]
  4sp: [35] [|] [····] [·res] …        <- file's own token is [···]
  6sp: [35] [|] [······] [·res] …      <- file's own token is [·····]
  8sp: [35] [|] [········] [·res] …    <- file's own token is [·······]
  tab: [35] [|] [·] [\tif] …
 2tab: [35] [|] [·\t] [\treturn] …
```

`N: `, `N `, and `%5d  ` are identical in shape to `N| ` here. `N:`, `N|`, `N |` and `%05d |`
all reproduce the no-gutter run exactly.

### 3.3 The merge test — the mechanism for the +1 carry [M]

`scripts/r1-gutter-tokens.py` PART 3 asks one question per form and indent: **is there a token
boundary between the gutter delimiter and the code's own indentation?**

| form | 2sp | 4sp | 6sp | 8sp | tab-indent | verdict |
|---|---|---|---|---|---|---|
| `N<TAB>` | `\t·` | `\t···` | `\t·····` | `\t·······` | `\t` | fused, **but marked by `\t`** |
| `N| ` | `··` | `····` | `······` | `········` | `·` | **fused, unmarked** |
| `N: ` | `··` | `····` | `······` | `········` | `·` | **fused, unmarked** |
| `N ` | `··` | `····` | `······` | `········` | `·` | **fused, unmarked** |
| `%5d  ` | `···` | `·····` | `·······` | `·········` | `··` | **fused, unmarked** |
| `%5d<TAB>` | `\t·` | `\t···` | `\t·····` | `\t·······` | `\t` | fused, marked |
| **`N:`** | `:` | `:` | `:` | `:` | `:` | **not fused** |
| **`N|`, `N |`, `%05d |`** | `\|` / `·\|` | " | " | " | " | **not fused** |

**The mechanism, stated precisely.** [M]+[I]

Under `N| `, `N: `, `N `, or padded `cat -n`, the token immediately after the line number is a
**pure run of spaces exactly one longer than the run the file itself would produce**. Nothing
inside that token marks where the gutter stops and the content starts — it is homogeneous. A
model that copies the whitespace token it saw emits one space too many. That is the exact
signature the mechanism report measured on claude-code: `35|       res <- detect_mistakes(`
shown, `       res <- detect_mistakes(` attempted (7 spaces) against 6 on disk, every line of
the seven-line anchor +1; and 14 of 19 located sweet whitespace failures on 2026-08-11 exactly
+1, against 0 of 4 native.

**Does `<TAB>` stay a separate token? Only against tab-indented code.** [M] Against a
tab-indented file the gutter tab is its own token (`[35] [\t] [\tif]`) and the file's own
`[\tif]` survives untouched. Against space-indented code the gutter tab *does* fuse with the
following spaces — `[\t·····]` — but it **begins with a tab**, a character that cannot appear
inside a space-indented file's own indentation token. The strip boundary is therefore marked
*inside* the token by a character-class change. The model does not have to count. This is why
`N<TAB>` scores 0% ambiguous despite scoring only 24.3% transparent (§3.4).

Under `N:`, `N|`, `N |` the delimiter is its own token and the file's indentation token is
reproduced byte for byte. **No counting and no character-class reasoning is required.**

**Two real lines make the point better than the synthetic probes.** [M]
`detect_mistakes.R:2` carries 28 leading spaces:

```
none  : [···························] [·solution] [,]        <- 27-space token
tab   : [2] [\t] [···························] [·solution] [,]  <- SAME 27-space token
pipe  : [2] [|] [····························] [·solution] [,]  <- 28-space token
```

and `eth.go:4`, a tab-indented Go line:

```
none  : [\t] ["context] ["]
tab   : [4] [\t] [\t] ["context] ["]          <- file's own [\t] intact
pipe  : [4] [|] [·] [\t] ["context] ["]       <- an extra space token appears
```

### 3.4 Token transparency and ambiguity rates [M]

`scripts/r1-token-transparency.py` over all 3,052 lines. **Transparent** = the token sequence
covering the file's own text is identical to the no-gutter tokenisation. **Ambiguous** = the
delimiter's trailing space fused into a pure-space token (the +1 hazard).

| form | tokens/line | transparent | **ambiguous space run** |
|---|---:|---:|---:|
| none | 8.516 | 100.0% | 0.0% |
| **`N<TAB>` (shipped)** | **9.997** | 24.3% | **0.0%** |
| `N ` | 9.913 | 17.6% | **64.1%** |
| **`N:`** | 10.703 | **94.8%** | **0.0%** |
| **`N|`** | 10.741 | **99.9%** | **0.0%** |
| **`N |`** (opencode PR 12030) | 10.754 | **99.9%** | **0.0%** |
| `N| ` (PIPE arm) | 10.913 | 17.6% | **64.1%** |
| `N: ` (opencode's own) | 10.913 | 17.6% | **64.1%** |
| `%05d |` | 11.528 | **99.9%** | **0.0%** |
| `%5d<TAB>` | 11.771 | 24.3% | 0.0% |
| `%5d  ` (`cat -n`) | 11.774 | 17.9% | **64.1%** |

The ambiguous share equals the space-indented share of the corpus exactly (1,955 / 3,052 =
64.1%), because the hazard fires on every space-indented line and on no other. [M]

**`N<TAB>` scores low on transparency and zero on ambiguity, and only the second matters.**
Its non-transparency is the benign `[\t·····]` fusion; the tab marks the boundary. Reporting
transparency alone would rank the tab below the pipe, which is backwards.

**The frontier.** [M] Among dense forms there are exactly two non-dominated choices:

- **`N<TAB>`** — cheapest zero-ambiguity form, +1.481 tokens/line.
- **`N:` or `N|`** — fully token-transparent, +2.187 / +2.225 tokens/line.

Everything else is dominated. `N| ` costs more than `N|` *and* is ambiguous. `N ` is 0.08
tokens/line cheaper than the tab and 64% ambiguous. Padding costs double and buys nothing.

### 3.5 What the gutter actually costs, in dollars [M inputs, I arithmetic]

`scripts/r1-gutter-price.py`. Inputs: numbered lines per rollout from the mechanism report §5.1
(13 tasks × 3 reps = 39 rollouts: codex 15,360, opencode 18,632, claude-code 20,146 numbered
lines ⇒ 394 / 478 / 517 per rollout); tokens per line from §3.1; turns per rollout from the
fresh-pool report §3 (12.5 / 21.8 / 29.9); prices `$0.10/M` new, `$0.01/M` cached re-send. A
gutter token is billed once new and re-sent cached on the remaining turns; the table assumes a
read lands on average halfway through.

| harness | `$`/rollout | tab gutter `$` | tab as % of rollout | PIPE − TAB |
|---|---:|---:|---:|---:|
| codex | `$0.012330` | `$0.000092` | **0.75%** | **+0.46%** |
| opencode | `$0.009265` | `$0.000144` | **1.56%** | **+0.96%** |
| claude-code | `$0.020727` | `$0.000187` | **0.90%** | **+0.56%** |

Sensitivity on codex, varying how many turns the read survives: read on the last turn only
0.47% of rollout cost; halfway 0.75%; read on turn 1 and re-sent every turn 1.02%. The
tab-to-pipe difference spans +0.29% to +0.63% across the same range.

**This settles an open reading of the fresh-pool table.** [M][I] The fresh-pool run measured
codex PIPE at `$0.012754` against TAB's `$0.012330` — **+3.44%**. The gutter's own bytes can
account for at most +0.63% of that, and +0.46% on the central assumption — **13% to 18% of
the measured premium. Four fifths to seven eighths of the codex pipe premium is not gutter
tokens.** It is turn count or output tokens — behaviour, not bytes. The fresh-pool report's sentence *"pipe is ~0.9 tokens
per line dearer than tab, and at n=66 that shows where resolution differences do not"* is
directionally right and quantitatively too generous to the mechanism.

**And it bounds every render-side cost lever.** The entire gutter is under 1.6% of a rollout.
Dropping it altogether (`NONE`) cannot save more than that; sparse or landmark numbering saves
0.6-1.5%. No delimiter decision is worth more than a percent of spend. **If cost is the goal,
the gutter is the wrong place to look** — which is what the fresh-pool run concluded from the
other direction.

---

## 4. (d) Conclusions per harness, and candidate designs

### 4.1 What each harness's own contract expects

| harness | the delimiter its contract declares | what the tokeniser says | verdict |
|---|---|---|---|
| **claude-code** | **`N<TAB>`** — *"Strip the Read line prefix (line number + tab)"*, gate off; the gate-on variant widens to *"a tab or `:`"*. `\|` in neither. [C] | tab: cheapest zero-ambiguity form, +1.481 tok/line, 0% ambiguous. pipe: 64.1% ambiguous, +2.398. [M] | **Contract and tokeniser agree. Keep `N<TAB>`.** This is the only harness where the delimiter has a demonstrated mechanism, and both lines of evidence point the same way. |
| **codex** | none — codex provides no read tool; the model uses `sed -n`, `cat`, `nl`. `apply_patch` seek trims both sides on pass three. [C] | any fused space run is trimmed away before matching; ambiguity is unreachable. [C] | **The delimiter is mechanically inert.** Choose it on price alone ⇒ `N<TAB>`. The real codex constraint is the ~2,500-token output cap, and that is a `config.toml` key we never set (§1.3). |
| **opencode** | **`N: `** — *"each line prefixed by its line number as `<line>: <content>`"*. [C] Upstream has since moved its other numbering path from `%05d\| ` to `%05d \|`, away from a trailing space. [W] | `N: ` is one of the ambiguous forms (64.1%); its `apply_patch` trims, so ambiguity is again unreachable. [C][M] | **Inert, like codex.** Matching opencode's own `N: ` would cost +0.92 tok/line for zero mechanism. If contract-matching is ever wanted here, match the *fixed* upstream shape `N \|` or `N:`, not `N: `. |

### 4.2 Candidate new gutter designs

Each is stated with its mechanism, its measured cost, and the way it breaks. None should ship
on this document: the fresh-pool run establishes that resolution is flat across forms at
`p ≥ 0.72`, and §3.5 establishes the whole gutter is under 1.6% of spend. These are the
candidates worth *screening at `$0`*, ranked by expected effect per unit of risk.

**C-1 — `N:` (colon, no trailing space), everywhere.** [M][C]
*Mechanism.* The only form measured that is both zero-ambiguity **and** token-transparent: the
file's own indentation token is reproduced byte for byte on 94.8% of lines, and the delimiter
is its own token on 100%. It is contract-legal on claude-code under `tengu_tab_read_sep`, and
it is the delimiter Anthropic's API-level reference editor already uses (with a space).
*Cost.* +2.187 tokens/line against the tab's +1.481 — **+0.71 tok/line, about +0.4% of rollout
cost** (§3.5). One-line change to the `GUTTER_DELIMITER` enum in `core/search/search-read.js`.
*Risk.* [I] The gate is **off by default** in the deployed claude-code, so today the model is
told the separator is a tab and would have to generalise. Colon also collides with content:
`::` in R and Rust, `:` in YAML, Python annotations and Go labels; the 5.2% non-transparent
lines are exactly those collisions. Trading a 0% hazard for a 0% hazard at +48% gutter cost is
a bad trade **unless** the gate flips on, at which point it becomes the strictly safer form.
*Falsifier.* Re-read the claude-code binary at each version bump for `tengu_tab_read_sep`'s
default. Ship nothing until it is on.

**C-2 — `N |` (space *before* the pipe), if a pipe is ever wanted again.** [W][M]
*Mechanism.* The fix OpenCode already shipped (PR #12030), for our stated reason. Measured
99.9% transparent, 0% ambiguous.
*Cost.* +2.238 tokens/line — dearer than `N|` and `N:` for no additional safety.
*Risk.* Strictly dominated by `N|`. **Its value is as evidence, not as a design:** it shows an
independent team reached the same conclusion from field failures.
*Kill.* Already killed by C-1 and by its own cost. Recorded so it is not rediscovered.

**C-3 — sparse numbering: number every 5th or 10th line, tab-delimited.** [M]
*Mechanism.* The line number's job in our benchmark is *addressing* — letting the model target
a range read or name a span — not anchoring, because every edit surface is string- or
context-matched (§1.10). A landmark every 10 lines is enough to address a range to within 10
lines, and the model can count from it.
*Cost.* **+0.148 tokens/line at every-10th, +0.300 at every-5th** — 10% and 20% of the tab's
overhead. Saves 0.67-1.40% of rollout cost (§3.5). Unnumbered lines are 100% token-transparent
by construction.
*Risk.* [I] Untested and the risk is real: a model that must count from the nearest landmark to
build a `ss-read` window may read the wrong window, and the failure would show up as extra
turns, not as an edit error. Mixed numbered/unnumbered output inside one block is a new shape
the model has never seen from any harness.
*Falsifier at `$0`.* Count, across the fresh-pool traces, how many `ss-read` calls take a line
range that the model could only have obtained from a gutter line more than 5 (or 10) lines from
a landmark. If that count is near zero, sparse numbering is free.
*Kill.* Any increase in `ss-read` calls per rollout, or any anchor failure attributable to a
miscounted line.

**C-4 — header range plus unnumbered body.** [M][I]
*Mechanism.* Emit one `path:start-end` header per block and no per-line gutter. The model gets
the address once; the body is byte-identical to the file.
*Cost.* Effectively the `none` row plus one header line: **+0.02 to +0.05 tokens/line** for a
100-line block. The cheapest option measured.
*Risk.* [I] This is `NONE` with a header, and `NONE` is not a clean control: the mechanism
report found five roxygen transcription failures under `NONE` on claude-code, where the model
mis-copied a comment block it had seen without numbers. It was also the **worst** form on
opencode in the fresh-pool run (39/66). Two of three harnesses ranked it middling. Removing
per-line numbers also removes the model's ability to say "line 412" in a follow-up read.
*Falsifier.* The `NONE` arm of the fresh-pool run is already the falsifier and it did not clear
the bar. **Adding a header does not answer the roxygen failures**, which were about copying
body text, not about addressing.

**C-5 — landmark numbering at symbol starts, from the index.** [M][I]
*Mechanism.* sweet-search already knows where every symbol starts. Number only the lines that
open a function, class, method or type, tab-delimited; leave the body raw. The number then
marks something semantically meaningful instead of every line equally.
*Cost.* **+0.067 tokens/line** — 4.5% of the tab's overhead. Symbol starts were **153 of 3,052
lines (5.0%)**, ranging 1.0% (`detect_mistakes.R`) to 7.0% (`traceback.py`).
*Risk.* [I] Highest of the five. It removes addressing for the 99% of lines that are not symbol
starts, so any range read must be derived by counting; it makes the render depend on the
language parser, so a parse miss silently changes the format; and it produces a fourth distinct
shape for the model to interpret. It is also the design most likely to *look* elegant and
measure flat, which is how the last four levers in this programme died.
*Falsifier at `$0`.* Same as C-3, plus: what fraction of `ss-read` ranges in the fresh-pool
traces start at a symbol boundary? If most reads are already symbol-aligned, the loss is small.
*Kill.* Anything below "most".

**What not to do.** [M][C]
- Do not ship `N| ` or `N: `. Both are ambiguous on 64% of lines, both cost more than their
  unambiguous siblings, and neither appears in any harness contract in the form we render it.
- Do not pad. `%5d<TAB>` and `%5d  ` cost **+3.26 tokens/line**, more than double the tab, and
  padding buys nothing any harness asks for. The existing memory note (`read-gutter-tab`)
  already says this; the tokeniser now prices it.
- Do not chase the gutter for cost. It is under 1.6% of a rollout (§3.5).
- Do not attribute the fresh-pool codex PIPE `+3.44%` to gutter tokens. At most a seventh of it
  is (§3.5).

### 4.3 The one lever this review found outside the gutter

**Set `tool_output_token_limit` in codex's `config.toml`.** [C][M] It is a supported top-level
key in the deployed 0.146.1 build, documented as *"Token budget for storing individual
tool/function outputs in history"*, and the benchmark left it unset, so codex fell back to a
per-model policy that truncated `ss-read` output middle-out at about 2,500 tokens — 12 of 84
`ss-read` outputs under TAB, 11 of 89 under PIPE. Community configurations use 12,000-25,000.
This is a configuration change, it is orthogonal to the delimiter, and it removes the only
harness-specific constraint the gutter interacts with (a plain read crosses the cap at ~289
lines, tab at ~247, pipe at ~226).

**Caveat, stated because it cuts against the lever.** [M] The mechanism report already checked
the obvious follow-on — that truncation makes the model edit the missing middle from memory —
and found it nearly dead: 0 of 4 never-shown codex anchors under TAB and 0 of 2 under PIPE sat
inside a truncated span. So raising the cap is cheap and principled, but there is **no measured
failure waiting to be fixed by it**. Treat it as hygiene, and note that raising it *increases*
input tokens, so it is a cost regression by construction.

**And the strongest external signal points away from the render entirely.** [W] Cline's
production A/B attributes >10% of edit-apply success to **order-invariant multi-diff apply** —
the same forward-only-index failure we measured as 2 of 5 codex gradethis failures and 2 of 3
on opencode. That is an apply-side property of `apply_patch`, which we do not own on either
harness. It confirms the mechanism report's R7: for codex and opencode there is no render-side
lever, and the clause graveyard argues against a prompt one.

---

## 5. Corrections to statements in earlier documents of this programme

1. **"`config.toml` sets no limit" (mechanism report §1.2) is true of the deployment and false
   of the capability.** `tool_output_token_limit` is a supported top-level key in codex-cli
   0.146.1 and we did not set it. [C][M]
2. **"the tab is the cheapest gutter by 0.93 tokens per line" (mechanism report §5.4) should be
   read against the right comparator.** Over five files including a tab-indented one it is
   **0.916** tokens/line cheaper than `N| `, but only **0.706** cheaper than `N:` and **0.744**
   cheaper than `N|`, which are the forms that are actually safe. The tab's margin over the
   safe alternatives is 19-23% smaller than its margin over the pipe. [M]
3. **The claude-code Edit contract is not unconditionally "line number + tab".** It has a
   gate-selected variant that admits `:`. Any future statement of the form "the harness declares
   X" must name the gate and its default. [C]
4. **Reading the fresh-pool codex PIPE `+3.8%` (cell total) / `+3.44%` (per-rollout) as a
   token-cost effect over-attributes it by five to seven times.** [M][I]

---

## 6. Reproduction

**Local, no box access needed for the tokeniser work:**

```bash
python3 -m venv /tmp/tk && /tmp/tk/bin/pip install tiktoken
cd eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828
# fixtures: 5 golden files, see section 3 for their exact paths on the box
/tmp/tk/bin/python scripts/r1-gutter-tokens.py       <fixture-dir> --json logs/r1-tokens.json
/tmp/tk/bin/python scripts/r1-token-transparency.py  <fixture-dir>
/tmp/tk/bin/python scripts/r1-gutter-price.py
```

Fixtures were copied with `scp` from `root@167.233.69.121`:

```
/root/.ss-eval/golden/jashkenas__underscore@4bd6f69b.../underscore.js
/root/.ss-eval/golden/rstudio-education__gradethis@2e64380c.../R/grade_code.R
/root/.ss-eval/golden/rstudio-education__gradethis@2e64380c.../R/detect_mistakes.R
/root/.ss-eval/golden/pytask-dev__pytask@30227332.../src/_pytask/traceback.py
/root/.ss-eval/golden/0xPolygonHermez__zkevm-node@a742325d.../jsonrpc/eth.go
```

**Contract reading on the box (read-only, scratch under `/tmp/fp-inv/r1/`):**

```bash
CC=/root/.local/share/claude/versions/2.1.218
strings -n 8 $CC > /tmp/fp-inv/r1/cc.strings
grep -n "a single tab or" /tmp/fp-inv/r1/cc.strings
OFF=$(grep -aob 'let r=t?"line number + a single separator' $CC | cut -d: -f1)
dd if=$CC bs=1 skip=$((OFF-1800)) count=2200 | tr -d '\000'   # the Edit prompt builder
grep -aob 'FPt=' $CC                                          # -> Xe("tengu_tab_read_sep", !1)

CX=/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex
strings -n 8 $CX | grep -iE 'truncated output|max_output_tokens|token budget'
grep -aob 'tool_output_token_limit' $CX      # the ConfigToml field list
cat /root/.codex/config.toml                 # confirms it is unset

OC=$(readlink -f $(which opencode))
strings -n 12 $OC | grep -n 'prefixed by its line number'
```

**Primary sources cited**

Tool contracts and vendor documentation:
<https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool> ·
<https://learn.chatgpt.com/docs/config-file/config-reference> ·
<https://github.com/openai/codex/pull/19247> ·
<https://github.com/openai/codex/issues/6426> ·
<https://github.com/openai/codex/issues/20861> ·
<https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/tools/handlers/unified_exec.rs> ·
<https://opencode.ai/docs/tools/> ·
<https://github.com/anomalyco/opencode/pull/12030/files> ·
<https://github.com/paperclipai/paperclip/issues/3014> ·
<https://aider.chat/docs/more/edit-formats.html> ·
<https://aider.chat/docs/leaderboards/edit.html> ·
<https://aider.chat/2023/12/21/unified-diffs.html> ·
<https://github.com/OpenHands/openhands-aci> ·
<https://github.com/All-Hands-AI/OpenHands/issues/7888> ·
<https://github.com/All-Hands-AI/openhands-aci/releases> ·
<https://google-gemini.github.io/gemini-cli/docs/tools/file-system.html> ·
<https://cline.bot/blog/improving-diff-edits-by-10> ·
<https://github.com/cline/cline/issues/3183>

Literature:
<https://arxiv.org/abs/2405.15793> (SWE-agent, ACI) ·
<https://arxiv.org/html/2405.15793v2> ·
<https://arxiv.org/html/2501.05040v2> (SWE-Fixer, Findings of ACL 2025) ·
<https://aclanthology.org/2025.findings-acl.62.pdf> ·
<https://arxiv.org/html/2510.12487v2> (Diff-XYZ, 2025) ·
<https://arxiv.org/html/2508.13666v1> (Hidden Cost of Readability, Pan et al. 2025) ·
<https://arxiv.org/pdf/2502.14969> (Lost in Space, Hamilton & Mimno 2025) ·
<https://arxiv.org/pdf/2511.04486> (EDIT-Bench, 2025 — cited for existence only; its failure
taxonomy could not be verified from the fetched text and should not be quoted) ·
<https://modal.com/blog/what-is-o200k-harmony> (o200k_base vs o200k_harmony)

---

## 7. What I could not finish, and why

- **EDIT-Bench (arXiv:2511.04486) is cited but not relied on.** The fetched summary asserted a
  line-number and whitespace failure taxonomy that I could not locate in the retrieved text.
  It is listed so a later session can check the PDF directly; no claim in this document rests
  on it.
- **The exact numeric `limit` inside codex's per-model `TruncationPolicyConfig` was not
  recovered.** The struct name, its two fields (one named `limit`), and the fact that
  `unified_exec` respects it are all [C]; the value for `openai/gpt-5.6-luna` over OpenRouter
  is only bounded empirically at 2,459 < cap ≤ 2,511 tokens by the prior investigation's 665
  outputs. Setting `tool_output_token_limit` makes the value moot.
- **`openai/gpt-5.6-luna`'s tokenizer is not public**, so every token count is an `o200k_base`
  proxy. The *ranking* of forms is robust to the choice — it follows from BPE's greedy
  whitespace-run merges, which `o200k_base` and `o200k_harmony` share — but the absolute
  overheads could differ.
- **No opencode `read` line/character limits were recoverable** from the 1.18.4 binary strings;
  the public docs do not state them either. The declared prefix `<line>: <content>` is [C] and
  solid; the limits are unknown.
