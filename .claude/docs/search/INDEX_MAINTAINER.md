# Index Maintainer Daemon - Technical Specification

> **Version:** 3.0
> **Last Updated:** 2026-01-02
> **Source:** `.claude/hooks/index-maintainer.mjs`

## Overview

The Index Maintainer Daemon is a persistent background process that automatically detects and indexes file changes from ALL sources (Claude Code edits, external IDE edits, git operations). It ensures the search index stays synchronized with the codebase without manual intervention.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    UserPromptSubmit Hook                             │
│  Triggers: session-preheat.sh (search + index-maintainer)           │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  index-maintainer.mjs (Daemon v3)                                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ QUEUE PROCESSING (Claude Code edits)                            │ │
│  │ • Polls queue every 30 seconds                                  │ │
│  │ • Legacy queue file (if present) is processed                    │ │
│  │ • Immediate indexing for files touched by Claude                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ MERKLE CHECK (All external changes)                             │ │
│  │ • Runs every 45 seconds                                         │ │
│  │ • Uses mtime/size fast-path (~0.1ms per unchanged file)         │ │
│  │ • Detects Cursor, VS Code, vim, git operations                  │ │
│  │ • Only reads content if metadata changed                        │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ FULL INCREMENTAL INDEX (On changes detected)                    │ │
│  │ • FTS5: DELETE old entries, INSERT new                          │ │
│  │ • HNSW: Remove old vectors, add new                             │ │
│  │ • Binary HNSW: Rebuild if >5% vectors changed                   │ │
│  │ • Code Graph: Full rebuild (~10s, FREE - regex only)            │ │
│  │ • HCGS: Regenerate for changed files                            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Configuration Constants

```javascript
// Timing intervals
const POLL_INTERVAL = 30000;          // Queue polling: 30 seconds
const MERKLE_CHECK_INTERVAL = 45000;  // Filesystem check: 45 seconds
const STARTUP_DELAY = 7000;           // Deferred first check: 7 seconds
const LOCK_REFRESH_INTERVAL = 30000;  // Lock refresh: 30 seconds
const LOCK_STALE_THRESHOLD = 300000;  // Lock stale detection: 5 minutes

// Indexing configuration
const INDEXING_TIMEOUT = 5 * 60 * 1000;  // 5 minutes (fail fast)
const STALE_PRUNE_DAYS = 30;             // Prune entries stale > 30 days

// File patterns
const INDEXABLE_EXTENSIONS = [
  '**/*.java', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs',
  '**/*.py', '**/*.go', '**/*.rs', '**/*.sql', '**/*.md',
  '**/*.yml', '**/*.yaml', '**/*.json', '**/*.xml', '**/*.properties',
  '**/*.html', '**/*.css', '**/*.scss', '**/*.proto'
];

const EXCLUDED_DIRS = [
  '**/node_modules/**', '**/target/**', '**/build/**',
  '**/dist/**', '**/.git/**', '**/.sweet-search/**'
];
```

## Lock Management

### Lock Files

All lock files are stored in `.sweet-search/` directory (not `/tmp`) for security:

| Lock File | Purpose | Format |
|-----------|---------|--------|
| `index-maintainer.lock` | Single daemon instance | `PID\nTIMESTAMP\n` |
| `indexing.lock` | Global index operation | `PID\nTIMESTAMP\n` |

### Security Invariant

```javascript
// SECURITY: All lock release functions MUST verify ownership before releasing.
// Pattern: read lock file → verify PID matches process.pid → then release
// This prevents Process A from accidentally releasing Process B's lock.
```

### Lock Acquisition Pattern

```javascript
function acquireLock() {
  const lockFile = path.join(DATA_DIR, 'index-maintainer.lock');

  try {
    // Try to create lock file exclusively
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Check if lock holder is still alive
      const existing = readLockFile();
      if (!existing) return false;

      // Stale after 5 minutes
      if (Date.now() - existing.timestamp > LOCK_STALE_THRESHOLD) {
        fs.unlinkSync(lockFile);
        return acquireLock(); // Retry
      }

      // Check if PID is alive
      try {
        process.kill(existing.pid, 0);
        return false; // Process alive, lock held
      } catch {
        fs.unlinkSync(lockFile);
        return acquireLock(); // Process dead, reclaim
      }
    }
    return false;
  }
}
```

