#!/usr/bin/env node
/**
 * Real-daemon wrapper for the incremental-indexing validation harness.
 *
 * Replicates the body of `runReconcileV2Main` in
 * `core/indexing/index-maintainer.mjs:731-776` (lock acquire/release,
 * tick loop, signal handling, interval autotune, paused-check,
 * `drainMaintenanceInline` per-tick) — but injects deterministic fake
 * encoders into `runProductionReconcileTick` so the soak does not need
 * 5-15s ORT warmup or real model downloads.
 *
 * Every other code path runs through actual product code:
 *   - state-lock acquisition via `acquireStateLock` (same file, exported)
 *   - tick body via `runProductionReconcileTick` (same options shape)
 *   - maintenance drain via `drainMaintenanceInline` (default-enabled)
 *   - interval resolution via `resolveReconcileV2Interval`
 *   - signal-driven graceful shutdown (SIGTERM, SIGINT)
 *
 * The substitution surface is one line: passing `vectorEncoder` and
 * `liEncoder` into the production reconciler's options. The product code
 * already accepts these options (production-reconciler.mjs:160-161) for
 * exactly this kind of testing path; the running daemon binary just
 * doesn't pass them.
 *
 * Validation status messages are emitted to stderr as JSONL so the
 * orchestrator can correlate daemon ticks with reader probes.
 */

import { performance } from 'node:perf_hooks';

import {
  reconcileV2Requested,
  resolveReconcileV2Interval,
  isReconcilePaused,
  drainMaintenanceInline,
} from '../../core/indexing/index-maintainer.mjs';
import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { sweepStaleArtifactTemps } from '../../core/incremental-indexing/infrastructure/artifact-temp-sweep.mjs';

function ts() { return new Date().toISOString(); }

function logEvent(event) {
  // stderr only — stdout is reserved for any future RPC use by the orchestrator.
  process.stderr.write(JSON.stringify({ ts: ts(), pid: process.pid, ...event }) + '\n');
}

function fakeVectorEncoder() {
  // Match the existing soak harness exactly so bootstrap and daemon ticks
  // produce comparable embeddings. See scripts/incremental-soak/cross-process-soak.mjs:112-125.
  return async function (texts) {
    return texts.map((t, i) => {
      const arr = new Float32Array(8);
      let h = i + 1;
      for (let j = 0; j < t.length; j += 1) h = (h * 31 + t.charCodeAt(j)) >>> 0;
      for (let k = 0; k < 8; k += 1) {
        h = (h * 17 + 7) >>> 0;
        arr[k] = ((h % 9973) / 9973) - 0.5;
      }
      return arr;
    });
  };
}

function fakeLiEncoder() {
  return async function (texts) {
    return texts.map((t, i) => {
      const tokenCount = Math.max(2, Math.min(8, Math.ceil(t.length / 60)));
      const out = [];
      for (let tk = 0; tk < tokenCount; tk += 1) {
        const arr = new Float32Array(4);
        let h = ((i + 1) * 31 + tk) >>> 0;
        for (let j = 0; j < t.length; j += 1) h = (h * 13 + t.charCodeAt(j) + tk) >>> 0;
        for (let k = 0; k < 4; k += 1) {
          h = (h * 17 + 11) >>> 0;
          arr[k] = ((h % 9973) / 9973);
        }
        out.push(arr);
      }
      return out;
    });
  };
}

const MODEL_INFO = Object.freeze({
  provider: 'soak', model: 'soak-fake', dimension: 8, hnswDimension: 8,
});

async function runTick({ projectRoot, stateDir, vectorEncoder, liEncoder, useRealEncoder }) {
  const t0 = performance.now();
  try {
    // Real-encoder mode: omit vectorEncoder/liEncoder/modelInfo so the
    // production reconciler falls back to its real defaults (getEmbeddings,
    // encodeDocumentsCpu, getModelInfo). Fake mode passes the deterministic
    // 8-dim hash encoders + matching modelInfo, as in the prior phases.
    const encoderOptions = useRealEncoder
      ? {}
      : { vectorEncoder, liEncoder, modelInfo: MODEL_INFO };
    const counters = await runProductionReconcileTick({
      projectRoot,
      stateDir,
      ...encoderOptions,
      logger: {
        info:  (msg) => logEvent({ phase: 'tick_log_info',  msg }),
        warn:  (msg) => logEvent({ phase: 'tick_log_warn',  msg }),
        error: (msg) => logEvent({ phase: 'tick_log_error', msg }),
      },
    });
    const took = Math.round(performance.now() - t0);
    logEvent({ phase: 'tick_complete', took, counters: {
      epoch: counters.epoch,
      filesProcessed: counters.files_processed,
      contentUnchanged: counters.content_unchanged,
      dirtyDeferred: counters.dirty_paths_deferred,
    } });
    return counters;
  } catch (err) {
    logEvent({ phase: 'tick_error', took: Math.round(performance.now() - t0), error: err.message, stack: err.stack });
    return null;
  }
}

