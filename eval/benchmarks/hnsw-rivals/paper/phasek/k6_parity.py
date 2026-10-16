# K6 parity check (PAPER_PLAN section 7, AVX-512 parity tests): copies the 512-bit Hamming kernels out of
# crates/sweet-search-native/src/hnsw_search.rs into a standalone program (the crate's own tests cannot link
# outside Node) and checks the AVX-512 VPOPCNTDQ batch (8-code transposed reduction), the 8- and 4-code scan
# helpers and the AVX2 batch against scalar POPCNT: random codes, all-zero / all-one codes (0 and 512), one bit,
# id lists of length 0, 1, 3, 4, 5, 7, 8, 64, 1003. Run on an x86 machine with AVX-512 VPOPCNTDQ:
#   python3 k6_parity.py <repo> && rustc -O --edition 2021 /tmp/k6_parity.rs -o /tmp/k6_parity && /tmp/k6_parity
import os, sys

src = open(os.path.join(sys.argv[1], 'crates/sweet-search-native/src/hnsw_search.rs')).read()


def grab(name):
    i = src.index(f'unsafe fn {name}(')
    j = src.rfind('\n#[cfg(target_arch = "x86_64")]', 0, i)
    k, d = src.index('{', i), 0
    for q in range(k, len(src)):
        d += {'{': 1, '}': -1}.get(src[q], 0)
        if d == 0:
            return src[j:q + 1]


TEST = r'''
fn cpu_v3() -> bool { is_x86_feature_detected!("avx2") && is_x86_feature_detected!("popcnt") }
fn scalar(a: &[u64], b: &[u64]) -> u32 { a.iter().zip(b).map(|(x, y)| (x ^ y).count_ones()).sum() }
fn main() {
    assert!(cpu_v3() && is_x86_feature_detected!("avx512f") && is_x86_feature_detected!("avx512vpopcntdq"), "needs AVX-512 VPOPCNTDQ");
    let mut s = 0x9e37_79b9_7f4a_7c15u64;
    let mut next = || { s ^= s << 13; s ^= s >> 7; s ^= s << 17; s };
    let n = 1003usize;
    let mut slab: Vec<u64> = (0..n * 8).map(|_| next()).collect();
    slab[..8].fill(0);
    slab[8..16].fill(u64::MAX);
    for w in 0..8 { slab[16 + w] = if w == 3 { 1 << 63 } else { 0 }; }
    for query in [vec![0u64; 8], vec![u64::MAX; 8], (0..8).map(|_| next()).collect::<Vec<_>>()] {
        for len in [0usize, 1, 3, 4, 5, 7, 8, 64, 1003] {
            let ids: Vec<u32> = (0..len as u32).map(|i| (i * 7919) % n as u32).collect();
            let want: Vec<u32> = ids.iter().map(|&i| scalar(&slab[i as usize * 8..i as usize * 8 + 8], &query)).collect();
            let (mut a, mut b) = (vec![0u32; len], vec![0u32; len]);
            unsafe {
                hamming512_batch_avx512(slab.as_ptr(), query.as_ptr(), &ids, &mut a);
                hamming512_batch_avx2(slab.as_ptr(), query.as_ptr(), &ids, &mut b);
            }
            assert_eq!(a, want, "avx512 batch, len {len}");
            assert_eq!(b, want, "avx2 batch, len {len}");
        }
        for i in (0..n - 8).step_by(8) {
            let x = unsafe { hamming512_x8_avx512(slab.as_ptr().add(i * 8), query.as_ptr()) };
            for j in 0..8 { assert_eq!(x[j] as u32, scalar(&slab[(i + j) * 8..(i + j) * 8 + 8], &query), "x8 at {}", i + j); }
        }
        for i in (0..n - 4).step_by(4) {
            let x = unsafe { hamming512_x4_avx512(slab.as_ptr().add(i * 8), query.as_ptr()) };
            for j in 0..4 { assert_eq!(x[j] as u32, scalar(&slab[(i + j) * 8..(i + j) * 8 + 8], &query), "x4 at {}", i + j); }
        }
    }
    println!("K6 PARITY OK: avx512 batch, avx2 batch, x8, x4 == scalar POPCNT");
}
'''
fns = [grab(f) for f in ('sum8_transposed', 'hamming512_batch_avx2', 'hamming512_batch_avx512', 'hamming512_x8_avx512', 'hamming512_x4_avx512')]
open('/tmp/k6_parity.rs', 'w').write('\n'.join(fns) + TEST)
print('wrote /tmp/k6_parity.rs')
