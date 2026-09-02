# c10 "Absence honesty" — mechanism verification (adversarial)

Verifier: mechanism lens, 2026-09-02. Budget `$0`. Box read-only; scratch under `/tmp/wf-slatec/c10-mechanism/`.

## 0. Verdict

**Refuted as a slate lever. Confidence 0.75.** The three wrapper false-zero paths are real and I
re-derived each one in code and in the traces. But the candidate's harm mechanism is not shown.
The guide sentence never made an agent trust a false zero: in 0 of 83 located false-zero
`ss-grep` calls did the agent state an absence and stop; in 69 of 83 it issued another search
probe within its next three calls `[M c10_stop.py]`. The candidate's own three paths sum to 15
calls in 198 claude-code sweet rollouts, with a next-request envelope of $0.000039 per rollout,
which is 0.19% of the claude-code sweet TAB cell `[M]`; the DEDUP text says "≈12 requests per 66
rollouts ≈0.6%", which is 2.4× too many requests. The flagship bundle case (71 versus 38 tail
requests, +$0.0153) re-derives exactly, but it is the index-exclusion class the register already
holds as E1/E2, not a c10 path. No solve is at stake anywhere in the evidence. Cost sign is at
best zero, as the candidate itself says. Two findings survive and should be re-booked as E2
hygiene, not as a lever: (a) `--in .`, absent-scope and alternation-prefilter fixes; (b) a new,
unlisted false-zero path — the shipped "not indexed" note cannot see an index-time content skip,
so the aws-actions bundle still answers a silent zero after the shipped E1 fix.

## 1. What I opened

Local: `core/search/grep-output-shaping.js`, `core/search/search-pattern.js:148`,
`core/search/search-pattern-planner.js:57`, `core/search/search-pattern-prefilter.js:90-200`,
`core/infrastructure/native-sparse-gram.js:308`, `eval/agent-read-workflows/bin/_ss-helpers.mjs:247-268,328-440,600-660,880-935`,
`core/indexing/admission-policy.js:55-200`, `core/indexing/minified-detector.js`,
`core/indexing/indexer-utils.js:440-500`, the tool guide line 46, the three sibling audit JSONs
under `slate-c/forensics/scripts-claude-main-thread/out/`, and `forensics/{claude-main-thread,verify-tail,phase-anatomy}.md`.

Box (read-only): `results/fp-claudecode-tab-20260826/agent-state/{callstack__react-native-paper-972,aws-actions__configure-aws-credentials-42,bfgroup__b2-113,mathnet__mathnet-numerics-1072}-sweet/claude-home/projects/*/*.jsonl`;
`results/{fp-codex-tab-20260826,fp-opencode-tab-20260826,rp-oc-tab-20260827,fp-claudecode-tab-20260826}/{rows.json,<arm>/patches.json,<arm>/rep-{1,2}/patches.json,agent-state}`;
`/tmp/wf-slatec/verify-tail/tail-census.json`; `/tmp/wf-slatec/claude-main-thread/ss-grep-nomatch-audit.mjs`;
goldens `/root/.ss-eval/golden/{callstack__react-native-paper@3bba0304…,aws-actions__configure-aws-credentials@ee662900…,bfgroup__b2@*}`.

Scripts I wrote: `/tmp/wf-slatec/c10-mechanism/{c10_box.py,c10_ctx.py,c10_stop.py,c10_tail.py}` (copies in my local scratchpad).

## 2. Code half — each path re-derived

| path | claim | what I found | tag |
|---|---|---|---|
| `--in .` | `pathSegments('.')` is empty, so every file is rejected | `matchesGrepFileFilter('src/tools/stage.py','.')` → `false`; same for `'./'`; `'src'`, `'src/tools'`, `'stage.py'` → `true`. The daemon grep path applies this filter at `search-pattern.js:148`. | [M] node call, [C] |
| alternation | native extractor keeps only the branch with a ≥3-char literal | `extractRegexLiteralClauses("_color|_.*,")` → `{"clauses":[["_color"]]}`; `"_.*,"` alone → `{"clauses":[]}` (unfilterable, correct). `extractLiteralClauses` prefers the native result when non-empty (`search-pattern-prefilter.js:161-166`), so the JS heuristic that returns `[]` on any `|` never runs. Planner uses it at `search-pattern-planner.js:57`. | [M] node call, [C] |
| absent scope | wrapper prints `(no matches)` | `excludedScopeNote` returns `null` when `!existsSync(abs)` (`_ss-helpers.mjs:251`); the zero branch prints `note || '(no matches)'` (`:380-381`). `ss-read` has an ENOENT hint; `ss-grep` has none. | [C] |

