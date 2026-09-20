# RESULT — cursor leg, frozen 50, grok 4.6 medium

**Ran 2026-09-18 on the bench box. Artifacts retrieved 2026-09-20.** The rollouts completed
cleanly on the 18th but nothing was copied back, so for two days this result existed only on
the box and no cursor number was reproducible from a clone. That gap is what this file closes.

Raw artifacts (`rows.json`, `preds-*.jsonl`, `progress.log`, `gold-tripwire.json`) now sit at
`results/ho2-cursor-20260918-a1/` — **untracked, like every other leg**, because
`eval/task-completion-bench/.gitignore:4` ignores `results/`. `agent-state/` (404 MB) stays on
the box.

| | |
|---|---|
| harness | cursor (`cursor-agent` 2026.09.15-d2fe57e), runner `8a7c422` |
| model | `cursor-grok-4.6-medium`, reasoning medium |
| tasks | the frozen 50 (`select/HELDOUT2_FROZEN50.txt`, sha256 `861000ee…`) — verified set-equal to the ids in `rows.json` |
| design | 50 × 2 arms × 1 rep = 100 rollouts |
| quality | 0 zero-call, 0 run errors, 0 ungradeable, `resolved` present on all 100 |
| wall | 8.5 h |

## Cost — the only claim this instrument supports

| slice | sweet | native | Δ |
|---|---:|---:|---:|
| all 50 | $33.5864 | $25.6184 | **+31.1%** |
| both-solved (n=17) | $6.7277 | $6.0962 | **+10.4%** |

Median per-task **+18.2%**. Sweet cheaper on **17/50**.

**Sweet-search is more expensive on cursor.** It is the first harness where that happens, and
the effort counts say why: sweet 32.6 tool calls vs native 33.8 — level, where every other
harness showed a large cut (19.6 vs 35.8 on claude-code). Sweet issued **1,123 `ss-*` calls
against native's 511 greps**, more than twice the search operations, and did not reduce the
agent's total work. Cursor's native loop wastes little, so there is nothing for retrieval to
remove and the `ss-*` output is pure added tokens.

## Solves — reported, NOT claimed

sweet 18/50, native 21/50 (−3). Discordant 1 sweet-only / 4 native-only, McNemar p = 0.3750.

`HELDOUT2_FROZEN50.md` states that solve deltas at n=50 are noise. This is recorded for
completeness and must not be cited as a finding.

## Three things that bound the number

1. **Cursor list prices, not an invoice.** The leg ran on a Pro+ login, billing against the
   Cursor Models pool rather than per request, and Cursor publishes no per-request record to
   reconcile against. Comparable inside this leg; NOT poolable with the OpenRouter-invoiced
   claude-code figures.
2. **Model and harness moved together.** The other three legs ran `gpt-5.6-luna`; this ran grok
   4.6 medium, cursor's own default pairing. Part of +31.1% may be grok's agentic style rather
   than cursor's. The disambiguating cell is `gpt-5.6-luna-medium` on cursor, which the account
   offers.
3. **It was observed before any prediction was written down.** This result therefore CANNOT
   serve as the out-of-sample test of the delegation mechanism. See below.

## Consequence for the pre-registration plan

The proposed step "write down the predicted cursor delta, seal it, then run" **is no longer
available for cursor** — the run exists and the result has been read. Fitting the mechanism
curve to four points that were all seen first leaves it a fitted curve, not a tested one.

To get a genuine out-of-sample test the sealed prediction has to be made on a cell nobody has
looked at. Two candidates, both cheap:

- **luna-on-cursor, frozen 50** — also removes bound (2), so it does double duty.
- **a fifth harness** — more work, but a stronger test because the mechanism would be
  predicting an unseen *harness* rather than an unseen model on a seen harness.

## Where it sits among the four legs

| harness | model | cost Δ at parity | delegation by the native arm |
|---|---|---:|---|
| claude-code | luna | −31.0% | 1,191 subagent requests vs sweet's 150 |
| opencode | luna | −7.7% | `task` fired 4 times in 402 rollouts |
| codex | luna | −2.1% | no subagent tier at all |
| **cursor** | **grok 4.6 med** | **+10.4%** | none; native loop already lean |

The ordering is monotonic in how much redundant exploration the native loop does. That is the
paper's mechanism — and, per the note above, it is currently fitted rather than tested.
