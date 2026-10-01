# New task runs for the forensic study (prepared 2026-10-01, NOT launched)

**Conclusion.** The batch is ready to start, but it cannot start yet. Three things block it: the retrieval benchmark is still running, 11 of 20 task images are not on the Mac, and 14 of 20 tasks have no green ledger entry. Fix them in the order in section 6. No model call was made. No rule file outside this worktree changed.

## 1. What exists now

| Item | Path | State |
|---|---|---|
| Launcher (one script, all modes) | `core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh` | new, uncommitted |
| This document | `core/prompt-optimization/data/final-tuning/forensics/NEW-TASK-RUNS.md` | new, uncommitted |
| Codex private-home switch | `eval/task-completion-bench/harness/codex-task-runner.mjs` (+13 / -1 lines, `SS_CODEX_PRIVATE_HOME=1`) | edited, uncommitted, default off (section 7, item 2) |
| Generated inputs | `eval/task-completion-bench/results/fr-specs.json`, `fr-tasks.tsv`, `fr-ledger-merged.jsonl` | ignored by git; the script rebuilds them |

Another session already uses the `forensics/` folder (`build_dossiers.py`, `fx_lib.py`). I did not touch those files.

## 2. Models and harness settings

The hill-climb did **not** use Sol. Every hill-climb Codex and opencode cell used `openai/gpt-5.6-luna` through OpenRouter, effort medium, with Codex 0.146.1 and opencode 1.18.4. Evidence: the `rows.json` files in `results/hc-codex-*` (420 rows) and `results/hc-opencode-*` (541 rows). Sol (`gpt-6.1-sol`, high) comes from the retrieval benchmark (`r282-PREREG.md`). No task-bench run ever used it.

| Leg | CLI | Model | Effort | Billing | Product settings (all switches unset) |
|---|---|---|---|---|---|
| Claude Code | 2.1.281 | `claude-opus-5-5` | medium | Claude subscription token | `CC_HARNESS_TRIM=product` (stamp `product+batch-read6fs`) |
| Codex | 0.159.2 | `openai/gpt-6.1-sol` | high | ChatGPT subscription (`CODEX_SUBSCRIPTION=1`) | default trim `instructions-conflict+batch-yt3batch2`, rules in `developer_instructions` |
| opencode | 1.18.4 | `openai/gpt-5.6-luna` (as in the hill-climb) | medium | OpenRouter, metered cash | default trim `conflict3+todo3eff3k:...`, rules in `instructions` |

- The launcher unsets every `SS_VARIANT_*` variable, every `CC_*`, `CODEX_*`, `OC_*` trim variable, `SWEET_RULES_PLACEMENT`, `MPP` and `MAX_TOOL_CALLS`. It keeps the two validity fixes (`BENCH_INCLUDE_UNTRACKED=1`, `RT_ATTACH_REQUIRE_SAME_DIFF=1`) that every cell since 2026-09-29 uses. Do not pool these rows with older runs.
- The task runner has no subscription path for opencode. Sol on opencode would cost cash (`FR_OC_MODEL=openai/gpt-6.1-sol`; price is registered; untested).
- No tool-call cap applies to the three CLI runners. The only limit is the agent timeout. The launcher raises it from 30 to 60 minutes so long trajectories finish (`FR_AGENT_TIMEOUT_MS`). The opencode hill-climb cells reached 27 minutes.

## 3. The 20 tasks

Pools: DEV-RET (`select/tasks_heldout.jsonl`, the retired held-out 200, now development data) and dev-200 (`select/tasks_multilingual.jsonl`). The script reads only `select/.cache/tasks_full_multilingual.json` and `tasks_full_heldout.json`. No file named `tasks_heldout2*` was opened, listed or searched. Result folders with `ho2` in the name were skipped.

**Where the length evidence comes from.** Only 41 development tasks have any local history. Sources: `results/*/rows.json` (13 tasks) and the committed row archives under `handoffs/improve/*/` (slate-c smoke, ladder, rebaseline, clause). For the 12 tasks without Opus data, the call counts are from Luna runs on all three harnesses. Opus and Sol will behave differently. The "tail" mark means the task is in the top 20 percent by turns in the retired held-out run on Grok 4.5 with opencode (boundary 52 turns, `select/MANIFEST_turnfix_cohorts.json`). Four tasks have only the tail mark and no counts.

