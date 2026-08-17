// Tests for the two correctness items in HANDOFF-SLATE-A-RESIDUE §3.G.
//
//   G.1  golden provenance — a golden checkout must be verifiable AFTER the fresh-init that
//        destroys its history, and a cache hit must stop being decided by the directory name.
//   G.2  D-6 row telemetry — run_tests launches versus verdicts actually delivered.
//
// Uses real git repositories in a temp dir, not mocks, because the thing under test is exactly
// what git does to a tree. No network, no docker, no model.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertBaseCommit, writeProvenance, readProvenance, verifyGolden, goldenTree,
  provenanceIsFatal, provenanceNote,
} from '../harness/golden-provenance.mjs';
import { runTestsTelemetry } from '../harness/rt-inflight.mjs';

let pass = 0, fail = 0;
const assert = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${msg}`); }
  else { fail++; console.log(`  FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const ROOT = mkdtempSync(path.join(tmpdir(), 'golden-prov-test-'));
const GOLDEN_ROOT = path.join(ROOT, 'golden');
mkdirSync(GOLDEN_ROOT, { recursive: true });

// ---- a fake upstream repo with two commits: `base`, then a "fix" on the default branch ----
const upstream = path.join(ROOT, 'upstream');
mkdirSync(upstream);
sh('git init -q -b main .', upstream);
writeFileSync(path.join(upstream, 'a.txt'), 'base content\n');
sh('git add -A', upstream);
sh('git -c user.email=a@b.c -c user.name=t commit -qm base', upstream);
const BASE = sh('git rev-parse HEAD', upstream);
writeFileSync(path.join(upstream, 'a.txt'), 'POST-FIX content — the answer\n');
sh('git add -A', upstream);
sh('git -c user.email=a@b.c -c user.name=t commit -qm fix', upstream);
const HEADC = sh('git rev-parse HEAD', upstream);

/** Exactly what the two builders do: clone, checkout, assert, fresh-init, stamp. */
function buildGolden(key, baseCommit, { skipAssert = false } = {}) {
  const gdir = path.join(GOLDEN_ROOT, key);
  rmSync(gdir, { recursive: true, force: true });
  sh(`git clone --quiet ${upstream} ${gdir}`, ROOT);
  sh(`git checkout --quiet ${baseCommit}`, gdir);
  const srcTree = skipAssert ? null : assertBaseCommit(gdir, baseCommit);
  sh(`rm -rf ${gdir}/.git && git init -q -b main . && printf '.sweet-search/\\n' > .git/info/exclude && git add -A && git -c user.email=a@b.c -c user.name=bench commit -q -m base`, gdir);
  return { gdir, srcTree };
}

console.log('G.1 — assertBaseCommit fires while the evidence still exists');
{
  const { gdir, srcTree } = buildGolden('ok@' + BASE, BASE);
  assert(/^[0-9a-f]{40}$/.test(srcTree), 'returns the upstream tree hash');
  assert(sh('git log --oneline', gdir).split('\n').length === 1, 'fresh-init leaves exactly one commit');
  assert(sh('git rev-parse HEAD', gdir) !== BASE, 'and the synthetic SHA is NOT the base commit — which is why a stamp is needed');
  writeProvenance(GOLDEN_ROOT, 'ok@' + BASE, { repo: 'x/y', baseCommit: BASE, sourceTreeHash: srcTree, gdir });
  const v = verifyGolden(GOLDEN_ROOT, 'ok@' + BASE, { baseCommit: BASE, gdir });
  assert(v.status === 'verified', 'a freshly built golden verifies', provenanceNote(v));
  assert(!provenanceIsFatal(v), 'and is servable');
}

console.log('\nG.1 — a WRONG tree under the right directory name is caught');
{
  // The failure the handoff is worried about: the directory is named for the base commit but
  // holds the post-fix default branch. Build it deliberately, skipping the assertion.
  const key = 'wrong@' + BASE;
  const { gdir } = buildGolden(key, HEADC, { skipAssert: true });
  assert(sh('cat a.txt', gdir).includes('POST-FIX'), 'the trap tree really is the post-fix tree');
  const v = verifyGolden(GOLDEN_ROOT, key, { baseCommit: BASE, gdir });
  assert(v.status === 'unstamped', 'with no stamp it reports UNSTAMPED, not "verified"', v.status);
  assert(!provenanceIsFatal(v), 'unstamped is loud but not fatal — it is unknown, not known-wrong');
  // and the assertion itself would have refused to build it
  const g2 = path.join(ROOT, 'refuse');
  sh(`git clone --quiet ${upstream} ${g2}`, ROOT);
  let threw = null;
  try { assertBaseCommit(g2, BASE); } catch (e) { threw = e; }
  assert(threw !== null, 'assertBaseCommit THROWS when HEAD is the default branch, not the base commit');
  assert(String(threw?.message).includes(BASE), 'and the message names the commit it wanted');
}

