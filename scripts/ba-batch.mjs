#!/usr/bin/env node
/**
 * bare-API vault batch runner — the "generic integrator" cell. Hand-rolled API agent loop
 * (runOpenRouterApiAgent: Bash+Read function-tools), DeepSeek-V4-Pro by default, conc=1.
 * Policy via systemAppend (the system prompt; no AGENTS.md/CLAUDE.md). ss-* gated by
 * allowSweetSearch + sweetSearchBinDir on PATH. Bash escape-guard now lives in the runner.
 * Same v60 vault + resolveRepoCwd. Reap-between-batches, escape-detection, 3-panel judge.
 * Cursor (ba-vault-state.json); 12 batches = 1 rep. native×5 then M++×5.
 *   node scripts/ba-batch.mjs              # DeepSeek-V4-Pro
 *   MODEL=openai/gpt-5.5 node scripts/ba-batch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runOpenRouterApiAgent, runAnthropicApiAgent } from '../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';
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
const MODEL = process.env.MODEL || 'deepseek/deepseek-v4-pro';
const BATCH = Number(process.env.BATCH_SIZE || 5);
const REASONING = process.env.REASONING || 'high';  // runner default is 'minimal' (GEPA instant target); DeepSeek "max effort" needs high
const MAXTOK = Number(process.env.MAXTOK || 32000); // room for high-reasoning tokens + answer on big-context probes
const READLINES = Number(process.env.READLINES || 2000);    // real-agent-parity Read budget (Claude Code reads ~2000 lines/call)
const TOOLCHARS = Number(process.env.TOOLCHARS || 64000);   // ditto for tool-output chars (default runner cap 12000 cripples big-file reads)
const IS_ANTHROPIC = /claude|sonnet|haiku|opus/i.test(MODEL); // route Claude models to the Anthropic-direct loop (instant: no thinking param)
const TAG = process.env.TAG || (MODEL.includes('deepseek') ? 'ba-ds' : IS_ANTHROPIC ? 'ba-sonnet' : 'ba-gpt');
// Prices per 1M tokens (cache-naive = all input at full rate). ba-ds = DeepSeek-DIRECT official
// deepseek-v4-pro (api-docs.deepseek.com, post-2026-05-31 permanent): in 0.435 / out 0.87 / cache-hit 0.003625.
// ba-sonnet = Anthropic claude-sonnet-4-6 (verify rates before publishing cost).
const PRICES = { 'ba-ds': { inPerM: 0.435, outPerM: 0.87, cacheReadPerM: 0.003625 }, 'ba-gpt': { inPerM: 5, outPerM: 30, cacheReadPerM: 0.5 }, 'ba-sonnet': { inPerM: 3, outPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 } };
const PR = PRICES[TAG] || PRICES['ba-ds'];

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = Array.isArray(vault) ? vault : (vault.probes || []);
const RESULTS = path.join(REPO, 'core/prompt-optimization/data/results');
const STATE = path.join(RESULTS, `${TAG}-vault-state.json`);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const reap = () => { try { spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' }); } catch {} try { spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' }); } catch {} };
const prewarm = (cwd) => { try { spawnSync('ss-search', ['warmup', '-k', '1'], { cwd, env: { ...process.env, PATH: [SS_BIN, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd }, timeout: 180000, stdio: 'ignore' }); } catch {} };

const ABS = /\/Users\/admin\/Projects\/sweet-search-private[^\s"'`)]*/g;
const ANSWER = /(gold\/|data\/frozen|data\/results|p7-vault-probes|p7-heldout|p7-dev-probes|prompt-optimization\/data)/;
const cmdText = (c) => (typeof c?.input?.command === 'string' ? c.input.command : (c?.input?.file_path || ''));
function analyze(calls, cwd) {
  let escape = 0, leak = 0;
  for (const c of calls) { const t = cmdText(c);
    if (ANSWER.test(t)) { leak++; continue; }
    let esc = false; for (const p of (t.match(ABS) || [])) if (!p.startsWith(cwd)) esc = true;
    const cd = t.match(/\bcd\s+(\/[^\s;&|]+)/); if (cd && !cd[1].startsWith(cwd)) esc = true;
    if (esc) escape++;
  }
  return { escape, leak };
}
const ssUsed = (calls) => calls.some((c) => /\bss-(search|find|semantic|trace|grep|read)\b/.test(cmdText(c)));

