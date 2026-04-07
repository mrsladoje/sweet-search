//! Single-pass Feature Extraction
//!
//! Extracts all 50 features in a single pass through the query string.
//! Uses lookup tables for O(1) character classification.
//!
//! Target: <2μs for feature extraction (vs ~150μs in JS)

/// Character classification flags (packed into u8)
const UPPER: u8 = 0b0000_0001;  // A-Z
const LOWER: u8 = 0b0000_0010;  // a-z
const DIGIT: u8 = 0b0000_0100;  // 0-9
const SPACE: u8 = 0b0000_1000;  // whitespace
const UNDER: u8 = 0b0001_0000;  // underscore
const DOT: u8   = 0b0010_0000;  // period
const PAREN: u8 = 0b0100_0000;  // ()
const PATH: u8  = 0b1000_0000;  // / or \

/// ASCII lookup table for character classification (256 bytes)
static CHAR_CLASS: [u8; 256] = {
    let mut table = [0u8; 256];

    // Uppercase A-Z (65-90)
    let mut i = 65;
    while i <= 90 {
        table[i] = UPPER;
        i += 1;
    }

    // Lowercase a-z (97-122)
    i = 97;
    while i <= 122 {
        table[i] = LOWER;
        i += 1;
    }

    // Digits 0-9 (48-57)
    i = 48;
    while i <= 57 {
        table[i] = DIGIT;
        i += 1;
    }

    // Whitespace
    table[b' ' as usize] = SPACE;
    table[b'\t' as usize] = SPACE;
    table[b'\n' as usize] = SPACE;
    table[b'\r' as usize] = SPACE;

    // Special characters
    table[b'_' as usize] = UNDER;
    table[b'.' as usize] = DOT;
    table[b'(' as usize] = PAREN;
    table[b')' as usize] = PAREN;
    table[b'/' as usize] = PATH;
    table[b'\\' as usize] = PATH;

    table
};

/// Check if byte is in a character class
#[inline(always)]
fn is_class(b: u8, class: u8) -> bool {
    CHAR_CLASS[b as usize] & class != 0
}

/// Unicode range checks for CJK
#[inline(always)]
fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{4e00}'..='\u{9fff}' |  // CJK Unified
        '\u{3040}'..='\u{309f}' |  // Hiragana
        '\u{30a0}'..='\u{30ff}' |  // Katakana
        '\u{ac00}'..='\u{d7af}'    // Korean Hangul
    )
}

/// Check for non-Latin scripts (CJK, Cyrillic, Arabic, etc.)
#[inline(always)]
fn is_non_latin(c: char) -> bool {
    matches!(c,
        '\u{4e00}'..='\u{9fff}' |  // CJK
        '\u{0400}'..='\u{04ff}' |  // Cyrillic
        '\u{0600}'..='\u{06ff}' |  // Arabic
        '\u{0980}'..='\u{09ff}' |  // Bengali
        '\u{3040}'..='\u{30ff}' |  // Japanese
        '\u{ac00}'..='\u{d7af}'    // Korean
    )
}

/// Check for Cyrillic uppercase
#[inline(always)]
fn is_cyrillic_upper(c: char) -> bool {
    matches!(c, '\u{0410}'..='\u{042f}')
}

/// Check for Cyrillic lowercase
#[inline(always)]
fn is_cyrillic_lower(c: char) -> bool {
    matches!(c, '\u{0430}'..='\u{044f}')
}

/// Feature extraction state - accumulated during single pass
#[derive(Default)]
struct FeatureState {
    // Counters
    char_count: usize,
    non_space_count: usize,
    uppercase_count: usize,
    lowercase_count: usize,
    digit_count: usize,
    non_ascii_count: usize,
    cjk_count: usize,
    token_count: usize,

    // Flags (detected patterns)
    has_camel_boundary: bool,      // Feature 0
    has_underscore_word: bool,     // Feature 1
    starts_with_upper: bool,       // Feature 2
    has_consecutive_upper: bool,   // Feature 3
    has_dot_notation: bool,        // Feature 5
    has_parentheses: bool,         // Feature 6
    has_file_extension: bool,      // Feature 7
    has_path_separator: bool,      // Feature 8
    has_non_latin: bool,           // Feature 14
    has_question_mark: bool,

    // Position tracking
    prev_char_class: u8,
    consecutive_upper: u8,
    in_token: bool,
    first_char_seen: bool,

    // Token tracking for structural features
    first_token_is_identifier: bool,
    last_token_is_identifier: bool,
    current_token_start: usize,
    current_token_len: usize,
    current_token_is_identifier: bool,

    // Script transition tracking for CJK
    script_transitions: usize,
    prev_script: u8,  // 0=none, 1=kanji, 2=hiragana, 3=katakana
}

/// File extensions to detect (sorted for binary search)
const FILE_EXTENSIONS: [&str; 18] = [
    "c", "cpp", "go", "h", "java", "js", "json", "jsx", "kt", "md",
    "php", "proto", "py", "rb", "rs", "swift", "ts", "tsx",
];

/// Check if query ends with a known file extension
fn has_file_extension(query: &str) -> bool {
    if let Some(dot_pos) = query.rfind('.') {
        let ext = &query[dot_pos + 1..];
        let ext_lower = ext.to_ascii_lowercase();
        FILE_EXTENSIONS.binary_search(&ext_lower.as_str()).is_ok()
    } else {
        false
    }
}

/// Convert byte to lowercase inline (no allocation)
#[inline(always)]
fn to_lower(b: u8) -> u8 {
    if b >= b'A' && b <= b'Z' {
        b + 32
    } else {
        b
    }
}

/// Case-insensitive byte sequence match with early termination
#[inline(always)]
fn contains_ci(haystack: &[u8], needle: &[u8]) -> bool {
    let needle_len = needle.len();
    let haystack_len = haystack.len();

    if needle_len == 0 || needle_len > haystack_len {
        return needle_len == 0;
    }

    let first_lower = to_lower(needle[0]);
    let end = haystack_len - needle_len + 1;

    let mut i = 0;
    while i < end {
        // Fast path: skip bytes that don't match first char
        if to_lower(haystack[i]) != first_lower {
            i += 1;
            continue;
        }

        // Check full match
        let mut matched = true;
        for j in 1..needle_len {
            if to_lower(haystack[i + j]) != to_lower(needle[j]) {
                matched = false;
                break;
            }
        }

        if matched {
            return true;
        }
        i += 1;
    }

    false
}

/// Case-insensitive starts_with check
#[inline(always)]
fn starts_with_ci(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.len() > haystack.len() {
        return false;
    }
    haystack[..needle.len()].iter().zip(needle.iter()).all(|(&a, &b)| to_lower(a) == to_lower(b))
}

/// Extract all 50 features from a query string
pub fn extract_features(query: &str) -> [f32; 50] {
    let trimmed = query.trim();
    let bytes = trimmed.as_bytes();
    let len = bytes.len();

    if len == 0 {
        return [0.0; 50];
    }

    let mut state = FeatureState::default();

    // Single pass through the string
    for (i, &b) in bytes.iter().enumerate() {
        let class = CHAR_CLASS[b as usize];

        // Count character types
        if class & SPACE == 0 {
            state.non_space_count += 1;

            if class & UPPER != 0 {
                state.uppercase_count += 1;
                state.consecutive_upper += 1;
                if state.consecutive_upper >= 2 {
                    state.has_consecutive_upper = true;  // Feature 3
                }
            } else {
                state.consecutive_upper = 0;
            }

            if class & LOWER != 0 {
                state.lowercase_count += 1;
            }

            if class & DIGIT != 0 {
                state.digit_count += 1;
            }
        }

        // Non-ASCII detection
        if b > 127 {
            state.non_ascii_count += 1;
        }

        // Pattern detection
        if !state.first_char_seen {
            state.first_char_seen = true;
            if class & UPPER != 0 {
                state.starts_with_upper = true;  // Feature 2
            }
        }

        // Camel boundary: lowercase followed by uppercase
        if state.prev_char_class & LOWER != 0 && class & UPPER != 0 {
            state.has_camel_boundary = true;  // Feature 0
        }

        // Underscore word: underscore followed by lowercase
        if state.prev_char_class & UNDER != 0 && class & LOWER != 0 {
            state.has_underscore_word = true;  // Feature 1
        }

        // Dot notation: word char, dot, word char
        if class & DOT != 0 {
            if state.prev_char_class & (UPPER | LOWER | DIGIT) != 0 {
                if i + 1 < len {
                    let next_class = CHAR_CLASS[bytes[i + 1] as usize];
                    if next_class & (UPPER | LOWER | DIGIT) != 0 {
                        state.has_dot_notation = true;  // Feature 5
                    }
                }
            }
        }

        // Parentheses pair ()
        if class & PAREN != 0 && b == b'(' {
            if i + 1 < len && bytes[i + 1] == b')' {
                state.has_parentheses = true;  // Feature 6
            }
        }

        // Path separator
        if class & PATH != 0 {
            state.has_path_separator = true;  // Feature 8
        }

        // Question mark
        if b == b'?' {
            state.has_question_mark = true;
        }

        // Token counting
        if class & SPACE != 0 {
            if state.in_token {
                state.token_count += 1;
                state.in_token = false;

                // Check if this token looks like an identifier
                if state.current_token_is_identifier {
                    if state.token_count == 1 {
                        state.first_token_is_identifier = true;
                    }
                    state.last_token_is_identifier = true;
                } else {
                    state.last_token_is_identifier = false;
                }

                state.current_token_is_identifier = false;
                state.current_token_len = 0;
            }
        } else {
            if !state.in_token {
                state.in_token = true;
                state.current_token_start = i;
            }
            state.current_token_len += 1;

            // Check for identifier patterns in current token
            if state.has_camel_boundary {
                state.current_token_is_identifier = true;
            }
        }

        state.prev_char_class = class;
        state.char_count += 1;
    }

    // Handle last token
    if state.in_token {
        state.token_count += 1;
        if state.current_token_is_identifier {
            if state.token_count == 1 {
                state.first_token_is_identifier = true;
            }
            state.last_token_is_identifier = true;
        }
    }

    // Unicode pass for CJK and non-Latin detection
    for c in trimmed.chars() {
        if is_cjk(c) {
            state.cjk_count += 1;

            // Track script transitions for effective token count
            let script = match c {
                '\u{4e00}'..='\u{9fff}' => 1, // Kanji
                '\u{3040}'..='\u{309f}' => 2, // Hiragana
                '\u{30a0}'..='\u{30ff}' => 3, // Katakana
                _ => 0,
            };
            if state.prev_script != 0 && script != 0 && state.prev_script != script {
                state.script_transitions += 1;
            }
            state.prev_script = script;
        }
        if is_non_latin(c) {
            state.has_non_latin = true;
        }
    }

    // File extension check
    state.has_file_extension = has_file_extension(trimmed);

    // Compute derived features
    let non_space = state.non_space_count.max(1) as f32;
    let token_count = state.token_count.max(1);

    // CJK density and effective token count
    let cjk_density = state.cjk_count as f32 / non_space;
    let effective_token_count = if cjk_density > 0.5 {
        (state.token_count)
            .max(state.script_transitions + 1)
            .max((state.cjk_count + 2) / 3)
    } else {
        state.token_count
    };

    // Build feature array
    let mut features = [0.0f32; 50];

    // === Base Features (0-14) ===
    features[0] = if state.has_camel_boundary { 1.0 } else { 0.0 };
    features[1] = if state.has_underscore_word { 1.0 } else { 0.0 };
    features[2] = if state.starts_with_upper { 1.0 } else { 0.0 };
    features[3] = if state.has_consecutive_upper { 1.0 } else { 0.0 };
    features[4] = if !trimmed.contains(' ') && trimmed.len() > 2 { 1.0 } else { 0.0 };
    features[5] = if state.has_dot_notation { 1.0 } else { 0.0 };
    features[6] = if state.has_parentheses { 1.0 } else { 0.0 };
    features[7] = if state.has_file_extension { 1.0 } else { 0.0 };
    features[8] = if state.has_path_separator { 1.0 } else { 0.0 };
    features[9] = token_count as f32;
    features[10] = state.non_space_count as f32 / token_count as f32;
    features[11] = state.uppercase_count as f32 / non_space;
    features[12] = state.digit_count as f32 / non_space;
    features[13] = state.non_ascii_count as f32 / non_space;
    features[14] = if state.has_non_latin { 1.0 } else { 0.0 };

    // === Structural Features (15-19) ===
    features[15] = if has_caller_pattern_fast(bytes) { 1.0 } else { 0.0 };
    features[16] = if has_callee_pattern_fast(bytes) { 1.0 } else { 0.0 };
    features[17] = if has_implementation_pattern_fast(bytes) { 1.0 } else { 0.0 };
    features[18] = if has_impact_pattern_fast(bytes) { 1.0 } else { 0.0 };
    features[19] = if has_identifier_in_query(trimmed) { 1.0 } else { 0.0 };

    // === Semantic Features (20-24) ===
    features[20] = if starts_with_question_word_fast(bytes) { 1.0 } else { 0.0 };
    features[21] = if state.has_question_mark { 1.0 } else { 0.0 };
    features[22] = if has_semantic_concept_fast(bytes) { 1.0 } else { 0.0 };
    features[23] = if has_explanation_request_fast(bytes) { 1.0 } else { 0.0 };
    features[24] = if has_how_does_work_pattern_fast(bytes) { 1.0 } else { 0.0 };

    // === Multilingual Features (25-29) ===
    features[25] = if has_non_ascii_identifier(trimmed) { 1.0 } else { 0.0 };
    features[26] = if has_mixed_script(trimmed) { 1.0 } else { 0.0 };
    features[27] = 0.0; // TODO: Non-English structural keywords (rare)
    features[28] = 0.0; // TODO: Non-English semantic keywords (rare)
    features[29] = if has_cross_script_concept(trimmed) { 1.0 } else { 0.0 };

    // === Discriminative Features (30-33) ===
    features[30] = if state.first_token_is_identifier { 1.0 } else { 0.0 };
    features[31] = if state.token_count > 1 && state.last_token_is_identifier { 1.0 } else { 0.0 };
    features[32] = if has_explicit_structural_keyword_fast(bytes) { 1.0 } else { 0.0 };
    features[33] = if has_unknown_trailing_content(trimmed, &features) { 1.0 } else { 0.0 };

    // === Grammar Features (34-37) ===
    features[34] = get_identifier_index(trimmed);
    features[35] = if has_action_verb_fast(bytes) { 1.0 } else { 0.0 };
    features[36] = if has_question_identifier(trimmed) { 1.0 } else { 0.0 };
    features[37] = get_structural_keyword_count_fast(bytes);

    // === Final Push Features (38-42) ===
    features[38] = if has_verified_ascii_identifier(trimmed) { 1.0 } else { 0.0 };
    features[39] = if has_structural_template_fast(bytes) { 1.0 } else { 0.0 };
    features[40] = if has_non_english_concept_stem(trimmed) { 1.0 } else { 0.0 };
    features[41] = if state.non_ascii_count as f32 / non_space > 0.7 && features[38] == 0.0 { 1.0 } else { 0.0 };
    features[42] = if has_expanded_structural_keyword_fast(bytes) { 1.0 } else { 0.0 };

    // === Zen Features (43-49) ===
    features[43] = cjk_density;
    features[44] = (effective_token_count as f32 / 10.0).min(1.0);
    features[45] = if effective_token_count >= 4 && features[20] == 1.0 { 1.0 } else { 0.0 };
    features[46] = if features[20] == 1.0 && (features[32] == 1.0 || features[42] == 1.0) { 1.0 } else { 0.0 };
    features[47] = get_token_character_density(trimmed, &state);
    features[48] = if has_non_latin_identifier(trimmed) { 1.0 } else { 0.0 };
    features[49] = if has_all_caps_constant(trimmed) { 1.0 } else { 0.0 };

    features
}

