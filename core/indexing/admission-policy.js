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

  // `.gitattributes` linguist overrides — the authoritative, repo-declared signal,
  // resolved once via `git check-attr` (git's own path matching, incl. nested
  // .gitattributes). This is the mechanism GitHub documents for our exact problem:
  // `build/** linguist-generated=false` re-includes real source in an excluded dir,
  // and `dist/** linguist-generated` marks a committed bundle for exclusion.
  // Returns for each tracked path one of: 'force-include' (linguist-*=false / -attr,
  // repo says "this is source"), 'vendored' (skip), 'generated' (demote, handled
  // downstream by the chunk policy), or null (unspecified → fall through to heuristics).
  let linguistCache = null;
  function linguistAttr(rel) {
    if (!linguistCache) linguistCache = buildLinguistMap();
    return linguistCache.get(normalizeRel(rel)) || null;
  }
  function buildLinguistMap() {
    const map = new Map();
    if (!hasGit) return map;
    const files = [...trackedFiles()];
    if (!files.length) return map;
    let out;
    try {
      out = execFileSync('git',
        ['check-attr', '--stdin', '-z', 'linguist-generated', 'linguist-vendored', 'linguist-documentation'],
        { cwd: projectRoot, input: files.join('\0') + '\0', maxBuffer: 512 * 1024 * 1024 })
        .toString('utf8');
    } catch { return map; }
    // Output is NUL-separated (path, attr, value) triples.
    const parts = out.split('\0');
    // A linguist boolean is TRUE unless the value is 'unspecified', 'unset' or 'false'
    // (Linguist lazy_blob.rb `boolean_attribute`). 'unset'/'false' means an explicit
    // negation — the repo forcing the file to be treated as source.
    const isTrue = (v) => v !== 'unspecified' && v !== 'unset' && v !== 'false';
    const isFalse = (v) => v === 'unset' || v === 'false';
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const path = normalizeRel(parts[i]);
      const attr = parts[i + 1];
      const val = parts[i + 2];
      if (!path) continue;
      const prev = map.get(path);
      if (isFalse(val) && (attr === 'linguist-generated' || attr === 'linguist-vendored')) {
        map.set(path, 'force-include');            // wins over everything
      } else if (attr === 'linguist-vendored' && isTrue(val)) {
        if (prev !== 'force-include') map.set(path, 'vendored');
      } else if (attr === 'linguist-generated' && isTrue(val)) {
        if (prev !== 'force-include' && prev !== 'vendored') map.set(path, 'generated');
      }
    }
    return map;
  }

  /** True when `.gitattributes` explicitly declares this path as source
   *  (linguist-generated=false / linguist-vendored=false). Such a file must be
   *  indexed even if it sits under a deny dir or looks generated. */
  function forceAdmit(rel) {
    return linguistAttr(rel) === 'force-include';
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
    // .gitattributes is authoritative in both directions (Linguist precedence).
    const la = linguistAttr(r);
    if (la === 'force-include') return true;   // repo declares this source → index it
    if (la === 'vendored') return false;       // repo declares this vendored → skip
    // (la === 'generated' falls through: kept for grep, demoted from vectors by the
    //  chunk-time generated policy — the readable-but-generated Tier-2 case.)
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
    linguistAttr,
    forceAdmit,
    admitsShape,
    isOversizedAbs,
    gitignoredSet,
    applyGitignore,
  };
}
