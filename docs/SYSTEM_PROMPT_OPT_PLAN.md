# System Prompt Optimization Plan

**Created**: 2026-05-03
**Last reinforced**: 2026-05-09 (§8.9 evaluator-risk mitigations)
**Status**: Draft, ready for spike-testing
**Depends on**: implemented `read` / `read-semantic` tools, agent read-workflow benchmarks, retrieval-overhaul (cAST + IAR + RRF + STOP rules) shipped 2026-05-05, IAR uniqueness gate shipped 2026-05-07

---

## Problem Statement

AI coding agents default to native `rg` + broad `Read` workflows for code exploration. When
sweet-search is installed, that default is no longer optimal:

1. **Search routing is under-specified** — agents are not naturally aware of indexed grep,
   ColGrep, structural search, semantic read, or exact range reads.
2. **Replacement rules are too weak** — "use sweet-search instead of Grep/Read" does not teach
   the model which sweet-search tool to choose, how to phrase queries, when to read, or when to stop.
3. **Query shape matters** — `sweet-search` auto/hybrid, indexed grep, ColGrep, structural mode,
   `read`, and `read-semantic` likely each have different optimal query styles.
4. **Prompt quality is a product surface** — agent benchmarks showed that tool behavior improved
   materially when the system prompt taught a decision tree, citation rules, and stopping rules.
5. **Multiple harnesses ship the same tools** — Claude Code, Codex CLI, OpenCode, Cursor each
   have different system prompts, instruction-file conventions, and tool-call formats. A single
   guidance artifact must work across all of them.
6. **Cross-model generalization is non-trivial** — empirical 2025-2026 evidence (PromptBridge,
   Arize SPL, Anthropic engineering posts) shows the same decision tree behaves differently
   across Claude 4.x / GPT-5.x / Gemini 3.x / DeepSeek V4 / Kimi K2.x / GLM 5.1.

The read tools are now implemented. This plan covers system prompt optimization, multi-harness
distribution, tool-use guidance, enforcement, query-shape benchmarking, cross-model GEPA/DSPy
prompt evolution, and a **SOTA-led** evaluatee strategy (primary metric on Opus-class / GPT-5.5 /
Gemini‑class models) plus a cheap auxiliary pool for volume and portability sentinels.

---

## Current Baseline

Implemented and available:

- `sweet-search read` — exact filesystem-grounded reads, ranges, batching, indexed metadata.
- `sweet-search read-semantic` — hybrid lexical/symbol/late-interaction span selection followed by
  exact disk re-read.
- `eval/read-workflows/` — deterministic retrieval/read workflow benchmark.
- `eval/agent-read-workflows/` — agent-in-the-loop benchmark comparing native `rg + Read` against
  sweet-search-only workflows under audited policies.
- Retrieval overhaul (commit ac280d4, 2026-05-05): cAST + IAR + RRF + STOP rules + Aider-style
  ref-count boost. 18/1/1 probes, 83% combined top-1 recall, +5 PASS net 0 regressions.
- IAR uniqueness gate (KPR/SPAR pattern, 2026-05-07): +0.37pp GCSN MRR. 60-probe split with
  colgrep presentation grading.

Recent benchmark findings:

- A strict sweet-search policy produced better answerability and citation precision than native
  workflows on the Fastify 10-task run.
- The largest behavior improvements came from prompt instructions, not tool implementation changes.
- The policy needed a concrete decision tree, allowed-command discipline, citation shape rules, and
  stop rules.
- Token/cost savings were useful but not universally huge, which means the next leverage point is
  teaching agents the optimal query grammar per tool.
- H2H N=30 (2026-05-08): sweet competitive on quality (100% file/fact recall), 12-30% cheaper on
  3/4 repos, judge prefers native 20/30 (subjective). The largest remaining gap is the agent's
  failure to *trust* sweet-search's `sufficient=YES` signals, not retrieval quality.

---

## Part 1: Cross-Model Generalization (May 2026 Findings)

### 1.1 Empirical evidence

A literature scan in May 2026 (Tavily-driven) over PromptBridge (arxiv 2512.01420), Arize
system-prompt-learning, Anthropic engineering posts, and the Eurekalert Nov 2025 cross-LLM
prompt-format study yields one consistent conclusion:

**A single unmodified agentic decision tree does not generalize cleanly across models.** The
failure modes are well-characterized — they are not random per-model quirks but a small set of
structural levers that interact differently with each model family.

| Lever | What models differ on |
|---|---|
| **Format** | Claude prefers XML tags (`<routing>...`); GPT-5/Codex prefers conversational/markdown; aggressive imperative ("MUST") helps Claude, degrades GPT-5 (over-literalism, "Prompting Inversion"). |
| **Reflection scaffolds** | "Think before tool call" boosts Claude/Sonnet; hurts GPT-5 because it has an internal router and an explicit thinking switch — double-thinking costs tokens with no quality gain. |
| **Length** | Claude Code ships 5K-15K-token system prompts with lazy loading; smaller-context or smaller-quota models (DeepSeek V4-Flash, MiniMax M2.7) punish verbosity. |
| **Examples vs rules** | Arize SPL paper used 150 SWEBench exemplars; example-heavy prompts transfer better across models than rule-heavy ones (less model-specific imperative grammar). |
| **Deny semantics** | Claude is deny-first; others use nearest-scope. Affects safety/permission rules, not routing. |
| **Tool-description verbosity** | Anthropic engineering shows precise tool-description refinement is the single biggest lever; this generalizes. |

### 1.2 What generalizes vs what needs per-model adaptation

| Generalizes | Needs per-model adaptation |
|---|---|
| Tool selection (which tool for which question shape) | Surface format (XML vs markdown vs JSON) |
| STOP-on-good-results discipline (semantic, not formatting) | Reflection scaffolds ("think then act") |
| Citation rules (required outputs are model-agnostic) | Length / progressive disclosure strategy |
| Worked examples (in-context learning is universal) | Imperative tone (MUST / SHOULD / suggest) |
| Tool-description quality | Deny-first vs nearest-scope permission semantics |

### 1.3 Implications for sweet-search

1. **Maintain ONE canonical decision tree** in `AGENTS.md`. The semantic content (which tool for
   which question, when to stop, how to cite) is portable.
2. **Ship per-model surface shims** for `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/sweet-search.mdc`.
   Each shim is tiny (≤ 200 tokens) and only adjusts format (XML wrap for Claude, conversational
   for GPT-5, frontmatter `alwaysApply` for Cursor).
3. **Prefer worked examples over rule lists** in the canonical tree. Per Arize SPL evidence, this
   is the single biggest cross-model robustness lever.
4. **Run GEPA with a SOTA-primary metric** (Section 8.5): optimize the **shipping score** (mean
   answerability across Opus 4.7, GPT-5.5, and Gemini 3.1 Pro). Use the **cheap four-model
   auxiliary pool** only for secondary portability signals and budget relief during early triage —
   not as the headline objective, because most users run frontier models.

---

## Part 2: SOTA Cheap-Frontier Model Landscape (May 2026)

### 2.1 Why this matters for the plan

GEPA training requires hundreds to thousands of evaluation calls per generation. The cost of the
campaign is dominated by the per-token rate of the **evaluatee** (the model running the agent
task), not the **reflector** (which runs once per minibatch). **Sweet-search ships to users on
frontier endpoints** (Claude Opus / GPT‑5.5-class / Gemini 3‑class): the headline metric must
reflect that reality. A cheap auxiliary pool stays in the protocol for exploratory screens and
portability telemetry, but it does not replace primary optimization on those frontier models — the
difference is deliberate spend on the right objective, not accidental overfitting to `$0.14/M`
models nobody uses in production agent loops.

### 2.2 The cheap-frontier table

Sorted by cost-per-correct-answer for our use case, May 2026:

| Model | $ in / $ out per 1M | SWE-bench (Verified / Pro) | Context | Notes |
|---|---|---|---|---|
| **DeepSeek V4-Flash** | $0.14 / $0.28 (cache hit input $0.028) | ~79% Verified | 1M | MIT open. Cheapest capable frontier. Anthropic-compat endpoint. |
| **MiniMax M2.7** | $0.30 / $1.20 | 56.2% Pro, 57.0% TB2 | 205K | Open weights, $0.06 cache. |
| **MiniMax M2.5** | $0.15 / $1.15 | **80.2% Verified** | 197K | Open. Free tier on OpenRouter. |
| **DeepSeek V4-Pro (promo until May 31)** | $0.435 / $0.87 | **80.6% Verified, 67.9% TB2** | 1M | MIT. Within 0.2pp of Opus 4.6. Jumps to $1.74/$3.48 June 1. |
| **Kimi K2.5** | $0.44 / $2.00 | 76.8% Verified | 262K | Modified MIT, less verbose than K2.6. |
| **Kimi K2.6** | $0.95 / $4.00 (cache $0.16) | **58.6% Pro #1**, 66.8% TB2 | 256K | 1T MoE. Very verbose (170M tokens to run AA Index — real bill is high despite low rate). |
| **GLM 5.1 (Z.ai)** | $1.40 / $4.40 (cache $0.26) | **58.4% Pro**, 63.5% TB2, 77.8% Verified | 200K | MIT, agentic-tuned, 8-hour autonomous. **Z.ai Coding Plan Lite = $10/mo, Max = $216/quarter** — subscription beats API for heavy use. |
| **Qwen 3.6 Plus** | $0.325 / $1.95 | 78.8% Verified | 1M | Free on OpenRouter (rate-limited). |
| **Xiaomi MiMo-V2.5-Pro** | $1.00 / $3.00 (≤256K), $2.00 / $6.00 (≤1M) | 53.8 II | 1M | Open, 42B active. |
| **Xiaomi MiMo-V2-Flash Thinking** | $0.09 / $0.29 | 86.8 coding (vendor-reported) | 262K | Cheapest by raw token. |

For final-validation references:

| Model | $ in / $ out per 1M | Notes |
|---|---|---|
| Claude Sonnet 4.6 | $3.00 / $15.00 | 200K, native vision, dominant in Claude Code |
| Claude Opus 4.7 | $5.00 / $25.00 | 87.6% SWE-bench Verified, 1M ctx |
| GPT-5.5 | $5.00 / $30.00 | Leads Terminal-Bench 2.0 by 13pp over Opus 4.7 |
| Gemini 3.1 Pro | $1.25 / $5.00 | Best long-context >200K |

### 2.3 Role assignments

| Role | Pick (May 2026) | Pick (after May 31, post-promo) |
|---|---|---|
| **Reflector / optimizer LM** | **DeepSeek V4-Pro promo** ($0.435/$0.87, 80.6% Verified — strong enough to reflect, dirt cheap) | **MiniMax M2.5** ($0.15/$1.15, 80.2% Verified) |
| **Primary evaluatee pool (shipping / headline GEPA metric)** | **Claude Opus 4.7** + **GPT‑5.5** + **Gemini 3.1 Pro** — `shipping_score := mean(answerability)` over this set | unchanged (re‑price API only) |
| **Claude cost-relief slot (optional, pre‑register)** | **Claude Sonnet 4.6** may substitute for Opus in **light** GEPA iterations or early triage only; **Opus 4.7 is mandatory** at medium/heavy GEPA and every promotion gate | unchanged |
| **Auxiliary evaluatee pool** (portability + architecture diversity, **not** the headline objective) | **DeepSeek V4-Flash** + **MiniMax M2.7** + **Kimi K2.5** + **Qwen 3.6 Plus** | unchanged |
| **Harness validation (Phase 2 / §9.3)** | Claude Code + **Opus 4.7** (or Sonnet only if reproducing a user-reported regression) + Codex on **GPT‑5.5** + OpenCode on **Gemini 3.1 Pro** + optional cheap replays | unchanged |

DeepSeek advertises \$0.028/M **cache-hit** input for V4-Flash. **Treat realized cache as an
empirical KPI**, not a budget axiom: GEPA rewrites policy text every generation (prefix drift),
and providers differ on what counts as a cache hit (see §8.9.3). Log blended \$/eval from week
one and keep a **cache-off upper bracket** in cost projections.

---

## Part 3: Multi-Harness Distribution Strategy

### 3.1 Harness inventory and instruction-file conventions (May 2026)

