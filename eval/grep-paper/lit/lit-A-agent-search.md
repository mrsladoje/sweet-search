# Literature review A: search tools and tool-output design inside LLM coding agents

Date of review: 2026-10-19. "Verified" = I opened the arXiv abstract page or the primary page and read it. Author affiliations are often NOT shown on arXiv abstract pages; where I did not see them I say so. "UNVERIFIED" = search snippet or secondary source only.

Headline: I found NO work that ranks or apportions the line budget of exact-match grep output across files. The closest work either (a) ranks whole files/regions with a learned retriever, (b) post-filters tool output with a trained pruner, or (c) truncates blindly (head/tail). ss-grep's combination (exact grep semantics + weight ranking + Sainte-Lague line sharing + declaration-first + dropped-count) looks open.

---------------------------------------------------------------------
## 1. Grep-for-agents systems and studies

### 1.1 Is Grep All You Need? How Agent Harnesses Reshape Agentic Search
- arXiv 2605.15184 (verified), 14 May 2026. Sen, Kasturi, Lumer, Gulati, Subbiah; all PwC U.S. (affiliation seen on HTML page).
- ANSWER TO YOUR CHECK: it is about CHAT MEMORY, not code. Benchmark = LongMemEval-S, 116-question subset. Coding CLIs (Claude Code, Codex CLI, Gemini CLI) plus a custom harness "Chronos" are only the harnesses.
- Key numbers: inline grep beats inline vector in all 10 model/harness pairs, e.g. Opus 4.6 in Chronos 93.1 vs 83.6; Claude Code 76.7 vs 75.0; Codex GPT-5.4 93.1 vs 75.9; Haiku 4.5 in Claude Code 55.2 vs 44.0. With file-based delivery vector leads on 5 of 10 pairs.
- Ranks/budgets grep output? No. The paper describes no truncation or cap in its grep tool (mentions result truncation only as a generic mitigation).
- Threat: low. Support: shows harness/tool-call style moves accuracy a lot, so output format matters. Do NOT cite it as a code-grep study.

### 1.2 Small Agents with Semantic Search: Efficient Multilingual Code Localization (ColGREP-Agent)
- arXiv 2610.05099 (verified), 4 Oct 2026. Lasbordes, Sinha, Sourty, Chatelain, Seddah (LightOn / Inria-style authors; affiliation not shown on page, UNVERIFIED).
- Trains <2B agents with ColGREP (late-interaction semantic search tool) via SFT + RL, on SWE-bench Lite and Multi-SWE-bench Flash localization. Beats base models and GREP-based agents; better on unseen languages. -44.1% mean trajectory latency on CPU, -29.1% tokens.
- Ranks/budgets grep output? No. It replaces grep with a semantic tool and trains the agent; the grep baseline is a plain tool.
- Threat: medium on the "faster and cheaper for agents" claim; none on exact-match ranking. Good citation as "semantic tools beat plain grep for small agents".

### 1.3 ColGrep / LateOn-Code (LightOn)
- LightOn blog, Feb 2026 per search results. The blog URLs returned 404 for me, so UNVERIFIED. Snippet claims: local ColBERT-style search, semantic/regex/hybrid modes (regex narrows candidates, semantics ranks them), "56% fewer search operations than standard grep" in Claude Code benchmarks (vendor claim). `colgrep --install-claude-code` setup.
- Ranks grep output? Hybrid mode ranks regex-filtered candidates semantically, so it IS ranked retrieval, but by embeddings, not by exact-match statistics, and it does not apportion lines across files (UNVERIFIED).
- Threat: medium-high as the product people compare against ("drop-in grep + ranking").

### 1.4 Cognition SWE-grep and SWE-grep-mini
- cognition.com/blog/swe-grep (verified), 16 Oct 2025. Cognition (Windsurf). RL-trained subagents, grep/read/glob tools, up to 8 parallel calls x 4 turns; reward = weighted F-beta (beta=0.5) over file and line-range retrieval; >2,800 tok/s (mini) and >650 tok/s on Cerebras; "order of magnitude" faster than frontier models; internal Cognition CodeSearch Eval; downstream subset of SWE-bench Verified with Sonnet 4.5; latency demo vs Claude Code and Cursor CLI is informal.
- Output: a list of files with line ranges, produced by a model. Not exact-grep output; no mention of a line budget or apportionment.
- Threat: high as the "grep is a ranked retrieval problem" framing competitor, but it solves it with a learned subagent (slower, lossy, not drop-in). ss-grep is deterministic and keeps ripgrep match semantics.