async function main() {
  if (!reconcileV2Requested(process.env)) {
    logEvent({ phase: 'startup_error', error: 'SWEET_SEARCH_RECONCILE_V2 not set; refusing to run' });
    process.exit(2);
  }
  const projectRoot = process.env.SWEET_SEARCH_PROJECT_ROOT;
  const stateDir = process.env.SWEET_SEARCH_STATE_DIR;
  if (!projectRoot || !stateDir) {
    logEvent({ phase: 'startup_error', error: 'SWEET_SEARCH_PROJECT_ROOT and SWEET_SEARCH_STATE_DIR must be set' });
    process.exit(2);
  }

  // Replicate `acquireStateLock` from index-maintainer.mjs:615-633 without
  // re-exporting it. We use the same lockfile name so a stale daemon would
  // be detected the same way.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const constants = fs.constants;
  fs.mkdirSync(stateDir, { recursive: true });
  const lockFile = path.join(stateDir, 'index-maintainer.lock');
  let fd;
  try {
    fd = fs.openSync(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
    fs.closeSync(fd);
  } catch (err) {
    if (err.code === 'EEXIST') {
      logEvent({ phase: 'startup_error', error: `lockfile already exists: ${lockFile}` });
      process.exit(3);
    }
    throw err;
  }

  function releaseLock() {
    try {
      const existing = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      if (existing?.pid === process.pid) fs.unlinkSync(lockFile);
    } catch { /* ok */ }
  }

  // Mirror runReconcileV2Main: sweep crash-orphan staging temps now that we
  // hold the exclusive lock. Honour the same env knob.
  try {
    const ageRaw = Number.parseInt(process.env.SWEET_SEARCH_TMP_SWEEP_MAX_AGE_MS || '', 10);
    const sweep = sweepStaleArtifactTemps(stateDir, {
      maxAgeMs: Number.isFinite(ageRaw) && ageRaw >= 0 ? ageRaw : undefined,
    });
    logEvent({ phase: 'orphan_sweep', removed: sweep.removed, bytes: sweep.bytesReclaimed, skippedRecent: sweep.skippedRecent });
  } catch (err) {
    logEvent({ phase: 'orphan_sweep_error', error: err.message });
  }

  const resolved = resolveReconcileV2Interval({ env: process.env });
  const intervalMs = resolved.intervalMs;
  logEvent({ phase: 'startup', projectRoot, stateDir, intervalMs, intervalSource: resolved.source, intervalTier: resolved.tier });

  let shutdownRequested = false;
  const shutdown = (signal) => {
    logEvent({ phase: 'shutdown_signal', signal });
    shutdownRequested = true;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('exit', () => releaseLock());

  const useRealEncoder = /^(1|true|on|yes)$/i.test(process.env.SWEET_SEARCH_SOAK_REAL_ENCODER || '');
  const vectorEncoder = useRealEncoder ? undefined : fakeVectorEncoder();
  const liEncoder = useRealEncoder ? undefined : fakeLiEncoder();
  logEvent({ phase: 'encoder_mode', real: useRealEncoder });

  // Refresh lock timestamp periodically (same intent as index-maintainer.mjs:750).
  const lockRefresh = setInterval(() => {
    try {
      const existing = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      if (existing?.pid === process.pid) {
        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
      }
    } catch { /* ignore */ }
  }, Math.max(5000, Math.min(intervalMs - 1000, 30_000)));

  try {
    let tickIdx = 0;
    while (!shutdownRequested) {
      const pause = isReconcilePaused(stateDir);
      if (pause.paused) {
        logEvent({ phase: 'paused', pausedAt: pause.pausedAt });
      } else {
        tickIdx += 1;
        logEvent({ phase: 'tick_start', tickIdx });
        const counters = await runTick({ projectRoot, stateDir, vectorEncoder, liEncoder, useRealEncoder });
        if (counters) {
          const drainResult = await drainMaintenanceInline({ stateDir, env: process.env });
          logEvent({ phase: 'maintenance_drain_result', drainResult: drainResult && {
            skipped: drainResult.skipped ?? false,
            reason:  drainResult.reason  ?? null,
            seen:    drainResult.seen    ?? null,
            succeeded: drainResult.succeeded ?? null,
            deferred:  drainResult.deferred  ?? null,
            retried:   drainResult.retried   ?? null,
            deadLettered: drainResult.deadLettered ?? null,
            remaining: drainResult.remaining ?? null,
          } });
        }
      }
      // Sleep up to intervalMs, but check the shutdown flag every 250ms so
      // SIGTERM is honoured promptly (matches the spirit of the real daemon
      // even though the real daemon uses a single setTimeout).
      const deadline = Date.now() + intervalMs;
      while (!shutdownRequested && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  } finally {
    clearInterval(lockRefresh);
    releaseLock();
    logEvent({ phase: 'shutdown_complete' });
  }
}

main().catch((err) => {
  logEvent({ phase: 'fatal', error: err.message, stack: err.stack });
  process.exit(1);
});
