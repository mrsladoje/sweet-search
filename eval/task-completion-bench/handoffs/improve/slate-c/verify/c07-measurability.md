# c07 — adversarial verify, DIFFERENTIAL and MEASURABILITY lens (2026-09-02)

## 0. Verdict

**REFUTED. Confidence 0.94.** The vehicle is genuinely sweet-only and the cut-geometry fact is
true, but four measurements I ran myself kill the candidate. Two of them use the candidate's own
pre-registered rules and both fire.

1. **The candidate's own kill condition already fires, at `$0`.** On the 25 truncated packs where
   the cut begins inside the top-ranked body — the exact population the design exists to serve —
   the complete top-1 body exceeds 4,800 characters in **21 of 25 (84%)**, and the pack preamble
   plus that body exceeds 4,800 characters in **25 of 25 (100%)**. The candidate kills itself
   above 6 of 33 (18%). Median complete top-1 body is **9,949 characters**, which is 98% of the
   whole 10,203-character window codex delivers. "Complete top-1 body in the head plus an all-rank
   manifest in the tail" is arithmetically impossible at the median, at any head cap. [M §2]
2. **The ceiling's driver has no mechanism.** The claimed −0.7% assumes half of 18
   truncation-attributable follow-up requests vanish. **13 of the 14 cuts that produced those
   follow-ups are `ss-read` cuts, not `ss-search` packs**, and only 6 of 14 are single-command
   envelopes. The subset the layout can both reach (single command) and help (`ss-search`) is
   **1 cut, 2 request-counts, $0.00121 = 0.149% of the $0.8138 cell**. That is the gross upper
   bound, five times below the claim. [M §3]
3. **On the majority class the layout removes content and raises follow-up pressure.** 65
   gutter-bearing truncated `ss-read` envelopes deliver a median **228 numbered code lines
   (9,660 characters)** today — 122 lines in the surviving head and 115 in the surviving tail.
   A 4,800-character head with a manifest tail delivers at most 4,800 characters of code: a
   median loss of **4,860 characters = 50%**, on **61 of 65 envelopes (94%)**. The candidate's
   `solve_risk` line, "superset of today's surviving content", is inverted on 62% of the
   population. [M §4]
4. **The effect is 119 times smaller than the bench's noise.** Paired by task at n=22 on
   `fp-codex-tab-20260826`, the minimum detectable cost effect at 80% power is **±17.8% of the
   codex sweet cell**. Detecting −0.149% needs about **312,000 paired tasks**; detecting the
   claimed −0.7% needs about **14,200**. [M §5]

**What survives.** The cut geometry is a real, new harness fact and I reproduced it. The
accounting half is real — I confirmed the mechanism in product code — but the candidate itself
says it books no lever value, so it is a measurement row, not a lever. Both belong in the
register, neither is a candidate.

Tags: **[M]** measured (script named), **[C]** read from code, **[I]** inferred. Scripts:
`verify/scripts-c07-measurability/` (copies of `/tmp/wf-slatec/c07-measurability/v2/` on the box).
Nothing was written under `results/`. HO2 was not opened. No grading log was read. No rollout was
launched. No product or bench code was edited.

---

## 1. Population and denominators

All from `fp-codex-tab-20260826`, sweet arm, 66 rollouts, published cell cost $0.8138.

| population | n | source |
|---|---:|---|
| truncated `ss-*` envelopes | 105 | `forensics/codex-cap-x-ss.md` §3, reproduced |
| — cut region is `ss-read` | 66 | same |
| — cut region is `ss-search` | 33 | same |
| — cut region is `ss-find` / `ss-trace` | 4 / 2 | same |
| single-command cuts (no `&&`) | 33 (`ss-search` 17, `ss-read` 11, `ss-find` 3, `ss-trace` 2) | same §4.4 |
| `&&` bundle cuts a per-command renderer cannot govern | 72 (69%) | same |
| result packs I parsed (`ss-search` / `ss-find`, all sizes) | 132 | [M] `r1size.py` |
| — of those, truncated | 39 | [M] `r1size.py` |
| — of those, cut begins inside the rank-1 body | **25** | [M] `r1size.py`, matches `codex-cap-x-ss` §4.2's 25/33 exactly |
| gutter-bearing truncated `ss-read`-class envelopes | 65 | [M] `ssread.py` |
| cuts producing a truncation-attributable follow-up | 14 | [M] `followups.py` |