### 1.5 Morph WarpGrep (v1, v2)
- morphllm.com blog and product pages; the blog fetch hit HTTP 429, so numbers are from search results (UNVERIFIED primary). WarpGrep v2 post, Feb 2026: SWE-Bench Pro, Opus 4.6 55.4 -> 57.5, Codex 5.3 56.0 -> 59.1, MiniMax 2.5 55.4 -> 57.6; "15.6% cheaper, 28% faster"; up to 36 parallel tool calls over 3 turns; precision-weighted reward; MCP server. All vendor-reported.
- Ranks/budgets grep output? Subagent returns relevant spans; no published line-budget method.
- Threat: medium-high (same slot as SWE-grep).

### 1.6 mixedbread mgrep
- github.com/mixedbread-ai/mgrep (verified). Natural-language CLI over a cloud store (mgrep watch syncs). Top-k via `-m` (default 10, MGREP_MAX_COUNT); reranked by default (`--no-rerank` to disable); results show path + line-range hints. Claim: "~2x fewer tokens than grep-based workflows" on a 50-task QA benchmark in Claude Code, LLM-judged.
- It ranks and caps results, but semantically, from a cloud index, with no regex semantics. Threat: medium on "fewer tokens than grep". Not exact-match.

### 1.7 ck (BeaconBay), osgrep (Ryandonofrio3), grepai (yoanbernabeu)
- Only secondary aggregators (UNVERIFIED primary). ck: local semantic + BM25 hybrid with Reciprocal Rank Fusion, grep-style flags (-n, -l, -L), `--json`, MCP server, Rust. osgrep: local embeddings + tree-sitter chunks, Claude Code plugin. grepai: embeddings + call graphs, MCP; ProductHunt claims up to 80% fewer Claude Code input tokens (author benchmark).
- Threat: low-medium; all are semantic or hybrid search, none claims exact-semantics ranked truncation. ck's grep-compatible flags are the nearest "drop-in" claim.

### 1.8 Cursor: "Improving agent with semantic search"
- cursor.com/blog/semsearch (verified), 6 Nov 2025, Heule, Jia, Jain (Cursor). Cursor Context Bench: +12.5% average QA accuracy (6.5% to 23.5% by model); online A/B: +0.3% code retention overall, +2.6% on 1,000+ file repos, 2.2% more dissatisfied follow-ups without it; custom embedding trained from agent traces; best result = grep + semantic search together.
- Does not describe how grep output is processed. Threat: low; supports "grep stays in the agent toolbox".

### 1.9 Claude Code Grep tool (ripgrep) and head_limit
- Official tools reference code.claude.com/docs/en/tools-reference (verified): Grep is built on ripgrep; output modes content / files_with_matches / count (count total covers all matches even when head_limit/offset truncate); content mode has `offset`; "No entries at this offset" message. IMPORTANT: on macOS/Linux/WSL the Grep and Glob tools are ABSENT by default; the shell runs embedded `ugrep` and `bfs`, so searches arrive as Bash calls. (Matters for the paper: the default surface on Mac is Bash grep, not the Grep tool.)
- head_limit default of 250: official docs page did not state it in what I read. Two Mintlify mirror pages and a 14 Oct 2026 article (claudelab.net, verified) say the tool description caps content mode at 250 lines. UNVERIFIED against Anthropic's own text.
- Best motivating evidence for the thesis: claudelab.net (14 Oct 2026) measured a search with 1,312 lines in 183 files; the first 250 lines (path order) touched only 42 files (23%) and showed no claude-code articles at all. They recommend a manual workaround (-l, then -m1 per file). That is exactly the "one line per file first" idea, done by hand. Blog, not peer reviewed.
- A GitHub issue (July 2026, via search result, UNVERIFIED) reports content mode replacing long lines with "[Omitted long matching line]".

### 1.10 OpenAI Codex CLI output truncation
- openai/codex PR #6476 (verified; opened ~10 Nov 2025, closed unmerged 17 Nov 2025 for PR #6746): 10 KB byte budget and 256-line cap, head+tail split (~5 KB each), 3-line marker. Secondary claim that the model sees the first 128 and last 128 lines of long output (UNVERIFIED). Separate `tool_output_token_limit` setting (third-party blog, UNVERIFIED).
- This is the blind head/tail truncation that ss-grep argues against. Strong evidence the premise is real: a harness truncates by position, never by relevance.

