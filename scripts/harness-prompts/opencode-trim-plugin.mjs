// opencode plugin for the harness trim (OC_HARNESS_TRIM, opencode-task-runner.mjs).
// Edits the DESCRIPTION of built-in tools through the `tool.definition` hook: parameters and
// `execute` stay opencode's own, so a trimmed bash call runs exactly like an untrimmed one.
// Self-contained (node built-ins only) because the runner copies it into the rollout's
// state dir, where no node_modules exist.
//
// `shell.env`: every bash call of one opencode SESSION gets SWEET_SEARCH_SESSION_ID =
// opencode-<sessionID>, the key of the ss-* "already shown" receipts
// (core/search/agent-span-ledger.js resolveAgentSessionId). opencode exports no session id to
// its shells, and one opencode process can run several sessions (TUI, server, subagents),
// so the process fallback (OPENCODE_PID) alone would let two sessions share receipts.
// A SWEET_SEARCH_SESSION_ID set by the user wins.
//
// Prewarm: as opencode loads the plugin, the sweet-search daemon starts in the background
// (core/search/session-daemon-prewarm.mjs, the launcher Claude Code and Codex run from their
// SessionStart hooks), so the first ss-* call of a session finds it warm. The launcher comes
// from the project's node_modules (nearest first); with none there, or no `node` on PATH, the
// plugin does nothing. SWEET_SEARCH_PREWARM=0 turns it off.
//
// options.edits  { <toolID>: [[find, replace], ...] }  — applied in order, every occurrence.
// options.report path of a JSON file rewritten on every hook call:
//                { <toolID>: { applied, missing: [find prefixes], chars } }
//                A missing edit means the pinned opencode text changed; the runner records
//                the report on the row so a half-trimmed rollout is visible.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PREWARM_REL = join('node_modules', 'sweet-search', 'core', 'search', 'session-daemon-prewarm.mjs');

function prewarm(root) {
  if (['0', 'false', 'off', 'no'].includes(String(process.env.SWEET_SEARCH_PREWARM ?? '').trim().toLowerCase())) return;
  for (let dir = root; dir; dir = dirname(dir) === dir ? null : dirname(dir)) {
    const hook = join(dir, PREWARM_REL);
    if (!existsSync(hook)) continue;
    const child = spawn('node', [hook], { cwd: root, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return;
  }
}

export default async (input, options = {}) => {
  try { prewarm(input?.worktree || input?.directory || process.cwd()); } catch { /* never blocks opencode */ }
  const edits = options.edits || {};
  const report = {};
  return {
    'shell.env': async (input, output) => {
      const id = input?.sessionID;
      if (typeof id !== 'string' || !id || !output?.env || process.env.SWEET_SEARCH_SESSION_ID) return;
      output.env.SWEET_SEARCH_SESSION_ID = `opencode-${id}`;
    },
    'tool.definition': async ({ toolID }, output) => {
      const list = edits[toolID];
      if (!list || typeof output.description !== 'string') return;
      let text = output.description;
      let applied = 0;
      const missing = [];
      for (const [find, replace] of list) {
        if (text.includes(find)) { text = text.split(find).join(replace); applied++; }
        else missing.push(find.slice(0, 60));
      }
      output.description = text;
      report[toolID] = { applied, missing, chars: text.length };
      if (options.report) writeFileSync(options.report, JSON.stringify(report));
    },
  };
};
