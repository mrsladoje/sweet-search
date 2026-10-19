//! Read side of the full-vector file beside the binary HNSW index
//! (`<index>.fullvec.bin`, written by core/vector-store/full-vector-file.js).
//!
//! The final rescore reads the full 768-d embedding of each stage-2 candidate.
//! From SQLite that is one B-tree lookup and one ~4 KB row per id; here it is
//! one row of a memory-mapped file, so the OS page cache holds the vectors and
//! the process heap does not.
//!
//! Layout (little-endian): a 64-byte header (`SSFVEC2\0`, dim u32 at 8,
//! generation u32 at 12, rest zero), then rows of `dim` f16 back to back. The
//! file only grows; the node -> row map is a separate file published with each
//! index save. The mapping covers the rows present at open; rows appended later
//! are seen after a reopen.

use memmap2::Mmap;
use napi::bindgen_prelude::{Float64Array, Uint32Array};
use napi::{Env, JsBuffer};
use napi_derive::napi;
use std::fs::File;

const MAGIC: &[u8; 8] = b"SSFVEC2\0";
const HEADER: usize = 64;

thread_local! {
    // Widened rows of the current dots() call, and their indices 0..n.
    static WIDE: std::cell::RefCell<(Vec<f32>, Vec<u32>)> = const { std::cell::RefCell::new((Vec::new(), Vec::new())) };
}

/// SS_HNSW_PRELOAD=1: read the full-vector file and the int8 rows into
/// anonymous memory at open instead of mapping them from the page cache, so
/// other I/O cannot evict them (a longer open, the same resident size once
/// every row has been touched). Default off: the mapping.
pub(crate) fn preload() -> bool {
    std::env::var("SS_HNSW_PRELOAD").map(|v| v == "1").unwrap_or(false)
}

/// The bytes of the file: a read-only mapping (default) or a heap copy (preload).
enum Bytes {
    Map(Mmap),
    Heap(Vec<u64>, usize), // u64 words keep the u16 rows aligned; usize = byte length
}

impl std::ops::Deref for Bytes {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        match self {
            Bytes::Map(m) => m,
            // SAFETY: the Vec holds at least `len` initialised bytes.
            Bytes::Heap(v, len) => unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, *len) },
        }
    }
}

fn read_heap(file: &mut File, len: usize) -> std::io::Result<Bytes> {
    use std::io::Read;
    let mut v = vec![0u64; len.div_ceil(8)];
    // SAFETY: the Vec owns len.div_ceil(8) * 8 >= len bytes.
    let buf = unsafe { std::slice::from_raw_parts_mut(v.as_mut_ptr() as *mut u8, len) };
    file.read_exact(buf)?;
    Ok(Bytes::Heap(v, len))
}

#[napi]
pub struct FullVectorFile {
    map: Bytes,
    dim: usize,
    rows: usize,
    generation: u32,
}

impl FullVectorFile {
    /// Rows in the mapping.
    pub(crate) fn row_count(&self) -> usize {
        self.rows
    }

    /// Row width (f32 values per row).
    pub(crate) fn width(&self) -> usize {
        self.dim
    }

    /// `dot_scores` for Rust callers: rows must be < row_count(). The rows
    /// are widened to f32 (exact) in a scratch block, then scored with the
    /// f32 kernel, so a score is the f64 sum of the f16 values times the query.
    pub(crate) fn dots(&self, query: &[f64], rows: &[u32], out: &mut [f64]) {
        let data = self.data();
        let dim = self.dim;
        crate::rescore::prefetch_rows(data.as_ptr() as *const u8, dim * 2, rows);
        WIDE.with(|cell| {
            let (w, idx) = &mut *cell.borrow_mut();
            w.resize(rows.len() * dim, 0.0);
            idx.clear();
            for (j, &r) in rows.iter().enumerate() {
                let r = r as usize;
                crate::rescore::f16_to_f32(&data[r * dim..(r + 1) * dim], &mut w[j * dim..(j + 1) * dim]);
                idx.push(j as u32);
            }
            crate::rescore::f64_dots(w, dim, query, idx, out);
        });
    }

    fn data(&self) -> &[u16] {
        if self.rows == 0 {
            return &[];
        }
        // SAFETY: the mapping is page aligned, so HEADER (64) keeps u16
        // alignment, and `rows * dim` values lie inside it (checked at open).
        unsafe { std::slice::from_raw_parts(self.map.as_ptr().add(HEADER) as *const u16, self.rows * self.dim) }
    }
}

