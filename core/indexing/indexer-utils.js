/**
 * Indexer Utilities - SQLite config, logging, atomic swap, WSL paths, gitignore, file discovery.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import fg from 'fast-glob';

import { PROJECT_ROOT, setQuietMode as setGlobalQuietMode } from '../infrastructure/config/index.js';
import { createAdmissionPolicy } from './admission-policy.js';

// `.gitignore` alignment now lives in gitignore-filter.js (shared with the
// incremental admission policy). Re-exported here so existing
// `import { ... } from indexer-utils` / barrel call sites keep working.
export {
  toPosixPath,
  isGitignoreAllowlistedAgenticPath,
  getGitIgnoredPathSet,
  applyGitignoreAlignment,
} from './gitignore-filter.js';

const glob = fg.glob || fg;

// =============================================================================
// P0: SQLITE WRITE OPTIMIZATION (WAL Mode + Batch Insert Chunking)
// =============================================================================

export function isWalSafe(dbPath) {
  // WSL + NTFS mount: WAL is unreliable due to lack of proper file locking
  if (process.env.WSL_DISTRO_NAME && dbPath && /^\/mnt\/[a-zA-Z]\//.test(dbPath)) return false;
  // WAL works on Linux, macOS (APFS/HFS+), and most modern filesystems.
  // Only known-bad: WSL/NTFS mounts and network filesystems.
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
    // Indexing-optimized: larger WAL before auto-checkpoint (~16 MB vs default ~4 MB)
    db.pragma('wal_autocheckpoint = 4000');
    // 1 GB mmap for reads during build, 64 MB page cache
    db.pragma('mmap_size = 1073741824');
    db.pragma('cache_size = -64000');
    // Cap WAL file growth at 64 MB
    db.pragma('journal_size_limit = 67108864');
    return 'WAL';
  }

  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = NORMAL');
  return 'DELETE';
}

/**
 * Force WAL checkpoint and truncate. Call after all inserts complete
 * and before long-running read transactions (e.g., HNSW build streaming).
 */
export function checkpointWal(db) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (_err) {
    // Not in WAL mode or checkpoint not possible — safe to ignore
  }
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
let verboseMode = false;

export function setQuietMode(enabled) {
  quietMode = enabled;
  setGlobalQuietMode(enabled);
}

export function isQuietMode() {
  return quietMode;
}

export function setVerboseMode(enabled) {
  verboseMode = enabled;
}

export function isVerboseMode() {
  return verboseMode;
}

// ---------------------------------------------------------------------------
// Progress rendering — an in-place "sticky" bar that animates as a phase runs.
//
// On a TTY (verbose or not) the bar redraws on a single line via carriage return
// + erase-to-EOL, with smooth 1/8-block fill. While a bar is active, log() pins it:
// it clears the bar, prints the log line above, then redraws the bar below — so
// interleaved diagnostics (e.g. the HNSW "checkpoint:" line) never split the bar.
// Non-TTY (pipes / CI) falls back to throttled newlines so nothing is swallowed.
// ---------------------------------------------------------------------------
const BAR_WIDTH = 30;
const LABEL_COL = 17;           // pad "Label:" to this width so every bar's [ ] aligns
const SUB_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']; // eighth-block partial fills
const CLEAR_EOL = '\x1b[K';
let activeBar = null;           // last-rendered bar string while a phase is in progress (TTY only)
let lastLoggedPercent = {};

function renderBar(current, total, label) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 1;
  const eighths = Math.round(ratio * BAR_WIDTH * 8);
  const full = Math.floor(eighths / 8);
  const partial = SUB_BLOCKS[eighths % 8];
  const bar = '█'.repeat(full) + partial;
  const empty = '░'.repeat(Math.max(0, BAR_WIDTH - full - (partial ? 1 : 0)));
  const head = `${label}:`.padEnd(LABEL_COL);            // right border aligns across phases
  const pct = (ratio * 100).toFixed(1).padStart(5);
  return `${colors.cyan}${head}[${bar}${empty}] ${pct}% (${current}/${total})${colors.reset}`;
}

export function log(message, color = 'reset') {
  if (quietMode) return;
  const line = `${colors[color]}${message}${colors.reset}`;
  if (activeBar && process.stdout.isTTY) {
    // Pin the bar: clear it, print the log line above, redraw the bar below.
    process.stdout.write(`\r${CLEAR_EOL}${line}\n${activeBar}${CLEAR_EOL}`);
  } else {
    console.log(line);
  }
}

export function logProgress(current, total, label) {
  if (quietMode) return;
  if (!process.stdout.isTTY) {
    // Pipes / CI: throttle to ~2% and emit newlines so output isn't swallowed.
    const percentNum = total > 0 ? (current / total) * 100 : 100;
    const lastPct = lastLoggedPercent[label] || 0;
    if (percentNum - lastPct >= 2 || current >= total || current <= 1) {
      lastLoggedPercent[label] = percentNum;
      console.log(renderBar(current, total, label));
    }
    return;
  }
  // Interactive TTY: animate the bar in place.
  activeBar = renderBar(current, total, label);
  process.stdout.write(`\r${activeBar}${CLEAR_EOL}`);
  if (current >= total) {
    process.stdout.write('\n');
    activeBar = null;
    lastLoggedPercent[label] = 0;
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
// FILE DISCOVERY
// =============================================================================

export async function discoverFiles(options = {}) {
  const {
    projectRoot = PROJECT_ROOT,
    silent = false,
  } = options;

  const writeLog = silent ? () => {} : log;

  writeLog('\n━━━ Discovering Files ━━━', 'bright');

  // Single shared admission policy — the same include allowlist / deny-list /
  // `.sweet-search-ignore` / `.gitignore` / size gates the incremental
  // maintainer uses, so a fresh full index and an incrementally-maintained
  // index admit exactly the same files.
  const policy = createAdmissionPolicy({ projectRoot });
  const maxFileSize = policy.maxFileSize;

  // Enumerate via the include globs (with the exclude globs pruning big dirs
  // during traversal), then apply the policy's shape gate so `.sweet-search-ignore`
  // is honoured here too — the one rule full discovery did not previously apply.
  const discovered = await glob(policy.includeGlobs, {
    ignore: policy.excludeGlobs,
    cwd: projectRoot,
    absolute: false,
    onlyFiles: true,
    dot: true,
  });
  const shaped = discovered.filter((rel) => policy.admitsShape(rel));

  const { files: allFiles, gitignored } = await policy.applyGitignore(shaped, { silent });

  const files = [];
  let oversized = 0;
  for (const file of allFiles) {
    try {
      const stat = await fs.stat(path.join(projectRoot, file));
      if (stat.size > maxFileSize) {
        oversized++;
      } else {
        files.push(file);
      }
    } catch {
      // File disappeared between glob and stat
    }
  }

  writeLog(`✓ Found ${files.length} files to index`, 'green');
  if (gitignored > 0) {
    writeLog(`  Skipped ${gitignored} files via .gitignore alignment`, 'yellow');
  }
  if (oversized > 0) {
    writeLog(`  Skipped ${oversized} files exceeding ${(maxFileSize / 1024 / 1024).toFixed(1)} MB size limit`, 'yellow');
  }

  const byType = {};
  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || '.other';
    byType[ext] = (byType[ext] || 0) + 1;
  }

  writeLog('  File types: ' + Object.entries(byType).map(([ext, count]) => `${ext}(${count})`).join(', '), 'dim');

  return files;
}
