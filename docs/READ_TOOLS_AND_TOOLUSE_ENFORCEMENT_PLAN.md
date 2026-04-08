# Read Tools & Tool-Use Enforcement Plan

**Created**: 2026-04-08
**Status**: Draft
**Depends on**: INIT_STRATEGY.md (Phase 10 extension)

---

## Problem Statement

AI coding agents (Claude Code, Codex, Cursor, Windsurf) default to native `rg` + `Read` workflows
for code exploration. This is suboptimal when sweet-search is installed:

1. **Native Grep is slower** — sweet-search's trigram-indexed grep is 9.9x median faster than rg.
2. **Native Read is wasteful** — agents read full files (50-150ms per call, full token payload)
   when they only need a few relevant chunks.
3. **No semantic awareness** — native tools can't rank results by relevance to the agent's actual
   question, forcing sequential read-scan-filter loops.
4. **No agent alignment** — agents aren't told sweet-search exists. The system prompt says
   "use Grep" and "use Read" — agents obey literally.

This plan adds CLI-first read and path tools, MCP wrappers over the same implementation, and
an agent alignment phase in `sweet-search init` that strongly steers agents toward sweet-search
without relying on impossible in-process tool swaps.

---

## Part 1: Read & Path Tools

### 1A — `sweet-search read` (Filesystem-Grounded File Reader)

**Goal**: Beat native Read on real-world latency while preserving exact file contents.

**Source of truth**: The filesystem, not the `vectors` table.

Rationale:
- The current `vectors.text` payload is truncated to 2000 chars during indexing.
- Metadata is useful for chunk boundaries and symbol labels, but not sufficient to reconstruct
  a file faithfully.
- `sweet-search read` must never be lossy. It should return exact bytes/lines from disk.

**CLI interface**:
```bash
# Single file — all chunks
sweet-search read src/auth/service.ts

# Multiple files
sweet-search read src/auth/service.ts src/auth/middleware.ts

# Exact line range
sweet-search read src/auth/service.ts --lines 45-92

# Agent format (default when called via MCP)
sweet-search read src/auth/service.ts --agent

# Batch exact reads
sweet-search read src/auth/service.ts src/auth/middleware.ts src/auth/types.ts

# JSON output
sweet-search read src/auth/service.ts --json
```

**MCP tool registration** (in `mcp/server.js`):
```javascript
server.registerTool('read', {
  description: 'Read one or more files for exact code understanding. Replaces the default Read '
    + 'tool for most code-reading workflows. Uses the filesystem as ground truth, supports line '
    + 'ranges and batching, and can attach symbol-aware chunk metadata when the file is indexed.',
  inputSchema: {
    files: z.array(z.object({
      path: z.string().describe('File path relative to project root'),
      startLine: z.number().int().optional().describe('Start line (1-based)'),
      endLine: z.number().int().optional().describe('End line (1-based)'),
    })).min(1).max(20).describe('Files to read'),
    format: z.enum(['raw', 'chunks', 'agent']).default('chunks')
      .describe('"chunks" returns symbol-aware chunks with metadata. "agent" returns formatted code blocks. "raw" returns plain text.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
});
```

**Implementation path** (`core/search/search-read.js`):

1. Read exact file contents from disk.
2. If a line range was requested, slice the exact lines from the in-memory text.
3. If the file is indexed, query `vectors` by `file_path` to attach symbol/chunk metadata only.
4. Return exact text plus optional structural metadata:

```json
{
  "file": "src/auth/service.ts",
  "language": "typescript",
  "totalLines": 247,
  "exact": true,
  "chunks": [
    {
      "symbol": "AuthService",
      "type": "class",
      "startLine": 12,
      "endLine": 45,
      "text": "export class AuthService { ... }",
      "signature": "class AuthService"
    },
    {
      "symbol": "authenticate",
      "type": "method",
      "startLine": 47,
      "endLine": 92,
      "text": "async authenticate(token: string) { ... }",
      "signature": "authenticate(token: string): Promise<User>"
    }
  ],
  "indexed": true
}
```

5. **Unindexed files**: Still work normally. Return exact text with `"indexed": false`.
6. **Batch mode**: Accept up to 20 files, read all in parallel (`Promise.all`), return array.
   Single MCP call replaces 20 sequential native Read calls.
