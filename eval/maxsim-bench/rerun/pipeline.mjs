// node rerun/pipeline.mjs --calls <calls.json> --out FILE.json [--split dev|heldout] [--limit N] [--passes 3] [--repos a,b]
//        [--engine <engine tree>] [--repos-dir <dir with r3-* repositories>] [--encoder cpu|native]
//
// Post-freeze study for paper Section 9 (PAPER_PLAN.md W7): the share of each stage in the time
// of one search call on the production search path, on the M3 Max, with the CPU query encoder
// (SWEET_SEARCH_NATIVE_INFERENCE=0: ORT on the CPU, no Metal). Changes no engine code: the
// stage timers come from the preload rerun/pipeline-hook.mjs.
//
// Each unique agent search call (repository, tool, arguments; the calls.json that built the
// replay sets) runs in-process through the daemon route, as capture-agent.mjs replays it. Per
// call: one untimed warm-up pass, then --passes timed passes; before each timed pass the query
// embedding cache is cleared, so the encoder runs as for a new query. The pass with the median
// total time gives the call's stage split. Stages:
//   encoding   dense query embedding + late-interaction query tokens (the engine's own counters)
//   fetch      first-stage retrieval methods, minus the encoder and LI time inside them
//   int4 load  LI scoring minus the kernel: doc lookup in the in-memory int4 store, grouping, packing
//   maxsim     the native kernel call
//   rest       everything else in the call (routing, post-processing, output shaping)
// One child process per repository (its own project root); children send per-call stage times to
// this parent over IPC and print nothing per call. The parent writes AGGREGATES ONLY: per stage,
// the median and p90 share over calls and the median ms. --split heldout refuses --print-calls.
import fs from 'node:fs';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_SRC = path.resolve(HERE, '../../..');
// --engine <tree>: the engine to time (default: this repository); the indexed repositories stay
// in this repository's eval/repos.
const ENGINE = path.resolve(process.argv.includes('--engine') ? process.argv[process.argv.indexOf('--engine') + 1] : (process.env.PIPE_ENGINE || REPO_SRC));
const STAGES = ['encoding', 'fetch', 'int4', 'maxsim', 'rest'];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

if (process.argv.includes('--child')) await child();
else await parent();

async function child() {
  const repo = arg('--repo'), passes = Number(arg('--passes', 3)), limit = Number(arg('--limit', 0));
  const root = process.cwd();
  let calls = JSON.parse(fs.readFileSync(arg('--calls')))[repo] || [];
  if (limit) calls = calls.slice(0, limit);
  const S = globalThis.__ssPipe;
  if (!S) throw new Error('pipeline-hook.mjs not loaded');
  // The production daemon, started in this process: the calls reach it over its Unix socket
  // (POST /agent-tool, as the native ss-* client sends them), and ss-search asks /search inside
  // the same process. So every stage of every tool runs here, under the hook's timers.
  const { startServer, getServerHealth } = await import(`${ENGINE}/core/search/search-server.js`);
  const { projectSocketPath } = await import(`${ENGINE}/core/search/server-identity.js`);
  const { clearCache } = await import(`${ENGINE}/core/embedding/embedding-service.js`);
  await startServer();
  for (let i = 0; i < 600; i++) {
    const h = await getServerHealth().catch(() => null);
    if (h?.status === 'ready') break;
    await new Promise(r => setTimeout(r, 500));
  }
  const socketPath = projectSocketPath();
  const http = await import('node:http');
  const sub = { 'ss-search': 'agent-search', 'ss-semantic': 'semantic', 'ss-find': 'find' };
  const once = (c) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ v: 1, tool: sub[c.tool], args: c.args, cwd: root, env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: root }, pid: process.pid });
    const req = http.request({ socketPath, method: 'POST', path: '/agent-tool', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        try {
          const b = JSON.parse(Buffer.concat(chunks).toString());
          if (b.code !== 0 && process.env.PIPE_SPLIT === 'dev' && !once.shown++) process.stderr.write(`[dev call failed] ${c.tool} code ${b.code}: ${String(b.stderr || b.error).slice(0, 400)}\n`);
          resolve(b.code);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.end(body);
  });
  once.shown = 0;
  const out = []; const codes = {};
  for (const c of calls) {
    await once(c);                                        // warm-up, untimed
    const runs = [];
    for (let p = 0; p < passes; p++) {
      clearCache();
      S.reset();
      const t0 = performance.now();
      const code = await once(c);
      const total = (performance.now() - t0) * 1000;
      const s = S.snapshot();
      const u = (k) => s.us[k] || 0, e = (k) => s.enc[k] || 0;
      const encoding = Object.values(s.enc).reduce((a, x) => a + x, 0);
      const st = { total, encoding, fetch: Math.max(0, u('retrieval') - e('retrieval')), int4: Math.max(0, u('li') - e('li')), maxsim: u('kernel') };
      st.rest = total - st.encoding - st.fetch - st.int4 - st.maxsim;
      runs.push({ ...st, kernelCalls: s.kernelCalls, code, tool: c.tool });
    }
    runs.sort((a, b) => a.total - b.total);
    const m = runs[Math.floor(runs.length / 2)];
    codes[`${c.tool}:${m.code}`] = (codes[`${c.tool}:${m.code}`] || 0) + 1;
    out.push(m);
  }
  process.send({ repo, calls: out, codes }, () => process.exit(0));
}

