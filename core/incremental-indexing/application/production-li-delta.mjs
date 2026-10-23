import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LateInteractionIndex } from '../../ranking/late-interaction-index.js';
import { countDocumentTokensCpu, encodeDocumentsCpu } from '../../ranking/late-interaction-model.js';
import { recordEncode } from '../../infrastructure/inference-provenance.js';
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
  deferredTombstones = null,
  deferredAppend = null,
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
    const lean = !!segmented;
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

  // With `deferredTombstones` (a tick) the marks are collected for the caller to write
  // after its COMMIT: a mark written before it outlived a rolled-back tick and hid docs
  // whose rows were still live.
  let tombstone = 0;
  const states = new Map();
  for (const op of ops) {
    if (!op.retireId) continue;
    const position = index._docSegmentPositions.get(op.retireId);
    if (!position) continue;
    const docCount = index._segments.find((s) => s.path === position.segmentPath)?.count ?? position.docIndex + 1;
    tombstone += 1;
    if (deferredTombstones) {
      deferredTombstones.push({ segmentPath: position.segmentPath, docIndex: position.docIndex, docCount });
      continue;
    }
    if (!states.has(position.segmentPath)) states.set(position.segmentPath, openSegmentState(position.segmentPath, docCount));
    tombstoneDoc(states.get(position.segmentPath), position.docIndex);
  }
  for (const state of states.values()) persistSegmentState(state);
  progress('li:tombstone');

  const addOps = ops.filter((op) => op.addId && op.chunk && !copied.has(op.addId));
  const texts = addOps.map(({ chunk }) => pickLiInput(chunk));
  progress('li:encode:start');
  const tokens = texts.length > 0 ? await encode(texts) : [];
  progress('li:encode:done');
  // With `deferredAppend` (a tick) one writer collects the tick's docs and the caller
  // appends them as one segment after its COMMIT (appendDeferredLiSegment): a segment
  // appended per file outlived a rolled-back tick as orphan docs, and made a small
  // segment per file for the merges to collapse.
  const writer = deferredAppend?.writer ?? new LateInteractionIndex({
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
  if (deferredAppend) deferredAppend.writer = writer;
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
  if (deferredAppend) return { appended: addOps.length + copied.size, tombstone };
  const appended = await appendGrowingSegment(indexPath, writer, writer._currentSegment);
  progress('li:append-segment');
  return { appended, tombstone };
}

/** Append the docs a tick collected through `deferredAppend` as one segment. */
export async function appendDeferredLiSegment(indexPath, deferredAppend) {
  const writer = deferredAppend?.writer;
  if (!writer || writer._currentSegment.size === 0) return 0;
  const appended = await appendGrowingSegment(indexPath, writer, writer._currentSegment);
  deferredAppend.writer = null;
  return appended;
}

/**
 * Remove LI alias pointers (the `<index>.aliases.json` NDJSON sidecar the full build writes)
 * whose alias id is in `aliasIds`. Rewritten through a temp file + rename; no-op without a
 * sidecar or a match.
 */
export function dropAliasPointersSync(indexPath, aliasIds) {
  const sidecar = `${indexPath}.aliases.json`;
  let text;
  try { text = fs.readFileSync(sidecar, 'utf8'); } catch { return 0; }
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return 0;
  const kept = [];
  let dropped = 0;
  for (const line of lines.slice(1)) {
    let entry = null;
    try { entry = JSON.parse(line); } catch { /* torn line: drop */ }
    if (!entry || aliasIds.has(entry.aliasId)) { dropped += 1; continue; }
    kept.push(line);
  }
  if (dropped === 0) return 0;
  let header;
  try { header = { ...JSON.parse(lines[0]), count: kept.length }; } catch { header = { version: 2, count: kept.length }; }
  const tmp = `${sidecar}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, [JSON.stringify(header), ...kept].join('\n') + '\n');
  fs.renameSync(tmp, sidecar);
  return dropped;
}
