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
- If sweet-search writes `.claude/rules/sweet-search.md`, `CLAUDE.md` should import it via
  `@.claude/rules/sweet-search.md`.
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

### 2A½ — `.claude/rules/sweet-search.md` (Imported Support File)

**Goal**: Keep the sweet-search tool-routing instructions in a dedicated file under `.claude/`
while relying only on documented Claude Code memory/import behavior.

**Important correction**:
- Anthropic's official Claude Code docs document automatic loading for `CLAUDE.md` files and
  support `@path` imports from `CLAUDE.md`.
- This plan does **not** assume `.claude/rules/*.md` is auto-loaded by Claude Code unless that
  behavior is independently verified later.
- Therefore `.claude/rules/sweet-search.md` should be treated as a support file that Claude Code
  sees via `CLAUDE.md` import, not as an independently guaranteed rules channel.

**Why both an imported rules file and CLAUDE.md?**

- `.claude/rules/sweet-search.md` gives sweet-search a clean, fully owned file with no marker
  replacement complexity.
- `CLAUDE.md` remains the documented Claude Code source of truth and imports the rules file
  using `@.claude/rules/sweet-search.md`.
- `CLAUDE.md` / `AGENTS.md` injection (Part 2A) still covers non-Claude agents (Cursor,
  Windsurf, Codex) that do not use Claude's import/memory system.
- This keeps the guidance modular for Claude Code while preserving cross-agent portability.

**File**: `.claude/rules/sweet-search.md`

**Load path**:
- `sweet-search init` writes `.claude/rules/sweet-search.md`
- `sweet-search init` ensures `CLAUDE.md` contains `@.claude/rules/sweet-search.md` near the top
- Claude Code then loads the file through the documented `CLAUDE.md` import mechanism

**Contents** (written verbatim by init):

```markdown
# sweet-search — Tool Replacement Rules

This project uses **sweet-search** for all code search and file reading.
These tools are faster and more capable than the built-in defaults.

## MANDATORY replacements

| Instead of... | Use... | Why |
|--------------|--------|-----|
| `Grep` / `rg` for code search | `sweet-search <query>` or `sweet-search grep <pattern>` | Faster indexed search, ColGrep, semantic reranking |
| `Glob` for code path discovery | `sweet-search files "<glob>"` | Fast indexed path matching |
| `Read` to understand code | `sweet-search read <file>` | Exact filesystem-backed read, batchable |
| `Read` to understand specific parts | `sweet-search read-semantic <file> "<question>"` | Returns exact relevant spans only |
| structural/code graph questions | `sweet-search "<query>" --mode structural` | Graph traversal for callers/callees/implementations/impact |

## When native tools are still OK

- `Read` before `Edit` (required by the harness for edit verification)
- `Read` for non-code files (configs, docs, images)
- `Glob` for file existence checks or listing directories

## Examples

```bash
# Content search (replaces Grep)
sweet-search "authentication" --agent
sweet-search grep "class\s+Service" --agent

# Path search (replaces Glob)
sweet-search files "src/**/*auth*"

# Semantic read (replaces Read for understanding)
sweet-search read-semantic src/auth/service.ts "token refresh logic"

# Batch read (1 call replaces N sequential Reads)
sweet-search read src/auth/service.ts src/auth/middleware.ts src/auth/types.ts

# Structural query
sweet-search "who calls authenticate" --mode structural
```
```

**Lifecycle**:
- `sweet-search init` creates `.claude/rules/sweet-search.md` (mkdir `.claude/rules/` if needed).
- `sweet-search init` re-runs overwrite the file idempotently (no markers needed — the entire
  file is sweet-search-owned).
- `sweet-search uninstall` deletes `.claude/rules/sweet-search.md`. If `.claude/rules/` is
  empty after deletion, remove the directory too. Never delete other rules files.

**Interaction with `--no-agent-instructions`**:
- `--no-agent-instructions` skips both the `CLAUDE.md` injection (2A) and the rules file (2A½).
  It also skips adding the `@.claude/rules/sweet-search.md` import to `CLAUDE.md`.
  They are part of the same logical feature: agent instruction placement.

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

### 2F — Optimized Agent Search Policy (Benchmark-Derived)

**Goal**: Ship a real tool-routing policy, not only replacement rules.

