/**
 * Reconciler application service.
 *
 * Plan § 6.1, § 8.1, § 13 Phase 2. The reconciler owns:
 *
 *   - dirty-set processing,
 *   - content-hash diff,
 *   - encoder-dependency expansion,
 *   - metadata-dirty input rebuild,
 *   - per-file per-tier writes,
 *   - strict row visibility,
 *   - reader heartbeat files,
 *   - prune grace periods,
 *   - manifest publish.
 *
 * The reconciler coordinates adapter-provided per-tier deltas, enforces
 * tick budgets, schedules maintenance jobs from watermarks, and publishes
 * the manifest. Concrete graph/vector/HNSW/LI/sparse writes stay behind
 * the injected adapters.
 *
 * The reconciler is intentionally pure of I/O orchestration — it accepts
 * dependency-injected adapters so unit tests can drive every tick through
 * synthetic inputs.
 */

import { ReconcileCounters } from '../domain/reconcile-counters.mjs';
import { nextInterval } from '../domain/interval-autotune.mjs';
import {
  buildNextManifest,
  readManifest,
  writeManifest,
  zeroManifest,
} from '../infrastructure/manifest.mjs';
import { evaluateWatermarks, loadWatermarkConfig } from '../domain/watermark-scheduler.mjs';
import { beginRead, endRead, minLiveEpoch } from '../infrastructure/reader-heartbeat.mjs';
import { verifyStamp, writeStamp, formatStampMismatch } from '../infrastructure/worktree-stamp.mjs';

/**
 * Adapter contract (Phase 2 declaration):
 *
 *   {
 *     readDirtySet():            Promise<DirtyFile[]>,
 *     requeueDirtyFiles(files):   Promise<void>,       // optional budget tail
 *     hashFile(file):            Promise<{ contentHash, metadata }>,
 *     loadCurrentManifest():     object|null,
 *     persistManifest(manifest): Promise<void>,
 *     applyGraphDelta(file, parsed, epoch):       Promise<{ ops }>,
 *     applyVectorDelta(file, chunks, hashes, epoch): Promise<{ ops }>,
 *     applyBinaryHNSWDelta(file, vectorOps, epoch): Promise<{ ops }>,
 *     applyLIDelta(file, tokenOps, epoch):        Promise<{ ops }>,
 *     applySparseGramDelta(file, gramOps, epoch): Promise<{ ops }>,
 *     // Any apply* call may also return either:
 *     //   { manifest: {...tier descriptor...} }
 *     // or:
 *     //   { manifestTiers: { sparseGram: {...}, hnsw: {...} } }
 *     // These descriptors are merged into the next epoch manifest.
 *     readMaintenanceState(ctx):                  Promise<object>|object,
 *     scheduleMaintenance(job):                   Promise<void>|void,
 *   }
 *
 * Maintenance scheduling uses `domain/watermark-scheduler.mjs`; the adapter
 * persists emitted jobs to the queue used by `maintenance-worker.mjs`.
 */

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_CPU_BUDGET_MS = 2_000;
const DEFAULT_FILES_PER_TICK = 50;

const MANIFEST_TIER_KEYS = new Set([
  'codeGraph',
  'vectors',
  'hnsw',
  'binaryHnsw',
  'lateInteraction',
  'sparseGram',
]);

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function collectManifestTier(target, tier, result) {
  if (!result) return;
  if (isPlainObject(result.manifest)) {
    mergeManifestTiers(target, { [tier]: result.manifest });
  }
  if (isPlainObject(result.manifestTiers)) {
    mergeManifestTiers(target, result.manifestTiers);
  }
}

function mergeManifestTiers(target, update) {
  if (!isPlainObject(update)) return target;
  for (const [tier, descriptor] of Object.entries(update)) {
    if (!MANIFEST_TIER_KEYS.has(tier) || !isPlainObject(descriptor)) continue;
    target[tier] = mergeTierDescriptor(target[tier] || {}, descriptor);
  }
  return target;
}

