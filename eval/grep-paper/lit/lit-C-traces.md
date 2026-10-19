# Lit-C: public agent trajectory datasets for grep replay (scouted 2026-10-19)

Samples: `scratchpad/traces-sample/` (HF datasets-server rows, 10-25 rows per offset, spread across each dataset).
Scripts: `scratchpad/scripts/{info,fetch,analyze,gold,s3probe}.py`. Raw tables: `traces-sample/analysis.txt`, `gold-analysis.txt`.
All dataset ids below were verified through the HF API (rows/licence from datasets-server `/size`, `/info`).
Ids that do NOT exist as named: `nebius/SWE-rebench-trajectories` (real: `nebius/SWE-rebench-openhands-trajectories`), `SWE-ZERO-12M` (real: `AlienKevin/SWE-ZERO-12M-trajectories`), `CoderForge` (real: `togethercomputer/CoderForge-Preview`). `tarsur385/swebench-verified-trajectories` exists (MIT) but datasets-server reports 0 rows (not usable via API).

## 1. Dataset catalogue

| Dataset | Rows | Licence | Harness / model | Repo + commit recoverable? | Tool output stored? | Gold patch? |
|---|---|---|---|---|---|---|
| nvidia/Open-SWE-Traces (cfg v1.0/1.1/1.2; splits openhands, sweagent, minisweagent) | 677,813 total (v1.0 151k, v1.1 263k, v1.2 263k) | cc-by-4.0 (repo licences MIT/Apache/BSD) | OpenHands 0.53, SWE-agent, mini-swe-agent; Qwen3.5/3.6/3.8, MiniMax M2.5, DeepSeek-V4-Flash (OpenCode/Claude Code splits "coming") | Yes. `instance_id` + `repo` + `hf_dataset_name` (AweAI-Team/Scale-SWE: has `parent_commit`; nebius/SWE-rebench-V2: has `base_commit`) | Yes (`tool` role) | **Yes, in-row**: `metadata.reference_patch.patch` |
| nvidia/SWE-Hero-openhands-trajectories | 34,269 | cc-by-4.0 | OpenHands; sources R2E-Gym-Subset + nebius/SWE-rebench | Yes via instance_id (`pandas-dev__pandas-<sha>` R2E style; rebench ids) | Yes | Only agent `model_patch`; gold via join |
| nvidia/SWE-Zero-openhands-trajectories | 318,115 | cc-by-4.0 | OpenHands, Qwen3-Coder-480B, execution-free (no test runs) | Yes via instance_id (SWE-Gym, SWE-Gym-Raw, R2E-Gym, SWE-Fixer-Train-110K, SWE-rebench) | Yes | agent patch only; gold via join |
| AlienKevin/SWE-ZERO-12M-trajectories | 12,290,800 (122,908 PRs, 3,222 repos, 16 languages) | apache-2.0 | execution-free rollouts, `trajectory_format` field | repo + instance_id | Yes (messages) | No |
| nebius/SWE-rebench-openhands-trajectories | 67,074 | cc-by-4.0 | OpenHands (Qwen3-Coder-480B / GLM class), `resolved` flag | Yes: `joke2k__faker-1480` ids join nebius/SWE-rebench (`base_commit`, `patch`) | Yes | agent patch; gold via join |
| nebius/SWE-agent-trajectories | 80,036 | cc-by-4.0 | SWE-agent (ACI text format), swe-agent-llama-70b | Yes (SWE-rebench ids) | Yes (`user` turns) | agent patch; gold via join |
| SWE-Gym/OpenHands-Sampled-Trajectories | 6,055 | none stated (SWE-Gym itself MIT) | OpenHands, GPT-4o/Claude class | Yes: SWE-Gym ids, `base_commit` in SWE-Gym | Yes | gold in SWE-Gym (`patch`) |
| SWE-bench/SWE-smith-trajectories | 76,002 (tool 24.1k, xml 26.1k, ticks 25.8k) | mit | SWE-agent, claude-3-7-sonnet (+others) | Synthetic bugs: `repo.<commit8>.<bugtype>__<id>`; repo mirror at commit in SWE-bench/SWE-smith | Yes | `patch` in-row; gold = synthetic bug reversal (not human fix) |
| togethercomputer/CoderForge-Preview | 826,556 (SWE_Rebench 77k, SWE_Smith 148k, R2E_Gym 33k, filtered_reward1 155k) | not in card; per-row `license` field | single scaffold (OpenHands-like), Qwen-class teacher | Yes via `trajectory_id`/`image` (`graphql-python__graphene-django-1477_run3`) | Yes (`messages` JSON string) | No (join) |
| togethercomputer/CoderForge-Preview-32B-SWE-Bench-Verified-Evaluation-trajectories | 500 | none | CoderForge-32B on SWE-bench Verified | Yes (Verified ids) | Yes | `output_patch` agent; gold from Verified |
| R2E-Gym/R2EGym-SFT-Trajectories | 3,231 | none | R2E agent | commit hash only in text | Yes | no |
| SWE-bench/experiments (GitHub, NOT HF) | 326 submissions: verified 182, lite 84, test 24, multimodal 22, multilingual 14 | **repo has no licence file** | 183 verified+lite and 15 test entries have `trajs` in S3 `s3://swe-bench-submissions/<split>/<entry>/trajs/` (public listing works over HTTPS, no creds). 119 verified, 64 lite, 15 test | Verified/Lite = SWE-bench ids (repo+base_commit in princeton-nlp datasets) | Yes but formats vary | Yes (SWE-bench) |
| ByteDance-Seed/Multi-SWE-bench_trajs | 321 files (zip per agent/model/language: c, c++, ...) | cc0-1.0 | MSWE-agent, MagentLess, MopenHands x ~12 models | Multi-SWE-bench ids | in zips | Multi-SWE-bench |
| AmazonScience/SWE-PolyBench(_500,_Verified) | benchmark only | - | no trajectories | - | - | - |
| Terminal-Bench traces (yoonholee/terminalbench-trajectories 52,104 rows apache-2.0; DCAgent etc.) | - | - | many harnesses | **No repo+commit**; self-contained docker tasks | yes | no |
| Claude Code traces (nlile/misc-merged-claude-code-traces-v1 32,133 rows; others) | - | none stated | real Claude Code | `source_repo` only, no commit usually | yes | `gitdiff` sometimes |

