//! Rust side of the CoreML Objective-C shim.
//!
//! Declares the `extern "C"` signatures matching `coreml_shim.m`'s public
//! ABI and wraps them in a safe `CoremlModel` struct that takes care of:
//!   - String marshalling (`CString` for paths / feature names)
//!   - Error buffer handling (fixed 512-byte buffer for UTF-8 messages)
//!   - Drop-based cleanup via `sweet_coreml_free`
//!   - Send + Sync (the shim is safe under the existing process-wide
//!     metal_lock and the underlying `MLModel` is documented thread-safe
//!     for synchronous prediction)
//!
//! The shim is ONLY available when the `coreml` Cargo feature is on.
//! That feature is gated behind `metal`, so this module is compiled on
//! macOS only — elsewhere the whole file is cfg'd out.

#![cfg(feature = "coreml")]

use std::ffi::{c_char, c_int, c_long, CString};
use std::path::Path;
use std::ptr::NonNull;
use std::sync::Mutex;

/// Opaque handle into the Objective-C shim. Layout is defined in the
/// .m file and Rust never inspects its contents — we only hold the
/// pointer so we can pass it back to the shim's predict / free calls.
#[repr(C)]
pub struct CoremlHandle {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn sweet_coreml_load(
        mlpackage_path: *const c_char,
        input_name_ids: *const c_char,
        input_name_mask: *const c_char,
        output_name: *const c_char,
        batch: c_long,
        seq: c_long,
        output_dim0: c_long,
        output_dim1: c_long,
        error_out: *mut c_char,
        error_out_len: usize,
    ) -> *mut CoremlHandle;

    fn sweet_coreml_predict(
        handle: *mut CoremlHandle,
        ids_data: *const i32,
        mask_data: *const i32,
        output_data: *mut f32,
        error_out: *mut c_char,
        error_out_len: usize,
    ) -> c_int;

    fn sweet_coreml_free(handle: *mut CoremlHandle);
}

const ERR_BUF_LEN: usize = 512;

/// Drain an error buffer into a `String`, skipping to the first NUL
/// byte. The shim writes NUL-terminated UTF-8 on error paths; we
/// tolerate non-UTF-8 (the shim's error messages are English and
/// machine-generated, so this is defensive).
fn read_error(buf: &[u8]) -> String {
    let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..len]).into_owned()
}

/// Safe wrapper around a loaded CoreML model. Holds the shim handle and
/// the output element count (so we can size the destination buffer on
/// each predict call). Drops the underlying Obj-C model on Drop.
///
/// Thread safety: MLModel's synchronous `predictionFromFeatures:error:`
/// is NOT thread-safe for concurrent calls on the same model instance
/// (per Apple's WWDC23 Core ML session — only the async variant is
/// explicitly safe). We serialise sync calls per-model with an internal
/// Mutex<()> so that multiple napi AsyncTasks can share the same
/// CoremlModel instance without racing inside the Obj-C shim. The
/// Mutex overhead is a few ns per call — negligible next to the
/// ~1-second GPU compute time of each prediction.
pub struct CoremlModel {
    handle: NonNull<CoremlHandle>,
    predict_lock: Mutex<()>,
    batch: usize,
    seq: usize,
    output_elements: usize,
}

// Safe because:
//   - predict() takes the internal Mutex before calling the shim, so
//     concurrent calls from multiple threads are serialised.
//   - load() and the Drop impl are never called from multiple threads
//     simultaneously on the same instance (enforced by Rust's ownership).
//   - CoremlHandle is heap-allocated by the shim; the pointer we hold is
//     owned by this struct alone.
unsafe impl Send for CoremlModel {}
unsafe impl Sync for CoremlModel {}

