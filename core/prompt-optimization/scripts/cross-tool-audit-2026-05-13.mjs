#!/usr/bin/env node
/**
 * cross-tool-audit-2026-05-13.mjs — Stage-2 (PARTIAL text-contains) and
 * Stage-3 (FAIL → Recall@5) audit on existing ss-search and ss-find sweep
 * JSONLs. DEV-only inspection. No production code modified.
 *
 * Mirrors the ss-semantic Stage 0 methodology: distinguish "tool genuinely
 * missed" from "tool returned a useful chunk that the strict rubric marked
 * PARTIAL/FAIL because of a chunker label artifact (PARTIAL) or because the
 * right file is at rank 2-5 (FAIL)."
 *
 * Inputs (all read-only):
 *   - eval/ast-tester-probes/splits/manifest.json
 *   - eval/ast-tester-probes/_repos/<lang>/<file> (locked SHAs)
 *   - core/prompt-optimization/data/query-shapes/inputs/<lang>-<goldId>.json
 *   - core/prompt-optimization/data/query-shapes/tracks/track-a-phase6-redo-v1.jsonl
 *   - core/prompt-optimization/data/query-shapes/ss-find/tracks/track-a-phase6-redo-ss-find-v8.jsonl
 *
 * Winners (from recommendations-v2*.json):
 *   ss-search: default V7; family overrides JS-mobile→V2, C-family→V4
 *   ss-find:   default R2|Q3; family override JS-mobile→R3|Q4
 *
 * Output:
 *   core/prompt-optimization/data/query-shapes/cross-tool-audit-2026-05-13.json
 *   (plus stdout summary)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const SPLITS = path.join(REPO_ROOT, 'eval/ast-tester-probes/splits/manifest.json');
const REPOS_MANIFEST = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const SS_SEARCH_JSONL = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/tracks/track-a-phase6-redo-v1.jsonl');
const SS_FIND_JSONL = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/tracks/track-a-phase6-redo-ss-find-v8.jsonl');
const OUT = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/cross-tool-audit-2026-05-13.json');

const SS_SEARCH_WINNERS = {
  default: 'V7',
  byFamily: { 'JS-mobile': 'V2', 'C-family': 'V4' },
};
const SS_FIND_WINNERS = {
  default: { rCell: 'R2', qCell: 'Q3' },
  byFamily: { 'JS-mobile': { rCell: 'R3', qCell: 'Q4' } },
};

function loadDevGolds() {
  const m = JSON.parse(fs.readFileSync(SPLITS, 'utf8'));
  const dev = new Set();
  for (const [, sp] of Object.entries(m.perLanguage || {})) {
    for (const id of sp.dev || []) dev.add(id);
  }
  return dev;
}

function loadReposManifest() {
  const m = JSON.parse(fs.readFileSync(REPOS_MANIFEST, 'utf8'));
  const map = new Map();
  for (const e of m.repos || []) map.set(e.key || e.language, e);
  return map;
}

function loadAllInputs() {
  const out = new Map();
  for (const n of fs.readdirSync(INPUTS_DIR)) {
    if (!n.endsWith('.json')) continue;
    const obj = JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, n), 'utf8'));
    if (obj.goldId) out.set(obj.goldId, obj);
  }
  return out;
}

function readJsonl(p) {
  const out = [];
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

/** Read file lines [startLine..endLine] (1-based, inclusive). Returns the joined text or null. */
function readFileRange(absFile, startLine, endLine) {
  if (!absFile || startLine == null || endLine == null) return null;
  try {
    const txt = fs.readFileSync(absFile, 'utf8');
    const lines = txt.split('\n');
    const s = Math.max(0, Number(startLine) - 1);
    const e = Math.min(lines.length, Number(endLine));
    return lines.slice(s, e).join('\n');
  } catch { return null; }
}

function resolveLangProjectRoot(reposMap, language) {
  const entry = reposMap.get(language);
  if (!entry) return null;
  return path.join(REPO_ROOT, entry.localPath);
}

function symbolInText(text, sym) {
  if (!text || !sym) return false;
  // verbatim substring (case-sensitive) — same convention as audit handoff
  return text.includes(sym);
}

function symbolInTextWordBoundary(text, sym) {
  if (!text || !sym) return false;
  const re = new RegExp(`\\b${sym.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`);
  return re.test(text);
}

