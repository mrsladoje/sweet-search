// The GENERATED run_tests shim text, as pure functions of their parameters.
//
// WHY THIS IS ITS OWN MODULE. Two callers need the exact same bytes and they must not
// import each other:
//   * codex-task-runner.mjs writes them to the rollout's bin dir;
//   * env-ledger.mjs HASHES them into the harness fingerprint, so a shim change stales every
//     gold verdict instead of comparing as ledger-identical.
// codex-task-runner.mjs already imports env-ledger.mjs, so the fingerprint cannot reach back
// into it without a cycle. Hence this file, which imports nothing but rt-inflight.mjs.
//
// THE GAP THIS CLOSES (2026-08-24). D2 changed the shim so that, under the production
// isolation policy, every run_tests call on every harness died with ERR_MODULE_NOT_FOUND and
// no agent ever received a verdict. `RT_HARNESS_FINGERPRINT` covered rt-condense-lib,
// rt-shim-runtime, rt-dedup and rt-progress-controller — not rt-inflight.mjs, and not the
// TEMPLATE that assembles the shim. So the two sides of a change that can silently zero every
// test verdict compared as ledger-identical. Hashing the generated TEXT covers the inlined
// protocol, the template, and any future inlining, without false-staling a ledger every time
// an unrelated line of the 58 KB codex adapter is edited.
import { inflightInlineSource, sameDiffAttachInlineSource } from './rt-inflight.mjs';

/**
 * BROKER REQUESTER — the variant that runs under isolation, INSIDE the jail.
 *
 * It must import `node:` builtins and nothing else: the jail masks the whole of <repo>/eval,
 * so an absolute-path import of any harness module is ENOENT here. The in-flight protocol is
 * therefore inlined. Its `node:fs` import already covers writeFileSync / readFileSync /
 * rmSync / existsSync, so this text must not declare its own — a duplicate binding is a
 * SyntaxError, and the shim would die before writing a byte.
 */
export function brokerRequesterSource({ reqDir, testTimeoutSec, sameDiff = null, bannerDelayMs = null, harness = null }) {
  // RT_ATTACH_REQUIRE_SAME_DIFF=1 (`sameDiff` = { rundir }): attach only to a launch made on
  // the same working tree, else queue a fresh request behind it. The broker serves requests
  // one at a time, so the stale suite finishes first and no second suite runs beside it.
  // Switch off, the text below is byte-identical to the pre-switch requester.
  const attach = sameDiff
    ? `const treeKey = workingTreeKey(${JSON.stringify(sameDiff.rundir)});
const live = findInflightForKey(IPC, waitSec * 1000, treeKey);
const attachId = live.match;
const id = attachId || newRunId();
if (attachId) process.stdout.write(ATTACH_NOTE);
else {
  if (live.other) process.stdout.write(STALE_INFLIGHT_NOTE);
  markInflightKeyed(IPC, id, process.argv.slice(2), treeKey);
  writeFileSync(IPC + '/req-' + id, JSON.stringify(process.argv.slice(2)));
}
`
    : `const attachId = findInflight(IPC, waitSec * 1000);
const id = attachId || newRunId();
if (attachId) process.stdout.write(ATTACH_NOTE);
else {
  markInflight(IPC, id, process.argv.slice(2));
  writeFileSync(IPC + '/req-' + id, JSON.stringify(process.argv.slice(2)));
}
`;
  return `${inflightInlineSource()}${sameDiff ? sameDiffAttachInlineSource() : ''}
const IPC = ${JSON.stringify(reqDir)};
const tSec = ${Number(testTimeoutSec) || 300};
const waitSec = 2 * tSec + 120;                          // baseline + current suite + overhead
const stopBanner = startRunningBanner(${bannerDelayArg(bannerDelayMs)}${bannerHarnessArg(harness, false)});
${attach}const deadline = Date.now() + waitSec * 1000;
const res = IPC + '/res-' + id;
while (Date.now() < deadline) {
  if (!attachId && existsSync(res)) {
    const text = readFileSync(res, 'utf8');
    try { rmSync(res, { force: true }); } catch {}
    clearInflight(IPC, id);                              // the broker already published it
    await stopBanner();
    process.stdout.write(text);
    process.exit(0);
  }
  if (attachId) {
    const text = readVerdict(IPC, id);
    if (text != null) { await stopBanner(); process.stdout.write(text); process.exit(0); }
  }
  await new Promise(r => setTimeout(r, 400));
}
if (!attachId) clearInflight(IPC, id);
await stopBanner();
process.stdout.write(NO_VERDICT_NOTE(waitSec));
`;
}

/**
 * DIRECT shim — reached only with isolation OFF, so it runs outside any jail and may import
 * the runtime by absolute path. That module is large and has its own dependency tree; there
 * is nothing to gain from inlining it.
 */
