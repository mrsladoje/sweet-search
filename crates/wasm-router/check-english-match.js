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
  let englishTotal = 0, englishMatches = 0;
  let multiTotal = 0, multiMatches = 0;

  for (const file of fs.readdirSync(querySetDir)) {
    if (!file.endsWith('.json')) continue;
    const isMulti = file.includes('multilingual');
    const content = JSON.parse(fs.readFileSync(join(querySetDir, file), 'utf8'));
    const queries = content.queries || content;
    if (!Array.isArray(queries)) continue;

    for (const item of queries) {
      const query = item.query || item.text || (typeof item === 'string' ? item : null);
      if (typeof query !== 'string') continue;

      const wasmResult = wasm.route_query(query);
      const jsResult = routeQueryCatBoostWithReject(query);
      const match = wasmResult.mode_str.toUpperCase() === jsResult.mode.toUpperCase();

      if (isMulti) {
        multiTotal++;
        if (match) multiMatches++;
      } else {
        englishTotal++;
        if (match) englishMatches++;
      }
    }
  }

  console.log('=== Match Rate by Category ===');
  console.log('');
  console.log('English queries:      ' + englishMatches + '/' + englishTotal + ' (' + (englishMatches/englishTotal*100).toFixed(2) + '%)');
  console.log('Multilingual queries: ' + multiMatches + '/' + multiTotal + ' (' + (multiMatches/multiTotal*100).toFixed(2) + '%)');
  console.log('');
  console.log('Total:                ' + (englishMatches+multiMatches) + '/' + (englishTotal+multiTotal) + ' (' + ((englishMatches+multiMatches)/(englishTotal+multiTotal)*100).toFixed(2) + '%)');
}

main().catch(console.error);
