// Batching-line micro-smoke variants (2026-09-26, handoffs/improve/harness-prompt-trim/BATCH-SMOKE.md).
// SWEET ARM ONLY research switches. Each variant changes ONE place in the harness's own prompt:
// the sentence that says how to group tool calls. The rules file, the frame, the override and
// native are untouched. Codex and opencode ship a "do not chain shell commands" sentence that
// works against batching; Claude Code's lean prompt ships the max-batch line.
//   CODEX_TRIM_BATCH=unchain|dep|two|plan   (with CODEX_HARNESS_TRIM=v3)
//   OC_HARNESS_TRIM=batch-unchain|batch-dep|batch-two|batch-plan   (untrimmed opencode otherwise)
//   CC_TRIM_BATCH=two|plan|amp              (with CC_HARNESS_TRIM=product)
// 2026-09-27 (conflict-only trims, general wording): CODEX_TRIM_BATCH=yt2|yt2eff (with
// CODEX_HARNESS_TRIM=v3 or conflict); OC_HARNESS_TRIM=<base>+<variant> with base conflict,
// conflict-noglob or untrimmed and any opencode variant below (e.g. conflict+todo2eff);
// CC_TRIM_BATCH=eff (inserts EFFICIENCY_LINE after the "act" line, no line replaced).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_LEAN_BATCH_LINE } from '../../../../scripts/install-claude-lean-harness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const dep = shell => `Combine dependent shell steps into one ${shell} call where you can, for example an edit made with a short script together with the command that checks it.`;
const two = shell => 'Save turns by batching. Independent calls, such as reads and searches you already know you need, go out together in one turn as parallel tool calls. '
  + `Dependent shell steps whose intermediate output you do not need to read, such as an edit and the command that checks it, go into one ${shell} call joined with \`&&\`. `
  + 'Make a separate call only when you must see a result before you can choose the next step.';
const PLAN = 'Before each turn, work out every read and check you already know you will need, and include all of them in that turn instead of fetching one file per turn.';

