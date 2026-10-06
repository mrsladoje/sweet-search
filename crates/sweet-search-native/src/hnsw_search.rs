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

/// Min-heap with the exact sift rules of `TypedMinHeap`.
#[derive(Default)]
struct MinHeap {
    a: Vec<u64>,
}

impl MinHeap {
    fn clear(&mut self) {
        self.a.clear();
    }
    #[inline(always)]
    fn len(&self) -> usize {
        self.a.len()
    }
    #[inline(always)]
    fn peek_val(&self) -> u32 {
        val_of(self.a[0])
    }
    #[inline(always)]
    fn peek_key(&self) -> Option<u32> {
        self.a.first().map(|&e| key_of(e))
    }
    #[inline(always)]
    fn insert(&mut self, key: u32, val: u32) {
        let x = pack(key, val);
        self.a.push(x);
        let a = self.a.as_mut_slice();
        let mut i = a.len() - 1;
        while i > 0 {
            let parent = (i - 1) >> 1;
            // JS: if (vals[i] >= vals[parent]) break;
            if val >= val_of(a[parent]) {
                break;
            }
            a[i] = a[parent];
            i = parent;
        }
        a[i] = x;
    }
    #[inline(always)]
    fn extract_min(&mut self) -> u32 {
        let key = key_of(self.a[0]);
        let last = self.a.pop().unwrap();
        let n = self.a.len();
        if n > 0 {
            let a = self.a.as_mut_slice();
            let xv = val_of(last);
            let mut i = 0;
            // JS rule: smallest = i; take left if left < x; take right if
            // right < (that). Equivalent: the child is right iff right < left
            // (ties go left), and we move iff child < x. Child pick is a
            // select, not a branch.
            loop {
                let left = 2 * i + 1;
                if left >= n {
                    break;
                }
                let right = left + 1;
                let lv = val_of(a[left]);
                let rv = if right < n { val_of(a[right]) } else { u32::MAX };
                let take_right = rv < lv;
                let c = if take_right { right } else { left };
                let cv = if take_right { rv } else { lv };
                if cv >= xv {
                    break;
                }
                a[i] = a[c];
                i = c;
            }
            a[i] = last;
        }
        key
    }
}

/// Max-heap with the exact sift rules of `TypedMaxHeap`.
#[derive(Default)]
struct MaxHeap {
    a: Vec<u64>,
}

impl MaxHeap {
    fn clear(&mut self) {
        self.a.clear();
    }
    #[inline(always)]
    fn len(&self) -> usize {
        self.a.len()
    }
    #[inline(always)]
    fn peek_val(&self) -> u32 {
        val_of(self.a[0])
    }
    #[inline(always)]
    fn insert(&mut self, key: u32, val: u32) {
        let x = pack(key, val);
        self.a.push(x);
        let a = self.a.as_mut_slice();
        let mut i = a.len() - 1;
        while i > 0 {
            let parent = (i - 1) >> 1;
            // JS: if (vals[i] <= vals[parent]) break;
            if val <= val_of(a[parent]) {
                break;
            }
            a[i] = a[parent];
            i = parent;
        }
        a[i] = x;
    }
    /// Sift `x` down from the root of `a` (len n), hole-based.
    #[inline(always)]
    fn sift_down_from_root(a: &mut [u64], x: u64) {
        let n = a.len();
        let xv = val_of(x);
        let mut i = 0;
        // JS rule: largest = i; take left if left > x; take right if
        // right > (that). Equivalent: the child is right iff right > left
        // (ties go left), and we move iff child > x.
        loop {
            let left = 2 * i + 1;
            if left >= n {
                break;
            }
            let right = left + 1;
            let lv = val_of(a[left]);
            let rv = if right < n { val_of(a[right]) } else { 0 };
            let take_right = rv > lv;
            let c = if take_right { right } else { left };
            let cv = if take_right { rv } else { lv };
            if cv <= xv {
                break;
            }
            a[i] = a[c];
            i = c;
        }
        a[i] = x;
    }
    #[inline(always)]
    fn replace_max(&mut self, key: u32, val: u32) {
        Self::sift_down_from_root(&mut self.a, pack(key, val));
    }
    /// Ascending drain, same extraction order as `drainSorted`.
    fn drain_sorted(&mut self, out_keys: &mut [u32], out_vals: &mut [u32]) {
        let n = self.a.len();
        for i in (0..n).rev() {
            let top = self.a[0];
            out_keys[i] = key_of(top);
            out_vals[i] = val_of(top);
            let last = self.a.pop().unwrap();
            if !self.a.is_empty() {
                Self::sift_down_from_root(&mut self.a, last);
            }
        }
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
    // Generation-stamped visited bytes: one byte per node, so neighboring
    // checks never share a word (no store-to-load chains), and no per-query
    // clear except on wrap.
    visited: Vec<u8>,
    visit_gen: u8,
    cand: MinHeap,
    res: MaxHeap,
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
            visited: vec![0u8; count as usize],
            visit_gen: 0,
            cand: MinHeap::default(),
            res: MaxHeap::default(),
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
        let ef_us = ef as usize;
        let thresholds: Vec<(f64, f64)> = thresholds.chunks_exact(2).map(|c| (c[0], c[1])).collect();

        self.visit_gen = self.visit_gen.wrapping_add(1);
        if self.visit_gen == 0 {
            self.visited.fill(0);
            self.visit_gen = 1;
        }
        let gen = self.visit_gen;
        let mut cand = std::mem::take(&mut self.cand);
        let mut res = std::mem::take(&mut self.res);
        cand.clear();
        res.clear();

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
            let current = cand.extract_min();
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
            for &nb in &batch[..m] {
                let d = self.dist_q(nb);
                if res.len() < ef_us {
                    cand.insert(nb, d);
                    res.insert(nb, d);
                    found_new = true;
                } else if d < res.peek_val() {
                    cand.insert(nb, d);
                    res.replace_max(nb, d);
                    found_new = true;
                }
            }
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
        let mut out = vec![0u32; 2 + 2 * n];
        out[0] = visited_count;
        out[1] = n as u32;
        let (head, tail) = out[2..].split_at_mut(n);
        res.drain_sorted(head, tail);
        self.cand = cand;
        self.res = res;
        Uint32Array::new(out)
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
