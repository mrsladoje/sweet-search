//! Output checks shared by the backend parity probes.
//!
//! Every accelerated backend (CoreML today; CUDA and Metal later) is
//! admitted only after its output on a fixed input matches a reference.
//! These helpers hold the structural and numerical rules so that each
//! probe applies the same ones:
//!
//!   - both outputs have the same length, a whole number of `dim`-wide
//!     vectors, and at least one vector;
//!   - every value is finite;
//!   - every vector has unit L2 norm (both models L2-normalise outputs);
//!   - per-vector cosine is reported as min AND mean, so one bad token
//!     cannot hide behind 63 good ones (mean 0.9984 passes a 0.998
//!     mean-only gate; the min does not).

/// Largest allowed |norm - 1| for an L2-normalised output vector. FP16
/// storage of a 128-d unit vector rounds the norm by about 1e-3.
pub const UNIT_NORM_TOLERANCE: f32 = 1e-2;

/// Per-vector cosine statistics between a candidate and a reference.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CosineStats {
    pub vectors: usize,
    pub min: f32,
    pub mean: f32,
}

/// Check `values` as a flat row-major list of `dim`-wide unit vectors.
/// `label` names the output in the error text.
pub fn check_unit_vectors(values: &[f32], dim: usize, label: &str) -> Result<usize, String> {
    if dim == 0 {
        return Err(format!("{label}: vector dimension is 0"));
    }
    if values.is_empty() {
        return Err(format!("{label}: empty output"));
    }
    if values.len() % dim != 0 {
        return Err(format!(
            "{label}: length {} is not a multiple of dimension {dim}",
            values.len()
        ));
    }
    if let Some(i) = values.iter().position(|v| !v.is_finite()) {
        return Err(format!(
            "{label}: non-finite value {} at index {i}",
            values[i]
        ));
    }
    for (row, v) in values.chunks_exact(dim).enumerate() {
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if (norm - 1.0).abs() > UNIT_NORM_TOLERANCE {
            return Err(format!(
                "{label}: vector {row} has norm {norm:.6}, expected 1"
            ));
        }
    }
    Ok(values.len() / dim)
}

/// Per-vector cosine between `candidate` and `reference`, both flat lists
/// of `dim`-wide unit vectors. Fails when either side breaks the
/// structural rules or the vector counts differ.
pub fn cosine_stats(
    candidate: &[f32],
    reference: &[f32],
    dim: usize,
) -> Result<CosineStats, String> {
    let n_candidate = check_unit_vectors(candidate, dim, "candidate")?;
    let n_reference = check_unit_vectors(reference, dim, "reference")?;
    if n_candidate != n_reference {
        return Err(format!(
            "vector count mismatch: candidate {n_candidate}, reference {n_reference}"
        ));
    }
    let mut min = f32::INFINITY;
    let mut sum = 0.0f64;
    for (a, b) in candidate.chunks_exact(dim).zip(reference.chunks_exact(dim)) {
        let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
        min = min.min(dot);
        sum += dot as f64;
    }
    Ok(CosineStats {
        vectors: n_candidate,
        min,
        mean: (sum / n_candidate as f64) as f32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIM: usize = 8;

    /// `n` distinct unit vectors of width DIM.
    fn unit_rows(n: usize) -> Vec<f32> {
        let mut out = Vec::with_capacity(n * DIM);
        for r in 0..n {
            let row: Vec<f32> = (0..DIM)
                .map(|k| ((r * 7 + k * 3) % 11) as f32 + 1.0)
                .collect();
            let norm = row.iter().map(|x| x * x).sum::<f32>().sqrt();
            out.extend(row.iter().map(|x| x / norm));
        }
        out
    }

    #[test]
    fn identical_outputs_pass_with_cosine_one() {
        let a = unit_rows(64);
        let s = cosine_stats(&a, &a, DIM).unwrap();
        assert_eq!(s.vectors, 64);
        assert!((s.min - 1.0).abs() < 1e-5 && (s.mean - 1.0).abs() < 1e-5);
    }

    #[test]
    fn removed_token_fails_on_count() {
        let a = unit_rows(64);
        let err = cosine_stats(&a[..63 * DIM], &a, DIM).unwrap_err();
        assert!(err.contains("vector count mismatch"), "{err}");
    }

    #[test]
    fn one_corrupted_token_shows_in_min_not_mean() {
        let reference = unit_rows(64);
        let mut candidate = reference.clone();
        // Rotate token 10 so its cosine with the reference is ~0.90.
        let row = &mut candidate[10 * DIM..11 * DIM];
        let other: Vec<f32> = unit_rows(65)[64 * DIM..].to_vec();
        let mixed: Vec<f32> = row
            .iter()
            .zip(&other)
            .map(|(x, y)| 0.9 * x + 0.45 * y)
            .collect();
        let norm = mixed.iter().map(|x| x * x).sum::<f32>().sqrt();
        for (dst, v) in row.iter_mut().zip(mixed) {
            *dst = v / norm;
        }
        let s = cosine_stats(&candidate, &reference, DIM).unwrap();
        assert!(s.mean > 0.998, "mean {} hides the bad token", s.mean);
        assert!(s.min < 0.99, "min {} must expose the bad token", s.min);
    }

    #[test]
    fn non_finite_value_fails() {
        let reference = unit_rows(4);
        let mut candidate = reference.clone();
        candidate[5] = f32::NAN;
        let err = cosine_stats(&candidate, &reference, DIM).unwrap_err();
        assert!(err.contains("non-finite"), "{err}");
    }

    #[test]
    fn zero_vector_fails_on_norm() {
        let reference = unit_rows(4);
        let mut candidate = reference.clone();
        candidate[DIM..2 * DIM].fill(0.0);
        let err = cosine_stats(&candidate, &reference, DIM).unwrap_err();
        assert!(err.contains("norm"), "{err}");
    }

    #[test]
    fn empty_and_ragged_outputs_fail() {
        assert!(check_unit_vectors(&[], DIM, "x")
            .unwrap_err()
            .contains("empty"));
        let a = unit_rows(2);
        assert!(check_unit_vectors(&a[..DIM + 3], DIM, "x")
            .unwrap_err()
            .contains("multiple"));
    }
}
