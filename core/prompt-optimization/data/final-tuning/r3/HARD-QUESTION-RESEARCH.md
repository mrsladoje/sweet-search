# How to build hard code-retrieval questions for agents (research note)

Date: 2026-10-01. Scope: web and literature only. No paid API calls. No task-bench or HO2 data touched.
Labels: **[S]** = stated by a cited source. **[I]** = my inference from the sources. Check [I] items in a pilot.

## 1. Conclusion

A question is hard only if the **cheapest route** to the answer is long. The surface of the question does not decide this. The agent decides it at run time.

Four facts from the literature support this:

1. **Hardness comes from dependent steps, not from many clues.** A question can have a long intended chain and still collapse into one search. FORT-Searcher names four collapse causes: one clue is selective enough alone, one evidence item covers several clues, the question exposes constants that make the next query runnable, and the model already knows the answer. [S: FORT-Searcher 2026]
2. **Questions that need the repository are made by filtering.** SWE-QA-Pro removes questions that models answer without repository access. Its agent-versus-direct gap is then +13 points for Claude Sonnet 4.5. [S: SWE-QA-Pro 2026]
3. **Completeness is where agents fail.** On WideSearch, item-level F1 reaches about 80% with many attempts, but whole-table success stays below 20% (about 5% for single runs). Finding one item is easy. Finding all items is hard. [S: WideSearch 2025]
4. **Localization from a distinctive token is easy.** Hop-0 localization is solved by every method. Accuracy falls only as the graph distance from the named entity to the target grows. Localization questions in SWE-QA-Pro score high with low variance. [S: LocAgent 2025; SWE-QA-Pro 2026]

Your r3 result (native Opus 95% correct, median 3 tool calls) matches this. The r3 verification step kept questions that two other models could answer from the gold files. That step selects for easy questions. [I] The fix is the reverse filter: drop what a cheap agent solves in 1-3 calls. Then confirm that the cheapest route has at least 4 dependent steps.

Step budget. A chain with k dependent hops needs at least k serial turns. Add 1-2 turns to orient and 1 to verify. A 3-5 hop chain therefore costs 5-8 turns. [I] Published numbers fit this range. BRIGHT-Pro agents use 5.1-6.0 adaptive search rounds. [S: BRIGHT-Pro 2026] Semantic-search ReAct agents on SWE-QA use 3.5-11.4 tool calls per question at 48-89% pass, depending on the model. [S: Deep Agentic Search 2026] Count serial turns and tool calls separately, because one turn can hold parallel calls. [S: Cognition SWE-grep 2025]

Do not chase step count alone. In the SWE-QA study, more tool calls went with lower pass rates. The authors read this as "extended exploration marks harder questions, and does not rescue them". [S: Deep Agentic Search 2026] Steps are a symptom of difficulty. Use them as a check, not as the target.

Accuracy band. SWE Atlas Codebase Q&A is too hard for your 60-80% target: best Pass@1 is about 40-48%, because it asks for runtime analysis and requires every rubric item to pass. [S: SWE Atlas 2026] SWE-QA lands near your band (judge scores about 65-71 for the best agents) but with shallower questions. [S: SWE-QA 2025] Aim between them. Use partial credit, not all-or-nothing.

## 2. Which question types force multi-step work

### 2.1 Types that work (ranked by how well the evidence supports them)

