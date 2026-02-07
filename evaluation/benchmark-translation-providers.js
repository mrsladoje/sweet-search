#!/usr/bin/env node
/**
 * Translation Provider Benchmark
 *
 * Runs translation benchmarks across all configured providers (cloud + local).
 * Can run in "local-only" mode without API keys.
 *
 * Usage:
 *   node evaluation/benchmark-translation-providers.js
 *   node evaluation/benchmark-translation-providers.js --local-only
 *   node evaluation/benchmark-translation-providers.js --provider=groq
 *
 * Output: .agentdb/translation-benchmarks/*.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CONFIGURATION (Standalone - doesn't require config.js TRANSLATION_* exports)
// =============================================================================

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SEARCH_100X_ROOT = path.resolve(__dirname, '..');

// Load .env if exists (check local directory first, then project root)
try {
  const localEnvPath = path.join(SEARCH_100X_ROOT, '.env');
  const projectEnvPath = path.join(PROJECT_ROOT, '.env');
  const dotenvPath = fs.existsSync(localEnvPath) ? localEnvPath : projectEnvPath;

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

// API Keys
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Provider configurations (mirrors docs/TRANSLATION.md schema)
const TRANSLATION_PROVIDERS = {
  cerebras: {
    enabled: CEREBRAS_API_KEY.length > 0,
    priority: 1,
    name: 'Cerebras',
    apiKey: CEREBRAS_API_KEY,
    baseUrl: 'https://api.cerebras.ai/v1',
    endpoint: '/chat/completions',
    model: process.env.CEREBRAS_TRANSLATE_MODEL || 'llama3.1-8b',
    maxTokens: 100,
    temperature: 0.1,
    rateLimit: {
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 100,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0.20 },
  },

  groq: {
    enabled: GROQ_API_KEY.length > 0,
    priority: 2,
    name: 'Groq',
    apiKey: GROQ_API_KEY,
    baseUrl: 'https://api.groq.com/openai/v1',
    endpoint: '/chat/completions',
    model: process.env.GROQ_TRANSLATE_MODEL || 'llama-3.1-8b-instant',
    maxTokens: 100,
    temperature: 0.1,
    rateLimit: {
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 100,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0.13 },
  },

  openrouter: {
    enabled: OPENROUTER_API_KEY.length > 0,
    priority: 3,
    name: 'OpenRouter',
    apiKey: OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    endpoint: '/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    maxTokens: 100,
    temperature: 0.1,
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/panonitorg/sweet-search',
      'X-Title': 'Sweet Search Translation',
    },
    rateLimit: {
      timeout: 10000,
      maxRetries: 2,
      retryDelay: 500,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0 },
  },

  custom: {
    enabled: process.env.TRANSLATION_API_URL?.length > 0,
    priority: 99,
    name: 'Custom',
    apiKey: process.env.TRANSLATION_API_KEY || '',
    baseUrl: process.env.TRANSLATION_API_URL || 'http://localhost:11434/v1',
    endpoint: '/chat/completions',
    model: process.env.TRANSLATION_MODEL || 'llama3.1:8b',
    maxTokens: 100,
    temperature: 0.1,
    rateLimit: {
      timeout: 30000,
      maxRetries: 1,
      retryDelay: 1000,
      backoffMultiplier: 1,
    },
    pricing: { perMillionTokens: 0 },
  },
};

const TRANSLATION_LOCAL_MODELS = {
  'nllb-200': {
    enabled: true,
    priority: 1,
    name: 'NLLB-200 Distilled',
    type: 'translation',
    model: 'Xenova/nllb-200-distilled-600M',
    quantized: true,
    device: 'cpu',
    size: '600MB',
    languages: 200,
    avgLatency: '500-1000ms',
  },

  'opus-mt': {
    enabled: true,
    priority: 2,
    name: 'Opus-MT Many->English',
    type: 'translation',
    model: 'Helsinki-NLP/opus-mt-mul-en',
    quantized: true,
    device: 'cpu',
    size: '300MB',
    languages: 'many->en',
    avgLatency: '50-200ms',
  },
};

const TRANSLATION_PROMPTS = {
  short: `Translate to English (preserve code identifiers): "{query}"

Translation:`,

  extended: `Translate this code search query to English.

RULES:
1. Preserve code identifiers (PascalCase, camelCase, snake_case) unchanged
2. Translate natural language parts to English programming terminology
3. Output ONLY the translated query, nothing else
4. If already English, return as-is

Query: {query}

Translation:`,
};

// =============================================================================
// TEST QUERIES
// =============================================================================

const TEST_QUERIES = [
  // Serbian Cyrillic
  { query: '\u0430\u0443\u0442\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0446\u0438\u0458\u0430', expected: 'authentication', lang: 'sr' },
  { query: '\u043a\u043e\u0440\u0438\u0441\u043d\u0438\u043a', expected: 'user', lang: 'sr' },
  { query: '\u0437\u0430\u043f\u043e\u0441\u043b\u0435\u043d\u0438', expected: 'employee', lang: 'sr' },
  { query: '\u043f\u0440\u043e\u0458\u0435\u043a\u0430\u0442', expected: 'project', lang: 'sr' },

  // Russian
  { query: '\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c', expected: 'user', lang: 'ru' },
  { query: '\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u044f', expected: 'authorization', lang: 'ru' },

  // German (with diacritics)
  { query: 'Gr\u00f6\u00dfe', expected: 'size', lang: 'de' },
  { query: 'Mitarbeiter', expected: 'employee', lang: 'de' },
  { query: 'Benutzer', expected: 'user', lang: 'de' },

  // French
  { query: 'utilisateur', expected: 'user', lang: 'fr' },
  { query: 'authentification', expected: 'authentication', lang: 'fr' },

  // Spanish
  { query: 'usuario', expected: 'user', lang: 'es' },
  { query: 'autenticaci\u00f3n', expected: 'authentication', lang: 'es' },

  // Japanese
  { query: '\u8a8d\u8a3c', expected: 'authentication', lang: 'ja' },
  { query: '\u30e6\u30fc\u30b6\u30fc', expected: 'user', lang: 'ja' },

  // Chinese
  { query: '\u7528\u6237', expected: 'user', lang: 'zh' },
  { query: '\u8ba4\u8bc1', expected: 'authentication', lang: 'zh' },

  // Korean
  { query: '\uc0ac\uc6a9\uc790', expected: 'user', lang: 'ko' },
  { query: '\uc778\uc99d', expected: 'authentication', lang: 'ko' },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate percentile from sorted array
 */
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Check if translation is acceptable (contains or matches expected)
 */
