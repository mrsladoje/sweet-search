//! Native query path for the binary (Hamming) HNSW index.
//!
//! An exact port of `greedySearchQuery` / `searchLayerQuery` in
//! `core/vector-store/binary-hnsw-index.js`: same visit order, same heap
//! sift rules (so equal-distance ties resolve identically), same early
//! termination. This struct holds a read-only CSR snapshot of the graph plus
//! the packed vector slab; once it exists the JS index releases its own graph
//! arrays and rebuilds them from `export_level` only when a writer needs them.

use napi::bindgen_prelude::{Float64Array, Int8Array, Uint32Array, Uint8Array};
use napi_derive::napi;

/// Heap block for the large read-mostly arrays of the walk (codes, graph,
/// visited bytes). With `huge` on, a block of 4 MB or more is 2 MB aligned and, on Linux,
/// marked MADV_HUGEPAGE before it is first written, so the kernel can back it
/// with huge pages (fewer TLB misses on the random reads of the walk) and
/// every 64-byte code sits in one cache line. With `huge` off it has the
/// alignment of `T`, as a `Vec<T>` (glibc puts a large block 16 bytes past a
/// page start). `SS_FIX_HNSW_HUGE=0` turns it off. Same results either
/// way; 1M dev set (2026-10-14): x86 EPYC p50 1,386 -> 719 us, M3 Max equal.
struct AlignedBuf<T: Copy> {
    ptr: std::ptr::NonNull<T>,
    len: usize,
    layout: std::alloc::Layout,
}

unsafe impl<T: Copy + Send> Send for AlignedBuf<T> {}
unsafe impl<T: Copy + Sync> Sync for AlignedBuf<T> {}

const HUGE_PAGE: usize = 2 << 20;

fn huge_on() -> bool {
    std::env::var("SS_FIX_HNSW_HUGE").map(|v| v != "0").unwrap_or(true)
}

impl<T: Copy> AlignedBuf<T> {
    fn zeroed(len: usize, huge: bool) -> Self {
        let elem = std::mem::size_of::<T>();
        if len == 0 || elem == 0 {
            let layout = std::alloc::Layout::from_size_align(0, std::mem::align_of::<T>()).unwrap();
            return Self { ptr: std::ptr::NonNull::dangling(), len: 0, layout };
        }
        let bytes = len * elem;
        // Huge pages only for blocks of 2+ huge pages (the round-up wastes
        // under half); smaller blocks just get cache-line alignment.
        let madv = huge && bytes >= 2 * HUGE_PAGE;
        let (size, align) = if madv {
            (bytes.div_ceil(HUGE_PAGE) * HUGE_PAGE, HUGE_PAGE)
        } else if huge {
            (bytes, std::mem::align_of::<T>().max(64))
        } else {
            (bytes, std::mem::align_of::<T>())
        };
        let layout = std::alloc::Layout::from_size_align(size, align).expect("AlignedBuf layout");
        // SAFETY: size > 0. The block is zeroed below before any read.
        let raw = unsafe { std::alloc::alloc(layout) };
        if raw.is_null() {
            std::alloc::handle_alloc_error(layout);
        }
        #[cfg(target_os = "linux")]
        if madv {
            // SAFETY: [raw, raw + size) is our own 2 MB-aligned block.
            unsafe { libc::madvise(raw as *mut libc::c_void, size, libc::MADV_HUGEPAGE) };
        }
        // SAFETY: raw holds `size` writable bytes.
        unsafe { std::ptr::write_bytes(raw, 0, size) };
        Self { ptr: std::ptr::NonNull::new(raw as *mut T).unwrap(), len, layout }
    }

    fn from_slice(src: &[T], huge: bool) -> Self {
        let mut b = Self::zeroed(src.len(), huge);
        b.copy_from_slice(src);
        b
    }
}

impl<T: Copy> Drop for AlignedBuf<T> {
    fn drop(&mut self) {
        if self.layout.size() > 0 {
            // SAFETY: allocated in `zeroed` with this layout.
            unsafe { std::alloc::dealloc(self.ptr.as_ptr() as *mut u8, self.layout) };
        }
    }
}

impl<T: Copy> std::ops::Deref for AlignedBuf<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        // SAFETY: ptr holds len initialized values (or is dangling with len 0).
        unsafe { std::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
    }
}

impl<T: Copy> std::ops::DerefMut for AlignedBuf<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        // SAFETY: as in deref, and &mut self is unique.
        unsafe { std::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len) }
    }
}

impl<T: Copy> Default for AlignedBuf<T> {
    fn default() -> Self {
        Self::zeroed(0, false)
    }
}

struct Csr {
    offsets: AlignedBuf<u32>, // len = nodes + 1
    neighbors: AlignedBuf<u32>,
}

impl Csr {
    fn empty() -> Self {
        Csr { offsets: AlignedBuf::from_slice(&[0], false), neighbors: AlignedBuf::default() }
    }

    #[inline(always)]
    fn of(&self, node: u32) -> &[u32] {
        let i = node as usize;
        if i + 1 >= self.offsets.len() {
            return &[];
        }
        &self.neighbors[self.offsets[i] as usize..self.offsets[i + 1] as usize]
    }
}

// Heap entries pack (val << 32) | key into one u64, so a sift step moves one
// word instead of two. Every comparison uses the val half only, with the
// same strict/non-strict rules as the JS heaps, and the hole-based sifts make
// the same comparisons as the swap-based JS code, so the layout is identical.
#[inline(always)]
fn pack(key: u32, val: u32) -> u64 {
    ((val as u64) << 32) | key as u64
}
#[inline(always)]
fn val_of(e: u64) -> u32 {
    (e >> 32) as u32
}
#[inline(always)]
fn key_of(e: u64) -> u32 {
    e as u32
}

// Heap storage: `buf` stays fully initialized and at least 2 * len + 16
// long, so a sift can read a node's four grandchildren together with its
// two children (the grandchildren of an inner node always sit below
// 2 * len + 16). Reading one level ahead halves the chain of dependent loads
// per level; the decisions themselves are unchanged.
#[inline(always)]
fn grow(buf: &mut Vec<u64>, len: usize) {
    let need = 2 * len + 16;
    if buf.len() < need {
        buf.resize(need.next_power_of_two(), 0);
    }
}

/// Sift `x` up from slot `i0` (min order when `MIN`): it passes every
/// ancestor that is strictly worse, as in the JS heaps.
#[inline(always)]
unsafe fn sift_up<const MIN: bool>(buf: *mut u64, i0: usize, x: u64) {
    let xv = val_of(x);
    let mut i = i0;
    while i > 0 {
        let p = (i - 1) >> 1;
        let pe = *buf.add(p);
        if if MIN { xv >= val_of(pe) } else { xv <= val_of(pe) } { break; }
        *buf.add(i) = pe;
        i = p;
    }
    *buf.add(i) = x;
}

/// Sift `x` down from the root over `n` live slots. JS rule (min order):
/// smallest = i; take left if left < x; take right if right < (that).
/// Equivalent: the child is right iff right < left (ties go left), and x
/// moves down iff that child < x. Max order mirrors every comparison.
#[inline(always)]
unsafe fn sift_down<const MIN: bool>(buf: *mut u64, n: usize, x: u64) {
    let xv = val_of(x);
    let mut i = 0usize;
    let mut l = *buf.add(1);
    let mut r = *buf.add(2);
    loop {
        let left = 2 * i + 1;
        if left >= n {
            break;
        }
        // Volatile so the four grandchild loads issue now, before the
        // child choice is known (the compiler would otherwise load only the
        // chosen pair, after the compare).
        let g = buf.add(4 * i + 3);
        let (g0, g1, g2, g3) = (
            std::ptr::read_volatile(g),
            std::ptr::read_volatile(g.add(1)),
            std::ptr::read_volatile(g.add(2)),
            std::ptr::read_volatile(g.add(3)),
        );
        let lv = val_of(l);
        let rv = if left + 1 < n { val_of(r) } else if MIN { u32::MAX } else { 0 };
        let tr = if MIN { rv < lv } else { rv > lv };
        let (cv, ce) = if tr { (rv, r) } else { (lv, l) };
        if if MIN { cv >= xv } else { cv <= xv } {
            break;
        }
        *buf.add(i) = ce;
        i = left + tr as usize;
        l = if tr { g2 } else { g0 };
        r = if tr { g3 } else { g1 };
    }
    *buf.add(i) = x;
}

/// Binary heap with the exact sift rules of `TypedMinHeap` (`MIN`) or
/// `TypedMaxHeap`.
#[derive(Default)]
struct Heap<const MIN: bool> {
    buf: Vec<u64>,
    n: usize,
}

type MinHeap = Heap<true>;
type MaxHeap = Heap<false>;

