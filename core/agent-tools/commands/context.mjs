// The state of one ss-* call: everything the commands and their shared helpers read besides their
// arguments. runAgentTool (../run-agent-tool.mjs) builds it once, after it resolved the two roots.
//
// It holds no environment, working directory or output stream. The commands still read
// process.env and process.cwd() and write to process.stdout / process.stderr, which the virtual
// process scopes to the call (../virtual-process.js).

import { exactRereadOmissionEnabled, resolveAgentSessionId, shownSpanTrailerEnabled } from '../../search/agent-span-ledger.js';
import { alreadyShownSessionId, readFixFlags } from '../../search/agent-output-fixes.js';

/**
 * @typedef {object} CallContext
 * @property {string} projectRoot           where the index lives (the main checkout, for a linked worktree)
 * @property {string} fileRoot              where the agent's own files are (ss-read and ss-semantic read here)
 * @property {object} host                  hooks of the resident daemon, {} in a fresh process: getSearcher()
 * @property {string|null} sessionId        key of the agent session in the shown-span ledger
 * @property {boolean} exactRereadOmission  the receipt ledger is on
 * @property {boolean} shownSpanTrailer     the `shown-full:` trailer is on
 * @property {boolean} spanPolicyEnabled    one of the two above is on
 * @property {object} fix                   the output-fix switches (agent-output-fixes.js readFixFlags)
 * @property {string|null} a3SessionId      ledger namespace of A3 (SS_FIX_ALREADY_SHOWN); null = A3 is off
 * @property {boolean} alreadyShownOn       A3 is on
 * @property {boolean} dedupe               SS_VARIANT_SEARCH_DEDUPE
 * @property {object|null} coverage         index coverage, built on first use (shared.mjs getCoverage)
 * @property {boolean} coverageTried        getCoverage ran (its result may be null)
 */

/**
 * @param {{projectRoot: string, fileRoot: string, host?: object}} roots
 * @returns {CallContext}
 */
export function createCallContext({ projectRoot, fileRoot, host = {} }) {
  const sessionId = resolveAgentSessionId();
  const exactRereadOmission = exactRereadOmissionEnabled();
  const shownSpanTrailer = shownSpanTrailerEnabled();

  // Output-fix switches (see core/search/agent-output-fixes.js). Bundle A (A1, A2, A7, A4, A5) is the
  // product default, and so are SS_FIX_GREP_ALLOC (ss-grep line allocation) and SS_FIX_GREP_FULLLINE (ss-grep
  // full hit lines), and since 2026-10-03 SS_FIX_GREP_LINES, SS_FIX_GREP_ALLOC_RULE=guarantee,
  // SS_FIX_GREP_WEIGHT=sat2, SS_FIX_SEMANTIC_RANGES and SS_FIX_TRACE_MODE_BUDGET; SWEET_SEARCH_COMPACT_OUTPUT=0
  // or SS_FIX_A=0 restores the previous output byte for byte. Every other SS_FIX_* switch is default
  // off (bench only).
  const fix = readFixFlags();
  // A3 (SS_FIX_ALREADY_SHOWN only; not part of SS_FIX_A; default off). The original ledger and so
  // ss-read are never changed by it: A3 keeps its receipts under its own ledger namespace
  // (`a3:<session key>`), same session key as ss-read (resolveAgentSessionId). Needs the receipt
  // ledger on. LIMIT: in Claude Code the key cannot tell a subagent from its parent.
  const a3SessionId = fix.alreadyShown && exactRereadOmission ? alreadyShownSessionId(sessionId) : null;

  return {
    projectRoot,
    fileRoot,
    host,
    sessionId,
    exactRereadOmission,
    shownSpanTrailer,
    spanPolicyEnabled: exactRereadOmission || shownSpanTrailer,
    fix,
    a3SessionId,
    alreadyShownOn: !!a3SessionId,
    // final-tuning variant SS_VARIANT_SEARCH_DEDUPE (ss-search only since fff75887).
    dedupe: process.env.SS_VARIANT_SEARCH_DEDUPE === '1',
    coverage: null,
    coverageTried: false,
  };
}
