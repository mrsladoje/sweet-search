# Tool-side audit: surfacing sibling fix surface (squashql-295 shape)

Read-only audit. No file under the repo was modified; no `ss-*` command was run.
Every claim below is cited to `file:line` in `/Users/admin/Projects/sweet-search-private`.

**Headline:** for a 1-match/1-file `ss-grep` hit, the engine takes *no* enrichment
path at all — three independent guards each return early — and `ss-read`'s only
remainder trailer looks strictly downward. `subQueryMeasures` (line 36, assigned
line 52) sat above the read window, so nothing in the current tool surface could
have named it. The cheapest change that would have named it is a **symmetric
`unread above` footer on `ss-read`**, which is also the only candidate whose data
is already in memory at render time.

---

## 1. `ss-grep` singleton hits: the exact code path

**Wrapper.** Unscoped `ss-grep` (no `--in`) runs the diversity path,
`_ss-helpers.mjs:456-500`:

```js
result = await queryWarmSearch(regex, {
  mode: 'grep', regex, maxMatches: 0, contextLines: 0,
  perFileCap: Math.min(k, 100), maxFiles: k,
  expand: false, rerank: false, useLateInteraction: false,
  _isAgentFormat: !fixedString,
});
```
(`_ss-helpers.mjs:459-464`)

Note `_isAgentFormat: !fixedString` — passing `-F` turns the agent format **off**
for grep. The observed call had no `-F`, so `_isAgentFormat === true`.

**Header.** `_ss-helpers.mjs:489-492`:

```js
const across = body.matchedFileCount > 1 ? ` across ${body.matchedFileCount} files` : '';
process.stdout.write(`# ss-grep: ${total} total match(es) for /${regex}/${across}\n`);
```

`matchedFileCount` is `fileSummary.files.length + fileSummary.hiddenFileCount`
(`grep-output-shaping.js:255`). One file ⇒ `1 > 1` false ⇒ **no "across N files"
suffix**. That reproduces the observed header exactly.

The truncation hint on `_ss-helpers.mjs:493-496` needs
`body.truncatedFileCount > 0 || body.hiddenLine`; with one match neither is set
(`renderGrepBody`, `grep-output-shaping.js:218-247`). So the whole output is
header + one body line, as observed.

**Family manifest — three independent guards, each fatal here.**

Gate 1, the call site (`search-pattern.js:222-224`):

```js
const familyManifest = options._isAgentFormat === true && !options.fileFilter
  ? buildIndexedGrepFamilyManifest(results, this?.codeGraphRepo)
  : null;
