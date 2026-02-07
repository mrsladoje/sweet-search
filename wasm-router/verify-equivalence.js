#!/usr/bin/env node
/**
 * Verify WASM router produces EXACTLY the same results as JS router
 * Tests against all query sets used in training/evaluation
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadQuerySets() {
  const querySetDir = join(__dirname, '..', 'evaluation', 'query-sets');
  const sets = {};

  for (const file of fs.readdirSync(querySetDir)) {
    if (file.endsWith('.json')) {
      const content = JSON.parse(fs.readFileSync(join(querySetDir, file), 'utf8'));
      sets[file] = content;
    }
  }

  return sets;
}

async function main() {
  console.log('🔍 Verifying WASM vs JS Router Equivalence\n');

  // Load modules
  const wasmPath = join(__dirname, 'pkg', 'query_router_wasm.js');
  const wasm = await import(wasmPath);
  const { routeQueryCatBoostWithReject } = await import('../query-router-catboost.js');

  // Load all query sets
  const querySets = await loadQuerySets();

  let totalQueries = 0;
  let matches = 0;
  let mismatches = [];

  for (const [setName, content] of Object.entries(querySets)) {
    const queries = content.queries || content;
    if (!Array.isArray(queries)) continue;

    for (const item of queries) {
      const query = item.query || item.text || (typeof item === 'string' ? item : null);
      if (typeof query !== 'string') continue;

      totalQueries++;

      const wasmResult = wasm.route_query(query);
      const jsResult = routeQueryCatBoostWithReject(query);

      const wasmMode = wasmResult.mode_str.toUpperCase();
      const jsMode = jsResult.mode.toUpperCase();

      if (wasmMode === jsMode) {
        matches++;
      } else {
        mismatches.push({
          query: query.substring(0, 60),
          wasm: wasmMode,
          js: jsMode,
          jsConfidence: jsResult.confidence.toFixed(3),
          wasmConfidence: wasmResult.confidence.toFixed(3),
          set: setName,
        });
      }
    }
  }

  // Print results
  console.log(`Total queries tested: ${totalQueries}`);
  console.log(`Matches: ${matches}`);
  console.log(`Mismatches: ${mismatches.length}`);
  console.log(`Match rate: ${(matches / totalQueries * 100).toFixed(2)}%\n`);

  if (mismatches.length > 0) {
    console.log('=== MISMATCHES ===\n');
    console.log('Query'.padEnd(62) + 'WASM'.padEnd(12) + 'JS'.padEnd(12) + 'JS Conf'.padEnd(10) + 'Set');
    console.log('-'.repeat(110));

    for (const m of mismatches.slice(0, 50)) {  // Show first 50
      console.log(
        m.query.padEnd(62) +
        m.wasm.padEnd(12) +
        m.js.padEnd(12) +
        m.jsConfidence.padEnd(10) +
        m.set
      );
    }

    if (mismatches.length > 50) {
      console.log(`\n... and ${mismatches.length - 50} more mismatches`);
    }
  } else {
    console.log('✅ PERFECT MATCH - WASM router is functionally equivalent to JS router');
  }
}

main().catch(console.error);
