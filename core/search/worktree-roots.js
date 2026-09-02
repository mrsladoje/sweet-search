/**
 * Root resolution for a session running inside a linked git worktree.
 *
 * THE DEFECT. The ss-* wrappers set one root: `SWEET_SEARCH_PROJECT_ROOT || cwd`. A linked
 * worktree is a second checkout that shares the main repository's `.git`, and it has no
 * `.sweet-search/` of its own, so every ss-* call exited 2 with "no Sweet Search index".
 * Claude Code's desktop app gives each session its own worktree, and `claude --worktree`
 * and worktree-isolated subagents do the same, so this is not a corner case for real users.
 *
 * WHY NOT JUST POINT AT THE MAIN CHECKOUT. Under the bench's pinned root that is exactly
 * what happened, and it was worse than failing: the tools read the PARENT's uncommitted
 * tree while the harness's own `Read` saw the clean worktree. 45 worktree-scoped zeros
 * across 5 of 66 sweet rollouts, and 6 of 22 subagent ss-* results echoed the parent's own
 * edit back as if it were repository state.
 *
 * THE SPLIT. Two roots, because they answer two different questions:
 *
 *   indexRoot  where `.sweet-search/` lives. The index describes the repository, and one
 *              index serves every checkout of it.
 *   fileRoot   where the agent's files are. Every byte an agent reads or edits comes from
 *              its own worktree, so ss-read and ss-semantic resolve paths here.
 *
 * And a rule: when there is no index anywhere, REFUSE with a hint that names the main
 * checkout and the override. A silent redirect is how the parent-tree reads happened.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const INDEX_FILE = path.join('.sweet-search', 'codebase.db');

/** True when `dir` holds a usable Sweet Search index. */
export function hasIndex(dir) {
  return !!dir && existsSync(path.join(dir, INDEX_FILE));
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

/**
 * Worktree facts for `cwd`, or null when it is not inside a git worktree at all.
 * A LINKED worktree is one whose `--git-dir` differs from its `--git-common-dir`; the main
 * checkout is the common directory's parent.
 */
export function describeWorktree(cwd) {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], cwd);
  if (!gitDir) return null;
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
    || git(['rev-parse', '--git-common-dir'], cwd);
  if (!commonDir) return null;
  const absCommon = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
  const linked = path.resolve(gitDir) !== path.resolve(absCommon);
  return {
    linked,
    gitDir: path.resolve(gitDir),
    commonDir: absCommon,
    // For a bare main repository there is no checkout to point at; callers treat a
    // mainCheckout that holds no index as "nowhere to fall back to".
    mainCheckout: path.dirname(absCommon),
    worktree: git(['rev-parse', '--show-toplevel'], cwd) || cwd,
  };
}

/**
 * Resolve the two roots for a session.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} [opts.explicitRoot]  SWEET_SEARCH_PROJECT_ROOT, which always wins — it is
 *   how the bench pins a root, and second-guessing it would change measured behaviour.
 * @returns {{indexRoot: string, fileRoot: string, split: boolean, refusal: string|null,
 *            worktree: object|null}}
 *   `refusal` non-null means no index is reachable and the caller must stop and print it.
 */
export function resolveRoots({ cwd, explicitRoot = '' } = {}) {
  const here = cwd || process.cwd();
  if (explicitRoot) {
    return { indexRoot: explicitRoot, fileRoot: explicitRoot, split: false, refusal: null, worktree: null };
  }

  const wt = describeWorktree(here);
  if (hasIndex(here)) {
    return { indexRoot: here, fileRoot: here, split: false, refusal: null, worktree: wt };
  }

  if (wt?.linked && hasIndex(wt.mainCheckout)) {
    // Split, and SAY so. The caller prints `notice` once; a silent redirect is the failure
    // mode this whole module exists to prevent.
    return {
      indexRoot: wt.mainCheckout,
      fileRoot: here,
      split: true,
      refusal: null,
      worktree: wt,
      notice: `(linked git worktree: index from ${wt.mainCheckout}, file contents from this worktree. `
        + `A result may name a file this worktree has since changed.)`,
    };
  }

  if (wt?.linked) {
    return {
      indexRoot: here, fileRoot: here, split: false, worktree: wt,
      refusal: `[ss-*] no Sweet Search index for this linked git worktree.\n`
        + `  worktree:      ${here}\n`
        + `  main checkout: ${wt.mainCheckout} (no .sweet-search/codebase.db there either)\n`
        + `Index the main checkout, then re-run from here — one index serves every worktree of a repository.\n`
        + `To point at a different checkout explicitly: SWEET_SEARCH_PROJECT_ROOT=<path>`,
    };
  }

  return { indexRoot: here, fileRoot: here, split: false, refusal: null, worktree: wt };
}
