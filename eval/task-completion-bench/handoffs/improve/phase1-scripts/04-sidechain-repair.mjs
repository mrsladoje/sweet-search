// SIDECHAIN PRICING REPAIR (SLATE-A-UBER §3 blocker, handoff option 1).
//
// LAYER 1 — EXACT. The transcript writes one record per content block, all sharing
// message.id. The reader dedups by id and keeps the FIRST record, whose usage is often
// zeroed; a later record for the same id carries the real numbers. Merging by id and
// taking the usage-bearing record recovers those requests with no estimation at all.
//
// LAYER 2 — IMPUTED. Requests whose every record is zeroed have no usage anywhere.
// They are priced as a LOW/MID/HIGH band:
//   context T(N): LOW = previous known T, MID = linear interpolation, HIGH = next known T
//   output      : LOW = 0, MID = fitted visible-content regression, HIGH = 2x MID
// The cache-normalized `ideal` column's fresh-input term telescopes to the FINAL context
// size, so it is invariant to the split; only the cheap re-sent term and the output term
// move with the imputation. That is why the band is narrow.
//
// Reproduction gate: recomputed main-only must match the recorded row within 0.5%.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { costFromTurns, priceFor } from '/root/sweet-search-private/eval/task-completion-bench/harness/ideal-cost.mjs';

const RESULTS = '/root/sweet-search-private/eval/task-completion-bench/results';
const RUN = process.argv[2] || 'screen-v3-20260812';
const OUT = process.argv[3] || null;
const root = path.join(RESULTS, RUN, 'agent-state');
const rows = JSON.parse(readFileSync(path.join(RESULTS, RUN, 'rows.json'), 'utf8'));

// out = 0.810 * (visibleChars/3.5) + 119.2  — fitted on all 260 known sidechain requests
// across both claude runs (R2 = 0.792, MAPE 41.5%). See g1f-calibration.
const OUT_SLOPE = 0.810, OUT_INTERCEPT = 119.2;

function mergedRequests(file) {
  const order = [], byId = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t[0] !== '{') continue;
    let e; try { e = JSON.parse(t); } catch { continue; }
    const m = e.message;
    if (!m || m.role !== 'assistant' || !m.id) continue;
    if (!byId.has(m.id)) { byId.set(m.id, { id: m.id, blocks: [], usage: null, best: -1 }); order.push(m.id); }
    const r = byId.get(m.id);
    for (const b of (m.content || [])) r.blocks.push(b);
    const u = m.usage || {};
    const tot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0)
      + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    if (tot > r.best) { r.best = tot; r.usage = u; }
  }
  return order.map(id => {
    const r = byId.get(id), u = r.usage || {};
    const inTok = u.input_tokens || 0, cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
    let visible = 0;
    for (const b of r.blocks) {
      if (b.type === 'text') visible += (b.text || '').length;
      else if (b.type === 'thinking') visible += (b.thinking || '').length;
      else if (b.type === 'tool_use') visible += JSON.stringify(b.input || {}).length;
    }
    const T = inTok + cr + cw;
    return { id, known: T > 0 || (u.output_tokens || 0) > 0, inTok, cr, cw, T, out: u.output_tokens || 0, visible };
  });
}

