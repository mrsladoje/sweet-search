#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'core', 'infrastructure', 'manifest.json');

const manifest = {
  version: 2,
  runtimeAssets: {
    wasmRouter: 'crates/wasm-router/pkg/query_router_wasm.js',
    wasmRouterBinary: 'crates/wasm-router/pkg/query_router_wasm_bg.wasm',
    maxsimWasm: 'core/infrastructure/maxsim.wasm',
    simdDistanceWasm: 'core/infrastructure/simd-distance.wasm',
    catboostRouter: 'training/output/v45_router_d4.js',
    featureExtractor: 'training/features/extractor.js',
  },
  nativePackages: {
    'darwin-arm64': '@sweet-search/native-darwin-arm64',
    'darwin-x64': '@sweet-search/native-darwin-x64',
    'linux-x64-gnu': '@sweet-search/native-linux-x64-gnu',
    'linux-arm64-gnu': '@sweet-search/native-linux-arm64-gnu',
  },
  profiles: {
    core: {
      description: 'Lightweight search (no models)',
      models: [],
    },
    full: {
      description: 'Full search with all models',
      models: [
        'lateon-code',
        'lateon-code-edge',
        'gte-reranker-modernbert-base',
        'coderankembed-int8',
      ],
    },
  },
  modelSources: {
    'lateon-code': { type: 'init-managed' },
    'lateon-code-edge': { type: 'init-managed' },
    'gte-reranker-modernbert-base': { type: 'init-managed' },
    'coderankembed-int8': { type: 'init-managed' },
  },
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(MANIFEST_PATH, 'utf8');
  if (current !== serialized) {
    console.error('core/infrastructure/manifest.json is out of date. Run: node scripts/generate-asset-manifest.js');
    process.exit(1);
  }
  process.exit(0);
}

mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
writeFileSync(MANIFEST_PATH, serialized, 'utf8');
console.log(`Wrote ${MANIFEST_PATH}`);
