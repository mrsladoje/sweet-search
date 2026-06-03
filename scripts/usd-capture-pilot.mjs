#!/usr/bin/env node
/**
 * USD metric — capture + score PILOT (Metric Forge §6.1 / §7 / §13 end-to-end).
 *
 * Proves the whole path works on a SMALL slate (default 3 probes): for each probe
 * it runs BOTH arms (ss-* via the Mpp policy; native rg/grep/find+read via the
 * neutral native policy) through the bare-API agent runner with verbatim
 * tool-RESULT capture, builds the per-arm tool-response bytes `R`, persists both
 * arms verbatim (§7.1), then scores each with the 3-panel USD judge (§7.2) and
 * reports the per-arm USD + the §5b caliper-matched paired Δ on common support.
 *
 * Real runs only. DeepSeek ALWAYS via the direct API. conc=1. Reap orphaned
 * cli.js --serve / index-maintainer between arms. NO commits.
 *
 *   DEEPSEEK_API_KEY=… GEMINI_API_KEY=… MINIMAX_API_KEY=… \
 *     MODEL=deepseek/deepseek-v4-pro PILOT_N=3 node scripts/usd-capture-pilot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runOpenRouterApiAgent } from '../core/prompt-optimization/sweep/p7-api-agent-runner.mjs';
import {
  resolveRepoCwd, buildAgentUserPrompt, judgePanelScore, JUDGE_PANEL,
  normalizeJudgeUsage, AllJudgesFailedError,
} from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runJudge } from '../eval/agent-read-workflows/judge-runner.js';
import {
  toRJudge, usdPanelScore, scoreUSD, computeRubricHash, caliperMatchedDelta, USD_PARAMS,
} from '../core/prompt-optimization/sweep/usd-metric.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;

// Judge panel (disjoint families, median over survivors). Default = the spec's
// 3-panel; the pilot uses a 2-judge disjoint panel (deepseek-api + google-api)
// when MINIMAX_API_KEY is absent, honoring "no Claude-family sole judge" and the
// budget feedback (route batch judging through DeepSeek/Gemini direct).
const PANEL = (process.env.USD_PANEL
  ? process.env.USD_PANEL.split(',').map((s) => { const [lineage, model] = s.split('|'); return { lineage, model }; })
  : JUDGE_PANEL.filter((p) => p.lineage !== 'minimax' || process.env.MINIMAX_API_KEY));

const MODEL = process.env.MODEL || 'deepseek/deepseek-v4-pro';
const PILOT_N = Number(process.env.PILOT_N || 3);
const REASONING = process.env.REASONING || 'high';
const MAXTOK = Number(process.env.MAXTOK || 32000);
const READLINES = Number(process.env.READLINES || 2000);
const TOOLCHARS = Number(process.env.TOOLCHARS || 64000);
const RUN_ID = process.env.RUN_ID || `pilot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;

const OUT = path.join(REPO, 'core/prompt-optimization/data/metric-forge');
const CAP_DIR = path.join(OUT, 'captures', RUN_ID);
const SCORE_DIR = path.join(OUT, 'scores', RUN_ID);
fs.mkdirSync(CAP_DIR, { recursive: true });
fs.mkdirSync(SCORE_DIR, { recursive: true });

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const allProbes = Array.isArray(vault) ? vault : (vault.probes || []);
// Pilot slate: a spread across strata so the path is exercised broadly.
const PILOT_IDS = (process.env.PILOT_IDS || '').split(',').filter(Boolean);
let probes;
if (PILOT_IDS.length) {
  probes = PILOT_IDS.map((id) => allProbes.find((p) => p.id === id)).filter(Boolean);
} else {
  const byStratum = (s) => allProbes.find((p) => p.stratum === s);
  probes = [byStratum('literal-lookup'), byStratum('multi-file-flow'), byStratum('no-match'), byStratum('behavioral')]
    .filter(Boolean).slice(0, PILOT_N);
}

const reap = () => {
  try { spawnSync('pkill', ['-f', 'core/cli\\.js'], { stdio: 'ignore' }); } catch { /* noop */ }
  try { spawnSync('pkill', ['-9', '-f', 'index-maintainer\\.mjs'], { stdio: 'ignore' }); } catch { /* noop */ }
};
const prewarm = (cwd) => {
  try {
    spawnSync('ss-search', ['warmup', '-k', '1'], {
      cwd, env: { ...process.env, PATH: [SS_BIN, process.env.PATH].join(':'), SWEET_SEARCH_PROJECT_ROOT: cwd },
      timeout: 180000, stdio: 'ignore',
    });
  } catch { /* noop */ }
};

