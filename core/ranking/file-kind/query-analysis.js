// Reads the query: file-kind intent, entity-kind preference, name hints, and the extractors for symbol,
// path-token and identifier mentions, with the identifier-shape heuristics they share.

const STOPWORDS = new Set([
  'and', 'are', 'does', 'for', 'from', 'how', 'into', 'is', 'the', 'this',
  'that', 'what', 'when', 'where', 'which', 'with', 'why',
]);
const LANG_KEYWORDS = new Set([
  'class', 'const', 'def', 'enum', 'fn', 'function', 'impl', 'import',
  'interface', 'let', 'package', 'pub', 'struct', 'trait', 'type', 'use',
]);

export const ENTITY_KIND_KEYWORDS = {
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
    'where', 'what', 'how does', 'how do',
    'when',
    'implements?', 'implementation', 'defines?', 'definition', 'declared?',
    'decides?',
    'function', 'functions', 'method', 'methods', 'class', 'classes',
    'constructor', 'module', 'library', 'crate', 'package',
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
 * Detect file-kind intent of a query along the docs/tests/types/implementation
 * axis. Conservative: a query with no implementation-seeking signal returns
 * `'unknown'`, and the helper treats `'unknown'` as a no-op (just like the
 * docs/tests/types intents).
 *
 * @returns {'docs'|'tests'|'types'|'ancillary'|'implementation'|'unknown'}
 */
export function classifyFileKindIntent(query, { agentFormat = false } = {}) {
  const q = (query || '').toLowerCase();
  if (!q) return 'unknown';
  // Type-seeking trumps test-seeking when both fire.
  if (TYPES_INTENT_RE.test(q)) return 'types';
  if (DOCS_INTENT_RE.test(q))  return 'docs';
  // Agent format: `tests` (which re-ranks there) only when the question asks for tests; a
  // word like spec / mock / fixture in a question about a test or mock library is not one.
  if (TESTS_INTENT_RE.test(q) && (!agentFormat || TESTS_ASK_RE.test(q))) return 'tests';
  // Agent format: a behaviour question ("how does uv sync remove packages that are not in
  // the lockfile") asks for code even when it names a config-ish noun; a question about
  // configuring something still asks for config.
  if (agentFormat && ANCILLARY_INTENT_RE.test(q) && BEHAVIOUR_QUESTION_RE.test(q) && !CONFIGURE_RE.test(q) && !CI_CONFIG_RE.test(q)) return 'implementation';
  if (ANCILLARY_INTENT_RE.test(q)) return 'ancillary';
  if (IMPL_INTENT_RE.test(q))  return 'implementation';
  if (agentFormat && AGENT_IMPL_INTENT_RE.test(q)) return 'implementation';
  return 'unknown';
}

// Agent format only (format-gated, CLAUDE.md): `how is/are X done` asks how code does
// something, as `how does/do` does (jj "how is a conflict written into the file with
// conflict markers" ranked three TOML config files above lib/src/conflicts.rs).
const TESTS_ASK_RE = /\b(?:which|what|any) (?:unit |integration |e2e )?tests?\b|\btests? (?:for|of|covering|that cover|which cover)\b|\b(?:is|are) (?:\w+ ){0,4}tested\b|\btested\b|\btest (?:file|case|suite)s?\b/;
// CI / workflow configuration is what such a question asks about, not code.
const CI_CONFIG_RE = /\b(?:ci|workflows?|github actions?|labeler|pipelines?)\b/;
const BEHAVIOUR_QUESTION_RE = /\bhow (?:does|do|is|are|can|should)\b|\bwhat happens\b|\bwhy does\b/;
const CONFIGURE_RE = /\b(?:configur\w*|config|settings?|set up|setup|enable|disable)\b/;
const AGENT_IMPL_INTENT_RE = /\bhow (?:is|are|was|were|can|should)\b/;

export function queryTokenSet(query, queryTokens) {
  if (queryTokens instanceof Set) return queryTokens;
  if (Array.isArray(queryTokens)) return new Set(queryTokens.map(t => String(t).toLowerCase()));
  return new Set(String(query || '').toLowerCase().split(/[_\W]+/).filter(t => t.length >= 3));
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

export function extractNameHints(query) {
  const tokens = String(query || '').match(/[A-Za-z_][A-Za-z0-9_]+/g) || [];
  const hints = new Set();
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (LANG_KEYWORDS.has(token)) continue;
    if (STOPWORDS.has(token.toLowerCase())) continue;
    if (/[A-Z]/.test(token) || token.length >= 4) hints.add(token);
  }
  return hints;
}

export function splitIdentifierName(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\W]+/)
    .map(s => s.toLowerCase())
    .filter(Boolean);
}

