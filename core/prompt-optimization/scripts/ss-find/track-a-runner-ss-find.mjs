#!/usr/bin/env node
/**
 * track-a-runner-ss-find.mjs — deterministic per-(gold, R, Q) sweep for the
 * PHASE6_REDO ss-find tool (PHASE6_REDO §12.1, refined 2026-05-13).
 *
 * For each AST-tester gold:
 *   - build the 7 deterministic R-cells via r-templates.mjs
 *   - load the 7 LLM-authored Q-cells from variants/
 *   - run 49 (R, Q) combinations + 1 baseline (R2 + gold.query) through
 *     `searcher.patternSearch(query, routing, { regex, format:'agent', k:5 })`
 *   - grade against the gold (PASS / PARTIAL / FAIL) and emit a JSONL row
 *
 * Doc-positive golds are SKIPPED — ss-find isn't designed for license/README
 * retrieval (no clean code-symbol regex anchor available).
 *
 * Output: core/prompt-optimization/data/query-shapes/ss-find/tracks/track-a-<runId>.jsonl
 *
 * Usage:
 *   node track-a-runner-ss-find.mjs                        # full sweep
 *   node track-a-runner-ss-find.mjs --lang=rust            # one language
 *   node track-a-runner-ss-find.mjs --id=RS-001            # one gold
 *   node track-a-runner-ss-find.mjs --r-cell=R3 --q-cell=Q4 # one (R,Q) combo
 *   node track-a-runner-ss-find.mjs --run-id=<id>          # override run id
 *   node track-a-runner-ss-find.mjs --skip-baseline        # candidates only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SweetSearch } from '../../../search/sweet-search.js';
import { buildAllRegexCells, R_CELLS, R_LABELS } from './r-templates.mjs';
import { Q_CELLS, Q_LABELS } from './author-variants-ss-find.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/variants');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-find/tracks');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

const BASELINE_CELL = 'R2_baseline';
const BASELINE_LABEL = 'baseline (R2-narrow + gold.query)';

function parseArgs(argv) {
  const out = {
    lang: null, id: null, rCell: null, qCell: null, runId: null,
    includeBaseline: true, dryRun: false, verbose: false, logPath: undefined,
  };
  for (const arg of argv) {
    if (arg.startsWith('--lang=')) out.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--id=')) out.id = arg.slice('--id='.length);
    else if (arg.startsWith('--r-cell=')) out.rCell = arg.slice('--r-cell='.length);
    else if (arg.startsWith('--q-cell=')) out.qCell = arg.slice('--q-cell='.length);
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--log=')) out.logPath = arg.slice('--log='.length);
    else if (arg === '--no-log') out.logPath = null;
    else if (arg === '--skip-baseline') out.includeBaseline = false;
    else if (arg === '--include-baseline') out.includeBaseline = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: track-a-runner-ss-find.mjs [--lang=...] [--id=...] [--r-cell=R1..R7] [--q-cell=Q1..Q7] [--run-id=...] [--skip-baseline] [--dry-run] [--verbose] [--log=<path>|--no-log]\n');
      process.exit(0);
    } else {
      process.stderr.write(`track-a-runner-ss-find: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function attachStdoutLogger(logPath) {
  if (!logPath) return null;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n=== track-a-runner-ss-find run @ ${new Date().toISOString()} (pid ${process.pid}) ===\n`);
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : chunk.toString()); } catch { /* ignore */ }
    return orig(chunk, ...rest);
  };
  return fd;
}

function loadReposManifest() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const map = new Map();
  for (const entry of raw.repos || []) map.set(entry.key || entry.language, entry);
  return map;
}

function loadAllInputs() {
  if (!fs.existsSync(INPUTS_DIR)) return [];
  return fs.readdirSync(INPUTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, n), 'utf8')));
}

