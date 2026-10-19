# What coding agents lose when grep output is cut — paper plan

**Status, 2026-10-19.** Planning only. No experiment has run under this plan. No money has been spent. Every paid step needs an explicit go from the owner ([[feedback_never_launch_paid_runs_unapproved]]).

**Literature notes.** Four notes in `lit/`, dated 2026-10-19. Each marks its claims VERIFIED or UNVERIFIED.
- `lit-A-agent-search.md`: about 45 works on search tools inside coding agents and on cutting tool output.
- `lit-B-classical.md`: 35 works on indexed grep, ranking code search, apportionment in information retrieval, and snippets.
- `lit-C-traces.md`: public trajectory datasets, and grep counts from about 1,000 sampled trajectories.
- `lit-D-impact.md`: citation patterns, venues, naming, and the debate on grep versus semantic search.

---

## 0. The question and the contributions

**Research question.** Search often finds useful evidence. How much of that evidence does the output interface then hide from the agent? Can we keep it inside the same context budget?

Agents call grep constantly. Both sides of the grep-versus-semantic-search debate agree on that. Harnesses and agents then cut the output by position:
- the agent's own `| head`,
- the Claude Code line limit,
- the Codex head-plus-tail split,
- SWE-agent dropping every result above its cap.

No published work measures what this cut costs coding agents. This paper does three things:
1. It measures the cost.
2. It isolates the cost in a benchmark.
3. It tests cheap selectors against strong alternatives.

| # | Contribution | Why others cite it |
|---|---|---|
| C1 | **Census.** How public coding agents call grep, how large the full output is, how often it is cut, and by which policy. | Reusable facts about agent behaviour. |
| C2 | **Truncation loss.** How often the cut hides evidence that the full output contained, separated from retrieval misses. Includes an **enumeration-order** result: the same call can show different evidence on different runs or machines. | A named, measured failure mode. It matters beyond ss-grep. |
| C3 | **Benchmark.** Two tracks. The selection track holds frozen candidate records, labels and budgets; it needs no repository and no agent. The replay track holds pinned repositories and commands. Each track has a query-only and a task-informed sub-track. The leaderboard starts with about ten baselines. | Any selector, pruner or reranker can be evaluated in an afternoon. |
| C4 | **Selectors.** Query-only selectors defined as one fixed reveal order plus a prefix cut, with proven properties, as a library usable on ripgrep or GNU grep output. A 2×2 factorial separates the selector's effect from the search backend's. | A drop-in method with guarantees, easy to adopt. |
| C5 | **Agent evidence.** A $0 observational analysis anchored at the first overflow, a continuation experiment, and a small end-to-end A/B. Each claim is scoped to its own population. | Links benchmark results to agent behaviour. |

Speed is not a contribution. An appendix reports measured selector overhead and end-to-end latency (E7).

**Coined term.** *Truncation loss*, defined once in the abstract.

**Novelty wording.** "To our knowledge, the first measurement of truncation loss in coding-agent grep traces, and the first benchmark that isolates it." Run a narrow literature check before printing this sentence (step S0). Do not claim any of the following as new: organized or bounded grep output, ranking grep results before the cut, file-diverse selection, or Sainte-Laguë in information retrieval. Products and papers already cover all four (§1).

**What the paper does not presuppose.** Gate B can show that file diversity alone captures most of the benefit. Then that simple finding becomes the method result, and the apportionment rule becomes an ablation.

## 1. Related work and positioning

### 1.1 Direct rivals: tools that select or shape grep output for agents

| Tool | Documented behaviour | Use in the paper |
|---|---|---|
| Signal Grep (`pi-plugin-signal-grep`, AGPL-3.0, pi.dev) | ripgrep wrapper. On large results it shows per-file counts with excerpts, orders files by occurrence count, and separates definitions, calls, imports, exports, comments and text. It pages with a cursor and refuses stale locations after edits. | Arm, run as a separate process. Do not copy its AGPL code. Its ordering also names the frequency-order ablation. |
| Rustygrep | Token budgets; files ranked by match count. | Arm, if it runs headless. |
| pi-agentic-search | Ranks ripgrep matches using optional context; separates definitions, references and tests. | Task-informed arm. |
| tokenix | Rust CLI with hooks for Claude Code, Codex, OpenCode and Gemini; BM25 + vector + RRF ranking; an exact `grep` mode; budgeted repository packs. | Arm, if its grep mode shapes overflow (check in S0). |
| RTK (rtk-ai/rtk, about 84k stars) | Hook that groups grep/rg output by file and trims long lines. | Arm, and a distribution channel (§10). |

