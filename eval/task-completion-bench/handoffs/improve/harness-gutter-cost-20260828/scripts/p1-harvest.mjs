#!/usr/bin/env node
// p1-harvest.mjs — INDEPENDENT re-derivation of per-rollout cost from raw transcripts.
// Deliberately does not import anything from harness/ or from the e2/e3 scripts:
// the price formula is re-implemented from the contract read in ideal-cost.mjs.
// Read-only. Writes only under /tmp/fp-inv/p1/.
import fs from 'node:fs';
import path from 'node:path';

const RES = '/root/sweet-search-private/eval/task-completion-bench/results';
const PRICE = { in: 0.10, cache: 0.01, out: 0.60 }; // openai/gpt-5.6-luna, USD per 1e6 tok

const RUNS = [
  // epoch C
  ['C', 'codex',       'tab',  'fp-codex-tab-20260826'],
  ['C', 'codex',       'none', 'fp-codex-none-20260826'],
  ['C', 'codex',       'pipe', 'fp-codex-pipe-20260826'],
  ['C', 'opencode',    'tab',  'fp-opencode-tab-20260826'],
  ['C', 'opencode',    'none', 'fp-opencode-none-20260826'],
  ['C', 'opencode',    'pipe', 'fp-opencode-pipe-20260826'],
  ['C', 'opencode',    'tab',  'rp-oc-tab-20260827'],
  ['C', 'opencode',    'none', 'rp-oc-none-20260827'],
  ['C', 'opencode',    'pipe', 'rp-oc-pipe-20260827'],
  ['C', 'claude-code', 'tab',  'fp-claudecode-tab-20260826'],
  ['C', 'claude-code', 'none', 'fp-claudecode-none-20260826'],
  ['C', 'claude-code', 'pipe', 'fp-claudecode-pipe-20260826'],
  // epoch B
  ['B', 'codex',       'tab',  'rb-codex-20260825'],
  ['B', 'opencode',    'tab',  'rb-opencode-20260824'],
  ['B', 'claude-code', 'tab',  'rb-claudecode-20260824'],
  // epoch A
  ['A', 'codex',       'tab',  'sb-codex-20260811'],
  ['A', 'opencode',    'tab',  'sb-opencode-20260811'],
  ['A', 'claude-code', 'tab',  'sb-claudecode-20260811'],
];

// ---- price: exact re-implementation of costFromTurns' three columns -------------
function priceTurns(turns) {
  let ideal = 0, real = 0, brk = 0, prevIn = 0, rewrites = 0;
  let ingest = 0, resident = 0, outTok = 0, ctxIntegral = 0;
  for (const tu of turns) {
    const newIn = Math.max(0, tu.in - prevIn);
    const resent = tu.in - newIn;
    const cw = Math.max(0, Math.min(Number(tu.cacheWrite) || 0, tu.in - (Number(tu.cached) || 0)));
    ideal += (newIn * PRICE.in + resent * PRICE.cache + tu.out * PRICE.out) / 1e6;
    real += ((tu.in - (tu.cached || 0) - cw) * PRICE.in + cw * PRICE.in * 1.25
      + (tu.cached || 0) * PRICE.cache + tu.out * PRICE.out) / 1e6;
    let cacheable;
    if (tu.holeAt != null) { cacheable = Math.min(tu.holeAt, tu.in); rewrites++; }
    else if (tu.in < prevIn) { cacheable = 0; rewrites++; }
    else cacheable = Math.min(prevIn, tu.in);
    brk += ((tu.in - cacheable) * PRICE.in + cacheable * PRICE.cache + tu.out * PRICE.out) / 1e6;
    ingest += newIn * PRICE.in / 1e6;
    resident += resent * PRICE.cache / 1e6;
    outTok += tu.out;
    ctxIntegral += tu.in;
    prevIn = tu.in;
  }
  return {
    ideal, real, brk, rewrites,
    ingestUsd: ingest, residentUsd: resident, outputUsd: outTok * PRICE.out / 1e6,
    outTok, ctxIntegral, nTurns: turns.length,
    firstIn: turns.length ? turns[0].in : 0,
    lastIn: turns.length ? turns[turns.length - 1].in : 0,
    ingestTok: turns.reduce((a, t, i, arr) => a + Math.max(0, t.in - (i ? arr[i - 1].in : 0)), 0),
    residentTok: turns.reduce((a, t, i, arr) => a + Math.min(t.in, (i ? arr[i - 1].in : 0)), 0),
    cachedTok: turns.reduce((a, t) => a + (t.cached || 0), 0),
    cacheWriteTok: turns.reduce((a, t) => a + (t.cacheWrite || 0), 0),
    inTok: turns.reduce((a, t) => a + t.in, 0),
  };
}

