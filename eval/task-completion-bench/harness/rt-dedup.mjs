// L3 — frame-side run_tests anti-loop lever (PLAN.md §4.4 waste taxonomy).
//
// WHY THIS EXISTS: in heldout200-grok45-opencode-20260726 the agent re-ran `run_tests`
// with an UNCHANGED source diff and received the full suite transcript every time
// (pennylane-3651: fix known by turn 3, then 120+ calls of repeated testing;
// underscore-2757 ~110 post-green calls; php-scoper-1027 70+ post-fix calls). Each
// identical re-run re-sends the ever-growing conversation at $0.30/M cached input —
// the re-send tax that is 94.7% of the run's cost gap, and those 8 tail tasks carried
// 107% of it. This is a MECHANICAL change to the shim, symmetric across both arms; it
// is NOT prompt guidance (prompt-side anti-thrash is struck from the plan, §6 P2).
//
// CONTRACT (the invariants that make it safe to publish a run that used it):
//   1. Tests ALWAYS execute. Nothing is ever skipped — deps/env can change and tests
//      can be flaky, so the suite runs on every invocation exactly as before.
//   2. Only the RESPONSE TEXT is condensed, and only when the state key AND the result
//      are both identical to an earlier call in this rollout.
//   3. The state key is the hash of (git diff HEAD) + (untracked non-ignored files:
//      sorted path + content hash) + the exact run_tests argv. Untracked files are in
//      the key because agents create new files; without them dedup would fire on
//      genuinely changed code. Targeted and full runs are different keys.
//   4. Any doubt → full output. An unhashable tree (too many/too large/unreadable
//      untracked files), an infra-error result, or a missing state log all DISABLE
//      condensation for that call rather than risk a false suppression.
//   5. First invocations and changed-key invocations are BYTE-IDENTICAL to the
//      pre-lever behaviour.
//   6. `--ss-full` bypasses condensation for one call (stripped from argv before the
//      real runner sees it, and excluded from the key). `SS_RUNTESTS_DEDUP=0` disables
//      the whole mechanism; every result row is stamped with which way it ran.
//
// State lives in an append-only JSONL log OUTSIDE the agent's tree
// (results/<RUN_ID>/rt-dedup/<label>.jsonl, masked from the agent by the P0 jail), so
// the log is both the state and the hand-audit record for every firing. A `session`
// record written at shim-generation time bounds a rollout: replay only considers
// records after the LAST session marker, which is what resets state between rollouts
// (and between the two attempts of a shimTampered re-run) without losing the audit
// trail of the earlier attempt.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFailureSignatures } from './rt-condense-lib.mjs';

/** Kill-switch. SS_RUNTESTS_DEDUP=0 → the lever is inert (rows stamped rtDedup:false). */
export const RT_DEDUP_ON = process.env.SS_RUNTESTS_DEDUP !== '0';
/** The single stable marker every suppression carries — grep this to verify firings. */
export const DEDUP_MARKER = '[run_tests-dedup]';
/** Per-call escape hatch. */
export const FULL_FLAG = '--ss-full';

const BENCH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safe = (s) => String(s || 'rollout').replace(/[^\w.@-]/g, '_');
const sha = (s) => createHash('sha256').update(s).digest('hex');

// ---- pure: argv ---------------------------------------------------------------
/**
 * Split the agent's run_tests argv into the escape-hatch flag and the rest.
 * The flag is removed from BOTH the runner argv and the state key so that
 * `run_tests X` and `run_tests X --ss-full` describe the same state.
 *
 * `pattern` stays exactly what the pre-lever shim used — the FIRST positional arg
 * (`process.argv[2]`) — so no invocation changes which tests run. `argv` keeps every
 * positional arg because the KEY must distinguish commands the runner treats alike.
 */
export function parseRunTestsArgv(argv) {
  const list = (Array.isArray(argv) ? argv : [argv])
    .map(a => String(a ?? '').trim())
    .filter(a => a.length > 0);
  const isFull = a => a.toLowerCase() === FULL_FLAG;
  const full = list.some(isFull);
  const rest = list.filter(a => !isFull(a));
  return { full, argv: rest, pattern: rest[0] || '' };
}

// ---- untracked-file fingerprint ----------------------------------------------
/**
 * Hash the untracked, non-ignored working-tree files. `ok:false` means the tree could
 * not be fingerprinted completely — the caller must then treat the state as UNKNOWN
 * and emit full output (never dedup on incomplete information).
 */
