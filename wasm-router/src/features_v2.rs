//! Ultra-optimized Feature Extraction v2
//!
//! Key optimizations:
//! 1. Multi-pattern matching in single pass (not 100+ contains_ci calls)
//! 2. Zero allocations
//! 3. Skip Unicode pass for ASCII-only queries (but scan for multilingual when non-ASCII present)
//! 4. Packed keyword detection via bitmaps
//! 5. Full multilingual support for 100% JS equivalence
//!
//! Target: <2μs for feature extraction

/// Character classification flags
const UPPER: u8 = 0b0000_0001;
const LOWER: u8 = 0b0000_0010;
const DIGIT: u8 = 0b0000_0100;
const SPACE: u8 = 0b0000_1000;
const UNDER: u8 = 0b0001_0000;
const DOT: u8   = 0b0010_0000;
const PAREN: u8 = 0b0100_0000;
const PATH: u8  = 0b1000_0000;

/// ASCII lookup table for character classification
static CHAR_CLASS: [u8; 256] = {
    let mut table = [0u8; 256];
    let mut i = 65;
    while i <= 90 { table[i] = UPPER; i += 1; }
    i = 97;
    while i <= 122 { table[i] = LOWER; i += 1; }
    i = 48;
    while i <= 57 { table[i] = DIGIT; i += 1; }
    table[b' ' as usize] = SPACE;
    table[b'\t' as usize] = SPACE;
    table[b'\n' as usize] = SPACE;
    table[b'\r' as usize] = SPACE;
    table[b'_' as usize] = UNDER;
    table[b'.' as usize] = DOT;
    table[b'(' as usize] = PAREN;
    table[b')' as usize] = PAREN;
    table[b'/' as usize] = PATH;
    table[b'\\' as usize] = PATH;
    table
};

/// To lowercase (inline)
#[inline(always)]
const fn to_lower(b: u8) -> u8 {
    if b >= b'A' && b <= b'Z' { b + 32 } else { b }
}

/// Keyword categories (bitmask)
#[derive(Default)]
struct KeywordBits {
    // Question words (starts with)
    question_start: bool,  // how, what, why, where, when, which, who, can, does, is, are, should

    // For hasExplanationRequest (feature 23) - only how/why/what, NOT where/when/which/who
    how_why_what_start: bool,

    // Structural patterns
    structural: u32,  // Packed bits for structural keywords (F32 explicit keywords)
    structural_expanded: u32,  // Packed bits for F42-only keywords (e.g., -ing forms)
    structural_count: u8,  // Count of distinct structural keywords found (for F37)

    // Semantic concepts
    semantic: u32,    // Packed bits for semantic keywords (WITH word boundary, for F22)
    // Semantic concepts matched WITHOUT trailing word boundary (for F28 English precedence)
    // JS conceptWords.en uses \s*/ which allows zero trailing whitespace
    semantic_loose: u32,

    // Action verbs
    action: u32,      // Packed bits for action verbs

    // JS questionWords.en requires trailing \s+ for explain/describe
    // This flag is set when "explain" or "describe" is followed by whitespace
    explain_with_space: bool,

    // For "where is X called" pattern
    starts_with_where_is: bool,
    has_called_word: bool,  // "called" detected (NOT a structural keyword, just for pattern)
}

// Structural keyword bits
const SK_CALLERS: u32 = 1 << 0;
const SK_CALLER: u32 = 1 << 1;
const SK_CALLS: u32 = 1 << 2;
const SK_CALL: u32 = 1 << 3;
const SK_CALLEES: u32 = 1 << 4;
const SK_USES: u32 = 1 << 5;
const SK_USAGES: u32 = 1 << 6;
const SK_REFS: u32 = 1 << 7;
const SK_IMPL: u32 = 1 << 8;
const SK_IMPLS: u32 = 1 << 9;
const SK_EXTENDS: u32 = 1 << 10;
const SK_DEPS: u32 = 1 << 11;
const SK_SUBTYPES: u32 = 1 << 12;
const SK_IMPACT: u32 = 1 << 13;
const SK_AFFECTED: u32 = 1 << 14;
const SK_DOWNSTREAM: u32 = 1 << 15;
const SK_INHERITS: u32 = 1 << 16;
const SK_DERIVED: u32 = 1 << 17;
const SK_INVOKE: u32 = 1 << 18;
const SK_WHAT: u32 = 1 << 19;
const SK_WHO: u32 = 1 << 20;
const SK_WHICH: u32 = 1 << 21;

// Question words mask - used to filter out question words from structural keyword checks
// These are stored in structural bitmask for composite checks (e.g., "what calls") but
// should NOT trigger hasExplicitStructuralKeyword (F32) or expandedStructuralKeywordPresence (F42)
const SK_QUESTION_WORDS: u32 = SK_WHAT | SK_WHO | SK_WHICH;

// Semantic concept bits
const SE_FLOW: u32 = 1 << 0;
const SE_PROCESS: u32 = 1 << 1;
const SE_MECHANISM: u32 = 1 << 2;
const SE_STRATEGY: u32 = 1 << 3;
const SE_PATTERN: u32 = 1 << 4;
const SE_LOGIC: u32 = 1 << 5;
const SE_ALGORITHM: u32 = 1 << 6;
const SE_SYSTEM: u32 = 1 << 7;
const SE_DETECTION: u32 = 1 << 8;
const SE_VALIDATION: u32 = 1 << 9;
const SE_AUTH: u32 = 1 << 10;
const SE_HANDLING: u32 = 1 << 11;
const SE_DATABASE: u32 = 1 << 12;
const SE_QUERY: u32 = 1 << 13;
const SE_TOKEN: u32 = 1 << 14;
const SE_MANAGEMENT: u32 = 1 << 15;
const SE_SECURITY: u32 = 1 << 16;
const SE_SESSION: u32 = 1 << 17;
const SE_CONFIG: u32 = 1 << 18;
const SE_ERROR: u32 = 1 << 19;
const SE_SERVICE: u32 = 1 << 20;
const SE_LOGIN: u32 = 1 << 21;
const SE_PASSWORD: u32 = 1 << 22;
const SE_USER: u32 = 1 << 23;
const SE_EXPLAIN: u32 = 1 << 24;
const SE_DESCRIBE: u32 = 1 << 25;
const SE_WORK: u32 = 1 << 26;
const SE_HOW: u32 = 1 << 27;
const SE_DOES: u32 = 1 << 28;
const SE_WHY: u32 = 1 << 29;   // For Feature 23: hasExplanationRequest
const SE_WHAT: u32 = 1 << 30;  // For Feature 23: hasExplanationRequest

// Action verb bits
const AV_HANDLE: u32 = 1 << 0;
const AV_SEND: u32 = 1 << 1;
const AV_CALCULATE: u32 = 1 << 2;
const AV_COMPUTE: u32 = 1 << 3;
const AV_PARSE: u32 = 1 << 4;
const AV_VALIDATE: u32 = 1 << 5;
const AV_TRIGGER: u32 = 1 << 6;
const AV_PERFORM: u32 = 1 << 7;
const AV_INITIALIZE: u32 = 1 << 8;
const AV_EXECUTE: u32 = 1 << 9;
const AV_GENERATE: u32 = 1 << 10;
const AV_FETCH: u32 = 1 << 11;
const AV_STORE: u32 = 1 << 12;
const AV_LOAD: u32 = 1 << 13;
const AV_SAVE: u32 = 1 << 14;
const AV_CREATE: u32 = 1 << 15;
const AV_UPDATE: u32 = 1 << 16;
const AV_DELETE: u32 = 1 << 17;
const AV_RENDER: u32 = 1 << 18;
const AV_CACHE: u32 = 1 << 19;
const AV_LOG: u32 = 1 << 20;
const AV_PROCESS: u32 = 1 << 21;

/// State accumulated during single pass
struct PassState {
    // Counters
    len: usize,
    non_space_count: usize,
    char_count: usize,  // Non-space character count (not bytes)
    uppercase_count: usize,
    lowercase_count: usize,
    digit_count: usize,
    non_ascii_count: usize,       // Counts non-ASCII bytes (for legacy purposes)
    non_ascii_char_count: usize,  // Counts non-ASCII characters (UTF-8 sequence starts)
    token_count: usize,
    cjk_count: usize,

    // Single-char flags
    has_question_mark: bool,
    has_path_sep: bool,

    // Pattern flags (computed during pass)
    has_camel_boundary: bool,
    has_underscore_word: bool,
    starts_with_upper: bool,
    has_consecutive_upper: bool,
    has_dot_notation: bool,
    has_parentheses: bool,

    // Token tracking
    first_token_is_identifier: bool,
    last_token_is_identifier: bool,
    has_any_identifier: bool,  // True if any token is a strict identifier (camelCase/non-Latin)
    has_any_valid_word: bool,  // True if any token is a valid JS identifier word (for F19)
    second_token_is_identifier: bool,  // For feature 36 (question + identifier pattern)
    third_token_is_identifier: bool,   // For feature 36 - token index 2 (3rd token)
    fourth_token_is_identifier: bool,  // For feature 36 - token index 3 (4th token)
    current_token_has_camel: bool,
    current_token_unicode_chars: usize,  // Count of consecutive Unicode script chars (CJK/Cyrillic, NOT Latin Extended)
    current_token_has_ascii_letter: bool,  // Track if token has any ASCII letter (for pure non-Latin detection)
    current_token_identifier_len: usize,  // Length of valid identifier chars in current token
    current_token_has_non_identifier: bool,  // True if current token has non-identifier chars
    current_token_has_latin_extended: bool,  // Track if token has Latin Extended chars (0xC0-0x24F)
    current_token_has_cyrillic: bool,  // Track if token has Cyrillic chars
    current_token_has_cjk: bool,  // Track if token has CJK Unified Ideographs (Kanji/Hanzi: 0x4E00-0x9FFF)
    current_token_has_hiragana: bool,  // Track if token has Hiragana (0x3040-0x309F)
    current_token_has_katakana: bool,  // Track if token has Katakana (0x30A0-0x30FF)
    has_pure_non_latin_identifier: bool,  // True if any token is pure non-Latin identifier (2+ unicode, no ASCII)
    has_mixed_script_token: bool,  // True if any single token has DIFFERENT scripts (Latin vs Cyrillic, not Latin vs Latin Extended)
    has_non_ascii_identifier_char: bool,  // True if any identifier has non-ASCII chars (for feature 25)

    // Keyword detection (accumulated)
    keywords: KeywordBits,

    // Multilingual detection
    has_structural_keyword_non_en: bool,
    has_semantic_keyword_non_en: bool,
    has_non_english_concept_stem: bool,
    has_cyrillic: bool,
    has_latin: bool,

    // Extra keywords for hasExplanationRequest
    has_architecture_keyword: bool,  // architecture, understand, overview, design

    // F39 structuralTemplateMatch - additional patterns beyond what/who/which + verb
    has_classes_implementing_pattern: bool,  // "classes implementing", "types that implement"
}

