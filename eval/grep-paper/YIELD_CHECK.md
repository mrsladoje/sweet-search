# Yield check (2026-10-19)

**Result.** The data supports the cut-down plan. A 5,040-trajectory sample gives about 50 evidence-bearing overflowing calls per 1,000 trajectories. At file level, about 10% of these calls are truncation misses. One task source, Scale-SWE, needs its container images for a faithful replay.

All per-call numbers come from **dev repositories only**. The split is provisional: by repository, sha256("42:" + repo) < 0.6 means dev. The funnel table counts all repositories, but only as aggregates. No held-out call was inspected.

Code: `eval/grep-paper/mine/` (`traces.py`, `yield_check.py`, `replay_sample.py`, `yield_report.py`). Data and checkouts: `~/.ss-eval/grep-paper/` (not in git).

## 1. Trace funnel (no replay)

Sample: nvidia/Open-SWE-Traces. The sample has 24 strata (harness × model × task source). It takes 2 shards per stratum and 210 trajectories per stratum, with seed 42.

| Step | mini-swe-agent | OpenHands | SWE-agent | All |
|---|---:|---:|---:|---:|
| Trajectories | 1,260 | 2,100 | 1,680 | 5,040 |
| Grep-family calls | 24,723 | 35,596 | 39,181 | 99,500 |
| Search files (not a stdin filter) | 16,433 | 22,791 | 23,906 | 63,130 |
| Before the first edit | 8,131 | 10,705 | 11,157 | 29,993 |
| Several files (`-r`, `xargs`, or 2+ paths) | 4,583 | 6,253 | 6,318 | 17,154 |
| Only one grep in the command | 1,914 | 3,061 | 3,159 | 8,134 |
| Visible output was cut | 202 | 274 | 278 | **754** |
| Cut, and a gold-patch file is visible | 76 | 103 | 83 | 262 |

- 0.15 candidate calls per trajectory.
- 97% of the cuts come from the agent's own `head`. Only 18 cuts came from a harness limit.
- The most common limits are `head -20` (9,227 calls), `head -10` (7,437) and `head -30` (4,247). These counts cover all grep-family calls in dev.
- **The largest loss in the funnel is "only one grep in the command".** It halves the pool (17,154 to 8,134). These commands chain several greps with `;` or `&&`, so their output cannot be assigned to one call. Splitting that output is a yield lever for later.

## 2. Replay of a dev sample on clean checkouts

Sample: 150 cut calls and 90 uncut calls, stratified by harness, seed 42. Each call runs on a shallow checkout of the task's base commit, with GNU grep 3.12 on macOS (APFS) and no container. Only the grep argv runs (plus the `find` argv for `find | xargs grep`), never the shell line.

| Measure | Value |
|---|---|
| Replayed | 147 of 150 cut calls; 83 of 90 uncut calls |
| Every visible line found in the replay (cut calls) | 132 of 147 (90%) |
| Of those, full output larger than the visible output (a real overflow) | 124 of 132 (94%) |
| Of those, a gold-patch file in the full output (evidence-bearing, file level) | 49 of 124 (40%) |
| Of those, no gold-patch file visible (**truncation miss, file level**) | **5 of 49 (10%; Wilson 95% interval 4–22%)** |
| Median full/visible line ratio on overflowing calls | 1.8 |
| Median files in the full output | 11.5 |

**Replay agreement depends on the task source.** The table counts cut and uncut calls together.

| Harness | Scale-SWE | SWE-rebench-V2 |
|---|---:|---:|
| mini-swe-agent | 19/28 | 44/45 |
| OpenHands | 28/31 | 44/46 |
| SWE-agent | 17/21 | 51/59 |
| All | 64/80 (80%) | 139/150 (93%) |

**Cause of the Scale-SWE disagreements, checked on one task** (`microsoft_knack_pr223`):
- The task's `parent_commit` is 6354f3d.
- The published image `aweaiteam/scaleswe:microsoft_knack_pr223` holds the repository at 7993fa2, an older commit. A line that the agent saw exists at 7993fa2 and was removed at 6354f3d.
- The task's `pre_commands` would check out `parent_commit`, but the traces show the image state. So for Scale-SWE, the faithful environment is the image, not `parent_commit`.
- To use Scale-SWE, read each image's HEAD (one pull, about 0.5 GB per task) or replay inside the image. The other choice is to restrict the replay to SWE-rebench-V2, whose image tags carry the base commit.

All 5 file-level misses in the sample are on SWE-rebench-V2 (5/26). Scale-SWE has 0/23. The samples are too small to say that the two sources differ.

## 3. Other premises

| Premise | Result |
|---|---|
| Several trajectories per task (needed for experiment E5a) | **Holds.** 677,813 trajectories cover 42,533 tasks and 3,788 repositories. Most tasks have 10–25 trajectories. |
| Container images exist | Scale-SWE: `aweaiteam/scaleswe:<instance_id>` (field `image_url`). SWE-rebench-V2: `swerebenchv2/<owner>-<repo>:<pr>-<sha7>` (field `image_name`). Both are amd64 only, 0.5–1.4 GB each. |
| ext4 order differs between filesystems (experiment E3) | **Confirmed on Linux.** Two ext4 images from separate `mkfs` runs got different hash seeds. The same `grep -rl target src \| head -10` then printed 10 files from `pkg6` on one image and 10 files from `pkg2` on the other. The same match set came back on both. Small single-block directories also changed order. tmpfs gave a third order. |
| GNU `grep -r` sorts its output | It does not. gnulib fts is called with no comparison function, so the output follows `readdir` order. |

## 4. Projection to the full study

The 48 downloaded shards (10 GB) hold 106,988 trajectories on 38,663 tasks.

**From the sample rates** (0.15 candidates per trajectory × 98% replayable × 90% agree × 94% overflow × 40% evidence-bearing):

| Trajectories used | Evidence-bearing overflowing calls | File-level misses at 10% |
|---|---:|---:|
| 5,040 (this sample) | about 250 | about 25 |
| 106,988 (all local shards) | about 5,300 | about 500 |

**Cost on the Mac:**
- The replay of 240 calls took 13.5 minutes and 10 GB of checkouts. That is about 3.4 s and 43 MB per call. Most of the time is the git fetch.
- All local shards give about 16,000 candidate calls on fewer distinct commits. With checkouts grouped by commit and deleted after use, that is about 10–15 hours of network-bound work.
- This fits inside the 3-day machine budget.

**Caveats:**
- **The rates are file level.** The plan's L1 labels are at record level (the hunks of the gold patch). Record-level misses will be more frequent than file-level misses.
- **The edit detector is not validated yet.** It treats shell writes (`sed -i`, `> file`, `tee`, `patch`) as edits, and it ignores `/tmp`.
- **Calls cluster by task and repository.** About 15 trajectories share each task, so the confidence intervals need cluster bootstrap. The interval above ignores clustering, so it is too narrow.

## 5. Changes this suggests for the plan

1. Use all local shards (about 107k trajectories), not 5k. Parsing all of them takes minutes.
2. Restrict the main replay to SWE-rebench-V2, or read the HEAD of each Scale-SWE image first. Report the source as a stratum.
3. Treat multi-grep commands as a later yield lever. Without it, half the pool is lost.
4. The Gate A threshold (about 5%) sits inside the current interval (4–22%). The full run decides it. This sample does not.
