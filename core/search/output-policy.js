/**
 * Output-decoration policy for sweet-search CLI tools.
 *
 * Decides WHERE decoration (banner/colors/animation) may be emitted so it is
 * shown only on channels that are free to the user/model, and suppressed
 * wherever captured output would spend tokens. This module makes decisions; it
 * does not render. Renderers (search-cli.js) consult the returned policy.
 *
 * Channel facts that drive the policy (see investigation notes):
 *   - MCP reads only the JSON-RPC response content — decoration must never be
 *     placed there. (Enforced structurally in the MCP layer, not here.)
 *   - Claude Code Bash captures stdout+stderr, but the controlling terminal is
 *     usually still reachable via /dev/tty, which the pipe does not intercept —
 *     so decoration written there is free.
 *   - Codex-style shells pipe stdio and sandbox /dev/tty — never rely on it.
 *   - Cursor/Cline PTY integrations capture the PTY stream itself, so /dev/tty
 *     writes are captured. They present as isTTY=true; we keep them out of the
 *     decorate-on-stdout tier only when a harness env marker is detectable.
 *
 * Decoration is NEVER routed to stderr — that channel is captured too.
 */

import { openSync, closeSync, writeSync } from 'node:fs';

// Best-effort env markers for captured harnesses where decoration on stdout
// (or on a PTY-backed /dev/tty) would cost tokens. Detection here means
// "suppress decoration". Extend conservatively — a false positive only costs a
// banner, a false negative costs the user tokens.
const OTHER_AGENT_ENV_KEYS = ['CURSOR_TRACE_ID', 'CLINE_ACTIVE', 'GEMINI_CLI', 'OPENCODE'];