export function untrackedFingerprint(rundir, {
  maxFiles = 500, maxBytesPerFile = 2 * 1024 * 1024,
  exclude = /(^|\/)\.sweet-search(\/|$)/,
  listFiles = null, readFile = null,
} = {}) {
  let paths;
  try {
    const raw = listFiles
      ? listFiles(rundir)
      : execFileSync('git', ['-C', rundir, 'ls-files', '--others', '--exclude-standard', '-z'],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    paths = String(raw).split('\0').filter(Boolean).filter(p => !exclude.test(p));
  } catch (e) {
    return { ok: false, reason: 'git ls-files failed: ' + String(e && e.message || e).slice(0, 80), entries: [] };
  }
  if (paths.length > maxFiles) {
    return { ok: false, reason: `untracked set too large (${paths.length} files)`, entries: [] };
  }
  const entries = [];
  for (const p of paths.slice().sort()) {
    const abs = path.join(rundir, p);
    try {
      if (readFile) { entries.push([p, sha(readFile(p))]); continue; }
      const st = statSync(abs);
      if (!st.isFile()) return { ok: false, reason: `untracked non-file: ${p}`, entries: [] };
      if (st.size > maxBytesPerFile) return { ok: false, reason: `untracked file too large: ${p}`, entries: [] };
      entries.push([p, sha(readFileSync(abs))]);
    } catch (e) {
      return { ok: false, reason: `unreadable untracked file: ${p}`, entries: [] };
    }
  }
  return { ok: true, entries };
}

// ---- pure: state key ----------------------------------------------------------
/**
 * The rollout state key. Returns null when the untracked set could not be
 * fingerprinted — a null key means "dedup is not allowed for this call".
 */
export function computeStateKey({ diff, untracked, argv }) {
  if (!untracked || untracked.ok !== true) return null;
  return sha(JSON.stringify({
    v: 1,
    diff: sha(String(diff ?? '')),
    untracked: untracked.entries,
    argv: (argv || []).map(String),
  }));
}

// ---- pure: result summary -----------------------------------------------------
/** The broker stamps `[run_tests exit=N]` on a docker/broker-level failure; else 0. */
export function parseExitCode(text) {
  const m = String(text ?? '').match(/\[run_tests exit=(-?\d+)\]/);
  return m ? Number(m[1]) : 0;
}

/**
 * Reduce suite output to the comparable result: exit code + the normalized failure
 * SET (order-independent), plus a short first-failure excerpt for the summary line.
 * `infra:true` (network/broker/docker error rather than test failures) suppresses
 * condensation entirely — that output is not a test result.
 */
export function summarizeRunTestsResult(text) {
  const exitCode = parseExitCode(text);
  const { sigs, infra } = extractFailureSignatures(text);
  const ordered = [...sigs];
  const failures = ordered.slice().sort();
  const firstFailure = ordered.slice(0, 2).join(' | ').slice(0, 220);
  return {
    exitCode, infra, failures, failureCount: failures.length, firstFailure,
    digest: sha(String(exitCode) + '\n' + failures.join('\n')),
  };
}

// ---- pure: log replay + decision ---------------------------------------------
/**
 * Replay a dedup log into per-key history. Only records AFTER the last `session`
 * marker count, which is how state resets between rollouts/attempts.
 *
 * Records whose response was never DELIVERED to the agent (an `undelivered` marker
 * naming their reqId — see markUndeliveredResponses) are excluded from the history:
 * citing "identical to call #N, result unchanged" is only honest if the agent
 * actually received call #N's transcript. Observed in the wild on a slow C++ suite,
 * where the agent-side tool timeout killed the requester while the broker was still
 * running the suite. Call NUMBERING still counts them, so the log and the agent's
 * call sequence never drift.
 * @returns {{calls:number, byKey:Map<string,{firstCall:number,lastCall:number,lastDigest:string,byDigest:Map<string,number>}>}}
 */
export function replayDedupLog(text) {
  const lines = String(text ?? '').split('\n').filter(l => l.trim());
  let start = 0;
  const recs = [];
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }   // tolerate a torn tail
    recs.push(o);
  }
  for (let i = recs.length - 1; i >= 0; i--) {
    if (recs[i] && recs[i].kind === 'session') { start = i + 1; break; }
  }
  const live = recs.slice(start);
  const undelivered = new Set();
  for (const r of live) {
    if (r && r.kind === 'undelivered') for (const id of r.reqIds || []) undelivered.add(String(id));
  }
  const byKey = new Map();
  let calls = 0;
  for (const r of live) {
    if (!r || r.kind === 'session' || r.kind === 'undelivered') continue;
    calls = Math.max(calls, Number(r.call) || 0);
    if (!r.key) continue;
    if (r.reqId && undelivered.has(String(r.reqId))) continue;
    let h = byKey.get(r.key);
    if (!h) { h = { firstCall: r.call, lastCall: r.call, lastDigest: r.digest, byDigest: new Map() }; byKey.set(r.key, h); }
    h.lastCall = r.call;
    if (r.digest) {
      h.lastDigest = r.digest;
      if (!h.byDigest.has(r.digest)) h.byDigest.set(r.digest, r.call);
    }
  }
  return { calls, byKey };
}