function mergeTierDescriptor(previous, next) {
  const merged = { ...previous, ...next };
  if (Array.isArray(previous.deltas) || Array.isArray(next.deltas)) {
    merged.deltas = [
      ...new Set([
        ...(Array.isArray(previous.deltas) ? previous.deltas : []),
        ...(Array.isArray(next.deltas) ? next.deltas : []),
      ]),
    ];
  }
  return merged;
}

function finalizeManifestTiers(previousManifest, tiers) {
  const out = { ...tiers };
  if (isPlainObject(out.sparseGram)) {
    const previousSparse = previousManifest?.sparseGram || {};
    const baseChanged = typeof out.sparseGram.base === 'string'
      && out.sparseGram.base !== previousSparse.base;
    const weightsChanged = typeof out.sparseGram.weightsId === 'string'
      && out.sparseGram.weightsId !== previousSparse.weightsId;
    if (baseChanged || weightsChanged) {
      out.sparseGram = {
        ...out.sparseGram,
        deltas: Array.isArray(out.sparseGram.deltas) ? out.sparseGram.deltas : [],
      };
    } else if (Array.isArray(out.sparseGram.deltas)) {
      out.sparseGram = {
        ...out.sparseGram,
        deltas: [
          ...new Set([
            ...(Array.isArray(previousSparse.deltas) ? previousSparse.deltas : []),
            ...out.sparseGram.deltas,
          ]),
        ],
      };
    }
  }
  return out;
}

export class Reconciler {
  /**
   * @param {object} options
   * @param {string} options.stateDir
   * @param {object} options.adapters        Adapter contract above.
   * @param {object} [options.config]        Tick interval / budgets / etc.
   * @param {Function} [options.now]         Injectable clock for tests.
   * @param {{info:Function, warn:Function, error:Function}} [options.logger]
   * @param {(phase:string)=>void} [options.onProgress]
   */
  constructor({ stateDir, adapters, config = {}, now = Date.now, logger = console, projectRoot = null, onProgress = null }) {
    if (!stateDir) throw new Error('Reconciler: stateDir is required');
    if (!adapters) throw new Error('Reconciler: adapters are required');
    this.stateDir = stateDir;
    this.projectRoot = projectRoot;
    this.adapters = adapters;
    this.config = {
      intervalMs: config.intervalMs ?? DEFAULT_TICK_INTERVAL_MS,
      cpuBudgetMs: config.cpuBudgetMs ?? DEFAULT_CPU_BUDGET_MS,
      filesPerTick: config.filesPerTick ?? DEFAULT_FILES_PER_TICK,
      autotuneInterval: config.autotuneInterval ?? false,
      pinnedIntervalMs: config.pinnedIntervalMs ?? false,
      ...config,
    };
    this.now = now;
    this.logger = logger;
    this.onProgress = typeof onProgress === 'function' ? onProgress : null;
    this._lastEpoch = 0;
    this._running = false;
  }

  progress(phase) {
    this.onProgress?.(phase);
  }

  /**
   * Verify the worktree stamp before any tick. Plan § 8.5 / § 14.2.4 —
   * cross-worktree mixing is a silent footgun; verify or mint a stamp
   * before the daemon writes to this state dir.
   *
   * @returns {{ok:boolean, reason?:string}}
   */
  verifyStartup() {
    if (!this.projectRoot) return { ok: true, reason: 'no-project-root' };
    const check = verifyStamp(this.stateDir, this.projectRoot);
    if (!check.ok) {
      this.logger.error?.(formatStampMismatch(check));
      return check;
    }
    if (check.reason === 'absent') {
      writeStamp(this.stateDir, this.projectRoot);
    }
    return { ok: true, reason: check.reason };
  }

  /**
   * Load the current manifest's epoch. Falls back to 0 when no manifest
   * has been written yet.
   *
   * @returns {number}
   */
  currentEpoch() {
    const manifest = this.adapters.loadCurrentManifest
      ? this.adapters.loadCurrentManifest()
      : readManifest(this.stateDir);
    return manifest?.epoch ?? 0;
  }

