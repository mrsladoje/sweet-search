// node mem-node.mjs --arm NAME --out FILE.json --set DIR [--set DIR ...] [--limit N] [--stride N] [--job-key K]
//
// W11 "RAM per arm" for the Node arms (production, prewarm, legacy, wasm, js): the twin of
// mem.py (same phases, same sample rule, same JSON summary). One UNTIMED pass in a fresh
// process; run_matrix.py --mem runs it, with the allocator settings of memstat.py.
//   runtime     at process start (Node, before the addon is loaded)
//   libraries   after simd-distance.js, the native addon, the WASM module and the call
//               metadata are loaded (the base of the load)
//   loaded      the sampled calls, read straight into 64 MB slabs in the layout that
//               LateInteractionIndex._packDocsIntoSlabs gives the index (no per-doc copy
//               on the way, so no freed heap behind): the production store
//   warm-up     one untimed call on the smallest call
//   prepared    the arm's per-call objects for every sampled call, held at once
//   scoring     the median-size call, then the largest call; peak - the resident memory
//               before the first one = the peak temporary memory of one call
// Resident memory: Linux VmRSS / VmHWM (/proc/self/status; VmHWM reset with
// /proc/self/clear_refs = 5) and smaps_rollup; macOS process RSS with a peak sampler in a
// worker thread (every 0.2 ms; the native call blocks the main thread, not the worker).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const LINUX = process.platform === 'linux';
const status = () => {
  const o = {};
  for (const l of fs.readFileSync('/proc/self/status', 'utf8').split('\n')) {
    const m = /^(VmRSS|VmHWM|RssAnon|RssFile|RssShmem):\s+(\d+)/.exec(l);
    if (m) o[m[1]] = Number(m[2]) * 1024;
  }
  return o;
};
const current = () => (LINUX ? status().VmRSS : process.memoryUsage.rss());
// macOS: one sampler worker for the whole run (started before the baseline readings, so
// its isolate is part of the runtime baseline); shared[0] = peak, [1] = stop, [2] = active.
const shared = new BigInt64Array(new SharedArrayBuffer(24));
const sampler = LINUX ? null : new Worker(`const { workerData: s } = require('node:worker_threads');
    const sab = new BigInt64Array(s);
    const t = new Int32Array(new SharedArrayBuffer(4));
    while (Atomics.load(sab, 1) === 0n) {
      if (Atomics.load(sab, 2) === 1n) {
        const r = BigInt(process.memoryUsage.rss());
        if (r > Atomics.load(sab, 0)) Atomics.store(sab, 0, r);
      }
      Atomics.wait(t, 0, 0, 0.2);
    }`, { eval: true, workerData: shared.buffer });
sampler?.unref();
function resetPeak() {
  if (LINUX) { fs.writeFileSync('/proc/self/clear_refs', '5'); return; }
  Atomics.store(shared, 0, BigInt(current())); Atomics.store(shared, 2, 1n);
}
function stopSampler() { Atomics.store(shared, 1, 1n); }
function peak() {
  if (LINUX) return status().VmHWM;
  Atomics.store(shared, 2, 0n);
  return Math.max(Number(Atomics.load(shared, 0)), current());
}
function reading() {
  global.gc?.(); global.gc?.();
  const m = process.memoryUsage();
  const r = { resident: current(), heap_used: m.heapUsed, external: m.external, array_buffers: m.arrayBuffers, max_rss: process.resourceUsage().maxRSS * 1024 };
  if (LINUX) {
    const s = status();
    Object.assign(r, { peak: s.VmHWM, anon: s.RssAnon, file: s.RssFile, shmem: s.RssShmem });
    try {
      for (const l of fs.readFileSync('/proc/self/smaps_rollup', 'utf8').split('\n')) {
        const m2 = /^(Rss|Anonymous|Pss):\s+(\d+)/.exec(l);
        if (m2) r[`smaps_${m2[1].toLowerCase()}`] = Number(m2[2]) * 1024;
      }
    } catch { /* older kernels */ }
  }
  return r;
}
{ const t0 = Date.now(); while (Date.now() - t0 < 50); }  // the sampler isolate is up
const R_RUNTIME = reading();

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const sets = argv.flatMap((a, i) => (a === '--set' ? [argv[i + 1]] : []));
const arm = opt('arm'), outFile = opt('out'), jobKey = opt('job-key', '');
const limit = Number(opt('limit', 0)), stride = Number(opt('stride', 1));
const TOKEN_BUDGET = Number(process.env.SS_MEM_TOKENS || 2_000_000);
if (!global.gc) throw new Error('run with node --expose-gc');