function isAcceptable(translation, expected, original) {
  if (!translation || translation === original) return false;
  const t = translation.toLowerCase();
  const e = expected.toLowerCase();
  return t.includes(e) || e.includes(t) || t === e;
}

/**
 * Clean LLM translation output
 */
function cleanTranslationOutput(text, original) {
  if (!text) return original;

  let cleaned = text;

  // Strip common prefixes
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

  // Strip surrounding quotes
  cleaned = cleaned.replace(/^["'""''`]+|["'""''`]+$/g, '');

  // Take only first line
  cleaned = cleaned.split('\n')[0].trim();

  // Truncate if too long
  if (cleaned.length > 200) {
    cleaned = cleaned.slice(0, 200);
  }

  return cleaned.length > 0 ? cleaned : original;
}

/**
 * Get translation provider config by key
 */
function getTranslationProvider(providerKey) {
  return TRANSLATION_PROVIDERS[providerKey] || null;
}

// =============================================================================
// CLOUD PROVIDER BENCHMARK
// =============================================================================

/**
 * Benchmark a cloud provider
 */
async function benchmarkCloudProvider(providerKey, queries) {
  const provider = getTranslationProvider(providerKey);
  if (!provider || !provider.enabled) {
    return {
      provider: providerKey,
      skipped: true,
      reason: `No API key for ${providerKey}`,
    };
  }

  const results = [];
  let successCount = 0;
  let totalTokens = 0;

  console.log(`\nBenchmarking ${provider.name}...`);

  for (const { query, expected, lang } of queries) {
    const start = performance.now();

    try {
      // Build request
      const url = `${provider.baseUrl}${provider.endpoint}`;
      const prompt = TRANSLATION_PROMPTS.short.replace('{query}', query);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), provider.rateLimit?.timeout || 5000);

      const headers = {
        'Content-Type': 'application/json',
        // Only set Authorization if apiKey is present (for custom/no-auth endpoints)
        ...(provider.apiKey && { 'Authorization': `Bearer ${provider.apiKey}` }),
      };

      // Add extra headers if defined
      if (provider.extraHeaders) {
        Object.assign(headers, provider.extraHeaders);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: provider.maxTokens || 100,
          temperature: provider.temperature || 0.1,
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
        rawTranslation: rawTranslation.slice(0, 50),
        translation,
        acceptable,
        latency_ms: latency,
        tokens,
        lang,
      });

      // Rate limiting - small delay between requests
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
    model: provider.model,
    skipped: false,
    total: queries.length,
    success: successCount,
    accuracy: (successCount / queries.length * 100).toFixed(1) + '%',
    avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    p50Latency: percentile(latencies, 50),
    p95Latency: percentile(latencies, 95),
    totalTokens,
    estimatedCost: totalTokens * (provider.pricing?.perMillionTokens || 0) / 1000000,
    results,
  };
}

