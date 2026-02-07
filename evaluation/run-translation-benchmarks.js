#!/usr/bin/env node
/**
 * Comprehensive Translation Benchmark Runner
 *
 * Runs two benchmark types:
 * A) Isolated translation provider/model benchmarks (accuracy, latency, cost)
 * B) End-to-end search evaluation matrix (MRR, Success@10, translation tier usage)
 *
 * Usage:
 *   node evaluation/run-translation-benchmarks.js                    # All benchmarks
 *   node evaluation/run-translation-benchmarks.js --local-only       # Skip cloud providers
 *   node evaluation/run-translation-benchmarks.js --cloud-only       # Skip local models
 *   node evaluation/run-translation-benchmarks.js --providers=cerebras,groq
 *   node evaluation/run-translation-benchmarks.js --models=nllb-200,opus-mt
 *   node evaluation/run-translation-benchmarks.js --runs=5 --warmup-runs=1
 *
 * Output:
 *   .agentdb/translation-benchmarks/translation-providers-{timestamp}.json
 *   .agentdb/translation-benchmarks/search-eval-matrix-{timestamp}.json
 *
 * Security: API keys loaded from .env, never printed (only last 4 chars shown)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SEARCH_100X_ROOT = path.resolve(__dirname, '..');

// =============================================================================
// CONFIGURATION
// =============================================================================

// Load .env from search-100x directory first, then project root
function loadEnv() {
  const envPaths = [
    path.join(SEARCH_100X_ROOT, '.env'),
    path.join(PROJECT_ROOT, '.env'),
  ];

  for (const dotenvPath of envPaths) {
    try {
      if (fs.existsSync(dotenvPath)) {
        const envContent = fs.readFileSync(dotenvPath, 'utf-8');
        for (const line of envContent.split('\n')) {
          const match = line.match(/^([^=]+)=["']?([^"'\n]+)["']?$/);
          if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2];
          }
        }
      }
    } catch (e) { /* .env loading is optional */ }
  }
}

loadEnv();

// API Keys (masked for display)
function maskKey(key) {
  if (!key || key.length < 8) return 'not set';
  return `****${key.slice(-4)}`;
}

const KEYS = {
  CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY || '',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  TRANSLATION_API_URL: process.env.TRANSLATION_API_URL || '',
};

// Provider definitions
const CLOUD_PROVIDERS = {
  cerebras: {
    enabled: KEYS.CEREBRAS_API_KEY.length > 0,
    name: 'Cerebras',
    model: process.env.CEREBRAS_TRANSLATE_MODEL || 'llama3.1-8b',
    pricing: 0.20,
  },
  groq: {
    enabled: KEYS.GROQ_API_KEY.length > 0,
    name: 'Groq',
    model: process.env.GROQ_TRANSLATE_MODEL || 'llama-3.1-8b-instant',
    pricing: 0.13,
  },
  openrouter: {
    enabled: KEYS.OPENROUTER_API_KEY.length > 0,
    name: 'OpenRouter',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    pricing: 0,
  },
  custom: {
    enabled: KEYS.TRANSLATION_API_URL.length > 0,
    name: 'Custom',
    model: process.env.TRANSLATION_MODEL || 'llama3.1:8b',
    pricing: 0,
  },
};

const LOCAL_MODELS = {
  'nllb-200': {
    enabled: true,
    name: 'NLLB-200 Distilled',
    model: 'Xenova/nllb-200-distilled-600M',
    avgLatency: '500-1000ms',
  },
  'opus-mt': {
    enabled: true,
    name: 'Opus-MT Many->English',
    model: 'Helsinki-NLP/opus-mt-mul-en',
    avgLatency: '50-200ms',
  },
};

// =============================================================================
// CLI PARSING
// =============================================================================

