#!/usr/bin/env node

/**
 * Enrich a js-misses-only-*.json file with the actual indexed chunk text
 * for each retrieved result and the expected file's chunks.
 *
 * Reads .sweet-search/codebase.db `vectors` table to fetch chunk text by
 * file_path. A single corpus file may produce multiple chunks; we attach
 * all of them to each result so downstream analysis can see what was
 * actually embedded.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: null, output: null };
  for (const arg of args) {
    if (arg.startsWith('--input=')) opts.input = arg.split('=')[1];
    else if (arg.startsWith('--output=')) opts.output = arg.split('=')[1];
  }
  if (!opts.input) {
    console.error('Usage: node enrich_misses.js --input=path/to/js-misses-only-*.json [--output=…]');
    process.exit(1);
  }
  if (!opts.output) {
    opts.output = opts.input.replace(/\.json$/, '-enriched.json');
  }
  return opts;
}

function snippetClean(s, n = 1200) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n) + '…';
}

async function main() {
  const opts = parseArgs();
  const dbPath = path.join(__dirname, 'corpus', 'gencodesearchnet', '.sweet-search', 'codebase.db');
  if (!existsSync(dbPath)) {
    console.error(`codebase.db not found at ${dbPath}`);
    process.exit(2);
  }

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });

  // Build a map: file_path -> [{id, text, metadata}, ...]
  console.log('Loading chunks from codebase.db…');
  const rows = db.prepare('SELECT id, file_path, text, metadata FROM vectors').all();
  const byFile = new Map();
  for (const r of rows) {
    if (!byFile.has(r.file_path)) byFile.set(r.file_path, []);
    let meta = {};
    try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch {}
    byFile.get(r.file_path).push({
      id: r.id,
      text: r.text || '',
      startLine: meta.startLine ?? meta.start_line ?? null,
      endLine: meta.endLine ?? meta.end_line ?? null,
      symbolType: meta.type || meta.symbolType || null,
      symbolName: meta.name || meta.symbolName || null,
    });
  }
  console.log(`  Loaded ${rows.length} chunk rows across ${byFile.size} files`);

  console.log(`Reading ${opts.input}…`);
  const data = JSON.parse(readFileSync(opts.input, 'utf-8'));
  const misses = data.misses || [];
  console.log(`  ${misses.length} miss records`);

  // The db stores paths relative to the corpus root; the records carry
  // absolute paths under eval/corpus/gencodesearchnet/. Normalize.
  const corpusRoot = path.join(__dirname, 'corpus', 'gencodesearchnet');
  const stripCorpus = (p) => {
    if (!p) return p;
    if (p.startsWith(corpusRoot + '/')) return p.slice(corpusRoot.length + 1);
    return p;
  };

  let enrichedCount = 0;
  for (const m of misses) {
    if (m.error) continue;
    // Enrich each topResult
    for (const r of m.topResults) {
      const chunks = byFile.get(stripCorpus(r.file)) || byFile.get(r.file) || [];
      r.chunks = chunks.map(c => ({
        id: c.id,
        startLine: c.startLine,
        endLine: c.endLine,
        symbolType: c.symbolType,
        symbolName: c.symbolName,
        text: snippetClean(c.text, 1200),
        textLength: c.text.length,
      }));
    }
    // Enrich expected: load file content + chunks
    for (const e of m.expected) {
      if (!e.filePath) continue;
      const chunks = byFile.get(stripCorpus(e.filePath)) || byFile.get(e.filePath) || [];
      e.chunks = chunks.map(c => ({
        id: c.id,
        startLine: c.startLine,
        endLine: c.endLine,
        symbolType: c.symbolType,
        symbolName: c.symbolName,
        text: snippetClean(c.text, 1500),
        textLength: c.text.length,
      }));
      e.indexed = chunks.length > 0;
    }
    enrichedCount++;
  }

  console.log(`Enriched ${enrichedCount}/${misses.length} miss records`);

  writeFileSync(opts.output, JSON.stringify({ ...data, enrichedAt: new Date().toISOString() }, null, 2));
  console.log(`Wrote: ${opts.output}`);

  // Quick stats: how many expected files were not indexed at all
  const notIndexed = misses.filter(m => !m.error && m.expected.some(e => !e.indexed));
  console.log(`\nExpected file not indexed (any chunk): ${notIndexed.length}`);

  // Average chunks per expected file
  const expectedChunks = misses.flatMap(m => m.error ? [] : m.expected).filter(e => e.indexed).map(e => e.chunks.length);
  if (expectedChunks.length) {
    const total = expectedChunks.reduce((a, b) => a + b, 0);
    console.log(`Avg chunks per expected file: ${(total / expectedChunks.length).toFixed(2)}`);
    console.log(`Multi-chunk expected files: ${expectedChunks.filter(n => n > 1).length}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