### 1.11 Cline "Why Cline doesn't index your codebase"
- cline.bot blog (verified), 27 May 2025, Nick Baumann (Cline). Arguments: chunking breaks code logic, indexes go stale, embeddings add IP risk; Cline explores like a developer. No benchmark numbers. Does not mention ripgrep or output caps (third-party summaries say Cline uses ripgrep, UNVERIFIED).
- Threat: none directly; supports "agents use plain search tools". Note ss-grep uses an index, so Cline's staleness argument is a counter-argument the paper should answer (ss-grep index tracks the working tree and the output is exact).

### 1.12 Augment Context Engine and Sourcegraph Amp / Deep Search
- Augment (search results, vendor, UNVERIFIED primary): Context Engine MCP, Feb 2026; claims +70% agent performance on 300 Elasticsearch PRs (900 attempts); Claude Code+Opus 4.5 +80%; model version inconsistent across its own pages.
- Sourcegraph: Deep Search (agentic, usable as subagent via MCP), Amp "Librarian" subagent for remote repos; Sourcegraph MCP benchmark claim -38% time, -30% tokens (vendor, UNVERIFIED).
- Threat: low for ss-grep's niche. They are semantic/agentic retrieval products and publish nothing about line-budget apportionment.

### 1.13 RTK (Rust Token Killer)
- github.com/rtk-ai/rtk (verified page): CLI proxy that rewrites outputs of 100+ dev commands via a Claude Code PreToolUse hook. For grep/rg it "truncates long lines, groups matches by file". Claims 60-90% fewer tokens; about 83.9k stars; Apache-2.0 (rtk-engine/proxy BUSL-1.1). README estimate: grep/rg about 16,000 tokens -> 3,200 over 8 calls (README estimate, bytes/4).
- Ranks/budgets? Groups by file and trims; no ranking by hit density or file type, no apportionment method published. This is the CLOSEST PRACTICAL competitor for "make grep output smaller for agents" and is very widely installed. Threat: HIGH on novelty of "compress grep output for agents"; LOW on the ranking/apportionment mechanism.

---------------------------------------------------------------------
## 2. Code localization papers and agent studies that use grep-like tools

### 2.1 SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering
- arXiv 2405.15793 (verified via arXiv HTML), Princeton Language and Intelligence. Search commands (find_file, search_file, search_dir) return at most 50 results; "if a search exceeds this number, we do not report the results and instead suggest that the agent write a more specific query". Table 3 (SWE-bench Lite): summarized search 18.0%; iterative search 12.0%; no search tools 15.7%. Iterative search hurts because agents inspect every match one by one.
- Exact current behaviour (I read tools/search/bin/search_dir on GitHub main): the cap counts FILES, not matches, and the threshold is now 100 files ("More than N files matched for TERM in DIR. Please narrow your search."). Nothing is listed on overflow. Results sorted alphabetically by path with per-file match counts (e.g. `./src/file.py (3 matches)`). So the paper (50 results) and the current repo (100 files) differ; cite the version you read. The paper says "50 results"; the repo script I read says 100 files.
- Key point for the paper: SWE-agent drops EVERYTHING on overflow and alphabetical order is the only order. It supports the thesis but never ranks.

### 2.2 Agentless: Demystifying LLM-based Software Engineering Agents
- arXiv 2407.01489, UIUC (Xia, Deng, Dunn, Zhang). Verified via search results only. Fixed pipeline localize -> repair -> validate, no tool choice; 32.00% (96) at $0.70 on SWE-bench Lite in v1; FSE 2025 version 32.67% (98) at $0.68. Localization is LLM-driven hierarchical, plus embedding retrieval; not grep-output ranking. Threat: none.

### 2.3 AutoCodeRover
- arXiv 2404.05427, NUS (Zhang, Ruan, Fan, Roychoudhury). Stratified code-search APIs over classes/methods; about $0.43 per issue; 19% to 23% on SWE-bench Lite depending on version. Structured API outputs rather than grep. Threat: none; related as "search API design".

### 2.4 LocAgent
- arXiv 2503.09089; Chen, Tang et al., Yale / USC / Stanford / All Hands AI; ACL 2025. Heterogeneous code graph + BM25 + multi-hop traversal; fine-tuned Qwen2.5-Coder-32B; up to 92.7% file-level accuracy; Loc-Bench. Threat: low (graph, not grep).

### 2.5 CoSIL
- arXiv 2503.22424; Jiang et al., Zhejiang University; ASE 2025. Iterative call-graph search with a pruner and reflection; Top-1 43% (SWE-bench Lite) and 44.6% (Verified) with Qwen2.5-Coder-32B. Threat: low.