### Lock Release with Ownership Verification

```javascript
function releaseLock() {
  try {
    const existing = readLockFile();
    if (existing && existing.pid === process.pid) {
      unlinkSync(LOCK_FILE);
    }
  } catch {
    // Ignore errors during cleanup
  }
}

function releaseGlobalIndexLock() {
  try {
    const content = readFileSync(GLOBAL_INDEX_LOCK, 'utf-8');
    const [pidStr] = content.trim().split('\n');
    const lockPid = parseInt(pidStr, 10);

    if (lockPid === process.pid) {
      unlinkSync(GLOBAL_INDEX_LOCK);
    } else {
      console.error(`Not releasing - owned by PID ${lockPid}, we are ${process.pid}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Error releasing global lock: ${err.message}`);
    }
  }
}
```

## Queue Processing

### Queue File Format

Queue file: `.sweet-search/index-maintainer-queue.jsonl`

```jsonl
{"type":"edit","file_path":"src/AuthService.java","timestamp":1735689600000}
{"type":"write","file_path":"src/NewFile.ts","timestamp":1735689601000}
{"type":"delete","file_path":"src/OldFile.java","timestamp":1735689602000}
```

### Safe Processing Pattern (Rename-Before-Read)

```javascript
async function processQueue({ dryRun = false } = {}) {
  const processingFile = QUEUE_FILE + '.processing';

  // CRITICAL: Rename FIRST, then read
  // This prevents entries appended between read and rename from being lost
  try {
    await fs.rename(QUEUE_FILE, processingFile);
  } catch (err) {
    if (err.code === 'ENOENT') return { processed: 0, failed: 0 };
    throw err;
  }

  // Now read the processing file (safe from new appends)
  const content = await fs.readFile(processingFile, 'utf-8');
  const entries = content.trim().split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  // Process entries...
  let processed = 0, failed = 0;
  for (const entry of entries) {
    try {
      await processEntry(entry, { dryRun });
      processed++;
    } catch (err) {
      failed++;
      // Requeue failed entry
      await appendToQueue(entry);
    }
  }

  // Delete processing file on success
  await fs.unlink(processingFile);

  return { processed, failed };
}
```

### Crash Recovery

```javascript
async function recoverProcessingFile() {
  const processingFile = QUEUE_FILE + '.processing';

  if (existsSync(processingFile)) {
    console.error('[index-maintainer] Recovering from previous crash');

    // Prepend processing file content to queue
    const processing = await fs.readFile(processingFile, 'utf-8');
    const queue = existsSync(QUEUE_FILE)
      ? await fs.readFile(QUEUE_FILE, 'utf-8')
      : '';

    await fs.writeFile(QUEUE_FILE, processing + queue);
    await fs.unlink(processingFile);
  }
}
```

## Merkle State Change Detection

### How It Works

```javascript
async function performMerkleCheck() {
  // 1. Discover all indexable files
  const allFiles = await glob(INDEXABLE_EXTENSIONS, {
    ignore: EXCLUDED_DIRS,
    nodir: true,
    absolute: false,
  });

  // 2. Use incremental tracker for change detection
  // Fast-path: Check (mtime, size) first (~0.1ms per file)
  // Only read content if metadata changed
  const { toIndex, toRemove, currentHashes, fastPathStats } =
    await getChangedFiles(allFiles, PROJECT_ROOT);

  return {
    toIndex,      // Files to add/update
    toRemove,     // Files to mark stale
    currentHashes,// New state to save
    stats: {
      totalFiles: allFiles.length,
      fastPathHits: fastPathStats.hits,
      fastPathMisses: fastPathStats.misses,
    },
  };
}
```

### Fast-Path Optimization

The merkle check uses a two-tier optimization:

1. **Stat check** (~0.1ms): Compare `(mtime_ns, size)` with cached values
2. **Content hash** (~1ms): Only computed if stat check fails

