# codex-cap-x-ss — codex's output cap on `ss-*` outputs: what was cut, what the model re-fetched, and the ceiling of a cap-aware budget

Run: `fp-codex-tab-20260826` (22 tasks × 3 reps × 2 arms = 132 rollouts). Sweet TAB and native only.
Read-only over the retained traces and the golden checkouts on the evidence box. No rollout was
launched. Nothing under `results/` was written. No `ss-*` tool was run. No grading log was read.

Scripts: `forensics/scripts-codex-cap-x-ss/cx-census.py` (box), `cx-analyse.py` (local),
`cx-tiers.py` (box), `cx-exhibit.py` (box). Per-case evidence: `scripts-codex-cap-x-ss/codex-cap-x-ss.json`
(343 truncated outputs, 242 pointer lines). Logs: `cx-analyse.log`, `cx-tiers.log`.
The census reuses `/tmp/fp-inv/e1/e1_common.py` and imports `/tmp/fp-inv/trunc/t1-census.py`
(the 2026-08-28 parser), so alignment rules are identical to `12-truncation-census.md`.

Tags: **[M]** measured (script named), **[C]** read from code, **[I]** inferred.

---

## 0. Verdict

**The L4 verdict ("already dead") holds, and the new numbers close it harder.** A codex-only output
budget that fits `ss-read` / `ss-search` under about 2,400 tokens with an addressable
`continue: ss-read FILE START END` span has a best-case cost ceiling of **−$0.000045 per rollout
(−0.36% of the sweet cell) and −0.015 requests per rollout** on the 33 truncations it can reach
[M `cx-analyse.py` §I]. That best case assumes the model never follows the continue pointer. The
existing pointer is followed **23.6% of the time within three calls (57/242)** [M §E]. At that rate the
design **adds** 0.08 requests and $0.00002 per rollout (+0.15% to +0.24% of the cell). The break-even
follow-rate is 16.6%. Cost and correctness pull in opposite directions through the same number: the
design only helps if the model fetches the gap, and every fetch is a paid request. Nothing else revives
it: the sufficiency line survived **33 of 33** truncated `ss-search` packs [M §4.2], no edit in the run
anchored inside a cut (census §3.2), and **69% of sweet truncations (72/105) come from `&&` bundles**
that a single wrapper process cannot see [M §4.4].

Two facts change how the census should be read. Codex emits **exactly one tool call per request**
(0 multi-call requests in 2,406 tool results, both arms) [M §2], so "the next three requests" and "the
next three tool calls" are the same window. And the census double-counted two follow-up requests: the
sweet arm's truncation-attributable requests are **18, not 20** (0.273 per rollout, 1.39% of its
requests) [M §5].

---

## 1. What `12-truncation-census.md` already answered, and what is new here

| question in the task | census (2026-08-28) | this report |
|---|---|---|
| detect truncation on `ss-*` outputs, count tokens cut | **answered**: 105 sweet TAB / 238 native; 108,679 / 610,123 tokens deleted; class split 66 / 33 / 4 / 2 | reproduced exactly [M]; adds `ss-grep`: 219 calls, 0 self-caused truncations (§3) |
| which pack sections were lost | **partly**: trailer survived 35/37 (one regex for four things); mean 2.16 ranks before the cut | **new**: per-item survival — `sufficient=` 33/33, `route=` 29/33, `shown-full:` 26/33, `ss-read` trailer 26/49 (1/19 in cross-block cuts); the cut begins inside the **rank-1 full body** in 25/33; rank-2 header lost 8/33, rank-1 never; 163 definition lines lost in 22/31 resolved `ss-read` gaps (§4) |
| re-fetch within the next three requests | **answered for calls** (k = 1, 2, 3 tool results, `update_plan` included) | **new**: 1 call per request verified, so the windows coincide; unique-request dedupe (18 not 20); re-read EVER 17.1% vs 7.1%; cascade (re-read cut again) 4/17 sweet vs 11/13 native; over-fetch at block level (§5) |
| price with the run's own per-request costs | **answered**: $0.01422 = 1.75% of cell | reproduced; adds unique-request pricing $0.01125 = 1.38%; mean request price $0.000625 (§5) |
| compare native | **answered**: file-level re-read 24.7% vs 31.1% at k = 1 | adds cascade 85% vs 24%, over-fetch 2.06× vs 0.97× (§5.3) |
| ceiling for a ≤2,400-token budget with a continue span | **bounded above** by the follow-up column ($0.014, 1.75%) — "not achievable" was not worked out | **new**: component arithmetic, pointer follow-rate, break-even, addressable population (§7) |
| L4 verdict check | — | holds (§8) |

