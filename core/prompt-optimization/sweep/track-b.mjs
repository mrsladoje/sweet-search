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
 *   1. Subsample Track A to 18-24 golds (3-4 per repo, stratified by query
 *      type) — enough for IAA discipline without burning a thousand-dollar
 *      bill.
 *   2. For each (gold × shape × tool):
 *      - Spawn Claude Code in headless mode with a system prompt that
 *        FORCES the shape ("you MUST phrase your sweet-search query as <X>")
 *        and only allows the one tool under test.
 *      - Run end-to-end. Capture trace, answer, deterministic recall metrics.
 *   3. Run PRP-style two-judge LLM-as-judge (DSv4-Pro + Sonnet 4.6) per
 *      §11.6 with position-bias swap.
 *   4. Validate judges against ≥30-probe human-labelled subset; require
 *      Krippendorff α ≥ 0.6 individual, ≥ 0.7 majority before metrics are
 *      published.
 *
 * COST WARNING: Track B costs $80-150 per full sweep (Sonnet 4.6 agent runs +
 * judge calls). It is GATED behind:
 *   - the §13.7 P6.2 stop rule (Track A best-shape recall@1 must be ≥ 0.5
 *     for at least one tool),
 *   - the explicit `--confirm-cost <budget-cap>` flag,
 *   - the campaign-wide budget tracker (`appendBudgetTelemetry`).
 *
 * Default behaviour: this scaffold runs in `--dry-run` mode, planning the
 * sweep and emitting the planned tuples + cost estimate without spending.
 *
 * Plan reference: §7.5 Track B, §11.6 disjoint-family judge panel, §13.7 stop
 * rules.
 *
 * Usage:
 *   node core/prompt-optimization/sweep/track-b.mjs --run qshape-v1                # dry-run plan
 *   node core/prompt-optimization/sweep/track-b.mjs --run qshape-v1 --confirm-cost 5
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const QSHAPE_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes');
const RESULTS_BASE = path.join(REPO_ROOT, 'core/prompt-optimization/data/results');

const TOOLS_IN_SCOPE = ['ss-search', 'ss-find', 'ss-semantic', 'structural'];

// Track B costs (rough estimates per §7.5 / §10.6):
//   - Sonnet 4.6 via Claude Max: $0 marginal (subscription)
//   - DSv4-Pro judge call: ~$0.0015 per (gold, shape, tool, position-swap)
//     pair in PRP protocol → ~$0.003 per pair after swap.
//   - Per gold × 6 shapes × 4 tools × 2 swaps × 1 judge = 48 calls × $0.0015
//     = $0.072 per gold; 24-gold subsample → ~$1.73; with reserve and IAA
//     validation ~$3-5.
const COST_PER_JUDGE_CALL_USD = 0.0015;
const COST_PER_AGENT_RUN_USD = 0;          // Sonnet via Claude Max subscription

// ─── argv ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = {
    runId: null,
    confirmCost: null,
    subsampleSize: 24,
    seed: 42,
    dryRun: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.runId = argv[++i];
    else if (a === '--confirm-cost') {
      o.confirmCost = parseFloat(argv[++i]);
      o.dryRun = false;
    } else if (a === '--subsample') o.subsampleSize = parseInt(argv[++i], 10);
    else if (a === '--seed') o.seed = parseInt(argv[++i], 10);
  }
  if (!o.runId) {
    process.stderr.write('track-b: --run <runId> required (matches preregistration tag)\n');
    process.exit(2);
  }
  return o;
}

// ─── stratified subsample ─────────────────────────────────────────────────

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function stratifiedSubsample(records, n, seed) {
  // 4 strata × 4 dev repos + 1 uv stratum balanced. We aim for n ≈ 24.
  // Allocate per-repo (8 per dev repo's 12 = 4-3-3-2 mapped down to 4-3-3-2,
  // taking 1-2 per stratum per repo + 4-6 from uv).
  const rng = mulberry32(seed);
  const byKey = new Map();
  for (const r of records) {
    if (r.tier !== 'dev' && r.repo !== 'uv') continue;
    const key = `${r.repo}|${r.qshape_stratum}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  // Sort each bucket deterministically by id, then shuffle per-RNG.
  for (const [, list] of byKey) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  // Allocation: dev repos get 5 each (1-2 per stratum), uv gets 4-5.
  const target = {
    fastify: 5, gin: 5, flask: 5, ripgrep: 5, uv: 4,
  };
  const remaining = n;
  let used = 0;
  const picked = [];
  for (const [repo, slots] of Object.entries(target)) {
    const repoBuckets = [...byKey.entries()]
      .filter(([k]) => k.startsWith(repo + '|'))
      .map(([, v]) => v);
    let taken = 0;
    // round-robin across strata until slots filled or exhausted
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
  return picked;
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
        // skip ss-semantic when no expected file (it's single-file-scoped)
        if (tool === 'ss-semantic' && (!gold.expectedFiles || gold.expectedFiles.length === 0)) {
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
          expectedFiles: gold.expectedFiles,
          expectedSymbols: gold.expectedSymbols,
          expectedFacts: gold.expectedFacts,
          expectedLineRanges: gold.expectedLineRanges,
          predicted_winning_tool: gold.predicted_winning_tool,
          predicted_winning_shape: gold.predicted_winning_shape,
        });
      }
    }
  }
  return tuples;
}

function estimateCost(tuples) {
  const nAgentRuns = tuples.length;
  const nJudgeCalls = tuples.length * 2; // PRP swap doubles per-pair count
  return {
    nAgentRuns,
    nJudgeCalls,
    agentCostUSD: nAgentRuns * COST_PER_AGENT_RUN_USD,
    judgeCostUSD: nJudgeCalls * COST_PER_JUDGE_CALL_USD,
    totalEstimatedUSD: nAgentRuns * COST_PER_AGENT_RUN_USD + nJudgeCalls * COST_PER_JUDGE_CALL_USD,
  };
}

// ─── shape-forcing system prompt ──────────────────────────────────────────

function shapeForcingSystemPrompt(tool, variant) {
  // Per §7.5: the agent's system prompt "FORCES the shape". The exact
  // wording is part of the experimental treatment; we record it in the
  // sweep manifest so the trace is reproducible.
  const baseTool = (() => {
    switch (tool) {
      case 'ss-search':   return 'ss-search';
      case 'ss-find':     return 'ss-find with --regex';
      case 'ss-semantic': return 'ss-semantic <file>';
      case 'structural':  return 'ss-search --mode hybrid';
      default: throw new Error(`unknown tool ${tool}`);
    }
  })();
  return [
    `You are an autonomous developer agent helping with a code-question task.`,
    `For this run you may ONLY use the tool: ${baseTool}.`,
    `You MUST phrase your query in this exact shape:`,
    `  Shape: ${variant.shape}`,
    `  Suggested query phrasing: ${JSON.stringify(variant.query)}`,
    variant.regex ? `  Regex anchor: ${variant.regex}` : '',
    `Do NOT improvise alternative phrasings — that defeats the experiment.`,
    `Answer the user's question using only results from this single tool.`,
    `Cite all referenced files and line numbers explicitly.`,
  ].filter(Boolean).join('\n');
}

