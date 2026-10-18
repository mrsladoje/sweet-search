// Preload (--import) for rerun/pipeline.mjs: per-stage timers on the production search path.
// Post-freeze study (paper Section 9). Changes no engine code: it wraps, at run time,
//   - the native MaxSim entry points of the addon (the kernel call)            -> phase 'kernel'
//   - LateInteractionIndex.prototype.scoreWithLateInteraction (doc lookup in
//     the in-memory int4 store, grouping, packing, prewarm, plus the kernel)   -> phase 'li'
//   - SweetSearch.prototype retrieval methods (the first stage)                -> phase 'retrieval'
//   - SweetSearch.prototype._applyPostRetrieval (post-processing and LI rerank) -> phase 'post'
// Time is attributed to the innermost active phase (a stack), so 'li' excludes 'kernel' and
// 'retrieval' excludes any LI scoring that runs inside it. Query-encoder time comes from the
// engine's own counters (getEmbeddingTimings: dense query embedding; getLateInteractionTimings:
// LI query tokens), drained at every phase boundary and charged to the phase that was active.
import { performance } from 'node:perf_hooks';

// PIPE_ENGINE: the engine tree to time (default: this repository).
const ROOT = process.env.PIPE_ENGINE ? new URL(`file://${process.env.PIPE_ENGINE.replace(/\/$/, '')}/core/`) : new URL('../../../core/', import.meta.url);
const { loadNativeAddon } = await import(new URL('infrastructure/native-resolver.js', ROOT));
const { LateInteractionIndex } = await import(new URL('ranking/late-interaction-index.js', ROOT));
const { SweetSearch } = await import(new URL('search/sweet-search.js', ROOT));
const { getEmbeddingTimings } = await import(new URL('embedding/embedding-local-model.js', ROOT));
const { getLateInteractionTimings } = await import(new URL('ranking/late-interaction-model.js', ROOT));

const now = () => performance.now() * 1000;          // microseconds
const S = {
  stack: ['other'], last: 0, us: {}, enc: {}, kernelCalls: 0,
  reset() {
    this.drainEnc(); this.stack = ['other']; this.last = now(); this.us = {}; this.enc = {}; this.kernelCalls = 0;
  },
  drainEnc() {
    const e = getEmbeddingTimings(), l = getLateInteractionTimings();
    return (e.tokenize_us || 0) + (e.inference_us || 0) + (e.pool_us || 0) + (l.tokenize_us || 0) + (l.inference_us || 0);
  },
  tick() {
    const t = now(), top = this.stack.at(-1);
    this.us[top] = (this.us[top] || 0) + (t - this.last);
    this.enc[top] = (this.enc[top] || 0) + this.drainEnc();
    this.last = t;
  },
  push(p) { this.tick(); this.stack.push(p); },
  pop() { this.tick(); if (this.stack.length > 1) this.stack.pop(); },
  snapshot() { this.tick(); return { us: { ...this.us }, enc: { ...this.enc }, kernelCalls: this.kernelCalls }; },
};
globalThis.__ssPipe = S;

const wrapAsync = (proto, name, phase) => {
  const orig = proto[name];
  if (typeof orig !== 'function') return;
  proto[name] = async function (...a) {
    S.push(phase);
    try { return await orig.apply(this, a); } finally { S.pop(); }
  };
};
for (const m of ['hybridSearchV2', 'hybridSearch', 'semanticSearch', 'semanticSearch3Stage', 'semanticSearchStandard',
  'lexicalSearch', 'structuralSearch', 'patternSearch', 'bareGrep']) wrapAsync(SweetSearch.prototype, m, 'retrieval');
wrapAsync(SweetSearch.prototype, '_applyPostRetrieval', 'post');
wrapAsync(LateInteractionIndex.prototype, 'scoreWithLateInteraction', 'li');

const res = loadNativeAddon();
if (res?.mod) {
  const mod = res.mod;
  for (const name of ['maxsimScorePacked', 'maxsimScoreBatch4Bit', 'maxsimScoreBatchPertoken', 'maxsimScoreBatch']) {
    const orig = mod[name]?.bind(mod);
    if (!orig) continue;
    mod[name] = (...a) => {
      S.push('kernel'); S.kernelCalls++;
      try { return orig(...a); } finally { S.pop(); }
    };
  }
}
