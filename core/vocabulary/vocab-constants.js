/**
 * Vocabulary Prewarm Constants
 *
 * Shared constants for vocab-warmer.js and vocab-warmup-orchestrator.js.
 * Extracted to break the circular dependency between those two modules.
 */

import path from 'path';
import { PROJECT_ROOT } from '../infrastructure/config/index.js';

export const DATA_DIR = path.join(PROJECT_ROOT, '.sweet-search');

/** Written with the artifacts: when they were made, the graph epoch and the live edge count. */
export const VOCAB_STATE_FILE = 'vocab-refresh-state.json';

/** The vocabulary artifacts of the index in `stateDir`. */
export function vocabArtifactPaths(stateDir) {
  return {
    identifiersBin: path.join(stateDir, 'vocab-identifiers.bin'),
    identifiersMeta: path.join(stateDir, 'vocab-identifiers.meta.json'),
    semanticSeedsBin: path.join(stateDir, 'vocab-semantic-seeds.bin'),
    semanticSeedsMeta: path.join(stateDir, 'vocab-semantic-seeds.meta.json'),
    communities: path.join(stateDir, 'communities.json'),
    state: path.join(stateDir, VOCAB_STATE_FILE),
  };
}

export const ARTIFACT_PATHS = vocabArtifactPaths(DATA_DIR);
