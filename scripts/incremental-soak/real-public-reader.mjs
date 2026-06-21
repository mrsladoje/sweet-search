#!/usr/bin/env node
/**
 * Long-lived public-reader worker for the real-daemon validation harness.
 *
 * Instantiates the same `SweetSearch` class the warm search server
 * (core/search/search-server.js:131-133) and the MCP server
 * (mcp/server.js -> getWarmSearcher) use, then drives queries through
 * `SweetSearch.search()` — the same call the HTTP request handler makes.
 *
 * This worker deliberately exercises:
 *   - `_refreshManifestPins`         (called on every search; re-reads manifest)
 *   - `_syncManifestPaths`           (re-binds sparseGramDeltas on every search)
 *   - `_reloadManifestArtifacts`     (HNSW / Binary HNSW / LI / sparse-gram reload)
 *   - `loadSparseDeltaOverlay`       (manifest-pinned delta segments)
 *   - `searcher.patternSearch`       (pattern/regex public path)
 *
 * Search is restricted to pattern (regex) mode so the worker does NOT need
 * real ORT encoders. This mirrors the existing soak-harness convention
 * (REPORT.md §2 "Encoder substitution") and constrains the validation to
 * **index coherence**, not retrieval quality.
 *
 * Commands (one JSON object per line on stdin):
 *   { "id":N, "cmd":"init",           "args":{ "stateDir":"...", "projectRoot":"..." } }
 *   { "id":N, "cmd":"pattern-search", "args":{ "regex":"..." } }
 *   { "id":N, "cmd":"manifest-state" }
 *   { "id":N, "cmd":"quit" }
 *
 * Responses on stdout:
 *   { "id":N, "ok":true,  "result":{...} }
 *   { "id":N, "ok":false, "error":"...", "stack":"..." }
 *
 * stderr is the worker's own log; the orchestrator surfaces lines as events.
 *
 * IMPORTANT: stdout is reserved for RPC. Anything that writes to stdout will
 * corrupt the channel. We redirect `console.log` to stderr at startup, the
 * same defence the MCP server uses (mcp/server.js:5-6).
 */

// Stdout protection MUST happen before any sweet-search module is loaded.
// SweetSearch.init() prints `[Server] ...` / `LocalReranker: ...` style logs
// to stdout; those would corrupt the RPC stream.
const _origConsoleLog = console.log;
console.log = (...args) => console.error(...args);

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';

// Pin the project root + state dir via env BEFORE config/platform.js is loaded.
// `core/infrastructure/config/platform.js` resolves PROJECT_ROOT at module load
// time from `process.env.SWEET_SEARCH_PROJECT_ROOT`. If the env isn't set
// when the module loads, all subsequent DB_PATHS will point at the wrong dir.
// The orchestrator sets the env before spawning, but we re-assert here for
// defence in depth.
if (!process.env.SWEET_SEARCH_PROJECT_ROOT) {
  process.stderr.write('[real-public-reader] FATAL: SWEET_SEARCH_PROJECT_ROOT not set\n');
  process.exit(1);
}
if (!process.env.SWEET_SEARCH_STATE_DIR) {
  process.stderr.write('[real-public-reader] FATAL: SWEET_SEARCH_STATE_DIR not set\n');
  process.exit(1);
}

// Dynamic import so the env knobs above land first.
const { SweetSearch } = await import('../../core/search/sweet-search.js');
const { readManifest } = await import('../../core/incremental-indexing/infrastructure/manifest.mjs');

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function logErr(msg) {
  process.stderr.write(`[reader pid=${process.pid}] ${msg}\n`);
}

class PublicReader {
  constructor({ stateDir, projectRoot }) {
    this.stateDir = path.resolve(stateDir);
    this.projectRoot = path.resolve(projectRoot);
    this.searcher = null;
    this.spawnedAt = Date.now();
    this.queryCount = 0;
  }

  async init() {
    // grep-only init keeps us off the encoder hot path. SweetSearch.search()
    // with mode='pattern' will call init() (full) under the hood when it
    // actually needs the codebase db; for sparse-gram-only the grep-only
    // init is enough. We explicitly call initGrepOnly() so we exercise the
    // grep-only public entrypoint too.
    this.searcher = new SweetSearch({
      projectRoot: this.projectRoot,
      verbose: false,
      // Force grep-only path: pattern search doesn't need a reranker.
      useLateInteraction: false,
    });
    await this.searcher.initGrepOnly();
  }

