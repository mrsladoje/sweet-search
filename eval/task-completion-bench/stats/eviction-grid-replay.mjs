#!/usr/bin/env node
// $0 GATE 0b for lever #3 (phase-aware tool-result eviction).
//
// Replays each rollout under a resident-token CAP. At every edit/test boundary (apply_patch or
// run_tests) the oldest tool-result BODIES are dropped until the resident context fits the cap,
// each replaced by a short refetchable placeholder. Reports, per cap:
//   1. input tokens avoided
//   2. ideal-$ saved under the bench's cache-normalized model
//   3. ideal-$ saved NET of the cache-prefix break that eviction forces  <-- the honest number
//   4. refetch rate: how often an evicted body is demonstrably needed again
//
// WHY (3) EXISTS. Prompt caching is a PREFIX cache. Deleting an item in the middle of the
// conversation invalidates every token after it, so the next request re-pays FULL input price for
// the whole surviving suffix (10x the cache-read rate on Luna: $0.10/M vs $0.01/M). Because
// eviction drops the OLDEST bodies, the break lands near the START of the context and almost the
// entire prefix re-prices. The bench's canonical idealCost is cache-NORMALIZED — it charges every
// re-sent token at the cache rate by construction, so it cannot see this cost at all and would
// silently flatter the lever. Column (3) prices the break explicitly.
//
// REFETCH = the solve-safety signal. An evicted body is counted refetched when a LATER turn
// re-targets it: the same file re-read, the same query/pattern re-issued, or the same test run.
// Separately reported: "blind edits" — an apply_patch to a file whose only read was evicted and
// never re-read, i.e. the agent editing content it can no longer see. High refetch = the cap
// starves the solve, and accuracy is non-negotiable.
//
// Usage: node stats/eviction-grid-replay.mjs <run-dir> [--caps 24000,32000,40000,48000]
//                                            [--tasks dart,mransan] [--json out.json]
import fs from 'node:fs';
import { findRollouts, parseRollout, calibrate, parseArgs } from './resend-census.mjs';
import { MODEL_PRICES } from '../harness/ideal-cost.mjs';

const MODEL = process.env.MODEL || 'openai/gpt-5.6-luna';
const P = MODEL_PRICES[MODEL];
const IN = P.in / 1e6, CA = P.cache / 1e6, OUT = P.out / 1e6;
const PLACEHOLDER_TOK = 30;      // "[evicted: ss-search "…" — 4.2 KB. Re-run to restore.]"

// ---------------------------------------------------------------- call targets
const RUNDIR = /\/root\/\.ss-eval\/runs\/[^\s"']+?__(?:native|sweet)__r\d+__\d+\/?/g;
function cmdOf(call) { const m = call.match(/cmd:\s*"((?:[^"\\]|\\.)*)"/); return m ? m[1].replace(/\\(.)/g, '$1') : ''; }