impl<const MIN: bool> Heap<MIN> {
    fn clear(&mut self) {
        self.n = 0;
        grow(&mut self.buf, 0);
    }
    #[inline(always)]
    fn len(&self) -> usize {
        self.n
    }
    #[inline(always)]
    fn peek_val(&self) -> u32 {
        val_of(self.buf[0])
    }
    #[inline(always)]
    fn peek_key(&self) -> Option<u32> {
        (self.n > 0).then(|| key_of(self.buf[0]))
    }
    #[inline(always)]
    fn insert(&mut self, key: u32, val: u32) {
        grow(&mut self.buf, self.n + 1);
        // SAFETY: buf holds at least 2 * (n + 1) + 16 slots.
        unsafe { sift_up::<MIN>(self.buf.as_mut_ptr(), self.n, pack(key, val)) };
        self.n += 1;
    }
    /// Remove the root (`extractMin` / `extractMax`), returning its key.
    #[inline(always)]
    fn pop(&mut self) -> u64 {
        let top = self.buf[0];
        self.n -= 1;
        let n = self.n;
        if n > 0 {
            let last = self.buf[n];
            // SAFETY: buf holds at least 2 * n + 16 slots.
            unsafe { sift_down::<MIN>(self.buf.as_mut_ptr(), n, last) };
        }
        top
    }
    /// Overwrite the root and sift it down (max heap: `replaceMax`).
    #[inline(always)]
    fn replace_top(&mut self, key: u32, val: u32) {
        // SAFETY: as in pop.
        unsafe { sift_down::<MIN>(self.buf.as_mut_ptr(), self.n, pack(key, val)) };
    }
    /// Pop everything into `out_*`, filled from the back (max heap: ascending,
    /// same extraction order as `drainSorted`).
    fn drain_into(&mut self, out_keys: &mut [u32], out_vals: &mut [u32]) {
        for i in (0..self.n).rev() {
            let top = self.pop();
            out_keys[i] = key_of(top);
            out_vals[i] = val_of(top);
        }
    }
}

/// Candidate queue of the walk: pops the smallest distance.
trait CandQueue: Default {
    fn reset(&mut self, max_dist: usize);
    fn len(&self) -> usize;
    fn peek_val(&self) -> u32;
    fn peek_key(&self) -> Option<u32>;
    fn pop_key(&mut self) -> u32;
    fn insert(&mut self, key: u32, val: u32);
}

/// Result set of the walk: the `ef` best seen, largest distance on top.
trait ResQueue: Default {
    fn reset(&mut self, max_dist: usize);
    fn len(&self) -> usize;
    fn peek_val(&self) -> u32;
    fn insert(&mut self, key: u32, val: u32);
    /// Drop one entry at the largest distance and add (key, val), val < top.
    fn replace_top(&mut self, key: u32, val: u32);
    /// All entries ascending by distance.
    fn drain_into(&mut self, keys: &mut [u32], vals: &mut [u32]);
}

impl CandQueue for MinHeap {
    fn reset(&mut self, _: usize) { self.clear() }
    fn len(&self) -> usize { self.n }
    fn peek_val(&self) -> u32 { Heap::peek_val(self) }
    fn peek_key(&self) -> Option<u32> { Heap::peek_key(self) }
    fn pop_key(&mut self) -> u32 { key_of(self.pop()) }
    fn insert(&mut self, key: u32, val: u32) { Heap::insert(self, key, val) }
}

impl ResQueue for MaxHeap {
    fn reset(&mut self, _: usize) { self.clear() }
    fn len(&self) -> usize { self.n }
    fn peek_val(&self) -> u32 { Heap::peek_val(self) }
    fn insert(&mut self, key: u32, val: u32) { Heap::insert(self, key, val) }
    fn replace_top(&mut self, key: u32, val: u32) { Heap::replace_top(self, key, val) }
    fn drain_into(&mut self, keys: &mut [u32], vals: &mut [u32]) { Heap::drain_into(self, keys, vals) }
}

/// Bucket queues: Hamming distances are small integers (0..=bits), so one
/// bucket per distance gives O(1) push and amortized O(1) pop / top, where
/// the binary heaps spend ~10 dependent steps per operation. Equal distances
/// come out newest first (the heaps' tie order is not reproduced).
#[derive(Default)]
struct Buckets {
    b: Vec<Vec<u32>>,
    n: usize,
    lo: usize, // smallest non-empty bucket (when n > 0)
    hi: usize, // largest non-empty bucket (when n > 0)
}

impl Buckets {
    fn reset(&mut self, max_dist: usize) {
        if self.b.len() <= max_dist {
            self.b.resize_with(max_dist + 1, Vec::new);
        }
        if self.n > 0 {
            for v in &mut self.b[self.lo..=self.hi] {
                v.clear();
            }
        }
        self.n = 0;
    }
    #[inline(always)]
    fn push(&mut self, key: u32, val: u32) {
        let v = val as usize;
        if self.n == 0 {
            self.lo = v;
            self.hi = v;
        } else {
            self.lo = self.lo.min(v);
            self.hi = self.hi.max(v);
        }
        self.b[v].push(key);
        self.n += 1;
    }
}

#[derive(Default)]
struct BucketMin(Buckets);

impl CandQueue for BucketMin {
    fn reset(&mut self, max_dist: usize) { self.0.reset(max_dist) }
    #[inline(always)]
    fn len(&self) -> usize { self.0.n }
    #[inline(always)]
    fn peek_val(&self) -> u32 { self.0.lo as u32 }
    #[inline(always)]
    fn peek_key(&self) -> Option<u32> {
        if self.0.n == 0 { None } else { self.0.b[self.0.lo].last().copied() }
    }
    #[inline(always)]
    fn pop_key(&mut self) -> u32 {
        let q = &mut self.0;
        let k = q.b[q.lo].pop().unwrap();
        q.n -= 1;
        if q.n > 0 {
            while q.b[q.lo].is_empty() {
                q.lo += 1;
            }
        }
        k
    }
    #[inline(always)]
    fn insert(&mut self, key: u32, val: u32) { self.0.push(key, val) }
}

#[derive(Default)]
struct BucketMax(Buckets);

impl ResQueue for BucketMax {
    fn reset(&mut self, max_dist: usize) { self.0.reset(max_dist) }
    #[inline(always)]
    fn len(&self) -> usize { self.0.n }
    #[inline(always)]
    fn peek_val(&self) -> u32 { self.0.hi as u32 }
    #[inline(always)]
    fn insert(&mut self, key: u32, val: u32) { self.0.push(key, val) }
    #[inline(always)]
    fn replace_top(&mut self, key: u32, val: u32) {
        let q = &mut self.0;
        q.b[q.hi].pop();
        q.n -= 1;
        q.push(key, val);
        while q.b[q.hi].is_empty() {
            q.hi -= 1;
        }
    }
    fn drain_into(&mut self, keys: &mut [u32], vals: &mut [u32]) {
        let q = &mut self.0;
        let mut i = 0;
        if q.n > 0 {
            for v in q.lo..=q.hi {
                for &k in &q.b[v] {
                    keys[i] = k;
                    vals[i] = v as u32;
                    i += 1;
                }
                q.b[v].clear();
            }
        }
        q.n = 0;
    }
}

/// Hamming distance over `words` u64 words. 512-bit vectors (the production
/// shape) take a NEON path on aarch64.
#[inline(always)]
fn hamming(a: &[u64], b: &[u64]) -> u32 {
    #[cfg(target_arch = "aarch64")]
    if a.len() == 8 {
        // SAFETY: both slices hold exactly 64 readable bytes.
        unsafe {
            use std::arch::aarch64::*;
            let pa = a.as_ptr() as *const u8;
            let pb = b.as_ptr() as *const u8;
            let c0 = vcntq_u8(veorq_u8(vld1q_u8(pa), vld1q_u8(pb)));
            let c1 = vcntq_u8(veorq_u8(vld1q_u8(pa.add(16)), vld1q_u8(pb.add(16))));
            let c2 = vcntq_u8(veorq_u8(vld1q_u8(pa.add(32)), vld1q_u8(pb.add(32))));
            let c3 = vcntq_u8(veorq_u8(vld1q_u8(pa.add(48)), vld1q_u8(pb.add(48))));
            // Each lane is at most 4 * 8 = 32, so the u8 adds cannot overflow.
            return vaddlvq_u8(vaddq_u8(vaddq_u8(c0, c1), vaddq_u8(c2, c3))) as u32;
        }
    }
    let mut d = 0u32;
    for w in 0..a.len() {
        d += (a[w] ^ b[w]).count_ones();
    }
    d
}

/// `hamming` with the POPCNT instruction (the baseline x86-64 build has none).
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "popcnt")]
unsafe fn hamming_popcnt(a: &[u64], b: &[u64]) -> u32 {
    let mut d = 0u32;
    for w in 0..a.len() {
        d += (a[w] ^ b[w]).count_ones();
    }
    d
}

