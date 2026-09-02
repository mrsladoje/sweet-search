# c10 — adversarial verify, DIFFERENTIAL and MEASURABILITY lens

**Verdict: REFUTED as a slate-C lever. Confidence 0.72.** The vehicle is clean and the code
half is a real sweet-only defect package, but the effect cannot be measured on this bench.
Every priced component of c10 sits 5 to 45 times below the cost noise floor, and no recorded
rollout ever changed its solve outcome because of these paths. Half the candidate (the guide
sentence) cannot be falsified at $0 at all, and its stated kill number is smaller than the
bench's own null spread on the exact metric it names. I found no hard rule violation. I did
find one unrecorded defect that makes the package fail to close its own headline case; that
finding is a correction, not a rescue.

---

## 1. What passes

**Differential: PASSES.** The vehicle is `grep-output-shaping.js`, `_ss-helpers.mjs`, the
native literal extractor behind `ss-grep`, and the sweet-only tool guide. None of these is
the shared benchmark prompt, the shared `run_tests` shim, or a shared harness setting. The
native arm uses `rg`/`grep`/`sed` on the working tree and cannot inherit any of it. So
`sweet_only: yes` is correct and rule 6 is not touched.

**Admissible class: PASSES.** This is not "the same lines rendered smaller". The alternation
fix returns 59 lines that are currently dropped. The `.` scope fix returns matches from files
the filter currently rejects outright. An error line in place of a false negative changes
which request the agent issues next. Rule 7 is not touched.

**Rules: no hard violation found.** No HO2 access. No gold, task identity, or hidden test as
a runtime input. The alternation prefilter is candidate generation for regex grep, not an NL
ranking signal, so the `_isAgentFormat` gate in `CLAUDE.md` does not apply and GCSN cannot
move. The guide sentence sits inside the owner-protected guidance block and the candidate
already flags `needs_user_decision`.

## 2. Code claims I re-derived myself

| claim | check | result |
|---|---|---|
| `pathSegments` drops `.`, so `--in .` rejects every file | ran `matchesGrepFileFilter` on the real module | `("src/tools/stage.py", ".") → false`, `("…", "./") → false`, `("…", ".//") → false`, `("…", "./src") → true` [M] |
| alternation prefilter drops real matches | `grep -REn "_color\|_.*," src/components` in the callstack golden on the box | **59 matching lines in 14 files** [M], matching `forensics/claude-main-thread.md` §6.2 |
| `excludedScopeNote` returns null for an absent path | `_ss-helpers.mjs:249` `if (!existsSync(abs)) return null;` | confirmed [C] |
| `ss-read` on an *existing but unindexed* file gets no note | `_ss-helpers.mjs:631-645` — `excludedScopeNote` is on the ENOENT branch only | confirmed [C]; a bundle read succeeds and returns its bytes with no note |
| `ss-semantic` `[FALLBACK]` carries no note | `_ss-helpers.mjs:928` prints the flag and the spans, nothing else | confirmed [C] |
| the guide sentence exists as quoted | guide line 45-46, heading "A confirmed absence is a complete search answer" | confirmed [C] |
| `[FALLBACK]` events are single digits | `grep -rho "\[FALLBACK\]"` over the TAB-form `agent-state` trees | codex 4, opencode repair pass 6, claude-code 0 = **10 raw occurrences** over 198 TAB sweet rollouts [M]; the forensics report's deduplicated figure is 7 |

Goldens are present today: `/root/.ss-eval/golden` holds **457** checkouts including
`aws-actions__configure-aws-credentials@ee6629…` and `callstack__react-native-paper@3bba03…`
[M]. So the code half's $0 replay is runnable right now. Memory note `golden-cache-not-durable`
warns they evaporate and preflight does not check them, so the falsifier should be run before
anything else in the plan.

## 3. The finding that changes the mechanism list

**The shipped 2026-08-28 fixes do not close c10's own headline case, and the proposed fix as
written would not close it either.**

On the real aws-actions golden [M, both run against the box copy]:

- `createAdmissionPolicy(...).admitsShape('dist/index.js')` returns **true**. The file is
  git-tracked and its only exclusion reason is the `dist/` build-output directory, so
  commit 36b802e re-admits it.