const SS_CMD_RE = /\bss-(search|find|semantic|trace|grep|read)\b/;
const NATIVE_SEARCH_RE = /\b(rg|ripgrep|grep|egrep|fgrep|ag|ack|find)\b/;

/**
 * Build the per-arm tool-RESPONSE bytes `R` from a trajectory. The metric scores
 * the tool OUTPUTS (the bytes the tools returned), so we concatenate the captured
 * tool-call results that belong to the arm's retrieval surface:
 *   - ss arm:     ss-* command outputs (+ any Read the policy issued).
 *   - native arm: rg/grep/find search outputs + Read outputs.
 * Each block is prefixed with the command/file for provenance (kept; the
 * locator is content per §5d.3 — chrome is stripped later by toRJudge).
 */
function buildArmResponse(toolCalls, arm) {
  const blocks = [];
  for (const tc of toolCalls) {
    const result = tc.result?.content;
    if (typeof result !== 'string' || !result.trim()) continue;
    if (arm === 'ss') {
      const cmd = String(tc.input?.command || '');
      if (tc.name === 'Bash' && SS_CMD_RE.test(cmd)) blocks.push(result);
      else if (tc.name === 'Read') blocks.push(`${tc.input?.file_path || ''}\n${result}`);
    } else {
      const cmd = String(tc.input?.command || '');
      if (tc.name === 'Bash' && (NATIVE_SEARCH_RE.test(cmd))) blocks.push(`$ ${cmd}\n${result}`);
      else if (tc.name === 'Read') blocks.push(`${tc.input?.file_path || ''}\n${result}`);
      else if (tc.name === 'Bash') blocks.push(`$ ${cmd}\n${result}`); // sed/nl/cat etc.
    }
  }
  return blocks.join('\n\n');
}

async function captureArm(probe, arm) {
  const cwd = resolveRepoCwd(probe, {});
  const isSs = arm === 'ss';
  let run;
  try {
    run = await runOpenRouterApiAgent({
      model: MODEL, prompt: buildAgentUserPrompt(probe), systemAppend: isSs ? MPP : NATIVE,
      cwd, sweetSearchBinDir: isSs ? SS_BIN : undefined, allowSweetSearch: isSs,
      maxToolCalls: probe.max_turns || 12, reasoningEffort: REASONING, maxTokens: MAXTOK,
      maxReadLines: READLINES, maxToolOutputChars: TOOLCHARS, timeoutMs: 300000,
      captureToolResults: true,
    });
  } catch (e) {
    return { probeId: probe.id, arm, error: e.message, rawResponse: '', toolCalls: [] };
  }
  const toolCalls = run.toolCalls || [];
  const rawResponse = buildArmResponse(toolCalls, arm);
  // native competence gate diagnostic (§6.3): does the native read-surface contain
  // an expected symbol? (full readGoldRecall needs C^G line ranges; we log the
  // symbol-presence proxy for the pilot.)
  let readGoldRecall = null;
  if (!isSs) {
    const syms = probe.expectedSymbols || [];
    readGoldRecall = syms.length ? syms.filter((s) => rawResponse.includes(s)).length / syms.length : null;
  }
  return {
    probeId: probe.id, arm, runId: RUN_ID, rawResponse,
    toolCalls: toolCalls.map((t) => ({ name: t.name, input: t.input, isError: t.result?.isError ?? null })),
    finalAnswer: run.finalResultText || '',
    readGoldRecall,
    capturedAt: new Date().toISOString(), harness: 'bare-api', model: MODEL,
    wallMs: run.wallMs ?? null, exitCode: run.exitCode,
  };
}

