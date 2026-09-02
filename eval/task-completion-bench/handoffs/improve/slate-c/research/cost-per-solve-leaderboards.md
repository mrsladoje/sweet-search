# Cost-per-solve evidence for SWE-bench-style agents, 2026

**Task:** Slate C research, "cost-per-solve-leaderboards". **Date:** 2026-09-02.
**Method:** web research on primary sources, plus three read-only `$0` measurements on the
evidence box over `rows.json` files that already exist. No rollout was launched. Nothing was
written under `results/`. No HO2 run was opened. No grading log was read.

Tags on every number: **[M]** measured by me with the named script, **[C]** read from code or a
tool contract, **[W]** web source with URL, **[I]** inferred with the arithmetic shown.

---

## 0. Verdict

**The brief's two standing positions come out of the 2026 literature split. "Requests, not bytes,
drive cost" is supported by three independent controlled interventions and by our own traces,
though the dollar elasticity on our run is blunted by a near-perfect prefix cache. "Retrieval
decides cost while verification decides resolution" is contradicted on both halves by the two
papers that measured each half directly.**

Five findings carry the report.

1. **A published, controlled, same-harness A/B of exactly sweet's mechanism exists and it wins.**
   *Code Isn't Memory* (arXiv:2606.22417, 21 Jun 2026) toggles a structural codebase index on and
   off inside one harness on one model. Index on: resolve 41.9% → 50.4% (paired Wilcoxon
   p = 0.003), localisation acc@5 44.3% → 84.5% (p < 0.0001), **turns 36.2 → 28.3** (p < 0.0001),
   per-cell cost difference statistically null (p = 0.73), cost per solved task $2.84 → $2.30 [W].
   Retrieval decided resolution there, not cost. The differences from our setup are enumerable and
   three of them are already open items in our register (§5.1).

2. **Optimising cost per solved task picks the weakest tool set.** On the harness axis, the
   cheapest-per-solve option is the least capable one in 2 of 2 model groups of *Claw-SWE-Bench*
   and in 5 of 6 models of *SWE-Bench ProMax* [W, arithmetic mine, §2.3]. Cost per solve is a
   misleading headline for a tooling change; "cost at parity" is the right one. That vindicates
   the programme's existing choice and it is the reason a `$/solve` win would not be publishable
   on its own.

3. **Cutting requests cuts input tokens faster than proportionally, in three separate
   experiments.** Discouraging test writing cut API calls 35.4% and input tokens 49.0% on one
   model, 24.5% and 32.9% on another [W]. Early termination cut calls 20.8% and input tokens 29.9%
   on average [W]. Ratio 1.34 to 1.44. **On our own codex traces the elasticity of billed input
   tokens to tool calls is 1.06 to 1.14, and of realised dollars 0.84 to 0.95** [M]. The dollar
   figure sits below one because our prefix cache hits 99.3–100% and prices every re-send at one
   tenth. The request count is still the largest controllable term on codex; nothing else in the
   register moves 9%.

4. **No level of the data says fewer requests raise resolution, and the one level that isolates
   the task says the opposite.** Terminal-Bench 2.0 reports "essentially no correlation between
   the number of average turns per trial and model success rates" [W]. *Beyond Resolution Rates*
   (9,374 trajectories) finds failed runs 14–111% longer **within an agent**, but resolved runs 10%
   longer **within a task** (44.0 vs 39.6 steps on 263 of 416 tasks, p < 10⁻⁸) [W]. Our own cells
   reproduce only the confounded within-agent version: failed rollouts run 78% to 167% more tool
   calls than solved ones in all six cells [M].

5. **New, measured, and unpriced: the sweet arm writes a narrower patch than native on every
   harness.** Mean files touched, native against sweet: codex 1.23 / 1.20, opencode 1.33 / 1.14,
   claude-code 1.27 / 1.11. Rollouts touching three or more files, opencode: native 9 of 66, sweet
   1 of 63 [M]. On this pool, whose median task needs one file, that is free. ProMax names "modify
   fewer files than the gold patch requires" as the dominant failure on multi-file work [W]. §6.3.

Two corrections to documents already in this programme, five candidate seeds, and one new
measurement trap follow in §6, §7 and §8.

---

## 1. What the leaderboards actually publish

The question was which 2026 leaderboards report cost per resolved task. Answer: **almost none
report cost per *resolved* task; three report cost per *attempted* task, and one reports neither.**

| leaderboard | cost column | what it means | date checked |
|---|---|---|---|
| SWE-rebench, https://swe-rebench.com/ | **"Cost per Problem ($)"** plus "Tokens per Problem" with a cached-token share | per attempted instance, not per solve | 2026-09-02 [W] |
| Terminal-Bench (tbench.ai) leaderboard | columns are RANK, MODEL, AGENT, RESOLUTION RATE, **COST**, **TOKENS** | per attempted task; the table is client-rendered and the rows did not come back over HTTP | 2026-09-02 [W][M] |
| Artificial Analysis, Terminal-Bench v2.1 | "Cost per Task", broken into **input / cache hit / cache write / reasoning / answer** | per attempted task; charted, not tabulated | 2026-09-02 [W] |
| Scale SEAL, SWE-bench Pro public | none. Notes only that some models ran "with a capped cost limit and turn limit of 50", others "uncapped cost and … turn limit of 250" | — | 2026-09-02 [W] |
| Epoch AI, SWE-bench Verified | none. Publishes a token budget instead: "2M uncached read/write tokens (including reasoning), and 20M cached token reads"; 484 of 500 samples; scaffolding upgraded 2026-02-12 | — | 2026-09-02 [W] |

Three things follow.

- **The Artificial Analysis decomposition is our decomposition.** It splits cost per task into
  input, cache hit, cache write, reasoning and answer tokens [W]. That is the same five-way split
  `02-cost-decomposition.md` uses. Publishing a re-send share is now industry-normal, not a
  programme idiosyncrasy.
- **SWE-rebench is the only leaderboard that publishes tokens and cost side by side.** Sample rows
  on 2026-09-02: Fable 5 at 64.5% ± 1.41 resolved, $4.40 and 2,518,308 tokens per problem;
  Grok 4.5 at 63.8% ± 0.60, $1.47 and 2,429,424 tokens; Claude Code at 60.4% ± 1.03, $3.39 and
  3,341,581 tokens. Window 2026-05-15 to 2026-07-01, 111 problems from 65 repositories [W].
  Two rows within 0.7 points of each other differ 3× in cost.
- **Scale's turn caps are the only public statement of a turn budget on a major leaderboard**, and
  the two settings differ 5× (50 versus 250) [W]. Nobody publishes what the cap costs.

**Implication for sweet, all three harnesses.** There is no external leaderboard we could enter
that would show a `$/solve` number for a tool set on a fixed harness. Every cost column in the
table above varies the *model*, not the tooling. The measurement this programme runs — one model,
one harness, tools varied — is not published anywhere except in §5.1's paper. So the head-to-head
we are building is genuinely novel; it is also unbenchmarkable against a public number.

---

## 2. Cost-versus-resolution frontiers, from primary sources

### 2.1 Claw-SWE-Bench — the harness is the experimental variable