export function directShimSource({ cfgPath, runtimePath, ipcDir, testTimeoutSec, sameDiff = null, bannerDelayMs = null, harness = null }) {
  // RT_ATTACH_REQUIRE_SAME_DIFF=1: as in the requester, plus the serialisation the broker
  // gives for free — a fresh run waits (at most one suite budget) for the stale one to land,
  // so a rollout never has two suites running at once. Off, byte-identical to before.
  const tSecDirect = Number(testTimeoutSec) || 300;
  const findLine = sameDiff
    ? `const treeKey = workingTreeKey(${JSON.stringify(sameDiff.rundir)});
const live = findInflightForKey(IPC, waitSec * 1000, treeKey);
const attachId = live.match;
`
    : `const attachId = findInflight(IPC, waitSec * 1000);
`;
  const launch = sameDiff
    ? `const id = newRunId();
markInflightKeyed(IPC, id, process.argv.slice(2), treeKey);
if (live.other) {
  process.stdout.write(STALE_INFLIGHT_NOTE);
  const until = Date.now() + ${tSecDirect} * 1000;
  while (Date.now() < until && inflightPending(IPC, live.other)) await new Promise(r => setTimeout(r, 400));
}
`
    : `const id = newRunId();
markInflight(IPC, id, process.argv.slice(2));
`;
  return `${inflightInlineSource()}${sameDiff ? sameDiffAttachInlineSource() : ''}
import { runTestsWithLevers } from ${JSON.stringify(runtimePath)};
const c = JSON.parse(readFileSync(${JSON.stringify(cfgPath)}, 'utf8'));
const IPC = ${JSON.stringify(ipcDir)};
const waitSec = 2 * (${tSecDirect}) + 120;
const stopBanner = startRunningBanner(${bannerDelayArg(bannerDelayMs)}${bannerHarnessArg(harness, true)});
${findLine}if (attachId) {
  process.stdout.write(ATTACH_NOTE);
  const deadline = Date.now() + waitSec * 1000;
  while (Date.now() < deadline) {
    const text = readVerdict(IPC, attachId);
    if (text != null) { await stopBanner(); process.stdout.write(text); process.exit(0); }
    await new Promise(r => setTimeout(r, 400));
  }
  await stopBanner();
  process.stdout.write(NO_VERDICT_NOTE(waitSec));
  process.exit(0);
}
${launch}let out;
try { out = runTestsWithLevers(c, { argv: process.argv.slice(2) }); }
catch (e) { out = '[run_tests error] ' + String(e && e.message || e); }
publishVerdict(IPC, id, out);
clearInflight(IPC, id);
await stopBanner();
process.stdout.write(out);
`;
}

// The banner delay as shim source text: the named constant by default (so the canonical
// fingerprint text tracks RUNNING_BANNER_DELAY_MS), a literal only when a caller overrides it.
function bannerDelayArg(ms) {
  return Number.isFinite(ms) && ms >= 0 ? String(Math.floor(ms)) : 'RUNNING_BANNER_DELAY_MS';
}

// The banner options as shim source text. `harness` is set by the runner that generates the
// shim ('codex' adds the write_stdin step, see RUNNING_BANNER_CODEX_STEP); null leaves the
// call text exactly as it was before the option existed.
function bannerHarnessArg(harness, blocking) {
  const opts = [blocking ? 'blocking: true' : null, harness ? `harness: ${JSON.stringify(String(harness))}` : null].filter(Boolean);
  return opts.length ? `, { ${opts.join(', ')} }` : '';
}

// Canonical arguments for the fingerprint. Fixed placeholders, so the hash tracks the CODE
// that generates the shim and never a per-rollout temp path — otherwise every rollout would
// produce a different fingerprint and the ledger would be permanently stale.
const CANON = Object.freeze({
  reqDir: '/CANON/_rt_ipc',
  cfgPath: '/CANON/_run_tests_cfg.json',
  runtimePath: '/CANON/rt-shim-runtime.mjs',
  ipcDir: '/CANON/_rt_inflight',
  testTimeoutSec: 300,
});

// The same, with RT_ATTACH_REQUIRE_SAME_DIFF=1. Hashed too, so a change to the switch-on
// text stales the ledger even though a default run never generates it.
const CANON_SAME_DIFF = Object.freeze({ ...CANON, sameDiff: Object.freeze({ rundir: '/CANON/rundir' }) });

// The Codex runner's shim (harness: 'codex' — the banner carries the write_stdin step). Hashed
// so that option's text is covered too.
const CANON_CODEX = Object.freeze({ ...CANON, harness: 'codex' });

/** Both shim variants under canonical parameters — the bytes the fingerprint hashes. */
export function shimFingerprintSource() {
  return brokerRequesterSource(CANON) + '\n---\n' + directShimSource(CANON)
    + '\n---\n' + brokerRequesterSource(CANON_SAME_DIFF) + '\n---\n' + directShimSource(CANON_SAME_DIFF)
    + '\n---\n' + brokerRequesterSource(CANON_CODEX) + '\n---\n' + directShimSource(CANON_CODEX);
}