async function scoreArm(probe, capture) {
  const rJudge = toRJudge(capture.rawResponse, capture.arm);
  const rubricHash = computeRubricHash(USD_PARAMS);
  // floor judge: reuse the existing 3-panel correctness on the FINAL answer is
  // NOT what we want — we floor on the RESPONSE. Use the correctness panel on the
  // tool-response bytes as the floor confirmation (it sees R + gold).
  let panelCorrectness = null;
  try {
    const { score } = await judgePanelScore({ probe, answer: rJudge, panel: PANEL });
    panelCorrectness = score;
  } catch { panelCorrectness = null; }

  // no-match probes skip the content panel (the formula is g·max(0,1−tok/τ)).
  let panel = [];
  if (!probe.expectedNoMatch && rJudge.trim()) {
    try {
      const r = await usdPanelScore({
        probe, rJudge, panel: PANEL, runJudgeFn: runJudge,
        normalizeUsageFn: normalizeJudgeUsage, AllJudgesFailedError,
      });
      panel = r.panel;
    } catch (e) {
      return { probeId: probe.id, arm: capture.arm, error: `usd-panel-failed: ${e.message}`, rubricHash };
    }
  }
  const score = scoreUSD({ probe, rawResponse: capture.rawResponse, arm: capture.arm, panel, panelCorrectness, rubricHash });
  return { ...score, panelCorrectness, panel: panel.map((p) => ({ model: p.model, lineage: p.lineage, verdictByCriterion: p.verdictByCriterion, isError: p.isError })) };
}

(async () => {
  console.error(`\n=== USD capture+score PILOT (run ${RUN_ID}) | ${MODEL} bare-API direct, conc=1 ===`);
  console.error(`  probes: ${probes.map((p) => `${p.id}(${p.stratum})`).join(', ')}`);
  console.error(`  rubricHash=${computeRubricHash(USD_PARAMS)}`);

  const scores = { ss: [], native: [] };
  for (const probe of probes) {
    reap();
    const cwd = resolveRepoCwd(probe, {});
    console.error(`\n--- ${probe.id} (${probe.stratum}, ${probe.language}) — prewarming ss server ---`);
    prewarm(cwd);
    for (const arm of ['ss', 'native']) {
      const cap = await captureArm(probe, arm);
      fs.writeFileSync(path.join(CAP_DIR, `${probe.id}.${arm}.json`), JSON.stringify(cap, null, 2));
      const rTokens = Math.round((cap.rawResponse || '').length / 4);
      console.error(`  [${arm.padEnd(6)}] captured: ${cap.toolCalls.length} calls, R≈${rTokens} tok${cap.error ? ' ERR:' + cap.error.slice(0, 50) : ''}${cap.readGoldRecall != null ? ` readGoldRecall=${cap.readGoldRecall.toFixed(2)}` : ''}`);
      const sc = await scoreArm(probe, cap);
      fs.writeFileSync(path.join(SCORE_DIR, `${probe.id}.${arm}.json`), JSON.stringify(sc, null, 2));
      if (sc.error) {
        console.error(`  [${arm.padEnd(6)}] SCORE ERR: ${sc.error}`);
      } else {
        console.error(`  [${arm.padEnd(6)}] USD=${sc.USD?.toFixed(3)} g=${sc.grounding} content=${sc.content?.toFixed(2)} C=${sc.signal_purity} pr=${sc.purity_ratio?.toFixed(2)} tot=${sc.total_tokens} used=${sc.used_tokens_AST} [D1${sc.D1}D2${sc.D2}D3${sc.D3}D4${sc.D4}D5${sc.D5}]`);
        scores[arm].push({ probeId: probe.id, total_tokens: sc.total_tokens, USD: sc.USD, content: sc.content, content_noD3: sc.content_noD3, metrics: { content_noD3: sc.content_noD3, content: sc.content, USD: sc.USD } });
      }
    }
  }
  reap();

  // §5b headline: caliper-matched paired Δ on common support.
  const delta = caliperMatchedDelta(scores.ss, scores.native);
  const mean = (a, f) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : 0);
  const summary = {
    runId: RUN_ID, model: MODEL, rubricHash: computeRubricHash(USD_PARAMS), n: probes.length,
    perArm: {
      ss: { meanUSD: mean(scores.ss, (x) => x.USD), meanContentNoD3: mean(scores.ss, (x) => x.content_noD3), meanTokens: mean(scores.ss, (x) => x.total_tokens), n: scores.ss.length },
      native: { meanUSD: mean(scores.native, (x) => x.USD), meanContentNoD3: mean(scores.native, (x) => x.content_noD3), meanTokens: mean(scores.native, (x) => x.total_tokens), n: scores.native.length },
    },
    headline_caliperMatchedDelta: delta,
  };
  fs.writeFileSync(path.join(OUT, `pilot-summary-${RUN_ID}.json`), JSON.stringify(summary, null, 2));
  console.log('\n=== PILOT SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\ncaptures: ${CAP_DIR}\nscores:   ${SCORE_DIR}\nsummary:  ${path.join(OUT, `pilot-summary-${RUN_ID}.json`)}`);
})();
