// Barrel — search domain (Phase 2E DDD migration)
export { SweetSearch, SweetSearch as SmartSearch, getWarmSearcher, warmSearch } from './sweet-search.js';
export { default } from './sweet-search.js';
export { ROUTE_ALPHAS, getResultKey, quantileNormalize, convexCombination, shouldFallbackToRRF, rrfFusion, robustCCFusion, variance } from './search-fusion.js';
export { runCli } from './search-cli.js';
export { startServer, queryServer, isServerRunning, autoSpawnServer } from './search-server.js';
export { warmSession } from './session-warmup.js';
export { WarmupMetrics, isWarmupHit, getPromotionCandidates, getDemotionCandidates, estimateWorkingSetSize, formatStatsReport, parseTelemetryEntries } from './warmup-metrics.js';

// Post-processing, boosting, pattern search, formatting, hybrid
export * from './search-postprocess.js';
export * from './search-boost.js';
export * from './search-pattern.js';
export * from './search-semantic.js';
export { formatResults, formatGrepResults, formatStructuralResults, enrichWithSummaries, formatSummaryFirst, formatMiddleRes } from './search-format.js';
export { hybridSearch, hybridSearchV2 } from './search-hybrid.js';
