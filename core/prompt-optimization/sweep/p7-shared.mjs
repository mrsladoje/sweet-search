/**
 * Phase 7 — shared contracts.
 *
 * Single source of truth for the schemas, scoring defaults, the protected-token
 * grammar, the probe record shape, and the canonical target keys that EVERY P7
 * module agrees on (gepa / eas / tare / operators / persist / scs / preflight /
 * author-probes / the direct-API runners). Keep this file dependency-light so it
 * can be imported by pure-logic modules and by orchestration scripts alike.
 *
 * Plan references: docs/PHASE7.md §3.1, §3.2.1, §3.7.1, §5.1, §7.4.
 *
 * Canonical target keys: we standardise on `'sonnet'` and `'gpt5_5'` internally
 * (matches the §3.7.1 EAS pseudocode; avoids dots/dashes in object keys). The
 * §7.4 JSONL examples show `'gpt-5.5'` in places — `normalizeTarget()` maps any
 * surface form to the canonical key so persisted events stay consistent.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

// ─── canonical targets ────────────────────────────────────────────────────

export const TARGETS = Object.freeze({ SONNET: 'sonnet', GPT5_5: 'gpt5_5' });
export const TARGET_LIST = Object.freeze([TARGETS.SONNET, TARGETS.GPT5_5]);

/** Map any surface form (sonnet, gpt-5.5, gpt5.5, gpt5_5, …) → canonical key. */
export function normalizeTarget(t) {
  if (typeof t !== 'string') throw new TypeError('normalizeTarget: string required');
  const lc = t.toLowerCase();
  if (lc.includes('sonnet') || lc.includes('claude') || lc.includes('anthropic')) return TARGETS.SONNET;
  if (lc.includes('gpt') || lc.includes('openai') || lc.includes('5.5') || lc.includes('5_5')) return TARGETS.GPT5_5;
  throw new RangeError(`normalizeTarget: cannot canonicalise target "${t}"`);
}

// ─── strata / difficulty ──────────────────────────────────────────────────

export const STRATA = Object.freeze(['literal-lookup', 'multi-file-flow', 'behavioral', 'no-match']);
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

/**
 * Per-stratum expected tool-call windows [lo, hi] used by EAS (§3.7.1 step 4).
 * A probe may override via its own `expected_call_window`.
 */
export const EXPECTED_CALL_WINDOW = Object.freeze({
  'literal-lookup': [1, 3], // quick targeted hit
  'multi-file-flow': [3, 6], // follow imports/refs
  behavioral: [3, 6],
  'no-match': [2, 5], // must verify the negative, not just guess
});

/** Resolve a probe's call window (probe override → stratum default). */
export function callWindowFor(probe) {
  if (probe && Array.isArray(probe.expected_call_window) && probe.expected_call_window.length === 2) {
    return probe.expected_call_window;
  }
  const w = EXPECTED_CALL_WINDOW[probe?.stratum];
  if (!w) throw new RangeError(`callWindowFor: no window for stratum "${probe?.stratum}"`);
  return w;
}

// ─── scoring defaults (§3.1, §3.7.1, §3.5, §3.6) ───────────────────────────