function parseArgs() {
  const args = {
    localOnly: false,
    cloudOnly: false,
    providers: null,
    models: null,
    runs: 3,
    warmupRuns: 1,
    skipIsolated: false,
    skipE2E: false,
    verbose: false,
    help: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--local-only') {
      args.localOnly = true;
    } else if (arg === '--cloud-only') {
      args.cloudOnly = true;
    } else if (arg === '--skip-isolated') {
      args.skipIsolated = true;
    } else if (arg === '--skip-e2e') {
      args.skipE2E = true;
    } else if (arg === '--verbose' || arg === '-v') {
      args.verbose = true;
    } else if (arg.startsWith('--providers=')) {
      args.providers = arg.split('=')[1].split(',');
    } else if (arg.startsWith('--models=')) {
      args.models = arg.split('=')[1].split(',');
    } else if (arg.startsWith('--runs=')) {
      args.runs = parseInt(arg.split('=')[1], 10) || 3;
    } else if (arg.startsWith('--warmup-runs=')) {
      args.warmupRuns = parseInt(arg.split('=')[1], 10) || 1;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Comprehensive Translation Benchmark Runner

Usage:
  node evaluation/run-translation-benchmarks.js [options]

Options:
  --local-only         Skip cloud providers, only benchmark local models
  --cloud-only         Skip local models, only benchmark cloud providers
  --providers=LIST     Comma-separated list of cloud providers (cerebras,groq,openrouter,custom)
  --models=LIST        Comma-separated list of local models (nllb-200,opus-mt)
  --runs=N             Number of benchmark runs for averaging (default: 3)
  --warmup-runs=N      Number of warmup runs to discard (default: 1)
  --skip-isolated      Skip isolated provider benchmark (A)
  --skip-e2e           Skip end-to-end search evaluation matrix (B)
  --verbose, -v        Verbose output
  --help, -h           Show this help message

Environment Variables:
  CEREBRAS_API_KEY              Enable Cerebras (fastest cloud)
  GROQ_API_KEY                  Enable Groq (50% cheaper)
  OPENROUTER_API_KEY            Enable OpenRouter (free tier)
  TRANSLATION_API_URL           Enable custom provider (e.g., Ollama)
  TRANSLATION_API_KEY           API key for custom provider (optional)
  CEREBRAS_TRANSLATE_MODEL      Override Cerebras model (default: llama3.1-8b)
  GROQ_TRANSLATE_MODEL          Override Groq model (default: llama-3.1-8b-instant)
  TRANSLATION_MODEL             Override custom provider model

Output:
  .agentdb/translation-benchmarks/translation-providers-{timestamp}.json
  .agentdb/translation-benchmarks/search-eval-matrix-{timestamp}.json

Scoring Rule:
  1. Primary: maximize Success@10 (end-to-end)
  2. Secondary: maximize MRR@10
  3. Tie-breaker: minimize p95 latency
  4. Tie-breaker: minimize estimated cost (cloud tokens)
`);
}

// =============================================================================
// TEST QUERIES (shared across all benchmarks)
// =============================================================================

const TEST_QUERIES = [
  // Serbian Cyrillic
  { query: 'аутентификација', expected: 'authentication', lang: 'sr' },
  { query: 'корисник', expected: 'user', lang: 'sr' },
  { query: 'запослени', expected: 'employee', lang: 'sr' },
  { query: 'пројекат', expected: 'project', lang: 'sr' },

  // Russian
  { query: 'пользователь', expected: 'user', lang: 'ru' },
  { query: 'авторизация', expected: 'authorization', lang: 'ru' },

  // German (with diacritics)
  { query: 'Größe', expected: 'size', lang: 'de' },
  { query: 'Mitarbeiter', expected: 'employee', lang: 'de' },
  { query: 'Benutzer', expected: 'user', lang: 'de' },

  // French
  { query: 'utilisateur', expected: 'user', lang: 'fr' },
  { query: 'authentification', expected: 'authentication', lang: 'fr' },

  // Spanish
  { query: 'usuario', expected: 'user', lang: 'es' },
  { query: 'autenticación', expected: 'authentication', lang: 'es' },

  // Japanese
  { query: '認証', expected: 'authentication', lang: 'ja' },
  { query: 'ユーザー', expected: 'user', lang: 'ja' },

  // Chinese
  { query: '用户', expected: 'user', lang: 'zh' },
  { query: '认证', expected: 'authentication', lang: 'zh' },

  // Korean
  { query: '사용자', expected: 'user', lang: 'ko' },
  { query: '인증', expected: 'authentication', lang: 'ko' },
];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function isAcceptable(translation, expected, original) {
  if (!translation || translation === original) return false;
  const t = translation.toLowerCase();
  const e = expected.toLowerCase();
  return t.includes(e) || e.includes(t) || t === e;
}

function cleanTranslationOutput(text, original) {
  if (!text) return original;

  let cleaned = text;

  const stripPrefixes = [
    /^The translation of .+? (?:to English )?is[:\s]*/i,
    /^(?:Here'?s? (?:the )?)?translation[:\s]*/i,
    /^In English[,:\s]*/i,
    /^Translated[:\s]*/i,
    /^English[:\s]*/i,
    /^Output[:\s]*/i,
  ];

  for (const prefix of stripPrefixes) {
    cleaned = cleaned.replace(prefix, '');
  }

  cleaned = cleaned.replace(/^["'""''`]+|["'""''`]+$/g, '');
  cleaned = cleaned.split('\n')[0].trim();

  if (cleaned.length > 200) {
    cleaned = cleaned.slice(0, 200);
  }

  return cleaned.length > 0 ? cleaned : original;
}

// =============================================================================
// BENCHMARK A: ISOLATED TRANSLATION PROVIDER BENCHMARK
// =============================================================================

async function benchmarkCloudProvider(providerKey, queries, verbose = false) {
  const provider = CLOUD_PROVIDERS[providerKey];
  if (!provider || !provider.enabled) {
    return {
      provider: providerKey,
      skipped: true,
      reason: `Missing API key (${providerKey.toUpperCase()}_API_KEY)`,
    };
  }

  const config = getProviderConfig(providerKey);
  const results = [];
  let successCount = 0;
  let totalTokens = 0;

  if (verbose) console.log(`\nBenchmarking ${provider.name}...`);

  for (const { query, expected, lang } of queries) {
    const start = performance.now();

    try {
      const url = `${config.baseUrl}${config.endpoint}`;
      const prompt = `Translate to English (preserve code identifiers): "${query}"\n\nTranslation:`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.rateLimit?.timeout || 5000);

      const headers = {
        'Content-Type': 'application/json',
        ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` }),
        ...(config.extraHeaders || {}),
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText.slice(0, 100)}`);
      }

      const data = await response.json();
      const rawTranslation = data.choices?.[0]?.message?.content?.trim() || '';
      const translation = cleanTranslationOutput(rawTranslation, query);
      const latency = Math.round(performance.now() - start);
      const tokens = data.usage?.total_tokens || 0;
      totalTokens += tokens;

      const acceptable = isAcceptable(translation, expected, query);
      if (acceptable) successCount++;

      results.push({
        query,
        expected,
        translation,
        acceptable,
        latency_ms: latency,
        tokens,
        lang,
      });

      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      const latency = Math.round(performance.now() - start);
      results.push({
        query,
        expected,
        translation: null,
        acceptable: false,
        latency_ms: latency,
        error: err.message,
        lang,
      });
    }
  }

  const latencies = results.filter(r => !r.error).map(r => r.latency_ms);

  return {
    provider: providerKey,
    name: provider.name,
    model: config.model,
    skipped: false,
    total: queries.length,
    success: successCount,
    accuracy: (successCount / queries.length * 100).toFixed(1),
    avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    p50Latency: percentile(latencies, 50),
    p95Latency: percentile(latencies, 95),
    failures: results.filter(r => r.error).length,
    totalTokens,
    estimatedCost: totalTokens * (provider.pricing || 0) / 1000000,
    results,
  };
}

