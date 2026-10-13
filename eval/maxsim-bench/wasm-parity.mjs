// node wasm-parity.mjs <old.wasm> <new.wasm> [replay-set-dir...]
// Bit-exact gate and timing for the WASM int4 tier: <old>'s maxsim_dequant_4bit vs
// <new>'s maxsim_dequant_4bit_tiled (falls back to maxsim_dequant_4bit if absent), on
// seeded fixtures (odd / small / large dims, doc lengths around the 64-token tile,
// 1-130 query tokens, zero scales, NaN / huge inputs) and every int4 replayed call,
// one call per candidate as the JS tier makes them. Memory layout as simd-distance.js.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { loadCalls } from './replay.mjs';

const [oldPath, newPath, ...sets] = process.argv.slice(2);
const load = (p) => new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(p)), {}).exports;
const O = load(oldPath), N = load(newPath);
const newFn = N.maxsim_dequant_4bit_tiled ? 'tiled' : 'plain';

function place(ex, q, numQ, dim, doc) {
  const mem = new Uint8Array(ex.memory.buffer);
  const qBytes = numQ * dim * 4, dBytes = doc.numTokens * ((dim + 1) >> 1), nt = doc.numTokens;
  const qPtr = 0, dPtr = qBytes, minPtr = dPtr + dBytes, scalePtr = minPtr + nt * 4, normPtr = scalePtr + nt * 4;
  const scratch = normPtr + nt * 4;
  mem.set(new Uint8Array(q.buffer, q.byteOffset, qBytes), qPtr);
  mem.set(new Uint8Array(doc.tokens.buffer, doc.tokens.byteOffset, dBytes), dPtr);
  for (const [a, p] of [[doc.minArray, minPtr], [doc.scaleArray, scalePtr], [doc.tokenNorms, normPtr]]) mem.set(new Uint8Array(a.buffer, a.byteOffset, nt * 4), p);
  return [qPtr, dPtr, minPtr, scalePtr, normPtr, numQ, nt, dim, scratch];
}
const runOld = (q, numQ, dim, doc) => O.maxsim_dequant_4bit(...place(O, q, numQ, dim, doc).slice(0, 8));
const runNew = (q, numQ, dim, doc) => {
  const a = place(N, q, numQ, dim, doc);
  return newFn === 'tiled' ? N.maxsim_dequant_4bit_tiled(...a) : N.maxsim_dequant_4bit(...a.slice(0, 8));
};

let n = 0, diffs = 0; const first = [];
const check = (label, q, numQ, dim, doc) => {
  const a = runOld(q, numQ, dim, doc), b = runNew(q, numQ, dim, doc); n++;
  if (!Object.is(a, b)) { diffs++; if (first.length < 10) first.push(`${label}: ${a} vs ${b}`); }
};

let s = 7; const r = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
for (const dim of [1, 2, 3, 4, 7, 8, 16, 33, 48, 96, 127, 128, 130, 256]) {
  for (const numQ of [1, 2, 3, 4, 5, 8, 13, 14, 17, 33, 64, 130]) {
    for (const mode of ['plain', 'negate', 'zeroScale', 'nan', 'huge']) {
      const q = new Float32Array(numQ * dim).map(() => (r() * 2 - 1) * (mode === 'negate' ? -1 : 1) * (mode === 'huge' ? 1e30 : 1));
      if (mode === 'nan') q[Math.floor(r() * q.length)] = NaN;
      for (const nt of [0, 1, 3, 4, 5, 63, 64, 65, 130, 300]) {
        const pd = (dim + 1) >> 1;
        const doc = { numTokens: nt, tokens: new Uint8Array(nt * pd).map(() => Math.floor(r() * 256)),
          minArray: new Float32Array(nt).map(() => mode === 'negate' ? Math.fround(0.01 + r() * 0.1) : Math.fround(-0.5 - r() * 0.5)),
          scaleArray: new Float32Array(nt).map(() => mode === 'zeroScale' ? 0 : Math.fround((1 + r()) / 15)),
          tokenNorms: new Float32Array(nt).map(() => Math.fround(0.5 + r() * 3)) };
        if (nt > 0 && mode === 'nan') doc.tokenNorms[0] = 0;
        check(`fx d${dim} q${numQ} t${nt} ${mode}`, q, numQ, dim, doc);
      }
    }
  }
}
console.log(`fixtures: ${n} calls, ${diffs} diffs`);

for (const set of sets) {
  const calls = loadCalls(set).filter(c => c.kind === 'int4');
  let tOld = 0, tNew = 0; const n0 = n, d0 = diffs;
  for (const c of calls) {
    for (const doc of c.cands) check(c.file, c.query, c.numQ, c.dim, doc);
    for (let rep = 0; rep < 3; rep++) {
      let t = performance.now(); for (const doc of c.cands) runOld(c.query, c.numQ, c.dim, doc); tOld += performance.now() - t;
      t = performance.now(); for (const doc of c.cands) runNew(c.query, c.numQ, c.dim, doc); tNew += performance.now() - t;
    }
  }
  console.log(`${set.split('/').pop()}: ${n - n0} doc calls, ${diffs - d0} diffs; time old ${(tOld / 3).toFixed(0)} ms, new (${newFn}) ${(tNew / 3).toFixed(0)} ms, ${(tOld / tNew).toFixed(2)}x`);
}
for (const f of first) console.log('  DIFF', f);
console.log(diffs === 0 ? 'WASM PARITY OK (bit-identical)' : `WASM PARITY FAIL: ${diffs} diffs`);
process.exit(diffs ? 1 : 0);