function _truthy(value) {
  if (value == null) return false;
  const v = String(value).trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

function _hasNoColor(env) {
  // NO_COLOR convention: any non-empty value disables color.
  const v = env.NO_COLOR;
  return v != null && String(v) !== '';
}

// Global decoration override: SWEET_SEARCH_DECORATION=auto|always|never.
// Unknown/empty values fall back to 'auto'.
function _decorationMode(env) {
  const v = String(env.SWEET_SEARCH_DECORATION || '').trim().toLowerCase();
  if (v === 'always' || v === 'never') return v;
  return 'auto';
}

/**
 * Classify the runtime harness from environment variables.
 * @param {Record<string,string|undefined>} env
 * @returns {{ codex: boolean, claudeCode: boolean, otherAgent: boolean }}
 */
export function detectAgentEnv(env = process.env) {
  const e = env || {};
  const keys = Object.keys(e);
  const codex = keys.some((k) => k.startsWith('CODEX_'));
  const claudeCode = _truthy(e.CLAUDECODE) || _truthy(e.CLAUDE_CODE);
  const otherAgent =
    OTHER_AGENT_ENV_KEYS.some((k) => _truthy(e[k])) ||
    keys.some((k) => k.startsWith('CURSOR_'));
  return { codex, claudeCode, otherAgent };
}

/**
 * Best-effort probe for a separately-writable controlling terminal.
 *
 * Opens /dev/tty for writing without emitting any bytes, then closes it.
 * Success means a controlling terminal exists that the captured stdout pipe
 * does not intercept (the Claude Code Bash case). Any error → unavailable.
 * Never throws; never affects the caller's results.
 *
 * @returns {string|null} the tty path if usable, else null
 */
export function defaultProbeTty() {
  try {
    const fd = openSync('/dev/tty', 'w');
    closeSync(fd);
    return '/dev/tty';
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} OutputPolicy
 * @property {('human-terminal'|'claude-tty-sidechannel'|'captured-plain'|'machine-readable')} mode
 * @property {'stdout'} resultStream      where search results go (always stdout)
 * @property {('stdout'|'tty'|null)} decorationStream  where banner/animation go
 * @property {boolean} colorEnabled
 * @property {boolean} bannerEnabled
 * @property {boolean} animationEnabled
 * @property {boolean} machineReadable
 * @property {string|null} ttyPath
 * @property {string} reason             short tag for tests/debugging
 */

/**
 * Decide the output policy for a CLI invocation.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.json=false]        caller requested JSON output
 * @param {string|null} [opts.format=null]   explicit format (e.g. 'plain')
 * @param {boolean} [opts.noBanner=false]    --no-banner flag
 * @param {Record<string,string|undefined>} [opts.env=process.env]
 * @param {boolean} [opts.isTTY]             override; defaults to stream.isTTY
 * @param {{isTTY?: boolean}} [opts.stream=process.stdout]
 * @param {() => (string|null)} [opts.probeTty=defaultProbeTty]  injectable for tests
 * @returns {OutputPolicy}
 */
export function detectOutputPolicy(opts = {}) {
  const env = opts.env || process.env;
  const stream = opts.stream || process.stdout;
  const isTTY = opts.isTTY != null ? !!opts.isTTY : !!(stream && stream.isTTY);
  const json = !!opts.json;
  const plain = opts.format === 'plain';
  const noBanner = !!opts.noBanner;
  const noColor = _hasNoColor(env);
  const agent = detectAgentEnv(env);
  const decorationMode = _decorationMode(env); // 'auto' | 'always' | 'never'
  const probe = typeof opts.probeTty === 'function' ? opts.probeTty : defaultProbeTty;

  /** @type {OutputPolicy} */
  const policy = {
    mode: 'captured-plain',
    resultStream: 'stdout',
    decorationStream: null,
    colorEnabled: false,
    bannerEnabled: false,
    animationEnabled: false,
    machineReadable: false,
    ttyPath: null,
    reason: 'captured-plain',
  };

  // Tier 4: an explicit machine-readable request wins outright — even over
  // SWEET_SEARCH_DECORATION=always.
  if (json) {
    policy.mode = 'machine-readable';
    policy.machineReadable = true;
    policy.reason = 'json';
    return policy;
  }

  if (decorationMode === 'never') {
    // Explicit global opt-out.
    policy.reason = 'decoration-never';
  } else if (decorationMode === 'always') {
    // Explicit global opt-in: decorate on stdout regardless of capture. The
    // user has accepted any token cost. Still routes only to stdout, never
    // stderr.
    policy.mode = 'human-terminal';
    policy.decorationStream = 'stdout';
    policy.bannerEnabled = true;
    policy.colorEnabled = true;
    policy.animationEnabled = true;
    policy.reason = 'decoration-always';
  } else {
    // Harness markers force suppression regardless of TTY state (defensive: a
    // sandboxed codex shell may still report isTTY in some configs; PTY-based
    // capture harnesses look like a TTY but capture the stream).
    const suppress = agent.codex || agent.otherAgent;

    if (isTTY && !suppress) {
      // Tier 1 — real human terminal.
      policy.mode = 'human-terminal';
      policy.decorationStream = 'stdout';
      policy.bannerEnabled = true;
      policy.colorEnabled = true;
      policy.animationEnabled = true;
      policy.reason = 'human-terminal';
    } else if (!isTTY && !suppress && agent.claudeCode) {
      // Tier 2 — captured pipe, but Claude Code is positively detected, so the
      // controlling terminal is reachable via /dev/tty (the pipe does not
      // intercept it). Only Claude Code unlocks this side-channel; a merely
      // writable /dev/tty with no agent marker is NOT trusted, because a
      // PTY-capturing harness would route those bytes straight back into the
      // captured stream.
      const ttyPath = probe();
      if (ttyPath) {
        policy.mode = 'claude-tty-sidechannel';
        policy.decorationStream = 'tty';
        policy.ttyPath = ttyPath;
        policy.bannerEnabled = true;
        policy.colorEnabled = true;
        policy.animationEnabled = true;
        policy.reason = 'claude-code-tty';
      } else {
        policy.reason = 'claude-no-tty';
      }
    } else {
      // Tier 3 — captured / harness-detected / no trusted side-channel.
      policy.reason = agent.codex
        ? 'codex-detected'
        : agent.otherAgent
          ? 'agent-detected'
          : isTTY
            ? 'captured-plain'
            : 'captured-no-claude';
    }
  }

  // Tier 4: explicit opt-outs always reduce decoration, never increase it.
  if (noColor) policy.colorEnabled = false;
  if (noBanner) policy.bannerEnabled = false;
  if (plain) {
    policy.bannerEnabled = false;
    policy.colorEnabled = false;
    policy.animationEnabled = false;
  }

  return policy;
}

/**
 * Build a line writer for the decoration channel chosen by the policy.
 *
 * - 'stdout' → writes through the provided stdout stream.
 * - 'tty'    → opens the tty for writing; on any error falls back to a no-op
 *              (decoration is best-effort and must never break results).
 * - null     → no-op writer.
 *
 * The caller is responsible for only writing when policy.bannerEnabled (or
 * animationEnabled) is true. Always call close() when done.
 *
 * @param {OutputPolicy} policy
 * @param {Object} [opts]   injectable I/O for tests
 * @returns {{ write: (line?: string) => void, close: () => void }}
 */
export function createDecorationWriter(policy, opts = {}) {
  const target = policy ? policy.decorationStream : null;

  if (target === 'stdout') {
    const out = opts.stdout || process.stdout;
    return {
      write: (line = '') => out.write(`${line}\n`),
      close: () => {},
    };
  }

  if (target === 'tty') {
    const open = opts.openTty || (() => openSync(policy.ttyPath || '/dev/tty', 'w'));
    const _writeSync = opts.writeSync || writeSync;
    const _closeSync = opts.closeSync || closeSync;
    let fd = null;
    try {
      fd = open();
    } catch {
      fd = null;
    }
    if (fd == null) {
      return { write: () => {}, close: () => {} };
    }
    return {
      write: (line = '') => {
        try {
          _writeSync(fd, `${line}\n`);
        } catch {
          /* decoration is best-effort; ignore write failures */
        }
      },
      close: () => {
        try {
          _closeSync(fd);
        } catch {
          /* ignore */
        }
      },
    };
  }

  return { write: () => {}, close: () => {} };
}
