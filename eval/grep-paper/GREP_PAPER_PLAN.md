# What coding agents lose when grep output is cut — paper plan (v3, cut-down scope)

**Status, 2026-10-19.** The yield check is done (`YIELD_CHECK.md`, commit 62c80427). No other experiment has run. No money has been spent. Every paid step needs an explicit go from the owner ([[feedback_never_launch_paid_runs_unapproved]]).

**This version.** v2 of this plan had no machine-time limit. It needed about 3–4 months and $500–2,500 for the full scope. v3 keeps the same research question and contributions, but sets a hard limit for arXiv v1: **at most 3 days of machine time**, and about $0 in API spend. §A explains the cut, how it was decided, and the evidence. The rest of the plan is the cut-down design.

**Literature notes.** Four notes in `lit/`, dated 2026-10-19. Each marks its claims VERIFIED or UNVERIFIED.
- `lit-A-agent-search.md`: about 45 works on search tools inside coding agents and on cutting tool output.
- `lit-B-classical.md`: 35 works on indexed grep, ranking code search, apportionment in information retrieval, and snippets.
- `lit-C-traces.md`: public trajectory datasets, and grep counts from about 1,000 sampled trajectories.
- `lit-D-impact.md`: citation patterns, venues, naming, and the debate on grep versus semantic search.

---

## A. The cut-down: what changed, why, and the evidence

### A.1 The decision in one paragraph

Most machine time in v2 went to three items: rebuilding container environments, the paid agent experiments, and the full speed grid. None of the three is needed for the two contributions that carry the paper: the measurement of truncation loss (C2) and the benchmark (C3). So v3 **replays each grep call once on a clean checkout, freezes the full candidate set as records, and runs every later experiment offline on those records**. It uses SWE-rebench-V2 as the main task source, because its checkouts agree with the traces. The agent experiments with task outcomes and the full speed grid move to a later version.

### A.2 How the decision was made

1. **Cost the v2 scope.** The money in v2 is almost all in the continuation experiment (about $150–400) and the end-to-end A/B (about $300–2,000). The v1 must-haves cost almost nothing in API spend. The time risk was engineering and machine time, not money.
2. **Find what uses machine time.** A grep on a local checkout takes milliseconds. Download, environment setup and agent runs take the time. In v2 these were: container images for every replayed task (0.5–1.4 GB each), the ext4/overlay/APFS/ripgrep-R=10 grid for order dependence, the small LLM reranker, the full speed grid (ugrep, zoekt, BSD grep, git grep, Mac and Linux), and the agent experiments.
3. **Keep what answers the research question.** The question is how much evidence the output interface hides, and whether a cheap selector keeps more of it at the same budget. The census, the truncation-loss measurement, the order-dependence result, the selector benchmark and the label audit answer it. None of them needs containers, agent runs or the full speed grid. What v1 cannot show is better agent performance or lower task cost; that stays future work (a later version).
4. **List the risks of the cut, then test them before committing.** Three risks could break "most of the value at 3 days":
   - clean checkouts could fail on exactly the large outputs that the paper is about;
   - a 5k-trajectory sample could give too few usable calls;
   - the ext4 order effect, which is the paper's hook, was not verified.
5. **Run a half-day yield check** (`YIELD_CHECK.md`) that tests the three risks, then fix the scope from its numbers. §A.3 gives the results.

The justification for the cut is that **the reduced study answers its evidence-selection question with much less work**. It makes no forecast of citations or of a share of "value". Reviewers will ask for causal agent evidence, which v1 has only in the search-only agent check.

### A.3 Evidence from the yield check

All per-call numbers come from dev repositories only (provisional split: sha256("42:" + repo) < 0.6 means dev). No held-out call was inspected.

**Funnel, 5,040 trajectories** (stratified over 24 harness × model × source groups, seed 42):

| Step | Calls |
|---|---:|
| Grep-family calls | 99,500 |
| Search files (not a stdin filter) | 63,130 |
| Before the first edit | 29,993 |
| Several files (`-r`, `xargs`, or 2+ paths) | 17,154 |
| Only one grep in the command | 8,134 |
| Visible output was cut | **754** (0.15 per trajectory) |

- In this filtered yield-check sample, 97% of the cuts came from the agent's own `head`, and only 18 came from a harness limit. This describes these three harnesses on these models, not coding agents in general.
- The largest loss in the funnel is chained greps (`grep a; grep b`). They halve the pool.

**Replay of 240 dev calls on clean checkouts** (GNU grep 3.12, shallow fetch of the base commit, no container):

| Measure | All | SWE-rebench-V2 | Scale-SWE |
|---|---:|---:|---:|
| Replay agreement, cut and uncut calls together | 203/230 (88%) | 139/150 (93%) | 64/80 (80%) |
| Cut calls: every visible line found in the replay | 132/147 (90%) | 91/95 | 41/52 |
| Of those, a real overflow (full output larger) | 124/132 (94%) | 85/91 | 39/41 |
| Of those, a gold-patch file in the full output (evidence-bearing, file level) | 49/124 (40%) | 26/85 | 23/39 |
| Of those, no gold-patch file visible (truncation miss, file level) | 5/49 (10%; Wilson 95% 4–22%) | **5/26 (19%; Wilson 95% 9–38%)** | 0/23 |

**Independent cases.** The 49 evidence-bearing calls come from 48 tasks in 45 repositories. The 26 on SWE-rebench-V2 come from 26 tasks in 24 repositories. The 5 misses are 5 different tasks in 5 different repositories (swc, urlaubsverwaltung, go-tpm, cargo-generate, Sage carbon), from two harnesses and four models. So they are not one failure repeated. Five events are still a small base; the intervals above ignore clustering.

**What these numbers decided:**

| Risk | Finding | Decision |
|---|---|---|
| Clean checkouts fail on large outputs | SWE-rebench-V2 agrees 93% without containers. Scale-SWE agrees 80%. The cause, checked on one task (`microsoft_knack_pr223`): the published image holds commit 7993fa2, but the task's `parent_commit` is 6354f3d. The agents worked on the image as it was. | SWE-rebench-V2 is the main source, on clean checkouts. Scale-SWE becomes an optional robustness stratum, and only with each image's real HEAD (§3.2). A 50-call container sample measures the remaining gap. |
| Too few usable calls | 0.15 candidates per trajectory. The 48 shards already downloaded (10 GB) hold 106,988 trajectories, of which 64,216 are SWE-rebench-V2. | Use all local shards, not 5k. Parsing them takes minutes (65 s for the 5k sample, read included). |
| The ext4 hook is not real | Confirmed on Linux. Two ext4 images from separate `mkfs` runs got different hash seeds. The same `grep -rl target src \| head -10` showed 10 files from `pkg6` on one image and 10 different files from `pkg2` on the other. Small single-block directories also changed order. tmpfs gave a third order. GNU `grep -r` uses gnulib fts with no comparison function, so its output follows `readdir` order. | Keep order dependence (E3) in v1, on two ext4 images, tmpfs and APFS. Drop the container overlay and the 10 ripgrep runs: `rg` is rare in the traces. |
| Experiment E5a has no premise | 677,813 trajectories cover 42,533 tasks and 3,788 repositories. Most tasks have 10–25 trajectories. | Keep the observational analysis ($0). |

**Projection for SWE-rebench-V2 alone** (from the per-source sample rates: 0.172 candidates per trajectory × 97% replayable × 96% agree × 93% overflow × 31% evidence-bearing):

| Quantity | Estimate |
|---|---:|
| Candidate cut calls | about 11,000 |
| Evidence-bearing overflowing calls | about 2,900 (about 1,200 held-out) |
| File-level truncation misses at the SWE-rebench-V2 rate of 19% (9–38%) | about 560 (about 250–1,100) |
| File-level truncation misses at the pooled 10% (a conservative planning floor, not the observed rate for this source) | about 290 |
| Replay cost at the measured 3.4 s and 43 MB per call | about 10–11 hours, network-bound; delete each checkout after use |

These rates are file level. The paper's primary L1 level is the definition (§3.3), where both the evidence-bearing share and the miss rate can differ a lot from file level; the pilot measures them first. The intervals ignore clustering (about 15 trajectories share each task), so they are too narrow. **The SWE-rebench-V2 interval (9–38%) lies above the Gate A threshold of about 5%, but five events cannot settle the gate. The full dev pilot decides it.**

### A.4 What v3 drops or defers, and the cost of each cut