Notes
- Open-SWE-Traces removed git-hacking trajectories (08/26). Trajectories with `resolved` = 1/0/-1 flag.
- SWE-Zero / SWE-ZERO-12M are execution-free: the agent may not run tests, so 92% of its shell commands in my sample are grep/find. Good grep density, but unnatural vs real agents.
- SWE-agent ACI trajectories (nebius/SWE-agent-trajectories) use `search_dir/search_file/find_file` (323 calls in 80 trajs, 4.0/traj) and almost no real grep (0.14/traj). Their output format ("Found N matches", file counts) differs from grep.

## 2. Sampled grep statistics (my own counts, all rows)

Crude regex on shell commands. "grep-family" = grep/egrep/fgrep/rg/git grep anywhere in the command, so it includes pipeline filters (`pip list | grep x`, `find | grep -v`). `-v` counts (up to 30% of calls in mini-swe-agent) are mostly filter use, so strict file-search greps are about 70-80% of the numbers. "Output lines" is the output the agent saw (after any `| head` the agent itself wrote).

| Sample | Trajs | Shell cmds/traj | grep-family/traj | % trajs with >=1 | grep share of shell cmds | median / p90 / p99 output lines | >50 lines | >100 lines |
|---|---|---|---|---|---|---|---|---|
| Open-SWE-Traces mini-swe-agent (Qwen3.8-27B) | 180 | 55.6 | 15.2 | 98% | 27% | 4 / 11 / 95 | 3% | 1% |
| Open-SWE-Traces OpenHands (v1.1) | 100 | 38.2 | 10.0 | 98% | 26% | 9 / 44 / 132 | 8% | 2% |
| Open-SWE-Traces SWE-agent | 80 | 49.7 | 15.4 | 100% | 31% | 12 / 57 / 125 | 12% | 3% |
| nebius/SWE-rebench-openhands | 100 | 32.7 | 9.0 | 100% | 27% | 10 / 47 / 224 | 9% | 4% |
| SWE-Hero-openhands | 80 | 34.0 | 10.6 | 100% | 31% | 7 / 37 / 182 | 7% | 3% |
| SWE-Zero-openhands | 60 | 11.1 | 10.2 | 100% | 92% | 9 / 35 / 194 | 6% | 2% |
| SWE-Gym OpenHands-Sampled | 60 | 1.6 | 0.35 | 15% | 22% | n=21 | - | - |
| SWE-smith tool / xml / ticks | 60 each | 13.5 / 11.7 / 39.6 | 4.5 / 3.1 / 4.5 | 100 / 85 / 95% | 33 / 26 / 11% | 4 / 60 / 456 | 10-12% | 3-5% |
| CoderForge SWE_Rebench / SWE_Smith | 40 / 60 | 27 / 25 | 5.8 / 4.6 | 100% | 21 / 18% | 8 / 50 / 187 | 6-10% | 2-4% |
| nebius/SWE-agent-trajectories | 80 | 28 | 0.14 grep, 4.0 search_dir/file | 5% grep | - | - | - | - |