// ---- codex ---------------------------------------------------------------------
function codexTurns(file) {
  const turns = [];
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return turns; }
  for (const l of txt.split('\n')) {
    if (!l || l.indexOf('token_count') < 0) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const p = o.payload || {};
    if ((p.type || o.type) !== 'token_count') continue;
    const u = p.info?.last_token_usage; if (!u) continue;
    turns.push({
      in: u.input_tokens || 0, cached: u.cached_input_tokens || 0,
      cwRaw: u.cache_write_input_tokens || 0,
      out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
    });
  }
  return turns;
}

// ---- opencode ------------------------------------------------------------------
function opencodeTurns(file) {
  const turns = [];
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return turns; }
  for (const l of txt.split('\n')) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const t = o.type; if (t !== 'step_finish' && t !== 'step-finish') continue;
    const tk = (o.part || {}).tokens || {}; const c = tk.cache || {};
    const cRead = c.read || 0, cWrite = c.write || 0;
    turns.push({
      in: (tk.input || 0) + cRead + cWrite, cached: cRead, cwRaw: cWrite,
      out: (tk.output || 0) + (tk.reasoning || 0),
    });
  }
  return turns;
}

// ---- claude-code ---------------------------------------------------------------
function claudeTurns(file) {
  // dedupe by message id; the record that reports the most tokens wins
  const byId = new Map(); const order = [];
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return { turns: [], noUsage: 0, reqs: 0 }; }
  let noUsage = 0, reqs = 0;
  for (const l of txt.split('\n')) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    const m = o.message; if (!m || o.type !== 'assistant') continue;
    if (!m.id) continue;
    if (!byId.has(m.id)) { byId.set(m.id, { best: -1, usage: null }); order.push(m.id); reqs++; }
    const u = m.usage; if (!u) continue;
    const cached = u.cache_read_input_tokens || 0;
    const cw = u.cache_creation_input_tokens || 0;
    const inp = (u.input_tokens || 0) + cached + cw;
    const out = u.output_tokens || 0;
    const g = byId.get(m.id);
    if (inp + out > g.best) { g.best = inp + out; g.usage = { in: inp, cached, cacheWrite: cw, out }; }
  }
  const turns = [];
  for (const id of order) {
    const g = byId.get(id);
    if (!g.usage) { noUsage++; continue; }
    turns.push(g.usage);
  }
  return { turns, noUsage, reqs };
}

