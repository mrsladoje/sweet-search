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
 * Phase 2 lands the SHELL: the service class, the tick scaffold, and the
 * boundary types. Phase 3 plugs in the per-tier write adapters (HNSW, LI,
 * sparse-gram) and the maintenance scheduler. The legacy
 * `core/indexing/index-maintainer.mjs` daemon continues to drive the
 * existing path until the v2 flag flips.
 *
 * The reconciler is intentionally pure of I/O orchestration — it accepts
 * dependency-injected adapters so unit tests can drive every tick through
 * synthetic inputs.
 */

import { ReconcileCounters } from '../domain/reconcile-counters.mjs';
import {
  buildNextManifest,
  readManifest,
  writeManifest,
  zeroManifest,
} from '../infrastructure/manifest.mjs';
import { beginRead, endRead, minLiveEpoch } from '../infrastructure/reader-heartbeat.mjs';

/**
 * Adapter contract (Phase 2 declaration):
 *
 *   {
 *     readDirtySet():            Promise<DirtyFile[]>,
 *     hashFile(file):            Promise<{ contentHash, metadata }>,
 *     loadCurrentManifest():     object|null,
 *     persistManifest(manifest): Promise<void>,
 *     applyGraphDelta(file, parsed, epoch):       Promise<{ ops }>,
 *     applyVectorDelta(file, chunks, hashes, epoch): Promise<{ ops }>,
 *     applyHNSWDelta(file, vectorOps, epoch):     Promise<{ ops }>,
 *     applyBinaryHNSWDelta(file, vectorOps, epoch): Promise<{ ops }>,
 *     applyLIDelta(file, tokenOps, epoch):        Promise<{ ops }>,
 *     applySparseGramDelta(file, gramOps, epoch): Promise<{ ops }>,
 *     scheduleMaintenance(reason, payload):       void,
 *   }
 *
 * The Phase 3 maintenance scheduler will be a separate file; Phase 2 just
 * accepts the function reference so the contract is fixed early.
 */

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_CPU_BUDGET_MS = 2_000;
const DEFAULT_FILES_PER_TICK = 50;

export class Reconciler {
  /**
   * @param {object} options
   * @param {string} options.stateDir
   * @param {object} options.adapters        Adapter contract above.
   * @param {object} [options.config]        Tick interval / budgets / etc.
   * @param {Function} [options.now]         Injectable clock for tests.
   * @param {{info:Function, warn:Function, error:Function}} [options.logger]
   */
  constructor({ stateDir, adapters, config = {}, now = Date.now, logger = console }) {
    if (!stateDir) throw new Error('Reconciler: stateDir is required');
    if (!adapters) throw new Error('Reconciler: adapters are required');
    this.stateDir = stateDir;
    this.adapters = adapters;
    this.config = {
      intervalMs: config.intervalMs ?? DEFAULT_TICK_INTERVAL_MS,
      cpuBudgetMs: config.cpuBudgetMs ?? DEFAULT_CPU_BUDGET_MS,
      filesPerTick: config.filesPerTick ?? DEFAULT_FILES_PER_TICK,
      ...config,
    };
    this.now = now;
    this.logger = logger;
    this._lastEpoch = 0;
    this._running = false;
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
   * Phase 2 implementation walks the dirty set through the adapter
   * contract; Phase 3 wires real tier writes. For now the adapters
   * decide whether to actually do anything — the reconciler enforces
   * the budget, atomicity, and manifest publish protocol.
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

    try {
      const dirty = await this.adapters.readDirtySet();
      counters.set('dirty_paths_seen', dirty.length);

      // Drain the dirty set under the CPU + file budget. Phase 5 tunes
      // the limit per hardware tier; Phase 2 enforces a soft cap.
      const budget = Math.min(this.config.filesPerTick, dirty.length);
      const files = dirty.slice(0, budget);
      counters.set('cpu_budget_total_ms', this.config.cpuBudgetMs);

      // Track per-file outcomes for the tick summary.
      const tierOps = {};
      const filesProcessed = [];

      for (const file of files) {
        const hashes = await this.adapters.hashFile(file);
        if (hashes && hashes.contentUnchanged) {
          counters.observeContentUnchanged();
          continue;
        }
        const fileRes = await this._reconcileOneFile(file, epoch, hashes);
        filesProcessed.push({ file, ...fileRes });
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

      // Publish the new manifest. Plan § 8.1 step 4: write to *.tmp,
      // fsync, atomic rename, fsync parent dir. `writeManifest` already
      // does that.
      const previous = (this.adapters.loadCurrentManifest
        ? this.adapters.loadCurrentManifest()
        : readManifest(this.stateDir))
        ?? zeroManifest({});
      const manifest = buildNextManifest(previous, { epoch, tiers: {} });
      await this._publishManifest(manifest);
      this._lastEpoch = epoch;

      counters.set('tick_ms', this.now() - startedAt);
      counters.set('ts', startedAt / 1000);
      return counters.snapshot();
    } finally {
      this._running = false;
    }
  }

  async _reconcileOneFile(file, epoch, hashes) {
    // Phase 2 dispatches to the per-tier adapter methods. Adapters can
    // return undefined when they have no work; Phase 3 wires the
    // actual deltas through.
    const ops = {};
    const graph = await this.adapters.applyGraphDelta?.(file, hashes, epoch);
    if (graph?.ops?.graph_upsert != null) ops.graph_upsert = graph.ops.graph_upsert;
    if (graph?.ops?.graph_tombstone != null) ops.graph_tombstone = graph.ops.graph_tombstone;
    const vec = await this.adapters.applyVectorDelta?.(file, hashes?.chunks ?? [], hashes, epoch);
    if (vec?.ops?.vectors_upsert != null) ops.vectors_upsert = vec.ops.vectors_upsert;
    if (vec?.ops?.vectors_delete != null) ops.vectors_delete = vec.ops.vectors_delete;
    // HNSW / Binary / LI / sparse-gram are Phase 3 wiring; we still call
    // through so adapter contract is exercised even when no work happens.
    const hnsw = await this.adapters.applyHNSWDelta?.(file, vec?.vectorOps ?? [], epoch);
    if (hnsw?.ops?.hnsw_add != null) ops.hnsw_add = hnsw.ops.hnsw_add;
    if (hnsw?.ops?.hnsw_tombstone != null) ops.hnsw_tombstone = hnsw.ops.hnsw_tombstone;
    const bin = await this.adapters.applyBinaryHNSWDelta?.(file, vec?.vectorOps ?? [], epoch);
    if (bin?.ops?.binary_hnsw_append != null) ops.binary_hnsw_append = bin.ops.binary_hnsw_append;
    if (bin?.ops?.binary_hnsw_tombstone != null) ops.binary_hnsw_tombstone = bin.ops.binary_hnsw_tombstone;
    const li = await this.adapters.applyLIDelta?.(file, vec?.tokenOps ?? [], epoch);
    if (li?.ops?.li_segment_append != null) ops.li_segment_append = li.ops.li_segment_append;
    if (li?.ops?.li_tombstone != null) ops.li_tombstone = li.ops.li_tombstone;
    const sg = await this.adapters.applySparseGramDelta?.(file, vec?.gramOps ?? [], epoch);
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
      ops,
    };
  }

  async _publishManifest(manifest) {
    if (this.adapters.persistManifest) {
      await this.adapters.persistManifest(manifest);
      return;
    }
    writeManifest(this.stateDir, manifest);
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
