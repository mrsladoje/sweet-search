#!/usr/bin/env node
// p1-stats.mjs — bootstrap CIs on the delegation subsets and the form pairs, sign tests,
// cache-hit / cache-write, cross-harness ratios, opencode calls-per-request, codex cap census.
import fs from 'node:fs';
import path from 'node:path';
const RES = '/root/sweet-search-private/eval/task-completion-bench/results';
const rows = fs.readFileSync('/tmp/fp-inv/p1/rollouts.ndjson', 'utf8').trim().split('\n').map(JSON.parse);
const repair = new Set(fs.readFileSync('/root/fresh-run/repair-tasks.txt', 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f6 = x => x.toFixed(6);
function mkRnd(seed) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296); }
function bootPct(deltas, base, seed, B = 20000) {
  const rnd = mkRnd(seed); const out = [];
  for (let b = 0; b < B; b++) {
    let sd = 0, sb = 0;
    for (let i = 0; i < deltas.length; i++) { const j = Math.floor(rnd() * deltas.length); sd += deltas[j]; sb += base[j]; }
    out.push(100 * sd / sb);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}
function bootAbs(deltas, seed, B = 20000) {
  const rnd = mkRnd(seed); const out = [];
  for (let b = 0; b < B; b++) { let sd = 0; for (let i = 0; i < deltas.length; i++) sd += deltas[Math.floor(rnd() * deltas.length)]; out.push(sd / deltas.length); }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}
function binomP(k, n) { // two-sided exact binomial, p=0.5
  const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  const pmf = i => C(n, i) * Math.pow(0.5, n);
  const t = pmf(k); let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= t + 1e-12) p += pmf(i);
  return Math.min(1, p);
}
function cellRows(h, form, arm) {
  if (h === 'opencode') return rows.filter(r => r.harness === h && r.epoch === 'C' && r.arm === arm && r.form === form
    && (arm === 'native' ? !r.runId.startsWith('rp-') : (repair.has(r.taskId) ? r.runId.startsWith('rp-') : !r.runId.startsWith('rp-'))));
  return rows.filter(r => r.harness === h && r.epoch === 'C' && r.arm === arm && r.form === form);
}
const taskMean = (rs, key) => { const m = new Map(); for (const r of rs) { if (!m.has(r.taskId)) m.set(r.taskId, []); m.get(r.taskId).push(key(r)); } const o = new Map(); for (const [t, a] of m) o.set(t, mean(a)); return o; };

console.log('=== A. DELEGATION SUBSETS with REAL bootstrap CIs (claude epoch C, main-only) ===');
{
  const sw = cellRows('claude-code', 'tab', 'sweet'), na = cellRows('claude-code', 'tab', 'native');
  const S = taskMean(sw, r => r.real), N = taskMean(na, r => r.real);
  const all = [...N.keys()].sort();
  const delegTasks = new Set([...sw, ...na].filter(r => (r.subFiles || 0) > 0).map(r => r.taskId));
  const sets = {
    'all 22': all,
    'clean 4 (no delegation anywhere)': all.filter(t => !delegTasks.has(t)),
    '21 = 22 minus moq-1262': all.filter(t => t !== 'devlooped__moq-1262'),
  };
  for (const [lbl, ts] of Object.entries(sets)) {
    const d = ts.map(t => S.get(t) - N.get(t)), b = ts.map(t => N.get(t));
    const ci = bootPct(d, b, 20260828);
    console.log(`  ${lbl}: n=${ts.length} Δ=${(100 * mean(d) / mean(b)).toFixed(2)}% CI=[${ci[0].toFixed(1)}%, ${ci[1].toFixed(1)}%]`);
  }
  // rollout-pair clean, bootstrap over the 17 tasks it touches
  const key = r => `${r.taskId}|${r.rep}`;
  const swM = new Map(sw.map(r => [key(r), r])), naM = new Map(na.map(r => [key(r), r]));
  const clean = [...swM.keys()].filter(k => naM.has(k) && (swM.get(k).subFiles || 0) === 0 && (naM.get(k).subFiles || 0) === 0);
  const byTask = new Map();
  for (const k of clean) { const t = k.split('|')[0]; if (!byTask.has(t)) byTask.set(t, []); byTask.get(t).push(k); }
  const ts = [...byTask.keys()];
  const d = ts.map(t => mean(byTask.get(t).map(k => swM.get(k).real - naM.get(k).real)));
  const b = ts.map(t => mean(byTask.get(t).map(k => naM.get(k).real)));
  const ci = bootPct(d, b, 20260828);
  console.log(`  rollout-pair clean (${clean.length} pairs over ${ts.length} tasks): Δ=${(100 * mean(d) / mean(b)).toFixed(2)}% CI=[${ci[0].toFixed(1)}%, ${ci[1].toFixed(1)}%]`);
}