```javascript
// From incremental-tracker.js
async function fastPathCheck(filePath, cachedEntry) {
  const stats = await fs.stat(filePath, { bigint: true });

  // Fast-path: If size and mtime match, file unchanged
  if (cachedEntry &&
      cachedEntry.size === stats.size.toString() &&
      cachedEntry.mtime_ns === stats.mtimeNs.toString()) {
    return { changed: false, fastPath: true };
  }

  // Need to hash content
  const content = await fs.readFile(filePath);
  const hash = crypto.createHash('sha256')
    .update(content)
    .digest('hex')
    .slice(0, 16);

  return {
    changed: hash !== cachedEntry?.hash,
    fastPath: false,
    hash,
    size: stats.size.toString(),
    mtime_ns: stats.mtimeNs.toString(),
  };
}
```

## Full Incremental Indexing

### Index Invocation

```javascript
async function runFullIncrementalIndex(toIndex, currentHashes) {
  if (toIndex.length === 0) return { success: true };

  // Prepare file list for indexer
  const fileList = toIndex.join('\n');

  const result = await new Promise((resolve) => {
    const child = spawn('node', [
      INDEXER_PATH,
      '--files-from-stdin',
      '--quiet'
      // NOTE: Default mode is incremental for vectors
      // Code graph is ALWAYS full rebuilt (relationships span files)
      // HCGS auto-triggers for changed files with --files-from-stdin
    ], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write file list to stdin
    child.stdin.write(fileList);
    child.stdin.end();

    // 5-minute timeout (fail fast)
    setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGTERM');
        resolve({ success: false, error: 'Timeout' });
      }
    }, INDEXING_TIMEOUT);

    child.on('close', (code) => {
      resolve({ success: code === 0 });
    });
  });

  if (result.success) {
    // Update merkle state
    await updateState(currentHashes, { totalChunks: toIndex.length });
  }

  return result;
}
```

### What Gets Updated

| Component | Strategy | Notes |
|-----------|----------|-------|
| FTS5 (lexical) | DELETE + INSERT | Per-file atomic |
| HNSW vectors | Incremental | Changed files only |
| Binary HNSW | Rebuild threshold | >5% vectors changed |
| Code graph | Full rebuild | ~10s, FREE (regex) |
| HCGS | Regenerate | Changed files only |

## Soft Delete for Removed Files

### Mark as Stale

```javascript
async function markFilesAsStale(files) {
  if (files.length === 0) return;

  const db = new Database(DB_PATHS.codeGraph);

  for (const filePath of files) {
    db.prepare(`
      UPDATE entities
      SET stale_since = unixepoch()
      WHERE file_path = ?
    `).run(filePath);
  }

  db.close();
}
```

### Prune Old Stale Entries

```javascript
async function pruneStaleEntries(maxAgeDays) {
  const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 24 * 60 * 60);

  const db = new Database(DB_PATHS.codeGraph);

  // Get file paths of entries to prune
  const toPrune = db.prepare(`
    SELECT DISTINCT file_path
    FROM entities
    WHERE stale_since IS NOT NULL AND stale_since < ?
  `).all(cutoff);

  // Delete from entities
  db.prepare(`
    DELETE FROM entities
    WHERE stale_since IS NOT NULL AND stale_since < ?
  `).run(cutoff);

  // Also clean up vectors for those files
  const vectorDb = new Database(DB_PATHS.codebase);
  for (const { file_path } of toPrune) {
    vectorDb.prepare(`
      DELETE FROM vectors
      WHERE json_extract(metadata, '$.file') = ?
    `).run(file_path);
  }

  db.close();
  vectorDb.close();
}
```

### Search Query Filter

All search queries exclude stale entries:

```sql
SELECT * FROM entities
WHERE ...
  AND stale_since IS NULL  -- Exclude stale entries
ORDER BY ...
```

## Error Handling

### ENOSPC (Disk Full) Pattern

```javascript
async function safeWriteFile(filePath, content) {
  const tempPath = `${filePath}.tmp.${process.pid}`;

  try {
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    // Always try to clean up temp file
    try { await fs.unlink(tempPath); } catch {}

    if (err.code === 'ENOSPC') {
      throw new Error(`CRITICAL: Disk full, cannot write to ${filePath}`);
    }
    throw err;
  }
}
```

### Queue Append Error Handling