// === Pattern Detection Functions (Fast, no-allocation versions) ===

fn has_caller_pattern_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"callers of") || contains_ci(bytes, b"caller of") ||
    contains_ci(bytes, b"what calls") || contains_ci(bytes, b"who calls") ||
    contains_ci(bytes, b"usages of") || contains_ci(bytes, b"usage of") ||
    contains_ci(bytes, b"references to") || contains_ci(bytes, b"reference to") ||
    (contains_ci(bytes, b"where is") && contains_ci(bytes, b"called"))
}

fn has_callee_pattern_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"callees of") || contains_ci(bytes, b"callee of") ||
    (contains_ci(bytes, b"what does") && contains_ci(bytes, b"call")) ||
    contains_ci(bytes, b"dependencies of") || contains_ci(bytes, b"dependency of") ||
    contains_ci(bytes, b"methods called by")
}

fn has_implementation_pattern_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"implementations of") || contains_ci(bytes, b"implementation of") ||
    contains_ci(bytes, b"classes implementing") || contains_ci(bytes, b"class implementing") ||
    contains_ci(bytes, b"who extends") || contains_ci(bytes, b"what extends") ||
    contains_ci(bytes, b"subtypes of") || contains_ci(bytes, b"subtype of")
}

fn has_impact_pattern_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"impact of") || contains_ci(bytes, b"affected by") ||
    contains_ci(bytes, b"depends on") || contains_ci(bytes, b"depend on") ||
    contains_ci(bytes, b"downstream effects") || contains_ci(bytes, b"downstream effect") ||
    contains_ci(bytes, b"will break")
}

// Keep old versions for compatibility
fn has_caller_pattern(lower: &str) -> bool {
    lower.contains("callers of") || lower.contains("caller of") ||
    lower.contains("what calls") || lower.contains("who calls") ||
    lower.contains("usages of") || lower.contains("usage of") ||
    lower.contains("references to") || lower.contains("reference to") ||
    lower.contains("where is") && lower.contains("called")
}

fn has_callee_pattern(lower: &str) -> bool {
    lower.contains("callees of") || lower.contains("callee of") ||
    lower.contains("what does") && lower.contains("call") ||
    lower.contains("dependencies of") || lower.contains("dependency of") ||
    lower.contains("methods called by")
}

fn has_implementation_pattern(lower: &str) -> bool {
    lower.contains("implementations of") || lower.contains("implementation of") ||
    lower.contains("classes implementing") || lower.contains("class implementing") ||
    lower.contains("who extends") || lower.contains("what extends") ||
    lower.contains("subtypes of") || lower.contains("subtype of")
}

fn has_impact_pattern(lower: &str) -> bool {
    lower.contains("impact of") || lower.contains("affected by") ||
    lower.contains("depends on") || lower.contains("depend on") ||
    lower.contains("downstream effects") || lower.contains("downstream effect") ||
    lower.contains("will break")
}

fn has_identifier_in_query(query: &str) -> bool {
    // Check for PascalCase or camelCase
    let bytes = query.as_bytes();
    let mut prev_lower = false;

    for &b in bytes {
        let class = CHAR_CLASS[b as usize];
        if prev_lower && class & UPPER != 0 {
            return true;
        }
        prev_lower = class & LOWER != 0;
    }

    // Check for Unicode identifiers
    for c in query.chars() {
        if is_cyrillic_upper(c) {
            return true;
        }
    }

    false
}

// Fast versions (no allocation)
fn starts_with_question_word_fast(bytes: &[u8]) -> bool {
    starts_with_ci(bytes, b"how ") || starts_with_ci(bytes, b"what ") ||
    starts_with_ci(bytes, b"why ") || starts_with_ci(bytes, b"where ") ||
    starts_with_ci(bytes, b"when ") || starts_with_ci(bytes, b"which ") ||
    starts_with_ci(bytes, b"who ") || starts_with_ci(bytes, b"can ") ||
    starts_with_ci(bytes, b"does ") || starts_with_ci(bytes, b"is ") ||
    starts_with_ci(bytes, b"are ") || starts_with_ci(bytes, b"should ")
}

