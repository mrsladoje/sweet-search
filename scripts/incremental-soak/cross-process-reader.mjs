#!/usr/bin/env node
/**
 * Cross-process reader worker for the incremental-indexing cross-process soak.
 *
 * This process is the "search server stand-in" — it loads HNSW, Binary HNSW,
 * LI, sparse-gram and SQLite artifacts via the same code paths SweetSearch
 * uses, then exposes JSON-line RPC commands over stdin/stdout so the
 * orchestrator can probe both the long-lived (cached) view and a freshly-
 * reloaded view of the same on-disk state.
 *
 * It deliberately does NOT call real encoders — the soak validates index
 * coherence across a maintenance publish, not retrieval quality.
 *
 * Commands (one JSON object per line on stdin):
 *   { "id": <int>, "cmd": "init",        "args": { "stateDir": "..." } }
 *   { "id": <int>, "cmd": "probe-cached" }      // read from in-memory state
 *   { "id": <int>, "cmd": "probe-fresh"  }      // reload from disk first
 *   { "id": <int>, "cmd": "search-smoke" }      // exercise the search hot path
 *   { "id": <int>, "cmd": "quit"         }
 *
 * Responses (one JSON object per line on stdout):
 *   { "id": <int>, "ok": true,  "result": {...} }
 *   { "id": <int>, "ok": false, "error":  "..." }
 *
 * stderr is the worker's own log — the orchestrator surfaces it as a
 * `worker_stderr` event for postmortem.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

import { HNSWIndex } from '../../core/vector-store/hnsw-index.js';
import { BinaryHNSWIndex } from '../../core/vector-store/binary-hnsw-index.js';
import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';
import { readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import {
  resolveLatestSparseGramDeltaRecords,
  listSparseGramDeltaSegments,
} from '../../core/infrastructure/sparse-gram-delta-reader.js';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function logErr(msg) {
  process.stderr.write(`[reader pid=${process.pid}] ${msg}\n`);
}

function digest(values) {
  // Deterministic hash of a sortable set of string IDs.
  const sorted = [...values].map(String).sort();
  const h = createHash('sha256');
  for (const v of sorted) h.update(v).update('\0');
  return { count: sorted.length, sha: h.digest('hex').slice(0, 16), sample: sorted.slice(0, 5) };
}

class ReaderState {
  constructor(stateDir) {
    this.stateDir = path.resolve(stateDir);
    this.hnsw = null;
    this.binaryHnsw = null;
    this.li = null;
    this.manifestAtLoad = null;
    this.loadedAt = null;
    this.loadOrder = 0;
  }

  async loadAll() {
    this.loadOrder += 1;
    this.loadedAt = Date.now();
    this.manifestAtLoad = readManifest(this.stateDir);

    const hnswMetaPath = path.join(this.stateDir, 'codebase-hnsw.meta.json');
    this.hnsw = null;
    if (fs.existsSync(hnswMetaPath)) {
      const idx = new HNSWIndex({
        indexPath: path.join(this.stateDir, 'codebase-hnsw.idx'),
        stalePath: path.join(this.stateDir, 'codebase-hnsw.idx.stale.bin'),
      });
      // mmap mirrors what SweetSearch uses, but the in-place .usearch
      // rewrite by maintenance is precisely the case we want to stress.
      // Env knob lets us isolate mmap-vs-copy contributions if we crash.
      const useMmap = process.env.SWEET_SEARCH_XPROC_HNSW_MMAP !== '0';
      try {
        await idx.load(undefined, { mmap: useMmap });
        this.hnsw = idx;
      } catch (err) {
        logErr(`hnsw load failed (mmap=${useMmap}): ${err.message}`);
        this.hnsw = { _loadError: err.message };
      }
    }

    const binMetaPath = path.join(this.stateDir, 'codebase-binary-hnsw.meta.json');
    this.binaryHnsw = null;
    if (fs.existsSync(binMetaPath)) {
      const idx = new BinaryHNSWIndex({
        indexPath: path.join(this.stateDir, 'codebase-binary-hnsw.idx'),
        stalePath: path.join(this.stateDir, 'codebase-binary-hnsw.idx.stale.bin'),
      });
      try {
        await idx.load();
        this.binaryHnsw = idx;
      } catch (err) {
        logErr(`binary hnsw load failed: ${err.message}`);
        this.binaryHnsw = { _loadError: err.message };
      }
    }

    const liStubPath = path.join(this.stateDir, 'codebase-late-interaction.db');
    this.li = null;
    if (fs.existsSync(liStubPath)) {
      const idx = new LateInteractionIndex({ indexPath: liStubPath, loadExisting: true });
      try {
        await idx.init();
        this.li = idx;
      } catch (err) {
        logErr(`li init failed: ${err.message}`);
        this.li = { _loadError: err.message };
      }
    }
  }

  /**
   * Build a probe descriptor of the CURRENT in-memory state.
   * Note: a "cached" probe re-runs the on-disk-tolerant probes that the
   * real search path runs every query — stale bitmap (mtime-cached),
   * SQLite vectors read-only, sparse-delta overlay read fresh — but does
   * NOT rebuild the HNSW/LI in-memory objects.
   */
  probe(options = {}) {
    const errors = [];
    const out = {
      pid: process.pid,
      loadOrder: this.loadOrder,
      loadedAt: this.loadedAt,
      manifestAtLoad: this.manifestAtLoad
        ? { epoch: this.manifestAtLoad.epoch }
        : null,
      manifestNow: null,
      vectors: null,
      hnsw: null,
      binaryHnsw: null,
      li: null,
      sparse: null,
      errors,
    };

    // Manifest now (fresh read every probe).
    try {
      const m = readManifest(this.stateDir);
      out.manifestNow = m ? {
        epoch: m.epoch,
        sparseGramEpoch: m.sparseGram?.epoch ?? null,
        sparseWeightsId: m.sparseGram?.weightsId ?? null,
        sparseDeltas: Array.isArray(m.sparseGram?.deltas) ? m.sparseGram.deltas : [],
      } : null;
    } catch (err) {
      errors.push({ surface: 'manifest', error: err.message });
    }

    // Vectors DB (fresh read).
    try {
      const dbPath = path.join(this.stateDir, 'codebase.db');
      if (fs.existsSync(dbPath)) {
        const db = new Database(dbPath, { readonly: true });
        try {
          const rows = db.prepare(
            'SELECT id, file_path, epoch_retired FROM vectors',
          ).all();
          const liveIds = rows.filter((r) => r.epoch_retired == null).map((r) => r.id);
          const retiredIds = rows.filter((r) => r.epoch_retired != null).map((r) => r.id);
          out.vectors = {
            live: digest(liveIds),
            retired: digest(retiredIds),
            total: rows.length,
          };
        } finally {
          db.close();
        }
      }
    } catch (err) {
      errors.push({ surface: 'vectors', error: err.message });
    }

    // HNSW (in-memory + on-disk-tolerant stale bitmap).
    try {
      if (this.hnsw && this.hnsw._loadError) {
        out.hnsw = { loadError: this.hnsw._loadError };
      } else if (this.hnsw) {
        const idMap = this.hnsw.idMap || new Map();
        const ids = [...idMap.keys()];
        // The HNSWIndex internally uses _loadStaleBitmap with mtime caching;
        // reading it here mirrors the live search path.
        let stalePopcount = 0;
        try {
          const bm = this.hnsw._loadStaleBitmap?.() || null;
          if (bm) {
            for (const [, key] of idMap) {
              if (this.hnsw._isKeyStale?.(key, bm)) stalePopcount += 1;
            }
          }
        } catch (err) {
          errors.push({ surface: 'hnsw_stale', error: err.message });
        }
        out.hnsw = {
          ids: digest(ids),
          stalePopcount,
          dimension: this.hnsw.dimension,
          nextKey: this.hnsw.nextKey,
        };
      }
    } catch (err) {
      errors.push({ surface: 'hnsw', error: err.message });
    }

    // Binary HNSW.
    try {
      if (this.binaryHnsw && this.binaryHnsw._loadError) {
        out.binaryHnsw = { loadError: this.binaryHnsw._loadError };
      } else if (this.binaryHnsw) {
        const totalVecs = this.binaryHnsw.vectors?.length ?? 0;
        let stalePopcount = 0;
        const visibleIds = [];
        const allIds = [];
        let stalePresent = false;
        try {
          const bm = this.binaryHnsw._loadStaleBitmap?.() || null;
          stalePresent = !!bm;
          for (let i = 0; i < totalVecs; i += 1) {
            const id = this.binaryHnsw.vectors[i]?.id;
            if (!id) continue;
            allIds.push(id);
            if (bm && this.binaryHnsw._isIndexStale?.(i, bm)) {
              stalePopcount += 1;
            } else {
              visibleIds.push(id);
            }
          }
        } catch (err) {
          errors.push({ surface: 'binary_hnsw_stale', error: err.message });
        }
        const int8Ids = [...(this.binaryHnsw.int8Vectors?.keys?.() || [])];
        out.binaryHnsw = {
          totalVectors: totalVecs,
          visible: digest(visibleIds),
          all: digest(allIds),
          int8: digest(int8Ids),
          stalePopcount,
          stalePresent,
        };
      }
    } catch (err) {
      errors.push({ surface: 'binary_hnsw', error: err.message });
    }

    // Late Interaction.
    try {
      if (this.li && this.li._loadError) {
        out.li = { loadError: this.li._loadError };
      } else if (this.li) {
        const docIds = [...(this.li.documents?.keys?.() || [])];
        out.li = {
          docs: digest(docIds),
          modelId: this.li.modelId ?? null,
        };
      }
    } catch (err) {
      errors.push({ surface: 'li', error: err.message });
    }

    // Sparse-gram delta overlay (fresh disk read; this mirrors what
    // sweet-search's pattern path does on every query — there's no
    // long-lived overlay cache).
    try {
      const basePath = path.join(this.stateDir, 'codebase-sparse-grams.idx');
      const manifest = readManifest(this.stateDir);
      const maxEpoch = Number.isInteger(manifest?.epoch) ? manifest.epoch : Number.MAX_SAFE_INTEGER;
      const manifestSegments = Array.isArray(manifest?.sparseGram?.deltas)
        ? manifest.sparseGram.deltas
        : null;
      // Probe via two paths: (a) MANIFEST-PINNED segments (what fresh
      // sweet-search readers do); (b) DIRECTORY SCAN (what would happen if
      // the reader rescanned the dir, used to expose silent gaps between
      // (a) and the actual disk contents).
      const manifestSegPaths = manifestSegments
        ? manifestSegments.map((s) => path.isAbsolute(s) ? s : path.join(this.stateDir, s))
        : null;
      const manifestExisting = manifestSegPaths
        ? manifestSegPaths.filter((p) => fs.existsSync(p))
        : null;
      const manifestMissing = manifestSegPaths
        ? manifestSegPaths.filter((p) => !fs.existsSync(p)).map((p) => path.basename(p))
        : null;

      const records = manifestSegments != null
        ? resolveLatestSparseGramDeltaRecords(basePath, { maxEpoch, segments: manifestSegments })
        : new Map();
      const liveFiles = [];
      const deletedFiles = [];
      for (const { record } of records.values()) {
        if (record.deleted) deletedFiles.push(record.filePath);
        else liveFiles.push(record.filePath);
      }
      // Directory-scan reference for comparison.
      const dirSegs = listSparseGramDeltaSegments(basePath, { maxEpoch });
      out.sparse = {
        manifestSegmentCount: manifestSegments ? manifestSegments.length : null,
        manifestExisting: manifestExisting ? manifestExisting.length : null,
        manifestMissing,
        directorySegmentCount: dirSegs.length,
        recordsResolved: records.size,
        liveCount: liveFiles.length,
        deletedCount: deletedFiles.length,
        liveFiles: digest(liveFiles),
      };
    } catch (err) {
      errors.push({ surface: 'sparse', error: err.message });
    }

    return out;
  }

  /**
   * Cheap smoke test for HNSW + Binary HNSW search: run a fixed-dimension
   * zero-ish query through both indices. The goal is NOT retrieval quality;
   * the goal is to confirm that the in-memory search routines do not throw
   * or return torn results after a maintenance publish — a stale mmap or
   * torn .usearch / vectors.json would surface here.
   */
  async smoke() {
    const out = { hnsw: null, binaryHnsw: null };
    if (this.hnsw && !this.hnsw._loadError) {
      try {
        const dim = this.hnsw.dimension || 8;
        const q = new Array(dim).fill(0);
        q[0] = 1;
        const res = await this.hnsw.search(q, 5);
        out.hnsw = {
          ok: true,
          returned: res.results?.length ?? 0,
          total: res.total ?? null,
          sampleIds: (res.results || []).map((r) => r.id),
        };
      } catch (err) {
        out.hnsw = { ok: false, error: err.message };
      }
    }
    if (this.binaryHnsw && !this.binaryHnsw._loadError) {
      try {
        const dim = this.binaryHnsw.floatDimension || 8;
        const q = new Array(dim).fill(0);
        q[0] = 1;
        const res = await this.binaryHnsw.search(q, 5);
        out.binaryHnsw = {
          ok: true,
          returned: res.results?.length ?? 0,
          total: res.total ?? null,
          sampleIds: (res.results || []).map((r) => r.id),
        };
      } catch (err) {
        out.binaryHnsw = { ok: false, error: err.message };
      }
    }
    return out;
  }
}

