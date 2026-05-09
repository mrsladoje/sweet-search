/**
 * Track B — agent-in-loop query-shape sweep with PRP two-judge LLM-as-judge.
 *
 * Track A measures retrieval quality in isolation; Track B measures whether
 * an agent constrained to a given shape actually solves the gold task end-
 * to-end. This catches:
 *   - shapes that yield strong top-1 but presentation the agent can't reason
 *     about (presentation overhead),
 *   - shapes that yield weaker top-1 but are recoverable in one follow-up
 *     (agent salvage).
 *
 * Methodology (§7.5):
 *   1. Subsample Track A to 20-25 golds (4-5 per repo, stratified by query
 *      type) — enough for IAA discipline without burning a thousand-dollar
 *      bill.
 *   2. For each (gold × shape × tool):
 *      - Spawn Claude Code in headless mode with a system prompt that
 *        FORCES the shape ("you MUST phrase your sweet-search query as <X>")
 *        and only allows the one tool under test (enforced via
 *        `shape-constrained` policy in eval/agent-read-workflows/policies.js
 *        + per-tuple buildShapeConstrainedRules(tool)).
 *      - Run end-to-end. Capture trace, answer, deterministic recall metrics.
 *   3. Run PRP-style two-judge LLM-as-judge per §11.6 with position-bias
 *      swap, comparing each shape's answer against the V4 baseline answer.
 *   4. Validate judges against ≥30-probe human-labelled subset; require
 *      Krippendorff α ≥ 0.6 individual, ≥ 0.7 majority before metrics are
 *      published (`stats/krippendorff.mjs`).
 *
 * COST WARNING: Track B costs $80-150 per full sweep (Sonnet 4.6 agent runs +
 * judge calls). It is GATED behind:
 *   - the §13.7 P6.2 stop rule (Track A best-shape recall@1 must be ≥ 0.5
 *     for at least one tool),
 *   - the explicit `--confirm-cost <budget-cap>` flag,
 *   - the campaign-wide budget tracker (`appendBudgetTelemetry`).
 *
 * Default behaviour: this driver runs in `--dry-run` mode, planning the
 * sweep and emitting the planned tuples + cost estimate without spending.
 * Pass `--confirm-cost <USD>` to execute (still subject to the cost
 * estimate); `--max-tuples N` is honoured to cap exposure.
 *
 * Plan reference: §7.5 Track B, §11.6 disjoint-family judge panel, §13.7 stop
 * rules.
 *
 * Cost assumptions (rough; see code constants for current values):
 *   - Claude Sonnet 4.6 agent runs: $0 marginal under Claude Max subscription
 *   - PRP judge (Sonnet 4.6 OR DSv4-Pro): ~$0.0015 per (tuple, swap-position)
 *     pair → ~$0.003 per pair after position swap
 *   - 1 baseline + 5 candidate shapes per gold × 24 golds × 4 tools × 2 swaps
 *     = ~960 judge calls = ~$1.50 absolute floor; reserve ~3-5× for IAA
 *     validation, retries, transient API errors → $5-10 cap recommended.
 *
 * Usage:
 *   node core/prompt-optimization/sweep/track-b.mjs --run qshape-v1                # dry-run plan
 *   node core/prompt-optimization/sweep/track-b.mjs --run qshape-v1 --confirm-cost 5
 *   node core/prompt-optimization/sweep/track-b.mjs --run qshape-v1 --confirm-cost 5 --max-tuples 4
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { krippendorffAlphaNominal } from '../stats/krippendorff.mjs';
import { mulberry32 } from '../stats/rng.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const QSHAPE_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes');
const RESULTS_BASE = path.join(REPO_ROOT, 'core/prompt-optimization/data/results');
const JUDGE_PROMPTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/judge-prompts');

const TOOLS_IN_SCOPE = ['ss-search', 'ss-find', 'ss-semantic', 'structural'];

// Track B costs (rough estimates per §7.5 / §10.6):
//   - Sonnet 4.6 via Claude Max: $0 marginal (subscription)
//   - DSv4-Pro judge call: ~$0.0015 per (gold, shape, tool, position-swap)
//     pair in PRP protocol → ~$0.003 per pair after swap.
const COST_PER_JUDGE_CALL_USD = 0.0015;
const COST_PER_AGENT_RUN_USD = 0;          // Sonnet via Claude Max subscription

// ─── argv ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = {
    runId: null,
    confirmCost: null,
    // Default 25 = 5 per-repo × 5 dev repos (fastify, gin, flask, ripgrep,
    // ai-chatbot); uv is held-out and excluded by default. The plan §13.7
    // P6.3 row scales to 20-25 (4-5/repo across 5 repos); 25 is the upper
    // bound. Override via --subsample.
    subsampleSize: 25,
    seed: 42,
    dryRun: true,
    includeUv: false,
    maxTuples: null,                       // hard cap on tuple count for safety
    agentModel: 'sonnet',
    // (G2.) Single judge by default; pass --judge-models a,b,c for the
    // disjoint-family panel (§11.6). claude-runner.js currently only
    // routes to Anthropic models, so non-Anthropic lineages from the panel
    // (gpt-5-5, gemini-3-1-pro, qwen3.6-max) require a per-provider runner
    // wired in eval/agent-read-workflows/ before they participate; until
    // then, an Anthropic-only multi-judge panel (sonnet, opus) is the
    // operational realisation of the plan structure.
    judgeModel: 'sonnet',
    judgeModels: null,                     // null → fall back to [judgeModel]
    timeoutMs: 240000,
    skipAgent: false,                      // judge-only mode (re-judge an existing track-b.jsonl)
    skipJudge: false,                      // agent-only mode (no judge calls)
    skipIaa: false,                        // skip the IAA probe pass (still runs PRP swap)
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.runId = argv[++i];
    else if (a === '--confirm-cost') {
      o.confirmCost = parseFloat(argv[++i]);
      o.dryRun = false;
    } else if (a === '--subsample') o.subsampleSize = parseInt(argv[++i], 10);
    else if (a === '--seed') o.seed = parseInt(argv[++i], 10);
    else if (a === '--include-uv') o.includeUv = true;
    else if (a === '--max-tuples') o.maxTuples = parseInt(argv[++i], 10);
    else if (a === '--agent-model') o.agentModel = argv[++i];
    else if (a === '--judge-model') o.judgeModel = argv[++i];
    else if (a === '--judge-models') o.judgeModels = argv[++i].split(',').filter(Boolean);
    else if (a === '--timeout') o.timeoutMs = parseInt(argv[++i], 10);
    else if (a === '--skip-agent') o.skipAgent = true;
    else if (a === '--skip-judge') o.skipJudge = true;
    else if (a === '--skip-iaa') o.skipIaa = true;
  }
  if (!o.runId) {
    process.stderr.write('track-b: --run <runId> required (matches preregistration tag)\n');
    process.exit(2);
  }
  if (!o.judgeModels) o.judgeModels = [o.judgeModel];
  return o;
}

// ─── stratified subsample ─────────────────────────────────────────────────

function stratifiedSubsample(records, n, seed, includeUv) {
  // 4 strata × 5 dev repos + optional uv stratum balanced. We aim for n ≈ 25.
  // Allocate per-repo: 5 per dev repo (~1-2 per stratum) + 0 from uv by
  // default — uv is held-out so its inclusion in a Track B subsample mixes
  // dev-iteration data with held-out evaluation data; the design intent for
  // Track B is to ground-truth the dev tier's deterministic claims via
  // agent-in-loop, not to confirm them on uv. Set `--include-uv` to force
  // uv inclusion (useful for IAA validation across stratum types).
  //
  // Plan §13.7 P6.3: subsample 20-25 with ≥1 component-search and ≥1 hook-
  // search task pulled from the ai-chatbot 5 (enforced post-pick below).
  const rng = mulberry32(seed);
  const byKey = new Map();
  for (const r of records) {
    if (r.tier !== 'dev' && !(includeUv && r.repo === 'uv')) continue;
    const key = `${r.repo}|${r.qshape_stratum}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  for (const [, list] of byKey) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  // Allocation: 5 dev repos × 5 each = 25. Optionally include uv (5 extra).
  const target = {
    fastify: 5, gin: 5, flask: 5, ripgrep: 5, 'ai-chatbot': 5,
    uv: includeUv ? 5 : 0,
  };
  let used = 0;
  const picked = [];
  for (const [repo, slots] of Object.entries(target)) {
    const repoBuckets = [...byKey.entries()]
      .filter(([k]) => k.startsWith(repo + '|'))
      .map(([, v]) => v);
    let taken = 0;
    let rr = 0;
    while (taken < slots && repoBuckets.some((b) => b.length > 0)) {
      const bucket = repoBuckets[rr % repoBuckets.length];
      if (bucket.length > 0) {
        picked.push(bucket.shift());
        taken += 1;
        used += 1;
      }
      rr += 1;
      if (used >= n) break;
    }
    if (used >= n) break;
  }
  ensureAiChatbotShapeCoverage(picked, byKey);
  return picked;
}

function ensureAiChatbotShapeCoverage(picked, byKey) {
  const ai = picked.filter((g) => g.repo === 'ai-chatbot');
  if (ai.length === 0) return;
  const hasComponent = ai.some((g) => /-component$/.test(g.id));
  const hasHook = ai.some((g) => /-hook$/.test(g.id));
  if (hasComponent && hasHook) return;
  const swapIn = (predicate) => {
    for (const [k, list] of byKey) {
      if (!k.startsWith('ai-chatbot|')) continue;
      for (let i = 0; i < list.length; i++) {
        const cand = list[i];
        if (predicate(cand) && !picked.includes(cand)) {
          const swapTarget = picked.findIndex(
            (g) => g.repo === 'ai-chatbot' && !/-component$|-hook$/.test(g.id)
          );
          if (swapTarget !== -1) {
            picked[swapTarget] = cand;
            list.splice(i, 1);
            return true;
          }
        }
      }
    }
    return false;
  };
  if (!hasComponent) swapIn((g) => /-component$/.test(g.id));
  if (!hasHook) swapIn((g) => /-hook$/.test(g.id));
}

// ─── plan a sweep ─────────────────────────────────────────────────────────

function buildPlan({ goldsRaw, variantsRaw, subsample }) {
  const variantByGold = new Map(variantsRaw.perGold.map((v) => [v.goldId, v]));
  const tuples = [];
  for (const gold of subsample) {
    const vrec = variantByGold.get(gold.id);
    if (!vrec) continue;
    for (const variant of vrec.variants) {
      for (const tool of TOOLS_IN_SCOPE) {
        if (tool === 'ss-semantic' && (!gold.expectedFiles || gold.expectedFiles.length === 0)) {
          continue;
        }
        if (tool === 'structural' && (!gold.expectedSymbols || gold.expectedSymbols.length === 0)) {
          continue;
        }
        tuples.push({
          goldId: gold.id,
          repo: gold.repo,
          qshape_stratum: gold.qshape_stratum,
          tool,
          variantId: variant.variantId,
          shape: variant.shape,
          query: variant.query,
          regex: variant.regex,
          isBaseline: !!variant.isBaseline,
          question: gold.query,
          expectedFiles: gold.expectedFiles,
          expectedSymbols: gold.expectedSymbols,
          expectedFacts: gold.expectedFacts,
          expectedLineRanges: gold.expectedLineRanges,
          expectedNoMatch: !!gold.expectedNoMatch,
          predicted_winning_tool: gold.predicted_winning_tool,
          predicted_winning_shape: gold.predicted_winning_shape,
        });
      }
    }
  }
  return tuples;
}

function estimateCost(tuples, { maxTuples = null, nJudges = 1, nIaaProbes = 0 } = {}) {
  // (G3.) Honour --max-tuples in the budget gate so the cost cap reflects
  // what we'll actually spend, not a worst-case full-slate estimate.
  // Judge calls scale with both tuple count (PRP swap × N judges) and
  // IAA-probe count (N judges × probes).
  const effectiveTuples = maxTuples != null ? Math.min(maxTuples, tuples.length) : tuples.length;
  const nAgentRuns = effectiveTuples;
  // Per (gold × shape) pair: 2 swaps × N judges. Plus IAA: N judges × probes.
  const nJudgeCalls = effectiveTuples * 2 * nJudges + nIaaProbes * nJudges;
  return {
    nAgentRuns,
    nJudgeCalls,
    nJudges,
    nIaaProbes,
    agentCostUSD: nAgentRuns * COST_PER_AGENT_RUN_USD,
    judgeCostUSD: nJudgeCalls * COST_PER_JUDGE_CALL_USD,
    totalEstimatedUSD: nAgentRuns * COST_PER_AGENT_RUN_USD + nJudgeCalls * COST_PER_JUDGE_CALL_USD,
    // Surface the unreduced full-slate cost too so an operator who omits
    // --max-tuples sees the worst-case figure unambiguously.
    fullSlateUSD: tuples.length * COST_PER_AGENT_RUN_USD
      + tuples.length * 2 * nJudges * COST_PER_JUDGE_CALL_USD
      + nIaaProbes * nJudges * COST_PER_JUDGE_CALL_USD,
  };
}

// ─── shape-forcing system prompt ──────────────────────────────────────────

function shapeForcingBlock(tool, variant) {
  // Per §7.5: the agent's system prompt "FORCES the shape". The exact
  // wording is part of the experimental treatment; we record it in the
  // sweep manifest so the trace is reproducible.
  const baseTool = (() => {
    switch (tool) {
      case 'ss-search':   return 'ss-search';
      case 'ss-find':     return 'ss-find with --regex';
      case 'ss-semantic': return 'ss-semantic <file>';
      case 'structural':  return 'ss-trace (structural)';
      default: throw new Error(`unknown tool ${tool}`);
    }
  })();
  return [
    `For this run you may ONLY use the tool: ${baseTool}.`,
    `You MUST phrase your query in this exact shape:`,
    `  Shape: ${variant.shape}`,
    `  Suggested query phrasing: ${JSON.stringify(variant.query)}`,
    variant.regex ? `  Regex anchor: ${variant.regex}` : '',
    `Do NOT improvise alternative phrasings — that defeats the experiment.`,
  ].filter(Boolean).join('\n');
}

function instantiateSystemPrompt(template, shapeBlock) {
  // policies.js stores the shape-constrained template with a literal
  // `${SHAPE_BLOCK}` placeholder (the backslash in the source escapes it
  // from JS template-literal interpolation). We replace it here at run time.
  return template.replace('${SHAPE_BLOCK}', shapeBlock);
}

// ─── execute one tuple (real run) ─────────────────────────────────────────

async function executeTuple(tuple, runId, opts, context) {
  const { POLICIES, buildShapeConstrainedRules } = context;
  const { runClaudeAgent, summariseRun } = context;
  const { auditRun } = context;
  const { scoreAnswer } = context;

  const repoDir = path.join(REPO_ROOT, 'eval/repos', tuple.repo);
  if (!existsSync(repoDir)) {
    return {
      goldId: tuple.goldId, variantId: tuple.variantId, tool: tuple.tool,
      shape: tuple.shape, repo: tuple.repo,
      runStatus: 'skipped', reason: `repo dir missing: ${repoDir}`,
    };
  }

  const shapeBlock = shapeForcingBlock(tuple.tool, tuple);
  const systemAppend = instantiateSystemPrompt(POLICIES['shape-constrained'], shapeBlock);
  const toolRules = buildShapeConstrainedRules(tuple.tool);
  // (G3.) Inject per-tool rules into TOOL_RULES at runtime so audit.js —
  // which looks up rules by mode name — finds the right allowedBashLeading
  // list. The mode tag carries the tool name so two concurrent tuples for
  // different tools can't clobber each other; same-tool concurrency is
  // SAFE because the rule object content is identical, not because the map
  // is locked. We delete the key after the audit completes (finally block
  // below) so a long-lived process doesn't accrete leftover keys.
  //
  // SINGLE-THREADED ASSUMPTION: track-b.mjs runs tuples sequentially in
  // the current driver. If you parallelise this, route audit through a
  // direct rules object instead of the global TOOL_RULES map (audit.js
  // would need a small refactor to accept rules directly).
  const auditModeTag = `shape-constrained::${tuple.tool}`;
  const TOOL_RULES_REF = (await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/policies.js'))).TOOL_RULES;
  TOOL_RULES_REF[auditModeTag] = toolRules;

  const userPrompt = [
    `# Task\n${tuple.question}`,
    tuple.expectedNoMatch
      ? `\nNote: this task may have NO match in the codebase — the right answer says the symbol does not exist.`
      : '',
  ].filter(Boolean).join('\n');

  const t0 = Date.now();
  const run = await runClaudeAgent({
    prompt: userPrompt,
    systemAppend,
    model: opts.agentModel,
    cwd: repoDir,
    allowedTools: toolRules.allowedTools,
    disallowedTools: toolRules.disallowedTools,
    addDirs: [path.join(REPO_ROOT, 'eval/agent-read-workflows/bin')],
    extraPathEntries: [path.join(REPO_ROOT, 'eval/agent-read-workflows/bin')],
    projectRoot: repoDir,
    timeoutMs: opts.timeoutMs,
    maxAttempts: 2,
  });
  const summary = summariseRun(run);
  const latencyMs = Date.now() - t0;

  // Audit transcript for policy violations (forbidden bash commands, etc.)
  let audit;
  try {
    audit = auditRun(auditModeTag, run);
  } finally {
    // Clean up the runtime mutation regardless of audit outcome.
    delete TOOL_RULES_REF[auditModeTag];
  }
  const metrics = scoreAnswer(
    {
      expectedFiles: tuple.expectedFiles,
      expectedSymbols: tuple.expectedSymbols,
      expectedFacts: tuple.expectedFacts,
      expectedLineRanges: tuple.expectedLineRanges,
      expectedNoMatch: tuple.expectedNoMatch,
    },
    summary.answer,
  );
  return {
    goldId: tuple.goldId,
    repo: tuple.repo,
    qshape_stratum: tuple.qshape_stratum,
    tool: tuple.tool,
    variantId: tuple.variantId,
    shape: tuple.shape,
    isBaseline: tuple.isBaseline,
    runId,
    runStatus: run.timedOut ? 'timeout' : (run.isError ? 'error' : 'ok'),
    latencyMs,
    answer: summary.answer,
    answerability: metrics.answerability,
    metrics: {
      file_recall: metrics.fileRecall,
      file_precision: metrics.filePrecision,
      symbol_recall: metrics.symbolRecall,
      fact_recall: metrics.factRecall,
      line_overlap: metrics.lineOverlap,
      cited_file_count: metrics.citedFileCount,
      approx_answer_tokens: metrics.approxAnswerTokens,
    },
    answerability_full: metrics.answerability === 'full' ? 1 : 0,
    audit: {
      violationCount: audit.violationCount,
      violations: audit.violations.slice(0, 5),
      toolCallCount: summary.toolCallCount,
    },
    runMeta: {
      wallMs: run.wallMs,
      attempts: run.attempts || 1,
      isError: run.isError,
      timedOut: run.timedOut,
    },
  };
}

// ─── PRP two-judge pairwise call ──────────────────────────────────────────

const JUDGE_SYSTEM_PRP = `\
You are an impartial code-review judge in a pairwise (PRP) protocol. Two
agent runs (A and B) attempted the same code-question task, each constrained
to a prescribed query shape. Score each answer strictly against the gold;
do not import outside knowledge.

Output STRICT JSON only — no prose before or after — in this exact shape:

{
  "answerA": { "correctness": 0, "completeness": 0, "evidence": 0, "hallucinationRisk": 0 },
  "answerB": { "correctness": 0, "completeness": 0, "evidence": 0, "hallucinationRisk": 0 },
  "preferred": "A",
  "preferenceReason": "..."
}

Scores are 0-5. preferred ∈ {"A","B","tie"}. Use "tie" when answers are
substantively equivalent against gold.
`;

function fmtAnswerForJudge(answer) {
  if (!answer) return '(no answer)';
  if (answer._parseError) return `(unparseable answer: ${answer._parseError})\n${(answer._raw || '').slice(0, 1500)}`;
  return JSON.stringify({
    answer: answer.answer,
    files: answer.files,
    symbols: answer.symbols,
    confidence: answer.confidence,
    notes: answer.notes,
  }, null, 2);
}

async function callPrpJudge({ task, candidateRecord, baselineRecord, judgeModel, swapPosition, runId, context }) {
  const { runClaudeAgent } = context;
  const { extractAnswerJson } = context;
  // PRP position swap: if swapPosition = 'A=baseline', baseline is A; else
  // candidate is A. The caller runs both positions and aggregates.
  const A = swapPosition === 'A=baseline' ? baselineRecord : candidateRecord;
  const B = swapPosition === 'A=baseline' ? candidateRecord : baselineRecord;
  const prompt = [
    `# Task\n${task.question}`,
    `\n# Gold expectations`,
    `expectedFiles: ${JSON.stringify(task.expectedFiles || [])}`,
    `expectedSymbols: ${JSON.stringify(task.expectedSymbols || [])}`,
    `expectedFacts: ${JSON.stringify(task.expectedFacts || [])}`,
    task.expectedNoMatch ? `note: gold expects NO match.` : '',
    `\n# Answer A (${A?.shape || 'n/a'})\n${fmtAnswerForJudge(A?.answer)}`,
    `\n# Answer B (${B?.shape || 'n/a'})\n${fmtAnswerForJudge(B?.answer)}`,
    `\nReturn the strict JSON judgement.`,
  ].filter(Boolean).join('\n');
  const run = await runClaudeAgent({
    prompt,
    systemAppend: JUDGE_SYSTEM_PRP,
    model: judgeModel,
    cwd: REPO_ROOT,
    allowedTools: [],
    disallowedTools: ['Bash', 'Read', 'Edit', 'Write'],
    addDirs: [],
    timeoutMs: 90000,
  });
  const judgement = extractAnswerJson(run.finalResultText || run.finalAssistantText);
  // De-randomise A/B back to candidate-vs-baseline.
  const labelMap = swapPosition === 'A=baseline'
    ? { A: 'baseline', B: 'candidate', tie: 'tie' }
    : { A: 'candidate', B: 'baseline', tie: 'tie' };
  const preferred = labelMap[judgement?.preferred] ?? null;
  return {
    judgeModel,
    swapPosition,
    judgement,
    preferred,
    runMeta: {
      wallMs: run.wallMs,
      isError: run.isError,
      totalCostUsd: run.totalCostUsd,
    },
  };
}

// ─── IAA validation ───────────────────────────────────────────────────────

async function validateIaa({ humanSetPath, judgeMatrix, alphaIndividual, alphaMajority }) {
  // judgeMatrix is judge × probe; humanSetPath is the human-labelled JSON.
  // Returns { perJudge: [{ judge, alpha, passes }], majority: { alpha, passes } }.
  if (!existsSync(humanSetPath)) {
    return {
      reason: 'human-validation set absent',
      humanSetPath,
      perJudge: [],
      majority: { alpha: NaN, passes: false },
    };
  }
  const humanSet = JSON.parse(readFileSync(humanSetPath, 'utf8'));
  const probes = Array.isArray(humanSet.probes) ? humanSet.probes : [];
  if (probes.length === 0) {
    return {
      reason: 'human-validation set has no probes',
      humanSetPath,
      n_probes: 0,
      perJudge: [],
      majority: { alpha: NaN, passes: false },
    };
  }
  const humanLabels = probes.map((p) => p.label);
  const perJudge = (judgeMatrix || []).map((judgeRow, idx) => {
    const matrix = humanLabels.map((h, i) => [h, judgeRow[i] ?? null]);
    const r = krippendorffAlphaNominal({ matrix });
    return { judge: `J${idx + 1}`, alpha: r.alpha, n: r.n, passes: r.alpha >= alphaIndividual };
  });
  // Majority vote per probe across judges.
  const majorityLabels = humanLabels.map((_, i) => {
    const counts = new Map();
    for (const judgeRow of judgeMatrix || []) {
      const v = judgeRow[i];
      if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best = null, bestCount = 0;
    for (const [k, v] of counts) {
      if (v > bestCount) { best = k; bestCount = v; }
    }
    return best;
  });
  const majMatrix = humanLabels.map((h, i) => [h, majorityLabels[i] ?? null]);
  const maj = krippendorffAlphaNominal({ matrix: majMatrix });
  return {
    humanSetPath,
    n_probes: probes.length,
    alphaIndividual,
    alphaMajority,
    perJudge,
    majority: { alpha: maj.alpha, n: maj.n, passes: maj.alpha >= alphaMajority },
  };
}

// ─── execution orchestration ──────────────────────────────────────────────

async function runRealSweep({ tuples, opts, runId, outDir }) {
  // Lazy-import the agent harness only when a real run is actually requested,
  // so dry-run paths don't pay the import cost or trip env requirements.
  const policiesMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/policies.js'));
  const runnerMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/claude-runner.js'));
  const auditMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/audit.js'));
  const metricsMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/metrics.js'));
  const context = {
    POLICIES: policiesMod.POLICIES,
    buildShapeConstrainedRules: policiesMod.buildShapeConstrainedRules,
    runClaudeAgent: runnerMod.runClaudeAgent,
    summariseRun: runnerMod.summariseRun,
    extractAnswerJson: runnerMod.extractAnswerJson,
    auditRun: auditMod.auditRun,
    scoreAnswer: metricsMod.scoreAnswer,
  };

  const jsonlPath = path.join(outDir, 'track-b.jsonl');
  // Truncate any prior partial run for this runId — a Track B re-run is
  // always a full replacement, never an append (otherwise stale cost
  // accounting silently doubles).
  writeFileSync(jsonlPath, '');

  const records = [];
  let nProcessed = 0;
  const cap = opts.maxTuples ?? tuples.length;
  for (const tuple of tuples) {
    if (nProcessed >= cap) break;
    let rec;
    if (opts.skipAgent) {
      rec = {
        goldId: tuple.goldId, tool: tuple.tool, shape: tuple.shape, repo: tuple.repo,
        variantId: tuple.variantId, isBaseline: tuple.isBaseline,
        runStatus: 'skipped-agent', metrics: null,
      };
    } else {
      rec = await executeTuple(tuple, runId, opts, context);
    }
    appendFileSync(jsonlPath, JSON.stringify(rec) + '\n');
    records.push(rec);
    nProcessed += 1;
    if (nProcessed % 5 === 0) {
      process.stdout.write(`track-b: progress ${nProcessed}/${Math.min(cap, tuples.length)} agent runs\n`);
    }
  }

  // Pair candidates with their V4 baseline (same gold + tool) for PRP judging.
  // (G2.) Each pair is judged by EVERY model in opts.judgeModels and the
  // panel majority becomes the per-pair aggregate. Per-judge votes are
  // retained on the record so cross-judge disagreement is auditable.
  const judgeRecords = [];
  if (!opts.skipJudge) {
    const goldsRaw = JSON.parse(readFileSync(path.join(QSHAPE_DIR, 'golds.json'), 'utf8'));
    const byGoldTool = new Map();
    for (const r of records) {
      if (r.runStatus !== 'ok') continue;
      const k = `${r.goldId}|${r.tool}`;
      if (!byGoldTool.has(k)) byGoldTool.set(k, { baseline: null, candidates: [] });
      const slot = byGoldTool.get(k);
      if (r.isBaseline) slot.baseline = r;
      else slot.candidates.push(r);
    }
    let nJudged = 0;
    for (const [, slot] of byGoldTool) {
      if (!slot.baseline) continue;
      for (const cand of slot.candidates) {
        const gold = goldsRaw.records.find((g) => g.id === cand.goldId);
        if (!gold) continue;
        const task = {
          question: gold.query,
          expectedFiles: gold.expectedFiles,
          expectedSymbols: gold.expectedSymbols,
          expectedFacts: gold.expectedFacts,
          expectedNoMatch: !!gold.expectedNoMatch,
        };
        const perJudge = [];
        for (const jm of opts.judgeModels) {
          const swapA = await callPrpJudge({
            task, candidateRecord: cand, baselineRecord: slot.baseline,
            judgeModel: jm, swapPosition: 'A=baseline', runId, context,
          });
          const swapB = await callPrpJudge({
            task, candidateRecord: cand, baselineRecord: slot.baseline,
            judgeModel: jm, swapPosition: 'A=candidate', runId, context,
          });
          let perJudgeAggregate;
          if (swapA.preferred === 'candidate' && swapB.preferred === 'candidate') perJudgeAggregate = 'candidate';
          else if (swapA.preferred === 'baseline' && swapB.preferred === 'baseline') perJudgeAggregate = 'baseline';
          else perJudgeAggregate = 'tie';
          perJudge.push({ judgeModel: jm, aggregate: perJudgeAggregate, swaps: [swapA, swapB] });
          nJudged += 2;
        }
        // Panel majority across judges (≥1 judge tolerates fall-through).
        const counts = new Map();
        for (const pj of perJudge) counts.set(pj.aggregate, (counts.get(pj.aggregate) || 0) + 1);
        let panelAggregate = 'tie', best = 0;
        for (const [k, v] of counts) {
          if (v > best) { panelAggregate = k; best = v; }
        }
        const judgeRec = {
          goldId: cand.goldId, tool: cand.tool, shape: cand.shape,
          variantId: cand.variantId, baselineVariantId: slot.baseline.variantId,
          aggregate: panelAggregate,
          perJudge,
          n_judges: opts.judgeModels.length,
        };
        judgeRecords.push(judgeRec);
        appendFileSync(jsonlPath, JSON.stringify({ ...judgeRec, _kind: 'judge' }) + '\n');
        if (nJudged % 10 === 0) {
          process.stdout.write(`track-b: progress ${nJudged} judge calls (${opts.judgeModels.length} judges × pairs)\n`);
        }
      }
    }
  }

  // (G2.) IAA validation: run each judge against the human-labelled probe
  // set and compute Krippendorff α. When the validation set is empty we
  // emit `status: 'pending-author'` so promote.mjs can BLOCK promotion in
  // strict mode (the IAA gate cannot pass without a real probe set).
  const humanSetPath = path.join(JUDGE_PROMPTS_DIR, 'human-validation-set.json');
  const iaa = opts.skipIaa
    ? { status: 'skipped', reason: 'flag --skip-iaa' }
    : await runIaaProbes({
        humanSetPath,
        judgeModels: opts.judgeModels,
        runId,
        context,
        alphaIndividual: 0.6,
        alphaMajority: 0.7,
      });

  return { records, judgeRecords, iaa };
}

// ─── IAA probes runner (judges × human-labelled probes) ──────────────────

async function runIaaProbes({ humanSetPath, judgeModels, runId, context, alphaIndividual, alphaMajority }) {
  if (!existsSync(humanSetPath)) {
    return { status: 'no-validation-set', humanSetPath };
  }
  const humanSet = JSON.parse(readFileSync(humanSetPath, 'utf8'));
  const probes = Array.isArray(humanSet.probes) ? humanSet.probes : [];
  if (probes.length === 0) {
    return {
      status: 'pending-author',
      humanSetPath,
      n_probes: 0,
      n_required: humanSet.target_n_probes ?? 30,
      alphaIndividual, alphaMajority,
      perJudge: [], majority: { alpha: null, passes: false },
    };
  }
  // Each probe must carry { task, answerA, answerB, label } where label ∈
  // {'candidate','baseline','tie'} — using 'candidate' for "answerA wins".
  // Run every judge through the same probes and build a (judges × probes)
  // matrix of votes; then compute per-judge α (vs human label) and panel-
  // majority α.
  const judgeMatrix = [];
  for (const jm of judgeModels) {
    const row = [];
    for (const probe of probes) {
      const j = await callPrpJudge({
        task: probe.task,
        candidateRecord: { shape: 'A', answer: probe.answerA },
        baselineRecord: { shape: 'B', answer: probe.answerB },
        judgeModel: jm,
        swapPosition: 'A=candidate',
        runId,
        context,
      });
      row.push(j.preferred);
    }
    judgeMatrix.push(row);
  }
  const humanLabels = probes.map((p) => p.label);
  const perJudge = judgeMatrix.map((row, idx) => {
    const matrix = humanLabels.map((h, i) => [h, row[i] ?? null]);
    const r = krippendorffAlphaNominal({ matrix });
    return {
      judge: judgeModels[idx],
      alpha: r.alpha,
      n: r.n,
      passes: Number.isFinite(r.alpha) && r.alpha >= alphaIndividual,
    };
  });
  // Panel-majority labels.
  const majorityLabels = humanLabels.map((_, i) => {
    const counts = new Map();
    for (const row of judgeMatrix) {
      const v = row[i];
      if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best = null, bestCount = 0;
    for (const [k, v] of counts) {
      if (v > bestCount) { best = k; bestCount = v; }
    }
    return best;
  });
  const majMatrix = humanLabels.map((h, i) => [h, majorityLabels[i] ?? null]);
  const maj = krippendorffAlphaNominal({ matrix: majMatrix });
  return {
    status: 'ok',
    humanSetPath,
    n_probes: probes.length,
    alphaIndividual,
    alphaMajority,
    judgeModels,
    perJudge,
    majority: {
      alpha: maj.alpha,
      n: maj.n,
      passes: Number.isFinite(maj.alpha) && maj.alpha >= alphaMajority,
    },
  };
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const goldsRaw = JSON.parse(readFileSync(path.join(QSHAPE_DIR, 'golds.json'), 'utf8'));
  const variantsRaw = JSON.parse(readFileSync(path.join(QSHAPE_DIR, 'variants.json'), 'utf8'));

  const subsample = stratifiedSubsample(goldsRaw.records, opts.subsampleSize, opts.seed, opts.includeUv);
  const tuples = buildPlan({ goldsRaw, variantsRaw, subsample });

  // (G3.) Pre-flight read of the human-validation set so the cost gate
  // accounts for IAA judge calls (N judges × n_probes) on top of the PRP
  // pair calls. When the set is empty (pending-author) we still emit a
  // plan with nIaaProbes=0 — IAA itself will report pending-author and the
  // promote-time gate will block strict promotion.
  const humanSetPath = path.join(JUDGE_PROMPTS_DIR, 'human-validation-set.json');
  let nIaaProbes = 0;
  if (!opts.skipIaa && existsSync(humanSetPath)) {
    try {
      const hs = JSON.parse(readFileSync(humanSetPath, 'utf8'));
      nIaaProbes = Array.isArray(hs.probes) ? hs.probes.length : 0;
    } catch { /* malformed — treat as 0 */ }
  }
  const cost = estimateCost(tuples, {
    maxTuples: opts.maxTuples,
    nJudges: opts.judgeModels.length,
    nIaaProbes,
  });

  const outDir = path.join(RESULTS_BASE, opts.runId);
  mkdirSync(outDir, { recursive: true });
  const planPath = path.join(outDir, 'track-b-plan.json');

  const plan = {
    runId: opts.runId,
    generatedAt: new Date().toISOString(),
    seed: opts.seed,
    subsampleSize: opts.subsampleSize,
    includeUv: opts.includeUv,
    maxTuples: opts.maxTuples,
    nGoldsSampled: subsample.length,
    nTuples: tuples.length,
    sampledGoldIds: subsample.map((g) => g.id),
    perRepoCounts: subsample.reduce((acc, g) => {
      acc[g.repo] = (acc[g.repo] || 0) + 1;
      return acc;
    }, {}),
    perStratumCounts: subsample.reduce((acc, g) => {
      acc[g.qshape_stratum] = (acc[g.qshape_stratum] || 0) + 1;
      return acc;
    }, {}),
    cost,
    judgeModels: opts.judgeModels,
    nIaaProbes,
    judgePanelConfig: 'core/prompt-optimization/data/judge-prompts/disjoint-panel.toml',
    judgePanelLimitation:
      'claude-runner.js currently routes only to Anthropic models; non-Anthropic lineages from disjoint-panel.toml (gpt-5-5, gemini-3-1-pro, qwen3.6-max) require a per-provider runner. The Anthropic-only multi-judge panel (sonnet, opus) is a partial realisation of §11.6.',
    shapeForcingPromptStrategy: 'see shapeForcingBlock() in track-b.mjs + shape-constrained policy',
    p63StopRule: 'Halt if judge IAA α < 0.5 even after one rubric rewrite (humans-only on the affected metric).',
    tuples: tuples.slice(0, 5).concat([{ '...': `(${tuples.length - 5} more truncated for plan readability)` }]),
  };

  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  process.stdout.write(`track-b: plan → ${planPath}\n`);
  process.stdout.write(
    `track-b: ${tuples.length} tuples` +
    (opts.maxTuples != null ? ` (capped to ${opts.maxTuples} via --max-tuples)` : '') +
    `; judges=${opts.judgeModels.length} [${opts.judgeModels.join(',')}]; ` +
    `iaa_probes=${nIaaProbes}; ` +
    `estimated $${cost.totalEstimatedUSD.toFixed(2)} ` +
    `(${cost.nAgentRuns} agent runs @ subscription, ${cost.nJudgeCalls} judge calls @ ` +
    `$${COST_PER_JUDGE_CALL_USD.toFixed(4)}; full-slate $${cost.fullSlateUSD.toFixed(2)})\n`
  );

  if (opts.dryRun) {
    process.stdout.write('track-b: DRY RUN. Re-run with --confirm-cost <USD> to execute.\n');
    return;
  }

  if (!Number.isFinite(opts.confirmCost) || opts.confirmCost < cost.totalEstimatedUSD) {
    process.stderr.write(
      `track-b: --confirm-cost ${opts.confirmCost} is below estimated ` +
      `$${cost.totalEstimatedUSD.toFixed(2)}. Aborting.\n`
    );
    process.exit(5);
  }

  const result = await runRealSweep({ tuples, opts, runId: opts.runId, outDir });
  const summary = {
    runId: opts.runId,
    generatedAt: new Date().toISOString(),
    judgeModels: opts.judgeModels,
    nAgentRuns: result.records.length,
    nAgentOk: result.records.filter((r) => r.runStatus === 'ok').length,
    nJudgePairs: result.judgeRecords.length,
    iaa: result.iaa,
    perToolWinRates: aggregatePerToolWinRates(result.judgeRecords),
  };
  writeFileSync(path.join(outDir, 'track-b-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(`track-b: summary → ${path.join(outDir, 'track-b-summary.json')}\n`);
  if (result.iaa?.status === 'pending-author') {
    process.stdout.write(
      `track-b: IAA is PENDING-AUTHOR (human-validation-set has 0 probes; ` +
      `${result.iaa.n_required ?? 30} required) — promote.mjs strict mode will BLOCK promotion.\n`
    );
  } else if (result.iaa?.status === 'ok') {
    process.stdout.write(
      `track-b: IAA panel-majority α=${result.iaa.majority?.alpha?.toFixed(3) ?? 'NaN'} ` +
      `(threshold ${result.iaa.alphaMajority}; ${result.iaa.majority?.passes ? 'PASS' : 'FAIL'}); ` +
      `per-judge: ${result.iaa.perJudge.map((j) => `${j.judge}=${(j.alpha ?? NaN).toFixed(3)}`).join(', ')}\n`
    );
  }
}

function aggregatePerToolWinRates(judgeRecords) {
  // Per (tool, shape): fraction of golds where candidate beat baseline under PRP.
  const byCell = new Map();
  for (const r of judgeRecords) {
    const k = `${r.tool}|${r.shape}`;
    if (!byCell.has(k)) byCell.set(k, { tool: r.tool, shape: r.shape, n: 0, wins: 0, ties: 0, losses: 0 });
    const c = byCell.get(k);
    c.n += 1;
    if (r.aggregate === 'candidate') c.wins += 1;
    else if (r.aggregate === 'tie') c.ties += 1;
    else c.losses += 1;
  }
  return [...byCell.values()].map((c) => ({
    ...c,
    winRate: c.n > 0 ? c.wins / c.n : 0,
    tieRate: c.n > 0 ? c.ties / c.n : 0,
  }));
}

main().catch((err) => {
  process.stderr.write(`track-b: ${err.stack || err.message}\n`);
  process.exit(1);
});
