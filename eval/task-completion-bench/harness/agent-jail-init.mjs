#!/usr/bin/env node
/**
 * agent-jail-init — PID 1 of one rollout's jail. Runs INSIDE the fresh mount/pid/ipc/uts
 * namespaces created by `unshare` (and inside the shared `ssbench` network namespace
 * entered by `nsenter` first). It applies the filesystem policy, signals ready, then
 * idles so the namespaces stay alive for `nsenter`-ed commands (ss-* warmup, agent).
 *
 * THREE PHASES, and the order is the whole trick:
 *
 *   1. STASH  — bind every whitelisted source onto a scratch tmpfs. Almost every
 *      source ($HOME/.gitconfig, the repo, the checkout, the broker IPC dir under
 *      /tmp) lives UNDER a path we are about to erase, so a source captured after
 *      masking would already be gone. Stashing first pins the real inode; a bind
 *      mount keeps working after its original path stops being reachable.
 *   2. MASK   — replace each doomed subtree with an empty tmpfs. The path is then not
 *      "unreadable", it is not THERE: `ls`, `find` and a glob all agree it is empty,
 *      so a probing agent gets no signal that something was hidden and cannot
 *      enumerate what it is missing. Files (docker.sock, the docker client) are
 *      masked with a /dev/null bind instead.
 *   3. BIND   — put the stashed paths back at their real locations, read-only unless
 *      the rollout must write them. Finally the stash itself is covered by a second
 *      tmpfs, so the agent cannot walk back into it.
 *
 * Everything is namespace-local: nothing here mutates the host filesystem, and the
 * whole policy evaporates when this process exits.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const problems = [];
const fail = (op, e) => {
  const msg = `${op.op} ${op.path || op.dst}: ${String(e.stderr || e.message || e).split('\n')[0].slice(0, 140)}`;
  problems.push((op.required ? 'FATAL ' : '') + msg);
};

// --- 1. stash -------------------------------------------------------------
// /mnt is a mask target anyway, so borrowing it costs nothing and leaves no host
// residue: phase 3 covers it with a second tmpfs.
const STASH = spec.stashRoot || '/mnt';
try { run('mount', ['-t', 'tmpfs', 'ss-stash', STASH]); }
catch (e) { problems.push(`FATAL stash ${STASH}: ${String(e.message).slice(0, 120)}`); }

const binds = (spec.ops || []).filter(o => o.op === 'bind');
binds.forEach((op, i) => {
  if (!existsSync(op.src)) { if (op.required) problems.push(`FATAL bind ${op.src}: source missing`); op._skip = true; return; }
  const holder = path.join(STASH, `s${i}`);
  try {
    if (statSync(op.src).isDirectory()) mkdirSync(holder, { recursive: true });
    else writeFileSync(holder, '');
    run('mount', ['--bind', op.src, holder]);
    op._stash = holder;
  } catch (e) { op._skip = true; fail(op, e); }
});

// --- 2 + 3. mask and bind, in the order the policy declares them ----------
for (const op of spec.ops || []) {
  try {
    if (op.op === 'mask') {
      if (!existsSync(op.path)) continue;
      if (statSync(op.path).isDirectory()) run('mount', ['-t', 'tmpfs', '-o', 'mode=0755,size=1m', 'ss-mask', op.path]);
      else run('mount', ['--bind', '/dev/null', op.path]);
    } else if (op.op === 'bind') {
      if (op._skip || !op._stash) continue;
      if (statSync(op._stash).isDirectory()) mkdirSync(op.dst, { recursive: true });
      else { mkdirSync(path.dirname(op.dst), { recursive: true }); if (!existsSync(op.dst)) writeFileSync(op.dst, ''); }
      run('mount', ['--bind', op._stash, op.dst]);
      if (op.ro) run('mount', ['-o', 'remount,ro,bind', op.dst]);
    }
  } catch (e) { fail(op, e); }
}
// Cover the stash: the bind mounts above are independent of it now.
try { run('mount', ['-t', 'tmpfs', '-o', 'mode=0755,size=1m', 'ss-mask', STASH]); }
catch (e) { problems.push(`stash-hide ${STASH}: ${String(e.message).slice(0, 120)}`); }

// --- ready ----------------------------------------------------------------
// The readyFile lives in the host-side /tmp source dir, so the parent sees it
// through the bind without having to enter the namespace.
try { writeFileSync(spec.readyFile, JSON.stringify({ pid: process.pid, ts: Date.now(), problems })); } catch { /* parent times out */ }
for (const p of problems) console.error(`[jail] ${p}`);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
setInterval(() => {}, 1 << 30);
