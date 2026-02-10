# Current Hooks Architecture

This document describes the current hook configuration for this repo.

---

## Quick TL;DR

- **SessionStart**: Runs `session-preheat.sh` to warm search index
- **UserPromptSubmit**: Runs `session-preheat.sh` to keep search warm
- **PostToolUse**: Proto-sync check on `.proto` file edits
- **Index Maintainer**: Background daemon detects file changes and updates search index

---

## Hook Configuration

**Config:** `.claude/settings.json`

### Hook Reference

| Hook | Matcher | Command | Purpose |
|------|---------|---------|---------|
| `SessionStart` | `startup` | `session-preheat.sh` (bg) | Warm search index |
| `UserPromptSubmit` | (all) | `session-preheat.sh` (bg) | Keep search warm |
| `PostToolUse` | `Write\|Edit\|MultiEdit` | proto-sync check | Sync proto files on `.proto` edits |

---

## Session Preheat

**File:** `.claude/helpers/session-preheat.sh`

Runs on session start and each prompt to ensure the search index is warm:
- Warms embedding model singleton
- Loads vocabulary cache
- Starts index maintainer daemon if not running

---

## Index Maintainer Daemon

**File:** `.claude/hooks/index-maintainer.mjs`

Self-maintaining background daemon that keeps the search index current:

- **Detection**: Merkle hash comparison every 45 seconds
- **Catches**: Claude Code edits, external IDE edits, git operations
- **Updates**: FTS5 lexical index, HNSW semantic vectors, code graph
- **Lock**: `.agentdb/indexing.lock` prevents race with manual `/index-codebase`
- **Single-instance**: `.agentdb/index-maintainer.lock`

---

## Smart Search Performance

- **`ss`** (C binary, ~19KB): HTTP client only. Sends params to socket server. Fails fast if socket missing.
- **`ss.sh`** (bash wrapper): Auto-spawns `sweet-search.js --serve` if socket not present.
- First-run cost applies only to `ss.sh` or manual `node sweet-search.js --serve` startup.

---

## Proto-Sync Hook

On `.proto` file edits, automatically checks sync status between:
- `Sloth Web/Sloth-Local/src/main/proto`
- `Sloth Vita/biologger/src/main/proto`

**Script:** `.claude/helpers/proto-sync.sh check`