**archex** (PyPI, Apache-2.0, v0.35) is a different category. It annotates the agent's grep, glob or `rg` result with one line for each indexed code unit that the hits fall in (name, kind, line span, importers). It leaves the result itself unchanged, and it has opt-in hooks for omp, Pi, OpenCode, Claude Code and Codex. It adds lines; it does not select among them. So it is complementary, not a selector. Mention it in related work. Test it only as an optional add-on whose extra tokens count against the budget.

Rival documentation describes features, not measured results. The benchmark measures them.

### 1.2 Adjacent research

- **GrepRAG, "Better Call Grep"** (arXiv 2601.23254, ISSTA 2026). It reranks ripgrep matches, discusses where to place the truncation boundary, and cuts to 4,096 tokens, but for code completion. Our claim is narrower: agent tool output, a measured loss, and a benchmark.
- **RARG** (2607.24223). It reranks a pool of ripgrep matches because the output is cut, on text corpora.
- **SWE-grep (Cognition), WarpGrep (Morph), CodeGrep (2608.05886).** RL-trained retrieval subagents.
- **SWE-Explore** (2606.07297). Ranked regions under a line budget (nDCG@B, context efficiency). Its audit of context from independent successful trajectories is the model for our audited labels (§3.3).
- **ContextBench** (2602.05892). Process metrics for agent context.
- **Learned output pruning.** SWE-Pruner (2601.16746), SWE-Pruner Pro (2607.18213), Squeez (2604.04979). These are task-informed entries.
- **Rule-based reduction versus summaries.** Complexity Trap (2508.21433); harness design study (2609.20804).
- **Cost.** "Token Reduction Is Not Cost Reduction" (2607.12161): its largest setup removed 38.4% of tool-output tokens but billed 6.8% more. The compression-gateway study (2609.22114): the cache-priced prefix dominates cost. So we report billed cost per solved task, never tokens alone.
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
- **Dialect.** The tool the agent invoked: GNU grep for `grep`, ripgrep for `rg`. Their semantics differ, and ripgrep is not POSIX-compatible. Every reference run uses the agent's own dialect.
- **Source record.** One unit of displayed evidence, with these fields: path, revision, source span, type, and clipping (start and end columns, or none). The type is either *match* (a matching line) or *context* (a non-matching line from `-A/-B/-C`). Evidence is always scored against the source spans actually displayed, never against rendered text.
- **Candidate set C.** All source records the call produces at the replayed revision: the full match set M plus its context records.
- **Rendering.** The exact bytes printed for a chosen set of records. This includes paths, headers, `--` separators, role tags and the footer. Excerpts are built independently of the budget: one fixed clipping rule per line, so the units being revealed never change with the budget.
- **Budget.**
  - The **primary** budget is a token budget T on the complete serialized rendering. The tokenizer is fixed and named: o200k, plus the Claude tokenizer if available.
  - The **secondary** budget is a line budget N, for readability.
  - The **headline** budget is the agent's own budget: the `head -N` it typed, or the harness cap that applied.
- **Policy.** A function from (call, C, budget) to the rendering.
  - Query-only policies see only the call.
  - Task-informed policies also see the issue text.
- **Events,** per call and label set:
  - **Retrieval miss.** C contains no labelled evidence.
  - **Truncation miss.** C contains labelled evidence, but no labelled source record is displayed.
  - **Partial loss.** Some labelled evidence is displayed and some is hidden. We measure the hidden share.
  - Hidden *match* records and omitted *context* records are counted separately.
- **Paired outcomes between two policies,** on the same calls:
  - **Recovered.** The baseline misses and the candidate shows the evidence.
  - **Newly lost.** The baseline shows the evidence and the candidate misses it.
  - **Net improvement.** Recovered minus newly lost, which equals the paired reduction in the truncation-miss rate.
- **Rates.** Every rate is reported twice, never one without the other:
  1. Among **eligible overflowing calls**, where C's full rendering exceeds the budget.
  2. Across the **sampled workload**: all eligible calls.
- **Budget utilization.** The share of the budget filled. The prefix cut can leave room unused when a later, shorter item would fit. This is the price of stable prefixes, and we report it.

## 3. Data, replay fidelity and labels

### 3.1 Sources

| Dataset | Size, licence | Role |
|---|---|---|
| `nvidia/Open-SWE-Traces` | 677,813 trajectories; CC-BY-4.0; gold patch in each row. Harnesses: OpenHands, SWE-agent, mini-swe-agent. Models: Qwen3.5–3.8, MiniMax M2.5, DeepSeek-V4-Flash. | Main source |
| `nebius/SWE-rebench-openhands-trajectories` | 67k; CC-BY-4.0 | Second teacher model |
| `nvidia/SWE-Hero-openhands-trajectories` | 34k; CC-BY-4.0 | Runs that execute tests |
| SWE-bench/experiments (public S3) | 119 Verified entries with trajectories; no licence | Frontier models (Claude 4.x, GPT-5, Gemini 3). Aggregates only; never redistributed |
| SWE-smith trajectories | 76k; MIT; synthetic bugs | Minor; flagged |

