//! Keyword Detection via Perfect Hashing
//!
//! Uses FNV-1a hash for fast keyword lookup without complex regex.
//! Keywords are grouped by category for routing decisions.

/// FNV-1a hash for keyword lookup
#[inline(always)]
pub const fn fnv1a(s: &[u8]) -> u32 {
    let mut hash = 2166136261u32;
    let mut i = 0;
    while i < s.len() {
        hash ^= s[i] as u32;
        hash = hash.wrapping_mul(16777619);
        i += 1;
    }
    hash
}

/// Question words that indicate semantic queries
pub const QUESTION_WORDS: [u32; 12] = [
    fnv1a(b"how"),
    fnv1a(b"what"),
    fnv1a(b"why"),
    fnv1a(b"where"),
    fnv1a(b"when"),
    fnv1a(b"which"),
    fnv1a(b"who"),
    fnv1a(b"can"),
    fnv1a(b"does"),
    fnv1a(b"is"),
    fnv1a(b"are"),
    fnv1a(b"should"),
];

/// Structural keywords that indicate graph queries
pub const STRUCTURAL_KEYWORDS: [u32; 27] = [
    fnv1a(b"callers"),
    fnv1a(b"caller"),
    fnv1a(b"calls"),
    fnv1a(b"call"),
    fnv1a(b"callees"),
    fnv1a(b"callee"),
    fnv1a(b"uses"),
    fnv1a(b"use"),
    fnv1a(b"usages"),
    fnv1a(b"usage"),
    fnv1a(b"references"),
    fnv1a(b"reference"),
    fnv1a(b"implementations"),
    fnv1a(b"implementation"),
    fnv1a(b"implements"),
    fnv1a(b"implement"),
    fnv1a(b"extends"),
    fnv1a(b"extend"),
    fnv1a(b"dependencies"),
    fnv1a(b"dependency"),
    fnv1a(b"subtypes"),
    fnv1a(b"subtype"),
    fnv1a(b"impact"),
    fnv1a(b"affected"),
    fnv1a(b"downstream"),
    fnv1a(b"inherits"),
    fnv1a(b"inherit"),
];

/// Action verbs that indicate hybrid queries
pub const ACTION_VERBS: [u32; 70] = [
    fnv1a(b"handle"),
    fnv1a(b"handles"),
    fnv1a(b"handling"),
    fnv1a(b"send"),
    fnv1a(b"sends"),
    fnv1a(b"sending"),
    fnv1a(b"calculate"),
    fnv1a(b"calculates"),
    fnv1a(b"calculating"),
    fnv1a(b"compute"),
    fnv1a(b"computes"),
    fnv1a(b"computing"),
    fnv1a(b"parse"),
    fnv1a(b"parses"),
    fnv1a(b"parsing"),
    fnv1a(b"validate"),
    fnv1a(b"validates"),
    fnv1a(b"validating"),
    fnv1a(b"trigger"),
    fnv1a(b"triggers"),
    fnv1a(b"triggering"),
    fnv1a(b"perform"),
    fnv1a(b"performs"),
    fnv1a(b"performing"),
    fnv1a(b"initialize"),
    fnv1a(b"initializes"),
    fnv1a(b"initializing"),
    fnv1a(b"process"),
    fnv1a(b"processes"),
    fnv1a(b"processing"),
    fnv1a(b"execute"),
    fnv1a(b"executes"),
    fnv1a(b"executing"),
    fnv1a(b"generate"),
    fnv1a(b"generates"),
    fnv1a(b"generating"),
    fnv1a(b"fetch"),
    fnv1a(b"fetches"),
    fnv1a(b"fetching"),
    fnv1a(b"store"),
    fnv1a(b"stores"),
    fnv1a(b"storing"),
    fnv1a(b"load"),
    fnv1a(b"loads"),
    fnv1a(b"loading"),
    fnv1a(b"save"),
    fnv1a(b"saves"),
    fnv1a(b"saving"),
    fnv1a(b"create"),
    fnv1a(b"creates"),
    fnv1a(b"creating"),
    fnv1a(b"update"),
    fnv1a(b"updates"),
    fnv1a(b"updating"),
    fnv1a(b"delete"),
    fnv1a(b"deletes"),
    fnv1a(b"deleting"),
    fnv1a(b"render"),
    fnv1a(b"renders"),
    fnv1a(b"rendering"),
    fnv1a(b"authenticate"),
    fnv1a(b"authenticates"),
    fnv1a(b"authenticating"),
    fnv1a(b"authorize"),
    fnv1a(b"authorizes"),
    fnv1a(b"authorizing"),
    fnv1a(b"cache"),
    fnv1a(b"caches"),
    fnv1a(b"caching"),
    fnv1a(b"log"),
];

/// Check if a word hash is in a sorted array
#[inline]
fn contains_hash(arr: &[u32], hash: u32) -> bool {
    arr.iter().any(|&h| h == hash)
}

/// Check if query starts with a question word
pub fn starts_with_question_word(query: &str) -> bool {
    let lower = query.to_ascii_lowercase();
    if let Some(space_pos) = lower.find(' ') {
        let first_word = &lower[..space_pos];
        let hash = fnv1a(first_word.as_bytes());
        contains_hash(&QUESTION_WORDS, hash)
    } else {
        false
    }
}

/// Count structural keywords in query
pub fn count_structural_keywords(query: &str) -> usize {
    let lower = query.to_ascii_lowercase();
    let mut count = 0;

    for word in lower.split(|c: char| !c.is_alphanumeric()) {
        if !word.is_empty() {
            let hash = fnv1a(word.as_bytes());
            if contains_hash(&STRUCTURAL_KEYWORDS, hash) {
                count += 1;
            }
        }
    }

    count
}

/// Check if query contains action verbs
pub fn has_action_verb(query: &str) -> bool {
    let lower = query.to_ascii_lowercase();

    for word in lower.split(|c: char| !c.is_alphanumeric()) {
        if !word.is_empty() {
            let hash = fnv1a(word.as_bytes());
            if contains_hash(&ACTION_VERBS, hash) {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_question_word_detection() {
        assert!(starts_with_question_word("how does authentication work"));
        assert!(starts_with_question_word("what calls AuthService"));
        assert!(!starts_with_question_word("AuthService login flow"));
    }

    #[test]
    fn test_structural_keyword_count() {
        assert_eq!(count_structural_keywords("callers of AuthService"), 1);
        assert_eq!(count_structural_keywords("what calls AuthService"), 1);
        assert_eq!(count_structural_keywords("implementations of Repository"), 1);
        assert_eq!(count_structural_keywords("how does auth work"), 0);
    }

    #[test]
    fn test_action_verb_detection() {
        assert!(has_action_verb("how does AuthService handle errors"));
        assert!(has_action_verb("validate user input"));
        assert!(!has_action_verb("callers of AuthService"));
    }
}
