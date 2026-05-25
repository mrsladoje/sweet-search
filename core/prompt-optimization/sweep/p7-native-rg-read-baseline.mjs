#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runClaudeAgent } from '../../../eval/agent-read-workflows/claude-runner.js';
import { POLICIES } from '../../../eval/agent-read-workflows/policies.js';
import {
  classifyToolUse,
  JUDGE_PANEL,
  judgePanelScore,
  resolveRepoCwd,
  runCodexAgent,
} from './gepa-evaluate.mjs';
import { runAnthropicApiAgent, runOpenRouterApiAgent } from './p7-api-agent-runner.mjs';
import { assertNativeBaselineCoverage } from './eas.mjs';
import { agentTokenCount } from './gepa-scoring.mjs';
import { RESULTS_DIR, appendFsynced, atomicWriteJSON } from './p7-persist.mjs';
import { hashContent, normalizeTarget, TARGET_LIST, validateProbes } from './p7-shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(REPO_ROOT, 'core', 'prompt-optimization', 'data');

const TIER_FILES = Object.freeze({ dev: path.join(DATA_DIR, 'p7-dev-probes.json'), heldout: path.join(DATA_DIR, 'frozen', 'p7-heldout-probes.json'), vault: path.join(DATA_DIR, 'frozen', 'p7-vault-probes.json'), smoke: path.join(DATA_DIR, 'p7-smoke-probes.json') });

const PANEL_CHOICES = Object.freeze({
  default: JUDGE_PANEL,
  dual: JUDGE_PANEL.filter((j) => j.lineage === 'deepseek-api' || j.lineage === 'google-api'),
  deepseek: JUDGE_PANEL.filter((j) => j.lineage === 'deepseek-api'),
  gemini: JUDGE_PANEL.filter((j) => j.lineage === 'google-api'),
});

