# Grep paper — overnight report, 2026-10-20

**Conclusion.** Tasks 0 to 5 are done. The $5 agent pilot ran through OpenRouter (owner instruction
during the night, because the DeepSeek balance stayed at −$0.01) and cost $0.45 in total. Gate A keeps the truncation-loss framing: the agent's own
cut hid all definition-level evidence in 28.6% of 500 evidence-bearing dev calls. The tuning round found no
change that passes the rule, so the shipped selector stays the reference. All times are CEST.

## Owner items (decide in the morning)

1. **Agent pilot result (harness and cost check, not evidence).** See "Agent pilot" below. Two design
   points need a decision before the main agent check: the turn caps (most runs stop at the cap), and the
   fix-file measure (it saturates in the resume design). The DeepSeek account still shows −$0.01; a top-up
   is only needed if you want DeepSeek's own endpoint.
2. **Speed bench for the flag work, then merge.** Branch `grep-flag-coverage` (85a63c6b) is pushed and
   not merged. Run `~/.ss-eval/grep-e2e-bench/run-flags-morning.sh` in stages after the soaks end (load
   below 6). Merge rule: no existing query class slower than noise. Main got 6f1c3613 (lane state for
   queued files) after the branch point. The merge is clean in git, but run the shadow check again on the
   merged tree before the merge.
3. **The `\|` rule.** Choose between the branch rule (read the whole pattern as GNU basic regex) and
   "translate only `\|`". My recommendation: keep the branch rule. Data from the dev census: of 47,128
   dev patterns with `\|`, 3,179 (6.7%) also hold bare `(` `)` `{` `}` `+` or `?` (for example
   `codecs.open\|open(`). With "only `\|`", `open(` becomes an invalid regex. The branch rule gives the
   GNU reading that the agent saw. About 150 patterns with bare `+` or `?` change meaning under either rule.
   Four smaller items from the flag work are in `~/.ss-eval/grep-paper/flag-coverage-report.md` (exit 1 on
   zero matches in `-l`/`-c`/`-o`; `-c` lists only files with a match; `-k` caps the modes; the modes run
   without the agent format).
4. **Tuning result.** No family passes (`TUNING.md` part 2). The best, a test prior of 0.25, gains
   0.43 points; the rule needs 2. Nothing is frozen and no product code changed. Decide if the selector
   freeze can go ahead with the shipped constants.
5. **Pool size.** The plan expected about 1,700 evidence-bearing calls at definition level. The replay
   gives 1,380. The plan says to resize before the held-out run if the pool is much lower. Decide if
   81% of the plan is enough.
6. **Main agent-check ceiling** (estimate $15–40). No go yet. Nothing started.
7. **Second annotator** for the label audit (plan §3.3). Still open.
8. **arXiv endorsement for cs.** Still open.

## What finished