The first agent-in-the-loop benchmarks showed that "use sweet-search instead of Grep/Read" is
too vague. Agents only started using the tools well after the prompt taught a concrete decision
tree, stopping criteria, citation discipline, and anti-overfetch rules. This policy should become
the default content written to `.claude/rules/sweet-search.md`, imported into `CLAUDE.md`, and
mirrored in prompt reminder hooks.

#### Why this is separate from enforcement

Enforcement answers: "which tools are allowed?"

The optimized search policy answers: "which sweet-search tool should I choose for this task, what
query shape should I use, how many results should I inspect, when should I read, and when should I
stop?"

The latter is the higher-leverage behavior. A compliant agent can still perform poorly if it calls
`read-semantic` on five files, uses vague queries, re-searches endlessly, or cites broad/irrelevant
files. The benchmark harness should treat the policy text as a versioned artifact.

#### Default tool-routing decision tree

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
   - CLI/API wrapper: `ss-find "<natural-language question>" --regex "<broad-but-relevant-regex>" -k 5`
   - Query shape: natural-language intent + a broad regex anchor (function names, error family,
     option name, lifecycle term). Do not use a regex that matches the whole repo.

3. General conceptual search with no obvious literal:
   - Use `sweet-search "<short intent query>" --agent` in hybrid/auto mode.
   - Query shape: one concise sentence naming the concept and likely domain words.
   - If results are broad, refine once with a more concrete term or switch to structural mode.

4. Callers, callees, implementations, impact, inheritance, or dependency questions:
   - Use structural search.
   - CLI: `sweet-search "who calls <symbol>" --mode structural --agent`
   - Query shape: include the exact symbol plus relationship word (`calls`, `called by`,
     `implements`, `extends`, `imports`, `impact`).

5. Path/name discovery:
   - Use path search once implemented.
   - CLI: `sweet-search files "<glob-or-path-pattern>"`
   - Query shape: path-like pattern, basename, extension, or directory segment.

6. Exact file/range already known:
   - Use exact read.
   - CLI: `sweet-search read <file> --lines <start-end>`
   - Agent wrapper: `ss-read <file> <start> <end>`
   - Prefer ranges over whole files.

7. File is known but relevant span is unclear:
   - Use semantic read once for that file.
   - CLI: `sweet-search read-semantic <file> "<question>" --max-tokens 800`
   - Agent wrapper: `ss-semantic <file> "<question>" --max-tokens 800`
   - Do not call semantic read on multiple files unless the task is explicitly multi-file.
```

#### Stopping and citation rules

```markdown
## Stopping Rules

- Inspect only the top 3-5 discovery results.
- If a discovery result already returns a tight chunk/range that answers the question, cite it and stop.
- If the first discovery call returns nothing, broaden once. If still empty, report no match.
- Do not re-search merely to double-check.
- Do not read broad files after a tight chunk already answers the task.
- Prefer 1-3 high-confidence citations over long citation lists.

## Citation Rules

- Every distinct source file that supports the answer must appear as its own citation.
- If the prose names a file, imports from it, relies on a function in it, or cites behavior from it,
  that file must be cited with a line range.
