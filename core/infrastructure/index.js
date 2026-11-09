/**
 * Infrastructure bounded context — public API.
 * Re-exports config, shared utilities, and platform services.
 */

export * from './config/index.js';

export {
  applyReadPragmas,
  SAFE_IN_CLAUSE_BATCH,
  assertInClauseSize,
  chunkedIn,
  chunkedInExec,
} from './db-utils.js';

export { CodebaseRepository } from './codebase-repository.js';
export { CodeGraphRepository } from './code-graph-repository.js';

export { fetchModel, fetchModelFile, resolveModelFile, computeFileHash, getModelCacheDir, isCacheValid } from './model-fetcher.js';
export { MODEL_REGISTRY, getModelEntry, getModelsForProfile, getSkippedOptInModels, isModelEnabled, isNativeAcceleratedModel } from './model-registry.js';

export {
  getPlatformInfo,
  nativeBinarySupportsAgentTools,
  resolveNativeAddon,
  resolveNativeBinary,
} from './native-resolver.js';

export { createTokenizer } from './native-tokenizer.js';

export {
  isAvailable as isDedupAvailable,
  getLoadError as getDedupLoadError,
  computeFingerprints,
  clusterFingerprints,
} from './dedup-hashing.js';

export { initOrt, buildFeed, createOrtPipeline } from './ort-pipeline.js';
export {
  getOnnxRuntimeVersion,
  getOptimizedGraphPath,
  buildSessionOptions,
  warnIfGraphNotMaterialized,
  estimateComputeCores,
  defaultOrtExecutionMode,
  bestIntraOpThreads,
} from './onnx-session-utils.js';
export { withOnnxMutex } from './onnx-mutex.js';

// CoreML EP (ORT execution provider — separate from the native cascade)
export { isAppleSilicon, isCoreMLProviderAvailable, shouldUseCoreML, getCoreMLExecutionProviders, _resetCoreMLCache } from './coreml-provider.js';

export { detectHardwareCapability, parseAppleChipBrandString, _resetHardwareCapabilityCache } from './hardware-capability.js';

export {
  getCascadeSpec,
  getCoremlCascadeRoot,
  getCoremlEmbedDir,
  getCoremlLiDir,
  getCoremlLiEdgeDir,
  getCoremlLiDirForVariant,
  liVariantToSectionKey,
  formatVariantFilename,
  formatVariantTarballPath,
  isCoremlCascadeApplicable,
  isValidMlpackage,
  getExpectedVariantPaths,
  getCoremlCascadeState,
  getCoremlCascadeResolvedDirs,
  getCoremlCascadeReport,
  getAllCoremlCachePaths,
  fetchCoremlCascade,
  resolveFamiliesToFetch,
} from './coreml-cascade.js';

// Persisted init config (.sweet-search/config.json) — written by scripts/init.js,
// read by SweetSearch runtime to honour the user's persisted LI policy choices.
export {
  INIT_DATA_DIR_NAME,
  INIT_CONFIG_FILE_NAME,
  getInitConfigPath,
  loadInitConfig,
  writeInitConfig,
  readPersistedLiPolicy,
  resolveRuntimeLiModel,
  applyPersistedLiModel,
} from './init-config.js';

export {
  getLanguageByPath, getLanguageByExtension, LANGUAGES, EXTENSION_MAP, FILENAME_MAP,
  getChunkerPatterns, getGraphPatterns, getLanguageMeta, getSupportedExtensions,
  isIndentBased, getRegisteredLanguages,
} from './language-patterns.js';
export { getTreeSitterProvider, TAGS_QUERIES, CAPTURE_TO_ENTITY_TYPE } from './tree-sitter-provider.js';
export { detectProjectBoundary, clearBoundaryCache } from './project-detector.js';

export { SYMBOL_KIND_WEIGHTS, DEFINITION_TYPES } from './constants.js';

export { generateWithRetry } from './llm-provider.js';

export {
  floatToBinary, floatToInt8, normalizedFloatToInt8,
  computeCentroid, generateSignVector,
  walshHadamardTransform, walshHadamardTransformSequency,
  fastRotate, fastPseudoRandomRotate, calibrateWUSH, wushRotate,
  fisherYatesShuffle, truncateForHNSW,
  asymmetricQueryEncode, asymmetricDocEncode,
} from './quantization.js';

export {
  wasmHammingDistance, wasmInt8Cosine, wasmInt8BatchDot, wasmInt8Dot,
  wasmAsymmetricDistance, wasmMaxSimF32, wasmMaxSimDequant,
  nativeMaxSimBatch, float32BatchDot,
  isWasmAvailable, isMaxSimWasmAvailable, isNativeMaxSimAvailable,
  getMaxSimTier, initWasm,
} from './simd-distance.js';

// Code-graph schema vocabulary shared by graph, search, indexing and the
// structural repository (infrastructure never imports the graph domain).
export * from './relationship-types.js';
export * from './file-nodes.js';
export * from './import-path-prefixes.js';
export { isTestLikePath } from './test-paths.js';
