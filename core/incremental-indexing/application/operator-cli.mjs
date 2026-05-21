import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readManifest } from '../infrastructure/manifest.mjs';
import { canonicaliseInsideRoot } from '../infrastructure/dirty-set.mjs';
import { contentHashSync } from '../infrastructure/hashing.mjs';
import {
  reconcileEnablement,
  startupInterval,
  tierForHardware,
} from '../domain/interval-autotune.mjs';
import { detectHardwareCapability } from '../../infrastructure/hardware-capability.js';
import {
  DEAD_LETTER_FILENAME,
  QUEUE_FILENAME,
  enqueueMaintenanceJob,
  readMaintenanceQueue,
} from './maintenance-worker.mjs';

const MAINTAINER_LOCK = 'index-maintainer.lock';

const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';
const PROCESSING_QUEUE = 'index-maintainer-queue.processing.jsonl';
const METRICS_FILE = 'reconcile-metrics.jsonl';
const MERKLE_STATE = 'merkle-state.json';
const PAUSE_FILE = 'reconcile-pause.json';

const REBUILD_TIERS = new Map([
  ['hnsw', 'float_hnsw'],
  ['float_hnsw', 'float_hnsw'],
  ['float-hnsw', 'float_hnsw'],
  ['binary_hnsw', 'binary_hnsw'],
  ['binary-hnsw', 'binary_hnsw'],
  ['li', 'li_segment'],
  ['li_segment', 'li_segment'],
  ['li-segment', 'li_segment'],
  ['sparse', 'sparse_gram'],
  ['sparse_gram', 'sparse_gram'],
  ['sparse-gram', 'sparse_gram'],
  ['fts5', 'fts5'],
]);

