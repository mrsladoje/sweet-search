# Sweet-search — code search tool guide

Prefer index-backed sweet-search tools over raw grep/ripgrep and blind file reads for search, navigation, or discovery. Fall back to plain grep/read only for unindexed changes (e.g. uncommitted edits) or when tools return nothing. Route by tool priority with family-conditioned query shaping; chain tools for multi-file flows.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Routing
- **[[ss-search]] — default first call.** Shape by language family, symbol verbatim when known: C-family (C/C++/Zig) medium interrogative; JS-mobile (JS/TS/Dart) short interrogative; Other medium declarative + a domain keyword. If symbol/file unknown, lead with domain terms, then switch to symbol-anchored once a candidate appears.
- **[[ss-find]] — symbol known, NL underperforms.** JS-mobile: regex `\b<keyword>\s+<symbol>\b`, short interrogative + symbol. Other: word-bounded `\b<symbol>\b`, short imperative + symbol.
- **[[ss-semantic]] — in-file spans after the file is located.** Query the symbol alone; not for behavioral/cross-file.
- **[[ss-trace]] — known symbol.** Symbol verbatim (never an NL question) for callers/callees/impact in one call; `--in <file>` if ambiguous; in Python/Ruby/PHP prefer callers/callees over impact.
- **[[ss-grep]] / [[ss-read]].** ss-grep for exact literals; ss-read a narrow line range to confirm an identified file (never a whole file "to be safe").

## First call decides; trust the top hit
Route from the query in one decision and let the first call usually be the last: an exact symbol/literal → one [[ss-grep]] or [[ss-find]]; a behavior → one [[ss-search]]; cross-module → [[ss-search]] then chain. Results are ranked, so the top block is the likely answer — confirm with at most one read; don't re-search a hit that already matches.

## Multi-file flow
When [[ss-search]] surfaces a file importing another module, chain: [[ss-semantic]] on the entry file for the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] if needed. Continue only while each hop yields progress.

## Recovery and absence
On empty/weak results, don't retry a near-identical query — escalate: switch shape/regex, then the next tool family (search → find → grep → read), then broaden the grep to a substring/prefix. A negative is a complete answer: once one [[ss-search]] and one broad [[ss-grep]] for the same concept are both empty, conclude [[no-match]] and stop — the index covers every committed file, so two empty complementary probes are conclusive; don't widen to more synonyms or file reads.

## Stateful summary rule
Before your third sweet-search query per search iteration — or before your final answer, whichever comes first — you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising established facts, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop the instant current evidence answers the query — one confirmed file+symbol suffices; don't gather unrequested corroboration. If an attempt fails, change approach rather than repeat.

## Output
Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
