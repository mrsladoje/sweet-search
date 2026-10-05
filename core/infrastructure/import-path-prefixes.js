/**
 * Prefixes of `relationships.full_import_path` values that name no repo file.
 *
 * The graph extractor writes them, the resolver skips them, and the structural
 * repository and search read them, so the convention lives below all three
 * (graph/import-resolver.js re-exports it as part of its API).
 */

/**
 * `full_import_path` value for an import whose module is not a repo file
 * (package, stdlib, unresolvable alias). Name-based resolution skips these.
 */
export const UNRESOLVED_IMPORT_PREFIX = 'unresolved:';
// Go package-qualified calls (`x.Parse()`): full_import_path = `gopkg:<repo dir>/`
// (`gopkg:` for a module root at the repo root). See resolveGoPackageCall.
export const GO_PACKAGE_PREFIX = 'gopkg:';
// Rust path calls into a repo module (`serde_json::from_str()`, `crate::x::f()`):
// full_import_path = `rustpath:<module file>|<crate source dir>/[|<name before a use-as rename>]`. See
// resolveRustPathCall.
export const RUST_PATH_PREFIX = 'rustpath:';