| Item | v2 | v3 | What is lost |
|---|---|---|---|
| Environment | Task container where available | Clean checkout; 50-call container sample to measure the gap | Some setup-generated files (`build/`, `.egg-info`). The agreement rates, tier O+ and the sensitivity analysis cover this. |
| Task sources | Scale-SWE + SWE-rebench-V2 | SWE-rebench-V2 main; Scale-SWE optional, with image HEAD | About 40% of the trajectories, unless the image-HEAD step runs |
| Order dependence (E3) | ext4 ×2, container overlay, APFS, ripgrep R=10 | ext4 ×2, tmpfs, APFS | Overlay order; ripgrep run-to-run variance (rare in traces) |
| Task-informed baselines | BM25, cross-encoder, small LLM reranker, SWE-Pruner, Squeez | BM25, one cross-encoder, SWE-Pruner if it runs on CPU | The LLM reranker and Squeez move to a later version |
| Rival tools | Signal Grep, RTK, Rustygrep, tokenix | Signal Grep, RTK; Rustygrep and tokenix only if they run headless with no work | Two minor rivals |
| Continuation experiment (E5b) | v1 pilot if ready | Replaced in v1 by the cheaper search-only agent check (E5d, about $15–40). The full continuation with task outcomes stays in a later version. | Solved-task and $-per-solve evidence in v1 |
| End-to-end A/B (E5c) | later version | later version | None for v1 |
| Speed (E7) | Full grid, Mac and Linux | Selector overhead + one Mac and Linux table against ripgrep | The ugrep, zoekt, BSD grep and git grep rows |
| Chained greps | Excluded | Excluded; a yield lever for later | Half of the pool |

### A.5 Machine-time budget for v1

| Work | Where | Estimate | Basis |
|---|---|---|---|
| Parse all local trajectories (census E0 and the candidate list) | Mac | under 10 minutes | 65 s measured for the 5k sample |
| Replay SWE-rebench-V2 candidates (about 11,000 cut calls), dev first, held-out after the pre-registration | Mac | about 10–11 hours | 3.4 s per call measured |
| Rival tools (Signal Grep, RTK) on the same checkout, before it is deleted | Mac | not measured; check on the first 50 calls | they read live files |
| Replay uncut calls for the synthetic-overflow set (about 3,000) | Mac | about 3 hours | same |
| Container gap sample (50 calls) | Box (amd64) | 1–2 hours | 0.8–1.4 GB per image |
| Order dependence: two ext4 images + tmpfs on about 1,000 evidence-bearing calls | Box | about 2 hours | the ext4 test took under 1 minute for 325 files |
| Selector benchmark, ablations, rivals, BM25, cross-encoder | Mac, offline on frozen records | a few hours | no repository access |
| Speed: overhead + Mac/Linux table | Mac + box | about half a day | — |
| Ranking tuning round (§5.4) | Mac, offline on frozen dev records | under 2 hours for the whole grid | no repository access; minutes per setting |
| Agent flag coverage: speed benchmarks of each new flag (§7 item 3) | Mac | about 1 hour | the existing ss-grep speed bench, run once per flag |
| Agent retrieval check (E5d): about 1,200 resume runs and 600 fresh runs | Mac + DeepSeek API | about 6–10 hours with 8–10 parallel jobs; 60–90 hours if run one at a time, so the runner must run jobs in parallel | 2–3 minutes per run expected at maximum reasoning effort; the pilot measures it |
| Optional: Scale-SWE image HEADs for up to 200 tasks | Box | 2–4 hours, about 100–200 GB transfer | 0.5 GB per image; pull and delete one at a time (box has about 24 GB free) |
| **Total** | | **about 1.5–2 days; 2.5 with the Scale-SWE option** | |

Replays are network-bound and use little CPU. They still never run during a peer's timed window ([[feedback_no_tests_during_mac_bench_queue]]). **Three days is a compute target, not a completion estimate.** The machine budget does not shorten engineering, annotation or writing time (§12).

### A.6 Changes after the external reviews of v3 (2026-10-19)

Two reviews (ChatGPT, Claude web) approved the scope with changes. Adopted:

| Change | Where |
|---|---|
| The agent's own `head` is the headline budget. The selector prints its reveal order in grep's `path:line:text` format, so the agent's `\| head -N` yields the selector's N-line prefix with no harness change. A one-line summary goes first, not a footer last. Token budgets become secondary. | §0, §2, §5.1, §7 |
| L1 at the **definition** level is primary (a match counts if it falls inside the span of a definition that the gold patch touches). File and line levels are secondary. The pilot checks the definition-level evidence-bearing rate first. | §3.3, E1 |
| A trajectory-level exposure rate: the share of trajectories with at least one evidence-bearing truncation miss before the first edit, reported as a lower bound. | §2, E2 |
| Source-specific rates and counts of independent tasks and repositories, not the pooled rate. | §A.3 |
| Gate B's threshold is a relative reduction, fixed from the dev pilot before any held-out replay. | E4, S5 |
| Rival tools run on the live checkout during the replay, and their outputs are frozen with provenance. A tool that cannot run headless is not replaced by a hand-written imitation; the frequency-order arm is labelled as our own baseline. Signal Grep's driver is timeboxed to half a day. | §4, S2 |
| Held-out protection: the 1,115 repositories inspected per call in the yield check are listed in `mine/inspected_repos.txt` and stay in dev in the final split. Dev replay and the pilot come first; held-out is replayed only after the pre-registration. | §3.4, §13 |
| Wording: the 50 shuffles are a sensitivity experiment, not an upper bound. L3 is a behavioural proxy without truncation censoring; it still has position and policy bias. | E3, §3.3 |
| Optional from the start, each with an entry check: E5a (count comparable miss/shown pairs within task, model and harness first); the backend 2×2; CPU neural rerankers (measure throughput on a small batch first). | E4, E5a, §12 |
| Calendar: a writing week, the second annotator found now, an early arXiv submission, and an endorsement check. | §12 |

Not adopted: "v3 keeps the things that drive citations" (a forecast; see §A.2).

### A.7 Changes on 2026-10-20: ranking tuning and agent flag coverage

| Change | Why | Where |
|---|---|---|
| **A ranking tuning round on dev, before the freeze.** The shipped constants were set on our own traces only. Public traces come from other harnesses, models and repositories. One bounded round tunes the ranking (not speed) on the dev replay records, with cross-validation by repository. A fixed rule decides whether a tuned variant replaces the shipped one. | The shipped ranking may not be the best for the public workload, and the dev records make tuning cheap: offline, minutes per setting. Held-out stays closed until the freeze. | §5.4, §11, §12, §13 S3b |
| **Agent flag coverage in v1.** Grep flags and pattern forms that agents use often, and that ss-grep does not support, are added to ss-grep. Each one is built for speed in the native lane. A flag is out of scope only if the agent prompt clearly documents an ss-grep equivalent. | The dev census shows common forms that ss-grep rejects today: basic-regex `\|` alternation in 34% of file-searching calls, `-l` in 7.5%, `-E` in 2.6%, `-c` in 1.9%. An agent that gets an error retries, which costs turns and tokens. | §7 item 3, §12, §13 S4b |
| **Venue names removed** from the scope decisions. Work beyond v1 is "later version". The owner decides the venues. | Venue choice is not a factor in this plan. | throughout, §12 |

---

## 0. The question and the contributions

**Research question.** Search often finds useful evidence. How much of that evidence does the output interface then hide from the agent? Can we keep it inside the same context budget?

Agents call grep constantly. Both sides of the grep-versus-semantic-search debate agree on that. Harnesses and agents then cut the output by position:
- the agent's own `| head` (97% of the cuts in the filtered yield-check sample);
- the Claude Code line limit;
- the Codex head-plus-tail split;
- SWE-agent dropping every result above its cap.

**The one-sentence story.** Agents already cut grep with `head`; we change the order, not the cut.

No published work measures what this cut costs coding agents. This paper does three things:
1. It measures the cost.
2. It isolates the cost in a benchmark.
3. It tests cheap selectors against strong alternatives.

| # | Contribution | v1 | Why others cite it |
|---|---|---|---|
| C1 | **Census.** How public coding agents call grep, how large the full output is, how often it is cut, and by which policy. | Yes | Reusable facts about agent behaviour. |
| C2 | **Truncation loss.** How often the cut hides evidence that the full output contained, separated from retrieval misses. Includes the **enumeration-order** result: the same call shows different evidence on different machines. | Yes | A named, measured failure mode. It matters beyond ss-grep. |
| C3 | **Benchmark.** The selection track holds frozen candidate records, labels and budgets; it needs no repository and no agent. Query-only and task-informed sub-tracks. The leaderboard starts with about ten baselines. | Yes (selection track) | Any selector, pruner or reranker can be evaluated in an afternoon. |
| C4 | **Selectors.** Query-only selectors defined as one fixed reveal order plus a prefix cut, with proven properties, as a library usable on GNU grep or ripgrep output. A 2×2 factorial separates the selector's effect from the search backend's. | Yes | A drop-in method with guarantees. |
| C5 | **Agent evidence.** A search-only agent check at real overflow states (v1, about $15–40), a $0 observational analysis (v1, optional), a continuation experiment with task outcomes and a small end-to-end A/B (both later versions). Each claim is scoped to its own population. | Search-only agent check | Links benchmark results to agent behaviour. |

Speed is not a contribution. An appendix reports measured selector overhead and one end-to-end table (E7).

**Coined term.** *Truncation loss*, defined once in the abstract.