const POLICY_CHOICES = new Set(['default-native', 'rg-read']);
const DEFAULT_NATIVE_DENYLIST = Object.freeze(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']);

const DEFAULT_NATIVE_POLICY = `\
You are solving a code-understanding task in a repository.
Use your normal/default code-reading workflow for this agent and environment.
You MUST NOT:
- run any \`sweet-search\` command, or any of the \`ss-*\` wrappers (\`ss-find\`, \`ss-grep\`, \`ss-read\`, \`ss-semantic\`, \`ss-search\`, \`ss-trace\`)
- read or rely on any file under \`.sweet-search/\` (these are Sweet Search's index files)
- use network access
- edit, create, or move files
Keep searches and reads focused. Stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found and name the checks you ran.`;

function defaultRunId() { return `p7-native-default-smoke-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`; }

function parseArgs(argv) {
  const o = {
    run: defaultRunId(),
    tier: 'dev',
    probesFile: null,
    ids: null,
    limit: null,
    offset: 0,
    targets: TARGET_LIST,
    repeats: 1,
    judgePanel: 'default',
    policy: 'default-native',
    calibrateOverhead: false,
    timeoutMs: 240000,
    resume: false,
    agentProvider: process.env.P7_AGENT_PROVIDER || 'api',
    models: { sonnet: 'claude-sonnet-4-6', gpt5_5: 'gpt-5.5-instant' },
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.run = argv[++i];
    else if (a === '--tier') o.tier = argv[++i];
    else if (a === '--probes') o.probesFile = argv[++i];
    else if (a === '--ids') o.ids = argv[++i].split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--limit') o.limit = Number.parseInt(argv[++i], 10);
    else if (a === '--offset') o.offset = Number.parseInt(argv[++i], 10);
    else if (a === '--targets') o.targets = argv[++i].split(',').map((x) => normalizeTarget(x.trim()));
    else if (a === '--repeats') o.repeats = Number.parseInt(argv[++i], 10);
    else if (a === '--judge-panel') o.judgePanel = argv[++i];
    else if (a === '--policy') o.policy = argv[++i];
    else if (a === '--calibrate-overhead') o.calibrateOverhead = true;
    else if (a === '--timeout-ms') o.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (a === '--sonnet-model') o.models.sonnet = argv[++i];
    else if (a === '--gpt-model') o.models.gpt5_5 = argv[++i];
    else if (a === '--agent-provider') o.agentProvider = argv[++i];
    else if (a === '--resume') o.resume = true;
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!PANEL_CHOICES[o.judgePanel]) throw new Error(`unknown --judge-panel ${o.judgePanel}`);
  if (!POLICY_CHOICES.has(o.policy)) throw new Error(`unknown --policy ${o.policy}`);
  if (!['api', 'cli'].includes(o.agentProvider)) throw new Error(`unknown --agent-provider ${o.agentProvider}`);
  if (!Number.isInteger(o.repeats) || o.repeats <= 0) throw new Error('--repeats must be a positive integer');
  return o;
}

function printUsage() {
  console.log(`Usage: node core/prompt-optimization/sweep/p7-native-rg-read-baseline.mjs [flags]
Flags: --tier dev|heldout|vault|smoke --probes FILE --ids id1,id2 --limit N --offset N
  --targets sonnet,gpt5_5 --repeats N --judge-panel default|dual|deepseek|gemini
  --policy default-native|rg-read --agent-provider api|cli --calibrate-overhead
  --run RUN_ID --resume`);
}

function readProbeFile(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const probes = doc.probes ?? doc;
  const v = validateProbes(probes);
  if (!v.ok) throw new Error(`invalid probes in ${file}: ${v.errors.map((e) => `${e.index}:${e.message}`).join('; ')}`);
  return probes;
}

function loadSelectedProbes(opts) {
  const file = opts.probesFile ?? TIER_FILES[opts.tier];
  if (!file) throw new Error(`unknown tier "${opts.tier}"`);
  let probes = readProbeFile(file).map((probe) => ({ ...probe, tier: opts.tier }));
  if (opts.ids?.length) {
    const wanted = new Set(opts.ids);
    probes = probes.filter((probe) => wanted.has(probe.id));
    const found = new Set(probes.map((probe) => probe.id));
    const missing = opts.ids.filter((id) => !found.has(id));
    if (missing.length) throw new Error(`probe id(s) not found: ${missing.join(', ')}`);
  }
  if (Number.isInteger(opts.offset) && opts.offset > 0) probes = probes.slice(opts.offset);
  if (Number.isInteger(opts.limit) && opts.limit >= 0) probes = probes.slice(0, opts.limit);
  return probes;
}

function buildNativePrompt(probe, policy) {
  const workflow = policy === 'rg-read'
    ? 'Use native rg/grep/find plus focused file reads only.'
    : 'Use your normal/default code-reading workflow for this agent. Do not use sweet-search or ss-* wrappers.';
  return [`Task: ${probe.query}`, '', `Stay within ${probe.max_turns} tool calls if possible.`, workflow, 'Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found and name the checks you ran.'].join('\n');
}

function systemAppendFor(policy) {
  if (policy === 'rg-read') {
    return [
      POLICIES['native-rg-read'],
      '',
      'Additional Phase 7 baseline rule: do not use network access and do not modify repository files.',
    ].join('\n');
  }
  return DEFAULT_NATIVE_POLICY;
}

function usageFor(target, run, modelId) {
  const u = run.usage || null;
  if (target === 'sonnet') {
    return { model_id: run.modelUsed || modelId, api_path: run.apiPath || 'claude-cli', input_tokens: typeof u?.input_tokens === 'number' ? u.input_tokens : null, output_tokens: typeof u?.output_tokens === 'number' ? u.output_tokens : null, cache_read_tokens: typeof u?.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : null, cache_creation_tokens: typeof u?.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : null };
  }
  return { model_id: run.modelUsed || modelId, api_path: run.apiPath || 'codex-exec', input_tokens: typeof u?.input_tokens === 'number' ? u.input_tokens : null, output_tokens: typeof u?.output_tokens === 'number' ? u.output_tokens : null, cache_read_tokens: typeof u?.cached_input_tokens === 'number' ? u.cached_input_tokens : null };
}

function agentTokens(usage) { return agentTokenCount({ agent: usage }); }

async function runNativeAgent({ probe, target, models, policy, timeoutMs, agentProvider }) {
  const cwd = resolveRepoCwd(probe);
  if (!fs.existsSync(cwd)) throw new Error(`repo cwd missing for ${probe.id}: ${cwd}`);
  const prompt = buildNativePrompt(probe, policy);
  const systemAppend = systemAppendFor(policy);
  let run;
  if (target === 'sonnet') {
    const agentReq = {
      prompt,
      systemAppend,
      model: models.sonnet,
      cwd,
      sweetSearchBinDir: null,
      addDirs: [cwd],
      projectRoot: cwd,
      timeoutMs,
      maxToolCalls: Math.max(6, (probe.max_turns ?? 8) + 4),
      allowSweetSearch: false,
    };
    if (agentProvider === 'api') {
      run = await runAnthropicApiAgent(agentReq);
    } else {
      if (policy === 'rg-read') {
        agentReq.allowedTools = ['Bash', 'Read'];
      } else {
        agentReq.disallowedTools = DEFAULT_NATIVE_DENYLIST;
      }
      run = await runClaudeAgent(agentReq);
    }
  } else {
    const agentReq = {
      prompt,
      systemAppend,
      model: models.gpt5_5,
      cwd,
      sweetSearchBinDir: null,
      timeoutMs,
      maxToolCalls: Math.max(6, (probe.max_turns ?? 8) + 4),
      allowSweetSearch: false,
    };
    run = agentProvider === 'api' ? await runOpenRouterApiAgent(agentReq) : await runCodexAgent(agentReq);
  }
  const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
  const answer = run.finalResultText || run.finalAssistantText || '';
  const usage = usageFor(target, run, target === 'sonnet' ? models.sonnet : models.gpt5_5);
  return {
    cwd: path.relative(REPO_ROOT, cwd),
    answer,
    calls,
    toolUse: classifyToolUse(calls),
    usage,
    wallMs: run.wallMs ?? 0,
    isError: !!run.isError || run.exitCode !== 0 || !!run.timedOut,
    exitCode: run.exitCode ?? null,
    stderrPreview: run.stderrPreview ?? '',
  };
}

async function runNoToolCalibration({ target, models, policy, cwd, timeoutMs, agentProvider }) {
  const prompt = 'Reply exactly OK.\nDo not inspect files.\nDo not run commands.\nDo not use tools.';
  const systemAppend = systemAppendFor(policy);
  let run;
  if (target === 'sonnet') {
    const req = {
      prompt,
      systemAppend,
      model: models.sonnet,
      cwd,
      addDirs: [cwd],
      projectRoot: cwd,
      timeoutMs,
      disallowedTools: DEFAULT_NATIVE_DENYLIST,
      maxToolCalls: 1,
      allowSweetSearch: false,
    };
    run = agentProvider === 'api' ? await runAnthropicApiAgent(req) : await runClaudeAgent(req);
  } else {
    const req = { prompt, systemAppend, model: models.gpt5_5, cwd, sweetSearchBinDir: null, timeoutMs, maxToolCalls: 1, allowSweetSearch: false };
    run = agentProvider === 'api' ? await runOpenRouterApiAgent(req) : await runCodexAgent(req);
  }
  const usage = usageFor(target, run, target === 'sonnet' ? models.sonnet : models.gpt5_5);
  return {
    tokens: agentTokens(usage),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    calls: Array.isArray(run.toolCalls) ? run.toolCalls.length : 0,
    isError: !!run.isError || run.exitCode !== 0 || !!run.timedOut,
  };
}

async function judgeAnswer({ probe, answer, panel }) {
  try {
    const judged = await judgePanelScore({ probe, answer, panel });
    return { score: judged.score, judges: judged.judges, error: null };
  } catch (err) {
    return { score: null, judges: [], error: err?.message || String(err) };
  }
}

function rowKey({ target, probe_id, repeat }) {
  return `${target}:${probe_id}:${repeat}`;
}

function existingRows(jsonlPath) {
  const rows = [];
  const done = new Set();
  if (!fs.existsSync(jsonlPath)) return { rows, done };
  for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = normalizeStoredRow(JSON.parse(line));
      if (isReusableBaselineRow(row)) {
        rows.push(row);
        done.add(rowKey(row));
      }
    } catch { /* ignore trailing corrupt row */ }
  }
  return { rows, done };
}

