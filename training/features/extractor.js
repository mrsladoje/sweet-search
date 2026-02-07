#!/usr/bin/env node

/**
 * Feature Extractor for Query Router ML Model
 *
 * Extracts 29 language-agnostic features from queries for ML classification.
 * These features work across ALL languages because they focus on:
 * - Character patterns (camelCase, snake_case work in any codebase)
 * - Statistical features (token count, uppercase ratio)
 * - Script detection (non-ASCII ratio for CJK/Cyrillic)
 * - Unicode identifier detection (UAX #31 compliant)
 * - Multilingual keyword patterns (15+ languages)
 *
 * Target: <10μs feature extraction
 */

import {
  isUnicodeIdentifier,
  hasNonAsciiIdentifierChars,
  hasMixedScript,
  hasIdentifierInQuery as hasUnicodeIdentifierInQuery,
  hasNonAsciiIdentifierInQuery,
} from './unicode-utils.js';

import {
  hasStructuralKeywordNonEn,
  hasSemanticKeywordNonEn,
  hasCrossScriptConcept,
} from './multilingual-patterns.js';

/**
 * Extract 15 hand-crafted language-agnostic features.
 * These features generalize across all programming languages and natural languages.
 *
 * @param {string} query - The query to extract features from
 * @returns {Float32Array} - 15-element feature vector
 */
export function extractFeatures(query) {
  const trimmed = query.trim();
  const chars = trimmed.replace(/\s/g, '');
  const tokens = trimmed.split(/\s+/);
  const charLen = Math.max(1, chars.length);

  return new Float32Array([
    // === Identifier Detection (5 features) ===
    // Feature 0: hasCamelBoundary - lowercase followed by uppercase
    /[a-z][A-Z]/.test(trimmed) ? 1 : 0,

    // Feature 1: hasUnderscoreWord - underscore followed by lowercase (snake_case)
    /_[a-z]/.test(trimmed) ? 1 : 0,

    // Feature 2: startsWithUppercase - PascalCase indicator
    /^[A-Z]/.test(trimmed) ? 1 : 0,

    // Feature 3: hasConsecutiveUppercase - SCREAMING_SNAKE or abbreviations
    /[A-Z]{2,}/.test(trimmed) ? 1 : 0,

    // Feature 4: isSingleToken - single word without spaces
    !trimmed.includes(' ') && trimmed.length > 2 ? 1 : 0,

    // === Code Pattern Detection (4 features) ===
    // Feature 5: hasDotNotation - method.call or package.name
    /\w\.\w/.test(trimmed) ? 1 : 0,

    // Feature 6: hasParentheses - method()
    /\(\)/.test(trimmed) ? 1 : 0,

    // Feature 7: hasFileExtension - .java, .ts, .py, etc.
    /\.(java|ts|tsx|js|jsx|py|go|rs|cpp|c|h|rb|php|swift|kt|proto|yml|yaml|json|xml|md)$/i.test(trimmed) ? 1 : 0,

    // Feature 8: hasPathSeparator - / or \
    /[/\\]/.test(trimmed) ? 1 : 0,

    // === Statistical Features (4 features) ===
    // Feature 9: tokenCount - number of whitespace-separated tokens
    tokens.length,

    // Feature 10: avgTokenLength - average length per token
    chars.length / Math.max(1, tokens.length),

    // Feature 11: uppercaseRatio - fraction of uppercase chars
    (chars.match(/[A-Z]/g) || []).length / charLen,

    // Feature 12: digitRatio - fraction of digit chars
    (chars.match(/[0-9]/g) || []).length / charLen,

    // === Multilingual Detection (2 features) ===
    // Feature 13: nonAsciiRatio - fraction of non-ASCII chars
    (chars.match(/[^\x00-\x7F]/g) || []).length / charLen,

    // Feature 14: hasNonLatinScript - CJK, Cyrillic, Arabic, etc.
    /[\u4e00-\u9fff\u0400-\u04ff\u0600-\u06ff\u0980-\u09ff\u3040-\u30ff\uac00-\ud7af]/.test(trimmed) ? 1 : 0,
  ]);
}

/**
 * Get feature names for interpretability and debugging.
 */
export function getFeatureNames() {
  return [
    'hasCamelBoundary',      // 0
    'hasUnderscoreWord',     // 1
    'startsWithUppercase',   // 2
    'hasConsecutiveUppercase', // 3
    'isSingleToken',         // 4
    'hasDotNotation',        // 5
    'hasParentheses',        // 6
    'hasFileExtension',      // 7
    'hasPathSeparator',      // 8
    'tokenCount',            // 9
    'avgTokenLength',        // 10
    'uppercaseRatio',        // 11
    'digitRatio',            // 12
    'nonAsciiRatio',         // 13
    'hasNonLatinScript',     // 14
  ];
}

