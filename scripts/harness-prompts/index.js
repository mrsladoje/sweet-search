/**
 * The Codex and opencode system prompts that `sweet-search init` ships, and the edit tables that
 * build them. SINGLE SOURCE OF TRUTH: the task-completion benchmark imports these texts
 * (eval/task-completion-bench/harness/trim/batch-variants.mjs, opencode-task-runner.mjs,
 * codex-task-runner.mjs), so the benchmarked arm and the shipped files cannot drift apart.
 * Claude Code's shipped text lives in ../install-claude-lean-harness.js for the same reason.
 *
 * What ships (the benchmark arm it reproduces):
 *   Codex    CODEX_HARNESS_TRIM=conflict + CODEX_TRIM_BATCH=yt3batch2
 *            codex 0.146.1's own base instructions minus the `rg` search steer, with the two
 *            tool-grouping lines replaced by ours (codexInstructions()).
 *   opencode OC_HARNESS_TRIM=conflict3+todo3eff3k
 *            opencode 1.18.4's gpt-family prompt minus the Glob/Grep bullet and " - especially
 *            file reads", plus our todowrite and efficiency lines (opencodePrompt()); the grep
 *            tool and the explore subagent off; tool-description edits (OPENCODE_TOOL_EDITS)
 *            applied by opencode-trim-plugin.mjs.
 *
 * Third-party text and licences: NOTICE.md in this directory.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_PROMPTS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Apply [find, replace] pairs in order; each find must occur exactly once, so a changed upstream
 * text fails loudly instead of shipping a half-edited prompt.
 */
