# What coding agents lose when grep output is cut — paper plan

**Status, 2026-10-19:** planning only. No experiment has run under this plan, and no money has been spent. Every paid step needs an explicit owner go ([[feedback_never_launch_paid_runs_unapproved]]).

**Literature notes, 2026-10-19, in `lit/`. Each claim in them is marked VERIFIED or UNVERIFIED.**
- `lit-A-agent-search.md`: about 45 works on search tools inside coding agents and on reducing tool output.
- `lit-B-classical.md`: 35 works on indexed grep, code-search ranking, apportionment in information retrieval, and snippets.
- `lit-C-traces.md`: public trajectory datasets, with grep counts on about 1,000 sampled trajectories.
- `lit-D-impact.md`: citation patterns, venues, naming, and the grep-versus-semantic-search debate.

---

## 0. The question and the contributions

**Research question.** Search often finds useful evidence. How much of that evidence does the output interface then hide from the agent? Can we keep the evidence inside the same context budget?

Agents call grep all the time. Both sides of the "grep or semantic search" debate agree on this. Harnesses and agents then cut the output by position:
- the agent's own `| head`
- the Claude Code line limit
- the Codex head-plus-tail split
- SWE-agent dropping all results above a cap

No published work measures what this cut costs coding agents. The paper measures it, isolates it in a benchmark, and tests a cheap fix against strong alternatives.

**Contributions, in order of importance:**

| # | Contribution | Why other people cite it |
|---|---|---|
| C1 | **Census.** How public coding agents call grep, how large the full output is, how often it is cut, and by what policy. | Reusable facts about agent behaviour. |
| C2 | **Truncation loss.** How often the cut hides evidence that the full output contained. Split into truncation miss and partial loss, apart from retrieval miss. Reported per eligible call and per workload. Includes an **order-sensitivity** test: how much incidental file order decides what the agent sees. | A named, measured failure mode. It matters beyond ss-grep. |
| C3 | **Benchmark.** Two tracks: a selection track (frozen match sets, labels and budgets; no repository or agent needed) and a replay track. Both have query-only and task-informed sub-tracks. The leaderboard starts with about ten baselines. | Any selector, pruner or reranker can run on it in an afternoon. |
| C4 | **Selector.** A budgeted, exact, query-only output selector, defined as one fixed reveal order with proven properties. It is a library usable on plain ripgrep output. A 2×2 factorial separates its effect from the search backend. | A drop-in method with guarantees, easy to adopt. |
| C5 | **Agent evidence.** A $0 observational analysis within each task, a controlled continuation experiment, and a small end-to-end A/B with cost per solved task. | Links benchmark recall to agent behaviour. |

Speed is not a contribution. The paper reports the selector's measured overhead and the end-to-end latency in an appendix (§6, E7).

**Coined term:** *truncation loss*, defined once in the abstract.

**Novelty wording:** "To our knowledge, this is the first measurement of truncation loss in coding-agent grep traces, and the first benchmark that isolates it." Run a narrow literature check before printing this (step S0). Do **not** claim any of these as new:
- organized or bounded grep output
- ranking grep results before the cut
- Sainte-Laguë in information retrieval

Products and papers already cover all three (§1).

## 1. Related work and positioning

### 1.1 Direct rivals: tools that shape grep output for agents

| Tool | Documented behaviour | Use in the paper |
|---|---|---|
| Signal Grep (`pi-plugin-signal-grep`, AGPL-3.0, pi.dev) | ripgrep wrapper. On large results it reports per-file counts with real excerpts and orders files by occurrence count. It separates definitions, calls, imports, exports, comments and text. It keeps a cursor for follow-up pages and refuses stale locations after edits. | Benchmark arm, run as a separate process (do not copy AGPL code). Also gives the "frequency order" ablation its name. |
| Rustygrep | Token budgets; ranks files by match count. | Benchmark arm if it runs headless. |
| pi-agentic-search | Ranks ripgrep matches with optional context. Separates definitions, references and tests. | Task-informed arm. |
| tokenix | Rust CLI with hooks for Claude Code, Codex, OpenCode and Gemini. BM25 + vector + RRF ranking, an exact `grep` mode, budgeted repo packs. | Check whether its grep mode shapes overflow. If it does, add it as an arm. |
| RTK (rtk-ai/rtk, about 84k stars) | Hook that groups grep/rg output by file and trims long lines. | Benchmark arm. Also a distribution channel (§10). |
| archex | A reviewer named it: hooks in six clients that add ranked, token-budgeted results to grep calls. **I could not find it.** | Verify in step S0. |

