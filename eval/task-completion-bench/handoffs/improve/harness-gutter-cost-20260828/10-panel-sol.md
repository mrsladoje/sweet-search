# Adversarial verdict

**NO-GO for publication as written.** Five claims are upheld, thirteen need qualification, and two are materially false. The byte-level gutter work is strong; the causal attribution and cost accounting are not.

Evidence shorthand: [01 edit mechanisms](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/01-edit-mechanisms.md:17), [02 cost decomposition](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/02-cost-decomposition.md:181), [03 gutter cost](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/03-gutter-form-cost.md:98), [04-Codex](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/04-resolution-codex.md:226), [04-OpenCode](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/04-resolution-opencode.md:227), [04-Claude](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/04-resolution-claude-code.md:153), [06 mechanics](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/06-research-cost-mechanics.md:658), [07 levers](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/harness-gutter-cost-20260828/07-research-resolution-levers.md:388), [raw report](/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/handoffs/improve/FRESH-POOL-RESULTS.md:21).

## 1. Claim-by-claim

1. **WEAKENED** — [03 §2.1–2.3] supports `$0.000302/$0.000338/$0.000440`, but the understatement is **2.0–3.3×**, not 2.5–4×; [01 §3.6] also leaves 1.8–3.1% unnumbered, chiefly `ss-trace`.

2. **UPHELD** — [03 §2.1, §7] gives `+$0.000217 / +$0.000424 = 51%`, 72% of input-side growth, and `+0.93` tokens/line on all harnesses.

3. **WEAKENED** — The 8/61, 6/144, native 6/79 byte carries are real [01 §2.2–2.3], but `$0.0327` is explicitly the whole-episode **upper bound**; attributable spend is `$0.0126–$0.0327`, and the honest rollout comparison is only 6/9 versus 3/9, `p=0.35` [01 §2.5].

4. **UPHELD** — [01 §4] confirms whitespace-trimming seek, zero whitespace failures, and 7,796 residue-free anchor lines; the OpenCode `p=0.028` contrast reproduces, though it is not evidence of a TAB mechanism.

5. **UPHELD** — The retained read-gate census shows 218/259 TAB edits without native `Read`, 205 after only `ss-read`, and zero gate errors in 1,044 edit/write calls; successful calls directly falsify a binding precondition.

6. **WEAKENED** — The cap counts and replay reproduce, but [02 §3.1] calls `+11.5%` a trajectory-fixed **upper bound that overstates the effect**; it proves sufficiency, not that the flip “is” solely a harness-version effect.

7. **WEAKENED** — Current OpenCode economics are request-driven, and 1.546 versus 1.106 calls/request is measured; “the harder pool caused it” remains a cross-epoch, changed-treatment attribution, while the 25.2% census includes all multi-tool steps, not only 2–4 `read/grep/glob` calls.

8. **WEAKENED** — [02 §9.1] validates graded-transcript `−8.8%`, published `−3.9%`, and recorded rerun-inclusive `+1.9%`; however the degen table sums to **12 flagged rows** (5+4+2+1), not 13, and every inclusive convention is a lower bound because sidechain usage is missing [02 §9.2].

9. **WEAKENED** — `−$0.001619` is the recorded sidechain-cost difference, but “suppression” is unproven mediation; the 18-task nondelegating subset is selected on a post-treatment outcome, exactly the caveat in [03 §10].

10. **WEAKENED** — The 1,457-token wire delta is exact, but the dollar triplet is not literal guide cost: applying [06 §7.5]’s `T−1` formula gives about **`$0.000417/$0.000418/$0.000506–0.000511`**. Claude also carries a 1,570–1,577-token wrapper, and its guide is smaller than the inclusive `−$0.001847` graded-transcript gap.

11. **REFUTED** — The scripts price the **entire next request**, not incremental error bytes or a causally extra request; that work may happen anyway and can be charged repeatedly after parallel failures. Accepting new CLI shapes, literal fallback, and changing absence signals are also plainly not “zero behavioural risk.”

12. **WEAKENED** — The economic conclusion is right, but token counts are a four-characters-per-token proxy, and the census found **one standalone Claude request**, costing `$0.000008`/rollout—not “never” [state-summary log, draft Appendix].

13. **WEAKENED** — The OpenCode statement is sound: fewer calls but 21% more main requests. The Claude comparison mixes call counts including subagents with main-thread request counts, so “13–28% fewer calls does not pay” is not a valid cross-harness conclusion.

14. **WEAKENED** — The code-path asymmetry is real, and OpenCode’s omitted surcharge is measured. Codex’s shortfall is only inferred as “up to about 7%” [06 §2.3], and arm-uniformity was not measured; the 1.62×/1.71× ratios describe recorded columns, not confirmed provider bills.

