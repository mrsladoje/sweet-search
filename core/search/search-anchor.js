/**
 * Identifier-Anchored Retrieval (IAR).
 *
 * Aider / Cursor / Cody / Greptile all couple dense retrieval with an
 * exact-name symbol lookup so abstract natural-language queries that
 * happen to mention a real entity name can land on that entity even
 * when the encoder ranks something tangentially-similar higher.
 *
 * This module:
 *   1. Extracts identifier-shaped tokens from the query (PascalCase,
 *      camelCase, snake_case, kCamel, ≥3 chars, not stopwords/keywords).
 *   2. Looks them up case-insensitively against the entities graph
 *      (any kind: function, method, struct, type, class, etc.).
 *   3. Maps each matched entity to the cAST/LI chunk that covers it.
 *   4. Injects those chunks into the candidate set with a baseline
 *      lexical-anchor score, deduped against existing fused results.
 *
 * The downstream pipeline (entity-kind preference, name precision,
 * doc/test demotion, MMR) then ranks the augmented candidate set
 * using its existing rules. IAR is purely additive — it can only
 * surface entities that genuinely exist in the index.
 *
 * Disable via `ablations: new Set(['no-anchor-injection'])`.
 */

import { extractNameHints } from '../ranking/file-kind-ranking.js';

/**
 * Extract IDENTIFIER-shaped anchor names from a query.
 *
 * Strictly tighter than `extractNameHints` (which is permissive enough
 * for ranking tiebreakers — it treats any 3+ char non-keyword as a
 * hint). For IAR we need to AVOID firing on plain English words like
 * "request", "config", "default" that happen to share lowercase
 * spelling with real entities, because that drags those entities
 * ahead of the user's actual target.
 *
 * Required shape — at least one of:
 *   - has an uppercase letter (PascalCase, camelCase, kPrefix style)
 *   - contains an underscore (snake_case_func, ALL_CAPS_CONST)
 *
 * That matches how programmers actually NAME entities. A query token
 * like "FastifyInstance", "kSchemaParams", "BindBody", "calculate_path"
 * fires; "request", "lifecycle", "config", "default" doesn't. The
 * downstream lookup is case-insensitive, so this filter doesn't lose
 * anything except the ambiguous English-word path.
 *
 * Token length floor stays at 3 to drop noise like "is", "to", "by".
 */
export function extractStrictAnchorNames(query, opts = {}) {
  const tokens = String(query || '').match(/[A-Za-z_][A-Za-z0-9_]+/g) || [];
  const hints = new Set();
  const allowPlainTitlecase = opts.allowPlainTitlecase === true;
  for (const token of tokens) {
    if (token.length < 3) continue;
    // Require strong identifier shape: internal uppercase, acronym,
    // underscore, or digit. Plain sentence Titlecase ("Downloads") is too
    // ambiguous for injection; ranking tiebreakers can still use it later.
    if (!isStrongIdentifierToken(token) && !(allowPlainTitlecase && isPlainTitlecase(token))) continue;
    hints.add(token);
  }
  return hints;
}

const DEFAULT_PER_QUERY_ENTITY_LIMIT = 16;
const ANCHOR_BASELINE_SCORE = 0.50;        // floor for an injected chunk
const ANCHOR_PER_HINT_BONUS = 0.10;        // per matched anchor name
const ANCHOR_MAX_SCORE = 0.85;             // ceiling — never beat a strong fused top-1
const EXISTING_BOOST = 0.05;               // additive boost when the chunk is already fused

/**
 * Uniqueness ceiling for anchor names: hints whose lowercase form matches
 * MORE entities than this threshold are dropped before injection. KPR/SPAR
 * pattern (arXiv 2507.03922, 2110.06918): entity-aware injection helps in
 * proportion to rarity.
 *
 * **Default: 0 (gate DISABLED).** On the current 60-probe dev/held-out split
 * (40/20, seed=42, stratified by repo) the gate at ceil=8 transfers
 * asymmetrically — dev gains 2 PASS / loses 0, held-out gains 0 PASS / loses
 * 1 (S3-Q3 fastify). One probe (S3-Q3) had a brittle pre-fix PASS that
 * relied on IAR flooding + MMR diversity penalty rather than dense-ranking
 * signal. The principle is sound but the eval set is too small (60 queries)
 * to ship a non-zero default per the BEIR-grade methodology in CLAUDE.md
 * §Benchmark Methodology — held-out regressions are non-negotiable.
 *
 * Opt in via `SWEET_SEARCH_IAR_UNIQUENESS_CEIL=N`. Aligned with the existing
 * ref-count homonym ceiling (file-kind-ranking.js, env
 * SWEET_SEARCH_REF_BOOST_QUERY_HOMONYM_DISABLE, default 12); experiments
 * suggest 8 for IAR. Set higher for less aggressive gating, 0 to disable.
 */
// Default 0 = gate disabled. Held-out 60-probe eval (2026-05-07) showed no
// ceil value transfers: corpus stats lock dev/held-out probes together (the
// same hint Fastify=46 that helps dev S3-Q7+S4-Q2 hurts held-out S3-Q3).
// Re-evaluate when a >200-query post-cutoff (FreshStack-style) eval lands.
const DEFAULT_UNIQUENESS_CEIL = 0;