| # | Task | Lang | Repo | Calls mean / max | Solve rate | Rollouts | Tail | Image | Golden (size) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `intel__rohd-458` | dart | intel/rohd | 34.1 / 81 | 0% | 18 | yes | PULL 0.43 GB | vault 127M |
| 2 | `jensneuse__graphql-go-tools-174` | go | jensneuse/graphql-go-tools | 32.9 / 122 | 71% | 56 | | tar 1.1 GB | local 220M |
| 3 | `singapore__renovate-1153` | js | singapore/renovate | 31.6 / 93 | 0% | 18 | | PULL 1.16 GB | vault 60M |
| 4 | `rstudio-education__gradethis-161` | r | rstudio-education/gradethis | 30.7 / 75 | 69% | 45 | | PULL 1.10 GB | vault 32M |
| 5 | `getmoto__moto-6716` | python | getmoto/moto | 28.8 / 77 | 83% | 18 | yes | PULL 0.95 GB | vault 1.1G |
| 6 | `gitbookio__markup-it-56` | js | GitbookIO/markup-it | 27.3 / 234 | 3% | 38 | | tar 1.1 GB | local 37M |
| 7 | `chaijs__chai-990` | js | chaijs/chai | 25.0 / 68 | 0% | 18 | | PULL 1.18 GB | vault 67M |
| 8 | `yargs__yargs-1422` | js | yargs/yargs | 24.1 / 39 | 0% | 18 | | PULL 1.13 GB | vault 61M |
| 9 | `ember-cli__eslint-plugin-ember-551` | js | ember-cli/eslint-plugin-ember | 20.1 / 85 | 91% | 241 | | loaded + tar | local 67M |
| 10 | `rokucommunity__brighterscript-1050` | ts | rokucommunity/brighterscript | 20.0 / 195 | 0% | 195 | yes | loaded + tar | local 229M |
| 11 | `joshuakgoldberg__bingo-271` | ts | JoshuaKGoldberg/bingo | 19.9 / 141 | 0% | 253 | | loaded + tar | local 57M |
| 12 | `mirumee__ariadne-codegen-223` | python | mirumee/ariadne-codegen | 19.0 / 42 | 0% | 18 | | PULL 0.80 GB | vault 74M |
| 13 | `teleporthq__teleport-code-generators-291` | ts | teleporthq/teleport-code-generators | 16.6 / 47 | 36% | 45 | | PULL 1.23 GB | vault 63M |
| 14 | `smooth-code__svgr-10` | js | smooth-code/svgr | 16.1 / 153 | 19% | 174 | yes | loaded + tar | local 6M |
| 15 | `mwouts__jupytext-360` | python | mwouts/jupytext | 13.6 / 82 | 0% | 177 | | loaded + tar | local 139M |
| 16 | `superlistapp__super_editor-2516` | dart | superlistapp/super_editor | 14.2 / 70 | 99% | 247 | | loaded + tar | local 760M |
| 17 | `pytask-dev__pytask-210` | python | pytask-dev/pytask | 11.4 / 38 | 31% | 84 | | tar 0.8 GB | local 61M |
| 18 | `aio-libs__aiohttp-8038` | python | aio-libs/aiohttp | no counts | no data | 0 | yes | PULL 0.93 GB | vault 232M |
| 19 | `suzuki-shunsuke__tfcmt-1257` | go | suzuki-shunsuke/tfcmt | no counts | no data | 0 | yes | PULL 0.96 GB | vault 24M |
| 20 | `yelp__bravado-core-154` | python | Yelp/bravado-core | no counts | no data | 0 | yes | PULL 0.80 GB | vault 39M |

Reserves, used in this order when a primary task is not ready: `fastify__fastify-cors-285` (js, 10.7 / 88, 0%, loaded + tar, green now), `vazco__uniforms-787` (ts, 19.5 / 59, 94%, PULL 1.35 GB), `python-markdown__markdown-1294` (python, 12.4 / 18, 78%, PULL 0.76 GB), `hotmeteor__spectator-181` (php, tail, PULL 0.83 GB), `sqlkata__querybuilder-557` (csharp, 21.0 / 50, 0%, PULL 1.36 GB).