/// Hamming distances of 64-byte codes at `ids` to the 64-byte query, four
/// codes per step: per-byte popcount of code ^ query by nibble lookup
/// (`vpshufb`), bytes summed per 64-bit lane (`vpsadbw`), lanes folded to one
/// distance per code. Exact, like POPCNT, and faster on Zen 3.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2,popcnt")]
unsafe fn hamming512_batch_avx2(slab: *const u64, query: *const u64, ids: &[u32], out: &mut [u32]) {
    use std::arch::x86_64::*;
    let lut = _mm256_setr_epi8(0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4, 0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4);
    let low = _mm256_set1_epi8(0x0f);
    let qv0 = _mm256_loadu_si256(query as *const __m256i);
    let qv1 = _mm256_loadu_si256(query.add(4) as *const __m256i);
    let mut c = 0;
    while c + 4 <= ids.len() {
        let mut sad = [_mm256_setzero_si256(); 4];
        for (j, s) in sad.iter_mut().enumerate() {
            let p = slab.add(ids[c + j] as usize * 8);
            let a = _mm256_xor_si256(_mm256_loadu_si256(p as *const __m256i), qv0);
            let b = _mm256_xor_si256(_mm256_loadu_si256(p.add(4) as *const __m256i), qv1);
            let ca = _mm256_add_epi8(
                _mm256_shuffle_epi8(lut, _mm256_and_si256(a, low)),
                _mm256_shuffle_epi8(lut, _mm256_and_si256(_mm256_srli_epi16::<4>(a), low)),
            );
            let cb = _mm256_add_epi8(
                _mm256_shuffle_epi8(lut, _mm256_and_si256(b, low)),
                _mm256_shuffle_epi8(lut, _mm256_and_si256(_mm256_srli_epi16::<4>(b), low)),
            );
            *s = _mm256_sad_epu8(_mm256_add_epi8(ca, cb), _mm256_setzero_si256());
        }
        let t01 = _mm256_add_epi64(_mm256_unpacklo_epi64(sad[0], sad[1]), _mm256_unpackhi_epi64(sad[0], sad[1]));
        let t23 = _mm256_add_epi64(_mm256_unpacklo_epi64(sad[2], sad[3]), _mm256_unpackhi_epi64(sad[2], sad[3]));
        let u = _mm256_add_epi64(_mm256_permute2x128_si256::<0x20>(t01, t23), _mm256_permute2x128_si256::<0x31>(t01, t23));
        let mut o = [0u64; 4];
        _mm256_storeu_si256(o.as_mut_ptr() as *mut __m256i, u);
        for j in 0..4 {
            out[c + j] = o[j] as u32;
        }
        c += 4;
    }
    while c < ids.len() {
        let p = slab.add(ids[c] as usize * 8);
        let mut d = 0u32;
        for w in 0..8 {
            d += (*p.add(w) ^ *query.add(w)).count_ones();
        }
        out[c] = d;
        c += 1;
    }
}

/// Eight per-word popcount vectors (one per code) summed to one zmm of eight
/// distances (lane j = code j) by a transposed reduction: 4 unpack adds, 2 + 1
/// block-shuffle adds instead of eight horizontal adds.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f")]
#[inline]
unsafe fn sum8_transposed(c: [std::arch::x86_64::__m512i; 8]) -> std::arch::x86_64::__m512i {
    use std::arch::x86_64::*;
    let u = |a: __m512i, b: __m512i| _mm512_add_epi64(_mm512_unpacklo_epi64(a, b), _mm512_unpackhi_epi64(a, b));
    let (u01, u23, u45, u67) = (u(c[0], c[1]), u(c[2], c[3]), u(c[4], c[5]), u(c[6], c[7]));
    let w = |a: __m512i, b: __m512i| _mm512_add_epi64(_mm512_shuffle_i64x2::<0b10_00_10_00>(a, b), _mm512_shuffle_i64x2::<0b11_01_11_01>(a, b));
    let (w03, w47) = (w(u01, u23), w(u45, u67));
    w(w03, w47)
}

/// Hamming distances of 64-byte codes at `ids` to the 64-byte query with
/// AVX-512 VPOPCNTDQ: one zmm per code, eight 64-bit popcounts, eight codes
/// reduced together. Exact, the same distances as POPCNT.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f,avx512vpopcntdq,avx2,popcnt")]
unsafe fn hamming512_batch_avx512(slab: *const u64, query: *const u64, ids: &[u32], out: &mut [u32]) {
    use std::arch::x86_64::*;
    let q = _mm512_loadu_si512(query as *const _);
    let pc = |id: u32| _mm512_popcnt_epi64(_mm512_xor_si512(_mm512_loadu_si512(slab.add(id as usize * 8) as *const _), q));
    let mut c = 0;
    while c + 8 <= ids.len() {
        let s = sum8_transposed(std::array::from_fn(|j| pc(ids[c + j])));
        _mm256_storeu_si256(out.as_mut_ptr().add(c) as *mut __m256i, _mm512_cvtepi64_epi32(s));
        c += 8;
    }
    while c < ids.len() {
        out[c] = _mm512_reduce_add_epi64(pc(ids[c])) as u32;
        c += 1;
    }
}

/// Eight 512-bit Hamming distances (consecutive codes at `p`), for the scan.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f,avx512vpopcntdq")]
#[inline]
unsafe fn hamming512_x8_avx512(p: *const u64, query: *const u64) -> [u64; 8] {
    use std::arch::x86_64::*;
    let q = _mm512_loadu_si512(query as *const _);
    let s = sum8_transposed(std::array::from_fn(|j| _mm512_popcnt_epi64(_mm512_xor_si512(_mm512_loadu_si512(p.add(j * 8) as *const _), q))));
    let mut o = [0u64; 8];
    _mm512_storeu_si512(o.as_mut_ptr() as *mut _, s);
    o
}

/// Four 512-bit Hamming distances (consecutive codes at `p`) with AVX-512
/// VPOPCNTDQ, for the scan: the same values as the AVX2 nibble-lookup path.
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512f,avx512vpopcntdq")]
#[inline]
unsafe fn hamming512_x4_avx512(p: *const u64, query: *const u64) -> [u64; 4] {
    use std::arch::x86_64::*;
    let q = _mm512_loadu_si512(query as *const _);
    let d = |c: usize| _mm512_reduce_add_epi64(_mm512_popcnt_epi64(_mm512_xor_si512(_mm512_loadu_si512(p.add(c * 8) as *const _), q))) as u64;
    [d(0), d(1), d(2), d(3)]
}

/// 512-bit Hamming distances, four vectors per step: the per-vector
/// popcounts are reduced together with pairwise adds instead of one
/// horizontal add per vector.
#[cfg(target_arch = "aarch64")]
#[inline(always)]
unsafe fn hamming512_batch(slab: *const u64, query: *const u64, ids: &[u32], out: &mut [u32]) {
    use std::arch::aarch64::*;
    let q = query as *const u8;
    let (q0, q1, q2, q3) = (vld1q_u8(q), vld1q_u8(q.add(16)), vld1q_u8(q.add(32)), vld1q_u8(q.add(48)));
    // Per-vector popcount, folded to 16 lanes of at most 32 each.
    let pc = |id: u32| -> uint8x16_t {
        let p = slab.add(id as usize * 8) as *const u8;
        let c0 = vcntq_u8(veorq_u8(vld1q_u8(p), q0));
        let c1 = vcntq_u8(veorq_u8(vld1q_u8(p.add(16)), q1));
        let c2 = vcntq_u8(veorq_u8(vld1q_u8(p.add(32)), q2));
        let c3 = vcntq_u8(veorq_u8(vld1q_u8(p.add(48)), q3));
        vaddq_u8(vaddq_u8(c0, c1), vaddq_u8(c2, c3))
    };
    let n = ids.len();
    let mut i = 0;
    while i + 4 <= n {
        let (a, b, c, d) = (pc(ids[i]), pc(ids[i + 1]), pc(ids[i + 2]), pc(ids[i + 3]));
        // Lanes: 32 -> 64 -> 128 (u8), then widen: 4 lanes per vector -> 1.
        let ab = vpaddq_u8(a, b);
        let cd = vpaddq_u8(c, d);
        let abcd = vpaddq_u8(ab, cd);
        let s = vpaddlq_u16(vpaddlq_u8(abcd));
        vst1q_u32(out.as_mut_ptr().add(i), s);
        i += 4;
    }
    while i < n {
        out[i] = vaddlvq_u8(pc(ids[i])) as u32;
        i += 1;
    }
}

#[inline(always)]
fn prefetch(p: *const u64) {
    // SAFETY: prefetch hints never fault, even on invalid addresses.
    #[cfg(target_arch = "aarch64")]
    unsafe {
        std::arch::asm!("prfm pldl1keep, [{0}]", in(reg) p, options(nostack, readonly, preserves_flags));
    }
    #[cfg(target_arch = "x86_64")]
    unsafe {
        std::arch::x86_64::_mm_prefetch::<{ std::arch::x86_64::_MM_HINT_T0 }>(p as *const i8);
    }
}

/// Prefetch every cache line of a neighbor list so the lines load in
/// parallel instead of one after another.
#[inline(always)]
fn prefetch_list(list: &[u32]) {
    let mut i = 0;
    while i < list.len() {
        prefetch(list.as_ptr().wrapping_add(i) as *const u64);
        i += 16; // 16 u32 = one 64-byte line
    }
}

/// x86-64-v3 kernels usable (see `rescore::x86_v3`).
fn cpu_v3() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        crate::rescore::x86_v3()
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

/// AVX-512 VPOPCNTDQ usable for 512-bit Hamming (one code = one zmm), on
/// top of x86-64-v3. `SS_HNSW_NO_AVX512=1` turns it off (A/B in one binary).
fn cpu_v4() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        cpu_v3()
            && is_x86_feature_detected!("avx512f")
            && is_x86_feature_detected!("avx512vpopcntdq")
            && std::env::var("SS_HNSW_NO_AVX512").map_or(true, |v| v != "1")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        false
    }
}

/// Distinct 512-bit Hamming distances (0..=512).
const SCAN_BINS: usize = 512 + 1;

