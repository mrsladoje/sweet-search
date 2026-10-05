#!/usr/bin/env node
/**
 * ss-search / ss-find first-unit replay (docs/SUGGESTED_PLAN.md at 945a9664, Step 5 item 2), offline, dev.
 *
 * Re-runs every recorded ss-search / ss-find call on dev probes through the daemon's own search
 * path (SweetSearch.search with the options the server builds for an agent request; the warm
 * in-process searcher, no daemon) under three arms:
 *   shipped      no switch
 *   calibrated   SS_FIX_SEARCH_FIRST_UNIT=calibrated (ranks 4-5 get a 60-token unit)
 *   all          SS_FIX_SEARCH_FIRST_UNIT=all (every rank past 3; the plain guarantee)
 * Per call: answer-in-context (an answer symbol's declaration line inside a result printed with
 * code), an answer file shown with code at all, and tokens used. Paired, probe-clustered
 * bootstrap against shipped. MMR / candidate selection is untouched by every arm, so the result
 * list is the same; only presentation differs.
 *
 * Usage: node eval/search-allocation-measure/replay.mjs [--set dev] [--out FILE]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DOSSIERS, DEFAULT_PROBE_FILES, DEFAULT_REPOS, PERMITTED_SETS, REPO_ROOT,
  dossierCalls, loadProbes, mean, pairedBootstrap, pyList, shellWords, symbolKey,
} from '../grep-allocation-replay/lib.mjs';
import { verifyRepo } from '../grep-allocation-replay/provenance.mjs';

const ARMS = ['shipped', 'calibrated', 'all'];
const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** The tool's own argument handling for ss-search / ss-find, or null for a scoped / globbed call. */
function parseCall(tool, args) {
  let toks;
  try { toks = shellWords(args).slice(1); } catch { return null; }
  const out = { tool, format: 'agent', k: tool === 'ss-find' ? 6 : 5, mode: 'auto', regex: '', i: false, w: false, F: false, query: null };
  for (let j = 0; j < toks.length; j++) {
    const t = toks[j];
    if (t === '--full') out.format = 'agent_full';
    else if (t === '--xl') out.format = 'agent_full_xl';
    else if (t === '-k' || t === '--top') out.k = Number(toks[++j]) || out.k;
    else if (t === '--mode') out.mode = toks[++j];
    else if (t === '--regex') out.regex = toks[++j] ?? '';
    else if (t === '-i' || t === '--ignore-case') out.i = true;
    else if (t === '-w' || t === '--word-regexp') out.w = true;
    else if (t === '-F' || t === '--fixed-strings') out.F = true;
    else if (t === '--in' || t === '-g' || t === '--glob' || t === '--include' || t === '--exclude' || t === '--exclude-dir') return null;
    else if (t.startsWith('-')) { /* inert flag */ } else if (out.query == null) out.query = t;
    else return null;
  }
  return out.query ? out : null;
}

/** Lines a packaged result prints: its start line on, minus the truncation marker lines. */
function printedLines(r) {
  if (!r.code || r.presentation === 'summary') return null;
  const n = String(r.code).split('\n').filter(l => !/^\s*\/\/ \.\.\. \(\d+ more lines?\)\s*$/.test(l)).length;
  return [r.startLine, r.startLine + n - 1];
}

