#!/usr/bin/env node
/**
 * Phase 4a: Benchmark cold vs warm ORT session load times.
 * Measures impact of optimizedModelFilePath graph caching.
 */
import { performance } from 'perf_hooks';
import { existsSync, unlinkSync } from 'fs';

const RUNS = 3;

async function benchEmbeddingLoad() {
  const { getOptimizedModelPath, buildLocalSessionOptions } = await import('../core/embedding/embedding-local-model.js');
  const { fetchModel, getModelCacheDir } = await import('../core/infrastructure/model-fetcher.js');
  const { getModelEntry } = await import('../core/infrastructure/model-registry.js');
  const { initOrt } = await import('../core/infrastructure/ort-pipeline.js');
  const { join } = await import('path');

  await fetchModel('coderankembed-int8');
  const ort = await initOrt();
  const entry = getModelEntry('coderankembed-int8');
  const onnxPath = join(getModelCacheDir(entry.hfId), entry.files.find(f => f.path.endsWith('.onnx')).path);

  const optimizedPath = getOptimizedModelPath('q8');
  const sessionOpts = buildLocalSessionOptions('q8', false);

  // Cold load: remove cached optimized graph
  if (existsSync(optimizedPath)) {
    unlinkSync(optimizedPath);
    console.log(`  Removed cached graph: ${optimizedPath}`);
  }

  const coldTimes = [];
  for (let i = 0; i < RUNS; i++) {
    if (i > 0 && existsSync(optimizedPath)) unlinkSync(optimizedPath);
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(onnxPath, sessionOpts);
    const elapsed = performance.now() - t0;
    coldTimes.push(elapsed);
    await session.release();
    console.log(`  Cold load ${i + 1}: ${elapsed.toFixed(0)}ms`);
  }

  // Warm load: optimized graph should exist now
  // Re-create it first
  const warmSession = await ort.InferenceSession.create(onnxPath, sessionOpts);
  await warmSession.release();

  const warmTimes = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(onnxPath, sessionOpts);
    const elapsed = performance.now() - t0;
    warmTimes.push(elapsed);
    await session.release();
    console.log(`  Warm load ${i + 1}: ${elapsed.toFixed(0)}ms`);
  }

  return { coldTimes, warmTimes };
}

console.log('=== Embedding Model Session Load Benchmark ===\n');
const emb = await benchEmbeddingLoad();
const coldAvg = emb.coldTimes.reduce((a, b) => a + b, 0) / emb.coldTimes.length;
const warmAvg = emb.warmTimes.reduce((a, b) => a + b, 0) / emb.warmTimes.length;
console.log(`\nEmbedding Summary:`);
console.log(`  Cold avg: ${coldAvg.toFixed(0)}ms`);
console.log(`  Warm avg: ${warmAvg.toFixed(0)}ms`);
console.log(`  Speedup:  ${(coldAvg / warmAvg).toFixed(2)}x`);