| Type | Why it forces steps | Evidence |
|---|---|---|
| Chain with unexposed intermediates (entry, dispatch, handler, effect) | Each hop's name is found only by reading the previous hop. SWE-QA reports average reasoning-chain depth 4.72, 3.19 files, 8.71 functions per question. | SWE-QA 2025 [S]; MuSiQue 2022 [S] (compose single-hop questions, then drop any where a step can be skipped) |
| Completeness ("every place that ...") where members do not share a searchable token | One grep finds some members. The rest need structural reading. Recall is the weak term for agents. | WideSearch 2025 [S]; SWE-Explore 2026 [S] (line-level recall limits all explorers); BRIGHT-Pro 2026 [S] (multi-aspect gold sets expose "aspect tunnel vision") |
| Cross-layer mapping (user, config, protocol words to internal code with other names) | Lexical overlap is absent. Grep on the question words hits docs and tests, not the logic. | CodeCompass 2026 [S] (hidden-dependency tasks: vanilla Claude Code 76.2%, BM25 78.2%); BRIGHT 2024 [S] |
| Behaviour under conditions (precedence, defaults, ordering, which branch wins) | The agent must read and run the logic in its head. Locating the file is not enough. | SWE Atlas 2026 [S] (root-cause questions); SWE-QA 2025 [S] (hard cases are constrained What and locational How) |
| Decoy disambiguation (several plausible candidates, one detail decides) | Wrong-entity answers are a main failure. The agent must verify, not just find. | BRIGHT 2024 [S] (hard negatives); Deep Agentic Search 2026 [S] ("wrong entity or mechanism" symptom) |
| Negative with decoys (feature looks present, behaviour is absent) | Needs several searches to be sure, then a reasoned "no". | AbstentionBench 2025 [S] (reasoning models abstain poorly); CodeQueries 2022 [S] (negatives are part of the set) |
| Gating (feature flag, build tag, platform file, version branch) | The default implementation is a decoy. The answer sits in a variant. | [I] Not studied as a type in the sources. Treat as a pilot item. |
| Cross-file data flow (where a value comes from, who can change a field) | Needs a trace across 3+ transformations. | SWE-QA-Pro 2026 [S] (data/control-flow location is a "Where" subtype); CodeQueries 2022 [S] (multi-hop queries) |

### 2.2 Types that look hard and fall to 1-2 greps

1. **Locate a distinctive identifier.** Hop-0 localization. [S: LocAgent 2025; SWE-QA-Pro 2026]
2. **Exposed constants.** An error string, config key, CLI flag or numeric literal in the question makes the next query runnable at once. [S: FORT-Searcher 2026]
3. **Single selective clue.** One rare word plus one more constraint identifies the target. [S: FORT-Searcher 2026]
4. **Paraphrase of one function.** RepoQA needle search reaches about 90% for top models, and accuracy rises when comments are removed. [S: RepoQA 2024]
5. **Open "why / how / purpose" questions.** Models score well on them because any plausible prose earns credit. [S: SWE-QA 2025; Deep Agentic Search 2026 (Why easiest, How hardest)]
6. **Answer sits in README, docs, comments or test names.** [I] Follows from the RepoQA comment result and from gold-in-tests leakage (see section 5).
7. **Well-known repositories.** The model answers from memory. File-path identification from the issue text alone reaches 76% on SWE-bench Verified but 53% on repositories outside it. [S: SWE-Bench Illusion 2025]
8. **"List all callers of X" with a distinctive X.** One grep, unless dispatch is dynamic. [I]
9. **"Is there support for Y" with a distinctive Y.** Zero grep hits make the negative trivial. [I]
10. **"Why / design rationale" with several valid answers.** Hard to grade, not hard to find. Judges penalize valid alternatives. [S: DeepRepoQA 2026]

## 3. Keeping questions unambiguous and gradeable

What the benchmarks do:

- **Two-expert test.** A task is well specified when two domain experts reach the same verdict independently. Each task has a reference solution that passes all graders. [S: Anthropic, Demystifying evals 2026]
- **Binary rubric checklist.** SWE Atlas uses about 10.5 independent YES/NO rubric items per Q&A task, includes negative rubrics (penalties), and drops any item that 2 of 3 expert reviewers mark invalid, over-prescriptive or ambiguous. [S: SWE Atlas 2026]
- **Human editing of generated questions.** SWE-QA-Pro annotators explore the code themselves, revise ambiguous questions, and cross-verify answers. SWE-bench Verified: 93 developers screened 1,699 samples and kept 500. [S: SWE-QA-Pro 2026; OpenAI 2024]
- **Short, checkable answers.** BrowseComp makes the answer short and easy to verify while the search is hard. [S: BrowseComp 2025]
- **Gold sets with equal alternatives.** ContextBench shows gold context stays stable across equivalent patches (Jaccard 0.95) once annotators trace real dependencies. About 40 minutes per issue. [S: ContextBench 2026]
- **Partial credit.** Grade the result, not the path. Give credit for each correct part. [S: Anthropic 2026] Use set metrics for "find all". Cognition weights precision above recall (F-beta with beta = 0.5) because irrelevant context hurts the agent. [S: Cognition 2025]
- **Judge validity.** Use a judge from another model family than the answerers. Check it against humans. SWE Atlas reports Cohen's kappa 0.78-0.88; Deep Agentic Search reports a human panel agreeing with the judge at substantial to almost perfect level on 800 answers. Give the judge an "Unknown" exit. Grade each rubric dimension separately. [S: SWE Atlas 2026; Deep Agentic Search 2026; Anthropic 2026]
- **Repeat the judge.** SWE Atlas re-ran one judge 5 times on 30 responses: kappa 0.983. Low flip rate needs atomic items. [S]

