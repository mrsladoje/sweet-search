#!/usr/bin/env node
/**
 * bench-maintainer-efficiency.mjs — isolated micro-benchmarks for the three
 * drop-in index-maintainer efficiency levers documented in
 * docs/INDEX_MAINTAINER_EFFICIENCY_RESEARCH.md. Produces REAL before/after
 * numbers; never fabricates.
 *
 * Levers measured:
 *   1. idle-cpu  (Cluster B / G3): build the REAL local ORT INT8 session twice
 *      — default foreground profile vs SWEET_SEARCH_ORT_BACKGROUND=1
 *      (force_spinning_stop + enableCpuMemArena:false + intra-op 2–4). Run a few
 *      encodes to spin the threadpool up, then leave the session resident and
 *      IDLE and sample the child process %CPU every ~1s. Default foreground
 *      uses allow_spinning:'1' (threads hot-loop ⇒ ~a core pegged); background
 *      parks threads (force_spinning_stop ⇒ ~0%). Each profile runs in its OWN
 *      child process (the session singleton is built once on first encode, so
 *      the profile MUST be chosen before the child's first encode).
 *
 *   2. tick-rss  (Cluster E.1): drive the REAL reconciler tick path
 *      (runProductionReconcileTick) over ~N changed files, sampling
 *      process.memoryUsage().rss, with SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES
 *      off vs on. Batching hoists the per-file HNSW load→save (up to 50×/tick)
 *      to once/tick, which should lower peak RSS. Uses the determinism harness's
 *      stub encoders (batching is encoder-independent — the RSS shape is the
 *      HNSW/SQLite reload, not the embedding math).
 *
 *   3. fg-latency (Cluster A): measure a representative foreground op
 *      (repeated `git status`) latency while a reconcile tick runs, at normal
 *      vs PRIORITY_LOW (+ taskpolicy -b on macOS). Honest about noise.
 *
 * Usage:
 *   node scripts/bench-maintainer-efficiency.mjs idle-cpu  [--idle-seconds 50] [--pin-threads 4]
 *   node scripts/bench-maintainer-efficiency.mjs tick-rss  [--files 40]
 *   node scripts/bench-maintainer-efficiency.mjs fg-latency [--samples 30]
 *   node scripts/bench-maintainer-efficiency.mjs all
 *
 * Internal child entrypoints (not for direct use):
 *   --idle-child <profile:default|background> <idleSeconds> [pinThreads]
 *   --rss-child  <batchFlag:0|1> <files> <repoCopyDir>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// small arg helpers
// ---------------------------------------------------------------------------
function flag(args, name, def) {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return def;
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function max(xs) { return xs.length ? Math.max(...xs) : 0; }
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function fmt(n, d = 1) { return Number(n).toFixed(d); }

// ===========================================================================
// LEVER 1 — IDLE CPU (force_spinning_stop)
// ===========================================================================

/**
 * CHILD: build the real ORT session under `profile`, warm it, then sit idle.
 * Prints `READY` once warmed; parent samples its %CPU for `idleSeconds`.
 */
