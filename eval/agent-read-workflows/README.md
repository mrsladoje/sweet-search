# Agent-in-the-Loop Read-Workflows Benchmark

This is the **agent-in-the-loop** counterpart to `eval/read-workflows/`
(which is a deterministic retrieval benchmark and stays as a regression
baseline). This bench actually spawns Claude Code via the `claude` CLI in
headless mode and lets a real agent solve repo-understanding tasks under one
of two tool policies.

## What it measures

For each (task × mode), it captures:

- **wall-clock duration** end-to-end
- **tool-call count** (parsed from the stream-json event log)
- **tool-output chars/tokens** (from the `tool_result` blocks)
- **Claude usage tokens + cost** (from the `result` event's `usage` and
  `total_cost_usd` fields when available)
- **answer parse success** (the agent is asked to end with a strict JSON
  block; we extract and validate it)
- **deterministic recall** of expected files, symbols, facts, and line
  ranges
- **policy violations** (post-hoc transcript audit — see `audit.js`)
- a **blind A/B judge score** from a third Claude call (haiku by default,
  configurable via `--judge-model`) with the answer order randomised so the
  judge cannot tell which mode produced which

## Modes

### `native-rg-read`

Mirrors Claude Code's default exploration: `Bash` (rg / grep / sed / awk /
ls / wc / find / cat / head / tail) + `Read`. The system prompt forbids any
`sweet-search` invocation; this is enforced via post-hoc audit of every
Bash tool input.

### `sweet-search-tools`

The agent is given a small set of agent-friendly wrappers (in `bin/`,
prepended to PATH automatically) over the Sweet Search JS API:

- `ss-grep "<regex>" [-k N]` — indexed bare grep (gram-prefiltered). For exact
  identifiers, constants, error codes, config keys, log strings.
- `ss-find "<query>" --regex "<regex>" [-k N]` — ColGrep / patternSearch.
  Regex shrinks the candidate pool; the natural-language query re-ranks via
  late-interaction MaxSim. For behavioural / semantic questions.
- `ss-read <file>` — whole file
- `ss-read <file> <start>` — **single line** (NOT start-to-EOF; the
  open-ended form is intentionally unsupported in the bench wrapper to
  prevent accidental over-reading)
- `ss-read <file> <start> <end>` — explicit line range
- `ss-semantic <file> "<question>" [--max-tokens 800]` — query-specific
  span(s) inside ONE file. Use only when the right file is known but the
  relevant span is unclear.

The wrappers are needed because neither the JS nor the native `sweet-search`
CLI exposes ColGrep (`patternSearch`) or bare indexed grep (`bareGrep`) as
subcommands — those live only as JS-API methods. The wrappers are a thin
node skin that drives the API and emits compact, agent-readable output.

Direct `sweet-search read` and `sweet-search read-semantic` are also allowed
(the wrappers are just shorter aliases).

The Sweet mode is **allowlist-based**: `audit.js` flags any leading Bash
command that is not in this set:

```
ss-grep, ss-find, ss-read, ss-semantic, sweet-search,
pwd, ls, wc, find, echo, printf
```

This stops the agent from contaminating the comparison via `cat`, `sed`,
`awk`, `head`, `tail`, `python`, `node`, `perl`, `xargs`, `jq`, etc. — any
leading command not on the allowlist (including at the start of a pipe or
subshell) counts as a violation. The native `Read` tool is also flagged.

Native mode stays denylist-based (any standard shell tool is fine; only
Sweet binaries and editing tools are forbidden).

Both modes share the same **budget caps** so the bench measures retrieval
quality, not call-count discipline:

| task type | tool-call cap |
|---|---|
| exact symbol / config / constant | ≤ 4 |
| behaviour / error-path | ≤ 6 |
| multi-file flow | ≤ 8 |
| absolute hard cap | ≤ 10 |

And the same **citation discipline**: prefer 1-3 high-confidence citations
over a long list. The Sweet policy additionally specifies a **mandatory
default workflow** (decision tree: which tool to call first based on
question shape; when to stop).

