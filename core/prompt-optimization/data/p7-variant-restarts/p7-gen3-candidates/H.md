# Sweet-search — code search tool guide

Sweet-search provides index-backed code search tools; prefer them over raw shell for code search or navigation as they are faster and cheaper. The index covers every committed file: [[ss-grep]] is grep over it (faster and corpus-wide), [[ss-find]] is ss-grep's regex plus a semantic query that ranks the matches, [[ss-read]] reads a range. In the working tree, always use these `ss-*` tools; reach for raw `grep`/`find`/`cat`/`ls`/`rg` ONLY for a change so recent the index has not reconciled it yet (a seconds-old edit) — otherwise the index reflects current files, so raw grep is almost never needed. Never re-run an [[ss-grep]] hit as a raw `grep` to confirm it — the indexed result is authoritative. If you delegate any code search or navigation to a sub-agent, instruct it to use these same `ss-*` tools and this guidance — never raw grep. Navigate by structure: anchor once, then follow the call graph rather than reading neighbour files by hand.

## Calling the tools
Invoke via the shell (Bash). `[[ss-search]]`/`[[ss-find]]` return ranked code blocks inline; `[[ss-grep]]` is file:line only:
- [[ss-search]] → `ss-search "<query>" [-k N]`
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]`
- [[ss-semantic]] → `ss-semantic <file> "<query>"`
- [[ss-trace]] → `ss-trace <symbol> [callers|callees|impact] [--in <file>]`
- [[ss-grep]] → `ss-grep "<regex>" [-k N]`
- [[ss-read]] → `ss-read <file> [start] [end]`

## Find one anchor, then follow the structure
Reach one concrete symbol cheaply, then let the call graph do the walking:
- **Names an exact identifier, function/class/constant, error string, config key, or path** → open with one [[ss-grep]] on that literal (rarest token, escaped) or [[ss-find]] with a word-bounded regex `\b<symbol>\b` (JS-mobile `\b<keyword>\s+<symbol>\b`). Do not spend a [[ss-search]] call when you hold the exact token — semantic blocks are heavy and more expensive. The ranked hit is usually the answer.
- **Describes a behavior or concept with no symbol to anchor on** → open with one [[ss-search]] in natural language, shaped by the target file's language family (C-family C/C++/Zig: medium interrogative; JS-mobile JS/TS/Dart: short interrogative; Other: medium declarative + a domain keyword), until a candidate symbol or file appears.
- **Asks how something flows, dispatches, reaches, is called, or what a change would impact** → once you have ONE concrete symbol, [[ss-trace]] it (the symbol verbatim, never a full NL question). One call returns callers, callees, AND impact together; add a relation word — callers, callees, or impact — to re-weight toward what you asked, e.g. `ss-trace modelRouter callees` or `ss-trace processOrder impact`. Add `--in <file>` to disambiguate, e.g. `ss-trace handleRequest callers --in lib/handle-request.js`. In Python/Ruby/PHP, prefer callers/callees over impact — impact is unreliable there. The call graph is incomplete — dynamic dispatch, bare-name calls, and calls into unindexed or third-party code do not resolve — so if [[ss-trace]] returns little, anchor the downstream symbol directly with [[ss-find]]/[[ss-search]].

Trust the top ranked result; confirm with at most one [[ss-read]] of a narrow range, never a re-run of a matching hit.

## Multi-file flow — lead with the call graph
The cheapest complete picture of a cross-module behavior: anchor (one [[ss-grep]]/[[ss-find]], or [[ss-search]] if you have no symbol) → [[ss-trace]] the exact symbol → then, only if the trace leaves a gap, [[ss-semantic]] on the one file that closes it, or [[ss-read]] a narrow range. Each manual hop after the trace must establish a NEW fact, or you already have the path.

## Narrowing within a known file
Once the file is known but the exact span is not, prefer [[ss-semantic]] <file> "<query>" (the symbol or behavior alone) — it returns just that span. [[ss-read]] pulls whole ranges (heavy, more expensive), so reserve it for confirming a precise, already-located range, never a whole file "to be safe". [[ss-semantic]] is not for behavioral or cross-file queries.

## Recovery on empty or weak results
On no relevant hits, do not retry a near-identical formulation — escalate inside the indexed tools: switch the search shape or regex, move to the next tool family (grep/find → search → trace → semantic → read), or broaden the [[ss-grep]] pattern to a shorter substring or prefix.

## Confirming a feature is absent (the cheapest decisive route)
A negative result is itself a complete answer — a destination, not a failure to keep working around. Absence is established once TWO complementary index-backed probes both return empty for the SAME concept: (a) one [[ss-search]] in natural language for the behavior, and (b) one broad [[ss-grep]] on its most likely identifier or string (a short substring/prefix, not a precise regex). Then state the negative and stop — do NOT widen to a third synonym, more file reads, or a native scan; the index covers every committed file, so two empty complementary probes are conclusive.

## Stateful summary rule
Before your third sweet-search probe in the current search iteration (a session can have several) — or before your final answer, whichever comes first, you MUST output a `<state_summary>` block containing exactly: (1) one sentence summarising what you've established so far, (2) one sentence stating your current blind spot or open question.

## Stopping
Stop the instant your evidence already answers what you're looking for — one confirmed file+symbol, or one complete traced path, is sufficient; do not gather corroboration you were not asked for. Conclude [[no-match]] per the absence rule above.

## Output
Name the file(s) and symbol(s) involved and explain how they answer what you need, or [[no-match]].
