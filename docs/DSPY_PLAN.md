# DSPy Prompt Optimization Plan

**Created**: 2026-04-09
**Status**: Draft
**Depends on**: SYSTEM_PROMPT_OPT_PLAN.md

---

## Problem Statement

Sweet-search's agent alignment layer — the instructions that tell AI coding agents to use
sweet-search instead of native Grep/Read/Glob — is the single biggest lever for adoption.
If the instructions are unclear, agents fall back to native tools and sweet-search's speed
and quality advantages are wasted.

Today these instructions are hand-written. We have no evidence they are optimal. Different
AI models (Claude, GPT-4o, Gemini, Grok, Codex) interpret instructions differently. A prompt
phrasing that works for Claude may confuse Gemini. We need one universal instruction set that
works well across all target models, optimized against measurable metrics rather than intuition.

DSPy (Declarative Self-improving Python) solves this by treating prompts as optimizable
parameters. Given examples and a metric, DSPy's optimizers automatically search the space of
instruction phrasings, few-shot example selections, and structural variations to find the
highest-scoring prompt configuration.

---

## What DSPy Is (Brief)

DSPy is a Python framework from Stanford NLP that replaces manual prompt engineering with
programmatic prompt compilation. Core concepts:

- **Signatures**: Declarative input/output specs (`question -> answer`). No prompt text.
- **Modules**: Reusable strategies (ChainOfThought, ReAct) that wrap signatures.
- **Optimizers**: Algorithms (MIPROv2, GEPA, BootstrapFewShot) that take a module + examples +
  metric and automatically find the best prompt configuration.

DSPy generates its own prompt variants. You do not write candidate prompts. You provide:
1. A task definition (signature)
2. 10-50 labeled examples
3. A scoring metric

DSPy handles everything else: proposing instruction phrasings, selecting few-shot examples,
testing combinations, and promoting winners.

Reference: https://dspy.ai / https://github.com/stanfordnlp/dspy

---

## Optimization Surfaces

Five prompt surfaces in sweet-search directly affect agent tool selection:

| Surface | File | Description |
|---------|------|-------------|
| **S1** — Claude rules file | `.claude/rules/sweet-search.md` | Claude-specific tool replacement rules, examples, and fallback guidance |
| **S2** — CLAUDE.md instruction block | `CLAUDE.md` (marker-wrapped) | Cross-agent tool guidance injected during `sweet-search init` |
| **S3** — AGENTS.md instruction block | `AGENTS.md` (marker-wrapped) | Same content as S2, for non-Claude agents (Cursor, Windsurf, Codex) |
| **S4** — UserPromptSubmit reminder | `scripts/hooks/remind-tools.mjs` output | ~200-token reminder injected every turn to prevent drift to native tools |
| **S5** — MCP tool descriptions | `mcp/server.js` tool registrations | The `description` strings agents see when listing available tools |

S2 and S3 share the same content. S1 is Claude-specific and can be more detailed. S5 is
constrained by MCP tool description length limits. S4 must be short (~200 tokens) to avoid
per-turn overhead.

---

## Architecture

### Overview

DSPy runs offline as a Python optimization script. It does not ship as a runtime dependency.
The output is static markdown and JSON files that are checked into the repo and consumed by
`sweet-search init` during instruction injection.

```
eval/dspy-optimizer/
├── optimize.py                    # Main optimization script
├── adapters.py                    # Custom LM adapter (wraps Claude CLI agent sessions)
├── metrics.py                     # Composite scoring metric
├── loader.py                      # Loads trainset from agent-eval questions
├── requirements.txt               # dspy>=2.5, anthropic, openai
├── README.md                      # How to run optimization
└── output/
    ├── universal-instructions.md  # Optimized S1/S2/S3 content
    ├── reminder-payload.txt       # Optimized S4 content
    ├── tool-descriptions.json     # Optimized S5 content
    ├── optimization-report.json   # Scores, trials, model breakdown
    └── few-shot-demos.json        # DSPy-selected demonstration examples
```

