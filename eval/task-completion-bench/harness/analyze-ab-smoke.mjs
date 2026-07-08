// L1+L2 smoke analyzer (runs on the box). For every codex rollout produced during the
// smoke window it recovers: cache-normalized idealCost + realized cost (per-turn
// token_count events), tool calls, and the mechanism counters that are L1/L2's direct
// evidence (manual docker/git-diff/temp-dir reconstruction moves; max single-output
// ingest bytes). Classifies ON vs OFF by the L2 authority banner in run_tests output.
// Usage: node analyze-smoke.mjs <sinceEpochMs>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SINCE = Number(process.argv[2] || 0);
const SESS = process.env.CODEX_SESSIONS || path.join(os.homedir(), '.codex/sessions');
const P = { in: 5.0, cache: 0.5, out: 30.0 };

function walk(d) { const o = []; for (const e of readdirSync(d)) { const p = path.join(d, e); const s = statSync(p); if (s.isDirectory()) o.push(...walk(p)); else if (e.endsWith('.jsonl')) o.push({ p, m: s.mtimeMs }); } return o; }

const rows = [];
for (const f of walk(SESS)) {
  if (f.m < SINCE) continue;
  let lines; try { lines = readFileSync(f.p, 'utf8').split('\n').filter(Boolean); } catch { continue; }
  let cwd = '', turns = [], cmds = [], maxOut = 0, bannerSeen = false, condSeen = false, baselineSeen = false, ranTests = false, dockerRun = 0, gitDiff = 0, tmpRecon = 0, shimPeek = 0, rawTestRun = 0;
  for (const l of lines) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    const p = o.payload || {}; const t = p.type || o.type;
    if (t === 'session_meta' || p.cwd) cwd = cwd || p.cwd || '';
    if (t === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      turns.push({ in: u.input_tokens || 0, cached: u.cached_input_tokens || 0, out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) });
    }
    if (t === 'function_call') {
      const cmd = String(p.arguments || '');
      cmds.push(cmd.slice(0, 120));
      const inner = cmd.toLowerCase();
      if (/run_tests/.test(inner)) ranTests = true;
      if (/docker\s+run|docker\s+exec/.test(inner)) dockerRun++;
      if (/git\s+diff|git\s+show/.test(inner)) gitDiff++;
      if (/\btmp=|mktemp|\/tmp\/\w+_rt|_rt_debug/.test(inner)) tmpRecon++;
      if (/\.codex-bin|_run_tests|cat\s+.*run_tests|sed\s+.*run_tests/.test(inner)) shimPeek++;
      if (/(pytest|cargo test|go test|npm test|mvn test|botan-test|mix test|testthat)/.test(inner) && !/run_tests/.test(inner)) rawTestRun++;
    }
    if (t === 'function_call_output') {
      const out = typeof p.output === 'string' ? p.output : String(p.output?.content || '');
      if (out.length > maxOut) maxOut = out.length;
      if (/Authoritative test result for your CURRENT edits/.test(out)) bannerSeen = true;
      if (/condensed by harness/.test(out)) condSeen = true;
      if (/baseline-diff/.test(out)) baselineSeen = true;
    }
  }
  if (!cwd.includes('/runs/')) continue;              // only agent runs
  const m = cwd.match(/runs\/(.+?)__(native|sweet)__r(\d+)__/);
  if (!m) continue;
  // per-turn cost recovery
  let ideal = 0, real = 0, prevIn = 0;
  for (const tu of turns) {
    const newIn = Math.max(0, tu.in - prevIn);        // context added this turn
    const resent = tu.in - newIn;                     // prior context re-sent
    ideal += (newIn * P.in + resent * P.cache + tu.out * P.out) / 1e6;   // ideal cache
    real += ((tu.in - tu.cached) * P.in + tu.cached * P.cache + tu.out * P.out) / 1e6;  // actual cache
    prevIn = tu.in;
  }
  rows.push({ task: m[1], arm: m[2], rep: +m[3], cond: bannerSeen ? 'ON' : (ranTests ? 'OFF' : '?'),
    turns: turns.length, calls: cmds.length, ideal: +ideal.toFixed(3), real: +real.toFixed(3),
    maxOutKB: +(maxOut / 1024).toFixed(1), dockerRun, gitDiff, tmpRecon, shimPeek, rawTestRun,
    condSeen: condSeen ? 1 : 0, baselineSeen: baselineSeen ? 1 : 0, ranTests: ranTests ? 1 : 0 });
}

rows.sort((a, b) => (a.task + a.cond + a.rep).localeCompare(b.task + b.cond + b.rep));
console.log('| task | cond | rep | arm | calls | ideal$ | real$ | maxOutKB | dockerRun | gitDiff | tmpRecon | shimPeek | rawTest | L1cond | L2base |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.task} | ${r.cond} | ${r.rep} | ${r.arm} | ${r.calls} | ${r.ideal} | ${r.real} | ${r.maxOutKB} | ${r.dockerRun} | ${r.gitDiff} | ${r.tmpRecon} | ${r.shimPeek} | ${r.rawTestRun} | ${r.condSeen} | ${r.baselineSeen} |`);

// aggregates by cond (sweet only)
for (const cond of ['ON', 'OFF']) {
  const rs = rows.filter(r => r.cond === cond && r.arm === 'sweet');
  if (!rs.length) continue;
  const sum = k => rs.reduce((a, r) => a + r[k], 0);
  const med = k => { const v = rs.map(r => r[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  console.log(`\n[${cond}] n=${rs.length} sweet | medianIdeal$=${med('ideal')} sumIdeal$=${sum('ideal').toFixed(2)} sumReal$=${sum('real').toFixed(2)} | reconMoves(docker+gitDiff+tmp+shim+rawTest)=${sum('dockerRun') + sum('gitDiff') + sum('tmpRecon') + sum('shimPeek') + sum('rawTestRun')} | medMaxOutKB=${med('maxOutKB')} | L1condHits=${sum('condSeen')} L2baseHits=${sum('baselineSeen')}`);
}
console.log(`\n(rollouts since ${new Date(SINCE).toISOString()}: ${rows.length} runs)`);