// Lazy quantifier on the prefix so the capture greedily prefers an
// identifier-like noun (buildErrorHandler) over a keyword that happens
// to also be in the trailing list (function/definition). Greedy version captured "function" for
// "show me the buildErrorHandler function definition in full",
// missing the contained-entity boost on S6-Q3. But lazy also fails on
// "show me the full Engine struct" (captures "the"/"full") — which is
// why extractSymbolDefinitionTarget tries lazy first and falls back to
// greedy when the lazy capture is a stopword.
const SYMBOL_DEFN_QUERY_RE = new RegExp(
  '\\b(?:show|give|find|describe|display|fetch|see)' +
  '(?:\\s+\\w+){0,5}?\\s+' +
  '(?:the\\s+)?' +
  '(\\w+)' +
  '(?:\\s+\\w+)?\\s+' +
  '(?:struct|enum|class|fn|function|method|trait|type|interface|impl|' +
  'definition|signature|prototype|constructor)\\b',
  'i'
);
const SYMBOL_DEFN_QUERY_RE_GREEDY = new RegExp(
  '\\b(?:show|give|find|describe|display|fetch|see)' +
  '(?:\\s+\\w+){0,5}\\s+' +
  '(?:the\\s+)?' +
  '(\\w+)' +
  '(?:\\s+\\w+)?\\s+' +
  '(?:struct|enum|class|fn|function|method|trait|type|interface|impl|' +
  'definition|signature|prototype|constructor)\\b',
  'i'
);
const SYMBOL_WHATIS_QUERY_RE = new RegExp(
  '\\bwhat\\s+(?:is|does|are)\\s+(?:the\\s+)?' +
  '(\\w+)\\s+' +
  '(?:struct|enum|class|function|method|type|trait|interface|' +
  'renderer|handler|component|service|module|controller|provider|builder)\\b',
  'i'
);
// "where is the X function/method/struct" pattern — captures probe-style queries
// like S3-Q4 "where is the Default function..." and S3-Q6 "where is the Set
// method on Context..."; without it extractSymbolDefinitionTarget returned null for these
// queries, missing the contained-entity boost.
const SYMBOL_WHERE_QUERY_RE = new RegExp(
  '\\bwhere\\s+(?:is|does)\\s+(?:the\\s+)?' +
  '(\\w+)\\s+' +
  '(?:struct|enum|class|fn|function|method|trait|type|interface|impl|' +
  'definition|signature|prototype|constructor)\\b',
  'i'
);

// Identifier-shape heuristic: code identifiers across all languages
// commonly use one of: uppercase letters (PascalCase / camelCase),
// underscores (snake_case), hyphens (kebab-case), or digits. Plain
// English adjectives / determiners ("the", "complete", "every") fall
// outside this shape. This is more principled than a curated stopword
// list — it generalizes to non-English languages, avoids removing
// real lowercase identifiers like Rust `lock` / Python `commit` (which
// stay as final-fallback when no identifier-shape candidate exists),
// and doesn't require maintaining a word list. Long-term, swap for a
// small POS classifier if false-positive identifier captures appear.
function looksLikeIdentifier(name) {
  if (!name || name.length < 3) return false;
  return /[A-Z_\-0-9]/.test(name);
}

