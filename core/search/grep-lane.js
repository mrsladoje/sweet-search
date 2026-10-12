/**
 * The daemon's native ss-grep lane (crates/sweet-search-native/src/lane): a Rust thread that
 * answers `ss-grep` on `<daemon socket>.grep` without running the JS tool, when it prints the
 * same bytes the JS tool would. It declines everything else, and the native client then posts
 * the call to /agent-tool as before.
 *
 * The lane needs only the index files, so it starts as soon as the daemon's socket is bound,
 * before the models load: a grep right after a daemon start does not wait for them.
 *
 * Daemon env: SWEET_SEARCH_GREP_LANE=0 leaves the lane off. SS_LANE_SHADOW_LOG=<file> (tests)
 * re-runs every JS-answered grep through the lane and logs each answer that differs.
 */

import fs from 'node:fs';
import { loadNativeAddon } from '../infrastructure/native-resolver.js';

let lane = null; // { addon, socketPath, projectRoot, stateDir }
let sqliteBridge = null;

function laneAddon() {
  const res = loadNativeAddon({
    validate: (m) => typeof m.buildSparseGramIndex === 'function'
      && typeof m.NativeSparseGramIndex?.load === 'function'
      && typeof m.extractRegexLiterals === 'function',
  });
  const mod = res?.mod;
  return mod && typeof mod.grepLaneStart === 'function' ? { mod, path: res.path } : null;
}

/** The lane reads the code graph through the SQLite library this process already loaded. */
async function registerSqlite(addonPath) {
  if (sqliteBridge) return true;
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    db.loadExtension(addonPath, 'sqlite3_ssext_init');
    sqliteBridge = db;
    return true;
  } catch {
    return false;
  }
}

/** Start the lane; false (and the JS route answers every call) when it cannot run here. */
export async function startGrepLane({ socketPath, projectRoot, stateDir }) {
  if (['0', 'false', 'off', 'no'].includes(String(process.env.SWEET_SEARCH_GREP_LANE ?? '').trim().toLowerCase())) return false;
  // The lane sorts paths by the root collation of English for ASCII (ss-grep-core collate.rs).
  // Other locales may reorder ASCII (Danish "aa", Turkish i, Czech "ch"): the JS answers there.
  if (!/^en(-[A-Za-z]{2,4})*$/.test(new Intl.Collator().resolvedOptions().locale)) return false;
  const found = laneAddon();
  if (!found) return false;
  if (!await registerSqlite(found.path)) return false;
  try {
    found.mod.grepLaneStart({ socketPath, projectRoot, stateDir });
  } catch {
    return false;
  }
  lane = { addon: found.mod, socketPath, projectRoot, stateDir };
  return true;
}

export function stopGrepLane() {
  if (!lane) return;
  try { lane.addon.grepLaneStop(); } catch { /* best effort */ }
  lane = null;
}

/** Answered calls so far (activity for the idle clock and maintainer supervision). */
export function grepLaneHandledCount() {
  if (!lane) return 0;
  try { return lane.addon.grepLaneStats().handled; } catch { return 0; }
}

/** The receipts the lane owes the shown-span ledger, oldest first (removed from its queue). */
export function drainGrepLaneReceipts() {
  if (!lane) return [];
  try { return lane.addon.grepLaneDrainReceipts(); } catch { return []; }
}

/**
 * Shadow check (SS_LANE_SHADOW_LOG): the lane's answer for a call the JS tool answered.
 * Appends one JSON line per call to the log: handled + same, or the reason it declined.
 */
export function shadowGrepCall(payload, jsResult) {
  const log = process.env.SS_LANE_SHADOW_LOG;
  if (!log) return;
  try {
    const found = lane?.addon ? { mod: lane.addon } : laneAddon();
    if (!found) return;
    const projectRoot = lane?.projectRoot ?? process.env.SWEET_SEARCH_PROJECT_ROOT;
    const stateDir = lane?.stateDir ?? `${projectRoot}/.sweet-search`;
    const reply = found.mod.grepLaneCall(JSON.stringify(payload), projectRoot, stateDir);
    const entry = { args: payload.args, cwd: payload.cwd, handled: reply.handled, reason: reply.reason };
    if (reply.handled) {
      entry.same = reply.code === jsResult.code && reply.stdout === jsResult.stdout;
      if (!entry.same) Object.assign(entry, { jsCode: jsResult.code, laneCode: reply.code, js: jsResult.stdout, lane: reply.stdout });
    }
    fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    try { fs.appendFileSync(log, `${JSON.stringify({ args: payload?.args, error: String(err?.message || err) })}\n`); } catch { /* ignore */ }
  }
}