Rival documentation states features, not measured results. The benchmark measures them.

### 1.2 Adjacent research

- **GrepRAG / "Better Call Grep"** (arXiv 2601.23254, ISSTA 2026). It reranks ripgrep matches, discusses truncation boundaries, and cuts to 4,096 tokens, but for code completion. The claim "nobody optimised which lines survive" is therefore false. Our claim is narrower: agent tool output, a measured loss, a benchmark.
- **RARG** (2607.24223). It reranks a pool of rg matches because rg output is cut, on text corpora.
- **SWE-grep (Cognition), WarpGrep (Morph), CodeGrep (2608.05886).** RL-trained retrieval subagents.
- **SWE-Explore** (2606.07297). Ranked regions under a line budget (nDCG@B, context efficiency). Its audit of context from independent successful trajectories is the model for our audited labels (§3.2).
- **ContextBench** (2602.05892). Process metrics for agent context.
- **Learned output pruning:** SWE-Pruner (2601.16746), SWE-Pruner Pro (2607.18213), Squeez (2604.04979). These are task-informed entries for the benchmark.
- **Rule-based reduction versus summaries:** Complexity Trap (2508.21433) and the harness design study (2609.20804).
- **Cost:** "Token Reduction Is Not Cost Reduction" (2607.12161). Its largest setup removed 38.4% of tool-output tokens, but billed cost rose 6.8%. The compression-gateway study (2609.22114) adds that the cache-priced prefix dominates cost. So we report billed cost per solved task, never only tokens.
- **Noise:** temperature-0 runs flip about 9% of outcomes (2607.09691).
- **Grep stays dominant:** language-server tools get 0–6% of calls when grep exists (2608.13568). Cursor reports that grep plus semantic search works best together. "Is Grep All You Need?" (2605.15184) studies chat memory, not code; cite it only for that.

### 1.3 Prior art for the mechanisms (cite, never claim)

| Mechanism | Prior art |
|---|---|
| Rank lists by proportional shares (Sainte-Laguë) | PM-2 (Dang and Croft, SIGIR 2012): rank positions shared among query aspects; Skowron et al., "Proportional Rankings", IJCAI 2017 |
| Diversity, coverage floor | MMR (SIGIR 1998), xQuAD (WWW 2010), PM-2; host crowding (Solr and Elasticsearch collapse) |
| Term-frequency saturation | BM25 (k₁ saturation) |
| File-kind prior, definition boost | Zoekt (low-priority files: term frequency ÷5; symbol-kind score); Sourcegraph BM25F (2025); Linguist |
| "Results were cut" notice | SWE-agent; Zoekt display limits; Claude Code `count` mode |
| Indexed regex search | Cox 2012; FREE (ICDE 2002); Zoekt; GitHub Blackbird; livegrep; ugrep-indexer; PVLDB 18 (2025); Cursor "Fast regex search" (2026) |
| Fast exact search | ripgrep (2016); Hyperscan (NSDI 2019) |
| Budgeted context selection | AdaGReS (2512.25052), PACMS (2606.20047), 2607.00725, 2606.02245 |

**Positioning.** Stay neutral in the debate: "Every agent calls grep. We measure what its output interface hides, and we reduce that loss." Do not attack semantic search.

## 2. Definitions