---

## 2. Method and denominators

- **Cells.** `fp-codex-tab-20260826`, native (66 rollouts) and sweet TAB (66). Three dearest transcripts
  per task-arm cell, reps joined by `rolloutFile` (the census rule; 0 cells held more than 3). [M]
- **Requests.** One request = one `token_count` record in the codex rollout. The record order is
  `function_call → function_call_output → token_count`, verified on
  `bfgroup__b2-113-sweet/…/rollout-2026-08-26T23-34-39-01a0406c….jsonl` [M `order-check.py`]. So the
  request indexed by a tool result is the request that **emitted** the call; the ingest of the result
  it produced is billed in the next request.
- **One call per request.** Sweet: 1,294 requests, 1,228 tool results (924 `exec_command`, 45
  `write_stdin`, 259 `update_plan`), **0 requests with more than one tool result**. Native: 1,244
  requests, 1,178 results, 0 multi-call requests. The 66 extra requests per arm are the final
  answer turns. [M `cx-census.py`] The census's k = 1..3 window therefore equals a three-request
  window, except that it counts `update_plan` results as calls.
- **Async exec trap.** 0 outputs contain "Script running with cell ID" in either arm. [M]
- **Price.** Ideal cache-normalised formula per request: `newIn × $0.10 + resent × $0.01 + out × $0.60`
  per million, from the raw `token_count` records (the `turns/` ledger overwrites reps). Cell
  reconstruction: sweet $0.80904 vs published $0.8138 (−0.59%), native $0.80642 vs $0.8110 (−0.57%).
  Shares below use the published totals. [M]
- **Request prices, sweet cell:** mean $0.000625, median $0.000525; mean resident prefix 29,761
  tokens, mean new ingest 1,762, mean output 282. Native: mean $0.000648, median $0.000542. [M]
- **Grading logs** were not opened. **Trajectories** (600-char) were not used.

---

## 3. Volume, reproduced, plus `ss-grep` [M]

| cell | truncated outputs | rollouts ≥1 | per rollout | deleted tokens | mean / median deleted |
|---|---:|---:|---:|---:|---:|
| sweet TAB | 105 | 39/66 | 1.59 | 108,679 | 1,035 / 749 |
| native | 238 | 61/66 | 3.61 | 610,123 | 2,564 / 1,848 |

Class of the cut region (block header before the marker): sweet `ss-read` 66, `ss-search` 33,
`ss-find` 4, `ss-trace` 2 — identical to the census. Native: `sed` 174 (133 in compound envelopes),
`cat` 29, `rg` 30, `nl` 4, other 1.

**`ss-grep` never trips the cap on its own.** 219 `ss-grep` calls in 188 envelopes; 15 of those
envelopes were truncated, and in every one the cut region belonged to a co-bundled `ss-read` or
`ss-search` block. 0 cuts are attributed to `ss-grep`. [M `cx-census.py`, `cx-tiers.py`] Its `-k` cap keeps
the output small.

Task concentration: `bfgroup__b2-113` alone holds 21 of the 105 sweet truncations and 10 of the 17
class-(a) re-read events; `devlooped__moq-1262` holds 17 truncations. [M]

