//! File bytes kept between greps in a long-lived process (the search daemon).
//!
//! A grep reads every candidate file, and on macOS opening a file costs ~11 µs where a stat
//! costs ~2 µs: re-reading an unchanged repository was most of a broad grep. A file read
//! here is kept with its stat signature (device, inode, size, mode, mtime and ctime to the
//! nanosecond) and served again while a fresh stat still shows that signature.
//!
//! Racy files are never kept: a file changed within the last 2 seconds (git's "racily
//! clean" rule) could change again within one timestamp tick and keep its signature. Every
//! write moves ctime, so a kept file that changes later no longer matches and is read again.
//!
//! Only regular files are kept. The cache stops taking new files at its byte cap
//! (`SWEET_SEARCH_GREP_CACHE_MB`, default 64; 0 turns it off) instead of evicting: a grep
//! scans every candidate, and an evicting cache smaller than the repository would evict
//! each file before the next scan reached it.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::Metadata;
use std::hash::{Hash, Hasher};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

const SHARDS: usize = 32;
const DEFAULT_CAP_MB: usize = 64;
const RACY_SECONDS: i64 = 2;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Signature {
    dev: u64,
    ino: u64,
    size: u64,
    mode: u32,
    mtime: i64,
    mtime_nsec: i64,
    ctime: i64,
    ctime_nsec: i64,
}

impl Signature {
    fn of(meta: &Metadata) -> Self {
        Signature {
            dev: meta.dev(),
            ino: meta.ino(),
            size: meta.size(),
            mode: meta.mode(),
            mtime: meta.mtime(),
            mtime_nsec: meta.mtime_nsec(),
            ctime: meta.ctime(),
            ctime_nsec: meta.ctime_nsec(),
        }
    }

    fn is_racy(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(i64::MAX);
        now - self.mtime.max(self.ctime) <= RACY_SECONDS
    }
}

/// A kept file: its bytes, or None for a file the grep skips (binary).
struct Entry {
    signature: Signature,
    bytes: Option<Arc<Vec<u8>>>,
}

struct Cache {
    shards: Vec<Mutex<HashMap<PathBuf, Entry>>>,
    held: AtomicUsize,
    cap: usize,
}

fn cache() -> Option<&'static Cache> {
    static CACHE: OnceLock<Option<Cache>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let mb = std::env::var("SWEET_SEARCH_GREP_CACHE_MB")
                .ok()
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(DEFAULT_CAP_MB);
            (mb > 0).then(|| Cache {
                shards: (0..SHARDS).map(|_| Mutex::new(HashMap::new())).collect(),
                held: AtomicUsize::new(0),
                cap: mb << 20,
            })
        })
        .as_ref()
}

fn shard_of(path: &Path) -> usize {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    (h.finish() as usize) % SHARDS
}

/// A lookup: Hit(bytes) is what a fresh read would return (None: binary, skipped).
pub(crate) enum Cached {
    Hit(Option<Arc<Vec<u8>>>),
    Miss,
}

/// The kept read of `path` when `meta` (a stat taken now) still shows its signature.
pub(crate) fn lookup(path: &Path, meta: &Metadata) -> Cached {
    let Some(cache) = cache() else { return Cached::Miss };
    if !meta.is_file() {
        return Cached::Miss;
    }
    let shard = cache.shards[shard_of(path)].lock().unwrap_or_else(|e| e.into_inner());
    match shard.get(path) {
        Some(entry) if entry.signature == Signature::of(meta) => Cached::Hit(entry.bytes.clone()),
        _ => Cached::Miss,
    }
}

/// Keep one read of `path`: `before` is the stat the caller looked it up with, `opened` the
/// fstat of the handle the bytes came from. Kept only when the two agree and the file is
/// not racy; a stale entry for the path is dropped either way.
pub(crate) fn store(path: &Path, before: &Metadata, opened: &Metadata, bytes: Option<&Arc<Vec<u8>>>) {
    let Some(cache) = cache() else { return };
    if !before.is_file() {
        return;
    }
    let signature = Signature::of(opened);
    let keep = signature == Signature::of(before) && !signature.is_racy();
    let size = bytes.map_or(0, |b| b.len()) + path.as_os_str().len();
    let mut shard = cache.shards[shard_of(path)].lock().unwrap_or_else(|e| e.into_inner());
    if let Some(old) = shard.remove(path) {
        cache.held.fetch_sub(old.bytes.as_ref().map_or(0, |b| b.len()) + path.as_os_str().len(), Ordering::Relaxed);
    }
    if !keep || cache.held.load(Ordering::Relaxed) + size > cache.cap {
        return;
    }
    cache.held.fetch_add(size, Ordering::Relaxed);
    shard.insert(path.to_path_buf(), Entry { signature, bytes: bytes.cloned() });
}
