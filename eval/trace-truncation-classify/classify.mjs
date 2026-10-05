#!/usr/bin/env node
/**
 * ss-trace: label every shortened list and every non-full code item with its cause
 * (docs/SUGGESTED_PLAN.md at 945a9664, "Later — ss-trace: classify truncation before changing budgets").
 *
 * Each recorded ss-trace call on dev probes is re-run through traceSymbol on a READ-ONLY COPY of
 * the repository's code graph (the copy's directory also takes the read pin), with the tool's own
 * argument grammar and its A4 fallbacks (wrong --in file, test definition). Then:
 *   lists (callers / callees / impact) shorter than available, by cause:
 *     item-limit       the row limit derived from the section budget (sectionItemLimit /
 *                      impactPathLimit) stopped the list
 *     section-budget   the section's token share ran out first
 *   and whether the total budget still had room (the share binds while tokens sit unused);
 *   caller / callee items printed as preview or summary instead of full code, by cause:
 *     per-item-cap     the item is larger than itemCodeCap(tier)
 *     section-budget   it would fit the per-item cap, the section had no room left
 *   and, for every label, whether the agent sees it in the product's printed output:
 *     hidden-by-mode   the mode word (callers / callees / impact) does not print that section
 *     format-no-code   the compact trace (SS_FIX_TRACE_COMPACT, the default) prints items as one
 *                      summary line, so a code cut is invisible
 *
 * Usage: node eval/trace-truncation-classify/classify.mjs [--set dev] [--out FILE]
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_DOSSIERS, DEFAULT_PROBE_FILES, DEFAULT_REPOS, PERMITTED_SETS, REPO_ROOT,
  dossierCalls, loadProbes, shellWords,
} from '../grep-allocation-replay/lib.mjs';
import { verifyRepo } from '../grep-allocation-replay/provenance.mjs';
import { traceSymbol } from '../../core/search/search-trace.js';
import { impactPathLimit, itemCodeCap, modeSectionShares, sectionItemLimit, sectionShares, TRACE_MODES } from '../../core/graph/structural-context.js';
import { formatTraceCompact, isTestLikePath } from '../../core/search/agent-output-fixes.js';

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/** cmdTrace's grammar: symbol, optional mode word, --in/--file, --query/--hint, --depth, --budget. */
export function parseTrace(args) {
  let toks;
  try { toks = shellWords(args).slice(1); } catch { return null; }
  const out = { symbol: null, mode: null, filePath: null, queryHint: '', maxDepth: null, tokenBudget: null };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === '--in' || t === '--file') out.filePath = toks[++i];
    else if (t === '--query' || t === '--hint') out.queryHint = toks[++i] ?? '';
    else if (t === '--depth') out.maxDepth = Number(toks[++i]);
    else if (t === '--budget') out.tokenBudget = Number(toks[++i]);
    else if (t.startsWith('-')) { /* --json and inert flags */ } else if (!out.symbol) out.symbol = t;
    else if (!out.mode && TRACE_MODES.includes(t.toLowerCase())) out.mode = t.toLowerCase();
    else return null;
  }
  return out.symbol ? out : null;
}

