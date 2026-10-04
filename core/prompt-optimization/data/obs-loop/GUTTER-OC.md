# ss-read gutter on opencode: colon (shipped) vs none — micro-smoke, 2026-10-03 (PLAN.md item 3.2)

Run: `gutter-smoke-oc.sh`, stamp `oc1`, runs `gso-oc1-L1..L4` (ABBA, 2 reps), 3 tasks (jupytext-360, brighterscript-1050, bingo-271),
sweet arm only, opencode 1.18.4, model `openai/gpt-6.1-sol` via OpenRouter (metered, about $1.1 in total), product trim
`conflict3+todo3eff3k`. Analysis: `analyze-gutter-oc.mjs <manifest> --detail`.

Deviations from the plan text: (1) the task-bench opencode runner has no subscription route, so the run used OpenRouter, the route of the
hill-climb (which ran `openai/gpt-5.6-luna`; no earlier Sol task-bench rows exist). (2) The runner passes no `--variant`, so reasoning is
opencode's default for the model, not `high` (`REASONING=medium` is only the row stamp, as in the hill-climb rows). Ledger was stale under
current code, so the three tasks were re-swept (gold-only, $0) before launch.

| arm | n | solved | ideal $ (mean) | req (mean) | calls | ss-read | ss-read with gutter | ss-grep | native line probes | edits (apply_patch) | failed edits | gutter leaks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A colon | 6 | 0 | 0.092 | 11.2 | 139 | 36 | 34 | 15 | 0 | 12 | 0 | 0 |
| B none  | 6 | 0 | 0.090 | 10.8 | 129 | 31 | 0 | 14 | 0 | 10 | 0 | 0 |

Exposure holds: every A read of 8 or more lines carries `N:code`; no B result carries a number. The 2 A results without a gutter are a
not-found path and a 6-line tail read.

Reading: no failed edit and no anchor failure in either arm (22 of 22 apply_patch calls completed). B showed no extra line-number probes and
no native `sed -n` reads. Both arms solved 0 of 6, as in the hill-climb history for these tasks (brighterscript-1050 scores partial 0.5 in
all four rollouts of both arms). One B rollout read wider ranges on jupytext (`cli.py 1 205` where A read `1 45`; 432 vs 289 and 256 ss-read output lines), but the other B rollout read 274 lines, and requests and dollars did not rise. n = 6 per arm: this reads failure counts, not cost. Never publish.