function loadQVariants(input) {
  const out = {};
  for (const cell of Q_CELLS) {
    const p = path.join(VARIANTS_DIR, `${input.language}-${input.goldId}-${cell}.json`);
    if (!fs.existsSync(p)) continue;
    out[cell] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return out;
}

/**
 * The LI indexes for the ast-tester-probes repos were built without saving
 * per-doc metadata (file / startLine / endLine), which `patternSearch`
 * requires to map ripgrep matches back to chunk IDs. The doc IDs themselves
 * encode `<file>:<startLine>-<endLine>:<chunkIdx>`, so we can rebuild the
 * chunk-location map from IDs and pre-cache it on the searcher BEFORE the
 * sweep — bypasses the "Pattern search requires a late interaction index
 * with line spans" guard without re-indexing all 18 repos.
 *
 * Workaround pinned 2026-05-13 after the rust smoke-test surfaced 100%
 * patternSearch errors. Long-term fix: rebuild LI indexes with metadata
 * persisted (each repo's index needs ~10-85 min — out of scope here).
 */
const ID_RE = /^(.+):(\d+)-(\d+):(\d+)$/;
export async function ensurePatternSearchLocationMap(searcher) {
  if (!searcher?.lateInteractionIndex) return;
  await searcher.lateInteractionIndex.init();
  const docs = searcher.lateInteractionIndex.documents;
  if (!docs || docs.size === 0) return;
  // If any doc already has metadata.file populated, the standard path works.
  let hasMeta = false;
  for (const d of docs.values()) {
    if (d.metadata?.file) hasMeta = true;
    break;
  }
  if (hasMeta) return;

  // Two patches are needed: (1) the chunk-location MAP that the
  // patternSearch guard checks, (2) the per-doc `metadata.file/startLine/
  // endLine` that the agent-format result packager reads when building
  // the top-1 chunk record. Without (2), patternSearch runs but every
  // result has file="" and falls back to "file_read_failed".
  const map = new Map();
  for (const [id, doc] of docs) {
    const m = ID_RE.exec(id);
    if (!m) continue;
    const [, file, startLineStr, endLineStr] = m;
    const startLine = Number(startLineStr);
    const endLine = Number(endLineStr);

    // Patch (1): location map.
    let bucket = map.get(file);
    if (!bucket) { bucket = []; map.set(file, bucket); }
    bucket.push({ startLine, endLine, id, type: null, name: null });

    // Patch (2): per-doc metadata.
    if (!doc.metadata) doc.metadata = {};
    if (!doc.metadata.file) doc.metadata.file = file;
    if (doc.metadata.startLine == null) doc.metadata.startLine = startLine;
    if (doc.metadata.endLine == null) doc.metadata.endLine = endLine;
  }
  for (const bucket of map.values()) bucket.sort((a, b) => a.startLine - b.startLine);
  searcher._chunkLocationMap = map;
  searcher._chunkLocationMapSize = docs.size;
}

/**
 * Grade ss-find's top-1 result against the gold. Same rubric as
 * track-a-runner.mjs (ss-search): file match (or AnyOf), then optional
 * symbol match. ss-find golds are AST-tester only — no doc-positive.
 */
export function gradeResult(input, results) {
  const top = results?.[0] ?? null;
  if (!top) {
    return {
      verdict: 'FAIL', reason: 'no top-1', fileRecallAt1: 0, fileRecallAt5: 0,
      symbolRecallAt1: 0, top1: null, scoreMargin: null,
    };
  }
  const expectedFiles = input.expectedFileAnyOf?.length ? input.expectedFileAnyOf : [input.expectedFile];
  const topFile = top.file || top.metadata?.file || null;
  const fileMatch = expectedFiles.includes(topFile);
  const topSymbol = top.symbol || top.name || top.metadata?.symbol || null;
  const expectedSymbols = input.expectedSymbolAnyOf?.length
    ? input.expectedSymbolAnyOf
    : (input.expectedSymbol ? [input.expectedSymbol] : []);
  const symMatch = expectedSymbols.length === 0 || expectedSymbols.includes(topSymbol);

  const fileRecallAt5 = results.slice(0, 5)
    .some((r) => expectedFiles.includes(r.file || r.metadata?.file)) ? 1 : 0;
  const fileRecallAt1 = fileMatch ? 1 : 0;
  const symbolRecallAt1 = fileMatch && symMatch ? 1 : 0;
  let verdict;
  if (fileMatch && symMatch) verdict = 'PASS';
  else if (fileMatch) verdict = 'PARTIAL';
  else verdict = 'FAIL';
  const top2 = results?.[1] ?? null;
  const scoreMargin = top2 ? Number(top.score ?? 0) - Number(top2.score ?? 0) : null;
  return {
    verdict,
    reason: verdict === 'PASS' ? 'match' : (!fileMatch ? 'file_mismatch' : 'symbol_mismatch'),
    fileRecallAt1, fileRecallAt5, symbolRecallAt1,
    top1: {
      file: topFile,
      symbol: topSymbol,
      startLine: top.startLine ?? top.metadata?.line_start ?? null,
      endLine: top.endLine ?? top.metadata?.line_end ?? null,
      score: top.score ?? null,
      presentation: top.presentation || top.metadata?.presentation || null,
    },
    scoreMargin,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const defaultLog = path.join(TRACKS_DIR, '_progress.log');
  const logPath = opts.logPath === undefined ? defaultLog : opts.logPath;
  if (logPath) fs.mkdirSync(path.dirname(logPath), { recursive: true });
  attachStdoutLogger(logPath);
  if (logPath) process.stdout.write(`track-a-runner-ss-find: mirroring stdout to ${path.relative(REPO_ROOT, logPath)} (tail -f to watch)\n`);

  const reposMap = loadReposManifest();
  const inputs = loadAllInputs().filter((i) => i.goldClass === 'ast-tester');
  if (inputs.length === 0) {
    process.stderr.write('track-a-runner-ss-find: no ast-tester inputs (run preprocess.mjs first)\n');
    process.exit(2);
  }

  const runId = opts.runId || `phase6-redo-ss-find-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  const trackPath = path.join(TRACKS_DIR, `track-a-${runId}.jsonl`);

  const filteredInputs = inputs.filter((i) =>
    (!opts.lang || i.language === opts.lang) && (!opts.id || i.goldId === opts.id));
  const byLang = new Map();
  for (const i of filteredInputs) {
    if (!byLang.has(i.language)) byLang.set(i.language, []);
    byLang.get(i.language).push(i);
  }

  // Estimate the sweep size for progress reporting.
  const rCells = opts.rCell ? [opts.rCell] : R_CELLS;
  const qCells = opts.qCell ? [opts.qCell] : Q_CELLS;
  const perGoldRuns = rCells.length * qCells.length + (opts.includeBaseline && !opts.rCell && !opts.qCell ? 1 : 0);
  const plannedRuns = filteredInputs.length * perGoldRuns;
  process.stdout.write(`track-a-runner-ss-find: runId=${runId}\n  ${filteredInputs.length} golds × ${perGoldRuns} (${rCells.length}R × ${qCells.length}Q${opts.includeBaseline ? ' + baseline' : ''}) = ${plannedRuns} planned runs\n`);

  if (opts.dryRun) {
    process.stdout.write(`(dry-run) would write to: ${path.relative(REPO_ROOT, trackPath)}\n`);
    process.exit(0);
  }

  const out = fs.createWriteStream(trackPath, { flags: 'w' });
  let totalRuns = 0, totalPass = 0, totalPartial = 0, totalFail = 0, totalErrors = 0;
  const start = Date.now();

  function fmtDur(ms) { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; }
  function emitProgress() {
    const wall = Date.now() - start;
    const pct = plannedRuns > 0 ? (totalRuns / plannedRuns) * 100 : 0;
    const rate = totalRuns > 0 ? wall / totalRuns : 0;
    const eta = (totalRuns > 0 && totalRuns < plannedRuns) ? rate * (plannedRuns - totalRuns) : 0;
    process.stdout.write(
      `  [progress] ${String(totalRuns).padStart(5)}/${plannedRuns} (${pct.toFixed(1).padStart(5)}%) ` +
        `PASS=${String(totalPass).padStart(4)} PART=${String(totalPartial).padStart(4)} FAIL=${String(totalFail).padStart(4)} ` +
        `err=${String(totalErrors).padStart(3)} wall=${fmtDur(wall).padStart(6)} eta=${eta > 0 ? fmtDur(eta).padStart(6) : '    --'}\n`,
    );
  }
  const progressTimer = setInterval(emitProgress, 10_000);

  for (const [language, langInputs] of byLang.entries()) {
    const repoEntry = reposMap.get(language);
    if (!repoEntry) {
      process.stderr.write(`  ! no repos.json entry for ${language}; skipping\n`);
      continue;
    }
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    const dataDir = path.join(projectRoot, '.sweet-search');
    if (!fs.existsSync(dataDir)) {
      process.stderr.write(`  ! .sweet-search missing for ${language} (${dataDir}); skipping\n`);
      continue;
    }
    const searcher = new SweetSearch({
      projectRoot,
      graphDbPath: path.join(dataDir, 'code-graph.db'),
      codebaseDbPath: path.join(dataDir, 'codebase.db'),
      hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
      binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
      sparseGramIndexPath: path.join(dataDir, 'codebase-sparse-grams.idx'),
      lateInteractionOptions: {
        indexPath: path.join(dataDir, 'codebase-late-interaction.db'),
      },
    });
    await searcher.init();
    // Pre-cache chunk-location map from doc IDs (workaround for empty LI metadata
    // in the ast-tester-probes indexes — see ensurePatternSearchLocationMap header).
    await ensurePatternSearchLocationMap(searcher);
    process.stdout.write(`\n=== ${language} (${langInputs.length} golds) ===\n`);

    for (const input of langInputs) {
      const rCellsBuilt = buildAllRegexCells(input);
      const qVariants = loadQVariants(input);

      // Build the run list: optional baseline + cartesian (R, Q) cells.
      const runs = [];
      if (opts.includeBaseline && !opts.rCell && !opts.qCell) {
        const baselineRegex = rCellsBuilt.R2; // canonical narrow word-bounded
        if (baselineRegex) {
          runs.push({
            rCell: BASELINE_CELL, qCell: BASELINE_CELL,
            shapeLabel: BASELINE_LABEL,
            regex: baselineRegex, query: input.goldQuery,
          });
        }
      }
      for (const rc of rCells) {
        const regex = rCellsBuilt[rc];
        if (!regex) continue;
        for (const qc of qCells) {
          const qVar = qVariants[qc];
          if (!qVar) continue;
          runs.push({
            rCell: rc, qCell: qc,
            shapeLabel: `${R_LABELS[rc]} | ${Q_LABELS[qc]}`,
            regex, query: qVar.query,
          });
        }
      }

      for (const run of runs) {
        const tStart = Date.now();
        let results = [];
        let error = null;
        try {
          // patternSearch: query string + routing (unused) + options w/ regex.
          const resp = await searcher.patternSearch(run.query, {}, {
            regex: run.regex, format: 'agent', k: 5,
          });
          results = resp?.results || [];
        } catch (err) {
          error = err.message;
          totalErrors++;
        }
        const graded = gradeResult(input, results);
        const wallMs = Date.now() - tStart;
        const row = {
          runId, goldId: input.goldId, language: input.language, family: input.family,
          goldClass: input.goldClass,
          rCell: run.rCell, qCell: run.qCell,
          shapeLabel: run.shapeLabel,
          regex: run.regex, query: run.query,
          verdict: graded.verdict, reason: graded.reason,
          fileRecallAt1: graded.fileRecallAt1, fileRecallAt5: graded.fileRecallAt5,
          symbolRecallAt1: graded.symbolRecallAt1,
          top1: graded.top1, scoreMargin: graded.scoreMargin,
          wallMs, error,
        };
        out.write(JSON.stringify(row) + '\n');
        totalRuns++;
        if (graded.verdict === 'PASS') totalPass++;
        else if (graded.verdict === 'PARTIAL') totalPartial++;
        else totalFail++;
        if (opts.verbose) {
          const tag = graded.verdict === 'PASS' ? '✓' : (graded.verdict === 'PARTIAL' ? '~' : '✗');
          process.stdout.write(`  ${tag} ${input.goldId} ${run.rCell}×${run.qCell} ${graded.verdict.padEnd(7)} ${wallMs}ms\n`);
        }
        if (totalRuns % 100 === 0) emitProgress();
      }
    }
    try { searcher.close(); } catch { /* ignore */ }
  }
  clearInterval(progressTimer);
  emitProgress();
  await new Promise((resolve) => out.end(resolve));
  const wallSec = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(
    `\ntrack-a-runner-ss-find: ${totalRuns} rows written; PASS=${totalPass} PARTIAL=${totalPartial} FAIL=${totalFail} errors=${totalErrors} wall=${wallSec}s\n` +
      `  output: ${path.relative(REPO_ROOT, trackPath)}\n`,
  );
}

const isMainModule = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => { process.stderr.write(`track-a-runner-ss-find: fatal ${err.stack || err.message}\n`); process.exit(1); });
}
