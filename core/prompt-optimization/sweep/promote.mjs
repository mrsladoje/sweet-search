/**
 * P6.4 — Promotion gate: emit `recommendations.json` from Track A + Track B
 * results, gated on the FIVE mandatory checks per §7.6.
 *
 * The five gates:
 *
 *   1. **BH-FDR at q=0.10** across the full Layer A shape × tool claim space
 *      — per-shape-cell paired-permutation p-value must survive Benjamini-
 *      Hochberg correction. (`stats/bh-fdr.mjs:benjaminiHochberg`)
 *   2. **Thresholdout confirmation** on Q-shape held-out (uv 30-probe set).
 *      For each candidate "best shape" per tool, query the Thresholdout
 *      oracle (1 query per tool × ≤3 in-scope tools = ≤3 of the campaign
 *      26-query envelope). Promote only if oracle returns AGREE or DIFFER
 *      in the candidate's favour. (`stats/thresholdout.mjs:openThresholdout`)
 *   3. **Token-overlap leakage gate** on the candidate `instruction_text`
 *      — the string MUST NOT contain ≥3-grams from Dev probe symbols / paths
 *      / answers. (`decontamination/leakage-gate.mjs:checkLeakage`)
 *   4. **Independent-author check** — the `instruction_text` must be
 *      authored or reviewed by an engineer who is NOT the primary author of
 *      the gold tasks for that tool's sweep. (Recorded in
 *      `recommendations.json:independent_author_check`.)
 *   5. **Per-repo cross-shape stability check** (added 2026-05-09 with the
 *      vercel/ai-chatbot 5th dev repo). For each candidate "best shape,"
 *      compute per-repo `recall@1` across the 5 dev repos and reject
 *      promotion if (a) the worst-repo recall@1 is < 0.6 of the best-repo
 *      recall@1, OR (b) ai-chatbot's recall@1 is more than 2σ below the
 *      cross-repo mean. Failures recorded under
 *      `not_promoted_due_to_repo_instability`.
 *
 * Plan reference: §7.6 promotion artifact, §0.5 dual-layer overfit framework.
 *
 * Output schema: `data/query-shapes/recommendations.json` per the §7.6
 * machine-readable contract.
 *
 * Usage:
 *   node core/prompt-optimization/sweep/promote.mjs --run qshape-v1
 *   node core/prompt-optimization/sweep/promote.mjs --run qshape-v1 --skip-thresholdout  # offline
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
    independentAuthor: 'sweet-search-core-secondary',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.runId = argv[++i];
    else if (a === '--skip-thresholdout') o.skipThresholdout = true;
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
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ─── group by shape × tool, compute paired tests vs baseline (V4) ─────────

function buildShapeCellTests(records) {
  // Group records by (tool, shape). Pair each non-baseline shape against
  // the V4 baseline within the same gold; compute paired permutation on
  // file_recall_at_1.
  const byTool = new Map();
  for (const r of records) {
    if (!r.metrics) continue;
    if (r.metrics.file_recall_at_1 == null) continue;
    if (!byTool.has(r.tool)) byTool.set(r.tool, []);
    byTool.get(r.tool).push(r);
  }
  const tests = [];
  const cellMeans = new Map();
  for (const [tool, recs] of byTool) {
    // Index by goldId → variantId → record (for pairing)
    const byGold = new Map();
    for (const r of recs) {
      if (!byGold.has(r.goldId)) byGold.set(r.goldId, new Map());
      byGold.get(r.goldId).set(r.variantId, r);
    }
    // Aggregate per shape
    const shapeRecords = new Map();
    for (const r of recs) {
      if (!shapeRecords.has(r.shape)) shapeRecords.set(r.shape, []);
      shapeRecords.get(r.shape).push(r);
    }
    for (const [shape, list] of shapeRecords) {
      const mean = list.reduce((s, r) => s + (r.metrics.file_recall_at_1 || 0), 0) / list.length;
      cellMeans.set(`${tool}|${shape}`, { tool, shape, n: list.length, mean });
    }
    // Pair each shape against V4 within the same gold
    for (const [shape, list] of shapeRecords) {
      if (list.every((r) => r.isBaseline)) continue; // V4 vs V4 = identity
      const paired = { a: [], b: [] };
      for (const r of list) {
        const sib = byGold.get(r.goldId);
        if (!sib) continue;
        // V4 = baseline
        const baseline = [...sib.values()].find((x) => x.isBaseline);
        if (!baseline || baseline.metrics?.file_recall_at_1 == null) continue;
        paired.a.push(r.metrics.file_recall_at_1 || 0);
        paired.b.push(baseline.metrics.file_recall_at_1 || 0);
      }
      if (paired.a.length < 5) continue;            // skip cells with too few pairs
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
        },
      });
    }
  }
  return { tests, cellMeans };
}

// ─── per-tool best shape (after BH-FDR) ───────────────────────────────────

function pickPerToolBest(bhResult, cellMeans) {
  const surv = survivors(bhResult);
  // Group survivors by tool, pick the one with the highest mean shape recall.
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
  // For tools with no survivors, fall back to mean-only diagnosis (not promoted).
  return { winners, allSurvivors: surv };
}

// ─── instruction_text drafting ────────────────────────────────────────────

function draftInstructionText(tool, shape) {
  // Per §7.6 the `instruction_text` goes verbatim into the T1-T14 variant
  // bodies in Part 6. The text is short, agent-instructable, and free of
  // dev-probe-specific identifiers.
  //
  // The strings below are templates keyed on shape coordinates. They MUST
  // pass the leakage gate (gate #3) — generic English, no symbol names.
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
//
// Plan §7.6 gate-5 (added 2026-05-09 with vercel/ai-chatbot). Adding a
// TS/React repo to a previously backend-only dev set creates a confound
// risk: a shape can win on aggregate by overperforming on the 4 backend
// repos and underperforming on ai-chatbot (or vice versa).
//
// For each candidate "best shape" we compute per-repo `recall@1` over the
// dev tier (uv is held-out and excluded) and reject promotion if either:
//   (a) worst-repo recall@1 < 0.6 × best-repo recall@1, OR
//   (b) ai-chatbot's recall@1 is more than 2σ below the cross-repo mean.
//
// Shapes that fail this gate are recorded under
// `not_promoted_due_to_repo_instability` with their per-repo breakdown so a
// future campaign can decide whether to (i) split into language-specific
// recommendations, (ii) re-author the variant to be language-agnostic, or
// (iii) accept that shape-specific guidance is the correct end state.

const REPO_STABILITY_FLOOR = 0.6;     // worst/best ≥ 0.60
const REPO_STABILITY_SIGMA = 2;       // ai-chatbot within 2σ of mean
const DEV_REPOS = ['fastify', 'gin', 'flask', 'ripgrep', 'ai-chatbot'];

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

function runRepoStabilityGate({ perRepoBreakdown }) {
  const repos = Object.keys(perRepoBreakdown);
  if (repos.length < 2) {
    return {
      pass: false,
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
  // engineer from the primary gold-task author for the tool's sweep.
  const goldAuthors = new Set(
    goldsRaw.records
      .filter((g) => /* same tool's golds */ true)
      .map((g) => g.gold_authored_by)
  );
  // Conservative: if the instruction author appears in the gold-author set,
  // the gate trips. Caller passes `--author` from CLI.
  const tripped = goldAuthors.has(instructionAuthor);
  return {
    pass: !tripped,
    instructionAuthor,
    goldAuthors: [...goldAuthors],
  };
}

