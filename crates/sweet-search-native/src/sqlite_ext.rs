//! SQLite loadable extension for the semantic cascade's full-vector stage.
//!
//! better-sqlite3 loads this addon into its own connection
//! (`db.loadExtension(addonPath, 'sqlite3_ssext_init')`), so the function
//! runs inside the one SQLite library the process already uses; a second
//! SQLite copy in the same process can break POSIX file locking. The
//! extension API table (`sqlite3_api_routines`) is an append-only ABI of
//! function pointers; the indices below are its field positions.
//!
//! `ss_full_dots(query, pos, embedding)` is an aggregate. `query` is the
//! f64 query as a blob (constant per statement), `pos` the caller's slot
//! for the row, `embedding` the row's f32 blob (or NULL). It returns one
//! blob of f64 triples `[pos, flag, score]`, one per row: flag 0 = NULL
//! embedding (not found), 1 = score set, 2 = found but no score (empty
//! vector). Scores are `dotProduct(query, embedding)` from
//! search-semantic.js bit for bit: a sequential f64 sum over the shorter
//! length (rows as wide as the query go through `rescore::f64_dots`, the
//! same arithmetic interleaved across rows). One result row instead of one
//! Buffer per row is the point.

use std::ffi::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicPtr, Ordering};

const API_AGGREGATE_CONTEXT: usize = 0;
const API_RESULT_BLOB: usize = 78;
const API_RESULT_ERROR: usize = 80;
const API_VALUE_BLOB: usize = 102;
const API_VALUE_BYTES: usize = 103;
const API_VALUE_INT64: usize = 107;
const API_VALUE_TYPE: usize = 113;
const API_CREATE_FUNCTION_V2: usize = 162;

const SQLITE_OK: c_int = 0;
const SQLITE_ERROR: c_int = 1;
const SQLITE_NULL: c_int = 5;
const SQLITE_UTF8: c_int = 1;
const SQLITE_DETERMINISTIC: c_int = 0x800;
const SQLITE_TRANSIENT: isize = -1;

type Ctx = c_void;
type Value = c_void;
type StepFn = unsafe extern "C" fn(*mut Ctx, c_int, *mut *mut Value);
type FinalFn = unsafe extern "C" fn(*mut Ctx);

static API: AtomicPtr<*const c_void> = AtomicPtr::new(std::ptr::null_mut());

#[inline(always)]
unsafe fn api<T: Copy>(index: usize) -> T {
    let table = API.load(Ordering::Acquire) as *const *const c_void;
    std::mem::transmute_copy::<*const c_void, T>(&*table.add(index))
}

#[derive(Default)]
struct State {
    query: Vec<f64>,
    // per row: pos, flag (0 null, 1 full-width, 3 other width), start, len
    rows: Vec<(f64, u8, usize, usize)>,
    full: Vec<f32>,
    other: Vec<f32>,
}

unsafe fn blob(v: *mut Value) -> Option<&'static [u8]> {
    let value_type: unsafe extern "C" fn(*mut Value) -> c_int = api(API_VALUE_TYPE);
    if value_type(v) == SQLITE_NULL {
        return None;
    }
    let value_blob: unsafe extern "C" fn(*mut Value) -> *const c_void = api(API_VALUE_BLOB);
    let value_bytes: unsafe extern "C" fn(*mut Value) -> c_int = api(API_VALUE_BYTES);
    let p = value_blob(v) as *const u8;
    let n = value_bytes(v).max(0) as usize;
    Some(if p.is_null() || n == 0 { &[] } else { std::slice::from_raw_parts(p, n) })
}

fn push_f32s(dst: &mut Vec<f32>, bytes: &[u8]) {
    #[cfg(target_endian = "little")]
    {
        let n = bytes.len() / 4;
        dst.reserve(n);
        // SAFETY: capacity reserved above; f32 has no invalid bit patterns,
        // and a byte copy has no alignment requirement on the source.
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), dst.as_mut_ptr().add(dst.len()) as *mut u8, n * 4);
            dst.set_len(dst.len() + n);
        }
    }
    #[cfg(not(target_endian = "little"))]
    dst.extend(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])));
}

unsafe fn error(ctx: *mut Ctx, msg: &std::ffi::CStr) {
    let result_error: unsafe extern "C" fn(*mut Ctx, *const c_char, c_int) = api(API_RESULT_ERROR);
    result_error(ctx, msg.as_ptr(), -1);
}