---

## 4. Section-loss anatomy (sweet TAB)

### 4.1 `ss-read` — the trailer dies with the block boundary [M]

66 `ss-read` cuts: 32 within-block gaps (numbers jump inside one file), 28 cross-block cuts (the cut
ate a block boundary), 6 half-numbered.

- **`# unread below … — continue:` trailer.** The block before the cut declared a range short of EOF,
  so a trailer was expected, in 49 of 65 headed cases. It survived in **26/49 = 53.1%**. By shape:
  within-block gap 22/24, half-numbered 3/6, **cross-block cut 1/19**. When the cut eats the boundary,
  it eats the pointer.
- **What the gaps held.** 31 gaps resolved by the gutter to an exact span: 1,900 lines lost, median
  39 per gap. **22 of 31 gaps (71%) contained at least one definition line** (`def`, `class`,
  `function`, `func`, method signature), 163 definition lines in total, read from the golden files.
  The census reported the share of the requested range that vanished (33%); this is what it was.

### 4.2 `ss-search` — the top-1 body is what dies; the verdict never does [M]

33 `ss-search` packs cut (16 in compound envelopes).

| item | survived |
|---|---:|
| `sufficient=` line | in the tail 29/33; **anywhere in the delivered output 33/33 = 100%** (the 4 "missing" sit before the cut because the pack was not the last sub-command) |
| `route=` trailer in the tail | 29/33 |
| `shown-full:` line | 26/33 |
| rank-1 header | 33/33 (never lost) |
| rank-2 header | lost in 8/33 (6 alone, 2 together with rank 3) |
| any rank header lost | 8/33 known (22 packs lost no header; 3 packs unresolved) |

**Where the cut begins:** inside rank 1's `full` body in **25/33**; inside rank 2's preview in 3;
rank 2 full 1; rank 3 preview 2; rank 11 summary 2. Middle-out keeps about the first 1,250 tokens, and
the pack header plus a full top-1 chunk exceeds that. So the casualty is the **second half of the
top result's own code**, then (in a quarter of packs) the whole of rank 2. 87 graph-edge lines survived
in the tails. `results=` median 16.

**The symbols inside lost rank bodies are not recoverable** from the traces: they were never
delivered. Re-running the queries would need `ss-search` on the box, which this report did not do.

### 4.3 `ss-find`, `ss-trace` [M]

4 and 2 cuts. These renderers emit no `## #k` rank headers and no sufficiency line, so "sections" do
not apply; the cut removed list items in the middle of a flat result list.

### 4.4 The cut is mostly a bundling phenomenon, not a pack-size phenomenon [M `cx-tiers.py`]

- **Envelopes.** 72 of 105 sweet truncations (69%) sit in envelopes with more than one sub-command
  (`ss-read A && ss-read B && …`). Single-command truncations: 33 (`ss-search` 17, `ss-read` 11,
  `ss-find` 3, `ss-trace` 2). Deleted tokens: single 21,291 (median 393), compound 87,388.
- **`ss-search` tiers.** 112 pack headers: budget 3,000 → 93 packs, 20 truncated (22%), used tokens
  median 1,070, max 2,656, **only 3 used more than 2,400**; budget 8,000 → 19 packs, 13 truncated
  (68%), used median 2,211, max 5,074, 4 used more than 2,400. No `--full` / `--xl` flag was used
  (123/123 auto). So **at most 7 of 112 packs exceeded 2,400 tokens by themselves**; at least 26 of the 33
  truncated packs were cut because the envelope around them was large.
- **`ss-read` ranges.** 542 invocations. In single-command envelopes (78): ranges ≤200 lines truncated
  0/52; 201–250 lines 2/8; 251–400 lines 7/16; >400 lines 2/2. The ~250-line cap the census inferred
  holds. But 464 of 542 `ss-read` invocations were bundled, and 55 of the 66 `ss-read` cuts are
  bundled cuts. 8 of the 11 single-command `ss-read` cuts are `src/build/targets.py` in `b2-113`.

