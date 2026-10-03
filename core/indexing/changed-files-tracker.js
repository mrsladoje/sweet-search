/**
 * `listGitVisibleFiles(root, { changedOnly: true })` for the search daemon, kept current from
 * filesystem events instead of recomputed per zero-hit grep.
 *
 * The full listing (`git ls-files --modified --others --exclude-standard`) walks every
 * directory for untracked files: 0.1 s on a 200-file repo, ~0.5 s on kubernetes, paid by
 * every ss-grep that found nothing in the index (the unindexed fallback). git still decides
 * every answer here. A path that changed since the last listing is asked again on its own
 * (`git ls-files … -- :(literal)<path>`), and everything else keeps git's previous answer.
 *
 * A full listing runs again when git's own inputs may have changed and no file event shows
 * it: `.git/index`, `HEAD` or `info/exclude` changed (polled by stat on each call), a
 * `.gitignore` changed, more than MAX_DIRTY paths changed at once, the watcher reported an
 * error, or the last full listing is MAX_AGE_MS old (bounds what a missed event, or a change
 * to a global excludes file, can leave behind; the per-call listing it replaces was itself
 * kept for 2 s).
 *
 * Only the daemon starts one (startChangedFilesTracking). Elsewhere, and until the watcher is
 * subscribed, listChangedGrepFiles computes the full listing as before.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MAX_DIRTY = 256;
const MAX_AGE_MS = 30_000;
const IGNORED_DIRS = ['.git', '.sweet-search'];

const trackers = new Map();

const normalizeRel = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');

function gitLines(projectRoot, args) {
  const out = execFileSync('git', args, {
    cwd: projectRoot, maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.toString('utf8').split('\0').filter(Boolean).map(normalizeRel);
}

function statSignature(file) {
  try {
    const st = fs.statSync(file, { bigint: true });
    return `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
  } catch {
    return 'missing';
  }
}

class ChangedFilesTracker {
  constructor(projectRoot, rootReal, gitFiles) {
    this.projectRoot = projectRoot;
    this.rootReal = rootReal;
    this.gitFiles = gitFiles; // the files git's answer depends on besides the worktree
    this.set = null;
    this.listedAt = 0;
    this.gitSignature = null;
    this.dirty = new Set();
    this.needFull = true;
    this.subscription = null;
  }

  onEvents(err, events) {
    if (err) { this.needFull = true; return; }
    for (const event of events) {
      const rel = path.relative(this.rootReal, event.path).split(path.sep).join('/');
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (IGNORED_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
      if (path.posix.basename(rel) === '.gitignore') this.needFull = true;
      this.dirty.add(rel);
    }
    if (this.dirty.size > MAX_DIRTY) this.needFull = true;
  }

  currentGitSignature() {
    return this.gitFiles.map(statSignature).join('|');
  }

  /** The changed-only listing, as a full `git ls-files` would give it now. */
  list() {
    const gitSignature = this.currentGitSignature();
    if (this.needFull || this.set === null || gitSignature !== this.gitSignature
        || Date.now() - this.listedAt > MAX_AGE_MS) {
      // Events from here on mark paths again, so nothing that changes during the listing is lost.
      this.dirty.clear();
      this.needFull = false;
      this.gitSignature = gitSignature;
      this.listedAt = Date.now();
      this.set = new Set(gitLines(this.projectRoot, ['ls-files', '-z', '--modified', '--others', '--exclude-standard']));
      return [...this.set];
    }
    if (this.dirty.size > 0) {
      const paths = [...this.dirty];
      this.dirty.clear();
      const answer = gitLines(this.projectRoot, [
        'ls-files', '-z', '--modified', '--others', '--exclude-standard', '--',
        ...paths.map((p) => `:(literal)${p}`),
      ]);
      // A path, or a directory and everything git listed under it, takes git's new answer.
      for (const listed of [...this.set]) {
        if (paths.some((p) => listed === p || listed.startsWith(`${p}/`))) this.set.delete(listed);
      }
      for (const rel of answer) this.set.add(rel);
    }
    return [...this.set];
  }
}

/**
 * Start tracking `projectRoot` (a git worktree). Resolves to the tracker, or null when there
 * is no git, no watcher, or the subscription fails; listChangedGrepFiles then keeps listing
 * in full.
 */
export async function startChangedFilesTracking(projectRoot) {
  projectRoot = path.resolve(projectRoot);
  if (trackers.has(projectRoot)) return trackers.get(projectRoot);
  let gitFiles;
  try {
    gitFiles = execFileSync('git', ['rev-parse', '--git-path', 'index', '--git-path', 'HEAD', '--git-path', 'info/exclude'], {
      cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8').split('\n').filter(Boolean).map((p) => path.resolve(projectRoot, p));
  } catch {
    return null; // not a git worktree
  }
  let watcher;
  try {
    const mod = await import('@parcel/watcher');
    watcher = mod.default ?? mod;
  } catch {
    return null;
  }
  let rootReal;
  try { rootReal = fs.realpathSync(projectRoot); } catch { return null; }
  const tracker = new ChangedFilesTracker(projectRoot, rootReal, gitFiles);
  try {
    tracker.subscription = await watcher.subscribe(rootReal, (err, events) => tracker.onEvents(err, events), {
      ignore: IGNORED_DIRS.map((d) => path.join(rootReal, d)),
    });
  } catch {
    return null;
  }
  trackers.set(projectRoot, tracker);
  return tracker;
}

/** The tracker for `projectRoot`, if the daemon started one. */
export function changedFilesTracker(projectRoot) {
  return trackers.get(projectRoot) || null;
}

export async function stopChangedFilesTracking() {
  for (const tracker of trackers.values()) {
    try { await tracker.subscription?.unsubscribe(); } catch { /* already gone */ }
  }
  trackers.clear();
}