export function extractSymbolDefinitionTarget(query) {
  if (!query || typeof query !== 'string') return null;
  const candidates = [];
  for (const re of [SYMBOL_DEFN_QUERY_RE, SYMBOL_DEFN_QUERY_RE_GREEDY, SYMBOL_WHATIS_QUERY_RE, SYMBOL_WHERE_QUERY_RE]) {
    const m = query.match(re);
    if (m && m[1] && m[1].length >= 3) candidates.push(m[1]);
  }
  if (candidates.length === 0) return null;
  // Prefer identifier-shape captures (uppercase / underscore / digit) over
  // plain lowercase English captures. Falls back to first capture if no
  // identifier-shape candidate found (catches lowercase identifiers like
  // Rust `lock` or Python `commit`).
  const idShape = candidates.find(looksLikeIdentifier);
  return idShape || candidates[0];
}

/**
 * Strict identifier-shape filter for query-token-to-symbol-name matching.
 *
 * Distinguishes "code identifier" from "English word that happens to start
 * uppercase". A token is strict-identifier-shaped if it is ≥4 chars AND
 * has one of:
 *   - digit (Vec128, AVX2, std::int32_t)
 *   - underscore (HWY_DLLEXPORT, snake_case_thing, _Alignas)
 *   - internal uppercase beyond the first character (FunctionCache,
 *     AlignedDeleter, DetectTargets — true camelCase / PascalCase)
 *
 * This excludes single-cap English nouns: "Type", "Class", "Vector", "Map",
 * "Set", "Function", "Method", "Method", "Component" — none have a digit,
 * underscore, or internal uppercase, so they fail the structural check.
 * Excludes 3-char tokens like "SSE", "x86", "AVX" — these are domain
 * acronyms that risk false-matching unrelated short symbols. The 1.15× boost
 * trades off vs the 1.30× of the verb-anchored extractor: lower precision,
 * higher recall on noun-anchored probe queries.
 */
export function looksLikeStrictIdentifier(token) {
  if (!token || token.length < 4) return false;
  if (/\d/.test(token)) return true;
  if (/_/.test(token)) return true;
  // `^.[a-z0-9]*[A-Z]` is too permissive (matches XYz). Require any
  // upper at position ≥1 (so "Aa" doesn't trigger but "AaA" does).
  for (let i = 1; i < token.length; i++) {
    if (token[i] >= 'A' && token[i] <= 'Z') return true;
  }
  return false;
}

/**
 * Extract strict-identifier-shaped tokens from a query. Used by
 * identifierMentionBoost as a complement to extractSymbolDefinitionTarget:
 * the verb-anchored extractor catches "show me X struct" patterns; this
 * noun-anchored extractor catches "X with Y characteristic" probe-style
 * phrasings ("Vec128 SSE vector class template", "AlignedDeleter RAII class",
 * "FunctionCache template struct").
 *
 * Returns a Set of tokens. Returns null if no strict-identifier tokens found.
 */
