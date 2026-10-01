//! Shell-cwd-aware path arguments. Mirrors core/search/cwd-paths.js.
//!
//! An agent that has run `cd okhttp/src/.../okhttp3` types `read Dispatcher.kt`
//! exactly as it would type `cat`. A relative path that exists relative to the
//! shell's cwd (and stays inside the project) means THAT file; otherwise it keeps
//! its old, project-root-relative meaning. The answer goes to the daemon as a
//! root-relative path, so every output path stays root-relative. Only this client
//! knows the shell's cwd: the shared daemon must never resolve against its own.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// `cwd` relative to `root`: `Some("")` at the root, `None` outside it. Symlinked
/// spellings of the same directory (macOS /tmp → /private/tmp) compare equal.
pub fn cwd_offset(cwd: &Path, root: &Path) -> Option<PathBuf> {
    let cwd = fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    cwd.strip_prefix(&root).ok().map(Path::to_path_buf)
}

/// Lexical normalisation of a relative path; `None` when it climbs above its start.
fn normalize_relative(p: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::Normal(seg) => out.push(seg),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

fn to_slash(p: &Path) -> String {
    let parts: Vec<String> = p
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.is_empty() {
        ".".to_string()
    } else {
        parts.join("/")
    }
}

/// Resolve one path argument cwd-first. Returns the root-relative spelling when
/// the cwd reading applies, else `p` unchanged (so at the root, outside the
/// project, or for an absolute path nothing changes).
pub fn resolve_cwd_path(p: &str, cwd: &Path, root: &Path) -> String {
    let path = Path::new(p);
    if p.is_empty() || path.is_absolute() {
        return p.to_string();
    }
    let offset = match cwd_offset(cwd, root) {
        Some(o) if !o.as_os_str().is_empty() => o,
        _ => return p.to_string(),
    };
    let candidate = match normalize_relative(&offset.join(path)) {
        Some(c) => c,
        None => return p.to_string(),
    };
    if root.join(&candidate).exists() {
        to_slash(&candidate)
    } else {
        p.to_string()
    }
}

/// The implicit scope of a `grep` run from a subdirectory of the project: that
/// subdirectory as an absolute path under `root`, or `None` at the root / outside.
/// Absolute, because a relative scope matches as a segment run anywhere in a path
/// (`src` would also admit `vendor/x/src/…`). Anchored at the root's REAL path: the
/// daemon accepts a scope under its root as spelled or under that root's real path,
/// not the reverse (a /private/tmp/x daemon drops every hit for /tmp/x/sub).
pub fn cwd_grep_scope(cwd: &Path, root: &Path) -> Option<String> {
    let offset = cwd_offset(cwd, root)?;
    if offset.as_os_str().is_empty() {
        return None;
    }
    let real_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    Some(real_root.join(offset).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "ss-cwd-paths-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            fs::create_dir_all(root.join("a/b")).unwrap();
            fs::write(root.join("a/b/Dispatcher.kt"), "x").unwrap();
            fs::write(root.join("README.md"), "root").unwrap();
            fs::write(root.join("a/b/README.md"), "sub").unwrap();
            Self { root }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn cwd_hit_becomes_root_relative() {
        let f = Fixture::new("hit");
        let cwd = f.root.join("a/b");
        assert_eq!(
            resolve_cwd_path("Dispatcher.kt", &cwd, &f.root),
            "a/b/Dispatcher.kt"
        );
        // cwd wins over a same-named file at the root, as in the shell
        assert_eq!(
            resolve_cwd_path("README.md", &cwd, &f.root),
            "a/b/README.md"
        );
        assert_eq!(
            resolve_cwd_path("./Dispatcher.kt", &cwd, &f.root),
            "a/b/Dispatcher.kt"
        );
        assert_eq!(
            resolve_cwd_path("../b/Dispatcher.kt", &cwd, &f.root),
            "a/b/Dispatcher.kt"
        );
        assert_eq!(resolve_cwd_path(".", &cwd, &f.root), "a/b");
    }

    #[test]
    fn root_relative_fallback_and_unchanged_cases() {
        let f = Fixture::new("fallback");
        let cwd = f.root.join("a/b");
        // not under cwd → keeps its root-relative meaning
        assert_eq!(
            resolve_cwd_path("a/b/Dispatcher.kt", &cwd, &f.root),
            "a/b/Dispatcher.kt"
        );
        assert_eq!(resolve_cwd_path("missing.rs", &cwd, &f.root), "missing.rs");
        // at the root: byte-identical
        assert_eq!(
            resolve_cwd_path("./README.md", &f.root, &f.root),
            "./README.md"
        );
        // escaping the project → unchanged
        assert_eq!(resolve_cwd_path("../../../x", &cwd, &f.root), "../../../x");
        // absolute → unchanged
        let abs = f.root.join("README.md").to_string_lossy().into_owned();
        assert_eq!(resolve_cwd_path(&abs, &cwd, &f.root), abs);
    }

    #[test]
    fn outside_the_project_nothing_changes() {
        let f = Fixture::new("outside");
        let other = Fixture::new("other");
        assert_eq!(
            resolve_cwd_path("README.md", &other.root, &f.root),
            "README.md"
        );
        assert_eq!(cwd_grep_scope(&other.root, &f.root), None);
    }

    #[test]
    fn grep_scope_only_below_the_root() {
        let f = Fixture::new("scope");
        assert_eq!(cwd_grep_scope(&f.root, &f.root), None);
        let scope = cwd_grep_scope(&f.root.join("a/b"), &f.root).unwrap();
        assert!(scope.ends_with("a/b"), "{scope}");
        assert!(Path::new(&scope).is_absolute());
    }

    #[test]
    fn grep_scope_is_anchored_at_the_real_root() {
        // macOS temp dirs live under /var → /private/var; a symlinked spelling of the root
        // must still yield a scope under the real path (the daemon's root spelling).
        let f = Fixture::new("realroot");
        let link = f.root.with_extension("link");
        let _ = fs::remove_file(&link);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&f.root, &link).unwrap();
        #[cfg(not(unix))]
        let link = f.root.clone();
        let real = fs::canonicalize(&f.root).unwrap();
        let scope = cwd_grep_scope(&link.join("a"), &link).unwrap();
        assert_eq!(Path::new(&scope), real.join("a"));
        let _ = fs::remove_file(&link);
    }
}