function getProviderConfig(providerKey) {
  const configs = {
    cerebras: {
      apiKey: KEYS.CEREBRAS_API_KEY,
      baseUrl: 'https://api.cerebras.ai/v1',
      endpoint: '/chat/completions',
      model: process.env.CEREBRAS_TRANSLATE_MODEL || 'llama3.1-8b',
      rateLimit: { timeout: 5000 },
    },
    groq: {
      apiKey: KEYS.GROQ_API_KEY,
      baseUrl: 'https://api.groq.com/openai/v1',
      endpoint: '/chat/completions',
      model: process.env.GROQ_TRANSLATE_MODEL || 'llama-3.1-8b-instant',
      rateLimit: { timeout: 5000 },
    },
    openrouter: {
      apiKey: KEYS.OPENROUTER_API_KEY,
      baseUrl: 'https://openrouter.ai/api/v1',
      endpoint: '/chat/completions',
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      extraHeaders: {
        'HTTP-Referer': 'https://github.com/panonitorg/sweet-search',
        'X-Title': 'Sweet Search Translation',
      },
      rateLimit: { timeout: 10000 },
    },
    custom: {
      apiKey: process.env.TRANSLATION_API_KEY || '',
      baseUrl: KEYS.TRANSLATION_API_URL || 'http://localhost:11434/v1',
      endpoint: '/chat/completions',
      model: process.env.TRANSLATION_MODEL || 'llama3.1:8b',
      rateLimit: { timeout: 30000 },
    },
  };

  return configs[providerKey] || null;
}

