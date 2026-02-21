/**
 * Vocabulary Prewarm Constants
 *
 * Shared constants for vocab-warmer.js and vocab-warmup-orchestrator.js.
 * Extracted to break the circular dependency between those two modules.
 */

import path from 'path';
import { PROJECT_ROOT } from './config.js';

export const DATA_DIR = path.join(PROJECT_ROOT, '.sweet-search');

export const ARTIFACT_PATHS = {
  identifiersBin: path.join(DATA_DIR, 'vocab-identifiers.bin'),
  identifiersMeta: path.join(DATA_DIR, 'vocab-identifiers.meta.json'),
  semanticSeedsBin: path.join(DATA_DIR, 'vocab-semantic-seeds.bin'),
  semanticSeedsMeta: path.join(DATA_DIR, 'vocab-semantic-seeds.meta.json'),
  communities: path.join(DATA_DIR, 'communities.json'),
  dynamicVocab: path.join(DATA_DIR, 'vocab-dynamic.json'),
};