/** Build LOW/MID/HIGH turn sequences for one transcript. */
function turnBands(reqs) {
  const n = reqs.length;
  const knownIdx = reqs.map((r, i) => r.known ? i : -1).filter(i => i >= 0);
  const bands = { low: [], mid: [], high: [] };
  for (let i = 0; i < n; i++) {
    const r = reqs[i];
    if (r.known) {
      for (const k of ['low', 'mid', 'high']) bands[k].push({ in: r.T, cached: r.cr, cacheWrite: r.cw, out: r.out });
      continue;
    }
    const prev = knownIdx.filter(k => k < i).pop();
    const next = knownIdx.find(k => k > i);
    const Tprev = prev == null ? 0 : reqs[prev].T;
    const Tnext = next == null ? (prev == null ? 0 : reqs[prev].T) : reqs[next].T;
    const span = (next == null ? i : next) - (prev == null ? -1 : prev);
    const step = (i - (prev == null ? -1 : prev)) / Math.max(1, span);
    const Tmid = Math.round(Tprev + (Tnext - Tprev) * step);
    const outMid = Math.max(0, Math.round(OUT_SLOPE * (r.visible / 3.5) + OUT_INTERCEPT));
    // cache split: everything up to the previous context is a cache read, the rest is written
    const mk = (T, out) => ({ in: T, cached: Math.min(Tprev, T), cacheWrite: Math.max(0, T - Tprev), out });
    bands.low.push(mk(Tprev, 0));
    bands.mid.push(mk(Tmid, outMid));
    bands.high.push(mk(Tnext, outMid * 2));
  }
  return bands;
}

const repOfSlug = s => { const m = /--r(\d+)--\d+$/.exec(s); return m ? +m[1] : null; };

function sessionsFor(taskId, arm, rep) {
  const projects = path.join(root, `${taskId}-${arm}`, 'claude-home', 'projects');
  if (!existsSync(projects)) return [];
  const out = [];
  for (const slug of readdirSync(projects)) {
    if (repOfSlug(slug) !== rep) continue;
    const dir = path.join(projects, slug);
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const sid = e.name.replace(/\.jsonl$/, '');
      const main = mergedRequests(path.join(dir, e.name));
      const subDir = path.join(dir, sid, 'subagents');
      const sides = [];
      if (existsSync(subDir)) {
        for (const s of readdirSync(subDir).filter(n => n.endsWith('.jsonl')).sort()) {
          const reqs = mergedRequests(path.join(subDir, s));
          if (reqs.length) sides.push({ name: s, reqs });
        }
      }
      if (main.length || sides.length) out.push({ sid, main, sides });
    }
  }
  return out;
}

const summary = { run: RUN, rows: rows.length, reproduced: 0, mismatched: [], noState: [],
  reqKnown: 0, reqImputed: 0, cellsWithSide: 0 };
const out = [];
for (const r of rows) {
  const row = { ...r };
  const price = priceFor(r.model);
  const sessions = sessionsFor(r.taskId, r.arm, r.rep);
  if (!sessions.length) { summary.noState.push(`${r.taskId}/${r.arm}/r${r.rep}`); out.push(row); continue; }
  // pick the session whose main-only realized cost reproduces the recorded row
  const scored = sessions.map(s => {
    const turns = s.main.filter(x => x.known).map(x => ({ in: x.T, cached: x.cr, cacheWrite: x.cw, out: x.out }));
    return { ...s, turns, mainCost: costFromTurns(turns, price) };
  });
  // Runs before the cache-write premium shipped (7562b42) carry a realized column that
  // omits the 1.25x cache-creation charge, so those reproduce on the `ideal` column,
  // which never involved that premium. Pick the field the run actually recorded.
  const useIdeal = r.costRealizedMainOnlyUsd == null;
  const recorded = useIdeal ? (r.idealCostUsd ?? 0) : r.costRealizedMainOnlyUsd;
  const got = c => useIdeal ? c.idealUsd : c.realFromTurnsUsd;
  scored.sort((a, b) => Math.abs(got(a.mainCost) - recorded) - Math.abs(got(b.mainCost) - recorded));
  const pick = scored[0];
  const drift = recorded ? Math.abs(got(pick.mainCost) - recorded) / recorded : 0;
  if (drift > 0.005) summary.mismatched.push({ cell: `${r.taskId}/${r.arm}/r${r.rep}`, recorded, got: +got(pick.mainCost).toFixed(6), driftPct: +(drift * 100).toFixed(2) });
  else summary.reproduced++;

  const band = { low: { ideal: 0, real: 0 }, mid: { ideal: 0, real: 0 }, high: { ideal: 0, real: 0 } };
  let known = 0, imputed = 0;
  for (const s of pick.sides) {
    known += s.reqs.filter(x => x.known).length;
    imputed += s.reqs.filter(x => !x.known).length;
    const b = turnBands(s.reqs);
    for (const k of ['low', 'mid', 'high']) {
      const c = costFromTurns(b[k], price);
      band[k].ideal += c.idealUsd; band[k].real += c.realFromTurnsUsd;
    }
  }
  summary.reqKnown += known; summary.reqImputed += imputed;
  if (pick.sides.length) summary.cellsWithSide++;

  row.sidechainCountFixed = pick.sides.length;
  row.sidechainReqKnown = known;
  row.sidechainReqImputed = imputed;
  row.mainOnlyRecomputedRealUsd = +pick.mainCost.realFromTurnsUsd.toFixed(6);
  row.mainOnlyRecomputedIdealUsd = +pick.mainCost.idealUsd.toFixed(6);
  for (const k of ['low', 'mid', 'high']) {
    row[`sidechainIdeal_${k}`] = +band[k].ideal.toFixed(6);
    row[`sidechainReal_${k}`] = +band[k].real.toFixed(6);
    row[`inclusiveIdeal_${k}`] = +((r.idealCostMainOnlyUsd ?? r.idealCostUsd ?? 0) + band[k].ideal).toFixed(6);
    row[`inclusiveReal_${k}`] = +((r.costRealizedMainOnlyUsd ?? 0) + band[k].real).toFixed(6);
  }
  out.push(row);
}

