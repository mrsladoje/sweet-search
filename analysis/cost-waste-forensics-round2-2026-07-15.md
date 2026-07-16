# Cost-waste forensics ROUND 2 — independent trace audit + new levers (2026-07-15)

> Reviewer: Claude (Fable 5, max effort). Read-only audit of all 332 canonical full-200 rollouts
> (77.8 MB of live codex session JSONLs pulled from the bench box and re-parsed from scratch —
> every `token_count`, `function_call`, `function_call_output`, `write_stdin`, and patch event).
> Verifies `cost-waste-forensics-2026-07-13.md` (GPT 5.6 Sol) and reports **new** cost pools it
> missed. Nothing was run or changed: no benchmark, no engine edit, no re-grade.
> **DEV DATA ONLY — NEVER PUBLISHABLE.** All dollars are cache-normalized `idealCostUsd`
> ($5/M new input, $0.5/M re-sent prefix, $30/M output), same formula as `harness/ideal-cost.mjs`.

## Verdict on the GPT cost doc

**The doc's factual layer is correct — I reproduced every headline number to six decimals from
the raw rollouts** (independent parser, not its scripts). Its proposal set is sound and now
mostly shipped. But it has **two structural blind spots**, both invisible to its call-category
lens: it apportioned costs *across tool calls* and therefore never priced (1) the **wait-loop
turns** codex burns polling long-running commands, and (2) the **on-box latency of ss-grep/
ss-find themselves**, which *causes* most sweet-arm wait-loops. Together these are a larger
addressable pool (~$20 across both arms; ~$10 sweet) than any single pool the doc ranked
(its #1 was $2.59).

### Verification ledger (recomputed from raw traces)

| # | Doc claim | My independent result | Verdict |
|---|---|---|---|
| 1 | 332 rows; sweet $133.596324 / native $151.065748; 57 v 65 resolved | identical (all 8 shards, R5_CONTAM + shimExcluded applied) | ✓ exact |
| 2 | Per-row `idealCostUsd` from `last_token_usage` replay | 332/332 recomputed match < 5e-6 | ✓ exact |
| 3 | Both-solved 55 pairs: $32.092381 v $40.180308 | identical | ✓ exact |
| 4 | Offender deltas (networknt +0.475067, kiota-4174 +2.789062) | identical | ✓ exact |
| 5 | Route trailer mass 158,104 chars | 159,138 chars / 171 `<<SS_ROUTE_META>>` lines (Δ0.7% = newline accounting) | ✓ |
| 6 | Manual-test reconstruction sweet $2.542345 / 42 calls | my docker+manual classes: $2.557940 / 42 calls | ✓ |
| 7 | Exact repeated search ≈ $0.014843, negligible | 4 whitespace-loose dupes, $0.056883 — still negligible | ✓ |
| 8 | Blanket 6k pack cap unsafe | **independently supported** — see rank-utilization below | ✓ strengthened |
| 9 | Harness-inspection pool $2.59 sweet / $3.50 native | $1.87–2.6 depending on classifier boundary (cmd-string vs file-target) | ✓ magnitude |

New supporting evidence for its cap rejection (#8): parsing every sweet result pack
(220 packs, 2,652 ranked blocks, 1.33 MB of bodies) and tracking which ranked file each later
`ss-read`/`--in`/`apply_patch` touched: ranks 1–3 are used 117/116/108 times, but **ranks ≥11
are still used 330 times**, and the never-used rank-≥4 bodies total only 0.196 MB. Pack tails
earn their bytes; cutting them buys pennies and risks evidence. The doc was right to reject.

---

## Blind spot 1 — poll-turn economics (the largest unranked pool in the dataset)

Codex `exec_command` returns after `yield_time_ms`; if the process is still running the model
gets a ~114-byte "Process running with session ID N" stub and must issue `write_stdin` polls.
**Every poll is a full model turn that re-sends the entire resident context** (at the cache
rate) and bills fresh output tokens, usually to learn "still running."

Measured over all 332 rollouts (poll-only turns; marginal = resent×$0.5/M + output×$30/M,
i.e. the part that vanishes if the command returns synchronously — the stdout itself arrives
either way):

| origin of the wait | native polls / marginal $ | sweet polls / marginal $ |
|---|---|---|
| run_tests (suite genuinely slow) | 440 / **$13.262603** | 399 / **$7.852951** |
| ss-grep (tool latency, see blind spot 2) | — | 302 / **$3.144061** |
| ss-find (same) | — | 58 / **$0.800952** |
| everything else | 8 / $0.290056 | 3 / $0.058187 |
| **poll-only turn total** | 443 turns / $13.552659 | 588 turns / $11.856152 |

That is **9.0% of native spend and 8.9% of sweet spend** — burned on turns whose payload is a
heartbeat. The doc's apportionment silently spread this over other categories.

Two facts from the traces bound the fix:

- The model overwhelmingly polls with `yield_time_ms=30000` (1,109 of 1,372 polls), yet 60s and
  120s polls appear (63× and 60×) and work — so ≥120s waits are legal at the `write_stdin`
  layer. No `exec_command` above 30s was observed (whether that's a schema cap needs a check).
- Poll cost scales with resident context: late-run run_tests polls on 60k-token contexts cost
  ~$0.03 each for zero information.

**Lever B1 (harness/prompt, both arms): max-yield wait etiquette.** One appendix/frame line —
"when the only pending work is `run_tests`, wait with the maximum `yield_time_ms` (≥120000)
rather than short polls." At 120s vs 30s polls, ~¾ of run_tests polls collapse; modeled recovery
≈ $9.9 native + $5.9 sweet per 200. Zero information change (identical stdout, delivered in
fewer turns). It is arm-symmetric: it cuts absolute cost, leaves the sweet-vs-native delta
roughly untouched, and it makes the *native* arm cheaper by more (be unsurprised when the
both-solved −20.13% narrows a bit — that's honesty, not regression).

## Blind spot 2 — ss-grep/ss-find are ~7 s per call on the box (eval-wrapper parity gap)

Wall-time printed in every tool output, aggregated over completed sweet calls:

| tool | p50 | p90 | % exceeding the 10s yield ("running" stub) |
|---|---:|---:|---:|
| ss-search | 0.26 s | 1.07 s | 1.2% |
| ss-read | ~0 s | 0.06 s | 0% |
| ss-trace | 0.06 s | 0.45 s | 0% |
| **ss-grep** | **7.36 s** | 9.26 s | **48.9%** (342/700) |
| **ss-find** | **7.41 s** | 8.94 s | **54.1%** |
| ss-semantic | 5.66 s | 9.75 s | 16.7% |

The floor is flat across `-k` (43–57% running in every k bucket), flat with/without `--in`
(9.12 s vs 9.18 s avg), and flat first-call-vs-later (44% vs 50%) → a **fixed per-invocation
overhead**, not query cost or cold-start. Root cause is visible in
`eval/agent-read-workflows/bin/_ss-helpers.mjs`: `cmdAgentSearch` (ss-search) proxies to the
warm daemon via `queryServer` (hence 0.26 s), while `cmdGrep`/`cmdFind`/`cmdSemantic` import
core modules and compute **in-process** — paying node boot + index open + CPU ORT INT8
late-interaction model load *on every call* on the GPU-less CCX33. Production dispatches
grep/find through native+daemon (`ss-dispatch` memory), so **the bench sweet arm pays a
~7 s/call tax production users don't have**.

What it costs in this dataset: $3.945013 of pure poll-turn marginal (table above), plus the
un-modelable but visible workflow fragmentation — e.g. `dart-lang__dartdoc-3393` (42 polls) runs
three pending greps at once, interleaving polls with new searches for 12 turns. Slow evidence
also delays every downstream decision inside the run's wall-clock budget.

**Lever A1 (eval env, sweet-only, zero resolution risk): route eval ss-grep/ss-find(/semantic)
through the same daemon the eval ss-search already uses** (or keep one resident helper process
per run). Identical ranked output, served warm. Recovery ≥ $3.9/200 sweet plus fragmentation
effects. **This is also bench fairness: it must land before the pre-registered held-out paper
run, same class as the cargo-parser fix — the current setup understates sweet's efficiency.**
Interim one-liner while A1 bakes: teach the agent `yield_time_ms=30000` on ss-* calls (95%+
would then complete in-call), though this only hides the latency, not the wall-clock.

---

## New pools the doc missed (all measured, ranked, with overlap notes)

| # | pool | size (this dataset) | lever | overlap notes |
|---:|---|---:|---|---|
| 1 | run_tests poll turns | $13.26 native + $7.85 sweet marginal | B1 max-yield etiquette | none |
| 2 | ss-grep/find/semantic latency polls | $3.95 sweet | A1 daemon dispatch | subsumes part of #1's sweet residue |
| 3 | BRE-dialect miss-fits, cost side | $4.196848 direct + $0.917356 reformulation (85 rollouts, 175 calls, **113 zero-result**) | S1 dialect bridge (already planned from the review; **not yet implemented** — verified absent from `_ss-helpers.mjs`/`native_grep.rs`) | S1 was justified on resolution; this adds ~$5.1 cost justification. Not every BRE-ism is wrong (escaped literals are legal Rust-regex), but 65% return zero |
| 4 | Turn-batching gap | sweet 1.57 non-poll calls/turn vs native 1.84; conservative mergeable slice (consecutive single-`ss-read` turns): 69 turns, $2.483884 marginal | C2 appendix line: "batch independent ss-reads of already-named targets into one turn" | must NOT become spray-search; scope to reads. A/B-gate like ANTI_THRASH |
| 5 | Whole-run redundant re-delivery — reads | 229 `ss-read`s of spans already fully shown, 631 KB bodies, $1.867872 amplified | **already shipped**: exact-reread omission (span ledger, default-ON) | this is the whole-run superset of the doc's 3-turn/$0.75 floor — the shipped lever's addressable pool is ~2.5× the doc's estimate. Content-hash logic already handles the revision caveat |
| 6 | Whole-run redundant re-delivery — packs | 821 pack blocks re-showing fully-shown spans, 272 KB, $0.965886 amplified | C1: agent-format pack-side elision (`#3 file:span — shown above; --force`) | NOT covered by read-omission; extends shipped span-ledger machinery; require recent-window/content-hash so compaction can't orphan the reference |
| 7 | run_tests repeat text | consecutive runs ≥80% line-identical: $0.923351 sweet + $0.939461 native amplified (~30%/25% of run_tests output mass) | B2: run_tests shim delta-mode (full output first run; then failure-signature diff + "N unchanged lines suppressed") | complementary to L2 baseline-diff (clean-tree diff vs run-over-run diff); authority untouched |
| 8 | ss-read ENOENT retries | 7 calls (hallucinated/mis-rooted paths) | optional: "nearest indexed path" suggestion line | negligible $; tiny resolution upside |

Amplified = bytes/4 tokens × ($5/M once + $0.5/M × remaining turns of that run) — same
replay convention as the doc's output-amplification estimates.

## Negative findings (checked, not worth pursuing)

- **Codex exec preamble** ("Chunk ID / Wall time / exited / Original token count"): ~450 KB per
  arm resident — codex's serialization, not ours.
- **Reasoning-item residency**: ~440k reasoning tokens per arm ride the context as encrypted
  items — API/model level, symmetric, not actionable.
- **Rank-tail trimming / pack caps**: rejected with utilization data (see verification #8).
- **Trace tails**: only 0.27 MB beyond 8 KB across all 62 sweet traces; tails are used; keep the
  doc's lossless-continuation idea deferred.
- **ss usage errors**: $0.70 total (incl. 27 flagged reads of which only 7 are true errors);
  arg-parse failures 2 sweet / 6 native. Noise.
- **Sweet guide residency**: the sweet task prompt is ~+5 KB vs native (the M+++++ guide),
  ≈ $3.1/dataset in residency. That is the product's price of guidance — GEPA-governed;
  do not trim for cost without a full resolution A/B. Every +1 KB of guide ≈ +$0.6/200 runs.
- **Output-token share**: 33.2% of sweet spend is output (30.3% native) — shape is symmetric;
  no arm-specific lever. Resent prefix is 40% of both arms' spend; newIn 27–30%. Everything
  that shrinks resident context compounds (and delays the 43–53 observed compactions).

## What's already shipped vs still open (so nothing is double-proposed)

| doc/review item | status |
|---|---|
| P1 validation boundary → L2 run_tests self-authority + baseline-diff | shipped gated (5d84770) |
| P2 anti-thrash appendix promotion | **default-ON** in harness (`SS_NO_ANTITHRASH` opt-out) |
| P3 shown-span trailer | shipped default-ON (db04595) + exact-reread omission (working tree, default-ON) |
| P4 route-trailer compaction | shipped (9cf6223) — the $0.51/159 KB pool |
| P5 finish-after-success rule | **still open** ($0.60–1.26, overlaps L2) |
| L4a default read window | parked default-OFF (opt-in `SS_READ_WINDOW`), correctly — pool too small at n=2 |
| Review S1 BRE dialect bridge | **still open** — now carries ~$5.1 cost + resolution justification |

## Recommended order (cost lane, resolution-safe)

1. **A1 eval daemon dispatch for grep/find/semantic** — engine/env, sweet-only, zero risk,
   ≥$3.9 + fairness; prerequisite for the paper run.
2. **S1 BRE dialect bridge** — already planned; ~$5.1 cost + the review's resolution case.
   Agent-format-gated per repo policy.
3. **B1 max-yield wait etiquette** — one gated line, ~$16/200 across arms; expect the
   native arm to gain more (honest).
4. **B2 run_tests delta-mode** — ~$1.9/200 both arms + legibility; ride the L2 smoke.
5. **C1 pack-side shown-span elision** ($0.97 ceiling) and **C2 read-batching line**
   ($2.48 ceiling) — small; batch into the next appendix A/B round, don't spend a bench
   cycle each.
6. P5 finish rule — as the doc specified, still worth its small pool.

Realistic new-money total if 1–4 land: **~$11–13 sweet / ~$10–11 native per 200 tasks**
(≈9% and ≈7% of arm spend), additive to the doc's shipped proposals, with zero evidence
removed from any run. Items 5–6 add ~$2–3 more (ceilings sum to ~$4.4).

## Smoke additions (extends the doc's 10-task list)

Add: `dart-lang__dartdoc-3393` (42 polls — poll-lever canary), `apache__dubbo-go-hessian2-229`
(7 zero-greps, 8 BRE calls), `analysis-dev__diktat-1206` (6 BRE), `salsita__node-pg-migrate-622`
(4 BRE). Keep the review's rules: both sweet-only wins (`sdk-platform-java-2358`,
`marginalia-183`) as canaries in every smoke; 2/2 repeats for any claimed flip; zero
resolved→failed flips; and per-lever observables — ss-grep running-rate <2% (A1), poll-only
turns per run ↓ (B1), zero-result BRE calls carry the dialect note (S1).

Suggested standing telemetry (cheap, in rows.json via the ideal-cost pipeline):
`pollOnlyTurns`, `pollMarginalUsd`, `ssRunningRate`, `zeroResultSS` — turns this report's two
blind spots into per-run ledger columns so the next forensics doesn't need a re-parse.

## Method appendix

Parsed each rollout into turns (delimited by `token_count.last_token_usage`) and calls
(`function_call`/`custom_tool_call` matched to outputs by `call_id`; `write_stdin` polls chained
to their originating command via "Process running with session ID N"). Turn cost
`(5·newIn + 0.5·resent + 30·out)/1M` reproduced every row's `idealCostUsd` (332/332 < 5e-6);
class attribution follows the doc (turn cost ÷ calls in the issuing turn); poll marginal counts
only resent+output of poll-only turns. Span accounting: merged line-intervals per file fed by
pack block headers (`## #N file:a-b`), grep match lines, and ss-read ranges; "fully shown" =
≥99.9% covered by the union of earlier deliveries in the same run. Scripts (extract + analyze1–6)
live in the session scratchpad (`full200/`); the trace tarball is reproducible from the box via
the rows.json `rolloutFile` pointers.
