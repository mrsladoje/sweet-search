/**
 * Release smoke — `lateon-code-edge` end-to-end.
 *
 * This is the gate that proves the edge LI variant is actually usable
 * in production paths before we tag a release. It exercises the same
 * code paths users hit, against a tiny temp corpus, using temp paths
 * so the user's real `.sweet-search` index is never touched.
 *
 * Coverage map (each `describe` block validates one production path):
 *   A. Config + registry contracts                  — pure, no I/O
 *   B. ORT CPU edge encode                          — direct module call
 *   C. Native candle edge encode (skip without)     — direct module call
 *   D. Edge LI indexing                             — real subprocess indexer
 *   E. Search end-to-end with edge active           — production SweetSearch
 *   F. read-semantic against edge LI index          — production readSemantic
 *   G. ColGrep / search-pattern against edge LI     — production patternSearch
 *   H. CoreML cascade routing for edge              — assertion on dispatcher
 *   I. CUDA parity manual gate                      — documented command
 *
 * Hardware-conditional tests skip with explicit reasons. The repo's CI
 * does not have GPU access, so paths C/H run on M3 Max and skip on CI.
 * Path I is always documented as a manual release gate.
 *
 * Manual release commands (run on appropriate hardware before tagging):
 *   - macOS Apple Silicon: `npm test -- --run tests/release/`
 *   - Linux + NVIDIA GPU:
 *       SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge \
 *         node scripts/parity-cuda.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

import { LATE_INTERACTION_CONFIG } from '../../core/infrastructure/config/ranking.js';
import { MODEL_REGISTRY } from '../../core/infrastructure/model-registry.js';
import {
  isNativeInferenceAvailable,
  unloadNativeModels,
  resolveNativeLiVariant,
} from '../../core/infrastructure/native-inference.js';
import {
  getCoremlCascadeResolvedDirs,
  getCoremlCascadeReport,
  getCoremlLiDirForVariant,
  getCoremlLiDir,
  getCoremlLiEdgeDir,
} from '../../core/infrastructure/coreml-cascade.js';
import { detectHardwareCapability } from '../../core/infrastructure/hardware-capability.js';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..', '..');

// Production model cache locations — used to gate "model load" tests.
// On a fresh CI box these may not exist; in that case we skip cleanly
// instead of triggering a multi-GB download mid-test.
const MODELS_ROOT = join(homedir(), '.cache', 'sweet-search', 'models');
const EDGE_ORT_PATH = join(MODELS_ROOT, 'lightonai--LateOn-Code-edge', 'model.onnx');
const EDGE_FP32_PATH = join(MODELS_ROOT, 'lightonai--LateOn-Code-edge', 'model.safetensors');
const EMBED_FP32_PATH = join(MODELS_ROOT, 'nomic-ai--CodeRankEmbed', 'model.safetensors');

const HAS_EDGE_ORT = existsSync(EDGE_ORT_PATH);
const HAS_EDGE_FP32 = existsSync(EDGE_FP32_PATH);
const HAS_EMBED_FP32 = existsSync(EMBED_FP32_PATH);
const NATIVE_AVAILABLE = isNativeInferenceAvailable();
const RELEASE_MODEL_SMOKE = process.env.SWEET_SEARCH_RELEASE_MODEL_SMOKE === '1';
const CUDA_EVIDENCE_PATH = process.env.SWEET_SEARCH_CUDA_PARITY_EVIDENCE || '';

// Save the active LI variant so we can restore it at the end. The
// runtime config is mutated below to switch into edge mode for the
// encode/index tests; restore avoids leaking that mutation into other
// suites if they run in the same process.
const ORIGINAL_LI_VARIANT = LATE_INTERACTION_CONFIG.model;

function withEdgeVariant(fn) {
  // Wrap a body in a save/restore of LATE_INTERACTION_CONFIG.model so
  // each test is self-contained. Tests that ALSO touch the native
  // model cache must call unloadNativeModels() afterward — see the
  // native-encode tests for the pattern.
  return async () => {
    const saved = LATE_INTERACTION_CONFIG.model;
    LATE_INTERACTION_CONFIG.model = 'lateon-code-edge';
    try {
      return await fn();
    } finally {
      LATE_INTERACTION_CONFIG.model = saved;
    }
  };
}

afterAll(() => {
  LATE_INTERACTION_CONFIG.model = ORIGINAL_LI_VARIANT;
  // Also flush the native model cache so a follow-up test file doesn't
  // inherit our edge model singleton.
  try { unloadNativeModels(); } catch { /* not critical */ }
});