Weak spots to avoid:

- SWE-QA reference answers were written by a strong LLM from retrieved context, then reviewed. The gold can inherit the retriever's blind spots. [S: SWE-QA 2025] Write gold by reading code, as the r3 drafting brief already requires.
- CoReQA reference answers come from LLM-processed issue comments. [S: CoReQA 2025]

## 4. Measuring and calibrating difficulty without overfitting to one product

Methods in the literature:

| Method | Source |
|---|---|
| Hop distance on the code graph between the entity named in the question and the target. Performance drops with hop count. | LocAgent 2025 [S] |
| Closed-book screen: models answer without tools. Z-score the judge scores across 3 model families. Drop questions that score high. | SWE-QA-Pro 2026 [S] |
| Trainers verify that strong models fail, that five simple searches do not find the answer, and that a second person cannot solve it in 10 minutes. Revise if solved more than 40% of the time. | BrowseComp 2025 [S] |
| Require at least 2 successful agent trajectories, so the task is solvable. Build gold from the trajectory intersection plus human audit. | SWE-Explore 2026 [S] |
| Select tasks by agent solvability, edit scope and edit dispersion. | ContextBench 2026 [S] |
| Trajectory signatures: solving cost, answer hit time (how late the answer first appears in tool output), prior-shortcut rate (answer named before any evidence). | FORT-Searcher 2026 [S] |
| Run several vendor harnesses plus a minimal one (bash only). Run 3 trials. Report Pass@1 and Pass^3. Best configurations lose 30-50% from Pass@1 to Pass^3. | SWE Atlas 2026 [S] |
| Public set, private held-out set, and a commercial set. | SWE-bench Pro 2025 [S] |
| Watch for saturation. A 100% pass rate gives no signal. | Anthropic 2026 [S] |

