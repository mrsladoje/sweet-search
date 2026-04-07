#!/usr/bin/env node
/**
 * Benchmark: WASM Router vs JS Router
 *
 * Target: <5μs per query (from 237μs baseline)
 */

import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test queries
const TEST_QUERIES = [
  // Lexical (exact identifiers)
  'AuthService',
  'getUserById',
  'EmployeeController.java',
  'MAX_CONNECTION_POOL_SIZE',
  'bot_detection_service',

  // Semantic (conceptual questions)
  'how does authentication work',
  'explain the bot detection algorithm',
  'what is the architecture of the authentication system',
  'describe the refresh token mechanism',

  // Structural (graph queries)
  'what calls JwtService',
  'callers of ApiKeyService',
  'what does BotDetectionService call',
  'implementations of DetectionHeuristic',

  // Hybrid (ambiguous)
  'jwt token',
  'api key filter',
  'AuthService login flow',
  'password reset',
];

async function loadWasm() {
  // Dynamic import for WASM (Node.js target)
  const wasmPath = join(__dirname, 'pkg', 'query_router_wasm.js');
  const wasm = await import(wasmPath);
  return wasm;
}

async function loadJsRouter() {
  const routerPath = join(__dirname, '..', 'core', 'query-router-catboost.js');
  return await import(routerPath);
}

function benchmarkWasm(wasm, queries, iterations = 10000) {
  // Warmup
  for (let i = 0; i < 100; i++) {
    for (const q of queries) {
      wasm.route_query(q);
    }
  }

  // Benchmark
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (const q of queries) {
      wasm.route_query(q);
    }
  }
  const end = performance.now();

  const totalQueries = iterations * queries.length;
  const totalMs = end - start;
  const avgUs = (totalMs * 1000) / totalQueries;

  return {
    name: 'WASM Router',
    totalQueries,
    totalMs: totalMs.toFixed(2),
    avgUs: avgUs.toFixed(3),
    queriesPerSec: Math.round(totalQueries / (totalMs / 1000)),
  };
}

async function benchmarkJs(routerModule, queries, iterations = 1000) {
  const { routeQueryCatBoostWithReject: routeQuery } = routerModule;

  // Warmup
  for (let i = 0; i < 10; i++) {
    for (const q of queries) {
      routeQuery(q);
    }
  }

  // Benchmark
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (const q of queries) {
      routeQuery(q);
    }
  }
  const end = performance.now();

  const totalQueries = iterations * queries.length;
  const totalMs = end - start;
  const avgUs = (totalMs * 1000) / totalQueries;

  return {
    name: 'JS Router',
    totalQueries,
    totalMs: totalMs.toFixed(2),
    avgUs: avgUs.toFixed(3),
    queriesPerSec: Math.round(totalQueries / (totalMs / 1000)),
  };
}

async function compareResults(wasm, jsRouter) {
  const { routeQueryCatBoostWithReject: jsRouteQuery } = jsRouter;

  console.log('\n=== Routing Results Comparison ===\n');
  console.log('Query'.padEnd(45) + 'WASM'.padEnd(15) + 'JS'.padEnd(15) + 'Match');
  console.log('-'.repeat(80));

  let matches = 0;
  for (const q of TEST_QUERIES) {
    const wasmResult = wasm.route_query(q);
    const jsResult = jsRouteQuery(q);

    const wasmMode = wasmResult.mode_str;
    const jsMode = jsResult.mode;
    const match = wasmMode.toUpperCase() === jsMode.toUpperCase() ? '✓' : '✗';
    if (match === '✓') matches++;

    console.log(`${q.substring(0, 44).padEnd(45)}${wasmMode.padEnd(15)}${jsMode.padEnd(15)}${match}`);
  }

  console.log('-'.repeat(80));
  console.log(`Match rate: ${matches}/${TEST_QUERIES.length} (${(matches / TEST_QUERIES.length * 100).toFixed(1)}%)`);
}

async function main() {
  console.log('🚀 Query Router Benchmark: WASM vs JS\n');
  console.log('Loading modules...');

  let wasm, jsRouter;

  try {
    wasm = await loadWasm();
    console.log('✓ WASM module loaded');
  } catch (e) {
    console.error('✗ Failed to load WASM:', e.message);
  }

  try {
    jsRouter = await loadJsRouter();
    console.log('✓ JS router loaded');
  } catch (e) {
    console.error('✗ Failed to load JS router:', e.message);
  }

  // Compare routing results
  if (wasm && jsRouter) {
    await compareResults(wasm, jsRouter);
  }

  console.log('\n=== Performance Benchmark ===\n');

  // WASM benchmark
  if (wasm) {
    const wasmResult = benchmarkWasm(wasm, TEST_QUERIES);
    console.log(`${wasmResult.name}:`);
    console.log(`  Total queries: ${wasmResult.totalQueries.toLocaleString()}`);
    console.log(`  Total time: ${wasmResult.totalMs}ms`);
    console.log(`  Avg latency: ${wasmResult.avgUs}μs`);
    console.log(`  Throughput: ${wasmResult.queriesPerSec.toLocaleString()} queries/sec`);

    const targetMet = parseFloat(wasmResult.avgUs) < 5;
    console.log(`  Target <5μs: ${targetMet ? '✓ MET!' : '✗ Not met'}`);
  }

  // JS benchmark
  if (jsRouter) {
    console.log('');
    const jsResult = await benchmarkJs(jsRouter, TEST_QUERIES);
    console.log(`${jsResult.name}:`);
    console.log(`  Total queries: ${jsResult.totalQueries.toLocaleString()}`);
    console.log(`  Total time: ${jsResult.totalMs}ms`);
    console.log(`  Avg latency: ${jsResult.avgUs}μs`);
    console.log(`  Throughput: ${jsResult.queriesPerSec.toLocaleString()} queries/sec`);
  }

  // Speedup
  if (wasm && jsRouter) {
    const wasmResult = benchmarkWasm(wasm, TEST_QUERIES);
    const jsResult = await benchmarkJs(jsRouter, TEST_QUERIES);
    const speedup = parseFloat(jsResult.avgUs) / parseFloat(wasmResult.avgUs);
    console.log(`\n📊 Speedup: ${speedup.toFixed(1)}x faster`);
  }
}

main().catch(console.error);