export const DEFAULTS = Object.freeze({
  // Pareto admission hard constraint vs the displaced incumbent (§3.7.1 step 9).
  paretoAdmissionCap: 0.15,
  // length_penalty = lengthPenaltyPer1000 × tokens/1000 (§3.7.1 step 5).
  lengthPenaltyPer1000: 0.05,
  // EAS per-call deviation penalty coefficient (§3.7.1 step 4).
  callDeviationPenaltyPerCall: 0.02,
  // Evidence-adequacy penalty for unsupported finals on non-trivial probes.
  evidenceAdequacyPenalty: 0.1,
  // Native-search contamination penalty (§4.5): the eval corpus is fully
  // indexed + static, so reaching for native grep/rg instead of the ss-* tools
  // bypasses the retrieval being optimized. Penalize per run that used native
  // search. Initial value — validate the native-fallback rate on first smoke.
  nativeSearchPenalty: 0.1,
  // Native-relative GEPA scoring. These make the scalar objective reward
  // beating native rg+Read on accuracy, tool-call count, and agent tokens.
  nativeRelativeWeights: { accuracy: 0.6, calls: 0.25, tokens: 0.15 },
  nativeAccuracyFloor: 0.8,
  nativeAccuracySlack: 0.03,
  nativeAccuracyTargetLift: 0.02,
  nativeAccuracyTargetFloor: 0.95,
  nativeCallTargetRatio: 0.5,
  nativeCallFailRatio: 1.5,
  nativeTokenTargetRatio: 0.65,
  nativeTokenFailRatio: 1.5,
  // ── Cache-naive, cross-model cost model (2026-05-29 scoring overhaul) ──────
  // USD per 1M tokens, pinned to provider list prices at the run date. "Cache-
  // naive" = every input token is priced at the FULL uncached rate; the cache
  // discount is a deployment property, deliberately excluded from the
  // optimization objective so the metric is reproducible across cache warmth /
  // request ordering (which probe "pays" cache_creation under concurrency is
  // otherwise random). Dollars (not raw tokens) normalize across tokenizers +
  // price tiers, so Sonnet and GPT-5.5 are directly comparable. Realized
  // (cache-aware) cost is reported separately as the deployment figure.
  // `cacheReadPerM` / `cacheWritePerM` are used ONLY for the realized (cache-aware)
  // deployment-cost figure reported alongside the cache-naive optimization metric;
  // they are NOT used by the optimization objective. Anthropic: read 0.1×, 5-min
  // write 1.25× input. OpenAI (gpt-5.5): cached input ~0.1×; no separate write charge.
  targetPrices: {
    sonnet: { inPerM: 3, outPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75, model: 'claude-sonnet-4-6', pinnedAt: '2026-05-29' },
    gpt5_5: { inPerM: 5, outPerM: 30, cacheReadPerM: 0.50, cacheWritePerM: 5, model: 'gpt-5.5', pinnedAt: '2026-05-29' },
  },
  // Cost desirability thresholds (relative to native rg+Read $, same shape as
  // the call/token thresholds): desirability 1 at ≤0.65× native, 0 at ≥1.5×.
  nativeCostTargetRatio: 0.65,
  nativeCostFailRatio: 1.5,
  // Efficiency-axis weights — accuracy is a SEPARATE axis + floor, NEVER blended
  // in here (2026-05-29 decouple). `cost` = cache-naive dollar cost (dominant);
  // `calls` = tool-call/round-trip count, retained as a latency proxy.
  efficiencyWeights: { cost: 0.7, calls: 0.3 },
  // Deterministic latency model (DIAGNOSTIC ONLY — never an optimization
  // objective). est_latency_s = turns × ttftSec + output_tokens / throughput.
  // Constants are published per-model figures (Artificial Analysis / Vellum,
  // 2026-05); wall-clock is rejected (machine contention + provider queueing +
  // network are not properties of the prompt, only of the run environment).
  targetLatency: {
    sonnet: { ttftSec: 0.8, throughputTokPerSec: 55 },
    gpt5_5: { ttftSec: 1.2, throughputTokPerSec: 50 },
  },
  // Hard-negative weighting (§3.1): noise floor + clip + stability gate.
  judgeNoiseFloor: 0.05,
  varianceWeightClip: [0.1, 2.0],
  varianceStabilityRounds: 2, // variance only counts after ≥2 rounds evaluated
  hardNegativeStartRound: 5,
  // Selection floors / gates.
  perTargetFloor: 0.5, // §3.7.1 step 10 — no collapsed targets
  hompPassRatio: 0.7, // §3.5 / §3.5.2 — ≥0.7× final_score
  oodMaximinGate: 0.55, // §3.5.1 — aggregate Maximin on both targets
  oodPerLanguageWeakSpot: 0.4, // single-language flag threshold
  // §5.7 adversarial counter-probe generalization gate (drop vs dev taskScore).
  counterProbeGeneralizeDrop: 0.15, // ≤15% drop ⇒ P6 signal generalised
  counterProbeOverfitDrop: 0.25, // >25% drop ⇒ overfit to query-shape (gate fails)
  scsShipGate: 0.8, // §3.6 — correctness-weighted SCS
  minParaphraseAccuracy: 0.6, // §3.6 — accuracy floor under paraphrase
  agentQueryMaxDrop: 0.2, // §3.6.1 — ≤20% degraded drop per target/bucket
  // Ship constraints.
  shipTokenCap: 2000, // §3.7.1 step 10 — ship variant ≤ 2000 tokens
  // GEPA loop.
  paretoFrontSize: 6,
  maxRounds: 20,
  hardCapRounds: 25,
  patienceRounds: 5,
  plateauBreakthroughDelta: 0.03, // ≥3pp step-change in last 8 rounds → extend
  plateauExtendRounds: 3,
  patienceDelta: 0.01, // Δ final_score ≤ 1pp counts as no-improvement
  mutationsPerRound: 3,
  screenProbes: 8,
  rotationRound: 11,
  rotationSwapCount: 5,
  tareParaphrases: 3, // K=3 adversarial paraphrases
});

