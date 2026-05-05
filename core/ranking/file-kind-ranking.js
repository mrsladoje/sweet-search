import { readFileSync } from 'fs';
import path from 'path';

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

const DOCS_RE  = /\.md$|\.mdx$|\.rst$|(?:^|\/)docs?\//i;
const EXAMPLES_RE = /(?:^|\/)examples?\//i;
const TESTS_RE = /(?:^|\/)tests?\/|(?:^|\/)spec\/|\.test\.[a-z0-9]+$|_test\.[a-z0-9]+$|\.spec\.[a-z0-9]+$|_spec\.[a-z0-9]+$/i;
const TYPES_RE = /\.d\.ts$|(?:^|\/)types\//i;
const ANCILLARY_RE = /(?:^|\/)\.(?:github|gitlab|circleci|vscode|cursor)\/|(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|Gemfile\.lock)$|\.(?:ya?ml|jsonc?|toml|ini|cfg|conf|lock|xml|csv)$/i;
const DECLARATION_RE = /\b(function|class|struct|interface|enum|trait|fn\s+\w+|def\s+\w+|const\s+k[A-Z])\b|\btype\s+\w+\s*=/;

const ENTITY_KIND_KEYWORDS = {
  enum: ['enum'],
  struct: ['struct'],
  interface: ['interface', 'trait'],
  trait: ['trait'],
  class: ['class'],
  type: ['type', 'typeAlias', 'enum', 'struct', 'trait', 'class', 'interface'],
};

// Strong implementation-seeking signals. A query that fires one of these is
// confidently asking for source code; anything else is treated as `'unknown'`.
// Curated to cover the validated guard-set queries plus common phrasings,
// without matching pure descriptive corpus prose like "Convert XML to URL List".
const IMPL_INTENT_RE = new RegExp(
  '\\b(' + [
    // English wh-questions about location/behaviour
    'where', 'what', 'how does', 'how do',
    'when',
    // Definition / implementation phrasing
    'implements?', 'implementation', 'defines?', 'definition', 'declared?',
    'decides?',
    // Code-structure nouns
    'function', 'functions', 'method', 'methods', 'class', 'classes',
    'constructor', 'module', 'library', 'crate', 'package',
    // Verbs that strongly signal a code unit
    'dispatch(?:es|er)?', 'handles?', 'handler', 'handlers',
    'bind(?:s|ing)?',
    'parses?', 'parsed', 'parser', 'parsers',
    'router?', 'routes?', 'routing',
    'redirect(?:s|ed|ing)?',
    'register(?:s|ed|ing)?',
    'builds?', 'builder', 'builders',
    'generat(?:es?|or|ors|ed|ing)',
    'creat(?:es?|or|ed|ion|ing)',
    'loads?', 'loader',
    'writes?', 'writer',
    'reads?', 'reader',
    'sends?', 'receives?',
    'computes?', 'computed',
    'encodes?', 'encoder', 'decodes?', 'decoder',
    'transforms?', 'transformer',
    'invokes?', 'calls?', 'returns?',
    'valid(?:ate|ates|ator|ation)',
    'serial(?:ize|izes|izer)', 'deserial(?:ize|izes|izer)',
    'wrap(?:s|per|ped|ping)?',
    'matchers?', 'matches?',
    'printers?', 'prints?',
    'searchers?', 'searches?',
    // Specific terms common in real-repo guard queries
    'callback', 'callbacks',
    'factory', 'factories',
    'controller', 'controllers',
    'middleware',
    'fallback', 'fallbacks',
    'entrypoint', 'entry-point', 'main',
    'init', 'initialise', 'initialize', 'initialiser', 'initializer',
    'kernel', 'engine',
    'wrapper', 'wrappers',
    'singleton',
    'factory',
    'decorator', 'decorators',
    'closure', 'closures',
  ].join('|') + ')\\b',
  'i',
);

