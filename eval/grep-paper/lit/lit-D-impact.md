# Impact strategy for the ss-grep paper (researched 2026-10-19)

Conclusion: the paper will earn citations if it ships a mined-trajectory benchmark and a drop-in tool, and if it takes a clear stance in the live "grep vs semantic search" debate. The first firm venue window is ASE 2027 (estimated 26 Mar 2027). Post to arXiv before 30 Nov 2026.

Legend: VERIFIED = read on a primary page or API this session. EST = estimate from a third-party tracker or last year's pattern. UNVERIFIED = not checked.

## 1. Comparable papers: citation counts (Semantic Scholar, 2026-10-19)

| Work | Cites | Year | Venue | Released artifact | Name / hook |
|---|---|---|---|---|---|
| SWE-bench (2310.06770) | 4,420 | 2023 | ICLR | Benchmark + leaderboard | Short, real GitHub issues |
| Lost in the Middle (2307.03172) | 5,550 | 2023 | TACL | Little code | Provocative, memorable claim |
| ColBERT (2004.12832) | 2,662 | 2020 | SIGIR | Code + model | Name; efficiency claim |
| SWE-agent (2405.15793) | 2,204 | 2024 | NeurIPS | Open agent; 20.6k GitHub stars | Coined "ACI" (a reusable term) |
| BEIR (2104.08663) | 2,160 | 2021 | NeurIPS D&B | Benchmark + leaderboard | Heterogeneous zero-shot eval |
| OpenHands (2407.16741) | 1,225 | 2024 | ICLR | Platform; 91.3k stars | Community of 188+ contributors |
| RepoCoder (2303.12570) | 628 | 2023 | EMNLP | Benchmark (RepoEval) | Simple iterative idea |
| Agentless (2407.01489) | 550 | 2024 | arXiv only | Code | Provocative: "no agent needed" |
| AutoCodeRover (2404.05427) | 517 | 2024 | ISSTA | Code | AST-aware search |
| SWE-Gym (2412.21139) | 391 | 2024 | ICML | Environments + data | Training-set release |
| SWE-smith (2504.21798) | 319 | 2025 | NeurIPS | Dataset + models | Data scaling |
| CodeRAG-Bench (2406.14497) | 153 | 2024 | (venue not checked) | Benchmark | Retrieval for code, benchmark |
| LocAgent (2503.09089) | 125 | 2025 | ACL | Code | Graph localization |
| Complexity Trap (2508.21433) | 56 | 2025 | arXiv | Little | Provocative: "simple masking is enough" |
| Better Call Grep / GrepRAG (2601.23254) | 6 | 2026 | PACMSE | Code | Closest prior art to the grep thesis |
| Tokenmaxxing (2607.22807) | 1 | 2026 | arXiv | None | "-maxxing" meme title |

Non-paper items with no citation count:
- Aider repo-map blog: UNVERIFIED citations. Aider has 49.6k GitHub stars (GitHub API).
- mini-swe-agent: no paper found. 8.7k stars, created 2025-06-28 (GitHub API).
- Cognition SWE-grep blog: dated 16 Oct 2025 (search result). The page itself did not load. It reports that agents spend over 60% of the first turn on retrieval, and says the models use grep, read and glob. Weights are not open (UNVERIFIED). Morph's WarpGrep openly cites it as inspiration. This is the strongest proof that "fast grep for agents" is a live market.

Note: one S2 call returned a mismatched id on my first guess (2309.17453 is StreamingLLM). All ids in the table were re-checked by title.

### Patterns
1. Benchmark or dataset plus a leaderboard compounds. SWE-bench, BEIR, SWE-Gym, SWE-smith, RepoCoder and CodeRAG-Bench all became things other people evaluate on, so they are cited per use.
2. A simple artifact that others adopt. SWE-agent, Agentless and Aider spread by being easy to run. Stars and citations move together.
3. A coined term gets cited as a concept. SWE-agent's "ACI" and Lost in the Middle are examples. Papers cite the term, not just the system.
4. A provocative "less is more" claim spreads fast. Agentless (550 cites without a venue) and Complexity Trap fit this. The claim must be backed by a strong, fair baseline.
5. Venue helps but is not required. Agentless has 550 citations from arXiv alone. Timing matters more: Agentless and SWE-agent appeared when the SWE-bench leaderboard was hot.
6. Small solo-authored system papers without a benchmark or a named concept get few citations. Better Call Grep has 6 and Tokenmaxxing has 1, which is the realistic floor for this topic.

## 2. Venues and dates (today is 2026-10-19)

Official dates were read from conf.researchr.org and iclr.cc pages unless marked.

