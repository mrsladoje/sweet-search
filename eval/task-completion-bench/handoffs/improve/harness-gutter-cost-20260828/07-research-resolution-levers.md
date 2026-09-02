# What raises resolution at low cost for SWE-bench-style agents, 2025–2026

**Task R3.** Literature research only. No rollout was launched. Nothing on the evidence box was
read or written for this report. Every external claim is tagged **[W]** with a URL. Numbers from
our own programme are tagged **[M]** with the document that measured them; R3 did not re-measure
them.

---

## 0. Verdict

**Finding code is no longer the thing that decides whether an agent solves the task. It is the
thing that decides what the task costs. Four independent 2026 studies say the same: agents reach
the right file and still fail, and the failure is a wrong belief about what the code does.**

That is exactly the shape of our own result. Sweet reaches the same tasks as native and uses
13–28% fewer tool calls, and solves 120/198 against native's 125/198 — a difference of 3 rollouts
per cell, `p ≥ 0.72` [M, `FRESH-POOL-RESULTS.md` §1, §3].

Three consequences follow, and they set the whole ranking below.

1. **A better code-search tool is a cost lever, not a resolution lever.** The literature that
   measured this directly agrees, and one paper measured it against grep and found semantic
   retrieval usually *loses* [W].
2. **The largest published resolution gains come from verification, not retrieval** — and almost
   all of them are *shared* harness changes. In our benchmark a shared change lifts both arms and
   produces **zero A/B differential**. This is already our own rule
   (`SLATE-A-UBER.md` §9 item 9; `SLATE-B-UBER.md` §8 "FRAME delivery has zero differential").
3. **The instruction guide is the most likely place we are losing money for nothing.** Two 2026
   controlled studies find repository context files (`AGENTS.md` / `CLAUDE.md`) do not raise the
   solve rate and raise inference cost by **20–23%** [W]. Our M± guide is delivered by exactly
   that mechanism.

**The one lever that is both sweet-only and has a published effect size at low cost is
index-selected regression tests.** Nothing in either discard log kills it. Everything else either
lifts both arms or is already dead in our own graveyard.

---

## 0.1 Provenance and how much to trust each source

The paper-search, Semantic Scholar and OpenAlex tools available in this session return records up
to 2026-08. Where a number is load-bearing for the ranking, I fetched the paper and read the
tables. Where a number only supports a direction, the abstract record is the source. The table
says which.

| paper | id | basis for the numbers I quote |
|---|---|---|
| Does a Language Server Save Tokens for Coding Agents? | 2608.13568 | **full tables fetched** |
| Failure as a Process: An Anatomy of CLI Coding Agent Trajectories | 2607.09510 | **full findings list fetched** |
| Evaluating AGENTS.md | 2602.11988 | **full setup + results fetched** |
| all others below | — | abstract record only |

Anything resting on an abstract alone is marked in the lever table as `abstract-only`. Do not
spend against an `abstract-only` figure without reading the paper first.

---

## 1. (a) Is localisation still the bottleneck?

**No. Localisation is the cost bottleneck. Repair and verification are the resolution bottleneck.**

### 1.1 The ablation that settles it

**Beyond Localization: Recoverable Headroom and Residual Frontier in Repository-Level RAG-APR**
[W] https://arxiv.org/abs/2603.29067 — `abstract-only`.
The authors give three repository-level repair systems (Agentless, KGCompass, ExpeRepair) **oracle
localisation** on SWE-bench Lite. Quote: *"Oracle Localization improves all three systems, but
Oracle success still stays below 50%."* They then probe added context under matched same-token
filler controls and same-repository hard negatives. Quote: *"the best fixed probe adds only 6
solved instances beyond the native three-system Solved@10 union."*

Read that plainly. Hand the agent the answer to "where", and more than half the tasks still fail.
The remaining failure is "what to write there".

### 1.2 Agents already find the right file, and still fail

**Understanding Code Agent Behaviour** [W] https://arxiv.org/abs/2511.00197 — `abstract-only`.
Trajectories from OpenHands, SWE-agent and Prometheus on SWE-bench. Quote: *"while most
trajectories correctly identify problematic files (72-81% even in failures), success depends more
on achieving approximate rather than exact code modifications."* Also: *"failed trajectories are
consistently longer and exhibit higher variance than successful ones."*

### 1.3 The failure is a wrong belief, in measured proportions

**Failure as a Process** [W] https://arxiv.org/abs/2607.09510 — full findings fetched.
3,843 trajectories from seven frontier models across OpenHands, MiniSWE and Terminus2 on
Terminal-Bench; 1,794 filtered and hand-annotated over 63,000 steps. Root causes of 1,184 failed
trajectories:

| class | share | largest sub-cause |
|---|---:|---|
| **epistemic** | **57.9%** | false premise 30.7% |
| competence | 32.8% | knowledge gap 24.0% |
| environment | 9.4% | environment blocker 8.8% |

Epistemic dominance holds across every system, at 44% to 80% of failed trajectories. Pass rates
across the 21 model–scaffold cells range 19% to 45%.

### 1.4 Localisation is still where the money goes

