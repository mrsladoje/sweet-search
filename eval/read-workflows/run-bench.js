#!/usr/bin/env node
//
// Read-Workflows Benchmark — real-repo edition.
//
// Compares three code-understanding workflows on one (or all four) of the
// pinned upstream repos under eval/repos/<repo>/:
//   1. native-rg-read           — spawn rg + fs.readFile (Claude Code default)
//   2. sweet-grep-read          — SweetSearch.bareGrep (real indexed grep)
//                                 + sweet-search read on chunk-bounded ranges
//   3. sweet-grep-read-semantic — SweetSearch.patternSearch (ColGrep)
//                                 + sweet-search read-semantic on top-K files
//
// Gold tasks come from eval/data/pattern-benchmark-<repo>/queries.jsonl,
// which carries regex + semantic_query + relevant_files + relevant_chunks.
//
// Single-repo per process (DB_PATHS resolves once at module load). For multi-
// repo runs we spawn one subprocess per repo and merge the JSON artifacts.
//
// Usage:
//   node eval/read-workflows/run-bench.js --repo=fastify
//   node eval/read-workflows/run-bench.js --repo=fastify --max-queries=10
//   node eval/read-workflows/run-bench.js --all
//   node eval/read-workflows/run-bench.js --repo=gin --task=gin003

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ── argv ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    repo: null, all: false,
    iters: 3, warmup: 1, randomize: true, seed: 42,
    split: 'dev', maxQueries: 20, onlyTask: null, onlyMode: null,
    noLi: false, jsonOnly: false, force: false,
  };
  for (const arg of argv) {
    if (arg.startsWith('--repo=')) opts.repo = arg.split('=')[1];
    else if (arg === '--all') opts.all = true;
    else if (arg.startsWith('--iters=')) opts.iters = +arg.split('=')[1];
    else if (arg.startsWith('--warmup=')) opts.warmup = +arg.split('=')[1];
    else if (arg.startsWith('--seed=')) opts.seed = +arg.split('=')[1];
    else if (arg.startsWith('--split=')) opts.split = arg.split('=')[1];
    else if (arg.startsWith('--max-queries=')) opts.maxQueries = +arg.split('=')[1];
    else if (arg.startsWith('--task=')) opts.onlyTask = arg.split('=')[1];
    else if (arg.startsWith('--mode=')) opts.onlyMode = arg.split('=')[1];
    else if (arg === '--no-randomize') opts.randomize = false;
    else if (arg === '--no-li') opts.noLi = true;
    else if (arg === '--json-only') opts.jsonOnly = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`Read-Workflows Benchmark — real repos.

Usage:
  node eval/read-workflows/run-bench.js --repo=<fastify|gin|flask|ripgrep>
  node eval/read-workflows/run-bench.js --all          # one subprocess per repo
  npm run bench:read-workflows -- --repo=fastify

Options:
  --repo=NAME          Pinned repo under eval/repos/<NAME>
  --all                Fan out to all four repos (one subprocess each)
  --iters=N            Measured iterations per (mode, task)        [default: 3]
  --warmup=N           Warmup iterations per mode                  [default: 1]
  --split=dev|test|all Subset of queries.jsonl                     [default: dev]
  --max-queries=N      Cap queries per repo (0=all, ignored if --task)
                                                                   [default: 20]
  --task=ID            Run a single task (e.g. fy001 or fastify:fy001)
  --mode=NAME          Run a single mode
  --no-randomize       Run tasks in queries.jsonl order
  --seed=N             RNG seed for shuffle                        [default: 42]
  --no-li              Disable late-interaction at query time
                       (forces SWEET_SEARCH_LATE_INTERACTION_MODEL=false)
  --json-only          Suppress console summary
  --force              Run even if pinned-SHA fingerprint mismatches
`);
}

// ── deterministic shuffle ───────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, seed) {
  const out = [...arr];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── formatters ──────────────────────────────────────────────────────────────

