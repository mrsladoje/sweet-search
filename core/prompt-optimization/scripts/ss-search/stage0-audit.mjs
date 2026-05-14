#!/usr/bin/env node
/**
 * stage0-audit.mjs — ss-search Stage 0 sweep instrumentation audit.
 *
 * Per the pre-PHASE7 handoff (2026-05-14): before any ranker work on
 * ss-search, verify how many dev FAILs are instrumentation bugs vs real
 * ranker problems. Prior sessions (ss-find, ss-semantic) both found ~30-45%
 * of dev failures were sweep instrumentation artefacts (preprocess fallback,
 * stale goldRange, runner grading bugs, AnyOf handling). High prior this
 * will show up for ss-search too.
 *
 * Checks per dev FAIL (under the agentic strategy — V7 default + V2 for
 * JS-mobile + V4 for C-family):
 *   1. Is the expectedFile indexed at all? (chunks emitted for it)
 *   2. Are there chunks OVERLAPPING the gold range (containingChunk)?
 *   3. Does any overlapping chunk have `name == expectedSymbol` (or AnyOf)?
 *   4. Top-1 file classification: doc/test/code? (file-kind intent might be
 *      mis-classifying the winning chunk as legitimately demotable)
 *   5. file_recall@5 hit: is the expected file in top-5 (rank 2-5)?
 *
 * Output:
 *   core/prompt-optimization/data/query-shapes/ss-search/failure-analysis/
 *     stage0-audit.json
 *     stage0-audit.md
 *
 * NOTE: read-only. No production code, no reindex, no LLM. Uses sqlite3 CLI
 * for DB inspection.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const SPLITS = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const REPOS_MANIFEST = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const V1_JSONL = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/tracks/track-a-phase6-redo-v1.jsonl');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-search/failure-analysis');
const OUT_JSON = path.join(OUT_DIR, 'stage0-audit.json');
const OUT_MD = path.join(OUT_DIR, 'stage0-audit.md');

const WINNERS = {
  default: 'V7',
  byFamily: { 'JS-mobile': 'V2', 'C-family': 'V4' },
};

function loadDevGolds() {
  const m = JSON.parse(fs.readFileSync(SPLITS, 'utf8'));
  const dev = new Set();
  for (const [, sp] of Object.entries(m.perLanguage || {})) {
    for (const id of sp.dev || []) dev.add(id);
  }
  return dev;
}

function loadReposManifest() {
  const m = JSON.parse(fs.readFileSync(REPOS_MANIFEST, 'utf8'));
  const map = new Map();
  for (const e of m.repos || []) map.set(e.key || e.language, e);
  return map;
}

function loadAllInputs() {
  const out = new Map();
  for (const n of fs.readdirSync(INPUTS_DIR)) {
    if (!n.endsWith('.json')) continue;
    const obj = JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, n), 'utf8'));
    if (obj.goldId) out.set(obj.goldId, obj);
  }
  return out;
}

function readJsonl(p) {
  const out = [];
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function pickWinningRow(rows, family) {
  const shape = WINNERS.byFamily[family] || WINNERS.default;
  return rows.find(r => r.shape === shape) || null;
}

// Classify a file path as code/doc/test/config based on filename + extension.
// Mirrors core/ranking/file-kind-ranking.js semantics (simplified).
const DOC_EXTS = new Set(['.md', '.rst', '.txt', '.adoc', '.mdx']);
const DOC_NAMES = new Set(['readme', 'license', 'changelog', 'contributing', 'authors', 'notice', 'copying']);
const TEST_DIRS = ['/test/', '/tests/', '__tests__', '/spec/', '/specs/'];
const TEST_FILE_RE = /\.(test|spec)\./i;
const CONFIG_EXTS = new Set(['.yml', '.yaml', '.toml', '.json', '.cfg', '.ini']);
function classifyFile(filePath) {
  if (!filePath) return 'unknown';
  const lower = filePath.toLowerCase();
  const base = path.basename(lower);
  const baseNoExt = base.replace(/\.[^.]+$/, '');
  const ext = path.extname(lower);
  if (DOC_EXTS.has(ext) || DOC_NAMES.has(baseNoExt) || lower.includes('/docs/') || lower.includes('/doc/')) return 'doc';
  if (TEST_FILE_RE.test(base) || TEST_DIRS.some(d => lower.includes(d))) return 'test';
  if (CONFIG_EXTS.has(ext)) return 'config';
  return 'code';
}

// Query codebase.db using sqlite3 CLI for the chunks of `file_path`.
function getChunksForFile(dbPath, filePath) {
  if (!fs.existsSync(dbPath)) return { error: 'db_missing', chunks: [] };
  // Use .mode tabs to avoid quoting issues; escape single quotes
  const safeFile = filePath.replace(/'/g, "''");
  const sql = `SELECT json_extract(metadata,'$.startLine'), json_extract(metadata,'$.endLine'), json_extract(metadata,'$.name'), json_extract(metadata,'$.type') FROM vectors WHERE file_path='${safeFile}' ORDER BY json_extract(metadata,'$.startLine');`;
  const res = spawnSync('sqlite3', ['-readonly', dbPath, sql], { encoding: 'utf8' });
  if (res.status !== 0) return { error: res.stderr.trim() || 'sqlite_failed', chunks: [] };
  const chunks = [];
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    const startLine = parts[0] === '' ? null : Number(parts[0]);
    const endLine = parts[1] === '' ? null : Number(parts[1]);
    const name = parts[2] || null;
    const type = parts[3] || null;
    chunks.push({ startLine, endLine, name, type });
  }
  return { chunks };
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart != null && aEnd != null && bStart != null && bEnd != null &&
    aStart <= bEnd && aEnd >= bStart;
}

function expectedSymbolsOf(input) {
  if (input.expectedSymbolAnyOf?.length) return input.expectedSymbolAnyOf;
  if (input.expectedSymbol) return [input.expectedSymbol];
  return [];
}

function main() {
  const devGolds = loadDevGolds();
  const inputs = loadAllInputs();
  const reposMap = loadReposManifest();
  const rows = readJsonl(V1_JSONL);

  const byGold = new Map();
  for (const r of rows) {
    if (!byGold.has(r.goldId)) byGold.set(r.goldId, []);
    byGold.get(r.goldId).push(r);
  }

  const audits = [];
  let countFail = 0, countPartial = 0, countPass = 0;
  const modeBuckets = {
    db_missing: 0,
    file_not_indexed: 0,
    no_chunk_overlapping_gold: 0,
    chunk_overlaps_but_name_null: 0,
    chunk_overlaps_but_name_mismatch: 0,
    chunk_overlaps_with_correct_name: 0,  // Pure ranker problem
  };
  const winnerKinds = {};
  let failRecallAt5Hits = 0;

  for (const goldId of [...devGolds].sort()) {
    const input = inputs.get(goldId);
    if (!input) continue;
    if (input.goldClass !== 'ast-tester') continue; // skip doc-positive for Stage 0
    const goldRows = byGold.get(goldId) || [];
    const row = pickWinningRow(goldRows, input.family);
    if (!row) continue;
    if (row.verdict === 'PASS') { countPass++; continue; }
    if (row.verdict === 'PARTIAL') { countPartial++; continue; }
    countFail++;

    const repoEntry = reposMap.get(input.language);
    if (!repoEntry) {
      modeBuckets.db_missing++;
      audits.push({ goldId, mode: 'db_missing', reason: `no repos.json entry for ${input.language}` });
      continue;
    }
    const dbPath = path.join(REPO_ROOT, repoEntry.localPath, '.sweet-search/codebase.db');
    const { chunks, error } = getChunksForFile(dbPath, input.expectedFile);
    if (error) {
      modeBuckets.db_missing++;
      audits.push({ goldId, mode: 'db_missing', reason: error });
      continue;
    }
    if (chunks.length === 0) {
      modeBuckets.file_not_indexed++;
      audits.push({ goldId, mode: 'file_not_indexed', expectedFile: input.expectedFile });
      continue;
    }
    const gold = input.containingChunk;
    if (!gold) {
      modeBuckets.no_chunk_overlapping_gold++;
      audits.push({ goldId, mode: 'no_chunk_overlapping_gold', reason: 'gold has no containingChunk' });
      continue;
    }
    const overlapping = chunks.filter(c => overlaps(c.startLine, c.endLine, gold.startLine, gold.endLine));
    if (overlapping.length === 0) {
      modeBuckets.no_chunk_overlapping_gold++;
      audits.push({
        goldId, language: input.language, family: input.family,
        mode: 'no_chunk_overlapping_gold',
        expectedFile: input.expectedFile,
        expectedSymbol: input.expectedSymbol,
        goldRange: `${gold.startLine}-${gold.endLine}`,
        nearbyChunks: chunks
          .filter(c => Math.abs((c.startLine || 0) - gold.startLine) <= 50 || Math.abs((c.endLine || 0) - gold.endLine) <= 50)
          .slice(0, 5),
      });
      continue;
    }
    const expSyms = expectedSymbolsOf(input);
    const hasCorrectName = overlapping.some(c => c.name && expSyms.includes(c.name));
    const allNullNames = overlapping.every(c => !c.name);
    let mode;
    if (hasCorrectName) mode = 'chunk_overlaps_with_correct_name';
    else if (allNullNames) mode = 'chunk_overlaps_but_name_null';
    else mode = 'chunk_overlaps_but_name_mismatch';
    modeBuckets[mode]++;

    const winnerKind = classifyFile(row.top1?.file);
    winnerKinds[winnerKind] = (winnerKinds[winnerKind] || 0) + 1;

    if (row.fileRecallAt5 === 1) failRecallAt5Hits++;

    audits.push({
      goldId, language: input.language, family: input.family, shape: row.shape,
      mode,
      expectedFile: input.expectedFile,
      expectedSymbol: input.expectedSymbol,
      expectedSymbolAnyOf: input.expectedSymbolAnyOf || null,
      goldRange: `${gold.startLine}-${gold.endLine}`,
      overlappingChunks: overlapping.map(c => ({
        range: `${c.startLine}-${c.endLine}`,
        name: c.name,
        type: c.type,
      })),
      top1: row.top1,
      top1Kind: winnerKind,
      fileRecallAt5: row.fileRecallAt5,
      query: row.query,
    });
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: 'DEV only, ast-tester only, strategy=agentic (V7 default, V2 JS-mobile, V4 C-family)',
    counts: { PASS: countPass, PARTIAL: countPartial, FAIL: countFail },
    failModes: modeBuckets,
    failWinnerKinds: winnerKinds,
    failRecallAt5: { hits: failRecallAt5Hits, fails: countFail, pct: countFail ? +(failRecallAt5Hits / countFail * 100).toFixed(1) : 0 },
    audits,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));

  // Markdown summary
  const lines = [];
  lines.push('# ss-search Stage 0 instrumentation audit');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push(`Dev golds graded (ast-tester only, agentic strategy): ${countPass + countPartial + countFail}`);
  lines.push(`- PASS:    ${countPass}`);
  lines.push(`- PARTIAL: ${countPartial}`);
  lines.push(`- FAIL:    ${countFail}`);
  lines.push('');
  lines.push('## Fail-mode classification');
  lines.push('');
  lines.push('| Mode | Count | % of FAILs |');
  lines.push('|---|---|---|');
  for (const [k, v] of Object.entries(modeBuckets)) {
    const pct = countFail ? (v / countFail * 100).toFixed(1) : 0;
    lines.push(`| ${k} | ${v} | ${pct}% |`);
  }
  lines.push('');
  lines.push('## Top-1 file kind (when FAIL)');
  lines.push('');
  for (const [k, v] of Object.entries(winnerKinds).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push('');
  lines.push(`## fileRecallAt5 on FAILs: ${failRecallAt5Hits}/${countFail} = ${summary.failRecallAt5.pct}%`);
  lines.push('');
  lines.push('## Per-FAIL detail');
  lines.push('');
  for (const a of audits) {
    lines.push(`### ${a.goldId} (${a.language}/${a.family}, shape=${a.shape || 'n/a'})`);
    lines.push(`- mode: **${a.mode}**`);
    if (a.expectedFile) lines.push(`- expected: \`${a.expectedFile}\` :: \`${a.expectedSymbol}\`${a.expectedSymbolAnyOf ? ` (anyOf=${a.expectedSymbolAnyOf.length})` : ''}`);
    if (a.goldRange) lines.push(`- gold range: ${a.goldRange}`);
    if (a.overlappingChunks?.length) {
      lines.push(`- chunks overlapping gold:`);
      for (const c of a.overlappingChunks) lines.push(`  - ${c.range} name=${c.name ?? '(null)'} type=${c.type ?? ''}`);
    }
    if (a.top1) lines.push(`- top1: \`${a.top1.file}\` :: \`${a.top1.symbol}\` (${a.top1.startLine}-${a.top1.endLine}, kind=${a.top1Kind}, score=${a.top1.score?.toFixed?.(3)})`);
    if (a.fileRecallAt5 !== undefined) lines.push(`- fileRecallAt5: ${a.fileRecallAt5}`);
    if (a.query) lines.push(`- query: \`${a.query}\``);
    lines.push('');
  }

  fs.writeFileSync(OUT_MD, lines.join('\n'));

  // Console summary
  process.stdout.write(`\nWrote ${path.relative(REPO_ROOT, OUT_JSON)}\n`);
  process.stdout.write(`Wrote ${path.relative(REPO_ROOT, OUT_MD)}\n\n`);
  process.stdout.write(`=== ss-search Stage 0 audit summary ===\n`);
  process.stdout.write(`  dev ast-tester golds: ${countPass + countPartial + countFail}\n`);
  process.stdout.write(`  PASS=${countPass} PARTIAL=${countPartial} FAIL=${countFail}\n\n`);
  process.stdout.write(`  Fail modes:\n`);
  for (const [k, v] of Object.entries(modeBuckets)) {
    const pct = countFail ? (v / countFail * 100).toFixed(1) : 0;
    process.stdout.write(`    ${k.padEnd(38)} ${String(v).padStart(3)}  ${pct.padStart(5)}%\n`);
  }
  process.stdout.write(`\n  Top-1 file kind (FAIL):\n`);
  for (const [k, v] of Object.entries(winnerKinds).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`    ${k.padEnd(10)} ${String(v).padStart(3)}\n`);
  }
  process.stdout.write(`\n  fileRecallAt5 on FAILs: ${failRecallAt5Hits}/${countFail} = ${summary.failRecallAt5.pct}%\n`);
}

main();
