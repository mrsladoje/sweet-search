#!/usr/bin/env node
/**
 * budget-sweep-smoke — response-token-budget sensitivity smoke (DEV probes only).
 *
 * Question: how much of the ss-* tool-response usefulness survives when the
 * packaging budgets are cut (4k→3k→2.5k→2k), and WHICH tool's budget is critical?
 * Arms pin per-tool budgets via the SS_SMOKE_* env hooks in
 * eval/agent-read-workflows/bin/_ss-helpers.mjs (bench-local; M++ prompt
 * byte-identical across all mpp arms). The tier2.5k arm instead lowers the
 * PREVIEW auto-tier (SS_SMOKE_TIER_PREVIEW in core/search/context-expander.js)
 * while KEEPING full/xl escalation — the production-shaped config.
 *
 * Harnesses (HARNESS env): bare (default; OpenRouter/DeepSeek-direct API loop),
 * codex (Codex CLI via OpenRouter), cc (Claude Code on the Max subscription —
 * policy injected via per-repo CLAUDE.md, global/project CLAUDE.md suppressed,
 * MCP+hooks off, ANTHROPIC_API_KEY stripped from the SPAWNED agent only).
 *
 *   node scripts/budget-sweep-smoke.mjs                                  # bare deepseek (resumable)
 *   MODEL=xiaomi/mimo-v2.5-pro node scripts/budget-sweep-smoke.mjs       # bare mimo
 *   HARNESS=codex node scripts/budget-sweep-smoke.mjs --reps 1           # gpt-5.5 low via codex/OpenRouter
 *   HARNESS=cc node scripts/budget-sweep-smoke.mjs --reps 1 --conc 2     # opus-4.8 via Claude Code subscription
 *   [MODEL=...] [HARNESS=...] node scripts/budget-sweep-smoke.mjs --report
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runOpenRouterApiAgent } from '../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';
import { runCodexAgent } from '../core/prompt-optimization/sweep/p7-codex-runner.mjs';
import { runClaudeAgent } from '../eval/agent-read-workflows/claude-runner.js';
import { normalizeClaudeCalls, normalizeCodexCalls } from '../core/prompt-optimization/sweep/usd-capture.mjs';
import { resolveRepoCwd, buildAgentUserPrompt, judgePanelScore, JUDGE_PANEL, normalizeJudgeUsage, AllJudgesFailedError } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runJudge } from '../eval/agent-read-workflows/judge-runner.js';
import { toRJudge, usdPanelScore, scoreUSD, composeUSD, computeRubricHash, USD_PARAMS } from '../core/prompt-optimization/sweep/usd-metric.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;

const HARNESS = process.env.HARNESS || 'bare'; // bare | codex | cc
const MODEL = process.env.MODEL
  || (HARNESS === 'cc' ? 'claude-opus-4-8' : HARNESS === 'codex' ? 'gpt-5.5' : 'deepseek/deepseek-v4-pro');
// codex cell = the established "GPT-5.5 low" config; bare cells run reasoning=high.
const REASONING = process.env.REASONING || (HARNESS === 'codex' ? 'low' : 'high');
const THINK = process.env.THINK || '10000';            // cc only: extended-thinking budget
const MAXTOK = Number(process.env.MAXTOK || 32000);
const READLINES = Number(process.env.READLINES || 2000);
const TOOLCHARS = Number(process.env.TOOLCHARS || 64000);
const LEAN = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project'];
// Per-1M-token rates. deepseek = DIRECT official (same as ba-batch);
// mimo + gpt-5.5 = OpenRouter list (task bench / ba-batch snapshots);
// opus = Anthropic standard tier (subscription pays $0 cash; reported at API rates).
const PRICES = {
  'deepseek/deepseek-v4-pro': { inPerM: 0.435, outPerM: 0.87, cacheReadPerM: 0.003625 },
  'xiaomi/mimo-v2.5-pro':     { inPerM: 0.435, outPerM: 0.87, cacheReadPerM: 0.0036 },
  'gpt-5.5':                  { inPerM: 5, outPerM: 30, cacheReadPerM: 0.5 },
  'claude-opus-4-8':          { inPerM: 15, outPerM: 75, cacheReadPerM: 1.5, cacheWritePerM: 18.75 },
};
const PR = PRICES[MODEL] || PRICES['deepseek/deepseek-v4-pro'];
// Model/harness-keyed output dir: the original deepseek sweep keeps its un-suffixed dir.
const TAG = process.env.TAG ?? (
  HARNESS === 'cc' ? '-cc-opus'
  : HARNESS === 'codex' ? '-codex-gpt'
  : MODEL.includes('deepseek') ? ''
  : MODEL.includes('mimo') ? '-mimo'
  : '-' + MODEL.replace(/[^a-z0-9.]+/gi, '-'));

// ─── arms ─────────────────────────────────────────────────────────────────────
// ctrl = current production defaults (auto-tier 4k/8k/12k, semantic 800, trace adaptive).
// Pinned-budget arms (explicit tokenBudget) DISABLE auto-escalation by contract.
// tier2.5k lowers only the preview tier and KEEPS escalation — the production-shaped cut.
// srch2k / aux2k isolate which tool family's budget carries the usefulness.
const ARMS = [
  { name: 'native',     mode: 'native', env: {} },
  { name: 'mpp-ctrl',   mode: 'mpp',    env: {} },
  { name: 'mpp-3k',     mode: 'mpp',    env: { SS_SMOKE_SEARCH_BUDGET: '3000', SS_SMOKE_FIND_BUDGET: '3000', SS_SMOKE_TRACE_BUDGET: '3000', SS_SMOKE_SEMANTIC_MAXTOKENS: '600' } },
  { name: 'mpp-2.8k',   mode: 'mpp',    env: { SS_SMOKE_SEARCH_BUDGET: '2800', SS_SMOKE_FIND_BUDGET: '2800', SS_SMOKE_TRACE_BUDGET: '2800', SS_SMOKE_SEMANTIC_MAXTOKENS: '560' } },
  { name: 'mpp-2.5k',   mode: 'mpp',    env: { SS_SMOKE_SEARCH_BUDGET: '2500', SS_SMOKE_FIND_BUDGET: '2500', SS_SMOKE_TRACE_BUDGET: '2500', SS_SMOKE_SEMANTIC_MAXTOKENS: '500' } },
  { name: 'mpp-2.25k',  mode: 'mpp',    env: { SS_SMOKE_SEARCH_BUDGET: '2250', SS_SMOKE_FIND_BUDGET: '2250', SS_SMOKE_TRACE_BUDGET: '2250', SS_SMOKE_SEMANTIC_MAXTOKENS: '450' } },
  { name: 'mpp-2k',     mode: 'mpp',    env: { SS_SMOKE_SEARCH_BUDGET: '2000', SS_SMOKE_FIND_BUDGET: '2000', SS_SMOKE_TRACE_BUDGET: '2000', SS_SMOKE_SEMANTIC_MAXTOKENS: '400' } },
  { name: 'tier2.5k',   mode: 'mpp',    env: { SS_SMOKE_TIER_PREVIEW: '2500', SS_SMOKE_SEMANTIC_MAXTOKENS: '500' } },
  { name: 'mpp-srch2k', mode: 'mpp',    env: { SS_SMOKE_SEARCH_BUDGET: '2000', SS_SMOKE_FIND_BUDGET: '2000' } },
  { name: 'mpp-aux2k',  mode: 'mpp',    env: { SS_SMOKE_TRACE_BUDGET: '2000', SS_SMOKE_SEMANTIC_MAXTOKENS: '400' } },
];
const ALL_SMOKE_ENV = ['SS_SMOKE_SEARCH_BUDGET', 'SS_SMOKE_FIND_BUDGET', 'SS_SMOKE_TRACE_BUDGET', 'SS_SMOKE_SEMANTIC_MAXTOKENS', 'SS_SMOKE_TIER_PREVIEW'];

// 12 dev probes (held-out & vault untouched): one per in-distribution language
// + 1 no-match + 1 trick, biased toward multi-file-flow where budgets bind.
const PROBE_IDS = [
  'cpp-005', 'csharp-004', 'go-005', 'java-004', 'js-007', 'kotlin-008',
  'python-010', 'ruby-001', 'rust-005', 'ts-005', 'python-009', 'rust-004',
];

// ─── CLI args ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : fallback; };
const REPORT = argv.includes('--report');
const REPS = Number(flag('--reps', 3));
const CONC = Number(flag('--conc', 3));
const onlyIds = (flag('--ids', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const onlyArms = (flag('--arms', '') || '').split(',').map(s => s.trim()).filter(Boolean);

const OUT = path.join(REPO, `core/prompt-optimization/data/results/budget-sweep-smoke${TAG}`);
const RUNS = path.join(OUT, 'runs.jsonl');
const CAP_DIR = path.join(OUT, 'captures');

const devRaw = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-dev-probes.json'), 'utf8'));
const allProbes = Array.isArray(devRaw) ? devRaw : (devRaw.probes || []);
const wantIds = onlyIds.length ? onlyIds : PROBE_IDS;
const probes = wantIds.map(id => allProbes.find(p => p.id === id)).filter(Boolean);
if (probes.length !== wantIds.length) {
  const missing = wantIds.filter(id => !probes.some(p => p.id === id));
  console.error(`FATAL: probe id(s) not found in dev set: ${missing.join(',')}`); process.exit(1);
}
const arms = onlyArms.length ? ARMS.filter(a => onlyArms.includes(a.name)) : ARMS;

// ─── shared helpers (mirrors ba-batch.mjs / cc-batch.mjs) ─────────────────────
const SS_CMD_RE = /\bss-(search|find|semantic|trace|grep|read)\b/;
const NATIVE_SEARCH_RE = /\b(rg|ripgrep|grep|egrep|fgrep|ag|ack|find)\b/;
const cmdText = (c) => (typeof c?.input?.command === 'string' ? c.input.command : (c?.input?.file_path || ''));
const ssUsed = (calls) => calls.some((c) => SS_CMD_RE.test(cmdText(c)));
function buildArmResponse(toolCalls, arm) {
  const blocks = [];
  for (const tc of toolCalls) {
    const result = tc.result?.content;
    if (typeof result !== 'string' || !result.trim()) continue;
    const cmd = String(tc.input?.command || '');
    if (arm === 'ss') {
      if (tc.name === 'Bash' && SS_CMD_RE.test(cmd)) blocks.push(result);
      else if (tc.name === 'Read') blocks.push(`${tc.input?.file_path || ''}\n${result}`);
    } else if (tc.name === 'Bash' && NATIVE_SEARCH_RE.test(cmd)) blocks.push(`$ ${cmd}\n${result}`);
    else if (tc.name === 'Read') blocks.push(`${tc.input?.file_path || ''}\n${result}`);
    else if (tc.name === 'Bash') blocks.push(`$ ${cmd}\n${result}`);
    else if (tc.name === 'Grep' || tc.name === 'Glob') blocks.push(`$ ${tc.name} ${JSON.stringify(tc.input || {})}\n${result}`);
  }
  return blocks.join('\n\n');
}
// Parse delivered-token telemetry out of the ss-* tool outputs so we can VERIFY
// the budget knob bound, and quantify delivered tokens per arm.
function ssDelivered(toolCalls) {
  const per = [];
  for (const tc of toolCalls) {
    const out = tc.result?.content; if (typeof out !== 'string') continue;
    const cmd = cmdText(tc);
    let m;
    if ((m = out.match(/<<SS_ROUTE_META>>(\{.*\})/))) {
      try { const j = JSON.parse(m[1]); per.push({ tool: 'ss-search', budget: j.tokenBudget, used: j.tokensUsed, subMode: j.subMode }); } catch {}
    } else if ((m = out.match(/^# ss-find:.* budget=(\d+) used=(\d+)/m))) {
      per.push({ tool: 'ss-find', budget: +m[1], used: +m[2] });
    } else if ((m = out.match(/<<SS_TRACE_META>>(\{.*\})/))) {
      try { const j = JSON.parse(m[1]); per.push({ tool: 'ss-trace', budget: j.tokenBudget, used: j.tokensUsed }); } catch {}
    } else if ((m = out.match(/^# ss-semantic .*~tokens=(\d+)/m))) {
      per.push({ tool: 'ss-semantic', budget: null, used: +m[1] });
    } else if (/\bss-read\b/.test(cmd) || /\bss-grep\b/.test(cmd)) {
      per.push({ tool: /ss-read/.test(cmd) ? 'ss-read' : 'ss-grep', budget: null, used: Math.round(out.length / 4) });
    }
  }
  return per;
}
async function scoreUsdInlineLocal(probe, rawResponse, arm) {
  try {
    const rJudge = toRJudge(rawResponse, arm);
    const needUsdPanel = !probe.expectedNoMatch && !!rJudge.trim();
    const [panelCorrectness, panel] = await Promise.all([
      judgePanelScore({ probe, answer: rJudge, panel: JUDGE_PANEL }).then((r) => r.score).catch(() => null),
      needUsdPanel ? usdPanelScore({ probe, rJudge, panel: JUDGE_PANEL, runJudgeFn: runJudge, normalizeUsageFn: normalizeJudgeUsage, AllJudgesFailedError }).then((r) => r.panel).catch(() => []) : Promise.resolve([]),
    ]);
    const sc = scoreUSD({ probe, rawResponse, arm, panel, panelCorrectness, rubricHash: computeRubricHash(USD_PARAMS) });
    const usdNoC = probe.expectedNoMatch ? sc.USD : composeUSD({ g: sc.grounding, signalPurity: 1, content: sc.content, purity_ratio: sc.purity_ratio }, USD_PARAMS);
    return { USD: sc.USD, USD_noC: usdNoC, grounding: sc.grounding, content: sc.content, content_noD3: sc.content_noD3, purity_ratio: sc.purity_ratio, signal_purity: sc.signal_purity, usdTokens: sc.total_tokens };
  } catch (e) { return { usdError: e.message }; }
}
// Cost handles BOTH usage shapes: Anthropic (input_tokens = FRESH only; cache_read/
// cache_creation billed separately) and OpenAI/OpenRouter (input_tokens INCLUDES
// the cached subset; cached_input_tokens is the discounted portion).
const isAnthropicUsage = (u) => u && u.cache_read_input_tokens != null;
const totalIn = (u) => (isAnthropicUsage(u)
  ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  : (u?.input_tokens || 0));
const naive = (u) => (!u ? null : (totalIn(u) / 1e6) * PR.inPerM + ((u.output_tokens || 0) / 1e6) * PR.outPerM);
const realized = (u) => {
  if (!u) return null;
  const out = ((u.output_tokens || 0) / 1e6) * PR.outPerM;
  if (isAnthropicUsage(u)) {
    return ((u.input_tokens || 0) / 1e6) * PR.inPerM
      + ((u.cache_read_input_tokens || 0) / 1e6) * PR.cacheReadPerM
      + ((u.cache_creation_input_tokens || 0) / 1e6) * (PR.cacheWritePerM ?? PR.inPerM * 1.25)
      + out;
  }
  return (Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)) / 1e6) * PR.inPerM
    + ((u.cached_input_tokens || 0) / 1e6) * PR.cacheReadPerM
    + out;
};
const reap = () => { try { spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' }); } catch {} try { spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' }); } catch {} };
const prewarm = (cwd) => { try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env: { ...process.env, PATH: [SS_BIN, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd }, timeout: 180000, stdio: 'ignore' }); } catch {} };

// ─── CC-only: CLAUDE.md policy injection (per ARM, not per run — two probes can
// share a repo, and per-run backup/restore races under concurrency) ───────────
const GLOBAL_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md');
const PROJECT_MD = path.join(REPO, 'CLAUDE.md');
const BAK = '.ccbak';
const suppressMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) { try { if (fs.existsSync(f) && !fs.existsSync(f + BAK)) fs.renameSync(f, f + BAK); } catch {} } };
const restoreMd = () => { for (const f of [GLOBAL_MD, PROJECT_MD]) { try { if (fs.existsSync(f + BAK)) fs.renameSync(f + BAK, f); } catch {} } };
const repoMdBackups = new Map();
function injectRepoMd(cwds, content) {
  for (const c of cwds) {
    const md = path.join(c, 'CLAUDE.md');
    if (!repoMdBackups.has(md)) repoMdBackups.set(md, fs.existsSync(md) ? fs.readFileSync(md) : null);
    fs.writeFileSync(md, content);
  }
}
function restoreRepoMd() {
  for (const [md, bak] of repoMdBackups) {
    try { if (bak == null) fs.unlinkSync(md); else fs.writeFileSync(md, bak); } catch {}
  }
  repoMdBackups.clear();
}

// ─── one run ──────────────────────────────────────────────────────────────────
async function runOne(armDef, probe, rep) {
  const cwd = resolveRepoCwd(probe, {});
  const isMpp = armDef.mode === 'mpp';
  let run, normCalls;
  try {
    if (HARNESS === 'cc') {
      run = await runClaudeAgent({
        model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: '',
        cwd, projectRoot: cwd, extraPathEntries: isMpp ? [SS_BIN] : [],
        addDirs: [cwd], extraArgs: LEAN, stripApiKey: true, timeoutMs: 600000,
      });
      normCalls = normalizeClaudeCalls(run.toolCalls || [], run.toolResults);
    } else if (HARNESS === 'codex') {
      run = await runCodexAgent({
        prompt: buildAgentUserPrompt(probe), systemAppend: isMpp ? MPP : NATIVE,
        model: MODEL, cwd, sweetSearchBinDir: isMpp ? SS_BIN : undefined,
        reasoningEffort: REASONING, provider: 'openrouter', timeoutMs: 600000,
      });
      normCalls = normalizeCodexCalls(run.toolCalls || []);
    } else {
      run = await runOpenRouterApiAgent({
        model: MODEL, prompt: buildAgentUserPrompt(probe),
        systemAppend: isMpp ? MPP : NATIVE, cwd,
        sweetSearchBinDir: isMpp ? SS_BIN : undefined, allowSweetSearch: isMpp,
        maxToolCalls: (probe.max_turns || 12) + 4,
        maxTokens: MAXTOK, maxReadLines: READLINES, maxToolOutputChars: TOOLCHARS,
        captureToolResults: true, timeoutMs: 300000, reasoningEffort: REASONING,
      });
      normCalls = run.toolCalls || [];
    }
  } catch (e) {
    return { arm: armDef.name, id: probe.id, lang: probe.language, stratum: probe.stratum, rep, model: MODEL, harness: HARNESS, error: e.message, exitCode: -1 };
  }
  const arm = isMpp ? 'ss' : 'native';
  const rawResponse = buildArmResponse(normCalls, arm);
  const delivered = ssDelivered(normCalls);
  try {
    fs.mkdirSync(CAP_DIR, { recursive: true });
    fs.writeFileSync(path.join(CAP_DIR, `${armDef.name}.${probe.id}.rep${rep}.json`), JSON.stringify({
      arm: armDef.name, probeId: probe.id, rep, model: MODEL, harness: HARNESS, env: armDef.env, rawResponse,
      finalAnswer: run.finalResultText || run.finalAssistantText || '',
      toolCalls: normCalls.map((t) => ({ name: t.name, input: t.input, isError: t.result?.isError ?? null })),
    }));
  } catch {}
  const finalText = run.finalResultText || run.finalAssistantText || '';
  const [score, usd] = await Promise.all([
    judgePanelScore({ probe, answer: finalText, panel: JUDGE_PANEL }).then((r) => r.score).catch(() => null),
    scoreUsdInlineLocal(probe, rawResponse, arm),
  ]);
  return {
    arm: armDef.name, id: probe.id, lang: probe.language, stratum: probe.stratum, rep,
    model: MODEL, harness: HARNESS, score, ...usd,
    rawLen: rawResponse.length, calls: (run.toolCalls || []).length, ss: ssUsed(normCalls),
    ssCalls: delivered.length, ssDeliveredTokens: delivered.reduce((s, d) => s + (d.used || 0), 0),
    ssPerTool: delivered,
    wallMs: run.wallMs ?? null, usage: run.usage || null,
    costUsd: naive(run.usage), realizedUsd: realized(run.usage),
    harnessCostUsd: run.totalCostUsd ?? null,
    exitCode: run.exitCode, timedOut: !!run.timedOut,
  };
}

// ─── report mode ──────────────────────────────────────────────────────────────
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
function bootCI(deltas, iters = 2000, seed = 42) {
  if (!deltas.length) return [NaN, NaN];
  const rnd = mulberry32(seed); const ms = [];
  for (let i = 0; i < iters; i++) {
    const s = []; for (let j = 0; j < deltas.length; j++) s.push(deltas[Math.floor(rnd() * deltas.length)]);
    ms.push(mean(s));
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * iters)], ms[Math.floor(0.975 * iters)]];
}
function report() {
  if (!fs.existsSync(RUNS)) { console.error(`no runs.jsonl yet at ${RUNS}`); process.exit(1); }
  const rows = fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);
  const byArm = new Map();
  for (const r of rows) { if (!byArm.has(r.arm)) byArm.set(r.arm, []); byArm.get(r.arm).push(r); }
  const METRICS = [
    ['accuracy', (r) => r.score], ['USD_noC', (r) => r.USD_noC], ['content', (r) => r.content],
    ['grounding', (r) => r.grounding], ['purity', (r) => r.purity_ratio], ['usdTokens', (r) => r.usdTokens],
    ['ssDelivTok', (r) => r.ssDeliveredTokens], ['calls', (r) => r.calls],
    ['realized$', (r) => r.realizedUsd], ['naive$', (r) => r.costUsd], ['wallSec', (r) => (r.wallMs != null ? r.wallMs / 1000 : null)],
  ];
  console.log(`\n=== budget-sweep-smoke${TAG} aggregate (n rows per arm; ${MODEL} via ${HARNESS}) ===`);
  const hdr = ['arm', 'n', ...METRICS.map(([n]) => n)];
  const lines = [hdr];
  for (const a of ARMS.map((x) => x.name)) {
    const rs = byArm.get(a) || []; if (!rs.length) continue;
    lines.push([a, String(rs.length), ...METRICS.map(([, f]) => {
      const v = rs.map(f).filter((x) => x != null && Number.isFinite(x));
      return v.length ? mean(v).toFixed(v[0] >= 100 ? 0 : 3) : '—';
    })]);
  }
  const w = hdr.map((_, i) => Math.max(...lines.map((l) => (l[i] || '').length)) + 2);
  for (const l of lines) console.log(l.map((c, i) => (c || '').padEnd(w[i])).join(''));
  const ctrl = byArm.get('mpp-ctrl') || [];
  if (ctrl.length) {
    console.log(`\n=== paired Δ vs mpp-ctrl (per-probe mean over reps; 95% bootstrap CI over probes; * = CI excludes 0) ===`);
    const probeMean = (rs, f) => { const m = new Map(); for (const r of rs) { if (!m.has(r.id)) m.set(r.id, []); const v = f(r); if (v != null && Number.isFinite(v)) m.get(r.id).push(v); } return new Map([...m].map(([k, v]) => [k, mean(v)])); };
    for (const a of ARMS.map((x) => x.name)) {
      if (a === 'mpp-ctrl' || !byArm.has(a)) continue;
      const rs = byArm.get(a);
      const parts = [];
      for (const [mName, f] of METRICS) {
        const am = probeMean(rs, f), cm = probeMean(ctrl, f);
        const deltas = [...am.keys()].filter((k) => cm.has(k)).map((k) => am.get(k) - cm.get(k));
        if (!deltas.length) { parts.push(`${mName}=—`); continue; }
        const d = mean(deltas); const [lo, hi] = bootCI(deltas);
        const sig = (lo > 0 || hi < 0) ? '*' : '';
        parts.push(`${mName}=${d >= 0 ? '+' : ''}${d.toFixed(Math.abs(d) >= 100 ? 0 : 3)}${sig}`);
      }
      console.log(`  ${a.padEnd(11)} ${parts.join('  ')}`);
    }
    console.log(`\n  (ssDelivTok/usdTokens = delivered/judged response tokens — the trim verification)`);
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (REPORT) return report();
  fs.mkdirSync(OUT, { recursive: true });
  const done = new Set(fs.existsSync(RUNS)
    ? fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error).map((r) => `${r.arm}|${r.id}|${r.rep}`)
    : []);
  const total = arms.length * probes.length * REPS;
  console.error(`budget-sweep-smoke${TAG}: ${arms.length} arms × ${probes.length} probes × ${REPS} reps = ${total} runs (${done.size} already done) | ${MODEL} via ${HARNESS} reasoning=${REASONING}${HARNESS === 'cc' ? ' think=' + THINK : ''} conc=${CONC}`);
  const cwds = [...new Set(probes.map((p) => resolveRepoCwd(p, {})))];
  if (HARNESS === 'cc') { restoreMd(); suppressMd(); process.env.MAX_THINKING_TOKENS = THINK; }
  try {
    for (const armDef of arms) {
      // Arm env is process-global; arms run strictly sequentially, probes within
      // an arm run concurrently (env constant during the arm — safe). Warm ss
      // servers are reaped + respawned PER ARM so server-side env hooks
      // (SS_SMOKE_TIER_PREVIEW reads at server start) match the arm.
      for (const k of ALL_SMOKE_ENV) delete process.env[k];
      Object.assign(process.env, armDef.env);
      const tasks = [];
      for (let rep = 1; rep <= REPS; rep++) for (const p of probes) {
        if (done.has(`${armDef.name}|${p.id}|${rep}`)) continue;
        tasks.push({ p, rep });
      }
      if (!tasks.length) { console.error(`[${armDef.name}] all done, skipping`); continue; }
      reap();
      if (armDef.mode === 'mpp') { console.error(`[${armDef.name}] prewarming ${cwds.length} ss servers...`); for (const c of cwds) prewarm(c); }
      if (HARNESS === 'cc') injectRepoMd(cwds, armDef.mode === 'mpp' ? MPP : NATIVE);
      console.error(`\n[${armDef.name}] ${tasks.length} runs (env: ${JSON.stringify(armDef.env)})`);
      let idx = 0;
      const worker = async () => {
        while (idx < tasks.length) {
          const t = tasks[idx++];
          const row = await runOne(armDef, t.p, t.rep);
          fs.appendFileSync(RUNS, JSON.stringify(row) + '\n');
          console.error(`  [${armDef.name}] ${t.p.id.padEnd(11)} rep${t.rep} acc=${row.score ?? '—'} USDnoC=${row.USD_noC != null ? row.USD_noC.toFixed(3) : '—'} calls=${row.calls ?? '—'} ssTok=${row.ssDeliveredTokens ?? 0} $${row.realizedUsd != null ? row.realizedUsd.toFixed(4) : '—'} ${row.wallMs != null ? (row.wallMs / 1000).toFixed(0) + 's' : ''}${row.timedOut ? ' TIMEOUT' : ''}${row.error ? ' ERR:' + row.error.slice(0, 80) : ''}${row.usdError ? ' USDERR:' + row.usdError.slice(0, 60) : ''}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, worker));
      if (HARNESS === 'cc') restoreRepoMd();
    }
  } finally {
    if (HARNESS === 'cc') { restoreRepoMd(); restoreMd(); }
  }
  console.error('\nsweep complete. Run with --report for the aggregate.');
})();
