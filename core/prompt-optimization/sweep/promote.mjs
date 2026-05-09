/**
 * P6.4 — Promotion gate: emit `recommendations.json` from Track A + Track B
 * results, gated on the FIVE mandatory checks per §7.6.
 *
 * The five gates:
 *
 *   1. **BH-FDR at q=0.10** across the full Layer A shape × tool claim space
 *      — per-shape-cell paired-permutation p-value must survive Benjamini-
 *      Hochberg correction. (`stats/bh-fdr.mjs:benjaminiHochberg`).
 *      Note: the test is two-sided. We only PROMOTE shapes whose mean-shape
 *      recall@1 exceeds the V4 baseline (one-sided interpretation enforced
 *      in `pickPerToolBest`); BH-FDR handles the multi-comparison correction.
 *   2. **Thresholdout confirmation** on Q-shape held-out (uv 30-probe set).
 *      For each candidate "best shape" per tool, query the Thresholdout
 *      oracle (1 query per tool × ≤3 in-scope tools = ≤3 of the campaign
 *      26-query envelope). Promote only if oracle returns AGREE or DIFFER
 *      in the candidate's favour. (`stats/thresholdout.mjs:openThresholdout`).
 *      Limitation: in this driver we feed Thresholdout the held-out cell
 *      mean computed from Track A's uv-tier rows in the same run; that is
 *      "sealed by convention", not by structural access control. The plan
 *      requires this be routed through the Sealed-1 manifest accessor in
 *      production. We surface this caveat in `summary.thresholdout_method`.
 *   3. **Token-overlap leakage gate** on the candidate `instruction_text`
 *      — the string MUST NOT contain ≥3-grams from Dev probe symbols / paths
 *      / answers. (`decontamination/leakage-gate.mjs:checkLeakage`)
 *   4. **Independent-author check** — the `instruction_text` must be
 *      authored or reviewed by an engineer who is NOT the primary author of
 *      the gold tasks for that tool's sweep. The per-tool slice is defined
 *      as: golds whose `predicted_winning_tool` matches `tool` (the slice
 *      the optimisation is targeting); falling back to the full gold set
 *      when no per-tool prediction exists. Recorded in
 *      `recommendations.json:independent_author_check.gold_authors_slice`.
 *   5. **Per-repo cross-shape stability check** (added 2026-05-09 with the
 *      vercel/ai-chatbot 5th dev repo). For each candidate "best shape,"
 *      compute per-repo `recall@1` across the dev repos derived dynamically
 *      from `golds.json:summary.byRepo` (tier=dev). Reject promotion if
 *      (a) the worst-repo recall@1 is < 0.6 of the best-repo recall@1, OR
 *      (b) ai-chatbot's recall@1 is more than 2σ below the cross-repo mean.
 *      Failures recorded under `not_promoted_due_to_repo_instability`.
 *      A partial sweep that did not cover all expected dev repos fails the
 *      gate with reason `partial_sweep_missing_repos` (lists the missing
 *      repos so the operator can re-run rather than silently promoting on a
 *      narrowed evidence base).
 *
 * Strict-by-default: a gate marked `skipped` (e.g. Thresholdout under
 * `--skip-thresholdout`) or `not_run` (Track B absent) BLOCKS promotion.
 * Pass `--allow-incomplete-promotion` for diagnostic runs; in that mode
 * `recommendations.incomplete_promotion = true` and per-tool blocks carry
 * the missing-evidence reasons so a downstream consumer cannot mistake the
 * artifact for a shippable promotion.
 *
 * Plan reference: §7.6 promotion artifact, §0.5 dual-layer overfit framework.
 *
 * Output schema: `data/query-shapes/recommendations.json` per the §7.6
 * machine-readable contract. Per_tool blocks now include Track-B-derived
 * fields (`agent_e2e_success`, `n_e2e`, `judge_iaa_alpha`, `prp_win_rate`)
 * when track-b.jsonl is present; explicit nulls + reason codes when absent.
 *
 * Usage:
 *   node core/prompt-optimization/sweep/promote.mjs --run qshape-v1
 *   node core/prompt-optimization/sweep/promote.mjs --run qshape-v1 --allow-incomplete-promotion --skip-thresholdout
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { benjaminiHochberg, survivors } from '../stats/bh-fdr.mjs';
import { pairedPermutationTest } from '../stats/paired-permutation.mjs';
import { openThresholdout, initBudgetLog } from '../stats/thresholdout.mjs';
import { buildLeakageCorpus, checkLeakage, loadWhitelist } from '../decontamination/leakage-gate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const QSHAPE_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes');
const RESULTS_BASE = path.join(REPO_ROOT, 'core/prompt-optimization/data/results');
const WHITELIST_PATH = path.join(REPO_ROOT, 'core/prompt-optimization/decontamination/leakage-whitelist.txt');

const Q = 0.10;
const TOOLS_IN_SCOPE = ['ss-search', 'ss-find', 'ss-semantic', 'structural'];

// ─── argv ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = {
    runId: null,
    skipThresholdout: false,
    allowIncompletePromotion: false,
    independentAuthor: 'sweet-search-core-secondary',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.runId = argv[++i];
    else if (a === '--skip-thresholdout') o.skipThresholdout = true;
    else if (a === '--allow-incomplete-promotion') o.allowIncompletePromotion = true;
    else if (a === '--author') o.independentAuthor = argv[++i];
  }
  if (!o.runId) {
    process.stderr.write('promote: --run <runId> required\n');
    process.exit(2);
  }
  return o;
}

// ─── load Track A records ─────────────────────────────────────────────────

function loadTrackARecords(runId) {
  const p = path.join(RESULTS_BASE, runId, 'track-a.jsonl');
  if (!existsSync(p)) {
    process.stderr.write(
      `promote: ${p} missing — Track A must run before promotion. ` +
      `node core/prompt-optimization/sweep/track-a.mjs --run ${runId}\n`
    );
    process.exit(2);
  }
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function loadTrackBRecords(runId) {
  const p = path.join(RESULTS_BASE, runId, 'track-b.jsonl');
  if (!existsSync(p)) return null; // Track B is optional in early phases
  // track-b.jsonl interleaves agent records and judge records
  // (`_kind: 'judge'`); the loader returns both partitioned.
  const all = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const agents = all.filter((r) => r._kind !== 'judge');
  const judges = all.filter((r) => r._kind === 'judge');
  // (G1.) Read the companion summary if present — it carries the IAA
  // result (Krippendorff α + per-judge breakdown). Without the summary,
  // the IAA gate falls through to `not_run`.
  const summaryPath = path.join(RESULTS_BASE, runId, 'track-b-summary.json');
  let summary = null;
  if (existsSync(summaryPath)) {
    try { summary = JSON.parse(readFileSync(summaryPath, 'utf8')); }
    catch { /* malformed — ignore */ }
  }
  return { agents, judges, summary };
}

