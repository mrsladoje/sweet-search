# T1 — What codex does after a middle-out truncation, and what it costs

**Scope.** Every truncated tool output in the four codex cells of the fresh pool (epoch C):
native, sweet TAB, sweet NONE, sweet PIPE. 264 rollouts (66 per cell), **563 truncated tool
outputs**, 563 cut markers, 1,689 follow-up tool calls classified.
**Method.** Read-only over the retained traces and the golden checkouts on the evidence box.
No rollout was launched. Nothing under `results/` was written. No `ss-*` tool was used.
**Scripts.** `scripts/t1-census.py`, `t1-analyse.py`, `t1-blind.py`, `t1-exhibits.py`,
`t1-outliers.py`, `t1-diag.py`, `t1-peek.py`, `t1-headers.py` (copies ran from
`/tmp/fp-inv/trunc/` on the box).
**Per-case evidence.** `12-truncation-census.json` — all 563 cases with the command, the cut
span, the next three calls and the per-case price.

Tags: **[M]** measured (script + number). **[I]** inferred.

---

## 0. Verdict

**The cap is not a sweet-search problem to fix, and making the `ss-*` renderers cap-aware
would buy at most 1.8–2.5% of a codex cell. [M]** Delivering every truncated output in full
instead would cost **2.0× to 19× more** than every re-read the truncation provoked, in all
four cells. The cap is economically correct as it stands.

**Three findings behind that.**

1. **The codex cap is a hard 2,500 delivered tokens and it ignores `max_output_tokens`.** [M]
   The model asked for 10,000–50,000 across the run. Delivered tokens equal
   `2,500 × truncated calls` **exactly** in all four cells (native 238 × 2,500 = 595,000;
   TAB 262,500; NONE 250,000; PIPE 300,000). Nothing the caller sets changes it.
2. **The gutter turns a silent loss into a paid re-read.** [M] After a truncation the model
   re-reads the same file on its very next call **31.9% of the time under TAB or PIPE
   against 23.5% under NONE** (68/213 vs 23/98, Fisher `p = 0.034`). Line numbers are the
   only thing that makes the hole visible; NONE renders **0 numbered lines at 100 of 100
   cut sites**, so under NONE the model mostly does not know anything is missing.
3. **Truncation never caused a bad edit.** [M] Across 2,922 anchor lines in 480 edit calls,
   255 anchor lines were never shown by any output, 248 of those are absent from the base
   file entirely, and **0 lie inside a deleted span**. The `trunc_overlap` hypothesis is a
   clean null at eight times the 2026-08-26 sample size.

**Answer to the deciding question: no.** Cap-aware rendering is worth `$0.014`–`$0.021` per
66 rollouts. The one change that is worth making is narrower and is stated in §8.

---

## 1. Validation — four independent joins land exactly [M]

| check | this census | prior published | match |
|---|---|---|---|
| truncated calls per cell | 238 / 105 / 100 / 120 | `01-edit-mechanisms.md` §3.5 | exact |
| solved per cell | 41 / 39 / 41 / 42 | `FRESH-POOL-RESULTS.md` §1 | exact |
| edit calls per cell | 124 / 112 / 124 / 120 | `01-edit-mechanisms.md` §1.2 | exact |
| cell cost | $0.8064 / $0.8090 / $0.8084 / $0.8370 | $0.8110 / $0.8138 / $0.8131 / $0.8418 | −0.57% to −0.59% |

The cost reconstruction runs 0.57–0.59% low in all four cells, the same direction and size as the
`01` reconstruction. Every ratio below is insensitive to it.

**`resolved` is non-null for all 264 rollouts, and each cell's buckets sum to 66.** Both are
asserted in `t1-analyse.py`; the script fails if either breaks. [M]

---

## 2. Item 1 — volume, class, and the size of the cut

### 2.1 How much is cut [M]

