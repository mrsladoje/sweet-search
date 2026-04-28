//! SIMD-accelerated sorted set intersection for `u32` posting lists.
//!
//! Entry point: [`intersect_sorted_u32`] dispatches to:
//! - **Galloping search** when one side is >=8x smaller — O(n·log m) vs O(n+m)
//! - **SIMD 4-wide block merge** (NEON on aarch64, SSE2 on x86_64)
//! - **Scalar merge** for small inputs or unsupported platforms

/// Intersect two sorted, duplicate-free `u32` slices. Returns sorted results.
pub(crate) fn intersect_sorted_u32(a: &[u32], b: &[u32]) -> Vec<u32> {
    if a.is_empty() || b.is_empty() {
        return Vec::new();
    }

    let (small, large) = if a.len() <= b.len() { (a, b) } else { (b, a) };

    // Galloping: O(n·log m) beats O(n+m) when n << m
    if large.len() >= small.len() * 8 {
        return intersect_galloping(small, large);
    }

    // SIMD 4-wide block merge for sets large enough to amortize setup
    #[cfg(target_arch = "aarch64")]
    if small.len() >= 16 {
        return unsafe { intersect_sorted_neon(small, large) };
    }

    #[cfg(target_arch = "x86_64")]
    if small.len() >= 16 {
        return unsafe { intersect_sorted_sse2(small, large) };
    }

    intersect_sorted_scalar(a, b)
}

/// Classic linear merge — O(n+m). Used for small inputs and as scalar tail.
fn intersect_sorted_scalar(a: &[u32], b: &[u32]) -> Vec<u32> {
    let mut out = Vec::with_capacity(a.len().min(b.len()));
    let (mut ai, mut bi) = (0, 0);
    while ai < a.len() && bi < b.len() {
        match a[ai].cmp(&b[bi]) {
            std::cmp::Ordering::Less => ai += 1,
            std::cmp::Ordering::Greater => bi += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[ai]);
                ai += 1;
                bi += 1;
            }
        }
    }
    out
}

/// Galloping intersection: for each element in `small`, exponential + binary search
/// in `large`. O(n · log m) where n = |small|, m = |large|.
fn intersect_galloping(small: &[u32], large: &[u32]) -> Vec<u32> {
    let mut out = Vec::with_capacity(small.len());
    let mut lo = 0usize;

    for &val in small {
        // Exponential search: find bound in large[lo..] where large[bound] >= val
        let mut step = 1usize;
        let mut hi = lo;
        while hi < large.len() && large[hi] < val {
            lo = hi;
            step *= 2;
            hi = (lo + step).min(large.len());
        }

        // Binary search within [lo, hi)
        let pos = lo + large[lo..hi].partition_point(|&x| x < val);

        if pos < large.len() && large[pos] == val {
            out.push(val);
            lo = pos + 1;
        } else {
            lo = pos;
        }
    }

    out
}

// ---------------------------------------------------------------------------
// NEON (aarch64) — 4-wide sorted block merge
// ---------------------------------------------------------------------------

#[cfg(target_arch = "aarch64")]
unsafe fn intersect_sorted_neon(a: &[u32], b: &[u32]) -> Vec<u32> {
    use std::arch::aarch64::*;

    let mut out = Vec::with_capacity(a.len().min(b.len()));
    let mut ai = 0usize;
    let mut bi = 0usize;

    while ai + 4 <= a.len() && bi + 4 <= b.len() {
        let va = vld1q_u32(a.as_ptr().add(ai));
        let vb = vld1q_u32(b.as_ptr().add(bi));

        let a_max = a[ai + 3];
        let b_max = b[bi + 3];

        // Skip non-overlapping blocks
        if a_max < b[bi] {
            ai += 4;
            continue;
        }
        if b_max < a[ai] {
            bi += 4;
            continue;
        }

        // Exhaustive 4x4 comparison: rotate vb and compare each rotation with va
        let eq0 = vceqq_u32(va, vb);
        let eq1 = vceqq_u32(va, vextq_u32::<1>(vb, vb));
        let eq2 = vceqq_u32(va, vextq_u32::<2>(vb, vb));
        let eq3 = vceqq_u32(va, vextq_u32::<3>(vb, vb));

        let any = vorrq_u32(vorrq_u32(eq0, eq1), vorrq_u32(eq2, eq3));

        // Extract per-lane match flags (each lane is 0 or 0xFFFFFFFF)
        if vgetq_lane_u32::<0>(any) != 0 {
            out.push(a[ai]);
        }
        if vgetq_lane_u32::<1>(any) != 0 {
            out.push(a[ai + 1]);
        }
        if vgetq_lane_u32::<2>(any) != 0 {
            out.push(a[ai + 2]);
        }
        if vgetq_lane_u32::<3>(any) != 0 {
            out.push(a[ai + 3]);
        }

        // Advance the side with the smaller maximum; both if equal
        if a_max <= b_max {
            ai += 4;
        }
        if b_max <= a_max {
            bi += 4;
        }
    }

    // Scalar tail for remaining elements
    while ai < a.len() && bi < b.len() {
        match a[ai].cmp(&b[bi]) {
            std::cmp::Ordering::Less => ai += 1,
            std::cmp::Ordering::Greater => bi += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[ai]);
                ai += 1;
                bi += 1;
            }
        }
    }

    out
}

