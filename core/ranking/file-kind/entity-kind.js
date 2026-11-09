// Infers the entity kind of a result (code-graph lookups, text fallback) and scores kind and name preference.

import { normalizeType, resolveFilePath, resolveResultName, resolveResultText, resolveResultType } from './result-fields.js';
import { ENTITY_KIND_KEYWORDS, splitIdentifierName } from './query-analysis.js';
import { envFloat } from './env-tuning.js';

export function resolveEntityKindInfo(r, opts = {}) {
  const file = resolveFilePath(r);
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
  // Invoked 4-7x per result by different multipliers: ~100 results = 400-1400 SQLite round-trips uncached.
  const cache = opts._entityKindCache;
  let cacheKey = null;
  if (cache && file && Number.isFinite(start)) {
    cacheKey = `${file}|${start}|${Number.isFinite(end) ? end : start}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
  }
  let result = null;
  if (opts.codeGraphRepo && file && Number.isFinite(start)) {
    try {
      const entity = opts.codeGraphRepo.findEnclosingEntity(file, start, Number.isFinite(end) ? end : start)
        || opts.codeGraphRepo.findEnclosingEntity(file, start, start);
      if (entity?.type) {
        result = entity;
      } else if (typeof opts.codeGraphRepo.findFirstEntityInRange === 'function' && Number.isFinite(end)) {
        const first = opts.codeGraphRepo.findFirstEntityInRange(file, start, end);
        if (first?.type) result = first;
      }
    } catch {
    }
  }
  if (!result) {
    const inferred = inferEntityKindFromText(resolveResultText(r, opts));
    result = inferred ? { type: inferred } : null;
  }
  if (cacheKey) cache.set(cacheKey, result);
  return result;
}

// Entity kinds that group declarations: C++/C#/TS `namespace`, Ruby/Elixir
// `module`, `package`. The tightest entity that encloses a chunk is often one
// of these (the chunker starts a class-header chunk on the `namespace x {`
// line), and adopting it labelled drogon's HttpViewData.h:29-50 class header
// `[namespace: drogon]` and widened it to the 147-line namespace.
export const NAMESPACE_ENTITY_KINDS = new Set(['namespace', 'module', 'package']);
// A `namespace` never declares behaviour itself. A `module` can be the real
// unit (Ruby mixin, Elixir defmodule), so only a type inside it outranks it.
const PURE_NAMESPACE_KINDS = new Set(['namespace', 'package']);
const TYPE_ENTITY_KINDS = new Set([
  'class', 'struct', 'interface', 'trait', 'enum', 'record', 'object', 'protocol',
  'union', 'actor', 'impl', 'extension', 'mixin', 'typealias', 'type',
]);
const CALLABLE_ENTITY_KINDS = new Set([
  'function', 'method', 'constructor', 'arrowfunction', 'assignedfunc',
]);
// Entities that own other declarations: a chunk inside one is not a fragment
// of one symbol, so the owner is no label for it.
const CONTAINER_ENTITY_KINDS = new Set([
  'class', 'struct', 'interface', 'trait', 'enum', 'record', 'object', 'protocol',
  'union', 'actor', 'impl', 'extension', 'mixin',
  ...NAMESPACE_ENTITY_KINDS,
]);

function entitiesStartingInChunk(r, opts) {
  const repo = opts.codeGraphRepo;
  if (!repo || typeof repo.findEntitiesInRange !== 'function') return [];
  const file = resolveFilePath(r);
  const meta = r?.metadata || {};
  const start = Number(meta.startLine ?? r?.startLine);
  const end = Number(meta.endLine ?? r?.endLine);
  if (!file || !Number.isFinite(start) || !Number.isFinite(end)) return [];
  const cache = opts._entityKindCache;
  const cacheKey = cache ? `in|${file}|${start}|${end}` : null;
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
  let rows = [];
  try { rows = repo.findEntitiesInRange(file, start, end) || []; } catch { rows = []; }
  if (cacheKey) cache.set(cacheKey, rows);
  return rows;
}

/**
 * Agent format: decide what a chunk adopts when the entity found for it
 * (tightest enclosing entity, else first entity in range) owns other
 * declarations. Adoption is a label; it must not hide the symbol the chunk
 * holds or widen the chunk to the owner's span.
 *
 *   - A namespace/module is never a range to widen to. A type inside the
 *     chunk labels it; for a pure namespace a function inside does too;
 *     otherwise the namespace stays a label only.
 *   - A chunk the chunker labelled as a named function/method keeps its own
 *     label and range (C# `77-146 method:Get14` was relabelled
 *     `[class: Store]` and widened to 5-207).
 *   - An unnamed function chunk inside a class (C++ `function:null` member
 *     chunks) takes the first function in its range as label, never the
 *     class span.
 *   - Everything else (an unlabelled fragment inside a class, a fragment of
 *     one long function) keeps the da97c273 behaviour.
 *
 * @returns {{ entity: object|null, labelOnly: boolean }}
 */
export function refineContainedAdoption(r, entity, opts) {
  const kind = normalizeType(entity?.type);
  if (!entity || !CONTAINER_ENTITY_KINDS.has(kind)) return { entity, labelOnly: false };
  const chunkType = normalizeType(resolveResultType(r));
  const chunkName = resolveResultName(r);
  const chunkIsCallable = CALLABLE_ENTITY_KINDS.has(chunkType);
  if (chunkIsCallable && chunkName) return { entity: null, labelOnly: true };
  const isNamespace = NAMESPACE_ENTITY_KINDS.has(kind);
  if (!isNamespace && !chunkIsCallable) return { entity, labelOnly: false };
  const inner = entitiesStartingInChunk(r, opts)
    .filter(e => e?.name && !NAMESPACE_ENTITY_KINDS.has(normalizeType(e.type)));
  const firstCallable = inner.find(e => CALLABLE_ENTITY_KINDS.has(normalizeType(e.type)));
  if (isNamespace) {
    const firstType = inner.find(e => TYPE_ENTITY_KINDS.has(normalizeType(e.type)));
    if (firstType) return { entity: firstType, labelOnly: true };
    if (firstCallable && PURE_NAMESPACE_KINDS.has(kind)) return { entity: firstCallable, labelOnly: true };
    return { entity, labelOnly: true };
  }
  return firstCallable ? { entity: firstCallable, labelOnly: true } : { entity: null, labelOnly: true };
}

let _kindKeywordSetKey;
let _kindKeywordSet;
function kindKeywordSet(preferred) {
  if (preferred !== _kindKeywordSetKey) {
    _kindKeywordSetKey = preferred;
    _kindKeywordSet = new Set((ENTITY_KIND_KEYWORDS[preferred] || []).map(normalizeType));
  }
  return _kindKeywordSet;
}

export function entityKindMultiplier(r, preferred, opts = {}) {
  if (!preferred) return 1;
  const kindBoost = envFloat('SWEET_SEARCH_KIND_BOOST', 1.10);
  const kindDemote = envFloat('SWEET_SEARCH_KIND_DEMOTE', 0.90);
  const wantSet = kindKeywordSet(preferred);
  const inferred = resolveEntityKindInfo(r, opts)?.type || '';
  const recorded = normalizeType(resolveResultType(r));
  const type = recorded && recorded !== 'code' && recorded !== 'chunk' ? recorded : normalizeType(inferred);
  if (wantSet.has(type) || (type === 'typealias' && preferred === 'type')) return kindBoost;
  if ((type === 'impl' || type === 'method' || type === 'function') && preferred !== 'function') return kindDemote;
  return 1;
}

export function namePrecisionMultiplier(r, preferred, nameHintsLower, opts = {}) {
  if (!preferred || nameHintsLower.size === 0) return 1;
  const exactBoost = envFloat('SWEET_SEARCH_NAME_EXACT_BOOST', 1.10);
  const substrBoost = envFloat('SWEET_SEARCH_NAME_SUBSTR_BOOST', 1.03);
  const wantSet = kindKeywordSet(preferred);
  const entityInfo = resolveEntityKindInfo(r, opts);
  const recorded = normalizeType(resolveResultType(r));
  const type = recorded && recorded !== 'code' && recorded !== 'chunk'
    ? recorded
    : normalizeType(entityInfo?.type);
  if (!wantSet.has(type) && !(type === 'typealias' && preferred === 'type')) return 1;

  const name = resolveResultName(r) || entityInfo?.name || '';
  if (!name) return 1;
  if (nameHintsLower.has(name.toLowerCase())) return exactBoost;
  const nameTokens = splitIdentifierName(name);
  for (const hint of nameHintsLower) {
    if (nameTokens.includes(hint)) return substrBoost;
  }
  return 1;
}

export function exactNamedEntityForResult(r, preferred, nameHints, nameHintsLower, opts = {}) {
  if (!opts.codeGraphRepo || !preferred || nameHintsLower.size === 0) return null;
  const file = resolveFilePath(r);
  if (!file) return null;
  const types = ENTITY_KIND_KEYWORDS[preferred] || [];
  try {
    const entities = (typeof opts.codeGraphRepo.findEntitiesByNamesCaseInsensitive === 'function'
      ? opts.codeGraphRepo.findEntitiesByNamesCaseInsensitive([...nameHintsLower], {
          types,
          limit: 16,
        })
      : opts.codeGraphRepo.findEntitiesByNames([...nameHints], {
          types,
          limit: 16,
        })) || [];
    const sameFile = entities.find(entity =>
      (entity.filePath || entity.file) === file && nameHintsLower.has(String(entity.name || '').toLowerCase())
    );
    return sameFile || null;
  } catch {
    return null;
  }
}

function inferEntityKindFromText(text) {
  if (!text) return '';
  if (/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+\w+/m.test(text)) return 'enum';
  if (/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+\w+/m.test(text)) return 'struct';
  if (/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+\w+/m.test(text)) return 'trait';
  if (/^\s*impl(?:\s*<[^>]+>)?\s+\w+/m.test(text)) return 'impl';
  if (/^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/m.test(text)) return 'class';
  if (/^\s*(?:export\s+)?interface\s+\w+/m.test(text)) return 'interface';
  if (/^\s*(?:export\s+)?type\s+\w+\s*=/m.test(text)) return 'typealias';
  return '';
}