impl Default for PassState {
    fn default() -> Self {
        Self {
            len: 0,
            non_space_count: 0,
            char_count: 0,
            uppercase_count: 0,
            lowercase_count: 0,
            digit_count: 0,
            non_ascii_count: 0,
            non_ascii_char_count: 0,
            token_count: 0,
            cjk_count: 0,
            has_question_mark: false,
            has_path_sep: false,
            has_camel_boundary: false,
            has_underscore_word: false,
            starts_with_upper: false,
            has_consecutive_upper: false,
            has_dot_notation: false,
            has_parentheses: false,
            first_token_is_identifier: false,
            last_token_is_identifier: false,
            has_any_identifier: false,
            has_any_valid_word: false,
            second_token_is_identifier: false,
            third_token_is_identifier: false,
            fourth_token_is_identifier: false,
            current_token_has_camel: false,
            current_token_unicode_chars: 0,
            current_token_has_ascii_letter: false,
            current_token_identifier_len: 0,
            current_token_has_non_identifier: false,
            current_token_has_latin_extended: false,
            current_token_has_cyrillic: false,
            current_token_has_cjk: false,
            current_token_has_hiragana: false,
            current_token_has_katakana: false,
            has_pure_non_latin_identifier: false,
            has_mixed_script_token: false,
            has_non_ascii_identifier_char: false,
            keywords: KeywordBits::default(),
            has_structural_keyword_non_en: false,
            has_semantic_keyword_non_en: false,
            has_non_english_concept_stem: false,
            has_cyrillic: false,
            has_latin: false,
            has_architecture_keyword: false,
            has_classes_implementing_pattern: false,
        }
    }
}

/// Check if bytes match a pattern (case-insensitive)
#[inline(always)]
fn matches_at(bytes: &[u8], pos: usize, pattern: &[u8]) -> bool {
    if pos + pattern.len() > bytes.len() {
        return false;
    }
    for (i, &p) in pattern.iter().enumerate() {
        if to_lower(bytes[pos + i]) != p {
            return false;
        }
    }
    true
}

/// JS regex word character: alphanumeric or underscore
/// This mask matches JS \w behavior for word boundary detection
const WORD_CHAR_MASK: u8 = UPPER | LOWER | DIGIT | UNDER;

/// Check if position is at word boundary
#[inline(always)]
fn is_word_boundary(bytes: &[u8], pos: usize) -> bool {
    // Word boundary: start of string OR previous char is NOT a word char
    pos == 0 || CHAR_CLASS[bytes[pos - 1] as usize] & WORD_CHAR_MASK == 0
}

/// Check if position ends at word boundary
#[inline(always)]
fn ends_word_boundary(bytes: &[u8], pos: usize, len: usize) -> bool {
    // Word boundary: end of string OR next char is NOT a word char
    pos + len >= bytes.len() || CHAR_CLASS[bytes[pos + len] as usize] & WORD_CHAR_MASK == 0
}

