# Claude Flow — Brief Guide

Claude Flow’s useful features (routing, memory, learning) are **not automatic**. You get value by invoking them in the right place. This guide is use-case agnostic: same ideas apply to a one-off fix or a multi-batch swarm.

**Replace `PROJECT_ROOT` below with your repo path (e.g. `/home/you/projects/my-repo`).**

---

Auto hooks in `.claude/settings.json` use project root; we still run route / pre-task / post-task / memory manually for stable task-ids and per-batch checkpoints.

---

## Golden rule: project root

All `npx @claude-flow/cli@latest` commands resolve the memory DB (and often config) from **current working directory**. If cwd is a subdir, you get “Database not found”.

**Always run from repo root:** prefix every command with  
`cd PROJECT_ROOT && npx @claude-flow/cli@latest ...`

---

## Full commands

### Session

```bash
# Start (or resume) session
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks session-start --project "my-project"

# Prewarm HNSW cache (run right after session-start)
cd PROJECT_ROOT && npx @claude-flow/cli@latest memory search --query "patterns and lessons learned" --limit 10
cd PROJECT_ROOT && npx @claude-flow/cli@latest memory search --query "recent work and implementation context" --namespace sweet-search --limit 10

# End session and export metrics
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks session-end --export-metrics true
```

**Why prewarm?** These broad searches load embeddings into the HNSW in-memory index. Later targeted searches during work hit cache instead of disk (~78% → 90%+ hit rate).

### Memory

```bash
# Search before starting work
cd PROJECT_ROOT && npx @claude-flow/cli@latest memory search --query "prior work on X" --limit 5

# Store after a unit of work
cd PROJECT_ROOT && npx @claude-flow/cli@latest memory store --key "fix-auth" --value "Login validation done" --namespace my-project

# Store a lesson
cd PROJECT_ROOT && npx @claude-flow/cli@latest memory store --key "lesson-name" --value "One-line lesson" --namespace lessons
```

### Hooks (route, pre-task, post-task)

```bash
# Route before spawning agents or big edits (get model + agent-type hints)
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks route --task "Short description of what you're about to do"

# Pre-task: register this unit of work (use a stable id for post-task)
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks pre-task --task-id "fix-auth" --description "Harden login validation"

# Post-task: record outcome
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks post-task --task-id "fix-auth" --success true

# Model feedback: train the router (CRITICAL — without this, router defaults to Opus)
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks model-outcome --task "Harden login validation" --model sonnet --outcome success
```

**Model feedback matters:** The router starts biased toward Opus as a safe default. `model-outcome` records whether the chosen model actually succeeded. Over time this calibrates the router to trust Haiku/Sonnet for low-complexity tasks (currently 0% Haiku usage despite 33% avg complexity).

**Use both route outputs:** (1) **Model** — if route suggests Haiku/Sonnet/Opus, pass that when spawning (e.g. `model="haiku"` for simple tasks). (2) **Agent types** — route can suggest which agents to use (e.g. coder, reviewer, security-auditor, tester); spawn those. Examples: bug fix → researcher, coder, tester; security → coder, security-auditor; feature → architect, coder, tester, reviewer.

### SONA Learning (trajectory tracking)

SONA (Self-Optimizing Neural Architecture) learns which agent+action patterns lead to success. Without it, every session starts cold — no learning carries over.

```bash
# Start trajectory when beginning a unit of work (after pre-task)
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks intelligence trajectory-start --task "Harden login validation" --agent coder

# Record significant steps during work (not every micro-action — just milestones)
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks intelligence trajectory-step --trajectory-id "TRAJ_ID" --action "wrote implementation" --result "3 files changed" --quality 0.8
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks intelligence trajectory-step --trajectory-id "TRAJ_ID" --action "ran tests" --result "all passing" --quality 1.0

# End trajectory when unit of work is done (before post-task)
# This triggers EWC++ consolidation — learning is preserved across sessions
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks intelligence trajectory-end --trajectory-id "TRAJ_ID" --success true
```

**When to use trajectory-step:** Only for meaningful milestones — "wrote implementation", "ran tests", "fixed failing test", "security review passed". Not for every file read or small edit.

**TRAJ_ID** is returned by `trajectory-start`. Pass it to all subsequent step/end calls.

### Optional (when they fit)

```bash
# Hive-mind init (multi-phase, many batches)
cd PROJECT_ROOT && npx @claude-flow/cli@latest hive-mind init -t hierarchical -c raft -m 8

# Worker dispatch (background testgaps / audit)
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks worker-dispatch --trigger testgaps --context "core/"
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks worker-dispatch --trigger audit --priority critical
```

---

## What to use when

**Every session:** session-start → prewarm searches → memory search → for each unit of work: route → pre-task → trajectory-start → work → reviewer (and tester/security if needed) → build + test → trajectory-end → post-task → model-outcome → memory store → commit; then session-end.

**Only when they fit:** hive-mind init (multi-batch), worker dispatch (background checks), parallel coders, security auditor (security-sensitive batch), tester agent (test-heavy batch), trajectory-steps (for complex multi-action units of work).

---

## Minimal workflow (any task)

1. `cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks session-start --project "my-project"`
2. Prewarm HNSW cache (broad searches to load embeddings into memory):
   - `cd PROJECT_ROOT && npx @claude-flow/cli@latest memory search --query "patterns and lessons learned" --limit 10`
   - `cd PROJECT_ROOT && npx @claude-flow/cli@latest memory search --query "recent work and context" --limit 10`
3. `cd PROJECT_ROOT && npx @claude-flow/cli@latest memory search --query "relevant context for this task" --limit 5`
4. For **this** unit of work:
   - **route** → get model + agent-type hints
   - **pre-task** (stable task-id)
   - **trajectory-start** (returns TRAJ_ID)
   - do work using route's hints (Haiku for simple, Sonnet for moderate, Opus for complex)
   - optionally record **trajectory-steps** for major milestones
   - build + test
   - **trajectory-end** (TRAJ_ID, triggers EWC++ learning)
   - **post-task** (same task-id)
   - **model-outcome** (task description, model used, success/failure — trains the router)
   - **memory store** (same key as task-id)
   - commit
5. When fully done: `cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks session-end --export-metrics true`

Scale "unit of work" to the task: one fix = one task-id; a 6-batch migration = 6 task-ids (batch-1 … batch-6).