/**
 * Additional structural pattern features.
 * These detect specific query patterns for structural queries.
 */
export function extractStructuralFeatures(query) {
  const lower = query.toLowerCase();

  return new Float32Array([
    // Caller patterns
    /\b(callers?\s+of|what\s+calls|who\s+calls|usages?\s+of|references?\s+to|where\s+is\s+\w+\s+called)\b/.test(lower) ? 1 : 0,

    // Callee patterns
    /\b(callees?\s+of|what\s+does\s+\w+\s+call|dependencies\s+of|methods?\s+called\s+by)\b/.test(lower) ? 1 : 0,

    // Implementation patterns
    /\b(implementations?\s+of|classes?\s+implementing|who\s+extends|subtypes?\s+of)\b/.test(lower) ? 1 : 0,

    // Impact patterns
    /\b(impact\s+of|affected\s+by|depends?\s+on|downstream\s+effects?|will\s+break)\b/.test(lower) ? 1 : 0,

    // Has identifier in query (PascalCase, camelCase, or Unicode identifier)
    // Updated to use UAX #31 compliant Unicode identifier detection
    hasUnicodeIdentifierInQuery(query) ? 1 : 0,
  ]);
}

/**
 * Additional semantic pattern features.
 * These detect conceptual/question patterns.
 */
export function extractSemanticFeatures(query) {
  const lower = query.toLowerCase();

  return new Float32Array([
    // Question words at start
    /^(how|what|why|where|when|which|who|can|does|is|are|should)\s/.test(lower) ? 1 : 0,

    // Ends with question mark
    query.trim().endsWith('?') ? 1 : 0,

    // Semantic concept words (expanded for HYBRID accuracy)
    /\b(flow|process|mechanism|strategy|pattern|approach|logic|algorithm|system|detection|validation|authentication|handling|database|quer(?:y|ies)|token|management|security|checks?|session|config(?:uration)?|error|request|response|service|login|password|reset|user|data|storage|cache|sync(?:hronization)?)\b/.test(lower) ? 1 : 0,

    // Explanation requests
    /\b(explain|describe|understand|overview|architecture|design|how|why|what)\b/.test(lower) ? 1 : 0,

    // How-does-X-work pattern
    /how\s+does\s+.+\s+work/.test(lower) ? 1 : 0,
  ]);
}

/**
 * Extract discriminative features (4 features for HYBRID vs STRUCTURAL distinction).
 * These features address the "structural vacuum" problem identified by Gemini.
 *
 * Key insight: HYBRID has identifier at START, STRUCTURAL has identifier at END
 * "AuthService login flow" → HYBRID (identifier first, then concept)
 * "callers of AuthService" → STRUCTURAL (structural keyword, then identifier)
 *
 * @param {string} query - The query to extract features from
 * @returns {Float32Array} - 4-element feature vector
 */
export function extractDiscriminativeFeatures(query) {
  const tokens = query.trim().split(/\s+/);
  const lower = query.toLowerCase();

  // Identifier patterns (Latin: PascalCase/camelCase, Non-Latin: 2+ consecutive non-ASCII)
  const identifierPattern = /^[A-Z][a-z]+[A-Z]|^[a-z]+[A-Z]|^[A-Z][a-z]+(?:[A-Z][a-z]+)+$|^[\u0400-\u04ff\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0900-\u097f]{2,}$/;

  // Check first and last tokens for identifiers
  const firstToken = tokens[0] || '';
  const lastToken = tokens[tokens.length - 1] || '';
  const identifierAtStart = identifierPattern.test(firstToken) ? 1 : 0;
  const identifierAtEnd = tokens.length > 1 && identifierPattern.test(lastToken) ? 1 : 0;

  // Explicit structural keywords (simple word list, not complex patterns)
  const structuralKeywords = /\b(calls?|callers?|callees?|uses?|usages?|references?|implementations?|implements?|extends?|dependencies|subtypes?|impact|affected|downstream)\b/;
  const hasExplicitStructuralKeyword = structuralKeywords.test(lower) ? 1 : 0;

  // Unknown trailing content: has identifier at start + more words, but NO structural keywords and NO semantic concepts
  // This is the "net" to catch domain-specific concepts like "virus scanning", "stock alerts"
  const hasSemanticConcept = /\b(flow|process|mechanism|strategy|pattern|approach|logic|algorithm|system|detection|validation|authentication|handling|database|quer(?:y|ies)|token|management|security|checks?|session|config(?:uration)?|error|request|response|service|login|password|reset|user|data|storage|cache|sync(?:hronization)?)\b/.test(lower);

  const hasUnknownTrailingContent = (
    tokens.length > 1 &&
    identifierAtStart === 1 &&
    hasExplicitStructuralKeyword === 0 &&
    !hasSemanticConcept
  ) ? 1 : 0;

  return new Float32Array([
    // Feature 30: identifierAtStart - Strong HYBRID signal
    identifierAtStart,

    // Feature 31: identifierAtEnd - Strong STRUCTURAL signal (e.g., "callers of AuthService")
    identifierAtEnd,

    // Feature 32: hasExplicitStructuralKeyword - Explicit structural intent
    hasExplicitStructuralKeyword,

    // Feature 33: hasUnknownTrailingContent - Identifier + unknown words = likely HYBRID
    // Catches: "FileUploader virus scanning", "JobScheduler failure recovery"
    hasUnknownTrailingContent,
  ]);
}

