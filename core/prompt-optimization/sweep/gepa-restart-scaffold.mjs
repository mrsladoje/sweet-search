/**
 * Phase 7 - restart-seed scaffold.
 *
 * Builds a new T_i slate from the current Pareto front after normalising away
 * outer markdown fences, then appends three hand seeds that target the observed
 * round-10 efficiency failures. This module only writes files when invoked with
 * `--write`; importing it or running without `--write` is a dry planning step.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashContent } from './p7-shared.mjs';
import { paretoCurrentPath, loadParetoCurrent } from './p7-persist.mjs';
import { estimateTokens } from './variant-loader.mjs';
import { stripOuterFence } from './token-validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
export const DEFAULT_RESTART_DIR = path.join(
  REPO_ROOT,
  'core',
  'prompt-optimization',
  'data',
  'p7-variant-restarts',
  'p7-gen1b-normalized',
);

export const RESTART_EXTRA_SEEDS = Object.freeze([
  {
    label: 'router-minimal',
    strategy: 'tool-routing-first',
    verbosity: 'terse',
    special_handling: ['multi-file-flow', 'no-match'],
    expected_strengths: ['cheap-first-call-routing', 'exact-anchor-discipline'],
    expected_weaknesses: ['less-family-conditioning'],
    body: `# Sweet-search code-search guide

Prefer indexed sweet-search tools over raw grep/ripgrep and blind reads. Use raw grep/read only for unindexed edits or after indexed tools fail.

## Tool router

| Query signal | First call | Follow-up | Stop condition |
|---|---|---|---|
| Exact string, config key, error text, path, or rare identifier | [[ss-grep]] with the rarest escaped regex | [[ss-read]] only if the hit line needs context | One decisive hit is enough |
| Known symbol/class/method | [[ss-find]] with a word-bounded regex | [[ss-trace]] if callers/callees matter | Stop after file and symbol are clear |
| Unknown behavior in prose | [[ss-search]] with compact domain terms | [[ss-semantic]] once a file is known | Stop after the relevant span answers |
| Multi-file flow | Anchor with [[ss-find]] or [[ss-search]] | [[ss-trace]] on the exact symbol before manual file chaining | Stop after one complete path |
| Possible absence | [[ss-grep]] / [[ss-find]] on the strongest anchor | One broader [[ss-grep]] | Report [[no-match]] after both are empty |

Do not make [[ss-search]] the default when an exact anchor exists. Do not repeat near-identical searches. Name the file(s), symbol(s), and evidence.`,
  },
  {
    label: 'no-match-fast',
    strategy: 'evidence-first',
    verbosity: 'terse',
    special_handling: ['no-match'],
    expected_strengths: ['negative-query-termination', 'low-call-absence-proof'],
    expected_weaknesses: ['may-underexplore-ambiguous-flow'],
    body: `# Sweet-search absence-focused guide

Use indexed tools first. [[ss-grep]] is the cheapest exact negative check; [[ss-find]] is for a known identifier; [[ss-search]] is for unknown prose; [[ss-trace]] follows a known symbol; [[ss-semantic]] narrows inside a known file; [[ss-read]] confirms a specific range.

For exact literals or identifiers, start with [[ss-grep]] or [[ss-find]], not [[ss-search]]. For absence questions, spend at most one exact anchor attempt and one broader lexical attempt. If both are empty and no candidate file appears, answer [[no-match]] with the anchors checked.

For positive matches, stop as soon as the returned block gives the file and symbol. Use [[ss-read]] only when the returned evidence lacks the decisive line. For multi-file questions, after the first anchor use [[ss-trace]] before searching neighbor files manually.

Output the file(s), symbol(s), and the evidence; for absence, report the checked anchors and [[no-match]].`,
  },
  {
    label: 'trace-first-flow',
    strategy: 'hybrid',
    verbosity: 'medium',
    special_handling: ['multi-file-flow', 'behavioral'],
    expected_strengths: ['fewer-manual-read-loops', 'flow-after-anchor'],
    expected_weaknesses: ['depends-on-symbol-quality'],
    body: `# Sweet-search flow guide

Use the narrowest indexed tool that can answer.

1. Exact anchor: call [[ss-grep]] for literals, error text, config keys, paths, or rare identifiers.
2. Known symbol: call [[ss-find]] with a word-bounded regex.
3. Unknown prose: call [[ss-search]] with compact domain terms until a file or symbol appears.
4. Once a symbol is known and the question asks "how does this flow/call/dispatch/reach", call [[ss-trace]] before reading adjacent files.
5. Once a file is known but the span is not, call [[ss-semantic]] on that file.
6. Use [[ss-read]] only to confirm a precise returned range.

Stop on sufficient evidence: one literal hit, one definition block, or one complete traced path is enough. Do not corroborate every neighbor file. If searches are empty, change tool family once; after exact and broad lexical absence, answer [[no-match]].`,
  },
]);

export function normalizeParetoPrompt(prompt) {
  if (typeof prompt !== 'string') throw new TypeError('normalizeParetoPrompt: prompt must be a string');
  return stripOuterFence(prompt).trim();
}

/**
 * The "OP-5 Pruner on joint-best" path is the cheapest high-EV move on a
 * mature front: pruning the joint-best prompt typically shaves ~5–10% of its
 * token count, dropping the length penalty and the Sonnet cache-creation
 * footprint without any behavioural change. We DO NOT run OP-5 here — that
 * would be a live model call. Instead this builds a deterministic placeholder
 * seed whose body is the joint-best prompt with the outer markdown fence
 * stripped and trailing whitespace per line trimmed. The actual pruning is
 * left for either:
 *   (a) a single screen-only OP-5 invocation against the joint-best prompt
 *       (run separately as a smoke test before gen-1b starts), or
 *   (b) a hand-edit in the variant file at gen-1b authoring time.
 *
 * The placeholder is clearly labelled via frontMatter.source_id so it can be
 * identified in the slate and replaced before launch if desired.
 */