| cell | truncated calls | per rollout | rollouts ≥1 | original tokens | deleted | delivered | deleted/call | median deleted |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| native | **238** | 3.61 | **61/66** | 1,205,123 | 610,123 | 595,000 | 2,564 | 1,861 |
| sweet TAB | 105 | 1.59 | 39/66 | 371,179 | 108,679 | 262,500 | 1,035 | 749 |
| sweet NONE | 100 | 1.52 | 34/66 | 383,827 | 133,827 | 250,000 | 1,338 | 771 |
| sweet PIPE | 120 | 1.82 | 34/66 | 445,772 | 145,772 | 300,000 | 1,215 | 869 |

**Sweet is hit less than half as often as native** (1.5–1.8 truncations per rollout against
3.61) and loses a fifth as many tokens (108k–146k against 610k). [M] Native `sed` and `cat`
envelopes routinely ask for more than the cap; the `ss-*` wrappers already deliver smaller
blocks.

**`delivered` is exactly 2,500 × the call count in every cell.** [M] That is the cap, and it
is the same 2,500 whether the caller asked for 10,000 or 50,000.

### 2.2 Which command produced the cut region [M]

Attribution is by the block header immediately before the cut (`# ss-read <file> (lines A-B
of N)`, `## #k <file>:A-B`), falling back to the sub-commands in the envelope.

| cell | ss-read | ss-search | ss-find | ss-trace | sed | cat | rg | nl | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| native | — | — | — | — | **174** | 29 | 30 | 4 | 1 |
| sweet TAB | **66** | 33 | 4 | 2 | — | — | — | — | — |
| sweet NONE | **56** | 28 | 14 | 2 | — | — | — | — | — |
| sweet PIPE | **70** | 24 | 13 | — | 9 | — | 4 | — | — |

`ss-read` is the truncated surface 56–70 times per cell; `ss-search` packs 24–33. Together
they are **78–94% of every sweet cut** (TAB 99/105, NONE 84/100, PIPE 94/120). [M]

### 2.3 The shape of the cut — can the model see what went missing? [M]

This is the mechanism, and it is the finding that decides the question.

| cell | markers | within-block gap | cross-block cut | sub-line | half-numbered | **unnumbered** | file identifiable |
|---|---:|---:|---:|---:|---:|---:|---:|
| native | 238 | 0 | 8 | 0 | 9 | **221** | 85/238 |
| sweet TAB | 105 | **47** | 45 | 0 | 11 | 2 | 103/105 |
| sweet NONE | 100 | 0 | 0 | 0 | 0 | **100** | 98/100 |
| sweet PIPE | 120 | **47** | 41 | 1 | 18 | 13 | 110/120 |

- **within-block gap** — the numbers jump inside one rendered block (`…1150` then `1184…`).
  The model can name the missing lines exactly.
- **cross-block cut** — the cut ate the tail of one block, the whole header of the next, and
  the head of the one after. Two increasing numbers survive that belong to **different
  files**, and no boundary text is left to see it.
- **unnumbered** — no line numbers either side. The inline marker is the only clue, and it
  names a token count, never a location.

**NONE is unnumbered at 100 of 100 cut sites, and native at 221 of 238.** [M] Under those two
conditions the model is told *that* something was dropped and never *what*.

**Roughly half of every gutted cut is a cross-block cut** (TAB 45/105, PIPE 41/120). [M]
There the numbers are present but lie — they are two different files' numbering. Any
cap-aware design that leans on the gutter to signal the gap must handle this case; it is not
a minority.

### 2.4 `ss-read` — what was asked for against what was deleted [M]

Restricted to `ss-read` cuts whose span is resolved and contained in the block's own declared
range (see §9 limit 1).

| cell | n | median deleted lines | max | mean share of the requested range deleted |
|---|---:|---:|---:|---:|
| sweet TAB | 34 | 43 | 266 | **33%** |
| sweet NONE | 15 | 17 | 185 | 22% |
| sweet PIPE | 42 | 48 | 253 | 27% |

