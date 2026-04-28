//! k-permutation MinHash (Broder 1997).
//!
//! Deterministic permutations: `perm_i(h) = (a_i * h + b_i) mod prime`, then
//! truncate to 32 bits. (a_i, b_i) drawn from a SplitMix64 + xorshift64*
//! sequence seeded by a fixed u32. Choice of prime follows the datasketch
//! convention (2^61 - 1, a Mersenne prime well above u32::MAX so the
//! truncation is safe).

use std::collections::HashSet;

const MERSENNE_PRIME: u64 = (1u64 << 61) - 1;
const MAX_HASH: u64 = (1u64 << 32) - 1;

pub fn generate_permutations(num_perm: usize, seed: u32) -> (Vec<u64>, Vec<u64>) {
    let mut state = splitmix64(seed as u64);
    // Reject zero state for xorshift64* (would lock at 0).
    if state == 0 {
        state = 0x9E3779B97F4A7C15;
    }
    let mut a = Vec::with_capacity(num_perm);
    let mut b = Vec::with_capacity(num_perm);
    for _ in 0..num_perm {
        let ai = next_u64(&mut state) % (MERSENNE_PRIME - 1) + 1;
        let bi = next_u64(&mut state) % MERSENNE_PRIME;
        a.push(ai);
        b.push(bi);
    }
    (a, b)
}

fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

fn next_u64(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

pub fn minhash_signature(features: &HashSet<u32>, a_coefs: &[u64], b_coefs: &[u64]) -> Vec<u32> {
    let k = a_coefs.len();
    let mut sig = vec![MAX_HASH as u32; k];

    if features.is_empty() {
        return sig;
    }

    for &h in features {
        let h64 = h as u64;
        for i in 0..k {
            let perm = (a_coefs[i].wrapping_mul(h64).wrapping_add(b_coefs[i])) % MERSENNE_PRIME;
            let p32 = (perm & MAX_HASH) as u32;
            if p32 < sig[i] {
                sig[i] = p32;
            }
        }
    }

    sig
}

pub fn jaccard_estimate(sig_a: &[u32], sig_b: &[u32]) -> f64 {
    debug_assert_eq!(sig_a.len(), sig_b.len());
    if sig_a.is_empty() {
        return 0.0;
    }
    let matches = sig_a
        .iter()
        .zip(sig_b.iter())
        .filter(|(x, y)| x == y)
        .count();
    matches as f64 / sig_a.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_from(values: impl IntoIterator<Item = u32>) -> HashSet<u32> {
        values.into_iter().collect()
    }

    #[test]
    fn identical_sets_produce_identical_signatures() {
        let (a, b) = generate_permutations(128, 42);
        let set: HashSet<u32> = (0..50u32).map(|i| i * 7919).collect();
        let s1 = minhash_signature(&set, &a, &b);
        let s2 = minhash_signature(&set, &a, &b);
        assert_eq!(s1, s2);
    }

    #[test]
    fn permutations_deterministic_for_same_seed() {
        let (a1, b1) = generate_permutations(128, 42);
        let (a2, b2) = generate_permutations(128, 42);
        assert_eq!(a1, a2);
        assert_eq!(b1, b2);
    }

    #[test]
    fn different_seeds_produce_different_permutations() {
        let (a1, _) = generate_permutations(128, 42);
        let (a2, _) = generate_permutations(128, 43);
        assert_ne!(a1, a2);
    }

    #[test]
    fn identical_signatures_full_jaccard() {
        let sig = vec![42u32; 128];
        assert_eq!(jaccard_estimate(&sig, &sig), 1.0);
    }

    #[test]
    fn disjoint_sets_low_jaccard_estimate() {
        let (a, b) = generate_permutations(128, 42);
        let set_a = set_from((0..100u32).map(|i| i * 7919));
        let set_b = set_from((10000..10100u32).map(|i| i * 7919));
        let sig_a = minhash_signature(&set_a, &a, &b);
        let sig_b = minhash_signature(&set_b, &a, &b);
        let j = jaccard_estimate(&sig_a, &sig_b);
        assert!(j < 0.15, "disjoint jaccard should be ~0, got {}", j);
    }

    #[test]
    fn overlapping_sets_estimate_matches_truth() {
        let (a, b) = generate_permutations(128, 42);
        let set_a = set_from((0..100u32).map(|i| i * 7919));
        let set_b = set_from((50..150u32).map(|i| i * 7919));
        // |A ∩ B| = 50, |A ∪ B| = 150, exact jaccard = 0.333
        let sig_a = minhash_signature(&set_a, &a, &b);
        let sig_b = minhash_signature(&set_b, &a, &b);
        let j = jaccard_estimate(&sig_a, &sig_b);
        assert!(
            (j - 0.333).abs() < 0.12,
            "estimate should approach 0.333, got {}",
            j
        );
    }

    #[test]
    fn empty_set_produces_max_hash_signature() {
        let (a, b) = generate_permutations(4, 42);
        let empty: HashSet<u32> = HashSet::new();
        let sig = minhash_signature(&empty, &a, &b);
        assert_eq!(sig, vec![MAX_HASH as u32; 4]);
    }
}