- For multi-file flows, cite one range per required file.
- Do not mention supporting files only in prose or notes.
```

#### Query-shape research is a prerequisite

The current plan should not assume one optimal query style. Each sweet-search tool likely has a
different optimal query distribution:

| Tool | Query-shape questions to benchmark |
|------|------------------------------------|
| `sweet-search` auto/hybrid | short keyword vs long natural-language vs symbol+intent; when CatBoost routes best |
| indexed grep / `ss-grep` | literal regex specificity, top-k, context lines, rare-token anchoring |
| ColGrep / `ss-find` | natural-language query length, broad vs narrow regex anchor, regex family, k |
| structural mode | relationship words, exact symbol requirements, multi-hop wording |
| `read-semantic` | question length, symbol inclusion, max tokens, threshold, context lines, topK |
| `read` | range size, batching, chunk metadata usefulness |
| `files` | glob-like vs natural path terms, basename vs segment matching |

The default system prompt should be generated from benchmark findings, not intuition. Add a
query-shape benchmark suite before freezing the prompt text for `sweet-search init`.

---

### 2G — Query-Shape Benchmark Before Prompt Evolution

**Goal**: Learn the optimal query grammar for each sweet-search tool before evolving the general
agent system prompt.

The agent policy in Part 2F should start as a hand-written baseline, but it must not be treated as
final until we know which query shapes actually work best. Without this step, GEPA/DSPy may evolve
the system prompt around wrong assumptions such as "long semantic queries are always better" or
"ColGrep should always use broad regex anchors."

#### Why this comes before general prompt evolution

System prompts encode rules. If the rules are wrong, optimization will only make the agent more
consistent at using the wrong strategy. Query-shape benchmarking isolates each tool and answers
lower-level questions first:

- What query strings maximize recall?
- What query strings maximize precision?
- What query strings minimize follow-up reads?
- Which query styles cause CatBoost to route correctly?
- Which query styles cause `read-semantic` to return enough evidence without overfetch?

Only after this should the global policy be evolved.

#### Benchmark structure

Create `eval/query-shapes/` as a deterministic, non-agent benchmark over pinned repos and gold
tasks. It should run tool/query variants directly, without Claude agent variance.

For each task, generate multiple query variants:

```json
{
  "taskId": "fastify:server-protocol-selection",
  "tool": "ss-find",
  "variants": [
    {
      "name": "short-intent",
      "query": "server protocol selection",
      "regex": "server|http2|https"
    },
    {
      "name": "long-natural-language",
      "query": "how does Fastify decide whether to create HTTP HTTPS or HTTP2 server",
      "regex": "server|http2|https|getServerInstance"
    },
    {
      "name": "symbol-plus-intent",
      "query": "getServerInstance choose http2 https http",
      "regex": "getServerInstance|http2|https"
    }
  ]
}
```

Score each variant using deterministic retrieval metrics:

- expected file recall
- expected symbol recall
- gold line overlap
- returned-line precision
- chars/tokens returned
- latency
- whether output is answerable without follow-up reads
- whether the query routed to the intended search path
- number of follow-up reads needed in a simulated workflow

#### Tool-specific experiments

| Tool | Experiments |
|------|-------------|
| `sweet-search` auto/hybrid | short keyword vs natural-language vs symbol+intent; CatBoost routing accuracy; auto vs forced mode |
| indexed grep / `ss-grep` | literal specificity, regex family, rare-token anchors, top-k, context lines |
| ColGrep / `ss-find` | query length, symbol inclusion, broad vs narrow regex anchor, regex-family choice, k |
| structural mode | relationship wording (`calls`, `called by`, `impact`, `implements`), exact symbol requirement, hop count |
| `read-semantic` | symbol in query vs no symbol, behavior phrase length, maxTokens, topK, threshold, contextLines |
| `read` | exact range size, batch size, metadata usefulness, whole-file vs range tradeoff |
| `files` | glob-like patterns vs basename terms vs natural path descriptions |

#### DSPy role in query-shape optimization

DSPy is useful here before GEPA. Model each query generator as a small DSPy program:

```python
class MakeAutoSearchQuery(dspy.Signature):
    task = dspy.InputField()
    repo_language = dspy.InputField()
    query = dspy.OutputField()

class MakeColGrepQuery(dspy.Signature):
    task = dspy.InputField()
    semantic_query = dspy.OutputField()
    regex_anchor = dspy.OutputField()

class MakeReadSemanticQuery(dspy.Signature):
    task = dspy.InputField()
    file = dspy.InputField()
    symbol_hint = dspy.InputField()
    query = dspy.OutputField()
