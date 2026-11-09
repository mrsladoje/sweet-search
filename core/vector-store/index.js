/**
 * Vector Store — barrel export for the vector-store bounded context.
 *
 * Public API: BinaryHNSWIndex, FloatVectorStore,
 * SIMD distance functions, and typed binary heaps.
 */

// --- Binary HNSW (Hamming distance) ---
export { BinaryHNSWIndex, createBinaryHNSWIndex } from './binary-hnsw-index.js';

// --- Float vector store (Stage 2.5 rescoring) ---
export { FloatVectorStore, getFloatStorePath, float512StoreEnabled } from './float-vector-store.js';


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