A wrapper process sees only its own output. It cannot budget an `&&` chain. [I from the shell model]

---

## 5. Re-fetch within the next three requests, priced

### 5.1 Sweet TAB [M]

| k | (a) re-read overlapping the gap | (b) same file, no overlap | (c) search for a gap-only symbol | (d) proceeded | (e) ended |
|---|---:|---:|---:|---:|---:|
| 1 | 10 | 22 | 1 | 72 | 0 |
| 2 | 3 | 20 | 2 | 80 | 0 |
| 3 | 4 | 13 | 0 | 87 | 1 |

- Truncations with a class-(a) re-read within 3 calls: **13/105 = 12.4%**; within 3 requests: 13/105
  (identical, §2). Class (c): 3/105 = 2.9%. Class (a) **ever** later in the rollout: 18/105 = 17.1%
  (call distances 1×10, 2, 3×2, 4×2, 5, 11, 21).
- **Unique requests.** The census priced 17 (a) + 3 (c) = 20 request-counts. Two are the same request
  counted for two adjacent truncations (`b2-113` rep 0, calls 20 and 21). Unique: **15 (a) + 3 (c) = 18
  requests = 0.273 per rollout = 1.39% of the cell's 1,294 requests.**
- **Price.** Census framing (per-request prices, 20 counts): (a) $0.01243 + (c) $0.00179 = **$0.01422 =
  1.75% of the cell = $0.000215 per rollout, 0.303 request-counts per rollout.** Unique requests at
  the cell mean price: 18 × $0.000625 = $0.01125 = 1.38%.
- **Cascade.** 4 of 17 (a) re-reads were truncated again; 24 of 55 (b) same-file reads were truncated
  again. Exhibit 3 shows a chain of three.
