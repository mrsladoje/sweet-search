#!/usr/bin/env node
/**
 * track-behavioural-runner.mjs — Stage 0.5 behavioural-benchmark sweep for
 * ss-semantic.
 *
 * Reads behavioural rewrites from
 * `eval/ast-tester-probes/gold-behavioral/<lang>.json`, looks up the
 * matching preprocess input for path + containingChunk + family, then calls
 * readSemantic({ path, query: rewrittenQuery }) and grades the returned
 * spans with the SAME gradeSpans rubric used by track-a-runner-ss-semantic
 * (top-1 IoU vs gold containingChunk range).
 *
 * Mirrors track-a-runner's orchestrator/child split — see that file for the
 * SWEET_SEARCH_PROJECT_ROOT landmine rationale (module-level `_repo` cache
 * captures DB_PATHS at import time).
 *
 * Output: core/prompt-optimization/data/query-shapes/ss-semantic/tracks/track-behavioural-<runId>.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { gradeSpans } from './track-a-runner-ss-semantic.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const BEHAVIOURAL_DIR = path.join(REPO_ROOT, 'eval/ast-tester-probes/gold-behavioral');
const TRACKS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/ss-semantic/tracks');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

function parseArgs(argv) {
  const out = { lang: null, runId: null, topK: 5, threshold: 0.4, verbose: false };
  for (const a of argv) {
    if (a.startsWith('--lang=')) out.lang = a.slice('--lang='.length);
    else if (a.startsWith('--run-id=')) out.runId = a.slice('--run-id='.length);
    else if (a.startsWith('--top=')) out.topK = parseInt(a.slice('--top='.length), 10);
    else if (a.startsWith('--threshold=')) out.threshold = parseFloat(a.slice('--threshold='.length));
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: track-behavioural-runner.mjs [--lang=...] [--run-id=...] [--top=5] [--threshold=0.4]\n');
      process.exit(0);
    } else {
      process.stderr.write(`track-behavioural-runner: unknown arg "${a}"\n`);
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

/**
 * Load ALL behavioural rewrites, attached to their matching preprocess input
 * (which carries containingChunk + family + canonicalLanguage). Skips
 * infeasible-marked rewrites.
 */
function loadBehaviouralRows() {
  const rows = [];
  if (!fs.existsSync(BEHAVIOURAL_DIR)) return rows;
  for (const f of fs.readdirSync(BEHAVIOURAL_DIR)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(BEHAVIOURAL_DIR, f), 'utf8'));
    for (const r of j.rewrites || []) {
      if (r.infeasible || !r.rewrittenQuery) continue;
      const inputPath = path.join(INPUTS_DIR, `${j.language}-${r.rewrittenFrom}.json`);
      if (!fs.existsSync(inputPath)) continue;
      const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      rows.push({
        language: j.language,
        goldId: r.rewrittenFrom,
        rewriteId: r.id,
        family: input.family,
        query: r.rewrittenQuery,
        expectedFile: input.expectedFile,
        containingChunk: input.containingChunk,
        input,
      });
    }
  }
  return rows;
}

async function orchestrate(opts) {
  const reposMap = loadReposManifest();
  const rows = loadBehaviouralRows();
  if (rows.length === 0) {
    process.stderr.write('track-behavioural-runner: no rewrites found in gold-behavioral/\n');
    process.exit(2);
  }
  const runId = opts.runId || `behavioural-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
  const trackPath = path.join(TRACKS_DIR, `track-behavioural-${runId}.jsonl`);

  const languages = [...new Set(rows.map((r) => r.language))]
    .filter((l) => !opts.lang || l === opts.lang)
    .sort();

  process.stdout.write(`orchestrator: ${rows.length} rewrites across ${languages.length} languages\n`);

  const out = fs.createWriteStream(trackPath, { flags: 'w' });
  let total = 0;
  const start = Date.now();
  for (const language of languages) {
    const repoEntry = reposMap.get(language);
    if (!repoEntry) { process.stderr.write(`  ! no repos.json entry for ${language}\n`); continue; }
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    const childArgs = process.argv.slice(2).filter((a) => !a.startsWith('--lang='));
    childArgs.push(`--lang=${language}`);
    process.stdout.write(`\n--- ${language} (projectRoot=${path.relative(REPO_ROOT, projectRoot)}) ---\n`);
    const res = spawnSync(process.argv[0], [process.argv[1], ...childArgs], {
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, SS_SEMANTIC_CHILD_OUT: 'jsonl' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      process.stderr.write(`  child ${language} exited ${res.status}: ${res.stderr?.toString().slice(0, 300)}\n`);
      continue;
    }
    let n = 0;
    for (const line of res.stdout.toString().split(/\r?\n/)) {
      if (!line.startsWith('{')) { if (line.trim()) process.stdout.write('  ' + line + '\n'); continue; }
      out.write(line + '\n');
      n++;
    }
    total += n;
    process.stdout.write(`  ${language}: ${n} rows\n`);
  }
  await new Promise((r) => out.end(r));
  process.stdout.write(`\norchestrator: ${total} rows; wall=${((Date.now() - start) / 1000).toFixed(1)}s\n  output: ${path.relative(REPO_ROOT, trackPath)}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const isChild = process.env.SS_SEMANTIC_CHILD_OUT === 'jsonl';
  if (!isChild) return orchestrate(opts);

  const { readSemantic } = await import('../../search-runtime.mjs');

  const reposMap = loadReposManifest();
  const allRows = loadBehaviouralRows();
  const rows = allRows.filter((r) => !opts.lang || r.language === opts.lang);
  if (rows.length === 0) {
    process.stderr.write(`track-behavioural-runner: no rewrites for lang=${opts.lang}\n`);
    process.exit(2);
  }
  for (const r of rows) {
    const repoEntry = reposMap.get(r.language);
    if (!repoEntry) continue;
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    let spans = [];
    let error = null;
    const tStart = Date.now();
    try {
      const resp = await readSemantic({
        path: r.expectedFile,
        query: r.query,
        projectRoot,
        topK: opts.topK,
        threshold: opts.threshold,
      });
      spans = resp?.spans ?? [];
    } catch (err) {
      error = err.message;
    }
    const graded = gradeSpans(r.input, spans);
    const row = {
      runId: opts.runId || 'behavioural-unset',
      goldId: r.goldId,
      rewriteId: r.rewriteId,
      language: r.language,
      family: r.family,
      benchmark: 'behavioural',
      query: r.query,
      expectedFile: r.expectedFile,
      goldRange: { startLine: r.containingChunk?.startLine, endLine: r.containingChunk?.endLine },
      spans: spans.map((s) => ({ startLine: s.startLine, endLine: s.endLine, score: s.score })),
      verdict: graded.verdict,
      reason: graded.reason,
      top1_iou: graded.top1_iou,
      max_iou: graded.max_iou,
      coverage: graded.coverage,
      precision: graded.precision,
      n_spans: graded.n_spans,
      wallMs: Date.now() - tStart,
      error,
    };
    process.stdout.write(JSON.stringify(row) + '\n');
  }
}

main().catch((err) => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });
