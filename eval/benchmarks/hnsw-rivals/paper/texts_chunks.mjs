// Rebuild the exact embedder input of every chunk of one indexed root with the product's own chunker
// (core/indexing/indexer-build.js:chunkFiles = chunk + code-graph enrichment), and verify each text against
// the `embedding_input_hash` stored in that root's codebase.db (hash of the exact embedding_text).
// usage: SS_REPO=<repo> node texts_chunks.mjs <indexRoot> <out.jsonl>
//   <indexRoot> holds the source files and .sweet-search/{codebase.db,code-graph.db}.
// out.jsonl: one line per DB vector (DB rowid order): {"id","text","hash_ok"}; a chunk the chunker no longer
// produces has text null and carries {file, lang, db_text} (the raw chunk text of the DB) for a flagged fallback.
// A summary goes to stderr.
// Needs: node_modules of the repo (better-sqlite3, tree-sitter wasm). Read-only on the root.
import fs from 'node:fs';
import path from 'node:path';

const R = process.env.SS_REPO || '/Users/admin/Projects/sweet-search-private';
const [rootArg, outArg] = process.argv.slice(2);
if (!rootArg || !outArg) throw new Error('usage: texts_chunks.mjs <indexRoot> <out.jsonl>');
const root = path.resolve(rootArg);
process.env.SWEET_SEARCH_PROJECT_ROOT = root; // read once by config/platform.js at import
process.chdir(root);

const Database = (await import(`${R}/node_modules/better-sqlite3/lib/index.js`)).default;
const { chunkFiles } = await import(`${R}/core/indexing/indexer-build.js`);
const { chunkInputHashes } = await import(`${R}/core/incremental-indexing/domain/encoder-input.mjs`);

const db = new Database(`${root}/.sweet-search/codebase.db`, { readonly: true });
const hasEpoch = db.prepare("SELECT count(*) c FROM pragma_table_info('vectors') WHERE name='epoch_retired'").get().c > 0;
const W = hasEpoch ? ' WHERE epoch_retired IS NULL' : '';
const rows = db.prepare(`SELECT id, file_path, embedding_input_hash h, text AS db_text, json_extract(metadata, '$.language') AS lang FROM vectors${W} ORDER BY rowid`).all();
db.close();
const files = [...new Set(rows.map(r => r.file_path))];

const { allChunks, texts } = await chunkFiles(files);
const byId = new Map();
allChunks.forEach((c, i) => byId.set(c.id, { chunk: c, text: texts[i] }));

let ok = 0, bad = 0, missing = 0;
const fd = fs.openSync(outArg, 'w');
for (const r of rows) {
  const e = byId.get(r.id);
  if (!e) { missing++; fs.writeSync(fd, JSON.stringify({ id: r.id, text: null, hash_ok: false, file: r.file_path, lang: r.lang, db_text: r.db_text }) + '\n'); continue; }
  const h = chunkInputHashes(e.chunk, { includeDedup: false }).embedding_input_hash;
  const good = h === r.h;
  good ? ok++ : bad++;
  fs.writeSync(fd, JSON.stringify({ id: r.id, text: e.text, hash_ok: good }) + '\n');
}
fs.closeSync(fd);
console.error(JSON.stringify({ root, db_vectors: rows.length, files: files.length, chunks_built: allChunks.length, hash_ok: ok, hash_mismatch: bad, missing }));
process.exit(0);