const SRC = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const sd = await import(`${SRC}/core/infrastructure/simd-distance.js`);
await sd.initWasm?.();
const jsScore = arm === 'js'
  ? (await import(`${SRC}/core/ranking/late-interaction-index.js`)).LateInteractionIndex.prototype._maxSimScore4BitImplicit
  : null;
const legacy = arm === 'legacy' ? (await import('node:module')).createRequire(import.meta.url)(process.env.LEGACY_ADDON) : null;
const { makeBuild } = await import('./node-arms.mjs');
const { excluded } = await import('./replay.mjs');
const build = makeBuild({ sd, arm, legacy, jsScore, prepMs: Number(process.env.PREP_US || 100) / 1000 });

// ---- calls, in replay.mjs loadCalls order (EXCLUDE.json, then stride, limit), as metadata
// Mirrors: eval/maxsim-bench/replay.mjs:loadCalls (order and exclusions)
const metas = [];
for (const root of sets) {
  const skip = excluded(root), one = [];
  for (const repo of fs.readdirSync(root).sort()) {
    const dir = path.join(root, repo);
    if (repo === 'refs-v2' || repo === 'stale' || !fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.startsWith('index-')).sort()) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)) {
        const m = JSON.parse(line);
        if (!skip.has(`${repo}/${m.file}`)) one.push({ root, repo, m });
      }
    }
  }
  const sel = one.filter((_, i) => i % stride === 0);
  metas.push(...(limit ? sel.slice(0, limit) : sel));
}
const R_LIBS0 = reading();  // runtime + addon + WASM + the call metadata: the base of the load
const ntok = (m) => m.cands.reduce((a, c) => a + c.nt, 0);
const tokAll = metas.reduce((a, x) => a + ntok(x.m), 0);
let pick;
if (tokAll <= TOKEN_BUDGET) pick = metas.map((_, i) => i);
else {
  const order = metas.map((_, i) => i).sort((i, j) => ntok(metas[i].m) - ntok(metas[j].m) || i - j);
  const step = tokAll / TOKEN_BUDGET, set = new Set([order[order.length >> 1], order[order.length - 1]]);
  for (let k = 0; k < Math.floor(metas.length / step); k++) set.add(Math.floor(k * step));
  pick = [...set].filter(i => i < metas.length).sort((a, b) => a - b);
}

// ---- read the sampled calls straight into slabs (production layout)
const al = n => (n + 3) & ~3;
const MAX = 64 * 1024 * 1024;
const scratch = { buf: Buffer.alloc(0) };
const fileBytes = (p) => {
  const n = fs.statSync(p).size;
  if (scratch.buf.length < n) scratch.buf = Buffer.alloc(n);
  const fd = fs.openSync(p, 'r'); fs.readSync(fd, scratch.buf, 0, n, 0); fs.closeSync(fd);
  return scratch.buf.subarray(0, n);
};
const calls = [];
{
  // slab sizes first (same flush rule as packAll), then copy each doc's four fields in
  const need = (c) => al(c.tb) + 3 * al(c.nt * 4);
  const plan = []; let cur = 0;
  for (const i of pick) for (const c of metas[i].m.cands) { if (cur + need(c) > MAX && cur) { plan.push(cur); cur = 0; } cur += need(c); }
  if (cur) plan.push(cur);
  let si = 0, slab = plan.length ? new ArrayBuffer(plan[0]) : null, u8 = slab && new Uint8Array(slab), at = 0;
  for (const i of pick) {
    const { root, repo, m } = metas[i];
    const b = fileBytes(path.join(root, repo, m.file));
    let off = 0;
    const query = new Float32Array(m.numQ * m.dim);
    new Uint8Array(query.buffer).set(b.subarray(0, query.byteLength)); off += query.byteLength;
    const cands = [];
    for (const c of m.cands) {
      if (at + need(c) > slab.byteLength) { si++; slab = new ArrayBuffer(plan[si]); u8 = new Uint8Array(slab); at = 0; }
      const put = (len, Ctor) => { u8.set(b.subarray(off, off + len), at); const v = new Ctor(slab, at, len / Ctor.BYTES_PER_ELEMENT); off += len; at += al(len); return v; };
      const tokens = put(c.tb, Uint8Array), minArray = put(c.nt * 4, Float32Array), scaleArray = put(c.nt * 4, Float32Array), tokenNorms = put(c.nt * 4, Float32Array);
      cands.push({ tokens, numTokens: c.nt, dim: c.dim, minArray, scaleArray, tokenNorms });
    }
    calls.push({ set: path.basename(root.replace(/\/$/, '')), repo, file: m.file, kind: m.kind, numQ: m.numQ, dim: m.dim, query, cands });
  }
  scratch.buf = Buffer.alloc(0);
}
const R_LOADED = reading();
const toks = calls.map(c => c.cands.reduce((a, d) => a + d.numTokens, 0));
const tok = toks.reduce((a, b) => a + b, 0) || 1;
const stored = calls.reduce((a, c) => a + c.cands.reduce((x, d) => x + d.tokens.byteLength + 12 * d.numTokens, 0), 0);
const bySize = calls.map((_, i) => i).sort((i, j) => toks[i] - toks[j] || i - j);
if (calls.some(c => c.kind !== 'int4') && arm !== 'production' && arm !== 'prewarm') throw new Error('wasm/js/legacy arms cover int4 calls only');

