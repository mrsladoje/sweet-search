// D-6 — make the `run_tests` verdict TERMINAL.
//
// THE DEFECT. Codex's shell tool hands a still-running command back to the model as a cell
// handle plus whatever stdout has accumulated so far. Both `run_tests` shims wrote NOTHING
// until the suite finished, so a yielded launch was returned to the model as
//
//     Script running with cell ID 3 / Wall time 11.0 seconds / Output:
//
// with an empty Output — and a rollout read that emptiness as "the tests completed
// successfully". Yield-before-completion appears in 14 codex task-arm cells across eight
// tasks (SLATE-A-UBER §3 D-6).
//
// WHY THE PROMPT FIX WAS NOT ENOUGH. `SS_RT_LONGYIELD` (540f76c) tells the agent to launch
// with `yield_time_ms=300000`. The FRAME already said to wait and the agent ignored it, so
// another sentence is not the fix. These two changes are mechanical instead:
//
//   1. AN IMMEDIATE BANNER. The shim writes a running banner before it does any work, so a
//      yielded cell can never be empty and always says, in the tool output itself, that no
//      verdict exists yet. The verdict line the banner names — `[run_tests verdict] status=`
//      — is produced only by a completed run, so "did the agent actually receive a verdict"
//      is decidable from the transcript.
//   2. ATTACH, DO NOT RELAUNCH. A `run_tests` call made while an earlier one is still in
//      flight attaches to that run and returns ITS verdict, instead of starting a second
//      suite. That is the "handle the harness resolves before another model step": the next
//      call the model makes resolves the one it abandoned, at no extra suite cost.
//
// ARM-UNIVERSAL BY CONSTRUCTION — one shim serves both arms, so this carries zero
// head-to-head differential and must never be booked as a sweet win. It is a validity fix.
//
// THE BANNER IS DELAYED (2026-09-29, Codex phase-4 audit). Written at launch, it headed EVERY
// completed result — "RUNNING ... This text is NOT a result" directly above the verdict — and
// in Codex code mode it never reached the model in flight anyway: the JS cell prints only
// after `exec_command` returns, so 1365 of the 1408 yielded Codex cells under results/
// (checked 2026-09-29) carried no output at all, banner or not. It is now written only once the run has gone
// RUNNING_BANNER_DELAY_MS without a verdict, and cancelled when the verdict lands first. A
// result that completes inside the delay carries no banner; a harness that reads stdout
// after the delay (a Codex `exec_command` yield, 10 s by default) still sees it. A stream
// cannot retract bytes, so a run slower than the delay that is read only once, at the end,
// still starts with the banner.
import { writeFileSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import * as bannerCp from 'node:child_process';

/** Written once a run has gone RUNNING_BANNER_DELAY_MS without a verdict; never on a fast result. */
export const RUNNING_BANNER =
  '[run_tests] RUNNING — the suite has been launched and has NOT produced a verdict yet.\n'
  + '[run_tests] This text is NOT a result. A completed run always ends with a line beginning\n'
  + '[run_tests] "[run_tests verdict] status=". Until that line appears below, you do not know\n'
  + '[run_tests] whether anything passed or failed — do not report, conclude or finish on this.\n';

/** Below Codex's default 10 s `exec_command` yield, so a default-yield read is never empty. */
export const RUNNING_BANNER_DELAY_MS = 8000;

/**
 * Write RUNNING_BANNER after `delayMs` unless the returned stop() runs first. stop() resolves
 * once no banner can still be written, so the caller writes its verdict only after it.
 * `blocking: true` keeps the timer in a child process: the direct shim runs the suite
 * synchronously, and a timer in its own event loop would fire only after the verdict.
 */
export function startRunningBanner(delayMs = RUNNING_BANNER_DELAY_MS, { blocking = false } = {}) {
  if (!(Number(delayMs) > 0)) { process.stdout.write(RUNNING_BANNER); return async () => {}; }
  if (!blocking) {
    const timer = setTimeout(() => process.stdout.write(RUNNING_BANNER), Number(delayMs));
    return async () => clearTimeout(timer);
  }
  let child;
  try {
    child = bannerCp.spawn(process.execPath, ['-e',
      `setTimeout(() => process.stdout.write(${JSON.stringify(RUNNING_BANNER)}), ${Number(delayMs)})`],
    { stdio: ['ignore', 'inherit', 'ignore'] });
    child.unref();
  } catch { process.stdout.write(RUNNING_BANNER); return async () => {}; }
  return () => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const done = setTimeout(resolve, 2000);                // never hold a verdict on a stuck child
    child.once('exit', () => { clearTimeout(done); resolve(); });
    try { child.kill('SIGKILL'); } catch { clearTimeout(done); resolve(); }
  });
}

