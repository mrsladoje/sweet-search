# c07 — adversarial verify, HISTORY lens

**Verdict: REFUTED. Confidence 0.90.**

c07 is the fourth appearance of one family that four documents already killed, and the
fourth of those four is this workflow's own forensics report, which c07 cites for its
numbers but not for its conclusion. Worse for the candidate, its own pre-registered kill
condition fires on data that already exists, at `$0`, without the replay it proposes: the
complete top-1 body does not fit the 4,800-character head in **21 of 27** measurable cuts
(**12 of 13** on the addressable set), against a kill bar of "more than 6 of 33"
`[M c07-rank1b.py]`. The head section is also a no-op, because codex already delivers about
**4,830 characters** of the rank-1 block and c07 proposes 4,800 `[M c07-rank1.py]`. The
accounting half is genuinely new and genuinely true, but c07 itself books it as correctness,
and the register class for accounting is "never book as a win", so it cannot carry the
candidate.

Tags: `[M]` measured (script named), `[C]` read from code, `[I]` inferred. All denominators
are stated. No rollout was launched. No grading log was opened. HO2 was not touched.

---

## 1. The recorded kills, in date order

| date | name | document | recorded fact |
|---|---|---|---|
| 2026-08-26 | **R6** "Codex: keep rendered `ss-read` under the cap" | `GUTTER-MECHANISM-INVESTIGATION.md` §7 | "**Already nearly dead at `$0`:** 0 of 6 never-shown anchors under TAB/PIPE sat in a truncated span. Kill: fewer than 1 in 10 never-shown anchors in a gap, which is the current reading." |
| 2026-08-28 | **L4** | `harness-gutter-cost-20260828/04-resolution-codex.md` §L4 | "already dead, and my data does not revive it … **Do not re-open without a new mechanism.**" |
| 2026-08-28 | **C9 family** | `harness-gutter-cost-20260828/12-truncation-census.md` §8 | "**Do not build a general cap-aware renderer.** The measured prize is 1.75% of a codex TAB cell and 2.53% of a PIPE cell … below the bar every other lever in this program has had to clear." |
| 2026-09-02 | **C9 re-priced** | `slate-c/forensics/codex-cap-x-ss.md` §0, §7, §8 | "The L4 verdict … **holds, and the new numbers close it harder** … **Register C9 should move from DEFERRED `$0` to DEAD** with these numbers." |

`slate-c/register/DEAD-LEVER-REGISTER.md` row **C9** carries the same sentence: "A general
cap-aware renderer is explicitly rejected."

Two of those documents state c07's own idea in their own words before c07 states it.
`12-truncation-census.md` §8: "The same argument applies more strongly to `ss-search` packs,
where a cut removes a whole middle rank with no trace at all … **Emitting fewer, complete
ranks beats emitting more ranks and losing one invisibly.**" That is c07's `ss-search`
design, written by the document c07 cites, under a heading that begins "Do not build a
general cap-aware renderer."

**c07 does clear L4's bar in one narrow sense.** L4 said "do not re-open without a new
mechanism", and the deterministic head-and-tail geometry is a new mechanism. So I priced the
mechanism rather than dismissing it by name. It fails on its own arithmetic. Sections 2 to 7
are that arithmetic.

---

## 2. c07's own kill condition fires, at `$0`, on data that already exists

c07 pre-registers: "Top-1 body does not fit 4,800 chars in >6 of 33 addressable cuts."

I measured the geometry directly on the traces, read-only.

`[M]` `/tmp/wf-slatec/c07-history/c07-rank1.py` and `c07-rank1b.py` over
`fp-codex-tab-20260826`, sweet TAB, 66 transcripts, 105 truncated envelopes, of which **33**
carry `ss-search` and show a rank header in the surviving head. Local copies:
`slate-c/verify/scripts-c07-history/`.