// ─── group by shape × tool, compute paired tests vs baseline (V4) ─────────

function buildShapeCellTests(records) {
  const byTool = new Map();
  for (const r of records) {
    if (!r.metrics) continue;
    if (r.metrics.file_recall_at_1 == null) continue;
    if (!byTool.has(r.tool)) byTool.set(r.tool, []);
    byTool.get(r.tool).push(r);
  }
  const tests = [];
  const cellMeans = new Map();
  let nCellsConsidered = 0;
  let nCellsBelowPairFloor = 0;
  for (const [tool, recs] of byTool) {
    const byGold = new Map();
    for (const r of recs) {
      if (!byGold.has(r.goldId)) byGold.set(r.goldId, new Map());
      byGold.get(r.goldId).set(r.variantId, r);
    }
    const shapeRecords = new Map();
    for (const r of recs) {
      if (!shapeRecords.has(r.shape)) shapeRecords.set(r.shape, []);
      shapeRecords.get(r.shape).push(r);
    }
    for (const [shape, list] of shapeRecords) {
      const mean = list.reduce((s, r) => s + (r.metrics.file_recall_at_1 || 0), 0) / list.length;
      cellMeans.set(`${tool}|${shape}`, { tool, shape, n: list.length, mean });
    }
    for (const [shape, list] of shapeRecords) {
      if (list.every((r) => r.isBaseline)) continue;
      nCellsConsidered += 1;
      const paired = { a: [], b: [] };
      let baselineMean = null;
      let nBaseline = 0;
      let baselineSum = 0;
      for (const r of list) {
        const sib = byGold.get(r.goldId);
        if (!sib) continue;
        const baseline = [...sib.values()].find((x) => x.isBaseline);
        if (!baseline || baseline.metrics?.file_recall_at_1 == null) continue;
        paired.a.push(r.metrics.file_recall_at_1 || 0);
        paired.b.push(baseline.metrics.file_recall_at_1 || 0);
        baselineSum += baseline.metrics.file_recall_at_1 || 0;
        nBaseline += 1;
      }
      baselineMean = nBaseline > 0 ? baselineSum / nBaseline : null;
      if (paired.a.length < 5) {
        nCellsBelowPairFloor += 1;
        continue;
      }
      const t = pairedPermutationTest({ a: paired.a, b: paired.b });
      tests.push({
        id: `${tool}::${shape}`,
        pValue: t.pValue,
        meta: {
          tool,
          shape,
          n: paired.a.length,
          observedDiff: t.observedDiff,
          meanShape: cellMeans.get(`${tool}|${shape}`).mean,
          baselineMean,
        },
      });
    }
  }
  return { tests, cellMeans, nCellsConsidered, nCellsBelowPairFloor };
}

// ─── per-tool best shape (after BH-FDR, one-sided "beats baseline") ───────

function pickPerToolBest(bhResult, cellMeans) {
  // BH-FDR survives → significant difference; promote ONLY when the shape's
  // mean exceeds the V4 baseline (one-sided beats-baseline interpretation
  // applied here, after the two-sided test). pairedPermutationTest does a
  // two-sided abs-diff test; we drop survivors whose observed diff is
  // negative (shape worse than baseline).
  const surv = survivors(bhResult).filter((s) => (s.meta?.observedDiff ?? 0) > 0);
  const byTool = new Map();
  for (const s of surv) {
    const tool = s.meta.tool;
    if (!byTool.has(tool)) byTool.set(tool, []);
    byTool.get(tool).push(s);
  }
  const winners = {};
  for (const [tool, list] of byTool) {
    list.sort((a, b) => b.meta.meanShape - a.meta.meanShape);
    winners[tool] = list[0];
  }
  return { winners, allSurvivors: surv };
}

// ─── instruction_text drafting ────────────────────────────────────────────