7. **Optional acceleration**:
   - warm-process file cache keyed by `path + mtimeMs`
   - precomputed line offset tables for fast line slicing
   - range reads for large files to avoid materializing full content when only spans are needed

**Expected performance**:

| Scenario | Native Read | sweet-search read | Speedup |
|----------|-------------|-------------------|---------|
| 1 file | benchmark required | benchmark required | target: better than native |
| 1 file with line range | benchmark required | benchmark required | target: materially better |
| 20 files (batch) | benchmark required | benchmark required | target: clearly better |

Do not claim speedups until measured. The likely win comes from batching, exact range reads,
avoiding repeated harness overhead, and optional warm-process caching.

---

### 1B — `sweet-search read-semantic` (Semantic Chunk Reader)

**Goal**: Massive token reduction without ever returning truncated chunk text.

**CLI interface**:
```bash
# Read only authentication-relevant parts of a file
sweet-search read-semantic src/auth/service.ts "how does token refresh work"

# With threshold control
sweet-search read-semantic src/server.ts "error handling" --threshold 0.6
```

**MCP tool registration** (in `mcp/server.js`):
```javascript
server.registerTool('read-semantic', {
  description: 'Read a file and return only the chunks semantically relevant to a query. '
    + 'Returns exact code spans from disk, selected by semantic relevance. Uses the late-'
    + 'interaction index only for chunk selection, then reads the chosen spans from the '
    + 'filesystem to avoid truncation or lossy reconstruction.',
  inputSchema: {
    file: z.string().describe('File path relative to project root'),
    query: z.string().min(1).max(500).describe('What you want to understand about this file'),
    topK: z.number().int().min(1).max(20).default(5)
      .describe('Maximum chunks to return (default: 5)'),
    threshold: z.number().min(0).max(1).default(0.4)
      .describe('Minimum similarity threshold (default: 0.4)'),
    format: z.enum(['chunks', 'agent']).default('agent')
      .describe('"agent" returns formatted code blocks. "chunks" returns structured metadata.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
});
```

**Implementation path** (`core/search/search-read-semantic.js`):

1. Load the file's chunk embeddings and spans from the late-interaction index.
2. Encode query via `encodeQuery()` from `late-interaction-model.js` (5-50ms ONNX inference).
3. Compute MaxSim between query tokens and each chunk's token embeddings using the existing
   three-tier acceleration stack:
   - Tier 1: Native Rust + Rayon (`nativeMaxSimBatch`) — 0.1-0.3ms
   - Tier 2: WASM SIMD f32x4 (`wasmMaxSimDequant`) — 1-3ms
   - Tier 3: JS fallback (`float32BatchDot`) — 5-15ms
4. Filter by threshold, sort by score, select top-k chunk spans.
5. Read the exact line spans for those chunks from the filesystem.
6. Merge adjacent or overlapping spans to reduce duplicate reads and token waste.
7. Return exact code spans with metadata and relevance scores.
8. If the late-interaction index isn't loaded yet, lazy-load it (100-500ms one-time cost;
   subsequent calls are instant). The model/index should be prewarmed at MCP server startup
   alongside the existing `vocab-prewarm` path.

**Expected performance**:

| Operation | Latency |
|-----------|---------|
| Index lookup (in-memory) | <1ms |
| Query encoding (ONNX) | 5-50ms |
| MaxSim scoring (20 chunks, native) | 0.1-0.3ms |
| MaxSim scoring (20 chunks, WASM) | 1-3ms |
| MaxSim scoring (20 chunks, JS) | 5-15ms |
| **Total (typical, native tier)** | **6-56ms** |

**Token savings**:

| File size | Native Read tokens | Semantic read tokens | Reduction |
|-----------|-------------------|---------------------|-----------|
| 200 lines | ~800 | ~200 (3 chunks) | 75% |
| 400 lines | ~1600 | ~300 (4 chunks) | 81% |
| 800 lines | ~3200 | ~400 (5 chunks) | 87% |

**Fallback**:
- If the file has no late-interaction entries, fall back to `sweet-search read`.
- If a selected span cannot be read from disk, fail the request rather than silently returning
  lossy DB text.

---

### 1C — `sweet-search files` (Path/Glob Search)

**Goal**: Replace native `Glob` for most code path discovery tasks with a CLI-first path index.

`Glob` is not a content search tool. It is a filename and directory pattern matcher. It should
not be conflated with `grep`.

