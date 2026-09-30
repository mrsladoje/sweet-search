# r282 — retrieval matrix on sweet-search 2.8.2: results

Run 2026-09-30, 17:41–22:55, on the Mac, concurrency 3. Pre-registration: `r282-PREREG.md`.
Runner: `scripts/retrieval-bench-282.mjs` (commits 0b2f8128, fda19a63).

**Headline:** accuracy is equal in all 5 cells. Sweet-search reduces tool calls (significant in 2
cells) and changes cost in both directions depending on harness and model: significantly cheaper
nowhere, significantly more expensive on Opus 5.5 / Claude Code (+22%) and DeepSeek V4.1 Flash /
opencode (+55%, < $0.001 per question). The pool is at ceiling (native accuracy 95–98%), so it
cannot show an accuracy gain.

## Setup

- 130 paired probes per cell: vault 60 + held-out 30 + OOD 40 (merged, pre-registered primary).
- Arms: native = stock harness; sweet = the shipped 2.8.2 product harness (init prompt + rules +
  ss-* tools). Same short frame in the user message for both arms.
- Every rollout on APFS clones outside the project (no ancestor AGENTS.md leak).
- Judges: median of deepseek-v4-flash (direct), gemini-3.1-flash-lite (direct), MiniMax
  (OpenRouter). All three returned scores on every row.
- Cost: tokens × list price, cache-aware, cache-write 1.25× basis, Claude Code
  sidechain-inclusive — the same basis for every cell, whatever the billing.
- Stats: paired bootstrap stratified by set, B = 20000, seed 42, 95% percentile CI; two-sided
  bootstrap p; Benjamini–Hochberg q across 5 cells × 4 primary metrics = 20 tests.
- 1300 rollouts, 0 errors, 0 timeouts, 0 account stops. Sweet arm used ss-* on 100% of probes
  in every cell.

| Cell | Harness (version) | Model | Effort | Billing |
|---|---|---|---|---|
| cc-sonnet55-high | Claude Code 2.1.281 | claude-sonnet-5-5 | high | Claude subscription |
| cc-opus55-medium | Claude Code 2.1.281 | claude-opus-5-5 | medium | Claude subscription |
| codex-sol61-high | Codex 0.159.2 | gpt-6.1-sol | high | ChatGPT subscription |
| oc-sol61-high | opencode 1.18.4 | openai/gpt-6.1-sol | high | ChatGPT subscription (OAuth) |
| oc-dsflash41 | opencode 1.18.4 | deepseek-flash (V4.1 Flash) | API default (thinking, high) | DeepSeek API |

## Primary results (pooled, n = 130 per cell)

| Cell | Metric | Native | Sweet | Δ % | 95% CI (Δ) | p | BH q | |
|---|---|---|---|---|---|---|---|---|
| cc-sonnet55-high | accuracy | 0.9700 | 0.9792 | +1.0 | [−0.0065, 0.0265] | 0.252 | 0.360 | |
| | cost $ | 0.0424 | 0.0421 | −0.7 | [−0.0017, 0.0012] | 0.707 | 0.744 | |
| | calls | 2.754 | 2.592 | −5.9 | [−0.369, 0.054] | 0.149 | 0.268 | |
| | content | 0.4785 | 0.3785 | −20.9 | [−0.148, −0.054] | <0.001 | <0.001 | **sig** |
| cc-opus55-medium | accuracy | 0.9823 | 0.9781 | −0.4 | [−0.0196, 0.0127] | 0.565 | 0.628 | |
| | cost $ | 0.0530 | 0.0649 | **+22.4** | [0.0096, 0.0143] | <0.001 | <0.001 | **sig** |
| | calls | 2.631 | 2.108 | **−19.9** | [−0.700, −0.346] | <0.001 | <0.001 | **sig** |
| | content | 0.6400 | 0.4015 | −37.3 | [−0.294, −0.185] | <0.001 | <0.001 | **sig** |
| codex-sol61-high | accuracy | 0.9569 | 0.9573 | 0.0 | [−0.0131, 0.0138] | 0.973 | 0.973 | |
| | cost $ | 0.0286 | 0.0256 | −10.5 | [−0.0062, 0.0003] | 0.072 | 0.204 | |
| | calls | 2.762 | 2.638 | −4.5 | [−0.354, 0.108] | 0.294 | 0.379 | |
| | content | 0.6492 | 0.6800 | +4.7 | [−0.015, 0.077] | 0.194 | 0.298 | |
| oc-sol61-high | accuracy | 0.9737 | 0.9669 | −0.7 | [−0.0172, 0.0025] | 0.161 | 0.268 | |
| | cost $ | 0.0268 | 0.0287 | +6.8 | [−0.0004, 0.0041] | 0.109 | 0.240 | |
| | calls | 4.015 | 3.046 | **−24.1** | [−1.362, −0.600] | <0.001 | <0.001 | **sig** |
| | content | 0.3600 | 0.3938 | +9.4 | [−0.009, 0.079] | 0.120 | 0.240 | |
| oc-dsflash41 | accuracy | 0.9658 | 0.9758 | +1.0 | [−0.0115, 0.0273] | 0.303 | 0.379 | |
| | cost $ | 0.0015 | 0.0022 | **+54.6** | [0.0006, 0.0010] | <0.001 | <0.001 | **sig** |
| | calls | 5.615 | 5.092 | −9.3 | [−1.069, 0.085] | 0.088 | 0.219 | |
| | content | 0.3754 | 0.3569 | −4.9 | [−0.063, 0.025] | 0.394 | 0.463 | |

