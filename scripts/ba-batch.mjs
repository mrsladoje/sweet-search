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
import { runOpenRouterApiAgent } from '../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';
import { resolveRepoCwd, buildAgentUserPrompt, judgePanelScore, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

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
const TAG = process.env.TAG || (MODEL.includes('deepseek') ? 'ba-ds' : 'ba-gpt');
// Prices per 1M tokens (cache-naive = all input at full rate). ba-ds = DeepSeek-DIRECT official
// deepseek-v4-pro (api-docs.deepseek.com, post-2026-05-31 permanent): in 0.435 / out 0.87 / cache-hit 0.003625.
const PRICES = { 'ba-ds': { inPerM: 0.435, outPerM: 0.87, cacheReadPerM: 0.003625 }, 'ba-gpt': { inPerM: 5, outPerM: 30, cacheReadPerM: 0.5 } };
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
const tin = (u) => (u?.input_tokens || 0); // OpenAI-style: input_tokens already includes cached subset
const naive = (u) => (!u ? null : (tin(u) / 1e6) * PR.inPerM + ((u.output_tokens || 0) / 1e6) * PR.outPerM);
const realized = (u) => (!u ? null : (Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)) / 1e6) * PR.inPerM + ((u.cached_input_tokens || 0) / 1e6) * PR.cacheReadPerM + ((u.output_tokens || 0) / 1e6) * PR.outPerM);

async function runOne(probe, mode, rep) {
  const cwd = resolveRepoCwd(probe, {});
  let run;
  try {
    run = await runOpenRouterApiAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: mode === 'mpp' ? MPP : NATIVE, cwd, sweetSearchBinDir: mode === 'mpp' ? SS_BIN : undefined, allowSweetSearch: mode === 'mpp', maxToolCalls: probe.max_turns || 12, reasoningEffort: REASONING, maxTokens: MAXTOK, maxReadLines: READLINES, maxToolOutputChars: TOOLCHARS, timeoutMs: 300000 });
  } catch (e) { return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, score: null, calls: 0, ss: false, escape: 0, leak: 0, wallMs: null, usage: null, costUsd: null, exitCode: -1, error: e.message }; }
  const calls = run.toolCalls || [];
  const a = analyze(calls, cwd);
  let score = null; try { ({ score } = await judgePanelScore({ probe, answer: run.finalResultText || '', panel: JUDGE_PANEL })); } catch { score = null; }
  return { id: probe.id, lang: probe.language, stratum: probe.stratum, rep, mode, model: MODEL, harness: 'bare-api', score, calls: calls.length, ss: ssUsed(calls), escape: a.escape, leak: a.leak, wallMs: run.wallMs ?? null, usage: run.usage || null, costUsd: naive(run.usage), realizedUsd: realized(run.usage), exitCode: run.exitCode, timedOut: !!run.timedOut };
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
  for (const [lbl, r] of [['native', out.native], ['M++   ', out.mpp]]) console.log(`  ${lbl}: acc=${sm(r, (x) => x.score || 0).toFixed(3)} calls=${sm(r, (x) => x.calls).toFixed(1)} ss=${(100 * r.filter((x) => x.ss).length / Math.max(1, r.length)).toFixed(0)}% naive$=${sm(r, (x) => x.costUsd || 0).toFixed(4)} escape=${r.reduce((s, x) => s + x.escape, 0)} leak=${r.reduce((s, x) => s + x.leak, 0)} err=${r.filter((x) => x.exitCode !== 0).length}`);
  console.log(`  → M++ vs native: calls ${sm(out.mpp, (x) => x.calls).toFixed(1)} vs ${sm(out.native, (x) => x.calls).toFixed(1)}; NEXT probes ${state.offset >= probes.length ? 1 : state.offset + 1}-${Math.min(state.offset + BATCH, probes.length)}`);
})();
