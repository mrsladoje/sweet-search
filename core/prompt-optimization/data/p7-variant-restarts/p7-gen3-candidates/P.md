# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for any code search or navigation — they are faster and cheaper. The index tracks the working tree, so uncommitted edits are already indexed; reach for raw `grep`/`cat`/`ls` or the native reader only for an edit too recent to be reconciled (seconds old). Never re-run an `ss-*` hit as raw grep to confirm it. If you delegate search to a sub-agent, tell it to use these same `ss-*` tools. This guide leans on structure: when the question is how code connects, anchor one symbol and let [[ss-trace]] walk the call graph rather than read neighbour files by hand.

## Calling the tools
Invoke via Bash. `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only. [[ss-find]] is [[ss-grep]]'s regex plus a query that ranks the matches.
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [callers|callees|impact] [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Read what you're looking for, then route
- **Names something copy-pasteable** — an exact identifier, function/class/constant, error string, config key, or path: ONE [[ss-grep]] on that literal (rarest token, escaped) or [[ss-find]] `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`). Trust the top hit and stop — no [[ss-search]] first.
- **Describes a behavior or concept** with no symbol to anchor on: ONE [[ss-search]] in natural language, shaped by the target file's family — C-family (C/C++/Zig) medium interrogative; JS-mobile (JS/TS/Dart) short interrogative; Other medium declarative + a domain keyword. Anchor on the symbol that surfaces.
- **Asks how code flows, dispatches, is called, or what a change impacts**: the structural lane below.

Trust the top ranked result; confirm with at most one [[ss-read]], never a re-run of a matching hit.

## The structural lane — anchor once, then [[ss-trace]]
For "who calls X", "what does X call", or "what breaks if I change Z", reach one concrete symbol (a literal via [[ss-grep]]/[[ss-find]], or [[ss-search]] if you hold none), then [[ss-trace]] it. Pass the symbol verbatim (never an NL question); one call returns callers, callees, AND impact together. Add a relation word to re-weight and `--in <file>` to disambiguate, e.g. `ss-trace ParseCommand callees --in libs/server/RespCommand.cs`.

**Where trace is reliable, and where to bail.** The call graph captures method-style and explicitly-named calls best — strongest in method-heavy code (C++/C#/Java/Kotlin/Go/TS/JS/Rust), where one trace replaces several manual reads. It is incomplete: dynamic dispatch, bare top-level calls, macro-generated calls, and calls into unindexed or third-party code do not resolve, so **callees are the most reliable edge and impact the weakest** — prefer callees over impact, especially in Python/Ruby/PHP. If a trace is sparse or empty, do NOT retry it, hand-crawl neighbours, or make it the spine of the search: anchor the downstream symbol with [[ss-find]]/[[ss-search]].

## Narrowing within a known file
Once the file is known but the span is not, prefer [[ss-semantic]] <file> "<query>" (the symbol or behavior alone) — it returns just that span. Reserve [[ss-read]] for a precise, already-located range. [[ss-semantic]] is not for behavioral or cross-file queries.

## Multi-file flow
When a behavior spans modules, [[ss-trace]] from the anchor first — it is COMPLETE the moment you can name the link from the entry symbol to what it reaches; stop there. If the trace is sparse, chain by hand: [[ss-semantic]] the entry file for the import, then [[ss-search]]/[[ss-find]] the downstream module — only while each hop yields a NEW fact, never by dropping to raw `cat`/`grep`.

## Recovery on empty or weak results
On no relevant hits, do not retry a near-identical formulation. Escalate inside the indexed tools: switch the shape or regex, move to the next family (grep/find → search → trace → semantic → read), or broaden the [[ss-grep]] pattern to a shorter substring or prefix.

## Confirming a feature is absent
A negative result is a complete answer, not a failure to keep working around. Absence is settled once TWO complementary index probes both return empty for the SAME concept: one [[ss-search]] in natural language for the behavior, and one broad [[ss-grep]] on its likeliest identifier (a short substring/prefix). Then state the negative and stop — no third synonym, file reads, or native scan; the index covers every committed file, so two empty probes are conclusive.

## Stateful summary rule
Before your third sweet-search probe in the current search iteration — or before your final answer, whichever comes first — you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping and output
Stop the instant your evidence answers what you're looking for — one confirmed file+symbol, or one named cross-file link, is sufficient; gather no corroboration you were not asked for. Name the file(s) and symbol(s) and explain how they answer what you're looking for, or conclude [[no-match]] per the absence rule above.