// ---- warm-up, prepared, scoring
if (calls.length) { const w = build(calls[bySize[0]]); w.before?.(); w(); }
const R_LIBS = reading();
resetPeak();
const runs = calls.map(c => build(c));
const R_PREP = reading();
const prepPeak = peak() - R_LIBS.resident;
const temps = {};
const base = current();
for (const [label, i] of [['p50', bySize[bySize.length >> 1]], ['max', bySize[bySize.length - 1]]]) {
  if (i === undefined) continue;
  resetPeak();
  runs[i].before?.(); runs[i]();
  temps[label] = { temp: Math.max(0, peak() - base), tokens: toks[i], pool: calls[i].cands.length, nq: calls[i].numQ };
}
const R_SCORED = reading();
stopSampler();

const dims = [...new Set(calls.map(c => c.dim))];
const dim = dims.length === 1 ? dims[0] : null;
const storePt = (R_LOADED.resident - R_LIBS0.resident) / tok;
const copyPt = (R_PREP.resident - R_LIBS.resident) / tok;
const summary = {
  runtime_bytes: R_RUNTIME.resident, library_delta_bytes: R_LIBS0.resident - R_RUNTIME.resident,
  warmup_delta_bytes: R_LIBS.resident - R_LOADED.resident,
  calls_selected: metas.length, calls_sampled: calls.length, tokens_selected: tokAll, tokens: tok, stored_bytes: stored,
  store_bytes_per_token: stored / tok, loaded_bytes_per_token: storePt,
  loaded_array_buffer_bytes_per_token: (R_LOADED.array_buffers - R_LIBS0.array_buffers) / tok,
  uses_store: true, arm_copy_bytes_per_token: copyPt, resident_bytes_per_token: copyPt + stored / tok,
  prep_peak_bytes: prepPeak, score_temp: temps,
  computed_bytes_per_token: dim ? { int4: ((dim + 1) >> 1) + 12, f32: 4 * dim, bf16: 2 * dim, f16: 2 * dim } : null,
};
const out = {
  kind: 'mem', arm: `node:${arm}`, contract: 'S', clamp: true, precision: 'int4', job_key: jobKey,
  env: { arm, sets, node: process.version, platform: `${os.platform()} ${os.release()}`, machine: os.arch(), cpu: os.cpus()[0]?.model, cpu_count: os.cpus().length,
    source: LINUX ? 'linux: VmRSS/VmHWM + smaps_rollup, clear_refs=5' : 'macos: process RSS + 0.2 ms worker sampler peak',
    malloc_env: Object.fromEntries(['MALLOC_MMAP_THRESHOLD_', 'MALLOC_TRIM_THRESHOLD_', 'MallocLargeCache'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])),
    token_budget: TOKEN_BUDGET, instance: process.env.SS_INSTANCE_ID || os.hostname(), started: new Date().toISOString() },
  readings: { runtime: R_RUNTIME, libraries_loaded: R_LIBS0, loaded: R_LOADED, after_warmup: R_LIBS, prepared: R_PREP, scored: R_SCORED },
  summary, sampled: calls.map((c, i) => ({ set: c.set, repo: c.repo, file: c.file, tokens: toks[i] })),
  n_calls: metas.length, complete: runs.length === calls.length,
};
fs.writeFileSync(outFile + '.tmp', JSON.stringify(out));
fs.renameSync(outFile + '.tmp', outFile);
console.log(`mem node:${arm} calls=${metas.length} sampled=${calls.length} resident=${summary.resident_bytes_per_token.toFixed(1)} B/token (store ${(stored / tok).toFixed(1)}, measured load ${storePt.toFixed(1)}, copy ${copyPt.toFixed(1)}) temp p50=${((temps.p50?.temp || 0) / 1024).toFixed(0)} KiB max=${((temps.max?.temp || 0) / 1048576).toFixed(2)} MiB libs=${(summary.library_delta_bytes / 1048576).toFixed(0)} MiB`);
process.exit(0);