| Harness | Instruction file(s) | System-prompt size | Custom-model support |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` (project) + `.claude/rules/*.md` (lazy-loaded via `@imports`) + `~/.claude/CLAUDE.md` (global) | 5-15K tokens, lazy-loaded, XML-tagged | Native env-var swap (Anthropic-compat endpoints) OR proxy (`claude-code-router`, `free-claude-code`) |
| **Codex CLI** | `AGENTS.md` (project root + ancestors), `~/.codex/AGENTS.md`, `~/.codex/AGENTS.override.md` | ~3-5K tokens, conversational | First-class via `~/.codex/config.toml` `[model_providers.X]` with `wire_api = "responses"` |
| **OpenCode** | `AGENTS.md` (preferred); also accepts `CLAUDE.md` if symlinked | ~minimal (~500 tokens), most neutral | First-class, 75+ providers via `@ai-sdk/openai-compatible` |
| **Cursor CLI** | `.cursor/rules/*.mdc` (frontmatter: `description`, `alwaysApply`, `filePattern`) + legacy `.cursorrules` | ~1.25K tokens, XML-wrapped, isolated in user message for prompt-injection resistance | Limited: custom OpenAI-compat endpoints work for Chat, NOT for Composer (agentic mode) |
| **Gemini CLI** | `GEMINI.md` (configurable via `context.fileName` array, can include `AGENTS.md` / `CLAUDE.md`) | varies | Native, multiple providers |

### 3.2 Calling cheap models from each harness

**Claude Code** — DeepSeek and Z.ai ship Anthropic-compatible endpoints, making this a one-liner:

```bash
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=<deepseek-key>
export ANTHROPIC_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
```

**Critical gotcha**: also set `CLAUDE_CODE_ATTRIBUTION_HEADER=0` in `~/.claude/settings.json`
(NOT as an env var — Claude Code ignores env when routing through a custom base URL). Without
this, KV-cache invalidation gives a 90% slowdown.

For non-Anthropic-compat providers (OpenRouter, Kimi direct, MiniMax direct), use a proxy like
`claude-code-router` or `free-claude-code`. Both translate Anthropic Messages ↔ OpenAI chat
completions on the fly, with provider-specific quirks (Kimi top-level `reasoning_effort`,
DeepSeek `document` block normalization, etc.).

**Codex CLI** — `~/.codex/config.toml`:

```toml
[model_providers.deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.com"
env_key = "DEEPSEEK_API_KEY"
wire_api = "responses"   # NOT "chat" — being deprecated

[profiles.deepseek-pro]
model_provider = "deepseek"
model = "deepseek-v4-pro"
```

Switch with `codex -p deepseek-pro`. Profiles per provider; OpenAI is removing `wire_api = "chat"`
in 2026, so always use `"responses"`.

**OpenCode** — Most flexible. `opencode auth login` for presets (DeepSeek, Anthropic, OpenAI,
Cortecs/Kimi, Z.ai/GLM, MiniMax, etc.) or custom config in `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepseek": { "models": { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } },
    "moonshot": { "models": { "kimi-k2.5": {} } }
  }
}
```

Has `--format json` for benchmarking. **Best harness for cross-model GEPA validation** — same
wrapper, swap models with `--model provider/name`.

**Cursor CLI** — Custom OpenAI-compatible endpoints work for Chat but NOT for Composer (the
agentic mode). API key transits Cursor's backend (privacy concern). **Primary** cross-harness
validation still uses Claude Code / Codex / OpenCode (§9.3). **Additionally**, run a **thin
Composer smoke** on **final promotion candidates only** (small held-out subsample, default
Cursor model / subscription — no custom endpoint required) so marketing and real users on
Cursor agent are not a complete blind spot; log harness+build version. See §8.9.5.

### 3.3 Instruction-file convergence: AGENTS.md as canonical

The community pattern emerging in May 2026 (per `blakecrosley.com`, `layer5.io`, and Codex/Gemini
docs) is:

1. **Canonical**: `AGENTS.md` at project root holds the full sweet-search routing policy.
2. **Per-tool overrides**: `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/sweet-search.mdc` are either
   (a) symlinks to `AGENTS.md` for tools that need no metadata, or (b) thin shims that
   `@import` `AGENTS.md` and add tool-specific surface tweaks (XML wrap, frontmatter, deny rules).
3. **Imports**: where the harness supports them (Claude Code `@imports`, Gemini `@path/file.md`),
   prefer importing over duplicating.
4. **Discovery**: Codex enforces a 32 KiB cap (`project_doc_max_bytes`) on the merged
   `AGENTS.md` chain — split into nested `AGENTS.md` files in subdirectories if exceeded.
   **Promotion gate**: the campaign/runner asserts merged instruction size stays under cap
   (`scripts/eval-prompt-evolution.mjs` or CI) so optimized trees never silently fail on Codex
   ingestion (§8.9.7).

**Sweet-search init must write all four files.** Section 10 below specifies the exact flow.

---

## Part 4: Agent Instruction Placement

### 4A — Multi-File Injection (CLAUDE.md / AGENTS.md / GEMINI.md / .cursor/rules)

**Goal**: Inject one canonical sweet-search policy across every major coding-agent harness.

**Mechanism**: During `sweet-search init`, write a single canonical `AGENTS.md` and create
matching artifacts for each harness:

```
project/
├── AGENTS.md                          # canonical, source of truth
├── CLAUDE.md                          # imports AGENTS.md + Claude-specific shim
├── GEMINI.md                          # imports AGENTS.md (or symlink)
└── .cursor/
    └── rules/
        └── sweet-search.mdc           # frontmatter + import or copy
```

**Resolution rules** (per harness docs):

- **Claude Code**: reads `CLAUDE.md` from project root and ancestors; supports `@imports`. If only
  `CLAUDE.md` exists, inject directly. If both `CLAUDE.md` and `AGENTS.md` exist independently,
  inject sweet-search block into `AGENTS.md` and have `CLAUDE.md` `@import` it.
- **Codex CLI**: reads `AGENTS.md` from project root + global (`~/.codex/AGENTS.md`); supports
  `@filename` references. Stops searching at the working directory. 32 KiB cap.
- **OpenCode**: prefers `AGENTS.md`; will also read `CLAUDE.md` if symlinked or pointed at via
  config.
- **Cursor**: project rules in `.cursor/rules/*.mdc` with optional frontmatter (`description`,
  `alwaysApply: true`, `filePattern`). Legacy `.cursorrules` still works.
- **Gemini CLI**: `GEMINI.md` by default; `context.fileName` is configurable to an array
  (e.g., `["GEMINI.md", "CLAUDE.md", "AGENTS.md"]`).

**Marker format** (used in all four to enable idempotent rewrite):

```markdown
<!-- sweet-search:agent-instructions:begin -->
... managed sweet-search instructions ...
<!-- sweet-search:agent-instructions:end -->
```

**Injection logic**:

- If the marker block exists, replace it in-place.
- If the file exists but has no marker, prepend the block before the first `#` heading.
- If no instruction file exists yet, create it with the block + a minimal project header.
- Never modify content outside the marker block.
- For symlinks, edit only the real source file.

### 4B — `.claude/rules/sweet-search.md`

**Goal**: Keep Claude-specific sweet-search tool-routing instructions in a dedicated file while
relying only on documented Claude Code memory/import behavior.

Important constraint:

- Do not assume `.claude/rules/*.md` is auto-loaded unless independently verified.
- Treat `.claude/rules/sweet-search.md` as a support file loaded through a documented
  `CLAUDE.md` import.

Lifecycle:

- `sweet-search init` creates `.claude/rules/sweet-search.md`.
- `sweet-search init` ensures `CLAUDE.md` imports it.
- Re-running init overwrites the rules file idempotently.
- `sweet-search uninstall` removes the rules file and its `CLAUDE.md` import if they were created
  by sweet-search.

### 4C — UserPromptSubmit Reminder Hook

**Goal**: Keep sweet-search tool selection fresh in the agent's active context on every prompt.

Why this matters:

- It operates before the first tool call, where most bad routing starts.
- It helps prevent drift back to native `rg + Read`.
- The token cost is small relative to avoided bad exploration loops.

Reminder content should be concise and generated from the optimized policy:

- use indexed grep for exact identifiers/literals
- use ColGrep for behavior questions with a regex anchor
- use structural mode for callers/callees/impact
- use `read` for exact ranges
- use `read-semantic` when a file is known but the relevant span is unclear
- stop after enough evidence is gathered

### 4D — Optional Tool Enforcement

**Goal**: Add Claude-specific guardrails where supported, without assuming impossible tool swaps.

Important constraint:

- Repo-local Claude hooks cannot transform a `Grep` tool call into a `Bash` call running
  `sweet-search`.
- PreToolUse can allow, deny, hint, or rewrite same-tool inputs; it cannot change tool type.
- True transparent rerouting requires an external wrapper or SDK-based control loop.

Recommended enforcement:

- Deny native Grep only in opt-in strict mode.
- Hint on native Read for code-understanding reads, but do not fully block Read because edit
  workflows often require a prior Read.
- Keep `--enforce-tools` opt-in because strict enforcement is Claude-specific and opinionated.

---

## Part 5: Optimized Agent Search Policy

**Goal**: Ship a real tool-routing policy, not only replacement rules.

Enforcement answers: "which tools are allowed?"

The optimized search policy answers: "which sweet-search tool should I choose, what query shape
should I use, how many results should I inspect, when should I read, and when should I stop?"

**Cross-model framing**: The body below is the canonical English-language decision tree.
Per-model surface shims (XML wrap, frontmatter, conversational tone) are applied in the harness
files (Section 4A) — not in the canonical policy itself.

### Default Tool-Routing Decision Tree

```markdown
## sweet-search Tool Routing

Use sweet-search for code discovery and code reading. Pick the narrowest tool that can answer the
question.

1. Exact symbol, constant, error code, log string, config key, or literal:
   - Use indexed grep.
   - CLI: `sweet-search grep "<regex>" --agent`
   - Agent wrapper: `ss-grep "<regex>" -k 5`
   - Query shape: short, literal-heavy regex. Escape punctuation. Prefer the rarest identifier.

2. Behavioral or semantic question where a literal exists but intent matters:
   - Use ColGrep / patternSearch: regex candidate pool + semantic re-rank.
   - Agent wrapper: `ss-find "<natural-language question>" --regex "<broad-but-relevant-regex>" -k 5`
   - Query shape: natural-language intent + a broad regex anchor.

3. General conceptual search with no obvious literal:
   - Use `sweet-search "<short intent query>" --agent` in hybrid/auto mode.
   - Query shape: one concise sentence naming the concept and likely domain words.

4. Callers, callees, implementations, impact, inheritance, or dependency questions:
   - Use structural search.
   - CLI: `sweet-search "who calls <symbol>" --mode structural --agent`
   - Query shape: include the exact symbol plus relationship word.

5. Path/name discovery:
   - Use path search once implemented.
   - CLI: `sweet-search files "<glob-or-path-pattern>"`

6. Exact file/range already known:
   - Use exact read.
   - CLI: `sweet-search read <file> --lines <start-end>`
   - Agent wrapper: `ss-read <file> <start> <end>`

7. File is known but relevant span is unclear:
   - Use semantic read once for that file.
   - CLI: `sweet-search read-semantic <file> "<question>" --max-tokens 800`
   - Agent wrapper: `ss-semantic <file> "<question>" --max-tokens 800`
   - Do not call semantic read on multiple files unless the task is explicitly multi-file.
```

### Stopping Rules

```markdown
## Stopping Rules

- Inspect only the top 3-5 discovery results.
- If a discovery result already returns a tight chunk/range that answers the question, cite it and stop.
- If the first discovery call returns nothing, broaden once. If still empty, report no match.
- Do not re-search merely to double-check.
- Do not read broad files after a tight chunk already answers the task.
- Prefer 1-3 high-confidence citations over long citation lists.
```

### CRITICAL: STOP-on-good-results discipline

**Observed failure mode (2026-05-04 agent benchmark):** even when the
sweet-search response carries `sufficient=YES`, a tight top-1 chunk that
literally contains the gold symbol body, a resolved imports header, and
a graph-neighbour tier, agents still keep doing follow-up searches and
narrow reads. Examples from the haiku run on n=5/repo:

- `gin:radix-route-insertion` — sweet did **10 turns** for an answer
  that was complete after turn 1; tokens 8398 vs native 3230.
- `gin:panic-recovery` — sweet did **6 turns** for the same Recovery()
  walkthrough that native solved in 2.
- `ripgrep:locate-line-bounds` — sweet did **6 turns / 9548 tok** for a
  function-bound answer.

Everywhere this happened, sweet-search's first response already
carried a `full`-tier chunk + a header + neighbours + `sufficient=YES`
+ `confidence ∈ {medium, high}`. The agent ignored those signals.

The decision tree MUST teach this explicitly. Suggested wording for
the policy text:

```markdown
## STOP rules — read these before EVERY follow-up call

The sweet-search response trailer carries explicit stop signals.
**Honour them.** A second call costs more tokens than it saves.

Stop after one search and answer immediately when ALL of:
- the response says `sufficient=YES`
- the top-1 result is `presentation=full` with `expansionKind` in
  `{full, sandwich, chunk}` and the gold symbol/file is named
- the response includes a `### related (1-hop graph, ...)` block
  OR a `### imports` block that resolves the body's referenced names
- you can defend the answer by pointing at the visible code

Do NOT call a second time merely because:
- you want to "double-check" the line range
- the first answer was unexpectedly short  → it is short BECAUSE the
  pack is tight, not because evidence is missing
- you noticed a helper function named in the chunk that is also in
  the pack as a `summary` row → its file:line in the rank list
  is sufficient citation; do not read it

Single counter-rule: the question explicitly asks for multi-file
flow ("how does X flow from A to B", "trace from entry to exit",
"all places that ..."). In that case, take ONE follow-up reading
or sub-search to fill the gap, then stop.
```

This stopping discipline is the largest remaining gap between
sweet-search-auto agent runs and frontier-quality output (May-2026).
The packaging is SOTA-class; the agent needs to *trust* it.

### Budget escalation rules

The CLI exposes three budget tiers:

| Mode | Token budget | When to use |
|------|--------------|-------------|
| `ss-search "<q>"` (default) | 4k preview | Lookup tasks: exact symbol, file location, simple function behaviour. Top-1 gets ~60% of budget; ranks 2-3 get preview. |
| `ss-search "<q>" --full`    | 8k full     | Behaviour explanations spanning 2-3 symbols; "how does X work" with cross-references; cases where the agent expects to cite ≥2 files. Top-1 + competitive ranks 2-3 get `full` presentation. |
| `ss-search "<q>" --xl`      | 12k stretch | "Trace through the entire pipeline" / multi-file flow. Gated on top-1 dominance (top-1 score ≥ 2× top-2); falls back to `--full` when the gate fails. |

Decision tree for budget choice (add to the policy):

```markdown
## Choosing the search budget

Default to `ss-search "<q>"` (4k). Switch tiers only when the question
shape demands it:

- Use `--full` (8k) when the question:
  - mentions multiple steps / phases / stages explicitly
  - asks for a "pipeline", "flow", "lifecycle", "dispatch", "sequence"
  - asks "how does X handle ..." where X involves several cooperating
    functions
  - asks "what calls/where is X used" AND you expect ≥2 callers

- Use `--xl` (12k) ONLY when:
  - the question is explicitly multi-file / cross-cutting
  - one strong dominant answer is plausible (the gate will fall back
    to `--full` if not)

NEVER chain searches at increasing budgets. If the default 4k pack
already says `sufficient=YES`, do not "re-run with --full to be sure"
— that just wastes budget.
```

The 4k → 8k jump roughly doubles top-1's room for full presentation
of the symbol AND ranks 2-3 (which get `full` instead of `preview`
when their score is competitive). For typical multi-symbol questions,
`--full` is a better bet than chaining a default search with a
narrow follow-up.

### Citation Rules

```markdown
## Citation Rules

- Every distinct source file that supports the answer must appear as its own citation.
- If the prose names a file, imports from it, relies on a function in it, or cites behavior from it,
  that file must be cited with a line range.
- For multi-file flows, cite one range per required file.
- Do not mention supporting files only in prose or notes.
```

---

## Part 6: Decision-Tree Variant Slate (T1-T14) — Seed Material for GEPA

> **Depends on Part 7.** The query-shape recommendations from §7.6 (`eval/query-shapes/
> recommendations.json`) provide the verbatim `instruction_text` for query phrasing rules
> inside each variant. **Do not write T1-T14 prompt bodies before Part 7 ships its
> recommendations artifact** — that's the user-flagged failure mode where GEPA polishes an
> input grounded in guesses instead of measurements.

### 6.1 Why a variant slate

GEPA mutates a single seed prompt through reflection. If the seed encodes a wrong assumption
about the dominant lever (e.g., "rules over examples"), GEPA will produce more consistent
versions of the wrong strategy. The fix is to seed GEPA with **multiple distinct hypotheses**
and let the Pareto frontier preserve specialists.

Each variant covers all six tools (`sweet-search` auto, indexed `grep`, ColGrep / `ss-find`,
structural mode, `read`, `read-semantic`). The differences are in *how* the model is taught to
choose, *what* it's told to stop on, and *which lever* dominates.

The query-phrasing rules inside each variant come from Part 7's measured `instruction_text`
strings. The variants differ in their *routing logic and stopping discipline*, not in their
query-phrasing instructions — those are constants pulled from §7.6 across all 14 variants.

### 6.2 The 14 variants

| # | Variant | Dominant lever | Hypothesis it tests |
|---|---|---|---|
| **T1** | **Question-shape router** (current Section 5 baseline) | Branch on literal / behavioral / conceptual / relational | Baseline; current production prompt |
| **T2** | **Symbol-presence first** | "Does the question name a symbol?" → grep/structural; else → ColGrep/auto | Routing accuracy when question structure is unambiguous |
| **T3** | **Cost-tiered escalation** | Try cheapest tool first, escalate only on empty/insufficient | Token economy; tests whether escalation rules beat upfront routing |
| **T4** | **Evidence-bound minimalist** | "Top-3 results, then stop unless all 3 lack the answer" | Maximizes precision; tests STOP-on-good-results discipline |
| **T5** | **STOP-rule-first lead** | Open with stopping criteria, then routing | Tests whether ordering changes compliance (Claude responds to lead-with-rules; GPT-5 doesn't care) |
| **T6** | **Reverse funnel** | Start with `read-semantic` on suspected file → fall back to discovery if file unknown | Inverts the "discover then read" default; tests whether agents are over-discovering |
| **T7** | **Two-phase Reason→Act** | Force the model to emit `question_type: …` in one line, then tool call | Cheap chain-of-thought; tests reflection-as-routing vs. plain routing |
| **T8** | **Citation-driven** | "List the citations the answer needs, choose tools to satisfy each" | Works backward from output; tests whether answer-shape determines tool choice better than question-shape |
| **T9** | **Worked-examples-only** | 5-7 short Q→tool→answer transcripts, **no rules at all** | Tests in-context learning vs. instruction-following — Arize SPL evidence says generalizes best across models |
| **T10** | **ASCII flowchart + 1 paragraph** | Visual decision tree as ASCII, prose minimal | Tests format compactness for small-context evaluatees |
| **T11** | **Negative-rule heavy** | Lead with anti-patterns ("don't broad-Read; don't re-search to double-check") | Tests deny-first framing |
| **T12** | **Persona-framed** | "You are a senior reviewer with strict stop discipline. Tools: …" | Tests role-priming; small, but cheap to add |
| **T13** | **Budget-dial first** | "Choose 4k/8k/12k tier, then tool" — surface existing `--full`/`--xl` semantics as routing dimension | Tests whether budget-first routing beats tool-first routing |
| **T14** | **Tool-description-only (no tree)** | Rich, opinionated tool descriptions; let the model infer routing | Anthropic engineering recommendation; cleanest cross-model story |

### 6.3 Spike-test plan

**Phase A — narrow** (start here): T1, T4, T7, T9, T13, T14. Six prompts × **three primary SOTA
evaluatees** (Opus 4.7 + GPT‑5.5 + Gemini 3.1 Pro) × 60 dev probes ≈ **1,080** evaluations.
Target cost: **~$400–900** (frontier token rates; highly prompt-length dependent). Dev **headline**
metric: mean PASS rate ≡ `shipping_score` on that trio. Optional **pre‑registered** shortcut: run
first pass on `{Sonnet 4.6, GPT‑5.5, Gemini 3.1 Pro}` or a 20‑probe stratified subsample × cheap
pool to drop loser variants cheaply — then full 60 probes × trio for survivors only.

**Phase B — held-out foils**: T2, T3, T5, T6, T8, T10, T11, T12. Run only after Phase A picks
2-3 leaders, to test whether GEPA can do better than any individual variant.

**Phase C — GEPA from leaders**: feed the top 2-3 from Phase A as parallel seeds into GEPA
(Section 8). Each seed evolves its own Pareto front; merge survivors at the end.

The retrieval-probes split is the deterministic dev metric; the agent-read-workflows benchmark is
the held-out validation. Use `cAST + IAR + RRF + STOP-rules` ranking (commit ac280d4) as the
fixed retrieval underneath.

### 6.4 Variant ablation analysis (where each T_i wins)

After Phase A produces per-variant scores on the 60-probe dev set, the next step is *not* to
pick a winner — it is to characterize where each variant is strongest and weakest. This
diagnostic phase prevents losing complementary strengths that any single winner would discard.

**Per-instance win/loss/tie matrix**: for each of the 60 probes, record which variants
(a) PASS, (b) PASS with non-trivial margin (token cost ≤ 1.2× median, ≤ 3 tool calls),
(c) FAIL but recoverable, (d) FAIL outright. Build an N×N pairwise matrix W where W[i,j] is
the count of probes on which T_i strictly beat T_j. Track ties separately to avoid false
signals from shared correct answers.

**Per-failure-mode taxonomy** — eight modes to track explicitly:

| Mode | Description |
|---|---|
| `over-search` | agent issued ≥ 2 redundant searches after `sufficient=YES` |
| `premature-stop` | agent stopped before all required citations were collected (multi-file flow) |
| `wrong-tool` | picked grep when ColGrep was needed, or vice versa |
| `broad-Read` | invoked native Read on a whole file when the range was already known |
| `citation-drop` | answer prose names a file but no citation was produced |
| `query-shape-bad` | low-recall regex / overly long NL query / missed obvious symbol anchor |
| `budget-mismatch` | used `--xl` for a single-symbol lookup, or default 4k for an explicit multi-file flow |
| `hallucination` | invented file path / function name not in the response |

For each variant, count incidents per mode across all 60 probes. The result is a 14×8 matrix
that exposes complementary strengths: T1 might dominate `wrong-tool` but lose on `over-search`;
T9 (worked-examples-only) might dominate `query-shape-bad` but lose on `budget-mismatch`.

**Per-stratum strength fingerprints**: stratify probes by (a) language (JS/TS, Go, Rust, Python,
Ruby — the GCSN axes), (b) query type (literal lookup, behavioral, structural, multi-file flow),
(c) repo size (small ≤ 50 files, mid 50-500, large 500+). Compute per-variant performance per
stratum. Variants that excel in a single stratum but lose elsewhere are *specialists* — exactly
what the synthesis step (§6.5) is designed to recover.

**Statistical inference for variant ranking** — fit a generalized Rao-Kupper / Plackett-Luce
model to the pairwise outcomes to produce worth parameters with bootstrap 95% CIs (paired
resampling, 10K iterations, seed=42). Report per-variant ranks AND per-stratum ranks. Variants
whose CIs overlap are statistically indistinguishable globally; differences emerge at stratum
level. Per the IR simulation literature (Sakai et al., 2019), paired permutation tests on the
primary PASS-rate metric are the right default — neither paired t-test nor Wilcoxon are uniformly
better on bounded discrete metrics like PASS rate at n ≈ 60.

**Output artifact**: `eval/prompt-evolution/ablation-report.json` containing

- pairwise win/loss/tie matrix (14×14)
- per-failure-mode tallies (14×8)
- per-stratum performance (14 × strata)
- Plackett-Luce worth parameters with bootstrap 95% CIs
- a short prose summary per variant: "T_i wins on {strata}, fails on {modes}"

### 6.5 Variant synthesis: building the uber-tree

With the ablation map in hand, three combination strategies — ranked by complexity and expected
payoff:

**Strategy A: GEPA system-aware Merge (preferred default).** GEPA's `Merge` operator combines
two Pareto-optimal candidates that share an ancestor and improve along different axes. Seed it
with the top 3-4 variants from §6.4 (those at the Plackett-Luce frontier) plus their pairwise
diff-summaries from the failure-mode matrix. GEPA's reflector reads the tally
("T9 fixes `query-shape-bad` but T13 fixes `budget-mismatch`") and proposes merge candidates
that import the curing language from each. Reported gains in the GEPA paper: +8pp over base
GEPA on multi-stage tasks — treat this as a **prior**, not a guarantee on `agent-read-workflows`;
budget a **light replay** Merge vs non-Merge on our probe split before leaning on Merge for heavy
campaign spend (§8.9.8). This is the cheapest synthesis path because it reuses the same
DSv4-Pro reflector loop already running for §8.

**Strategy B: Mixture-of-Prompt-Experts (MoPE) gating.** Treat each surviving variant as an
expert and learn a lightweight gating function over the question embedding (CodeRankEmbed for
free, since it's already in the index). The gate routes each query to the variant likely to
handle it best, or weights a soft combination. Costs extra latency per query (one embedding
lookup + one extra LLM call per dispatch) but produces a product whose worst-case behavior is
the *best* of the experts, not the *average*. Use only if Strategy A plateaus and if production
latency budget allows the extra call.

**Strategy C: Prompt soup + distillation.** If multiple synthesized candidates from Strategy A
survive on the Pareto frontier with truly complementary strengths, combine them via DiVeRSe-style
majority vote at evaluation time, then *distill* the resulting ensemble into a single short
prompt using TreePrompt-style rule extraction or context-distillation (few-shot exemplar
compression). Output is a single canonical AGENTS.md that captures the ensemble's behavior at
single-call cost.

**Recommended order**: A → (if needed) C → (only as last resort) B. MoPE adds production
complexity; distillation produces a cleaner ship artifact.

**Anti-pattern to avoid**: do not naively concatenate the strongest sentences from each variant
("paste 14 STOP rules into one prompt"). The PromptBench / Anthropic engineering literature
consistently shows over-specified prompts trigger over-literalism — especially in GPT-5 — and
degrade performance. Synthesis must remove redundancy, not stack rules.

**Output artifact**: `eval/prompt-evolution/synthesis-runs/T_uber_v{N}.md` — versioned uber-tree
candidates, each with a manifest listing source variants and the failure modes they target.

### 6.6 Validation gates for the synthesized uber-tree

A synthesized uber-tree is only promotable if it satisfies all of the following on the held-out
40-probe split (Phase A used the 60-probe dev set; the 40-probe split is reserved strictly for
these gates and must never be inspected per-query during tuning, per CLAUDE.md held-out
discipline):

| Gate | Criterion |
|---|---|
| **G1: Pareto dominance** | Beats the best individual T_i on at least 2 of {PASS rate, file recall, citation precision, token cost} — and ties or wins on all four |
| **G2: No new failure modes** | Per-failure-mode incident counts are ≤ the *minimum* across source variants for every mode (the synthesized tree must inherit each variant's strength, not create new bugs) |
| **G3: Statistical** | Paired permutation test (10K iterations, seed=42) p < 0.05 on PASS rate vs the strongest individual T_i, with bootstrap 95% CI on the delta not crossing zero |
| **G4: Cross-model robustness** | Pareto dominance holds on **`shipping_score`** (mean answerability across Opus 4.7 + GPT‑5.5 + Gemini 3.1 Pro per §8.5). **Additionally**: median answerability across the **auxiliary four‑model pool** must not regress **>3pp** vs the current shipped baseline. **Publishing requirement** (not optional): paired portability stats in every promotion dossier — `aux_median`, `aux_p25`, raw `aux_min`, and **`aux_min_four`** (= min across the four auxiliary models on the same probes). Optionally add **stratified mins** by evaluator archetype (MoE vs dense vs long-ctx). Use **`aux_min_four` only as a soft tripwire** unless pre‑registered as a hard gate: one pathological evaluator can dominate `min()`; pre‑register evaluator **drop-from-min rules** only with documented instruction-compliance failures (§8.9.1). |
| **G5: Cross-harness sanity** | Inside Claude Code (**Opus 4.7** — Sonnet 4.6 acceptable only for reproducing subscription defaults) and Codex (**GPT-5.5**), the uber-tree does not regress more than 3pp on PASS rate vs each harness's native baseline. Single-pass, no retries. Primary cross-check is still `shipping_score` on the bare-API trio before shims. |

If any gate fails, the synthesis result is logged to `eval/prompt-evolution/rejected/` with the
failing-gate diagnostics, and Strategy A is re-run with the rejection feedback fed to the GEPA
reflector. Do not re-tune the synthesized tree against the 40-probe set; that constitutes
test-set leakage. Rejection forces a return to Phase A or a re-pull from §6.4 ablation map.

---

## Part 7: Query-Shape Discovery (FOUNDATIONAL — execute before Part 6)

**Goal**: Discover, for each sweet-search tool with a semantic query component, the
agent-instructable query shape that maximizes retrieval quality and downstream task success.

**Why this is foundational and must precede Part 6**: T1-T14 prompt bodies dictate query shape
("phrase as a short keyword query", "include the symbol if known", "use a broad regex anchor").
If those instructions are wrong, GEPA polishes a flawed input. The variant slate (Part 6)
*must* be informed by measured query-shape recommendations, not by guesses about how
developers ask questions.

**Critical framing**: we do NOT care how human developers naturally phrase queries
(Discord-style, GitHub-issue-style, conversational). We care how *agents* should be
*instructed to* phrase queries to extract maximum value from sweet-search. The shape grid is
therefore composed entirely of dimensions an agent prompt can dictate.

### 7.1 Tools in scope

Only tools whose query has a semantic / natural-language component are swept. Tools whose
query is purely literal or structural don't have a shape to optimize:

| Tool | Semantic component | In scope? |
|---|---|---|
| `sweet-search` auto/hybrid | natural-language query | yes |
| `ss-find` (ColGrep) | NL query + regex anchor (two axes) | yes |
| `ss-semantic` (read-semantic) | NL question scoped to one file | yes |
| structural mode | NL query + relationship word | yes |
| `ss-grep` (indexed grep) | literal regex only | no — sweep regex *specificity*, not shape |
| `ss-read` (exact range) | no query, just file/range | no |
| `files` (path discovery) | glob pattern, not semantic | no |

For `ss-grep` we still measure regex-specificity (rare-token anchoring vs common-token,
single-literal vs alternation) as a side analysis, but it isn't a shape discovery — it's a
regex-engineering finding.

### 7.2 Agent-instructable shape grid

The shape dimensions are exactly what a system-prompt rule can force. A factorial design at
full coverage is too large; we test the orthogonal grid below and report main effects per
tool:

| Dimension | Levels |
|---|---|
| **Length tier** | very-short (≤3 tokens), short (4-8), medium (9-15), long-NL (16+) |
| **Symbol presence** | with-symbol (gold or near-gold identifier in query), without-symbol |
| **Intent verb** | present ("how does X work", "find", "where is X defined"), absent (noun phrase) |
| **Q framing** | declarative noun-phrase, interrogative ("how/where/what"), imperative ("find/show/trace") |
| **Domain-term density** | high (multiple domain-specific identifiers), low (generic terms) |
| **Regex anchor breadth** (ColGrep only) | narrow (1 literal), medium (2-3 alternation), broad (5+ alternation) |

Per gold, we author **K = 5-7 shape variants** spanning the grid (not all 4 × 2 × 2 × 3 × 2 ×
3 = 288 cells; we sample to achieve orthogonality on main effects). Each variant is labeled
with its shape coordinates and the tool it's intended for.

### 7.3 Novel probe-set construction (across all bench repos)

The existing 60-probe and 100-probe sets in `eval/retrieval-probes/` are regression canaries
with one phrasing per gold — not fit for shape discovery. We build a fresh set:

| Set | Repos | Goldsize | Shape variants per gold | Total query-tool pairs |
|---|---|---|---|---|
| **Q-shape dev** | fastify, gin, ripgrep, flask | 12 per repo × 4 = 48 | 6 | ~864 (across 3 tools) |
| **Q-shape held-out** | uv (post-2026-01 commits, FreshStack discipline) | 30 | 6 | ~540 |

Total ≈ 1,400 query-tool pairs. Manageable on a $20-40 deterministic-track budget at
DSv4-Flash rates; agent-in-loop track is a smaller subsample (§7.5).

**Construction discipline (BEIR-grade)**:
- Hand-authored gold tasks (file + symbol + facts + line range) per the existing
  `eval/agent-read-workflows/tasks.js` schema.
- **Tool-affinity prediction written down BEFORE the sweep**: each gold gets a hypothesized
  winning tool ("this should be best handled by `ss-find` with a symbol-present query"). The
  pre-registered prediction is the dev-only error analysis input; we measure where our
  intuition was wrong, not which intuition to confirm.
- **Variants authored by a different person from the gold-task author** when feasible, to
  avoid leaking gold-knowledge into the variant phrasing.
- **Stratification**: each repo's 12 gold tasks span literal-lookup, behavioral, structural,
  and multi-file-flow query types in a 3:3:3:3 split.

### 7.4 Track A: deterministic per-tool sweep (fast, cheap)

For each (gold × shape variant × tool) tuple:

1. Run the tool with the variant's query (and regex anchor if ColGrep).
2. Record: top-1 / top-3 / top-5 file recall, symbol recall, gold-line overlap (where
   line ranges are gold), returned-token count, latency.
3. Simulate a 1-step follow-up (deterministic): if top-1 misses, does top-3 contain it? Does
   the agent need a follow-up read?
4. Aggregate per tool × per shape category.

Output (one JSON file per tool):

```json
{
  "tool": "ss-find",
  "n_golds": 78,
  "n_variants": 6,
  "n_runs": 1404,
  "metrics_per_shape": {
    "short+with-symbol+narrow-regex": {
      "file_recall@1": {"mean": 0.82, "std": 0.11, "ci95": [0.79, 0.85]},
      "symbol_recall@1": {"mean": 0.74, ...},
      "follow_up_reads": {"mean": 0.21, ...},
      "tokens_returned": {"mean": 1840, ...}
    },
    "long-NL+without-symbol+broad-regex": { ... },
    ...
  },
  "best_shapes": [...],
  "worst_shapes": [...],
  "interaction_effects": {
    "symbol-presence × length": "with-symbol+short beats without-symbol+long by 18pp on file_recall@1"
  }
}
```

Cost: trivial (deterministic, no LLM). Latency dominated by index lookup.

### 7.5 Track B: agent-in-loop sweep with LLM-as-judge

Track A measures retrieval quality in isolation. **Track B measures whether an agent
constrained to a given shape actually solves the gold task end-to-end.** This catches
interaction effects between shape and downstream agent reasoning that Track A is blind to:
e.g., a shape that yields strong top-1 but a presentation the agent can't reason about, or a
shape that yields weaker top-1 but is trivially recoverable with one follow-up.

**Methodology**:
1. Subsample Track A to 18-24 golds (3-4 per repo, stratified by query type) — enough for IAA
   discipline without burning a thousand-dollar bill.
2. For each (gold × shape variant × tool):
   - Spawn Claude Code with a system prompt that **forces the shape** ("you MUST phrase your sweet-search query as a short keyword form with no NL verbs") and only allows the one tool under test.
   - **Default model for breadth**: Sonnet 4.6 (~cost as written below). Pre-register an **Opus 4.7 replay** on a subsample of the top shapes before freezing §7.6 (`recommendations.json`) so agent end-to-end results are not calibrated only on a cheaper Claude slot while §8.5 optimizes Opus‑class deployments.
   - Run end-to-end. Capture the trace, the answer, and the deterministic recall metrics.
3. Run **PRP-style two-judge LLM-as-judge** (DSv4-Pro + Sonnet 4.6) per the §11.6 protocol on
   each (gold, shape) pair: did the agent solve it? Failure mode if not?
4. Validate judges against ≥ 30-probe human-labeled subset; require Krippendorff's α ≥ 0.6.

**Output**: per-tool × per-shape end-to-end success rate, with the deterministic recall
findings as a confounder check ("shape X has high recall but the agent fails 30% of the time
— the issue is presentation, not retrieval").

**Cost**: ~$80-150 per full sweep (agent runs at ~$0.30 each via Sonnet 4.6, plus judge calls
at DSv4-Pro promo rates).

### 7.6 Promotion artifact: per-tool query-shape recommendations

The combined Track A + Track B output is a single machine-readable artifact:
`eval/query-shapes/recommendations.json`. Schema:

```json
{
  "version": "1.0",
  "generated_at": "2026-05-XX",
  "tool": "ss-find",
  "best_shapes": [
    {
      "shape": "short+with-symbol+narrow-regex",
      "deterministic_recall@1": 0.82,
      "agent_e2e_success": 0.89,
      "n_dev": 78,
      "n_e2e": 22,
      "judge_iaa_alpha": 0.71,
      "instruction_text": "Use a 4-8 token natural-language query that includes the symbol if known, plus a single-literal regex anchor."
    }
  ],
  "avoid_shapes": [
    {
      "shape": "very-short+without-symbol+broad-regex",
      "deterministic_recall@1": 0.31,
      "agent_e2e_success": 0.42,
      "instruction_text": "Do NOT use a ≤3 token noun-phrase query without a symbol or with a broad-alternation regex."
    }
  ],
  "main_effects": {
    "symbol-presence": "+18pp on recall@1",
    "regex-narrowness": "+9pp on recall@1",
    "length": "U-shaped: short and medium tied; very-short and long-NL both degrade"
  },
  "interaction_effects": [...],
  "preregistration_diff": {
    "predicted_winner": "long-NL+with-symbol+broad-regex",
    "actual_winner": "short+with-symbol+narrow-regex",
    "lesson": "broad regex floods candidate pool with noise that ColGrep re-rank can't recover from"
  }
}
```

The `instruction_text` fields go *verbatim* into the T1-T14 variant bodies in Part 6. No more
guessing what to put in the prompt — it's measured.

### 7.7 Pre-registration for Part 7

Before any sweep run:
1. Commit the gold task list and shape variants (`eval/query-shapes/golds.json`,
   `eval/query-shapes/variants.json`).
2. Commit `eval/query-shapes/preregistration.md` with: tool affinities, predicted winners per
   shape category, statistical test plan, IAA threshold, sample size justification.
3. Tag the commit (`git tag prereg/qshape-{run-id}`).
4. Any deviation from the pre-registered plan after the run starts is exploratory and labeled
   as such in the recommendations artifact.

This is the single most important pre-registration in the whole campaign. Part 7's findings
seed every subsequent step (Part 6, 8, 10) — getting the analysis honest here is what makes
the rest defensible.

### 7.8 DSPy as a downstream tool (not a substitute for shape discovery)

DSPy MIPROv2 / BootstrapFewShot can learn instruction text for query-generators *given* the
shape findings, but they cannot substitute for the shape discovery itself. DSPy's optimizer
proposes instruction variants and few-shot exemplars — it doesn't propose orthogonal shape
dimensions. Part 7's structured grid + measured outputs feed DSPy as a downstream refinement
in Part 8. Per the GEPA paper, sample efficiency from a strong seed is materially higher than
from cold-started search; Part 7 provides that seed.

---

## Part 8: GEPA Prompt Evolution Over Agent Traces

**Goal**: Evolve the sweet-search policy text until it consistently improves agent behavior over
native Claude Code workflows on **frontier deployments** (shipping score on Opus‑class + GPT‑5.5 +
Gemini‑class), while auxiliary cheap models provide portability sentinels — not the headline metric.

DSPy remains useful for structured metrics and evaluation programs, but the primary object we need
to optimize is textual: the tool-routing policy, examples, tool descriptions, query-shape guidance,
and stop criteria. GEPA is a better fit for that layer because it can read full execution traces and
mutate text artifacts based on concrete failures.

### 8.1 Candidate Artifact

Treat the following as a versioned candidate:

- `AGENTS.md` (canonical) — the full sweet-search routing policy
- `CLAUDE.md` / `GEMINI.md` / `.cursor/rules/sweet-search.mdc` shims (per-model surface adjustments)
- `UserPromptSubmit` reminder text
- MCP tool descriptions
- agent wrapper help text (`ss-grep`, `ss-find`, `ss-read`, `ss-semantic`)
- query-shape examples for each tool

### 8.2 Evaluator

Use the agent-in-the-loop benchmark (`eval/agent-read-workflows/`) as the primary evaluator:

- real pinned repos
- native `rg + Read` baseline
- sweet-search-only policy with audited tool usage
- deterministic metrics: file recall, symbol recall, fact recall, evidence success, precision,
  answerability, policy violations
- cost metrics: tool-output tokens, Claude usage tokens, tool calls
- optional blind judge for qualitative preference

The retrieval-only benchmark (`eval/read-workflows/`) remains a regression suite for tool mechanics
and query-shape experiments, but it is not sufficient for final prompt promotion.

### 8.3 Objective

Optimize a Pareto frontier rather than a single scalar. A policy is promotable only if it satisfies:

1. zero policy violations on the validation split
2. equal-or-better answerability than the current shipped policy
3. no regression on no-match tasks
4. no regression on multi-file citation tasks
5. equal-or-better evidence success / file precision
6. lower or equal tool-output tokens at comparable quality
7. no large increase in tool-call count

Latency should be tracked but not used as the main objective during local runs, because LI/model
contention and cold-start effects can dominate measurements.

### 8.4 GEPA Loop

1. Seed with the hand-written benchmark-derived policy plus query-shape findings.
2. Run a small training split of agent tasks.
3. Feed GEPA the full traces: prompts, tool calls, tool outputs, final answers, audit violations,
   deterministic scores, and judge comments.
4. Ask GEPA to mutate the policy text, examples, and stop rules.
5. Re-run candidates on the training split.
6. Keep Pareto-efficient candidates.
7. Validate on held-out repos/tasks.
8. Promote only if the policy beats the current shipped policy under the criteria above.

### 8.5 SOTA-primary + auxiliary pool strategy (headline metric matches real users)

The single most important architectural decision for GEPA in May 2026: **optimize what ships**.
Most agent runs use frontier models; the headline metric must be defined on that pool. Cheap
models remain as **auxiliary** diversity sensors and **optional** budget relief — not as the
scalar GEPA maximizes.

```text
Reflector LM     : DeepSeek V4-Pro promo ($0.435/$0.87) until May 31
                   → fall back to MiniMax M2.5 ($0.15/$1.15) after
Primary pool     : Claude Opus 4.7 + GPT-5.5 + Gemini 3.1 Pro (parallel)
shipping_score   : mean(answerability) across the primary pool
                   — this is the GEPA optimization target and the reported headline number
Auxiliary pool   : DSv4-Flash + MiniMax M2.7 + Kimi K2.5 + Qwen 3.6 Plus (+ optional slots for
                   instructional-diversity recruits — refusal/tool-JSON/verbosity outliers)
portability      : publish median, p25, raw min, min_four (see §8.9.1); median gates G4; min is diagnostic / soft tripwire unless preregistered hard gate
reflection_minibatch_size : 3   (GEPA paper default)
Train/val split  : 60/40 stratified, seed=42 (matches existing FreshStack/GCSN discipline)
Budget tier      : frontier-led (expect higher $ than cheap-pool-only campaigns)
Held-out check   : per milestone, full trio + Codex GPT-5.5 wire + cross-harness (§9.3)
Optional triage : pre-register Sonnet 4.6 as Claude-slot substitute OR cheap-pool prefilters
Stop rule        : promote only if Pareto-better on shipping_score AND no regression on held-out
                   AND auxiliary median within the G4 portability band vs shipped baseline
```

**Why mean on the primary pool (not min across cheap models)**: the product goal is excellence on
Opus‑class / GPT‑5.5‑class / Gemini‑class deployments. Optimizing `min()` over cheap evaluatees
over‑weights intersections nobody ships and can veto prompts that cleanly win where it matters.

**Why keep the auxiliary four-pack**: architectural diversity **plus** deliberate **instructional**
diversity (refusal posture, verbosity, tool-call JSON discipline, deny-first vs permissive scopes)
still catches brittle routing. Models can share helpful-assistant scaffolding yet diverge sharply
on **constraint adherence** — pick auxiliary slots partly for that spread, not only parameter/MoE
shape (§8.9.2). Those signals feed **gates and diagnostics**, not the headline scalar — echoing
the “portability lab vs shipping score” split.

**Why these four auxiliary evaluatees specifically** (baseline line-up; revise if a recruit clears
instructional-gap criteria in §8.9.2):

- **DeepSeek V4-Flash**: cheapest, fastest, MIT, dense+sparse — high-volume smoke tests.
- **MiniMax M2.7**: 10B-active MoE, agent-tuned — different failure surface than dense frontier.
- **Kimi K2.5**: large MoE, agent-swarm tuning — catches long-context / routing oddities.
- **Qwen 3.6 Plus**: long context, easy OR access — catches small-habit overfitting when paired
  with short-prompt runs.

### 8.6 Cost projections

All numbers are **order-of-magnitude** for frontier‑led evaluatees; track realized $/probe from the
first 20 runs and revise. Maintain a parallel **cache-off bracket** row (assume **no**
provider prompt-cache credit) alongside logged blended tokens — prefixes move when GEPA rewrites
prose (§8.9.3). The reflector stays on DSv4‑Pro promo / MiniMax M2.5; **evaluatee**
cost now tracks Opus + GPT‑5.5 + Gemini.

| Phase | Rough cost | What |
|---|---|---|
| Phase A spike (T1, T4, T7, T9, T13, T14 baseline) | **~$400–900** (cache-off **~+$200–600**) | 6 prompts × **3 primary SOTA** × 60 probes (see optional triage in §6.3) |
| Light GEPA from each leader (~400 metric calls, primary pool) | **~$80–200 each** | Fast iteration; still Opus‑class / GPT‑5.5 / Gemini |
| Medium GEPA on top 2 leaders (~800 metric calls) | **~$200–500 each** | Production-quality policy search |
| Heavy GEPA on the winner (~1,600 metric calls) | **~$400–1,000** | Final shipping policy candidate |
| Auxiliary portability replays (subsampled) | **~$30–80** | e.g. top‑2 leaders × 20 probes × 4 cheap models |
| Per-milestone cross-harness validation | **~$150–400** | Opus + GPT‑5.5 + Gemini + Codex wire on held-out |
| **Full campaign budget** | **~$900–2,500** (see cache-off additive above) | End-to-end, multiple iterations, pre-registered triage |

Compare to GRPO-style RL approaches (~$300-500 per task per attempt with 24K rollouts) or naive
all‑frontier reflection without a cheap reflector (often **multiple times** the above). The
DeepSeek V4-Pro promo reflector still anchors affordability; **June 1** DSv4‑Pro price step‑up
re‑estimates both reflector and any DSv4 auxiliary replays.

### 8.7 DSPy MIPROv2 as a baseline

Run DSPy MIPROv2 on the same task set as a non-evolutionary baseline before promoting GEPA
results. MIPROv2 settings:

- `num_candidates=10` (default, controls instruction diversity)
- `num_trials=20-30`
- `minibatch_size=25-50` depending on evaluatee cost
- `auto="light"` for fast iteration

GEPA paper reports +11.1pp over MIPROv2 on GPT-4.1 Mini and +10.3pp on Qwen3 8B; we should
verify this margin holds on our task distribution before committing budget to the full GEPA
campaign. If MIPROv2 closes the gap, prefer it (simpler, better-supported tooling).

### 8.8 DSPy Role After Adding GEPA

DSPy should not be the only prompt optimization mechanism. Its role is:

- define structured task signatures and metrics
- provide adapters around the Claude CLI / agent benchmark
- run deterministic evaluation and candidate comparison
- optionally host `dspy.GEPA` or other optimizers
- export final artifacts into JS/Markdown files consumed by `sweet-search init`

GEPA's role is:

- reflective mutation of the policy text
- learning from trace-level failures
- discovering better query instructions, examples, and stopping rules

### 8.9 Evaluation risks & mitigations (optimizer traps)

These mitigations complement **`shipping_score`**: they prevent silent failure modes — pessimistic
`min()` domination, wrong diversity, hallucinated budgets, shim-only transfer gaps, and harness
holes.

#### 8.9.1 Paired portability objectives (don’t let one bad evaluator own `min`)

`min(answerability)` over an auxiliary panel is logically correct **intersection portability** but
often **misaligned with “best product deployment”**: a single systematically weak model, or one
that **violates tool JSON / parses instructions oddly**, can dominate `min()` with failures that no
human-sized frontier deployment would hit.

**Required in every promotion dossier**:

- **`shipping_score`** (§8.5 primary trio)
- **`aux_median`**, **`aux_p25`**, raw **`aux_min`**, **`aux_min_four`** on the **same probes**
  (same definitions as deterministic answerability).

**Recommended paired views**:

- **`aux_min_stratum`**: stratified mins by evaluator archetype (e.g., dense‑sparse vs 10B‑MoE vs
  long‑ctx) — surfaces *which lineage* collapses instead of blaming “the pool”.
- **`aux_p25`** (or **`aux_min_trimmed`** / Winsor estimators **pre‑registered** per run): robustifies reporting
  when one tail misbehaves.

**Hard veto on `aux_min_four` only if pre‑registered** with an explicit exclusion protocol (e.g.
drop evaluator *E* from portable-min iff two independent signals: ≥K instruction-format/tool-parse
failures logged as **`proposal-class: external-evaluator-compliance`** AND no repro on frontier
replay for the same probes). Never post-hoc remove the worst auxiliary model to salvage a headline.

#### 8.9.2 Instructional diversity ≠ parameter/MoE shape

Auxiliary recruits should deliberately differ on **constraint adherence** dimensions:

- tool-call validity (JSON/function schema discipline)
- verbosity vs truncation under tight output caps
- refusal / abstain rate on ambiguous probes
- “single-shot must follow numbering” vs best-effort paraphrase compliance

Maintain a living **instructional-gap checklist** when rotating models into the auxiliary pool;
“different parameter count” is insufficient justification.

#### 8.9.3 Cache economics are empirical — log blended \$/tok

From week one of each campaign fork:

1. Emit **`blended_usd_per_eval`** per evaluatee × provider from billed usage APIs (evaluatee +
   reflector).
2. Track **cache-hit rate** separately when the provider exposes it; otherwise infer crudely from
   input-token tiers if documented.
3. Always carry a **cache-off bracket** alongside nominal projections (§8.6): assume full list
   price on all input tokens. If real cache is low (GEPA churn, shim edits, attribution headers),
   actual spend converges toward the bracket, not optimistic cache math.

#### 8.9.4 Reflector–evaluatee capability gap (“proposal-class mirage”)

A strong reflector can propose edits that cheap or misaligned evaluatees **cannot enact** — e.g.
multi-hop plans requiring long context, nuanced STOP behavior, or tool grammars those models mishandle.

**Mitigation**:

- Extend trace JSONL tagging (alongside §13.6 failure modes) with **`proposal_class`** buckets:
  `multi_hop_exploration`, `long_context_summarization`, `strict_json_tool`, etc.
- If the reflector’s patch predicts behavior that **never appears** in cheap traces but frontier
  traces satisfy it, classify as benign; conversely spikes in **`proposal-class: unreachable`**
  on auxiliary-only runs indicate **capacity mismatch**, not retrieval quality problems — route
  feedback accordingly and consider swapping auxiliary recruits per §8.9.2.

#### 8.9.5 Cursor Composer — thin smoke on final candidates

Composer still lacks custom endpoints (§3.2). Nonetheless many users perceive sweet-search inside
**Cursor agent** flows — skipping Composer entirely creates a reputational/regression blind spot.

After **uber-tree finalist(s)** clear §9.3: run **`P11‑cursor‑smoke`** — small stratified subset
(~8–15 probes), default subscription model, Composer only, pinned Cursor build in `manifest.json`,
no API key gymnastics. Outcome logged as **`composer_smoke_pass_rate`** separately from headline
scores; regressions trigger **manual `.mdc` shim** review — not necessarily a block on promoting
bare-API + Claude/Codex/OpenCode parity.

#### 8.9.6 PromptBridge‑style escalation (optional)

If shim-tuning + validators still show **large, noisy frontier↔canonical transfer gaps**, reserve a
budget line (**PromptBridge-lite**): a **small anchored calibration suite** (~5–15 tasks)
mapping canonical wording → Claude / GPT / Gemini surfaces with measured deltas, analogous in
spirit to cross-model prompt transfer work (arxiv 2512.01420). **Do not** start here — only if
gates G4/G5 fail for “looks good bare-API but shims thrash.”

#### 8.9.7 Codex `AGENTS.md` chain size invariant

Promotion checks assert merged canon + imports stay **below** Codex `project_doc_max_bytes` (32 KiB
default). Automate this in runner/CI so **we never silently ship an optimized tree that Codex truncates**.

#### 8.9.8 GEPA Merge gains are task‑specific + judge noise hygiene

Treat paper-scale Merge lifts as hypotheses until replicated on pinned `agent-read-workflows`
splits.

For §7 Track B and any LLM-judge-heavy gate: tighten rubrics when inter-judge dispersion exceeds
threshold; uphold §11.6 Krippendorff α protocol — **high judge disagreement is a metric validity
failure**, not a prompt win.

---

## Part 9: Two-Phase Training / Validation

### 9.1 Why bare-API training, in-harness validation

Each harness ships its own large pre-baked system prompt (Section 3.1). If you tune your decision
tree by running it inside Claude Code, your prompt gets *concatenated* with Claude Code's 5-15K
tokens of XML-tagged tool definitions and behavior rules. GEPA's reflector then sees both your
tree and Claude Code's framing — and may mutate to compensate for Claude Code's quirks rather
than improve your tree.

GEPA also needs hundreds to thousands of evaluatee calls per generation. Wrapping every call in
a 5-15K-token harness prompt 10x's the per-call cost.

**Therefore: train bare, validate in-harness.**

### 9.2 Phase 1 — bare-API GEPA training

```text
Setup:
  - Direct API calls to each evaluatee (no harness, no wrapper)
  - System prompt = your decision-tree variant + sweet-search tool schema only
  - Tools = sweet-search CLI commands (executed via shell/subprocess)
  - Reflector = DeepSeek V4-Pro promo
  - Primary evaluatees = Opus 4.7 + GPT-5.5 + Gemini 3.1 Pro
  - Headline metric = shipping_score = mean(answerability | primary pool)
  - Auxiliary = 4 cheap models (periodic subsampled replays for median portability — not the scalar max)

Why bare:
  - Isolates the variable being tuned
  - Avoids 5-15K-token harness prompt per call on top of frontier evaluatee cost
  - Deterministic (no harness-version drift)
  - Cross-harness portable (no harness-specific surface artifacts)

Cost: ~$800-2,000+ per full campaign (frontier evaluatee-led; see §8.6)
```

### 9.3 Phase 2 — cross-harness validation

```text
Trigger: at every promotion gate (winner of GEPA Phase 1)

Setup:
  - Run the tuned canonical AGENTS.md inside each harness
  - Apply per-model surface shim (Section 4A)
  - Use a FRESH held-out task set (never seen during training)

Harnesses & evaluatees:
  - Claude Code + **Opus 4.7** (native, primary user profile) — priced higher than Sonnet-only
  - Claude Code + DeepSeek V4-Pro (Anthropic-compat) — optional regression repro, not headline
  - Codex CLI + GPT-5.5 (native)                  — headline OpenAI-shaped surface
  - OpenCode + Gemini 3.1 Pro                      — headline Google-shaped surface
  - OpenCode + Kimi K2.5 / GLM 5.1                 — optional secondary, not headline
  - Cursor Composer: **SKIP** for primary headline parity (still no reliable custom-agent endpoint).
    Run **§8.9.5 `P11‑cursor‑smoke`** separately on finalist(s).

Promotion criteria:
  - **shipping_score** (mean across Opus + GPT‑5.5 + Gemini on bare API or equivalent harness runs)
    must beat current shipped policy with the §6.6 / §11 statistical battery
  - Cross-harness: no regression >5pp file/fact recall on any of the three headline harness×model lines
  - Auxiliary median (§8.5) stays within the G4 band
  - Tool-call count stays within 1.2× of baseline

Cost: ~$150-400 per promotion gate, run 2-4× per campaign
```

This is also the dataset that produces the **per-harness shim** content. If `Claude Code +
Opus 4.7` regresses but bare-API GPT‑5.5 is fine, that's a Claude-specific compliance / XML-shim
issue → tweak `CLAUDE.md` shim, not the canonical `AGENTS.md`.

---

## Part 10: Init Integration

All system-prompt optimization output integrates into `scripts/init.js` after the existing runtime
setup and index-maintainer hook installation.

Updated init flow:

```text
1.  Check Node.js version                           (existing)
2.  Detect project root                              (existing)
3.  Create .sweet-search/ directory                  (existing)
4.  Resolve profile                                  (existing)
5.  Verify runtime assets                            (existing)
6.  Check native status                              (existing)
7.  Download models                                  (existing)
8.  Write config                                     (existing)
9.  Run verification                                 (existing)
10. Install index-maintainer daemon hook              (existing)
11. Write canonical AGENTS.md (sweet-search block)    (NEW)
12. Write/update CLAUDE.md with @import of AGENTS.md  (NEW)
13. Write/update GEMINI.md with @import of AGENTS.md  (NEW)
14. Write .cursor/rules/sweet-search.mdc              (NEW)
15. Write .claude/rules/sweet-search.md (Claude-specific lazy-loaded shim)  (NEW)
16. Install UserPromptSubmit reminder hook            (NEW, default-on)
17. Install tool-enforcement settings/hooks           (NEW, only with --enforce-tools)
18. Print report                                      (existing, updated)
```

**Symlink-vs-copy decision** (per harness):

| Harness | File | Strategy |
|---|---|---|
| Codex / OpenCode | `AGENTS.md` | Direct file (canonical) |
| Claude Code | `CLAUDE.md` | Either symlink to `AGENTS.md` (when no Claude shim needed) OR thin file with `@AGENTS.md` import + Claude-specific block |
| Gemini CLI | `GEMINI.md` | Symlink to `AGENTS.md` (no per-tool surface tweaks needed) |
| Cursor | `.cursor/rules/sweet-search.mdc` | Direct file with frontmatter (`description`, `alwaysApply: false`, `filePattern: "**/*"`) — no symlink because Cursor needs frontmatter |