**Two different sets are both called "33".** The candidate's kill condition says "6 of 33
addressable cuts". The 33 single-command cuts are not the 33 truncated `ss-search` packs. Only
**17** single-command cuts are `ss-search`, and only an `ss-search` pack has a top-1 body and an
all-rank manifest. The kill condition as written has the wrong denominator. [M]

**Both named exhibits are outside the addressable set.** `accenture__sfmc-devtools-1974` sweet
rep 0 `rollout-2026-08-26T22-28-06-01a04030…` call 5 is
`ss-read lib/index.js 700 820 && ss-read test/general.test.js 2280 2365 && ss-read lib/cli.js 120 155`
(3 sub-commands). Sweet rep 1 `rollout-2026-08-26T22-30-34-01a04032…` call 1 is
`ss-search "…" -k 5 && printf … && ss-grep "refresh" -k 20` (3 sub-commands). Both sit in the 72
bundle cuts. [M, read from `forensics/scripts-codex-cap-x-ss/codex-cap-x-ss.json`]

---

## 2. The pre-registered kill condition fires [M `r1size.py`, `r1calib.py`]

**Method.** For every `ss-search` / `ss-find` pack in the 132 sweet codex transcripts I parsed the
pack header, the rank-1 header (`## #1 path:start-end [symbol] (presentation) score=…`), and the
rank-1 block. The rank-1 header survives every cut (33/33 in the source forensics), so
`start`-`end` is always known. Complete rank-1 body characters = block overhead + span lines ×
mean delivered characters per numbered line.

**Estimator calibration.** On 88 untruncated packs the delivered rank-1 block *is* the complete
body, so the estimate can be checked against truth: median relative error **+0.000**, p10 +0.000,
p90 **+0.023**, mean +0.031. The estimator is exact at the median and biased at most 3% high. [M]

**Result.**

