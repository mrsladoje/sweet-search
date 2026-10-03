# Suggested plan: ss-grep line allocation, and where divisor methods belong

Date: 2026-10-02 (revised the same day after a second review; Section 2.1 lists the changes).
Scope: the ss-grep allocator shipped in `cc965267` (Sainte-Laguë over
`sqrt(hits) x file-type prior`), the follow-up recommendations made in the first review, and
whether the same idea should spread to ss-semantic, ss-trace, ss-search and ss-find.

**Status of the evidence.** Every number below comes from **dev** data (r3 dev probes, seed-42
split); no held-out probe was opened. It is **exploratory**: the approaches were chosen after
looking at all 133 dev probes, so splitting those probes now measures consistency, not
confirmation. Confirmation needs fresh dev probes (Step 0). All confidence intervals are 95%, from
2,000 bootstrap resamples **of probes** (calls from one probe move together), seed 7.

---

## 1. Summary

1. **Keep the new file ordering; it is where the gain came from.** Ordering files by
   `sqrt(hits) x prior` instead of the alphabet explains the whole inclusion gain over the old
   output. With the file order held fixed, Sainte-Laguë itself *lowers* answer-file inclusion by
   2.7 points (83.0% vs 85.6% for round robin in the same order; CI −5.6 to −0.5), in exchange for
   more lines in the top files.
2. **Build declaration-first line selection first.** Showing a file's declaration lines first, and
   lines outside every symbol last, raises the replay's answer-symbol metric from 84.8% to 89.4%
   overall, and from 37.8% to 51.9% on searches where more files matched than fit. It needs only the
   code-graph index and no keyword lists. It must be gated on index freshness, and it can push usage
   lines out of the display.
3. **Compare allocators as a grid, not a single swap.** The evidence supports testing a **first-line
   guarantee** (every kept file gets one line before any file gets a second). Huntington–Hill gives
   the same results here, so it has no shown advantage over that simpler control. The saturating
   weight `hits / (hits + 2)` stays in the comparison: under Sainte-Laguë it reached 86.2% inclusion
   with 2.28 answer lines. Whether inclusion or depth matters more is unresolved.
4. **ss-semantic: fix the displayed line ranges first.** 55% of calls hit the 600-token cap. The
   header then claims a median of 49 more lines than were printed. That is a correctness fix.
   Choosing a different chunk inside an oversized span is a separate retrieval experiment.
5. **ss-trace: measure the causes before changing budgets.** Lists are shortened in more places than
   first counted (impact paths in 42 of 185 targets), but section budgets, item limits and code
   previews are not yet separated. This stays below the grep and semantic work.
6. **ss-search and ss-find have the most headroom but an unmeasured cost**, so measure first.
7. **Promotion needs more than micro-smokes.** Use them to screen. Turn a default on only after a
   broader paired evaluation on fresh probes across question types, with repeated solves and total
   cost.

---

## 2. Where I agree and disagree with the first review

| First-review claim | Verdict | Evidence (section) |
|---|---|---|
| Better file ordering provides most of the recall gain | Agree, and it is *all* of the inclusion gain | 3.2 |
| Isolate Sainte-Laguë from the weight change | Agree; done: Sainte-Laguë costs 2.7 points of inclusion | 3.2 |
| Select better lines within each file first | Agree; it is the largest lever measured | 3.3 |
| Test a bounded hit-count function (BM25-style saturation) | Agree: keep it in the comparison | 3.2, 3.5 |
| Count distinct matching regions instead of lines | Tested: +0.8 points, within noise; not worth it now | 3.5 |
| Keep file-type priors sensitive to intent | Agree, but the replay cannot measure the test prior at all | 3.5 |
| ss-semantic is the highest priority outside grep | Agree; the first fix is the displayed range, and chunk selection is separate | 3.6 |
| ss-trace is a strong candidate | Partly: lists are often shortened, but the cause is unmeasured, so it stays below grep and semantic | 3.7 |
| ss-search / ss-find: vary snippet depth, keep MMR | Agree, after an offline measurement | 3.8 |
| ss-read: preserve requested content | Agree | — |
| Dang & Croft (SIGIR 2012) apply Sainte-Laguë to diversification | Verified (PM-1, PM-2) | 3.9 |

### 2.1 Corrections after the second review

All seven points were checked and accepted.

1. **Contaminated confirmation split.** The first version proposed splitting the same 133 probes
   into tuning and confirmation halves after they had chosen the approaches. Step 0 now requires
   fresh dev probes for confirmation, and labels the existing results exploratory. The collector must
   verify repository revisions and index identity. Checked afterwards: all 11 repositories were at the
   probes' `repoSha` with clean tracked files, but the collector did not enforce it, and the index
   version was not recorded.