- `looksMinified(head, {ext:'.js', tailText, totalBytes:5239473})` returns
  **`{rule: 'bundler-banner'}`**. Commit fb9f936's content-shape skip therefore removes the
  file at index time. Its whole-file mean line length is 177.9 characters, so the Linguist
  mean rule would catch it too [M, `awk` over the golden].

`excludedScopeNote` decides a **file** scope by `!admitsShape(rel)` [C `_ss-helpers.mjs:263`].
Because `admitsShape` now says "admitted" while the indexer skips the file, the note returns
null and `ss-grep "…" --in dist/index.js` **still prints "(no matches)"** after both shipped
commits. The "not indexed" note and the whole absence-honesty package are keyed to the wrong
oracle. Any fix must ask what the index actually holds, not what the shape gate allows.

Second gap the candidate does not name: the note fires only when `--in` is present
(`_ss-helpers.mjs:380` maps over `inPaths`) [C]. Most zero answers are unscoped — 87 of 241
single `ss-grep` calls answered zero on the TAB form [M forensics §6.1] — and those get a bare
"(no matches)" with no coverage information at all. Covering them enlarges the build well
beyond "1-2 days plus one sentence".

## 4. Measurability: the refutation

### 4.1 Cost is far below the floor

Bench noise, from the brief: cost intervals of about **±$0.001 to ±$0.005 per rollout**.
Sweet rollouts cost $0.012330 codex, $0.009265 opencode, $0.020727 claude-code.

| component | measured price per sweet rollout | ratio to the tightest ±$0.001 bound |
|---|---:|---:|
| every request following **all 71** zero-answer candidates (198 rollouts, $0.0385 total) | $0.000195 [M forensics §6.1] | 5.1× below |
| **residual after E1/E2**: 7 of 71 candidates are the new classes | ≈$0.000019 [I, pro-rata] | 53× below |
| aws-actions bundle hunt, claude-code cell (the largest single instance) | $0.000110 [M verify-tail §6] | 9.1× below |
| aws-actions, codex / opencode cells | $0.000059 / $0.000063 [M] | 16-17× below |
| 7-10 `ss-semantic` `[FALLBACK]` spans at ~2.8 kB | ≈$0.000007 [I] | 140× below |

The decisive split: **64 of 71 zero-answer candidates (90.1%) are index-coverage exclusions
already in the SHIPPED E1/E2 class** [M forensics §6.1 table: 27+20+17 of 29+24+18]. Only
**2 are genuine misses and 5 are mixed**. c10's new mechanisms therefore address about a tenth
of a class that is itself five times smaller than the smallest interval the bench can read.

### 4.2 Solves: no events at all

Across the fresh pool and its two null variants, these paths flipped **0 solves**. All 18
aws-actions rollouts solved [M verify-tail §6]. The pre-registered solve bar is ±6 rollouts of
66. One genuine alternation miss per 198 rollouts cannot produce a reading against that bar in
any affordable cohort.

### 4.3 The guide half's kill number is inside the null

The candidate's guide kill condition is "honest wording raises `ss-*` calls per sweet rollout
>10% in a later paired run". I measured that exact metric across the three gutter forms, which
the fresh pool proved to be **one treatment** (all forms within 3 rollouts, Fisher p ≥ 0.72),
so their spread is a null-treatment estimate. Opencode rows merge `fp-opencode-<form>-20260826`
with the `rp-oc-<form>-20260827` repair pass, later run winning, giving n=66 per cell [M]:

| harness | TAB | NONE | PIPE | spread | spread / mean |
|---|---:|---:|---:|---:|---:|
| codex | 8.197 | 8.167 | 7.955 | 0.242 | **3.0%** |
| claude-code | 13.545 | 13.788 | 13.470 | 0.318 | **2.3%** |
| opencode | 10.758 | 11.167 | 9.576 | 1.591 | **15.2%** |