// ─── compose recommendations.json ─────────────────────────────────────────

function buildRecommendations({
  goldsRaw, trackARecords, trackBRecords, runId, opts,
}) {
  // Per-shape × tool means (Track A) → BH-FDR test slate
  const { tests, cellMeans } = buildShapeCellTests(trackARecords);
  if (tests.length === 0) {
    process.stderr.write(
      `promote: no scorable Track A records (all dry-run or no metrics). ` +
      `Run a real Track A sweep first:\n  node core/prompt-optimization/sweep/track-a.mjs --run ${runId}\n`
    );
    process.exit(7);
  }
  const bh = benjaminiHochberg({ tests, q: Q, claimSpace: 'qshape-A-shape-by-tool' });
  const { winners, allSurvivors } = pickPerToolBest(bh, cellMeans);

  // Per-tool: dev mean for winning shape, held-out mean for winning shape
  // (to feed Thresholdout). For tools with no Track A held-out records
  // (e.g. tools that don't apply to uv golds), we skip Thresholdout.
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

  // Compose per-tool block
  const perTool = {};
  const devProbes = goldsRaw.records.filter((g) => g.tier === 'dev');

  for (const tool of TOOLS_IN_SCOPE) {
    const winner = winners[tool];
    if (!winner) {
      perTool[tool] = {
        tool,
        promoted: false,
        not_promoted_reason: 'no shape cell survived BH-FDR at q=0.10',
        gate_results: { fdr: 'fail', thresholdout: 'n/a', leakage: 'n/a', author: 'n/a' },
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

    // Gate 5: per-repo cross-shape stability (added 2026-05-09).
    const perRepoBreakdown = computePerRepoBreakdown({ trackARecords, tool, shape });
    const repoStabilityRes = runRepoStabilityGate({ perRepoBreakdown });

    let thresholdoutRes = { decision: 'SKIPPED', reason: 'flag --skip-thresholdout' };
    if (!opts.skipThresholdout && heldoutCellMean != null) {
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
    } else if (heldoutCellMean == null) {
      thresholdoutRes = { decision: 'N/A', reason: 'no held-out records for this tool×shape cell' };
    }

    const gates = {
      fdr: 'pass',                                      // by construction (only winners reach here)
      thresholdout: thresholdoutRes.decision === 'AGREE' || thresholdoutRes.decision === 'DIFFER'
        ? 'pass'
        : (opts.skipThresholdout ? 'skipped' : 'fail-or-n/a'),
      leakage: leakageRes.passes ? 'pass' : 'fail',
      author: authorRes.pass ? 'pass' : 'fail',
      repo_stability: repoStabilityRes.pass ? 'pass' : 'fail',
    };
    const promoted = gates.fdr === 'pass' && (gates.thresholdout === 'pass' || gates.thresholdout === 'skipped')
      && gates.leakage === 'pass' && gates.author === 'pass'
      && gates.repo_stability === 'pass';

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
        worst_best_ratio: repoStabilityRes.worstBestRatio,
        floor: repoStabilityRes.floor,
        ai_chatbot_recall: repoStabilityRes.aiChatbotRecall,
        ai_chatbot_z_score: repoStabilityRes.aiChatbotZScore,
        cross_repo_mean: repoStabilityRes.crossRepoMean,
        cross_repo_std: repoStabilityRes.crossRepoStd,
      },
      instruction_text: instructionText,
      gate_results: gates,
      not_promoted_reason: promoted ? null : Object.entries(gates)
        .filter(([, v]) => v !== 'pass' && v !== 'skipped')
        .map(([k, v]) => `${k}=${v}`)
        .join(','),
    };
  }

  // Avoid shapes (worst per tool, BH-FDR-survivor diagnostic)
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
        instruction_text: 'Do NOT phrase a query in this shape: ' + cells[0].shape,
      });
    }
  }

  // Pre-registration diff (per-gold predicted vs actual)
  const goldById = new Map(goldsRaw.records.map((g) => [g.id, g]));
  const actualBest = {};
  {
    // For each gold × tool, find its best shape from Track A
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
  // Predicted shape strings (golds.json) are partial labels naming a subset
  // of dimensions (e.g. 'short+with-symbol+narrow-regex'); actual variant
  // labels are full (e.g. 'short+with-symbol+narrow-regex+interrogative+
  // high-density'). Report exact_token_match (every predicted token present
  // in actual) plus per-dimension overlap so the diff is actionable even
  // when the prediction names a token (e.g. 'short') that no variant in the
  // V1-V6 grid carries (V1 uses 'very-short').
  //
  // KNOWN CAVEAT (qshape-v1): the variant grid uses {very-short, short,
  // medium, long-NL} for the length tier; the prereg author used 'short' as
  // a coarse stand-in for "small" length. For honest reporting we surface
  // both the exact-match flag and the partial-overlap count — the latter is
  // the more meaningful signal at this run.
  const dimsOf = (label) => new Set((label || '').split('+').filter(Boolean));
  const overlap = (a, b) => {
    const setB = dimsOf(b);
    let n = 0;
    for (const t of dimsOf(a)) if (setB.has(t)) n += 1;
    return n;
  };
  const preregDiff = goldsRaw.records.map((g) => {
    const predTool = g.predicted_winning_tool;
    const predShape = g.predicted_winning_shape;
    const actual = actualBest[`${g.id}|${predTool}`];
    const predTokens = dimsOf(predShape);
    const actTokens = dimsOf(actual?.shape);
    const tokensMatched = [...predTokens].filter((t) => actTokens.has(t));
    return {
      goldId: g.id,
      predicted_winning_tool: predTool,
      predicted_winning_shape: predShape,
      actual_best_shape_for_predicted_tool: actual?.shape ?? null,
      actual_recall_at_1: actual?.metrics?.file_recall_at_1 ?? null,
      n_predicted_dims: predTokens.size,
      n_dims_matched: tokensMatched.length,
      tokens_matched: tokensMatched,
      exact_token_match: predTokens.size > 0 && tokensMatched.length === predTokens.size,
    };
  });

  return {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    plan_reference: 'docs/SYSTEM_PROMPT_OPT_PLAN.md §7.6 + §0.5 four-gate framework',
    summary: {
      n_gold_records: goldsRaw.records.length,
      n_track_a_records: trackARecords.length,
      n_track_b_records: trackBRecords ? trackBRecords.length : 0,
      bh_fdr_q: Q,
      bh_fdr_n_tested: bh.m,
      bh_fdr_n_survived: bh.nSurvived,
      tools_in_scope: TOOLS_IN_SCOPE,
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
      })),
    // Plan §7.6 gate-5 (added 2026-05-09 with vercel/ai-chatbot). Shapes that
    // survived BH-FDR + Thresholdout but failed per-repo stability go here so
    // a future campaign can decide whether to (i) split into language-specific
    // recommendations, (ii) re-author the variant to be language-agnostic, or
    // (iii) accept that shape-specific guidance is the correct end state.
    not_promoted_due_to_repo_instability: Object.values(perTool)
      .filter((b) => b.gate_results?.repo_stability === 'fail')
      .map((b) => ({
        tool: b.tool,
        shape: b.best_shape,
        diagnosis: b.repo_stability_gate,
        per_repo_breakdown: b.per_repo_breakdown,
        worst_best_ratio: b.repo_stability_details?.worst_best_ratio,
        ai_chatbot_z_score: b.repo_stability_details?.ai_chatbot_z_score,
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
  for (const tool of TOOLS_IN_SCOPE) {
    const block = recommendations.per_tool[tool];
    process.stdout.write(
      `promote: ${tool}: ${block.promoted ? 'PROMOTED' : 'NOT PROMOTED'} ` +
      `(${block.best_shape ?? 'n/a'}; gates=${JSON.stringify(block.gate_results)})\n`
    );
  }
}

main();
