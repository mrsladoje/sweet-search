# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for any code search, navigation, or discovery — they are faster and semantic. Fall back to plain grep/read only for changes not yet indexed (e.g. uncommitted edits) or when these tools return nothing. Route by tool priority with family-conditioned query shaping, and chain tools for multi-file flows.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Tool routing

### [[ss-search]] — default first call
Shape the query by the target file's language family:
- **C-family (C / C++ / Zig):** medium interrogative query containing the symbol verbatim.
- **JS-mobile (JS / TS / Dart):** short interrogative query containing the symbol verbatim.
- **Other (default):** medium declarative query containing the symbol verbatim plus a domain keyword.

If the target symbol or file is unknown, lead with domain terms (Default shaping) and switch to symbol-anchored shaping once a candidate symbol appears.

### [[ss-find]] — when the symbol is known and NL retrieval underperforms
- **JS-mobile:** definition-anchored regex `\b<keyword>\s+<symbol>\b` (language keyword + symbol); query short interrogative + symbol.
- **Other (default):** word-bounded regex `\b<symbol>\b`; query short imperative + symbol, e.g. "find <Symbol> usage".

### [[ss-semantic]] — in-file span retrieval after the file is located
Query with the symbol alone. Reserve for span extraction in an already-identified file; not for behavioral or cross-file queries.

### [[ss-trace]] — structural context for a known symbol
Pass the symbol verbatim (never an NL question) for callers, callees, and impact in one call. Add `--in <file>` when the symbol is ambiguous across files. In Python/Ruby/PHP, prefer callers/callees over impact — impact is unreliable there.

### [[ss-grep]] / [[ss-read]]
[[ss-grep]] for exact literal patterns; [[ss-read]] to confirm or expand context on a file.

## Recovery on empty or weak results
If a query returns no relevant hits, do not retry a near-identical formulation. Escalate by switching query shape or regex, moving to the next-priority tool family (search → find → grep → read), or broadening the grep pattern to a substring or prefix.

## Multi-file flow
When [[ss-search]] surfaces a file that imports another module, follow the chain: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] if needed. Follow the chain only while each hop yields progress.

## Confirming a feature is absent (the cheapest decisive route)
A negative result is itself a complete answer — a destination, not a failure to keep working around. Absence is established once TWO complementary index-backed probes both return empty for the SAME concept: (a) one [[ss-search]] in natural language for the behavior, and (b) one broad [[ss-grep]] on its most likely identifier or string (a short substring/prefix, not a precise regex). Then state the negative and stop — do NOT widen to a third synonym, more file reads, or a native scan; the index covers every committed file, so two empty complementary probes are conclusive.

## Stateful summary rule
Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop the instant your current evidence already answers the query — a single confirmed file+symbol is sufficient; do not gather corroboration you were not asked for. If an attempt fails, change approach rather than repeating a near-identical query. Conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
