## Verdict

  NO-GO on claiming that Sweet reduces cost at fixed accuracy. It lowers aggregate spend, but it solved 15/36 versus native’s 19/36. Once failed attempts are included, Sweet costs 8.6%
  more per success ideally and 12.0% more per success on realized spend.

  The best immediate experiment is a solve-neutral harness change: return authoritative test results without requiring a second model turn to poll them. The best larger program remains
  verified checkpointing plus phase-aware context eviction. The teleport completeness idea merits a bounded $0 replay, not a production build.

  ### Cost-accounting correction

  The handoff currently mixes three cost definitions:

   Measure                               Native        Sweet    Sweet delta
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━  ━━━━━━━━━━━  ━━━━━━━━━━━━━
   Ideal total                        $0.352190    $0.301990        −14.25%
  ─────────────────────────────────  ───────────  ───────────  ─────────────
   Realized total                     $0.370594    $0.327695        −11.58%
  ─────────────────────────────────  ───────────  ───────────  ─────────────
   Conditional realized “CPS”         $0.008538    $0.007840         −8.18%
  ─────────────────────────────────  ───────────  ───────────  ─────────────
   Inclusive ideal cost/success       $0.018536    $0.020133         +8.61%
  ─────────────────────────────────  ───────────  ───────────  ─────────────
   Inclusive realized cost/success    $0.019505    $0.021846        +12.00%

  The reported 11.6% reduction is the realized, not ideal, delta. The adjacent report labels $0.371/$0.328 as ideal even though those are realized totals. Also, the harness computes CPS
  from successful-rollout spend only, explicitly excluding failed-rollout cost (eval/task-completion-bench/harness/run-pilot.mjs:647). That metric describes successful-trajectory
  efficiency, not the economic cost of obtaining a success.

  Among the 14 same-task/rep pairs where both arms solved, Sweet was only 6.1% cheaper in aggregate and cheaper in exactly 7/14 pairs. Among 16 both-failed pairs, it was 20.4% cheaper.
  Thus, much of the headline saving is failure-tail diet, not established fixed-resolution efficiency.

  ## Spend decomposition

  The following are exact to the row-level rounding in eval/task-completion-bench/handoffs/luna-rotate18/rollups.json:1:

  - Failed rollouts consumed $0.392577, 60.0% of ideal spend, plus 59.7% of recorded calls and 62.2% of input tokens.
  - Dart, mransan, and litestar alone consumed 45.7% of failed spend; the five costliest failed tasks consumed 65.6%.
  - Relative to each arm’s average successful-rollout cost, failed trajectories contain a descriptive $0.10395 premium—15.9% of all spend. That is not a causal avoidable-waste estimate
    because task difficulty is confounded.

  Ideal cost components:

   Component                   Tokens         Cost    Share
  ━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━  ━━━━━━━━━━━  ━━━━━━━
   Newly added input           2.934M    $0.293383    44.9%
  ─────────────────────────  ─────────  ───────────  ───────
   Resident-prefix re-send    21.877M    $0.218773    33.4%
  ─────────────────────────  ─────────  ───────────  ───────
   Output                      0.237M    $0.142024    21.7%

  Re-sent context is 88.2% of logical input volume, but it does not dominate total dollars across all 72 runs because Luna’s cache-read price is only $0.01/M. It does dominate specific
  long tails.

  Redundant retrieval is not identifiable exactly from rollups:

  - 167/243 Sweet ss-* calls, 68.7%, occurred in failed runs—but failed-task retrieval is not automatically redundant.
  - Sweet failures averaged 7.95 ss-* calls versus 5.07 for successes.
  - The strongest ex-post example is mransan Sweet r1: 24 ss-*, 27 recorded calls, $0.017446, versus r0’s 5, 9, and $0.006449; both failed. The extra tour cost $0.010997, but this is
    separate-rep evidence, not a treatment effect.

  Recorded calls are also not true model turns: they omit patch/control/poll requests. The four condensed trajectories contain 74 model requests but only 52 recorded calls. Eleven requests
  —14.9%—merely poll detached run_tests sessions. At cached-input rates, eliminating those polls would directly save at least $0.004542, 8.2% of the four traces’ ideal cost, before
  counting downstream context shrink.

  ## Dart context explosion

  eval/task-completion-bench/handoffs/luna-rotate18/trajectories.txt:72 made 30 model requests:

  - broad repository/file reads before editing;
  - eight patch attempts, including two patch-application failures;
  - five post-edit test cycles;
  - six model requests whose only purpose was waiting for test output.

  The per-request prompt grew from roughly 13K to 65.6K tokens. Its $0.027504 ideal cost decomposes into approximately:

  - resident re-send: $0.013409 — 48.8%;
  - newly added input: $0.008606 — 31.3%;
  - output: $0.005488 — 20.0%.

  A replayed phase-boundary cap after the first authoritative post-edit result gives these ceilings:

   Resident cap    Input avoided    Share of total input    Cached-rate floor
  ━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━
   40K                   309,941                   21.7%     $0.00310 / 11.3%
  ──────────────  ───────────────  ──────────────────────  ───────────────────
   32K                   453,941                   31.8%     $0.00454 / 16.5%
  ──────────────  ───────────────  ──────────────────────  ───────────────────
   24K                   597,941                   41.9%     $0.00598 / 21.7%

  These overlap with poll savings and are not solve-safe estimates: they assume evicted information was no longer needed.

  The principled policy is therefore phase-aware, not blind truncation:

  - retain the issue, repository instructions, current diff, edited-symbol contract, and latest authoritative test result;
  - retain the latest 3–4 relevant tool results;
  - replace older search/read/test bodies with deterministic path:range:hash placeholders that can be refetched;
  - checkpoint mechanically at edit/test boundaries;
  - never make a lossy generated summary the sole copy of current code or diagnostics.

  Official Anthropic context-engineering guidance exposes this exact distinction between clearing refetchable tool results and lossy compaction (context-engineering cookbook
  (https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools)). Research also supports adaptive compression, but transfer evidence varies: ACON
  (https://arxiv.org/abs/2510.00615) reports 26–54% peak-token reductions largely outside code repair, while Focus (https://arxiv.org/abs/2601.07190) reports 22.7% fewer tokens with
  unchanged 3/5 accuracy on only five SWE-bench Lite tasks.

  KV-cache pruning is not a Sweet product lever on hosted Luna: it reduces provider memory/computation, not logical API input or billing. The latest work also finds that immediate
  compaction can hurt more than delayed, phase-aware compaction (Practical Online KV Cache Compaction (https://arxiv.org/abs/2608.00902)).

  Eviction does appear to unlock fusion economically. Repricing the existing W0 distribution at Luna rates:

  - expected top-3 turn benefit: about $0.000361;
  - persistent mean 1,348-token payload over 32 remaining turns: $0.000566, net −$0.000205;
  - evicted-after-consumption payload: $0.000135, net +$0.000227.

  That is a sensitivity analysis using the prior 551-pair distribution, not a Luna measurement. It supports span-capped fusion plus eviction, never standalone fusion.

  ## Ranked experiment portfolio

  Ranked by expected value subject to no solve loss.

  1. Auto-await authoritative tests — GO for $0 census

     Mechanism: run_tests waits internally and returns its final authoritative result in one tool interaction, with a bounded timeout/fallback. No evidence or test execution is removed.

     Evidence: 11/74 curated model requests were pure polls; direct lower-bound savings were 8.3% on teleport Sweet, 11.4% on dart native, and 5.7% on mransan Sweet. Research confirms test
     execution is a major, uneven agent resource, although disabling tests is not safe (To Run or Not to Run (https://arxiv.org/abs/2606.26978)).

     Expected effect: lower turns and input cost; solve-neutral by construction if returned output is byte-identical.

     First experiment: census all 72 raw traces for detached test→poll pairs, then mechanically replay cost with identical results. If material, smoke dart plus teleport, with redboltz as
     a solved control.

  2. Verified checkpoint-on-green — continue the existing W2 plan

     Mechanism: retain every candidate patch and freeze patches validated by the canonical full suite; grade/submit the best verified state if later edits regress.

     Evidence: failures dominate spend, and generation can destroy valid intermediate states. Coherence Collapse (https://arxiv.org/abs/2603.24631) found that many failing agents had
     already reached the correct functions and recovered all five observed exact-gold intermediate patches through checkpointing.

     Expected effect: protects or raises solves first; cost is initially neutral/slightly higher. Only after selector safety is proven may it support tail termination.

     First experiment: execute the already specified $0 replay in eval/task-completion-bench/EDIT_THRASHING.md:198. Keep the existing hard gate: zero observed grader regressions and at
     least 59 independent trigger exposures before automatic restore.

  3. Phase-aware tool-result eviction, then span-capped fusion

     Mechanism: deterministic stale-body eviction at edit/test boundaries, refetchable placeholders, current-state retention, and immediate eviction of consumed fused spans.

     Evidence: re-send is 33.4% of all ideal spend and 48.8% of dart r0. Internal fusion economics flips from negative to positive with eviction (eval/task-completion-bench/TURNFIX-PHASE0-
     REPLAY-RESULTS-2026-08-03.md:770).

     Expected effect: potentially 11–22% direct tail savings on dart-like traces; fusion can additionally collapse dependent search→read rounds. Solve risk is low for refetchable clearing
     but material for lossy summaries or aggressive caps.

     First experiment: $0 replay a 24/32/40/48K trigger grid on dart and mransan, with teleport, scoringutils, and redboltz controls. Measure required-information eviction and refetches,
     not only tokens. Any live test must be arm-symmetric and requires a new ledger sweep.

  4. Bounded repair-completeness card — research GO, product-build NO-GO

     Mechanism: after an edit target is identified, return a 200–400 token card containing its declaration/type, distinct usage shapes, co-occurring predicates, callers/tests, and stable
     line references. Use AST/type/import/call information where reliable and lexical fallback otherwise. Evict after editing.

     This gives teleport the semantic fact “files are keyed by (name, fileType)” without repeating fileType 39 times. Whole-file flooding and “all call-sites everywhere” should not be
     defaults.

     Evidence: teleport is one task but replicated 2/2 and accounts for half the four-rollout deficit. Its in-sample ceiling is therefore +2/36 Sweet rollouts—not an expected general gain.
     Contemporary repair research finds that more context is not uniformly better and that precise file/element context can outperform indiscriminate line expansion (file-level context
     study (https://arxiv.org/abs/2604.05481)); SWE-Explore (https://arxiv.org/abs/2606.07297) separates localization, relevant-line coverage, and context efficiency; LocAgent
     (https://arxiv.org/abs/2503.09089) shows how typed repository edges can surface repair-relevant relationships.

     Expected effect: possible solve recovery at under roughly $0.00008 for a 400-token card retained ten turns; negligible cost if evicted promptly.

     First experiment: $0 teleport replay with contract-operand recall as the hard gate, underscore/gradethis as negative controls, and statamic/redboltz as solved controls. Do not build
     unless it generalizes to fresh DEV tasks within the token budget.

  5. Retrieval novelty accounting and lossless deduplication

     Mechanism: record new unique files, symbols, edges, diagnostics, and test evidence per retrieval; return stable handles/deltas for exact or near-duplicate requests. Initially do not
     force termination.

     Evidence: mransan r1 is a strong thrash candidate, while aggregate failed-call counts remain difficulty-confounded. Efficient Early Termination (https://arxiv.org/abs/2601.05777)
     reports large savings from task-conditioned termination, but that does not override the local nulls for prose advisories or justify a generic cap.

     Expected effect: modest payload savings with near-zero solve risk in dedupe-only mode. Forced stop remains NO-GO until checkpoint safety is established.

     First experiment: reconstruct novelty curves for all available trajectories; use mransan as the positive site and statamic/oceanparcels as controls.

  6. Conditional candidate generation and deterministic selection

     Mechanism: only after a failed canonical check or genuine semantic ambiguity, generate two bounded patches from the same frozen evidence pack, then select using syntax/type checks and
     canonical tests.

     Evidence: underscore and gradethis look like generation variance, not missing retrieval. Multi-candidate repair and selection can improve resolution, as demonstrated by CodeMonkeys
     (https://arxiv.org/abs/2501.14723), but it is compute-heavy and not inherently a cost reduction.

     Expected effect: potentially higher solves, definitely higher immediate generation/test cost. Broad self-consistency is therefore NO-GO.

     First experiment: offline retained-patch analysis first; only then a two-candidate DEV micro-smoke with explicit user approval.

  ## Explicit non-recommendations

  - No more prose turn-packing, M± formatting, or mid-task advisories.
  - No standalone fusion.
  - No global hard turn/retrieval cap and no disabling canonical tests.
  - No default whole-file or all-call-site flooding.
  - No hosted-Luna KV-cache pruning claim.
  - No broad self-consistency until cheaper structural gates fail.
  - No paid run until a $0 replay passes, the ledger is green, and you explicitly approve it.

  I made no files, edits, benchmark runs, commits, or external spend. The pre-existing dirty worktree remains untouched; git diff --check passes.