// ─── protected-token grammar (§3.2.1) ──────────────────────────────────────

/**
 * Matches `[[ ... ]]` markers (with optional internal whitespace). The
 * token-validator normalises whitespace inside the brackets before comparing
 * multiplicity. Use the global flag with String.matchAll.
 */
export const PROTECTED_TOKEN_RE = /\[\[\s*[^[\]]+?\s*\]\]/g;

/** OP-4 masking aliases that must NOT survive into a screened candidate. */
export const OP4_ALIASES = Object.freeze(['TOOL_ALPHA', 'TOOL_BETA', 'TOOL_GAMMA', 'TOOL_DELTA']);

/** The verbatim-preserved tool tokens (§3.2.1). */
export const TOOL_TOKENS = Object.freeze(['ss-search', 'ss-find', 'ss-semantic', 'ss-trace', 'ss-grep', 'ss-read']);

// ─── event kinds + reasons (§7.4) ──────────────────────────────────────────

export const EVENT_KINDS = Object.freeze({
  MUTATION: 'mutation',
  MUTATION_REJECTION: 'mutation-rejection',
  SEED: 'seed',                    // per-(probe,target) row for round-0 seed ablation (B1-replayable)
  SCREEN: 'screen',
  CONFIRM: 'confirm',
  TARE_ADVERSARIAL: 'tare-adversarial',
  PARETO_UPDATE: 'pareto-update',
  PARETO_REJECTION: 'pareto-rejection',
  PARETO_REBASELINE: 'pareto-rebaseline',
  MANUAL_REFLECTION: 'manual-reflection',
  RATE_LIMIT_THROTTLED: 'rate-limit-throttled',
});

export const MUTATION_REJECTION_REASONS = Object.freeze([
  'whitespace-norm', // reserved: whitespace is silently normalized, never emitted as a rejection (m6)
  'missing-token',
  'multiplicity-changed',
  'unmapped-alias',
  'surplus-token',
  'fenced-block-altered', // OP-5 pruner: fenced/pseudocode block not byte-identical (M11)
  // OP-3 mode-b: router-table consolidation produced an output that does NOT
  // contain a table whose header matches the OP-5 protection regex (must
  // include both "Query signal" and "First call"). Without canonical headers
  // the table would not be extracted as a protected block, and any subsequent
  // OP-5 pruner pass would silently delete the dispatch rows as "extra prose".
  'router-table-header-missing',
]);

export const PARETO_REJECTION_REASONS = Object.freeze([
  '0.15-cap-violation',
  'dominated',
  'language-transfer-gate',
  'scs-gate',
  'agent-query-gate',
]);

export const SOURCE_OPS = Object.freeze([
  'reflective', // OP-1
  'trajectory-crossover', // OP-2
  'persona-pivot', // OP-3
  'tool-mask', // OP-4
  'pruner', // OP-5
  'seed', // hand-authored T_i
  'manual', // human hand-crafted mutation
]);

