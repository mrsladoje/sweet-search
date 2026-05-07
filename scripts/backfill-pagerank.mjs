#!/usr/bin/env node
// One-shot backfill: populate page_rank on existing code-graph.db files
// without requiring a full re-index. Used for ranking-probe A/B benches.
import Database from 'better-sqlite3';
import { populatePageRankColumn } from '../core/graph/structural-pagerank.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const repos = process.argv.slice(2).length ? process.argv.slice(2) : ['fastify', 'gin', 'flask', 'ripgrep'];

for (const repo of repos) {
  const dbPath = path.join(REPO_ROOT, 'eval/repos', repo, '.sweet-search/code-graph.db');
  const db = new Database(dbPath);
  const stats = populatePageRankColumn(db);
  console.log(`${repo}: ${stats.written}/${stats.entities} entities in ${stats.ms}ms`);
  db.close();
}