2. **Saturating weight.** The first version rejected it because its curve looked too flat, but its
   own replay shows `hits / (hits + 2)` with the highest inclusion. Matching a bucketed answer-rate
   curve does not decide allocation under a fixed line limit. It is back in the comparison (Step 2).
3. **Huntington–Hill vs a first-line guarantee.** Reproduced: "one line per kept file, then the
   existing Sainte-Laguë" matches Huntington–Hill on overflow calls (85.6%, 2.10 answer lines), and
   gives 6.20 vs 6.19 answer lines when files fit. Step 2 now tests the guarantee and the grid. The
   pagination paper is cited only for what it measured: single-turn file localisation.
4. **Stale index.** The claim that the worst case is today's prefix order was false. A stale entry
   can promote a later match above an earlier useful one, and the line limit then drops the earlier
   one. Step 1 now gates on freshness, states the residual risk, and adds the tests. "Keeps usage
   lines" was also misleading: candidates stay stored, but displayed usage lines can be lost.
5. **Trace measurement too narrow.** Reproduced: 42 targets have shortened impact-path lists, and 44
   have caller or callee items with preview or summary code (the second review counted 27 under a
   different definition). One nuance: in 41 of the 42, the call's mode word hides the impact section,
   so the agent never saw that cut. The causes stay unseparated; trace work moves to "Later" behind a
   cause-classification step.
6. **Semantic step mixed a fix with an experiment.** Split into Step 3a (accurate displayed ranges:
   exact ranges, separate ranges for separate excerpts, omitted content reported before and after,
   over-long single lines, ledger rules) and Step 3b (chunk selection).
7. **Weak promotion criteria.** Micro-smokes now screen only. Promotion requires a broader paired
   evaluation (Section 5). The fidelity check now compares selected lines, ordering, markers and
   ranges, and latency is measured through the real tool including graph reads.

---

## 3. Evidence

### 3.1 Data and method

- **Calls:** 1,253 unscoped ss-grep calls from the r3 forensic dossiers
  (`core/prompt-optimization/data/final-tuning/forensics/hard-dossiers/`, dev probes only). 1,037
  calls have an answer file among their matches: 124 *overflow* calls (more matching files than
  the line budget `k`) and 913 *fits* calls. They come from 133 probes in 11 repositories.
- **Answer files and symbols:** each probe's `expectedFiles` and `expectedSymbols`.
- **Matches:** `rg` on `eval/repos/r3-*`, with the same flags as the call (the earlier replay used
  `rg -c`; this one adds line numbers with `rg -n`).
- **Revisions:** the collector did **not** enforce each probe's `repoSha`. A later check found all 11
  checkouts at the recorded `repoSha` with clean tracked files. The index build that supplied the
  symbol spans was not recorded.
- **Symbol spans:** the `entities` table of each repo's `code-graph.db` (read from copies in `/tmp`;
  the `.sweet-search/` directories were not written).
- **Line-level metric ("answer-symbol hit"):** of the answer symbols that contain at least one match,
  the share for which a *shown* line falls inside the symbol's span. A stricter variant counts only
  the declaration line (the symbol's first four lines, with its name on the line).
- **Engine parameters as shipped:** `maxFiles = k`, `perFileCap = min(k, 100)`.

Scripts (temporary): `/tmp/ss-alloc-research/{sim2,control,collect_lines,linesim,robust,regions,outside}.py`
and `trace_budget{,2}.mjs`. Step 0 moves them into the repo.

### 3.2 File allocation: the ordering did the work

Overflow calls (n = 124 calls from 69 probes):

| Ordering weight | Allocation | Answer files shown | Lines from answer files |
|---|---|---|---|
| alphabetical | round robin (legacy) | 71.1% | 1.69 |
| `hits x prior` | round robin | 80.4% | 1.95 |
| `sqrt(hits) x prior` | round robin | 85.6% | 2.10 |
| `sqrt(hits) x prior` | **Sainte-Laguë (shipped)** | 83.0% | **2.51** |
| `sqrt(hits) x prior` | first-line guarantee, then Sainte-Laguë | 85.6% | 2.10 |
| `sqrt(hits) x prior` | Huntington–Hill | 85.6% | 2.10 |
| `sqrt(hits) x prior` | Sainte-Laguë, first divisor 0.7 | 85.6% | 2.31 |
| `hits / (hits + 2) x prior` | Sainte-Laguë | **86.2%** | 2.28 |
| `hits / (hits + 2) x prior` | first-line guarantee or Huntington–Hill | 86.2% | 2.12 |
| `hits / (hits + 4) x prior` | Sainte-Laguë | 82.3% | 2.40 |
| `sqrt(hits)`, no prior | Sainte-Laguë | 72.8% | 1.98 |

How to read it:

- **Inclusion depends on the order.** A file with no line has the highest priority it will ever
  have, so under Sainte-Laguë the files that get any line are a prefix of the weight order. Round
  robin gives a line to each of the first `k` files in that order, which is a superset. On overflow
  calls, any first-line guarantee reduces to round robin over the top `k` files, which is why the
  guarantee, Huntington–Hill and round robin coincide there.
- **The saturating weight's inclusion edge is also an ordering effect.** It gives 86.2% under every
  allocation rule, because a flatter weight lets the prior dominate the order. Under Sainte-Laguë it
  also keeps more depth (2.28) than the guarantee (2.12). Its constant matters: `hits / (hits + 4)`
  drops to 82.3%. Fix the constant before confirmation, and do not tune it on confirmation probes.
- **The earlier comparison changed two things at once.** "Ranked round robin 81.5% vs Sainte-Laguë
  83.0%" changed the order as well as the allocation. Ordering by `sqrt(hits) x prior` is ordering by
  `hits x prior²`, which divides a test file's hit count by 4 rather than 2. (My 80.4% differs from
  81.5% only in tie-breaking and the per-file cap.)

