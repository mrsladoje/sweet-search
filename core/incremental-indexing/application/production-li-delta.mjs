import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LateInteractionIndex } from '../../ranking/late-interaction-index.js';
import { encodeDocumentsCpu } from '../../ranking/late-interaction-model.js';
import {
  openSegmentState,
  tombstoneDoc,
  persistSegmentState,
  nextSegmentSeq,
} from '../infrastructure/li-segment-state.mjs';

/**
 * Step 2b: PROCESS-scoped verified-identity cache for the positions-only reader.
 * segment path -> filesystem identity key of the last read whose whole-file
 * CRC32 was verified.
 *
 * It must be process-scoped, not instance-scoped: the index maintainer builds a
 * FRESH reconciler adapter for every tick, so an instance-scoped cache would be
 * empty on every tick and every tick would re-checksum the whole segment set —
 * which would make this step slower than what it replaces, not faster.
 *
 * `_loadSegmented` prunes the entries of a segment directory whose segments
 * leave the manifest. The size cap below is the second bound, for a process
 * that touches many short-lived index directories (test runs, multi-repo
 * tooling). Clearing only costs one extra verified read per live segment.
 */
const segmentIdentityCache = new Map();
const SEGMENT_IDENTITY_CACHE_MAX = 4096;

/** Test seam: drop all remembered segment identities. */
export function resetSegmentIdentityCache() {
  segmentIdentityCache.clear();
}

function defaultPositionsCache() {
  if (segmentIdentityCache.size > SEGMENT_IDENTITY_CACHE_MAX) segmentIdentityCache.clear();
  return segmentIdentityCache;
}

/**
 * Step 2b kill switch — `SWEET_SEARCH_LI_POSITIONS_ONLY=0|off|false|no` puts the
 * delta path back on the HEAD full-token loader.
 *
 * This exists so proof obligation 4.2 ("replay a fixed dirty-file sequence with
 * the flags on and off; the artifacts must be byte-identical") can be executed
 * as a real two-arm replay rather than as two variants of the same new reader.
 * It is read once per delta call, off the query path.
 */
