// Read-Workflows bench setup — real-repo edition.
//
// Targets one of the four pinned repos under eval/repos/<repo>/, which are
// cloned by eval/scripts/fetch-benchmark-repos.js at the SHAs in
// repo-manifest.json and indexed via core/indexing/index-codebase-v21.js.
//
// IMPORTANT: This module sets SWEET_SEARCH_PROJECT_ROOT before any sweet-search
// module is imported by the runner — DB_PATHS in core/infrastructure/config
// resolves once per process, so a process is dedicated to a single repo.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
export const REPOS_DIR = path.join(REPO_ROOT, 'eval', 'repos');

let _manifestCache = null;
export function loadManifest() {
  if (_manifestCache) return _manifestCache;
  const p = path.join(__dirname, 'repo-manifest.json');
  _manifestCache = JSON.parse(readFileSync(p, 'utf8'));
  return _manifestCache;
}

export function listRepos() {
  return Object.keys(loadManifest().repos);
}

export function getRepoSpec(name) {
  const spec = loadManifest().repos[name];
  if (!spec) throw new Error(`unknown repo "${name}"; valid: ${listRepos().join(', ')}`);
  return { name, ...spec };
}

/**
 * Fingerprint a repo by hashing the canonical files listed in the manifest.
 * Returns a 16-hex-char prefix of the sha256 over `${path}\0${size}\0${mtime}\0${content}`
 * for each file in the manifest order. Drift in any file changes the
 * fingerprint, even if the source git SHA is now unrecoverable (.git is
 * removed at fetch time).
 */
export function repoFingerprint(spec, repoDir) {
  const h = createHash('sha256');
  for (const rel of spec.fingerprintFiles) {
    const abs = path.join(repoDir, rel);
    if (!existsSync(abs)) {
      h.update(`MISSING:${rel}\0`);
      continue;
    }
    const st = statSync(abs);
    const buf = readFileSync(abs);
    h.update(`${rel}\0${st.size}\0`);
    h.update(buf);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

export function verifyRepoLayout(name) {
  const spec = getRepoSpec(name);
  const repoDir = path.join(REPOS_DIR, name);
  if (!existsSync(repoDir)) {
    throw new Error(
      `repo "${name}" not present at ${repoDir}\n` +
      `Run: node eval/scripts/fetch-benchmark-repos.js`,
    );
  }
  const sweetDir = path.join(repoDir, '.sweet-search');
  const codebaseDb = path.join(sweetDir, 'codebase.db');
  if (!existsSync(codebaseDb)) {
    throw new Error(
      `repo "${name}" not indexed (no ${path.relative(REPO_ROOT, codebaseDb)})\n` +
      `Run: SWEET_SEARCH_PROJECT_ROOT=${repoDir} node core/indexing/index-codebase-v21.js --full --sqlite-fast`,
    );
  }
  const liDb = path.join(sweetDir, 'codebase-late-interaction.db');
  const sparseGramIdx = path.join(sweetDir, 'codebase-sparse-grams.idx');
  return {
    repoDir,
    sweetDir,
    codebaseDb,
    hasLi: existsSync(liDb),
    liDb: existsSync(liDb) ? liDb : null,
    hasSparseGram: existsSync(sparseGramIdx),
    sparseGramIdx: existsSync(sparseGramIdx) ? sparseGramIdx : null,
    pinnedSha: spec.sha,
    fingerprint: repoFingerprint(spec, repoDir),
  };
}

/**
 * Set env so `core/infrastructure/config/platform.js` resolves DB_PATHS to
 * the repo's own .sweet-search directory. Must be called BEFORE importing
 * any module that touches sweet-search infrastructure.
 */
export function pointEnvAt(name) {
  const spec = getRepoSpec(name);
  const repoDir = path.join(REPOS_DIR, name);
  process.env.SWEET_SEARCH_PROJECT_ROOT = repoDir;
  // We use the repo's own data dir (default `.sweet-search/`) so it picks up
  // the persisted codebase.db, sparse-grams.idx, and LI index that
  // fetch-benchmark-repos.js produced.
  delete process.env.SWEET_SEARCH_DATA_DIR;
  // Keep LI scoring on if assets are available; --no-li in the runner forces it off.
  return { repoDir, pinnedSha: spec.sha };
}