Paired differences, overflow calls:

| Contrast | Answer files shown | Answer lines |
|---|---|---|
| Shipped − round robin in the same order | −2.7 pts [−5.6, −0.5] | +0.41 [+0.21, +0.62] |
| Huntington–Hill (= guarantee here) − shipped | +2.7 pts [+0.5, +5.6] | −0.41 [−0.62, −0.21] |
| `sqrt(hits) x prior` order − `hits x prior` order (both round robin) | +5.2 pts [+2.4, +8.6] | +0.15 |

**When all files fit**, the shipped rule leaves a matching file with **no line** in 58 of 913 calls.
None of those files was an answer file in this replay, but it breaks grep's usual promise that every
matching file appears when they all fit. Mean answer lines when files fit: shipped 6.25, guarantee
then Sainte-Laguë 6.20, Huntington–Hill 6.19, round robin 5.85.

### 3.3 Line choice inside a file is the bigger lever

Today the renderer prints a file's *first* `a` stored matches in line order
(`renderGrepBodyWeighted`, `kept[base + j]`). Those are often imports, package lines or header
comments. Replay over 905 calls with reachable answer-symbol evidence (130 probes):

| Within-file rule (shipped allocation) | All calls | Overflow calls (107) |
|---|---|---|
| First `a` matches (shipped) | 84.8% | 37.8% |
| Declaration lines first | 88.1% | 47.6% |
| Declarations first, lines outside every symbol last (**index only**) | **89.4%** | **51.9%** |
| Declarations first, import/comment lines last (keyword shape list) | 89.0% (+4.2 [+2.9, +5.5]) | 52.5% (+14.6 [+8.6, +21.2]) |
| Spread across enclosing symbols, declarations first, imports last | 91.1% (+6.3 [+4.8, +7.9]) | 52.5% |

The answer symbol's declaration line itself is shown in 82.8% of calls under the shipped rule and
96.0% with declarations first (overflow calls: 24.5% → 71.8%).

Consistency, not confirmation: the gain from "declarations first, imports last" is +4.5 and +4.0
points in two halves of the probes, and positive in every repository (+2.2 to +10.7). Those same
probes chose the rule. Choosing from *all* matches instead of the first `perFileCap` stored ones adds
only +0.2 points, so the engine's memory bound can stay as it is.

The index-only variant is the one to build. It matches the keyword variant without a list of
`import` / `use` / `#include` spellings, the kind of list this repository's guidance warns against.

Two caveats. First, the probes are mostly "where is X implemented" questions, whose answers are
declarations. Second, when the line limit binds, declarations **displace usage lines from the
display**. The candidates stay stored and `--in` still lists every hit in order, but the agent sees
fewer usage lines. Usage, configuration, test-file and exhaustive-search questions need their own
measurement (Section 5).

### 3.4 What agents do with grep output

From the 514 truncated ss-grep outputs in the dossiers:

- The next call is a file read 70% of the time; a `--in` drill-in 8%; a larger `-k` 2%.
- Of 478 reads that follow a truncated grep, 411 (86%) open a file that was shown with a line, and
  333 of those read a range that covers a shown line.
- Only **3** reads open a file that appeared only in the `# +N more file(s) … e.g. …` line.

So the shown `file:line` rows are the agent's next read targets, and a file without a row is
practically invisible. That is why line choice matters: the shown line becomes the read location.
It is consistent with inclusion mattering, but it does not settle inclusion versus depth. These are
observational counts from runs on the legacy allocator. "Agents Don't Paginate"
(arXiv 2608.26130) measured single-turn file localisation, not task completion. The harness study
(arXiv 2609.20804) measured context management in general. That trade is settled by the paired
evaluation in Section 5.

