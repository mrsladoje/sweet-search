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
//   - Agent runs via Gemini 3 Flash: ~$0.01 per run (pay-per-use;
//     ~10-15K tokens per multi-turn agent interaction at $0.15/$0.60 per 1M)
//   - Agent runs via Claude Max subscription: $0 marginal (but burns plan quota)
//   - PRP judge (DeepSeek V4 Pro OR Gemini 3 Flash): ~$0.001 per call
const COST_PER_JUDGE_CALL_USD = 0.001;
const COST_PER_AGENT_RUN_USD = 0.01;     // Gemini 3 Flash estimate

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
    // Default agent model: Gemini 3 Flash Preview (cheap, fast, good quality).
    // Use 'sonnet' for Claude Max subscription runs (zero marginal cost but
    // burns plan quota). Use 'gemini-3-flash-preview' for pay-per-use.
    // The model ID 'gemini-3-flash-preview' is the Google API name; both
    // the gemini CLI and the direct API accept this form.
    agentModel: 'gemini-3-flash-preview',
    // (G2.) Disjoint-family panel (§11.6): pass --judge-models a,b,c.
    // Default is Gemini 3 Flash Preview (replaces Sonnet for cost efficiency).
    // judge-runner.js routes via prefix heuristic: gemini-* → google lineage,
    // deepseek-* → deepseek lineage, claude-* / sonnet → anthropic, etc.
    judgeModel: 'gemini-3-flash-preview',
    judgeModels: null,                     // null → fall back to [judgeModel]
    timeoutMs: 240000,
    skipAgent: false,                      // judge-only mode (re-judge an existing track-b.jsonl)
    skipJudge: false,                       // agent-only mode (no judge calls)
    skipIaa: false,                         // skip the IAA probe pass (still runs PRP swap)
    // Resume from an existing JSONL: read agent records from this file,
    // skip the agent phase entirely, and re-judge with the current panel.
    // Discards any prior judge records in the source file (re-judging
    // with a new panel is the whole point). The output JSONL gets the
    // preserved agent records + fresh judge records.
    resumeFromJsonl: null,
    // Resume from an existing JSONL: read agent records from this file,
    // skip the agent phase entirely, and re-judge with the current panel.
    // Discards any prior judge records in the source file (re-judging
    // with a new panel is the whole point). The output JSONL gets the
    // preserved agent records + fresh judge records.
    resumeFromJsonl: null,
    // Bounded concurrency for agent + judge calls. Each in-flight call spawns
    // a CLI subprocess (claude / codex / gemini) with its own remote-API
    // request, so the cap protects both local CPU and provider rate limits.
    // 6 is empirically safe for Anthropic Max (Tier-2-mapped, ~1000 RPM
    // ceiling) and DeepSeek (dynamic concurrency, retries on 429). Lower it
    // (e.g. --concurrency 3) when the panel adds smaller-tier providers.
    concurrency: 6,
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
    else if (a === '--concurrency') o.concurrency = Math.max(1, parseInt(argv[++i], 10));
    else if (a === '--resume-from-jsonl') o.resumeFromJsonl = argv[++i];
  }
  if (!o.runId) {
    process.stderr.write('track-b: --run <runId> required (matches preregistration tag)\n');
    process.exit(2);
  }
  if (!o.judgeModels) o.judgeModels = [o.judgeModel];
  return o;
}

function countDoneRecords(jsonlPath) {
  if (!existsSync(jsonlPath)) return 0;
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
  let count = 0;
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (rec._kind === 'judge') continue;
      if (rec.runStatus === 'ok' || rec.runStatus === 'timeout') count++;
    } catch { /* skip */ }
  }
  return count;
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

