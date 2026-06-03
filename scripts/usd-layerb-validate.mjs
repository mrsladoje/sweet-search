#!/usr/bin/env node
/**
 * USD metric — Layer-B validation: does the intrinsic USD predict downstream
 * usefulness? (Metric Forge §8.4, the PROVISIONAL external-validity signal.)
 *
 * STRUCTURAL CONSTRAINT (disclosed honestly): the execution-grounded
 * task-completion bench (eval/task-completion-bench/) runs on SWE-bench-Lite task
 * IDs (pallets__flask-*, pylint-dev__*) with NO per-probe join to the 60-probe
 * vault, and its n=14 variance pilot shows resolve-rate PARITY. So the spec's
 * "validated" label (F2P∧P2P resolve-delta) is NOT yet attainable. Per spec §8,
 * we run the MINIMAL external signal: the ANSWER-FED-SOLVER on the 60 probes.
 *
 * Answer-fed-solver: feed each arm's captured tool-RESPONSE R (the bytes USD
 * scored) to an OFF-PANEL solver (Claude / anthropic-api — NOT on the USD panel
 * deepseek+gemini+minimax, so the correlation is de-circularized), ask it to
 * answer the probe FROM R ALONE, then grade that answer for correctness against
 * gold with the existing 3-panel correctness judge. solverSuccess ∈ {0,1}.
 *
 * Then: correlate per-(probe,arm) USD / USD_noC / content_noD3 with solverSuccess
 * (Spearman ρ + Kendall τ + bootstrap CI), and LENGTH-CONTROL it (partial corr
 * removing log(total_tokens)) — a correlation that vanishes under length-control
 * is the verbosity confound at the validity layer (disclosed).
 *
 *   ANTHROPIC_API_KEY=… DEEPSEEK_API_KEY=… GEMINI_API_KEY=… OPENROUTER_API_KEY=… \
 *     RUN_ID=run-v1 node scripts/usd-layerb-validate.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgePanelScore, JUDGE_PANEL } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { runJudge } from '../eval/agent-read-workflows/judge-runner.js';
import { toRJudge, pairedBootstrapCI } from '../core/prompt-optimization/sweep/usd-metric.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'core/prompt-optimization/data/metric-forge');
const RUN_ID = process.env.RUN_ID;
if (!RUN_ID) { console.error('set RUN_ID'); process.exit(1); }
const CAP_DIR = path.join(OUT, 'captures', RUN_ID);
const SCORE_DIR = path.join(OUT, 'scores', RUN_ID);
const LB_DIR = path.join(OUT, 'layerb', RUN_ID);
fs.mkdirSync(LB_DIR, { recursive: true });

const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const allProbes = Array.isArray(vault) ? vault : (vault.probes || []);
const probeById = new Map(allProbes.map((p) => [p.id, p]));

// OFF-PANEL solver: Claude (anthropic-api) is disjoint from the USD panel
// (deepseek-api + google-api + minimax). De-circularizes Layer B per spec §8.
const SOLVER = { lineage: process.env.SOLVER_LINEAGE || 'anthropic-api', model: process.env.SOLVER_MODEL || 'claude-haiku-4-5' };
// Correctness grader for the solver answer: the existing 3-panel (deepseek+gemini+minimax).
function gradePanel() {
  return JUDGE_PANEL.map((p) => (p.lineage === 'minimax' && !process.env.MINIMAX_API_KEY && process.env.OPENROUTER_API_KEY)
    ? { lineage: 'minimax', model: 'minimax/minimax-m2.7' } : p);
}
const GRADE_PANEL = gradePanel();

const SOLVER_SYS =
  'You are a senior engineer answering a code-search question. You are given ONLY ' +
  'a set of code-search TOOL OUTPUTS for the repository, and the QUESTION. Answer ' +
  'the question USING ONLY the provided tool outputs — cite the specific file(s), ' +
  'symbol(s), and the concrete fact(s) that answer it. If the provided outputs do ' +
  'NOT contain enough to answer, say exactly "INSUFFICIENT — cannot answer from the ' +
  'provided outputs." Do NOT speculate beyond the outputs. Be concise.';

const SOLVER_THRESH = 0.6; // solverSuccess = correctness ≥ this (binary)

async function solveAndGrade(probe, rJudge) {
  if (!rJudge.trim()) return { solverAnswer: '', correctness: 0, solverSuccess: 0, insufficient: true };
  const userPrompt = `## Question\n${probe.query}\n\n## Provided tool outputs (the ONLY evidence)\n${rJudge}\n\n## Your answer`;
  let solverAnswer = '';
  try {
    const r = await runJudge({ lineage: SOLVER.lineage, model: SOLVER.model, systemPrompt: SOLVER_SYS, userPrompt });
    solverAnswer = r.isError ? '' : (r.text || '');
  } catch (e) { solverAnswer = ''; }
  const insufficient = /INSUFFICIENT/i.test(solverAnswer) || !solverAnswer.trim();
  let correctness = 0;
  if (!insufficient) {
    try { const { score } = await judgePanelScore({ probe, answer: solverAnswer, panel: GRADE_PANEL }); correctness = score ?? 0; }
    catch { correctness = 0; }
  } else if (probe.expectedNoMatch) {
    // a correct "insufficient/no-answer" on a no-match probe IS success.
    correctness = 1;
  }
  // for no-match probes, the solver succeeds iff it declines / says no match.
  let solverSuccess;
  if (probe.expectedNoMatch) solverSuccess = (insufficient || /no match|not found|no result/i.test(solverAnswer)) ? 1 : 0;
  else solverSuccess = correctness >= SOLVER_THRESH ? 1 : 0;
  return { solverAnswer: solverAnswer.slice(0, 4000), correctness, solverSuccess, insufficient };
}

// Spearman rank correlation
function spearman(x, y) {
  const n = x.length; if (n < 4) return null;
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(n); let i = 0; while (i < n) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const rx = rank(x), ry = rank(y);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = rx[i] - mx, dy = ry[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function kendall(x, y) {
  const n = x.length; if (n < 4) return null;
  let c = 0, d = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = Math.sign(x[i] - x[j]), b = Math.sign(y[i] - y[j]);
    if (a * b > 0) c++; else if (a * b < 0) d++;
  }
  const denom = 0.5 * n * (n - 1);
  return denom ? (c - d) / denom : null;
}
// bootstrap CI for a correlation (resample paired observations)
function corrBootstrapCI(x, y, fn, B = 10000) {
  const n = x.length; if (n < 4) return [null, null];
  const out = [];
  for (let b = 0; b < B; b++) {
    const xs = [], ys = [];
    for (let i = 0; i < n; i++) { const k = (Math.random() * n) | 0; xs.push(x[k]); ys.push(y[k]); }
    const r = fn(xs, ys); if (r != null && !Number.isNaN(r)) out.push(r);
  }
  if (!out.length) return [null, null];
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * out.length)], out[Math.floor(0.975 * out.length)]];
}
// partial Spearman controlling for log(tokens): rank-residualize both, then correlate
function partialSpearmanControllingTokens(metric, success, tokens) {
  const n = metric.length; if (n < 5) return null;
  const lg = tokens.map((t) => Math.log(Math.max(1, t)));
  // residualize via simple linear regression on lg, then Spearman of residuals
  const resid = (v) => {
    const mx = lg.reduce((a, b) => a + b, 0) / n, my = v.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (lg[i] - mx) * (v[i] - my); sxx += (lg[i] - mx) ** 2; }
    const beta = sxx ? sxy / sxx : 0; const a0 = my - beta * mx;
    return v.map((vi, i) => vi - (a0 + beta * lg[i]));
  };
  return spearman(resid(metric), resid(success));
}

(async () => {
  console.error(`=== USD Layer-B answer-fed-solver validation (run ${RUN_ID}) ===`);
  console.error(`  solver (OFF-PANEL): ${SOLVER.lineage}:${SOLVER.model}; grader: ${GRADE_PANEL.map((p) => p.lineage).join('+')}`);
  // join captures+scores
  const obs = []; // { probeId, arm, USD, USD_noC, content_noD3, total_tokens, solverSuccess, ... }
  const capFiles = fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.json'));
  for (const f of capFiles) {
    const cap = JSON.parse(fs.readFileSync(path.join(CAP_DIR, f), 'utf8'));
    if (cap.error || !cap.probeId) continue;
    const probe = probeById.get(cap.probeId); if (!probe) continue;
    const scoreF = path.join(SCORE_DIR, `${cap.probeId}.${cap.arm}.json`);
    if (!fs.existsSync(scoreF)) continue;
    const sc = JSON.parse(fs.readFileSync(scoreF, 'utf8')); if (sc.error) continue;
    const rJudge = toRJudge(cap.rawResponse, cap.arm);
    const lbF = path.join(LB_DIR, `${cap.probeId}.${cap.arm}.json`);
    let lb;
    if (fs.existsSync(lbF)) { lb = JSON.parse(fs.readFileSync(lbF, 'utf8')); } // resumable
    else {
      lb = await solveAndGrade(probe, rJudge);
      fs.writeFileSync(lbF, JSON.stringify({ probeId: cap.probeId, arm: cap.arm, ...lb }, null, 2));
    }
    obs.push({ probeId: cap.probeId, arm: cap.arm, stratum: probe.stratum, USD: sc.USD, USD_noC: sc.USD_noC, content_noD3: sc.content_noD3, content: sc.content, grounding: sc.grounding, total_tokens: sc.total_tokens, solverSuccess: lb.solverSuccess, correctness: lb.correctness });
    console.error(`  ${cap.probeId}.${cap.arm}: USD=${(sc.USD ?? 0).toFixed(2)} noC=${(sc.USD_noC ?? 0).toFixed(2)} noD3=${(sc.content_noD3 ?? 0).toFixed(2)} → solverSuccess=${lb.solverSuccess} (corr=${(lb.correctness ?? 0).toFixed(2)})`);
  }

  // correlations (pooled over both arms — the intrinsic→downstream relation)
  const analyze = (key) => {
    const x = obs.map((o) => o[key] ?? 0), y = obs.map((o) => o.solverSuccess ?? 0), t = obs.map((o) => o.total_tokens ?? 1);
    const rho = spearman(x, y), tau = kendall(x, y);
    const [lo, hi] = corrBootstrapCI(x, y, spearman);
    const partial = partialSpearmanControllingTokens(x, y, t);
    return { spearman: rho, kendall: tau, ci: [lo, hi], partialSpearman_lengthControlled: partial, n: x.length };
  };
  const result = {
    runId: RUN_ID, solver: SOLVER, gradePanel: GRADE_PANEL.map((p) => `${p.lineage}:${p.model}`),
    solverThreshold: SOLVER_THRESH, n: obs.length,
    note: 'PROVISIONAL validity (answer-fed-solver). NOT the execution-grounded F2P∧P2P resolve-delta — the task-completion bench has no per-probe join to the vault and shows resolve-parity at n=14.',
    solverSuccessRate: { ss: mean(obs.filter((o) => o.arm === 'ss'), (o) => o.solverSuccess), native: mean(obs.filter((o) => o.arm === 'native'), (o) => o.solverSuccess) },
    correlations: { USD: analyze('USD'), USD_noC: analyze('USD_noC'), content_noD3: analyze('content_noD3'), content: analyze('content'), grounding: analyze('grounding') },
  };
  function mean(a, f) { return a.length ? a.reduce((s, x) => s + (f(x) ?? 0), 0) / a.length : 0; }
  fs.writeFileSync(path.join(OUT, `layerb-${RUN_ID}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nlayerb: ${path.join(OUT, `layerb-${RUN_ID}.json`)}`);
})();
