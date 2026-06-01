#!/usr/bin/env node
/**
 * Phase 7 cheap canary: one DeepSeek Flash OpenCode agent over prereg probes.
 *
 * This is not a GEPA optimizer and not a production-target score. It is a
 * low-cost end-to-end check that probes, repo paths, sweet-search shims, agent
 * answers, and a cheap judge can run across the frozen probe tiers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { IN_DISTRIBUTION } from './author-probes.mjs';
import { judgePanelScore, JUDGE_PANEL } from './gepa-evaluate.mjs';
import { RESULTS_DIR, appendFsynced, atomicWriteJSON } from './p7-persist.mjs';
import { hashContent, validateProbes } from './p7-shared.mjs';
import { loadVariant } from './variant-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(REPO_ROOT, 'core', 'prompt-optimization', 'data');
const SS_BIN_DIR = path.join(REPO_ROOT, 'eval', 'agent-read-workflows', 'bin');
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_JUDGE_MODEL = 'deepseek-v4-flash';

const TIER_FILES = Object.freeze({
  dev: path.join(DATA_DIR, 'p7-dev-probes.json'),
  heldout: path.join(DATA_DIR, 'frozen', 'p7-heldout-probes.json'),
  vault: path.join(DATA_DIR, 'frozen', 'p7-vault-probes.json'),
  smoke: path.join(DATA_DIR, 'p7-smoke-probes.json'),
});

function defaultRunId() {
  return `p7-deepseek-flash-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`;
}

function parseArgs(argv) {
  const o = {
    run: defaultRunId(),
    tier: 'all',
    variant: 'T15',
    model: DEFAULT_MODEL,
    judgeModel: DEFAULT_JUDGE_MODEL,
    limit: null,
    offset: 0,
    timeoutMs: 240000,
    resume: false,
    noJudge: false,
    promptFile: null,    // bare system-prompt file (e.g. Mpp.md) — overrides --variant
    judgePanel: 'deepseek', // 'default' = 3-panel JUDGE_PANEL (HOMP comparability); 'deepseek' = single
    reasoningEffort: null, // opencode --variant (high|max|minimal) for reasoning models
    concurrency: 1,      // parallel opencode workers
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.run = argv[++i];
    else if (a === '--tier') o.tier = argv[++i];
    else if (a === '--variant') o.variant = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--prompt-file') o.promptFile = argv[++i];
    else if (a === '--judge-panel') o.judgePanel = argv[++i];
    else if (a === '--reasoning-effort') o.reasoningEffort = argv[++i];
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number.parseInt(argv[++i], 10) || 1);
    else if (a === '--judge-model') o.judgeModel = argv[++i];
    else if (a === '--limit') o.limit = Number.parseInt(argv[++i], 10);
    else if (a === '--offset') o.offset = Number.parseInt(argv[++i], 10);
    else if (a === '--timeout-ms') o.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (a === '--resume') o.resume = true;
    else if (a === '--no-judge') o.noJudge = true;
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return o;
}

function printUsage() {
  console.log(`Usage:
  node core/prompt-optimization/sweep/p7-deepseek-flash-baseline.mjs [flags]

Flags:
  --tier all|dev|heldout|vault|smoke  Probe tier to run [all]
  --variant T15                       Seed prompt variant [T15]
  --model deepseek/deepseek-v4-flash  OpenCode model [deepseek/deepseek-v4-flash]
  --run RUN_ID                        Results dir name [timestamped]
  --limit N --offset N                Slice probes for canaries
  --resume                            Skip probe ids already in JSONL
  --no-judge                          Record agent output without judge scoring
`);
}

function loadTier(tier) {
  const file = TIER_FILES[tier];
  if (!file) throw new Error(`unknown tier "${tier}"`);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const probes = doc.probes ?? doc;
  const v = validateProbes(probes);
  if (!v.ok) {
    throw new Error(`invalid probes in ${file}: ${v.errors.map((e) => `${e.index}:${e.message}`).join('; ')}`);
  }
  return probes.map((probe) => ({ ...probe, tier }));
}

function loadSelectedProbes({ tier, limit, offset }) {
  const tiers = tier === 'all' ? ['dev', 'heldout', 'vault'] : [tier];
  let probes = tiers.flatMap(loadTier);
  if (Number.isInteger(offset) && offset > 0) probes = probes.slice(offset);
  if (Number.isInteger(limit) && limit >= 0) probes = probes.slice(0, limit);
  return probes;
}

const REPO_PATHS = new Map(
  IN_DISTRIBUTION.map((x) => [`${x.language}:${x.repo}`, path.resolve(REPO_ROOT, x.path)]),
);

function assertInsideRepoRoot(absPath) {
  const rel = path.relative(REPO_ROOT, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing path outside repo root: ${absPath}`);
  }
}

function repoCwdFor(probe) {
  const key = `${probe.language}:${probe.repo}`;
  const cwd = REPO_PATHS.get(key);
  if (!cwd) throw new Error(`no repo path mapping for ${key}`);
  assertInsideRepoRoot(cwd);
  if (!fs.existsSync(cwd)) throw new Error(`repo path missing for ${key}: ${cwd}`);
  return cwd;
}

function buildCanaryPrompt({ systemPrompt, probe }) {
  return `[SYSTEM]
${systemPrompt}

Additional canary constraints:
- You are already in the target repository root.
- Use Bash to run sweet-search tools only when searching: ss-search, ss-find, ss-semantic, ss-trace, ss-grep, ss-read.
- Do not edit files, install packages, change git state, or use the network.
- Stay within ${probe.max_turns} tool calls.
- Final answer: cite the relevant file paths, symbols, and facts. If the answer is absent, say no match found and briefly name the checks you ran.

[USER]
Task: ${probe.query}`;
}

async function spawnCapture(cmd, args, { cwd, env, timeoutMs }) {
  const proc = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const t0 = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let truncated = false;
  const cap = 8 * 1024 * 1024;
  const append = (kind, chunk) => {
    const s = chunk.toString('utf8');
    if (kind === 'stdout') stdout += s;
    else stderr += s;
    if (stdout.length + stderr.length > cap) {
      truncated = true;
      stdout = stdout.slice(-cap / 2);
      stderr = stderr.slice(-cap / 2);
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill('SIGTERM'); } catch { /* noop */ }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* noop */ } }, 2000).unref();
  }, timeoutMs);
  proc.stdout.on('data', (d) => append('stdout', d));
  proc.stderr.on('data', (d) => append('stderr', d));
  const exit = await new Promise((resolve) => {
    proc.on('exit', (code, signal) => resolve({ code, signal }));
    proc.on('error', (err) => resolve({ code: -1, signal: null, error: err.message }));
  });
  clearTimeout(timer);
  return { stdout, stderr, timedOut, truncated, exit, wallMs: Date.now() - t0 };
}