**Novelty wording.** "To our knowledge, the first measurement of truncation loss in coding-agent grep traces, and the first benchmark that isolates it." Run a narrow literature check before printing this sentence (step S0). Do not claim any of the following as new: organized or bounded grep output, ranking grep results before the cut, file-diverse selection, or Sainte-Laguë in information retrieval. Products and papers already cover all four (§1).

**What the paper does not presuppose.** Gate B can show that file diversity alone captures most of the benefit. Then that simple finding becomes the method result, and the apportionment rule becomes an ablation.

## 1. Related work and positioning

### 1.1 Direct rivals: tools that select or shape grep output for agents

| Tool | Documented behaviour | Use in v1 |
|---|---|---|
| Signal Grep (`pi-plugin-signal-grep`, AGPL-3.0, pi.dev) | ripgrep wrapper. On large results it shows per-file counts with excerpts, orders files by occurrence count, and separates definitions, calls, imports, exports, comments and text. It pages with a cursor and refuses stale locations after edits. | Arm, run as a separate process. Do not copy its AGPL code. Its ordering also names the frequency-order ablation. |
| RTK (rtk-ai/rtk, about 84k stars) | Hook that groups grep/rg output by file and trims long lines. | Arm, and a distribution channel (§10). |
| Rustygrep | Token budgets; files ranked by match count. | Arm only if it runs headless with no extra work. |
| tokenix | Rust CLI with hooks for Claude Code, Codex, OpenCode and Gemini; BM25 + vector + RRF ranking; an exact `grep` mode; budgeted repository packs. | Arm only if its grep mode shapes overflow (check in S0) and runs headless. |
| pi-agentic-search | Ranks ripgrep matches using optional context; separates definitions, references and tests. | Task-informed arm, later version. |

**archex** (PyPI, Apache-2.0, v0.35) is a different category. It annotates the agent's grep, glob or `rg` result with one line for each indexed code unit that the hits fall in. It adds lines; it does not select among them. Mention it in related work only.

Rival documentation describes features, not measured results. The benchmark measures them.

### 1.2 Adjacent research

- **GrepRAG, "Better Call Grep"** (arXiv 2601.23254, ISSTA 2026). It reranks ripgrep matches, discusses where to place the truncation boundary, and cuts to 4,096 tokens, but for code completion. Our claim is narrower: agent tool output, a measured loss, and a benchmark.
- **RARG** (2607.24223). It reranks a pool of ripgrep matches because the output is cut, on text corpora.
- **SWE-grep (Cognition), WarpGrep (Morph), CodeGrep (2608.05886).** RL-trained retrieval subagents.
- **SWE-Explore** (2606.07297). Ranked regions under a line budget (nDCG@B, context efficiency). Its audit of context from independent successful trajectories is the model for our audited labels (§3.3).
- **ContextBench** (2602.05892). Process metrics for agent context.
- **Learned output pruning.** SWE-Pruner (2601.16746), SWE-Pruner Pro (2607.18213), Squeez (2604.04979). These are task-informed entries.
- **Rule-based reduction versus summaries.** Complexity Trap (2508.21433); harness design study (2609.20804).
- **Cost.** "Token Reduction Is Not Cost Reduction" (2607.12161): its largest setup removed 38.4% of tool-output tokens but billed 6.8% more. The compression-gateway study (2609.22114): the cache-priced prefix dominates cost. So the agent experiments report billed cost per solved task, never tokens alone.
- **Noise.** Temperature-0 runs flip about 9% of outcomes (2607.09691).
- **Grep stays dominant.** Language-server tools get 0–6% of calls when grep exists (2608.13568). Cursor reports that grep and semantic search work best together. "Is Grep All You Need?" (2605.15184) studies chat memory, not code. Cite it only for that.

### 1.3 Prior art for the mechanisms (cite, never claim)

| Mechanism | Prior art |
|---|---|
| Proportional shares in rankings (Sainte-Laguë) | PM-2 (Dang and Croft, SIGIR 2012); Skowron et al., "Proportional Rankings" (IJCAI 2017) |
| Diversity and coverage | MMR (SIGIR 1998); xQuAD (WWW 2010); PM-2; host crowding (Solr and Elasticsearch collapse) |
| Term-frequency saturation | BM25 (k₁) |
| File-kind prior and definition boost | Zoekt (low-priority files: term frequency ÷5; symbol-kind score); Sourcegraph BM25F (2025); Linguist |
| "Results were cut" notice | SWE-agent; Zoekt display limits; Claude Code `count` mode |
| Indexed regex search | Cox 2012; FREE (ICDE 2002); Zoekt; GitHub Blackbird; livegrep; ugrep-indexer; PVLDB 18 (2025); Cursor "Fast regex search" (2026) |
| Fast exact search | ripgrep (2016); Hyperscan (NSDI 2019) |
| Budgeted context selection | AdaGReS (2512.25052); PACMS (2606.20047); 2607.00725; 2606.02245 |

**Positioning.** Stay neutral: "Every agent calls grep. We measure what its output interface hides, and how much of that a selector can keep." Do not attack semantic search.

## 2. Definitions

- **Call.** One grep-family command run by an agent: grep, egrep, rg or git grep. We record the cwd, the arguments, the pipeline, the harness, the model, the task and the repository.
- **Dialect.** The tool the agent invoked: GNU grep for `grep`, ripgrep for `rg`. Every reference run uses the agent's own dialect.
- **Source record.** One unit of displayed evidence, with these fields: path, revision, source span, type, and clipping (start and end columns, or none). The type is either *match* (a matching line) or *context* (a non-matching line from `-A/-B/-C`). Evidence is always scored against the source spans actually displayed, never against rendered text.
- **Candidate set C.** All source records the call produces at the replayed revision: the full match set M plus its context records.
- **Rendering.** The exact bytes printed for a chosen set of records, including paths, headers, `--` separators, role tags and the footer. Excerpts are built independently of the budget: one fixed clipping rule per line.
- **Budget.**
  - The **headline** budget is the **agent's own line limit N**: the `head -N` it typed (97% of the cuts in the yield-check sample). Every policy prints in grep's `path:line:text` format and is cut at the same N lines. This is the exact deployment that those calls would see, because a selector that prints its reveal order line by line gives the agent's `head` the selector's N-line prefix. The selector is reported with and without its one-line summary header, which uses one of the N lines.
  - For calls cut by a harness limit (characters or tokens), the headline budget is that limit, applied to every policy.
  - The **secondary** budget is a token budget T on the complete serialized rendering, for harness integration (a harness that cuts by tokens). The tokenizer is fixed and named: o200k, plus the Claude tokenizer if available.
- **Policy.** A function from (call, C, budget) to the rendering. Query-only policies see only the call. Task-informed policies also see the issue text.
- **Events,** per call and label set:
  - **Retrieval miss.** C contains no labelled evidence.
  - **Truncation miss.** C contains labelled evidence, but no labelled source record is displayed.
  - **Partial loss.** Some labelled evidence is displayed and some is hidden. We measure the hidden share.
  - Hidden *match* records and omitted *context* records are counted separately.
- **Paired outcomes between two policies,** on the same calls:
  - **Recovered.** The baseline misses and the candidate shows the evidence.
  - **Newly lost.** The baseline shows the evidence and the candidate misses it.
  - **Net improvement.** Recovered minus newly lost, which equals the paired reduction in the truncation-miss rate.
- **Rates.** Every rate is reported on three bases, always together:
  1. **Evidence-bearing overflowing calls:** C's full rendering exceeds the budget, and C contains L1 evidence. This is the **primary** base. Gate A, the Gate B threshold and the E5a groups use it. In the yield check, only 40% of overflowing calls were evidence-bearing at file level; the others looked for callers, tests or configuration.
  2. **Eligible overflowing calls:** C's full rendering exceeds the budget.
  3. **The sampled workload:** all eligible calls.
- **Trajectory-level exposure.** The share of trajectories with at least one evidence-bearing truncation miss before the first edit. It is a **lower bound**, because eligibility excludes chained greps and post-edit greps. The paper says so wherever it prints the number.
- **Budget utilization.** The share of the budget filled. The prefix cut can leave room unused when a later, shorter item would fit. We report it.

## 3. Data, replay fidelity and labels

### 3.1 Sources

| Dataset | Size, licence | Role in v1 |
|---|---|---|
| `nvidia/Open-SWE-Traces`, SWE-rebench-V2 tasks | 64,216 trajectories in the 48 local shards; CC-BY-4.0; gold patch in each row (`metadata.reference_patch.patch`) | **Main source** |
| `nvidia/Open-SWE-Traces`, Scale-SWE tasks | 42,772 trajectories in the local shards | Census only; replay only with image HEAD (§3.2) |
| `nebius/SWE-rebench-V2` | 32,079 tasks; fields `base_commit`, `image_name` | Base commits and images for the main source |
| `AweAI-Team/Scale-SWE` | 20,181 tasks; fields `parent_commit`, `image_url`, `workdir`, `pre_commands` | Task data for the optional stratum |
| `nebius/SWE-rebench-openhands-trajectories` | 67k; CC-BY-4.0 | Later version: second teacher model |
| `nvidia/SWE-Hero-openhands-trajectories` | 34k; CC-BY-4.0; no image field | Later version |
| SWE-bench/experiments (public S3) | 119 Verified entries; no licence | Census aggregates only (frontier models); never redistributed |