A third of the requested lines vanish when an `ss-read` range overruns the cap. In these
cases the agent asked for 43–468 lines, median 220. [M] At the observed median density of
9.9 deleted tokens per deleted line, the 2,500-token cap fits about **250 lines**. [I] Every
request above that size is guaranteed to lose its middle.

### 2.5 `ss-search` / `ss-find` packs — the trailer survives, a middle rank dies [M]

| cell | packs cut | mean ranks before the cut | mean ranks after | **trailer survived** |
|---|---:|---:|---:|---:|
| sweet TAB | 37 | 2.16 | 14.22 | **35/37 (94.6%)** |
| sweet NONE | 42 | 2.60 | 15.21 | 33/42 (78.6%) |
| sweet PIPE | 37 | 2.32 | 14.05 | 33/37 (89.2%) |

Middle-out keeps the tail, so the `sufficient=` / `route=` trailer and the `# unread below`
line almost always survive. **The pack's verdict is not the casualty; a middle-ranked result
is.** [M] The cut lands early — about rank 2 — and the ranks after it come back.

---

## 3. Item 2 — what the model does in the next 1, 2 and 3 tool calls

Classes: **(a)** re-read overlapping the deleted span, **(b)** same file, non-overlapping,
**(c)** a search for a symbol that occurs *only* inside the deleted span (checked against the
golden base file), **(d)** unrelated / proceeded, **(e)** rollout ended. Event counts with
rollouts-with-event in brackets.

| cell | k | (a) re-read gap | (b) same file | (c) gap symbol | (d) proceeded | (e) ended |
|---|---|---:|---:|---:|---:|---:|
| native | 1 | 6 (4R) | 15 (11R) | 1 (1R) | **215 (61R)** | 1 (1R) |
| | 2 | 3 (2R) | 5 (5R) | 0 | 227 (61R) | 3 (3R) |
| | 3 | 4 (3R) | 1 (1R) | 1 (1R) | 228 (60R) | 4 (4R) |
| sweet TAB | 1 | 10 (7R) | 22 (15R) | 1 (1R) | **72 (35R)** | 0 |
| | 2 | 3 (2R) | 20 (11R) | 2 (2R) | 80 (39R) | 0 |
| | 3 | 4 (3R) | 13 (9R) | 0 | 87 (37R) | 1 (1R) |
| sweet NONE | 1 | 5 (5R) | 18 (11R) | **0** | **77 (30R)** | 0 |
| | 2 | **0** | 13 (8R) | **0** | 85 (32R) | 2 (2R) |
| | 3 | **0** | 9 (6R) | **0** | 89 (31R) | 2 (2R) |
| sweet PIPE | 1 | 18 (14R) | 18 (16R) | 0 | **84 (29R)** | 0 |
| | 2 | 4 (4R) | 17 (11R) | 1 (1R) | 98 (31R) | 0 |
| | 3 | 2 (2R) | 13 (11R) | 4 (3R) | 101 (32R) | 0 |

**The dominant answer is (d): the model proceeds.** [M] 68.6% (TAB) to 90.3% (native) of
truncations are followed by something unrelated on the very next call. The model rarely treats a cut as a problem.

**NONE never once searched for a symbol that only the gap contained, at any k.** [M] It also
stops re-reading after k=1 (5, then 0, then 0). Under TAB and PIPE the re-reads continue to
k=3. That is the numbering doing its work.

### 3.1 The unbiased comparison [M]

Class (a) needs a resolved span, and spans resolve far more often under TAB and PIPE (49 and
52) than under NONE (21). **Comparing (a) across cells directly would therefore be measuring
my own resolver, not the model.** The span-free version below needs only the file name, which
is known for 85–110 markers in every cell, so all four compare honestly.

**Does the next call read the same file the cut block came from?**