p < 0.001 means no bootstrap resample crossed zero (B = 20000). BH-significant: 6 of 20.

## Secondary (pooled; uncorrected)

| Cell | Cost without cache discount (Δ %) | Wall time (Δ %) |
|---|---|---|
| cc-sonnet55-high | −23.5 (sig) | +10.4 (sig) |
| cc-opus55-medium | −1.8 | −0.3 |
| codex-sol61-high | +10.4 (sig) | +5.9 (sig) |
| oc-sol61-high | +8.3 (sig) | −2.8 |
| oc-dsflash41 | +5.4 | +12.2 (sig) |

Per-set (secondary, uncorrected, aggregate only): on the OOD set (40 probes, repos never used in
development) sweet cuts calls in every cell (−20% to −36%, all CI below 0);
accuracy +2.9 points (DeepSeek) and +3.2 points (Sonnet), both CI above 0; cost −29% (Codex) and
−6.5% (Sonnet), both CI below 0; but Opus stays +25% on OOD. Full per-set tables: `--report` per cell.

## Reading

1. **Accuracy: no difference in any cell** (all |Δ| ≤ 1 point, all q > 0.36). The pool is at its
   ceiling; it can detect harm, not gains.
2. **Calls: sweet uses fewer or equal calls everywhere**; significant on Opus (−20%) and Sol in
   opencode (−24%). Native Codex and native Claude Code already use < 3 calls per probe.
3. **Cost is decided by caching, not by the amount of work.** Without the cache discount, sweet
   sends −24% (Sonnet) to +10% (Codex) input. With it, the bill moves from −10% (Codex) to +55%
   (DeepSeek). Opus: −2% naive input but +22% billed. Hypothesis (unverified): more cache writes
   or less cache reuse in the sweet arm. First item of the trace analysis (`FINAL_TUNING.md` §2.5).
4. **Useful content drops in Claude Code** (−21% Sonnet, −37% Opus, both significant) with no
   accuracy loss; not in the other harnesses. Cause unknown; to be explained by the trace
   analysis.

## Known limits

- Codex and opencode cost come from main-session usage events only (delegated subagents not
  priced there); Claude Code is sidechain-inclusive.
- One repetition per probe.
- Engine, ss-* wrappers and harness prompts all changed since June: no cell is comparable with a
  June cell.
- Codex reasoning is encrypted (no readable summaries in this run).
- `.git` drift only: opencode's `.git/opencode` id file and pack-file mtimes (content unchanged —
  pack names are content hashes). No working-tree file changed. opencode sweet-arm `patch` parts
  list only `.sweet-search/` maintainer files.

## Status of the pool after this report

Per `FINAL_TUNING.md` §0: with this report committed, the r282 pool becomes **DEV**. These
numbers remain the held-out result for **2.8.2 only**.

Session stores archived: `results/r282-sessions-20260930.tgz` (gitignored). BH table:
`node scripts/retrieval-bench-282-bh.mjs` (runner's bootstrap, seed 42, two-sided p).