// ─── probe schema (§5.1) ───────────────────────────────────────────────────

export const ProbeSchema = z.object({
  id: z.string().min(1),
  repo: z.string().min(1),
  language: z.string().min(1),
  stratum: z.enum(['literal-lookup', 'multi-file-flow', 'behavioral', 'no-match']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  query: z.string().min(1),
  expectedFiles: z.array(z.string()),
  expectedSymbols: z.array(z.string()),
  expectedFacts: z.array(z.string()),
  expectedNoMatch: z.boolean(),
  max_turns: z.number().int().positive(),
  // Optional fields used by EAS / rotation / pathology tagging.
  expected_call_window: z.tuple([z.number(), z.number()]).optional(),
  tier: z.string().optional(), // e.g. 'deferred-pathology'
  pathology: z.string().optional(), // 'wrong-extension' | 'flooding' | 'rabbit-hole'
  distractor: z.boolean().optional(),
  smoke: z.boolean().optional(), // dry-run fixtures, NOT prereg probes
  author: z.string().optional(),
  date: z.string().optional(),
  notes: z.string().optional(),
});

/** Validate + parse a probe; throws a readable error on failure. */
export function parseProbe(obj) {
  return ProbeSchema.parse(obj);
}

/** Validate an array of probes, returning { ok, errors:[{index,message}] }. */
export function validateProbes(arr) {
  if (!Array.isArray(arr)) return { ok: false, errors: [{ index: -1, message: 'probes must be an array' }] };
  const errors = [];
  const seen = new Set();
  arr.forEach((p, i) => {
    const r = ProbeSchema.safeParse(p);
    if (!r.success) errors.push({ index: i, message: r.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
    else if (seen.has(p.id)) errors.push({ index: i, message: `duplicate probe id "${p.id}"` });
    else seen.add(p.id);
  });
  return { ok: errors.length === 0, errors };
}

// ─── hashing ───────────────────────────────────────────────────────────────

/**
 * Stable content hash for prompts / probes. `0x` + first 16 hex of sha256.
 * Deterministic across machines and Node versions (no native dep).
 */
export function hashContent(text) {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  return '0x' + createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

/** Back-compat alias used by some call sites. */
export const hashPrompt = hashContent;

// ─── small scoring primitives shared by eas.mjs + gepa.mjs ─────────────────

/** Per-probe Maximin = the worse of the two targets (§3.7.1 step 2). */
export function maximinPerProbe(scoreSonnet, scoreGpt) {
  return Math.min(scoreSonnet, scoreGpt);
}

/** Clamp helper. */
export function clip(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// ─── typedefs (documentation only) ─────────────────────────────────────────

/**
 * @typedef {object} ProbeRecord  (see ProbeSchema)
 *
 * @typedef {object} EvalResult  one (variant, probe, target) agent run
 * @property {string}  variantHash
 * @property {string}  probeId
 * @property {('sonnet'|'gpt5_5')} target
 * @property {number}  score              — judge-panel correctness in [0,1]
 * @property {number}  toolCalls
 * @property {boolean} finalAnswerEmitted
 * @property {boolean} usedReadOrGrep     — any retrieval/read evidence (ss OR native)?
 * @property {boolean} usedSweetSearch    — used an ss-* tool?
 * @property {boolean} usedNativeSearch   — used native grep/rg (contamination)?
 * @property {boolean} usedNativeRead     — used native Read/cat (telemetry)?
 * @property {number}  wallMs
 *
 * @typedef {object} VariantMeta  parsed YAML front-matter of a T_i file
 * @property {string} id
 * @property {('tool-routing-first'|'query-shape-first'|'evidence-first'|'hybrid'|'control')} strategy
 * @property {('terse'|'medium'|'verbose')} verbosity
 * @property {('full'|'partial'|'none')} p6_grounding
 * @property {string[]} special_handling
 * @property {number} target_tokens
 */

export const _meta = Object.freeze({
  version: 'p7-shared/1',
  canonicalTargets: TARGET_LIST,
});