| cell | file known | k=1 | k=2 | k=3 |
|---|---:|---:|---:|---:|
| native | 85 | 21/85 = 24.7% | 8/85 = 9.4% | 5/85 = 5.9% |
| sweet TAB | 103 | 32/103 = **31.1%** | 23/103 = 22.3% | 17/103 = 16.5% |
| sweet NONE | 98 | 23/98 = 23.5% | 13/98 = 13.3% | 9/98 = 9.2% |
| sweet PIPE | 110 | 36/110 = **32.7%** | 21/110 = 19.1% | 15/110 = 13.6% |

**Gutted (TAB + PIPE) 68/213 = 31.9% against NONE 23/98 = 23.5%, Fisher exact
`p = 0.034`.** [M] A visible gap costs about one extra re-read in every twelve truncations.

Restricted to markers whose span *is* resolved, the class-(a) rate within three calls is
native 5/16, TAB 13/49, NONE 5/21, PIPE 19/52 — 23.8% to 36.5%, and the cells no longer
separate. [M] The honest reading is the unbiased table above.

### 3.2 Later edits anchored on lines only the truncation hid — zero [M]

| cell | edit calls | anchors | anchor lines | never shown | absent from base | in base, outside a span | **inside a deleted span** |
|---|---:|---:|---:|---:|---:|---:|---:|
| native | 124 | 251 | 802 | 38 | 33 | 5 | **0** |
| sweet TAB | 112 | 208 | 652 | 49 | 48 | 1 | **0** |
| sweet NONE | 124 | 246 | 818 | 113 | 113 | 0 | **0** |
| sweet PIPE | 120 | 199 | 650 | 55 | 54 | 1 | **0** |