function draftInstructionText(tool, shape) {
  // Per §7.6 the `instruction_text` goes verbatim into the T1-T14 variant
  // bodies in Part 6. Templates keyed on shape coordinates. They MUST pass
  // the leakage gate (gate #3) — generic English, no symbol names.
  //
  // All six dimensions in `parseShape` (length, symbol, regex, framing,
  // density, intentVerb) are folded into the output so the variant grid
  // commentary matches the produced text. (B8.)
  const dims = parseShape(shape);
  const parts = [];
  if (tool === 'ss-find') parts.push('When using ss-find:');
  else if (tool === 'ss-search') parts.push('When using ss-search:');
  else if (tool === 'ss-semantic') parts.push('When using ss-semantic on a known file:');
  else if (tool === 'structural') parts.push('When using structural / hybrid mode:');

  if (dims.length === 'very-short') parts.push('use a 1-3 token query');
  else if (dims.length === 'short') parts.push('use a 4-8 token query');
  else if (dims.length === 'medium') parts.push('use a 9-15 token query');
  else if (dims.length === 'long-NL') parts.push('use a 16+ token natural-language query');

  if (dims.symbol === 'with-symbol') parts.push('include the symbol if known');
  else if (dims.symbol === 'without-symbol') parts.push('omit identifier names; use generic terms');

  if (dims.regex === 'narrow-regex') parts.push('plus a single-literal regex anchor');
  else if (dims.regex === 'medium-regex') parts.push('plus a 2-3 alternation regex anchor');
  else if (dims.regex === 'broad-regex') parts.push('plus a broad alternation regex anchor');

  if (dims.framing === 'imperative') parts.push('phrased as a command');
  else if (dims.framing === 'interrogative') parts.push('phrased as a question');
  else if (dims.framing === 'declarative') parts.push('phrased as a noun phrase');
  else if (dims.framing === 'relationship-verb') parts.push('phrased around a code-relationship verb (callers/callees/implements)');

  if (dims.density === 'high-density') parts.push('use domain-dense vocabulary');
  else if (dims.density === 'low-density') parts.push('use generic, low-domain-density wording');

  if (dims.intentVerb === 'intent-verb-present') parts.push('include an intent verb (find/show/list)');
  else if (dims.intentVerb === 'intent-verb-absent') parts.push('drop intent verbs; lead with the noun');

  return parts.join(', ').replace(/, ([a-z])/g, ', $1') + '.';
}

function parseShape(shapeLabel) {
  const tokens = shapeLabel.split('+');
  const out = {
    length: null, symbol: null, regex: null, framing: null, density: null, intentVerb: null,
  };
  for (const t of tokens) {
    if (['very-short', 'short', 'medium', 'long-NL'].includes(t)) out.length = t;
    else if (['with-symbol', 'without-symbol'].includes(t)) out.symbol = t;
    else if (t.endsWith('-regex')) out.regex = t;
    else if (['imperative', 'interrogative', 'declarative'].includes(t)) out.framing = t;
    else if (t.endsWith('-density')) out.density = t;
    else if (t === 'intent-verb-present' || t === 'intent-verb-absent') out.intentVerb = t;
    else if (t === 'relationship-verb') out.framing = 'relationship-verb';
  }
  return out;
}

// ─── gate 3: leakage check on instruction_text ────────────────────────────

function runLeakageGate(instructionText, devProbes) {
  const whitelist = loadWhitelist(WHITELIST_PATH);
  const corpus = buildLeakageCorpus({ probes: devProbes, whitelist, ngramLength: 3 });
  return checkLeakage({ candidate: instructionText, leakageCorpus: corpus, ngramLength: 3 });
}

// ─── gate 2: thresholdout confirmation (held-out uv set) ──────────────────

function runThresholdoutGate({ tool, shape, devCellMean, heldoutCellMean, runId, candidateId }) {
  const cfg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'core/prompt-optimization/data/manifest.json'), 'utf8')
  );
  const logPath = cfg.thresholdout.logPath.replace('{run-id}', runId);
  const logFull = path.join(REPO_ROOT, logPath);
  initBudgetLog(logFull);
  const oracle = openThresholdout({
    budgetLogPath: logFull,
    runId,
    totalBudget: cfg.thresholdout.totalBudget,
    tau: cfg.thresholdout.tau,
    sigma: cfg.thresholdout.sigma,
  });
  const decision = oracle.query({
    queryId: `qshape::${tool}::${shape}`,
    candidateId,
    devScore: devCellMean,
    sealed1Score: heldoutCellMean,
  });
  return decision;
}

// ─── gate 5: per-repo cross-shape stability ──────────────────────────────

const REPO_STABILITY_FLOOR = 0.6;     // worst/best ≥ 0.60
const REPO_STABILITY_SIGMA = 2;       // ai-chatbot within 2σ of mean

function deriveDevRepos(goldsRaw) {
  // Plan §7.3 — the dev tier is whatever golds.json declares as tier=dev,
  // grouped by repo. Hard-coding the list (the previous DEV_REPOS const)
  // silently skipped a 6th dev repo if one were added later. (B11.)
  const repos = new Set();
  for (const g of goldsRaw.records) {
    if (g.tier === 'dev' && g.repo) repos.add(g.repo);
  }
  return [...repos];
}

function computePerRepoBreakdown({ trackARecords, tool, shape }) {
  // dev-tier only — uv is held-out. Group by repo, compute mean file_recall@1.
  const byRepo = new Map();
  for (const r of trackARecords) {
    if (r.tool !== tool || r.shape !== shape) continue;
    const repo = r._repo;
    if (!repo || repo === 'uv') continue;                // exclude held-out
    if (!r.metrics || r.metrics.file_recall_at_1 == null) continue;
    if (!byRepo.has(repo)) byRepo.set(repo, { sum: 0, n: 0 });
    const b = byRepo.get(repo);
    b.sum += r.metrics.file_recall_at_1;
    b.n += 1;
  }
  const breakdown = {};
  for (const [repo, b] of byRepo) {
    breakdown[repo] = { recall_at_1: b.n > 0 ? b.sum / b.n : 0, n: b.n };
  }
  return breakdown;
}