async function main() {
  let state = null;
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  // Silence the noisy index-load `console.log`s — they'd otherwise interleave
  // with the RPC channel on stdout.
  console.log = (..._args) => {};

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try { msg = JSON.parse(trimmed); } catch (err) {
      logErr(`bad JSON: ${err.message} :: ${trimmed.slice(0, 200)}`);
      continue;
    }
    const id = msg.id;
    try {
      switch (msg.cmd) {
        case 'init': {
          state = new ReaderState(msg.args?.stateDir || process.env.SWEET_SEARCH_STATE_DIR);
          await state.loadAll();
          send({ id, ok: true, result: state.probe() });
          break;
        }
        case 'probe-cached': {
          if (!state) throw new Error('not initialised');
          send({ id, ok: true, result: state.probe() });
          break;
        }
        case 'probe-fresh': {
          if (!state) throw new Error('not initialised');
          await state.loadAll();
          send({ id, ok: true, result: state.probe() });
          break;
        }
        case 'search-smoke': {
          if (!state) throw new Error('not initialised');
          const r = await state.smoke();
          send({ id, ok: true, result: r });
          break;
        }
        case 'quit': {
          send({ id, ok: true, result: { bye: true } });
          rl.close();
          return;
        }
        default:
          throw new Error(`unknown cmd: ${msg.cmd}`);
      }
    } catch (err) {
      send({ id, ok: false, error: err.message, stack: err.stack });
    }
  }
}

main().catch((err) => {
  logErr(`fatal: ${err.stack || err.message}`);
  process.exit(1);
});
