/**
 * Cross-worktree DB stamping.
 *
 * Plan § 8.5 / § 14.2.4. Sweet-search's `.sweet-search/` directory holds
 * the index for one project; when a user has multiple worktrees pointing
 * at the same repo, they either get their own state dir each (the
 * default) or share one. Sharing is allowed only when:
 *
 *   - `project_root` matches the recorded stamp, AND
 *   - `git common-dir` matches the recorded stamp.
 *
 * A mismatched stamp aborts daemon startup with a clear remediation
 * message instead of silently mixing index histories.
 *
 * Stamp file: `.sweet-search/worktree-stamp.json`:
 *
 *   {
 *     "projectRoot": "/Users/x/repo",
 *     "gitCommonDir": "/Users/x/repo/.git",
 *     "stampedAt": "2026-05-16T00:00:00.000Z"
 *   }
 *
 * The stamp is informational and additive — the lockfile (`lockfile.mjs`)
 * is what enforces single-writer semantics; the stamp catches the
 * "two worktrees writing to the same state dir" footgun before it
 * corrupts the index.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const STAMP_FILENAME = 'worktree-stamp.json';

function stampPath(stateDir) {
  return path.join(stateDir, STAMP_FILENAME);
}

/**
 * Resolve `git rev-parse --git-common-dir` for the given project root.
 * Returns `null` when not a git repo or git is unavailable.
 *
 * @param {string} projectRoot
 * @returns {string|null}
 */
export function gitCommonDir(projectRoot) {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    if (r.status !== 0) return null;
    const out = (r.stdout || '').trim();
    if (!out) return null;
    return path.isAbsolute(out) ? out : path.resolve(projectRoot, out);
  } catch {
    return null;
  }
}

/**
 * Read the stamp from disk, returning `null` when missing.
 *
 * @param {string} stateDir
 * @returns {{projectRoot:string, gitCommonDir:string|null, stampedAt:string}|null}
 */
export function readStamp(stateDir) {
  const p = stampPath(stateDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Write a stamp for the current project. Caller invokes on first daemon
 * start after a freshly initialised `.sweet-search/` dir.
 *
 * @param {string} stateDir
 * @param {string} projectRoot
 */
export function writeStamp(stateDir, projectRoot) {
  fs.mkdirSync(stateDir, { recursive: true });
  const stamp = {
    projectRoot: path.resolve(projectRoot),
    gitCommonDir: gitCommonDir(projectRoot),
    stampedAt: new Date().toISOString(),
  };
  fs.writeFileSync(stampPath(stateDir), JSON.stringify(stamp, null, 2));
  return stamp;
}

/**
 * Verify the stamp matches the current project. Returns
 *   { ok: true }                  when the stamp matches (or is absent).
 *   { ok: false, reason, expected, actual }   on mismatch.
 *
 * Caller should:
 *   - on absent stamp → call `writeStamp` to mint one;
 *   - on mismatch → log ERROR with the remediation message and exit.
 *
 * @param {string} stateDir
 * @param {string} projectRoot
 * @returns {{ok:boolean, reason?:string, expected?:object, actual?:object}}
 */
export function verifyStamp(stateDir, projectRoot) {
  const stamp = readStamp(stateDir);
  if (!stamp) return { ok: true, reason: 'absent' };
  const actualProject = path.resolve(projectRoot);
  const actualGit = gitCommonDir(projectRoot);
  if (stamp.projectRoot !== actualProject) {
    return {
      ok: false,
      reason: 'projectRoot-mismatch',
      expected: { projectRoot: stamp.projectRoot, gitCommonDir: stamp.gitCommonDir },
      actual: { projectRoot: actualProject, gitCommonDir: actualGit },
    };
  }
  if (stamp.gitCommonDir && actualGit && stamp.gitCommonDir !== actualGit) {
    return {
      ok: false,
      reason: 'gitCommonDir-mismatch',
      expected: { projectRoot: stamp.projectRoot, gitCommonDir: stamp.gitCommonDir },
      actual: { projectRoot: actualProject, gitCommonDir: actualGit },
    };
  }
  return { ok: true, reason: 'match' };
}

/**
 * Compose the operator-facing error message for a stamp mismatch.
 *
 * @param {{reason:string, expected:object, actual:object}} mismatch
 * @returns {string}
 */
export function formatStampMismatch(mismatch) {
  const linesExpected = [
    `  expected projectRoot:    ${mismatch.expected.projectRoot}`,
    `  expected gitCommonDir:   ${mismatch.expected.gitCommonDir ?? '(none)'}`,
  ];
  const linesActual = [
    `  actual   projectRoot:    ${mismatch.actual.projectRoot}`,
    `  actual   gitCommonDir:   ${mismatch.actual.gitCommonDir ?? '(none)'}`,
  ];
  return [
    `[sweet-search] worktree-stamp mismatch (${mismatch.reason}):`,
    ...linesExpected,
    ...linesActual,
    '',
    'Remediation: either use a per-worktree .sweet-search/ directory (default)',
    'or reset the shared index with `npm run index` from this worktree.',
  ].join('\n');
}
