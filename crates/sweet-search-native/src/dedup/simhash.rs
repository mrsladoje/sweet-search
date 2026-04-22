//! 64-bit SimHash (Charikar STOC 2002; Manku, Jain, Das Sarma WWW 2007).
//!
//! Per-feature ±1 contribution to 64 bit counters, then sign → fingerprint.
//! Uniform feature weight in v1; weighted-SimHash (tree-sitter node types)
//! deferred to v2 per the plan.

pub fn simhash64(hashes: &[u64]) -> u64 {
    if hashes.is_empty() {
        return 0;
    }

    let mut counters = [0i64; 64];
    for &h in hashes {
        for bit in 0..64 {
            if (h >> bit) & 1 == 1 {
                counters[bit] += 1;
            } else {
                counters[bit] -= 1;
            }
        }
    }

    let mut fingerprint: u64 = 0;
    for (bit, &c) in counters.iter().enumerate() {
        if c > 0 {
            fingerprint |= 1u64 << bit;
        }
    }
    fingerprint
}

pub fn hamming64(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_produces_zero() {
        assert_eq!(simhash64(&[]), 0);
    }

    #[test]
    fn deterministic_on_identical_input() {
        let hashes = vec![0xdeadbeef_cafebabeu64, 0x1234567890abcdef, 0x0fedcba987654321];
        assert_eq!(simhash64(&hashes), simhash64(&hashes));
    }

    #[test]
    fn near_dup_has_small_hamming() {
        let base: Vec<u64> = (0..100).map(|i| 0xcafebabe_00000000u64 ^ (i * 31)).collect();
        let mut near_dup = base.clone();
        near_dup.push(0x1234);
        let d = hamming64(simhash64(&base), simhash64(&near_dup));
        assert!(d < 10, "hamming should be small for near-dup, got {}", d);
    }

    #[test]
    fn unrelated_has_large_hamming() {
        let a: Vec<u64> = (0..100).map(|i| 0xaaaa_0000u64 ^ (i * 37)).collect();
        let b: Vec<u64> = (0..100).map(|i| 0x5555_ffffu64 ^ (i * 41)).collect();
        let d = hamming64(simhash64(&a), simhash64(&b));
        assert!(d > 15, "hamming should be large for unrelated, got {}", d);
    }

    #[test]
    fn symmetric() {
        let a: u64 = 0xabcd_1234_5678_9abc;
        let b: u64 = 0x0123_4567_89ab_cdef;
        assert_eq!(hamming64(a, b), hamming64(b, a));
    }
}
