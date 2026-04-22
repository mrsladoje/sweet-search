//! Banded Locality-Sensitive Hashing + SimHash Hamming secondary filter +
//! union-find cluster collapse.
//!
//! For k=128 perms and Jaccard threshold 0.7: bands=16, rows=8. The s-curve
//! crosses 0.5 at s ≈ (1/b)^(1/r) = (1/16)^(1/8) ≈ 0.707. Two chunks whose
//! MinHash signatures match on any full band become a candidate pair; each
//! candidate pair is then re-checked with exact Jaccard over the full
//! signature AND SimHash Hamming distance (both thresholds must pass).

use std::collections::{BTreeMap, HashMap, HashSet};

use super::minhash::jaccard_estimate;
use super::simhash::hamming64;

/// A signature is "empty" when every slot is u32::MAX — meaning the chunk
/// produced zero shingles (text shorter than ngram_size after tokenization).
/// Two empty signatures match in every band, falsely appearing as near-dups.
/// We exclude these from candidate-pair generation entirely.
fn is_empty_signature(sig: &[u32]) -> bool {
    sig.iter().all(|&v| v == u32::MAX)
}

pub fn lsh_candidate_pairs(
    signatures: &[Vec<u32>],
    num_bands: usize,
    num_perm: usize,
) -> Vec<(u32, u32)> {
    assert!(
        num_perm % num_bands == 0,
        "num_perm must be divisible by num_bands"
    );
    let rows = num_perm / num_bands;

    let mut candidates: HashSet<(u32, u32)> = HashSet::new();

    for band in 0..num_bands {
        let start = band * rows;
        let end = start + rows;

        let mut buckets: HashMap<&[u32], Vec<u32>> = HashMap::new();
        for (idx, sig) in signatures.iter().enumerate() {
            if is_empty_signature(sig) {
                continue;
            }
            let band_key = &sig[start..end];
            buckets
                .entry(band_key)
                .or_insert_with(Vec::new)
                .push(idx as u32);
        }

        for bucket in buckets.values() {
            if bucket.len() < 2 {
                continue;
            }
            for i in 0..bucket.len() {
                for j in (i + 1)..bucket.len() {
                    let a = bucket[i];
                    let b = bucket[j];
                    candidates.insert(if a < b { (a, b) } else { (b, a) });
                }
            }
        }
    }

    candidates.into_iter().collect()
}

pub struct UnionFind {
    parent: Vec<u32>,
    rank: Vec<u8>,
}

impl UnionFind {
    pub fn new(n: usize) -> Self {
        Self {
            parent: (0..n as u32).collect(),
            rank: vec![0u8; n],
        }
    }

    pub fn find(&mut self, x: u32) -> u32 {
        let mut root = x;
        while self.parent[root as usize] != root {
            root = self.parent[root as usize];
        }
        let mut cur = x;
        while self.parent[cur as usize] != root {
            let next = self.parent[cur as usize];
            self.parent[cur as usize] = root;
            cur = next;
        }
        root
    }

    pub fn union(&mut self, x: u32, y: u32) {
        let rx = self.find(x);
        let ry = self.find(y);
        if rx == ry {
            return;
        }
        let (small, large) = if self.rank[rx as usize] < self.rank[ry as usize] {
            (rx, ry)
        } else {
            (ry, rx)
        };
        self.parent[small as usize] = large;
        if self.rank[rx as usize] == self.rank[ry as usize] {
            self.rank[large as usize] += 1;
        }
    }
}