Harnesses in the main source: OpenHands, SWE-agent, mini-swe-agent. Models: Qwen3.5–3.8, MiniMax M2.5, DeepSeek-V4-Flash.

**Measured facts (yield check, 5,040 trajectories):** 19.7 grep-family calls per trajectory; 63% of them search files, and the rest filter stdin; 48% of the file searches run before the first edit; the agent's `head` makes 97% of the cuts; the most common limits are `head -20`, `head -10` and `head -30`.

**Excluded:** Terminal-Bench traces and public Claude Code traces (no commit and no gold patch); SWE-Zero (execution-free; 92% of shell calls are grep, which is not natural).

### 3.2 Eligibility and replay fidelity

**Preconditions.** A call is eligible only if all of these hold:
1. It runs before the agent's first edit. The edit detector is validated on a hand-checked sample of 50 trajectories before the main replay. It treats `str_replace_editor` edits and shell writes (`sed -i`, `> file`, `tee`, `patch`, `git apply`, `open(..., 'w')`) as edits, and ignores writes under `/tmp`.
2. It searches files: it is the first command of its pipeline, or it is fed by `find ... | xargs`.
3. It is the only grep in its command. (Chained greps cannot be split from their combined output. This halves the pool; splitting them is a lever for a later version.)
4. Its paths resolve under `/testbed` or `/workspace/<dir>`. The cwd follows `cd` chains, the OpenHands working-directory line, and the persistent SWE-agent shell.
5. The pipeline parses (here-document bodies removed) and the dialect is supported.

**Environment.**
- **Main source (SWE-rebench-V2):** a shallow fetch of `base_commit` from GitHub, checked out, with GNU grep 3.12. The checkout is deleted after its calls are replayed. Only the grep argv runs, and the `find` argv for `find | xargs grep`, never the shell line. Unquoted globs in path operands are expanded as the shell did.
- **Container gap sample:** 50 SWE-rebench-V2 calls also replay inside their images on the box (amd64). This measures what clean checkouts miss.
- **Scale-SWE (optional):** the published image holds a different commit than `parent_commit` (checked on `microsoft_knack_pr223`: image 7993fa2, `parent_commit` 6354f3d). A Scale-SWE replay must first read each image's HEAD (one pull and delete per task). It is reported as its own stratum.

**Fidelity tiers.** Each eligible call gets one tier. The tier is order-independent, because enumeration order can differ between the original run and the replay.

| Tier | Condition | What it supports |
|---|---|---|
| **F, full** | The stored output was **not cut**, and its records equal the replayed C as **sets**. | The synthetic-overflow set (E4) |
| **O+, observed and counted** | The stored output was cut, every stored record is in the replayed C, **and** an independent count from the same trajectory equals the replayed \|M\| (`\| wc -l`, `-c`, or a harness notice with a total). | Historical truncation loss, with stronger support |
| **O, observed** | The stored output was cut, and every stored record is in the replayed C (subset, ignoring order). | Historical truncation loss, as a reconstruction-based estimate |
| **X, excluded** | A stored record is missing from the replayed C, or the replay fails. | Counted and reported, never used |

The yield check measured tier-O agreement at 96% for SWE-rebench-V2 cut calls (91/95). A matching prefix is **supporting evidence, not proof** that the filesystem was the same. Truncation-loss results on naturally overflowing calls are **reconstruction-based estimates**.

**Replay agreement (a diagnostic, not a bound).** Computed over every uncut call attempted, with failures in the denominator and their reasons listed, and stratified by output size and file count. Large outputs touch more setup-generated files, so the overall rate does not bound the reliability of tier O.

**Sensitivity analysis.** Recompute the headline truncation-loss numbers under assumed reconstruction-error rates of 5%, 10% and 20% of hidden records wrong or missing. Label these rates as assumptions. The paper states whether its conclusions survive them.

**Internal versus historical validity.** The selector comparisons stay valid on their own frozen candidate sets, even where the historical prevalence estimates are uncertain. The paper keeps the two claims apart.

### 3.3 Labels

- **L1, gold-patch evidence (all calls).** Map every hunk of the gold patch to the base revision, then to the span of its **enclosing definition** (function, method, class or top-level block) at that revision. A match record counts as evidence if it falls inside such a span. Reason: grep matches are lines that contain the pattern (often the `def` line or a call), while the patch usually edits lines in the body, so exact-line overlap is rare. Hunks outside any definition use the anchor lines around the hunk. Files the patch creates are excluded, because they cannot be retrieved.
  - **Levels:** definition (primary), file (the level of the yield check), and line (strict). All three are reported.
  - **Definition spans** come from the ss-grep code-graph entity spans where the language is supported (as `eval/grep-allocation-replay/collect.mjs` reads them), and else from tree-sitter. The share of hunks mapped to a definition is reported by language.
  - The E1 pilot measures the definition-level evidence-bearing rate first. If it is much lower than the 40% seen at file level, the pool is resized before any held-out replay.

  L1 is a localization proxy, not all useful evidence.
- **v1 label audit (required).** A stratified audit of at least 100 calls, with two annotators on an overlap for agreement. It checks:
  1. whether the base-revision mapping of L1 is correct;
  2. whether the conclusions change when callers, tests and configuration also count as evidence.
- **L2, audited evidence (about 300 calls).** Later version. Seeded with the context that independent successful trajectories of the same task used, as SWE-Explore does.
- **L3, next-opened file (behavioural).** Only on tier-F calls, where the agent saw everything. There it is a behavioural proxy **without truncation censoring**; position bias and the agent's own policy still shape it. So L3 is secondary, and only on the synthetic-overflow set.

### 3.4 Independence and splits

- **Deduplication.** Keep one trajectory per (task, harness, model), and collapse identical repeated commands. Report the counts of calls, unique tasks and unique repositories.
- **Split.** By repository: 60% dev, 40% held-out, seed 42. The yield check used the provisional hash split sha256("42:" + repo) < 0.6. Pre-registration (S5) fixes the final split, stratified by harness and language.
- **Inspected repositories stay in dev.** The 1,115 repositories with per-call records or replays from the yield check are listed in `mine/inspected_repos.txt` (frozen 2026-10-19). The final split assigns all of them to dev; the stratified draw applies to the rest.
- **Order of work.** Dev replay, the pilot and the selector freeze come first. Held-out calls are replayed only after the pre-registration is public.
- **Intervals.** Cluster bootstrap by repository, with tasks nested inside. About 15 trajectories share each task, so per-call intervals without clustering are too narrow.
- **Held-out discipline.** Look at held-out only as aggregates, and only at milestones (CLAUDE.md rule).

### 3.5 Public pre-registration

The repository is public. Before any held-out replay, publish a tagged commit with a Zenodo DOI. It fixes: the eligibility rules and fidelity tiers; the labels, budgets and tokenizer; the arms, with the frozen selector commit; the metrics and statistical tests; the non-inferiority margins and the gate thresholds.

## 4. Policies (benchmark arms)

**Truncation policies observed in the wild:**
1. **As seen.** The output the agent actually saw.
2. **Native streaming order + `head`.** GNU `grep -r` prints in `readdir` order, which depends on the filesystem. The traces are almost all GNU grep. We run it on the filesystems of E3.
3. **Sorted path order + `head`.** A deterministic reference.
4. **Harness policies:** the Claude Code `head_limit` (verify in S0); the Codex head-plus-tail cut; SWE-agent's drop-all above its cap.

**Simple query-only selectors:**

5. **Round robin over files** in sorted path order: the file-diversity baseline.
6. **Frequency order.** Files sorted by match count, then cut with `head` (the Signal Grep ordering).

**Rival tools,** run as real processes: Signal Grep and RTK; Rustygrep and tokenix only if they run headless with no extra work.
- **They run on the live checkout.** These tools read files, repository structure or parsers themselves, so frozen records are not enough. They run during the replay, on the same checkout, before it is deleted. Their outputs are saved with provenance (tool version, command, checkout commit), and all later scoring is offline.
- **Budget rule.** Each tool's native output is cut at the call's N lines (headline) and at T tokens (secondary). We also report each tool at its native size.
- **Headless drivers.** RTK is a plain CLI. Signal Grep runs as a Pi extension or an MCP server; its MCP client driver is **timeboxed to half a day**. If it overruns, Signal Grep moves to a later version. A tool that cannot run is never replaced by a hand-written imitation presented as that tool; the frequency-order arm (item 6) is labelled as our own baseline.

**The ss-grep selector** (§5), frozen, with these ablations: no coverage floor; no declarations-first; no file-kind prior; no saturation; the divisor rule set to D'Hondt, Hamilton or Sainte-Laguë; the saturation constant k ∈ {1, 2, 4}.

**Task-informed baselines** (separate sub-track): BM25 on the issue text (GrepRAG style); one cross-encoder reranker (RARG style) and SWE-Pruner, each only after its CPU throughput is measured on a 50-call batch and the full run fits the budget. These are **task-informed baselines, not upper bounds**. The small LLM reranker and Squeez move to a later version.