**The 59 lines.** `grep -rEn "_color|_.*," src/components` on the callstack golden returns 59
lines in 14 files (the report said 12) `[M]`. **0 of the 59 lines contain `_color`** `[M]`; every
match comes from the catch-all branch `_.*,`. The agent's question was whether a `_color`
convention exists. The honest answer was "no". The false zero withheld no useful information in
this one event. The bug is still real, and partial misses (some branches shown, others hidden)
are invisible to a zero-match audit, so the true incidence is under-measured `[I]`.

**Counts, from the sibling audit JSONs `[M]`.** Denominator: 198 claude-code sweet rollouts =
66 TAB + 66 NONE + 66 PIPE. Only TAB is the production form; the other 132 are A/B arms.
692 single-invocation `ss-grep` calls, 219 zero answers.

- `--in .`: 5 calls in 5 rollouts on 3 tasks (`bfgroup__b2-259` ×3, `bfgroup__b2-113` ×1,
  `fastify__fastify-cors-285` ×1); 4 had golden hits, the fastify one was a true negative.
  Hits were in `test/configure.py`, `src/tools/{stage,message,make}.py` and `.jam` files. At
  least one b2 golden index holds the Python files (path strings present in 9 index files) `[M
  grep -F on .sweet-search]`; `.jam` was not indexed at run time (E1).
- absent scope: 11 calls in 7 rollouts on 3 tasks. One of the 11 (`--in .claude`) is not
  absent in the sweet arm, which carries `.claude/rules/sweet-search.md` `[C brief]`; 10 stand.
- alternation with a literal-free branch: 1 call, `callstack__react-native-paper-972` TAB rep 2.
- Codex and opencode were never replayed. Unique command strings in their sweet cells `[M grep]`:
  codex 1 chained `--in .` command (two probes), 2 `--in src/b2`; opencode (rp-oc) 4 `--in src/b2`.
  Zero answers not verified there; the cc-parse-based falsifier is claude-only.

**Price of c10's own classes `[M audit nextReal]`:** 15 calls, following-request cost $0.007761
over 198 rollouts = $0.000039 per rollout = **0.19% of the claude-code sweet TAB cell
($0.020727, sidechain-inclusive) or 0.32% of the rows.json main-thread mean ($0.012317)**.
Upper envelope: the following request would usually happen anyway.

## 3. Guide half — the harm mechanism is not in the traces

Script `c10_stop.py` located 83 of 83 recorded false-zero calls (67 false-negative candidates,
5 `--in .`, 11 absent-scope) in the main-thread transcripts and read what came next.

| class | located | another search probe in next 3 calls | no probe | asserted an absence in next text | asserted AND stopped |
|---|---:|---:|---:|---:|---:|
| false-negative candidate (mostly E1 coverage) | 67 | 56 | 11 | 4 | **0** |
| `--in .` | 5 | 3 | 2 | 0 | **0** |
| absent scope | 11 | 10 | 1 | 0 | **0** |

The 4 absence assertions all sit inside `<state_summary>` blocks and each was followed by more
probes. The 14 "no probe" cases went straight to `Edit`/`run_tests`/`git`; the agent already had
what it needed. Example: `aws-actions` TAB sweet rep 1 (session `59292a49…`) received seven zeros
on `--in dist/index.js`, wrote in its own state summary that the bundle "must reflect the source
change", kept probing (six more `ss-grep`, one `ss-read 34500 35000`), and finished without
editing the bundle `[M c10_ctx.py]`. That is a silent zero causing waste, not a stated absence.
The guide sentence's precondition — two complementary whole-codebase probes — was met by none of
the 83 calls; all were scoped `--in` calls. The guide half has no trace support.

## 4. The flagship bundle case — re-derived, and it is not a c10 path

From `/tmp/wf-slatec/verify-tail/tail-census.json` `[M c10_tail.py]`: aws-actions sweet tails
71 requests / $0.030868 against native 38 / $0.015572; difference **+$0.015296** over 9 sweet
rollouts (matches +$0.0153). From `patches.json` per rep `[M]`: native edited `dist/index.js` in
9 of 9; sweet in 3 of 9 (codex rep 1, rp-oc rep 1 and rep 2). All 18 rollouts solved
`[M rows.json]`. Cost per pooled 66-rollout cell: +$0.000059 codex (0.5%), +$0.000063 opencode
(0.7%), +$0.000110 claude-code (0.5% of the TAB cell) `[I from the totals]`.