- **Call.** One grep-family command an agent ran: grep, egrep, rg or git grep. Record the cwd, the arguments, the pipeline, the harness, the model, the task and the repository.
- **Full match set M.** Every line the call matches at the replayed revision. Collect it with the tool the agent invoked: GNU grep for `grep`, ripgrep for `rg`. Semantics differ: ripgrep is not POSIX-compatible.
- **Budget.** The **primary** budget is a token budget T. It counts everything printed: paths, headers, notices, footers and context lines (`-A`/`-B`/`-C`). The tokenizers are fixed and named; report o200k and the Claude tokenizer if it is available, else o200k only. The **secondary** budget is a line budget N, for readability. The headline budget is the **agent's own budget**: the `head -N` it typed, or the harness cap that applied.
- **Policy.** A function from (call, M, budget) to the printed output. Query-only policies see the call. Task-informed policies also see the issue text.
- **Events per call and label set:**
  - **Retrieval miss.** M contains no labelled evidence.
  - **Truncation miss.** M contains labelled evidence, but none of it survives the policy.
  - **Partial loss.** Some labelled evidence survives, and some is lost. Measured as the lost share.
- **Rates.** Report every rate twice, and never one without the other:
  1. Among **eligible overflowing calls**: the calls where M exceeds the budget.
  2. Across the **sampled workload**: all eligible calls, overflowing or not.

## 3. Data, replay fidelity and labels

### 3.1 Sources

| Dataset | Size, licence | Role |
|---|---|---|
| `nvidia/Open-SWE-Traces` | 677,813 trajectories; CC-BY-4.0; gold patch in each row; OpenHands, SWE-agent and mini-swe-agent; Qwen3.5–3.8, MiniMax M2.5, DeepSeek-V4-Flash | Main source |
| `nebius/SWE-rebench-openhands-trajectories` | 67k; CC-BY-4.0 | Second teacher model |
| `nvidia/SWE-Hero-openhands-trajectories` | 34k; CC-BY-4.0 | Runs that execute tests |
| SWE-bench/experiments (public S3) | 119 Verified entries with trajectories; no licence | Frontier models (Claude 4.x, GPT-5, Gemini 3). Aggregates only; never redistribute |
| SWE-smith trajectories | 76k; MIT; synthetic bugs | Minor; flagged |

Excluded:
- **Terminal-Bench traces and public Claude Code traces:** no repository commit and no gold patch.
- **SWE-Zero:** execution-free, and 92% of its shell calls are grep. It is not natural.

Sampled facts (lit-C §2):
- Agents make 9–15 grep-family calls per trajectory, about 27% of shell commands.
- Plain GNU grep dominates. `rg` is almost absent and `git grep` never appeared.
- `| head` appears on 16–53% of calls.
- Basic-regex `\|` alternation is common.
- 22–35% of calls run before the first edit.

### 3.2 Eligibility and replay fidelity

A call is eligible only if all of these checks pass. Report the share each check removes.
1. It runs before the agent's first edit. Use an edit detector that is validated on a hand-checked sample.
2. **The cwd resolves.** Rewrite `/testbed` and `/workspace/<owner>__<repo>__<ver>` paths, and follow `cd` chains.
3. **The filesystem matches the base revision.** Files generated by setup (build outputs, installed packages, `.egg-info`) are present or absent as they were in the run. Check this with the stored tool output: the replayed output must reproduce what the agent saw, up to the agent's own cut. Calls that fail this check are excluded and counted.
4. The command semantics are supported: the pipeline parses, and the grep dialect is known.

### 3.3 Labels

- **L1, gold-patch evidence (all calls).** Map the gold patch to the **base revision**. Deleted and modified lines count as evidence. For added lines, use the enclosing definition at the base revision, or the anchor lines around the hunk. Exclude files that the patch creates, because they cannot be retrieved. L1 is a localization proxy, not all useful evidence.
- **L2, audited evidence (about 300 calls, stratified).** Two annotators mark the relevant definitions, callers, tests and configuration in M. Adapt SWE-Explore's method: seed the annotation with context used by independent successful trajectories on the same task. Report inter-annotator agreement. L2 checks whether the L1 conclusions hold under a wider notion of evidence.
- **L3, next-opened file (behavioural label).** The file the agent opened after the call. It has position bias, because the agent can only open what it saw, as with clicks in web search. Use L3 **only on calls where the full output was visible**.