async function benchmarkLocalModel(modelKey, queries, runActual = true, verbose = false) {
  const model = LOCAL_MODELS[modelKey];
  if (!model || !model.enabled) {
    return {
      model: modelKey,
      skipped: true,
      reason: `Model ${modelKey} not enabled`,
    };
  }

  if (!runActual) {
    return {
      model: modelKey,
      name: model.name,
      huggingfaceId: model.model,
      skipped: false,
      note: 'Local model benchmark skipped (use --run-local to benchmark)',
      config: { avgLatency: model.avgLatency },
    };
  }

  if (verbose) console.log(`\nBenchmarking local model ${model.name}...`);

  try {
    let pipeline;
    try {
      const transformersModule = await import('@huggingface/transformers');
      pipeline = transformersModule.pipeline;
    } catch {
      const transformersModule = await import('@xenova/transformers');
      pipeline = transformersModule.pipeline;
    }

    const initStart = performance.now();
    const translator = await pipeline('translation', model.model, {
      device: 'cpu',
      dtype: 'q8',
    });
    const initLatency = Math.round(performance.now() - initStart);
    if (verbose) console.log(`  Model loaded in ${initLatency}ms`);

    const results = [];
    let successCount = 0;

    const langMap = {
      sr: 'srp_Cyrl', ru: 'rus_Cyrl', uk: 'ukr_Cyrl',
      zh: 'zho_Hans', ja: 'jpn_Jpan', ko: 'kor_Hang',
      de: 'deu_Latn', es: 'spa_Latn', fr: 'fra_Latn',
      pt: 'por_Latn', pl: 'pol_Latn', cs: 'ces_Latn',
      en: 'eng_Latn',
    };

    for (const { query, expected, lang } of queries) {
      const start = performance.now();

      try {
        const srcLang = langMap[lang] || 'eng_Latn';

        const output = await translator(query, {
          src_lang: srcLang,
          tgt_lang: 'eng_Latn',
        });

        const translation = output[0]?.translation_text || query;
        const latency = Math.round(performance.now() - start);

        const acceptable = isAcceptable(translation, expected, query);
        if (acceptable) successCount++;

        results.push({
          query,
          expected,
          translation,
          acceptable,
          latency_ms: latency,
          lang,
        });
      } catch (err) {
        const latency = Math.round(performance.now() - start);
        results.push({
          query,
          expected,
          translation: null,
          acceptable: false,
          latency_ms: latency,
          error: err.message,
          lang,
        });
      }
    }

    const latencies = results.filter(r => !r.error).map(r => r.latency_ms);

    return {
      model: modelKey,
      name: model.name,
      huggingfaceId: model.model,
      skipped: false,
      initLatency,
      total: queries.length,
      success: successCount,
      accuracy: (successCount / queries.length * 100).toFixed(1),
      avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50Latency: percentile(latencies, 50),
      p95Latency: percentile(latencies, 95),
      failures: results.filter(r => r.error).length,
      estimatedCost: 0,
      results,
    };
  } catch (err) {
    return {
      model: modelKey,
      name: model.name,
      skipped: false,
      error: `Failed to load model: ${err.message}`,
    };
  }
}

async function runIsolatedBenchmark(args) {
  console.log('\n' + '='.repeat(70));
  console.log('BENCHMARK A: ISOLATED TRANSLATION PROVIDER/MODEL BENCHMARK');
  console.log('='.repeat(70));

  const results = {
    timestamp: new Date().toISOString(),
    testQueries: TEST_QUERIES.length,
    runs: args.runs,
    warmupRuns: args.warmupRuns,
    cloudProviders: [],
    localModels: [],
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };

  // Cloud providers
  if (!args.localOnly) {
    const providerKeys = args.providers || Object.keys(CLOUD_PROVIDERS);
    console.log(`\nCloud providers to test: ${providerKeys.join(', ')}`);

    for (const key of providerKeys) {
      if (!CLOUD_PROVIDERS[key]) {
        console.log(`[SKIP] Unknown provider: ${key}`);
        continue;
      }

      const allRuns = [];

      // Warmup runs
      for (let i = 0; i < args.warmupRuns; i++) {
        await benchmarkCloudProvider(key, TEST_QUERIES, false);
      }

      // Actual runs
      for (let i = 0; i < args.runs; i++) {
        const result = await benchmarkCloudProvider(key, TEST_QUERIES, args.verbose);
        allRuns.push(result);
      }

      // Aggregate runs
      if (allRuns.length > 0 && !allRuns[0].skipped) {
        const avgResult = aggregateRuns(allRuns);
        results.cloudProviders.push(avgResult);
        console.log(`[DONE] ${avgResult.name}: ${avgResult.accuracy}% accuracy, ${avgResult.avgLatency}ms avg, ${avgResult.p50Latency}ms p50, ${avgResult.p95Latency}ms p95`);
      } else if (allRuns[0]?.skipped) {
        results.cloudProviders.push(allRuns[0]);
        console.log(`[SKIP] ${key}: ${allRuns[0].reason}`);
      }
    }
  }

  // Local models
  if (!args.cloudOnly) {
    const modelKeys = args.models || Object.keys(LOCAL_MODELS);
    console.log(`\nLocal models to test: ${modelKeys.join(', ')}`);

    for (const key of modelKeys) {
      if (!LOCAL_MODELS[key]) {
        console.log(`[SKIP] Unknown model: ${key}`);
        continue;
      }

      const allRuns = [];

      // Warmup runs (model stays loaded)
      let firstRun = await benchmarkLocalModel(key, TEST_QUERIES, true, args.verbose);
      if (firstRun.skipped || firstRun.error) {
        results.localModels.push(firstRun);
        console.log(`[SKIP] ${key}: ${firstRun.reason || firstRun.error}`);
        continue;
      }

      // Use first run as warmup, then do actual runs
      for (let i = 0; i < args.runs; i++) {
        const result = await benchmarkLocalModel(key, TEST_QUERIES, true, args.verbose);
        allRuns.push(result);
      }

      if (allRuns.length > 0 && !allRuns[0].skipped && !allRuns[0].error) {
        const avgResult = aggregateRuns(allRuns);
        results.localModels.push(avgResult);
        console.log(`[DONE] ${avgResult.name}: ${avgResult.accuracy}% accuracy, ${avgResult.avgLatency}ms avg, ${avgResult.p50Latency}ms p50, ${avgResult.p95Latency}ms p95`);
      }
    }
  }

  return results;
}

