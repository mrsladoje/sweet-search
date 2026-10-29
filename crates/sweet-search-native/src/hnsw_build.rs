//! Binary-HNSW construction on many threads with exactly the graph of the sequential build.
//!
//! Mirrors: core/vector-store/binary-hnsw-index.js:addToGraph (with greedySearch, searchLayer,
//! selectNeighborsHeuristic, pruneNeighbors, _entryPointWinner) and core/vector-store/binary-heap.js
//! (TypedMinHeap, TypedMaxHeap: the sift rules decide the order of equal distances, so they are
//! copied rule for rule). Any change to those JS functions must be made here in the same commit.
//!
//! Nodes are inserted in node order 0..n. The insertion of node j is a search (read-only) and a
//! commit (j's lists, the backlinks, the prunes, the entry point). Worker threads run the searches
//! of the next nodes ahead of time against the graph as it is then (speculation). One thread
//! commits strictly in node order. Before it commits j it checks that j's search would read the
//! same thing in the current graph:
//!   - every list the search read (each expanded node, each greedy step) still has the version
//!     the search saw, or it only grew at the end (no prune since) and every new entry would have
//!     been rejected at that point of the search: a greedy step moves only to a strictly closer
//!     node, and a full result heap takes only a node closer than its worst;
//!   - the entry point and the top level are unchanged.
//! The search is a deterministic function of the lists it reads, so a search that passes is the
//! search the sequential build runs. One that fails runs again on the committing thread. The graph
//! therefore does not depend on the thread count or on timing.

use napi::bindgen_prelude::{AsyncTask, Uint32Array, Uint8Array};
use napi::{Env, Error, Result, Task};
use napi_derive::napi;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex};

const NONE: u32 = u32::MAX;

// ---------------------------------------------------------------------------------------------
// Codes and distance
// ---------------------------------------------------------------------------------------------

struct Codes {
    words: Vec<u64>,
    /// u64 words per node, rounded up to an even count (16-byte NEON chunks; the pad is zero).
    wpn: usize,
    #[cfg(target_arch = "x86_64")]
    popcnt: bool,
}

impl Codes {
    fn new(bytes: &[u8], dim: usize, n: usize) -> Self {
        let wpn = dim.div_ceil(16) * 2;
        let mut words = vec![0u64; wpn * n];
        for i in 0..n {
            for (b, &byte) in bytes[i * dim..(i + 1) * dim].iter().enumerate() {
                words[i * wpn + b / 8] |= (byte as u64) << ((b % 8) * 8);
            }
        }
        Codes {
            words,
            wpn,
            #[cfg(target_arch = "x86_64")]
            popcnt: is_x86_feature_detected!("popcnt"),
        }
    }

    /// out[i] = dist(ids[i], q). One loop with no branches, so the loads of the rows overlap.
    fn dist_batch(&self, ids: &[u32], q: u32, out: &mut Vec<u32>) {
        out.clear();
        out.extend(ids.iter().map(|&v| self.dist(v, q)));
    }

    #[inline]
    fn dist(&self, a: u32, b: u32) -> u32 {
        let (a, b) = (a as usize * self.wpn, b as usize * self.wpn);
        let (x, y) = (&self.words[a..a + self.wpn], &self.words[b..b + self.wpn]);
        #[cfg(target_arch = "aarch64")]
        {
            hamming_neon(x, y)
        }
        #[cfg(target_arch = "x86_64")]
        {
            if self.popcnt {
                // SAFETY: the CPU has POPCNT (checked at construction).
                unsafe { hamming_popcnt(x, y) }
            } else {
                hamming_scalar(x, y)
            }
        }
        #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
        {
            hamming_scalar(x, y)
        }
    }
}

#[allow(dead_code)]
#[inline]
fn hamming_scalar(x: &[u64], y: &[u64]) -> u32 {
    x.iter().zip(y).map(|(a, b)| (a ^ b).count_ones()).sum()
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "popcnt")]
unsafe fn hamming_popcnt(x: &[u64], y: &[u64]) -> u32 {
    x.iter().zip(y).map(|(a, b)| (a ^ b).count_ones()).sum()
}

#[cfg(target_arch = "aarch64")]
#[inline]
fn hamming_neon(x: &[u64], y: &[u64]) -> u32 {
    use std::arch::aarch64::*;
    debug_assert!(x.len() % 2 == 0 && x.len() == y.len());
    // SAFETY: NEON is part of the aarch64 baseline; each load reads 16 bytes inside the slices
    // (their length is an even number of u64 words).
    unsafe {
        let (px, py) = (x.as_ptr() as *const u8, y.as_ptr() as *const u8);
        let bytes = x.len() * 8;
        let mut total = 0u32;
        let mut c = 0;
        while c < bytes {
            // A u16 lane gains at most 16 per 16-byte block: fold it into the total every 4095
            // blocks, before it can wrap (codes of 64 KiB and more).
            let end = bytes.min(c + 4095 * 16);
            let mut acc = vdupq_n_u16(0);
            while c < end {
                acc = vpadalq_u8(
                    acc,
                    vcntq_u8(veorq_u8(vld1q_u8(px.add(c)), vld1q_u8(py.add(c)))),
                );
                c += 16;
            }
            total += vaddlvq_u16(acc);
        }
        total
    }
}

// ---------------------------------------------------------------------------------------------
// Heaps — Mirrors: core/vector-store/binary-heap.js (TypedMinHeap, TypedMaxHeap)
// ---------------------------------------------------------------------------------------------

#[derive(Default)]
struct MinHeap {
    keys: Vec<u32>,
    vals: Vec<u32>,
}

