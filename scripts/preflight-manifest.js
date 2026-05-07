// Preflight manifest — prints the active state for an indexed corpus.
// Usage: node /tmp/preflight.js <corpus-dir>
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

const corpusDir = process.argv[2] || '.';
const dataDir = join(corpusDir, '.sweet-search');

const out = {
  corpusDir,
  dataDir,
  exists: existsSync(dataDir),
  envLiModel: process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL || null,
};

// LI manifest
const liPath = join(dataDir, 'codebase-late-interaction.db');
if (existsSync(liPath)) {
  try {
    const m = JSON.parse(readFileSync(liPath, 'utf-8'));
    out.li = {
      modelId: m.modelId, tokenDim: m.tokenDim, version: m.version,
      quantBits: m.quantBits, fileSize: statSync(liPath).size,
    };
  } catch (e) { out.li = { error: e.message }; }
} else {
  out.li = null;
}

// HNSW vector counts
const hnswMeta = join(dataDir, 'codebase-hnsw.meta.json');
const binHnswMeta = join(dataDir, 'codebase-binary-hnsw.meta.json');
if (existsSync(hnswMeta)) {
  try {
    const j = JSON.parse(readFileSync(hnswMeta, 'utf-8'));
    out.hnsw = { count: j.count ?? j.size ?? j.numVectors, dim: j.dim ?? j.dimension };
  } catch (e) { out.hnsw = { error: e.message }; }
}
if (existsSync(binHnswMeta)) {
  try {
    const j = JSON.parse(readFileSync(binHnswMeta, 'utf-8'));
    out.binHnsw = { count: j.count ?? j.size ?? j.numVectors, dim: j.dim ?? j.dimension };
  } catch (e) { out.binHnsw = { error: e.message }; }
}

// Codebase chunk count
const codebaseDb = join(dataDir, 'codebase.db');
if (existsSync(codebaseDb)) {
  try {
    const db = new Database(codebaseDb, { readonly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    out.codebase = { tables };
    if (tables.includes('chunks')) out.codebase.chunkCount = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n;
    if (tables.includes('files')) out.codebase.fileCount = db.prepare('SELECT COUNT(*) AS n FROM files').get().n;
    db.close();
  } catch (e) { out.codebase = { error: e.message }; }
}

console.log(JSON.stringify(out, null, 2));
