export { SweetSearch, getWarmSearcher } from './sweet-search.js';
export { default } from './sweet-search.js';
export { ROUTE_ALPHAS, getResultKey, quantileNormalize, convexCombination, shouldFallbackToRRF, rrfFusion, robustCCFusion, variance } from './search-fusion.js';
export { runCli } from './search-cli.js';
export { startServer, queryServer, isServerRunning, autoSpawnServer } from './search-server.js';

export { WarmupMetrics, isWarmupHit, getPromotionCandidates, getDemotionCandidates, estimateWorkingSetSize, formatStatsReport, parseTelemetryEntries } from './warmup-metrics.js';

export * from './search-postprocess.js';
export * from './search-boost.js';
export * from './search-pattern.js';
export * from './search-semantic.js';
export { formatResults, formatGrepResults, formatStructuralResults, enrichWithSummaries, formatSummaryFirst, formatMiddleRes } from './search-format.js';
export { hybridSearchV2 } from './search-hybrid.js';

export { readFile, readFiles, formatReadResults, handleReadCli } from './search-read.js';
export { readSemantic, formatReadSemanticResult, handleReadSemanticCli } from './search-read-semantic.js';
export { traceSymbol, handleTraceCli, formatStructuralContext } from './search-trace.js';
