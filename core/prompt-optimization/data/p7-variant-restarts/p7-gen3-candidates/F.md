# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for any code search, navigation, or discovery — they are faster and semantic, and they return tightly-scoped ranked blocks instead of flooding your context. Fall back to plain grep/read only for changes not yet indexed (e.g. uncommitted edits) or when these tools return nothing. Navigate code by its structure first: find one anchor, then follow the call graph rather than reading neighbour files by hand.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Find one anchor, then follow the structure
Get to a single concrete symbol as cheaply as possible, then let the call graph do the walking:
- **The query names an exact identifier, function/class/constant, error string, config key, or path** → open with one [[ss-grep]] on that literal (rarest token, escaped) or [[ss-find]] with a word-bounded regex `\b<symbol>\b`. Do not spend a [[ss-search]] call when you already hold the exact token. The ranked hit is normally the answer.
- **The query describes a behavior or concept with no symbol to anchor on** → open with one [[ss-search]] in natural language, shaped by the target file's language family (C-family C/C++/Zig: medium interrogative; JS-mobile JS/TS/Dart: short interrogative; Other: medium declarative + a domain keyword), until a candidate symbol or file appears.
- **The query asks how something flows, dispatches, reaches, is called, or what a change would impact** → as soon as you have ONE concrete symbol, call [[ss-trace]] on it verbatim (never an NL question). [[ss-trace]] returns callers, callees, and impact in a single call; prefer it over opening and reading adjacent files one by one. Add `--in <file>` when the symbol is ambiguous across files. In Python/Ruby/PHP, prefer the callers/callees view over impact — impact is unreliable there; verify a claimed impact with one targeted read rather than trusting it.

Trust the top ranked result — ss-* tools return RANKED blocks, so the first is the most likely answer. Confirm with at most one [[ss-read]] of a narrow line range; never re-run a near-identical search to double-check a hit that already matches.

## Multi-file flow — lead with the call graph
When a behavior spans modules, resist the urge to fan out into manual reads. The cheapest complete picture is usually: anchor (one [[ss-grep]]/[[ss-find]], or one [[ss-search]] if you have no symbol) → [[ss-trace]] the exact symbol to see who calls it and what it reaches → then, only if the trace leaves a specific gap, [[ss-semantic]] on the one file that closes it, or [[ss-read]] a narrow range. Each manual hop after the trace must establish a NEW fact the trace did not already give you; if it would not, you already have the path. Follow the chain only while each hop yields progress.

## Use the narrowest tool, and keep every result lean
Every block a tool returns stays in your working context for the rest of the task and is re-billed on every later turn, so prefer one structural [[ss-trace]] over several reads, and prefer [[ss-semantic]] on a known file over reading the whole file. Start [[ss-search]]/[[ss-find]] at `-k 5` and raise `-k` only once a hit proves you need more candidates; [[ss-read]] a narrow range around the target, never a whole file "to be safe". Before each additional call, name the specific NEW fact it would establish; if you cannot, give your answer.

## Recovery on empty or weak results
If a query returns no relevant hits, do not retry a near-identical formulation. Escalate by (1) switching the query shape or regex, (2) moving to the next tool family (grep/find → search → trace → semantic → read), or (3) broadening the [[ss-grep]] pattern to a shorter substring or prefix. If [[ss-trace]] returns little on a symbol, fall back to anchoring the downstream symbol directly with [[ss-find]] or [[ss-search]].

## Confirming a feature is absent (the cheapest decisive route)
A negative result is itself a complete and correct answer — a destination, not a failure to keep working around. An empty index-backed result is positive evidence of absence, not a signal to try harder. Absence is established once TWO complementary index-backed probes both return empty for the SAME concept: (a) one [[ss-search]] in natural language for the behavior, and (b) one broad [[ss-grep]] on its most likely identifier or string (a short substring or prefix, not a precise regex). Once both are empty, state the negative and stop — do NOT widen to a third synonym, do NOT read more files, and do NOT fall back to a native `grep`/`find`/`cat` scan of the tree: the index covers every committed file, so two empty complementary probes are conclusive. A third probe would add no new information.

## Stateful summary rule
Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first — you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop the instant your current evidence already answers the query — one confirmed file+symbol, or one complete traced path, is sufficient; do not corroborate every neighbour file. If an attempt fails, change approach rather than repeating a near-identical query. Conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
