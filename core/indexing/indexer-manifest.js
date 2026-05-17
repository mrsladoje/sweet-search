import path from 'path';
import { DB_PATHS } from '../infrastructure/config/index.js';
import {
  buildNextManifest,
  readManifest,
  writeManifest,
  zeroManifest,
} from '../incremental-indexing/infrastructure/manifest.mjs';
import { FALLBACK_WEIGHTS_ID } from '../incremental-indexing/infrastructure/sparse-gram-delta.mjs';

function basename(filePath) {
  return path.basename(filePath);
}

function sparseGramWeightsIdFromResult(result) {
  if (typeof result?.weightsId === 'string' && result.weightsId) return result.weightsId;
  if (typeof result?.weights_id === 'string' && result.weights_id) return result.weights_id;
  if (result?.usedFallbackWeights) return FALLBACK_WEIGHTS_ID;
  return null;
}

export function defaultIndexerManifestPaths() {
  const liBase = basename(DB_PATHS.lateInteraction);
  return {
    codeGraph: basename(DB_PATHS.codeGraph),
    vectors: basename(DB_PATHS.codebase),
    hnsw: basename(DB_PATHS.hnswIndex),
    hnswStale: basename(DB_PATHS.hnswIndex) + '.stale.bin',
    binaryHnsw: basename(DB_PATHS.binaryHnswIndex),
    liManifest: `${liBase}.segments/manifest.json`,
    sparseBase: basename(DB_PATHS.sparseGramIndex),
  };
}

export function defaultIndexerStateDir() {
  return path.dirname(DB_PATHS.codebase);
}

export function publishIndexerManifest(options = {}) {
  const stateDir = options.stateDir || defaultIndexerStateDir();
  const defaultManifest = zeroManifest(defaultIndexerManifestPaths());
  const previous = readManifest(stateDir) || defaultManifest;
  const epoch = Number.isInteger(options.epoch) ? options.epoch : (previous.epoch ?? 0) + 1;
  const sparseWeightsId = sparseGramWeightsIdFromResult(options.sparseGramResult);
  const defaultTiers = {
    codeGraph: defaultManifest.codeGraph,
    vectors: defaultManifest.vectors,
    hnsw: defaultManifest.hnsw,
    binaryHnsw: defaultManifest.binaryHnsw,
    lateInteraction: defaultManifest.lateInteraction,
    sparseGram: {
      ...defaultManifest.sparseGram,
      ...(sparseWeightsId ? { weightsId: sparseWeightsId } : {}),
    },
  };
  const tiers = {};
  for (const [tier, descriptor] of Object.entries(defaultTiers)) {
    tiers[tier] = { ...descriptor, ...(options.tiers?.[tier] || {}) };
  }
  const manifest = buildNextManifest(previous, {
    epoch,
    tiers,
  });
  writeManifest(stateDir, manifest);
  return manifest;
}
