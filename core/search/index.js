// Barrel — search domain (Phase 2E DDD migration)
export { SweetSearch, SweetSearch as SmartSearch, getWarmSearcher, warmSearch } from './sweet-search.js';
export { default } from './sweet-search.js';
export { ROUTE_ALPHAS } from './search-fusion.js';
export { runCli } from './search-cli.js';
export { startServer, queryServer, isServerRunning, autoSpawnServer } from './search-server.js';
export { warmSession } from './session-warmup.js';
export { WarmupMetrics, isWarmupHit, getPromotionCandidates, getDemotionCandidates, estimateWorkingSetSize, formatStatsReport, parseTelemetryEntries } from './warmup-metrics.js';