**SHERLOC** [W] https://arxiv.org/abs/2606.24820 — `abstract-only`. Quote: *"LLM agents solve
repository-level coding tasks through multi-turn tool use, but utilize half their budget on
locating faults before editing."*

**FastContext** [W] https://arxiv.org/abs/2606.14066 — `abstract-only`. Quote: *"repository
exploration remains a major bottleneck: locating relevant code consumes substantial token budget
and pollutes the agent's context with irrelevant snippets."*

### 1.5 Where the localisation-side ceiling actually is

**SWE-Explore** [W] https://arxiv.org/abs/2606.07297 — `abstract-only`. 848 issues, 10 languages,
203 repositories, with line-level ground truth distilled from independent successful trajectories.
Their conclusion is the useful one for us: *"file-level localization is already strong for modern
methods, [while] line-level coverage and efficient ranking remain the key axes."*

**So the headroom is not "which file". It is "which lines, and how few".** That is a budgeting
problem, and it is §5 of our own fresh-pool report.

### 1.6 Verification is measurably broken, which caps everything

Four independent audits of SWE-bench grading say the same thing from different angles [W],
all `abstract-only`:

| study | finding |
|---|---|
| SWE-ABS https://arxiv.org/abs/2603.00520 | strengthened tests reject **19.71%** of previously passing patches; top agent 78.80% → **62.20%** |
| PatchDiff https://arxiv.org/abs/2503.15223 | **7.8%** of patches pass SWE-bench but fail the developer suite; **29.6%** behave differently from gold; inflation of **6.2** absolute points |
| UTBoost https://arxiv.org/abs/2506.09289 | 345 erroneous patches wrongly labelled passed; affects **40.9%** of Lite and **24.4%** of Verified leaderboard entries |
| SWE-bench+ https://arxiv.org/abs/2410.06992 | **32.67%** solution leakage, **31.08%** weak-test passes |

**This is our own resolution-floor result seen from outside** [M, memory
`project_resolution_floor_universal_wrongfix`]: wrong-fix is arm-universal and bounds every
retrieval lever.

---

## 2. (b) Does a better retrieval tool raise end-to-end resolution?

**Mostly no, and one paper measured the token cost of trying.**

### 2.1 The direct measurement: semantic retrieval versus grep

**Does a Language Server Save Tokens for Coding Agents?** [W]
https://arxiv.org/abs/2608.13568 — full tables fetched. This is the closest published analogue of
our sweet-versus-native question. It defines **tokens-to-success** and runs a five-arm ablation:
A grep+read+edit; B LSP-only; C both, agent chooses; D both, semantic mandated; E static repo-map
plus grep.

Symbol-named localisation, three models, 72 episodes each:

| model | grep tokens-to-success | LSP tokens-to-success | LSP premium | semantic use when free |
|---|---:|---:|---:|---:|
| Opus 4.8 | 920 | 971 | **+6%** | **0%** |
| Sonnet 4.6 | 606 | 1,319 | **+118%** | 4% |
| Haiku 4.5 | 11,911 | 8,799 | **−26%** | 6% |

Reference-completeness, five cross-file functions, three rollouts per arm:

| model | grep F1 | LSP F1 | delta | token premium |
|---|---:|---:|---:|---:|
| Opus 4.8 | 0.706 | 0.778 | **+0.072** | **+19%** |
| Sonnet 4.6 | 0.706 | 0.789 | +0.083 | +12% |
| Haiku 4.5 | 0.706 | 0.719 | +0.013 | −7% |

Multi-file rename, scored by real test execution, six tasks over 2–6 files:

| arm | pass@1 | site recall |
|---|---:|---:|
| A grep only | **1.00** | 1.000 |
| B LSP, location only | 0.67 | 0.930 |
| F LSP, reference text inline | 0.83 | 0.958 |

Tool choice in the free arm splits hard by task class: localisation 0%/4%/6% semantic, but
reference-completeness **57%/50%/45%**.

**Four things to take from this.**
1. Semantic retrieval buys precision, not tokens, for a strong model.
2. It helps the weakest model most. Our benchmark runs one mid-tier model on every arm
   [M, `GUTTER-MECHANISM-INVESTIGATION.md` §0 item 5], so we sit in the region where the premium
   is paid and the gain is small.
3. A location-only result **loses edits** that a text-carrying result keeps. Our ss-search now
   numbers its code blocks (`ba5b4ee`), which is the same repair as their arm F.
4. The gain is real and task-shaped: cross-file reference completeness. That is the one query
   class where an index beats grep on the numbers.

### 2.2 Two more papers pointing the same way

**Is Grep All You Need? How Agent Harnesses Reshape Agentic Search** [W]
https://arxiv.org/abs/2605.15184 — `abstract-only`. 116 questions, a custom harness plus Claude
Code, Codex and Gemini CLI. Quote: *"grep generally yields higher accuracy than vector retrieval
in our comparisons"* and *"overall scores still depend strongly on which harness and tool-calling
style is used, even when the underlying conversation data are the same."*

**That second clause is our own headline finding** [M, `FRESH-POOL-RESULTS.md` §1]: each of our
three harnesses ranks the three gutter forms differently.

