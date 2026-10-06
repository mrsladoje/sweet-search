//! Native query path for the binary (Hamming) HNSW index.
//!
//! An exact port of `greedySearchQuery` / `searchLayerQuery` in
//! `core/vector-store/binary-hnsw-index.js`: same visit order, same heap
//! sift rules (so equal-distance ties resolve identically), same early
//! termination. This struct holds a read-only CSR snapshot of the graph plus
//! the packed vector slab; once it exists the JS index releases its own graph
//! arrays and rebuilds them from `export_level` only when a writer needs them.

use napi::bindgen_prelude::{Float64Array, Uint32Array, Uint8Array};
use napi_derive::napi;

struct Csr {
    offsets: Vec<u32>, // len = nodes + 1
    neighbors: Vec<u32>,
}

impl Csr {
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

#[napi]
pub struct HnswSearcher {
    words: usize, // u64 words per vector
    slab: Vec<u64>,
    count: u32,
    levels: Vec<Csr>,
    query: Vec<u64>,
    batch: Vec<u32>,
    dists: Vec<u32>,
    all_ids: Vec<u32>,
    // Generation-stamped visited bytes: one byte per node, so neighboring
    // checks never share a word (no store-to-load chains), and no per-query
    // clear except on wrap.
    visited: Vec<u8>,
    visit_gen: u8,
    cand: MinHeap,
    res: MaxHeap,
    bcand: BucketMin,
    bres: BucketMax,
    // Bucket queues (default) or the JS-exact binary heaps.
    bucket: bool,
}

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
        let mut packed = vec![0u64; words * count as usize];
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
            query: vec![0u64; words],
            batch: Vec::new(),
            dists: Vec::new(),
            all_ids: Vec::new(),
            visited: vec![0u8; count as usize],
            visit_gen: 0,
            cand: MinHeap::default(),
            res: MaxHeap::default(),
            bcand: BucketMin::default(),
            bres: BucketMax::default(),
            bucket: true,
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
            self.levels.push(Csr { offsets: vec![0], neighbors: Vec::new() });
        }
        let csr = Csr { offsets: offsets.to_vec(), neighbors: neighbors.to_vec() };
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
        for (o, &id) in out.iter_mut().zip(ids) {
            *o = self.dist_q(id);
        }
    }

    /// Hamming distance from the staged query to vector `idx`.
    #[napi]
    pub fn dist(&self, idx: u32) -> u32 {
        self.dist_q(idx)
    }

    /// Port of `greedySearchQuery`.
    #[napi]
    pub fn greedy(&self, start: u32, level: u32) -> u32 {
        let Some(csr) = self.levels.get(level as usize) else { return start };
        let mut current = start;
        let mut current_dist = self.dist_q(current);
        let mut improved = true;
        while improved {
            improved = false;
            for &nb in csr.of(current) {
                let d = self.dist_q(nb);
                if d < current_dist {
                    current = nb;
                    current_dist = d;
                    improved = true;
                }
            }
        }
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

        let empty = Csr { offsets: vec![0], neighbors: Vec::new() };
        let csr = self.levels.get(level as usize).unwrap_or(&empty);

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
        let n = self.count as usize;
        let k = (k as usize).min(n);
        if out.len() < 2 + 2 * k {
            return Err(napi::Error::from_reason("scan_into: output shorter than 2 + 2 * k"));
        }
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
        let out = out.as_mut();
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
        Ok(k as u32)
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