function estimateCost(tuples, { maxTuples = null, nJudges = 1, nIaaProbes = 0, resumeFromJsonl = null, nAlreadyDone = 0 } = {}) {
  // (G3.) Honour --max-tuples in the budget gate so the cost cap reflects
  // what we'll actually spend, not a worst-case full-slate estimate.
  // When resuming, only count tuples not yet completed for agent cost.
  const effectiveTuples = maxTuples != null ? Math.min(maxTuples, tuples.length) : tuples.length;
  const nRemainingTuples = Math.max(0, effectiveTuples - nAlreadyDone);
  const nAgentRuns = resumeFromJsonl ? nRemainingTuples : effectiveTuples;
  // Judge calls scale with all effective tuples (existing + new) × swaps × judges,
  // plus IAA probes.
  const nJudgeCalls = effectiveTuples * 2 * nJudges + nIaaProbes * nJudges;
  const nResumedAgentRecords = nAlreadyDone;
  return {
    nAgentRuns,
    nResumedAgentRecords,
    nRemainingTuples,
    nJudgeCalls,
    nJudges,
    nIaaProbes,
    agentCostUSD: nAgentRuns * COST_PER_AGENT_RUN_USD,
    judgeCostUSD: nJudgeCalls * COST_PER_JUDGE_CALL_USD,
    totalEstimatedUSD: nAgentRuns * COST_PER_AGENT_RUN_USD + nJudgeCalls * COST_PER_JUDGE_CALL_USD,
    fullSlateUSD: tuples.length * COST_PER_AGENT_RUN_USD
      + tuples.length * 2 * nJudges * COST_PER_JUDGE_CALL_USD
      + nIaaProbes * nJudges * COST_PER_JUDGE_CALL_USD,
  };
}

