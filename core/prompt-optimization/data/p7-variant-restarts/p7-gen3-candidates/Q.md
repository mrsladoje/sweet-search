# Sweet-search — code search tool guide

Sweet-search indexes the working tree (uncommitted edits included) and searches it faster and cheaper than raw shell. Use the `ss-*` tools for all code search and navigation. Reach for raw `grep`/`find`/`cat`/`ls` or the native reader only for an edit too recent to be reconciled (seconds old) — otherwise the index covers every committed file, so a raw scan only re-confirms an `ss-*` result at higher cost, never beats it. Never re-run an `ss-*` hit as raw grep. If you delegate search, tell the sub-agent to use these `ss-*` tools too. One discipline governs everything below: after any empty or clearly off-target result, revise your hypothesis in writing before the next call — this is what stops blind retries and the drift into raw `grep`.

## Tools (invoke via Bash)
`[[ss-search]]`/`[[ss-find]]` return ranked code blocks; `[[ss-grep]]` is file:line only. [[ss-find]] is [[ss-grep]]'s regex plus a query that ranks the matches.
- [[ss-search]] → `ss-search "<query>" [-k N]` — semantic; default when you have no exact symbol
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]` — exact literals
- [[ss-semantic]] → `ss-semantic <file> "<query>"` — a span inside one known file
- [[ss-trace]] → `ss-trace <symbol> [callers|callees|impact] [--in <file>]`
- [[ss-read]] → `ss-read <file> [start] [end]` — a narrow range

## Open with the cheapest tool for what you hold
- **An exact token** (identifier, function/class/constant, error string, config key, path): ONE [[ss-grep]] on that literal (rarest token, escaped) or [[ss-find]] `\b<symbol>\b`. Trust the top hit and stop — no [[ss-search]] first, no confirming re-search.
- **Only a behavior or concept**: one [[ss-search]] in natural language for what you're looking for, then anchor on the symbol that surfaces. Shape it lightly by the target language — short and interrogative for JS/TS/Dart, a touch longer with a domain keyword otherwise.
- **How something flows / dispatches / is called / what a change impacts**: anchor one symbol (a literal, or [[ss-search]]), then [[ss-trace]] it — one call returns callers, callees and impact; add a relation word (`ss-trace processOrder callees`) or `--in <file>` to focus. Prefer callees over impact (the graph captures method-style calls best and misses dynamic/macro/bare calls, especially Python/Ruby/PHP). If a trace is sparse, anchor the downstream symbol with [[ss-find]]/[[ss-search]] — never make [[ss-trace]] the spine of a multi-file search.

Trust the top ranked result; confirm with at most one narrow [[ss-read]], never a re-run of a matching hit.

## The backtracking rule — revise before you retry
When a tool call comes back empty or clearly off-target, do NOT fire another near-identical query and do NOT drop to raw `grep`/`cat`. First emit a compact `<failure_analysis>` block:
```
<failure_analysis>
expected: <what you expected to find and why>
why_empty: <concrete cause — wrong regex anchor, symbol not in this file, query too broad/narrow, wrong tool, edit too fresh to be indexed>
revised: <updated belief about where the answer lives>
next: <the one specific ss-* call + shaped query you will run next>
</failure_analysis>
```
Each block MUST change the approach — a different anchor, scope, or tool, escalating inside the indexed family (grep/find → search → trace → semantic → read) — never the same query reworded. This forces explicit hypothesis revision and buys you reasoning even in non-reasoning mode; it is the cheapest way out of a dead end.

## Narrowing and multi-file
Inside a known file, prefer [[ss-semantic]] <file> "<query>" (the symbol or behavior alone) for just the span; reserve [[ss-read]] for confirming a precise range, not a whole file. Across modules, chain inside the tools: land the entry file, [[ss-semantic]] it for the import or handoff symbol, then [[ss-search]]/[[ss-find]] the downstream module. The trace is COMPLETE the moment you can name the link from the entry symbol to what it reaches; stop there rather than chasing leaf bodies or dropping to raw `cat`/`grep`.

## A confirmed absence is a complete answer
When what you're looking for may not exist, absence is settled once TWO complementary index probes come back empty for the same concept: one [[ss-search]] in natural language and one broad [[ss-grep]] on its likeliest identifier (a short substring/prefix). A semantic search that returns plausible-but-off-target code is the decoy, not a lead — name it in your `<failure_analysis>` and do not chase it. Two empty index probes over the whole committed tree are more conclusive than any raw scan, so state the negative and stop: no third synonym, no `find`/`ls`/`cat` enumeration, no native scan.

## Before the third probe
Before your third sweet-search probe in the current search iteration — or before your final answer, whichever comes first — output a `<state_summary>` block with exactly: (1) one sentence on what you've established, (2) one sentence on your current blind spot.

## Output
Stop the instant your evidence answers what you're looking for — one confirmed file+symbol, or one named cross-file link, is enough; gather no corroboration you were not asked for. Name the file(s) and symbol(s) and how they answer what you need, or [[no-match]]. For an unresolved query, include your `<failure_analysis>` blocks so the caller can audit the chain.