**Excluded:**
- Terminal-Bench traces and public Claude Code traces: no commit and no gold patch.
- SWE-Zero: execution-free, with 92% of shell calls being grep, which is not natural.

**Sampled facts** (lit-C §2):
- 9–15 grep-family calls per trajectory, about 27% of shell commands.
- Plain GNU grep dominates. `rg` almost never appears, and `git grep` never did.
- `| head` appears on 16–53% of calls.
- Basic-regex `\|` alternation is common.
- 22–35% of calls run before the first edit.

**Unverified premise (check in S1).** Open-SWE-Traces holds several trajectories per task. Its instances come from Scale-SWE (20,181) and SWE-rebench-V2 (32,079). That gives at least about 13 trajectories per instance on average, *if* those are the only sources. E5a depends on this; confirm it before planning E5a.

### 3.2 Eligibility and replay fidelity

**Preconditions.** A call is eligible only if all four hold:
1. It runs before the agent's first edit. The edit detector is validated on a hand-checked sample.
2. The cwd resolves: rewrite `/testbed` and `/workspace/<owner>__<repo>__<ver>`, and follow `cd` chains.
3. The pipeline parses and the dialect is supported.
4. The environment is rebuilt as faithfully as we can. We prefer the task's own container image where the source dataset publishes one, so that files generated during setup are present (check availability in S1). Otherwise we use a clean checkout at the base revision, and the call is flagged.

**Fidelity tiers.** Each eligible call gets one tier. The tier is order-independent, because enumeration order can differ between the original run and the replay even when the matches are identical.

| Tier | Condition | What it supports |
|---|---|---|
| **F, full** | The stored output was **not cut**, and its match records equal the replayed M as **sets**. | Comparisons on the full output |
| **O, observed** | The stored output was cut, and every stored match record is in the replayed M (subset, ignoring order). | Analyses that use only the observed records. Whether the complete original candidate set equals ours is **uncertain**. |
| **X, excluded** | A stored match record is missing from the replayed M, or the replay fails. | Counted and reported, never used |

A matching prefix is **supporting evidence, not proof** that the filesystem was the same. Truncation-loss results on overflowing calls necessarily come from tier O, because a cut call cannot be tier F.

To bound the uncertainty, use tier-F calls from the same repositories and environments. Their full-set agreement rate estimates how often the hidden part of a tier-O call is reconstructed correctly. Report that rate beside every tier-O number. Report all results by tier, and report the exclusions.

### 3.3 Labels

- **L1, gold-patch evidence (all calls).** Map the gold patch to the **base revision**:
  - Deleted and modified lines count as evidence.
  - Added lines map to the enclosing definition at the base revision, or else to the anchor lines around the hunk.
  - Files the patch creates are excluded, because they cannot be retrieved.

  L1 is a localization proxy. It is not all useful evidence.
- **L2, audited evidence (about 300 calls, stratified).** The annotator marks relevant definitions, callers, tests and configuration among the source records of C. The annotation is seeded with context that independent successful trajectories used on the same task, as SWE-Explore does. Two annotators label an overlap of about 100 calls to measure agreement; one annotator labels the rest. L2 tests whether the L1 conclusions hold for a broader notion of evidence.
- **L3, next-opened file (behavioural).** The file the agent opened after the call. L3 has position bias, as clicks in web search do. Use it **only on tier-F calls**.

### 3.4 Independence and splits

- **Deduplication.** Keep one trajectory per (task, harness, model), and collapse identical repeated commands. Report the counts of calls, unique tasks and unique repositories.
- **Split.** Split by repository, stratified by harness and language: 60% dev, 40% held-out, seed 42. Spend the repository budget on held-out first, so held-out has enough clusters.
- **Intervals.** Cluster bootstrap by repository, with tasks nested inside.
- **Held-out discipline.** Look at held-out only as aggregates, and only at milestones (CLAUDE.md rule).

### 3.5 Public pre-registration

The repository is public. Before any held-out replay, publish a tagged commit with a Zenodo DOI. It fixes these items:
- the eligibility rules and fidelity tiers;
- the labels, budgets and tokenizer;
- the arms, with the frozen selector commit;
- the metrics and statistical tests;
- the non-inferiority margins and the gate thresholds.

## 4. Policies (benchmark arms)

**Truncation policies observed in the wild:**
1. **As seen.** The output the agent actually saw.
2. **Native streaming order + `head`.**
   - ripgrep's parallel walk can change file order on every run, so we run it R = 10 times and report the mean and the spread.
   - GNU `grep -r` prints in directory-listing order. That order depends on the filesystem: ext4 hashed directories are not in name order, APFS is different again. We run it on ext4 (Linux box) and on APFS (Mac).
