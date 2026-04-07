#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const wasmPath = join(__dirname, 'pkg', 'query_router_wasm.js');
  const wasm = await import(wasmPath);
  const { routeQueryCatBoostWithReject } = await import('../query-router-catboost.js');

  const querySetDir = join(__dirname, '..', 'evaluation', 'query-sets');
  const mismatches = [];

  for (const file of fs.readdirSync(querySetDir)) {
    if (!file.endsWith('.json')) continue;
    if (!file.includes('multilingual')) continue;

    const content = JSON.parse(fs.readFileSync(join(querySetDir, file), 'utf8'));
    const queries = content.queries || content;

    for (const item of queries) {
      const query = item.query || item.text || (typeof item === 'string' ? item : null);
      if (typeof query !== 'string') continue;

      const wasmResult = wasm.route_query(query);
      const jsResult = routeQueryCatBoostWithReject(query);

      if (wasmResult.mode_str.toUpperCase() !== jsResult.mode.toUpperCase()) {
        mismatches.push({
          query,
          js: jsResult.mode,
          jsConf: jsResult.confidence,
          wasm: wasmResult.mode_str,
          wasmConf: wasmResult.confidence,
        });
      }
    }
  }

  console.log('Total mismatches:', mismatches.length);
  for (const m of mismatches) {
    console.log('');
    console.log('Query:', m.query);
    console.log('  JS:', m.js, '(conf:', m.jsConf.toFixed(3) + ')');
    console.log('  WASM:', m.wasm, '(conf:', m.wasmConf.toFixed(3) + ')');
  }
}

main().catch(console.error);
