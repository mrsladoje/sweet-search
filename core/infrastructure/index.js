/**
 * Infrastructure bounded context — public API.
 * Re-exports config, shared utilities, and platform services.
 */

// Configuration
export * from './config/index.js';
export { default as config } from './config/index.js';

// Database utilities
export { applyReadPragmas } from './db-utils.js';

// Repositories (DDD infrastructure layer)
export { CodebaseRepository } from './codebase-repository.js';
export { CodeGraphRepository } from './code-graph-repository.js';

// Model management
export { fetchModel, fetchModelFile, resolveModelFile, computeFileHash, getModelCacheDir, isCacheValid } from './model-fetcher.js';
export { MODEL_REGISTRY, getModelEntry, getModelsForProfile } from './model-registry.js';

// Native platform resolution
export { resolveNativeAddon, resolveNativeBinary, getPlatformInfo } from './native-resolver.js';

// Tokenization
export { createTokenizer } from './native-tokenizer.js';

// ONNX runtime
export { initOrt, buildFeed, createOrtPipeline } from './ort-pipeline.js';
export { getOnnxRuntimeVersion, getOptimizedGraphPath, buildSessionOptions, warnIfGraphNotMaterialized, bestIntraOpThreads } from './onnx-session-utils.js';
export { withOnnxMutex } from './onnx-mutex.js';

// CoreML
export { isAppleSilicon, isCoreMLProviderAvailable, shouldUseCoreML, getCoreMLExecutionProviders, _resetCoreMLCache } from './coreml-provider.js';

// Language analysis
export {
  getLanguageByPath, getLanguageByExtension, LANGUAGES, EXTENSION_MAP, FILENAME_MAP,
  getChunkerPatterns, getGraphPatterns, getLanguageMeta, getSupportedExtensions,
  isIndentBased, getRegisteredLanguages,
} from './language-patterns.js';
export { getTreeSitterProvider, TAGS_QUERIES, CAPTURE_TO_ENTITY_TYPE } from './tree-sitter-provider.js';
export { detectProjectBoundary, clearBoundaryCache } from './project-detector.js';

// Constants
export { SYMBOL_KIND_WEIGHTS, DEFINITION_TYPES } from './constants.js';

// LLM provider
export { generateWithRetry } from './llm-provider.js';

// Quantization (explicit named exports)
export {
  floatToBinary, floatToInt8, normalizedFloatToInt8,
  computeCentroid, generateSignVector, walshHadamardTransform,
  fastRotate, fisherYatesShuffle, truncateForHNSW,
  asymmetricQueryEncode, asymmetricDocEncode,
} from './quantization.js';

// SIMD / WASM distance functions
export {
  wasmHammingDistance, wasmInt8Cosine, wasmInt8BatchDot, wasmInt8Dot,
  wasmAsymmetricDistance, wasmMaxSimF32, wasmMaxSimDequant,
  nativeMaxSimBatch, float32BatchDot,
  isWasmAvailable, isMaxSimWasmAvailable, isNativeMaxSimAvailable,
  getMaxSimTier, initWasm,
} from './simd-distance.js';
