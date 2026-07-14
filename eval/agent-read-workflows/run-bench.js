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

import { POLICIES, MODE_ORDER, TOOL_RULES, SWEET_CONDITIONS } from './policies.js';
import { loadTasks, summarizeTasks, listRepos } from './tasks.js';
import { runClaudeAgent, summariseRun, formatToolTrace, buildClaudeArgs } from './claude-runner.js';
import { auditRun } from './audit.js';
import { scoreAnswer } from './metrics.js';
import { judgePair } from './judge.js';
import { tallyJudgeWins } from './judge-tally.js';
import { parseRouteMetadata } from '../../core/search/search-format.js';
import {
  loadManifest, getRepoSpec, verifyRepoLayout, REPOS_DIR,
} from '../read-workflows/setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ── argv ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    repo: null, all: false, repos: null,
    iters: 1, maxTasks: 5, seed: 42,
    model: 'haiku', judgeModel: 'haiku',
    onlyTask: null, onlyMode: null,
    conditions: null,            // null → use MODE_ORDER (or filter via --mode for back-compat)
    warmup: null,                // null → auto: enable when any condition is sweet
    dryRun: false, keepLogs: false,
    skipJudge: false,
    timeoutMs: 240000,
  };
  for (const arg of argv) {
    if (arg.startsWith('--repo=')) opts.repo = arg.split('=')[1];
    else if (arg.startsWith('--repos=')) opts.repos = arg.split('=')[1].split(',').filter(Boolean);
    else if (arg === '--all') opts.all = true;
    else if (arg.startsWith('--iters=')) opts.iters = +arg.split('=')[1];
    else if (arg.startsWith('--max-tasks=')) opts.maxTasks = +arg.split('=')[1];
    else if (arg.startsWith('--seed=')) opts.seed = +arg.split('=')[1];
    else if (arg.startsWith('--model=')) opts.model = arg.split('=')[1];
    else if (arg.startsWith('--judge-model=')) opts.judgeModel = arg.split('=')[1];
    else if (arg.startsWith('--task=')) opts.onlyTask = arg.split('=')[1];
    else if (arg.startsWith('--mode=')) opts.onlyMode = arg.split('=')[1];
    else if (arg.startsWith('--condition=')) opts.conditions = arg.split('=')[1].split(',').filter(Boolean);
    else if (arg.startsWith('--conditions=')) opts.conditions = arg.split('=')[1].split(',').filter(Boolean);
    else if (arg.startsWith('--timeout=')) opts.timeoutMs = +arg.split('=')[1];
    else if (arg === '--warmup') opts.warmup = true;
    else if (arg === '--no-warmup') opts.warmup = false;
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
  npm run bench:agent-read-workflows -- --repos=fastify,gin,ripgrep
  npm run bench:agent-read-workflows -- --all
  node eval/agent-read-workflows/run-bench.js --repo=fastify --max-tasks=3

Options:
  --repo=NAME        Pinned repo under eval/repos/<NAME>
  --repos=A,B,C      Multi-repo fan-out (one subprocess per repo)
  --all              Loop over all repos in tasks.js
  --max-tasks=N      Cap tasks per repo                            [default: 5]
  --iters=N          Iterations per (task,mode)                    [default: 1]
  --seed=N           RNG seed for task order + judge order         [default: 42]
  --model=NAME       Worker Claude model alias or id               [default: haiku]
  --judge-model=NAME Judge model                                   [default: haiku]
  --task=ID          Run a single task (matches by id or :suffix)
  --mode=NAME        Run a single mode (back-compat for --condition=NAME)
  --condition=A,B    Filter conditions to run (CSV)
                     Choices: native-rg-read, sweet-search-tools, sweet-search-auto
  --warmup           Force warmup phase ON  (default: auto-on when any sweet condition)
  --no-warmup        Force warmup phase OFF
  --timeout=MS       Per-run wall-clock cap                        [default: 240000]
  --dry-run          Print planned commands; do not spawn Claude
  --keep-logs        Persist raw stream-json transcripts to artifact dir
  --skip-judge       Skip the blind A/B judge step

Conditions:
  native-rg-read       Baseline: rg + native Read tool
  sweet-search-tools   Existing colgrep/indexed-grep regression baseline
  sweet-search-auto    NEW: main sweet-search auto/CatBoost search with
                       token-budgeted agent packaging (ss-search wrapper)
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

function runWarmupCommand(cmd, { cwd, env, timeout = 90000, requireRouteMeta = false, expectedProjectRoot = null }) {
  const subT0 = Date.now();
  // Warmup is a non-agent diagnostic. Request the complete marker here so the
  // fail-closed gate can compare canonical roots without charging agent context.
  const childEnv = requireRouteMeta
    ? { ...env, SWEET_SEARCH_ROUTE_META_DEBUG: '1' }
    : env;
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd, env: childEnv, encoding: 'utf8', timeout,
  });
  const subMs = Date.now() - subT0;
  const routeMeta = parseRouteMetadata(r.stdout || '');
  // Repo identity gate. Refuses to call the warmup ok if:
  //   1. exit code non-zero
  //   2. requireRouteMeta but no trailer / serverUsed not true
  //   3. expectedProjectRoot set but routeMeta.repoMatches=false or
  //      routeMeta.serverProjectRoot doesn't match
  let ok = r.status === 0;
  let isolationFailure = null;
  if (ok && requireRouteMeta) {
    if (!routeMeta || routeMeta.serverUsed !== true) {
      ok = false;
      isolationFailure = 'missing-route-meta-or-server-not-used';
    }
  }
  if (ok && expectedProjectRoot != null) {
    // Use the file-scope `path` import (this module is ESM; require is undefined).
    const expected = path.resolve(expectedProjectRoot);
    const got = routeMeta?.serverProjectRoot ? path.resolve(routeMeta.serverProjectRoot) : null;
    const repoMatches = routeMeta?.repoMatches === true && got === expected;
    if (!repoMatches) {
      ok = false;
      isolationFailure = `repo-isolation-mismatch: expected=${expected} got=${got ?? '<null>'}`;
    }
  }
  return {
    cmd: cmd.join(' '),
    exitCode: r.status,
    ms: subMs,
    ok,
    routeMeta: routeMeta || undefined,
    isolationFailure,
    stdoutPreview: (r.stdout || '').slice(0, 400),
    stderrPreview: (r.stderr || '').slice(0, 400),
  };
}