impl MinHeap {
    fn clear(&mut self) {
        self.keys.clear();
        self.vals.clear();
    }
    fn len(&self) -> usize {
        self.keys.len()
    }
    fn peek_val(&self) -> u32 {
        self.vals[0]
    }
    fn insert(&mut self, key: u32, val: u32) {
        self.keys.push(key);
        self.vals.push(val);
        let (keys, vals) = (&mut self.keys, &mut self.vals);
        let mut i = keys.len() - 1;
        while i > 0 {
            let parent = (i - 1) >> 1;
            if vals[i] >= vals[parent] {
                break;
            }
            keys.swap(i, parent);
            vals.swap(i, parent);
            i = parent;
        }
    }
    fn extract_min(&mut self) -> u32 {
        let key = self.keys[0];
        let last_k = self.keys.pop().unwrap();
        let last_v = self.vals.pop().unwrap();
        if !self.keys.is_empty() {
            self.keys[0] = last_k;
            self.vals[0] = last_v;
            self.sift_down(0);
        }
        key
    }
    fn sift_down(&mut self, mut i: usize) {
        let (keys, vals) = (&mut self.keys, &mut self.vals);
        let n = keys.len();
        loop {
            let mut smallest = i;
            let (left, right) = (2 * i + 1, 2 * i + 2);
            if left < n && vals[left] < vals[smallest] {
                smallest = left;
            }
            if right < n && vals[right] < vals[smallest] {
                smallest = right;
            }
            if smallest == i {
                break;
            }
            keys.swap(i, smallest);
            vals.swap(i, smallest);
            i = smallest;
        }
    }
}

#[derive(Default)]
struct MaxHeap {
    keys: Vec<u32>,
    vals: Vec<u32>,
}

