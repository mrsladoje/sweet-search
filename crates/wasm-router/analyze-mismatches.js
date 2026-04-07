#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const wasmPath = join(__dirname, 'pkg', 'query_router_wasm.js');
  const wasm = await import(wasmPath);
  const { extractAllFeatures, getAllFeatureNames } = await import('../training/features/extractor.js');

  const testCases = [
    // Route mismatches
    'what is the when of DataProcessor',
    'what is the architecture of SessionManager',
    'impact of changing SessionManager',
    'mechanism for ConfigLoader',
    // Feature mismatches
    'Authentifizierungsmechanismus',
    'src/utils/PaymentGateway.js',
    'ConfigLoader.loadConfig()',
    'config_loader',
    'H9n6T6lpEjX',
    'cómo funciona ConfigLoader',
    // Additional edge cases
    'ЗагрузчикФайлов',
    '_amjicg',
    'BJJ7dYc3S1I',
  ];

  const names = getAllFeatureNames();

  for (const q of testCases) {
    console.log('\n' + '='.repeat(70));
    console.log('Query:', JSON.stringify(q));

    const jsF = extractAllFeatures(q);
    const wasmF = wasm.extract_features_js(q);

    // Find mismatches
    const mismatches = [];
    for (let i = 0; i < 50; i++) {
      if (Math.abs(jsF[i] - wasmF[i]) > 0.0001) {
        mismatches.push({ i, name: names[i], js: jsF[i], wasm: wasmF[i] });
      }
    }

    if (mismatches.length === 0) {
      console.log('✅ All features match');
    } else {
      console.log('Mismatched features:');
      for (const m of mismatches) {
        console.log(`  [${m.i}] ${m.name}: JS=${m.js.toFixed(4)} WASM=${m.wasm.toFixed(4)}`);
      }
    }
  }
}

main().catch(console.error);