// Round 5 (trace analysis 2, 2026-09-27 04:40): lines on top of each harness's candidate.
const R5_FIND = '- If you need the code at an exact name, not only where it is, use `ss-find "<what it does>" --regex "\\bName\\b"`: it returns the code blocks, so no separate ss-read turn is needed.';
// Research candidate #2 (research-2/candidates.md), reworded so it assumes no failing test and
// names no benchmark: general bounded-efficiency workflow line, shared by all three harnesses.
// v2 (audit mech-oc2, 2026-09-27): keeps the mechanism (fewer exploratory reads, no redundant
// re-runs) but drops wording that could hurt interactive work, questions or repos without tests:
// finish the change where it needs follow-up edits, re-check after a fix, answer questions from evidence.
// EFFICIENCY_LINE_3 (owner 2026-09-29): EFFICIENCY_LINE_2 made request-neutral — the change/check part
// applies only to requests that need code changes; answers and plans are named as their own outcomes.
export const EFFICIENCY_LINE_3 = '- Work efficiently: start from what the request and any error output point to, and open more only when the evidence requires it. Do what the request asks, whether an answer, a plan or a change, and nothing unrelated. For requests that need code changes, make the change that fully solves the request, including the edits it needs elsewhere, check it with the checks the project has, again after each fix, and stop when it is done. For a question, answer from the evidence you gathered.';
// EFFICIENCY_LINE_4 / OC_TODO4 (audit beh-oc-p4, 2026-09-29): EFFICIENCY_LINE_3 plus fixes for the three
// residual waste patterns — chains of one-search turns (22.9% of cost), a separate review turn after the
// passing check (9.7%), and edits after the passing check (5.4%).
export const EFFICIENCY_LINE_4 = '- Work efficiently: start from what the request and any error output point to. When you need to search, send the searches you would try in one turn, and open files only when the evidence requires it. Do what the request asks, whether an answer, a plan or a change, and nothing unrelated. For requests that need code changes, make the change that fully solves the request in one pass, including the related edits elsewhere and in comments or docs, before you check it; check it with the checks the project has, again after each fix, and when that check passes, give your final answer. For a question, answer from the evidence you gathered.';
export const EFFICIENCY_LINE_2 = '- Work efficiently: start from the files the request and any error output point to, and open more only when the evidence requires it. Make the change that fully solves the request, including the edits it needs elsewhere, and nothing unrelated. Check it with the checks the project has, again after each fix, and stop when it is done. For a question, answer from the evidence you gathered.';
export const EFFICIENCY_LINE = '- Work efficiently: start from the files the task and any error output point to; open more files only when the evidence requires it; make the smallest change that solves the task; verify it once with the checks the project has; stop when it is done.';
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
// Round 7 (trace analysis 3): the template worked in 15/15 cells that used it, but 0/14 FIRST test
// cells used it (the agent copied yield_time_ms onto exec_command, which does not keep the cell open).
const CODEX_YT_EVERY = ' Use this form for every run of the test suite, the first run included. The yield_time_ms of exec_command or write_stdin does not keep the cell open; only the first line does.';
const CODEX_OPEN = '- In your first cell, under that first line, run the test suite and your first searches together with Promise.allSettled, so one turn returns the test result and the search results.';
// yt2 (2026-09-27): the pallyt template without the Promise.allSettled line, reworded to hold
// for any repository: it names the class of command it is for (ends by itself, takes over 10 s)
// and the class it must not be used for (runs until stopped).
const CODEX_YIELD_TEMPLATE2 = '- An exec cell returns after 10 seconds unless its first line sets a longer limit. For a command that ends by itself but takes longer than 10 seconds, such as a build or a test run, use one cell of this form: first line `// @exec: {"yield_time_ms": 600000}`, then `const r = await tools.exec_command({cmd: <command>, yield_time_ms: 300000}); text(r.output); if (r.session_id) text((await tools.write_stdin({session_id: r.session_id, chars: "", yield_time_ms: 300000})).output);` A cell that ends without the write_stdin step returns before the command finishes, and its result is lost. Do not use this form for a command that keeps running until it is stopped, such as a dev server or a watch mode.';
// Poll (audit mech-cx2, 2026-09-27): yt2's saving came from always awaiting write_stdin for a
// still-running command (verdict lost 9x -> 0x), not from the 600 s cell pragma (used in 5/28 cells).
// This keeps only the poll, drops the pragma (no 10-minute cell), and widens the exclusion.
const CODEX_POLL = '- When exec_command returns a session_id because the command is still running, await one `tools.write_stdin({session_id, chars: "", yield_time_ms: 300000})` in the same cell before you print the result, so the complete result comes back in one turn. Do not do this for a command that keeps running until it is stopped or that waits for input, such as a dev server, a watch mode or an interactive prompt.';
// yt3 (sink audit sinks-3, 2026-09-27): the model copied yt2's inline `const r ...` part but
// used the separate first-line pragma in only 5/28 cells, so 18/23 other cells returned early
// (20 wait turns). yt3 gives both lines as ONE fenced cell to copy, with yt2's widened exclusion.
const CODEX_YIELD_TEMPLATE3 = '- An exec cell returns after 10 seconds unless its first line sets a longer limit. For a command that ends by itself but takes longer than 10 seconds, such as a build or a test run, copy this cell exactly, both lines, and replace <command>:\n```\n// @exec: {"yield_time_ms": 600000}\nconst r = await tools.exec_command({cmd: <command>, yield_time_ms: 300000}); text(r.output); if (r.session_id) text((await tools.write_stdin({session_id: r.session_id, chars: "", yield_time_ms: 300000})).output);\n```\nWithout the first line the cell returns after 10 seconds; without the write_stdin step the result is lost. Do not use this form for a command that keeps running until it is stopped or that waits for input, such as a dev server, a watch mode or an interactive prompt.';
// Read batch (sinks-3): 65/147 Codex turns run ONE search or read. General, read-only only.
const CODEX_READ_BATCH = '- When you already know several read-only commands you need, such as searches, file reads or listings, run them in one exec_command joined with `;` and read all the output in one turn. Keep a command whose output decides your next step on its own.';
// rbatch2 (audit mech-cx3): the model twice joined a search with the test run (not read-only);
// the second sentence now also keeps builds, tests, installs and file-changing commands separate.
const CODEX_READ_BATCH2 = '- When you already know several read-only commands you need, such as searches, file reads or listings, run them in one exec_command joined with `;` and read all the output in one turn. Keep a command whose output decides your next step on its own, and run builds, tests, installs and commands that change files separately.';
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
  pallyt1: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD_TEMPLATE}${CODEX_YT_EVERY}`,
  pallyt1open: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD_TEMPLATE}${CODEX_YT_EVERY}\n${CODEX_OPEN}`,
  pallfind: `${CODEX_BASE}\n${CODEX_PALL}\n${R5_FIND}\n${R5_ALT}`,
  pallytfind: `${CODEX_BASE}\n${CODEX_PALL}\n${CODEX_YIELD_TEMPLATE}\n${R5_FIND}\n${R5_ALT}`,
  yt2: `${CODEX_BASE}\n${CODEX_YIELD_TEMPLATE2}`,
  poll: `${CODEX_BASE}\n${CODEX_POLL}`,
  yt2eff: `${CODEX_BASE}\n${CODEX_YIELD_TEMPLATE2}\n${EFFICIENCY_LINE}`,
  yt3: `${CODEX_BASE}\n${CODEX_YIELD_TEMPLATE3}`,
  yt3batch: `${CODEX_BASE}\n${CODEX_YIELD_TEMPLATE3}\n${CODEX_READ_BATCH}`,
  // rbatch: the read-batch line alone (isolates it from the yt3 template).
  rbatch: `${CODEX_BASE}\n${CODEX_READ_BATCH}`,
  rbatch2: `${CODEX_BASE}\n${CODEX_READ_BATCH2}`,
  // yt3batch2: the champion yt3batch with the audit's keep-separate clause (rbatch2 lost without the template).
  yt3batch2: `${CODEX_BASE}\n${CODEX_YIELD_TEMPLATE3}\n${CODEX_READ_BATCH2}`,
  yt3batch2w: `${CODEX_BASE}\n${CODEX_YIELD_TEMPLATE3}\n${CODEX_READ_BATCH2}`, // + CODEX_TEXT_EDITS.yt3batch2w
});
// yt3batch2w (audit cx-audit2 + owner, 2026-09-29): yt3batch2 plus two rewordings (no deletion) of the
// stock 60-second lines, so they stop contradicting the long-command cell form while keeping the
// anti-hang and communication intent.
const CODEX_TEXT_EDITS = Object.freeze({
  yt3batch2w: [
    ['- Avoid performing blocking sleep or wait calls longer than 60 seconds, as they may prevent you from communicating with the user for their duration.',
     '- Do not sleep, poll, or wait on a command that may never finish for longer than 60 seconds, as it may prevent you from communicating with the user. A command that ends by itself, such as a build or a test run, may take longer: run it with the cell form above so its result comes back in the same turn.'],
    ['should not be left without a commentary update for more than 60 seconds during ongoing work.',
     'should not be left without a commentary update for more than 60 seconds during ongoing work, other than while a build or a test run you started is still running.'],
  ],
});
export function applyCodexBatch(text, variant) {
  const edits = CODEX_TEXT_EDITS[variant];
  if (edits) {
    let out = applyCodexBatch(text, variant.slice(0, -1));
    for (const [from, to] of edits) {
      const at = out.indexOf(from);
      if (at < 0 || out.indexOf(from, at + 1) >= 0) throw new Error(`CODEX_TRIM_BATCH=${variant}: text "${from.slice(0, 50)}..." not found exactly once`);
      out = out.replace(from, to);
    }
    return out;
  }
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
const OC_DIFF = '- When you run the test suite after your last edit, send git diff as a parallel call in the same turn. If the result passes and the diff shows nothing left to do, write the final answer next.';
// todo3: todo2 + the last step (audit: with todo2 the final item could stay in_progress).
const OC_TODO3 = '- Send todowrite as a parallel call in the same turn as your next tool call, never as a turn of its own. Mark a step in_progress in the call that starts it, and completed in the call that starts the next one; mark the last step completed together with your final check.';
const OC_TODO2 = '- Send todowrite as a parallel call in the same turn as your next tool call, never as a turn of its own. Mark a step in_progress in the call that starts it, and completed in the call that starts the next one.';
const OC_TODO4 = '- Send todowrite as a parallel call in the same turn as your next tool call, never as a turn of its own. Mark a step in_progress in the call that starts it, and completed in the call that starts the next one; mark the last step completed in the same turn as the check that confirms it.';
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
  todoall2diff: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_TODO_OPEN}\n${OC_TODO_END}\n${OC_DIFF}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
  todoall2find: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_TODO_OPEN}\n${OC_TODO_END}\n${R5_FIND}\n${R5_ALT}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
  comboall: { bullet: `${OC_BULLET}\n${OC_TODO}\n${OC_FIRSTRUN}\n${OC_NOREVIEW}`, edits: { todowrite: OC_TODO_DESC_EDITS } },
  // 2026-09-27: todoall reworded as a general line. todoall deletes the description's "Update
  // status in real time" rule and says "update the list only when a step is finished"; todo2 keeps
  // that rule, says in which call each status changes, and removes only "When in doubt, use it."
  // Same no-solo-todowrite-turn instruction as todoall.
  todo2: { bullet: `${OC_BULLET}\n${OC_TODO2}`, edits: { todowrite: [OC_TODO_DESC_EDITS[1]] } },
  todo3eff: { bullet: `${OC_BULLET}\n${OC_TODO3}\n${EFFICIENCY_LINE}`, edits: { todowrite: [OC_TODO_DESC_EDITS[1]] } },
  todo3eff2: { bullet: `${OC_BULLET}\n${OC_TODO3}\n${EFFICIENCY_LINE_2}`, edits: { todowrite: [OC_TODO_DESC_EDITS[1]] } },
  // owner 2026-09-29: keep "When in doubt, use it." in the todowrite description (no todowrite edit).
  todo3eff2k: { bullet: `${OC_BULLET}\n${OC_TODO3}\n${EFFICIENCY_LINE_2}` },
  todo3eff3k: { bullet: `${OC_BULLET}\n${OC_TODO3}\n${EFFICIENCY_LINE_3}` },
  // todo4: audit beh-oc-p4 fixes (glob 'speculative batch' sentence removed; its intent moves into the efficiency line).
  todo4: { bullet: `${OC_BULLET}\n${OC_TODO4}\n${EFFICIENCY_LINE_4}` }, // pair with base conflict4 (drops the glob 'speculative batch' sentence)
  todo2eff: { bullet: `${OC_BULLET}\n${OC_TODO2}\n${EFFICIENCY_LINE}`, edits: { todowrite: [OC_TODO_DESC_EDITS[1]] } },
});
/** Tool-description edits for an opencode batch variant (applied by opencode-trim-plugin.mjs), or null. */
export function opencodeBatchToolEdits(variant) {
  return OPENCODE_BATCH_VARIANTS_R2[variant]?.edits || null;
}

