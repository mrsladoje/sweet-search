#!/usr/bin/env node
/**
 * IAR ablation diagnostic: run each probe with IAR ON and IAR OFF,
 * record top-5 candidate diff per probe.
 *
 * Output: scripts/iar-ablation-{ts}.json with:
 *   results[].id, query, repo, on:[{file,name,score,_anchorInjected,...}], off:[...]
 *   verdicts[].id, on, off, transition
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SweetSearch } from '../core/search/sweet-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROBES = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/retrieval-probes/probes.json'), 'utf8')).probes;

function gradeProbe(probe, top1) {
  if (!top1) return 'FAIL';
  const file = top1.file || top1.metadata?.file || '';
  const sym = top1.symbol || top1.name || top1.metadata?.name || '';
  const type = top1.symbolType || top1.type || top1.metadata?.type || '';
  const wantFiles = probe.expectedFile ? [probe.expectedFile] : (probe.expectedFileAnyOf || null);
  const wantSymbols = probe.expectedSymbol ? [probe.expectedSymbol] : (probe.expectedSymbolAnyOf || null);
  const wantTypes = probe.expectedSymbolType ? [probe.expectedSymbolType] : (probe.expectedSymbolTypeAnyOf || null);
  const fileMatch = !wantFiles || wantFiles.some(w => file === w || file.endsWith('/' + w) || file.endsWith(w));
  const symbolMatch = !wantSymbols || wantSymbols.some(w => String(sym).toLowerCase() === String(w).toLowerCase());
  const typeMatch = !wantTypes || wantTypes.some(w => String(type).toLowerCase() === String(w).toLowerCase());
  if (fileMatch && symbolMatch && typeMatch) return 'PASS';
  if (fileMatch) return 'PARTIAL';
  return 'FAIL';
}

function pickTop(top, n = 5) {
  return (top || []).slice(0, n).map(r => ({
    file: r.file || r.metadata?.file,
    name: r.name || r.metadata?.name,
    type: r.type || r.metadata?.type,
    startLine: r.startLine ?? r.metadata?.startLine,
    endLine: r.endLine ?? r.metadata?.endLine,
    score: Number((r.score || 0).toFixed(4)),
    anchorInjected: !!r._anchorInjected,
    anchorBoosted: !!r._anchorBoosted,
    anchorEntity: r._anchorEntity || null,
    searchPath: r.searchPath || null,
  }));
}

async function runOne(searcher, probe, ablations) {
  try {
    const response = await searcher.search(probe.query, {
      format: 'agent',
      k: 10,
      ablations,
    });
    const results = response?.results || [];
    return { ok: true, top: pickTop(results, 5), verdict: gradeProbe(probe, results[0] || null), n: results.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const byRepo = new Map();
  for (const p of PROBES) {
    if (!byRepo.has(p.repo)) byRepo.set(p.repo, []);
    byRepo.get(p.repo).push(p);
  }

  const all = [];
  for (const [repo, list] of byRepo.entries()) {
    const projectRoot = path.join(ROOT, 'eval/repos', repo);
    if (!fs.existsSync(projectRoot)) {
      console.error(`[skip] ${repo}: no repo dir`);
      continue;
    }
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
    process.stdout.write(`\n=== ${repo} (${list.length} probes) ===\n`);
    for (const probe of list) {
      const off = await runOne(searcher, probe, new Set(['no-anchor-injection']));
      const on = await runOne(searcher, probe, new Set());
      let transition = 'unchanged';
      if (on.verdict !== off.verdict) transition = `${off.verdict}→${on.verdict}`;
      const row = { id: probe.id, repo, query: probe.query, off, on, transition };
      all.push(row);
      const tag = transition === 'unchanged' ? '·' : (on.verdict === 'PASS' ? '↑' : (off.verdict === 'PASS' ? '↓' : '~'));
      process.stdout.write(`  ${tag} ${probe.id.padEnd(8)} off=${off.verdict || 'ERR'} on=${on.verdict || 'ERR'} transition=${transition}\n`);
    }
    try { searcher.close(); } catch {}
  }

  // Summary
  const byTransition = {};
  for (const r of all) {
    byTransition[r.transition] = (byTransition[r.transition] || 0) + 1;
  }
  process.stdout.write(`\n=== Transitions (off → on) ===\n`);
  for (const [t, n] of Object.entries(byTransition)) {
    process.stdout.write(`  ${t}: ${n}\n`);
  }

  const offVerdicts = { PASS: 0, PARTIAL: 0, FAIL: 0 };
  const onVerdicts = { PASS: 0, PARTIAL: 0, FAIL: 0 };
  for (const r of all) {
    if (r.off.verdict) offVerdicts[r.off.verdict]++;
    if (r.on.verdict) onVerdicts[r.on.verdict]++;
  }
  process.stdout.write(`\n=== Aggregate ===\n  IAR OFF: ${JSON.stringify(offVerdicts)}\n  IAR ON:  ${JSON.stringify(onVerdicts)}\n`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(ROOT, 'scripts', `iar-ablation-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ ts, byTransition, offVerdicts, onVerdicts, results: all }, null, 2));
  process.stdout.write(`\nSaved: ${outPath}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
