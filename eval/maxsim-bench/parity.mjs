// node parity.mjs <addonA.node> <addonB.node> [replay-set-dir...]
// Bit-exact gate between two MaxSim builds: every score of every call must be the
// same f64 (Object.is, so NaN == NaN and -0 != +0). Covers all four entry points on
// seeded edge-case fixtures (every kernel branch: dims that are odd, % 4 != 0,
// % 16 != 0, % 32 != 0; tile edges; > 64 query tokens; empty docs; zero scales;
// all-negative similarities; zero, huge and NaN inputs), then the replayed calls
// (int4 as captured, plus the same docs requantized to int8 per token).
import { createRequire } from 'node:module';
import { loadCalls } from './replay.mjs';
import { toInt8 } from './int8.mjs';
import { toSlab } from './slab.mjs';
import { packMaxSimDocs } from '../../core/infrastructure/maxsim-pack.js';

const [a, b, ...sets] = process.argv.slice(2);
const req = createRequire(import.meta.url);
const A = req(a), B = req(b);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = Math.fround;

function makeQuery(r, numQ, dim, mode) {
  const q = new Float32Array(numQ * dim);
  for (let i = 0; i < q.length; i++) q[i] = r() * 2 - 1;
  if (mode === 'negate') for (let i = 0; i < q.length; i++) q[i] = -Math.abs(q[i]);
  if (mode === 'zeroRow' && numQ) q.fill(0, 0, dim);
  if (mode === 'huge') for (let i = 0; i < q.length; i++) q[i] *= 1e30;
  if (mode === 'nan' && q.length) q[Math.floor(r() * q.length)] = NaN;
  if (mode === 'tiny') for (let i = 0; i < q.length; i++) q[i] *= 1e-30;
  return q;
}

// One candidate in all three storage forms (int4 per token, int8 per token, int8 per doc).
function makeDoc(r, nt, dim, mode) {
  const minArray = new Float32Array(nt), scaleArray = new Float32Array(nt), tokenNorms = new Float32Array(nt);
  const pd = (dim + 1) >> 1;
  const t4 = Buffer.alloc(nt * pd), t8 = Buffer.alloc(nt * dim);
  for (let t = 0; t < nt; t++) {
    minArray[t] = mode === 'positive' ? f(r() * 0.1) : f(-0.5 - r() * 0.5);
    scaleArray[t] = mode === 'zeroScale' ? 0 : f((1 + r()) / 15);
    let n2 = 0;
    for (let d = 0; d < dim; d++) {
      const c4 = Math.floor(r() * 16), c8 = Math.floor(r() * 256);
      t4[t * pd + (d >> 1)] |= (d & 1) ? c4 << 4 : c4;
      t8[t * dim + d] = c8; // stored as (code - 128) & 255, i.e. the raw signed byte
      const v = f(f(c4 * scaleArray[t]) + minArray[t]);
      n2 += v * v;
    }
    tokenNorms[t] = mode === 'zeroNorm' && t === 0 ? 0 : f(Math.sqrt(n2) * (1 + (r() - 0.5) * 1e-3));
  }
  const base = { numTokens: nt, dim, minArray, scaleArray, tokenNorms };
  return {
    int4: { tokens: t4, ...base },
    int8: { tokens: t8, ...base },
    perdoc: { tokens: t8, numTokens: nt, dim, min: mode === 'positive' ? 0.01 : -0.7, scale: mode === 'zeroScale' ? 0 : f(1.3 / 255) },
  };
}

const FN = { int4: 'maxsimScoreBatch4Bit', int8: 'maxsimScoreBatchPertoken', perdoc: 'maxsimScoreBatch' };
let calls = 0, scores = 0, diffs = 0;
const firstDiffs = [];
function compare(label, sa, sb) {
  calls++;
  if (sa.length !== sb.length) { diffs++; if (firstDiffs.length < 10) firstDiffs.push(`${label}: length ${sa.length} vs ${sb.length}`); return; }
  for (let i = 0; i < sa.length; i++) {
    scores++;
    if (!Object.is(sa[i], sb[i])) { diffs++; if (firstDiffs.length < 10) firstDiffs.push(`${label}[${i}]: ${sa[i]} vs ${sb[i]}`); }
  }
}
function both(label, fn, ...args) {
  let ra, rb, ea, eb;
  try { ra = A[fn](...args); } catch (e) { ea = String(e.message); }
  try { rb = B[fn](...args); } catch (e) { eb = String(e.message); }
  if (ea || eb) {
    calls++;
    if (ea !== eb) { diffs++; if (firstDiffs.length < 10) firstDiffs.push(`${label}: error ${ea} vs ${eb}`); }
    return;
  }
  compare(label, Array.isArray(ra) || ArrayBuffer.isView(ra) ? Array.from(ra) : [ra], Array.isArray(rb) || ArrayBuffer.isView(rb) ? Array.from(rb) : [rb]);
}

// The packed entry point (B only, when it has one) must give A's object-API
// scores for the same docs, with the arrays in separate buffers or in one slab.
const packed = (label, kind, q, numQ, dim, cands) => {
  if (!B.maxsimScorePacked || (kind !== 'int4' && kind !== 'int8')) return;
  let ra, ea;
  try { ra = Array.from(A[FN[kind]](q, numQ, dim, cands)); } catch (e) { ea = String(e.message); }
  for (const [form, docs] of [['separate', cands], ['slab', toSlab(cands)]]) {
    const { buffers, desc } = packMaxSimDocs(docs);
    let rb, eb;
    try { rb = Array.from(B.maxsimScorePacked(q, numQ, dim, kind === 'int4' ? 4 : 8, buffers, desc)); } catch (e) { eb = String(e.message); }
    if (ea || eb) { calls++; if (!ea || !eb) { diffs++; if (firstDiffs.length < 10) firstDiffs.push(`${label} packed-${form}: error ${ea} vs ${eb}`); } continue; }
    compare(`${label} packed-${form}`, ra, rb);
  }
};