3. **Sorted path order + `head`** (`rg --sort path`, which turns off parallelism). A deterministic reference.
4. **Harness policies:**
   - the Claude Code `head_limit` (verify the number in S0);
   - the Codex head-plus-tail cut, by bytes and by lines;
   - SWE-agent's drop-all above its cap (100 files in the current code; the paper says 50 results).

**Simple query-only selectors:**

5. **Round robin over files** in sorted path order: the file-diversity baseline.
6. **Frequency order.** Files sorted by match count, then cut with `head` (the Signal Grep ordering).

**Rival tools,** run as real processes on the same calls: Signal Grep, RTK, Rustygrep, and tokenix (if it shapes output). pi-agentic-search goes in the task-informed sub-track.

**The ss-grep selector** (§5), frozen, with these ablations:
- no coverage floor;
- no declarations-first;
- no file-kind prior;
- no saturation;
- the divisor rule set to D'Hondt, Hamilton or Sainte-Laguë;
- the saturation constant k ∈ {1, 2, 4}.

**Task-informed baselines** (separate sub-track): BM25 on the issue text (GrepRAG style), a cross-encoder reranker (RARG style), a small LLM reranker, SWE-Pruner, and Squeez. These are **task-informed baselines, not upper bounds**.

**Oracle.** It knows the L1 labels. It gives the ceiling.

## 5. The selector

### 5.1 One reveal order, then a prefix cut

The selector builds one deterministic **reveal order** over items. An item is one source record, together with the context records attached to it.

**The order:**
1. **Admission.** *Every* file in C is admitted. There is no separate file cap, because the prefix cut alone decides how many files appear. Files are sorted by weight w_f = s(h_f) × p(kind_f):
   - s(h) = h/(h + k), with k = 2. This is BM25-style term-frequency saturation.
   - p is the file-kind prior: source 1, test 0.5, generated 0.25.
   - Ties break by sorted path.
2. **Phase 1, the coverage floor.** Take the first item of each file, in admission order.
3. **Phase 2, apportionment.** Interleave the remaining items by the Sainte-Laguë quotient w_f / (2s_f + 1). A file that runs out of items leaves the sequence. Ties break by admission order.
4. **Order inside a file.** Declaration lines first, then the rest in line order.

**The cut and the rendering:**
- **Footer.** The footer has a **fixed token reservation**, taken from T before any items. Its content changes with the budget, but it is truncated to fit the reservation, so the space left for items never depends on how much is hidden. The footer gives:
  - the exact number of hidden match records and hidden files;
  - the unseen files with their match counts, as many as fit;
  - one suggested narrowing (`--include` or a subdirectory);
  - a `--more` cursor.
- **Cut.** The rendering shows the first k items, where k is the **largest value such that every prefix of length ≤ k renders within T − footer**. The cost need not be additive. With `-A/-B`, adding one item can merge two context groups and remove a `--` separator, so the cumulative cost can fall. This definition still gives one well-defined k.
- **Print order.** The rendering groups the chosen items by file.

**The frozen selector** uses p(kind) only. An intent-conditioned prior is a separate v2 arm (§5.4).

**Implementation.** The library takes normalized source records from GNU grep (the main workload), from `rg --json`, or from the ss-grep engine.

### 5.2 Properties (prove each for this exact algorithm)

- **Match exactness.** Every displayed match record is in M. Every displayed context record is a real source span at the revision, with clipping stated. The hidden match count equals |M| minus the matches shown. Omitted context is reported separately.
  - Exact *matching* is a separate property from complete *presentation*. The output is incomplete by design, and the footer says so.
- **Nested sets.** For budgets T ≤ T′, the items shown at T are a subset of those shown at T′. The proof uses three facts:
  - the reveal order does not depend on the budget;
  - excerpts do not depend on the budget;
  - the footer reservation is fixed, and the cut is the largest all-prefixes-fit k. As T grows, this k cannot decrease.

  The same holds for line budgets.
- **Continuation stability.** `--more` returns the next items in the same reveal order. It never repeats or skips one.
- **Coverage floor, in tokens.** Let c_j be the rendered cost of the first j phase-1 items, plus the footer reservation. If T ≥ c_j, then each of the top j files by admission order has at least one displayed item.
- **Not claimed:**
  - That print order stays stable across budgets. File grouping can insert new lines above lines already shown.
  - That the hand-set priors are unbiased predictors of relevance. The benchmark tests them.
  - That budget use is maximal. The prefix cut can leave room unused, which we report as budget utilization.

### 5.3 Where each component can matter

