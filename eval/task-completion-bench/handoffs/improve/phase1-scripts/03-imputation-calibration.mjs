// Calibration for the sidechain-pricing repair.
// Q1: does the context identity  T(N) = T(N-1) + cacheWrite(N)  hold on KNOWN pairs?
//     If yes, the input side of a missing request is bracketed, not guessed.
// Q2: can output_tokens be predicted from visible content (text + tool_use JSON +
//     redacted_thinking blob length)?  Fit on KNOWN requests, report residuals.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = ['screen-v3-20260812', 'sb-claudecode-20260811'];

function transcripts(root) {
  const out = [];
  const walk = (d, depth = 0) => {
    if (depth > 9) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out.filter(p => p.includes('/claude-home/projects/'));
}

/** Merge records by message id: union content blocks, usage = record with max in+out. */
export function mergedRequests(file) {
  const order = [];
  const byId = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    const m = e.message;
    if (!m || m.role !== 'assistant' || !m.id) continue;
    if (!byId.has(m.id)) { byId.set(m.id, { id: m.id, blocks: [], usage: null, best: -1 }); order.push(m.id); }
    const r = byId.get(m.id);
    for (const b of (m.content || [])) r.blocks.push(b);
    const u = m.usage || {};
    const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    if (tot > r.best) { r.best = tot; r.usage = u; }
  }
  return order.map(id => {
    const r = byId.get(id);
    const u = r.usage || {};
    const inTok = u.input_tokens || 0, cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    const T = inTok + cr + cw;
    let textChars = 0, toolChars = 0, thinkChars = 0, redactedChars = 0, nTools = 0;
    for (const b of r.blocks) {
      if (b.type === 'text') textChars += (b.text || '').length;
      else if (b.type === 'thinking') thinkChars += (b.thinking || '').length;
      else if (b.type === 'redacted_thinking') redactedChars += (b.data || '').length;
      else if (b.type === 'tool_use') { nTools++; toolChars += JSON.stringify(b.input || {}).length; }
    }
    return { id, known: T > 0 || (u.output_tokens || 0) > 0, inTok, cr, cw, T,
      out: u.output_tokens || 0, textChars, toolChars, thinkChars, redactedChars, nTools };
  });
}

const identity = { pairs: 0, exact: 0, within1: 0, worst: 0, examples: [] };
const fitRows = [];
let mainFitRows = 0;

for (const RUN of RUNS) {
  const root = path.join(RESULTS, RUN, 'agent-state');
  if (!existsSync(root)) continue;
  for (const f of transcripts(root)) {
    const isSide = f.includes('/subagents/');
    const reqs = mergedRequests(f);
    for (let i = 1; i < reqs.length; i++) {
      const a = reqs[i - 1], b = reqs[i];
      if (!a.known || !b.known) continue;
      identity.pairs++;
      const pred = a.T + b.cw;
      const err = b.T - pred;
      if (err === 0) identity.exact++;
      if (Math.abs(err) <= 1) identity.within1++;
      if (Math.abs(err) > Math.abs(identity.worst)) identity.worst = err;
      if (Math.abs(err) > 50 && identity.examples.length < 8) identity.examples.push({ f: path.basename(f), i, aT: a.T, bcw: b.cw, bT: b.T, err });
    }
    for (const r of reqs) {
      if (!r.known || !r.out) continue;
      if (isSide) fitRows.push(r); else mainFitRows++;
      if (!isSide && mainFitRows <= 4000) fitRows.push({ ...r, main: true });
    }
  }
}

console.log('=== Q1. context identity  T(N) = T(N-1) + cacheWrite(N)  over KNOWN consecutive pairs ===');
console.log(`pairs=${identity.pairs} exact=${identity.exact} (${(identity.exact / identity.pairs * 100).toFixed(1)}%) within1=${identity.within1} (${(identity.within1 / identity.pairs * 100).toFixed(1)}%) worst error=${identity.worst} tokens`);
for (const e of identity.examples) console.log('  outlier', e);

console.log('\n=== Q2. output-token predictors on KNOWN requests ===');
const side = fitRows.filter(r => !r.main), main = fitRows.filter(r => r.main);
for (const [name, rows] of [['sidechain', side], ['main', main]]) {
  if (!rows.length) continue;
  const y = rows.map(r => r.out);
  const meanY = y.reduce((a, b) => a + b, 0) / y.length;
  console.log(`\n-- ${name}: n=${rows.length} mean out=${meanY.toFixed(1)} median=${y.slice().sort((a, b) => a - b)[Math.floor(y.length / 2)]}`);
  const feats = {
    'redactedChars/3.5': r => r.redactedChars / 3.5,
    'visible/3.5': r => (r.textChars + r.toolChars + r.thinkChars) / 3.5,
    'all/3.5': r => (r.textChars + r.toolChars + r.thinkChars + r.redactedChars) / 3.5,
  };
  for (const [fname, fn] of Object.entries(feats)) {
    const x = rows.map(fn);
    const sx = x.reduce((a, b) => a + b, 0), sy = y.reduce((a, b) => a + b, 0);
    const sxx = x.reduce((a, b) => a + b * b, 0), sxy = x.reduce((a, b, i) => a + b * y[i], 0);
    const n = rows.length;
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const icept = (sy - slope * sx) / n;
    const resid = y.map((v, i) => v - (slope * x[i] + icept));
    const ss = resid.reduce((a, b) => a + b * b, 0);
    const tss = y.reduce((a, b) => a + (b - meanY) ** 2, 0);
    const mape = y.reduce((a, v, i) => a + Math.abs(resid[i]) / Math.max(1, v), 0) / n;
    console.log(`   ${fname.padEnd(18)} out = ${slope.toFixed(3)}*x + ${icept.toFixed(1)}   R2=${(1 - ss / tss).toFixed(3)}  MAPE=${(mape * 100).toFixed(1)}%`);
  }
  // constant predictor (per-transcript mean) for reference
  const constResid = y.map(v => v - meanY);
  const constMape = y.reduce((a, v, i) => a + Math.abs(constResid[i]) / Math.max(1, v), 0) / y.length;
  console.log(`   ${'constant mean'.padEnd(18)} MAPE=${(constMape * 100).toFixed(1)}%`);
}
