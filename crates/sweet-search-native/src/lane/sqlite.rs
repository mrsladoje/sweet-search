//! Read-only SQLite access for the lane through the API table of the SQLite library the
//! process already loaded (better-sqlite3's, registered by loading this addon as an extension;
//! sqlite_ext.rs). A second SQLite copy in one process can break POSIX file locking, so the
//! lane never links its own.

use crate::sqlite_ext::{api, api_ready};
use std::ffi::{c_char, c_int, c_void, CStr, CString};

// Field positions in sqlite3_api_routines (sqlite3ext.h; the table is append-only).
const API_BIND_INT64: usize = 5;
const API_BIND_TEXT: usize = 10;
const API_CLOSE: usize = 16;
const API_COLUMN_BYTES: usize = 20;
const API_COLUMN_COUNT: usize = 22;
const API_COLUMN_INT64: usize = 29;
const API_COLUMN_TEXT: usize = 36;
const API_COLUMN_TYPE: usize = 38;
const API_FINALIZE: usize = 57;
const API_RESET: usize = 77;
const API_STEP: usize = 94;
const API_PREPARE_V2: usize = 116;
const API_CLEAR_BINDINGS: usize = 118;
const API_OPEN_V2: usize = 135;

const SQLITE_OK: c_int = 0;
const SQLITE_ROW: c_int = 100;
const SQLITE_DONE: c_int = 101;
const SQLITE_NULL: c_int = 5;
const SQLITE_OPEN_READONLY: c_int = 0x0000_0001;
const SQLITE_TRANSIENT: isize = -1;

pub(crate) struct Db {
    handle: *mut c_void,
    cache: std::collections::HashMap<String, *mut c_void>,
}

// The lane uses a connection from one thread at a time (behind its mutex); SQLite is built
// with SQLITE_THREADSAFE=2 (one connection per thread at a time).
unsafe impl Send for Db {}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Val {
    Null,
    Int(i64),
    Text(String),
}

impl Val {
    pub fn int(&self) -> Option<i64> {
        match self {
            Val::Int(i) => Some(*i),
            _ => None,
        }
    }
    pub fn text(&self) -> Option<&str> {
        match self {
            Val::Text(s) => Some(s),
            _ => None,
        }
    }
}

pub(crate) enum Arg<'a> {
    Int(i64),
    Text(&'a str),
}