```
This is the project's format gate, and it is correct: agent-only, and disabled
whenever `--in` is used.

Gate 2, the arity floor (`agent-pack-completion.js:300-303`):

```js
export function buildIndexedGrepFamilyManifest(results, codeGraphRepo) {
  if (!Array.isArray(results) || results.length < 2
      || typeof codeGraphRepo?.findEntitiesInRange !== 'function'
      || typeof codeGraphRepo?.findFamilyCandidates !== 'function') return null;
```

**`results.length < 2` returns null for every singleton hit.** This alone closes
the path.

Gate 3, the digit requirement (`agent-pack-completion.js:315`):

```js
if (typeof entity?.name !== 'string' || !/\d/.test(entity.name) || seen.has(entity.name)) continue;
```

The manifest is a *numeric* family compactor (`IVec2/IVec3/IVec4` → `IVec{2,3,4}`),
not a general sibling finder. `checkSubQuery` / `toSubQuery` / `subQueryMeasures`
carry no digit, so they can never become seeds. `buildIndexedFamilyManifest`
repeats the requirement at `agent-pack-completion.js:349` and requires
`values.size >= 2` per group at `:369`. Then `seeds.length < 2` at `:322`.

**Thresholds as they stand today.** Trigger = agent format AND no `--in` AND ≥2
grep results AND ≥2 distinct *digit-bearing* indexed entity names at exact match
lines AND a non-trivial common directory (`commonDirectory`,
`agent-pack-completion.js:246-268`) AND ≥2 numeric variants of one stem. Seeds
capped at `MAX_FAMILY_SEEDS = 24`, stems at `MAX_FAMILY_STEMS = 3`, candidates at
`MAX_FAMILY_CANDIDATES = 64` (`:217-219`). Token budget is paid by
`reallocateGrepTailForManifest` (`grep-output-shaping.js:268-289`), which drops
the lowest-ranked body lines only when they *fully* fund the manifest, and omits
it otherwise.

**Conclusion for Q1:** no sibling or same-file expansion of any kind can fire on a
1-match/1-file grep result. There is no code path to widen — a singleton path
would have to be new code.

---

## 2. `ss-read`: `unreadBelow` is the only remainder trailer

**Confirmed: there is no `unreadAbove`.** The single computation is
`search-read.js:454-486`, guarded by:

```js
if (wantsRange && sliced.totalLines > 0 && sliced.endLine < sliced.totalLines) {
```
(`search-read.js:455`)

Symbols come from the *full* chunk table before overlap-narrowing, selecting only
chunks that start after the window:

```js
if (c.startLine == null || c.startLine <= sliced.endLine) continue;
```
(`search-read.js:466`)

Constants: `UNREAD_SYMBOLS_MAX = 5`, `UNREAD_SYMBOLS_MIN_LINES = 20`
(`search-read.js:352-353`). The C-family sniff fallback is
`_sniffRemainderDefinitions` (`search-read.js:366-390`), used when the index has
no named chunks in the remainder (`search-read.js:473-479`). Relevance selection
is `selectUnreadSymbols` (`unread-symbol-ranking.js:60-89`), invoked from
`renderUnreadBelow` (`search-read.js:580`).

**Estimated change for a symmetric `unreadAbove`: ~45-60 lines across 4 files.**

| File | Change | Lines |
|---|---|---|
| `core/search/search-read.js` | factor `:462-480` into `collectRemainderSymbols(chunks, {side, boundary})`; add the mirror block (`c.endLine < sliced.startLine`, same `UNREAD_SYMBOLS_MIN_LINES` on `sliced.startLine - 1`, same sniff fallback on lines `1..startLine-1`); add `unreadAbove` to the return object at `:511` | ~30 |
| `core/search/search-read.js` | `renderUnreadAbove()` mirroring `:573-590`; one call in `_formatAgent` near `:609` | ~14 |
| `eval/agent-read-workflows/bin/_ss-helpers.mjs` | second render call beside `:752-755`, printed **before** the fence (position matters: the below-trailer is last for recency) | ~5 |
| `mcp/read-tool.js` | duplicate the `unreadBelow` zod block at `:32-41` | ~10 |

Note the `_unreadSymbolCandidates` WeakMap (`search-read.js:355, 485`) is keyed by
the `unreadBelow` object; a second WeakMap entry keyed by `unreadAbove` is needed
for query-relevance selection to work on the above list too.

**Tests that pin the trailer byte-for-byte** — all in
`tests/search/within-file-affordances.test.js`:

- `:405` `expect(renderUnreadBelow(r)).toBe('# unread below (3-5) — continue: read plain.txt 3-5')`
- `:478` same shape for `tiny.js 16-30`
- `:489` `expect(lines[lines.length - 1]).toBe('# unread below (206-272): dns_suffix_match, matches_suffix — continue: read …')` — **this one asserts LAST-LINE position**, so an above-trailer appended after it would break the test; placing it before the fence would not.
- `:497` the `ss-read` command form
- `:505` `expect(out).not.toContain('# unread below')` for read-to-EOF

Also note `:400-405`: `expect(r.unreadBelow).toEqual({…})` is a **strict** object
equality on the result field, but on `unreadBelow` only, so a sibling
`unreadAbove` key on the parent object does not break it.

**Non-agent blast radius.** `renderUnreadBelow` is called from `_formatAgent`
(`search-read.js:609`), and `formatReadResults` routes everything that is not
`json`/`raw` there (`search-read.js:715-723`). The CLI's *default* format is
`agent` (`search-read.js:741`), so a human running
`sweet-search read x.java --lines 170-235` already sees the below-trailer. The
clean agent-only gate that exists today is the `command` option:
`renderUnreadBelow(result, { command = 'read' })` (`search-read.js:573`), and
only the `ss-read` wrapper passes `'ss-read'` (`_ss-helpers.mjs:752-753`).
Rendering `unreadAbove` **only when `command === 'ss-read'`** keeps human CLI
output byte-identical.

---

## 3. What the index knows per file, and whether a same-file family line is buildable

**Yes — every ingredient exists. Nothing new needs indexing.**

**(a) Enclosing chunk/symbol of line L.** Two independent sources:

- `codeGraphRepo.findEntitiesInRange(filePath, startLine, endLine)` —
  `code-graph-repository.js:292-316`, returns
  `{ id, name, type, startLine, endLine, parentClass }`, `LIMIT 64`, ordered by
  `start_line`. Called with `(file, L, L)` this is exactly the enclosing-entity
  lookup `buildIndexedGrepFamilyManifest` already performs
  (`agent-pack-completion.js:307`), with `findEnclosingEntity`
  (`code-graph-repository.js:141`) as a fallback at `:310-312`.
- The chunk table via `repo.getChunksByFilePath` (`search-read.js:322`), giving
  `{ id, symbol, type, startLine, endLine, signature }` (`:330-337`).

**(b) Other symbols in F sharing a stem or referencing the same tokens.**

- Whole-file symbol list: `findEntitiesInRange(file, 1, <EOF>)` returns up to 64
  named entities with types and line ranges — that *is* the per-file symbol
  table, no new query needed.
- Stem extraction: `familyStem(name)` (`agent-pack-completion.js:51-57`), built on
  `identifierParts` (`:47-49`), which is a pure camelCase/`ALLCAPS`/digit splitter.
- Subtoken overlap: `informativeSubtokens(text)` (`query-sufficiency.js:127-…`),
  a camelCase/snake_case splitter that drops pure digits and stopwords.
- Body-reference scoring already exists: `bodySiblingScore(entity, code)`
  (`agent-pack-completion.js:159-171`) scans `IDENTIFIER_RE`
  (`:221 = /\b[A-Za-z_$][A-Za-z0-9_$]{2,79}\b/g`) over a result's code and scores
  an entity when ≥2 informative subtokens overlap, with a generic-token filter
  (`BODY_REFERENCE_GENERIC_TOKENS`, `:220`). **This is precisely rule (b).**
- Shape heuristic for captures, per CLAUDE.md: `looksLikeIdentifier`
  (`core/ranking/file-kind-ranking.js`) and `looksLikeIdentifierToken`
  (`query-sufficiency.js:203`).

**(c) Relevance ranking.** `selectUnreadSymbols(symbols, queryEvidence, max)`
(`unread-symbol-ranking.js:60-89`) already ranks a symbol list against query
evidence (exact anchor > contained anchor > subtoken count > stable position).
`extractQueryEvidence(query, regex)` (`query-sufficiency.js:187-210`) builds that
evidence from quoted literals, identifier-shaped query tokens, and regex literal
runs — the grep regex itself is a valid input.

**Field-vs-method distinction: available.** Java fields are indexed as first-class
entities with `type: 'field'`:

```
(field_declaration declarator: (variable_declarator name: (identifier) @field.definition))
```
(`core/infrastructure/tree-sitter-provider.js:515`, inside the `java:` query block
at `:505-516`; the capture maps to `'field'` at `:770`.)

So `# same file: subQueryMeasures (field L36) · toSubQuery (method L191) …` is
renderable from the entities table directly, and `buildSameFileMap`'s formatter
(`context-expander.js:1975-1977`) already prints `name (type start-end position)`.

**One real gap for the proposed line.** The `(field L36, assigned L52, read L207)`
detail is *not* free. The entities table stores the field's declaration span only;
"assigned at 52, read at 207" would require scanning the file text for the
identifier. That is a per-call file read plus a regex sweep — affordable
(`readFileRange` is already imported into `agent-pack-completion.js:212`), but it
is not an index lookup, and grep results carry no code to scan:
`buildBareGrepResults` returns `{ id, file, line, column, matchText, content,
contextBefore, contextAfter, … }` with **no `code` field**
(`core/search/search-pattern-chunks.js:282-298`). A cheaper honest form is
declaration lines only: `# same file: subQueryMeasures (field L36) · toSubQuery
(method L191-L230) · NestedQueryTable (class L248) — sweep: ss-semantic F "<query>"`.

---

## 4. `ss-search` / `ss-find` same-file span map: exact condition

The comment at `_ss-helpers.mjs:592-595` and `:919-922` ("top-1, windowed chunk,
verdict != YES") is accurate. The authoritative gate is
`context-expander.js:2421-2434`:

```js
if (!ablations.has('no-same-file-map')
    && agentResults.length > 0
    && sufficiencyVerdict !== 'yes'
    && codeGraphRepo
    && typeof codeGraphRepo.findAdjacentEntities === 'function') {
  const top = agentResults[0];
  const windowed = top.code
    && top.presentation !== 'summary'
    && top.expansionKind
    && top.expansionKind !== 'full'
    && top.file
    && Number.isFinite(top.startLine)
    && Number.isFinite(top.endLine);
```

Then `findAdjacentEntities(top.file, top.startLine, top.endLine, { perSide: 2 })`
(`:2438`), a filter dropping neighbours already visible in the pack (`:2442-2452`),
and a budget check `map.tokens <= tokenBudget - tokensUsed` (`:2454`).

**Would it have fired for a singleton-file result set? Not applicable — it is
never reachable from `ss-grep`.** This block lives inside `packageForAgent`
(`context-expander.js:1988`), which is the `ss-search` / `ss-find` packaging
pipeline. `ss-grep` calls `bareGrep` (`search-pattern.js`), which never enters
`packageForAgent`. The transcript shows only `ss-grep` and `ss-read`, so the map
had no opportunity to render. **This is the single most important structural fact
in the audit: the sibling-surface machinery exists, and grep is not wired to it.**

Worth noting the map *is* directionally symmetric — `findAdjacentEntities`
(`code-graph-repository.js:339-386`) returns both `above` (`end_line < ?`) and
`below` (`start_line > ?`) sides, and `buildSameFileMap` renders both
(`context-expander.js:1970-1982`). `ss-read`'s trailer is the asymmetric one.

---

## 5. `ss-trace`: are field reads in the target's body already covered?

**Partly — and the fix is not the one it looks like.**

"Target terms" come from `rankedTerms(target, hint)`
(`structural-answer-cues.js:24-36`), which tokenises:

```js
const found = terms(`${target.signature || ''}\n${target.summary || ''}\n${stripNonCode(target.code || '')}`);
```

`terms()` (`:11-23`) matches `/[A-Za-z_$][A-Za-z0-9_$]{2,}/g` and drops a stoplist
that includes `'this'` and `'self'` (`:5-6`). So `this.subQueryMeasures` in a
method body already yields the term `subQueryMeasures`, scored +2 for its
capital hump (`:19`). **Identifiers read from `this.`/`self.` are already in
target terms** — no change needed there. `target.code` for cue purposes is the
*untruncated* source, `targetSource = readFileRange(target.filePath,
target.startLine, target.endLine)` (`structural-context.js:302, 382`), so budget
truncation does not hide them.

The observed trace listed `subQuery, IllegalArgumentException, isEmpty…` because
the traced target was **`checkSubQuery`**, whose body does not touch the field;
the field is read by the sibling `toSubQuery`. So (c) would not have named
`subQueryMeasures` in this transcript. Extending target terms to callee bodies is
not a one-line change and would inflate every trace.

**A second, real defect found while checking this.** The `answer checklist:
related definitions=` line resolves target terms to same-file definitions via
`resolveTerm: name => this.repo.findSameFileDefinition?.(name, target.filePath)`
(`structural-context.js:398`) →
`core/infrastructure/structural-source-definitions.js:52-70`. Its
`definitionPattern` (`:5-16`) has seven alternatives covering JS/TS
(`const|let|var`, `function`, `class|interface|enum|type`), Rust
(`pub … const|static|fn|struct|enum|trait|type`), Go (`const|var|type`, `func`)
and Python (`def|class`). **None matches a Java field declaration**
(`private final Map<String, Measure> subQueryMeasures;`) or a Java method
declaration. So even when a Java field *is* a top-ranked target term, ss-trace
cannot resolve it to a line — while the entities table already holds it as
`type: 'field'` (`tree-sitter-provider.js:515`). Swapping `resolveTerm` to an
entity-table lookup (`findEntitiesInRange` on the file, match by name) would be
language-agnostic and would delete a regex-shaped stopgap, which fits the
CLAUDE.md preference for index-aware checks over pattern lists.

---

## 6. Ledger: does an `ss-*` output change need a re-sweep?

**No. Confirmed by reading the fingerprint.**

`eval/task-completion-bench/harness/env-ledger.mjs` hashes exactly four things
(`:76-83`):

```js
export const RT_HARNESS_FINGERPRINT = Object.freeze({
  version: 4,
  sources: Object.freeze(RT_HARNESS_SOURCE_NAMES.map(name => Object.freeze(hashSource(name)))),
  grader: Object.freeze(GRADER_SOURCE_NAMES.map(name => Object.freeze(hashSource(name)))),
  shim: Object.freeze(hashShimText()),
});
```

- `RT_HARNESS_SOURCE_NAMES` = `rt-condense-lib.mjs`, `rt-shim-runtime.mjs`,
  `rt-dedup.mjs`, `rt-progress-controller.mjs` (`:19-24`)
- `GRADER_SOURCE_NAMES` = `evaluator-runtime.mjs`, `sr-eval.py`,
  `upstream-patches/eval.py` (`:45-49`)
- `shim` = the generated `run_tests` text via `shimFingerprintSource()` (`:73-76`)

`hashSource` resolves names relative to `import.meta.url`, i.e. **within
`eval/task-completion-bench/harness/`** (`:51-54`). And `taskConfigHash`
(`:102-130`) adds only `instance_id`, `image`, `imageId`, `testCmd`, `net`,
`excludeP2P`/`excludeF2P`, `presed`, and `rtHarness`.

Nothing hashes `core/search/**` or `eval/agent-read-workflows/bin/_ss-helpers.mjs`.
**A change to `search-read.js` or `grep-output-shaping.js` leaves every task's
fingerprint unchanged, so no gold re-sweep is required before a run.** This
matches `project_ledger_fingerprint_blindspot.md`.

The flip side, and it is the risk worth stating: because ss-* fixes compare
ledger-identical, the ledger provides **zero protection** against an ss-* output
regression. Two arms differing only in `search-read.js` will both pass preflight.
Correctness has to come from `tests/search/` and from A/B measurement, not the
green-ledger gate.

---

## 7. Ranked candidates

Ranking criterion: would it have named `subQueryMeasures` in *this* transcript,
at what cost, with what blast radius.

### Rank 1 — (a) `unread above` footer on `ss-read`

- **Would it have named the field?** **Yes, directly.** The agent read
  `QueryResolver.java 170 235`. The field is declared at ~36 and assigned at ~52,
  both above the window, in a Java file whose fields **are** indexed as entities
  and chunks. `selectUnreadSymbols` against the grep phrase's evidence would rank
  `subQueryMeasures` highly (contained-anchor on `subQuery`, plus subtoken match).
- **LOC:** ~45-60 across `search-read.js`, `_ss-helpers.mjs`, `mcp/read-tool.js`
  (table in §2).
- **Token cost:** one line, same shape as the existing trailer — ~20-35 tokens per
  range read that starts above line 1. Zero on whole-file and read-from-line-1
  reads. Note this fires on *more* calls than the below-trailer would suggest,
  since most agent reads are mid-file; budget for ~25 tokens on nearly every
  `ss-read` with an explicit start.
- **Agent-format gate:** `command === 'ss-read'` inside `renderUnreadAbove`
  (`search-read.js:573` shows the option already exists and defaults to `'read'`;
  only `_ss-helpers.mjs:752-753` passes `'ss-read'`). That keeps the human CLI
  `agent` format byte-identical. Do **not** gate on `opts.format === 'agent'` —
  that is the CLI default (`search-read.js:741`) and would leak into human output.
- **Risk:** low. The only sharp edge is the last-line assertion at
  `tests/search/within-file-affordances.test.js:489`; render the above-line
  *before* the code fence and it stays green.

### Rank 2 — (b) same-file family line on singleton `ss-grep` hits

- **Would it have named the field?** **Probably, but not certainly.** From
  `QueryResolver.java:212` inside `checkSubQuery`, a whole-file
  `findEntitiesInRange` plus `familyStem`/`informativeSubtokens` matching on the
  `subQuery` stem would surface `toSubQuery` and `subQueryMeasures` — both share
  the stem. It is a genuinely new capability, not a widened threshold.
- **LOC:** ~70-100. Needs a new `buildSingletonSiblingLine()` in
  `agent-pack-completion.js` (stem + subtoken match, reusing `familyStem`,
  `informativeSubtokens`, `selectUnreadSymbols`), a new branch in
  `search-pattern.js` beside `:222`, plumbing through `search-server.js`
  (`:1138-1140` pattern), and a print in `_ss-helpers.mjs` near `:498`. It also
  needs a token-funding decision — `reallocateGrepTailForManifest`
  (`grep-output-shaping.js:268`) reclaims from body lines, and a singleton has
  exactly one body line to reclaim, so the manifest-funding model does not apply;
  this line has to be additive.
- **Token cost:** ~30-50 tokens, additive, on every singleton agent grep. Singleton
  greps are common, so this is the most expensive candidate in aggregate.
- **Agent-format gate:** the existing `options._isAgentFormat === true &&
  !options.fileFilter` at `search-pattern.js:222`. Correct and already in place.
- **Risk:** medium. Pure output addition (no ranking signal, so the CLAUDE.md
  format-gating regression class does not directly apply), but it is new
  per-call index work on the hottest tool, and it changes `ss-grep`'s product
  shape from "locator" toward "packager" — check against the
  keep-search-modes rule before building.

### Rank 3 — (d) fix `findSameFileDefinition` for Java (and every non-listed language)

- **Would it have named the field?** **Not in this transcript** — the trace target
  was the wrong method, so the term never reached `resolveTerm`. But it removes a
  language-shaped blind spot that will keep costing on Java/C#/Kotlin tasks, and
  it is the one candidate that *deletes* a fragile pattern list.
- **LOC:** ~15-25 — replace the `resolveTerm` closure at
  `structural-context.js:398` with an entities-table lookup, keeping the regex
  scan as fallback for unindexed files.
- **Token cost:** zero. Same line, better filled.
- **Agent-format gate:** none needed; `ss-trace` output is agent-only by
  construction (`_ss-helpers.mjs:1086-1091`).
- **Risk:** low-medium. It changes the `answer checklist: related definitions=`
  line for every language, so it needs its own before/after check.

### Rank 4 — (c) field-read terms in `ss-trace`

- **Would it have named the field?** **No.** As shown in §5, body identifiers
  behind `this.`/`self.` are *already* in target terms
  (`structural-answer-cues.js:5-6, 11-23, 26`). The miss was that the traced
  symbol (`checkSubQuery`) does not read the field. This candidate is a no-op for
  the observed failure and should be dropped.
- **LOC:** 0 for what was proposed; extending to callee bodies is a much larger,
  more expensive change.

### Also worth considering, cheapest of all

**Widen the singleton grep header instead of adding a line.** Today
`_ss-helpers.mjs:489` suppresses the "across N files" suffix at exactly one file.
For a singleton, appending the enclosing symbol —
`# ss-grep: 1 total match … in QueryResolver.checkSubQuery (method L210-L228)` —
costs ~10 tokens, needs one `findEntitiesInRange(file, L, L)` call
(`code-graph-repository.js:292`), reuses the gate already at
`search-pattern.js:222`, and tells the agent the *span* it should read rather
than guessing 170-235. It does not name `subQueryMeasures`, but it is the
lowest-risk step toward option (b) and it composes with option (a): a correct
enclosing span makes the `unread above` list more relevant.

---

## Summary of what fired, and what could not

| Surface | Fired in the transcript? | Why |
|---|---|---|
| grep "across N files" header | No | one file; `matchedFileCount > 1` false (`_ss-helpers.mjs:489`) |
| grep family manifest | No | `results.length < 2` (`agent-pack-completion.js:302`); also no digit in any name (`:315`) |
| grep truncation hint | No | no truncation, no hidden files (`_ss-helpers.mjs:493`) |
| `ss-search` same-file span map | Not reachable | lives in `packageForAgent` (`context-expander.js:2421`); `ss-grep` never enters it |
| `ss-read` unread-below | Yes, as observed | `search-read.js:455` |
| `ss-read` unread-**above** | **Does not exist** | the gap that hid lines 36 and 52 |
| `ss-trace` target terms | Yes, but on the wrong symbol | `structural-answer-cues.js:26` already covers `this.X` |
| `ss-trace` related definitions | No | `definitionPattern` has no Java field/method form (`structural-source-definitions.js:5-16`) |

Same-shape prediction for the two companion failures: `getmoto-6716`
(`attachment_count` mutation sites near `reset`) and `gleam-3458` are both
same-file, outside-the-window misses, so candidate (a) is the one that generalises
across all three.