async function idleChildMain(profile, idleSeconds, pinThreads) {
  // Force the CPU ORT path (never native Metal) — the lever is about ORT
  // threadpool spinning, which only exists on the CPU session.
  process.env.SWEET_SEARCH_EMBED_USE_CPU = '1';
  if (profile === 'background') process.env.SWEET_SEARCH_ORT_BACKGROUND = '1';
  else delete process.env.SWEET_SEARCH_ORT_BACKGROUND;
  // Optionally pin intra-op threads identically on BOTH profiles so the only
  // variable is force_spinning_stop + arena (isolates the spinning lever from
  // the thread-count lever). Honoured by both bestIntraOpThreads and
  // backgroundIntraOpThreads.
  if (pinThreads) process.env.SWEET_SEARCH_INTRA_OP_THREADS = String(pinThreads);

  const mod = await import('../core/embedding/embedding-local-model.js');
  const { callLocalModelCpu, getLocalPipeline, buildLocalSessionOptions } = mod;

  // Record the ACTUAL configured intra-op thread count + extra (the session
  // object doesn't expose intraOpNumThreads, so read it from the same builder
  // the pipeline used — proves which profile is live).
  const builtOpts = buildLocalSessionOptions('q8', false);
  const threads = builtOpts.intraOpNumThreads;
  const extra = JSON.stringify(builtOpts.extra);
  const arena = builtOpts.enableCpuMemArena;

  // A handful of encodes to fully spin up the threadpool / memory planner.
  const texts = Array.from({ length: 12 }, (_, i) =>
    `export function handler${i}(req, res) { const id = req.params.id; return res.json({ id, ok: true, n: ${i} }); }`);
  for (let i = 0; i < 8; i++) await callLocalModelCpu(texts, {});
  const pipe = await getLocalPipeline();

  // Announce readiness + the actual thread count / backend chosen.
  process.stdout.write(`READY backend=${pipe.backend} threads=${threads}\n`);

  // SELF-MEASURED ground truth: process.cpuUsage() is the process's OWN
  // cumulative user+system CPU microseconds (across ALL threads, incl. ORT
  // worker threads). The delta over a known wall window gives true mean %CPU
  // for THIS process while idle — immune to `ps %cpu` decaying-average
  // artifacts. A hot-looping (allow_spinning) threadpool burns CPU here even
  // with zero Run() calls; a parked (force_spinning_stop) pool burns ~none.
  const idleMs = Number(idleSeconds) * 1000;
  const cpu0 = process.cpuUsage();
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, idleMs));
  const wallUs = (Date.now() - t0) * 1000;
  const cpu1 = process.cpuUsage(cpu0);
  const usedUs = cpu1.user + cpu1.system;
  const selfMeanCpuPct = (usedUs / wallUs) * 100; // can exceed 100 if multiple cores spin
  process.stdout.write('SELF_CPU ' + JSON.stringify({
    profile, threads, extra, arena, backend: pipe.backend,
    idleWallMs: wallUs / 1000,
    userUs: cpu1.user, systemUs: cpu1.system,
    selfMeanCpuPct,
  }) + '\n');
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}

/** Sample a pid's %CPU via `ps` every intervalMs for durationMs. */
function sampleCpu(pid, durationMs, intervalMs, samples) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (Date.now() - start >= durationMs) return resolve();
      try {
        const out = execSync(`ps -o %cpu= -p ${pid}`, { encoding: 'utf-8' }).trim();
        const v = parseFloat(out);
        if (Number.isFinite(v)) samples.push(v);
      } catch { /* process may have exited */ }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function runIdleProfile(profile, idleSeconds, pinThreads) {
  const args = [__filename, '--idle-child', profile, String(idleSeconds)];
  if (pinThreads) args.push(String(pinThreads));
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env },
  });

  let buf = '';
  let self = null;
  child.stdout.on('data', (d) => {
    buf += d.toString();
    const line = buf.split('\n').find((l) => l.startsWith('SELF_CPU '));
    if (line && !self) { try { self = JSON.parse(line.slice('SELF_CPU '.length)); } catch { /* later */ } }
  });

  // Wait for READY (model load + warmup can take a few seconds).
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('idle child READY timeout (120s)')), 120_000);
    const iv = setInterval(() => { if (buf.includes('READY')) { clearTimeout(to); clearInterval(iv); resolve(); } }, 50);
    child.on('exit', (code) => { clearTimeout(to); clearInterval(iv); if (!self) reject(new Error(`idle child exited early code=${code}`)); });
  });

  // Let the threadpool settle for 1.5s, then ALSO ps-sample (cross-check) while
  // the child self-measures cpuUsage over the same idle window.
  await new Promise((r) => setTimeout(r, 1500));
  const samples = [];
  await sampleCpu(child.pid, idleSeconds * 1000, 1000, samples);

  // Give the child a moment to emit SELF_CPU + exit on its own.
  await new Promise((resolve) => {
    if (self) return resolve();
    const to = setTimeout(resolve, 4000);
    child.on('exit', () => { clearTimeout(to); resolve(); });
  });
  try { child.kill('SIGKILL'); } catch { /* ok */ }
  return { psSamples: samples, self };
}