Protocol for r3-hard that follows from this (fits the project's dev / held-out rule):

1. **Author card (before any run).** The drafter writes the cheapest route as numbered steps, the first 3 greps a smart agent would try, and what each returns. Reject if fewer than 4 dependent steps, or if grep 1 or 2 reaches the gold. [I, built on FORT]
2. **Closed-book screen.** One no-tools answer from a cheap model. Drop if it scores at or above 0.5. This also tests memorization. [S: SWE-QA-Pro; SWE-Bench Illusion]
3. **Cheap-solver screen.** A weak grep-and-read agent with a cap of 3 tool calls. Drop if it passes. [I]
4. **Calibration pilot on DEV only.** 3 trials per question. Use a calibrator family that differs from the family under test, so you do not tune the set against the product you measure. Per-question solve rate p:
   - p = 1.0 and at most 3 calls: too easy. Drop or harden.
   - p = 0.0 on all trials: read the transcripts. Wrong or ambiguous gold is the usual cause. Fix it. Drop it if it is truly unsolvable.
   - Keep a spread. A target mix of about 30% (p >= 0.9), 40% (0.4-0.9), 30% (p <= 0.4) gives a mean near 65-75%. [I]
5. **Held-out.** Never read per-question results. The pilot filter must use dev only. Report aggregate accuracy, serial turns and tool calls. [project rule, CLAUDE.md]
6. **Do not publish dev-calibrated numbers as held-out numbers.** Selecting questions against one agent's failures biases the set against that agent. [I]
7. Per the saved memory rule, a paid pilot is prepared and then stopped until you approve it.

Report per question: p, median tool calls, median serial turns, answer hit time. Check that the mean turns land at 6-7 with Opus. If the mean serial turns are below 4, the set is still shallow.

## 5. Known pitfalls

1. **Identifiers in the question (exposed constants).** Names, strings and numbers in the question make the first grep runnable. [S: FORT-Searcher 2026] This is the main cause of 1-2 grep solves. Use domain words only. Never copy an error message, flag name or config key from the code.
2. **Gold in tests, docs, comments, fixtures.** Agents answer from a test name or a doc table. [I; RepoQA comment result S] Require gold in production source and check that tests and docs do not state the answer in the same words.
3. **Solution leakage in the prompt.** 32.67% of SWE-bench successes had the solution in the issue text. [S: SWE-Bench+ 2024] The same risk applies to a question that describes its own answer.
4. **Memorization.** 76% versus 53% file-path accuracy on and off SWE-bench. [S: SWE-Bench Illusion 2025] OpenAI stopped reporting SWE-bench Verified: frontier models reproduce gold patches from a task ID, and about 59% of audited hard tasks had flawed tests. [S: OpenAI 2026; Latent Space interview 2026] An empty-context baseline can also be inflated by memory on easy instances. [S: SWE-Explore 2026]
5. **Ambiguity.** Underspecified questions let valid answers fail. Over-wide tests reward extra features. [S: OpenAI 2024, 2026] Use the two-expert test and decoy notes.
6. **Judge leniency and format bias.** Judges can score fluent but wrong answers well. Deep Agentic Search found that coordination-breakdown failures (41.8% of deep-agent failures) were typically silent and ended in a fluent, confident, wrong answer. [S] CoReQA found position bias in pairwise judging. [S] Use atomic facts, fact-level scores, multiple judges and human checks.
7. **Pass-threshold artifacts.** One benchmark's Pass rate gap moved from 49.6 points at cutoff 70 to a minimum 3.8 points across cutoffs 50-90, because many answers sat near the cutoff. [S: Deep Agentic Search 2026] Report a threshold sweep or the mean fact score.
8. **Negative questions.** Closed-world claims fail on dynamic dispatch, reflection and generated code. [I] Require 3 or more greps and a named decoy. Include positives and negatives together, or agents learn to over-search or under-search. [S: Anthropic 2026]
9. **Run-to-run noise.** One trial is not enough. Pass^3 is 30-50% below Pass@1. [S: SWE Atlas 2026] The micro-smoke note in project memory (1 cell has an MDE of 30-57%) agrees.
10. **Shared state.** Leftover files and caches across trials cause correlated failures. [S: Anthropic 2026]
11. **Name clash.** Two papers are called "SWE-QA" (2025 open-ended QA; 2026 multiple-choice). Cite the arXiv number.

## 6. Repository selection

What the benchmarks use:

| Benchmark | Repo choice |
|---|---|
| SWE-QA 2025 | 15 Python repos, about 13K to 800K LOC, 48 questions each. The 3 added repos come from SWE-bench-Live to reduce leakage. |
| SWE-QA-Pro 2026 | Long-tail repos (not the famous few), executable environment, chosen to cover 48 issue clusters. 26 test repos, 260 questions. |
| SWE Atlas 2026 | 18 actively maintained GPL repos. Copyleft lowers the chance of training exposure. Expert rewrites of prompts. |
| SWE-bench Pro 2025 | GPL public set, held-out private GPL set, commercial set. |
| Loc-Bench 2025 | Issues created after October 2024. Balanced over bug, feature, security, performance. |
| ContextBench 2026 | 66 repos, 8 languages, 1,136 tasks. |
| SWE-Explore 2026 | Average 759 files and 180K lines per repo. Gold averages 4.3 files. |
| CrossCodeEval 2023 | 4 languages. Permissive licenses. Static analysis proves the cross-file need. |

Rules for r3-hard [I, built from the above]:

- **Size.** At least about 50K non-test LOC and 400+ files, so a tree listing cannot be read. Stay under the product's index file cap.
- **Languages.** At least 5 languages. Pick repos with registries, plugins, dependency injection, config-to-code mapping and conditional compilation. They produce cross-layer, gating and decoy questions. Skip flat utility libraries.
- **Fresh and unfamiliar.** Prefer long-tail repos with fewer than a few thousand stars, or repos with a major rewrite after the model cutoff. Run the closed-book screen per repo. Drop a repo if more than about 10% of its questions pass closed-book.
- **No agent files.** Exclude repos that ship AGENTS.md, CLAUDE.md and similar files. (Your REPOS.md already does this.)
- **Pin the commit.** Record the SHA.
- **Per repo.** 20-30 questions across all types. Stratify on type and repo for the dev / held-out split (seed 42).
- **Executable environment is optional.** SWE Atlas and SWE-QA-Pro use it to run the code. Static reading is enough for retrieval questions.

## 7. Paste-ready checklist for the drafting brief

### 7.1 Rules for every question

- [ ] The question uses domain, user, config or protocol words only. No identifier, string literal, flag, error message or path fragment from the answer.
- [ ] The author card lists the cheapest route as numbered steps. At least 4 dependent steps. Each step needs the previous step's result to form the next query.
- [ ] The author card lists the first 3 greps a smart agent would try. None may reach the gold directly.
- [ ] No single clue in the question identifies the answer. Test: delete each clue in turn. The question must stay ambiguous without at least two of them.
- [ ] No single file, doc page or test holds the whole answer. Gold lives in production source in 3+ places (or 1 place plus a named decoy).
- [ ] One named decoy per question at minimum: a wrapper, a same-name symbol, a deprecated path, a doc example, a test helper.
- [ ] Gold facts: 3-6 atomic, binary, independently checkable claims. One per hop or per location. Mark 1-2 as critical (the final hop or the deciding condition).
- [ ] An independent reader (no gold) reaches the same gold when given the repo. Two readers agree.
- [ ] Closed-book risk noted: could a model answer from general knowledge or from the repo's fame?
- [ ] Equal alternatives are listed in the gold (if two places are equally right, both are gold).

### 7.2 Templates by type (skeleton only; fill with domain words from your own repo)

**chain** (3-5 hops, 3+ files)
- Query skeleton: "When a <user action in domain words> happens, what finally <observable effect>, and which component decides it along the way?"
- Gold: file + symbol for every hop (entry, dispatch, handler, effect). One fact per link, e.g. "<hop 2> hands off to <hop 3> by <mechanism>".
- Cheapest-route rule: hop 1 must be found from the domain words, and each later name appears only in the previous hop's code.
- Fake-hard check: if the effect has a unique string, move to a different effect.
- Expected turns: 6-9.

**completeness** (4-6 members)
- Query skeleton: "Which places in the <layer> enforce <rule stated in plain words>? Name each and say what it does on violation."
- Gold: each place is one fact. Members use different names and live in different modules. Add 1 near-member (defined but never reached, or enforces a different rule) as a decoy.
- Grading: recall over members, minus a penalty for each non-member claimed. Use F-beta with beta = 0.5 (precision-weighted) as a secondary score.
- Fake-hard check: if one identifier greps all members, drop it.
- Expected turns: 7-10.

**cross-layer** (user vocabulary to internal code)
- Query skeleton: "A user sets <documented option in user words>. Where does the code turn this into <internal behaviour>, and what value or name does it use internally?"
- Gold: the mapping point (parser, rename table, alias, derived key), the internal consumer, and the effect.
- Rule: the option's literal text must not appear in the consuming code, or it must appear only through a derived or mapped name. Grep on the user words should hit docs, tests or help text only.
- Expected turns: 6-8.

**condition** (precedence, ordering, defaults)
- Query skeleton: "If <setting A> and <setting B> are both given, which one wins, and what happens when <third state>?"
- Gold: the deciding branch (file + symbol), the order of evaluation, and the result for 2-3 named scenarios. Each scenario outcome is one fact.
- Fake-hard check: if one function body holds all of it, add a second layer (a wrapper that overrides, or a default applied elsewhere).
- Expected turns: 5-8.

**decoy** (same-name or look-alike candidates)
- Query skeleton: "There are several <thing in domain words> handling <topic>. Which one is used when <distinguishing detail>?"
- Gold: the one correct symbol and the detail that decides. Notes name every decoy and why it fails.
- Rule: the distinguishing detail is behaviour, not a name. A wrong decoy must be reachable by the first grep.
- Expected turns: 5-8.

**negative-decoy** (looks present, does nothing)
- Query skeleton: "Does <feature in user words> actually <behaviour>? If so, where?" Gold: `expectedNoMatch: true`.
- Gold facts: what exists (the decoy: parsed-but-unread option, dead helper, ignored config key) with file + symbol, and why it does not do the asked thing.
- Grading: a bare "No" earns partial credit at most. Full credit needs the decoy named. Notes list 3+ greps.
- Check dynamic dispatch, reflection and generated code before you claim a negative.
- Expected turns: 5-8.

**gating** (flag, build tag, platform, version)
- Query skeleton: "On <platform or build variant>, what does <behaviour in domain words> do, and does it differ from the default?"
- Gold: the variant file or branch, the gating mechanism (tag, cfg, flag, conditional export), and the difference from the default. The default implementation is the decoy.
- Rule: the gate name must not be in the question.
- Expected turns: 6-9.

**dataflow** (provenance or mutation)
- Query skeleton: "The <output field in domain words> shown to users: where does its value originally come from, and what changes it on the way?" or "Which code paths can change <state in domain words>?"
- Gold: source, each transformation (one fact each), and sink. For "who can change", list writers and say which are reachable.
- Expected turns: 6-9.

### 7.3 Grading checklist

- [ ] Score = weighted fraction of gold facts. Critical facts weigh 2x. Pass at 0.7, and also report the mean fact score.
- [ ] Judges: 3 from model families different from the answerer. Median. Include an "Unknown" option. Penalize facts that are claimed but wrong, not only missing ones.
- [ ] Judge sees only the facts, the question and the answer. It must ignore length and tone.
- [ ] Deterministic secondary scores: file recall, symbol recall (you already have these).
- [ ] Re-grade 40+ dev rows. Report the verdict-flip rate. Compare with 30-50 human-graded rows and report Cohen's kappa. Target 0.8 or higher.
- [ ] Positives and negatives both appear in the set, so agents are not rewarded for always or never answering.

### 7.4 Set-level checks (dev only, per-question reading allowed)

- [ ] Closed-book pass rate under about 10% per repo.
- [ ] Cheap-solver (3 calls) pass rate under about 15%.
- [ ] Mean serial turns for the target agent 6-7. Median tool calls roughly 8-12.
- [ ] Mean accuracy 60-80%, 3 trials per question. Report Pass@1 and Pass^3.
- [ ] No type has a mean under 4 serial turns. If one does, redraft that type.
- [ ] At least 4 languages and 5 repos. At most 30% of questions from any one repo.
- [ ] Mix: about 25% chain, 20% completeness, 15% decoy, 15% cross-layer, 10% condition, 5% gating, 5% dataflow, 5% negative. [I] Adjust after the pilot.
- [ ] Held-out: not read per question. Aggregates only, at milestones.

## 8. Open questions (not answered by the sources)

- No source measures gating and dataflow questions as separate types for coding agents. Pilot them.
- No source reports a mean turn count for Claude Opus with plain grep and read tools on repository QA. The 6-7 target needs your own pilot to confirm.
- Several 2026 papers were read only in part (see the source marks). Re-check their numbers before you quote them in a paper.

## 9. Sources

Read mark: **full** = text read from the PDF or HTML; **abstract** = abstract or summary page only; **snippet** = search snippet only.

### Repository QA and code localization
- SWE-QA: Can Language Models Answer Repository-level Code Questions? (2025, v2 2026). https://arxiv.org/abs/2509.14635 (full, partial)
- SWE-QA-Pro: A Representative Benchmark and Scalable Training Recipe for Repository-Level Code Understanding (2026). https://arxiv.org/html/2603.16124 (full)
- Deep Agentic Search for Repository-Level Code Question Answering: An Empirical Study (2026). https://arxiv.org/abs/2608.01507 (full)
- DeepRepoQA: Code Repository Question Answering with Deep Agent Exploration (2026). https://arxiv.org/abs/2608.24221 (abstract + summary)
- SWE Atlas: Benchmarking Coding Agents Beyond Issue Resolution (2026). https://arxiv.org/abs/2605.08366 (full)
- SWE-QA: A Dataset and Benchmark for Complex Code Understanding (LREC 2026, multiple-choice, different paper). https://arxiv.org/abs/2604.24814 (abstract)
- CoReQA: Uncovering Potentials of Language Models in Code Repository Question Answering (2025). https://arxiv.org/abs/2501.03447 (full, partial)
- LocAgent: Graph-Guided LLM Agents for Code Localization (ACL 2025; Loc-Bench). https://arxiv.org/abs/2503.09089 (full, partial)
- ContextBench: A Benchmark for Context Retrieval in Coding Agents (2026). https://arxiv.org/abs/2602.05892 (summary)
- SWE-Explore: Benchmarking How Coding Agents Explore Repositories (2026). https://arxiv.org/abs/2606.07297 (summary)
- CodeCompass: Navigating the Navigation Paradox in Agentic Code Intelligence (2026). https://arxiv.org/abs/2602.20048 (snippet)
- Agentless: Demystifying LLM-based Software Engineering Agents (2024). https://arxiv.org/abs/2407.01489 (snippet)
- Introducing SWE-grep and SWE-grep-mini (Cognition, 2025). https://cognition.com/blog/swe-grep (full)
- LoCoBench-Agent (2025). https://arxiv.org/abs/2511.13998 (snippet)

### Code retrieval and long-context code benchmarks
- RepoQA: Evaluating Long Context Code Understanding (2024). https://arxiv.org/abs/2406.06025 (summary)
- CodeQueries: A Dataset of Semantic Queries over Code (2022; ISEC 2024). https://arxiv.org/abs/2209.08372 (snippet)
- Long Code Arena: a Set of Benchmarks for Long-Context Code Models (2024). https://arxiv.org/abs/2406.11612 (snippet)
- CodeRAG-Bench: Can Retrieval Augment Code Generation? (2024; NAACL Findings 2025). https://arxiv.org/abs/2406.14497 (snippet)
- CrossCodeEval: A Diverse and Multilingual Benchmark for Cross-File Code Completion (2023). https://arxiv.org/abs/2310.11248 (snippet)
- CoIR: A Comprehensive Benchmark for Code Information Retrieval Models (ACL 2025). https://arxiv.org/abs/2407.02883 (snippet)

### Reasoning-intensive and agentic search
- BRIGHT: A Realistic and Challenging Benchmark for Reasoning-Intensive Retrieval (ICLR 2025). https://arxiv.org/abs/2407.12883 (summary)
- Rethinking Reasoning-Intensive Retrieval: Evaluating and Advancing Retrievers in Agentic Search Systems (BRIGHT-Pro, 2026). https://arxiv.org/abs/2605.04018 (full, partial)
- BrowseComp: A Simple Yet Challenging Benchmark for Browsing Agents (2025). https://arxiv.org/abs/2504.12516 (summary)
- FORT-Searcher: Synthesizing Shortcut-Resistant Search Tasks for Training Deep Search Agents (2026). https://arxiv.org/abs/2606.12087 (full, partial)
- Demystifying deep search: a holistic evaluation with hint-free multi-hop questions and factorised metrics (WebDetective, 2025). https://arxiv.org/abs/2510.05137 (summary)
- WideSearch: Benchmarking Agentic Broad Info-Seeking (2025). https://arxiv.org/abs/2508.07999 (snippet)
- MuSiQue: Multihop Questions via Single-hop Question Composition (TACL 2022). https://arxiv.org/abs/2108.00573 (snippet)
- AbstentionBench: Reasoning LLMs Fail on Unanswerable Questions (2025). https://arxiv.org/abs/2506.09038 (snippet)

### Saturation, contamination, eval design
- Demystifying evals for AI agents (Anthropic Engineering, 2026). https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents (full)
- Introducing SWE-bench Verified (OpenAI, 2024). https://openai.com/index/introducing-swe-bench-verified/ (snippet)
- Why SWE-bench Verified no longer measures frontier coding capabilities (OpenAI, 2026). https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ (page blocked, snippet only); interview summary: https://www.latent.space/p/swe-bench-dead (full)
- SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks? (2025). https://arxiv.org/abs/2509.16941 (snippet)
- The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason (2025; ICSE SEIP 2026). https://arxiv.org/abs/2506.12286 (snippet)
- SWE-Bench+: Enhanced Coding Benchmark for LLMs (2024). https://arxiv.org/abs/2410.06992 (snippet)
- SWE-bench Goes Live! (2025). https://arxiv.org/abs/2505.23419 (snippet)
