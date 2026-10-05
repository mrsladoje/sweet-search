# Trace read — Claude Code + Opus 5.5 medium, final comparison (DEV questions)

Runs: `results/r282-cc-opus55-medium-final-r1` and `-r2`. Arms: `sweet` = after (6b50d7c5), `before` = d013b492, `native` = no sweet-search (r1 only).
Every call and output of every arm and rep was read for the 10 swing questions below. Timing comes from the Claude Code session transcripts in `~/.ss-eval/r282/cc-opus55-medium-final-r{1,2}/claude-home-*/projects/*/*.jsonl` (tool_use timestamp → tool_result timestamp).

## Bottom line

- No loss of the after arm is a regression of the after code. Every score loss traces to the model stopping one hop early, or to judge variance between answers that are equal in substance.
- The cost gains are real. They come mostly from full-line `ss-grep` output: the model sees the code on the hit line and skips one or more reads.
- The +18% wall time is not slower tools and not more model time. It is the first ss-* call of a session, which in the after arm often waited for a cold daemon start (3–65 s). With the first call taken out, after is 0.8 s per question faster than before.
- There is one real after-code defect: an `ss-search` result can stop mid-function with no "not shown" marker while its header claims the whole range (dgraph-29). It did not cost points here, but it cost one extra call.

## Per swing

