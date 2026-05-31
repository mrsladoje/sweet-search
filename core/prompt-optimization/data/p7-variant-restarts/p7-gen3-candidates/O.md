# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for all code search and navigation — they are faster and cheaper. The index tracks the working tree, so uncommitted edits are already indexed; reach for raw `grep`/`find`/`cat`/`ls` or the native file reader only for a change too recent to be reconciled yet (a seconds-old edit). Never re-run an `ss-*` hit as raw grep to confirm it — the indexed result is authoritative. If you delegate code search to a sub-agent, instruct it to use these same `ss-*` tools.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only. [[ss-find]] is [[ss-grep]]'s regex plus a query that ranks the matches.
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [callers|callees|impact] [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Tool routing

### [[ss-search]] — default first call
Shape the query by the target file's language family, always containing the symbol verbatim: C-family (C/C++/Zig) medium interrogative; JS-mobile (JS/TS/Dart) short interrogative; Other (default) medium declarative plus a domain keyword. If symbol and file are both unknown, lead with domain terms and switch to symbol-anchored shaping once a candidate appears. When you already hold a copy-pasteable token (identifier, function/class/constant, error string, config key, or path), skip search-first and open with ONE [[ss-grep]] on that literal (rarest token, escaped) or [[ss-find]] `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`); trust the top hit and stop.

### [[ss-find]] — when the symbol is known and NL retrieval underperforms
Regex `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`); query short imperative + symbol, e.g. "find <Symbol> usage".

### [[ss-semantic]] — in-file span retrieval after the file is located
Query with the symbol alone, for span extraction in an already-identified file; not for behavioral or cross-file queries.

### [[ss-trace]] — structural context for a known symbol
Pass the symbol verbatim (never an NL question); one call returns callers, callees, and impact together. Add a relation word to re-weight, e.g. `ss-trace modelRouter callees`, or `--in <file>` to disambiguate. The call graph misses some bare top-level, macro, and dynamic-dispatch calls, so callees are the most reliable signal and impact the least — prefer callees over impact (especially Python/Ruby/PHP). If a trace is sparse or empty, don't retry it or hand-crawl — anchor the downstream symbol with [[ss-find]]/[[ss-search]].

### [[ss-grep]] / [[ss-read]]
[[ss-grep]] for exact literal patterns; [[ss-read]] to expand a narrow range, never a re-run of a matching hit.

## Multi-file flow
When [[ss-search]] surfaces a file that imports another module, follow the chain: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] a narrow range if needed — only while each hop yields a new fact. Stay inside the `ss-*` tools rather than dropping to raw `find`/`grep`/`cat`.

## Recovery on empty or weak results
On no relevant hits, do not retry a near-identical formulation. Escalate inside the indexed tools: switch query shape or regex, move to the next family (search → find → grep → read), or broaden the [[ss-grep]] pattern to a shorter substring or prefix.

## Confirming a feature is absent — this IS the answer, and it is cheap
On a query about a feature that may not exist, proving absence IS the deliverable, not a failed search to keep working around. The proof is small and fixed: ONE [[ss-search]] in natural language for the behavior plus ONE broad [[ss-grep]] on its likeliest identifier (a short substring/prefix). Once BOTH come back empty for the same concept, the feature is absent — report it and stop.

Two pressures will tempt you to keep going; resist both. First, a semantic search often returns plausible, adjacent code (a dispatcher, a scheduler, a similarly-named helper) — that is the DECOY the query was built around; its presence is itself evidence the real feature is missing, not a thread to pull. Second, you cannot prove absence more thoroughly by hand: the index already covers every committed file, so a raw `find`/`ls`/`cat` or native scan searches the exact same corpus your two `ss-*` probes just did and only returns the same empty result at higher cost. After two empty complementary index probes, a third synonym or raw enumeration adds nothing — emit [[no-match]] instead.

## Stateful summary rule
Before your third sweet-search probe in the current search iteration — or before your final answer, whichever comes first — you MUST output a `<state_summary>` block with exactly: (1) one sentence on what you've established, (2) one sentence on your current blind spot.

## Stopping
Stop the instant your evidence answers what you're looking for — a single confirmed file+symbol is sufficient; gather no corroboration you were not asked for. Conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) and explain how they answer what you need, or [[no-match]].
