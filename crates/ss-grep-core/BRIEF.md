# ss-grep-core porting brief

Goal: ss-grep's output logic in Rust, printing the SAME BYTES as the JS tool, so the search
daemon can answer `ss-grep` from a native thread without running JS. The JS stays the source
of truth and the fallback: the native lane DECLINES (returns None / an error the caller turns
into "let JS answer") any case it cannot reproduce exactly. A decline is always safe; a wrong
byte is never acceptable.

Repository root (JS sources): ../../ (core/search/*.js, eval/agent-read-workflows/bin/*.mjs).

## Hard rules for every port
1. Port the JS function by function, same names in snake_case, same argument order, same
   branch structure. Keep the JS comments' intent in short Rust comments. Put a line
   `// Mirrors: <js file>:<function>` above each ported function.
2. Strings: JS strings are UTF-16. Use `crate::jsstr` (`len16`, `slice16`, `trim_js`, ...) for
   every length, index, slice or trim. Never byte-index a `&str` that can hold non-ASCII.
3. Regexes: JS `/x/` without the `u` flag treats `\w \d \s \b` as ASCII-only (`\s` also
   matches the JS whitespace set). Rust `regex` is Unicode by default: write `(?-u:\w)` or
   explicit classes, and check `\s`. `/i` in JS is simple case folding. JS `String.prototype.replace`
   with a string pattern replaces only the first occurrence. When a JS regex cannot be
   reproduced exactly (lookbehind, backreferences), hand-code the matcher.
4. Numbers: JS numbers are f64. Integer math in the JS that stays below 2^53 can be u64/i64,
   but any division, sqrt or float comparison must use f64 with the same operation order.
   `x | 0` truncates to i32. `Math.round` rounds .5 up (toward +inf), unlike `f64::round`.
5. Sorting: `Array.prototype.sort` is stable; port comparators exactly. `a.localeCompare(b)` is
   NOT byte order: use `crate::collate::locale_compare` (module owned by agent C; until it
   exists, put a `todo!()`-free stub behind the same name in your copy only for compiling).
6. Maps/Sets keep insertion order in JS: use Vec + index maps, or `indexmap`-like logic; no
   HashMap iteration order may reach the output.
7. No `unwrap()` on data that comes from files or the engine; return `None` (decline) when an
   input is outside what you ported.
8. Tests: write a Node script under `fixtures-gen/<module>.mjs` that imports the JS functions
   directly (they are ES module exports; non-exported helpers can be reached through the
   exported caller) and writes fixtures (input + expected output) to `tests/fixtures/<module>/`.
   Use real inputs: `../../../corpus/<repo>.bare.jsonl` (one JSON object per bareGrep call:
   `{call, query, options, result}`; `result` has `results` (rows), `fileSummary`,
   `familyManifest`, `siblingLine`, `stats`) and `../../../corpus/<repo>.calls.jsonl`
   (`{seq,id,args,code,stdout}` per ss-grep call; the args are what the agent typed).
   Then add synthetic edge cases (non-ASCII, empty, huge counts, ties). Rust tests in
   `tests/<module>.rs` load the fixtures and assert byte equality. Keep committed fixtures
   small (< 1 MB per module; sample, do not dump everything).
9. Build in your OWN target dir: `CARGO_TARGET_DIR=<scratchpad>/target-<agent>`; never run
   the full JS test suite, benchmarks, daemons or `npm install`.

## Shared modules (do not edit; ask in your report if you need a change)
- `src/types.rs`: GrepRow, SummaryFile, HiddenFile, FileSummary (serde camelCase).
- `src/jsstr.rs`: UTF-16 helpers.
