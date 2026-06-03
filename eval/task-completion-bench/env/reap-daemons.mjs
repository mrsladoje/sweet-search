#!/usr/bin/env node
/**
 * Reap leaked sweet-search daemons + stale unix sockets before a task-bench run.
 *
 * Rationale (user memory): sweet-search `cli.js --serve` + `index-maintainer.mjs`
 * leak across runs (documented ~18–33 GB); the no-model-coexistence rule means
 * we must not arm a fresh ss-* server while a stale one (possibly holding GPU
 * models) is alive. The index-maintainer polls in a loop and needs SIGKILL.
 *
 * Safe by construction: matches only the daemon command lines, never this
 * process / a parent shell. Idempotent. Prints what it killed.
 *
 * Usage: node eval/task-completion-bench/env/reap-daemons.mjs [--dry]
 */
import { execSync } from 'node:child_process';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const SELF = process.pid;

function psLines() {
  try {
    return execSync('ps axo pid=,command=', { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { return []; }
}

// Daemon command-line signatures we own. Deliberately specific.
const PATTERNS = [
  { re: /index-maintainer\.mjs/, sig: 'KILL', label: 'index-maintainer' },
  { re: /cli\.js\s+--serve/, sig: 'KILL', label: 'cli.js --serve' },
  { re: /core\/search\/search-server\.js/, sig: 'KILL', label: 'search-server' },
];

function reapProcs() {
  const killed = [];
  for (const line of psLines()) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2];
    if (pid === SELF) continue;
    if (/reap-daemons\.mjs/.test(cmd)) continue;       // never reap ourselves
    if (/claude|cli\.js$|anthropic/i.test(cmd) && !/--serve/.test(cmd)) continue; // not the agent CLI
    for (const p of PATTERNS) {
      if (p.re.test(cmd)) {
        killed.push({ pid, label: p.label, cmd: cmd.slice(0, 90) });
        if (!DRY) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
        break;
      }
    }
  }
  return killed;
}

function reapSockets() {
  const dir = '/tmp';
  const removed = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return removed; }
  for (const e of entries) {
    if (!/^sweet-search.*\.sock$/.test(e)) continue;
    const full = path.join(dir, e);
    try {
      const st = statSync(full);
      if (st.isSocket()) {
        removed.push(e);
        if (!DRY) { try { unlinkSync(full); } catch { /* ignore */ } }
      }
    } catch { /* ignore */ }
  }
  return removed;
}

const killed = reapProcs();
const socks = reapSockets();
console.log(`[reap] ${DRY ? '(dry) ' : ''}procs killed: ${killed.length}`);
for (const k of killed) console.log(`  pid=${k.pid} ${k.label}  ${k.cmd}`);
console.log(`[reap] ${DRY ? '(dry) ' : ''}stale sockets removed: ${socks.length}`);
if (killed.length === 0 && socks.length === 0) console.log('[reap] clean — nothing to reap');