```

Use DSPy optimizers such as MIPROv2/BootstrapFewShot to learn instructions and examples for these
query generators against the deterministic query-shape benchmark. The output is not yet the final
agent prompt; it is a set of measured query-shape rules and examples.

#### Promotion artifact

The query-shape benchmark should produce a machine-readable report:

```json
{
  "tool": "read-semantic",
  "recommendations": [
    "include exact symbol when known",
    "use one behavior phrase, not multi-sentence task text",
    "default maxTokens=800 for code-understanding tasks",
    "increase maxTokens only for multi-branch error paths"
  ],
  "evidence": { "tasks": 120, "avgRecallGain": 0.12, "avgTokenReduction": 0.31 }
}
```

These recommendations become the seed material for Part 2H.

---

### 2H — GEPA Prompt Evolution Over Agent Traces

**Goal**: Evolve the sweet-search policy text until it consistently improves agent behavior over
native Claude Code workflows.

DSPy remains useful for structured metrics and evaluation programs, but the primary object we need
to optimize is textual: the tool-routing policy, examples, tool descriptions, query-shape guidance,
and stop criteria. GEPA (Reflective Prompt Evolution / Genetic-Pareto style optimization) is a
better fit for that layer because it can read full execution traces and mutate text artifacts based
on concrete failures.

#### Candidate artifact

Treat the following as a versioned candidate:

- `.claude/rules/sweet-search.md` contents
- `CLAUDE.md` / `AGENTS.md` injected summary block
- `UserPromptSubmit` reminder text
- MCP tool descriptions
- agent wrapper help text (`ss-grep`, `ss-find`, `ss-read`, `ss-semantic`)
- query-shape examples for each tool

#### Evaluator

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

#### Objective

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

#### GEPA loop

1. Seed with the hand-written benchmark-derived policy from Part 2F plus query-shape findings from
   Part 2G.
2. Run a small training split of agent tasks.
3. Feed GEPA the full traces: prompts, tool calls, tool outputs, final answers, audit violations,
   deterministic scores, and judge comments.
4. Ask GEPA to mutate the policy text, examples, and stop rules.
5. Re-run candidates on the training split.
6. Keep Pareto-efficient candidates.
7. Validate on held-out repos/tasks.
8. Promote only if the policy beats the current shipped policy under the criteria above.

#### DSPy role after adding GEPA

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
11. Write .claude/rules/sweet-search.md              (NEW — Part 2A½)
12. Inject/import agent instructions in CLAUDE.md/AGENTS.md   (NEW — Part 2A)
13. Install UserPromptSubmit reminder hook            (NEW — Part 2C, default-on)
14. Install tool-enforcement settings/hooks          (NEW — Part 2B, only with --enforce-tools)
15. Print report                                     (existing, updated)
```

### New init flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--enforce-tools` | `false` | Install Claude-specific deny/settings enforcement for native Grep plus Read hints |
| `--no-agent-instructions` | `false` | Skip `.claude/rules/sweet-search.md`, its `CLAUDE.md` import, and CLAUDE.md/AGENTS.md injection |
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
  Claude rules file:    .claude/rules/sweet-search.md (imported from CLAUDE.md)
  Agent instructions:   injected/imported into CLAUDE.md, AGENTS.md
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
| **P4** | `.claude/rules/sweet-search.md` + `CLAUDE.md` import + CLAUDE.md/AGENTS.md injection in init | 2-3h | tool names finalized |
| **P5** | `UserPromptSubmit` reminder hook | 1-2h | P4 |
| **P6** | strict Claude enforcement mode (`permissions` + Read hint hook) | 2-3h | P4 |
| **P7** | MCP/tool description rewrite | 30-60m | P1-P3 |
| **P8** | uninstall cleanup for all init-owned mutations | 1-2h | P4-P6 |
| **P9** | benchmarks + eval harness + tests | 4-6h | P1-P8 |
| **P10** | query-shape benchmark suite for `sweet-search`, indexed grep, ColGrep, structural, `read`, and `read-semantic` (Part 2G) | 8-12h | P9 |
| **P11** | GEPA/DSPy prompt evolution over agent traces — optimize policy text, examples, stop rules, and tool descriptions (Part 2H) | 12-24h + model budget | P9-P10 |
| **P12** | Wire promoted policy artifacts into init injection + hooks + MCP, regression test vs shipped baseline | 2-3h | P11 |

**Total estimated effort**: 38-64h

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
| `scripts/write-claude-rules.js` | `.claude/rules/sweet-search.md` write + `CLAUDE.md` import/cleanup logic |
| `tests/search/search-read.test.js` | Tests for read tool |
| `tests/search/search-read-semantic.test.js` | Tests for read-semantic tool |
| `tests/search/search-files.test.js` | Tests for path/glob tool |
| `tests/init/agent-instructions.test.js` | Tests for injection + symlink handling |
| `tests/init/prompt-reminders.test.js` | Tests for `UserPromptSubmit` integration |
| `eval/query-shapes/` | Benchmarks for optimal query wording per sweet-search tool |
| `eval/prompt-evolution/` | GEPA/DSPy prompt-policy optimization harness |

## Files to Modify