// What a call is ABOUT: file paths it reads and query strings it issues. Used to decide whether a
// later turn needs an evicted body again.
export function targetsOf(call) {
  const t = new Set();
  const cmd = cmdOf(call);
  if (/apply_patch/.test(call) || /\*\*\* (Update|Add|Delete) File:/.test(call)) {
    for (const m of call.matchAll(/\*\*\* (?:Update|Add|Delete) File:\s*([^\n\\"]+)/g)) t.add('f:' + norm(m[1]));
    return { kind: 'edit', t };
  }
  if (/(^|[^\w])run_tests([^\w]|$)/.test(cmd)) { t.add('TESTS'); return { kind: 'test', t }; }
  // a write_stdin turn is a poll, but the body it returns IS the test log — target it as TESTS so
  // an evicted test log counts as refetched when the suite is run again
  if (/write_stdin/.test(call)) { t.add('TESTS'); return { kind: 'poll', t }; }
  // quoted query / pattern (ss-search, ss-grep, rg, ss-find)
  for (const m of cmd.matchAll(/"([^"]{3,})"/g)) t.add('q:' + m[1].trim().toLowerCase());
  for (const m of cmd.matchAll(/'([^']{3,})'/g)) if (!/^\d+,\d+p$/.test(m[1])) t.add('q:' + m[1].trim().toLowerCase());
  // file-ish tokens
  for (const m of cmd.matchAll(/(?:^|[\s"'=])((?:[\w.@+-]+\/)*[\w.@+-]+\.[A-Za-z][\w]{0,6})(?=$|[\s"';:,)])/g)) {
    const p = norm(m[1]);
    if (p && !/^-/.test(p)) t.add('f:' + p);
  }
  return { kind: 'read', t };
}
function norm(p) { return String(p).replace(RUNDIR, '').replace(/^\.\//, '').replace(/^\/+/, '').trim(); }

// ---------------------------------------------------------------- replay one rollout at one cap
export function replay(ro, cal, cap) {
  const r0 = ro.requests[0];
  if (!r0) return null;
  const preamble = r0.in;
  const tokOfBody = (b) => Math.max(1, Math.round(b.bytes * cal.b.toolB));
  const agentTok = (pre) => pre.agentB * cal.b.agentB + pre.reasonB * cal.b.reasonB;

  const N = ro.requests.length;
  const meta = ro.requests.map(r => ({ ...targetsOf(r.call || ''), call: r.call || '' }));
  const evicted = new Map();          // bodyIndex -> {turn, body}

  // TOKEN position of body i in the prefix = preamble + agent tokens present when it arrived +
  // the (post-eviction) size of every body before it. This is the point a hole invalidates the
  // prefix cache from, so it must be a token count, never an array index.
  const bodyPos = (bodies, upto) => {
    const b = bodies[upto];
    let pos = preamble + agentTok(ro.requests[Math.min(b.turn, N - 1)].pre);
    for (let j = 0; j < upto; j++) pos += evicted.has(j) ? PLACEHOLDER_TOK : tokOfBody(bodies[j]);
    return pos;
  };

  const out = { cap, reqs: [], evictedBodies: [], avoided: 0, evictions: 0, breaks: 0 };
  let prevInEv = 0;
  let cacheValidTok = null;           // set when a hole was just punched; consumed by next request

  for (let k = 0; k < N; k++) {
    const r = ro.requests[k];
    let bodyTok = 0, saved = 0;
    r.bodies.forEach((b, i) => {
      if (evicted.has(i)) { bodyTok += PLACEHOLDER_TOK; saved += tokOfBody(b) - PLACEHOLDER_TOK; }
      else bodyTok += tokOfBody(b);
    });
    const inEv = Math.max(preamble, r.in - saved);
    out.avoided += r.in - inEv;

    // A hole punched since the last request invalidates the cache from that hole onward, so this
    // one request re-pays full input rate for the surviving suffix. Afterwards the cache re-forms.
    let newIn;
    if (cacheValidTok !== null) { newIn = Math.max(0, inEv - Math.min(cacheValidTok, inEv)); out.breaks++; }
    else newIn = Math.max(0, inEv - prevInEv);
    const resent = inEv - newIn;
    const idealNew = Math.max(0, inEv - prevInEv);        // cache-NORMALIZED: blind to the break
    out.reqs.push({
      k, inBase: r.in, inEv, newIn, resent, out: r.out, cls: r.cls,
      costEvReal: newIn * IN + resent * CA + r.out * OUT,
      costEvIdeal: idealNew * IN + (inEv - idealNew) * CA + r.out * OUT,
    });
    cacheValidTok = null;
    prevInEv = inEv;

    // --- boundary: evict oldest bodies until the resident context fits the cap
    if (meta[k].kind === 'edit' || meta[k].kind === 'test') {
      let resident = preamble + agentTok(r.pre) + bodyTok;
      for (let i = 0; i < r.bodies.length && resident > cap; i++) {
        if (evicted.has(i)) continue;
        const t = tokOfBody(r.bodies[i]);
        if (t <= PLACEHOLDER_TOK * 2) continue;               // nothing to gain
        const pos = bodyPos(r.bodies, i);
        evicted.set(i, { turn: k, body: r.bodies[i], idx: i });
        resident -= (t - PLACEHOLDER_TOK);
        out.evictions++;
        cacheValidTok = cacheValidTok === null ? pos : Math.min(cacheValidTok, pos);
      }
    }
  }

  // ---- refetch analysis: is an evicted body needed again LATER?
  const bodyMeta = (b) => targetsOf(b.call || '');
  const allBodies = ro.requests.length ? ro.requests[ro.requests.length - 1].bodies : [];
  let refetched = 0, blindEdits = 0;
  for (const [i, ev] of evicted) {
    const b = allBodies[i] || ev.body;
    const bt = bodyMeta(b);
    let hit = false;
    for (let k = ev.turn + 1; k < N; k++) {
      const m = meta[k];
      if (m.kind === 'poll') continue;
      for (const tg of bt.t) {
        if (tg.startsWith('f:') && m.t.has(tg) && m.kind === 'read') { hit = true; break; }
        if (tg.startsWith('q:') && m.t.has(tg)) { hit = true; break; }
        if (tg === 'TESTS' && m.kind === 'test') { hit = true; break; }
      }
      if (hit) break;
    }
    if (hit) refetched++;
    else {
      // blind edit: a later patch touches a file this evicted body was the only view of
      for (let k = ev.turn + 1; k < N; k++) {
        if (meta[k].kind !== 'edit') continue;
        for (const tg of bt.t) if (tg.startsWith('f:') && meta[k].t.has(tg)) { blindEdits++; k = N; break; }
      }
    }
    out.evictedBodies.push({ idx: i, turn: ev.turn, tok: tokOfBody(b), refetched: hit });
  }
  out.refetched = refetched;
  out.blindEdits = blindEdits;
  out.nEvicted = evicted.size;
  return out;
}

function baseCost(ro) {
  let c = 0, prev = 0, inTot = 0;
  for (const r of ro.requests) {
    const newIn = Math.max(0, r.in - prev);
    c += newIn * IN + (r.in - newIn) * CA + r.out * OUT;
    inTot += r.in; prev = r.in;
  }
  return { cost: c, inTot };
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), ['--caps', '--tasks', '--json']);
  const caps = (flags['--caps'] || '24000,32000,40000,48000').split(',').map(Number);
  const taskFilter = flags['--tasks'] || '';
  const jsonOut = flags['--json'] || null;
  const root = positional[0];
  if (!root) { console.error('usage: eviction-grid-replay.mjs <run-dir> [--caps ...] [--tasks ...]'); process.exit(1); }

  const parsed = findRollouts(root).map(parseRollout).filter(r => r.requests.length);
  const cal = calibrate(parsed);
  const pats = taskFilter ? taskFilter.split(',').map(s => s.trim()).filter(Boolean) : null;
  const sel = pats ? parsed.filter(r => pats.some(p => r.key.includes(p))) : parsed;

  console.log(`=== EVICTION TRIGGER-GRID REPLAY — ${sel.length} rollouts${pats ? ` (tasks: ${pats.join(',')})` : ''} ===`);
  console.log(`calibration: toolBody ${(1 / cal.b.toolB).toFixed(2)} B/tok, fit R^2=${cal.r2.toFixed(3)}   placeholder=${PLACEHOLDER_TOK} tok`);
  const bases = sel.map(baseCost);
  const baseTot = bases.reduce((s, b) => s + b.cost, 0);
  const baseIn = bases.reduce((s, b) => s + b.inTot, 0);
  const preambles = sel.map(r => r.requests[0].in);
  console.log(`baseline: ideal $${baseTot.toFixed(5)}, ${baseIn} input tokens, preamble ${Math.min(...preambles)}–${Math.max(...preambles)} tok (un-evictable floor)\n`);

  const rows = [];
  for (const cap of caps) {
    const res = sel.map(ro => replay(ro, cal, cap));
    const evictions = res.reduce((s, r) => s + r.evictions, 0);
    const nEv = res.reduce((s, r) => s + r.nEvicted, 0);
    const refet = res.reduce((s, r) => s + r.refetched, 0);
    const blind = res.reduce((s, r) => s + r.blindEdits, 0);
    const avoided = res.reduce((s, r) => s + r.avoided, 0);
    const idealEv = res.reduce((s, r) => s + r.reqs.reduce((a, q) => a + q.costEvIdeal, 0), 0);
    const realEv = res.reduce((s, r) => s + r.reqs.reduce((a, q) => a + q.costEvReal, 0), 0);
    const row = {
      cap, evictions, nEv, refetched: refet, blindEdits: blind,
      refetchPct: nEv ? 100 * refet / nEv : 0,
      avoidedPct: 100 * avoided / baseIn,
      idealSavedPct: 100 * (baseTot - idealEv) / baseTot,
      netSavedPct: 100 * (baseTot - realEv) / baseTot,
    };
    rows.push(row);
  }
  console.log('cap\tevicts\tbodies\tinput-avoided\tideal-$ saved\tNET-$ saved (cache break priced)\trefetch\tblind edits');
  for (const r of rows) {
    console.log(`${(r.cap / 1000) + 'K'}\t${r.evictions}\t${r.nEv}\t${r.avoidedPct.toFixed(1)}%\t\t${r.idealSavedPct >= 0 ? '+' : ''}${r.idealSavedPct.toFixed(1)}%\t\t${r.netSavedPct >= 0 ? '+' : ''}${r.netSavedPct.toFixed(1)}%\t\t\t\t${r.refetchPct.toFixed(0)}%\t${r.blindEdits}`);
  }
  console.log('\n(ideal-$ = the bench\'s cache-normalized model, which cannot see a cache break.');
  console.log(' NET-$ = the same trajectory with the forced prefix-cache break priced at the full input rate.)');

  if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify({ model: MODEL, caps, rows, baseTot, baseIn }, null, 2)); console.log(`\nwrote ${jsonOut}`); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
