/**
 * Vocabulary Domain Barrel
 *
 * Re-exports public API from all vocabulary sub-modules.
 */

// vocab-miner.js
export {
  default as vocabMiner,
  mineStructural,
  mineSymbols,
  mineCodeGraph,
  mineGit,
  mineAll,
} from './vocab-miner.js';

// Also re-export the barrel re-exports from vocab-miner.js
export {
  splitIdentifier, STOP_WORDS, SOURCE_EXTENSIONS,
  addTerm, mergeTerms, termsToArray, walkShallow,
} from './vocab-miner-utils.js';

export {
  extractImports, extractExports, extractDefinitions, extractConstants,
  extractNpmDeps, extractCargoDeps, extractGoDeps, extractPipDeps, extractPyprojectDeps,
} from './vocab-miner-extractors.js';

export {
  mineNLContent, computeNLContentHash, extractNLText, isSecretLike,
  detectScript, tokenizeNL, extractBigrams, extractTrigrams,
  SECRET_PATTERNS, NL_MINING_TIMEOUT_MS,
} from './vocab-miner-nl.js';

// vocab-ranker.js
export {
  classifyWarmMode,
  rankIdentifiers,
  rankCommunityPhrases,
  rankAll,
  _internals as rankerInternals,
} from './vocab-ranker.js';

// vocab-warmer.js
export {
  default as vocabWarmer,
  warmLexical,
  warmSemantic,
  warmHybrid,
  warmFromCache,
  runFullWarmup,
  saveBinaryArtifact,
  DATA_DIR,
  ARTIFACT_PATHS,
  _loadEntityMetadata,
} from './vocab-warmer.js';

// vocab-warmup-orchestrator.js
export {
  runFullWarmup as runFullWarmupOrchestrator,
  saveBinaryArtifact as saveBinaryArtifactOrchestrator,
} from './vocab-warmup-orchestrator.js';

// vocabulary-utils.js
export {
  default as vocabularyUtils,
  BinaryVocabulary,
  mineQueryLogs,
  extractEntities,
  generateAllTerms,
  callVoyageAPI,
  migrateJsonToBinary,
  warmupFull,
  warmupLearn,
  getStats,
} from './vocabulary-utils.js';

// vocab-constants.js
export {
  DATA_DIR as vocabDataDir,
  ARTIFACT_PATHS as vocabArtifactPaths,
} from './vocab-constants.js';