function parseOpencodeJsonl(stdout) {
  const toolCalls = [];
  const textParts = [];
  const tokenTotals = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let costUsd = 0;
  let sessionId = null;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t[0] !== '{') continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    sessionId = ev.sessionID || sessionId;
    if (ev.type === 'text' && typeof ev.part?.text === 'string') {
      textParts.push(ev.part.text);
    } else if (ev.type === 'tool_use') {
      const state = ev.part?.state || {};
      toolCalls.push({
        tool: ev.part?.tool || ev.part?.type || 'tool',
        command: state.input?.command || '',
        status: state.status || '',
        exit: state.metadata?.exit ?? null,
        outputPreview: String(state.output || '').slice(0, 1000),
      });
    } else if (ev.type === 'step_finish') {
      const tok = ev.part?.tokens || {};
      tokenTotals.input += tok.input || 0;
      tokenTotals.output += tok.output || 0;
      tokenTotals.reasoning += tok.reasoning || 0;
      tokenTotals.cacheRead += tok.cache?.read || 0;
      tokenTotals.cacheWrite += tok.cache?.write || 0;
      costUsd += ev.part?.cost || 0;
    }
  }
  return {
    answer: textParts.length ? textParts[textParts.length - 1] : '',
    allText: textParts.join('\n\n').slice(0, 6000),
    toolCalls,
    tokens: tokenTotals,
    costUsd,
    sessionId,
  };
}

async function runOpencodeProbe({ probe, systemPrompt, model, timeoutMs, reasoningEffort }) {
  const cwd = repoCwdFor(probe);
  const prompt = buildCanaryPrompt({ systemPrompt, probe });
  const env = {
    ...process.env,
    PATH: [SS_BIN_DIR, process.env.PATH].filter(Boolean).join(':'),
    SWEET_SEARCH_PROJECT_ROOT: cwd,
  };
  const args = [
    '--pure',
    'run',
    '--dir', cwd,
    '--model', model,
    '--format', 'json',
    '--agent', 'build',
    ...(reasoningEffort ? ['--variant', reasoningEffort] : []),
    prompt,
  ];
  const run = await spawnCapture('opencode', args, { cwd, env, timeoutMs });
  const parsed = parseOpencodeJsonl(run.stdout);
  return {
    ...parsed,
    cwd: path.relative(REPO_ROOT, cwd),
    exitCode: run.exit.code,
    signal: run.exit.signal,
    timedOut: run.timedOut,
    spawnError: run.exit.error,
    stderrPreview: run.stderr.slice(-2000),
    stdoutTruncated: run.truncated,
    wallMs: run.wallMs,
  };
}

