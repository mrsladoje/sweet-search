#!/usr/bin/env node
/**
 * ss-grep replay fidelity and latency (docs/SUGGESTED_PLAN.md at 945a9664, Step 0 item 5 and Step 1).
 *
 * Runs the REAL ss-grep tool code (runAgentTool on a warm in-process SweetSearch over the
 * repository's real index, the code path the daemon runs) under every pre-registered arm on a
 * seeded sample of collected calls, and compares its output with the replay's rendering of the
 * same call: file set, header counts, selected lines, line order, `(+N more in this file)`
 * markers and the hidden-files line. Text is not compared (the tool prints the matched
 * substring, the replay the line). -A/-B/-C are dropped from the calls: context rendering
 * prints the same hits by construction (tests/agent-tools).
 *
 * Latency: per call, the tool time of `shipped` vs `lines` (Step 1 adds at most k graph reads),
 * warm (median of --reps runs on the warm searcher) and the first call of a fresh process.
 *
 * Read-only on the repositories: no daemon, no maintainer; the searcher only reads the index.
 *
 * Usage: node eval/grep-allocation-replay/fidelity.mjs [--in out/collected-dev.json]
 *          [--per-repo 6] [--reps 3] [--seed 11] [--out out/fidelity-dev.json]
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_OUT, DEFAULT_REPOS, prng, shellWords } from './lib.mjs';
import { matchList, renderArm } from './replay-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** Tool arguments of a recorded call, without the context flags. */
function toolArgs(call) {
  const toks = shellWords(call.args).slice(1);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === '-A' || toks[i] === '-B' || toks[i] === '-C') { i++; continue; }
    out.push(toks[i]);
  }
  return out;
}

// --- worker: one repository, one warm searcher -------------------------------------------
async function worker(jobFile) {
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  const { SweetSearch } = await import('../../core/search/sweet-search.js');
  const { runAgentTool } = await import('../agent-read-workflows/bin/_ss-helpers.mjs');
  const { runInVirtualProcess } = await import('../../core/agent-tools/virtual-process.js');
  const searcher = new SweetSearch({ projectRoot: job.repoDir });
  await searcher.initGrepOnly();
  const runtime = mkdtempSync(path.join(tmpdir(), 'grep-fidelity-'));
  const baseEnv = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: job.repoDir,
    SWEET_SEARCH_SOCKET_PATH: path.join(runtime, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: runtime,
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0',
    SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
  };
  const run = async (args, env) => {
    const t = performance.now();
    const r = await runInVirtualProcess({ env: { ...baseEnv, ...env }, cwd: job.repoDir },
      () => runAgentTool('grep', args, { getSearcher: () => searcher }));
    return { ms: performance.now() - t, stdout: r.stdout.toString('utf8') };
  };
  const out = [];
  // the very first call of the process, Step 1 on: includes opening the code graph
  if (job.calls.length) {
    const first = await run(job.calls[0].args, job.linesEnv);
    out.push({ kind: 'cold', ms: first.ms });
  }
  for (const c of job.calls) {
    for (const arm of job.arms) {
      const times = [];
      let stdout = '';
      for (let r = 0; r < job.reps; r++) {
        const res = await run(c.args, arm.env);
        times.push(res.ms);
        stdout = res.stdout;
      }
      times.sort((a, b) => a - b);
      out.push({ kind: 'call', id: c.id, arm: arm.name, ms: times[Math.floor(times.length / 2)], stdout });
    }
  }
  rmSync(runtime, { recursive: true, force: true });
  // a file, not stdout: engine load logs share stdout
  writeFileSync(job.outFile, JSON.stringify(out));
  process.exit(0);
}

// --- comparison ---------------------------------------------------------------------------
const HIT_RE = /^(.+?):(\d+)(?:: .*?)?(?: \(\+(\d+) more in this file\))?$/;

function parseToolBody(stdout, files) {
  const hits = [];
  let hidden = null;
  let header = null;
  let extra = 0;
  let manifest = false;
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# ss-grep:')) { header = line; continue; }
    // the indexed family manifest replaces the lowest-ranked body lines (reallocateGrepTailForManifest)
    if (line.startsWith('# indexed family:')) { manifest = true; continue; }
    if (line.startsWith('# +')) { hidden = line; continue; }
    if (line.startsWith('#') || line.startsWith('(')) continue;
    const m = line.match(HIT_RE);
    if (m && files.has(m[1])) hits.push({ file: m[1], line: Number(m[2]), more: m[3] ? Number(m[3]) : 0 });
    else extra++;
  }
  const hm = header?.match(/: (\d+) total match\(es\).*?(?: across (\d+) files)?$/);
  return { hits, hidden, extra, manifest, total: hm ? Number(hm[1]) : null, fileCount: hm ? Number(hm[2] || 1) : null, header };
}

