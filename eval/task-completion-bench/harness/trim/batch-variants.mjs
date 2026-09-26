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
const CODEX_BASE = `${CODEX_PAR}\n${CODEX_CHAIN}`;
export const CODEX_BATCH_VARIANTS = Object.freeze({
  unchain: CODEX_PAR,
  dep: `${CODEX_PAR}\n- ${dep('shell')}`,
  two: `- ${two('shell')}`,
  plan: `- ${two('shell')} ${PLAN}`,
  pall: `${CODEX_BASE}\n${CODEX_PALL}`,
  yield: `${CODEX_BASE}\n${CODEX_YIELD}`,
  yieldedit: `${CODEX_BASE}\n${CODEX_YIELD}\n${CODEX_INCELL_DEP}`,
  yieldeditpall: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD}\n${CODEX_INCELL_DEP}`,
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
const OC_TODO_DESC_EDITS = [
  ["- Update status in real time; don't batch completions\n", ''],
  ['\nWhen in doubt, use it.\n', '\n'],
];
Object.assign(OPENCODE_BATCH_VARIANTS_R2, {
  todo: { bullet: `${OC_BULLET}\n${OC_TODO}` },
  tododesc: { bullet: OC_BULLET, edits: { todowrite: OC_TODO_DESC_EDITS } },
  todoall: { bullet: `${OC_BULLET}\n${OC_TODO}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
  combo: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_FIRSTRUN}\n${OC_NOREVIEW}` },
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
  return text.replace(OC_BULLET, repl);
}

// --- Claude Code (lean agent file installed by `sweet-search init`) ---
const CC_DEP = `- ${dep('Bash')}`;
export const CC_BATCH_VARIANTS = Object.freeze({
  two: `- ${two('Bash')}`,
  plan: `- ${two('Bash')} ${PLAN}`,
  amp: `${CC_DEP} ${PLAN}`,
});
export function applyClaudeBatch(text, variant) {
  const repl = CC_BATCH_VARIANTS[variant];
  if (!repl) throw new Error(`CC_TRIM_BATCH=${variant}: expected ${Object.keys(CC_BATCH_VARIANTS).join(', ')}`);
  if (!text.includes(CC_DEP)) throw new Error('CC_TRIM_BATCH: max-batch line not found in the agent file');
  return text.replace(CC_DEP, repl);
}