`find` appears at 0.5-3 calls/traj; `rg` essentially absent (1 call in 180+ trajs): the open-weight models/harnesses overwhelmingly use plain `grep`. `git grep` was never seen.

Shapes (mini-swe-agent sample, 2,738 calls; OpenHands similar): `-n` 75%, `-r/-R` 36%, `-v` 19% (filter use), `-E` 17%, `-i` 10%, `-l` 3-12%, `-A/-B/-C` context 3-30% (OpenHands/rebench/Hero use `-A 5`/`-B 5` heavily: `-A` on 25-33% of calls), `--include` glob 12-14%, piped to `head` 53% (mini) / 43% (OH) / 16% (rebench-OH), regex metacharacters (`\|`, `.*`, `[]`) on about 50%. Typical: `grep -rn "foo\|bar" /testbed/pkg --include="*.py" | head -20`, `cd /workspace/x__y__1.0 && grep -n "def foo" path/file.py`, `find . -name "*.py" -exec grep -l "foo" {} \;`. Path scoping: most calls name a subdirectory or a single file (`grep -n X file.py` is very common, so those outputs are small); whole-repo `grep -r X .` is the minority.

Consequence for the paper: output overflow is rare in the agents' own calls because agents self-truncate with `| head`. Only 3-12% of calls exceed 50 lines, 1-5% exceed 100 lines. A replay without the `| head` (or with head stripped) will show more overflow; decide that rule in advance and report it. A SWE-agent-style harness (Open-SWE-Traces sweagent) has the highest overflow (12% >50 lines).

### Gold-file reachability (Open-SWE-Traces only; gold in-row), approximate
Edit detection is a heuristic (str_replace_editor edits, `sed -i`, `cat >`, heredocs counted as edit).
| Split | grep calls | before first edit | pre-edit calls whose seen output names a gold-patch file | pre-edit outputs >50 lines | of those, with gold file |
|---|---|---|---|---|---|
| mini-swe-agent | 2,737 | 597 (22%) | 156 (26%) | 34 (6%) | 6 (gold first beyond line 50 in 1) |
| OpenHands | 1,000 | 354 (35%) | 89 (25%) | 16 (5%) | 2 |
| SWE-agent | 1,233 | 298 (24%) | 98 (33%) | 66 (22%) | 16 (gold first beyond line 50 in 2) |