  /**
   * Build the next-epoch number. Plan § 8.1 step 1-2.
   *
   * @returns {number}
   */
  nextEpoch() {
    const current = this.currentEpoch();
    return Math.max(current + 1, this._lastEpoch + 1);
  }

  /**
   * Run one reconcile tick. Returns the counters snapshot for the tick.
   *
   * Walk the dirty set through the adapter contract. Adapters own concrete
   * tier writes; the reconciler enforces budget, maintenance scheduling,
   * and manifest publication.
   *
   * @returns {Promise<object>}
   */
  async tick() {
    if (this._running) {
      throw new Error('Reconciler.tick(): tick already in progress (single-instance enforced by lockfile)');
    }
    this._running = true;
    const startedAt = this.now();
    const counters = new ReconcileCounters();
    const epoch = this.nextEpoch();
    counters.set('epoch', epoch);
    let dirty = [];
    let dirtyCursor = 0;
    let deferredRequeued = false;
    let manifestPublished = false;

    try {
      dirty = await this.adapters.readDirtySet();
      this.progress('reconciler:dirty-read');
      counters.set('dirty_paths_seen', dirty.length);

      counters.set('cpu_budget_total_ms', this.config.cpuBudgetMs);

      // Track per-file outcomes for the tick summary.
      const tierOps = {};
      const manifestTiers = {};
      const filesProcessed = [];

      for (; dirtyCursor < dirty.length; dirtyCursor += 1) {
        const filesAttempted = counters._fields.files_processed + counters._fields.content_unchanged;
        if (filesAttempted >= this.config.filesPerTick) break;
        if (filesAttempted > 0 && this.now() - startedAt >= this.config.cpuBudgetMs) break;

        const file = dirty[dirtyCursor];
        this.progress('reconciler:file:start');
        const hashes = await this.adapters.hashFile(file);
        this.progress('reconciler:file:hashed');
        if (hashes && hashes.contentUnchanged) {
          counters.observeContentUnchanged();
          continue;
        }
        const fileRes = await this._reconcileOneFile(file, epoch, hashes);
        this.progress('reconciler:file:done');
        filesProcessed.push({ file, ...fileRes });
        mergeManifestTiers(manifestTiers, fileRes?.manifestTiers);
        counters.inc('files_processed');
        counters.inc('chunks_total', fileRes?.chunksTotal ?? 0);
        counters.inc('chunks_encoded', fileRes?.chunksEncoded ?? 0);
        counters.inc('chunks_hash_reused', fileRes?.chunksReused ?? 0);
        counters.inc('chunks_struct_stable', fileRes?.chunksStructStable ?? 0);
        counters.inc('chunks_text_unchanged', fileRes?.chunksTextUnchanged ?? 0);
        counters.inc('chunks_metadata_dirty', fileRes?.chunksMetadataDirty ?? 0);
        counters.inc('chunks_dedup_repaired', fileRes?.chunksDedupRepaired ?? 0);
        counters.inc('tree_sitter_error_nodes_seen', fileRes?.treeSitterErrorNodes ?? 0);
        if ((fileRes?.treeSitterErrorNodes ?? 0) > 0) {
          counters.inc('tree_sitter_files_with_errors');
        }
        for (const [tier, op] of Object.entries(fileRes?.ops ?? {})) {
          if (typeof op === 'number') {
            counters.inc(`ops_per_tier.${tier}`, op);
            tierOps[tier] = (tierOps[tier] || 0) + op;
          }
        }
      }

      const deferredFiles = dirty.slice(dirtyCursor);
      if (deferredFiles.length > 0) {
        counters.inc('dirty_paths_deferred', deferredFiles.length);
        if (this.adapters.requeueDirtyFiles) {
          await this.adapters.requeueDirtyFiles(deferredFiles);
          deferredRequeued = true;
        } else {
          this.logger.warn?.(
            `[reconciler] ${deferredFiles.length} dirty paths exceeded the per-tick budget; ` +
            'adapter has no requeueDirtyFiles hook',
          );
        }
      }

      // Publish the new manifest. Plan § 8.1 step 4: write to *.tmp,
      // fsync, atomic rename, fsync parent dir. `writeManifest` already
      // does that.
      const previous = (this.adapters.loadCurrentManifest
        ? this.adapters.loadCurrentManifest()
        : readManifest(this.stateDir))
        ?? zeroManifest({});
      const manifest = buildNextManifest(previous, {
        epoch,
        tiers: finalizeManifestTiers(previous, manifestTiers),
      });
      await this._publishManifest(manifest);
      this.progress('reconciler:manifest-published');
      manifestPublished = true;
      this._lastEpoch = epoch;

      // Plan § 6.1 step 11: maintenance observes a successfully-published
      // epoch. Never enqueue jobs for an epoch whose manifest did not land.
      await this._scheduleMaintenance(epoch, counters, tierOps, filesProcessed);
      this.progress('reconciler:maintenance-scheduled');

      counters.set('tick_ms', this.now() - startedAt);
      counters.set('ts', startedAt / 1000);

      // Interval auto-tune (plan § 14.2.1). Skipped when the operator pins
      // a fixed interval via `config.pinnedIntervalMs` or
      // `config.autotuneInterval === false`.
      if (this.config.autotuneInterval && !this.config.pinnedIntervalMs) {
        const tuned = nextInterval({
          currentMs: this.config.intervalMs,
          lastTickMs: counters._fields.tick_ms,
          dirtyAtTickStart: dirty.length,
          cpuLoadAvg: this.config.cpuLoadAvg ?? 0,
          maintenanceBacklog: this.config.maintenanceBacklog ?? 0,
        });
        if (tuned.nextMs !== this.config.intervalMs) {
          this.logger.info?.(`[reconciler] interval ${this.config.intervalMs}ms → ${tuned.nextMs}ms (${tuned.reasons.join(',')})`);
          this.config.intervalMs = tuned.nextMs;
        }
      }

      return counters.snapshot();
    } catch (err) {
      if (!manifestPublished && dirty.length > 0) {
        const filesToRequeue = deferredRequeued ? dirty.slice(0, dirtyCursor) : dirty;
        if (filesToRequeue.length > 0) {
          await this._tryRequeueDirtyAfterFailure(filesToRequeue, err);
        }
      }
      throw err;
    } finally {
      this._running = false;
    }
  }