*Claw-SWE-Bench: A Benchmark for Evaluating OpenClaw-style Agent Harnesses on Coding Tasks*,
arXiv:2606.12344v1, 10 Jun 2026 [W https://arxiv.org/html/2606.12344v1]. 350 instances, 8
languages, 43 repositories, drawn from SWE-bench-Multilingual and SWE-bench-Verified-Mini, scored
by the upstream SWE-bench evaluator. Every system shares the outer budget and reports total API
cost, wall-clock and cache-hit rate next to Pass@1.

`06-research-cost-mechanics.md` §6.4 already cites this paper for its Pass@1 spread and its
cache-hit range. **What that section did not take is the turn column and the frontier.** Table 2,
OpenClaw held fixed, model varied, 350 instances (Resolved / Pass@1 / total cost / Turns / Cache)
[W]:

| model | resolved | Pass@1 | total cost | turns | cache | $/resolved [I] |
|---|---:|---:|---:|---:|---:|---:|
| GPT 5.5 | 273 | 78.0% | $1,399.1 | 67.0 | 97.3% | $5.125 |
| Claude Opus 4.7 | 270 | 77.1% | $1,082.0 | 61.6 | 97.0% | $4.007 |
| GLM 5.1 | 257 | 73.4% | $277.0 | 80.6 | 96.5% | $1.078 |
| DeepSeek-V4 Flash | 246 | 70.3% | $8.2 | 51.2 | 98.5% | **$0.033** |
| Qwen 3.6-flash | 231 | 66.0% | $71.5 | 87.9 | 97.6% | $0.310 |
| MiniMax M2.7 | 215 | 61.4% | $196.7 | 94.8 | 96.2% | $0.915 |
| Seed 2.0-mini | 170 | 48.6% | $19.4 | 44.4 | 79.4% | $0.114 |

Read the turn column against the cost column. **The model with the fewest turns (Seed 2.0-mini,
44.4) has the lowest Pass@1 (48.6%). The model with the most turns (MiniMax M2.7, 94.8) is not the
dearest. The cheapest model per resolved instance (DeepSeek-V4 Flash, $0.033) takes 51.2 turns and
resolves 70.3%, within 7.7 points of the dearest at 1/155th the cost per solve** [I, arithmetic
above]. Across models on a fixed harness, turn count predicts neither cost nor resolution.

The paper's own summary of the cache column is the one our §6.4 quotes, and it is worth restating
with its conclusion: "Cost is therefore jointly affected by model price, input/output tokens, cache
policy, and adapter call path. We report cache hit rate as a diagnostic field for cost accounting,
not as a measure of model or harness capability" [W].

### 2.2 Claw-SWE-Bench Table 3 — five harnesses, two models

| harness | model | Pass@1 | total cost | $/resolved [I] |
|---|---|---:|---:|---:|
| genericagent | GLM 5.1 | 63.1% | $85.8 | **$0.388** |
| openclaw | GLM 5.1 | 73.4% | $277.0 | $1.078 |
| hermes-agent | GLM 5.1 | 71.1% | $330.6 | $1.328 |
| zeroclaw | GLM 5.1 | 70.3% | $383.4 | $1.559 |
| nanobot | GLM 5.1 | 60.9% | $768.8 | $3.609 |
| genericagent | Qwen 3.6-flash | 38.6% | $14.5 | **$0.107** |
| zeroclaw | Qwen 3.6-flash | 58.3% | $49.3 | $0.242 |
| openclaw | Qwen 3.6-flash | 66.0% | $71.5 | $0.310 |
| hermes-agent | Qwen 3.6-flash | 62.6% | $103.3 | $0.472 |
| nanobot | Qwen 3.6-flash | 47.4% | $133.1 | $0.802 |

**In both model groups the cheapest harness per resolved instance is the worst harness.** The
minimal adapter is 2.8× and 2.9× cheaper per solve than the best one, and 10.3 and 27.4 points
worse [I].

### 2.3 SWE-Bench ProMax — the same inversion, on the tool-set axis

*SWE-Bench ProMax: Benchmarking Agents on Large-Scale Multilingual Code Refactoring*,
arXiv:2608.09802v1, 10 Aug 2026, COLM 2026 [W https://arxiv.org/html/2608.09802v1]. 170 instances,
7 languages, 70 repositories, averaging **11.4 modified files and 261.6 lines per instance**. Two
scaffolds: mini-SWE-Agent (bash only) and OpenHands (sandboxed execution plus structured
file-editing tools). Step limit 300, cost limit $10 per instance, both scaffolds, all models.

Table 3 gives resolve rate, average steps and average cost per instance for both scaffolds [W].
Cost per solved instance is mine [I]:

| model | mini resolve / steps / cost | mini $/solve | OpenHands resolve / steps / cost | OH $/solve |
|---|---|---:|---|---:|
| Gemini-3-Pro | 26.5% / 58.0 / $0.60 | $2.26 | 19.4% / 51.2 / $1.49 | $7.68 |
| Claude Sonnet 4.6 | 30.6% / 99.5 / $2.32 | $7.58 | 38.8% / 117.9 / $4.77 | $12.29 |
| GPT-5.2 | 21.8% / 25.2 / $0.19 | $0.87 | 41.2% / 115.1 / $3.60 | $8.74 |
| GLM-5 | 22.9% / 108.9 / $0.10 | $0.44 | 36.5% / 114.2 / $0.24 | $0.66 |
| Kimi-K2.5 | 26.5% / 85.3 / $0.37 | $1.40 | 32.9% / 99.6 / $0.72 | $2.19 |
| Qwen3.5 | 20.6% / 155.4 / $0.93 | $4.51 | 36.5% / 141.2 / $0.78 | $2.14 |

**The bash-only scaffold is cheaper per solved instance for 5 of 6 models and solves fewer tasks
for 5 of 6 models** [I]. For GPT-5.2 the richer tool set costs 18.95× more, takes 4.57× more
steps, and buys +19.4 points; its cost per solve rises 10×. Whoever optimised cost per solve would
have shipped the scaffold that solves half as many tasks.

The paper's own summary: "higher cost does not translate to proportionally higher resolve rate";
"every model except Gemini-3-Pro improves markedly when moving from mini-swe-agent to OpenHands …
suggesting that richer runtime tooling is particularly beneficial for large-scale refactoring
tasks" [W].

### 2.4 SWE Atlas, and the other frontier points

*SWE Atlas: Benchmarking Coding Agents Beyond Issue Resolution*, arXiv:2605.08366 [W
https://arxiv.org/html/2605.08366v1]. Harbor framework, Docker, 16 CPU / 16 GB, 6-hour limit,
three workflows (Codebase Q&A 124 tasks, Test Writing 90, Refactoring 70), 642 trials per model
for the cost figure. Its Appendix G cost-per-task frontier: Gemini 3 Flash ≈ $0.35/task at ≈15%
pass; GPT 5.3 Codex ≈ $1.15 at ≈35%; GPT 5.4 ≈ $1.90 at ≈40%; "Opus 4.6 and Opus 4.7 are both
dominated by GPT 5.4" [W].

Two SWE Atlas numbers matter more to us than its frontier.

- **"Native scaffolds show 1.5–2× more tool calls than minimal mini-SWE-agent baseline"** [W], and
  the native scaffolds score higher. This is the same shape as ProMax §2.3.
- **Sub-agent use is a per-model property, not a per-task one:** Claude Opus 4.6 uses 2.64 agents
  per trial and delegates on 96.5% of Codebase Q&A trials; Gemini 3.1 Pro uses 0.01 agents per
  trial and delegates on 1.1% [W]. Our claude-code native arm delegates in 15 of 22 task-cells and
  sweet in 6 [M, `FRESH-POOL-RESULTS.md` via brief §1.1]. **The literature says delegation rate is
  set by the model, and ours was moved by the tool guide.** That is a larger effect than the
  literature reports for any prompt-level intervention, and it is the mechanism behind the only
  cell where sweet looked cheaper.

Terminal-Bench 2.0, arXiv:2601.11868v1, 17 Jan 2026 [W https://arxiv.org/html/2601.11868v1],
publishes a cost frontier as Figure 5 ("the tradeoff between performance and cost (log scale)")
and states the running range: "Running Terminal-Bench 2.0 costs anywhere from one to a hundred
dollars, depending on the model's price"; "in some cases, they take up to two hours, making
hundreds of API calls and using almost 100 million tokens on a single task" [W]. Resolution rates
from that paper: GPT-5.2 + Codex CLI 62.9% ± 3.0; Terminus 2 + Claude Opus 4.5 57.8% ± 2.5;
Terminus 2 + Gemini 3 Pro 56.9% ± 2.5; Terminus 2 + Kimi K2 Thinking 35.7% ± 2.8 [W]. Its scaffold
conclusion: "model selection is usually more important than agent scaffold when optimizing for
performance" — Codex CLI gains 52% from swapping GPT-5-Nano for GPT-5.2, Gemini-2.5-Pro gains 17%
from swapping OpenHands for Terminus 2 [W].

Older per-instance costs for the multilingual family, for scale only: Multi-SWE-bench reports
$0.0045 (DeepSeek-V3 on Go) to $3.6795 (OpenAI-o1 on TypeScript) per issue [W
https://arxiv.org/pdf/2504.02605]. SWE-bench Multilingual itself is 300 instances over 9 languages
[W].

---

## 3. What the cheapest competitive solvers do differently

Four design choices recur, and they are all *subtractive*.

**(a) One tool, and no tool-calling interface.** mini-SWE-agent v2 [W
https://mini-swe-agent.com/latest/, checked 2026-09-02]: "Does not have any tools other than bash
— it doesn't even use the tool-calling interface of the LMs"; "a completely linear history — every
step of the agent just appends to the messages"; claims ">74% on the SWE-bench verified benchmark",
with a dated news line "Nov 19: Gemini 3 Pro reaches 74% on SWE-bench verified with
mini-swe-agent" [W]. It is the cheapest scaffold in ProMax for 5 of 6 models and in the Claw
minimal-adapter role.

**Implication for sweet, all harnesses.** A Bash-only tool surface is not a resolution handicap in
the literature; the strongest cheap agent in the field has exactly one. Our `ss-*` CLI wrappers are
therefore not disadvantaged *in principle*. They are disadvantaged *in one specific way*: against a
harness whose own tools support parallel emission. Our opencode measurement is the concrete case —
native issues 1.55 tool calls per request against sweet's 1.11, costing sweet +3.4 requests and
+10.2% [M, brief §1.1]. mini-SWE-agent never pays this because its harness offers nothing to batch
against. **The Bash-versus-structured question is a harness-parallelism question, not a tool-quality
question.**

**(b) No autonomous planning.** Agentless runs a fixed localise / repair / validate pipeline and
reported the highest score at the lowest cost among open-source agents on SWE-bench Lite at $0.70
per instance [W https://arxiv.org/abs/2407.01489, 2024 — old prices, cited for design only].

**(c) Early termination on a calibrated confidence signal.** *EET: Experience-Driven Early
Termination for Cost-Efficient Software Engineering Agents*, arXiv:2601.05777v2, 20 Apr 2026 [W
https://arxiv.org/html/2601.05777v2]. SWE-bench Verified, three agents (Agentless, Mini-SWE-Agent,
Trae Agent) × two backbones (GPT-5-mini, DeepSeek-V3.2). Measured: **total cost −19.3% to −55.1%
(mean −31.8%), API calls −7.9% to −29.9% (mean −20.8%), input tokens −13.6% to −51.8% (mean
−29.9%), output tokens −3.7% to −51.0% (mean −25.1%), resolution loss at most 0.2%** and not
significant (McNemar p = 0.460); early termination fires on 8.6% to 14.0% of issues (mean 11.3%)
[W]. The signal is the model's own raw confidence score, and the paper reports it is calibrated:
patches with confidence > 90 pass 63.6% to 92.6% of the time, patches with confidence < 40 pass
8.7% to 13.8% [W]. Cross-repository transfer holds: on 50 issues from repositories absent from the
experience base, cost fell $12.7 → $9.6 at an unchanged 14.0% resolution [W].

**(d) Writing fewer tests.** *Rethinking the Value of Agent-Generated Tests for LLM-Based Software
Engineering Agents*, arXiv:2602.07900v2, 09 Apr 2026 [W https://arxiv.org/html/2602.07900v2]. 500
SWE-bench Verified tasks, light scaffold, four models, paired within-task. Table 8 [W]:

| model | condition | resolved | avg API calls | avg input tokens | avg output tokens |
|---|---|---:|---:|---:|---:|
| GPT-5.2 | baseline | 359 (71.8%) | 19.76 | 242,855 | 24,550 |
| GPT-5.2 | encourage tests | 359 (71.8%) | 20.84 (+5.5%)\*\*\* | 264,762 (+9.0%)\*\*\* | 29,415 (+19.8%)\*\*\* |
| Gemini 3 Pro | baseline | 371 (74.2%) | 40.33 | 666,096 | 11,114 |
| Gemini 3 Pro | encourage tests | 366 (73.2%) | 39.21 (−2.8%, ns) | 641,307 (−3.7%, ns) | 10,943 (−1.5%, ns) |
| Kimi K2-T | baseline | 317 (63.4%) | 46.82 | 668,449 | 14,895 |
| Kimi K2-T | discourage tests | 304 (60.8%) | 30.25 (−35.4%)\*\*\* | 340,689 (−49.0%)\*\*\* | 8,468 (−43.1%)\*\*\* |
| DeepSeek v3.2-R | baseline | 300 (60.0%) | 46.40 | 637,297 | 52,120 |
| DeepSeek v3.2-R | discourage tests | 291 (58.2%) | 35.06 (−24.5%)\*\*\* | 427,780 (−32.9%)\*\*\* | 44,823 (−14.0%)\*\*\* |

\*\*\* p < 0.001, paired Wilcoxon; 95% bootstrap CIs exclude zero for every starred cell [W].
The paper's summary: "Changing whether agents write tests has much larger effects on efficiency
than on task resolution" [W].

---

## 4. Do fewer requests or smaller contexts predict resolution?

**No, and the answer differs by which level of the data you condition on. That is the whole
finding.**

**Level 1, across models and agents: no relationship.** Terminal-Bench 2.0 §4.1: "we find
essentially no correlation between the number of average turns per trial and model success rates
(Figure 35). Similarly, while models vary significantly in their token generation patterns, our
analysis shows that higher token count does not necessarily correlate with better performance
(Figure 36)" [W arXiv:2601.11868v1]. Claw Table 2 shows the same thing on a fixed harness (§2.1).

**Level 2, within one agent across tasks: longer runs fail.** *Beyond Resolution Rates: Behavioral
Drivers of Coding Agent Success and Failure*, arXiv:2604.02547v1, 2 Apr 2026 [W
https://arxiv.org/html/2604.02547v1]. 9,374 trajectories, 19 agents (8 frameworks, 14 LLMs), 500
SWE-bench Verified tasks. Within-agent: failed trajectories are 14–111% longer [W]. ProMax
Figure 5, right panel: "Failed attempts consume substantially more rounds than successful ones"
[W]. *The Limits of Long-Context Reasoning in Automated Bug Fixing*, arXiv:2602.16069v2 [W
https://arxiv.org/html/2602.16069v2]: "successful agentic trajectories typically remain under
20k–30k tokens, and … longer accumulated contexts correlate with lower success rates".

**Level 3, within one task: longer runs succeed.** The same *Beyond Resolution Rates* study
reverses the sign when it holds the task fixed: **resolved trajectories average 10% longer, 44.0
against 39.6 steps, on 263 of 416 tasks, p < 10⁻⁸** [W].

The long-context paper states the confound itself and leaves it open: "It is unclear whether or not
if longer contexts have worse resolve rates due to the fact that more context could
confuse/complicate reasoning vs. more challenging issues require reasoning and are harder to
resolve; disentangling these two factors is a good direction for future work" [W]. Level 3 is that
disentangling, and it goes against the cost lever.

**Our own data sits at Level 2 only** [M, `probe.mjs`, fresh pool TAB runs, gradeable rows]:

| cell | n | resolved | mean tool calls, resolved | mean tool calls, unresolved | ratio |
|---|---:|---:|---:|---:|---:|
| codex native | 66 | 41 | 8.34 | 16.92 | 2.03× |
| codex sweet | 66 | 39 | 8.67 | 17.93 | 2.07× |
| opencode native | 66 | 41 | 19.46 | 34.68 | 1.78× |
| opencode sweet | 63 | 36 | 14.53 | 31.48 | 2.17× |
| claude-code native | 66 | 43 | 28.05 | 67.65 | 2.41× |
| claude-code sweet | 66 | 40 | 18.00 | 48.12 | 2.67× |

Every cell reproduces the confounded within-agent pattern, at the top of or above the published
14–111% band. **I could not reproduce Level 3 on our data: only 2 to 3 tasks per cell have both a
resolved and an unresolved repetition, which is far too few** [M, `probe.mjs`]. That is a real
limit of a 22-task × 3-rep pool and it is stated again in §8.

**Smaller contexts.** The long-context paper's second experiment is the sharpest external result we
have for our B11/B12 register rows. It hands the model **every file needed for the ground-truth
patch, in one 64k-token prompt, with perfect retrieval recall**, and single-shot patch generation
"degrades sharply: Qwen3-Coder-30B-A3B achieves only a 7% resolve rate at 64k context, while
GPT-5-nano solves none of the tasks", with "hallucinated diffs, incorrect file targets, and
malformed patch headers" [W]. The same models score much higher inside mini-SWE-agent. **Perfect
retrieval delivered as one large payload is worth almost nothing.** Our B11 (turn-0 dossier, DEAD)
and B12 (span expansion, INVERTED live: replay −1.6/−2.1/−4.7%, live +4.78/+19.79/+11.72%) now have
an external mechanism, not just a null.

---

## 5. Instruction files, context files, and retrieval tools — cost measured

### 5.1 The paper that runs our experiment — *Code Isn't Memory*

arXiv:2606.22417v1, 21 Jun 2026, SuperAGI Research [W https://arxiv.org/html/2606.22417v1]. Code
and data at https://github.com/TransformerOptimus/supercoder-eval.

**Design.** One harness (SuperCoder, single-LLM ReAct loop, parallel tool dispatch, compaction
above a token threshold), one model (Claude Opus 4.7), three seeds, benchmarks SWE-PolyBench
Verified and SWE-bench Pro, per-task isolated container, fail-closed git scrub, post-run leak
audit, unified provider gateway capturing token-level cost identically for every arm. Paired
denominators n = 80 (SC-ON vs SC-OFF) and n = 78 (SC-ON vs OpenCode) [W].

**Arms.** SC-ON and SC-OFF share a fixed tool set: `read`, `write`, `edit`, `bash`, `git`, `grep`,
`glob`, `todo_write`, `apply_patch`. SC-ON adds exactly two tools: `codebase_search` (natural
language query plus a retrieval strategy — vector, lexical, graph or hybrid — returning ranked code
chunks each carrying file path, snippet, relevance score and originating index, with a local
overlay that drops deleted paths and **flags stale ones**) and `codebase_graph` (a symbol, returning
callers and callees grouped by direction with distance). The index is built once per repository via
tree-sitter ASTs plus embeddings and refreshed incrementally by Merkle-tree diffs over the working
copy. OpenCode is the agentic-grep comparator [W].

**Table IV, mean of seed means** [W]:

| metric | SC-ON | SC-OFF | OpenCode |
|---|---:|---:|---:|
| Resolve % | 50.4 | 41.9 | 45.3 |
| Localisation acc@5 (View B) | 84.5 | 44.3 | 75.3 |
| Recall@5 | 0.611 | 0.330 | 0.601 |
| **$/solved** | **$2.30** | $2.84 | $2.92 |
| $/cell (mean) | $1.15 | $1.19 | $1.32 |
| **turns (mean)** | **28.3** | 36.2 | 36.0 |
| tokens, k (mean) | 10.1 | 11.1 | 14.0 |
| wall-clock, min | 4.5 | 5.5 | 5.4 |

Statistics [W]: within-harness acc@5 p < 0.0001, resolve p = 0.003, turns p < 0.0001, tokens
p = 0.027, **per-cell cost Δ = −$0.118, p = 0.73 (null)**. Cross-harness resolve Δ = +6.0 pp,
p = 0.087; acc@5 p = 0.080. By language, resolve SC-ON / SC-OFF / OpenCode: Go 47.1 / 29.9 / 35.5;
Java 60.0 / 53.3 / 57.9; Python 47.6 / 45.5 / 47.3 [W].

**Why this contradicts our own result, and what is different.** Five differences, three of which
are already open rows in our register.

1. **The index tools are first-class harness tools with parallel dispatch.** "Multiple tool calls in
   a single response are executed in parallel" [W]. Our `ss-*` calls are Bash, one per request. This
   is precisely the opencode +3.4-request driver [M, brief §1.1]. **Register A4 (MCP tool surface,
   OWNER-EXCLUDED and UNBENCHMARKED) is the vehicle this paper used, and it is the only vehicle
   under which a turn reduction from retrieval has been observed.**
2. **A call-graph tool is half the mechanism.** `codebase_graph` returns callers and callees. Our
   nearest tool is `ss-trace`, which register E7 records as an OPEN DEFECT with same-file fallback
   scans on Python, Lua and TypeScript.
3. **The overlay flags stale results.** Register E3 (`ss-grep` working-tree freshness, MEASURE `$0`,
   decided nothing on 4 clean codex rollouts) is the same requirement, un-shipped.
4. **The workload is multi-file.** SWE-bench Pro and SWE-PolyBench. The paper's own closing framing:
   the deployment question "is … whether the workload includes multi-file changes where structural
   ranking pays off" [W]. Register E14 records ~zero retrieval headroom on rotate20; the fresh pool
   is not much better.
5. **The backbone is Opus 4.7, not luna.**

This paper also **corrects `07-research-resolution-levers.md`'s L9** ("semantic code search as a
general replacement for grep — NEGATIVE"). SC-ON does not replace grep; `grep` and `glob` stay in
the tool set in both arms. The index is a supplement. Read that way, L9's negative evidence and
this paper's positive evidence are compatible, and the correct register row is E11 (structure-graph
supplement, PARKED), not E8.

### 5.2 Context files — the literature is now split, and the split is on authorship

`07-research-resolution-levers.md` §5.1 states that repository context files cost 20–23% for −0.5 to
−2% resolution, and ranks "drop the guide entirely" as its number one lever (register B3). **Two
corrections.**

**Correction 1 — the ETH cost is paid in steps and reasoning tokens, not in the file's bytes.**
*Evaluating AGENTS.md*, arXiv:2602.11988 [W https://arxiv.org/html/2602.11988v1]. Its Table 2, steps
and USD per instance [W]:

| set | condition | Sonnet-4.5 | GPT-5.2 | GPT-5.1 mini | Qwen3-30B |
|---|---|---|---|---|---|
| SWE-bench Lite | None | 54.4 / $1.30 | 12.5 / $0.32 | 40.9 / $0.18 | 29.7 / $0.12 |
| SWE-bench Lite | LLM-generated | 57.2 / $1.51 | 12.7 / $0.43 | 45.2 / $0.22 | 32.2 / $0.13 |
| AGENTbench | None | 40.7 / $1.15 | 12.1 / $0.38 | 40.6 / $0.18 | 31.5 / $0.13 |
| AGENTbench | LLM-generated | 46.5 / $1.33 | 13.1 / $0.57 | 46.9 / $0.20 | 34.2 / $0.15 |
| AGENTbench | developer-written | 45.3 / $1.30 | 13.6 / $0.54 | 46.6 / $0.19 | 32.8 / $0.15 |

The paper attributes the increase to two channels: "the context files increase the # steps in every
setting on average by 2.45 and 3.92 steps"; and "LLM-generated context files indeed increase the
average number of reasoning tokens by 22% for GPT-5.2 and 14% for GPT-5.1 mini on SWE-bench Lite
(respectively 14% and 10% on AGENTbench), and … developer-written context files increase the number
of reasoning tokens by 20% and 2%" [W]. On GPT-5.2 / SWE-bench Lite the steps rise 1.6% while cost
rises 34.4% [I] — **the money is in reasoning tokens, not steps and not bytes.** Developer-written
files raise steps by 3.34 on average and cost "at most 19%", and they *raise* performance by about
4% [W].

**This supports the brief's standing position and sharpens it.** A context file's cost is not the
cost of shipping its bytes. Register B2 prices our 1,457-token guide at 2.6–4.5% of sweet spend,
which is the ingest figure only.

**Correction 2 — a paired within-task study finds the opposite sign on output tokens, and a null on
total tokens.** *On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents*, Lulla,
Mohsenimofidi, Galster, Zhang, Baltes, Treude, arXiv:2601.20404v2, 30 Mar 2026, JAWs 2026 [W
https://arxiv.org/html/2601.20404v2]. **This source is in neither 06 nor 07.** 10 repositories, 124
pull requests, paired within-task design, the repository's own root AGENTS.md present or removed,
isolated Docker per repository. Table 1 [W]:

| metric | without | with | Δ% | significant? |
|---|---:|---:|---:|---|
| wall-clock median (s) | 98.57 | 70.34 | −28.64% | yes, Wilcoxon p < 0.05 |
| output tokens median | 2,925 | 2,440 | −16.58% | yes |
| output tokens mean | 5,744.81 | 4,591.46 | −20.08% | yes |
| input tokens mean | 353,010 | 318,652 | −9.73% | **no** |
| input tokens median | 116,609 | 120,587 | **+3.41%** | no |
| cached input median | 103,424 | 104,448 | +0.99% | no |
| total tokens median | 223,707 | 226,582 | **+1.29%** | no |

Only wall-clock and output tokens are significant. **The median total token count is 1.29% higher
with the file.** The authors say the mean reduction "primarily reduces token usage in a small number
of very high-cost runs" [W]. Secondary write-ups that summarise this paper as "context files make
agents cheaper" over-read it; the honest reading is "significantly fewer output tokens, no
significant change in total tokens" [W, secondary:
https://www.generativelabs.com/insights/claude-md-agents-md-context-files].

**The two studies differ on exactly the axis that matters to us.** ETH used *LLM-generated* files on
benchmark tasks and found +20% cost and −0.5 to −2% resolution; ETH's own *developer-written* arm
raised performance ~4%. Lulla used the repositories' *own human-written* files on real pull requests
and found output tokens down and total tokens flat. **Our tool guide is hand-written, dense
(40 tokens per rule per register B2), and teaches tool syntax rather than repository lore.** It sits
on the human-written side of the split.

**Measured on our own traces** [M, `probe2.mjs`, fresh pool TAB, gradeable rows; codex is the only
harness whose `rows.json` carries per-rollout `usage`]:

| cell | mean output tokens | mean reasoning tokens |
|---|---:|---:|
| codex native | 4,075 | 1,711 |
| codex sweet | 3,807 (−6.6%) | 1,717 (**+0.35%**) |
| claude-code native | 6,211 | not recorded |
| claude-code sweet | 5,213 (−16.1%) | not recorded |

**The sweet arm does not carry the ETH reasoning-token penalty on codex.** ETH predicts +14% to
+22% reasoning tokens from a context file on a reasoning model; we measure +0.35% [M][W].
The comparison is joint (guide plus tools), so it bounds the pair rather than the guide alone, and
the bound is at or below zero. **Register B3's number-one ranking rested on the ETH cost mechanism;
that mechanism is not present in our traces.**

### 5.3 Retrieval and cost, beyond the language-server study

*Agent Retrieval Bench: Evaluating Repository Context Retrieval for Coding Agents*,
arXiv:2607.24882v1, 27 Jul 2026 [W https://arxiv.org/abs/2607.24882]. 427 samples over 25
repositories, 308 base-commit snapshots, 392,000 files, 7.9 million chunks; five task families
including `edit2ripple` (the sibling-site class) and a no-gold abstention subset. Findings that bear
on us [W]:

- **"No single retrieval family dominates."** Qwen3-Embedding-4B best sample-weighted MRR,
  Qwen3-Embedding-8B best Recall@20, **RepoMap best budgeted context yield at 8K tokens**. Task-level
  winners differ substantially.
- **"Logged trajectories also miss every gold file on 27–35 percent of samples."** That is agents in
  the wild, not a retriever, failing to reach any gold file on a third of samples.
- **"Selective thresholds calibrated with counterfactual controls do not improve selective success
  on natural no-gold cases, revealing a calibration gap."** An abstention or "not indexed" signal
  cannot be calibrated on synthetic negatives.
- **"Retrieval-derived initial context yields higher file F1 with less post-seed exploration than
  random non-gold context, while oracle gold context shows substantial remaining headroom."**

The third bullet is the one with teeth for us: register E2 shipped a "not indexed" hint, and this
paper says a calibrated abstention threshold does not transfer from controls to real no-gold cases.
The first bullet says a budgeted-yield metric at a fixed token budget is the right way to rank
retrieval designs, which is the shape of register B14 (adaptive read budgeting, OPEN).

---

## 6. Where this supports and where it contradicts the standing positions

### 6.1 "Requests, not bytes, drive cost" — **supported; the cache flattens the dollar exponent**

Supporting, all controlled interventions [W]:

| intervention | Δ API calls | Δ input tokens | ratio [I] |
|---|---:|---:|---:|
| discourage tests, Kimi K2-T (2602.07900) | −35.4% | −49.0% | 1.38 |
| discourage tests, DeepSeek v3.2-R (2602.07900) | −24.5% | −32.9% | 1.34 |
| EET early termination, mean of 6 configs (2601.05777) | −20.8% | −29.9% | 1.44 |

Input tokens fall about 1.4× as fast as the request count. That is the residency multiplier: a
removed request removes its own payload and every later re-send of it.

Also supporting: *More with Less: An Empirical Study of Turn-Control Strategies for Efficient Coding
Agents*, arXiv:2510.16786v2 [W https://arxiv.org/html/2510.16786v2] states the mechanism explicitly
— "the prompt size that grows non-linearly, often quadratically (O(n²)), with the number of turns
n". **This is a primary source for the claim `06-research-cost-mechanics.md` §6.1 supported with a
blog post.** Its baseline table on a 100-task SWE-bench Verified subset gives cost per solution
directly: Claude 4 Sonnet 75% at $585.21 total, $7.80 per solution; Gemini 2.5 Pro 63%, $407.66,
$6.47; GPT 4.1 62%, $322.02, $5.19 [W].

**Our own measurement, and the qualification** [M, `probe3.mjs`, fresh pool TAB, log-log ordinary
least squares across rollouts within a cell]:

| cell | n | elasticity of billed input tokens to tool calls | r | elasticity of realised cost to tool calls | r |
|---|---:|---:|---:|---:|---:|
| codex native | 66 | **1.135** | 0.962 | 0.954 | 0.956 |
| codex sweet | 66 | **1.056** | 0.973 | 0.842 | 0.963 |

Reading: a 10% cut in tool calls removes about 11% of billed input tokens and about 9% of realised
dollars on codex. **The direction matches the literature; the dollar elasticity is below one, and
the reason is the cache.** Our prefix cache hits 99.3–100% of re-sent tokens [M, brief §1.1], so
every re-send is billed at one tenth of the ingest rate, which flattens the quadratic term the
published studies pay in full.

Four caveats, all of which cut against reading this number as a substitute for the published ones.
(a) The slope is cross-sectional over tasks of differing difficulty, not a causal within-task
elasticity; the three published figures are causal interventions. (b) **My regressor is tool calls,
not requests.** Codex averages 19.6 turns per rollout [M, `06-research-cost-mechanics.md` §8] against
the 11.6 to 12.5 tool calls I measured, so roughly 40% of codex requests carry no tool call [I]; the
elasticity with respect to *requests* is not the number in the table. (c) Opencode `rows.json`
carries no `usage` at all. (d) Claude-code `rows.json` records `usage.input_tokens` as a mean of 70
tokens per rollout, which is not the real value, so both harnesses are unmeasurable this way [M].

**Our turn count is not unusual.** Codex's 19.6 turns per rollout is within 1% of the GPT-5.2
baseline of 19.76 API calls per task over 500 SWE-bench Verified tasks [W arXiv:2602.07900v2
Table 8]. What is unusual is the context: our largest rollout context is 100,624 tokens of a
1,050,000-token window and no rollout ever compacted [M, brief §1.1], while the published agents at
40 to 47 calls carry 637,000 to 668,000 input tokens per task [W].

**Implication for sweet, named harness.** On **codex**, the request count is still the single
largest controllable term, and nothing else in the register moves 9%. On **opencode**, the +3.4
requests sweet pays for serial Bash calls is worth about 10.2% [M, brief §1.1] and is the largest
single sweet-only cost anywhere in the programme — and §5.1 shows the only published fix is a
first-class tool surface with parallel dispatch, which is register A4.

### 6.2 "Retrieval decides cost while verification decides resolution" — **contradicted on both halves**

**Half one, contradicted.** *Code Isn't Memory* moved **resolve** +8.5 pp (p = 0.003) with a
retrieval change whose **per-cell cost effect was null** (p = 0.73) [W]. Retrieval decided
resolution and did not decide cost. Its localisation gain was enormous (acc@5 44.3 → 84.5) and its
resolve gain was a fifth of that in points — which is consistent with our own "only ~30% of losses
are retrieval-differentiable" [M, brief §1.2], on a pool where the other 70% is smaller.

**Half two, contradicted.** *Rethinking the Value of Agent-Generated Tests* is the direct test of
"verification decides resolution" and finds verification decides **cost**: suppressing test writing
moved resolution 2.6 and 1.8 points while moving API calls 35.4% and 24.5% and input tokens 49.0%
and 32.9% [W]. Its own conclusion: "More tests do not mean more solves in this high-autonomy
setting, but they can impose substantial interaction overhead" [W]. Register F12 (issue-derived
acceptance, QUEUED, NOT BUILT) should be re-read against this: the published effect on resolution is
~2 points and the published effect on cost is ~40%, in the wrong direction for us.

**What survives.** Our own finding that ~65% of losses are arm-universal wrong fixes [M, brief §1.2]
is untouched, and ProMax independently names the same class in a different vocabulary: agents
"correctly locate and edit the core files … but stop short of applying the same transformation to
peripheral call sites, documentation, configuration files, and test fixtures" [W]. **On multi-file
work that class is retrieval-shaped, not verification-shaped**, which is the third reason §5.1's
paper gets a different answer from ours.

**A corrected pair of sentences, for the programme to adopt or reject.** On *this* pool, retrieval
decides neither cost nor resolution and verification decides neither; the pool decides both. On a
multi-file pool, the published evidence says a structural index decides resolution at null cost.

### 6.3 A new measured risk: sweet writes narrower patches than native

ProMax names the dominant failure on multi-file work as agents that "consistently modify fewer files
than the gold patch requires" [W]. That makes patch breadth a resolution variable, not a style
choice. Measured on the fresh pool [M, agent-produced patches from `rows.json`, gradeable rows;
these are the agent's own patches, not reference patches]:

| cell | median files | mean files | median hunks | share of rollouts touching ≥3 files |
|---|---:|---:|---:|---:|
| codex native | 1 | 1.23 | 1 | 8% |
| codex sweet | 1 | 1.20 | 1 | 6% |
| opencode native | 1 | 1.33 | 1 | **14%** |
| opencode sweet | 1 | 1.14 | 1 | **2%** |
| claude-code native | 1 | 1.27 | 1 | 6% |
| claude-code sweet | 1 | 1.11 | 1 | 2% |

**Sweet writes a narrower patch than native in all three harnesses, and on opencode it touches three
or more files in 1 rollout of 63 against native's 9 of 66** [M]. On this pool that costs nothing,
because the median task needs one file. On a ProMax-shaped pool it is the exact shape of the
dominant failure mode. Two readings are open and this report cannot separate them: sweet is more
precise, or sweet stops looking sooner. Register B9 (repair-completeness card, DEAD: 0–1 starved
cases against a bar of 2) and E12 (cross-file reference completeness, OPEN `$0`) both live here, and
both were killed or parked on a pool whose median task is one file.

---

## 7. Candidate seeds

Each seed states mechanism, harnesses, vehicle, evidence, ceiling arithmetic, the cheapest `$0`
falsifier with its pre-registered kill condition, build cost, register check, and the two flags.
None of these is a finished lever. All five come out of §5.1 or §5.3.

### S-1. Deliver `ss-*` as first-class tools so the harness can emit them in parallel

- **Mechanism.** Sweet's retrieval is Bash. One `ss-*` call is one request. Opencode's own
  structured tools are emitted in parallel: native 1.55 tool calls per request against sweet's 1.11,
  which costs sweet **+3.4 requests = +10.2%** [M, brief §1.1]. The only published measurement in
  which a structural index *reduced* turns delivered it as two first-class tools inside a harness
  that executes "multiple tool calls in a single response … in parallel": turns 36.2 → 28.3,
  p < 0.0001, per-cell cost null [W arXiv:2606.22417v1 Table IV, §3.1].
- **Harnesses.** Opencode is where the cost is measured. Codex is unlikely to gain (its requests
  already carry about one tool call and its ~2,500-token output cap is the binding constraint).
  Claude-code unknown.
- **Vehicle.** MCP tool surface. Sweet-only. The product already ships `init --mcp --no-cli` and a
  `-mcp.md` guide variant [C, brief §2.1].
- **Ceiling, opencode.** Sweet issues 10.65 `ss-*` calls plus 7.59 bash and 2.94 test calls per
  rollout, 21.79 tool calls in all [M, `probe.mjs` and toolCounts]. At native's 1.55 calls per
  request that is 14.1 requests against sweet's present 19.6 [I]. That is the entire +10.2%, and it
  is the largest single sweet-only cost term anywhere in the programme.
- **Cheapest `$0` falsifier.** Replay the opencode sweet transcripts and count *adjacent independent*
  `ss-*` call pairs: pairs where no argument of call *n+1* is derived from the result of call *n*.
  **Kill if fewer than 25% of `ss-*` call pairs are independent** — with no independent pairs there
  is nothing for the harness to batch, and the register already records that luna will not batch on
  instruction (A1, A2).
- **Build cost.** The tool schemas and guide variant exist; a fourth bench arm and a runner path do
  not.
- **Register check.** This *is* A4, which is OWNER-EXCLUDED and UNBENCHMARKED. What is new is the
  published turn reduction from a structural index delivered this way, and the arithmetic that names
  it the largest sweet-only cost term.
- `new_tool: false` (same capabilities, different surface). **`needs_user_decision: true`** — the
  owner scoped MCP out on 2026-07-31.

### S-2. Fix `ss-trace` cross-file caller and callee edges

- **Mechanism.** Half of the published index is a call-graph tool: `codebase_graph` takes a symbol
  and "traverses the call-graph index, returning callers and callees grouped by direction, each
  carrying the defining file path and the distance" [W arXiv:2606.22417v1 §3.2]. Our nearest tool
  falls back to a same-file scan on Python, Lua and TypeScript.
- **Harnesses.** All three. Sweet-only.
- **Vehicle.** Existing tool, existing index. Not a new tool.
- **Ceiling.** Unpriced. The published arm that had this tool gained +8.5 pp resolve, but it gained
  `codebase_search` at the same time, so no part of that number is attributable.
- **Cheapest `$0` falsifier.** `rows.json` aggregates every `ss-*` tool into one `ss` counter [M],
  so this needs the raw transcripts: count `ss-trace` invocations per rollout and the share that
  returned a same-file fallback. **Kill if `ss-trace` is called fewer than once per rollout on
  average, or if fewer than 10% of its calls hit the fallback.**
- **Build cost.** Language-front-end work, sized in the E7 defect note.
- **Register check.** E7, OPEN DEFECT. New only in that a controlled external result now names the
  same capability as half of the winning arm.
- `new_tool: false`. `needs_user_decision: false`.

### S-3. Flag stale `ss-*` results by fact, never by a calibrated threshold

- **Mechanism.** The winning arm's overlay "drops paths the agent has deleted and flags stale ones"
  [W arXiv:2606.22417v1 §3.2] — a shipped requirement, not a research idea. Separately, Agent
  Retrieval Bench finds that "selective thresholds calibrated with counterfactual controls do not
  improve selective success on natural no-gold cases, revealing a calibration gap"
  [W arXiv:2607.24882v1]. So the staleness signal must be a fact about the working tree, never a
  learned confidence.
- **Harnesses.** All three. Sweet-only.
- **Vehicle.** Existing wrappers and index.
- **Ceiling.** Correctness, not cost. Register E3 already found 4 clean codex rollouts and decided
  nothing.
- **Cheapest `$0` falsifier.** Census the fresh-pool transcripts for `ss-grep` or `ss-search` calls
  whose result set contains a path the same rollout has already edited. **Kill if fewer than 5% of
  such calls are affected** — the population bar E3 already set.
- **Build cost.** Small: compare index mtime against working-tree mtime per returned path.
- **Register check.** E3, MEASURE `$0`. New only in that an external shipped design treats it as
  mandatory and an external benchmark rules out the calibrated-threshold alternative.
- `new_tool: false`. `needs_user_decision: false`.

### S-4. Rank retrieval configurations on budgeted yield, not on rank quality

- **Mechanism.** Agent Retrieval Bench reports that no retrieval family dominates and that the
  winner changes with the scoring rule: Qwen3-Embedding-4B best sample-weighted MRR,
  Qwen3-Embedding-8B best Recall@20, **RepoMap best budgeted context yield at 8K tokens**
  [W arXiv:2607.24882v1]. Our retrieval benchmarks score MRR and Recall. An agent pays by the token.
- **Harnesses.** All three, indirectly. Sweet-only.
- **Vehicle.** Benchmark scoring, then `ss-search` and `ss-read` defaults.
- **Ceiling.** Unknown; this is a measurement change that could re-rank existing configurations at
  no build cost.
- **Cheapest `$0` falsifier.** Re-score existing retrieval-benchmark output under an 8K token budget.
  **Kill if the ranking of our own shipped configurations is unchanged.**
- **Build cost.** A scoring script. No product change until the ranking moves.
- **Register check.** Nearest is B14 (adaptive query-conditioned read budgeting, OPEN). B14 asks
  which lines to return; this asks how to score the answer. Different.
- `new_tool: false`. `needs_user_decision: false`.

### S-5. Screen the next paid cohort for multi-file reference patches

- **Mechanism, and it is a cohort-design input rather than a lever.** The one published arm that
  beat agentic grep says its own deployment question is "whether the workload includes multi-file
  changes where structural ranking pays off" [W arXiv:2606.22417v1], and its resolve gain is
  Go +17.2 pp, Java +6.7 pp, Python +2.1 pp over the index-off arm [W Table VI]. ProMax, whose
  instances average 11.4 modified files, names the dominant failure as agents that "correctly locate
  and edit the core files … but stop short of applying the same transformation to peripheral call
  sites, documentation, configuration files, and test fixtures" [W arXiv:2608.09802v1 §5.2]. Our own
  register records ~zero retrieval headroom on rotate20 (E14), and **every fresh-pool cell has a
  median agent patch of 1 file and 1 hunk** [M, §6.3].
- **Harnesses.** All three.
- **Vehicle.** Admission policy. Reference-patch file counts are task metadata already used by the
  admission pipeline; no gold content is used, and nothing enters a runtime input.
- **Ceiling.** Unknown, and that is the point: the sweet-versus-native question has never been asked
  on a multi-file cohort.
- **Cheapest `$0` falsifier.** Count reference-patch files per task across the open DEV pools. The
  agent-side proxy is already measured and says the pool is single-file (§6.3).
  **Kill the "the pool is the blocker" hypothesis if the reference-patch median is already 3 or more
  files.**
- **Build cost.** A census script; then the cost of a paid cohort, which is the existing G5 estimate.
- **Register check.** Not a lever in the register. Nearest is E14 (retrieval headroom ~zero on
  rotate20), which this seed proposes to test on a different pool shape rather than accept as
  general.
- `new_tool: false`. **`needs_user_decision: true`** — it asks for a new paid cohort.

### Not a seed: dropping or trimming the tool guide

§5.2 measured `+0.35%` reasoning tokens and `−6.6%` output tokens for the sweet arm against native on
codex [M]. The ETH cost mechanism that made "drop the guide" the top-ranked lever in
`07-research-resolution-levers.md` is **absent from our traces**. Register B3 should be re-read as
weakly negative, not strongly positive, and B2 (CLOSED) needs no reopening.

---

## 8. Traps

1. **`stepsToFirstEdit` is unusable on codex and opencode, and is silently equal to the total call
   count.** [M, `probe2.mjs`] `stepsToFirstEdit === calls` on **54/66 codex-native rows, 60/66
   codex-sweet, 66/66 opencode-native and 63/63 opencode-sweet — and every one of those rows
   produced a non-empty patch.** Only claude-code is real (0/66 native, 1/66 sweet). This is the
   known `toolCounts.edit` trap propagating into a second field: codex packs `apply_patch` inside
   `exec_command` heredocs and opencode's editor is `apply_patch`, so the runner never sees an edit
   call and the field falls through. The brief lists the `toolCounts.edit` trap but not this one.
   **Any analysis of first-edit timing on codex or opencode is reading the call count.**
2. **Cost per solved task inverts the ranking of tool sets.** §2.2 and §2.3: the cheapest-per-solve
   scaffold is the worst scaffold in 2/2 Claw model groups and 5/6 ProMax models. Never rank a
   tooling change on `$/solve`.
3. **Do not sum `costRealizedUsd` and `costSidechainUsd` naively.** My own first pass produced a
   claude-code "sidechain-inclusive" mean *below* the main-thread mean because null-cost rows enter
   the sum as zero and change the denominator [M]. Use the programme's own accounting.
4. **Secondary write-ups of arXiv:2601.20404 say "cheaper"; the paper's own table says "fewer output
   tokens, flat total tokens".** Two of the three efficiency metrics move the other way at the
   median and are not significant [W].
5. **Turn caps are a shared-vehicle lever.** Everything in §3(c) and arXiv:2510.16786 reaches both
   arms. Zero head-to-head differential. Register A5 and A7 already say so; this report adds only
   that the published gains concentrate in multi-candidate generate-and-select loops (Agentless,
   Trae) that our harnesses do not run — which is why our p75 cap was null while theirs saves
   19–55%.
6. **In(M) in Claw-SWE-Bench Table 2 and Table 3 is ambiguous.** The caption says "total
   input/output tokens (millions)", but the values are inconsistent with the reported turn counts
   under either reading (openclaw × GLM 5.1 shows 27.6M while zeroclaw × GLM 5.1 shows 989.7M at
   similar Pass@1) [W][I]. I used only the Resolved, Pass@1, Cost, Turns and Cache columns.

---

## 9. What I could not finish

- **Terminal-Bench's per-model cost and token rows.** The leaderboard at
  `https://www.tbench.ai/leaderboard/terminal-bench/2.0` has COST and TOKENS columns but is
  client-rendered; `/api/leaderboard/...` and `/api/leaderboards` both return 404 with an HTML shell
  [M, curl 2026-09-02]. I have the columns and the paper's Figure 5 frontier description, not the
  numbers.
- **Artificial Analysis Terminal-Bench v2.1 cost figures.** The five-way cost decomposition is
  charted without labelled data points [W].
- **Holistic Agent Leaderboard (arXiv:2510.11977) cost tables.** 21,730 rollouts, 9 models, 9
  benchmarks, ~$40,000 total, and the headline "higher reasoning effort reducing accuracy in the
  majority of runs" [W abstract]. The PDF exceeds the fetch size limit and no HTML rendering exists
  at v1 or v2. Its per-task cost tables are unread.
- **Level-3 (within-task) replication of the turns-versus-resolution reversal on our own data.**
  Only 2 to 3 tasks per cell have both a resolved and an unresolved repetition [M, `probe.mjs`].
  Under-powered by roughly two orders of magnitude against the published 263-task denominator.
- **Request-elasticity on opencode and claude-code.** `rows.json` carries no `usage` for opencode
  and an unusable `usage.input_tokens` (mean 70) for claude-code [M]. Rebuilding per-rep usage from
  the raw transcripts is possible at `$0` but was out of scope for this task.
- **Whether our tool guide alone changes reasoning tokens.** No arm exists with sweet tools and no
  guide, so §5.2's measurement bounds the pair, not the guide.

---

## 10. Reproduction

Scripts, written to the box scratch directory only (`/tmp/wf-slatec/cost-leaderboards/`), local
copies in this session's scratchpad:

```
probe.mjs   # per-cell resolve, calls, tokens, stepsToFirstEdit; within-task discordant pairs
probe2.mjs  # stepsToFirstEdit reliability; output and reasoning tokens per arm
probe3.mjs  # log-log elasticity of input tokens and realised cost w.r.t. tool calls
probe4.mjs  # agent patch breadth (files, hunks, share touching >=3 files) and per-arm tool mix
```

Run: `ssh root@167.233.69.121 'cd /tmp/wf-slatec/cost-leaderboards && node probe.mjs'`.
Inputs, read-only: `/root/sweet-search-private/eval/task-completion-bench/results/`
`fp-codex-tab-20260826/rows.json`, `fp-opencode-tab-20260826/rows.json`,
`fp-claudecode-tab-20260826/rows.json`. Rows filtered on `gradeable !== false`.
Denominators: 66 / 66 / 66 / 63 / 66 / 66 as shown in each table.

---

## 11. Sources

Primary papers, with arXiv id, version and date as shown on the page.

| topic | title | id / version | date | URL |
|---|---|---|---|---|
| structural index inside a harness, causal ablation | Code Isn't Memory | 2606.22417v1 | 2026-06-21 | https://arxiv.org/html/2606.22417v1 |
| harness as the experimental variable, cost frontier | Claw-SWE-Bench | 2606.12344v1 | 2026-06-10 | https://arxiv.org/html/2606.12344v1 |
| multilingual refactoring, steps and cost per scaffold | SWE-Bench ProMax | 2608.09802v1 | 2026-08-10 | https://arxiv.org/html/2608.09802v1 |
| workflows beyond issue resolution, cost frontier | SWE Atlas | 2605.08366v1 | 2026-05-08 | https://arxiv.org/html/2605.08366v1 |
| terminal tasks, cost frontier, turns-vs-success null | Terminal-Bench 2.0 | 2601.11868v1 | 2026-01-17 | https://arxiv.org/html/2601.11868v1 |
| behavioural predictors, within-task reversal | Beyond Resolution Rates | 2604.02547v1 | 2026-04-02 | https://arxiv.org/html/2604.02547v1 |
| turn-control strategies, O(n²) prompt growth, $/solution | More with Less | 2510.16786v2 | 2025-10 | https://arxiv.org/html/2510.16786v2 |
| early termination on calibrated confidence | EET | 2601.05777v2 | 2026-04-20 | https://arxiv.org/html/2601.05777v2 |
| agent-generated tests: cost versus resolution | Rethinking the Value of Agent-Generated Tests | 2602.07900v2 | 2026-04-09 | https://arxiv.org/html/2602.07900v2 |
| context files raise steps and reasoning tokens | Evaluating AGENTS.md | 2602.11988v1 | 2026-02-12 | https://arxiv.org/html/2602.11988v1 |
| context files, paired within-task efficiency | On the Impact of AGENTS.md Files | 2601.20404v2 | 2026-03-30 | https://arxiv.org/html/2601.20404v2 |
| usable context versus nominal context | The Limits of Long-Context Reasoning | 2602.16069v2 | 2026-02-17 | https://arxiv.org/html/2602.16069v2 |
| repository retrieval benchmark, budgeted yield | Agent Retrieval Bench | 2607.24882v1 | 2026-07-27 | https://arxiv.org/abs/2607.24882 |
| pipeline baseline, historical cost | Agentless | 2407.01489 | 2024 | https://arxiv.org/abs/2407.01489 |
| multilingual per-issue costs | Multi-SWE-bench | 2504.02605 | 2025 | https://arxiv.org/pdf/2504.02605 |
| agent leaderboard infrastructure (abstract only) | Holistic Agent Leaderboard | 2510.11977v1 | 2025-10-13 | https://arxiv.org/abs/2510.11977 |

Leaderboards and tool documentation, all checked 2026-09-02.

| source | URL |
|---|---|
| SWE-rebench leaderboard | https://swe-rebench.com/ |
| Terminal-Bench leaderboard | https://www.tbench.ai/leaderboard/terminal-bench/2.0 |
| Artificial Analysis, Terminal-Bench v2.1 | https://artificialanalysis.ai/evaluations/terminalbench-v2-1 |
| Scale SEAL, SWE-bench Pro public | https://labs.scale.com/leaderboard/swe_bench_pro_public |
| Epoch AI, SWE-bench Verified | https://epoch.ai/benchmarks/swe-bench-verified |
| mini-SWE-agent documentation (v2) | https://mini-swe-agent.com/latest/ |
| mini-SWE-agent repository | https://github.com/swe-agent/mini-swe-agent |
| SuperCoder evaluation artefacts | https://github.com/TransformerOptimus/supercoder-eval |

Secondary, used only to locate primaries and flagged as such in the text.

| source | URL |
|---|---|
| Generative Labs summary of the two context-file studies | https://www.generativelabs.com/insights/claude-md-agents-md-context-files |
| DAIR.AI summary of *Evaluating AGENTS.md* | https://academy.dair.ai/blog/agents-md-evaluation |
| Morph, SWE-bench Pro price-per-point aggregation | https://www.morphllm.com/swe-bench-pro |
| EmergentMind, Terminal-Bench 2.0 topic page | https://www.emergentmind.com/topics/terminal-bench-2-0 |
