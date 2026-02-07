#!/usr/bin/env node
/**
 * Cerebras vs Transformers.js Translation Benchmark
 *
 * Head-to-head comparison of cloud (Cerebras) vs local (Transformers.js NLLB-200)
 * for translation accuracy and speed.
 *
 * Usage:
 *   node benchmark-cerebras-vs-local.js              # Full benchmark
 *   node benchmark-cerebras-vs-local.js --quick      # Quick benchmark (fewer queries)
 *   node benchmark-cerebras-vs-local.js --cerebras   # Cerebras only
 *   node benchmark-cerebras-vs-local.js --local      # Local only
 */

import { performance } from 'perf_hooks';

// Benchmark queries with expected English translations
// These cover different languages and complexity levels
const BENCHMARK_QUERIES = [
  // Serbian (Cyrillic)
  { id: 'SR-001', lang: 'sr', query: 'аутентификација', expected: ['authentication', 'auth'], desc: 'Common term' },
  { id: 'SR-002', lang: 'sr', query: 'корисник', expected: ['user', 'customer'], desc: 'Basic noun' },
  { id: 'SR-003', lang: 'sr', query: 'запослени', expected: ['employee', 'worker', 'staff'], desc: 'Domain term' },
  { id: 'SR-004', lang: 'sr', query: 'сервис за пријаву', expected: ['login service', 'sign in', 'authentication'], desc: 'Phrase' },
  { id: 'SR-005', lang: 'sr', query: 'управљање сесијама', expected: ['session management', 'session handling'], desc: 'Technical phrase' },

  // Russian (Cyrillic)
  { id: 'RU-001', lang: 'ru', query: 'пользователь', expected: ['user'], desc: 'Basic noun' },
  { id: 'RU-002', lang: 'ru', query: 'авторизация', expected: ['authorization', 'auth'], desc: 'Technical term' },
  { id: 'RU-003', lang: 'ru', query: 'сотрудник', expected: ['employee', 'worker', 'staff'], desc: 'Domain term' },
  { id: 'RU-004', lang: 'ru', query: 'обработка ошибок', expected: ['error handling', 'error processing'], desc: 'Technical phrase' },
  { id: 'RU-005', lang: 'ru', query: 'база данных', expected: ['database', 'data base'], desc: 'Technical term' },

  // Chinese (Simplified)
  { id: 'ZH-001', lang: 'zh', query: '认证', expected: ['authentication', 'certification', 'auth'], desc: 'Technical term' },
  { id: 'ZH-002', lang: 'zh', query: '用户', expected: ['user'], desc: 'Basic noun' },
  { id: 'ZH-003', lang: 'zh', query: '登录服务', expected: ['login service', 'sign in'], desc: 'Technical phrase' },
  { id: 'ZH-004', lang: 'zh', query: '会话管理', expected: ['session management'], desc: 'Technical phrase' },
  { id: 'ZH-005', lang: 'zh', query: '员工信息', expected: ['employee information', 'staff info'], desc: 'Domain phrase' },

  // Japanese
  { id: 'JA-001', lang: 'ja', query: '認証', expected: ['authentication', 'certification', 'auth'], desc: 'Technical term' },
  { id: 'JA-002', lang: 'ja', query: 'ユーザー', expected: ['user'], desc: 'Loanword' },
  { id: 'JA-003', lang: 'ja', query: 'ログインサービス', expected: ['login service'], desc: 'Technical phrase' },
  { id: 'JA-004', lang: 'ja', query: 'セッション管理', expected: ['session management'], desc: 'Mixed phrase' },
  { id: 'JA-005', lang: 'ja', query: '認証の仕組み', expected: ['authentication mechanism', 'how auth works', 'authentication system'], desc: 'Conceptual' },

  // Korean
  { id: 'KO-001', lang: 'ko', query: '인증', expected: ['authentication', 'certification', 'auth'], desc: 'Technical term' },
  { id: 'KO-002', lang: 'ko', query: '사용자', expected: ['user'], desc: 'Basic noun' },
  { id: 'KO-003', lang: 'ko', query: '로그인 서비스', expected: ['login service'], desc: 'Technical phrase' },

  // German
  { id: 'DE-001', lang: 'de', query: 'Authentifizierung', expected: ['authentication'], desc: 'Technical term' },
  { id: 'DE-002', lang: 'de', query: 'Benutzer', expected: ['user'], desc: 'Basic noun' },
  { id: 'DE-003', lang: 'de', query: 'Mitarbeiter', expected: ['employee', 'staff', 'worker'], desc: 'Domain term' },
  { id: 'DE-004', lang: 'de', query: 'Fehlerbehandlung', expected: ['error handling'], desc: 'Technical term' },

  // Spanish
  { id: 'ES-001', lang: 'es', query: 'autenticación', expected: ['authentication'], desc: 'Technical term' },
  { id: 'ES-002', lang: 'es', query: 'usuario', expected: ['user'], desc: 'Basic noun' },
  { id: 'ES-003', lang: 'es', query: 'empleado', expected: ['employee'], desc: 'Domain term' },

  // French
  { id: 'FR-001', lang: 'fr', query: 'authentification', expected: ['authentication'], desc: 'Technical term' },
  { id: 'FR-002', lang: 'fr', query: 'utilisateur', expected: ['user'], desc: 'Basic noun' },

  // Mixed/Code-switching (these are harder)
  { id: 'MX-001', lang: 'sr-en', query: 'АутСервис конфигурација', expected: ['authservice', 'auth service', 'configuration'], desc: 'Mixed SR-EN' },
  { id: 'MX-002', lang: 'zh-en', query: '用户Service', expected: ['user service', 'userservice'], desc: 'Mixed ZH-EN' },
  { id: 'MX-003', lang: 'ja-en', query: '認証Controller', expected: ['auth controller', 'authentication controller'], desc: 'Mixed JA-EN' },
];