This is register E1/E2's class. **But the shipped fixes do not close it.** Facts:
- `dist/index.js` is git-tracked under `dist/` → `admitsShape` re-admits it by path (36b802e) `[C admission-policy.js:171-187]`.
- Its head reads `// webpackBootstrap … __webpack_require__`; `looksMinified` on the golden head returns `{"rule":"bundler-banner"}` `[M local node run on the fetched 32 KiB head]`; median line length is 24, so the median rule alone would not fire `[M]`.
- `indexer-utils.js:440-486` drops a bundler-banner file from the whole index ("drop it entirely") `[C]`.
- `excludedScopeNote` asks `admitsShape(rel)` (path shape), which says admitted → `null` → `(no matches)` `[C _ss-helpers.mjs:259-263]`.

So after a golden rebuild the bundle stays out of the index and `ss-grep --in dist/index.js`
still prints a bare `(no matches)`. The note's predicate and the indexer disagree on exactly the
file that motivated the note. The same holds for the seven `[FALLBACK]` `ss-semantic` spans
(codex 4, opencode 3; `dist/index.js` ×5) `[M grep on agent-state]`. This is a correction to
register rows E1/E2 and the one c10-family item with a live instance.

## 5. Ceiling and solves

- Cost: ≤ 0 by the candidate's own statement; honest answers invite probes. No positive ceiling
  to check against the fresh-pool cells. The c10-own class envelope is 0.19–0.32% of the
  claude-code sweet arm (see §2), not the ~1.2% E1/E2 class the candidate quotes.
- Solves: none at stake. aws-actions 18/18 both arms; `bfgroup__b2-259` 0/3 in every cell;
  `bfgroup__b2-113` is the recorded index-gap task; mathnet solved in the rollouts opened.
- Differential: sweet-only vehicle, but it cannot make sweet cheaper than native. Native `grep`
  on a missing path errors; on `.` it searches. Closing these paths only removes a sweet handicap.

## 6. Corrections the synthesis must adopt

1. Drop the guide half. 0 of 83 false-zero calls in 198 claude-code sweet rollouts ended in a stated absence; the sentence's precondition was never met by a false zero. No `needs_user_decision` remains.
2. Replace "≈12 requests per 66 rollouts ≈0.6%" with "15 following requests per 198 rollouts (5 per 66), $0.000039 per rollout, 0.19% of the TAB cell (0.32% main-thread only)".
3. State the denominator: 198 = 66 production TAB + 132 A/B-form rollouts, claude-code only; codex and opencode zero answers were never replayed.
4. The alternation event: 59 lines, 14 files, 0 lines containing the literal the agent sought; correctness prize of the observed event is nil; keep the fix on code grounds (partial misses are unmeasured).
5. Absent scope: 10 of 11, not 11 (`.claude` exists in the sweet arm).
6. Move the bundle case out of c10's evidence; it is E1/E2's class. Add to E1/E2: the bundler-banner content skip drops `dist/index.js` at index time while the wrapper's note uses path-based admission, so the aws-actions silent zero survives the shipped fixes. Fix: have `excludedScopeNote` consult the index's file table or a skip manifest, not `admitsShape`.
7. Re-book c10 as "E2 hygiene, three wrapper paths plus the content-skip note", ceiling 0, no bench value, `needs_user_decision: no`.

## 7. What I could not finish

- I did not confirm which b2 golden SHA maps to which task, so "hits in indexed files" for the `--in .` calls rests on one golden's index holding the Python paths.
- I did not replay codex or opencode zero answers against goldens; the counts in §2 are unique command strings, not verified zeros.
- I did not re-derive the 13,396-token `ss-read dist/index.js 1 1000` figure (accepted from phase-anatomy §6.5).
- I did not measure the alternation bug's partial-miss incidence; it needs a full-call replay, not a zero-match audit.

## 8. Evidence paths

Local: `slate-c/forensics/scripts-claude-main-thread/out/ss-grep-nomatch-audit-fp-claudecode-{tab,none,pipe}-20260826.json`;
`slate-c/forensics/{claude-main-thread.md §6, verify-tail.md §6, phase-anatomy.md §5-§6.5, S3}`;
`slate-c/candidates/{inversion-and-removal.md C3/A7, DEDUP.md c10}`; `slate-c/register/DEAD-LEVER-REGISTER.md` rows E1, E2, H1.
Box: paths in §1; rollout ids `fp-claudecode-tab-20260826/aws-actions__configure-aws-credentials-42/sweet/r1` (session `59292a49-e299-4039-9…`),
`fp-claudecode-tab-20260826/callstack__react-native-paper-972/sweet/r2` (session `a8e70dc0-5ecf-48fd-a…`),
`fp-claudecode-tab-20260826/bfgroup__b2-113/sweet/r1` (session `47129fb0-de9c-445c-9…`),
`fp-claudecode-tab-20260826/mathnet__mathnet-numerics-1072/sweet/r0,r2`, and the 18 aws-actions rollouts listed in §4.