function aggregateRuns(runs) {
  if (runs.length === 0) return null;

  const first = runs[0];
  const numericKeys = ['success', 'avgLatency', 'p50Latency', 'p95Latency', 'failures', 'totalTokens', 'estimatedCost'];

  const result = { ...first };

  for (const key of numericKeys) {
    if (typeof first[key] === 'number') {
      result[key] = Math.round(runs.reduce((sum, r) => sum + (r[key] || 0), 0) / runs.length);
    }
  }

  result.accuracy = (result.success / first.total * 100).toFixed(1);
  result.runsAveraged = runs.length;

  return result;
}

// =============================================================================
// BENCHMARK B: END-TO-END SEARCH EVALUATION MATRIX
// =============================================================================

async function runE2EMatrixBenchmark(args) {
  console.log('\n' + '='.repeat(70));
  console.log('BENCHMARK B: END-TO-END SEARCH EVALUATION MATRIX');
  console.log('='.repeat(70));

  const results = {
    timestamp: new Date().toISOString(),
    matrixConfigurations: [],
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };

  // Build matrix of configurations to test
  const configurations = [];

  // Get available cloud providers
  const availableProviders = [];
  if (!args.localOnly) {
    for (const [key, provider] of Object.entries(CLOUD_PROVIDERS)) {
      if (provider.enabled) {
        if (!args.providers || args.providers.includes(key)) {
          availableProviders.push(key);
        }
      }
    }
  }

  // Get available local models
  const availableModels = [];
  if (!args.cloudOnly) {
    for (const [key, model] of Object.entries(LOCAL_MODELS)) {
      if (model.enabled) {
        if (!args.models || args.models.includes(key)) {
          availableModels.push(key);
        }
      }
    }
  }

  console.log(`\nAvailable cloud providers: ${availableProviders.length > 0 ? availableProviders.join(', ') : 'none'}`);
  console.log(`Available local models: ${availableModels.length > 0 ? availableModels.join(', ') : 'none'}`);

  // Add cloud provider configurations
  for (const provider of availableProviders) {
    configurations.push({
      name: `cloud-${provider}`,
      env: {
        TRANSLATION_PROVIDER: provider,
        TRANSLATION_OFFLINE: 'false',
      },
    });
  }

  // Add local model configurations (offline mode)
  for (const model of availableModels) {
    configurations.push({
      name: `local-${model}`,
      env: {
        TRANSLATION_PROVIDER: 'auto',
        TRANSLATION_LOCAL_MODEL: model,
        TRANSLATION_OFFLINE: 'true',
      },
    });
  }

  // Add hybrid configurations (cloud + local fallback)
  if (availableProviders.length > 0 && availableModels.length > 0) {
    configurations.push({
      name: `hybrid-${availableProviders[0]}-${availableModels[0]}`,
      env: {
        TRANSLATION_PROVIDER: availableProviders[0],
        TRANSLATION_LOCAL_MODEL: availableModels[0],
        TRANSLATION_OFFLINE: 'false',
      },
    });
  }

  if (configurations.length === 0) {
    console.log('\n[WARN] No configurations available for E2E testing');
    return results;
  }

  console.log(`\nTesting ${configurations.length} configurations...`);

  for (const config of configurations) {
    console.log(`\n--- Testing: ${config.name} ---`);

    try {
      const evalResult = await runEvaluationWithEnv(config.env, args);
      results.matrixConfigurations.push({
        name: config.name,
        config: config.env,
        ...evalResult,
      });
      console.log(`  Success@10: ${(evalResult.successRate * 100).toFixed(1)}%`);
      console.log(`  MRR@10: ${evalResult.mrr.toFixed(4)}`);
      console.log(`  p95 Latency: ${evalResult.p95Latency}ms`);
    } catch (err) {
      console.log(`  [ERROR] ${err.message}`);
      results.matrixConfigurations.push({
        name: config.name,
        config: config.env,
        error: err.message,
      });
    }
  }

  return results;
}