async function parent() {
  const callsPath = arg('--calls'), outPath = arg('--out'), split = arg('--split', 'dev');
  const passes = arg('--passes', '3'), limit = arg('--limit', '0');
  const printCalls = process.argv.includes('--print-calls');
  if (printCalls && split !== 'dev') throw new Error('--print-calls is for development calls only');
  const all = JSON.parse(fs.readFileSync(callsPath));
  const repos = arg('--repos') ? arg('--repos').split(',') : Object.keys(all);
  const rows = []; const codes = {}; const t0 = Date.now();
  for (const repo of repos) {
    const root = path.join(arg('--repos-dir', path.join(REPO_SRC, 'eval/repos')), `r3-${repo}`);
    const env = { ...process.env, SWEET_SEARCH_PROJECT_ROOT: root, PIPE_SPLIT: split, PIPE_ENGINE: ENGINE, ...(arg('--encoder', 'cpu') === 'cpu' ? { SWEET_SEARCH_NATIVE_INFERENCE: '0' } : {}),
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${path.join(HERE, 'pipeline-hook.mjs')}`.trim() };
    const msg = await new Promise((resolve, reject) => {
      const ch = fork(fileURLToPath(import.meta.url), ['--child', '--repo', repo, '--calls', path.resolve(callsPath), '--passes', passes, '--limit', limit],
        { cwd: root, env, stdio: ['ignore', 2, 'inherit', 'ipc'] });
      let got = null;
      ch.on('message', (m) => { got = m; });
      ch.on('exit', (code) => (got ? resolve(got) : reject(new Error(`child ${repo} exit ${code} without result`))));
    });
    spawnSync('pkill', ['-x', 'sweet-search-maintainer']);   // index maintainers the in-process daemon may have spawned
    for (const r of msg.calls) rows.push(r);
    for (const [k, v] of Object.entries(msg.codes)) codes[k] = (codes[k] || 0) + v;
    console.error(`${repo}: ${msg.calls.length} calls done (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; };
  const agg = (sel) => {
    const o = { calls: sel.length, total_ms: { median: q(sel.map(r => r.total), 0.5) / 1000, p90: q(sel.map(r => r.total), 0.9) / 1000 }, stages: {} };
    for (const k of STAGES) {
      o.stages[k] = { share_median: q(sel.map(r => r[k] / r.total), 0.5), share_p90: q(sel.map(r => r[k] / r.total), 0.9),
        ms_median: q(sel.map(r => r[k]), 0.5) / 1000, share_of_summed_time: sel.reduce((a, r) => a + r[k], 0) / sel.reduce((a, r) => a + r.total, 0) };
    }
    o.rest_negative = sel.filter(r => r.rest < 0).length;
    return o;
  };
  const withK = rows.filter(r => r.kernelCalls > 0);
  const result = {
    split, passes: Number(passes), limit: Number(limit), engine: ENGINE, encoder: arg('--encoder', 'cpu') === 'cpu' ? 'CPU (ORT, SWEET_SEARCH_NATIVE_INFERENCE=0)' : 'native (engine default)',
    note: 'stage shares per call (median pass of the call); aggregates only',
    codes, seconds: Math.round((Date.now() - t0) / 1000),
    calls_with_maxsim: agg(withK), all_calls: agg(rows),
    by_tool: Object.fromEntries([...new Set(rows.map(r => r.tool))].map(t => [t, agg(withK.filter(r => r.tool === t))])),
  };
  if (printCalls) result.per_call_dev = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])));
  fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
}