const QUICK_QUERIES = BENCHMARK_QUERIES.filter(q =>
  ['SR-001', 'RU-001', 'ZH-001', 'JA-001', 'KO-001', 'DE-001', 'MX-001'].includes(q.id)
);

// =============================================================================
// TRANSLATION PROVIDERS
// =============================================================================

/**
 * Translate using Cerebras API
 */
async function translateWithCerebras(query) {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    throw new Error('CEREBRAS_API_KEY not set');
  }

  const prompt = `Translate to English (preserve code identifiers): "${query}"\n\nTranslation:`;
  const start = performance.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama3.1-8b',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cerebras API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const translation = data.choices?.[0]?.message?.content?.trim() || query;
    const latency = performance.now() - start;

    return {
      translation: cleanTranslation(translation),
      latency_ms: Math.round(latency),
      provider: 'cerebras',
      tokens: data.usage?.total_tokens || 0,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Translate using Transformers.js NLLB-200 (local)
 */
let transformersInstance = null;

async function translateWithTransformers(query) {
  if (!transformersInstance) {
    const { getTransformersTranslator } = await import('../translation/transformers-translator.js');
    transformersInstance = getTransformersTranslator();
  }

  const start = performance.now();
  const result = await transformersInstance.translate(query);
  const latency = performance.now() - start;

  return {
    translation: result.translation,
    latency_ms: Math.round(latency),
    provider: 'transformers.js',
    srcLang: result.srcLang,
    skipped: result.skipped,
  };
}

/**
 * Clean LLM output (remove quotes, extra text)
 */
function cleanTranslation(text) {
  if (!text) return '';
  // Remove surrounding quotes
  let cleaned = text.replace(/^["']|["']$/g, '');
  // Take only first line if multiple
  cleaned = cleaned.split('\n')[0].trim();
  // Remove common LLM prefixes
  cleaned = cleaned.replace(/^(Translation:|Here'?s? the translation:|The translation is:?)\s*/i, '');
  return cleaned;
}

/**
 * Check if translation matches any expected value
 */
function matchesExpected(translation, expected) {
  const lower = translation.toLowerCase();
  return expected.some(exp => lower.includes(exp.toLowerCase()));
}

// =============================================================================
// BENCHMARK RUNNER
// =============================================================================

async function runBenchmark(options = {}) {
  const { cerebrasOnly = false, localOnly = false, quick = false } = options;

  const queries = quick ? QUICK_QUERIES : BENCHMARK_QUERIES;

  console.log('\n' + '═'.repeat(80));
  console.log(' 🔬 CEREBRAS vs TRANSFORMERS.JS TRANSLATION BENCHMARK');
  console.log('═'.repeat(80));
  console.log(`\n📋 Queries: ${queries.length} | Mode: ${cerebrasOnly ? 'Cerebras only' : localOnly ? 'Local only' : 'Head-to-head'}\n`);

  const results = {
    cerebras: { translations: [], latencies: [], correct: 0, errors: 0 },
    transformers: { translations: [], latencies: [], correct: 0, errors: 0, initTime: 0 },
  };

  // Warm up Transformers.js if needed (one-time init)
  if (!cerebrasOnly) {
    console.log('⏳ Warming up Transformers.js (one-time model load)...');
    const warmStart = performance.now();
    try {
      await translateWithTransformers('test');
      results.transformers.initTime = Math.round(performance.now() - warmStart);
      console.log(`✅ Transformers.js ready (init: ${results.transformers.initTime}ms)\n`);
    } catch (err) {
      console.log(`❌ Transformers.js init failed: ${err.message}\n`);
    }
  }

  // Header
  console.log('┌' + '─'.repeat(8) + '┬' + '─'.repeat(6) + '┬' + '─'.repeat(25) + '┬' + '─'.repeat(25) + '┬' + '─'.repeat(10) + '┐');
  console.log('│ ' + 'ID'.padEnd(6) + ' │ ' + 'Lang'.padEnd(4) + ' │ ' + 'Query'.padEnd(23) + ' │ ' + 'Translation'.padEnd(23) + ' │ ' + 'Latency'.padEnd(8) + ' │');
  console.log('├' + '─'.repeat(8) + '┼' + '─'.repeat(6) + '┼' + '─'.repeat(25) + '┼' + '─'.repeat(25) + '┼' + '─'.repeat(10) + '┤');

  for (const q of queries) {
    const queryTrunc = q.query.length > 21 ? q.query.slice(0, 18) + '...' : q.query.padEnd(21);

    // Test Cerebras
    if (!localOnly) {
      try {
        const result = await translateWithCerebras(q.query);
        results.cerebras.translations.push({ ...q, result });
        results.cerebras.latencies.push(result.latency_ms);
        if (matchesExpected(result.translation, q.expected)) {
          results.cerebras.correct++;
        }

        const transTrunc = result.translation.length > 21 ? result.translation.slice(0, 18) + '...' : result.translation.padEnd(21);
        const status = matchesExpected(result.translation, q.expected) ? '✅' : '❌';
        console.log(`│ ${q.id.padEnd(6)} │ ${q.lang.padEnd(4)} │ ${queryTrunc} │ ${transTrunc} │ ${String(result.latency_ms).padStart(5)}ms ${status} │ [C]`);
      } catch (err) {
        results.cerebras.errors++;
        console.log(`│ ${q.id.padEnd(6)} │ ${q.lang.padEnd(4)} │ ${queryTrunc} │ ${'ERROR: ' + err.message.slice(0, 14)} │ ${'-'.padStart(8)} │ [C]`);
      }
    }

    // Test Transformers.js
    if (!cerebrasOnly) {
      try {
        const result = await translateWithTransformers(q.query);
        results.transformers.translations.push({ ...q, result });

        if (!result.skipped) {
          results.transformers.latencies.push(result.latency_ms);
          if (matchesExpected(result.translation, q.expected)) {
            results.transformers.correct++;
          }

          const transTrunc = result.translation.length > 21 ? result.translation.slice(0, 18) + '...' : result.translation.padEnd(21);
          const status = matchesExpected(result.translation, q.expected) ? '✅' : '❌';
          console.log(`│ ${q.id.padEnd(6)} │ ${q.lang.padEnd(4)} │ ${queryTrunc} │ ${transTrunc} │ ${String(result.latency_ms).padStart(5)}ms ${status} │ [T]`);
        } else {
          console.log(`│ ${q.id.padEnd(6)} │ ${q.lang.padEnd(4)} │ ${queryTrunc} │ ${'(skipped - English)'.padEnd(21)} │ ${'-'.padStart(8)} │ [T]`);
        }
      } catch (err) {
        results.transformers.errors++;
        console.log(`│ ${q.id.padEnd(6)} │ ${q.lang.padEnd(4)} │ ${queryTrunc} │ ${'ERROR: ' + err.message.slice(0, 14)} │ ${'-'.padStart(8)} │ [T]`);
      }
    }
  }

  console.log('└' + '─'.repeat(8) + '┴' + '─'.repeat(6) + '┴' + '─'.repeat(25) + '┴' + '─'.repeat(25) + '┴' + '─'.repeat(10) + '┘');
  console.log('\n[C] = Cerebras (cloud)  |  [T] = Transformers.js (local)\n');

  // ==========================================================================
  // SUMMARY
  // ==========================================================================

  console.log('═'.repeat(80));
  console.log(' 📊 BENCHMARK RESULTS');
  console.log('═'.repeat(80) + '\n');

  const printStats = (name, stats, total) => {
    if (stats.latencies.length === 0) return;

    const accuracy = ((stats.correct / total) * 100).toFixed(1);
    const avgLatency = (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(0);
    const minLatency = Math.min(...stats.latencies);
    const maxLatency = Math.max(...stats.latencies);
    const p50 = stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length / 2)];
    const p95 = stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)];

    console.log(`📦 ${name}:`);
    console.log(`   Accuracy:  ${stats.correct}/${total} (${accuracy}%)`);
    console.log(`   Latency:   avg=${avgLatency}ms | min=${minLatency}ms | max=${maxLatency}ms | p50=${p50}ms | p95=${p95}ms`);
    if (stats.errors > 0) console.log(`   Errors:    ${stats.errors}`);
    if (stats.initTime) console.log(`   Init time: ${stats.initTime}ms (one-time)`);
    console.log('');
  };

  const total = queries.length;

  if (!localOnly) printStats('Cerebras (cloud LLM)', results.cerebras, total);
  if (!cerebrasOnly) printStats('Transformers.js (local NLLB-200)', results.transformers, total);

  // Comparison
  if (!localOnly && !cerebrasOnly && results.cerebras.latencies.length > 0 && results.transformers.latencies.length > 0) {
    console.log('─'.repeat(80));
    console.log(' 🏆 HEAD-TO-HEAD COMPARISON');
    console.log('─'.repeat(80) + '\n');

    const cAvg = results.cerebras.latencies.reduce((a, b) => a + b, 0) / results.cerebras.latencies.length;
    const tAvg = results.transformers.latencies.reduce((a, b) => a + b, 0) / results.transformers.latencies.length;
    const speedRatio = (cAvg / tAvg).toFixed(2);
    const accuracyDiff = results.cerebras.correct - results.transformers.correct;

    console.log(`   Speed:    Transformers.js is ${speedRatio}x ${cAvg > tAvg ? 'FASTER' : 'SLOWER'} than Cerebras`);
    console.log(`             Cerebras avg: ${cAvg.toFixed(0)}ms | Transformers avg: ${tAvg.toFixed(0)}ms`);
    console.log('');
    console.log(`   Accuracy: ${accuracyDiff === 0 ? 'TIED' : accuracyDiff > 0 ? `Cerebras wins by ${accuracyDiff}` : `Transformers.js wins by ${-accuracyDiff}`}`);
    console.log(`             Cerebras: ${results.cerebras.correct}/${total} | Transformers: ${results.transformers.correct}/${total}`);
    console.log('');

    // Recommendation
    console.log('─'.repeat(80));
    if (tAvg < cAvg && results.transformers.correct >= results.cerebras.correct - 2) {
      console.log(' ✅ RECOMMENDATION: Use Transformers.js (local) as primary');
      console.log('    - Faster with comparable or better accuracy');
      console.log('    - No API key required, works offline');
      console.log('    - One-time init cost amortized over queries');
    } else if (results.cerebras.correct > results.transformers.correct + 3) {
      console.log(' ✅ RECOMMENDATION: Keep Cerebras as primary');
      console.log('    - Significantly better accuracy justifies latency');
    } else {
      console.log(' ⚖️  RECOMMENDATION: Either option viable');
      console.log('    - Consider local-first for speed, Cerebras for accuracy');
    }
    console.log('─'.repeat(80));
  }

  console.log('\n' + '═'.repeat(80) + '\n');

  return results;
}

// =============================================================================
// DETAILED COMPARISON OUTPUT
// =============================================================================

async function printDetailedComparison(results) {
  if (results.cerebras.translations.length === 0 || results.transformers.translations.length === 0) {
    return;
  }

  console.log('\n' + '═'.repeat(80));
  console.log(' 🔍 DETAILED TRANSLATION COMPARISON');
  console.log('═'.repeat(80) + '\n');

  // Find disagreements
  const disagreements = [];
  for (const ct of results.cerebras.translations) {
    const tt = results.transformers.translations.find(t => t.id === ct.id);
    if (tt) {
      const cMatch = matchesExpected(ct.result.translation, ct.expected);
      const tMatch = matchesExpected(tt.result.translation, tt.expected);
      if (cMatch !== tMatch || ct.result.translation.toLowerCase() !== tt.result.translation.toLowerCase()) {
        disagreements.push({ id: ct.id, query: ct.query, expected: ct.expected, cerebras: ct.result, transformers: tt.result, cMatch, tMatch });
      }
    }
  }

  if (disagreements.length === 0) {
    console.log('✅ No significant disagreements between providers\n');
  } else {
    console.log(`⚠️  Found ${disagreements.length} disagreements:\n`);
    for (const d of disagreements) {
      console.log(`[${d.id}] Query: "${d.query}"`);
      console.log(`   Expected: ${d.expected.join(' | ')}`);
      console.log(`   Cerebras: "${d.cerebras.translation}" ${d.cMatch ? '✅' : '❌'}`);
      console.log(`   Transformers: "${d.transformers.translation}" ${d.tMatch ? '✅' : '❌'}`);
      console.log('');
    }
  }
}

// =============================================================================
// MAIN
// =============================================================================

const args = process.argv.slice(2);
const options = {
  cerebrasOnly: args.includes('--cerebras'),
  localOnly: args.includes('--local'),
  quick: args.includes('--quick'),
};

runBenchmark(options)
  .then(results => printDetailedComparison(results))
  .catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