Mix: 6 python, 6 js, 3 ts, 2 go, 2 dart, 1 r. Four tasks sit inside the 20-80% solve band (`graphql-go-tools-174`, `gradethis-161`, `teleport-code-generators-291`, `pytask-210`). Two sit at its edge (`svgr-10` 19%, `moto-6716` 83%). Eight have 0%, three have no data, and three are at 3%, 91% and 99%. The data has few tasks that are both long and mid-range, so the list leans on length, as asked. Tasks 1-8 have the highest call counts. Tasks 15-17 are shorter. They stay for language spread and for their Opus 5.5 history.

**Caveats that change how to read the trajectories.**
- `jensneuse__graphql-go-tools-174` and `getmoto__moto-6716` had `run_tests` verdicts that the harness marked untrusted in every rollout of the 2026-09-02 smoke (`SMOKE-RESULTS.md`). The Mac smoke rows of 2026-09-25 to 09-27 (`results/hsmoke-*`) show the same for graphql-go-tools-174: 0 trusted verdicts in all 24 rollouts (Codex 6, opencode 8, Claude Code 10). Its trajectories are long partly because the agent cannot trust its test result. Treat that length as environment length. No Mac data exists for moto-6716.
- `jupytext-360` has 33 target tests. It stays on the list as a judgement call (`select/task-gates.json` says so).

**Filters applied (all measured today, $0).**

| Filter | How | Result |
|---|---|---|
| Pool and HO2 | two dev cache files only | 400 tasks considered; HO2 never opened |
| Local golden | `~/.ss-eval/golden` or `~/.ss-eval/vault/golden` | 133 dropped (no golden; all 200 DEV-RET goldens exist, only 67 of dev-200) |
| Blocklist | `harness/task-blocklist.json` | 4 dropped |
| `excludeFromAgentRuns` | `harness/task-overrides.json` | 1 dropped |
| Vacuity pre-screen | `vacuityBlocklist()` from `task-admission.mjs` | 12 dropped (19 flagged in all 400) |
| F2P/P2P gate | `gateViolations()` with `select/task-gates.json` | 71 dropped (120 violations in all 400) |
| Box-built image override | `task-overrides.json` `image` field (warm and fixed images are not on this Mac) | 34 dropped |
| Name lock | `select/stamp-name-lock.mjs --report-only` on the 38 shortlisted tasks | locked: `zod-openapi-330`, `apigee__registry-994`, `dailycodingproblem-go-117`; `dart-lang__http-1114` and `bingo-274` are locked by earlier census (memory) |
| Index freshness | `handoffs/improve/slate-c/fixes/golden-rebuild-need.mjs` on the 38 | see below |
| Mac gold grade | Mac ledgers 2026-09-25/29 | `underscore-2757`, `codeceptjs-367`, `firebase-tools-2933`, `swift-nio-http2-145` failed the offline gold grade on this Mac; dropped |

The first six filters leave 145 candidates. Tasks whose golden index needs a rebuild were left out, so the batch needs no index build: `unexpectedjs__unexpected-571` (the longest on record, 61.5 calls), `sap__luigi-3946`, `stingray-324`, `devlooped__moq-1259` and `-1262`, `humbug__php-scoper-1027`, `rrd108__vue-mess-detector-129`, `zestedesavoir__zmarkdown-248`. A rebuild takes one serial ORT INT8 index run per repo (about 7-17 minutes, only when no ss-* daemon runs; see `project_golden_rebuild_local_mac`). `bingo-271` shows REBUILD, which memory records as a known false alarm.

## 4. Images

- Loaded now: 6 of the 20 (`eslint-ember-551`, `brighterscript-1050`, `bingo-271`, `svgr-10`, `jupytext-360`, `super_editor-2516`), all with kept tars. 3 more have tars that are not loaded: `graphql-go-tools-174`, `markup-it-56`, `pytask-210` (`~/.ss-eval/image-tars-smoke3`). The launcher loads them.
- **11 primary images must be pulled: 10.67 GB compressed.** Reserves add 4 more: 4.30 GB. Total 14.97 GB. Sizes come from the Docker Hub manifests (checked on 2026-10-01 for the 15 images and 11 others I considered; every image exists). The download time depends on the link; I did not measure it.
- The Colima VM cannot reach Docker Hub blobs. The launcher uses the host-side tool `host_pull.py`, which writes a tar into `~/.ss-eval/image-tars-forensic/`. The launcher then loads the tar with `docker load`.
- **Disk.** The VM has 15-16 GB free on `/var/lib/docker` (84% used). Each loaded task image needs 3-4 GB. The launcher therefore loads only the images of the next cell, and it evicts tar-backed images the cell does not need. It never removes an image that has no tar. After a cell it unloads the images it loaded (`FR_KEEP_IMAGES=1` disables this). Old `swebench/*` images (13 images, about 20 GB unique) and 54 stopped containers (6.4 GB) also sit in the VM. I did not touch them.