/// Cutoff of a 512-bit scan from its four sub-histograms: `t` such that the
/// top `k` are all of d < t plus the first (k - below) nodes at d == t, and
/// `pos[v]`, the output slot of the first node at distance v (v <= t).
fn scan_cutoff(hist: &[[u32; SCAN_BINS]; 4], k: usize) -> ([u32; SCAN_BINS + 1], usize) {
    let mut pos = [0u32; SCAN_BINS + 1];
    let mut acc = 0u32;
    let mut t = SCAN_BINS;
    for v in 0..SCAN_BINS {
        let h = hist[0][v] + hist[1][v] + hist[2][v] + hist[3][v];
        pos[v] = acc;
        if acc + h >= k as u32 {
            t = v;
            break;
        }
        acc += h;
    }
    (pos, t)
}

/// `analyzeScoreSpread` sums over `n` scores, in the same order and
/// arithmetic: `[top1, top2, min, mean, variance]`.
fn spread(scores: impl Iterator<Item = f64> + Clone, n: usize) -> [f64; 5] {
    let (mut top1, mut top2, mut min, mut sum) = (f64::NEG_INFINITY, f64::NEG_INFINITY, f64::INFINITY, 0.0f64);
    for s in scores.clone() {
        sum += s;
        if s > top1 {
            top2 = top1;
            top1 = s;
        } else if s > top2 {
            top2 = s;
        }
        if s < min {
            min = s;
        }
    }
    let mean = sum / n as f64;
    let mut variance = 0.0f64;
    for s in scores {
        let d = s - mean;
        variance += d * d;
    }
    [top1, top2, min, mean, variance / n as f64]
}

#[napi]
pub struct HnswSearcher {
    words: usize, // u64 words per vector
    slab: AlignedBuf<u64>,
    count: u32,
    levels: Vec<Csr>,
    empty_level: Csr,
    query: Vec<u64>,
    batch: Vec<u32>,
    dists: Vec<u32>,
    all_ids: Vec<u32>,
    // Generation-stamped visited bytes: one byte per node, so neighboring
    // checks never share a word (no store-to-load chains), and no per-query
    // clear except on wrap.
    visited: AlignedBuf<u8>,
    visit_gen: u8,
    cand: MinHeap,
    res: MaxHeap,
    bcand: BucketMin,
    bres: BucketMax,
    // Bucket queues (default) or the JS-exact binary heaps.
    bucket: bool,
    // Fused cascade state (cascade_stage1 -> cascade_int8): live stage-1
    // results in rank order, and a scratch layer output.
    live_idx: Vec<u32>,
    live_dist: Vec<u32>,
    layer_out: Vec<u32>,
    int8_rank: Vec<u32>,
    int8_keys: Vec<u64>,
    int8_score: Vec<f64>,
    int8_missing: Vec<bool>,
    // Distances of one neighbor list in greedy().
    greedy_d: Vec<u32>,
    // Nodes of the last cascade_int8 call in int8 order (for cascade_full).
    int8_nodes: Vec<u32>,
    full_rows: Vec<u32>,
    full_scores: Vec<f64>,
    scan_d: Vec<u16>,
    /// x86-64-v3 kernels (AVX2, POPCNT, ...) usable; always false elsewhere.
    v3: bool,
    /// AVX-512 VPOPCNTDQ Hamming for 512-bit codes (implies v3).
    v4: bool,
    pool_idx: Vec<u32>,
    huge: bool,
    // Level-0 lists are re-pruned at load to at most this many links when
    // the index is walked (more than PRUNE0_MIN_COUNT vectors; smaller ones
    // use the exact scan, so the graph is not searched); 0 keeps the built
    // lists. Pruned lists are back-filled with the nearest dropped links up
    // to the cap, as the build does. 1M dev, stage1 400: 128 with back-fill
    // MRR@10 -0.0002 [-0.0010, +0.0004], recall@10 equal, x86 p50 447 -> 378
    // us, load +10 s; without back-fill MRR -0.0014.
    prune0: usize,
}

/// Default level-0 re-prune cap (M0) for walked indexes.
const PRUNE0_DEFAULT: usize = 128;
/// Re-prune only above this many vectors: up to it the JS side answers with
/// the exact scan (`EXACT_SCAN_MAX_VECTORS` in binary-hnsw-index.js).
const PRUNE0_MIN_COUNT: usize = 150_000;

#[napi]
impl HnswSearcher {
    /// `slab` holds `count` vectors of `dim_bytes` bytes each, back to back.
    #[napi(constructor)]
    pub fn new(dim_bytes: u32, count: u32, slab: Uint8Array) -> napi::Result<Self> {
        let dim = dim_bytes as usize;
        if dim == 0 || slab.len() < dim * count as usize {
            return Err(napi::Error::from_reason("HnswSearcher: slab shorter than count * dim"));
        }
        // Zero-pad each vector to whole u64 words (padding bits are equal on
        // both sides, so XOR-popcount is unchanged).
        let words = dim.div_ceil(8);
        let huge = huge_on();
        let mut packed = AlignedBuf::<u64>::zeroed(words * count as usize, huge);
        for v in 0..count as usize {
            let src = &slab[v * dim..(v + 1) * dim];
            for w in 0..words {
                let mut b = [0u8; 8];
                let end = ((w + 1) * 8).min(dim);
                b[..end - w * 8].copy_from_slice(&src[w * 8..end]);
                packed[v * words + w] = u64::from_le_bytes(b);
            }
        }
        Ok(Self {
            words,
            slab: packed,
            count,
            levels: Vec::new(),
            empty_level: Csr::empty(),
            query: vec![0u64; words],
            batch: Vec::new(),
            dists: Vec::new(),
            all_ids: Vec::new(),
            visited: AlignedBuf::zeroed(count as usize, huge),
            visit_gen: 0,
            cand: MinHeap::default(),
            res: MaxHeap::default(),
            bcand: BucketMin::default(),
            bres: BucketMax::default(),
            bucket: true,
            live_idx: Vec::new(),
            live_dist: Vec::new(),
            layer_out: Vec::new(),
            int8_rank: Vec::new(),
            int8_keys: Vec::new(),
            int8_score: Vec::new(),
            int8_missing: Vec::new(),
            greedy_d: Vec::new(),
            int8_nodes: Vec::new(),
            full_rows: Vec::new(),
            full_scores: Vec::new(),
            scan_d: Vec::new(),
            v3: cpu_v3(),
            v4: cpu_v4(),
            pool_idx: Vec::new(),
            huge,
            prune0: if count as usize > PRUNE0_MIN_COUNT { PRUNE0_DEFAULT } else { 0 },
        })
    }

    /// Install level `level` as CSR: neighbors of node i are
    /// `neighbors[offsets[i]..offsets[i+1]]`.
    #[napi]
    pub fn set_level(&mut self, level: u32, offsets: Uint32Array, neighbors: Uint32Array) -> napi::Result<()> {
        let level = level as usize;
        if neighbors.iter().any(|&n| n >= self.count) {
            return Err(napi::Error::from_reason("HnswSearcher: neighbor index out of range"));
        }
        while self.levels.len() <= level {
            self.levels.push(Csr::empty());
        }
        let csr = if level == 0 && self.prune0 > 0 {
            self.prune_level(&offsets, &neighbors)
        } else {
            Csr { offsets: AlignedBuf::from_slice(&offsets, self.huge), neighbors: AlignedBuf::from_slice(&neighbors, self.huge) }
        };
        self.levels[level] = csr;
        Ok(())
    }

    #[napi]
    pub fn set_query(&mut self, query: Uint8Array) {
        let dim = query.len();
        for w in 0..self.words {
            let mut b = [0u8; 8];
            let start = (w * 8).min(dim);
            let end = ((w + 1) * 8).min(dim);
            b[..end - start].copy_from_slice(&query[start..end]);
            self.query[w] = u64::from_le_bytes(b);
        }
    }

    #[inline(always)]
    fn dist_q(&self, idx: u32) -> u32 {
        let base = idx as usize * self.words;
        hamming(&self.slab[base..base + self.words], &self.query)
    }

    /// Hamming distances from the staged query to each of `ids`.
    #[inline(always)]
    fn dist_batch(&self, ids: &[u32], out: &mut [u32]) {
        #[cfg(target_arch = "aarch64")]
        if self.words == 8 {
            // SAFETY: every id < count (set_level checks), so each vector is
            // 64 readable bytes inside the slab; the query holds 8 words.
            unsafe { hamming512_batch(self.slab.as_ptr(), self.query.as_ptr(), ids, out) };
            return;
        }
        #[cfg(target_arch = "x86_64")]
        if self.words == 8 && self.v4 {
            // SAFETY: AVX-512F and VPOPCNTDQ checked at construction (v4); every id < count.
            unsafe { hamming512_batch_avx512(self.slab.as_ptr(), self.query.as_ptr(), ids, out) };
            return;
        }
        #[cfg(target_arch = "x86_64")]
        if self.words == 8 && self.v3 {
            // SAFETY: AVX2 checked at construction (v3); every id < count.
            unsafe { hamming512_batch_avx2(self.slab.as_ptr(), self.query.as_ptr(), ids, out) };
            return;
        }
        #[cfg(target_arch = "x86_64")]
        if self.words == 8 {
            // Fixed 8 words with the query in registers: no per-word loop.
            // POPCNT inside `walk_v3`; baseline x86-64 gets the bit-twiddle.
            let q: [u64; 8] = std::array::from_fn(|w| self.query[w]);
            let slab = self.slab.as_ptr();
            for (o, &id) in out.iter_mut().zip(ids) {
                // SAFETY: every id < count, so the 8 words are in the slab.
                let p = unsafe { slab.add(id as usize * 8) };
                let mut d = 0u32;
                for (w, &qw) in q.iter().enumerate() {
                    d += unsafe { *p.add(w) ^ qw }.count_ones();
                }
                *o = d;
            }
            return;
        }
        for (o, &id) in out.iter_mut().zip(ids) {
            *o = self.dist_q(id);
        }
    }

