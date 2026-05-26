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
  const index = new LateInteractionIndex({ indexPath, loadExisting: true });
  await index.init();
  progress('li:init');

  if (existing && !segmented) {
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
