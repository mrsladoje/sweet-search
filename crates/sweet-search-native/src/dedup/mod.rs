//! Dedup: SimHash + MinHash + banded LSH + union-find, exposed via NAPI.
//!
//! Two-call contract:
//!   1. `dedup_fingerprint_batch(texts, ngram, k, seed)` → fingerprints
//!   2. `dedup_cluster(fingerprints, k, bands, jaccard, simhashHammingMax)` → clusters
//!
//! Splitting the two lets callers persist fingerprints (e.g., in the merkle
//! sidecar for incremental re-index) without paying clustering cost twice.

mod lsh;
mod minhash;
mod shingle;
mod simhash;

use std::collections::BTreeMap;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use sha1::{Digest, Sha1};

#[napi(object)]
pub struct DedupFingerprint {
    /// 16 lowercase hex chars, representing a u64 SimHash (big-endian order).
    pub simhash_hex: String,
    /// Packed MinHash signature: `num_perm × u32` little-endian.
    pub minhash: Buffer,
}

#[napi(object)]
pub struct DedupCluster {
    /// Smallest-index member of the cluster. The JS layer applies its own
    /// exemplar-selection policy (longest text, lowest path) — this is just
    /// a deterministic stand-in.
    pub exemplar_idx: u32,
    /// All other indices in the cluster (sorted ascending).
    pub sibling_idxs: Vec<u32>,
    /// Per-sibling Jaccard estimate (matches `sibling_idxs` order), computed
    /// from the MinHash signatures of each sibling vs the `exemplar_idx`.
    /// JS uses this to apply a secondary LI-reuse threshold (e.g., ≥0.95)
    /// that is stricter than the bi-encoder clustering threshold.
    pub sibling_jaccards: Vec<f64>,
    /// Stable cluster ID: 16 hex chars = SHA1(sorted members' SimHashes)[..8].
    pub cluster_id: String,
}

#[napi]
pub fn dedup_fingerprint_batch(
    texts: Vec<String>,
    ngram_size: u32,
    num_perm: u32,
    seed: u32,
) -> Vec<DedupFingerprint> {
    let (a_coefs, b_coefs) = minhash::generate_permutations(num_perm as usize, seed);

    texts
        .par_iter()
        .map(|text| {
            let features = shingle::tokenize_shingles(text, ngram_size as usize);
            let sh = simhash::simhash64(&features.hashes_u64);
            let mh = minhash::minhash_signature(&features.hashes_u32_set, &a_coefs, &b_coefs);

            let mut mh_bytes = Vec::with_capacity(mh.len() * 4);
            for v in &mh {
                mh_bytes.extend_from_slice(&v.to_le_bytes());
            }

            DedupFingerprint {
                simhash_hex: format!("{:016x}", sh),
                minhash: Buffer::from(mh_bytes),
            }
        })
        .collect()
}

