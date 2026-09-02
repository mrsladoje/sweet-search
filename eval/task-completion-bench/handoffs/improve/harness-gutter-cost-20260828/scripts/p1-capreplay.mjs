#!/usr/bin/env node
// p1-capreplay.mjs — calibrate bytes-per-token on codex outputs, then replay the
// epoch-B/C cap over epoch A's own transcripts with a residency-aware price.
import fs from 'node:fs';
const rows = fs.readFileSync('/tmp/fp-inv/p1/rollouts.ndjson', 'utf8').trim().split('\n').map(JSON.parse);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f6 = x => x.toFixed(6);

function records(file) {
  const out = [];
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const l of txt.split('\n')) {
    if (!l) continue; let o; try { o = JSON.parse(l); } catch { continue; }
    const p = o.payload || {}; const t = p.type || o.type;
    if (t === 'token_count' && p.info?.last_token_usage) { out.push({ kind: 'turn', u: p.info.last_token_usage }); continue; }
    if (t !== 'function_call_output' && t !== 'custom_tool_call_output') continue;
    let body = p.output; if (typeof body !== 'string') body = JSON.stringify(body || '');
    try { const j = JSON.parse(body); if (j && typeof j.output === 'string') body = j.output; } catch {}
    out.push({ kind: 'out', body });
  }
  return out;
}

// ---- 1. bytes per token on UNTRUNCATED epoch-C outputs, by arm ----
console.log('=== bytes per token, codex epoch B/C untruncated outputs (codex own token counts) ===');
for (const [lbl, pred] of [['C native', r => r.harness === 'codex' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'native'],
                           ['C sweetTAB', r => r.harness === 'codex' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'sweet'],
                           ['B native', r => r.harness === 'codex' && r.epoch === 'B' && r.arm === 'native'],
                           ['B sweet', r => r.harness === 'codex' && r.epoch === 'B' && r.arm === 'sweet']]) {
  let bytes = 0, toks = 0, n = 0, bigBytes = 0, bigToks = 0, nBig = 0;
  for (const r of rows.filter(pred)) {
    if (!r.transcript || !fs.existsSync(r.transcript)) continue;
    for (const rec of records(r.transcript)) {
      if (rec.kind !== 'out') continue;
      const m = rec.body.match(/Original token count:\s*(\d+)/);
      if (!m) continue;
      if (/Warning: truncated output/.test(rec.body)) continue;
      const t = +m[1]; if (!t) continue;
      // strip the ~5-line envelope header so bytes are the payload only
      const idx = rec.body.indexOf('\nOutput:\n');
      const payload = idx >= 0 ? rec.body.slice(idx + 9) : rec.body;
      bytes += payload.length; toks += t; n++;
      if (t > 1000) { bigBytes += payload.length; bigToks += t; nBig++; }
    }
  }
  console.log(`  ${lbl}: untruncated outputs=${n} bytes/token=${(bytes / toks).toFixed(3)} | outputs>1000tok: n=${nBig} bytes/token=${(bigBytes / bigToks).toFixed(3)}`);
}