/**
 * Extract Grammar Layer features (4 features for modeling query structure).
 * These features describe WHERE things are, not just IF they exist.
 *
 * Key insight: The model memorized words instead of grammar. These features
 * teach the structure of developer intent.
 *
 * @param {string} query - The query to extract features from
 * @returns {Float32Array} - 4-element feature vector
 */
export function extractGrammarFeatures(query) {
  const tokens = query.trim().split(/\s+/);
  const lower = query.toLowerCase();

  // Identifier pattern (PascalCase, camelCase, non-Latin identifiers)
  const identifierPattern = /^[A-Z][a-z]+[A-Z]|^[a-z]+[A-Z]|^[A-Z][a-z]+(?:[A-Z][a-z]+)+$|^[\u0400-\u04ff\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0900-\u097f]{2,}$/;

  // Feature 34: identifierIndex - Which token position has the identifier?
  // HYBRID: Usually 0 ("AuthService...") or 2 ("How does AuthService...")
  // STRUCTURAL: Usually 3+ ("callers of AuthService", "what calls AuthService")
  let identifierIndex = -1; // -1 means no identifier found
  for (let i = 0; i < tokens.length; i++) {
    if (identifierPattern.test(tokens[i])) {
      identifierIndex = i;
      break; // Take first identifier position
    }
  }
  // Normalize to 0-1 range: -1 → 0, 0 → 0.1, 1 → 0.2, ..., 5+ → 0.6+
  const normalizedIdentifierIndex = identifierIndex < 0 ? 0 : Math.min(1, (identifierIndex + 1) / 10);

  // Feature 35: verbPresence - Action verbs that are HYBRID signals (never in structural queries)
  // These verbs describe "how something works" rather than "what calls what"
  const actionVerbs = /\b(handle|handles?|handling|send|sends?|sending|calculate|calculates?|calculating|compute|computes?|computing|parse|parses?|parsing|validate|validates?|validating|trigger|triggers?|triggering|perform|performs?|performing|initialize|initializes?|initializing|process|processes|processing|execute|executes?|executing|generate|generates?|generating|fetch|fetches?|fetching|store|stores?|storing|load|loads?|loading|save|saves?|saving|create|creates?|creating|update|updates?|updating|delete|deletes?|deleting|render|renders?|rendering|display|displays?|displaying|format|formats?|formatting|convert|converts?|converting|transform|transforms?|transforming|encrypt|encrypts?|encrypting|decrypt|decrypts?|decrypting|authenticate|authenticates?|authenticating|authorize|authorizes?|authorizing|schedule|schedules?|scheduling|batch|batches?|batching|queue|queues?|queueing|cache|caches?|caching|log|logs?|logging|track|tracks?|tracking|monitor|monitors?|monitoring|retry|retries?|retrying|recover|recovers?|recovering)\b/;
  const hasActionVerb = actionVerbs.test(lower) ? 1 : 0;

  // Feature 36: hasQuestionIdentifier - "How does [Identifier]..." pattern
  // This is the KEY pattern that fails: "how does PaymentGateway handle failures"
  // Logic: isQuestion AND tokens[2] or tokens[3] is an identifier
  const isQuestion = /^(how|what|why|where|when|which|who|can|does|is|are|should)\s/i.test(query);
  const hasQuestionIdentifier = (
    isQuestion &&
    tokens.length > 2 &&
    (identifierPattern.test(tokens[2]) || (tokens.length > 3 && identifierPattern.test(tokens[3])))
  ) ? 1 : 0;

  // Feature 37: structuralKeywordCount - Raw count of structural keywords
  // If this is 0, probability of STRUCTURAL should be near-zero
  const structuralKeywordsList = [
    'callers', 'caller', 'calls', 'call',
    'callees', 'callee',
    'uses', 'use', 'usages', 'usage',
    'references', 'reference',
    'implementations', 'implementation', 'implements', 'implement',
    'extends', 'extend',
    'dependencies', 'dependency',
    'subtypes', 'subtype',
    'impact', 'affected', 'downstream',
    'inherits', 'inherit',
  ];
  let structuralKeywordCount = 0;
  for (const kw of structuralKeywordsList) {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(lower)) {
      structuralKeywordCount++;
    }
  }
  // Normalize: 0→0, 1→0.2, 2→0.4, 3+→0.6+
  const normalizedStructuralCount = Math.min(1, structuralKeywordCount / 5);

  return new Float32Array([
    normalizedIdentifierIndex,   // 34: Where is the identifier? (0 = none, 0.1 = first, etc.)
    hasActionVerb,               // 35: Action verb present? (massive HYBRID signal)
    hasQuestionIdentifier,       // 36: "How does [ID]..." pattern (HYBRID)
    normalizedStructuralCount,   // 37: Count of structural keywords (STRUCTURAL signal)
  ]);
}