async function runEvaluationWithEnv(envOverrides, args) {
  // Import SmartSearch dynamically
  const { SmartSearch } = await import('../smart-search-v21.js');

  // Apply env overrides
  const originalEnv = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }

  try {
    // Reload config to pick up new env
    const { TRANSLATION_CONFIG } = await import('../config.js');

    const search = new SmartSearch({ verbose: false });
    await search.init();

    // Load multilingual queries
    const querySetPath = path.join(__dirname, 'query-sets', 'multilingual-hybrid.json');
    let queries = [];

    if (fs.existsSync(querySetPath)) {
      const content = JSON.parse(fs.readFileSync(querySetPath, 'utf-8'));
      queries = content.queries || [];
    }

    // Fallback to our test queries if no query set
    if (queries.length === 0) {
      queries = TEST_QUERIES.map((q, i) => ({
        id: `ML-${i + 1}`,
        query: q.query,
        language: q.lang,
        expected: {
          contains: [{ mode: 'any', namePattern: q.expected }],
        },
      }));
    }

    // Run queries
    const results = [];
    const latencies = [];
    let successCount = 0;
    let translationTierCounts = { T1: 0, T2: 0, T3: 0, none: 0 };

    for (const q of queries.slice(0, 30)) { // Limit to 30 for speed
      const start = performance.now();

      try {
        const { results: searchResults, stats } = await search.search(q.query, { k: 10 });
        const latency = Math.round(performance.now() - start);
        latencies.push(latency);

        // Check success (any result matching expected)
        let success = false;
        if (q.expected?.contains) {
          for (const cond of q.expected.contains) {
            if (cond.namePattern) {
              const pattern = new RegExp(cond.namePattern, 'i');
              success = searchResults.some(r => pattern.test(r.name || r.file || ''));
              if (success) break;
            }
          }
        }

        if (success) successCount++;

        // Track translation tier
        const tier = stats?.translation?.tier || 'none';
        translationTierCounts[tier] = (translationTierCounts[tier] || 0) + 1;

        results.push({
          query: q.query,
          success,
          latency,
          translationTier: tier,
          resultCount: searchResults.length,
        });
      } catch (err) {
        results.push({
          query: q.query,
          success: false,
          error: err.message,
        });
      }
    }

    await search.close?.();

    // Calculate MRR (simplified)
    const mrr = successCount / results.length;

    return {
      total: results.length,
      success: successCount,
      successRate: successCount / results.length,
      mrr,
      avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50Latency: percentile(latencies, 50),
      p95Latency: percentile(latencies, 95),
      translationTierUsage: translationTierCounts,
    };
  } finally {
    // Restore original env
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// =============================================================================
// SCORING AND RECOMMENDATION
// =============================================================================

function selectBestConfiguration(isolatedResults, matrixResults) {
  console.log('\n' + '='.repeat(70));
  console.log('BEST CONFIGURATION RECOMMENDATION');
  console.log('='.repeat(70));

  console.log(`
Scoring Rule:
  1. Primary: maximize Success@10 (end-to-end search)
  2. Secondary: maximize MRR@10
  3. Tie-breaker 1: minimize p95 latency
  4. Tie-breaker 2: minimize estimated cost
`);

  // Score matrix configurations
  const scored = [];

  for (const config of matrixResults.matrixConfigurations) {
    if (config.error) continue;

    // Find matching isolated result for cost
    let cost = 0;
    const providerMatch = config.name.match(/^cloud-(\w+)$/);
    if (providerMatch) {
      const isolatedProvider = isolatedResults.cloudProviders.find(p => p.provider === providerMatch[1]);
      if (isolatedProvider && !isolatedProvider.skipped) {
        cost = isolatedProvider.estimatedCost || 0;
      }
    }

    scored.push({
      name: config.name,
      config: config.config,
      successRate: config.successRate || 0,
      mrr: config.mrr || 0,
      p95Latency: config.p95Latency || 99999,
      cost,
      // Composite score (higher is better)
      score: (config.successRate || 0) * 1000 + (config.mrr || 0) * 100 - (config.p95Latency || 0) / 1000 - cost * 10,
    });
  }

  // Sort by composite score descending
  scored.sort((a, b) => b.score - a.score);

  console.log('Ranked Configurations:');
  console.log('-'.repeat(70));
  console.log('Rank  Name'.padEnd(35) + 'Success  MRR     P95(ms)  Cost    Score');
  console.log('-'.repeat(70));

  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];
    console.log(
      `${(i + 1).toString().padEnd(6)}${s.name.padEnd(29)}${(s.successRate * 100).toFixed(1).padStart(6)}%  ${s.mrr.toFixed(4).padStart(6)}  ${s.p95Latency.toString().padStart(7)}  $${s.cost.toFixed(4).padStart(7)}  ${s.score.toFixed(2)}`
    );
  }

  // Determine recommended defaults
  const recommendation = {
    bestOverall: scored[0] || null,
    bestCloud: scored.find(s => s.name.startsWith('cloud-')) || null,
    bestLocal: scored.find(s => s.name.startsWith('local-')) || null,
    cloudPriorityOrder: [],
    localModelDefault: null,
  };

  // Build cloud priority order
  const cloudScored = scored.filter(s => s.name.startsWith('cloud-'));
  recommendation.cloudPriorityOrder = cloudScored.map(s => s.name.replace('cloud-', ''));

  // Best local model
  const localScored = scored.filter(s => s.name.startsWith('local-'));
  if (localScored.length > 0) {
    recommendation.localModelDefault = localScored[0].name.replace('local-', '');
  }

  console.log('\n' + '='.repeat(70));
  console.log('RECOMMENDED DEFAULTS');
  console.log('='.repeat(70));

  if (recommendation.bestOverall) {
    console.log(`\nBest Overall: ${recommendation.bestOverall.name}`);
    console.log(`  - Success@10: ${(recommendation.bestOverall.successRate * 100).toFixed(1)}%`);
    console.log(`  - MRR@10: ${recommendation.bestOverall.mrr.toFixed(4)}`);
    console.log(`  - p95 Latency: ${recommendation.bestOverall.p95Latency}ms`);
  }

  if (recommendation.cloudPriorityOrder.length > 0) {
    console.log(`\nCloud Provider Priority Order: ${recommendation.cloudPriorityOrder.join(' > ')}`);
  }

  if (recommendation.localModelDefault) {
    console.log(`\nDefault Local Model: ${recommendation.localModelDefault}`);
  }

  // Config patch suggestion
  console.log('\n' + '='.repeat(70));
  console.log('PATCH SUGGESTION');
  console.log('='.repeat(70));
  console.log(`
If you approve, I will change these lines in config.js:

1. Cloud provider priority order:
   Current: [by API key availability]
   Recommended: ${recommendation.cloudPriorityOrder.join(', ') || 'no change'}

2. Default local model:
   Current: nllb-200 (priority: 1)
   Recommended: ${recommendation.localModelDefault || 'no change'}

To apply, run:
  node evaluation/apply-translation-defaults.js --apply
`);

  return recommendation;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('COMPREHENSIVE TRANSLATION BENCHMARK');
  console.log('='.repeat(70));
  console.log(`\nTimestamp: ${new Date().toISOString()}`);
  console.log(`Runs: ${args.runs}, Warmup: ${args.warmupRuns}`);
  console.log(`Mode: ${args.localOnly ? 'local-only' : args.cloudOnly ? 'cloud-only' : 'all'}`);

  console.log('\nAPI Key Status:');
  console.log(`  CEREBRAS_API_KEY: ${maskKey(KEYS.CEREBRAS_API_KEY)}`);
  console.log(`  GROQ_API_KEY: ${maskKey(KEYS.GROQ_API_KEY)}`);
  console.log(`  OPENROUTER_API_KEY: ${maskKey(KEYS.OPENROUTER_API_KEY)}`);
  console.log(`  TRANSLATION_API_URL: ${KEYS.TRANSLATION_API_URL || 'not set'}`);

  // Check if any cloud providers are available
  const hasCloud = Object.values(CLOUD_PROVIDERS).some(p => p.enabled);
  if (!hasCloud && !args.localOnly) {
    console.log('\n[WARN] No cloud API keys found. Running local-only mode.');
    args.localOnly = true;
  }

  // Ensure output directory exists
  const outputDir = path.join(PROJECT_ROOT, '.agentdb', 'translation-benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  let isolatedResults = null;
  let matrixResults = null;

  // Benchmark A: Isolated translation provider benchmark
  if (!args.skipIsolated) {
    isolatedResults = await runIsolatedBenchmark(args);

    const isolatedFile = path.join(outputDir, `translation-providers-${timestamp}.json`);
    fs.writeFileSync(isolatedFile, JSON.stringify(isolatedResults, null, 2));
    console.log(`\nIsolated benchmark saved: ${isolatedFile}`);
  }

  // Benchmark B: End-to-end search evaluation matrix
  if (!args.skipE2E) {
    matrixResults = await runE2EMatrixBenchmark(args);

    const matrixFile = path.join(outputDir, `search-eval-matrix-${timestamp}.json`);
    fs.writeFileSync(matrixFile, JSON.stringify(matrixResults, null, 2));
    console.log(`\nE2E matrix saved: ${matrixFile}`);
  }

  // Generate recommendation
  if (isolatedResults && matrixResults) {
    const recommendation = selectBestConfiguration(isolatedResults, matrixResults);

    // Save combined results
    const combinedFile = path.join(outputDir, `benchmark-combined-${timestamp}.json`);
    fs.writeFileSync(combinedFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      isolated: isolatedResults,
      matrix: matrixResults,
      recommendation,
    }, null, 2));
    console.log(`\nCombined results saved: ${combinedFile}`);
  }

  // Print summary tables
  printSummaryTables(isolatedResults, matrixResults);

  console.log('\n' + '='.repeat(70));
  console.log('BENCHMARK COMPLETE');
  console.log('='.repeat(70));
}

