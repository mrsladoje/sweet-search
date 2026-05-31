# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for code search, navigation, or discovery — they are faster and cheaper. The index tracks the working tree, so uncommitted edits are already indexed; fall back to raw grep/read only for an edit so recent the index hasn't reconciled it (seconds old). Never re-run an `ss-*` hit as raw grep to confirm it. If you delegate code search to a sub-agent, tell it to use these same `ss-*` tools.

## Calling the tools
Invoke via Bash. `[[ss-search]]`/`[[ss-find]]` return ranked code blocks; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [callers|callees|impact] [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Tool routing

### [[ss-search]] — default first call
Shape the query by the target file's language family, always containing the symbol verbatim:
- **C-family (C / C++ / Zig):** medium interrogative.
- **JS-mobile (JS / TS / Dart):** short interrogative.
- **Other (default):** medium declarative plus a domain keyword.

If symbol and file are both unknown, lead with domain terms and switch to symbol-anchored shaping once a candidate appears.

**Exception — you already hold an exact token.** When you hold something copy-pasteable (identifier, function/class/constant, error string, config key, or path), skip search-first; open with ONE [[ss-grep]] on that literal (rarest token, escaped) or [[ss-find]] `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`). The top hit is normally the answer: trust it and stop — no [[ss-search]] first, no confirming re-search. Behavioral/concept queries with no exact token still go search-first.

### [[ss-find]] — when the symbol is known and NL retrieval underperforms
[[ss-find]] is [[ss-grep]]'s regex plus a query that ranks the matches. Regex `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`); query short imperative + symbol, e.g. "find <Symbol> usage".

### [[ss-semantic]] — in-file span retrieval after the file is located
Query with the symbol alone, for span extraction in an already-identified file; not for behavioral or cross-file queries.

### [[ss-trace]] — structural context for a known symbol
Pass the symbol verbatim (never an NL question); one call returns callers, callees, and impact together. Add a relation word to re-weight, e.g. `ss-trace modelRouter callees` or `ss-trace handleRequest callers --in lib/handle-request.js`. The call graph captures method-style calls best and misses some bare top-level, macro, and dynamic-dispatch calls, so callees are the most reliable signal and impact the least — prefer callees over impact (especially in Python/Ruby/PHP). If a trace comes back sparse or empty, don't retry it or hand-crawl — anchor the downstream symbol directly with [[ss-find]]/[[ss-search]].

### [[ss-grep]] / [[ss-read]]
[[ss-grep]] for exact literal patterns; [[ss-read]] to expand a narrow range, never a re-run of a matching hit.

## Recovery on empty or weak results
On no relevant hits, do not retry a near-identical formulation, and do NOT fall back to raw `find`/`grep`/`cat`/`ls` or the native file reader — the index already covers every committed file, so a raw scan just repeats the same empty search and is the main no-match cost trap. Escalate inside the indexed tools: switch query shape or regex, move to the next family (search → find → grep → read), or broaden the [[ss-grep]] pattern to a prefix.

## Multi-file flow
When [[ss-search]] surfaces a file that imports another module, follow the chain: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] if needed — only while each hop yields progress.

## Confirming a feature is absent (the cheapest decisive route)
A negative result is itself a complete answer, not a failure to keep working around. Absence is established once TWO complementary index-backed probes both return empty for the SAME concept: (a) one [[ss-search]] in natural language for the behavior, and (b) one broad [[ss-grep]] on its most likely identifier (a short substring/prefix). These two are conclusive even if a semantic search returned plausible-but-off-target hits — that is the decoy, not the feature; do not chase it. State the negative and stop — do NOT widen to a third synonym, more file reads, or a native scan; the index covers every committed file.

## Stateful summary rule
Before your third sweet-search query in the current search iteration — or before your final answer, whichever comes first — you MUST output a `<state_summary>` block with exactly: (1) one sentence on what you've established so far, (2) one sentence on your current blind spot or open question.

## Stopping
Stop the instant your evidence answers what you're looking for — one confirmed file+symbol is sufficient; do not gather corroboration you were not asked for, or conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) involved and explain how they answer what you need, or [[no-match]].
