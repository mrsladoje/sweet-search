// Per-result boosts and relabels driven by symbol, identifier, path-token and name matches against the query.

import { resolveFilePath, resolveResultName } from './result-fields.js';
import { looksLikeStrictIdentifier, spellStem, splitIdentifierName } from './query-analysis.js';

// F9: additional_symbols re-anchoring for cAST sibling-merged
// chunks. JS/TS-gated. Pure ranking-time metadata fix — no chunk regeneration,
// no reindex required.
//
// Motivation: cAST sibling-merge collapses ≥2 top-level boundaries into one
// chunk and attributes the chunk to the FIRST boundary's name. Probe failures
// like TS-006 (chunk named `SlashCommand` but expected `slashCommands`) and
// TS-008 (chunk named `regularPrompt` but expected `systemPrompt`) are
// structurally PARTIAL — file is correct, symbol is the wrong sibling.
//
// The chunker already records secondary boundary names in
// `metadata.additional_symbols` (core/infrastructure/tree-sitter-provider.js). F9
// promotes the best-matching sibling to the chunk's primary label when the
// query references it more strongly than the original primary.
//
// SOTA references:
//   - Sourcegraph BM25F (2025): "treat symbols as a multi-valued field"
//   - Supermemory code-chunk: explicit scope-tree carries secondary entities
//     per chunk, not just the head boundary
//   - cAST (arXiv 2506.15655): acknowledges the sibling-merge attribution
//     gap as a known limitation
//
// Pilot scope: JS/TS/TSX/JSX only. The mechanism generalizes to every
// language but per-language gating limits the validation surface for the
// initial rollout. Promote to additional languages once probes confirm gain
// on JS/TS with zero regressions on JS/TS + GCSN.

const JSTS_LANGS = new Set(['javascript', 'typescript', 'tsx', 'jsx']);
const JSTS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

function isJsTsResult(result) {
  const meta = result?.metadata ?? {};
  if (meta.language && JSTS_LANGS.has(meta.language)) return true;
  // Expansion entities from graph-expansion.js carry no metadata.language;
  // fall back to file-extension sniff so F9 can still process them.
  const fp = result?.file_path || result?.file || meta.file || meta.path || result?.filePath || '';
  if (!fp) return false;
  const dot = fp.lastIndexOf('.');
  if (dot < 0) return false;
  return JSTS_EXTENSIONS.has(fp.slice(dot).toLowerCase());
}

/**
 * Split a camelCase/PascalCase/snake_case/kebab-case identifier into
 * lowercased sub-tokens. Filters out very short fragments.
 *
 *   slashCommands           → ['slash', 'commands']
 *   SlashCommand            → ['slash', 'command']
 *   entitlementsByUserType  → ['entitlements', 'by', 'user', 'type']
 *   $ZodTypeInternals       → ['zod', 'type', 'internals']  ($ stripped)
 *   HTTPSConnection         → ['https', 'connection']
 */