Commands (run from `/Users/admin/Projects/sweet-search-final-tuning`):

```
FR_DRY=1 bash core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh pull   # prints the 15 pull commands
bash core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh pull            # network only; no ss-* daemon needed
bash core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh stage           # cp -a 15 vault goldens (about 2.2 GB) into ~/.ss-eval/golden
```

## 5. Green ledger

- Green now: 7 tasks (`eslint-ember-551`, `brighterscript-1050`, `bingo-271`, `svgr-10`, `jupytext-360`, `super_editor-2516`, and reserve `fastify-cors-285`). Evidence: `run-pilot` `PREFLIGHT_ONLY=1` from this worktree, ledger `results/bsmoke-ledger-fix5/ledger.jsonl` (main checkout, swept 2026-09-29 23:18).
- No current entry: the other 14 primary tasks and 4 reserves. `graphql-go-tools-174`, `markup-it-56` and `pytask-210` had a gold-valid Mac entry on 2026-09-25 (`results/ledger-trim-mac-20260925c`), but its hash is stale.
- The ledger fingerprint does not depend on the harness. One sweep serves all three legs.
- **I did not run the sweep.** It is gold-only and needs no model, but the retrieval benchmark (pid 86191, `retrieval-bench-282.mjs`) and 10 ss-* processes (`sweet-search-daemon`, `sweet-search-maintainer`) are alive. The launcher refuses to sweep while they live.

Sweep command (loads each image from its tar, grades the gold patch under `--network none`, appends to `results/fr-ledger/ledger.jsonl`, resumable):

```
FR_DRY=1 bash core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh sweep   # prints the commands
bash core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh sweep
bash core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh plan             # every task should read "ok"
```

The raw form of one step: `node harness/env-ledger-sweep.mjs --tasks results/fr-specs.json --ids <file with one id> --out results/fr-ledger --batch 1 --max-workers 1` with `DOCKER_HOST`, `SR_EVAL_DIR`, `TMPDIR` set as in `TASK-GUARD.md`. Estimated time: 14 tasks at 20-250 seconds of grading each, so about 25-50 minutes (estimate from the confirm10 grade times).
**Risk.** The 11 new primary tasks passed the gold grade on the Linux box, not on this Mac. On 2026-09-26 the Mac graded 24 candidate tasks offline: 12 passed and 12 failed (network need, slow grade; `results/confirm10/README.md`). Among the five languages of the new tasks (js, ts, python, go, dart) 12 of 18 passed. So I expect 3 to 5 of the 15 unproven tasks (11 primary, 4 reserve) to fail. The reserves cover part of that. The batch can end at 17 to 19 tasks. The launcher takes the next reserve for each failure and refuses to start with fewer than `FR_MIN=16` ready tasks.

## 6. Launch order

1. Wait until `pgrep -f retrieval-bench-282.mjs` is empty and no `sweet-search-daemon` or `sweet-search-maintainer` runs.
2. `forensic-runs.sh pull`, then `stage`, then `sweep`, then `plan`. Expect at least 16 tasks "ok".
3. Run one leg at a time, never two pilots together. `FR_DRY=1` first prints the commands.

```
cd /Users/admin/Projects/sweet-search-final-tuning
S=core/prompt-optimization/data/final-tuning/scripts/forensic-runs.sh
FR_DRY=1 bash $S claudecode          # $0: print the 5 cell commands
bash $S claudecode                   # Opus 5.5 medium, Claude subscription
bash $S codex                        # Sol high, ChatGPT subscription
bash $S opencode                     # Luna medium, OpenRouter cash
```

The first run writes `results/fr-batch.ids`. The other two legs reuse it, so all three harnesses run the same tasks. Delete the file to choose again. Resume after a usage-limit stop: same command with `FR_STAMP=<stamp>`.

