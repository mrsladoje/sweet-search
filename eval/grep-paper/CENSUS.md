# Census E0 on all local trajectories (2026-10-20)

**Result.** The 48 local shards hold 106,988 trajectories with 2,121,108 grep-family calls (19.8 per
trajectory). 17,578 calls are eligible and had their visible output cut. The agent's own `head` made
97.8% of these cuts. Basic-regex `\|` alternation appears in 34.7% of file-searching calls, `-l` in 7.5%,
`-E` in 2.3%, `-c` in 1.9% and `-o` in 0.5%. The edit detector (v3) agrees with a blind hand check on
48 of 50 fresh dev trajectories (96%); its two errors stop early, which is the safe direction.

Code: `mine/census.py` (parser run), `mine/census_report.py` (tables), `mine/edit_check_sample.py`
(edit-detector check), commit 9977bd35. Data: `~/.ss-eval/grep-paper/census/` (not in git).

## Method

- Parser: `mine/traces.py` on every row of the 48 shards (24 strata: harness × model × task source,
  2 shards each). Parsing took 85 s with 6 processes.
- Split (final rule): a repository is dev if it is in `mine/inspected_repos.txt`, else dev if
  sha256("42:" + repo) maps below 0.6, else held-out. Held-out trajectories add to aggregate counters
  only. All per-call files (candidates, patches, first edits, counts) hold dev repositories only.
- Eligible call (§3.2 rules 1–3 plus several files): before the first edit; searches files (first command
  of its pipeline, or fed by `find | xargs`); `-r`, `xargs` or 2+ path operands; the only grep of its
  command. Rules 4–5 (paths under the repository root, the pipeline parses) are applied in the replay.
- Flag shares count each flag once per call; a cluster such as `-rn` counts as `-r` and `-n`.

## Edit-detector check (§3.2 rule 1, step S1)

Each check drew 50 dev trajectories (stratified by harness), rendered their tool calls without the
detector's answer, and asked a blind annotator for the first step that modifies the repository. The
annotator was Claude Sonnet (two instances of 25 trajectories each), not a person. Accuracy = the first-
edit step is exactly the same.

| Detector | Sample | Exact | Errors |
|---|---|---:|---|
| v1 (the yield-check detector) | A, seed 42 | 43/50 (86%) | 6 early: `create` on files outside the repository (`/workspace/x.java`, `/tmp`), a relative write after `cd /tmp`; 1 late: Python `write_text` |
| v2 (target must be in the repository) | B, seed 43, fresh | 42/50 (84%) | 6 early: the word `patch` inside a grep pattern, `sed -i` on a `/tmp` file, `cd /tmp && cd repro`; 2 late: `cp` into the repository |
| **v3** (command position, quoted strings blanked, cd chain resolved, `cp`/`mv`) | **C, seed 44, fresh** | **48/50 (96%)** | 2 early: a write to a second directory under `/workspace`; one heredoc case |

- v2 and v3 were changed after the errors of the previous sample. Each new version was then measured on
  a fresh sample that it had not seen. Only the sample-C number is an out-of-sample estimate for v3.
  In-sample, v3 gets 47/50 on A and 49/50 on B.
- Wilson 95% interval for 48/50: 87–99%.
- Known limit: a script written to `/tmp` and run later can edit the repository. The detector does not
  see that edit, so it can stop late. None of the 50 sample-C trajectories showed this.
- The census, the candidate list and the dev replay all use v3. The yield check and the 40 agent-check
  states used v1.

## 1. Calls by harness, model and task source (all repositories, aggregates)

### By harness

| Group | Trajectories | Tool calls / traj. | Shell calls / traj. | Grep calls | Grep / traj. | Search files | Before first edit | Piped to head |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| minisweagent | 28,714 | 58.6 | 58.6 | 557,217 | 19.4 | 66.2% | 44.1% | 52.6% |
| openhands | 42,859 | 64.4 | 44.3 | 706,900 | 16.5 | 63.0% | 43.3% | 49.5% |
| sweagent | 35,415 | 84.9 | 60.9 | 856,991 | 24.2 | 60.7% | 38.6% | 50.4% |
| **All** | 106,988 | 69.6 | 53.6 | 2,121,108 | 19.8 | 62.9% | 41.6% | 50.7% |

### By model