export function pickJointBest(pareto) {
  const front = Array.isArray(pareto?.front) ? pareto.front : [];
  if (front.length === 0) return null;
  return front.reduce((best, m) => {
    if (!best) return m;
    const a = typeof m.finalScore === 'number' ? m.finalScore : -Infinity;
    const b = typeof best.finalScore === 'number' ? best.finalScore : -Infinity;
    return a > b ? m : best;
  }, null);
}

/**
 * Conservative deterministic local prune. Does NOT touch any [[token]] —
 * only collapses runs of 3+ blank lines to 2 and right-trims each line.
 * Preserves every code fence, [[token]] multiplicity, and conditional rule
 * verbatim. Safe to run without OP-5 model validation.
 */
export function conservativeLocalPrune(text) {
  if (typeof text !== 'string') throw new TypeError('conservativeLocalPrune: string required');
  return text
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Trailing marker appended to the pruner-placeholder body. Ensures the
 * placeholder ALWAYS hashes differently from its parent joint-best, even
 * when conservativeLocalPrune is a no-op on an already-clean prompt
 * (defect D2, observed during Stage 1 — T3 and T8 both normalized to
 * hash 0x57d1d3600aaf18a8, so gepa-pareto.attemptParetoAdmission's
 * hash-dedup check at gepa-pareto.mjs:64 would silently evict T8).
 * The marker is an HTML-style comment so it is inert in any markdown-
 * aware consumer and stays distinct from prose / tokens.
 */
export const PRUNER_PLACEHOLDER_MARKER = '\n\n<!-- gen-1b pruner-placeholder: derived from joint-best, awaits live OP-5 -->';

export function buildPrunerPlaceholderVariant(pareto, idx) {
  const jb = pickJointBest(pareto);
  if (!jb || typeof jb.prompt !== 'string' || jb.prompt.length === 0) return null;
  const normalized = normalizeParetoPrompt(jb.prompt);
  // conservativeLocalPrune may be a no-op on a clean prompt → marker
  // guarantees the body always differs from the parent (D2 fix).
  const body = conservativeLocalPrune(normalized) + PRUNER_PLACEHOLDER_MARKER;
  return {
    id: `T${idx}`,
    body,
    frontMatter: {
      id: `T${idx}`,
      strategy: 'hybrid',
      verbosity: verbosityForTokens(estimateTokens(body)),
      p6_grounding: 'partial',
      special_handling: ['no-match', 'multi-file-flow'],
      // These tags say "placeholder, not yet measured" — admit to gen-1b's
      // front only after a round-0 measurement, never by expectation.
      expected_strengths: ['shorter-joint-best-token-count', 'lower-length-penalty', 'lower-sonnet-cache-creation-cost'],
      expected_weaknesses: ['unverified-until-round-0-ablation', 'no-live-op5-validation'],
      target_tokens: Math.max(1, estimateTokens(body)),
      source_id: 'pruner-placeholder-joint-best',
      source_hash: jb.hash ?? hashContent(body),
    },
  };
}

function verbosityForTokens(tokens) {
  if (tokens <= 550) return 'terse';
  if (tokens >= 950) return 'verbose';
  return 'medium';
}

function frontVariant(member, idx) {
  const body = normalizeParetoPrompt(member.prompt ?? member.body ?? '');
  return {
    id: `T${idx}`,
    body,
    frontMatter: {
      id: `T${idx}`,
      strategy: 'hybrid',
      verbosity: verbosityForTokens(estimateTokens(body)),
      p6_grounding: 'full',
      special_handling: ['no-match', 'multi-file-flow', 'behavioral'],
      expected_strengths: ['normalized-pareto-incumbent', member.sourceOp ?? 'front-member'],
      expected_weaknesses: ['inherited-front-failure-modes'],
      target_tokens: Math.max(1, estimateTokens(body)),
      source_hash: member.hash ?? hashContent(body),
      source_id: member.id ?? `front-${idx}`,
    },
  };
}

function seedVariant(seed, idx) {
  const body = seed.body.trim();
  return {
    id: `T${idx}`,
    body,
    frontMatter: {
      id: `T${idx}`,
      strategy: seed.strategy,
      verbosity: seed.verbosity,
      p6_grounding: 'partial',
      special_handling: seed.special_handling,
      expected_strengths: seed.expected_strengths,
      expected_weaknesses: seed.expected_weaknesses,
      target_tokens: Math.max(1, estimateTokens(body)),
      source_id: seed.label,
      source_hash: hashContent(body),
    },
  };
}

export function buildRestartVariants({
  pareto,
  includeFront = true,
  includeExtraSeeds = true,
  includePrunerPlaceholder = true,
  extraSeeds = RESTART_EXTRA_SEEDS,
} = {}) {
  const front = Array.isArray(pareto?.front) ? pareto.front : [];
  const out = [];
  if (includeFront) {
    for (const member of front) out.push(frontVariant(member, out.length + 1));
  }
  if (includeExtraSeeds) {
    for (const seed of extraSeeds) out.push(seedVariant(seed, out.length + 1));
  }
  if (includePrunerPlaceholder) {
    const placeholder = buildPrunerPlaceholderVariant(pareto, out.length + 1);
    if (placeholder) out.push(placeholder);
  }
  return out;
}

function yamlArray(values) {
  return `[${(values || []).join(', ')}]`;
}

export function renderVariantMd(variant) {
  const fm = variant.frontMatter;
  return [
    '---',
    `id: ${fm.id}`,
    `strategy: ${fm.strategy}`,
    `verbosity: ${fm.verbosity}`,
    `p6_grounding: ${fm.p6_grounding}`,
    `special_handling: ${yamlArray(fm.special_handling)}`,
    `expected_strengths: ${yamlArray(fm.expected_strengths)}`,
    `expected_weaknesses: ${yamlArray(fm.expected_weaknesses)}`,
    `target_tokens: ${fm.target_tokens}`,
    `source_id: ${fm.source_id}`,
    `source_hash: ${fm.source_hash}`,
    '---',
    variant.body,
    '',
  ].join('\n');
}

function assertRepoDescendant(resolved) {
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`refusing to write outside repo: ${resolved}`);
  }
}