| File | Change |
|------|--------|
| `core/cli.js` | Add `read`, `read-semantic`, and `files` subcommand dispatch |
| `mcp/server.js` | Register `read`, `read-semantic`, and `files` MCP tools |
| `mcp/tool-handlers.js` | Add handler functions for new tools |
| `scripts/init.js` | Steps 11-14: rules file + CLAUDE.md import + agent instructions + prompt reminders + optional enforcement |
| `scripts/uninstall.js` | Remove `.claude/rules/sweet-search.md`, its `CLAUDE.md` import, injected instructions, and all sweet-search-managed hook/settings entries |
| `core/search/index.js` | Export new modules from barrel |
| `docs/INIT_STRATEGY.md` | Update uninstall contract to include init-owned instruction/settings reversal |

---

## Deferred Follow-Up: `INIT_STRATEGY.md`

Do not edit `docs/INIT_STRATEGY.md` as part of this plan's implementation unless explicitly
requested. When it is updated later, make the following changes so it matches the finalized init
and uninstall behavior.

### Required updates

1. Update the init flow section to add:
   - writing `.claude/rules/sweet-search.md`
   - importing `.claude/rules/sweet-search.md` from `CLAUDE.md`
   - agent instruction injection into `CLAUDE.md` / `AGENTS.md`
   - default-on `UserPromptSubmit` sweet-search reminder hook
   - opt-in Claude-specific enforcement via `.claude/settings.json`

2. Update the init flags table to add:
   - `--enforce-tools`
   - `--no-agent-instructions`
   - `--no-prompt-reminders`

3. Update the init success report example to mention:
   - whether `.claude/rules/sweet-search.md` was written
   - whether `CLAUDE.md` imports it
   - whether agent instructions were injected
   - whether prompt reminders were installed
   - whether strict enforcement was enabled

4. Update the uninstall section so it no longer claims uninstall only touches `.sweet-search/`,
   the model cache, and optional `node_modules`.

5. Replace that uninstall contract with the correct one:
   - uninstall removes all sweet-search-managed mutations created by `sweet-search init`
   - this includes `.claude/rules/sweet-search.md`
   - this includes the `@.claude/rules/sweet-search.md` import added to `CLAUDE.md`
   - this includes marker-wrapped blocks injected into `CLAUDE.md` / `AGENTS.md`
   - this includes sweet-search-managed entries added to `.claude/settings.json`
   - uninstall must only remove sweet-search-owned content, never unrelated user content
   - uninstall must remain idempotent and safe when files were manually edited later

6. Add a short note that:
   - `CLAUDE.md` is the Claude Code source of truth
   - `.claude/rules/sweet-search.md` is loaded through a documented `CLAUDE.md` import, not
     assumed to be auto-loaded on its own
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

### Why both `.claude/rules/` and `CLAUDE.md`?

Belt-and-suspenders. `.claude/rules/sweet-search.md` gives sweet-search a clean, fully owned
instruction file for Claude-specific guidance, while `CLAUDE.md` remains the documented source of
truth and imports that file. The `CLAUDE.md` / `AGENTS.md` injection covers Cursor, Windsurf,
Codex, and any agent that reads project markdown files. The duplication cost is negligible
compared to the cost of the agent falling back to native `Grep` + `Read` in a long conversation.

### Why benchmark-driven prompt evolution is mandatory

The imported `.claude/rules/sweet-search.md` file, the injected `CLAUDE.md` / `AGENTS.md`
instructions, and the `UserPromptSubmit` reminder are the primary guardrails for the entire
system. Because the success of tool selection depends heavily on the quality of those prompts,
they should be optimized systematically rather than hand-tuned once and left to drift.

The Fastify agent benchmark showed the core lesson: the same tools produce much better behavior
when the system prompt teaches a decision tree, stop rules, citation discipline, and query-shape
guidance. Therefore the prompt is a product surface, not documentation.

Use both:

- **DSPy** for structured task definitions, adapters, deterministic metrics, and repeatable
  candidate evaluation.
- **GEPA-style reflective prompt evolution** for mutating the actual text artifacts: routing
  policy, examples, tool descriptions, stop rules, and query-shape guidance from full execution
  traces.

**Full DSPy plan**: See [DSPY_PLAN.md](DSPY_PLAN.md) for the existing structured optimization
strategy. It should be updated so it is no longer the only optimization path: DSPy supplies the
evaluation scaffold, while GEPA evolves the prompt/policy text against the agent benchmark.