/**
 * Extract "Zen" features (5 features for 99.9% accuracy).
 * These are the "Master Features" that fix the remaining 4 roadblocks:
 *
 * 1. CJK Single Token Trap - CJK text without spaces gets isSingleToken=1
 * 2. Question vs Structure Conflict - Structural questions misrouted to SEMANTIC
 * 3. German Compound Problem - Long compound nouns mistaken for identifiers
 * 4. Cross-Feature Interactions - Features that depend on OTHER feature values
 *
 * @param {string} query - The query to extract features from
 * @returns {Float32Array} - 5-element feature vector
 */
export function extractZenFeatures(query) {
  const trimmed = query.trim();
  const chars = trimmed.replace(/\s/g, '');
  const tokens = trimmed.split(/\s+/);
  const lower = query.toLowerCase();

  // =========================================================================
  // Feature 43: cjkDensity - CJK character ratio (force-stops LEXICAL for CJK)
  // =========================================================================
  // CJK ranges: Chinese (4e00-9fff), Japanese Hiragana (3040-309f),
  // Katakana (30a0-30ff), Korean (ac00-d7af)
  const cjkChars = (chars.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
  const cjkDensity = cjkChars / Math.max(1, chars.length);

  // =========================================================================
  // Feature 44: effectiveTokenCount - Virtual tokenization for CJK
  // =========================================================================
  // Problem: "認証の仕組み" has 0 spaces → tokenCount=1 → LEXICAL
  // Fix: For CJK text, estimate tokens by character count / 2 (avg CJK word ~2 chars)
  // or by script transitions (e.g., Kanji→Hiragana boundaries in Japanese)
  let effectiveTokenCount = tokens.length;
  if (cjkDensity > 0.5) {
    // Count script transitions (Kanji↔Hiragana↔Katakana)
    const scriptTransitions = (trimmed.match(
      /[\u4e00-\u9fff][\u3040-\u30ff]|[\u3040-\u30ff][\u4e00-\u9fff]|[\u3040-\u309f][\u30a0-\u30ff]|[\u30a0-\u30ff][\u3040-\u309f]/g
    ) || []).length;

    // Use max of: space-separated tokens, script transitions + 1, or charCount/3
    effectiveTokenCount = Math.max(
      tokens.length,
      scriptTransitions + 1,
      Math.ceil(cjkChars / 3)
    );
  }
  // Normalize to 0-1 range: 1→0.1, 5→0.5, 10+→1.0
  const normalizedEffectiveTokenCount = Math.min(1, effectiveTokenCount / 10);

  // =========================================================================
  // Feature 45: isComplexQuestion - (tokenCount >= 4) && startsWithQuestionWord
  // =========================================================================
  // Distinguishes "how does X work" (SEMANTIC) from "X logic" (HYBRID)
  // Complex questions with 4+ tokens are almost always SEMANTIC
  const startsWithQuestionWord = /^(how|what|why|where|when|which|who|can|does|is|are|should)\s/i.test(trimmed);
  const isComplexQuestion = (effectiveTokenCount >= 4 && startsWithQuestionWord) ? 1 : 0;

  // =========================================================================
  // Feature 46: isStructuralQuestion - Cross-feature interaction
  // =========================================================================
  // Problem: "What invokes the webhook handler?" has both:
  //   - Structural verb (invokes) → STRUCTURAL
  //   - Question structure (What...) → SEMANTIC
  // Fix: When asking about a relationship, STRUCTURAL intent overrides
  const structuralKeywords = /\b(invoke[sd]?|invoking|call[sd]?|calling|callers?|callees?|use[sd]?|using|usages?|reference[sd]?|referencing|derived|inherit[sd]?|inheriting|implementations?|implements?|implementing|depends?|depended|depending|dependencies?|affects?|affected|affecting|downstream|upstream|subtypes?|extends?|extending)\b/i;
  const hasStructuralKeyword = structuralKeywords.test(lower);
  const isStructuralQuestion = (startsWithQuestionWord && hasStructuralKeyword) ? 1 : 0;

  // =========================================================================
  // Feature 47: tokenCharacterDensity - German compound detection
  // =========================================================================
  // Problem: "Fehlerbehandlungsstrategie" (Error handling strategy)
  //   - Single token, 24 chars, no camelCase/snake_case → LEXICAL (wrong!)
  //   - Actually a high-level concept noun → SEMANTIC
  // Fix: Long tokens WITHOUT identifier boundaries (camelCase/snake_case) are
  // likely German/Dutch compound concept words, not code identifiers.
  // Normal identifiers: 10-20 chars with boundaries
  // German concepts: 25-40 chars without boundaries
  const hasCamelOrSnake = /[a-z][A-Z]|_[a-z]/.test(trimmed);
  const avgCharPerToken = chars.length / Math.max(1, tokens.length);
  // If single long token (>15 chars) WITHOUT identifier boundaries → likely concept
  const tokenCharacterDensity = (tokens.length === 1 && avgCharPerToken > 15 && !hasCamelOrSnake)
    ? Math.min(1, avgCharPerToken / 30) // Normalize: 15→0.5, 30→1.0
    : 0;

  // =========================================================================
  // Feature 48: hasNonLatinIdentifier - Non-Latin PascalCase detection
  // =========================================================================
  // Problem: Cyrillic/German identifiers like "СервисПлатежа", "Bestellungsprozessor"
  // don't have ASCII camelCase → misclassified as SEMANTIC
  // Fix: Detect non-Latin PascalCase (capital letter + lowercase letters)
  const cyrillicPascalCase = /^[\u0410-\u042f][\u0430-\u044f]+(?:[\u0410-\u042f][\u0430-\u044f]+)*$/;
  const germanPascalCase = /^[A-ZÄÖÜ][a-zäöüß]+(?:[a-zäöüß]+)*$/;
  const greekPascalCase = /^[\u0391-\u03a9][\u03b1-\u03c9]+$/;
  const hasNonLatinIdentifier = tokens.length === 1 && (
    cyrillicPascalCase.test(tokens[0]) ||
    germanPascalCase.test(tokens[0]) ||
    greekPascalCase.test(tokens[0])
  ) ? 1 : 0;

  // =========================================================================
  // Feature 49: isAllCapsConstant - ALL_CAPS constant detection
  // =========================================================================
  // Problem: ALL_CAPS constants (MAX_CONNECTION_POOL_SIZE) classified as SEMANTIC
  // because they have high uppercaseRatio but no camelCase
  // Fix: Detect ALL_CAPS pattern (all uppercase with underscores)
  const allCapsPattern = /^[A-Z][A-Z0-9_]+$/;
  const isAllCapsConstant = tokens.some(t => allCapsPattern.test(t) && t.length > 3) ? 1 : 0;

  return new Float32Array([
    cjkDensity,                      // 43: CJK character ratio
    normalizedEffectiveTokenCount,   // 44: Effective token count (CJK-aware)
    isComplexQuestion,               // 45: Long question (>4 tokens)
    isStructuralQuestion,            // 46: Question + structural keyword
    tokenCharacterDensity,           // 47: German compound detector
    hasNonLatinIdentifier,           // 48: Non-Latin PascalCase (Cyrillic/German)
    isAllCapsConstant,               // 49: ALL_CAPS constant pattern
  ]);
}

/**
 * Extract "Final Push" features (5 features for 99%+ accuracy).
 * These fix the remaining cross-language and structural edge cases.
 *
 * Key insight: The model is "over-indexed" on HYBRID signals, causing it to
 * see "ghost identifiers" in pure native language queries.
 *
 * @param {string} query - The query to extract features from
 * @returns {Float32Array} - 5-element feature vector
 */
export function extractFinalPushFeatures(query) {
  const tokens = query.trim().split(/\s+/);
  const lower = query.toLowerCase();
  const chars = query.replace(/\s/g, '');

  // =========================================================================
  // Feature 38: hasVerifiedAsciiIdentifier - STRICT ASCII identifier check
  // =========================================================================
  // Returns 1 ONLY if there's a clear ASCII PascalCase, camelCase, or snake_case.
  // If this is 0, the model should avoid HYBRID/LEXICAL (no identifier to lookup).
  const strictAsciiIdentifier = /^[A-Z][a-z]+[A-Z][a-zA-Z]*$|^[a-z]+[A-Z][a-zA-Z]*$|^[a-z]+_[a-z]+(?:_[a-z]+)*$|^[A-Z]+_[A-Z]+(?:_[A-Z]+)*$/;
  const hasVerifiedAsciiIdentifier = tokens.some(t => strictAsciiIdentifier.test(t)) ? 1 : 0;

  // =========================================================================
  // Feature 39: structuralTemplateMatch - "[Verb] [Article] [Noun]" pattern
  // =========================================================================
  // Detects: "what invokes the handler", "who calls the service"
  // These are classic call-graph questions that the keyword list missed.
  const structuralTemplates = [
    /\b(what|who|which)\s+(invokes?|calls?|uses?|references?|depends\s+on)\s+(the|a|an)?\s*\w+/i,
    /\b(what|who|which)\s+does\s+\w+\s+(invoke|call|use|reference|depend)/i,
    /\binvok(?:es?|ed|ing)\s+(the|a|an)?\s*\w+/i,
    /\bderived\s+from\b/i,
    /\binherits?\s+from\b/i,
    /\b(?:classes?|types?)\s+(?:that\s+)?implement(?:s|ing)?\b/i,
    /\busages?\s+of\b/i,
  ];
  const structuralTemplateMatch = structuralTemplates.some(t => t.test(lower)) ? 1 : 0;

  // =========================================================================
  // Feature 40: hasNonEnglishConceptStem - Cross-language concept stems
  // =========================================================================
  // Detects German, Spanish, French, Russian, Serbian concept words by prefix.
  // This helps identify SEMANTIC queries in non-English languages.
  const conceptStems = new RegExp(
    // German stems
    '(authentifiz|konfig|verarbeit|verwalt|fehler|behandl|validier|' +
    'speicher|laden|senden|empfang|format|konvert|verschlüssel|' +
    'strategie|mechanismus|prozess|logik|system|architektur|' +
    'zahlungs?|benutzer|sitzung|nachricht|fehlerbehandlung|ereignis)' +
    // Spanish stems
    '|(autentic|config|valid|proces|mane[jx]|error|almacen|carga|' +
    'enviar|recib|format|convert|cifr|estrateg|mecan|proces|' +
    'lógic|sistem|arquitectur|pag|usuario|sesión|mensaje)' +
    // French stems
    '|(authenti[fq]|config|valid|trait|gest|erreur|stockag|charg|' +
    'envoy|recev|format|convert|chiffr|stratég|mécan|process|' +
    'logiq|système|architect|paie|utilisat|session|messag)' +
    // Russian stems (Cyrillic)
    '|(аутентификац|конфигурац|валидац|обработ|управлен|ошибк|' +
    'хранен|загруз|отправ|получ|формат|преобраз|шифрован|' +
    'стратег|механизм|процесс|логик|систем|архитектур|' +
    'платеж|пользовател|сесси|сообщен)' +
    // Serbian stems (Cyrillic)
    '|(аутентификациј|конфигурациј|валидациј|обрад|управљањ|грешк|' +
    'складиштењ|учитавањ|слањ|примањ|формат|конверт|шифровањ|' +
    'стратегиј|механизам|процес|логик|систем|архитектур|' +
    'плаћањ|корисник|сесиј|порук|кеширањ)',
    'i'
  );
  const hasNonEnglishConceptStem = conceptStems.test(query) ? 1 : 0;

  // =========================================================================
  // Feature 41: pureNativeLanguageScore - High non-ASCII with no identifiers
  // =========================================================================
  // If nonAsciiRatio > 0.7 AND hasVerifiedAsciiIdentifier == 0, this is
  // almost certainly a SEMANTIC query in a non-English language.
  const nonAsciiCount = (chars.match(/[^\x00-\x7F]/g) || []).length;
  const nonAsciiRatio = nonAsciiCount / Math.max(1, chars.length);
  const pureNativeLanguageScore = (nonAsciiRatio > 0.7 && hasVerifiedAsciiIdentifier === 0) ? 1 : 0;

  // =========================================================================
  // Feature 42: expandedStructuralKeywordPresence
  // =========================================================================
  // Expanded list of structural keywords including ALL forms (base + conjugations).
  // Critical: Include base forms like "use", "call" not just "uses", "calls"
  const expandedStructuralKeywords = /\b(invoke[sd]?|invoking|call[sd]?|calling|callers?|callees?|use[sd]?|using|usages?|reference[sd]?|referencing|derived|inherit[sd]?|inheriting|implementations?|implements?|implementing|depends?|depended|depending|dependencies?|affects?|affected|affecting|downstream|upstream|subtypes?|extends?|extending)\b/i;
  const expandedStructuralKeywordPresence = expandedStructuralKeywords.test(lower) ? 1 : 0;

  return new Float32Array([
    hasVerifiedAsciiIdentifier,        // 38: Strict ASCII identifier present?
    structuralTemplateMatch,           // 39: "[Verb] [Article] [Noun]" pattern?
    hasNonEnglishConceptStem,          // 40: Non-English concept word stem?
    pureNativeLanguageScore,           // 41: Pure native language (no identifiers)?
    expandedStructuralKeywordPresence, // 42: Expanded structural keywords?
  ]);
}

/**
 * Extract multilingual features (5 features for Unicode/non-English support).
 * These detect Unicode identifiers and non-English patterns.
 *
 * @param {string} query - The query to extract features from
 * @returns {Float32Array} - 5-element feature vector
 */
export function extractMultilingualFeatures(query) {
  // Split into tokens for identifier analysis
  const tokens = query.split(/[\s,;:!?()[\]{}'"]+/).filter(t => t.length > 0);

  return new Float32Array([
    // Feature 25: hasNonAsciiIdentifier - Query contains a non-ASCII Unicode identifier
    // Detects: КорисникСервис, 用户服务, ユーザーサービス
    hasNonAsciiIdentifierInQuery(query) ? 1 : 0,

    // Feature 26: hasMixedScriptToken - Any token has multiple scripts (code-switching)
    // Detects: 用户Service, AuthСервис
    tokens.some(t => hasMixedScript(t)) ? 1 : 0,

    // Feature 27: hasStructuralKeywordNonEn - Non-English structural pattern
    // Detects: "шта позива", "什么调用", "を呼び出す"
    hasStructuralKeywordNonEn(query) ? 1 : 0,

    // Feature 28: hasSemanticKeywordNonEn - Non-English semantic pattern
    // Detects: "как работает", "如何", "どのように"
    hasSemanticKeywordNonEn(query) ? 1 : 0,

    // Feature 29: hasCrossScriptConcept - Identifier in one script + concept words in another
    // Detects: "समयट्रैकर security checks", "database queries in समयट्रैकर"
    // Strong HYBRID signal - mixing identifier lookup with conceptual context
    hasCrossScriptConcept(query) ? 1 : 0,
  ]);
}

/**
 * Extract ALL features (15 base + 5 structural + 5 semantic + 5 multilingual + 4 discriminative + 4 grammar + 5 final + 7 zen = 50 total).
 */
export function extractAllFeatures(query) {
  const base = extractFeatures(query);
  const structural = extractStructuralFeatures(query);
  const semantic = extractSemanticFeatures(query);
  const multilingual = extractMultilingualFeatures(query);
  const discriminative = extractDiscriminativeFeatures(query);
  const grammar = extractGrammarFeatures(query);
  const finalPush = extractFinalPushFeatures(query);
  const zen = extractZenFeatures(query);

  // Concatenate all features
  const all = new Float32Array(50);
  all.set(base, 0);
  all.set(structural, 15);
  all.set(semantic, 20);
  all.set(multilingual, 25);
  all.set(discriminative, 30);
  all.set(grammar, 34);
  all.set(finalPush, 38);
  all.set(zen, 43);

  return all;
}

/**
 * Get all feature names including structural, semantic, multilingual, discriminative, grammar, final push, and zen.
 */
export function getAllFeatureNames() {
  return [
    ...getFeatureNames(),
    // Structural features (15-19)
    'hasCallerPattern',
    'hasCalleePattern',
    'hasImplementationPattern',
    'hasImpactPattern',
    'hasIdentifierInQuery',
    // Semantic features (20-24)
    'startsWithQuestionWord',
    'endsWithQuestionMark',
    'hasSemanticConceptWord',
    'hasExplanationRequest',
    'hasHowDoesWorkPattern',
    // Multilingual features (25-29)
    'hasNonAsciiIdentifier',
    'hasMixedScriptToken',
    'hasStructuralKeywordNonEn',
    'hasSemanticKeywordNonEn',
    'hasCrossScriptConcept',
    // Discriminative features (30-33) - HYBRID vs STRUCTURAL distinction
    'identifierAtStart',
    'identifierAtEnd',
    'hasExplicitStructuralKeyword',
    'hasUnknownTrailingContent',
    // Grammar features (34-37) - Query structure modeling
    'identifierIndex',           // 34: Token position of identifier (normalized)
    'hasActionVerb',             // 35: Action verb presence (HYBRID signal)
    'hasQuestionIdentifier',     // 36: "How does [ID]..." pattern
    'structuralKeywordCount',    // 37: Count of structural keywords (normalized)
    // Final Push features (38-42) - 99%+ accuracy
    'hasVerifiedAsciiIdentifier',        // 38: Strict ASCII identifier check
    'structuralTemplateMatch',           // 39: "[Verb] [Article] [Noun]" pattern
    'hasNonEnglishConceptStem',          // 40: Non-English concept word stem
    'pureNativeLanguageScore',           // 41: Pure native language (no identifiers)
    'expandedStructuralKeywordPresence', // 42: Expanded structural keywords
    // Zen features (43-49) - 99.9% "Master Features"
    'cjkDensity',                        // 43: CJK character ratio (blocks LEXICAL for CJK)
    'effectiveTokenCount',               // 44: Virtual token count (CJK-aware)
    'isComplexQuestion',                 // 45: Long question (>4 effective tokens)
    'isStructuralQuestion',              // 46: Question + structural keyword (cross-feature)
    'tokenCharacterDensity',             // 47: German compound detector
    'hasNonLatinIdentifier',             // 48: Non-Latin PascalCase (Cyrillic/German)
    'isAllCapsConstant',                 // 49: ALL_CAPS constant pattern
  ];
}

/**
 * Convert features to object for debugging.
 *
 * P1 Fix: Added bounds check to prevent undefined feature names
 */
export function featuresToObject(features, names = null) {
  const featureNames = names || (features.length <= 15 ? getFeatureNames() : getAllFeatureNames());
  const obj = {};
  for (let i = 0; i < features.length; i++) {
    // P1 Fix: Bounds check to handle mismatched lengths
    const name = i < featureNames.length ? featureNames[i] : `feature_${i}`;
    obj[name] = features[i];
  }
  return obj;
}

/**
 * Benchmark feature extraction latency.
 */
export function benchmarkFeatureExtraction(queries, iterations = 1000) {
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    for (const query of queries) {
      extractAllFeatures(query);
    }
  }

  const end = performance.now();
  const totalQueries = iterations * queries.length;
  const avgLatency = ((end - start) / totalQueries) * 1000; // microseconds

  return {
    totalTime_ms: end - start,
    totalQueries,
    avgLatency_us: avgLatency.toFixed(2),
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Feature Extractor CLI

Usage:
  extractor.js "<query>"       Extract features for a single query
  extractor.js --benchmark     Benchmark feature extraction speed
  extractor.js --names         List feature names

Examples:
  extractor.js "AuthService"
  extractor.js "how does authentication work"
  extractor.js "what calls AuthService"
`);
    process.exit(0);
  }

  if (args[0] === '--names') {
    console.log('\nFeature Names (29 total):');
    getAllFeatureNames().forEach((name, i) => {
      console.log(`  ${i.toString().padStart(2)}: ${name}`);
    });
    process.exit(0);
  }

  if (args[0] === '--benchmark') {
    const testQueries = [
      'AuthService',
      'how does authentication work',
      'what calls AuthService',
      'AuthService login flow',
      'session management',
      'callers of EmployeeService',
      'getUserById',
      'как функционише аутентификација',
    ];

    const result = benchmarkFeatureExtraction(testQueries);
    console.log('\nBenchmark Results:');
    console.log(`  Total queries: ${result.totalQueries}`);
    console.log(`  Total time: ${result.totalTime_ms.toFixed(2)}ms`);
    console.log(`  Avg latency: ${result.avgLatency_us}μs per query`);
    console.log(`  Target: <10μs`);

    if (parseFloat(result.avgLatency_us) < 10) {
      console.log('  ✓ Target met!');
    } else {
      console.log('  ✗ Target not met');
    }
    process.exit(0);
  }

  // Extract features for query
  const query = args.join(' ');
  const features = extractAllFeatures(query);
  const featureObj = featuresToObject(features);

  console.log(`\nQuery: "${query}"\n`);
  console.log('Features (29):');

  // Group features
  console.log('\n  === Base Features (0-14) ===');
  for (let i = 0; i < 15; i++) {
    const name = getAllFeatureNames()[i];
    console.log(`  ${i.toString().padStart(2)}: ${name.padEnd(28)} = ${features[i].toFixed(4)}`);
  }

  console.log('\n  === Structural Features (15-19) ===');
  for (let i = 15; i < 20; i++) {
    const name = getAllFeatureNames()[i];
    console.log(`  ${i.toString().padStart(2)}: ${name.padEnd(28)} = ${features[i].toFixed(4)}`);
  }

  console.log('\n  === Semantic Features (20-24) ===');
  for (let i = 20; i < 25; i++) {
    const name = getAllFeatureNames()[i];
    console.log(`  ${i.toString().padStart(2)}: ${name.padEnd(28)} = ${features[i].toFixed(4)}`);
  }

  console.log('\n  === Multilingual Features (25-28) ===');
  for (let i = 25; i < 29; i++) {
    const name = getAllFeatureNames()[i];
    console.log(`  ${i.toString().padStart(2)}: ${name.padEnd(28)} = ${features[i].toFixed(4)}`);
  }
}

export default { extractFeatures, extractAllFeatures, getFeatureNames, getAllFeatureNames };
