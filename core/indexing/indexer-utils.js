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
// Progress rendering — a live region of animated, in-place bars.
//
// On a TTY (verbose included), each phase's bar animates in place via cursor
// moves + erase-to-EOL, with smooth 1/8-block fill. Multiple bars can run at
// once (e.g. Embedding + Late Interaction in parallel) — they share one pinned
// region at the bottom and update independently. While bars are live, log()
// prints its line above the region and redraws the bars below, so diagnostics
// never split a bar. The region "commits" (stays on screen) once every bar in
// it has reached 100%. Non-TTY (pipes / CI) falls back to throttled newlines.
// ---------------------------------------------------------------------------
const BAR_WIDTH = 30;
const LABEL_COL = 17;           // pad "Label:" to this width so every bar's [ ] aligns
const SUB_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']; // eighth-block partial fills
const liveBars = new Map();     // label -> { current, total }; insertion order = display order
let regionLines = 0;            // bar lines currently pinned at the bottom (TTY)
let lastLoggedPercent = {};
let deferredLogs = [];          // lines held back while parallel bars run (flushed on commit)

function renderBar(current, total, label) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 1;
  const head = `${label}:`.padEnd(LABEL_COL);            // right border aligns across phases
  const pct = (ratio * 100).toFixed(1).padStart(5);
  const prefix = `${head}[`;
  // Size the bar so the whole line fits the terminal width — a wrapped line would
  // span two physical rows and break the cursor-up redraw math (→ duplicate bars).
  // Drop the (current/total) counts first when the terminal is too cramped.
  const cols = process.stdout.columns || 80;
  let suffix = `] ${pct}% (${current}/${total})`;
  if (cols - prefix.length - suffix.length - 1 < 6) suffix = `] ${pct}%`;
  const width = Math.max(1, Math.min(BAR_WIDTH, cols - prefix.length - suffix.length - 1));
  const eighths = Math.round(ratio * width * 8);
  const full = Math.floor(eighths / 8);
  const partial = SUB_BLOCKS[eighths % 8];
  const bar = '█'.repeat(full) + partial;
  const empty = '░'.repeat(Math.max(0, width - full - (partial ? 1 : 0)));
  return `${colors.cyan}${prefix}${bar}${empty}${suffix}${colors.reset}`;
}

// (Re)draw the live region in place (the `log-update` pattern). Invariant: the
// cursor enters and leaves at the END of the last bar line — NO trailing newline
// — so a redraw never pushes a stale copy of a bar into scrollback. Each redraw
// moves up to the first region line and erases to end-of-screen (\x1b[J) before
// rewriting. `aboveLine`, if given, scrolls one permanent line above the bars.
function regionEscape(aboveLine) {
  const bars = [...liveBars].map(([l, b]) => renderBar(b.current, b.total, l));
  let out = '';
  if (regionLines > 1) out += `\x1b[${regionLines - 1}A`; // up to the first region line
  out += '\r\x1b[J';                                       // col 0, erase region + everything below
  if (aboveLine != null) out += aboveLine + '\n';          // permanent line above the bars
  out += bars.join('\n');                                   // bars — no trailing newline
  regionLines = bars.length;
  return out;
}

