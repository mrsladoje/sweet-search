// Non-pure runtime shared by BOTH generated run_tests shims (direct + broker).
// Runs the canonical suite in the task's docker image against the agent's live diff,
// then layers the L2 levers on top:
//   (a) authority banner   — "trust this PASS/FAIL, don't rebuild it by hand"
//   (b) baseline-diff       — labels pre-existing vs newly-introduced failures
//   (c) targeted single-test— run_tests <pattern> where the runner supports it
//   (d) L3 output dedup     — a repeat invocation with an identical state key AND an
//       identical result gets a compact summary instead of the whole transcript again
//       (rt-dedup.mjs; the suite still RUNS every time). Anti-loop lever for the
//       PLAN.md §4.4 post-fix re-test tail.
// The pure logic (condense/parse/diff/banner) lives in rt-condense-lib.mjs and is
// unit-tested; this module only wires it to docker I/O. Keeping it in ONE place
// (not two interpolated template strings) makes the levers testable and DRY.
//
// IMPORTANT (recursion guard): this runs inside the run_tests shim process, whose
// PATH has the agent's .codex-bin FIRST — so a bare `docker` would resolve to the L1
// docker WRAPPER and double-condense run_tests output. We always use cfg.dockerBin
// (the REAL docker absolute path, resolved host-side at setup) to bypass the wrapper.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  extractFailureSignatures, diffFailureSets, renderBaselineDiff,
  buildAuthorityBanner, applyTestPattern,
  buildUnresolvedIdentifierWarning, buildRunTestsFooter,
} from './rt-condense-lib.mjs';
import {
  RT_DEDUP_ON, parseRunTestsArgv, untrackedFingerprint, computeStateKey,
  summarizeRunTestsResult, readDedupState, dedupDecision, appendDedupRecord,
  buildDedupSummary, buildChangedResultNote, parseExitCode,
} from './rt-dedup.mjs';
import { CodeGraphRepository } from '../../../core/infrastructure/code-graph-repository.js';

// In-container failure-aware condenser (H1, unchanged): network-unavailable banner,
// then up to 40 promoted failure-indicator lines (test NAMES), then the tail. Runs
// against /tmp/__rt_out inside the test container. NOT the L1 condenser — this is the
// established run_tests condenser and must stay byte-stable for historical parity.
export const RT_CONDENSE =
  "grep -qaE 'Could not resolve|Temporary failure in name resolution|Network is unreachable' /tmp/__rt_out && " +
  "echo '[run_tests] NETWORK UNAVAILABLE in the test container (bench lockdown): dependency downloads cannot work; do not retry or debug the harness.'; " +
  "grep -aE '(FAILED|FAIL:|not ok |AssertionError|panicked at|[0-9]+ tests? failed|[Ee]rror:|error\\[)' /tmp/__rt_out | " +
  "grep -avE '(0 fail|failures?: 0|failed: 0|: 0 error)' | head -40; " +
  "echo '--- output tail ---'; tail -45 /tmp/__rt_out";

const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const EXIT_SENTINEL_RE = /\x1e__SS_RT_EXIT=(-?\d+)\x1e$/;

function splitExitSentinel(value) {
  const text = String(value || '');
  const match = text.match(EXIT_SENTINEL_RE);
  if (!match) return { out: text, exitCode: null };
  return { out: text.slice(0, match.index), exitCode: Number(match[1]) };
}

