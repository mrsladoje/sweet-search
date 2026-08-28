/**
 * Shared file-admission policy for full + incremental indexing.
 *
 * Full indexing (`discoverFiles` in indexer-utils.js) and incremental indexing
 * (`dirty-scan` producer + `production-reconciler` consumer) MUST admit exactly
 * the same files: a file full indexing would skip must never be newly indexed by
 * incremental, and a file full indexing would admit must be eligible for
 * incremental. This module is the single definition of that decision so the two
 * paths cannot drift.
 *
 * A file is admitted iff ALL of:
 *   1. include allowlist — matches a project `include` glob (minimatch)
 *   2. NOT excluded      — `buildPathFilter` deny-list (default deny dirs/exts +
 *                          project `exclude` globs + `.sweet-search-ignore`)
 *   3. NOT oversized      — size ≤ project `maxFileSize`
 *   4. NOT gitignored     — `git check-ignore` alignment (agentic paths exempt),
 *                          only when the worktree is a git repo
 *
 * The exclude/deny component is delegated to `buildPathFilter` (incremental
 * infra) so its rules — and its tests — stay the single source for "deny", and
 * gitignore is delegated to `gitignore-filter` so it matches full indexing.
 * This module only adds the include allowlist + size + the wiring.
 *
 * Shape checks (include + deny) are synchronous and I/O-free so producers can
 * prune cheaply during a tree walk. Size is a single `stat`. Gitignore is async
 * and batched (one `git check-ignore` per call) — never per-file.
 */

import path from 'node:path';
import { statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Minimatch } from 'minimatch';

import { loadProjectConfig } from '../infrastructure/config/index.js';
import { buildPathFilter } from '../incremental-indexing/infrastructure/path-filter.mjs';
import { getGitIgnoredPathSet, isGitignoreAllowlistedAgenticPath, toPosixPath } from './gitignore-filter.js';

const MM_OPTS = { dot: true, nocase: false };
const DEFAULT_MAX_FILE_SIZE = 1 * 1024 * 1024;