function splitCamelCaseTokens(name) {
  if (!name) return [];
  return String(name)
    .replace(/\$/g, '')                          // strip $ (zod-style prefix)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/**
 * Match a name's camelCase token against a query word. Handles plural/
 * singular and prefix variants with a length threshold to avoid noise.
 *
 *   tokenMatches('error', 'errors') → true (prefix, both ≥4)
 *   tokenMatches('type', 'type')    → true (exact)
 *   tokenMatches('by', 'by')        → true (exact, short OK)
 *   tokenMatches('to', 'tokenize')  → false (prefix but shorter is <3)
 */
function tokenMatches(token, queryWord) {
  if (!token || !queryWord) return false;
  if (token === queryWord) return true;
  if (token.length < 3 || queryWord.length < 3) return false;
  const shorter = token.length <= queryWord.length ? token : queryWord;
  const longer = token.length > queryWord.length ? token : queryWord;
  if (shorter.length < 4) return false; // 'try'/'tried'/'trie' would otherwise alias
  return longer.startsWith(shorter);
}

/**
 * Score how strongly a candidate name matches the query, in tiers.
 *
 *   tier 2 (literal): full lowercased name appears as a literal query word.
 *                     Strong signal: query mentions the identifier directly.
 *   tier 1 (tokens):  ALL camelCase tokens of the name are covered by some
 *                     query word (with prefix/plural matching). Medium signal:
 *                     query describes the identifier compositionally.
 *   tier 0:           not enough tokens covered — abstain.
 *
 * Returns {tier, tokens} so callers can compare tiers explicitly. Within a
 * tier, comparing on raw token count is noisy (sibling names often outscore
 * the primary by 1 token in ways that don't reflect query intent — e.g.,
 * "codeArtifact definition including its onStreamPart handler" mentions
 * BOTH names literally, but the user means codeArtifact). The relabel
 * rule should require sibling.tier > primary.tier strictly.
 */
function scoreNameMatchTiered(name, queryWordsArr, queryWordsSet) {
  if (!name) return { tier: 0, tokens: 0 };
  const tokens = splitCamelCaseTokens(name);
  if (tokens.length === 0) return { tier: 0, tokens: 0 };
  const nLowerRaw = String(name).toLowerCase();
  const nLowerStripped = nLowerRaw.replace(/\$/g, '');
  // Tier 2: literal full-name match. Check $-preserving form first so a
  // query mentioning "$ZodType" exact-matches v4/core/$ZodType but only
  // token-matches v4/classic/ZodType (F10).
  if (queryWordsSet.has(nLowerRaw) || queryWordsSet.has(nLowerStripped)) {
    return { tier: 2, tokens: tokens.length };
  }
  for (const t of tokens) {
    let found = false;
    for (let i = 0; i < queryWordsArr.length; i++) {
      if (tokenMatches(t, queryWordsArr[i])) { found = true; break; }
    }
    if (!found) return { tier: 0, tokens: 0 };
  }
  return { tier: 1, tokens: tokens.length };
}

/**
 * Find a sibling entity in the chunk's range that beats the primary on
 * query match. Returns the matching code-graph entity (for F8-style label
 * adoption) or null.
 *
 * Queries the code graph for ALL entities declared in the chunk's range
 * (every top-level boundary cAST merged in). Scores each entity name
 * against the query and picks the best match — but only relabels if it
 * STRICTLY beats the primary's match. Ties keep primary (avoid noise).
 *
 * Returns null unless: language ∈ JS/TS/TSX/JSX, codeGraphRepo is available
 * with findEntitiesInRange, ≥1 sibling entity exists, the best sibling
 * beats primary, AND the primary did NOT already match the query strongly
 * (a strong primary match means the encoder + indexer agreed — don't
 * second-guess them at relabel time).
 */
export function findAdditionalSymbolRelabel(result, queryWordsArr, queryWordsSet, opts) {
  // Widened from JS/TS-only to all languages. The cAST sibling-
  // merge phenomenon F9 addresses is universal — Java/C#/Lua/Python classes
  // and namespaces also produce one-chunk-per-N-siblings outputs that label
  // with the first entity. The `findEntitiesInRange` + tiered match logic
  // generalises; the JS/TS gate was a pilot scope, not a semantic requirement.
  // Stage 7 audit (stage7-deep-diagnosis.md) confirmed ~8 Java/C#/C-family
  // PARTIALs sitting on this exact mechanism. Validate against post-perf-60
  // + GCSN + 18-language probes — revert/narrow if any regression.
  // Original `isJsTsResult(result)` gate removed; behaviour now language-
  // agnostic with the strict-identifier and tier-strict-beat gates still
  // enforced below.
  const meta = result?.metadata ?? {};

  if (!opts.codeGraphRepo || typeof opts.codeGraphRepo.findEntitiesInRange !== 'function') {
    return null;
  }

  const fp = resolveFilePath(result);
  const sl = Number(result?.startLine ?? meta.startLine ?? meta.line_start);
  const el = Number(result?.endLine ?? meta.endLine ?? meta.line_end);
  if (!fp || !Number.isFinite(sl) || !Number.isFinite(el)) return null;

  const cache = opts._entityNameCache;
  const entitiesCacheKey = cache ? `${fp}|${sl}|${el}|f9-entities` : null;
  let entities;
  if (entitiesCacheKey && cache.has(entitiesCacheKey)) {
    entities = cache.get(entitiesCacheKey);
  } else {
    try { entities = opts.codeGraphRepo.findEntitiesInRange(fp, sl, el); }
    catch { entities = []; }
    if (entitiesCacheKey) cache.set(entitiesCacheKey, entities);
  }
  if (!Array.isArray(entities) || entities.length < 2) return null;

  const primaryName = meta.symbol || meta.name || result?.name || result?.symbol || null;
  // Critical gate: F9 only operates on chunks that ALREADY have a primary
  // name attributed by the indexer (cAST sibling-merge case). When primary
  // is null/missing, the chunk is an anonymous code-block whose label will
  // be resolved by context-expander via findFirstEntityInRange at result
  // presentation time — F9 must not preempt that path (regresses TS-004:
  // every artifact client.tsx chunk with name=null was being relabeled to
  // the inner `onStreamPart` arrow function the query mentions).
  if (!primaryName) return null;
  const primaryNameLower = String(primaryName).toLowerCase();
  const primaryMatch = scoreNameMatchTiered(primaryName, queryWordsArr, queryWordsSet);

  let bestEntity = null;
  let bestMatch = { tier: 0, tokens: 0 };
  for (const ent of entities) {
    if (!ent?.name) continue;
    if (primaryNameLower && String(ent.name).toLowerCase() === primaryNameLower) continue;
    // Require strict-identifier shape on the candidate. Avoids relabeling
    // to a common English-word entity captured by tree-sitter — extremely
    // rare in well-typed JS/TS but cheap to guard.
    if (!looksLikeStrictIdentifier(ent.name)) continue;
    const m = scoreNameMatchTiered(ent.name, queryWordsArr, queryWordsSet);
    if (m.tier > bestMatch.tier || (m.tier === bestMatch.tier && m.tokens > bestMatch.tokens)) {
      bestMatch = m;
      bestEntity = ent;
    }
  }

  // Only relabel when sibling tier STRICTLY beats primary tier. Same-tier
  // ties keep primary — when both are literal-name matches in the query
  // (TS-004: codeArtifact + onStreamPart both literal), the chunker's
  // primary attribution wins because the encoder already ranked the chunk
  // on that signal.
  if (!bestEntity || bestMatch.tier === 0 || bestMatch.tier <= primaryMatch.tier) return null;
  return bestEntity;
}

/**
 * Mild boost (×1.15, the identifier-mention strength) when the query spells the result's
 * name: every word of a multi-word name is a query word (`convertSymbol` for "convert a
 * TypeScript symbol into a reflection"; typedoc ranked six other `convert*` functions above it).
 */
export function nameSpelledByQuery(result, words) {
  const name = resolveResultName(result) || result?.symbol || '';
  const parts = splitIdentifierName(name).filter((w) => w.length >= 3);
  if (parts.length < 2) return 1;
  return parts.every((w) => words.has(spellStem(w))) ? NAME_SPELLED_BOOST : 1;
}
const NAME_SPELLED_BOOST = 1.15;

// Multiplier for the chunk holding `Owner.member` when the query is exactly that name.
const QUALIFIED_LOOKUP_PIN = 10;

export function identifierMentionBoost(result, mentions, opts = {}) {
  if (!mentions || mentions.size === 0) return 1.0;
  const raw = process.env.SWEET_SEARCH_IDENTIFIER_MENTION_BOOST;
  let boost = opts.identifierMentionBoostFactor ?? 1.15;
  if (raw != null && raw !== '') {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 1.0 && n <= 2.0) boost = n;
  }
  if (boost === 1.0) return 1.0;

  const symbol = result?.name
    || result?.metadata?.name
    || result?.entity?.name
    || result?.symbol
    || '';
  const skipTarget = opts._symbolExactTarget ? String(opts._symbolExactTarget).toLowerCase() : '';
  const norm = (s) => s.replace(/[_-]/g, '').toLowerCase();

  // Path 1: the chunk's populated label lexically matches a query mention.
  if (symbol) {
    const symLower = String(symbol).toLowerCase();
    const symNorm = norm(symLower);
    for (const mention of mentions) {
      const mLower = mention.toLowerCase();
      if (skipTarget && mLower === skipTarget) continue;
      if (symLower === mLower || symNorm === norm(mLower)) {
        return boost;
      }
    }
    // No Path 1 match: a contained sibling entity might still match (cAST
    // sibling-merge case: chunk labeled with
    // the FIRST entity in the merged group while query references a
    // later sibling, e.g. Java chunk 121-168 labeled `verifyNoTypeVariable`
    // but containing the gold's `getType` at 166-168).
  }

  // Path 2 — code-graph fallback. Two scenarios:
  //   1. Null-name LI metadata — some indexes were built without populated
  //      `metadata.name` (e.g. the typescript ast-tester repo has every doc
  //      carrying `name: null`). Path 1 short-circuits via `if (symbol)`
  //      and we land here directly.
  //   2. Sibling-merge mislabel — chunk has a populated label that doesn't
  //      match any mention, but the chunk's range contains a sibling entity
  //      that does. The fall-through above lets us still apply the boost.
  // Either way we look up each mention via `findEntityWithNameInRange` —
  // same code-graph signal that F8's exactSymbolTargetEntity uses — and
  // apply the same boost factor when a match exists. Cached per
  // (file, startLine, endLine, mention).
  //
  // Format-gated by the caller (identifierMentions is built only when
  // isAgentFormat is true), so this path is dormant on GCSN benchmark
  // traffic.
  if (!opts.codeGraphRepo || typeof opts.codeGraphRepo.findEntityWithNameInRange !== 'function') {
    return 1.0;
  }
  const file = resolveFilePath(result);
  const meta = result?.metadata ?? {};
  const sl = Number(result?.startLine ?? meta.startLine);
  const el = Number(result?.endLine ?? meta.endLine);
  if (!file || !Number.isFinite(sl) || !Number.isFinite(el)) return 1.0;
  const cache = opts._entityNameCache;
  // `Owner.member` (okhttp `RealCall.execute`): a chunk holding `member` of `Owner` is the
  // place the query names, above a chunk that only holds a same-named member of another
  // owner (Dns.Call.execute) or the owner's other parts: the boost applies twice.
  if (typeof opts.codeGraphRepo.findOwnedEntityInRange === 'function') {
    for (const mention of mentions) {
      const parts = mention.split('.');
      if (parts.length < 2) continue;
      const owner = parts[parts.length - 2];
      const member = parts[parts.length - 1];
      let owned = null;
      try { owned = opts.codeGraphRepo.findOwnedEntityInRange(file, sl, el, owner, member); } catch { owned = null; }
      // The whole query is this one qualified name: a definition lookup with one answer, so
      // the chunk that holds it goes first whatever its embedding score.
      if (owned && String(opts.query || '').trim() === mention) return QUALIFIED_LOOKUP_PIN;
      if (owned) return boost * boost;
    }
  }
  for (const mention of mentions) {
    const mLower = mention.toLowerCase();
    if (skipTarget && mLower === skipTarget) continue;
    const cacheKey = cache ? `${file}|${sl}|${el}|mention:${mention}` : null;
    let resolved;
    if (cacheKey && cache.has(cacheKey)) {
      resolved = cache.get(cacheKey);
    } else {
      try {
        resolved = opts.codeGraphRepo.findEntityWithNameInRange(file, sl, el, mention);
      } catch { resolved = null; }
      if (cacheKey) cache.set(cacheKey, resolved);
    }
    if (resolved) return boost;
  }
  return 1.0;
}

