#!/usr/bin/env node
/**
 * ss-search / ss-find headroom, measured offline on recorded calls (docs/SUGGESTED_PLAN.md,
 * Step 5 item 1). No product change, no rerun: each recorded output is parsed as the agent saw it.
 *
 * Per call: the ranked entries (`## #N file:a-b [type: name] (tier ...)`), each with its
 * presentation tier — code (full / preview, or an untagged compact entry followed by a code
 * block) or name only (summary) — and the printed code lines. Then:
 *   - the first answer file's rank and tier;
 *   - answer-in-context: an answer symbol's declaration line printed with code (after
 *     "What Survives Into Context", arXiv 2607.00725);
 *   - an answer file named without code, and whether the next call opens it;
 *   - P(entry is in an answer file) by rank (the calibration Step 5 item 2 would use).
 * Declaration lines come from each repository's code graph (read-only), whose provenance is
 * verified first (eval/grep-allocation-replay/provenance.mjs).
 *
 * Usage: node eval/search-allocation-measure/measure.mjs [--set dev] [--out FILE]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import {
  DEFAULT_DOSSIERS, DEFAULT_PROBE_FILES, DEFAULT_REPOS, PERMITTED_SETS, REPO_ROOT,
  dossierCalls, loadProbes, pyList, symbolKey,
} from '../grep-allocation-replay/lib.mjs';
import { verifyRepo } from '../grep-allocation-replay/provenance.mjs';

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const ENTRY_RE = /^## #(\d+) (\S+?):(\d+)-(\d+)(?: \[([^\]]*)\])?(?: \((full|preview|summary)[^)]*\))?/;

/**
 * Ranked entries of one recorded ss-search / ss-find output.
 * @returns {Array<{rank, file, start, end, name, tier: 'code'|'name', printed: Set<number>}>}
 */
export function parseEntries(output) {
  const lines = String(output || '').split('\n');
  const entries = [];
  let cur = null;
  let fence = null; // 'imports' | 'code' | 'other'
  let label = null;
  let codeLine = 0;
  for (const line of lines) {
    if (fence) {
      if (line.startsWith('```')) { fence = null; continue; }
      if (fence === 'code' && cur) {
        const m = line.match(/^(\d+)\t/);
        cur.printed.add(m ? Number(m[1]) : cur.start + codeLine);
        codeLine++;
      }
      continue;
    }
    const e = line.match(ENTRY_RE);
    if (e) {
      cur = { rank: Number(e[1]), file: e[2], start: Number(e[3]), end: Number(e[4]),
        name: (e[5] || '').replace(/^[^:]*:\s*/, ''), tag: e[6] || null, printed: new Set() };
      entries.push(cur);
      label = null;
      continue;
    }
    if (line.startsWith('### ')) { label = line; continue; }
    if (line.startsWith('```')) {
      fence = label === '### imports' ? 'imports' : (label ? 'other' : 'code');
      codeLine = 0;
      label = null;
    }
  }
  for (const en of entries) en.tier = en.tag === 'summary' ? 'name' : (en.printed.size ? 'code' : 'name');
  return entries;
}