### 3.5 The hit-count weight and the test prior

For source files only, answer rate by hit count (overflow calls):

| Hits | 1 | 2 | 3–4 | 5–9 | 10–19 | 20–49 | 50+ |
|---|---|---|---|---|---|---|---|
| P(answer) | 5.2% | 7.0% | 10.0% | 12.9% | 12.8% | 23.0% | 33.3% (n=21) |
| Ratio to 50+ | 0.16 | 0.21 | 0.30 | 0.39 | 0.38 | 0.69 | 1.00 |
| `sqrt` ratio | 0.11 | 0.16 | 0.19 | 0.30 | 0.42 | 0.63 | 1.00 |
| `c/(c+2)` ratio | 0.34 | 0.51 | 0.61 | 0.80 | 0.90 | 0.96 | 1.00 |

`sqrt` tracks this bucketed answer rate more closely than `c/(c+2)`. That does **not** decide the
weight. A weight that matches a per-file answer rate is not necessarily the one that allocates best
under a fixed line limit, and `c/(c+2)` gave the highest inclusion in 3.2. Both stay in the Step 2
comparison. The flatness in the first review's bucket table came from mixing test files in.

The **test prior cannot be estimated from this replay.** Across the replay calls, 4,597 matched
files are test files and none is an answer file, because the probe authors never chose tests as
answers. Any test penalty is rewarded, so the 10-point loss from dropping the prior reflects that
construction at least in part. Keep 0.5 until there is data where tests are legitimate answers.
For reference, `0.5 x sqrt(hits) = sqrt(hits / 4)`: the prior acts like dividing a test file's hit
count by 4. That is close to Zoekt, whose BM25 mode divides term frequency in test, vendored and
generated files by 5.

Counting distinct matching regions (innermost enclosing symbols) instead of lines gives 86.4% vs
85.6% inclusion under Huntington–Hill. That is +0.8 points, within noise.

### 3.6 ss-semantic: the cut span

Of 493 ss-semantic calls with parseable output, **269 (55%)** report exactly the 600-token cap
(`maxChars = 2400`). In those calls:

- `_expandAndMergeSpans` merges adjacent chunks *before* the budget is applied. When the merged
  span exceeds 2,400 characters, `_enforceCharBudget` keeps its first 2,400 characters (possibly
  mid-line) and stops. 195 of the 269 cut spans merge two or more symbols.
- The `### file:start-end` header still prints the merged range. In 263 of 269 cut calls it claims
  more lines than were printed: a median of 49 lines, p90 135. This is the correctness defect.
- Of 144 cut calls where an answer symbol's declaration lies inside the claimed range, the
  declaration falls **past the cut in 23 (16%)**. In 118 uncut calls it never does. This is the case
  for a separate chunk-selection experiment.
- The shown-span ledger is safe today: `collectSemanticShownSpans` skips truncated spans entirely.

The answer symbol is named somewhere in the output equally often in cut and uncut calls (87%). So
sharing the budget across several symbols, the first review's idea, comes after both steps.

### 3.7 ss-trace: shortened lists, unknown causes

Replaying the 193 unique recorded ss-trace calls through the real `StructuralContextBuilder`
(185 resolve to a target):

