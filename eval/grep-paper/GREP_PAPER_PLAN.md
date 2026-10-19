# ss-grep paper — research gaps, novelty and plan (v1)

**Version 1, 2026-10-19.** Planning only. No benchmark has run under this plan. No money is spent.
Every paid step needs an explicit owner go ([[feedback_never_launch_paid_runs_unapproved]]).

**Sources.** Four literature sweeps on 2026-10-19, kept in `lit/`:
- `lit/lit-A-agent-search.md`: about 45 works on search tools inside coding agents and on tool-output reduction.
- `lit/lit-B-classical.md`: 35 works on indexed grep, code-search ranking, apportionment in IR and snippets.
- `lit/lit-C-traces.md`: public trajectory datasets, plus our own grep counts on about 1,000 sampled trajectories.
- `lit/lit-D-impact.md`: citation patterns, venues, dates, naming and the grep-vs-semantic debate.

Each note marks claims VERIFIED or UNVERIFIED. The sample scripts named in `lit-C` were in a session scratchpad and are gone. Section 9, step P1, rebuilds them in the repository.

---

## 0. Conclusion

A paper is feasible, and one strong version exists. **Make it a measurement paper first and a tool paper second.**

The live debate in the field is "grep or semantic search". Both camps agree that agents call grep all the time. Nobody has measured what an agent loses when grep output is cut. Nobody has optimised which lines survive the cut. We can do both with public data, at about $0, before the ETH deadline (30 Nov 2026).

The paper's spine:
1. **Census.** How public coding agents call grep, how large the full output is, and how often the agent cuts it (`| head`, harness caps).
2. **Truncation loss.** How often the cut removes the file or lines that the gold patch edits. Nobody has published this number (lit-A §(c), lit-C §5).
3. **Mechanism.** Grep overflow as an apportionment problem: rank files, give each one line, then share the rest with a divisor method (Sainte-Laguë), declarations first. The match set stays exactly that of ripgrep.
4. **Benchmark.** A frozen, public replay set of real agent grep calls with gold targets and a one-command scorer. Other people can use it. This is the citation engine (lit-D §1 patterns).
5. **Speed and end-to-end check.** Exact-output speed against the grep family, plus an agent A/B that reports cost per solved task.

## 1. What already exists (rivals and prior art)

### 1.1 Closest rivals, most threatening first

| # | Work | What it does | Where it stops |
|---|---|---|---|
| 1 | RTK (rtk-ai/rtk, about 84k stars) | Hook that rewrites grep/rg output for Claude Code: groups matches by file, trims long lines; claims 60–90% fewer tokens | No ranking by hit density or file kind, no apportionment, no measured loss |
| 2 | GrepRAG / "Better Call Grep" (arXiv 2601.23254, ISSTA 2026) | LLM writes ripgrep commands; BM25 rerank plus dedup; cut to 4,096 tokens | Code **completion**, not agent tool output; no per-file share; no declarations first |
| 3 | RARG (arXiv 2607.24223) | Says "rg output is truncated, so rank first"; reranks a pool of 500 rg matches with embeddings, shows 30–60 | Text corpora (BrowseComp-Plus, BRIGHT), not code; embeddings, not exact statistics |
| 4 | SWE-grep (Cognition), WarpGrep (Morph), CodeGrep (arXiv 2608.05886) | RL-trained retrieval subagents return files and line ranges | A model, not a drop-in tool; lossy; extra calls; mostly vendor numbers |
| 5 | SWE-Explore (arXiv 2606.07297) | Benchmark: explorers return ranked regions, scored under a line budget B (nDCG@B, context efficiency); context efficiency correlates with resolve at r = 0.95 | Owns the framing "ranked regions under a line budget". It does not evaluate grep or its truncation |

Also close, all UNVERIFIED (named in lit-D §3; check them first, step P0):
- **Signal Grep** (pi.dev), described as "budgeted per-file output". If that is true, it is a direct rival.
- **pi-agentic-search**, described as "ranks ripgrep matches".
- **Rustygrep**, with an `--llm` flag that claims 60–95% compression.

### 1.2 Prior art we must cite and cannot claim

