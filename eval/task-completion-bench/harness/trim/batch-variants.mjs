// Batching-line micro-smoke variants (2026-09-26, handoffs/improve/harness-prompt-trim/BATCH-SMOKE.md).
// SWEET ARM ONLY research switches. Each variant changes ONE place in the harness's own prompt:
// the sentence that says how to group tool calls. The rules file, the frame, the override and
// native are untouched. Codex and opencode ship a "do not chain shell commands" sentence that
// works against batching; Claude Code's lean prompt ships the max-batch line.
//   CODEX_TRIM_BATCH=unchain|dep|two|plan   (with CODEX_HARNESS_TRIM=v3)
//   OC_HARNESS_TRIM=batch-unchain|batch-dep|batch-two|batch-plan   (untrimmed opencode otherwise)
//   CC_TRIM_BATCH=two|plan|amp              (with CC_HARNESS_TRIM=product)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const dep = shell => `Combine dependent shell steps into one ${shell} call where you can, for example an edit made with a short script together with the command that checks it.`;
const two = shell => 'Save turns by batching. Independent calls, such as reads and searches you already know you need, go out together in one turn as parallel tool calls. '
  + `Dependent shell steps whose intermediate output you do not need to read, such as an edit and the command that checks it, go into one ${shell} call joined with \`&&\`. `
  + 'Make a separate call only when you must see a result before you can choose the next step.';
const PLAN = 'Before each turn, work out every read and check you already know you will need, and include all of them in that turn instead of fetching one file per turn.';

// Round 5 (trace analysis 2, 2026-09-27 04:40): lines on top of each harness's candidate.
const R5_FIND = '- If you need the code at an exact name, not only where it is, use `ss-find "<what it does>" --regex "\\bName\\b"`: it returns the code blocks, so no separate ss-read turn is needed.';
const R5_ALT = '- When you guess at a name that may not exist, put every spelling you would try into one regex alternation `(a|b|c)` in a single ss-grep, not one guess per turn.';

// --- Codex (v3 instructions for gpt-5.6-luna) ---
const CODEX_PAR = '- When possible, prefer parallelization over sequential tool calls, as this will help with round-trip latency and let you get work done faster.';
const CODEX_CHAIN = "- Do not chain shell commands with separators like `echo \"====\";` or `printf '---'`; the output becomes noisy in a way that makes the user's side of the conversation worse.";
// Round 2 (web research + trace counts, 2026-09-26): Luna runs Codex in code mode with
// parallel_tool_calls=false, so "parallel tool calls" names a mechanism it cannot use; batching
// happens only inside one exec cell (Promise.allSettled — openai/codex#35050: ~50% fewer model
// cycles). And a cell yields after 10 s whatever the command's own yield_time_ms says, so every
// long run_tests cost a `wait` turn (13-22 per 4 rollouts); the first-line pragma fixes that.
// These ADD lines to v3; both v3 lines stay.
const CODEX_PALL = '- In one exec cell, run tool calls that do not depend on each other at the same time: `const rs = await Promise.allSettled([tools.exec_command({...}), tools.exec_command({...})])`, then read every result. Keep edits, and calls that need an earlier result, in order.';
const CODEX_YIELD = '- An exec cell yields after 10 seconds unless its first line sets a longer limit. For a long command such as the test suite, start the cell with `// @exec: {"yield_time_ms": 600000}`, and in the same cell, if exec_command returns a session_id, await one `tools.write_stdin({session_id, yield_time_ms: 300000})` before you print the result, so the complete result comes back in one turn.';
// Trace analysis: 59 of 621 Codex turns were an edit followed by the check in the next turn.
// v3 forbids shell-script edits, so the round-1 "dep" example could not apply; this names apply_patch.
const CODEX_INCELL_DEP = '- When a check follows an edit, do both in one exec cell: await tools.apply_patch(patch), then run the check with tools.exec_command, and print both results.';
const CODEX_YIELD_TEMPLATE = '- For a long command such as the test suite, use one cell of this form: first line `// @exec: {"yield_time_ms": 600000}`, then `const r = await tools.exec_command({cmd: <command>, yield_time_ms: 300000}); text(r.output); if (r.session_id) text((await tools.write_stdin({session_id: r.session_id, chars: "", yield_time_ms: 300000})).output);` A cell that ends without the write_stdin step returns before the command finishes, and its result is lost.';
const CODEX_BASE = `${CODEX_PAR}\n${CODEX_CHAIN}`;
export const CODEX_BATCH_VARIANTS = Object.freeze({
  unchain: CODEX_PAR,
  dep: `${CODEX_PAR}\n- ${dep('shell')}`,
  two: `- ${two('shell')}`,
  plan: `- ${two('shell')} ${PLAN}`,
  pall: `${CODEX_BASE}\n${CODEX_PALL}`,
  yield: `${CODEX_BASE}\n${CODEX_YIELD}`,
  pallyield: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD}`,
  yieldedit: `${CODEX_BASE}\n${CODEX_YIELD}\n${CODEX_INCELL_DEP}`,
  yieldeditpall: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD}\n${CODEX_INCELL_DEP}`,
  pallyt: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD_TEMPLATE}`,
  pallfind: `${CODEX_BASE}\n${CODEX_PALL}\n${R5_FIND}\n${R5_ALT}`,
  pallytfind: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD_TEMPLATE}\n${R5_FIND}\n${R5_ALT}`,
});
export function applyCodexBatch(text, variant) {
  const repl = CODEX_BATCH_VARIANTS[variant];
  if (!repl) throw new Error(`CODEX_TRIM_BATCH=${variant}: expected ${Object.keys(CODEX_BATCH_VARIANTS).join(', ')}`);
  if (!text.includes(CODEX_BASE)) throw new Error('CODEX_TRIM_BATCH: batching lines not found in the instructions');
  return text.replace(CODEX_BASE, repl);
}

