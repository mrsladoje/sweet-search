/**
 * Chained ss-* calls: one shell command that runs two or more ss-* tools
 * (`ss-read a; ss-read b`, `ss-trace X callers && ss-grep Y`, a loop).
 *
 * The harness shows the agent the whole command once, followed by the concatenated
 * output of every tool in it. The first output needs no label: it follows the command
 * directly. Each later output starts with one boundary line — the tool name and the
 * start of its first argument — so the agent can tell where one answer ends and the next
 * begins. A call that is not part of a chain prints no boundary.
 *
 * DETECTION. Every harness we ship for runs each tool call in a fresh shell process
 * (Claude Code: `zsh -c 'source <snapshot> … eval <cmd>'`, one per Bash call; Codex:
 * `bash -lc <cmd>` per exec_command; opencode: `<shell> -c <cmd>` per bash call). So the
 * tools of one command share that shell, and the tools of two calls never do. The key is
 * the shell process: its pid plus its start time (a reused pid has another start time).
 *
 * Which process is the shell? Normally the parent. But a shell runs the LAST simple
 * command of `-c` with exec (zsh always, bash for a single command), so that tool IS the
 * shell process, and its parent is the harness — which lives across tool calls and must
 * never be the key. Hence: the parent when the parent is a shell, else this process
 * itself (exec keeps the pid and the start time, so it still matches the earlier tools).
 *
 * REGISTRY. One empty file per shell in a per-user directory under /tmp, shared by every
 * project (a chain may cross repositories, so a daemon's memory would miss it). The first
 * tool of a shell creates the file; a later one finds it. Files older than CHAIN_TTL_MS
 * are stale and swept. The native client (crates/sweet-search-cli/src/agent_tools.rs)
 * implements the same rule and the same file names; whichever decides passes the answer
 * on in CHAIN_LATER_ENV, so a call is never registered twice.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_TOOLS } from './tools.js';

/** '1' = a later call of a chain, '0' = the first (or only) call. Set by whoever decided. */
export const CHAIN_LATER_ENV = 'SWEET_SEARCH_CHAIN_LATER';
/** The pid that stands for this call when a launcher process sits between it and the shell. */
export const CHAIN_PID_ENV = 'SWEET_SEARCH_CHAIN_PID';
export const CHAIN_TTL_MS = 30 * 60 * 1000;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'tcsh', 'csh', 'busybox']);
const ARG_CHARS = 10;
const READ_NAME_CHARS = 40;

export function isShellName(comm) {
  const base = String(comm || '').trim().split('/').pop().replace(/^-/, '');
  return SHELLS.has(base);
}

export function defaultChainDir() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  return `/tmp/sweet-search-chain-${uid}`;
}

/**
 * { ppid, comm, start } of a process, or null. `start` only has to be stable and equal
 * to what the native client reads: Linux /proc starttime ticks, macOS epoch seconds.
 */
export function readProcInfo(pid) {
  if (!Number.isInteger(pid) || pid < 1) return null;
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const open = stat.indexOf('(');
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(' ');
      // fields[0] is field 3 (state): ppid is field 4, starttime field 22.
      return { ppid: Number(fields[1]), comm: stat.slice(open + 1, close), start: fields[19] };
    } catch { return null; }
  }
  try {
    const r = spawnSync('ps', ['-o', 'ppid=', '-o', 'lstart=', '-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' });
    const m = /^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*?)\s*$/.exec(r.stdout || '');
    if (!m) return null;
    const ms = Date.parse(m[2].replace(/\s+/g, ' '));
    if (!Number.isFinite(ms)) return null;
    return { ppid: Number(m[1]), comm: m[3], start: String(Math.floor(ms / 1000)) };
  } catch { return null; }
}

/** The registry key of the shell that ran this call (`pid-start`), or null. */
export function chainKey(selfPid, procInfo = readProcInfo) {
  const self = procInfo(selfPid);
  if (!self) return null;
  const parent = self.ppid > 1 ? procInfo(self.ppid) : null;
  if (parent && isShellName(parent.comm)) return `${self.ppid}-${parent.start}`;
  return `${selfPid}-${self.start}`;
}

function sweep(dir, now, ttlMs) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const p = path.join(dir, name);
    try { if (now - fs.statSync(p).mtimeMs > ttlMs) fs.unlinkSync(p); } catch { /* raced */ }
  }
}

/**
 * Register this call under its shell's key. Returns true when an earlier call of the
 * same shell registered first (this call is a later call of a chain).
 */
export function registerChainCall(key, { dir = defaultChainDir(), now = Date.now(), ttlMs = CHAIN_TTL_MS } = {}) {
  if (!key) return false;
  const file = path.join(dir, key);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch { return false; }
  try {
    fs.closeSync(fs.openSync(file, 'wx', 0o600));
    sweep(dir, now, ttlMs);
    return false;
  } catch (err) {
    if (err?.code !== 'EEXIST') return false;
  }
  try {
    const fresh = now - fs.statSync(file).mtimeMs <= ttlMs;
    const t = new Date(now);
    fs.utimesSync(file, t, t);
    return fresh;
  } catch { return false; }
}

/**
 * Decide (once) whether this call is a later call of a chain and record the answer in
 * `env[CHAIN_LATER_ENV]`. An answer already there (from the native client) stands.
 */
export function resolveChainPosition(env, { selfPid = process.pid, dir, now, procInfo } = {}) {
  if (env[CHAIN_LATER_ENV] === '1' || env[CHAIN_LATER_ENV] === '0') return env[CHAIN_LATER_ENV] === '1';
  const stand = Number(env[CHAIN_PID_ENV]);
  const pid = Number.isInteger(stand) && stand > 1 ? stand : selfPid;
  let later = false;
  try { later = registerChainCall(chainKey(pid, procInfo), { dir, now }); } catch { later = false; }
  env[CHAIN_LATER_ENV] = later ? '1' : '0';
  return later;
}

const TOOL_NAME_BY_SUBCOMMAND = Object.freeze(
  Object.fromEntries(Object.entries(AGENT_TOOLS).map(([name, sub]) => [sub, name])),
);

/** The argument that names the call: the first one that is not a flag or a flag's number. */
function namingArg(args) {
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a.startsWith('-') && a.length > 1) continue;
    if (i > 0 && /^\d+$/.test(a) && String(args[i - 1]).startsWith('-')) continue;
    return a;
  }
  return '';
}

/** `# ss-search Elasticsea…` / `# ss-read timed_queue.rb` (no newline). */
export function chainBoundaryLine(subcommand, args = []) {
  const tool = TOOL_NAME_BY_SUBCOMMAND[subcommand] || subcommand;
  let arg = namingArg(args).replace(/\s+/g, ' ').trim();
  if (!arg) return `# ${tool}`;
  // ss-read names a file, and the reads of one chain mostly share a directory: the start
  // of the path (`lib/sequel…` twice) cannot tell them apart, the file name can.
  const isRead = subcommand === 'read';
  if (isRead) arg = arg.replace(/\/+$/, '').split('/').pop() || arg;
  const max = isRead ? READ_NAME_CHARS : ARG_CHARS;
  const chars = [...arg];
  const cut = chars.length > max ? `${chars.slice(0, max).join('')}…` : arg;
  // No quotes: they cost two tokens and the command above already shows the argument.
  return `# ${tool} ${cut}`;
}

/** The boundary line + newline for a later call of a chain, else ''. */
export function chainBoundary(subcommand, args, env = process.env) {
  return env?.[CHAIN_LATER_ENV] === '1' ? `${chainBoundaryLine(subcommand, args)}\n` : '';
}