function runRepoStabilityGate({ perRepoBreakdown, expectedDevRepos }) {
  const repos = Object.keys(perRepoBreakdown);
  // (B12.) Partial-sweep handling: if Track A didn't cover every dev repo,
  // call out which are missing rather than silently failing on a 1-repo
  // worst/best ratio that's ill-defined.
  const missing = expectedDevRepos.filter((r) => !repos.includes(r));
  if (missing.length > 0) {
    return {
      pass: false,
      reasonCode: 'partial_sweep_missing_repos',
      diagnosis: `partial sweep — missing dev repos: ${missing.join(', ')} (expected ${expectedDevRepos.length}, got ${repos.length})`,
      missingRepos: missing,
      expectedDevRepos,
      perRepoBreakdown,
    };
  }
  if (repos.length < 2) {
    return {
      pass: false,
      reasonCode: 'insufficient_repos',
      diagnosis: `insufficient repos with metrics (${repos.length} < 2)`,
      perRepoBreakdown,
    };
  }
  const recalls = repos.map((r) => perRepoBreakdown[r].recall_at_1);
  const best = Math.max(...recalls);
  const worst = Math.min(...recalls);
  const mean = recalls.reduce((s, x) => s + x, 0) / recalls.length;
  const variance = recalls.reduce((s, x) => s + (x - mean) ** 2, 0) / recalls.length;
  const std = Math.sqrt(variance);

  const ratio = best > 0 ? worst / best : 0;
  const aiChatbotRecall = perRepoBreakdown['ai-chatbot']?.recall_at_1;
  const aiChatbotZ = (aiChatbotRecall != null && std > 0)
    ? (aiChatbotRecall - mean) / std
    : null;

  const ratioPass = ratio >= REPO_STABILITY_FLOOR;
  const aiChatbotPass = aiChatbotRecall == null
    || aiChatbotZ == null
    || aiChatbotZ >= -REPO_STABILITY_SIGMA;
  const pass = ratioPass && aiChatbotPass;

  let diagnosis;
  if (pass) {
    diagnosis = `PASS (worst/best = ${worst.toFixed(2)}/${best.toFixed(2)} = ${ratio.toFixed(2)}, ≥ ${REPO_STABILITY_FLOOR} floor`
      + (aiChatbotZ != null ? `; ai-chatbot z=${aiChatbotZ.toFixed(2)}σ within ${REPO_STABILITY_SIGMA}σ of mean)` : ')');
  } else if (!ratioPass && !aiChatbotPass) {
    diagnosis = `FAIL: worst/best ratio ${ratio.toFixed(2)} < ${REPO_STABILITY_FLOOR} AND ai-chatbot z=${aiChatbotZ.toFixed(2)}σ < -${REPO_STABILITY_SIGMA}σ`;
  } else if (!ratioPass) {
    diagnosis = `FAIL: worst/best ratio ${ratio.toFixed(2)} < ${REPO_STABILITY_FLOOR} (worst-repo recall@1 = ${worst.toFixed(2)}, best = ${best.toFixed(2)})`;
  } else {
    diagnosis = `FAIL: ai-chatbot recall@1 = ${aiChatbotRecall?.toFixed(2)} is z=${aiChatbotZ.toFixed(2)}σ below cross-repo mean (${mean.toFixed(2)} ± ${std.toFixed(2)})`;
  }

  return {
    pass,
    reasonCode: pass ? 'pass' : (ratioPass ? 'ai_chatbot_outlier' : 'worst_best_ratio'),
    diagnosis,
    worstBestRatio: ratio,
    floor: REPO_STABILITY_FLOOR,
    aiChatbotRecall,
    aiChatbotZScore: aiChatbotZ,
    crossRepoMean: mean,
    crossRepoStd: std,
    perRepoBreakdown,
  };
}

// ─── gate 4: independent-author check ─────────────────────────────────────

function runAuthorCheck({ tool, instructionAuthor, goldsRaw }) {
  // §11.2 / §7.6 gate #4: the `instruction_text` author MUST be a different
  // engineer from the primary gold-task author for THIS tool's evaluation
  // slice. The slice is defined as: golds whose `predicted_winning_tool`
  // matches `tool` (the optimisation target). When no gold targets this
  // tool, fall back to the full gold set (conservative — wider author set =
  // stricter gate).
  const slice = goldsRaw.records.filter((g) => g.predicted_winning_tool === tool);
  const sliceUsed = slice.length > 0 ? slice : goldsRaw.records;
  const goldAuthors = new Set(sliceUsed.map((g) => g.gold_authored_by).filter(Boolean));
  const tripped = goldAuthors.has(instructionAuthor);
  return {
    pass: !tripped,
    instructionAuthor,
    goldAuthors: [...goldAuthors],
    gold_authors_slice: slice.length > 0 ? `predicted_winning_tool == ${tool}` : 'all golds (fallback — no per-tool prediction)',
    n_golds_in_slice: sliceUsed.length,
  };
}

// ─── compose recommendations.json ─────────────────────────────────────────