/** Written when a call attaches to a run that was already in flight. */
export const ATTACH_NOTE =
  '[run_tests] A previous run_tests launch is still in flight. Attaching to it rather than\n'
  + '[run_tests] starting a second suite; its verdict follows below.\n';

/** Written when no verdict arrived inside the deadline. Never mistakable for a pass. */
export const NO_VERDICT_NOTE = (secs) =>
  `[run_tests] NO VERDICT — nothing came back within ${secs}s. The suite did not report.\n`
  + '[run_tests] This is not a pass and not a failure. Re-run run_tests.\n';

const INFLIGHT = 'inflight-';
const VERDICT = 'verdict-';

// Clamped at zero: a filesystem timestamp can round a fraction of a millisecond ahead of
// the clock, and a negative age would make a marker look permanently fresh.
const ageOf = (p, now) => {
  try { return Math.max(0, now - Number(statSync(p).mtimeMs || 0)); } catch { return Infinity; }
};

/**
 * The id of a run that is genuinely still in flight: an inflight marker younger than
 * `ttlMs` whose verdict has not landed. Stale markers and their verdicts are swept.
 * @returns {string|null}
 */
export function findInflight(ipcDir, ttlMs, { now = Date.now() } = {}) {
  let names = [];
  try { names = readdirSync(ipcDir); } catch { return null; }
  let best = null, bestAge = Infinity;
  for (const n of names) {
    if (!n.startsWith(INFLIGHT)) continue;
    const id = n.slice(INFLIGHT.length);
    const age = ageOf(path.join(ipcDir, n), now);
    if (age >= ttlMs) {                                   // stale: sweep it and its verdict
      try { rmSync(path.join(ipcDir, n), { force: true }); } catch { /* raced */ }
      try { rmSync(path.join(ipcDir, VERDICT + id), { force: true }); } catch { /* raced */ }
      continue;
    }
    if (existsSync(path.join(ipcDir, VERDICT + id))) continue;   // already answered
    if (age < bestAge) { best = id; bestAge = age; }
  }
  return best;
}

/** Claim ownership of a new run. */
export function markInflight(ipcDir, id, argv = []) {
  try { mkdirSync(ipcDir, { recursive: true }); } catch { /* exists */ }
  try { writeFileSync(path.join(ipcDir, INFLIGHT + id), JSON.stringify({ argv, t: Date.now() })); } catch { /* best effort */ }
}

/** Publish a durable copy of the verdict, readable by a call that attached to this run. */
export function publishVerdict(ipcDir, id, text) {
  try { writeFileSync(path.join(ipcDir, VERDICT + id), String(text ?? '')); } catch { /* best effort */ }
}