- **Phase-2 diagnostic.** When there are more files than the budget can show, the prefix never leaves phase 1. Example: 200 matching files under a 50-line budget gives one line from each of the top 50 files, and the divisor rule never runs. On such calls the divisor-rule ablations must give **identical** outputs. This doubles as a correctness test. Results depend only on file ranking and first-item choice.
  - Report the **share of calls whose prefix reaches phase 2**, by budget.
  - Attribute the gains separately to file ranking, first-item (declaration) choice, and phase-2 apportionment.
  - Phase 1 may carry most of the benefit. If so, the paper says that file and line prioritization is the useful part.
- **Prior weakness, tested openly.**
  - A source file with 2 hits weighs 0.5.
  - A test file can never reach 0.5.
  - A generated file never outranks a source file with one hit.
  - For source files, s(h) ranges only from 1/3 to 1, so phase 2 is close to a weighted round robin capped at 3:1. Saturation, not the divisor rule, is what limits dense files.
  - We report results by call intent (definition search, call-site search, test search, configuration, generated code) and run the prior-free ablation on every stratum.

### 5.4 v2 arm (pre-registered, tuned on dev only)

The v2 arm is an intent-conditioned prior:
- It drops the test penalty when the pattern or the path targets tests.
- It puts declarations first only for definition-shaped patterns.

The v2 arm is reported beside the frozen selector, never in its place.

### 5.5 Factorial attribution (2×2)

| Backend | Selection | Shows |
|---|---|---|
| reference tool (GNU grep or ripgrep, by dialect) | native truncation | Reference |
| reference tool | ss-grep selector | The effect of selection alone |
| ss-grep engine | native truncation | The effect of the backend alone |
| ss-grep engine | ss-grep selector | The combined product |

Formatting and budgets are equal in every cell.

## 6. Experiments

### E0. Census (C1)

E0 runs on a stratified sample of 5k trajectories. It reports:
- calls per trajectory, and their share of shell commands;
- flag and dialect shapes;
- pipeline use (`| head`, `| grep -v`, `| wc`);
- the distribution of full-output size, from the replay;
- the truncation policy that applied;
- the fidelity-tier distribution.

Results are stratified by harness × model family × language.

**The figure that travels.** In path order, the first 250 lines of one search covered only 23% of its matching files (the claudelab anecdote). The figure shows the distribution of that share across the census: the matching files that survive each observed cut.

### E1. Pilot and Gate A (500 eligible calls, dev repositories)

**Selector used.** The pilot uses **the shipped ss-grep algorithm at a named commit** (since 945a9664: weight × prior, one line per file first, then Sainte-Laguë, declarations first, with its file cap). The reveal-order library does not exist yet at this step. The frozen arm of the main study is the commit that the pre-registration names (S5).

At the agent's own budget, compute:
1. the overflow rate;
2. the conditional truncation-miss rate (L1, tier O, together with the tier-F agreement rate);
3. against "as seen": the recovered, newly lost and net results, for the shipped selector and for round robin.

Also audit fidelity tiering and L1 mapping on this pilot.

**Gate A.** If the conditional truncation-miss rate is about 5% or below, report **"low observed prevalence"**. Do not call it "harmless": harm is a question for the agent experiments. The paper then centres on the census, the benchmark and the enumeration-order result.

Write the abstract **after** this gate.

### E2. Truncation loss (C2)

E2 covers the full eligible set and every policy in §4, items 1–4. It reports:
- all three events, at both rate bases;
- token and line budgets;
- L1 on all calls, L2 on the audited subset;
- results by fidelity tier.

### E3. Order dependence (C2)

Two separate questions:

**(a) Enumeration sensitivity.** Hold C fixed and shuffle the file enumeration order: 50 random orders, plus the observed native orders from R = 10 ripgrep runs, plus GNU grep on ext4 and on APFS.
- Native streaming truncation can change under these shuffles.
- Sorted-path truncation and any content-based ranking do not change, by construction. Their invariance is not a finding.
- **The finding:** the share of calls whose truncation-miss status is **decided by enumeration order** under the native policies. Also measured: how much evidence those policies lose or expose inconsistently.
- **The hook:** "the same grep call shows different evidence on different runs and machines."

**(b) Dependence on alphabetical position.** Path sorting favours targets whose paths sort early.
- Measure where gold targets fall in path order, and how that predicts visibility.
- For a controlled test, apply a random bijection to directory and file names. The bijection keeps extensions, depth, test and generated markers, and labels. Re-measure the visibility of path-order truncation; changing the sort keys changes it.

### E4. Selector benchmark and Gate B (C3, C4)

E4 runs:
- all arms at **equal token budgets** (primary) and at equal line budgets;
- the 2×2 factorial;
- the ablations, together with the phase-2 diagnostic;
- results by intent stratum;
- budget utilization for each arm.

