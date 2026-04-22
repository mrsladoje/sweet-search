//! 5-gram word-shingle tokenizer for near-duplicate detection.
//!
//! BigCode-compatible: splits on non-alphanumeric (retaining underscore),
//! joins with space. One SHA1 is computed per shingle and the first 8 bytes
//! are reinterpreted as two feature hashes: a u64 for SimHash and a u32 for
//! MinHash. SHA1 gives us cryptographic-uniform, endianness-stable feature
//! hashes so fingerprints are bit-identical across targets.

use sha1::{Digest, Sha1};
use std::collections::HashSet;

pub struct ShingleFeatures {
    pub hashes_u64: Vec<u64>,
    pub hashes_u32_set: HashSet<u32>,
}

pub fn tokenize_shingles(content: &str, ngram_size: usize) -> ShingleFeatures {
    let tokens: Vec<&str> = content
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .collect();

    let mut hashes_u64 = Vec::new();
    let mut hashes_u32_set = HashSet::new();

    if ngram_size == 0 || tokens.len() < ngram_size {
        return ShingleFeatures {
            hashes_u64,
            hashes_u32_set,
        };
    }

    let mut buf = String::new();
    for i in 0..=tokens.len() - ngram_size {
        buf.clear();
        for (j, tok) in tokens[i..i + ngram_size].iter().enumerate() {
            if j > 0 {
                buf.push(' ');
            }
            buf.push_str(tok);
        }

        let mut hasher = Sha1::new();
        hasher.update(buf.as_bytes());
        let digest = hasher.finalize();

        let h64 = u64::from_be_bytes([
            digest[0], digest[1], digest[2], digest[3], digest[4], digest[5], digest[6], digest[7],
        ]);
        let h32 = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);

        hashes_u64.push(h64);
        hashes_u32_set.insert(h32);
    }

    ShingleFeatures {
        hashes_u64,
        hashes_u32_set,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_content_produces_empty_features() {
        let features = tokenize_shingles("", 5);
        assert!(features.hashes_u64.is_empty());
        assert!(features.hashes_u32_set.is_empty());
    }

    #[test]
    fn under_ngram_size_produces_empty() {
        let features = tokenize_shingles("one two three four", 5);
        assert!(features.hashes_u64.is_empty());
    }

    #[test]
    fn identical_content_bit_identical_features() {
        let a = tokenize_shingles("fn hello() { println!(\"hi\"); }", 5);
        let b = tokenize_shingles("fn hello() { println!(\"hi\"); }", 5);
        assert_eq!(a.hashes_u64, b.hashes_u64);
        assert_eq!(a.hashes_u32_set, b.hashes_u32_set);
    }

    #[test]
    fn underscore_retained_as_word_char() {
        let features = tokenize_shingles("hello_world foo bar baz qux", 5);
        assert_eq!(features.hashes_u64.len(), 1);
    }

    #[test]
    fn different_content_produces_different_features() {
        let a = tokenize_shingles("fn hello world foo bar baz qux", 5);
        let b = tokenize_shingles("fn goodbye world foo bar baz qux", 5);
        assert_ne!(a.hashes_u64, b.hashes_u64);
    }

    #[test]
    fn six_tokens_produce_two_shingles() {
        let features = tokenize_shingles("a b c d e f", 5);
        assert_eq!(features.hashes_u64.len(), 2);
    }
}
