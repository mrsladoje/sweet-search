//! SQLite loadable-extension entry point of the addon.
//!
//! better-sqlite3 loads this addon into its own connection
//! (`db.loadExtension(addonPath, 'sqlite3_ssext_init')`, core/search/
//! grep-lane.js). The entry point only records the extension API table
//! (`sqlite3_api_routines`, an append-only ABI of function pointers), so the
//! native grep lane opens its connections through the one SQLite library the
//! process already uses; a second SQLite copy in the same process can break
//! POSIX file locking.

use std::ffi::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicPtr, Ordering};

const SQLITE_OK: c_int = 0;
const SQLITE_ERROR: c_int = 1;

static API: AtomicPtr<*const c_void> = AtomicPtr::new(std::ptr::null_mut());

/// True once SQLite has loaded this extension into some connection: the API table of the
/// process's SQLite library is then known (the native grep lane opens its own connections
/// through it, never through a second SQLite copy).
pub(crate) fn api_ready() -> bool {
    !API.load(Ordering::Acquire).is_null()
}

#[inline(always)]
pub(crate) unsafe fn api<T: Copy>(index: usize) -> T {
    let table = API.load(Ordering::Acquire) as *const *const c_void;
    std::mem::transmute_copy::<*const c_void, T>(&*table.add(index))
}

/// Extension entry point (`db.loadExtension(path, 'sqlite3_ssext_init')`).
///
/// # Safety
/// Called by SQLite with a valid connection and API table.
#[no_mangle]
pub unsafe extern "C" fn sqlite3_ssext_init(_db: *mut c_void, _err: *mut *mut c_char, p_api: *const c_void) -> c_int {
    if p_api.is_null() {
        return SQLITE_ERROR;
    }
    API.store(p_api as *mut *const c_void, Ordering::Release);
    SQLITE_OK
}