async function leverIdleCpu(args) {
  const idleSeconds = Number(flag(args, '--idle-seconds', '50'));
  const pinThreads = flag(args, '--pin-threads', null);
  const pin = pinThreads ? Number(pinThreads) : null;
  const result = { lever: 'idle-cpu', idleSeconds, pinThreads: pin };

  console.error(`[idle-cpu] pinThreads=${pinThreads ?? '(unpinned: foreground bestIntraOp vs background 2-4)'} idleSeconds=${idleSeconds}`);

  console.error('[idle-cpu] running DEFAULT (foreground: allow_spinning + arena-on) ...');
  const def = await runIdleProfile('default', idleSeconds, pin);
  console.error(`[idle-cpu]   default  threads=${def.self?.threads} selfMeanCPU=${fmt(def.self?.selfMeanCpuPct ?? NaN)}%  ps mean=${fmt(mean(def.psSamples))}% max=${fmt(max(def.psSamples))}%`);

  console.error('[idle-cpu] running BACKGROUND (force_spinning_stop + arena-off) ...');
  const bg = await runIdleProfile('background', idleSeconds, pin);
  console.error(`[idle-cpu]   backgnd  threads=${bg.self?.threads} selfMeanCPU=${fmt(bg.self?.selfMeanCpuPct ?? NaN)}%  ps mean=${fmt(mean(bg.psSamples))}% max=${fmt(max(bg.psSamples))}%`);

  result.default = {
    threads: def.self?.threads, backend: def.self?.backend,
    selfMeanCpuPct: def.self?.selfMeanCpuPct ?? null,
    psMeanCpu: mean(def.psSamples), psMaxCpu: max(def.psSamples), psMedianCpu: median(def.psSamples), psN: def.psSamples.length,
  };
  result.background = {
    threads: bg.self?.threads, backend: bg.self?.backend,
    selfMeanCpuPct: bg.self?.selfMeanCpuPct ?? null,
    psMeanCpu: mean(bg.psSamples), psMaxCpu: max(bg.psSamples), psMedianCpu: median(bg.psSamples), psN: bg.psSamples.length,
  };
  result.deltaSelfMeanCpuPct = (def.self?.selfMeanCpuPct ?? 0) - (bg.self?.selfMeanCpuPct ?? 0);
  result.deltaPsMeanCpu = mean(def.psSamples) - mean(bg.psSamples);
  return result;
}

// ===========================================================================
// LEVER 2 — TICK PEAK RSS (batch tier writes)
// ===========================================================================

// Reuse the determinism harness's pure stub encoders (batching is
// encoder-independent — the RSS shape is the HNSW reload, not the embed math).
async function loadStubEncoders() {
  const h = await import('../eval/index-maintainer-determinism/run-harness.mjs');
  return h.__testing;
}

/** Build a synthetic mini-repo of `files` small JS files in a temp dir. */
function buildSyntheticRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-rss-bench-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const rels = [];
  for (let i = 0; i < files; i++) {
    const rel = path.join('src', `mod${i}.js`);
    const body = `// module ${i}\n` +
      `export function compute${i}(a, b) {\n  const r = a * ${i} + b;\n  return r > 0 ? r : -r;\n}\n` +
      `export class Service${i} {\n  constructor(db) { this.db = db; }\n` +
      `  async find(id) { return this.db.query('SELECT * FROM t WHERE id = ?', [id]); }\n` +
      `  async save(x) { return this.db.run('INSERT INTO t VALUES (?)', [x + ${i}]); }\n}\n`;
    fs.writeFileSync(path.join(root, rel), body);
    rels.push(rel);
  }
  return { root, rels };
}

/**
 * CHILD: drive ONE reconciler tick over `files` files with the batch flag set
 * to `batchFlag`, sampling rss throughout, and print the peak as JSON.
 */
