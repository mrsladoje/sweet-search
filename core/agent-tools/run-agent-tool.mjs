// The ss-* agent tools: one entry, one module per tool. Each command is a thin, agent-friendly
// skin over the JS API:
//   grep          → commands/grep.mjs          SweetSearch.bareGrep (indexed lexical grep, gram-prefiltered)
//   find          → commands/find.mjs          SweetSearch.patternSearch (ColGrep: regex candidates, MaxSim re-rank)
//   read          → commands/read.mjs          search-read.readFile (filesystem-grounded read, optional line range)
//   semantic      → commands/semantic.mjs      search-read-semantic.readSemantic (query-specific spans of one file)
//   trace         → commands/trace.mjs         search-trace.traceSymbol (callers, callees, impact)
//   agent-search  → commands/agent-search.mjs  the daemon's routed search (ss-search)
//
// Output is compact, deterministic, agent-readable (one match per line for
// discovery; fenced code for reads). No colour codes. No JSON unless asked.
//
// ONE CALL = ONE VIRTUAL PROCESS. `runAgentTool` and the commands are written as if they owned
// the process: they read process.env and process.cwd(), write to process.stdout/stderr and end
// with process.exit(code). They always run inside core/agent-tools/virtual-process.js, which
// scopes all of those to the call. The resident daemon runs them warm for the native ss-*
// client (POST /agent-tool); core/agent-tools/cli.js runs them in a fresh process as the
// fallback. Both are the same code, so both print the same bytes.
//
// What one call knows besides its arguments is the call context (commands/context.mjs), built
// once below and passed to the command as its first argument.

import path from 'node:path';
import { AGENT_TOOLS, AGENT_TOOL_SUBCOMMANDS } from './tools.js';
import { chainBoundary } from './chain.js';
import { resolveRoots, worktreeSplitNotice } from '../search/worktree-roots.js';
import { requestWorktreeIndex } from '../indexing/worktree-index.mjs';
import { callExistsSync } from '../infrastructure/call-fs.js';
import { createCallContext } from './commands/context.mjs';
import { REPO_ROOT } from './commands/shared.mjs';
import { cmdAgentSearch } from './commands/agent-search.mjs';
import { cmdFind } from './commands/find.mjs';
import { cmdGrep } from './commands/grep.mjs';
import { cmdRead } from './commands/read.mjs';
import { cmdSemantic } from './commands/semantic.mjs';
import { cmdTrace } from './commands/trace.mjs';

// Diagnostic-log isolation (agent-facing tools). The Sweet Search engine emits
// model/index load banners via console.log → stdout ("LateInteraction: Loaded…",
// "BinaryHNSW: Loaded…", "Warming up embedding…", "✓ Vocabulary loaded…"). When the
// engine runs IN-PROCESS, that stdout IS the agent's tool result, so a cold start crowds
// out the actual hits and the agent falls back to native tools (diagnosed root cause of
// the sweet≈native tie). The tools emit REAL results only via process.stdout.write, and
// the virtual process (core/agent-tools/virtual-process.js) sends every console.log of a
// call to that call's stderr, which the agent sees only on a non-zero exit.

// subcommand → command(ctx, args): one entry per tool of AGENT_TOOLS (./tools.js).
const COMMAND_MODULES = {
  'agent-search': cmdAgentSearch,
  grep: cmdGrep,
  find: cmdFind,
  read: cmdRead,
  semantic: cmdSemantic,
  trace: cmdTrace,
};
const COMMANDS = new Map(Object.values(AGENT_TOOLS).map((subcommand) => {
  const command = COMMAND_MODULES[subcommand];
  if (typeof command !== 'function') throw new Error(`no command module for the ss-* subcommand "${subcommand}"`);
  return [subcommand, command];
}));