```javascript
function appendToQueue(entry) {
  try {
    appendFileSync(QUEUE_FILE, JSON.stringify(entry) + '\n');
    return true;
  } catch (err) {
    if (err.code === 'ENOSPC') {
      console.error('[index-maintainer] CRITICAL: Disk full, cannot append');
      console.error(`[index-maintainer] Dropped entry: ${JSON.stringify(entry)}`);
      return false;
    }
    throw err;
  }
}
```

## Main Loop

```javascript
async function main() {
  const runOnce = process.argv.includes('--once');

  console.error('[index-maintainer] Starting v3...');

  // Acquire daemon lock
  if (!runOnce && !acquireLock()) {
    console.error('[index-maintainer] Another instance running, exiting.');
    process.exit(0);
  }

  // Recover from previous crash
  await recoverProcessingFile();

  // DEFERRED FIRST CHECK (7s delay) - ZERO STARTUP LATENCY
  setTimeout(async () => {
    if (shutdownRequested) return;
    await runMerkleCheckAndIndex();
  }, STARTUP_DELAY);

  // Graceful shutdown handlers
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('exit', () => releaseLock());

  // Lock refresh interval
  const lockRefreshInterval = setInterval(() => {
    if (!shutdownRequested) {
      if (!refreshLock()) {
        console.error('[index-maintainer] Lost lock, initiating shutdown');
        process.exit(1);
      }
    }
  }, LOCK_REFRESH_INTERVAL);

  let lastMerkleCheck = Date.now();

  // Main loop
  while (!shutdownRequested) {
    const now = Date.now();

    // Periodic merkle check every 45 seconds
    if (now - lastMerkleCheck >= MERKLE_CHECK_INTERVAL) {
      lastMerkleCheck = now;
      await runMerkleCheckAndIndex();
    }

    // Also process legacy queue (Claude Code edits)
    const { files } = peekQueue();
    if (files.size > 0) {
      await processQueue();
    }

    // Short sleep between iterations
    await new Promise(r => setTimeout(r, 5000));
  }

  clearInterval(lockRefreshInterval);
  console.error('[index-maintainer] Shutdown complete');
}
```

## CLI Options

```bash
node .claude/hooks/index-maintainer.mjs [options]
```

| Option | Description |
|--------|-------------|
| `--once` | Run one check and exit (no daemon) |
| `--dry-run` | Show what would be indexed |
| `--verbose` | Enable verbose logging |

## Startup via Preheat

The daemon is started via `session-preheat.sh`:

```bash
# .claude/helpers/session-preheat.sh
start_index_maintainer() {
  local maintainer="$PROJECT_ROOT/.claude/hooks/index-maintainer.mjs"
  local lock_file="$PROJECT_ROOT/.sweet-search/index-maintainer.lock"

  # Check if already running
  if [ -f "$lock_file" ]; then
    local lock_pid=$(head -n1 "$lock_file" 2>/dev/null)
    if kill -0 "$lock_pid" 2>/dev/null; then
      echo "Index maintainer already running (PID: $lock_pid)"
      return 0
    fi
  fi

  node "$maintainer" >> "$LOG_FILE" 2>&1 &
  echo $! > /tmp/index-maintainer.pid
}

# Start after search infrastructure
start_index_maintainer &
```

## Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Merkle check (500 files) | ~50ms | 98% fast-path hits |
| Merkle check (5000 files) | ~500ms | Large monorepo |
| Queue processing | ~10ms | Per entry |
| Full incremental index (10 files) | 10-30s | FTS5 + vectors + graph |
| Lock acquire | ~1ms | File system |
| Lock refresh | ~1ms | Every 30s |

## Troubleshooting

### Daemon Not Starting

```bash
# Check for existing lock
cat .sweet-search/index-maintainer.lock

# Check if PID is alive
kill -0 <PID> 2>/dev/null && echo "Running" || echo "Dead"

# Remove stale lock
rm .sweet-search/index-maintainer.lock

# Start manually
node .claude/hooks/index-maintainer.mjs --verbose
```

### Changes Not Detected

```bash
# Run manual merkle check
node .claude/hooks/index-maintainer.mjs --once --verbose

# Check merkle state
cat .sweet-search/merkle-state.json | jq '.stats'

# Force full reindex
/index-codebase --full
```

### Lock Contention

```bash
# Check global index lock
cat .sweet-search/indexing.lock

# If stuck, verify ownership and remove
rm .sweet-search/indexing.lock
```