function pickSsSearchRow(rows, family) {
  const wantShape = SS_SEARCH_WINNERS.byFamily[family] || SS_SEARCH_WINNERS.default;
  return rows.find(r => r.shape === wantShape) || null;
}

function pickSsFindRow(rows, family) {
  const want = SS_FIND_WINNERS.byFamily[family] || SS_FIND_WINNERS.default;
  return rows.find(r => r.rCell === want.rCell && r.qCell === want.qCell) || null;
}

function auditTool(label, jsonlPath, pickFn, devGolds, inputs, reposMap) {
  const allRows = readJsonl(jsonlPath);
  // Group rows by goldId for fast per-gold pick
  const byGold = new Map();
  for (const r of allRows) {
    if (!byGold.has(r.goldId)) byGold.set(r.goldId, []);
    byGold.get(r.goldId).push(r);
  }

  const stats = {
    label,
    jsonl: path.relative(REPO_ROOT, jsonlPath),
    devGoldCount: 0,
    pass: 0, partial: 0, fail: 0,
    partialAudits: [],
    failAudits: [],
    partialContainsSymbol: 0,
    partialMissingSymbol: 0,
    failRecallAt5Hits: 0,
    failRecallAt5Misses: 0,
    failNoTop1: 0,
    skipped: [],
  };

  for (const goldId of devGolds) {
    const input = inputs.get(goldId);
    if (!input) continue;
    if (label === 'ss-find' && input.goldClass !== 'ast-tester') continue; // ss-find skips doc-positive

    const rows = byGold.get(goldId) || [];
    const row = pickFn(rows, input.family);
    if (!row) { stats.skipped.push({ goldId, reason: 'no_matching_shape_row' }); continue; }
    stats.devGoldCount++;
    if (row.verdict === 'PASS') stats.pass++;
    else if (row.verdict === 'PARTIAL') stats.partial++;
    else if (row.verdict === 'FAIL') stats.fail++;

    if (row.verdict === 'PARTIAL') {
      const projectRoot = resolveLangProjectRoot(reposMap, input.language);
      const top1 = row.top1 || {};
      const absFile = projectRoot && top1.file
        ? path.join(projectRoot, top1.file) : null;
      const chunkText = absFile ? readFileRange(absFile, top1.startLine, top1.endLine) : null;
      const expectedSyms = input.expectedSymbolAnyOf?.length
        ? input.expectedSymbolAnyOf
        : (input.expectedSymbol ? [input.expectedSymbol] : []);
      const symMatch_substr = expectedSyms.some(s => symbolInText(chunkText, s));
      const symMatch_word = expectedSyms.some(s => symbolInTextWordBoundary(chunkText, s));
      const audit = {
        goldId, language: input.language, family: input.family,
        shape: label === 'ss-search' ? row.shape : `${row.rCell}|${row.qCell}`,
        expectedSymbol: input.expectedSymbol,
        expectedSymbolAnyOf: input.expectedSymbolAnyOf,
        top1: {
          file: top1.file, symbol: top1.symbol,
          startLine: top1.startLine, endLine: top1.endLine, score: top1.score,
        },
        chunkLines: chunkText ? chunkText.split('\n').length : 0,
        containsSymbol_substring: symMatch_substr,
        containsSymbol_wordBoundary: symMatch_word,
        readFailed: chunkText == null,
      };
      stats.partialAudits.push(audit);
      if (symMatch_word) stats.partialContainsSymbol++;
      else stats.partialMissingSymbol++;
    }

    if (row.verdict === 'FAIL') {
      const audit = {
        goldId, language: input.language, family: input.family,
        shape: label === 'ss-search' ? row.shape : `${row.rCell}|${row.qCell}`,
        fileRecallAt1: row.fileRecallAt1,
        fileRecallAt5: row.fileRecallAt5,
        top1File: row.top1?.file || null,
        expectedFile: input.expectedFile,
        expectedFileAnyOf: input.expectedFileAnyOf,
      };
      stats.failAudits.push(audit);
      if (row.top1 == null) stats.failNoTop1++;
      else if (row.fileRecallAt5) stats.failRecallAt5Hits++;
      else stats.failRecallAt5Misses++;
    }
  }
  return stats;
}