**CLI interface**:
```bash
# Fast path lookup by glob
sweet-search files "src/**/*.ts"

# Find auth-related files
sweet-search files "**/*auth*"

# Restrict by extension and limit
sweet-search files "tests/search/**/*.test.js" --top 50
```

**Design**:
1. Build a path index during indexing or warm startup:
   - basename trigram index
   - path segment index
   - extension index
2. Use the index to get a small candidate set for the glob.
3. Run exact glob verification only on the candidate set.
4. Return matching paths quickly, with optional metadata (language, indexed, size).

This should reuse the spirit of `docs/GREP_INDEXING_STRATEGY.md`, but tuned for path tokens,
not file content grams.

---

### 1D — CLI Dispatch Integration

Add `read`, `read-semantic`, and `files` to the CLI dispatcher in `core/cli.js`:

```javascript
// Package-management commands always run in JS (never native dispatch)
if (args[0] === 'init') {
  // ... existing
} else if (args[0] === 'read') {
  const { handleReadCli } = await import('./search/search-read.js');
  await handleReadCli(args.slice(1));
} else if (args[0] === 'read-semantic') {
  const { handleReadSemanticCli } = await import('./search/search-read-semantic.js');
  await handleReadSemanticCli(args.slice(1));
} else if (args[0] === 'files') {
  const { handleFilesCli } = await import('./search/search-files.js');
  await handleFilesCli(args.slice(1));
} else if (args[0] === 'uninstall') {
  // ... existing
}
```

These commands always run in JS initially. `read` is filesystem-grounded; `read-semantic`
needs the late-interaction model; `files` needs the path index. Future native dispatch is an
optimization, not a requirement for correctness.

---

## Part 2: Agent Alignment

### 2A — CLAUDE.md / AGENTS.md Injection

**Goal**: Tell agents to use sweet-search tools instead of native Grep/Read/Glob.

**Mechanism**: During `sweet-search init`, inject standardized guidance into the project's
instruction files.

**Canonical source for Claude Code**:
- `CLAUDE.md` is the Claude Code source of truth.
- If `AGENTS.md` exists and the user wants a shared instruction body across tools, inject the
  sweet-search block into `AGENTS.md` and add `@AGENTS.md` near the top of `CLAUDE.md`.
- If only `CLAUDE.md` exists, inject there directly.
- If both exist and are independent, inject into both.
- If one is a symlink to the other, edit only the real source file.
- If neither file exists, create `CLAUDE.md` only.

**Symlink awareness**: Before writing, check if either file is a symlink to the other:
```javascript
import { lstatSync, readlinkSync } from 'node:fs';

function resolveInstructionTarget(projectRoot) {
  const claudeMd = join(projectRoot, 'CLAUDE.md');
  const agentsMd = join(projectRoot, 'AGENTS.md');

  const claudeIsSymlink = existsSync(claudeMd) && lstatSync(claudeMd).isSymbolicLink();
  const agentsIsSymlink = existsSync(agentsMd) && lstatSync(agentsMd).isSymbolicLink();

  // If one is a symlink to the other, only write to the source of truth
  if (claudeIsSymlink) {
    const target = readlinkSync(claudeMd);
    if (target === 'AGENTS.md' || target === './AGENTS.md') {
      return { write: [agentsMd], skip: [claudeMd], reason: 'CLAUDE.md symlinks to AGENTS.md' };
    }
  }
  if (agentsIsSymlink) {
    const target = readlinkSync(agentsMd);
    if (target === 'CLAUDE.md' || target === './CLAUDE.md') {
      return { write: [claudeMd], skip: [agentsMd], reason: 'AGENTS.md symlinks to CLAUDE.md' };
    }
  }

  // Both are regular files (or only one exists) — write to both
  return { write: [claudeMd, agentsMd], skip: [], reason: null };
}
```

**Instruction block** (injected at the top of each file, wrapped in markers for idempotent
re-injection):