function positionsOnlyEnabled(env = process.env) {
  const raw = env.SWEET_SEARCH_LI_POSITIONS_ONLY;
  if (raw == null || raw === '') return true; // default-on
  const token = String(raw).trim().toLowerCase();
  return !(token === '0' || token === 'off' || token === 'false' || token === 'no');
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function segmentedState(indexPath) {
  const stub = readJson(indexPath);
  if (stub?.format !== 'segmented' || !stub.segmentDir) return null;
  const segmentDir = path.resolve(path.dirname(indexPath), stub.segmentDir);
  const manifestPath = path.join(segmentDir, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (!manifest || !Array.isArray(manifest.segments)) return null;
  return { segmentDir, manifestPath, manifest };
}

function manifestFromIndex(index) {
  return {
    version: '3.0',
    format: 'sslx-v3',
    modelId: index.modelId,
    tokenDim: index.tokenDim,
    matryoshkaDim: index.matryoshkaDim || 0,
    maxTokens: index.maxTokens,
    useInt8: index.useInt8,
    quantBits: index.quantBits || (index.useInt8 ? 8 : 32),
    poolFactor: index.poolFactor || 1,
    whtSeed: index.whtSeed || 0,
    whtOrdering: index.whtOrdering || 'natural',
    totalDocuments: 0,
    nextSeq: 0,
    segments: [],
  };
}

async function writeJsonAtomic(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fsp.rename(tmp, filePath);
}

async function appendGrowingSegment(indexPath, index, docs) {
  if (docs.size === 0) return 0;
  const existing = segmentedState(indexPath);
  const segmentDir = existing?.segmentDir || `${indexPath}.segments`;
  const manifestPath = existing?.manifestPath || path.join(segmentDir, 'manifest.json');
  const manifest = existing?.manifest || manifestFromIndex(index);
  await fsp.mkdir(segmentDir, { recursive: true });

  const seq = nextSegmentSeq(manifest);
  const segName = `segment-${String(seq).padStart(4, '0')}.bin`;
  const segPath = path.join(segmentDir, segName);
  await index._writeSegmentFile(segPath, docs);
  manifest.segments.push({ path: segName, count: docs.size });
  manifest.nextSeq = seq + 1;
  manifest.totalDocuments = (manifest.totalDocuments || 0) + docs.size;

  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(indexPath, {
    version: '3.0',
    format: 'segmented',
    segmentDir: path.basename(segmentDir),
  });
  return docs.size;
}

async function rewriteLegacyIndex(index, ops, liEncoder, pickLiInput, onProgress = null) {
  const progress = typeof onProgress === 'function'
    ? (phase) => { onProgress(phase); }
    : () => {};
  let tombstone = 0;
  for (const op of ops) {
    if (op.retireId && index.documents.delete(op.retireId)) tombstone += 1;
  }
  const addOps = ops.filter((op) => op.addId && op.chunk);
  const texts = addOps.map(({ chunk }) => pickLiInput(chunk));
  progress('li:encode:start');
  const tokens = texts.length > 0 ? await liEncoder(texts) : [];
  progress('li:encode:done');
  let appended = 0;
  for (let i = 0; i < addOps.length; i += 1) {
    if (!tokens[i] || tokens[i].length === 0) continue;
    const { addId, chunk } = addOps[i];
    await index.add(addId, tokens[i], {
      file: chunk.file,
      name: chunk.metadata?.symbol,
      type: chunk.metadata?.chunk_type,
      startLine: chunk.metadata?.line_start || null,
      endLine: chunk.metadata?.line_end || null,
    });
    appended += 1;
    if (appended % 100 === 0) progress('li:legacy-add');
  }
  await index.save();
  progress('li:legacy-save');
  return { appended, tombstone };
}

export async function applyLateInteractionDelta({
  indexPath,
  ops,
  liEncoder,
  pickLiInput,
  onProgress = null,
  readerCache = null,
  positionsCache = null,
}) {
  const progress = typeof onProgress === 'function'
    ? (phase) => { onProgress(phase); }
    : () => {};
  if (!Array.isArray(ops) || ops.length === 0) {
    return { appended: 0, tombstone: 0 };
  }

  const encode = liEncoder || ((texts) => encodeDocumentsCpu(texts));
  const existing = fs.existsSync(indexPath);
  const segmented = existing ? segmentedState(indexPath) : null;

  // E.1-LI reader cache: reuse the loaded read view across the tick's files.
  // Only the SEGMENTED path is cacheable — everything the reader serves there
  // (config fields, positions/counts of pre-tick docs) is immutable within a
  // tick: per-file ops only reference the file's own pre-tick docs, appends
  // go through appendGrowingSegment (which re-reads the manifest from disk),
  // and tombstone sidecar state is opened fresh per call. The legacy path
  // MUTATES the loaded index (rewriteLegacyIndex), so it always loads fresh
  // and drops any cached reader.
  const cacheable = !!(readerCache && segmented);
  let index;
  if (cacheable && readerCache.index && readerCache.key === indexPath) {
    index = readerCache.index;
    progress('li:init-cached');
  } else {
    // Step 2b POSITIONS-ONLY READER. Everything this function reads off the
    // loaded index is either manifest config (tokenDim, quantBits, …, copied
    // onto the writer) or segment bookkeeping (`_docSegmentPositions`,
    // `_segments[].count`). It never reads a token. Flattening every segment's
    // token slab into `documents` cost ~1.4 GB of fresh external allocation on
    // every working tick and produced the RSS peaks that tripped the recycle
    // ceiling. The legacy single-file path is excluded: `rewriteLegacyIndex`
    // MUTATES `index.documents` and re-saves it, so it needs the full load.
    //
    // SCOPE, stated so no soak gate is written against a bound this does not
    // give: this removes the flatten from the RECONCILE tick only. The inline
    // maintenance drain that runs immediately after every tick
    // (`drainMaintenanceInline`, default-ON) still performs the identical full
    // load inside `liSegmentHandler` and `mergeLiSegments`. Those two are
    // single-segment compaction and segment merge, which are explicitly
    // deferred (they are not byte-identical to today's compactor when a live
    // document id exists in two segments). So a tick whose drain runs a
    // `li_segment` or `li_segments` job still pays the ~1.5-1.7 GB peak, and
    // any RSS soak must report drain ticks and non-drain ticks separately.
    const lean = !!segmented && positionsOnlyEnabled();
    index = new LateInteractionIndex({
      indexPath,
      loadExisting: true,
      positionsOnly: lean,
      positionsCache: lean ? (positionsCache || defaultPositionsCache()) : null,
    });
    await index.init();
    progress('li:init');
    if (cacheable) {
      readerCache.key = indexPath;
      readerCache.index = index;
    }
  }

  if (existing && !segmented) {
    if (readerCache) {
      readerCache.key = null;
      readerCache.index = null;
    }
    return rewriteLegacyIndex(index, ops, encode, pickLiInput, progress);
  }

  let tombstone = 0;
  const states = new Map();
  for (const op of ops) {
    if (!op.retireId) continue;
    const position = index._docSegmentPositions.get(op.retireId);
    if (!position) continue;
    if (!states.has(position.segmentPath)) {
      const docCount = index._segments.find((s) => s.path === position.segmentPath)?.count ?? position.docIndex + 1;
      states.set(position.segmentPath, openSegmentState(position.segmentPath, docCount));
    }
    tombstoneDoc(states.get(position.segmentPath), position.docIndex);
    tombstone += 1;
  }
  for (const state of states.values()) persistSegmentState(state);
  progress('li:tombstone');

  const addOps = ops.filter((op) => op.addId && op.chunk);
  const texts = addOps.map(({ chunk }) => pickLiInput(chunk));
  progress('li:encode:start');
  const tokens = texts.length > 0 ? await encode(texts) : [];
  progress('li:encode:done');
  const writer = new LateInteractionIndex({
    indexPath,
    loadExisting: false,
    tokenDim: index.tokenDim,
    maxTokens: index.maxTokens,
    useInt8: index.useInt8,
    quantBits: index.quantBits,
    modelId: index.modelId,
    poolFactor: index.poolFactor,
    whtSeed: index.whtSeed,
    whtOrdering: index.whtOrdering,
    matryoshkaDim: index.matryoshkaDim,
  });
  await writer.init();
  progress('li:writer-init');

  for (let i = 0; i < addOps.length; i += 1) {
    if (!tokens[i] || tokens[i].length === 0) continue;
    const { addId, chunk } = addOps[i];
    await writer.add(addId, tokens[i], {
      file: chunk.file,
      name: chunk.metadata?.symbol,
      type: chunk.metadata?.chunk_type,
      startLine: chunk.metadata?.line_start || null,
      endLine: chunk.metadata?.line_end || null,
    });
    if ((i + 1) % 100 === 0) progress('li:add');
  }

  const appended = await appendGrowingSegment(indexPath, writer, writer._currentSegment);
  progress('li:append-segment');
  return { appended, tombstone };
}