function includesNeedle(haystack, needle) {
  return haystack.toLowerCase().includes(String(needle).toLowerCase());
}

function goldMentionScore(probe, answer) {
  const text = answer || '';
  if (probe.expectedNoMatch) {
    return /\b(no match|not found|not present|absent|does not exist|doesn't exist|no implementation)\b/i.test(text)
      ? 1
      : 0;
  }
  const files = probe.expectedFiles || [];
  const symbols = probe.expectedSymbols || [];
  const total = files.length + symbols.length;
  if (total === 0) return 0;
  let hits = 0;
  for (const file of files) if (includesNeedle(text, file)) hits++;
  for (const sym of symbols) if (includesNeedle(text, sym)) hits++;
  return hits / total;
}

function usedSweetSearch(toolCalls) {
  return toolCalls.some((tc) => /\bss-(search|find|semantic|trace|grep|read)\b/.test(tc.command || ''));
}

async function judgeAnswer({ probe, answer, judgeModel, panel }) {
  try {
    const judged = await judgePanelScore({
      probe,
      answer,
      panel: panel || [{ lineage: 'deepseek-api', model: judgeModel }],
    });
    return { score: judged.score, judges: judged.judges, error: null };
  } catch (err) {
    return { score: null, judges: [], error: err?.message || String(err) };
  }
}

function mean(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function summarize(rows) {
  const base = {
    count: rows.length,
    judged: rows.filter((r) => typeof r.score === 'number').length,
    meanScore: mean(rows.map((r) => r.score)),
    meanGoldMention: mean(rows.map((r) => r.goldMentionScore)),
    agentErrors: rows.filter((r) => r.agentError).length,
    judgeErrors: rows.filter((r) => r.judgeError).length,
    emptyAnswers: rows.filter((r) => !r.finalAnswerEmitted).length,
    noSweetSearch: rows.filter((r) => !r.usedSweetSearch).length,
    overMaxTurns: rows.filter((r) => r.toolCalls > r.max_turns).length,
    costUsd: rows.reduce((s, r) => s + (r.agentCostUsd || 0), 0),
    wallMs: rows.reduce((s, r) => s + (r.wallMs || 0), 0),
  };
  const by = (key) => Object.fromEntries(
    [...new Set(rows.map((r) => r[key]))].sort().map((value) => [
      value,
      summarizeShallow(rows.filter((r) => r[key] === value)),
    ]),
  );
  return { ...base, byTier: by('tier'), byLanguage: by('language'), byStratum: by('stratum'), byDifficulty: by('difficulty') };
}

function summarizeShallow(rows) {
  return {
    count: rows.length,
    judged: rows.filter((r) => typeof r.score === 'number').length,
    meanScore: mean(rows.map((r) => r.score)),
    meanGoldMention: mean(rows.map((r) => r.goldMentionScore)),
    agentErrors: rows.filter((r) => r.agentError).length,
    judgeErrors: rows.filter((r) => r.judgeError).length,
    emptyAnswers: rows.filter((r) => !r.finalAnswerEmitted).length,
    noSweetSearch: rows.filter((r) => !r.usedSweetSearch).length,
    overMaxTurns: rows.filter((r) => r.toolCalls > r.max_turns).length,
  };
}

function existingProbeIds(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const out = new Set();
  for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.probe_id) out.add(row.probe_id);
    } catch { /* ignore partial/corrupt trailing row */ }
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const probes = loadSelectedProbes(opts);
  const variant = opts.promptFile
    ? { id: path.basename(opts.promptFile, '.md'), body: fs.readFileSync(path.isAbsolute(opts.promptFile) ? opts.promptFile : path.join(REPO_ROOT, opts.promptFile), 'utf8') }
    : loadVariant(opts.variant);
  const judgePanelChoice = opts.judgePanel === 'default' ? JUDGE_PANEL : null;
  const outDir = RESULTS_DIR(opts.run);
  const jsonlPath = path.join(outDir, 'deepseek-flash-baseline.jsonl');
  const summaryPath = path.join(outDir, 'deepseek-flash-summary.json');
  fs.mkdirSync(outDir, { recursive: true });

  const done = opts.resume ? existingProbeIds(jsonlPath) : new Set();
  const rows = [];
  console.log(`p7-deepseek-flash: run=${opts.run} tier=${opts.tier} probes=${probes.length} variant=${variant.id} model=${opts.model} concurrency=${opts.concurrency}${opts.reasoningEffort ? ' reasoning=' + opts.reasoningEffort : ''}`);
  // Serialize JSONL appends across concurrent workers (a row can exceed PIPE_BUF → torn writes).
  let writeChain = Promise.resolve();
  const safeAppend = (row) => { writeChain = writeChain.then(() => appendFsynced(jsonlPath, row)); return writeChain; };
  let cursor = 0;
  const runOne = async (i) => {
    const probe = probes[i];
    if (done.has(probe.id)) {
      console.log(`[${i + 1}/${probes.length}] ${probe.id} skipped (resume)`);
      return;
    }
    const prefix = `[${i + 1}/${probes.length}] ${probe.id} ${probe.language}/${probe.stratum}`;
    console.log(`${prefix} agent...`);
    const agent = await runOpencodeProbe({
      probe,
      systemPrompt: variant.body,
      model: opts.model,
      timeoutMs: opts.timeoutMs,
      reasoningEffort: opts.reasoningEffort,
    });
    const finalAnswerEmitted = agent.answer.trim().length > 0;
    const toolCalls = agent.toolCalls.length;
    const sweetSearchUsed = usedSweetSearch(agent.toolCalls);
    let judged = { score: null, judges: [], error: null };
    if (!opts.noJudge) {
      console.log(`${prefix} judge...`);
      judged = await judgeAnswer({ probe, answer: agent.answer, judgeModel: opts.judgeModel, panel: judgePanelChoice });
    }
    const row = {
      run_id: opts.run,
      variant: variant.id,
      variant_hash: hashContent(variant.body),
      model: opts.model,
      judge_model: opts.noJudge ? null : opts.judgeModel,
      probe_id: probe.id,
      tier: probe.tier,
      repo: probe.repo,
      language: probe.language,
      stratum: probe.stratum,
      difficulty: probe.difficulty,
      max_turns: probe.max_turns,
      expectedNoMatch: probe.expectedNoMatch,
      score: judged.score,
      goldMentionScore: goldMentionScore(probe, agent.answer),
      finalAnswerEmitted,
      toolCalls,
      usedSweetSearch: sweetSearchUsed,
      agentError: agent.exitCode !== 0 || agent.timedOut || !!agent.spawnError,
      judgeError: judged.error,
      overMaxTurns: toolCalls > probe.max_turns,
      wallMs: agent.wallMs,
      agentCostUsd: agent.costUsd,
      agentTokens: agent.tokens,
      judges: judged.judges,
      sessionId: agent.sessionId,
      cwd: agent.cwd,
      answer: agent.answer.slice(0, 4000),
      allText: agent.allText,
      toolTrace: agent.toolCalls.map((tc) => ({
        tool: tc.tool,
        command: tc.command,
        status: tc.status,
        exit: tc.exit,
        outputPreview: tc.outputPreview,
      })),
      stderrPreview: agent.stderrPreview,
      stdoutTruncated: agent.stdoutTruncated,
    };
    await safeAppend(row);
    rows.push(row);
    const scoreText = typeof row.score === 'number' ? row.score.toFixed(2) : 'judge-error';
    console.log(`${prefix} score=${scoreText} tools=${toolCalls} ss=${sweetSearchUsed ? 'yes' : 'no'} cost=$${row.agentCostUsd.toFixed(4)}`);
  };
  await Promise.all(Array.from({ length: opts.concurrency }, async () => {
    for (let i = cursor++; i < probes.length; i = cursor++) await runOne(i);
  }));

  const allRows = [];
  if (fs.existsSync(jsonlPath)) {
    for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { allRows.push(JSON.parse(line)); } catch { /* ignore */ }
    }
  }
  const summary = {
    run_id: opts.run,
    created_at: new Date().toISOString(),
    tier: opts.tier,
    variant: variant.id,
    model: opts.model,
    judge_model: opts.noJudge ? null : opts.judgeModel,
    result_file: path.relative(REPO_ROOT, jsonlPath),
    ...summarize(allRows),
  };
  atomicWriteJSON(summaryPath, summary);
  console.log(`summary: ${path.relative(REPO_ROOT, summaryPath)}`);
  console.log(JSON.stringify({
    count: summary.count,
    judged: summary.judged,
    meanScore: summary.meanScore,
    meanGoldMention: summary.meanGoldMention,
    agentErrors: summary.agentErrors,
    judgeErrors: summary.judgeErrors,
    noSweetSearch: summary.noSweetSearch,
    overMaxTurns: summary.overMaxTurns,
    costUsd: summary.costUsd,
  }, null, 2));
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
}
