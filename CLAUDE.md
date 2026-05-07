# Claude Code Configuration - RuFlo V3

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## Ranking Signal Format-Gating (Always Enforced)

Any new ranking signal that detects structured-query patterns (BM25F-style boosts, anomalous-chunk demotions, behavioural-query demotions, mega-entity penalties, file-kind-aware reranking, etc.) MUST be gated on `opts._isAgentFormat` (or `opts.format === 'agent' | 'agent_full' | 'agent_full_xl' | 'agent_preview'`) by default.

**Empirical evidence** (2026-05): the same regression has now struck twice when ungated:
- **Symbol-exact + path-token boosts** (round 1): cost −0.07pp on GCSN heldout MRR before format-gating restored 86.01% baseline.
- **Anomalous-chunk demotion** (round 2): cost **−27.57pp on GCSN dev MRR** (86.92% → 59.35%) before format-gating restored full baseline.

GCSN-style NL queries silently match these structural patterns ("Sort an array of integers" → trips path-token; legitimate code-file headers with no symbol → trip anomalous-chunk). Default narrow; widen later only with held-out evidence that the signal helps NL traffic.

The `_isAgentFormat` flag is computed once in `applyResultDemotions` and threaded into per-result functions; for new code paths, plumb `format: options.format` through the call site.

## Stopword Lists vs Shape Heuristics

When you reach for a stopword list, distinguish the two categories:

**OK to keep** — query-tokenization stopwords for English IR (`STOPWORDS`, `QUERY_STOPWORDS`, `QUERY_TEXT_STOPWORDS`, `IDENTIFIER_AGREEMENT_STOPWORDS`). These filter common English words from BM25-style scoring; standard practice in Lucene/Elasticsearch. The lists are stable English (~30 entries) and don't grow per-project.

