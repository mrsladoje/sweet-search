# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools; prefer them over raw shell for any code search or navigation — they are faster and semantic. The index covers every committed file: [[ss-grep]] is grep over it (everything `grep`/`rg` does, faster and corpus-wide without enumerating files), [[ss-find]] adds structural/regex matching, [[ss-read]] reads a range. For anything committed, always use these `ss-*` tools; reach for raw `grep`/`find`/`xargs grep`/`cat`/`ls`/`rg` ONLY for not-yet-indexed changes (e.g. uncommitted edits the index cannot see). Never re-run an [[ss-grep]] hit as a raw `grep` to confirm it — the indexed result is authoritative. Route by query shape.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Read the query once and route to the cheapest tool
- **Names something you could copy-paste** — an exact identifier, function/class/constant, error string, config key, or path: open with one [[ss-grep]] on that literal (rarest token, escaped), or [[ss-find]] with a word-bounded regex `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`). Do NOT spend a [[ss-search]] call first — semantic blocks are heavy and you do not need them when you hold the exact token. The ranked hit is normally the answer.
- **Describes a behavior or concept** (no exact symbol to anchor on) — open with one [[ss-search]] in natural language, shaped by the target file's language family: C-family (C/C++/Zig) medium interrogative; JS-mobile (JS/TS/Dart) short interrogative; Other (default) medium declarative + a domain keyword. Switch to an anchored [[ss-grep]]/[[ss-find]] once a candidate symbol appears.
- **Asks how something flows, dispatches, reaches, is called, or what a change would impact** — anchor on one symbol (a literal above, or [[ss-search]] if you have none), then [[ss-trace]] it (see below).

Trust the top ranked result — `ss-*` tools return RANKED blocks, so the first is the most likely answer; confirm with at most one [[ss-read]] of a narrow range, never a re-run of a hit that already matches. Reach for [[ss-find]] over [[ss-search]] whenever a symbol is known and NL retrieval is noisy.

### [[ss-semantic]] — narrowing within a known file
Once the file is known but the exact span is not, prefer [[ss-semantic]] <file> "<query>" (the symbol or behavior alone) — it returns just that span. [[ss-read]] pulls whole ranges (heavy, re-billed every turn), so reserve it for confirming a precise, already-located range. Not for behavioral or cross-file queries.

### [[ss-trace]] — flows and structural context for a known symbol
Pass the symbol verbatim (never an NL question) for callers, callees, and impact in one call — prefer it over reading neighbour files. Add `--in <file>` when the symbol is ambiguous. In Python/Ruby/PHP, prefer callers/callees over impact — impact is unreliable there. Our call graph is ~64% unresolved on these repos: if [[ss-trace]] returns little, anchor the downstream symbol directly with [[ss-find]]/[[ss-search]].

## Multi-file flow
When a behavior spans modules, [[ss-trace]] first. If you must chain by hand instead: [[ss-semantic]] on the entry file to find the import, then [[ss-search]] (or [[ss-find]] once the symbol is known) on the downstream module, then [[ss-read]] a narrow range. Follow the chain only while each hop yields new information.

## Recovery on empty or weak results
If a query returns no relevant hits, do not retry a near-identical formulation. Escalate inside the indexed tools: switch the query shape or regex, move to the next tool family (grep/find → search → trace → read), or broaden the [[ss-grep]] pattern to a shorter substring or prefix.

## Confirming a feature is absent (the cheapest decisive route)
A negative result is itself a complete answer — a destination, not a failure to keep working around. Absence is established once TWO complementary index-backed probes both return empty for the SAME concept: (a) one [[ss-search]] in natural language for the behavior, and (b) one broad [[ss-grep]] on its most likely identifier or string (a short substring/prefix, not a precise regex). Then state the negative and stop — do NOT widen to a third synonym, more file reads, or a native scan; the index covers every committed file, so two empty complementary probes are conclusive.

## Stateful summary rule
Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop the instant your current evidence already answers the query — a single confirmed file+symbol is sufficient; do not gather corroboration you were not asked for. If an attempt fails, change approach rather than repeating a near-identical query. Conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