/**
 * The decision. `unchanged` cites the call at which THIS key+result pair was first
 * seen; `changed` cites the most recent call with the same key.
 */
export function dedupDecision(state, key, digest) {
  const h = state && state.byKey ? state.byKey.get(key) : null;
  if (!h) return { mode: 'first', citeCall: null };
  if (digest && h.byDigest.has(digest)) return { mode: 'unchanged', citeCall: h.byDigest.get(digest) };
  return { mode: 'changed', citeCall: h.lastCall };
}

// ---- pure: rendered responses -------------------------------------------------
/**
 * The suppressed-call response.
 *
 * The `--ss-full` hint is DELIBERATELY ABSENT (decided 2026-07-30 after the L3 smoke).
 * When the summary advertised the flag, the agent used it on 20 of 84 calls — usually
 * immediately after a suppression — which hands the transcript straight back, sometimes
 * at the price of an extra turn. Nothing is lost by staying quiet: the summary carries
 * exit code, failure count and the first failure, the full transcript for this exact
 * key is already in the conversation (that is what "unchanged" means), and the
 * legitimate route to more detail is a targeted run — a different argv, hence a
 * different key, hence full output by construction. The flag still works for
 * hand-debugging; it is simply undocumented to the agent.
 */
export function buildDedupSummary({ citeCall, result }) {
  const failClause = result.failureCount
    ? `${result.failureCount} failed, first failure: ${result.firstFailure}`
    : '0 failed (suite green)';
  return `${DEDUP_MARKER} identical source diff + command as call #${citeCall}; result unchanged: ` +
    `exit ${result.exitCode}, ${failClause}.\n` +
    `Change the code before re-running.`;
}

export function buildChangedResultNote(citeCall) {
  return `${DEDUP_MARKER} result CHANGED under an identical source diff + command ` +
    `(same inputs as call #${citeCall}) — possible flakiness or environment change; full output follows.`;
}

// ---- log I/O ------------------------------------------------------------------
/**
 * Where a rollout's dedup log lives: results/<RUN_ID>/rt-dedup/<label>.jsonl, the same
 * convention (and the same RUN_ID||'adhoc' fallback) as the P7 turn logs. NEVER inside
 * the agent's checkout — results/** is masked by the P0 jail, and only the host-side
 * broker writes here, so the state cannot be read or forged from inside a rollout.
 */
export function dedupLogPathFor(label, _rundir) {
  return path.join(BENCH_DIR, 'results', process.env.RUN_ID || 'adhoc', 'rt-dedup', `${safe(label)}.jsonl`);
}

/** Open a rollout's dedup log and write the session boundary. Returns the path, or null. */
export function startDedupSession(file, meta = {}) {
  if (!file) return null;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ kind: 'session', ...meta, ts: Date.now() }) + '\n');
    return file;
  } catch { return null; }
}

export function readDedupState(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return { calls: 0, byKey: new Map() }; }
  return replayDedupLog(text);
}

/**
 * Broker-side: name request ids whose response the requester never consumed, so the
 * replay stops treating those results as something the agent has seen.
 *
 * A response file that is still sitting in the IPC dir well after it was written means
 * the requester process is gone (agent-side tool timeout / abort). The files are NOT
 * removed here — an unconsumed response at rollout exit is exactly what
 * verifyRunnerDirectoryIntegrity reports as tampering, and that signal must survive.
 * `staleMs` keeps the benign case (the requester polls every 400ms) out of the marker.
 */
export function markUndeliveredResponses(file, ipcDir, { staleMs = 5000, now = Date.now(), readdir, stat } = {}) {
  if (!file || !ipcDir) return [];
  let names = [];
  try { names = (readdir || readdirSync)(ipcDir).filter(f => f.startsWith('res-')); } catch { return []; }
  const stale = [];
  for (const name of names) {
    try {
      const st = (stat || statSync)(path.join(ipcDir, name));
      if (now - Number(st.mtimeMs ?? st.mtime ?? 0) >= staleMs) stale.push(name.slice(4));
    } catch { /* vanished between readdir and stat = consumed */ }
  }
  if (stale.length) appendDedupRecord(file, { kind: 'undelivered', reqIds: stale });
  return stale;
}

/** Append one call record. Returns true on success — a failed append must disable dedup. */
export function appendDedupRecord(file, rec) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ ...rec, ts: Date.now() }) + '\n');
    return true;
  } catch { return false; }
}
