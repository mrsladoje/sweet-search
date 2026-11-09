/**
 * Vocabulary Domain Barrel
 */

export {
  default as vocabMiner,
  mineStructural,
  mineSymbols,
  mineCodeGraph,
  mineGit,
  mineAll,
} from './vocab-miner.js';

export {
  splitIdentifier, STOP_WORDS, SOURCE_EXTENSIONS,
  addTerm, mergeTerms, termsToArray, walkShallow,
} from './vocab-miner-utils.js';

export {
  extractImports, extractExports, extractDefinitions, extractConstants,
  extractNpmDeps, extractCargoDeps, extractGoDeps, extractPipDeps, extractPyprojectDeps,
} from './vocab-miner-extractors.js';

export {
  mineNLContent, extractNLText, isSecretLike,
  detectScript, tokenizeNL, extractBigrams, extractTrigrams,
  SECRET_PATTERNS, NL_MINING_TIMEOUT_MS,
} from './vocab-miner-nl.js';

export {
  classifyWarmMode,
  rankIdentifiers,
  rankCommunityPhrases,
  rankAll,
  _internals as rankerInternals,
} from './vocab-ranker.js';

export {
  default as vocabWarmer,
  warmLexical,
  warmSemantic,
  warmHybrid,
  warmFromCache,
  DATA_DIR,
  ARTIFACT_PATHS,
  _loadEntityMetadata,
} from './vocab-warmer.js';

export {
  runFullWarmup,
  saveBinaryArtifact,
} from './vocab-warmup-orchestrator.js';

export {
  DATA_DIR as vocabDataDir,
  ARTIFACT_PATHS as vocabArtifactPaths,
} from './vocab-constants.js';

export { handlePrewarmVocabCli } from './vocab-prewarm-cli.js';