### How It Works

```
┌──────────────────────────────────────────────────────────────┐
│  optimize.py                                                  │
│                                                               │
│  1. Load trainset (30+ questions from eval/agent-eval/)       │
│  2. Define SweetSearchAgent DSPy module                       │
│     - system_prompt is the parameterized surface              │
│     - forward() shells out to `claude -p` with tools          │
│  3. Define universal_metric()                                 │
│     - runs each candidate prompt on ALL target models         │
│     - scores correctness, tool selection, efficiency          │
│     - weighted composite with min-floor for weakest model     │
│  4. Run MIPROv2 optimizer                                     │
│     - DSPy proposes instruction variants automatically        │
│     - DSPy bootstraps few-shot examples from training data    │
│     - DSPy tests combinations, promotes winners               │
│  5. Export optimized artifacts to output/                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Custom LM Adapter

DSPy needs an LM backend. Our "LM call" is a full agent session (Claude Code with tools).
We wrap this as a custom adapter:

```python
# eval/dspy-optimizer/adapters.py

import subprocess
import json
import tempfile
import os

class AgentSessionLM:
    """
    Wraps a Claude Code agent session as a callable for DSPy.

    Each "LM call" is a full agent conversation:
      1. Write the candidate system prompt to a temp file
      2. Run `claude -p` with sweet-search tools available
      3. Parse the JSON output (answer, tool calls, token usage)
      4. Return the answer text

    This lets DSPy optimize the system prompt while the agent
    uses sweet-search tools naturally.
    """

    def __init__(self, model="claude-sonnet-4-6", project_root=None, max_budget=0.50):
        self.model = model
        self.project_root = project_root or os.environ.get("SWEET_SEARCH_EVAL_ROOT")
        self.max_budget = max_budget
        self.search_helper = os.path.join(self.project_root, "eval/agent-eval/tools/search-helper.js")

    def __call__(self, system_prompt, question):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write(system_prompt)
            prompt_file = f.name

        try:
            result = subprocess.run(
                ["claude", "-p",
                 "--output-format", "json",
                 "--model", self.model,
                 "--system-prompt-file", prompt_file,
                 "--allowed-tools", "Bash",
                 "--disallowed-tools", "Read Edit Write Glob Grep",
                 "--max-budget-usd", str(self.max_budget),
                 "--dangerously-skip-permissions",
                 "--no-session-persistence",
                 question],
                capture_output=True, text=True, timeout=120,
                cwd=self.project_root,
            )
            output = json.loads(result.stdout)
            return {
                "answer": output.get("result", ""),
                "tool_calls": self._extract_tool_calls(output),
                "tokens": output.get("usage", {}).get("total_tokens", 0),
                "cost": output.get("cost", 0),
            }
        finally:
            os.unlink(prompt_file)

    def _extract_tool_calls(self, output):
        """Parse tool_use blocks from the conversation to count sweet-search vs native calls."""
        calls = []
        for msg in output.get("messages", []):
            for block in msg.get("content", []):
                if block.get("type") == "tool_use":
                    calls.append({
                        "tool": block.get("name", ""),
                        "input": block.get("input", {}),
                    })
        return calls
```

For non-Claude models (GPT-4o, Gemini, Grok), a simpler adapter calls the model's API directly
with tool definitions, since those models don't have a CLI equivalent:

```python
class APIAgentLM:
    """
    Wraps an OpenAI-compatible API as an agent with tool definitions.
    Used for GPT-4o, Gemini, Grok during multi-model optimization.
    """

    def __init__(self, model, api_key, api_base=None):
        import openai
        self.client = openai.OpenAI(api_key=api_key, base_url=api_base)
        self.model = model
        self.tools = self._build_sweet_search_tool_defs()

    def __call__(self, system_prompt, question):
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": question},
            ],
            tools=self.tools,
            max_tokens=4096,
        )
        # Parse response, execute tool calls against sweet-search CLI, continue conversation
        # until the model produces a final answer (max 10 turns)
        ...
