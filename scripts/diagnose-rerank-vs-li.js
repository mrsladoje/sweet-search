#!/usr/bin/env node
/**
 * Compare LI MaxSim scoring vs CE reranker scoring on the same candidate
 * set. Bypasses SweetSearch's full search pipeline (avoids the stage-2.5
 * dim-mismatch issue in the current index) and directly reads candidate
 * chunks from the codebase.db so we can inspect whether CE and LI produce
 * materially different rankings.
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { getGlobalLocalReranker } from '/Users/admin/Projects/sweet-search-private/core/ranking/local-reranker.js';

const PROJECT_ROOT = '/Users/admin/Projects/sweet-search-private';
const CORPUS_DB = path.join(PROJECT_ROOT, 'eval', 'corpus', 'gencodesearchnet', '.sweet-search', 'codebase.db');
const QUERIES_PATH = path.join(PROJECT_ROOT, 'eval', 'data', 'gencodesearchnet', 'queries.jsonl');

// Heuristic candidate lookup: find chunks whose name or text contains at
// least one token from the query. Good enough for this diagnostic.
function findCandidates(db, queryText, k = 20) {
  const tokens = queryText
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 10);
  if (tokens.length === 0) return [];

  const likeConditions = tokens.map(() => 'text LIKE ?').join(' OR ');
  const params = tokens.map((t) => `%${t}%`);
  const rows = db.prepare(
    `SELECT id, file_path, text, metadata FROM vectors WHERE ${likeConditions} LIMIT ${k}`
  ).all(...params);
  return rows;
}

function loadQueries(n) {
  return fs
    .readFileSync(QUERIES_PATH, 'utf-8')
    .trim()
    .split('\n')
    .slice(0, n * 3) // oversample, we filter short/empty queries below
    .map((l) => JSON.parse(l))
    .filter((q) => (q.query || '').length > 20)
    .slice(0, n);
}

function kendallTauById(a, b) {
  const rankA = new Map(a.map((x, i) => [x.id, i]));
  const rankB = new Map(b.map((x, i) => [x.id, i]));
  const ids = [...rankA.keys()].filter((id) => rankB.has(id));
  let conc = 0;
  let disc = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const da = rankA.get(ids[i]) - rankA.get(ids[j]);
      const dbx = rankB.get(ids[i]) - rankB.get(ids[j]);
      if (da * dbx > 0) conc++;
      else if (da * dbx < 0) disc++;
    }
  }
  const tot = conc + disc;
  return tot === 0 ? 1 : (conc - disc) / tot;
}

async function main() {
  const db = new Database(CORPUS_DB, { readonly: true });
  const reranker = getGlobalLocalReranker();
  await reranker.init();

  const queries = loadQueries(5);
  console.log(`\n=== Comparing CE reranker rankings for ${queries.length} queries ===\n`);

  for (const q of queries) {
    const queryText = q.query.trim().slice(0, 300);
    const cands = findCandidates(db, queryText, 20);
    if (cands.length < 5) {
      console.log(`SKIP (too few candidates): "${queryText.slice(0, 60)}..."`);
      continue;
    }

    console.log(`\nQUERY: "${queryText.slice(0, 90)}..."`);
    console.log(`  ${cands.length} candidates matched`);

    const docs = cands.map((c) => c.text || '');
    const ceResult = await reranker.rerank(queryText, docs, 10);

    const baseline = cands.slice(0, 10).map((c, i) => ({
      id: c.id,
      rank: i,
      file: (c.file_path || '').slice(-40),
    }));
    const ceRanked = ceResult.results.slice(0, 10).map((r, i) => ({
      id: cands[r.originalIndex].id,
      rank: i,
      score: r.localRerankerScore,
      file: (cands[r.originalIndex].file_path || '').slice(-40),
    }));

    console.log(`  CE latency: ${ceResult.latency_ms ?? '?'} ms`);
    const tau = kendallTauById(baseline, ceRanked);
    console.log(`  Kendall τ(baseline_order, CE_order) = ${tau.toFixed(3)}   (1.0 = same order, -1.0 = reversed)`);

    console.log('  Top 5 baseline (SQL-LIKE order):');
    baseline.slice(0, 5).forEach((r, i) => console.log(`    #${i + 1} ${r.file}`));
    console.log('  Top 5 CE rerank:');
    ceRanked.slice(0, 5).forEach((r, i) => console.log(`    #${i + 1} ${r.file}  score=${r.score?.toFixed(4) ?? '?'}`));

    // Score variance
    const scores = ceResult.results.map((r) => r.localRerankerScore);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`  CE score range: min=${min.toFixed(4)} max=${max.toFixed(4)} mean=${mean.toFixed(4)}  (range=${(max - min).toFixed(4)})`);
  }

  db.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
