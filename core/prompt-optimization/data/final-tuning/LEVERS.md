# Final tuning — lever candidates (Phase 2, 2026-10-01)

Source of every number: `../r282-TRACE-ANALYSIS.md` (ranked waste list) and the forensics notes in
`trace/`. MDE = pessimistic paired MDE at n = 78 from `noise-floor.md` (to be replaced by the
test-retest). One change per variant; every switch defaults OFF = byte-identical to 2.8.2 (checked by
diffing the generated artifacts / outputs with the switch off).

## V1 — `SS_VARIANT_CC_RULES_IN_PROMPT` (Claude Code only)

- **(a) Waste item:** #1 — the rules file (`.claude/rules/sweet-search.md`) arrives as a first-user-message
  reminder after the cache marker and is re-written on every rollout: Opus $0.0071/q = 11% of sweet cost
  (60% of the +22% gap); Sonnet ≈ $0.0038/q ≈ 9%.
- **Change:** the same rules text goes into the lean agent file (the system prompt), ahead of the
  per-repo memory section; no rules file is written. `scripts/install-claude-lean-harness.js`
  (`rulesInPrompt`), runner `installClaudeProduct`.
- **(b) Expected effect:** Opus −8..−12% cost; Sonnet −6..−9%. MDE (cost, n = 78): Opus 7–12%, Sonnet
  7–13% — borderline on cost alone, so the mechanism metric carries the screen.
- **(c) Mechanism metric:** request-0 cache-write tokens per warm rollout (−1.4k expected). Smoke
  (4 Zig questions, Opus, 2026-10-01 00:1x): warm rollouts wrote 5,856 / 4,881 tokens vs r282 8,164 /
  7,123 (−2.3k each), cost −22% per warm rollout.
- **(d) Risk:** the rules move from a user-turn reminder to the system prompt; adherence could change
  (more or fewer ss-* calls, native fallbacks). Watch ss-* share, calls, accuracy. Task risk: same text,
  so low; the rules still reach subagents? (the agent file is the MAIN session only — subagent files
  are unchanged and did not carry the rules before either, since rules files load for subagents too:
  **check** before a task guard).
- **(e) Not tried:** TRIED-LEVERS.md (d) — "cache-stable prefix not tested at mechanism level".
- **Product note:** only when the lean harness is active (the default install). If a user keeps
  their own main agent, the rules file must stay.

## V2 — `SS_VARIANT_PRUNE3` (Codex, opencode; Claude Code not wired)

- **(a) Waste items:** #3/#4 — owner hypothesis 2. ss-find + ss-semantic + ss-trace = 11–20% of ss-*
  calls on Sol, 5–8% of sweet cost (ss-find results are the largest per call: p90 2.6–4.8k tokens);
  their lines are ~600 chars of the rules (−150 tokens of prefix).
- **Change:** the three tools leave the rules (`variants/rules-prune3.md`, general wording, same
  structure) and PATH (a bin dir with only ss-search / ss-grep / ss-read).
- **(b) Expected effect:** cost −2..−5% (prefix −150 tokens; ss-find results replaced by smaller
  ss-grep/ss-read calls) — **below the cost MDE**; the screen reads the mechanism metric and is mainly
  a **safety answer** to the owner's question ("can these tools go without hurting accuracy or calls?").
- **(c) Mechanism metrics:** calls to the three tools → 0; ss-* result tokens per question; calls and
  turns must not rise (compensation check).
- **(d) Risk:** multi-hop and "where is X called" questions may need more ss-grep/ss-read calls.
- **(e) Not tried live:** TRIED-LEVERS.md (c) — only $0 estimates exist; c04 bundled a shipped lever.

## V3 — `SS_VARIANT_SEARCH_DEDUPE` (all harnesses; ss-search output)

- **(a) Waste item:** #5 — summary entries repeat their own header line (6–8% of ss-search chars) and
  often repeat a span or symbol listed above; ss-search results are 7–13% of cost.
- **Change:** in the ss-search printer (`_ss-helpers.mjs`), a summary entry whose span lies inside an
  earlier listed span, or that names the same file + symbol as an earlier entry, is dropped; a summary
  line that only restates its header is not printed. Rank numbers keep their original values.
  Example (gin, one query): 5,497 → 4,775 chars (−13%).
- **(b) Expected effect:** ss-search tokens −10..−15% → cost −1..−2% — **below the cost MDE**; mechanism
  metric only. Low risk; it answers owner hypothesis 1 ("metadata could shrink") with a behaviour test.
- **(c) Mechanism metric:** ss-search result chars per call; calls/turns unchanged.
- **(d) Risk:** very low (no information removed that is not shown above).
- **(e) Tried?** Partly: trailer diet / compact route trailer (no behaviour test); duplicate-entry
  removal is new.

## Dropped candidates

- **Rank-2/3 preview → pointers:** tried (pointer tail, no cost win); previews are used in 14–53% of
  calls; ss-search is only 7–13% of cost.
- **Flat budget cuts / lower top-K:** dead (2026-06 sweep: Opus compensates below 3k).
- **Batching / chaining guidance:** dead (+7..+60%).
- **Shorter rules text (same tools):** ~4–5% of cost at best in the Sol cells, and the rules are tuned
  (failed compressions ×3); V2 tests the tool-specific part with a mechanism metric first. Revisit only
  if V2 is clean and the Sol cells still lose to native after the bench fix.
- **Stop guidance:** heavily tried and mostly dead; "hit → sufficient" rates are already 45–79% for
  ss-read.

## Order of screens

1. Test-retest: DeepSeek `ds-base-a2` + `ds-base-b2`; Codex `cx-base-a` + `cx-base-b`.
2. V1 on Opus train (`cc-base-a` vs `cc-rp-a`) — Claude Code only, so the Opus cell is its screen.
3. V2 on Codex + DeepSeek train.
4. V3 on Codex + DeepSeek train.
Then validation for every variant that passes train (§6.2).
