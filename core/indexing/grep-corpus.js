/**
 * Grep corpus — the files the sparse-gram index (ss-grep) covers.
 *
 * Wider than embedding admission on purpose. An ss-grep that returns 0 because the file
 * was never indexed reads to the agent as "absent" (zmap/zlint-299: `IsPrecert` lives only
 * under the committed `vendor/`, which embedding admission denies). So the grep corpus is
 * what `rg` would search: in a git worktree every tracked file plus every untracked file
 * that is not ignored (`git ls-files --cached --others --exclude-standard`); without git,
 * every file under the root except dependency/cache directories. The embedding-admitted
 * files are always included, so the grep corpus never shrinks below what it was.
 *
 * Still excluded, git-visible or not: sweet-search's own state and second checkouts, the
 * secret/env patterns (the gram index stores substrings of content), `.sweet-search-ignore`,
 * symlinks (rule 5 of admission-policy.js), empty files, files over GREP_MAX_FILE_SIZE, and
 * minified bundles. Binary files are dropped by the native builder (not valid UTF-8) and by
 * native grep (NUL in the first 8 KiB).
 */

import fs from 'node:fs/promises';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Minimatch } from 'minimatch';

import { SECRET_FILE_PATTERNS } from '../infrastructure/config/index.js';
import { createAdmissionPolicy, isSymlinkedRelUnder } from './admission-policy.js';
import { fileLooksMinified } from './minified-detector.js';
import { changedFilesTracker } from './changed-files-tracker.js';
import {
  DEFAULT_REPO_SIZE_CAP, loadIgnoreFile, patternToRegex,
} from '../incremental-indexing/infrastructure/path-filter.mjs';

export const GREP_MAX_FILE_SIZE = 10 * 1024 * 1024;

const INTERNAL_PATH_RE = /(^|\/)(\.sweet-search|\.git|\.claude\/worktrees)(\/|$)/;

// Without git nothing says what is ignored. These directories hold installed dependencies,
// virtualenvs and caches; walking them can mean millions of files.
const NO_GIT_SKIP_DIRS = new Set([
  '.git', '.sweet-search', 'node_modules', '.venv', 'venv', '__pycache__', '.cache',
  '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox', '.next', '.nuxt', '.turbo',
  '.parcel-cache', '.svelte-kit', '.vercel',
]);

const SECRET_MATCHERS = SECRET_FILE_PATTERNS.map((glob) => new Minimatch(glob, { dot: true }));
const STAT_BATCH = 200;

const normalizeRel = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * Path-only gate shared by indexing and the search-time fallback.
 * @param {string} rel  project-relative path
 * @param {RegExp[]} [ignoreRegexes]  compiled `.sweet-search-ignore` patterns
 */
export function isGrepCorpusPath(rel, ignoreRegexes = []) {
  const r = normalizeRel(rel);
  if (!r || r === '..' || r.startsWith('../') || path.isAbsolute(r)) return false;
  if (INTERNAL_PATH_RE.test(r)) return false;
  if (SECRET_MATCHERS.some((m) => m.match(r))) return false;
  return !ignoreRegexes.some((re) => re.test(r));
}

function loadIgnoreRegexes(projectRoot) {
  return loadIgnoreFile(path.join(projectRoot, '.sweet-search-ignore')).map(patternToRegex);
}

/**
 * Files git would show `rg`, relative to `projectRoot`, or null outside a git worktree.
 * @param {string} projectRoot
 * @param {{changedOnly?: boolean}} [opts]  changedOnly: modified tracked + untracked files only
 * @returns {string[] | null}
 */
