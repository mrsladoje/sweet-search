import { AGENT_FORMATS } from '../infrastructure/agent-format.js';
import { hasAblation, inferLineCount, normalizeType, resolveFilePath } from './file-kind/result-fields.js';
import { ENTITY_KIND_KEYWORDS, classifyFileKindIntent, entityKindPreferenceFromQuery, extractIdentifierMentions, extractNameHints, extractPathTokens, extractSymbolDefinitionTarget, querySpellingWords, queryTokenSet } from './file-kind/query-analysis.js';
import { anomalousChunkDemotion, bodyDensityMultiplier, buildRefCountMap, docCommentOnlyDemotion, megaChunkSizePenalty, megaEntityPenalty, referenceCountBoost, resolveMaxEnvelopeLines } from './file-kind/chunk-signals.js';
import { detectFileKind, isTestChunk, testNameQueryOverlap } from './file-kind/file-kind-detect.js';
import { NAMESPACE_ENTITY_KINDS, entityKindMultiplier, exactNamedEntityForResult, namePrecisionMultiplier, refineContainedAdoption, resolveEntityKindInfo } from './file-kind/entity-kind.js';
import { findAdditionalSymbolRelabel, identifierMentionBoost, nameSpelledByQuery, pathTokenBoost, qualifiedMemberMismatch, symbolExactMatchBoost } from './file-kind/symbol-boosts.js';
import { envFactor, envOff, envWindow } from './file-kind/env-tuning.js';
export { detectFileKind, isTestChunk, isTestSupportFile, testNameQueryOverlap } from './file-kind/file-kind-detect.js';
export { classifyFileKindIntent, entityKindPreferenceFromQuery, extractNameHints } from './file-kind/query-analysis.js';
export { avgFnBodyLines, rawStringDensity } from './file-kind/chunk-signals.js';

/**
 * Intent-aware file-kind ranking (conservative variant).
 *
 * Background: real-codebase miss analysis found that documentation, test, and
 * TypeScript-declaration files often outrank the implementation file users
 * were actually looking for on multi-file codebases. The first version of
 * this rule (commit f6fcfd1) lifted graph-2hop R@1 from 47.46 % → 64.41 %
 * but catastrophically regressed GenCodeSearchNet under the dense profile
 * (full-6 000 dense run: MRR@10 84.4 % → 47.4 %, Recall@5 92.0 % → 48.4 %).
 * Root cause: the legacy LI-rerank pipeline assembles
 * `results = [...liScored, ...tail]`, where `liScored` carries MaxSim
 * scores that are sometimes *lower* (in absolute value) than the int8
 * cosine scores already on the un-reranked tail. The concatenated list is
 * therefore not globally score-monotonic. The old helper unconditionally
 * spread and re-sorted *all* results by `score`, which floated the
 * int8-only tail above the LI-reranked head and undid the rerank — even
 * when every multiplier was 1 (GenCodeSearchNet is a single-source
 * corpus, so no docs/tests/types kind ever matches there).
 *
 * Conservative variant fixes both regressions with three guards:
 *
 *   1. Confident-intent gating. `classifyFileKindIntent` now returns
 *      `'unknown'` for queries with no implementation-seeking signal. Only
 *      explicit `'implementation'` intent triggers demotion. `'unknown'`,
 *      `'docs'`, `'tests'`, `'types'` are no-ops.
 *
 *   2. Structural skip. The rule looks at the top-N candidates (default 30).
 *      If the window has zero docs/tests/types files (single-source corpus
 *      like GCSN) or zero implementation files (nothing to promote), the
 *      input is returned untouched. No re-sort, no new objects.
 *
 *   3. Window-bounded re-sort. When the rule does fire, only the top-N
 *      window is re-ranked. The tail — where the rerank/non-rerank score-
 *      scale boundary usually lives — is concatenated unchanged. This
 *      keeps mixed-scale damage contained.
 *
 * Disable at runtime with `SWEET_SEARCH_FILE_KIND_RANKING=0`. Tune the soft
 * factor with `SWEET_SEARCH_FILE_KIND_FACTOR` (default 0.85; range (0, 1]).
 * Tune the window with `SWEET_SEARCH_FILE_KIND_WINDOW` (default 30).
 */