Held-out runs once, at the milestone.

**Gate B. Decision metric:** the paired net reduction in truncation-miss rate of the frozen selector against round robin. This is recovered minus newly lost, on held-out, at the agent's own budget. Recovered and newly lost are always reported beside it.
- **Threshold, pre-registered:** for example, a net reduction of at least 3 points, with the cluster-bootstrap interval excluding 0.
- **Also required:** against "as seen", newly lost evidence must stay within the pre-registered non-inferiority margin.
- **If Gate B fails:** ship round robin as the default, and make the empirical discovery the centre of the paper.
- **If Gate B passes:** the method contribution stands, together with its proven properties.

An internal dev result exists: on 154 overflow calls from our own traces, answer-file recall went from 82% to 88%, and declaration-line recall from 34% to 64%. It is exploratory. Never cite it as evidence.

### E5. Agent evidence (C5)

**(a) Observational, $0.** This needs several trajectories per task; verify that in S1.

Design:
- **Anchor.** Each trajectory is anchored at its **first eligible overflowing call**. This removes the length confound: longer trajectories have more chances to hit a miss.
- **Groups.** Within a task, and stratified by model and harness, compare trajectories where that anchor call was a truncation miss with those where it was not.
- **Measures, from the anchor on:** steps to the first opening of an L1 file, re-grep rate, and resolve rate.
- **Matching.** Match or adjust on the anchor's step index.

The comparison stays confounded, and the paper says so.

**(b) Continuation (paid, pilot first).**

Design:
- Save the agent state just before an overflowing grep response.
- Resume identical copies (same model, prefix, repository state and budget), each with a different presentation of the same C:
  - the observed policy;
  - round robin;
  - the ss-grep selector;
  - the full output where it fits, as a diagnostic reference.
- Test footer variants here too.
- Use an open-weight model through a direct API.

Measures, over k steps and up to the task end:
- the next file opened;
- steps to the first L1 file;
- repeated searches;
- tokens and billed cost;
- the outcome.

**Scope.** This estimates the effect of changing one response **at states the original policy reached**. It does not show how an agent would adapt its earlier queries after using ss-grep for a whole session.

**(c) End-to-end A/B (paid, last, small).**

Arms:
- stock grep;
- the compatibility shim (§7);
- a control: ripgrep with a fixed cap.

Tasks:
- An **overflow-enriched** set, picked with **independent screening runs**. The comparison uses fresh runs, never the screening runs.
- A **representative stratum** sampled without enrichment.
- Report each set separately, and label the population every time.

Endpoints:
- Primary: steps to the first L1 file, and billed cost per solved task.
- Secondary: solve rate.

Power: about 300 pairs with about 15% discordant outcomes can detect about 5–6 points at 80% power. Size the run from the pilot's variance. Any claim that quality is preserved needs the pre-registered non-inferiority margin.

### E6. Freshness

Edit files and switch branches between calls. Show by byte comparison that ss-grep's records follow the working tree, against a fresh run of the reference tool. This answers Cline's argument that indexes go stale.

### E7. Overhead and speed (appendix)

**Selector overhead.** Measured in µs on the E4 calls (p50 and p95). No model calls are added.

**End-to-end comparison.**
- ss-grep against ripgrep, both default and with `--sort path`;
- GNU grep, BSD grep and git grep;
- ugrep, with and without ugrep-indexer;
- zoekt;
- on Mac and Linux x86.

**Reported separately:**
- the cold first call;
- index build time and size;
- daemon memory;
- the subset where output sizes match (ripgrep ≤ 1.2× the ss-grep bytes).

**Linux first.** Rerun Linux after the native lane before anything else: the last Linux run gave 1.08×, and it predates the lane. The README prints 2.46×, measured on held-out on a Mac. The paper and the README must use one method, or the README gets a platform footnote.

**Parity.** The match set must equal the reference tool's for each dialect. Publish the check.

## 7. Product work

In priority order:
1. **Two modes.**
   - Raw mode: exact and complete, for scripts.
   - Agent mode: budgeted, with a hard output limit. It is opt-in, and on by default only in agent hooks.
2. **Selector library.** It takes normalized GNU grep records, `rg --json` or engine records, and builds the reveal order of §5.1. It ships as a CLI filter and a hook, so RTK, harnesses and other tools can adopt it without our index.
3. **GNU grep compatibility adapter with passthrough.**
   - Support these flags in order of their census share: basic-regex `\|`, `-E`, `-l`, `-c`, `-v`, and stdin.
   - Match GNU exit codes and stderr exactly, because agents chain commands with `&&`.
   - Pass anything unsupported to the real grep unchanged.
   - Publish the coverage percentage.
   - Today's front end accepts `-n -r -i -w -F -A -B -C --include --exclude`. In the code I read, it has no handling for `\|`, `-E`, `-l`, `-c` or `-v`. Confirm this first.