function printSummaryTables(isolated, matrix) {
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY TABLES');
  console.log('='.repeat(70));

  // Isolated provider table
  if (isolated) {
    console.log('\n--- Isolated Translation Provider Benchmark ---');
    console.log('Provider'.padEnd(15) + 'Accuracy'.padEnd(10) + 'Avg(ms)'.padEnd(10) + 'P50(ms)'.padEnd(10) + 'P95(ms)'.padEnd(10) + 'Cost');
    console.log('-'.repeat(65));

    for (const r of isolated.cloudProviders) {
      if (!r.skipped) {
        console.log(
          r.name.padEnd(15) +
          `${r.accuracy}%`.padEnd(10) +
          String(r.avgLatency).padEnd(10) +
          String(r.p50Latency).padEnd(10) +
          String(r.p95Latency).padEnd(10) +
          `$${(r.estimatedCost || 0).toFixed(4)}`
        );
      } else {
        console.log(r.provider.padEnd(15) + `skipped (${r.reason})`.padEnd(50));
      }
    }

    for (const r of isolated.localModels) {
      if (!r.skipped && !r.error && !r.note) {
        console.log(
          r.name.slice(0, 14).padEnd(15) +
          `${r.accuracy}%`.padEnd(10) +
          String(r.avgLatency).padEnd(10) +
          String(r.p50Latency).padEnd(10) +
          String(r.p95Latency).padEnd(10) +
          '$0.0000'
        );
      }
    }
  }

  // Matrix evaluation table
  if (matrix && matrix.matrixConfigurations.length > 0) {
    console.log('\n--- End-to-End Search Evaluation Matrix ---');
    console.log('Configuration'.padEnd(30) + 'Success@10'.padEnd(12) + 'MRR'.padEnd(10) + 'P95(ms)'.padEnd(10) + 'T1/T2/T3');
    console.log('-'.repeat(75));

    for (const r of matrix.matrixConfigurations) {
      if (!r.error) {
        const tierUsage = r.translationTierUsage || {};
        const tiers = `${tierUsage.T1 || 0}/${tierUsage.T2 || 0}/${tierUsage.T3 || 0}`;
        console.log(
          r.name.padEnd(30) +
          `${(r.successRate * 100).toFixed(1)}%`.padEnd(12) +
          r.mrr.toFixed(4).padEnd(10) +
          String(r.p95Latency).padEnd(10) +
          tiers
        );
      } else {
        console.log(r.name.padEnd(30) + `error: ${r.error}`.padEnd(45));
      }
    }
  }
}

main().catch(err => {
  console.error('\nBenchmark failed:', err);
  process.exit(1);
});
