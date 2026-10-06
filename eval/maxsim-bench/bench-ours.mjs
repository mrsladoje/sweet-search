// node bench-ours.mjs <replay-root> <out.json> [reps] [variant...]
// Times the production native MaxSim kernels on replayed calls. Variants:
//   int4      as captured (production path)
//   int8      same docs requantized per token to int8 (production int8-pertoken path)
// Per call: latency = median of `reps` timed runs after 1 warm run. Reports scores for parity.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const SRC = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const [root, outFile, repsArg, ...variantsArg] = process.argv.slice(2);
const reps = Number(repsArg || 7);
const variants = variantsArg.length ? variantsArg : ['int4', 'int8'];
import { toInt8 as toInt8PerToken } from './int8.mjs';
const { loadNativeAddon } = await import(`${SRC}/core/infrastructure/native-resolver.js`);
// ADDON=<path to .node>: time a specific build instead of the resolved production addon.
const mod = process.env.ADDON ? (await import('node:module')).createRequire(import.meta.url)(process.env.ADDON) : loadNativeAddon().mod;

export function loadCalls(root) {
  const calls = [];
  for (const repo of fs.readdirSync(root).sort()) {
    const dir = path.join(root, repo);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.startsWith('index-')).sort()) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
        const m = JSON.parse(line);
        const buf = fs.readFileSync(path.join(dir, m.file));
        let off = 0;
        const take = (n) => { const b = buf.subarray(off, off + n); off += n; return b; };
        const f32 = (n) => { const b = take(n * 4); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
        const query = f32(m.numQ * m.dim);
        const cands = m.cands.map(c => {
          const tokens = Buffer.from(take(c.tb));
          if (m.kind === 'perdoc') return { tokens, numTokens: c.nt, dim: c.dim, min: c.min, scale: c.scale };
          return { tokens, numTokens: c.nt, dim: c.dim, minArray: f32(c.nt), scaleArray: f32(c.nt), tokenNorms: f32(c.nt) };
        });
        calls.push({ repo, file: m.file, kind: m.kind, numQ: m.numQ, dim: m.dim, query, cands, ref: m.scores });
      }
    }
  }
  return calls;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const calls = loadCalls(root);
  const fn = { int4: 'maxsimScoreBatch4Bit', int8: 'maxsimScoreBatchPertoken', perdoc: 'maxsimScoreBatch' };
  const prepared = {};
  for (const v of variants) prepared[v] = calls.map(c => (v === 'int8' && c.kind === 'int4') ? c.cands.map(toInt8PerToken) : c.cands);
  const res = { reps, addon: process.env.ADDON || 'production', variants: {} };
  for (const v of variants) res.variants[v] = { lat: [], scores: [] };
  // Interleave variants per call so drift hits all variants equally.
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    for (const v of variants) {
      const kind = v === 'int8' && c.kind === 'int4' ? 'int8' : (v === 'int4' ? c.kind : c.kind === 'int4' ? 'int8' : c.kind);
      const f = mod[fn[kind]].bind(mod); const cands = prepared[v][i];
      let s = f(c.query, c.numQ, c.dim, cands); const ts = [];
      for (let r = 0; r < reps; r++) { const t0 = performance.now(); s = f(c.query, c.numQ, c.dim, cands); ts.push(performance.now() - t0); }
      ts.sort((a, b) => a - b);
      res.variants[v].lat.push(ts[ts.length >> 1]); res.variants[v].scores.push(Array.from(s));
    }
  }
  res.calls = calls.map(c => ({ repo: c.repo, file: c.file, kind: c.kind, numQ: c.numQ, pool: c.cands.length, docTokens: c.cands.reduce((a, x) => a + x.numTokens, 0), ref: c.ref }));
  fs.writeFileSync(outFile, JSON.stringify(res));
  for (const v of variants) {
    const l = [...res.variants[v].lat].sort((a, b) => a - b); const sum = l.reduce((a, b) => a + b, 0);
    console.log(v, `n=${l.length} p50=${l[l.length >> 1].toFixed(3)}ms p95=${l[Math.floor(l.length * 0.95)].toFixed(3)}ms total=${sum.toFixed(1)}ms`);
  }
}