// Removed (2026-05-05): file-header chunk detection became redundant
// once cAST sibling-merge was confirmed. With cAST, a chunk starting at
// line 1 of a source file naturally merges the package decl + imports
// with the first executable declaration(s), so a "lines 1-N: imports
// only" chunk shouldn't normally win retrieval. Cases where it still
// does are rare enough that the cost of the false-positive demotion
// (e.g. a `types.go` consisting purely of type aliases) outweighs the
// benefit. The per-doc `tinyAncillaryFactor` in applyFileKindRanking
// still catches tiny doc/test/example top-1 results.

/**
 * Apply content-aware result demotions/boosts before top-k truncation.
 * Catches inline test functions and explicit entity-kind queries that
 * path-only demotion cannot see. Tiny-chunk and file-header rules were
 * removed once cAST sibling-merge made them structurally redundant.
 */
export function applyResultDemotions(results, opts = {}) {
  if (!Array.isArray(results) || results.length === 0) return results;

  // Attach intra-call (and optionally cross-call) memoization for the three
  // hot lookups inside the demotion sub-rules:
  //   - _entityKindCache    : enclosing/contained entity from SQLite
  //   - _entityNameCache    : findEntityWithNameInRange (symbol-target adopt)
  //   - _resultTextCache    : readFileSync source span — biggest win, since
  //                           5+ rules call resolveResultText per result and
  //                           each cache-miss fires a full readFileSync.
  // Caller may pass pre-allocated Maps via opts to share across both
  // applyResultDemotions calls in the same search() invocation.
  opts = {
    ...opts,
    _entityKindCache: opts._entityKindCache instanceof Map ? opts._entityKindCache : new Map(),
    _entityNameCache: opts._entityNameCache instanceof Map ? opts._entityNameCache : new Map(),
    _resultTextCache: opts._resultTextCache instanceof Map ? opts._resultTextCache : new Map(),
    _fullFileTextCache: opts._fullFileTextCache instanceof Map ? opts._fullFileTextCache : new Map(),
    _isTestSupportCache: opts._isTestSupportCache instanceof Map ? opts._isTestSupportCache : new Map(),
    _isTestChunkCache: opts._isTestChunkCache instanceof Map ? opts._isTestChunkCache : new Map(),
    _fileKindCache: opts._fileKindCache instanceof Map ? opts._fileKindCache : new Map(),
  };

  const ablations = opts.ablations;
  if (hasAblation(ablations, 'no-result-demotions')) return results;

  const qTokens = queryTokenSet(opts.query || '', opts.queryTokens);
  const preferredKind = hasAblation(ablations, 'no-entity-kind-pref')
    ? null
    : entityKindPreferenceFromQuery(opts.query || '');
  const nameHints = hasAblation(ablations, 'no-name-precision')
    ? new Set()
    : extractNameHints(opts.query || '');
  const nameHintsLower = hasAblation(ablations, 'no-name-precision')
    ? new Set()
    : new Set([...nameHints].map(s => s.toLowerCase()));

  // Pre-compute incoming-call counts in a single batched query so the
  // per-result loop doesn't make N round trips to SQLite.
  const refCounts = !hasAblation(ablations, 'no-ref-count-boost')
    ? buildRefCountMap(results, opts)
    : new Map();

  // Symbol-exact-match target + path-token targets — extracted ONCE per
  // query (not per-result). BM25F SOTA pattern (Sourcegraph BM25F blog
  // April 2025, +20% on code search; Pérez-Iglesias et al. arXiv
  // 0911.5046; Robertson & Zaragoza 2009).
  //
  // CRITICAL — gated on opts.format === 'agent' (or env override) to
  // avoid −0.07pp regression on GCSN heldout MRR. GCSN-style NL queries
  // ("Sort an array of integers", "Find the index of an element") trip
  // the path-token "of X" pattern with non-path tokens like "integers"
  // / "ascending", and lightly poison ranking. The boosts are designed
  // for agent queries with explicit identifier/path hints ("show me X
  // struct", "in globset"), not for benchmark NL traffic. Probes use
  // format='agent', so their behaviour is preserved; GCSN bench uses
  // mode='auto' without format, so boosts are skipped — restoring the
  // 85.99% MRR heldout baseline.
  //
  // See docs/SOTA_RESEARCH_2026_FIXES.md for full rationale.
  const isAgentFormat = AGENT_FORMATS.has(opts.format)
    || process.env.SWEET_SEARCH_FORCE_BM25F_BOOSTS === '1';
  const symbolExactTarget = isAgentFormat && !hasAblation(ablations, 'no-symbol-exact-boost')
    ? extractSymbolDefinitionTarget(opts.query || '')
    : null;
  const pathTokens = isAgentFormat && !hasAblation(ablations, 'no-path-token-boost')
    ? extractPathTokens(opts.query || '')
    : [];
  // Identifier-mention boost (complements verb-anchored symbolExactTarget):
  // fires on noun-anchored probe phrasings where the gold symbol appears in
  // the query without a "show me/find/where is" prefix. Format-gated; opts
  // passes through `_symbolExactTarget` so this boost skips mentions already
  // boosted by the higher-precision verb path.
  const identifierMentions = isAgentFormat && !hasAblation(ablations, 'no-identifier-mention-boost')
    ? extractIdentifierMentions(opts.query || '')
    : null;
  // Query words (stemmed) for the name-spelled boost; agent format only.
  const spelledWords = isAgentFormat && !hasAblation(ablations, 'no-name-spelled-boost')
    ? querySpellingWords(opts.query || '')
    : null;

  // F9 (2026-05-12): pre-compute query word tokens once for additional_symbols
  // re-anchoring (see findAdditionalSymbolRelabel docstring). Format-gated;
  // skipped entirely when isAgentFormat=false so GCSN benchmark traffic is
  // untouched (same gate as the other BM25F-family signals above).
  //
  // F10 (2026-05-12): the extraction regex preserves a leading `$` so
  // identifiers like $ZodType / $ZodTypeInternals (zod v4/core public-API
  // convention — the structural interfaces are $-prefixed while the runtime
  // classes are not) round-trip through tokenization. `\b[A-Za-z0-9_]+\b`
  // would silently strip the `$` (since `$` is non-word) and make
  // `$ZodType` indistinguishable from plain `ZodType`, costing TSL-004/8
  // (chunk relabel picked classic/ZodType over core/$ZodType because the
  // tier-A literal match was ambiguous).
  const f9QueryWordsArr = (isAgentFormat && !hasAblation(ablations, 'no-addsym-relabel'))
    ? ((opts.query || '').match(/\$?[A-Za-z_][A-Za-z0-9_]*/g) || []).map(w => w.toLowerCase())
    : null;
  const f9QueryWordsSet = f9QueryWordsArr ? new Set(f9QueryWordsArr) : null;

  let changed = false;
  const window = Math.min(opts.window ?? results.length, results.length);

  // Per-rule timers — accumulator pattern, no object allocation per call.
  // No-op in production; only fires when profile-search-stages.mjs sets
  // globalThis.__stageTimings. Adds ~1ms overhead per call when profiling
  // (12 rules × 100 results × 2 performance.now() calls), acceptable for
  // the diagnostic.
  const __profOn = !!globalThis.__stageTimings;
  const __ruleTime = __profOn ? new Float64Array(12) : null;
  let __ruleT0 = 0;
  // Hoist loop-invariant work out of the per-result map():
  //   - ruleOpts: a single spread reused across the 3 ruleOpts callsites
  //     (anomalous, docComment, megaEntity). Original allocated 3 fresh
  //     spreads per result (~15-20 keys each) × 100 results = 300 extra
  //     objects per call.
  //   - skip* flags: hasAblation() called once per result per rule otherwise.
  //   - preferredKindKeywordSet: the kind→keywords list never changes during
  //     the loop, but the original recomputed
  //     `(ENTITY_KIND_KEYWORDS[preferredKind] || []).map(normalizeType)` per
  //     result inside the entity-adoption gate.
  // Pre-resolve the envelope-cap once for ruleOpts. resolveMaxEnvelopeLines
  // does an env-var lookup + parseInt + default fallback; without this it
  // ran per result inside megaEntityPenalty.
  const ruleOpts = {
    ...opts,
    ablations,
    _isAgentFormat: isAgentFormat,
    _megaEnvelopeMax: resolveMaxEnvelopeLines(opts),
  };
  const skipTestName = hasAblation(ablations, 'no-test-name-overlap');
  const skipBodyDensity = hasAblation(ablations, 'no-body-density');
  const skipMegaChunk = hasAblation(ablations, 'no-mega-chunk-penalty');
  const skipRefCount = hasAblation(ablations, 'no-ref-count-boost');
  const skipNamePrecision = hasAblation(ablations, 'no-name-precision');
  const skipEntityKindPref = hasAblation(ablations, 'no-entity-kind-pref');
  const testNameOverlapThreshold = opts.testNameOverlapThreshold ?? 0.5;
  const testNameOverlapFactor = opts.testNameOverlapFactor ?? 0.40;
  const preferredKindKeywordSet = preferredKind
    ? new Set((ENTITY_KIND_KEYWORDS[preferredKind] || []).map(normalizeType))
    : null;

  // For-loop with a pre-allocated array. The hot path here was a `.map()`
  // callback that always allocated a `details` array per result and a fresh
  // result spread `{ ...result, _resultDemotionOrigIndex: index }` even when
  // no rule fired. With ~100 results × 2 demotion sites that's hundreds of
  // empty arrays + light spreads per query for nothing. Lazy `details`
  // allocation skips the array when the result has zero rule hits;
  // unchanged-result spreads keep going through the same shape (the caller
  // expects new references — cascade scoring writes back r.score).
  const adjusted = new Array(window);
  for (let index = 0; index < window; index++) {
    const result = results[index];
    let mult = 1;
    let details = null;

    if (!skipTestName) {
      if (__profOn) __ruleT0 = performance.now();
      if (isTestChunk(result, opts)) {
        const overlap = testNameQueryOverlap(result, qTokens);
        if (overlap >= testNameOverlapThreshold) {
          mult *= testNameOverlapFactor;
          (details ||= []).push('test-name:0.40');
        }
      }
      if (__profOn) __ruleTime[0] += performance.now() - __ruleT0;
    }

    if (__profOn) __ruleT0 = performance.now();
    const kindMult = entityKindMultiplier(result, preferredKind, opts);
    if (__profOn) __ruleTime[1] += performance.now() - __ruleT0;
    if (kindMult !== 1) {
      mult *= kindMult;
      (details ||= []).push(`kind-pref:${kindMult.toFixed(2)}`);
    }

    if (__profOn) __ruleT0 = performance.now();
    const nameMult = namePrecisionMultiplier(result, preferredKind, nameHintsLower, opts);
    if (__profOn) __ruleTime[2] += performance.now() - __ruleT0;
    if (nameMult !== 1) {
      mult *= nameMult;
      (details ||= []).push(`name-precision:${nameMult.toFixed(2)}`);
    }

    if (!skipBodyDensity) {
      if (__profOn) __ruleT0 = performance.now();
      const bodyMult = bodyDensityMultiplier(result, opts);
      if (__profOn) __ruleTime[3] += performance.now() - __ruleT0;
      if (bodyMult !== 1) {
        mult *= bodyMult;
        (details ||= []).push(`body-density:${bodyMult.toFixed(2)}`);
      }
    }

    if (!skipMegaChunk) {
      if (__profOn) __ruleT0 = performance.now();
      const megaMult = megaChunkSizePenalty(result, opts);
      if (__profOn) __ruleTime[4] += performance.now() - __ruleT0;
      if (megaMult !== 1) {
        mult *= megaMult;
        (details ||= []).push(`mega-chunk:${megaMult.toFixed(2)}`);
      }
    }

    {
      if (__profOn) __ruleT0 = performance.now();
      const anomMult = anomalousChunkDemotion(result, ruleOpts);
      if (__profOn) __ruleTime[5] += performance.now() - __ruleT0;
      if (anomMult !== 1) {
        mult *= anomMult;
        (details ||= []).push(`anomalous-chunk:${anomMult.toFixed(2)}`);
      }
    }

    {
      if (__profOn) __ruleT0 = performance.now();
      const docMult = docCommentOnlyDemotion(result, ruleOpts);
      if (__profOn) __ruleTime[6] += performance.now() - __ruleT0;
      if (docMult !== 1) {
        mult *= docMult;
        (details ||= []).push(`doc-comment-only:${docMult.toFixed(2)}`);
      }
    }

    {
      if (__profOn) __ruleT0 = performance.now();
      const entMult = megaEntityPenalty(result, ruleOpts);
      if (__profOn) __ruleTime[7] += performance.now() - __ruleT0;
      if (entMult !== 1) {
        mult *= entMult;
        (details ||= []).push(`mega-entity:${entMult.toFixed(2)}`);
      }
    }


    if (symbolExactTarget) {
      if (__profOn) __ruleT0 = performance.now();
      // `Owner.member` in the query: the member's name alone does not boost a same-named
      // member of another owner (okhttp `RealCall.execute` vs the `Dns.Call.execute` extension).
      const symbolMult = qualifiedMemberMismatch(result, symbolExactTarget, identifierMentions, opts)
        ? 1 : symbolExactMatchBoost(result, symbolExactTarget, opts);
      if (__profOn) __ruleTime[8] += performance.now() - __ruleT0;
      if (symbolMult !== 1) {
        mult *= symbolMult;
        (details ||= []).push(`symbol-exact:${symbolMult.toFixed(2)}`);
      }
    }

    if (identifierMentions) {
      if (__profOn) __ruleT0 = performance.now();
      const mentionMult = identifierMentionBoost(result, identifierMentions, {
        ...opts,
        _symbolExactTarget: symbolExactTarget,
      });
      if (__profOn) __ruleTime[8] += performance.now() - __ruleT0;
      if (mentionMult !== 1) {
        mult *= mentionMult;
        (details ||= []).push(`identifier-mention:${mentionMult.toFixed(2)}`);
      }
    }

    if (spelledWords) {
      const spelledMult = nameSpelledByQuery(result, spelledWords);
      if (spelledMult !== 1) {
        mult *= spelledMult;
        (details ||= []).push(`name-spelled:${spelledMult.toFixed(2)}`);
      }
    }

    if (pathTokens.length > 0) {
      if (__profOn) __ruleT0 = performance.now();
      const pathMult = pathTokenBoost(result, pathTokens, opts);
      if (__profOn) __ruleTime[9] += performance.now() - __ruleT0;
      if (pathMult !== 1) {
        mult *= pathMult;
        (details ||= []).push(`path-token:${pathMult.toFixed(2)}`);
      }
    }

    if (!skipRefCount) {
      if (__profOn) __ruleT0 = performance.now();
      const refMult = referenceCountBoost(result, refCounts, opts);
      if (__profOn) __ruleTime[10] += performance.now() - __ruleT0;
      if (refMult !== 1) {
        mult *= refMult;
        (details ||= []).push(`ref-count:${refMult.toFixed(2)}`);
      }
    }

    const baseScore = typeof result.score === 'number' ? result.score : 0;
    if (__profOn) __ruleT0 = performance.now();
    // F8 (2026-05-07): when the query has an explicit symbol target (extractSymbolDefinitionTarget)
    // AND the chunk contains an entity matching that name, prefer THAT entity for labeling
    // over kind-preference / name-precision heuristics. Targets cases like S3-Q4 (chunk
    // labeled "Binding" but contains the Default function the user asked for) and parallels
    // F7's contained-entity boost (which only changes ranking, not symbol attribution).
    // Format-gated through symbolExactTarget which is set only when isAgentFormat.
    const exactSymbolTargetEntity = symbolExactTarget && opts.codeGraphRepo
      && typeof opts.codeGraphRepo.findEntityWithNameInRange === 'function'
      ? (() => {
          const fp = resolveFilePath(result);
          const meta = result?.metadata ?? {};
          const sl = Number(result?.startLine ?? meta.startLine);
          const el = Number(result?.endLine ?? meta.endLine);
          if (!fp || !Number.isFinite(sl) || !Number.isFinite(el)) return null;
          const cache = opts._entityNameCache;
          const cacheKey = cache ? `${fp}|${sl}|${el}|${symbolExactTarget}` : null;
          if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
          let resolved = null;
          try {
            resolved = opts.codeGraphRepo.findEntityWithNameInRange(fp, sl, el, symbolExactTarget);
          } catch { resolved = null; }
          if (cacheKey) cache.set(cacheKey, resolved);
          return resolved;
        })()
      : null;
    // F9 (2026-05-12): when F8 (verb-anchored explicit target) did not fire,
    // try additional_symbols re-anchoring. JS/TS/TSX/JSX-gated inside the
    // helper. Pure label adoption — no score change. See helper docstring.
    const additionalSymbolRelabelEntity = !exactSymbolTargetEntity
      && f9QueryWordsArr
      ? findAdditionalSymbolRelabel(result, f9QueryWordsArr, f9QueryWordsSet, opts)
      : null;
    const exactEntity = exactSymbolTargetEntity
      || additionalSymbolRelabelEntity
      || (!skipNamePrecision
          ? exactNamedEntityForResult(result, preferredKind, nameHints, nameHintsLower, opts)
          : null);
    const preferredEntity = exactEntity || (preferredKind && !skipEntityKindPref
      ? resolveEntityKindInfo(result, opts)
      : null);
    const preferredType = normalizeType(preferredEntity?.type);
    // F8 (continued): when the chunk contains an entity matching the explicit
    // symbol target (function name from "show me X function" queries), bypass
    // the kind-keyword gate. Functions/methods aren't in ENTITY_KIND_KEYWORDS
    // (which is struct/enum/class/interface/trait/type), so without bypass the
    // relabel path was gated off for "show me X function" queries — defeating
    // the purpose of having SYMBOL_DEFN_QUERY_RE recognise "function".
    const shouldAdoptViaExactTarget = !!(exactSymbolTargetEntity
      && exactSymbolTargetEntity.name
      && exactSymbolTargetEntity.startLine
      && exactSymbolTargetEntity.endLine);
    // F9: noun-anchored addSym path also bypasses the kind-keyword gate.
    // Variables/typeAliases captured as additional_symbols (TS-006/8 scope)
    // would otherwise fail the gate (variable/typeAlias not in keyword set).
    const shouldAdoptViaAddSym = !!(additionalSymbolRelabelEntity
      && additionalSymbolRelabelEntity.name
      && additionalSymbolRelabelEntity.startLine
      && additionalSymbolRelabelEntity.endLine);
    const shouldAdoptEntity = shouldAdoptViaExactTarget || shouldAdoptViaAddSym || !!(preferredEntity?.startLine
      && preferredEntity?.endLine
      && preferredKindKeywordSet && preferredKindKeywordSet.has(preferredType));
    let containedEntity = !shouldAdoptEntity && opts.codeGraphRepo && typeof opts.codeGraphRepo.findFirstEntityInRange === 'function'
      ? resolveEntityKindInfo(result, opts)
      : null;
    // Agent format only: a namespace/module or a class that owns the chunk
    // is no label or range for it (see refineContainedAdoption). Label-only
    // here, but the second demotion pass reads the adopted label and range,
    // so it stays behind the same format gate as the other structural rules.
    let containedLabelOnly = false;
    if (isAgentFormat && containedEntity) {
      const refined = refineContainedAdoption(result, containedEntity, opts);
      containedEntity = refined.entity;
      containedLabelOnly = refined.labelOnly;
    }
    const shouldAdoptContained = !!(containedEntity?.name && containedEntity?.startLine && containedEntity?.endLine);
    const entityToAdopt = shouldAdoptEntity ? preferredEntity : shouldAdoptContained ? containedEntity : null;
    if (__profOn) __ruleTime[11] += performance.now() - __ruleT0;
    if (mult === 1 && !entityToAdopt) {
      // Unchanged: shallow copy preserves the caller-expected new-reference
      // shape (downstream cascade scoring writes back r.score) without the
      // redundant _resultDemotionOrigIndex field — V8 Array.sort is stable
      // since ES2019, so the in-place index-order tie-break is implicit.
      adjusted[index] = { ...result };
      continue;
    }
    changed = true;
    // Range-preservation invariant: adopting an entity is a *labeling*
    // operation (it tells the caller what symbol the chunk is about); it
    // must not SHRINK a well-formed retrieval chunk to a per-symbol entity
    // boundary. The cAST/sibling-merged chunk is the right unit for the
    // agent to read; the entity name + type are added as annotations.
    //
    // Concretely: a Go file's bsonBinding has a 1-line typeAlias entity
    // at line 14, but the LI chunk is lines 1-31 (typeAlias + 3 methods,
    // all merged by cAST). Adopting the entity's range used to drop 30
    // lines of content; now we keep the chunk range and just adopt the
    // name/type as labels. Range adoption only fires when the entity
    // is at least as large as the chunk (e.g. expanding a partial
    // chunk to its enclosing symbol — which is the legitimate use case).
    const chunkStart = result.metadata?.startLine ?? result.startLine ?? null;
    const chunkEnd = result.metadata?.endLine ?? result.endLine ?? null;
    const chunkRange = (chunkStart != null && chunkEnd != null)
      ? Math.max(0, chunkEnd - chunkStart + 1) : 0;
    const entityRange = entityToAdopt
      ? Math.max(0, (entityToAdopt.endLine || 0) - (entityToAdopt.startLine || 0) + 1) : 0;
    // Agent format: never widen a chunk to a namespace/module span, whichever
    // path picked the entity; nor a graph-expanded result that took its chunk's span because
    // its score is the chunk's (search-postprocess.js attachChunkIdsToExpanded): the chunk is
    // what scored, its enclosing class is not.
    const adoptRange = !!entityToAdopt && entityRange >= chunkRange
      && !(isAgentFormat && (
        (!shouldAdoptEntity && containedLabelOnly)
        || result._borrowedSpanFrom
        || NAMESPACE_ENTITY_KINDS.has(normalizeType(entityToAdopt.type))));
    const adoptedFile = entityToAdopt
      ? (entityToAdopt.file || entityToAdopt.filePath || resolveFilePath(result))
      : null;
    const baseMetadata = result.metadata || {};
    const nextMetadata = entityToAdopt
      ? {
          ...baseMetadata,
          ...(shouldAdoptEntity
            ? { name: entityToAdopt.name || baseMetadata.name || result.name || null }
            : { name: entityToAdopt.name }),
          type: entityToAdopt.type,
          ...(adoptRange ? {
            file: adoptedFile,
            startLine: entityToAdopt.startLine,
            endLine: entityToAdopt.endLine,
          } : {}),
        }
      : baseMetadata;
    adjusted[index] = {
      ...result,
      ...(entityToAdopt ? {
        name: shouldAdoptEntity
          ? (entityToAdopt.name || result.name)
          : entityToAdopt.name,
        type: entityToAdopt.type,
        ...(adoptRange ? {
          startLine: entityToAdopt.startLine,
          endLine: entityToAdopt.endLine,
        } : {}),
      } : {}),
      ...(nextMetadata ? { metadata: nextMetadata } : {}),
      score: baseScore * mult,
      _resultDemotionOrigScore: baseScore,
      _resultDemotionMult: mult,
      _resultDemotionDetails: details ?? [],
    };
  }

  // Dump per-rule timings to globalThis.__stageTimings (set by the profiler).
  // No-op in production. Labels mirror the rule names so the profiler's flat
  // table reads cleanly.
  if (__profOn && __ruleTime) {
    const labels = [
      'rule:testName', 'rule:entityKind', 'rule:namePrec', 'rule:body',
      'rule:megaChunk', 'rule:anomalous', 'rule:docComment', 'rule:megaEntity',
      'rule:symbolExact', 'rule:pathToken', 'rule:refCount', 'rule:adoptEntity',
    ];
    const buf = globalThis.__stageTimings;
    for (let i = 0; i < labels.length; i++) {
      (buf[labels[i]] = buf[labels[i]] || []).push(__ruleTime[i]);
    }
  }

  if (!changed) return results;

  // V8 Array.sort is stable (ES2019) — same-score results retain their
  // original-window order without needing the explicit _origIndex tiebreak
  // the prior implementation carried.
  adjusted.sort((a, b) => (b.score || 0) - (a.score || 0));
  return window === results.length ? adjusted : adjusted.concat(results.slice(window));
}