### 3.4 Independence and splits

- **Deduplicate:** one trajectory per (task, harness, model), and identical repeated commands collapsed. Report counts of calls, unique tasks and unique repositories.
- **Split by repository**, stratified by harness and language: 60% dev, 40% held-out, seed 42. Spend the repository budget on held-out first, so that held-out has enough clusters.
- All intervals use a **cluster bootstrap by repository**, with tasks nested inside.
- Inspect held-out only as aggregates, and only at milestones (CLAUDE.md rule).

### 3.5 Public pre-registration

The repository is public. Before any held-out replay, publish a tagged commit with a Zenodo DOI (or an OSF registration). It fixes:
- eligibility rules, labels and budgets
- arms and frozen selector constants
- metrics and statistical tests
- non-inferiority margins and decision gates

## 4. Policies (benchmark arms)

**Truncation policies observed in the wild:**
1. **As seen.** The output the agent actually saw, from the stored tool output.
2. **Native order + `head`.** Ripgrep's default order is not deterministic, because the parallel walk can print files in a different order on each run. Run it R = 10 times and report the mean and the spread. GNU grep `-r` follows directory order; report that order separately.
3. **Sorted path order + `head`** (`rg --sort path`, which disables parallelism). This is a deterministic reference.
4. **Harness policies:**
   - Claude Code `head_limit` (verify the number in S0)
   - Codex head-plus-tail by bytes and lines
   - SWE-agent drop-all above its cap (100 files in the current code; 50 results in the paper)

**Simple selectors:**