| Group | Trajectories | Tool calls / traj. | Shell calls / traj. | Grep calls | Grep / traj. | Search files | Before first edit | Piped to head |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| deepseek_v4_flash_0731 | 8,953 | 41.6 | 35.2 | 104,656 | 11.7 | 64.0% | 49.9% | 45.2% |
| minimax_m25 | 10,000 | 68.1 | 43.1 | 83,784 | 8.4 | 71.0% | 43.7% | 36.5% |
| qwen35_122b | 10,000 | 111.4 | 77.6 | 331,498 | 33.1 | 58.6% | 33.1% | 55.9% |
| qwen36_27b | 27,879 | 72.7 | 52.6 | 407,821 | 14.6 | 63.1% | 38.9% | 44.3% |
| qwen38_27b | 26,941 | 69.3 | 57.1 | 707,018 | 26.2 | 61.3% | 45.6% | 48.1% |
| qwen38_flash_next | 23,215 | 59.8 | 52.0 | 486,331 | 20.9 | 66.5% | 41.8% | 59.9% |
| **All** | 106,988 | 69.6 | 53.6 | 2,121,108 | 19.8 | 62.9% | 41.6% | 50.7% |

### By task source

| Group | Trajectories | Tool calls / traj. | Shell calls / traj. | Grep calls | Grep / traj. | Search files | Before first edit | Piped to head |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| scale-swe | 42,772 | 56.5 | 44.6 | 607,377 | 14.2 | 67.4% | 48.9% | 47.4% |
| swe-rebench-v2 | 64,216 | 78.4 | 59.6 | 1,513,731 | 23.6 | 61.2% | 38.7% | 52.0% |
| **All** | 106,988 | 69.6 | 53.6 | 2,121,108 | 19.8 | 62.9% | 41.6% | 50.7% |

## 2. Eligibility funnel by task source (all repositories, aggregates)

| Step | scale-swe | swe-rebench-v2 | All |
|---|---:|---:|---:|
| Trajectories | 42,772 | 64,216 | **106,988** |
| Grep-family calls | 607,377 | 1,513,731 | **2,121,108** |
| Search files (not a stdin filter) | 409,125 | 925,749 | **1,334,874** |
| … and before the first edit | 230,467 | 440,489 | **670,956** |
| … and several files (`-r`, `xargs`, 2+ paths) | 127,529 | 249,717 | **377,246** |
| … and the only grep of the command (eligible) | 57,410 | 125,724 | **183,134** |
| Eligible, visible output cut | 4,886 | 12,692 | **17,578** |
| … cut by the agent's head | 4,756 | 12,442 | **17,198** |
| … cut by a harness limit | 130 | 250 | **380** |
| Trajectories with at least one eligible cut call | 4,129 | 9,729 | **13,858** |
| Eligible cut calls per trajectory | 0.114 | 0.198 | 0.164 |

### Same funnel, by harness (all repositories)

| Step | minisweagent | openhands | sweagent | All |
|---|---:|---:|---:|---:|
| Trajectories | 28,714 | 42,859 | 35,415 | **106,988** |
| Grep-family calls | 557,217 | 706,900 | 856,991 | **2,121,108** |
| Search files (not a stdin filter) | 369,117 | 445,578 | 520,179 | **1,334,874** |
| … and before the first edit | 190,047 | 232,943 | 247,966 | **670,956** |
| … and several files (`-r`, `xargs`, 2+ paths) | 105,805 | 133,049 | 138,392 | **377,246** |
| … and the only grep of the command (eligible) | 45,759 | 65,168 | 72,207 | **183,134** |
| Eligible, visible output cut | 4,512 | 6,048 | 7,018 | **17,578** |
| … cut by the agent's head | 4,381 | 5,895 | 6,922 | **17,198** |
| … cut by a harness limit | 131 | 153 | 96 | **380** |
| Trajectories with at least one eligible cut call | 3,666 | 4,973 | 5,219 | **13,858** |
| Eligible cut calls per trajectory | 0.157 | 0.141 | 0.198 | 0.164 |

## 3. Truncation policy and head limits (all repositories)

- Eligible cut calls: 17,578. The agent's `head` cut 17,198 (97.8%); a harness limit cut 380 (2.2%).
- On eligible cut calls, a gold-patch file is visible (trace text, file level, rough) in 5,576 (31.7%).
- Grep calls piped to `head`/`tail`: 1,075,249 of 2,121,108 (50.7%).

| Limit N | Grep calls with head -N | Share | Eligible cut calls with this N |
|---:|---:|---:|---:|
| 20 | 323,305 | 30.1% | 4,649 |
| 10 | 261,633 | 24.3% | 3,522 |
| 30 | 150,004 | 14.0% | 2,821 |
| 40 | 104,892 | 9.8% | 1,983 |
| 5 | 71,328 | 6.6% | 2,270 |
| 50 | 42,175 | 3.9% | 1,085 |
| 60 | 40,329 | 3.8% | 602 |
| 3 | 16,871 | 1.6% | 81 |
| 80 | 16,496 | 1.5% | 192 |
| 100 | 6,254 | 0.6% | 80 |
| 15 | 6,250 | 0.6% | 11 |
| 25 | 5,079 | 0.5% | 6 |