Important: only about one quarter to one third of greps happen before the first edit, and the replay at base commit is only faithful for those (afterwards the working tree differs). That is the usable set. Recall@N on the rest is not meaningful without replaying the agent's edits.

## 3. Ground truth mapping
- Best: **Open-SWE-Traces** carries the gold diff itself, plus `instance_id` joinable to Scale-SWE (`parent_commit`, `patch`, 20,181 rows) and nebius/SWE-rebench-V2 (`base_commit`, `patch`, 32,079 rows, cc-by-4.0). No external join needed for gold files; commit needs one join.
- nebius/SWE-rebench-openhands, nebius/SWE-agent-trajectories, Hero(rebench part), SWE-Zero (rebench part): join nebius/SWE-rebench (27,878 rows, cc-by-4.0, `base_commit`, `patch`).
- SWE-Gym trajectories, SWE-Zero (SWE-Gym part): join SWE-Gym/SWE-Gym (2,438, MIT) or SWE-Gym-Raw (64,689) for `base_commit`+`patch`. SWE-Zero's SWE-Fixer part joins internlm/SWE-Fixer-Train-110K (115,406, MIT, `base_commit`, `patch`).
- Hero/R2E part: R2E-Gym-Subset (apache-2.0): commit hash in id; gold from the dataset.
- SWE-smith: `patch` in-row, synthetic.
- SWE-bench/experiments: Verified (500) / Lite (300) gold from SWE-bench; the only source of **frontier-model** trajectories (Claude 4/4.5, GPT-5, Gemini 3) on the same 500 instances with 12 well-known repos, easy to clone.
- Path caveat: commands use `/testbed` (SWE-agent, mini, smith, CoderForge) or `/workspace/<owner>__<repo>__<ver>` (OpenHands); the replay needs path rewriting to the local checkout.

## 4. SWE-bench/experiments detail
- GitHub repo holds only `metadata.yaml` + results; trajectories are in public S3 (listing and GET over HTTPS work without credentials: `https://swe-bench-submissions.s3.amazonaws.com/?prefix=verified/<entry>/trajs/`). I probed all 326 entries: with trajs = verified 119 (of 182), lite 64, test 15; none for multimodal/multilingual.
- Harness diversity (verified, with trajs): OpenHands (many models incl. Claude 4 Sonnet, Kimi K2, GPT-5, DevStral, Claude Opus 4.5), SWE-agent (Claude 4 Sonnet, DevStral, Kimi K2, LM-32B), Anthropic-style "Tools" (Claude 3.7, 4 Sonnet/Opus), TRAE, Moatless, Augment, Warp, Refact, Amazon Q, Atlassian Rovo, Sonar, live-SWE-agent, Prometheus, Lingxi, GLM-4.5/4.6, Qodo, EPAM, Bloop, Harness AI, Zencoder, AgentScope, etc. Full list: `traces-sample/exp-s3probe.txt`.
- Formats differ per entry: OpenHands event JSON, SWE-agent `.traj` (7.8 MB each), Anthropic-tools `.txt` with `<function_calls>`, TRAE JSON; some logs (TRAE, OpenHands newer) hide commands behind "Action: unknown". Each harness needs its own parser. I downloaded 3 instances x 6 entries into `traces-sample/exp-*`.
- Raw grep/find/rg-flag count per instance in those 18 files: 0 to 30 (median about 3-4). Frontier models (Opus 4.5 OpenHands: 0-1) grep far less than open-weight models on mini/OpenHands: they use the editor/view tools and `find`. Small sample (3 astropy instances); treat as indicative only.
- Licence: no LICENSE in SWE-bench/experiments repo (GitHub reports none). Entries are submitter-owned; treat as "public, licence unspecified". Use as a small, secondary, diversity set; quote only aggregate stats.

