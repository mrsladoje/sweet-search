#!/usr/bin/env node
/**
 * USD metric — FULL capture + score RUN (Metric Forge Phase 5, powered).
 *
 * Generalizes scripts/usd-capture-pilot.mjs to the full 60-probe vault (or a
 * pre-committed slice via SLICE_IDS), the full 3-panel disjoint-family judge
 * (deepseek-direct + gemini-direct + minimax-via-OpenRouter), and the §7.3
 * aggregate: per-arm means, the §5b caliper-matched paired Δ on common token
 * support (the HEADLINE), the DIV-2 with/without-C robustness twin, per-stratum
 * breakdown, no-match confident-false-positive rate, and the length-control audit.
 *
 * Real runs only. DeepSeek ALWAYS direct. conc=1. Reap orphaned cli.js --serve /
 * index-maintainer between probes. NO commits. RESUMABLE: existing captures are
 * reused (re-scored), so an interrupted long run can be re-invoked.
 *
 *   DEEPSEEK_API_KEY=… GEMINI_API_KEY=… OPENROUTER_API_KEY=… \
 *     RUN_ID=run-v1 node scripts/usd-capture-run.mjs
 *
 *   # pre-committed slice (logged exactly):
 *   SLICE_IDS="cpp-001,cpp-006,..." RUN_ID=run-v1 node scripts/usd-capture-run.mjs
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
  toRJudge, usdPanelScore, scoreUSD, computeRubricHash, caliperMatchedDelta,
  composeUSD, USD_PARAMS,
} from '../core/prompt-optimization/sweep/usd-metric.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const MPP = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpp.md'), 'utf8');
const NATIVE = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;

// FULL 3-panel disjoint families. minimax routes via OpenRouter (minimax/minimax-m2.7)
// when MINIMAX_API_KEY is unset but OPENROUTER_API_KEY is present — DeepSeek STAYS
// direct (the locked rule binds DeepSeek only). Override with USD_PANEL.
function defaultPanel() {
  if (process.env.USD_PANEL) {
    return process.env.USD_PANEL.split(',').map((s) => { const [lineage, model] = s.split('|'); return { lineage, model }; });
  }
  return JUDGE_PANEL.map((p) => {
    if (p.lineage === 'minimax' && !process.env.MINIMAX_API_KEY && process.env.OPENROUTER_API_KEY) {
      return { lineage: 'minimax', model: 'minimax/minimax-m2.7' };
    }
    return p;
  }).filter((p) => p.lineage !== 'minimax' || process.env.MINIMAX_API_KEY || process.env.OPENROUTER_API_KEY);
}
const PANEL = defaultPanel();

const MODEL = process.env.MODEL || 'deepseek/deepseek-v4-pro';
const REASONING = process.env.REASONING || 'high';
const MAXTOK = Number(process.env.MAXTOK || 32000);
const READLINES = Number(process.env.READLINES || 2000);
const TOOLCHARS = Number(process.env.TOOLCHARS || 64000);
const RUN_ID = process.env.RUN_ID || `run-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;

const OUT = path.join(REPO, 'core/prompt-optimization/data/metric-forge');
const CAP_DIR = path.join(OUT, 'captures', RUN_ID);
const SCORE_DIR = path.join(OUT, 'scores', RUN_ID);
fs.mkdirSync(CAP_DIR, { recursive: true });
fs.mkdirSync(SCORE_DIR, { recursive: true });

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const allProbes = Array.isArray(vault) ? vault : (vault.probes || []);
const SLICE_IDS = (process.env.SLICE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const probes = SLICE_IDS.length
  ? SLICE_IDS.map((id) => allProbes.find((p) => p.id === id)).filter(Boolean)
  : allProbes;

// Stratified dev/held-out split (seed=42): the 24-probe gold/dev subset is for
// inspection; the 36 held-out are aggregate-only. We tag each probe; per-query
// inspection of held-out is NOT done here (aggregate only).
function stratifiedDevSplit(ps, seed = 42) {
  // deterministic LCG shuffle within each stratum, take 40% as dev.
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const byStratum = {};
  for (const p of ps) (byStratum[p.stratum] ||= []).push(p);
  const dev = new Set();
  for (const k of Object.keys(byStratum)) {
    const arr = byStratum[k].slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; }
    const nDev = Math.round(arr.length * 0.4);
    for (let i = 0; i < nDev; i++) dev.add(arr[i].id);
  }
  return dev;
}
const DEV_IDS = stratifiedDevSplit(allProbes);

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
      if (tc.name === 'Bash' && NATIVE_SEARCH_RE.test(cmd)) blocks.push(`$ ${cmd}\n${result}`);
      else if (tc.name === 'Read') blocks.push(`${tc.input?.file_path || ''}\n${result}`);
      else if (tc.name === 'Bash') blocks.push(`$ ${cmd}\n${result}`); // sed/nl/cat etc.
    }
  }
  return blocks.join('\n\n');
}

async function captureArm(probe, arm) {
  const capPath = path.join(CAP_DIR, `${probe.id}.${arm}.json`);
  if (fs.existsSync(capPath)) { // RESUMABLE: reuse a prior capture
    try {
      const prev = JSON.parse(fs.readFileSync(capPath, 'utf8'));
      if (prev && typeof prev.rawResponse === 'string' && prev.toolCalls && !prev.error) return { ...prev, _reused: true };
    } catch { /* re-capture */ }
  }
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
    return { probeId: probe.id, arm, runId: RUN_ID, error: e.message, rawResponse: '', toolCalls: [] };
  }
  const toolCalls = run.toolCalls || [];
  const rawResponse = buildArmResponse(toolCalls, arm);
  // native competence gate proxy (§6.3): symbol-presence in the read surface
  // (full readGoldRecall needs C^G line ranges, which are not annotated on the vault).
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
  let panelCorrectness = null;
  try {
    const { score } = await judgePanelScore({ probe, answer: rJudge, panel: PANEL });
    panelCorrectness = score;
  } catch { panelCorrectness = null; }

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
  // DIV-2 twin: USD WITHOUT the C (signal_purity) multiplicative gate.
  // USD_noC = g · content · densityMultiplier(pr). (no-match uses its own formula)
  const usdNoC = probe.expectedNoMatch
    ? score.USD
    : composeUSD({ g: score.grounding, signalPurity: 1, content: score.content, purity_ratio: score.purity_ratio }, USD_PARAMS);
  return {
    ...score, USD_noC: usdNoC, panelCorrectness,
    stratum: probe.stratum, language: probe.language, repo: probe.repo,
    isDev: DEV_IDS.has(probe.id),
    panel: panel.map((p) => ({ model: p.model, lineage: p.lineage, verdictByCriterion: p.verdictByCriterion, isError: p.isError })),
  };
}