    /// Level-0 CSR re-pruned to at most `prune0` links per node with the
    /// HNSW heuristic (Algorithm 4) on Hamming distance: links in order of
    /// distance to the node; a link is dropped when it is closer to a kept
    /// link than to the node; then the nearest dropped links fill the list
    /// up to `prune0`. Kept links stay in distance order.
    fn prune_level(&self, offsets: &[u32], neighbors: &[u32]) -> Csr {
        use rayon::prelude::*;
        let n = offsets.len().saturating_sub(1);
        let (cap, w) = (self.prune0, self.words);
        // Lists saved already pruned (save() prunes level 0 the same way):
        // nothing to do but copy.
        if offsets.windows(2).all(|p| (p[1] - p[0]) as usize <= cap) {
            return Csr { offsets: AlignedBuf::from_slice(offsets, self.huge), neighbors: AlignedBuf::from_slice(neighbors, self.huge) };
        }
        let code = |i: u32| &self.slab[i as usize * w..(i as usize + 1) * w];
        #[cfg(target_arch = "x86_64")]
        let hamming = |a: &[u64], b: &[u64]| -> u32 {
            if self.v3 {
                // SAFETY: POPCNT checked at construction (v3).
                unsafe { hamming_popcnt(a, b) }
            } else {
                hamming(a, b)
            }
        };
        let lists: Vec<Vec<u32>> = (0..n)
            .into_par_iter()
            .map(|v| {
                let list = &neighbors[offsets[v] as usize..offsets[v + 1] as usize];
                if list.len() <= cap {
                    return list.to_vec();
                }
                let mut c: Vec<(u32, u32)> = list.iter().map(|&nb| (hamming(code(v as u32), code(nb)), nb)).collect();
                c.sort_by_key(|&(d, _)| d);
                let mut kept: Vec<u32> = Vec::with_capacity(cap);
                let mut dropped: Vec<u32> = Vec::new();
                for &(d, nb) in &c {
                    if kept.len() >= cap {
                        break;
                    }
                    if kept.iter().all(|&r| hamming(code(nb), code(r)) > d) {
                        kept.push(nb);
                    } else {
                        dropped.push(nb);
                    }
                }
                let room = cap - kept.len();
                kept.extend(dropped.into_iter().take(room));
                kept
            })
            .collect();
        let mut off = Vec::with_capacity(n + 1);
        let mut nbr = Vec::with_capacity(lists.iter().map(|l| l.len()).sum());
        off.push(0u32);
        for l in &lists {
            nbr.extend_from_slice(l);
            off.push(nbr.len() as u32);
        }
        Csr { offsets: AlignedBuf::from_slice(&off, self.huge), neighbors: AlignedBuf::from_slice(&nbr, self.huge) }
    }

    /// Hamming distance from the staged query to vector `idx`.
    #[napi]
    pub fn dist(&self, idx: u32) -> u32 {
        self.dist_q(idx)
    }

    /// Port of `greedySearchQuery`. Each neighbor list is scored in one batch
    /// (the walk's kernels: AVX2 / NEON), then scanned in order with the same
    /// update rule, so the result is the same node.
    #[napi]
    pub fn greedy(&mut self, start: u32, level: u32) -> u32 {
        if level as usize >= self.levels.len() {
            return start;
        }
        let mut d = std::mem::take(&mut self.greedy_d);
        d.resize(1, 0);
        self.dist_batch(&[start], &mut d);
        let mut current = start;
        let mut current_dist = d[0];
        let mut improved = true;
        while improved {
            improved = false;
            let nbs = self.levels[level as usize].of(current);
            d.resize(nbs.len(), 0);
            self.dist_batch(nbs, &mut d);
            for (&nb, &dn) in nbs.iter().zip(d.iter()) {
                if dn < current_dist {
                    current = nb;
                    current_dist = dn;
                    improved = true;
                }
            }
        }
        self.greedy_d = d;
        current
    }

    /// Port of `searchLayerQuery`. `thresholds` is flat
    /// `[progress0, rate0, progress1, rate1, ...]`.
    /// Returns `[visitedCount, n, keys[0..n], dists[0..n]]`, ascending by distance.
    #[napi]
    pub fn search_layer(
        &mut self,
        start: u32,
        ef: u32,
        level: u32,
        window_size: u32,
        thresholds: Float64Array,
    ) -> Uint32Array {
        let mut out = vec![0u32; 2 + 2 * ef as usize];
        let n = self.walk(start, ef, level, window_size, &thresholds, &mut out);
        out.truncate(2 + 2 * n);
        Uint32Array::new(out)
    }

    /// `search_layer` into a caller buffer of at least `2 + 2 * ef` slots
    /// (reused across queries, so no per-query allocation). Returns n.
    #[napi]
    pub fn search_layer_into(
        &mut self,
        start: u32,
        ef: u32,
        level: u32,
        window_size: u32,
        thresholds: Float64Array,
        mut out: Uint32Array,
    ) -> napi::Result<u32> {
        if out.len() < 2 + 2 * ef as usize {
            return Err(napi::Error::from_reason("search_layer_into: output shorter than 2 + 2 * ef"));
        }
        Ok(self.walk(start, ef, level, window_size, &thresholds, out.as_mut()) as u32)
    }

    /// Bucket queues (fast; equal distances may come out in another order)
    /// or binary heaps with the JS tie rules (exact match of the JS walk).
    #[napi]
    pub fn set_bucket_queue(&mut self, on: bool) {
        self.bucket = on;
    }

    fn walk(&mut self, start: u32, ef: u32, level: u32, window_size: u32, thresholds: &[f64], out: &mut [u32]) -> usize {
        #[cfg(target_arch = "x86_64")]
        if self.v3 {
            // SAFETY: the CPU features were checked at construction.
            return unsafe { self.walk_v3(start, ef, level, window_size, thresholds, out) };
        }
        self.walk_impl(start, ef, level, window_size, thresholds, out)
    }

    /// `walk` compiled with x86-64-v3 (POPCNT for the Hamming distances).
    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx2,fma,popcnt,bmi1,bmi2,lzcnt")]
    unsafe fn walk_v3(&mut self, start: u32, ef: u32, level: u32, window_size: u32, thresholds: &[f64], out: &mut [u32]) -> usize {
        self.walk_impl(start, ef, level, window_size, thresholds, out)
    }