  async patternSearch(regex) {
    if (!this.searcher) throw new Error('reader not initialised');
    if (typeof regex !== 'string' || regex.length === 0) {
      throw new Error('regex must be a non-empty string');
    }
    const t0 = performance.now();
    // mode='grep' routes to SweetSearch.bareGrep (search-pattern.js:82). This
    // is the public grep-only path used by `sweet-search --mode lexical ...`
    // and by the warm-server `mode=grep` query string. It calls
    // `_refreshManifestPins({ reloadScope: 'grep' })` (exercising the same
    // sparse-gram delta overlay path the warm server uses) but does NOT
    // require the LateInteraction index — which lets us stay on the
    // grep-only init code path and avoid encoder warmup.
    const result = await this.searcher.search(regex, {
      regex,
      mode: 'grep',
      k: 50,
      rerank: false,
      useLateInteraction: false,
    });
    const elapsed = performance.now() - t0;
    this.queryCount += 1;

    // Project hit shape down to what the orchestrator needs to assert. The
    // warm server returns the same fields plus stats. We keep a compact
    // subset to keep the JSONL channel small.
    const results = (result?.results || []).slice(0, 50).map((r) => ({
      file: r.file_path || r.filePath || r.file || null,
      line: r.line ?? r.start_line ?? null,
      name: r.symbol_name || r.name || null,
      type: r.symbol_type || r.type || null,
      score: typeof r.score === 'number' ? Number(r.score.toFixed(4)) : null,
    }));

    return {
      queryCount: this.queryCount,
      elapsedMs: Math.round(elapsed),
      regex,
      hitCount: results.length,
      hits: results,
      searcherManifestEpoch: this.searcher.manifestEpoch ?? null,
      searcherArtifactEpoch: this.searcher._artifactManifestEpoch ?? null,
      sparseDeltaCount: Array.isArray(this.searcher.sparseGramDeltas)
        ? this.searcher.sparseGramDeltas.length
        : null,
    };
  }

  manifestState() {
    const onDisk = readManifest(this.stateDir);
    return {
      stateDir: this.stateDir,
      spawnedAt: this.spawnedAt,
      queryCount: this.queryCount,
      // Searcher's IN-MEMORY view (what _syncManifestPaths last bound).
      searcherView: {
        manifestEpoch: this.searcher?.manifestEpoch ?? null,
        artifactEpoch: this.searcher?._artifactManifestEpoch ?? null,
        sparseGramWeightsId: this.searcher?.sparseGramWeightsId ?? null,
        sparseGramDeltas: Array.isArray(this.searcher?.sparseGramDeltas)
          ? [...this.searcher.sparseGramDeltas]
          : null,
        binaryHnswIndexPath: this.searcher?.binaryHnswPath ?? null,
        codebaseDbPath: this.searcher?.codebaseDbPath ?? null,
        graphDbPath: this.searcher?.graphDbPath ?? null,
      },
      // FRESH on-disk view; orchestrator compares with searcherView to flag
      // staleness / mismatch windows.
      onDisk: onDisk ? {
        epoch: onDisk.epoch ?? null,
        sparseGramEpoch: onDisk.sparseGram?.epoch ?? null,
        sparseGramWeightsId: onDisk.sparseGram?.weightsId ?? null,
        sparseGramDeltas: Array.isArray(onDisk.sparseGram?.deltas)
          ? [...onDisk.sparseGram.deltas]
          : null,
      } : null,
    };
  }
}

let reader = null;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

process.on('SIGTERM', () => { try { rl.close(); } catch {} process.exit(0); });
process.on('SIGINT',  () => { try { rl.close(); } catch {} process.exit(0); });

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
        if (reader) throw new Error('already initialised');
        reader = new PublicReader({
          stateDir: msg.args?.stateDir || process.env.SWEET_SEARCH_STATE_DIR,
          projectRoot: msg.args?.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT,
        });
        await reader.init();
        send({ id, ok: true, result: reader.manifestState() });
        break;
      }
      case 'pattern-search': {
        if (!reader) throw new Error('not initialised');
        const out = await reader.patternSearch(msg.args?.regex);
        send({ id, ok: true, result: out });
        break;
      }
      case 'manifest-state': {
        if (!reader) throw new Error('not initialised');
        send({ id, ok: true, result: reader.manifestState() });
        break;
      }
      case 'quit': {
        send({ id, ok: true, result: { bye: true, queryCount: reader?.queryCount ?? 0 } });
        rl.close();
        process.exit(0);
      }
      default:
        throw new Error(`unknown cmd: ${msg.cmd}`);
    }
  } catch (err) {
    send({ id, ok: false, error: err.message, stack: err.stack });
  }
}

// Silence unused-warning for the stashed reference; we kept it solely to
// document the redirect contract above.
void _origConsoleLog;
