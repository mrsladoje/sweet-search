# Sweet-search — code search tool guide

Use the NARROWEST index-backed tool that can answer; prefer sweet-search tools over raw grep/ripgrep and blind file reads. Fall back to plain grep/read only for unindexed edits or after indexed tools return nothing. The first call should usually be the last.

1. **Exact anchor** — a literal, error text, config key, path, or rare identifier → [[ss-grep]] with the rarest escaped regex. A single ranked hit answers it; do not re-search to confirm.
2. **Known symbol / class / method** → [[ss-find]] with a word-bounded regex `\b<symbol>\b`.
3. **Unknown behavior in prose** → [[ss-search]] with compact domain terms until a file or symbol appears.
4. **"How does this flow / call / dispatch / reach?"** once a symbol is known → [[ss-trace]] the symbol verbatim BEFORE reading adjacent files (in Python/Ruby/PHP prefer callers/callees over impact — impact is unreliable there).
5. **File known, span not** → [[ss-semantic]] on that file, querying the symbol alone.
6. **Confirm only** → [[ss-read]] a narrow range; never a whole file "to be safe" (every read stays in context and is re-billed each turn).

## Stopping — sufficiency, not exhaustion
One literal hit, one definition block, or one complete traced path is enough — do not corroborate every neighbouring file, and before each extra call state what NEW information it would add. If a search is empty, change tool family once rather than rephrasing the same query. After an exact-anchor pass AND a broad lexical [[ss-grep]] both come back empty, a negative is a complete answer — report [[no-match]] and stop.

## Output
Name the file(s) and symbol(s) and explain how they answer the query, or [[no-match]].