function pct(x) { return (x * 100).toFixed(1) + '%'; }
function num(x) { return Number.isFinite(x) ? x.toFixed(1) : '∞'; }
function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function summarizeMode(modeName, perTask) {
  const totalMs = perTask.map(r => r.totalMs);
  const tokens = perTask.map(r => r.approxTokens);
  const fileRecall = perTask.map(r => r.score.fileRecall);
  const lineRecall = perTask.map(r => r.score.goldLineRecall);
  const linePrec = perTask.map(r => r.score.returnedLinePrecision);
  const success = perTask.map(r => r.score.successAtBudget ? 1 : 0);
  const overfetch = perTask.map(r => r.score.overfetchRatio).filter(x => Number.isFinite(x));
  const fellBack = perTask.filter(r => r.fellBack).length;
  const liRan = perTask.filter(r => r.liRan).length;
  const errored = perTask.filter(r => r.error).length;
  return {
    mode: modeName, n: perTask.length,
    p50TotalMs: percentile(totalMs, 0.5),
    p95TotalMs: percentile(totalMs, 0.95),
    maxTotalMs: Math.max(...totalMs, 0),
    avgApproxTokens: avg(tokens),
    avgFileRecall: avg(fileRecall),
    avgGoldLineRecall: avg(lineRecall),
    avgReturnedLinePrecision: avg(linePrec),
    successAtBudget: avg(success),
    avgOverfetchRatio: avg(overfetch),
    fellBack, liRan, errored,
  };
}

function printConsoleSummary(repo, modeSummaries, perTask, baseline) {
  process.stdout.write(`\n=== Read Workflow Benchmark — ${repo} ===\n`);
  process.stdout.write('Modes: ' + modeSummaries.map(m => m.mode).join(', ') + '\n\n');
  for (const m of modeSummaries) {
    const baseTok = baseline?.avgApproxTokens || 0;
    const tokenDelta = baseTok > 0 ? ((baseTok - m.avgApproxTokens) / baseTok) * 100 : 0;
    process.stdout.write(`[${m.mode}]\n`);
    process.stdout.write(`  latency p50/p95/max: ${num(m.p50TotalMs)} / ${num(m.p95TotalMs)} / ${num(m.maxTotalMs)} ms\n`);
    process.stdout.write(`  avg ~tokens:         ${m.avgApproxTokens.toFixed(0)}`);
    if (m.mode !== baseline?.mode && baseTok > 0) {
      process.stdout.write(`  (savings vs ${baseline.mode}: ${tokenDelta >= 0 ? '+' : ''}${tokenDelta.toFixed(1)}%)`);
    }
    process.stdout.write('\n');
    process.stdout.write(`  file recall:         ${pct(m.avgFileRecall)}\n`);
    process.stdout.write(`  gold-line recall:    ${pct(m.avgGoldLineRecall)}\n`);
    process.stdout.write(`  returned-line prec:  ${pct(m.avgReturnedLinePrecision)}\n`);
    process.stdout.write(`  success@budget:      ${pct(m.successAtBudget)}\n`);
    process.stdout.write(`  avg overfetch:       ${num(m.avgOverfetchRatio)}x\n`);
    process.stdout.write(`  read-semantic fallback: ${m.fellBack}/${m.n}\n`);
    process.stdout.write(`  read-semantic LI ran:   ${m.liRan}/${m.n}\n`);
    if (m.errored) process.stdout.write(`  errors:              ${m.errored}/${m.n}\n`);
    process.stdout.write('\n');
  }

  // best mode by task type
  const byType = {};
  for (const row of perTask) {
    byType[row.taskType] ||= {};
    byType[row.taskType][row.mode] ||= [];
    byType[row.taskType][row.mode].push(row);
  }
  process.stdout.write('Best mode by task type (recall, ties → fewer tokens):\n');
  for (const [type, modeMap] of Object.entries(byType)) {
    const ranked = Object.entries(modeMap).map(([mode, rows]) => ({
      mode, recall: avg(rows.map(r => r.score.goldLineRecall)),
      tokens: avg(rows.map(r => r.approxTokens)),
    })).sort((a, b) => (b.recall - a.recall) || (a.tokens - b.tokens));
    process.stdout.write(`  ${type.padEnd(28)} → ${ranked[0].mode.padEnd(28)} (recall=${pct(ranked[0].recall)}, ~${ranked[0].tokens.toFixed(0)} tok)\n`);
  }
  process.stdout.write('\n');

  // Per-task winners and overfetch flag
  const taskIds = [...new Set(perTask.map(r => r.taskId))];
  const nativeWinTasks = [];
  for (const tid of taskIds) {
    const rows = perTask.filter(r => r.taskId === tid);
    const native = rows.find(r => r.mode === 'native-rg-read');
    const sweetBest = rows.filter(r => r.mode !== 'native-rg-read')
      .sort((a, b) => b.score.goldLineRecall - a.score.goldLineRecall)[0];
    if (native && sweetBest && native.score.goldLineRecall > sweetBest.score.goldLineRecall + 1e-9) {
      nativeWinTasks.push(tid);
    }
  }
  process.stdout.write(`Native wins (strict goldLineRecall): ${nativeWinTasks.length ? nativeWinTasks.join(', ') : '(none)'}\n`);

  const semRows = perTask.filter(r => r.mode === 'sweet-grep-read-semantic');
  const fellBackTasks = semRows.filter(r => r.fellBack).map(r => r.taskId);
  const liRanTasks = semRows.filter(r => r.liRan).map(r => r.taskId);
  process.stdout.write(`read-semantic fellBack on: ${fellBackTasks.length ? fellBackTasks.join(', ') : '(none)'}\n`);
  process.stdout.write(`read-semantic LI ran on:   ${liRanTasks.length ? liRanTasks.join(', ') : '(none)'}\n`);
}