On opencode a null already moves `ss-*` calls per sweet rollout by 15.2%, half again the
candidate's 10% bar. The bar cannot discriminate there. On codex and claude-code a 10% bar
clears the 2-3% null, but only in a **paid** paired run, which this slate forbids. So the
guide half has no $0 falsifier and an invalid number on one of three harnesses.

### 4.4 The code half's kill condition is real but sits at the corpus resolution limit

"Genuine false absences still above 1 per 200 rollouts after the fixes" is checkable, because
the replay is a deterministic census rather than a sample. It is pre-registrable and $0 today.
But the pre-fix census counted **2** genuine misses in 71 candidates over 198 rollouts, so the
bar is one count wide. Note the source seed states the condition inverted
(`forensics/claude-main-thread.md` §8 S1: "kill if <1 genuine miss … remains after the fix"),
which would kill on success. The candidate's wording is the coherent one; the synthesis should
carry the candidate's, not the seed's.

## 5. Direction of travel

The guide sentence at line 46 currently ends "state the negative and stop searching: no third
synonym, no `find`/`ls`/`cat` enumeration, no native scan" [C]. It is a **stop** rule. Replacing
it with a searchability-conditioned rule removes a stop and adds probes. Requests are the cost
multiplier on this bench: a token that enters context is billed 2.2 to 3.1 times sticker, at
12.4 to 21.4 re-sends per ingested token [brief §1.1]. The candidate agrees ("requests expected
to rise"). So the guide half moves the head-to-head number the wrong way, with no solve
evidence to pay for it, and rule 9 makes solve the veto.

## 6. Register check the candidate omitted

The candidate checks itself against E1, E2, D6 and D7. The nearest register entry for the
**guide sentence** is **B2** (tool-guide trim, CLOSED; guidance block owner-protected) plus the
2026-08-28 disposition on C2: the guide is produced by the prompt-optimisation process and used
verbatim, every addition since has shipped on a measured smoke, and "a hand-written arm is
outside the prompt process that owns the guide"
[C `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §5.1 C2 and §6]. The same section records that
a guide A/B "had no power for its own bars". The candidate must cite B2 and that disposition.

## 7. What I could not finish

- I did not re-derive the "5 of 5 `--in .` calls" or the "11 absent-scope calls" counts. I take
  them from `forensics/claude-main-thread.md` §6.2 [M, second-hand].
- I did not confirm what the current index physically contains for any golden. Doing so needs an
  index build, which is a write.
- I did not reconcile my 10 raw `[FALLBACK]` occurrences with the forensics report's
  deduplicated 7. Both are single digits per 198 rollouts, so the conclusion is unaffected.
- I did not price the full-scan latency that removing the literal clause for a literal-free
  alternation branch would impose on the human `sweet grep` path.

## 8. Evidence paths

Local: `core/search/grep-output-shaping.js:16-19,67-68`;
`eval/agent-read-workflows/bin/_ss-helpers.mjs:247-268,368-386,631-645,900-935`;
`core/indexing/admission-policy.js:76-88,165-183`; `core/indexing/minified-detector.js:20-92`;
`core/indexing/indexer-utils.js:439-482`;
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md:45-46`;
`eval/task-completion-bench/handoffs/improve/HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md:27,292,366,419`;
`.../slate-c/forensics/claude-main-thread.md:19,115,205-262`;
`.../slate-c/forensics/verify-tail.md:93-99`; `.../slate-c/forensics/phase-anatomy.md:11,183,265,299`;
`.../slate-c/candidates/DEDUP.md:189`; `.../slate-c/candidates/inversion-and-removal.md:178-179,566`.

Box (read-only): `/root/.ss-eval/golden` (457 checkouts);
`/root/.ss-eval/golden/aws-actions__configure-aws-credentials@ee662900a535695aa526bd6dbba07d8f16805198/dist/index.js`;
`/root/.ss-eval/golden/callstack__react-native-paper@3bba0304e6b03e9a5bdc7baeb5547ac67bb32e7b/src/components`;
`results/fp-{codex,opencode,claudecode}-{tab,none,pipe}-20260826/rows.json`;
`results/rp-oc-{tab,none,pipe}-20260827/rows.json`;
`results/fp-*-tab-20260826/agent-state/**`.
