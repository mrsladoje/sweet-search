#!/usr/bin/env node
/**
 * track-a-runner-ss-semantic.mjs — deterministic per-(gold, V-cell) sweep
 * for the PHASE6_REDO ss-semantic tool (PHASE6_REDO §12.1, refined
 * 2026-05-13).
 *
 * Shape grid: REUSES the 7 ss-search V-cells (V1..V7). The Q-strings
 * authored for ss-search work as-is for ss-semantic because the agent's
 * input surface is the same NL query — only the retrieval mechanism
 * differs. ss-semantic operates on ONE file (the agent already knows the
 * path) and returns line spans within it, so:
 *   - no R axis (no regex)
 *   - grading is span-IoU with the gold's symbol line range, NOT file-match
 *   - doc-positive golds are skipped (ss-semantic operates on a known file;
 *     doc-positive's gold is "find this file from a description" — different
 *     intent that doesn't fit the in-file-scope rubric)
 *
 * For each (gold, V-cell):
 *   - load the gold's `containingChunk` to derive the expected line range
 *   - call readSemantic({ path: gold.expectedFile, query: variant.query })
 *   - grade the returned spans against the gold range
 *
 * Output: core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-a-<runId>.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// readSemantic is imported LAZILY inside main() — its module-load-time
// reads SWEET_SEARCH_PROJECT_ROOT to compute DB_PATHS.codebase, so any
// import here would bake in the parent's project root rather than the
// per-language ast-tester-probes repo root. The runner instead
// spawns ITSELF as a child per language with the correct env var set.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const VARIANTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/variants');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

const V_CELLS = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'];
const BASELINE_SHAPE = 'V_baseline';

function parseArgs(argv) {
  const out = {
    lang: null, id: null, shape: null, runId: null,
    includeBaseline: true, dryRun: false, verbose: false, logPath: undefined,
    topK: 5, threshold: 0.4,
  };
  for (const arg of argv) {
    if (arg.startsWith('--lang=')) out.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--id=')) out.id = arg.slice('--id='.length);
    else if (arg.startsWith('--shape=')) out.shape = arg.slice('--shape='.length);
    else if (arg.startsWith('--run-id=')) out.runId = arg.slice('--run-id='.length);
    else if (arg.startsWith('--top=')) out.topK = parseInt(arg.slice('--top='.length), 10);
    else if (arg.startsWith('--threshold=')) out.threshold = parseFloat(arg.slice('--threshold='.length));
    else if (arg.startsWith('--log=')) out.logPath = arg.slice('--log='.length);
    else if (arg === '--no-log') out.logPath = null;
    else if (arg === '--skip-baseline') out.includeBaseline = false;
    else if (arg === '--include-baseline') out.includeBaseline = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: track-a-runner-ss-semantic.mjs [--lang=...] [--id=...] [--shape=V1..V7] [--run-id=...] [--top=5] [--threshold=0.4] [--skip-baseline] [--dry-run] [--verbose] [--log=<path>|--no-log]\n');
      process.exit(0);
    } else {
      process.stderr.write(`track-a-runner-ss-semantic: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function attachStdoutLogger(logPath) {
  if (!logPath) return null;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  fs.writeSync(fd, `\n=== track-a-runner-ss-semantic run @ ${new Date().toISOString()} (pid ${process.pid}) ===\n`);
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

function loadVariantsForGold(input) {
  const out = {};
  for (const v of V_CELLS) {
    const p = path.join(VARIANTS_DIR, `${input.language}-${input.goldId}-${v}.json`);
    if (!fs.existsSync(p)) continue;
    out[v] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return out;
}

/**
 * Compute span-grading metrics for a ss-semantic result.
 *
 * Gold range = [input.containingChunk.startLine, input.containingChunk.endLine]
 *   (this is the chunk that contains the gold symbol; the natural target
 *   for a "find the relevant span" query)
 *
 * Returned `spans` is an array of { startLine, endLine } from readSemantic.
 *
 * Metrics:
 *   - top1_iou       : IoU of the top-1 span with the gold range
 *   - max_iou        : max IoU across all returned spans
 *   - coverage       : fraction of the gold range covered by ANY returned span
 *   - precision      : fraction of returned span content inside the gold range
 *                      (over all spans, not just top-1)
 *   - n_spans        : number of spans returned
 *
 * Verdict (PASS/PARTIAL/FAIL):
 *   - PASS    : top1_iou ≥ 0.5
 *   - PARTIAL : top1_iou > 0 but < 0.5  (some overlap)
 *   - FAIL    : top1_iou == 0  OR  no spans returned
 *
 * Why IoU instead of file_recall: ss-semantic's grading is span-level, not
 * file-level — the file is the INPUT, not the output. The IoU rubric is
 * standard for span-retrieval evaluation in IR literature.
 */
