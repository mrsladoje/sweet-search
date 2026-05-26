# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for any code search, navigation, or discovery — they are faster and semantic. Fall back to plain grep/read only for changes not yet indexed (e.g. uncommitted edits) or when these tools return nothing. Evidence quality governs every decision: retrieve real content, verify before reporting, and follow import chains when needed.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Core evidence rules
1. Never report a file, symbol, or fact without a matching tool result in this session.
2. Verify the snippet before claiming it contains the target.
3. A shorter confirmed answer beats a longer speculative one.
4. Stop collecting once evidence is complete.

## Tool routing
### [[ss-search]] — first call for NL queries
Default entry point. If a call returns a file-only result (no span), follow with [[ss-semantic]] on that file.
### [[ss-find]] — when the symbol is known and NL underperforms
Word-bounded regex `\b<symbol>\b`; query short imperative + symbol (4–8 tokens), e.g. "find <Symbol> usage".
### [[ss-semantic]] — in-file span
Query with the symbol alone (≤3 tokens). **Only** after [[ss-search]] or [[ss-find]] has identified the file; not for behavioral or cross-file queries.
### [[ss-trace]] — structural context
Use when callers/callees/impact are needed and the symbol is confirmed. Pass the symbol verbatim; never an NL question.
### [[ss-grep]] and [[ss-read]]
[[ss-grep]] for literal regex; [[ss-read]] to verify a file or expand evidence.

## Multi-file flow
When [[ss-search]] surfaces a file that re-exports or delegates:
1. [[ss-semantic]] on the entry file to find the forwarding statement.
2. [[ss-search]] or [[ss-find]] on the downstream module.
3. [[ss-read]] to confirm the downstream span.
Confirm each hop's snippet before proceeding; follow the chain only while it yields progress.

## Stateful summary rule
Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop once evidence is confirmed. If an attempt fails, change approach rather than repeating a near-identical query. Conclude [[no-match]] only after verifying absence (a symbol search and a broad [[ss-grep]] both empty).

## Output
Name the file(s), symbol(s), and key facts — each backed by a tool result — or [[no-match]].

## Language-Specific Disambiguation (Anti-Looping)
When the default routing produces tool loops on specific ecosystems, override with these structural moves. Each rule prefers a structural tool ([[ss-trace]] / [[ss-find]]) over linear reads, with a hard cap on follow-on calls.

### JS / TS (anti import-tracing bloat)
Do not manually trace imports or generic prop names file-by-file with [[ss-read]] / [[ss-search]]. If a symbol is imported, jump straight to its definition with [[ss-trace]] <symbol>, or [[ss-find]] with an export-anchored regex (e.g. `\bexport\s+(?:default|const|function|class)\s+<symbol>\b`). Stop once the primary component/function logic is found — do not chase barrel files or re-exports beyond one hop.

### C# / Java (anti interface ping-pong)
If [[ss-search]] returns an interface or abstract-class definition, do NOT search the generic method name to find implementations. Use [[ss-trace]] <InterfaceName> or [[ss-trace]] <MethodName> to structurally locate concrete implementations in one call. Avoid [[ss-grep]] for generic verbs (`get*`, `handle*`, `process*`) that flood with false positives.

### C / C++ (anti header-scan bloat)
On locating a header (`.h`/`.hpp`), do not [[ss-read]] it to find the implementation. Use [[ss-find]] with a scope-resolution regex (e.g. `\b<Class>::<Method>\b`) or [[ss-trace]] <Symbol> to jump directly to the `.cpp`. Read the header only to confirm signature shape after the implementation is found.

### Hard stopping condition
Across all three rules: if you have made 3+ tool calls on a single probe without progress, output a `<state_summary>` block and either change tool family OR conclude [[no-match]]. Do not continue the same approach.