// --- worker ---------------------------------------------------------------------------------
async function worker(jobFile) {
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  const Database = (await import('better-sqlite3')).default;
  const { SweetSearch } = await import('../../core/search/sweet-search.js');
  const { LATE_INTERACTION_CONFIG } = await import('../../core/infrastructure/config/index.js');
  const { buildGrepPattern } = await import('../agent-read-workflows/bin/_ss-argparse.mjs');
  const searcher = new SweetSearch({ projectRoot: job.repoDir });
  await searcher.init();
  const db = new Database(path.join(job.repoDir, '.sweet-search', 'code-graph.db'), { readonly: true, fileMustExist: true });
  const ents = db.prepare('SELECT name, start_line AS s FROM entities WHERE file_path = ? AND stale_since IS NULL AND start_line IS NOT NULL');
  const out = [];
  for (const c of job.calls) {
    const keys = new Set(c.goldSymbols.map(symbolKey));
    const gold = new Set(c.goldFiles);
    const declCache = new Map();
    const decls = f => { if (!declCache.has(f)) declCache.set(f, ents.all(f).filter(e => keys.has(e.name)).map(e => e.s)); return declCache.get(f); };
    const regex = c.tool === 'ss-find' ? (buildGrepPattern(c.regex || '', { ignoreCase: c.i, wordBound: c.w, fixedString: c.F }) || '\\b\\w+\\b') : '';
    const row = { id: c.id, probe: c.probe, tool: c.tool, arms: {} };
    for (const arm of ARMS) {
      let res;
      try {
        res = await searcher.search(c.query, {
          k: c.k, mode: c.tool === 'ss-find' ? 'pattern' : c.mode, regex, maxMatches: 0, contextLines: 0,
          perFileCap: 0, maxFiles: 0, fixedString: false, type: '', globs: [], literalFilter: true, gramIndex: true,
          expand: true, rerank: true, fusion: 'cc', useLateInteraction: LATE_INTERACTION_CONFIG.enabled,
          _isAgentFormat: c.tool === 'ss-find' ? !c.F : true, _siblingLine: true, _cwdScope: false,
          format: c.format, ...(arm === 'shipped' ? {} : { firstUnit: arm }),
        });
      } catch (err) {
        row.arms[arm] = { error: String(err.message || err).slice(0, 200) };
        continue;
      }
      const results = res.results || [];
      const goldWithCode = results.filter(r => gold.has(r.file) && printedLines(r));
      row.arms[arm] = {
        tokensUsed: res.tokensUsed ?? null,
        files: results.map(r => `${r.file}:${r.startLine}`),
        withCode: results.filter(r => printedLines(r)).length,
        answerFileWithCode: goldWithCode.length > 0,
        answerInContext: goldWithCode.some((r) => { const [a, b] = printedLines(r); return decls(r.file).some(l => l >= a && l <= b); }),
        answerFileListed: results.some(r => gold.has(r.file)),
      };
    }
    out.push(row);
  }
  db.close();
  writeFileSync(job.outFile, JSON.stringify(out));
  process.exit(0);
}

