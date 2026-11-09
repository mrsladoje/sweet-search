/**
 * Per-stage profiling hooks. No-op unless `globalThis.__stageTimings` is set
 * by scripts/profile-search-stages.mjs.
 */
export function __ptStart() {
  return globalThis.__stageTimings ? performance.now() : null;
}
export function __ptEnd(stage, t0) {
  if (t0 == null || !globalThis.__stageTimings) return;
  const ms = performance.now() - t0;
  const buf = globalThis.__stageTimings;
  (buf[stage] = buf[stage] || []).push(ms);
}
