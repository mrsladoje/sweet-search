#!/usr/bin/env node
/**
 * Mode F deep-dive: for the 6 "right file, wrong chunk" dev failures, dump
 * top-5 patternSearch results and check whether the expected chunk is even a
 * candidate. The classification we need:
 *
 *   - target chunk in candidates but ranked < 1   → MaxSim ranker issue
 *   - target chunk not in candidates at all       → chunker/regex issue
 *                                                    (regex didn't pull it
 *                                                    in, OR the chunker
 *                                                    didn't emit it as a
 *                                                    discrete chunk)
 *
 * Reuses the exact runner setup from `track-a-runner-ss-find.mjs` so the
 * results match what was recorded in track-a-phase6-redo-ss-find-v1.jsonl.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SweetSearch } from '../../search-runtime.mjs';
import { ensurePatternSearchLocationMap } from './track-a-runner-ss-find.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

// The 6 Mode F suspects identified in stage3-taxonomy.md plus 3 "real tool
// residual" cases to sanity-check the categorisation.
const SUSPECTS = [
  { id: 'TS-008',  lang: 'typescript',     label: 'systemPrompt vs regularPrompt (same file)' },
  { id: 'TSL-001', lang: 'typescript-lib', label: 'safeParse vs parseAsync (same file)' },
  { id: 'JV-004',  lang: 'java',           label: 'getType vs TypeToken class header (same file)' },
  { id: 'LU-003',  lang: 'lua',            label: 'tablex.deepcopy vs cycle_aware_copy (same file)' },
  { id: 'LU-004',  lang: 'lua',            label: 'List insert vs List.range (same file)' },
  { id: 'PY-002',  lang: 'python',         label: 'Context class vs make_context (same file)' },
];

const FAILURES_PATH = path.join(
  REPO_ROOT,
  'core/prompt-optimization/data/query-shapes/ss-find/failure-analysis/dev-failures.jsonl',
);
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');

const reposMap = new Map();
{
  const reposJson = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  for (const r of reposJson.repos || reposJson) reposMap.set(r.probePack || r.language, r);
}

const failures = fs.readFileSync(FAILURES_PATH, 'utf8')
  .split('\n').filter(Boolean).map((s) => JSON.parse(s));
const byId = new Map(failures.map((r) => [`${r.language}:${r.goldId}`, r]));

function loadInput(language, goldId) {
  const p = path.join(INPUTS_DIR, `${language}-${goldId}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function runOne(suspect) {
  const key = `${suspect.lang}:${suspect.id}`;
  const row = byId.get(key);
  if (!row) {
    console.log(`\n=== ${suspect.id} (${suspect.lang}) — NOT FOUND in dev-failures.jsonl`);
    return;
  }
  const input = loadInput(suspect.lang, suspect.id);
  const repoEntry = reposMap.get(suspect.lang);
  if (!repoEntry) {
    console.log(`\n=== ${suspect.id} — NO repos.json entry for ${suspect.lang}`);
    return;
  }
  const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
  const dataDir = path.join(projectRoot, '.sweet-search');

  const searcher = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
    lateInteractionOptions: { indexPath: path.join(dataDir, 'codebase-late-interaction.db') },
  });
  await searcher.init();
  await ensurePatternSearchLocationMap(searcher);

  console.log(`\n=== ${suspect.id} (${suspect.lang}) — ${suspect.label} ===`);
  console.log(`  expectedFile:    ${input.expectedFile}`);
  console.log(`  expectedSymbol:  ${input.expectedSymbol}`);
  console.log(`  regex:           ${row.regex}`);
  console.log(`  query:           ${JSON.stringify(row.query)}`);

  let resp;
  try {
    resp = await searcher.patternSearch(row.query, {}, {
      regex: row.regex, format: 'agent', k: 10,
    });
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    try { searcher.close(); } catch { /* ignore */ }
    return;
  }
  const results = resp?.results || [];
  console.log(`  → ${results.length} results returned (top-10):`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const f = r.file || r.metadata?.file || '<?>';
    const s = r.symbol || r.name || r.metadata?.symbol || '<?>';
    const sl = r.startLine ?? r.metadata?.line_start ?? '?';
    const el = r.endLine ?? r.metadata?.line_end ?? '?';
    const score = (r.score ?? 0).toFixed(4);
    const presentation = r.presentation || r.metadata?.presentation || '';
    const fileHit = f === input.expectedFile ? ' ✓F' : '';
    const symHit = s === input.expectedSymbol ? ' ✓S' : '';
    console.log(`    #${(i + 1).toString().padStart(2)} [${score}] ${f}:${sl}-${el} (${presentation}) symbol=${s}${fileHit}${symHit}`);
  }
  // Sanity check: does the expected symbol appear anywhere as a chunk in the
  // index? Search LI directly by scanning documents for the matching file +
  // line range.
  const idx = searcher.lateInteractionIndex;
  if (idx?.documents) {
    const candidateChunks = [];
    for (const [id, doc] of idx.documents) {
      const f = doc.metadata?.file;
      if (f !== input.expectedFile) continue;
      const text = doc.text || doc.content || '';
      const lineStart = doc.metadata?.startLine ?? doc.metadata?.line_start;
      const lineEnd = doc.metadata?.endLine ?? doc.metadata?.line_end;
      // "owns the symbol" heuristic: text contains expectedSymbol as a token.
      // This isn't perfect (could be a comment) but flags candidates worth
      // inspecting.
      const containsSym = text && new RegExp(`\\b${input.expectedSymbol.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}\\b`).test(text);
      if (containsSym) candidateChunks.push({ id, lineStart, lineEnd, len: text.length });
    }
    console.log(`  → chunks in expectedFile containing expectedSymbol: ${candidateChunks.length}`);
    for (const c of candidateChunks.slice(0, 10)) {
      const inTopK = results.findIndex((r) => {
        const f = r.file || r.metadata?.file;
        const sl = r.startLine ?? r.metadata?.line_start;
        return f === input.expectedFile && sl === c.lineStart;
      });
      const rankNote = inTopK >= 0 ? `RANK #${inTopK + 1}` : 'NOT in top-10';
      console.log(`    chunk ${c.id}  lines=${c.lineStart}-${c.lineEnd}  textLen=${c.len}  → ${rankNote}`);
    }
  }
  try { searcher.close(); } catch { /* ignore */ }
}

async function main() {
  for (const s of SUSPECTS) {
    try { await runOne(s); }
    catch (e) { console.log(`  ! ${s.id} crashed: ${e.message}`); }
  }
}
main().catch((err) => { process.stderr.write(`mode-f-deepdive: fatal ${err.stack || err.message}\n`); process.exit(1); });