### 2.6 OrcaLoca
- arXiv 2502.00350; Yu et al.; ICML 2025. Priority-based scheduling of LLM actions, action decomposition with relevance scoring, distance-aware context pruning; 65.33% function match on SWE-bench Lite. Closest in spirit to "relevance-score the search actions", but ranks actions not output lines. Threat: low-medium.

### 2.7 RepoGraph
- arXiv 2410.14684; Ouyang et al. (UIUC, Tencent AI Seattle, Rice, Notre Dame); ICLR 2025. Line-level code graph, ego-graph retrieval plug-in; gains on four SWE-bench methods. Threat: none.

### 2.8 SweRank / SweRank+
- arXiv 2505.07849 (Reddy, Suresh et al., UIUC and Salesforce; ICLR 2026); SweRank+ arXiv 2512.20482 (multilingual, multi-turn SweRankAgent). Embedding retriever + LLM reranker for issue localization; beats agent systems with closed LLMs on SWE-bench Lite and LocBench. Ranking, but of functions by issue text, not of grep matches. Threat: low (different input) but shows "localization as ranking" is established.

### 2.9 CoRet
- arXiv 2505.24715; Fehr, Sivaprasad, Franceschi, Zappella (EPFL/Idiap, AWS AI Labs); ACL 2025 short. Dense retriever for code editing; +15 pp recall. Threat: none.

### 2.10 SWE-Explore: Benchmarking How Coding Agents Explore Repositories (KEY BENCHMARK)
- arXiv 2606.07297 (verified), 5 Jun 2026. Zhang, Wang, Liang, Shi, Zeng, Wang, He, Xu, Ye, Cai, Gu (Shanghai Jiao Tong and Microsoft authors; affiliation not on page). 848 issues, 10 languages, 203 repos.
- An explorer returns a ranked list of code regions (K<=5) scored under a fixed LINE BUDGET (B in 100/300/500): nDCG@B, first useful hit, line precision/recall, context efficiency. Scored prefix = longest prefix of the ranked list within B lines.
- Findings: sparse retrievers (BM25, TF-IDF) close to Random; general agents (Claude Code, Codex, OpenHands, Mini-SWE-Agent, AweAgent) have high file hit but only 0.14-0.19 line recall; CoSIL highest non-oracle line recall 0.788 but noisy; downstream resolve (GPT-5.4, Mini-SWE-Agent): Oracle 59.7, Codex 50.3, Mini-SWE-Agent 50.0, Claude Code 48.0, TF-IDF 26.0, BM25 12.7, Random 4.7. Context efficiency correlates with resolve at r=0.950.
- Grep is NOT an evaluated explorer and truncation/ranking of grep output is not studied.
- Value: it provides the "ranked retrieval under a line budget" framing and a metric (nDCG@B, context efficiency) ss-grep can borrow to evaluate grep output. It is a benchmark for explorers, not a grep tool. Threat to novelty of the FRAMING: medium-high; to the mechanism: none.

### 2.11 ContextBench
- arXiv 2602.05892 (verified), 5 Feb 2026 (v3 11 Feb). Li, Zhu, Zhang, Feng, Wang, Pan, Barr, Sarro, Chu, Ye (UCL authors among them; affiliation not on page). 1,136 tasks, 66 repos, 8 languages; process metrics: context recall, precision, efficiency. 4 LLMs x 5 agents. Findings: scaffolding adds marginal context retrieval gains; LLMs favor recall over precision; large gap between explored and used context. Supports the thesis (agents over-retrieve; budget matters). Threat: none.

### 2.12 Deep Agentic Search for Repository-Level Code QA
- arXiv 2608.01507 (verified), 2 Aug 2026; Oskooei et al. (Turkish institution, not shown). On SWE-QA: semantic search 65.2% correct vs deep agentic search 46.2%; semantic search <half the cost per correct answer; 41.8% of deep-search failures at planner/subagent handoff. Threat: low; supports index-backed retrieval over multi-step exploration (ss-grep is index-backed).

### 2.13 The Devil Is in the Interface
- arXiv 2608.11386 (verified), 11 Aug 2026; Xu, Saghir, Wu, Cote, Wang, Lakkaraju, Pei, Zhang (Purdue and Microsoft Research Montreal style author list; affiliation not on page). 6 tool architectures, 3 actors, 11,700 trajectories; structured low-level interfaces up to 4.7x more consistent than bash-only; natural-language search +11% access to relevant files; CodeAct style -41.6% steps, -56.3% tokens. Supports "tool interface shapes behavior". Threat: none; cite as motivation that output/interface format is a first-class variable.