/** Every opencode variant name (batch-<name>, or the <name> in <base>+<name>). */
export const OPENCODE_VARIANT_NAMES = Object.freeze([...Object.keys(OPENCODE_BATCH_VARIANTS), ...Object.keys(OPENCODE_BATCH_VARIANTS_R2)]);

// `text` = the prompt the variant edits: the untrimmed gpt prompt by default, or a conflict-trim
// base (OC_HARNESS_TRIM=conflict+<variant>). The batching bullet must be in it unchanged.
export function opencodeBatchPrompt(variant, text = readFileSync(OPENCODE_GPT_ORIGINAL, 'utf8')) {
  const repl = OPENCODE_BATCH_VARIANTS[variant] ?? OPENCODE_BATCH_VARIANTS_R2[variant]?.bullet;
  if (!repl) throw new Error(`OC_HARNESS_TRIM=batch-${variant}: expected batch-${OPENCODE_VARIANT_NAMES.join(', batch-')}`);
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
const CC_NOEDIT_LINE = CLAUDE_LEAN_BATCH_LINE.replace(' Make file changes with Edit or Write.', '');
if (CC_NOEDIT_LINE === CLAUDE_LEAN_BATCH_LINE) throw new Error('noedit: Edit/Write sentence not found in CLAUDE_LEAN_BATCH_LINE');
const CC_SSREAD = '- Inside a chained Bash call, read with `ss-read <file> <start> <end>` and search with `ss-grep`, not `cat`, `sed -n` or `grep`.';
const CC_ROOT = '- Run ss-* commands from the repository root with root-relative paths; they do not resolve paths against a subdirectory you cd into.';
const CC_TIMEOUT = '- Run long commands such as the test suite in the foreground with the Bash timeout parameter set to 600000; a call that reaches the default 2-minute limit moves to the background and costs extra turns.';
const CC_TAIL = '- To shorten a long command\'s output, pipe it through `tail -n 60`, not grep: result lines come last, and a filter that matches nothing shows you nothing.';
const CC_RANGES = '- Read ranges, not whole files: take the line numbers from ss-grep or ss-search and read each place with `ss-read <file> <start> <end>` up to the end of the enclosing function, several ranges in one Bash call. Read a whole file only when it is short (under about 200 lines).';
// Round 7: amp's "work out every read" sentence made read turns bigger and cost +8% on rotation B;
// saferange drops it (a removal). The final turn is ~16% of Claude Code cost.
const CC_FINAL = '- Keep the final message short, about five lines: what you changed and where, the last test result, and any step you did not do.';
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
  saferange: `${CC_DEP}\n${CC_ROOT}\n${CC_TIMEOUT}\n${CC_TAIL}\n${CC_RANGES}`,
  saferangefinal: `${CC_DEP}\n${CC_ROOT}\n${CC_TIMEOUT}\n${CC_TAIL}\n${CC_RANGES}\n${CC_FINAL}`,
  // 2026-09-27: the product prompt + the general efficiency line. It INSERTS (replaces nothing),
  // after the base prompt's "act" line, so it does not depend on the max-batch line's wording
  // (the product module is being rebuilt); a missing anchor throws.
  eff: EFFICIENCY_LINE,
  // noedit (audit mech-cc2): the product batching line without "Make file changes with Edit or Write." —
  // stock has no such sentence, and in bypass mode stock says the opposite; the tools stay available.
  noedit: CC_NOEDIT_LINE,
  read3: CC_NOEDIT_LINE, // + CC_TEXT_EDITS.read3 (applied in applyClaudeBatch)
  read4: CC_NOEDIT_LINE, // + read3 + CC_READ4_EXTRA
  read4out: CC_NOEDIT_LINE, // + read4 + CC_OUT_EXTRA
  read5: CC_NOEDIT_LINE, // + read3 minus its report-line edit
  read5pack: CC_NOEDIT_LINE, // + read5 + read-batch line
  read6: CC_NOEDIT_LINE, // owner-revised text (see CC_TEXT_EDITS_EXTRA.read6)
  read6fs: CC_NOEDIT_LINE, // read6 + packed-turn example
  read7: CC_NOEDIT_LINE, // read6 + known-files packing + edits-with-check; product combine line removed
});
const CC_INSERT_AFTER = Object.freeze({ eff: 'When you have enough information to act, act.' });
// The line a replacing variant swaps: the v1 max-batch line, or (since the conflict-only product
// rebuild, 2026-09-27) the v2 batching line that the product agent file now carries. 'eff' inserts
// a line after its anchor instead of replacing.
// read3 (audit mech-cc3): product+noedit plus three paraphrased edits to the product agent text —
// the gap v stock is +30% tool output per rollout (wider reads), extra end-of-task git calls and
// narration. Each edit keeps every capability; checking stays required.
const CC_TEXT_EDITS_EXTRA = {};
const CC_TEXT_EDITS = Object.freeze({
  read3: [
    ['- When you have enough information to act, act. Do not re-derive settled facts or reopen decisions the user made. When you weigh a choice, recommend one option instead of surveying them all.',
     '- When you have enough information to act, act. Do not re-derive settled facts or reopen decisions the user made. When you weigh a choice, recommend one option instead of surveying them all, and do not describe options you will not take.\n- Read only what you need: find the place first, then open the lines around it rather than a whole file or a long range, unless you need all of it.'],
    ['- Report what really happened: show the output of a failing test, name any step you skipped, and call work finished only after you checked it. When it is done and checked, say so plainly.',
     '- Report what really happened: show the output of a failing check and name any step you skipped. When the work is done and checked, say so plainly and stop; if you could not check it, say so.'],
    ['When git state matters (the branch, uncommitted changes, recent commits), run `git status --short --branch` and `git log --oneline -5` first.',
     'When git state matters, run `git status --short --branch`, and `git log --oneline -5` only when recent commits matter.'],
  ],
});
// read4 / read4out (research cc-research + audit cc-turns, 2026-09-28): read3 plus
// (a) a firmer parallel-calls line (Anthropic's guidance lifts parallel calling; fewer turns),
// (b) commit to a plausible approach (Opus-class over-exploration), (c) one-off probes instead of
// temporary project files + full re-runs; read4out adds (d) keep long output in a file instead of
// re-running a command to see another part of it. General wording; no capability removed.
const CC_READ4_EXTRA = [
  ['- Tool calls that do not depend on each other can go in parallel in one response.',
   '- When you already know two or more tool calls that do not depend on each other, such as searches, reads or lookups, make them all in the same response instead of one per turn.'],
  ['unless you need all of it.',
   'unless you need all of it.\n- Once you have a plausible approach, follow it; change course when new evidence contradicts it, not to survey alternatives.\n- To try out one behaviour, run a one-off command or script instead of adding temporary files to the project and running the full check for it.'],
];
const CC_OUT_EXTRA = [
  ['running the full check for it.',
   'running the full check for it.\n- When a command prints a lot, save its full output to a file on the first run and show the part you need, such as the end and the error lines; look in that file again instead of running the command again.'],
];
CC_TEXT_EDITS_EXTRA.read4 = [...CC_TEXT_EDITS.read3, ...CC_READ4_EXTRA];
// read5 (audit conflict-audit, 2026-09-29): read3 WITHOUT its report-line edit, so the product's
// "call work finished only after you checked it" stays (it does not conflict with the rules).
CC_TEXT_EDITS_EXTRA.read5 = CC_TEXT_EDITS.read3.filter(([from]) => !from.startsWith('- Report what really happened'));
if (CC_TEXT_EDITS_EXTRA.read5.length !== CC_TEXT_EDITS.read3.length - 1) throw new Error('read5: report edit not found in read3');
// read6 (owner 2026-09-29): noedit + keep "do not describe options you will not take" + git line edit;
// NO "Read only what you need" line (redundant with the rules); the report line also names approaches
// decided against, so the user still hears what was rejected.
CC_TEXT_EDITS_EXTRA.read6 = [
  CC_TEXT_EDITS.read3[0].map((x, i) => i === 1 ? x.split('\n')[0] : x), // act line only (drop the read line)
  ['- Report what really happened: show the output of a failing test, name any step you skipped, and call work finished only after you checked it. When it is done and checked, say so plainly.',
   '- Report what really happened: show the output of a failing test, name any step you skipped and any approach you decided against that the user should know about, and call work finished only after you checked it. When it is done and checked, say so plainly.'],
  CC_TEXT_EDITS.read3[2],
];
// read6fs: read6 + a CONCRETE packed-turn example (few-shot style; never tried on Claude Code before).
CC_TEXT_EDITS_EXTRA.read6fs = [...CC_TEXT_EDITS_EXTRA.read6,
  ['- Tool calls that do not depend on each other can go in parallel in one response.',
   '- Pack independent steps into one response. Example: when you need a search and two files you already know about, send the search and both reads as parallel tool calls in the same response, not in three turns; when several edits do not depend on each other, send them together; join shell commands whose intermediate output you do not need into one Bash call with `&&`. Keep a step whose result decides your next step on its own.']];