const DOCS_INTENT_RE  = /\b(doc|docs|documentation|readme|guide|tutorial|reference|example)\b/i;
const TESTS_INTENT_RE = /\b(test|tests|spec|specs|fixture|fixtures|mock|mocks)\b/i;
const TYPES_INTENT_RE = /\b(types|interface|declaration|signature|typings|typedef)\b|\btype\s+(?:alias|declaration|definition|interface|signature)\b/i;
const ANCILLARY_INTENT_RE = /\b(config|configuration|manifest|workflow|ci|github action|labeler|toml|lockfile|package\.json)\b/i;

/**
 * Detect the file kind from a result path.
 * @returns {'docs'|'examples'|'tests'|'types'|'ancillary'|'implementation'}
 */
export function detectFileKind(filePath) {
  if (!filePath || typeof filePath !== 'string') return 'implementation';
  if (DOCS_RE.test(filePath))  return 'docs';
  if (EXAMPLES_RE.test(filePath)) return 'examples';
  if (TESTS_RE.test(filePath)) return 'tests';
  if (TYPES_RE.test(filePath)) return 'types';
  if (ANCILLARY_RE.test(filePath)) return 'ancillary';
  return 'implementation';
}

/**
 * Detect file-kind intent of a query along the docs/tests/types/implementation
 * axis. Conservative: a query with no implementation-seeking signal returns
 * `'unknown'`, and the helper treats `'unknown'` as a no-op (just like the
 * docs/tests/types intents).
 *
 * @returns {'docs'|'tests'|'types'|'ancillary'|'implementation'|'unknown'}
 */
export function classifyFileKindIntent(query) {
  const q = (query || '').toLowerCase();
  if (!q) return 'unknown';
  // Type-seeking trumps test-seeking when both fire (existing convention).
  if (TYPES_INTENT_RE.test(q)) return 'types';
  if (DOCS_INTENT_RE.test(q))  return 'docs';
  if (TESTS_INTENT_RE.test(q)) return 'tests';
  if (ANCILLARY_INTENT_RE.test(q)) return 'ancillary';
  if (IMPL_INTENT_RE.test(q))  return 'implementation';
  return 'unknown';
}

function resolveFilePath(r) {
  return r?.file
    || r?.file_path
    || r?.path
    || r?.metadata?.file
    || r?.metadata?.file_path
    || r?.metadata?.path
    || '';
}

function inferLineCount(r) {
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line;
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return end - start + 1;
  }

  const text = r?.text || r?.content || r?.code || r?.snippet || '';
  if (typeof text === 'string' && text.length > 0) {
    return text.split(/\r?\n/).length;
  }

  return Infinity;
}

function readResultSpan(r, opts = {}) {
  if (!opts.projectRoot) return '';
  const file = resolveFilePath(r);
  if (!file) return '';
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  try {
    const abs = path.resolve(opts.projectRoot, file);
    const root = path.resolve(opts.projectRoot);
    if (abs !== root && !abs.startsWith(root + path.sep)) return '';
    const lines = readFileSync(abs, 'utf8').split('\n');
    const contextStart = Math.max(1, start - 2);
    return lines.slice(contextStart - 1, end).join('\n');
  } catch {
    return '';
  }
}

function resolveResultText(r, opts = {}) {
  return r?.content || r?.text || r?.code || r?.snippet || readResultSpan(r, opts);
}

function resolveResultName(r) {
  return r?.metadata?.name || r?.name || '';
}

function resolveResultType(r) {
  return r?.metadata?.type || r?.type || '';
}

function normalizeType(type) {
  return String(type || '').toLowerCase();
}

function hasAblation(ablations, name) {
  return ablations instanceof Set ? ablations.has(name) : Array.isArray(ablations) && ablations.includes(name);
}

export function isTinyAncillaryChunk(r, opts = {}) {
  const lineCount = inferLineCount(r);
  if (lineCount > 4) return false;

  const text = resolveResultText(r, opts);
  if (DECLARATION_RE.test(text)) return false;
  if (/\bmodule\.exports\b|\bexports\.\w+\b/.test(text)) return true;

  const compact = text.replace(/\s+/g, '');
  if (compact.length > 30) return false;
  return true;
}