console.log('\n=== B. FORM-PAIR DELTAS, CIs, sign tests (sweet only, inclusive realized) ===');
for (const h of ['codex', 'opencode', 'claude-code']) {
  const T = taskMean(cellRows(h, 'tab', 'sweet'), r => r.real + (r.sideReal || 0));
  for (const form of ['none', 'pipe']) {
    const F = taskMean(cellRows(h, form, 'sweet'), r => r.real + (r.sideReal || 0));
    const ts = [...T.keys()].filter(t => F.has(t)).sort();
    const d = ts.map(t => F.get(t) - T.get(t)), b = ts.map(t => T.get(t));
    const ci = bootPct(d, b, 20260828), cia = bootAbs(d, 20260828);
    const cheaper = d.filter(x => x < 0).length;
    console.log(`  ${h} TAB->${form.toUpperCase()}: Δ=$${f6(mean(d))} (${(100 * mean(d) / mean(b)).toFixed(1)}%) CI%=[${ci[0].toFixed(1)}, ${ci[1].toFixed(1)}] CI$=[${f6(cia[0])}, ${f6(cia[1])}] sign ${cheaper}/${ts.length - cheaper} p=${binomP(cheaper, ts.length).toFixed(3)}`);
  }
}

console.log('\n=== C. CACHE HIT / CACHE WRITE / SURCHARGE ===');
for (const h of ['codex', 'opencode', 'claude-code']) {
  for (const arm of ['native', 'sweet']) {
    const s = cellRows(h, 'tab', arm);
    const hit = mean(s.map(r => r.cachedTok / Math.max(1, r.inTok)));
    const cw = mean(s.map(r => r.cacheWriteRawTok ?? r.cacheWriteTok ?? 0));
    const real = mean(s.map(r => r.real));
    const missTurns = s.reduce((a, r) => a + 0, 0);
    const surchargeIfApplied = 0.25 * cw * 0.10 / 1e6;
    console.log(`  ${h} ${arm}: cacheHit=${hit.toFixed(4)} cacheWriteTok/rollout=${Math.round(cw)} real=$${f6(real)} 1.25x-surcharge-if-applied=$${f6(surchargeIfApplied)} (${(100 * surchargeIfApplied / real).toFixed(2)}% of the arm)`);
  }
}

console.log('\n=== D. CROSS-HARNESS RATIOS (native arm, epoch C) ===');
{
  const g = h => {
    const s = cellRows(h, 'tab', 'native');
    return { real: mean(s.map(r => r.real + (r.sideReal || 0))), ideal: mean(s.map(r => r.ideal + (r.sideIdeal || 0))), brk: mean(s.map(r => r.brk + (r.sideBrk || 0))) };
  };
  const cc = g('claude-code'), cx = g('codex'), oc = g('opencode');
  console.log(`  claude real=$${f6(cc.real)} ideal=$${f6(cc.ideal)} | codex real=$${f6(cx.real)} ideal=$${f6(cx.ideal)} | opencode real=$${f6(oc.real)} ideal=$${f6(oc.ideal)}`);
  console.log(`  claude/codex: realized ${(cc.real / cx.real).toFixed(3)}x  ideal ${(cc.ideal / cx.ideal).toFixed(3)}x ; codex/opencode realized ${(cx.real / oc.real).toFixed(3)}x`);
}