```

---

## DSPy Module

```python
# eval/dspy-optimizer/optimize.py

import dspy

class ToolGuidance(dspy.Signature):
    """Guide an AI coding agent to answer a code question using sweet-search tools."""
    question: str = dspy.InputField(desc="A code question about the target repository")
    answer: str = dspy.OutputField(desc="Specific answer citing file paths, function names, line numbers")


class SweetSearchAgent(dspy.Module):
    """
    The module DSPy optimizes. The 'predict' call's compiled instructions
    become the system prompt / CLAUDE.md content.
    """
    def __init__(self):
        self.answer = dspy.ChainOfThought(ToolGuidance)

    def forward(self, question):
        return self.answer(question=question)
```

DSPy will optimize:
- The instruction text prepended to the signature (becomes the CLAUDE.md/rules content)
- The few-shot demonstrations (become example blocks in the instructions)
- The chain-of-thought scaffolding (if it helps, DSPy keeps it; if not, it drops it)

---

## Metric: Universal Multi-Model Scoring

### Design Principles

1. **One prompt for all models** — we ship a single instruction set, not per-model variants.
2. **Floor matters more than ceiling** — a prompt that scores 0.9 on Claude but 0.4 on Gemini
   is worse than one that scores 0.8 on both. The weakest model's score dominates.
3. **Four scoring dimensions** — correctness, tool selection, efficiency, parsimony.

### Implementation

```python
# eval/dspy-optimizer/metrics.py

import subprocess
import json

# Target models for universal optimization
MODELS = {
    "claude-sonnet": AgentSessionLM(model="claude-sonnet-4-6"),
    "gpt-4o":        APIAgentLM(model="gpt-4o", api_key=OPENAI_KEY),
    "grok-mini":     APIAgentLM(model="grok-3-mini", api_key=XAI_KEY,
                                api_base="https://api.x.ai/v1"),
    "gemini-flash":  APIAgentLM(model="gemini-2.5-flash", api_key=GOOGLE_KEY,
                                api_base="https://generativelanguage.googleapis.com/v1beta/openai"),
}

# Weights per model (primary target gets a bonus, but floor still dominates)
MODEL_WEIGHTS = {
    "claude-sonnet": 0.35,
    "gpt-4o":        0.30,
    "grok-mini":     0.15,
    "gemini-flash":  0.20,
}


def score_single(result, reference_answer):
    """Score one agent session result on four dimensions."""

    # 1. Correctness (0-1): reuse the existing agent-eval judge
    judgment = run_judge(result["answer"], reference_answer)
    correctness = judgment["correctness"] / 5.0

    # 2. Tool selection (0-1): did the agent use sweet-search, not native tools?
    tool_calls = result["tool_calls"]
    ss_calls = [t for t in tool_calls if is_sweet_search_call(t)]
    native_calls = [t for t in tool_calls if is_native_tool_call(t)]
    total = len(ss_calls) + len(native_calls)
    tool_selection = len(ss_calls) / max(1, total)

    # 3. Efficiency (0-1): fewer tokens is better, target 4000
    efficiency = min(1.0, 4000 / max(1, result["tokens"]))

    # 4. Parsimony (0-1): fewer search calls is better, target 1-2
    parsimony = min(1.0, 2 / max(1, len(ss_calls)))

    return (
        0.50 * correctness +
        0.25 * tool_selection +
        0.15 * efficiency +
        0.10 * parsimony
    )


