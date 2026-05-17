#!/usr/bin/env node
/**
 * stage3-top5-deepdive.mjs — re-run ss-search for the 21 dev FAILs under
 * the agentic strategy (V7 default / V2 JS-mobile / V4 C-family) and capture
 * top-5 so we can identify what's beating each gold.
 *
 * Per Stage 0's finding (0 instrumentation bugs, 15 pure ranker), this gives
 * us the actual top-5 needed to design ranker fixes. The v1 JSONL only
 * stores top-1.
 *
 * Output:
 *   core/prompt-optimization/data/query-shapes/ss-search/failure-analysis/
 *     stage3-top5-failures.jsonl
 *     stage3-top5-summary.md
 *
 * Read-only on the index. Uses the same searcher invocation as track-a-runner.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SweetSearch } from '../../search-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SPLITS = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const REPOS_MANIFEST = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const V1_JSONL = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/tracks/track-a-phase6-redo-v1.jsonl');
const OUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-search/failure-analysis');

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
function loadInputs() {
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
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

async function main() {
  const dev = loadDevGolds();
  const reposMap = loadReposManifest();
  const inputs = loadInputs();
  const rows = readJsonl(V1_JSONL);

  // Pick winning row per dev gold
  const targets = [];
  const byGold = new Map();
  for (const r of rows) {
    if (!byGold.has(r.goldId)) byGold.set(r.goldId, []);
    byGold.get(r.goldId).push(r);
  }
  for (const goldId of dev) {
    const input = inputs.get(goldId);
    if (!input || input.goldClass !== 'ast-tester') continue;
    const shape = WINNERS.byFamily[input.family] || WINNERS.default;
    const r = (byGold.get(goldId) || []).find(x => x.shape === shape);
    if (!r) continue;
    if (r.verdict !== 'FAIL') continue;
    targets.push({ goldId, input, row: r });
  }

  process.stdout.write(`stage3-top5: ${targets.length} dev FAIL cases to re-query\n`);

  // Group by language
  const byLang = new Map();
  for (const t of targets) {
    if (!byLang.has(t.input.language)) byLang.set(t.input.language, []);
    byLang.get(t.input.language).push(t);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'stage3-top5-failures.jsonl');
  const out = fs.createWriteStream(outPath, { flags: 'w' });

  const summary = [];
  for (const [language, lst] of byLang.entries()) {
    const repoEntry = reposMap.get(language);
    if (!repoEntry) continue;
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    const dataDir = path.join(projectRoot, '.sweet-search');
    if (!fs.existsSync(dataDir)) {
      process.stderr.write(`  ! .sweet-search missing for ${language}; skip\n`);
      continue;
    }
    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: path.join(dataDir, 'code-graph.db'),
      codebaseDbPath: path.join(dataDir, 'codebase.db'),
      hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
      binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
      sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
      lateInteractionOptions: {
        indexPath: path.join(dataDir, 'codebase-late-interaction.db'),
      },
    });
    await searcher.init();
    process.stdout.write(`=== ${language} (${lst.length}) ===\n`);
    for (const t of lst) {
      const resp = await searcher.search(t.row.query, { format: 'agent', k: 10, graphExpand: '2hop', adaptiveHop2: true });
      const top5 = (resp?.results || []).slice(0, 5).map(r => ({
        file: r.file || r.metadata?.file,
        symbol: r.symbol || r.name || r.metadata?.name || null,
        startLine: r.startLine ?? r.metadata?.startLine ?? null,
        endLine: r.endLine ?? r.metadata?.endLine ?? null,
        score: r.score ?? null,
        searchPath: r.searchPath || null,
        presentation: r.presentation || r.metadata?.presentation || null,
      }));
      // Is expected file/symbol in top-5 and at what rank?
      const expFiles = t.input.expectedFileAnyOf?.length ? t.input.expectedFileAnyOf : [t.input.expectedFile];
      const expSyms = t.input.expectedSymbolAnyOf?.length ? t.input.expectedSymbolAnyOf : (t.input.expectedSymbol ? [t.input.expectedSymbol] : []);
      let expectedFileRank = null;
      let expectedSymbolRank = null;
      for (let i = 0; i < top5.length; i++) {
        if (expectedFileRank == null && expFiles.includes(top5[i].file)) expectedFileRank = i + 1;
        if (expectedSymbolRank == null && expFiles.includes(top5[i].file) && expSyms.includes(top5[i].symbol)) expectedSymbolRank = i + 1;
      }
      const rec = {
        goldId: t.goldId, language, family: t.input.family,
        shape: t.row.shape, query: t.row.query,
        expectedFile: t.input.expectedFile,
        expectedSymbol: t.input.expectedSymbol,
        goldRange: t.input.containingChunk ? `${t.input.containingChunk.startLine}-${t.input.containingChunk.endLine}` : null,
        top5,
        expectedFileRank,
        expectedSymbolRank,
      };
      out.write(JSON.stringify(rec) + '\n');
      summary.push(rec);
      process.stdout.write(`  ${t.goldId} expFile@${expectedFileRank ?? '>5'} expSym@${expectedSymbolRank ?? 'never'}: top1=${top5[0]?.file}::${top5[0]?.symbol}\n`);
    }
    try { searcher.close(); } catch { /* */ }
  }
  await new Promise(res => out.end(res));

  // Markdown summary
  const lines = [];
  lines.push('# ss-search Stage 3 top-5 deep dive');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`${summary.length} dev FAILs re-queried under their agentic winning shape.`);
  lines.push('');
  for (const r of summary) {
    lines.push(`## ${r.goldId} (${r.language}/${r.family}, shape=${r.shape})`);
    lines.push(`- query: \`${r.query}\``);
    lines.push(`- expected: \`${r.expectedFile}\` :: \`${r.expectedSymbol}\` (gold range ${r.goldRange})`);
    lines.push(`- expectedFileRank: ${r.expectedFileRank ?? '>5'}; expectedSymbolRank: ${r.expectedSymbolRank ?? 'never'}`);
    lines.push(`- top-5:`);
    for (let i = 0; i < r.top5.length; i++) {
      const t = r.top5[i];
      lines.push(`  ${i + 1}. \`${t.file}\` :: \`${t.symbol ?? '(null)'}\` lines ${t.startLine}-${t.endLine} score=${t.score?.toFixed?.(3)} path=${t.searchPath ?? ''}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'stage3-top5-summary.md'), lines.join('\n'));
  process.stdout.write(`\nWrote ${path.relative(REPO_ROOT, outPath)} and stage3-top5-summary.md\n`);
}

main().catch(err => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });
