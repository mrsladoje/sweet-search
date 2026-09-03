# squashql__squashql-295 — forensics on 42 rollouts (21 sweet, 21 native)

**Bottom line.** The mechanism is confirmed and it is a single line of code, not a
judgment failure: `resolved` is identical to "the final patch changes the
`this.subQueryMeasures.values()` argument in `toSubQuery`" in **42/42** rollouts
(native 18/18 solved touch it, 3/3 failed do not; sweet 6/6 solved touch it, 15/15
failed do not; Fisher p < 1e-9). Everything else is about how each arm got that one
line into view.

Within the sweet arm the acting variable is **not** passive sighting of the field
definition. It is whether the agent ever ran a search *on the identifier itself*
(`ss-grep "subQueryMeasures"` or equivalent): **4 solved / 0 failed** when it did,
**2 solved / 15 failed** when it did not (p = 0.0025). Passive sighting before the
first edit separates nothing inside sweet (2/1 vs 4/14, p = 0.18), because one
rollout read the definition and edited past it anyway.

Line numbers used throughout (confirmed from the transcripts, they differ slightly
from the brief): field declaration `private final Map<Measure, CompiledMeasure>
subQueryMeasures;` is **L35**; constructor assignment `this.subQueryMeasures =
query.table.subQuery == null ? Collections.emptyMap() :
compileMeasures(query.table.subQuery.measures, false);` is **L55**; the read site
`new ArrayList<>(this.subQueryMeasures.values())` inside `toSubQuery` is **L207**.

---

## 1. Per-rollout table (all 42)

Columns: "tools before E1" excludes the `apply_patch` call that *is* the edit
(codex double-records it). "chars out before E1" is summed tool-output length with
the normalizer's truncation counts added back. "E1" = first EDIT.

| run | harness | arm | rep | resolved | tools before E1 | QueryResolver.java lines in view before E1 | `this.subQueryMeasures =` (L55) / `subQueryMeasures;` (L35) in view before E1 | in view before LAST edit | searched *for* `subQueryMeasures` | first search cmd (hits) | E1 touches toSubQuery | final touches toSubQuery | run_tests | chars out before E1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| codex | codex | native | r0 | YES | 10 | 1-380 | s9,14 | s9,14 | s14 | s4 `pwd && printf '%s\n' '--- files ---' && rg --f` (89 out-lines) | YES | YES | 11 | 62,338 |
| codex | codex | native | r1 | YES | 14 | 1-430 | s13 | s13 | s37 | s4 `pwd && printf '\nTop-level files:\n' && rg --f` (91 out-lines) | YES | YES | 5 | 101,126 |
| codex | codex | native | r2 | YES | 11 | 1-460 | s6,7,14,19 | s6,7,14,19 | s19 | s4 `pwd && printf '%s\n' '--- files ---' && rg --f` (129 out-lines) | YES | YES | 3 | 81,674 |
| opencode | opencode | native | r0 | YES | 18 | 1-380 | s4,6,13 | s4,6,13 | s13,33 | s3 `pattern=**/* path=/root/.ss-eval/runs/r0-25` (102 out-lines) | YES | YES | 4 | 79,137 |
| opencode | opencode | native | r1 | YES | 16 | 1-339 | s12,15 | s12,15 | s15 | s3 `pattern=**/* path=/root/.ss-eval/runs/r1-26` (102 out-lines) | YES | YES | 3 | 51,008 |
| opencode | opencode | native | r2 | YES | 15 | 1-479 | s6,15 | s6,15 | s15 | s3 `pattern=**/* path=.` (102 out-lines) | YES | YES | 3 | 71,007 |
| claudecode | claudecode | native | r0 | YES | 12 | 1-405 | s9,11 | s9,11,22 | s22 | s8 `rg -n "sub-query\|subquery\|subQuery\|sub_quer` (~17 lines) | no | YES | 5 | 33,279 |
| claudecode | claudecode | native | r1 | YES | 14 | 1-339 | s9,11,13 | s9,11,13,16 | s11,13,16 | s6 `grep -R "sub-query in a sub-query\\|subquery i` (~26 lines) | YES | YES | 5 | 45,526 |
| claudecode | claudecode | native | r2 | YES | 13 | 1-439 | s5,7,11 | s5,7,11 | s11 | s5 `git grep -n -i "sub.query\\|subquery\\|sub-que` (~14 lines) | YES | YES | 4 | 43,955 |
| ab-sq-newidx-codex-20260903 | codex | native | r0 | YES | 12 | 1-380 | s7,8,17 | s7,8,17 | s17 | s4 `pwd && printf '\nTop-level files:\n' && rg --f` (131 out-lines) | YES | YES | 8 | 91,277 |
| ab-sq-newidx-codex-20260903 | codex | native | r1 | no | 9 | 1-275,300-420 | s16 | s16 | no | s4 `pwd && rg --files -g 'AGENTS.md' -g '!**/.git/` (89 out-lines) | no | no | 5 | 51,679 |
| ab-sq-newidx-codex-20260903 | codex | native | r2 | YES | 11 | 1-380 | s9,15,18 | s9,15,18 | s18 | s4 `pwd && rg --files -g 'AGENTS.md' -g '!*.lock' ` (89 out-lines) | YES | YES | 8 | 80,621 |
| ab-sq-newidx-opencode-20260903 | opencode | native | r0 | YES | 17 | 1-339 | s14 | s14,26 | s26 | s3 `{"pattern": "**/*", "path": "/root/.ss-eval/ru` (102 out-lines) | YES | YES | 4 | 73,832 |
| ab-sq-newidx-opencode-20260903 | opencode | native | r1 | YES | 19 | 1-380 | s6,8,16 | s6,8,16 | s16 | s3 `{"pattern": "**/*", "path": "/root/.ss-eval/ru` (102 out-lines) | YES | YES | 3 | 71,382 |
| ab-sq-newidx-opencode-20260903 | opencode | native | r2 | YES | 18 | 1-379 | s13 | s13,23 | s23 | s3 `{"pattern": "*", "path": "/root/.ss-eval/runs/` (102 out-lines) | YES | YES | 3 | 63,444 |
| ab-sq-oldidx-codex-20260903 | codex | native | r0 | YES | 11 | 1-420 | s9,10 | s9,10 | no | s4 `pwd && printf '%s\n' '--- files ---' && rg --f` (~34 lines) | YES | YES | 4 | 86,469 |
| ab-sq-oldidx-codex-20260903 | codex | native | r1 | no | 11 | 1-430 | s14 | s14 | no | s4 `pwd && printf '%s\n' '--- files ---' && rg --f` (89 out-lines) | no | no | 9 | 65,291 |
| ab-sq-oldidx-codex-20260903 | codex | native | r2 | no | 8 | 175-230 | no | s25,27 | no | s4 `pwd; printf '%s\n' '--- files ---'; rg --files` (89 out-lines) | no | no | 5 | 34,918 |
| ab-sq-oldidx-opencode-20260903 | opencode | native | r0 | YES | 14 | 1-249 | s11,14 | s11,14,24 | s14 | s3 `{"pattern": "sub-query\|subquery\|sub_query\|s` (31 matches) | no | YES | 5 | 58,483 |
| ab-sq-oldidx-opencode-20260903 | opencode | native | r1 | YES | 19 | 1-380 | s4,6,16 | s4,6,16 | s16,28 | s3 `{"pattern": "**/*", "path": "/root/.ss-eval/ru` (102 out-lines) | YES | YES | 2 | 79,128 |
| ab-sq-oldidx-opencode-20260903 | opencode | native | r2 | YES | 19 | 1-467 | s8,10 | s8,10,23 | s23 | s3 `{"pattern": "**/*", "path": "/root/.ss-eval/ru` (102 out-lines) | YES | YES | 2 | 82,472 |
| codex | codex | sweet | r0 | no | 8 | 170-235 | no | s27 | no | s4 `ss-grep "sub-query in a sub-query is not suppo` (1 matches) | no | no | 8 | 10,642 |
| codex | codex | sweet | r1 | no | 7 | 170-245 | no | s27 | no | s4 `ss-grep "sub-query in a sub-query is not suppo` (1 matches) | no | no | 7 | 11,779 |
| codex | codex | sweet | r2 | no | 7 | 180-240 | no | no | no | s4 `ss-search "sub-query in a sub-query is not sup` (13 out-lines) | no | no | 8 | 8,467 |
| opencode | opencode | sweet | r0 | YES | 7 | 175-270 | no | s25 | s22 | s3 `ss-grep "sub-query in a sub-query is not suppo` (1 matches) | no | YES | 4 | 15,285 |
| opencode | opencode | sweet | r1 | no | 7 | 160-469 | no | no | no | s3 `ss-search "sub-query in a sub-query is not sup` (5 out-lines) | no | no | 7 | 22,181 |
| opencode | opencode | sweet | r2 | no | 7 | 170-320 | no | no | no | s3 `ss-grep "sub-query in a sub-query" -k 20` (1 matches) | no | no | 6 | 16,501 |
| claudecode | claudecode | sweet | r0 | no | 12 | 1-280 | s12 | s12 | no | s9 `ss-grep "sub-query" -k 20` (13 matches) | no | no | 5 | 20,414 |
| claudecode | claudecode | sweet | r1 | YES | 5 | 164-330 | no | no | s10,19 | s2 `ss-search "sub-query in a sub-query is not sup` (5 out-lines) | no | YES | 6 | 14,007 |
| claudecode | claudecode | sweet | r2 | YES | 9 | 185-430 | no | no | s22 | s7 `ss-search "sub-query in a sub-query is not sup` (5 out-lines) | no | YES | 5 | 18,513 |
| ab-sq-newidx-codex-20260903 | codex | sweet | r0 | no | 9 | 180-365 | no | no | no | s4 `ss-search "sub-query in a sub-query is not sup` (13 out-lines) | no | no | 6 | 14,619 |
| ab-sq-newidx-codex-20260903 | codex | sweet | r1 | no | 5 | none | no | no | no | s4 `ss-search "sub-query in a sub-query is not sup` (13 out-lines) | no | no | 10 | 5,703 |
| ab-sq-newidx-codex-20260903 | codex | sweet | r2 | YES | 6 | 150-330 | no | no | no | s4 `ss-search "sub-query in a sub-query is not sup` (13 out-lines) | no | YES | 8 | 14,035 |
| ab-sq-newidx-opencode-20260903 | opencode | sweet | r0 | no | 7 | 170-235 | no | no | no | s3 `ss-grep "sub-query in a sub-query" -k 20` (1 matches) | no | no | 7 | 10,835 |
| ab-sq-newidx-opencode-20260903 | opencode | sweet | r1 | no | 4 | 160-235 | no | no | no | s3 `ss-grep "sub-query in a sub-query is not suppo` (1 matches) | no | no | 3 | 8,987 |
| ab-sq-newidx-opencode-20260903 | opencode | sweet | r2 | YES | 12 | 1-330 | s5 | s5 | no | s3 `ss-grep "sub-query in a sub-query is not suppo` (1 matches) | YES | YES | 4 | 35,136 |
| ab-sq-oldidx-codex-20260903 | codex | sweet | r0 | no | 4 | 170-250 | no | no | no | s5 `printf '%s\n' '--- top-level files ---'; rg --` (1 matches) | no | no | 9 | 8,471 |
| ab-sq-oldidx-codex-20260903 | codex | sweet | r1 | YES | 9 | 1-468 | s10 | s10,31 | s15,31 | s6 `ss-grep "sub-query in a sub-query is not suppo` (1 matches) | YES | YES | 4 | 34,434 |
| ab-sq-oldidx-codex-20260903 | codex | sweet | r2 | no | 7 | 180-290 | no | s25 | no | s4 `ss-grep "sub-query in a sub-query" -k 20` (1 matches) | no | no | 8 | 10,040 |
| ab-sq-oldidx-opencode-20260903 | opencode | sweet | r0 | no | 7 | 164-285 | no | no | no | s3 `ss-search "sub-query in a sub-query is not sup` (5 out-lines) | no | no | 3 | 12,163 |
| ab-sq-oldidx-opencode-20260903 | opencode | sweet | r1 | no | 7 | 164-275 | no | no | no | s3 `ss-search "sub-query in a sub-query is not sup` (5 out-lines) | no | no | 7 | 13,946 |
| ab-sq-oldidx-opencode-20260903 | opencode | sweet | r2 | no | 5 | 170-240 | no | no | no | s3 `ss-grep "sub-query in a sub-query is not suppo` (1 matches) | no | no | 8 | 9,155 |

**Notes on the table.** `opencode` assistant text is captured (6-7 non-empty blocks
per file), so the absence of quotes below for opencode is not a capture gap; those
rollouts simply emit short status lines, not reasoning. `ab-sq-newidx-codex sweet
r1` shows "none" for lines-in-view because it never ran `ss-read` on
QueryResolver.java before editing at s12 — it edited off the `ss-search` snippet
alone.

---

## 2. Q1 — which single variable separates sweet-solved from sweet-failed

Each 2x2 is solved/failed. Fisher exact, two-sided.

### Inside the sweet arm (n=21, 6 solved / 15 failed)

| # | variable | PRED+ | PRED- | p |
|---|---|---|---|---|
| **(b)** | **ever searched *for* `subQueryMeasures`** | **4 / 0** | **2 / 15** | **0.0025** |
| (a) | L35/L55 in view before first EDIT | 2 / 1 | 4 / 14 | 0.184 |
| (a') | L35/L55 in view before LAST edit | 3 / 4 | 3 / 11 | 0.354 |
| (a'') | L35/L55 in any output, ever | 3 / 5 | 3 / 10 | 0.631 |
| (b') | searched for it *before* the first EDIT | 1 / 0 | 5 / 15 | 0.286 |
| (c) | whole-file read (1..>=460) before E1 | 1 / 0 | 5 / 15 | 0.286 |
| (c') | any read covering L55 before E1 | 2 / 1 | 4 / 14 | 0.184 |
| (d) | read volume before E1 > 30k chars | 2 / 0 | 4 / 15 | 0.071 |
| (d') | read volume before E1 > 20k chars | 2 / 2 | 4 / 13 | 0.544 |
| (e) | any `sufficient=YES` verdict seen | 3 / 5 | 3 / 10 | 0.631 |
| (e') | only `sufficient=unknown` seen | 3 / 10 | 3 / 5 | 0.631 |
| (f) | called `ss-trace` at all | 2 / 4 | 4 / 11 | 1.000 |

**(b) is the only significant variable inside sweet.** The four sweet rollouts that
searched the identifier are `opencode sweet r0` (s22), `claudecode sweet r1`
(s10, s19), `claudecode sweet r2` (s22), `ab-sq-oldidx-codex sweet r1` (s15, s31).
All four solved. Note the direction: three of the four searched *after* their first
edit, during post-edit verification. The search is what converts a wrong first edit
into a right final patch.

**(e) the sufficiency verdicts carry no signal.** Sweet saw `confidence=low
... sufficient=unknown (evidence_without_margin)` on almost every `ss-search`/`ss-find`
call in both solved and failed rollouts. `sufficient=YES` appeared in 8 of 21 sweet
rollouts, split 3 solved / 5 failed. It was emitted for finding the *error string*,
which was never the hard part.

**(d) read volume is a strong ARM-level variable but weak within-arm.** Median tool
output before the first edit: native solved 72,607 chars, native failed 51,679;
sweet solved 16,899, sweet failed 10,835. Sweet's *best* rollout read less than
native's *worst*. Across all 42, ">30k chars before E1" gives 20/3 vs 4/15
(p < 0.0001) — but that is almost entirely the arm contrast, not a within-sweet
lever.

### Across both arms (n=42, 24 solved / 18 failed)

| variable | PRED+ | PRED- | p |
|---|---|---|---|
| ever searched for `subQueryMeasures` | 21 / 0 | 3 / 18 | <0.0001 |
| L35/L55 in view before first EDIT | 20 / 3 | 4 / 15 | <0.0001 |
| read volume before E1 > 30k chars | 20 / 3 | 4 / 15 | <0.0001 |
| whole-file read before E1 | 4 / 0 | 20 / 18 | 0.122 |

Native gets the cue for free: **20 of 21 native rollouts had L35/L55 in view before
their first edit; only 3 of 21 sweet rollouts did.** That 20/21 vs 3/21 gap is the
arm-level story, and it is exactly the hypothesis in the brief.

---

## 3. Q2 — sweet rollouts that had the definition in context and still failed

There are three. One is the clean case; two are post-edit.

### `claudecode sweet r0` — read L1-160, then edited past it

- **s11 `<state_summary>`**: "Established: `QueryResolver.checkSubQuery` explicitly
  rejects any `subQuery.table.subQuery` with the exact reported exception at
  `QueryResolver.java:210-213`; `toSubQuery` then compiles the nested table through
  `compileTable`. **Blind spot: I need to verify whether removing that guard alone
  supports recursive field/measure resolution or whether another depth assumption
  must also be adjusted.**"
- **s12** `ss-read ... QueryResolver.java 1 160` — output contains verbatim
  `35   private final Map<Measure, CompiledMeasure> subQueryMeasures;` and
  `55     this.subQueryMeasures = query.table.subQuery == null ? ... compileMeasures(query.table.subQuery.measures, false);`
- **s13** `ss-read ... 228 280` — reads `compileTable`, i.e. it went *downward* to
  confirm recursion rather than back up to the field it had just seen.
- **s16 EDIT** removes only the guard.
- **s17**: "The source edit is applied: the explicit nesting rejection is removed,
  while the existing recursive `compileTable → toSubQuery → compileTable` path
  remains intact."

**It never named `subQueryMeasures` once, in any assistant text or reasoning block.**
Its stated belief was that recursion was already structurally supported, so guard
removal was sufficient. Its own s11 blind spot named "measure resolution" as the
open question and s12 answered it — the answer scrolled past unread.

Also relevant: this rollout dispatched an `Explore`/haiku subagent at s3 whose
report (appended in the transcript head) concluded **"Likely minimal source fix:
remove only the first `if` block and retain the other subquery validations."** The
subagent actively prescribed the wrong fix before the main agent read anything.

### `codex sweet r0` — derived the exact bug in reasoning, then talked itself out of it

This is the strongest single quote in the corpus.

- **s27** `ss-read ... QueryResolver.java 1 175` (L35 and L55 in view).
- **s28 reasoning**: "I'm thinking through how `toSubQuery(subQuery)` works. It
  resolves select fields with the root resolver and returns a `DatabaseQuery` that
  includes `QueryScope` and `subQueryMeasures`. **For nested calls, the inner
  `toSubQuery` continues using the same resolver and those root immediate measures.
  I wonder if this approach is really okay, but it seems like it could be.** There's
  room to explore any potential issues with this method!"
- **s29 reasoning**: "I'm working on updates for the tests and fixing an existing
  malformed test case... **But wait — am I overfitting?**"
- **s30**: "Nested compilation is structurally supported, but malformed subquery
  DTOs currently fall into an NPE. I'll add a focused validation for a missing
  nested table."
- **s31/s32 EDIT**: adds `if (subQuery.table == null) throw ...` — a null guard, not
  the measure fix.

The model stated the defect in plain words and then rejected it as possible
overfitting. `codex sweet r1` is the same shape (L1-175 at s27, null-guard patch at
s32). `ab-sq-oldidx-codex sweet r2` read L1-180 at s25 and likewise finished on a
null guard.

### The `ss-trace` cue was also read past

`codex sweet r1` s16 ran `ss-trace toSubQuery callees`, whose output includes
`answer cues: top callees=... | calls subQueryMeasures.values (external)`. Its very
next assistant text, **s17**: "The flow is already recursive: `toSubQuery` calls
`compileTable`, which reaches nested sub-queries. I'm removing only the artificial
depth check and preserving the unrelated sub-query validations." It then made the
guard-only edit at s18/s19 and never returned. The identifier appeared and produced
no behaviour change.

---

## 4. Q3 — native: two-site edit in the first patch

**16 of 21 native rollouts** made the `toSubQuery` change in their **first** patch.
Two more (`claudecode native r0`, `ab-sq-oldidx-opencode native r0`) reached it on a
later edit and still resolved. The 3 failed natives never made it.

What was in view at that moment. Two distinct free cues, both absent in sweet:

**(i) A broad identifier-family grep** (7 rollouts). Verbatim lines:

- `claudecode native r2` s5 — `git grep -n -i "sub.query\|subquery\|sub-query" -- ':!CLAUDE.md'`:
  ```
  core/src/main/java/io/squashql/query/QueryResolver.java:35:  private final Map<Measure, CompiledMeasure> subQueryMeasures;
  core/src/main/java/io/squashql/query/QueryResolver.java:55:    this.subQueryMeasures = query.table.subQuery == null ? Collections.emptyMap() : compile…
  ```
- `claudecode native r0` s9 — `rg -n -i "sub.?query.*(support|nest|level)|nest.*sub.?query|sub.?query.*sub.?query" core bigquery …`:
  ```
  core/src/main/java/io/squashql/query/QueryResolver.java:55:    this.subQueryMeasures = query.table.subQuery == null ? Collections.emptyMap() : compile…
  core/src/main/java/io/squashql/query/compiled/PrefetchVisitor.java:200:      DatabaseQuery subQuery = new DatabaseQuery(subQueryScope, new ArrayList<>…
  ```
- `codex native r2` s6 — `rg -n -i "sub.?query in a sub.?query|sub.?query…"`:
  ```
  core/src/main/java/io/squashql/query/QueryResolver.java:35:  private final Map<Measure, CompiledMeasure> subQueryMeasures;
  core/src/main/java/io/squashql/query/QueryResolver.java:55:    this.subQueryMeasures = query.table.subQuery == null …
  ```
- `ab-sq-oldidx-opencode native r1` s4 and `ab-sq-newidx-opencode native r1` s6 —
  `grep pattern="sub-query|subquery|subQuery|nested"`, which surfaces the whole
  `subQueryMeasures` family in `PrefetchVisitor.java:138/154/187/200`.

**(ii) A wide slab read of the file head** (the rest). `sed -n '1,380p'`
(codex r0 s9, codex r1 s13, ab-newidx-codex r2 s9), `sed -n '1,280p'`
(ab-oldidx-codex r0 s9), `read offset=1 limit=150/380` (opencode r1 s12, opencode r2
s6, claudecode r1 s9, ab-newidx-opencode r0 s14 / r2 s13, ab-oldidx-opencode r0 s11).

Both cues share one property: they are **cheap and wide**. Native's first search is
a directory listing or a family-regex grep returning 89-131 lines; sweet's is a
1-hit exact-string `ss-grep`.

---

## 5. Q4 — every `<state_summary>` sweet emitted, and whether the blind spot pointed at the fix

21 sweet rollouts emitted 24 `<state_summary>` blocks: 23 well-formed, plus one in
`opencode sweet r0` (s5) whose closing tag is missing in the transcript though its
text is complete. `opencode sweet r1` emitted none at all; the other 20 rollouts
emitted at least one. Classified by whether the
stated blind spot named the missing surface (measures / measure compilation) versus
naming only recursion, validation, or tests.

**Named measures explicitly (5 blocks, 3 solved / 2 failed):**

| rollout | step | blind spot (verbatim fragment) | outcome |
|---|---|---|---|
| ab-newidx-codex sweet r2 | s10 | "whether **nested measures** resolve correctly across recursion, so I'm checking that path before editing" | YES |
| claudecode sweet r2 | s16 | "whether recursive compilation needs a **deeper measure/context adjustment** beyond the guard removal" | YES |
| claudecode sweet r0 | s11 | "whether removing that guard alone supports recursive **field/measure resolution**" | no |
| codex sweet r1 | s15 | "whether recursive compilation **preserves nested measures** and query scope behavior" | no |
| ab-newidx-opencode sweet r0 | s5 | "whether removing only that guard is sufficient for **field resolution**" | no |

**Near miss — named "resolver state" (1 block, solved).** `opencode sweet r0` s5:
"The remaining blind spot is whether **resolver state** or downstream SQL generation
imposes another depth limit, and which existing test fixture best reproduces two
nested levels." This is the closest a non-measure phrasing gets to the defect, and
it is the one rollout of that group that went on to search the identifier (s22) and
solve.

**Named only recursion/validation/tests (18 blocks).** Representative: codex sweet
r0 s7 "whether nested compilation already works elsewhere and only this guard needs
removal"; ab-oldidx-opencode sweet r0 s5 "whether compilation elsewhere assumes only
one subquery level"; ab-newidx-opencode sweet r2 s6 "whether other resolver state or
SQL rendering assumes only one nesting level".

**Verdict on Q4: the blind-spot field frequently pointed at the right thing and did
not change behaviour.** Two failed rollouts (claudecode r0, codex r1) wrote a blind
spot that names measure resolution as the open question, then closed it without
checking. The state_summary is descriptive, not actionable — nothing in the harness
forces the agent to discharge its own stated blind spot before editing.

---

## 6. Q5 — what `ss-trace` returned

`ss-trace` was called in only **6 of 21** sweet rollouts, and calling it had no
effect on outcome (2 solved / 4 failed, p = 1.0).

| rollout | step | command | mentions `subQueryMeasures` |
|---|---|---|---|
| codex sweet r0 | s12 | `ss-trace checkSubQuery callees --in …/QueryResolver.java` | **no** |
| ab-newidx-opencode sweet r0 | s6 | `ss-trace checkSubQuery callers` | **no** |
| opencode sweet r2 | s6 | `ss-trace checkSubQuery impact` | **no** |
| codex sweet r1 | s16 | `ss-trace toSubQuery callees --in …/QueryResolver.java` | **yes**, once |
| ab-newidx-codex sweet r2 | s11 | `ss-read 230 330 && ss-trace toSubQuery callees` | no |
| ab-newidx-opencode sweet r2 | s7 | `ss-read 225 330 && ss-trace toSubQuery callees` | no |

**On `checkSubQuery` the trace is actively misleading.** It reports `fan-in=0
fan-out=4` and lists the callees as `virtualTableDtos.isEmpty`, `columnSets.isEmpty`,
`parameters.isEmpty`, with critical paths that terminate at
`IllegalArgumentException@external`. Read literally, it says the guard is a leaf with
no state coupling — which is precisely the wrong conclusion.

**On `toSubQuery` the field appears exactly once**, buried mid-line in the callee
list of `codex sweet r1` s16:

```
answer cues: top callees=calls Collections.emptyList (external) | calls Collections.emptySet (external) |
calls Collections.emptyList (external) | calls columns.stream (external) | calls subQueryMeasures.values (external)
```

It is classified `(external)`, identically to `Collections.emptyList`, with no file,
no line, no definition site, and no indication it is a field of the enclosing class
compiled once in the constructor. The model read straight past it (s17, quoted in
§3).

**Would a "fields read by this method" line have named it? Yes, trivially** — it is
the only instance field `toSubQuery` reads. A line of the form
`fields read: this.subQueryMeasures (field L35, assigned in constructor L55 from
query.table.subQuery.measures)` would have carried the whole defect. The value is
not the name — the name was already present at L207 in every sweet rollout — it is
the **assignment site plus its argument**, which is what makes "this is the *outer*
query's measures" legible without a second read.

---

## 7. Q6 — counterfactual, per failed sweet rollout

For each of the 15, the earliest step at which one extra output line could have put
L35/L55 in front of the model before its first edit. Two injection points exist:
a trailer on the singleton `ss-grep`/`ss-search`, or an "unread above" footer on the
first narrow `ss-read`.

| rollout | E1 | earliest anchor | what would have to appear |
|---|---|---|---|
| codex sweet r0 | s17 | **s4** `ss-grep` (1 hit) | grep trailer |
| codex sweet r1 | s19 | **s4** `ss-grep` (1 hit) | grep trailer |
| codex sweet r2 | s15 | **s4** `ss-search` | search trailer |
| opencode sweet r1 | s10 | **s3** `ss-search` | search trailer (no `ss-read` on QR at all before E1) |
| opencode sweet r2 | s11 | **s3** `ss-grep` (1 hit) | grep trailer |
| claudecode sweet r0 | s16 | **s9** `ss-grep "sub-query"` (13 hits) | grep trailer, or s10 read footer |
| ab-newidx-codex sweet r0 | s22 | **s4** `ss-search` | search trailer |
| ab-newidx-codex sweet r1 | s12 | **s4** `ss-search` | search trailer (never `ss-read` QR before E1) |
| ab-newidx-opencode sweet r0 | s10 | **s3** `ss-grep` (1 hit) | grep trailer |
| ab-newidx-opencode sweet r1 | s7 | **s3** `ss-grep` (1 hit) | grep trailer |
| ab-oldidx-codex sweet r0 | s12 | **s9** first `ss-read` on QR | read "unread above" footer |
| ab-oldidx-codex sweet r2 | s17 | **s4** `ss-grep` (1 hit) | grep trailer |
| ab-oldidx-opencode sweet r0 | s11 | **s3** `ss-search` | search trailer |
| ab-oldidx-opencode sweet r1 | s11 | **s3** `ss-search` | search trailer |
| ab-oldidx-opencode sweet r2 | s8 | **s3** `ss-grep` (1 hit) | grep trailer |

In **13 of 15**, the anchor is step 3-5 — the very first search, 5 to 18 steps ahead
of the first edit. In the other two the anchor is the first `ss-read`. There is
plenty of room.

### Would the model have acted on it? Honest answer: split, and it depends on the form.

**Evidence that it would (strong, 4/4).** In every sweet rollout where the
identifier-family listing actually appeared, the correct edit followed almost
immediately:

- `claudecode sweet r2` — **s22** `ss-grep "subQueryMeasures" -k 10` returns
  `7 total match(es) across 2 files` with `QueryResolver.java:35`, `:55`, `:207`
  listed. **s24** is the exact gold edit
  (`this.subQueryMeasures.values()` → `compileMeasures(subQuery.measures, false).values()`).
  Two steps, one intervening no-op `TaskUpdate`.
- `ab-oldidx-codex sweet r1` — s15 `ss-grep "new DatabaseQuery" && ss-grep "subQueryMeasures"`,
  correct edit at s19/s20.
- `claudecode sweet r1` — s10 `ss-search "class DatabaseQuery NestedQueryTable subQueryMeasures"`,
  correct edit at s14.
- `opencode sweet r0` — s22 `ss-grep "class DatabaseQuery|subQueryMeasures|new DatabaseQuery"`,
  correct edit at s29.

**Evidence that it would not (2 hard counterexamples).** A bare mention of the token
is demonstrably insufficient:

1. `codex sweet r1` s16 — `ss-trace` printed `calls subQueryMeasures.values
   (external)` and the model's next sentence dismissed the whole question. A trailer
   that only repeats the identifier would land the same way.
2. `codex sweet r0` s27-s30 — the model had **the full constructor line on screen**,
   articulated the defect correctly at s28, and rejected it at s29 as possible
   overfitting. Surfacing alone does not clear the bar; the model needed a reason to
   believe the concern was load-bearing rather than speculative.

**What separates the two groups.** The four that acted saw the field's **three sites
together as a set** — declaration L35, assignment L55, use L207 — in one compact
output. That co-listing makes "compiled once, read many" visible as a shape. The two
that did not act saw either the name alone (ss-trace callee list) or the assignment
embedded in a 175-line prose slab where it read as ordinary initialisation.

**Concrete recommendation, ranked by expected effect:**

1. **Singleton-hit sibling trailer on `ss-grep`.** When a query returns 1 match,
   spend the unused budget listing same-file identifiers that share the match's
   stem, *with their roles*:
   `same file: subQueryMeasures — field L35, assigned in ctor L55 from
   query.table.subQuery.measures, read L207 (toSubQuery)`. A search-result trailer of this
   kind reaches 14 of the 15 failures (7 via a 1-hit `ss-grep`, 6 via `ss-search`,
   1 via a 13-hit `ss-grep`), at step 3-9, and carries the assignment argument, which is the part that
   makes the defect legible. Cost is a few dozen tokens on a reply that currently
   uses 45.
2. **`ss-read` "unread above" footer.** (The one remaining failure,
   `ab-oldidx-codex sweet r0`, has no `ss-grep`/`ss-search` anchor before its edit and
   is reachable only this way.) Today the footer names only symbols *below*
   the window (`unread below (236-468): compileCriteria, compileMeasure, …`). Adding
   the symmetric upward line — `unread above (1-169): fields (incl. subQueryMeasures),
   QueryResolver(constructor), resolveField…` — reaches the remaining failures and is
   a pure superset of existing behaviour.
3. **`ss-trace` "fields read by this method" line.** Cheapest correctness win for the
   trace itself, and it would fix the actively-misleading `checkSubQuery fan-out=4,
   all leaves` output. Lower expected yield than (1) and (2) because ss-trace is
   called in only 6/21 sweet rollouts, and the one time it did print the name it
   changed nothing.

**Expected yield, stated conservatively.** If the trailer performs like the observed
identifier-family searches (4/4), sweet would go from 6/21 to something near
native's 18/21. If it performs like the bare-token cues (0/2), it changes nothing.
The realistic read is in between and closer to the top: the trailer form proposed in
(1) is a co-listing with roles, which is the form that worked, not the bare mention,
which is the form that failed. A microsmoke on this task plus 1-2 controls would
settle it cheaply — but note this task is now burned for blinded use.

---

## 8. Corrections to premises in the brief

- **`opencode sweet r1` did not read the whole file twice.** It read
  `offset=160 limit=110` (s5) and `offset=260 limit=210` (s9) — two disjoint windows,
  both entirely **below** the constructor. It never saw L35 or L55. The
  `subQueryMeasures` token in its s5 output is L207, the read site.
- **Line numbers**: field is L35 (not ~36), constructor assignment is L55 (not ~52).
- **`claudecode sweet r0` read L1-160, not L1-160-only-in-passing** — L35 and L55
  are both verbatim in that output, so this is a genuine "saw it and edited past it"
  case, and the strongest evidence that surfacing alone is not sufficient.
- **Native's first search is not always a `sub.?query` grep.** On codex it is
  `rg --files` (a directory listing, 89-131 lines); the identifier-family grep comes
  2-5 steps later. On opencode it is `glob **/*`. The operative property is width and
  cheapness, not the specific pattern.
- **Every sweet rollout saw the token `subQueryMeasures` at some point** — L207 is
  inside the `ss-read 170-235` window that nearly all of them opened. "Did the agent
  see the name" is therefore not the discriminator; "did the agent see the
  *assignment*, or go looking for the name" is.