  async _reconcileOneFile(file, epoch, hashes) {
    // Dispatch to per-tier adapter methods. Adapters can return undefined
    // when a tier has no work for this file.
    const ops = {};
    this.progress('reconciler:graph:start');
    const graph = await this.adapters.applyGraphDelta?.(file, hashes, epoch);
    this.progress('reconciler:graph:done');
    const manifestTiers = {};
    collectManifestTier(manifestTiers, 'codeGraph', graph);
    if (graph?.ops?.graph_upsert != null) ops.graph_upsert = graph.ops.graph_upsert;
    if (graph?.ops?.graph_tombstone != null) ops.graph_tombstone = graph.ops.graph_tombstone;
    this.progress('reconciler:vector:start');
    const vec = await this.adapters.applyVectorDelta?.(file, hashes?.chunks ?? [], hashes, epoch);
    this.progress('reconciler:vector:done');
    collectManifestTier(manifestTiers, 'vectors', vec);
    if (vec?.ops?.vectors_upsert != null) ops.vectors_upsert = vec.ops.vectors_upsert;
    if (vec?.ops?.vectors_delete != null) ops.vectors_delete = vec.ops.vectors_delete;
    this.progress('reconciler:binary-hnsw:start');
    const bin = await this.adapters.applyBinaryHNSWDelta?.(file, vec?.vectorOps ?? [], epoch);
    this.progress('reconciler:binary-hnsw:done');
    collectManifestTier(manifestTiers, 'binaryHnsw', bin);
    if (bin?.ops?.binary_hnsw_append != null) ops.binary_hnsw_append = bin.ops.binary_hnsw_append;
    if (bin?.ops?.binary_hnsw_tombstone != null) ops.binary_hnsw_tombstone = bin.ops.binary_hnsw_tombstone;
    this.progress('reconciler:li:start');
    const li = await this.adapters.applyLIDelta?.(file, vec?.tokenOps ?? [], epoch);
    this.progress('reconciler:li:done');
    collectManifestTier(manifestTiers, 'lateInteraction', li);
    if (li?.ops?.li_segment_append != null) ops.li_segment_append = li.ops.li_segment_append;
    if (li?.ops?.li_tombstone != null) ops.li_tombstone = li.ops.li_tombstone;
    this.progress('reconciler:sparse:start');
    const sg = await this.adapters.applySparseGramDelta?.(file, vec?.gramOps ?? [], epoch);
    this.progress('reconciler:sparse:done');
    collectManifestTier(manifestTiers, 'sparseGram', sg);
    if (sg?.ops?.sparse_gram_delta_upsert != null) ops.sparse_gram_delta_upsert = sg.ops.sparse_gram_delta_upsert;

    return {
      chunksTotal: vec?.chunksTotal ?? 0,
      chunksEncoded: vec?.chunksEncoded ?? 0,
      chunksReused: vec?.chunksReused ?? 0,
      chunksStructStable: vec?.chunksStructStable ?? 0,
      chunksTextUnchanged: vec?.chunksTextUnchanged ?? 0,
      chunksMetadataDirty: vec?.chunksMetadataDirty ?? 0,
      chunksDedupRepaired: vec?.chunksDedupRepaired ?? 0,
      treeSitterErrorNodes: graph?.treeSitterErrorNodes ?? 0,
      manifestTiers,
      ops,
    };
  }

