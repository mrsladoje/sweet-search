#!/usr/bin/env node
/**
 * Micro-benchmark for shouldTriggerFallback overhead
 *
 * Measures the per-call overhead in the common case (good results).
 * Target: <10µs per call
 */

import { createFallbackPipeline } from '../translation/fallback-pipeline.js';

const ITERATIONS = 100000;
const WARMUP = 1000;

// Test cases
const goodResults = [
  { file: 'AuthService.java', score: 0.9, name: 'AuthService' },
  { file: 'AuthController.java', score: 0.85, name: 'AuthController' },
  { file: 'AuthConfig.java', score: 0.8, name: 'AuthConfig' },
];

const poorResults = [
  { file: 'unrelated.js', score: 0.1 },
];

const noResults = [];

const queries = {
  englishIdentifier: 'AuthService',
  englishPhrase: 'authentication service',
  germanAscii: 'Mitarbeiter',
  germanDiacritics: 'Größe',
  cyrillic: 'аутентификација',
  cjk: '認証サービス',
};

async function runBenchmark() {
  console.log('='.repeat(60));
  console.log('shouldTriggerFallback Overhead Benchmark');
  console.log('='.repeat(60));
  console.log(`Iterations: ${ITERATIONS.toLocaleString()}`);
  console.log(`Warmup: ${WARMUP.toLocaleString()}`);
  console.log('');

  const pipeline = createFallbackPipeline({ enableT3: false });
  await pipeline.init();

  const results = [];

  for (const [queryName, query] of Object.entries(queries)) {
    for (const [resultName, resultSet] of [
      ['goodResults', goodResults],
      ['poorResults', poorResults],
      ['noResults', noResults],
    ]) {
      // Warmup
      for (let i = 0; i < WARMUP; i++) {
        pipeline.shouldTriggerFallback(resultSet, query);
      }

      // Benchmark
      const start = process.hrtime.bigint();
      for (let i = 0; i < ITERATIONS; i++) {
        pipeline.shouldTriggerFallback(resultSet, query);
      }
      const end = process.hrtime.bigint();

      const totalNs = Number(end - start);
      const avgNs = totalNs / ITERATIONS;
      const avgUs = avgNs / 1000;

      const triggered = pipeline.shouldTriggerFallback(resultSet, query);

      results.push({
        queryName,
        resultName,
        avgNs: Math.round(avgNs),
        avgUs: avgUs.toFixed(2),
        triggered,
      });
    }
  }

  // Print results
  console.log('Results (per call):');
  console.log('-'.repeat(70));
  console.log(
    'Query'.padEnd(20),
    'Results'.padEnd(12),
    'Avg (ns)'.padStart(10),
    'Avg (µs)'.padStart(10),
    'Triggered'.padStart(10)
  );
  console.log('-'.repeat(70));

  for (const r of results) {
    console.log(
      r.queryName.padEnd(20),
      r.resultName.padEnd(12),
      String(r.avgNs).padStart(10),
      r.avgUs.padStart(10),
      String(r.triggered).padStart(10)
    );
  }

  // Summary
  console.log('');
  console.log('Summary:');
  console.log('-'.repeat(70));

  const goodResultsCases = results.filter(r => r.resultName === 'goodResults');
  const avgGoodResults = goodResultsCases.reduce((a, b) => a + b.avgNs, 0) / goodResultsCases.length;

  const poorResultsCases = results.filter(r => r.resultName !== 'goodResults');
  const avgPoorResults = poorResultsCases.reduce((a, b) => a + b.avgNs, 0) / poorResultsCases.length;

  console.log(`Good results (fast path):  ${Math.round(avgGoodResults)} ns = ${(avgGoodResults/1000).toFixed(2)} µs`);
  console.log(`Poor/no results (slow path): ${Math.round(avgPoorResults)} ns = ${(avgPoorResults/1000).toFixed(2)} µs`);
  console.log('');

  if (avgGoodResults < 10000) {
    console.log('✓ Fast path is under 10µs target');
  } else {
    console.log('✗ Fast path exceeds 10µs target');
  }
}

runBenchmark().catch(console.error);