Init flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--enforce-tools` | `false` | Install Claude-specific deny/settings enforcement for native Grep plus Read hints |
| `--no-agent-instructions` | `false` | Skip ALL instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/sweet-search.mdc`, `.claude/rules/sweet-search.md`) |
| `--no-prompt-reminders` | `false` | Skip the `UserPromptSubmit` sweet-search reminder hook |
| `--symlink-instruction-files` | `true` | Use symlinks for `CLAUDE.md`/`GEMINI.md` → `AGENTS.md` when no per-tool tweaks needed (saves disk + keeps in sync) |
| `--harnesses` | `"all"` | Comma-separated subset: `claude,codex,opencode,gemini,cursor`. Default writes all five files. |

---

## Part 11: Benchmark Rigor (BEIR/CoIR Researcher-Level Standards)

The decision-tree campaign only produces credible numbers if the underlying benchmark holds to
gold-standard IR/code-search practice. This section codifies the discipline so any result we
publish can be defended at IR / NLP / SE-conference scrutiny. The references are BEIR, CoIR,
SWE-Rebench, FreshStack, BIRCO, RAGBench, RepoBench, SWE-Lancer, LiveCodeBench.

### 11.1 Dataset construction & decontamination

- **Pinned snapshots**: each repo in the test set is pinned to a specific commit SHA;
  `eval/prompt-evolution/manifest.json` records SHA, source URL, license, and creation date.
  Any result that cannot point at a pinned manifest is dev-only and labeled as such.