/// Single-pass keyword scanner with word boundary checking
fn scan_keywords(bytes: &[u8], keywords: &mut KeywordBits) {
    let len = bytes.len();
    if len == 0 {
        return;
    }

    // Check question word at start
    if len >= 4 {
        let b0 = to_lower(bytes[0]);
        let b1 = to_lower(bytes[1]);
        let b2 = to_lower(bytes[2]);
        let b3 = to_lower(bytes[3]);

        keywords.question_start = match (b0, b1, b2, b3) {
            (b'h', b'o', b'w', b' ') => true,
            (b'w', b'h', b'a', b't') if len >= 5 && bytes[4] == b' ' => true,
            (b'w', b'h', b'y', b' ') => true,
            (b'w', b'h', b'e', b'r') if len >= 6 && matches_at(bytes, 0, b"where ") => true,
            (b'w', b'h', b'e', b'n') if len >= 5 && bytes[4] == b' ' => true,
            (b'w', b'h', b'i', b'c') if len >= 6 && matches_at(bytes, 0, b"which ") => true,
            (b'w', b'h', b'o', b' ') => true,
            (b'c', b'a', b'n', b' ') => true,
            (b'd', b'o', b'e', b's') if len >= 5 && bytes[4] == b' ' => true,
            (b'i', b's', b' ', _) => true,
            (b'a', b'r', b'e', b' ') => true,
            (b's', b'h', b'o', b'u') if len >= 7 && matches_at(bytes, 0, b"should ") => true,
            _ => false,
        };

        // hasExplanationRequest uses only how/why/what, NOT where/when/which/who
        // JS regex: /\b(explain|describe|understand|overview|architecture|design|how|why|what)\b/
        keywords.how_why_what_start = match (b0, b1, b2, b3) {
            (b'h', b'o', b'w', b' ') => true,
            (b'w', b'h', b'a', b't') if len >= 5 && bytes[4] == b' ' => true,
            (b'w', b'h', b'y', b' ') => true,
            _ => false,
        };

        // Track "where is " prefix for "where is X called" pattern (feature 15)
        // JS regex: /where\s+is\s+\w+\s+called/ - we detect "called" in the keyword scan loop
        if len >= 9 && matches_at(bytes, 0, b"where is ") {
            keywords.starts_with_where_is = true;
        }
    }

    // Scan for keywords at word boundaries
    let mut i = 0;
    while i < len {
        // Skip to word boundary
        if !is_word_boundary(bytes, i) {
            i += 1;
            continue;
        }

        let remaining = len - i;
        let b0 = to_lower(bytes[i]);

        // Structural keywords (sorted by first char for faster matching)
        match b0 {
            b'a' if remaining >= 8 && matches_at(bytes, i, b"affected") && ends_word_boundary(bytes, i, 8) => {
                keywords.structural |= SK_AFFECTED;
                keywords.structural_count += 1;
                i += 8;
                continue;
            }
            b'c' if remaining >= 4 => {
                if matches_at(bytes, i, b"callers") && remaining >= 7 && ends_word_boundary(bytes, i, 7) {
                    keywords.structural |= SK_CALLERS | SK_CALLER;
                    keywords.structural_count += 1;
                    i += 7;
                    continue;
                } else if matches_at(bytes, i, b"caller") && remaining >= 6 && ends_word_boundary(bytes, i, 6) {
                    keywords.structural |= SK_CALLER;
                    keywords.structural_count += 1;
                    i += 6;
                    continue;
                } else if matches_at(bytes, i, b"called") && remaining >= 6 && ends_word_boundary(bytes, i, 6) {
                    // "called" is NOT a structural keyword in JS - only used for "where is X called" pattern
                    keywords.has_called_word = true;
                    i += 6;
                    continue;
                } else if matches_at(bytes, i, b"callees") && remaining >= 7 && ends_word_boundary(bytes, i, 7) {
                    keywords.structural |= SK_CALLEES;
                    keywords.structural_count += 1;
                    i += 7;
                    continue;
                } else if matches_at(bytes, i, b"calls") && remaining >= 5 && ends_word_boundary(bytes, i, 5) {
                    keywords.structural |= SK_CALLS | SK_CALL;
                    keywords.structural_count += 1;
                    i += 5;
                    continue;
                } else if matches_at(bytes, i, b"call") && remaining >= 4 && ends_word_boundary(bytes, i, 4) {
                    keywords.structural |= SK_CALL;
                    keywords.structural_count += 1;
                    i += 4;
                    continue;
                }
            }
            b'd' if remaining >= 4 => {
                if remaining >= 12 && matches_at(bytes, i, b"dependencies") && ends_word_boundary(bytes, i, 12) {
                    keywords.structural |= SK_DEPS;
                    keywords.structural_count += 1;
                    i += 12;
                    continue;
                } else if remaining >= 10 && matches_at(bytes, i, b"dependency") && ends_word_boundary(bytes, i, 10) {
                    keywords.structural |= SK_DEPS;
                    keywords.structural_count += 1;
                    i += 10;
                    continue;
                } else if remaining >= 10 && matches_at(bytes, i, b"downstream") && ends_word_boundary(bytes, i, 10) {
                    keywords.structural |= SK_DOWNSTREAM;
                    keywords.structural_count += 1;
                    i += 10;
                    continue;
                } else if remaining >= 7 && matches_at(bytes, i, b"derived") && ends_word_boundary(bytes, i, 7) {
                    keywords.structural |= SK_DERIVED;
                    keywords.structural_count += 1;
                    i += 7;
                    continue;
                } else if remaining >= 7 && matches_at(bytes, i, b"depends") && ends_word_boundary(bytes, i, 7) {
                    keywords.structural |= SK_DEPS;
                    keywords.structural_count += 1;
                    i += 7;
                    continue;
                } else if remaining >= 6 && matches_at(bytes, i, b"depend") && ends_word_boundary(bytes, i, 6) {
                    keywords.structural |= SK_DEPS;
                    keywords.structural_count += 1;
                    i += 6;
                    continue;
                }
            }
            b'e' if remaining >= 7 && matches_at(bytes, i, b"extends") && ends_word_boundary(bytes, i, 7) => {
                keywords.structural |= SK_EXTENDS;
                keywords.structural_count += 1;
                i += 7;
                continue;
            }
            b'i' if remaining >= 4 => {
                if remaining >= 15 && matches_at(bytes, i, b"implementations") && ends_word_boundary(bytes, i, 15) {
                    keywords.structural |= SK_IMPLS | SK_IMPL;
                    keywords.structural_count += 1;
                    i += 15;
                    continue;
                } else if remaining >= 14 && matches_at(bytes, i, b"implementation") && ends_word_boundary(bytes, i, 14) {
                    keywords.structural |= SK_IMPL;
                    keywords.structural_count += 1;
                    i += 14;
                    continue;
                } else if remaining >= 12 && matches_at(bytes, i, b"implementing") && ends_word_boundary(bytes, i, 12) {
                    // JS: "implementing" is in F42 (expandedStructuralKeywords) but NOT in F32 (structuralKeywords)
                    // F32's regex uses `implements?` which only matches "implement" or "implements", not "implementing"
                    keywords.structural_expanded |= SK_IMPL;
                    // Don't increment structural_count - F37 only counts explicit keywords
                    i += 12;
                    continue;
                } else if remaining >= 10 && matches_at(bytes, i, b"implements") && ends_word_boundary(bytes, i, 10) {
                    keywords.structural |= SK_IMPL;
                    keywords.structural_count += 1;
                    i += 10;
                    continue;
                } else if remaining >= 8 && matches_at(bytes, i, b"inherits") && ends_word_boundary(bytes, i, 8) {
                    keywords.structural |= SK_INHERITS;
                    keywords.structural_count += 1;
                    i += 8;
                    continue;
                } else if remaining >= 6 && matches_at(bytes, i, b"impact") && ends_word_boundary(bytes, i, 6) {
                    keywords.structural |= SK_IMPACT;
                    keywords.structural_count += 1;
                    i += 6;
                    continue;
                } else if remaining >= 5 && matches_at(bytes, i, b"invok") {
                    // JS: invoke[sd]?|invoking is in F42 (expanded) NOT in F32 (explicit)
                    // Note: "invoke" → "invok" + "e", "invoking" → "invok" + "ing" (e dropped)
                    // Check for invoking (8 chars: invok + ing)
                    if remaining >= 8 && matches_at(bytes, i, b"invoking") && ends_word_boundary(bytes, i, 8) {
                        keywords.structural_expanded |= SK_INVOKE;
                        // Don't increment structural_count - these are F42-only
                        i += 8;
                        continue;
                    }
                    // Check for invokes or invoked (7 chars)
                    if remaining >= 7 && (matches_at(bytes, i, b"invokes") || matches_at(bytes, i, b"invoked")) && ends_word_boundary(bytes, i, 7) {
                        keywords.structural_expanded |= SK_INVOKE;
                        i += 7;
                        continue;
                    }
                    // Base form invoke (6 chars)
                    if remaining >= 6 && matches_at(bytes, i, b"invoke") && ends_word_boundary(bytes, i, 6) {
                        keywords.structural_expanded |= SK_INVOKE;
                        i += 6;
                        continue;
                    }
                }
            }
            b'r' if remaining >= 9 => {
                if remaining >= 10 && matches_at(bytes, i, b"references") && ends_word_boundary(bytes, i, 10) {
                    keywords.structural |= SK_REFS;
                    keywords.structural_count += 1;
                    i += 10;
                    continue;
                } else if matches_at(bytes, i, b"reference") && ends_word_boundary(bytes, i, 9) {
                    keywords.structural |= SK_REFS;
                    keywords.structural_count += 1;
                    i += 9;
                    continue;
                }
            }
            b's' if remaining >= 8 && matches_at(bytes, i, b"subtypes") && ends_word_boundary(bytes, i, 8) => {
                keywords.structural |= SK_SUBTYPES;
                keywords.structural_count += 1;
                i += 8;
                continue;
            }
            b'u' if remaining >= 3 => {
                if remaining >= 6 && matches_at(bytes, i, b"usages") && ends_word_boundary(bytes, i, 6) {
                    keywords.structural |= SK_USAGES | SK_USES;
                    keywords.structural_count += 1;
                    i += 6;
                    continue;
                } else if remaining >= 4 && matches_at(bytes, i, b"uses") && ends_word_boundary(bytes, i, 4) {
                    keywords.structural |= SK_USES;
                    keywords.structural_count += 1;
                    i += 4;
                    continue;
                } else if remaining >= 3 && matches_at(bytes, i, b"use") && ends_word_boundary(bytes, i, 3) {
                    // JS regex: /uses?/ matches both "use" and "uses"
                    keywords.structural |= SK_USES;
                    keywords.structural_count += 1;
                    i += 3;
                    continue;
                }
            }
            b'w' if remaining >= 4 => {
                if matches_at(bytes, i, b"what") && ends_word_boundary(bytes, i, 4) {
                    keywords.structural |= SK_WHAT;
                    keywords.semantic |= SE_WHAT;  // Also set semantic for F23
                    // NOTE: Don't increment structural_count for question words - they're not structural keywords
                    i += 4;
                    continue;
                } else if matches_at(bytes, i, b"which") && remaining >= 5 && ends_word_boundary(bytes, i, 5) {
                    keywords.structural |= SK_WHICH;
                    // NOTE: Don't increment structural_count for question words
                    i += 5;
                    continue;
                } else if matches_at(bytes, i, b"who") && remaining >= 3 && ends_word_boundary(bytes, i, 3) {
                    keywords.structural |= SK_WHO;
                    // NOTE: Don't increment structural_count for question words
                    i += 3;
                    continue;
                }
            }
            _ => {}
        }

        // Semantic keywords
        match b0 {
            b'a' if remaining >= 9 && matches_at(bytes, i, b"algorithm") && ends_word_boundary(bytes, i, 9) => {
                keywords.semantic |= SE_ALGORITHM;
            }
            // For F22 (hasSemanticConceptWord): needs word boundary (JS \b...\b)
            // For F28 (English precedence): conceptWords.en uses \s*/ (no trailing boundary)
            // We track both: semantic (with boundary for F22) and semantic_loose (for F28)
            b'a' if remaining >= 14 && matches_at(bytes, i, b"authentication") => {
                // conceptWords.en - always set loose, only set semantic if word boundary
                keywords.semantic_loose |= SE_AUTH;
                if ends_word_boundary(bytes, i, 14) {
                    keywords.semantic |= SE_AUTH;
                }
            }
            b'c' if remaining >= 6 && matches_at(bytes, i, b"config") => {
                // conceptWords.en - always set loose, only set semantic if word boundary
                keywords.semantic_loose |= SE_CONFIG;
                if ends_word_boundary(bytes, i, 6) {
                    keywords.semantic |= SE_CONFIG;
                }
            }
            b'd' if remaining >= 8 => {
                if matches_at(bytes, i, b"database") {
                    // conceptWords.en - always set loose, only set semantic if word boundary
                    keywords.semantic_loose |= SE_DATABASE;
                    if ends_word_boundary(bytes, i, 8) {
                        keywords.semantic |= SE_DATABASE;
                    }
                } else if matches_at(bytes, i, b"describe") && ends_word_boundary(bytes, i, 8) {
                    keywords.semantic |= SE_DESCRIBE;
                    // JS questionWords.en requires "describe\s+" - check for trailing space
                    if i + 8 < len && CHAR_CLASS[bytes[i + 8] as usize] & SPACE != 0 {
                        keywords.explain_with_space = true;
                    }
                } else if remaining >= 9 && matches_at(bytes, i, b"detection") && ends_word_boundary(bytes, i, 9) {
                    keywords.semantic |= SE_DETECTION;
                } else if remaining >= 4 && matches_at(bytes, i, b"does") && ends_word_boundary(bytes, i, 4) {
                    keywords.semantic |= SE_DOES;
                }
            }
            b'e' if remaining >= 5 => {
                if matches_at(bytes, i, b"error") && ends_word_boundary(bytes, i, 5) {
                    keywords.semantic |= SE_ERROR;
                } else if remaining >= 7 && matches_at(bytes, i, b"explain") && ends_word_boundary(bytes, i, 7) {
                    keywords.semantic |= SE_EXPLAIN;
                    // JS questionWords.en requires "explain\s+" - check for trailing space
                    if i + 7 < len && CHAR_CLASS[bytes[i + 7] as usize] & SPACE != 0 {
                        keywords.explain_with_space = true;
                    }
                }
            }
            b'f' if remaining >= 4 && matches_at(bytes, i, b"flow") && ends_word_boundary(bytes, i, 4) => {
                keywords.semantic |= SE_FLOW;
            }
            b'h' if remaining >= 8 && matches_at(bytes, i, b"handling") && ends_word_boundary(bytes, i, 8) => {
                keywords.semantic |= SE_HANDLING;
            }
            b'h' if remaining >= 3 && matches_at(bytes, i, b"how") && ends_word_boundary(bytes, i, 3) => {
                keywords.semantic |= SE_HOW;
            }
            b'l' if remaining >= 5 => {
                if matches_at(bytes, i, b"logic") {
                    // conceptWords.en - always set loose, only set semantic if word boundary
                    keywords.semantic_loose |= SE_LOGIC;
                    if ends_word_boundary(bytes, i, 5) {
                        keywords.semantic |= SE_LOGIC;
                    }
                } else if matches_at(bytes, i, b"login") && ends_word_boundary(bytes, i, 5) {
                    keywords.semantic |= SE_LOGIN;
                }
            }
            b'm' if remaining >= 9 && matches_at(bytes, i, b"mechanism") && ends_word_boundary(bytes, i, 9) => {
                keywords.semantic |= SE_MECHANISM;
            }
            b'm' if remaining >= 10 && matches_at(bytes, i, b"management") => {
                // conceptWords.en - always set loose, only set semantic if word boundary
                keywords.semantic_loose |= SE_MANAGEMENT;
                if ends_word_boundary(bytes, i, 10) {
                    keywords.semantic |= SE_MANAGEMENT;
                }
            }
            b'p' if remaining >= 7 => {
                if matches_at(bytes, i, b"process") && ends_word_boundary(bytes, i, 7) {
                    keywords.semantic |= SE_PROCESS;
                } else if matches_at(bytes, i, b"pattern") && ends_word_boundary(bytes, i, 7) {
                    keywords.semantic |= SE_PATTERN;
                } else if remaining >= 8 && matches_at(bytes, i, b"password") && ends_word_boundary(bytes, i, 8) {
                    keywords.semantic |= SE_PASSWORD;
                }
            }
            b'q' if remaining >= 5 && matches_at(bytes, i, b"query") => {
                // conceptWords.en - always set loose, only set semantic if word boundary
                keywords.semantic_loose |= SE_QUERY;
                if ends_word_boundary(bytes, i, 5) {
                    keywords.semantic |= SE_QUERY;
                }
            }
            b's' if remaining >= 6 => {
                if matches_at(bytes, i, b"system") && ends_word_boundary(bytes, i, 6) {
                    keywords.semantic |= SE_SYSTEM;
                } else if remaining >= 7 && matches_at(bytes, i, b"session") {
                    // conceptWords.en - always set loose, only set semantic if word boundary
                    keywords.semantic_loose |= SE_SESSION;
                    if ends_word_boundary(bytes, i, 7) {
                        keywords.semantic |= SE_SESSION;
                    }
                } else if remaining >= 7 && matches_at(bytes, i, b"service") && ends_word_boundary(bytes, i, 7) {
                    keywords.semantic |= SE_SERVICE;
                } else if remaining >= 8 && matches_at(bytes, i, b"security") {
                    // conceptWords.en - always set loose, only set semantic if word boundary
                    keywords.semantic_loose |= SE_SECURITY;
                    if ends_word_boundary(bytes, i, 8) {
                        keywords.semantic |= SE_SECURITY;
                    }
                } else if remaining >= 8 && matches_at(bytes, i, b"strategy") && ends_word_boundary(bytes, i, 8) {
                    keywords.semantic |= SE_STRATEGY;
                }
            }
            b't' if remaining >= 5 && matches_at(bytes, i, b"token") => {
                // conceptWords.en - always set loose, only set semantic if word boundary
                keywords.semantic_loose |= SE_TOKEN;
                if ends_word_boundary(bytes, i, 5) {
                    keywords.semantic |= SE_TOKEN;
                }
            }
            b'u' if remaining >= 4 && matches_at(bytes, i, b"user") && ends_word_boundary(bytes, i, 4) => {
                keywords.semantic |= SE_USER;
            }
            b'v' if remaining >= 10 && matches_at(bytes, i, b"validation") => {
                // conceptWords.en - always set loose, only set semantic if word boundary
                keywords.semantic_loose |= SE_VALIDATION;
                if ends_word_boundary(bytes, i, 10) {
                    keywords.semantic |= SE_VALIDATION;
                }
            }
            b'w' if remaining >= 3 => {
                if remaining >= 4 && matches_at(bytes, i, b"work") && ends_word_boundary(bytes, i, 4) {
                    keywords.semantic |= SE_WORK;
                } else if remaining >= 4 && matches_at(bytes, i, b"what") && ends_word_boundary(bytes, i, 4) {
                    keywords.semantic |= SE_WHAT;  // For Feature 23
                } else if remaining >= 3 && matches_at(bytes, i, b"why") && ends_word_boundary(bytes, i, 3) {
                    keywords.semantic |= SE_WHY;   // For Feature 23
                }
            }
            _ => {}
        }

        // Action verbs
        match b0 {
            b'c' if remaining >= 5 => {
                if matches_at(bytes, i, b"cache") && ends_word_boundary(bytes, i, 5) {
                    keywords.action |= AV_CACHE;
                } else if remaining >= 6 && matches_at(bytes, i, b"create") && ends_word_boundary(bytes, i, 6) {
                    keywords.action |= AV_CREATE;
                } else if remaining >= 7 && matches_at(bytes, i, b"compute") && ends_word_boundary(bytes, i, 7) {
                    keywords.action |= AV_COMPUTE;
                } else if remaining >= 9 && matches_at(bytes, i, b"calculate") && ends_word_boundary(bytes, i, 9) {
                    keywords.action |= AV_CALCULATE;
                }
            }
            b'd' if remaining >= 6 && matches_at(bytes, i, b"delete") && ends_word_boundary(bytes, i, 6) => {
                keywords.action |= AV_DELETE;
            }
            b'e' if remaining >= 7 && matches_at(bytes, i, b"execute") && ends_word_boundary(bytes, i, 7) => {
                keywords.action |= AV_EXECUTE;
            }
            b'f' if remaining >= 5 && matches_at(bytes, i, b"fetch") && ends_word_boundary(bytes, i, 5) => {
                keywords.action |= AV_FETCH;
            }
            b'g' if remaining >= 8 && matches_at(bytes, i, b"generate") && ends_word_boundary(bytes, i, 8) => {
                keywords.action |= AV_GENERATE;
            }
            b'h' if remaining >= 6 && matches_at(bytes, i, b"handle") && ends_word_boundary(bytes, i, 6) => {
                keywords.action |= AV_HANDLE;
            }
            b'i' if remaining >= 10 && matches_at(bytes, i, b"initialize") && ends_word_boundary(bytes, i, 10) => {
                keywords.action |= AV_INITIALIZE;
            }
            b'l' if remaining >= 4 && matches_at(bytes, i, b"load") && ends_word_boundary(bytes, i, 4) => {
                keywords.action |= AV_LOAD;
            }
            b'l' if remaining >= 3 && matches_at(bytes, i, b"log") && ends_word_boundary(bytes, i, 3) => {
                keywords.action |= AV_LOG;
            }
            b'p' if remaining >= 5 => {
                if matches_at(bytes, i, b"parse") && ends_word_boundary(bytes, i, 5) {
                    keywords.action |= AV_PARSE;
                } else if remaining >= 7 && matches_at(bytes, i, b"perform") && ends_word_boundary(bytes, i, 7) {
                    keywords.action |= AV_PERFORM;
                } else if remaining >= 7 && matches_at(bytes, i, b"process") && ends_word_boundary(bytes, i, 7) {
                    keywords.action |= AV_PROCESS;
                }
            }
            b'r' if remaining >= 6 && matches_at(bytes, i, b"render") && ends_word_boundary(bytes, i, 6) => {
                keywords.action |= AV_RENDER;
            }
            b's' if remaining >= 4 => {
                if matches_at(bytes, i, b"save") && ends_word_boundary(bytes, i, 4) {
                    keywords.action |= AV_SAVE;
                } else if matches_at(bytes, i, b"send") && ends_word_boundary(bytes, i, 4) {
                    keywords.action |= AV_SEND;
                } else if remaining >= 5 && matches_at(bytes, i, b"store") && ends_word_boundary(bytes, i, 5) {
                    keywords.action |= AV_STORE;
                }
            }
            b't' if remaining >= 7 && matches_at(bytes, i, b"trigger") && ends_word_boundary(bytes, i, 7) => {
                keywords.action |= AV_TRIGGER;
            }
            b'u' if remaining >= 6 && matches_at(bytes, i, b"update") && ends_word_boundary(bytes, i, 6) => {
                keywords.action |= AV_UPDATE;
            }
            b'v' if remaining >= 8 && matches_at(bytes, i, b"validate") && ends_word_boundary(bytes, i, 8) => {
                keywords.action |= AV_VALIDATE;
            }
            _ => {}
        }

        i += 1;
    }
}

