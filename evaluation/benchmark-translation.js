#!/usr/bin/env node
/**
 * Translation Fallback Benchmark
 *
 * Tests speed and accuracy of T1→T2→T3 translation pipeline
 */

import { createFallbackPipeline } from '../translation/fallback-pipeline.js';
import { SmartSearch } from '../core/smart-search-v21.js';

// Benchmark queries by tier
const BENCHMARK_QUERIES = [
  // T2: Identifier aliases (dictionary lookup preferred over transliteration)
  { tier: 'T2', lang: 'sr', query: 'КорисникСервис', expected: 'UserService', description: 'Serbian→UserService (T2 wins)' },
  { tier: 'T2', lang: 'sr', query: 'КонтролерЗапослених', expected: 'EmployeeController', description: 'Serbian→EmployeeController (T2 wins)' },
  { tier: 'T2', lang: 'ru', query: 'СервисПользователя', expected: 'UserService', description: 'Russian→UserService (T2 wins)' },

  // T2: Dictionary lookup (concept → English)
  { tier: 'T2', lang: 'sr', query: 'аутентификација', expected: 'authentication', description: 'Serbian concept' },
  { tier: 'T2', lang: 'sr', query: 'запослени', expected: 'employee', description: 'Serbian concept' },
  { tier: 'T2', lang: 'ru', query: 'пользователь', expected: 'user', description: 'Russian concept' },
  { tier: 'T2', lang: 'ru', query: 'сотрудник', expected: 'employee', description: 'Russian concept' },
  { tier: 'T2', lang: 'zh', query: '认证服务', expected: 'AuthService', description: 'Chinese identifier' },
  { tier: 'T2', lang: 'zh', query: '用户服务', expected: 'UserService', description: 'Chinese identifier' },
  { tier: 'T2', lang: 'ja', query: '認証サービス', expected: 'AuthService', description: 'Japanese identifier' },
  { tier: 'T2', lang: 'de', query: 'Mitarbeiter', expected: 'employee', description: 'German concept' },

  // T2 Identifier aliases
  { tier: 'T2', lang: 'sr', query: 'АутСервис', expected: 'AuthService', description: 'Serbian identifier alias' },
  { tier: 'T2', lang: 'sr', query: 'СервисАутентификације', expected: 'AuthService', description: 'Serbian identifier alias' },

  // T1: Pure transliteration (terms NOT in dictionary)
  { tier: 'T1', lang: 'sr', query: 'НепознатаРеч', expected: 'NepoznataRec', description: 'Serbian T1-only' },
  { tier: 'T1', lang: 'ru', query: 'НеизвестноеСлово', expected: 'Neizvestnoe', description: 'Russian T1-only' },

  // English (no translation needed)
  { tier: null, lang: 'en', query: 'AuthService', expected: 'AuthService', description: 'English unchanged' },
  { tier: null, lang: 'en', query: 'authentication', expected: 'authentication', description: 'English unchanged' },
];

async function runBenchmark() {
  console.log('\n' + '═'.repeat(70));
  console.log(' 🌍 TRANSLATION FALLBACK BENCHMARK');
  console.log('═'.repeat(70) + '\n');

  // Initialize pipeline
  const pipeline = createFallbackPipeline({ enableT3: false });
  await pipeline.init();

  const results = {
    T1: { total: 0, correct: 0, latencies: [] },
    T2: { total: 0, correct: 0, latencies: [] },
    T3: { total: 0, correct: 0, latencies: [] },
    unchanged: { total: 0, correct: 0, latencies: [] },
  };

  console.log('┌─────┬────────┬────────────────────────┬────────────────────────┬─────────┬─────────────┐');
  console.log('│ #   │ Lang   │ Query                  │ Translation            │ Latency │ Status      │');
  console.log('├─────┼────────┼────────────────────────┼────────────────────────┼─────────┼─────────────┤');

  for (let i = 0; i < BENCHMARK_QUERIES.length; i++) {
    const { tier, lang, query, expected, description } = BENCHMARK_QUERIES[i];

    const start = performance.now();
    const result = await pipeline.translate(query);
    const latency = performance.now() - start;

    const translation = result.bestTranslation || result.original;
    const actualTier = result.tier || 'unchanged';
    const tierKey = tier === null ? 'unchanged' : tier;

    // Check correctness (translation contains expected or equals expected)
    const isCorrect = translation.toLowerCase().includes(expected.toLowerCase()) ||
                      expected.toLowerCase().includes(translation.toLowerCase());

    results[tierKey].total++;
    if (isCorrect) results[tierKey].correct++;
    results[tierKey].latencies.push(latency);

    const status = isCorrect ? '✅ Pass' : `❌ Expected: ${expected}`;
    const queryTrunc = query.length > 20 ? query.slice(0, 17) + '...' : query.padEnd(20);
    const transTrunc = translation.length > 20 ? translation.slice(0, 17) + '...' : translation.padEnd(20);

    console.log(`│ ${String(i + 1).padStart(3)} │ ${lang.padEnd(6)} │ ${queryTrunc} │ ${transTrunc} │ ${latency.toFixed(2).padStart(5)}ms │ ${status.padEnd(11)} │`);
  }

  console.log('└─────┴────────┴────────────────────────┴────────────────────────┴─────────┴─────────────┘');

  // Summary
  console.log('\n' + '─'.repeat(70));
  console.log(' 📊 BENCHMARK SUMMARY');
  console.log('─'.repeat(70));

  for (const [tier, stats] of Object.entries(results)) {
    if (stats.total === 0) continue;

    const accuracy = ((stats.correct / stats.total) * 100).toFixed(1);
    const avgLatency = (stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(2);
    const minLatency = Math.min(...stats.latencies).toFixed(2);
    const maxLatency = Math.max(...stats.latencies).toFixed(2);

    console.log(`\n${tier === 'unchanged' ? '🔵 Unchanged' : `🟢 Tier ${tier}`}:`);
    console.log(`  Accuracy:  ${stats.correct}/${stats.total} (${accuracy}%)`);
    console.log(`  Latency:   avg ${avgLatency}ms | min ${minLatency}ms | max ${maxLatency}ms`);
  }

  // Overall
  const totalCorrect = Object.values(results).reduce((a, b) => a + b.correct, 0);
  const totalQueries = Object.values(results).reduce((a, b) => a + b.total, 0);
  const allLatencies = Object.values(results).flatMap(r => r.latencies);
  const avgOverall = (allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length).toFixed(2);

  console.log('\n' + '═'.repeat(70));
  console.log(` 🎯 OVERALL: ${totalCorrect}/${totalQueries} (${((totalCorrect / totalQueries) * 100).toFixed(1)}%) | Average Latency: ${avgOverall}ms`);
  console.log('═'.repeat(70) + '\n');

  return { results, totalCorrect, totalQueries };
}

// Run benchmark
runBenchmark().catch(console.error);