- **Layered contamination detection** (per the BEIR/SWE-Rebench/LiveCodeBench playbook —
  combining cheap and exhaustive methods catches both surface and paraphrase contamination):
  1. Exact n-gram match (50-character window) against publicly known pretraining corpora where
     dumps are available (Pile, RefinedWeb, RedPajama).
  2. Embedding similarity (CodeRankEmbed embeddings, threshold 0.92) against the same dumps for
     paraphrase detection.
  3. LLM-decontaminator pass: ask DSv4-Flash to flag suspicious overlap between probe gold
     answers and commonly memorized snippets.
- **Removed-items list**: any probe flagged by ≥ 1 of the three layers is moved to
  `eval/prompt-evolution/contaminated/` and excluded from headline numbers; report
  pre/post-decontamination scores side-by-side per the MBPP/HumanEval study's recommendation.

### 11.2 Splits: stratified + time-aware + fresh-holdout

- **Primary 60/40 dev/heldout split** of the 100-probe set, stratified by language
  (JS, TS, Go, Rust, Python, Ruby), query type (literal/behavioral/structural/multi-file), and
  repo size (small ≤ 50 files, mid 50-500, large 500+). Seed=42, deterministic, with the
  splitting script committed.
- **FreshStack-style post-cutoff fresh-repo holdout** (~30 probes): hand-craft probes on fresh
  public repos created *after* the most-recent evaluatee's training cutoff (e.g.,
  `astral-sh/uv` post-2026-01 commits, `denoland/deno` 2.x post-2026-03). These are the most
  credible numbers because no model could have seen the code. Per project-CLAUDE.md discipline,
  these are *only* used for milestone validation, never for tuning.