/// Scan for multilingual keywords (non-English structural/semantic patterns)
/// Optimized: only runs expensive checks when non-ASCII present or German/Spanish likely
fn scan_multilingual(query: &str, state: &mut PassState) {
    // Early exit for pure ASCII queries that are clearly English
    // (Cyrillic patterns can't match, and German/Spanish patterns are rare)
    if state.non_ascii_char_count == 0 && !state.has_cyrillic {
        // Quick case-insensitive check for German/Spanish keyword prefixes
        let bytes = query.as_bytes();
        let has_multilingual_prefix = bytes.windows(4).any(|w| {
            let w0 = to_lower(w[0]);
            let w1 = to_lower(w[1]);
            let w2 = to_lower(w[2]);
            let w3 = to_lower(w[3]);
            // German prefixes
            (w0 == b'u' && w1 == b'n' && w2 == b't' && w3 == b'e') ||  // unte(rklassen)
            (w0 == b'i' && w1 == b'm' && w2 == b'p' && w3 == b'l') ||  // impl(ementierungen)
            (w0 == b'a' && w1 == b'u' && w2 == b's' && w3 == b'w') ||  // ausw(irkung)
            (w0 == b'a' && w1 == b'u' && w2 == b't' && w3 == b'h') ||  // auth(entifizierung)
            (w0 == b'e' && w1 == b'r' && w2 == b'w' && w3 == b'e') ||  // erwe(itert)
            (w0 == b'r' && w1 == b'u' && w2 == b'f' && w3 == b't') ||  // ruft
            (w0 == b'v' && w1 == b'a' && w2 == b'l' && w3 == b'i') ||  // vali(dierung)
            (w0 == b'f' && w1 == b'e' && w2 == b'h' && w3 == b'l') ||  // fehl(erbehandlung)
            (w0 == b's' && w1 == b'i' && w2 == b'c' && w3 == b'h') ||  // sich(erheit)
            (w0 == b'p' && w1 == b'r' && w2 == b'o' && w3 == b'z') ||  // proz(ess)
            (w0 == b'l' && w1 == b'e' && w2 == b'i' && w3 == b's') ||  // leis(tung)
            (w0 == b'm' && w1 == b'e' && w2 == b'c' && w3 == b'h') ||  // mech(anismus)
            (w0 == b'l' && w1 == b'o' && w2 == b'g' && w3 == b'i') ||  // logi(k)
            // Spanish prefixes
            (w0 == b'i' && w1 == b'm' && w2 == b'p' && w3 == b'a') ||  // impa(cto)
            (w0 == b'l' && w1 == b'l' && w2 == b'a' && w3 == b'm') ||  // llam(a)
            (w0 == b's' && w1 == b'u' && w2 == b'b' && w3 == b'c') ||  // subc(lases)
            (w0 == b'e' && w1 == b'x' && w2 == b't' && w3 == b'i') ||  // exti(ende)
            (w0 == b'e' && w1 == b'x' && w2 == b'p' && w3 == b'l') ||  // expl(ica)
            (w0 == b'm' && w1 == b'a' && w2 == b'n' && w3 == b'e')     // mane(jo)
        });
        if !has_multilingual_prefix {
            return;  // Skip expensive multilingual checks for pure English ASCII
        }
    }
    // === Serbian/Russian Structural Keywords ===
    // "шта позива" (what calls), "ко позива" (who calls)
    // "које методе" (which methods), "имплементације" (implementations)
    // "подкласе" (subclasses), "наслеђује" (inherits), "утицај" (impact)
    // "Unterklassen" (German subclasses), "impacto" (Spanish impact)
    let structural_patterns_cyrillic = [
        "шта позива", "ко позива", "који позива", "шта зове", "ко зове",
        "које методе", "имплементације", "подкласе", "наслеђује", "утицај",
        "што позива", "кој позива",
        // Russian
        "что вызывает", "кто вызывает", "какой вызывает", "реализации",
        "подклассы", "наследует", "влияние",
    ];

    let structural_patterns_german = [
        "unterklassen", "implementierungen", "auswirkung", "erweitert",
        "was ruft", "wer ruft", "welche ruft",
    ];

    let structural_patterns_spanish = [
        "impacto de cambiar", "qué llama", "quién llama", "implementaciones de",
        "subclases de", "extiende",
    ];

    let lower = query.to_lowercase();

    // Check structural patterns
    for pattern in &structural_patterns_cyrillic {
        if lower.contains(pattern) {
            state.has_structural_keyword_non_en = true;
            break;
        }
    }

    if !state.has_structural_keyword_non_en {
        for pattern in &structural_patterns_german {
            if lower.contains(pattern) {
                state.has_structural_keyword_non_en = true;
                break;
            }
        }
    }

    if !state.has_structural_keyword_non_en {
        for pattern in &structural_patterns_spanish {
            if lower.contains(pattern) {
                state.has_structural_keyword_non_en = true;
                break;
            }
        }
    }

    // === Serbian/Russian Semantic Keywords ===
    // "како ради" (how works), "како функционише" (how functions)
    // "шта је" (what is), "објасни" (explain), "опиши" (describe)
    // "зашто" (why), "процес" (process), "механизам" (mechanism), "ток" (flow)
    let semantic_patterns_cyrillic = [
        "како ради", "како функционише", "шта је", "објасни", "опиши",
        "зашто", "процес", "механизам", "логик", "аутентификациј",
        "валидациј", "кеширањ", "сесиј", "менаџмент", "ток", "обрад", "секвенц",
        // Russian
        "как работает", "что такое", "объясни", "опиши", "почему",
        "процесс", "механизм", "логик", "аутентификац", "валидац",
        "кэширован", "сессии", "авторизац", "поток", "обработк",
    ];

    let semantic_patterns_german = [
        "wie funktioniert", "was ist", "erkläre", "beschreibe", "warum",
        "prozess", "mechanismus", "logik", "authentifizierung", "validierung",
        "fehlerbehandlung", "sicherheit", "leistung",
    ];

    let semantic_patterns_spanish = [
        "cómo funciona", "qué es", "explica", "describe", "por qué",
        "proceso", "mecanismo", "lógica", "autenticación", "validación",
        "manejo de errores", "seguridad", "rendimiento", "caché",
    ];

    // Japanese semantic patterns (Katakana/Kanji concept words)
    let semantic_patterns_japanese = [
        // Question patterns
        "どのように", "どうやって", "なぜ", "とは何", "説明して", "説明する",
        // Process/flow patterns
        "フロー", "プロセス", "ライフサイクル", "ワークフロー", "パイプライン", "シーケンス", "ステップ", "フェーズ",
        // Architecture patterns
        "アーキテクチャ", "デザインパターン", "パターン", "構造", "コンポーネント", "モジュール", "レイヤー",
        // Concept words
        "エラー処理", "バリデーション", "認証", "認可", "キャッシュ", "ロギング", "セキュリティ",
        "パフォーマンス", "最適化", "データベース", "クエリ", "トークン", "管理", "ロジック",
    ];

    // Chinese semantic patterns (Simplified Chinese concept words)
    let semantic_patterns_chinese = [
        // Question patterns
        "如何", "怎么", "为什么", "是什么", "解释", "描述",
        // Process/flow patterns
        "流程", "过程", "生命周期", "工作流", "管道", "序列", "步骤", "阶段",
        // Architecture patterns
        "架构", "设计模式", "模式", "结构", "组件", "模块", "层",
        // Concept words
        "错误处理", "验证", "认证", "授权", "缓存", "日志", "安全", "性能", "优化",
        "数据库", "查询", "令牌", "管理", "逻辑",
    ];

    // Korean semantic patterns
    let semantic_patterns_korean = [
        // Question patterns
        "어떻게", "왜", "무엇", "설명해", "설명하다",
        // Process/flow patterns
        "흐름", "프로세스", "생명주기", "워크플로우", "파이프라인", "시퀀스", "단계",
        // Architecture/concept patterns
        "아키텍처", "디자인패턴", "패턴", "구조", "컴포넌트", "모듈", "레이어",
        "오류처리", "검증", "인증", "권한", "캐싱", "로깅", "보안", "성능", "최적화",
        "데이터베이스", "쿼리", "토큰", "관리", "로직",
    ];

    for pattern in &semantic_patterns_cyrillic {
        if lower.contains(pattern) {
            state.has_semantic_keyword_non_en = true;
            break;
        }
    }

    if !state.has_semantic_keyword_non_en {
        for pattern in &semantic_patterns_german {
            if lower.contains(pattern) {
                state.has_semantic_keyword_non_en = true;
                break;
            }
        }
    }

    if !state.has_semantic_keyword_non_en {
        for pattern in &semantic_patterns_spanish {
            if lower.contains(pattern) {
                state.has_semantic_keyword_non_en = true;
                break;
            }
        }
    }

    // CJK patterns don't need lowercasing - check against original query
    if !state.has_semantic_keyword_non_en {
        for pattern in &semantic_patterns_japanese {
            if query.contains(pattern) {
                state.has_semantic_keyword_non_en = true;
                break;
            }
        }
    }

    if !state.has_semantic_keyword_non_en {
        for pattern in &semantic_patterns_chinese {
            if query.contains(pattern) {
                state.has_semantic_keyword_non_en = true;
                break;
            }
        }
    }

    if !state.has_semantic_keyword_non_en {
        for pattern in &semantic_patterns_korean {
            if query.contains(pattern) {
                state.has_semantic_keyword_non_en = true;
                break;
            }
        }
    }

    // === Non-English Concept Stems ===
    // German: authentifiz, konfig, verarbeit, strategie, mechanismus, prozess
    // Spanish: autentic, config, valid, proces, estrateg, mecan
    // French: authenti, valid, trait, gest, erreur, etc.
    // Russian/Serbian: аутентификац, конфигурац, валидац, обработ, стратег, механизм
    let concept_stems = [
        // German
        "authentifiz", "konfig", "verarbeit", "verwalt", "fehler", "behandl",
        "validier", "speicher", "strategie", "mechanismus", "prozess", "logik",
        "architektur", "zahlungs", "benutzer", "sitzung", "nachricht", "fehlerbehandlung",
        "laden", "senden", "empfang", "format", "konvert", "verschlüssel", "ereignis",
        // Spanish (including short stems that match English words like "valid")
        "autentic", "config", "valid", "proces", "manejo", "almacen", "estrateg",
        "mecan", "lógic", "sistem", "arquitectur", "usuario", "sesión",
        "mensaje", "funciona", "error", "carga", "enviar", "recib", "convert", "cifr",
        // French
        "authentif", "authentiq", "trait", "gest", "erreur", "stockag", "charg",
        "envoy", "recev", "chiffr", "stratég", "mécan", "process", "logiq",
        "système", "architect", "paie", "utilisat", "session", "messag",
        // Russian/Serbian
        "аутентификац", "конфигурац", "валидац", "обрад", "управљањ",
        "грешк", "складиштењ", "учитавањ", "стратегиј", "механизам",
        "процес", "логик", "систем", "архитектур", "плаћањ", "корисник",
        "сесиј", "порук", "кеширањ", "пријав", "слањ", "примањ", "формат",
        "конверт", "шифровањ",
        // Russian specific
        "аутентификаци", "валидаци", "обработк", "управлен", "ошибк",
        "хранен", "загруз", "отправ", "стратег", "логик", "процесс",
        "получ", "формат", "преобраз", "шифрован", "платеж", "пользовател",
        "сесси", "сообщен",
    ];

    for stem in &concept_stems {
        if lower.contains(stem) {
            state.has_non_english_concept_stem = true;
            break;
        }
    }
}