Matched on the same file *and* the same line region, not merely the same rollout — the
weakness `01-edit-mechanisms.md` §5 limit 4 flagged. **Not one edit in the run anchored on a
line that only a truncation had hidden.** [M] The 255 never-shown anchor lines are 248 lines
absent from the base file altogether (the model's own new text and post-edit context) and 7
that exist in the base but outside every deleted span.

---

## 4. Item 3 — what the follow-ups cost

Every request that carried a class (a) or class (c) follow-up, priced with the cell's own
ideal cache-normalised formula: `newIn × $0.10 + resent × $0.01 + out × $0.60` per million.
Requests counted once.

| cell | (a) re-read $ | requests | (c) gap-search $ | requests | total $ | **share of cell** | $/rollout |
|---|---:|---:|---:|---:|---:|---:|---:|
| native | 0.00845 | 13 | 0.00109 | 2 | **0.00954** | 1.18% | 0.000145 |
| sweet TAB | 0.01243 | 17 | 0.00179 | 3 | **0.01422** | 1.75% | 0.000215 |
| sweet NONE | 0.00330 | 5 | 0.00000 | 0 | **0.00330** | 0.41% | 0.000050 |
| sweet PIPE | 0.01581 | 24 | 0.00552 | 5 | **0.02133** | 2.53% | 0.000323 |

Cell totals used as denominators: native $0.8110, TAB $0.8138, NONE $0.8131, PIPE $0.8418.

**PIPE pays the most and NONE the least, and the ordering follows the numbering, not the
delimiter.** [M] NONE's 0.41% is not a saving — it is the price of not noticing. It pairs
with NONE's 0 gap-symbol searches and its 0 re-reads at k=2 and k=3.

---

## 5. Item 4 — counterfactual: deliver every truncated output in full

Extra ingest if the cap had not fired: deleted tokens × $0.10/M for the first send, plus
$0.01/M × the number of later requests in that rollout for the re-sent prefix.

| cell | deleted tokens | first ingest | re-send | **counterfactual total** | follow-up cost | larger | ratio |
|---|---:|---:|---:|---:|---:|---|---:|
| native | 610,123 | $0.06101 | $0.12036 | **$0.18137** | $0.00954 | **counterfactual** | 19.0× |
| sweet TAB | 108,679 | $0.01087 | $0.02099 | **$0.03186** | $0.01422 | **counterfactual** | 2.2× |
| sweet NONE | 133,827 | $0.01338 | $0.02592 | **$0.03930** | $0.00330 | **counterfactual** | 11.9× |
| sweet PIPE | 145,772 | $0.01458 | $0.02708 | **$0.04166** | $0.02133 | **counterfactual** | 2.0× |

**The counterfactual is larger in all four cells.** [M] The cap pays for itself everywhere;
it is most valuable on native (19×), where the envelopes are largest, and least on the two
gutted sweet cells (2.0–2.2×), where the model actually goes back for what it lost.

Two-thirds of the counterfactual is **re-send**, not first ingest — the resident-context tax
that drives the whole benchmark. A token delivered once is paid for on every later request in
the rollout.

**Read this correctly.** It bounds *removing* the cap, which is not on offer. Cap-aware
rendering means fitting under the cap deliberately, which costs nothing extra in ingest. The
prize there is bounded above by the follow-up column: **$0.014 on TAB, $0.021 on PIPE, 1.75%
and 2.53% of a cell.** [I]

---

## 6. Item 5 — truncation against outcome

| cell | 0 truncations | 1 | 2 | 3+ | cell total |
|---|---|---|---|---|---|
| native | 5/5 = 100% | 8/8 = 100% | 6/12 = 50.0% | 22/41 = 53.7% | 41/66 |
| sweet TAB | 23/27 = 85.2% | 10/16 = 62.5% | 2/8 = 25.0% | 4/15 = 26.7% | 39/66 |
| sweet NONE | 23/32 = 71.9% | 11/15 = 73.3% | 2/7 = 28.6% | 5/12 = 41.7% | 41/66 |
| sweet PIPE | 25/32 = 78.1% | 9/13 = 69.2% | 2/4 = 50.0% | 6/17 = 35.3% | 42/66 |

Pooled sweet: **0 truncations 71/91 = 78.0%; ≥1 truncation 51/107 = 47.7%; Fisher exact
`p < 0.0001`.** Native: 5/5 against 36/61 = 59.0%, `p = 0.084`. [M]

**This is a strong correlation and it is confounded.** [I] Truncation count is a proxy for how
much the agent had to read, and how much it had to read is a proxy for task difficulty. The
same monotone decline appears on native, where the truncated surfaces are `sed` and `cat` and
no sweet renderer is involved. Nothing here shows truncation *causes* a failure, and §3.2 is
direct evidence against the one mechanism by which it plausibly could — 0 edits anchored in a
gap. Treat the table as a difficulty gradient, not a lever.

---

## 7. Three exhibits, with the bytes

### 7.1 A re-read of the gap — the model goes straight back [M]

`fp-codex-tab-20260826`, `bfgroup__b2-113-sweet`, rep 1, `resolved = False`,
`rollout-2026-08-26T23-34-39-01a0406c…jsonl`

```
cmd : ss-read src/build/targets.py 1050 1280
      Original token count: 2811
      Warning: truncated output (original token count: 2811)
      Total output lines: 236
      # ss-read src/build/targets.py (lines 1050-12…
```
```
1149\t            or a dependency property, and generates that target using
1150\t            'property_set' as build…311 tokens truncated…ets().log(
1184\t                "Building target '%s'" % self.name_)
1185\t            self.manager().targets().increase_indent ()
```
Line 1150 is followed by line 1184. **Lines 1151–1183 are gone — 33 lines, 311 tokens.** The
numbering is the only clue, and the model used it:

```
k=1  a-reread-gap    ss-read src/build/targets.py 1134 1305
k=2  d-unrelated     ss-grep "usage_requirements.*build|build.*usage_requirements|non_dependency" -k 40
k=3  d-unrelated     ss-read test/transitive_skip.py 1 120
```

It re-read **172 lines to recover 33**. That is the shape of the class-(a) cost: the model
cannot ask for the gap alone, so it brackets it generously.

### 7.2 Proceeding without the gap [M]

`fp-codex-tab-20260826`, `accenture__sfmc-devtools-1974-sweet`, rep 0, `resolved = False`

```
cmd : ss-read lib/index.js 1440 1580 && ss-read lib/index.js 1808 1895
      Original token count: 2844   →  Total output lines: 239
```
```
1543\t        } else {
1544\t …344 tokens truncated… * Updates the key to match the name field
1579\t     *
1580\t     * @param {string} businessUnit name of BU
```
**Lines 1545–1578 are gone — 34 lines, 344 tokens**, inside the range the model itself asked
for. It never came back:

```
k=1  d-unrelated  ss-grep "required.*type|type.*required|At least one.*type|key.*required" -k 30
k=2  d-unrelated  (envelope with no read target)
k=3  d-unrelated  apply_patch <<'PATCH' … *** Update File: /root/.ss-eval/runs/r0-2/lib/index.js
```

The third call is the edit. It went ahead and patched `lib/index.js` without ever seeing
lines 1545–1578 of it. The anchor it used was shown elsewhere, so this is not a §3.2 case —
but it is the honest picture of what "proceeded" means.

Note the tail the cut left intact:
```
# unread below (1581-2279): metadataToTypeKey, #retrieveKeysWithLike, fixKeys, #fixKeys,
#runMethod +2 more — continue: ss-read lib/index.js 1581 2279
```
**`ss-read` tells the model precisely what lies below the range it asked for, and nothing at
all about the 34 lines the harness deleted from inside it.** That asymmetry is the actionable
finding.

### 7.3 An `ss-search` pack cut — rank 2 dies, the verdict survives [M]

`fp-codex-tab-20260826`, `accenture__sfmc-devtools-1974-sweet`, rep 0

```
cmd : ss-search "refresh called without type or key missing validation error" -k 8
      Original token count: 2989   →  Total output lines: 253
      # ss-search: routed=hybrid conf=0.99 budget=3…
```
```
- calls getProperties → lib/util/config.js:42-99 [method]
- calls retrieve → lib/index.js:259-376 [metho…489 tokens truncated…bject;
1028\t            await MetadataTypeInfo[type].getDependentFiles(
1029\t                selectedTypes[type],
```
Ranks surviving: **head `[1]`, tail `[3,4,…,18]`. Rank 2 is gone entirely** — its header, its
body and its graph edges — and the numbering after the cut belongs to a different file, so
nothing marks the loss. The trailer survived:

```
## #18 test/resourceFactory.js:29-31 [method: get] (summary) score=0.083
shown-full: lib/index.js:1577-1659
route=hybrid confidence=low sufficient=unknown reason=well_formed_only repo=ok results=18
```

`sufficient=unknown` reached the model. The second-best result did not. The three following
calls were all class (d) — `ss-grep "refresh" -k 30`, `ss-semantic`, `ss-grep "static async
refresh"` — the model kept searching rather than asking for rank 2 back, because it had no
way to know rank 2 had existed.

---

## 8. What this implies for the `ss-*` renderers

**Do not build a general cap-aware renderer.** [I] The measured prize is 1.75% of a codex TAB
cell and 2.53% of a PIPE cell, the cap already pays for itself 2–19× over, and no edit in 480
was harmed by a cut. That is below the bar every other lever in this program has had to clear.

**One narrow change is supported by the bytes.** `ss-read` already emits
`# unread below (1581-2279): … — continue: ss-read lib/index.js 1581 2279` for the lines
*after* the range it delivered. It emits nothing for the lines the harness deleted from
*inside* that range (§7.2). The same affordance, applied to the cap, would let `ss-read`
render at most ~2,400 tokens and name the remainder as an unread span the model can ask for
by line number. That converts the 33% of requested lines silently deleted under TAB into an
explicit, addressable continuation — and it costs nothing, because the bytes were never going
to be delivered.

**The same argument applies more strongly to `ss-search` packs**, where a cut removes a whole
middle rank with no trace at all (§7.3), and where the pack already knows how many results it
is holding (`results=18`). Emitting fewer, complete ranks beats emitting more ranks and losing
one invisibly.

**Do not change the gutter delimiter for this.** [M] TAB and PIPE behave the same here (31.1%
against 32.7% at k=1), and NONE's apparent saving is the model failing to notice a loss, not
avoiding one.

---

## 9. Method, and what is not measured

**Cells.** 4 = codex × (native + 3 gutter forms). Native exists only in the `*-tab-*` run and
is form-independent. **0 cells missing, 0 cells held more than 3 transcripts**, so the
3-dearest-transcript rule selected every retained rollout and no retry was discarded. [M]

**Span resolution, three ways, in order.** (1) Gutter numbers either side of the marker, but
only when the block header before and after the cut names the same file *and* the span is
contained in the block's own declared range. (2) `rg`-style `path:line:` prefixes. (3)
Matching the cut line's prefix and suffix against the golden base file, restricted to the
files named in the envelope. This makes NONE and native measurable rather than "unknown".

**Known limits.**

1. **The containment check is load-bearing and was added after an audit.** Without it a cut
   that eats the next block's header leaves two increasing numbers from two different files;
   the largest such phantom claimed 1,884 deleted lines at 1.4 tokens per line. After the
   check, no resolved span in any cell falls below 3 tokens per line and the medians are
   10.4 / 12.1 / 9.9 — real code. **17 TAB and 11 PIPE spans were reclassified** as
   cross-block cuts by this audit.
2. **Span resolution is uneven by construction**: 49/105 TAB, 21/100 NONE, 52/120 PIPE,
   16/238 native. Every cross-cell claim in this report therefore uses the span-free
   file-level measure (§3.1); the span-level rate is reported beside it and does not
   separate the cells.
3. **Codex envelopes are overwhelmingly compound, and this is the largest caveat.** A single
   `exec_command` runs `ss-read … && ss-find …`, and the cap applies to the concatenated
   output. **68% of TAB, 77% of NONE, 73% of PIPE and 95% of native truncations sit in an
   envelope with more than one read-class sub-command.** [M] Class attribution there rests on
   the rendered block header, not on the command — which is why native, whose `sed`/`cat`
   output carries no header at all, resolves a file for only 85 of 238 markers.
4. **The outcome correlation is confounded with task difficulty** (§6) and no attempt is made
   to deconfound it. It should not be quoted as a truncation effect.
5. **Class (c) requires the symbol to appear only inside the deleted span**, tested against
   the golden base file. A symbol the model already knew from the issue text would be scored
   (d). The class is a lower bound.
6. **Cost is the ideal cache-normalised reconstruction**, 0.57–0.59% below the published
   cell totals. Shares are computed against the published totals, so they are marginally
   conservative.

---

## Appendix — artifacts

| file | contents |
|---|---|
| `12-truncation-census.json` | all 563 truncated outputs: command, cap, original/deleted tokens, every marker with its span and resolution method, the next three calls with their class and price, the counterfactual, plus the per-cell tables, the blind-edit check and the three exhibits |
| `scripts/t1-census.py` | the census: parsing, marker resolution, follow-up classification, pricing, counterfactual, outcome buckets |
| `scripts/t1-analyse.py` | tables 1–7, the Fisher tests, and the non-null / denominator assertions |
| `scripts/t1-blind.py` | the anchor-in-deleted-span check, instrumented with its own denominators |
| `scripts/t1-exhibits.py` | the three quoted exhibits |
| `scripts/t1-outliers.py` | the tokens-per-line audit that exposed the block-crossing false spans |
| `scripts/t1-diag.py`, `t1-peek.py`, `t1-headers.py` | shape probes: cap size, marker form, block-header vocabulary |
| `logs/t1-truncation.log` | full output of `t1-analyse.py` |