- **Time-aware annotation**: every probe carries a `created_at` timestamp; every evaluatee
  carries a `training_cutoff` field; the harness flags any probe×evaluatee pair where potential
  contamination exists and excludes flagged pairs from headline metrics.

### 11.3 Sample sizes & statistical power

- **Headline metric**: PASS rate on PR-style probes (file recall ≥ 0.8 AND fact recall ≥ 0.8
  AND no failure-mode incidents in {`hallucination`, `citation-drop`, `over-search`}).
- **Power analysis** (driven by historical variance from May-2026 60-probe runs, paired-bootstrap
  variance ≈ 4.5pp): to detect a 5pp PASS-rate difference at α=0.05, β=0.2, n ≥ 50 paired probes
  is required. The 60-dev / 40-heldout split is *barely* sufficient; expand to 100 fresh-stack
  probes for any final shipping number.
- **BIRCO-style sampling budget**: when LLM-as-judge cost matters, sample a 100-query subset for
  detailed pairwise judgment with bootstrap CIs. This anchors human-aligned rigor at tractable
  cost, matching BIRCO's published n=100 / dataset standard.

### 11.4 Statistical testing battery

For every comparison reported (variant-vs-variant, sweet-search-vs-rg+Read,
uber-tree-vs-individual-T_i):

1. **Paired permutation test** (10K iterations, seed=42) on PASS rate. Report p-value.
2. **Paired bootstrap 95% CI** (10K iterations, seed=42) on the absolute and relative metric
   delta. Report both.
