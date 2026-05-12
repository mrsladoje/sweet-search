#!/usr/bin/env node
/**
 * track-a-runner.mjs — deterministic per-(language, gold, shape) sweep for
 * the PHASE6_REDO `ss-search` query-shape discovery (docs/PHASE6_REDO.md
 * §6.1 + §5.5.1).
 *
 * For each variant in variants/<lang>-<gold>-<shape>.json:
 *   - instantiate SweetSearch against the per-language .sweet-search index
 *   - run searcher.search(query, { format:'agent', k:5, graphExpand:'2hop',
 *                                  adaptiveHop2:true }) — matches
 *     eval/retrieval-probes/run-probes.mjs:140-145
 *   - grade against the gold (PASS / PARTIAL / FAIL; file-only grading for
 *     doc-positive golds whose expectedSymbol is null/non-code)
 *   - emit one JSONL row to tracks/track-a-<runId>.jsonl
 *
 * Also emits a baseline row per gold using the gold's original `query`
 * (the AST-tester probe phrasing) — this is the V_baseline pin per §5.5.8.
 *
 * Usage:
 *   node track-a-runner.mjs                      # full sweep
 *   node track-a-runner.mjs --lang=rust          # one language
 *   node track-a-runner.mjs --id=RS-001          # one gold
 *   node track-a-runner.mjs --shape=V2           # one shape
 *   node track-a-runner.mjs --run-id=my-run      # override the run id
 *   node track-a-runner.mjs --include-baseline   # ALSO score gold.query (default: yes)
 *   node track-a-runner.mjs --skip-baseline      # only candidate shapes
 *   node track-a-runner.mjs --dry-run            # plan only, no SweetSearch call
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SweetSearch } from '../../search/sweet-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/tracks');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

const BASELINE_SHAPE = 'V_baseline';

/**
 * Mirror process.stdout to a log file so backgrounded / piped runs are
 * tail-followable from another terminal. Same pattern as
 * author-variants.mjs:attachStdoutLogger. Each write is fs.writeSync'd
 * immediately so `tail -f` sees data live, not at process exit.
 */
function attachStdoutLogger(logPath) {
  if (!logPath) return null;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n=== track-a-runner run @ ${new Date().toISOString()} (pid ${process.pid}) ===\n`);
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : chunk.toString()); } catch { /* ignore */ }
    return origWrite(chunk, ...rest);
  };
  return fd;
}

function parseArgs(argv) {
  const out = {
    lang: null, id: null, shape: null, runId: null,
    includeBaseline: true, dryRun: false, verbose: false, logPath: undefined,
  };
  for (const arg of argv) {
    if (arg.startsWith('--lang=')) out.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--id=')) out.id = arg.slice('--id='.length);
    else if (arg.startsWith('--shape=')) out.shape = arg.slice('--shape='.length);
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--log=')) out.logPath = arg.slice('--log='.length);
    else if (arg === '--no-log') out.logPath = null;
    else if (arg === '--include-baseline') out.includeBaseline = true;
    else if (arg === '--skip-baseline') out.includeBaseline = false;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: track-a-runner.mjs [--lang=...] [--id=...] [--shape=V1..V7] [--run-id=...] [--skip-baseline] [--dry-run] [--verbose] [--log=<path>|--no-log]\n');
      process.exit(0);
    } else {
      process.stderr.write(`track-a-runner: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function loadReposManifest() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const map = new Map();
  for (const entry of raw.repos || []) map.set(entry.key || entry.language, entry);
  return map;
}