async function rssChildMain(batchFlag, files, repoCopyDir) {
  if (batchFlag === '1') process.env.SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES = '1';
  else delete process.env.SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES;
  // Pin HNSW deterministic levels so the run is reproducible (matches harness).
  process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS = '1';

  // Dimension drives the on-disk HNSW .idx byte size — i.e. the size of the
  // buffer the per-file path deserializes+reserializes up to N times/tick. The
  // default stub is 8-dim (tiny index ⇒ invisible spike); use a realistic
  // production dimension (CodeRankEmbed = 768) so the per-file reload spike is
  // large enough to surface against Node's working-set noise.
  const dim = Number(process.env.BENCH_HNSW_DIM || '768');
  const { stubLiEncoder } = await loadStubEncoders();
  // Build a dim-parametric stub vector encoder (the harness's is fixed at its
  // MODEL_INFO dim; we want a wider vector to grow the index).
  const fnv1a = (str) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  };
  const stubVectorEncoder = async (texts) => texts.map((text) => {
    const base = fnv1a(text);
    const out = new Float32Array(dim);
    for (let i = 0; i < dim; i += 1) out[i] = (fnv1a(`${base}:${i}`) % 100003) / 100003;
    return out;
  });
  const MODEL_INFO = Object.freeze({ provider: 'harness', model: 'deterministic-stub', dimension: dim, hnswDimension: dim });
  const SILENT = { info() {}, warn() {}, error() {} };

  const stateDir = path.join(repoCopyDir, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });

  const allRels = fs.readdirSync(path.join(repoCopyDir, 'src')).map((f) => path.join('src', f))
    .sort((a, b) => a.localeCompare(b));
  const queue = path.join(stateDir, 'index-maintainer-queue.jsonl');
  const enqueue = (rels) => {
    const now = Date.now();
    fs.appendFileSync(queue, rels.map((rel) =>
      JSON.stringify({ file_path: rel, timestamp: now, queued_at: now, source: 'bench' })).join('\n') + '\n');
  };

  const { runProductionReconcileTick } = await import(
    '../core/incremental-indexing/application/production-reconciler.mjs');
  const runTick = (n) => runProductionReconcileTick({
    projectRoot: repoCopyDir, stateDir,
    vectorEncoder: stubVectorEncoder, liEncoder: stubLiEncoder,
    modelInfo: MODEL_INFO, logger: SILENT,
    config: { filesPerTick: n + 10, cpuBudgetMs: 600_000 },
  });

  // TICK 1 (prebuild, NOT sampled): index ALL files so the on-disk HNSW .idx is
  // large. This is the realistic worst case the research describes — the index
  // is already big when a maintenance tick touches a batch of files.
  enqueue(allRels);
  await runTick(allRels.length);
  if (global.gc) { global.gc(); global.gc(); }
  // The "HNSW index" is persisted as several sibling files under the
  // codebase-binary-hnsw.* prefix (graph/int8/vectors/meta JSON) — the per-file
  // path deserializes+reserializes that whole set once per touched file. Sum
  // them all + the float-vector sidecar for the true reloaded footprint.
  let idxSizeMB = 0;
  try {
    for (const f of fs.readdirSync(stateDir)) {
      if (f.startsWith('codebase-binary-hnsw') || f.startsWith('codebase-float-vectors')) {
        idxSizeMB += fs.statSync(path.join(stateDir, f)).size / 1048576;
      }
    }
  } catch { /* ok */ }

  // Re-touch `files` of them (rewrite content so they re-embed) and enqueue.
  const touch = allRels.slice(0, Number(files));
  for (const rel of touch) {
    const abs = path.join(repoCopyDir, rel);
    fs.appendFileSync(abs, `\n// edit ${Date.now()} ${Math.random()}\nexport const TOUCHED_${path.basename(rel, '.js')} = ${Math.random()};\n`);
  }
  enqueue(touch);

  // GC to a clean floor right before sampling so the tick-2 reload spike is
  // measured against settled heap, not tick-1's retained index objects.
  if (global.gc) { global.gc(); global.gc(); }
  const floorRss = process.memoryUsage().rss;

  // TICK 2 (SAMPLED): the per-file path reloads the now-large index once per
  // touched file; the batched path loads it once. Sample RSS throughout.
  let peak = floorRss;
  const samples = [];
  const sampler = setInterval(() => {
    const r = process.memoryUsage().rss;
    samples.push(r);
    if (r > peak) peak = r;
  }, 4);
  const t0 = performance.now();
  await runTick(touch.length);
  const wallMs = performance.now() - t0;
  clearInterval(sampler);
  peak = Math.max(peak, process.memoryUsage().rss);

  process.stdout.write('RSS_RESULT ' + JSON.stringify({
    batchFlag,
    files: Number(files),
    dim,
    idxSizeMB,
    floorRssMB: floorRss / 1048576,
    peakRssMB: peak / 1048576,
    // Working-set growth DURING the sampled tick, above the pre-tick GC floor —
    // this is the per-file-reload spike the E.1 lever targets.
    deltaOverBaselineMB: (peak - floorRss) / 1048576,
    samples: samples.length,
    wallMs,
  }) + '\n');
  process.exit(0);
}