export function isTestChunk(r, opts = {}) {
  const fileKind = detectFileKind(resolveFilePath(r));
  if (fileKind === 'tests') return true;

  const text = resolveResultText(r, opts);
  if (/^\s*#\[(cfg\s*\(\s*test\s*\)|test)\]/m.test(text)) return true;
  if (/^\s*func\s+Test[A-Z]/m.test(text)) return true;
  if (/^\s*def\s+test_/m.test(text)) return true;
  if (/^\s*(it|test|describe)\s*\(\s*['"]/m.test(text)) return true;

  const name = resolveResultName(r);
  return /^(test_|Test[A-Z])|_test$/.test(name);
}

function queryTokenSet(query, queryTokens) {
  if (queryTokens instanceof Set) return queryTokens;
  if (Array.isArray(queryTokens)) return new Set(queryTokens.map(t => String(t).toLowerCase()));
  return new Set(String(query || '').toLowerCase().split(/[_\W]+/).filter(t => t.length >= 3));
}

export function testNameQueryOverlap(r, queryTokens) {
  const name = resolveResultName(r).toLowerCase();
  if (!name) return 0;
  const nameTokens = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(/[_\W]+/)
    .filter(t => t.length >= 3);
  if (nameTokens.length === 0) return 0;

  let hits = 0;
  for (const token of nameTokens) {
    if (queryTokens.has(token)) hits++;
  }
  return hits / nameTokens.length;
}

export function entityKindPreferenceFromQuery(query) {
  const q = String(query || '').toLowerCase();
  for (const [bucket, keywords] of Object.entries(ENTITY_KIND_KEYWORDS)) {
    for (const keyword of keywords) {
      if (new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'i').test(q)) return bucket;
    }
  }
  return null;
}

function resolveEntityKindInfo(r, opts = {}) {
  const file = resolveFilePath(r);
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
  if (opts.codeGraphRepo && file && Number.isFinite(start)) {
    try {
      const entity = opts.codeGraphRepo.findEnclosingEntity(file, start, Number.isFinite(end) ? end : start)
        || opts.codeGraphRepo.findEnclosingEntity(file, start, start);
      if (entity?.type) return entity;
    } catch {
      // Fall through to source-span inference.
    }
  }
  const inferred = inferEntityKindFromText(resolveResultText(r, opts));
  return inferred ? { type: inferred } : null;
}

function entityKindMultiplier(r, preferred, opts = {}) {
  if (!preferred) return 1;
  const wantSet = new Set((ENTITY_KIND_KEYWORDS[preferred] || []).map(normalizeType));
  const inferred = resolveEntityKindInfo(r, opts)?.type || '';
  const recorded = normalizeType(resolveResultType(r));
  const type = recorded && recorded !== 'code' && recorded !== 'chunk' ? recorded : normalizeType(inferred);
  if (wantSet.has(type) || (type === 'typealias' && preferred === 'type')) return 1.25;
  if ((type === 'impl' || type === 'method' || type === 'function') && preferred !== 'function') return 0.85;
  return 1;
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

/**
 * Apply content-aware result demotions/boosts before top-k truncation.
 * This catches source-local tiny footer chunks, inline test functions and
 * explicit entity-kind queries that path-only demotion cannot see.
 */
export function applyResultDemotions(results, opts = {}) {
  if (!Array.isArray(results) || results.length === 0) return results;

  const ablations = opts.ablations;
  const qTokens = queryTokenSet(opts.query || '', opts.queryTokens);
  const preferredKind = hasAblation(ablations, 'no-entity-kind-pref')
    ? null
    : entityKindPreferenceFromQuery(opts.query || '');

  let changed = false;
  const window = Math.min(opts.window ?? results.length, results.length);
  const adjusted = results.slice(0, window).map((result, index) => {
    let mult = 1;
    const details = [];

    if (!hasAblation(ablations, 'no-tiny-floor') && isTinyAncillaryChunk(result, opts)) {
      mult *= opts.tinyChunkFactor ?? 0.30;
      details.push('tiny:0.30');
    }

    if (!hasAblation(ablations, 'no-test-name-overlap') && isTestChunk(result, opts)) {
      const overlap = testNameQueryOverlap(result, qTokens);
      if (overlap >= (opts.testNameOverlapThreshold ?? 0.5)) {
        mult *= opts.testNameOverlapFactor ?? 0.40;
        details.push('test-name:0.40');
      }
    }

    const kindMult = entityKindMultiplier(result, preferredKind, opts);
    if (kindMult !== 1) {
      mult *= kindMult;
      details.push(`kind-pref:${kindMult.toFixed(2)}`);
    }

    if (mult === 1) return { ...result, _resultDemotionOrigIndex: index };
    changed = true;
    const baseScore = typeof result.score === 'number' ? result.score : 0;
    const preferredEntity = preferredKind && !hasAblation(ablations, 'no-entity-kind-pref')
      ? resolveEntityKindInfo(result, opts)
      : null;
    const preferredType = normalizeType(preferredEntity?.type);
    const shouldAdoptEntity = !!(preferredEntity?.startLine
      && preferredEntity?.endLine
      && (ENTITY_KIND_KEYWORDS[preferredKind] || []).map(normalizeType).includes(preferredType));
    const nextMetadata = shouldAdoptEntity
      ? {
          ...(result.metadata || {}),
          file: preferredEntity.file || resolveFilePath(result),
          name: preferredEntity.name || result.metadata?.name || result.name || null,
          type: preferredEntity.type,
          startLine: preferredEntity.startLine,
          endLine: preferredEntity.endLine,
        }
      : result.metadata;
    return {
      ...result,
      ...(shouldAdoptEntity ? {
        name: preferredEntity.name || result.name,
        type: preferredEntity.type,
        startLine: preferredEntity.startLine,
        endLine: preferredEntity.endLine,
      } : {}),
      ...(nextMetadata ? { metadata: nextMetadata } : {}),
      score: baseScore * mult,
      _resultDemotionOrigScore: baseScore,
      _resultDemotionMult: mult,
      _resultDemotionDetails: details,
      _resultDemotionOrigIndex: index,
    };
  });

  if (!changed) return results;

  adjusted.sort((a, b) => {
    const d = (b.score || 0) - (a.score || 0);
    return d !== 0 ? d : a._resultDemotionOrigIndex - b._resultDemotionOrigIndex;
  });
  for (const r of adjusted) delete r._resultDemotionOrigIndex;
  return window === results.length ? adjusted : adjusted.concat(results.slice(window));
}

function envOff() {
  return process.env.SWEET_SEARCH_FILE_KIND_RANKING === '0'
      || process.env.SWEET_SEARCH_FILE_KIND_RANKING === 'false';
}

function envFactor(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

function envWindow(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
export function applyFileKindRanking(results, opts = {}) {
  if (envOff()) return results;
  if (!Array.isArray(results) || results.length === 0) return results;

  const intent = opts.intent != null
    ? opts.intent
    : classifyFileKindIntent(opts.query || '');

  // Conservative gate: only confident 'implementation' intent fires.
  if (intent !== 'implementation') return results;

  const window = opts.window != null
    ? opts.window
    : envWindow('SWEET_SEARCH_FILE_KIND_WINDOW', DEFAULT_WINDOW);
  const windowSize = Math.min(window, results.length);

  // Walk the window once: classify kinds and check for competition.
  const kinds = new Array(windowSize);
  let demotableCount = 0;
  let implCount = 0;
  for (let i = 0; i < windowSize; i++) {
    const k = detectFileKind(resolveFilePath(results[i]));
    kinds[i] = k;
    if (k === 'docs' || k === 'examples' || k === 'tests' || k === 'types' || k === 'ancillary') demotableCount++;
    else if (k === 'implementation') implCount++;
  }

  // Structural skip: nothing to demote, or nothing to promote.
  if (demotableCount === 0 || implCount === 0) return results;

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
    else if (kind === 'tests') mult = testFactor;
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
