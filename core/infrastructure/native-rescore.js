/**
 * Native exact rescoring kernels (crates/sweet-search-native/src/rescore.rs):
 * int8 and f32 dot scores over row indices of a contiguous slab, with the
 * same arithmetic as the JS/WASM paths. SS_FIX_RESCORE_NATIVE=0 disables
 * them. Probed once per process; null when the addon is missing.
 */
import { loadNativeAddon } from './native-resolver.js';

let kernels;

export function nativeRescoreKernels() {
  if (kernels !== undefined) return kernels;
  kernels = null;
  if (process.env.SS_FIX_RESCORE_NATIVE === '0') return null;
  const res = loadNativeAddon({
    validate: (m) => typeof m.int8DotScores === 'function' && typeof m.f32DotScores === 'function',
  });
  if (res) kernels = { int8DotScores: res.mod.int8DotScores, f32DotScores: res.mod.f32DotScores, path: res.path };
  return kernels;
}

// Reused scratch typed arrays for native calls. Each typed array allocation
// is off-heap (external) memory; a few per query add up and push V8 into
// full GCs. Callers use a scratch buffer only within one synchronous span
// (fill, call, copy out), so one shared buffer per name is safe.
const scratchPool = new Map();

/**
 * A `Type` scratch array of at least `length` elements, shared per `name`.
 * @template {Float64ArrayConstructor|Uint32ArrayConstructor} T
 * @param {string} name
 * @param {T} Type
 * @param {number} length
 * @returns {InstanceType<T>}
 */
export function scratchArray(name, Type, length) {
  let buf = scratchPool.get(name);
  if (!buf || buf.length < length) {
    buf = new Type(Math.max(length, buf ? buf.length * 2 : 1024));
    scratchPool.set(name, buf);
  }
  return buf;
}

/** `query` as an exact-length Float64Array view over shared scratch. */
export function scratchFloat64Query(query) {
  const q = scratchArray('query', Float64Array, query.length).subarray(0, query.length);
  for (let i = 0; i < query.length; i++) q[i] = query[i];
  return q;
}
