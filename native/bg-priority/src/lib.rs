//! sweet-search-bg-priority — optional napi-rs addon (research §4.A A.5/A.6).
//!
//! Exposes a single function, `setBackgroundMode(enable)`, that demotes the
//! **calling** process/thread to OS background scheduling and (on `false`)
//! restores it. This is the native refinement of the JS-fallback levers wired
//! in `core/indexing/os-priority.mjs`:
//!
//!   - **Windows (A.5):** `SetPriorityClass(GetCurrentProcess(),
//!     PROCESS_MODE_BACKGROUND_BEGIN | _END)`. Unlike `os.setPriority`
//!     (CPU-only `IDLE_PRIORITY_CLASS`), the background mode demotes CPU **+ I/O
//!     + memory priority** together — exactly what Windows Search does — and is
//!     the only way to get the I/O + memory demotion from Node. ⚠️ It also
//!     empties the working set, so the caller should only enter background mode
//!     during bulk/idle phases and call `END` before serving latency-sensitive
//!     work (see os-priority.mjs `setNativeBackgroundMode`).
//!
//!   - **macOS (A.6):** `pthread_set_qos_class_self_np(QOS_CLASS_BACKGROUND, 0)`
//!     for the **calling thread only**. This is the modern per-thread form;
//!     ORT spins up its OWN worker threads which do NOT inherit it, so this
//!     covers only threads that call it. The process-level lever
//!     (`taskpolicy -b`, G5) remains the primary mechanism. ⚠️ NEVER mix raw
//!     `setpriority`/`taskpolicy` with QoS on the same thread — doing so
//!     permanently opts that thread out of QoS. On `false` we restore to
//!     `QOS_CLASS_DEFAULT`.
//!
//!   - **Other platforms (Linux/etc.):** no-op here; the spawn-based
//!     `ionice`/`chrt` levers in os-priority.mjs cover Linux. Returns `false`
//!     to signal "not applied natively" so the caller keeps its fallback.
//!
//! The function is infallible at the napi boundary (returns a bool: `true` if a
//! native demotion was applied, `false` if this platform has no native lever).
//! Any underlying syscall failure is treated as "not applied" (`false`), never a
//! throw — demotion is an optimization, not a correctness requirement.

#![cfg_attr(
    not(any(windows, target_os = "macos")),
    allow(unused_variables)
)]

use napi_derive::napi;

/// Enter (`enable = true`) or leave (`enable = false`) OS background mode for
/// the **calling** process/thread.
///
/// Returns `true` when a native demotion/restoration was actually applied on
/// this platform, `false` when this platform has no native lever (the JS
/// fallback in os-priority.mjs then stays responsible). Never throws.
#[napi]
pub fn set_background_mode(enable: bool) -> bool {
    set_background_mode_impl(enable)
}

// ---------------------------------------------------------------------------
// Windows: process-level PROCESS_MODE_BACKGROUND_BEGIN / _END.
// ---------------------------------------------------------------------------
#[cfg(windows)]
fn set_background_mode_impl(enable: bool) -> bool {
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, SetPriorityClass, PROCESS_MODE_BACKGROUND_BEGIN,
        PROCESS_MODE_BACKGROUND_END,
    };

    // SAFETY: GetCurrentProcess returns a pseudo-handle that needs no close;
    // SetPriorityClass is a simple FFI call with no memory ownership transfer.
    unsafe {
        let handle = GetCurrentProcess();
        let class = if enable {
            PROCESS_MODE_BACKGROUND_BEGIN
        } else {
            PROCESS_MODE_BACKGROUND_END
        };
        // Returns 0 on failure (e.g. END when not in background mode); treat any
        // failure as "not applied" rather than an error — best-effort.
        SetPriorityClass(handle, class) != 0
    }
}

// ---------------------------------------------------------------------------
// macOS: per-thread QOS_CLASS_BACKGROUND / restore to DEFAULT.
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
fn set_background_mode_impl(enable: bool) -> bool {
    // qos_class_t values from <sys/qos.h>. Declared here to avoid depending on
    // libc's optional macOS qos bindings across versions.
    const QOS_CLASS_DEFAULT: libc::c_uint = 0x15; // 21
    const QOS_CLASS_BACKGROUND: libc::c_uint = 0x09; // 9

    extern "C" {
        // int pthread_set_qos_class_self_np(qos_class_t qos_class,
        //                                   int relative_priority);
        fn pthread_set_qos_class_self_np(
            qos_class: libc::c_uint,
            relative_priority: libc::c_int,
        ) -> libc::c_int;
    }

    let target = if enable {
        QOS_CLASS_BACKGROUND
    } else {
        QOS_CLASS_DEFAULT
    };

    // SAFETY: plain FFI to libSystem; no pointers, no ownership. Returns 0 on
    // success. Treat any non-zero as "not applied" — best-effort.
    let rc = unsafe { pthread_set_qos_class_self_np(target, 0) };
    rc == 0
}

// ---------------------------------------------------------------------------
// Everything else (Linux/FreeBSD/...): no native lever here.
// ---------------------------------------------------------------------------
#[cfg(not(any(windows, target_os = "macos")))]
fn set_background_mode_impl(_enable: bool) -> bool {
    // Linux uses the spawn-based ionice/chrt fallback in os-priority.mjs.
    false
}