impl Db {
    /// Open `path` read-only; None when the API is not registered or the open fails.
    pub fn open_readonly(path: &str) -> Option<Db> {
        if !api_ready() {
            return None;
        }
        let c = CString::new(path).ok()?;
        let mut handle: *mut c_void = std::ptr::null_mut();
        type OpenV2 = unsafe extern "C" fn(*const c_char, *mut *mut c_void, c_int, *const c_char) -> c_int;
        let rc = unsafe { api::<OpenV2>(API_OPEN_V2)(c.as_ptr(), &mut handle, SQLITE_OPEN_READONLY, std::ptr::null()) };
        if rc != SQLITE_OK {
            if !handle.is_null() {
                unsafe { api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_CLOSE)(handle) };
            }
            return None;
        }
        let db = Db { handle, cache: Default::default() };
        // The JS connections' read pragmas (db-utils.js applyReadPragmas): speed only.
        let _ = db_exec(&db, "PRAGMA mmap_size = 268435456");
        let _ = db_exec(&db, "PRAGMA cache_size = -20000");
        Some(db)
    }

    fn stmt(&mut self, sql: &str) -> Option<*mut c_void> {
        if let Some(s) = self.cache.get(sql) {
            return Some(*s);
        }
        let c = CString::new(sql).ok()?;
        let mut stmt: *mut c_void = std::ptr::null_mut();
        type PrepareV2 = unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *mut *mut c_void, *mut *const c_char) -> c_int;
        let rc = unsafe { api::<PrepareV2>(API_PREPARE_V2)(self.handle, c.as_ptr(), -1, &mut stmt, std::ptr::null_mut()) };
        if rc != SQLITE_OK || stmt.is_null() {
            return None;
        }
        self.cache.insert(sql.to_string(), stmt);
        Some(stmt)
    }

    /// Every row of `sql` with `args` bound in order; None on any SQLite error.
    pub fn query(&mut self, sql: &str, args: &[Arg]) -> Option<Vec<Vec<Val>>> {
        let stmt = self.stmt(sql)?;
        unsafe {
            api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_RESET)(stmt);
            api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_CLEAR_BINDINGS)(stmt);
            for (i, a) in args.iter().enumerate() {
                let idx = (i + 1) as c_int;
                let rc = match a {
                    Arg::Int(v) => api::<unsafe extern "C" fn(*mut c_void, c_int, i64) -> c_int>(API_BIND_INT64)(stmt, idx, *v),
                    Arg::Text(s) => api::<unsafe extern "C" fn(*mut c_void, c_int, *const c_char, c_int, isize) -> c_int>(API_BIND_TEXT)(
                        stmt,
                        idx,
                        s.as_ptr() as *const c_char,
                        s.len() as c_int,
                        SQLITE_TRANSIENT,
                    ),
                };
                if rc != SQLITE_OK {
                    return None;
                }
            }
            let ncol = api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_COLUMN_COUNT)(stmt);
            let step = api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_STEP);
            let col_type = api::<unsafe extern "C" fn(*mut c_void, c_int) -> c_int>(API_COLUMN_TYPE);
            let col_int = api::<unsafe extern "C" fn(*mut c_void, c_int) -> i64>(API_COLUMN_INT64);
            let col_text = api::<unsafe extern "C" fn(*mut c_void, c_int) -> *const u8>(API_COLUMN_TEXT);
            let col_bytes = api::<unsafe extern "C" fn(*mut c_void, c_int) -> c_int>(API_COLUMN_BYTES);
            let mut rows = Vec::new();
            loop {
                match step(stmt) {
                    SQLITE_ROW => {
                        let mut row = Vec::with_capacity(ncol as usize);
                        for c in 0..ncol {
                            let t = col_type(stmt, c);
                            row.push(match t {
                                SQLITE_NULL => Val::Null,
                                1 => Val::Int(col_int(stmt, c)),
                                3 => {
                                    let p = col_text(stmt, c);
                                    let n = col_bytes(stmt, c).max(0) as usize;
                                    let bytes = if p.is_null() { &[][..] } else { std::slice::from_raw_parts(p, n) };
                                    Val::Text(String::from_utf8_lossy(bytes).into_owned())
                                }
                                // REAL and BLOB columns are not read by the lane's queries.
                                _ => return None,
                            });
                        }
                        rows.push(row);
                    }
                    SQLITE_DONE => break,
                    _ => return None,
                }
            }
            api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_RESET)(stmt);
            Some(rows)
        }
    }

    /// The first column of the first row.
    pub fn scalar(&mut self, sql: &str, args: &[Arg]) -> Option<Val> {
        self.query(sql, args)?.into_iter().next()?.into_iter().next()
    }
}

fn db_exec(db: &Db, sql: &str) -> Option<()> {
    let c = CString::new(sql).ok()?;
    let mut stmt: *mut c_void = std::ptr::null_mut();
    type PrepareV2 = unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *mut *mut c_void, *mut *const c_char) -> c_int;
    unsafe {
        if api::<PrepareV2>(API_PREPARE_V2)(db.handle, c.as_ptr(), -1, &mut stmt, std::ptr::null_mut()) != SQLITE_OK {
            return None;
        }
        while api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_STEP)(stmt) == SQLITE_ROW {}
        api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_FINALIZE)(stmt);
    }
    Some(())
}

impl Drop for Db {
    fn drop(&mut self) {
        unsafe {
            for (_, s) in self.cache.drain() {
                api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_FINALIZE)(s);
            }
            api::<unsafe extern "C" fn(*mut c_void) -> c_int>(API_CLOSE)(self.handle);
        }
    }
}

#[allow(dead_code)]
fn errmsg(db: &Db) -> String {
    const API_ERRMSG: usize = 53;
    unsafe {
        let p = api::<unsafe extern "C" fn(*mut c_void) -> *const c_char>(API_ERRMSG)(db.handle);
        if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
    }
}