export function extractIdentifierMentions(query) {
  if (!query || typeof query !== 'string') return null;
  const mentions = new Set();
  // Preserve leading `$` so identifiers like `$ZodType` /
  // `$ZodTypeInternals` (zod v4/core public-API convention — structural
  // interfaces are $-prefixed while runtime classes are not) round-trip
  // through tokenization. Mirrors F10's fix for the F9 path (line ~1944)
  // — the same parser inconsistency caused identifier-mention boost to
  // fire on wrong chunks (v3/types.ts::ZodType) while missing the right
  // chunk (v4/core/schemas.ts containing the $-prefixed entity). Path 2
  // (`findEntityWithNameInRange`) is case-insensitive on `_`/`-` but NOT
  // on `$`, so the mention must preserve the `$` to find the entity.
  const tokens = query.match(/\$?[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
  for (const tok of tokens) {
    if (looksLikeStrictIdentifier(tok)) mentions.add(tok);
  }
  // Also capture dotted compound identifiers. Lua (`tablex.deepcopy`),
  // Python (`os.path.exists`), and Ruby's `Module.method` style produce
  // code-graph entity names with embedded `.` — the single-token extractor
  // splits these into `tablex` / `deepcopy`, which then never matches the
  // chunk's actual entity name verbatim. The dotted form bypasses
  // `looksLikeStrictIdentifier` because a `a.b` shape is inherently
  // identifier-like (no English word contains a `.`).
  const dotted = query.match(/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/g) || [];
  for (const tok of dotted) mentions.add(tok);
  return mentions.size > 0 ? mentions : null;
}

/**
 * Mild symbol-name boost triggered by strict-identifier mentions in the
 * query (complement to symbolExactMatchBoost which uses the verb-anchored
 * `extractSymbolDefinitionTarget`). Same BM25F field-weighted principle:
 * when the query explicitly names an identifier, prefer chunks whose
 * symbol matches that name.
 *
 * Calibrated lower (×1.15 default vs ×1.30 for the verb path) because the
 * noun-anchored trigger has lower precision: a query mentioning "Vec128"
 * may or may not be asking about that specific symbol. Verb-anchored
 * queries like "show me X struct" are unambiguous; noun-anchored mentions
 * are weaker signals.
 *
 * Skips the verb-anchored target to avoid double-counting: if
 * extractSymbolDefinitionTarget already returned "FunctionCache" and the
 * symbol matches that, symbolExactMatchBoost handles it; this boost
 * only fires on DIFFERENT mentions, or on mentions where the verb path
 * did not fire (target was null).
 *
 * Format-gated via the caller (only fires when isAgentFormat=true).
 */
// Light stem for comparing name words with query words: `symbols`/`symbol`, `parsed`/`parse`.
export const spellStem = (w) => w.toLowerCase().replace(/(?:ing|ed|es|s|e)$/, '');

/** Stemmed non-stopword words of the query, or null when there are fewer than two. */
export function querySpellingWords(query) {
  const words = (String(query).match(/[A-Za-z]+/g) || [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase())).map(spellStem);
  return words.length >= 2 ? new Set(words) : null;
}

/**
 * Path-token boost (60-probe diagnosis).
 *
 * When a query mentions a crate / module / package name (e.g. "in globset",
 * "in render package", "from binding/json"), boost candidates whose file
 * path contains that token. Same Sourcegraph BM25F principle as the
 * symbol boost: filename matches are a strong field-level signal that
 * dense embedding alone underweights.
 *
 * SOTA: BM25F filename field weighting (Sourcegraph "Keeping it boring..."
 * April 2025). Quote: "we should be able to use these indexes to reward
 * symbol and FILENAME matches... think of contents, symbols, and filenames
 * as different 'fields' within a file."
 *
 * Diagnosed cases (60-probe new-set #4): ripgrep S6-Q8 (two `Glob` structs
 * in different crates — symbol-exact alone CANNOT disambiguate; the query
 * said "in globset" so paths containing /globset/ should win).
 *
 * Trigger pattern: extract bare path-like tokens after a path preposition
 *   /\b(?:in|from|inside|under|within)\s+(\w[\w/-]*)\b/gi
 *
 * Only fires on tokens of length ≥ 4 (avoid trivial "in"/"on") and not
 * common English stopwords. Boost: 1.20× when path contains the token
 * (case-insensitive substring match on the path string). Mild magnitude
 * because path tokens are softer signals than symbol-exact matches.
 *
 * Override env: SWEET_SEARCH_PATH_TOKEN_BOOST (default 1.20). Disable
 * with `ablations: ['no-path-token-boost']`.
 */
const PATH_TOKEN_QUERY_RE = /\b(?:in|from|inside|under|within|of)\s+([a-z][\w-]*(?:[\/-][\w-]+)*)\b/gi;
const PATH_TOKEN_STOPWORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'them', 'their', 'they',
  'when', 'while', 'where', 'with', 'without', 'have', 'been', 'each',
  'and', 'but', 'for', 'all', 'any', 'some', 'can', 'will', 'would',
  'fact', 'case', 'order', 'time', 'turn', 'fact',
]);

export function extractPathTokens(query) {
  if (!query || typeof query !== 'string') return [];
  const tokens = [];
  let m;
  PATH_TOKEN_QUERY_RE.lastIndex = 0;
  while ((m = PATH_TOKEN_QUERY_RE.exec(query)) !== null) {
    const tok = m[1];
    if (!tok || tok.length < 4) continue;
    if (PATH_TOKEN_STOPWORDS.has(tok.toLowerCase())) continue;
    tokens.push(tok.toLowerCase());
  }
  return tokens;
}
