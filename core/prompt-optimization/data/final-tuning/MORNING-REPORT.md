# FINAL TUNING — morning report (DRAFT, updated during the run)

> Draft written 2026-10-01 03:35 while r3 is indexing. Sections marked *(pending)* are filled in when
> the runs finish. Branch `final-tuning`; nothing is released, tagged or merged.

## 1. Verdict

**One champion, for Claude Code: `SS_VARIANT_CC_RULES_IN_PROMPT`** — the sweet rules move from the
`.claude/rules/sweet-search.md` file (which Claude Code injects into the first user message, after
the cache marker) into the lean-harness agent file (the cached system prompt). It cuts the Claude
Code bill by 10–16% with no accuracy or call change. For Codex and opencode no product change
passed; their r282 cost gaps are explained by measurement (bench artifact, provider cache drift).

| Cell | r282 sweet vs native | Cause found | Champion vs 2.8.2 sweet | Expected champion vs native |
|---|---|---|---|---|
| Opus / Claude Code | +22.4% | rules re-written to cache each session (60%), larger tool results (43%) | **−15.8% train, −11.6% validation** (CI < 0), accuracy = | ≈ +6..+8% *(r3 pending)* |
| Sonnet / Claude Code | −0.7% | same, offset by the lean prompt (27k → 7k chars) | **−9.6..−12.7%** (A-B-A, CI < 0), accuracy = | ≈ −10% |
| Codex / Sol | −10.5% | not stable: identical runs differ by 24.5% (provider cache drift) | no change (V2 hurt accuracy) | ≈ 0 (± drift) |
| opencode / Sol | +6.8% (ns) | bench artifact: random rules path broke the prompt cache | no change | *(pending: interleaved re-check)* |
| opencode / DeepSeek | +54.6% | same bench artifact | no change | +7.9% (ns) with the bench fix |

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

| Variant | Hypothesis / mechanism | Train | Validation | Decision |
|---|---|---|---|---|
| V1 `SS_VARIANT_CC_RULES_IN_PROMPT` | rules into the cached system prompt (Claude Code) | Opus −15.8% [−18.5, −13.1], cache write −22%, acc +0.2 pt; Sonnet A-B-A −9.6..−12.7% | Opus −11.6% [−15.5, −8.0], accOR −0.1 pt | **KEEP (champion)** |
| V2 `SS_VARIANT_PRUNE3` | drop ss-find / ss-semantic / ss-trace (owner hypothesis 2) | DeepSeek (sequential) −9.9..−17%; Codex interleaved −5.0% (ns), **accOR −1.9 pt (sig)** | — | **REJECT** |
| V3 `SS_VARIANT_SEARCH_DEDUPE` | no repeated ss-search entries/lines (owner hypothesis 1) | $0 replay: ss-search −9.1% chars → ≈ −1% cost (below MDE) | — | optional hygiene, not screened live |
| bench `SS_BENCH_STABLE_RULES_PATH` | opencode cache break | DeepSeek sweet vs native +7.9% (ns), was +54.6% | — | measurement fix |

Method notes: test-retest showed Codex cost drifts by up to 25% between identical runs 25 minutes
apart → Codex comparisons were redone **interleaved** (baseline and variant alternate per question in
one run). DeepSeek drifts ~8%; Opus is stable (fresh baseline reproduced r282 within 0.2 pt).

## 4. Task guard *(pending)*

## 5. r3 benchmark

- 6 fresh repos (jj Rust 271k LOC, dgraph Go 265k, tortoise-orm Python, typedoc TS, zipkin Java,
  ocelot C#), 216 drafts → 2-model verification → 2 Opus audits → **163 questions** (held-out 103,
  dev 60), frozen sha256 `ba49df55…`, pre-registered (`r3/r3-PREREG.md`).
- Headroom, grader consistency, 2.8.2 baseline *(pending)*.

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