// ─── USD (tool-response usefulness) captured INLINE on every run ──────────────
// The raw tool responses are persisted to CAP_DIR so a run is NEVER un-re-scorable
// (the lesson from the Sonnet run that stored only score/calls/usage). USD/USD_noC
// are also computed inline (try/catch — a USD failure never breaks the moat row).
const CAP_DIR = path.join(RESULTS, `${TAG}-vault-captures`);
const SS_CMD_RE = /\bss-(search|find|semantic|trace|grep|read)\b/;
const NATIVE_SEARCH_RE = /\b(rg|ripgrep|grep|egrep|fgrep|ag|ack|find)\b/;
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
  }
  return blocks.join('\n\n');
}
async function scoreUsdInline(probe, rawResponse, arm) {
  try {
    const rJudge = toRJudge(rawResponse, arm);
    const needUsdPanel = !probe.expectedNoMatch && !!rJudge.trim();
    // USD grounding-judge ∥ USD-dimensions-panel (independent reads of rJudge)
    const [panelCorrectness, panel] = await Promise.all([
      judgePanelScore({ probe, answer: rJudge, panel: JUDGE_PANEL }).then((r) => r.score).catch(() => null),
      needUsdPanel ? usdPanelScore({ probe, rJudge, panel: JUDGE_PANEL, runJudgeFn: runJudge, normalizeUsageFn: normalizeJudgeUsage, AllJudgesFailedError }).then((r) => r.panel).catch(() => []) : Promise.resolve([]),
    ]);
    const sc = scoreUSD({ probe, rawResponse, arm, panel, panelCorrectness, rubricHash: computeRubricHash(USD_PARAMS) });
    const usdNoC = probe.expectedNoMatch ? sc.USD : composeUSD({ g: sc.grounding, signalPurity: 1, content: sc.content, purity_ratio: sc.purity_ratio }, USD_PARAMS);
    return { USD: sc.USD, USD_noC: usdNoC, grounding: sc.grounding, content: sc.content, content_noD3: sc.content_noD3, purity_ratio: sc.purity_ratio, signal_purity: sc.signal_purity, usdTokens: sc.total_tokens };
  } catch (e) { return { usdError: e.message }; }
}
// Cost handles BOTH usage shapes: OpenAI/OpenRouter (input_tokens INCLUDES the cached subset; cached_input_tokens)
// and Anthropic-direct (input_tokens = FRESH only; cache_read_input_tokens + cache_creation_input_tokens billed separately).
const isAnthropicUsage = (u) => u && u.cache_read_input_tokens != null;
const totalIn = (u) => (isAnthropicUsage(u) ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : (u?.input_tokens || 0));
const naive = (u) => (!u ? null : (totalIn(u) / 1e6) * PR.inPerM + ((u.output_tokens || 0) / 1e6) * PR.outPerM);
const realized = (u) => {
  if (!u) return null;
  const out = ((u.output_tokens || 0) / 1e6) * PR.outPerM;
  if (isAnthropicUsage(u)) return ((u.input_tokens || 0) / 1e6) * PR.inPerM + ((u.cache_read_input_tokens || 0) / 1e6) * PR.cacheReadPerM + ((u.cache_creation_input_tokens || 0) / 1e6) * (PR.cacheWritePerM ?? PR.inPerM * 1.25) + out;
  return (Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)) / 1e6) * PR.inPerM + ((u.cached_input_tokens || 0) / 1e6) * PR.cacheReadPerM + out;
};