// ---- fixtures
const r = rng(42);
const DIMS = [1, 2, 3, 4, 8, 12, 16, 20, 24, 32, 48, 60, 64, 96, 100, 127, 128, 130, 160, 256];
const NQ = [0, 1, 2, 3, 4, 5, 7, 8, 13, 14, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 130];
const NT = [0, 1, 2, 3, 4, 5, 7, 8, 9, 63, 64, 65, 127, 128, 129, 257, 512];
const MODES = ['plain', 'negate', 'zeroRow', 'huge', 'nan', 'tiny', 'positive', 'zeroScale', 'zeroNorm'];
for (const dim of DIMS) {
  for (const numQ of NQ) {
    if (dim >= 96 && numQ > 33 && r() < 0.6) continue; // keep the run short
    for (const mode of MODES) {
      if (mode !== 'plain' && r() < 0.5) continue;
      const q = makeQuery(r, numQ, dim, mode);
      const pool = 1 + Math.floor(r() * 9);
      const docs = Array.from({ length: pool }, () => makeDoc(r, NT[Math.floor(r() * NT.length)], dim, mode));
      for (const kind of ['int4', 'int8', 'perdoc']) both(`fx ${kind} d${dim} q${numQ} ${mode}`, FN[kind], q, numQ, dim, docs.map(d => d[kind]));
      for (const kind of ['int4', 'int8']) packed(`fx ${kind} d${dim} q${numQ} ${mode}`, kind, q, numQ, dim, docs.map(d => d[kind]));
      const d0 = docs[0].int4;
      const fl = new Float32Array(d0.numTokens * dim);
      for (let i = 0; i < fl.length; i++) fl[i] = r() * 2 - 1;
      both(`fx single d${dim} q${numQ}`, 'maxsimScoreSingle', q, fl, numQ, d0.numTokens, dim);
    }
  }
}
// large pools and long docs at the production dim
for (const pool of [0, 1, 2, 3, 15, 16, 17, 64, 200, 1000]) {
  const q = makeQuery(r, 14, 128, 'plain');
  const docs = Array.from({ length: pool }, () => makeDoc(r, 1 + Math.floor(r() * 512), 128, 'plain'));
  for (const kind of ['int4', 'int8', 'perdoc']) both(`fx ${kind} pool${pool}`, FN[kind], q, 14, 128, docs.map(d => d[kind]));
  for (const kind of ['int4', 'int8']) packed(`fx ${kind} pool${pool}`, kind, q, 14, 128, docs.map(d => d[kind]));
}
// dim mismatch must stay a JS error with the same message
{
  const q = makeQuery(r, 4, 128, 'plain');
  const docs = [makeDoc(r, 5, 128, 'plain'), makeDoc(r, 5, 96, 'plain')];
  for (const kind of ['int4', 'int8', 'perdoc']) both(`fx ${kind} dim-mismatch`, FN[kind], q, 4, 128, docs.map(d => d[kind]));
  for (const kind of ['int4', 'int8']) packed(`fx ${kind} dim-mismatch`, kind, q, 4, 128, docs.map(d => d[kind]));
}
// malformed packed descriptors must be JS errors, never a crash
if (B.maxsimScorePacked) {
  const q = makeQuery(r, 4, 128, 'plain');
  const { buffers, desc } = packMaxSimDocs(toSlab([makeDoc(r, 5, 128, 'plain').int4]));
  const bad = [
    ['bits', 5, buffers, desc],
    ['desc length', 4, buffers, desc.subarray(0, 9)],
    ['dim', 4, buffers, desc.map((v, i) => (i === 1 ? 96 : v))],
    ['buffer index', 4, buffers, desc.map((v, i) => (i === 2 ? 7 : v))],
    ['range', 4, buffers, desc.map((v, i) => (i === 3 ? 1e9 : v))],
    ['token count', 4, buffers, desc.map((v, i) => (i === 0 ? 1e6 : v))],
    ['alignment', 4, buffers, desc.map((v, i) => (i === 5 ? v + 1 : v))],
  ];
  for (const [what, bits, bufs, d] of bad) {
    calls++;
    let threw = false;
    try { B.maxsimScorePacked(q, 4, 128, bits, bufs, d); } catch { threw = true; }
    if (!threw) { diffs++; firstDiffs.push(`packed: malformed ${what} did not throw`); }
  }
}
const fxCalls = calls, fxScores = scores, fxDiffs = diffs;
console.log(`fixtures: ${fxCalls} calls, ${fxScores} scores, ${fxDiffs} diffs`);

// ---- replayed calls
for (const set of sets) {
  const c0 = calls, s0 = scores, d0 = diffs;
  for (const c of loadCalls(set)) {
    both(`${c.file} int4`, FN[c.kind], c.query, c.numQ, c.dim, c.cands);
    packed(`${c.file}`, c.kind, c.query, c.numQ, c.dim, c.cands);
    if (c.kind === 'int4') {
      const i8 = c.cands.map(toInt8);
      both(`${c.file} int8`, FN.int8, c.query, c.numQ, c.dim, i8);
      packed(`${c.file} int8`, 'int8', c.query, c.numQ, c.dim, i8);
    }
  }
  console.log(`${set}: ${calls - c0} calls, ${scores - s0} scores, ${diffs - d0} diffs`);
}
for (const d of firstDiffs) console.log('  DIFF', d);
console.log(diffs === 0 ? 'PARITY OK (bit-identical)' : `PARITY FAIL: ${diffs} diffs`);
process.exit(diffs === 0 ? 0 : 1);