**Beyond Semantic Similarity: direct corpus interaction** [W] https://arxiv.org/abs/2605.05242 —
`abstract-only`. An agent given only grep, file reads and shell *"substantially outperforms strong
sparse, dense, and reranking baselines on several BRIGHT and BEIR datasets"* with no embedding
model and no index.

### 2.3 Where retrieval-side work does pay

Three results show a gain, and all three change **what is returned**, not **how well it ranks**.

| system | effect | cost |
|---|---|---|
| **SHERLOC** [W] https://arxiv.org/abs/2606.24820 | **+5.95 pp** average resolve on SWE-bench Verified when locations *plus diagnostic findings* are injected into repair agents | **−36.7%** localisation tokens, **−23.1%** total |
| **FastContext** [W] https://arxiv.org/abs/2606.14066 | **up to +5.5%** resolution on SWE-bench Multilingual / Pro / SWE-QA | **up to −60%** coding-agent tokens |
| **LLM Agents Can See Code Repositories** [W] https://arxiv.org/abs/2606.14061 | accuracy *maintained or improved* when a structure graph supplements text | **−26%** input tokens |

All three are `abstract-only`. All three are separations: a cheap specialist explores, and the
expensive main context receives only paths, line ranges and a causal statement. This is our C-3
and R-1 concept, arriving from outside.

Related but weaker: LocAgent [W] https://arxiv.org/abs/2503.09089 reports *"improving downstream
GitHub issue resolution success rates by 12% for multiple attempts (Pass@10)"*; BLAgent [W]
https://arxiv.org/abs/2605.17965 reports *"improves end-to-end repair success by up to 25%"* at
*"over 18x cheaper than the strongest baseline"*; CoRet [W] https://arxiv.org/abs/2505.24715
reports *"+15 percentage points"* retrieval recall with **no** end-to-end resolution number.
Retrieval recall without a resolution number is not evidence for this programme.

---

## 3. (c) Cheap verification levers

**This is where the published gains are. Most of them are shared changes.**

| lever | measured effect | measured cost | source |
|---|---|---|---|
| **Regression-test selection** (TestPrune) | **+8.0–12.9% relative** issue-resolution inside Agentless, SWE-agent and Trae on Lite and Verified; **+6.2–9.0% relative** reproduction rate inside Otter | **$0.02–$0.05 per instance** | [W] https://arxiv.org/abs/2510.18270 |
| **Deterministic run-verification plus rollback-and-rerun** | catches **60%** of failures (**96%** with a coverage check) at **0 of 63** false positives; rollback recovers **45%** of failures against a **16%** resampling control (p=0.0005); task success **52% → 73%** | **~1 extra model call per run**; monitor ~200 µs/step | [W] https://arxiv.org/abs/2608.02464 |
| **Runtime diagnosis from multi-faceted reproduction tests** (SWE-Doctor) | **+8.0–8.9 pp** average resolution on SWE-bench Pro; 75.7% Verified / 59.4% Pro across five backends | not stated | [W] https://arxiv.org/abs/2607.00990 |
| **Bug-contrast validation feedback** (BSG-VA) | evidence-inadequate closure **−7.8 pp** (p=0.0029); bug-discriminating evidence **+7.4 pp** (p=0.011); **no detectable change in repair success** | one extra replay per validation command | [W] https://arxiv.org/abs/2607.28871 |
| **Reproduction-test agent** (ReProAgent) | reproduces **58.43%** / **70.30%** of SWT-bench-lite / verified issues | **$0.14 per instance** | [W] https://arxiv.org/abs/2607.09123 |
| **Functional majority voting** (FMV) | *"substantially boosting performance on LiveCodeBench without a large compute overhead"*; no self-improvement past the base ceiling | k samples | [W] https://arxiv.org/abs/2604.15618 |
| **Trained trajectory verifier** (SWE-Gym) | 26.0% → 32.0% Verified for open-weight agents | k rollouts plus a verifier pass | [W] https://arxiv.org/abs/2412.21139 |

All `abstract-only` except where noted.

### 3.1 The two honest cautions in this block

**Reproduction tests are not free wins.** SWE-Doctor's own preliminary study says naive use hurts:
*"fail-to-fail BRTs can mislead agents, while even fail-to-pass BRTs bring limited or negative
gains… fail-to-pass BRTs may cover only one manifestation of the reported issue, leading to partial
patches"* [W]. Their gain comes from *running and debugging* the tests, then handing over a runtime
diagnosis. The test alone is not the lever.

**Better evidence did not become better repair.** BSG-VA is the most disciplined study in this set.
Across 3,730 validation events in 643 rollouts on 110 tasks it finds **46.0% of positive comparable
validation events carry no bug-discriminating information**, and **23.8% of baseline rollouts close
with a patch whose entire positive evidence base is of that kind**. Feeding the buggy-state replay
back improved the *evidence* by 7.4 pp and moved *repair success* not at all. Both effects fell
below the authors' own pre-registered 10-point smallest effect size of interest [W].

**Take that as the prior for any verification lever we build.** It matches our own record: P3
tests-first was rejected twice [M, memory `project_p3_tests_first_rejected`], and the completeness
card died at `$0` [M, memory `project_lever4_completeness_card_dead`].

---

## 4. (d) Failure-mode taxonomies, with proportions

### 4.1 The best-powered taxonomy

