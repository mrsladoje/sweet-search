#!/usr/bin/env node
/**
 * Find "embedding-attractor" files in GCSN miss data.
 *
 * Counts how often each file surfaces as top1 / top3 across queries
 * whose gold lives elsewhere (i.e., the file is winning queries it
 * has no business winning).
 *
 * Outputs a markdown report classifying suspect attractors by:
 *   - top1 dominance count (across queries with different gold)
 *   - top3 dominance count
 *   - distinct query languages it surfaces for
 *   - file kind (vendor/test/generated/large/normal) — heuristic on path
 *
 * Usage:
 *   node eval/miss-analysis/find_attractors.js
 *   node eval/miss-analysis/find_attractors.js --records=path/to/records.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    records: path.join(__dirname, 'gencodesearchnet_records.json'),
    out: path.join(__dirname, 'gcsn_attractors.md'),
    languages: ['javascript', 'ruby'],
    minTop1: 3,    // file must appear as top1 across at least N queries to be suspicious
    minTop3: 5,    // … or top3 across at least N queries
    sample: 5,     // representative queries per attractor in report
  };
  for (const a of args) {
    if (a.startsWith('--records=')) opts.records = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.split('=')[1]);
    else if (a.startsWith('--languages=')) opts.languages = a.split('=')[1].split(',');
    else if (a.startsWith('--min-top1=')) opts.minTop1 = parseInt(a.split('=')[1]);
    else if (a.startsWith('--min-top3=')) opts.minTop3 = parseInt(a.split('=')[1]);
    else if (a.startsWith('--sample=')) opts.sample = parseInt(a.split('=')[1]);
  }
  return opts;
}

function classifyPath(p) {
  if (!p) return 'unknown';
  const lower = p.toLowerCase();
  if (lower.includes('/vendor/') || lower.includes('node_modules/') || lower.includes('/third_party/')) return 'vendor';
  if (lower.includes('/test/') || lower.includes('/tests/') || lower.endsWith('.test.js') || lower.endsWith('_test.go') || lower.endsWith('test.py') || lower.endsWith('_spec.rb')) return 'test';
  if (lower.includes('/dist/') || lower.includes('/build/') || lower.endsWith('.min.js') || lower.endsWith('.bundle.js')) return 'generated';
  if (lower.endsWith('.md') || lower.endsWith('.rst')) return 'docs';
  if (lower.endsWith('.d.ts')) return 'typedef';
  return 'normal';
}

function bucketScore(file, sizeBytes) {
  // Size signal: very large chunks tend to attract (more terms cover more queries).
  if (sizeBytes > 8000) return 'large_chunk';
  if (sizeBytes > 4000) return 'mid_chunk';
  return 'normal_chunk';
}

async function main() {
  const opts = parseArgs();
  if (!fs.existsSync(opts.records)) {
    console.error(`records not found: ${opts.records}`);
    console.error('Run trace_gcsn_misses.js first.');
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(opts.records, 'utf-8'));
  const records = data.records || [];

  const langSet = new Set(opts.languages);

  // Per-file aggregations:
  // file -> { top1: [{queryId, language, query, goldFile, isCorrect}], top3: [...] }
  const agg = new Map();

  for (const r of records) {
    if (r.error) continue;
    if (langSet.size > 0 && !langSet.has(r.language)) continue;

    // Only care about queries the model GOT WRONG. Otherwise top1 == gold and is correct.
    if (r.bucket === 'hit_top1') continue;

    const goldBase = new Set((r.expected || []).map(e => e.filePath ? path.basename(e.filePath) : null).filter(Boolean));
    const goldFull = (r.expected || []).map(e => e.filePath || '').filter(Boolean);

    const top10 = r.top10 || [];
    const top1File = top10[0]?.file;
    if (top1File) {
      const isCorrect = goldBase.has(path.basename(top1File));
      if (!isCorrect) {
        if (!agg.has(top1File)) agg.set(top1File, { top1: [], top3: [] });
        agg.get(top1File).top1.push({
          queryId: r.queryId,
          language: r.language,
          query: r.query,
          goldFile: goldFull[0] || null,
          score: top10[0].score,
        });
      }
    }
    for (const t of top10.slice(0, 3)) {
      if (!t.file) continue;
      const isCorrect = goldBase.has(path.basename(t.file));
      if (isCorrect) continue;
      if (!agg.has(t.file)) agg.set(t.file, { top1: [], top3: [] });
      // avoid double-counting top1 inside top3
      if (t === top10[0]) continue;
      agg.get(t.file).top3.push({
        queryId: r.queryId,
        language: r.language,
        query: r.query,
        goldFile: goldFull[0] || null,
        score: t.score,
      });
    }
  }

  // Sort: prioritize top1 count then top3 count.
  const ranked = [...agg.entries()]
    .map(([file, data]) => {
      const top1 = data.top1;
      const top3 = data.top3;
      const allEvents = [...top1, ...top3];
      const langs = new Set(allEvents.map(e => e.language));
      const queries = new Set(allEvents.map(e => e.queryId));
      const goldFiles = new Set(allEvents.map(e => e.goldFile).filter(Boolean));
      return {
        file,
        top1Count: top1.length,
        top3Count: top3.length,
        languages: [...langs],
        distinctQueries: queries.size,
        distinctGold: goldFiles.size,
        events: allEvents,
        kind: classifyPath(file),
      };
    })
    .filter(r => r.top1Count >= opts.minTop1 || r.top3Count >= opts.minTop3)
    .sort((a, b) => (b.top1Count - a.top1Count) || (b.top3Count - a.top3Count));

  // Build markdown report
  const lines = [];
  lines.push(`# GCSN JavaScript/Ruby Attractor Analysis`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Languages scanned: ${opts.languages.join(', ')}`);
  lines.push(`Threshold: top1 across ≥${opts.minTop1} unrelated queries OR top3 across ≥${opts.minTop3} unrelated queries`);
  lines.push('');
  lines.push(`Total queries scanned: ${records.filter(r => !r.error && langSet.has(r.language)).length}`);
  lines.push(`Misses (non-top1) scanned: ${records.filter(r => !r.error && langSet.has(r.language) && r.bucket !== 'hit_top1').length}`);
  lines.push(`Distinct files surfacing in top1/top3 of misses: ${agg.size}`);
  lines.push(`Suspect attractors (above threshold): **${ranked.length}**`);
  lines.push('');

  // Try to load chunk counts for each attractor file from the codebase.db so the
  // report can directly call out chunking pathologies. This is best-effort —
  // skip silently if the DB isn't present.
  const dbPath = path.join(__dirname, '..', 'corpus', 'gencodesearchnet', '.sweet-search', 'codebase.db');
  let chunkCounts = new Map(); // file_path -> chunk count
  let totalChunks = null;
  if (fs.existsSync(dbPath)) {
    try {
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const filePaths = ranked.map(a => a.file);
      if (filePaths.length > 0) {
        const ph = filePaths.map(() => '?').join(',');
        const rows = db.prepare(`SELECT file_path, COUNT(*) as n FROM vectors WHERE file_path IN (${ph}) GROUP BY file_path`).all(...filePaths);
        for (const r of rows) chunkCounts.set(r.file_path, r.n);
      }
      totalChunks = db.prepare('SELECT COUNT(*) as n FROM vectors').get().n;
      db.close();
    } catch (err) {
      // ignore — report just won't have chunk counts.
    }
  }

  // Per-attractor classification + summary table
  if (totalChunks != null) {
    lines.push(`## Index footprint`);
    lines.push('');
    lines.push(`Total chunks in GCSN index: ${totalChunks}`);
    lines.push('');
  }
  lines.push('## Attractor table');
  lines.push('');
  lines.push('| rank | file | path-kind | chunks | % index | top1 | top3 | langs | distinct gold |');
  lines.push('|---:|---|---|---:|---:|---:|---:|---|---:|');
  for (let i = 0; i < ranked.length; i++) {
    const a = ranked[i];
    const cn = chunkCounts.get(a.file);
    const cs = cn != null ? String(cn) : '?';
    const sh = (cn != null && totalChunks) ? `${(100*cn/totalChunks).toFixed(2)}%` : '—';
    lines.push(`| ${i+1} | \`${path.basename(a.file)}\` | ${a.kind} | ${cs} | ${sh} | ${a.top1Count} | ${a.top3Count} | ${a.languages.join(',')} | ${a.distinctGold} |`);
  }
  lines.push('');
  lines.push('Full path key:');
  lines.push('');
  for (let i = 0; i < ranked.length; i++) {
    lines.push(`${i+1}. \`${ranked[i].file}\``);
  }
  lines.push('');

  // Detailed view of top N attractors
  lines.push('## Top attractor details');
  lines.push('');
  for (let i = 0; i < Math.min(ranked.length, 10); i++) {
    const a = ranked[i];
    lines.push(`### #${i+1}  \`${a.file}\``);
    lines.push('');
    lines.push(`- path-kind: **${a.kind}**`);
    lines.push(`- top1 count: ${a.top1Count}, top3 count: ${a.top3Count}`);
    lines.push(`- languages: ${a.languages.join(', ')}`);
    lines.push(`- distinct queries: ${a.distinctQueries}, distinct gold files: ${a.distinctGold}`);
    lines.push('');
    const sampleEvents = a.events.slice(0, opts.sample);
    lines.push('Representative misses:');
    lines.push('');
    for (const ev of sampleEvents) {
      const q = (ev.query || '').replace(/\s+/g, ' ').slice(0, 110);
      lines.push(`- \`${ev.queryId}\` (${ev.language}, score=${(ev.score||0).toFixed(3)}) — query: *"${q}"* — gold: \`${ev.goldFile ? path.basename(ev.goldFile) : '?'}\``);
    }
    lines.push('');
  }

  // Write
  fs.writeFileSync(opts.out, lines.join('\n'));
  console.log(`wrote ${opts.out}`);
  console.log(`suspect attractors: ${ranked.length}`);
  for (const a of ranked.slice(0, 8)) {
    console.log(`  top1=${a.top1Count} top3=${a.top3Count} ${a.kind} ${path.basename(a.file)}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