impl CoremlModel {
    /// Load a .mlpackage, pinning compute_units to CPU_AND_NE.
    ///
    /// # Arguments
    /// * `mlpackage_path` — filesystem path to the .mlpackage directory
    /// * `input_name_ids` — name of the int32 input_ids feature in the model
    /// * `input_name_mask` — name of the int32 attention_mask feature in the model
    /// * `output_name` — name of the float32 output feature to extract
    /// * `batch`, `seq` — fixed shape the .mlpackage was traced at
    /// * `output_dim0` — for embed: hidden_size (e.g. 768); for LI: seq length
    /// * `output_dim1` — for embed: 0 (output is 2D); for LI: token_dim (e.g. 128)
    pub fn load(
        mlpackage_path: &Path,
        input_name_ids: &str,
        input_name_mask: &str,
        output_name: &str,
        batch: usize,
        seq: usize,
        output_dim0: usize,
        output_dim1: usize,
    ) -> Result<Self, String> {
        let path = mlpackage_path
            .to_str()
            .ok_or_else(|| format!("mlpackage path is not valid UTF-8: {:?}", mlpackage_path))?;
        let c_path = CString::new(path).map_err(|e| format!("path contains NUL: {e}"))?;
        let c_ids = CString::new(input_name_ids)
            .map_err(|e| format!("input_ids name contains NUL: {e}"))?;
        let c_mask = CString::new(input_name_mask)
            .map_err(|e| format!("attention_mask name contains NUL: {e}"))?;
        let c_out =
            CString::new(output_name).map_err(|e| format!("output name contains NUL: {e}"))?;

        let mut err_buf = [0u8; ERR_BUF_LEN];
        let handle = unsafe {
            sweet_coreml_load(
                c_path.as_ptr(),
                c_ids.as_ptr(),
                c_mask.as_ptr(),
                c_out.as_ptr(),
                batch as c_long,
                seq as c_long,
                output_dim0 as c_long,
                output_dim1 as c_long,
                err_buf.as_mut_ptr() as *mut c_char,
                ERR_BUF_LEN,
            )
        };
        let handle = NonNull::new(handle).ok_or_else(|| read_error(&err_buf))?;

        let output_elements = if output_dim1 > 0 {
            batch * output_dim0 * output_dim1
        } else {
            batch * output_dim0
        };

        Ok(Self {
            handle,
            predict_lock: Mutex::new(()),
            batch,
            seq,
            output_elements,
        })
    }

    /// Run one prediction. Fills `output` with exactly `output_elements`
    /// float32 values. Input slices must have exactly `batch * seq`
    /// int32 values each.
    pub fn predict(
        &self,
        input_ids: &[i32],
        attention_mask: &[i32],
        output: &mut [f32],
    ) -> Result<(), String> {
        let expected_in = self.batch * self.seq;
        if input_ids.len() != expected_in {
            return Err(format!(
                "input_ids length mismatch: expected {}, got {}",
                expected_in,
                input_ids.len()
            ));
        }
        if attention_mask.len() != expected_in {
            return Err(format!(
                "attention_mask length mismatch: expected {}, got {}",
                expected_in,
                attention_mask.len()
            ));
        }
        if output.len() != self.output_elements {
            return Err(format!(
                "output length mismatch: expected {}, got {}",
                self.output_elements,
                output.len()
            ));
        }

        let mut err_buf = [0u8; ERR_BUF_LEN];
        let rc = {
            // Serialise sync predictions per-model. Concurrent calls on
            // the same MLModel are not safe — see the comment on
            // CoremlModel above.
            let _guard = self
                .predict_lock
                .lock()
                .map_err(|e| format!("predict_lock poisoned: {e}"))?;
            unsafe {
                sweet_coreml_predict(
                    self.handle.as_ptr(),
                    input_ids.as_ptr(),
                    attention_mask.as_ptr(),
                    output.as_mut_ptr(),
                    err_buf.as_mut_ptr() as *mut c_char,
                    ERR_BUF_LEN,
                )
            }
        };
        if rc != 0 {
            return Err(format!("[coreml_shim rc={}] {}", rc, read_error(&err_buf)));
        }
        Ok(())
    }

    pub fn batch(&self) -> usize {
        self.batch
    }

    pub fn seq(&self) -> usize {
        self.seq
    }

    pub fn output_elements(&self) -> usize {
        self.output_elements
    }
}

impl Drop for CoremlModel {
    fn drop(&mut self) {
        unsafe {
            sweet_coreml_free(self.handle.as_ptr());
        }
    }
}