  async _scheduleMaintenance(epoch, counters, tierOps, filesProcessed) {
    if (!this.adapters.readMaintenanceState) return;
    const state = await this.adapters.readMaintenanceState({
      epoch,
      tierOps,
      filesProcessed,
      counters: counters.snapshot(),
    });
    const jobs = Array.isArray(state)
      ? state
      : evaluateWatermarks(state || {}, this.config.watermarks || loadWatermarkConfig());
    if (jobs.length === 0) return;
    if (!this.adapters.scheduleMaintenance) {
      this.logger.warn?.(`[reconciler] ${jobs.length} maintenance jobs crossed watermarks; adapter has no scheduleMaintenance hook`);
      return;
    }
    for (const job of jobs) {
      await this.adapters.scheduleMaintenance({ ...job, epoch: job.epoch ?? epoch });
      counters.inc('maintenance_jobs_enqueued');
    }
  }

  async _publishManifest(manifest) {
    if (this.adapters.persistManifest) {
      await this.adapters.persistManifest(manifest);
      return;
    }
    writeManifest(this.stateDir, manifest);
  }

  async _tryRequeueDirtyAfterFailure(files, cause) {
    if (!this.adapters.requeueDirtyFiles) {
      this.logger.warn?.(
        `[reconciler] tick failed before manifest publish and ${files.length} dirty paths were drained; ` +
        'adapter has no requeueDirtyFiles hook',
      );
      return;
    }
    try {
      await this.adapters.requeueDirtyFiles(files);
    } catch (requeueErr) {
      this.logger.error?.(
        `[reconciler] failed to requeue ${files.length} dirty paths after tick failure ` +
        `(${cause?.message ?? cause}): ${requeueErr?.message ?? requeueErr}`,
      );
    }
  }

  // ----- Reader heartbeat helpers (exposed for tests; production callers
  // use beginRead/endRead from infrastructure/reader-heartbeat.mjs directly).

  beginRead(epoch, meta) { return beginRead(this.stateDir, epoch, meta); }
  endRead(record) { return endRead(this.stateDir, record); }
  minLiveEpoch() { return minLiveEpoch(this.stateDir); }
}

export const __testing = {
  DEFAULT_TICK_INTERVAL_MS,
  DEFAULT_CPU_BUDGET_MS,
  DEFAULT_FILES_PER_TICK,
};