```markdown
<!-- sweet-search:agent-instructions:begin -->
## Search & File Reading (sweet-search — MANDATORY)

This project uses **sweet-search** for all code search and file reading. These tools are
faster and more capable than the built-in defaults.

### Tool Replacement Rules

| Instead of... | Use... | Why |
|--------------|--------|-----|
| `Grep` / `rg` for code search | `sweet-search <query>` or `sweet-search grep <pattern>` | Faster indexed search, ColGrep, semantic reranking |
| `Glob` for code path discovery | `sweet-search files "<glob>"` | Fast indexed path matching |
| `Read` to understand code | `sweet-search read <file>` | Exact filesystem-backed read, batchable |
| `Read` to understand specific parts | `sweet-search read-semantic <file> "<question>"` | Returns exact relevant spans only |
| structural/code graph questions | `sweet-search "<query>" --mode structural` | Uses graph traversal for callers/callees/implementations/impact |

### When native tools are still OK
- `Read` before `Edit` (required by the harness for edit verification)
- `Read` for non-code files (configs, docs, images)
- `Glob` for file existence checks or listing directories

### Examples

```bash
# Instead of: Grep "authentication" → Read each result
sweet-search "authentication" --agent

# Instead of: Grep "class.*Service" → Read matches
sweet-search grep "class\s+Service" --agent

# Instead of: Glob "src/**/*auth*"
sweet-search files "src/**/*auth*"

# Instead of: Read src/auth/service.ts (all 400 lines)
sweet-search read-semantic src/auth/service.ts "token refresh logic"

# Batch read multiple files (1 call, not 5)
sweet-search read src/auth/service.ts src/auth/middleware.ts src/auth/types.ts

# Structural query
sweet-search "who calls authenticate" --mode structural
```
<!-- sweet-search:agent-instructions:end -->
```

**Injection logic**:
- If the marker block already exists, replace it in-place (idempotent).
- If the file exists but has no marker, prepend the block before the first `#` heading.
- If no instruction file exists yet, create `CLAUDE.md` with the block + a minimal project header.
- Never modify content outside the marker block.

---

### 2B — PreToolUse Hook Interception (Opt-in via `--enforce-tools`)

**Goal**: Add enforcement where Claude Code supports it, without assuming impossible tool swaps.

**Opt-in flag**: `sweet-search init --enforce-tools`

Important constraint:
- In normal interactive Claude Code, project hooks cannot transform a `Grep` tool call into a
  `Bash` tool call running `sweet-search`.
- `PreToolUse` can rewrite the input of the same tool, add context, allow, deny, or block.
- Therefore `Grep -> sweet-search Bash` is not achievable purely inside repo hooks.

When enabled, init adds Claude-specific guardrails to `.claude/settings.json`:

```json
{
  "permissions": {
    "deny": [
      "Grep(*)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Read$",
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/sweet-search/scripts/hooks/intercept-read.mjs \"$TOOL_INPUT_file_path\"",
            "timeout": 3000,
            "continueOnError": true
          }
        ]
      }
    ]
  }
}
```

**Hook scripts** (shipped in `scripts/hooks/`):

#### `scripts/hooks/intercept-read.mjs`

For Read calls, the strategy is more nuanced. We can't fully block Read because
agents need it before Edit (the harness requires a prior Read). Strategy:

```javascript
#!/usr/bin/env node
// Intercept native Read. Allow if it's a pre-edit read or non-code file.
// Suggest sweet-search read for pure code-understanding reads.

import { extname } from 'node:path';

const filePath = process.argv[2] || process.env.TOOL_INPUT_file_path || '';
const ext = extname(filePath).toLowerCase();

const codeExtensions = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rs', '.go', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.swift',
  '.kt', '.scala', '.vue', '.svelte',
]);

// Allow non-code files (configs, docs, images) — sweet-search doesn't index these
if (!codeExtensions.has(ext)) {
  process.exit(0); // allow
}

// Allow — but emit a hint to stderr that sweet-search read would be faster.
// We don't block Read because the agent may need it for an upcoming Edit.
// The CLAUDE.md instructions are the primary enforcement; this is a gentle nudge.
console.error(
  `[sweet-search] Hint: For reading code files, \`sweet-search read ${filePath}\` ` +
  `returns exact filesystem-backed output and supports batching/ranges. ` +
  `Use \`sweet-search read-semantic ${filePath} "<query>"\` when you only need the relevant spans.`
);