fn has_semantic_concept_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"flow") || contains_ci(bytes, b"process") ||
    contains_ci(bytes, b"mechanism") || contains_ci(bytes, b"strategy") ||
    contains_ci(bytes, b"pattern") || contains_ci(bytes, b"approach") ||
    contains_ci(bytes, b"logic") || contains_ci(bytes, b"algorithm") ||
    contains_ci(bytes, b"system") || contains_ci(bytes, b"detection") ||
    contains_ci(bytes, b"validation") || contains_ci(bytes, b"authentication") ||
    contains_ci(bytes, b"handling") || contains_ci(bytes, b"database") ||
    contains_ci(bytes, b"query") || contains_ci(bytes, b"token") ||
    contains_ci(bytes, b"management") || contains_ci(bytes, b"security") ||
    contains_ci(bytes, b"check") || contains_ci(bytes, b"session") ||
    contains_ci(bytes, b"config") || contains_ci(bytes, b"error") ||
    contains_ci(bytes, b"request") || contains_ci(bytes, b"response") ||
    contains_ci(bytes, b"service") || contains_ci(bytes, b"login") ||
    contains_ci(bytes, b"password") || contains_ci(bytes, b"reset") ||
    contains_ci(bytes, b"user") || contains_ci(bytes, b"data") ||
    contains_ci(bytes, b"storage") || contains_ci(bytes, b"cache") ||
    contains_ci(bytes, b"sync")
}

fn has_explanation_request_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"explain") || contains_ci(bytes, b"describe") ||
    contains_ci(bytes, b"understand") || contains_ci(bytes, b"overview") ||
    contains_ci(bytes, b"architecture") || contains_ci(bytes, b"design") ||
    contains_ci(bytes, b"how") || contains_ci(bytes, b"why") || contains_ci(bytes, b"what")
}

fn has_how_does_work_pattern_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"how does") && contains_ci(bytes, b"work")
}

fn has_explicit_structural_keyword_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"calls") || contains_ci(bytes, b"call") ||
    contains_ci(bytes, b"callers") || contains_ci(bytes, b"caller") ||
    contains_ci(bytes, b"callees") || contains_ci(bytes, b"callee") ||
    contains_ci(bytes, b"uses") || contains_ci(bytes, b"usages") ||
    contains_ci(bytes, b"references") || contains_ci(bytes, b"reference") ||
    contains_ci(bytes, b"implementations") || contains_ci(bytes, b"implementation") ||
    contains_ci(bytes, b"implements") || contains_ci(bytes, b"implement") ||
    contains_ci(bytes, b"extends") || contains_ci(bytes, b"extend") ||
    contains_ci(bytes, b"dependencies") || contains_ci(bytes, b"dependency") ||
    contains_ci(bytes, b"subtypes") || contains_ci(bytes, b"subtype") ||
    contains_ci(bytes, b"impact") || contains_ci(bytes, b"affected") ||
    contains_ci(bytes, b"downstream")
}

fn has_action_verb_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"handle") || contains_ci(bytes, b"send") ||
    contains_ci(bytes, b"calculate") || contains_ci(bytes, b"compute") ||
    contains_ci(bytes, b"parse") || contains_ci(bytes, b"validate") ||
    contains_ci(bytes, b"trigger") || contains_ci(bytes, b"perform") ||
    contains_ci(bytes, b"initialize") || contains_ci(bytes, b"process") ||
    contains_ci(bytes, b"execute") || contains_ci(bytes, b"generate") ||
    contains_ci(bytes, b"fetch") || contains_ci(bytes, b"store") ||
    contains_ci(bytes, b"load") || contains_ci(bytes, b"save") ||
    contains_ci(bytes, b"create") || contains_ci(bytes, b"update") ||
    contains_ci(bytes, b"delete") || contains_ci(bytes, b"render") ||
    contains_ci(bytes, b"authenticate") || contains_ci(bytes, b"authorize") ||
    contains_ci(bytes, b"cache") || contains_ci(bytes, b"log")
}

fn get_structural_keyword_count_fast(bytes: &[u8]) -> f32 {
    let keywords: &[&[u8]] = &[
        b"callers", b"caller", b"calls", b"call",
        b"callees", b"callee", b"uses", b"usages",
        b"references", b"reference",
        b"implementations", b"implementation", b"implements", b"implement",
        b"extends", b"extend", b"dependencies", b"dependency",
        b"subtypes", b"subtype", b"impact", b"affected",
        b"downstream", b"inherits", b"inherit",
    ];

    let mut count = 0;
    for kw in keywords {
        if contains_ci(bytes, kw) {
            count += 1;
        }
    }

    (count as f32 / 5.0).min(1.0)
}

fn has_structural_template_fast(bytes: &[u8]) -> bool {
    (contains_ci(bytes, b"what") || contains_ci(bytes, b"who") || contains_ci(bytes, b"which")) &&
    (contains_ci(bytes, b"invokes") || contains_ci(bytes, b"invoke") ||
     contains_ci(bytes, b"calls") || contains_ci(bytes, b"call") ||
     contains_ci(bytes, b"uses") || contains_ci(bytes, b"use") ||
     contains_ci(bytes, b"references") || contains_ci(bytes, b"reference") ||
     contains_ci(bytes, b"depends on")) ||
    contains_ci(bytes, b"derived from") ||
    contains_ci(bytes, b"inherits from") ||
    contains_ci(bytes, b"inherit from") ||
    (contains_ci(bytes, b"class") && contains_ci(bytes, b"implement")) ||
    (contains_ci(bytes, b"type") && contains_ci(bytes, b"implement")) ||
    contains_ci(bytes, b"usages of") || contains_ci(bytes, b"usage of")
}

