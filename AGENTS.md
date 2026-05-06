# sweet-search — Agent Instructions

## Project Overview

**sweet-search** is a semantic + lexical hybrid code search engine, published as an npm package (`sweet-search`). It provides MCP server integration, a compiled native CLI (`sweet-search`), and a warm search server over a Unix socket.

**Tech Stack**: JavaScript (Node.js), Rust (native addons via napi-rs), SQLite, ONNX  
**Architecture**: Domain-Driven Design with bounded contexts  
**Package manager**: npm (not bun)

---

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, tests, or docs to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

---

## File Organization

- NEVER save to root folder
- `core/` — bounded context modules (indexing, search, ranking, embedding, graph, infrastructure)
- `tests/` — test files, organized by bounded context (tests/indexing/, tests/search/, etc.)
- `docs/` — documentation and markdown files
- `scripts/` — utility and build scripts
- `mcp/` — MCP server
- `bin/` — CLI entry points
- `eval/` — evaluation harnesses and benchmark data

---

## Project Architecture

- Follow Domain-Driven Design with bounded contexts — **mandatory** for all new or modified code
- Put domain logic in the owning bounded context; keep SQL, persistence, and external I/O behind repositories/adapters
- Do not bypass domain boundaries with direct cross-context database access
- When changing persistence, preserve the dependency direction: infrastructure implements storage, domains own behavior
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Ensure input validation at system boundaries

---

## Build & Test

```bash
# Build
npm run build

# Test (always use --run to avoid watch mode)
npm test -- --run

# Lint
npm run lint
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing
- NEVER run `npm test` without `--run` flag (watch mode hangs in CI)

---

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries
- Always sanitize file paths to prevent directory traversal
- Use parameterized queries for SQL — never string-concatenated queries

---

## Code Quality Rules

- Files under 500 lines
- No hardcoded secrets
- Input validation at system boundaries
- Typed interfaces for public APIs
- No speculative abstractions — build for the actual requirement, not hypothetical futures
- Don't add error handling for scenarios that can't happen
- Don't add backwards-compatibility shims unless explicitly required

---

## Git & Commit Policy

- NEVER auto-commit or push without explicit user request
- ALWAYS wait for user confirmation before git operations
- Commit message format:

```
<type>(<scope>): <description>

[optional body]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

---

## Data Protection

- NEVER run `rm -f` on `.sweet-search/`, `.agentic-qe/`, or `*.db` files without explicit confirmation
- ALWAYS backup before database operations

---

## Integrity Rules (Absolute)

- NO shortcuts, fake data, or false claims
- ALWAYS implement properly and verify before claiming success
- ALWAYS use real database queries for integration tests — no mocks against the DB
- ALWAYS run actual tests; never assume they pass

**We value the quality we deliver to our users.**

---

## Key Architectural Decisions (Locked)

- **CLI binary**: `ss-fast/ss-fast.c` compiled C binary, shipped in npm. Do not replace with a Node.js wrapper.
- **Socket path**: `/tmp/sweet-search.sock` (legacy `/tmp/search.sock` is dead)
- **Storage**: `.sweet-search/` only — no `.agentdb/` legacy paths
- **Package manager**: npm — bun not used (native addon compatibility)
- **Branding**: `sweet-search` everywhere user-visible — no "Sloth", "Smart Search", or "search-100x" remnants

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
