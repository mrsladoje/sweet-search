#!/usr/bin/env node
/**
 * agent-jail — per-rollout isolation for the agent process (PLAN.md §6 lever P0).
 *
 * Before this, only test EXECUTION was containerized: the agent itself ran as root
 * on the host with the whole box readable. The forensics found six live escape
 * vectors, and 13 of native's 16 discordant wins were ground-truth-assisted — which
 * is why the solve headline is unpublishable. This module closes all six:
 *
 *   V1 task-spec cache (gold + test patches)  ─┐
 *   V2 golden checkouts                        ├─ mount namespace, mask-then-whitelist
 *   V3 prior-run results / ledgers             │  (agent-jail-init.mjs)
 *   V6 HF caches, eval venvs, cross-task /tmp ─┘
 *   V4 live network egress ................... shared netns + SNI allowlist (egress-guard.mjs)
 *   V5 docker socket / task images ........... socket + client masked; run_tests via broker
 *
 * SHAPE: the jail is a long-lived idle process holding the namespaces, not a wrapper
 * around one command. Both the off-clock ss-* warmup and the measured agent run enter
 * the SAME jail with `nsenter`, so the warm daemon the agent talks to is the one
 * inside its own namespaces. Wrapping each command separately would put the warm
 * server in a namespace the agent cannot reach, silently charging the sweet arm a
 * cold start every rollout and corrupting the very cost comparison this exists to
 * make defensible.
 *
 * Killing the jail kills the PID namespace, so ss-* servers and index maintainers
 * cannot outlive their rollout — the orphan-daemon leak is structurally gone.
 *
 * RESIDUAL RISK (documented, matching bench-net-lockdown.sh's standard): the agent
 * still runs as uid 0 inside the jail. /proc is namespaced so no host PID is
 * reachable and there is no route off the veth, but this is leakage-prevention, not
 * adversarial containment. An agent that deliberately attacks the namespace boundary
 * is out of scope; an agent that opportunistically reads what is in front of it —
 * the documented failure — is fully covered.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, openSync, closeSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGuard, guardStatus, HOST_IP, NS, denialsBetween, DENY_LOG } from './egress-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JAIL_INIT = path.join(HERE, 'agent-jail-init.mjs');
const ROOT = path.resolve(HERE, '../../..');
const HOME = process.env.HOME || '/root';
const EVAL_HOME = path.join(HOME, '.ss-eval');
const JAILS_DIR = path.join(EVAL_HOME, 'jails');

export const ISOLATION_ON = process.env.SS_ISOLATION !== '0';
const BENCH_DIR = path.resolve(HERE, '..');

/**
 * A PRIVATE, PERSISTENT state dir for one rollout's agent CLI.
 *
 * Agent CLIs keep their session store in ONE shared directory (~/.local/share/opencode
 * — 1.8 GB holding every rollout that has ever run on the box). That store is escape
 * vector V3/V6 from the inside: the forensics caught rollouts reading the CURRENT run's
 * other-arm trajectories out of it. Giving each rollout its own directory removes the
 * leak and, because the directory outlives the jail, hands P7 (measurement hygiene) the
 * per-turn accounting it asked for — the session DB is the only place fresh input and
 * output are separable, and the last run had to reconstruct them algebraically.
 */