**Oracle.** It knows the L1 labels. It gives the ceiling.

## 5. The selector

### 5.1 One reveal order, then a prefix cut

The selector builds one deterministic **reveal order** over items. An item is one source record, together with the context records attached to it.

**The order:**
1. **Admission.** *Every* file in C is admitted. There is no separate file cap; the prefix cut alone decides how many files appear. Files are sorted by weight w_f = s(h_f) × p(kind_f):
   - s(h) = h/(h + k), with k = 2. This is BM25-style term-frequency saturation.
   - p is the file-kind prior: source 1, test 0.5, generated 0.25.
   - Ties break by sorted path.
2. **Phase 1, the coverage floor.** Take the first item of each file, in admission order.
3. **Phase 2, apportionment.** Interleave the remaining items by the Sainte-Laguë quotient w_f / (2s_f + 1). A file that runs out of items leaves the sequence. Ties break by admission order.
4. **Order inside a file.** Declaration lines first, then the rest in line order.

**The rendering, line mode (headline).** The selector prints the whole reveal order line by line, in grep's normal `path:line:text` format (context lines in grep's `path-line-text` form, `--` between groups). It does not cut. The agent's own `| head -N` makes the cut, so the agent sees the selector's N-line prefix. Every prefix is a good prefix, which is what the nested-set property guarantees (§5.2).
- **Summary header.** The first line is a one-line summary, for example `# 1,312 matches in 183 files, ranked; full list: --raw`. A footer at the end never survives `| head`, so the summary goes first. Results are reported with and without this line.
- **Print order** is the reveal order itself. Phase 1 shows one line from each file in turn, so files are interleaved rather than grouped. Whether interleaving hurts readability is a question for the continuation experiment (later version).

**The rendering, token mode (secondary, harness integration).**
- **Footer.** The footer gets a reservation f(T) = min(r, ⌊αT⌋), with α < 1. Here r is the full footer size, and α is fixed in the pre-registration (for example α = 0.15). The item space T − f(T) never decreases as T grows. The footer gives the exact number of hidden match records and hidden files; the unseen files with their match counts, as many as fit; one suggested narrowing; and a `--more` cursor.
- **Cut.** The rendering shows the first k items, where k is the **largest value such that every prefix of length ≤ k renders within T − f(T)**. The cost need not be additive: with `-A/-B`, adding one item can merge two context groups and remove a `--` separator. This definition still gives one well-defined k.
- **Print order** groups the chosen items by file.

**Constants and freezing.**
- S4 starts from k = 2 and the priors (1, 0.5, 0.25) of the shipped algorithm, and changes only the structure: no file cap, the footer rule, and the reveal-order cut. This is the **shipped selector**.
- The tuning round (§5.4) may replace the constants or add signals, on dev records only. The winner of that round is the **frozen selector**. It is frozen before any held-out replay and named in the pre-registration.
- So the accurate claim for the frozen selector is **"tuned on dev, frozen before any held-out replay"**. The paper reports the shipped selector beside it, so readers see what tuning added.

**Implementation.** The library takes normalized source records from GNU grep (the main workload), from `rg --json`, or from the ss-grep engine.

### 5.2 Properties (prove each for this exact algorithm)

- **Match exactness.** Every displayed match record is in M. Every displayed context record is a real source span at the revision, with clipping stated. The hidden match count equals |M| minus the matches shown. Omitted context is reported separately. Exact *matching* is a separate property from complete *presentation*: the output is incomplete by design, and the footer says so.
- **Nested sets.** In line mode the output at N lines is the first N lines of one fixed rendering, so for N ≤ N′ the shown lines are a prefix of those at N′, and print order is stable too. In token mode, for T ≤ T′, the items shown at T are a subset of those shown at T′. The proof uses three facts: the reveal order does not depend on the budget; excerpts do not depend on the budget; the item space T − f(T) does not decrease in T, and the cut is the largest all-prefixes-fit k.
- **Coverage floor, line mode.** With no context lines, `head -N` shows one line from each of the top N − 1 files in admission order (one line goes to the summary header).
- **Continuation stability.** `--more` returns the next items in the same reveal order. It never repeats or skips one.
- **Coverage floor, in tokens.** Let c_i be the rendered cost of the first i phase-1 items. The sufficient condition is T − f(T) ≥ max over i ≤ j of c_i. Under that condition, each of the top j files in admission order has at least one item displayed.
- **Not claimed:** that print order stays stable across token budgets (in token mode, file grouping can insert lines above lines already shown); that the hand-set priors are unbiased predictors of relevance; that token-mode budget use is maximal.

### 5.3 Where each component can matter

- **Phase-2 diagnostic.** When the budget cannot hold one item from every file, the prefix never leaves phase 1, and the divisor rule never runs. On such calls the divisor-rule ablations must give **identical** outputs; this doubles as a correctness test. The yield check found a median of 11.5 files in the full output of overflowing calls, and `head -20` is the most common limit, so phase 1 may carry most of the effect.
  - Report the **share of calls whose prefix reaches phase 2**, by budget.
  - Attribute the gains separately to file ranking, first-item (declaration) choice, and phase-2 apportionment.
- **Prior weakness, tested openly.** A source file with 2 hits weighs 0.5; a test file can never reach 0.5; a generated file never outranks a source file with one hit. Report results by call intent (definition, call site, test, configuration, generated code) and run the prior-free ablation on every stratum.

### 5.4 Ranking tuning round (dev only, before the freeze)

**Purpose.** The shipped constants were set on our own traces. This round checks whether a different ranking keeps more evidence on the public workload. It tunes ranking only. Speed is not tuned here; the speed work is done.

**Data.** The evidence-bearing overflowing calls from the dev replay (about 1,700 expected), with their frozen full outputs and definition-level L1 labels. No repository access, no API, no held-out record.

**Candidate list, fixed before the round starts:**
1. The saturation constant k, on a small grid (1, 2, 4, 8).
2. The file-kind priors for test and generated files, on a small grid.
3. Declarations first: always, never, or only for definition-shaped patterns.
4. The test prior conditioned on intent: no test penalty when the pattern or the path targets tests (the former v2 arm).
5. Two new signals: the search term appears in the file path; the file's directory distance from the search root.
6. One learned ranker: logistic regression on the features above, trained to put L1 files first. It is reported as its own arm whether it wins or not.

**Protection against overfitting.**
- Five-fold cross-validation grouped by repository inside dev. A setting is scored only on folds it was not fitted on.
- The grid stays small: the list above, no further search after the results are seen.
- The round is timeboxed to 3 working days. If it is not done by then, the shipped selector is frozen.

**Decision rule, fixed now.**
- The **primary score** is the out-of-fold truncation-miss rate at the agent's own N (headline budget), on evidence-bearing overflowing calls.
- A tuned variant replaces the shipped selector only if it lowers that rate by **at least 2 percentage points**, and it does not raise the newly lost rate against the shipped selector by more than 1 point.
- **Intent guard.** By call intent (definition, call site, test, configuration), no stratum with at least 50 calls may get worse by more than 3 points. This guards against a ranker that learns to drop callers and tests because L1 counts only fix files.
- If several variants pass, the simplest one wins (fewest changed constants, then no learned model).

**Outputs.** The frozen selector and its commit; a table of every candidate with its out-of-fold score; the shipped selector as a reported arm. Gate B's relative threshold is proposed from the frozen selector's out-of-fold dev results.

**Product.** If a tuned variant wins, ss-grep adopts it. The JavaScript tool and the native lane change in the same commit, verified with the shadow check (CLAUDE.md).

**Future possibilities (not in this round, not tested).**
- **Pure Sainte-Laguë, without the one-line-per-file first round** (owner idea, 2026-10-24). Today every file shows one line before any file shows a second, so a strong file's second hit waits behind the first line of every weak file. Under pure Sainte-Laguë (divisors 1, 3, 5, …), a file's second line comes before another file's first line when its weight is more than 3 times larger. With w = h/(h+2) × prior, this changes the order mainly for many-hit source files against test or generated files with few hits. A weak hint against it: frequency order, which piles lines into high-hit files, misses the most (39.2% on the pilot). The check is offline and costs $0 on the dev pool. It is outside the fixed candidate list, so a result is exploratory. It can replace the shipped selector only after its own round with rules fixed in advance.

### 5.5 Factorial attribution (2×2)

| Backend | Selection | Shows |
|---|---|---|
| reference tool (GNU grep or ripgrep, by dialect) | native truncation | Reference |
| reference tool | ss-grep selector | The effect of selection alone |
| ss-grep engine | native truncation | The effect of the backend alone |
| ss-grep engine | ss-grep selector | The combined product |

Formatting and budgets are equal in every cell. The ss-grep engine cells need an index per checkout, so they run on a stratified subset of about 300 calls, during the replay. **Optional for v1:** if indexing checkouts turns out expensive, the 2×2 moves to a later version, and v1 reports only the reference-backend rows.

## 6. Experiments

