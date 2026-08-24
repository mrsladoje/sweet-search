// Task-admission gate — SLATE-B-UBER.md Phase 0 / §7 ("do not carry known invalid
// tasks into the next denominator").
//
// Some tasks cannot measure anything: a zero-character issue no arm can derive the
// task from, or a FAIL_TO_PASS that already passes on the base tree so an EMPTY patch
// grades resolved. Both were found the expensive way — the vacuous ones only surfaced
// when a broken cell submitted empty patches and the grader resolved them anyway.
//
// The decision is a pure function so it can be tested without launching a pilot.
// run-pilot.mjs owns the printing and the process exit.

import { existsSync, readFileSync } from 'node:fs';

/**
 * Load the blocklist map (instance_id -> {reason, _why, since}).
 * A missing file is not an error — it means nothing is blocked.
 */
export function loadBlocklist(blocklistPath) {
  if (!existsSync(blocklistPath)) return {};
  const parsed = JSON.parse(readFileSync(blocklistPath, 'utf8'));
  return parsed.tasks || {};
}

/**
 * Decide what happens to a selection.
 *
 * Naming a blocked task is a different act from sweeping one in with a whole-file
 * selection, and the two get different treatment:
 *   explicit  -> 'refuse'  (you asked for this task by name; stop)
 *   implicit  -> 'drop'    (you asked for the file; shrink the denominator, loudly)
 * `allow` (SS_ALLOW_BLOCKED_TASKS=1) downgrades either to 'warn'.
 *
 * `instances` is never mutated; callers use the returned `admitted`.
 */
export function admissionReport(instances, blocklist, { explicit = false, allow = false } = {}) {
  const blocked = instances.filter(id => blocklist[id]);
  const admitted = instances.filter(id => !blocklist[id]);
  const action = blocked.length === 0 ? 'ok'
    : allow ? 'warn'
      : explicit ? 'refuse' : 'drop';
  return {
    action,
    blocked,
    // Under 'warn' the blocked tasks really do run, so the admitted set must say so.
    // Getting this backwards would silently re-admit exactly what the gate exists to stop.
    admitted: action === 'warn' ? instances.slice() : admitted,
    reasons: blocked.map(id => ({ instance_id: id, ...blocklist[id] })),
  };
}

// ---------------------------------------------------------------------------
// VACUOUS-TASK PRE-SCREEN (VACUITY-PRESCREEN-RESULTS.md, 2026-08-21)
//
// A FAIL_TO_PASS entry is supposed to NAME A TEST THAT FAILS on the base tree. When the
// harvesting run was green, the test runner's own success marker is captured verbatim into
// the task record and ships with the benchmark:
//
//   redboltz__mqtt_cpp-466   "10/25 Test #10: pubsub ......  Passed    0.68 sec"   ctest
//   statamic__cms-9029       "it runs without hooks (3 ms)"                        jest
//
// Such a task grades RESOLVED for a rollout that did nothing, so it cannot detect a
// regression and it inflates both arms equally. These two made the control set 40% vacuous
// and were found only when a broken cell submitted empty patches and the grader passed them.
//
// THIS IS A PRE-FILTER, NOT AN AUTHORITY. THE NULL ARM REMAINS THE AUTHORITY.
// Calibrated on the 17-task rotation against a null arm (AGENT_TIMEOUT_MS=1000, empty
// patch): it recovers both known vacuous tasks with zero false alarms on 16 negatives. That
// is 2 positives — encouraging, not decisive. It also sees only ONE cause of vacuity: a task
// whose FAIL_TO_PASS already passes for some other reason is not flagged, and the data
// cannot bound how often that happens. So a flag here is grounds to REFUSE a task, and the
// absence of a flag is NOT a certificate that a task can fail. Any new control task still
// has to be cleared by a real null arm before it is trusted.
// ---------------------------------------------------------------------------

/** Markers a test runner emits ON SUCCESS. Order fixed so the reported reason is stable. */
export const VACUITY_MARKERS = Object.freeze([
  [/\bPassed\b/, 'ctest "Passed"'],
  [/\bPASS\b/, 'jest/tap "PASS"'],
  [/\bok\s+\d+/, 'TAP "ok N"'],
  [/✓|✔/, 'check mark'],
  // Both bracket styles: jest/mocha print `(3 ms)`, PHPUnit/pest print `[0.54 ms]`. The
  // square form was MISSED at first and cost a real detection — `jsonmapper__jsonmapper-161`
  // has 182 FAIL_TO_PASS entries all shaped `"... [0.54 ms]"`, the pre-screen returned no
  // markers, and a null arm then resolved it with an empty patch. That is the screen's first
  // MEASURED false negative, and it was caught by the authority the screen defers to.
  [/[([]\d+(?:\.\d+)?\s*m?s[)\]]/, 'timing "(N ms)" / "[N ms]"'],
]);

/**
 * The success markers a task's FAIL_TO_PASS list carries, if any.
 *
 * Accepts the raw list as an array or as the JSON string the task files use; an unparseable
 * list yields no markers, because guessing at a format this screen cannot read would turn a
 * parsing problem into a validity claim.
 */
export function vacuityMarkers(spec) {
  const raw = spec && spec.FAIL_TO_PASS;
  let arr = [];
  try { arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const hits = [];
  for (const [re, name] of VACUITY_MARKERS) {
    if (arr.some(e => re.test(String(e))) && !hits.includes(name)) hits.push(name);
  }
  return hits;
}

/**
 * A blocklist-shaped map of the flagged tasks, to be merged with the static blocklist so
 * both refusals travel the same path and print the same way.
 *
 * `since` is the pre-screen's own date rather than today's: the entry records when the
 * SIGNAL was established, and a derived entry that restamped itself on every run would be
 * indistinguishable from a fresh finding.
 */
export function vacuityBlocklist(specs = []) {
  const out = {};
  for (const spec of specs) {
    const id = spec && spec.instance_id;
    if (!id) continue;
    const hits = vacuityMarkers(spec);
    if (!hits.length) continue;
    out[id] = {
      reason: 'vacuous-f2p-prescreen',
      _why: `FAIL_TO_PASS carries the test runner's own success marker (${hits.join(', ')}) — the list was harvested from a run where those tests already passed, so an EMPTY patch grades resolved. Pre-screen only; a null arm is the authority.`,
      since: '2026-08-21',
      prescreen: true,
    };
  }
  return out;
}
