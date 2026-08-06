#!/usr/bin/env node
/**
 * W0.b — fusion feasibility mining + economics gate (offline, $0).
 *
 * Reuses the retired 551 search->read candidate reproduction from
 * search-read-replay.mjs, then adds the three DB-blocked measurements the audit
 * counter never computed (TURN_PACKING_FINAL §1.2b, §3 W0.b):
 *   1. distinctFiles per read envelope  -> multi-FILE vs multi-range share
 *   2. targetRank in the preceding search -> p_hit @1/@3 (Mechanism B resolver)
 *   3. R = read-payload span tokens       -> break-even vs the resend tax
 * Coefficients are fit EMPIRICALLY from the DB's per-turn token/cost ledger
 * (Grok-4.5 via openrouter) — no guessed list prices.
 *
 * Usage: node stats/w0b-fusion-economics.mjs <path-to-opencode.db>
 * Read-only. Never touches HO2 (retired-run window only, by construction).
 */
import Database from 'better-sqlite3';
import {
  selectHistoricalSessions,
  extractSearchReadCandidates,
  extractHistoricalReadPayloads,
} from './search-read-replay.mjs';

const DB_PATH = process.argv[2];
if (!DB_PATH) { console.error('usage: node w0b-fusion-economics.mjs <db>'); process.exit(1); }
if (/heldout2|ho2/i.test(DB_PATH)) { console.error('refusing HO2 path'); process.exit(1); }

const READ_ALL = /\bss-read\s+(\S+)(?:\s+(\d+)\s+(\d+))?/g;
const tok = s => Math.ceil(String(s || '').length / 4); // chars/4 token proxy

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

const db = new Database(DB_PATH, { readonly: true });

// --- task ids straight from the DB (bypass trajectory-dir requirement) ---
const taskIds = [...new Set(db.prepare(
  "select directory from session where directory like '%__sweet__r0__%'").all()
  .map(r => { const m = String(r.directory).match(/\/runs\/(.+)__sweet__r0__\d+$/); return m ? m[1] : null; })
  .filter(Boolean))];
const selected = selectHistoricalSessions(db, taskIds);
const candidates = extractSearchReadCandidates(db, selected);