// ── single repo run (dedicated process owns the repo) ───────────────────────

async function runOneRepo(opts) {
  const repo = opts.repo;
  const layout = verifyRepoLayout(repo);
  const spec = getRepoSpec(repo);

  let tasks = loadTasks(repo, { maxTasks: opts.maxTasks, onlyId: opts.onlyTask });
  tasks = shuffle(tasks, opts.seed);

  // Mode/condition resolution.
  //   --condition=a,b           → strict filter
  //   --mode=NAME (legacy)      → single-mode filter (back-compat)
  //   neither                   → use MODE_ORDER (all known)
  let modes;
  if (opts.conditions && opts.conditions.length) {
    const unknown = opts.conditions.filter(c => !MODE_ORDER.includes(c));
    if (unknown.length) {
      process.stderr.write(`Unknown condition(s): ${unknown.join(', ')}. Choices: ${MODE_ORDER.join(', ')}\n`);
      process.exit(2);
    }
    modes = opts.conditions;
  } else if (opts.onlyMode) {
    if (!MODE_ORDER.includes(opts.onlyMode)) {
      process.stderr.write(`Unknown mode: ${opts.onlyMode}. Choices: ${MODE_ORDER.join(', ')}\n`);
      process.exit(2);
    }
    modes = [opts.onlyMode];
  } else {
    // Default: native baseline + colgrep regression. The new sweet-search-auto
    // condition is opt-in via --condition until it is benchmark-validated.
    modes = ['native-rg-read', 'sweet-search-tools'];
  }
  const taskSummary = summarizeTasks(tasks);

  // Warmup defaults: auto-on when any selected condition is sweet-flavored,
  // off otherwise. Explicit --warmup / --no-warmup overrides.
  const anySweet = modes.some(m => SWEET_CONDITIONS.has(m));
  const warmupEnabled = opts.warmup === null ? anySweet : opts.warmup;

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
  process.stdout.write(`  warmup:        ${warmupEnabled ? 'on' : 'off'}\n`);
  process.stdout.write(`  artifact:      ${path.relative(REPO_ROOT, artifactPath)}\n`);
  process.stdout.write('\n');

  // ── Warmup phase (sweet conditions only) ───────────────────────────────
  // Excluded from per-task wall time; recorded separately in artifact.
  // Goal: block until the model-backed sweet-search path has completed at
  // least one successful packaged query for THIS REPO before timed Claude
  // workers start. The daemon at /tmp/sweet-search.sock is a global singleton;
  // a multi-repo bench fan-out previously left a stale daemon in place,
  // causing cross-repo contamination (gin agent saw fastify results). The
  // warmup now:
  //   1. Queries /health.
  //   2. If a daemon is running for a different projectRoot, /stop it and
  //      wait for it to exit.
  //   3. Auto-spawns a fresh daemon with SWEET_SEARCH_PROJECT_ROOT set to the
  //      current repo dir (autoSpawnServer inherits env).
  //   4. Validates the new daemon's /health.resolvedProjectRoot matches.
  //   5. Runs ss-search to confirm route-meta serverProjectRoot matches.
  // ALL FAIL CLOSED.
  let warmupRecord = {
    enabled: warmupEnabled,
    status: warmupEnabled ? 'pending' : 'skipped',
    durationMs: 0,
    commands: [],
    daemonIsolation: null,
  };
  if (warmupEnabled && !opts.dryRun) {
    process.stdout.write('Warmup ... ');
    const env = {
      ...process.env,
      PATH: [BENCH_BIN_DIR, process.env.PATH].filter(Boolean).join(':'),
      SWEET_SEARCH_PROJECT_ROOT: layout.repoDir,
    };
    const expectedRoot = path.resolve(layout.repoDir);

    // Step 1-4: ensure daemon serves THIS repo (in-process call so we can
    // pass env via process.env temporarily — autoSpawnServer inherits).
    const prevEnvRoot = process.env.SWEET_SEARCH_PROJECT_ROOT;
    process.env.SWEET_SEARCH_PROJECT_ROOT = expectedRoot;
    let isolation;
    try {
      const { ensureDaemonForProjectRoot } = await import('../../core/search/search-server.js');
      isolation = await ensureDaemonForProjectRoot(expectedRoot, { timeoutMs: 60000 });
    } finally {
      if (prevEnvRoot === undefined) delete process.env.SWEET_SEARCH_PROJECT_ROOT;
      else process.env.SWEET_SEARCH_PROJECT_ROOT = prevEnvRoot;
    }
    warmupRecord.daemonIsolation = {
      ok: isolation.ok,
      action: isolation.action || null,
      reason: isolation.reason || null,
      health: isolation.health ? {
        pid: isolation.health.pid,
        projectRoot: isolation.health.projectRoot,
        resolvedProjectRoot: isolation.health.resolvedProjectRoot,
        status: isolation.health.status,
        warm: isolation.health.warm,
      } : null,
    };
    if (!isolation.ok) {
      warmupRecord.status = 'failed';
      process.stdout.write(`\n[FAIL] daemon repo-isolation: ${isolation.reason || 'unknown'}\n`);
      throw new Error(`warmup failed; daemon does not serve ${expectedRoot} (reason: ${isolation.reason || 'unknown'})`);
    }

    // Step 5: ss-search round-trip to confirm route-meta serverProjectRoot.
    const warmCmds = [];
    if (modes.includes('sweet-search-auto')) {
      // Reordered query — prior order "warmup late interaction rerank signal"
      // triggered a server-side `embedding.slice is not a function` crash.
      warmCmds.push({ cmd: ['ss-search', 'late interaction rerank warmup signal', '--full', '-k', '3'], requireRouteMeta: true });
    }
    if (modes.includes('sweet-search-tools')) {
      warmCmds.push({ cmd: ['ss-find', 'function declaration', '--regex', 'function|fn|def', '-k', '3'], requireRouteMeta: false });
    }
    const t0 = Date.now();
    let allOk = true;
    for (const entry of warmCmds) {
      const result = runWarmupCommand(entry.cmd, {
        cwd: layout.repoDir,
        env,
        requireRouteMeta: entry.requireRouteMeta,
        // ss-search trailer must report serverProjectRoot=expectedRoot
        expectedProjectRoot: entry.cmd[0] === 'ss-search' ? expectedRoot : null,
      });
      allOk = allOk && result.ok;
      warmupRecord.commands.push(result);
    }
    warmupRecord.durationMs = Date.now() - t0;
    warmupRecord.status = allOk ? 'ok' : 'partial';
    process.stdout.write(`${warmupRecord.durationMs}ms (${warmupRecord.status}, daemon=${warmupRecord.daemonIsolation.action})\n\n`);
    if (!allOk) {
      const failed = warmupRecord.commands.filter(c => !c.ok).map(c =>
        `${c.cmd} [exit ${c.exitCode}${c.isolationFailure ? ` ${c.isolationFailure}` : ''}]`
      ).join('; ');
      throw new Error(`warmup failed; refusing to start timed benchmark with cold sweet-search path: ${failed}`);
    }
  }

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
          projectRoot: layout.repoDir,
          allowedTools: TOOL_RULES[mode].allowedTools,
          disallowedTools: TOOL_RULES[mode].disallowedTools,
          addDirs: pickAddDirs(),
          extraPathEntries: [BENCH_BIN_DIR],
          timeoutMs: opts.timeoutMs,
          maxAttempts: 2,
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
            attempts: summary.attempts,
            retryCount: summary.retryCount,
            numTurns: summary.numTurns,
            toolCallCount: summary.toolCallCount,
            toolOutputChars: summary.toolOutputChars,
            approxToolOutputTokens: summary.approxToolOutputTokens,
            answerChars: summary.answerChars,
            approxAnswerTokens: summary.approxAnswerTokens,
            usage: summary.usage,
            totalCostUsd: summary.totalCostUsd,
            // sweet-search-auto telemetry (null for non-sweet conditions).
            // Always-on for sweet-search-auto; the trailer is emitted by ss-search.
            routeAggregate: summary.routeAggregate,
            routeMetas: summary.routeMetas,
            traceAggregate: summary.traceAggregate,
            traceMetas: summary.traceMetas,
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
      // sweet-search-auto telemetry: aggregate routedMode counts across iters
      // (only present for runs that called ss-search)
      const routedModeCounts = {};
      const routeMethodCounts = {};
      const routerLatencySamples_us = [];
      let routeCallCount = 0;
      let routeBudgetSum = 0;
      let routeUsedSum = 0;
      let routeSandwichSum = 0;
      for (const r of rows) {
        const ra = r.run.routeAggregate;
        if (!ra) continue;
        for (const [k, v] of Object.entries(ra.routedModeCounts || {})) {
          routedModeCounts[k] = (routedModeCounts[k] || 0) + v;
        }
        for (const [k, v] of Object.entries(ra.routeMethodCounts || {})) {
          routeMethodCounts[k] = (routeMethodCounts[k] || 0) + v;
        }
        if (Array.isArray(ra.routerLatencySamples_us)) {
          for (const x of ra.routerLatencySamples_us) routerLatencySamples_us.push(x);
        }
        routeCallCount += ra.callCount || 0;
        routeBudgetSum += ra.totalTokenBudget || 0;
        routeUsedSum += ra.totalTokensUsed || 0;
        routeSandwichSum += ra.sandwichCount || 0;
      }
      let routerLatencyP50 = null, routerLatencyP95 = null, routerLatencyP99 = null;
      if (routerLatencySamples_us.length) {
        routerLatencyP50 = percentile(routerLatencySamples_us, 0.50);
        routerLatencyP95 = percentile(routerLatencySamples_us, 0.95);
        routerLatencyP99 = percentile(routerLatencySamples_us, 0.99);
      }
      const routeAggregate = routeCallCount > 0
        ? { routedModeCounts, routeMethodCounts, callCount: routeCallCount,
            avgTokenBudget: routeBudgetSum / routeCallCount,
            avgTokensUsed: routeUsedSum / routeCallCount,
            sandwichCount: routeSandwichSum,
            routerLatencyP50_us: routerLatencyP50,
            routerLatencyP95_us: routerLatencyP95,
            routerLatencyP99_us: routerLatencyP99,
            routerLatencySampleCount: routerLatencySamples_us.length }
        : null;

      collapsed.push({
        mode, taskId, taskType: rows[0].taskType, difficulty: rows[0].difficulty,
        iterCount: rows.length,
        avgWallMs: avg(rows.map(r => r.run.wallMs)),
        avgToolCalls: avg(rows.map(r => r.run.toolCallCount)),
        retryCount: rows.reduce((acc, r) => acc + (r.run.retryCount || 0), 0),
        avgApproxTotalTokens: avg(rows.map(r => r.run.approxToolOutputTokens + r.run.approxAnswerTokens)),
        avgUsageInputTokens: avg(rows.map(r => r.run.usage?.input_tokens || 0)),
        avgUsageOutputTokens: avg(rows.map(r => r.run.usage?.output_tokens || 0)),
        avgCostUsd: avg(rows.map(r => r.run.totalCostUsd || 0)),
        violationCount: median.audit.violationCount,
        score: median.score,
        answer: median.answer,
        answerParseError: median.answerParseError,
        toolTracePreview: median.run.toolTracePreview,
        routeAggregate,
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
    // Route + sufficiency aggregates (only meaningful for sweet conditions
    // that emit <<SS_ROUTE_META>>). For native they stay null.
    const aggRouteCalls = rows.reduce((acc, r) => acc + (r.routeAggregate?.callCount || 0), 0);
    const aggRoutedModeCounts = {};
    const aggRouteMethodCounts = {};
    let aggSufficientCount = 0;
    let aggBudgetSum = 0, aggUsedSum = 0;
    for (const r of rows) {
      const ra = r.routeAggregate;
      if (!ra) continue;
      for (const [k, v] of Object.entries(ra.routedModeCounts || {})) {
        aggRoutedModeCounts[k] = (aggRoutedModeCounts[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(ra.routeMethodCounts || {})) {
        aggRouteMethodCounts[k] = (aggRouteMethodCounts[k] || 0) + v;
      }
      aggBudgetSum += (ra.avgTokenBudget || 0) * (ra.callCount || 0);
      aggUsedSum += (ra.avgTokensUsed || 0) * (ra.callCount || 0);
    }
    // Sufficient counts come from each median run's parsed routeMetas
    // (sufficient is a per-call signal). Fall back to 0 when missing.
    for (const r of rows) {
      // routeMetas isn't stored on collapsed; reach back through allRuns medians.
      const allForRow = allRuns.filter(x => x.mode === mode && x.taskId === r.taskId);
      for (const ar of allForRow) {
        for (const m of (ar.run.routeMetas || [])) {
          if (m.sufficient === true) aggSufficientCount++;
        }
      }
    }
    const sweetMulticallCount = rows.filter(r => (r.routeAggregate?.callCount || 0) > 1).length;
    return {
      mode, n: rows.length,
      p50WallMs: percentile(rows.map(r => r.avgWallMs), 0.5),
      p95WallMs: percentile(rows.map(r => r.avgWallMs), 0.95),
      avgWallMs: avg(rows.map(r => r.avgWallMs)),
      avgToolCalls: avg(rows.map(r => r.avgToolCalls)),
      retryCount: rows.reduce((acc, r) => acc + (r.retryCount || 0), 0),
      avgApproxTotalTokens: avg(rows.map(r => r.avgApproxTotalTokens)),
      avgUsageInputTokens: avg(rows.map(r => r.avgUsageInputTokens)),
      avgUsageOutputTokens: avg(rows.map(r => r.avgUsageOutputTokens)),
      avgCostUsd: avg(rows.map(r => r.avgCostUsd)),
      // Route attribution surfaces (null/empty for native)
      ssCallCount: aggRouteCalls,
      ssMulticallTaskCount: sweetMulticallCount,
      ssSufficientCount: aggSufficientCount,
      ssRoutedModeCounts: Object.keys(aggRoutedModeCounts).length ? aggRoutedModeCounts : null,
      ssRouteMethodCounts: Object.keys(aggRouteMethodCounts).length ? aggRouteMethodCounts : null,
      ssAvgTokenBudget: aggRouteCalls ? aggBudgetSum / aggRouteCalls : null,
      ssAvgTokensUsed: aggRouteCalls ? aggUsedSum / aggRouteCalls : null,
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
  // Sweet head-to-head: pick whichever sweet condition was actually under test.
  // Earlier code hard-coded `sweet-search-tools`, so when the run compared
  // `sweet-search-auto` vs native the head-to-head printout AND the
  // judgeAggregate counters silently dropped every sweet win to zero.
  // Now: any non-baseline sweet condition counts.
  const sweet = modeSummaries.find(m => m.mode !== baseline?.mode && SWEET_CONDITIONS.has(m.mode))
    || modeSummaries.find(m => m.mode !== baseline?.mode);
  const sweetMode = sweet?.mode || null;

  // judge head-to-head — delegated to pure helper so it's testable in isolation
  const { judgeNativeWins, judgeSweetWins, judgeTies } =
    tallyJudgeWins(judgeResults, baseline?.mode || 'native-rg-read');

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
    process.stdout.write(`  answer parse errors: ${pct(m.parseErrorRate)}\n`);
    if (m.ssCallCount > 0) {
      const fmtCounts = (obj) => Object.entries(obj || {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      process.stdout.write(`  ss-search calls:    ${m.ssCallCount} (${m.ssMulticallTaskCount} multi-call task(s), ${m.ssSufficientCount} sufficient=YES)\n`);
      process.stdout.write(`  ss routedMode:      ${fmtCounts(m.ssRoutedModeCounts)}\n`);
      process.stdout.write(`  ss routeMethod:     ${fmtCounts(m.ssRouteMethodCounts)}\n`);
      if (m.ssAvgTokensUsed != null) {
        process.stdout.write(`  ss budget/used:     ${(m.ssAvgTokenBudget || 0).toFixed(0)} / ${(m.ssAvgTokensUsed || 0).toFixed(0)} avg\n`);
      }
    }
    process.stdout.write('\n');
  }

  if (sweet && baseline && baseline.mode !== sweet.mode) {
    const tokSav = ((baseline.avgApproxTotalTokens - sweet.avgApproxTotalTokens) / Math.max(1, baseline.avgApproxTotalTokens)) * 100;
    const latDelta = sweet.avgWallMs - baseline.avgWallMs;
    process.stdout.write(`Head-to-head (${sweet.mode} vs ${baseline.mode}):\n`);
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
    warmup: warmupRecord,
    modeSummaries,
    perTask: collapsed,
    rawRuns: allRuns,
    judgeResults,
    detWinners,
    judgeAggregate: {
      baselineMode: baseline?.mode || null,
      sweetMode,
      judgeNativeWins, judgeSweetWins, judgeTies, n: judgeResults.length,
    },
    caveats: [
      'This benchmark uses Claude Code itself; results include model variance.',
      'Worker model defaults to haiku for cost; behaviour may differ on opus/sonnet.',
      'Tool restrictions are enforced via --allowed-tools AND post-hoc audit. Violations are flagged, not blocked at the model layer.',
      'Judge scores are advisory; deterministic metrics (file/fact/symbol recall) are primary.',
      'Sweet mode requires the sweet-search CLI on $PATH (npm-linked or via npx) AND a valid index in <repo>/.sweet-search/. Run eval/scripts/fetch-benchmark-repos.js first.',
      'Per-task wallMs EXCLUDES warmup time. Warmup duration recorded separately under `warmup.durationMs`.',
    ],
  };

  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  process.stdout.write(`\nJSON artifact: ${path.relative(REPO_ROOT, artifactPath)}\n`);
  if (opts.keepLogs) process.stdout.write(`Raw logs:      ${path.relative(REPO_ROOT, logsDir)}\n`);
  return artifactPath;
}

// ── multi-repo subprocess fanout ────────────────────────────────────────────

function runReposViaSubprocess(opts, repos) {
  const passthrough = process.argv.slice(2).filter(a =>
    a !== '--all' && !a.startsWith('--repo=') && !a.startsWith('--repos='));
  for (const repo of repos) {
    process.stdout.write(`\n──────────── ${repo} ────────────\n`);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'run-bench.js'), `--repo=${repo}`, ...passthrough], { stdio: 'inherit' });
    if (r.status !== 0) process.stderr.write(`[${repo}] subprocess exit ${r.status}\n`);
  }
}

function runAllReposViaSubprocess(opts) {
  return runReposViaSubprocess(opts, listRepos());
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // Reference loadManifest so a corrupt manifest fails fast.
  loadManifest();
  if (opts.all) { runAllReposViaSubprocess(opts); return; }
  if (opts.repos && opts.repos.length) {
    const known = listRepos();
    const unknown = opts.repos.filter(r => !known.includes(r));
    if (unknown.length) {
      process.stderr.write(`Unknown repo(s): ${unknown.join(', ')}. Choices: ${known.join(', ')}\n`);
      process.exit(2);
    }
    runReposViaSubprocess(opts, opts.repos);
    return;
  }
  if (!opts.repo) { process.stderr.write('Specify --repo=<name>, --repos=A,B,..., or --all.\n'); printHelp(); process.exit(2); }
  await runOneRepo(opts);
}

main().catch(err => { process.stderr.write(`bench failed: ${err.stack || err.message || err}\n`); process.exit(1); });