fn has_expanded_structural_keyword_fast(bytes: &[u8]) -> bool {
    contains_ci(bytes, b"invoke") || contains_ci(bytes, b"invoking") ||
    contains_ci(bytes, b"call") || contains_ci(bytes, b"calling") ||
    contains_ci(bytes, b"callers") || contains_ci(bytes, b"callees") ||
    contains_ci(bytes, b"use") || contains_ci(bytes, b"using") ||
    contains_ci(bytes, b"usages") || contains_ci(bytes, b"reference") ||
    contains_ci(bytes, b"referencing") || contains_ci(bytes, b"derived") ||
    contains_ci(bytes, b"inherit") || contains_ci(bytes, b"inheriting") ||
    contains_ci(bytes, b"implementation") || contains_ci(bytes, b"implements") ||
    contains_ci(bytes, b"implementing") || contains_ci(bytes, b"depends") ||
    contains_ci(bytes, b"depending") || contains_ci(bytes, b"dependencies") ||
    contains_ci(bytes, b"affects") || contains_ci(bytes, b"affected") ||
    contains_ci(bytes, b"affecting") || contains_ci(bytes, b"downstream") ||
    contains_ci(bytes, b"upstream") || contains_ci(bytes, b"subtypes") ||
    contains_ci(bytes, b"extends") || contains_ci(bytes, b"extending")
}

// Keep old versions for compatibility
fn starts_with_question_word(lower: &str) -> bool {
    lower.starts_with("how ") || lower.starts_with("what ") ||
    lower.starts_with("why ") || lower.starts_with("where ") ||
    lower.starts_with("when ") || lower.starts_with("which ") ||
    lower.starts_with("who ") || lower.starts_with("can ") ||
    lower.starts_with("does ") || lower.starts_with("is ") ||
    lower.starts_with("are ") || lower.starts_with("should ")
}

fn has_semantic_concept(lower: &str) -> bool {
    lower.contains("flow") || lower.contains("process") ||
    lower.contains("mechanism") || lower.contains("strategy") ||
    lower.contains("pattern") || lower.contains("approach") ||
    lower.contains("logic") || lower.contains("algorithm") ||
    lower.contains("system") || lower.contains("detection") ||
    lower.contains("validation") || lower.contains("authentication") ||
    lower.contains("handling") || lower.contains("database") ||
    lower.contains("query") || lower.contains("token") ||
    lower.contains("management") || lower.contains("security") ||
    lower.contains("check") || lower.contains("session") ||
    lower.contains("config") || lower.contains("error") ||
    lower.contains("request") || lower.contains("response") ||
    lower.contains("service") || lower.contains("login") ||
    lower.contains("password") || lower.contains("reset") ||
    lower.contains("user") || lower.contains("data") ||
    lower.contains("storage") || lower.contains("cache") ||
    lower.contains("sync")
}

fn has_explanation_request(lower: &str) -> bool {
    lower.contains("explain") || lower.contains("describe") ||
    lower.contains("understand") || lower.contains("overview") ||
    lower.contains("architecture") || lower.contains("design") ||
    lower.contains("how") || lower.contains("why") || lower.contains("what")
}

fn has_how_does_work_pattern(lower: &str) -> bool {
    lower.contains("how does") && lower.contains("work")
}

fn has_non_ascii_identifier(query: &str) -> bool {
    // Look for sequences of non-ASCII identifier-like characters
    let mut consecutive_non_ascii = 0;
    for c in query.chars() {
        if c as u32 > 127 && (c.is_alphanumeric() || c == '_') {
            consecutive_non_ascii += 1;
            if consecutive_non_ascii >= 2 {
                return true;
            }
        } else if c.is_whitespace() {
            consecutive_non_ascii = 0;
        }
    }
    false
}

fn has_mixed_script(query: &str) -> bool {
    let mut has_latin = false;
    let mut has_cjk = false;
    let mut has_cyrillic = false;

    for c in query.chars() {
        if c.is_ascii_alphabetic() {
            has_latin = true;
        } else if is_cjk(c) {
            has_cjk = true;
        } else if is_cyrillic_upper(c) || is_cyrillic_lower(c) {
            has_cyrillic = true;
        }
    }

    (has_latin && has_cjk) || (has_latin && has_cyrillic) || (has_cjk && has_cyrillic)
}

fn has_structural_keyword_non_en(_lower: &str) -> bool {
    // TODO: Implement non-English structural patterns
    // For now, return false - these are rare
    false
}

fn has_semantic_keyword_non_en(_lower: &str) -> bool {
    // TODO: Implement non-English semantic patterns
    false
}

fn has_cross_script_concept(_query: &str) -> bool {
    // TODO: Implement cross-script concept detection
    false
}

