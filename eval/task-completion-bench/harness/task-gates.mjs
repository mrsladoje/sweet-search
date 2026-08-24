// Defense-in-depth read side of the SELECTION-TIME task-rejection gate.
//
// The gate itself lives in select/task_gates.py and runs before the seeded draw,
// so a set built after 2026-07-30 cannot contain a violating task. This module is
// the belt-and-braces check for sets that PREDATE the gate: run-pilot WARNS (never
// refuses) when a loaded set carries one, so a run on an old set is still possible
// but is never silently mistaken for a gated one.
//
// Thresholds are NOT duplicated here — they are read from select/task-gates.json,
// the same file the Python gate reads. If that file cannot be read the check
// degrades to a one-line warning and is skipped; a preflight warning must never
// be able to abort a run.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GATE_CONFIG_PATH = path.resolve(HERE, '../select/task-gates.json');

export const REASON_F2P_TOO_MANY = 'fail_to_pass_ge_max';
export const REASON_P2P_EMPTY = 'pass_to_pass_below_min';
export const REASON_NAME_LOCKED = 'name_locked';

/** @returns {{maxFailToPass:number,minPassToPass:number,rejectNameLocked:boolean}|null} */
export function loadGateConfig(configPath = GATE_CONFIG_PATH) {
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    const maxFailToPass = Number(cfg.max_fail_to_pass);
    const minPassToPass = Number(cfg.min_pass_to_pass);
    if (!Number.isFinite(maxFailToPass) || !Number.isFinite(minPassToPass)) return null;
    return { maxFailToPass, minPassToPass, rejectNameLocked: cfg.reject_name_locked === true };
  } catch { return null; }
}

/** Counts from a materialized spec (lists) or a slimmed selection record (n_* fields). */
export function taskCounts(spec) {
  if (spec && (spec.n_fail_to_pass !== undefined || spec.n_pass_to_pass !== undefined)) {
    return { f2p: Number(spec.n_fail_to_pass) || 0, p2p: Number(spec.n_pass_to_pass) || 0 };
  }
  return {
    f2p: (spec?.FAIL_TO_PASS || []).length,
    p2p: (spec?.PASS_TO_PASS || []).length,
  };
}

/** [] means the task passes the gate. */
export function gateViolations(spec, config = loadGateConfig()) {
  if (!config) return [];
  const { f2p, p2p } = taskCounts(spec);
  const out = [];
  if (f2p >= config.maxFailToPass) {
    out.push({ code: REASON_F2P_TOO_MANY, f2p, p2p, threshold: config.maxFailToPass,
      detail: `FAIL_TO_PASS=${f2p} >= ${config.maxFailToPass} (whole suite red at baseline)` });
  }
  if (p2p < config.minPassToPass) {
    out.push({ code: REASON_P2P_EMPTY, f2p, p2p, threshold: config.minPassToPass,
      detail: `PASS_TO_PASS=${p2p} < ${config.minPassToPass} (nothing passes at baseline)` });
  }
  // Reads the STAMPED boolean, never a base tree — deciding "invented" needs a materialized
  // checkout and gold, which belong at recruitment (select/stamp-name-lock.mjs), not here.
  // An UNSTAMPED record is not-yet-measured, never clean, so `undefined` is not a violation.
  if (config.rejectNameLocked && spec?.name_locked === true) {
    const idents = (spec.name_locked_identifiers || []).join(', ') || '(stamped, identifiers not recorded)';
    out.push({ code: REASON_NAME_LOCKED, f2p, p2p,
      detail: `name-locked on ${idents} (the hidden test needs an identifier the reference patch invented, the base tree never mentions and the issue does not spell out — measures a naming lottery, not retrieval)` });
  }
  return out;
}

/** Per-set audit: [{instance_id, violations:[...]}] for every violating spec. */
export function auditTaskSet(specs, config = loadGateConfig()) {
  const out = [];
  for (const spec of specs || []) {
    const violations = gateViolations(spec, config);
    if (violations.length) out.push({ instance_id: spec.instance_id, violations });
  }
  return out;
}

/**
 * Emit the preflight WARNING for a loaded set. Never throws, never exits — old
 * sets predate the gate and must stay runnable.
 * @returns the audit rows (empty when the set is clean or the config is unreadable)
 */
export function warnOnGateViolations(specs, { log = console.error, config = loadGateConfig() } = {}) {
  if (!config) {
    log(`[task-gate] WARNING: cannot read ${GATE_CONFIG_PATH} — selection-gate preflight SKIPPED`);
    return [];
  }
  const rows = auditTaskSet(specs, config);
  if (!rows.length) return rows;
  log(`[task-gate] WARNING: ${rows.length}/${(specs || []).length} loaded task(s) would be REJECTED by the `
    + `selection gate (FAIL_TO_PASS<${config.maxFailToPass}, PASS_TO_PASS>=${config.minPassToPass}`
    + `${config.rejectNameLocked ? ', not name-locked' : ''}). `
    + `This set predates the gate; the run continues, but these tasks measure build repair or a naming lottery, not bug fixing.`);
  for (const row of rows) {
    log(`[task-gate]   ${row.instance_id}: ${row.violations.map(v => v.detail).join('; ')}`);
  }
  return rows;
}

/**
 * The NAME-LOCK census over a loaded set, as a reported statistic.
 *
 * Separate from `gateViolations` on purpose: a locked task is a rejection, but the count of
 * UNSTAMPED tasks is the number this set cannot answer the question for, and conflating the
 * two would let "we never measured it" read as "it is clean". Both are printed.
 */
export function nameLockCensusOf(specs = []) {
  const stamped = specs.filter(s => s && s.name_locked !== undefined);
  const locked = stamped.filter(s => s.name_locked === true);
  return {
    total: specs.length,
    stamped: stamped.length,
    unstamped: specs.length - stamped.length,
    locked: locked.length,
    lockedIds: locked.map(s => s.instance_id),
  };
}

/** One line of census, for a run's header. Never throws, never aborts. */
export function reportNameLockCensus(specs, { log = console.log } = {}) {
  const c = nameLockCensusOf(specs);
  if (!c.total) return c;
  if (!c.stamped) {
    log(`[name-lock] ${c.total} task(s) UNSTAMPED — this set predates the census; run select/stamp-name-lock.mjs to measure it. Unstamped is not-yet-measured, never clean.`);
    return c;
  }
  const pct = ((100 * c.locked) / c.stamped).toFixed(1);
  log(`[name-lock] ${c.locked}/${c.stamped} stamped task(s) are naming lotteries (${pct}%)`
    + `${c.unstamped ? `, ${c.unstamped} unstamped` : ''}`
    + `${c.locked ? `: ${c.lockedIds.join(', ')}` : ''}`);
  return c;
}
