#!/usr/bin/env node
/**
 * Comprehensive Translation Model Benchmark
 *
 * Tests ALL models from the SOTA Translation Research Report:
 *
 * Cloud Providers:
 * - Cerebras: llama3.1-8b, qwen3-30b-a3b
 * - Groq: llama-3.1-8b-instant, llama-3.3-70b
 * - OpenRouter: meta-llama/llama-3.1-8b-instruct:free
 *
 * Local Models:
 * - NLLB-200-distilled-600M
 * - Opus-MT (Helsinki-NLP)
 * - mT5-small
 * - T5-small
 *
 * Output: MODELS_BENCHMARK.md with structured results
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SEARCH_100X_ROOT = path.resolve(__dirname, '..');

// =============================================================================
// API KEYS (from environment)
// =============================================================================

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

function maskKey(key) {
  if (!key || key.length < 8) return 'not set';
  return `****${key.slice(-4)}`;
}

// =============================================================================
// MODEL CONFIGURATIONS (from Research Report)
// =============================================================================

const CLOUD_MODELS = [
  // Cerebras Models
  {
    id: 'cerebras-llama3.1-8b',
    provider: 'Cerebras',
    model: 'llama3.1-8b',
    baseUrl: 'https://api.cerebras.ai/v1',
    endpoint: '/chat/completions',
    apiKey: CEREBRAS_API_KEY,
    inputPrice: 0.10,
    outputPrice: 0.10,
    speed: '1800 tok/s',
    multilingual: 'Good',
    notes: 'Current default, general LLM',
  },
  {
    id: 'cerebras-qwen3-32b',
    provider: 'Cerebras',
    model: 'qwen-3-32b',
    baseUrl: 'https://api.cerebras.ai/v1',
    endpoint: '/chat/completions',
    apiKey: CEREBRAS_API_KEY,
    inputPrice: 0.10,
    outputPrice: 0.30,
    speed: '~1000 tok/s',
    multilingual: '100+ langs',
    notes: 'Best multilingual, MoE efficient',
    disableReasoning: true, // Disable <think> mode
  },
  // Groq Models
  {
    id: 'groq-llama3.1-8b-instant',
    provider: 'Groq',
    model: 'llama-3.1-8b-instant',
    baseUrl: 'https://api.groq.com/openai/v1',
    endpoint: '/chat/completions',
    apiKey: GROQ_API_KEY,
    inputPrice: 0.05,
    outputPrice: 0.08,
    speed: '840 tok/s',
    multilingual: 'Good',
    notes: '50% cheaper than Cerebras',
  },
  {
    id: 'groq-llama3.3-70b',
    provider: 'Groq',
    model: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    endpoint: '/chat/completions',
    apiKey: GROQ_API_KEY,
    inputPrice: 0.59,
    outputPrice: 0.79,
    speed: '394 tok/s',
    multilingual: 'Excellent',
    notes: 'Better quality, higher cost',
  },
  // OpenRouter Models - using currently available free models (2026)
  {
    id: 'openrouter-llama4-scout-free',
    provider: 'OpenRouter',
    model: 'meta-llama/llama-4-scout:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    endpoint: '/chat/completions',
    apiKey: OPENROUTER_API_KEY,
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/panonitorg/sweet-search',
      'X-Title': 'Sweet Search Translation Benchmark',
    },
    inputPrice: 0,
    outputPrice: 0,
    speed: '~1000 tok/s',
    multilingual: 'Excellent',
    notes: 'FREE tier, Llama 4 Scout',
  },
  {
    id: 'openrouter-mistral-small-free',
    provider: 'OpenRouter',
    model: 'mistralai/mistral-small-3.1-24b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    endpoint: '/chat/completions',
    apiKey: OPENROUTER_API_KEY,
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/panonitorg/sweet-search',
      'X-Title': 'Sweet Search Translation Benchmark',
    },
    inputPrice: 0,
    outputPrice: 0,
    speed: '~800 tok/s',
    multilingual: 'Excellent',
    notes: 'FREE tier, Mistral Small 24B (100+ langs)',
  },
];

const LOCAL_MODELS = [
  {
    id: 'nllb-200-distilled-600M',
    name: 'NLLB-200 Distilled',
    model: 'Xenova/nllb-200-distilled-600M',
    pipelineType: 'translation',
    size: '600MB',
    languages: '200+',
    expectedLatency: '500-1000ms',
    quality: 'Medium',
    notes: 'Current default, broad coverage',
  },
  {
    id: 'opus-mt-mul-en',
    name: 'Opus-MT Many→English',
    model: 'Helsinki-NLP/opus-mt-mul-en',
    pipelineType: 'translation',
    size: '300MB',
    languages: 'many→en',
    expectedLatency: '50-200ms',
    quality: 'High',
    notes: 'Faster but may have tokenizer issues',
  },
  {
    id: 'mt5-small',
    name: 'mT5 Small',
    model: 'google/mt5-small',
    pipelineType: 'text2text-generation',
    size: '300MB',
    languages: '101',
    expectedLatency: '100-300ms',
    quality: 'Medium-High',
    notes: 'Requires translate prompt prefix',
  },
  {
    id: 't5-small',
    name: 'T5 Small',
    model: 'Xenova/t5-small',
    pipelineType: 'text2text-generation',
    size: '250MB',
    languages: 'EN-XX',
    expectedLatency: '80-150ms',
    quality: 'Medium',
    notes: 'Fast, English-centric',
  },
];

// =============================================================================
// TEST QUERIES (Comprehensive multilingual set)
// =============================================================================

const TEST_QUERIES = [
  // Serbian Cyrillic
  { query: 'аутентификација', expected: 'authentication', lang: 'sr', nllbCode: 'srp_Cyrl' },
  { query: 'корисник', expected: 'user', lang: 'sr', nllbCode: 'srp_Cyrl' },
  { query: 'запослени', expected: 'employee', lang: 'sr', nllbCode: 'srp_Cyrl' },
  { query: 'пројекат', expected: 'project', lang: 'sr', nllbCode: 'srp_Cyrl' },

  // Russian
  { query: 'пользователь', expected: 'user', lang: 'ru', nllbCode: 'rus_Cyrl' },
  { query: 'авторизация', expected: 'authorization', lang: 'ru', nllbCode: 'rus_Cyrl' },

  // German
  { query: 'Größe', expected: 'size', lang: 'de', nllbCode: 'deu_Latn' },
  { query: 'Mitarbeiter', expected: 'employee', lang: 'de', nllbCode: 'deu_Latn' },
  { query: 'Benutzer', expected: 'user', lang: 'de', nllbCode: 'deu_Latn' },

  // French
  { query: 'utilisateur', expected: 'user', lang: 'fr', nllbCode: 'fra_Latn' },
  { query: 'authentification', expected: 'authentication', lang: 'fr', nllbCode: 'fra_Latn' },

  // Spanish
  { query: 'usuario', expected: 'user', lang: 'es', nllbCode: 'spa_Latn' },
  { query: 'autenticación', expected: 'authentication', lang: 'es', nllbCode: 'spa_Latn' },

  // Japanese
  { query: '認証', expected: 'authentication', lang: 'ja', nllbCode: 'jpn_Jpan' },
  { query: 'ユーザー', expected: 'user', lang: 'ja', nllbCode: 'jpn_Jpan' },

  // Chinese
  { query: '用户', expected: 'user', lang: 'zh', nllbCode: 'zho_Hans' },
  { query: '认证', expected: 'authentication', lang: 'zh', nllbCode: 'zho_Hans' },

  // Korean
  { query: '사용자', expected: 'user', lang: 'ko', nllbCode: 'kor_Hang' },
  { query: '인증', expected: 'authentication', lang: 'ko', nllbCode: 'kor_Hang' },
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
  const t = translation.toLowerCase().replace(/[^a-z]/g, '');
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
// CLOUD MODEL BENCHMARK
// =============================================================================

async function benchmarkCloudModel(modelConfig, queries) {
  if (!modelConfig.apiKey) {
    return {
      id: modelConfig.id,
      provider: modelConfig.provider,
      model: modelConfig.model,
      skipped: true,
      reason: `Missing API key for ${modelConfig.provider}`,
    };
  }

  console.log(`  Testing ${modelConfig.id}...`);

  const results = [];
  let successCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const { query, expected, lang } of queries) {
    const start = performance.now();

    try {
      const url = `${modelConfig.baseUrl}${modelConfig.endpoint}`;
      const prompt = `Translate to English (preserve code identifiers): "${query}"\n\nTranslation:`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelConfig.apiKey}`,
        ...(modelConfig.extraHeaders || {}),
      };

      const messages = [];

      // For models that output <think> tags, add system message to disable reasoning
      if (modelConfig.disableReasoning) {
        messages.push({
          role: 'system',
          content: 'You are a translator. Output ONLY the English translation. No explanations, no thinking, no alternatives. Just the single word or phrase translation.'
        });
      }

      messages.push({ role: 'user', content: prompt });

      const requestBody = {
        model: modelConfig.model,
        messages,
        max_tokens: 100,
        temperature: 0.1,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const rawTranslation = data.choices?.[0]?.message?.content?.trim() || '';
      const translation = cleanTranslationOutput(rawTranslation, query);
      const latency = Math.round(performance.now() - start);

      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      const acceptable = isAcceptable(translation, expected, query);
      if (acceptable) successCount++;

      results.push({
        query,
        expected,
        translation,
        acceptable,
        latency_ms: latency,
        inputTokens,
        outputTokens,
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
        error: err.message.slice(0, 100),
        lang,
      });
    }
  }

  const latencies = results.filter(r => !r.error).map(r => r.latency_ms);
  const inputCost = totalInputTokens * modelConfig.inputPrice / 1000000;
  const outputCost = totalOutputTokens * modelConfig.outputPrice / 1000000;

  return {
    id: modelConfig.id,
    provider: modelConfig.provider,
    model: modelConfig.model,
    skipped: false,
    total: queries.length,
    success: successCount,
    accuracy: (successCount / queries.length * 100).toFixed(1),
    avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    p50Latency: percentile(latencies, 50),
    p95Latency: percentile(latencies, 95),
    minLatency: latencies.length ? Math.min(...latencies) : 0,
    maxLatency: latencies.length ? Math.max(...latencies) : 0,
    failures: results.filter(r => r.error).length,
    totalInputTokens,
    totalOutputTokens,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    costPer1000Queries: (inputCost + outputCost) * (1000 / queries.length),
    pricing: {
      input: modelConfig.inputPrice,
      output: modelConfig.outputPrice,
    },
    speed: modelConfig.speed,
    multilingual: modelConfig.multilingual,
    notes: modelConfig.notes,
    results,
  };
}

// =============================================================================
// LOCAL MODEL BENCHMARK
// =============================================================================

async function benchmarkLocalModel(modelConfig, queries) {
  console.log(`  Testing ${modelConfig.id}...`);

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

    let translator;
    try {
      translator = await pipeline(modelConfig.pipelineType, modelConfig.model, {
        device: 'cpu',
        dtype: 'q8',
      });
    } catch (loadErr) {
      return {
        id: modelConfig.id,
        name: modelConfig.name,
        model: modelConfig.model,
        skipped: false,
        error: `Failed to load: ${loadErr.message.slice(0, 100)}`,
        size: modelConfig.size,
        notes: modelConfig.notes,
      };
    }

    const initLatency = Math.round(performance.now() - initStart);
    console.log(`    Model loaded in ${initLatency}ms`);

    const results = [];
    let successCount = 0;

    for (const { query, expected, lang, nllbCode } of queries) {
      const start = performance.now();

      try {
        let output;

        if (modelConfig.pipelineType === 'translation') {
          // NLLB / Opus-MT style
          output = await translator(query, {
            src_lang: nllbCode || 'eng_Latn',
            tgt_lang: 'eng_Latn',
          });
        } else {
          // T5 / mT5 style (text2text-generation)
          const prompt = `translate to English: ${query}`;
          output = await translator(prompt, {
            max_length: 100,
          });
        }

        const translation = output[0]?.translation_text || output[0]?.generated_text || query;
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
          error: err.message.slice(0, 100),
          lang,
        });
      }
    }

    const latencies = results.filter(r => !r.error).map(r => r.latency_ms);

    return {
      id: modelConfig.id,
      name: modelConfig.name,
      model: modelConfig.model,
      skipped: false,
      initLatency,
      total: queries.length,
      success: successCount,
      accuracy: (successCount / queries.length * 100).toFixed(1),
      avgLatency: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50Latency: percentile(latencies, 50),
      p95Latency: percentile(latencies, 95),
      minLatency: latencies.length ? Math.min(...latencies) : 0,
      maxLatency: latencies.length ? Math.max(...latencies) : 0,
      failures: results.filter(r => r.error).length,
      totalCost: 0,
      costPer1000Queries: 0,
      size: modelConfig.size,
      languages: modelConfig.languages,
      quality: modelConfig.quality,
      notes: modelConfig.notes,
      results,
    };
  } catch (err) {
    return {
      id: modelConfig.id,
      name: modelConfig.name,
      model: modelConfig.model,
      skipped: false,
      error: `Benchmark failed: ${err.message.slice(0, 100)}`,
      size: modelConfig.size,
      notes: modelConfig.notes,
    };
  }
}

// =============================================================================
// GENERATE MARKDOWN REPORT
// =============================================================================

function generateMarkdownReport(cloudResults, localResults, timestamp) {
  const lines = [];

  lines.push('# Translation Models Benchmark Results');
  lines.push('');
  lines.push(`**Generated:** ${timestamp}`);
  lines.push(`**Test Queries:** ${TEST_QUERIES.length} queries across 9 languages`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');

  const allResults = [
    ...cloudResults.filter(r => !r.skipped && !r.error),
    ...localResults.filter(r => !r.skipped && !r.error),
  ].sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy));

  if (allResults.length > 0) {
    const best = allResults[0];
    const cheapest = [...allResults].sort((a, b) => a.costPer1000Queries - b.costPer1000Queries)[0];
    const fastest = [...allResults].sort((a, b) => a.avgLatency - b.avgLatency)[0];

    lines.push(`- **Best Accuracy:** ${best.id} (${best.accuracy}%)`);
    lines.push(`- **Lowest Cost:** ${cheapest.id} ($${cheapest.costPer1000Queries.toFixed(4)}/1000 queries)`);
    lines.push(`- **Fastest:** ${fastest.id} (${fastest.avgLatency}ms avg)`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // Cloud Models Table
  lines.push('## Cloud Translation Models');
  lines.push('');
  lines.push('| Model ID | Provider | Accuracy | Avg Latency | P95 Latency | Cost/1K Queries | Input $/M | Output $/M | Notes |');
  lines.push('|----------|----------|----------|-------------|-------------|-----------------|-----------|------------|-------|');

  for (const r of cloudResults) {
    if (r.skipped) {
      lines.push(`| ${r.id} | ${r.provider} | SKIPPED | - | - | - | - | - | ${r.reason} |`);
    } else if (r.error) {
      lines.push(`| ${r.id} | ${r.provider} | ERROR | - | - | - | - | - | ${r.error.slice(0, 50)} |`);
    } else {
      lines.push(`| ${r.id} | ${r.provider} | ${r.accuracy}% | ${r.avgLatency}ms | ${r.p95Latency}ms | $${r.costPer1000Queries.toFixed(4)} | $${r.pricing.input.toFixed(2)} | $${r.pricing.output.toFixed(2)} | ${r.notes} |`);
    }
  }

  lines.push('');
  lines.push('### Cloud Model Details');
  lines.push('');

  for (const r of cloudResults.filter(r => !r.skipped && !r.error)) {
    lines.push(`#### ${r.id}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Provider | ${r.provider} |`);
    lines.push(`| Model | \`${r.model}\` |`);
    lines.push(`| Accuracy | ${r.accuracy}% (${r.success}/${r.total}) |`);
    lines.push(`| Avg Latency | ${r.avgLatency}ms |`);
    lines.push(`| P50 Latency | ${r.p50Latency}ms |`);
    lines.push(`| P95 Latency | ${r.p95Latency}ms |`);
    lines.push(`| Min/Max Latency | ${r.minLatency}ms / ${r.maxLatency}ms |`);
    lines.push(`| Failures | ${r.failures} |`);
    lines.push(`| Input Tokens | ${r.totalInputTokens} |`);
    lines.push(`| Output Tokens | ${r.totalOutputTokens} |`);
    lines.push(`| Total Cost | $${r.totalCost.toFixed(6)} |`);
    lines.push(`| Cost per 1000 Queries | $${r.costPer1000Queries.toFixed(4)} |`);
    lines.push(`| Speed | ${r.speed} |`);
    lines.push(`| Multilingual | ${r.multilingual} |`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Local Models Table
  lines.push('## Local Translation Models');
  lines.push('');
  lines.push('| Model ID | Name | Accuracy | Avg Latency | P95 Latency | Init Time | Size | Languages | Quality |');
  lines.push('|----------|------|----------|-------------|-------------|-----------|------|-----------|---------|');

  for (const r of localResults) {
    if (r.skipped) {
      lines.push(`| ${r.id} | ${r.name || '-'} | SKIPPED | - | - | - | ${r.size || '-'} | - | - |`);
    } else if (r.error) {
      lines.push(`| ${r.id} | ${r.name || '-'} | ERROR | - | - | - | ${r.size || '-'} | - | ${r.error.slice(0, 30)} |`);
    } else {
      lines.push(`| ${r.id} | ${r.name} | ${r.accuracy}% | ${r.avgLatency}ms | ${r.p95Latency}ms | ${r.initLatency}ms | ${r.size} | ${r.languages} | ${r.quality} |`);
    }
  }

  lines.push('');
  lines.push('### Local Model Details');
  lines.push('');

  for (const r of localResults.filter(r => !r.skipped && !r.error)) {
    lines.push(`#### ${r.id}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Name | ${r.name} |`);
    lines.push(`| Model | \`${r.model}\` |`);
    lines.push(`| Accuracy | ${r.accuracy}% (${r.success}/${r.total}) |`);
    lines.push(`| Avg Latency | ${r.avgLatency}ms |`);
    lines.push(`| P50 Latency | ${r.p50Latency}ms |`);
    lines.push(`| P95 Latency | ${r.p95Latency}ms |`);
    lines.push(`| Min/Max Latency | ${r.minLatency}ms / ${r.maxLatency}ms |`);
    lines.push(`| Init Time | ${r.initLatency}ms |`);
    lines.push(`| Failures | ${r.failures} |`);
    lines.push(`| Size | ${r.size} |`);
    lines.push(`| Languages | ${r.languages} |`);
    lines.push(`| Quality | ${r.quality} |`);
    lines.push(`| Cost | FREE |`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Comparison Matrix
  lines.push('## Comparison Matrix');
  lines.push('');
  lines.push('| Rank | Model | Type | Accuracy | Latency | Cost/1K | Best For |');
  lines.push('|------|-------|------|----------|---------|---------|----------|');

  const ranked = allResults.map((r, i) => ({
    rank: i + 1,
    id: r.id,
    type: r.provider ? 'Cloud' : 'Local',
    accuracy: r.accuracy,
    latency: r.avgLatency,
    cost: r.costPer1000Queries,
    bestFor: getBestFor(r),
  }));

  for (const r of ranked) {
    lines.push(`| ${r.rank} | ${r.id} | ${r.type} | ${r.accuracy}% | ${r.latency}ms | $${r.cost.toFixed(4)} | ${r.bestFor} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');

  const cloudBest = cloudResults.filter(r => !r.skipped && !r.error).sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))[0];
  const localBest = localResults.filter(r => !r.skipped && !r.error).sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))[0];
  const cheapestCloud = cloudResults.filter(r => !r.skipped && !r.error).sort((a, b) => a.costPer1000Queries - b.costPer1000Queries)[0];

  lines.push('### Primary Recommendation');
  lines.push('');
  if (cloudBest) {
    lines.push(`**Cloud Provider:** ${cloudBest.id}`);
    lines.push(`- Accuracy: ${cloudBest.accuracy}%`);
    lines.push(`- Latency: ${cloudBest.avgLatency}ms avg`);
    lines.push(`- Cost: $${cloudBest.costPer1000Queries.toFixed(4)}/1000 queries`);
  }
  lines.push('');

  if (localBest) {
    lines.push(`**Local Fallback:** ${localBest.id}`);
    lines.push(`- Accuracy: ${localBest.accuracy}%`);
    lines.push(`- Latency: ${localBest.avgLatency}ms avg`);
    lines.push(`- Cost: FREE`);
  }
  lines.push('');

  lines.push('### Cost-Optimized Configuration');
  lines.push('');
  if (cheapestCloud && cheapestCloud !== cloudBest) {
    lines.push(`For budget-conscious deployments, consider **${cheapestCloud.id}**:`);
    lines.push(`- ${((1 - cheapestCloud.costPer1000Queries / cloudBest.costPer1000Queries) * 100).toFixed(0)}% cheaper than best accuracy option`);
    lines.push(`- Accuracy: ${cheapestCloud.accuracy}%`);
  } else if (localBest) {
    lines.push(`Use **${localBest.id}** for zero-cost translation with ${localBest.accuracy}% accuracy.`);
  }
  lines.push('');

  lines.push('### Configuration Priority Order');
  lines.push('');
  lines.push('```');
  lines.push('1. Cloud (when available): ' + (cloudBest?.id || 'none'));
  lines.push('2. Local fallback: ' + (localBest?.id || 'nllb-200-distilled-600M'));
  lines.push('3. Passthrough (no translation)');
  lines.push('```');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## Test Queries');
  lines.push('');
  lines.push('| Language | Query | Expected |');
  lines.push('|----------|-------|----------|');
  for (const q of TEST_QUERIES) {
    lines.push(`| ${q.lang} | ${q.query} | ${q.expected} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('*Generated by benchmark-all-models.js*');

  return lines.join('\n');
}

function getBestFor(result) {
  const accuracy = parseFloat(result.accuracy);
  const latency = result.avgLatency;
  const cost = result.costPer1000Queries;

  if (accuracy >= 90 && cost === 0) return 'Offline, high quality';
  if (accuracy >= 90 && latency < 400) return 'Speed + accuracy';
  if (accuracy >= 90) return 'Best accuracy';
  if (cost === 0) return 'Zero cost';
  if (latency < 300) return 'Lowest latency';
  if (cost < 0.01) return 'Budget option';
  return 'General use';
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('COMPREHENSIVE TRANSLATION MODELS BENCHMARK');
  console.log('='.repeat(70));
  console.log('');
  console.log('API Key Status:');
  console.log(`  CEREBRAS_API_KEY: ${maskKey(CEREBRAS_API_KEY)}`);
  console.log(`  GROQ_API_KEY: ${maskKey(GROQ_API_KEY)}`);
  console.log(`  OPENROUTER_API_KEY: ${maskKey(OPENROUTER_API_KEY)}`);
  console.log('');
  console.log(`Test Queries: ${TEST_QUERIES.length}`);
  console.log('');

  const timestamp = new Date().toISOString();
  const cloudResults = [];
  const localResults = [];

  // Benchmark cloud models
  console.log('='.repeat(70));
  console.log('CLOUD MODELS');
  console.log('='.repeat(70));

  for (const model of CLOUD_MODELS) {
    const result = await benchmarkCloudModel(model, TEST_QUERIES);
    cloudResults.push(result);

    if (result.skipped) {
      console.log(`  [SKIP] ${result.id}: ${result.reason}`);
    } else if (result.error) {
      console.log(`  [ERROR] ${result.id}: ${result.error}`);
    } else {
      console.log(`  [DONE] ${result.id}: ${result.accuracy}% accuracy, ${result.avgLatency}ms avg, $${result.costPer1000Queries.toFixed(4)}/1K`);
    }
  }

  // Benchmark local models
  console.log('');
  console.log('='.repeat(70));
  console.log('LOCAL MODELS');
  console.log('='.repeat(70));

  for (const model of LOCAL_MODELS) {
    const result = await benchmarkLocalModel(model, TEST_QUERIES);
    localResults.push(result);

    if (result.skipped) {
      console.log(`  [SKIP] ${result.id}: ${result.reason || 'skipped'}`);
    } else if (result.error) {
      console.log(`  [ERROR] ${result.id}: ${result.error}`);
    } else {
      console.log(`  [DONE] ${result.id}: ${result.accuracy}% accuracy, ${result.avgLatency}ms avg, init ${result.initLatency}ms`);
    }
  }

  // Save JSON results
  const outputDir = path.join(PROJECT_ROOT, '.sweet-search', 'translation-benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonFile = path.join(outputDir, `all-models-benchmark-${Date.now()}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify({
    timestamp,
    testQueries: TEST_QUERIES.length,
    cloudModels: cloudResults,
    localModels: localResults,
  }, null, 2));
  console.log('');
  console.log(`JSON saved: ${jsonFile}`);

  // Generate and save markdown report
  const markdown = generateMarkdownReport(cloudResults, localResults, timestamp);
  const mdFile = path.join(SEARCH_100X_ROOT, 'MODELS_BENCHMARK.md');
  fs.writeFileSync(mdFile, markdown);
  console.log(`Markdown saved: ${mdFile}`);

  // Print summary table
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log('Model'.padEnd(30) + 'Accuracy'.padEnd(10) + 'Latency'.padEnd(12) + 'Cost/1K');
  console.log('-'.repeat(60));

  const allResults = [...cloudResults, ...localResults]
    .filter(r => !r.skipped && !r.error)
    .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy));

  for (const r of allResults) {
    console.log(
      r.id.slice(0, 29).padEnd(30) +
      `${r.accuracy}%`.padEnd(10) +
      `${r.avgLatency}ms`.padEnd(12) +
      `$${r.costPer1000Queries.toFixed(4)}`
    );
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('BENCHMARK COMPLETE');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