| population | n | median complete rank-1 body | body > 4,800 chars | preamble + body > 4,800 chars |
|---|---:|---:|---:|---:|
| cut begins inside rank-1 (the design's target) | 25 | **9,949** | **21 (84%)** | **25 (100%)** |
| truncated, cut elsewhere | 14 | 2,472 | 0 (0%) | 3 (21%) |
| all truncated packs | 39 | 6,091 | 21 (54%) | 28 (72%) |
| untruncated packs | 93 | 2,061 | 13 (14%) | 20 (22%) |

Rank-1 span on the 25 target packs: median **215 lines**, p90 386, max 500. [M]

**Reading.** The candidate dies by its own rule. It set the line at "more than 6 of 33" (18%); the
measured rate is 84% on body alone and 100% once the pack header and `### imports` section that
must precede the body in the head are counted. Raising the head cap does not save it: the median
target body is 9,949 characters against a total delivered window of 10,203, so a complete top-1
body consumes the entire window and leaves nothing for a tail.

**This also refutes the candidate's escape from register C9.** The candidate distinguishes itself
from C9 by claiming C9 "is a budget (removes content)" while this is "a layout that removes
nothing". To place a complete top-1 body inside a 4,800-character head the renderer must shorten
that body in 84–100% of target cases. Shortening the body is the budget. `codex-cap-x-ss.md` §8
recommends C9 move from DEFERRED to DEAD.

---

## 3. The ceiling's driver: measured, and it is not there [M `followups.py`]

The claimed ceiling is arithmetically self-consistent and empirically empty. 18 unique
truncation-attributable follow-up requests over 66 rollouts is 0.273 per rollout; half is 0.136
≈ the claimed −0.14; 9 × the $0.000625 mean request price is $0.005625 = 0.69% ≈ the claimed
−0.7%. The premise, "half the follow-ups vanish", is what fails.

| attribute of the 14 cuts that produced a follow-up | count |
|---|---:|
| cut region is `ss-read` | **13** |
| cut region is `ss-search` | **1** |
| single-command envelope | 6 |
| `&&` bundle | 8 |
| in one task, `bfgroup__b2-113` (never solved by any arm on this pool) | 6 |

Total request-counts: 17 class-(a) re-reads + 3 class-(c) gap-symbol searches = 20, priced
$0.01422 = 1.75% of the cell. [M, reproduced from the forensics JSON]

**Addressable subset** — single-command envelopes whose cut region is an `ss-search` pack, the
only shape where "complete top-1 body in the head, all-rank manifest in the tail" is even defined:
**1 cut** (`devlooped__moq-1262` sweet rep 1 call 3), **2 request-counts**, **$0.00121 = 0.149% of
the cell**. That is the gross ceiling if both requests disappear entirely.

The other 13 follow-up generators are `ss-read` cuts. The layout does not close an `ss-read` gap —
the middle is still deleted — so those follow-ups do not vanish. Section 4 shows they get worse.

---

## 4. On `ss-read` the layout halves the delivered code [M `ssread.py`]

65 truncated envelopes whose cut region carries a `N<TAB>` gutter (the `ss-read` class):

| quantity | surviving head | surviving tail | total delivered |
|---|---:|---:|---:|
| numbered code lines (median) | 122 | 115 | **228** |
| numbered-line characters (median) | 4,928 | 4,787 | **9,660** |

Today's cut keeps real file lines at **both** ends. The candidate's tail is a manifest plus a
continue command, so under it the delivered code is bounded by the 4,800-character head.

- Median loss: **4,860 characters = 50% of the code delivered today**.
- Envelopes that lose content: **61 of 65 = 94%**.

So on 65 of 105 cuts (62%) the design strictly reduces what the model sees, in the class that
generates 13 of 14 follow-ups. `solve_risk: "Low; superset of today's surviving content"` is not
a wording slip; it is inverted on the majority of the population, and it points the follow-up
count the wrong way.

**The tail manifest is also not free.** Median `results=` on a truncated pack is 15; a manifest
row like `#12 path/to/file.js:1234-1299 [method: name]` is about 62 characters ≈ 15.5 tokens at
the run's measured 3.99 bytes per token, so a manifest is about **233 tokens per pack**. Two
implementations, both worse than the −0.149% ceiling:

- **Always emitted** (the specification as written): on the 93 untruncated packs it is pure added
  ingest, 1.41 packs per rollout × 233 tokens = 328 tokens, priced at $0.10/M new ingest plus 18.4
  later re-sends at $0.01/M = $0.284/M → **+$0.0000932 per rollout = +0.76% of the cell**. It also
  re-renders rank headers the pack already contains — the same information twice, the mirror image
  of the banned compaction class.
- **Emitted only when the renderer predicts a cut**: no dollars, but it displaces about 930
  characters of real code from a fixed 10,203-character window on every cut pack.

---

## 5. Measurability against the bench's own noise [M `noise.py`, on `fp-codex-tab-20260826/rows.json`]

| quantity | sweet | native |
|---|---:|---:|
| cost per rollout, mean (n=66) | $0.012330 | $0.012287 |
| standard deviation | $0.008753 | $0.007963 |
| solved | 39/66 | 41/66 |

Paired by task, n=22: mean difference **+$0.000043**, standard deviation $0.003669, standard error
$0.000782. Minimum detectable effect at 80% power, two-sided α=0.05 (2.8 × standard error):
**$0.002190 = 17.8% of the sweet cell**.

| effect | size | paired tasks needed at 80% power |
|---|---:|---:|
| addressable ceiling (§3) | −0.149% | **≈ 312,000** |
| candidate's claimed ceiling | −0.7% | **≈ 14,200** |
| current paired corpus | — | 22 |

Requests tell the same story: sweet calls per rollout mean 12.45, standard deviation 9.12 (n=66),
standard error 1.12. The claimed −0.14 requests per rollout is **0.13 standard errors**.

This is consistent with register **G10**, computed a different way: detecting a 5% cost effect at
80% power needs about 465 tasks against a paired corpus of 16–17.

**No cheaper instrument exists.** A fixed-trajectory replay cannot substitute — the brief's own
trap list records that a replay "gets the direction of a context change right about as often as
not and never the size" (C-4: replay −2.8%, live +4.8/+19.8/+11.7%).

---

## 6. Rule checks

| rule | result |
|---|---|
| **Differential — sweet-only vehicle?** | **PASS.** `detectAgentEnv()` at `core/search/output-policy.js:56` classifies codex from any `CODEX_*` key [C]. `renderAgentSearchResponse` at `core/search/search-server.js:636` is the agent render path and its own comment records "benchmark path is JSON, never here" [C]. Native's `sed`/`rg`/`cat` never enter this code. The zero-differential rule is not triggered. |
| **Admissible vs banned class** | **Layout: PASS on the letter.** It changes which bytes survive a cut, not how densely the same bytes are rendered. **Manifest: FAIL on the spirit** in the always-on form — it re-renders rank headers already present in the pack (§4). |
| **Changes which lines or which requests?** | **Lines: yes, measurably in the wrong direction** (§4). **Requests: claimed, unsupported** (§3). |
| **`$0` falsifier real and pre-registrable?** | **Pre-registrable yes, but the stated recovery method is wrong, and the condition already fires.** "Head plus tail plus the recorded original token count" does not recover the deleted middle. The runnable method is the surviving rank-1 header's `file:start-end` plus the delivered lines' character rate — which is what §2 ran, on the whole population, with the answer 84–100% against a kill line of 18%. |
| **Detectable given bench noise?** | **NO.** 119× below the paired minimum detectable effect (§5). |
| **HO2** | PASS. Not opened; no `ho2-*` or `HELDOUT2*` path touched. |
| **Gold / hidden tests / task identity at runtime** | PASS. No runtime input of that kind. |
| **Ranking-signal format gate (`opts._isAgentFormat`)** | **PASS, with one caveat.** No scoring or ordering changes, and the benchmark path is a different renderer [C], so GCSN cannot move. Caveat: `detectAgentEnv` fires on *any* `CODEX_*` variable, so a retrieval benchmark launched from inside a Codex session would silently get the reordered render. Gate the benchmark harness explicitly if this is ever built. |
| **Owner decisions** | PASS. Gutter untouched, no new tool, MCP untouched, guidance block untouched. `needs_user_decision: No` is correct. |
| **Solve veto** | **NEGATIVE.** No measured upside (0 of 480 codex edit calls ever anchored on a truncation-hidden line, carried from `12-truncation-census.md` §3.2), and an unpriced downside of 50% less delivered code on 94% of truncated `ss-read` envelopes (§4). |

---

## 7. Register position

- **C9** (fit under codex's cap, PARKED, recommended DEAD by `codex-cap-x-ss.md` §8): the escape
  argument fails. §2 shows the head cap removes content in 84–100% of target cases, so this *is* a
  budget. C9's own arithmetic then applies: best case −0.36% on the population it reaches, positive
  (+0.15% to +1.55%) at the measured 23.6% pointer-follow rate.
- **B13** (payload budgeting by lifetime — top-1 body plus a manifest of lower ranks, PARKED, kill
  above 20%): under a fixed window, c07 delivers exactly B13's payload shape. B13's screen has
  never been run and c07 substitutes a different falsifier. The synthesis must not treat c07's
  falsifier as discharging B13's.
- **C11** (a whole middle rank disappears silently, PARKED; kill below one cut pack in ten): c07
  revives C11's symptom without running C11's screen. "Unrunnable" is overstated — re-running
  `ss-search` on the goldens costs $0 in model spend; it needs an index build, not a rollout.
- **C8** (raise the cap, CLOSED): correctly distinguished; no shared setting changes.
- **G-class row worth keeping:** `budget=N used=M` under-declares the rendered size. Confirmed in
  code [C]: `used=${response?.tokensUsed}` at `core/search/search-server.js:640`; `tokensUsed`
  accumulates code tokens in `core/search/context-expander.js` (2260, 2314, 2379, 2456); the gutter
  is applied later at render time (`search-server.js:658` → `numberCodeLines`). Book as product
  honesty, no lever value. I did not re-run `budget-vs-bytes.py`, so the 1.46–2.86 ratios are
  carried, not verified by me.

---

## 8. Corrections the synthesis must adopt

1. **Ceiling.** Replace "codex −0.7% (−0.14 requests/rollout)" with **"at most −0.149% of the codex
   sweet cell (1 cut, 2 request-counts, $0.00121 over 66 rollouts), gross of a manifest that costs
   +0.76% always-on or 930 displaced characters per cut pack"**.
2. **Solve risk.** Delete "superset of today's surviving content". Replace with: **"on 61 of 65
   truncated `ss-read` envelopes (94%) the design delivers at most 4,800 characters of code where
   today's cut delivers a median 9,660 — a 50% reduction"**.
3. **Kill condition.** It has the wrong denominator (the 33 single-command cuts include only 17
   `ss-search` packs) and **it has already fired**: 21/25 (84%) on body alone, 25/25 (100%) with the
   pack preamble, against a line of 18%.
4. **Register check.** "C9 is a budget, this is a layout that removes nothing" is refuted by
   measurement; the head cap is a budget. B13's screen is not discharged. C11's screen is not run.
5. **Harnesses.** The field should read `["codex"]`. The candidate itself scores opencode and
   claude-code at 0.0.
6. **Accounting half.** Real and confirmed in code, but it books no lever value and cannot carry a
   lever slate. Move it to the measurement class as a product-honesty row.
7. **Falsifier method.** "Head plus tail plus the recorded original token count" does not recover
   the deleted middle. Use the surviving rank-1 header's span plus the delivered character rate.
8. **Detectability disclosure.** Any future candidate in this family must state its effect against
   the measured paired minimum detectable effect of ±17.8% of the codex cell at n=22 tasks.

---

## 9. What I could not finish

1. I did not re-run `budget-vs-bytes.py`. The 1.46–2.86 declared-versus-rendered ratios and the
   `budget=8000 used=1726` on 33,200 characters exhibit are carried from the candidate, not
   verified by me. I verified only the code mechanism that makes under-declaration inevitable [C].
2. I did not verify the 163 lost definition lines, the 25 half-delivered top-1 bodies as a count of
   *lost content* (I measured the body sizes, not the losses), or the 18 unique follow-up requests
   first-hand from transcripts; those are carried from `codex-cap-x-ss.md` F4, F5, F7. I did
   reproduce the 20 request-counts and the $0.01422 price from that report's own JSON.
3. My complete-rank-1-body figures are an estimate, not a direct read of the deleted text, which
   was never delivered. The estimator is calibrated to a median relative error of 0.000 on 88 full
   blocks, and the conclusion survives a 50% estimator error at the median.
4. I did not measure how the layout would behave under a different codex window. The `c07-history`
   report measures that the window was 4× larger 15 days earlier at an identical `cli_version`;
   I did not re-verify that census.
5. I did not price the added continue-pointer follows the tail would create. Section 3 shows the
   saving is already gone without them.
6. HO2 was not opened. No grading log was read. No rollout was launched. Nothing under `results/`
   was written; box scratch is `/tmp/wf-slatec/c07-measurability/v2/`.

---

## Appendix — artefacts

| script (in `verify/scripts-c07-measurability/`) | what it measures |
|---|---|
| `r1size.py` | parses 132 codex sweet `ss-search`/`ss-find` packs; pack header, rank-1 span, delivered block, estimated complete rank-1 body; writes `r1size.json` |
| `r1calib.py` | calibrates the estimator on 88 untruncated packs; splits truncated packs by whether the cut begins inside rank-1; sizes an all-rank manifest |
| `ssread.py` | 65 gutter-bearing truncated `ss-read` envelopes: numbered code lines and characters delivered in the surviving head and tail |
| `noise.py` | `rows.json` cost dispersion, paired-by-task difference, minimum detectable effect, calls per rollout |
| `followups.py` | attributes the truncation-attributable follow-up requests to cut class and envelope shape; prices the addressable subset |

Box scratch: `/tmp/wf-slatec/c07-measurability/v2/`. Evidence read (read-only):
`/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/`
(`agent-state/*-sweet/codex-home/sessions/**/rollout-*.jsonl`, `rows.json`).