15. **WEAKENED** — The `.jam`/`build` defect and the only demonstrated retrieval-attributable loss are upheld. Native’s observed +1/66 is **not a ceiling** on a repaired Sweet system; even [04-Codex L1] says +1 to +2, and indexing changes can affect other rankings.

16. **WEAKENED** — Both leave-one-task-out sign changes are correct [02 §5], but the Codex count is wrong: [04-Codex §2.4] reports **50 b2-113 + 35 b2-259 = 85/131** zero-match calls, not 50/131 for both tasks.

17. **UPHELD** — [02 H2] shows calls doubled, bytes/read fell because of the cap, and total payload rose 9%; this invalidates the fresh report’s Codex rationale, though not adaptive line selection on other harnesses.

18. **UPHELD** — [01 §1.2, §2.5] and [04-Claude §5.3] reproduce the full-cell reversal and flat 18/19/15/16 rollout counts; the six-task anchor result should be withdrawn.

19. **REFUTED** — `$11.76` mixes bases: it uses attempted/deleted OpenCode spend but only the `$5.25` canonical Claude reconstruction. [02 §9.1]’s rerun-inclusive Claude figures sum to **`$5.4735`**; combining the draft’s own `$3.28+$3.23` gives at least **`$11.98`**, still excluding unpriced sidechain requests and missing cache-write charges. The raw 12-cell table does sum to `$10.88`, so `$6.9` is false.

20. **WEAKENED** — No total form comparison is resolved at 22 tasks, but direct delimiter cost is already detectable at `$0` by transcript retokenisation. The `$0.0003–0.0004` range describes direct gutter terms, not observed form gaps, and current [03] lifecycle arithmetic needs about **5,300**, not 6,403, Codex lines for 15%.

## 2. Three consequential corrections

1. **Do not publish “wasted-call savings.”** Correct statement: “0.44/0.47/0.67 TAB calls per rollout matched predefined error/contradiction classes; the following requests total `$0.000294/$0.000204/$0.000370`, an association and loose upper envelope—not removable spend.” Retokenise only error payloads for a deterministic lower bound; measure extra requests through command-level replay.

2. **Use coherent cost bases.** Direct guide cost is roughly `$0.000417/$0.000418/$0.00051`, not the Shapley-attribution values. Canonical graded-cell spend is `$10.88`; reconstructable attempted spend is already at least `$11.98` at registered rates and remains incomplete. “Actual spend” is unavailable until missing sidechains and cache writes are closed.

3. **Replace causal declarations with bounds.** The Codex cap is sufficient to explain the flip, not identified as its sole cause; Claude’s advantage is numerically dominated by recorded sidechain spend, not proven delegation suppression; native’s b2 success is an observed comparator, not a repaired-Sweet ceiling.

## 3. Missed or underweighted levers

- **Index-selected regression tests was omitted entirely**, despite being [07 L1], its top resolution-per-dollar candidate. Mechanism: map touched/retrieved symbols to a small existing test subset. Cheapest falsifier: count retained `run_tests` calls where a symbol-scoped subset existed and whether full-suite timeout/noise preceded failure; kill below one exposed call per rollout.

- **Working-tree freshness was dropped from the synthesis.** [04-Codex L3] finds four clean rollouts where index-backed `ss-grep` could not see an agent-added symbol although `ss-read` could. Cheapest falsifier: census post-edit greps for newly added symbols; if exposure is material, overlay disk grep or explicitly report “snapshot index.”

- **OpenCode parallel delivery should precede the guide run.** Its upper bound is ~20%, versus 3–4% for guide shrink, yet the draft leaves its `$0` independent-call census unfinished. Group consecutive calls only when paths and arguments are independent, replay them through `ss-batch`, and kill below 1.5 packable calls/rollout.

## 4. Does the next run answer the stated objective?

**No.** It answers only: “Does a ~200-token guide avoid losing six of 66 rollouts on these already-forensically-inspected tasks?” A five-rollout loss—7.6 percentage points—would pass while easily worsening inclusive cost per success. The effective inferential unit is 22 tasks, not 66 independent rollouts.

I would change it as follows:

- Finish the `$0` packing, test-selection, working-tree, and direct-error-byte falsifiers first.
- Use a new stratified, fixed-seed task pool; the current 22 are DEV-retired and cannot support held-out claims.
- Prefer more distinct tasks and fewer repetitions, with power computed at the task-cluster level.
- Rerun native contemporaneously; do not pool an old stochastic arm.
- Pre-register a joint frontier: solve non-inferiority with a justified margin, raw attempted spend, aggregate cost, successful-only cost, and inclusive cost per success.
- Record authoritative cache-write and complete sidechain usage; publish raw rerun-inclusive spend as headline and graded-transcript cost as a secondary view.
- Treat failures on “solved-everywhere” controls as evidence to diagnose blind, not an automatic licence to void the treatment.

Until those changes, the recommended run can evaluate guide shrink on DEV, but it cannot answer “maximise resolution at minimum cost.”

