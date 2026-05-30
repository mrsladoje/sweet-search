# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for any code search, navigation, or discovery — they are faster and semantic, and they return tightly-scoped ranked blocks instead of flooding your context. Fall back to plain grep/read only for changes not yet indexed (e.g. uncommitted edits) or when these tools return nothing. Route by tool priority with family-conditioned query shaping, and chain tools for multi-file flows.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Keep each result small (this is what makes a search cheap)
Every block a tool returns stays in your working context for the rest of the task, so a few oversized results cost more than several lean calls. Default to the smallest retrieval that answers the query:
- Start [[ss-search]]/[[ss-find]] at `-k 5`; raise `-k` only after a hit proves you need more candidates.
- [[ss-read]] a **narrow line range** around a known target (e.g. the function body), never a whole file "to be safe"; widen only if it cut off.
- Prefer a precise [[ss-grep]] regex over a broad one — a broad literal matching hundreds of lines floods context with no added signal.

## Tool routing
- **[[ss-search]] — default first call.** Shape by the target file's language family, symbol verbatim when known: C-family (C/C++/Zig) medium interrogative; JS-mobile (JS/TS/Dart) short interrogative; Other medium declarative + a domain keyword. If symbol/file unknown, lead with domain terms, then switch to symbol-anchored once a candidate appears.
- **[[ss-find]] — symbol known, NL underperforms.** JS-mobile: regex `\b<keyword>\s+<symbol>\b`, short interrogative + symbol. Other: word-bounded `\b<symbol>\b`, short imperative + symbol, e.g. "find <Symbol> usage".
- **[[ss-semantic]] — in-file spans after the file is located.** Query the symbol alone; not for behavioral/cross-file queries.
- **[[ss-trace]] — known symbol.** Symbol verbatim (never an NL question) for callers/callees/impact in one call; `--in <file>` if ambiguous; in Python/Ruby/PHP prefer callers/callees over impact.
- **[[ss-grep]] / [[ss-read]].** ss-grep for exact literals; ss-read a narrow range to confirm an identified file.

## Multi-file flow
When [[ss-search]] surfaces a file that imports another module, follow the chain: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] if needed. Follow the chain only while each hop yields progress.

## Recovery and absence
On empty or weak results, do not retry a near-identical formulation — escalate by switching query shape/regex, then the next tool family, then broadening the grep to a substring/prefix. A negative is a complete answer: once one index-backed [[ss-search]] and one broad [[ss-grep]] for the same concept both return empty, conclude [[no-match]] and stop — the index covers every committed file, so two empty complementary probes are conclusive.

## Stateful summary rule
Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop once you have confirmed evidence; don't over-search or gather unrequested corroboration. If an attempt fails, change approach rather than repeating a near-identical query.

## Output
Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