process.exit(0); // allow (Read is needed for edit workflows)
```

**Settings.json merge logic**: The init script must merge into existing `.claude/settings.json`
without clobbering other hooks (like the agentic-qe hooks already there). Strategy:

1. Read existing settings.json (or `{}`).
2. Parse `hooks.PreToolUse` array.
3. Parse `permissions.deny` and `permissions.ask`.
4. Check if sweet-search-managed entries already exist by marker comment or command path.
5. If not present, append. If present, update in-place.
6. Write back atomically (`.tmp` + rename).

**Removal**: `sweet-search uninstall` removes these hooks and settings entries if present.

---

### 2C — UserPromptSubmit Reminder Hook (Default-On)

**Goal**: Keep sweet-search tool selection fresh in the agent's active context on every prompt.

Why this matters:
- It costs roughly ~200 tokens per prompt, which is negligible relative to avoided bad tool use.
- It avoids the failure mode where the agent read the project instructions once and then drifts
  back to native `Grep` + `Read`.
- It works before the first tool call, which is where most bad routing starts.

During `sweet-search init`, add a `UserPromptSubmit` hook to `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/sweet-search/scripts/hooks/remind-tools.mjs --prompt \"$PROMPT\" --json",
            "timeout": 2000,
            "continueOnError": true
          }
        ]
      }
    ]
  }
}
```

`remind-tools.mjs` should emit a concise reminder payload:
- use `sweet-search grep` / `sweet-search <query>` for content search
- use `sweet-search files` for path/glob matching
- use `sweet-search read` for exact code reading
- use `sweet-search read-semantic` when the question is narrow
- use structural mode for callers/callees/implementations/impact

This is not a hard block. It is a low-friction, high-ROI behavioral nudge.

---

### 2D — MCP Tool Description Optimization

**Goal**: Make tool descriptions trigger agent selection by matching the agent's intent vocabulary.

Current description:
> "Search the codebase using hybrid semantic/lexical/structural search."

This tells the agent *what the tool is*, not *what it replaces*. Agents match intent
("I need to search file contents") to descriptions.

**Updated descriptions**:

```javascript
// search tool
'Search file contents in the codebase. Replaces grep/ripgrep. '
+ 'Supports regex patterns (ColGrep), semantic search, structural queries (callers/callees), '
+ 'and hybrid mode. Returns complete code blocks with format="agent" — no follow-up file reads needed.'

// read tool
'Read one or more files with exact filesystem-backed output. Replaces the default Read tool '
+ 'for most code-understanding workflows. Supports ranges, batching, and indexed metadata.'

// read-semantic tool
'Read only the parts of a file relevant to a query. Uses the semantic index to choose spans, '
+ 'then reads exact lines from disk. Returns 3-5 semantically matched chunks instead of the full file.'

// files tool
'Find files and directories by path pattern. Replaces most Glob usage for code path discovery. '
+ 'Uses indexed basename/path matching and exact glob verification on candidates.'
```

Key phrases that drive selection:
- "Search file contents" mirrors the system prompt's Grep description
- "Replaces grep/ripgrep" and "Replaces the default Read tool" — explicit displacement signals
- "no follow-up file reads needed" — tells the agent the workflow is complete in one call

---

### 2E — External Wrapper Rerouting (Future, not Phase 1)

**Goal**: Preserve the idea of transparent rerouting, but place it where it is technically possible.

If sweet-search later ships an external Claude wrapper or SDK-based control loop, that layer can:
1. observe attempted `Grep` / `Read` usage
2. classify intent
3. run the appropriate `sweet-search` CLI command
4. return the result without requiring a failed in-app tool step

This is the only place where true `Grep -> sweet-search Bash` rerouting is realistic.

Do not design Phase 1 around capabilities that do not exist in normal repo-local Claude hooks.

---

## Part 3: Init Integration

All of Part 2 integrates into `scripts/init.js` as new steps after the existing step 10
(index-maintainer hook installation).

### Updated init flow:

```
1.  Check Node.js version                          (existing)
2.  Detect project root                             (existing)
3.  Create .sweet-search/ directory                 (existing)
4.  Resolve profile                                 (existing)
5.  Verify runtime assets                           (existing)
6.  Check native status                             (existing)
7.  Download models                                 (existing)
8.  Write config                                    (existing)
9.  Run verification                                (existing)
10. Install index-maintainer daemon hook             (existing)
11. Inject agent instructions into CLAUDE.md/AGENTS.md   (NEW — Part 2A)
12. Install UserPromptSubmit reminder hook            (NEW — Part 2C, default-on)
13. Install tool-enforcement settings/hooks          (NEW — Part 2B, only with --enforce-tools)
14. Print report                                     (existing, updated)
```

### New init flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--enforce-tools` | `false` | Install Claude-specific deny/settings enforcement for native Grep plus Read hints |
| `--no-agent-instructions` | `false` | Skip CLAUDE.md/AGENTS.md injection |
| `--no-prompt-reminders` | `false` | Skip the `UserPromptSubmit` sweet-search reminder hook |

