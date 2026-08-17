// golden-provenance.mjs — make a golden checkout VERIFIABLE after the fact.
//
// WHY THIS EXISTS (HANDOFF-SLATE-A-RESIDUE §3.G.1, corrected by measurement).
//
// The handoff reports that `golden-build.mjs` "does not check that its `git checkout
// <base_commit>` succeeded", so a failed checkout proceeds and the fresh-init captures the
// repository's DEFAULT BRANCH — a post-fix tree under a directory named for the base commit.
// A blinded gate handed that tree reads the answer out of its own working directory.
//
// The failure mode is real and it is worth defending against, but that is NOT the code path.
// `sh()` is `execSync`, which throws on a non-zero exit, and `git checkout <unreachable-sha>`
// exits 128. Verified directly: execSync throws. A failed checkout therefore aborts the build
// today; it does not silently produce a default-branch tree.
//
// What IS true, and is the reason "every golden built before 2026-08-13 is unverified":
//
//   1. NOTHING RECORDS WHAT WAS BUILT. The fresh-init at the end of the build runs
//      `rm -rf .git && git init`, which destroys the only evidence of which commit the tree
//      came from. After it, `git rev-parse HEAD` returns a synthetic SHA that is the same for
//      every task. A finished golden cannot be checked against its base commit by anyone.
//
//   2. THE CACHE-HIT PATH TRUSTS A DIRECTORY NAME. Both builders return early when
//      `<golden>/.sweet-search/codebase.db` and `<golden>/.git` exist. The cache key is
//      `<repo>@<base_commit>`, so ANY directory with the right name is served as that task's
//      base tree, whatever is actually inside it. Combined with the fact that the box's golden
//      cache is not durable and gets rebuilt and restored, that is the live exposure.
//
// So the repair is provenance, not an exit-code check: assert the commit while the evidence
// still exists, then record the assertion somewhere fresh-init cannot reach.
//
// The stamp lives OUTSIDE the golden tree (`<GOLDEN_DIR>/.provenance/<key>.json`). It must
// never be inside it: the golden is copied wholesale into every rollout's working directory,
// so a file placed in the tree would show up as an untracked file in the agent's repository
// and could reach the graded patch.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const git = (gdir, cmd) => execSync(`git -C ${gdir} ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * Assert the working tree really is at `baseCommit`. MUST be called after the checkout and
 * BEFORE the fresh-init, which is the only window in which the answer is knowable.
 * Returns the tree hash, which is what the stamp records — a tree hash survives fresh-init,
 * a commit SHA does not.
 */
export function assertBaseCommit(gdir, baseCommit) {
  let head;
  try { head = git(gdir, 'rev-parse HEAD'); }
  catch (e) { throw new Error(`golden-provenance: cannot read HEAD in ${gdir} — ${String(e.message).slice(0, 120)}`); }
  if (head !== baseCommit) {
    throw new Error(`golden-provenance: HEAD is ${head} but the task's base_commit is ${baseCommit}. `
      + 'The tree is NOT the base tree and must not be used — a gate handed it would read a post-fix repository.');
  }
  return git(gdir, 'rev-parse HEAD^{tree}');
}

const stampPath = (goldenRoot, key) => path.join(goldenRoot, '.provenance', `${key}.json`);

/** The tree of the golden's single fresh-init commit. This is what drift is checked against. */
export function goldenTree(gdir) {
  try { return git(gdir, 'rev-parse HEAD^{tree}'); } catch { return null; }
}

/**
 * Record what was built, once the assertion above has passed. Call AFTER the fresh-init.
 *
 * TWO tree hashes, because they are not the same tree and confusing them makes the drift
 * check fire on every golden. `sourceTreeHash` is the upstream commit's tree — the proof that
 * the right commit was checked out. `goldenTreeHash` is the tree of the fresh-init commit that
 * replaced it, and it can legitimately differ: `git add -A` on the re-initialised repository
 * re-applies `.gitignore` to files the upstream repository tracked in spite of it, and drops
 * submodule gitlinks. Only `goldenTreeHash` is comparable later.
 */
export function writeProvenance(goldenRoot, key, { repo, baseCommit, sourceTreeHash, gdir }) {
  const p = stampPath(goldenRoot, key);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({
    key, repo, baseCommit, sourceTreeHash, goldenTreeHash: goldenTree(gdir),
    verifiedAt: new Date().toISOString(),
    checker: 'golden-provenance@1',
  }, null, 2) + '\n');
  return p;
}

export function readProvenance(goldenRoot, key) {
  try { return JSON.parse(readFileSync(stampPath(goldenRoot, key), 'utf8')); } catch { return null; }
}

/**
 * Classify a golden that is about to be served from cache.
 *   verified  — stamped, and the stamp agrees with the task's base commit.
 *   unstamped — built before this module existed. NOT known to be wrong; NOT known to be right.
 *   mismatch  — stamped for a different commit. The directory name is lying. Never serve it.
 * `treeDrift` additionally catches a golden that was edited after it was stamped.
 */
export function verifyGolden(goldenRoot, key, { baseCommit, gdir } = {}) {
  const st = readProvenance(goldenRoot, key);
  if (!st) return { status: 'unstamped' };
  if (baseCommit && st.baseCommit !== baseCommit) return { status: 'mismatch', stamped: st.baseCommit, expected: baseCommit };
  if (gdir && st.goldenTreeHash) {
    // Catches a golden mutated after it was built — the case the non-durable golden cache and
    // its restores make plausible. Compared against the fresh-init tree, never the upstream one.
    const now = goldenTree(gdir);
    if (now !== st.goldenTreeHash) return { status: 'treeDrift', stamped: st.goldenTreeHash, actual: now };
  }
  return { status: 'verified', stamp: st };
}

/** One line for a build log; keeps the wording identical in both builders. */
export function provenanceNote(v) {
  if (v.status === 'verified') return 'provenance VERIFIED';
  if (v.status === 'unstamped') return 'provenance UNSTAMPED (built before 2026-08-17 — not verifiable, rebuild to stamp it)';
  if (v.status === 'mismatch') return `provenance MISMATCH (stamped ${String(v.stamped).slice(0, 12)}, task wants ${String(v.expected).slice(0, 12)})`;
  return `provenance TREE DRIFT (stamped tree ${String(v.stamped).slice(0, 12)}, actual ${String(v.actual).slice(0, 12)})`;
}

/** True when the cached golden must NOT be served. Unstamped is loud, but not fatal. */
export const provenanceIsFatal = v => v.status === 'mismatch' || v.status === 'treeDrift';

export { stampPath };
