// Non-pure runtime shared by BOTH generated run_tests shims (direct + broker).
// Runs the canonical suite in the task's docker image against the agent's live diff,
// then layers the L2 levers on top:
//   (a) authority banner   — "trust this PASS/FAIL, don't rebuild it by hand"
//   (b) baseline-diff       — labels pre-existing vs newly-introduced failures
//   (c) targeted single-test— run_tests <pattern> where the runner supports it
// The pure logic (condense/parse/diff/banner) lives in rt-condense-lib.mjs and is
// unit-tested; this module only wires it to docker I/O. Keeping it in ONE place
// (not two interpolated template strings) makes the levers testable and DRY.
//
// IMPORTANT (recursion guard): this runs inside the run_tests shim process, whose
// PATH has the agent's .codex-bin FIRST — so a bare `docker` would resolve to the L1
// docker WRAPPER and double-condense run_tests output. We always use cfg.dockerBin
// (the REAL docker absolute path, resolved host-side at setup) to bypass the wrapper.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractFailureSignatures, diffFailureSets, renderBaselineDiff,
  buildAuthorityBanner, applyTestPattern,
} from './rt-condense-lib.mjs';

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
      'timeout ' + tSec + ' bash -c ' + q(testCmd) + ' 2>&1 | head -c 20000000 > /tmp/__rt_out; ' + RT_CONDENSE;
    const out = execSync(dockerBin + ' run --rm ' + (cfg.netArgs || '') + '-v ' + pdir + ':/patch:ro ' + cfg.image + ' bash -c ' + q(script),
      { env: { ...process.env, DOCKER_HOST: cfg.dockerHost }, encoding: 'utf8', timeout: (tSec + 60) * 1000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { out: out.slice(0, 8000) };
  } catch (e) {
    return { out: '[run_tests exit=' + (e.status ?? 1) + ']\n' + String(e.stdout || e.stderr || e.message || '').slice(0, 6000) };
  } finally { try { rmSync(pdir, { recursive: true, force: true }); } catch { /* */ } }
}

// Clean-baseline failure set, computed ONCE and cached to disk (lazy on the first
// run_tests call; the clean suite is time-invariant so call order is irrelevant).
// On an infra-errored baseline we cache {ok:false} so we degrade to NO labeling and
// don't re-run the doomed suite every call.
export function getBaseline(cfg) {
  const cachePath = path.join(cfg.binDir, '_rt_baseline.json');
  if (existsSync(cachePath)) {
    try { const j = JSON.parse(readFileSync(cachePath, 'utf8')); return { ok: j.ok, sigs: new Set(j.sigs || []) }; }
    catch { /* rewrite below */ }
  }
  const base = runSuite(cfg, '', cfg.testScript);          // FULL suite, no agent diff
  const sig = extractFailureSignatures(base.out);
  // A baseline that is itself an infra error is untrustworthy → ok:false (no labeling).
  const ok = sig.ok && !sig.infra;
  try { writeFileSync(cachePath, JSON.stringify({ ok, sigs: [...sig.sigs] })); } catch { /* */ }
  return { ok, sigs: sig.sigs };
}

// Main entry: run the suite on the agent's current diff, prepend the L2 levers.
export function runTestsWithLevers(cfg, { pattern = '' } = {}) {
  const L2 = cfg.rtAuthority !== false;
  let diff = '';
  try { diff = execSync('git -C ' + cfg.rundir + " diff HEAD -- . ':(exclude).sweet-search'", { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); } catch { /* */ }

  // (c) targeted single-test mode — degrade to full suite when unsupported.
  let testCmd = cfg.testScript, note = '';
  if (pattern) {
    const ap = applyTestPattern(cfg.testScript, pattern);
    testCmd = ap.cmd;
    if (!ap.applied) note = `[run_tests] targeted pattern '${pattern}' ignored (${ap.reason}) — ran the full suite.`;
  }

  const cur = runSuite(cfg, diff, testCmd);
  if (!L2) return (note ? note + '\n' : '') + cur.out;

  // (a) authority banner + (b) baseline-diff
  let head = buildAuthorityBanner();
  const curSig = extractFailureSignatures(cur.out);
  const bdiff = diffFailureSets(getBaseline(cfg), curSig);   // null when untrustworthy → no labeling
  const bd = renderBaselineDiff(bdiff);
  if (bd) head += '\n' + bd;
  if (note) head += '\n' + note;
  return head + '\n' + cur.out;
}
