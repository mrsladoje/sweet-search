#!/usr/bin/env node
// $0 GATE 0a for lever #3 (phase-aware tool-result eviction).
//
// Question: after lever #1 (auto-await run_tests; SS_RT_LONGYIELD, shipped) removed the POLL part
// of the resident re-send tail, HOW MUCH TAIL IS LEFT — and how much of it is the part eviction
// can actually remove (prior tool-result BODIES, not the fixed preamble)?
//
// COST MODEL = canonical idealCost (harness/ideal-cost.mjs), never realized:
//   newIn_k = max(0, in_k - in_{k-1});  resent_k = in_k - newIn_k
//   cost_k  = newIn_k*IN + resent_k*CACHE + out_k*OUT
// The "resident re-send tax" is the resent_k*CACHE term. Its COMPOSITION is exact, not guessed:
// re-sent tokens are the prefix carried over from request k-1 and new content is appended at the
// end, so the k-1 snapshot's composition IS the composition of the re-sent block.
//
// CONTEXT ACCOUNTING. Categories, in the order codex lays them out:
//   frame     — agent system prompt + developer/user messages (the fixed, un-evictable preamble)
//   agent     — the model's own output: assistant messages, tool-call args, encrypted reasoning
//   toolBody  — custom_tool_call_output / function_call_output payloads   <-- THE EVICTION TARGET
//
// ALIGNMENT (measured, not assumed). In a codex rollout the per-turn order is
//     reasoning -> custom_tool_call -> custom_tool_call_output -> token_count
// so the token_count line reports the request that PRODUCED the reasoning/call above it. That
// request's input therefore contains NEITHER its own reasoning/call NOR the tool output that
// answered it — all three land in the NEXT request's prefix. Regressing input-token growth on
// measured byte growth confirms it: this alignment fits R^2 = 0.95 with slopes of 3.9 bytes/token
// (tool bodies) and 4.4 bytes/token (agent text); the naive "everything earlier in the file"
// alignment fits R^2 = 0.02 and implies an impossible 8.6 bytes/token. Run --calib to re-derive.
//
// CALIBRATION. Bytes -> tokens uses slopes fitted from the data itself (pooled least squares
// through the origin on per-turn deltas, which cancels the fixed preamble), so nothing depends on
// a 4-chars-per-token guess. The preamble needs no fit at all: the FIRST request's input_tokens
// IS the preamble, exactly, because no agent or tool item exists yet.
//
// Poll turns (write_stdin / wait) are classified with poll-census's rule and excluded from the
// headline so lever #1's already-banked win is never double-counted into lever #3's case.
//
// Usage:
//   node stats/resend-census.mjs <run-dir|rollout.jsonl> [...] [--json out.json] [--calib]
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_PRICES } from '../harness/ideal-cost.mjs';

const MODEL = process.env.MODEL || 'openai/gpt-5.6-luna';
const PRICE = MODEL_PRICES[MODEL];
if (!PRICE) throw new Error(`resend-census: no pricing for "${MODEL}"`);
const IN = PRICE.in / 1e6, CA = PRICE.cache / 1e6, OUT = PRICE.out / 1e6;

const KINDS = ['frame', 'agent', 'toolBody'];
const COLS = ['agentB', 'reasonB', 'toolB'];      // fitted byte columns

export function findRollouts(target) {
  if (fs.statSync(target).isFile()) return [target];
  const out = [];
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^rollout-.*\.jsonl$/.test(e.name)) out.push(p);
    }
  };
  walk(target);
  return out.sort();
}

export function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text;
    if (typeof v.content === 'string') return v.content;
    if (v.content) return textOf(v.content);
    return JSON.stringify(v);
  }
  return String(v);
}

// poll-census's rule: a write_stdin / wait turn is a poll (lever #1's target).
export function classify(input) {
  if (typeof input !== 'string') input = JSON.stringify(input);
  if (/write_stdin/.test(input)) return 'poll';
  const cmdMatch = input.match(/cmd:\s*"((?:[^"\\]|\\.)*)"/);
  const cmd = cmdMatch ? cmdMatch[1] : '';
  const rtCmd = /run_tests/.test(input);
  if (/(^|[^\w])run_tests([^\w]|$)/.test(cmd) || (rtCmd && /exec_command/.test(input) && !cmd)) return 'run_tests';
  return 'other';
}