def universal_metric(example, prediction):
    """
    Score a candidate prompt across ALL target models.

    The composite weights the floor (weakest model) heavily to prevent
    over-optimization for a single model at the expense of others.
    """
    model_scores = {}
    for name, lm in MODELS.items():
        result = lm(prediction.system_prompt, example.question)
        model_scores[name] = score_single(result, example.answer)

    floor = min(model_scores.values())
    weighted_avg = sum(
        MODEL_WEIGHTS[name] * score
        for name, score in model_scores.items()
    )

    # 40% floor + 40% weighted average + 20% primary target bonus
    return (
        0.40 * floor +
        0.40 * weighted_avg +
        0.20 * model_scores["claude-sonnet"]
    )
```

### Why This Metric Shape

| Component | Weight | Purpose |
|-----------|--------|---------|
| `min(scores)` | 40% | Prevents instructions that confuse any model. Forces universal clarity. |
| `weighted_avg` | 40% | Rewards overall quality. Primary target (Claude) gets slight edge via weight. |
| `claude-sonnet` bonus | 20% | Claude Code is the primary deployment target. Tie-break in its favor. |

The floor-heavy weighting means DSPy will:
- Eliminate ambiguous phrasings (they hurt weak models)
- Prefer explicit, concrete instructions over clever tricks
- Converge on universally understandable tool-use guidance
- Still perform well on strong models (clear instructions don't hurt Claude/GPT-4o)

---

## Training Data

### Source

Reuse the existing agent-eval question sets. Each question has:
- `question`: the code question
- `difficulty`: easy / medium / hard
- `keyFiles`: ground-truth relevant files
- `referenceAnswer`: expected answer content

### Loader

```python
# eval/dspy-optimizer/loader.py

import json
import dspy
from pathlib import Path

def load_trainset(eval_dir="eval/agent-eval", repo="fastify"):
    """Load agent-eval questions as DSPy examples."""
    questions_path = Path(eval_dir) / "questions" / f"{repo}-questions.jsonl"
    examples = []

    with open(questions_path) as f:
        for line in f:
            q = json.loads(line.strip())
            examples.append(
                dspy.Example(
                    question=q["text"],
                    answer=q["referenceAnswer"],
                    difficulty=q["difficulty"],
                    key_files=q["keyFiles"],
                ).with_inputs("question")
            )

    # Split: 20 for training, 10 for validation
    return examples[:20], examples[20:]
```

### Expanding the Eval Set

30 questions on one repo (Fastify) is a good start. For robust optimization:

1. **Add 1-2 more repos** — run `--generate-questions` on a second repo (e.g., Express, Hono)
   to test generalization across codebases.
2. **Target 50-100 total questions** — DSPy works with as few as 10, but more data means
   the optimizer is less likely to overfit to phrasing quirks.
3. **Include tool-selection-specific questions** — add questions where the expected behavior is
   "use GREP" vs "use SEARCH" vs "use read-semantic" to directly test mode selection.

---

## Optimization Strategy

### Two-Phase Approach (Cost-Efficient)

**Phase A: Cheap iteration** (~$60-100)
- Run MIPROv2 with `auto="light"` on cheap models only (Grok Mini, Gemini Flash)
- 50-80 trials, 4 threads
- Purpose: eliminate obviously bad prompt variants quickly
- Output: top-5 candidate prompts

**Phase B: Full validation** (~$150-300)
- Evaluate top-5 candidates on all 4 models
- Full 30-question eval per model per candidate (= 600 agent sessions)
- Purpose: select the universal winner
- Output: one `universal-instructions.md`

### Cost Breakdown

| Phase | Models | Trials | Questions/trial | Cost/question | Total |
|-------|--------|--------|-----------------|---------------|-------|
| A (iterate) | 2 cheap | 80 | 20 | ~$0.01 | ~$32 |
| B (validate) | 4 all | 5 | 30 | ~$0.05-0.20 | ~$150-600 |
| **Total** | | | | | **~$180-630** |

### Optimization Command

```bash
cd eval/dspy-optimizer

# Phase A: cheap iteration
python optimize.py --phase=iterate --models=grok-mini,gemini-flash \
  --trials=80 --trainset=../agent-eval/questions/fastify-questions.jsonl

