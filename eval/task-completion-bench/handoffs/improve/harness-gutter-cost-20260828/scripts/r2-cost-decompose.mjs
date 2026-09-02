// r2 — decompose realized rollout cost into INGEST / RESIDENCY / OUTPUT terms, per harness.
// Read-only over results/. Usage: node r2-cost-decompose.mjs <RESULTS_ROOT> <RUN_ID> <harness>
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';
import { transcriptMetricsFromFile } from '/root/sweet-search-private/eval/task-completion-bench/harness/claude-code-accounting.mjs';

const PRICE = { in: 0.10, cache: 0.01, out: 0.60 };   // openai/gpt-5.6-luna as registered
const [ROOT, RUN, HARNESS] = process.argv.slice(2);

function walk(dir, pred, out = [], depth = 0) {
  if (depth > 9) return out;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out, depth + 1);
    else if (pred(p, e.name)) out.push(p);
  }
  return out;
}

function codexTurns(file) {
  const turns = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    const p = o.payload || {}; const t = p.type || o.type;
    if (t === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
                   out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
                   reason: u.reasoning_output_tokens || 0 });
    }
  }
  return turns;
}

function opencodeTurns(file) {
  const turns = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'step_finish') continue;
    const tk = o.part?.tokens || {}; const c = tk.cache || {};
    const cacheRead = c.read || 0, cacheWrite = c.write || 0;
    // opencode reports `input` EXCLUSIVE of cache read; full context = input + cache.read + cache.write
    turns.push({ in: (tk.input || 0) + cacheRead + cacheWrite, cached: cacheRead, cacheWrite,
                 out: (tk.output || 0) + (tk.reasoning || 0), reason: tk.reasoning || 0 });
  }
  return turns;
}

function claudeTurns(file) {
  const m = transcriptMetricsFromFile(file);
  return (m.turns || []).map(t => ({ in: t.in || 0, cached: t.cached || 0, cacheWrite: t.cacheWrite || 0,
                                     out: t.out || 0, reason: 0 }));
}

const arms = ['sweet', 'native'];
const stateRoot = path.join(ROOT, RUN, 'agent-state');
const cells = readdirSync(stateRoot).filter(d => statSync(path.join(stateRoot, d)).isDirectory());

const byArm = {};
for (const cell of cells) {
  const arm = arms.find(a => cell.endsWith(`-${a}`)); if (!arm) continue;
  const dir = path.join(stateRoot, cell);
  let files = [];
  if (HARNESS === 'codex') files = walk(dir, (p, n) => n.startsWith('rollout-') && n.endsWith('.jsonl'));
  else if (HARNESS === 'opencode') files = walk(dir, (p, n) => n === 'attempt-1.stdout.ndjson');
  else files = walk(dir, (p, n) => n.endsWith('.jsonl') && /\/projects\//.test(p) && !/\/subagents\//.test(p));
  const rolls = [];
  for (const f of files) {
    let turns = [];
    try { turns = HARNESS === 'codex' ? codexTurns(f) : HARNESS === 'opencode' ? opencodeTurns(f) : claudeTurns(f); } catch { continue; }
    if (!turns.length) continue;
    let prevIn = 0, ingest = 0, resent = 0, out = 0, reason = 0, sumIn = 0, cwrite = 0;
    for (const t of turns) {
      const nw = Math.max(0, t.in - prevIn);
      ingest += nw; resent += t.in - nw; out += t.out; reason += t.reason || 0;
      sumIn += t.in; cwrite += t.cacheWrite || 0; prevIn = t.in;
    }
    const c = costFromTurns(turns, PRICE);
    rolls.push({ f, T: turns.length, ingest, resent, out, reason, sumIn, cwrite,
                 finalIn: turns[turns.length - 1].in, ideal: c.idealUsd, real: c.realFromTurnsUsd });
  }
  rolls.sort((a, b) => b.ideal - a.ideal);
  (byArm[arm] ||= []).push(...rolls.slice(0, 3));
}

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const sum = a => a.reduce((x, y) => x + y, 0);
console.log(`# ${RUN}  harness=${HARNESS}  price in=${PRICE.in} cache=${PRICE.cache} out=${PRICE.out}`);
for (const arm of arms) {
  const R = byArm[arm]; if (!R || !R.length) continue;
  const n = R.length;
  const cIngest = sum(R.map(r => r.ingest)) * PRICE.in / 1e6;
  const cResid  = sum(R.map(r => r.resent)) * PRICE.cache / 1e6;
  const cOut    = sum(R.map(r => r.out)) * PRICE.out / 1e6;
  const tot = cIngest + cResid + cOut;
  console.log(`\n## arm=${arm}  rollouts=${n}`);
  console.log(`turns:      mean ${(sum(R.map(r=>r.T))/n).toFixed(1)}  median ${med(R.map(r=>r.T))}  max ${Math.max(...R.map(r=>r.T))}`);
  console.log(`INGEST tok: mean ${(sum(R.map(r=>r.ingest))/n).toFixed(0)}  median ${med(R.map(r=>r.ingest))}`);
  console.log(`RESENT tok: mean ${(sum(R.map(r=>r.resent))/n).toFixed(0)}  median ${med(R.map(r=>r.resent))}`);
  console.log(`OUTPUT tok: mean ${(sum(R.map(r=>r.out))/n).toFixed(0)}  median ${med(R.map(r=>r.out))}   (reasoning ${(sum(R.map(r=>r.reason))/n).toFixed(0)})`);
  console.log(`finalIn   : mean ${(sum(R.map(r=>r.finalIn))/n).toFixed(0)}  median ${med(R.map(r=>r.finalIn))}  max ${Math.max(...R.map(r=>r.finalIn))}`);
  console.log(`cost/rollout ideal $${(sum(R.map(r=>r.ideal))/n).toFixed(6)}   real $${(sum(R.map(r=>r.real))/n).toFixed(6)}`);
  console.log(`SHARE  ingest ${(100*cIngest/tot).toFixed(1)}%   residency ${(100*cResid/tot).toFixed(1)}%   output ${(100*cOut/tot).toFixed(1)}%`);
  console.log(`amortised $/1k tokens: ingest ${(1000*PRICE.in/1e6).toFixed(5)}  residency-per-remaining-turn ${(1000*PRICE.cache/1e6).toFixed(5)}  output ${(1000*PRICE.out/1e6).toFixed(5)}`);
}