function parseAgentLineage(model) {
  if (model.includes(':')) {
    const [lineage] = model.split(':');
    return lineage;
  }
  const lc = model.toLowerCase();
  if (lc.startsWith('gemini-')) return 'google';
  if (lc.startsWith('gpt-') || lc.startsWith('o1-') || lc.startsWith('o3-') || lc.startsWith('o4-')) return 'openai';
  if (lc.startsWith('deepseek-') || lc.startsWith('ds-')) return 'deepseek';
  return 'anthropic';
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
  // (G3.) audit.js now accepts a rules object directly (added 2026-05-09 to
  // unblock concurrency in this driver), so we no longer mutate the global
  // TOOL_RULES map per tuple. Multiple tuples can run in parallel safely.

  const userPrompt = [
    `# Task\n${tuple.question}`,
    tuple.expectedNoMatch
      ? `\nNote: this task may have NO match in the codebase — the right answer says the symbol does not exist.`
      : '',
  ].filter(Boolean).join('\n');

  const t0 = Date.now();
  let run;
  const agentLineage = parseAgentLineage(opts.agentModel);
  if (agentLineage === 'google') {
    run = await context.runGeminiAgent({
      prompt: userPrompt,
      systemAppend,
      model: opts.agentModel.startsWith('google:') ? opts.agentModel.slice(7) : opts.agentModel,
      cwd: repoDir,
      allowedTools: toolRules.allowedTools,
      disallowedTools: toolRules.disallowedTools,
      addDirs: [path.join(REPO_ROOT, 'eval/agent-read-workflows/bin')],
      extraPathEntries: [path.join(REPO_ROOT, 'eval/agent-read-workflows/bin')],
      projectRoot: repoDir,
      timeoutMs: opts.timeoutMs,
      maxAttempts: 2,
    });
  } else {
    run = await context.runClaudeAgent({
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
  }
  const summary = summariseRun(run);
  const latencyMs = Date.now() - t0;

  // Audit transcript for policy violations (forbidden bash commands, etc.).
  // Pass rules object directly so concurrent tuples don't race on a shared
  // TOOL_RULES map.
  const audit = auditRun(toolRules, run);
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
  const { extractAnswerJson, runJudge, parseJudgeModelSpec } = context;
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
  // (H2.) Cross-lineage dispatch via runJudge — anthropic / openai
  // (codex) / google (gemini) / deepseek / opencode all share the
  // normalized { text, isError, latencyMs } adapter shape.
  const spec = parseJudgeModelSpec(judgeModel);
  const run = await runJudge({
    lineage: spec.lineage,
    model: spec.model,
    systemPrompt: JUDGE_SYSTEM_PRP,
    userPrompt: prompt,
    timeoutMs: 90000,
  });
  const judgement = extractAnswerJson(run.text);
  // De-randomise A/B back to candidate-vs-baseline.
  const labelMap = swapPosition === 'A=baseline'
    ? { A: 'baseline', B: 'candidate', tie: 'tie' }
    : { A: 'candidate', B: 'baseline', tie: 'tie' };
  const preferred = labelMap[judgement?.preferred] ?? null;
  return {
    judgeModel,
    judgeLineage: spec.lineage,
    swapPosition,
    judgement,
    preferred,
    runMeta: {
      wallMs: run.latencyMs,
      isError: run.isError,
      error: run.error,
      raw: run.raw,
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

// ─── bounded concurrency pool ────────────────────────────────────────────

function makePoolRunner() {
  return async function runWithLimit(limit, items, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function pump() {
      while (true) {
        const idx = next++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(pump());
    await Promise.all(workers);
    return results;
  };
}

// ─── execution orchestration ──────────────────────────────────────────────

async function runRealSweep({ tuples, opts, runId, outDir }) {
  // Lazy-import the agent harness only when a real run is actually requested,
  // so dry-run paths don't pay the import cost or trip env requirements.
  const policiesMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/policies.js'));
  const runnerMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/claude-runner.js'));
  const judgeRunnerMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/judge-runner.js'));
  const auditMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/audit.js'));
  const metricsMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/metrics.js'));
  const context = {
    POLICIES: policiesMod.POLICIES,
    buildShapeConstrainedRules: policiesMod.buildShapeConstrainedRules,
    runClaudeAgent: runnerMod.runClaudeAgent,
    runGeminiAgent: judgeRunnerMod.runGeminiAgent,
    summariseRun: runnerMod.summariseRun,
    extractAnswerJson: runnerMod.extractAnswerJson,
    runJudge: judgeRunnerMod.runJudge,
    parseJudgeModelSpec: judgeRunnerMod.parseJudgeModelSpec,
    auditRun: auditMod.auditRun,
    scoreAnswer: metricsMod.scoreAnswer,
  };

  const jsonlPath = path.join(outDir, 'track-b.jsonl');

  // ── resume-from-jsonl: load existing agent records, run only missing tuples,
  // then judge everything. Prior judge records are discarded — re-judging
  // with the current panel is the whole point of resuming.
  if (opts.resumeFromJsonl) {
    const resumePath = opts.resumeFromJsonl;
    if (!existsSync(resumePath)) {
      process.stderr.write(`track-b: --resume-from-jsonl file not found: ${resumePath}\n`);
      process.exit(6);
    }
    const rawLines = readFileSync(resumePath, 'utf8').split('\n').filter(Boolean);
    const existingRecs = [];
    let discardedJudges = 0;
    for (const line of rawLines) {
      try {
        const rec = JSON.parse(line);
        if (rec._kind === 'judge') { discardedJudges++; continue; }
        existingRecs.push(rec);
      } catch { /* skip malformed lines */ }
    }
    process.stdout.write(
      `track-b: resume from ${resumePath}: loaded ${existingRecs.length} agent records, ` +
      `discarded ${discardedJudges} prior judge records\n`
    );
    // Build set of (goldId|tool|variantId) keys already completed so we can
    // skip them in the agent phase.
    const doneKeys = new Set();
    for (const r of existingRecs) {
      if (r.runStatus === 'ok' || r.runStatus === 'timeout') {
        doneKeys.add(`${r.goldId}|${r.tool}|${r.variantId}`);
      }
    }
    // Filter tuples to only those not yet completed.
    const missingTuples = tuples.filter((t) => !doneKeys.has(`${t.goldId}|${t.tool}|${t.variantId}`));
    process.stdout.write(
      `track-b: resume: ${tuples.length} total tuples, ${doneKeys.size} already done, ` +
      `${missingTuples.length} remaining to run\n`
    );
    // Write the preserved agent records to the output JSONL (truncating any
    // prior file for this runId).
    writeFileSync(jsonlPath, existingRecs.map((r) => JSON.stringify(r)).join('\n') + '\n');

    // Run only the missing tuples through the agent phase.
    const records = [...existingRecs];
    if (missingTuples.length > 0) {
      const concurrency = Math.max(1, opts.concurrency || 1);
      process.stdout.write(`track-b: resume agent phase, ${missingTuples.length} missing tuples, concurrency=${concurrency}\n`);
      let agentDone = 0;
      let agentStarted = 0;
      const total = missingTuples.length;
      const t0Agent = Date.now();
      const fmtTs = () => new Date().toISOString().slice(11, 19);
      const completedRecords = await runWithLimit(concurrency, missingTuples, async (tuple) => {
        const myIdx = ++agentStarted;
        const tag = `${tuple.repo}/${tuple.goldId}/${tuple.tool}/${tuple.variantId}`;
        process.stdout.write(`[${fmtTs()}] track-b: resume-agent start ${myIdx}/${total} ${tag}\n`);
        const tStart = Date.now();
        const rec = await executeTuple(tuple, runId, opts, context);
        appendFileSync(jsonlPath, JSON.stringify(rec) + '\n');
        agentDone += 1;
        const dt = ((Date.now() - tStart) / 1000).toFixed(1);
        const overall = ((Date.now() - t0Agent) / 1000).toFixed(1);
        process.stdout.write(`[${fmtTs()}] track-b: resume-agent done  ${agentDone}/${total} ${tag} (${rec.runStatus}, ${dt}s; cumul ${overall}s)\n`);
        return rec;
      });
      records.push(...completedRecords);
    } else {
      process.stdout.write('track-b: resume: all tuples already completed, skipping agent phase\n');
    }
    // Judge all records (existing + newly completed) with the current panel.
    const judgeResult = await judgePhase({ records, opts, runId, outDir, jsonlPath, context });
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
    return { records, judgeRecords: judgeResult.judgeRecords, iaa };
  }

  // Truncate any prior partial run for this runId — a Track B re-run is
  // always a full replacement, never an append (otherwise stale cost
  // accounting silently doubles).
  writeFileSync(jsonlPath, '');

  const records = [];
  const cap = opts.maxTuples ?? tuples.length;
  const tuplesToRun = tuples.slice(0, cap);
  const concurrency = Math.max(1, opts.concurrency || 1);
  process.stdout.write(`track-b: agent phase, ${tuplesToRun.length} tuples, concurrency=${concurrency}\n`);

  let agentDone = 0;
  let agentStarted = 0;
  const total = tuplesToRun.length;
  const t0Agent = Date.now();
  const fmtTs = () => new Date().toISOString().slice(11, 19);
  const completedRecords = await runWithLimit(concurrency, tuplesToRun, async (tuple) => {
    const myIdx = ++agentStarted;
    const tag = `${tuple.repo}/${tuple.goldId}/${tuple.tool}/${tuple.variantId}`;
    process.stdout.write(`[${fmtTs()}] track-b: agent start ${myIdx}/${total} ${tag}\n`);
    let rec;
    const tStart = Date.now();
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
    agentDone += 1;
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    const overall = ((Date.now() - t0Agent) / 1000).toFixed(1);
    process.stdout.write(`[${fmtTs()}] track-b: agent done  ${agentDone}/${total} ${tag} (${rec.runStatus}, ${dt}s; cumul ${overall}s)\n`);
    return rec;
  });
  records.push(...completedRecords);

  // Pair candidates with their V4 baseline (same gold + tool) for PRP judging.
  // (G2.) Each pair is judged by EVERY model in opts.judgeModels and the
  // panel majority becomes the per-pair aggregate. Per-judge votes are
  // retained on the record so cross-judge disagreement is auditable.
  //
  // Parallelism strategy: every (cand × judgeModel × swapPosition) call is
  // independent on the network side, so we flatten the nested loops into a
  // single task list, run them with `runWithLimit(concurrency)`, and only
  // merge per-judge / panel aggregates after all swaps land. This unlocks
  // ~Nx wall-clock speedup (judges dominate Track B latency) while keeping
  // upstream-API concurrency bounded.
  const judgeResult = await judgePhase({ records, opts, runId, outDir, jsonlPath, context });
  const judgeRecords = judgeResult.judgeRecords;

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

// ─── judge phase (extracted for reuse by --resume-from-jsonl) ────────────

async function judgePhase({ records, opts, runId, outDir, jsonlPath, context }) {
  const goldsRaw = JSON.parse(readFileSync(path.join(QSHAPE_DIR, 'golds.json'), 'utf8'));
  const judgeRecords = [];
  if (opts.skipJudge) return { judgeRecords };

  const concurrency = Math.max(1, opts.concurrency || 1);

  const byGoldTool = new Map();
  for (const r of records) {
    if (r.runStatus !== 'ok') continue;
    const k = `${r.goldId}|${r.tool}`;
    if (!byGoldTool.has(k)) byGoldTool.set(k, { baseline: null, candidates: [] });
    const slot = byGoldTool.get(k);
    if (r.isBaseline) slot.baseline = r;
    else slot.candidates.push(r);
  }

  // Build flat task list: one entry per (cand, judgeModel, swapPosition).
  const swapTasks = [];
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
      for (const jm of opts.judgeModels) {
        for (const swap of ['A=baseline', 'A=candidate']) {
          swapTasks.push({ slot, cand, gold, task, judgeModel: jm, swapPosition: swap });
        }
      }
    }
  }

  const fmtTs = () => new Date().toISOString().slice(11, 19);
  process.stdout.write(`track-b: judge phase, ${swapTasks.length} swap calls (${opts.judgeModels.length} judges × pairs × 2 swaps), concurrency=${concurrency}\n`);
  let judgeDone = 0;
  let judgeStarted = 0;
  const totalJudges = swapTasks.length;
  const t0Judge = Date.now();
  const swapResults = await runWithLimit(concurrency, swapTasks, async (t) => {
    const myIdx = ++judgeStarted;
    const tag = `${t.cand.goldId}/${t.cand.tool}/${t.cand.variantId} judge=${t.judgeModel} ${t.swapPosition}`;
    process.stdout.write(`[${fmtTs()}] track-b: judge start ${myIdx}/${totalJudges} ${tag}\n`);
    const tStart = Date.now();
    const r = await callPrpJudge({
      task: t.task, candidateRecord: t.cand, baselineRecord: t.slot.baseline,
      judgeModel: t.judgeModel, swapPosition: t.swapPosition, runId, context,
    });
    judgeDone += 1;
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    const overall = ((Date.now() - t0Judge) / 1000).toFixed(1);
    const verdict = r?.preferred ?? (r?.isError ? 'ERROR' : '?');
    process.stdout.write(`[${fmtTs()}] track-b: judge done  ${judgeDone}/${totalJudges} ${tag} → ${verdict} (${dt}s; cumul ${overall}s)\n`);
    return { ...t, result: r };
  });

  // Group by (gold|tool|variant|judgeModel) — within each group we have
  // both swapA and swapB; aggregate them into a per-judge verdict.
  const byCandJudge = new Map();
  for (const sr of swapResults) {
    const k = `${sr.cand.goldId}|${sr.cand.tool}|${sr.cand.variantId}|${sr.judgeModel}`;
    if (!byCandJudge.has(k)) byCandJudge.set(k, { cand: sr.cand, slot: sr.slot, judgeModel: sr.judgeModel, swapA: null, swapB: null });
    const e = byCandJudge.get(k);
    if (sr.swapPosition === 'A=baseline') e.swapA = sr.result;
    else e.swapB = sr.result;
  }

  // Group those per-judge verdicts back by (gold|tool|variant) → panel.
  const byCand = new Map();
  for (const e of byCandJudge.values()) {
    const k = `${e.cand.goldId}|${e.cand.tool}|${e.cand.variantId}`;
    if (!byCand.has(k)) byCand.set(k, { cand: e.cand, slot: e.slot, perJudge: [] });
    let perJudgeAggregate;
    if (e.swapA?.preferred === 'candidate' && e.swapB?.preferred === 'candidate') perJudgeAggregate = 'candidate';
    else if (e.swapA?.preferred === 'baseline' && e.swapB?.preferred === 'baseline') perJudgeAggregate = 'baseline';
    else perJudgeAggregate = 'tie';
    byCand.get(k).perJudge.push({
      judgeModel: e.judgeModel,
      aggregate: perJudgeAggregate,
      swaps: [e.swapA, e.swapB],
    });
  }

  for (const e of byCand.values()) {
    const counts = new Map();
    for (const pj of e.perJudge) counts.set(pj.aggregate, (counts.get(pj.aggregate) || 0) + 1);
    let panelAggregate = 'tie', best = 0;
    for (const [k, v] of counts) {
      if (v > best) { panelAggregate = k; best = v; }
    }
    const judgeRec = {
      goldId: e.cand.goldId, tool: e.cand.tool, shape: e.cand.shape,
      variantId: e.cand.variantId, baselineVariantId: e.slot.baseline.variantId,
      aggregate: panelAggregate,
      perJudge: e.perJudge,
      n_judges: opts.judgeModels.length,
    };
    judgeRecords.push(judgeRec);
    appendFileSync(jsonlPath, JSON.stringify({ ...judgeRec, _kind: 'judge' }) + '\n');
  }

  return { judgeRecords };
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
    resumeFromJsonl: opts.resumeFromJsonl,
    nAlreadyDone: opts.resumeFromJsonl ? countDoneRecords(opts.resumeFromJsonl) : 0,
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
    judgePanelHarness:
      'judge-runner.js routes Anthropic via claude CLI, OpenAI via codex exec, Google via gemini -p, DeepSeek via claude-CLI-with-redirected-base-URL (parity-preserving), and other lineages (Llama/Qwen/Mistral/Cohere) via opencode run. Tokens accept explicit lineage:model form (e.g. anthropic:claude-sonnet-4-6, openai:gpt-5.5, google:gemini-3-1-pro, deepseek:deepseek-v4-pro) or use the prefix heuristic (gpt-* → openai, gemini-* → google, deepseek-* → deepseek-via-claude). A raw-API escape hatch is `deepseek-api:` for budget-controlled runs; default deepseek lineage routes through the CLI harness for §11.6 panel parity.',
    shapeForcingPromptStrategy: 'see shapeForcingBlock() in track-b.mjs + shape-constrained policy',
    resumeFromJsonl: opts.resumeFromJsonl || null,
    agentModel: opts.agentModel,
    p63StopRule: 'Halt if judge IAA α < 0.5 even after one rubric rewrite (humans-only on the affected metric).',
    tuples: tuples.slice(0, 5).concat([{ '...': `(${tuples.length - 5} more truncated for plan readability)` }]),
  };

  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  process.stdout.write(`track-b: plan → ${planPath}\n`);
  const resumeNote = opts.resumeFromJsonl
    ? ` [RESUME from ${opts.resumeFromJsonl}; ${cost.nResumedAgentRecords} done, ${cost.nRemainingTuples} remaining agent runs]`
    : '';
  process.stdout.write(
    `track-b: ${tuples.length} tuples` +
    (opts.maxTuples != null ? ` (capped to ${opts.maxTuples} via --max-tuples)` : '') +
    `; judges=${opts.judgeModels.length} [${opts.judgeModels.join(',')}]; ` +
    `agent=${opts.agentModel}; ` +
    `iaa_probes=${nIaaProbes}; ` +
    `estimated $${cost.totalEstimatedUSD.toFixed(2)} ` +
    `(${cost.nAgentRuns} agent runs @ $${COST_PER_AGENT_RUN_USD.toFixed(2)}/ea${opts.resumeFromJsonl ? `, ${cost.nResumedAgentRecords} reused from resume` : ''}, ${cost.nJudgeCalls} judge calls @ ` +
    `$${COST_PER_JUDGE_CALL_USD.toFixed(4)}/ea; full-slate $${cost.fullSlateUSD.toFixed(2)})${resumeNote}\n`
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