# Phase B: full validation
python optimize.py --phase=validate --models=all \
  --candidates=output/phase-a-candidates.json \
  --trainset=../agent-eval/questions/fastify-questions.jsonl

# One-shot (both phases)
python optimize.py --auto --models=all \
  --trainset=../agent-eval/questions/fastify-questions.jsonl
```

---

## Output Artifacts

### `output/universal-instructions.md`

The optimized instruction block. This is what gets injected into CLAUDE.md / AGENTS.md
and written to `.claude/rules/sweet-search.md` during `sweet-search init`.

Format: plain markdown, wrapped in the standard markers. DSPy generates the content; the
export script wraps it in markers for idempotent injection.

### `output/reminder-payload.txt`

The optimized ~200-token reminder for the `UserPromptSubmit` hook. DSPy optimizes this
separately because it has different constraints (must be very short, injected every turn).

### `output/tool-descriptions.json`

Optimized MCP tool description strings for `search`, `read`, `read-semantic`, and `files`.
These are short strings (under 200 chars each) — DSPy optimizes them for agent tool selection
accuracy.

```json
{
  "search": "Search file contents in the codebase. ...",
  "read": "Read one or more files with exact output. ...",
  "read-semantic": "Read only the parts of a file relevant to a query. ...",
  "files": "Find files and directories by path pattern. ..."
}
```

### `output/optimization-report.json`

Full record of the optimization run for reproducibility:

```json
{
  "timestamp": "2026-04-15T10:30:00Z",
  "dspy_version": "3.1.3",
  "optimizer": "MIPROv2",
  "trials": 80,
  "models_tested": ["claude-sonnet-4-6", "gpt-4o", "grok-3-mini", "gemini-2.5-flash"],
  "trainset_size": 20,
  "devset_size": 10,
  "baseline_score": 0.62,
  "optimized_score": 0.81,
  "per_model_scores": {
    "claude-sonnet": { "baseline": 0.71, "optimized": 0.87 },
    "gpt-4o":        { "baseline": 0.65, "optimized": 0.83 },
    "grok-mini":     { "baseline": 0.48, "optimized": 0.71 },
    "gemini-flash":  { "baseline": 0.55, "optimized": 0.76 }
  },
  "per_dimension": {
    "correctness": { "baseline": 0.68, "optimized": 0.84 },
    "tool_selection": { "baseline": 0.55, "optimized": 0.89 },
    "efficiency": { "baseline": 0.72, "optimized": 0.78 },
    "parsimony": { "baseline": 0.60, "optimized": 0.75 }
  }
}
```

---

## Integration with Init

The optimized artifacts replace the hand-written defaults. The integration point is
`scripts/inject-agent-instructions.js`:

```
sweet-search init
  └── step 11: inject agent instructions
        ├── if eval/dspy-optimizer/output/universal-instructions.md exists:
        │     use it (optimized)
        └── else:
              use the hand-written default (fallback)
