# Cache and packing checks — 2026-10-05 (after the dev1005 rerun)

Small, mechanism-level checks (owner: minimal rollouts; cache effects are deterministic, packing is read from traces).

## Claude Code: per-project memory path in the agent file (fixed, d0e4b668; memory OFF in the bench, 141575c3)

Request dump (logging proxy): the lean agent file is system block 3, cached after the global prefix. It
held the per-project memory path, so the ~3.3k-token block was rewritten per project and per cache expiry.
After the fix the block is byte-identical across the warm-up, dgraph and jj requests.

| 5 questions, memory off both arms | first-request cache write | first-request cache read | $/q | calls | score |
|---|---|---|---|---|---|
| sweet (fixed) | 3,490 | 13,728 | 0.0708 | 2.8 | 0.896 |
| native | 3,949 | 11,129 | 0.0851 | 4.0 | 0.990 |
| dev1005 sweet (old, memory on, 60 rows) | 5,345 | 12,659 | 0.0800 | 2.9 | 0.893 |
| dev1005 native (memory on, 30 rows) | 4,580 | 11,259 | 0.0832 | 4.1 | 0.885 |

Before the fix sweet wrote +765 tokens/q more than native on the first request; now −459. $ and score on
5 questions are noise.

## Codex: stock base prompt (CODEX_HARNESS_TRIM=0), 7 questions, interleaved

| arm | first-request cache read | $/q | commands/q | score |
|---|---|---|---|---|
| stock prompt + rules as developer_instructions | 12,654 (≥12,288 in 7/7) | 0.0653 | 12.1 | 0.889 |
| product (yt3batch2 instructions file) | 9,490 (7,168–11,776 in 6/7) | 0.0594 | 6.4 | 0.871 |
| native | 11,685 | 0.0513 | 4.7 | 0.857 |

The stock prompt fixes the first-request cache miss, but the model then runs about twice as many commands.

## Codex: packing (traces; commands split on `;` `&&` `||` and newlines)

| arm | questions | requests/q | commands/step | multi-command steps |
|---|---|---|---|---|
| native (dev1005 + cxstock) | 39 | 4.51 | 2.66 | 59% (Promise.all 18%, `;` 43%) |
| product (dev1005 + cxstock) | 68 | 5.84 | 1.81 | 38% (`;` 37%) |
| stock prompt (cxstock) | 8 | 7.25 | 1.68 | 34% (Promise.all 28%) |
| product (cxpack, paired) | 10 | 6.00 | 2.04 | 48% |
| yt3batch2sol = product + Sol Promise.allSettled line (cxpack, paired) | 10 | 5.70 | 2.02 | 49% (Promise.all 11%) |

The Promise.allSettled line moves some batching from `;` to Promise.all but does not raise commands per
step. Cost $0.0541 vs $0.0545 (n=10). Not shipped. The gap to native is commands per step (2.0 vs 2.7),
not the batching method.