**Failure as a Process** [W] https://arxiv.org/abs/2607.09510 — fetched. Proportions in §1.3
above. The process findings matter more than the categories:

- decisive error at a **median step 7** of a median 27-step failed run;
- **median recovery window of one step** before lock-in; 60.9% leave at least one step, 43.9%
  leave three or more;
- the first *observable* signal arrives about **10 steps later**, median step 16;
- after lock-in **82%** of runs keep executing without progress;
- *"repairs the wrong problem"* accounts for **39% of wasted execution**, appearing in **24%** of
  failed trajectories, median 21 remaining steps;
- **71%** of *successful* runs recover from at least one error — errors are normal, non-recovery
  is not;
- successful runs answer an error signal **92%** of the time; failed runs **37%**, at nearly equal
  observable-error rates (74% versus 72%);
- **26%** of failed trajectories fabricate success, 84% of it starting at or after lock-in.

### 4.2 Cross-checks from other 2026 studies

| study | proportion |
|---|---|
| **Confident and Wrong** [W] https://arxiv.org/abs/2603.25764 | silent semantic failure covers **80%** of Llama 4's failing runs and **68%** of GPT-5's, over 1,750 trajectories on 50 Verified tasks. GPT-5 submits on 100% of runs and resolves 44% |
| **SWE-bench Science** [W] https://arxiv.org/abs/2608.19799 | four recurring mechanisms: knowledge/abstraction deficit; misguided exploration or surface repair; incomplete repair coverage; failure to generalise. Best agent below 50% pass@1 |
| **SWE-Touch** [W] https://arxiv.org/abs/2608.02499 | a conflicting workspace edit costs **7.7 pp** resolve rate; agents *"retain conflicting code or replace it without sufficiently re-inspecting the repository"* |
| **Model or Harness?** [W] https://arxiv.org/abs/2607.28802 | 41 failure modes assigned to an interaction edge plus a fault side, so each failure names its repair owner: model, harness, environment or grader. Judge agreement Cohen's κ=0.76 |

All `abstract-only`.

### 4.3 What this says about our own taxonomy

Our categories map cleanly:

| our label | their label | their share |
|---|---|---|
| wrong fix | epistemic — false premise | 30.7% of decisive errors |
| incomplete | competence — knowledge gap / incomplete repair coverage | 24.0% |
| not localised | (no separate class; folded into epistemic) | small |
| environment | environment blocker | 8.8% |

**"Not localised" is not a top-level class anywhere in the 2026 literature.** That is the same
conclusion as §1, from a second direction.

---

## 5. (e) Instruction length, and structured self-summaries

### 5.1 Repository context files do not raise resolution, and they cost 20%

**Evaluating AGENTS.md** [W] https://arxiv.org/abs/2602.11988 — full setup and results fetched.
Four agent/model pairs: Claude Code with Sonnet-4.5, Codex with GPT-5.2, Codex with GPT-5.1-mini,
Qwen Code with Qwen3-30b-coder. Two task sets: SWE-bench Lite (300 tasks, 11 repositories,
LLM-generated context files) and CTXbench (138 instances, 12 repositories with developer-committed
files).

| condition | resolve-rate change | cost change |
|---|---:|---:|
| LLM-generated context file, SWE-bench | **−0.5%** (p=0.87) | **+20%** |
| LLM-generated context file, CTXbench | **−2%** (p=0.37) | **+23%** |
| developer-committed context file, CTXbench | +2.4% (p=0.21) | — |

The mechanism is explicit and is the important part. Instructions **are** obeyed: *"uv is used 1.6
times per instance on average when mentioned in the context files, compared to fewer than 0.01
times when it is not mentioned."* Repository overviews are not useful: they *"do not meaningfully
reduce"* the time to find the relevant files. So the agent obediently does more testing and
exploration, pays 20% more, and solves the same tasks.

**Second, independent replication.** *Do Context Files Help Coding Agents?* [W]
https://arxiv.org/abs/2607.27250 — `abstract-only`. Claude Code and Codex, 17 real tasks, 3
repositories, 288 gold-test-evaluated runs. Quote: *"Context strategy does not measurably move
correctness on either agent (bounded to <=10-15pp via equivalence testing)."* Their triage explains
why: *"agents fail on implementation skill — feature design, pattern selection, exact wiring — not
missing repository knowledge that a context file could supply."*

**This is the single most decision-relevant external result for us.** The sweet arm's M± guide is
delivered through exactly this channel [M, memory `project_mpm_delivery_via_memory_file`]. Two
studies say that channel buys obedience and costs money.

### 5.2 Long standing instructions decay over a long horizon

**HANDBOOK.md** [W] https://arxiv.org/abs/2607.25398 — `abstract-only`. 65 agentic tasks under
expert-written procedures of 20–124 pages, 824 programmatic criteria. Under strict grading the
strongest model passes **36.2%** of trials and most frontier models stay below 25%. Named failure
patterns: an in-environment request overrides the standing policy; a required check is performed
and then acted against; *"lose rule details over long horizons"*; compliance is reported but not
achieved.