- **Over-fetch.** Lines requested by the 17 re-reads: 2,796 vs 2,361 lines in the gaps (1.18×; per-event
  median 1.41×). Tokens at envelope level (codex's own counts): 38,594 delivered vs 24,588 in the gaps.
  **At block level** (only the `ss-read` block of the same file, bytes ÷ 3.99): **23,763 delivered vs
  24,588 in the gaps** — the re-reads recover on average less than the gap. Over-fetch above the gap:
  7,272 tokens. Priced as ingest plus re-send on the later requests: **$0.00185 = 0.23% of the cell**.
  14 of the 17 follow-up envelopes were compound, which is why the envelope figure ($0.00499) overstates.

### 5.2 Native [M]

- (a) within 3 calls: **9/238 = 3.8%**; (c) 2/238; (a) ever 17/238 = 7.1%. Unique requests 10 (a) + 2 (c)
  = 12 = 0.182 per rollout. Price (census framing): $0.00954 = 1.18% of the cell = $0.000145 per
  rollout.
- **Cascade: 11 of 13 (a) re-reads were truncated again** (7 of them in one rollout,
  `accenture__sfmc-devtools-1974` rep 2, the same `rg -n "…"` re-issued into the cap). Over-fetch:
  53,862 tokens delivered vs 26,197 in the gaps (2.06×); lines 5,488 vs 1,385 (3.96×, n = 6 with both
  known).
- 221 of 238 native markers are unnumbered, so class (a) rests on golden matches. The census's
  span-free file-level measure (same-file read at k = 1: native 24.7%, TAB 31.1%) remains the fair
  cross-arm comparison.

### 5.3 Reading

Sweet re-fetches three times as often as native (12.4% vs 3.8% within three requests) because the
gutter shows it the hole (census §3.1). When native does re-fetch, it brackets so widely that the
re-fetch is cut again 85% of the time. Sweet's re-fetches are tighter (0.97× the gap at block level)
and cascade 24%. Neither is a cost driver: 1.75% and 1.18% of the cells, 0.27 and 0.18 unique requests
per rollout.

**Outcome cross-tab (confounded, not causal):** sweet truncations followed by (a) → 1/13 resolved;
not followed → 29/92. Native 4/9 vs 100/229. The sweet split is `b2-113` (10 of 17 (a) events, never
solved by any arm on this pool). [M]

---

## 6. The existing continue pointer: how often the model follows it [M `cx-census.py` E]

Every `# unread below (A-B) [: symbols] — continue: ss-read F A B` line the wrapper emitted in the
sweet TAB arm, truncated output or not: **242 pointer lines in 175 outputs, 53 of 66 rollouts, 3.67 per
rollout.** "Followed" = a later `ss-read F` whose range overlaps [A, B] (an upper bound; the model may
read there for its own reasons).

| population | n | followed ≤3 calls | followed ever |
|---|---:|---:|---:|
| all pointers | 242 | **57 = 23.6%** | 79 = 32.6% |
| ≥3 later calls (uncensored) | 225 | 25.3% | 35.1% |
| pointer inside a truncated output | 69 | 27.5% | 39.1% |
| pointer inside an untruncated output | 173 | 22.0% | 30.1% |
| pointer names symbols | 196 | 26.0% | 36.2% |
| pointer without names (small remainder) | 46 | 13.0% | 17.4% |
| unread span ≤50 lines | 36 | 5.6% | 11.1% |
| 51–200 lines | 74 | 14.9% | 33.8% |
| 201–1,000 lines | 108 | 30.6% | 34.3% |
| >1,000 lines | 24 | 45.8% | 54.2% |
| in resolved rollouts | 94 | 11.7% | 21.3% |
| in unresolved rollouts | 148 | 31.1% | 39.9% |

- **Form of the follow.** 76 overlapping ranges of the model's own choosing, **2 exact copies of the
  continue command**, 1 whole-file read. The model uses the pointer as a hint, not as a command.
- **The follow is itself cut 29.1% of the time (23/79).** The pointed span has median 309 lines; the
  cap fits about 250; the model's follow-read has median 94.5 lines. Exhibit 4 shows an exact
  continue command running straight into the cap.
- This extends register item B8 ("79% of the shipped pointer rows never followed", type pointers):
  for the `ss-read` continue pointer, 76.4% are not followed within three calls and 67.4% never.

---

## 7. Ceiling of a codex-only ≤2,400-token budget with an addressable continue span

**Design under test** (register C9): under codex (`detectAgentEnv()` in `core/search/output-policy.js`
[C]), `ss-read` renders at most ~2,400 tokens and names the rest as `# unread inside/below … —
continue: ss-read F A B`; `ss-search` emits fewer complete ranks and names the omitted ranks. The
harness then never cuts. Ingest is unchanged to within the ~100 tokens of warning lines: the same
2,400–2,500 tokens arrive either way. **The whole effect runs through requests.** [I]

Components, sweet TAB, per 66 rollouts, published cell $0.8138 [M `cx-analyse.py` §F, §G6, §I]:

| component | whole population (105 cuts) | addressable population (33 single-command cuts) |
|---|---:|---:|
| 0. ~100 fewer delivered tokens per formerly cut output (no warning lines, 2,430 vs 2,530) | −$0.00298 (0.37%) | −$0.00099 |
| 1. class-(a) re-reads fetch exactly the gap (block-level over-fetch removed) | −$0.00185 (0.23%) | −$0.00140 |
| 2. class-(c) gap-symbol searches avoided | −$0.00179, −3 requests | −$0.00057, −1 request |
| **best case (nobody follows the pointer, r = 0)** | **−$0.00662 = −0.81% = −$0.000100/rollout, −0.045 req/rollout** | **−$0.00296 = −0.36% = −$0.000045/rollout, −0.015 req/rollout** |
| 3. added continuation requests: `proceeded × r × marginal`; marginal = resident 29,761 × $0.01 + gap 1,035 × $0.10 + out 282 × $0.60 + gap re-sent on 18.4 later requests = **$0.000761** ($0.000661 on the addressable set) | proceeded = 92 | proceeded = 27 |
| **break-even follow-rate r\*** | **9.5%** | **16.6%** |
| net at r = 0.236 (measured, all pointers) | **+$0.00989 = +1.22%**, +0.284 req/rollout | **+$0.00125 = +0.15%**, +0.081 req/rollout |
| net at r = 0.275 (measured, pointers inside truncated outputs) | +$0.01262 = +1.55%, +0.338 req/rollout | +$0.00195 = +0.24%, +0.097 req/rollout |
| net at r = 1 (every gap fetched) | +$0.06319 = +7.8%, +1.35 req/rollout | — |

**Reading.** The design is a cost lever only if fewer than one in ten (whole population) or one in six
(addressable) newly addressable gaps get fetched. At the follow-rate the same model shows for the same
affordance today, it costs money and adds requests. If it worked as a correctness lever — the model
fetching what it lost — it would cost more still. The census's upper bound ($0.014, 1.75%) assumed the
follow-up requests vanish; they cannot, because the continue **is** a request.

**Why the addressable set is 33, not 105.** 72 of the 105 cuts are `&&` bundles. A per-command
renderer that fits each block under 2,400 tokens leaves a two-read bundle at up to 4,800 tokens; the
harness still cuts the middle, which now holds the first block's tail, its pointer, and the second
block's head (Exhibit 1). At most 7 of 112 `ss-search` packs exceeded 2,400 tokens on their own (§4.4).

**Solve.** The veto cannot be applied in the design's favour: 0 of 480 edit calls anchored inside a cut
(census §3.2), the outcome gradient is a difficulty proxy (census §6, §5.3 here), and 22 of 31
resolved `ss-read` gaps held definitions the model never saw without any measurable harm following.

---

## 8. Does the L4 verdict hold?

`04-resolution-codex.md` L4: "312 of 1,637 ss envelopes truncate (19%) … 0 of 6 never-shown edit
anchors fell inside a truncated span … Do not re-open without a new mechanism."

**It holds.** [M] The population figure is consistent (105 + 100 + 107 `ss`-class cuts across the three
forms). The mechanism check now stands at 0 in 480 edit calls (census). This report adds the missing
piece the deferral in memory `index-hygiene-fixes-0828` left open: the design's cost sign. With the
measured pointer follow-rate it is positive (+0.15% to +1.55%), its best case is −0.36% on the
population it can reach, and 69% of the population is out of its reach. The one correctness gain it could
buy — the model fetching a lost definition — is the same event that makes it cost money. Register C9
should move from DEFERRED `$0` to **DEAD** with these numbers; C8 stands.

---

## 9. Exhibits (bytes from the traces; grading logs not used) [M `cx-exhibit.py`]

**1. A bundle cut eats the trailer and the next header.** `accenture__sfmc-devtools-1974` sweet rep 0,
`rollout-2026-08-26T22-28-06-01a04030…`, call 5, turn 5, unresolved.
`ss-read lib/index.js 700 820 && ss-read test/general.test.js 2280 2365 && ss-read lib/cli.js 120 155`,
2,773 tokens. Line `808` is followed by line `2288`: lines 809–820 of `lib/index.js`, its
`# unread below (821-2279)` pointer, the whole header of the test file and its lines 2280–2287 are
gone (273 tokens). The next call (`ss-read lib/index.js 1660 1815 && ss-read lib/cli.js 360 470`) was
truncated again.

**2. Rank-1 body, rank-2 and rank-3 headers lost; verdict intact.** `accenture__sfmc-devtools-1974`
sweet rep 1, `rollout-2026-08-26T22-30-34-01a04032…`, call 1. `ss-search "…" -k 5 && printf … && ss-grep
"refresh" -k 20`, 5,753 tokens; pack header `budget=8000 used=5074 results=15`. The cut begins at
line 102 inside rank 1 (`AttributeSet.js:19-370 [class] (full)`) and ends inside rank 3; ranks 2 and 3
vanish with their headers (3,253 tokens). Ranks 4–15, `shown-full:` and
`route=hybrid confidence=low sufficient=unknown … results=15` all arrive.

**3. A re-read cascade.** `bfgroup__b2-113` sweet rep 1, `rollout-2026-08-26T23-34-39-01a0406c…`, call
32. `ss-read src/build/targets.py 600 1050` (451 lines, 4,966 tokens) loses lines 713–949 (2,466
tokens). k = 1 `ss-read … 700 950` (251 lines) — truncated; k = 2 `ss-read … 1050 1280` — truncated;
k = 3 `ss-read … 1134 1305`. Three requests to recover one gap, two of them cut again.

**4. An exact continue command runs into the cap.** `bfgroup__b2-259` sweet rep 1,
`rollout-2026-08-26T23-37-56-01a0406f…`, call 14. `ss-read src/build/configure.jam 1 320` (2,270
tokens, not truncated) ends with `# unread below (321-629): check, configure — continue: ss-read
src/build/configure.jam 321 629`. k = 1 is exactly that command, 309 lines — **truncated**. One of only
2 exact follows in 79.

---

## 10. Limits, and what was not finished

1. **Lost `ss-search` rank bodies are not recoverable.** Their symbols were never delivered. Recovering
   them would mean re-running the queries with `ss-search` on the box, which this report did not do.
2. **The pointer-follow criterion is an upper bound.** Any later overlapping `ss-read` counts, whether or
   not the pointer caused it. The true follow-rate is at most 23.6%; the break-even comparison is
   therefore conservative against the design.
3. **Block-level over-fetch tokens use bytes ÷ 3.99** (the 08-28 measured rate), not codex's own count,
   which exists only per envelope.
4. **Whether a "proceeded" rollout lacked a fact it needed is not measured.** Deciding it would require
   the hidden tests (brief rule 5). The 0-in-480 blind-edit result is the only admissible mechanism check.
5. **Outcome cross-tabs are confounded**; `b2-113` (never solved, 21 cuts) and `moq-1262` (17 cuts) carry
   the sweet tail, `accenture` rep 2 carries 7 of native's 13 cascades.
6. **NONE and PIPE forms were not re-analysed**; the task scoped this to `fp-codex-tab`. The census holds
   their follow-up tables.
7. **The `turns/` ledger was not used** (it overwrites reps); prices come from the raw `token_count`
   records, the same source the ledger is built from.

## Appendix — artefacts

| file | contents |
|---|---|
| `scripts-codex-cap-x-ss/cx-census.py` | box census: section survival, request windows, cascade, block-level over-fetch, pointer follow-rate, request prices, `ss-grep` counts; writes `/tmp/wf-slatec/codex-cap-x-ss/cx-census.json` |
| `scripts-codex-cap-x-ss/cx-analyse.py` | tables A–I over the JSON; `cx-analyse.log` is its full output |
| `scripts-codex-cap-x-ss/cx-tiers.py` | `ss-search` budget tiers and `ss-read` range sizes vs the cap; `cx-tiers.log` |
| `scripts-codex-cap-x-ss/cx-exhibit.py` | prints one truncated output with its cut context and the next three calls |
| `scripts-codex-cap-x-ss/codex-cap-x-ss.json` | all 343 truncated outputs (105 sweet, 238 native) and 242 pointer lines with transcript ids |
| box scratch | `/tmp/wf-slatec/codex-cap-x-ss/` (scripts, JSON, `cx-census.log`, a copy of `dump-trace.mjs`) |
