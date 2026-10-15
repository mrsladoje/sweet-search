// node bench-node.mjs --arm NAME --out FILE.json --set DIR [--set DIR ...] [--reps N] [--gap-ms G] [--limit N] [--stride N]
//                      [--keep-scores] [--job-key K]
//
// The Node twin of bench.py (same timing protocol, same JSON: every timed repetition in
// ts_ns, provenance per call, contract-S references from the per-set cache that
// contracts.py --ensure builds, atomic output with complete=true) for the paths a
// sweet-search process actually runs:
//   production  core/infrastructure/simd-distance.js nativeMaxSimPacked, the call the
//               LI rerank stage makes (per-call JS packing and N-API included)
// All arms see the docs laid out as the index loader lays them out: every call's
// docs are copied once, before any timing, into shared 64 MB slabs.
//   prewarm     production, with nativeMaxSimPrewarm() called PREP_US (busy JS work,
//               default 100 µs) before the call, as the rerank stage does on entry;
//               latency = the prewarm call + the scoring call (the JS work is not
//               counted: it runs either way)
//   wasm        the WASM SIMD tier (fused int4 kernel, one call per candidate), used
//               when the native addon is unavailable
//   js          the plain-JS tier (_maxSimScore4BitImplicit), the last fallback
//   legacy      the path before this change: per call, one candidate object per doc
//               (Buffer.from + object literal, as late-interaction-index.js built them)
//               into maxsimScoreBatch4Bit of the addon at LEGACY_ADDON
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadCalls, loadProvenance } from './replay.mjs';
import { packAll, makeBuild, busy } from './node-arms.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const sets = argv.flatMap((a, i) => (a === '--set' ? [argv[i + 1]] : []));
const arm = opt('arm'), outFile = opt('out');
const reps = Number(opt('reps', 5)), gapMs = Number(opt('gap-ms', 0)), limit = Number(opt('limit', 0)), stride = Number(opt('stride', 1));
const PREP = Number(process.env.PREP_US || 100) / 1000;
const keepAll = argv.includes('--keep-scores'), jobKey = opt('job-key', '');

const SRC = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const sd = await import(`${SRC}/core/infrastructure/simd-distance.js`);
await sd.initWasm?.();
const jsScore = arm === 'js'
  ? (await import(`${SRC}/core/ranking/late-interaction-index.js`)).LateInteractionIndex.prototype._maxSimScore4BitImplicit
  : null;
const legacy = arm === 'legacy' ? (await import('node:module')).createRequire(import.meta.url)(process.env.LEGACY_ADDON) : null;

const build = makeBuild({ sd, arm, legacy, jsScore, prepMs: PREP });

// Contract-S reference (float64, from the raw nibbles) from the set's cache
// <set>/refs-v2 (contracts.py --ensure). Every node arm runs contract S with the clamp,
// so its reference (a) and (b) are both S-clamp.
function refReader(root) {
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'refs-v2', 'index.json'), 'utf8'));
  const arrays = new Map();
  return (c) => {
    const [o, n] = idx.calls[`${c.repo}/${c.file}`];
    if (!arrays.has(c.repo)) {
      const b = fs.readFileSync(path.join(root, 'refs-v2', c.repo, 'S-clamp.f64'));
      arrays.set(c.repo, new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8));
    }
    return Array.from(arrays.get(c.repo).subarray(o, o + n));
  };
}

const agree = (ref, got) => {
  const order = (s) => s.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[1]);
  const oR = order(ref), oG = order(got); const k = Math.min(10, got.length);
  return [!got.length || oR[0] === oG[0], k ? oR.slice(0, k).filter(i => oG.slice(0, k).includes(i)).length / k : 1];
};

const out = { env: { arm, reps, gap_ms: gapMs, sets, node: process.version, platform: `${os.platform()} ${os.release()}`, machine: os.arch(), cpu: os.cpus()[0]?.model, cpu_count: os.cpus().length, loadavg: os.loadavg(), started: new Date().toISOString(), instance: process.env.SS_INSTANCE_ID || os.hostname() },
  arm: `node:${arm}`, contract: 'S', clamp: true, precision: 'int4', ref_a: 'S-clamp', ref_b: 'S-clamp', job_key: jobKey, complete: false, calls: [] };
for (const root of sets) {
  const refOf = refReader(root), prov = loadProvenance(root);
  const name = path.basename(root.replace(/\/$/, '')), keep = keepAll || name.startsWith('beir-');
  let calls = loadCalls(root).filter((_, i) => i % stride === 0);
  if (limit) calls = calls.slice(0, limit);
  packAll(calls);
  for (const c of calls) {
    if (c.kind !== 'int4' && arm !== 'production' && arm !== 'prewarm') throw new Error('wasm/js/legacy arms cover int4 calls only');
    const run = build(c);
    const got = Array.from(run());
    const ts = [];
    for (let r = 0; r < reps; r++) {
      if (gapMs > 0) busy(gapMs);
      const extra = run.before ? run.before() : 0;
      const t0 = process.hrtime.bigint(); run(); ts.push(Number(process.hrtime.bigint() - t0) + Math.round(extra * 1e6));
    }
    const sorted = [...ts].sort((a, b) => a - b), mid = sorted.length >> 1;
    const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const ref = refOf(c);
    const [top1, top10] = agree(ref, got);
    const pv = prov.get(`${c.repo}/${c.file}`) || {};
    const rec = { set: name, repo: c.repo, file: c.file, query_id: pv.query_id ?? null, query_sha256: pv.query_sha256 ?? null,
      nq: c.numQ, pool: c.cands.length, tokens: c.cands.reduce((a, d) => a + d.numTokens, 0), ms: med / 1e6, ts_ns: ts,
      err: got.length ? Math.max(...got.map((g, i) => Math.abs(g - ref[i]))) : 0, err_input: 0, top1, top10, top1_S: top1, top10_S: top10 };
    if (keep) rec.scores = got;
    out.calls.push(rec);
  }
}
out.env.loadavg_end = os.loadavg(); out.env.ended = new Date().toISOString();
out.complete = true; out.n_calls = out.calls.length;
fs.writeFileSync(outFile + '.tmp', JSON.stringify(out));
fs.renameSync(outFile + '.tmp', outFile);
const lat = out.calls.map(c => c.ms).sort((a, b) => a - b);
console.log(`${arm} gap=${gapMs}ms calls=${lat.length} p50=${lat[lat.length >> 1].toFixed(4)} ms total=${lat.reduce((a, b) => a + b, 0).toFixed(1)} ms max|err|=${Math.max(...out.calls.map(c => c.err)).toExponential(2)} top1_S=${(out.calls.filter(c => c.top1).length / lat.length * 100).toFixed(2)}%`);
process.exit(0);
