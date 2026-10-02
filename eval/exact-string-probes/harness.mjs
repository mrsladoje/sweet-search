// DEV-only A/B harness for the body-text lexical channel.
// Every arm runs on the SAME temp-copy index (chunk_text_fts present); arms
// differ only in SWEET_SEARCH_BODY_LEXICAL (and its knobs), read per query.
// Usage: node harness.mjs <probes|r3|exact|d23> <k> <out.jsonl> <armsJson>
process.env.SWEET_SEARCH_VOCAB_USE = '0';
process.env.SWEET_SEARCH_VOCAB_AUTO_EXPAND = '0';
import fs from 'node:fs';
import path from 'node:path';

const WT = process.env.WT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
// Temp copies of the indexed repos (never the eval/repos indexes).
const R3_BASE = process.env.R3_BASE || '/private/tmp/claude-501/bodyfts/repos';
const PROBE_BASE = process.env.PROBE_BASE || '/private/tmp/claude-501/bodyfts/probe-repos';
const [set, kArg, outPath, armsArg] = process.argv.slice(2);
const K = Number(kArg);
const ARMS = JSON.parse(armsArg); // { name: { env: {...} } }

async function makeSearcher(projectRoot) {
  const { SweetSearch } = await import(path.join(WT, 'core/search/sweet-search.js'));
  const dataDir = path.join(projectRoot, '.sweet-search');
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c, ...r) => process.stderr.write(c, ...r);
  const s = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
    lateInteractionOptions: { indexPath: path.join(dataDir, 'codebase-late-interaction.db') },
  });
  try { await s.init(); } finally { process.stdout.write = origWrite; }
  return s;
}
async function ssSearch(s, query, k) {
  const { LATE_INTERACTION_CONFIG } = await import(path.join(WT, 'core/infrastructure/config/index.js'));
  return s.search(query, {
    k, mode: 'auto', expand: true, rerank: true, fusion: 'cc',
    useLateInteraction: LATE_INTERACTION_CONFIG.enabled,
    _isAgentFormat: true, _siblingLine: true, format: 'agent',
  });
}