| Shortening | Targets | Visible to the agent? |
|---|---|---|
| Caller or callee list shorter than available | 9 | 5 are the section the mode word asked for |
| Impact-path list shorter than available | 42 | 41 are in calls whose mode word (`callers` / `callees`) hides the impact section |
| Caller or callee item with preview or summary code instead of full code | 44 (27 under the second review's definition) | Depends on the format; the recorded compact outputs print items as single lines |

Median budget use is 14% (p90 35%). None of this shows that redistribution would help. Item limits
(`packSection` `maxItems` up to 40, `_packImpact` `maxPaths` up to 24) are derived from the section
budgets. Per-item code caps (`perItemCap`) and the mode word's filtering can produce the same
counts. The causes have to be separated first ("Later" in Section 4).

### 3.8 ss-search / ss-find: headroom, unmeasured cost

- ss-search: in 271 of 723 calls (37%), an answer file appears only as a name without code. In 140
  calls an answer file is named but none is shown with code. In 78 calls the next call opens such a
  file.
- ss-find: 110 of 256 calls name an answer file without code; in 31 the next call opens one.

This is the largest remaining evidence gap, but closing it costs tokens on every call, and
`allocateBudget`'s 60/20/20 split came from a budget sweep. Measure before changing it (Step 5).

### 3.9 Precedent: has anyone done this for grep?

I found no grep implementation that apportions lines with a divisor method. The closest work:

- **Zoekt / Sourcegraph** ranks files, then orders line and chunk matches *within* a file by score.
  A symbol-definition match scores 7,000 against 500 for a plain word match, and "the score of a
  chunk is the score of its best line" ([score.go](https://github.com/sourcegraph/zoekt/blob/893a5238/index/score.go),
  [PR #889](https://github.com/sourcegraph/zoekt/pull/889)). Its BM25 mode down-weights test,
  vendored and generated files, and Sourcegraph reported roughly 20% better internal metrics from
  BM25F ([blog](https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f)). This is
  direct precedent for Step 1.
- **SWE-agent** found a summarised file list for search beat iterative per-match browsing on
  SWE-bench Lite (18.0% vs 12.0%). Its notes say more context per match "proved to be too
  confusing" ([paper](https://arxiv.org/abs/2405.15793),
  [ACI notes](https://github.com/SWE-agent/SWE-agent/blob/0f4f3bba990e01ca8460b9963abdcd89e38042f2/docs/background/aci.md)).
- **Agents Don't Paginate** (arXiv [2608.26130](https://arxiv.org/abs/2608.26130), 2026) treats a
  tool response's first chunk as a knapsack over grep candidates. In a single-turn file-localisation
  probe, inclusion in the chunk mattered and rank within it did not. Hand-weighted file-metadata
  priors *hurt* top-1 placement by 4.8 points. It does not measure task completion.
- **Dang & Croft, SIGIR 2012** (PM-1/PM-2) use Sainte-Laguë to give result positions to query
  aspects ([paper](https://ciir-publications.cs.umass.edu/getpdf.php?id=1050)).
- **Huntington–Hill** (the US House "method of equal proportions") guarantees each state one seat
  before any proportional seats ([ref](https://en.wikipedia.org/wiki/Huntington%E2%80%93Hill_method)).
  Norway's and Sweden's modified Sainte-Laguë goes the other way: it raises the first divisor to keep
  small parties out.
- **Budgeted context selection**: AdaGReS (arXiv [2512.25052](https://arxiv.org/abs/2512.25052))
  and What Survives Into Context (arXiv [2607.00725](https://arxiv.org/abs/2607.00725)). The latter's
  "answer-in-context" diagnostic is the right metric for Step 5, and it reports that the advanced
  packer's advantage disappears with larger readers.
- **Other grep ranking**: zeitgrep (ripgrep results sorted by git frecency), `ugrep --sort=best`
  (fuzzy cost), and Aider's repo map (graph rank plus binary search to fit a token budget).

---

## 4. The plan

Each product step ships behind its own switch, default off, with `=0` reproducing today's output
byte for byte. Only the promotion evaluation in Section 5 turns a switch on.

### Step 0 — Reproducible replay and fresh confirmation probes (no product change)

1. **Commit the replay.** Move the temporary scripts into `eval/grep-allocation-replay/`: one
   collector (matches with line numbers plus entity spans, read-only DB copies) and one replay (file
   inclusion, answer lines, answer-symbol hit, declaration hit, probe-clustered bootstrap).
2. **Record and verify provenance before collecting.** For each repository, the collector records
   and checks:
   - `HEAD` equals the probe's `repoSha`, and the tracked tree is clean;
   - the index identity: `reconcile-manifest.json` epoch and `publishedAt`, and the code-graph
     `schema_meta` version;
   - that the index was built from that same revision.

   It refuses to run on a mismatch, and writes the provenance into every output file.
3. **Label the existing 133-probe results exploratory.** Any split of those probes measures
   consistency only.
4. **Author fresh dev probes for confirmation.** Use the same drafting and verification procedure as
   r3, on the same 11 repositories plus at least one new one. Give them a fixed question mix:
   declaration, usage, configuration, test-file (tests are legitimate answers), and exhaustive search
   ("list every place that …"). Mark them `set: dev-confirm`, and never inspect them per query during
   development. Record agent calls on them with the shipped tools, then replay frozen candidates
   offline on those calls. The existing held-out probes stay untouched until the milestone.
5. **Fidelity check against the real tool.** Run the real ss-grep, under each candidate switch, on a
   sample of recorded calls. Compare with the replay on file sets, hit counts, **selected lines,
   line order, `(+N more in this file)` markers, the hidden-files line, and ranges**. Fix every
   mismatch before trusting replay numbers.
6. **Pre-register** the candidate rules, their constants, and the bars from Steps 1–3 before the
   fresh calls are replayed.

### Step 1 — ss-grep: choose which lines a file shows (`SS_FIX_GREP_LINES`)

**Rule.** For each file that gets `a` lines but has more stored matches, show `a` matches ordered by:

1. declaration lines: a symbol in the file starts on that line or up to 3 lines earlier, and the
   symbol's name appears on the **current** line text as a whole word;
2. other lines inside some symbol's span;
3. lines outside every symbol span (imports, package lines, file-header comments);
4. line number, to break ties.

Print the chosen lines in line order. The `(+N more in this file)` marker stays on the file's last
printed line, with the same count.

**Freshness gate.** Classes are used only for a file that passes both checks:

- the source is not newer than the index: reuse the `_sourceStaleness` rule from
  `search-read-semantic.js` (file modified after the reconcile manifest's `publishedAt` means stale);
- the file's entities are active under the graph's visibility rule (`stale_since IS NULL`, epoch
  visibility).

A stale, unindexed, or partially indexed file keeps today's prefix order.

**Residual risk.** Missing graph data falls back to prefix order; stale data that the checks do not
detect does not. Examples are an index published after an edit but built from older content, or
spans that the extractor got wrong for unusual syntax. In those cases a wrong line can be promoted,
and the line limit can then drop an earlier useful match. The name-on-line check protects only the
declaration class, not the "inside a symbol" class.

**Where.**
- Engine, `core/search/search-pattern.js`, after `applyGrepFileDiversity` and
  `buildBareGrepResults`. When `options._isAgentFormat === true` and the switch travels in, look up
  `this.codeGraphRepo.findEntitiesInFile(file)` once per fresh kept file with more than one stored
  match. Stamp each result row with a small integer class (0, 1, 2), so it survives the daemon round
  trip into `result.results`. That is at most `maxFiles = k` indexed lookups.
- Renderer, `renderGrepBodyWeighted` in `core/search/grep-output-shaping.js`: replace
  `kept[base + j]` for `j < a` with a pure selection over the file's stored matches by
  `(class, line)`, then sort the picks by line. Rows without a class keep today's prefix exactly.
- Daemon parameter: pass the switch like `fileOrder=weight` (`readGrepShapingParams`), and carry it
  through `_ss-helpers.mjs` the same way.

**Unchanged.** `--in` drill-in output (an explicit request for the file's hits in order), `-A/-B/-C`
rendering (it already renders `body.rows`), B7 list mode, the hidden-files line, and every NL
ranking path. This is agent-only output shaping, so the format-gating rule is met by
`_isAgentFormat`.

**Tests.**
- Unit: declarations first, outside-span last, source-order printing, marker placement, and a
  byte-identical fallback for rows without a class.
- Staleness: a declaration moved or renamed after indexing, both detected (falls back) and
  undetected (document the behaviour); partial indexing, with indexed and unindexed files in one call;
  unsupported syntax, meaning a language without entity extraction and a file the parser rejects.
- Integration through the real tool on an indexed fixture, following
  `tests/agent-tools/ss-grep-alloc.test.js`.
- **Latency through the real tool, including the graph reads**, warm daemon and in-process fallback,
  p50 and p95. `scripts/benchmark-grep-allocation.js` does no database reads, so it cannot be the
  measurement.

**Bar to promote offline (pre-registered, on dev-confirm calls).** Answer-symbol hit at least +2
points overall; no question type negative beyond its bootstrap interval; file inclusion unchanged
(it cannot change by construction). Then Section 5.

**Step 1b (separate switch, later).** Spread a file's lines across distinct enclosing symbols
(round robin over symbols, declarations first within each). It adds about 2 more points when files
fit. Measure it separately, after Step 1.

### Step 2 — ss-grep: allocator comparison (`SS_FIX_GREP_ALLOC_RULE`, `SS_FIX_GREP_WEIGHT`)

Run with Step 1's line selection on, as a grid with a fixed set of arms:

| | Sainte-Laguë (shipped) | First-line guarantee, then Sainte-Laguë | Huntington–Hill |
|---|---|---|---|
| `sqrt(hits) x prior` (shipped) | baseline | candidate | control |
| `hits / (hits + 2) x prior` | candidate | candidate | control |

- **First-line guarantee** is the simplest change. In `allocateGrepLinesSainteLague`, give one line
  to each of the first `min(files, budget)` kept files with stored matches, in weight order, then
  continue with the existing heap and exact-integer comparisons.
- **Huntington–Hill** is a control. Keep it only if it beats the guarantee somewhere it matters. Its
  integer comparison is `key_i x a_j (a_j + 1)` versus `key_j x a_i (a_i + 1)`, with `a = 0` first.
- **Saturating weight constant** stays fixed at 2. Record the sensitivity (`+4` gives 82.3%), and do
  not tune it on any confirmation probe.
- **Report** for every arm: inclusion, answer lines, answer-symbol hit with Step 1 lines, files
  shown, and the count of fits calls with a zero-line file.
- **Known trade on the exploratory data.** The guarantee gains inclusion (+2.6 points on overflow
  calls). With Step 1 lines it loses answer-symbol hit (51.9% → 49.3%). The paired evaluation decides
  it.
- **Also:** update the module header in `grep-output-shaping.js`, which should credit file ordering
  for the 71.1% → 83.0% gain. Update the `10,000 / 1 / 1` test for whichever rule wins: under the
  guarantee, `k = 20` gives 18 / 1 / 1.

### Step 3a — ss-semantic: accurate displayed ranges (`SS_FIX_SEMANTIC_RANGES`)

This is a correctness fix that does not change which chunks are chosen. In
`core/search/search-read-semantic.js` and the `cmdSemantic` printer in `_ss-helpers.mjs`:

1. **Exact ranges.** Cut at a line boundary. Each `### file:start-end` header prints exactly the
   lines printed beneath it. Keep `truncated: true`, and carry the merged span's original start and
   end.
2. **Report omitted content.** When the span's content continues past the printed range, print the
   missing range and an ss-read command, for example
   `# not shown: lines 650-698 — ss-read <file> 650 698`. Use the same form for omitted content
   *before* a printed range.
3. **Separate excerpts, separate headers.** Never print two non-adjacent ranges under one header.
4. **A single line longer than the budget**, for example minified code: print the first characters
   that fit, followed by `(line N truncated: M of L characters)`. Report that line as partial.
5. **Ledger.** Record only exact, fully displayed whole-line ranges. A partial line is never
   recorded. Truncated spans are skipped today; after this fix, their fully printed lines may be
   recorded. Test that path explicitly.

**Tests.** Header range equals printed range; omitted-before and omitted-after lines; non-adjacent
excerpts; over-long single line; the ledger records exact displayed ranges only.

**Bar.** Header accuracy 100% on a replay of the 269 cut dev calls, with no change in which chunk is
chosen. This step may ship on unit tests and that replay alone. It still goes through the screening
in Section 5, item 3.

### Step 3b — ss-semantic: chunk selection inside an oversized span (`SS_FIX_SEMANTIC_PICK`)

This is a separate retrieval experiment, run after 3a. When a merged span exceeds the budget, start
the excerpt at the highest-scoring chunk's declaration, then add neighbouring chunks by score while
they fit, instead of taking the merged span's head. It relies on 3a's rules: separate headers, and
omitted content reported on both sides.

**Measure** offline first. Re-run the cut dev calls through `readSemantic` with `verbose` to get
chunk scores, and count whether the answer declaration is printed (currently missing in 23 of 144)
and the tokens used. Confirm on dev-confirm calls, then use the Section 5 promotion evaluation. A
later experiment can compare top-two-symbol excerpts with single-symbol depth.

### Step 4 — Validation

See Section 5. The grep comparison carries Step 1 against the shipped rule, and the Step 2 grid arms
that pass offline. Steps 3a and 3b are separate comparisons.

### Step 5 — ss-search / ss-find: measure before changing the split

1. Offline, dev: for each recorded call, find the answer file's rank and presentation tier, and
   whether its answer symbol's declaration was shown with code ("answer-in-context", after
   arXiv 2607.00725).
2. If the headroom concentrates at ranks 2–5, test a "first unit for everyone" allocation over
   results. Ranks 2–5 get a declaration-plus-few-lines excerpt before rank 1 deepens past its body
   cap. Compare it against a plain guarantee, as in Step 2. Weight results by answer probability
   calibrated on dev by rank and score gap, not by raw score.
3. Keep MMR candidate selection exactly as it is. Allocation decides how much of each selected
   result to show, and MMR decides which results to select.
4. Judge it on total task cost as well as solves, because every call pays the extra tokens.

### Later — ss-trace: classify truncation before changing budgets

First build a replay that labels every shortened list or preview with its cause:

- section budget share (`sectionShares`);
- item limits derived from that budget (`packSection` `maxItems`, `_packImpact` `maxPaths`);
- per-item code caps (`perItemCap`);
- a section hidden by the mode word;
- a format that does not print code.

Then vary one factor at a time. Consider redistribution, or giving a mode word's section the whole
budget, only for the causes the agent actually sees. This stays below Steps 1–3.

### Not now, and why

| Idea | Reason |
|---|---|
| Count distinct regions instead of lines | +0.8 points, within noise |
| Retune or remove the test prior | Not identifiable from this replay. The dev-confirm test-file questions (Step 0) provide the first data; keep 0.5 meanwhile. |
| Replace MMR with PM-2 in ss-search | PM-2 needs explicit query aspects, and the MMR docs record that broader penalties removed necessary results. Revisit only for multi-aspect questions, with aspects extracted from the question. |
| Body allocation in ss-read | It returns what was asked for |

---

## 5. Evaluation protocol

This follows the repository's dev / held-out rules and the micro-smoke gates.

1. **Gate 0, $0 replay on the existing dev calls.** Exploratory only. It proves each switch changes
   output on N > 0 recorded calls, and it runs the Step 0 fidelity check.
2. **Offline confirmation on dev-confirm calls.** Replay the frozen candidates, and apply the
   pre-registered bars per question type.
3. **Screening: micro-smokes.** Use 1–2 diagnostic tasks plus controls, at least 2 repetitions,
   matched caps, then rotation to fresh DEV-RET tasks. A screen can *reject* a candidate. It cannot
   turn a default on.
4. **Promotion: a broader paired evaluation before any default changes.**
   - The same items run in every arm, as matched pairs, with matched turn and tool caps.
   - Items: r3-style dev-confirm probes covering declaration, usage, configuration, test-file and
     exhaustive-search questions, plus a DEV-RET task screen (the 18-task screen of the micro-smoke
     protocol's Gate 5 or larger).
   - At least 3 repetitions per arm per item, read as **repeated solves**: the per-item solve rate
     across repetitions, not a single flip.
   - Paired solve differences with item-clustered intervals, against a **pre-registered
     non-inferiority margin**, overall and per question type.
   - **Total cost** in `idealCost`, including failed runs and retries, plus tool calls and real-tool
     latency.
   - A loss in any question type blocks the default until it is explained.
5. **Held-out, once, aggregate only**, at the milestone: r3 held-out probes (97 hard, 103 easy) and
   HO2, reported with sample sizes and seeds. If held-out disagrees with dev, fix the principle; do
   not tune to it.
6. **Fresh repository**: 20–30 hand-written questions with the same question mix, on a public repo
   never used here.

---

## 6. Risks and guardrails

- **Exploratory evidence.** Every rule here was chosen on the same probes that measured it. Treat the
  numbers as effect-size guesses for pre-registration, not results.
- **Metric fit and displaced usage lines.** The answer-symbol metric favours declarations because
  most current probes are locator questions. When the line limit binds, Step 1 can remove usage lines
  from the display. The dev-confirm question mix measures that.
- **Stale index.** Missing graph data falls back to prefix order. Stale data that the freshness gate
  misses can promote a wrong line and push out an earlier useful one. Step 1's tests cover both, and
  the residual risk is documented in the tool's code comment.
- **Replay fidelity.** The `rg` replay can differ from the engine's indexed match set and rendering.
  Step 0 compares lines, order, markers and ranges, not only files.
- **Old dossiers.** The behaviour statistics in 3.4 come from runs on the legacy allocator. They
  describe how agents use grep output, not which allocator ran.
- **Literature scope.** The localisation and RAG papers cited here measure single-turn retrieval or
  QA, not multi-turn coding-task success. They motivate candidates; they do not decide between them.
- **Latency.** At most `k` indexed lookups per call, measured through the real tool, and bounded in
  CI.

---

## 7. Appendix: key numbers (exploratory, dev)

| Quantity | Value |
|---|---|
| Replay calls (unscoped ss-grep) / with an answer file / overflow / fits | 1,253 / 1,037 / 124 / 913 |
| Probes / repositories | 133 / 11 |
| Repositories at the probes' `repoSha` with clean tracked files (checked afterwards) | 11 of 11 |
| Calls with reachable answer-symbol evidence / overflow | 905 (130 probes) / 107 (60 probes) |
| Overflow inclusion: shipped / guarantee / Huntington–Hill / `c/(c+2)` with Sainte-Laguë | 83.0% / 85.6% / 85.6% / 86.2% |
| Overflow answer lines: same four | 2.51 / 2.10 / 2.10 / 2.28 |
| Fits answer lines: shipped / guarantee / Huntington–Hill | 6.25 / 6.20 / 6.19 |
| Truncated ss-grep outputs; next call is a read / `--in` / larger `-k` | 514; 70% / 8% / 2% |
| Reads after a truncated grep that open a shown file / a hidden-only file | 411 / 3 (of 478) |
| ss-semantic calls at the cap; header over-claims; answer declaration past the cut | 269 of 493; 263; 23 of 144 |
| ss-trace targets: shortened caller/callee lists; shortened impact lists (hidden by mode word); preview code items | 9; 42 (41); 44 |
| ss-trace median budget use | 14% |
| ss-search calls naming an answer file without code; next call opens it | 271 of 723; 78 |
| Matched test files (across replay calls) that are answer files | 0 of 4,597 |