export function log(message, color = 'reset') {
  if (quietMode) return;
  const line = `${colors[color]}${message}${colors.reset}`;
  if (regionLines > 0 && process.stdout.isTTY) {
    if (liveBars.size > 1) {
      // Parallel bars live: defer the line so it can't disturb the region. Any
      // mid-region print scrolls a stale bar-pair into scrollback. Flushed once
      // every bar in the region finishes.
      deferredLogs.push(line);
      return;
    }
    process.stdout.write(regionEscape(line)); // single bar: line above, bar redrawn below
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
  // Interactive TTY: update this bar in the live region and redraw in place.
  liveBars.set(label, { current, total });
  process.stdout.write(regionEscape());
  // Once every live bar is complete, commit the region (leave it on screen).
  let allDone = true;
  for (const b of liveBars.values()) if (b.current < b.total) { allDone = false; break; }
  if (allDone) {
    process.stdout.write('\n');             // move below the finished bars (cursor was at their end)
    for (const k of liveBars.keys()) lastLoggedPercent[k] = 0;
    liveBars.clear();
    regionLines = 0;
    // Flush lines deferred while parallel bars ran — now below the finished bars.
    if (deferredLogs.length) {
      for (const l of deferredLogs) console.log(l);
      deferredLogs = [];
    }
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
  // Stat in batches (order-preserving) instead of one serialized await per
  // file; results are consumed in the original allFiles order.
  const STAT_BATCH = 200;
  for (let i = 0; i < allFiles.length; i += STAT_BATCH) {
    const batch = allFiles.slice(i, i + STAT_BATCH);
    const stats = await Promise.all(
      batch.map((file) => fs.stat(path.join(projectRoot, file)).catch(() => null)),
    );
    for (let j = 0; j < batch.length; j++) {
      const stat = stats[j];
      if (!stat) continue; // File disappeared between glob and stat
      if (stat.size > maxFileSize) {
        oversized++;
      } else {
        files.push(batch[j]);
      }
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

// =============================================================================
// STREAMING-VECTORS GATE
// =============================================================================

/**
 * Sum on-disk sizes of `files` (relative to `projectRoot`), stopping as soon
 * as the running total crosses `stopAt`. The streaming gate only needs to
 * know whether the total crosses the threshold, not the exact figure, so on
 * large-byte repos this exits after a fraction of the stats.
 */
export async function sumFileSizesUpTo(files, stopAt, projectRoot = PROJECT_ROOT) {
  let total = 0;
  for (const file of files) {
    try {
      const stat = await fs.stat(path.isAbsolute(file) ? file : path.join(projectRoot, file));
      total += stat.size;
      if (total >= stopAt) return total;
    } catch {
      // File disappeared between discovery and this gate — skip it.
    }
  }
  return total;
}

/**
 * Decide whether a full rebuild should take the bounded-memory streaming
 * vectors path (see streaming-vectors.js) instead of the in-memory path.
 *
 * Two independent triggers, either is sufficient:
 *   - file count ≥ SWEET_SEARCH_STREAM_MIN_FILES (default 5000)
 *   - total admitted source bytes ≥ SWEET_SEARCH_STREAM_MIN_BYTES
 *     (default 512 MB; set to 0 to disable the byte trigger)
 *
 * The byte trigger exists because peak heap on the in-memory path scales
 * with the chunk corpus (≈ source bytes), not file count: a repo with
 * few-but-huge files (amalgamations, vendored/generated blobs, extreme
 * duplication) can OOM the default ~4 GB heap while staying far under the
 * file gate.
 *
 * The 512 MB default is deliberately conservative so the trigger only fires
 * where the in-memory path would fail outright, never where it would merely
 * be tight. The one MEASURED failure at this scale is libsql (596 MB
 * admitted source; the in-memory path needed a 9.6+ GB heap); the wider
 * crash zone is ESTIMATED — not measured — to start around ~200 MB of
 * admitted source on a default ~4 GB heap. A repo the byte trigger newly
 * moves to streaming was therefore not getting a usable in-memory index at
 * all, so streaming strictly improves on a crash; every repo below the
 * threshold keeps the byte-for-byte-identical in-memory path and identical
 * retrieval behaviour.
 *
 * Sizes are only stat'd when the (free) count trigger hasn't already fired,
 * so the byte check costs at most one stat per file on sub-threshold repos.
 * The re-stat duplicates work discoverFiles already did for its size cap —
 * accepted deliberately: threading sizes through would change discoverFiles'
 * public return shape, and ≤5000 extra stats on a full rebuild is noise next
 * to chunking + embedding.
 *
 * @returns {Promise<{useStreaming: boolean, reason?: 'files'|'bytes', totalBytes?: number, thresholdBytes?: number}>}
 */
export async function shouldStreamVectors({ filesToIndex, dryRun, fullReindex, projectRoot = PROJECT_ROOT, env = process.env }) {
  if (dryRun || !fullReindex || env.SWEET_SEARCH_STREAM_VECTORS === '0') {
    return { useStreaming: false };
  }
  const streamMinFiles = Number(env.SWEET_SEARCH_STREAM_MIN_FILES) || 5000;
  if (filesToIndex.length >= streamMinFiles) {
    return { useStreaming: true, reason: 'files' };
  }
  // Unset/empty/invalid → 512 MB default; an explicit 0 (or negative)
  // disables the byte trigger alone, leaving the count trigger active.
  const rawMinBytes = env.SWEET_SEARCH_STREAM_MIN_BYTES;
  const parsedMinBytes = (rawMinBytes === undefined || rawMinBytes === '') ? NaN : Number(rawMinBytes);
  const streamMinBytes = Number.isFinite(parsedMinBytes)
    ? (parsedMinBytes > 0 ? parsedMinBytes : Infinity)
    : 512 * 1024 * 1024;
  if (!Number.isFinite(streamMinBytes)) {
    return { useStreaming: false };
  }
  const totalBytes = await sumFileSizesUpTo(filesToIndex, streamMinBytes, projectRoot);
  if (totalBytes >= streamMinBytes) {
    return { useStreaming: true, reason: 'bytes', totalBytes, thresholdBytes: streamMinBytes };
  }
  return { useStreaming: false };
}