#[napi]
impl FullVectorFile {
    #[napi(constructor)]
    pub fn new(path: String) -> napi::Result<Self> {
        let mut file = File::open(&path).map_err(|e| napi::Error::from_reason(format!("FullVectorFile: {path}: {e}")))?;
        let map = if preload() {
            let len = file.metadata().map_err(|e| napi::Error::from_reason(format!("FullVectorFile: {path}: {e}")))?.len() as usize;
            read_heap(&mut file, len).map_err(|e| napi::Error::from_reason(format!("FullVectorFile: read {path}: {e}")))?
        } else {
            // SAFETY: the writer only appends; bytes inside the mapped length
            // never change while it is mapped.
            Bytes::Map(unsafe { Mmap::map(&file) }.map_err(|e| napi::Error::from_reason(format!("FullVectorFile: mmap {path}: {e}")))?)
        };
        if map.len() < HEADER || &map[..8] != MAGIC {
            return Err(napi::Error::from_reason(format!("FullVectorFile: bad header in {path}")));
        }
        let dim = u32::from_le_bytes(map[8..12].try_into().unwrap()) as usize;
        let generation = u32::from_le_bytes(map[12..16].try_into().unwrap());
        if dim == 0 {
            return Err(napi::Error::from_reason(format!("FullVectorFile: zero width in {path}")));
        }
        let rows = (map.len() - HEADER) / (dim * 2);
        // Rows are read one at a time in random order: no read-ahead, so only
        // the pages of rows actually scored become resident.
        #[cfg(unix)]
        if let Bytes::Map(m) = &map {
            let _ = m.advise(memmap2::Advice::Random);
        }
        Ok(Self { map, dim, rows, generation })
    }

    #[napi(getter)]
    pub fn dim(&self) -> u32 {
        self.dim as u32
    }

    #[napi(getter)]
    pub fn rows(&self) -> u32 {
        self.rows as u32
    }

    #[napi(getter)]
    pub fn generation(&self) -> u32 {
        self.generation
    }

    /// Full-vector scores of these rows (sequential f64 sums of the f16
    /// values, widened exactly, times the query), written to `out[0..rows.len()]`.
    #[napi]
    pub fn dot_scores(&self, query: Float64Array, rows: Uint32Array, mut out: Float64Array) -> napi::Result<()> {
        if query.len() != self.dim || out.len() < rows.len() {
            return Err(napi::Error::from_reason("FullVectorFile.dotScores: bad query or output length"));
        }
        if rows.iter().any(|&r| r as usize >= self.rows) {
            return Err(napi::Error::from_reason("FullVectorFile.dotScores: row out of range"));
        }
        self.dots(&query, &rows, out.as_mut());
        Ok(())
    }
}

/// A private (copy-on-write) mapping of `len` bytes of `path` at `offset`, as
/// a Buffer that shares the mapped pages (phase K3: the index file's int8
/// rows). Reads come from the page cache (file-backed, reclaimable), not the
/// heap; a write copies only the page it touches and never reaches the file.
/// The mapping lives until the Buffer is garbage-collected, so it survives a
/// later save that renames a new index file over this one.
#[napi]
pub fn map_file_section(env: Env, path: String, offset: f64, len: f64) -> napi::Result<JsBuffer> {
    let len = len as usize;
    if len == 0 {
        return env.create_buffer(0).map(|b| b.into_raw());
    }
    if preload() {
        // SS_HNSW_PRELOAD=1: a heap copy of the section (anonymous memory), not a mapping
        use std::io::{Read, Seek, SeekFrom};
        let mut file = File::open(&path).map_err(|e| napi::Error::from_reason(format!("map_file_section: {path}: {e}")))?;
        let mut buf = vec![0u8; len];
        file.seek(SeekFrom::Start(offset as u64)).and_then(|_| file.read_exact(&mut buf))
            .map_err(|e| napi::Error::from_reason(format!("map_file_section: read {path}: {e}")))?;
        return env.create_buffer_with_data(buf).map(|b| b.into_raw());
    }
    let file = File::open(&path).map_err(|e| napi::Error::from_reason(format!("map_file_section: {path}: {e}")))?;
    // SAFETY: a private mapping; the index file is replaced by rename, never
    // rewritten in place, so the mapped bytes do not change under it.
    let mut map = unsafe { memmap2::MmapOptions::new().offset(offset as u64).len(len).map_copy(&file) }
        .map_err(|e| napi::Error::from_reason(format!("map_file_section: mmap {path}: {e}")))?;
    // Rows are read in random order: no read-ahead.
    #[cfg(unix)]
    let _ = map.advise(memmap2::Advice::Random);
    let ptr = map.as_mut_ptr();
    // SAFETY: `map` moves into the finalizer, which runs after V8 drops the
    // last reference to the buffer, so `ptr` stays valid for the buffer's life.
    unsafe { env.create_buffer_with_borrowed_data(ptr, len, map, |m, _| drop(m)) }.map(|b| b.into_raw())
}
