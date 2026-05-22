/**
 * Agent-mediated query robustness — §3.6.1 (re-scoped).
 *
 * Generates degraded/varied query variants of the 40 dev probes and
 * computes Maximin drop to gate against prompt brittleness in the
 * actual production distribution.
 *
 * Bucket assignments (deterministic by probe index):
 *   A — probes 0–27  (28): agent-delegation paraphrase, generator rotation
 *   B — probes 28–33  (6): cross-model query-shape emission × 4 families
 *   C — probes 34–36  (3): deterministic CLI templates
 *   D — probes 37–39  (3): "tired developer" telegraphic style
 *
 * Pure deterministic template functions have no external deps; LLM-backed
 * bucket-A/B generation uses an injected `callModel` for testability.
 *
 * Plan reference: docs/PHASE7.md §3.6.1.
 */

import { DEFAULTS } from './p7-shared.mjs';

// ─── bucket assignment ────────────────────────────────────────────────────

const BUCKET_A_END = 28;
const BUCKET_B_END = 34;
const BUCKET_C_END = 37;
const BUCKET_D_END = 40;

/**
 * Assign 40 dev probes into buckets A/B/C/D by index (deterministic).
 *
 * @param {object} args
 * @param {object[]} args.devProbes — exactly 40 probe records
 * @returns {{ A: object[], B: object[], C: object[], D: object[] }}
 */
export function buildBuckets({ devProbes }) {
  if (!Array.isArray(devProbes)) {
    throw new TypeError('buildBuckets: devProbes must be an array');
  }
  if (devProbes.length !== 40) {
    throw new RangeError(
      `buildBuckets: expected exactly 40 dev probes, got ${devProbes.length}`,
    );
  }
  return {
    A: devProbes.slice(0, BUCKET_A_END),         // 28 probes
    B: devProbes.slice(BUCKET_A_END, BUCKET_B_END), // 6 probes
    C: devProbes.slice(BUCKET_B_END, BUCKET_C_END), // 3 probes
    D: devProbes.slice(BUCKET_C_END, BUCKET_D_END), // 3 probes
  };
}

// ─── deterministic template functions ────────────────────────────────────

/**
 * Drop common English articles (a, an, the) from a query string.
 * Preserves case and collapses extra whitespace.
 *
 * @param {string} q
 * @returns {string}
 */