impl MaxHeap {
    fn clear(&mut self) {
        self.keys.clear();
        self.vals.clear();
    }
    fn len(&self) -> usize {
        self.keys.len()
    }
    fn peek_val(&self) -> u32 {
        self.vals[0]
    }
    fn insert(&mut self, key: u32, val: u32) {
        self.keys.push(key);
        self.vals.push(val);
        let (keys, vals) = (&mut self.keys, &mut self.vals);
        let mut i = keys.len() - 1;
        while i > 0 {
            let parent = (i - 1) >> 1;
            if vals[i] <= vals[parent] {
                break;
            }
            keys.swap(i, parent);
            vals.swap(i, parent);
            i = parent;
        }
    }
    fn replace_max(&mut self, key: u32, val: u32) {
        self.keys[0] = key;
        self.vals[0] = val;
        self.sift_down(0);
    }
    fn sift_down(&mut self, mut i: usize) {
        let (keys, vals) = (&mut self.keys, &mut self.vals);
        let n = keys.len();
        loop {
            let mut largest = i;
            let (left, right) = (2 * i + 1, 2 * i + 2);
            if left < n && vals[left] > vals[largest] {
                largest = left;
            }
            if right < n && vals[right] > vals[largest] {
                largest = right;
            }
            if largest == i {
                break;
            }
            keys.swap(i, largest);
            vals.swap(i, largest);
            i = largest;
        }
    }
    /// drainSorted: repeated max extraction, filled from the end (ascending distance).
    fn drain_sorted(&mut self, out: &mut Vec<(u32, u32)>) {
        let n = self.len();
        out.clear();
        out.resize(n, (0, 0));
        for i in (0..n).rev() {
            out[i] = (self.keys[0], self.vals[0]);
            let last_k = self.keys.pop().unwrap();
            let last_v = self.vals.pop().unwrap();
            if !self.keys.is_empty() {
                self.keys[0] = last_k;
                self.vals[0] = last_v;
                self.sift_down(0);
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Graph store
// ---------------------------------------------------------------------------------------------

/// One level: node → slot, and per slot a list in a fixed-size row (a list never holds more than
/// 2 × max links + 1 entries: the prune runs above 2 × max links), with a version word (prune
/// epoch << 32 | length). Only the committing thread writes. Readers take no lock (a lock word
/// on a hub node's list moved between cores on every read): an append writes the entry before
/// the longer length, and a prune rewrites the row inside an odd `seq` (a seqlock), so a reader
/// that saw `seq` change reads again.
struct Level {
    slot_of: Vec<AtomicU32>,
    cap: usize,
    data: Vec<AtomicU32>,
    ver: Vec<AtomicU64>,
    seq: Vec<AtomicU32>,
    next_slot: AtomicU32,
}

fn zeroed_atomics<T>(len: usize) -> Vec<T> {
    assert!(std::mem::size_of::<T>() == 4 || std::mem::size_of::<T>() == 8);
    // SAFETY: AtomicU32 / AtomicU64 have the size, alignment and bit validity of u32 / u64, and
    // zero is a valid value; the Vec is rebuilt with the same length, capacity and alignment.
    unsafe {
        if std::mem::size_of::<T>() == 4 {
            let mut v = std::mem::ManuallyDrop::new(vec![0u32; len]);
            Vec::from_raw_parts(v.as_mut_ptr() as *mut T, v.len(), v.capacity())
        } else {
            let mut v = std::mem::ManuallyDrop::new(vec![0u64; len]);
            Vec::from_raw_parts(v.as_mut_ptr() as *mut T, v.len(), v.capacity())
        }
    }
}

impl Level {
    fn new(n: usize, slots: usize, cap: usize) -> Self {
        Level {
            slot_of: (0..n).map(|_| AtomicU32::new(NONE)).collect(),
            cap,
            data: zeroed_atomics(slots * cap),
            ver: zeroed_atomics(slots),
            seq: zeroed_atomics(slots),
            next_slot: AtomicU32::new(0),
        }
    }

    fn slots(&self) -> usize {
        self.ver.len()
    }

    /// Any thread: copy the list of `slot` into `buf`; returns the version the copy has.
    fn read(&self, slot: u32, buf: &mut Vec<u32>) -> u64 {
        let s = slot as usize;
        let base = s * self.cap;
        loop {
            let s1 = self.seq[s].load(Ordering::Acquire);
            if s1 & 1 == 1 {
                std::hint::spin_loop();
                continue;
            }
            let ver = self.ver[s].load(Ordering::Acquire);
            let len = (ver & 0xffff_ffff) as usize;
            buf.clear();
            buf.extend(
                self.data[base..base + len]
                    .iter()
                    .map(|x| x.load(Ordering::Relaxed)),
            );
            std::sync::atomic::fence(Ordering::Acquire);
            if self.seq[s].load(Ordering::Relaxed) == s1 {
                return ver;
            }
        }
    }

    // The committing thread only, below.

    fn entries(&self, slot: u32, from: usize) -> impl Iterator<Item = u32> + '_ {
        let s = slot as usize;
        let len = (self.ver[s].load(Ordering::Relaxed) & 0xffff_ffff) as usize;
        self.data[s * self.cap + from..s * self.cap + len]
            .iter()
            .map(|x| x.load(Ordering::Relaxed))
    }

    fn append(&self, slot: u32, v: u32) -> usize {
        let s = slot as usize;
        let ver = self.ver[s].load(Ordering::Relaxed);
        let len = (ver & 0xffff_ffff) as usize;
        self.data[s * self.cap + len].store(v, Ordering::Relaxed);
        self.ver[s].store(ver + 1, Ordering::Release);
        len + 1
    }

    fn rewrite(&self, slot: u32, items: &[u32], new_epoch: bool) {
        let s = slot as usize;
        let s1 = self.seq[s].load(Ordering::Relaxed);
        self.seq[s].store(s1.wrapping_add(1), Ordering::Relaxed);
        std::sync::atomic::fence(Ordering::Release);
        for (i, &v) in items.iter().enumerate() {
            self.data[s * self.cap + i].store(v, Ordering::Relaxed);
        }
        let epoch = (self.ver[s].load(Ordering::Relaxed) >> 32) + new_epoch as u64;
        self.ver[s].store((epoch << 32) | items.len() as u64, Ordering::Release);
        self.seq[s].store(s1.wrapping_add(2), Ordering::Release);
    }
}

const GREEDY: u8 = 0;
const FULL: u8 = 1;
const NOT_FULL: u8 = 2;

/// One list read by a search: where, the version seen, and what a new tail entry must not beat.
#[derive(Clone, Copy)]
struct Obs {
    level: u8,
    kind: u8,
    slot: u32,
    ver: u64,
    thr: u32,
}

struct Spec {
    entry: u64,
    obs: Vec<Obs>,
    /// selected[l]: the node's list at level l (ascending l).
    selected: Vec<Vec<u32>>,
}

struct Scratch {
    /// Visited set of the current search, one bit per node; `touched` lists its non-zero words.
    visited: Vec<u64>,
    touched: Vec<u32>,
    cand: MinHeap,
    res: MaxHeap,
    buf: Vec<u32>,
    batch: Vec<u32>,
    dists: Vec<u32>,
    sorted: Vec<(u32, u32)>,
}

impl Scratch {
    fn new(n: usize) -> Self {
        Scratch {
            visited: vec![0; n.div_ceil(64)],
            touched: Vec::new(),
            cand: MinHeap::default(),
            res: MaxHeap::default(),
            buf: Vec::new(),
            batch: Vec::new(),
            dists: Vec::new(),
            sorted: Vec::new(),
        }
    }
    fn reset_visited(&mut self) {
        for &w in &self.touched {
            self.visited[w as usize] = 0;
        }
        self.touched.clear();
    }
    /// Marks v; true when it was not marked yet.
    #[inline]
    fn visit(&mut self, v: u32) -> bool {
        let (w, bit) = ((v >> 6) as usize, 1u64 << (v & 63));
        let word = self.visited[w];
        if word & bit != 0 {
            return false;
        }
        if word == 0 {
            self.touched.push(w as u32);
        }
        self.visited[w] = word | bit;
        true
    }
}

fn pack_entry(ep: u32, max_level: u32) -> u64 {
    ((ep as u64) << 32) | max_level as u64
}

struct Builder {
    codes: Codes,
    node_level: Vec<u8>,
    rank: Vec<u32>,
    m: usize,
    ef: usize,
    levels: Vec<Level>,
    /// (entry point << 32) | max level; entry point NONE before the first node. The pair never
    /// repeats (the max level only rises; the entry point only moves to a newer node), so an equal
    /// word means nothing changed.
    entry: AtomicU64,
    background: bool,
}

impl Builder {
    fn max_m(&self, level: usize) -> usize {
        if level == 0 {
            self.m * 2
        } else {
            self.m
        }
    }

    /// Copy the list of `u` at `level` into `buf`; returns its (slot, version), or None when the
    /// node has no list there (only the entry point above its own level, see commit).
    fn read_list(&self, level: usize, u: u32, buf: &mut Vec<u32>) -> Option<(u32, u64)> {
        buf.clear();
        let lv = &self.levels[level];
        let slot = lv.slot_of[u as usize].load(Ordering::Acquire);
        if slot == NONE {
            return None;
        }
        Some((slot, lv.read(slot, buf)))
    }

    // Mirrors: binary-hnsw-index.js:greedySearch
    fn greedy(
        &self,
        start: u32,
        j: u32,
        level: usize,
        sc: &mut Scratch,
        obs: &mut Vec<Obs>,
    ) -> u32 {
        let mut cur = start;
        let mut cur_dist = self.codes.dist(cur, j);
        let mut buf = std::mem::take(&mut sc.buf);
        loop {
            let mut improved = false;
            let seen = self.read_list(level, cur, &mut buf);
            let mut dists = std::mem::take(&mut sc.dists);
            self.codes.dist_batch(&buf, j, &mut dists);
            for (&v, &d) in buf.iter().zip(dists.iter()) {
                if d < cur_dist {
                    cur = v;
                    cur_dist = d;
                    improved = true;
                }
            }
            sc.dists = dists;
            if let Some((slot, ver)) = seen {
                obs.push(Obs {
                    level: level as u8,
                    kind: GREEDY,
                    slot,
                    ver,
                    thr: cur_dist,
                });
            }
            if !improved {
                break;
            }
        }
        sc.buf = buf;
        cur
    }

    // Mirrors: binary-hnsw-index.js:searchLayer — returns the result list ascending in sc.sorted.
    fn search_layer(&self, start: u32, j: u32, level: usize, sc: &mut Scratch, obs: &mut Vec<Obs>) {
        let ef = self.ef;
        sc.reset_visited();
        sc.visit(start);
        let start_dist = self.codes.dist(start, j);
        sc.cand.clear();
        sc.cand.insert(start, start_dist);
        sc.res.clear();
        sc.res.insert(start, start_dist);
        while sc.cand.len() > 0 {
            let cd = sc.cand.peek_val();
            if sc.res.len() >= ef && cd > sc.res.peek_val() {
                break;
            }
            let u = sc.cand.extract_min();
            // Two passes, as the JS batch path: mark the unvisited neighbors, score them all,
            // then update the heaps in list order (the same sequence as one at a time).
            let mut batch = std::mem::take(&mut sc.batch);
            batch.clear();
            let mut buf = std::mem::take(&mut sc.buf);
            let seen = self.read_list(level, u, &mut buf);
            for &v in buf.iter() {
                if sc.visit(v) {
                    batch.push(v);
                }
            }
            sc.buf = buf;
            let mut dists = std::mem::take(&mut sc.dists);
            self.codes.dist_batch(&batch, j, &mut dists);
            for (&v, &d) in batch.iter().zip(dists.iter()) {
                if sc.res.len() < ef {
                    sc.cand.insert(v, d);
                    sc.res.insert(v, d);
                } else if d < sc.res.peek_val() {
                    sc.cand.insert(v, d);
                    sc.res.replace_max(v, d);
                }
            }
            sc.batch = batch;
            sc.dists = dists;
            if let Some((slot, ver)) = seen {
                let full = sc.res.len() >= ef;
                obs.push(Obs {
                    level: level as u8,
                    kind: if full { FULL } else { NOT_FULL },
                    slot,
                    ver,
                    thr: if full { sc.res.peek_val() } else { 0 },
                });
            }
        }
        let mut sorted = std::mem::take(&mut sc.sorted);
        sc.res.drain_sorted(&mut sorted);
        sc.sorted = sorted;
    }

    // Mirrors: binary-hnsw-index.js:selectNeighborsHeuristic (candidates already ascending).
    fn select(&self, cands: &[(u32, u32)], max_m: usize) -> Vec<u32> {
        let mut sel: Vec<u32> = Vec::with_capacity(max_m);
        for &(c, cd) in cands {
            if sel.len() >= max_m {
                break;
            }
            if !sel.iter().any(|&s| self.codes.dist(c, s) < cd) {
                sel.push(c);
            }
        }
        if sel.len() < max_m {
            for &(c, _) in cands {
                if sel.len() >= max_m {
                    break;
                }
                if !sel.contains(&c) {
                    sel.push(c);
                }
            }
        }
        sel
    }

    /// The search part of addToGraph for node j, against the graph as it is now.
    fn speculate(&self, j: u32, sc: &mut Scratch) -> Spec {
        let entry = self.entry.load(Ordering::Acquire);
        let level = self.node_level[j as usize] as usize;
        let mut spec = Spec {
            entry,
            obs: Vec::new(),
            selected: vec![Vec::new(); level + 1],
        };
        let ep = (entry >> 32) as u32;
        if ep == NONE {
            return spec;
        }
        let max_level = (entry & 0xffff_ffff) as usize;
        let mut cur = ep;
        let mut l = max_level;
        while l > level {
            cur = self.greedy(cur, j, l, sc, &mut spec.obs);
            l -= 1;
        }
        for l in (0..=level).rev() {
            self.search_layer(cur, j, l, sc, &mut spec.obs);
            let sel = self.select(&sc.sorted, self.max_m(l));
            if let Some(&first) = sel.first() {
                cur = first;
            }
            spec.selected[l] = sel;
        }
        spec
    }

    /// True when j's speculative search is the search the current graph gives (see module doc).
    /// Runs on the committing thread, so no list changes during the check.
    fn validate(&self, j: u32, spec: &Spec) -> bool {
        if self.entry.load(Ordering::Acquire) != spec.entry {
            return false;
        }
        for o in &spec.obs {
            let lv = &self.levels[o.level as usize];
            let cur = lv.ver[o.slot as usize].load(Ordering::Acquire);
            if cur == o.ver {
                continue;
            }
            if (cur >> 32) != (o.ver >> 32) || o.kind == NOT_FULL {
                return false;
            }
            let from = (o.ver & 0xffff_ffff) as usize;
            if lv
                .entries(o.slot, from)
                .any(|v| self.codes.dist(v, j) < o.thr)
            {
                return false;
            }
        }
        true
    }

    fn slot_for(&self, level: usize, node: u32) -> Result<u32> {
        let lv = &self.levels[level];
        let s = lv.slot_of[node as usize].load(Ordering::Relaxed);
        if s != NONE {
            return Ok(s);
        }
        let s = lv.next_slot.fetch_add(1, Ordering::Relaxed);
        if s as usize >= lv.slots() {
            return Err(Error::from_reason(
                "buildBinaryHnsw: level slot capacity exceeded",
            ));
        }
        Ok(s)
    }

    // Mirrors: binary-hnsw-index.js:pruneNeighbors
    fn prune(&self, node: u32, list: &[u32], max_m: usize) -> Vec<u32> {
        let mut with_dist: Vec<(u32, u32)> = list
            .iter()
            .map(|&v| (v, self.codes.dist(v, node)))
            .collect();
        with_dist.sort_by_key(|&(_, d)| d); // stable, like Array.prototype.sort
        self.select(&with_dist, max_m)
    }

    /// The write part of addToGraph for node j (committing thread only).
    fn commit(&self, j: u32, spec: Spec) -> Result<()> {
        let level = self.node_level[j as usize] as usize;
        let entry = self.entry.load(Ordering::Acquire);
        let ep = (entry >> 32) as u32;
        // j's own lists (the empty ones above the old top level included), published after they
        // are filled: no search reaches j before its slot is set.
        for (l, sel) in spec.selected.iter().enumerate() {
            let lv = &self.levels[l];
            let slot = self.slot_for(l, j)?;
            lv.rewrite(slot, sel, false);
            lv.slot_of[j as usize].store(slot, Ordering::Release);
        }
        if ep != NONE {
            for l in (0..=level).rev() {
                let max_m = self.max_m(l);
                let lv = &self.levels[l];
                for &nb in &spec.selected[l] {
                    // The entry point gets a list on a level above its own when j opens that level
                    // (JS: `if (!this.graph[l][neighbor.idx]) this.graph[l][neighbor.idx] = []`).
                    let slot = self.slot_for(l, nb)?;
                    if lv.slot_of[nb as usize].load(Ordering::Relaxed) == NONE {
                        lv.slot_of[nb as usize].store(slot, Ordering::Release);
                    }
                    if lv.entries(slot, 0).any(|v| v == j) {
                        continue;
                    }
                    if lv.append(slot, j) > max_m * 2 {
                        let list: Vec<u32> = lv.entries(slot, 0).collect();
                        let pruned = self.prune(nb, &list, max_m);
                        lv.rewrite(slot, &pruned, true);
                    }
                }
            }
        }
        // Mirrors: the entry-point update at the end of addToGraph (+ _entryPointWinner).
        let max_level = (entry & 0xffff_ffff) as usize;
        let next = if ep == NONE || level > max_level {
            pack_entry(j, level as u32)
        } else if level == max_level && self.rank[j as usize] < self.rank[ep as usize] {
            pack_entry(j, max_level as u32)
        } else {
            entry
        };
        self.entry.store(next, Ordering::Release);
        Ok(())
    }
}

// ---------------------------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------------------------

/// macOS puts threads without a QoS class on the efficiency cores at times (a 1-thread build ran
/// 1.5x slower that way). A build gets the performance cores; a background one stays off them.
fn set_thread_qos(background: bool) {
    #[cfg(target_os = "macos")]
    // SAFETY: sets the QoS class of the calling thread only.
    unsafe {
        let class = if background {
            libc::qos_class_t::QOS_CLASS_UTILITY
        } else {
            libc::qos_class_t::QOS_CLASS_USER_INITIATED
        };
        libc::pthread_set_qos_class_self_np(class, 0);
    }
    // Linux: a nice value is per thread, so these threads do not inherit the nice 19 the
    // compaction child set on its main thread. who = 0 is the calling thread.
    #[cfg(target_os = "linux")]
    if background {
        // SAFETY: changes the nice value of the calling thread only.
        unsafe {
            libc::setpriority(libc::PRIO_PROCESS, 0, 19);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = background;
}

struct Outcome {
    redos: u64,
    /// Searches the committing thread ran because no worker result was there in time.
    own: u64,
}

fn run_serial(b: &Builder, n: usize) -> Result<Outcome> {
    set_thread_qos(b.background);
    let mut sc = Scratch::new(n);
    for j in 0..n as u32 {
        let spec = b.speculate(j, &mut sc);
        b.commit(j, spec)?;
    }
    Ok(Outcome {
        redos: 0,
        own: n as u64,
    })
}

/// (growth per passed validation, factor per failed one); SS_HNSW_BUILD_AIMD="0.5,0.5" overrides.
fn aimd() -> (f64, f64) {
    let parsed = std::env::var("SS_HNSW_BUILD_AIMD").ok().and_then(|v| {
        let (a, m) = v.split_once(',')?;
        Some((a.trim().parse().ok()?, m.trim().parse().ok()?))
    });
    parsed.unwrap_or((1.0, 0.7))
}

/// Sleep/wake between the workers and the committing thread. Each side spins briefly, then
/// sleeps; the other side notifies only when someone sleeps (a SeqCst store/load pair on each
/// side, so a wake-up is never lost).
struct Gate {
    lock: Mutex<()>,
    workers_cv: Condvar,
    committer_cv: Condvar,
    sleeping_workers: AtomicUsize,
    committer_sleeping: AtomicUsize,
}

const SPINS: u32 = 200;

impl Gate {
    fn wait_until(&self, cv: &Condvar, sleepers: &AtomicUsize, ready: impl Fn() -> bool) {
        for _ in 0..SPINS {
            if ready() {
                return;
            }
            std::hint::spin_loop();
        }
        let mut guard = self.lock.lock().unwrap();
        sleepers.fetch_add(1, Ordering::SeqCst);
        while !ready() {
            guard = cv.wait(guard).unwrap();
        }
        sleepers.fetch_sub(1, Ordering::SeqCst);
    }

    fn wake(&self, cv: &Condvar, sleepers: &AtomicUsize) {
        if sleepers.load(Ordering::SeqCst) > 0 {
            let _guard = self.lock.lock().unwrap();
            cv.notify_all();
        }
    }
}

fn now_ns(t0: &std::time::Instant) -> u64 {
    t0.elapsed().as_nanos() as u64
}

fn run_parallel(b: &Builder, n: usize, workers: usize, window: usize) -> Result<Outcome> {
    let ring: Vec<Mutex<Option<(u32, Spec)>>> = (0..window).map(|_| Mutex::new(None)).collect();
    // Per ring slot: 1 + the node a worker speculates now (0 when none), and when it started.
    let claimed: Vec<AtomicU64> = (0..window).map(|_| AtomicU64::new(0)).collect();
    let started: Vec<AtomicU64> = (0..window).map(|_| AtomicU64::new(0)).collect();
    let t0 = std::time::Instant::now();
    // Mean time of one speculative search (ns), a running average the workers update.
    let spec_ns = AtomicU64::new(1_000_000);
    let next = AtomicUsize::new(0);
    let committed = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);
    // A worker panicked (a bug): the build stops with an error, the JS loop then links instead.
    let panicked = AtomicUsize::new(0);
    let gate = Gate {
        lock: Mutex::new(()),
        workers_cv: Condvar::new(),
        committer_cv: Condvar::new(),
        sleeping_workers: AtomicUsize::new(0),
        committer_sleeping: AtomicUsize::new(0),
    };
    // How far ahead the workers may speculate (at most `window`). A search run k commits early
    // fails validation more often the larger k is (and the smaller the graph); one that starts
    // too late leaves the committing thread to run it. The committing thread moves the lead.
    let (grow, shrink) = aimd();
    let lead = AtomicUsize::new(window.min(2));
    let mut lead_f = lead.load(Ordering::Relaxed) as f64;
    let mut redos = 0u64;
    let mut own = 0u64;
    let mut lead_sum = 0f64;
    let mut result = Ok(());
    let take_spec = |j: usize| {
        let mut slot = ring[j % window].lock().unwrap();
        if matches!(slot.as_ref(), Some((sj, _)) if *sj as usize == j) {
            slot.take().map(|x| x.1)
        } else {
            None
        }
    };
    let has_spec = |j: usize| matches!(ring[j % window].lock().unwrap().as_ref(), Some((sj, _)) if *sj as usize == j);
    std::thread::scope(|s| {
        for _ in 0..workers {
            // A thread the OS refuses: fewer workers (the committing thread runs what no worker
            // claimed), not a panic that leaves the spawned ones waiting.
            let spawned = std::thread::Builder::new().spawn_scoped(s, || {
                set_thread_qos(b.background);
                let mut sc = Scratch::new(n);
                let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| loop {
                    let j = next.fetch_add(1, Ordering::Relaxed);
                    if j >= n || failed.load(Ordering::SeqCst) != 0 {
                        break;
                    }
                    // Speculate at most `lead` nodes ahead of the commits (a slot of the ring
                    // is free again once its previous node is committed).
                    gate.wait_until(&gate.workers_cv, &gate.sleeping_workers, || {
                        j < committed.load(Ordering::SeqCst) + lead.load(Ordering::SeqCst)
                    });
                    if failed.load(Ordering::SeqCst) != 0 {
                        break;
                    }
                    if j < committed.load(Ordering::SeqCst) {
                        continue; // the committing thread already ran it
                    }
                    let begin = now_ns(&t0);
                    started[j % window].store(begin, Ordering::SeqCst);
                    claimed[j % window].store(j as u64 + 1, Ordering::SeqCst);
                    let spec = b.speculate(j as u32, &mut sc);
                    let took = now_ns(&t0) - begin;
                    let avg = spec_ns.load(Ordering::Relaxed);
                    spec_ns.store(avg - avg / 32 + took / 32, Ordering::Relaxed);
                    {
                        // Check and store under the slot lock, and never over a newer node: a
                        // store late by a whole window (preempted after its check) replaced the
                        // spec of node j + window, and the committing thread waited for it forever.
                        let mut slot = ring[j % window].lock().unwrap();
                        let newer = matches!(slot.as_ref(), Some((sj, _)) if *sj as usize > j);
                        if !newer && j >= committed.load(Ordering::SeqCst) {
                            *slot = Some((j as u32, spec));
                        }
                    }
                    gate.wake(&gate.committer_cv, &gate.committer_sleeping);
                }));
                if run.is_err() {
                    panicked.store(1, Ordering::SeqCst);
                    gate.wake(&gate.committer_cv, &gate.committer_sleeping);
                }
            });
            if spawned.is_err() {
                break;
            }
        }
        set_thread_qos(b.background);
        let mut sc = Scratch::new(n);
        // A panic here must stop the workers too: the scope waits for them, and they wait for
        // commits that would never come.
        let commit_loop = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            for j in 0..n {
                // The result of a worker when it is there, or close: a search that started less than
                // half a mean search ago (or not at all) runs here at once instead, on the current
                // graph (no check needed).
                let mut spec = take_spec(j);
                if spec.is_none() {
                    let in_flight = claimed[j % window].load(Ordering::SeqCst) == j as u64 + 1;
                    let half = spec_ns.load(Ordering::Relaxed) / 2;
                    if in_flight
                        && now_ns(&t0).saturating_sub(started[j % window].load(Ordering::SeqCst))
                            >= half
                    {
                        gate.wait_until(&gate.committer_cv, &gate.committer_sleeping, || {
                            has_spec(j) || panicked.load(Ordering::SeqCst) != 0
                        });
                        spec = take_spec(j);
                    }
                }
                if panicked.load(Ordering::SeqCst) != 0 {
                    failed.store(1, Ordering::SeqCst);
                    committed.store(usize::MAX / 2, Ordering::SeqCst);
                    gate.wake(&gate.workers_cv, &gate.sleeping_workers);
                    result = Err(Error::from_reason(
                        "buildBinaryHnsw: a worker thread panicked",
                    ));
                    break;
                }
                let spec = match spec {
                    Some(spec) if b.validate(j as u32, &spec) => {
                        lead_f += grow / lead_f.max(1.0);
                        spec
                    }
                    Some(_) => {
                        redos += 1;
                        lead_f *= shrink;
                        b.speculate(j as u32, &mut sc)
                    }
                    None => {
                        own += 1;
                        lead_f += grow;
                        b.speculate(j as u32, &mut sc)
                    }
                };
                lead_f = lead_f.clamp(2f64.min(window as f64), window as f64);
                lead.store(lead_f as usize, Ordering::SeqCst);
                lead_sum += lead_f;
                if let Err(e) = b.commit(j as u32, spec) {
                    failed.store(1, Ordering::SeqCst);
                    committed.store(usize::MAX / 2, Ordering::SeqCst);
                    gate.wake(&gate.workers_cv, &gate.sleeping_workers);
                    result = Err(e);
                    break;
                }
                committed.store(j + 1, Ordering::SeqCst);
                gate.wake(&gate.workers_cv, &gate.sleeping_workers);
            }
        }));
        if commit_loop.is_err() {
            failed.store(1, Ordering::SeqCst);
            committed.store(usize::MAX / 2, Ordering::SeqCst);
            gate.wake(&gate.workers_cv, &gate.sleeping_workers);
            result = Err(Error::from_reason(
                "buildBinaryHnsw: the committing thread panicked",
            ));
        }
    });
    if std::env::var_os("SS_HNSW_BUILD_STATS").is_some() {
        eprintln!(
            "hnsw_build: redos={redos} own={own} mean_lead={:.1} spec_us={}",
            lead_sum / n as f64,
            spec_ns.load(Ordering::Relaxed) / 1000
        );
    }
    result.map(|_| Outcome { redos, own })
}