(async () => {
  console.error(`\n=== USD FULL RUN (run ${RUN_ID}) | ${MODEL} bare-API direct, conc=1 ===`);
  console.error(`  panel: ${PANEL.map((p) => `${p.lineage}:${p.model}`).join(', ')}`);
  console.error(`  probes: ${probes.length} (${SLICE_IDS.length ? 'SLICE' : 'FULL vault'}); dev=${[...DEV_IDS].length}`);
  console.error(`  rubricHash=${computeRubricHash(USD_PARAMS)}`);

  const all = [];
  let idx = 0;
  for (const probe of probes) {
    idx++;
    reap();
    const cwd = resolveRepoCwd(probe, {});
    console.error(`\n[${idx}/${probes.length}] ${probe.id} (${probe.stratum}, ${probe.language}) — prewarm`);
    prewarm(cwd);
    for (const arm of ['ss', 'native']) {
      const cap = await captureArm(probe, arm);
      fs.writeFileSync(path.join(CAP_DIR, `${probe.id}.${arm}.json`), JSON.stringify(cap, null, 2));
      const rTokens = Math.round((cap.rawResponse || '').length / 4);
      console.error(`  [${arm.padEnd(6)}] ${cap._reused ? '(reused)' : 'captured'}: ${cap.toolCalls?.length ?? 0} calls, R≈${rTokens} tok${cap.error ? ' ERR:' + cap.error.slice(0, 50) : ''}${cap.readGoldRecall != null ? ` rgr=${cap.readGoldRecall.toFixed(2)}` : ''}`);
      const sc = await scoreArm(probe, cap);
      fs.writeFileSync(path.join(SCORE_DIR, `${probe.id}.${arm}.json`), JSON.stringify(sc, null, 2));
      if (sc.error) console.error(`  [${arm.padEnd(6)}] SCORE ERR: ${sc.error}`);
      else console.error(`  [${arm.padEnd(6)}] USD=${sc.USD?.toFixed(3)} USDnoC=${sc.USD_noC?.toFixed(3)} g=${sc.grounding} cont=${sc.content?.toFixed(2)} noD3=${sc.content_noD3?.toFixed(2)} C=${sc.signal_purity} pr=${sc.purity_ratio?.toFixed(3)} tot=${sc.total_tokens} [D1${sc.D1}D2${sc.D2}D3${sc.D3}D4${sc.D4}D5${sc.D5}]`);
      all.push(sc);
    }
  }
  reap();
  fs.writeFileSync(path.join(OUT, `run-scores-${RUN_ID}.json`), JSON.stringify(all, null, 2));
  console.log(`\nDONE. scores: ${SCORE_DIR}\naggregate inputs: ${path.join(OUT, `run-scores-${RUN_ID}.json`)}`);
  console.log(`Run scripts/usd-aggregate.mjs RUN_ID=${RUN_ID} for the §7.3 report.`);
})();
