# Sealed prediction — HO2 admitted-200, Claude Code 2.1.281 + Claude Opus 5.5, effort HIGH

Written and committed **before** the first rollout of `ho2-opus55high-*`. Author: Claude (the
assistant running the leg), from the medium-effort result only (`RESULT-HO2-OPUS55-200.md`).
The owner did not write or edit these numbers.

## Configuration held equal to the medium leg

Same 200 tasks (`/root/ho2-admitted200.txt`), same harness code (runner/pilot/ideal-cost sha1
929e6656 / 82d307da / 991dcdbd), Claude Code 2.1.281, `claude-opus-5-5`, owner's Max
subscription, same env ledger, same egress allowlist, connectors off, 1 rep, CONCURRENCY=1.
Only change: `REASONING=high` → `--effort high`.

## Predictions (primary = P1)

| # | quantity | prediction | falsified if |
|---|---|---|---|
| P1 | cost Δ sweet vs native, list price, all 200 | **positive, +3% to +12%** | point estimate ≤ 0% or ≥ +20% |
| P2 | subagent requests, both arms | ≤ 10 per arm in 200 runs | either arm > 25 |
| P3 | solves Δ | within ±8 tasks, not significant (McNemar p > 0.05) | significant in either direction |
| P4 | tool calls | within ±10% between arms | differ by > 20% |
| P5 | both arms vs medium | cost per task rises ≥ 25% on both arms | rises < 10% on either arm |

## Reasoning

Medium effort gave +8.5% (CI +4.0..+13.3) with zero delegation and equal call counts. Higher
effort adds thinking tokens in proportion on both arms and should not create delegation by
itself, so the sign should hold. If P2 fails (native starts delegating at high effort), P1 is
expected to move toward zero or negative — that would support the delegation mechanism.

Held-out rule: totals only; no per-task inspection.