function walk(dir, pred, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

const outRows = [];
for (const [epoch, harness, form, runId] of RUNS) {
  const rp = path.join(RES, runId, 'rows.json');
  if (!fs.existsSync(rp)) { console.error('MISSING', runId); continue; }
  const rows = JSON.parse(fs.readFileSync(rp, 'utf8'));
  for (const r of rows) {
    const rec = {
      epoch, harness, form, runId, taskId: r.taskId, arm: r.arm, rep: r.rep,
      resolved: r.resolved, degenReran: !!r.degenReran,
      rowIdeal: r.idealCostUsd, rowReal: r.costRealizedUsd, rowBrk: r.breakPricedCostUsd,
      rowMainOnly: r.costRealizedMainOnlyUsd ?? null, rowSide: r.costSidechainUsd ?? null,
      rowIdealMainOnly: r.idealCostMainOnlyUsd ?? null,
      calls: r.calls ?? null, toolCounts: r.toolCounts ?? null, idealTurns: r.idealTurns ?? null,
      rowUsage: r.usage ?? null, packingTreatment: r.packingTreatment ?? null,
      f2pFrac: r.f2pFrac ?? null, testResults: r.testResults == null ? null : 'present',
    };
    if (harness === 'codex') {
      const f = r.rolloutFile;
      const turns = f ? codexTurns(f) : [];
      rec.transcript = f; rec.candidates = 1;
      Object.assign(rec, priceTurns(turns));
      rec.cacheWriteRawTok = turns.reduce((a, t) => a + (t.cwRaw || 0), 0);
    } else if (harness === 'opencode') {
      const at = (r.openCodeRawAttempts || []);
      const f = at.length ? path.join('/root/sweet-search-private/eval/task-completion-bench', at[at.length - 1].stdout) : null;
      const turns = f && fs.existsSync(f) ? opencodeTurns(f) : [];
      rec.transcript = f; rec.candidates = at.length;
      Object.assign(rec, priceTurns(turns));
      rec.cacheWriteRawTok = turns.reduce((a, t) => a + (t.cwRaw || 0), 0);
    } else {
      const base = path.join(RES, runId, 'agent-state', `${r.taskId}-${r.arm}`, 'claude-home', 'projects');
      let dirs = [];
      try { dirs = fs.readdirSync(base).filter(d => new RegExp(`(--|-)r${r.rep}[-_]`).test(d) || d.includes(`-r${r.rep}-`)); } catch {}
      const sessions = [];
      for (const d of dirs) {
        for (const f of (fs.readdirSync(path.join(base, d)) || [])) {
          if (f.endsWith('.jsonl')) sessions.push(path.join(base, d, f));
        }
      }
      rec.candidates = sessions.length;
      // pick the session whose aggregate usage best matches the row's own usage aggregate
      const ru = r.usage || {};
      const target = (ru.input_tokens || 0) + (ru.cache_creation_input_tokens || 0)
        + (ru.cache_read_input_tokens || 0) + (ru.output_tokens || 0);
      let best = null, bestErr = Infinity, bestParsed = null;
      for (const s of sessions) {
        const pr = claudeTurns(s);
        const tot = pr.turns.reduce((a, t) => a + t.in + t.out, 0);
        const err = Math.abs(tot - target);
        if (err < bestErr) { bestErr = err; best = s; bestParsed = pr; }
      }
      rec.transcript = best; rec.matchErr = bestErr; rec.matchTarget = target;
      const turns = bestParsed ? bestParsed.turns : [];
      Object.assign(rec, priceTurns(turns));
      rec.mainNoUsage = bestParsed ? bestParsed.noUsage : 0;
      rec.mainReqs = bestParsed ? bestParsed.reqs : 0;
      // sidechain
      let side = { ideal: 0, real: 0, brk: 0, outTok: 0, nTurns: 0 }, subFiles = 0, subReqs = 0, subNoUsage = 0;
      if (best) {
        const sdir = best.replace(/\.jsonl$/, '') + '/subagents';
        if (fs.existsSync(sdir)) {
          for (const f of fs.readdirSync(sdir)) {
            if (!f.endsWith('.jsonl')) continue;
            subFiles++;
            const pr = claudeTurns(path.join(sdir, f));
            subReqs += pr.reqs; subNoUsage += pr.noUsage;
            const p = priceTurns(pr.turns);
            side.ideal += p.ideal; side.real += p.real; side.brk += p.brk;
            side.outTok += p.outTok; side.nTurns += p.nTurns;
          }
        }
      }
      rec.sideIdeal = side.ideal; rec.sideReal = side.real; rec.sideBrk = side.brk;
      rec.sideOutTok = side.outTok; rec.sideTurns = side.nTurns;
      rec.subFiles = subFiles; rec.subReqs = subReqs; rec.subNoUsage = subNoUsage;
      // every-dollar-spent: all sessions in all rep dirs of this cell handled by a separate pass
      rec.allSessions = sessions;
    }
    outRows.push(rec);
  }
  console.error('done', runId, rows.length);
}
fs.writeFileSync('/tmp/fp-inv/p1/rollouts.ndjson', outRows.map(r => JSON.stringify(r)).join('\n') + '\n');
console.error('wrote', outRows.length, 'rows');
