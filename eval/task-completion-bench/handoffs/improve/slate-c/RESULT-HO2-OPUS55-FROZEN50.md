# HO2 frozen-50 — Claude Code 2.1.281 + Claude Opus 5.5 (effort medium), subscription

Run `ho2-opus55-20260924-b1`, 2026-09-24 11:53–16:07 UTC on the Hetzner box.
50 tasks (`select/HELDOUT2_FROZEN50.txt`, seed 42, same draw as the cursor leg) × 2 arms × 1 rep = 100 rollouts.
Raw artifacts retrieved to `results/ho2-opus55-20260924-b1/` (untracked, per convention).

## Configuration

| item | value |
|---|---|
| harness | Claude Code **2.1.281** (`harnessVersion` stamped on all 100 rows) |
| model | `claude-opus-5-5`, `--effort medium` (verified in transcripts) |
| auth | owner's Claude **Max** subscription (`claude auth login` on the box); no API key, no OpenRouter anywhere in the process env |
| egress | `api.anthropic.com`, `platform.claude.com` only |
| claude.ai connectors | disabled (`ENABLE_CLAUDEAI_MCP_SERVERS=false`) |
| env ledger | `luna-ho2-fp5`, 50/50 gold-FULL at preflight |

A first attempt (`-a1`, 2 rollouts) ran with the claude.ai connectors enabled (51 denied
`mcp-proxy.anthropic.com` connections per rollout). It was stopped, set aside in
`/root/ho2-run/discarded/`, and NOT pooled.

## Result (aggregate only — held-out)

| | native | sweet-search | Δ sweet vs native |
|---|---|---|---|
| resolved | 25/50 | 26/50 | +1 (only-native 1, only-sweet 2) |
| cost, list rate, all 50 | $9.257 | $9.814 | **+6.0%**, 95% CI [−1.9, +14.4], sign-flip p=0.163, cheaper on 21/50 |
| cost, ideal-cache, all 50 | $10.324 | $10.807 | +4.7%, CI [−2.1, +11.9], p=0.215 |
| cost, list rate, both-solved (n=24) | $3.871 | $4.081 | +5.4%, CI [−1.0, +13.7], p=0.134, cheaper on 11/24 |
| cost, ideal-cache, both-solved | $4.456 | $4.623 | +3.7%, CI [−1.6, +10.1], p=0.206 |
| tool calls | 360 | 365 | +1.4% |
| wall time | 81.6 min | 78.4 min | −4.0% |

CIs: paired bootstrap over tasks, 10,000 resamples, seed 42. p: two-sided paired sign-flip, 20,000 draws.

**Reading:** no significant difference in either cost or solves. The point estimate has
sweet-search a few percent more expensive at parity. Unlike the Luna claude-code leg, no
subagent spend occurred on either arm (sidechain $0 / $0), so the delegation saving that drove
sweet's earlier claude-code advantage is absent here.

## Data quality

- 0 zero-call rollouts, 0 incomplete cost instrumentation, 0 subagent contexts.
- escape= 15 native / 6 sweet (after the connector fix).
- Dollar figures are **modelled at list price** ($4 / $0.20 / $20 per 1M). The subscription has no per-token bill.
- The `ss` counter under-counts: Opus writes `cd <dir>; ss-grep …`, which the classifier files as plain bash. Recount from transcripts before quoting ss usage.
- Harness upgrade: the Luna claude-code leg ran 2.1.218. Any cross-leg comparison crosses a harness version.
