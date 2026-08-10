# Lever #3 — phase-aware eviction: Gate 0 ($0) results

Operator: Claude (session 2026-08-10). Protocol: `/microsmoke`, gates in order, $0 first.
Data: `results/postfix-screen17` — 68 raw codex rollouts (17 DEV-RET tasks × 2 arms × 2 reps),
backbone `openai/gpt-5.6-luna`, **post-lever-#1** (verified: every `run_tests` launch carries
`yield_time_ms:300000`, the SS_RT_LONGYIELD signature). HO2 untouched.

---

## PRE-REGISTRATION (written before any measurement was run)

Committed 2026-08-10, before executing `stats/resend-census.mjs`. Copied verbatim from
`HANDOFF-EVICTION.md` §4 with the one free parameter ("LOW refetch rate") pinned to a number.

**Cost model.** `idealCost` (cache-normalized), per `harness/ideal-cost.mjs`:
`newIn_i = max(0, in_i − in_{i−1})`, `resent_i = in_i − newIn_i`, charged
`newIn·$0.10/M + resent·$0.01/M + out·$0.60/M`. Never realized cost.
The **resident re-send tax** is the `resent_i · $0.01/M` term. Its composition at request *i* is
exactly the composition of the context at request *i−1* (re-sent tokens are the carried prefix).

**Gate 0a — headline number.** Residual re-send tail = the share of total ideal spend that is
spent re-sending **prior tool-result bodies** (search output, read output, test logs), summed over
**non-poll** requests only. Poll turns are excluded so lever #1's win is not double-counted.

**Gate 0b — trigger grid.** Resident caps {24K, 32K, 40K, 48K} replayed on dart-http + mransan.
At each edit/test boundary, evict tool-result bodies whose age pushes the resident total past the
cap; leave a placeholder. Report input-tokens-avoided, the ideal-$ saved *net of the cache-prefix
break* eviction forces, and the refetch rate.

**Refetch rate** = fraction of evicted tool-result bodies whose content a LATER turn demonstrably
needs again (same file re-read, same command re-issued, or the evicted path named in a later edit
without an intervening re-read).

**BAR — #3 proceeds to a live smoke ONLY IF BOTH:**
- **(A)** residual non-poll re-send tail **≥ 15.0%** of ideal spend (arm-mean), AND
- **(B)** at least one cap avoids **≥ 10.0%** of input tokens at a **LOW** refetch rate,
  where **LOW ≡ ≤ 10%** (10–25% = medium/unsafe, > 25% = high/lossy).

**Otherwise: DROP #3 for $0** and move to lever #4's cheap taxonomy pass. A kill here is the
intended outcome of the gate, not a failure.

**Solve-safety veto (standing).** Accuracy is non-negotiable; a cost lever that plausibly costs a
solve is rejected regardless of its cost win.

---

## VERDICT — **DROP lever #3 for $0.** Both bar conditions failed.

| Bar | Required | Measured | |
|---|---|---|---|
| **(A)** residual non-poll tool-body tail | ≥ 15.0% of ideal spend | **10.2%** (native 12.1%, sweet 8.0%) | **FAIL** |
| **(B)** a cap avoiding ≥10% input at LOW (≤10%) refetch | both, at one cap | **no such cap exists** | **FAIL** |

Total spend to reach this verdict: **$0.00**. No live cell was run. No eviction engine was built.

---

## Gate 0a — residual re-send census (`stats/resend-census.mjs`, 68 rollouts)

GPT's 33.4% number **replicates** — and that is exactly why the lever dies. The resident re-send tax
is real and large, but its composition is not what the lever assumed.

| component | $ | % of ideal spend | evictable? |
|---|---|---|---|
| **total resident re-send tax** | $0.16552 | **30.7%** | — |
| ├ frame (system prompt + task statement + tool docs) | $0.09714 | **18.0%** | **no** — it is the preamble |
| ├ agent's own output (reasoning, tool args) | $0.00945 | 1.8% | no |
| └ **tool-result bodies** | $0.05893 | 10.9% | partly |
| **residual NON-POLL tool-body tail (the headline)** | $0.05498 | **10.2%** | — |

**59% of the re-send tax is the fixed preamble**, re-sent verbatim every turn and un-evictable by
construction. GPT's 33.4% was right in total and wrong in attribution: it read the whole tax as
addressable. Only a third of it is tool bodies, and eviction can only reach the *older* part of
that third — so 10.2% is a strict ceiling that no policy attains.

Arm split: native 12.1% / sweet 8.0%. Sweet's tail is **smaller** because ss-\* returns tighter
payloads than raw `rg`/`sed` — a real product fact, and the reason a sweet-only eviction win would
have been an unfair number anyway.

**Measurement validity** (this number decided the lever, so it was stress-tested):
- *Alignment verified, not assumed.* In a codex rollout the order is
  `reasoning → tool_call → tool_output → token_count`, so a `token_count` reports the request that
  produced the items **above** it; that request's input contains neither its own reasoning/call nor
  the tool output answering it. Regressing input growth on byte growth confirms it: this alignment
  fits **R² = 0.947** with slopes of 3.87 bytes/token (tool bodies) and 4.44 (agent text); the naive
  "everything earlier in the file" alignment fits **R² = 0.019** and implies an impossible 8.6
  bytes/token. My first pass used the naive alignment and read 13.8% — wrong, and corrected here.
- *Calibration-insensitive.* Perturbing the tool-body tokenization slope ±60% moves the tail only
  **9.7% → 10.8%**. The verdict does not depend on the calibration.