// read7 (audit beh-cc-p4): read6fs's packing gain over read6 was task luck; two real waste patterns
// remain — packed GUESSED paths (reads of files not yet known) and edits followed by the check in a
// separate turn (the product's "Combine dependent shell steps" line overlapped with "Keep a step whose
// result decides your next step on its own"). read7 = read6 + a packing line limited to known files that
// sends edits together with their check, and the product's "Combine dependent shell steps…" line removed.
CC_TEXT_EDITS_EXTRA.read7 = [...CC_TEXT_EDITS_EXTRA.read6,
  ['- Tool calls that do not depend on each other can go in parallel in one response.',
   '- Pack independent steps into one response: searches and reads of files you already know about (named in the request or shown by an earlier search or listing) go out together as parallel calls, and edits go out together with the check that tests them. A step whose result names the file or decides your next step stays on its own.'],
  ['\n- Combine dependent shell steps into one Bash call when you do not need the intermediate output, for example a build and the command that checks its result.', ''],
];
// read5pack (2026-09-29): read5 + the Codex read-batch line (Codex yt3batch: lone read commands
// 60% -> 19–33%, turns −28%), adapted to Claude Code: parallel calls or one joined Bash call for
// read-only commands already known; commands whose output decides the next step, and builds,
// tests, installs and file-changing commands, stay separate. Replaces the product's weaker
// "can go in parallel" line.
CC_TEXT_EDITS_EXTRA.read5pack = [...CC_TEXT_EDITS_EXTRA.read5,
  ['- Tool calls that do not depend on each other can go in parallel in one response.',
   '- When you already know several read-only steps you need, such as searches, file reads or listings, get them in one response: send them as parallel tool calls, or join the commands in one Bash call with `;`, and read all the output in one turn. Keep a command whose output decides your next step on its own, and run builds, tests, installs and commands that change files separately.']];