console.log('\nG.1 — a stamp for a different commit is FATAL');
{
  const key = 'mismatch@' + BASE;
  const { gdir, srcTree } = buildGolden(key, BASE);
  writeProvenance(GOLDEN_ROOT, key, { repo: 'x/y', baseCommit: HEADC, sourceTreeHash: srcTree, gdir });
  const v = verifyGolden(GOLDEN_ROOT, key, { baseCommit: BASE, gdir });
  assert(v.status === 'mismatch', 'stamped for another commit -> mismatch', v.status);
  assert(provenanceIsFatal(v), 'and it must never be served');
}

console.log('\nG.1 — a golden mutated after it was stamped is caught');
{
  const key = 'drift@' + BASE;
  const { gdir, srcTree } = buildGolden(key, BASE);
  writeProvenance(GOLDEN_ROOT, key, { repo: 'x/y', baseCommit: BASE, sourceTreeHash: srcTree, gdir });
  const before = readProvenance(GOLDEN_ROOT, key).goldenTreeHash;
  writeFileSync(path.join(gdir, 'a.txt'), 'someone edited the golden\n');
  sh('git add -A && git -c user.email=a@b.c -c user.name=bench commit -q -m tamper', gdir);
  assert(goldenTree(gdir) !== before, 'the tree really changed');
  const v = verifyGolden(GOLDEN_ROOT, key, { baseCommit: BASE, gdir });
  assert(v.status === 'treeDrift', 'mutation after stamping -> treeDrift', v.status);
  assert(provenanceIsFatal(v), 'and it must never be served');
}

console.log('\nG.1 — the stamp lives OUTSIDE the golden tree');
{
  const key = 'ok@' + BASE;
  const gdir = path.join(GOLDEN_ROOT, key);
  assert(existsSync(path.join(GOLDEN_ROOT, '.provenance', `${key}.json`)), 'stamp is under <GOLDEN_DIR>/.provenance/');
  // This is load-bearing: the golden is copied wholesale into every rollout's working directory,
  // so a stamp inside the tree would appear to the agent as an untracked file and could reach
  // the graded patch.
  const untracked = sh('git status --porcelain', gdir);
  assert(untracked === '', 'the golden working tree is clean — no stamp file inside it', JSON.stringify(untracked));
}

console.log('\nG.2 — run_tests telemetry counts launches against verdicts delivered');
{
  const VERDICT = 'some output\n[run_tests verdict] status=pass\n';
  const RUNNING = '[run_tests] RUNNING — the suite has been launched and has NOT produced a verdict yet.\n';
  const t0 = runTestsTelemetry([]);
  assert(t0.rtLaunched === 0 && t0.rtEndedUnverified === false, 'a rollout that never ran the tests is not an unverified ending');

  const t1 = runTestsTelemetry([{ kind: 'test', resultText: VERDICT }]);
  assert(t1.rtLaunched === 1 && t1.rtVerdicts === 1 && t1.rtNoVerdict === 0 && !t1.rtEndedUnverified, 'one launch, one verdict');

  const t2 = runTestsTelemetry([{ kind: 'test', resultText: RUNNING }]);
  assert(t2.rtLaunched === 1 && t2.rtVerdicts === 0 && t2.rtEndedUnverified === true, 'a yielded launch with no verdict IS an unverified ending');

  // the original defect's shape: launch, yield, then a later call attaches and resolves it
  const t3 = runTestsTelemetry([{ kind: 'test', resultText: RUNNING }, { kind: 'test', resultText: VERDICT }]);
  assert(t3.rtLaunched === 2 && t3.rtVerdicts === 1 && !t3.rtEndedUnverified, 'a mid-rollout unresolved launch that a later call resolves is NOT an unverified ending');

  const t4 = runTestsTelemetry([{ kind: 'edit', resultText: VERDICT }, { kind: 'bash', resultText: VERDICT }]);
  assert(t4.rtLaunched === 0, 'only run_tests calls are counted, whatever other tools printed');

  // The reason this is fed tool calls and not the trajectory: buildTrajectory truncates results
  // to 600 chars, and the verdict footer is the LAST line a completed run writes.
  const long = 'x'.repeat(5000) + '\n[run_tests verdict] status=pass\n';
  const full = runTestsTelemetry([{ kind: 'test', resultText: long }]);
  const truncated = runTestsTelemetry([{ kind: 'test', resultText: long.slice(0, 600) }]);
  assert(full.rtVerdicts === 1, 'a long passing suite is counted as delivering a verdict');
  assert(truncated.rtVerdicts === 0 && truncated.rtEndedUnverified === true,
    'the SAME run read off a 600-char-truncated trajectory would be miscounted — hence the untruncated input');
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