/// Fast scan for ASCII concept stems (Feature 40)
/// These stems appear in the Spanish/German lists and match common English words like "config".
/// This runs for pure ASCII queries where scan_multilingual's early exit skips the full check.
fn scan_ascii_concept_stems(bytes: &[u8], state: &mut PassState) {
    let len = bytes.len();
    if len < 4 { return; }

    // ASCII stems from JS regex that can appear in English queries:
    // Spanish: "config", "valid", "error", "process"
    // German: "system", "logik", "format"
    // French: "process", "session", "message"
    // Note: Case-insensitive matching, NO word boundaries (JS regex doesn't use \b for Feature 40)
    for i in 0..len {
        // JS Feature 40 regex matches ANYWHERE in the query (no \b word boundaries)
        // Example: "TokenValidator" should match "valid" stem
        let remaining = len - i;
        let b0 = to_lower(bytes[i]);
        match b0 {
            b'c' if remaining >= 6 => {
                // config
                if matches_at(bytes, i, b"config") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'v' if remaining >= 5 => {
                // valid (Spanish), verarbeit (German processing), verwalt (German management)
                if matches_at(bytes, i, b"valid") ||
                   (remaining >= 9 && matches_at(bytes, i, b"verarbeit")) ||
                   (remaining >= 7 && matches_at(bytes, i, b"verwalt")) {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'e' if remaining >= 5 => {
                // error
                if matches_at(bytes, i, b"error") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'p' if remaining >= 6 => {
                // process
                if matches_at(bytes, i, b"proces") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b's' if remaining >= 6 => {
                // system, session
                if matches_at(bytes, i, b"system") || matches_at(bytes, i, b"session") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'l' if remaining >= 5 => {
                // logic (logik in German)
                if matches_at(bytes, i, b"logic") || matches_at(bytes, i, b"logik") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'f' if remaining >= 6 => {
                // format, fehler (German error), fehlerbehandlung (German error handling)
                if matches_at(bytes, i, b"format") ||
                   matches_at(bytes, i, b"fehler") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'b' if remaining >= 7 => {
                // behandl (German handling/treatment)
                if matches_at(bytes, i, b"behandl") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'k' if remaining >= 6 => {
                // konfig (German config)
                if matches_at(bytes, i, b"konfig") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'm' if remaining >= 5 => {
                // JS regex stems: message/messag (French), mecan (Spanish 5 chars), mechanismus (German 10 chars)
                // Note: "mechan" (6 chars) is NOT in JS regex - only "mecan" and "mechanismus"
                if (remaining >= 7 && matches_at(bytes, i, b"message")) ||
                   (remaining >= 6 && matches_at(bytes, i, b"messag")) ||
                   (remaining >= 10 && matches_at(bytes, i, b"mechanismu")) ||
                   matches_at(bytes, i, b"mecan") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            b'a' if remaining >= 9 => {
                // JS F40: German 'authentifiz', French 'authenti[fq]' (authentif or authentiq)
                // Note: plain 'authenti' is NOT in JS - it catches English 'authentication'
                // Note: 'architec' is NOT in JS regex for F40
                if matches_at(bytes, i, b"authentif") || matches_at(bytes, i, b"authentiq") {
                    state.has_non_english_concept_stem = true;
                    return;
                }
            }
            _ => {}
        }
    }
}

/// Count CJK characters and detect script types
fn analyze_unicode(query: &str, state: &mut PassState) {
    for c in query.chars() {
        // CJK ranges
        if matches!(c,
            '\u{4E00}'..='\u{9FFF}' |   // CJK Unified Ideographs
            '\u{3040}'..='\u{309F}' |   // Hiragana
            '\u{30A0}'..='\u{30FF}' |   // Katakana
            '\u{AC00}'..='\u{D7AF}'     // Korean Hangul
        ) {
            state.cjk_count += 1;
        }

        // Cyrillic
        if matches!(c, '\u{0400}'..='\u{04FF}') {
            state.has_cyrillic = true;
        }

        // Latin
        if c.is_ascii_alphabetic() || matches!(c, '\u{00C0}'..='\u{024F}') {
            state.has_latin = true;
        }
    }
}

/// Check for F17 "implementations of" pattern
/// Matches: /\bimplementations?\s+of\b/i
fn has_implementations_of_pattern(bytes: &[u8]) -> bool {
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if i + 14 <= len && is_word_boundary(bytes, i) && matches_at(bytes, i, b"implementation") {
            let mut j = i + 14;
            // Optional 's' for "implementations"
            if j < len && to_lower(bytes[j]) == b's' { j += 1; }
            // Require word boundary after implementation(s)
            if j < len && CHAR_CLASS[bytes[j] as usize] & WORD_CHAR_MASK != 0 {
                i += 1;
                continue;
            }
            // Skip whitespace
            while j < len && CHAR_CLASS[bytes[j] as usize] & SPACE != 0 { j += 1; }
            // Look for "of"
            if j + 2 <= len && matches_at(bytes, j, b"of") {
                // Require word boundary after "of"
                let k = j + 2;
                if k >= len || CHAR_CLASS[bytes[k] as usize] & WORD_CHAR_MASK == 0 {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

/// Check for F17 "subtypes of" pattern
/// Matches: /\bsubtypes?\s+of\b/i
fn has_subtypes_of_pattern(bytes: &[u8]) -> bool {
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if i + 7 <= len && is_word_boundary(bytes, i) && matches_at(bytes, i, b"subtype") {
            let mut j = i + 7;
            // Optional 's' for "subtypes"
            if j < len && to_lower(bytes[j]) == b's' { j += 1; }
            // Require word boundary after subtype(s)
            if j < len && CHAR_CLASS[bytes[j] as usize] & WORD_CHAR_MASK != 0 {
                i += 1;
                continue;
            }
            // Skip whitespace
            while j < len && CHAR_CLASS[bytes[j] as usize] & SPACE != 0 { j += 1; }
            // Look for "of"
            if j + 2 <= len && matches_at(bytes, j, b"of") {
                let k = j + 2;
                if k >= len || CHAR_CLASS[bytes[k] as usize] & WORD_CHAR_MASK == 0 {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

/// Check for F17 "who extends" pattern
/// Matches: /\bwho\s+extends\b/i
fn has_who_extends_pattern(bytes: &[u8]) -> bool {
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if i + 3 <= len && is_word_boundary(bytes, i) && matches_at(bytes, i, b"who") {
            if i + 3 < len && CHAR_CLASS[bytes[i + 3] as usize] & WORD_CHAR_MASK != 0 {
                i += 1;
                continue;
            }
            let mut j = i + 3;
            // Skip whitespace
            while j < len && CHAR_CLASS[bytes[j] as usize] & SPACE != 0 { j += 1; }
            // Look for "extends"
            if j + 7 <= len && matches_at(bytes, j, b"extends") {
                let k = j + 7;
                if k >= len || CHAR_CLASS[bytes[k] as usize] & WORD_CHAR_MASK == 0 {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

/// Check for F39 "classes implementing" pattern
/// Matches: /\b(?:classes?|types?)\s+(?:that\s+)?implement(?:s|ing)?\b/i
fn has_classes_implementing_pattern(bytes: &[u8]) -> bool {
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        // Look for "class" or "type" at word boundary
        if i + 5 <= len && is_word_boundary(bytes, i) {
            let is_class = matches_at(bytes, i, b"class");
            let is_type = matches_at(bytes, i, b"type");
            if is_class || is_type {
                // Check for "classes" or "class" (optional 's' and 'es')
                let mut j = i + if is_class { 5 } else { 4 };
                // Handle "classes" or "types" (optional trailing 's' or 'es')
                if is_class && j < len && to_lower(bytes[j]) == b'e' { j += 1; }
                if j < len && to_lower(bytes[j]) == b's' { j += 1; }
                // Require word boundary after class/classes/type/types
                if j < len && CHAR_CLASS[bytes[j] as usize] & WORD_CHAR_MASK != 0 {
                    i += 1;
                    continue;
                }
                // Skip whitespace
                while j < len && CHAR_CLASS[bytes[j] as usize] & SPACE != 0 { j += 1; }
                // Optional "that "
                if j + 5 <= len && matches_at(bytes, j, b"that ") {
                    j += 5;
                    while j < len && CHAR_CLASS[bytes[j] as usize] & SPACE != 0 { j += 1; }
                }
                // Look for "implement", "implements", or "implementing"
                if j + 9 <= len && matches_at(bytes, j, b"implement") {
                    let mut k = j + 9;
                    // Check for "implements" or "implementing"
                    if k < len && to_lower(bytes[k]) == b's' { k += 1; }
                    else if k + 3 <= len && matches_at(bytes, k, b"ing") { k += 3; }
                    // Require word boundary after implement/implements/implementing
                    if k >= len || CHAR_CLASS[bytes[k] as usize] & WORD_CHAR_MASK == 0 {
                        return true;
                    }
                }
            }
        }
        i += 1;
    }
    false
}

/// Extract all 50 features from a query string (optimized)
pub fn extract_features(query: &str) -> [f32; 50] {
    let bytes = query.as_bytes();

    // Trim whitespace manually (no allocation)
    let mut start = 0;
    let mut end = bytes.len();
    while start < end && CHAR_CLASS[bytes[start] as usize] & SPACE != 0 {
        start += 1;
    }
    while end > start && CHAR_CLASS[bytes[end - 1] as usize] & SPACE != 0 {
        end -= 1;
    }

    let bytes = &bytes[start..end];
    let len = bytes.len();

    if len == 0 {
        return [0.0; 50];
    }

    let mut state = PassState::default();
    state.len = len;

    // === Single Pass: Character Classification + Pattern Detection ===
    let mut prev_class = 0u8;
    let mut consecutive_upper = 0u8;
    let mut in_token = false;

    for (i, &b) in bytes.iter().enumerate() {
        let class = CHAR_CLASS[b as usize];

        // Count character types
        if class & SPACE == 0 {
            state.non_space_count += 1;

            // Count characters (not bytes) - only count UTF-8 sequence starts
            if b < 128 {
                state.char_count += 1;  // ASCII char
            }

            if class & UPPER != 0 {
                state.uppercase_count += 1;
                state.current_token_has_ascii_letter = true;  // Track ASCII letter in current token
                consecutive_upper += 1;
                if consecutive_upper >= 2 {
                    state.has_consecutive_upper = true;
                }
            } else {
                consecutive_upper = 0;
            }

            if class & LOWER != 0 {
                state.lowercase_count += 1;
                state.current_token_has_ascii_letter = true;  // Track ASCII letter in current token
            }

            if class & DIGIT != 0 {
                state.digit_count += 1;
            }

            // Track valid identifier chars for F19 (JS isIdentifierName matches any alphanumeric word)
            // Valid JS identifier chars: A-Z, a-z, 0-9, _, $
            if class & (UPPER | LOWER | DIGIT | UNDER) != 0 || b == b'$' {
                state.current_token_identifier_len += 1;
            } else if b < 128 && class & SPACE == 0 {
                // Non-identifier ASCII char (not space, not alphanumeric, not _ or $)
                // Examples: ., -, !, @, #, etc.
                state.current_token_has_non_identifier = true;
            }
        }

        // Non-ASCII - count UTF-8 sequence starts for character counting
        // Detect script based on UTF-8 lead byte:
        // - 0xC0-0xC9: Latin Extended (U+00C0-U+024F) - treat as LATIN
        // - 0xD0-0xD3: Cyrillic (U+0400-0x4FF)
        // - 0xE4-0xE9: CJK (most Chinese/Japanese/Korean)
        // - 0xEA-0xED: CJK Korean Hangul (0xAC00-0xD7AF)
        if b > 127 {
            state.non_ascii_count += 1;  // Count all non-ASCII bytes
            // Count Unicode characters (UTF-8 sequence starts: 0xC0-0xFF)
            if b >= 0xC0 {
                state.non_ascii_char_count += 1;  // Count non-ASCII characters (not bytes)
                state.char_count += 1;  // Unicode char (one per sequence start)
                // Unicode letters are valid identifier chars in JS (UAX #31)
                state.current_token_identifier_len += 1;

                // Detect script for per-token tracking
                if b >= 0xC0 && b <= 0xC9 {
                    // Latin Extended (U+00C0-U+024F) - still LATIN script
                    state.current_token_has_latin_extended = true;
                } else if b >= 0xD0 && b <= 0xD3 {
                    // Cyrillic (U+0400-U+04FF)
                    state.current_token_has_cyrillic = true;
                    state.current_token_unicode_chars += 1;
                } else if b == 0xE3 && i + 1 < len {
                    // Japanese Hiragana (U+3040-U+309F) or Katakana (U+30A0-U+30FF)
                    // UTF-8: Hiragana E3 81 xx to E3 82 9F, Katakana E3 82 A0 to E3 83 BF
                    let b2 = bytes[i + 1];
                    if b2 == 0x81 || (b2 == 0x82 && i + 2 < len && bytes[i + 2] < 0xA0) {
                        // Hiragana
                        state.current_token_has_hiragana = true;
                    } else if b2 == 0x83 || (b2 == 0x82 && i + 2 < len && bytes[i + 2] >= 0xA0) {
                        // Katakana
                        state.current_token_has_katakana = true;
                    }
                    state.current_token_unicode_chars += 1;
                } else if (b >= 0xE4 && b <= 0xE9) || (b >= 0xEA && b <= 0xED) {
                    // CJK Unified Ideographs (Kanji/Hanzi)
                    state.current_token_has_cjk = true;
                    state.current_token_unicode_chars += 1;
                } else {
                    // Other non-Latin (Arabic, Hebrew, Hangul, etc.)
                    state.current_token_unicode_chars += 1;
                }
            }
        }

        // First char
        if i == 0 && class & UPPER != 0 {
            state.starts_with_upper = true;
        }

        // Camel boundary
        if prev_class & LOWER != 0 && class & UPPER != 0 {
            state.has_camel_boundary = true;
            state.current_token_has_camel = true;
        }

        // Underscore word
        if prev_class & UNDER != 0 && class & LOWER != 0 {
            state.has_underscore_word = true;
        }

        // Dot notation
        if class & DOT != 0 && prev_class & (UPPER | LOWER | DIGIT) != 0 {
            if i + 1 < len && CHAR_CLASS[bytes[i + 1] as usize] & (UPPER | LOWER | DIGIT) != 0 {
                state.has_dot_notation = true;
            }
        }

        // Parentheses pair
        if b == b'(' && i + 1 < len && bytes[i + 1] == b')' {
            state.has_parentheses = true;
        }

        // Path separator
        if class & PATH != 0 {
            state.has_path_sep = true;
        }

        // Question mark
        if b == b'?' {
            state.has_question_mark = true;
        }

        // Token counting
        if class & SPACE != 0 {
            if in_token {
                state.token_count += 1;
                // Check if token is identifier:
                // STRICT identifiers (for identifierPattern in F30, F31, F36):
                // - camelCase (has_current_token_has_camel)
                // - OR pure non-Latin (2+ Unicode chars AND no ASCII letters)
                // - OR mixed token with CJK substring (2+ unicode chars exist regardless of ASCII)
                //   (JS uses Intl.Segmenter which separates "認証Controller" into "認証" + "Controller")
                //
                // BROAD identifiers (for isIdentifierName in F19):
                // - Valid JS identifier word (2+ alphanumeric chars, no special chars)
                //   (JS isIdentifierName returns true for ANY alphanumeric word like "explain", "veto", etc.)
                let is_pure_non_latin = state.current_token_unicode_chars >= 2 && !state.current_token_has_ascii_letter;
                let has_cjk_substring = state.current_token_unicode_chars >= 2;  // CJK part is valid identifier
                let is_valid_word = state.current_token_identifier_len >= 2 && !state.current_token_has_non_identifier;
                // JS identifierPattern matches both ASCII CamelCase AND pure non-Latin (2+ consecutive non-ASCII)
                let is_identifier = state.current_token_has_camel || is_pure_non_latin;
                let any_identifier = is_identifier || has_cjk_substring;
                // Track valid words for F19 (any alphanumeric word)
                if is_valid_word {
                    state.has_any_valid_word = true;
                }
                if any_identifier {
                    state.has_any_identifier = true;
                    match state.token_count {
                        1 => state.first_token_is_identifier = is_identifier,
                        // Features 31, 36: JS identifierPattern includes non-Latin identifiers
                        2 => if is_identifier { state.second_token_is_identifier = true },
                        3 => if is_identifier { state.third_token_is_identifier = true },
                        4 => if is_identifier { state.fourth_token_is_identifier = true },
                        _ => {}
                    }
                    state.last_token_is_identifier = is_identifier;
                } else {
                    state.last_token_is_identifier = false;
                }
                if is_pure_non_latin || has_cjk_substring {
                    state.has_pure_non_latin_identifier = true;
                }
                // Check for mixed script token - multiple different scripts in same token
                // JS detectScripts treats: latin, cyrillic, cjk (Kanji), hiragana, katakana as DIFFERENT scripts
                let mut script_count = 0u8;
                if state.current_token_has_ascii_letter { script_count += 1; }
                if state.current_token_has_cyrillic { script_count += 1; }
                if state.current_token_has_cjk { script_count += 1; }
                if state.current_token_has_hiragana { script_count += 1; }
                if state.current_token_has_katakana { script_count += 1; }
                if script_count >= 2 {
                    state.has_mixed_script_token = true;
                }
                state.current_token_has_camel = false;
                state.current_token_unicode_chars = 0;
                state.current_token_has_ascii_letter = false;
                state.current_token_identifier_len = 0;
                state.current_token_has_non_identifier = false;
                state.current_token_has_cyrillic = false;
                state.current_token_has_cjk = false;
                state.current_token_has_hiragana = false;
                state.current_token_has_katakana = false;
                in_token = false;
            }
        } else if !in_token {
            in_token = true;
        }

        prev_class = class;
    }

    // Handle last token
    if in_token {
        state.token_count += 1;
        // Check if token is identifier:
        // STRICT identifiers (for identifierPattern in F30, F31, F36):
        // - camelCase (has_current_token_has_camel)
        // - OR pure non-Latin (2+ Unicode chars AND no ASCII letters)
        // - OR mixed token with CJK substring
        //
        // BROAD identifiers (for isIdentifierName in F19):
        // - Valid JS identifier word (2+ alphanumeric chars, no special chars)
        let is_pure_non_latin = state.current_token_unicode_chars >= 2 && !state.current_token_has_ascii_letter;
        let has_cjk_substring = state.current_token_unicode_chars >= 2;
        let is_valid_word = state.current_token_identifier_len >= 2 && !state.current_token_has_non_identifier;
        // JS identifierPattern matches both ASCII CamelCase AND pure non-Latin (2+ consecutive non-ASCII)
        let is_identifier = state.current_token_has_camel || is_pure_non_latin;
        let any_identifier = is_identifier || has_cjk_substring;
        // Track valid words for F19 (any alphanumeric word)
        if is_valid_word {
            state.has_any_valid_word = true;
        }
        if any_identifier {
            state.has_any_identifier = true;
            match state.token_count {
                1 => state.first_token_is_identifier = is_identifier,
                // Features 31, 36: JS identifierPattern includes non-Latin identifiers
                2 => if is_identifier { state.second_token_is_identifier = true },
                3 => if is_identifier { state.third_token_is_identifier = true },
                4 => if is_identifier { state.fourth_token_is_identifier = true },
                _ => {}
            }
            state.last_token_is_identifier = is_identifier;
        } else {
            // Fix: Reset last_token_is_identifier when last token is NOT an identifier
            state.last_token_is_identifier = false;
        }
        if is_pure_non_latin || has_cjk_substring {
            state.has_pure_non_latin_identifier = true;
        }
        // Check for mixed script token - multiple different scripts in same token
        // JS detectScripts treats: latin, cyrillic, cjk (Kanji), hiragana, katakana as DIFFERENT scripts
        let mut script_count = 0u8;
        if state.current_token_has_ascii_letter { script_count += 1; }
        if state.current_token_has_cyrillic { script_count += 1; }
        if state.current_token_has_cjk { script_count += 1; }
        if state.current_token_has_hiragana { script_count += 1; }
        if state.current_token_has_katakana { script_count += 1; }
        if script_count >= 2 {
            state.has_mixed_script_token = true;
        }
    }

    // === Keyword Detection (Single Pass) ===
    scan_keywords(bytes, &mut state.keywords);

    // === Architecture/Explanation Keywords (for feature 23) ===
    // Check for: architecture, understand, overview, design
    for i in 0..len {
        if !is_word_boundary(bytes, i) {
            continue;
        }
        let remaining = len - i;
        let b0 = to_lower(bytes[i]);
        match b0 {
            b'a' if remaining >= 12 && matches_at(bytes, i, b"architecture") && ends_word_boundary(bytes, i, 12) => {
                state.has_architecture_keyword = true;
                break;
            }
            b'u' if remaining >= 10 && matches_at(bytes, i, b"understand") && ends_word_boundary(bytes, i, 10) => {
                state.has_architecture_keyword = true;
                break;
            }
            b'o' if remaining >= 8 && matches_at(bytes, i, b"overview") && ends_word_boundary(bytes, i, 8) => {
                state.has_architecture_keyword = true;
                break;
            }
            b'd' if remaining >= 6 && matches_at(bytes, i, b"design") && ends_word_boundary(bytes, i, 6) => {
                state.has_architecture_keyword = true;
                break;
            }
            _ => {}
        }
    }

    // === Multilingual Analysis ===
    // Always scan for non-English patterns (German, Spanish, etc. can be pure ASCII)
    analyze_unicode(query, &mut state);
    scan_multilingual(query, &mut state);

    // === Fast ASCII Concept Stems (Feature 40) ===
    // JS detects stems like "config", "valid", "error" in any query (including ASCII).
    // These are in the Spanish/German stem lists and match common English words.
    // The scan_multilingual early exit may skip these for pure ASCII, so check here.
    if !state.has_non_english_concept_stem {
        scan_ascii_concept_stems(bytes, &mut state);
    }

    // === Build Feature Array ===
    let non_space = state.non_space_count.max(1) as f32;
    let char_count_f = state.char_count.max(1) as f32;  // Character count (not bytes) for ratios
    let token_count = state.token_count.max(1) as f32;

    let mut features = [0.0f32; 50];

    // Base Features (0-14)
    features[0] = if state.has_camel_boundary { 1.0 } else { 0.0 };
    features[1] = if state.has_underscore_word { 1.0 } else { 0.0 };
    features[2] = if state.starts_with_upper { 1.0 } else { 0.0 };
    features[3] = if state.has_consecutive_upper { 1.0 } else { 0.0 };
    features[4] = if state.token_count == 1 && len > 2 { 1.0 } else { 0.0 };
    features[5] = if state.has_dot_notation { 1.0 } else { 0.0 };
    features[6] = if state.has_parentheses { 1.0 } else { 0.0 };
    features[7] = if has_file_extension_fast(bytes) { 1.0 } else { 0.0 };
    features[8] = if state.has_path_sep { 1.0 } else { 0.0 };
    features[9] = token_count;
    // Feature 10: avgTokenLength - character count (not bytes) per token
    features[10] = state.char_count as f32 / token_count;
    features[11] = state.uppercase_count as f32 / char_count_f;  // Use char count, not byte count
    features[12] = state.digit_count as f32 / non_space;
    features[13] = state.non_ascii_char_count as f32 / char_count_f;  // Non-ASCII char ratio (chars, not bytes)
    // Feature 14: hasNonLatinScript - CJK, Cyrillic, Arabic, etc. (NOT Latin Extended like German umlauts)
    features[14] = if state.cjk_count > 0 || state.has_cyrillic { 1.0 } else { 0.0 };

    // Structural Features (15-19)
    let sk = &state.keywords.structural;
    // "where is X called" pattern: starts_with_where_is && has_called_word
    let where_is_called = state.keywords.starts_with_where_is && state.keywords.has_called_word;
    features[15] = if (*sk & (SK_CALLERS | SK_CALLER)) != 0 ||
                     ((*sk & SK_WHAT) != 0 && (*sk & SK_CALLS) != 0) ||
                     (*sk & SK_USAGES) != 0 ||
                     (*sk & SK_REFS) != 0 ||
                     where_is_called { 1.0 } else { 0.0 };
    features[16] = if (*sk & SK_CALLEES) != 0 ||
                     ((*sk & SK_WHAT) != 0 && (*sk & SK_CALL) != 0 && state.keywords.semantic & SE_DOES != 0) ||
                     (*sk & SK_DEPS) != 0 { 1.0 } else { 0.0 };
    // F17: hasImplementationPattern - matches SPECIFIC patterns, not just keywords
    // JS: /\b(implementations?\s+of|classes?\s+implementing|who\s+extends|subtypes?\s+of)\b/
    // Note: "implements of" does NOT match (only "implementation(s) of")
    features[17] = if has_implementations_of_pattern(bytes) ||
                     has_classes_implementing_pattern(bytes) ||
                     has_who_extends_pattern(bytes) ||
                     has_subtypes_of_pattern(bytes) { 1.0 } else { 0.0 };
    features[18] = if (*sk & (SK_IMPACT | SK_AFFECTED | SK_DOWNSTREAM | SK_DEPS)) != 0 { 1.0 } else { 0.0 };
    // Feature 19: hasIdentifierInQuery - any valid JS identifier word (not just code identifiers)
    // JS uses Babel's isIdentifierName which returns true for ANY alphanumeric word >= 2 chars
    features[19] = if state.has_any_valid_word || state.has_any_identifier || state.has_camel_boundary || state.has_consecutive_upper { 1.0 } else { 0.0 };

    // Semantic Features (20-24)
    features[20] = if state.keywords.question_start { 1.0 } else { 0.0 };
    features[21] = if state.has_question_mark { 1.0 } else { 0.0 };
    // Feature 22: hasSemanticConceptWord - ENGLISH semantic concepts only (NOT explain/describe/how/why/what)
    // These are checked: flow, process, mechanism, strategy, pattern, logic, algorithm, system, detection,
    // validation, authentication, handling, database, query, token, management, security, session, config, error, service, login, password, user
    let semantic_concept_mask = SE_FLOW | SE_PROCESS | SE_MECHANISM | SE_STRATEGY | SE_PATTERN | SE_LOGIC |
        SE_ALGORITHM | SE_SYSTEM | SE_DETECTION | SE_VALIDATION | SE_AUTH | SE_HANDLING | SE_DATABASE |
        SE_QUERY | SE_TOKEN | SE_MANAGEMENT | SE_SECURITY | SE_SESSION | SE_CONFIG | SE_ERROR | SE_SERVICE |
        SE_LOGIN | SE_PASSWORD | SE_USER;
    features[22] = if (state.keywords.semantic & semantic_concept_mask) != 0 { 1.0 } else { 0.0 };
    // Feature 23: hasExplanationRequest - explain, describe, understand, overview, architecture, design, how, why, what
    // JS regex: /\b(explain|describe|understand|overview|architecture|design|how|why|what)\b/
    // Note: Matches these words ANYWHERE in the query, not just at start
    features[23] = if (state.keywords.semantic & (SE_EXPLAIN | SE_DESCRIBE | SE_HOW | SE_WHY | SE_WHAT)) != 0 ||
                     state.has_architecture_keyword { 1.0 } else { 0.0 };
    features[24] = if (state.keywords.semantic & SE_HOW) != 0 &&
                     (state.keywords.semantic & SE_DOES) != 0 &&
                     (state.keywords.semantic & SE_WORK) != 0 { 1.0 } else { 0.0 };

    // Multilingual Features (25-29)
    // Feature 25: hasNonAsciiIdentifier - pure non-Latin identifier present (2+ non-ASCII chars, no ASCII letters)
    features[25] = if state.has_pure_non_latin_identifier { 1.0 } else { 0.0 };
    // Feature 26: hasMixedScriptToken - any single TOKEN has multiple scripts (code-switching within token)
    features[26] = if state.has_mixed_script_token { 1.0 } else { 0.0 };
    // Feature 27: hasStructuralKeywordNonEn - non-English structural pattern
    features[27] = if state.has_structural_keyword_non_en { 1.0 } else { 0.0 };
    // Feature 28: hasSemanticKeywordNonEn - non-English semantic pattern
    // JS returns false if ANY English semantic patterns match first (order matters)
    // IMPORTANT: Only keywords ACTUALLY IN JS SEMANTIC_PATTERNS.en count for English precedence
    // JS processWords.en and questionWords.en require trailing \s+ (space) to match
    // Only conceptWords.en uses \s*/ which can match at end of string
    // conceptWords.en: validation, authentication, authorization, caching, logging, security, performance,
    //                  optimization, database, queries, token, management, logic, session, configuration
    // NOT included: flow, process (require trailing space in JS processWords.en)
    //               explain, describe (require trailing space in JS questionWords.en)
    //               mechanism, strategy, algorithm, system, detection, handling, error, service, login,
    //               password, user, how, does, work (not in any JS SEMANTIC_PATTERNS.en)
    // Use semantic_loose for F28 - JS conceptWords.en uses \s*/ (no trailing boundary required)
    // This allows "session" in "SessionManager" to count as English precedence
    let english_semantic_pattern_mask = SE_PATTERN | SE_LOGIC |
        SE_VALIDATION | SE_AUTH | SE_DATABASE | SE_QUERY | SE_TOKEN |
        SE_MANAGEMENT | SE_SECURITY | SE_SESSION | SE_CONFIG;
    let any_english_semantic = (state.keywords.semantic_loose & english_semantic_pattern_mask) != 0 ||
                                state.keywords.question_start ||
                                state.keywords.explain_with_space;
    features[28] = if state.has_semantic_keyword_non_en && !any_english_semantic { 1.0 } else { 0.0 };
    // Feature 29: hasCrossScriptConcept - identifier in one script + concept in another
    // JS hasLatinConcept checks: flow, process, mechanism, logic, algorithm, authentication, validation,
    // security, management, database, query, token, check, handling, session, error, login, password, user, data, handle
    // Note: does NOT include "work", "how", "does", "explain", "describe"
    let has_latin_concept = (state.keywords.semantic & semantic_concept_mask) != 0;
    // JS hasNonLatinConcept: matchesSemanticPattern().matched && language !== 'en'
    // If any English semantic pattern matches first, hasNonLatinConcept = false
    let has_non_latin_concept = state.has_semantic_keyword_non_en && !any_english_semantic;
    features[29] = if state.has_latin && (state.has_cyrillic || state.cjk_count > 0) &&
                     (has_latin_concept || has_non_latin_concept) { 1.0 } else { 0.0 };

    // Discriminative Features (30-33)
    features[30] = if state.first_token_is_identifier { 1.0 } else { 0.0 };
    features[31] = if state.token_count > 1 && state.last_token_is_identifier { 1.0 } else { 0.0 };
    // Feature 32: hasExplicitStructuralKeyword - exclude question words (what/who/which)
    // These are not structural keywords, just stored in structural bitmask for composite checks
    let structural_without_questions = state.keywords.structural & !SK_QUESTION_WORDS;
    features[32] = if structural_without_questions != 0 { 1.0 } else { 0.0 };
    // Feature 33: hasUnknownTrailingContent - Identifier + unknown words = likely HYBRID
    // JS hasSemanticConcept does NOT include question/explanation words (why, what, how, explain, describe, work, does)
    // Only check actual concept words (flow, process, mechanism, system, token, etc.)
    let semantic_concepts_only = state.keywords.semantic & !(SE_WHY | SE_WHAT | SE_HOW | SE_EXPLAIN | SE_DESCRIBE | SE_WORK | SE_DOES);
    features[33] = if state.token_count > 1 &&
                     state.first_token_is_identifier &&
                     structural_without_questions == 0 &&
                     semantic_concepts_only == 0 { 1.0 } else { 0.0 };

    // Grammar Features (34-37)
    features[34] = get_identifier_index_fast(bytes, &state);
    features[35] = if state.keywords.action != 0 { 1.0 } else { 0.0 };
    // Feature 36: hasQuestionIdentifier - "How does [Identifier]..." pattern
    // Logic: isQuestion AND (tokens[2] is identifier OR (tokens.length > 3 AND tokens[3] is identifier))
    // JS uses strict identifierPattern (camelCase/PascalCase/non-Latin), not just any word
    features[36] = if state.keywords.question_start && state.token_count > 2 &&
                     (state.third_token_is_identifier || (state.token_count > 3 && state.fourth_token_is_identifier)) { 1.0 } else { 0.0 };
    features[37] = (state.keywords.structural_count as f32 / 5.0).min(1.0);

    // Final Push Features (38-42)
    // hasVerifiedAsciiIdentifier: camelCase, snake_case, or SCREAMING_SNAKE_CASE
    features[38] = if state.has_camel_boundary || state.has_underscore_word ||
                     has_screaming_snake_case(bytes) { 1.0 } else { 0.0 };
    // F39: structuralTemplateMatch - multiple templates from JS
    // 1. "(what|who|which) (invokes?|calls?|uses?|references?) ..."
    // 2. "classes/types implementing" pattern
    // Note: SK_INVOKE is in structural_expanded (F42 only), so check both
    let all_structural = state.keywords.structural | state.keywords.structural_expanded;
    let template_match_1 = (state.keywords.structural & (SK_WHAT | SK_WHO | SK_WHICH)) != 0 &&
                           (all_structural & (SK_INVOKE | SK_CALLS | SK_CALL | SK_USES | SK_REFS)) != 0;
    let template_match_2 = has_classes_implementing_pattern(bytes);
    features[39] = if template_match_1 || template_match_2 { 1.0 } else { 0.0 };
    // Feature 40: hasNonEnglishConceptStem - non-English concept word stems detected
    // JS returns a fraction based on stem count/total, but models it as ~0.3-0.6
    // Simplified: return 1.0 for any match (boolean-like, matches JS behavior for most cases)
    features[40] = if state.has_non_english_concept_stem { 1.0 } else { 0.0 };
    features[41] = if state.non_ascii_char_count as f32 / char_count_f > 0.7 && features[38] == 0.0 { 1.0 } else { 0.0 };
    // Feature 42: expandedStructuralKeywordPresence - ENGLISH structural keywords only (not non-English)
    // Includes -ing forms like "implementing" which are not in F32's explicit list
    // Exclude question words (what/who/which) AND "impact" (in F32 but NOT in F42)
    // JS F42 regex: invoke[sd]?|invoking|...|affects?|affected|affecting|downstream|upstream|... (no "impact")
    let expanded_structural = (state.keywords.structural | state.keywords.structural_expanded) & !(SK_QUESTION_WORDS | SK_IMPACT);
    features[42] = if expanded_structural != 0 { 1.0 } else { 0.0 };

    // Zen Features (43-49)
    // Feature 43: cjkDensity - CJK character ratio (blocks LEXICAL for CJK text)
    features[43] = state.cjk_count as f32 / char_count_f;  // Use char count, not byte count
    // Feature 44: effectiveTokenCount - for CJK, estimate by char count / 3
    let effective_token_count = if state.cjk_count as f32 / char_count_f > 0.5 {
        // CJK text: estimate tokens by character count / 3
        (state.cjk_count as f32 / 3.0).ceil().max(state.token_count as f32)
    } else {
        state.token_count as f32
    };
    features[44] = (effective_token_count / 10.0).min(1.0);
    features[45] = if effective_token_count >= 4.0 && state.keywords.question_start { 1.0 } else { 0.0 };
    // Feature 46: isStructuralQuestion - includes non-English structural keywords
    // Exclude question words from structural check (same as F32/F42)
    features[46] = if state.keywords.question_start && (structural_without_questions != 0 || state.has_structural_keyword_non_en) { 1.0 } else { 0.0 };
    // Feature 47: tokenCharacterDensity - German compound detector
    // Use char_count (characters) not non_space_count (bytes) to match JS chars.length
    features[47] = if state.token_count == 1 && state.char_count > 15 &&
                     !state.has_camel_boundary && !state.has_underscore_word {
                     (state.char_count as f32 / 30.0).min(1.0)
                 } else { 0.0 };
    // Feature 48: hasNonLatinIdentifier - Cyrillic or other non-Latin PascalCase
    features[48] = if state.has_cyrillic && !state.has_camel_boundary && state.token_count == 1 { 1.0 } else { 0.0 };
    features[49] = if has_all_caps_constant_fast(bytes) { 1.0 } else { 0.0 };

    features
}

/// Fast file extension check (no allocation)
fn has_file_extension_fast(bytes: &[u8]) -> bool {
    // Find last dot
    let mut dot_pos = None;
    for (i, &b) in bytes.iter().enumerate().rev() {
        if b == b'.' {
            dot_pos = Some(i);
            break;
        }
    }

    let dot_pos = match dot_pos {
        Some(p) if p + 1 < bytes.len() => p,
        _ => return false,
    };

    let ext = &bytes[dot_pos + 1..];
    let ext_len = ext.len();

    // Check common extensions (sorted by frequency)
    matches!(
        (ext_len, to_lower(ext.get(0).copied().unwrap_or(0)),
                  to_lower(ext.get(1).copied().unwrap_or(0)),
                  to_lower(ext.get(2).copied().unwrap_or(0)),
                  to_lower(ext.get(3).copied().unwrap_or(0))),
        (2, b'j', b's', _, _) |        // js
        (2, b't', b's', _, _) |        // ts
        (2, b'p', b'y', _, _) |        // py
        (2, b'r', b's', _, _) |        // rs
        (2, b'g', b'o', _, _) |        // go
        (2, b'm', b'd', _, _) |        // md
        (2, b'r', b'b', _, _) |        // rb
        (1, b'c', _, _, _) |           // c
        (1, b'h', _, _, _) |           // h
        (3, b'j', b's', b'x', _) |     // jsx
        (3, b't', b's', b'x', _) |     // tsx
        (3, b'c', b'p', b'p', _) |     // cpp
        (4, b'j', b'a', b'v', b'a') |  // java
        (4, b'j', b's', b'o', b'n') |  // json
        (5, b'p', b'r', b'o', b't') |  // proto (first 4 chars)
        (5, b's', b'w', b'i', b'f')    // swift (first 4 chars)
    )
}

/// Fast identifier index calculation (no Vec allocation)
/// Finds position of first identifier token (camelCase, consecutive upper, or 2+ Unicode chars)
fn get_identifier_index_fast(bytes: &[u8], state: &PassState) -> f32 {
    // Early exit if no identifiers in query at all
    if !state.has_any_identifier && !state.has_camel_boundary && !state.has_consecutive_upper {
        return 0.0;
    }

    // Scan for first identifier token
    let mut token_idx = 0;
    let mut in_token = false;
    let mut prev_lower = false;
    let mut token_unicode_chars = 0usize;
    let mut token_has_ascii_letter = false;

    for &b in bytes {
        let class = CHAR_CLASS[b as usize];

        if class & SPACE != 0 {
            if in_token {
                // Check if current token is a pure non-Latin identifier (2+ unicode chars, no ASCII letters)
                if token_unicode_chars >= 2 && !token_has_ascii_letter {
                    return ((token_idx + 1) as f32 / 10.0).min(1.0);
                }
                token_idx += 1;
                token_unicode_chars = 0;
                token_has_ascii_letter = false;
            }
            in_token = false;
            prev_lower = false;
        } else {
            if !in_token {
                in_token = true;
            }
            // Check for camelCase
            if prev_lower && class & UPPER != 0 {
                return ((token_idx + 1) as f32 / 10.0).min(1.0);
            }
            prev_lower = class & LOWER != 0;

            // Track ASCII letters
            if class & (UPPER | LOWER) != 0 {
                token_has_ascii_letter = true;
            }

            // Count UTF-8 sequence starts for Unicode identifier detection
            if b >= 0xC0 {
                token_unicode_chars += 1;
            }
        }
    }

    // Check last token
    if in_token && token_unicode_chars >= 2 && !token_has_ascii_letter {
        return ((token_idx + 1) as f32 / 10.0).min(1.0);
    }

    0.0
}

/// Check for SCREAMING_SNAKE_CASE (e.g., MAX_CONNECTION_POOL_SIZE)
fn has_screaming_snake_case(bytes: &[u8]) -> bool {
    if bytes.len() <= 3 || !bytes.contains(&b'_') {
        return false;
    }

    // All characters must be uppercase, underscore, or digit
    let all_valid = bytes.iter().all(|&b| {
        CHAR_CLASS[b as usize] & (UPPER | UNDER | DIGIT) != 0
    });

    // Must have at least one uppercase
    let has_upper = bytes.iter().any(|&b| CHAR_CLASS[b as usize] & UPPER != 0);

    all_valid && has_upper
}

/// Fast all-caps constant check (no allocation)
fn has_all_caps_constant_fast(bytes: &[u8]) -> bool {
    let mut token_start = 0;
    let mut in_token = false;

    for (i, &b) in bytes.iter().enumerate() {
        let class = CHAR_CLASS[b as usize];

        if class & SPACE != 0 {
            if in_token && i - token_start > 3 {
                // Check if token is all-caps
                let token = &bytes[token_start..i];
                let all_upper = token.iter().all(|&b| {
                    CHAR_CLASS[b as usize] & (UPPER | UNDER | DIGIT) != 0
                });
                let has_upper = token.iter().any(|&b| CHAR_CLASS[b as usize] & UPPER != 0);
                if all_upper && has_upper {
                    return true;
                }
            }
            in_token = false;
        } else {
            if !in_token {
                token_start = i;
                in_token = true;
            }
        }
    }

    // Check last token
    if in_token && bytes.len() - token_start > 3 {
        let token = &bytes[token_start..];
        let all_upper = token.iter().all(|&b| {
            CHAR_CLASS[b as usize] & (UPPER | UNDER | DIGIT) != 0
        });
        let has_upper = token.iter().any(|&b| CHAR_CLASS[b as usize] & UPPER != 0);
        if all_upper && has_upper {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base_features() {
        let f = extract_features("AuthService");
        assert_eq!(f[0], 1.0);  // hasCamelBoundary
        assert_eq!(f[2], 1.0);  // startsWithUppercase
        assert_eq!(f[4], 1.0);  // isSingleToken
    }

    #[test]
    fn test_semantic_features() {
        let f = extract_features("how does authentication work");
        assert_eq!(f[20], 1.0);  // startsWithQuestionWord
        assert_eq!(f[24], 1.0);  // hasHowDoesWorkPattern
    }

    #[test]
    fn test_structural_features() {
        let f = extract_features("what calls AuthService");
        assert_eq!(f[15], 1.0);  // hasCallerPattern
        assert_eq!(f[19], 1.0);  // hasIdentifierInQuery
    }

    #[test]
    fn test_keyword_scanner() {
        let mut kw = KeywordBits::default();
        scan_keywords(b"what calls AuthService", &mut kw);
        assert!(kw.structural & SK_WHAT != 0);
        assert!(kw.structural & SK_CALLS != 0);
    }
}
