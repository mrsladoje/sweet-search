import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LateInteractionIndex } from '../../ranking/late-interaction-index.js';
import { countDocumentTokensCpu, encodeDocumentsCpu } from '../../ranking/late-interaction-model.js';
import { recordEncode } from '../../indexing/inference-provenance.js';
import { estimateLateInteractionTokens, planLateInteractionBatches } from '../../indexing/indexer-ann.js';
import {
  openSegmentState,
  tombstoneDoc,
  persistSegmentState,
  nextSegmentSeq,
  segmentIdentityCache as defaultPositionsCache,
} from '../infrastructure/li-segment-state.mjs';

// Test seam: drop all remembered segment identities.
export { resetSegmentIdentityCache } from '../infrastructure/li-segment-state.mjs';

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

// Background CPU encoding gains little from wide batches, so the maintainer
// packs tighter than the full build: at most one max-length (2048-token) chunk
// of attention work per call, and 4096 tokens of hidden state.
const MAINTAINER_LI_BATCHING = Object.freeze({ tokenBudget: 4_096, attentionBudget: 2_048 * 2_048 });

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

  const encodeRaw = liEncoder || ((texts) => encodeDocumentsCpu(texts));
  // Index provenance: the daemon's default LI encoder is ORT on CPU.
  // One encoder call per file padded every chunk to the file's longest one: a
  // 90 KB file's 88 chunks took 24 s and raised RSS from 1.2 to 7.7 GB. Pack
  // the chunks under the full build's token and attention budgets instead
  // (planLateInteractionBatches), and return the results in input order.
  // Planned by real token counts (the default encoder's tokenizer): the character estimate
  // can be 3x short on symbol-heavy text, and a batch it packs then pads past both budgets.
  // An injected encoder may bring its own counter (the maintainer's encoder process does).
  const countTokens = liEncoder ? (liEncoder.countTokens ?? null) : countDocumentTokensCpu;
  const encode = async (texts) => {
    const out = new Array(texts.length);
    const counts = countTokens ? await countTokens(texts).catch(() => null) : null;
    const items = texts.map((text, i) => ({
      i, text, estTokens: counts?.[i] > 0 ? counts[i] : estimateLateInteractionTokens(text),
    }));
    for (const batch of planLateInteractionBatches(items, MAINTAINER_LI_BATCHING)) {
      const encoded = await encodeRaw(batch.map((item) => item.text));
      batch.forEach((item, k) => { out[item.i] = encoded[k]; });
    }
    recordEncode('li', liEncoder ? (liEncoder.provenanceLabel ?? 'unknown') : 'ort/cpu', texts.length);
    return out;
  };
  const existing = fs.existsSync(indexPath);
  const segmented = existing ? segmentedState(indexPath) : null;
  // The full build always writes segments; the baseline gate holds the maintainer off an
  // older single-file index (LI_FORMAT_OUTDATED), so this is never reached in a tick.
  if (existing && !segmented) {
    throw new Error(`LI index is not segmented (${indexPath}); rebuild it with: sweet-search index --full`);
  }

  // E.1-LI reader cache: reuse the loaded read view across the tick's files.
  // Everything the reader serves (config fields, positions/counts of pre-tick
  // docs) is immutable within a tick: per-file ops only reference the file's
  // own pre-tick docs, appends go through appendGrowingSegment (which re-reads
  // the manifest from disk), and tombstone sidecar state is opened fresh per
  // call. A new index (no file yet) is not cached.
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
    // ceiling.
    //
    // The maintenance drain after a tick no longer flattens either:
    // `liSegmentHandler` and `mergeLiSegments` read only the segments they
    // rewrite (collectLiveDocs, li-segment-merge.mjs), with the full load's
    // last-live-copy rule for a doc id present in two segments.
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

  // Row versions (moved or re-texted code with the same LI input) copy the old doc's
  // stored tokens: read only those docs from their segments, before the tombstones below.
  const copied = new Map();
  const copyBySegment = new Map();
  for (const op of ops) {
    if (!op.addId || !op.copyFromId) continue;
    const position = index._docSegmentPositions.get(op.copyFromId);
    if (!position) continue;
    if (!copyBySegment.has(position.segmentPath)) copyBySegment.set(position.segmentPath, new Map());
    copyBySegment.get(position.segmentPath).set(position.docIndex, op.addId);
  }
  for (const [segmentPath, wanted] of copyBySegment) {
    const docs = await index._readSegmentFile(segmentPath, (docIndex) => !wanted.has(docIndex));
    for (const [docIndex, addId] of wanted) {
      const doc = docs[docIndex];
      if (doc?.tokens) copied.set(addId, doc);
    }
  }
  progress('li:copy');

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

  const addOps = ops.filter((op) => op.addId && op.chunk && !copied.has(op.addId));
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
    // No automatic flush: it would write segment-0000 of the live directory over an
    // existing segment, and appendGrowingSegment publishes only _currentSegment.
    segmentSize: Number.MAX_SAFE_INTEGER,
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

  for (const [addId, doc] of copied) {
    const entry = { tokens: doc.tokens, numTokens: doc.numTokens, dim: doc.dim, tokenNorms: doc.tokenNorms };
    if (doc.quantBits) entry.quantBits = doc.quantBits;
    if (doc.preNorms) entry.preNorms = doc.preNorms;
    if (doc.minArray) { entry.minArray = doc.minArray; entry.scaleArray = doc.scaleArray; } else if (doc.min !== undefined) { entry.min = doc.min; entry.scale = doc.scale; }
    writer.documents.set(addId, entry);
    writer._currentSegment.set(addId, entry);
  }
  const appended = await appendGrowingSegment(indexPath, writer, writer._currentSegment);
  progress('li:append-segment');
  return { appended, tombstone };
}
