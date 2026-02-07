#!/usr/bin/env node
/**
 * Anti-Leak Check for Evaluation Benchmarks
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

function loadTrainingQueries() {
  const queries = new Set();
  const hardNegsPath = join(__dirname, '../output/hard_negatives.json');
  if (existsSync(hardNegsPath)) {
    const hardNegs = JSON.parse(readFileSync(hardNegsPath, 'utf-8'));
    if (hardNegs.queries) hardNegs.queries.forEach(h => queries.add(h.query.toLowerCase()));
  }
  return queries;
}

function loadExistingBenchmarkQueries() {
  const queries = new Set();
  const querySetsDir = join(rootDir, 'evaluation/query-sets');
  const files = readdirSync(querySetsDir).filter(f => f.endsWith('.json') && !f.includes('novel') && f !== 'schema.json');
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(querySetsDir, file), 'utf-8'));
    if (data.queries) data.queries.forEach(q => queries.add(q.query.toLowerCase()));
  }
  return queries;
}

function loadNovelQueries() {
  const querySetsDir = join(rootDir, 'evaluation/query-sets');
  const novelFiles = readdirSync(querySetsDir).filter(f => f.includes('novel') && f.endsWith('.json'));
  const queries = [];
  for (const file of novelFiles) {
    const data = JSON.parse(readFileSync(join(querySetsDir, file), 'utf-8'));
    if (data.queries) data.queries.forEach(q => queries.push({ file, query: q.query, id: q.id, expectedRoute: data.expectedRoute }));
  }
  return queries;
}

function main() {
  console.log('='.repeat(60));
  console.log('ANTI-LEAK CHECK FOR EVALUATION BENCHMARKS');
  console.log('='.repeat(60));
  console.log();

  const trainingQueries = loadTrainingQueries();
  const existingBenchmarkQueries = loadExistingBenchmarkQueries();
  const novelQueries = loadNovelQueries();

  console.log('Training queries:', trainingQueries.size);
  console.log('Existing benchmark queries:', existingBenchmarkQueries.size);
  console.log('Novel queries to check:', novelQueries.length);
  console.log();

  const leaks = [];
  for (const { file, query, id } of novelQueries) {
    const lowerQuery = query.toLowerCase();
    if (trainingQueries.has(lowerQuery)) leaks.push({ file, query, id, type: 'training' });
    if (existingBenchmarkQueries.has(lowerQuery)) leaks.push({ file, query, id, type: 'existing_benchmark' });
  }

  if (leaks.length === 0) {
    console.log('ANTI-LEAK: PASSED');
    console.log('   All ' + novelQueries.length + ' novel queries are unique');
  } else {
    console.log('ANTI-LEAK: ' + leaks.length + ' duplicates found:');
    for (const { file, query, id, type } of leaks) console.log('   [' + type + '] ' + file + ' (' + id + '): "' + query + '"');
  }

  console.log();
  console.log('='.repeat(60));
  console.log('NOVEL QUERY DISTRIBUTION');
  console.log('='.repeat(60));

  const byFile = {};
  for (const q of novelQueries) {
    if (!byFile[q.file]) byFile[q.file] = { count: 0, route: q.expectedRoute };
    byFile[q.file].count++;
  }
  let total = 0;
  for (const [file, { count, route }] of Object.entries(byFile)) {
    console.log('  ' + file + ': ' + count + ' queries (' + route + ')');
    total += count;
  }
  console.log();
  console.log('Total novel queries:', total);
  process.exit(leaks.length > 0 ? 1 : 0);
}

main();