| Mechanism | Prior art |
|---|---|
| Trigram / sparse-gram index, then verify | Cox 2012 (Google Code Search); FREE (ICDE 2002); Zoekt; GitHub Blackbird (sparse grams, 2023); livegrep; ugrep-indexer; n-gram selection study (PVLDB 18, 2025) |
| Indexed regex search **for agents** | Cursor "Fast regex search" (2026-03-23): the closest threat to the speed claim |
| Fast exact search | ripgrep (BurntSushi 2016); Hyperscan (NSDI 2019) |
| Sainte-Laguë in IR | PM-2 (Dang and Croft, SIGIR 2012) apportions **rank positions among query aspects** with quotient v/(2s+1) |
| Proportionality in rankings | Skowron et al., "Proportional Rankings", IJCAI 2017 |
| File-kind prior, definition boost | Zoekt (test/vendor term frequency ÷5; symbol-kind score); Sourcegraph BM25F (2025, 5× definitions; file category signal); Linguist for generated files |
| One result per group first | Solr / Elasticsearch collapsing (host crowding) |
| "Results were truncated" notice | Zoekt display limits; SWE-agent "please narrow your search"; Claude Code `count` mode |
| Budgeted context selection | AdaGReS (2512.25052), PACMS (2606.20047), budget-RAG papers (2607.00725, 2606.02245) |
| Rule-based reduction beats LLM summaries | Complexity Trap (2508.21433); harness design study (2609.20804) |
| Learned tool-output pruning | SWE-Pruner (2601.16746), SWE-Pruner Pro (2607.18213), Squeez (2604.04979) |
| Rank code, then fit a token budget | Aider repo map (PageRank over definitions; UNVERIFIED details) |

### 1.3 Facts that support the premise

