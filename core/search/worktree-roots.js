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
 *
 * FROM A SUBDIRECTORY. The roots are found by walking up from the cwd, like git finds its
 * repository: the first directory that holds an index, or that is the top of a linked
 * worktree, decides. Both roots are checkout roots, never the cwd itself, so output paths
 * stay root-relative (core/search/cwd-paths.js reads cwd-relative arguments). The native
 * client picks the daemon with the same walk (crates/sweet-search-cli/src/agent_tools.rs
 * `index_root`); a disagreement costs a 409 and the slow in-process run, never a wrong
 * answer.
 *
 * NO GIT PROCESS. The worktree facts come from the files git itself reads (`.git` →
 * `gitdir:` → `commondir`), spelled as git prints them (real paths). A `git` start costs
 * ~30 ms, and this runs on the daemon's event loop for every call. git is still asked
 * when the files are unusual: a GIT_* variable that moves the repository, a `.git` that
 * does not parse, or a repository owned by another user (git would refuse it).
 */

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const INDEX_FILE = path.join('.sweet-search', 'codebase.db');

// Variables that make git look somewhere other than the cwd's ancestors. With any of
// them set, only git itself knows the answer.
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];

/** True when `dir` holds a usable Sweet Search index. */
export function hasIndex(dir) {
  return !!dir && fs.existsSync(path.join(dir, INDEX_FILE));
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

function real(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

function* ancestors(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    yield d;
    if (path.dirname(d) === d) return;
  }
}

function gitLocationOverridden(env = process.env) {
  return GIT_LOCATION_VARS.some(name => env[name]);
}

/** The facts git reports, from three `git rev-parse` starts (the slow, exact path). */
function describeWithGit(cwd) {
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
 * The worktree facts of the checkout whose top is `dir`, read from `dir/.git`.
 * Returns null when `dir` holds no `.git`, the facts when it does, and undefined when the
 * files are not ones this reader is sure of (git must answer).
 */
function checkoutAt(dir) {
  const dotGit = path.join(dir, '.git');
  let st;
  try { st = fs.lstatSync(dotGit); } catch { return null; }
  // git refuses a repository another user owns (safe.directory); let it decide.
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return undefined;
  const top = real(dir);
  if (!top) return undefined;
  if (st.isDirectory()) {
    // A main checkout. A `.git` directory with no HEAD is not a repository to git, which
    // would keep walking up.
    if (!fs.existsSync(path.join(dotGit, 'HEAD'))) return undefined;
    const gitDir = real(dotGit);
    if (!gitDir) return undefined;
    return { linked: false, gitDir, commonDir: gitDir, mainCheckout: path.dirname(gitDir), worktree: top };
  }
  if (!st.isFile()) return undefined;
  let text;
  try { text = fs.readFileSync(dotGit, 'utf8'); } catch { return undefined; }
  const m = /^gitdir:[ \t]*(.+?)[ \t]*\r?$/m.exec(text);
  if (!m) return undefined;
  const gitDir = real(path.resolve(dir, m[1]));
  if (!gitDir || !fs.existsSync(path.join(gitDir, 'HEAD'))) return undefined;
  let commonDir = gitDir;
  let rel = null;
  try { rel = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim(); } catch { /* a submodule */ }
  if (rel) {
    commonDir = real(path.resolve(gitDir, rel));
    if (!commonDir) return undefined;
  }
  return { linked: gitDir !== commonDir, gitDir, commonDir, mainCheckout: path.dirname(commonDir), worktree: top };
}

/**
 * Worktree facts for `cwd`, or null when it is not inside a git worktree at all.
 * A LINKED worktree is one whose git dir differs from its common dir; the main checkout
 * is the common directory's parent. Same values, same spelling as `git rev-parse`.
 */
export function describeWorktree(cwd, { env = process.env } = {}) {
  if (!gitLocationOverridden(env)) {
    const start = real(cwd);
    if (start) {
      let unsure = false;
      for (const dir of ancestors(start)) {
        const facts = checkoutAt(dir);
        if (facts === undefined) { unsure = true; break; }
        if (facts) return facts;
      }
      if (!unsure) return null;
    }
  }
  return describeWithGit(cwd);
}

function lazyWorktree(roots, cwd) {
  let memo;
  return Object.defineProperty(roots, 'worktree', {
    enumerable: true,
    get() { if (memo === undefined) memo = describeWorktree(cwd); return memo; },
  });
}

function linkedRoots(wt) {
  if (hasIndex(wt.mainCheckout)) {
    // Split, and SAY so. The caller prints `notice` once; a silent redirect is the failure
    // mode this whole module exists to prevent.
    return {
      indexRoot: wt.mainCheckout,
      fileRoot: wt.worktree,
      split: true,
      refusal: null,
      worktree: wt,
      notice: `(linked git worktree: index from ${wt.mainCheckout}, file contents from this worktree. `
        + `A result may name a file this worktree has since changed.)`,
    };
  }
  return {
    indexRoot: wt.worktree, fileRoot: wt.worktree, split: false, worktree: wt,
    refusal: `[ss-*] no Sweet Search index for this linked git worktree.\n`
      + `  worktree:      ${wt.worktree}\n`
      + `  main checkout: ${wt.mainCheckout} (no .sweet-search/codebase.db there either)\n`
      + `Index the main checkout, then re-run from here — one index serves every worktree of a repository.\n`
      + `To point at a different checkout explicitly: SWEET_SEARCH_PROJECT_ROOT=<path>`,
  };
}

/**
 * Resolve the two roots for a session.
 *
 * The walk goes up from the cwd, and the first directory that decides wins:
 *   - it holds an index: both roots are that directory (a linked worktree with an index
 *     of its own is served by it, unsplit);
 *   - it is the top of a linked worktree: index from the main checkout, files from the
 *     worktree (split), or a refusal when the main checkout has no index. A worktree
 *     nested inside its main checkout (`<repo>/.claude/worktrees/x`) is met before
 *     `<repo>`, so its own files are read, never the main checkout's;
 *   - a main checkout or a submodule without an index does not decide: an index above
 *     it still serves (the client sends the call to that index's daemon too).
 * Nothing decides: both roots are the cwd and the caller prints its "no index" message.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} [opts.explicitRoot]  SWEET_SEARCH_PROJECT_ROOT, which always wins — it is
 *   how the bench pins a root, and second-guessing it would change measured behaviour.
 * @param {object} [opts.env]  the caller's environment (git location variables)
 * @returns {{indexRoot: string, fileRoot: string, split: boolean, refusal: string|null,
 *            worktree: object|null}}
 *   `refusal` non-null means no index is reachable and the caller must stop and print it.
 */
export function resolveRoots({ cwd, explicitRoot = '', env = process.env } = {}) {
  const here = cwd || process.cwd();
  if (explicitRoot) {
    return { indexRoot: explicitRoot, fileRoot: explicitRoot, split: false, refusal: null, worktree: null };
  }

  // The common case — the session runs where the index is — reads no git facts at all.
  if (hasIndex(here)) {
    return lazyWorktree({ indexRoot: here, fileRoot: here, split: false, refusal: null }, here);
  }

  if (gitLocationOverridden(env)) {
    // git decides where the checkout is; the files around the cwd may not be it.
    const wt = describeWithGit(here);
    if (wt?.linked && !hasIndex(wt.worktree)) return linkedRoots(wt);
  } else {
    const start = real(here) || path.resolve(here);
    for (const dir of ancestors(start)) {
      if (hasIndex(dir)) {
        return lazyWorktree({ indexRoot: dir, fileRoot: dir, split: false, refusal: null }, here);
      }
      let facts = checkoutAt(dir);
      if (facts === undefined) facts = describeWithGit(here);
      if (facts?.linked) return linkedRoots(facts);
    }
    return lazyWorktree({ indexRoot: here, fileRoot: here, split: false, refusal: null }, here);
  }

  for (const dir of ancestors(real(here) || path.resolve(here))) {
    if (hasIndex(dir)) {
      return lazyWorktree({ indexRoot: dir, fileRoot: dir, split: false, refusal: null }, here);
    }
  }
  return lazyWorktree({ indexRoot: here, fileRoot: here, split: false, refusal: null }, here);
}