function buildRecommendations({
  goldsRaw, trackARecords, trackBRecords, runId, opts,
}) {
  // Per-shape × tool means (Track A) → BH-FDR test slate
  const cellTestResult = buildShapeCellTests(trackARecords);
  const { tests, cellMeans, nCellsConsidered, nCellsBelowPairFloor } = cellTestResult;
  if (tests.length === 0) {
    process.stderr.write(
      `promote: no scorable Track A records (all dry-run or no metrics). ` +
      `Run a real Track A sweep first:\n  node core/prompt-optimization/sweep/track-a.mjs --run ${runId}\n`
    );
    process.exit(7);
  }
  const bh = benjaminiHochberg({ tests, q: Q, claimSpace: 'qshape-A-shape-by-tool' });
  const { winners } = pickPerToolBest(bh, cellMeans);

  const heldoutByCell = new Map();
  for (const r of trackARecords) {
    if (r._repo !== 'uv') continue;
    if (!r.metrics) continue;
    const k = `${r.tool}|${r.shape}`;
    if (!heldoutByCell.has(k)) heldoutByCell.set(k, []);
    heldoutByCell.get(k).push(r.metrics.file_recall_at_1 || 0);
  }
  const heldoutMean = (cellKey) => {
    const arr = heldoutByCell.get(cellKey) || [];
    if (arr.length === 0) return null;
    return arr.reduce((s, x) => s + x, 0) / arr.length;
  };

  const expectedDevRepos = deriveDevRepos(goldsRaw);
  const perTool = {};
  const devProbes = goldsRaw.records.filter((g) => g.tier === 'dev');

  // Track B aggregation (per (tool, shape) → win rate vs baseline)
  const trackBByCell = new Map();
  if (trackBRecords && trackBRecords.judges) {
    for (const j of trackBRecords.judges) {
      const k = `${j.tool}|${j.shape}`;
      if (!trackBByCell.has(k)) trackBByCell.set(k, { wins: 0, ties: 0, losses: 0, n: 0 });
      const c = trackBByCell.get(k);
      c.n += 1;
      if (j.aggregate === 'candidate') c.wins += 1;
      else if (j.aggregate === 'tie') c.ties += 1;
      else c.losses += 1;
    }
  }
  // Per-tool agent E2E success rate from track-b agent rows
  const agentE2EByCell = new Map();
  if (trackBRecords && trackBRecords.agents) {
    for (const a of trackBRecords.agents) {
      if (a.runStatus !== 'ok') continue;
      const k = `${a.tool}|${a.shape}`;
      if (!agentE2EByCell.has(k)) agentE2EByCell.set(k, { full: 0, n: 0 });
      const c = agentE2EByCell.get(k);
      c.n += 1;
      if (a.answerability === 'full') c.full += 1;
    }
  }

  for (const tool of TOOLS_IN_SCOPE) {
    const winner = winners[tool];
    if (!winner) {
      perTool[tool] = {
        tool,
        promoted: false,
        not_promoted_reason: 'no shape cell beat the baseline at q=0.10 BH-FDR (one-sided)',
        gate_results: { fdr: 'fail', thresholdout: 'n/a', leakage: 'n/a', author: 'n/a', repo_stability: 'n/a' },
        // (G3.) Always emit a structured track_b block — even when FDR
        // failed before Track B mattered — so downstream consumers can
        // distinguish 'fdr-failed-pre-track-b' from 'track-b-not-run' from
        // 'track-b-ran-but-cell-empty' without nullable-block guards.
        track_b: trackBRecords
          ? { agent_e2e_success: null, n_e2e: 0, prp_win_rate: null, judge_iaa_alpha: null, status: 'fdr_failed_no_cell' }
          : { agent_e2e_success: null, n_e2e: 0, prp_win_rate: null, judge_iaa_alpha: null, status: 'not_run' },
      };
      continue;
    }
    const shape = winner.meta.shape;
    const devMean = winner.meta.meanShape;
    const heldoutCellMean = heldoutMean(`${tool}|${shape}`);
    const instructionText = draftInstructionText(tool, shape);

    const leakageRes = runLeakageGate(instructionText, devProbes);
    const authorRes = runAuthorCheck({
      tool,
      instructionAuthor: opts.independentAuthor,
      goldsRaw,
    });

    const perRepoBreakdown = computePerRepoBreakdown({ trackARecords, tool, shape });
    const repoStabilityRes = runRepoStabilityGate({ perRepoBreakdown, expectedDevRepos });

    let thresholdoutRes;
    if (opts.skipThresholdout) {
      thresholdoutRes = { decision: 'SKIPPED', reason: 'flag --skip-thresholdout' };
    } else if (heldoutCellMean == null) {
      thresholdoutRes = { decision: 'N/A', reason: 'no held-out records for this tool×shape cell' };
    } else {
      try {
        thresholdoutRes = runThresholdoutGate({
          tool,
          shape,
          devCellMean: devMean,
          heldoutCellMean,
          runId,
          candidateId: `qshape-v1::${tool}::${shape}`,
        });
      } catch (e) {
        thresholdoutRes = { decision: 'ERROR', error: e.message };
      }
    }

    // Track B aggregation for this cell
    const trackBCell = trackBByCell.get(`${tool}|${shape}`);
    const agentCell = agentE2EByCell.get(`${tool}|${shape}`);
    const trackBBlock = trackBRecords
      ? {
          agent_e2e_success: agentCell && agentCell.n > 0 ? agentCell.full / agentCell.n : null,
          n_e2e: agentCell?.n ?? 0,
          prp_win_rate: trackBCell && trackBCell.n > 0 ? trackBCell.wins / trackBCell.n : null,
          prp_tie_rate: trackBCell && trackBCell.n > 0 ? trackBCell.ties / trackBCell.n : null,
          n_prp_pairs: trackBCell?.n ?? 0,
          judge_iaa_alpha: null,           // populated when human-validation set non-empty
          status: 'ran',
        }
      : { agent_e2e_success: null, n_e2e: 0, prp_win_rate: null, judge_iaa_alpha: null, status: 'not_run' };

    // (G1.) IAA gate evaluation. Reads track-b-summary.json (loaded into
    // trackBRecords.summary by loadTrackBRecords). Strict-mode requires
    // panel-majority α ≥ alphaMajority AND every per-judge α ≥
    // alphaIndividual. Pending-author / no-validation-set / skipped IAA
    // surface their own gate values that strict mode treats as BLOCKING.
    const iaaSummary = trackBRecords?.summary?.iaa ?? null;
    let iaaGate;
    let iaaBlock;
    if (!trackBRecords) {
      iaaGate = 'not_run';
      iaaBlock = { status: 'not_run', alpha: null };
    } else if (!iaaSummary) {
      iaaGate = 'not_run';
      iaaBlock = { status: 'no-track-b-summary', alpha: null };
    } else if (iaaSummary.status === 'pending-author') {
      iaaGate = 'pending-author';
      iaaBlock = { ...iaaSummary, alpha: null };
    } else if (iaaSummary.status === 'no-validation-set') {
      iaaGate = 'no-validation-set';
      iaaBlock = { ...iaaSummary, alpha: null };
    } else if (iaaSummary.status === 'skipped') {
      iaaGate = 'skipped';
      iaaBlock = { ...iaaSummary, alpha: null };
    } else if (iaaSummary.status === 'ok') {
      const majPasses = !!iaaSummary.majority?.passes;
      const allJudgesPass = (iaaSummary.perJudge || []).every((j) => j.passes);
      iaaGate = (majPasses && allJudgesPass) ? 'pass' : 'fail';
      iaaBlock = {
        status: 'ok',
        alpha: iaaSummary.majority?.alpha ?? null,
        majorityPasses: majPasses,
        allJudgesPass,
        perJudge: iaaSummary.perJudge,
      };
    } else {
      iaaGate = 'fail';
      iaaBlock = { status: iaaSummary.status, alpha: null };
    }
    // Wire judge_iaa_alpha for downstream consumers (was previously null).
    trackBBlock.judge_iaa_alpha = iaaBlock.alpha;
    trackBBlock.iaa_status = iaaBlock.status;

    const gates = {
      fdr: 'pass',                                      // by construction (only winners reach here)
      thresholdout: thresholdoutRes.decision === 'AGREE' || thresholdoutRes.decision === 'DIFFER'
        ? 'pass'
        : (opts.skipThresholdout ? 'skipped' : 'fail-or-n/a'),
      leakage: leakageRes.passes ? 'pass' : 'fail',
      author: authorRes.pass ? 'pass' : 'fail',
      repo_stability: repoStabilityRes.pass ? 'pass' : 'fail',
      track_b: trackBRecords ? (trackBBlock.n_e2e >= 3 ? 'pass' : 'insufficient_evidence') : 'not_run',
      iaa: iaaGate,
    };

    // Strict promotion: every gate must `pass`. `skipped` / `not_run` /
    // `insufficient_evidence` / `pending-author` / `no-validation-set`
    // ONLY count as promoting when --allow-incomplete-promotion is passed;
    // in that mode the artifact is marked incomplete_promotion=true (see
    // top-level field) so a downstream consumer cannot mistake a diagnostic
    // run for a shippable promotion. (B5/G1.)
    const strictPass = (g) => g === 'pass';
    const incompleteValues = new Set([
      'skipped', 'not_run', 'insufficient_evidence', 'pending-author', 'no-validation-set',
    ]);
    const lenientPass = (g) => g === 'pass' || incompleteValues.has(g);
    const passFn = opts.allowIncompletePromotion ? lenientPass : strictPass;
    const promoted = Object.values(gates).every(passFn);

    perTool[tool] = {
      tool,
      promoted,
      best_shape: shape,
      deterministic_recall_at_1: devMean,
      heldout_recall_at_1: heldoutCellMean,
      n_dev: winner.meta.n,
      n_heldout: heldoutCellMean != null
        ? (heldoutByCell.get(`${tool}|${shape}`) || []).length
        : 0,
      bh_fdr: {
        survives: true,
        adjustedP: winner.adjustedP,
        rank: winner.rank,
        observed_diff: winner.meta.observedDiff,
        baseline_mean: winner.meta.baselineMean,
        claim_space: bh.claimSpace,
        m: bh.m,
        nSurvived: bh.nSurvived,
      },
      thresholdout_result: thresholdoutRes,
      leakage_gate: {
        passes: leakageRes.passes,
        n_matches: leakageRes.matches.length,
        first_matches: leakageRes.matches.slice(0, 5),
      },
      independent_author_check: authorRes,
      per_repo_breakdown: perRepoBreakdown,
      repo_stability_gate: repoStabilityRes.diagnosis,
      repo_stability_details: {
        reason_code: repoStabilityRes.reasonCode,
        worst_best_ratio: repoStabilityRes.worstBestRatio,
        floor: repoStabilityRes.floor,
        ai_chatbot_recall: repoStabilityRes.aiChatbotRecall,
        ai_chatbot_z_score: repoStabilityRes.aiChatbotZScore,
        cross_repo_mean: repoStabilityRes.crossRepoMean,
        cross_repo_std: repoStabilityRes.crossRepoStd,
        missing_repos: repoStabilityRes.missingRepos ?? [],
        expected_dev_repos: expectedDevRepos,
      },
      track_b: trackBBlock,
      iaa: iaaBlock,
      instruction_text: instructionText,
      gate_results: gates,
      not_promoted_reason: promoted ? null : Object.entries(gates)
        .filter(([, v]) => !passFn(v))
        .map(([k, v]) => `${k}=${v}`)
        .join(','),
    };
  }

  // Avoid shapes (worst per tool, BH-FDR-survivor diagnostic).
  // (B9.) Replace the prose "Do NOT phrase…" string with a structured
  // reason code; instruction_text is OMITTED so a downstream consumer
  // cannot accidentally paste the avoid string into a real prompt.
  const avoidShapes = [];
  for (const tool of TOOLS_IN_SCOPE) {
    const cells = [...cellMeans.values()].filter((c) => c.tool === tool);
    cells.sort((a, b) => a.mean - b.mean);
    if (cells.length > 0) {
      avoidShapes.push({
        tool,
        shape: cells[0].shape,
        deterministic_recall_at_1: cells[0].mean,
        n: cells[0].n,
        reason_code: 'worst_observed_cell_mean',
        instruction_text: null,
      });
    }
  }

  // Pre-registration diff (per-gold predicted vs actual)
  const actualBest = {};
  {
    const byGoldTool = new Map();
    for (const r of trackARecords) {
      if (!r.metrics || r.metrics.file_recall_at_1 == null) continue;
      const k = `${r.goldId}|${r.tool}`;
      if (!byGoldTool.has(k)) byGoldTool.set(k, []);
      byGoldTool.get(k).push(r);
    }
    for (const [k, list] of byGoldTool) {
      list.sort((a, b) => (b.metrics.file_recall_at_1 || 0) - (a.metrics.file_recall_at_1 || 0));
      actualBest[k] = list[0];
    }
  }
  // (D18.) Predicted shape strings use a coarse vocabulary that is mapped
  // through `aliasShapeToken` so {short, with-symbol, narrow-regex} always
  // matches at least one variant token regardless of fine-tier (very-short
  // → short alias, etc.). Both exact_token_match and alias-aware overlap
  // are reported.
  const aliasMap = {
    short: ['short', 'very-short'],
    'long': ['long-NL'],
  };
  const aliasShapeToken = (t) => aliasMap[t] || [t];
  const dimsOf = (label) => new Set((label || '').split('+').filter(Boolean));
  const preregDiff = goldsRaw.records.map((g) => {
    const predTool = g.predicted_winning_tool;
    const predShape = g.predicted_winning_shape;
    const actual = actualBest[`${g.id}|${predTool}`];
    const predTokens = dimsOf(predShape);
    const actTokens = dimsOf(actual?.shape);
    const tokensMatched = [...predTokens].filter((t) => actTokens.has(t));
    const tokensMatchedAlias = [...predTokens].filter((t) =>
      aliasShapeToken(t).some((a) => actTokens.has(a))
    );
    return {
      goldId: g.id,
      predicted_winning_tool: predTool,
      predicted_winning_shape: predShape,
      actual_best_shape_for_predicted_tool: actual?.shape ?? null,
      actual_recall_at_1: actual?.metrics?.file_recall_at_1 ?? null,
      n_predicted_dims: predTokens.size,
      n_dims_matched: tokensMatched.length,
      n_dims_matched_alias: tokensMatchedAlias.length,
      tokens_matched: tokensMatched,
      tokens_matched_alias: tokensMatchedAlias,
      exact_token_match: predTokens.size > 0 && tokensMatched.length === predTokens.size,
      alias_match: predTokens.size > 0 && tokensMatchedAlias.length === predTokens.size,
    };
  });

  const incompletePromotion = Object.values(perTool).some((b) =>
    b.gate_results && Object.values(b.gate_results).some(
      (v) => v === 'skipped' || v === 'not_run' || v === 'insufficient_evidence'
        || v === 'pending-author' || v === 'no-validation-set'
    )
  );

  // (E21.) BH-FDR claim-space sizing notes — the m we report is the count
  // of cells with ≥5 paired observations (test threshold). Cells below the
  // pair-count floor are excluded; we surface the count so a reader can
  // judge the corrected denominator.
  return {
    schemaVersion: 2,
    runId,
    generatedAt: new Date().toISOString(),
    plan_reference: 'docs/SYSTEM_PROMPT_OPT_PLAN.md §7.6 + §0.5 five-gate framework',
    incomplete_promotion: incompletePromotion,
    behavior_notes: [
      opts.allowIncompletePromotion
        ? 'allow-incomplete-promotion=ON: skipped/not_run/pending-author/no-validation-set gates count as pass; promoted=true MAY include incomplete evidence — see incomplete_promotion flag.'
        : 'strict promotion: skipped/not_run/pending-author/no-validation-set gates BLOCK promoted=true.',
      `BH-FDR m=${bh.m} reflects ONLY shape cells with ≥5 paired observations (out of ${nCellsConsidered} considered; ${nCellsBelowPairFloor} below pair floor).`,
      'Two-sided paired permutation test, one-sided beats-baseline interpretation applied at pickPerToolBest (observedDiff > 0).',
      'Thresholdout reads held-out from Track A uv rows in this driver — the structural Sealed-1 accessor route is documented in promote.mjs header.',
      'V1 cells bifurcate by symbol presence: build-variants.mjs falls back to without-symbol+narrow-regex when a gold has no expectedSymbols. Both V1 sub-cells (with-symbol, without-symbol) appear as separate (tool, shape) rows in the BH-FDR slate, so the with-symbol main-effect estimate is NOT polluted by the fallback rows. Cells below the ≥5 paired-observation floor are excluded from BH-FDR (see bh_fdr_n_cells_below_pair_floor).',
      'uv held-out tier (30 records) carries empty expectedLineRanges and expectedFacts: file_recall@1 is the only cleanly comparable metric on uv. Track A cells on uv therefore have lineOverlap=null and reduced fact_recall coverage; this is acceptable for Thresholdout (which only queries devCellMean vs heldoutCellMean of file_recall@1) but limits any additional held-out diagnostic.',
      'Cross-lineage panel: track-b.mjs routes Anthropic via claude-runner, OpenAI via codex CLI, Google via gemini CLI, DeepSeek via claude-CLI-with-redirected-base-URL (parity-preserving), and other lineages via opencode run. See eval/agent-read-workflows/judge-runner.js.',
    ],
    summary: {
      n_gold_records: goldsRaw.records.length,
      n_track_a_records: trackARecords.length,
      n_track_b_records: trackBRecords ? (trackBRecords.agents?.length ?? 0) + (trackBRecords.judges?.length ?? 0) : 0,
      n_track_b_agent_runs: trackBRecords?.agents?.length ?? 0,
      n_track_b_judge_pairs: trackBRecords?.judges?.length ?? 0,
      bh_fdr_q: Q,
      bh_fdr_n_tested: bh.m,
      bh_fdr_n_survived: bh.nSurvived,
      bh_fdr_n_cells_considered: nCellsConsidered,
      bh_fdr_n_cells_below_pair_floor: nCellsBelowPairFloor,
      tools_in_scope: TOOLS_IN_SCOPE,
      expected_dev_repos: expectedDevRepos,
      thresholdout_method: 'in-driver mean over Track A uv rows; structural Sealed-1 accessor pending integration',
    },
    per_tool: perTool,
    avoid_shapes: avoidShapes,
    not_promoted_due_to_fdr: tests
      .filter((t) => !bh.results.find((r) => r.id === t.id)?.survives)
      .map((t) => ({
        tool: t.meta.tool,
        shape: t.meta.shape,
        p: t.pValue,
        adjustedP: bh.results.find((r) => r.id === t.id)?.adjustedP,
        n: t.meta.n,
        meanShape: t.meta.meanShape,
        observedDiff: t.meta.observedDiff,
      })),
    not_promoted_due_to_repo_instability: Object.values(perTool)
      .filter((b) => b.gate_results?.repo_stability === 'fail')
      .map((b) => ({
        tool: b.tool,
        shape: b.best_shape,
        diagnosis: b.repo_stability_gate,
        reason_code: b.repo_stability_details?.reason_code,
        per_repo_breakdown: b.per_repo_breakdown,
        worst_best_ratio: b.repo_stability_details?.worst_best_ratio,
        ai_chatbot_z_score: b.repo_stability_details?.ai_chatbot_z_score,
        missing_repos: b.repo_stability_details?.missing_repos ?? [],
      })),
    preregistration_diff: preregDiff,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const goldsRaw = JSON.parse(readFileSync(path.join(QSHAPE_DIR, 'golds.json'), 'utf8'));
  const trackARecords = loadTrackARecords(opts.runId);
  const trackBRecords = loadTrackBRecords(opts.runId);

  const recommendations = buildRecommendations({
    goldsRaw, trackARecords, trackBRecords, runId: opts.runId, opts,
  });

  const outPath = path.join(QSHAPE_DIR, 'recommendations.json');
  writeFileSync(outPath, JSON.stringify(recommendations, null, 2) + '\n');
  process.stdout.write(`promote: recommendations → ${outPath}\n`);
  // (G3.) Reflect the actual gate set (5 baseline + IAA + Track B
  // composability where applicable). The composition: fdr, thresholdout,
  // leakage, author, repo_stability — plus track_b and iaa when Track B
  // ran. Strict mode requires every gate that's not 'pass' to BLOCK
  // promotion; lenient mode treats skipped/not_run/insufficient_evidence/
  // pending-author as effectively-pass with the artifact flagged
  // incomplete_promotion=true.
  const baseGates = ['fdr', 'thresholdout', 'leakage', 'author', 'repo_stability'];
  const trackGates = trackBRecords ? ['track_b', 'iaa'] : [];
  const gateList = [...baseGates, ...trackGates].join('+');
  process.stdout.write(
    `promote: mode=${opts.allowIncompletePromotion ? 'allow-incomplete' : 'strict'}; ` +
    `gates=${baseGates.length + trackGates.length} (${gateList}); ` +
    `incomplete_promotion=${recommendations.incomplete_promotion}\n`
  );
  for (const tool of TOOLS_IN_SCOPE) {
    const block = recommendations.per_tool[tool];
    process.stdout.write(
      `promote: ${tool}: ${block.promoted ? 'PROMOTED' : 'NOT PROMOTED'} ` +
      `(${block.best_shape ?? 'n/a'}; gates=${JSON.stringify(block.gate_results)})\n`
    );
  }
}

main();