| Question | Scores after / before / native | One-line cause |
|---|---|---|
| r3hb-grdb-07 (cost ↓, score 0.30 in after r1) | 0.30, 0.92 / 0.85, 0.75 / 0.70 | After r1 scoped its first grep to one file and used a narrow second regex, so it never saw `SerializedDatabase.preconditionNoUnsafeTransactionLeft` (CRITICAL). After r2 ran a broad grep, and the full hit line `SerializedDatabase.swift:304: …allowsUnsafeTransactions \|\| !db.isInsideTransaction,` led it there. Model path. Cost ↓ from full lines (3–4 calls against 8 and 5). |
| r3hb-sequel-08 (cost ↓) | 1.0, 0.9 / 0.875, 0.925 / 1.0 | Full lines (`base.rb:1099: @fast_pk_lookup_sql = if @simple_table && @simple_pk`, `self.simple_table = if ds.send(:simple_select_all?)`) replaced the repo-wide first grep and a 5-range read. 2–4 calls against 5–6. Quality held. |
| r3h-typedoc-23 (score 0 → 0.5 in after r2; cost ↑ in r2) | 0, 0.5 / 0, 0 / 0 | Negative-decoy question with a false premise. Gold: `getRelativeUrl` has zero callers, and router links are always relative. 4 of 5 runs read the branch and stated that every link goes through it. After r2 alone grepped for callers (one hit, the definition) and read the router: 9 calls, 2.5× cost, 0.5. Model path, not a tool change. Native found more facts but hedged and also scored 0, which is judge variance. |
| r3hb-grdb-11 (cost ↓) | 0.90, 1.0 / 0.90, 0.85 / 1.0 | After's first grep used the right identifiers (`columnsForPrimaryKey\|schemaSource`). Before's first grep guessed wrong names (0 hits), then ran an `ss-search` that returned mostly tests and read a whole 218-line file. Full lines then took after straight to targeted reads. It is not clear why after guessed right: rules v3 or variance. |
| r3hb-okhttp-12 (cost ↓) | 0.9, 0.85 / 1.0, 0.85 / 0.9 | `-g '!*Test*'` (rules v3 flag line) cut 134 hits in 38 files to 50 in 13. Full lines showed `RealCall.kt:74 … = client.con…` against `:277 … chain.connectionPool.delegate` in call 1. 3 calls against 4–5, about −20% cost. Before r1's 1.0 adds two optional facts (the network-interceptor refusal and `ConnectPlan`). Judge and optional-fact variance. |
| r3-dgraph-29 (score ↑) | 0.85, 0.95 / 0.65, 0.70 / 1.0 | New chunker plus exact semantic ranges. Before's top result was `abortOldTransactions` with the `calculateSnapshot` doc comment glued to its end and no body. After returned `calculateSnapshot` itself with body (r2: doc comment and body in one search). Native alone found the CDC half of the cut-point minimum (`x.Min(Oracle, cdcTracker.getTs())`, draft.go:1135). |
| r3hb-composer-07 (score ↓, also after < native) | 0.65, 0.70 / 1.0, 0.75 / 0.85 | Before r1's 1.0 comes from one extra grep (`cleanupExecuted\|additionalCleanupPaths`) that found the `ZipDownloader` abort fact. Before r2 skipped it and scored 0.75, the same substance as after r2 (0.70). No grep dropped a gold hit: hit counts were 38/8/14/9, so the 60-char window and the guarantee rule did not act, and `-g '!tests/**'` removed only test noise. Model path. |
| r3h-zipkin-22 (score ↓) | 0.85, 0.70 / 0.9, 0.9 / 0.8 | All arms cover both CRITICAL facts. Before used `ss-search` / `ss-find`, whose headers name `apply (method)`. After used `ss-grep` + `ss-read`, which show no enclosing symbol. After r2 never named `BatchInsertSpans.apply` and lost points for it. Mostly tool-choice and judge variance. |
| r3-ocelot-03 (after < native) | 0.60, 0.70 / 0.75, 0.70 / 1.0 | All four sweet answers have facts 1–3 and miss fact 4, the `DownstreamPathPlaceholderReplacer.Replace` step. They label it "inferred" ("I didn't open the URL-building middleware"). Native ran one more grep (`TemplatePlaceholderNameAndValues\|Replace(`) and found it. A 2-call stopping habit, not a tool defect. The spread across sweet runs is judge noise. |
| r3h-typedoc-16 (after < native) | 0.8, 0.7 / 0.7, 0.6 / 0.9 | All five answers get both CRITICAL facts (`commentStyle` values, the triple-slash range). Native also names `collectCommentRanges` and the Converter handoff (non-critical). After r2 had `converter.ts:804` and `index.ts:203` on screen and left them out. Answer coverage plus judge noise. After is about 10% cheaper than before, from full lines. |

## ss-* defects found

1. **Silent truncation in `ss-search` results (real, after code).** dgraph-29 after r1, `ss-search "WAL truncation safe cut point snapshot cannot delete beyond committed index"`. Result `## #2 worker/draft.go:1756-1894 [method: calculateSnapshot]` stops at line ~1809 (`maxCommitTs := snap.ReadTs`), and the code block closes with no `// ... (N more lines)` or `# not shown` line. Result #1 (`applyCommitted`, 617-829) correctly prints `// ... (57 more lines)`. The cut hides the cut-point scan (`snapshotIdx = entry.Index - 1`). The model needed an extra `ss-read`. This breaks the "exact headers, # not shown lines" contract of the exact-semantic-ranges change. Fix: every result whose shown code ends before its header's end line must print the not-shown marker, or the header must show the printed range.
2. **Graph "related" noise (minor).** In the same output, the Go method `applyCommitted` lists `type Node → graphql/resolve/schema.graphql:413-415` and `type State → graphql/e2e/auth/auth_test.go`: same-name, unrelated types.
3. **`-g` basename glob gives no hint (minor usability).** zipkin-22 after r1: `ss-grep "onDuplicateKeyUpdate|onConflict|ON DUPLICATE" -g '*mysql*'` → 0 matches, and the note "-g '*mysql*' removed all 1 match(es)". The file is `zipkin-storage/mysql-v1/…/MySQLSpanConsumer.java`. The glob is matched against the case-sensitive basename, as ripgrep does. The note was accurate and the model recovered in one call. A hint such as "the glob matches file names, case-sensitive; try `-g '**/mysql*/**'`" would save the call.
4. **One-line-per-file picks are sometimes off (minor).** typedoc-16 after: at `-k 15`, the `typedoc.ts` hit showed the `help:` line, not the `name:` line. grdb-11 after r1: 17 test lines ranked before `Configuration.swift:441` and `Migration.swift:31` in a `-k 40` grep, but the key lines were still shown.
5. **Not defects (checked).** grdb-07 `scope not found: GRDB/Core/Pool.swift … This is NOT an absence of matches` is correct (the file is `GRDB/Utils/Pool.swift`). It could add a "did you mean" by basename. `ss-read` with gutter none and a start in mid-function shows no enclosing symbol name (zipkin-22, typedoc-16), which makes citations approximate. No score effect was visible.

No error, wrong result or truncated hit line hid a gold item in any grep. The 60-char window acted only on greps with 50 or more hits, and in those runs it cut only noise lines (grdb-07 r2, grdb-11).

## Wall time (+18% after against before)

Per-call timing from the transcripts, all 30 questions × 2 reps:

| Arm | Mean session s | Tool s | Model s | First ss-* call: mean / max s | Later calls median s |
|---|---|---|---|---|---|
| after (sweet) | 19.5 | 5.9 | 13.5 | 4.6 / 64.7 | 0.2 |
| before | 16.7 | 1.9 | 14.7 | 1.0 / 10.4 | 0.3 |
| native | 18.1 | 1.0 | 17.2 | 0.5 / 3.3 | 0.1 |

- Paired after − before: mean +2.8 s, median +0.1 s per question. Model time is **−1.2 s** (fewer turns). With the first call of each session taken out, after is **−0.8 s** per question.
- Sum of first-call time: after 278 s against before 63 s. This difference (215 s) is more than the whole wall difference (166 s).
- First calls of more than 2.5 s: after 10/30 (r1) and 13/30 (r2); before 5/30 (r1) and 0/30 (r2).
- The slow first calls are cold daemon starts. In r2, every after-arm daemon in `runtime/daemons.json` has `startedAt` equal to that repo's first question call (grdb 23:05:15, jj 23:05:51 …). The bench had warmed them at 23:02:57–23:03:18 (`query-telemetry.jsonl` "warmup" rows), so the warmed daemons were gone or not used. In before r2, the daemons date from the warm-up (22:49–22:51) and served the questions warm (first call 0.2–1.0 s).
- r1 had the worst cases: grdb 64.7 s and 28.6 s (two sessions waited together and finished at the same second), drogon 37.9 s, composer 12.5 s and 12.0 s. Each repo's maintainer was also indexing the 6 `.claude/*` files that the product install writes after the warm-up ("Dirty scan enqueued 6 file(s)"), so the machine was loaded. Before r1 had the same maintainer work, but fewer cold starts.
- The reason the after arm's warmed daemons did not survive to the first question is not proven. Candidates: the 3-daemon cap that the shims set (`SWEET_SEARCH_MAX_DAEMONS ??= '3'`), now applied per cell through `SWEET_SEARCH_RUNTIME_DIR`, which evicts warmed daemons by LRU; or the daemon-spawn changes in 54034ce5 / 770ffd87. One cheap check: after the warm phase, list live `sweet-search-daemon` processes per arm.
- Conclusion: the wall increase is a bench daemon-residency effect, not tool latency of the new grep or search code. Later calls are as fast as before (median 0.2 s against 0.3 s). The cost comparison is not affected, because daemon waits cost no tokens. For a fair wall comparison, re-warm right before the first question or raise the cap to the repo count.

## Regressions that need a fix

- **None in score.** Every after loss (grdb-07 r1, composer-07, zipkin-22, ocelot-03, typedoc-16) has a matching before or native run with the same substance and a similar score, or a clear stop-early model choice.
- **Fix:** defect 1 (the silent `ss-search` truncation, after code).
- **Optional:** the bench warm-up / daemon-cap interaction, before any wall-time claim.
- **Optional, prompt side, not code:** a recurring loss pattern is "stops one hop early and labels the last step inferred" (ocelot-03, composer-07, grdb-07 r1, typedoc-23). Such a hint must not be tuned on these DEV questions alone.