    #[inline(always)]
    fn walk_impl(&mut self, start: u32, ef: u32, level: u32, window_size: u32, thresholds: &[f64], out: &mut [u32]) -> usize {
        if self.bucket {
            let mut c = std::mem::take(&mut self.bcand);
            let mut r = std::mem::take(&mut self.bres);
            let n = self.walk_with(&mut c, &mut r, start, ef, level, window_size, thresholds, out);
            self.bcand = c;
            self.bres = r;
            n
        } else {
            let mut c = std::mem::take(&mut self.cand);
            let mut r = std::mem::take(&mut self.res);
            let n = self.walk_with(&mut c, &mut r, start, ef, level, window_size, thresholds, out);
            self.cand = c;
            self.res = r;
            n
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[inline(always)]
    fn walk_with<C: CandQueue, Q: ResQueue>(
        &mut self,
        cand: &mut C,
        res: &mut Q,
        start: u32,
        ef: u32,
        level: u32,
        window_size: u32,
        thresholds: &[f64],
        out: &mut [u32],
    ) -> usize {
        let ef_us = ef as usize;
        let thresholds: Vec<(f64, f64)> = thresholds.chunks_exact(2).map(|c| (c[0], c[1])).collect();

        self.visit_gen = self.visit_gen.wrapping_add(1);
        if self.visit_gen == 0 {
            self.visited.fill(0);
            self.visit_gen = 1;
        }
        let gen = self.visit_gen;
        let max_dist = self.words * 64;
        cand.reset(max_dist);
        res.reset(max_dist);

        self.visited[start as usize] = gen;
        let start_dist = self.dist_q(start);
        cand.insert(start, start_dist);
        res.insert(start, start_dist);

        let csr = self.levels.get(level as usize).unwrap_or(&self.empty_level);

        let mut visited_count: u32 = 0;
        let mut recent_discoveries: u32 = 0;
        let mut recent_visits: u32 = 0;

        while cand.len() > 0 {
            if res.len() >= ef_us && cand.peek_val() > res.peek_val() {
                break;
            }
            let current = cand.pop_key();
            // Likely next node (unless a closer neighbor turns up): start
            // loading its list now, one expansion ahead.
            if let Some(next) = cand.peek_key() {
                prefetch_list(csr.of(next));
            }
            visited_count += 1;
            let list = csr.of(current);
            prefetch_list(list);

            // Pass 1: visited-filter (same order as JS) and prefetch the
            // survivors' vectors. Pass 2: score and push in that same order.
            let mut found_new = false;
            let mut batch = std::mem::take(&mut self.batch);
            if batch.len() < list.len() {
                batch.resize(list.len(), 0);
            }
            // Branchless filter: the visited test is ~random, so a branch on
            // it mispredicts about half the time. Always write the slot and
            // advance `m` only for unvisited nodes (order is unchanged).
            let mut m = 0usize;
            let visited = self.visited.as_mut_ptr();
            let slab = self.slab.as_ptr();
            for &nb in list {
                // SAFETY: set_level rejects neighbor ids >= count, and
                // visited has count bytes.
                unsafe {
                    let v = visited.add(nb as usize);
                    let fresh = (*v != gen) as usize;
                    *v = gen;
                    *batch.get_unchecked_mut(m) = nb;
                    m += fresh;
                }
            }
            for &nb in &batch[..m] {
                prefetch(slab.wrapping_add(nb as usize * self.words));
            }
            let mut dists = std::mem::take(&mut self.dists);
            if dists.len() < m {
                dists.resize(m, 0);
            }
            self.dist_batch(&batch[..m], &mut dists[..m]);
            if res.len() >= ef_us {
                // The result heap is full, so its max only falls during this
                // batch. A neighbor at or above the max at batch start would
                // be rejected anyway: drop those first (branchless), then run
                // the exact per-neighbor test on the few left, in order.
                let thr = res.peek_val();
                let mut s = 0usize;
                for j in 0..m {
                    let d = dists[j];
                    batch[s] = batch[j];
                    dists[s] = d;
                    s += (d < thr) as usize;
                }
                for j in 0..s {
                    let d = dists[j];
                    if d < res.peek_val() {
                        cand.insert(batch[j], d);
                        res.replace_top(batch[j], d);
                        found_new = true;
                    }
                }
            } else {
                for j in 0..m {
                    let (nb, d) = (batch[j], dists[j]);
                    if res.len() < ef_us {
                        cand.insert(nb, d);
                        res.insert(nb, d);
                        found_new = true;
                    } else if d < res.peek_val() {
                        cand.insert(nb, d);
                        res.replace_top(nb, d);
                        found_new = true;
                    }
                }
            }
            self.dists = dists;
            self.batch = batch;
            // The next node to expand is (usually) the new heap minimum:
            // start loading its list while the bookkeeping below runs.
            if let Some(next) = cand.peek_key() {
                prefetch_list(csr.of(next));
            }

            recent_visits += 1;
            if found_new {
                recent_discoveries += 1;
            }
            if recent_visits > window_size {
                recent_visits >>= 1;
                recent_discoveries >>= 1;
            }
            if recent_visits >= window_size {
                let progress = visited_count as f64 / ef as f64;
                let rate = recent_discoveries as f64 / recent_visits as f64;
                if thresholds.iter().any(|&(p, r)| progress > p && rate < r) {
                    break;
                }
            }
        }

        let n = res.len();
        out[0] = visited_count;
        out[1] = n as u32;
        let (head, tail) = out[2..2 + 2 * n].split_at_mut(n);
        res.drain_into(head, tail);
        n
    }

    /// Exact top-`k` by Hamming distance over all vectors (small indexes:
    /// cheaper than the graph walk and never misses a neighbor). Same layout
    /// as `search_layer_into`: `[n, k, keys[0..k], dists[0..k]]`, ascending
    /// by distance, equal distances in node order. Counting sort over the
    /// `words * 64 + 1` possible distances, so O(count). Returns k.
    #[napi]
    pub fn scan_into(&mut self, k: u32, mut out: Uint32Array) -> napi::Result<u32> {
        let k = (k as usize).min(self.count as usize);
        if out.len() < 2 + 2 * k {
            return Err(napi::Error::from_reason("scan_into: output shorter than 2 + 2 * k"));
        }
        Ok(self.scan(k, out.as_mut()) as u32)
    }

    /// `scan_into` body; `k <= count` and `out.len() >= 2 + 2 * k`.
    fn scan(&mut self, k: usize, out: &mut [u32]) -> usize {
        #[cfg(target_arch = "aarch64")]
        if self.words == 8 {
            return self.scan512(k, out);
        }
        #[cfg(target_arch = "x86_64")]
        if self.words == 8 && self.v4 {
            // SAFETY: the CPU features were checked at construction.
            return unsafe { self.scan512_v4(k, out) };
        }
        #[cfg(target_arch = "x86_64")]
        if self.words == 8 && self.v3 {
            // SAFETY: the CPU features were checked at construction.
            return unsafe { self.scan512_v3(k, out) };
        }
        let n = self.count as usize;
        if self.all_ids.len() != n {
            self.all_ids = (0..n as u32).collect();
        }
        let mut d = std::mem::take(&mut self.dists);
        if d.len() < n {
            d.resize(n, 0);
        }
        let ids = std::mem::take(&mut self.all_ids);
        self.dist_batch(&ids, &mut d[..n]);
        self.all_ids = ids;
        // Histogram, then the cutoff distance t: all of d < t plus the first
        // (k - below) nodes at d == t, in node order.
        let mut hist = vec![0u32; self.words * 64 + 2];
        for &x in &d[..n] {
            hist[x as usize] += 1;
        }
        let mut pos = vec![0u32; hist.len()];
        let mut acc = 0u32;
        let mut t = hist.len() - 1;
        for (v, &h) in hist.iter().enumerate() {
            pos[v] = acc;
            if acc + h >= k as u32 {
                t = v;
                break;
            }
            acc += h;
        }
        out[0] = n as u32;
        out[1] = k as u32;
        if k > 0 {
            let (keys, rest) = out[2..2 + 2 * k].split_at_mut(k);
            for i in 0..n {
                let x = d[i] as usize;
                if x <= t {
                    let p = pos[x] as usize;
                    if p < k {
                        keys[p] = i as u32;
                        rest[p] = x as u32;
                        pos[x] += 1;
                    }
                }
            }
        }
        self.dists = d;
        k
    }

    /// `scan` for 512-bit codes: the same output (ascending distance, equal
    /// distances in node order), in two passes. Pass 1 reads the slab in
    /// order, four codes at a time, and fills the histogram as it goes (four
    /// sub-histograms, so repeated distances do not serialise on one
    /// counter). Pass 2 compares sixteen u16 distances at once against the
    /// cutoff and visits only the matches, so the ~85% of nodes past the
    /// cutoff cost no branch each.
    #[cfg(target_arch = "aarch64")]
    fn scan512(&mut self, k: usize, out: &mut [u32]) -> usize {
        use std::arch::aarch64::*;
        let n = self.count as usize;
        let padded = n.div_ceil(16) * 16;
        if self.scan_d.len() < padded {
            self.scan_d.resize(padded, 0);
        }
        let d = &mut self.scan_d[..padded];
        let mut hist = [[0u32; SCAN_BINS]; 4];
        unsafe {
            let q = self.query.as_ptr() as *const u8;
            let (q0, q1, q2, q3) = (vld1q_u8(q), vld1q_u8(q.add(16)), vld1q_u8(q.add(32)), vld1q_u8(q.add(48)));
            let base = self.slab.as_ptr() as *const u8;
            let pc = |p: *const u8| -> uint8x16_t {
                let c0 = vcntq_u8(veorq_u8(vld1q_u8(p), q0));
                let c1 = vcntq_u8(veorq_u8(vld1q_u8(p.add(16)), q1));
                let c2 = vcntq_u8(veorq_u8(vld1q_u8(p.add(32)), q2));
                let c3 = vcntq_u8(veorq_u8(vld1q_u8(p.add(48)), q3));
                vaddq_u8(vaddq_u8(c0, c1), vaddq_u8(c2, c3))
            };
            let dp = d.as_mut_ptr();
            let mut i = 0;
            while i + 4 <= n {
                let p = base.add(i * 64);
                let (a, b, c, e) = (pc(p), pc(p.add(64)), pc(p.add(128)), pc(p.add(192)));
                let s = vpaddlq_u16(vpaddlq_u8(vpaddq_u8(vpaddq_u8(a, b), vpaddq_u8(c, e))));
                let s16 = vmovn_u32(s);
                vst1_u16(dp.add(i), s16);
                let (x0, x1, x2, x3) = (
                    vgetq_lane_u32::<0>(s) as usize,
                    vgetq_lane_u32::<1>(s) as usize,
                    vgetq_lane_u32::<2>(s) as usize,
                    vgetq_lane_u32::<3>(s) as usize,
                );
                *hist[0].get_unchecked_mut(x0) += 1;
                *hist[1].get_unchecked_mut(x1) += 1;
                *hist[2].get_unchecked_mut(x2) += 1;
                *hist[3].get_unchecked_mut(x3) += 1;
                i += 4;
            }
            while i < n {
                let x = vaddlvq_u8(pc(base.add(i * 64))) as usize;
                *dp.add(i) = x as u16;
                *hist[0].get_unchecked_mut(x) += 1;
                i += 1;
            }
            // Padding past n never matches (above every real distance).
            for j in n..padded {
                *dp.add(j) = u16::MAX;
            }
        }
        let (pos, t) = scan_cutoff(&hist, k);
        let mut pos = pos;
        out[0] = n as u32;
        out[1] = k as u32;
        if k > 0 {
            let (keys, rest) = out[2..2 + 2 * k].split_at_mut(k);
            unsafe {
                let tv = vdupq_n_u16(t.min(u16::MAX as usize - 1) as u16);
                let dp = d.as_ptr();
                let mut b = 0;
                while b < padded {
                    let m0 = vcleq_u16(vld1q_u16(dp.add(b)), tv);
                    let m1 = vcleq_u16(vld1q_u16(dp.add(b + 8)), tv);
                    // 4 bits per element, element j at bits 4j..4j+3.
                    let nib = vshrn_n_u16::<4>(vreinterpretq_u16_u8(vcombine_u8(vmovn_u16(m0), vmovn_u16(m1))));
                    let mut mask = vget_lane_u64::<0>(vreinterpret_u64_u8(nib)) & 0x1111_1111_1111_1111;
                    while mask != 0 {
                        let j = b + (mask.trailing_zeros() as usize >> 2);
                        mask &= mask - 1;
                        let x = *dp.add(j) as usize;
                        let p = pos[x] as usize;
                        if p < k {
                            *keys.get_unchecked_mut(p) = j as u32;
                            *rest.get_unchecked_mut(p) = x as u32;
                            pos[x] += 1;
                        }
                    }
                    b += 16;
                }
            }
        }
        k
    }

    /// `scan512` for x86-64-v3: AVX2 distances (nibble-lookup popcount, four
    /// codes per step; faster than eight POPCNTs per code: 140k 320 -> 258 us
    /// on Zen 3) with four sub-histograms, then sixteen u16 distances per AVX2
    /// compare in the collect pass. Same output.
    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx2,fma,popcnt,bmi1,bmi2,lzcnt")]
    unsafe fn scan512_v3(&mut self, k: usize, out: &mut [u32]) -> usize {
        self.scan512_x86::<false>(k, out)
    }

    /// `scan512_v3` with AVX-512 VPOPCNTDQ distances (one zmm per code); the
    /// histogram and the AVX2 collect pass are the same. Same output.
    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx512f,avx512vpopcntdq,avx2,fma,popcnt,bmi1,bmi2,lzcnt")]
    unsafe fn scan512_v4(&mut self, k: usize, out: &mut [u32]) -> usize {
        self.scan512_x86::<true>(k, out)
    }

    #[cfg(target_arch = "x86_64")]
    #[inline(always)]
    unsafe fn scan512_x86<const V4: bool>(&mut self, k: usize, out: &mut [u32]) -> usize {
        use std::arch::x86_64::*;
        let n = self.count as usize;
        let padded = n.div_ceil(16) * 16;
        if self.scan_d.len() < padded {
            self.scan_d.resize(padded, 0);
        }
        let d = &mut self.scan_d[..padded];
        let mut hist = [[0u32; SCAN_BINS]; 4];
        let q: [u64; 8] = std::array::from_fn(|w| self.query[w]);
        let base = self.slab.as_ptr();
        let pc = |p: *const u64| -> usize {
            let mut x = 0u32;
            for (w, &qw) in q.iter().enumerate() {
                x += (*p.add(w) ^ qw).count_ones();
            }
            x as usize
        };
        let dp = d.as_mut_ptr();
        let mut i = 0;
        let lut = _mm256_setr_epi8(0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4, 0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4);
        let low = _mm256_set1_epi8(0x0f);
        let qv0 = _mm256_loadu_si256(self.query.as_ptr() as *const __m256i);
        let qv1 = _mm256_loadu_si256(self.query.as_ptr().add(4) as *const __m256i);
        // Four 64-byte codes at p: popcount of code ^ query per byte by nibble
        // lookup, bytes summed per 64-bit lane (vpsadbw), lanes folded to one
        // u64 distance per code.
        let simd4 = |p: *const u64| -> [u64; 4] {
            let mut sad = [_mm256_setzero_si256(); 4];
            for (c, s) in sad.iter_mut().enumerate() {
                let a = _mm256_xor_si256(_mm256_loadu_si256(p.add(c * 8) as *const __m256i), qv0);
                let b = _mm256_xor_si256(_mm256_loadu_si256(p.add(c * 8 + 4) as *const __m256i), qv1);
                let ca = _mm256_add_epi8(
                    _mm256_shuffle_epi8(lut, _mm256_and_si256(a, low)),
                    _mm256_shuffle_epi8(lut, _mm256_and_si256(_mm256_srli_epi16::<4>(a), low)),
                );
                let cb = _mm256_add_epi8(
                    _mm256_shuffle_epi8(lut, _mm256_and_si256(b, low)),
                    _mm256_shuffle_epi8(lut, _mm256_and_si256(_mm256_srli_epi16::<4>(b), low)),
                );
                *s = _mm256_sad_epu8(_mm256_add_epi8(ca, cb), _mm256_setzero_si256());
            }
            let t01 = _mm256_add_epi64(_mm256_unpacklo_epi64(sad[0], sad[1]), _mm256_unpackhi_epi64(sad[0], sad[1]));
            let t23 = _mm256_add_epi64(_mm256_unpacklo_epi64(sad[2], sad[3]), _mm256_unpackhi_epi64(sad[2], sad[3]));
            let u = _mm256_add_epi64(_mm256_permute2x128_si256::<0x20>(t01, t23), _mm256_permute2x128_si256::<0x31>(t01, t23));
            let mut o = [0u64; 4];
            _mm256_storeu_si256(o.as_mut_ptr() as *mut __m256i, u);
            o
        };
        while V4 && i + 8 <= n {
            let x = hamming512_x8_avx512(base.add(i * 8), self.query.as_ptr());
            for (j, &xj) in x.iter().enumerate() {
                *dp.add(i + j) = xj as u16;
                *hist[j & 3].get_unchecked_mut(xj as usize) += 1;
            }
            i += 8;
        }
        while i + 4 <= n {
            let x = if V4 { hamming512_x4_avx512(base.add(i * 8), self.query.as_ptr()) } else { simd4(base.add(i * 8)) };
            for (j, &xj) in x.iter().enumerate() {
                *dp.add(i + j) = xj as u16;
                *hist[j].get_unchecked_mut(xj as usize) += 1;
            }
            i += 4;
        }
        while i < n {
            let x = pc(base.add(i * 8));
            *dp.add(i) = x as u16;
            *hist[0].get_unchecked_mut(x) += 1;
            i += 1;
        }
        for j in n..padded {
            *dp.add(j) = u16::MAX;
        }
        let (mut pos, t) = scan_cutoff(&hist, k);
        out[0] = n as u32;
        out[1] = k as u32;
        if k > 0 {
            let (keys, rest) = out[2..2 + 2 * k].split_at_mut(k);
            let tv = _mm256_set1_epi16(t.min(u16::MAX as usize - 1) as i16);
            let dp = d.as_ptr();
            let mut b = 0;
            while b < padded {
                let v = _mm256_loadu_si256(dp.add(b) as *const __m256i);
                // Unsigned v <= t  <=>  max(v, t) == t; two mask bits per u16.
                let le = _mm256_cmpeq_epi16(_mm256_max_epu16(v, tv), tv);
                let mut mask = _mm256_movemask_epi8(le) as u32 & 0x5555_5555;
                while mask != 0 {
                    let j = b + (mask.trailing_zeros() as usize >> 1);
                    mask &= mask - 1;
                    let x = *dp.add(j) as usize;
                    let p = pos[x] as usize;
                    if p < k {
                        *keys.get_unchecked_mut(p) = j as u32;
                        *rest.get_unchecked_mut(p) = x as u32;
                        pos[x] += 1;
                    }
                }
                b += 16;
            }
        }
        k
    }

    /// Live (not stale) entries of a layer output into `live_idx`/`live_dist`.
    fn collect_live(&mut self, out: &[u32], stale: Option<&[u8]>, stale_bits: usize) {
        let n = out[1] as usize;
        self.live_idx.clear();
        self.live_dist.clear();
        for i in 0..n {
            let node = out[2 + i];
            if let Some(b) = stale {
                let x = node as usize;
                if x < stale_bits && b[x >> 3] & (1u8 << (x & 7)) != 0 {
                    continue;
                }
            }
            self.live_idx.push(node);
            self.live_dist.push(out[2 + n + i]);
        }
    }

    /// Stage 1 of the semantic cascade in one call: the exact scan (`scan`
    /// true, asking for `want` results) or the layer-0 walk from `start` with
    /// `ef` (retried once at 2 * ef when fewer than `k` live results remain,
    /// as `_finishNativeSearch` does), the stale filter, and the score
    /// spread of the first `k` live results (`analyzeScoreSpread` over
    /// `1 - dist / maxDist`, same arithmetic order). Results stay here for
    /// `cascade_int8`. `stats` gets `[visited, n, top1, top2, min, mean,
    /// variance]`. Returns n.
    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn cascade_stage1(
        &mut self,
        scan: bool,
        want: u32,
        start: u32,
        ef: u32,
        k: u32,
        window_size: u32,
        thresholds: Float64Array,
        stale: Option<Uint8Array>,
        stale_bits: u32,
        mut stats: Float64Array,
    ) -> napi::Result<u32> {
        if stats.len() < 7 || start >= self.count.max(1) {
            return Err(napi::Error::from_reason("cascade_stage1: bad arguments"));
        }
        let stale_ref: Option<&[u8]> = stale.as_ref().map(|b| &b[..]);
        let stale_bits = match stale_ref {
            Some(b) => (stale_bits as usize).min(b.len() * 8),
            None => 0,
        };
        let total = self.count as usize;
        let mut out = std::mem::take(&mut self.layer_out);
        let visited;
        if scan {
            let want = (want as usize).min(total);
            if out.len() < 2 + 2 * want {
                out.resize(2 + 2 * want, 0);
            }
            self.scan(want, &mut out);
            visited = out[0];
            self.collect_live(&out, stale_ref, stale_bits);
        } else {
            let need = 2 + 2 * ef as usize;
            if out.len() < need {
                out.resize(need, 0);
            }
            self.walk(start, ef, 0, window_size, &thresholds, &mut out);
            visited = out[0];
            self.collect_live(&out, stale_ref, stale_bits);
            if self.live_idx.len() < k as usize && (ef as usize) < total {
                let retry = (total as u32).min(ef * 2);
                if retry > ef {
                    let need = 2 + 2 * retry as usize;
                    if out.len() < need {
                        out.resize(need, 0);
                    }
                    self.walk(start, retry, 0, window_size, &thresholds, &mut out);
                    self.collect_live(&out, stale_ref, stale_bits);
                }
            }
        }
        self.layer_out = out;
        let n = self.live_idx.len().min(k as usize);
        self.live_idx.truncate(n);
        self.live_dist.truncate(n);
        let max_dist = (self.words * 64) as f64;
        let st = spread(self.live_dist.iter().map(|&d| 1.0 - (d as f64 / max_dist)), n);
        let stats = stats.as_mut();
        stats[0] = visited as f64;
        stats[1] = n as f64;
        stats[2..7].copy_from_slice(&st);
        Ok(n as u32)
    }

    /// Stage 2 of the cascade over the first `count` stage-1 results: int8
    /// dot scores (`int8ScoresForNodes`: missing when the node has no int8
    /// row or is stale, score 0), the stable descending sort of
    /// `scoredCandidates.sort((a, b) => b.int8Score - a.int8Score)`, and the
    /// spread of the non-missing scores in that order. Writes, in sorted
    /// order, node, Hamming distance, score and missing flag;
    /// `stats` gets `[nonMissing, top1, top2, min, mean, variance]`.
    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn cascade_int8(
        &mut self,
        slab: Int8Array,
        dim: u32,
        rows: u32,
        present: Uint8Array,
        query: Int8Array,
        count: u32,
        stale: Option<Uint8Array>,
        stale_bits: u32,
        mut nodes: Uint32Array,
        mut dists: Uint32Array,
        mut scores: Float64Array,
        mut missing: Uint8Array,
        mut stats: Float64Array,
    ) -> napi::Result<u32> {
        let dim = dim as usize;
        let rows = rows as usize;
        let count = (count as usize).min(self.live_idx.len());
        if dim == 0 || query.len() != dim || slab.len() < rows * dim || present.len() < rows
            || nodes.len() < count || dists.len() < count || scores.len() < count
            || missing.len() < count || stats.len() < 6
        {
            return Err(napi::Error::from_reason("cascade_int8: bad arguments"));
        }
        let stale_ref: Option<&[u8]> = stale.as_ref().map(|b| &b[..]);
        let stale_bits = match stale_ref {
            Some(b) => (stale_bits as usize).min(b.len() * 8),
            None => 0,
        };
        let q: &[i8] = &query;
        let slab: &[i8] = &slab;
        let scale = 1.0f64 / (127.0 * 127.0);
        let mut pool = std::mem::take(&mut self.pool_idx);
        pool.clear();
        pool.extend_from_slice(&self.live_idx[..count]);
        let mut sc = std::mem::take(&mut self.int8_score);
        let mut miss = std::mem::take(&mut self.int8_missing);
        sc.clear();
        miss.clear();
        for &node in &pool {
            let node = node as usize;
            let is_stale = stale_ref.is_some_and(|b| node < stale_bits && b[node >> 3] & (1u8 << (node & 7)) != 0);
            if node >= rows || present[node] == 0 || is_stale {
                miss.push(true);
                sc.push(0.0);
            } else {
                let p = slab.as_ptr().wrapping_add(node * dim);
                let mut off = 0;
                while off < dim {
                    prefetch(p.wrapping_add(off) as *const u64);
                    off += 64;
                }
                miss.push(false);
                sc.push(0.0);
            }
        }
        // Sort keys: score = dot * scale with scale > 0, so descending score
        // is descending integer dot (a missing row scores 0.0, as dot 0).
        // Key = (i32::MAX - dot) << 32 | position: an unstable sort of these
        // keys gives the stable descending order by score.
        let mut keys = std::mem::take(&mut self.int8_keys);
        keys.clear();
        for i in 0..count {
            let mut dot = 0i32;
            if !miss[i] {
                let node = pool[i] as usize;
                let v = &slab[node * dim..(node + 1) * dim];
                dot = crate::rescore::int8_dot(q, v);
                sc[i] = dot as f64 * scale;
            }
            keys.push(((i32::MAX as i64 - dot as i64) as u64) << 32 | i as u64);
        }
        keys.sort_unstable();
        let mut rank = std::mem::take(&mut self.int8_rank);
        rank.clear();
        rank.extend(keys.iter().map(|&key| key as u32));
        self.int8_keys = keys;
        let (nodes, dists, scores, missing) = (nodes.as_mut(), dists.as_mut(), scores.as_mut(), missing.as_mut());
        let mut non_missing = 0usize;
        self.int8_nodes.clear();
        for (j, &r) in rank.iter().enumerate() {
            let r = r as usize;
            self.int8_nodes.push(pool[r]);
            nodes[j] = pool[r];
            dists[j] = self.live_dist[r];
            scores[j] = sc[r];
            missing[j] = miss[r] as u8;
            non_missing += !miss[r] as usize;
        }
        let st = spread(rank.iter().filter(|&&r| !miss[r as usize]).map(|&r| sc[r as usize]), non_missing);
        let stats = stats.as_mut();
        stats[0] = non_missing as f64;
        stats[1..6].copy_from_slice(&st);
        self.int8_rank = rank;
        self.int8_score = sc;
        self.int8_missing = miss;
        self.pool_idx = pool;
        Ok(count as u32)
    }

    /// Final (full-vector) order of the first `h` candidates of the last
    /// `cascade_int8` call, as `applyFullVectorStageRescore` computes it:
    /// each candidate's full 768-d dot with `query` (f64, the f32 query values)
    /// from `file` through the node -> row map `row_map` (no row, or a row at
    /// or past the file's end, = missing); min-max normalised over the found
    /// scores (0.5 each when all are equal); then a stable sort by normalised
    /// score, descending (missing ones count as 0). Writes, per head
    /// position, `full` (NaN when missing) and `norm`, and the positions in
    /// final order to `order`. Returns how many candidates had a full vector;
    /// below 2, or with fewer than 3 candidates, nothing is written and the
    /// int8 order stands.
    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn cascade_full(
        &mut self,
        file: &crate::full_vectors::FullVectorFile,
        row_map: Uint32Array,
        query: Float64Array,
        h: u32,
        mut order: Uint32Array,
        mut full: Float64Array,
        mut norm: Float64Array,
    ) -> napi::Result<u32> {
        let h = (h as usize).min(self.int8_nodes.len());
        if h < 3 || query.len() != file.width() {
            return Ok(0);
        }
        if order.len() < h || full.len() < h || norm.len() < h {
            return Err(napi::Error::from_reason("cascade_full: output too short"));
        }
        let file_rows = file.row_count();
        let mut rows = std::mem::take(&mut self.full_rows);
        rows.clear();
        let (full, norm, order) = (full.as_mut(), norm.as_mut(), order.as_mut());
        for (j, &node) in self.int8_nodes[..h].iter().enumerate() {
            let row = row_map.get(node as usize).copied().unwrap_or(u32::MAX);
            if row == u32::MAX || row as usize >= file_rows {
                full[j] = f64::NAN;
            } else {
                full[j] = 0.0;
                rows.push(row);
            }
        }
        let found = rows.len();
        if found < 2 {
            self.full_rows = rows;
            return Ok(0);
        }
        let mut scores = std::mem::take(&mut self.full_scores);
        scores.clear();
        scores.resize(found, 0.0);
        file.dots(&query, &rows, &mut scores);
        let (mut min, mut max) = (f64::INFINITY, f64::NEG_INFINITY);
        let mut m = 0;
        for f in full[..h].iter_mut() {
            if !f.is_nan() {
                *f = scores[m];
                m += 1;
                min = min.min(*f);
                max = max.max(*f);
            }
        }
        for j in 0..h {
            let f = full[j];
            norm[j] = if f.is_nan() {
                0.0
            } else if !(max > min) {
                0.5
            } else {
                ((f - min) / (max - min)).min(1.0).max(0.0)
            };
            order[j] = j as u32;
        }
        // Stable descending by normalised score (ties keep int8 order).
        order[..h].sort_by(|&a, &b| norm[b as usize].partial_cmp(&norm[a as usize]).unwrap().then(a.cmp(&b)));
        self.full_rows = rows;
        self.full_scores = scores;
        Ok(found as u32)
    }

    /// Level `level` as `[offsets[0..=count], neighbors...]`,
    /// lists in their original order. Lets JS rebuild its graph arrays
    /// after releasing them.
    #[napi]
    pub fn export_level(&self, level: u32) -> Uint32Array {
        let n = self.count as usize;
        let Some(csr) = self.levels.get(level as usize) else {
            return Uint32Array::new(vec![0u32; n + 1]);
        };
        let mut out = Vec::with_capacity(n + 1 + csr.neighbors.len());
        for v in 0..=n {
            out.push(csr.offsets.get(v).copied().unwrap_or(*csr.offsets.last().unwrap()));
        }
        out.extend_from_slice(&csr.neighbors);
        Uint32Array::new(out)
    }
}