## Tasks

Hand-curated repo-understanding questions in `tasks.js`, derived from the
existing pattern-benchmark gold queries (`eval/data/pattern-benchmark-*/queries.jsonl`).
Each task carries:

- a natural-language `question` (not a regex)
- `expectedFiles` (path globs)
- `expectedSymbols` (function/class/struct names)
- `expectedFacts` (short distinctive substrings the answer must contain)
- `expectedLineRanges` (per-file gold line spans for line-overlap)
- `taskType` (function_behavior, error_handling_path, config_lookup,
  multi_file_flow, no_match, …)
- `difficulty` and `maxTurns`

Coverage as of writing:
- fastify: 10 tasks (3 exact + 3 behavior/error-path + 2 multi-file + 1 large-file + 1 no-match)
- gin: 5
- flask: 5
- ripgrep: 5

## Repos

Pinned in `../read-workflows/repo-manifest.json` (shared with the retrieval
bench). Fetched via `eval/scripts/fetch-benchmark-repos.js`. Each artifact
embeds the pinned SHA AND a content fingerprint over canonical files so
drift is detectable post-hoc.

## Usage

```bash
# Sanity check — one task, one mode dry run
node eval/agent-read-workflows/run-bench.js --repo=fastify --max-tasks=1 --dry-run

# Real run, one task per mode
npm run bench:agent-read-workflows -- --repo=fastify --max-tasks=1

# Realistic 5-task fastify run, with logs
npm run bench:agent-read-workflows -- --repo=fastify --max-tasks=5 --keep-logs

# All four repos (one subprocess per repo)
npm run bench:agent-read-workflows -- --all --max-tasks=3

# Single specific task by id (or :suffix)
npm run bench:agent-read-workflows -- --repo=gin --task=engine-struct

# Use a stronger judge
npm run bench:agent-read-workflows -- --repo=fastify --judge-model=sonnet
```

### Options

| flag | default | meaning |
|---|---|---|
| `--repo=NAME` | required | one of `fastify`, `gin`, `flask`, `ripgrep` |
| `--all` | off | spawn one subprocess per repo |
| `--max-tasks=N` | 5 | cap tasks per repo |
| `--iters=N` | 1 | iterations per (task, mode); >1 for variance estimates |
| `--seed=N` | 42 | RNG for task order + judge order |
| `--model=NAME` | haiku | worker Claude model |
| `--judge-model=NAME` | haiku | judge model |
| `--task=ID` | — | run only this task |
| `--mode=NAME` | — | run only this mode |
| `--timeout=MS` | 240000 | per-run wall-clock cap |
| `--dry-run` | off | print planned commands, run nothing |
| `--keep-logs` | off | persist raw NDJSON transcripts to `<artifact>-logs/` |
| `--skip-judge` | off | skip the blind A/B judge step |

## Output

JSON artifact at `.sweet-search/benchmarks/agent-read-workflows-<repo>-<ts>.json`
contains:

- `pinnedSha` + `fingerprint` for the repo
- `cliVersion` (Claude Code CLI version at run time)
- `policies` (verbatim system-prompt text for both modes)
- `cmdTemplate` (template for the `claude -p ...` invocation)
- `taskSummary` and `modeSummaries` (aggregates)
- `perTask` (per-task collapsed view: avg latency, tool calls, tokens,
  cost, recall, violations, the median answer)
- `rawRuns` (full per-iter records — every tool call, the answer, the
  audit, the score)
- `judgeResults` (per-task A/B judgement with de-randomised mode mapping)
- `detWinners` (deterministic per-task winner with overfetch flag)
- `judgeAggregate` (judge head-to-head)
- `caveats` (read these before drawing conclusions)

The console summary prints per-mode aggregates, judge head-to-head, and a
deterministic per-task winner list with an overfetch flag.

## Interpretation