unsafe extern "C" fn step(ctx: *mut Ctx, argc: c_int, argv: *mut *mut Value) {
    if argc != 3 {
        return error(ctx, c"ss_full_dots: expected 3 arguments");
    }
    let aggregate_context: unsafe extern "C" fn(*mut Ctx, c_int) -> *mut c_void = api(API_AGGREGATE_CONTEXT);
    let slot = aggregate_context(ctx, std::mem::size_of::<*mut State>() as c_int) as *mut *mut State;
    if slot.is_null() {
        return error(ctx, c"ss_full_dots: out of memory");
    }
    if (*slot).is_null() {
        let mut st = Box::<State>::default();
        let q = blob(*argv).unwrap_or(&[]);
        if !q.len().is_multiple_of(8) {
            return error(ctx, c"ss_full_dots: query blob is not f64");
        }
        st.query = q.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect();
        *slot = Box::into_raw(st);
    }
    let st = &mut **slot;
    let value_int64: unsafe extern "C" fn(*mut Value) -> i64 = api(API_VALUE_INT64);
    let pos = value_int64(*argv.add(1)) as f64;
    match blob(*argv.add(2)) {
        None => st.rows.push((pos, 0, 0, 0)),
        Some(b) => {
            if !b.len().is_multiple_of(4) {
                return error(ctx, c"ss_full_dots: embedding blob is not f32");
            }
            let len = b.len() / 4;
            if len == st.query.len() && len > 0 {
                let start = st.full.len() / len;
                push_f32s(&mut st.full, b);
                st.rows.push((pos, 1, start, len));
            } else {
                let start = st.other.len();
                push_f32s(&mut st.other, b);
                st.rows.push((pos, 3, start, len));
            }
        }
    }
}

unsafe extern "C" fn finish(ctx: *mut Ctx) {
    let aggregate_context: unsafe extern "C" fn(*mut Ctx, c_int) -> *mut c_void = api(API_AGGREGATE_CONTEXT);
    let result_blob: unsafe extern "C" fn(*mut Ctx, *const c_void, c_int, isize) = api(API_RESULT_BLOB);
    let slot = aggregate_context(ctx, 0) as *mut *mut State;
    let st = if slot.is_null() || (*slot).is_null() { None } else { Some(Box::from_raw(*slot)) };
    let Some(st) = st else {
        result_blob(ctx, [0u8; 0].as_ptr() as *const c_void, 0, SQLITE_TRANSIENT);
        return;
    };
    *slot = std::ptr::null_mut();
    let dim = st.query.len();
    let full_rows: Vec<u32> = st.rows.iter().filter(|r| r.1 == 1).map(|r| r.2 as u32).collect();
    let mut full_scores = vec![0f64; full_rows.len()];
    if !full_rows.is_empty() {
        crate::rescore::f64_dots(&st.full, dim, &st.query, &full_rows, &mut full_scores);
    }
    let mut out: Vec<f64> = Vec::with_capacity(st.rows.len() * 3);
    let mut fi = 0;
    for &(pos, flag, start, len) in &st.rows {
        match flag {
            0 => out.extend_from_slice(&[pos, 0.0, 0.0]),
            1 => {
                out.extend_from_slice(&[pos, 1.0, full_scores[fi]]);
                fi += 1;
            }
            _ => {
                let n = len.min(dim);
                if n == 0 {
                    out.extend_from_slice(&[pos, 2.0, 0.0]);
                } else {
                    let v = &st.other[start..start + len];
                    let mut d = 0f64;
                    for (&x, &y) in st.query[..n].iter().zip(&v[..n]) {
                        d += x * y as f64;
                    }
                    out.extend_from_slice(&[pos, 1.0, d]);
                }
            }
        }
    }
    result_blob(ctx, out.as_ptr() as *const c_void, (out.len() * 8) as c_int, SQLITE_TRANSIENT);
}

/// Extension entry point (`db.loadExtension(path, 'sqlite3_ssext_init')`).
///
/// # Safety
/// Called by SQLite with a valid connection and API table.
#[no_mangle]
pub unsafe extern "C" fn sqlite3_ssext_init(db: *mut c_void, _err: *mut *mut c_char, p_api: *const c_void) -> c_int {
    if p_api.is_null() {
        return SQLITE_ERROR;
    }
    API.store(p_api as *mut *const c_void, Ordering::Release);
    type CreateFunctionV2 = unsafe extern "C" fn(
        *mut c_void,
        *const c_char,
        c_int,
        c_int,
        *mut c_void,
        Option<StepFn>,
        Option<StepFn>,
        Option<FinalFn>,
        Option<unsafe extern "C" fn(*mut c_void)>,
    ) -> c_int;
    let create: CreateFunctionV2 = api(API_CREATE_FUNCTION_V2);
    let rc = create(db, c"ss_full_dots".as_ptr(), 3, SQLITE_UTF8 | SQLITE_DETERMINISTIC, std::ptr::null_mut(), None, Some(step), Some(finish), None);
    if rc == SQLITE_OK { SQLITE_OK } else { rc }
}
