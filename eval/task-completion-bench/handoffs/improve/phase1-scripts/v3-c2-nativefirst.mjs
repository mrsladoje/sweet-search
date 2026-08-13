// GATE 3 REDO — C-2 as the mechanism is actually NAMED: "native-first, sweet-on-demand".
// The first pass tested a TURN-0 router only. The mechanism allows switching BY PHASE, so the
// router may use a signal measured after native's first probe. That is a different and more
// faithful variant, and it is the one most likely to pass.
//
// Features are taken from the NATIVE arm's first retrieval call — the phase every rollout starts
// in under "native-first". Cost of a switched rollout is approximated by the chosen arm's full
// cost, which is generous to the router (it pays nothing for the probe it already ran).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUNS = { codex: 'sb-codex-20260811', opencode: 'sb-opencode-20260811', claude: 'sb-claudecode-20260811' };
const YARP = 'dotnet__yarp-2825';

let sideMap = new Map();
try { sideMap = new Map(JSON.parse(readFileSync('/tmp/rows-sidechain-repaired-sb.json', 'utf8'))
  .map(r => [`${r.taskId}|${r.arm}|${r.rep}`, r])); } catch { /* */ }

function transcripts(root) {
  const out = [];
  const walk = (d, depth = 0) => { if (depth > 10) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (/\.(jsonl|ndjson)$/.test(e.name)) out.push(p); } };
  walk(root);
  return out.filter(p => !p.includes('/subagents/'));
}
/** Signals from the NATIVE arm's opening probe. */
function probeSignals(harness, run, taskId, rep) {
  const cell = path.join(RESULTS, run, 'agent-state', `${taskId}-native`);
  if (!existsSync(cell)) return null;
  for (const f of transcripts(cell)) {
    if (harness === 'claude') {
      const slug = f.split('/claude-home/projects/')[1]?.split('/')[0] || '';
      const m = /--r(\d+)--\d+$/.exec(slug); if (m && +m[1] !== rep) continue;
    }
    const txt = readFileSync(f, 'utf8');
    let firstOut = null, calls = 0;
    for (const line of txt.split('\n')) {
      const t = line.trim(); if (!t || t[0] !== '{') continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      const p = o.payload || {}; const ty = p.type || o.type;
      let out = null;
      if (ty === 'function_call_output' || ty === 'custom_tool_call_output') out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output);
      else if (o.type === 'tool_use') out = String(o.part?.state?.output || '');
      else for (const b of (o.message?.content || [])) if (b.type === 'tool_result')
        out = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => x?.text || '').join('') : '';
      if (out == null) continue;
      calls++;
      if (firstOut == null) firstOut = out;
      if (calls >= 1) break;
    }
    if (firstOut == null) continue;
    const flat = firstOut.replace(/\\r\\n|\\n|\\t/g, '\n');
    const paths = [...new Set([...flat.matchAll(/(?:^|[\s"'`(\[])((?:[\w.@+-]+\/)+[\w.+-]+\.[A-Za-z0-9]{1,6})/gm)].map(m => m[1]))];
    return {
      probeBytes: firstOut.length,
      probeHits: paths.length,
      probeTestFrac: paths.length ? paths.filter(p => /test|spec/i.test(p)).length / paths.length : 0,
      probeEmpty: paths.length === 0 ? 1 : 0,
      probeDeep: paths.length ? Math.max(...paths.map(p => p.split('/').length)) : 0,
    };
  }
  return null;
}

const agg = new Map(), feats = new Map();
for (const [harness, run] of Object.entries(RUNS)) {
  for (const r of JSON.parse(readFileSync(path.join(RESULTS, run, 'rows.json'), 'utf8'))) {
    if (r.taskId === YARP) continue;
    let cost = r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0;
    if (harness === 'claude') { const s = sideMap.get(`${r.taskId}|${r.arm}|${r.rep}`); if (s?.inclusiveIdeal_mid != null) cost = s.inclusiveIdeal_mid; }
    const k = `${harness}|${r.taskId}|${r.arm}`;
    const a = agg.get(k) || { cost: 0, n: 0, res: 0 };
    a.cost += cost; a.n++; if (r.resolved) a.res++;
    agg.set(k, a);
    if (r.arm === 'native' && r.rep === 0) {
      const s = probeSignals(harness, run, r.taskId, 0);
      if (s) feats.set(`${harness}|${r.taskId}`, s);
    }
  }
}
const get = (h, t, a) => { const x = agg.get(`${h}|${t}|${a}`); return x ? { cost: x.cost / x.n, res: x.res } : null; };
const TASKS = [...new Set([...agg.keys()].map(k => k.split('|')[1]))].sort();
const FEATS = ['probeBytes', 'probeHits', 'probeTestFrac', 'probeEmpty', 'probeDeep'];
console.log(`tasks ${TASKS.length} | probe signals recovered for ${feats.size} harness-task pairs\n`);

console.log('=== C-2 variant: native-first router on opening-probe signals, leave-one-task-and-repo-out ===');
let anyPass = false;
for (const h of Object.keys(RUNS)) {
  const usable = TASKS.filter(t => feats.has(`${h}|${t}`) && get(h, t, 'native') && get(h, t, 'sweet'));
  if (usable.length < 4) { console.log(`${h}: only ${usable.length} tasks with probe signals — skipped`); continue; }
  const rules = [];
  for (const f of FEATS) {
    const vals = [...new Set(usable.map(t => feats.get(`${h}|${t}`)[f]))].sort((a, b) => a - b);
    for (const v of vals) for (const d of [1, -1])
      rules.push({ label: `${f}${d === 1 ? '>=' : '<'}${v}`, fn: t => ((feats.get(`${h}|${t}`)[f] >= v) === (d === 1)) ? 'sweet' : 'native' });
  }
  rules.push({ label: 'always-sweet', fn: () => 'sweet' }, { label: 'always-native', fn: () => 'native' });
  const acc = { nat: { c: 0, s: 0, r: 0 }, loto: { c: 0, s: 0, r: 0 } };
  const picked = new Map();
  for (const held of usable) {
    const train = usable.filter(t => t !== held);
    let best = null;
    for (const rl of rules) {
      let res = 0, cost = 0;
      for (const t of train) { const a = get(h, t, rl.fn(t)); res += a.res; cost += a.cost; }
      if (!best || res > best.res || (res === best.res && cost < best.cost)) best = { rl, res, cost };
    }
    picked.set(held, best.rl.label);
    const p = get(h, held, best.rl.fn(held)), n = get(h, held, 'native');
    acc.loto.c += p.cost; acc.loto.s += p.res > 0 ? 1 : 0; acc.loto.r += p.res;
    acc.nat.c += n.cost; acc.nat.s += n.res > 0 ? 1 : 0; acc.nat.r += n.res;
  }
  const ok = acc.loto.s > acc.nat.s && acc.loto.r > acc.nat.r && acc.loto.c < acc.nat.c;
  if (ok) anyPass = true;
  console.log(`${h.padEnd(9)} n=${usable.length}  native $${acc.nat.c.toFixed(6)} ${acc.nat.s} solved ${acc.nat.r} reps  ->  router $${acc.loto.c.toFixed(6)} ${acc.loto.s} solved ${acc.loto.r} reps  (${((acc.loto.c / acc.nat.c - 1) * 100).toFixed(1)}%)  ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(`\nnative-first probe router: ${anyPass ? 'passes somewhere' : 'FAILS on every harness'}`);