function nextOpens(row) {
  let after;
  try { after = typeof row.after === 'string' ? JSON.parse(row.after.replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')) : row.after; } catch { after = null; }
  const next = after?.nextCalls?.[0];
  return next ? String(next.args || '') : '';
}

async function main() {
  const SET = argValue('--set', 'dev');
  if (!PERMITTED_SETS.has(SET)) { process.stderr.write(`refusing --set ${SET}\n`); process.exit(2); }
  const OUT = argValue('--out', path.join(REPO_ROOT, 'eval/search-allocation-measure/out', `report-${SET}.json`));
  const probes = loadProbes(DEFAULT_PROBE_FILES);
  const rows = [];
  for (const tool of ['ss-search', 'ss-find']) {
    for (const row of dossierCalls(DEFAULT_DOSSIERS, tool)) {
      const probe = probes.get(row.id);
      if (!probe || probe.set !== SET) continue;
      if (!/^## #\d+ /m.test(row.output || '')) continue;
      rows.push({ tool, row, probe });
    }
  }
  const repos = [...new Set(rows.map(r => r.probe.repo))].sort();
  const graphs = {};
  const provenance = {};
  for (const repo of repos) {
    const dir = path.join(DEFAULT_REPOS, repo);
    provenance[repo] = await verifyRepo(dir, new Set(rows.filter(r => r.probe.repo === repo).map(r => r.probe.repoSha)));
    if (provenance[repo].problems.length && !process.argv.includes('--allow-mismatch')) {
      process.stderr.write(`refusing: ${repo}: ${provenance[repo].problems.join(' | ')}\n`);
      process.exit(3);
    }
    const db = new Database(path.join(dir, '.sweet-search', 'code-graph.db'), { readonly: true, fileMustExist: true });
    graphs[repo] = { db, stmt: db.prepare('SELECT name, start_line AS s FROM entities WHERE file_path = ? AND stale_since IS NULL AND start_line IS NOT NULL') };
  }

  const calls = [];
  const byRank = {};
  for (const { tool, row, probe } of rows) {
    const gold = new Set(pyList(row.goldFiles).length ? pyList(row.goldFiles) : probe.expectedFiles);
    const keys = new Set((pyList(row.goldSymbols).length ? pyList(row.goldSymbols) : probe.expectedSymbols).map(symbolKey));
    const entries = parseEntries(row.output);
    const g = graphs[probe.repo];
    const declsOf = new Map();
    const decls = (file) => {
      if (!declsOf.has(file)) declsOf.set(file, g.stmt.all(file).filter(e => keys.has(e.name)).map(e => e.s));
      return declsOf.get(file);
    };
    for (const e of entries) {
      const b = byRank[e.rank] || (byRank[e.rank] = { entries: 0, answer: 0, answerWithCode: 0, code: 0 });
      b.entries++;
      if (e.tier === 'code') b.code++;
      if (gold.has(e.file)) { b.answer++; if (e.tier === 'code') b.answerWithCode++; }
    }
    const goldEntries = entries.filter(e => gold.has(e.file));
    const first = goldEntries[0] || null;
    const answerInContext = goldEntries.some(e => e.tier === 'code' && decls(e.file).some(l => e.printed.has(l)));
    const goldFilesWithCode = new Set(goldEntries.filter(e => e.tier === 'code').map(e => e.file));
    const nameOnlyGold = [...new Set(goldEntries.filter(e => !goldFilesWithCode.has(e.file)).map(e => e.file))];
    const next = nextOpens(row);
    calls.push({
      tool, probe: row.id, entries: entries.length,
      firstAnswerRank: first ? first.rank : null,
      firstAnswerTier: first ? first.tier : null,
      answerFileNamedWithoutCodeAnywhere: nameOnlyGold.length > 0,
      answerNamedButNoneWithCode: goldEntries.length > 0 && goldFilesWithCode.size === 0,
      nextCallOpensNameOnlyAnswer: nameOnlyGold.some(f => next.includes(f)),
      answerInContext,
      answerDeclAvailable: goldEntries.some(e => decls(e.file).length > 0),
    });
  }
  for (const g of Object.values(graphs)) g.db.close();

  const summarize = (xs) => {
    const withAnswer = xs.filter(c => c.firstAnswerRank != null);
    const bucket = r => (r === 1 ? '1' : r <= 5 ? '2-5' : '6+');
    const ranks = {};
    for (const c of withAnswer) {
      const k = `${bucket(c.firstAnswerRank)} ${c.firstAnswerTier}`;
      ranks[k] = (ranks[k] || 0) + 1;
    }
    const nameOnlyRanks = {};
    for (const c of withAnswer.filter(x => x.firstAnswerTier === 'name')) nameOnlyRanks[bucket(c.firstAnswerRank)] = (nameOnlyRanks[bucket(c.firstAnswerRank)] || 0) + 1;
    return {
      calls: xs.length,
      probes: new Set(xs.map(c => c.probe)).size,
      withAnswerFile: withAnswer.length,
      firstAnswerRankAndTier: ranks,
      firstAnswerNameOnlyByRank: nameOnlyRanks,
      answerFileNamedWithoutCodeAnywhere: xs.filter(c => c.answerFileNamedWithoutCodeAnywhere).length,
      answerNamedButNoneWithCode: xs.filter(c => c.answerNamedButNoneWithCode).length,
      nextCallOpensNameOnlyAnswer: xs.filter(c => c.nextCallOpensNameOnlyAnswer).length,
      answerInContext: xs.filter(c => c.answerInContext).length,
      answerDeclAvailable: xs.filter(c => c.answerDeclAvailable).length,
    };
  };
  const report = {
    set: SET,
    exploratory: SET === 'dev',
    provenance,
    tools: { 'ss-search': summarize(calls.filter(c => c.tool === 'ss-search')), 'ss-find': summarize(calls.filter(c => c.tool === 'ss-find')) },
    answerRateByRank: Object.fromEntries(Object.entries(byRank).filter(([r]) => Number(r) <= 12).map(([r, b]) => [r, {
      entries: b.entries, pAnswer: b.answer / b.entries, pCode: b.code / b.entries, pAnswerWithCode: b.answerWithCode / b.entries,
    }])),
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ ...report, calls }, null, 2));
  process.stdout.write(`${JSON.stringify(report.tools, null, 2)}\nanswer rate by rank:\n`);
  for (const [r, b] of Object.entries(report.answerRateByRank)) {
    process.stdout.write(`  #${r.padEnd(3)} n=${String(b.entries).padEnd(5)} P(answer file)=${(100 * b.pAnswer).toFixed(1).padStart(5)}%  P(code)=${(100 * b.pCode).toFixed(1).padStart(5)}%  P(answer with code)=${(100 * b.pAnswerWithCode).toFixed(1).padStart(5)}%\n`);
  }
  process.stdout.write(`-> ${OUT}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) await main();
