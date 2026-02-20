---
description: Pre-warm Sweet Search vocabulary cache with codebase-specific terms
command: /sweet-prewarm-vocab [options]
---

# Sweet Search Vocabulary Prewarm

Mine the target codebase for search vocabulary, detect logical code communities via the import graph, rank terms by PageRank + BM25, and warm all search modes (lexical/semantic/hybrid) with project-specific terms.

$ARGUMENTS

## What this does

1. **Mine** the codebase for identifiers, NL phrases, and community structure
2. **Rank** terms using BM25 + PageRank + heuristic multipliers
3. **Warm** each search mode:
   - Lexical: FTS5 MATCH queries with real identifiers
   - Semantic: Pre-compute embeddings for hub entities + community phrases
   - Hybrid: Full pipeline exercise with representative queries
4. **Persist** vocabulary cache for session-start fast loading

## Options
- `--full` - Full mine + warm (first time or after major changes)
- `--incremental` - Only mine changed files, warm new terms (default)
- `--dry-run` - Show what would be mined without warming
- `--stats` - Show current vocabulary statistics + cache hit rates
- `--depth light|medium|deep` - Mining depth (default: medium)
- `--modes lexical|semantic|hybrid|all` - Which modes to warm (default: all)
- `--top N` - Warm top N terms (default: 1000)

## Execution

Run the vocabulary prewarm pipeline with the specified options. Use the `runFullWarmup()` function from `core/vocab-warmer.js`:

```js
import { runFullWarmup } from './core/vocab-warmer.js';
import { formatStatsReport, WarmupMetrics } from './core/warmup-metrics.js';
import { getTelemetryReport } from './core/embedding-cache.js';

// Parse options from $ARGUMENTS
const args = ('$ARGUMENTS' || '').split(/\s+/).filter(Boolean);

const hasFlag = (f) => args.includes(f);
const flagValue = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : null; };

// --stats: show report and exit
if (hasFlag('--stats')) {
  const report = await getTelemetryReport(500);
  const metrics = new WarmupMetrics();
  metrics.loadFromReport(report);
  console.log(formatStatsReport(metrics));
  process.exit(0);
}

// Parse warmup options
const depth = flagValue('--depth') || 'medium';
const modesArg = flagValue('--modes');
const modes = modesArg === 'all' || !modesArg
  ? ['lexical', 'semantic', 'hybrid']
  : modesArg.split(',').map(m => m.trim());
const top = parseInt(flagValue('--top') || '1000', 10);
const incremental = !hasFlag('--full');
const dryRun = hasFlag('--dry-run');

const result = await runFullWarmup({
  depth,
  top,
  modes,
  incremental,
  dryRun,
});

// Display results
if (dryRun) {
  console.log(`[dry-run] Would mine ${result.termsMined || 0} terms from ${result.filesScanned || 0} files`);
  console.log(`[dry-run] Communities: ${result.communitiesDetected || 0}`);
  console.log(`[dry-run] Modes: ${modes.join(', ')}`);
} else {
  console.log(`Vocabulary prewarm complete:`);
  console.log(`  Terms mined: ${result.termsMined || 0}`);
  console.log(`  Communities: ${result.communitiesDetected || 0}`);
  console.log(`  Warmup time: ${result.warmupTimeMs || 0}ms`);
  if (result.perMode) {
    for (const [mode, stats] of Object.entries(result.perMode)) {
      console.log(`  ${mode}: ${stats.queriesWarmed || 0} queries, ${stats.timeMs || 0}ms`);
    }
  }
}
```