export function pathTokenBoost(result, pathTokens, opts = {}) {
  if (!pathTokens || pathTokens.length === 0) return 1.0;
  const raw = process.env.SWEET_SEARCH_PATH_TOKEN_BOOST;
  let boost = opts.pathTokenBoost ?? 1.20;
  if (raw != null && raw !== '') {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 1.0 && n <= 2.0) boost = n;
  }
  if (boost === 1.0) return 1.0;
  const path = String(result?.file || result?.metadata?.file || '').toLowerCase();
  if (!path) return 1.0;
  // Separator-bounded: avoids "iter" matching inside "literator".
  for (const tok of pathTokens) {
    const re = new RegExp('(^|[/_-])' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[/_.-])');
    if (re.test(path)) return boost;
  }
  return 1.0;
}

/**
 * True when the query names `target` as `Owner.target` and this chunk holds no `target`
 * owned by `Owner` (it may hold another owner's `target`).
 */
export function qualifiedMemberMismatch(result, target, mentions, opts = {}) {
  if (!mentions || !target || typeof opts.codeGraphRepo?.findOwnedEntityInRange !== 'function') return false;
  const t = String(target).toLowerCase();
  const owners = [...mentions].map((m) => m.split('.')).filter((p) => p.length >= 2 && p[p.length - 1].toLowerCase() === t)
    .map((p) => p[p.length - 2]);
  if (!owners.length) return false;
  const file = resolveFilePath(result);
  const meta = result?.metadata ?? {};
  const sl = Number(result?.startLine ?? meta.startLine);
  const el = Number(result?.endLine ?? meta.endLine);
  if (!file || !Number.isFinite(sl) || !Number.isFinite(el)) return false;
  for (const owner of owners) {
    try { if (opts.codeGraphRepo.findOwnedEntityInRange(file, sl, el, owner, target)) return false; } catch { return false; }
  }
  return true;
}