function normalizeRel(rel) {
  return String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Build an admission policy bound to a project root.
 *
 * @param {object} [opts]
 * @param {string} [opts.projectRoot]
 * @param {object} [opts.config]              Pre-loaded loadProjectConfig() result.
 * @param {boolean} [opts.allowSweetSearchDir] Lift the `.sweet-search` deny (daemon self-paths).
 */
export function createAdmissionPolicy({ projectRoot = process.cwd(), config, allowSweetSearchDir = false } = {}) {
  const cfg = config || loadProjectConfig(projectRoot);
  const includeGlobs = Array.isArray(cfg.include) ? cfg.include : [];
  const excludeGlobs = Array.isArray(cfg.exclude) ? cfg.exclude : [];
  const includeMatchers = includeGlobs.map((g) => new Minimatch(g, MM_OPTS));
  const isDenied = buildPathFilter({ projectRoot, allowSweetSearchDir });
  // "Hard" deny variant: everything the full filter denies EXCEPT the
  // build-output dirs (build/dist/out/target). Used to detect files whose only
  // reason for exclusion is a build-output dir, so git-tracked source kept there
  // (e.g. Boost.Build's src/build/*.jam) can be re-admitted.
  const isDeniedHard = buildPathFilter({ projectRoot, allowSweetSearchDir, omitBuildOutputDirs: true });
  const maxFileSize = typeof cfg.maxFileSize === 'number' ? cfg.maxFileSize : DEFAULT_MAX_FILE_SIZE;
  const respectGitignore = cfg.respectGitignore !== false;
  const hasGit = existsSync(path.join(projectRoot, '.git'));

  /** Include allowlist only (matches a project include glob). */
  function matchesInclude(rel) {
    const r = normalizeRel(rel);
    if (!r) return false;
    return includeMatchers.some((m) => m.match(r));
  }

  /** Deny-list only (true ⇒ excluded). Mirrors buildPathFilter; used for directory pruning. */
  function isExcluded(rel) {
    return isDenied(normalizeRel(rel));
  }

  /**
   * True when `rel` is excluded ONLY because it sits under a build-output dir
   * (build/dist/out/target) — denied by the full filter but not the hard one.
   * Such a path is re-admitted iff git tracks it (see `admitsShape`).
   */
  function isBuildOutputOnly(rel) {
    const r = normalizeRel(rel);
    return isDenied(r) && !isDeniedHard(r);
  }

  // Git-tracked file set, computed lazily and memoised (one `git ls-files` per
  // policy). Empty when not a git repo or git is unavailable, so re-admission
  // simply never fires there. Bounded buffer guards a pathological mono-repo.
  let trackedCache = null;
  function trackedFiles() {
    if (trackedCache) return trackedCache;
    trackedCache = new Set();
    if (!hasGit) return trackedCache;
    try {
      const out = execFileSync('git', ['ls-files', '-z'], {
        cwd: projectRoot, maxBuffer: 256 * 1024 * 1024,
      });
      for (const p of out.toString('utf8').split('\0')) {
        if (p) trackedCache.add(normalizeRel(p));
      }
    } catch { /* git unavailable ⇒ empty ⇒ no re-admission */ }
    return trackedCache;
  }

  /**
   * Synchronous shape gate: include allowlist AND not excluded. The one gate
   * both full and incremental indexing consume. A git-TRACKED file whose only
   * exclusion reason is a build-output dir is re-admitted (memoised git lookup),
   * so both paths admit exactly the same set.
   */
  function admitsShape(rel) {
    const r = normalizeRel(rel);
    if (!r) return false;
    if (!matchesInclude(r)) return false;
    if (!isDenied(r)) return true;
    return isBuildOutputOnly(r) && trackedFiles().has(r);
  }

  /** True if the file at `absPath` exceeds maxFileSize. A stat error ⇒ true (treat as inadmissible, matching full indexing which drops un-statable files). */
  function isOversizedAbs(absPath) {
    try {
      return statSync(absPath).size > maxFileSize;
    } catch {
      return true;
    }
  }

  /**
   * Batched gitignore: returns the subset of `rels` that git would ignore
   * (posix-normalised). Empty when gitignore is disabled, the worktree is not a
   * git repo, or git is unavailable — matching full indexing's fallback to
   * "admit everything" rather than dropping files on a git failure.
   */
  async function gitignoredSet(rels, { silent = true } = {}) {
    if (!respectGitignore || !hasGit) return new Set();
    const candidates = [];
    for (const rel of rels) {
      const r = normalizeRel(rel);
      if (!r || isGitignoreAllowlistedAgenticPath(r)) continue;
      candidates.push(r);
    }
    if (candidates.length === 0) return new Set();
    const ignored = await getGitIgnoredPathSet(candidates, { projectRoot, silent });
    if (!ignored) return new Set();
    const out = new Set();
    for (const p of ignored) out.add(toPosixPath(p));
    return out;
  }

  /**
   * Convenience for batch discovery: drop gitignored paths from `rels`.
   * Equivalent to full indexing's applyGitignoreAlignment over an already
   * shape+size filtered list.
   */
  async function applyGitignore(rels, { silent = true } = {}) {
    const list = [...rels];
    const ignored = await gitignoredSet(list, { silent });
    if (ignored.size === 0) return { files: list, gitignored: 0 };
    const files = list.filter((rel) => !ignored.has(toPosixPath(normalizeRel(rel))));
    return { files, gitignored: list.length - files.length };
  }

  return {
    projectRoot,
    includeGlobs,
    excludeGlobs,
    maxFileSize,
    respectGitignore,
    hasGit,
    matchesInclude,
    isExcluded,
    isBuildOutputOnly,
    trackedFiles,
    admitsShape,
    isOversizedAbs,
    gitignoredSet,
    applyGitignore,
  };
}