### 2.14 Code Isn't Memory
- arXiv 2606.22417 (verified), 21 Jun 2026; Bhola, Krishnan, Kurmala, NS. Structural codebase index inside a harness vs no index vs agentic grep, Claude Opus 4.7, 3 seeds, SWE-PolyBench Verified and SWE-bench Pro. Index gives localization and resolve gains in-harness, no regression vs agentic grep, lower cost per solve; decisive factor = multi-file changes. Threat: low; supports an index being worth it. Exact gain numbers were not on the abstract page (UNVERIFIED).

### 2.15 Does a Language Server Save Tokens for Coding Agents?
- arXiv 2608.13568 (verified), 29 Jun 2026; Pengcheng Xu (single author). LSP vs grep on Python/TypeScript with Opus 4.8 / Sonnet 4.6 / Haiku 4.5. LSP costs +6% to +118% more tokens on symbol localization; agents rarely use semantic tools when grep exists (0-6%); grep handles multi-file renames; location-only LSP fails ~3/4 of renames. Strong support that grep stays the dominant agent tool, so grep output quality matters.

### 2.16 An Empirical Study of Harness Design for Coding Agents
- arXiv 2609.20804 (verified), 17 Sep 2026; Fan, Zhang, Ma, Hu, Wang, Song, Liu, Zamani, Wang (UMass Amherst-style author list; affiliation not shown). 176 matched settings, 4 models, 5 context strategies, 4 window budgets, SWE-bench Verified and Terminal-Bench 2.1. Key: rule-based elision beats LLM summarization on efficiency; recoverable elision added complexity without accuracy gain; bash-only works for strong-bash models. Directly supports deterministic (non-LLM) output reduction like ss-grep's.

### 2.17 LLM Agents Can See Code Repositories
- arXiv 2606.14061 (verified), 12 Jun 2026 (v4 3 Aug), ASE 2026; Ma, Chen, Yang, Shi, Yan, Gu. Visual repository graphs plus text cut input tokens up to 26% with equal or better accuracy. Tangential. Threat: none.

### 2.18 Terminal Agents survey
- arXiv 2608.20485 (verified), 20 Aug 2026; Bin et al. (12 authors). Survey of command-line agents, 7-dimension competence profile; argues behaviour depends on model + interface + harness + runtime. Tangential citation for "terminal agent" context.

### 2.19 CodeGrep: An RL-Trained Retrieval Agent for LLM Coding Agents
- arXiv 2608.05886 (verified), 6 Aug 2026; Chen, Yang, Cao, Lin. 14B GRPO retriever issuing grep/glob/read, returns candidate files to a frozen coding agent; resolve 27.0% vs 25.8% (500 SWE-bench Verified); -15% rounds, -19% tokens on resolved; a 30B OpenHands agent averages 23 rounds and 631K tokens per resolved issue, dominated by grep/glob/view_file. Retriever precision decides help vs harm: BM25 0.375 (hurts), Jina 0.445 (neutral), CodeGrep 0.677 (helps). Does not say it ranks grep output. Threat: medium (naming and "grep cost" story); useful evidence that grep calls dominate agent token cost.

### 2.20 FastContext: Training Efficient Repository Explorer for Coding Agents
- arXiv 2606.14066 (verified: WITHDRAWN 30 Jun 2026 by Shaoqiu Zhang, "product IP issues"). 15 authors incl. Microsoft-style names. Exploration subagent returning file paths and line ranges; up to 5.5% better resolution, up to 60% fewer tokens; search-ish turns = 56.2% of tool turns and 46.5% of tokens (per search snippet). Do not cite as a result; withdrawn.

### 2.21 Better Call Grep / GrepRAG
- arXiv 2601.23254 (verified), v1 30 Jan 2026, v3 29 Jul 2026, ISSTA 2026; Wang, Wang, Li, Zhi, Han, Zhao, Wang, Deng, Yin (Zhejiang University authors; affiliation not on page). Repository-level code COMPLETION (CrossCodeEval, RepoEval-Updated), not an agent loop; LLM writes ~10 ripgrep commands, then BM25 identifier-weighted re-ranking and structure-aware deduplication of line-interval overlaps; context capped at 4,096 tokens; +7.04% to +15.58% relative EM. Threat: MEDIUM-HIGH for the narrow claim "rank ripgrep matches then cut to a token budget" (they do rerank + dedup + budget). Differences: ranks per-chunk by BM25 against the code being completed, no per-file apportionment, no declaration-first, no dropped-count, completion not agent tool output.

