/**
 * Indexer Utilities - SQLite config, logging, atomic swap, WSL paths, gitignore, file discovery.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import fg from 'fast-glob';

import { PROJECT_ROOT, setQuietMode as setGlobalQuietMode, loadProjectConfig, AGENTIC_GITIGNORE_ALLOWLIST } from './config.js';

const glob = fg.glob || fg;

// =============================================================================
// P0: SQLITE WRITE OPTIMIZATION (WAL Mode + Batch Insert Chunking)
// =============================================================================

export function isWalSafe(dbPath) {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME && dbPath && /^\/mnt\/[a-zA-Z]\//.test(dbPath)) return false;
  return true;
}

export function configureJournalMode(db, dbPath, sqliteFastMode) {
  if (sqliteFastMode) {
    db.pragma('synchronous = OFF');
    db.pragma('journal_mode = MEMORY');
    db.pragma('cache_size = -64000');
    return 'MEMORY';
  }

  if (isWalSafe(dbPath)) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('wal_autocheckpoint = 1000');
    return 'WAL';
  }

  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = NORMAL');
  return 'DELETE';
}

// =============================================================================
// COLORS AND LOGGING (quiet-mode aware)
// =============================================================================

export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

let quietMode = false;

export function setQuietMode(enabled) {
  quietMode = enabled;
  setGlobalQuietMode(enabled);
}

export function isQuietMode() {
  return quietMode;
}

export function log(message, color = 'reset') {
  if (quietMode) return;
  console.log(`${colors[color]}${message}${colors.reset}`);
}

export function logProgress(current, total, label) {
  if (quietMode) return;
  const percent = ((current / total) * 100).toFixed(1);
  const bar = '█'.repeat(Math.floor(current / total * 30));
  const empty = '░'.repeat(30 - bar.length);
  process.stdout.write(`\r${colors.cyan}${label}: [${bar}${empty}] ${percent}% (${current}/${total})${colors.reset}`);
  if (current === total) {
    process.stdout.write('\n');
  }
}

export function logError(message) {
  console.error(`[indexer] ${message}`);
}

// =============================================================================
// ATOMIC DATABASE SWAP (Windows/WSL EBUSY Handling)
// =============================================================================

export async function atomicSwapDatabase(tmpPath, finalPath) {
  const bakPath = finalPath + '.bak';
  const MAX_RETRIES = 5;
  const RETRY_DELAY = 500;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      try {
        await fs.unlink(bakPath);
      } catch (err) {
        // No stale backup
      }

      let hadOriginal = false;
      if (existsSync(finalPath)) {
        await fs.rename(finalPath, bakPath);
        hadOriginal = true;
      }

      await fs.rename(tmpPath, finalPath);

      if (hadOriginal) {
        try {
          await fs.unlink(bakPath);
        } catch (err) {
          if (err.code !== 'ENOENT') {
            logError(`WARN: Failed to clean up backup ${bakPath}: ${err.message}`);
          }
        }
      }

      return true;
    } catch (err) {
      if (err.code === 'EBUSY' && attempt < MAX_RETRIES - 1) {
        logError(`Database busy, retry ${attempt + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
        continue;
      }

      if (existsSync(bakPath) && !existsSync(finalPath)) {
        try {
          await fs.rename(bakPath, finalPath);
          log(`⚠ Swap failed, restored from backup: ${err.message}`, 'yellow');
        } catch (restoreErr) {
          logError(`CRITICAL: Swap failed AND restore failed: ${restoreErr.message}`);
        }
      }
      throw err;
    }
  }
  return false;
}

// =============================================================================
// STDIN FILE LIST READING (for --files-from-stdin)
// =============================================================================

export const WSL_UNC_PATTERN = /^\/\/wsl(?:\.localhost|\$)\/[^/]+/;

export function stripWslUncPrefix(filePath) {
  if (!filePath) return filePath;
  let normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(WSL_UNC_PATTERN);
  if (match) {
    return normalized.slice(match[0].length);
  }
  return filePath;
}

export function toPosixPath(filePath) {
  return filePath.replace(/\\/g, '/');
}

export async function readFilesFromStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    const timeout = setTimeout(() => {
      if (process.stdin.isTTY) {
        resolve([]);
      }
    }, 100);

    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (chunk) => {
      clearTimeout(timeout);
      data += chunk;
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);

      const lines = data
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      const validPaths = [];
      const seenPaths = new Set();

      for (let line of lines) {
        line = stripWslUncPrefix(line);
        let normalizedPath = line;

        if (path.isAbsolute(line)) {
          if (line.startsWith(PROJECT_ROOT)) {
            normalizedPath = path.relative(PROJECT_ROOT, line);
          } else {
            if (!quietMode) {
              logError(`Skipping path outside project: ${line}`);
            }
            continue;
          }
        }

        if (normalizedPath.startsWith('./')) {
          normalizedPath = normalizedPath.slice(2);
        }

        if (seenPaths.has(normalizedPath)) {
          continue;
        }
        seenPaths.add(normalizedPath);

        validPaths.push(normalizedPath);
      }

      resolve(validPaths);
    });

    process.stdin.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    if (process.stdin.isTTY) {
      clearTimeout(timeout);
      resolve([]);
    }
  });
}

// =============================================================================
// GITIGNORE ALIGNMENT
// =============================================================================

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

export async function getGitIgnoredPathSet(paths) {
  if (paths.length === 0) {
    return new Set();
  }

  return await new Promise((resolve) => {
    const ignoredChunks = [];
    const errorChunks = [];
    let settled = false;

    const git = spawn('git', ['check-ignore', '-z', '--stdin'], { cwd: PROJECT_ROOT });

    git.stdout.on('data', chunk => ignoredChunks.push(chunk));
    git.stderr.on('data', chunk => errorChunks.push(chunk));

    git.on('error', (err) => {
      if (settled) return;
      settled = true;
      logError(`WARN: Unable to run git check-ignore (${err.message})`);
      resolve(null);
    });

    git.on('close', (code) => {
      if (settled) return;
      settled = true;

      if (code !== 0 && code !== 1) {
        const stderr = Buffer.concat(errorChunks).toString('utf8').trim();
        logError(`WARN: git check-ignore failed${stderr ? `: ${stderr}` : ''}`);
        resolve(null);
        return;
      }

      const ignored = new Set(
        Buffer.concat(ignoredChunks)
          .toString('utf8')
          .split('\0')
          .filter(Boolean)
          .map(toPosixPath)
      );

      resolve(ignored);
    });

    const stdinPayload = `${paths.map(toPosixPath).join('\0')}\0`;
    git.stdin.end(stdinPayload);
  });
}

export async function applyGitignoreAlignment(files, respectGitignore) {
  if (!respectGitignore || !existsSync(path.join(PROJECT_ROOT, '.gitignore')) || !existsSync(path.join(PROJECT_ROOT, '.git'))) {
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

  const ignoredSet = await getGitIgnoredPathSet(candidates);
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

// =============================================================================
// FILE DISCOVERY
// =============================================================================

export async function discoverFiles() {
  log('\n━━━ Discovering Files ━━━', 'bright');

  const projectConfig = loadProjectConfig(PROJECT_ROOT);
  const respectGitignore = projectConfig.respectGitignore !== false;
  const maxFileSize = projectConfig.maxFileSize || (1 * 1024 * 1024);

  const discovered = await glob(projectConfig.include, {
    ignore: projectConfig.exclude,
    cwd: PROJECT_ROOT,
    absolute: false,
    onlyFiles: true,
    dot: true,
  });

  const { files: allFiles, gitignored } = await applyGitignoreAlignment(discovered, respectGitignore);

  const files = [];
  let oversized = 0;
  for (const file of allFiles) {
    try {
      const stat = await fs.stat(path.join(PROJECT_ROOT, file));
      if (stat.size > maxFileSize) {
        oversized++;
      } else {
        files.push(file);
      }
    } catch {
      // File disappeared between glob and stat
    }
  }

  log(`✓ Found ${files.length} files to index`, 'green');
  if (gitignored > 0) {
    log(`  Skipped ${gitignored} files via .gitignore alignment`, 'yellow');
  }
  if (oversized > 0) {
    log(`  Skipped ${oversized} files exceeding ${(maxFileSize / 1024 / 1024).toFixed(1)} MB size limit`, 'yellow');
  }

  const byType = {};
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || '.other';
    byType[ext] = (byType[ext] || 0) + 1;
  }

  log('  File types: ' + Object.entries(byType).map(([ext, count]) => `${ext}(${count})`).join(', '), 'dim');

  return files;
}