function normp(p) { p = String(p || '').trim().replace(/^['"`]|['"`]$/g, ''); while (p.startsWith('./')) p = p.slice(2); return p; }
function items() {
  if (set === 'probes') {
    const probes = JSON.parse(fs.readFileSync(path.join(WT, 'eval/retrieval-probes/probes.json'), 'utf8')).probes;
    const dev = new Set(JSON.parse(fs.readFileSync(path.join(WT, 'eval/splits/retrieval-probes/dev.json'), 'utf8')).ids);
    return probes.filter(p => dev.has(p.id)).map(p => ({ ...p, kind: 'probe', base: PROBE_BASE }));
  }
  if (set === 'exact') {
    const d = JSON.parse(fs.readFileSync(process.env.EXACT_SET || path.join(WT, 'eval/exact-string-probes/dev-seed42.json'), 'utf8'));
    return d.items.map(it => ({ ...it, kind: 'exact', base: PROBE_BASE }));
  }
  if (set === 'd23') {
    return [
      { id: 'd23-error-text', repo: 'r3-dgraph', query: 'pending transactions found please retry operation', kind: 'd23', base: R3_BASE },
      { id: 'd23-question', repo: 'r3-dgraph', query: 'mark pending transaction aborted when predicate is being moved or dropped', kind: 'd23', base: R3_BASE },
    ];
  }
  const dir = path.join(WT, 'core/prompt-optimization/data/final-tuning/r3');
  const out = [];
  for (const f of ['r3-probes.json', 'r3-hard-probes.json']) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const p of (Array.isArray(d) ? d : d.probes)) {
      if (p.set !== 'dev') continue; // DEV ONLY
      const gold = (p.expectedFiles || []).map(normp).filter(Boolean);
      if (gold.length) out.push({ id: p.id, repo: p.repo, query: p.query, gold, kind: 'r3', base: R3_BASE });
    }
  }
  return out;
}
const arr = v => (v == null ? null : (Array.isArray(v) ? v : [v]));
function grade(p, t) {
  if (!t) return 'FAIL';
  const wf = arr(p.expectedFile) || arr(p.expectedFileAnyOf);
  const ws = arr(p.expectedSymbol) || arr(p.expectedSymbolAnyOf);
  const wt = arr(p.expectedSymbolType) || arr(p.expectedSymbolTypeAnyOf);
  const f = t.file || '';
  const fm = !wf || wf.some(w => f === w || f.endsWith('/' + w) || f.endsWith(w));
  const sm = !ws || ws.some(w => String(t.symbol || '').toLowerCase() === String(w).toLowerCase());
  const tm = !wt || wt.some(w => String(t.symbolType || '').toLowerCase() === String(w).toLowerCase());
  const pm = !p.expectedPresentation || t.presentation === p.expectedPresentation;
  return fm && sm && tm && pm ? 'PASS' : (fm ? 'PARTIAL' : 'FAIL');
}
const covers = (r, file, lines) => (r.file === file) && lines.some(l => l >= (r.startLine ?? -1) && l <= (r.endLine ?? -1));
function score(it, res) {
  if (it.kind === 'probe') {
    let rr = 0;
    for (let i = 0; i < res.length; i++) if (grade(it, res[i]) === 'PASS') { rr = 1 / (i + 1); break; }
    return { top1: grade(it, res[0]), rr };
  }
  if (it.kind === 'exact') {
    const lineRank = res.findIndex(r => covers(r, it.goldFile, it.goldLines)) + 1 || null;
    const fileRank = res.findIndex(r => r.file === it.goldFile) + 1 || null;
    return { lineRank, fileRank };
  }
  if (it.kind === 'd23') {
    const fileRank = res.findIndex(r => r.file === 'worker/draft.go') + 1 || null;
    const lineRank = res.findIndex(r => covers(r, 'worker/draft.go', [310])) + 1 || null;
    return { fileRank, lineRank };
  }
  const files = res.map(r => r.file || '');
  const found = it.gold.filter(g => files.some(f => f === g || f.endsWith('/' + g)));
  return { recall: found.length / it.gold.length, hit: found.length ? 1 : 0 };
}

const list = items();
const byRepo = new Map();
for (const it of list) { const key = `${it.base}|${it.repo}`; if (!byRepo.has(key)) byRepo.set(key, []); byRepo.get(key).push(it); }
const out = fs.createWriteStream(outPath, { flags: 'a' });
for (const [key, its] of byRepo) {
  const [base, repo] = key.split('|');
  const t0 = Date.now();
  const s = await makeSearcher(path.join(base, repo));
  for (const it of its) {
    for (const [arm, spec] of Object.entries(ARMS)) {
      const saved = {};
      for (const [k2, v] of Object.entries(spec.env || {})) { saved[k2] = process.env[k2]; process.env[k2] = v; }
      let r = null;
      const ts = Date.now();
      try { r = await ssSearch(s, it.query, K); } catch (e) { console.error(it.id, arm, e.message); }
      const ms = Date.now() - ts;
      for (const [k2, v] of Object.entries(saved)) { if (v == null) delete process.env[k2]; else process.env[k2] = v; }
      const res = r?.results || [];
      out.write(JSON.stringify({ set, k: K, id: it.id, repo, arm, ms, n: res.length, ...score(it, res),
        body: r?.stats?.bodyLexical || null,
        top: res.map(x => `${x.file}:${x.startLine}-${x.endLine}|${x.symbol || ''}|${x.presentation}`) }) + '\n');
    }
  }
  try { s.close(); } catch { /* ignore */ }
  console.error(`[harness] ${set} ${repo}: ${its.length} items x ${Object.keys(ARMS).length} arms in ${Math.round((Date.now() - t0) / 1000)}s`);
}
out.end();
await new Promise(r => out.on('finish', r));
process.exit(0);
