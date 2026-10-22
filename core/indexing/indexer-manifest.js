import path from 'path';
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { writeStamp } from '../incremental-indexing/infrastructure/worktree-stamp.mjs';
import {
  buildNextManifest,
  readManifest,
  writeManifest,
  zeroManifest,
} from '../incremental-indexing/infrastructure/manifest.mjs';
import { FALLBACK_WEIGHTS_ID } from '../incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { applyProvenance } from './inference-provenance.js';

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
  // Encoder backends behind the vectors (informational; see
  // inference-provenance.js). A full rebuild replaces the counts.
  if (options.provenance) {
    applyProvenance(manifest, options.provenance.recorded, { replace: options.provenance.replace === true });
  }
  writeManifest(stateDir, manifest);
  // This build is of this project root: a stamp from where the folder used to be (moved,
  // renamed, copied) made the maintainer refuse every tick, even after a full rebuild.
  writeStamp(stateDir, options.projectRoot || PROJECT_ROOT);
  return manifest;
}