/** Read a published verdict, or null while the run is still going. */
export function readVerdict(ipcDir, id) {
  const p = path.join(ipcDir, VERDICT + id);
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

/** Release ownership. The verdict copy stays until it goes stale, so attachers can read it. */
export function clearInflight(ipcDir, id) {
  try { rmSync(path.join(ipcDir, INFLIGHT + id), { force: true }); } catch { /* raced */ }
}

/** A completed run always carries the machine verdict footer; a yielded one never does. */
export function hasVerdict(text) {
  return /^\[run_tests verdict\] status=/m.test(String(text ?? ''));
}

export function newRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================ INLINE BOUNDARY ============================
// Everything ABOVE this line is inlined VERBATIM into the generated `run_tests` shim by
// `inflightInlineSource()` below. Nothing above it may import anything but a `node:` builtin.
//
// WHY THE SHIM INLINES RATHER THAN IMPORTS (2026-08-24; the D2 deployment that was reverted).
// Under the production isolation policy `agent-jail.mjs` masks the whole of `<repo>/eval`,
// so EVERY file in this directory is ENOENT inside the jail — reproduced with a real
// rollout's binds by `handoffs/improve/phase1-scripts/d2-jail-import-probe.mjs`. The shim
// that runs in production is the BROKER REQUESTER, and before D2 it imported nothing but
// `node:fs`, which is why it never noticed. D2 gave it an absolute-path import of this file
// and every `run_tests` call on every harness died with ERR_MODULE_NOT_FOUND — silently,
// because the agent just never received a verdict. Preflight stayed green throughout: it
// validates that a gold grade transfers, and it never executes the shim.
//
// Inlining removes the dependency instead of widening the jail, so the shim is immune to
// the mount policy. `tests/rt-inflight.mjs` asserts the requester imports `node:` and
// nothing else, which is the regression that would otherwise ship silently again.
// =========================================================================
// Below the boundary, so the inlined shim text never carries an import it does not use.
import { fileURLToPath } from 'node:url';

// ---- SAME-DIFF ATTACH: BEGIN ----
// RT_ATTACH_REQUIRE_SAME_DIFF=1 — attach only to a run that tested THIS working tree.
//
// THE DEFECT. The attach rule above keys on nothing but "a launch is in flight". A baseline
// launched before an edit and attached to after it returned the PRE-edit numbers under
// "Authoritative test result for your CURRENT edits". With the switch on, every launch records
// a key of the working tree it was started on, and a later call attaches only when its own key
// is identical. Otherwise it starts a fresh run.
//
// THE STALE RUN IS LEFT TO FINISH, NEVER KILLED. Killing the docker CLIENT of a `docker run
// --rm` leaves the container running, so a kill leaks exactly the resource it meant to save.
// The fresh run is SERIALISED behind it instead: the broker already handles requests one at a
// time, and the direct shim waits (bounded by one suite budget) for the stale verdict before
// it starts. Per rollout, at most one suite runs at a time in both modes. The stale result
// still reaches its own launcher; it is only never shown as the answer to the later call.
//
// Inlined into the shim ONLY when the switch is on, so the switch-off shim text is
// byte-identical to the pre-switch one. Same import rule as above: `node:` builtins only, and
// namespace bindings whose names cannot collide with the region above or the shim template.
import * as attachCp from 'node:child_process';
import * as attachCrypto from 'node:crypto';

/** Untracked paths that never change what a suite sees. Kept equal to rt-untracked-diff.mjs. */
export const ATTACH_KEY_UNTRACKED_EXCLUDES = [
  '.sweet-search', 'CLAUDE.md', 'AGENTS.md', '.c3-handoff.md',
  '.claude', '.codex', '.opencode', '.cursor',
];
const ATTACH_KEY_MAX_FILES = 500;
const ATTACH_KEY_MAX_FILE_BYTES = 2 * 1024 * 1024;
const ATTACH_KEY_MAX_TOTAL_BYTES = 16 * 1024 * 1024;   // past this, size+mtime stand in for content

/** Written when a call refuses to attach to a run that was started on a different tree. */
export const STALE_INFLIGHT_NOTE =
  '[run_tests] A previous run_tests launch is still in flight, but it was started before your\n'
  + '[run_tests] latest edits. Not attaching to it: a fresh run on your CURRENT edits starts once\n'
  + '[run_tests] that one finishes, and its verdict follows below.\n';

/**
 * A hash of the tree a suite would test: `git diff HEAD` plus every untracked, non-ignored
 * file (content when the set is small, size and mtime when it is not). Null when git fails;
 * a null key never matches, so the call runs fresh rather than attach on unknown state.
 */
export function workingTreeKey(rundir) {
  // GIT_OPTIONAL_LOCKS=0: this read must never take index.lock under the agent's own git.
  const run = (args) => attachCp.execFileSync('git', ['-C', rundir, ...args], {
    maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  try {
    const h = attachCrypto.createHash('sha256');
    h.update(run(['diff', 'HEAD', '--', '.', ':(exclude).sweet-search']));
    const names = run(['ls-files', '--others', '--exclude-standard', '-z', '--', '.',
      ...ATTACH_KEY_UNTRACKED_EXCLUDES.map(p => ':(exclude)' + p)])
      .toString('utf8').split('\0').filter(Boolean).sort();
    let budget = names.length <= ATTACH_KEY_MAX_FILES ? ATTACH_KEY_MAX_TOTAL_BYTES : 0;
    h.update('\0untracked\0' + names.length);
    for (const name of names) {
      h.update('\0' + name + '\0');
      try {
        const st = statSync(path.join(rundir, name));
        if (st.isFile() && st.size <= ATTACH_KEY_MAX_FILE_BYTES && st.size <= budget) {
          budget -= st.size;
          h.update(readFileSync(path.join(rundir, name)));
        } else h.update(st.size + ':' + st.mtimeMs);
      } catch { h.update('?'); }
    }
    return h.digest('hex');
  } catch { return null; }
}

/** markInflight, plus the key of the tree this run was launched on. */
export function markInflightKeyed(ipcDir, id, argv = [], key = null) {
  try { mkdirSync(ipcDir, { recursive: true }); } catch { /* exists */ }
  try { writeFileSync(path.join(ipcDir, INFLIGHT + id), JSON.stringify({ argv, t: Date.now(), key })); } catch { /* best effort */ }
}

/**
 * The live in-flight runs split by key: `match` is the youngest one launched on `key`,
 * `other` the youngest one that was not. Stale markers are swept exactly as findInflight
 * sweeps them. A run with no recorded key (an unkeyed marker) never matches.
 * @returns {{match:string|null, other:string|null}}
 */
export function findInflightForKey(ipcDir, ttlMs, key, { now = Date.now() } = {}) {
  findInflight(ipcDir, ttlMs, { now });                  // sweeps stale markers
  let names = [];
  try { names = readdirSync(ipcDir); } catch { return { match: null, other: null }; }
  let match = null, matchAge = Infinity, other = null, otherAge = Infinity;
  for (const n of names) {
    if (!n.startsWith(INFLIGHT)) continue;
    const id = n.slice(INFLIGHT.length);
    if (existsSync(path.join(ipcDir, VERDICT + id))) continue;   // already answered
    const age = ageOf(path.join(ipcDir, n), now);
    if (age >= ttlMs) continue;
    let launchedOn = null;
    try { launchedOn = JSON.parse(readFileSync(path.join(ipcDir, n), 'utf8')).key ?? null; } catch { /* torn */ }
    if (key !== null && launchedOn === key) { if (age < matchAge) { match = id; matchAge = age; } }
    else if (age < otherAge) { other = id; otherAge = age; }
  }
  return { match, other };
}

/** True while run `id` is live: its marker exists and its verdict has not landed. */
export function inflightPending(ipcDir, id) {
  return existsSync(path.join(ipcDir, INFLIGHT + id)) && !existsSync(path.join(ipcDir, VERDICT + id));
}
// ---- SAME-DIFF ATTACH: END ----

const INLINE_BOUNDARY = '// ============================ INLINE BOUNDARY ====';

/**
 * This module's own source down to the inline boundary, with the `export` keywords removed,
 * ready to be prepended to a generated shim. Reading the real file keeps ONE definition of
 * the in-flight protocol: a copy pasted into the shim template would drift.
 */
export function inflightInlineSource() {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const cut = src.indexOf(INLINE_BOUNDARY);
  if (cut < 0) throw new Error('rt-inflight.mjs: inline boundary marker missing — the shim would be generated empty');
  const body = src.slice(0, cut).replace(/^export /gm, '');
  // A non-builtin import above the boundary is the exact defect this exists to prevent, and
  // it must fail at shim-generation time on the host, not at run_tests time inside the jail.
  for (const m of body.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)) {
    if (!m[1].startsWith('node:')) throw new Error(`rt-inflight.mjs: "${m[1]}" is imported above the inline boundary; the shim cannot resolve it inside the jail`);
  }
  return body;
}

// Built by concatenation so the constants never match their own marker lines.
const SAME_DIFF_BEGIN = '// ---- SAME-DIFF ' + 'ATTACH: BEGIN ----';
const SAME_DIFF_END = '// ---- SAME-DIFF ' + 'ATTACH: END ----';

/** RT_ATTACH_REQUIRE_SAME_DIFF=1. Read by the HOST at shim-generation time. */
export function attachRequireSameDiffFromEnv(env = process.env) {
  return env.RT_ATTACH_REQUIRE_SAME_DIFF === '1';
}

/**
 * The SAME-DIFF ATTACH region, `export` stripped, for a shim generated with the switch on.
 * It runs in the same scope as inflightInlineSource(), whose names it uses, so it is always
 * appended AFTER that text and never on its own.
 */
export function sameDiffAttachInlineSource() {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const a = src.indexOf(SAME_DIFF_BEGIN), b = src.indexOf(SAME_DIFF_END);
  if (a < 0 || b < a) throw new Error('rt-inflight.mjs: SAME-DIFF ATTACH markers missing — the shim would be generated without its attach check');
  const body = src.slice(a, b).replace(/^export /gm, '');
  for (const m of body.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)) {
    if (!m[1].startsWith('node:')) throw new Error(`rt-inflight.mjs: "${m[1]}" is imported in the SAME-DIFF ATTACH region; the shim cannot resolve it inside the jail`);
  }
  return body;
}

/**
 * The verdict a completed run_tests result reports, or null when there is none.
 *
 * A result text can legitimately hold MORE than one footer — a call that attached to an
 * in-flight run replays that run's published verdict before its own — and opencode and
 * claude-code transcripts store each tool result twice (Appendix B trap 3). Both are handled
 * by taking the LAST footer: it is the terminal one, and one verdict per CALL is what keeps
 * these counters summing to rtLaunched instead of to a transcript-duplication artefact.
 *
 * `trustworthy` is read from the baseline-diff footer, which is a separate line from the
 * status line: a run can report status=PASS and still be untrustworthy when no clean
 * baseline was captured. That distinction is the whole point of the counter.
 */
export function verdictOf(text) {
  const t = String(text ?? '');
  let status = null, trustworthy = false;
  for (const m of t.matchAll(/^\[run_tests verdict\] status=(PASS|FAIL|INFRA|ERROR)\b/gm)) status = m[1];
  if (status === null) return null;
  for (const m of t.matchAll(/^\[run_tests baseline-diff\][^\n]*\btrustworthy=(yes|no)\b/gm)) trustworthy = m[1] === 'yes';
  return { status, trustworthy };
}

/**
 * D-6 ROW TELEMETRY (HANDOFF-SLATE-A-RESIDUE §3.G.2).
 *
 * The banner above made "did the agent actually receive a verdict" decidable from the
 * transcript, but nothing counted it, so "the agent claimed success without a verdict" was a
 * transcript search rather than a row field. This turns it into four countable columns.
 *
 * Takes `[{kind, resultText}]` — the runner's tool calls with their FULL result text, NOT the
 * trajectory. This distinction is load-bearing: `buildTrajectory` truncates every result to 600
 * characters, and the verdict footer is the LAST line a completed run writes, so a long passing
 * suite read off the trajectory would be counted as "no verdict". Measuring the fix's own
 * telemetry through a lossy channel is the shape of error this whole handoff is about.
 *
 * Reported per rollout:
 *
 *   rtLaunched          run_tests calls made
 *   rtVerdicts          how many of those returned the terminal verdict footer
 *   rtNoVerdict         the difference — launches the model never got an answer for
 *   rtEndedUnverified   TRUE when the rollout's LAST run_tests call carried no verdict, i.e.
 *                       the agent stopped on a launch it never resolved. This is the one that
 *                       maps to the original defect; a mid-rollout unresolved launch is usually
 *                       resolved by the next call attaching to it.
 *
 * A rollout that never ran the tests reports rtLaunched = 0 and rtEndedUnverified = false —
 * that is a different failure and must not be pooled with this one.
 *
 * WHAT THE VERDICT SAID (F5 / slate C §4.2, 2026-09-02). The four columns above count whether
 * a verdict ARRIVED and never what it said, so a rollout in which every verdict was
 * untrustworthy was indistinguishable in `rows.json` from one in which every verdict passed.
 * That is how accenture__sfmc-devtools-1974 ran 104 run_tests calls across 44 rollouts without
 * one trustworthy answer, and nobody could see it without grepping transcripts. Two more:
 *
 *   rtTrustworthy   verdicts whose baseline-diff footer reads trustworthy=yes. A verdict the
 *                   agent could actually act on.
 *   rtInfra         verdicts whose status is INFRA. The suite result was suppressed.
 *   rtError         verdicts whose status is ERROR (2026-09-29): the suite did not build,
 *                   collect or load, so no test result exists (zmap__zlint-299 Go compile
 *                   failure). Always untrustworthy.
 *
 * Both count VERDICTS, not launches, so rtTrustworthy + (untrustworthy) = rtVerdicts and a
 * one-line jq over rows.json replaces the per-cell census script.
 */
export function runTestsTelemetry(calls = []) {
  const tests = calls.filter(s => s && s.kind === 'test');
  const verdicts = tests.map(s => verdictOf(s.resultText));
  const rtVerdicts = verdicts.filter(Boolean).length;
  return {
    rtLaunched: tests.length,
    rtVerdicts,
    rtNoVerdict: tests.length - rtVerdicts,
    rtEndedUnverified: tests.length > 0 && verdicts[verdicts.length - 1] === null,
    rtTrustworthy: verdicts.filter(v => v?.trustworthy === true).length,
    rtInfra: verdicts.filter(v => v?.status === 'INFRA').length,
    rtError: verdicts.filter(v => v?.status === 'ERROR').length,
  };
}