const DEFAULT_FACTOR = 0.85;
const DEFAULT_WINDOW = 30;

/**
 * Apply intent-aware file-kind score multipliers, then re-sort the top-N
 * window descending. The original array is not mutated.
 *
 * Demotion fires only when:
 *   - intent === 'implementation' (confident, NOT 'unknown'), AND
 *   - the top-N window contains at least one demotable candidate, AND
 *   - the top-N window contains at least one implementation candidate.
 *
 * In every other case the original `results` array is returned unchanged
 * (same reference, no copy, no re-sort) — this is critical so the helper is
 * a structural no-op on single-source corpora (GCSN) and on cascades whose
 * top-N has no demotable competition.
 *
 * @param {Array} results - search results carrying .score and a file-path
 *                          field (.file / .file_path / .path / .metadata.*).
 * @param {Object} [opts]
 * @param {string} [opts.query]            - raw query (used to infer intent
 *                                            if opts.intent isn't supplied)
 * @param {'docs'|'tests'|'types'|'ancillary'|'implementation'|'unknown'} [opts.intent]
 *                                            - explicit intent override
 * @param {number} [opts.docFactor]        - default from env / 0.85
 * @param {number} [opts.exampleFactor]    - default from docFactor
 * @param {number} [opts.testFactor]       - default from env / 0.85
 * @param {number} [opts.typeFactor]       - default from env / 0.85
 * @param {number} [opts.ancillaryFactor]  - default from env / 0.85
 * @param {number} [opts.tinyAncillaryFactor]
 * @param {number} [opts.tinyLineThreshold]
 * @param {number} [opts.window]           - top-N window for analysis +
 *                                            bounded re-sort (default 30)
 * @returns {Array} either the original `results` (no-op) or a new array
 *                  whose head is sorted by adjusted score and whose tail is
 *                  the unchanged input tail. Stable on ties.
 */
