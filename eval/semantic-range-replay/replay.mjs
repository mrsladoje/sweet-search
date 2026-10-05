#!/usr/bin/env node
/**
 * ss-semantic cut-span replay (docs/SUGGESTED_PLAN.md at 945a9664, Step 3a bar and Step 3b measurement).
 *
 * Takes the recorded ss-semantic calls on dev probes whose output reported exactly the 600-token
 * cap, and re-runs each one through the REAL ss-semantic tool code (runAgentTool, in-process
 * readSemantic over the repository's real index; no daemon) under three arms:
 *   shipped  no switch
 *   ranges   SS_FIX_SEMANTIC_RANGES=1 (Step 3a)
 *   pick     SS_FIX_SEMANTIC_PICK=1 (Step 3b)
 * and once more through readSemantic's JSON per arm, for the chosen chunks and the cut ranges.
 *
 * Step 3a bar: under `ranges`, every `### file:start-end` header names exactly the printed lines;
 * the omitted ranges plus the printed range cover the merged span exactly; the chosen chunks
 * equal the shipped arm's; the ledger records only whole printed lines. Step 3b: on calls where
 * an answer symbol's declaration lies in the merged span, is it printed, and at what token cost.
 *
 * Provenance is verified per repository first (eval/grep-allocation-replay/provenance.mjs).
 *
 * Usage: node eval/semantic-range-replay/replay.mjs [--set dev] [--out FILE] [--allow-mismatch]
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DOSSIERS, DEFAULT_PROBE_FILES, DEFAULT_REPOS, PERMITTED_SETS, REPO_ROOT,
  dossierCalls, loadProbes, pyList, shellWords, symbolKey,
} from '../grep-allocation-replay/lib.mjs';
import { verifyRepo } from '../grep-allocation-replay/provenance.mjs';

const ARMS = [
  { name: 'shipped', env: {}, req: {} },
  { name: 'ranges', env: { SS_FIX_SEMANTIC_RANGES: '1' }, req: { exactRanges: true } },
  { name: 'pick', env: { SS_FIX_SEMANTIC_PICK: '1' }, req: { pickExcerpt: true } },
];
const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** [{start, end, code: string[], before: string[], after: string[]}] of a printed ss-semantic output. */
export function printedBlocks(out) {
  const lines = out.split('\n');
  const blocks = [];
  let pendingBefore = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# not shown:')) { pendingBefore.push(lines[i]); continue; }
    const h = lines[i].match(/^### .+:(\d+)-(\d+)(?: \[.*\])?$/);
    if (!h) continue;
    let j = i + 2;
    const code = [];
    while (j < lines.length && lines[j] !== '```') code.push(lines[j++]);
    while (code.length && code[code.length - 1] === '') code.pop();
    const after = [];
    let a = j + 1;
    while (a < lines.length && (lines[a].startsWith('# not shown:') || /^\(line \d+ truncated:/.test(lines[a]))) {
      // a "not shown" BEFORE the next header belongs to that header, not to this block
      if (lines[a].startsWith('# not shown:') && lines[a + 1]?.startsWith('### ')) break;
      after.push(lines[a++]);
    }
    blocks.push({ start: Number(h[1]), end: Number(h[2]), code, before: pendingBefore, after });
    pendingBefore = [];
    i = a - 1;
  }
  return blocks;
}

const notShownRange = l => { const m = l.match(/^# not shown: lines (\d+)-(\d+) — ss-read \S+ \1 \2$/); return m ? [Number(m[1]), Number(m[2])] : null; };

// --- worker ---------------------------------------------------------------------------------
async function worker(jobFile) {
  const job = JSON.parse(readFileSync(jobFile, 'utf8'));
  const Database = (await import('better-sqlite3')).default;
  const { readSemantic } = await import('../../core/search/search-read-semantic.js');
  const { collectSemanticShownSpans } = await import('../../core/search/agent-span-ledger.js');
  const { runAgentTool } = await import('../agent-read-workflows/bin/_ss-helpers.mjs');
  const { runInVirtualProcess } = await import('../../core/agent-tools/virtual-process.js');
  const db = new Database(path.join(job.repoDir, '.sweet-search', 'code-graph.db'), { readonly: true, fileMustExist: true });
  const ents = db.prepare('SELECT name, start_line AS s, end_line AS e FROM entities WHERE file_path = ? AND stale_since IS NULL AND start_line IS NOT NULL');
  const runtime = mkdtempSync(path.join(tmpdir(), 'semantic-replay-'));
  const baseEnv = {
    PATH: process.env.PATH || '', HOME: process.env.HOME || '',
    SWEET_SEARCH_PROJECT_ROOT: job.repoDir,
    SWEET_SEARCH_SOCKET_PATH: path.join(runtime, 'no-daemon.sock'),
    SWEET_SEARCH_RUNTIME_DIR: runtime,
    SWEET_SEARCH_EXACT_REREAD_OMISSION: '0',
    SWEET_SEARCH_SHOWN_SPAN_TRAILER: '0',
  };
  const out = [];
  for (const c of job.calls) {
    const keys = new Set(c.goldSymbols.map(symbolKey));
    const decls = ents.all(c.file).filter(e => keys.has(e.name)).map(e => e.s);
    const row = { id: c.id, file: c.file, decls, arms: {} };
    for (const arm of ARMS) {
      const r = await runInVirtualProcess({ env: { ...baseEnv, ...arm.env }, cwd: job.repoDir },
        () => runAgentTool('semantic', [c.file, c.query], { getSearcher: () => ({}) }));
      const json = await readSemantic({ path: c.file, query: c.query, projectRoot: job.repoDir, maxChars: 2400, ...arm.req });
      row.arms[arm.name] = {
        code: r.code,
        stdout: r.stdout.toString('utf8'),
        spans: (json.spans || []).map(s => ({
          startLine: s.startLine, endLine: s.endLine, fullStartLine: s.fullStartLine, fullEndLine: s.fullEndLine,
          truncated: s.truncated === true, partial: !!s.partialLine, chunkIds: s.chunkIds || [], textLines: s.text ? s.text.replace(/\n$/, '').split('\n').length : 0,
        })),
        chars: json.charsReturned ?? null,
        ledger: collectSemanticShownSpans(json, { projectRoot: job.repoDir }).map(s => [s.startLine, s.endLine]),
        fellBack: !!json.fellBack,
      };
    }
    out.push(row);
  }
  db.close();
  rmSync(runtime, { recursive: true, force: true });
  writeFileSync(job.outFile, JSON.stringify(out));
  process.exit(0);
}

// --- parent -----------------------------------------------------------------------------------
function analyze(row) {
  const s = row.arms.shipped; const g = row.arms.ranges; const p = row.arms.pick;
  const sb = printedBlocks(s.stdout); const gb = printedBlocks(g.stdout); const pb = printedBlocks(p.stdout);
  const cut = s.spans.find(x => x.truncated);
  const res = { id: row.id, cutToday: !!cut, fellBack: s.fellBack };
  // shipped: how many lines the header claims beyond what was printed
  res.shippedOverclaim = sb.reduce((n, b) => n + Math.max(0, (b.end - b.start + 1) - b.code.length), 0);
  // ranges: header = printed lines, everywhere
  const exact = blocks => blocks.every(b => b.code.length === b.end - b.start + 1);
  res.rangesHeaderExact = exact(gb);
  res.pickHeaderExact = exact(pb);
  // omitted + printed = the merged span, for the cut span
  const cover = (blocks, spans) => spans.filter(x => x.truncated).every((x) => {
    const b = blocks.find(bl => bl.start === x.startLine && bl.end === x.endLine);
    if (!b) return false;
    const ranges = [...b.before, ...b.after].map(notShownRange).filter(Boolean);
    const covered = new Set();
    for (let l = b.start; l <= b.end; l++) covered.add(l);
    for (const [a, z] of ranges) for (let l = a; l <= z; l++) covered.add(l);
    for (let l = x.fullStartLine; l <= x.fullEndLine; l++) if (!covered.delete(l)) return false;
    return covered.size === 0;
  });
  res.rangesCoverExact = cover(gb, g.spans);
  res.pickCoverExact = cover(pb, p.spans);
  res.sameChunks = JSON.stringify(s.spans.map(x => x.chunkIds)) === JSON.stringify(g.spans.map(x => x.chunkIds));
  res.ledgerWholeLinesOnly = g.ledger.every(([a, z]) => g.spans.some(x => !x.partial && x.startLine === a && x.endLine === z));
  res.ledgerRecordsCut = g.spans.some(x => x.truncated && !x.partial) ? g.ledger.length > s.ledger.length : null;
  // Step 3b: answer declarations inside the merged (claimed) cut range, and whether printed
  if (cut) {
    const full = g.spans.find(x => x.truncated);
    const inside = row.decls.filter(l => l >= full.fullStartLine && l <= full.fullEndLine);
    if (inside.length) {
      const printedIn = (blocks, l) => blocks.some(b => l >= b.start && l <= b.start + b.code.length - 1);
      res.declInside = inside.length;
      res.declPrinted = {
        shipped: inside.some(l => printedIn(sb, l)),
        ranges: inside.some(l => printedIn(gb, l)),
        pick: inside.some(l => printedIn(pb, l)),
      };
    }
  }
  res.chars = { shipped: s.chars, ranges: g.chars, pick: p.chars };
  return res;
}

async function main() {
  const SET = argValue('--set', 'dev');
  if (!PERMITTED_SETS.has(SET)) { process.stderr.write(`refusing --set ${SET}\n`); process.exit(2); }
  const OUT = argValue('--out', path.join(REPO_ROOT, 'eval/semantic-range-replay/out', `report-${SET}.json`));
  const probes = loadProbes(DEFAULT_PROBE_FILES);
  const calls = new Map();
  let otherSet = 0;
  for (const row of dossierCalls(DEFAULT_DOSSIERS, 'ss-semantic')) {
    const m = String(row.output || '').match(/^# ss-semantic .+ \| spans=\d+ \| ~tokens=(\d+)/m);
    if (!m || m[1] !== '600') continue;
    const probe = probes.get(row.id);
    if (!probe) continue;
    if (probe.set !== SET) { otherSet++; continue; }
    const toks = shellWords(row.args);
    const [file, query] = [toks[1], toks[2]];
    const key = `${probe.repo}\0${file}\0${query}`;
    if (!calls.has(key)) {
      calls.set(key, { id: `s${calls.size}`, probe: row.id, repo: probe.repo, repoSha: probe.repoSha, file, query,
        goldSymbols: pyList(row.goldSymbols).length ? pyList(row.goldSymbols) : probe.expectedSymbols, recorded: 0 });
    }
    calls.get(key).recorded++;
  }
  const all = [...calls.values()];
  const recorded = all.reduce((n, c) => n + c.recorded, 0);
  process.stderr.write(`[semantic] ${recorded} recorded cut calls (${all.length} unique) on set ${SET}; ${otherSet} on other sets not read\n`);

  const repos = [...new Set(all.map(c => c.repo))].sort();
  const provenance = {};
  for (const repo of repos) {
    provenance[repo] = await verifyRepo(path.join(DEFAULT_REPOS, repo), new Set(all.filter(c => c.repo === repo).map(c => c.repoSha)));
    if (provenance[repo].problems.length && !process.argv.includes('--allow-mismatch')) {
      process.stderr.write(`[semantic] refusing: ${repo}: ${provenance[repo].problems.join(' | ')}\n`);
      process.exit(3);
    }
  }

  const rows = [];
  for (const repo of repos) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'semantic-replay-job-'));
    const job = path.join(tmp, 'job.json');
    const outFile = path.join(tmp, 'out.json');
    const repoDir = path.join(DEFAULT_REPOS, repo);
    writeFileSync(job, JSON.stringify({ repoDir, outFile, calls: all.filter(c => c.repo === repo) }));
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', job], {
      cwd: repoDir, env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: repoDir }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.status !== 0) { process.stderr.write(`[semantic] ${repo}: worker failed\n${String(child.stderr).slice(-1500)}\n`); rmSync(tmp, { recursive: true, force: true }); continue; }
    rows.push(...JSON.parse(readFileSync(outFile, 'utf8')).map(r => ({ repo, ...r })));
    rmSync(tmp, { recursive: true, force: true });
    process.stderr.write(`[semantic] ${repo}: ${all.filter(c => c.repo === repo).length} calls\n`);
  }

  const results = rows.map(r => ({ repo: r.repo, ...analyze(r) }));
  const cut = results.filter(r => r.cutToday);
  const withDecl = cut.filter(r => r.declPrinted);
  const count = (xs, f) => xs.filter(f).length;
  const meanChars = (xs, arm) => xs.reduce((n, r) => n + (r.chars[arm] || 0), 0) / Math.max(1, xs.length);
  const summary = {
    set: SET,
    exploratory: SET === 'dev',
    recordedCutCalls: recorded,
    uniqueCalls: all.length,
    replayed: results.length,
    cutToday: cut.length,
    shippedOverclaiming: count(cut, r => r.shippedOverclaim > 0),
    shippedOverclaimMedianLines: cut.map(r => r.shippedOverclaim).sort((a, b) => a - b)[Math.floor(cut.length / 2)] ?? null,
    step3a: {
      headerExact: count(results, r => r.rangesHeaderExact),
      omittedPlusPrintedCoversSpan: count(cut, r => r.rangesCoverExact),
      sameChunksAsShipped: count(results, r => r.sameChunks),
      ledgerWholeLinesOnly: count(results, r => r.ledgerWholeLinesOnly),
      ledgerNowRecordsCutSpan: count(cut, r => r.ledgerRecordsCut === true),
    },
    step3b: {
      callsWithAnswerDeclInsideCutSpan: withDecl.length,
      declNotPrinted: {
        shipped: count(withDecl, r => !r.declPrinted.shipped),
        ranges: count(withDecl, r => !r.declPrinted.ranges),
        pick: count(withDecl, r => !r.declPrinted.pick),
      },
      pickHeaderExact: count(results, r => r.pickHeaderExact),
      pickCoverExact: count(cut, r => r.pickCoverExact),
      meanCharsOnCutCalls: { shipped: meanChars(cut, 'shipped'), ranges: meanChars(cut, 'ranges'), pick: meanChars(cut, 'pick') },
    },
  };
  summary.step3a.pass = summary.step3a.headerExact === results.length && summary.step3a.sameChunksAsShipped === results.length
    && summary.step3a.omittedPlusPrintedCoversSpan === cut.length && summary.step3a.ledgerWholeLinesOnly === results.length;
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ summary, provenance, results }, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n-> ${OUT}\n`);
}

if (process.argv[2] === '--worker') await worker(process.argv[3]);
else if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