## 5. Published studies of agent tool use
Verified through arXiv abstract pages (WebFetch) unless marked.
- **Same Signal, Different Semantics** (Ma et al., arXiv 2605.18332, 18 May 2026): 64,380 SWE-bench runs, 126 configurations, 43 frameworks; framework explains 64% of variance in mean turns vs 10% for LLM family. Abstract: no grep or output-size statistics.
- **How Do AI Agents Spend Your Money?** (Bai et al., arXiv 2604.22750): 8 LLMs on SWE-bench Verified; agentic tasks use about 1000x more tokens than chat, input tokens dominate cost, up to 30x run-to-run variance. No per-tool or grep statistics in the abstract.
- **The Devil Is in the Interface** (Xu et al., arXiv 2608.11386): 11,700 trajectories, six tool architectures; natural-language search raises access to relevant files by more than 11%; CodeAct-style interface saves 41.6% steps. No grep output or truncation stats in the abstract.
- **Evaluating AGENTS.md** (arXiv 2602.11988): counts tool-call frequency by category with grep and rg merged in one class (full numbers are in a figure; PDF not readable by my fetcher). Worth reading directly.
- **CodeGrep** (arXiv 2608.05886, RL-trained retrieval agent): one case study where a baseline spends 18 actions on repeated grep (anecdote, not population statistics). Seen via search snippet only.
- **TraceProbe** (arXiv 2607.06184 per a secondary write-up): 2,500 SWE-bench Verified trajectories; search loops (repeated search/read with no edits) flagged as a stable failure signal. Seen via secondary source only.
- **CliffCompaction** (arXiv 2609.26779): tool results are 56.0% of tokens in an uncompacted Terminal-Bench run; it keeps short results such as grep matches. Snippet only.
- **Token Reduction Is Not Cost Reduction** (arXiv 2607.12161): 2,848 Claude Code runs. Snippet only.
- "Agents Don't Paginate" (Codex CLI blog, summarising a study attributed to Petrova et al.; I did not find the primary paper): agents never requested pagination after an over-budget tool response; truncation is silent; keyword prioritisation raised precision-at-1 from 24.2% to 35.0% over FIFO. Closest existing evidence for the ss-grep premise; **secondary source, verify before citing**.
- Understanding Code Agent Behavior (arXiv 2511.00197; OpenHands, SWE-agent, Prometheus trajectories on SWE-bench).
- Blogs: nilenso "Trajectory shapes" (Sonnet 4.5 vs GPT-5 on SWE-Bench Pro; GPT-5 tool-call failure about 20%).
Finding: I found **no published measurement of how often agent grep output overflows a budget, or of recall-after-truncation on real agent grep calls**. Published numbers on grep frequency and output size are essentially absent; my sample table above is new. The research gap supports the paper.

## 6. Recommended mix
Primary (carries gold patch in-row, 3 harnesses, 5+ model families, permissive licence):
1. nvidia/Open-SWE-Traces: all three splits (openhands, sweagent, minisweagent), stratify over language (python and non-python, language field) and repo; use v1.0 (MiniMax/Qwen3.5), v1.1 (Qwen3.6/DeepSeek-V4-Flash), v1.2 (Qwen3.8). Cap per instance (one trajectory per instance and harness) to avoid duplicate commands.
2. nebius/SWE-rebench-openhands-trajectories (OpenHands, different teacher model; join nebius/SWE-rebench for gold).
3. nvidia/SWE-Hero-openhands-trajectories (execution-based; R2E + rebench).
Secondary (diversity of harness and frontier models):
4. SWE-bench/experiments verified trajs (about 10-20 well-chosen entries: OpenHands Claude 4 Sonnet / Opus 4.5 / GPT-5, SWE-agent Claude 4 Sonnet, Anthropic tools Claude 4 Opus, TRAE, plus others); 500 instances, only well-known 12 repos; licence unspecified.
5. SWE-smith (tool/xml splits, MIT, Claude 3.7) for a SWE-agent/Claude style, flagged as synthetic bugs.
6. Optional: SWE-Zero / SWE-ZERO-12M for scale and a speed workload only (execution-free, unnatural grep share 92%).
Skip: Terminal-Bench traces (no repo+commit), public Claude Code traces (no commit, privacy and licence unclear, no gold), SWE-PolyBench (no trajectories), nebius/SWE-agent-trajectories for grep (uses `search_dir`; usable only as a file-level search analogue), SWE-Gym OH trajectories (almost no bash grep: 0.35/traj).

