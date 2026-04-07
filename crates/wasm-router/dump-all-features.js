#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { extractAllFeatures, getAllFeatureNames } from '../core/training/query-router/features/extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const wasmPath = join(__dirname, 'pkg', 'query_router_wasm.js');
  const wasm = await import(wasmPath);
  const names = getAllFeatureNames();

  const query = 'како ради кеширање података';

  console.log('Query:', query, '\n');

  const jsFeatures = extractAllFeatures(query);
  const wasmFeatures = wasm.extract_features_js(query);

  console.log('| Idx | Feature Name                      | JS Value | WASM Value | Match |');
  console.log('|-----|-----------------------------------|----------|------------|-------|');

  let mismatches = 0;
  for (let i = 0; i < 50; i++) {
    const name = names[i] || `feature_${i}`;
    const jsVal = jsFeatures[i];
    const wasmVal = wasmFeatures[i];
    const match = Math.abs(jsVal - wasmVal) < 0.0001;
    if (!match) mismatches++;

    const jsStr = typeof jsVal === 'number' ? jsVal.toFixed(4) : String(jsVal);
    const wasmStr = typeof wasmVal === 'number' ? wasmVal.toFixed(4) : String(wasmVal);

    console.log(`| ${i.toString().padStart(3)} | ${name.padEnd(33)} | ${jsStr.padStart(8)} | ${wasmStr.padStart(10)} | ${match ? '  ✓  ' : '  ✗  '} |`);
  }

  console.log('');
  console.log('Total mismatches:', mismatches);
}

main().catch(console.error);