- **Deterministic metrics are primary.** `factRecall`, `fileRecall`,
  `symbolRecall`, and `lineOverlap` are not affected by judge variance and
  are reproducible. Use them as the main signal.
- **`answerability = "full"` is strict.** It requires *all* of:
  - `fileRecall = 1`
  - `factRecall ≥ 0.8`
  - if `expectedSymbols` are listed, `symbolRecall ≥ 0.8`
  - if `expectedLineRanges` are listed, `lineOverlap ≥ 0.3`
  - `filePrecision ≥ 0.5` (no answering with a wall of irrelevant files)
  - When a run is downgraded from `full`, `score.downgradeReasons` lists
    the specific failing criteria. The artifact also surfaces
    `score.evidenceSuccess` (line-overlap pass/fail per task) and
    `score.lowPrecisionEvidence` (boolean).
- **Judge scores are advisory** — useful for "would a developer prefer
  this answer?" and for surfacing missing-facts/wrong-claims patterns the
  deterministic metrics can miss.
- **Token efficiency vs accuracy is the trade-off.** Expect Sweet to use
  much less context per task; whether that translates to better answers
  depends on whether the indexed grep / patternSearch found the right
  region cheaply enough that the agent didn't need to over-explore.
- **Policy violations matter.** A run with non-zero violations means the
  agent escaped the policy (e.g., sweet mode used `rg`). Reject results
  for that run when computing "honest" comparisons.
- **Haiku worker.** The default worker is Haiku for cost. It is faster and
  smaller than Opus/Sonnet; on harder tasks it may stop too early or
  miscite. Run `--model=sonnet` or `--model=opus` for a more demanding
  comparison.

## Caveats

- **Model variance.** Re-running the same task can produce different tool
  sequences and answers. Use `--iters=N` (`N≥2`) when you need a variance
  estimate.
- **Sweet-search CLI dependency.** The bench's `bin/sweet-search` shim
  execs `node core/cli.js`. It is prepended to the spawned agent's
  `PATH`. No global install required.
- **Read-semantic on cold cache.** First call per process pays the LI
  model load (~750 ms) and embedding service warmup (~900 ms). Subsequent
  calls are fast. Per-task latency reflects cold-start cost on iter 1.
- **Audit is post-hoc.** `--allowed-tools` plus the system prompt give the
  model strong nudges; `audit.js` is the source of truth. A run with a
  violation is still recorded — the artifact lets you see exactly what
  was forbidden.
- **No `--max-turns` flag** in CLI 2.1.x. We enforce turn limits via
  `--timeout=MS` and an in-prompt instruction. If the agent loops, it
  will be killed at the wall-clock cap.

## Files

```
eval/agent-read-workflows/
├── README.md          (this file)
├── policies.js        (system-prompt policies + tool rules per mode)
├── tasks.js           (curated tasks per repo)
├── claude-runner.js   (spawn claude -p, parse stream-json events)
├── audit.js           (post-hoc transcript audit)
├── metrics.js         (deterministic file/symbol/fact/line metrics)
├── judge.js           (blind A/B judge via a third claude -p call)
├── run-bench.js       (orchestrator + console summary + JSON artifact)
└── bin/                  (prepended to spawned agents' PATH)
    ├── sweet-search      (shim that execs `node core/cli.js`)
    ├── ss-grep           (indexed bare grep wrapper)
    ├── ss-find           (ColGrep / patternSearch wrapper)
    ├── ss-read           (sweet-search read wrapper, positional line args)
    ├── ss-semantic       (sweet-search read-semantic wrapper)
    └── _ss-helpers.mjs   (node script that backs the four ss-* wrappers)
```

## Relationship to the retrieval bench

`eval/read-workflows/` exercises the same three workflows but as
deterministic *runners* (no LLM in the loop). It is faster, cheaper, and
right for regression checking. This `eval/agent-read-workflows/` bench
exercises real Claude Code agents and answers the question "does Sweet
Search actually help an agent solve a real task end-to-end?" — at the
cost of model variance and dollars per run.