function readUniquenessCeil(opts) {
  if (opts && Number.isFinite(opts.uniquenessCeil)) {
    return opts.uniquenessCeil;
  }
  const raw = process.env.SWEET_SEARCH_IAR_UNIQUENESS_CEIL;
  if (raw == null || raw === '') return DEFAULT_UNIQUENESS_CEIL;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_UNIQUENESS_CEIL;
  return n; // 0 means "no gate"
}

/**
 * Find the LI chunk that covers a given (filePath, startLine, endLine)
 * region. Linear scan over the LI document Map — typical projects have
 * a few hundred to a few thousand chunks; this runs in microseconds.
 *
 * Prefers the SMALLEST containing chunk when several overlap (canonical
 * symbol-aligned chunk vs an enclosing parent chunk).
 *
 * @param {object} liIndex - LateInteractionIndex instance with .documents Map
 * @param {{ filePath: string, startLine: number, endLine: number }} entity
 * @returns {{ id: string, metadata: object, content?: string, text?: string }|null}
 */
function findChunkForEntity(liIndex, entity) {
  if (!liIndex || !entity) return null;
  let best = null;
  let bestSize = Infinity;
  for (const [id, doc] of liIndex.documents) {
    const m = doc?.metadata;
    if (!m || m.file !== entity.filePath) continue;
    const cs = m.startLine, ce = m.endLine;
    if (cs == null || ce == null) continue;
    if (cs <= entity.startLine && ce >= entity.endLine) {
      const size = ce - cs;
      if (size < bestSize) {
        best = { id, ...doc };
        bestSize = size;
      }
    }
  }
  return best;
}

function chunkKey(r) {
  const m = r.metadata || {};
  const file = m.file || r.file;
  const sl = m.startLine ?? r.startLine;
  const el = m.endLine ?? r.endLine;
  return `${file}|${sl}|${el}`;
}

function scoreForAnchor(entity, hintsLower) {
  const nameLc = String(entity.name || '').toLowerCase();
  let matched = 0;
  for (const h of hintsLower) {
    if (nameLc === h || nameLc.includes(h) || h.includes(nameLc)) matched++;
  }
  return Math.min(ANCHOR_MAX_SCORE, ANCHOR_BASELINE_SCORE + ANCHOR_PER_HINT_BONUS * matched);
}

function isPlainTitlecase(token) {
  return /^[A-Z][a-z0-9]+$/.test(token);
}

function isStrongIdentifierToken(token) {
  return token.includes('_') || /[a-z][A-Z]/.test(token) || /[A-Z].*[A-Z]/.test(token) || /\d/.test(token);
}

function entityMatchesAnchorHint(entity, hints) {
  const name = String(entity?.name || '');
  if (!name) return false;
  const nameLower = name.toLowerCase();

  for (const hint of hints) {
    if (isStrongIdentifierToken(hint)) {
      const hintLower = hint.toLowerCase();
      if (nameLower === hintLower || nameLower.includes(hintLower) || hintLower.includes(nameLower)) {
        return true;
      }
      continue;
    }

    if (isPlainTitlecase(hint)) {
      if (name === hint || name.includes(hint) || hint.includes(name)) return true;
      continue;
    }

    const hintLower = hint.toLowerCase();
    if (nameLower === hintLower || nameLower.includes(hintLower) || hintLower.includes(nameLower)) {
      return true;
    }
  }

  return false;
}

/**
 * Inject anchor candidates into a fused result list.
 *
 * @param {Array} fused - Result list after CC/RRF fusion (mutates a copy)
 * @param {string} query - The user's query
 * @param {object} opts
 * @param {object} opts.codeGraphRepo - CodeGraphRepository
 * @param {object} opts.lateInteractionIndex - LateInteractionIndex
 * @param {Set<string>} [opts.ablations]
 * @param {number} [opts.entityLimit]
 * @returns {{ results: Array, stats: { hintCount: number, entitiesFound: number,
 *             newCandidates: number, existingBoosted: number } }}
 */