| Venue | Track | Deadline | Status |
|---|---|---|---|
| ICLR 2027 | Main | Abstract 18 Sep, paper 25 Sep 2026 (AoE) | VERIFIED, passed |
| FSE 2027 (Shenzhen, 12-16 Jul 2027) | Research | 2 Oct 2026 | VERIFIED, passed |
| FSE 2027 | Industry | 23 Jan 2027 | VERIFIED, open |
| ICSE 2027 (Dublin, 25 Apr-1 May 2027) | Research | 30 Jun 2026 | VERIFIED, passed |
| ICSE 2027 | NIER, SEIP, Tool Demo and Data Showcase | 23 Oct 2026 | VERIFIED, 4 days away |
| ICSE 2027 | Workshops (LLM4Code, AGENT, AGENTVERIFY) | 13 Nov 2026 (workshop papers, all) | VERIFIED date; per-workshop page limits UNVERIFIED |
| ICSE 2027 | Doctoral Symposium | 14 Nov 2026 | VERIFIED; for enrolled PhD students, so probably not for you |
| MSR 2027 (Dublin, 26-27 Apr 2027) | Technical | Abstract 20 Oct, paper 23 Oct 2026 | VERIFIED |
| MSR 2027 | Data and Tool Showcase | Abstract 5 Nov, paper 10 Nov 2026 | VERIFIED; notification 5 Jan 2027 |
| MSR 2027 | Mining Challenge | Paper 23 Dec 2026 (abstract 18 Dec) | VERIFIED |
| MSR 2027 | Registered Reports | Abstract 13 Nov, paper 20 Nov 2026 | VERIFIED |
| ISSTA 2027 (Singapore, 7-10 Sep 2027) | Research | Abstract 8 Jan, paper 11 Jan 2027 | VERIFIED |
| ACL 2027 (Kyoto, 17-22 Aug 2027) | ARR | 4 Jan 2027 (AoE) | VERIFIED on 2027.aclweb.org; commitment date TBA |
| ASE 2027 | Research | about 26 Mar 2027 | EST (ASE 2026 deadline was 26 Mar 2026, VERIFIED) |
| SIGIR 2027 (Silicon Valley area, 18-24 Jul 2027) | Full | about 14 Jan 2027 | EST, call not published |
| SIGIR 2027 | Resource and reproducibility, short | likely Jan-Feb 2027 | EST (SIGIR 2025 resource track was 18 Feb 2025) |
| ECIR 2027 (Southampton, 21-25 Mar 2027) | Main | 5 Oct 2026 (aggregator) | UNVERIFIED, likely passed; reproducibility and resource dates not found |
| ICML 2027 | Main | about 22 Jan 2027 (abstract 16 Jan) | EST, call not published |
| COLM 2027 | Main | about 31 Mar 2027 | EST |
| EMNLP 2027 | ARR | about 28 May 2027 | EST |
| NeurIPS 2027 | D&B | about May 2027 | EST (2025 D&B was 15 May 2025) |
| DL4C | none found for 2027 | n/a | UNVERIFIED |

MSR Mining Challenge fit: poor. The 2027 challenge datasets are GitSkills and SpecMine, not agent trajectories. A paper there would have to use those datasets. Do not submit our trajectory work there.

### Timing against the PhD deadlines
- 30 Nov (ETH) and 15 Dec (EPFL) are before almost every full-paper decision. Only an arXiv preprint and a possible early acceptance can help.
- The only realistic accepted-paper options before 15 Dec are the MSR Data and Tool Showcase (submit 10 Nov, decision 5 Jan; too late) and ICSE workshops (decision 11 Dec). Both are minor.
- So plan on "preprint plus artifact plus stars", not "accepted paper", for the applications. A public arXiv paper with an openly runnable benchmark is a credible research signal.
- arXiv first is standard in this field. SWE-agent, Agentless and SWE-bench were all on arXiv months before publication. Double-blind rules at ICML, ACL and SIGIR allow arXiv postings.
- Check any double-blind rule at the target venue before naming the tool in a public repo link inside the submission.

## 3. Naming

- "Grepmaxxing": a web search for "grepmaxxing" returned only unrelated crypto "maxxing" pages and grep man pages. No tool or paper with that name was found. Only that one search was run, so a final check on GitHub, npm and arXiv is still needed.
- No arXiv title with "maxxing" was found by search. The Tokenmaxxing paper is real: arXiv 2607.22807, "The Best Programming Language for Tokenmaxxing", Wu, Anderson, Guha (Northeastern), 2026, cs.SE (VERIFIED). It has 1 citation as of today.
- The word "tokenmaxxing" is a 2026 industry meme for maximising token use as a productivity metric. It started with an internal Meta dashboard (Exadel; IBM published a response "valuemaxxing" on 25 Jun 2026). So "-maxxing" is topical, but it is now ironic and carries a negative sense (wasteful). "Grepmaxxing" could read as "max out grep", which fits, but it can also look like a joke to reviewers.
- Existing tools near the name (all from a web search, details UNVERIFIED): grepai, smgrep, sgrep, osgrep, mgrep (semantic grep plugins); Rustygrep (`--llm` flag, 60-95% output compression); Signal Grep (pi.dev, budgeted per-file output); pi-agentic-search (ranks ripgrep matches). Signal Grep and Rustygrep are the closest to budgeted output. They need a related-work paragraph and ideally a head-to-head baseline.
- No hits for "SmartGrep" or "RankGrep" as agent tools in that search. This was one query, so confirm on GitHub and PyPI before using them.
- Prior academic work: Better Call Grep / GrepRAG (arXiv 2601.23254, Zhejiang) studies grep-like retrieval for code completion. It must be cited. It does not cover ranked, budgeted, drop-in output.

