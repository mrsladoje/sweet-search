//! ss-grep's output logic, ported from the JS tool so the daemon's native lane prints the
//! same bytes without running JS. Each module names the JS it mirrors; any change to that JS
//! must be made here too (the parity test compares the two).
//!
//! Pure logic only: the native search, the code graph and file reads come in through traits
//! the native addon implements.

pub mod jsstr;
pub mod types;
pub mod shaping;
pub mod render;
pub mod classes;
pub mod enrich;
pub mod args;
pub mod chain;
pub mod collate;
pub mod globs;
pub mod paths;
pub mod literals;
