# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools. Prefer them over raw grep/ripgrep and blind file reads for any code search, navigation, or discovery — they are faster and semantic, and they return tightly-scoped ranked blocks instead of flooding your context. Fall back to plain grep/read only for changes not yet indexed (e.g. uncommitted edits) or when these tools return nothing. Choose the cheapest tool that can answer from the shape of the query, commit to it, and chain only while each hop adds new information.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Read the query once and route to the cheapest tool that can answer
Most queries carry a strong signal about which tool is cheapest; pick it from that signal before the first call, and the first call will usually be the last:
- **The query names something you could copy-paste** — an exact identifier, function/class/constant name, error string, config key, or path. This is the cheap case: open with one [[ss-grep]] on that literal (rarest token, escaped), or [[ss-find]] with a word-bounded regex `\b<symbol>\b`. Do NOT spend a [[ss-search]] call first — semantic search returns heavier blocks that then sit in your context and are re-billed on every later turn, and you do not need them when you already have the exact token. The ranked hit is normally the answer.
- **The query describes a behavior or concept** ("how/where does X happen", with no exact symbol to anchor on) — this is what semantic retrieval is for: open with one [[ss-search]] in natural language, shaped by the target file's language family (C-family C/C++/Zig: medium interrogative; JS-mobile JS/TS/Dart: short interrogative; Other: medium declarative + a domain keyword), and switch to an anchored [[ss-grep]]/[[ss-find]] the moment a candidate symbol appears.
- **The query asks how pieces connect across modules, or for callers/callees/impact of a known symbol** — open with [[ss-search]] to locate an anchor if you have none, then [[ss-trace]] the exact symbol (see Multi-file flow).

Trust the top ranked result: ss-* tools return RANKED blocks, so the first block is the most likely answer. Confirm it with at most one [[ss-read]] of a narrow line range; never re-run a near-identical search to "double-check" a hit that already matches.

## When NL search is the right call but underperforms
If [[ss-search]] surfaces the right file but not a clean symbol, narrow with [[ss-semantic]] on that file (query the symbol or behavior alone) before reading. Reserve [[ss-semantic]] for in-file span retrieval once the file is known; it is not for behavioral or cross-file queries. Use [[ss-find]] (word-bounded `\b<symbol>\b`; JS-mobile `\b<keyword>\s+<symbol>\b`) once a symbol is known and NL retrieval is noisy.

## Multi-file flow
When a search surfaces a file that calls or imports another module, prefer [[ss-trace]] on the exact symbol (callers, callees, and impact in one call; `--in <file>` if the symbol is ambiguous; in Python/Ruby/PHP prefer callers/callees over impact — impact is unreliable there) over manually reading neighbour files. If you must chain by hand, use [[ss-semantic]] on the entry file to find the import, then [[ss-search]] or [[ss-find]] on the downstream module, then [[ss-read]] a narrow range. Continue the chain only while each hop yields genuinely new information.

## Spend the next call only if it would add new information
Every block a tool returns stays in your working context for the rest of the task and is re-billed on every later turn, so a few oversized or redundant results cost more than several lean, decisive calls. Before each additional call, name the specific NEW fact it would establish; if you cannot, you already have your answer — give it. Start [[ss-search]]/[[ss-find]] at `-k 5` and raise `-k` only after a hit proves you need more candidates; [[ss-read]] a narrow range around the known target, never a whole file "to be safe".

## Recovery on empty or weak results
If a query returns no relevant hits, do not retry a near-identical formulation. Escalate by (1) switching the query shape or the regex, (2) moving to the next tool family (grep/find → search → trace → read), or (3) broadening the [[ss-grep]] pattern to a shorter substring or prefix.

## Confirming a feature is absent (the cheapest decisive route)
A negative result is itself a complete and correct answer — a destination, not a failure to keep working around. An empty index-backed result is positive evidence of absence, not a signal to try harder. Absence is established once TWO complementary index-backed probes both return empty for the SAME concept: (a) one [[ss-search]] in natural language for the behavior, and (b) one broad [[ss-grep]] on its most likely identifier or string (a short substring or prefix, not a precise regex). Once both are empty, state the negative and stop — do NOT widen to a third synonym, do NOT read more files, and do NOT fall back to a native `grep`/`find`/`cat` scan of the tree: the index covers every committed file, so two empty complementary probes are conclusive. A third probe would add no new information.

## Stateful summary rule
Before your third sweet-search query in the current search iteration (we can have multiple search iterations in a session) — or before your final answer, whichever comes first — you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop the instant your current evidence already answers the query — a single confirmed file+symbol is sufficient; do not gather corroboration you were not asked for. If an attempt fails, change approach rather than repeating a near-identical query. Conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) involved and explain how they answer the query, or [[no-match]].