**Avoid** — capture-filtering stopwords for regex-extracted single tokens (the F9 case: filtering "the" / "complete" from `(\w+)` captures). These are fragile because:
1. Adding a real identifier (gin's `Default` function) blocks legitimate captures
2. List grows on every edge case
3. Doesn't generalize multilingually

For capture-filtering, prefer **identifier-shape heuristics**: prefer captures that look like code identifiers (uppercase letter, underscore, hyphen, digit) and fall back to first capture for lowercase identifiers like Rust `lock`. This is implemented in `looksLikeIdentifier` (file-kind-ranking.js). Long-term, swap for a tiny POS classifier (sub-ms inference, multilingual).

If you're tempted to grow `PATH_TOKEN_STOPWORDS` or similar capture-filtering lists, stop and ask: can a shape heuristic or an index-aware check (does this token actually appear as a path component in the indexed corpus?) replace it?

## Web Search

Use the Tavily MCP server (`mcp__tavily__tavily_search`) for web search instead of the built-in WebSearch tool.

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Treat DDD as mandatory for all new or modified code, especially database-facing code
- Put domain logic in the owning bounded context; keep SQL, persistence, and external I/O behind repositories/adapters
- Do not bypass domain boundaries with direct cross-context database access or ad hoc queries from scripts, handlers, or entrypoints
- When changing persistence, preserve the existing dependency direction: infrastructure implements storage, domains own behavior
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes
- Ensure input validation at system boundaries

### Project Config

- **Topology**: hierarchical-mesh
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

## Build & Test

```bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Run `npx @claude-flow/cli@latest security scan` after security-related changes

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP
- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL Bash commands in ONE message

## Swarm Orchestration

- MUST initialize the swarm using CLI tools when starting complex tasks
- MUST spawn concurrent agents using Claude Code's Task tool
- Never use CLI tools alone for execution — Task tool agents do the actual work
- MUST call CLI tools AND Task tool in ONE message for complex work

### 3-Tier Model Routing (ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types) — Skip LLM |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Always check for `[AGENT_BOOSTER_AVAILABLE]` or `[TASK_MODEL_RECOMMENDATION]` before spawning agents
- Use Edit tool directly when `[AGENT_BOOSTER_AVAILABLE]`

## Swarm Configuration & Anti-Drift

- ALWAYS use hierarchical topology for coding swarms
- Keep maxAgents at 6-8 for tight coordination
- Use specialized strategy for clear role boundaries
- Use `raft` consensus for hive-mind (leader maintains authoritative state)
- Run frequent checkpoints via `post-task` hooks
- Keep shared memory namespace for all agents

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

## Swarm Execution Rules

- ALWAYS use `run_in_background: true` for all agent Task calls
- ALWAYS put ALL agent Task calls in ONE message for parallel execution
- After spawning, STOP — do NOT add more tool calls or check status
- Never poll TaskOutput or check swarm status — trust agents to return
- When agent results arrive, review ALL results before proceeding

## V3 CLI Commands

### Core Commands

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization |
| `agent` | 8 | Agent lifecycle management |
| `swarm` | 6 | Multi-agent swarm coordination |
| `memory` | 11 | AgentDB memory with HNSW search |
| `task` | 6 | Task creation and lifecycle |
| `session` | 7 | Session state management |
| `hooks` | 17 | Self-learning hooks + 12 workers |
| `hive-mind` | 6 | Byzantine fault-tolerant consensus |

### Quick CLI Examples

```bash
npx @claude-flow/cli@latest init --wizard
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder
npx @claude-flow/cli@latest swarm init --v3-mode
npx @claude-flow/cli@latest memory search --query "authentication patterns"
npx @claude-flow/cli@latest doctor --fix
```

## Available Agents (60+ Types)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`

### GitHub & Repository
`pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`

## Memory Commands Reference

```bash
# Store (REQUIRED: --key, --value; OPTIONAL: --namespace, --ttl, --tags)
npx @claude-flow/cli@latest memory store --key "pattern-auth" --value "JWT with refresh" --namespace patterns

# Search (REQUIRED: --query; OPTIONAL: --namespace, --limit, --threshold)
npx @claude-flow/cli@latest memory search --query "authentication patterns"

# List (OPTIONAL: --namespace, --limit)
npx @claude-flow/cli@latest memory list --namespace patterns --limit 10

# Retrieve (REQUIRED: --key; OPTIONAL: --namespace)
npx @claude-flow/cli@latest memory retrieve --key "pattern-auth" --namespace patterns
```

## Quick Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

## Claude Code vs CLI Tools

- Claude Code's Task tool handles ALL execution: agents, file ops, code generation, git
- CLI tools handle coordination via Bash: swarm init, memory, hooks, routing
- NEVER use CLI tools as a substitute for Task tool agents

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues


## Agentic QE v3

This project uses **Agentic QE v3** - a Domain-Driven Quality Engineering platform with 12 bounded contexts, ReasoningBank learning, and HNSW vector search.

---

### CRITICAL POLICIES

#### Integrity Rule (ABSOLUTE)
- NO shortcuts, fake data, or false claims
- ALWAYS implement properly, verify before claiming success
- ALWAYS use real database queries for integration tests
- ALWAYS run actual tests, not assume they pass

**We value the quality we deliver to our users.**

#### Test Execution
- NEVER run `npm test` without `--run` flag (watch mode risk)
- Use: `npm test -- --run` for single test runs
- Use: `npm run test:unit`, `npm run test:integration` when available

#### Data Protection
- NEVER run `rm -f` on `.agentic-qe/` or `*.db` files without confirmation
- ALWAYS backup before database operations

#### Git Operations
- NEVER auto-commit/push without explicit user request
- ALWAYS wait for user confirmation before git operations

---

### Quick Reference

```bash
# Run tests
npm test -- --run

# Check quality
aqe quality assess

# Generate tests
aqe test generate <file>

# Coverage analysis
aqe coverage <path>
```

### MCP Server Tools

| Tool | Description |
|------|-------------|
| `fleet_init` | Initialize QE fleet with topology |
| `agent_spawn` | Spawn specialized QE agent |
| `test_generate_enhanced` | AI-powered test generation |
| `test_execute_parallel` | Parallel test execution with retry |
| `task_orchestrate` | Orchestrate multi-agent QE tasks |
| `coverage_analyze_sublinear` | O(log n) coverage analysis |
| `quality_assess` | Quality gate evaluation |
| `memory_store` / `memory_query` | Pattern storage with namespacing |

### Configuration

- **Enabled Domains**: test-generation, test-execution, coverage-analysis, quality-assessment, defect-intelligence, requirements-validation (+6 more)
- **Learning**: Enabled (transformer embeddings)
- **Max Concurrent Agents**: 8
- **Background Workers**: pattern-consolidator, routing-accuracy-monitor, coverage-gap-scanner

### V3 QE Agents

V3 QE agents are in `.claude/agents/v3/`. Use with Task tool:

```javascript
Task({ prompt: "Generate tests", subagent_type: "qe-test-architect", run_in_background: true })
Task({ prompt: "Find coverage gaps", subagent_type: "qe-coverage-specialist", run_in_background: true })
Task({ prompt: "Security audit", subagent_type: "qe-security-scanner", run_in_background: true })
```

### Data Storage

- **Memory Backend**: `.agentic-qe/memory.db` (SQLite)
- **Configuration**: `.agentic-qe/config.yaml`

---

## Benchmark Methodology (BEIR/CoIR-grade, applies to ALL benches)

To avoid overfitting to the benchmarks we develop against, every benchmark used during
optimisation MUST be split:

- **Dev** (60%): iterate freely, inspect per-query results, run continuously
- **Held-out** (40%): NEVER inspect per-query during dev; only aggregate metrics, only at milestones
- Use **stratified random split with a fixed seed** (stratify by whatever the benchmark groups by — language, repo, query type)

**Concrete example — GenCodeSearchNet (6000 queries, 6 languages):** 600 dev + 400 held-out per language, seed=42. Apply the same recipe to multi-repo bench, retrieval-probes, and any future benchmark.

**Discipline:**

| When | Run | Inspect |
|---|---|---|
| Per-change / iteration | Dev set | Aggregate + per-query failures (dev only) |
| Pre-commit | Dev + regression-probe subset | Same |
| Pre-release / publishing | Held-out + dev | Aggregate ONLY on held-out |

**If a held-out regression appears that didn't show on dev**, the dev set is too narrow OR the change overfits. **Do NOT tune to the held-out failure.** Fix the underlying principle, then re-run.

**Bonus signal:** before each release, hand-craft 20-30 queries on a fresh public repo never used during dev. Those numbers are the most credible.

When publishing benchmark numbers: report held-out scores with sample sizes and seeds. Never publish dev-only or "tuned-against" numbers without disclosure.