## 4. The live debate and how to position

- Claude Code: Boris Cherny said the team used a local vector database early, then moved to agentic search (grep/glob), and that it did much better. Reported via secondary write-ups and podcast summaries. I did not find his original post. Treat the exact quote as UNVERIFIED. The Pragmatic Engineer covers the same point and cites stale indexes and permission complexity as reasons.
- Cursor (blog "Improving agent with semantic search", 6 Nov 2025, VERIFIED): semantic search added 12.5% average QA accuracy (range 6.5% to 23.5%). The A/B test shows +0.3% code retention, +2.6% on repos of 1,000+ files, and 2.2% more dissatisfied follow-ups without it. Cursor says grep and semantic search work best together.
- Cline (blog "Why Cline doesn't index your codebase"): chunking breaks code logic, indexes go stale, and a second copy of the code is a security risk. Read via search snippet only.
- Vendors with a stake: Morph (a 500-task vendor benchmark: grep 64.2%, semantic 71.8%, combined 84.1%; vendor claim) and Cognition SWE-grep (RL-trained fast retrieval subagent).
- Hacker News: threads exist, but I found only fragments ("agents don't need better search, they need grep"; staleness arguments). Real HN reception data: UNVERIFIED.
- Consensus: grep is the default, hybrid is best for large repos and concept queries. Almost all numbers are vendor-run or uncontrolled.

### Positioning
1. Do not fight the semantic-search camp. Say: "everyone's agents already use grep. Nobody has measured or optimised grep output." This fits both camps.
2. Lead with exact-match semantics. Your claim is "same results as ripgrep until the output overflows, then better". It is a drop-in, not a new paradigm, so skeptics cannot say you changed the question.
3. Give the neutral, controlled evidence the debate lacks: public trajectories, public benchmark, scripts to reproduce.
4. Compare against Signal Grep, Rustygrep, WarpGrep or SWE-grep where possible. At minimum cite them.
5. Risks: (a) the "2.5x faster than ripgrep" claim depends on a warm index and daemon. Say so in the first paragraph, and report cold-start and index build cost. (b) Replay recall on mined trajectories is not an agent outcome. The end-to-end A/B must show equal or higher solves at lower cost. (c) Avoid the SOTA overclaim and the joke-title risk on an application document.

## Recommendations

### Target venues
1. arXiv preprint by about 25 Nov 2026 (before the 30 Nov ETH deadline) with the replay study, speed table and a pilot of the A/B. Link the repo and benchmark.
2. Main submission: ASE 2027 (EST 26 Mar 2027), with the full A/B. Confirm the real date when the call appears. Backup: SIGIR 2027 resource track (EST Jan-Feb) if framed as a retrieval-output resource, or COLM 2027 (EST 31 Mar).
3. Optional low-cost hedge: MSR 2027 Data and Tool Showcase (paper 10 Nov 2026, VERIFIED) for the mined-trajectory dataset. Only if the dataset licence allows redistribution. Decision 5 Jan 2027 is too late for the applications but gives a published artifact.
4. Skip: ICSE 2027 and FSE 2027 research (passed), ICLR 2027 (passed), MSR Mining Challenge (wrong dataset), ECIR 2027 (likely passed).

### Title options
- Descriptive and searchable (my pick): "ss-grep: Ranked, Budgeted, Drop-in grep for LLM Coding Agents".
- Concept plus claim: "Grep Is All You Rank: Budgeted Output for Coding Agents".
- Memorable name with serious subtitle: "Grepmaxxing: Making grep Faster and Smarter for Coding Agents".
Use "Grepmaxxing" only as the tool or section name, or in the subtitle. Put the searchable terms (grep, coding agents, budget, ripgrep) in the title.

### Three artifacts to release
1. Mined grep-call replay benchmark: the real grep calls from public trajectories, gold-patch files, a fixed dev/held-out split with seed, and a one-command scorer. This is the BEIR/SWE-bench-style item that others will cite.
2. The drop-in `ss-grep` CLI with a ripgrep-parity test suite and a Docker image for reproduction (speed vs ripgrep, git grep, GNU grep, zoekt).
3. A trajectory-and-A/B kit: raw agent logs, the scripts that rerun the normal-grep vs ss-grep arms on SWE-bench-style tasks, and per-task costs.

### Three most citation-worthy contributions
1. A measurement: the first public study of how coding agents use grep and how often output overflows the budget (from real trajectories). Citable as a fact.
2. A named, reusable idea: budgeted output allocation (Sainte-Laguë apportionment plus declarations first) with a metric, "gold-file recall in the first N lines". Others can reuse the metric.
3. The result that an exact-semantics, drop-in tool gains speed and agent quality without changing the agent. This is the Agentless-style "simple beats complex" claim, and it is the headline.
