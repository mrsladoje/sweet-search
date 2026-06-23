/* eslint-disable */
/**
 * Start the native macOS memory-pressure monitor (DISPATCH_SOURCE_TYPE_MEMORYPRESSURE).
 *
 * SCAFFOLD: always returns `false` (not implemented yet — see crate TODO(D.4)).
 * When `false`, the caller MUST fall back to the pure-JS RSS poller in
 * core/indexing/rss-budget.mjs. Never throws.
 */
export function startMemoryPressureMonitor(thresholdFraction: number): boolean;

/** Whether this build provides a working native memory-pressure source. Always `false` in the scaffold. */
export function isSupported(): boolean;
