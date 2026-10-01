# FINAL TUNING — morning report (DRAFT, updated during the run)

> Draft updated 2026-10-01 08:20 while the held-out runs are in flight. Sections marked *(pending)* are filled in when
> the runs finish. Branch `final-tuning`; nothing is released, tagged or merged.

## 1. Verdict

**One champion, for Claude Code: V1b = `SS_VARIANT_CC_RULES_IN_PROMPT=2`.** The sweet rules move from
`.claude/rules/sweet-search.md` (which Claude Code injects into the first user message, after the
cache marker, so ~1.4k tokens are re-written to the cache in every session) into the lean-harness agent
file (the cached system prompt); a ~60-token pointer stays in the rules file so the first user message
still says "use the ss-* tools". It cuts the Claude Code bill by 8–13% with equal accuracy and equal
task solves. For Codex and opencode no product change passed (V2 tool pruning and V4 completeness
wording were rejected); their r282 gaps are measurement effects (bench rules-path artifact, provider
cache drift). **New finding: on the harder r3 questions, sweet on Codex is 5 points less accurate than
native** — open item.

| Cell | r282 sweet vs native | Cause found | Champion vs 2.8.2 sweet | Champion vs native |
|---|---|---|---|---|
| Opus / Claude Code | +22.4% | rules re-written each session (60%), larger tool results (43%) | **V1b: −12.6% train, −8.3% validation, −13.2% r3 dev** (CI < 0), accuracy = | r3 dev: +8.8% (was +25.4%) *(held-out pending)* |
| Sonnet / Claude Code | −0.7% | same, offset by the lean prompt (27k → 7k chars) | V1 −9.6..−12.7% (A-B-A); V1b *(held-out pending)* | *(pending)* |
| Codex / Sol | −10.5% | not stable: identical runs differ by 24.5% (provider cache drift) | none (2.8.2) | r3 dev: cost −9.4% (ns), **accuracy −4.9 pt (sig)** |
| opencode / Sol | +6.8% (ns) | random rules path broke the cache (bench) | none | +3.9% (ns) with the bench fix, interleaved |
| opencode / DeepSeek | +54.6% | same bench artifact | none | +7.9% (ns) with the bench fix |

## 2. Trace-analysis headlines

Full analysis: `../r282-TRACE-ANALYSIS.md`.
- **The fixed prompt is 44–73% of cost** in every cell; ss-search results are 7–13%, ss-read 4–10%.
  Cost is decided by caching, not by tool output.
- **opencode:** the bench wrote the rules into a random per-rollout temp folder; opencode prints the
  path into the system prompt → DeepSeek first-request cache hit 24% (native 86%). Product unaffected
  (stable path). Fixed in the runner (`SS_BENCH_STABLE_RULES_PATH`).
- **Claude Code:** rules reminder re-written each session; tool results 2.4× larger per call than
  native `grep`/`sed`; Claude Code writes 1h-TTL cache entries billed at **2×** (the bench used 1.25×,
  so r282 understates Claude Code cost: Opus +28%, Sonnet +5.4% at 2×).
- **"Useful content" drop in Claude Code** is a judging artifact of line-number gutters (gutter reads
  score 0.43–0.48 in both arms, plain reads 0.78–0.83).
- **Rank usage:** ss-search ranks 2–3 (previews) are used in 14–53% of calls; output already shaped
  (rank 1 full, 2–3 preview, 4+ one-line summaries).
- **Calls vs turns:** sweet cuts calls more than turns on Sol (−24% calls, −2.5% turns); cost follows turns.

## 3. Variants tried