```

Similarly for the reminder hook and tool descriptions:

- `remind-tools.mjs` reads `output/reminder-payload.txt` if it exists, else uses its
  built-in default.
- `mcp/server.js` reads `output/tool-descriptions.json` if it exists, else uses its
  built-in defaults.

This means:
- **Dev/CI**: optimization output is checked into the repo, all users get the optimized version.
- **No DSPy runtime dependency**: Python is only needed to *run* optimization. The output is
  static text files consumed by Node.js at init time.
- **Safe fallback**: if optimization artifacts are missing, everything still works with
  hand-written defaults.

---

## Re-Optimization Cadence

Re-run optimization when:
- New sweet-search tools are added (e.g., a new MCP tool or CLI command)
- The eval set is expanded (more questions, more repos)
- A new target model is added (e.g., Claude 4.5, GPT-5)
- Major changes to the search pipeline affect result quality or format

Expected cadence: roughly once per quarter or per major release.

---

## Constraints

1. **Offline only** — DSPy optimization never runs at user install time. It runs on the
   maintainer's machine (or CI) and the output is committed.
2. **No Python runtime dependency** — sweet-search is a Node.js/Rust project. Python is
   a dev-only dependency in `eval/dspy-optimizer/`.
3. **Validated before adoption** — every optimized prompt must score higher than the hand-written
   baseline on the full eval set across all target models before it replaces the default.
4. **Reproducible** — optimization-report.json records all parameters, scores, and versions
   so any run can be audited or reproduced.
5. **One universal output** — a single instruction set ships for all models. No per-model
   variants in the init flow.

---

## Files to Create

| File | Purpose |
|------|---------|
| `eval/dspy-optimizer/optimize.py` | Main optimization script |
| `eval/dspy-optimizer/adapters.py` | Custom LM adapters (Claude CLI, OpenAI API) |
| `eval/dspy-optimizer/metrics.py` | Universal multi-model metric |
| `eval/dspy-optimizer/loader.py` | Trainset loader from agent-eval questions |
| `eval/dspy-optimizer/requirements.txt` | Python dependencies |
| `eval/dspy-optimizer/README.md` | How to run optimization |

## Files to Modify

| File | Change |
|------|--------|
| `scripts/inject-agent-instructions.js` | Read from DSPy output if available, else use default |
| `scripts/hooks/remind-tools.mjs` | Read from DSPy output if available, else use default |
| `mcp/server.js` | Read tool descriptions from DSPy output if available |

---

## Implementation Order

| Step | What | Effort | Depends on |
|------|------|--------|------------|
| **D1** | Scaffold `eval/dspy-optimizer/` with adapters, loader, metric | 3-4h | P9 eval harness |
| **D2** | Implement `optimize.py` with MIPROv2, two-phase strategy | 3-4h | D1 |
| **D3** | Run Phase A (cheap iteration) and validate results | 2-3h + ~$60 | D2 |
| **D4** | Run Phase B (full multi-model validation) | 1-2h + ~$300 | D3 |
| **D5** | Wire output artifacts into init injection + hooks + MCP | 2-3h | D4 |
| **D6** | Regression test: re-run full eval, confirm score >= baseline | 1-2h | D5 |

**Total estimated effort**: 12-18h + $200-400 API cost

This replaces the vague P10 (6-10h) and P11 (2-4h) from the parent plan with a concrete
breakdown that includes the multi-model strategy.

---

## Design Decisions

### Why MIPROv2 over other DSPy optimizers?

MIPROv2 (Multi-prompt Instruction Proposal Optimizer v2) can optimize both instructions and
few-shot examples simultaneously. BootstrapFewShot only tunes examples. GEPA uses reflective
evolution which is slower and more expensive. MIPROv2 is the best balance of capability and cost
for our use case.

### Why a floor-weighted metric?

A prompt that scores 0.9 on Claude but 0.4 on Gemini is useless — it means Gemini users get
broken tool selection. The floor component (40% weight on `min(scores)`) ensures DSPy eliminates
prompts that confuse any model, even if they're great for one model.

### Why shell out to `claude -p` instead of using the Anthropic API directly?

The agent's behavior depends on Claude Code's tool-use harness, not just the API. Tool
definitions, permission enforcement, output formatting, and multi-turn conversation management
all affect how the agent interprets instructions. Testing via the CLI captures the real
end-to-end behavior. For non-Claude models, the API adapter is acceptable because those models
don't have an equivalent CLI harness.

### Why not optimize at install time?

Optimization requires Python, multiple API keys, 100+ LLM calls, and 30+ minutes of compute.
Users running `sweet-search init` should not need any of this. The optimization is a maintainer
activity; users get the pre-optimized output.

### Why check optimization output into the repo?

So that `npm publish` includes the optimized artifacts. Users who install sweet-search from npm
get the optimized instructions without running Python. The output is small (a few KB of markdown
and JSON) and changes infrequently.