CC_TEXT_EDITS_EXTRA.read4out = [...CC_TEXT_EDITS.read3, ...CC_READ4_EXTRA, ...CC_OUT_EXTRA];
export function applyClaudeBatch(text, variant) {
  const edits = CC_TEXT_EDITS[variant] ?? CC_TEXT_EDITS_EXTRA[variant];
  if (edits) {
    let out = applyClaudeBatch(text, 'noedit');
    for (const [from, to] of edits) {
      const at = out.indexOf(from);
      if (at < 0 || out.indexOf(from, at + 1) >= 0) throw new Error(`CC_TRIM_BATCH=${variant}: text "${from.slice(0, 50)}..." not found exactly once in the agent file`);
      out = out.replace(from, to);
    }
    return out;
  }
  const repl = CC_BATCH_VARIANTS[variant];
  if (!repl) throw new Error(`CC_TRIM_BATCH=${variant}: expected ${Object.keys(CC_BATCH_VARIANTS).join(', ')}`);
  const anchor = CC_INSERT_AFTER[variant];
  if (anchor) {
    const at = text.indexOf(anchor);
    if (at < 0 || text.indexOf(anchor, at + 1) >= 0) throw new Error(`CC_TRIM_BATCH=${variant}: anchor "${anchor}" not found exactly once in the agent file`);
    const eol = text.indexOf('\n', at);
    return eol < 0 ? `${text}\n${repl}` : `${text.slice(0, eol)}\n${repl}${text.slice(eol)}`;
  }
  const find = [CC_DEP, CLAUDE_LEAN_BATCH_LINE].find(line => text.includes(line));
  if (!find) throw new Error('CC_TRIM_BATCH: batching line not found in the agent file');
  return text.replace(find, repl);
}