| Variant | Hypothesis / mechanism | Train | Validation / guard | Decision |
|---|---|---|---|---|
| V1 `=1` rules in prompt | rules into the cached system prompt (Claude Code) | Opus −15.8%, Sonnet A-B-A −9.6..−12.7% | Opus val −11.6%; **task guard: ss-* share 0.53 → 0.32 (native fallbacks up)** | REJECT (guard) |
| **V1b `=2`** rules in prompt + 60-token pointer | V1, but keep a tool-choice reminder in the first message | Opus −12.6% [−15.9, −9.1], acc +0.6; r3 dev −13.2% | Opus val −8.3% [−12.6, −4.3], accOR +0.8; **guard: solves 9/20 vs 8/20, ss share 0.54 vs 0.53, cost −2..−7%** | **KEEP (champion, Claude Code)** |
| V2 `SS_VARIANT_PRUNE3` | drop ss-find / ss-semantic / ss-trace (owner hypothesis 2) | DeepSeek (seq.) −10..−17%; **Codex interleaved: cost −5% (ns), accOR −1.9 pt (sig)** | — | REJECT |
| V3 `SS_VARIANT_SEARCH_DEDUPE` | no repeated ss-search entries (owner hypothesis 1) | $0 replay: ss-search −9.1% chars ≈ −1% cost | — | optional hygiene |
| V4 rules-v4-complete | name every place before stopping (Codex r3 partial answers) | Codex r3 dev-train interleaved: acc −4.0 pt (ns), cost −0.4% | — | REJECT |
| bench `SS_BENCH_STABLE_RULES_PATH` | opencode cache break (measurement) | DeepSeek +7.9% (ns, was +54.6%); oc-Sol +3.9% (ns) | — | measurement fix |

Method notes: test-retest showed Codex cost drifts up to 25% between identical runs 25 min apart →
Codex comparisons were redone **interleaved** (arms alternate per question in one run). DeepSeek drifts
~8%; Opus is stable (fresh baseline reproduced r282 within 0.2 pt). Claude Code cannot interleave
(installed files) → A-B-A or fresh sequential baselines.

## 4. Task guard (Opus, 10 dev tasks × 2 reps, interleaved, green ledger)

| Arm | Solved | Ideal $ | Real $ | Calls | ss-* share of search/read | Request-1 cache write |
|---|---|---|---|---|---|---|
| 2.8.2 (run 1) | 8/20 | 4.357 | 4.179 | 167 | 0.53 | 10,993 |
| V1 | 8/20 | 4.079 | 3.690 | 142 | **0.32** | 8,948 |
| 2.8.2 (run 2) | 8/20 | 4.277 | 4.054 | 162 | 0.53 | 10,498 |
| **V1b** | **9/20** | 4.151 | 3.769 | 153 | **0.54** | 9,134 |

Cost effect here is below the micro-smoke MDE (15–28%); direction only.

## 4. Task guard *(pending)*

## 5. r3 benchmark

- 6 fresh repos (jj Rust 271k LOC, dgraph Go 265k, tortoise-orm Python, typedoc TS, zipkin Java,
  ocelot C#), 216 drafts → 2-model verification → 2 Opus audits → **163 questions** (held-out 103,
  dev 60), frozen sha256 `ba49df55…`, pre-registered (`r3/r3-PREREG.md`).
- Headroom (dev, 60): native Opus 95.2%, native Codex 93.8% → **near ceiling** (pre-registered target
  60–85%; ≥ 95% = too easy). Held-out questions not edited (pre-registration). Hard enough to expose the
  Codex sweet deficit (−4.9 pt) that r282 could not.
- Grader consistency: 49 dev rows re-judged, 0 verdict flips, mean |Δ| 0.015. Hand-read sample: partial
  scores = one gold file missing.
- r3 dev read-out with BH: `r3/RESULTS-DEV.md`.

## 6. Final held-out result *(pending)*

## 7. Spend

*(see STATE.md "Spend"; final numbers pending)*

## 8. Open owner decisions / next steps

- Ship V1 in the next release? It changes `sweet-search init` for Claude Code: the rules go into
  `.claude/agents/sweet-search.md`; no `.claude/rules/sweet-search.md` when the lean harness is active.
  Subagents: the general-purpose subagent never carried search advice; the main agent is told to pass
  the rules on (unchanged).
- Re-price Claude Code cost at the 2× (1h TTL) cache-write basis in future reports.
- Fix the task-bench / retrieval runners to use a stable opencode rules path everywhere.
- DeepSeek direct balance is empty (judges now route DeepSeek via OpenRouter, owner-authorized).