### 2.22 A New Role for Relevance: Guiding Corpus Interaction in Agentic Search (RARG)
- arXiv 2607.24223 (verified), 27 Jul 2026; Li, Li, Yu, Zhang, Zhou (WeChat AI style authors; not shown). Relevance-Aware RipGrep agent for document corpora (BrowseComp-Plus, BRIGHT), not code. Reranks rg matches with embeddings: pool M=500 matches, show top m (30 for BC+, 60 for BRIGHT), 1,000 or 500 chars per match, because "rg output is truncated". BC+ accuracy 84% (RARG++) vs 78% (DCI) with 23.9 vs 99.1 tool calls; BRIGHT nDCG@10 up to 53.36. Threat: MEDIUM-HIGH. It states the same problem ("rg output is truncated, so rank before cutting") for text corpora. Differences: embeddings, not exact stats; no file-level apportionment; not code.

### 2.23 CodeNib
- arXiv 2607.25431 (verified), 28 Jul 2026 (v2 28 Sep); Yu, Yu, Yuan, ... Zhao (UCSD / Jishen Zhao group, OrcaLoca authors; not shown on page). Multi-view data system (lexical, dense, structural) serving "bounded context"; context policies use 50-87% fewer tokens than grep/read across five models; 79 vs 66 (on-demand exploration) vs 56 (Aider repo map) on 200 SWE-bench Verified tasks. Threat: medium (bounded context vs grep baseline), but it replaces grep, it does not rank grep output.

### 2.24 Codebase-Memory
- arXiv 2603.27277 (verified), 28 Mar 2026; Vogel et al. Tree-sitter knowledge graph via MCP, 31 repos; quality 83% vs 92% for a file-exploration agent at ~10x fewer tokens and 2.1x fewer tool calls. Threat: low.

### 2.25 Code Understanding is a Bottleneck for Coding Agents (CABRA)
- arXiv 2610.10610 (verified), 7 Oct 2026; Balepur, Tomlinson, Schnabel. Synthetic call-graph benchmark, 6,840 tasks; agents offload to tools like grep; tool-call counts predict SWE-bench accuracy. Weak support: grep is the offload tool.

---------------------------------------------------------------------
## 3. Tool-output / observation compression and truncation for agents

### 3.1 The Complexity Trap (observation masking)
- arXiv 2508.21433 (verified via search), 29 Aug 2025 (v3 27 Oct 2025), NeurIPS 2025 workshop/venue; Lindenbauer, Slinko, Felder, Bogomolov, Zharov; JetBrains Research and TU Munich. In SWE-agent on SWE-bench Verified, masking old observations halves cost vs raw and matches LLM summarization (Qwen3-Coder 480B 53.8 -> 54.8); hybrid saves further 7% vs masking, 11% vs summarization. Supports "simple deterministic reduction is enough".

### 3.2 ACON
- arXiv 2510.00615 (verified via search), 1 Oct 2025; Kang et al., KAIST, Microsoft, Cambridge; ICLR 2026. LLM-optimized compression guidelines for observations and histories on AppWorld, OfficeBench, multi-objective QA; -26% to -54% peak tokens; distilled compressors keep >95% teacher accuracy. Not code search. Threat: none.

### 3.3 SWE-Pruner and SWE-Pruner Pro
- SWE-Pruner arXiv 2601.16746 (verified), 23 Jan 2026 (v4 7 May 2026); Wang, Shi, Yang, Zhang, He, Lian, Chen, Ye, Cai, Gu. Goal-conditioned 0.6B skimmer keeps relevant lines; -23% to -54% tokens on SWE-bench Verified; up to 14.84x on LongCodeQA.
- SWE-Pruner Pro arXiv 2607.18213 (verified), 20 Jul 2026; prunes inside the agent from its own hidden states; up to 39% fewer tokens; +3.8% SWE-bench Verified on MiMo-V2-Flash.
- Both prune the output AFTER it is produced by a trained model. They operate on tool output in general (file reads, grep) and are lossy. Threat: medium for the general claim "budget the observation"; none for exact deterministic grep ranking.

### 3.4 Squeez: Task-Conditioned Tool-Output Pruning for Coding Agents
- arXiv 2604.04979 (verified), 4 Apr 2026; Adam Kovacs (single author). Qwen 3.5 2B LoRA returns the smallest verbatim evidence block from one tool output; 11,477-example benchmark; recall 0.86, F1 0.80, removes 92% of input tokens; beats zero-shot 35B by 11 recall points. Not grep-specific. Threat: medium for "extract only the useful lines of tool output"; needs an extra model call per output, ss-grep needs none.