// --- opencode (untrimmed gpt family prompt, exactly as 1.18.4 sends it) ---
export const OPENCODE_GPT_ORIGINAL = path.join(HERE, 'opencode-1.18.4-prompt-gpt-original.txt');
const OC_BULLET = '- Parallelize tool calls whenever possible - especially file reads. Use `multi_tool_use.parallel` to parallelize tool calls and only this. Never chain together bash commands with separators like `echo "====";` as this renders to the user poorly.';
const OC_PAR = '- Parallelize tool calls whenever possible - especially file reads. Use `multi_tool_use.parallel` to parallelize tool calls and only this.';
const OC_MECH = 'Use `multi_tool_use.parallel` for parallel tool calls.';
const OPENCODE_BATCH_VARIANTS_R2 = {};
export const OPENCODE_BATCH_VARIANTS = Object.freeze({
  unchain: OC_PAR,
  dep: `${OC_PAR}\n- ${dep('bash')}`,
  two: `- ${two('bash')} ${OC_MECH}`,
  plan: `- ${two('bash')} ${PLAN} ${OC_MECH}`,
});
// Round 2 (trace analysis 2026-09-26): 65 of 355 opencode turns were todowrite alone in a
// turn; its description says "Update status in real time; don't batch completions" and "When in
// doubt, use it." Also 14 first run_tests alone in a turn and 13 review turns after the final PASS.
const OC_TODO = '- Send todowrite in the same turn as your next tool call, as a parallel call, never as a turn of its own. Update the list only when a step is finished.';
const OC_FIRSTRUN = '- Start the first run of the test suite as a parallel call together with your first searches.';
const OC_NOREVIEW = '- After the test suite passes on your final edit, write the final answer. Do not add a separate review turn; if you want a diff summary, chain it after the test command in the same call.';
const OC_GLOBGREP = '- When searching for text or files, prefer using Glob and Grep tools (they are powered by `rg`)';
const OC_FIT = '- For code search and reading use the ss-* commands through bash, as the instructions say; use Glob only to list files by name.';
const OC_TODO_END = '- After the final test run passes, write the final answer. Do not spend a turn only on todowrite to mark items completed.';
const OC_TODO_OPEN = '- Send your first todo list together with your first searches, as parallel calls in one turn.';
const OC_TODO_DESC_EDITS = [
  ["- Update status in real time; don't batch completions\n", ''],
  ['\nWhen in doubt, use it.\n', '\n'],
];
Object.assign(OPENCODE_BATCH_VARIANTS_R2, {
  todo: { bullet: `${OC_BULLET}\n${OC_TODO}` },
  tododesc: { bullet: OC_BULLET, edits: { todowrite: OC_TODO_DESC_EDITS } },
  todoall: { bullet: `${OC_BULLET}\n${OC_TODO}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
  combo: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_FIRSTRUN}\n${OC_NOREVIEW}` },
  // Round 4 (sweet-search fit, trace analysis #8): the gpt prompt's "prefer using Glob and Grep
  // tools" bullet conflicts with the rules; replace only that bullet.
  todoallfit: { bullet: `${OC_BULLET}\n${OC_TODO}`, edits: { todowrite: OC_TODO_DESC_EDITS }, prompt: [[OC_GLOBGREP, OC_FIT]] },
  todoall2: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_TODO_OPEN}\n${OC_TODO_END}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
  todoall2find: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_TODO_OPEN}\n${OC_TODO_END}\n${R5_FIND}\n${R5_ALT}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
  comboall: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_FIRSTRUN}\n${OC_NOREVIEW}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
});
/** Tool-description edits for an opencode batch variant (applied by opencode-trim-plugin.mjs), or null. */
export function opencodeBatchToolEdits(variant) {
  return OPENCODE_BATCH_VARIANTS_R2[variant]?.edits || null;
}