| Leg | Wall time (estimate) | Subscription / cost |
|---|---|---|
| Claude Code | 25-40 min per cell, 5 cells, 2-3 h | Claude Max plan, shared with the loop session. About $8-20 API-equivalent. No cash. |
| Codex + Sol high | 25-45 min per cell, 2-4 h | ChatGPT subscription. About $4-12 API-equivalent. No cash. |
| opencode + Luna | 25-40 min per cell, 2-3 h | OpenRouter cash, about $0.5-2 (hill-climb mean $0.014 per short rollout). |

The wall times are my estimates. No run exists for these long tasks. Basis: hill-climb cells of 4-6 short tasks had a median wall of 3.9 (Claude Code), 5.0 (Codex) and 7.3 (opencode) minutes; these tasks use 2-4 times more calls, and each cell adds image load, golden copy and grading. Cells hold 4 tasks (`FR_CONC`).

After each cell, check `harnessTrim`, `exitReason` and `calls` before any analysis. A row with `calls=0` is an infrastructure failure, not a result. The script prints one line per rollout at the end.

## 7. Blockers and risks

1. **Retrieval benchmark and ss-* daemons are alive.** The launcher refuses to start. Same for the sweep.
2. **Codex on this Mac reads the owner's personal setup.** I proved it with a fake `codex` binary (no model call). Without a fix, the rollout runs with the real `HOME`, so it loads `~/.codex/config.toml` (MCP servers `alphaxiv`, `openalex`, `node_repl`, `openaiDeveloperDocs`, a `notify` hook), `~/.codex/AGENTS.md` (the reply-style rule) and 39 skills in `~/.agents/skills`. The runner only avoids this for non-subscription runs. I added an opt-in switch, `SS_CODEX_PRIVATE_HOME=1`, which the launcher sets. With it, the fake binary saw a private `HOME` and `CODEX_HOME` holding only `auth.json` (mode 600), `installation_id` and a minimal `config.toml`. Default behaviour is unchanged. The change is not tested with a real model. Run the first Codex cell as the smoke test and read its row stamps.
3. **Codex login may expire.** `~/.codex/auth.json` has `last_refresh` 2026-09-25 (5 days old). The access token is valid until 2026-10-06 01:24. This runner never writes a refreshed token back. If codex refreshes during a 4-task cell, the tasks race on one single-use refresh token and every rollout fails with 0 calls. The launcher refuses a login older than 7 days (`FR_ALLOW_STALE_AUTH=1` overrides). The 8-day refresh interval is my recollection; I did not verify it.
4. **Codex 0.159.2 with Sol is new to the task runner.** The runner was written for 0.146.1. The price key `openai/gpt-6.1-sol` exists in `harness/ideal-cost.mjs`. I could not test the rollout parsing without a model call.
5. **opencode has no subscription path.** The opencode leg spends OpenRouter cash and needs `OPENROUTER_API_KEY` (present in the environment).
6. **Shared VM.** Colima has 4 CPUs and 8 GiB. `semantic-os` and the `sensortracker-*` containers (15, per `TASK-GUARD.md`) share it. About 4.2 GiB of memory was free on 2026-10-01. Four emulated test containers run at once in a cell; use `FR_CONC=3` if memory runs low.
7. **Uncertain Mac grading for 15 new tasks (11 primary, 4 reserve).** See section 5. Kept tar files mean no second pull.
8. **History is mostly Luna.** The lengths in section 3 come from Luna runs for 12 tasks. Opus and Sol may run shorter or longer.
9. **The Claude subscription is shared.** The loop session uses the same plan. A usage-limit stop is expected to need a resume.
10. Edits are uncommitted by instruction: the launcher, this file, and the Codex switch.

## 8. What I checked

All checks cost $0 and made no model call.
- `run-pilot` preflight per task: 7 of 25 pass today. The other 18 fail for a missing ledger entry and, for 15 of them, also a missing local golden. This matches sections 4 and 5.
- `forensic-runs.sh plan` (about 11 s) and `FR_DRY=1` for `pull`, `stage`, `sweep` and all three legs (5 cells each, full `env ... node harness/run-pilot.mjs` lines).
- The real (non-dry) `codex`, `claudecode`, `opencode` and `sweep` modes refused to start with the message "the final-tuning retrieval queue is running".
- Fake-`codex` capture of the private-home switch (on and off), as described in section 7, item 2.
- Docker Hub manifests for the 15 images to pull and 11 others (sizes in section 3); name-lock report on 38 tasks; `golden-rebuild-need.mjs` on 38 goldens.