/// Cluster N chunks into near-duplicate groups.
/// Returns `BTreeMap<root, members>` — root is the index acting as the
/// union-find canonical; members are all indices in that cluster (sorted).
/// Singletons (chunks with no near-dup) appear as single-entry groups.
pub fn cluster_groups(
    signatures: &[Vec<u32>],
    simhashes: &[u64],
    num_bands: usize,
    num_perm: usize,
    jaccard_threshold: f64,
    simhash_hamming_max: u32,
) -> BTreeMap<u32, Vec<u32>> {
    assert_eq!(signatures.len(), simhashes.len());
    let n = signatures.len();
    let mut uf = UnionFind::new(n);

    let pairs = lsh_candidate_pairs(signatures, num_bands, num_perm);
    for (a, b) in pairs {
        let ai = a as usize;
        let bi = b as usize;

        if hamming64(simhashes[ai], simhashes[bi]) > simhash_hamming_max {
            continue;
        }

        if jaccard_estimate(&signatures[ai], &signatures[bi]) < jaccard_threshold {
            continue;
        }

        uf.union(a, b);
    }

    let mut groups: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for i in 0..n as u32 {
        let root = uf.find(i);
        groups.entry(root).or_insert_with(Vec::new).push(i);
    }
    for members in groups.values_mut() {
        members.sort_unstable();
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn union_find_basic() {
        let mut uf = UnionFind::new(5);
        uf.union(0, 1);
        uf.union(1, 2);
        assert_eq!(uf.find(0), uf.find(2));
        assert_ne!(uf.find(0), uf.find(3));
        uf.union(3, 4);
        assert_eq!(uf.find(3), uf.find(4));
        assert_ne!(uf.find(0), uf.find(3));
    }

    #[test]
    fn lsh_finds_identical_sig_pair() {
        let sig = vec![1u32; 128];
        let signatures = vec![sig.clone(), sig.clone(), vec![99u32; 128]];
        let pairs = lsh_candidate_pairs(&signatures, 16, 128);
        assert!(pairs.contains(&(0, 1)));
        assert!(!pairs.contains(&(0, 2)));
        assert!(!pairs.contains(&(1, 2)));
    }

    #[test]
    fn clusters_respect_secondary_filters() {
        // Three identical signatures, identical simhashes -> one cluster
        let sig = vec![1u32; 128];
        let signatures = vec![sig.clone(), sig.clone(), sig.clone()];
        let simhashes = vec![0xdeadbeefu64, 0xdeadbeef, 0xdeadbeef];
        let groups = cluster_groups(&signatures, &simhashes, 16, 128, 0.7, 3);
        assert_eq!(groups.len(), 1);
        let members = groups.values().next().unwrap();
        assert_eq!(members.len(), 3);
    }

    #[test]
    fn simhash_hamming_filter_blocks_admission() {
        // Identical minhash sigs BUT SimHash Hamming too high -> no cluster merge
        let sig = vec![1u32; 128];
        let signatures = vec![sig.clone(), sig.clone()];
        let simhashes = vec![0x0u64, u64::MAX]; // Hamming = 64
        let groups = cluster_groups(&signatures, &simhashes, 16, 128, 0.7, 3);
        // Both survive as singletons
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn jaccard_below_threshold_blocks_admission() {
        // Build two sigs that match on one band (LSH candidate)
        // but have low overall Jaccard estimate.
        let mut a = vec![0u32; 128];
        let mut b = vec![0u32; 128];
        // First 8 slots match (one band) — rest differ
        for i in 0..8 {
            a[i] = 42;
            b[i] = 42;
        }
        for i in 8..128 {
            a[i] = i as u32;
            b[i] = (i as u32) + 1000;
        }
        let signatures = vec![a, b];
        let simhashes = vec![0u64, 0u64]; // Hamming 0, pass secondary
        let groups = cluster_groups(&signatures, &simhashes, 16, 128, 0.7, 3);
        // Jaccard estimate = 8/128 ≈ 0.0625, below 0.7 -> no merge
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn singletons_appear_as_own_groups() {
        let a = vec![1u32; 128];
        let b = vec![2u32; 128];
        let c = vec![3u32; 128];
        let signatures = vec![a, b, c];
        let simhashes = vec![0u64, 1, 2];
        let groups = cluster_groups(&signatures, &simhashes, 16, 128, 0.7, 3);
        assert_eq!(groups.len(), 3);
    }
}