4. **Token-aware rendering.**
   - Clipping long lines must not depend on the budget.
   - Context lines count against the budget.
   - The footer has a fixed reservation.
5. **Provenance and continuation.** The §5.1 footer; `--more`, with the continuation guarantee; follow-up per file.
6. **Role tags and intent controls.** Each line carries a tag (definition, call, import, test), and the agent can filter by role.
7. **Freshness under edits and branch switches** (E6).
8. **Native lane parity.** Every change that shapes output is ported to the native Rust lane in the same commit and verified with the shadow check (CLAUDE.md).

## 8. Benchmark release (C3)

- **Name.** To be decided. Avoid "GrepCut": a reviewer reports a public product under that name. My search did not confirm it, but the risk is not worth taking. Check GitHub, npm, PyPI and arXiv for collisions.
- **Selection track.** Frozen records in JSONL: (call, candidate source records, labels, budget, licence). A submission returns an ordered list of records. The scorer renders the list with the reference renderer and counts tokens with the fixed tokenizer. It runs locally, with no paid API and no clone.
- **Replay track.** Pinned repositories, commits, container references and commands.
- **Sub-tracks.** Query-only and task-informed. Each leaderboard row states its information constraint.
- **Licence of code.** The trajectory licences (CC-BY, MIT) do not cover the repository lines inside the candidate records.
  - Records from permissively licensed repositories (MIT, Apache, BSD and similar) ship with their content.
  - For all other repositories, records ship as (repository, commit, path, span) pointers, plus a fetch script.
  - Each record carries a licence field. CodeSearchNet set the precedent for this.
  - SWE-bench/experiments: aggregates only.
- **Splits and refresh.** A smoke set of about 100 records, then the full set; releases are versioned. Held-out labels become public with arXiv v1, and rankings will slowly overfit to them. So a **refresh split** for v2 is planned from newer trajectories (dated after the v1 release), and the refresh labels are withheld until v2.
- **Seeded leaderboard** on day one:
  - path order + `head`
  - native ripgrep order (mean over R)
  - round robin
  - frequency order (Signal Grep)
  - RTK
  - SWE-agent drop-all
  - Codex head-plus-tail
  - BM25 on the issue
  - a cross-encoder
  - a small LLM reranker
  - SWE-Pruner
  - the ss-grep selector
  - the oracle
- **Citability.** A Hugging Face dataset card, a Zenodo DOI, `CITATION.cff`, baseline implementations and a one-command reproduction.

## 9. Statistics

- **Units.** Calls are nested in tasks, and tasks in repositories. Use a cluster bootstrap by repository, with 2,000 reps and a fixed seed. Report calls, unique tasks and unique repositories for every number.
- **Paired comparisons.** Compare policies on the same calls. Report recovered, newly lost and net results together.
- **Multiplicity.** The primary comparisons are pre-registered and few:
  - the selector against "as seen";
  - the selector against round robin;
  - both at the agent's own budget.

  Everything else is labelled secondary.
- **"Equal quality" claims.** They need a pre-registered non-inferiority margin.
- **Variance across runs.**
  - ripgrep native order: R = 10.
  - GNU grep: 2 filesystems.
  - Agent runs: at least 2 repeats.
  - The pilots size the main runs.

## 10. Impact and distribution

- **Title.** "What Coding Agents Lose When Grep Output Is Truncated." Use "Grepmaxxing" only for the launch post.
- **Usable without ss-grep.** Release the selection track, a selector library that works on GNU grep and ripgrep output, and adapters for existing tools.
- **Upstream pull requests.** Open PRs with benchmark numbers in their descriptions:
  - SWE-agent (drop-all);
  - Codex CLI (head-plus-tail);
  - RTK (a ranking option).
- **External evaluations.** Give rival authors the smoke set before the release.
- **Credibility.**
  - Report held-out numbers only, with sample sizes and seeds.
  - List where we lose (MaxSim results-card style).
  - Make no SOTA claims ([[branding]]).

## 11. Threats to validity (in the paper)

- **Self-selection.** Agents adapted their queries to path-order floods; the `| head` habit shows it.
  - The replay measures counterfactual output.
  - E5b measures counterfactual continuations at states the original policy reached.
  - Neither measures whole-session adaptation.
