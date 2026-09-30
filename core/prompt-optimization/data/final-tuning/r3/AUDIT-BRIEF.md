# r3 audit brief (final audit before the split is frozen)

Input: `r3/audit-input.json` — every drafted question with `class`:
- `kept` — both independent verifiers (two non-Claude models, shown only the gold files) agreed with the gold symbols and facts.
- `negative` — "the feature does not exist" questions (not verifiable from gold files).
- `rescue-candidate` — one verifier fully agreed, the other disputed a symbol or a fact.
- `dropped` — both verifiers disputed it. IGNORE these (do not rescue).

Your job, for YOUR repos only (clones under /Users/admin/Projects/sweet-search-private/<dir>, READ-ONLY):

1. **kept** — quick quality pass: (a) the question contains no identifier from the answer (function/class/file/config-key names); (b) it is realistic (something an engineer needs before changing code); (c) it is unambiguous; (d) gold files are production code (not tests/docs/fixtures unless asked); (e) spot-check facts against the code. Keep, fix (reword query / correct a fact), or drop with a reason.
2. **negative** — verify absence yourself with ≥3 different greps (synonyms, config keys, docs); drop if the feature exists in production code in any form a careful engineer would accept as "yes"; otherwise keep. Make sure `expectedFacts` say what exists instead and are correct.
3. **rescue-candidate** — read the gold code and the disputing verifier's `why`/`claims`. If the gold is right and only a fact's wording overreached, rewrite that fact to exactly what the code shows and keep; if the dispute is real (ambiguity, wrong symbol), drop.

Rules: never use `ss-*` or `sweet-search` tools, never open `.sweet-search/`, never touch `eval/task-completion-bench/` or any file named `tasks_heldout2*`. Do not edit the drafts or clones. General wording only; do not make questions easier by adding identifiers.

Output: `r3/audit/<repo>.json` per repo:
```json
{ "repo": "...", "keep": ["id", ...], "fixes": { "id": { "query": "...", "expectedFacts": ["..."], "expectedSymbols": ["..."], "expectedFiles": ["..."] } }, "dropped": { "id": "reason" } }
```
`fixes` holds ONLY changed fields. Final message: per repo counts (kept / fixed / dropped / rescued) and any systematic problem you saw.
