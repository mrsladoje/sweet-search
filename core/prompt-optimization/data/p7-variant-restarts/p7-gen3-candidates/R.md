# Sweet-search — code search tool guide

Prefer index-backed sweet-search tools over raw grep/ripgrep and blind file reads for any search, navigation, or discovery — they are faster and semantic. Fall back to plain grep/read only for unindexed changes (uncommitted edits) or when an indexed tool returns nothing. Pick the first call from the strongest query signal; the first call should usually be the last.

## Router

| Query signal | First call | Follow-up (only if it adds new info) | Stop condition |
|---|---|---|---|
| Exact string / config key / error text / path / rare identifier | [[ss-grep]] with the rarest escaped regex | [[ss-read]] a narrow range only if the hit needs context | one decisive ranked hit answers it — do NOT re-search to double-check |
| Known symbol / class / method | [[ss-find]] with a word-bounded regex `\b<symbol>\b` | [[ss-trace]] the symbol verbatim if callers/callees/impact matter | stop once the file + symbol are clear |
| Behavior / concept in prose | [[ss-search]] with compact domain terms | [[ss-semantic]] on the file once one is known | stop once the relevant span answers |
| Cross-module flow | anchor with [[ss-find]] or [[ss-search]], then [[ss-trace]] the exact symbol | chain only while each hop yields progress | stop after one complete path |
| Possible absence | [[ss-grep]] / [[ss-find]] on the strongest anchor | one broader [[ss-grep]] on the most likely identifier (short substring/prefix) | a negative is a complete answer: once BOTH are empty, report [[no-match]] and stop — do not widen to a third synonym |

## Discipline (this is what makes a search cheap)
- Trust the top ranked result — ss-* tools return ranked blocks, so the first is the likely answer; confirm with at most one [[ss-read]], never a re-search.
- Keep each retrieval lean: start at `-k 5`, read narrow line ranges — every returned block stays in your context and is re-billed on every later turn.
- Before any additional call, state what NEW information it would add; if none, stop and answer.
- Do not default to [[ss-search]] when an exact anchor exists; do not repeat near-identical searches. In Python/Ruby/PHP prefer [[ss-trace]] callers/callees over impact.

## Output
Name the file(s) and symbol(s) and explain how they answer the query, or [[no-match]].