// ---------------------------------------------------------------- parse
// requests[k].pre = {frame, agentB, reasonB, toolB} bytes present in request k's prefix.
// requests[k].bodies = the tool-result bodies resident in that prefix (for the 0b replay).
export function parseRollout(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const cum = { frame: 0, agentB: 0, reasonB: 0, toolB: 0 };
  const bodies = [];                 // resident tool bodies, in arrival order
  let pend = [], pendBodies = [], pendCls = null, cwd = '', lastCall = '';
  const requests = [];

  for (const l of lines) {
    if (!l.startsWith('{')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    const p = j.payload || {};
    const t = p.type || j.type;

    if (j.type === 'session_meta') {
      cwd = p.cwd || '';
      cum.frame += Buffer.byteLength(textOf(p.base_instructions), 'utf8');
      continue;
    }
    if (t === 'message') {
      const b = Buffer.byteLength(textOf(p.content), 'utf8');
      if (p.role === 'assistant') pend.push(['agentB', b]);
      else cum.frame += b;                          // frame arrives before the request it serves
      continue;
    }
    if (t === 'reasoning') { pend.push(['reasonB', Buffer.byteLength(p.encrypted_content || textOf(p.summary), 'utf8')]); continue; }
    if (t === 'custom_tool_call' || t === 'function_call') {
      const a = typeof p.input === 'string' ? p.input : JSON.stringify(p.arguments ?? p.input ?? '');
      pend.push(['agentB', Buffer.byteLength(a, 'utf8')]);
      lastCall = a;
      pendCls = (t === 'function_call' && p.name === 'wait') ? 'poll' : classify(a);
      continue;
    }
    if (t === 'custom_tool_call_output' || t === 'function_call_output') {
      const body = textOf(p.output);
      const b = Buffer.byteLength(body, 'utf8');
      pend.push(['toolB', b]);
      pendBodies.push({ bytes: b, call: lastCall, cls: pendCls || 'other', turn: requests.length, text: body });
      continue;
    }
    if (t === 'token_count' && p.info?.last_token_usage) {
      const u = p.info.last_token_usage;
      requests.push({
        in: u.input_tokens || 0,
        cached: u.cached_input_tokens || 0,
        out: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
        cls: pendCls || 'other',
        call: lastCall,
        pre: { ...cum },
        bodies: bodies.slice(),                     // snapshot of resident bodies
      });
      for (const [k, b] of pend) cum[k] += b;       // this turn's items join the NEXT prefix
      bodies.push(...pendBodies);
      pend = []; pendBodies = []; pendCls = null;
    }
  }

  const base = path.basename(cwd);
  const m = base.match(/^(.*)__(native|sweet)__r(\d+)__/);
  return {
    file, cwd, key: m ? m[1] : base || path.basename(file),
    arm: m ? m[2] : 'unknown', rep: m ? +m[3] : 0, requests,
  };
}

// ---------------------------------------------------------------- calibration
// Pooled least squares through the origin on per-turn deltas: Δin ~ Σ b_c · Δbytes_c.
// Deltas cancel the fixed preamble, so no intercept is needed and none is fitted.
export function calibrate(rollouts) {
  const rows = [];
  for (const ro of rollouts) {
    for (let i = 1; i < ro.requests.length; i++) {
      const y = ro.requests[i].in - ro.requests[i - 1].in;
      if (y <= 0) continue;                       // compaction / no growth: not informative
      const x = COLS.map(c => ro.requests[i].pre[c] - ro.requests[i - 1].pre[c]);
      if (x.some(v => v < 0)) continue;
      rows.push({ x, y });
    }
  }
  const n = COLS.length;
  const A = Array.from({ length: n }, () => Array(n + 1).fill(0));
  for (const { x, y } of rows) for (let a = 0; a < n; a++) { A[a][n] += x[a] * y; for (let b = 0; b < n; b++) A[a][b] += x[a] * x[b]; }
  for (let c = 0; c < n; c++) {
    let pv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
    [A[c], A[pv]] = [A[pv], A[c]];
    const dg = A[c][c]; if (!dg) throw new Error('resend-census: singular calibration');
    for (let k = c; k <= n; k++) A[c][k] /= dg;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  const b = {}; COLS.forEach((c, i) => { b[c] = A[i][n]; });
  let ss = 0, st = 0, mae = 0; const yb = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  for (const r of rows) { const pr = COLS.reduce((s, c, i) => s + r.x[i] * b[c], 0); ss += (r.y - pr) ** 2; st += (r.y - yb) ** 2; mae += Math.abs(r.y - pr); }
  return { b, n: rows.length, r2: 1 - ss / st, mae: mae / rows.length, meanDelta: yb };
}

// Token composition of a request's prefix. The preamble is EXACT (request 0's input_tokens);
// growth is priced with the fitted slopes; any residual is spread over the growing categories
// so the parts sum to the authoritative input_tokens.
export function composition(r, cal, preambleTok, frame0Bytes) {
  const est = {
    frame: preambleTok + Math.max(0, r.pre.frame - frame0Bytes) * cal.b.agentB,
    agent: r.pre.agentB * cal.b.agentB + r.pre.reasonB * cal.b.reasonB,
    toolBody: r.pre.toolB * cal.b.toolB,
  };
  const sum = KINDS.reduce((s, k) => s + est[k], 0);
  const resid = r.in - sum;
  const grow = est.agent + est.toolBody;
  if (grow > 0 && Number.isFinite(resid)) {        // spread residual over the growing parts
    est.agent += resid * (est.agent / grow);
    est.toolBody += resid * (est.toolBody / grow);
  } else est.frame += resid;
  for (const k of KINDS) est[k] = Math.max(0, est[k]);
  const s2 = KINDS.reduce((s, k) => s + est[k], 0) || 1;
  for (const k of KINDS) est[k] *= r.in / s2;
  return { ...est, resid };
}

export function censusRollout(ro, cal) {
  const r0 = ro.requests[0];
  const preambleTok = r0 ? r0.in : 0;
  const frame0 = r0 ? r0.pre.frame : 0;
  const comps = ro.requests.map(r => composition(r, cal, preambleTok, frame0));
  const z = () => ({ frame: 0, agent: 0, toolBody: 0 });
  const acc = {
    reqs: 0, polls: 0, ideal: 0, newInUsd: 0, outUsd: 0, resendUsd: 0, resendBy: z(),
    npReqs: 0, npResendUsd: 0, npResendBy: z(), realCachedUsd: 0, residAbs: 0, compactions: 0,
  };
  let prevIn = 0;
  for (let i = 0; i < ro.requests.length; i++) {
    const r = ro.requests[i];
    const newIn = Math.max(0, r.in - prevIn);
    const resent = r.in - newIn;
    if (r.in < prevIn) acc.compactions++;
    const resendUsd = resent * CA;
    const src = comps[i > 0 ? i - 1 : i];           // the re-sent block IS prefix k-1
    const srcTot = KINDS.reduce((s, k) => s + src[k], 0) || 1;
    acc.reqs++; acc.ideal += newIn * IN + resent * CA + r.out * OUT;
    acc.newInUsd += newIn * IN; acc.outUsd += r.out * OUT; acc.resendUsd += resendUsd;
    acc.realCachedUsd += r.cached * CA; acc.residAbs += Math.abs(comps[i].resid);
    for (const k of KINDS) acc.resendBy[k] += resendUsd * (src[k] / srcTot);
    if (r.cls === 'poll') acc.polls++;
    else {
      acc.npReqs++; acc.npResendUsd += resendUsd;
      for (const k of KINDS) acc.npResendBy[k] += resendUsd * (src[k] / srcTot);
    }
    prevIn = r.in;
  }
  return { ...ro, acc, comps, preambleTok };
}

export function loadCensus(targets) {
  const files = targets.flatMap(findRollouts);
  const parsed = files.map(parseRollout).filter(r => r.requests.length);
  const cal = calibrate(parsed);
  return { cal, rolls: parsed.map(r => censusRollout(r, cal)), files };
}

const pct = (a, b) => (b > 0 ? (100 * a / b).toFixed(1) + '%' : '—');

// Shared CLI parsing: value-taking flags consume the next token, everything else is positional.
export function parseArgs(argv, valueFlags) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valueFlags.includes(a)) { flags[a] = argv[++i]; continue; }
    if (a.startsWith('--')) { flags[a] = true; continue; }
    positional.push(a);
  }
  return { flags, positional };
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2), ['--json']);
  const jsonOut = flags['--json'] || null;
  const targets = positional;
  if (!targets.length) { console.error('usage: resend-census.mjs <run-dir|rollout.jsonl> [--json out.json]'); process.exit(1); }

  const { cal, rolls, files } = loadCensus(targets);

  console.log(`=== RESIDUAL RE-SEND CENSUS — ${rolls.length} rollouts (${files.length} files), model ${MODEL} ===`);
  console.log(`calibration (pooled, ${cal.n} turn-deltas, no intercept): `
    + COLS.map(c => `${c}=${cal.b[c].toFixed(4)} tok/B (${(1 / cal.b[c]).toFixed(2)} B/tok)`).join('  '));
  console.log(`  fit R^2=${cal.r2.toFixed(4)}  MAE=${cal.mae.toFixed(0)} tok on mean Δin=${cal.meanDelta.toFixed(0)} tok (${pct(cal.mae, cal.meanDelta)})`);

  const z = () => ({ frame: 0, agent: 0, toolBody: 0 });
  const blank = () => ({ n: 0, reqs: 0, polls: 0, ideal: 0, newInUsd: 0, outUsd: 0, resendUsd: 0, resendBy: z(), npReqs: 0, npResendUsd: 0, npResendBy: z(), realCachedUsd: 0, compactions: 0 });
  const byArm = { native: blank(), sweet: blank(), unknown: blank() };
  const all = blank();
  for (const r of rolls) for (const t of [byArm[r.arm] || byArm.unknown, all]) {
    t.n++; t.reqs += r.acc.reqs; t.polls += r.acc.polls; t.ideal += r.acc.ideal;
    t.newInUsd += r.acc.newInUsd; t.outUsd += r.acc.outUsd; t.resendUsd += r.acc.resendUsd;
    t.npReqs += r.acc.npReqs; t.npResendUsd += r.acc.npResendUsd; t.realCachedUsd += r.acc.realCachedUsd;
    t.compactions += r.acc.compactions;
    for (const k of KINDS) { t.resendBy[k] += r.acc.resendBy[k]; t.npResendBy[k] += r.acc.npResendBy[k]; }
  }

  const row = (label, t) => {
    console.log(`\n--- ${label}: ${t.n} rollouts, ${t.reqs} requests (${t.polls} polls = ${pct(t.polls, t.reqs)}), ${t.compactions} context drops ---`);
    console.log(`  ideal spend           $${t.ideal.toFixed(5)}   = newIn $${t.newInUsd.toFixed(5)} + re-send $${t.resendUsd.toFixed(5)} + output $${t.outUsd.toFixed(5)}`);
    console.log(`  resident re-send tax  $${t.resendUsd.toFixed(5)}  (${pct(t.resendUsd, t.ideal)} of ideal)   [realized-cache cross-check $${t.realCachedUsd.toFixed(5)}]`);
    console.log(`    frame(un-evictable) $${t.resendBy.frame.toFixed(5)} (${pct(t.resendBy.frame, t.ideal)})`);
    console.log(`    agent output        $${t.resendBy.agent.toFixed(5)} (${pct(t.resendBy.agent, t.ideal)})`);
    console.log(`    TOOL BODIES         $${t.resendBy.toolBody.toFixed(5)} (${pct(t.resendBy.toolBody, t.ideal)})`);
    console.log(`  >>> RESIDUAL NON-POLL TOOL-BODY TAIL = $${t.npResendBy.toolBody.toFixed(5)} = ${pct(t.npResendBy.toolBody, t.ideal)} of ideal spend <<<`);
  };
  row('ALL', all);
  for (const a of ['native', 'sweet']) if (byArm[a].n) row(a, byArm[a]);

  console.log('\n=== per-rollout tool-body tail (top 16 by $) ===');
  console.log('key\tarm\trep\treqs\tideal$\ttoolBody$\t%ideal');
  const perR = rolls.map(r => ({ key: r.key, arm: r.arm, rep: r.rep, reqs: r.acc.reqs, ideal: r.acc.ideal, tb: r.acc.npResendBy.toolBody }))
    .sort((a, b) => b.tb - a.tb);
  for (const r of perR.slice(0, 16)) console.log(`${r.key}\t${r.arm}\tr${r.rep}\t${r.reqs}\t$${r.ideal.toFixed(5)}\t$${r.tb.toFixed(5)}\t${pct(r.tb, r.ideal)}`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({
      model: MODEL, calibration: cal, all, byArm,
      perRollout: rolls.map(r => ({ key: r.key, arm: r.arm, rep: r.rep, file: r.file, acc: r.acc, preambleTok: r.preambleTok })),
    }, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