**Instruction granularity is not monotone.** *Mini-BEHAVIOR-Gran* [W]
https://arxiv.org/abs/2604.17019 — `abstract-only` — finds a **U-shaped** relation between
instruction granularity and performance, with peaks at both fine and coarse extremes, and links
the coarse peak to shallow grounding. More words is not a dial.

**Guidance can anchor.** SWE-bench Science [W] runs a paired ablation removing explicit scientific
guidance while keeping the repository context: *"well-grounded information can constrain repair and
improve average performance and token efficiency, whereas poorly aligned guidance can induce
anchoring and does not necessarily improve exact repair success."*

### 5.3 Structured self-summaries: reviewability, not correctness

**Software Delegation Contracts** [W] https://arxiv.org/abs/2606.17099 — `abstract-only`. 64 agent
runs, 10 tasks, two model tiers, three conditions: plain issue prompt; explicit delegation
contract; contract plus a required evidence bundle. 192 blinded reviews.

- Objective outcomes: **no change.** *"all 64 runs passed hidden acceptance checks, with zero scope
  violations."*
- Reviewability: evidence sufficiency improved in 22 of 30 paired comparisons and worsened in none
  (+0.83 on a 5-point scale, p < 0.0001, Cliff's δ = 0.66); reviewer ambiguity fell (p = 0.035).
- Price: **+13% agent tokens and +38% wall-clock time**, worse for the weaker model tier.
- Their own summary: *"delegation contracts bought reviewability rather than correctness."*

**The one place a structured state summary did help is not our setting.** Agent-BRACE [W]
https://arxiv.org/abs/2605.11436 — `abstract-only` — reports **+14.5%** (Qwen2.5-3B) and **+5.3%**
(Qwen3-4B) on long-horizon partially observable embodied tasks. But the belief state is *trained by
reinforcement learning*, not prompted, and the environments are not code. A prompted per-turn
summary is the delegation-contract result, not the Agent-BRACE result.

**Context pruning is the version of this that works.** SWE-Pruner [W]
https://arxiv.org/abs/2601.16746 — `abstract-only` — trains a 0.6B skimmer to select relevant lines
given an explicit goal, and reports **23–54% token reduction on SWE-bench Verified while even
improving success rates**. It deletes, it does not summarise.

---

## 6. Ranked levers

Ranking is by expected resolution gain per dollar, with a hard demotion for any lever that reaches
both arms. **A shared harness or prompt change has zero A/B differential in this benchmark.** It
may still be worth shipping as a product improvement. It cannot be the headline.

Each row is checked against `SLATE-A-UBER.md` §9 and `SLATE-B-UBER.md` §8.

### L1 — Index-selected regression tests **[sweet-only, if built as an index capability]**

- **Mechanism.** The index already knows which tests touch which symbols. Return the *small*
  relevant subset instead of "run the suite". TestPrune's own argument is that large suites *"exceed
  context limits, introduce noise, and inflate inference costs"* [W].
- **Effect.** +8.0–12.9% relative resolution inside three separate agents; +6.2–9.0% relative
  reproduction rate [W] https://arxiv.org/abs/2510.18270 — `abstract-only`.
- **Cost.** $0.02–$0.05 per instance at 2025 prices. Against our $0.0093–$0.0207 per rollout that
  is not cheap and must be re-priced for `gpt-5.6-luna` before anyone believes it.
- **Differential.** Sweet-only **only if** the selection comes from the index. If it is a prompt
  clause telling the agent which tests to run, it is shared and the differential is zero.
- **Discard-log check.** Not discarded. Nearest neighbours: `SLATE-A` §9 item 9 (synchronous
  `run_tests` — correct, but shared, so zero differential) and P3 tests-first, rejected twice
  [M]. Both are distinct: this selects **existing** tests, it does not author new ones and does not
  change when tests run.
- **Cheapest falsifier at `$0`.** Over the retained fresh-pool traces, count how many `run_tests`
  calls ran a suite when a symbol-scoped subset existed, and how many rollouts died after a
  timeout or an unreadable test dump. If that is under one call per rollout, the lever has no
  surface here.

### L2 — Exploration handed to a cheap specialist that returns paths, line ranges and a cause **[sweet-only]**

- **Mechanism.** Separate exploring from solving. The main context receives a small typed object,
  never the exploration transcript.
- **Effect.** FastContext up to **+5.5%** resolution with up to **−60%** agent tokens [W]; SHERLOC
  **+5.95 pp** with **−23.1%** total tokens [W]. Both `abstract-only`.
- **Cost.** A second model. Cheap only if the specialist is small.
- **Differential.** Sweet-only as an `ss-*` service. This is C-3 in `SLATE-A-UBER.md` §5, still
  `GATED`, not discarded.
- **Two traps, both ours.** `SLATE-A` §9 item 10: free subagents are an accounting exploit — every
  request must be priced. And our claude-code ledger **excludes** subagent spend
  [M, memory `project_claudecode_subagent_offledger_cost`], which already flipped a headline from
  +2.2% to −3.0%. A delegation lever measured on that ledger will look free and will not be.
- **Counter-evidence from our own run.** On claude-code, **native** delegates in 15 task-cells
  against sweet's 6 [M, `FRESH-POOL-RESULTS.md` §2]. Native already has this lever. Sweet's current
  advantage is that it does not need it. Adding delegation to sweet may erase a real win.

### L3 — Adaptive, query-conditioned output budgeting for `ss-read` **[sweet-only]**

- **Mechanism.** Decide *how many lines to return* from the query and the remaining budget, not
  from a fixed per-call cap.
- **Effect.** SWE-Pruner: **23–54%** token reduction with success maintained or improved [W],
  `abstract-only`.
- **Our own support.** This is the one mechanism our fresh-pool run surfaced. On harder tasks
  native narrowed its own reads by 32–63% per call while sweet's stayed flat, and that is where the
  old −10% cost lead went [M, `FRESH-POOL-RESULTS.md` §4].
- **Differential.** Sweet-only. Native has no read budget to change.
- **Discard-log check — read this carefully.** `SLATE-A` §9 item 6 bans compaction as a mechanism.
  `SLATE-B` §8 bans *"return the Ocean slice more compactly"*. **This lever is only admissible if
  it changes which lines are delivered, not how the same lines are rendered.** If the design
  reduces to re-rendering, it is already dead. State the distinction in the pre-registration or
  expect it to be killed at review.

### L4 — Structure graph as a supplement to text, not a replacement **[sweet-only]**

- **Effect.** **−26%** input tokens with accuracy maintained or improved [W]
  https://arxiv.org/abs/2606.14061; a vision-only setup *degrades* accuracy and *raises* cost.
  RepoGraph [W] https://arxiv.org/abs/2410.14684 and LocAgent [W] https://arxiv.org/abs/2503.09089
  (+12% Pass@10) point the same way. All `abstract-only`.
- **Differential.** Sweet-only. Our 2-hop graph expansion is already fast, a few milliseconds
  [M, memory `project_2hop_latency`].
- **Discard-log check.** Overlaps reserve concept R-1 (turn-0 dossier) in `SLATE-A-UBER.md` §6, not
  discarded but explicitly weakly gated. Do not double-count with L2.
- **Caution.** Our own `rotate20` screen found roughly zero retrieval headroom
  [M, memory `project_no_retrieval_headroom_rotate20`]. Expect the token saving, not the solve.

### L5 — Cross-file reference completeness as a *targeted* retrieval mode **[sweet-only]**

- **Mechanism.** The one query class where the LSP study found semantic retrieval beating grep:
  "find every place that uses this". +0.072 to +0.083 F1 at +12–19% tokens, and agents choose it
  unprompted about half the time on those tasks [W] https://arxiv.org/abs/2608.13568 — fetched.
- **Differential.** Sweet-only.
- **Discard-log check — near collision.** `SLATE-A` §9 item 3 discards *"more sibling retrieval"*
  and `SLATE-B` §8 discards *"search-time sibling or mirror widening"*, both because ambient
  presence did not produce action. **The distinction that keeps this alive is completeness scored
  against execution, not presence in a result list.** The LSP paper's own honest finding is that a
  reference set still misses comments and strings, so grep won its rename tasks 1.00 to 0.67.
  Ship this only with a measured completeness metric, or it is the discarded idea again.

### L6 — Deterministic run-verification and rollback-rerun **[SHARED — zero A/B differential]**

- **Effect.** The largest number in the whole corpus: failures caught 60% (96% with a coverage
  check) at **0 of 63** false positives; rollback recovers 45% against a 16% control; task success
  **52% → 73%** for about one extra model call [W] https://arxiv.org/abs/2608.02464,
  `abstract-only`.
- **Differential.** **Zero.** It is harness machinery and it lifts both arms. This is precisely
  `SLATE-A` §9 item 9.
- **Disposition.** Worth doing as product correctness. Never report as sweet winning.

### L7 — Reproduce, then diagnose at runtime, then fix **[SHARED unless built as a tool]**

- **Effect.** SWE-Doctor **+8.0–8.9 pp** on SWE-bench Pro [W] https://arxiv.org/abs/2607.00990;
  ReProAgent 58.43%/70.30% reproduction at **$0.14** per instance [W]
  https://arxiv.org/abs/2607.09123. Both `abstract-only`.
- **Counter-evidence.** BSG-VA moved evidence quality by 7.4 pp and repair success by nothing [W].
  SWE-Doctor's own preliminary study says naive reproduction-test guidance is neutral to negative.
- **Discard-log check.** `SLATE-B` §8 discards *"prompt codex to poll `run_tests`"* — the FRAME
  already mandates the wait and the agent ignored it. P3 tests-first rejected twice [M].
- **Disposition.** Do not re-open as a prompt. If re-opened at all, it must be an `ss-*` runtime
  service that returns a diagnosis, which is L2 wearing different clothes.

### L8 — Best-of-K and patch tournaments **[SHARED, and the headroom saturates]**

- **Effect.** SWE-Gym verifier 26.0% → 32.0% for open-weight agents [W]; FMV boosts
  LiveCodeBench and finds *"no evidence of self-improvement beyond the base model's performance
  ceiling"* [W]. Beyond Localization: *"Extra candidate diversity still helps inside the sampled
  10-patch pools, but that headroom saturates quickly"* [W]. All `abstract-only`.
- **Discard-log check.** This is C-8 / P7, `MOONSHOT`, and our own P7 forge gate passed **on cost
  only** [M, memory `project_w0_p7_gate_and_ssedit`].
- **Disposition.** Multiplies spend. Not a low-cost lever.

### L9 — Semantic code search as a general replacement for grep **[sweet-only, but NEGATIVE evidence]**

- **Effect.** +6% to +118% token premium on symbol localisation; agents use it 0–6% of the time
  when free; grep wins multi-file renames 1.00 to 0.67 [W] https://arxiv.org/abs/2608.13568 —
  fetched. Grep beats vector retrieval across harnesses [W] https://arxiv.org/abs/2605.15184.
  Shell-only direct corpus interaction beats dense retrieval on BRIGHT and BEIR [W]
  https://arxiv.org/abs/2605.05242.
- **Disposition.** **Do not pursue as a resolution lever.** Pursue L5 instead, which is the
  measured slice of this that works.

### L10 — Longer or richer instruction guides **[SHARED delivery, NEGATIVE evidence]**

- **Effect.** −0.5% (p=0.87) and −2% (p=0.37) resolve; **+20%** and **+23%** cost [W]
  https://arxiv.org/abs/2602.11988 — fetched. Independently: no measurable effect, bounded to
  ≤10–15 pp over 288 runs [W] https://arxiv.org/abs/2607.27250.
- **Discard-log check.** `SLATE-A` §9 item 11; `SLATE-B` §8 four separate rows (*"put the YARP
  architecture rule in a prompt"*, *"inline linked URL/spec content"*, *"strengthen the existing
  sibling/completeness doctrine"*, *"stale-test annotation"*); and our own clause graveyard
  [M, memory `project_clause_candidate_dead`].
- **Disposition.** **Dead, twice over.** The new and useful part is the inverse question below.

### L11 — Structured per-turn self-summaries and evidence bundles **[SHARED, NEUTRAL on correctness]**

- **Effect.** +13% tokens, +38% wall clock, no correctness change, better reviewability [W]
  https://arxiv.org/abs/2606.17099, `abstract-only`.
- **Discard-log check.** `SLATE-A` §9 item 6 (compact self-state) and item 11 (completeness cards);
  our own completeness card died at `$0` [M, memory `project_lever4_completeness_card_dead`].
- **Disposition.** Dead as a resolution lever. Live as a *reviewability* product feature, which is
  a different claim and needs a different benchmark.

---

## 7. The inverse lever the literature hands us

**Nobody has asked whether removing the M± guide would make sweet cheaper at the same solve rate.**

The case for asking:

- Two 2026 studies measure context files at **−0.5% to −2%** resolution and **+20% to +23%** cost
  [W]. Our guide is delivered by that mechanism [M].
- Our own arithmetic is compatible. Sweet is `+0.3%` on codex, `+3.3%` on opencode and `−3.9%` on
  claude-code against native per rollout [M, `FRESH-POOL-RESULTS.md` §1], with resolution flat.
- The AGENTS.md study explains the sign: the agent **obeys** the guide, does more work, pays more,
  and solves the same tasks [W].
- It costs nothing extra to run. The arm already exists in every cell; the new arm is
  "sweet tools, no guide".

This is not in either discard log. It is not a new tool and not a new prompt. It is the removal of
a shared text block from one arm, which makes it a clean sweet-only differential in the direction
the literature predicts.

**Falsifier.** 22 tasks × 3 reps × 3 harnesses, sweet-with-guide against sweet-without-guide,
matched caps. Kill it if solves drop by the pre-registered bar. Bank it if cost falls by more than
5% at flat solves.

---

## 8. What to do with this

**Ranked, with the honest expectation.**

| rank | lever | differential | expected effect here | first cost |
|---|---|---|---|---|
| 1 | **Drop the M± guide from the sweet arm and measure** (§7) | sweet-only | cost down, solves flat | one 198-rollout cell set |
| 2 | **L3 adaptive read budgeting** | sweet-only | cost down; matches our §4 mechanism | `$0` trace replay first |
| 3 | **L1 index-selected regression tests** | sweet-only if index-side | +8–13% relative, unverified at our price | `$0` census of `run_tests` scope |
| 4 | **L2 exploration specialist** | sweet-only | −60% tokens, +5.5% solves, but native already delegates | `$0` sidechain re-pricing |
| 5 | **L5 reference completeness** | sweet-only | +0.07 F1 on one query class only | `$0` count of cross-file tasks in the pool |
| — | L6 deterministic verification | **shared** | biggest published gain, **zero differential** | ship as correctness |
| — | L4, L7, L8 | mixed | bounded or expensive | park |
| — | L9, L10, L11 | — | **negative or neutral evidence** | do not re-open |

**The single sentence for the programme.** The literature agrees with our own three-harness run:
retrieval decides cost, verification decides resolution, and the instruction guide decides neither
while charging twenty percent.

---

## 9. Open questions this research did not settle

1. **Does TestPrune's +8–12.9% survive at our price and our model?** Every figure is from 2025
   frontier models on Python-only Lite and Verified. Our pool is multilingual and our per-rollout
   cost is under two cents.
2. **Is our un-numbered-surface repair (`ba5b4ee`) the same repair as the LSP paper's text-inline
   arm F?** Their arm F recovered most of the location-only gap. Ours has never been measured for
   resolution, only for consistency.
3. **What fraction of our 22-task pool is a cross-file reference-completeness task?** L5 lives or
   dies on that count and it is a `$0` question.
4. **Does removing the guide break the `sufficient=` trailer or the M± stop discipline?** The guide
   carries behaviour we have measured before. Removal is not free of side effects.
5. **Is our resolution ceiling the grader's or the agent's?** Four audits say 19.7–31% of "solved"
   patches are semantically wrong [W]. We have never run the equivalent audit on our own goldens.
6. **Can the epistemic-error taxonomy be applied to our traces at `$0`?** Failure as a Process gives
   a fixed 14-finding protocol and a reported judge agreement of κ=0.76 on a related taxonomy. Our
   retained traces are complete enough to try it.

---

## 10. Every source cited

| topic | paper | URL |
|---|---|---|
| localisation ceiling | Beyond Localization | https://arxiv.org/abs/2603.29067 |
| trajectory behaviour | Understanding Code Agent Behaviour | https://arxiv.org/abs/2511.00197 |
| failure process | Failure as a Process | https://arxiv.org/abs/2607.09510 |
| failure ownership | Model or Harness? | https://arxiv.org/abs/2607.28802 |
| silent wrong fixes | Confident and Wrong | https://arxiv.org/abs/2603.25764 |
| science-domain failures | SWE-bench Science | https://arxiv.org/abs/2608.19799 |
| workspace-change blindness | SWE-Touch | https://arxiv.org/abs/2608.02499 |
| grading inflation | SWE-ABS | https://arxiv.org/abs/2603.00520 |
| grading inflation | PatchDiff | https://arxiv.org/abs/2503.15223 |
| grading inflation | UTBoost | https://arxiv.org/abs/2506.09289 |
| grading inflation | SWE-bench+ | https://arxiv.org/abs/2410.06992 |
| semantic vs lexical retrieval | Does a Language Server Save Tokens? | https://arxiv.org/abs/2608.13568 |
| grep vs vector, harness effect | Is Grep All You Need? | https://arxiv.org/abs/2605.15184 |
| shell-only retrieval | Beyond Semantic Similarity (DCI) | https://arxiv.org/abs/2605.05242 |
| diagnostic localisation | SHERLOC | https://arxiv.org/abs/2606.24820 |
| exploration subagent | FastContext | https://arxiv.org/abs/2606.14066 |
| exploration benchmark | SWE-Explore | https://arxiv.org/abs/2606.07297 |
| structure graphs | LLM Agents Can See Code Repositories | https://arxiv.org/abs/2606.14061 |
| structure graphs | RepoGraph | https://arxiv.org/abs/2410.14684 |
| graph localisation | LocAgent | https://arxiv.org/abs/2503.09089 |
| ranked localisation | SweRank | https://arxiv.org/abs/2505.07849 |
| retrieval for editing | CoRet | https://arxiv.org/abs/2505.24715 |
| agentic file localisation | BLAgent | https://arxiv.org/abs/2605.17965 |
| single-tool RL localisation | One Tool Is Enough (RepoNavigator) | https://arxiv.org/abs/2512.20957 |
| regression-test selection | TestPrune | https://arxiv.org/abs/2510.18270 |
| deterministic verification + rollback | Real-Time Detection and Repair | https://arxiv.org/abs/2608.02464 |
| reproduction + runtime diagnosis | SWE-Doctor | https://arxiv.org/abs/2607.00990 |
| validation-evidence adequacy | BSG-VA | https://arxiv.org/abs/2607.28871 |
| reproduction-test agent | ReProAgent | https://arxiv.org/abs/2607.09123 |
| fix + test cogeneration | Dynamic Cogeneration of BRT | https://arxiv.org/abs/2601.19066 |
| majority voting | Majority Voting for Code Generation (FMV) | https://arxiv.org/abs/2604.15618 |
| trained verifiers | SWE-Gym | https://arxiv.org/abs/2412.21139 |
| context pruning | SWE-Pruner | https://arxiv.org/abs/2601.16746 |
| context files | Evaluating AGENTS.md | https://arxiv.org/abs/2602.11988 |
| context files | Do Context Files Help Coding Agents? | https://arxiv.org/abs/2607.27250 |
| context files in the wild | Agent READMEs | https://arxiv.org/abs/2511.12884 |
| long standing instructions | HANDBOOK.md | https://arxiv.org/abs/2607.25398 |
| instruction granularity | Mini-BEHAVIOR-Gran | https://arxiv.org/abs/2604.17019 |
| structured deliverables | Software Delegation Contracts | https://arxiv.org/abs/2606.17099 |
| trained belief state | Agent-BRACE | https://arxiv.org/abs/2605.11436 |
| scaffold architecture | Inside the Scaffold | https://arxiv.org/abs/2604.03515 |
| harness configuration practice | Harness Engineering for Agentic AI Coding Tools | https://arxiv.org/abs/2602.14690 |
| the original ACI result | SWE-agent | https://arxiv.org/abs/2405.15793 |
| the pipeline baseline | Agentless | https://arxiv.org/abs/2407.01489 |

**Scripts written:** none. This task was literature research; no code was needed and none was run
on the evidence box.