export function injectAnchorCandidates(fused, query, opts = {}) {
  const ablations = opts.ablations;
  if (ablations && (ablations instanceof Set ? ablations.has('no-anchor-injection') : Array.isArray(ablations) && ablations.includes('no-anchor-injection'))) {
    return { results: fused, stats: { hintCount: 0, entitiesFound: 0, newCandidates: 0, existingBoosted: 0 } };
  }

  const repo = opts.codeGraphRepo;
  const liIndex = opts.lateInteractionIndex;
  if (!repo || !liIndex || typeof repo.findEntitiesByAnyName !== 'function') {
    return { results: fused, stats: { hintCount: 0, entitiesFound: 0, newCandidates: 0, existingBoosted: 0 } };
  }

  const allHints = [...extractStrictAnchorNames(query || '', {
    allowPlainTitlecase: opts.allowPlainTitlecase !== false,
  })];
  if (allHints.length === 0) {
    return { results: fused, stats: { hintCount: 0, entitiesFound: 0, newCandidates: 0, existingBoosted: 0 } };
  }

  // Uniqueness gate: drop any hint whose lowercase form matches more
  // entities than the ceiling. IDF-gated injection pattern (KPR arXiv
  // 2507.03922, SPAR arXiv 2110.06918, "Match Your Words" arXiv 2112.05662).
  // Rare identifiers benefit from anchor injection; common identifiers
  // ("Get", "Fastify", "Set") flood the candidate set with mostly-irrelevant
  // entities — even the canonical pick is unreliable when 50 entities share
  // the bare name. Cleaner to skip the hint entirely than to inject a
  // possibly-wrong "canonical" entity. Mirrors the existing ref-count homonym
  // gate (file-kind-ranking.js, env SWEET_SEARCH_REF_BOOST_QUERY_HOMONYM_DISABLE,
  // default 12). IAR uses a tighter default (8) because anchor injection is
  // more sensitive to homonym noise than ref-count rescaling.
  //
  // Override env: SWEET_SEARCH_IAR_UNIQUENESS_CEIL=N. Set to 0 to disable.
  const ceil = readUniquenessCeil(opts);
  let hints = allHints;
  let droppedCommon = [];
  if (ceil > 0 && typeof repo.countEntitiesByAnyName === 'function') {
    let countMap = null;
    try {
      countMap = repo.countEntitiesByAnyName(allHints);
    } catch {
      countMap = null;
    }
    if (countMap) {
      const kept = [];
      for (const h of allHints) {
        const c = countMap.get(h.toLowerCase()) || 0;
        if (c === 0 || c <= ceil) {
          kept.push(h);
        } else {
          droppedCommon.push({ hint: h, count: c });
        }
      }
      hints = kept;
    }
  }
  if (hints.length === 0) {
    return {
      results: fused,
      stats: {
        hintCount: allHints.length,
        entitiesFound: 0,
        newCandidates: 0,
        existingBoosted: 0,
        droppedCommon,
        uniquenessCeil: ceil,
      },
    };
  }
  const hintsLower = hints.map(s => s.toLowerCase());

  let entities = [];
  try {
    entities = repo.findEntitiesByAnyName(hints, {
      limit: opts.entityLimit ?? DEFAULT_PER_QUERY_ENTITY_LIMIT,
    }) || [];
  } catch {
    return {
      results: fused,
      stats: {
        hintCount: allHints.length,
        entitiesFound: 0,
        newCandidates: 0,
        existingBoosted: 0,
        droppedCommon,
        uniquenessCeil: ceil,
      },
    };
  }
  if (entities.length === 0) {
    return {
      results: fused,
      stats: {
        hintCount: allHints.length,
        entitiesFound: 0,
        newCandidates: 0,
        existingBoosted: 0,
        droppedCommon,
        uniquenessCeil: ceil,
      },
    };
  }

  // Index existing fused results by chunk key for dedup and existing-boost.
  const fusedByKey = new Map();
  for (const r of fused) fusedByKey.set(chunkKey(r), r);

  let newCandidates = 0;
  let existingBoosted = 0;
  const out = fused.slice();    // copy — we'll append injections
  const seenInjected = new Set();

  for (const entity of entities) {
    if (!entityMatchesAnchorHint(entity, hints)) continue;
    const chunk = findChunkForEntity(liIndex, entity);
    if (!chunk) continue;
    const key = chunkKey({ metadata: chunk.metadata });
    if (seenInjected.has(key)) continue;
    seenInjected.add(key);

    const anchorScore = scoreForAnchor(entity, hintsLower);

    const existing = fusedByKey.get(key);
    if (existing) {
      // Already in the fused set — give it a small additive boost so a
      // legitimately-relevant entity that the encoder ranked mid-pack can
      // climb. Don't overwrite a strong dense score.
      existing.score = (existing.score || 0) + EXISTING_BOOST;
      existing._anchorBoosted = true;
      existing._anchorEntity = entity.name;
      existingBoosted++;
      continue;
    }

    // Inject as a fresh candidate. Carry the LI chunk's metadata so the
    // downstream packager has the correct file/range/type.
    out.push({
      id: chunk.id,
      file: chunk.metadata?.file,
      startLine: chunk.metadata?.startLine,
      endLine: chunk.metadata?.endLine,
      name: chunk.metadata?.name || entity.name,
      type: chunk.metadata?.type || entity.type,
      content: chunk.content || chunk.text || '',
      metadata: { ...(chunk.metadata || {}) },
      score: anchorScore,
      searchPath: 'anchor',
      _anchorInjected: true,
      _anchorEntity: entity.name,
      _anchorEntityType: entity.type,
    });
    newCandidates++;
  }

  // Re-sort by score so the augmented list is consistent for downstream
  // top-k truncation.
  out.sort((a, b) => (b.score || 0) - (a.score || 0));

  return {
    results: out,
    stats: {
      hintCount: allHints.length,
      hintsKept: hints.length,
      entitiesFound: entities.length,
      newCandidates,
      existingBoosted,
      droppedCommon,
      uniquenessCeil: ceil,
    },
  };
}