function runRssChild(batchFlag, files, prebuild, dim) {
  // Fresh repo copy per child so neither run sees the other's state dir. The
  // corpus has `prebuild` total files; tick 2 re-touches `files` of them.
  const { root } = buildSyntheticRepo(prebuild);
  try {
    const res = spawnSync(process.execPath,
      // --expose-gc so the child can collect tick-1 garbage before sampling
      // tick 2 (isolates the tick-2 reload spike from tick-1 retained heap).
      ['--expose-gc', __filename, '--rss-child', String(batchFlag), String(files), root],
      { cwd: REPO_ROOT, encoding: 'utf-8',
        env: { ...process.env, BENCH_HNSW_DIM: String(dim) }, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) {
      throw new Error(`rss child exited ${res.status} signal=${res.signal}\nSTDERR:\n${res.stderr}\nSTDOUT:\n${res.stdout}`);
    }
    const line = (res.stdout || '').split('\n').find((l) => l.startsWith('RSS_RESULT '));
    if (!line) throw new Error(`no RSS_RESULT from child. stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    return JSON.parse(line.slice('RSS_RESULT '.length));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

async function leverTickRss(args) {
  const files = Number(flag(args, '--files', '40'));
  const prebuild = Number(flag(args, '--prebuild', '600'));
  const dim = Number(flag(args, '--dim', '768'));
  const repeats = Number(flag(args, '--repeats', '3'));
  console.error(`[tick-rss] touch=${files} prebuild=${prebuild} dim=${dim} repeats=${repeats}`);
  const offRuns = []; const onRuns = [];
  for (let r = 0; r < repeats; r++) {
    const off = runRssChild('0', files, prebuild, dim);
    const on = runRssChild('1', files, prebuild, dim);
    offRuns.push(off); onRuns.push(on);
    console.error(`[tick-rss]   rep${r}: idx=${fmt(off.idxSizeMB)}MB  OFF peak=${fmt(off.peakRssMB)}MB Δbase=${fmt(off.deltaOverBaselineMB)}MB wall=${fmt(off.wallMs)}ms | ON peak=${fmt(on.peakRssMB)}MB Δbase=${fmt(on.deltaOverBaselineMB)}MB wall=${fmt(on.wallMs)}ms`);
  }
  const offPeak = median(offRuns.map((x) => x.peakRssMB));
  const onPeak = median(onRuns.map((x) => x.peakRssMB));
  const offDelta = median(offRuns.map((x) => x.deltaOverBaselineMB));
  const onDelta = median(onRuns.map((x) => x.deltaOverBaselineMB));
  return {
    lever: 'tick-rss', files, prebuild, dim, repeats,
    idxSizeMB: median(offRuns.map((x) => x.idxSizeMB)),
    off: { medianPeakRssMB: offPeak, medianDeltaOverBaselineMB: offDelta, medianWallMs: median(offRuns.map((x) => x.wallMs)), runs: offRuns },
    on: { medianPeakRssMB: onPeak, medianDeltaOverBaselineMB: onDelta, medianWallMs: median(onRuns.map((x) => x.wallMs)), runs: onRuns },
    deltaPeakRssMB: offPeak - onPeak,
    deltaWorkingSetMB: offDelta - onDelta,
  };
}

// ===========================================================================
// LEVER 3 — FOREGROUND LATENCY UNDER PRIORITY
// ===========================================================================

/**
 * CHILD: run a CPU-busy reconcile-like loop at a given priority. We use a tight
 * encode loop on the CPU ORT session as the "tick" workload (representative of
 * the maintainer's hottest CPU phase), optionally demoted via
 * os.setPriority(PRIORITY_LOW) + taskpolicy -b.
 */
async function priorityLoadChildMain(mode, durationMs) {
  process.env.SWEET_SEARCH_EMBED_USE_CPU = '1';
  if (mode === 'low') {
    try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* ok */ }
    if (process.platform === 'darwin') {
      try { spawnSync('taskpolicy', ['-b', '-p', String(process.pid)]); } catch { /* ok */ }
    }
  }
  const mod = await import('../core/embedding/embedding-local-model.js');
  const { callLocalModelCpu } = mod;
  const texts = Array.from({ length: 16 }, (_, i) =>
    `export class Worker${i} { run(x) { let s = 0; for (let k = 0; k < x; k++) s += k * ${i}; return s; } }`);
  await callLocalModelCpu(texts, {}); // warm
  process.stdout.write('LOAD_READY\n');
  const end = Date.now() + Number(durationMs);
  while (Date.now() < end) {
    await callLocalModelCpu(texts, {});
  }
  process.exit(0);
}

/** Measure git-status latency (ms) `samples` times in this repo. */
function measureGitStatus(samples) {
  const lat = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    lat.push(performance.now() - t0);
  }
  return lat;
}

async function runFgUnderLoad(mode, samples) {
  const durationMs = (samples * 120) + 8000; // keep the load running across all samples
  const child = spawn(process.execPath, [__filename, '--load-child', mode, String(durationMs)], {
    cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env },
  });
  await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('load child READY timeout')), 120_000);
    child.stdout.on('data', (d) => { buf += d.toString(); if (buf.includes('LOAD_READY')) { clearTimeout(to); resolve(); } });
    child.on('exit', (c) => { clearTimeout(to); reject(new Error(`load child exited early code=${c}`)); });
  });
  await new Promise((r) => setTimeout(r, 800)); // let the loop reach steady state
  const lat = measureGitStatus(samples);
  try { child.kill('SIGKILL'); } catch { /* ok */ }
  return lat;
}

async function leverFgLatency(args) {
  const samples = Number(flag(args, '--samples', '30'));
  console.error(`[fg-latency] samples=${samples} (git status --porcelain in ${REPO_ROOT})`);

  const baseline = measureGitStatus(samples);
  console.error(`[fg-latency]   baseline (no load)        median=${fmt(median(baseline))}ms mean=${fmt(mean(baseline))}ms`);

  const normal = await runFgUnderLoad('normal', samples);
  console.error(`[fg-latency]   under NORMAL-priority load median=${fmt(median(normal))}ms mean=${fmt(mean(normal))}ms`);

  const low = await runFgUnderLoad('low', samples);
  console.error(`[fg-latency]   under LOW-priority load    median=${fmt(median(low))}ms mean=${fmt(mean(low))}ms`);

  return {
    lever: 'fg-latency', samples,
    baseline: { median: median(baseline), mean: mean(baseline), max: max(baseline) },
    underNormalLoad: { median: median(normal), mean: mean(normal), max: max(normal) },
    underLowLoad: { median: median(low), mean: mean(low), max: max(low) },
    deltaMedianMs: median(normal) - median(low),
  };
}

// ===========================================================================
// CLI
// ===========================================================================
async function main() {
  const argv = process.argv.slice(2);

  // child entrypoints
  if (argv[0] === '--idle-child') { await idleChildMain(argv[1], argv[2], argv[3] ? Number(argv[3]) : null); return; }
  if (argv[0] === '--rss-child') { await rssChildMain(argv[1], argv[2], argv[3]); return; }
  if (argv[0] === '--load-child') { await priorityLoadChildMain(argv[1], argv[2]); return; }

  const cmd = argv[0];
  const out = {};
  if (cmd === 'idle-cpu' || cmd === 'all') out.idleCpu = await leverIdleCpu(argv);
  if (cmd === 'tick-rss' || cmd === 'all') out.tickRss = await leverTickRss(argv);
  if (cmd === 'fg-latency' || cmd === 'all') out.fgLatency = await leverFgLatency(argv);
  if (!out.idleCpu && !out.tickRss && !out.fgLatency) {
    console.error('usage: bench-maintainer-efficiency.mjs <idle-cpu|tick-rss|fg-latency|all> [flags]');
    process.exit(2);
  }
  console.log('\n===BENCH_RESULT_JSON===');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
