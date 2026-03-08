/**
 * Diagnose per-step latency: cascade ON vs cascade OFF.
 * Usage: node eval/diagnose-latency.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(__dirname, 'corpus', 'gencodesearchnet');

// Dynamic import to get proper resolution
const { initSearch } = await import(path.join(PROJECT_ROOT, 'eval', 'lib', 'indexer.js'));

const QUERIES = [
  'Parse JSON string into object',
  'Sort array of integers',
  'Connect to database',
  'Read file contents',
  'HTTP GET request',
  'Find element in list',
  'Convert string to integer',
  'Create new thread',
  'Write to log file',
  'Handle exception',
  'Split string by delimiter',
  'Check if file exists',
  'Send email notification',
  'Generate random number',
  'Calculate hash of string',
  'Compress data with gzip',
  'Parse command line arguments',
  'Encode string to base64',
  'Validate email address',
  'Format date to string',
];

async function runBatch(label, searchOpts) {
  const search = await initSearch(CORPUS_DIR, PROJECT_ROOT, searchOpts);
  const timings = [];

  // Warm up: 3 throwaway queries to fully load all models (embedding, reranker, LI)
  for (const wq of ['warmup query one', 'warmup query two', 'warmup query three']) {
    await search.search(wq, { k: 10, mode: 'auto', rerank: true, expand: false });
  }
  console.log(`  [${label}] All models warm. Running ${QUERIES.length} queries...`);

  for (const q of QUERIES) {
    const start = performance.now();
    const { results, stats } = await search.search(q, { k: 10, mode: 'auto', rerank: true, expand: false });
    const total = performance.now() - start;

    timings.push({
      query: q,
      total_ms: total,
      route: stats.routing?.mode || '?',
      embed_us: stats.embedding?.latency_us || 0,
      binary_us: stats.stages?.binary?.latency_us || 0,
      int8_us: stats.stages?.int8?.latency_us || 0,
      rerank_ms: stats.stages?.rerank?.latency_ms || stats.rerank?.latency_ms || 0,
      rerank_skipped: stats.rerank?.skipped ?? false,
      rerank_reason: stats.rerank?.reason || '',
      // Cascade-specific
      cascade_decisive: stats.cascade?.decisive ?? null,
      cascade_gate: stats.cascade?.gateReason || '',
      cascade_ce: stats.cascade?.ceInvoked ?? null,
      cascade_ce_ms: stats.cascade?.ceLatencyMs || 0,
      cascade_ce_candidates: stats.cascade?.ceCandidates || 0,
      cascade_with_tokens: stats.cascade?.withTokens || 0,
      // LI-specific
      li_us: stats.lateInteraction?.latency_us || 0,
      li_candidates: stats.lateInteraction?.candidates || 0,
      li_query_tokens: stats.lateInteraction?.queryTokens || 0,
    });
  }

  await search.close?.();
  return timings;
}

function printTable(label, timings) {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`  ${label}`);
  console.log('='.repeat(100));
  console.log(
    'Query'.padEnd(35) +
    'Total(ms)'.padStart(10) +
    'Embed(us)'.padStart(10) +
    'Binary(us)'.padStart(11) +
    'Int8(us)'.padStart(9) +
    'Rerank(ms)'.padStart(11) +
    'Route'.padStart(9) +
    'Skip?'.padStart(6)
  );
  console.log('-'.repeat(100));

  let sTotal = 0, sEmbed = 0, sBinary = 0, sInt8 = 0, sRerank = 0, skipCount = 0;

  for (const t of timings) {
    console.log(
      t.query.slice(0, 34).padEnd(35) +
      t.total_ms.toFixed(1).padStart(10) +
      String(t.embed_us).padStart(10) +
      String(t.binary_us).padStart(11) +
      String(t.int8_us).padStart(9) +
      (t.rerank_ms || 0).toFixed(1).padStart(11) +
      t.route.padStart(9) +
      (t.rerank_skipped ? 'YES' : 'no').padStart(6)
    );
    sTotal += t.total_ms;
    sEmbed += t.embed_us;
    sBinary += t.binary_us;
    sInt8 += t.int8_us;
    sRerank += (t.rerank_ms || 0);
    if (t.rerank_skipped) skipCount++;
  }

  const n = timings.length;
  console.log('-'.repeat(100));
  console.log(
    'AVERAGE'.padEnd(35) +
    (sTotal / n).toFixed(1).padStart(10) +
    Math.round(sEmbed / n).toString().padStart(10) +
    Math.round(sBinary / n).toString().padStart(11) +
    Math.round(sInt8 / n).toString().padStart(9) +
    (sRerank / n).toFixed(1).padStart(11) +
    ''.padStart(9) +
    `${skipCount}/${n}`.padStart(6)
  );

  // Print cascade-specific stats if present (only when cascade was actually active)
  if (timings[0].cascade_decisive !== null && timings[0].cascade_gate !== '') {
    console.log(`\n  Cascade details:`);
    console.log(
      '  Query'.padEnd(35) +
      'Decisive'.padStart(10) +
      'CE?'.padStart(5) +
      'CE(ms)'.padStart(9) +
      'CE cands'.padStart(10) +
      'LI tokens'.padStart(10) +
      'Gate reason'.padStart(20)
    );
    console.log('  ' + '-'.repeat(96));
    let sCeMs = 0, ceCount = 0, decisiveCount = 0;
    for (const t of timings) {
      console.log(
        ('  ' + t.query.slice(0, 32)).padEnd(35) +
        (t.cascade_decisive ? 'YES' : 'no').padStart(10) +
        (t.cascade_ce ? 'YES' : 'no').padStart(5) +
        (t.cascade_ce_ms || 0).toFixed(1).padStart(9) +
        String(t.cascade_ce_candidates).padStart(10) +
        String(t.cascade_with_tokens).padStart(10) +
        t.cascade_gate.slice(0, 19).padStart(20)
      );
      sCeMs += (t.cascade_ce_ms || 0);
      if (t.cascade_ce) ceCount++;
      if (t.cascade_decisive) decisiveCount++;
    }
    console.log('  ' + '-'.repeat(96));
    console.log(`  Decisive: ${decisiveCount}/${n} | CE invoked: ${ceCount}/${n} | Avg CE: ${(sCeMs / Math.max(ceCount, 1)).toFixed(1)}ms`);
  }
}

// Run both modes
console.log('Running NO CASCADE mode (20 queries)...');
const noCascade = await runBatch('NO CASCADE', { useLateInteraction: false });

console.log('\nRunning CASCADE + LI mode (20 queries)...');
const withCascade = await runBatch('CASCADE + LI (full profile)', { useLateInteraction: true });

printTable('NO CASCADE (HNSW → Int8 → Rerank)', noCascade);
printTable('CASCADE ON + LI (HNSW → Int8 → MaxSim → Gate → CE)', withCascade);

// Summary comparison
console.log(`\n${'='.repeat(60)}`);
console.log('  SUMMARY COMPARISON');
console.log('='.repeat(60));
const avgNc = noCascade.reduce((s, t) => s + t.total_ms, 0) / noCascade.length;
const avgC = withCascade.reduce((s, t) => s + t.total_ms, 0) / withCascade.length;
console.log(`  No Cascade avg: ${avgNc.toFixed(1)}ms`);
console.log(`  Cascade avg:    ${avgC.toFixed(1)}ms`);
console.log(`  Slowdown:       ${(avgC / avgNc).toFixed(1)}x`);

process.exit(0);