// =============================================================================
// LOCAL MODEL BENCHMARK
// =============================================================================

/**
 * Benchmark local model (reports config, actual benchmarking requires --run-local)
 */
async function benchmarkLocalModel(modelKey, queries, runActualBenchmark = false) {
  const model = TRANSLATION_LOCAL_MODELS[modelKey];
  if (!model || !model.enabled) {
    return {
      model: modelKey,
      skipped: true,
      reason: `Model ${modelKey} not enabled`,
    };
  }

  if (!runActualBenchmark) {
    // Just report configuration without loading the model
    return {
      model: modelKey,
      name: model.name,
      huggingfaceId: model.model,
      skipped: false,
      note: 'Local model benchmark skipped (requires model loading). Use --run-local to benchmark.',
      config: {
        type: model.type,
        size: model.size,
        quantized: model.quantized,
        device: model.device,
        avgLatency: model.avgLatency,
        languages: model.languages,
      },
    };
  }

  // Actual local model benchmarking
  console.log(`\nBenchmarking local model ${model.name} (loading model, may take 10-30s)...`);

  try {
    // Dynamic import of transformers
    let pipeline;
    try {
      const transformersModule = await import('@huggingface/transformers');
      pipeline = transformersModule.pipeline;
    } catch {
      const transformersModule = await import('@xenova/transformers');
      pipeline = transformersModule.pipeline;
    }

    const initStart = performance.now();
    const translator = await pipeline(model.type, model.model, {
      device: model.device,
      dtype: model.quantized ? 'q8' : 'fp32',
    });
    const initLatency = Math.round(performance.now() - initStart);
    console.log(`  Model loaded in ${initLatency}ms`);

    const results = [];
    let successCount = 0;

    for (const { query, expected, lang } of queries) {
      const start = performance.now();

      try {
        // Detect source language for NLLB format
        const srcLang = detectSourceLanguage(query, lang);

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
      accuracy: (successCount / queries.length * 100).toFixed(1) + '%',
      avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50Latency: percentile(latencies, 50),
      p95Latency: percentile(latencies, 95),
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

/**
 * Detect source language for NLLB model
 */
function detectSourceLanguage(text, langHint) {
  // Map language hints to NLLB codes
  const langMap = {
    sr: 'srp_Cyrl',
    ru: 'rus_Cyrl',
    uk: 'ukr_Cyrl',
    zh: 'zho_Hans',
    ja: 'jpn_Jpan',
    ko: 'kor_Hang',
    de: 'deu_Latn',
    es: 'spa_Latn',
    fr: 'fra_Latn',
    pt: 'por_Latn',
    pl: 'pol_Latn',
    cs: 'ces_Latn',
    en: 'eng_Latn',
  };

  if (langHint && langMap[langHint]) {
    return langMap[langHint];
  }

  // Auto-detect from script
  if (/[\u0400-\u04FF]/.test(text)) return 'rus_Cyrl';  // Cyrillic
  if (/[\u4e00-\u9fff]/.test(text)) return 'zho_Hans';  // CJK
  if (/[\u3040-\u30ff]/.test(text)) return 'jpn_Jpan';  // Japanese
  if (/[\uac00-\ud7af]/.test(text)) return 'kor_Hang';  // Korean

  return 'eng_Latn';  // Default
}

// =============================================================================
// MAIN BENCHMARK RUNNER
// =============================================================================

async function runBenchmark() {
  const args = process.argv.slice(2);
  const localOnly = args.includes('--local-only');
  const runLocal = args.includes('--run-local');
  const specificProvider = args.find(a => a.startsWith('--provider='))?.split('=')[1];
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
Translation Provider Benchmark

Usage:
  node evaluation/benchmark-translation-providers.js [options]

Options:
  --local-only       Skip cloud providers, only benchmark local models
  --run-local        Actually run local model benchmarks (slow, loads models)
  --provider=NAME    Only benchmark specific cloud provider (cerebras, groq, openrouter, custom)
  --help, -h         Show this help message

Environment Variables:
  CEREBRAS_API_KEY        Enable Cerebras provider
  GROQ_API_KEY            Enable Groq provider
  OPENROUTER_API_KEY      Enable OpenRouter provider
  TRANSLATION_API_URL     Enable custom provider (e.g., Ollama at http://localhost:11434/v1)
  TRANSLATION_API_KEY     API key for custom provider (optional)
  TRANSLATION_MODEL       Model for custom provider

Output:
  Results saved to: .agentdb/translation-benchmarks/benchmark-{timestamp}.json
`);
    process.exit(0);
  }

  console.log('='.repeat(60));
  console.log('Translation Provider Benchmark');
  console.log('='.repeat(60));
  console.log(`Test queries: ${TEST_QUERIES.length}`);
  console.log(`Mode: ${localOnly ? 'local-only' : 'all providers'}`);
  if (specificProvider) console.log(`Specific provider: ${specificProvider}`);
  if (runLocal) console.log('Running local model benchmarks (this may take a while)');
  console.log('');

  const benchmarkResults = {
    timestamp: new Date().toISOString(),
    testQueries: TEST_QUERIES.length,
    mode: localOnly ? 'local-only' : 'all',
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      // Mask API keys for security (show only that they are set)
      apiKeys: {
        cerebras: CEREBRAS_API_KEY.length > 0 ? `****${CEREBRAS_API_KEY.slice(-4)}` : 'not set',
        groq: GROQ_API_KEY.length > 0 ? `****${GROQ_API_KEY.slice(-4)}` : 'not set',
        openrouter: OPENROUTER_API_KEY.length > 0 ? `****${OPENROUTER_API_KEY.slice(-4)}` : 'not set',
      },
    },
    cloudProviders: [],
    localModels: [],
  };

  // Benchmark cloud providers (unless local-only)
  if (!localOnly) {
    const providerKeys = specificProvider
      ? [specificProvider]
      : Object.keys(TRANSLATION_PROVIDERS);

    for (const key of providerKeys) {
      const result = await benchmarkCloudProvider(key, TEST_QUERIES);
      benchmarkResults.cloudProviders.push(result);

      if (result.skipped) {
        console.log(`[SKIP] ${key}: ${result.reason}`);
      } else {
        console.log(`[DONE] ${result.name}: ${result.accuracy} accuracy, ${result.avgLatency}ms avg, ${result.p50Latency}ms p50`);
      }
    }
  }

  // Benchmark local models
  console.log('\n--- Local Models ---');
  for (const key of Object.keys(TRANSLATION_LOCAL_MODELS)) {
    const result = await benchmarkLocalModel(key, TEST_QUERIES, runLocal);
    benchmarkResults.localModels.push(result);

    if (result.skipped) {
      console.log(`[SKIP] ${key}: ${result.reason}`);
    } else if (result.error) {
      console.log(`[ERROR] ${result.name}: ${result.error}`);
    } else if (result.note) {
      console.log(`[INFO] ${result.name}: ${result.config.avgLatency}, ${result.config.languages} languages`);
    } else {
      console.log(`[DONE] ${result.name}: ${result.accuracy} accuracy, ${result.avgLatency}ms avg`);
    }
  }

  // Save results
  const outputDir = path.join(PROJECT_ROOT, '.agentdb', 'translation-benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = path.join(outputDir, `translation-providers-${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(benchmarkResults, null, 2));
  console.log(`\nResults saved to: ${outputFile}`);

  // Summary table
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log('Provider'.padEnd(15) + 'Accuracy'.padEnd(12) + 'Avg(ms)'.padEnd(10) + 'P50(ms)'.padEnd(10) + 'Cost');
  console.log('-'.repeat(60));

  for (const r of benchmarkResults.cloudProviders) {
    if (!r.skipped) {
      console.log(
        r.name.padEnd(15) +
        r.accuracy.padEnd(12) +
        String(r.avgLatency).padEnd(10) +
        String(r.p50Latency).padEnd(10) +
        `$${r.estimatedCost.toFixed(4)}`
      );
    } else {
      console.log(r.provider.padEnd(15) + 'skipped'.padEnd(12) + '-'.padEnd(10) + '-'.padEnd(10) + '-');
    }
  }

  if (runLocal) {
    console.log('-'.repeat(60));
    for (const r of benchmarkResults.localModels) {
      if (!r.skipped && !r.error && !r.note) {
        console.log(
          r.name.slice(0, 14).padEnd(15) +
          r.accuracy.padEnd(12) +
          String(r.avgLatency).padEnd(10) +
          String(r.p50Latency).padEnd(10) +
          '$0.0000'
        );
      }
    }
  }

  return benchmarkResults;
}

// Run if executed directly
runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