export function rolloutStateDir(label, name) {
  const dir = path.join(BENCH_DIR, 'results', process.env.RUN_ID || 'adhoc', 'agent-state', String(label).replace(/[^\w.@-]/g, '_'), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}
const which = (b) => { try { return execFileSync('/bin/bash', ['-c', `command -v ${b}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const sleepSync = (s) => { try { execFileSync('sleep', [String(s)]); } catch { /* */ } };

/** Can this host run the jail at all? run-pilot calls this before any rollout. */
export function jailPreflight() {
  const reasons = [];
  if (process.platform !== 'linux') reasons.push(`platform ${process.platform}: namespaces are Linux-only — isolated runs must go on the eval box`);
  if (typeof process.getuid === 'function' && process.getuid() !== 0) reasons.push('must run as root (mount + netns)');
  for (const b of ['unshare', 'nsenter', 'mount', 'ip', 'iptables']) if (!which(b)) reasons.push(`missing binary: ${b}`);
  return { ok: reasons.length === 0, reasons };
}

/**
 * Ordered filesystem policy for one rollout. Read it top to bottom — each op lands on
 * top of the previous ones.
 */
function buildOps({ rundir, jailDir, runnerStateDir, tmpSrc, extraBinds = [], extraMasks = [] }) {
  const ops = [];
  const mask = (p) => ops.push({ op: 'mask', path: p });
  const bind = (src, dst, o = {}) => ops.push({ op: 'bind', src, dst: dst || src, ...o });

  // 1. Erase $HOME wholesale. Goldens (V2), the task-spec cache and every prior run's
  //    results/ledgers (V1/V3), the HF + uv + pip caches and eval venvs (V6), the
  //    OpenRouter key file, shell history and the run logs all live under it. Masking
  //    the parent and whitelisting back is the only version of this that does not rot
  //    the next time someone adds a directory.
  mask(HOME);
  mask('/workspace');                                   // docker image vault + golden vault
  // NOT /mnt: that is the stash root jail-init pins bind sources on before masking,
  // and it covers it with its own tmpfs once the binds are in place.
  for (const p of ['/srv', '/media']) mask(p);

  // 2. V5: no docker. The socket AND the client are masked, and run_tests is routed
  //    through the host-side broker instead. Task images carry the full git history
  //    of the repo including the fix commit, so `docker cp`/`git show` inside an image
  //    was a direct read of the answer (PLAN.md §2 V5).
  for (const p of ['/var/run/docker.sock', '/run/docker.sock', '/usr/bin/docker',
    '/usr/local/bin/docker', '/usr/bin/ctr', '/usr/bin/nerdctl']) mask(p);
  //    V5b — the CONTAINER LAYER STORE, found by the first jailed canary rollout and
  //    not in the original forensics at all. containerd unpacks every image layer as
  //    plain files on the host, so blocking the socket and the client blocks nothing:
  //    the agent ran `find / -name 'run_tests*'`, landed in the snapshot tree, and read
  //    swebench_matterhorn/swebench_instance.json — which carries `patch`, `test_patch`,
  //    FAIL_TO_PASS and PASS_TO_PASS. It printed the gold diff and edited from it. No
  //    docker command involved; the whole task spec is just readable as files.
  for (const p of ['/var/lib/docker', '/var/lib/containerd', '/var/lib/containers',
    '/var/lib/podman', '/var/lib/buildkit', '/run/containerd', '/var/lib/nerdctl']) mask(p);
  for (const p of extraMasks) mask(p);
  for (const p of (process.env.SS_JAIL_EXTRA_MASKS || '').split(',').filter(Boolean)) mask(p);

  // 3. The engine under test, read-only...
  bind(ROOT, ROOT, { ro: true, required: true });
  // ...with its own benchmark masked back out of it. This is the ordering that matters:
  // the repo bind above would otherwise re-expose eval/task-completion-bench (results,
  // select/.cache, env-ledger, forensics) that step 1 had just hidden.
  mask(path.join(ROOT, 'eval'));
  mask(path.join(ROOT, '.git'));
  mask(path.join(ROOT, '.index-cache'));
  // The sweet arm needs exactly one directory back out of eval/: the ss-* wrappers.
  bind(path.join(ROOT, 'eval/agent-read-workflows/bin'), null, { ro: true });

  // 4. Minimal $HOME whitelist.
  bind(path.join(HOME, '.gitconfig'), null, { ro: true });
  bind(path.join(HOME, '.local/bin'), null, { ro: true });
  bind(path.join(HOME, '.cache/sweet-search'));         // vocab/model cache — writable, no task data
  for (const b of extraBinds) bind(b.src, b.dst, { ro: b.ro, required: b.required });

  // 5. Private /tmp. This MUST come before the binds below: runnerStateDir lives under
  //    /tmp, so binding it first and mounting /tmp afterwards buries it. That exact
  //    ordering bug made `run_tests` "command not found" in the first jailed rollout —
  //    and the agent, left with no way to run tests, went looking for the harness across
  //    the box and found the gold patch in the container layer store. A broken control
  //    does not fail quietly; it changes what the agent does.
  bind(tmpSrc, '/tmp', { required: true });
  // 6. The rollout's own checkout: the only writable real path in the jail.
  bind(rundir, rundir, { required: true });
  // 7. The run_tests broker IPC dir, so the in-jail shim can hand work to the host.
  if (runnerStateDir) bind(runnerStateDir, runnerStateDir, { required: true });

  return ops;
}

/** Start one rollout's jail. ALWAYS pair with stopJail in a finally. */
export function startJail({ rundir, runnerStateDir, label = 'rollout', extraBinds = [], extraMasks = [], allow } = {}) {
  if (!ISOLATION_ON) return null;
  const pf = jailPreflight();
  if (!pf.ok) throw new Error(`agent jail unavailable: ${pf.reasons.join('; ')}`);
  ensureGuard(allow);

  const jailDir = path.join(JAILS_DIR, `${label.replace(/[^\w.@-]/g, '_')}-${process.pid}-${Date.now()}`);
  const tmpSrc = path.join(jailDir, 'tmp');
  mkdirSync(tmpSrc, { recursive: true });
  chmodSync(tmpSrc, 0o1777);                            // the jail's private /tmp
  const resolvConf = path.join(jailDir, 'resolv.conf');
  writeFileSync(resolvConf, `nameserver ${HOST_IP}\noptions timeout:1 attempts:1\n`);
  // A clean /etc/hosts so EVERY name goes to the stub resolver and is auditable. The
  // host's file still carries bench-net-lockdown.sh's 0.0.0.0 entries for code hosts;
  // those block the same traffic, but they block it before the guard ever sees it, so
  // the attempt would vanish from the record. Under the jail the blocklist is
  // redundant anyway — the allowlist is what decides.
  const hostsFile = path.join(jailDir, 'hosts');
  writeFileSync(hostsFile, '127.0.0.1 localhost\n::1 localhost ip6-localhost ip6-loopback\n');

  const ops = buildOps({ rundir, jailDir, runnerStateDir, tmpSrc, extraBinds, extraMasks });
  ops.push({ op: 'bind', src: resolvConf, dst: '/etc/resolv.conf' });
  ops.push({ op: 'bind', src: hostsFile, dst: '/etc/hosts' });
  // The ready file is written to the IN-JAIL path /tmp/.jail-ready, which lands in
  // tmpSrc on the host through the bind. Writing the host path directly would fail:
  // by then $HOME (where tmpSrc lives) has been masked inside the namespace.
  const spec = { ops, stashRoot: '/mnt', readyFile: '/tmp/.jail-ready' };
  const readyPath = path.join(tmpSrc, '.jail-ready');
  const specPath = path.join(jailDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));

  // Log to a FILE, not a pipe: the readiness wait below is synchronous, so pipe
  // 'data' events would never fire and a failing jail would report empty stderr.
  const logPath = path.join(jailDir, 'jail.log');
  const logFd = openSync(logPath, 'a');
  // nsenter (join the shared netns) → unshare (fresh mount/pid/ipc/uts) → jail-init.
  const proc = spawn('nsenter', [
    `--net=/var/run/netns/${NS}`, '--',
    'unshare', '--mount', '--pid', '--fork', '--mount-proc', '--ipc', '--uts', '--propagation', 'private', '--',
    process.execPath, JAIL_INIT, specPath,
  ], { stdio: ['ignore', logFd, logFd] });
  closeSync(logFd);

  // jail-init is unshare's forked child; its HOST pid is what nsenter needs later.
  const deadline = Date.now() + 30000;
  let initPid = null, ready = null;
  while (Date.now() < deadline && !(initPid && ready)) {
    if (!initPid) {
      try { initPid = Number(execFileSync('ps', ['--ppid', String(proc.pid), '-o', 'pid='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]) || null; } catch { /* not forked yet */ }
    }
    if (existsSync(readyPath)) { try { ready = JSON.parse(readFileSync(readyPath, 'utf8')); } catch { /* partial write */ } }
    if (!(initPid && ready)) sleepSync(0.1);
  }
  if (!initPid || !ready) {
    try { process.kill(proc.pid, 'SIGKILL'); } catch { /* */ }
    let log = ''; try { log = readFileSync(logPath, 'utf8').slice(-400); } catch { /* */ }
    throw new Error(`jail failed to come up (initPid=${initPid} ready=${!!ready}) ${log}`);
  }
  const fatal = (ready.problems || []).filter(p => p.startsWith('FATAL'));
  if (fatal.length) { try { process.kill(initPid, 'SIGKILL'); } catch { /* */ } throw new Error(`jail policy failed: ${fatal.join(' | ')}`); }
  if (ready.problems?.length) console.error(`  [jail ${label}] non-fatal policy warnings: ${ready.problems.join(' | ')}`);
  return { initPid, wrapperPid: proc.pid, jailDir, label, startedMs: Date.now() };
}

/** argv pair [bin, args] that runs `bin args` inside the jail with cwd=`cwd`. */
export function jailArgv(jail, bin, args, cwd) {
  return ['nsenter', [
    '--target', String(jail.initPid), '--mount', '--pid', '--ipc', '--uts', '--net',
    `--wd=${cwd}`, '--', bin, ...args,
  ]];
}

/**
 * Env fixups for a jailed agent: docker is unreachable by construction, so DOCKER_HOST
 * must not survive into the agent — a stale value only produces a confusing connect
 * error instead of a clean "there is no docker here".
 */
export function jailEnv(env) {
  const e = { ...env, SS_JAIL: '1', SS_JAIL_NETNS: NS };
  delete e.DOCKER_HOST;
  return e;
}

/** Kill the jail: the PID namespace dies with init, taking every ss-* daemon with it. */
export function stopJail(jail) {
  if (!jail) return;
  for (const pid of [jail.initPid, jail.wrapperPid]) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  try { rmSync(jail.jailDir, { recursive: true, force: true }); } catch { /* */ }
}

/** Network-escape attempts recorded while this jail was alive (CONCURRENCY=1 policy). */
export function jailDenials(jail, endMs = Date.now()) {
  return jail ? denialsBetween(jail.startedMs, endMs) : [];
}

export { guardStatus, DENY_LOG, ROOT };
