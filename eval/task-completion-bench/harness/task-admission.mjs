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