export function gradeSpans(input, spans) {
  const goldStart = input.containingChunk?.startLine ?? input.sourceSnippet?.startLine ?? null;
  const goldEnd = input.containingChunk?.endLine ?? input.sourceSnippet?.endLine ?? null;
  if (!Array.isArray(spans) || spans.length === 0 || goldStart == null || goldEnd == null) {
    return {
      verdict: 'FAIL', reason: spans?.length ? 'gold range missing' : 'no spans',
      top1_iou: 0, max_iou: 0, coverage: 0, precision: 0, n_spans: spans?.length ?? 0,
    };
  }
  const goldLen = goldEnd - goldStart + 1;

  function overlap(a0, a1, b0, b1) {
    const lo = Math.max(a0, b0);
    const hi = Math.min(a1, b1);
    return hi >= lo ? hi - lo + 1 : 0;
  }
  function iou(a0, a1, b0, b1) {
    const ov = overlap(a0, a1, b0, b1);
    if (ov === 0) return 0;
    const aLen = a1 - a0 + 1;
    const bLen = b1 - b0 + 1;
    return ov / (aLen + bLen - ov);
  }

  // Top-1 IoU — by SCORE not by line. readSemantic outputs spans in line
  // order (for human readability in `_enforceCharBudget`), but the "top-1
  // answer" for benchmark purposes is the highest-confidence span. User
  // decision 2026-05-13: top-1 = max-score; output stays line-ordered.
  // If a span has no `score` field (older JSONL re-grade path), fall back
  // to spans[0] so the behaviour is backward-compatible.
  const top = spans.some((s) => typeof s.score === 'number')
    ? [...spans].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))[0]
    : spans[0];
  const top1_iou = iou(top.startLine, top.endLine, goldStart, goldEnd);

  // Max IoU across all spans
  let max_iou = 0;
  let totalOverlap = 0;
  let totalSpanLen = 0;
  const goldCovered = new Set();
  for (const s of spans) {
    const i = iou(s.startLine, s.endLine, goldStart, goldEnd);
    if (i > max_iou) max_iou = i;
    const ov = overlap(s.startLine, s.endLine, goldStart, goldEnd);
    totalOverlap += ov;
    totalSpanLen += s.endLine - s.startLine + 1;
    // Track which gold lines are covered by some span (avoid double-counting overlaps).
    if (ov > 0) {
      const lo = Math.max(s.startLine, goldStart);
      const hi = Math.min(s.endLine, goldEnd);
      for (let ln = lo; ln <= hi; ln++) goldCovered.add(ln);
    }
  }
  const coverage = goldCovered.size / goldLen;
  const precision = totalSpanLen > 0 ? totalOverlap / totalSpanLen : 0;

  let verdict;
  if (top1_iou >= 0.5) verdict = 'PASS';
  else if (top1_iou > 0) verdict = 'PARTIAL';
  else verdict = 'FAIL';

  return {
    verdict,
    reason: verdict === 'PASS' ? 'iou>=0.5' : verdict === 'PARTIAL' ? `iou=${top1_iou.toFixed(2)}` : 'no overlap',
    top1_iou, max_iou, coverage, precision, n_spans: spans.length,
  };
}