function isReusableBaselineRow(row) {
  return !row.agent_error && !row.policy_violation && !row.judge_error && typeof row.score === 'number' && typeof row.calls === 'number' && typeof row.tokens === 'number';
}

function normalizeStoredRow(row) {
  const tokens = agentTokens({
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_read_tokens: row.cache_read_tokens,
    cache_creation_tokens: row.cache_creation_tokens,
  });
  return tokens == null ? row : { ...row, tokens };
}

function finiteMean(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function buildBaseline(rows) {
  const out = {};
  const groups = new Map();
  for (const row of rows) {
    if (!isReusableBaselineRow(row)) continue;
    const key = `${row.target}:${row.probe_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [key, xs] of groups) {
    const [target, probeId] = key.split(':');
    out[target] ??= {};
    out[target][probeId] = {
      score: finiteMean(xs.map((x) => x.score)),
      calls: finiteMean(xs.map((x) => x.calls)),
      tokens: finiteMean(xs.map((x) => x.tokens)),
      repeats: xs.length,
    };
    const overhead = finiteMean(xs.map((x) => x.overhead_tokens));
    if (typeof overhead === 'number') out[target][probeId].overhead_tokens = overhead;
  }
  return out;
}

function summarize(rows) {
  const complete = rows.filter((r) => !r.agent_error && !r.policy_violation && typeof r.score === 'number' && typeof r.tokens === 'number');
  return {
    rows: rows.length,
    completeRows: complete.length,
    meanScore: finiteMean(complete.map((r) => r.score)),
    meanCalls: finiteMean(complete.map((r) => r.calls)),
    meanTokens: finiteMean(complete.map((r) => r.tokens)),
    agentErrors: rows.filter((r) => r.agent_error).length,
    judgeErrors: rows.filter((r) => r.judge_error).length,
    policyViolations: rows.filter((r) => r.policy_violation).length,
    byTarget: Object.fromEntries(TARGET_LIST.map((target) => [target, summarizeShallow(rows.filter((r) => r.target === target))])),
  };
}

function summarizeShallow(rows) {
  const complete = rows.filter((r) => !r.agent_error && !r.policy_violation && typeof r.score === 'number' && typeof r.tokens === 'number');
  return {
    rows: rows.length,
    completeRows: complete.length,
    meanScore: finiteMean(complete.map((r) => r.score)),
    meanCalls: finiteMean(complete.map((r) => r.calls)),
    meanTokens: finiteMean(complete.map((r) => r.tokens)),
  };
}

function overheadKey({ target, cwd }) { return `${target}:${cwd}`; }

async function buildOverheadMap({ probes, targets, models, policy, timeoutMs, enabled, agentProvider }) {
  const map = new Map();
  if (!enabled) return map;
  for (const probe of probes) {
    const cwd = resolveRepoCwd(probe);
    for (const target of targets) {
      const key = overheadKey({ target, cwd });
      if (map.has(key)) continue;
      process.stdout.write(`overhead ${target} ${path.relative(REPO_ROOT, cwd)}... `);
      const row = await runNoToolCalibration({ target, models, policy, cwd, timeoutMs, agentProvider });
      map.set(key, row);
      console.log(row.tokens ?? 'missing');
    }
  }
  return map;
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const probes = loadSelectedProbes(opts);
  const panel = PANEL_CHOICES[opts.judgePanel];
  const outDir = RESULTS_DIR(opts.run);
  const artifactStem = opts.policy === 'rg-read' ? 'native-rg-read-baseline' : 'native-default-baseline';
  const jsonlPath = path.join(outDir, `${artifactStem}.jsonl`);
  const summaryPath = path.join(outDir, `${artifactStem}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  const prior = opts.resume ? existingRows(jsonlPath) : { rows: [], done: new Set() };
  const rows = [...prior.rows];
  const overheadMap = await buildOverheadMap({
    probes,
    targets: opts.targets,
    models: opts.models,
    policy: opts.policy,
    timeoutMs: opts.timeoutMs,
    agentProvider: opts.agentProvider,
    enabled: opts.calibrateOverhead,
  });

  console.log(`p7-native-baseline: run=${opts.run} policy=${opts.policy} provider=${opts.agentProvider} probes=${probes.length} targets=${opts.targets.join(',')} repeats=${opts.repeats} judge=${opts.judgePanel} overhead=${opts.calibrateOverhead ? 'yes' : 'no'}`);
  for (let repeat = 1; repeat <= opts.repeats; repeat++) {
    for (const probe of probes) {
      for (const target of opts.targets) {
        const key = rowKey({ target, probe_id: probe.id, repeat });
        if (prior.done.has(key)) {
          console.log(`[r${repeat}] ${probe.id} ${target} skipped (resume)`);
          continue;
        }
        const prefix = `[r${repeat}] ${probe.id} ${target}`;
        console.log(`${prefix} agent...`);
        const agent = await runNativeAgent({ probe, target, models: opts.models, policy: opts.policy, timeoutMs: opts.timeoutMs, agentProvider: opts.agentProvider });
        const overhead = overheadMap.get(overheadKey({ target, cwd: path.join(REPO_ROOT, agent.cwd) }));
        console.log(`${prefix} judge...`);
        const judged = await judgeAnswer({ probe, answer: agent.answer, panel });
        const tokens = agentTokens(agent.usage);
        const row = {
          run_id: opts.run,
          repeat,
          target,
          policy: opts.policy,
          probe_id: probe.id,
          probe_hash: hashContent(`${probe.id}|${probe.query}`),
          tier: probe.tier,
          repo: probe.repo,
          language: probe.language,
          stratum: probe.stratum,
          difficulty: probe.difficulty,
          score: judged.score,
          calls: agent.calls.length,
          tokens,
          overhead_tokens: overhead?.tokens ?? null,
          input_tokens: agent.usage.input_tokens,
          output_tokens: agent.usage.output_tokens,
          cache_read_tokens: agent.usage.cache_read_tokens,
          cache_creation_tokens: agent.usage.cache_creation_tokens,
          model_id: agent.usage.model_id,
          api_path: agent.usage.api_path,
          used_native_search: agent.toolUse.nativeSearch,
          used_native_read: agent.toolUse.nativeRead,
          used_sweet_search: agent.toolUse.ss,
          policy_violation: agent.toolUse.ss,
          agent_error: agent.isError,
          judge_error: judged.error,
          final_answer_emitted: agent.answer.trim().length > 0,
          wall_ms: agent.wallMs,
          cwd: agent.cwd,
          judges: judged.judges,
          answer: agent.answer.slice(0, 4000),
          stderr_preview: agent.stderrPreview.slice(-2000),
          overhead_calibration: overhead ?? null,
          tool_trace: agent.calls.map((tc) => ({ name: tc.name, command: tc.input?.command || '' })),
        };
        appendFsynced(jsonlPath, row);
        rows.push(row);
        const scoreText = typeof row.score === 'number' ? row.score.toFixed(2) : 'judge-error';
        console.log(`${prefix} score=${scoreText} calls=${row.calls} tokens=${row.tokens ?? 'missing'} violation=${row.policy_violation ? 'yes' : 'no'}`);
      }
    }
  }

  const baseline = buildBaseline(rows);
  let coverage = { ok: true, error: null };
  try {
    assertNativeBaselineCoverage({ baselineByTarget: baseline, probes, targets: opts.targets });
  } catch (err) {
    coverage = { ok: false, error: err?.message || String(err) };
  }
  const summary = {
    run_id: opts.run,
    created_at: new Date().toISOString(),
    probe_ids: probes.map((p) => p.id),
    targets: opts.targets,
    repeats: opts.repeats,
    policy: opts.policy,
    agent_provider: opts.agentProvider,
    calibrate_overhead: opts.calibrateOverhead,
    judge_panel: panel.map((j) => `${j.lineage}:${j.model}`),
    result_file: path.relative(REPO_ROOT, jsonlPath),
    coverage,
    ...summarize(rows),
    nativeBaselineByTarget: baseline,
  };
  atomicWriteJSON(summaryPath, summary);
  console.log(`summary: ${path.relative(REPO_ROOT, summaryPath)}`);
  console.log(JSON.stringify({ coverage, rows: summary.rows, completeRows: summary.completeRows, meanScore: summary.meanScore, meanCalls: summary.meanCalls, meanTokens: summary.meanTokens }, null, 2));
  if (!coverage.ok) process.exitCode = 1;
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
}