/**
 * Symbol-exact-match boost for definition-style queries.
 *
 * Both diagnoses (FreshStack uv #1, 60-probe new-set #1)
 * converged on this as the highest-impact fix. When a query has the shape
 * "show me X struct/enum/class/function/...", chunks where the symbol name
 * EQUALS X (case-insensitive, after stemming s/es/ing suffixes) should
 * dominate the lexical-collision sibling chunk that the encoder happens
 * to score nearby.
 *
 * Diagnosed cases (combined): Cache vs CacheArgs (UV-DEF-1), Resolver vs
 * Resolution (UV-DEF-4), ContentTypeParser vs ContentType (S6-Q2),
 * Flask vs App (S6-Q9), buildErrorHandler vs setErrorHeaders (S6-Q3),
 * Set method vs Value method (S3-Q6), get_send_file_max_age vs
 * send_static_file (S3-Q9). 8+ failures in the new-probe set, 4 in
 * FreshStack — strong evidence of a real systematic gap.
 *
 * SOTA precedent: BM25F field-weighted boosting on the symbol field
 * (canonical IR move when one field carries decisive signal); ColBERTv2
 * "expansion-aware reranking" with identifier prior; Sourcegraph Cody's
 * "hint" tokens that bias toward exact symbol matches in graph-aware
 * retrieval (Cody arXiv 2408.05344).
 *
 * Trigger pattern (conservative — only fires on UNAMBIGUOUS definition
 * queries):
 *   /\b(show|give|find|describe|display|fetch).+?(?:the\s+)?(\w+)\s+
 *    (struct|enum|class|fn|function|method|trait|type|interface|impl|
 *     definition|signature|prototype|constructor)\b/i
 *
 * Plus a "WHAT IS X TYPE" alternate trigger:
 *   /\bwhat\s+(?:is|does)\s+(?:the\s+)?(\w+)\s+
 *    (struct|enum|class|function|method|type)\b/i
 *
 * Boost: 1.30× when chunk.symbol case-insensitive-equals the captured
 * identifier. Capped at 1.30 (mild — definition queries account for ≤25%
 * of probe traffic so a stronger boost risks breaking non-DEF queries).
 *
 * Override env: SWEET_SEARCH_SYMBOL_EXACT_BOOST (default 1.30, set to 1.0
 * to disable). `ablations: ['no-symbol-exact-boost']` also disables.
 */