| Task | Result | Commit |
|---|---|---|
| 1. Parallel jobs in `agent_run.py` | `--jobs N` (thread pool), one ledger with a lock: each call reserves its worst-case cost first, then settles the real cost. A cap hit or an API error (for example 402) stops all jobs at their next call. Each job gets its own sandbox profile and work directory. Dry runs: `--jobs 1` and `--jobs 8` give identical sorted records (resume 40, fresh 20). Fake-API test: the cap held at 16 threads; a 402 stopped the later calls. No paid call. | d76e692a |
| 2. Census on all 48 shards | 106,988 trajectories, 2,121,108 grep-family calls. 17,578 eligible cut calls (97.8% cut by the agent's `head`). `CENSUS.md`. Edit detector v3 agrees with blind annotators on 48 of 50 fresh calls (96%, interval 87–99%). | 9977bd35, d0de59d8 |
| 3. Dev replay harness and full dev replay | 4,000 uncut calls agree at 95.0%. 7,851 eligible cut calls replayed (01:16–02:17). 89.2% agree with the trace (tiers O and O+). 1,380 evidence-bearing overflowing calls at definition level. On overflowing calls the agent saw 61.4% of the matching files (mean). 50-call test: 44 of 50 agree. `E1_PILOT.md`. | 9977bd35, 56d7c604, c5291ebf |
| 4. Agent grep forms in ss-grep | `\|`, `-E`, `-l`, `-c`, `-o` and bundles such as `-rn`, in the JavaScript tool and the native lane, one commit. Shadow check: 115 lane answers, 0 byte differences; lane on against lane off, 0 differences. On the exact argv of 113,475 eligible dev calls, main accepts 23.6% and the branch accepts 99.8%. | 85a63c6b (branch) |
| 5. Gate A pilot and tuning round | As seen: 28.6% miss (23.9–32.6%), threshold about 5%. Shipped selector: 13.8%. Tuning: 7 families, 5 folds by repository; none passes. `E1_PILOT.md`, `TUNING.md`. | d169f7a4 (rules first), c5291ebf |

Main numbers from the pilot (definition level, 500 calls): as seen 28.6%, native order 32.4%, sorted path
order 25.6%, round robin 16.8%, frequency order 39.2%, shipped selector 13.8%, shipped selector with the
summary header 16.0%. Against the agent's real cut, the selector recovers 96 calls and newly loses 22.

Uncut calls (diagnostic): 4,000 uncut dev calls (seed 42) were replayed 02:17–02:54. The replay
prints exactly the visible output for 95.0% of them.

## Agent pilot (task 0)

Run 04:10–04:32 CEST through OpenRouter, model `deepseek/deepseek-v4-flash`, reasoning effort `xhigh`,
fp8 or bf16 endpoints only (served by SiliconFlow and GMICloud, 301 calls each), `--jobs 4`. Ledger cap
$4.99 ($5 minus a $0.0022 live test of the new provider code before the pilot). Commit 71095e49.
This is a harness and cost check, not evidence. The wall time was affected by the Mac load.

| Design | Arm | Runs | Aborted | $ / run (mean) | $ / run (max) | Turns / run | Stop reasons | Fix file seen | … first after the start | Edit in a fix file |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|
| resume (8 turns) | as seen | 20 | 0 | 0.0061 | 0.0131 | 7.6 | turn cap 18, edit 2 | 20/20 | 4/20 | 2/2 |
| resume (8 turns) | ranked | 20 | 0 | 0.0061 | 0.0160 | 7.8 | turn cap 19, edit 1 | 20/20 | 0/20 | 0/1 |
| fresh (15 turns) | as seen | 10 | 0 | 0.0104 | 0.0160 | 14.4 | turn cap 8, edit 2 | 10/10 | 10/10 | 1/2 |
| fresh (15 turns) | ranked | 10 | 0 | 0.0096 | 0.0146 | 15.0 | turn cap 10 | 10/10 | 10/10 | 0/0 |

- **Cost:** $0.45 for 60 runs (602 API calls). The ledger agrees with the sum of the runs. A run costs
  $0.006 (resume) to $0.010 (fresh). At these prices the main agent check costs far less than the
  $15–40 estimate, which used DeepSeek's own prices.
- **Harness errors:** none aborted. One call named an unknown tool (`executBash`, a model typo); the
  harness answered "Unknown tool" and the run went on.
- **Turn caps:** 55 of 60 runs stopped at the turn cap. Only 5 runs reached an edit. The edit-based
  outcome needs more turns.
- **Fix-file measure:** "fix file seen" counts a gold path anywhere in the text. In the resume design every
  run already shows a fix file at the start, so the measure says nothing there. It needs the stricter
  rule (a fix file first seen in a grep output after the start).
- Commands: `~/.ss-eval/grep-paper/agent/pilot/run-pilot.sh`. Summary: `mine/agent_report.py --out
  ~/.ss-eval/grep-paper/agent/pilot`.

## Still running

Nothing of mine runs now. I stopped the balance watcher at 04:10, when the pilot started on OpenRouter.

## Decisions I made alone

- I ran the flag work (task 4) in a forked agent in its own git worktree, so the main tree stayed clean.
- Edit detector: I checked it with blind Sonnet annotators, 2 × 25 calls per sample. I fixed it twice
  (v2, v3). Only the third sample (seed 44) is out of sample for v3. A new file in the repository counts
  as an edit.
- Eligibility includes the several-files rule (`-r`, `xargs`, or two or more paths).
- The replay runs the agent's argv and a canonical run (`-H -n -Z`) and zips their lines. Exit code 2
  output is kept, with the grep errors. For `cwd=/workspace` with absolute paths, I fixed the call root.
- I stopped my own first full replay at 01:15 (my PIDs 99600 and 99602), because the brace matcher gave
  wrong Java class spans. I fixed the scanner and restarted at 01:16. The partial output is in
  `~/.ss-eval/grep-paper/replay-dev-aborted-0115/`. The replay also stores the base-revision text of gold
  files, so the labels can be redone offline (for example with tree-sitter).
- Replay order: all cut calls first, then 4,000 uncut calls (seed 42) as a diagnostic.
- The ledger stops all jobs when one reservation fails. This can stop early, never late.
- Tuning: I fixed the grids, the intent rules and the scoring before any result (d169f7a4). For a harness
  cut, the budget is the visible line count. For `-l`/`-c` calls, the definition level uses the file label.
  The primary score has no header. After the first run I added the "with header" column that part 1
  promised; it changed no choice.
- I skipped the rival tools (see below).
- I measured coverage with a parser emulation (`mine/coverage.mjs`), not with live daemon calls.
- Definition spans are heuristic (Python `ast`, a brace matcher, Ruby `end`), because tree-sitter is not
  installed.

## Peer windows

No MaxSim or HNSW session announced a timed window tonight (ListAgents at 00:38 and 01:17). The memory
note about a MaxSim window (23:30–04:30 UTC) is from 15–16 October. I paused nothing.

## Skipped, and why

- **Agent pilot on DeepSeek's own API:** no balance (−$0.01 at every check from 00:38 to 04:08). The pilot
  ran on OpenRouter instead.
- **Speed bench for the flag work:** the owner's soaks load the Mac (load 11–22 at 01:05, 59 at the peak).
  The bench waits for the morning.
- **Rival tools in the replay:** RTK is not installed. The Signal Grep plugin is not installed and needs an
  MCP driver. Neither is in the dev numbers.
- **Scale-SWE in the replay:** it needs the image HEAD (plan). Only SWE-rebench-V2 is replayed.
- **Selector freeze, pre-registration, Zenodo DOI, product port, held-out replay, main agent check, box
  work:** not tonight (handoff).
