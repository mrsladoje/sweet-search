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
import { writeFileSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Written before any work, so a yielded cell is never empty and never reads as a result. */
export const RUNNING_BANNER =
  '[run_tests] RUNNING — the suite has been launched and has NOT produced a verdict yet.\n'
  + '[run_tests] This text is NOT a result. A completed run always ends with a line beginning\n'
  + '[run_tests] "[run_tests verdict] status=". Until that line appears below, you do not know\n'
  + '[run_tests] whether anything passed or failed — do not report, conclude or finish on this.\n';

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
 */
export function runTestsTelemetry(calls = []) {
  const tests = calls.filter(s => s && s.kind === 'test');
  const withVerdict = tests.map(s => hasVerdict(s.resultText));
  const rtVerdicts = withVerdict.filter(Boolean).length;
  return {
    rtLaunched: tests.length,
    rtVerdicts,
    rtNoVerdict: tests.length - rtVerdicts,
    rtEndedUnverified: tests.length > 0 && !withVerdict[withVerdict.length - 1],
  };
}