export function listGitVisibleFiles(projectRoot, { changedOnly = false } = {}) {
  const args = changedOnly
    ? ['ls-files', '-z', '--modified', '--others', '--exclude-standard']
    : ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  let out;
  try {
    out = execFileSync('git', args, {
      cwd: projectRoot, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const seen = new Set();
  for (const p of out.toString('utf8').split('\0')) {
    if (p) seen.add(normalizeRel(p));
  }
  return [...seen];
}

async function walkProjectRoot(projectRoot, limit) {
  const out = [];
  const stack = [''];
  while (stack.length > 0 && out.length <= limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(path.join(projectRoot, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!NO_GIT_SKIP_DIRS.has(entry.name)) stack.push(rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  return out.sort();
}

function isRegularGrepFile(stat) {
  return !!stat && stat.isFile() && stat.size > 0 && stat.size <= GREP_MAX_FILE_SIZE;
}

/**
 * Keep the files that pass every corpus gate, in input order.
 * @param {string[]} rels
 * @param {{projectRoot: string, policy?: object, ignoreRegexes?: RegExp[]}} ctx
 */
export async function filterGrepCorpusFiles(rels, { projectRoot, policy, ignoreRegexes }) {
  const admission = policy || createAdmissionPolicy({ projectRoot });
  const ignores = ignoreRegexes || loadIgnoreRegexes(projectRoot);
  const symlinkMemo = new Map();
  const candidates = rels.filter((rel) => isGrepCorpusPath(rel, ignores)
    && !admission.isSymlinkedRel(rel, symlinkMemo));
  const kept = [];
  for (let i = 0; i < candidates.length; i += STAT_BATCH) {
    const batch = candidates.slice(i, i + STAT_BATCH);
    const verdicts = await Promise.all(batch.map(async (rel) => {
      const abs = path.join(projectRoot, rel);
      const stat = await fs.lstat(abs).catch(() => null);
      if (!isRegularGrepFile(stat)) return false;
      return !(await fileLooksMinified(abs, rel));
    }));
    for (let j = 0; j < batch.length; j++) if (verdicts[j]) kept.push(batch[j]);
  }
  return kept;
}

/**
 * The sparse-gram corpus: the embedding-admitted files first, then every other file the
 * corpus admits, capped at `cap` files in total.
 * @param {string[]} embeddingFiles  project-relative, already admitted by discoverFiles
 * @param {{projectRoot: string, cap?: number}} opts
 * @returns {Promise<{files: string[], added: number, truncated: number, source: 'git'|'walk'}>}
 */
export async function discoverGrepCorpus(embeddingFiles, { projectRoot, cap = DEFAULT_REPO_SIZE_CAP }) {
  const base = Array.isArray(embeddingFiles) ? embeddingFiles.map(normalizeRel) : [];
  const present = new Set(base);
  const gitFiles = listGitVisibleFiles(projectRoot);
  const listed = gitFiles ? gitFiles.sort() : await walkProjectRoot(projectRoot, cap);
  const extra = await filterGrepCorpusFiles(listed.filter((rel) => !present.has(rel)), { projectRoot });
  const room = Math.max(0, cap - base.length);
  const added = extra.slice(0, room);
  return {
    files: [...base, ...added],
    added: added.length,
    truncated: extra.length - added.length,
    source: gitFiles ? 'git' : 'walk',
  };
}

const CHANGED_TTL_MS = 2000;
const changedCache = new Map();

/**
 * Modified tracked and untracked (not ignored) files that pass the path and size gates —
 * what an index built earlier may hold stale grams for, or not hold at all. Empty outside
 * git. No minified check: it runs per search, on an error path.
 * Memoised briefly: one ss-grep call can search twice (case-insensitive retry).
 * @param {string} projectRoot
 * @param {{limit?: number}} [opts]
 * @returns {string[]}
 */
export function listChangedGrepFiles(projectRoot, { limit = 2000 } = {}) {
  // In the daemon the listing is kept current from file events (changed-files-tracker.js),
  // so a zero-hit grep no longer walks the whole tree for untracked files.
  const tracker = changedFilesTracker(path.resolve(projectRoot));
  let listed = null;
  if (tracker) {
    try { listed = tracker.list(); } catch { listed = null; }
  }
  const now = Date.now();
  if (!listed) {
    const hit = changedCache.get(projectRoot);
    if (hit && now - hit.at < CHANGED_TTL_MS) return hit.files;
    listed = listGitVisibleFiles(projectRoot, { changedOnly: true }) || [];
  }
  const ignores = loadIgnoreRegexes(projectRoot);
  const files = [];
  for (const rel of listed.sort()) {
    if (files.length >= limit) break;
    if (!isGrepCorpusPath(rel, ignores)) continue;
    let stat = null;
    try { stat = lstatSync(path.join(projectRoot, rel)); } catch { stat = null; }
    if (isRegularGrepFile(stat)) files.push(rel);
  }
  changedCache.set(projectRoot, { at: now, files });
  return files;
}

const PENDING_QUEUE = 'index-maintainer-queue.jsonl';
const PENDING_PROCESSING = 'index-maintainer-queue.processing.jsonl';
const PENDING_TTL_MS = 30_000;
const pendingCache = new Map();

function readQueuePaths(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return null; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const fp = JSON.parse(line).file_path;
      if (typeof fp === 'string' && fp) out.push(fp);
    } catch { /* a partial last line, or a malformed one */ }
  }
  return out;
}

function queueStamp(file) {
  try {
    const st = lstatSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return '-';
  }
}

// Paths git ignores, from one `git check-ignore` call. Outside git, or on any
// git failure, nothing counts as ignored (the path gates above still apply).
function gitIgnoredSet(projectRoot, rels) {
  if (rels.length === 0) return new Set();
  const res = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
    cwd: projectRoot, input: rels.join('\0'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout) return new Set();
  return new Set(res.stdout.split('\0').filter(Boolean));
}

/**
 * Files queued for the maintainer but not yet reindexed, newest first. Their grams are stale or
 * absent until the maintainer reaches them, and a committed file is not in git's changed list,
 * so a backlog (a branch switch, a pull, a stopped maintainer) would answer "no matches" for
 * code on disk. Read on the zero-hit path only.
 *
 * Each path passes the grep-corpus gates rg would apply: inside the root with no symlinked
 * component, a regular file, not gitignored. The validated list is cached on the queue files'
 * size and mtime. `inScope` filters before `limit`, so a scoped search never loses its files
 * to the cap.
 * @param {string} projectRoot
 * @param {{stateDir?: string, limit?: number, inScope?: (rel: string) => boolean}} [opts]
 * @returns {string[]}
 */
export function listPendingReindexFiles(projectRoot, { stateDir, limit = 2000, inScope = null } = {}) {
  const dir = stateDir || process.env.SWEET_SEARCH_STATE_DIR || path.join(projectRoot, '.sweet-search');
  const queueFile = path.join(dir, PENDING_QUEUE);
  const processingFile = path.join(dir, PENDING_PROCESSING);
  const key = `${projectRoot}\0${dir}`;
  const stamp = `${queueStamp(queueFile)}|${queueStamp(processingFile)}`;
  const now = Date.now();
  let validated = null;
  const hit = pendingCache.get(key);
  if (hit && hit.stamp === stamp && now - hit.at < PENDING_TTL_MS) validated = hit.files;
  if (!validated) {
    // Queue first, then the processing file. If the processing file is gone, the maintainer may
    // have appended its deferred tail and published between the two reads: read the queue again.
    let queued = readQueuePaths(queueFile) || [];
    const processing = readQueuePaths(processingFile);
    if (processing === null) queued = readQueuePaths(queueFile) || queued;
    const ordered = [...queued].reverse().concat([...(processing || [])].reverse());
    const seen = new Set();
    const candidates = [];
    const ignores = loadIgnoreRegexes(projectRoot);
    const linkMemo = new Map();
    for (const fp of ordered) {
      const rel = path.posix.normalize(normalizeRel(path.isAbsolute(fp) ? path.relative(projectRoot, fp) : fp));
      if (!rel || rel === '.' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel) || seen.has(rel)) continue;
      seen.add(rel);
      if (!isGrepCorpusPath(rel, ignores)) continue;
      if (isSymlinkedRelUnder(projectRoot, rel, linkMemo)) continue;
      let stat = null;
      try { stat = lstatSync(path.join(projectRoot, rel)); } catch { stat = null; }
      if (isRegularGrepFile(stat)) candidates.push(rel);
    }
    const ignored = gitIgnoredSet(projectRoot, candidates);
    validated = candidates.filter((rel) => !ignored.has(rel));
    pendingCache.set(key, { stamp, at: now, files: validated });
  }
  const files = [];
  for (const rel of validated) {
    if (files.length >= limit) break;
    if (!inScope || inScope(rel)) files.push(rel);
  }
  return files;
}

export function _resetChangedGrepFilesCache() {
  changedCache.clear();
  pendingCache.clear();
}