// Run the suite ONCE in the container for a given diff + test command. `diffText` ''
// (empty) yields the clean-baseline result (no agent edits). Returns { out }.
function runSuite(cfg, diffText, testCmd) {
  const tSec = cfg.testTimeoutSec || 300;
  const dockerBin = cfg.dockerBin || 'docker';
  const pdir = cfg.rundir + '__rt';
  try {
    rmSync(pdir, { recursive: true, force: true }); mkdirSync(pdir, { recursive: true });
    writeFileSync(pdir + '/agent.diff', diffText || '');
    const script = 'cd ' + cfg.workdir + ' && git reset --hard HEAD -q 2>/dev/null; ' +
      'git apply --3way --recount --ignore-space-change --whitespace=nowarn /patch/agent.diff 2>/dev/null || true; ' +
      '{ timeout ' + tSec + ' bash -c ' + q(testCmd) + "; printf '%s' \"$?\" > /tmp/__rt_exit; } " +
      '2>&1 | head -c 20000000 > /tmp/__rt_out; ' + RT_CONDENSE + '; ' +
      "printf '\\036__SS_RT_EXIT=%s\\036' \"$(cat /tmp/__rt_exit 2>/dev/null || printf 1)\"";
    const marked = execSync(dockerBin + ' run --rm ' + (cfg.netArgs || '') + '-v ' + pdir + ':/patch:ro ' + cfg.image + ' bash -c ' + q(script),
      { env: { ...process.env, DOCKER_HOST: cfg.dockerHost }, encoding: 'utf8', timeout: (tSec + 60) * 1000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const captured = splitExitSentinel(marked);
    return { out: captured.out.slice(0, 8000), exitCode: captured.exitCode };
  } catch (e) {
    const captured = splitExitSentinel(e.stdout);
    if (captured.exitCode !== null) return { out: captured.out.slice(0, 8000), exitCode: captured.exitCode };
    const exitCode = Number.isInteger(e.status) ? e.status : 1;
    return {
      out: '[run_tests exit=' + exitCode + ']\n' + String(e.stdout || e.stderr || e.message || '').slice(0, 6000),
      exitCode, infra: true,
    };
  } finally { try { rmSync(pdir, { recursive: true, force: true }); } catch { /* */ } }
}

// Clean-baseline failure set, computed ONCE and retained only in the long-lived host
// broker process. The task agent never receives a baseline path or serialized cache
// to forge. WeakMap identity also keeps concurrent attempts isolated.
const baselineByConfig = new WeakMap();
export function getBaseline(cfg, { runCleanSuite = runSuite } = {}) {
  const cached = baselineByConfig.get(cfg);
  if (cached) return { ok: cached.ok, sigs: new Set(cached.sigs) };
  const base = runCleanSuite(cfg, '', cfg.testScript);      // FULL suite, no agent diff
  const sig = extractFailureSignatures(base.out);
  const exitCode = Number.isInteger(base?.exitCode) ? base.exitCode : parseExitCode(base?.out);
  // An infra/timeout baseline or a non-zero result with no classifiable failure is
  // untrustworthy → ok:false (no baseline labeling).
  const infra = base?.infra === true || sig.infra || exitCode === 124 || exitCode === 137;
  const ok = sig.ok && !infra && !(exitCode !== 0 && sig.sigs.size === 0);
  const value = { ok, sigs: new Set(sig.sigs) };
  baselineByConfig.set(cfg, value);
  return { ok: value.ok, sigs: new Set(value.sigs) };
}

const symbolRepos = new Map();
function resolveNamesFromTaskIndex(cfg, names, { files = [] } = {}) {
  const dbPath = path.join(cfg.rundir, '.sweet-search', 'code-graph.db');
  if (!existsSync(dbPath)) return null;
  let repo = symbolRepos.get(dbPath);
  if (!repo) {
    repo = new CodeGraphRepository(dbPath);
    symbolRepos.set(dbPath, repo);
  }
  const rows = repo.findEntitiesByAnyName(names, {
    // Keep const/variable: those are exactly the definition kinds needed for
    // style.BrightWhite and TestResultPath. Only non-symbol structural rows go.
    excludeKinds: ['chunk', 'message', 'topKey', 'target'],
    limit: 64,
  });
  // Qualified members are actionable only when their qualifier is repo-local.
  // Recover local import/package aliases from resolved file-level import edges so
  // external APIs such as fmt.Sprintf do not create noise.
  for (const file of files) {
    const fileEntity = repo.findEntitiesInRange(file, 1, 1).find(row => row.type === 'file');
    if (!fileEntity) continue;
    for (const rel of repo.getOutgoingRelationships(fileEntity.id, {
      types: ['imports', 'plainImport'], limit: 50,
    })) {
      if (!rel.target) continue;
      const raw = String(rel.targetName || rel.fullImportPath || rel.target.name || '');
      const leaf = raw.split(/[/.\\]/).filter(Boolean).at(-1);
      if (leaf && names.includes(leaf)) rows.push({ name: leaf, type: 'import' });
    }
  }
  return rows;
}

export function resolveDiffIdentifierWarning(cfg, diff, { resolveNames } = {}) {
  if (cfg?._isAgentFormat !== true || cfg?.rtUnresolvedIdentifierWarning !== true || !diff) return '';
  try {
    const resolver = resolveNames || ((names, context) => resolveNamesFromTaskIndex(cfg, names, context));
    return buildUnresolvedIdentifierWarning(diff, resolver, { enabled: true });
  } catch {
    return ''; // absent/stale/unavailable index degrades silently, never invents a warning
  }
}

function appendFooter(body, footer) {
  const text = String(body || '');
  if (!text) return footer;
  return text + (text.endsWith('\n') ? '' : '\n') + footer;
}

function classifySuiteResult(cur, current, baselineDiff) {
  const suppliedExit = Number.isInteger(cur?.exitCode) ? cur.exitCode : null;
  let exitCode = suppliedExit ?? parseExitCode(cur?.out);
  if (suppliedExit === null && exitCode === 0 && current.sigs.size > 0) exitCode = 1;
  const infra = cur?.infra === true || current.infra || exitCode === 124 || exitCode === 137;
  const status = infra ? 'INFRA' : (exitCode !== 0 || current.sigs.size > 0 ? 'FAIL' : 'PASS');
  const baselineOnly = status === 'FAIL' && baselineDiff !== null && current.sigs.size > 0 &&
    baselineDiff.introduced.length === 0 && baselineDiff.preExisting.length === current.sigs.size;
  const verdict = status === 'INFRA' ? 'INFRA' : (status === 'PASS' || baselineOnly ? 'PASS' : 'FAIL');
  return { exitCode, status, verdict, trustworthy: baselineDiff !== null && !infra };
}

// Main entry: run the suite on the agent's current diff, prepend the L2 levers, then
// apply the L3 dedup decision. `argv` is the agent's raw run_tests argv (preferred);
// `pattern` is the legacy single-argument form and stays supported for callers/tests.
export function runTestsWithLevers(cfg, { pattern = '', argv = null, reqId = null, runSuiteFn = runSuite } = {}) {
  const L2 = cfg.rtAuthority !== false;
  const parsed = parseRunTestsArgv(argv != null ? argv : (pattern ? [pattern] : []));
  let diff = '';
  try { diff = execSync('git -C ' + cfg.rundir + " diff HEAD -- . ':(exclude).sweet-search'", { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch { /* */ }

  // (c) targeted single-test mode — degrade to full suite when unsupported.
  let testCmd = cfg.testScript, note = '', scope = 'full';
  if (parsed.pattern) {
    const ap = applyTestPattern(cfg.testScript, parsed.pattern);
    testCmd = ap.cmd;
    if (ap.applied) scope = 'targeted';
    if (!ap.applied) note = `[run_tests] targeted pattern '${parsed.pattern}' ignored (${ap.reason}) — ran the full suite.`;
  }

  // (d) L3 state key — computed BEFORE the suite runs, over the exact tree the suite
  // will see. A null key (unhashable untracked set) means "no dedup for this call".
  const dedupActive = RT_DEDUP_ON && cfg.rtDedup !== false && !!cfg.dedupLog && !parsed.full;
  let untracked = null, key = null;
  if (dedupActive) {
    untracked = untrackedFingerprint(cfg.rundir);
    key = computeStateKey({ diff, untracked, argv: parsed.argv });
  }

  const cur = runSuiteFn(cfg, diff, testCmd);
  const identifierWarning = resolveDiffIdentifierWarning(cfg, diff);

  // (a) authority banner + (b) baseline-diff. Experimental diagnostics can never
  // suppress authority and always render above the final machine footer.
  let head = L2 ? buildAuthorityBanner() : '';
  const curSig = extractFailureSignatures(cur.out);
  const bdiff = L2
    ? diffFailureSets(getBaseline(cfg, { runCleanSuite: runSuiteFn }), curSig)
    : null;   // null when disabled/untrustworthy → no labeling
  const bd = L2 ? renderBaselineDiff(bdiff) : '';
  if (bd) head += (head ? '\n' : '') + bd;
  if (note) head += (head ? '\n' : '') + note;
  const classified = classifySuiteResult(cur, curSig, bdiff);
  const footer = buildRunTestsFooter({
    status: classified.status, verdict: classified.verdict, scope,
    exitCode: classified.exitCode, baselineDiff: bdiff,
    trustworthy: classified.trustworthy, guidance: 'none',
  });
  const full = [head, cur.out, identifierWarning].filter(Boolean).join('\n');
  return applyDedup(cfg, {
    key, untracked, parsed, diff, reqId, out: full, raw: cur.out,
    rawExitCode: classified.exitCode, footer,
  });
}

/**
 * L3: record this invocation and decide what the agent sees.
 *   key === null            → dedup not allowed for this call → `out` verbatim.
 *   first / changed key     → `out` verbatim (byte-identical to the pre-lever shim).
 *   same key, same result   → compact summary INSTEAD of the transcript.
 *   same key, other result  → `out` verbatim + a one-line flakiness note.
 * An infra-error result (network/broker/docker) is never condensed. A failed state-log
 * append disables condensation for that call — the log IS the state, so an unwritable
 * log must not silently make every call look like a repeat.
 */
function applyDedup(cfg, { key, untracked, parsed, diff, reqId, out, raw, rawExitCode, footer }) {
  if (!key) {
    // Still leave an audit trail when the lever was live but abstained, so a smoke can
    // tell "never fired because the agent never repeated" from "could not fingerprint".
    if (RT_DEDUP_ON && cfg.rtDedup !== false && cfg.dedupLog) {
      const state = readDedupState(cfg.dedupLog);
      appendDedupRecord(cfg.dedupLog, {
        call: state.calls + 1, key: null, decision: parsed.full ? 'ss-full' : 'no-key',
        reason: parsed.full ? 'escape hatch --ss-full' : (untracked && untracked.reason) || 'dedup disabled',
        argv: parsed.argv, diffBytes: Buffer.byteLength(String(diff ?? ''), 'utf8'),
      });
    }
    return appendFooter(out, footer);
  }
  const state = readDedupState(cfg.dedupLog);
  const result = summarizeRunTestsResult(raw, { exitCode: rawExitCode });
  const decision = dedupDecision(state, key, result.digest);
  const suppress = decision.mode === 'unchanged' && !result.infra;
  const wrote = appendDedupRecord(cfg.dedupLog, {
    call: state.calls + 1, key, digest: result.digest, reqId,
    decision: result.infra && decision.mode !== 'first' ? 'infra-passthrough' : decision.mode,
    citeCall: decision.citeCall, suppressed: suppress,
    argv: parsed.argv,
    diffSha: sha256Hex(String(diff ?? '')), diffBytes: Buffer.byteLength(String(diff ?? ''), 'utf8'),
    untracked: untracked.entries,
    exit: result.exitCode, failures: result.failureCount, infra: result.infra,
    firstFailure: result.firstFailure,
    outBytes: Buffer.byteLength(appendFooter(out, footer), 'utf8'),
  });
  if (!wrote) return appendFooter(out, footer);
  if (suppress) return appendFooter(buildDedupSummary({ citeCall: decision.citeCall, result }), footer);
  if (decision.mode === 'changed' && !result.infra) {
    return appendFooter(buildChangedResultNote(decision.citeCall) + '\n' + out, footer);
  }
  return appendFooter(out, footer);
}

function sha256Hex(s) { return createHash('sha256').update(s).digest('hex'); }