## 7. Usable grep calls estimate
Per trajectory about 9-15 grep-family calls (mini 15, OH 10, SWE-agent 15, rebench 9). Pre-first-edit share about 22-35%; "strict file search" (excluding `-v` filters and pipeline stdin greps) about 70-80%.
- Open-SWE-Traces alone: 677,813 trajectories x ~12 = about 8M grep-family calls, about 2M pre-edit and replayable. In practice you replay a sample: 5,000 trajectories give about 60k grep calls, about 15k pre-edit, of which about 1,000-3,000 produce >50 lines (6-22% depending on harness) and about 300-900 of those also hit a gold file.
- Adding rebench-OH (67k) and Hero (34k) adds about 1M grep calls.
- SWE-bench/experiments verified: 119 entries x 500 instances x ~3-10 = roughly 150k-500k grep calls, but formats need parsing and many entries are unusable.
- Speed workload: millions available; unique (repo, command) pairs fewer because mini/OH repeat identical commands in a trajectory.

## 8. Blockers
1. Working-tree drift: 65-78% of greps run after the agent's first edit. Restrict to pre-edit calls, or reconstruct state by applying the agent's edits (needs full edit replay; not stored in a uniform way).
2. Repo checkout cost: Open-SWE-Traces spans thousands of repos (Scale-SWE 20k instances, rebench-V2 32k). Fix a repo budget (e.g. 50-100 repos, top-N instances each), clone at `parent_commit`/`base_commit`; Scale-SWE/rebench-V2 need a join to get commit (not in trajectory rows). Some commits or repos are deleted/force-pushed.
3. Path rewriting: `/testbed`, `/workspace/<owner>__<repo>__<ver>`, `cd` chains, pipelines (`| head`, `| xargs grep`, `find -exec grep`). ss-grep must be compared on commands it supports; define a parser and report coverage (fraction of commands that are pure grep/rg).
4. Agents truncate on their own (`| head -N` in 16-53% of calls); decide how to treat it (replay both with and without head), and prevent claims that overflow rate is high when it is low in raw agent calls.
5. Execution-free sets (SWE-Zero) are unrepresentative; mini-swe-agent bash-only is also non-representative of production agents (Claude Code, Codex).
6. Frontier-model trajectories exist only through SWE-bench/experiments (no licence, heterogeneous formats, small grep counts).
7. Licensing: Open-SWE-Traces, Hero, Zero, rebench-OH, nebius SWE-agent are cc-by-4.0 (cite NVIDIA/Nebius); SWE-smith MIT; CoderForge-Preview card has no licence (per-row field only); SWE-Gym OH trajectories and R2E-Gym trajectories have no stated licence; SWE-bench/experiments has none. Repos replayed are third-party code under their own licences (fine for offline measurement, do not redistribute checkouts).
8. Data hygiene: Open-SWE-Traces v1.0 originally contained git-hacking trajectories (removed 08/26); filter `resolved` = 1 and report also unresolved.
9. datasets-server returned HTTP 500 for some offsets (retry); no multi-GB download was needed. Full-scale mining needs parquet shards (Open-SWE-Traces 62 GB original files; fetch only the shards you need).
10. Per-query held-out discipline (repo rule): split by instance/repo with a fixed seed (dev 60 / held-out 40) before inspecting per-call results.