5. **Round robin over files**, in sorted path order: the file-diversity baseline.
6. **Frequency order:** files by match count, then `head` (Signal Grep's ordering).

**Rival tools,** run as real processes on the same calls: Signal Grep, RTK, Rustygrep, tokenix (if its grep mode shapes output), pi-agentic-search (task-informed).

**ss-grep selector,** frozen (§5), plus ablations:
- without the coverage floor
- without declarations first
- without file-kind priors
- the weight with no saturation
- divisor rules: D'Hondt, Hamilton, Sainte-Laguë
- saturation constant k ∈ {1, 2, 4}

**Task-informed baselines** (separate sub-track; they see the issue text): BM25 on the issue (GrepRAG style), a cross-encoder reranker (RARG style), a small LLM reranker, SWE-Pruner, Squeez. These are **task-informed baselines, not upper bounds**.

**Oracle:** it knows the L1 labels and gives the ceiling.

## 5. The selector

### 5.1 One reveal order, then a prefix cut

The selector builds one deterministic **reveal order** over all items (file, k-th line of that file). Any budget takes the **longest prefix** of that order that fits. For a token budget, the prefix stops at the first item that does not fit; it never skips ahead. The printed output groups the chosen lines by file. The reveal order is built as follows:

1. **File weight:** w_f = s(h_f) × p(kind_f, intent).
   - s(h) = h/(h + k) with k = 2. This is BM25-style term-frequency saturation.
   - p is a file-kind prior: source 1, test 0.5, generated 0.25.
2. **Admission order:** files in descending weight. Ties break by sorted path, so the result is deterministic.
3. **Coverage floor:** the first round reveals the top line of each admitted file, in admission order.
4. **Remaining lines:** interleaved by the Sainte-Laguë quotient w_f/(2s_f + 1). A file whose lines run out leaves the sequence. Ties break by admission order.
5. **Line order inside a file:** declaration lines first, then the other lines in line order.
6. **Footer** (its tokens count against the budget):
   - the exact count of hidden matches and files
   - unseen files with their match counts, within a small token cap
   - one suggested narrowing (`--include` or a subdirectory)
   - a `--more` cursor

### 5.2 Properties (prove each one for this exact algorithm)

- **Exactness.** Every printed line is in M, and the hidden count equals |M| minus the lines shown. Exact *matching* is separate from complete *presentation*: the output is incomplete by design and says so.
- **Nested sets.** For budgets B ≤ B′, the lines shown at B are a subset of the lines shown at B′. This follows because each output is a prefix of one fixed sequence. It holds for line budgets, and for token budgets under the stop-at-first-misfit rule.
- **Continuation stability.** `--more` returns the next items of the same reveal order. It never repeats a shown line and never skips one.
- **What is *not* claimed:**
  - The printed order is not stable across budgets, because file grouping can insert new lines above lines already shown.
  - Apportionment rules are not claimed to be "unbiased" relevance predictors. The priors are hand-set hypotheses that the benchmark tests.
- **Coverage floor.** For any budget with at least F′ lines, every one of the top F′ admitted files has at least one line shown.

### 5.3 Known weakness to test openly

With these priors, a source file with two hits weighs 0.5. A test file can never reach 0.5, and a generated file can never outrank a source file with one hit. That is a strong relevance assumption. For source files, s(h) runs only from 1/3 to 1, so after the floor the interleaving is close to a weighted round robin capped at 3:1. Saturation, not the divisor rule, limits dense files.

Therefore:
- Report results by call intent: definition search, call-site search, test search, configuration, generated code.
- Report the prior-free ablation on every stratum.
- Test one **intent-conditioned** variant on dev only, as a pre-registered v2 arm. It drops the test penalty when the query or the path targets tests, and it puts declarations first only for definition-shaped patterns.

### 5.4 Factorial attribution (2×2)

| Backend | Selection | Shows |
|---|---|---|
| ripgrep | native truncation | Reference |
| ripgrep | ss-grep selector | Effect of selection alone |
| ss-grep engine | native truncation | Effect of the backend alone |
| ss-grep engine | ss-grep selector | Combined product |

Formatting and budgets are equal in every cell. The selector ships as a library and a CLI filter that reads `rg --json`, so the first row works without our index.

## 6. Experiments

### E0. Census (C1)
On a stratified 5k-trajectory sample, report:
- calls per trajectory and their share of shell commands
- flag and dialect shapes
- pipeline use (`| head`, `| grep -v`, `| wc`)
- the full-output size distribution, by replay
- the truncation policy that applied

Stratify by harness × model family × language. **The figure that travels** generalises the claudelab anecdote (in path order, the first 250 lines covered 23% of matching files). It shows the distribution, across the census, of the share of matching files that survive each observed cut.

### E1. Headline gate (pilot, 500 eligible calls, dev repositories)

Compute three numbers at the agent's own budget:
1. Overflow rate.
2. Conditional truncation miss: among overflowing calls, L1 evidence was in M but not in what the agent saw.
3. Recovery: the share of those misses that the frozen selector recovers at the same budget.

Also audit replay fidelity (§3.2) and the L1 mapping on this pilot.

**Gate A.** If the conditional truncation miss is about 5% or lower, reframe the paper: "the cut is mostly harmless; here is the census, the benchmark and the order-sensitivity result." Decide the abstract **after** this gate, never before.

### E2. Truncation loss (C2)
- Full eligible set; all policies of §4 (1–4).
- All three events, both rate bases, token and line budgets.
- L1 on all calls and L2 on the audited subset.

### E3. Order sensitivity (C2)
For each call, hold M fixed and permute the file enumeration order (50 random orders plus the observed native orders). For each policy, measure the spread of target visibility: the share of calls whose truncation-miss status flips across orders. Native and path-order truncation should be highly order-sensitive. A selector that ranks by content should be much less sensitive. Measure ties explicitly.

### E4. Selector benchmark (C3, C4)
- All arms at **equal token budgets** (primary) and at equal line budgets.
- The 2×2 factorial, the ablations, and results by intent stratum.
- Held-out once, at the milestone.

**Gate B.** Does the ss-grep selector beat round robin (arm 5) by a meaningful margin? Pre-register the margin, for example ≥ 3 points of truncation-miss recovery on held-out, with the cluster-bootstrap interval excluding 0.
- **If not:** ship round robin as the default, and make the empirical discovery the centre of the paper.
- **If yes:** the method contribution stands, together with its proven properties.

The internal dev result exists, on 154 overflow calls from our own traces. Answer-file recall rose from 82% to 88%, and declaration-line recall from 34% to 64%. It is exploratory and must never be cited as evidence.

### E5. Agent evidence (C5)

**(a) Observational analysis within each task, $0.** Open-SWE-Traces has many trajectories per task. Within a task, compare trajectories that hit a truncation miss with those that did not. Compare:
- steps until the first opening of an L1 file
- the re-grep rate
- the resolve rate

The comparison is confounded, and the paper says so. Pairing within a task controls for task difficulty.

**(b) Continuation experiment (paid, pilot first).**
- Save the agent's state just before an overflowing grep response.
- Resume identical copies (same model, prefix, repository state and budget) with different presentations of the same M:
  - the observed truncation policy
  - round robin
  - the ss-grep selector
  - the full output where it fits, as a diagnostic reference
- Footer variants are tested here too.
- Measure, over k steps and up to task end: the next file opened, steps to the first L1 file, repeated searches, tokens, billed cost, and the final outcome.
- This answers the self-selection threat directly, because the prefix stays on-policy.
- Use an open-weight model through a direct API, which is cheap.

**(c) End-to-end A/B (paid, last, small).**
- Arm 1: stock grep.
- Arm 2: the compatibility shim (§7), which sends file-search calls to ss-grep and passes everything else to the real grep.
- Arm 3 (control): ripgrep with a fixed cap.
- Enrich the task set with tasks whose baseline trajectories overflowed.
- **Primary endpoints:** steps to the first L1 file and billed cost per solved task. Solve rate is secondary.
- **Power:** about 300 pairs with about 15% discordant outcomes detect about 5–6 points of solve rate at 80% power. Size the run from the pilot's variance. A null result is likely.
- A claim that quality was preserved needs a pre-registered **non-inferiority margin**. "No significant decrease" is not evidence of equal quality.

### E6. Freshness
Edit files and switch branches between calls. Show that the ss-grep output follows the working tree exactly, with a byte comparison against a fresh ripgrep/GNU grep run. This answers Cline's "indexes go stale" argument.

### E7. Overhead and speed (appendix)
- **Selector overhead:** measured in µs on the E4 calls (p50/p95). Report the measurement, not a claim of "about 0". No model calls are added.
- **End-to-end:**
  - ss-grep against ripgrep, both default and `--sort path`
  - GNU grep, BSD grep and git grep
  - ugrep with and without ugrep-indexer
  - zoekt
  - Mac and Linux x86
- **Report separately:** cold first call, index build time, index size, daemon memory, and the output-size-matched subset (ripgrep printing ≤ 1.2× the ss-grep bytes).
- **Rerun Linux after the native lane first.** The last Linux run gave 1.08×, before the lane. The README prints 2.46× (Mac, held-out). The paper and the README must use the same method, or the README needs a footnote with the platform.
- **Parity:** the match set is identical to GNU grep for the `grep` dialect and to ripgrep for `rg`. Publish the check.

## 7. Product work (needed for E4 and E5c; it also drives adoption)

In priority order:
1. **Two modes.**
   - Raw mode is exact and complete, for scripts.
   - Agent mode is budgeted with a hard output limit. It is opt-in by flag or environment, and on by default only in agent hooks.
2. **GNU grep compatibility adapter with passthrough.**
   - Support, in order of census share: basic-regex `\|`, `-E`, `-l`, `-c`, `-v`, stdin input.
   - Match GNU exit codes and stderr exactly, because agents chain commands with `&&`.
   - Pass anything unsupported unchanged to the real grep.
   - Publish the coverage percentage: the share of census calls that the adapter answers.
   - Today's front end accepts `-n -r -i -w -F -A -B -C --include --exclude`. The parser and helpers I read do not handle `\|`, `-E`, `-l`, `-c` or `-v`; confirm this first.
3. **Token-aware selection** with a hard limit. Trim long lines around the match column, and count context lines in the budget.
4. **Provenance and continuation:** the footer of §5.1, `--more` with the continuation guarantee, and per-file follow-up.
5. **Role tags and intent controls:** label each line as definition, call, import or test, and let the agent filter by role.
6. **Freshness checks** under edits and branch switches (E6).
7. **Selector as a standalone library and hook** that works on plain `rg --json`. Then RTK, harnesses or other tools can adopt it without our index.
8. Any change to output shaping is ported to the native Rust lane in the same commit, and checked with the shadow check (CLAUDE.md, "ss-grep Native Lane").

## 8. The benchmark release (C3)

- **Name:** to be decided. Avoid "GrepCut": a reviewer reports a public product under that name. My search did not confirm it, but the risk is not worth taking. Check GitHub, npm, PyPI and arXiv for collisions.
- **Selection track.** Frozen (call, M, labels, budget) records in a simple JSONL format. A submission returns ordered lines per record. The scorer runs locally, with no paid API and no repository clone.
- **Replay track.** Pinned repositories, commits and commands, for systems that change retrieval, indexing or execution.
- **Sub-tracks:** query-only (sees the call) and task-informed (also sees the issue). The information constraint is printed beside every leaderboard row.
- **Sizes:** a smoke set (about 100 records) and the full set. Versioned releases, with a frozen held-out split that is never published with labels until the paper.
- **Seeded leaderboard, about ten entries on day one:**
  - path order + `head`
  - native ripgrep order
  - round robin
  - frequency order / Signal Grep
  - RTK
  - SWE-agent drop-all
  - Codex head-plus-tail
  - BM25 on the issue
  - a cross-encoder
  - a small LLM reranker
  - SWE-Pruner
  - the ss-grep selector
  - the oracle
- **Citability:** a Hugging Face dataset card, a Zenodo DOI, `CITATION.cff`, baseline implementations and a one-command reproduction script.
- **Licence:** redistribute only the CC-BY and MIT parts, with attribution. For the unlicensed SWE-bench/experiments data, publish aggregates only. Never redistribute repository checkouts; the replay track pins commits instead.

## 9. Statistics

- **Units:** calls nested in tasks nested in repositories. Use a cluster bootstrap by repository with 2,000 reps and a fixed seed. Report the number of calls, unique tasks and unique repositories for every number.
- **Paired comparisons** between policies use the same calls.
- **Multiplicity:** the pre-registered primary comparisons are few (selector vs as-seen, selector vs round robin, at the agent's own budget). Every other comparison is labelled secondary.
- **"Equal quality" claims** need a non-inferiority margin, fixed in the pre-registration.
- **Variance across runs:** ripgrep native order uses R = 10; agent runs use at least 2 repeats; the pilots size the main runs.

## 10. Impact and distribution

- **Title:** "What Coding Agents Lose When Grep Output Is Truncated." Use "Grepmaxxing" only for the launch post. The word "-maxxing" reads as a joke in a PhD application.
- **Make the work usable by people who never install ss-grep:** the selection track, a selector library that works on `rg --json`, and adapters for existing tools.
- **Upstream pull requests** with benchmark numbers in the description:
  - SWE-agent (drop-all on overflow)
  - Codex CLI (head-plus-tail cut)
  - RTK (a ranking option)

  A merged PR is a lasting channel for citations and users.
- **Invite external evaluations:** give rival authors the smoke set before the release.
- **Credibility:** publish held-out numbers only, with sample sizes and seeds. List where we lose, in the style of the MaxSim results card. No SOTA overclaims ([[branding]]).

## 11. Threats to validity (in the paper)

- **Self-selection.** Agents adapted their queries to path-order floods; the `| head` habit shows it. The replay measures the counterfactual output. The continuation experiment E5b measures the counterfactual agent.
- **Replay fidelity:** the eligibility losses of §3.2, and whether eligible calls differ in shape from the others.
- **Model mix.** The main data come from open-weight models. Frontier models grep less (lit-C §4, small sample). Report results by model family, and include the SWE-bench/experiments subset.
- **Labels.** L1 is one valid fix. L2 and L3 test how robust the conclusions are.
- **Own-tool bias.** Defences:
  - the selector is frozen before mining
  - public pre-registration
  - a held-out split by repository
  - rivals run as real processes
  - a public scorer
  - losses are published
- **Speed** depends on a warm daemon and an index. State this in the appendix's first sentence, and report the cold costs.

## 12. Venues and dates

| Date | Venue | Scope |
|---|---|---|
| about 25 Nov 2026 | arXiv v1 | C1–C4 (E0–E4), E5a, a pilot of E5b if ready, E7 as an appendix |
| 11 Jan 2027 | ISSTA 2027 (GrepRAG appeared at ISSTA 2026) | Full paper |
| about 14 Jan – Feb 2027 (estimated) | SIGIR 2027, full or resource track | Benchmark framing |
| about 26 Mar 2027 (estimated) | ASE 2027 | Full paper with E5b and E5c |

- **Skip the MSR Data Showcase** (10 Nov). It is too close.
- **ICSE 2027 workshops** (13 Nov): only if they are **non-archival**, because an archival workshop paper can conflict with the ISSTA submission. Check each one.
- No accepted paper can arrive before the ETH (30 Nov) and EPFL (15 Dec) deadlines. The application signal is the arXiv paper, the public benchmark and its adoption.

**Machine time.** The HNSW and MaxSim papers hold the Mac and the box in fixed windows. Replays use CPU, so schedule them outside those windows, and never during a timed run ([[feedback_no_tests_during_mac_bench_queue]]).

## 13. Steps and gates

| Step | Work | Gate or output |
|---|---|---|
| S0 | Narrow literature check for the novelty wording. Verify tokenix's grep mode, archex, Claude Code `head_limit`, the Codex cut, SWE-agent's cap, the "agents don't paginate" primary source, and the AGENTS.md tool statistics (2602.11988). Check benchmark-name collisions. | Final novelty sentence |
| S1 | Trace miner, edit detector, path rewriting, dialect parser (`eval/grep-paper/mine/`). Census E0 on 5k trajectories. | Coverage and eligibility tables |
| S2 | Replay harness: cwd and filesystem fidelity checks, base-revision label mapping, token counter. Reuse `eval/grep-allocation-replay/`. | Fidelity audit on 100 calls |
| S3 | **E1 pilot, 500 dev calls.** | **Gate A**: abstract framing |
| S4 | Selector as a library over `rg --json`; reveal order; proofs written; footer; `--more`. Rivals installed as processes. | Property tests pass; native-lane parity |
| S5 | Pre-registration: tagged commit + Zenodo DOI. Repository split. L2 annotation guide. | Public before any held-out replay |
| S6 | E2, E3, E4 on dev, then held-out once. L2 audit of about 300 calls. | **Gate B**: selector vs round robin |
| S7 | E5a observational analysis ($0). E6 freshness. E7 speed, Linux first. | Appendix tables |
| S8 | E5b continuation pilot (about $20, owner go), then the full run under an owner ceiling | Owner approval |
| S9 | Benchmark release (dataset card, DOI, CITATION.cff, baselines, scorer) and arXiv v1 | Owner reads the draft |
| S10 | GNU compatibility adapter and coverage, E5c A/B (owner go), upstream PRs, ISSTA/ASE version | Owner approval |

## 14. Owner decisions

1. The title and the benchmark name.
2. Whether to try any ICSE workshop (only a non-archival one).
3. The tokenizers for the token budget.
4. The cost ceilings for E5b and E5c, and the model for the continuation runs.
5. Who annotates L2: a second annotator is needed for agreement.
6. Priority against the HNSW and MaxSim papers for machine time.
