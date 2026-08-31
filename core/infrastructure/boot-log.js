// Boot / load diagnostics — "BinaryHNSW: Loaded N vectors", "LateInteraction:
// Loaded …", "Loading local model: …", "Warming up embedding service…".
//
// These are useful to a human running the CLI or watching the indexer, but they
// are pure NOISE in the agent tool surface: the ss-* wrappers capture a tool's
// stdout as the result the model reads, and an in-process cold-start prints these
// banners straight into it. Rerouting to stderr is not enough — a wrapper cats
// stderr back on a non-zero exit, and different load paths print at different
// times — so the only robust fix is to suppress them at the source for the agent
// surface, on EVERY path and regardless of exit code.
//
// The ss-* wrappers set SS_QUIET_BOOT=1 (via bin/_ss-env.sh). The human CLI and
// the indexer leave it unset and still see the banners. Any new load-time
// diagnostic MUST go through bootLog, not raw console.log — a test in
// tests/indexing/boot-log.test.js enforces that these source files stay clean.
export function bootLog(...args) {
  if (process.env.SS_QUIET_BOOT === '1') return;
  console.log(...args);
}

export function isBootQuiet() {
  return process.env.SS_QUIET_BOOT === '1';
}