// --- parent -----------------------------------------------------------------------------------
async function main() {
  const SET = argValue('--set', 'dev');
  if (!PERMITTED_SETS.has(SET)) { process.stderr.write(`refusing --set ${SET}\n`); process.exit(2); }
  const OUT = argValue('--out', path.join(REPO_ROOT, 'eval/search-allocation-measure/out', `replay-${SET}.json`));
  const probes = loadProbes(DEFAULT_PROBE_FILES);
  const calls = new Map();
  let scoped = 0;
  for (const tool of ['ss-search', 'ss-find']) {
    for (const row of dossierCalls(DEFAULT_DOSSIERS, tool)) {
      const probe = probes.get(row.id);
      if (!probe || probe.set !== SET) continue;
      const parsed = parseCall(tool, row.args);
      if (!parsed) { scoped++; continue; }
      const key = `${probe.repo}\0${tool}\0${row.args}`;
      if (calls.has(key)) continue;
      calls.set(key, { id: `q${calls.size}`, probe: row.id, repo: probe.repo, repoSha: probe.repoSha, ...parsed,
        goldFiles: pyList(row.goldFiles).length ? pyList(row.goldFiles) : probe.expectedFiles,
        goldSymbols: pyList(row.goldSymbols).length ? pyList(row.goldSymbols) : probe.expectedSymbols });
    }
  }
  const all = [...calls.values()];
  process.stderr.write(`[first-unit] ${all.length} unique calls (${scoped} scoped / globbed / unparsable skipped)\n`);
  const repos = [...new Set(all.map(c => c.repo))].sort();
  const provenance = {};
  for (const repo of repos) {
    provenance[repo] = await verifyRepo(path.join(DEFAULT_REPOS, repo), new Set(all.filter(c => c.repo === repo).map(c => c.repoSha)));
    if (provenance[repo].problems.length && !process.argv.includes('--allow-mismatch')) {
      process.stderr.write(`[first-unit] refusing: ${repo}: ${provenance[repo].problems.join(' | ')}\n`);
      process.exit(3);
    }
  }
  const rows = [];
  for (const repo of repos) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'first-unit-job-'));
    const job = path.join(tmp, 'job.json');
    const outFile = path.join(tmp, 'out.json');
    const repoDir = path.join(DEFAULT_REPOS, repo);
    writeFileSync(job, JSON.stringify({ repoDir, outFile, calls: all.filter(c => c.repo === repo) }));
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', job], {
      cwd: repoDir, env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: repoDir }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.status !== 0) { process.stderr.write(`[first-unit] ${repo}: worker failed\n${String(child.stderr).slice(-1500)}\n`); rmSync(tmp, { recursive: true, force: true }); continue; }
    rows.push(...JSON.parse(readFileSync(outFile, 'utf8')));
    rmSync(tmp, { recursive: true, force: true });
    process.stderr.write(`[first-unit] ${repo}: ${all.filter(c => c.repo === repo).length} calls\n`);
  }

  const ok = rows.filter(r => ARMS.every(a => r.arms[a] && !r.arms[a].error));
  const sameLists = ok.filter(r => ARMS.every(a => JSON.stringify(r.arms[a].files) === JSON.stringify(r.arms.shipped.files))).length;
  const report = { set: SET, exploratory: SET === 'dev', calls: rows.length, replayed: ok.length, sameResultLists: sameLists, tools: {} };
  for (const tool of ['ss-search', 'ss-find', 'both']) {
    const xs = ok.filter(r => tool === 'both' || r.tool === tool);
    const t = { calls: xs.length, probes: new Set(xs.map(r => r.probe)).size, arms: {}, vsShipped: {} };
    for (const a of ARMS) {
      t.arms[a] = {
        answerInContext: mean(xs.map(r => (r.arms[a].answerInContext ? 1 : 0))),
        answerFileWithCode: mean(xs.map(r => (r.arms[a].answerFileWithCode ? 1 : 0))),
        meanTokens: mean(xs.map(r => r.arms[a].tokensUsed || 0)),
        meanEntriesWithCode: mean(xs.map(r => r.arms[a].withCode)),
      };
      if (a === 'shipped') continue;
      const pair = (f) => pairedBootstrap(xs.map(r => ({ probe: r.probe, value: f(r.arms[a]) })), xs.map(r => ({ probe: r.probe, value: f(r.arms.shipped) })));
      t.vsShipped[a] = {
        answerInContext: pair(x => (x.answerInContext ? 1 : 0)),
        answerFileWithCode: pair(x => (x.answerFileWithCode ? 1 : 0)),
        tokens: pair(x => x.tokensUsed || 0),
      };
    }
    report.tools[tool] = t;
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ ...report, provenance, rows }, null, 2));
  const ci = c => `${c.diff >= 0 ? '+' : ''}${(100 * c.diff).toFixed(1)} [${(100 * c.lo).toFixed(1)}, ${(100 * c.hi).toFixed(1)}]`;
  const lines = [`${report.exploratory ? 'EXPLORATORY' : 'CONFIRMATION'}: ${report.replayed}/${report.calls} calls replayed; result lists identical across arms on ${sameLists}`];
  for (const [tool, t] of Object.entries(report.tools)) {
    lines.push(`\n== ${tool}: ${t.calls} calls, ${t.probes} probes`);
    for (const a of ARMS) {
      const s = t.arms[a];
      lines.push(`  ${a.padEnd(11)} answer-in-context ${(100 * s.answerInContext).toFixed(1)}%  answer file with code ${(100 * s.answerFileWithCode).toFixed(1)}%  tokens ${s.meanTokens.toFixed(0)}  entries with code ${s.meanEntriesWithCode.toFixed(2)}`);
    }
    for (const [a, c] of Object.entries(t.vsShipped)) {
      lines.push(`  ${a} - shipped: answer-in-context ${ci(c.answerInContext)} pts; answer file with code ${ci(c.answerFileWithCode)} pts; tokens ${c.tokens.diff >= 0 ? '+' : ''}${c.tokens.diff.toFixed(0)} [${c.tokens.lo.toFixed(0)}, ${c.tokens.hi.toFixed(0)}]`);
    }
  }
  process.stdout.write(`${lines.join('\n')}\n-> ${OUT}\n`);
}

if (process.argv[2] === '--worker') await worker(process.argv[3]);
else await main();
