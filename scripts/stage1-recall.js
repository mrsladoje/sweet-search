#!/usr/bin/env node

/**
 * Stage 1 candidate recall eval using REAL benchmark queries.
 *
 * Measures: of the ground-truth relevant documents, how many appear in
 * the HNSW Stage 1 candidate set (matched by file path)?
 *
 * Usage: node scripts/stage1-recall.js [--queries=N] [--language=LANG]
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { BinaryHNSWIndex } from '../core/vector-store/index.js';
import { truncateForHNSW, floatToBinary, hammingDistance } from '../core/embedding/index.js';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('='); return [k, v || 'true'];
  })
);

const MAX_QUERIES = parseInt(args.queries || '500');
const LANG_FILTER = args.language || null;
const CORPUS_DIR = 'eval/corpus/gencodesearchnet';
const QUERY_FILE = 'eval/data/gencodesearchnet/queries.jsonl';
const CORPUS_FILE = 'eval/data/gencodesearchnet/corpus.jsonl';
const HNSW_PATH = path.join(CORPUS_DIR, '.sweet-search/codebase-binary-hnsw.idx');

console.log('=== Stage 1 Candidate Recall (Real Benchmark Queries) ===\n');

// Build doc_id → file path mapping from corpus (same logic as eval harness)
const LANG_EXT = { python: '.py', javascript: '.js', go: '.go', ruby: '.rb', java: '.java', php: '.php' };
function simpleHash(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; } return Math.abs(h); }

console.log('Loading corpus for doc_id → file mapping...');
const corpus = readFileSync(CORPUS_FILE, 'utf-8').trim().split('\n').map(JSON.parse);
const docIdToFile = new Map();
for (const doc of corpus) {
  const ext = LANG_EXT[doc.language] || '.txt';
  const safeRepo = (doc.repo || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 50);
  const safeName = (doc.func_name || 'func').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  const hash = simpleHash(doc.doc_id).toString(16).slice(0, 6);
  const fileName = `${safeName}_${hash}${ext}`;
  // Relative path from corpus dir (matches chunk metadata.file)
  const relPath = `${doc.language || 'unknown'}/${safeRepo}/${fileName}`;
  docIdToFile.set(doc.doc_id, relPath);
}
console.log(`  Mapped ${docIdToFile.size} documents\n`);

// Load HNSW index
const index = new BinaryHNSWIndex({ indexPath: HNSW_PATH });
await index.load(HNSW_PATH);
console.log(`HNSW: ${index.vectors.length} vectors, M=${index.M}, efSearch=${index.efSearch}\n`);

// Build file → chunk indices for fast lookup
const fileToChunks = new Map();
for (let i = 0; i < index.vectors.length; i++) {
  const file = index.vectors[i].metadata?.file;
  if (file) {
    if (!fileToChunks.has(file)) fileToChunks.set(file, []);
    fileToChunks.get(file).push(i);
  }
}

// Load queries
let queries = readFileSync(QUERY_FILE, 'utf-8').trim().split('\n').map(JSON.parse);
if (LANG_FILTER) queries = queries.filter(q => q.language === LANG_FILTER);
queries = queries.slice(0, MAX_QUERIES);
console.log(`Queries: ${queries.length}${LANG_FILTER ? ` (${LANG_FILTER})` : ''}\n`);

// Embed queries
const { getEmbedding } = await import('../core/embedding/index.js');

const ks = [10, 50, 100, 200, 500, 1000];
const recalls = Object.fromEntries(ks.map(k => [k, []]));
const annFidelity200 = [];
const visitedCounts = [];
const latencies = [];
let skipped = 0;

for (let qi = 0; qi < queries.length; qi++) {
  const q = queries[qi];

  // Map ground-truth doc_ids → file paths → check they exist in index
  const relevantFiles = new Set();
  for (const docId of q.relevant_doc_ids) {
    const file = docIdToFile.get(docId);
    if (file && fileToChunks.has(file)) relevantFiles.add(file);
  }
  if (relevantFiles.size === 0) { skipped++; continue; }

  try {
    const embedResult = await getEmbedding(q.query, { isQuery: true });
    const truncated = truncateForHNSW(embedResult.embedding);
    const queryBinary = floatToBinary(truncated);

    const maxK = Math.max(...ks);
    const result = await index.search(queryBinary, maxK);

    visitedCounts.push(result.visitedNodes || 0);
    latencies.push(result.latency_us);

    // Check if any result's file matches a relevant file
    for (const k of ks) {
      const topKFiles = new Set(result.results.slice(0, k).map(r => r.metadata?.file));
      const found = [...relevantFiles].filter(f => topKFiles.has(f)).length;
      recalls[k].push(found / relevantFiles.size);
    }

    // ANN fidelity: HNSW top-200 vs brute-force top-200 (by Hamming distance)
    const bf = [];
    for (let i = 0; i < index.vectors.length; i++) {
      bf.push({ idx: i, dist: hammingDistance(queryBinary, index.vectors[i].binary) });
    }
    bf.sort((a, b) => a.dist - b.dist);
    const bfTop200Files = new Set(bf.slice(0, 200).map(r => index.vectors[r.idx].metadata?.file));
    const hnswTop200Files = new Set(result.results.slice(0, 200).map(r => r.metadata?.file));
    let overlap = 0;
    for (const f of bfTop200Files) if (hnswTop200Files.has(f)) overlap++;
    annFidelity200.push(overlap / bfTop200Files.size);
  } catch (err) {
    skipped++;
  }

  if ((qi + 1) % 50 === 0) process.stdout.write(`  ${qi + 1}/${queries.length} (skipped: ${skipped})\n`);
}

const evaluated = queries.length - skipped;
const avg = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] || 0;

console.log(`\nEvaluated: ${evaluated} queries (${skipped} skipped)\n`);

console.log('--- Ground-Truth Candidate Recall ---');
for (const k of ks) {
  if (recalls[k].length) {
    console.log(`  Recall@${String(k).padEnd(5)} ${(avg(recalls[k]) * 100).toFixed(1)}%`);
  }
}

console.log(`\n--- ANN Fidelity (HNSW vs brute-force, top-200 file overlap) ---`);
console.log(`  Overlap@200: ${(avg(annFidelity200) * 100).toFixed(1)}%`);

console.log('\n--- Visited Nodes ---');
console.log(`  avg: ${avg(visitedCounts).toFixed(0)}, p50: ${pct(visitedCounts, 0.5)}, p95: ${pct(visitedCounts, 0.95)}`);

console.log('\n--- Stage 1 Latency ---');
console.log(`  avg: ${avg(latencies).toFixed(0)}us, p50: ${pct(latencies, 0.5)}us`);