/**
 * Run one ss-* subcommand. See the header: this must run inside a virtual process.
 *
 * @param {string} subcommand  grep | find | read | semantic | trace | agent-search
 * @param {string[]} rest      the arguments after the subcommand
 * @param {object} [host]      set by the resident daemon:
 *   host.getSearcher()          its warm SweetSearch (no second cold engine in the daemon)
 *   host.assertProjectRoot(r)   throws when this call belongs to another repository's daemon
 */
export async function runAgentTool(subcommand, rest, host = {}) {
if (AGENT_TOOL_SUBCOMMANDS.has(subcommand)) process.stdout.write(chainBoundary(subcommand, rest, process.env));
// The agent's cwd is the target repo. SWEET_SEARCH_PROJECT_ROOT must point
// at the repo so DB_PATHS resolves to the repo's own .sweet-search/.
//
// TWO ROOTS, NOT ONE, when the session runs inside a LINKED GIT WORKTREE. A worktree is a
// second checkout sharing the main repository's `.git`, and it has no `.sweet-search/` of
// its own, so every ss-* call used to exit 2 — on a surface Claude Code's desktop app,
// `claude --worktree` and worktree-isolated subagents all put agents on.
//
//   PROJECT_ROOT  where the index lives. One index describes the repository and serves
//                 every checkout of it.
//   FILE_ROOT     where the agent's own files are. ss-read and ss-semantic resolve paths
//                 here, because every byte the agent edits comes from its own worktree.
//
// Pointing BOTH at the main checkout is what the bench pin did, and it was worse than
// failing: the tools read the parent's uncommitted tree while `Read` saw the clean
// worktree (45 worktree-scoped zeros in 5 of 66 rollouts; 6 of 22 subagent results echoed
// the parent's own edit). So the split is announced, never silent, and with no index
// anywhere the tools REFUSE with a hint instead of guessing.
const { indexRoot: PROJECT_ROOT, fileRoot: FILE_ROOT, split: WORKTREE_SPLIT, refusal: ROOT_REFUSAL, notice: ROOT_NOTICE } =
  resolveRoots({ cwd: process.cwd(), explicitRoot: process.env.SWEET_SEARCH_PROJECT_ROOT || '' });

if (ROOT_REFUSAL) {
  process.stderr.write(`${ROOT_REFUSAL}\n`);
  process.exit(2);
}
if (!callExistsSync(path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db'))) {
  process.stderr.write(
    `[ss-*] no Sweet Search index at ${PROJECT_ROOT}/.sweet-search/codebase.db\n` +
    `Run: SWEET_SEARCH_PROJECT_ROOT=${PROJECT_ROOT} node ${REPO_ROOT}/core/indexing/index-codebase-v21.js --full --sqlite-fast\n`
  );
  process.exit(2);
}
// STDOUT, not stderr: the ss-* shell wrappers discard stderr on a zero exit, so a notice
// written there would never reach the agent — and "never redirect silently" is the whole
// requirement. One line, once per process, and only inside a linked worktree, so it costs
// the benchmark nothing and costs a real worktree user one line.
//
// A split is temporary: the first call starts the worktree's own index, cloned from the
// main checkout's (core/indexing/worktree-index.mjs), and later calls find it first.
if (WORKTREE_SPLIT) {
  const boot = requestWorktreeIndex({ mainCheckout: PROJECT_ROOT, worktree: FILE_ROOT });
  const building = boot.started || boot.reason === 'running';
  process.stdout.write(`${building ? worktreeSplitNotice(PROJECT_ROOT, 'building') : ROOT_NOTICE}\n`);
}
// Before anything is recorded or searched: a daemon answers for its own repository only.
host.assertProjectRoot?.(PROJECT_ROOT);
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

const ctx = createCallContext({ projectRoot: PROJECT_ROOT, fileRoot: FILE_ROOT, host });
const command = COMMANDS.get(subcommand);
if (!command) { process.stderr.write(`unknown subcommand: ${subcommand}\n`); process.exit(2); }
await command(ctx, rest);
} // runAgentTool
