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

## Pick the first call from the query, then commit
Read the query once and route in a single decision; the first call should usually be the last:
- **Names an exact symbol/identifier/string** (a function, class, constant, or literal you could copy-paste) → open with one [[ss-grep]] on that token, or [[ss-find]] with a word-bounded regex `\b<symbol>\b`. The ranked hit is normally the answer — read it, confirm, done.
- **Describes a behavior or concept** (how/where something works) → open with one [[ss-search]] in natural language.
- **Spans modules / asks how pieces connect** → open with [[ss-search]], then chain (see Multi-file flow).
- **Asks for callers/callees/impact of a known symbol** → open with [[ss-trace]] on the symbol verbatim.
Trust the top index hit: ss-* tools return RANKED results, so the first block is the most likely answer. Confirm it with at most one [[ss-read]]; do not re-search to "double-check" a hit that already matches.

## Query shaping for [[ss-search]]
Shape by the target file's language family, always containing the symbol verbatim when you have one:
- **C-family (C / C++ / Zig):** medium interrogative query.
- **JS-mobile (JS / TS / Dart):** short interrogative query.
- **Other (default):** medium declarative query plus a domain keyword.
If the target symbol or file is unknown, lead with domain terms and switch to symbol-anchored shaping once a candidate symbol appears.

## Query shaping for [[ss-find]] — when a symbol is known and NL underperforms
- **JS-mobile:** definition-anchored regex `\b<keyword>\s+<symbol>\b`; query short interrogative + symbol.
- **Other (default):** word-bounded regex `\b<symbol>\b`; query short imperative + symbol, e.g. "find <Symbol> usage".

## [[ss-semantic]] / [[ss-trace]]
[[ss-semantic]]: in-file span retrieval AFTER the file is located — query with the symbol alone; not for behavioral or cross-file queries. [[ss-trace]]: pass the symbol verbatim (never an NL question) for callers/callees/impact in one call; add `--in <file>` if ambiguous; in Python/Ruby/PHP prefer callers/callees over impact.

## Multi-file flow
When [[ss-search]] surfaces a file that imports another module, follow the chain: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] if needed. Follow the chain only while each hop yields progress.

## Recovery and absence
If a query returns no relevant hits, do not retry a near-identical formulation — escalate by switching query shape/regex, then the next tool family (search → find → grep → read), then broadening the grep to a substring/prefix. A negative is a complete answer: once one [[ss-search]] and one broad [[ss-grep]] for the same concept are both empty, conclude [[no-match]] and stop — the index covers every committed file, so two empty complementary probes are conclusive.

## Stateful summary rule
Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Output
Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