### 3.5 Paritok-4B and the compression-gateway cost study
- Paritok-4B arXiv 2608.24188 (verified), 25 Aug 2026; Shi and Chen. Extractive intent-conditioned compressor; output 25.7% of original on SWE-bench Lite with 86.5% single-shot solve quality retained (McNemar p=0.079 for the drop).
- An Empirical Cost Attribution of Context-Compression Gateways arXiv 2609.22114 (verified), 19 Aug 2026; Chen and Shi. Tool-schema filtering is the only reproducibly positive lever; content compression saves ~2% of cache-priced prefix per turn; single-shot benchmark gains must not be cited as multi-turn cost savings.
- Caution for ss-grep: the paper's cost claims must be measured as cost per solved task, not tokens.

### 3.6 Token Reduction Is Not Cost Reduction
- arXiv 2607.12161 (verified), 13 Jul 2026 (v5 12 Aug 2026); Weinberger and Hozez. Three token-reduction approaches vs unmodified Claude Code: biggest setup -38.4% tool-output tokens but +6.8% billed cost; token vs cost reduction r=0.15; on a SWE-bench Go subset aggressive compression reduced successful patch application. Prompt-cache traffic dominates cost. KEY RISK for ss-grep: a reviewer will cite this. The paper must report solve rate and cost per solve, not only token counts.

### 3.7 DTOC (Dynamic Tool Output Compression)
- arXiv 2609.26121 (verified), 6 Aug 2026 (ID is 2609 but date shows Aug 6; as the page showed); Chaturvedi et al., Leiden-area authors (van der Putten). Placeholders in context, full output restorable on demand, tested on DeepSWE; reversibility critical; solve rates 2.5x and 1.5x for Sonnet 4.6 and GPT-5.4; mixed for other models. Supports "state what was dropped / let the agent get more".

### 3.8 Other compression and working-memory work
- Solving Context Window Overflow in AI Agents, arXiv 2511.22729 (verified), 27 Nov 2025: memory pointers instead of truncation or summarization; ~7x fewer tokens (materials-science tool outputs).
- PACMS, arXiv 2606.20047 (verified), 18 Jun 2026: submodular selection over turns, memory and tool outputs; no numbers on the page.
- Measure Before You Manage, arXiv 2608.31057 (verified), 31 Aug 2026: 55 coding-agent trajectories; tool outputs have distinct retention; equal token budgets do not guarantee equal delivered context.
- What Does a Harness Buy? Tokens, Mostly, arXiv 2610.04433 (verified), 3 Oct 2026: harness mostly moves cost, not accuracy; cost per task up to 3x across harnesses.
- LogDx-CI, arXiv 2605.28876 (verified), 26 May 2026, Bowen Qin: 11 CI-log reduction tools; hybrid grep+tail routers give the best cost-quality; quality spread shrinks 7x in the agent loop but cost differences remain. Closest empirical study of "which lines survive the cut" (for logs), supports head-plus-matches as a strategy.
- A third-party blog (technologyonthe.net, Oct 2026, UNVERIFIED) recommends ranked, head-tail or sampled truncation before any summarizer. Not peer reviewed.
- Anthropic "Writing effective tools for agents" (original page not opened; only secondary summaries, UNVERIFIED): recommends pagination, filtering, truncation defaults (25,000-token default cited for Claude Code), and truncation messages that say how to narrow the query.

### 3.9 Aider repo map (adjacent, not grep)
- Secondary sources only (UNVERIFIED primary): tree-sitter definitions and references -> personalized PageRank -> render top-ranked definitions into a token budget (default about max(1024, min(max_input/8, 4096)); binary search for entries that fit). This is the best prior art for "rank code lines/definitions then fit a token budget". Not grep, not exact-match, no per-file apportionment, but a reviewer may point to it. Beaten by CodeNib in the CodeNib paper (56 vs 79 solved on 200 tasks).

---------------------------------------------------------------------
## (a) Five closest rivals, ranked by threat to ss-grep's novelty