function summarize(stats) {
  const tot = stats.devGoldCount || 1;
  const partTotal = stats.partial || 1;
  const failTotal = stats.fail || 1;
  return {
    label: stats.label,
    jsonl: stats.jsonl,
    devGolds: stats.devGoldCount,
    verdicts: {
      PASS: stats.pass, PARTIAL: stats.partial, FAIL: stats.fail,
      passPct: +(stats.pass / tot * 100).toFixed(1),
      partialPct: +(stats.partial / tot * 100).toFixed(1),
      failPct: +(stats.fail / tot * 100).toFixed(1),
    },
    partialAudit: {
      total: stats.partial,
      containsSymbolVerbatim: stats.partialContainsSymbol,
      missingSymbolVerbatim: stats.partialMissingSymbol,
      hiddenPassPctOfPartial: +(stats.partialContainsSymbol / partTotal * 100).toFixed(1),
      hiddenPassPctOfAllDev: +(stats.partialContainsSymbol / tot * 100).toFixed(1),
    },
    failAudit: {
      total: stats.fail,
      recallAt5Hits: stats.failRecallAt5Hits,
      recallAt5Misses: stats.failRecallAt5Misses,
      noTop1: stats.failNoTop1,
      hiddenRecallAt5PctOfFail: +(stats.failRecallAt5Hits / failTotal * 100).toFixed(1),
      hiddenRecallAt5PctOfAllDev: +(stats.failRecallAt5Hits / tot * 100).toFixed(1),
    },
    relaxed_metrics: {
      // Relaxed PASS = strict PASS + PARTIAL-with-symbol-in-chunk
      relaxedPass: stats.pass + stats.partialContainsSymbol,
      relaxedPassPctOfAllDev: +((stats.pass + stats.partialContainsSymbol) / tot * 100).toFixed(1),
      // file recall at 5 (fileRecallAt5==1 means at least one of top-5 was the expected file)
      // Counting on FAILs only: FAILs are file-misses at rank 1; if fileRecallAt5=1, file is at rank 2-5.
      recallAt5_added: stats.failRecallAt5Hits,
    },
    skipped: stats.skipped,
  };
}

function main() {
  const devGolds = loadDevGolds();
  const inputs = loadAllInputs();
  const reposMap = loadReposManifest();

  const ssSearch = auditTool('ss-search', SS_SEARCH_JSONL, pickSsSearchRow, devGolds, inputs, reposMap);
  const ssFind = auditTool('ss-find', SS_FIND_JSONL, pickSsFindRow, devGolds, inputs, reposMap);

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    methodology: 'DEV-only; PARTIAL→word-boundary symbol in chunk text; FAIL→fileRecallAt5 hits',
    note_top1_ordering: 'Stage 1 verified: both tools score-order top-1; ss-semantic Fix 1A landmine does not apply here.',
    winners: { ssSearch: SS_SEARCH_WINNERS, ssFind: SS_FIND_WINNERS },
    ssSearch: summarize(ssSearch),
    ssFind: summarize(ssFind),
    raw: { ssSearch, ssFind },
  };

  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  process.stdout.write(`\nWrote ${path.relative(REPO_ROOT, OUT)}\n\n`);
  for (const tool of [summary.ssSearch, summary.ssFind]) {
    process.stdout.write(`=== ${tool.label} (${tool.jsonl}) ===\n`);
    process.stdout.write(`  dev golds graded: ${tool.devGolds}\n`);
    process.stdout.write(`  verdicts: PASS=${tool.verdicts.PASS} PARTIAL=${tool.verdicts.PARTIAL} FAIL=${tool.verdicts.FAIL}\n`);
    process.stdout.write(`  PARTIAL audit: ${tool.partialAudit.containsSymbolVerbatim}/${tool.partialAudit.total} have expectedSymbol verbatim in chunk → ${tool.partialAudit.hiddenPassPctOfPartial}% of PARTIALs are hidden PASSes\n`);
    process.stdout.write(`  FAIL audit: ${tool.failAudit.recallAt5Hits}/${tool.failAudit.total} have expected file in top-5 → ${tool.failAudit.hiddenRecallAt5PctOfFail}% of FAILs would PASS under file-recall@5\n`);
    process.stdout.write(`  relaxed PASS (strict PASS + PARTIAL-with-symbol-in-chunk): ${tool.relaxed_metrics.relaxedPass}/${tool.devGolds} = ${tool.relaxed_metrics.relaxedPassPctOfAllDev}%\n`);
    if (tool.skipped.length) process.stdout.write(`  skipped: ${tool.skipped.length}\n`);
    process.stdout.write('\n');
  }
}

main();
