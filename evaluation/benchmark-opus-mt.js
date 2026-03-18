#!/usr/bin/env node
/**
 * OPUS-MT Translation Benchmark
 *
 * Measures:
 * - First load latency per model
 * - Warm translation latency for short code-search queries
 * - Identifier preservation accuracy
 * - Memory growth after loading multiple models
 *
 * Usage:
 *   node evaluation/benchmark-opus-mt.js [--dry-run] [--slice <name>]
 *
 * Slices: romance, cyrillic, cjk, mixed, unsupported, all (default)
 *
 * Reference: docs/TRANSLATION_FIX_PLAN.md (Phase 10)
 */

import { OpusMTTranslator, OPUS_MODEL_ROUTES, OPUS_FALLBACK_MODEL, protectIdentifiers, restoreIdentifiers } from '../translation/opus-mt-translator.js';

// =============================================================================
// BENCHMARK QUERIES
// =============================================================================

const BENCHMARK_SLICES = {
  romance: [
    { query: 'autenticación de usuario', lang: 'es', expected: 'user authentication' },
    { query: 'service d\'authentification', lang: 'fr', expected: 'authentication service' },
    { query: 'servizio di autenticazione', lang: 'it', expected: 'authentication service' },
    { query: 'serviço de autenticação', lang: 'pt', expected: 'authentication service' },
    { query: 'serviciu de autentificare', lang: 'ro', expected: 'authentication service' },
  ],
  cyrillic: [
    { query: 'аутентификация пользователя', lang: 'ru', expected: 'user authentication' },
    { query: 'аутентифікація користувача', lang: 'uk', expected: 'user authentication' },
  ],
  cjk: [
    { query: '认证服务', lang: 'zh', expected: 'authentication service' },
    { query: '認証サービス', lang: 'ja', expected: 'authentication service' },
    { query: '인증 서비스', lang: 'ko', expected: 'authentication service' },
  ],
  mixed: [
    { query: 'аутентификация AuthService', lang: 'ru', preserveIds: ['AuthService'] },
    { query: '認証 getUserById メソッド', lang: 'ja', preserveIds: ['getUserById'] },
    { query: 'Authentifizierung auth_service', lang: 'de', preserveIds: ['auth_service'] },
    { query: 'autenticación config.js', lang: 'es', preserveIds: ['config.js'] },
  ],
  unsupported: [
    { query: 'γεια σου κόσμε', lang: 'el', note: 'Greek → mul-en' },
    { query: 'שלום עולם', lang: 'he', note: 'Hebrew → mul-en' },
    { query: 'مرحبا بالعالم', lang: 'ar', note: 'Arabic → mul-en (pair exists but tests fallback)' },
  ],
};

// =============================================================================
// BENCHMARK RUNNER
// =============================================================================

/**
 * Simple concurrency limiter.
 * Runs async tasks with at most `limit` in flight at once.
 */