/** The replay renders no family manifest: with one, the tool's body is the replay's prefix. */
function compare(tool, replay, call, byFile) {
  const diffs = [];
  const r = replay.rows.slice(0, tool.manifest || tool.extra ? tool.hits.length : replay.rows.length);
  const key = x => `${x.file}:${x.line}`;
  const total = Object.values(byFile).reduce((a, f) => a + f.total, 0);
  if (tool.total !== total || tool.fileCount !== Object.keys(byFile).length) diffs.push('counts');
  if (new Set(tool.hits.map(h => h.file)).size !== new Set(r.map(h => h.file)).size
      || ![...new Set(tool.hits.map(h => h.file))].every(f => r.some(x => x.file === f))) diffs.push('fileSet');
  const ts = new Set(tool.hits.map(key));
  if (ts.size !== r.length || !r.every(x => ts.has(key(x)))) diffs.push('selectedLines');
  else if (tool.hits.map(key).join('|') !== r.map(key).join('|')) diffs.push('order');
  if (tool.hits.map(h => h.more).join('|') !== r.map(x => x.more).join('|')) diffs.push('markers');
  if ((tool.hidden || null) !== (replay.hiddenLine || null)) diffs.push('hiddenLine');
  return diffs;
}

const pctl = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };

async function main() {
  const IN = argValue('--in', path.join(DEFAULT_OUT, 'collected-dev.json'));
  const PER_REPO = Number(argValue('--per-repo', '6'));
  const REPS = Number(argValue('--reps', '3'));
  const SEED = Number(argValue('--seed', '11'));
  const REPOS = argValue('--repos', DEFAULT_REPOS);
  const prereg = JSON.parse(readFileSync(path.join(HERE, 'prereg.json'), 'utf8'));
  const data = JSON.parse(readFileSync(IN, 'utf8'));
  const OUT = argValue('--out', path.join(DEFAULT_OUT, `fidelity-${data.set}.json`));
  const arms = prereg.arms.map(a => ({ ...a, env: a.alloc ? (a.env || {}) : { SS_FIX_GREP_ALLOC: '0' } }));

  const rnd = prng(SEED);
  // a probe has calls in several dossier runs, so probe#callIndex is not unique: id = position
  const byRepo = new Map();
  data.calls.forEach((c, i) => {
    c.uid = `c${i}`;
    if (!byRepo.has(c.repo)) byRepo.set(c.repo, []);
    byRepo.get(c.repo).push(c);
  });
  const results = [];
  const cold = [];
  for (const [repo, calls] of [...byRepo].sort()) {
    const seen = new Set();
    const pool = calls.filter(c => { if (seen.has(c.grepKey)) return false; seen.add(c.grepKey); return true; })
      .map(c => ({ c, r: rnd() })).sort((a, b) => a.r - b.r).map(x => x.c);
    const overflow = pool.filter(c => Object.keys(data.greps[c.grepKey] || {}).length > c.k);
    const sample = [...overflow.slice(0, Math.ceil(PER_REPO / 2)), ...pool.filter(c => !overflow.includes(c))]
      .slice(0, PER_REPO);
    const tmp = mkdtempSync(path.join(tmpdir(), 'grep-fidelity-job-'));
    const jobFile = path.join(tmp, 'job.json');
    const outFile = path.join(tmp, 'out.json');
    writeFileSync(jobFile, JSON.stringify({
      repoDir: path.join(REPOS, repo),
      outFile,
      reps: REPS,
      linesEnv: { SS_FIX_GREP_LINES: '1' },
      arms: arms.map(a => ({ name: a.name, env: a.env })),
      calls: sample.map(c => ({ id: c.uid, args: toolArgs(c) })),
    }));
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', jobFile], {
      cwd: path.join(REPOS, repo),
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: path.join(REPOS, repo) },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (child.status !== 0) {
      process.stderr.write(`[fidelity] ${repo}: worker failed\n${child.stderr.slice(-2000)}\n`);
      rmSync(tmp, { recursive: true, force: true });
      continue;
    }
    const rows = JSON.parse(readFileSync(outFile, 'utf8'));
    rmSync(tmp, { recursive: true, force: true });
    for (const row of rows.filter(x => x.kind === 'cold')) cold.push({ repo, ms: row.ms });
    const index = { spans: data.spans[repo] || {}, stale: new Set(data.stale[repo] || []) };
    for (const row of rows.filter(x => x.kind === 'call')) {
      const call = sample.find(c => c.uid === row.id);
      const byFile = data.greps[call.grepKey] || {};
      const arm = arms.find(a => a.name === row.arm);
      const replay = renderArm(call, matchList(byFile), arm, index);
      const tool = parseToolBody(row.stdout, new Set(Object.keys(byFile)));
      const diffs = compare(tool, replay, call, byFile);
      const hitKey = x => `${x.file}:${x.line}${x.more ? ` +${x.more}` : ''}`;
      results.push({ repo, id: row.id, probe: call.probe, args: call.args, arm: row.arm, ms: row.ms,
        diffs, toolHeader: tool.header, toolExtraLines: tool.extra, familyManifest: tool.manifest,
        replayTotal: Object.values(byFile).reduce((a, x) => a + x.total, 0), replayFiles: Object.keys(byFile).length,
        ...(diffs.length ? {
          toolHits: tool.hits.map(hitKey), replayHits: replay.rows.map(hitKey),
          toolHidden: tool.hidden, replayHidden: replay.hiddenLine,
        } : {}) });
    }
    process.stderr.write(`[fidelity] ${repo}: ${sample.length} calls x ${arms.length} arms\n`);
  }

  const summary = {};
  for (const a of arms) {
    const rs = results.filter(r => r.arm === a.name);
    const cats = {};
    for (const r of rs) for (const d of r.diffs) cats[d] = (cats[d] || 0) + 1;
    summary[a.name] = {
      calls: rs.length,
      exact: rs.filter(r => r.diffs.length === 0).length,
      mismatches: cats,
      familyManifestTrimmed: rs.filter(r => r.familyManifest).length,
    };
  }
  const byCall = new Map();
  for (const r of results) {
    if (!byCall.has(r.id)) byCall.set(r.id, {});
    byCall.get(r.id)[r.arm] = r.ms;
  }
  const deltas = [...byCall.values()].filter(v => v.shipped != null && v.lines != null).map(v => v.lines - v.shipped);
  const latency = {
    warm: {
      shippedP50: pctl(results.filter(r => r.arm === 'shipped').map(r => r.ms), 0.5),
      shippedP95: pctl(results.filter(r => r.arm === 'shipped').map(r => r.ms), 0.95),
      linesP50: pctl(results.filter(r => r.arm === 'lines').map(r => r.ms), 0.5),
      linesP95: pctl(results.filter(r => r.arm === 'lines').map(r => r.ms), 0.95),
      deltaP50: pctl(deltas, 0.5),
      deltaP95: pctl(deltas, 0.95),
    },
    coldFirstCallWithLines: { p50: pctl(cold.map(c => c.ms), 0.5), p95: pctl(cold.map(c => c.ms), 0.95), n: cold.length },
  };
  writeFileSync(OUT, JSON.stringify({ input: IN, set: data.set, seed: SEED, perRepo: PER_REPO, reps: REPS, summary, latency, results }, null, 2));
  const lines = ['arm                    exact/calls  manifest-trimmed  mismatches'];
  for (const [name, s] of Object.entries(summary)) {
    lines.push(`${name.padEnd(22)} ${String(s.exact).padStart(4)}/${String(s.calls).padEnd(6)}  ${String(s.familyManifestTrimmed).padStart(8)}          ${JSON.stringify(s.mismatches)}`);
  }
  const f = x => `${x.toFixed(1)} ms`;
  lines.push(`latency, warm (median of ${REPS}): shipped p50 ${f(latency.warm.shippedP50)} p95 ${f(latency.warm.shippedP95)}; `
    + `lines p50 ${f(latency.warm.linesP50)} p95 ${f(latency.warm.linesP95)}; per-call delta p50 ${f(latency.warm.deltaP50)} p95 ${f(latency.warm.deltaP95)}`);
  lines.push(`latency, first call of a fresh process with lines: p50 ${f(latency.coldFirstCallWithLines.p50)} p95 ${f(latency.coldFirstCallWithLines.p95)} (n=${cold.length})`);
  process.stdout.write(`${lines.join('\n')}\n-> ${OUT}\n`);
}

if (process.argv[2] === '--worker') await worker(process.argv[3]);
else await main();
