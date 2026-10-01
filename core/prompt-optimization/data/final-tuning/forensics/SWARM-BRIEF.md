# Forensic swarm brief — how do agents actually use the ss-* tools in real coding tasks?

You read REAL task trajectories of coding agents that had the sweet-search `ss-*` tools (product
2.8.x). Your job is to judge **with your own eyes** — reading the call, its full output, and what the
agent said/thought/did afterwards — whether each tool call was useful, which parts of its output the
agent actually used, which parts were waste, and whether the agent understood the tool. Numbers from
scripts already exist (`forensics/STATS.md`); we need the qualitative judgement scripts cannot make.

## Data (read-only)

- `core/prompt-optimization/data/results/final-tuning-forensics/dossiers.jsonl` in
  `/Users/admin/Projects/sweet-search-final-tuning` (80 MB; one JSON per call — use python/jq to filter,
  never print the whole file). Fields: `id, run, harness (claudecode|codex|opencode), model, variant,
  task, solved, class ('ss' for ss-* calls), tool, args, flags, output (FULL text), outputChars,
  turnsRemaining, amplification, before {assistantText, thinking}, after {assistantText, thinking,
  nextCalls[{tool,args,outputHead}]}`.
- `trajectories.jsonl` (index: run, task, harness, model, solved, turns, path to the raw session) —
  open the raw session when a dossier's before/after window is not enough to judge.
- `core/prompt-optimization/data/final-tuning/forensics/STATS.md` (deterministic stats; read first).
- The product's rules text the agents were given: `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`.
- The ss-search/ss-find printer: `eval/agent-read-workflows/bin/_ss-helpers.mjs` (to know what each
  output part means).

Thinking text is often empty (Opus) or encrypted (Codex); judge from visible text + next actions.

## Sampling

Take a **stratified random sample** of your group (seed 42; spread over tasks, runs, solved/unsolved,
early/late in the trajectory). Read **at least 40 calls deeply** (more if they are short). Say how you
sampled. Prefer `variant` = shipped/base/as-now rows; note if a row is from a variant.

## Label every call you read (one JSON per line)

```json
{"id": "...", "tool": "...", "harness": "...", "model": "...",
 "useful": "yes|partly|no|harmful",            // did this call move the task forward?
 "evidence": "short quote of what the agent said/did next that shows it",
 "partsUsed": ["rank1_code", "rank2_3_code", "summaries", "related", "same_file", "imports", "header_meta", "score", "confidence_sufficient", "trailer", "gutter_line_numbers", "other:..."],
 "partsIgnored": ["..."],                       // present in the output but never used
 "wasteChars": 0,                                // your estimate of output chars the agent did not need
 "agentUnderstoodTool": "yes|no|unclear",        // right tool for the need, right flags/args?
 "misuse": "none | describe (wrong flag, wrong tool for the job, re-ran an equivalent query, read a huge range, …)",
 "next": "drill_down|answered_or_edited|re_search_same_tool|switched_ss_tool|native_fallback|ignored",
 "whyNext": "your reading of WHY the agent did that (e.g. output truncated, wrong file, did not trust ranking, wanted full function)",
 "fixIdea": "optional: a product change that would have helped here"}
```

## Deliverables

1. `core/prompt-optimization/data/final-tuning/forensics/swarm/<your-group>.labels.jsonl`
2. `core/prompt-optimization/data/final-tuning/forensics/swarm/<your-group>.md` — conclusion first:
   - usefulness rates (yes/partly/no/harmful) with n;
   - which output parts are used vs ignored (counts) and the estimated waste share of output chars;
   - the 3–6 recurring failure / waste patterns, each with 2–3 example ids and a one-line quote;
   - whether the agent understands the tool and its flags; common misuse;
   - concrete product-fix proposals ranked by (expected tokens saved × how often it happens), each with
     the risk to accuracy. General wording only — no fix may encode a specific task, repo or symbol.
3. Final message (≤ 15 lines): the headline numbers and the top 3 fix proposals.

## Rules

Read-only on all data. Never run agents, benchmarks, `ss-*` tools, npm/vitest; no paid API calls.
Never open anything named `tasks_heldout2*` or HO2 data. Do not edit `~/.claude`. Do not commit.
Write only your two files.