- **Replay fidelity.** Tiers, exclusions, the tier-F agreement rate as a bound for tier O, and whether eligible calls differ in shape from the rest.
- **Model mix.** Open-weight models dominate the data. Frontier models grep less (lit-C §4, small sample). Report by model family, and include the SWE-bench/experiments subset.
- **Labels.** L1 is one valid fix. L2 and L3 test robustness.
- **Enriched populations.** E5c results hold for the enriched set. The representative stratum is reported separately.
- **Own-tool bias.** The defences:
  - the selector is frozen before mining;
  - the pre-registration is public;
  - held-out is split by repository;
  - rivals run as real processes;
  - the scorer is public;
  - newly lost evidence is reported;
  - our losses are published.
- **Speed.** It depends on a warm daemon and an index. State this in the first sentence of the appendix, and report the cold costs.

## 12. Venues, dates and the cut order

| Date | Venue | Scope |
|---|---|---|
| about 25 Nov 2026 | arXiv v1 | The must-haves below |
| 11 Jan 2027 | ISSTA 2027 (GrepRAG appeared at ISSTA 2026) | Full paper: v1 plus the deferred items |
| about Jan–Feb 2027 (estimate) | SIGIR 2027 full or resource track | Benchmark framing |
| about 26 Mar 2027 (estimate) | ASE 2027 | Full paper, including E5c |

- **MSR Data Showcase (10 Nov):** skip it; too close.
- **ICSE 2027 workshops (13 Nov):** only a **non-archival** one, because an archival workshop paper can conflict with the ISSTA submission.
- **ETH (30 Nov) and EPFL (15 Dec):** no accepted paper can arrive before these deadlines. The application signal is the arXiv paper, the public benchmark and adoption.

**Cut order for arXiv v1.** Decided now, so it is not decided under pressure in late November.

| v1 must-haves | Deferred to the ISSTA version |
|---|---|
| E0 census | Full L2 audit (v1: the 100-call double-annotated overlap only, if time allows) |
| E1 pilot with Gate A | Full E5b (v1: pilot only, if approved and ready) |
| E2 truncation loss | E5c end-to-end A/B (it depends on the adapter) |
| E3 order dependence | Replay track release |
| E4 selector benchmark with Gate B | E6 freshness |
| E5a observational (if the premise holds) | GNU compatibility adapter |
| Selection-track release (smoke + full) | Full E7 grid (v1: overhead + Mac/Linux core table) |

**When time runs short,** cut from the bottom of the must-have column upward: E5a first, then the E3(b) controlled perturbation.

**Machine time.** The HNSW and MaxSim papers hold the Mac and the box in fixed windows. Replays use CPU. Schedule them outside those windows, and never during a timed run ([[feedback_no_tests_during_mac_bench_queue]]).

## 13. Steps and gates

| Step | Work | Gate or output |
|---|---|---|
| S0 | Narrow literature check for the novelty sentence. Verify: tokenix's grep mode, Claude Code `head_limit`, the Codex cut, SWE-agent's cap, the primary source for "agents don't paginate", and the AGENTS.md tool statistics (2602.11988). Check the benchmark name for collisions. | Final novelty sentence |
| S1 | Trace miner, edit detector, path rewriting, dialect parser (`eval/grep-paper/mine/`). E0 census on 5k trajectories. **Check trajectories per task** (the E5a premise) and container-image availability. | Coverage, eligibility and premise tables |
| S2 | Replay harness: environments, order-independent fidelity tiers, source-record extraction, base-revision label mapping, reference renderer and token counter. Reuse `eval/grep-allocation-replay/`. | Tier audit on 100 calls |
| S3 | **E1 pilot, 500 dev calls**, with the shipped selector at a named commit. | **Gate A**: abstract framing |
| S4 | Reveal-order selector library: GNU, rg and engine inputs; fixed footer reservation; `--more`. Proofs written. Rivals installed as processes. | Property tests (nesting, continuation, phase-1 identity across divisor rules); native-lane parity |
| S5 | Pre-registration: tagged commit + Zenodo DOI naming the frozen selector commit. Repository split. L2 guide. | Public before any held-out replay |
| S6 | E2, E3, E4 on dev, then held-out once. L2 overlap annotation. | **Gate B**: net reduction against round robin |
| S7 | E5a observational ($0); core E7 (overhead; Mac and Linux). | v1 tables |
| S8 | Selection-track release (dataset card, DOI, CITATION.cff, baselines, scorer, licence fields) and arXiv v1. | The owner reads the draft |
| S9 | E5b pilot (about $20, owner go), then a full run under an owner ceiling. Full L2. | Owner approval |
| S10 | GNU adapter and coverage, E5c (owner go), E6, replay track, full E7, upstream PRs; ISSTA and ASE versions. | Owner approval |

## 14. Owner decisions

1. The title and the benchmark name.
2. Whether to target a non-archival ICSE workshop.
3. The tokenizers for the token budget.
4. The cost ceilings and the continuation model for E5b and E5c.
5. The second annotator for the L2 overlap.
6. Priority against the HNSW and MaxSim papers for machine time.