export function symbolExactMatchBoost(result, target, opts = {}) {
  if (!target) return 1.0;
  const raw = process.env.SWEET_SEARCH_SYMBOL_EXACT_BOOST;
  let boost = opts.symbolExactBoost ?? 1.30;
  if (raw != null && raw !== '') {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 1.0 && n <= 2.0) boost = n;
  }
  if (boost === 1.0) return 1.0;

  const symbol = result?.name
    || result?.metadata?.name
    || result?.entity?.name
    || result?.symbol
    || '';
  const tLower = target.toLowerCase();
  const norm = (s) => s.replace(/[_-]/g, '').toLowerCase();
  if (symbol) {
    const sLower = String(symbol).toLowerCase();
    if (sLower === tLower) return boost;
    if (norm(sLower) === norm(tLower)) return boost;
  }
  // F7: chunk's labeled symbol may not match the target, but a
  // sibling entity contained inside the chunk range may match. Diagnosed from
  // S6-Q3 (fastify): chunk 103-150 contains both fallbackErrorHandler AND
  // buildErrorHandler at lines 142-150; chunker labeled it fallbackErrorHandler.
  // Query "show me the buildErrorHandler function definition" extracts target
  // "buildErrorHandler" — the contained-entity check finds it and applies the
  // same 1.30× boost so the chunk wins over adjacent setErrorHeaders chunk.
  if (opts.codeGraphRepo && typeof opts.codeGraphRepo.hasEntityWithNameInRange === 'function') {
    const filePath = resolveFilePath(result);
    const meta = result?.metadata ?? {};
    const startLine = Number(result?.startLine ?? meta.startLine);
    const endLine = Number(result?.endLine ?? meta.endLine);
    if (filePath && Number.isFinite(startLine) && Number.isFinite(endLine)) {
      try {
        if (opts.codeGraphRepo.hasEntityWithNameInRange(filePath, startLine, endLine, target)) {
          return boost;
        }
      } catch { /* fall through */ }
    }
  }
  return 1.0;
}
