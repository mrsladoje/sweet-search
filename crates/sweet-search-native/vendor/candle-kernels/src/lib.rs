use std::sync::atomic::{AtomicU32, Ordering};

mod ptx {
    include!(concat!(env!("OUT_DIR"), "/ptx.rs"));
}

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Id {
    Affine,
    Binary,
    Cast,
    Conv,
    Fill,
    Indexing,
    Quantized,
    Reduce,
    Sort,
    Ternary,
    Unary,
}

pub const ALL_IDS: [Id; 11] = [
    Id::Affine,
    Id::Binary,
    Id::Cast,
    Id::Conv,
    Id::Fill,
    Id::Indexing,
    Id::Quantized,
    Id::Reduce,
    Id::Sort,
    Id::Ternary,
    Id::Unary,
];

pub struct Module {
    index: usize,
    ptx: &'static str,
    ptx_low: &'static str,
}

/// sweet-search patch: compute capability x 10 of the device this process
/// runs on, set by `select_compute_capability` before the first kernel
/// loads. 0 = not set (the HIGH set, upstream behaviour).
static SELECTED_CAP: AtomicU32 = AtomicU32::new(0);

/// Lowest compute capability (x 10) the HIGH and LOW PTX sets run on.
pub use ptx::{HIGH_PTX_CAP, LOW_PTX_CAP};

/// Choose the PTX set for a device of compute capability `cap_x10`
/// (86 for sm_86). Devices below HIGH_PTX_CAP get the LOW set. Call before
/// any kernel loads; candle caches loaded modules per device.
pub fn select_compute_capability(cap_x10: u32) {
    SELECTED_CAP.store(cap_x10, Ordering::Relaxed);
}

/// True when kernels will load from the LOW (compute_70) set.
pub fn uses_low_ptx() -> bool {
    let cap = SELECTED_CAP.load(Ordering::Relaxed);
    cap != 0 && cap < HIGH_PTX_CAP
}

impl Module {
    pub fn index(&self) -> usize {
        self.index
    }

    pub fn ptx(&self) -> &'static str {
        if uses_low_ptx() {
            self.ptx_low
        } else {
            self.ptx
        }
    }
}

const fn module_index(id: Id) -> usize {
    let mut i = 0;
    while i < ALL_IDS.len() {
        if ALL_IDS[i] as u32 == id as u32 {
            return i;
        }
        i += 1;
    }
    panic!("id not found")
}

macro_rules! mdl {
    ($cst:ident, $low:ident, $id:ident) => {
        pub const $cst: Module = Module {
            index: module_index(Id::$id),
            ptx: ptx::$cst,
            ptx_low: ptx::$low,
        };
    };
}

mdl!(AFFINE, AFFINE_LOW, Affine);
mdl!(BINARY, BINARY_LOW, Binary);
mdl!(CAST, CAST_LOW, Cast);
mdl!(CONV, CONV_LOW, Conv);
mdl!(FILL, FILL_LOW, Fill);
mdl!(INDEXING, INDEXING_LOW, Indexing);
mdl!(QUANTIZED, QUANTIZED_LOW, Quantized);
mdl!(REDUCE, REDUCE_LOW, Reduce);
mdl!(SORT, SORT_LOW, Sort);
mdl!(TERNARY, TERNARY_LOW, Ternary);
mdl!(UNARY, UNARY_LOW, Unary);

pub mod ffi;
