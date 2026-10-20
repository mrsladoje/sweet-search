# Grep paper — overnight report, 2026-10-20

**Conclusion.** Tasks 1 to 5 are done. Task 0 (the $5 agent pilot) did not run: the DeepSeek balance
stayed at −$0.01 at every check, and I spent $0. Gate A keeps the truncation-loss framing: the agent's own
cut hid all definition-level evidence in 28.6% of 500 evidence-bearing dev calls. The tuning round found no
change that passes the rule, so the shipped selector stays the reference. All times are CEST.

## Owner items (decide in the morning)

1. **DeepSeek top-up.** The pilot needs `is_available` true and at least $6. The balance was −$0.01 at
   every check (00:38, then every 30 minutes until 02:38, the last check before this report). The pilot is
   ready: `agent_run.py --jobs 4`, resume design then fresh design, commands in the handoff. The ledger
   stops all jobs at $5 in total.
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

## Still running

Nothing of mine runs now, apart from the balance watcher (every 30 minutes; it starts nothing, it only
logs to `~/.ss-eval/grep-paper/agent/pilot/balance.log`).

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

- **Agent pilot (task 0):** no balance. $0 spent.
- **Speed bench for the flag work:** the owner's soaks load the Mac (load 11–22 at 01:05, 59 at the peak).
  The bench waits for the morning.
- **Rival tools in the replay:** RTK is not installed. The Signal Grep plugin is not installed and needs an
  MCP driver. Neither is in the dev numbers.
- **Scale-SWE in the replay:** it needs the image HEAD (plan). Only SWE-rebench-V2 is replayed.
- **Selector freeze, pre-registration, Zenodo DOI, product port, held-out replay, main agent check, box
  work:** not tonight (handoff).