// ─── execute one tuple (real run, NOT scaffolded yet) ─────────────────────

async function executeTuple(tuple, runId) {
  // Real implementation depends on:
  //   - claude-runner.js (eval/agent-read-workflows/) for headless Claude
  //   - the shape-forcing system prompt above
  //   - the disjoint-panel.toml judge config
  //
  // This scaffold throws so a fresh dry-run is the only safe default until
  // the implementation (P6.3 follow-up) lands.
  throw new Error(
    `track-b: real execution not yet wired — run with --confirm-cost is gated. ` +
    `The Track B implementation lives behind a follow-up commit per §13.7 P6.3. ` +
    `Re-run without --confirm-cost for a dry-run plan.`
  );
}

// ─── PRP two-judge call (scaffold) ────────────────────────────────────────

async function callPrpJudge({ tupleA, tupleB, runId }) {
  // Per §11.6: PRP pairwise-with-swap. Scaffolded; implementation lands at
  // P6.3 alongside the disjoint-family panel orchestration.
  throw new Error('track-b: PRP judge call not yet wired (P6.3 follow-up).');
}

// ─── IAA validation ───────────────────────────────────────────────────────

async function validateIaa({ humanSetPath, judges, alphaIndividual, alphaMajority }) {
  // Stub — the real Krippendorff-alpha computation lives in the campaign
  // judge tally tooling and is plumbed at P6.3.
  throw new Error('track-b: IAA validation not yet wired (P6.3 follow-up).');
}

// ─── main ─────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const goldsRaw = JSON.parse(readFileSync(path.join(QSHAPE_DIR, 'golds.json'), 'utf8'));
  const variantsRaw = JSON.parse(readFileSync(path.join(QSHAPE_DIR, 'variants.json'), 'utf8'));

  const subsample = stratifiedSubsample(goldsRaw.records, opts.subsampleSize, opts.seed);
  const tuples = buildPlan({ goldsRaw, variantsRaw, subsample });
  const cost = estimateCost(tuples);

  const outDir = path.join(RESULTS_BASE, opts.runId);
  mkdirSync(outDir, { recursive: true });
  const planPath = path.join(outDir, 'track-b-plan.json');

  const plan = {
    runId: opts.runId,
    generatedAt: new Date().toISOString(),
    seed: opts.seed,
    subsampleSize: opts.subsampleSize,
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
    judgePanelConfig: 'core/prompt-optimization/data/judge-prompts/disjoint-panel.toml',
    shapeForcingPromptStrategy: 'see shapeForcingSystemPrompt() in track-b.mjs',
    p63StopRule: 'Halt if judge IAA α < 0.5 even after one rubric rewrite (humans-only on the affected metric).',
    tuples: tuples.slice(0, 5).concat([{ '...': `(${tuples.length - 5} more truncated for plan readability)` }]),
  };

  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  process.stdout.write(`track-b: plan → ${planPath}\n`);
  process.stdout.write(
    `track-b: ${tuples.length} tuples; estimated $${cost.totalEstimatedUSD.toFixed(2)} ` +
    `(${cost.nAgentRuns} agent runs @ subscription, ${cost.nJudgeCalls} judge calls @ ` +
    `$${COST_PER_JUDGE_CALL_USD.toFixed(4)})\n`
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

  process.stderr.write(
    'track-b: real execution path is GATED (P6.3 follow-up) — agent runs + judge orchestration ' +
    'land in a separate commit. Refusing to execute until then.\n'
  );
  process.exit(6);
}

main();