// ---------- per-session turn ledger (for T_remaining + rate fit) ----------
// Fit effective per-token rates from EVERY assistant turn: cost ~ a*newIn + b*cacheRead + c*out.
// tokens.input is NON-cached input; tokens.cache.read is additional cached input.
// resident context re-sent that turn = input + cache.read.
const fitRows = [];
for (const row of db.prepare(
  "select data from message where data like '%\"role\": \"assistant\"%' or data like '%\"role\":\"assistant\"%'").all()) {
  let j; try { j = JSON.parse(row.data); } catch { continue; }
  if (j.role !== 'assistant' || !j.tokens || typeof j.cost !== 'number') continue;
  const t = j.tokens, cacheRead = t.cache?.read || 0;
  const newIn = t.input || 0;
  fitRows.push({ newIn, cacheRead, out: (t.output || 0) + (t.reasoning || 0), cost: j.cost,
                 resident: newIn + cacheRead });
}
// Proper 3-variable ordinary least squares (normal equations) over ALL turns:
//   cost ~ c_new*newIn + c_cached*cacheRead + c_out*out   (no intercept; rates are per-token)
function fitRates(rows) {
  const X = rows.map(r => [r.newIn, r.cacheRead, r.out]);
  const y = rows.map(r => r.cost);
  // XtX (3x3) and Xty (3)
  const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; const Xty = [0, 0, 0];
  for (let n = 0; n < X.length; n++) {
    for (let i = 0; i < 3; i++) {
      Xty[i] += X[n][i] * y[n];
      for (let k = 0; k < 3; k++) XtX[i][k] += X[n][i] * X[n][k];
    }
  }
  // solve 3x3 via Gaussian elimination
  const A = XtX.map((r, i) => [...r, Xty[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col; for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 3; r++) if (r !== col) { const f = A[r][col] / A[col][col]; for (let c = col; c <= 3; c++) A[r][c] -= f * A[col][c]; }
  }
  const b = [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
  return { c_new: Math.max(0, b[0]), c_cached: Math.max(0, b[1]), c_out: Math.max(0, b[2]),
           nCleanIn: rows.filter(r => r.cacheRead < 50).length, nHighCache: rows.filter(r => r.cacheRead > 1000).length };
}
const rates = fitRates(fitRows);

// typical per-turn resident + output (median over mid-session turns)
const residents = fitRows.map(r => r.resident).filter(x => x > 0);
const outs = fitRows.map(r => r.out);
const W = pct(residents, 50);          // median resident context tokens
const oTurn = pct(outs, 50);           // median output tokens/turn
const turnCost = W * rates.c_cached + oTurn * rates.c_out;

// ---------- per-candidate feasibility metrics ----------
// session -> ordered assistant-turn count (for T_remaining)
const turnCountBySession = new Map();
function sessionTurns(sid) {
  if (turnCountBySession.has(sid)) return turnCountBySession.get(sid);
  const n = db.prepare(
    `select count(*) n from message where session_id=? and
     (data like '%"role": "assistant"%' or data like '%"role":"assistant"%')`).get(sid).n;
  turnCountBySession.set(sid, n);
  return n;
}

function orderedFilesFromLead(leadOutput) {
  // distinct file paths in order of first appearance: "path/to/File.ext:NN: ..."
  const seen = new Set(); const order = [];
  for (const m of leadOutput.matchAll(/^([^\s:]+\.[A-Za-z0-9_]+):\d+:/gm)) {
    if (!seen.has(m[1])) { seen.add(m[1]); order.push(m[1]); }
  }
  // fallback: also catch "# ss-read PATH" style / bare path lines if the above is thin
  if (order.length < 2) {
    for (const m of leadOutput.matchAll(/(?:^|\s)([\w./-]+\.[A-Za-z0-9_]+)(?=[\s:)]|$)/gm)) {
      if (!seen.has(m[1])) { seen.add(m[1]); order.push(m[1]); }
    }
  }
  return order;
}
const base = s => { const c = String(s).replace(/^["']|["']$/g, ''); return c.includes('/') ? c.slice(c.lastIndexOf('/') + 1) : c; };

const recs = [];
for (const c of candidates) {
  const leadOutput = c.lead.map(l => l.output.slice(0, 20000)).join('\n');
  const ordered = orderedFilesFromLead(leadOutput);
  // read paths (full) across the whole envelope
  const readPaths = c.reads.flatMap(call => [...String(call.command).matchAll(READ_ALL)].map(m => m[1].replace(/^["']|["']$/g, '')));
  const distinctFiles = new Set(readPaths).size;
  // rank of each read target (min rank across its appearances); rank by basename match
  const ranks = readPaths.map(p => {
    const b = base(p);
    const idx = ordered.findIndex(f => base(f) === b);
    return idx >= 0 ? idx + 1 : Infinity; // Infinity = named in output but not as a ranked hit line
  });
  const bestRank = Math.min(...ranks);
  // R = span tokens actually consumed (historical read payloads)
  const payloads = extractHistoricalReadPayloads(c.reads);
  const R = payloads.reduce((s, p) => s + tok(p.body), 0);
  const total = sessionTurns(c.sessionId);
  const Trem = Math.max(0, total - c.turn); // remaining turns after the hop
  recs.push({ id: c.id, distinctFiles, bestRank, ranks, R, Trem, nReadPaths: readPaths.length });
}

// ---------- aggregate ----------
const multiFile = recs.filter(r => r.distinctFiles >= 2).length;
const multiRead = recs.filter(r => r.nReadPaths >= 2).length;
const rankable = recs.filter(r => Number.isFinite(r.bestRank));
const pHit1 = rankable.filter(r => r.bestRank <= 1).length / recs.length;
const pHit3 = rankable.filter(r => r.bestRank <= 3).length / recs.length;
const pHit5 = rankable.filter(r => r.bestRank <= 5).length / recs.length;
const Rs = recs.map(r => r.R).filter(x => x > 0);
const Trems = recs.map(r => r.Trem);

// ---------- economics gate ----------
// Mechanism B net per candidate: saves ~one turn with prob p_hit(top-k), pays resend tax on R.
// net = pHit*turnCost - R*(c_new + c_cached*Trem)
function netFor(r, k) {
  const hit = Number.isFinite(r.bestRank) && r.bestRank <= k ? 1 : 0;
  const p = hit; // per-candidate realized hit under resolver top-k
  return p * turnCost - r.R * (rates.c_new + rates.c_cached * r.Trem);
}
function bootstrapLCB(vals, reps = 2000, lo = 0.10) {
  // deterministic bootstrap (index by hash of position; no Math.random per env rules)
  const n = vals.length; const means = [];
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let b = 0; b < reps; b++) {
    let s = 0; for (let i = 0; i < n; i++) s += vals[Math.floor(rnd() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return { lcb: means[Math.floor(lo * reps)], mean: mean(vals) };
}

const netTop1 = recs.map(r => netFor(r, 1));
const netTop3 = recs.map(r => netFor(r, 3));
const bTop1 = bootstrapLCB(netTop1);
const bTop3 = bootstrapLCB(netTop3);
const R_max1 = turnCost / (rates.c_new + rates.c_cached * mean(Trems));

// ---- sensitivity: what would flip the gate? (top-3 resolver throughout) ----
// (a) eviction pairing (W4): fused payload evicted after use -> tax = one injection only.
const netEvict = recs.map(r => {
  const hit = Number.isFinite(r.bestRank) && r.bestRank <= 3 ? 1 : 0;
  return hit * turnCost - r.R * rates.c_new; // no c_cached*Trem resend
});
// (b) span cap: clamp R to a tight budget (span-precise §1.10).
const netCap = cap => recs.map(r => {
  const hit = Number.isFinite(r.bestRank) && r.bestRank <= 3 ? 1 : 0;
  const Rc = Math.min(r.R, cap);
  return hit * turnCost - Rc * (rates.c_new + rates.c_cached * r.Trem);
});
// (c) Trem sweep: hold everything, vary remaining-turn count.
const netAtTrem = T => recs.map(r => {
  const hit = Number.isFinite(r.bestRank) && r.bestRank <= 3 ? 1 : 0;
  return hit * turnCost - r.R * (rates.c_new + rates.c_cached * T);
});
const bEvict = bootstrapLCB(netEvict);
const bCap600 = bootstrapLCB(netCap(600));
const bCap400 = bootstrapLCB(netCap(400));
const bTrem8 = bootstrapLCB(netAtTrem(8));
const bTrem4 = bootstrapLCB(netAtTrem(4));

db.close();

const out = {
  candidates: recs.length,
  rates: {
    c_new_per_tok: rates.c_new, c_cached_per_tok: rates.c_cached, c_out_per_tok: rates.c_out,
    c_new_per_M: +(rates.c_new * 1e6).toFixed(3), c_cached_per_M: +(rates.c_cached * 1e6).toFixed(3),
    c_out_per_M: +(rates.c_out * 1e6).toFixed(3),
    fit_support: { cleanInputTurns: rates.nCleanIn, highCacheTurns: rates.nHighCache, totalTurns: fitRows.length },
  },
  turnModel: { W_resident_median: W, output_median: oTurn, turnCost_usd: +turnCost.toFixed(5),
               Trem_mean: +mean(Trems).toFixed(1), Trem_median: pct(Trems, 50) },
  feasibility: {
    multiFile_envelopes: multiFile, multiFile_share: +(multiFile / recs.length).toFixed(3),
    multiRead_envelopes: multiRead, multiRead_share: +(multiRead / recs.length).toFixed(3),
    distinctFile_hist: [1, 2, 3, 4].map(k => ({ files: k, n: recs.filter(r => r.distinctFiles === k).length })),
    pHit_top1: +pHit1.toFixed(3), pHit_top3: +pHit3.toFixed(3), pHit_top5: +pHit5.toFixed(3),
    rankable_share: +(rankable.length / recs.length).toFixed(3),
  },
  spanTokens_R: { median: pct(Rs, 50), p75: pct(Rs, 75), p90: pct(Rs, 90), mean: Math.round(mean(Rs)) },
  economics: {
    R_max1_breakeven_tokens: Math.round(R_max1),
    net_top1_usd: { mean: +bTop1.mean.toFixed(5), lcb90: +bTop1.lcb.toFixed(5) },
    net_top3_usd: { mean: +bTop3.mean.toFixed(5), lcb90: +bTop3.lcb.toFixed(5) },
    GATE_top1_GO: bTop1.lcb > 0, GATE_top3_GO: bTop3.lcb > 0,
  },
  sensitivity_top3: {
    with_eviction_W4: { mean: +bEvict.mean.toFixed(5), lcb90: +bEvict.lcb.toFixed(5), GO: bEvict.lcb > 0 },
    span_cap_600: { mean: +bCap600.mean.toFixed(5), lcb90: +bCap600.lcb.toFixed(5), GO: bCap600.lcb > 0 },
    span_cap_400: { mean: +bCap400.mean.toFixed(5), lcb90: +bCap400.lcb.toFixed(5), GO: bCap400.lcb > 0 },
    trem_8: { mean: +bTrem8.mean.toFixed(5), lcb90: +bTrem8.lcb.toFixed(5), GO: bTrem8.lcb > 0 },
    trem_4: { mean: +bTrem4.mean.toFixed(5), lcb90: +bTrem4.lcb.toFixed(5), GO: bTrem4.lcb > 0 },
  },
};
console.log(JSON.stringify(out, null, 2));
