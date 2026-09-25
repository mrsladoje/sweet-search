# HO2 admitted-200 — Claude Code 2.1.281 + Claude Opus 5.5 (effort medium), subscription

Two runs, byte-identical harness code (commit `25bfdd8`), pooled into one 200-task result:

| run | tasks | window (UTC) |
|---|---|---|
| `ho2-opus55-20260924-b1` | the frozen 50 (`select/HELDOUT2_FROZEN50.txt`) | 2026-09-24 11:53 – 16:07 |
| `ho2-opus55-20260924-c1` | the other 150 of `/root/ho2-admitted200.txt` | 2026-09-24 18:37 – 2026-09-25 11:19 |

Same 200 tasks as the Luna claude-code leg (`ho2-claudecode-20260911`). 200 tasks × 2 arms × 1 rep = 400 rollouts.
Unified rows: `results/ho2-opus55-200-unified-rows.json` (untracked; each row carries `_sourceRun`).
The frozen-50 subset alone is reported in `RESULT-HO2-OPUS55-FROZEN50.md`.

## Validity checks on the pooled set

- 400 rows, 0 duplicate (task, arm), 0 task overlap between runs; b1 equals the frozen-50 list.
- All 400 rows: `harnessVersion` 2.1.281, model `claude-opus-5-5`, reasoning `medium`, provider `anthropic`.
- 0 zero-call rollouts, 0 incomplete cost instrumentation, 0 null costs, `resolved` on every row.
- Auth: owner's Claude Max subscription only (`claude auth login`); no API key or OpenRouter key in any process env. Login refreshed twice mid-run and was written back.
- No subagent spend on either arm ($0 / $0).
- Env ledger `luna-ho2-fp5`: 200/200 gold-FULL at preflight.

## Result (aggregate only — held-out)

| | native | sweet-search | Δ sweet vs native |
|---|---|---|---|
| **resolved** | 103/200 | 107/200 | +4; only-native 3, only-sweet 7, both 100, neither 90; exact McNemar p=0.344 |
| **cost, list rate, all 200** | $38.46 | $41.74 | **+8.5%**, 95% CI [+3.9, +13.5], p=0.0001; sweet cheaper on 66/200 |
| cost, ideal-cache, all 200 | $42.56 | $45.38 | +6.6%, CI [+2.7, +10.8], p=0.0005 |
| **cost, list rate, both-solved (n=100)** | $16.81 | $18.41 | **+9.5%**, CI [+4.2, +15.5], p=0.0008; sweet cheaper on 29/100 |
| cost, ideal-cache, both-solved | $19.07 | $20.42 | +7.1%, CI [+2.7, +12.0], p=0.0018 |
| cost per solve (list) | $0.373 | $0.390 | +4.5% |
| tool calls | 1,491 | 1,514 | +1.5%, CI [−4.3, +7.6], p=0.62 |
| wall time | 6.95 h | 6.98 h | +0.3%, CI [−10.5, +11.2], p=0.95 |

CIs: paired bootstrap over tasks, 10,000 resamples, seed 42. Cost p: two-sided paired sign-flip, 20,000 draws.

**Exploratory, chosen after seeing the data (not pre-registered):** wall time with `run_tests`
and the agent's waits on it removed — native 2.06 h, sweet 2.03 h, −1.6%, CI [−10.5, +8.6], p=0.75,
sweet faster on 97/200. No speed difference with or without test time.

## Reading

- **Cost: sweet-search is significantly MORE expensive on this harness+model**, by 7–10% at parity.
- **Solves: +4 for sweet, not significant** (p=0.34).
- **Speed: no difference.**
- Mechanism: Opus 5.5 medium makes the same number of calls on both arms and never delegates to
  subagents, so the saving that made sweet cheaper on the Luna claude-code leg (native's subagent
  fan-out) is absent; the larger `ss-*` outputs then add tokens without removing calls.
- The frozen 50 read +6.0% (n.s.); the other 150 read +9.3% ($29.20 → $31.93). Same sign, the
  pooled 200 resolves it.

## Caveats

- Dollar figures are **list-price models** ($4 / $0.20 / $20 per 1M). The subscription has no per-token bill.
- `ss` counter under-counts (Opus writes `cd <dir>; ss-grep …`); recount from transcripts before quoting sweet tool usage.
- Harness 2.1.281 here vs 2.1.218 on the Luna claude-code leg; backbone also differs. Do not attribute cross-leg differences to either alone.
- escape= 35 native / 26 sweet after the connector fix.