export function dropArticles(q) {
  return q.replace(/\b(a|an|the)\b\s*/gi, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Abbreviate common package/namespace prefixes (e.g. "node:" → "", dotted
 * identifiers → last segment). Simulates CLI muscle-memory shortcuts.
 *
 * Only DOTTED-IDENTIFIER contexts are abbreviated (`fastify.register` →
 * `register`); tokens containing a slash are file paths and are left intact
 * (`src/route.ts` stays `src/route.ts`, not `src/ts`). We strip the dotted
 * prefix per whitespace-delimited token so a `/` anywhere in the token vetoes
 * the rewrite.
 *
 * @param {string} q
 * @returns {string}
 */
export function abbreviatePackages(q) {
  return q
    .replace(/\bnode:/g, '') // node:fs → fs
    .split(/(\s+)/) // keep separators so whitespace is preserved
    .map((tok) => {
      if (tok.includes('/')) return tok; // file path — never abbreviate
      // pkg.Class / @scope/pkg already excluded above; strip leading dotted
      // segments on a slash-free token: fastify.register → register
      return tok.replace(/^(?:[A-Za-z0-9_-]+\.)+([A-Za-z0-9_-]+)$/, '$1');
    })
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Lowercase the query and change any recognised file extension to the wrong
 * extension (.ts→.js, .js→.ts, .py→.rb, .go→.rs, etc.).
 *
 * @param {string} q
 * @returns {string}
 */
export function lowercaseWrongExt(q) {
  const extMap = { ts: 'js', js: 'ts', py: 'rb', go: 'rs', rs: 'go', rb: 'py' };
  return q
    .toLowerCase()
    .replace(/\.([a-z]{1,4})\b/g, (_, ext) => '.' + (extMap[ext] || ext));
}

/**
 * Convert query to telegraphic / command-style by stripping filler words,
 * question marks, and punctuation. Simulates tired-developer direct CLI input.
 *
 * @param {string} q
 * @returns {string}
 */
export function telegraphic(q) {
  return q
    .replace(/\b(where|what|how|can|could|please|find|show|me|is|are|the|a|an|in|for|to|of)\b\s*/gi, '')
    .replace(/[?.!,;:]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── generator rotation for bucket A ─────────────────────────────────────

const BUCKET_A_GENERATORS = ['sonnet-4.6', 'opus-4.7', 'gpt-5.5-instant', 'mimo', 'qwen'];

const BUCKET_A_PROMPT_TEMPLATE = (probe) =>
  `Rewrite this as a parent coding agent delegating a search task to a search sub-agent — ` +
  `include the symbol if known, anchor file hints if known, omit conversational fluff. ` +
  `Preserve the underlying intent and gold target. Output the delegated query only.\n\n` +
  `Query: ${probe.query}\n` +
  (probe.expectedSymbols?.length ? `Symbols: ${probe.expectedSymbols.join(', ')}\n` : '') +
  (probe.expectedFiles?.length ? `Files: ${probe.expectedFiles.join(', ')}\n` : '');

// ─── cross-model emission prompt for bucket B ──────────────────────────────

const BUCKET_B_FAMILIES = ['sonnet', 'gpt-5.5', 'mimo', 'qwen'];

const BUCKET_B_PROMPT_TEMPLATE = (probe) =>
  `You are a ${'{family}'} coding assistant. A developer needs to find something in the codebase. ` +
  `Given the following task and gold target, formulate the search query you would naturally issue ` +
  `to a code-search sub-agent. Output the query only, without explanation.\n\n` +
  `Task: ${probe.query}\n` +
  (probe.expectedSymbols?.length ? `Symbols: ${probe.expectedSymbols.join(', ')}\n` : '') +
  (probe.expectedFiles?.length ? `Files: ${probe.expectedFiles.join(', ')}\n` : '');

// ─── variant generation ────────────────────────────────────────────────────

/**
 * Generate all 58 query variants across buckets A–D.
 *
 * Bucket A — LLM delegation paraphrase (generators rotated round-robin):
 *   28 probes × 1 variant each = 28
 * Bucket B — Cross-model emission (4 families per probe):
 *   6 probes × 4 families = 24
 * Bucket C — Deterministic CLI templates (1 per probe): 3
 * Bucket D — Tired-developer (1 per probe, telegraphic): 3
 *
 * Total: 58 variants.
 *
 * @param {object} args
 * @param {{ A:object[], B:object[], C:object[], D:object[] }} args.buckets
 * @param {(opts:{model:string, prompt:string}) => Promise<{text:string}>} args.callModel
 *   — injectable LLM caller; used for A/B only; C/D are fully deterministic
 * @returns {Promise<Array<{probeId:string, bucket:string, variant:string, generator?:string}>>}
 */
export async function generateVariants({ buckets, callModel }) {
  if (!buckets || typeof buckets !== 'object') {
    throw new TypeError('generateVariants: buckets must be an object from buildBuckets');
  }
  if (typeof callModel !== 'function') {
    throw new TypeError('generateVariants: callModel must be a function');
  }

  const variants = [];

  // Bucket A — agent-delegation paraphrase, rotate generators
  for (let i = 0; i < buckets.A.length; i++) {
    const probe = buckets.A[i];
    const generator = BUCKET_A_GENERATORS[i % BUCKET_A_GENERATORS.length];
    const result = await callModel({
      model: generator,
      prompt: BUCKET_A_PROMPT_TEMPLATE(probe),
    });
    variants.push({
      probeId: probe.id,
      bucket: 'A',
      variant: result?.text ?? result?.content ?? '',
      generator,
      expectedSymbols: probe.expectedSymbols,
      expectedFiles: probe.expectedFiles,
    });
  }

  // Bucket B — cross-model emission, 4 families per probe
  for (const probe of buckets.B) {
    for (const family of BUCKET_B_FAMILIES) {
      const prompt = BUCKET_B_PROMPT_TEMPLATE(probe).replace('{family}', family);
      const result = await callModel({ model: family, prompt });
      variants.push({
        probeId: probe.id,
        bucket: 'B',
        variant: result?.text ?? result?.content ?? '',
        generator: family,
        expectedSymbols: probe.expectedSymbols,
        expectedFiles: probe.expectedFiles,
      });
    }
  }

  // Bucket C — deterministic CLI templates (drop articles / abbreviate / wrong ext)
  const cTemplateFns = [dropArticles, abbreviatePackages, lowercaseWrongExt];
  for (let i = 0; i < buckets.C.length; i++) {
    const probe = buckets.C[i];
    const fn = cTemplateFns[i % cTemplateFns.length];
    variants.push({
      probeId: probe.id,
      bucket: 'C',
      variant: fn(probe.query),
      generator: 'deterministic',
      expectedSymbols: probe.expectedSymbols,
      expectedFiles: probe.expectedFiles,
    });
  }

  // Bucket D — tired-developer telegraphic
  for (const probe of buckets.D) {
    variants.push({
      probeId: probe.id,
      bucket: 'D',
      variant: telegraphic(probe.query),
      generator: 'deterministic',
      expectedSymbols: probe.expectedSymbols,
      expectedFiles: probe.expectedFiles,
    });
  }

  return variants;
}

// ─── score-drop computation ───────────────────────────────────────────────

/**
 * Compute per-target and per-bucket Maximin drop between baseline and
 * degraded-variant scores. Flags:
 *   - bucketADrop > DEFAULTS.agentQueryMaxDrop (the dominant distribution must pass alone)
 *   - bucket-B target-asymmetry: any target where one family drops >20% while
 *     another does not (cross-model shape asymmetry)
 *
 * @param {object} args
 * @param {Record<string, {sonnet:number, gpt5_5:number}>} args.baseline
 *   — probeId → per-target scores under the well-formed query
 * @param {Array<{probeId:string, bucket:string, generator?:string, scores:{sonnet:number, gpt5_5:number}}>} args.degraded
 *   — scored degraded variants (same shape as generateVariants output + scores field)
 * @returns {{
 *   perTarget: { sonnet: number, gpt5_5: number },
 *   perBucket: Record<string, { sonnet: number, gpt5_5: number }>,
 *   bucketADropFlag: boolean,
 *   bucketBAsymmetryFlag: boolean,
 *   pass: boolean,
 * }}
 */
export function computeDrops({ baseline, degraded }) {
  if (!baseline || typeof baseline !== 'object') {
    throw new TypeError('computeDrops: baseline must be a score object');
  }
  if (!Array.isArray(degraded)) {
    throw new TypeError('computeDrops: degraded must be an array');
  }

  const targets = ['sonnet', 'gpt5_5'];
  const buckets = ['A', 'B', 'C', 'D'];

  // Aggregate drops per target across all variants — one count per (item, target)
  const totalDrops = { sonnet: 0, gpt5_5: 0 };
  const totalCount = { sonnet: 0, gpt5_5: 0 };
  // Per-bucket: track sums and counts independently per target
  const bucketDrops = Object.fromEntries(
    buckets.map((b) => [b, { sonnet: 0, gpt5_5: 0, sonnetCount: 0, gpt5_5Count: 0 }]),
  );

  // Bucket B per-family per-target tracking for asymmetry check
  const bucketBFamilyDrops = {}; // family → { sonnet: [], gpt5_5: [] }

  for (const item of degraded) {
    const base = baseline[item.probeId];
    if (!base || !item.scores) continue;
    const bucket = item.bucket;

    for (const tgt of targets) {
      const baseScore = base[tgt] ?? 0;
      const degradedScore = item.scores[tgt] ?? 0;
      const drop = baseScore - degradedScore;

      totalDrops[tgt] += drop;
      totalCount[tgt]++;

      if (bucket in bucketDrops) {
        bucketDrops[bucket][tgt] += drop;
        bucketDrops[bucket][tgt + 'Count']++;
      }

      if (bucket === 'B' && item.generator) {
        if (!bucketBFamilyDrops[item.generator]) {
          bucketBFamilyDrops[item.generator] = { sonnet: [], gpt5_5: [] };
        }
        bucketBFamilyDrops[item.generator][tgt].push(drop);
      }
    }
  }

  // Normalise to mean drops per target
  const perTarget = {
    sonnet: totalCount.sonnet > 0 ? totalDrops.sonnet / totalCount.sonnet : 0,
    gpt5_5: totalCount.gpt5_5 > 0 ? totalDrops.gpt5_5 / totalCount.gpt5_5 : 0,
  };

  const perBucket = {};
  for (const b of buckets) {
    const bd = bucketDrops[b];
    perBucket[b] = {
      sonnet: bd.sonnetCount > 0 ? bd.sonnet / bd.sonnetCount : 0,
      gpt5_5: bd.gpt5_5Count > 0 ? bd.gpt5_5 / bd.gpt5_5Count : 0,
    };
  }

  // Bucket-A drop flag (dominant distribution must hold alone)
  const bucketADropFlag =
    perBucket.A.sonnet > DEFAULTS.agentQueryMaxDrop ||
    perBucket.A.gpt5_5 > DEFAULTS.agentQueryMaxDrop;

  // Bucket-B target-asymmetry: one family >20% drop on a target while another ≤20%
  let bucketBAsymmetryFlag = false;
  for (const tgt of targets) {
    const familyMeans = Object.values(bucketBFamilyDrops).map((fd) => {
      const arr = fd[tgt];
      return arr.length > 0 ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
    });
    if (familyMeans.length >= 2) {
      const maxDrop = Math.max(...familyMeans);
      const minDrop = Math.min(...familyMeans);
      if (maxDrop > DEFAULTS.agentQueryMaxDrop && minDrop <= DEFAULTS.agentQueryMaxDrop) {
        bucketBAsymmetryFlag = true;
      }
    }
  }

  const pass =
    perTarget.sonnet <= DEFAULTS.agentQueryMaxDrop &&
    perTarget.gpt5_5 <= DEFAULTS.agentQueryMaxDrop &&
    !bucketADropFlag &&
    !bucketBAsymmetryFlag;

  return { perTarget, perBucket, bucketADropFlag, bucketBAsymmetryFlag, pass };
}