#[napi]
pub fn dedup_cluster(
    fingerprints: Vec<DedupFingerprint>,
    num_perm: u32,
    num_bands: u32,
    jaccard_threshold: f64,
    simhash_hamming_max: u32,
) -> Result<Vec<DedupCluster>> {
    let n = fingerprints.len();
    if n == 0 {
        return Ok(Vec::new());
    }

    let k = num_perm as usize;
    let expected_bytes = k * 4;

    let mut signatures: Vec<Vec<u32>> = Vec::with_capacity(n);
    let mut simhashes: Vec<u64> = Vec::with_capacity(n);

    for (idx, fp) in fingerprints.iter().enumerate() {
        let bytes: &[u8] = fp.minhash.as_ref();
        if bytes.len() != expected_bytes {
            return Err(Error::from_reason(format!(
                "dedup_cluster: fingerprint[{}] has {} bytes, expected {}",
                idx,
                bytes.len(),
                expected_bytes
            )));
        }
        let mut sig = Vec::with_capacity(k);
        for i in 0..k {
            let off = i * 4;
            sig.push(u32::from_le_bytes([
                bytes[off],
                bytes[off + 1],
                bytes[off + 2],
                bytes[off + 3],
            ]));
        }
        signatures.push(sig);

        let sh = u64::from_str_radix(&fp.simhash_hex, 16).map_err(|e| {
            Error::from_reason(format!(
                "dedup_cluster: fingerprint[{}] invalid simhash_hex: {}",
                idx, e
            ))
        })?;
        simhashes.push(sh);
    }

    let raw_groups = lsh::cluster_groups(
        &signatures,
        &simhashes,
        num_bands as usize,
        k,
        jaccard_threshold,
        simhash_hamming_max,
    );

    // Post-pass: union-find can transitively merge chunks via weak-link chains,
    // inflating clusters with members that aren't actually near-duplicates of
    // the exemplar. Re-validate each member's pairwise Jaccard to the exemplar
    // (and SimHash Hamming) and kick out anyone below threshold.
    let mut groups: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for (_, members) in raw_groups.into_iter() {
        if members.len() == 1 {
            groups.insert(members[0], members);
            continue;
        }
        // Exemplar is the smallest index in the cluster (deterministic stand-in).
        let exemplar_idx = members[0];
        let exemplar_sig = &signatures[exemplar_idx as usize];
        let exemplar_sh = simhashes[exemplar_idx as usize];
        let mut kept: Vec<u32> = vec![exemplar_idx];
        for &m in members.iter().skip(1) {
            let j = minhash::jaccard_estimate(exemplar_sig, &signatures[m as usize]);
            let h = (exemplar_sh ^ simhashes[m as usize]).count_ones();
            if j >= jaccard_threshold && h <= simhash_hamming_max {
                kept.push(m);
            } else {
                // Kicked out → singleton cluster.
                groups.insert(m, vec![m]);
            }
        }
        kept.sort_unstable();
        groups.insert(kept[0], kept);
    }

    let mut out: Vec<DedupCluster> = Vec::with_capacity(groups.len());
    for (_, members) in groups.into_iter() {
        let exemplar_idx = members[0];
        let sibling_idxs: Vec<u32> = members.iter().copied().skip(1).collect();

        let exemplar_sig = &signatures[exemplar_idx as usize];
        let sibling_jaccards: Vec<f64> = sibling_idxs
            .iter()
            .map(|&i| minhash::jaccard_estimate(exemplar_sig, &signatures[i as usize]))
            .collect();

        let mut member_hashes: Vec<u64> = members.iter().map(|&i| simhashes[i as usize]).collect();
        member_hashes.sort_unstable();
        let mut hasher = Sha1::new();
        for h in &member_hashes {
            hasher.update(h.to_be_bytes());
        }
        let digest = hasher.finalize();
        let cluster_id: String = digest
            .iter()
            .take(8)
            .map(|b| format!("{:02x}", b))
            .collect();

        out.push(DedupCluster {
            exemplar_idx,
            sibling_idxs,
            sibling_jaccards,
            cluster_id,
        });
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_to_end_identical_text_clusters() {
        let text = "fn foo() { let x = 1; let y = 2; return x + y; } fn bar() { return 42; }";
        let texts = vec![text.to_string(), text.to_string(), text.to_string()];
        let fps = dedup_fingerprint_batch(texts, 5, 128, 42);

        // Fingerprints should be bit-identical across runs
        assert_eq!(fps[0].simhash_hex, fps[1].simhash_hex);
        assert_eq!(fps[0].minhash.as_ref(), fps[1].minhash.as_ref());

        let clusters = dedup_cluster(fps, 128, 16, 0.7, 3).unwrap();
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].sibling_idxs.len(), 2);
    }

    #[test]
    fn end_to_end_unrelated_text_stays_separate() {
        let texts = vec![
            "fn foo() { let x = 1; } fn bar() { return 42; }".to_string(),
            "class Widget { def __init__(self): self.value = 99 }".to_string(),
            "interface Frobnicator { void frobnicate(int x); }".to_string(),
        ];
        let fps = dedup_fingerprint_batch(texts, 5, 128, 42);
        let clusters = dedup_cluster(fps, 128, 16, 0.7, 3).unwrap();
        assert_eq!(clusters.len(), 3);
        for c in &clusters {
            assert_eq!(c.sibling_idxs.len(), 0);
        }
    }

    #[test]
    fn fingerprint_buffer_length() {
        let fps = dedup_fingerprint_batch(vec!["hello world foo bar baz".to_string()], 5, 128, 42);
        assert_eq!(fps.len(), 1);
        assert_eq!(fps[0].minhash.as_ref().len(), 128 * 4);
        assert_eq!(fps[0].simhash_hex.len(), 16);
    }
}