**Design rule for v1.** Each checkout is visited once. While it exists, every consumer that needs live files runs on it, in this order:
1. the reference search, which writes the frozen record (the call, the full candidate set C, the visible output, the labels and the tier);
2. the rival tools, with outputs and provenance saved;
3. the ss-grep engine cells of the 2×2, on their subset;
4. the definition spans for L1.

Then the checkout is deleted. E1–E4 and E7's overhead read only the saved records. Outside the replay, only the container sample and E3 touch repositories.

### E0. Census (C1)

On all local trajectories (about 107k; reported by source, and by harness × model family × language):
- calls per trajectory, and their share of shell commands;
- flag and dialect shapes;
- pipeline use (`| head`, `| grep -v`, `| wc`) and the `head -N` distribution;
- the distribution of full-output size, from the replay;
- the truncation policy that applied;
- the fidelity-tier distribution;
- the SWE-bench/experiments frontier-model subset, as aggregates.

**The figure that travels.** The share of matching files that survive each observed cut, across the census.

### E1. Pilot and Gate A (500 evidence-bearing dev calls, SWE-rebench-V2)

**Selector used.** The shipped ss-grep algorithm at a named commit (since 945a9664). The frozen arm of the main study is the commit that the pre-registration names (S5).

The pilot delivers five outputs, at the headline budget:
1. Eligibility and replay agreement: counts for each precondition and each tier; agreement over all uncut calls attempted, by size.
2. The definition-level evidence-bearing rate (checked first; it sizes the pool), then truncation-miss prevalence on all three bases at definition, file and line level, as reconstruction-based estimates with the sensitivity range. Counts of distinct tasks and repositories for every rate.
3. Recovered, newly lost and net outcomes against "as seen" and against round robin, for the shipped selector, at the agent's own N. These set the Gate B threshold (E4).
4. The share of calls whose prefix reaches phase 2.
5. An early label check on about 50 calls from the v1 audit.

**Gate A** uses the evidence-bearing base at definition level. If the truncation-miss rate is about 5% or below, report **"low observed prevalence"**. Do not call it "harmless": harm is a question for the agent experiments. The paper then centres on the census, the benchmark and the enumeration-order result. The yield check gives 19% at file level on SWE-rebench-V2 (5/26; 9–38%), so both outcomes are still possible at definition level.

Write the abstract **after** this gate.

### E2. Truncation loss (C2)

The full eligible set and every policy in §4, items 1–4: all three events, on all three rate bases; the agent's N (headline) and token budgets; L1 at definition, file and line level, with the v1 audit subset; results by tier, by harness and by environment (clean checkout or container sample), with the sensitivity range; and the **trajectory-level exposure rate**, as a lower bound.

### E3. Order dependence (C2)

**(a) Enumeration sensitivity across realistic environments.** On about 1,000 evidence-bearing calls, re-run the agent's GNU grep (no `head`) on:
- two separate ext4 images (loopback files from separate `mkfs` runs, on the box). Confirmed: their hash seeds differ, and `head -10` showed different files;
- tmpfs (on the box);
- APFS (the Mac, from the main replay).

Fifty random shuffles of C are a **sensitivity experiment**: they show how much order can matter, but they need not include the most extreme order, so they are not an upper bound. The container overlay and ripgrep run-to-run order move to a later version.

**What changes and what does not.** Native streaming truncation can change between these environments. Sorted-path truncation and content-based ranking cannot, by construction; their invariance is not a finding.

**The finding:** the share of evidence-bearing calls whose truncation-miss status differs between realistic filesystems. **The hook:** "the same grep call shows different evidence on different machines."

**(b) Dependence on alphabetical position.** Measure where gold targets fall in path order, and how that predicts visibility under path-order truncation. Offline on the frozen records. The controlled bijection test is cut first if time runs short.

### E4. Selector benchmark and Gate B (C3, C4)

**Two populations,** reported side by side and never pooled:
1. **Natural overflow.** Tiers O+ and O, at the headline budget.
2. **Synthetic overflow.** About 3,000 tier-F calls, at imposed line limits of 25%, 50% and 75% of the full output, and at the `head -N` values of comparable natural-overflow calls. Fidelity is complete here, and L3 has no truncation censoring.

E4 runs offline on the frozen records: all arms in grep's format at the agent's N (headline) and at equal token budgets (secondary); the 2×2 factorial on its subset; the ablations with the phase-2 diagnostic; results by intent stratum; budget utilization for each arm. Held-out runs once, at the milestone.

**Gate B. Decision metric:** the paired net reduction in truncation-miss rate of the frozen selector against round robin, on held-out evidence-bearing overflowing calls, at the headline budget. Computed on natural overflow; it must agree in sign on synthetic overflow. Recovered and newly lost are always reported beside it.
- **Threshold, pre-registered:** a **relative** reduction of the round-robin miss rate, fixed from the dev pilot before any held-out replay (for example, at least 20% of the dev miss rate), with the cluster-bootstrap interval excluding 0. A fixed point threshold would mean different things at a 10% and a 25% base rate.
- **Also required:** against "as seen", newly lost evidence stays within the pre-registered non-inferiority margin.
- **If Gate B fails:** ship round robin as the default, and make the empirical discovery the centre of the paper.
- **If Gate B passes:** the method contribution stands, together with its proven properties.

An internal dev result exists: on 154 overflow calls from our own traces, answer-file recall went from 82% to 88%, and declaration-line recall from 34% to 64%. It is exploratory. Never cite it as evidence.

### E5. Agent evidence (C5)

**(a) Observational, $0 (v1, optional).** Most tasks have 10–25 trajectories, but that does not guarantee comparable pairs. **Entry check:** after the dev replay, count tasks that have both a "miss" anchor and a "shown" anchor within the same model and harness. Build the analysis only if that count supports it; otherwise it moves to a later version.
- **Anchor.** Each trajectory is anchored at its first eligible overflowing call. This removes the length confound.
- **Groups.** Only evidence-bearing anchors qualify. Within a task, and stratified by model and harness, compare trajectories whose anchor was a truncation miss with those whose anchor displayed the L1 evidence.
- **Measures, from the anchor on:** steps to the first opening of an L1 file, re-grep rate, and resolve rate. Match or adjust on the anchor's step index.
- The comparison stays confounded, and the paper says so.

**(d) Agent retrieval check (v1; about $15–40 in total, $5 pilot first, owner go).** Added 2026-10-19 after the owner asked for a small agent comparison at low time and cost. It borrows the task design of the tool-habits paper: **search-only runs**, with no Docker and no tests, graded against the gold patch, with hard turn caps. Code: `mine/agent_states.py`, `mine/agent_run.py`, `mine/ranker.py`, `mine/grep_shim.py`.

