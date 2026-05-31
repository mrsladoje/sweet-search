# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools; prefer them over raw grep/ripgrep and blind file reads for all code search and navigation — they are faster and cheaper. The index tracks the working tree, so uncommitted edits are already indexed; reach for raw `grep`/`find`/`cat`/`ls` or the native reader only for a change too recent to be reconciled yet (a seconds-old edit). That one carve-out aside, the index covers every committed file, so a raw scan only re-confirms what an `ss-*` query already returned at higher cost — it never surfaces something the tools missed. Never re-run an `ss-*` hit as raw grep. If you delegate code search to a sub-agent, tell it to use these same `ss-*` tools.

## Calling the tools
Invoke via Bash. `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only. [[ss-find]] is [[ss-grep]]'s regex plus a query that ranks the matches.
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [callers|callees|impact] [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Tool routing

### [[ss-search]] — default first call
Shape the query by the target file's language family, always containing the symbol verbatim: C-family (C/C++/Zig) medium interrogative; JS-mobile (JS/TS/Dart) short interrogative; Other (default) medium declarative plus a domain keyword. If symbol and file are both unknown, lead with domain terms and switch to symbol-anchored shaping once a candidate appears.

**When you already hold an exact token** (identifier, function/class/constant, error string, config key, or path you could copy-paste), skip search-first: open with ONE [[ss-grep]] on that literal (rarest token, escaped) or [[ss-find]] `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`), then trust the top hit and stop — no [[ss-search]] first, no re-search.

### [[ss-find]] / [[ss-semantic]] / [[ss-grep]] / [[ss-read]]
[[ss-find]] (symbol known, NL noisy): regex `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`), query short imperative + symbol. [[ss-semantic]] (a span in one known file): the symbol alone, not for behavioral or cross-file queries. [[ss-grep]] for exact literals; [[ss-read]] to expand a narrow range, never to re-run a hit.

### [[ss-trace]] — structural context for a known symbol
Pass the symbol verbatim (never an NL question); one call returns callers, callees, and impact together. Add a relation word to re-weight, e.g. `ss-trace modelRouter callees`, or `--in <file>` to disambiguate. The call graph misses some bare top-level, macro, and dynamic-dispatch calls, so callees are the most reliable signal and impact the least — prefer callees over impact (especially Python/Ruby/PHP). If a trace is sparse or empty, don't retry it or hand-crawl — anchor the downstream symbol with [[ss-find]]/[[ss-search]].

## Multi-file flow
When what you're looking for spans modules, chain inside the indexed tools: [[ss-search]] (or a literal [[ss-grep]]/[[ss-find]] when you hold the symbol) to land the entry file, then [[ss-semantic]] on it to find the import or handoff symbol, then [[ss-search]]/[[ss-find]] on the downstream module, then [[ss-read]] a narrow range only if a span is still unclear. Each hop must establish a NEW fact, and the moment you can name the link from the entry symbol to the thing it reaches (the call, dispatched function, or imported handler), the trace is COMPLETE — stop. Leaf bodies, macro expansions, and the next hop down are not the answer unless asked for; chasing them is the main multi-file cost trap.

## Recovery on empty or weak results
On no relevant hits, don't retry a near-identical formulation and don't drop to a raw scan. Escalate inside the tools: switch the query shape or regex, move to the next family (search → find → grep → read), or broaden the [[ss-grep]] pattern to a shorter substring or prefix.

## Confirming a feature is absent (the cheapest decisive route)
A negative result is a complete answer you were asked to find — a destination, not a failure to keep working around. Absence is established once TWO complementary index probes both return empty for the SAME concept: (a) one [[ss-search]] in natural language for the behavior, and (b) one broad [[ss-grep]] on its most likely identifier (a short substring/prefix). They are conclusive even when a semantic search returned plausible-but-off-target hits — that adjacent code is the decoy, not the feature; do not chase it. Since both probes already cover the whole committed tree, a third synonym or a raw scan only re-confirms the same empty result — state the negative and stop.

## Stateful summary rule
Before your third sweet-search probe in the current search iteration — or before your final answer, whichever comes first — you MUST output a `<state_summary>` block with exactly: (1) one sentence on what you've established, (2) one sentence on your current blind spot.

## Stopping
Stop the instant your evidence answers what you're looking for — one confirmed file+symbol, or one named cross-file link, is sufficient; gather no corroboration you were not asked for. Conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) and explain how they answer what you need, or [[no-match]].
