/**
 * Vector Store — barrel export for the vector-store bounded context.
 *
 * Public API: HNSWIndex, BinaryHNSWIndex, FloatVectorStore, SeismicIndex,
 * SIMD distance functions, and typed binary heaps.
 */

// --- HNSW (USearch-backed ANN) ---
export { HNSWIndex, createHNSWIndex, checkNativeBackend, requireNativeAnn } from './hnsw-index.js';

// --- Binary HNSW (Hamming distance) ---
export { BinaryHNSWIndex, createBinaryHNSWIndex } from './binary-hnsw-index.js';

// --- Float vector store (Stage 2.5 rescoring) ---
export { FloatVectorStore, getFloatStorePath } from './float-vector-store.js';

// --- SEISMIC sparse vector index ---
export { SeismicIndex, TopKHeap, Block, InvertedList, sparseDotProduct } from './seismic-index.js';

// --- SIMD / WASM distance functions ---
export {
  wasmHammingDistance,
  wasmInt8Cosine,
  wasmInt8BatchDot,
  wasmInt8Dot,
  wasmAsymmetricDistance,
  wasmMaxSimF32,
  wasmMaxSimDequant,
  nativeMaxSimBatch,
  float32BatchDot,
  isWasmAvailable,
  isMaxSimWasmAvailable,
  isNativeMaxSimAvailable,
  getMaxSimTier,
  initWasm,
} from '../infrastructure/simd-distance.js';

// --- Typed binary heaps (HNSW internals) ---
export { TypedMinHeap, TypedMaxHeap, VisitedList } from './binary-heap.js';