- **Why not a random-task A/B.** In SWE-rebench-V2 traces, an eligible cut call that hides the fix file occurs about once per 100 trajectories (0.17 candidates per trajectory × 31% evidence-bearing × 19% hidden). A 200-task A/B would meet the problem about twice. Both designs below start where the problem occurs.
- **Model and source.** DeepSeek-V4-Flash with OpenHands trajectories on SWE-rebench-V2, dev repositories only, so the resume model is the trace model. The API serves `deepseek-flash` today; the trace says `DeepSeek-V4-Flash-0731`. The paper states this version difference. Thinking on, reasoning effort max, as in the trace metadata. **Provider: OpenRouter** (owner decision, 2026-10-20), `deepseek/deepseek-v4-flash`, fp8 or bf16 endpoints only (OpenRouter has no DeepSeek first-party endpoint); cost = OpenRouter's billed `usage.cost`. The paper states the provider and the quantization.
- **States (fixed rule, before any run).** A call qualifies if it runs before the first edit, searches several files, is the only grep of its command, has the shape `[cd X &&] grep ... | head -N` with no context or count flags, was cut by that head, replays with every visible line found and a larger full output, and has a gold-patch file in the full output. Seed-42 order, one state per trajectory, never chosen by how the ranked order does. The first pass found 373 candidates and kept 40 states in 40 tasks and 39 repositories.
- **Offline preview on those 40 states (file level, dev).** Native order showed a fix file in 33; ranked order in 39. Ranked recovered 6 and lost 0. This is a preview of the selector benchmark, not an agent result.
- **Design 1, resume (primary).** Feed the trace up to the anchor grep. Arm *as seen*: the exact tool message from the trace. Arm *ranked*: the first N lines of the ranked full output, N being the agent's own `head -N`, with the trace's OpenHands footer. Later greps are plain GNU grep in both arms, so exactly one response differs. Turn cap 100, a safety cap only: the agent finishes (owner decision, 2026-10-20; at 8 turns, 37 of 40 pilot runs stopped at the cap).
- **Design 2, fresh search-only (secondary).** Start from the trace's system prompt and issue. Every grep in the run goes through `grep_shim.py`: GNU grep in both arms, with ranked order in the *ranked* arm (multi-file searches without context or count flags). Turn cap 100, as in design 1.
- **Stop rule.** The first edit attempt (its target is the run's localization answer), `finish`, or the turn cap.
- **Environment.** The replay checkout, under `sandbox-exec`: no network, no writes outside `/private/tmp`, no reads under the home directory except the checkout and the harness code. Reads, `grep`, `find`, `git` and `python` work; edits and tests do not. OpenHands output format and its 30,000-character cap are reproduced.
- **Measures.** Whether the first edit target is a fix file; turns to that edit; **strict fix-file contact** (owner decision, 2026-10-20): the first turn where a grep-family output shows a fix file that was not visible at the start (the loose rule, a fix file anywhere in a command, view or output, saturated in the pilot: every resume state shows one at the start); tokens (cache hit, miss, output) and billed dollars. Main derived number: **dollars per correct localization**.
- **Pilot ($5 hard cap in the runner).** Design 1: 10 states × 2 arms × 2 repeats = 40 runs. Design 2: 5 tasks × 2 arms × 2 repeats = 20 runs. Estimated $2–4 at peak prices, about half off-peak. The pilot checks the harness, the cost per run, and the share of runs that stop at an edit. It is not evidence.
- **Main run, after the pilot and an owner go.** Design 1 on all qualifying dev states (about 300 after the full replay) × 2 arms × 2 repeats; design 2 on about 150 tasks. Estimated $15–40. Then the same on held-out states after the pre-registration, once.
- **Claim it can support.** "At real overflow states, ranked grep output lets the agent reach the fix files in fewer turns and at lower cost." It does not support claims about solved tasks or dollars per solve; those stay later-version work.
- **Limits.** Search-only runs stop at the first edit, so they say nothing about fixing. The sandbox lacks the task's dependencies, so runs that try to execute code see errors in both arms. Design 1 changes one response at states that the original policy reached.

**(b) Continuation (later version; paid, pilot first).** Save the agent state just before an overflowing grep response. Resume identical copies, each with a different presentation of the same C: the observed policy, round robin, the ss-grep selector, and the full output where it fits. Use an open-weight model through a direct API. Measures: the next file opened, steps to the first L1 file, repeated searches, tokens and billed cost, the outcome. Scope: the effect of changing one response at states the original policy reached. The $20 pilot can run before v1 with an owner go; it uses an API, not the Mac or the box.

**(c) End-to-end A/B (later version; paid, last).** Arms: stock grep, the compatibility shim (§7), and ripgrep with a fixed cap. An overflow-enriched set picked with independent screening runs, plus a representative stratum. Primary endpoints: steps to the first L1 file, and billed cost per solved task. About 300 pairs with about 15% discordant outcomes detect about 5–6 points at 80% power.

### E6. Freshness (later version)

Edit files and switch branches between calls. Show by byte comparison that ss-grep's records follow the working tree, against a fresh run of the reference tool.

### E7. Overhead and speed (appendix)

**v1:** selector overhead in µs on the E4 calls (p50 and p95), and one end-to-end table: ss-grep against ripgrep (default and `--sort path`) and GNU grep, on the Mac and on Linux x86. Report the cold first call, index build time and size, and daemon memory separately.

**Linux first.** Rerun Linux after the native lane: the last Linux run gave 1.08×, and it predates the lane. The README prints 2.46×, measured on held-out on a Mac. The paper and the README must use one method, or the README gets a platform footnote.

**Parity.** The match set must equal the reference tool's for each dialect. Publish the check.

**Later version:** ugrep (with and without ugrep-indexer), zoekt, BSD grep and git grep.

## 7. Product work

In priority order. Items 1–3 are needed for v1; the rest are for a later version.
1. **Two modes.** Raw mode: exact and complete, for scripts. Agent mode: the full reveal order in grep's format with the one-line summary first, so the agent's own `| head` cuts it (line mode, §5.1); a token budget only where a harness asks for one. Opt-in, and on by default only in agent hooks.
2. **Selector library.** It takes normalized GNU grep records, `rg --json` or engine records, and builds the reveal order of §5.1. It ships as a CLI filter and a hook, so RTK, harnesses and other tools can adopt it without our index.
3. **Agent flag coverage (v1).** Add the grep flags and pattern forms that agents use often and that ss-grep does not support.
   - **Census (dev calls of the yield-check sample, 38,382 file-searching grep calls):**

     | Form | Share of calls | ss-grep today |
     |---|---|---|
     | `-n` | 76.8% | accepted (always on) |
     | `-r` | 41.7% | accepted (always on) |
     | basic-regex `\|` alternation in the pattern | 34.4% | to confirm; the Rust regex reads `\|` as a literal bar |
     | `--include` | 17.0% | supported |
     | `-A` | 14.0% | supported |
     | `-l` (files with matches) | 7.5% | not supported |
     | `-B` | 4.5% | supported |
     | `-E` | 2.6% | not supported as a flag |
     | `-i` | 2.0% | supported |
     | `-c` (count) | 1.9% | not supported |
     | `-o` (only matching) | 0.5% | not supported |
     | `-v`, `--exclude-dir`, `-h`, `-P`, `-m`, `-a`, `-q`, `-L` | 0.3% or less each | `--exclude-dir` supported; the others not |

     The full census on all local trajectories (E0) replaces these numbers.
   - **Scope rule.** A form is in scope if at least 0.5% of file-searching calls use it, and the agent prompt does not clearly document an ss-grep equivalent that agents use instead (for example `-k` for `| head`). Below 0.5%, ss-grep passes the call to the real grep unchanged, so the agent never gets an error.
   - **Semantics.** GNU grep behaviour for each form: the match set, exit codes, and the output format of `-l` and `-c`. In agent mode, `-l` output is ranked with the file order of §5.1. `-c` and `-o` output is not ranked.
   - **Speed.** Each form is built in the native lane, not by a fallback to the JavaScript tool or to the real grep. `-l` and `-c` stop reading a file at the first match where the output allows it. Basic-regex translation happens once at parse time. Each form is measured with the existing ss-grep speed bench, and no existing case may get slower by more than the bench noise.
   - **Parity.** The JavaScript tool and the native lane change in the same commit, verified with the shadow check (CLAUDE.md). Publish the coverage percentage: the share of census calls that ss-grep answers itself.
4. **Token-aware rendering (harness integration).** Clipping does not depend on the budget; context lines count against the budget; the footer reservation is f(T) = min(r, αT).
5. **Provenance and continuation.** The summary header (line mode) and the footer (token mode); `--more`, with the continuation guarantee.
6. **Role tags and intent controls.**
7. **Freshness under edits and branch switches** (E6).
8. **Native lane parity.** Every change that shapes output is ported to the native Rust lane in the same commit and verified with the shadow check (CLAUDE.md).

## 8. Benchmark release (C3)

- **Name.** To be decided. Avoid "GrepCut" (a reviewer reports a public product under that name). Check GitHub, npm, PyPI and arXiv for collisions.
- **Selection track (v1).** Frozen records in JSONL: (call, candidate source records, labels, budget, licence, task ID). A submission returns an ordered list of records. The scorer renders the list with the reference renderer and counts tokens with the fixed tokenizer. It runs locally, with no paid API and no clone. Records carry the SWE-rebench-V2 instance ID, so other work can join them to its own data.
- **Replay track (later version).** Pinned repositories, commits, container references and commands.
- **Sub-tracks.** Query-only and task-informed. Each leaderboard row states its information constraint.
- **Licence of code.** Records from permissively licensed repositories (MIT, Apache, BSD and similar) ship with their content. For all other repositories, records ship as (repository, commit, path, span) pointers, plus a fetch script. Each record carries a licence field. SWE-bench/experiments: aggregates only.
- **Splits and refresh.** A smoke set of about 100 records, then the full set; releases are versioned. Held-out labels become public with arXiv v1, so a **refresh split** for v2 comes from newer trajectories, with its labels withheld until v2.
- **Seeded leaderboard (v1):** path order + `head`; native GNU grep order (two ext4 filesystems); round robin; frequency order (Signal Grep); RTK; SWE-agent drop-all; Codex head-plus-tail; BM25 on the issue; one cross-encoder; SWE-Pruner (if it runs on CPU); the ss-grep selector; the oracle.
- **Citability.** A Hugging Face dataset card, a Zenodo DOI, `CITATION.cff`, baseline implementations and a one-command scorer.

## 9. Statistics

- **Units.** Calls are nested in tasks, and tasks in repositories. Use a cluster bootstrap by repository, with 2,000 reps and a fixed seed. Report calls, unique tasks and unique repositories for every number.
- **Paired comparisons.** Compare policies on the same calls. Report recovered, newly lost and net results together.
- **Multiplicity.** The primary comparisons are pre-registered and few: the selector against "as seen", and the selector against round robin, both on evidence-bearing overflowing calls at the headline budget. Everything else is labelled secondary.
- **"Equal quality" claims.** They need a pre-registered non-inferiority margin.
- **Variance across environments.** GNU grep: two ext4 filesystems, tmpfs and APFS. Agent runs with task outcomes (later version): at least 2 repeats; the pilots size the main runs.

## 10. Impact and distribution

- **Title.** "What Coding Agents Lose When Grep Output Is Truncated." Use "Grepmaxxing" only for the launch post.
- **Usable without ss-grep.** Release the selection track, a selector library that works on GNU grep and ripgrep output, and adapters for existing tools.
- **Upstream pull requests (after v1).** SWE-agent (drop-all); Codex CLI (head-plus-tail); RTK (a ranking option). Each PR description carries benchmark numbers.
- **External evaluations.** Give rival authors the smoke set before the release.
- **Credibility.** Report held-out numbers only, with sample sizes and seeds. List where we lose. Make no SOTA claims ([[branding]]).

## 11. Threats to validity (in the paper)

- **Self-selection.** Agents adapted their queries to path-order floods; the `| head` habit shows it. The replay measures counterfactual output. It does not measure whole-session adaptation.
- **Replay fidelity.** v1 replays on clean checkouts, not containers. Report the tiers and exclusions; the agreement rates by size (96% on SWE-rebench-V2 cut calls in the yield check); the 50-call container gap; and the sensitivity analysis. Scale-SWE images hold a different commit than their stated base commit, so Scale-SWE is replayed only with image HEAD, or not at all.
- **Source mix.** v1 replays one task source. Report which population each number comes from. The census covers both sources.
- **Eligibility.** Chained greps (half of the multi-file pre-edit calls) are excluded. Check whether eligible calls differ in shape from the others, and report it.
- **Model mix.** Open-weight models dominate the data. Frontier models grep less (lit-C §4, small sample). Report by model family, and include the SWE-bench/experiments aggregates.
- **Labels.** L1 is one valid fix. The v1 audit tests the mapping and a broader notion of evidence.
- **Own-tool bias.** The defences: the shipped constants were set before any public-trace mining, any tuning used dev only, and the shipped selector is reported beside the frozen one; the whole selector is frozen before any held-out replay; the pre-registration is public; held-out is split by repository; rivals run as real processes; the scorer is public; newly lost evidence is reported; our losses are published.
- **Speed.** It depends on a warm daemon and an index. State this in the first sentence of the appendix, and report the cold costs.

## 12. Dates and the cut order

arXiv v1 is the target, at about 25 Nov 2026, with the must-haves below. The owner decides the venues after v1. Work beyond v1 is listed as "later version".

- **ETH (30 Nov) and EPFL (15 Dec):** no accepted paper can arrive before these deadlines. The application signal is the arXiv paper, the public benchmark and adoption.

**v1 must-haves** (all inside the 3-day machine budget of §A.5):
- E0 census on all local trajectories;
- E1 pilot with Gate A;
- E2 truncation loss on SWE-rebench-V2, with the container gap sample;
- E3(a) order dependence on ext4 ×2, tmpfs and APFS;
- E4 selector benchmark with Gate B (natural and synthetic overflow);
- the v1 label audit (at least 100 calls, overlap double-annotated);
- the ranking tuning round on dev, with its decision rule (§5.4);
- agent flag coverage in ss-grep for every in-scope form (§7 item 3);
- E5d agent retrieval check, design 1 (resume), after the pilot and an owner go;
- E7 selector overhead;
- the selection-track release (smoke set and full set).

**v1 optional, each behind its entry check:** E5d design 2 (fresh search-only runs; after design 1); E5a (comparable pair count); the backend 2×2 (cost of indexing checkouts); the cross-encoder and SWE-Pruner (CPU throughput on 50 calls); the Mac/Linux speed table; Signal Grep (half-day driver timebox).


**When time runs short,** cut in this order:
1. E5a.
2. The Mac/Linux speed table (keep the overhead).
3. The backend 2×2.
4. SWE-Pruner and the cross-encoder (keep BM25).
5. E3(b).

The label audit, the tuning round and the flag forms above 1% of calls stay. If the tuning round runs out of time, the shipped selector is frozen.

**Calendar time is not machine time.** The trace parser and a first replay harness exist from the yield check. Still to build: the record extractor, definition-level L1, the tiers, the renderer, the selector library with its proofs, the RTK and Signal Grep drivers, and the scorer. Annotation needs about 10–15 hours. Writing needs about one week. The machine work fits around the HNSW and MaxSim windows; replays never run during a timed run ([[feedback_no_tests_during_mac_bench_queue]]).

**Calendar (targets):**

| By | Milestone |
|---|---|
| this week | Second annotator found. arXiv endorsement checked for cs (if no paper of the owner is on arXiv in cs yet, the first of the three papers to go unlocks it). Related work and the method section started; neither depends on results. |
| this week to about 5 Nov | Agent flag coverage in ss-grep, in parallel with the replay work |
| about 1 Nov | Full dev replay, the E1 pilot and Gate A; the label audit started |
| about 2–5 Nov | Ranking tuning round on dev; selector frozen |
| about 6 Nov | Pre-registration public (frozen selector, α, Gate B relative threshold, final split) |
| about 13 Nov | Held-out replay and the one held-out run of E2–E4 |
| mid-November | Writing week |
| about 20–22 Nov | arXiv submission, a few days before 25 Nov, so a moderation hold still clears before ETH (30 Nov) |

## 13. Steps and gates

| Step | Work | Machine time | Gate or output |
|---|---|---|---|
| S0 | Narrow literature check for the novelty sentence. Verify tokenix's grep mode, Claude Code `head_limit`, the Codex cut, SWE-agent's cap, the primary source for "agents don't paginate", and the AGENTS.md tool statistics (2602.11988). Check the benchmark name for collisions. | none | Final novelty sentence |
| S1 | **Done in part (yield check, 62c80427):** trace parser, harness output formats, cwd tracking, premise tables, the inspected-repository list. **Left:** validate the edit detector on 50 trajectories; run the parser on all local shards. | under 10 min | Census tables; edit-detector accuracy |
| S2 | Replay harness, extended from `mine/replay_sample.py`: record extraction, tiers F/O+/O/X, independent count checks, definition spans and L1, reference renderer and token counter; rivals and engine cells on the live checkout (§6 design rule); checkout deletion after use. **Dev repositories only.** Container gap sample on the box. | about 9 h (Mac, dev share) + 1–2 h (box) | Tier table; agreement by size; container gap; rival outputs |
| S3 | **E1 pilot, 500 evidence-bearing dev calls**, shipped selector at a named commit. E5a pair count. Reranker throughput checks. | minutes (offline) | **Gate A**; definition-level pool size |
| S3b | **Ranking tuning round (§5.4)** on all dev evidence-bearing calls, cross-validated by repository; decision rule applied; product port if a variant wins. | under 2 h (offline) | Frozen selector; candidate table; Gate B relative threshold proposed |
| S4 | **In parallel with S1–S3.** Reveal-order selector library: GNU, rg and engine inputs; line mode with the summary header; token mode with the footer; `--more`. Proofs. RTK driver; Signal Grep driver (half-day timebox). | minutes | Property tests (line-mode prefix, token-mode nesting, continuation, phase-1 identity across divisor rules, footer monotonicity); native-lane parity |
| S4b | **In parallel with S1–S3.** Agent flag coverage (§7 item 3): census shares from S1, in-scope forms in the native lane and the JavaScript tool, passthrough below the threshold, shadow check, speed bench per form. | about 1 h (bench) | Coverage percentage; no speed regression |
| S5 | Pre-registration: tagged commit + Zenodo DOI naming the frozen selector commit, α, the Gate B relative threshold, and the final split (inspected repositories in dev). | none | Public before any held-out replay |
| S6 | **Held-out replay** (same harness, about 5 h), then E2, E3(a) on the box, and E4: dev, then held-out once. v1 label audit. | about 5 h (Mac) + 2 h (box) + a few hours (offline) | **Gate B** |
| S7 | E5d agent check: $5 pilot (owner go), then design 1 and design 2 on dev, then held-out once after S5. E7 overhead; optional: E5a, the Mac/Linux table. | 6–10 h (API, parallel jobs) + up to half a day | v1 tables; $ per correct localization |
| S8 | Selection-track release (dataset card, DOI, CITATION.cff, baselines, scorer, licence fields) and arXiv v1. | none | The owner reads the draft |
| S9 | Later version: continuation pilot (about $20, owner go), then a full run under an owner ceiling. L2. Scale-SWE with image HEAD. Chained greps. | API; box for images | Owner approval |
| S10 | Later version: end-to-end A/B (owner go), E6, replay track, full speed grid, upstream PRs. | — | Owner approval |

## 14. Owner decisions

1. The title and the benchmark name.
2. The tokenizers for the token budget (now secondary).
3. Whether v1 adds the Scale-SWE stratum (image HEAD for up to 200 tasks, about 100–200 GB transfer on the box, 2–4 hours), or leaves Scale-SWE to a later version.
4. The go for the $5 agent-check pilot (prepared, dry run done), and a ceiling for the main agent check (estimate $15–40).
5. The cost ceilings and the continuation model for the later agent experiments with task outcomes.
6. **This week:** the second annotator for the label-audit overlap.
7. **This week:** arXiv endorsement for cs, if needed.
8. Priority against the HNSW and MaxSim papers for machine time on the Mac and the box.