## 4a. Flags and pattern forms on file-searching calls (all repositories)

Base: 1,334,874 file-searching grep-family calls. A flag counts once per call; clusters such as `-rn` count as `-r` and `-n`.

| Form | Calls | Share |
|---|---:|---:|
| `-n` | 1,006,535 | 75.4% |
| `-r` | 541,103 | 40.5% |
| basic-regex `\|` alternation (grep without -E/-F/-P) | 462,738 | 34.7% |
| `--include` | 222,630 | 16.7% |
| `-A` | 186,061 | 13.9% |
| `-l` | 99,630 | 7.5% |
| `-B` | 67,397 | 5.0% |
| `-E` | 30,939 | 2.3% |
| `-i` | 26,284 | 2.0% |
| `-c` | 24,919 | 1.9% |
| bare `|` in the pattern | 24,669 | 1.8% |
| `-o` | 6,057 | 0.5% |
| `-h` | 3,281 | 0.2% |
| `--exclude-dir` | 3,054 | 0.2% |
| `-v` | 2,996 | 0.2% |
| `-a` | 1,738 | 0.1% |
| `-P` | 1,640 | 0.1% |

**Coverage estimate (flags only):** 1,323,215 of 1,334,874 file-searching calls (99.1%) use only flags that ss-grep accepts on branch `grep-flag-coverage`. This counts flags, not patterns, paths or pipelines, and it includes `rg` and `git grep` calls under their own flag letters.

## 4b. Flags and pattern forms on file-searching calls (dev repositories only)

Base: 813,218 file-searching grep-family calls. A flag counts once per call; clusters such as `-rn` count as `-r` and `-n`.

| Form | Calls | Share |
|---|---:|---:|
| `-n` | 611,650 | 75.2% |
| `-r` | 335,296 | 41.2% |
| basic-regex `\|` alternation (grep without -E/-F/-P) | 282,646 | 34.8% |
| `--include` | 138,223 | 17.0% |
| `-A` | 113,871 | 14.0% |
| `-l` | 63,803 | 7.8% |
| `-B` | 41,188 | 5.1% |
| `-E` | 18,741 | 2.3% |
| `-i` | 15,849 | 1.9% |
| bare `|` in the pattern | 14,991 | 1.8% |
| `-c` | 14,778 | 1.8% |
| `-o` | 3,699 | 0.5% |
| `-h` | 1,969 | 0.2% |
| `--exclude-dir` | 1,930 | 0.2% |
| `-v` | 1,692 | 0.2% |
| `-a` | 1,008 | 0.1% |
| `-P` | 968 | 0.1% |

**Coverage estimate (flags only):** 806,291 of 813,218 file-searching calls (99.1%) use only flags that ss-grep accepts on branch `grep-flag-coverage`. This counts flags, not patterns, paths or pipelines, and it includes `rg` and `git grep` calls under their own flag letters.

## 5. Eligible dev calls: independent units (dev repositories only)

| Source | Kind | Calls | Trajectories | Tasks | Repositories |
|---|---|---:|---:|---:|---:|
| scale-swe | all | 35,455 | 15,429 | 8,131 | 583 |
| scale-swe | cut | 2,890 | 2,445 | 1,952 | 290 |
| scale-swe | uncut | 32,565 | 14,918 | 7,998 | 581 |
| swe-rebench-v2 | all | 78,027 | 25,373 | 11,104 | 1,532 |
| swe-rebench-v2 | cut | 7,851 | 5,963 | 4,221 | 1,009 |
| swe-rebench-v2 | uncut | 70,176 | 24,507 | 10,963 | 1,531 |

## Notes for the paper

- **Coverage of ss-grep.** The flag-only estimate (99.1%) is an upper bound for the share of calls that
  ss-grep can answer itself on branch `grep-flag-coverage`. It does not check patterns, path forms,
  pipelines or the `\|` reading rule.
- **Parser check (exact argv, dev eligible calls).** `mine/coverage.mjs` runs the pure parse steps of
  `cmdGrep` (`_ss-argparse.mjs`) on the argv of the 113,475 eligible dev grep calls. Main accepts 26,821
  (23.6%); it rejects mostly flag bundles such as `-rn` (63,751 calls) and `-l` (18,256). Branch
  `grep-flag-coverage` (85a63c6b) accepts 113,276 (99.8%). "Accepts" means no usage error; it does not
  check the output. The shadow check on the branch covers the output (0 byte differences on 115 calls).
- **Full-output size** and **the share of matching files that survive each cut** (the travelling figure)
  come from the replay (S2), not from the traces.
- SWE-bench/experiments (frontier models) is not in this census yet.
- Trajectories per task and the deduplication counts (one trajectory per task, harness and model) are
  reported with the replay, where they matter for the rates.