function parseOptions(args) {
  const positional = [];
  const opts = { json: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--project-root') {
      opts.projectRoot = args[++i];
    } else if (arg.startsWith('--project-root=')) {
      opts.projectRoot = arg.slice('--project-root='.length);
    } else if (arg === '--state-dir') {
      opts.stateDir = args[++i];
    } else if (arg.startsWith('--state-dir=')) {
      opts.stateDir = arg.slice('--state-dir='.length);
    } else if (arg === '--add') {
      opts.add = args[++i];
    } else if (arg.startsWith('--add=')) {
      opts.add = arg.slice('--add='.length);
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

function context(opts) {
  const requestedProjectRoot = path.resolve(
    opts.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd(),
  );
  const projectRoot = fs.existsSync(requestedProjectRoot)
    ? fs.realpathSync.native(requestedProjectRoot)
    : requestedProjectRoot;
  const stateDir = path.resolve(
    opts.stateDir || process.env.SWEET_SEARCH_STATE_DIR || path.join(projectRoot, '.sweet-search'),
  );
  return { projectRoot, stateDir };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return { items: [], malformed: 0 };
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter((line) => line.trim());
  const items = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      items.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  return { items, malformed };
}

function lastJsonl(filePath, n = 5) {
  const { items } = readJsonl(filePath);
  return items.slice(-n);
}

function dirtySnapshot(stateDir) {
  const pending = readJsonl(path.join(stateDir, DIRTY_QUEUE));
  const processing = readJsonl(path.join(stateDir, PROCESSING_QUEUE));
  return {
    pending: pending.items.length,
    processing: processing.items.length,
    malformed: pending.malformed + processing.malformed,
    entries: [...pending.items, ...processing.items],
  };
}

function deadLetterSnapshot(stateDir) {
  return readJsonl(path.join(stateDir, DEAD_LETTER_FILENAME));
}

/**
 * Whether a process id is currently alive. EPERM (a live process owned by
 * another user) counts as alive; ESRCH (no such process) counts as dead.
 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Reconcile-v2 enablement + resolved startup interval, for the operator
 * `status` surface. Reads the same domain policy + hardware-tier logic the
 * daemon uses so `status` reflects what a fresh daemon would actually do.
 */
function reconcileConfigSnapshot(env = process.env) {
  const enablement = reconcileEnablement(env);
  let hardware = null;
  try {
    hardware = detectHardwareCapability();
  } catch {
    hardware = null;
  }
  const tier = hardware ? tierForHardware(hardware) : null;
  const interval = startupInterval({ tier: tier || undefined, env, hardware });
  return {
    enabled: enablement.enabled,
    source: enablement.source,
    disabledReason: enablement.enabled
      ? null
      : `SWEET_SEARCH_RECONCILE_V2=${enablement.raw}`,
    interval: {
      ms: interval.intervalMs,
      source: interval.source,
      tier,
      pinned: interval.pinned,
    },
  };
}

/**
 * Maintainer lock state for the state dir: whether a daemon currently holds
 * the lock, its pid, and whether that pid is alive (a present-but-dead lock
 * is stale and will be cleared on the next daemon start).
 */
function lockSnapshot(stateDir) {
  const lockFile = path.join(stateDir, MAINTAINER_LOCK);
  const payload = readJson(lockFile);
  if (!payload || !Number.isInteger(payload.pid)) {
    return { present: false, filePath: lockFile };
  }
  const alive = pidAlive(payload.pid);
  return {
    present: true,
    filePath: lockFile,
    pid: payload.pid,
    alive,
    stale: !alive,
    startedAt: payload.timestamp ? new Date(payload.timestamp).toISOString() : null,
  };
}

function statusSnapshot(ctx) {
  const manifest = readManifest(ctx.stateDir);
  const dirty = dirtySnapshot(ctx.stateDir);
  const rebuildJobs = readMaintenanceQueue(ctx.stateDir);
  const dead = deadLetterSnapshot(ctx.stateDir);
  const lastTicks = lastJsonl(path.join(ctx.stateDir, METRICS_FILE), 5);
  const pause = pauseSnapshot(ctx);
  const byTier = {};
  for (const job of rebuildJobs) {
    const tier = job.tier || 'unknown';
    byTier[tier] = (byTier[tier] || 0) + 1;
  }
  const lastTick = lastTicks.at(-1) ?? null;
  return {
    projectRoot: ctx.projectRoot,
    stateDir: ctx.stateDir,
    reconcile: reconcileConfigSnapshot(),
    lock: lockSnapshot(ctx.stateDir),
    manifest: manifest
      ? { present: true, epoch: manifest.epoch ?? 0, publishedAt: manifest.publishedAt ?? null }
      : { present: false, epoch: 0, publishedAt: null },
    dirty: {
      pending: dirty.pending,
      processing: dirty.processing,
      malformed: dirty.malformed,
    },
    pause,
    rebuild: {
      pending: rebuildJobs.length,
      deadLetters: dead.items.length,
      malformedDeadLetters: dead.malformed,
      byTier,
    },
    metrics: {
      lastTicks,
      lastTickAt: lastTick?.published_at ?? lastTick?.publishedAt ?? lastTick?.ts ?? null,
      lastError: lastTick?.last_error ?? null,
      lastMaintenance: lastTick?.last_maintenance ?? null,
      watermarks: lastTick?.watermarks ?? null,
    },
  };
}

function pauseSnapshot(ctx) {
  const filePath = path.join(ctx.stateDir, PAUSE_FILE);
  const payload = readJson(filePath);
  if (!payload) return { paused: false, filePath };
  return {
    paused: true,
    filePath,
    pausedAt: payload.pausedAt ?? null,
    reason: payload.reason ?? null,
    pid: payload.pid ?? null,
  };
}

function normalizeRel(p) {
  return p.replace(/\\/g, '/');
}

function queueMatches(entries, absPath, relPath) {
  const candidates = new Set([normalizeRel(absPath), normalizeRel(relPath)]);
  return entries.filter((entry) => {
    const value = entry.file_path || entry.path || entry.filePath;
    return value && candidates.has(normalizeRel(value));
  });
}

function fileStatTuple(filePath) {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    return {
      size: stat.size.toString(),
      mtime_ns: stat.mtimeNs.toString(),
      inode: stat.ino.toString(),
    };
  } catch {
    return null;
  }
}

function statDiff(stored, current) {
  if (!stored || !current) return null;
  return {
    size: String(stored.size ?? '') !== current.size,
    mtime_ns: String(stored.mtime_ns ?? '') !== current.mtime_ns,
    inode: stored.inode == null ? true : String(stored.inode) !== current.inode,
  };
}

function inspectPath(ctx, inputPath) {
  if (!inputPath) throw new Error('reconcile inspect requires a path');
  const canonicalPath = canonicaliseInsideRoot(ctx.projectRoot, inputPath);
  if (!canonicalPath) throw new Error(`path is outside project root: ${inputPath}`);
  const relPath = normalizeRel(path.relative(ctx.projectRoot, canonicalPath));
  const dirty = dirtySnapshot(ctx.stateDir);
  const manifest = readManifest(ctx.stateDir);
  const merkle = readJson(path.join(ctx.stateDir, MERKLE_STATE)) || {};
  const stored = merkle.files?.[relPath] || merkle.files?.[canonicalPath] || null;
  const currentStat = fileStatTuple(canonicalPath);
  let currentHash = null;
  if (currentStat && fs.existsSync(canonicalPath)) {
    currentHash = contentHashSync(fs.readFileSync(canonicalPath));
  }
  const queued = queueMatches(dirty.entries, canonicalPath, relPath);
  const reasons = [];
  if (queued.length > 0) reasons.push('queued');
  if (!stored) reasons.push('not_tracked');
  if (!currentStat) reasons.push('deleted');
  if (stored?.hash && currentHash && stored.hash !== currentHash) reasons.push('hash_diff');
  const tupleDiff = statDiff(stored, currentStat);
  if (tupleDiff && Object.values(tupleDiff).some(Boolean)) reasons.push('stat_tuple_diff');
  if (reasons.length === 0) reasons.push('clean');
  return {
    inputPath,
    canonicalPath,
    relativePath: relPath,
    manifestEpoch: manifest?.epoch ?? 0,
    lastIndex: merkle.lastIndex ?? null,
    queued: queued.map((entry) => ({
      file_path: entry.file_path || entry.path || entry.filePath,
      timestamp: entry.timestamp ?? null,
      queued_at: entry.queued_at ?? null,
      retry: entry.retry ?? null,
    })),
    state: {
      tracked: Boolean(stored),
      storedHash: stored?.hash ?? null,
      currentHash,
      hashDiff: Boolean(stored?.hash && currentHash && stored.hash !== currentHash),
      storedStat: stored ? {
        size: stored.size ?? null,
        mtime_ns: stored.mtime_ns ?? null,
        inode: stored.inode ?? null,
      } : null,
      currentStat,
      statDiff: tupleDiff,
    },
    reasons,
  };
}

function resetDirtySet(ctx) {
  const files = [DIRTY_QUEUE, PROCESSING_QUEUE].map((name) => path.join(ctx.stateDir, name));
  let removed = 0;
  for (const file of files) {
    try {
      fs.unlinkSync(file);
      removed += 1;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return { stateDir: ctx.stateDir, removedQueueFiles: removed };
}

function pauseReconcile(ctx) {
  fs.mkdirSync(ctx.stateDir, { recursive: true });
  const filePath = path.join(ctx.stateDir, PAUSE_FILE);
  const payload = {
    paused: true,
    pausedAt: new Date().toISOString(),
    pid: process.pid,
  };
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, filePath);
  return { stateDir: ctx.stateDir, pause: pauseSnapshot(ctx) };
}

function resumeReconcile(ctx) {
  const filePath = path.join(ctx.stateDir, PAUSE_FILE);
  let removed = false;
  try {
    fs.unlinkSync(filePath);
    removed = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { stateDir: ctx.stateDir, removed, pause: pauseSnapshot(ctx) };
}

function addDirtyHint(ctx, inputPath) {
  if (!inputPath) throw new Error('index --add requires a path');
  const canonicalPath = canonicaliseInsideRoot(ctx.projectRoot, inputPath);
  if (!canonicalPath) throw new Error(`path is outside project root: ${inputPath}`);
  const relativePath = normalizeRel(path.relative(ctx.projectRoot, canonicalPath));
  fs.mkdirSync(ctx.stateDir, { recursive: true });
  const queueFile = path.join(ctx.stateDir, DIRTY_QUEUE);
  const entry = {
    file_path: relativePath,
    timestamp: Date.now(),
    queued_at: new Date().toISOString(),
    source: 'cli',
  };
  fs.appendFileSync(queueFile, `${JSON.stringify(entry)}\n`);
  return {
    stateDir: ctx.stateDir,
    queueFile,
    inputPath,
    canonicalPath,
    relativePath,
    entry,
  };
}

async function preserveJsonStdout(json, fn) {
  if (!json) return fn();
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

function print(payload, json) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.kind === 'status') {
    if (payload.reconcile) {
      const r = payload.reconcile;
      console.log(`reconcile v2: ${r.enabled ? 'enabled' : 'disabled'} (${r.source})   interval: ${r.interval.ms}ms (${r.interval.source})`);
      if (!r.enabled && r.disabledReason) console.log(`disabled reason: ${r.disabledReason}`);
    }
    console.log(`index epoch: ${payload.manifest.epoch}   dirty files: ${payload.dirty.pending + payload.dirty.processing}   rebuild backlog: ${payload.rebuild.pending}`);
    if (payload.lock?.present) {
      console.log(`maintainer lock: pid ${payload.lock.pid} (${payload.lock.alive ? 'alive' : 'stale'})`);
    }
    if (payload.pause?.paused) console.log(`reconcile paused since ${payload.pause.pausedAt || 'unknown'}`);
    if (payload.rebuild.deadLetters > 0) console.log(`dead letters: ${payload.rebuild.deadLetters}`);
    if (payload.metrics.lastError) console.log(`last error: ${payload.metrics.lastError}`);
    if (payload.metrics.lastTicks.length > 0) console.log(`last ticks: ${payload.metrics.lastTicks.length}`);
    return;
  }
  if (payload.kind === 'inspect') {
    console.log(`${payload.relativePath}: ${payload.reasons.join(', ')}`);
    console.log(`manifest epoch: ${payload.manifestEpoch}`);
    return;
  }
  if (payload.kind === 'reset') {
    console.log(`reset dirty set (${payload.removedQueueFiles} queue file(s) removed)`);
    return;
  }
  if (payload.kind === 'pause') {
    console.log(`reconcile paused (${payload.stateDir})`);
    return;
  }
  if (payload.kind === 'resume') {
    console.log(payload.removed ? 'reconcile resumed' : 'reconcile was not paused');
    return;
  }
  if (payload.kind === 'index-add') {
    console.log(`queued ${payload.relativePath}`);
    return;
  }
  if (payload.kind === 'tick') {
    console.log(`reconcile tick epoch ${payload.counters?.epoch ?? 'unknown'} (${payload.counters?.files_processed ?? 0} file(s) processed)`);
    return;
  }
  if (payload.kind === 'rebuild-status') {
    console.log(`rebuild backlog: ${payload.rebuild.pending}   dead letters: ${payload.rebuild.deadLetters}`);
    return;
  }
  if (payload.kind === 'rebuild-force') {
    console.log(`queued ${payload.job.tier} maintenance (${payload.job.reason})`);
    return;
  }
}

export async function handleIncrementalCli(command, args) {
  const { positional, opts } = parseOptions(args);
  const ctx = context(opts);
  const sub = positional[0];

  if (command === 'reconcile') {
    if (sub === 'status') {
      return print({ kind: 'status', ...statusSnapshot(ctx) }, opts.json);
    }
    if (sub === 'inspect') {
      return print({ kind: 'inspect', ...inspectPath(ctx, positional[1]) }, opts.json);
    }
    if (sub === 'reset') {
      return print({ kind: 'reset', ...resetDirtySet(ctx) }, opts.json);
    }
    if (sub === 'pause') {
      return print({ kind: 'pause', ...pauseReconcile(ctx) }, opts.json);
    }
    if (sub === 'resume') {
      return print({ kind: 'resume', ...resumeReconcile(ctx) }, opts.json);
    }
    if (sub === 'tick') {
      const counters = await preserveJsonStdout(opts.json, async () => {
        const { runProductionReconcileTick } = await import('./production-reconciler.mjs');
        return runProductionReconcileTick({
          projectRoot: ctx.projectRoot,
          stateDir: ctx.stateDir,
        });
      });
      return print({ kind: 'tick', ok: true, projectRoot: ctx.projectRoot, stateDir: ctx.stateDir, counters }, opts.json);
    }
  }

  if (command === 'rebuild') {
    if (sub === 'status') {
      return print({ kind: 'rebuild-status', ...statusSnapshot(ctx) }, opts.json);
    }
    if (sub === 'force') {
      const tier = REBUILD_TIERS.get(positional[1] || '');
      if (!tier) throw new Error(`unknown rebuild tier "${positional[1] || ''}"`);
      const manifest = readManifest(ctx.stateDir);
      const job = {
        tier,
        reason: 'operator_force',
        epoch: manifest?.epoch ?? 0,
        payload: {},
      };
      enqueueMaintenanceJob(ctx.stateDir, job);
      return print({ kind: 'rebuild-force', stateDir: ctx.stateDir, job }, opts.json);
    }
  }

  throw new Error(`unknown ${command} command "${sub || ''}"`);
}

export async function handleIndexAddCli(args) {
  const { opts } = parseOptions(args);
  const ctx = context(opts);
  return print({ kind: 'index-add', ...addDirtyHint(ctx, opts.add) }, opts.json);
}

export const __testing = {
  PAUSE_FILE,
  addDirtyHint,
  pauseSnapshot,
};