// ---------------------------------------------------------------------------------------------
// N-API
// ---------------------------------------------------------------------------------------------

#[napi(object)]
pub struct BuiltHnswLevel {
    /// Length of the JS level array: 1 + the highest node with a list on this level.
    pub len: u32,
    pub present: Uint8Array,
    pub offsets: Uint32Array,
    pub neighbors: Uint32Array,
}

#[napi(object)]
pub struct BuiltHnswGraph {
    pub levels: Vec<BuiltHnswLevel>,
    pub entry_point: i32,
    pub max_level: u32,
    /// Speculative searches that ran again on the committing thread.
    pub redos: f64,
    pub threads: u32,
}

struct RawLevel {
    len: u32,
    present: Vec<u8>,
    offsets: Vec<u32>,
    neighbors: Vec<u32>,
}

pub struct BuildTask {
    codes: Vec<u8>,
    dimension: usize,
    levels: Vec<u8>,
    rank: Vec<u32>,
    m: usize,
    ef: usize,
    threads: usize,
    background: bool,
}

pub struct BuildOutput {
    levels: Vec<RawLevel>,
    entry_point: i32,
    max_level: u32,
    redos: u64,
    threads: u32,
}

fn build(t: &BuildTask) -> Result<BuildOutput> {
    let n = t.levels.len();
    if t.dimension == 0
        || t.codes.len() < n * t.dimension
        || t.rank.len() != n
        || t.m == 0
        || t.ef == 0
    {
        return Err(Error::from_reason("buildBinaryHnsw: bad arguments"));
    }
    if n as u64 >= NONE as u64 {
        return Err(Error::from_reason("buildBinaryHnsw: too many nodes"));
    }
    let top = t.levels.iter().copied().max().unwrap_or(0) as usize;
    let level_count = if n == 0 { 0 } else { top + 1 };
    let mut at_least = vec![0usize; level_count];
    for &lv in &t.levels {
        for c in at_least.iter_mut().take(lv as usize + 1) {
            *c += 1;
        }
    }
    let m = t.m;
    let levels = (0..level_count)
        .map(|l| {
            let max_m = if l == 0 { m * 2 } else { m };
            // +16: the entry point's lists above its own level (one per newly opened level).
            Level::new(n, at_least[l] + 16, max_m * 2 + 1)
        })
        .collect();
    let b = Builder {
        codes: Codes::new(&t.codes, t.dimension, n),
        node_level: t.levels.clone(),
        rank: t.rank.clone(),
        m,
        ef: t.ef,
        levels,
        entry: AtomicU64::new(pack_entry(NONE, 0)),
        background: t.background,
    };
    let workers = t.threads.saturating_sub(1);
    // On a thread of its own: the QoS class it sets must not stay on the libuv pool thread.
    let outcome = std::thread::scope(|s| {
        s.spawn(|| {
            // One worker gives no speedup (measured: 50k nodes, 1 thread 28.8 s, 2 threads 27.7 s
            // at twice the CPU): the committing thread reaches each node while the worker has
            // only started it, so it runs it itself.
            if workers < 2 || n < 2 {
                run_serial(&b, n)
            } else {
                run_parallel(&b, n, workers, workers)
            }
        })
        .join()
        .map_err(|_| Error::from_reason("buildBinaryHnsw: build thread panicked"))?
    })?;

    let mut out_levels = Vec::with_capacity(level_count);
    for lv in &b.levels {
        let mut present = Vec::new();
        let mut offsets = vec![0u32; n + 1];
        let mut neighbors = Vec::new();
        let mut len = 0u32;
        for node in 0..n {
            offsets[node] = neighbors.len() as u32;
            let slot = lv.slot_of[node].load(Ordering::Acquire);
            if slot != NONE {
                len = node as u32 + 1;
                neighbors.extend(lv.entries(slot, 0));
            }
        }
        offsets[n] = neighbors.len() as u32;
        present.resize(len as usize, 0u8);
        for (node, p) in present.iter_mut().enumerate() {
            *p = (lv.slot_of[node].load(Ordering::Acquire) != NONE) as u8;
        }
        out_levels.push(RawLevel {
            len,
            present,
            offsets,
            neighbors,
        });
    }
    let entry = b.entry.load(Ordering::Acquire);
    let ep = (entry >> 32) as u32;
    Ok(BuildOutput {
        levels: out_levels,
        entry_point: if ep == NONE { -1 } else { ep as i32 },
        max_level: (entry & 0xffff_ffff) as u32,
        redos: outcome.redos,
        threads: if workers < 2 || n < 2 {
            1
        } else {
            (workers + 1) as u32
        },
    })
}