3. **Per-stratum effect size** (Cliff's δ or simple PASS-rate diff). Report stratum-by-stratum.
4. **Multiple-comparison correction** (Bonferroni or Holm) when reporting > 3 pairwise tests
   in one table.

Rationale: the IR simulation literature (Sakai et al., 2019) shows paired permutation +
bootstrap is the safest combination for IR-style metrics on n ≈ 40-100 — neither test relies on
Gaussian assumptions, and they cover both significance and effect-size reporting. Paired t-test
behaves OK at n ≥ 50 but loses control on bounded discrete metrics; Wilcoxon misbehaves at very
large n. Avoid both unless you've validated them via simulation against your variance.

### 11.5 Variance & seed protocol

- **3 inference seeds per evaluatee** for any number we publish. Report mean ± std.
- **Pinned router seed** (CatBoost / hybridSearchV2 use seed=42 on retrieval-side determinism).
- **Per-query bootstrapped CIs** in every results table. Any number without a CI is dev-only
  and clearly marked as such.
- **Documented seed list** in `eval/prompt-evolution/run-config.toml` per published run. Reruns
  use the same seeds; ablations rerun with fresh seeds and report variance.

### 11.6 LLM-as-judge protocol & inter-annotator agreement

- **PRP-style prompts** (Pairwise Ranking Prompting, per Qin et al.): randomized order, blind
  variant IDs, explicit rubric per failure mode. Position bias controlled by 50/50 swap.
- **Two judge models** (DSv4-Pro reflector + a different family — Sonnet 4.6 or GPT-5.5) per
  comparison. If they disagree, flag for human adjudication. This catches single-judge bias
  (verbosity, format preference) which RAGBench and Anthropic engineering both document.
- **Validate against human-labeled subset** of ≥ 30 probes once at campaign start, once at
  campaign end. Report Krippendorff's α and Cohen's κ vs human gold. If α < 0.6 the LLM judge
  is unreliable for the metric in question — fall back to human-only on that metric or
  redesign the rubric.
- **Pre-registered judge prompt** committed to the repo *before* the run; never tweaked
  mid-campaign without invalidating that run.

### 11.7 Reproducibility artifacts

Every published number must be reproducible from:

- `eval/prompt-evolution/manifest.json` — pinned repo SHAs, license, contamination flags
- `eval/prompt-evolution/splits/{dev_60.json, heldout_40.json, freshstack_30.json}` — split
  definitions with seeds
- `eval/prompt-evolution/seeds/T01..T14.md` — variant prompts (immutable per published run)
- `eval/prompt-evolution/run-config.toml` — evaluatee model versions, harness versions, GEPA
  hyperparameters, judge prompts, **`proposal_class` tagging policy**, seed list
- `eval/prompt-evolution/telemetry/budget.jsonl` — blended \$/eval, cache stats, cache-off bracket deltas
- `eval/prompt-evolution/results/{run-id}-portability.json` — `shipping_score`, `aux_*` stats (§8.9.1)
- `eval/prompt-evolution/results/{run-id}.jsonl` — raw per-probe records
- A one-shot `npm run eval:prompt -- --run <run-id>` script that reproduces a published number
  from manifest + config alone, without manual steps.

This is the FreshStack/CoIR/SWE-Lancer gold standard. Anything less and we cannot publish or
defend the numbers externally.

### 11.8 Pre-registration

Before each campaign:

1. Commit `eval/prompt-evolution/preregistration.md` with: **`shipping_score`** (§8.5 mean
   answerability on Opus 4.7 + GPT‑5.5 + Gemini 3.1 Pro) as **primary metric**, **paired portability
   stats** (`aux_median`, `aux_p25`, raw `aux_min`, `aux_min_four`, optional strata — §8.9.1), any
   **pre‑registered auxiliary `min` veto / evaluator exclusion protocol**, **`blended_usd_per_eval`
   logging + cache‑off bracket** (§8.9.3), optional **`PromptBridge-lite` budget** trigger (§8.9.6),
   **`P11‑cursor‑smoke`** inclusion, hypothesis,
   secondary metrics, statistical tests planned, multiple-comparison correction, sample size,
   stop rules.
2. Tag the commit before the first evaluatee call (`git tag prereg/{run-id}`).
3. Any deviation from the pre-registered plan is an *exploratory* result, must be labeled as
   such, and may not appear in the headline table without disclosure.

This is the IR conference / DeepMind Evals standard and prevents post-hoc cherry-picking. Without
it, a campaign that runs **14 variants × primary SOTA panel × auxiliary panel × ~6 metrics**
produces **hundreds of cells**; picking the best post-hoc is statistically meaningless.

---

## Part 12: Native-Baseline Comparison Protocol

**Question**: at every step, is sweet-search even better than `rg + Read`?

The honest answer: not at every step, and we must measure rather than assume. The 2025-2026 IR
literature (entire.io, "why grep beat embeddings", RepoHyper / GrepRAG) is full of cases where a
well-engineered lexical baseline matches or beats heavier retrieval pipelines on parts of the
distribution. Our advantage has to be defended where we claim it, and ceded where we don't.

### 12.1 The four mandatory baselines

At each promotion gate (Phase 2 in §9.3, plus before any external claim), run all four:

| Baseline | What it does | Used to answer |
|---|---|---|
| **B1: rg+Read native** (Claude Code default) | `rg <pattern>` then `Read <file>` with the harness's own loop | Are we even better than the simplest thing? |
| **B2: Generator-only** (no tools) | Model answers from its prior alone, no retrieval | What fraction of our wins is from retrieval at all? |
| **B3: Sweet-search agentic** (the candidate policy) | Full sweet-search tree with the tuned uber-tree | Our actual product |
| **B4: Oracle retrieval + generator** | Inject gold snippets directly | The retrieval ceiling — if B4 ≈ B3, retrieval is not the bottleneck |

Why all four: B1 establishes "is the work even worth it"; B2 establishes how much retrieval
contributes vs raw model knowledge; B3 is the product; B4 establishes the ceiling so we know
whether to invest in better retrieval or better prompting. Per the CODERAG-BENCH and RepoBench
literature, this is the canonical decomposition.

### 12.2 Cadence — when to compare, when to skip

- **NOT every GEPA generation** — overhead is too high (4× the cost per probe). GEPA campaigns
  run B3 optimizing **`shipping_score`** (mean over the primary SOTA trio from §8.5). Auxiliary
  pool replay is subsampled. The native baseline is not the GEPA optimization target.
- **At every promotion gate** (winner of GEPA Phase 1, before claiming an improvement) — run
  all four on the held-out 40-probe set with full statistical battery (§11.4).
- **At every external claim** (blog post, README "X% faster than rg" headline, paper) — run all
  four on the FreshStack-30 post-cutoff set, with full battery + per-stratum reporting.

### 12.3 What to report

For each of B1, B2, B3, B4, on each metric (PASS rate, file recall, citation precision, token
cost, latency, tool-call count):

- Absolute number with bootstrap 95% CI
- Delta vs B1 (the rg+Read baseline) with paired permutation p-value
- Per-stratum deltas (language × query-type) — exposes where sweet-search wins and where
  rg+Read is already enough

**The cost/latency Pareto plot is mandatory.** A 5pp PASS gain at 3× the latency or token cost
is not a clear win for a coding-agent product. The Aider Polyglot precedent: report (% correct)
× ($/run) on a 2D scatter and let the reader pick. Anchor B1's cost/latency at the harness's
native rate, not at API list price — Claude Code subscriptions amortize differently.

### 12.4 The "rg+Read might already be enough" rule

For every stratum where B1 (rg+Read) achieves PASS ≥ 0.85 and the sweet-search delta is
< 3pp with overlapping CIs, the recommendation is to **route that stratum to B1 in the
runtime decision tree** rather than fight for marginal wins. Concretely:

- "exact symbol lookup in a single file" — B1 is usually within 1-2pp of B3. Sweet-search
  should defer to harness `rg` here unless caching makes B3 strictly cheaper.
- "find file containing string X" — same.
- The decision tree should say *"if the question is a literal lookup and the project has a
  recent index, prefer indexed grep; otherwise the harness's native `rg` is fine"*.

This inverts the usual replacement framing. Sweet-search doesn't need to win on every query —
it needs to win on the queries where rg+Read demonstrably struggles (behavioral, structural,
multi-file flow), and that's where the decision tree should be most confident. The variant
slate (T1-T14) should explicitly encode this: variants that defer to `rg` on literal lookups
and only escalate on behavior/structure are valid hypotheses, not lazy ones.

### 12.5 Specific baseline implementations (for reproducibility)

**B1 — rg+Read native**: runs the agent inside Claude Code (**Opus 4.7** as the canonical
headline reference — Sonnet 4.6 acceptable when matching a logged user default) with **only** native `Read` and `Grep` tools enabled, sweet-search MCP server
disabled, and a system prompt that explicitly authorizes those tools. The exact configuration
is committed to `eval/prompt-evolution/baselines/b1-rg-read.toml`. Per the SWE-bench
publication discipline, the exact `rg` invocations and harness state must be logged per run
because rg behavior depends on `.gitignore`, `--smart-case` / `-i`, and CWD.

**B2 — Generator-only**: same harness with all tool calls disabled (or denied by hook) and a
system prompt instructing the model to answer from prior knowledge. Useful as a lower bound
and as a sanity check — if B2 ≈ B3 on a stratum, retrieval is contributing nothing there.

**B3 — Sweet-search agentic**: the candidate uber-tree (or whichever variant under test) with
the full sweet-search MCP toolkit and the tuned `AGENTS.md`. The product surface.

**B4 — Oracle retrieval + generator**: programmatically pre-injects the gold snippet ranges
as additional context to the system prompt before the agent runs (no retrieval call), then
evaluates the final answer. CODERAG-BENCH's canonical-context pattern. The gap between B3 and
B4 measures retrieval-quality slack; if it's large, fix retrieval. If it's small but B3 still
trails frontier closed models, fix the prompt / generation strategy.

---

## Part 13: Execution Readiness

This part exists because the previous twelve parts describe the *what* and *why* but not the
literal *how-to-start*. Without this, P0 turns into a debate about which JSON fields go where
and which existing harness pieces to reuse vs rebuild. This part anchors every abstract
deliverable to a specific file path or a specific schema, so a collaborator can begin
implementation in the next 90 minutes.

### 13.1 Build vs. reuse: actual repo-state inventory (May 2026)

A grep over `eval/` shows substantial existing infrastructure. The plan should reuse, not
rebuild:

| Need | What exists today | What to build |
|---|---|---|
| Probe schema + grading | `eval/retrieval-probes/probes.json` (60), `probes-stratified-100.json` (100, milestone-only), `probes-fresh-40.json` (40 fresh); PASS/PARTIAL/FAIL grading in `run-probes.mjs`; `--probes-file` flag for arbitrary external sets; `expectedPresentation` colgrep grading | Shape-variant annotation layer + tool-affinity preregs for the new query-shape probe set |
| Agent-in-loop runner | `eval/agent-read-workflows/run-bench.js` (orchestrator) + `claude-runner.js` (spawns `claude -p`, parses stream-json) + `audit.js` (post-hoc transcript audit) + `judge.js` (blind A/B) + `metrics.js` (deterministic recall) + `bin/` wrappers (`ss-grep`, `ss-find`, `ss-read`, `ss-semantic`, `sweet-search`) | New `shape-constrained` policy mode in `policies.js`; new `oracle-retrieval` and `generator-only` modes for B2/B4 |
| B1 native rg+Read | `policies.js` `native-rg-read` mode (Bash + Read denylist; allows `rg`/`grep`/`sed`/`awk`/`ls`/`wc`/`find`/`cat`/`head`/`tail`) | nothing — already authoritative |
| B3 sweet-search agentic | `policies.js` `sweet-search-tools` mode (allowlist: ss-grep, ss-find, ss-read, ss-semantic, sweet-search, plus pwd/ls/wc/find/echo/printf) | nothing for plumbing — just point at our tuned uber-tree |
| B2 generator-only | not implemented | New mode: deny all tools, single-pass; instruct the model to answer from prior |
| B4 oracle retrieval | not implemented | New mode: pre-inject gold snippet ranges as a system-prompt extension before agent run |
| Deterministic recall metrics | `metrics.js` with `fileRecall`, `symbolRecall`, `factRecall`, `lineOverlap`, `filePrecision`, `answerability="full"` strict definition (see §13.2) | nothing |
| LLM judge | `judge.js` blind A/B with order randomization, configurable `--judge-model` | New PRP-style two-judge wrapper with IAA validation |
| Repo pinning + content fingerprint | `eval/read-workflows/repo-manifest.json` (shared with retrieval bench); each artifact embeds pinned SHA + canonical-files fingerprint | nothing |
| Decontamination | not implemented | n-gram + embedding + LLM-decontaminator filters per §11.1 |
| Statistical battery | not implemented | paired permutation, paired bootstrap, Plackett-Luce per §11.4 |
| Pre-registration template | not implemented | `preregistration.template.md` per §13.3 |
| FreshStack uv validator | `eval/freshstack/uv-queries.json` with 30 hand-curated post-cutoff probes (pinned `astral-sh/uv@bb8109a`); `--probes-file` flag wired into `run-probes.mjs` | nothing — but indexer stalls on uv-sized repos noted; document fallback (`SWEET_SEARCH_FORCE_CPU=1`) |
| Sweet-search response format spec | partial (referenced in code) | Consolidated `docs/AGENT_RESPONSE_FORMAT.md` (§13.4) |

**Effort recalibration**: P0 in the table was 8-12h. With this inventory, ~5-7h: decontamination
filters (~2h), stats battery (~2h), reproducibility runner (~1h), preregistration template
(~30m), Krippendorff harness (~1h). The "missing" pieces are mostly small extensions of
`policies.js` and a shape-constraint mode in `claude-runner.js`.

### 13.2 Probe-set anchor and PASS definition

**Authoritative PASS definition** (from `eval/agent-read-workflows/metrics.js`):

`answerability = "full"` requires ALL of:
- `fileRecall = 1`
- `factRecall ≥ 0.8`
- `symbolRecall ≥ 0.8` (if `expectedSymbols` specified)
- `lineOverlap ≥ 0.3` (if `expectedLineRanges` specified)
- `filePrecision ≥ 0.5`

Downgrade reasons surfaced via `score.downgradeReasons`; per-task evidence success via
`score.evidenceSuccess`; over-fetch flag via `score.lowPrecisionEvidence`.

**Authoritative retrieval-probe grading** (from `eval/retrieval-probes/run-probes.mjs`):

- `PASS`: top-1 file matches AND symbol matches (if specified) AND type matches (if specified)
- `PARTIAL`: file matches but symbol/type does not, OR `expectedPresentation` mismatch
  (colgrep agent-pack tier wrong)
- `FAIL`: top-1 file does not match expected

**Probe set roles in the campaign**:

| File | Size | Role |
|---|---|---|
| `eval/retrieval-probes/probes.json` | 60 (40 dev / 20 held-out) | Retrieval-quality regression canary; do NOT use for prompt iteration |
| `eval/retrieval-probes/probes-stratified-100.json` | 100 | Milestone-only; never iterate against |
| `eval/retrieval-probes/probes-fresh-40.json` | 40 | Fresh held-out for retrieval changes |
| `eval/freshstack/uv-queries.json` | 30 | FreshStack post-cutoff held-out (uv@bb8109a) |
| **NEW**: `eval/query-shapes/golds.json` | ~78 (12 × 4 dev repos + 30 uv held-out) | Part 7 query-shape discovery |
| **NEW**: `eval/agent-read-workflows/tasks-prompt-eval.js` | ~20 hand-curated | Variant-slate Phase A (P8) and uber-tree validation (P10.6) |

The prompt-evolution campaign (Parts 6-12) operates against the new files. The existing files
remain pure retrieval-side regression gates; the campaign must not iterate against them per
the held-out discipline in `feedback_heldout_discipline_strict.md`.

### 13.3 Schema definitions (committed templates)

#### `eval/prompt-evolution/manifest.json` schema

```json
{
  "$schema": "1.0",
  "campaign_id": "prompt-evolution-2026-05",
  "created_at": "2026-05-09T00:00:00Z",
  "repos": [
    {
      "name": "fastify",
      "url": "https://github.com/fastify/fastify",
      "pinned_sha": "abc123...",
      "license": "MIT",
      "creation_date": "2017-05-01",
      "contamination_status": "checked",
      "removed_probes": []
    }
  ],
  "evaluatees": [
    {
      "name": "deepseek-v4-flash",
      "training_cutoff": "2026-01-15",
      "endpoint": "https://api.deepseek.com",
      "wire_api": "anthropic-compatible"
    }
  ],
  "splits": {
    "dev_60": "eval/retrieval-probes/probes.json#dev",
    "heldout_40": "eval/retrieval-probes/probes.json#heldout",
    "freshstack_30": "eval/freshstack/uv-queries.json"
  },
  "harness_version": {
    "claude_code_cli": "2.1.x",
    "sweet_search_commit": "<git-rev>"
  }
}
```

#### `eval/prompt-evolution/run-config.toml` schema

```toml
campaign_id = "prompt-evolution-2026-05"
run_id = "phase-a-spike-001"
manifest = "eval/prompt-evolution/manifest.json"
preregistration = "eval/prompt-evolution/preregistration.md"

[evaluatees]
pool = ["deepseek-v4-flash", "minimax-m2.7", "kimi-k2.5", "qwen3.6-plus"]
metric = "min_answerability"

[reflector]
model = "deepseek-v4-pro"
endpoint = "https://api.deepseek.com"
budget_usd = 100

[gepa]
reflection_minibatch_size = 3
minibatch_size = 5
generations_max = 30

[seeds]
torch = [42, 43, 44]
router = 42
bootstrap = 42

[stats]
permutation_iters = 10000
bootstrap_iters = 10000
multiple_comparison = "holm"

[judge]
prompt_path = "eval/prompt-evolution/judge-prompts/prp-pairwise-v1.md"
models = ["deepseek-v4-pro", "claude-sonnet-4-6"]
iaa_threshold_alpha = 0.6

[budget]
hard_cap_usd = 1500
phase_caps = { p6_2 = 50, p6_3 = 200, p8 = 100, p10 = 800, p11_5 = 300 }
```

#### `eval/prompt-evolution/preregistration.md` template

```markdown
# Pre-registration: <run-id>

**Campaign**: <campaign-id>
**Run**: <run-id>
**Author**: <name>
**Committed at**: <iso-timestamp>
**Tag**: prereg/<run-id>

## Primary metric
<one sentence — e.g., "PASS rate on the 40-probe held-out split, where PASS = answerability='full' per metrics.js">

## Hypothesis
<one sentence — e.g., "T9 (worked-examples-only) achieves higher PASS than T1 (question-shape router)">

## Secondary metrics
- file recall, symbol recall, fact recall, line overlap, file precision
- token cost (mean), tool-call count (median)
- per-stratum PASS deltas (language × query-type × repo-size)

## Statistical tests
- Paired permutation test, 10K iterations, seed=42, on PASS rate
- Paired bootstrap 95% CI, 10K iterations, seed=42, on absolute and relative deltas
- Per-stratum Cliff's δ
- Multiple-comparison correction: Holm

## Sample size justification
<paragraph — power analysis with assumed variance>

## Stop rules
- Halt if <kill criterion>
- Halt at hard budget cap of $<X>

## Pre-committed analysis decisions
<list — e.g., "If T9 wins on dev but loses on held-out, treat as overfit, do NOT publish T9">
```

#### `eval/query-shapes/golds.json` schema

```json
{
  "version": "1.0",
  "golds": [
    {
      "id": "FAS-QS-001",
      "repo": "fastify",
      "task_type": "function_behavior",
      "stratum_lang": "js",
      "stratum_size": "mid",
      "expectedFile": "lib/server.js",
      "expectedSymbolAnyOf": ["getServerInstance"],
      "expectedFacts": ["http2", "https"],
      "expectedLineRange": [42, 89],
      "predicted_best_tool": "ss-find",
      "predicted_best_shape": "short+with-symbol+narrow-regex",
      "rationale": "single-symbol behavior — narrow anchor + symbol should hit",
      "preregistered_by": "<author>",
      "preregistered_at": "<iso-ts>"
    }
  ]
}
```

#### `eval/query-shapes/variants.json` schema

```json
{
  "version": "1.0",
  "variants": [
    {
      "gold_id": "FAS-QS-001",
      "shape": "short+with-symbol+narrow-regex",
      "shape_coords": {
        "length": "short",
        "symbol_presence": "with",
        "intent_verb": "absent",
        "framing": "declarative",
        "domain_density": "high",
        "regex_anchor": "narrow"
      },
      "query_text": "getServerInstance http2",
      "regex_anchor": "getServerInstance",
      "intended_tools": ["ss-find", "auto"]
    }
  ]
}
```

#### `eval/query-shapes/recommendations.json` schema (Part 7's output)

See §7.6 — fully specified there with verbatim `instruction_text` per recommendation.

#### `eval/prompt-evolution/ablation-report.json` schema

```json
{
  "run_id": "phase-a-ablation-001",
  "n_variants": 14,
  "n_probes": 60,
  "pairwise_matrix": [[0, 12, 8, ...], ...],
  "pairwise_ties": [[0, 5, 9, ...], ...],
  "failure_mode_tally": {
    "T1": {"over-search": 8, "premature-stop": 2, ...},
    "T2": {...}
  },
  "per_stratum": {
    "T1": {
      "lang.js": {"pass": 0.82, "ci95": [0.74, 0.89]},
      "query.behavioral": {...}
    }
  },
  "plackett_luce": {
    "T1": {"worth": 1.42, "rank": 3, "ci95": [2, 5]},
    ...
  },
  "summary": {
    "T1": "wins on lang.go and query.literal; loses on lang.rs and over-search incidents",
    ...
  }
}
```

### 13.4 Sweet-search agent-format response contract (referenced by STOP rules)

A consolidated spec for the response fields the STOP rules in §5 reference. Should live in
`docs/AGENT_RESPONSE_FORMAT.md` (build target if not present); inline summary here:

| Field | Values | Meaning |
|---|---|---|
| `sufficient` | `YES` / `NO` / `PARTIAL` | Heuristic: does the pack contain enough evidence to answer the query? |
| `confidence` | `high` / `medium` / `low` | Based on score margin, IAR, top-1 dominance |
| `presentation` per result | `full` / `preview` / `summary` | Tier for that rank — `full` = body shown, `preview` = first N lines, `summary` = ranked file:line only |
| `expansionKind` per result | `full` / `sandwich` / `chunk` / `syntax` | How the chunk was expanded around the hit (function-bound, sibling-context, raw chunk, syntax-aware) |
| `### related (1-hop graph, top N)` block | optional | Graph-neighbor expansion when the hit references undefined-in-pack symbols |
| `### imports` block | optional | Import lines that resolve referenced names in the body |
| `### rank list` | always | Top-K ranked file:line:score for follow-up navigation without re-search |

The STOP rule semantic is: when `sufficient=YES` AND top-1 has `presentation=full` AND
(`### related` OR `### imports` resolves the body), the agent should answer immediately and not
re-search.

### 13.5 Baseline harness invocations (anchored to existing infrastructure)

Concrete commands using existing modes plus the two new ones (B2, B4):

```bash
# B1 native rg+Read on the held-out 40
node eval/agent-read-workflows/run-bench.js \
  --repo=fastify --tasks=eval/agent-read-workflows/tasks-prompt-eval.js \
  --mode=native-rg-read \
  --model=claude-sonnet-4-6 --keep-logs \
  --output=eval/prompt-evolution/results/b1-fastify-{ts}.json

# B3 sweet-search uber-tree (the candidate)
node eval/agent-read-workflows/run-bench.js \
  --repo=fastify --tasks=eval/agent-read-workflows/tasks-prompt-eval.js \
  --mode=sweet-search-tools \
  --policy=eval/prompt-evolution/synthesis-runs/T_uber_v1.md \
  --model=claude-sonnet-4-6 --keep-logs \
  --output=eval/prompt-evolution/results/b3-fastify-{ts}.json

# B2 generator-only (NEW: add `generator-only` to policies.js, denies all tools)
node eval/agent-read-workflows/run-bench.js \
  --repo=fastify --tasks=eval/agent-read-workflows/tasks-prompt-eval.js \
  --mode=generator-only \
  --model=claude-sonnet-4-6 --keep-logs \
  --output=eval/prompt-evolution/results/b2-fastify-{ts}.json

# B4 oracle retrieval (NEW: pre-injects gold snippets via system-prompt extension)
node eval/agent-read-workflows/run-bench.js \
  --repo=fastify --tasks=eval/agent-read-workflows/tasks-prompt-eval.js \
  --mode=oracle-retrieval \
  --gold-snippets=eval/agent-read-workflows/gold-snippets/fastify.json \
  --model=claude-sonnet-4-6 --keep-logs \
  --output=eval/prompt-evolution/results/b4-fastify-{ts}.json

# Aggregate and Pareto-plot (NEW)
node eval/prompt-evolution/baselines/aggregate-pareto.mjs \
  --b1=eval/prompt-evolution/results/b1-fastify-{ts}.json \
  --b2=eval/prompt-evolution/results/b2-fastify-{ts}.json \
  --b3=eval/prompt-evolution/results/b3-fastify-{ts}.json \
  --b4=eval/prompt-evolution/results/b4-fastify-{ts}.json \
  --stats=paired-permutation,bootstrap-ci \
  --output=eval/prompt-evolution/results/four-baseline-fastify-{ts}.json
```

### 13.6 Failure-mode detection rules (concrete, against existing JSONL trace)

`eval/prompt-evolution/failure-modes/detect.mjs` consumes `rawRuns[].toolCalls[]` from the
existing `claude-runner.js` JSONL output. **Separate** lightweight tagging emits **`proposal_class`**
(or **`reflect_evaluator_mismatch`**) per §8.9.4 when a reflector-suggested behavioral pattern exceeds
verified tool depth on that evaluatee trace — use it to route GEPA feedback, not as a PASS failure
unless pre-registered.

| Mode | Detection rule (against trace JSONL) |
|---|---|
| `over-search` | `count(toolCalls where tool starts with "ss-" or "sweet-search" AND prev_tool_result.text contains "sufficient=YES") ≥ 2` |
| `premature-stop` | `task.expectedFiles.length > 1 AND answer.citations.length < task.expectedFiles.length AND toolCallCount < taskTypeCap` |
| `wrong-tool` | match table by `task_type`: `config_lookup` → expects `ss-grep`; `function_behavior`/`error_handling_path` → expects `ss-find`; `multi_file_flow` → expects `ss-find` or structural |
| `broad-Read` | `count(toolCalls where tool == "Read" AND args.lines is null) ≥ 1` (only flagged in `native-rg-read` mode) |
| `citation-drop` | regex match in `answer.prose` for `[a-zA-Z_/.-]+\.(js\|ts\|go\|py\|rs\|rb)` that isn't in `answer.citations[].file` |
| `query-shape-bad` | first sweet-search NL query: `tokenCount < 4 OR tokenCount > 15 AND no symbol identifier matches expectedSymbols` |
| `budget-mismatch` | (single-file gold AND args contains `--xl`) OR (multi-file-flow gold AND no args, default 4k) |
| `hallucination` | for each file/symbol mentioned in `answer.prose`, `git -C <repo> grep` at pinned SHA returns no match |

These run post-hoc against the existing artifact JSONL. No changes to `claude-runner.js`.

### 13.7 Kill criteria & per-phase budget caps

| Phase | Halt-if criterion | Hard budget cap |
|---|---|---|
| P6.0 (golds) | <40 distinct golds within 14h; missing tool-affinity preregs | $0 |
| P6.2 (Track A) | best-shape `recall@1` < 0.5 across all 4 tools (variant grid is misframed) | $50 |
| P6.3 (Track B) | judge IAA α < 0.5 even after one rubric rewrite (humans-only on that metric) | $200 |
| P8 (Phase A spike) | median PASS rate < 0.5 across 6 leaders (variant slate is wrong) | $1,200 |
| P9 (MIPROv2 baseline) | 2× budget overrun without convergence | $80 |
| P10 (GEPA campaign) | spend > **$2,200** with no Pareto-better candidate on `shipping_score` in 3 successive generations | **$2,600** |
| P10.5 (synthesis) | 3 successive synthesized variants fail at G1-G5 (architecture problem) | $200 |
| P11.5 (4-baseline gate) | B3 fails to beat B1 with p < 0.05 on FreshStack-30 (sweet-search isn't an improvement on that distribution; do not ship the campaign output) | $300 |
| **Aggregate campaign cap** | **abort all phases** | **$5,000** (frontier‑led evaluatees; tighten if pre‑registered triage hits) |

Each phase script must check its own cap before spawning the next batch and exit non-zero with
a clear message when hit. Caps are tracked in
`eval/prompt-evolution/results/{run-id}/budget.jsonl` (append-only).

### 13.8 Krippendorff α validation procedure

1. **Sample**: 30 probe-shape pairs uniformly across tools and shape categories from the
   existing Track B run.
2. **Human labeling**: 2 annotators (or 1 + project author as second) label binary
   success/failure per probe-shape per tool. Disagreements: open discussion → consensus.
3. **Compute**: Krippendorff's α (interval / nominal as appropriate) and Cohen's κ vs the
   human gold for each LLM judge model on the same 30.
4. **Decision**:
   - α ≥ 0.6 + κ ≥ 0.6: judge accepted; proceed.
   - α ∈ [0.4, 0.6): rewrite judge rubric (clearer failure-mode definitions, stronger
     anchoring examples), re-run on the same 30 once.
   - α < 0.4 OR α stays < 0.6 after one rewrite: fall back to human-only labeling for that
     metric in this campaign.
5. **Lock**: judge rubric committed at run-config level (`run-config.toml` references the
   rubric path); never tune mid-campaign. New rubric = new run-id.

### 13.9 Parallelism map

| Phase | Parallelizable with |
|---|---|
| **P0** (rigor scaffolding) | P1-P5 (init plumbing) — fully independent |
| **P6.0** (gold construction) | P1-P5, P0 — independent |
| **P6.1** (variants) | P1-P5 — needs P6.0 |
| **P6.2** (Track A) | nothing — needs P6.1 |
| **P6.3** (Track B) | nothing — needs P6.2 |
| **P6.4** (promotion artifact) | T1-T14 *layout* (skeleton dirs, not bodies) |
| **P7** (T1-T14 bodies) | nothing — needs P6.4 |
| **P8** (Phase A) | P9 (MIPROv2 baseline) — both consume the same probe set independently |
| **P10** (GEPA campaigns) | each campaign-from-different-seed is independent; fan out 2-3 simultaneous |
| **P10.5** (synthesis) | nothing — needs P10 |
| **P10.6** (uber-tree validation) | nothing — needs P10.5 |
| **P11** (cross-harness validation) | nothing — needs P10.6 |
| **P11.5** (4-baseline gate) | nothing — final gate before P12 ship |

At t=0: **P0 + P1-P5 + P6.0 are 3-way parallel**; saves ~30% wall-clock vs strict serial.
P10 fan-out (2-3 parallel campaigns from different seeds) saves another ~50% on the GEPA leg.

### 13.10 Memory cross-references (for the implementer's context)

| Decision in this plan | Anchored in memory |
|---|---|
| STOP-rule discipline observation | `project_h2h_n30_2026_05_08.md` (sweet's first response trusted by judge but ignored by agent) |
| Multi-evaluatee strategy + DSPy plan | `project_dspy_plan.md` |
| Cross-model GEPA strategy | `project_gepa_dspy_strategy.md` |
| GEPA spike result baseline (5/10 PASS) | `project_gepa_spike_result.md` |
| FreshStack post-cutoff validator + uv indexer issue | `project_freshstack_eval.md` |
| 60-probe split methodology + IAR uniqueness gate | `project_iar_uniqueness_gate.md` |
| Retrieval overhaul (cAST + IAR + RRF + STOP) | `project_retrieval_overhaul_2026_05_05.md` |
| Encoder upgrade scoping | `project_encoder_upgrade_scoping.md` |
| Held-out discipline (never inspect per-query held-out) | `feedback_heldout_discipline_strict.md` |
| Benchmark concurrency rules (--concurrency=12 except GCSN) | `feedback_benchmark_config.md`, `feedback_gcsn_concurrency.md` |
| Format-gating rule for new ranking signals | `feedback_format_gate_boosts.md` |
| Native CLI latency requirement | `feedback_cli_latency.md` |

### 13.11 First-90-minutes runbook

Literal first-90-minutes when a collaborator picks this up. No reading required beyond this
doc; everything else is anchored.

```bash
# 0. Confirm clean working tree, current branch
git status
git log --oneline -5

# 1. Create the prompt-evolution + query-shapes directory structure
mkdir -p eval/prompt-evolution/{seeds,splits,decontamination,baselines,judge-prompts,results,synthesis-runs,rejected,contaminated,stats,failure-modes,gold-snippets}
mkdir -p eval/query-shapes/{golds,variants,results}

# 2. Copy the templates (manifest, run-config, preregistration) into place
#    — schemas live verbatim in §13.3 above.
#    Author preregistration first; commit before any LLM call.

# 3. Begin P0 + P6.0 in parallel:
#    P0 (one engineer): implement decontamination filters + statistical battery
#      - eval/prompt-evolution/decontamination/{n-gram,embedding,llm}-filter.mjs
#      - eval/prompt-evolution/stats/{paired-permutation,bootstrap-ci,plackett-luce}.mjs
#      - scripts/eval-prompt-evolution.mjs (one-shot runner)
#    P6.0 (other engineer): hand-author golds across all repos
#      - 12 golds per repo × {fastify, gin, ripgrep, flask} = 48
#      - 30 fresh on uv post-2026-04 commits
#      - Use eval/agent-read-workflows/tasks.js as schema reference
#      - Pre-register tool affinity per gold BEFORE running any tool

# 4. After P0 + P6.0:
#    Tag prereg/qshape-v1 (the campaign's first tagged pre-registration)
#    Implement P6.1 (variant generation, 6 shapes per gold)

# 5. Smoke test on one repo before running the full sweep:
node eval/query-shapes/run-shape-sweep.mjs \
  --repo=fastify \
  --golds=eval/query-shapes/golds.json \
  --variants=eval/query-shapes/variants.json \
  --tools=ss-find,ss-grep,ss-semantic,auto \
  --output=eval/query-shapes/results/fastify-smoke.json

# 6. Validate the harness output schema, fix bugs, then run full P6.2 sweep on all 4 dev repos.

# 7. Track B (P6.3) consumes the Track A subsample — runs claude -p with shape-constraint policy.
#    Implement the new mode in eval/agent-read-workflows/policies.js first.

# 8. Promote to recommendations.json (P6.4); commit with prereg/qshape-v1-results tag.

# 9. Begin P7 (T1-T14 prompt bodies) — copy verbatim instruction_text from
#    recommendations.json into each variant's query-phrasing rules.

# 10. Phase A spike (P8) — 6 leaders × 3 primary SOTA evaluatees × 60-probe dev.
#     Optional pre-registered triage first. Budget cap $1,200 (see §13.7).
```

This is bootable. The next change to this section is adding actual numbers as P6.0 and P6.2
results land.

---

## Implementation Order

| Phase | What | Effort | Depends on |
|-------|------|--------|------------|
| **P0** | BEIR/CoIR-grade benchmark scaffolding: pinned `manifest.json`, layered contamination filters (n-gram + embedding + LLM), stratified 60/40 split (lang × query-type × repo-size), FreshStack-30 fresh-repo holdout (post-cutoff repos), pre-registration template, statistical-test harness (paired permutation + bootstrap), seed-pinning, reproducibility runner script | 8-12h | existing 100-probe set + retrieval-overhaul ranking |
| **P1** | Multi-file injection in init: `AGENTS.md` (canonical) + `CLAUDE.md` import + `GEMINI.md` symlink + `.cursor/rules/sweet-search.mdc` + `.claude/rules/sweet-search.md` | 4-6h | read tools + tool names finalized |
| **P2** | `UserPromptSubmit` reminder hook | 1-2h | P1 |
| **P3** | Strict Claude enforcement mode (`permissions` + Read hint hook) | 2-3h | P1 |
| **P4** | MCP/tool description rewrite | 30-60m | current MCP tools |
| **P5** | Uninstall cleanup for all init-owned instruction/settings mutations across all five files | 2-3h | P1-P3 |
| **P6.0** | **Query-shape probe-set construction (§7.3)**: hand-author 12 golds × 4 dev repos (fastify, gin, ripgrep, flask) + 30 held-out fresh on uv post-cutoff; pre-register tool affinities and predicted winners per shape category | 10-14h | P0 |
| **P6.1** | **Authored shape variants (§7.2)**: 6 shape variants per gold across the agent-instructable grid (length × symbol × intent-verb × framing × domain-density × regex-anchor) | 6-8h | P6.0 |
| **P6.2** | **Track A deterministic sweep (§7.4)**: 4 in-scope tools × 78 golds × 6 shapes ≈ 1,872 runs, deterministic recall metrics | 4-6h + ~$10-20 | P6.1 |
| **P6.3** | **Track B agent-in-loop sweep (§7.5)**: 18-24 gold subsample × 6 shapes × 4 tools, Sonnet 4.6 bulk + optional pre-registered Opus 4.7 replay on winners; judges DSv4-Pro + Sonnet 4.6 per PRP protocol and IAA validation | 6-12h + ~$120-280 | P6.2 |
| **P6.4** | **Promotion artifact (§7.6)**: ship `eval/query-shapes/recommendations.json` with per-tool best/avoid shapes and verbatim `instruction_text` strings | 2-3h | P6.3 |
| **P7** | Spike: write T1-T14 prompt bodies under `eval/prompt-evolution/seeds/`, **importing query-phrasing rules verbatim from `recommendations.json`** | 4-6h | P1, **P6.4** |
| **P8** | Run Phase A (T1, T4, T7, T9, T13, T14) on **primary SOTA trio** × 60-probe dev set; optional pre-registered Sonnet/cheap-pool triage | 6-10h + **~$400-900** | P0, P7 |
| **P8.5** | **Variant ablation analysis (§6.4)**: pairwise W matrix, failure-mode tally (8 modes × 14 variants), per-stratum strength fingerprints, Plackett-Luce ranking with bootstrap CIs, prose summary per variant | 4-6h + minimal $ | P8 |
| **P9** | DSPy MIPROv2 baseline run on top 2 leaders from P8.5 | 3-5h + ~$30 | P8.5 |
| **P10** | GEPA campaign (light → medium → heavy) on top leaders, **`shipping_score` / mean(primary SOTA trio)** + auxiliary median gate | 12-24h + **~$900-2,500** | P9 |
| **P10.5** | **Variant synthesis (§6.5)**: GEPA system-aware Merge of Pareto-frontier variants → uber-tree v1 with explicit failure-mode targeting from §6.4 ablation map | 4-8h + ~$50-100 | P10 |
| **P10.6** | **Uber-tree validation gates G1-G5 (§6.6)** on held-out 40-probe set; reject and re-run synthesis if any gate fails | 3-5h + ~$30-60 | P10.5 |
| **P11** | Cross-harness validation gate (Claude Code Opus + Codex GPT‑5.5 + OpenCode Gemini; optional cheap replay) | 4-6h + **~$150-400** | P10.6 |
| **P11.05** | **Cursor Composer smoke (§8.9.5)**: finalist uber-tree × **8–15** stratified probes, default subscription Composer, pinned IDE build logged | ~1–2h + minimal $ (mostly manual launch overhead) | P11 |
| **P11.5** | **4-baseline gate (§12)**: B1 rg+Read native + B2 generator-only + B3 sweet-search uber-tree + B4 oracle retrieval, on FreshStack-30, with full statistical battery (§11.4) and cost/latency Pareto plot | 4-6h + ~$100-200 | P11.05 |
| **P12** | Wire promoted policy artifacts into init injection + hooks + MCP, regression test vs shipped baseline | 2-3h | P11.5 |

**P0 must precede the GEPA campaign.** Without rigor scaffolding, every subsequent number is
dev-only. Ship P0 alongside or before P1-P5 to unlock both the distribution rails and credible
benchmarking.

**P1-P5 can ship without GEPA.** They give us the multi-harness distribution rails, which is
already a clear product win even before any prompt optimization. The GEPA campaign (P7-P12)
runs on top of those rails.

**P8.5 and P10.5/P10.6 are the two new analysis-and-synthesis steps that turn raw GEPA outputs
into a defensible uber-tree.** Skipping P8.5 means GEPA picks a single winner and discards
specialist strengths; skipping P10.5/P10.6 means the synthesized tree may regress in failure
modes the individual variants handled correctly.

**P11.5 is the rg+Read defensibility gate.** Any external claim ("X% better than native") is
only defensible if it passed P11.5 on a fresh-repo holdout. Internal numbers can rely on the
60-dev / 40-heldout split without P11.5.

---

## Files To Create

### Init / harness distribution (P1-P5)

| File | Purpose |
|------|---------|
| `scripts/hooks/intercept-read.mjs` | PreToolUse hook: hint on native Read |
| `scripts/hooks/remind-tools.mjs` | `UserPromptSubmit` reminder hook |
| `scripts/inject-agent-instructions.js` | Multi-file injection logic (AGENTS.md + CLAUDE.md + GEMINI.md + Cursor rule) |
| `scripts/write-claude-rules.js` | `.claude/rules/sweet-search.md` write + `CLAUDE.md` import/cleanup logic |
| `tests/init/agent-instructions.test.js` | Tests for injection + symlink handling across all five files |
| `tests/init/prompt-reminders.test.js` | Tests for `UserPromptSubmit` integration |

### Benchmark rigor scaffolding (P0)

| File | Purpose |
|------|---------|
| `eval/prompt-evolution/manifest.json` | Pinned repo SHAs, source URLs, licenses, creation dates, contamination flags |
| `eval/prompt-evolution/splits/dev_60.json` | Stratified dev split (60 probes, seed=42) |
| `eval/prompt-evolution/splits/heldout_40.json` | Stratified held-out split (40 probes, seed=42) |
| `eval/prompt-evolution/splits/freshstack_30.json` | Post-cutoff fresh-repo holdout (~30 probes on `astral-sh/uv`, `denoland/deno`, etc.) |
| `eval/prompt-evolution/splits/build-splits.mjs` | Deterministic split builder with stratification logic |
| `eval/prompt-evolution/decontamination/n-gram-filter.mjs` | 50-char n-gram detector against public dumps |
| `eval/prompt-evolution/decontamination/embedding-filter.mjs` | CodeRankEmbed similarity at threshold 0.92 |
| `eval/prompt-evolution/decontamination/llm-filter.mjs` | DSv4-Flash decontamination pass |
| `eval/prompt-evolution/contaminated/` | Removed-items list with per-probe rationale |
| `eval/prompt-evolution/preregistration.md` | Pre-registered analysis plan template (committed before each run) |
| `eval/prompt-evolution/stats/paired-permutation.mjs` | 10K-iter paired permutation test with seed=42 |
| `eval/prompt-evolution/stats/bootstrap-ci.mjs` | 10K-iter paired bootstrap 95% CI |
| `eval/prompt-evolution/stats/plackett-luce.mjs` | PL ranking model + bootstrap CIs for variant ranks |
| `scripts/eval-prompt-evolution.mjs` | One-shot reproducible runner (`npm run eval:prompt -- --run <run-id>`) |

### Variant slate, ablation, synthesis (P7-P10.6)

| File | Purpose |
|------|---------|
| `eval/prompt-evolution/seeds/T01_question_shape_router.md` … `T14_tool_description_only.md` | The 14 seed variants from §6.2 |
| `eval/prompt-evolution/run-phase-a.mjs` | Spike harness: 6 leaders × **primary SOTA trio** × 60 probes (optional triage path) |
| `eval/prompt-evolution/ablation-report.json` | Output of §6.4: 14×14 win matrix, 14×8 failure-mode tally, per-stratum fingerprints, PL worth params with CIs |
| `eval/prompt-evolution/ablation-report.md` | Human-readable summary; per-variant prose ("T_i wins on X, fails on Y") |
| `eval/prompt-evolution/run-gepa.py` | DSPy + GEPA runner: optimizes **`shipping_score`** (primary SOTA trio) + logs auxiliary pool |
| `eval/prompt-evolution/run-synthesis.py` | GEPA system-aware Merge with §6.4 ablation map fed in as guidance |
| `eval/prompt-evolution/synthesis-runs/T_uber_v1.md`, `T_uber_v2.md`, … | Versioned synthesized uber-tree candidates with source-variant manifest |
| `eval/prompt-evolution/rejected/` | Failed-gate diagnostics for synthesized candidates that didn't pass G1-G5 |

### Native baseline + cross-harness validation (P11-P11.5)

| File | Purpose |
|------|---------|
| `eval/prompt-evolution/baselines/b1-rg-read.toml` | Claude Code config: `Read` + `Grep` only, sweet-search MCP disabled |
| `eval/prompt-evolution/baselines/b2-generator-only.toml` | Claude Code config: all tool calls denied; model answers from prior |
| `eval/prompt-evolution/baselines/b3-sweet-search.toml` | Claude Code config: full sweet-search MCP + tuned uber-tree |
| `eval/prompt-evolution/baselines/b4-oracle-retrieval.mjs` | Programmatically pre-injects gold snippets before agent runs |
| `eval/prompt-evolution/baselines/run-four-baselines.mjs` | Runs B1-B4 on a given split + emits Pareto plot data |
| `eval/prompt-evolution/run-cross-harness.mjs` | In-harness eval: invoke Claude Code / Codex / OpenCode programmatically with the tuned policy |
| `eval/prompt-evolution/run-cursor-composer-smoke.mjs` | **§8.9.5 / P11.05**: tiny Composer-only smoke runner producing `composer_smoke_pass_rate` + pinned Cursor build IDs |
| `eval/prompt-evolution/telemetry/cache-and-cost.mjs` | Append **`blended_usd_per_eval`**, optional cache-hit fields, cache-off bracket deltas to `budget.jsonl` (§8.9.3) |
| `eval/prompt-evolution/telemetry/portability-dossier.mjs` | Emits mandated paired stats: `shipping_score`, `aux_median`, `aux_p25`, `aux_min`, `aux_min_four`, strata (§8.9.1) |
| `eval/prompt-evolution/checks/codex-agents-size.mjs` | Assert merged `AGENTS.md` canonical chain `< project_doc_max_bytes` before promotion (§8.9.7) |
| `eval/prompt-evolution/failure-modes/proposal-class.mjs` | Heuristic **`proposal_class`** tagging for reflector↔evaluatee mismatch (§8.9.4) |
| `eval/prompt-evolution/judge-prompts/prp-pairwise-v1.md` | Pre-registered PRP-style LLM-as-judge prompt with rubric per failure mode |
| `eval/prompt-evolution/judge-prompts/human-validation-set.json` | 30-probe human-labeled gold for IAA validation (Krippendorff's α, Cohen's κ) |
| `eval/query-shapes/` | Benchmarks for optimal query wording per sweet-search tool (P6) |
| `eval/prompt-evolution/results/{run-id}.jsonl` | Raw per-probe records, one file per published run |
| `eval/prompt-evolution/run-config.toml` | Evaluatee model versions, harness versions, GEPA hyperparameters, judge prompts, seed list |

## Files To Modify

| File | Change |
|------|--------|
| `scripts/init.js` | Add canonical AGENTS.md write + CLAUDE.md/GEMINI.md/.cursor rule + Claude rules file + agent instructions + prompt reminders + optional enforcement |
| `scripts/uninstall.js` | Remove all five init-owned files (`AGENTS.md` block, `CLAUDE.md` import, `GEMINI.md`, `.cursor/rules/sweet-search.mdc`, `.claude/rules/sweet-search.md`), and sweet-search-managed settings entries |
| `mcp/server.js` | Improve tool descriptions using optimized replacement/intent wording |
| `docs/INIT_STRATEGY.md` | Update uninstall contract to include init-owned instruction/settings reversal across all five files |

---

## Deferred Follow-Up: `INIT_STRATEGY.md`

Do not edit `docs/INIT_STRATEGY.md` as part of this plan unless explicitly requested. When it is
updated later, make the following changes so it matches finalized init and uninstall behavior:

1. Add `.claude/rules/sweet-search.md` writing/importing to the init flow.
2. Add canonical `AGENTS.md` injection at project root.
3. Add agent instruction injection / symlink into `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/sweet-search.mdc`.
4. Add default-on `UserPromptSubmit` reminder hook.
5. Add opt-in Claude-specific enforcement via `.claude/settings.json`.
6. Update init flags for `--enforce-tools`, `--no-agent-instructions`, `--no-prompt-reminders`,
   `--symlink-instruction-files`, `--harnesses`.
7. Update uninstall behavior so it removes sweet-search-managed instruction/settings mutations
   across all five files, not only `.sweet-search/` and runtime assets.
8. Clarify that `.claude/rules/sweet-search.md` is loaded through a documented `CLAUDE.md` import.
9. Clarify that repo-local Claude hooks cannot transparently convert a `Grep` tool call into a
   `Bash` tool call.
10. Document the symlink semantics: `CLAUDE.md` and `GEMINI.md` MAY be symlinks to `AGENTS.md`
    when no per-tool surface tweaks are needed; `.cursor/rules/sweet-search.mdc` cannot be a
    symlink because Cursor requires frontmatter metadata.

---

## Design Decisions

### Why System Prompt Optimization First?

The agent benchmark showed that the same tools perform materially better when the prompt teaches a
decision tree, stop rules, and citation discipline. Tool implementation is necessary but not
sufficient; the prompt is the control surface that makes agents use the tools well.

### Why Query-Shape Benchmarking Before GEPA?

GEPA can evolve policy text, but it should not evolve from guesses. Tool-specific query-shape
benchmarks produce measured recommendations that seed the global prompt. Otherwise, optimization
may reinforce bad assumptions.

### Why CLI-First Guidance?

MCP is useful, but agents increasingly execute shell commands. The CLI is the universal interface:
Claude Code, Codex, Cursor, Windsurf, OpenCode, and future agents can all use it through shell
execution. MCP remains a convenience layer that delegates to the same implementation.

### Why Not Fully Block Read?

Claude Code edit workflows often require a prior native Read. Blocking Read would break editing.
Instead, instructions discourage Read for code understanding, enforcement hints on native Read, and
`read` / `read-semantic` provide better alternatives for exploration.

### Why Not Redirect Grep With A Hook?

Repo-local Claude hooks cannot change the tool type from `Grep` to `Bash`. True transparent
rerouting requires an external wrapper around Claude or an SDK-based control loop.

### Why Prompt Reminders?

Prompt reminders operate before tool selection and keep the sweet-search workflow active in the
model's short-term context. The token cost is low relative to repeated bad `rg + Read` behavior.

### Why GEPA + DSPy?

DSPy provides structured programs, metrics, and repeatable evaluation. GEPA-style reflective prompt
evolution mutates the textual artifacts using full execution traces. Sweet Search needs both:
measured query-generation rules and evolved global agent policy.

### Why Multi-Harness Distribution (5 files, not 1)?

Empirical 2025-2026 evidence shows each harness has its own discovery rules, prompt size budget,
and metadata-format expectations:

- Codex CLI enforces 32 KiB cap on `AGENTS.md` chain
- Claude Code uses `@imports` for lazy loading; loading everything at session start blows the
  context window
- Cursor `.mdc` requires frontmatter (`description`, `alwaysApply`)
- Gemini CLI's `context.fileName` is configurable but defaults to `GEMINI.md`
- OpenCode prefers `AGENTS.md` but reads `CLAUDE.md` if symlinked

A single file works *only* for OpenCode + Codex (which both read `AGENTS.md` directly). For full
coverage we need per-tool variants. The symlink convention reduces duplication where the body is
identical.

### Why Cheap Reflector + **SOTA‑Primary** Evaluatees for GEPA?

Three reasons:

1. **Objective matches users**: Most sweet-search agent runs target **Opus‑class / GPT‑5.5 / Gemini**
   surfaces. The headline metric (`shipping_score`) should ask those models directly — not proxies
   tuned for `$0.14/M` endpoints that users rarely pick for serious agent work.
2. **Cost control without wrong objective**: Frontier-only reflection with an expensive frontier
   reflector can still hit **\$5k+** campaigns. Keeping the **reflector** on DSv4‑Pro promo /
   MiniMax M2.5 preserves sample efficiency dollars where reflection-heavy token volume lives,
   while letting evaluatee dollars go to models that define product quality.
3. **Portable without pessimistic intersections**: Auxiliary cheap diversity still exposes brittle
   instructions via **`median(answerability)`**, **`aux_p25`**, **`aux_min_four`**, and optional
   stratified summaries (§8.9.1). That stack flags collapse on smaller or oddly aligned endpoints
   without letting a lone pathological evaluator **veto** a frontier win unless explicitly
   pre-registered.

### Why Bare-API for GEPA Training, In-Harness for Validation?

Training inside a harness lets the harness's 5-15K-token system prompt confound the GEPA reflector
— the reflector might mutate to fix Claude Code's quirks rather than improve the canonical
policy. It also 10x's per-call cost.

Bare-API training isolates the variable. In-harness validation at promotion gates measures real
shipping quality and produces the per-harness surface shim content.

### Why Symlinks for CLAUDE.md / GEMINI.md but Not Cursor?

`CLAUDE.md` and `GEMINI.md` are plain markdown — symlinking to `AGENTS.md` keeps them in sync
automatically. `.cursor/rules/sweet-search.mdc` requires YAML frontmatter (`description`,
`alwaysApply`, `filePattern`); a symlink to `AGENTS.md` would fail Cursor's parser. So Cursor
gets a thin `.mdc` file that copies the canonical body and adds frontmatter at the top.

### Why DeepSeek V4-Pro as Reflector Through May 31?

The 75% promo ($0.435 in / $0.87 out) makes it the cheapest model with ≥80% SWE-bench Verified
on the market. The reflector needs strong reasoning to produce useful prompt mutations, but does
not need to actually run agentic code-search itself — that's the evaluatee's job. After May 31
the price 4x's; switch to MiniMax M2.5 (80.2% Verified, $0.15/$1.15) or evaluate other options
at that point.

### Why Skip Cursor Composer **for primary** validation?

Cursor's Composer (the agentic mode) does not support custom OpenAI-compatible endpoints. Custom
keys work for Chat only. Cursor also routes through its backend — avoid routing secrets through it
when alternatives exist.

**Therefore:** headline **`shipping_score`** and §9.3 gates remain Claude Code / Codex / OpenCode.
**Nevertheless**, many users judge the product inside **Composer**; **§8.9.5** adds **`P11‑cursor‑smoke`**
(~8–15 probes, default subscription) on uber-tree finalists so regressions aren’t purely
reputational.

### Why Ablation (§6.4) Before Synthesis (§6.5)?

Picking a single winner from Phase A discards complementary strengths. Empirical ablation
literature (PromptBench, MoPE, GEPA system-aware Merge) shows that the top-1 variant and the
top-3 variants often disagree on *which* probes they handle correctly — and the union covers
substantially more probes than any single variant. Without the ablation step, GEPA evolves the
top-1's strengths and may erode the top-3's contribution. With the ablation step, GEPA's
reflector receives explicit per-failure-mode guidance and can target the gaps.

### Why GEPA System-Aware Merge as the Default Synthesis Strategy?

Three reasons:

1. **Cheapest path**: it reuses the same DSv4-Pro reflector loop already running for §8. No
   extra infrastructure, no embedding-gate training, no distillation pipeline.
2. **Empirical**: the GEPA paper reports +8pp over base GEPA on multi-stage tasks specifically
   from the Merge operator. Multi-tool agentic search is a multi-stage task.
3. **Single-call inference**: produces a single canonical AGENTS.md that ships unchanged. No
   per-query gating overhead like MoPE.

MoPE and distillation remain in the toolbox if Strategy A plateaus, but they are second-line
options because of production complexity (MoPE adds embedding + dispatch) or extra training
cost (distillation needs a teacher run + student run).

### Why FreshStack-Style Fresh-Repo Holdout in Addition to Layered Decontamination?

Defense in depth. Layered decontamination (n-gram + embedding + LLM filter) catches *known*
training-data overlap. FreshStack-style fresh-repo holdout catches *unknown* overlap from
training cutoffs we don't have public visibility into (Chinese open-weight models don't all
publish exact cutoffs; SaaS models update silently). A probe on a repo created after every
evaluatee's cutoff is contamination-proof by construction. Both are needed; neither alone is
sufficient.

### Why the Oracle Retrieval Baseline (B4)?

It localizes whether the bottleneck is retrieval or generation. If B3 (sweet-search) trails B4
(oracle) by a wide margin, the right investment is better retrieval (better embeddings, more
graph context, longer chunks). If B3 ≈ B4 but both trail Sonnet 4.6's frontier numbers, the
right investment is better prompting / generation strategy (the decision tree itself, the
agent loop). Without B4, every regression is ambiguous between retrieval-quality and
prompt-quality. The CODERAG-BENCH and RepoBench literature treat oracle retrieval as the
canonical ceiling check.

### Why Pre-Registration?

A campaign that runs 14 variants across **multiple evaluatee panels and metrics** produces large
tables of numbers quickly. Picking the best post-hoc is not statistical evidence — it's data-snooping. Pre-registration commits the
primary metric, hypothesis, statistical tests, and stop rules before the run, then tags the
commit. Any deviation is labeled exploratory. This is the IR-conference / DeepMind Evals
standard. It also forces clarity: if you can't write down a primary metric in advance, you
don't have a clear research question yet.

### Why Run All Four Baselines at Promotion Gates But Not at Every GEPA Generation?

Cost vs. signal. Running B1+B2+B3+B4 at every GEPA generation 4×'s the per-probe cost during
hundreds of generations, and the GEPA reflector doesn't need rg+Read context to mutate the
prompt — only B3 trace context. Running them at promotion gates (a handful of times per
campaign) gives the right signal-to-cost ratio: GEPA optimizes B3 internally, then promotion
gates verify B3 actually beats B1 (rg+Read) externally before we claim improvement.

### Why "rg+Read Might Already Be Enough" as a First-Class Rule?

Empirical evidence from 2025-2026 (entire.io, "why grep beat embeddings", RepoHyper / GrepRAG)
shows lexical search on identifier lookups is hard to beat in raw quality and impossible to
beat in latency. A decision tree that fights for marginal wins on literal lookups burns budget
that could go to behavioral / multi-file flows where sweet-search has structural advantages.
The §12.4 rule encodes this: prefer harness-native `rg` for stratum where B1 PASS ≥ 0.85 and
the sweet-search delta is < 3pp, and concentrate sweet-search's value proposition on the
behavioral / structural / multi-file strata where the gap is wider. This makes the product
honest and saves us from "everywhere is a nail" framing.

### Why a Plackett-Luce Ranking with Bootstrap CIs Instead of Just Top-1 Winner?

Top-1 selection on n=60 probes with paired-bootstrap variance ≈ 4.5pp produces overconfident
rankings; the true rank ordering of variants whose CIs overlap is statistically
indistinguishable. Plackett-Luce with bootstrap CIs gives us *which* variants are
statistically tied (and thus all valid synthesis seeds) and *which* are clearly behind
(and can be dropped). Per the Sakai et al. IR simulation literature, paired permutation tests
on top-1 alone underweight the information in pairwise outcomes; PL uses the full pairwise
matrix.

### Why Krippendorff's α ≥ 0.6 as the LLM-as-judge Threshold?

α ≥ 0.6 is the conventional "moderate agreement" threshold for IR / NLP tasks (lower thresholds
like 0.4 are tolerated for highly subjective tasks; α ≥ 0.8 is "near-perfect" and rare). At α <
0.6 the LLM judge is producing labels that don't track human gold reliably enough to use as a
metric. The threshold is conservative: it forces a redesign of the judge rubric or a fall-back
to human-only labeling on that specific metric, rather than papering over disagreement with
larger sample sizes. The RAGBench TRACe paper uses α ≥ 0.7 as their bar; we use 0.6 because
our agentic-eval metrics are noisier than RAGBench's per-claim labels.