fn has_explicit_structural_keyword(lower: &str) -> bool {
    lower.contains("calls") || lower.contains("call") ||
    lower.contains("callers") || lower.contains("caller") ||
    lower.contains("callees") || lower.contains("callee") ||
    lower.contains("uses") || lower.contains("use") ||
    lower.contains("usages") || lower.contains("usage") ||
    lower.contains("references") || lower.contains("reference") ||
    lower.contains("implementations") || lower.contains("implementation") ||
    lower.contains("implements") || lower.contains("implement") ||
    lower.contains("extends") || lower.contains("extend") ||
    lower.contains("dependencies") || lower.contains("dependency") ||
    lower.contains("subtypes") || lower.contains("subtype") ||
    lower.contains("impact") || lower.contains("affected") ||
    lower.contains("downstream")
}

fn has_unknown_trailing_content(query: &str, features: &[f32; 50]) -> bool {
    let tokens: Vec<&str> = query.split_whitespace().collect();
    tokens.len() > 1 &&
    features[30] == 1.0 &&  // identifier at start
    features[32] == 0.0 &&  // no explicit structural keyword
    features[22] == 0.0     // no semantic concept
}

fn get_identifier_index(query: &str) -> f32 {
    let tokens: Vec<&str> = query.split_whitespace().collect();

    for (i, token) in tokens.iter().enumerate() {
        if is_identifier_token(token) {
            return ((i + 1) as f32 / 10.0).min(1.0);
        }
    }

    0.0
}

fn is_identifier_token(token: &str) -> bool {
    let bytes = token.as_bytes();
    if bytes.is_empty() {
        return false;
    }

    // Check for camelCase or PascalCase
    let mut prev_lower = false;
    for &b in bytes {
        let class = CHAR_CLASS[b as usize];
        if prev_lower && class & UPPER != 0 {
            return true;
        }
        prev_lower = class & LOWER != 0;
    }

    // Check for non-Latin identifiers
    for c in token.chars() {
        if is_cyrillic_upper(c) {
            return true;
        }
    }

    false
}

fn has_action_verb(lower: &str) -> bool {
    // Common action verbs that indicate HYBRID (how something works)
    lower.contains("handle") || lower.contains("send") ||
    lower.contains("calculate") || lower.contains("compute") ||
    lower.contains("parse") || lower.contains("validate") ||
    lower.contains("trigger") || lower.contains("perform") ||
    lower.contains("initialize") || lower.contains("process") ||
    lower.contains("execute") || lower.contains("generate") ||
    lower.contains("fetch") || lower.contains("store") ||
    lower.contains("load") || lower.contains("save") ||
    lower.contains("create") || lower.contains("update") ||
    lower.contains("delete") || lower.contains("render") ||
    lower.contains("display") || lower.contains("format") ||
    lower.contains("convert") || lower.contains("transform") ||
    lower.contains("encrypt") || lower.contains("decrypt") ||
    lower.contains("authenticate") || lower.contains("authorize") ||
    lower.contains("schedule") || lower.contains("batch") ||
    lower.contains("queue") || lower.contains("cache") ||
    lower.contains("log") || lower.contains("track") ||
    lower.contains("monitor") || lower.contains("retry") ||
    lower.contains("recover")
}

fn has_question_identifier(query: &str) -> bool {
    let tokens: Vec<&str> = query.split_whitespace().collect();
    let lower = query.to_ascii_lowercase();

    if !starts_with_question_word(&lower) {
        return false;
    }

    if tokens.len() > 2 {
        if is_identifier_token(tokens[2]) {
            return true;
        }
        if tokens.len() > 3 && is_identifier_token(tokens[3]) {
            return true;
        }
    }

    false
}

fn get_structural_keyword_count(lower: &str) -> f32 {
    let keywords = [
        "callers", "caller", "calls", "call",
        "callees", "callee", "uses", "use",
        "usages", "usage", "references", "reference",
        "implementations", "implementation", "implements", "implement",
        "extends", "extend", "dependencies", "dependency",
        "subtypes", "subtype", "impact", "affected",
        "downstream", "inherits", "inherit",
    ];

    let mut count = 0;
    for kw in &keywords {
        if lower.contains(kw) {
            count += 1;
        }
    }

    (count as f32 / 5.0).min(1.0)
}

