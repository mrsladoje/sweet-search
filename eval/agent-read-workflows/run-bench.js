#!/usr/bin/env node
//
// Agent-in-the-Loop Read-Workflows Benchmark
// ------------------------------------------
// Spawns Claude Code in headless mode (`claude -p --output-format stream-json
// --model haiku`) for each (task × mode × iter), captures the full event
// stream, audits tool usage against the mode's policy, scores answers
// deterministically, then runs a blind A/B judge for qualitative comparison.
//
// Usage:
//   npm run bench:agent-read-workflows -- --repo=fastify --max-tasks=5
//   npm run bench:agent-read-workflows -- --repo=gin --task=engine-struct
//   npm run bench:agent-read-workflows -- --all --max-tasks=3
//   npm run bench:agent-read-workflows -- --repo=fastify --dry-run
//
// See README.md for option details and interpretation guidance.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { POLICIES, MODE_ORDER, TOOL_RULES } from './policies.js';
import { loadTasks, summarizeTasks, listRepos } from './tasks.js';
import { runClaudeAgent, summariseRun, formatToolTrace, buildClaudeArgs } from './claude-runner.js';
import { auditRun } from './audit.js';
import { scoreAnswer } from './metrics.js';
import { judgePair } from './judge.js';
import {
  loadManifest, getRepoSpec, verifyRepoLayout, REPOS_DIR,
} from '../read-workflows/setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ── argv ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    repo: null, all: false,
    iters: 1, maxTasks: 5, seed: 42,
    model: 'haiku', judgeModel: 'haiku',
    onlyTask: null, onlyMode: null,
    dryRun: false, keepLogs: false,
    skipJudge: false,
    timeoutMs: 240000,
  };
  for (const arg of argv) {
    if (arg.startsWith('--repo=')) opts.repo = arg.split('=')[1];
    else if (arg === '--all') opts.all = true;
    else if (arg.startsWith('--iters=')) opts.iters = +arg.split('=')[1];
    else if (arg.startsWith('--max-tasks=')) opts.maxTasks = +arg.split('=')[1];
    else if (arg.startsWith('--seed=')) opts.seed = +arg.split('=')[1];
    else if (arg.startsWith('--model=')) opts.model = arg.split('=')[1];
    else if (arg.startsWith('--judge-model=')) opts.judgeModel = arg.split('=')[1];
    else if (arg.startsWith('--task=')) opts.onlyTask = arg.split('=')[1];
    else if (arg.startsWith('--mode=')) opts.onlyMode = arg.split('=')[1];
    else if (arg.startsWith('--timeout=')) opts.timeoutMs = +arg.split('=')[1];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--keep-logs') opts.keepLogs = true;
    else if (arg === '--skip-judge') opts.skipJudge = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`Agent-in-the-Loop Read-Workflows Benchmark

Usage:
  npm run bench:agent-read-workflows -- --repo=<fastify|gin|flask|ripgrep>
  npm run bench:agent-read-workflows -- --all
  node eval/agent-read-workflows/run-bench.js --repo=fastify --max-tasks=3

Options:
  --repo=NAME        Pinned repo under eval/repos/<NAME>
  --all              Loop over all four repos (one subprocess each)
  --max-tasks=N      Cap tasks per repo                            [default: 5]
  --iters=N          Iterations per (task,mode)                    [default: 1]
  --seed=N           RNG seed for task order + judge order         [default: 42]
  --model=NAME       Worker Claude model alias or id               [default: haiku]
  --judge-model=NAME Judge model                                   [default: haiku]
  --task=ID          Run a single task (matches by id or :suffix)
  --mode=NAME        Run a single mode
  --timeout=MS       Per-run wall-clock cap                        [default: 240000]
  --dry-run          Print planned commands; do not spawn Claude
  --keep-logs        Persist raw stream-json transcripts to artifact dir
  --skip-judge       Skip the blind A/B judge step
`);
}

// ── deterministic RNG ───────────────────────────────────────────────────────

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
  const out = [...arr]; const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── prompt builder ──────────────────────────────────────────────────────────

