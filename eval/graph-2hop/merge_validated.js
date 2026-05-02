#!/usr/bin/env node
/**
 * Merge per-repo *_validated.jsonl files into a single queries.jsonl.
 * Falls back to per-repo source files in queries/ when a validated file
 * is missing — useful for partial smoke runs.
 *
 * Usage:
 *   node eval/graph-2hop/merge_validated.js
 *   node eval/graph-2hop/merge_validated.js --repos=fastify,flask
 *   node eval/graph-2hop/merge_validated.js --source        # use queries/ unfiltered
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repos: ['fastify', 'flask', 'ripgrep'],
    out: path.join(__dirname, 'queries.jsonl'),
    source: false,
  };
  for (const a of args) {
    if (a.startsWith('--repos=')) opts.repos = a.split('=')[1].split(',');
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
    else if (a === '--source') opts.source = true;
  }
  return opts;
}

const opts = parseArgs();

const merged = [];
const counts = {};
for (const repo of opts.repos) {
  const validatedFile = path.join(__dirname, 'validation', `${repo}_validated.jsonl`);
  const sourceFile = path.join(__dirname, 'queries', `${repo}.jsonl`);
  const useFile = (!opts.source && fs.existsSync(validatedFile)) ? validatedFile : sourceFile;
  if (!fs.existsSync(useFile)) {
    console.error(`[skip] ${repo}: no file at ${useFile}`);
    continue;
  }
  const lines = fs.readFileSync(useFile, 'utf-8').split('\n').filter(Boolean);
  for (const l of lines) {
    try {
      const row = JSON.parse(l);
      if (!row.repo) row.repo = repo;
      merged.push(row);
    } catch (err) {
      console.error(`[bad row in ${useFile}]: ${err.message}`);
    }
  }
  counts[repo] = { source: useFile.includes('_validated') ? 'validated' : 'source', n: lines.length };
}

fs.writeFileSync(opts.out, merged.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`merged ${merged.length} rows → ${opts.out}`);
for (const repo of Object.keys(counts)) {
  console.log(`  ${repo}: ${counts[repo].n} (${counts[repo].source})`);
}

// Sanity counts
const byRepo = {};
const byHops = {};
const byCat = {};
for (const r of merged) {
  byRepo[r.repo] = (byRepo[r.repo] || 0) + 1;
  byHops[r.expected_hops] = (byHops[r.expected_hops] || 0) + 1;
  byCat[r.category] = (byCat[r.category] || 0) + 1;
}
console.log('\nby repo:    ', byRepo);
console.log('by hops:    ', byHops);
console.log('by category:', byCat);