export function opencodeBatchPrompt(variant) {
  const repl = OPENCODE_BATCH_VARIANTS[variant] ?? OPENCODE_BATCH_VARIANTS_R2[variant]?.bullet;
  if (!repl) throw new Error(`OC_HARNESS_TRIM=batch-${variant}: expected batch-${[...Object.keys(OPENCODE_BATCH_VARIANTS), ...Object.keys(OPENCODE_BATCH_VARIANTS_R2)].join(', batch-')}`);
  const text = readFileSync(OPENCODE_GPT_ORIGINAL, 'utf8');
  if (!text.includes(OC_BULLET)) throw new Error('OC_HARNESS_TRIM=batch-*: batching bullet not found in the original prompt');
  let out = text.replace(OC_BULLET, repl);
  for (const [find, rep] of OPENCODE_BATCH_VARIANTS_R2[variant]?.prompt || []) {
    if (!out.includes(find)) throw new Error(`OC_HARNESS_TRIM=batch-${variant}: prompt line not found: ${find.slice(0, 60)}`);
    out = out.replace(find, rep);
  }
  return out;
}

// --- Claude Code (lean agent file installed by `sweet-search init`) ---
const CC_DEP = `- ${dep('Bash')}`;
const CC_SSREAD = '- Inside a chained Bash call, read with `ss-read <file> <start> <end>` and search with `ss-grep`, not `cat`, `sed -n` or `grep`.';
const CC_ROOT = '- Run ss-* commands from the repository root with root-relative paths; they do not resolve paths against a subdirectory you cd into.';
const CC_TIMEOUT = '- Run long commands such as the test suite in the foreground with the Bash timeout parameter set to 600000; a call that reaches the default 2-minute limit moves to the background and costs extra turns.';
const CC_TAIL = '- To shorten a long command\'s output, pipe it through `tail -n 60`, not grep: result lines come last, and a filter that matches nothing shows you nothing.';
const CC_RANGES = '- Read ranges, not whole files: take the line numbers from ss-grep or ss-search and read each place with `ss-read <file> <start> <end>` up to the end of the enclosing function, several ranges in one Bash call. Read a whole file only when it is short (under about 200 lines).';
export const CC_BATCH_VARIANTS = Object.freeze({
  two: `- ${two('Bash')}`,
  plan: `- ${two('Bash')} ${PLAN}`,
  amp: `${CC_DEP} ${PLAN}`,
  // Round 2 (trace analysis): Opus max-batch chained ~50 raw cat/sed -n/grep reads v 34 ss-*
  // calls in 8 rollouts; the line points chained reads at the ss-* commands (sweet-search fit).
  ssread: `${CC_DEP}\n${CC_SSREAD}`,
  ampssread: `${CC_DEP} ${PLAN}\n${CC_SSREAD}`,
  ampsafe: `${CC_DEP} ${PLAN}\n${CC_ROOT}\n${CC_TIMEOUT}\n${CC_TAIL}`,
  ampsaferange: `${CC_DEP} ${PLAN}\n${CC_ROOT}\n${CC_TIMEOUT}\n${CC_TAIL}\n${CC_RANGES}`,
});
export function applyClaudeBatch(text, variant) {
  const repl = CC_BATCH_VARIANTS[variant];
  if (!repl) throw new Error(`CC_TRIM_BATCH=${variant}: expected ${Object.keys(CC_BATCH_VARIANTS).join(', ')}`);
  if (!text.includes(CC_DEP)) throw new Error('CC_TRIM_BATCH: max-batch line not found in the agent file');
  return text.replace(CC_DEP, repl);
}