| population | n | cut fell inside that rank's body | estimable | complete body > 4,800 chars |
|---|---:|---:|---:|---:|
| all 33 truncated `ss-search` envelopes | 33 | 29 | 27 | **21** |
| single-command only (c07's addressable set) | 17 | 13 | 13 | **12** |
| cut inside rank 1 | 25 | 21 | 21 | **19** |
| rank 1 and single command | 16 | 12 | 12 | **11** |

Estimated complete body size, conservative method (characters per delivered numbered line ×
declared span lines, header and graph-edge lines excluded from the rate): median **8,163**
characters over the 27 estimable cuts, median **9,105** on the 13 addressable ones, maximum
**20,275** `[M c07-rank1b.py]`. A less conservative method that scales the whole delivered
block gives median 8,717 and 22 of 27 over 4,800 `[M c07-rank1.py]`.

**21 > 6 and 12 > 6.** The kill condition is met on both readings of "addressable", using
only recorded bytes. The replay c07 proposes is not needed to decide this.

Method limit: the estimate assumes the un-delivered part of a body has the same characters
per line as the delivered part; median measured line length is 38.7 characters `[M]`. Two of
the 29 in-body cuts carry no numbered line and are not estimable.

---

## 3. The head section cannot deliver more than codex already delivers

`[M c07-rank1.py]` The surviving head is **5,185 characters** (median; min 5,167, max 5,185),
which reproduces the candidate document's 5,190. The text before the last rank header in the
head — the pack header line and any earlier rank blocks — is **355 characters** (median), and
**354** (median; min 344, max 360) on the rank-1 single-command subset.

So codex already gives the rank-1 block about **4,830 characters** of the head today. c07
proposes a head cap of **4,800 characters**. The proposed layout therefore delivers *slightly
less* of the top-1 body than the harness already delivers by accident.

`[M]` The median delivered fraction of the declared top-1 span is **0.52** — half the body
arrives. That does not change under c07 unless the body itself is made shorter.

`[C]` `core/search/context-expander.js:47` — `DEFAULT_PER_RESULT_CAPS = [2000, 800, 400]`.
Rank 1 is capped at 2,000 tokens. At the run's measured 3.99 bytes per token `[M
12-truncation-census.md` §9, reproduced in `codex-cap-x-ss.md` §2`]`, 4,800 characters is
**1,203 tokens**. To guarantee a complete top-1 body inside c07's head, the shipped rank-1
cap must fall from 2,000 tokens to about 1,200 — a **40% cut of the top result's body**.

That is a budget. It removes content. It is register **C9**, priced dead, and it is the exact
thing c07's escape argument says it is not.

---

## 4. The tail manifest is about 96% redundant with what survives today

`[M]` My recount of `slate-c/forensics/scripts-codex-cap-x-ss/codex-cap-x-ss.json`, 33
truncated `ss-search` packs, sweet TAB, 66 rollouts:

- rank headers that **survive** in head plus tail: **512**;
- rank headers **lost** to the cut: **10**, in 8 packs; on the 17 single-command packs, **6**;
- mean rank headers arriving in the tail today: **13.33** per cut pack;
- `sufficient=` reaches the model in **33 of 33** packs;
- `route=` survives in 29 of 33; `shown-full:` in 26 of 33;
- 87 graph-edge lines and 440 tail rank rows survive across the 33 packs.

So the loss the manifest repairs is **10 rank pointer rows per 66 rollouts** (6 on the
addressable set), or **1.9%** of delivered rank headers. The `sufficient=` line that c07
lists as tail content already arrives every time. This is register **C11**'s symptom measured:
real, and very small.

**This also refutes c07's `solve_risk` sentence.** c07 says "superset of today's surviving
content". The delivered window is fixed at about **10,203 characters** `[M` candidate doc
§1.1, reproduced here at 5,185 + ~5,000 `]`. Inside a fixed window a manifest does not add;
it displaces. Today's tail carries lower-rank *bodies*; c07's tail carries *pointers* to them.
That is a substitution, and register **B8** records what happens to pointer rows: "79% of the
shipped pointer rows never followed".

---

## 5. c07 is register B13 under a new justification

Register **B13** (source `HARNESS-GUTTER-COST-ANALYSIS-2026-08-28.md` §5.1 C5), PARKED:
"payload budgeting by lifetime — on `sufficient=YES` return top-1 body + manifest of lower
ranks. Falsify it by counting how often a lower-rank body is later edited or re-read. **Kill
above 20%.**"

Under codex's fixed window, what c07 delivers on a cut pack is exactly a top-1 body plus a
manifest of lower ranks. The justification differs — B13 wanted to send fewer bytes, c07
sends the same bytes and lets the harness delete the middle — but the payload the model reads
is the same payload, and B13's `$0` screen has **never been run** (register §12.4 thread 29
is its neighbour and is also unrun).

c07's `register_check` says "B13/B14 presuppose a meaningful budget". That is true of B14 and
false of B13: B13 is a payload shape, not a token count. c07 must run B13's screen before it
can claim the substitution is safe.

---

## 6. The ceiling is over-claimed by about two times, and its sign is not established

**Over-claim.** `[M]` My split of the same JSON by envelope shape:

| population | cuts | cuts with a class-(a) re-read in 3 requests | with class (c) | request-counts | cost | share of the $0.8138 cell |
|---|---:|---:|---:|---:|---:|---:|
| all sweet cuts | 105 | 13 | 3 | 20 | $0.01422 | 1.75% |
| single-command (**addressable**) | 33 | 6 | 1 | **9** | **$0.00657** | **0.81%** |
| `&&` bundles (not addressable) | 72 | 7 | 2 | 11 | $0.00765 | 0.94% |

c07 states "−0.7% (−0.14 requests/rollout) if half the follow-ups vanish". It takes half of
the whole-population follow-ups and books them against a mechanism that reaches 31% of the
population. On the addressable set, removing **every** follow-up is **−0.81%** and 9
request-counts over 66 rollouts. Halving them is about **−0.40%**. `codex-cap-x-ss.md` §7
reaches the same place from the other side: its addressable components 1 and 2 total
**−$0.00197 = −0.24%**, and its component 0 (fewer delivered tokens) does not apply to c07,
because c07 still sends the middle and still gets truncated.

**Sign.** c07 makes the continue command and an all-rank manifest survive the cut. Pointers
are followed **23.6%** of the time within three calls and **32.6%** ever (242 pointer lines,
175 outputs, 53 of 66 rollouts) `[M codex-cap-x-ss.md` §6`]`. Every follow is a paid request
at a marginal **$0.000761** `[M` §7`]`. The measured break-even follow rate for this family is
**9.5%** on the whole population and **16.6%** on the addressable set `[M` §7`]`. The
observed rate is above both. The same arithmetic that turned C9 cost-positive applies to c07's
tail, because c07's tail *increases* the population of surviving pointers rather than
reducing it.

The candidate document's own section 2.4 asserts C-1 "adds no continuation demand". Its
section 3 then puts "the exact continue command" in the tail. Those two sentences cannot both
be true.

---

## 7. Three further checks that went against the candidate

**7.1 Both named exhibits are outside the addressable set.** `[M]` c07 names
`accenture__sfmc-devtools-1974` sweet rep 0 `rollout-2026-08-26T22-28-06-01a04030…` **call 5**
(`ss-read lib/index.js 700 820 && ss-read test/general.test.js 2280 2365 && ss-read
lib/cli.js 120 155`, **3 sub-commands**) and sweet rep 1
`rollout-2026-08-26T22-30-34-01a04032…` **call 1** (`ss-search … -k 5 && printf … && ss-grep
"refresh" -k 20`, **3 sub-commands**). A wrapper process cannot place its output at the head
or the tail of an envelope it does not own. 72 of 105 sweet cuts (69%) are such bundles
`[M codex-cap-x-ss.md` §4.4`]`. The same rollout's **call 1** *is* a single-command
`ss-search` cut; c07 did not cite it.

**7.2 The `ss-read` half is one file in one task.** `[M codex-cap-x-ss.md` §4.4`]` 55 of the
66 `ss-read` cuts are bundled, and **8 of the 11** single-command `ss-read` cuts are
`src/build/targets.py` in `bfgroup__b2-113`. That task holds 21 of the 105 sweet truncations
and is never solved by any arm on this pool `[M` §3, §5.3`]`. The "163 definition lines lost"
figure c07 quotes is measured over all 31 resolvable gaps, most of them bundled, so it is not
the addressable population.

**7.3 The geometry is epoch-fragile and the program cannot explain it.** `[M
10-panel-cost.md` claim 6`]` Epoch A (`sb-*-20260811`) carries **no** `Original token count`
field in any of 353 native and 388 sweet outputs, and had **8 truncations in 34 rollouts, all
native**. Epoch C has 238 native and 105 sweet in 66 rollouts. The cap appeared between the
two epochs, 15 days apart, and the cap bracket itself moved between epochs B and C (2,489 /
2,511 against 2,495 / 2,509). `[C/I 10-panel-resolution.md` item 6`]` The cause is contested:
epoch A ran the OpenAI path (`custom_tool_call`), epochs B and C ran OpenRouter
(`function_call`), so the envelope rule may follow the transport path rather than the codex
version. Register §12.3 thread 16 records this as unresolved and says the runs record neither.
c07 proposes a "medium, days" build whose entire value depends on a geometry that already
changed once inside this program's evidence window for reasons nobody has established.

---

## 8. Solve, the veto

`[M 12-truncation-census.md` §0 finding 3, §3.2`]` Across **2,922 anchor lines in 480 edit
calls**, 255 anchor lines were never shown by any output, 248 of those are absent from the
base file, and **0 lie inside a deleted span**. c07 quotes this as evidence of low solve risk.
It is equally evidence that the content c07 rescues has never been shown to matter. The
program's doctrine is that a lever must earn its place; a class with a clean null on its own
mechanism check and a cost ceiling below 1% does not.

`[M codex-cap-x-ss.md` §5.3`]` The outcome cross-tab is confounded and points the wrong way
for the candidate: sweet truncations followed by a gap re-read resolved 1 of 13, against 29
of 92 for those not followed. That is a difficulty proxy, not a causal claim, and it supplies
no support for the correctness story.

---

## 9. The accounting half

The `budget=N used=M` mismatch is **not on the register**. I checked every row of
`register/DEAD-LEVER-REGISTER.md` and the auto-tier memory note
(`project_auto_tier_search_colgrep_2026_05_09.md`), which records the 4k/8k/12k tier decision
tree and says nothing about the declared number differing from the rendered stream. So the
observation is new.

It is still not a lever, on three independent grounds.

1. c07 says so: "None claimed as a lever … Book this as correctness."
2. Register §9 is titled "Measurement and benchmark validity — **not levers, never book as
   wins**." An accounting correction belongs there as a G-row.
3. `[C]` The header is printed by `eval/agent-read-workflows/bin/_ss-helpers.mjs`
   (`budget=${response.tokenBudget} used=${response.tokensUsed}`). Correcting it changes what
   sweet prints about itself. It changes no line the model reads, and no request. Under
   `BRIEF.md` rule 7 that is not an admissible payload change; under rule 6 it has no
   head-to-head differential of its own.

If the tier values are later made to bind honestly, packs get smaller, which is a **content
removal** and re-enters B7 and B13 with a solve risk. c07 concedes this in its own
`solve_risk` line. Ship the accounting as a G-row; do not let it carry a lever.

---

## 10. What the synthesis must change

1. Record **C9 as DEAD**, not PARKED, per `codex-cap-x-ss.md` §8. Add c07 to that row as its
   fifth appearance.
2. Replace c07's ceiling. Measured: **≤ −0.81%** of the codex sweet cell and 9 request-counts
   over 66 rollouts if every addressable follow-up vanishes; about **−0.40%** at c07's own
   "half vanish" assumption; **positive** at the observed pointer-follow rate.
3. Withdraw "25 half-delivered top-1 bodies → 0". The measured field is "the cut fell inside
   rank 1's block"; in **4 of 25** the body was already complete and the cut fell in the
   graph-edge lines. At most 21 are half-delivered, and 19 of them do not fit the proposed
   head.
4. Withdraw `sufficient=` from the claimed gain. It already reaches the model **33 of 33**.
5. Restate the manifest gain as **10 lost rank headers across 33 cut packs**, 6 across the 17
   addressable ones, against 512 that already survive.
6. Withdraw "solve_risk: low; superset of today's surviving content". The window is fixed at
   about 10,203 characters, so the manifest displaces the lower-rank bodies that survive today.
7. Replace the two exhibits with single-command cuts, or state plainly that both named
   exhibits are `&&` bundles that the mechanism cannot govern.
8. Move the accounting half to a G-row. It is new and correct; it is not a lever.
9. If anyone revives the layout, the first gate is register **B13**'s unrun screen (how often
   a lower-rank body is later edited or re-read; kill above 20%), not a replay. The brief's own
   trap list says a fixed-trajectory replay "gets the direction of a context change right
   about as often as not and never the size" (B12/C-4: replay −1.6/−2.1/−4.7%, live
   +4.78/+19.79/+11.72%).

---

## 11. What I could not finish

- I did not measure true complete body sizes. I estimated them from delivered characters per
  delivered numbered line, scaled to the declared span. 2 of 29 in-body cuts have no numbered
  line and are not estimable. Re-running `ss-search` on the goldens would settle it and was
  out of scope on a read-only box.
- I did not replay the 105 envelopes under the three-section rule. Section 2 makes the replay
  unnecessary for the kill condition, not for the full design.
- I did not measure how often a surviving manifest row would be followed. I used the measured
  `ss-read` continue-pointer follow rate (23.6% within three calls) as the proxy, which is
  itself an upper bound (`codex-cap-x-ss.md` §10 limit 2).
- I did not price c07 on NONE or PIPE. Both were out of the forensics scope.
- I did not open HO2, any grading log, or any trajectory file.

## Appendix — artefacts

| file | contents |
|---|---|
| `slate-c/verify/scripts-c07-history/c07-rank1.py` | rank-1 geometry over the 33 truncated `ss-search` envelopes: head chars, preamble chars, delivered lines, whole-block complete-size estimate |
| `slate-c/verify/scripts-c07-history/c07-rank1b.py` | conservative body-only complete-size estimate (header and graph edges excluded from the per-line rate) |
| `slate-c/verify/scripts-c07-history/c07-recount.py` | recount of lost against surviving rank headers, and the follow-up split by envelope shape, over `codex-cap-x-ss.json` |
| box scratch | `/tmp/wf-slatec/c07-history/` (scripts plus `c07-rank1.json`, `c07-rank1b.json`) |