function graphCopy(repoDir) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'trace-classify-'));
  const state = path.join(repoDir, '.sweet-search');
  for (const n of ['code-graph.db', 'code-graph.db-wal', 'code-graph.db-shm', 'reconcile-manifest.json']) {
    if (existsSync(path.join(state, n))) copyFileSync(path.join(state, n), path.join(tmp, n));
  }
  return { graphDbPath: path.join(tmp, 'code-graph.db'), cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** The tool's A4 target fallbacks (cmdTrace with SS_FIX_TRACE_COMPACT). */
function traceLikeTool(call, base) {
  const opts = { ...base, ...(call.filePath ? { filePath: call.filePath } : {}), ...(call.queryHint ? { queryHint: call.queryHint } : {}),
    ...(call.maxDepth ? { maxDepth: call.maxDepth } : {}), ...(call.tokenBudget ? { tokenBudget: call.tokenBudget } : {}) };
  let r = traceSymbol(call.symbol, opts);
  if (!r.target && opts.filePath) {
    const wide = traceSymbol(call.symbol, { ...opts, filePath: undefined });
    if (wide.target) r = wide;
  }
  if (r.target && !(call.filePath && isTestLikePath(call.filePath)) && isTestLikePath(r.target.filePath)) {
    const alt = (r.disambiguation || []).find(a => a.file && !isTestLikePath(a.file));
    if (alt) {
      const better = traceSymbol(call.symbol, { ...opts, filePath: alt.file });
      if (better.target && !isTestLikePath(better.target.filePath)) r = better;
    }
  }
  return r;
}

export function classify(r, call, { modeBudget = false } = {}) {
  const base = sectionShares({ fanIn: r.target.fanIn, fanOut: r.target.fanOut }, call.queryHint, r.target);
  const shares = modeBudget ? modeSectionShares(base, call.mode) : base;
  const budgetOf = sec => Math.floor(r.tokenBudget * shares[sec]);
  const roomLeft = r.tokenBudget - r.tokensUsed > 0;
  const shown = sec => call.mode === null || call.mode === sec;
  const labels = [];
  for (const sec of ['callers', 'callees']) {
    const s = r.sections[sec];
    const available = r.stats[sec];
    if (s.shown < available) {
      labels.push({ kind: 'list', section: sec, cause: s.shown >= sectionItemLimit(budgetOf(sec)) ? 'item-limit' : 'section-budget',
        roomLeft, visible: shown(sec), hiddenBy: shown(sec) ? null : 'mode', shown: s.shown, available });
    }
    const cap = itemCodeCap(r.budgetTier);
    for (const it of s.items) {
      if (it.presentation === 'full' || !it.file || !it.startLine || !it.endLine) continue;
      const est = (it.endLine - it.startLine + 1) * 9;
      labels.push({ kind: 'code', section: sec, presentation: it.presentation, cause: est > cap ? 'per-item-cap' : 'section-budget',
        roomLeft, visible: false, hiddenBy: shown(sec) ? 'format-no-code' : 'mode' });
    }
  }
  const imp = r.sections.impact;
  if (imp.shown < imp.total) {
    labels.push({ kind: 'list', section: 'impact', cause: imp.shown >= impactPathLimit(budgetOf('impact')) ? 'item-limit' : 'section-budget',
      roomLeft, visible: shown('impact'), hiddenBy: shown('impact') ? null : 'mode', shown: imp.shown, available: imp.total });
  }
  return labels;
}

async function main() {
  const SET = argValue('--set', 'dev');
  if (!PERMITTED_SETS.has(SET)) { process.stderr.write(`refusing --set ${SET}\n`); process.exit(2); }
  const OUT = argValue('--out', path.join(REPO_ROOT, 'eval/trace-truncation-classify/out', `report-${SET}.json`));
  const probes = loadProbes(DEFAULT_PROBE_FILES);
  const calls = new Map();
  let unparsable = 0;
  for (const row of dossierCalls(DEFAULT_DOSSIERS, 'ss-trace')) {
    const probe = probes.get(row.id);
    if (!probe || probe.set !== SET) continue;
    const p = parseTrace(row.args);
    if (!p) { unparsable++; continue; }
    const key = `${probe.repo}\0${row.args}`;
    if (!calls.has(key)) calls.set(key, { probe: row.id, repo: probe.repo, repoSha: probe.repoSha, args: row.args, ...p });
  }
  const all = [...calls.values()];
  const repos = [...new Set(all.map(c => c.repo))].sort();
  const provenance = {};
  const rows = [];
  for (const repo of repos) {
    const repoDir = path.join(DEFAULT_REPOS, repo);
    provenance[repo] = await verifyRepo(repoDir, new Set(all.filter(c => c.repo === repo).map(c => c.repoSha)));
    if (provenance[repo].problems.length && !process.argv.includes('--allow-mismatch')) {
      process.stderr.write(`refusing: ${repo}: ${provenance[repo].problems.join(' | ')}\n`);
      process.exit(3);
    }
    const { graphDbPath, cleanup } = graphCopy(repoDir);
    for (const c of all.filter(x => x.repo === repo)) {
      let r;
      let rOn;
      try {
        r = traceLikeTool(c, { projectRoot: repoDir, graphDbPath });
        rOn = c.mode ? traceLikeTool(c, { projectRoot: repoDir, graphDbPath, modeSection: c.mode }) : r;
      } catch (err) { rows.push({ args: c.args, error: String(err.message).slice(0, 200) }); continue; }
      if (!r.target) { rows.push({ args: c.args, target: false }); continue; }
      rows.push({ probe: c.probe, repo, args: c.args, mode: c.mode, target: true, tier: r.budgetTier,
        util: r.tokensUsed / r.tokenBudget, labels: classify(r, c),
        printedChars: formatTraceCompact(r, { mode: c.mode }).length,
        modeBudget: { labels: classify(rOn, c, { modeBudget: true }), printedChars: formatTraceCompact(rOn, { mode: c.mode }).length } });
    }
    cleanup();
  }

  const found = rows.filter(r => r.target);
  const labels = found.flatMap(r => r.labels.map(l => ({ ...l, args: r.args })));
  const tally = (xs, keyOf) => xs.reduce((m, x) => { const k = keyOf(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const targetsWith = f => new Set(found.filter(r => r.labels.some(f)).map(r => r.args)).size;
  const util = found.map(r => r.util).sort((a, b) => a - b);
  const summary = {
    set: SET,
    exploratory: SET === 'dev',
    uniqueCalls: all.length,
    unparsable,
    targets: found.length,
    budgetUseMedian: util[Math.floor(util.length / 2)],
    budgetUseP90: util[Math.floor(0.9 * (util.length - 1))],
    targetsWithShortenedList: {
      callersOrCallees: targetsWith(l => l.kind === 'list' && l.section !== 'impact'),
      impact: targetsWith(l => l.kind === 'list' && l.section === 'impact'),
      visibleToAgent: targetsWith(l => l.kind === 'list' && l.visible),
    },
    targetsWithNonFullCodeItem: targetsWith(l => l.kind === 'code'),
    listCuts: tally(labels.filter(l => l.kind === 'list'), l => `${l.section} ${l.cause}${l.roomLeft ? ' (total budget had room)' : ''} — ${l.visible ? 'VISIBLE' : `hidden by ${l.hiddenBy}`}`),
    codeCuts: tally(labels.filter(l => l.kind === 'code'), l => `${l.cause} — hidden by ${l.hiddenBy}`),
    visibleListCuts: labels.filter(l => l.kind === 'list' && l.visible).map(l => ({ args: l.args, section: l.section, cause: l.cause, shown: l.shown, available: l.available, roomLeft: l.roomLeft })),
  };
  // One factor varied: SS_FIX_TRACE_MODE_BUDGET (the mode word's section takes the budget).
  const modeCalls = found.filter(r => r.mode);
  const onLabels = modeCalls.flatMap(r => r.modeBudget.labels.map(l => ({ ...l, args: r.args })));
  const sumChars = (xs, f) => xs.reduce((n, r) => n + f(r), 0);
  summary.modeBudgetArm = {
    modeCalls: modeCalls.length,
    visibleListCutsOff: labels.filter(l => l.kind === 'list' && l.visible).length,
    visibleListCutsOn: onLabels.filter(l => l.kind === 'list' && l.visible).length,
    visibleListCutsOnDetail: onLabels.filter(l => l.kind === 'list' && l.visible).map(l => ({ args: l.args, section: l.section, cause: l.cause, shown: l.shown, available: l.available })),
    rowsGainedOnTheSixCuts: summary.visibleListCuts.map((v) => {
      const row = modeCalls.find(r => r.args === v.args);
      const sec = row?.modeBudget.labels.find(l => l.kind === 'list' && l.section === v.section);
      // no mode word: the switch does not apply
      if (!row) return { args: v.args, before: v.shown, after: v.shown, available: v.available, modeWord: false };
      return { args: v.args, before: v.shown, after: sec ? sec.shown : v.available, available: v.available, modeWord: true };
    }),
    printedCharsOnModeCalls: { off: sumChars(modeCalls, r => r.printedChars), on: sumChars(modeCalls, r => r.modeBudget.printedChars) },
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ summary, provenance, rows }, null, 2));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n-> ${OUT}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) await main();