async function pMap(items, fn, limit = 1) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function runBenchmark(options = {}) {
  const { dryRun = false, slice = 'all', concurrency = 1 } = options;
  const translator = new OpusMTTranslator();
  const results = { slices: {}, summary: {} };

  const sliceNames = slice === 'all'
    ? Object.keys(BENCHMARK_SLICES)
    : [slice];

  // Flatten all queries across slices for concurrent execution
  const allEntries = [];
  for (const sliceName of sliceNames) {
    const queries = BENCHMARK_SLICES[sliceName];
    if (queries) {
      for (const entry of queries) {
        allEntries.push({ ...entry, sliceName });
      }
    }
  }

  console.log(`\n=== OPUS-MT Translation Benchmark ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no model loading)' : 'LIVE'}`);
  console.log(`Slices: ${sliceNames.join(', ')} | Queries: ${allEntries.length} | Concurrency: ${concurrency}\n`);

  const memBefore = process.memoryUsage();
  const benchStart = performance.now();

  const allResults = await pMap(allEntries, async (entry) => {
    if (dryRun) {
      const model = OPUS_MODEL_ROUTES[entry.lang] || OPUS_FALLBACK_MODEL;
      const { identifiers } = protectIdentifiers(entry.query);
      const r = {
        query: entry.query, lang: entry.lang, sliceName: entry.sliceName,
        routedModel: model, identifiersProtected: identifiers.length, dryRun: true,
      };
      console.log(`  [${entry.lang}] "${entry.query}" → ${model} (${identifiers.length} ids protected)`);
      return r;
    }

    const start = performance.now();
    const result = await translator.translate(entry.query, { srcLang: entry.lang });
    const elapsed = performance.now() - start;

    const idPreserved = entry.preserveIds
      ? entry.preserveIds.every(id => result.translation.includes(id))
      : null;

    const r = {
      query: entry.query, lang: entry.lang, sliceName: entry.sliceName,
      translation: result.translation, model: result.model,
      latency_ms: Math.round(elapsed), skipped: result.skipped, idPreserved,
    };

    const status = result.skipped ? 'SKIP' : 'OK';
    const idStatus = idPreserved === null ? '' : idPreserved ? ' [IDs preserved]' : ' [IDs LOST!]';
    console.log(`  [${status}] [${entry.lang}] "${entry.query}" → "${result.translation}" (${Math.round(elapsed)}ms, ${result.model || 'none'})${idStatus}`);
    return r;
  }, concurrency);

  const benchElapsed = Math.round(performance.now() - benchStart);
  console.log(`\nAll ${allEntries.length} queries completed in ${benchElapsed}ms`);

  // Group results back by slice
  for (const r of allResults) {
    if (!results.slices[r.sliceName]) results.slices[r.sliceName] = [];
    results.slices[r.sliceName].push(r);
  }

  // Memory growth
  const memAfter = process.memoryUsage();
  const memGrowthMB = Math.round((memAfter.rss - memBefore.rss) / 1024 / 1024);

  // Stats summary
  const stats = translator.getStats();
  results.summary = {
    loadedModels: stats.loadedModels,
    firstLoadLatencies: stats.firstLoadLatencies,
    translations: stats.translations,
    fallbacks: stats.fallbacks,
    errors: stats.errors,
    memoryGrowthMB: memGrowthMB,
    memoryRSSMB: Math.round(memAfter.rss / 1024 / 1024),
  };

  console.log(`\n=== Summary ===`);
  console.log(`Loaded models: ${stats.loadedModels.length}`);
  console.log(`First load latencies: ${JSON.stringify(stats.firstLoadLatencies)}`);
  console.log(`Translations: ${stats.translations}, Fallbacks: ${stats.fallbacks}, Errors: ${stats.errors}`);
  console.log(`Memory growth: ${memGrowthMB} MB (RSS: ${Math.round(memAfter.rss / 1024 / 1024)} MB)`);

  // Check identifier preservation
  const mixedResults = results.slices.mixed || [];
  const idTotal = mixedResults.filter(r => r.idPreserved !== null).length;
  const idPreserved = mixedResults.filter(r => r.idPreserved === true).length;
  if (idTotal > 0) {
    console.log(`Identifier preservation: ${idPreserved}/${idTotal} (${Math.round(100 * idPreserved / idTotal)}%)`);
  }

  translator.unloadAll();
  return results;
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sliceIdx = args.indexOf('--slice');
  const slice = sliceIdx >= 0 ? args[sliceIdx + 1] : 'all';
  const concIdx = args.indexOf('--concurrency');
  const concurrency = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 1;

  runBenchmark({ dryRun, slice, concurrency })
    .then(results => {
      console.log(`\nFull results: ${JSON.stringify(results.summary, null, 2)}`);
    })
    .catch(err => {
      console.error(`Benchmark failed: ${err.message}`);
      process.exit(1);
    });
}

export { runBenchmark, BENCHMARK_SLICES };