async function runOne(probe, mode, rep) {
  const cwd = resolveRepoCwd(probe, {});
  let run;
  try {
    const _req = { model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: mode === 'mpp' ? MPP : NATIVE, cwd, sweetSearchBinDir: mode === 'mpp' ? SS_BIN : undefined, allowSweetSearch: mode === 'mpp', maxToolCalls: probe.max_turns || 12, maxTokens: MAXTOK, maxReadLines: READLINES, maxToolOutputChars: TOOLCHARS, captureToolResults: true, timeoutMs: 300000 };
    run = IS_ANTHROPIC ? await runAnthropicApiAgent(_req) : await runOpenRouterApiAgent({ ..._req, reasoningEffort: REASONING });
  } catch (e) { return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, score: null, calls: 0, ss: false, escape: 0, leak: 0, wallMs: null, usage: null, costUsd: null, exitCode: -1, error: e.message }; }
  const calls = run.toolCalls || [];
  const a = analyze(calls, cwd);
  const arm = mode === 'mpp' ? 'ss' : 'native';
  const rawResponse = buildArmResponse(calls, arm);
  // ALWAYS persist the raw tool responses (so USD is re-scorable forever, no agent re-run)
  try { fs.mkdirSync(CAP_DIR, { recursive: true }); fs.writeFileSync(path.join(CAP_DIR, `${probe.id}.${arm}.rep${rep}.json`), JSON.stringify({ probeId: probe.id, arm, rep, model: MODEL, rawResponse, finalAnswer: run.finalResultText || '', toolCalls: calls.map((t) => ({ name: t.name, input: t.input, isError: t.result?.isError ?? null })) })); } catch {}
  // accuracy judge (final answer) ∥ USD scoring (raw response) — independent inputs, run concurrently
  const [score, usd] = await Promise.all([
    judgePanelScore({ probe, answer: run.finalResultText || '', panel: JUDGE_PANEL }).then((r) => r.score).catch(() => null),
    scoreUsdInline(probe, rawResponse, arm), // {USD, USD_noC, ...} or {usdError}
  ]);
  return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, harness: 'bare-api', score, ...usd, rawLen: rawResponse.length, calls: calls.length, ss: ssUsed(calls), escape: a.escape, leak: a.leak, wallMs: run.wallMs ?? null, usage: run.usage || null, costUsd: naive(run.usage), realizedUsd: realized(run.usage), exitCode: run.exitCode, timedOut: !!run.timedOut };
}
const append = (mode, rows) => { const d = path.join(RESULTS, `${TAG}-vault-${mode === 'mpp' ? 'mpp' : 'native'}`); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, 'rows.json'); const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; fs.writeFileSync(f, JSON.stringify(prev.concat(rows), null, 2)); };

(async () => {
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { rep: 1, offset: 0 };
  if (state.offset >= probes.length) { state.rep += 1; state.offset = 0; }
  const batch = probes.slice(state.offset, state.offset + BATCH);
  console.error(`\n=== ba-batch (${TAG}): rep ${state.rep}, probes ${state.offset + 1}-${state.offset + batch.length}/${probes.length} | ${MODEL} bare-API, conc=1, systemAppend inject ===`);
  console.error('  ' + batch.map((p) => `${p.id}(${p.language})`).join(', '));
  const out = { native: [], mpp: [] };
  reap();
  const cwds = [...new Set(batch.map((p) => resolveRepoCwd(p, {})))];
  console.error(`  prewarming ${cwds.length} ss-* server(s)...`); for (const c of cwds) prewarm(c);
  for (const mode of ['native', 'mpp']) {
    for (const probe of batch) {
      const row = await runOne(probe, mode, state.rep);
      out[mode].push(row);
      console.error(`  [${mode.padEnd(6)}] ${row.id.padEnd(15)} score=${row.score} calls=${String(row.calls).padEnd(2)} ss=${row.ss} ${row.wallMs != null ? (row.wallMs / 1000).toFixed(0) + 's' : '?'}${row.costUsd != null ? ' $' + row.costUsd.toFixed(4) : ''} escape=${row.escape} leak=${row.leak} exit=${row.exitCode}${row.error ? ' ERR:' + row.error.slice(0, 60) : ''}`);
    }
  }
  reap();
  append('native', out.native); append('mpp', out.mpp);
  state.offset += batch.length; fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  const sm = (r, f) => mean(r.map(f));
  console.log(`\n--- BA BATCH DONE (${TAG}, rep ${state.rep}, ${state.offset}/${probes.length}) ---`);
  for (const [lbl, r] of [['native', out.native], ['M++   ', out.mpp]]) console.log(`  ${lbl}: acc=${sm(r, (x) => x.score || 0).toFixed(3)} USDnoC=${sm(r, (x) => x.USD_noC || 0).toFixed(3)} USD=${sm(r, (x) => x.USD || 0).toFixed(3)} calls=${sm(r, (x) => x.calls).toFixed(1)} ss=${(100 * r.filter((x) => x.ss).length / Math.max(1, r.length)).toFixed(0)}% naive$=${sm(r, (x) => x.costUsd || 0).toFixed(4)} usdErr=${r.filter((x) => x.usdError).length} escape=${r.reduce((s, x) => s + x.escape, 0)} leak=${r.reduce((s, x) => s + x.leak, 0)} err=${r.filter((x) => x.exitCode !== 0).length}`);
  console.log(`  → M++ vs native: calls ${sm(out.mpp, (x) => x.calls).toFixed(1)} vs ${sm(out.native, (x) => x.calls).toFixed(1)}; NEXT probes ${state.offset >= probes.length ? 1 : state.offset + 1}-${Math.min(state.offset + BATCH, probes.length)}`);
})();