impl Task for BuildTask {
    type Output = BuildOutput;
    type JsValue = BuiltHnswGraph;

    fn compute(&mut self) -> Result<Self::Output> {
        build(self)
    }

    fn resolve(&mut self, _env: Env, out: Self::Output) -> Result<Self::JsValue> {
        Ok(BuiltHnswGraph {
            levels: out
                .levels
                .into_iter()
                .map(|l| BuiltHnswLevel {
                    len: l.len,
                    present: Uint8Array::new(l.present),
                    offsets: Uint32Array::new(l.offsets),
                    neighbors: Uint32Array::new(l.neighbors),
                })
                .collect(),
            entry_point: out.entry_point,
            max_level: out.max_level,
            redos: out.redos as f64,
            threads: out.threads,
        })
    }
}

/// Build the graph of `levels.len()` nodes inserted in node order (see the module doc).
/// `codes`: n × dimension bytes. `levels[i]`: node i's level (levelForId). `idRank[i]`: the rank of
/// node i's id in JS string order (the entry-point tie-break). `threads` 1 runs the plain
/// sequential build; more runs `threads - 1` speculating workers and one committing thread.
#[napi]
pub fn build_binary_hnsw(
    codes: Uint8Array,
    dimension: u32,
    levels: Uint8Array,
    id_rank: Uint32Array,
    m: u32,
    ef_construction: u32,
    threads: u32,
    background: Option<bool>,
) -> AsyncTask<BuildTask> {
    AsyncTask::new(BuildTask {
        codes: codes.to_vec(),
        dimension: dimension as usize,
        levels: levels.to_vec(),
        rank: id_rank.to_vec(),
        m: m as usize,
        ef: ef_construction as usize,
        threads: threads.clamp(1, 64) as usize,
        background: background.unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(n: usize, dim: usize, threads: usize, seed: u64) -> BuildTask {
        let mut s = seed;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            s
        };
        let codes: Vec<u8> = (0..n * dim).map(|_| next() as u8).collect();
        let levels: Vec<u8> = (0..n)
            .map(|_| {
                let r = next() % 4096;
                if r == 0 {
                    2
                } else if r < 64 {
                    1
                } else {
                    0
                }
            })
            .collect();
        let rank: Vec<u32> = (0..n as u32).rev().collect();
        BuildTask {
            codes,
            dimension: dim,
            levels,
            rank,
            m: 8,
            ef: 40,
            threads,
            background: false,
        }
    }

    fn graph_bytes(o: &BuildOutput) -> Vec<u32> {
        let mut v = vec![o.entry_point as u32, o.max_level];
        for l in &o.levels {
            v.push(l.len);
            v.extend(l.present.iter().map(|&p| p as u32));
            v.extend(&l.offsets);
            v.extend(&l.neighbors);
        }
        v
    }

    #[test]
    fn parallel_equals_serial() {
        for seed in [1u64, 7, 99] {
            let serial = build(&task(3000, 12, 1, seed)).unwrap();
            for threads in [2, 4, 9] {
                let par = build(&task(3000, 12, threads, seed)).unwrap();
                assert_eq!(
                    graph_bytes(&serial),
                    graph_bytes(&par),
                    "seed {seed} threads {threads}"
                );
            }
        }
    }

    #[cfg(target_arch = "aarch64")]
    #[test]
    fn neon_distance_does_not_wrap_on_long_codes() {
        // 4096 blocks of all-different bits: a u16 lane would wrap to 0.
        for words in [2, 16, 8190, 8192, 8194, 20000] {
            let x = vec![0u64; words];
            let y = vec![u64::MAX; words];
            assert_eq!(
                hamming_neon(&x, &y),
                hamming_scalar(&x, &y),
                "words {words}"
            );
        }
    }

    #[test]
    fn heaps_match_js_rules() {
        let mut h = MaxHeap::default();
        for (k, v) in [(1, 5), (2, 5), (3, 1), (4, 9), (5, 5)] {
            h.insert(k, v);
        }
        let mut out = Vec::new();
        h.drain_sorted(&mut out);
        assert_eq!(
            out.iter().map(|p| p.1).collect::<Vec<_>>(),
            vec![1, 5, 5, 5, 9]
        );
        let mut m = MinHeap::default();
        for (k, v) in [(1, 3), (2, 3), (3, 2)] {
            m.insert(k, v);
        }
        assert_eq!(m.extract_min(), 3);
    }

    /// Profiling aid: SS_HNSW_BENCH=<dir with codes.bin, levels.bin> [SS_HNSW_BENCH_THREADS].
    #[test]
    #[ignore]
    fn bench_from_files() {
        let dir = std::env::var("SS_HNSW_BENCH").unwrap();
        let codes = std::fs::read(format!("{dir}/codes.bin")).unwrap();
        let levels = std::fs::read(format!("{dir}/levels.bin")).unwrap();
        let n = levels.len();
        let threads = std::env::var("SS_HNSW_BENCH_THREADS")
            .ok()
            .and_then(|t| t.parse().ok())
            .unwrap_or(1);
        let t = BuildTask {
            codes,
            dimension: 96,
            levels,
            rank: (0..n as u32).collect(),
            m: 64,
            ef: 800,
            threads,
            background: false,
        };
        let t0 = std::time::Instant::now();
        let out = build(&t).unwrap();
        eprintln!(
            "n={n} threads={threads} secs={:.2} redos={}",
            t0.elapsed().as_secs_f64(),
            out.redos
        );
    }
}