- *Small residual.* Mean |unexplained| = 646 tokens on a mean 24,554-token request (2.6%).
- *Cost model cross-check.* Cache-normalized ideal re-send $0.16552 vs realized-cache $0.16429 —
  a 99.3% match, i.e. the provider cache essentially always hit. There is no free cache break to
  exploit (this matters for 0b).
- *No provider compaction.* 0 context drops in 760 requests — the full prefix really is re-sent.

## Gate 0b — trigger grid (`stats/eviction-grid-replay.mjs`)

Evict oldest tool bodies at each `apply_patch`/`run_tests` boundary until resident ≤ cap; leave a
30-token placeholder. **dart-http + mransan** (the two blow-up tasks — the most favourable ground
for the lever):

| cap | input avoided | ideal-$ saved | **NET-$ saved** | refetch | blind edits |
|---|---|---|---|---|---|
| 24K | 23.6% | +10.6% | **+1.5%** | **27%** (lossy) | 3 |
| 32K | 15.2% | +7.7% | **−12.3%** | **23%** (unsafe) | 1 |
| 40K | 8.5% | +4.1% | **−15.1%** | 11% | 1 |
| 48K | 2.7% | +1.5% | **−6.6%** | 0% (low) | 0 |

All 17 tasks: every cap is net-negative (24K −3.4%, 32K −6.9%, 40K −3.9%, 48K −1.3%).

**No cap satisfies (B).** The only low-refetch cap (48K, 0%) avoids 2.7% of input — far under the
10% bar. The only caps clearing 10% input-avoided (24K, 32K) refetch at 27% and 23%, both above the
pre-registered LOW ≤10% threshold, i.e. they would starve solves. Accuracy is non-negotiable.

**Why NET is negative where "ideal-$ saved" is positive — the mechanism that kills the lever.**
Prompt caching is a **prefix** cache. Deleting an item mid-conversation invalidates every token
after it, so the next request re-pays the **full input rate for the whole surviving suffix** —
10× the cache-read rate on Luna ($0.10/M vs $0.01/M). Eviction drops the *oldest* bodies, so the
hole lands near the start and nearly the entire context re-prices. Evicting at every edit/test
boundary means that happens constantly: 250 of 760 turns are boundaries.

The bench's canonical `idealCost` is **cache-normalized** — it charges every re-sent token at the
cache rate by construction, so it is structurally blind to this cost and reports a clean win
(+10.6%) for a policy that actually loses money (−12.3% at 32K). Had this lever been evaluated on
idealCost alone, as every other cost lever in this program is, it would have shipped a loss.
The `NET-$` column exists because of that.

The 24K row is the one non-negative net (+1.5%), and only because it evicts so aggressively that
the context stays small and the breaks get cheap — bought at a 27% refetch rate and 3 blind edits.
That is the lossy corner, not a win.

*Refetch detector validated by inspection:* re-read files (`sed -n '1,190p' base_request.dart`) and
re-run suites are correctly flagged; broad one-off searches (`rg -n "Map<String,String>|headers"`)
correctly are not. Rate rises monotonically with cap aggressiveness (0% → 11% → 23% → 27%), the
physically expected ordering.

## Gate 0c — fusion economics (supporting sensitivity, retired Grok DB, NOT a Luna measurement)

`stats/w0b-fusion-economics.mjs` on the retired 551-pair `opencode.db` (on the box;
the Mac copy holds a different, older window and yields 0 candidates).

- Standalone fusion is **net-negative**: top-1 −$0.0097, top-3 −$0.0070 — both gates NO-GO.
- It flips positive **only `with_eviction_W4`**: +$0.0064, GO.

Exactly as the handoff predicted: fusion pays only as a rider on eviction, because otherwise the
fused bundle is re-sent forever. **Eviction failed its gate, so the rider has nothing to ride on.**
Span-capped fusion is therefore also dropped here.

## The redirect this gate produced (the useful $0 finding)

The census found the real re-send driver, and it is not tool bodies — it is the **preamble**, at
18.0% of ideal spend. Within it sits a clean, arm-asymmetric target:

**The sweet arm's preamble is exactly +1457 tokens larger than native's, on all 17 tasks** — the
ss-\* tool documentation plus the M± block. It is re-sent on every one of the ~11.6 requests per
rollout. Carrying it costs **$0.01018 = 4.1% of the sweet arm's total ideal spend**.

That is a bigger, safer prize than eviction ever offered: it is static text, so trimming it carries
no cache-break cost and no refetch risk. The risk it *does* carry is different — shorter tool docs
could degrade tool use — so it needs its own $0 exposure gate and a solve-safety check, not a
free pass. Logged here as a candidate, not a decision.

## Caveat — the condition under which #3 would deserve a second look

This verdict is scoped to the **Luna** cost story we intend to publish. The lever's economics
improve with longer trajectories and bigger contexts, because the tail grows while the preamble
stays fixed. The retired Grok distribution is materially larger on both axes (resident median
38,715 tokens and 26 turns remaining, vs Luna's 24,554-token mean context over ~11.6 requests).
GPT's original 33.4%/48.8% figures came from that heavier distribution, pre-lever-#1.

Revisit #3 only if the published backbone changes to one with substantially longer trajectories,
**and** only against the NET column, never idealCost alone.

## Artifacts

- `stats/resend-census.mjs` — Gate 0a. Composition of the re-send tax, with the alignment and
  calibration derived from the data (`--calib` diagnostics inline in the header).
- `stats/eviction-grid-replay.mjs` — Gate 0b. Cap grid with cache-break-priced NET column, refetch
  and blind-edit safety counts.
- Both are $0, read-only, and run off raw codex rollouts (`results/<RUN_ID>/agent-state/**`).
