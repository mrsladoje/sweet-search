/**
 * Gitignore alignment for file admission.
 *
 * Extracted from indexer-utils.js so both full indexing (`discoverFiles`) and
 * the shared admission policy (`admission-policy.js`, used by incremental
 * indexing) run the *same* `.gitignore` logic. The only behavioural change vs
 * the original is that the project root is a parameter instead of the global
 * `PROJECT_ROOT` constant, so the incremental maintainer can align gitignore
 * against the worktree it actually reconciles. Full indexing keeps passing
 * `PROJECT_ROOT` (the default), so its behaviour is unchanged.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';

import { PROJECT_ROOT, AGENTIC_GITIGNORE_ALLOWLIST } from '../infrastructure/config/index.js';

export function toPosixPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function logError(message) {
  console.error(`[indexer] ${message}`);
}

/**
 * Agentic tooling paths stay indexable even when listed in `.gitignore`
 * (local AI workflow files). Mirrors AGENTIC_GITIGNORE_ALLOWLIST.
 */
export function isGitignoreAllowlistedAgenticPath(relativePath) {
  const normalized = toPosixPath(relativePath).replace(/^\.\//, '');
  const basename = path.posix.basename(normalized);

  if (AGENTIC_GITIGNORE_ALLOWLIST.files.includes(basename)) {
    return true;
  }

  if (AGENTIC_GITIGNORE_ALLOWLIST.filePrefixes.some(prefix => basename.startsWith(prefix))) {
    return true;
  }

  return AGENTIC_GITIGNORE_ALLOWLIST.directories.some(dirPrefix =>
    normalized.startsWith(dirPrefix) || normalized.includes(`/${dirPrefix}`)
  );
}

/**
 * Run `git check-ignore` on a single batch of paths.
 * Returns a list of ignored paths, or null on fatal error.
 */
function checkIgnoreBatch(batch, projectRoot, reportError) {
  return new Promise((resolve) => {
    const ignoredChunks = [];
    let settled = false;

    const git = spawn('git', ['check-ignore', '-z', '--stdin'], { cwd: projectRoot });

    git.stdout.on('data', chunk => ignoredChunks.push(chunk));
    git.stderr.on('data', () => {}); // Suppress — batched caller handles partial failures

    git.on('error', (err) => {
      if (settled) return;
      settled = true;
      reportError(`WARN: Unable to run git check-ignore (${err.message})`);
      resolve(null);
    });

    git.on('close', (code) => {
      if (settled) return;
      settled = true;

      // code 0 = some ignored, code 1 = none ignored, both valid.
      // code 128 = fatal (e.g. path beyond symlink) — still use partial stdout.
      if (code !== 0 && code !== 1 && ignoredChunks.length === 0) {
        resolve(null);
        return;
      }

      const ignored = Buffer.concat(ignoredChunks)
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map(toPosixPath);

      resolve(ignored);
    });

    const stdinPayload = `${batch.map(toPosixPath).join('\0')}\0`;
    git.stdin.on('error', () => {}); // Suppress EPIPE if git exits early
    git.stdin.end(stdinPayload);
  });
}

const CHECK_IGNORE_BATCH_SIZE = 5000;

/**
 * Find directory components that are symlinks, so we can filter out paths
 * that traverse them (git check-ignore fatals on "beyond a symbolic link").
 */
async function findSymlinkDirs(paths, projectRoot) {
  const checked = new Map();
  const symlinkPrefixes = [];

  for (const p of paths) {
    const parts = p.split('/');
    let dir = '';
    for (let i = 0; i < parts.length - 1; i++) {
      dir = dir ? `${dir}/${parts[i]}` : parts[i];
      if (checked.has(dir)) continue;
      try {
        const stat = await fs.lstat(path.join(projectRoot, dir));
        const isLink = stat.isSymbolicLink();
        checked.set(dir, isLink);
        if (isLink) symlinkPrefixes.push(dir + '/');
      } catch {
        checked.set(dir, false);
      }
    }
  }

  return symlinkPrefixes;
}

export async function getGitIgnoredPathSet(paths, options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const silent = options.silent ?? false;
  const reportError = silent ? () => {} : logError;

  if (paths.length === 0) {
    return new Set();
  }

  const ignored = new Set();

  // Pre-filter paths that traverse symlinks — git check-ignore fatals on these.
  // Files beyond symlinks are also checked: if the symlink dir itself is ignored,
  // all files under it are treated as ignored too.
  const symlinkPrefixes = await findSymlinkDirs(paths, projectRoot);
  let safePaths = paths;
  if (symlinkPrefixes.length > 0) {
    // Check if the symlink directories themselves are ignored
    const symlinkDirs = symlinkPrefixes.map(p => p.slice(0, -1)); // remove trailing /
    const symlinkIgnored = await checkIgnoreBatch(symlinkDirs, projectRoot, reportError);
    const ignoredSymlinks = new Set(symlinkIgnored || []);

    safePaths = [];
    for (const p of paths) {
      const matchedPrefix = symlinkPrefixes.find(prefix => p.startsWith(prefix));
      if (matchedPrefix) {
        // Path traverses a symlink — check if symlink dir is gitignored
        const dir = matchedPrefix.slice(0, -1);
        if (ignoredSymlinks.has(dir)) {
          ignored.add(toPosixPath(p)); // inherit parent's ignored status
        }
        // Either way, skip git check-ignore (would fatal)
      } else {
        safePaths.push(p);
      }
    }
  }

  let failedBatches = 0;

  for (let i = 0; i < safePaths.length; i += CHECK_IGNORE_BATCH_SIZE) {
    const batch = safePaths.slice(i, i + CHECK_IGNORE_BATCH_SIZE);
    const result = await checkIgnoreBatch(batch, projectRoot, reportError);
    if (result) {
      for (const p of result) ignored.add(p);
    } else {
      failedBatches++;
    }
  }

  const totalBatches = Math.ceil(safePaths.length / CHECK_IGNORE_BATCH_SIZE);
  if (failedBatches === totalBatches && totalBatches > 0) {
    reportError('WARN: git check-ignore failed on all batches — gitignore filtering disabled');
    return null;
  }

  return ignored;
}

export async function applyGitignoreAlignment(files, respectGitignore, options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  if (!respectGitignore || !existsSync(path.join(projectRoot, '.git'))) {
    return { files, gitignored: 0 };
  }

  const bypassGitignore = new Set();
  const candidates = [];
  for (const file of files) {
    if (isGitignoreAllowlistedAgenticPath(file)) {
      bypassGitignore.add(file);
    } else {
      candidates.push(file);
    }
  }

  const ignoredSet = await getGitIgnoredPathSet(candidates, { projectRoot, silent: options.silent });
  if (!ignoredSet) {
    return { files, gitignored: 0 };
  }

  const kept = [];
  let gitignored = 0;
  for (const file of files) {
    if (bypassGitignore.has(file)) {
      kept.push(file);
      continue;
    }

    const normalized = toPosixPath(file);
    if (ignoredSet.has(normalized)) {
      gitignored++;
      continue;
    }
    kept.push(file);
  }

  return { files: kept, gitignored };
}