1. RTK (rtk-ai/rtk). Same slot (hook that shrinks grep/rg output for Claude Code), huge adoption, groups matches by file and truncates long lines. No ranking by hit density or file type, no apportionment, no declaration-first (as far as README says). Must be named and compared.
2. GrepRAG / Better Call Grep (2601.23254). Only paper I found that reranks ripgrep matches and cuts to a token budget (4,096). Different task (completion), BM25 vs a query, no per-file fairness.
3. RARG (2607.24223). Explicitly says rg output is truncated and reranks matches (pool 500, show 30/60). Text corpora and embeddings, not code and exact statistics.
4. SWE-grep / WarpGrep / CodeGrep / FastContext family (Cognition, Morph, 2608.05886, withdrawn 2606.14066). Treat "which lines to show" as learned ranked retrieval under a budget; slower, lossy, not drop-in. The strongest competing answer to the same thesis.
5. SWE-Explore (2606.07297) as framing and metric rival: ranked regions under a fixed line budget with nDCG@B. Not a tool, but it owns the words "line budget" and "ranking" for exploration. Also mgrep/ColGrep as shipped ranked "grep" products (semantic, top-k).

Honourable mentions: Squeez and SWE-Pruner (learned post-hoc pruning of tool output); SWE-agent search_dir (drops all on overflow, alphabetical).

## (b) Claims already taken (do not claim as new)
- "Grep is a core agent tool and often beats vector search" (2605.15184 for memory; 2608.13568 for LSP; Cursor says combine).
- "Agent exploration is token-heavy and output size should be reduced" (CodeGrep, FastContext, SWE-Pruner, Squeez, RTK, 38.4% study).
- "Ranked retrieval under a line/token budget is the right framing for exploration" (SWE-Explore, Cognition F-beta over line ranges, Aider repo map).
- "Rerank grep/rg matches before cutting" (GrepRAG for code completion; RARG for text corpora).
- "Group grep matches by file and trim" (RTK; the claudelab -l / -m1 workflow).
- "Rule-based truncation or masking is as good as LLM summarization" (Complexity Trap; harness design study 2609.20804).
- "Tell the agent output was cut so it can narrow" (SWE-agent message; Anthropic guidance; DTOC reversibility).
- "Index-backed fast grep/semantic search for agents" (Cursor, mgrep, ck, osgrep, ColGrep, Code Isn't Memory).

## (c) Claims that look open
- Exact match semantics preserved (same match set as ripgrep) while ordering/selection under overflow is ranked. I found no tool or paper doing this; semantic tools change the match set, RTK/head-tail change it by position.
- Hit-saturation file weight hits/(hits+2) x file-type prior (source/test/generated) for grep overflow.
- Divisor apportionment (Sainte-Lague) of the line budget across files with a one-line-per-file floor. I found no use of apportionment methods in agent tool output or in search-result diversification for agents.
- Declaration-first line ordering within a truncated grep result.
- Stating the exact count of dropped matches in a drop-in grep (partial overlap: SWE-agent message, claudelab count mode, Claude Code count total).
- Measuring truncation loss for grep specifically (recall of the matches an agent needs at line budgets 100/250/500, path order vs ranked), plus downstream solve rate and cost per solve. No paper does this; SWE-Explore's metrics and ContextBench's recall/precision are reusable.
- Warm-daemon trigram/sparse-gram index plus native lane giving ~2.5x end-to-end speedup over ripgrep at identical output (I found no agent-search paper reporting exact-match end-to-end latency; Cognition's latency demo is informal).

## Risks the paper must handle
- Token Reduction Is Not Cost Reduction (2607.12161): report cost per solve and solve rate, not token counts.
- Cline's staleness argument against indexes: ss-grep must show the index follows the working tree and never changes output.
- Claude Code on macOS/Linux has no Grep tool by default; grep runs as embedded ugrep via Bash (official docs). State which entry point (Bash or Grep tool) the study targets and how ss-grep intercepts.
- head_limit 250 is documented only by mirrors and the tool description; re-check it against the current official text before printing the number.

## UNVERIFIED list
LightOn ColGrep blog (404; snippet only); Morph WarpGrep numbers (429; search snippets); Augment and Sourcegraph numbers (vendor snippets); ck, osgrep, grepai details (aggregators); Claude Code head_limit=250 (mirrors, claudelab article); Codex 128+128 line claim; Codex tool_output_token_limit; Cline using ripgrep; Aider repo map budget formula; Anthropic tools-for-agents post; affiliations of most arXiv authors (not shown on abstract pages); Agentless/AutoCodeRover/LocAgent/CoSIL/OrcaLoca/SweRank/CoRet/RepoGraph/ACON/Complexity Trap numbers (from search result summaries of arXiv pages, IDs appear in the results but I did not open the abstract pages myself).