function buildTaskPrompt(task) {
  return [
    `Repo-understanding task.`,
    ``,
    `Question:`,
    task.question,
    ``,
    `Constraints:`,
    `- Stay focused. Do not edit files.`,
    `- Cite file paths and line ranges (path:start-end).`,
    `- Aim to finish in ${task.maxTurns ?? 12} or fewer tool calls.`,
    `- End your response with a single fenced JSON block in the schema described in the system prompt.`,
  ].join('\n');
}

function pickAddDirs() {
  // Allow tool access to the parent project so the sweet-search shim (which
  // execs node on core/cli.js) can be resolved. Native mode doesn't read
  // anything from here per its own policy; that's enforced via audit.
  return [REPO_ROOT];
}

const BENCH_BIN_DIR = path.join(__dirname, 'bin');

// ── helpers ─────────────────────────────────────────────────────────────────

function pct(x) { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a'; }
function num(x) { return Number.isFinite(x) ? x.toFixed(1) : 'n/a'; }
function avg(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function percentile(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// ── single repo run (dedicated process owns the repo) ───────────────────────

async function runOneRepo(opts) {
  const repo = opts.repo;
  const layout = verifyRepoLayout(repo);
  const spec = getRepoSpec(repo);

  let tasks = loadTasks(repo, { maxTasks: opts.maxTasks, onlyId: opts.onlyTask });
  tasks = shuffle(tasks, opts.seed);
  const modes = opts.onlyMode ? [opts.onlyMode] : MODE_ORDER;
  const taskSummary = summarizeTasks(tasks);

  const benchDir = path.join(REPO_ROOT, '.sweet-search', 'benchmarks');
  if (!existsSync(benchDir)) mkdirSync(benchDir, { recursive: true });
  const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = path.join(benchDir, `agent-read-workflows-${repo}-${safeTs}.json`);
  const logsDir = path.join(benchDir, `agent-read-workflows-${repo}-${safeTs}-logs`);
  if (opts.keepLogs) mkdirSync(logsDir, { recursive: true });

  process.stdout.write(`Agent-in-the-loop bench — repo "${repo}"\n`);
  process.stdout.write(`  repo dir:      ${layout.repoDir}\n`);
  process.stdout.write(`  pinned SHA:    ${spec.sha.slice(0, 8)}\n`);
  process.stdout.write(`  fingerprint:   ${layout.fingerprint}\n`);
  process.stdout.write(`  hasLi:         ${layout.hasLi}\n`);
  process.stdout.write(`  tasks:         ${taskSummary.count} (${JSON.stringify(taskSummary.byType)})\n`);
  process.stdout.write(`  modes:         ${modes.join(', ')}\n`);
  process.stdout.write(`  worker model:  ${opts.model}\n`);
  process.stdout.write(`  judge model:   ${opts.skipJudge ? '(skipped)' : opts.judgeModel}\n`);
  process.stdout.write(`  iters:         ${opts.iters}\n`);
  process.stdout.write(`  artifact:      ${path.relative(REPO_ROOT, artifactPath)}\n`);
  process.stdout.write('\n');

  // Dry run: print the commands and stop.
  if (opts.dryRun) {
    for (const task of tasks) {
      for (const mode of modes) {
        const args = buildClaudeArgs({
          prompt: buildTaskPrompt(task),
          systemAppend: POLICIES[mode],
          model: opts.model,
          allowedTools: TOOL_RULES[mode].allowedTools,
          disallowedTools: TOOL_RULES[mode].disallowedTools,
          addDirs: pickAddDirs(),
        });
        process.stdout.write(`[DRY] ${task.id} | ${mode}\n`);
        process.stdout.write(`  cwd: ${layout.repoDir}\n`);
        process.stdout.write(`  cmd: claude ${args.map(a => a.includes(' ') || a.startsWith('You ') ? `"<${a.length}c>"` : a).join(' ')}\n\n`);
      }
    }
    return artifactPath;
  }

  // ── measured runs ─────────────────────────────────────────────────────────
  const allRuns = [];
  let runIdx = 0;
  const totalRuns = tasks.length * modes.length * opts.iters;
  for (let iter = 0; iter < opts.iters; iter++) {
    for (const task of tasks) {
      for (const mode of modes) {
        runIdx++;
        process.stdout.write(`[${runIdx}/${totalRuns}] ${task.id} | ${mode} | iter ${iter} ... `);
        const t0 = Date.now();
        const logPath = opts.keepLogs ? path.join(logsDir, `${task.id.replace(/[/:]/g, '_')}__${mode}__iter${iter}.ndjson`) : null;
        const run = await runClaudeAgent({
          prompt: buildTaskPrompt(task),
          systemAppend: POLICIES[mode],
          model: opts.model,
          cwd: layout.repoDir,
          allowedTools: TOOL_RULES[mode].allowedTools,
          disallowedTools: TOOL_RULES[mode].disallowedTools,
          addDirs: pickAddDirs(),
          extraPathEntries: [BENCH_BIN_DIR],
          timeoutMs: opts.timeoutMs,
          logPath,
        });
        const summary = summariseRun(run);
        const audit = auditRun(mode, run);
        const score = scoreAnswer(task, summary.answer);
        process.stdout.write(`${(Date.now() - t0)}ms — turns=${run.toolCalls.length}, tok≈${summary.approxToolOutputTokens + summary.approxAnswerTokens}, fileR=${pct(score.fileRecall)}, factR=${pct(score.factRecall)}, viol=${audit.violationCount}\n`);
        allRuns.push({
          iter, mode, taskId: task.id, taskType: task.taskType, difficulty: task.difficulty,
          run: {
            wallMs: summary.wallMs,
            exitCode: summary.exitCode,
            timedOut: summary.timedOut,
            isError: summary.isError,
            numTurns: summary.numTurns,
            toolCallCount: summary.toolCallCount,
            toolOutputChars: summary.toolOutputChars,
            approxToolOutputTokens: summary.approxToolOutputTokens,
            answerChars: summary.answerChars,
            approxAnswerTokens: summary.approxAnswerTokens,
            usage: summary.usage,
            totalCostUsd: summary.totalCostUsd,
            cmd: run.cmd,
            toolTracePreview: formatToolTrace(run, 12),
            toolCalls: run.toolCalls.map(t => ({
              name: t.name,
              input: t.name === 'Bash' ? { command: t.input?.command } : t.input,
            })),
          },
          answer: summary.answer,
          answerParseError: summary.answerParseError,
          score,
          audit,
        });
      }
    }
  }

  // ── aggregate per (mode, task) — average across iters ────────────────────
  const collapsed = [];
  const taskIds = [...new Set(allRuns.map(r => r.taskId))];
  for (const taskId of taskIds) {
    for (const mode of modes) {
      const rows = allRuns.filter(r => r.taskId === taskId && r.mode === mode);
      if (!rows.length) continue;
      // Take the median run (by wallMs) for representative answer + score.
      const median = [...rows].sort((a, b) => a.run.wallMs - b.run.wallMs)[Math.floor(rows.length / 2)];
      collapsed.push({
        mode, taskId, taskType: rows[0].taskType, difficulty: rows[0].difficulty,
        iterCount: rows.length,
        avgWallMs: avg(rows.map(r => r.run.wallMs)),
        avgToolCalls: avg(rows.map(r => r.run.toolCallCount)),
        avgApproxTotalTokens: avg(rows.map(r => r.run.approxToolOutputTokens + r.run.approxAnswerTokens)),
        avgUsageInputTokens: avg(rows.map(r => r.run.usage?.input_tokens || 0)),
        avgUsageOutputTokens: avg(rows.map(r => r.run.usage?.output_tokens || 0)),
        avgCostUsd: avg(rows.map(r => r.run.totalCostUsd || 0)),
        violationCount: median.audit.violationCount,
        score: median.score,
        answer: median.answer,
        answerParseError: median.answerParseError,
        toolTracePreview: median.run.toolTracePreview,
      });
    }
  }

  // ── judge (optional) ─────────────────────────────────────────────────────
  const judgeRng = mulberry32(opts.seed + 0x1234);
  const judgeResults = [];
  if (!opts.skipJudge && modes.length === 2) {
    process.stdout.write('\n--- Judging ---\n');
    for (const taskId of taskIds) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) continue;
      const modeAnswers = {};
      for (const mode of modes) {
        const c = collapsed.find(r => r.taskId === taskId && r.mode === mode);
        if (c) modeAnswers[mode] = c.answer;
      }
      if (Object.keys(modeAnswers).length !== 2) continue;
      try {
        const judged = await judgePair({
          task, modeAnswers,
          judgeModel: opts.judgeModel,
          rng: judgeRng,
          cwd: REPO_ROOT,                    // judge uses no tools, cwd doesn't matter much
          timeoutMs: 120000,
        });
        judgeResults.push({ taskId, ...judged });
        process.stdout.write(`  ${taskId}: preferred=${judged.preferredMode || '?'} (${judged.judgement?.preferred ?? '?'}) cost=$${(judged.runMeta.totalCostUsd ?? 0).toFixed(4)}\n`);
      } catch (err) {
        judgeResults.push({ taskId, error: err.message });
      }
    }
  }

  // ── per-mode summary + win attribution ──────────────────────────────────
  const modeSummaries = modes.map(mode => {
    const rows = collapsed.filter(r => r.mode === mode);
    return {
      mode, n: rows.length,
      p50WallMs: percentile(rows.map(r => r.avgWallMs), 0.5),
      p95WallMs: percentile(rows.map(r => r.avgWallMs), 0.95),
      avgWallMs: avg(rows.map(r => r.avgWallMs)),
      avgToolCalls: avg(rows.map(r => r.avgToolCalls)),
      avgApproxTotalTokens: avg(rows.map(r => r.avgApproxTotalTokens)),
      avgUsageInputTokens: avg(rows.map(r => r.avgUsageInputTokens)),
      avgUsageOutputTokens: avg(rows.map(r => r.avgUsageOutputTokens)),
      avgCostUsd: avg(rows.map(r => r.avgCostUsd)),
      avgFileRecall: avg(rows.map(r => r.score.fileRecall)),
      avgFilePrecision: avg(rows.map(r => r.score.filePrecision)),
      avgSymbolRecall: avg(rows.map(r => r.score.symbolRecall)),
      avgFactRecall: avg(rows.map(r => r.score.factRecall)),
      avgLineOverlap: avg(rows.map(r => r.score.lineOverlap).filter(x => Number.isFinite(x))),
      evidenceSuccessRate: (() => {
        const scored = rows.filter(r => r.score.evidenceSuccess !== null);
        if (!scored.length) return null;
        return scored.filter(r => r.score.evidenceSuccess).length / scored.length;
      })(),
      lowPrecisionEvidenceRate: rows.filter(r => r.score.lowPrecisionEvidence).length / Math.max(1, rows.length),
      successRate: rows.filter(r => r.score.answerability === 'full').length / Math.max(1, rows.length),
      partialRate: rows.filter(r => r.score.answerability === 'partial').length / Math.max(1, rows.length),
      failureRate: rows.filter(r => r.score.answerability === 'failure').length / Math.max(1, rows.length),
      violationRunRate: rows.filter(r => r.violationCount > 0).length / Math.max(1, rows.length),
      totalViolations: rows.reduce((acc, r) => acc + r.violationCount, 0),
      parseErrorRate: rows.filter(r => r.answerParseError).length / Math.max(1, rows.length),
    };
  });

  const baseline = modeSummaries.find(m => m.mode === 'native-rg-read') || modeSummaries[0];
  const sweet = modeSummaries.find(m => m.mode === 'sweet-search-tools');

  // judge head-to-head
  let judgeNativeWins = 0, judgeSweetWins = 0, judgeTies = 0;
  for (const j of judgeResults) {
    if (j.preferredMode === 'native-rg-read') judgeNativeWins++;
    else if (j.preferredMode === 'sweet-search-tools') judgeSweetWins++;
    else if (j.preferredMode === 'tie') judgeTies++;
  }

  // deterministic per-task winners (by factRecall, tiebreak fileRecall, tiebreak fewer tokens)
  const detWinners = [];
  for (const taskId of taskIds) {
    const rows = collapsed.filter(r => r.taskId === taskId);
    const ranked = [...rows].sort((a, b) => {
      if (b.score.factRecall !== a.score.factRecall) return b.score.factRecall - a.score.factRecall;
      if (b.score.fileRecall !== a.score.fileRecall) return b.score.fileRecall - a.score.fileRecall;
      return a.avgApproxTotalTokens - b.avgApproxTotalTokens;
    });
    const winner = ranked[0]; const runnerUp = ranked[1];
    let winByOverfetch = false;
    if (winner && runnerUp && winner.score.factRecall > runnerUp.score.factRecall + 0.01) {
      const tokRatio = winner.avgApproxTotalTokens / Math.max(1, runnerUp.avgApproxTotalTokens);
      if (tokRatio > 2 && winner.score.factRecall - runnerUp.score.factRecall < 0.25) winByOverfetch = true;
    }
    detWinners.push({ taskId, taskType: rows[0].taskType, difficulty: rows[0].difficulty,
      winner: winner?.mode, runnerUp: runnerUp?.mode, winByOverfetch,
      factRecall: winner?.score.factRecall, tokens: winner?.avgApproxTotalTokens });
  }

  // ── console summary ─────────────────────────────────────────────────────
  process.stdout.write(`\n=== Agent-in-the-loop summary — ${repo} ===\n`);
  for (const m of modeSummaries) {
    const baseTok = baseline?.avgApproxTotalTokens || 0;
    const tokenDelta = baseTok > 0 ? ((baseTok - m.avgApproxTotalTokens) / baseTok) * 100 : 0;
    process.stdout.write(`[${m.mode}]\n`);
    process.stdout.write(`  wall p50/p95:     ${num(m.p50WallMs)} / ${num(m.p95WallMs)} ms\n`);
    process.stdout.write(`  avg tool calls:   ${m.avgToolCalls.toFixed(1)}\n`);
    process.stdout.write(`  avg ~tokens:      ${m.avgApproxTotalTokens.toFixed(0)}` +
      (m.mode !== baseline?.mode && baseTok > 0 ? `  (savings vs ${baseline.mode}: ${tokenDelta >= 0 ? '+' : ''}${tokenDelta.toFixed(1)}%)` : '') + '\n');
    process.stdout.write(`  Claude usage in/out: ${m.avgUsageInputTokens.toFixed(0)} / ${m.avgUsageOutputTokens.toFixed(0)} tokens\n`);
    process.stdout.write(`  avg cost:         $${m.avgCostUsd.toFixed(4)}\n`);
    process.stdout.write(`  file recall:      ${pct(m.avgFileRecall)}\n`);
    process.stdout.write(`  file precision:   ${pct(m.avgFilePrecision)}\n`);
    process.stdout.write(`  symbol recall:    ${pct(m.avgSymbolRecall)}\n`);
    process.stdout.write(`  fact recall:      ${pct(m.avgFactRecall)}\n`);
    process.stdout.write(`  evidence success (lineOverlap≥0.3): ${m.evidenceSuccessRate === null ? 'n/a' : pct(m.evidenceSuccessRate)}\n`);
    process.stdout.write(`  low-precision evidence rate:        ${pct(m.lowPrecisionEvidenceRate)}\n`);
    process.stdout.write(`  success/partial/failure: ${pct(m.successRate)} / ${pct(m.partialRate)} / ${pct(m.failureRate)}\n`);
    process.stdout.write(`  policy violations: ${m.totalViolations} (in ${pct(m.violationRunRate)} of runs)\n`);
    process.stdout.write(`  answer parse errors: ${pct(m.parseErrorRate)}\n\n`);
  }

  if (sweet && baseline && baseline.mode !== sweet.mode) {
    const tokSav = ((baseline.avgApproxTotalTokens - sweet.avgApproxTotalTokens) / Math.max(1, baseline.avgApproxTotalTokens)) * 100;
    const latDelta = sweet.avgWallMs - baseline.avgWallMs;
    process.stdout.write(`Head-to-head (sweet vs native):\n`);
    process.stdout.write(`  Sweet token savings:  ${tokSav.toFixed(1)}%\n`);
    process.stdout.write(`  Sweet latency delta:  ${latDelta >= 0 ? '+' : ''}${latDelta.toFixed(0)} ms\n`);
    process.stdout.write(`  Sweet fact recall:    ${pct(sweet.avgFactRecall)} vs native ${pct(baseline.avgFactRecall)}\n`);
  }

  if (judgeResults.length) {
    process.stdout.write(`\nJudge (${opts.judgeModel}) head-to-head:\n`);
    process.stdout.write(`  sweet wins:  ${judgeSweetWins}/${judgeResults.length}\n`);
    process.stdout.write(`  native wins: ${judgeNativeWins}/${judgeResults.length}\n`);
    process.stdout.write(`  ties:        ${judgeTies}/${judgeResults.length}\n`);
  }

  process.stdout.write(`\nDeterministic per-task winners:\n`);
  for (const w of detWinners) {
    process.stdout.write(`  ${w.taskId.padEnd(40)} ${(w.winner || '?').padEnd(22)} vs ${(w.runnerUp || '?').padEnd(22)} factR=${pct(w.factRecall)} ${w.winByOverfetch ? '⚠ by-overfetch' : ''}\n`);
  }

  // ── artifact ────────────────────────────────────────────────────────────
  const artifact = {
    schemaVersion: 1,
    benchmark: 'agent-read-workflows',
    timestamp: new Date().toISOString(),
    repo,
    pinnedSha: spec.sha,
    upstreamUrl: spec.url,
    fingerprint: layout.fingerprint,
    layout: { repoDir: layout.repoDir, hasLi: layout.hasLi, hasSparseGram: layout.hasSparseGram },
    cliVersion: spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout?.trim() || null,
    opts,
    workerModel: opts.model,
    judgeModel: opts.skipJudge ? null : opts.judgeModel,
    policies: POLICIES,
    toolRules: TOOL_RULES,
    taskSummary,
    cmdTemplate: 'claude -p <prompt> --model <model> --output-format stream-json --verbose --no-session-persistence --dangerously-skip-permissions --append-system-prompt <policy> --allowed-tools "..." --disallowed-tools "..." --add-dir <repo-root>',
    modeSummaries,
    perTask: collapsed,
    rawRuns: allRuns,
    judgeResults,
    detWinners,
    judgeAggregate: { judgeNativeWins, judgeSweetWins, judgeTies, n: judgeResults.length },
    caveats: [
      'This benchmark uses Claude Code itself; results include model variance.',
      'Worker model defaults to haiku for cost; behaviour may differ on opus/sonnet.',
      'Tool restrictions are enforced via --allowed-tools AND post-hoc audit. Violations are flagged, not blocked at the model layer.',
      'Judge scores are advisory; deterministic metrics (file/fact/symbol recall) are primary.',
      'Sweet mode requires the sweet-search CLI on $PATH (npm-linked or via npx) AND a valid index in <repo>/.sweet-search/. Run eval/scripts/fetch-benchmark-repos.js first.',
    ],
  };

  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  process.stdout.write(`\nJSON artifact: ${path.relative(REPO_ROOT, artifactPath)}\n`);
  if (opts.keepLogs) process.stdout.write(`Raw logs:      ${path.relative(REPO_ROOT, logsDir)}\n`);
  return artifactPath;
}

// ── multi-repo subprocess fanout ────────────────────────────────────────────

function runAllReposViaSubprocess(opts) {
  const repos = listRepos();
  const passthrough = process.argv.slice(2).filter(a => a !== '--all' && !a.startsWith('--repo='));
  for (const repo of repos) {
    process.stdout.write(`\n──────────── ${repo} ────────────\n`);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-bench.js'), `--repo=${repo}`, ...passthrough], { stdio: 'inherit' });
    if (r.status !== 0) process.stderr.write(`[${repo}] subprocess exit ${r.status}\n`);
  }
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Reference loadManifest so a corrupt manifest fails fast.
  loadManifest();
  if (opts.all) { runAllReposViaSubprocess(opts); return; }
  if (!opts.repo) { process.stderr.write('Specify --repo=<name> or --all.\n'); printHelp(); process.exit(2); }
  await runOneRepo(opts);
}

main().catch(err => { process.stderr.write(`bench failed: ${err.stack || err.message || err}\n`); process.exit(1); });