// With a tests intent, implementation still answers part of the question: a milder demotion.
const TESTS_INTENT_IMPL_FACTOR = 0.6;

export function applyFileKindRanking(results, opts = {}) {
  if (envOff()) return results;
  if (!Array.isArray(results) || results.length === 0) return results;

  const intent = opts.intent != null
    ? opts.intent
    : classifyFileKindIntent(opts.query || '');

  // Conservative gate: only confident 'implementation' intent fires — and, in the agent
  // format, 'tests' intent (fastify "which test covers returning a 404 for an unknown route"
  // ranked a .d.ts, ci.yml and labeler.yml above test/404s.test.js).
  const testsIntent = intent === 'tests' && opts.agentFormat === true;
  if (intent !== 'implementation' && !testsIntent) return results;

  const window = opts.window != null
    ? opts.window
    : envWindow('SWEET_SEARCH_FILE_KIND_WINDOW', DEFAULT_WINDOW);
  const windowSize = Math.min(window, results.length);

  // Per-call file-kind cache: detectFileKind is invoked for every result
  // here AND inside isTestChunk → the same file path can be classified
  // many times in one applyFileKindRanking + applyResultDemotions pass.
  // Caller may pass opts._fileKindCache to share with the demotion sites.
  const fileKindOpts = opts._fileKindCache instanceof Map
    ? opts
    : { ...opts, _fileKindCache: new Map() };

  // Walk the window once: classify kinds and check for competition.
  const kinds = new Array(windowSize);
  let demotableCount = 0;
  let implCount = 0;
  for (let i = 0; i < windowSize; i++) {
    const k = detectFileKind(resolveFilePath(results[i]), fileKindOpts);
    kinds[i] = k;
    if (k === 'docs' || k === 'examples' || k === 'tests' || k === 'types' || k === 'ancillary') demotableCount++;
    else if (k === 'implementation') implCount++;
  }

  // Structural skip: nothing to demote, or nothing to promote.
  if (testsIntent ? !kinds.slice(0, windowSize).includes('tests') : (demotableCount === 0 || implCount === 0)) return results;

  const factor = envFactor('SWEET_SEARCH_FILE_KIND_FACTOR', DEFAULT_FACTOR);
  const docFactor  = opts.docFactor  != null ? opts.docFactor  : factor;
  const exampleFactor = opts.exampleFactor != null ? opts.exampleFactor : docFactor;
  const testFactor = opts.testFactor != null ? opts.testFactor : factor;
  const typeFactor = opts.typeFactor != null ? opts.typeFactor : factor;
  const ancillaryFactor = opts.ancillaryFactor != null ? opts.ancillaryFactor : factor;
  const tinyAncillaryFactor = opts.tinyAncillaryFactor != null
    ? opts.tinyAncillaryFactor
    : ancillaryFactor;
  const tinyLineThreshold = opts.tinyLineThreshold != null ? opts.tinyLineThreshold : 3;

  const reranked = new Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    const r = results[i];
    const kind = kinds[i];
    let mult = 1;
    if (kind === 'docs')  mult = docFactor;
    else if (kind === 'examples') mult = exampleFactor;
    else if (kind === 'tests') mult = testsIntent ? 1 : testFactor;
    else if (kind === 'implementation' && testsIntent) mult = TESTS_INTENT_IMPL_FACTOR;
    else if (kind === 'types') mult = typeFactor;
    else if (kind === 'ancillary') {
      const lineCount = inferLineCount(r);
      mult = lineCount <= tinyLineThreshold
        ? Math.min(ancillaryFactor, tinyAncillaryFactor)
        : ancillaryFactor;
    }
    const baseScore = (typeof r.score === 'number') ? r.score : 0;
    reranked[i] = {
      ...r,
      _fileKindOrigScore: baseScore,
      _fileKindMult: mult,
      _fileKindKind: kind,
      _fileKindOrigIndex: i,
      score: baseScore * mult,
    };
  }

  // Stable sort: descending score, tie-break on original index.
  reranked.sort((a, b) => {
    const d = (b.score || 0) - (a.score || 0);
    return d !== 0 ? d : a._fileKindOrigIndex - b._fileKindOrigIndex;
  });

  for (const r of reranked) delete r._fileKindOrigIndex;

  // Concatenate unchanged tail. The cascade's CE/MaxSim score-scale
  // boundary typically lives near rank `ceTopK`, so leaving rank
  // `windowSize`+ untouched contains the damage from any cross-scale
  // re-sort that might happen inside the window.
  if (windowSize === results.length) return reranked;
  return reranked.concat(results.slice(windowSize));
}