function loadInput(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Grade a single top-N result list against a gold record.
 * Returns:
 *   {
 *     verdict:        'PASS' | 'PARTIAL' | 'FAIL',
 *     reason:         string,
 *     fileRecallAt1:  0 | 1,
 *     fileRecallAt5:  0 | 1,
 *     symbolRecallAt1:0 | 1,
 *     top1: { file, symbol, ... } | null,
 *     scoreMargin:    number | null,    // top1.score - top2.score
 *   }
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
  // Symbol match: vacuous when no expected symbol; otherwise match against
  // expectedSymbolAnyOf (preferred) or expectedSymbol singular.
  const expectedSymbols = input.expectedSymbolAnyOf?.length
    ? input.expectedSymbolAnyOf
    : (input.expectedSymbol ? [input.expectedSymbol] : []);
  const symMatch = expectedSymbols.length === 0 || expectedSymbols.includes(topSymbol);

  const fileRecallAt5 = results
    .slice(0, 5)
    .some((r) => expectedFiles.includes(r.file || r.metadata?.file)) ? 1 : 0;
  const fileRecallAt1 = fileMatch ? 1 : 0;
  const symbolRecallAt1 = fileMatch && symMatch ? 1 : 0;

  let verdict;
  if (input.goldClass === 'doc-positive') {
    // Doc-positive: file-only grading (the gold often has no expectedSymbol).
    verdict = fileMatch ? 'PASS' : 'FAIL';
  } else {
    if (fileMatch && symMatch) verdict = 'PASS';
    else if (fileMatch) verdict = 'PARTIAL';
    else verdict = 'FAIL';
  }
  const top2 = results?.[1] ?? null;
  const scoreMargin = top2 ? (Number(top.score ?? 0) - Number(top2.score ?? 0)) : null;
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

function loadAllInputs() {
  if (!fs.existsSync(INPUTS_DIR)) return [];
  return fs.readdirSync(INPUTS_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => loadInput(path.join(INPUTS_DIR, n)));
}

function loadVariantsForGold(input) {
  if (!fs.existsSync(VARIANTS_DIR)) return [];
  const out = [];
  for (const shape of input.eligibleShapes) {
    const variantPath = path.join(VARIANTS_DIR, `${input.language}-${input.goldId}-${shape}.json`);
    if (fs.existsSync(variantPath)) {
      out.push(JSON.parse(fs.readFileSync(variantPath, 'utf8')));
    }
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Log mirror — defaults to tracks/_progress.log; tail -f to watch.
  const defaultLog = path.join(TRACKS_DIR, '_progress.log');
  const logPath = opts.logPath === undefined ? defaultLog : opts.logPath;
  if (logPath) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  }
  attachStdoutLogger(logPath);
  if (logPath) {
    process.stdout.write(`track-a-runner: mirroring stdout to ${path.relative(REPO_ROOT, logPath)} (tail -f to watch)\n`);
  }

  const reposMap = loadReposManifest();
  const inputs = loadAllInputs();
  if (inputs.length === 0) {
    process.stderr.write('track-a-runner: no inputs (run preprocess.mjs first)\n');
    process.exit(2);
  }

  const runId = opts.runId || `phase6-redo-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  const trackPath = path.join(TRACKS_DIR, `track-a-${runId}.jsonl`);

  // Group by language so we only open one SweetSearch instance per language.
  const filteredInputs = inputs.filter((i) =>
    (!opts.lang || i.language === opts.lang) &&
    (!opts.id || i.goldId === opts.id),
  );
  const byLang = new Map();
  for (const i of filteredInputs) {
    const key = i.language;
    if (!byLang.has(key)) byLang.set(key, []);
    byLang.get(key).push(i);
  }

  process.stdout.write(`track-a-runner: runId=${runId}\n  ${filteredInputs.length} golds across ${byLang.size} language(s)\n`);

  if (opts.dryRun) {
    process.stdout.write(`(dry-run) would write to: ${path.relative(REPO_ROOT, trackPath)}\n`);
    process.exit(0);
  }

  const out = fs.createWriteStream(trackPath, { flags: 'w' });
  let totalRuns = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalPartial = 0;
  const start = Date.now();

  // Estimate total run count so the periodic progress line can show a %.
  // Each gold contributes baseline + |eligibleShapes| filtered by --shape.
  let plannedRuns = 0;
  for (const i of filteredInputs) {
    const shapes = i.eligibleShapes.filter((s) => !opts.shape || s === opts.shape);
    plannedRuns += shapes.length;
    if (opts.includeBaseline && (!opts.shape || opts.shape === BASELINE_SHAPE)) plannedRuns++;
  }

  function fmtDur(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  }
  function emitProgress() {
    const wall = Date.now() - start;
    const pct = plannedRuns > 0 ? (totalRuns / plannedRuns) * 100 : 0;
    const rate = totalRuns > 0 ? wall / totalRuns : 0;
    const eta = (totalRuns > 0 && totalRuns < plannedRuns) ? rate * (plannedRuns - totalRuns) : 0;
    process.stdout.write(
      `  [progress] ${String(totalRuns).padStart(4)}/${plannedRuns} (${pct.toFixed(1).padStart(5)}%) ` +
        `PASS=${String(totalPass).padStart(4)} PART=${String(totalPartial).padStart(3)} FAIL=${String(totalFail).padStart(3)} ` +
        `wall=${fmtDur(wall).padStart(6)} eta=${eta > 0 ? fmtDur(eta).padStart(6) : '    --'}\n`,
    );
  }
  const progressTimer = setInterval(emitProgress, 10_000);

  for (const [language, langInputs] of byLang.entries()) {
    // language is the probe-pack key; the repo's localPath is the project root.
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
    process.stdout.write(`\n=== ${language} (${langInputs.length} golds) ===\n`);
    for (const input of langInputs) {
      const variants = loadVariantsForGold(input);
      const todoShapes = variants.filter((v) => !opts.shape || v.shape === opts.shape);
      // Baseline first (V_baseline = gold's original query, per §5.5.8)
      const queries = [];
      if (opts.includeBaseline && (!opts.shape || opts.shape === BASELINE_SHAPE)) {
        queries.push({
          shape: BASELINE_SHAPE,
          shapeLabel: 'baseline (gold-original probe phrasing)',
          query: input.goldQuery,
          outputSha256: null,
        });
      }
      for (const v of todoShapes) {
        queries.push({
          shape: v.shape, shapeLabel: v.shapeLabel,
          query: v.query, outputSha256: v.outputSha256 ?? null,
        });
      }
      for (const q of queries) {
        const tStart = Date.now();
        let results = [];
        let error = null;
        try {
          const resp = await searcher.search(q.query, {
            format: 'agent', k: 5, graphExpand: '2hop', adaptiveHop2: true,
          });
          results = resp?.results || [];
        } catch (err) {
          error = err.message;
        }
        const graded = gradeResult(input, results);
        const wallMs = Date.now() - tStart;
        const row = {
          runId,
          goldId: input.goldId,
          language: input.language,
          family: input.family,
          goldClass: input.goldClass,
          shape: q.shape,
          shapeLabel: q.shapeLabel,
          query: q.query,
          outputSha256: q.outputSha256,
          verdict: graded.verdict,
          reason: graded.reason,
          fileRecallAt1: graded.fileRecallAt1,
          fileRecallAt5: graded.fileRecallAt5,
          symbolRecallAt1: graded.symbolRecallAt1,
          top1: graded.top1,
          scoreMargin: graded.scoreMargin,
          wallMs,
          error,
        };
        out.write(JSON.stringify(row) + '\n');
        totalRuns++;
        if (graded.verdict === 'PASS') totalPass++;
        else if (graded.verdict === 'PARTIAL') totalPartial++;
        else if (graded.verdict === 'FAIL') totalFail++;
        if (opts.verbose) {
          const tag = graded.verdict === 'PASS' ? '✓' : (graded.verdict === 'PARTIAL' ? '~' : '✗');
          process.stdout.write(`  ${tag} ${input.goldId} ${q.shape.padEnd(11)} ${graded.verdict.padEnd(7)} ${wallMs}ms\n`);
        }
        // Every 25 completions, emit a progress heartbeat outside the timer
        // so users see fast initial movement even if rate spikes.
        if (totalRuns % 25 === 0) emitProgress();
      }
    }
    try { searcher.close(); } catch { /* ignore */ }
  }
  clearInterval(progressTimer);
  emitProgress();
  await new Promise((resolve) => out.end(resolve));
  const wallSec = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(
    `\ntrack-a-runner: ${totalRuns} rows written; PASS=${totalPass} PARTIAL=${totalPartial} FAIL=${totalFail} wall=${wallSec}s\n` +
      `  output: ${path.relative(REPO_ROOT, trackPath)}\n`,
  );
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`track-a-runner: fatal ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