async function orchestrate(opts) {
  // No --lang supplied → orchestrate per-language children.
  // Each child sets SWEET_SEARCH_PROJECT_ROOT to its repo's localPath
  // BEFORE importing the readSemantic module (which captures DB_PATHS
  // at module load). Children write JSONL to a per-language temp file
  // and the orchestrator concatenates them into the final track file.
  const defaultLog = path.join(TRACKS_DIR, '_progress.log');
  const logPath = opts.logPath === undefined ? defaultLog : opts.logPath;
  if (logPath) fs.mkdirSync(path.dirname(logPath), { recursive: true });
  attachStdoutLogger(logPath);
  if (logPath) process.stdout.write(`track-a-runner-ss-semantic: mirroring stdout to ${path.relative(REPO_ROOT, logPath)} (tail -f to watch)\n`);

  const reposMap = loadReposManifest();
  const inputs = loadAllInputs().filter((i) => i.goldClass === 'ast-tester');
  if (inputs.length === 0) {
    process.stderr.write('track-a-runner-ss-semantic: no ast-tester inputs (run preprocess.mjs first)\n');
    process.exit(2);
  }
  const runId = opts.runId || `phase6-redo-ss-semantic-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  const trackPath = path.join(TRACKS_DIR, `track-a-${runId}.jsonl`);

  const languages = [...new Set(inputs.map((i) => i.language))]
    .filter((l) => !opts.id || inputs.some((i) => i.goldId === opts.id && i.language === l))
    .sort();
  process.stdout.write(`orchestrator: ${languages.length} language(s); spawning per-language children\n`);

  const out = fs.createWriteStream(trackPath, { flags: 'w' });
  let totalRows = 0;
  const start = Date.now();
  for (const language of languages) {
    const repoEntry = reposMap.get(language);
    if (!repoEntry) { process.stderr.write(`  ! no repos.json entry for ${language}\n`); continue; }
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    const childArgs = process.argv.slice(2).filter((a) => !a.startsWith('--lang=') && a !== '--no-log');
    childArgs.push(`--lang=${language}`, '--no-log');
    process.stdout.write(`\n--- ${language} (projectRoot=${path.relative(REPO_ROOT, projectRoot)}) ---\n`);
    const res = spawnSync(process.argv[0], [process.argv[1], ...childArgs], {
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, SS_SEMANTIC_CHILD_OUT: 'jsonl' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      process.stderr.write(`  child for ${language} exited ${res.status}: ${res.stderr?.toString().slice(0, 300)}\n`);
      continue;
    }
    const childOutput = res.stdout.toString();
    let langRows = 0;
    for (const line of childOutput.split(/\r?\n/)) {
      if (!line.startsWith('{')) {
        process.stdout.write('  ' + line + '\n'); // pass through child progress lines
        continue;
      }
      out.write(line + '\n');
      langRows++;
    }
    totalRows += langRows;
    process.stdout.write(`  ${language}: ${langRows} rows\n`);
  }
  await new Promise((resolve) => out.end(resolve));
  process.stdout.write(`\norchestrator: ${totalRows} total rows; wall=${((Date.now() - start) / 1000).toFixed(1)}s\n  output: ${path.relative(REPO_ROOT, trackPath)}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Orchestrator vs child split:
  //   - SS_SEMANTIC_CHILD_OUT set → child mode: SWEET_SEARCH_PROJECT_ROOT
  //     was set by the orchestrator BEFORE readSemantic loaded, so DB_PATHS
  //     correctly points at the per-language repo. Emit JSONL to stdout.
  //   - Otherwise → orchestrate per-language (no readSemantic in parent).
  // This is the only way to swap the readSemantic module-level `_repo`
  // singleton between languages without rewriting the search code.
  const isChild = process.env.SS_SEMANTIC_CHILD_OUT === 'jsonl';
  if (!isChild) {
    return orchestrate(opts);
  }

  // Child mode: lazy-import readSemantic so its DB_PATHS captures the
  // SWEET_SEARCH_PROJECT_ROOT the orchestrator set for THIS child.
  const { readSemantic } = await import('../../search-runtime.mjs');

  const reposMap = loadReposManifest();
  const inputs = loadAllInputs().filter((i) => i.goldClass === 'ast-tester');
  if (inputs.length === 0) {
    process.stderr.write('track-a-runner-ss-semantic: no ast-tester inputs (run preprocess.mjs first)\n');
    process.exit(2);
  }

  const runId = opts.runId || `phase6-redo-ss-semantic-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let trackPath = null;
  let out = null;
  if (!isChild) {
    fs.mkdirSync(TRACKS_DIR, { recursive: true });
    trackPath = path.join(TRACKS_DIR, `track-a-${runId}.jsonl`);
    out = fs.createWriteStream(trackPath, { flags: 'w' });
  }

  const filteredInputs = inputs.filter((i) =>
    (!opts.lang || i.language === opts.lang) && (!opts.id || i.goldId === opts.id));

  const vCells = opts.shape ? [opts.shape] : V_CELLS;
  const perGoldRuns = vCells.length + (opts.includeBaseline && !opts.shape ? 1 : 0);
  const plannedRuns = filteredInputs.length * perGoldRuns;
  if (!isChild) process.stdout.write(`track-a-runner-ss-semantic: runId=${runId}\n  ${filteredInputs.length} golds × ${perGoldRuns} (${vCells.length}V${opts.includeBaseline ? ' + baseline' : ''}) = ${plannedRuns} planned runs\n`);

  if (opts.dryRun) {
    process.stdout.write(`(dry-run) would write to: ${path.relative(REPO_ROOT, trackPath)}\n`);
    process.exit(0);
  }

  // In child mode, rows go to stdout (parent reads them line-by-line);
  // in standalone mode, rows go to disk via `out`.
  function writeRow(row) {
    if (isChild) process.stdout.write(JSON.stringify(row) + '\n');
    else out.write(JSON.stringify(row) + '\n');
  }
  let totalRuns = 0, totalPass = 0, totalPartial = 0, totalFail = 0, totalErrors = 0;
  let totalIouSum = 0;
  const start = Date.now();

  function fmtDur(ms) { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; }
  function emitProgress() {
    const wall = Date.now() - start;
    const pct = plannedRuns > 0 ? (totalRuns / plannedRuns) * 100 : 0;
    const rate = totalRuns > 0 ? wall / totalRuns : 0;
    const eta = (totalRuns > 0 && totalRuns < plannedRuns) ? rate * (plannedRuns - totalRuns) : 0;
    const avgIou = totalRuns > 0 ? totalIouSum / totalRuns : 0;
    process.stdout.write(
      `  [progress] ${String(totalRuns).padStart(5)}/${plannedRuns} (${pct.toFixed(1).padStart(5)}%) ` +
        `PASS=${String(totalPass).padStart(4)} PART=${String(totalPartial).padStart(4)} FAIL=${String(totalFail).padStart(4)} ` +
        `avgIoU=${avgIou.toFixed(2)} err=${String(totalErrors).padStart(3)} wall=${fmtDur(wall).padStart(6)} eta=${eta > 0 ? fmtDur(eta).padStart(6) : '    --'}\n`,
    );
  }
  const progressTimer = setInterval(emitProgress, 10_000);

  // Group by language so we can set the right projectRoot per query.
  const byLang = new Map();
  for (const i of filteredInputs) {
    if (!byLang.has(i.language)) byLang.set(i.language, []);
    byLang.get(i.language).push(i);
  }

  for (const [language, langInputs] of byLang.entries()) {
    const repoEntry = reposMap.get(language);
    if (!repoEntry) {
      process.stderr.write(`  ! no repos.json entry for ${language}; skipping\n`);
      continue;
    }
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    if (!isChild) process.stdout.write(`\n=== ${language} (${langInputs.length} golds) ===\n`);

    for (const input of langInputs) {
      const variants = loadVariantsForGold(input);
      const runs = [];
      if (opts.includeBaseline && !opts.shape) {
        runs.push({ shape: BASELINE_SHAPE, shapeLabel: 'baseline (goldQuery)', query: input.goldQuery });
      }
      for (const v of vCells) {
        const variant = variants[v];
        if (!variant) continue;
        runs.push({ shape: v, shapeLabel: variant.shapeLabel, query: variant.query });
      }

      for (const run of runs) {
        const tStart = Date.now();
        let spans = [];
        let error = null;
        try {
          const resp = await readSemantic({
            path: input.expectedFile,
            query: run.query,
            projectRoot,
            topK: opts.topK,
            threshold: opts.threshold,
          });
          spans = resp?.spans ?? [];
        } catch (err) {
          error = err.message;
          totalErrors++;
        }
        const graded = gradeSpans(input, spans);
        const wallMs = Date.now() - tStart;
        const row = {
          runId, goldId: input.goldId, language: input.language, family: input.family,
          goldClass: input.goldClass,
          shape: run.shape, shapeLabel: run.shapeLabel, query: run.query,
          expectedFile: input.expectedFile,
          goldRange: { startLine: input.containingChunk?.startLine, endLine: input.containingChunk?.endLine },
          spans: spans.map((s) => ({ startLine: s.startLine, endLine: s.endLine, score: s.score })),
          verdict: graded.verdict, reason: graded.reason,
          top1_iou: graded.top1_iou, max_iou: graded.max_iou,
          coverage: graded.coverage, precision: graded.precision,
          n_spans: graded.n_spans,
          wallMs, error,
        };
        writeRow(row);
        totalRuns++;
        totalIouSum += graded.top1_iou;
        if (graded.verdict === 'PASS') totalPass++;
        else if (graded.verdict === 'PARTIAL') totalPartial++;
        else totalFail++;
        if (opts.verbose && !isChild) {
          const tag = graded.verdict === 'PASS' ? '✓' : (graded.verdict === 'PARTIAL' ? '~' : '✗');
          process.stdout.write(`  ${tag} ${input.goldId} ${run.shape.padEnd(11)} ${graded.verdict.padEnd(7)} IoU=${graded.top1_iou.toFixed(2)} ${wallMs}ms\n`);
        }
        if (!isChild && totalRuns % 50 === 0) emitProgress();
      }
    }
  }
  clearInterval(progressTimer);
  if (!isChild) {
    emitProgress();
    await new Promise((resolve) => out.end(resolve));
  }
  const wallSec = ((Date.now() - start) / 1000).toFixed(1);
  if (!isChild) process.stdout.write(
    `\ntrack-a-runner-ss-semantic: ${totalRuns} rows written; PASS=${totalPass} PARTIAL=${totalPartial} FAIL=${totalFail} errors=${totalErrors} avgIoU=${(totalIouSum/Math.max(1,totalRuns)).toFixed(3)} wall=${wallSec}s\n` +
      `  output: ${path.relative(REPO_ROOT, trackPath)}\n`,
  );
}

const isMainModule = typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  main().catch((err) => { process.stderr.write(`track-a-runner-ss-semantic: fatal ${err.stack || err.message}\n`); process.exit(1); });
}
