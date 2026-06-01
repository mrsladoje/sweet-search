# Sweet-search — code search tool guide

Sweet-search indexes the working tree (uncommitted edits included). Use the `ss-*` commands for code search and navigation; raw `grep`/`find`/`cat`/`ls` is only for a change too recent for the index to have seen it. Never re-run an indexed hit through raw shell. If you delegate search, tell the sub-agent to use these `ss-*` tools too.

## Tools (invoke via Bash)
`[[ss-search]]`/`[[ss-find]]` return ranked code blocks; `[[ss-grep]]` is file:line only. [[ss-find]] is [[ss-grep]]'s regex plus a query that re-ranks the matches.
- [[ss-search]] → `ss-search "<query>" [-k N]` — semantic search when no exact anchor is known
- [[ss-find]] → `ss-find "<query>" --regex "<regex>" [-k N]` — regex matches re-ranked by the query
- [[ss-grep]] → `ss-grep "<regex>" [-k N]` — exact literals and short broad substrings
- [[ss-semantic]] → `ss-semantic <file> "<query>"` — a focused span inside one known file
- [[ss-trace]] → `ss-trace <symbol> [callers|callees|impact] [--in <file>]` — call-graph context for a known symbol
- [[ss-read]] → `ss-read <file> [start] [end]` — narrow verbatim lines

## Route
Pick the cheapest lane that fits.
- **An exact or distinctive literal** (identifier, method/class/constant, quoted text, config key, error text, path, protocol name, library name, or API word with exact spelling): start with [[ss-grep]] on the rarest escaped spelling, or [[ss-find]] `\b<symbol>\b` when ranking same-symbol hits matters. If the top hit names the file but not the span you need, prefer [[ss-semantic]] on that file over a duplicate grep or a wide read. Trust the top authored hit; use [[ss-read]] only for a precise range. If the top hit is generated, minified, or under `build/`/`dist/`, follow it to the hand-authored source.
- **A behavior or concept with no literal anchor**: one compact [[ss-search]] in natural language, then switch to [[ss-grep]] or [[ss-find]] once a candidate symbol appears.
- **How something flows / dispatches / is called / what a change impacts**: anchor one concrete symbol first, then [[ss-trace]] it with the relation word (callers, callees, or impact) that matches the question. Prefer callees over impact (especially Python/Ruby/PHP). If a trace is sparse or empty, anchor the downstream symbol with [[ss-find]]/[[ss-search]] rather than retrying trace or hand-crawling; never make [[ss-trace]] the spine of a multi-file search.

Stop once you can name the file and symbol, or the one cross-file link requested.

## Multi-file
Follow only links that add a named fact. Land the entry file, [[ss-semantic]] it for the import or handoff symbol, then [[ss-search]]/[[ss-find]] the downstream module. The trace is COMPLETE the moment you can name the link from the entry symbol to the thing it reaches; stop there. Leaf bodies, macro expansions, and the next hop down are not the answer unless asked, and chasing them — or dropping to raw `cat`/`grep` to "just look" — is the main multi-file cost trap.

## A confirmed absence is a complete answer
When what you're looking for may not exist, absence is settled once TWO complementary index probes come back empty for the same concept: one [[ss-search]] in natural language and one broad [[ss-grep]] on its likeliest identifier (a short substring/prefix/protocol). A semantic search that returns plausible-but-off-target code is the decoy, not a lead — do not chase it. Two empty index probes over the whole committed tree are more conclusive than any raw scan or file listing, so state the negative and stop: no third synonym, no `find`/`ls`/`cat` enumeration, no native scan.

## Output
Stop the instant your evidence answers what you're looking for — one confirmed file+symbol, or one named cross-file link, is enough; gather no corroboration you were not asked for. Name the file(s) and symbol(s) and how they answer what you need, or [[no-match]].