export function writeRestartVariants({ variants, outDir = DEFAULT_RESTART_DIR, force = false }) {
  const resolved = path.resolve(outDir);
  assertRepoDescendant(resolved);
  fs.mkdirSync(resolved, { recursive: true });
  const written = [];
  for (const variant of variants) {
    const file = path.join(resolved, `${variant.id}.md`);
    if (!force && fs.existsSync(file)) throw new Error(`refusing to overwrite ${file}; pass --force`);
    fs.writeFileSync(file, renderVariantMd(variant), 'utf8');
    written.push(file);
  }
  return written;
}

function parseArgs(argv) {
  const out = {
    fromRun: 'p7-gen1-20260526-v3',
    outDir: DEFAULT_RESTART_DIR,
    write: false,
    force: false,
    includeFront: true,
    includeExtraSeeds: true,
    includePrunerPlaceholder: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from-run') out.fromRun = argv[++i];
    else if (a === '--from-pareto') out.fromPareto = argv[++i];
    else if (a === '--out-dir') out.outDir = argv[++i];
    else if (a === '--write') out.write = true;
    else if (a === '--force') out.force = true;
    else if (a === '--front-only') out.includeExtraSeeds = false;
    else if (a === '--seeds-only') out.includeFront = false;
    else if (a === '--no-pruner-placeholder') out.includePrunerPlaceholder = false;
  }
  return out;
}

export function loadParetoForRestart({ fromRun, fromPareto } = {}) {
  const file = fromPareto ? path.resolve(fromPareto) : paretoCurrentPath(fromRun);
  const pareto = loadParetoCurrent(file);
  if (!pareto) throw new Error(`could not load pareto-current from ${file}`);
  return { pareto, file };
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts.includeFront && !opts.includeExtraSeeds) {
    throw new Error('choose at least one of front variants or extra seeds');
  }
  const { pareto, file } = loadParetoForRestart(opts);
  // pareto-current.json is the authoritative source for front-member scores.
  // gepa-trajectory.jsonl may still contain stale per-event final_score values
  // from pre-repair confirm events (see PHASE7.md §gen-1b — stale-trajectory
  // note). The scaffold MUST NEVER derive front scores from the trajectory
  // when pareto-current is available.
  const variants = buildRestartVariants({
    pareto,
    includeFront: opts.includeFront,
    includeExtraSeeds: opts.includeExtraSeeds,
    includePrunerPlaceholder: opts.includePrunerPlaceholder,
  });
  const summary = variants.map((v) => ({
    id: v.id,
    source: v.frontMatter.source_id,
    tokens: v.frontMatter.target_tokens,
    hash: hashContent(v.body),
  }));
  if (opts.write) {
    const written = writeRestartVariants({ variants, outDir: opts.outDir, force: opts.force });
    console.log(JSON.stringify({ from: file, outDir: path.resolve(opts.outDir), written, summary }, null, 2));
  } else {
    console.log(JSON.stringify({ from: file, outDir: path.resolve(opts.outDir), dryRun: true, summary }, null, 2));
  }
  return { variants, source: file };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e?.stack || e?.message || e);
    process.exit(1);
  });
}