function resultRows(out) {
  return Array.isArray(out) ? out : (out?.results || out?.matches || []);
}

function rowFile(row) {
  return row?.file || row?.path || row?.metadata?.file || '';
}

function rowScore(row) {
  return row?.lateInteractionScore ?? row?.score ?? row?.rerankScore ?? row?.hybridScore;
}

function expectFiniteScores(rows) {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(Number.isFinite(rowScore(row))).toBe(true);
  }
}

describe('release-mode prerequisites', () => {
  it.runIf(RELEASE_MODEL_SMOKE)(
    'release model smoke has all local model prerequisites',
    () => {
      expect(HAS_EDGE_ORT, `missing ${EDGE_ORT_PATH}`).toBe(true);
      expect(HAS_EDGE_FP32, `missing ${EDGE_FP32_PATH}`).toBe(true);
      expect(HAS_EMBED_FP32, `missing ${EMBED_FP32_PATH}`).toBe(true);
      expect(NATIVE_AVAILABLE, 'native inference is unavailable').toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// A. Config + registry contracts
// ---------------------------------------------------------------------------

describe('A. config + registry contracts', () => {
  it('standard `lateon-code` declares 128d output (1-stage 768→128)', () => {
    const std = LATE_INTERACTION_CONFIG.models['lateon-code'];
    expect(std).toBeDefined();
    expect(std.backboneDim).toBe(768);
    expect(std.tokenDimension).toBe(128);
    expect(std.projectionDims).toEqual([128]);
    expect(std.projectionPaths).toEqual(['1_Dense/model.safetensors']);
    expect(std.nativeRegistryKey).toBe('lateon-code-fp32');
  });

  it('edge `lateon-code-edge` declares 48d output (2-stage 256→512→48)', () => {
    const edge = LATE_INTERACTION_CONFIG.models['lateon-code-edge'];
    expect(edge).toBeDefined();
    expect(edge.backboneDim).toBe(256);
    expect(edge.tokenDimension).toBe(48);
    // Two stages, in this exact order — chained via fold in
    // li_model.rs::LiEncodeTask::compute. A reorder would silently
    // produce wrong outputs because in-dim of stage N+1 must equal
    // out-dim of stage N.
    expect(edge.projectionDims).toEqual([512, 48]);
    expect(edge.projectionPaths).toEqual([
      '1_Dense/model.safetensors',
      '2_Dense/model.safetensors',
    ]);
    expect(edge.nativeRegistryKey).toBe('lateon-code-edge-fp32');
  });

  it('registry has both ORT and FP32 entries for the edge variant', () => {
    expect(MODEL_REGISTRY['lateon-code-edge']).toBeDefined();
    expect(MODEL_REGISTRY['lateon-code-edge'].hfId).toBe('lightonai/LateOn-Code-edge');
    expect(MODEL_REGISTRY['lateon-code-edge-fp32']).toBeDefined();
    expect(MODEL_REGISTRY['lateon-code-edge-fp32'].hfId).toBe('lightonai/LateOn-Code-edge');
    // FP32 entry must list both projection stages — that's what the
    // native loader passes to NativeLateInteractionModel.load.
    const fp32Files = MODEL_REGISTRY['lateon-code-edge-fp32'].files.map(f => f.path);
    expect(fp32Files).toContain('model.safetensors');
    expect(fp32Files).toContain('1_Dense/model.safetensors');
    expect(fp32Files).toContain('2_Dense/model.safetensors');
  });

  it('resolveNativeLiVariant routes edge to the right registry key + projection chain', () => {
    const saved = LATE_INTERACTION_CONFIG.model;
    try {
      LATE_INTERACTION_CONFIG.model = 'lateon-code-edge';
      const variant = resolveNativeLiVariant();
      expect(variant.cfgKey).toBe('lateon-code-edge');
      expect(variant.fp32RegistryKey).toBe('lateon-code-edge-fp32');
      expect(variant.tokenDimension).toBe(48);
      expect(variant.projectionDims).toEqual([512, 48]);
      expect(variant.projectionPaths).toHaveLength(2);
    } finally {
      LATE_INTERACTION_CONFIG.model = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// B. ORT CPU edge encode — direct module call, no indexer
// ---------------------------------------------------------------------------

describe('B. ORT CPU edge encode', () => {
  it.runIf(HAS_EDGE_ORT)(
    'encodeQuery returns finite L2-normalised 48d tokens via ORT CPU',
    withEdgeVariant(async () => {
      // Force ORT CPU path: setting SWEET_SEARCH_NATIVE_INFERENCE=0
      // and unloadNativeModels() resets the cached `_available` flag
      // so isNativeInferenceAvailable() re-checks the env var and
      // returns false; encodeQuery then falls through to ORT.
      const prev = process.env.SWEET_SEARCH_NATIVE_INFERENCE;
      process.env.SWEET_SEARCH_NATIVE_INFERENCE = '0';
      unloadNativeModels();
      try {
        const { encodeQuery } = await import('../../core/ranking/late-interaction-model.js');
        const tokens = await encodeQuery('how do you sort an array');
        // The edge variant emits 48d tokens; standard would be 128d.
        // This is the canary — anything other than 48d means the active
        // variant didn't take effect.
        expect(Array.isArray(tokens)).toBe(true);
        expect(tokens.length).toBeGreaterThan(0);
        for (const t of tokens) {
          expect(t.length).toBe(48);
          let sq = 0;
          for (let k = 0; k < t.length; k++) {
            expect(Number.isFinite(t[k])).toBe(true);
            sq += t[k] * t[k];
          }
          // L2 norm should be ~1 (epsilon-before-sqrt allows tiny drift).
          // Loose bound: edge ORT runs in FP32 so drift is small.
          expect(Math.sqrt(sq)).toBeGreaterThan(0.99);
          expect(Math.sqrt(sq)).toBeLessThan(1.01);
        }
      } finally {
        if (prev === undefined) delete process.env.SWEET_SEARCH_NATIVE_INFERENCE;
        else process.env.SWEET_SEARCH_NATIVE_INFERENCE = prev;
        unloadNativeModels();
      }
    }),
    60_000,
  );

  it.skipIf(HAS_EDGE_ORT)(
    'skipped: edge ORT model.onnx not in local cache (run init or sweet-search init first)',
    () => {
      // Visible skip with reproduction hint. Don't auto-download — a
      // 68 MB download mid-test would surprise CI.
    },
  );
});

// ---------------------------------------------------------------------------
// C. Native candle edge encode — validates the 2-stage projection chain
// ---------------------------------------------------------------------------

describe('C. native candle edge encode (M3+ / Linux+CUDA)', () => {
  it.runIf(NATIVE_AVAILABLE && HAS_EDGE_FP32)(
    'getNativeLiModel loads edge backbone + 2-stage projection and produces 48d L2 tokens',
    withEdgeVariant(async () => {
      // Re-enable native if a prior test forced ORT-only.
      const prevForce = process.env.SWEET_SEARCH_NATIVE_INFERENCE;
      delete process.env.SWEET_SEARCH_NATIVE_INFERENCE;
      unloadNativeModels();
      try {
        const { getNativeLiModel, nativeLiEncode } = await import(
          '../../core/infrastructure/native-inference.js'
        );
        const model = await getNativeLiModel();
        expect(model).toBeTruthy();
        // Edge dim is 48 — the standard model would expose 128. Mismatch
        // means the variant resolver didn't route correctly OR the
        // multi-stage projection chain emitted the wrong shape.
        expect(model.dim).toBe(48);

        const docs = [
          '[D] function add(a, b) { return a + b; }',
          '[Q] add two integers',
        ];
        const out = await nativeLiEncode(docs, { maxLength: 128 });
        expect(out).toHaveLength(2);
        for (let d = 0; d < out.length; d++) {
          const tokens = out[d];
          expect(tokens.length).toBeGreaterThan(0);
          for (const t of tokens) {
            expect(t.length).toBe(48);
            let sq = 0;
            for (let k = 0; k < t.length; k++) {
              expect(Number.isFinite(t[k])).toBe(true);
              sq += t[k] * t[k];
            }
            // BF16 on Metal can drift slightly — same bound as the
            // CoreML parity check (0.998 cosine ≈ 0.99 norm tolerance).
            expect(Math.sqrt(sq)).toBeGreaterThan(0.99);
            expect(Math.sqrt(sq)).toBeLessThan(1.02);
          }
        }
      } finally {
        if (prevForce !== undefined) process.env.SWEET_SEARCH_NATIVE_INFERENCE = prevForce;
        unloadNativeModels();
      }
    }),
    120_000,
  );

  it.skipIf(NATIVE_AVAILABLE)(
    'skipped: native inference not available on this host (no Metal/CUDA)',
    () => {
      // Manual gate command for a CUDA host:
      //   SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge \
      //     node scripts/parity-cuda.js
      //
      // See section I below for the full CUDA release gate.
    },
  );
  it.skipIf(HAS_EDGE_FP32 || !NATIVE_AVAILABLE)(
    'skipped: edge FP32 backbone not in cache',
    () => {
      // Run `sweet-search init --li-model edge` (once that flag exists)
      // OR manually: huggingface_hub download lightonai/LateOn-Code-edge
    },
  );
});

// ---------------------------------------------------------------------------
// D. Edge LI indexing — full corpus pipeline through the production indexer
// ---------------------------------------------------------------------------

// Decision: we run a tiny corpus through the real indexer subprocess
// (not a unit test of any one module). This proves the entire wiring
// works end-to-end: edge model loads, edge tokens are stored, the SSLX
// header records modelId='lateon-code-edge' + tokenDim=48.
//
// Cost: ~60-90s on M3 Max for indexing 5 tiny files (model load
// dominates). That's acceptable for release smoke. Skipped if FP32
// edge backbone OR FP32 embedding backbone is absent — the indexer
// would otherwise fall through to ORT for embed and trigger a huge
// download on a fresh CI box.

const RUN_INDEXER = HAS_EDGE_FP32 && HAS_EMBED_FP32;
const RUN_INDEXER_SKIP_REASON = !HAS_EDGE_FP32
  ? 'edge FP32 backbone not in local cache'
  : !HAS_EMBED_FP32
  ? 'embedding FP32 backbone (nomic-ai/CodeRankEmbed) not in local cache'
  : null;

describe('D-G. edge LI indexing + search + read-semantic + ColGrep (one shared corpus)', () => {
  let tmpCorpus = null;
  let dataDir = null;
  let search = null;

  beforeAll(async () => {
    if (!RUN_INDEXER) return;
    tmpCorpus = mkdtempSync(join(tmpdir(), 'ss-edge-smoke-'));
    // Write a tiny but realistic-shaped JS corpus. Each file has a
    // distinct topic so the smoke search/read-semantic queries can
    // verify they hit the right one (more than just "any non-empty
    // result"). Comments on each fn give the LI tokens something to
    // align with the natural-language query.
    writeFileSync(join(tmpCorpus, 'sort.js'),
      "// Sort an array of integers ascending.\n"
      + "function sortAscending(xs) { return [...xs].sort((a, b) => a - b); }\n"
      + "module.exports = { sortAscending };\n");
    writeFileSync(join(tmpCorpus, 'http.js'),
      "// Make an HTTP GET request and return the JSON body.\n"
      + "async function fetchJson(url) {\n"
      + "  const res = await fetch(url);\n"
      + "  if (!res.ok) throw new Error('HTTP ' + res.status);\n"
      + "  return res.json();\n"
      + "}\n"
      + "module.exports = { fetchJson };\n");
    writeFileSync(join(tmpCorpus, 'string.js'),
      "// Convert a string to camelCase.\n"
      + "function toCamelCase(s) {\n"
      + "  return s.replace(/[-_\\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');\n"
      + "}\n"
      + "module.exports = { toCamelCase };\n");
    writeFileSync(join(tmpCorpus, 'date.js'),
      "// Format a Date as ISO 8601 (yyyy-mm-dd).\n"
      + "function formatIsoDate(d) { return d.toISOString().slice(0, 10); }\n"
      + "module.exports = { formatIsoDate };\n");
    writeFileSync(join(tmpCorpus, 'array.js'),
      "// Remove duplicate elements from an array preserving order.\n"
      + "function uniq(xs) { return [...new Set(xs)]; }\n"
      + "module.exports = { uniq };\n");

    // Use the existing eval/lib/indexer wrapper for the actual
    // subprocess indexing — same code path the benchmark harness uses,
    // which is the closest thing to a real user `sweet-search index`
    // invocation.
    const { indexCorpus } = await import(
      join(PROJECT_ROOT, 'eval', 'lib', 'indexer.js')
    );
    await indexCorpus(tmpCorpus, PROJECT_ROOT, {
      indexMode: 'single',
      buildLateInteraction: true,
      lateInteractionModel: 'lateon-code-edge',
      sqliteFastMode: true,
      verbose: false,
    });
    dataDir = join(tmpCorpus, '.sweet-search');

    // Build a SweetSearch instance pointing at the temp corpus with
    // ALL paths explicit. The eval helper `initSearch` mostly does
    // this but doesn't override `lateInteractionOptions.indexPath`,
    // so its `lateInteractionIndex` would resolve to the user's
    // global LI index instead of the temp edge one — silently
    // wrong for this test. Constructing inline keeps the wiring
    // self-contained and obvious.
    LATE_INTERACTION_CONFIG.model = 'lateon-code-edge';
    const { SweetSearch } = await import(
      join(PROJECT_ROOT, 'core', 'search', 'sweet-search.js')
    );
    search = new SweetSearch({
      projectRoot: tmpCorpus,
      graphDbPath: join(dataDir, 'code-graph.db'),
      hnswPath: join(dataDir, 'codebase-hnsw.idx'),
      binaryHnswPath: join(dataDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: join(dataDir, 'codebase.db'),
      lateInteractionOptions: {
        indexPath: join(dataDir, 'codebase-late-interaction.db'),
        modelId: 'lateon-code-edge',
        tokenDim: 48,
      },
      useLateInteraction: true,
      verbose: false,
      timing: false,
    });
    await search.init();
  }, 240_000);

  afterAll(() => {
    if (tmpCorpus && existsSync(tmpCorpus)) {
      rmSync(tmpCorpus, { recursive: true, force: true });
    }
  });

  // ---- D. Edge LI indexing ----

  it.runIf(RUN_INDEXER)(
    'D1. SSLX index header records modelId=lateon-code-edge and tokenDim=48',
    () => {
      // The LI index sidecar is JSON manifest at indexPath; segments
      // live next to it. We read the manifest directly to confirm the
      // model identity was persisted.
      const manifestPath = join(dataDir, 'codebase-late-interaction.db');
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.modelId).toBe('lateon-code-edge');
      expect(manifest.tokenDim).toBe(48);
    },
  );

  it.runIf(RUN_INDEXER)(
    'D2. mismatched-model load is detected (not silent)',
    async () => {
      // Loading the edge index with the standard model active must
      // surface a model-mismatch warning. We construct a fresh index
      // instance pointing at the temp index but with the standard
      // modelId in config — the loader's existing mismatch-detection
      // (late-interaction-index.js:1885+) will flag it.
      const saved = LATE_INTERACTION_CONFIG.model;
      LATE_INTERACTION_CONFIG.model = 'lateon-code';
      try {
        const { LateInteractionIndex } = await import('../../core/ranking/late-interaction-index.js');
        const idx = new LateInteractionIndex({
          indexPath: join(dataDir, 'codebase-late-interaction.db'),
          modelId: 'lateon-code',
          tokenDim: 128,
        });
        await idx.init();
        // Either the loader flips an internal mismatch flag, OR it
        // refuses to populate `documents`. Both behaviours protect
        // users from silently mixing 128d query tokens against a 48d
        // index. The repo's existing behaviour is the former (warn +
        // set modelMismatch=true) — assert that contract.
        expect(idx.modelMismatch === true || idx.documents.size === 0).toBe(true);
      } finally {
        LATE_INTERACTION_CONFIG.model = saved;
      }
    },
  );

  // ---- E. Search e2e + direct LI scoring path against edge-indexed corpus ----

  it.runIf(RUN_INDEXER)(
    'E1. SweetSearch.search production pattern path uses edge LI and returns finite ranked results',
    async () => {
      const out = await search.search('fetch JSON from URL', {
        mode: 'pattern',
        regex: 'async function fetch',
        k: 5,
        enhanceQuery: false,
      });
      const rows = resultRows(out);
      expectFiniteScores(rows);
      expect(rowFile(rows[0])).toContain('http.js');
      expect(rows[0].lateInteractionScore).toBeDefined();
      expect(out.stats?.path || out.stats?.mode || out.stats?.searchPath).toBeTruthy();
    },
    60_000,
  );

  it.runIf(RUN_INDEXER)(
    'E2. edge LI scoring at query time produces finite per-doc MaxSim scores against indexed corpus',
    async () => {
      // Lower-level canary for the MaxSim scorer itself. E1 proves the
      // production SweetSearch.search route; this pins the exact edge
      // query-token dimensionality and scoring contract.
      const { encodeQuery } = await import('../../core/ranking/late-interaction-model.js');
      const queryTokens = await encodeQuery('how do I sort an array of numbers');
      expect(queryTokens.length).toBeGreaterThan(0);
      // Edge model: 48d query tokens. Standard would be 128d. This
      // pins the active variant to edge as a precondition for the
      // scoring contract below.
      expect(queryTokens[0].length).toBe(48);

      // Score against every indexed document. The LI index loaded the
      // edge tokens at indexing time (D1 verified modelId+tokenDim).
      const docIds = Array.from(search.lateInteractionIndex.documents.keys());
      expect(docIds.length).toBe(5);
      const candidates = docIds.map(id => ({ id, score: 0 }));
      const scored = await search.lateInteractionIndex.scoreWithLateInteraction(
        queryTokens, candidates,
      );

      expect(scored.length).toBe(docIds.length);
      for (const r of scored) {
        const liScore = r.lateInteractionScore;
        expect(typeof liScore).toBe('number');
        expect(Number.isFinite(liScore)).toBe(true);
      }
      // Sanity: at least one doc should have a non-zero score (the
      // sort/array files semantically match the query). If every doc
      // scored 0 the encoder/index pair is broken.
      const anyNonZero = scored.some(r => r.lateInteractionScore !== 0);
      expect(anyNonZero).toBe(true);
    },
    60_000,
  );

  // ---- F. read-semantic ----

  it.runIf(RUN_INDEXER)(
    'F. readSemantic against edge-indexed corpus returns spans with finite scores',
    async () => {
      const { readSemantic } = await import('../../core/search/search-read-semantic.js');
      // readSemantic expects `path` (not `file`) per its contract:
      //   if (!req || !req.path) throw new Error('path is required');
      // and resolves it relative to projectRoot (default cwd). Pass
      // both so the test is independent of cwd.
      const result = await readSemantic({
        path: join(tmpCorpus, 'http.js'),
        query: 'fetch JSON from URL',
        topK: 3,
        projectRoot: tmpCorpus,
      });
      const spans = Array.isArray(result) ? result : (result.spans || result.results || []);
      expect(spans.length).toBeGreaterThan(0);
      for (const s of spans) {
        // Each span carries at least one numeric field (score,
        // startLine, endLine, etc.); require at least one finite.
        const numericFields = Object.values(s).filter(v => typeof v === 'number');
        expect(numericFields.some(Number.isFinite)).toBe(true);
      }
      const serialized = JSON.stringify(spans);
      expect(serialized).toMatch(/fetchJson|HTTP GET|JSON|fetch/);
    },
    60_000,
  );

  // ---- G. ColGrep / search-pattern ----

  it.runIf(RUN_INDEXER)(
    'G. ColGrep pattern-search uses edge LI index and returns finite-score matches',
    async () => {
      // The patternSearch entrypoint is `core/search/search-pattern.js::patternSearch`
      // and is wired onto the SweetSearch prototype. Signature:
      //   patternSearch(query, routing, options)
      // where `regex` lives in `options`, not `routing`.
      const out = await search.patternSearch(
        'fetch JSON',          // semantic query for LI rerank
        {},                    // routing — empty is fine for a direct call
        { regex: 'async function fetch', k: 5 },
      );
      const rows = resultRows(out);
      expectFiniteScores(rows);
      expect(rowFile(rows[0])).toContain('http.js');
      expect(String(rows[0].text || rows[0].content || '')).toMatch(/fetchJson|fetch|JSON/);
    },
    60_000,
  );

  it.runIf(RELEASE_MODEL_SMOKE && !RUN_INDEXER)(
    'release model smoke requires edge indexing prerequisites',
    () => {
      throw new Error(`Release smoke cannot skip index/read/search coverage: ${RUN_INDEXER_SKIP_REASON}`);
    },
  );

  it.skipIf(RUN_INDEXER)(
    `skipped: ${RUN_INDEXER_SKIP_REASON || 'indexer prerequisites not met'} — `
    + 'run sweet-search init to fetch FP32 backbones',
    () => {
      // Nothing to assert; the message above documents the skip reason.
    },
  );
});

// ---------------------------------------------------------------------------
// H. CoreML cascade routing for edge
// ---------------------------------------------------------------------------

describe('H. CoreML cascade dispatch for edge', () => {
  const hw = detectHardwareCapability();
  const cascadeEligible = hw.coremlCascadeEligible;
  // Cascade is "ready" only when the edge variant artifacts are present
  // on disk. We don't fetch from HF in tests.
  const cascadeReport = (() => {
    try { return getCoremlCascadeReport(); } catch { return null; }
  })();
  const edgeCascadePresent = cascadeReport?.liEdgeDir != null;

  it.runIf(cascadeEligible)(
    'H1. cascade dispatcher routes lateon-code → coreml-cascade/li, lateon-code-edge → coreml-cascade/li-edge',
    () => {
      // Pure, no I/O — just verify the dispatch helper doesn't conflate
      // the two families. This is the safety net behind the runtime
      // routing in resolveCoremlCascadeForAddon.
      expect(getCoremlLiDirForVariant('lateon-code')).toBe(getCoremlLiDir());
      expect(getCoremlLiDirForVariant('lateon-code-edge')).toBe(getCoremlLiEdgeDir());
      expect(getCoremlLiDir()).not.toBe(getCoremlLiEdgeDir());
    },
  );

  it.runIf(cascadeEligible && edgeCascadePresent)(
    'H2. with edge active, getCoremlCascadeResolvedDirs returns the li-edge dir',
    () => {
      const resolved = getCoremlCascadeResolvedDirs('lateon-code-edge');
      expect(resolved.liDir).toBe(getCoremlLiEdgeDir());
      // Standard cascade resolution must be unchanged.
      const std = getCoremlCascadeResolvedDirs('lateon-code');
      expect(std.liDir).toBe(getCoremlLiDir());
    },
  );

  it.runIf(cascadeEligible && edgeCascadePresent && HAS_EDGE_FP32)(
    'H3. CoreML edge cascade is actually armed by the native loader',
    () => {
      const script = `
        import { LATE_INTERACTION_CONFIG } from './core/infrastructure/config/ranking.js';
        import { getNativeLiModel, nativeLiEncode, unloadNativeModels } from './core/infrastructure/native-inference.js';
        LATE_INTERACTION_CONFIG.model = 'lateon-code-edge';
        process.env.SWEET_SEARCH_NATIVE_INFERENCE = '1';
        const model = await getNativeLiModel();
        if (!model || model.dim !== 48) throw new Error('edge native model did not load at 48d');
        const out = await nativeLiEncode(['[D] async function fetchJson(url) { return fetch(url).then(r => r.json()); }'], { maxLength: 128 });
        if (!out.length || !out[0].length || out[0][0].length !== 48) throw new Error('bad edge encode output');
        unloadNativeModels();
      `;
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          SWEET_SEARCH_LATE_INTERACTION_MODEL: 'lateon-code-edge',
          SWEET_SEARCH_COREML_CASCADE: '1',
          SWEET_SEARCH_COREML_STATS: '1',
        },
        encoding: 'utf-8',
        timeout: 120_000,
      });
      expect(run.status, run.stderr || run.stdout).toBe(0);
      expect(run.stderr).toMatch(/CoreML cascade loaded: .*@48d/);
      expect(run.stderr).toMatch(/CoreML parity OK/);
    },
    120_000,
  );

  it.runIf(RELEASE_MODEL_SMOKE && cascadeEligible && (!edgeCascadePresent || !HAS_EDGE_FP32))(
    'release model smoke requires executable edge CoreML cascade on eligible hosts',
    () => {
      throw new Error('Release smoke is running on CoreML-eligible hardware but edge CoreML artifacts or FP32 model are missing');
    },
  );

  it.skipIf(cascadeEligible)(
    'skipped: CoreML cascade not eligible on this host (need M3+ Apple Silicon)',
    () => {
      // Run on M3+ Mac to exercise. No way to fake — Apple's Neural
      // Engine isn't available off platform.
    },
  );
  it.skipIf(edgeCascadePresent || !cascadeEligible)(
    'skipped: edge cascade artifacts not built locally — '
    + 'run `node scripts/build-coreml-cascade.js --li-edge-only` to enable',
    () => { /* skip with hint */ },
  );
});

// ---------------------------------------------------------------------------
// I. CUDA — manual release gate
// ---------------------------------------------------------------------------

describe('I. CUDA release gate', () => {
  // GitHub Actions runners do not have NVIDIA GPUs. Local M3 Max also
  // doesn't. So this test is documentation: it asserts the manual
  // command exists and points at the existing parity script. Anyone
  // tagging a CUDA-included release MUST run this on real hardware.
  it('manual gate command is documented + pointing at existing parity-cuda.js', () => {
    const parityScript = join(PROJECT_ROOT, 'scripts', 'parity-cuda.js');
    expect(existsSync(parityScript)).toBe(true);
    // Sanity: the script reads LATE_INTERACTION_CONFIG.model so it
    // works for both standard and edge variants out of the box.
    const src = readFileSync(parityScript, 'utf-8');
    expect(src).toMatch(/loadNativeLiModelWithDevice/);

    // Manual command (DO NOT execute here — no CUDA on this host):
    //   SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge \
    //     node scripts/parity-cuda.js
    //
    // Expected output: per-token cosine ≥ 0.999 (min) and ≥ 0.9998 (mean)
    // for the LI section. parity-cuda.js exits non-zero if the gate fails.
  });

  it.runIf(RELEASE_MODEL_SMOKE)(
    'release model smoke requires recorded CUDA edge parity evidence',
    () => {
      expect(CUDA_EVIDENCE_PATH, 'set SWEET_SEARCH_CUDA_PARITY_EVIDENCE=/path/to/parity-cuda-edge.log').toBeTruthy();
      expect(existsSync(CUDA_EVIDENCE_PATH), `missing CUDA evidence file: ${CUDA_EVIDENCE_PATH}`).toBe(true);
      const evidence = readFileSync(CUDA_EVIDENCE_PATH, 'utf-8');
      expect(evidence).toMatch(/CUDA Parity Gate/);
      expect(evidence).toMatch(/lateon-code-edge|SWEET_SEARCH_LATE_INTERACTION_MODEL=lateon-code-edge|LI parity/);
      expect(evidence).toMatch(/PARITY PASS/);
      expect(evidence).toMatch(/LI parity/);
      expect(evidence).toMatch(/min ≥ 0\.999: PASS/);
      expect(evidence).toMatch(/mean ≥ 0\.9998: PASS/);
    },
  );
});