fn has_verified_ascii_identifier(query: &str) -> bool {
    for token in query.split_whitespace() {
        let bytes = token.as_bytes();
        if bytes.is_empty() {
            continue;
        }

        // PascalCase: Starts with upper, has lower, then has another upper
        if CHAR_CLASS[bytes[0] as usize] & UPPER != 0 {
            let mut has_lower = false;
            let mut has_upper_after_lower = false;
            let mut prev_lower = false;

            for &b in &bytes[1..] {
                let class = CHAR_CLASS[b as usize];
                if class & LOWER != 0 {
                    has_lower = true;
                    prev_lower = true;
                } else if class & UPPER != 0 && prev_lower {
                    has_upper_after_lower = true;
                    break;
                } else {
                    prev_lower = false;
                }
            }

            if has_lower && has_upper_after_lower {
                return true;
            }
        }

        // camelCase: Starts with lower, has upper later
        if CHAR_CLASS[bytes[0] as usize] & LOWER != 0 {
            for &b in &bytes[1..] {
                if CHAR_CLASS[b as usize] & UPPER != 0 {
                    return true;
                }
            }
        }

        // snake_case: lowercase with underscores
        if bytes.contains(&b'_') {
            let all_lower_or_underscore = bytes.iter().all(|&b| {
                CHAR_CLASS[b as usize] & (LOWER | UNDER | DIGIT) != 0
            });
            if all_lower_or_underscore && bytes.len() > 3 {
                return true;
            }
        }

        // SCREAMING_SNAKE_CASE
        if bytes.contains(&b'_') {
            let all_upper_or_underscore = bytes.iter().all(|&b| {
                CHAR_CLASS[b as usize] & (UPPER | UNDER | DIGIT) != 0
            });
            if all_upper_or_underscore && bytes.len() > 3 {
                return true;
            }
        }
    }

    false
}

fn has_structural_template(lower: &str) -> bool {
    (lower.contains("what") || lower.contains("who") || lower.contains("which")) &&
    (lower.contains("invokes") || lower.contains("invoke") ||
     lower.contains("calls") || lower.contains("call") ||
     lower.contains("uses") || lower.contains("use") ||
     lower.contains("references") || lower.contains("reference") ||
     lower.contains("depends on")) ||
    lower.contains("derived from") ||
    lower.contains("inherits from") ||
    lower.contains("inherit from") ||
    (lower.contains("class") && lower.contains("implement")) ||
    (lower.contains("type") && lower.contains("implement")) ||
    lower.contains("usages of") || lower.contains("usage of")
}

fn has_non_english_concept_stem(query: &str) -> bool {
    let lower = query.to_lowercase();

    // German concept stems
    if lower.contains("authentifiz") || lower.contains("konfig") ||
       lower.contains("verarbeit") || lower.contains("verwalt") ||
       lower.contains("fehler") || lower.contains("behandl") ||
       lower.contains("validier") || lower.contains("speicher") ||
       lower.contains("strategie") || lower.contains("mechanismus") ||
       lower.contains("prozess") || lower.contains("architektur") {
        return true;
    }

    // Spanish/French stems
    if lower.contains("autentic") || lower.contains("proceso") ||
       lower.contains("estrateg") || lower.contains("mecan") ||
       lower.contains("sistema") || lower.contains("arquitectur") {
        return true;
    }

    // Russian/Serbian stems (Cyrillic)
    for c in query.chars() {
        if is_cyrillic_lower(c) {
            return true;
        }
    }

    false
}

fn has_expanded_structural_keyword(lower: &str) -> bool {
    lower.contains("invoke") || lower.contains("invoking") ||
    lower.contains("call") || lower.contains("calling") ||
    lower.contains("callers") || lower.contains("callees") ||
    lower.contains("use") || lower.contains("using") ||
    lower.contains("usages") || lower.contains("reference") ||
    lower.contains("referencing") || lower.contains("derived") ||
    lower.contains("inherit") || lower.contains("inheriting") ||
    lower.contains("implementation") || lower.contains("implements") ||
    lower.contains("implementing") || lower.contains("depends") ||
    lower.contains("depending") || lower.contains("dependencies") ||
    lower.contains("affects") || lower.contains("affected") ||
    lower.contains("affecting") || lower.contains("downstream") ||
    lower.contains("upstream") || lower.contains("subtypes") ||
    lower.contains("extends") || lower.contains("extending")
}

fn get_token_character_density(query: &str, state: &FeatureState) -> f32 {
    let tokens: Vec<&str> = query.split_whitespace().collect();

    if tokens.len() != 1 {
        return 0.0;
    }

    let avg_char = state.non_space_count as f32;
    let has_camel_or_snake = state.has_camel_boundary || state.has_underscore_word;

    if avg_char > 15.0 && !has_camel_or_snake {
        (avg_char / 30.0).min(1.0)
    } else {
        0.0
    }
}

fn has_non_latin_identifier(query: &str) -> bool {
    let tokens: Vec<&str> = query.split_whitespace().collect();

    if tokens.len() != 1 {
        return false;
    }

    let token = tokens[0];
    let chars: Vec<char> = token.chars().collect();

    if chars.is_empty() {
        return false;
    }

    // Cyrillic PascalCase
    if is_cyrillic_upper(chars[0]) {
        let rest_lower = chars[1..].iter().all(|&c| is_cyrillic_lower(c));
        if rest_lower && chars.len() > 2 {
            return true;
        }
    }

    false
}

fn has_all_caps_constant(query: &str) -> bool {
    for token in query.split_whitespace() {
        let bytes = token.as_bytes();
        if bytes.len() <= 3 {
            continue;
        }

        let all_upper_or_underscore_or_digit = bytes.iter().all(|&b| {
            CHAR_CLASS[b as usize] & (UPPER | UNDER | DIGIT) != 0
        });

        if all_upper_or_underscore_or_digit &&
           bytes.iter().any(|&b| CHAR_CLASS[b as usize] & UPPER != 0) {
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
}