### Updated report:

```
Sweet Search init complete

  Profile:              full
  MaxSim:               native
  Router:               wasm
  Late interaction:     init-managed cache
  Reranker:             init-managed cache
  Runtime downloads:    disabled
  Agent instructions:   injected into CLAUDE.md, AGENTS.md
  Prompt reminders:     enabled
  Tool enforcement:     enabled (Grep denied, Read hinted)
  Verification:         fast-pass (27/27)
```

---

## Implementation Order

| Phase | What | Effort | Depends on |
|-------|------|--------|------------|
| **P1** | `sweet-search read` CLI + MCP tool, filesystem-grounded | 4-6h | none |
| **P2** | `sweet-search read-semantic` exact-span CLI + MCP tool | 4-6h | P1 + late-interaction index |
| **P3** | `sweet-search files` path/glob CLI + MCP tool | 4-6h | path-index design |
| **P4** | CLAUDE.md/AGENTS.md injection in init | 2-3h | tool names finalized |
| **P5** | `UserPromptSubmit` reminder hook | 1-2h | P4 |
| **P6** | strict Claude enforcement mode (`permissions` + Read hint hook) | 2-3h | P4 |
| **P7** | MCP/tool description rewrite | 30-60m | P1-P3 |
| **P8** | uninstall cleanup for all init-owned mutations | 1-2h | P4-P6 |
| **P9** | benchmarks + eval harness + tests | 4-6h | P1-P8 |
| **P10** | DSPy optimization of CLAUDE.md/AGENTS.md and `UserPromptSubmit` prompt guardrails | 6-10h | P9 |
| **P11** | integrate DSPy-optimized prompt artifacts into init and verify on eval set | 2-4h | P10 |

**Total estimated effort**: 30-46h

---

## Files to Create

| File | Purpose |
|------|---------|
| `core/search/search-read.js` | `read` command implementation |
| `core/search/search-read-semantic.js` | `read-semantic` command implementation |
| `core/search/search-files.js` | `files` command implementation |
| `scripts/hooks/intercept-read.mjs` | PreToolUse hook: hint on native Read |
| `scripts/hooks/remind-tools.mjs` | `UserPromptSubmit` reminder hook |
| `scripts/inject-agent-instructions.js` | CLAUDE.md/AGENTS.md injection logic |
| `tests/search/search-read.test.js` | Tests for read tool |
| `tests/search/search-read-semantic.test.js` | Tests for read-semantic tool |
| `tests/search/search-files.test.js` | Tests for path/glob tool |
| `tests/init/agent-instructions.test.js` | Tests for injection + symlink handling |
| `tests/init/prompt-reminders.test.js` | Tests for `UserPromptSubmit` integration |

## Files to Modify

| File | Change |
|------|--------|
| `core/cli.js` | Add `read`, `read-semantic`, and `files` subcommand dispatch |
| `mcp/server.js` | Register `read`, `read-semantic`, and `files` MCP tools |
| `mcp/tool-handlers.js` | Add handler functions for new tools |
| `scripts/init.js` | Steps 11-13: agent instructions + prompt reminders + optional enforcement |
| `scripts/uninstall.js` | Remove injected instructions and all sweet-search-managed hook/settings entries |
| `core/search/index.js` | Export new modules from barrel |
| `docs/INIT_STRATEGY.md` | Update uninstall contract to include init-owned instruction/settings reversal |

---

## Deferred Follow-Up: `INIT_STRATEGY.md`

Do not edit `docs/INIT_STRATEGY.md` as part of this plan's implementation unless explicitly
requested. When it is updated later, make the following changes so it matches the finalized init
and uninstall behavior.

### Required updates

1. Update the init flow section to add:
   - agent instruction injection into `CLAUDE.md` / `AGENTS.md`
   - default-on `UserPromptSubmit` sweet-search reminder hook
   - opt-in Claude-specific enforcement via `.claude/settings.json`

2. Update the init flags table to add:
   - `--enforce-tools`
   - `--no-agent-instructions`
   - `--no-prompt-reminders`