// ---------------------------------------------------------------------------
// SSE2 (x86_64) — 4-wide sorted block merge
// ---------------------------------------------------------------------------

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn intersect_sorted_sse2(a: &[u32], b: &[u32]) -> Vec<u32> {
    use std::arch::x86_64::*;

    let mut out = Vec::with_capacity(a.len().min(b.len()));
    let mut ai = 0usize;
    let mut bi = 0usize;

    while ai + 4 <= a.len() && bi + 4 <= b.len() {
        let va = _mm_loadu_si128(a.as_ptr().add(ai) as *const __m128i);
        let vb = _mm_loadu_si128(b.as_ptr().add(bi) as *const __m128i);

        let a_max = a[ai + 3];
        let b_max = b[bi + 3];

        if a_max < b[bi] {
            ai += 4;
            continue;
        }
        if b_max < a[ai] {
            bi += 4;
            continue;
        }

        // Exhaustive 4x4 comparison: shuffle vb into 4 rotations and compare
        // Shuffle immediates: rotate by 1 = 0x39, by 2 = 0x4E, by 3 = 0x93
        let eq0 = _mm_cmpeq_epi32(va, vb);
        let eq1 = _mm_cmpeq_epi32(va, _mm_shuffle_epi32::<0x39>(vb));
        let eq2 = _mm_cmpeq_epi32(va, _mm_shuffle_epi32::<0x4E>(vb));
        let eq3 = _mm_cmpeq_epi32(va, _mm_shuffle_epi32::<0x93>(vb));

        let any = _mm_or_si128(_mm_or_si128(eq0, eq1), _mm_or_si128(eq2, eq3));
        let mask = _mm_movemask_ps(_mm_castsi128_ps(any));

        if mask & 1 != 0 {
            out.push(a[ai]);
        }
        if mask & 2 != 0 {
            out.push(a[ai + 1]);
        }
        if mask & 4 != 0 {
            out.push(a[ai + 2]);
        }
        if mask & 8 != 0 {
            out.push(a[ai + 3]);
        }

        if a_max <= b_max {
            ai += 4;
        }
        if b_max <= a_max {
            bi += 4;
        }
    }

    // Scalar tail
    while ai < a.len() && bi < b.len() {
        match a[ai].cmp(&b[bi]) {
            std::cmp::Ordering::Less => ai += 1,
            std::cmp::Ordering::Greater => bi += 1,
            std::cmp::Ordering::Equal => {
                out.push(a[ai]);
                ai += 1;
                bi += 1;
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_inputs() {
        assert_eq!(intersect_sorted_u32(&[], &[]), Vec::<u32>::new());
        assert_eq!(intersect_sorted_u32(&[1, 2, 3], &[]), Vec::<u32>::new());
        assert_eq!(intersect_sorted_u32(&[], &[1, 2, 3]), Vec::<u32>::new());
    }

    #[test]
    fn no_overlap() {
        assert_eq!(
            intersect_sorted_u32(&[1, 2, 3], &[4, 5, 6]),
            Vec::<u32>::new()
        );
    }

    #[test]
    fn full_overlap() {
        assert_eq!(intersect_sorted_u32(&[1, 2, 3], &[1, 2, 3]), vec![1, 2, 3]);
    }

    #[test]
    fn partial_overlap() {
        assert_eq!(
            intersect_sorted_u32(&[1, 3, 5, 7], &[2, 3, 5, 8]),
            vec![3, 5]
        );
    }

    #[test]
    fn single_element() {
        assert_eq!(intersect_sorted_u32(&[5], &[5]), vec![5]);
        assert_eq!(intersect_sorted_u32(&[5], &[6]), Vec::<u32>::new());
    }

    #[test]
    fn galloping_path() {
        // small=4, large=64 -> ratio 16:1, triggers galloping
        let small = vec![10, 30, 50, 70];
        let large: Vec<u32> = (0..64).collect();
        assert_eq!(intersect_sorted_u32(&small, &large), vec![10, 30, 50]);
    }

    #[test]
    fn galloping_correctness() {
        let small = vec![1u32, 100, 999];
        let large: Vec<u32> = (0..1000).collect();
        assert_eq!(intersect_galloping(&small, &large), vec![1, 100, 999]);
    }

    #[test]
    fn galloping_no_match() {
        let small = vec![1001u32, 2000, 3000];
        let large: Vec<u32> = (0..1000).collect();
        assert_eq!(intersect_galloping(&small, &large), Vec::<u32>::new());
    }

    #[test]
    fn galloping_first_element() {
        let small = vec![0u32];
        let large: Vec<u32> = (0..100).collect();
        assert_eq!(intersect_galloping(&small, &large), vec![0]);
    }

    #[test]
    fn galloping_last_element() {
        let small = vec![99u32];
        let large: Vec<u32> = (0..100).collect();
        assert_eq!(intersect_galloping(&small, &large), vec![99]);
    }

    #[test]
    fn simd_path_balanced() {
        // Both sides >=16, ratio <8:1 -> SIMD block merge
        let a: Vec<u32> = (0..32).step_by(2).collect();
        let b: Vec<u32> = (0..32).step_by(3).collect();
        let expected = intersect_sorted_scalar(&a, &b);
        assert_eq!(intersect_sorted_u32(&a, &b), expected);
    }

    #[test]
    fn large_matches_scalar() {
        let a: Vec<u32> = (0..500).step_by(3).collect();
        let b: Vec<u32> = (0..500).step_by(5).collect();
        let expected = intersect_sorted_scalar(&a, &b);
        assert_eq!(intersect_sorted_u32(&a, &b), expected);
    }

    #[test]
    fn block_boundary_exact() {
        let a = vec![1u32, 3, 5, 7];
        let b = vec![2u32, 3, 6, 7];
        assert_eq!(intersect_sorted_u32(&a, &b), vec![3, 7]);
    }

    #[test]
    fn block_boundary_plus_tail() {
        let a = vec![1u32, 3, 5, 7, 9];
        let b = vec![2u32, 3, 6, 7, 9];
        assert_eq!(intersect_sorted_u32(&a, &b), vec![3, 7, 9]);
    }

    #[test]
    fn large_non_overlapping_blocks() {
        // Interleaved ranges with no actual overlap
        let a: Vec<u32> = (0..200).step_by(2).collect(); // evens
        let b: Vec<u32> = (1..200).step_by(2).collect(); // odds
        assert_eq!(intersect_sorted_u32(&a, &b), Vec::<u32>::new());
    }

    #[test]
    fn large_fully_overlapping() {
        let a: Vec<u32> = (0..100).collect();
        let b: Vec<u32> = (0..100).collect();
        assert_eq!(intersect_sorted_u32(&a, &b), a);
    }

    #[test]
    fn reversed_argument_order() {
        // Result must be the same regardless of argument order
        let a: Vec<u32> = (0..200).step_by(3).collect();
        let b: Vec<u32> = (0..200).step_by(7).collect();
        assert_eq!(intersect_sorted_u32(&a, &b), intersect_sorted_u32(&b, &a));
    }

    #[test]
    fn stress_all_paths() {
        // Run many sizes to exercise scalar, SIMD, and galloping paths
        for n in [0, 1, 3, 4, 7, 8, 15, 16, 17, 31, 32, 64, 128, 256] {
            for m in [0, 1, 3, 4, 7, 8, 15, 16, 17, 31, 32, 64, 128, 256] {
                let a: Vec<u32> = (0..(n * 3) as u32).step_by(3).collect();
                let b: Vec<u32> = (0..(m * 5) as u32).step_by(5).collect();
                let expected = intersect_sorted_scalar(&a, &b);
                let actual = intersect_sorted_u32(&a, &b);
                assert_eq!(
                    actual, expected,
                    "mismatch for n={n}, m={m}: expected {expected:?}, got {actual:?}"
                );
            }
        }
    }
}