- **Grep is the dominant agent search tool.** Agents use LSP tools 0–6% of the time when grep exists (2608.13568). Inline grep beats vector search in 10 of 10 settings on chat memory (2605.15184: memory, **not code**, so do not cite it as a code study). Cursor reports that grep plus semantic search works best together.
- **Harnesses cut output by position, never by relevance:**
  - Codex CLI: a byte and line budget with a head-plus-tail split (PR #6476).
  - SWE-agent: drops **all** results above its cap and lists the rest in alphabetical order. The paper says 50 results; the current code says 100 files (lit-A §2.1).
  - Claude Code Grep tool: head_limit 250 (UNVERIFIED against Anthropic's text).
  - Claude Code on macOS and Linux has no Grep tool by default; grep runs as embedded ugrep through Bash (official docs, VERIFIED).
- **One anecdote matches our thesis exactly.** A 14 Oct 2026 blog (claudelab.net) found 1,312 matching lines in 183 files. The first 250 lines, in path order, covered only 42 files (23%). Its suggested workaround is "-l, then -m1 per file", which is our one-line-per-file floor done by hand.
- **"Agents don't paginate":** keyword priority raised precision@1 from 24.2% to 35.0% over FIFO. This is a secondary source. Find the primary source or drop it.

### 1.4 Risks from the literature

- **"Token Reduction Is Not Cost Reduction"** (2607.12161). Its biggest setup removed 38.4% of tool-output tokens but billed **+6.8%** cost. Reviewers will cite it. We must report solve rate and **cost per solved task**, never only tokens. 2609.22114 says the same about cache-priced prefixes.
- **Cline's argument against indexes:** they go stale, and chunks break code. Answer: the ss-grep index follows the working tree, and the output equals ripgrep's match set. The parity tests prove this.
- **Run-to-run noise:** temperature-0 runs flip about 9% of outcomes (2607.09691). The A/B needs repeats and paired statistics.

## 2. Research gaps (what is open)

| Gap | Evidence it is open | Our contribution |
|---|---|---|
| G1. No public census of agent grep use: shapes, output size, self-truncation | lit-C §5: no published grep frequency or output-size statistics; tool-use studies (2605.18332, 2604.22750, 2608.11386) report none | Census over 5+ public datasets, 3+ harnesses, 5+ model families |
| G2. No measurement of **truncation loss**: does the cut remove the edit target? | lit-A §(c), lit-C §5 | Recall of gold-patch files and lines at budgets N, for path order, the agent's own cut, and ranked output |
| G3. No deterministic, exact-semantics ranking of grep overflow | RTK groups only; GrepRAG and RARG rerank for other tasks with BM25 or embeddings; learned pruners need a model call | Apportionment-based allocation, same match set as ripgrep, about 0 µs added |
| G4. No formal account of **which division rule** to use for line budgets | PM-2 applies Sainte-Laguë to aspects, not to lines per file; no agent-output work uses apportionment | Formal model plus properties (§3): house monotonicity gives consistent pages, no Alabama paradox, a coverage floor |
| G5. No reusable benchmark for grep-output quality | SWE-Explore scores explorers, not grep; ContextBench scores whole agents | Frozen public replay set with a scorer and a leaderboard |
| G6. No exact-output speed comparison across the grep family on agent-shaped calls | Cursor gives vendor numbers only; the ripgrep blog is from 2016 | GNU grep, BSD grep, ripgrep, git grep, ugrep (with indexer), zoekt, ss-grep; cold and warm; build and memory costs; byte parity |

Gaps G1, G2 and G5 do not depend on ss-grep. Anyone can use them, so they draw the citations. Gaps G3 and G4 are the method. Gap G6 is the systems part.

## 3. The method, stated so reviewers can check it

**Problem.** A grep call matches M lines in F files. The consumer shows only N lines (N < M). Choose which N lines to show, and in what order.

**Allocation (shipped since 945a9664):**
1. File weight w_f = h_f/(h_f + 2) × prior(kind). Here h_f is the hit count. The prior is source 1, test 0.5, generated 0.25.
2. Keep the top files by weight. Give each kept file one line first (the coverage floor).
3. Share the remaining lines with the Sainte-Laguë quotient w_f/(2s_f + 1).
4. Inside each file, show declaration lines first.
5. Print the count of dropped matches.

**Properties to state and prove, or to cite from Balinski and Young (verify this source first):**
- **House monotone.** When N grows, no file loses a line. Output at budget N is a prefix-subset of output at N+1, so an agent that asks for more never loses what it saw. Divisor methods have this property. The Hamilton largest-remainder method does not (the Alabama paradox).
- **Unbiased.** Webster/Sainte-Laguë is the divisor method that favours neither large nor small files. D'Hondt favours dense files. This matches our earlier result: a linear weight let dense files take everything, and recall fell to 58.6%.
- **Saturating weight.** It stops one file with 400 hits from taking the whole budget.
- **Exactness.** The shown lines are always a subset of ripgrep's matches. Ranking never adds a line, and the dropped count is exact.

**Ablations (all offline, $0):**
- Order: path order (= `| head`), round robin, hits only, D'Hondt, Hamilton, Sainte-Laguë.
- Without the floor; without declarations first; without the type prior.
- Saturating constant 1, 2, 4.
- External rankers: BM25 against the issue text (GrepRAG style), a cross-encoder reranker (RARG style). These rankers see the task, so they are an upper-bound reference, not a fair rival. ss-grep sees only the call.
- An oracle that knows the gold files.

## 4. Experiments

### E0. Census (G1)
- **Data:** `nvidia/Open-SWE-Traces`, the main source: 677,813 trajectories, CC-BY-4.0, gold patch in each row. Three harnesses: OpenHands, SWE-agent, mini-swe-agent. Models: Qwen3.5–3.8, MiniMax M2.5, DeepSeek-V4-Flash.
- **Extra data:**
  - `nebius/SWE-rebench-openhands-trajectories` (67k, CC-BY-4.0).
  - `nvidia/SWE-Hero-openhands-trajectories` (34k, CC-BY-4.0).
  - SWE-bench/experiments S3 trajectories, the only source of frontier models (Claude 4.x, GPT-5, Gemini 3). There are 119 Verified entries. The licence is unspecified, so publish aggregates only.
  - SWE-smith (MIT; synthetic bugs, so flag it).
- **Skip:** Terminal-Bench, because it has no repo or commit. Public Claude Code traces, because they have no commit, no gold patch and an unclear licence. SWE-Zero, because the runs execute no tests and 92% of the shell calls are grep, which is not natural. We may use SWE-Zero for the speed workload only.
- **Report:**
  - Grep calls per trajectory (sample: 9–15).
  - Share of shell commands (about 27%).
  - Flag shapes: `-n` 75%, `-r` 36%, `-E` 17%, `-A`/`-B` up to 33%, BRE `\|` common, `rg` almost absent, `git grep` never seen.
  - `| head` rate (16–53%).
  - Full output size, by replay.
- Stratify by harness × model family × language.

### E1. Truncation loss (G2)
- **Unit:** one grep call that runs **before the agent's first edit**. Only these calls replay faithfully at the base commit: 22–35% of calls, about 15k per 5k trajectories.
- **Replay:** run the call at the base commit with the agent's own pipe removed. This gives the full match set, and the gold targets come from the gold patch.
- **Metrics at N ∈ {10, 20, 50, 100, 250}:**
  - File recall@N lines.
  - Hunk-line recall@N lines.
  - Declaration hit@N lines.
  - nDCG@B and context efficiency, borrowed from SWE-Explore.
- **Arms:** (a) what the agent actually saw, (b) path order (= ripgrep/grep plus `head`), (c) each ss-grep ablation, (d) the oracle.
- **Headline:** "In X% of overflowing calls, the edit target was in the full output but not in the part the agent saw."
- **Pre-registration:** the rule for `| head` (remove it, and also report as typed), the edit detector, the gold definition and N. Register all of these before any held-out call is replayed.

### E2. Ranking on the benchmark (G3, G4, G5)
- Split by **repo** with a fixed seed: 60% dev, 40% held-out, seed 42, stratified by harness and language. This follows the repository rule in CLAUDE.md.
- **Freeze the shipped algorithm before mining.** Its constants were tuned on our own traces, so the public held-out set is a true out-of-sample test. That is our strongest defence against the critique "you tuned on your benchmark".
- **Optional retuning:** retune only on dev, and only as a pre-registered v2 arm. Report held-out once, at the milestone.
- **Existing internal evidence (dev, own traces, exploratory only):** legacy → shipped on 154 overflow calls: answer file 82% → 88%, declaration line 34% → 64%. **Never cite the old 71.1% → 83.0%**: that was a ripgrep replay, not the engine (memory note ss-grep-weighted-alloc).

### E3. Speed (G6)
- **Tools:**
  - GNU grep 3.x
  - BSD grep (macOS)
  - ripgrep
  - git grep
  - ugrep, with and without ugrep-indexer
  - zoekt
  - ss-grep, cold and warm
- **Workload:** the E0 calls, translated per tool, on pinned repos at four size classes. Process spawn until the full output is read from a pipe, with interleaved repeats (the method of `~/.ss-eval/grep-e2e-bench`).
- **Fair output:** every tool prints the same N lines. Ranking costs are inside ss-grep's time. Also report the full-output mode. Old finding: at p90, ripgrep printed 9× more bytes than ss-grep. Report the subset where the output sizes are similar (it gave 2.03× on Mac).
- **Report separately:** index build time and memory, the first cold call, and the daemon RSS.
- **Platforms:** Mac M3 Max, Linux x86 (the box), Graviton if cheap. **Known gap:** the last Linux run gave 1.08×, and it ran before the native lane. Rerun Linux before we print any ratio.
- **Headline comparison:** ripgrep plus one indexed tool (zoekt or ugrep-indexer). Put GNU grep in the table, not in the abstract, because it inflates the ratio (earlier advice still holds).
- **Parity gate:** the match set is identical to ripgrep's on every call, and we publish the check.

### E4. End-to-end agent A/B (secondary, paid, needs owner go)
- **Arms:**
  - Arm 1: the stock `grep` on PATH.
  - Arm 2: a `grep` shim that sends file-search shapes to ss-grep and passes everything else (stdin filters, `-v` pipelines, unknown flags) to the real grep.
  - Optional arm 3: ripgrep plus a fixed `head -N` cap, as a control for "less output only".
- **Harnesses:** mini-swe-agent with an open-weight model (cheap; grep is its main tool), plus one frontier harness (Claude Code through Bash).
- **Tasks:** about 200–300 paired instances from SWE-rebench or our frozen held-out set. Use at least 2 repeats and paired bootstrap statistics.
- **Report:** solve rate, **cost per solved task**, tokens, grep calls, re-grep rate (does a cut output make the agent search again?) and wall time.
- **Rough cost:** at about $0.05–0.20 per task, 2 arms × 300 tasks × 2 repeats ≈ $60–250 for the open-weight model. This is an estimate; measure the price in a pilot. Frontier harnesses cost more; set a ceiling with the owner.
- **Expectation, stated now:** the effect on solve rate may be small or zero. Our own task bench found little retrieval headroom (memory: no-retrieval-headroom; dev rerun 10-05). The paper must stand on E0–E3. E4 is a check, not the headline.

### E5. Fresh-repo probe (repository rule)
Before publication, hand-write 20–30 grep tasks on a public repo never used in development. These numbers are the most credible.

## 5. Engineering work the plan needs

1. **GNU grep compatibility front end.** Agents type plain GNU grep, almost never `rg`. ss-grep today accepts `-n -r -i -w -F -A -B -C --include --exclude`, but the grep-family code I read has no handling for:
   - BRE alternation (`foo\|bar`)
   - `-E`, `-l`, `-c` and `-v`
   - stdin filter use

   The shim must translate BRE to the engine syntax, or pass the call through unchanged. Measure coverage: the share of E0 calls that ss-grep answers. Re-check the flag list before building.
2. **Trace miner:** parsers per harness format, path rewriting (`/testbed`, `/workspace/<owner>__<repo>__<ver>`), `cd` chains, pipes, and an edit detector. Put it in `eval/grep-paper/mine/`.
3. **Replay harness:** clone each repo at its base commit with a fixed repo budget (50–100 repos to start). Run the light index (`index-light.mjs`) and the arms. Reuse `eval/grep-allocation-replay/` (engine-faithful replay, fidelity check, provenance).
4. **Benchmark packaging:** call list, gold targets, split file, scorer and a Docker image. Redistribute only the CC-BY and MIT parts, with attribution, and never the repo checkouts.
5. **Native lane parity.** Any change to output shaping must be ported to the Rust lane in the same commit (CLAUDE.md, "ss-grep Native Lane").

## 6. Impact and citations

What made comparable papers cited (lit-D §1):

| Pattern | Examples |
|---|---|
| Benchmark plus leaderboard | SWE-bench 4,420; BEIR 2,160; SWE-Gym 391; SWE-smith 319 |
| Simple artifact others adopt | SWE-agent 2,204; Agentless 550 (arXiv only) |
| A coined term | "ACI" in SWE-agent |
| A "less is more" claim | Agentless; Complexity Trap |

Small system papers with no benchmark and no named concept stay near the floor: GrepRAG has 6 citations and Tokenmaxxing has 1.

Moves that follow from this:
1. **Release the benchmark as its own named object** with a leaderboard: a working name such as *GrepCut*, after a collision check. Every grep-output, pruner or explorer paper can then report on it. The rivals (RTK, SWE-Pruner, Squeez, RARG-style rerankers) become entries on our board.
2. **Coin one term.** Candidates: "truncation loss" (the measured quantity) and "budgeted grep" (the problem). Define each in one sentence in the abstract.
3. **Take a neutral side in the debate.** Say: "Both camps agree agents call grep; we measure and fix its output." Do not attack semantic search.
4. **Make the tool trivial to adopt:** one install line, a grep shim, and a Claude Code / Codex hook. Ship a ripgrep-parity test suite.
5. **Publish the census numbers** in a reusable table that other papers can quote.
6. **Credibility over the headline.** Publish held-out numbers only, with sample sizes, seeds and our losses (follow the RESULTS.md style of the MaxSim card). Do not overclaim SOTA ([[branding]]).

**Title options:**
- (a) "Grepmaxxing: Measuring and Minimising What Coding Agents Lose When grep Output Is Cut".
- (b) "Which Lines Should an Agent's grep Show? Truncation Loss and Budgeted grep for Coding Agents".
- (c) "ss-grep: Ranked, Budgeted, Drop-in grep for LLM Coding Agents".

My pick is (a) or (b): the searchable words go in the title, and "Grepmaxxing" serves as the hook.
- Risk: "-maxxing" is a 2026 meme with an ironic, wasteful sense (lit-D §3), and it may read as a joke in a PhD application.
- Check: a web search found no paper or tool named "Grepmaxxing". Confirm on GitHub, npm and arXiv before using it.

**Novelty wording.** Use "to our knowledge, the first measurement of truncation loss for grep in public agent trajectories". Never write "the first in the world". Never claim Sainte-Laguë in IR as new: PM-2 did that. Claim its application to line budgets per file under exact match semantics, with the stated properties.

## 7. Venues and dates (lit-D §2; VERIFIED unless marked EST)

| Date | Venue | Fit |
|---|---|---|
| 10 Nov 2026 (abstract 5 Nov) | MSR 2027 Data and Tool Showcase | Census dataset plus benchmark. Tight but possible, if the licence allows redistribution |
| 13 Nov 2026 | ICSE 2027 workshops (LLM4Code, AGENT) | Short census plus truncation-loss paper |
| **about 25 Nov 2026** | **arXiv v1** | E0 + E1 + E2 + E3 (+ E4 pilot if ready). Before ETH (30 Nov) and EPFL (15 Dec) |
| 11 Jan 2027 | ISSTA 2027 | Full paper. GrepRAG appeared at ISSTA 2026, so the audience fits |
| about 14 Jan / Feb 2027 (EST) | SIGIR 2027 full or resource track | Benchmark framing |
| about 26 Mar 2027 (EST) | ASE 2027 | Full paper with E4 |

Passed: ICSE 2027 research (30 Jun), FSE 2027 research (2 Oct), ICLR 2027 (25 Sep). The MSR Mining Challenge does not fit, because its datasets are fixed and are not trajectories. No accepted paper can arrive before 15 Dec. For the applications, the signal is the arXiv paper, a public benchmark and adoption.

**Load conflict.** The HNSW and MaxSim papers already use the Mac and the box in fixed windows (memory: hnsw-paper-s1-findings). E1 and E2 replays use CPU. Schedule them outside those windows, and never during a timed run ([[feedback_no_tests_during_mac_bench_queue]]).

## 8. Threats to validity (write these into the paper)

- **Self-selection.** Agents wrote `| head` because grep floods. Their queries already adapt to path-order output. The replay measures the counterfactual output, not the counterfactual agent. E4 covers the agent side.
- **Replay faithfulness.** Only pre-edit calls replay faithfully. Report the share we drop, and test whether pre-edit calls differ in shape from the rest.
- **Model mix.** The main data come from open-weight models. Frontier models grep less (lit-C §4: Opus 4.5 OpenHands made 0–1 grep calls per instance on a tiny sample). Report by model family. Add SWE-bench/experiments to cover the frontier models.
- **Gold targets.** The gold patch is one valid fix, not the only one. Report file-level and hunk-level results. File level is the robust one.
- **Own-tool bias.** We built ss-grep. Defences: freeze it before mining, use a public held-out split, a public scorer, external rankers as references, and publish our losses.
- **Speed.** Warm daemon plus index. State it in the first paragraph, and report the cold first call and the build cost.

## 9. Steps (all $0 until P6)

| Step | Work | Gate |
|---|---|---|
| P0 | Verify open rivals: Signal Grep, pi-agentic-search, Rustygrep, RTK's grep code path, Claude Code head_limit text, the primary source of "Agents don't paginate", AGENTS.md tool statistics (2602.11988), apportionment in recommenders, Balinski and Young. Name collision check | If Signal Grep already apportions lines, rewrite §2 G3 |
| P1 | Trace miner + census (E0) on a 5k-trajectory sample of Open-SWE-Traces, plus rebench-OH and Hero | Coverage table; pure-grep share |
| P2 | GNU grep front end / shim, plus the coverage measurement | Parity with GNU grep match sets on mined calls |
| P3 | Replay harness, repo budget, split (seed 42, by repo), pre-registration file | Pre-registration committed before any held-out replay |
| P4 | E1 + E2 on dev, then held-out once | Held-out aggregates only |
| P5 | E3 speed on Mac and Linux (after the native lane), with the indexed rivals | Byte parity check passes |
| P6 | E4 pilot (about $20, owner go), then the full A/B within an owner ceiling | Owner approval at each step |
| P7 | arXiv v1 about 25 Nov; benchmark + leaderboard + Docker release | Owner reads the draft |

**Owner decisions open:**
1. Title, and whether to use "Grepmaxxing".
2. Whether to attempt the MSR Showcase (10 Nov) and/or an ICSE workshop (13 Nov).
3. The A/B harnesses and the cost ceiling.
4. The benchmark name.
5. Priority against the HNSW and MaxSim papers in shared machine time.