// ---- 2. epoch A: over-cap bytes -> tokens, priced with residency ----
console.log('\n=== epoch A cap counterfactual, residency-aware ===');
const CAPB = 10214;
function replay(pred, bpt) {
  const per = [];
  for (const r of rows.filter(pred)) {
    if (!r.transcript || !fs.existsSync(r.transcript)) continue;
    const recs = records(r.transcript);
    // index turns; a tool output that appears before turn i is ingested at turn i and re-sent after
    let turnIdx = 0; const turnsTotal = recs.filter(x => x.kind === 'turn').length;
    let saved = 0, removedTok = 0;
    for (const rec of recs) {
      if (rec.kind === 'turn') { turnIdx++; continue; }
      if (rec.body.length <= CAPB) continue;
      const over = rec.body.length - CAPB;
      const tok = over / bpt;
      removedTok += tok;
      const resid = Math.max(0, turnsTotal - turnIdx - 1);
      saved += tok * (0.10 + 0.01 * resid) / 1e6;
    }
    per.push({ taskId: r.taskId, rep: r.rep, base: r.real, saved, removedTok, turns: turnsTotal });
  }
  return per;
}
function mkRnd(seed) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296); }
for (const bpt of [2.67, 3.0, 3.5, 4.0, 4.4]) {
  const na = replay(r => r.harness === 'codex' && r.epoch === 'A' && r.arm === 'native', bpt);
  const sw = replay(r => r.harness === 'codex' && r.epoch === 'A' && r.arm === 'sweet', bpt);
  const byTask = (arr) => { const m = new Map(); for (const x of arr) { if (!m.has(x.taskId)) m.set(x.taskId, []); m.get(x.taskId).push(x); } return m; };
  const N = byTask(na), S = byTask(sw);
  const tasks = [...N.keys()].filter(t => S.has(t)).sort();
  const nBase = tasks.map(t => mean(N.get(t).map(x => x.base)));
  const sBase = tasks.map(t => mean(S.get(t).map(x => x.base)));
  const nCap = tasks.map(t => mean(N.get(t).map(x => x.base - x.saved)));
  const sCap = tasks.map(t => mean(S.get(t).map(x => x.base - x.saved)));
  const asRun = 100 * (mean(sBase) - mean(nBase)) / mean(nBase);
  const capped = 100 * (mean(sCap) - mean(nCap)) / mean(nCap);
  // bootstrap over tasks
  const rnd = mkRnd(20260828); const out = [];
  for (let b = 0; b < 20000; b++) {
    let sd = 0, sb = 0;
    for (let i = 0; i < tasks.length; i++) { const j = Math.floor(rnd() * tasks.length); sd += sCap[j] - nCap[j]; sb += nCap[j]; }
    out.push(100 * sd / sb);
  }
  out.sort((a, b) => a - b);
  console.log(`  bytes/token=${bpt}: removedTok/rollout native=${Math.round(mean(na.map(x => x.removedTok)))} sweet=${Math.round(mean(sw.map(x => x.removedTok)))} | epochA as-run=${asRun.toFixed(1)}% -> capped=${capped.toFixed(1)}% CI=[${out[500].toFixed(1)}%, ${out[19500].toFixed(1)}%] (tasks=${tasks.length})`);
}

// ---- 3. native read sizes (02 H2) ----
console.log('\n=== 02 H2: native read calls and bytes (toolCounts.nativeRead + tool output bytes) ===');
for (const [lbl, pred] of [['A native', r => r.harness === 'codex' && r.epoch === 'A' && r.arm === 'native'],
                           ['B native', r => r.harness === 'codex' && r.epoch === 'B' && r.arm === 'native'],
                           ['C native', r => r.harness === 'codex' && r.epoch === 'C' && r.form === 'tab' && r.arm === 'native']]) {
  const rs = rows.filter(pred);
  const nr = mean(rs.map(r => (r.toolCounts && r.toolCounts.nativeRead) || 0));
  console.log(`  ${lbl}: toolCounts.nativeRead/rollout=${nr.toFixed(2)} calls/rollout=${mean(rs.map(r => r.calls || 0)).toFixed(2)}`);
}

// ---- 4. requests vs calls (claim 13) ----
console.log('\n=== requests (turns) vs tool calls, epoch C ===');
for (const h of ['codex', 'opencode', 'claude-code']) {
  for (const arm of ['native', 'sweet']) {
    const rs = rows.filter(r => r.harness === h && r.epoch === 'C' && r.form === 'tab' && r.arm === arm);
    console.log(`  ${h} ${arm}: requests(turns)=${mean(rs.map(r => r.nTurns)).toFixed(2)} rows.calls=${mean(rs.map(r => r.calls || 0)).toFixed(2)} mainReqs=${h === 'claude-code' ? mean(rs.map(r => r.mainReqs || 0)).toFixed(2) : '-'}`);
  }
}