3. Update the init success report example to mention:
   - whether agent instructions were injected
   - whether prompt reminders were installed
   - whether strict enforcement was enabled

4. Update the uninstall section so it no longer claims uninstall only touches `.sweet-search/`,
   the model cache, and optional `node_modules`.

5. Replace that uninstall contract with the correct one:
   - uninstall removes all sweet-search-managed mutations created by `sweet-search init`
   - this includes marker-wrapped blocks injected into `CLAUDE.md` / `AGENTS.md`
   - this includes sweet-search-managed entries added to `.claude/settings.json`
   - uninstall must only remove sweet-search-owned content, never unrelated user content
   - uninstall must remain idempotent and safe when files were manually edited later

6. Add a short note that:
   - `CLAUDE.md` is the Claude Code source of truth
   - `AGENTS.md` may also be updated for cross-agent compatibility
   - symlinked instruction files must be handled by editing only the source of truth

7. Add a short note that repo-local Claude hooks cannot transparently convert a `Grep` tool call
   into a `Bash` call, so strict enforcement is based on settings/permissions plus reminders,
   not in-process tool-type rerouting.

### Suggested wording change for uninstall constraints

Replace the current uninstall constraint language with something equivalent to:

> Never deletes user source code, indexes, or databases. May reverse sweet-search-managed
> instruction and Claude settings mutations created during `sweet-search init`, but only the
> marker-scoped blocks and settings entries owned by sweet-search.

### Dependency note

`docs/INIT_STRATEGY.md` should be updated only after:
- the exact init flags are finalized
- the marker format for instruction injection is finalized
- the `.claude/settings.json` merge/remove strategy is finalized

This keeps the strategy doc aligned with the implemented behavior rather than documenting
speculative details too early.

---

## Design Decisions

### Why CLI-first, not MCP-only?

MCP adoption is plateauing — agents are moving toward Bash tool execution. The CLI
is the universal interface: it works in Claude Code (via Bash), Codex (via shell),
Cursor, Windsurf, and any future agent. MCP registration is maintained as a
convenience layer that delegates to the same underlying implementation.

### Why filesystem for `read`?

The vectors table is not a faithful read store today. It truncates chunk text. Exact code reads
must come from disk. Indexed metadata is an accelerator, not the source of truth.

### Why not fully block Read?

The Claude Code harness requires `Read` before `Edit`. Blocking Read would break
every edit workflow. Instead: CLAUDE.md instructions discourage Read for understanding,
the hook emits a hint to stderr, and `read-semantic` provides a clearly better alternative.

### Why not use a Grep hook that redirects to Bash?

Because normal repo-local Claude hooks cannot change the tool type from `Grep` to `Bash`.
True transparent rerouting requires an external wrapper around Claude, not an in-project hook.

### Why add a `UserPromptSubmit` reminder?

Because it operates before tool selection and keeps the preferred sweet-search workflow active
in the model's short-term context. The token cost is low relative to the cost of repeated
bad `Grep` + `Read` behavior.

### Why markers in CLAUDE.md?

Markers (`<!-- sweet-search:agent-instructions:begin/end -->`) enable:
- Idempotent re-injection on `sweet-search init` re-runs
- Clean removal on `sweet-search uninstall`
- User edits outside the block are preserved
- Version upgrades can update the block without conflict

### Why `--enforce-tools` is opt-in?

Strict enforcement is Claude Code-specific and opinionated. Some users may prefer soft guidance
plus prompt reminders only. Enterprise deployments may have their own settings policies.

### Why DSPy is mandatory

The injected `CLAUDE.md` / `AGENTS.md` block and the `UserPromptSubmit` reminder are the primary
guardrails for the entire system. Because the success of tool selection depends heavily on the
quality of those prompts, they should be optimized systematically rather than hand-tuned once and
left to drift.

DSPy should be used after there is an eval set covering:
- sweet-search tool selection rate
- native `Grep` / `Read` fallback rate
- end-to-end task success
- latency
- token usage

Use DSPy to optimize:
- the injected instruction block for `CLAUDE.md`
- the injected instruction block for `AGENTS.md`
- the `UserPromptSubmit` reminder payload

Constraints:
- optimization is offline only
- no DSPy dependency in the runtime path
- every optimized prompt variant must be validated on the eval set before adoption