console.log('\n=== E. OPENCODE TOOL CALLS PER REQUEST ===');
{
  for (const [lbl, sel] of [['C native', () => cellRows('opencode', 'tab', 'native')],
                            ['C sweet TAB', () => cellRows('opencode', 'tab', 'sweet')],
                            ['A native', () => rows.filter(r => r.harness === 'opencode' && r.epoch === 'A' && r.arm === 'native')],
                            ['A sweet', () => rows.filter(r => r.harness === 'opencode' && r.epoch === 'A' && r.arm === 'sweet')]]) {
    let calls = 0, steps = 0, multi = 0, callsInMulti = 0, nRoll = 0;
    for (const r of sel()) {
      if (!r.transcript || !fs.existsSync(r.transcript)) continue;
      nRoll++;
      let cur = 0;
      const stepCounts = [];
      for (const l of fs.readFileSync(r.transcript, 'utf8').split('\n')) {
        if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
        if (o.type === 'tool_use') cur++;
        else if (o.type === 'step_finish' || o.type === 'step-finish') { stepCounts.push(cur); cur = 0; }
      }
      if (cur) stepCounts.push(cur);
      for (const c of stepCounts) { if (c > 0) { steps++; calls += c; if (c >= 2) { multi++; callsInMulti += c; } } }
    }
    console.log(`  opencode ${lbl}: rollouts=${nRoll} tool-bearing steps=${steps} calls=${calls} calls/step=${(calls / steps).toFixed(3)} multiCallSteps=${multi} (${(100 * multi / steps).toFixed(1)}%) callsInMultiSteps=${callsInMulti} (${(100 * callsInMulti / calls).toFixed(1)}%) calls/rollout=${(calls / nRoll).toFixed(2)}`);
  }
}

console.log('\n=== F. CODEX TOOL-OUTPUT CAP CENSUS ===');
{
  for (const [lbl, sel] of [['C native', () => cellRows('codex', 'tab', 'native')],
                            ['C sweet TAB', () => cellRows('codex', 'tab', 'sweet')],
                            ['A native', () => rows.filter(r => r.harness === 'codex' && r.epoch === 'A' && r.arm === 'native')],
                            ['A sweet', () => rows.filter(r => r.harness === 'codex' && r.epoch === 'A' && r.arm === 'sweet')],
                            ['B native', () => rows.filter(r => r.harness === 'codex' && r.epoch === 'B' && r.arm === 'native')],
                            ['B sweet', () => rows.filter(r => r.harness === 'codex' && r.epoch === 'B' && r.arm === 'sweet')]]) {
    let nRoll = 0, outs = 0, bytes = 0, maxB = 0, trunc = 0, origTok = 0, truncRolls = 0;
    const sizes = [];
    for (const r of sel()) {
      if (!r.transcript || !fs.existsSync(r.transcript)) continue;
      nRoll++; let anyTrunc = false;
      for (const l of fs.readFileSync(r.transcript, 'utf8').split('\n')) {
        if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
        const p = o.payload || {}; const t = p.type || o.type;
        if (t !== 'function_call_output' && t !== 'custom_tool_call_output') continue;
        let body = p.output; if (typeof body !== 'string') body = JSON.stringify(body || '');
        // codex wraps the output in a JSON object {"output":"..."} on some paths
        try { const j = JSON.parse(body); if (j && typeof j.output === 'string') body = j.output; } catch {}
        outs++; bytes += body.length; sizes.push(body.length); if (body.length > maxB) maxB = body.length;
        const m = body.match(/[Oo]riginal token count:\s*(\d+)/);
        if (m) { trunc++; origTok += +m[1]; anyTrunc = true; }
      }
      if (anyTrunc) truncRolls++;
    }
    sizes.sort((a, b) => a - b);
    const q = p => sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))] : 0;
    console.log(`  codex ${lbl}: rollouts=${nRoll} outputs=${outs} p50=${q(0.5)}B p90=${q(0.9)}B p99=${q(0.99)}B max=${maxB}B | truncated=${trunc} (${(trunc / nRoll).toFixed(2)}/rollout, ${truncRolls}/${nRoll} rollouts) origTokSum/rollout=${Math.round(origTok / nRoll)}`);
  }
}
