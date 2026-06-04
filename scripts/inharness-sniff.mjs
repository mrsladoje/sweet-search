#!/usr/bin/env node
/**
 * In-harness production sniff — the REAL deployment path: M++ injected via
 * CLAUDE.md (Claude Code) / AGENTS.md (Codex), NOT --append-system-prompt.
 * Runs the actual harness with reasoning ON, and measures the two scary
 * questions: (1) ss-ENGAGEMENT — does the model use ss-* (via Bash) when M++
 * lives in project memory + it ALSO has native Grep available, or does it fall
 * back to native? (2) calls + accuracy vs native. Restores the repo after each run.
 *
 *   IDS=cpp-003,csharp-006,java-006 HARNESS=codex  MODEL=gpt-5.5        REASON=high MODE=mpp    REPS=1 node scripts/inharness-sniff.mjs
 *   IDS=...                          HARNESS=claude MODEL=claude-opus-4-8 THINK=31999 MODE=native REPS=1 ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeAgent } from '../eval/agent-read-workflows/claude-runner.js';
import { runCodexAgent } from '../core/prompt-optimization/sweep/p7-codex-runner.mjs';
import { resolveRepoCwd, buildAgentUserPrompt, classifyToolUse, judgePanelScore, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { buildArmResponse, normalizeClaudeCalls, normalizeCodexCalls, scoreUsdInline, persistCapture } from '../core/prompt-optimization/sweep/usd-capture.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP_PATH = process.env.PROMPT_FILE
  ? (path.isAbsolute(process.env.PROMPT_FILE) ? process.env.PROMPT_FILE : path.join(REPO, process.env.PROMPT_FILE))
  : path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md');
const MPP = fs.readFileSync(MPP_PATH, 'utf8');
const NATIVE_POLICY = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, and reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;

const PROBE_SET_FILE = process.env.PROBES || 'core/prompt-optimization/data/frozen/p7-heldout-probes.json';
const heldout = (() => { const p = JSON.parse(fs.readFileSync(path.isAbsolute(PROBE_SET_FILE) ? PROBE_SET_FILE : path.join(REPO, PROBE_SET_FILE), 'utf8')); return Array.isArray(p) ? p : (p.probes || p.dev || []); })();
const byId = new Map(heldout.map((p) => [p.id, p]));

const IDS = (process.env.IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const HARNESS = process.env.HARNESS || 'codex';
const MODE = process.env.MODE || 'mpp';
const MODEL = process.env.MODEL || (HARNESS === 'claude' ? 'claude-opus-4-8' : 'gpt-5.5');
const REASON = process.env.REASON || 'high';
const THINK = process.env.THINK || '31999';
const REPS = Number(process.env.REPS || 1);
const PROVIDER = process.env.PROVIDER || undefined; // 'openrouter' → Codex backed by OpenRouter (bypasses $20 Codex-plan wall, keeps Codex harness)
const RUN = process.env.RUN || `inharness-${HARNESS}-${MODE}`;
const OUTDIR = path.join(REPO, 'core/prompt-optimization/data/results', RUN);
fs.mkdirSync(OUTDIR, { recursive: true });

const instrName = HARNESS === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
const body = MODE === 'mpp' ? MPP : NATIVE_POLICY;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
// Cache-naive cost (the §3 headline metric): every input token at the FULL uncached
// rate. GPT-5.5 prices pinned (p7-shared targetPrices, 2026-05-29). Opus-4.8 list price
// not yet pinned → cost deferred (usage still recorded so it can be costed later).
// GPT-5.5 pinned (p7-shared targetPrices, 2026-05-29). Opus-4.8 = standard Opus tier
// (in 15 / out 75 / cacheRead 1.50 / cacheWrite 18.75 per Mtok — VERIFY before publishing;
// the M++-vs-native RATIO is price-robust regardless). Realized cost computed in analysis.
const PRICES = {
  gpt5_5: { inPerM: 5, outPerM: 30, cacheReadPerM: 0.50, cacheWritePerM: 5 },
  opus: { inPerM: 15, outPerM: 75, cacheReadPerM: 1.50, cacheWritePerM: 18.75 },
};
const COST_TARGET = HARNESS === 'claude' ? 'opus' : 'gpt5_5';
// Cache-naive total input: Codex/responses `input_tokens` is already the TOTAL (cached is
// a reported subset); Anthropic `input_tokens` is FRESH (cache_read/cache_creation separate)
// → total = input + cache_read + cache_creation. Both priced at the full uncached rate.
function totalInputTokens(u) {
  if (!u) return 0;
  if (typeof u.cache_read_input_tokens === 'number' || typeof u.cache_creation_input_tokens === 'number') {
    return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); // anthropic
  }
  return u.input_tokens || 0; // codex (already total)
}
function usageToCost(u) {
  const p = PRICES[COST_TARGET];
  if (!u || !p || typeof u.input_tokens !== 'number') return null;
  return (totalInputTokens(u) / 1e6) * p.inPerM + ((u.output_tokens || 0) / 1e6) * p.outPerM;
}
const rows = [];

console.error(`in-harness sniff: ${HARNESS}/${MODE} model=${MODEL} ${HARNESS === 'claude' ? 'MAX_THINKING_TOKENS=' + THINK : 'reasoning=' + REASON} | inject via ${instrName} | ids=${IDS.join(',')} reps=${REPS}`);
for (const id of IDS) {
  const probe = byId.get(id);
  if (!probe) { console.error('  (no held-out probe: ' + id + ')'); continue; }
  const cwd = resolveRepoCwd(probe, {});
  const instrPath = path.join(cwd, instrName);
  const had = fs.existsSync(instrPath);
  const backup = had ? fs.readFileSync(instrPath) : null;
  for (let r = 0; r < REPS; r++) {
    fs.writeFileSync(instrPath, body);
    let run;
    try {
      if (HARNESS === 'claude') {
        process.env.MAX_THINKING_TOKENS = THINK;
        run = await runClaudeAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: '', cwd, projectRoot: cwd, extraPathEntries: MODE === 'mpp' ? [SS_BIN] : [], addDirs: [cwd], timeoutMs: 600000 });
      } else {
        run = await runCodexAgent({ model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: '', cwd, sweetSearchBinDir: MODE === 'mpp' ? SS_BIN : undefined, reasoningEffort: REASON, provider: PROVIDER, timeoutMs: 600000 });
      }
    } finally {
      if (had) fs.writeFileSync(instrPath, backup); else { try { fs.unlinkSync(instrPath); } catch { /* */ } }
    }
    const calls = Array.isArray(run.toolCalls) ? run.toolCalls : [];
    const finalText = run.finalResultText || run.finalAssistantText || '';
    const tu = classifyToolUse(calls);
    // USD: build the per-arm raw tool-response (harness-specific normalizer), persist it
    // (re-scorable forever), and score — for EVERY harness, not just bare-API.
    const arm = MODE === 'mpp' ? 'ss' : 'native';
    const normCalls = HARNESS === 'claude' ? normalizeClaudeCalls(run.toolCalls, run.toolResults) : normalizeCodexCalls(run.toolCalls);
    const rawResponse = buildArmResponse(normCalls, arm);
    persistCapture(path.join(OUTDIR, 'captures'), { probeId: id, arm, rep: r, model: MODEL, harness: HARNESS, rawResponse, finalAnswer: finalText, toolCalls: normCalls });
    const [score, usd] = await Promise.all([
      judgePanelScore({ probe, answer: finalText, panel: JUDGE_PANEL }).then((x) => x.score).catch(() => null),
      scoreUsdInline(probe, rawResponse, arm),
    ]);
    const usage = run.usage || null;
    const cost = usageToCost(usage);
    const reasoningTok = usage && typeof usage.reasoning_output_tokens === 'number' ? usage.reasoning_output_tokens : null;
    const row = { id, lang: probe.language, stratum: probe.stratum, rep: r, harness: HARNESS, mode: MODE, model: MODEL, provider: PROVIDER || null, score, ...usd, rawLen: rawResponse.length, calls: calls.length, ss: !!tu.ss, nativeGrep: !!tu.nativeSearch, nativeRead: !!tu.nativeRead, answerLen: finalText.length, usage, costUsd: cost, harnessCostUsd: run.totalCostUsd ?? null, wallMs: run.wallMs ?? null, reasoningTokens: reasoningTok, exitCode: run.exitCode, timedOut: !!run.timedOut };
    rows.push(row);
    fs.writeFileSync(path.join(OUTDIR, 'rows.json'), JSON.stringify(rows, null, 2));
    console.error(`  ✓ ${id} r${r} score=${score} USDnoC=${row.USD_noC != null ? row.USD_noC.toFixed(3) : (row.usdError ? 'ERR' : '–')} g=${row.grounding ?? '–'} calls=${calls.length} ss=${row.ss} nativeGrep=${row.nativeGrep}${cost != null ? ' $' + cost.toFixed(4) : ''}${run.wallMs != null ? ' ' + (run.wallMs / 1000).toFixed(0) + 's' : ''}${reasoningTok != null ? ' rtok=' + reasoningTok : ''} exit=${run.exitCode}${row.timedOut ? ' TIMEOUT' : ''}`);
  }
}
const costs = rows.map((r) => r.costUsd).filter((c) => c != null);
console.log(`\n${RUN}: n=${rows.length}  acc=${mean(rows.map((r) => r.score || 0)).toFixed(3)}  calls=${mean(rows.map((r) => r.calls)).toFixed(1)}  ss-rate=${(100 * rows.filter((r) => r.ss).length / Math.max(1, rows.length)).toFixed(0)}%  nativeGrep-rate=${(100 * rows.filter((r) => r.nativeGrep).length / Math.max(1, rows.length)).toFixed(0)}%${costs.length ? '  $/run=' + (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4) : ''}`);
