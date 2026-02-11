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

# End session and export metrics
cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks session-end --export-metrics true
```

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
```

**Use both route outputs:** (1) **Model** — if route suggests Haiku/Sonnet/Opus, pass that when spawning (e.g. `model="haiku"` for simple tasks). (2) **Agent types** — route can suggest which agents to use (e.g. coder, reviewer, security-auditor, tester); spawn those. Examples: bug fix → researcher, coder, tester; security → coder, security-auditor; feature → architect, coder, tester, reviewer.

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

**Every session:** session-start → memory search → for each unit of work: route → pre-task → work → reviewer (and tester/security if needed) → build + test → post-task → memory store → commit; then session-end.

**Only when they fit:** hive-mind init (multi-batch), worker dispatch (background checks), parallel coders, security auditor (security-sensitive batch), tester agent (test-heavy batch).

---

## Minimal workflow (any task)

1. `cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks session-start --project "my-project"`
2. `cd PROJECT_ROOT && npx @claude-flow/cli@latest memory search --query "relevant context" --limit 5`
3. For **this** unit of work: **route** → **pre-task** (stable task-id) → do work using **route’s model + agent-type hints** (e.g. Haiku for simple, Sonnet for complex; coder + reviewer, or coder + security-auditor when route suggests it) → build + test → **post-task** → **memory store** (same key as task-id) → commit.
4. When fully done: `cd PROJECT_ROOT && npx @claude-flow/cli@latest hooks session-end --export-metrics true`

Scale “unit of work” to the task: one fix = one task-id; a 6-batch migration = 6 task-ids (batch-1 … batch-6).
