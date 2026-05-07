#!/usr/bin/env node
//
// Structural Context Agent Benchmark
// ----------------------------------
// Runs model-read caller/callee/impact tasks against ss-trace and a native
// rg/read baseline. Uses canonical dev/held-out split files.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { POLICIES, TOOL_RULES } from '../agent-read-workflows/policies.js';
import { runClaudeAgent, summariseRun, formatToolTrace, buildClaudeArgs } from '../agent-read-workflows/claude-runner.js';
import { auditRun } from '../agent-read-workflows/audit.js';
import { scoreAnswer } from '../agent-read-workflows/metrics.js';
import { loadStructuralTasks, listStructuralRepos } from './tasks.js';
import { verifyRepoLayout } from '../read-workflows/setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const BENCH_BIN_DIR = path.join(REPO_ROOT, 'eval/agent-read-workflows/bin');
const STRUCTURAL_BIN_DIR = path.join(REPO_ROOT, 'eval/structural-context/bin');
const SPLIT_DIR = path.join(REPO_ROOT, 'eval/splits/structural-context');

function parseArgs(argv) {
  const opts = {
    split: 'dev',
    repo: null,
    maxTasks: null,
    seed: 42,
    model: 'haiku',
    conditions: ['native-rg-read', 'sweet-search-structural'],
    dryRun: false,
    timeoutMs: 240000,
  };
  for (const arg of argv) {
    if (arg.startsWith('--split=')) opts.split = arg.split('=')[1];
    else if (arg.startsWith('--repo=')) opts.repo = arg.split('=')[1];
    else if (arg.startsWith('--max-tasks=')) opts.maxTasks = +arg.split('=')[1];
    else if (arg.startsWith('--model=')) opts.model = arg.split('=')[1];
    else if (arg.startsWith('--condition=')) opts.conditions = arg.split('=')[1].split(',').filter(Boolean);
    else if (arg.startsWith('--conditions=')) opts.conditions = arg.split('=')[1].split(',').filter(Boolean);
    else if (arg.startsWith('--timeout=')) opts.timeoutMs = +arg.split('=')[1];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!['dev', 'heldout', 'fresh', 'all'].includes(opts.split)) {
    throw new Error('--split must be dev, heldout, fresh, or all');
  }
  for (const c of opts.conditions) {
    if (!['native-rg-read', 'sweet-search-structural'].includes(c)) {
      throw new Error(`unsupported condition for structural bench: ${c}`);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`Structural Context Agent Benchmark

Usage:
  node eval/structural-context/run-bench.js --split=dev
  node eval/structural-context/run-bench.js --split=heldout --repo=fastify
  node eval/structural-context/run-bench.js --dry-run

Options:
  --split=dev|heldout|fresh|all   Split to run [default: dev]
  --repo=NAME               Limit to one repo (${listStructuralRepos().join(', ')})
  --max-tasks=N             Cap tasks after split/repo filtering
  --condition=A,B           native-rg-read,sweet-search-structural
  --model=NAME              Claude model alias [default: haiku]
  --timeout=MS              Per-task timeout [default: 240000]
  --dry-run                 Print planned Claude commands only
`);
}

function readSplitIds(split) {
  if (split === 'all') return null;
  const file = path.join(SPLIT_DIR, `${split}.json`);
  return JSON.parse(readFileSync(file, 'utf8')).ids;
}

function buildPrompt(task) {
  return [
    'Structural code-understanding task.',
    '',
    `Question: ${task.question}`,
    '',
    `Primary symbol: ${task.symbol}`,
    '',
    'Constraints:',
    '- Do not edit files.',
    '- Cite file paths and line ranges.',
    '- End with the strict JSON answer block required by the system prompt.',
  ].join('\n');
}

function avg(rows, f) {
  return rows.length ? rows.reduce((acc, r) => acc + f(r), 0) / rows.length : 0;
}

function isAggregateOnlySplit(split) {
  return split !== 'dev' && split !== 'fresh';
}

export function buildStructuralArtifact({ opts, tasks, runs, summaries }) {
  const aggregateOnly = isAggregateOnlySplit(opts.split);
  return {
    bench: 'structural-context',
    split: opts.split,
    model: opts.model,
    conditions: opts.conditions,
    taskCount: tasks.length,
    tasks: aggregateOnly ? undefined : tasks.map(t => t.id),
    summaries,
    heldoutPolicy: aggregateOnly
      ? 'Per-task details redacted; heldout/all artifacts are aggregate-only.'
      : undefined,
    runs: aggregateOnly ? undefined : runs,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const splitIds = readSplitIds(opts.split);
  let tasks = loadStructuralTasks({
    splitIds,
    repos: opts.repo ? [opts.repo] : null,
  });
  if (opts.maxTasks) tasks = tasks.slice(0, opts.maxTasks);
  if (!tasks.length) throw new Error('no structural-context tasks selected');

  const benchDir = path.join(REPO_ROOT, '.sweet-search', 'benchmarks');
  if (!existsSync(benchDir)) mkdirSync(benchDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = path.join(benchDir, `structural-context-${opts.split}-${stamp}.json`);

  process.stdout.write(`Structural context bench\n`);
  process.stdout.write(`  split:      ${opts.split}\n`);
  process.stdout.write(`  tasks:      ${tasks.length}\n`);
  process.stdout.write(`  conditions: ${opts.conditions.join(', ')}\n`);
  process.stdout.write(`  model:      ${opts.model}\n`);
  process.stdout.write(`  artifact:   ${path.relative(REPO_ROOT, artifactPath)}\n\n`);

  const runs = [];
  const aggregateOnly = isAggregateOnlySplit(opts.split);
  let idx = 0;
  for (const task of tasks) {
    const layout = verifyRepoLayout(task.repo);
    for (const condition of opts.conditions) {
      idx++;
      const args = buildClaudeArgs({
        prompt: buildPrompt(task),
        systemAppend: POLICIES[condition],
        model: opts.model,
        allowedTools: TOOL_RULES[condition].allowedTools,
        disallowedTools: TOOL_RULES[condition].disallowedTools,
        addDirs: [REPO_ROOT],
      });
      if (opts.dryRun) {
        const dryLabel = aggregateOnly
          ? `[DRY] task ${idx}/${tasks.length * opts.conditions.length} | ${condition}\n`
          : `[DRY] ${task.id} | ${condition}\n`;
        process.stdout.write(dryLabel);
        if (!aggregateOnly) process.stdout.write(`  cwd: ${layout.repoDir}\n`);
        process.stdout.write(`  claude ${args.map(a => a.length > 60 ? `<${a.length}c>` : a).join(' ')}\n`);
        continue;
      }

      const label = aggregateOnly
        ? `[${idx}/${tasks.length * opts.conditions.length}] ${condition} ... `
        : `[${idx}/${tasks.length * opts.conditions.length}] ${task.id} | ${condition} ... `;
      process.stdout.write(label);
      const run = await runClaudeAgent({
        prompt: buildPrompt(task),
        systemAppend: POLICIES[condition],
        model: opts.model,
        cwd: layout.repoDir,
        projectRoot: layout.repoDir,
        allowedTools: TOOL_RULES[condition].allowedTools,
        disallowedTools: TOOL_RULES[condition].disallowedTools,
        addDirs: [REPO_ROOT],
        extraPathEntries: condition === 'sweet-search-structural'
          ? [STRUCTURAL_BIN_DIR, BENCH_BIN_DIR]
          : [BENCH_BIN_DIR],
        timeoutMs: opts.timeoutMs,
        maxAttempts: 2,
      });
      const summary = summariseRun(run);
      const audit = auditRun(condition, run);
      const score = scoreAnswer(task, summary.answer);
      runs.push({
        taskId: task.id,
        repo: task.repo,
        split: opts.split,
        condition,
        run: {
          wallMs: summary.wallMs,
          exitCode: summary.exitCode,
          timedOut: summary.timedOut,
          attempts: summary.attempts,
          retryCount: summary.retryCount,
          toolCallCount: summary.toolCallCount,
          approxToolOutputTokens: summary.approxToolOutputTokens,
          traceAggregate: summary.traceAggregate,
          toolTracePreview: formatToolTrace(run, 10),
        },
        answer: summary.answer,
        score,
        audit,
      });
      if (aggregateOnly) process.stdout.write('done\n');
      else process.stdout.write(`tools=${summary.toolCallCount} fileR=${score.fileRecall.toFixed(2)} factR=${score.factRecall.toFixed(2)} viol=${audit.violationCount}\n`);
    }
  }

  if (opts.dryRun) return;
  const byCondition = {};
  for (const condition of opts.conditions) {
    const rows = runs.filter(r => r.condition === condition);
    byCondition[condition] = {
      n: rows.length,
      avgToolCalls: avg(rows, r => r.run.toolCallCount),
      avgApproxToolOutputTokens: avg(rows, r => r.run.approxToolOutputTokens),
      avgFileRecall: avg(rows, r => r.score.fileRecall),
      avgSymbolRecall: avg(rows, r => r.score.symbolRecall),
      avgFactRecall: avg(rows, r => r.score.factRecall),
      violationCount: rows.reduce((acc, r) => acc + r.audit.violationCount, 0),
      traceCallCount: rows.reduce((acc, r) => acc + (r.run.traceAggregate?.callCount || 0), 0),
      retryCount: rows.reduce((acc, r) => acc + (r.run.retryCount || 0), 0),
    };
  }
  const artifact = buildStructuralArtifact({ opts, tasks, runs, summaries: byCondition });
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  process.stdout.write(`\nWrote ${path.relative(REPO_ROOT, artifactPath)}\n`);
  process.stdout.write(JSON.stringify(byCondition, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    process.stderr.write(`[structural-context bench] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