console.log(`\n=== sidechain repair: ${RUN} ===`);
console.log(`rows ${summary.rows} | main-only reproduced within 0.5%: ${summary.reproduced}/${summary.rows} | rows with sidechains: ${summary.cellsWithSide}`);
console.log(`sidechain requests: known ${summary.reqKnown}, imputed ${summary.reqImputed} (${(summary.reqImputed / (summary.reqKnown + summary.reqImputed) * 100).toFixed(1)}%)`);
if (summary.mismatched.length) { console.log(`*** ${summary.mismatched.length} DID NOT REPRODUCE:`); for (const m of summary.mismatched) console.log('   ', m); }
if (summary.noState.length) console.log(`no retained state: ${summary.noState.length}`);

const sum = (rs, f) => rs.reduce((a, x) => a + (x[f] || 0), 0);
console.log('\nper-arm totals (32 rollouts each), main-only ideal + sidechain ideal band:');
for (const arm of ['native', 'sweet']) {
  const rs = out.filter(x => x.arm === arm);
  const main = rs.reduce((a, x) => a + (x.idealCostMainOnlyUsd ?? x.idealCostUsd ?? 0), 0);
  console.log(`  ${arm}: main $${main.toFixed(6)} | side LOW $${sum(rs, 'sidechainIdeal_low').toFixed(6)} MID $${sum(rs, 'sidechainIdeal_mid').toFixed(6)} HIGH $${sum(rs, 'sidechainIdeal_high').toFixed(6)}`);
  console.log(`         inclusive LOW $${sum(rs, 'inclusiveIdeal_low').toFixed(6)} MID $${sum(rs, 'inclusiveIdeal_mid').toFixed(6)} HIGH $${sum(rs, 'inclusiveIdeal_high').toFixed(6)}`);
}
const nat = out.filter(x => x.arm === 'native'), swe = out.filter(x => x.arm === 'sweet');
for (const k of ['low', 'mid', 'high']) {
  const n = sum(nat, `inclusiveIdeal_${k}`), s = sum(swe, `inclusiveIdeal_${k}`);
  console.log(`delta ${k.toUpperCase()}: native $${n.toFixed(6)} sweet $${s.toFixed(6)} = ${((s / n - 1) * 100).toFixed(2)}%`);
}
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`); }