// ── per-repo run (single process owns one repo) ─────────────────────────────

async function runOneRepo(opts) {
  if (!opts.repo) throw new Error('--repo is required');

  // 1) Pin env BEFORE importing setup/runners (DB_PATHS is set at import time).
  const setup = await import('./setup.js');
  const layout = setup.verifyRepoLayout(opts.repo);

  if (opts.noLi) {
    process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL = 'false';
  }
  setup.pointEnvAt(opts.repo);
  const spec = setup.getRepoSpec(opts.repo);

  // 2) Lazy import everything that depends on env / DB_PATHS.
  const { POLICIES, MODE_ORDER } = await import('./policies.js');
  const { loadTasks, summarizeTasks } = await import('./tasks.js');
  const { RUNNERS } = await import('./runners.js');
  const { scoreTaskResult } = await import('./metrics.js');
  const { SweetSearch } = await import('../../core/search/sweet-search.js');

  // 3) Build tasks
  let tasks = loadTasks(opts.repo, {
    split: opts.split,
    maxQueries: opts.onlyTask ? 0 : opts.maxQueries,
    onlyIds: opts.onlyTask ? [opts.onlyTask] : null,
  });
  if (opts.randomize) tasks = shuffle(tasks, opts.seed);
  const modes = opts.onlyMode ? [opts.onlyMode] : MODE_ORDER;
  const taskSummary = summarizeTasks(tasks);

  // 4) Initialize SweetSearch once per process; both sweet runners share it.
  const searcher = new SweetSearch({ projectRoot: layout.repoDir });
  await searcher.init();

  if (!opts.jsonOnly) {
    process.stdout.write(`Setting up bench for repo "${opts.repo}"\n`);
    process.stdout.write(`  fixtures dir:  ${layout.repoDir}\n`);
    process.stdout.write(`  pinned SHA:    ${spec.sha.slice(0, 8)}\n`);
    process.stdout.write(`  fingerprint:   ${layout.fingerprint}\n`);
    process.stdout.write(`  hasLi:         ${layout.hasLi}\n`);
    process.stdout.write(`  hasSparseGram: ${layout.hasSparseGram}\n`);
    process.stdout.write(`  tasks:         ${taskSummary.count} (${JSON.stringify(taskSummary.byType)})\n`);
    process.stdout.write(`  modes:         ${modes.join(', ')}\n`);
    process.stdout.write(`  iters/warmup:  ${opts.iters}/${opts.warmup}\n\n`);
  }

  const ctx = { repoDir: layout.repoDir, searcher };

  // 5) Warmup
  for (const mode of modes) {
    const runner = RUNNERS[mode];
    for (let w = 0; w < opts.warmup; w++) {
      for (const task of tasks) {
        try { await runner(task, ctx); } catch { /* warmup errors swallowed */ }
      }
    }
  }

  // 6) Measured runs
  const allRuns = [];
  for (let iter = 0; iter < opts.iters; iter++) {
    for (const task of tasks) {
      for (const mode of modes) {
        const runner = RUNNERS[mode];
        let result;
        try { result = await runner(task, ctx); }
        catch (err) {
          result = {
            mode, taskId: task.id, error: err.message || String(err),
            totalMs: 0, totalChars: 0, approxTokens: 0,
            discovery: { ms: 0, hits: 0, chars: 0, returnedFiles: [] },
            reads: { ms: 0, count: 0, totalChars: 0 },
            returnedContext: [],
          };
        }
        const score = result.error
          ? { fileRecall: 0, goldLineRecall: 0, returnedLinePrecision: 0,
              symbolRecall: 0, overfetchRatio: 0, answerability: 'failure',
              successAtBudget: false, falsePositiveFiles: [], perFile: {},
              returnedLineTotal: 0, goldLineTotal: 0, fileTP: 0 }
          : scoreTaskResult(task, result);
        allRuns.push({ iter, mode, taskId: task.id, taskType: task.taskType,
          difficulty: task.difficulty, ...result, score });
      }
    }
  }

  // 7) Collapse per (mode, task) — average latency/tokens, take median run for context.
  const collapsed = [];
  const taskIds = [...new Set(allRuns.map(r => r.taskId))];
  for (const taskId of taskIds) {
    for (const mode of modes) {
      const rows = allRuns.filter(r => r.taskId === taskId && r.mode === mode);
      if (!rows.length) continue;
      const sortedByMs = [...rows].sort((a, b) => a.totalMs - b.totalMs);
      const median = sortedByMs[Math.floor(sortedByMs.length / 2)];
      collapsed.push({
        mode, taskId, taskType: rows[0].taskType, difficulty: rows[0].difficulty,
        iterCount: rows.length,
        totalMs: avg(rows.map(r => r.totalMs)),
        approxTokens: avg(rows.map(r => r.approxTokens)),
        medianTotalMs: median.totalMs,
        discovery: median.discovery,
        reads: median.reads,
        returnedFiles: [...new Set(median.returnedContext.map(c => c.file))],
        returnedContextSummary: median.returnedContext.map(c => ({
          file: c.file,
          lineCount: c.lines.size,
          firstLine: c.lines.size ? Math.min(...c.lines) : null,
          lastLine: c.lines.size ? Math.max(...c.lines) : null,
          chars: c.text.length,
        })),
        score: median.score,
        fellBack: !!median.fellBack,
        liRan: !!median.liRan,
        error: median.error,
      });
    }
  }

  const modeSummaries = modes.map(mode => summarizeMode(mode, collapsed.filter(r => r.mode === mode)));
  const baseline = modeSummaries.find(m => m.mode === 'native-rg-read') || modeSummaries[0];

  // 8) Win attribution
  const taskWinners = [];
  for (const taskId of taskIds) {
    const rows = collapsed.filter(r => r.taskId === taskId);
    const ranked = [...rows].sort((a, b) => {
      if (b.score.goldLineRecall !== a.score.goldLineRecall) return b.score.goldLineRecall - a.score.goldLineRecall;
      if (b.score.returnedLinePrecision !== a.score.returnedLinePrecision) return b.score.returnedLinePrecision - a.score.returnedLinePrecision;
      return a.approxTokens - b.approxTokens;
    });
    const w = ranked[0], ru = ranked[1];
    let winByOverfetch = false;
    if (w && ru && w.score.goldLineRecall > ru.score.goldLineRecall + 1e-9) {
      const tokenRatio = w.approxTokens / Math.max(1, ru.approxTokens);
      const recallGap = w.score.goldLineRecall - ru.score.goldLineRecall;
      if (tokenRatio > 2 && recallGap < 0.25) winByOverfetch = true;
    }
    taskWinners.push({ taskId, taskType: rows[0].taskType, difficulty: rows[0].difficulty,
      winner: w?.mode, runnerUp: ru?.mode, winByOverfetch,
      recall: w?.score.goldLineRecall, tokens: w?.approxTokens });
  }

  const summary = {
    schemaVersion: 2,
    benchmark: 'read-workflows',
    timestamp: new Date().toISOString(),
    repo: opts.repo,
    pinnedSha: spec.sha,
    upstreamUrl: spec.url,
    fingerprint: layout.fingerprint,
    layout: {
      repoDir: layout.repoDir,
      hasLi: layout.hasLi,
      hasSparseGram: layout.hasSparseGram,
    },
    opts,
    taskSummary,
    policies: POLICIES,
    modes: modeSummaries,
    perTask: collapsed,
    rawRuns: allRuns.map(r => ({
      iter: r.iter, mode: r.mode, taskId: r.taskId, totalMs: r.totalMs,
      approxTokens: r.approxTokens, score: r.score,
      fellBack: !!r.fellBack, liRan: !!r.liRan, error: r.error,
    })),
    taskWinners,
  };

  const benchDir = path.join(REPO_ROOT, '.sweet-search', 'benchmarks');
  if (!existsSync(benchDir)) mkdirSync(benchDir, { recursive: true });
  const safeTs = summary.timestamp.replace(/[:.]/g, '-');
  const outPath = path.join(benchDir, `read-workflows-${opts.repo}-${safeTs}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  if (!opts.jsonOnly) {
    printConsoleSummary(opts.repo, modeSummaries, collapsed, baseline);
    process.stdout.write(`\nJSON artifact: ${path.relative(REPO_ROOT, outPath)}\n`);
  } else {
    process.stdout.write(outPath + '\n');
  }
  return outPath;
}

// ── multi-repo subprocess fanout ────────────────────────────────────────────

function runAllReposViaSubprocess(opts) {
  const repos = ['fastify', 'gin', 'flask', 'ripgrep'];
  const passthrough = process.argv.slice(2).filter(a => a !== '--all' && !a.startsWith('--repo='));
  const artifacts = [];
  for (const repo of repos) {
    process.stdout.write(`\n──────────── ${repo} ────────────\n`);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-bench.js'), `--repo=${repo}`, ...passthrough], {
      stdio: 'inherit',
    });
    if (r.status !== 0) {
      process.stderr.write(`[${repo}] subprocess exit ${r.status}\n`);
    }
  }
  process.stdout.write(`\n${artifacts.length} artifacts; check .sweet-search/benchmarks/\n`);
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.all) {
    runAllReposViaSubprocess(opts);
    return;
  }
  if (!opts.repo) {
    process.stderr.write('Specify --repo=<fastify|gin|flask|ripgrep> or --all.\n');
    printHelp();
    process.exit(2);
  }
  await runOneRepo(opts);
}

main().catch(err => {
  process.stderr.write(`bench failed: ${err.stack || err.message || err}\n`);
  process.exit(1);
});