export function applyExactEdits(text, edits, label = 'prompt edit') {
  let out = text;
  for (const [from, to] of edits) {
    const at = out.indexOf(from);
    if (at < 0 || out.indexOf(from, at + 1) >= 0) {
      throw new Error(`${label}: text "${from.slice(0, 50)}..." not found exactly once`);
    }
    out = out.replace(from, () => to);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Codex (0.146.1, gpt-5.6-luna base instructions)
// ---------------------------------------------------------------------------------------------

export const CODEX_INSTRUCTIONS_SOURCE = join(HARNESS_PROMPTS_DIR, 'codex-0.146.1-instructions-conflict-gpt-5.6-luna.md');

// The two stock tool-grouping lines. The shipped form keeps both and adds two of ours.
export const CODEX_PARALLEL_LINE = '- When possible, prefer parallelization over sequential tool calls, as this will help with round-trip latency and let you get work done faster.';
export const CODEX_CHAIN_LINE = "- Do not chain shell commands with separators like `echo \"====\";` or `printf '---'`; the output becomes noisy in a way that makes the user's side of the conversation worse.";
export const CODEX_BATCH_BASE = `${CODEX_PARALLEL_LINE}\n${CODEX_CHAIN_LINE}`;
// yt3: a cell returns after 10 s unless its first line sets a longer limit; one fenced cell to
// copy, so a long build or test run comes back in the same turn.
export const CODEX_YIELD_TEMPLATE3 = '- An exec cell returns after 10 seconds unless its first line sets a longer limit. For a command that ends by itself but takes longer than 10 seconds, such as a build or a test run, copy this cell exactly, both lines, and replace <command>:\n```\n// @exec: {"yield_time_ms": 600000}\nconst r = await tools.exec_command({cmd: <command>, yield_time_ms: 300000}); text(r.output); if (r.session_id) text((await tools.write_stdin({session_id: r.session_id, chars: "", yield_time_ms: 300000})).output);\n```\nWithout the first line the cell returns after 10 seconds; without the write_stdin step the result is lost. Do not use this form for a command that keeps running until it is stopped or that waits for input, such as a dev server, a watch mode or an interactive prompt.';
// batch2: known read-only commands go into one exec_command; builds, tests, installs and
// file-changing commands stay separate.
export const CODEX_READ_BATCH2 = '- When you already know several read-only commands you need, such as searches, file reads or listings, run them in one exec_command joined with `;` and read all the output in one turn. Keep a command whose output decides your next step on its own, and run builds, tests, installs and commands that change files separately.';
export const CODEX_SHIPPED_BATCH_LINES = `${CODEX_BATCH_BASE}\n${CODEX_YIELD_TEMPLATE3}\n${CODEX_READ_BATCH2}`;

/** Strip the leading `<!-- … -->` licence header; the model never sees it. */
export function stripLicenseHeader(text) {
  return text.replace(/^<!--[\s\S]*?-->\n/, '');
}

/** The Codex base instructions `init --codex` ships (model_instructions_file). */
export function codexInstructions() {
  const text = stripLicenseHeader(readFileSync(CODEX_INSTRUCTIONS_SOURCE, 'utf8'));
  return applyExactEdits(text, [[CODEX_BATCH_BASE, CODEX_SHIPPED_BATCH_LINES]], 'codex instructions');
}

// ---------------------------------------------------------------------------------------------
// opencode (1.18.4, gpt-family prompt)
// ---------------------------------------------------------------------------------------------

export const OPENCODE_GPT_ORIGINAL = join(HARNESS_PROMPTS_DIR, 'opencode-1.18.4-prompt-gpt-original.txt');
export const OPENCODE_TRIM_PLUGIN_SOURCE = join(HARNESS_PROMPTS_DIR, 'opencode-trim-plugin.mjs');

// Conflicts with the rules: the stock bullet that steers search to the Glob/Grep tools, and the
// file-reads clause of the parallel bullet.
export const OPENCODE_CONFLICT_PROMPT_BULLET = '- When searching for text or files, prefer using Glob and Grep tools (they are powered by `rg`)\n';
export const OPENCODE_FILE_READS_EDIT = Object.freeze([' - especially file reads', '']);
// The stock parallel bullet; our lines go after it.
export const OPENCODE_BATCH_BULLET = '- Parallelize tool calls whenever possible - especially file reads. Use `multi_tool_use.parallel` to parallelize tool calls and only this. Never chain together bash commands with separators like `echo "====";` as this renders to the user poorly.';
// todo3: todowrite goes with the next tool call, never in a turn of its own.
export const OPENCODE_TODO3_LINE = '- Send todowrite as a parallel call in the same turn as your next tool call, never as a turn of its own. Mark a step in_progress in the call that starts it, and completed in the call that starts the next one; mark the last step completed together with your final check.';
// General bounded-efficiency line, request-neutral (answers and plans are their own outcomes).
export const EFFICIENCY_LINE_3 = '- Work efficiently: start from what the request and any error output point to, and open more only when the evidence requires it. Do what the request asks, whether an answer, a plan or a change, and nothing unrelated. For requests that need code changes, make the change that fully solves the request, including the edits it needs elsewhere, check it with the checks the project has, again after each fix, and stop when it is done. For a question, answer from the evidence you gathered.';

/** The opencode build/general agent prompt `init --opencode` ships. */
export function opencodePrompt() {
  const original = readFileSync(OPENCODE_GPT_ORIGINAL, 'utf8');
  const prompt = applyExactEdits(original, [
    [OPENCODE_CONFLICT_PROMPT_BULLET, ''],
    [OPENCODE_BATCH_BULLET, `${OPENCODE_BATCH_BULLET}\n${OPENCODE_TODO3_LINE}\n${EFFICIENCY_LINE_3}`],
  ], 'opencode prompt');
  if (!prompt.includes(OPENCODE_FILE_READS_EDIT[0])) throw new Error('opencode prompt: "especially file reads" not found');
  return prompt.split(OPENCODE_FILE_READS_EDIT[0]).join(OPENCODE_FILE_READS_EDIT[1]);
}

// Tool-description edits (opencode-trim-plugin.mjs applies them through `tool.definition`).
// Only text that contradicts the ss-* rules or names the disabled grep tool / Task delegation.
export const OPENCODE_TOOL_EDITS = Object.freeze({
  bash: [
    ['IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.\n\n', ''],
    [' or Grep to search the full content', ''],
    ['  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands,', '  - Avoid using Bash with the `find`, `sed`, `awk`, or `echo` commands,'],
    ['    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n', ''],
  ],
  read: [
    ['- Use the grep tool to find specific content in large files or files with long lines.\n', ''],
    ['- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.\n', ''],
  ],
  task: [['use the Grep tool instead, to find the match more quickly', 'search for it directly instead, to find the match more quickly']],
  glob: [['- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead\n', '']],
});
