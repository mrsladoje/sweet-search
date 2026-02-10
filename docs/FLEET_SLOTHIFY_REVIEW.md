# FLEET SLOTHIFY REVIEW — Release Validation Report

> Sweet Search v2.3.0 — DESLOTHIFY Migration Release Readiness Assessment
> Targeting release as MCP plugin for Claude Code and Codex

**Date:** 2026-02-10
**Branch:** `main` (7 commits post-DESLOTHIFY, 83 files modified)
**Fleet:** `fleet-92e77bcd` (hierarchical topology, 6 agents, 8 domains)
**Framework:** Brutal Honesty Review (Linus Mode, Level 2) + AQE v3 Fleet

---

## Fleet Composition

| Agent | Role | Tools Used | Tokens | Duration |
|-------|------|-----------|--------|----------|
| QE Queen Coordinator | Full validation orchestration | 103 | 94k | 58 min |
| QE Code Reviewer | Brutal honesty Linus mode | 65 | 91k | 4.5 min |
| QE Security Scanner | MCP release security audit | 58 | 118k | 3.6 min |
| QE Dependency Mapper | Package & dependency audit | 79 | 71k | 4.4 min |
| QE Coverage Specialist | Test gap analysis | 57 | 109k | 35 min |
| QE Contract Validator | MCP protocol compliance | 34 | 62k | 3.4 min |
| **TOTAL** | | **396** | **545k** | |

---

## Release Gate Verdict

```
+================================================================+
|                                                                  |
|     VERDICT:  NOT READY FOR RELEASE                              |
|                                                                  |
|     CRITICAL:  11 findings (must fix)                            |
|     HIGH:      16 findings (should fix before release)           |
|     MEDIUM:    14 findings (fix before or soon after)            |
|     LOW:        9 findings (follow-up)                           |
|     INFO:       8 findings (acknowledged, no action)             |
|                                                                  |
+================================================================+
```

The migration is approximately **85% complete**. The core rename (file, class, data directory, socket) was executed competently. But the last 15% — verification, test coverage, packaging, documentation, and migration flow — was not finished. The broken `ensureAgentDbDir` import proves **nobody ran the integration tests after the migration**.

---

## CRITICAL Findings (11) — Must Fix Before Release

### CR-01. Broken test import: `ensureAgentDbDir` does not exist
**Source:** Code Reviewer | **File:** `__tests__/index-maintainer.integration.test.js:26`

The function was renamed to `ensureDataDir` in `.claude/hooks/index-maintainer.mjs:496` but the test import was not updated. The entire integration test file cannot load — every test in it is dead.

```javascript
import { ensureAgentDbDir, CONFIG } from '../.claude/hooks/index-maintainer.mjs';
// ^ SyntaxError: does not provide an export named 'ensureAgentDbDir'
```

### CR-02. `.agentdb/` directory orphaned on disk, not in `.gitignore`
**Source:** Code Reviewer | **File:** `.agentdb/merkle-state.json` (untracked)

The migration renamed paths to `.sweet-search/` but the old `.agentdb/` directory still exists on disk and is NOT in `.gitignore`. Anyone running `git add .` will commit the stale data directory.

### CR-03. `.agentdb -> .sweet-search` migration flow not implemented
**Source:** Queen Coordinator | **File:** `core/config.js`

Per DESLOTHIFY.md (lines 362-365, 998), existing users with `.agentdb/` directories should get interactive prompts or warn-only migration. **No migration logic exists.** Current code only supports the `AGENTDB_PATH` env var alias. Users upgrading will silently lose their indexes.

### CR-04. `FILE_PATTERNS.exclude` missing `**/.sweet-search/**`
**Source:** Queen Coordinator | **File:** `core/config.js:1006-1019`

The indexer will scan its own SQLite databases, HNSW index files, and JSON caches. This causes noise in search results, performance degradation from indexing binary files, and potential recursion.

### CR-05. Package is 241 MB unpacked — 229 MB of dead training data
**Source:** Dependency Mapper | **File:** `package.json:46` (`files` array)

`training/output/` ships 30+ files totaling ~229 MB. Only `training/output/v45_router_d4.js` (1 MB) is imported at runtime. The `.cbm` CatBoost models, training data JSONs, and oversized router files are dead weight. A proper `files` whitelist would reduce the package to **~1.9 MB** (99.2% reduction).

### CR-06. Broken `bin.ss` entry — points to nonexistent file
**Source:** Dependency Mapper + Queen Coordinator | **File:** `package.json:33`

```json
"bin": { "ss": "./ss" }
```

`./ss` is the compiled C binary from `ss-fast/ss-fast.c`. It's in `.gitignore` and does not exist after `npm install`. Users running `npx ss` get ENOENT.

### CR-07. No `README.md` at project root
**Source:** Queen Coordinator | **File:** (missing)

npm will display an empty package page. Claude Code and Codex agents will have no onboarding context. This is the #1 documentation surface for any published package.

### CR-08. No MCP configuration documentation
**Source:** Queen Coordinator | **File:** (missing)

Users cannot configure Sweet Search in Claude Code or Codex without reading source code. Need documented `claude mcp add` command and env var reference.

### CR-09. `check-db.js` path traversal — resolves outside repo
**Source:** Queen Coordinator | **File:** `check-db.js:7`

```javascript
path.join(__dirname, '../../.sweet-search/code-graph.db')
// Resolves to /home/panonit/projects/.sweet-search/code-graph.db (OUTSIDE repo)
```

### CR-10. No `.npmignore` — training data ships by accident
**Source:** Dependency Mapper | **File:** (missing)

The `.gitignore` excludes some `training/output/*.cbm` files but NOT the majority. Without `.npmignore`, the `files` whitelist in `package.json` is the only gate — and it includes `training/output/` which pulls in 229 MB.

### CR-11. Unauthenticated `/stop` endpoint terminates server
**Source:** Security Scanner | **File:** `core/sweet-search.js:2374`

```javascript
} else if (req.method === 'GET' && req.url === '/stop') {
  process.exit(0);
}
```

Any process on the machine (or network peer for the TCP listener on port 9876) can kill the warm search server. Denial of service with zero authentication.

---

## HIGH Findings (16) — Should Fix Before Release

### HI-01. MCP `search` tool: no try/catch — exceptions leak internal paths
**Source:** Contract Validator | **File:** `mcp/server.js:146-179`

Unhandled exceptions from `getSearcher()` or `searcher.search()` propagate as JSON-RPC errors containing absolute filesystem paths like `/home/user/.sweet-search/code-graph.db`.

### HI-02. MCP `search` query param accepts empty string
**Source:** Contract Validator | **File:** `mcp/server.js:134`

`z.string()` with no `.min(1)` — empty string wastes resources and returns unpredictable results.

### HI-03. MCP `index` tool: no timeout on child process
**Source:** Contract Validator | **File:** `mcp/server.js:196-252`

If the indexer hangs (DB lock, network stall), the MCP tool call hangs indefinitely. No `AbortController`, no timeout, no kill mechanism.

### HI-04. `loadProjectConfig()` is dead code — implemented but never called
**Source:** Code Reviewer | **File:** `core/config.js:1029`

The `.sweet-search.config.json` feature was claimed as Phase 9 deliverable but `loadProjectConfig()` is never invoked by any code. Per-project config overrides silently do nothing.

### HI-05. 2 high-severity npm audit vulnerabilities
**Source:** Security Scanner | **File:** transitive dependencies

| Package | Severity | CWE | Description |
|---------|----------|-----|-------------|
| `@isaacs/brace-expansion` <=5.0.0 | HIGH | CWE-1333 | ReDoS |
| `tar` <=7.5.6 | HIGH | CWE-22/59/176 | Path traversal + symlink poisoning |

Both are transitive deps. The `tar` vulns are relevant because `better-sqlite3` uses it during native addon installation.

### HI-06. Dead production dependency: `catboost`
**Source:** Dependency Mapper | **File:** `package.json:83`

Not imported by any `core/*.js` file. The WASM router replaced it. Wastes install time and may trigger native addon issues.

### HI-07. Misplaced dependencies: `ajv` + `ajv-formats`
**Source:** Dependency Mapper | **File:** `package.json:80-81`

Only used by `evaluation/run-evaluation.js` (not in `files`). Should be devDependencies.

### HI-08. 3 dead optional dependencies
**Source:** Dependency Mapper | **File:** `package.json:95-99`

`@anthropic-ai/sdk`, `sql.js`, and `usearch` are not imported by any core file. Wastes user install time.

### HI-09. Missing `exports` field in package.json
**Source:** Dependency Mapper | **File:** `package.json`

Modern ESM packages should define `exports` for proper subpath resolution. Consumers cannot cleanly `import('sweet-search/mcp/server')`.

### HI-10. Header comments still say "Smart Search"
**Source:** Code Reviewer | **File:** `core/sweet-search.js:4,50`

```javascript
/** Smart Search v2.3 - Unified Search Pipeline with Auto-Warm Server */
// ===================== SMART SEARCH CLASS =====================
```

The most visible comments in the main file contradict the rename.

### HI-11. No graceful shutdown in MCP server — resources leak
**Source:** Code Reviewer | **File:** `mcp/server.js`

No `SIGINT`/`SIGTERM` handler. SQLite connections, HNSW indexes, and ONNX sessions are not cleanly closed. Can corrupt databases on Windows/NFS.

### HI-12. `bun.lock` has stale `search-100x` workspace name
**Source:** Queen Coordinator | **File:** `bun.lock:6`

Lockfile was never regenerated after rename.

### HI-13. 7 pre-existing test failures in language detection
**Source:** Queen Coordinator + Coverage Specialist | **File:** `__tests__/translation/language-detection.test.js`

`detectLatinLanguage()` returns `null` for German, French, Spanish, Polish. Blocks multilingual search quality claims.

### HI-14. `SEARCH_100X_ROOT` variable name in 3 evaluation scripts
**Source:** Code Reviewer | **Files:** `evaluation/benchmark-all-models.js:28`, `evaluation/run-translation-benchmarks.js:32`, `evaluation/benchmark-translation-providers.js:28`

Not backward-compat shims — straight-up missed renames.

### HI-15. `core/project-detector.js` (NEW) has zero tests
**Source:** Coverage Specialist | **File:** `core/project-detector.js` (97 lines)

New code used by 3 consumers (ast-chunker, relationship-resolver, graph-extractor). Zero test coverage for boundary detection, caching, edge cases.

### HI-16. Backward compatibility aliases are completely untested
**Source:** Coverage Specialist | **Files:** `core/sweet-search.js:2918`, `core/config.js:74-83`

No tests verify `SmartSearch` export alias works, `AGENTDB_PATH` env fallback works, or `.sweet-search/` default data directory name.

---

## MEDIUM Findings (14) — Fix Before or Soon After Release

| ID | Source | File | Finding |
|----|--------|------|---------|
| ME-01 | Contract | `mcp/server.js:135` | `k` param unbounded — allows negative, zero, float, or `k=999999` |
| ME-02 | Contract | `mcp/server.js:220-223` | `notifications/progress` params malformed per MCP spec |
| ME-03 | Contract | `mcp/server.js:292-298` | Health check opens new DB connection per call |
| ME-04 | Contract | all tools | No SQLITE_BUSY handling — concurrent index + search deadlock |
| ME-05 | Contract | `mcp/server.js:286,303,365` | Error messages leak absolute filesystem paths |
| ME-06 | Security | `.mcp.json`, `.claude/mcp.json` | Developer home path hardcoded (not published but in git) |
| ME-07 | Security | `mcp/server.js:306,324,362` | `PROJECT_ROOT` absolute path exposed in health/config responses |
| ME-08 | Security | `mcp/server.js:134-135` | No input size limits on query string (allows multi-MB queries) |
| ME-09 | Code Rev | `evaluation/lib/cost-tracker.js:43` | Comment still references "Sloth codebase" |
| ME-10 | Code Rev | `core/project-detector.js:29` | Boundary cache grows unbounded — no LRU/TTL eviction |
| ME-11 | Code Rev | `package.json:33` | `ss` binary entry in files but file doesn't exist |
| ME-12 | Dep Map | `mcp/server.js:79` | Version `2.3.0` hardcoded — must sync with package.json manually |
| ME-13 | Queen | `NOTICE` file | Uses different repo URL than `package.json` |
| ME-14 | Queen | `ss-fast/Makefile:41` | Test target only checks legacy `/tmp/search.sock` |

---

## LOW Findings (9) — Fix in Follow-Up

| ID | Source | Finding |
|----|--------|---------|
| LO-01 | Contract | `listChanged: true` declared but no dynamic tool/resource changes ever emitted |
| LO-02 | Contract | `annotations` may be unknown field to older MCP clients |
| LO-03 | Contract | Custom URI scheme `sweet-search://` may not be discovered by all clients |
| LO-04 | Contract | `index` tool marked `idempotentHint: true` — may encourage expensive auto-retry |
| LO-05 | Code Rev | `SmartSearch` export alias has no `@deprecated` JSDoc or console warning |
| LO-06 | Code Rev | `toKebabCase()` strips unicode characters (e.g., `cafe` from `cafe` works, `caf\u00e9` becomes `caf`) |
| LO-07 | Code Rev | Test assertions check absence of old brand but not presence of new |
| LO-08 | Security | FTS5 `sanitizeFtsQuery()` doesn't strip `-` (NOT) operator |
| LO-09 | Security | Predictable PID file and socket path in `/tmp` |

---

## INFO Findings (8) — Acknowledged, No Action Needed

| ID | Source | Finding |
|----|--------|---------|
| IN-01 | Multiple | `SmartSearch` export alias in `sweet-search.js:2918` — intentional backward compat |
| IN-02 | Multiple | `AGENTDB_PATH` env fallback in `config.js:78` — intentional deprecation alias |
| IN-03 | Multiple | `SMART_SEARCH_COLOR_MODE`/`HEADER_STYLE` fallbacks — intentional |
| IN-04 | Multiple | `/tmp/search.sock` symlink creation — intentional legacy fallback |
| IN-05 | Security | No `eval()` or `new Function()` usage anywhere — PASS |
| IN-06 | Security | `child_process.spawn` uses hardcoded args, no user input — PASS |
| IN-07 | Security | No prototype pollution patterns — PASS |
| IN-08 | Security | MCP file system scope correctly limited to search operations — PASS |

---

## Cross-Agent Corroborations

These findings were independently discovered by multiple agents, increasing confidence:

| Finding | Discovered By |
|---------|---------------|
| No input validation on MCP `search` query | Contract Validator + Security Scanner + Queen |
| `bin.ss` broken entry | Dependency Mapper + Queen Coordinator |
| No README.md | Dependency Mapper + Queen Coordinator |
| Error messages leak paths | Contract Validator + Security Scanner |
| `loadProjectConfig()` dead code | Code Reviewer + Coverage Specialist (tested but unwired) |
| No timeout on index child process | Contract Validator + Code Reviewer (no graceful shutdown) |
| project-detector.js untested | Code Reviewer + Coverage Specialist |
| `check-db.js` path issue | Queen Coordinator + Code Reviewer |

---

## Test Coverage Gap Summary

**Source:** Coverage Specialist

### Files With Zero Test Coverage (Migration-Critical)

| File | Lines | Risk | Impact |
|------|-------|------|--------|
| `core/project-detector.js` (NEW) | 97 | HIGH | Affects graph indexing, relationships, AST chunking |
| `core/relationship-resolver.js` | 175 | HIGH | Incorrect relationship graph degrades search quality |
| `ast-chunker.js` | 230+ | MEDIUM | Affects chunk quality for semantic search |
| `scripts/prewarm-vocab.js` (REWRITTEN) | 100 | MEDIUM | Vocabulary warmup |
| `mcp/config-gen.js` | 122 | LOW | Developer-facing setup tool |

### Functions With Zero Coverage (High Impact)

| Function | File | Risk |
|----------|------|------|
| `loadProjectConfig()` | `core/config.js:1029-1057` | Silently mis-configures indexing if buggy |
| `detectProjectBoundary()` | `core/project-detector.js:38-71` | Wrong project tags = wrong relationship resolution |
| `resolveRelationshipTargets()` | `core/relationship-resolver.js:57-175` | Incorrect code graph |
| Backward compat aliases | `sweet-search.js:2918`, `config.js:74-83` | Breaks existing consumers |

### Estimated Gap

~150-200 new test cases across 6 test files would bring migration-affected code to adequate coverage.

---

## Package Distribution Analysis

**Source:** Dependency Mapper

### Current vs. Recommended Package

| Metric | Current | Recommended | Delta |
|--------|---------|-------------|-------|
| Unpacked size | 241.3 MB | ~1.9 MB | **-99.2%** |
| File count | 90 | ~45 | -50% |
| Production deps | 9 | 6 | -3 (remove catboost, ajv, ajv-formats) |
| Optional deps | 5 | 2 | -3 (remove @anthropic-ai/sdk, sql.js, usearch) |
| Native addons | 2 (better-sqlite3, catboost) | 1 (better-sqlite3) | -1 |

### Dependency DAG

```
config.js              <-- leaf (no local imports)
constants.js           <-- leaf
onnx-mutex.js          <-- leaf
project-detector.js    <-- leaf
mmr.js                 <-- imports config
intent-detector.js     <-- leaf
vocabulary-utils.js    <-- imports config
embedding-service.js   <-- imports config
local-reranker.js      <-- imports onnx-mutex
flashrank.js           <-- imports config, local-reranker, onnx-mutex
binary-hnsw-index.js   <-- imports config, embedding-service
hnsw-index.js          <-- imports config
colbert-index.js       <-- imports config
graph-search.js        <-- imports config, intent-detector, mmr, constants
sweet-search.js        <-- imports everything above + translation/
```

**No circular dependencies detected.** Clean DAG.

---

## MCP Contract Assessment

**Source:** Contract Validator

### Tool Definitions

| Tool | Schema | Error Handling | Annotations | Verdict |
|------|--------|---------------|-------------|---------|
| `search` | Query lacks `.min(1)`, k lacks bounds | No try/catch, leaks paths | Correct | NEEDS WORK |
| `index` | Clean | No timeout, malformed progress notifications | `idempotentHint` questionable | NEEDS WORK |
| `health` | Clean | Opens new DB connection per call | Correct | ACCEPTABLE |

### Codex Compatibility

| Feature | Claude Code | Codex CLI | Risk |
|---------|------------|-----------|------|
| stdio transport | Supported | Supported | NONE |
| `structuredContent` | Supported | May not consume | LOW (fallback to `content` text) |
| `outputSchema` | Supported | May reject unknown field | LOW |
| `annotations` | Supported | Should ignore unknown fields | LOW |
| `sendNotification` | Supported | May not pass callback | LOW (guarded with null check) |

**Net assessment:** Compatible with both platforms. Codex clients will receive text-mode responses (ignoring structured content), which is acceptable.

---

## Security Posture

**Source:** Security Scanner

### Threat Model for MCP Plugin

| Vector | Status | Details |
|--------|--------|---------|
| Hardcoded secrets | PASS | All API keys from env vars |
| SQL injection | PASS | All queries parameterized via better-sqlite3 |
| Path traversal | PASS (MCP) | No file read/write tools exposed |
| Command injection | PASS | spawn() uses hardcoded args only |
| Prototype pollution | PASS | No vulnerable patterns |
| eval() / Function() | PASS | Zero occurrences |
| Unauthenticated endpoints | **FAIL** | `/stop` on warm server (CR-11) |
| Dependency vulnerabilities | **FAIL** | 2 HIGH CVEs (HI-05) |
| Information disclosure | WARN | Paths in error messages (ME-05, ME-07) |
| Resource exhaustion | WARN | No query size limits (ME-08) |

---

## Recommended Fix Priority

### Before `npm publish` (Blocking)

1. **CR-04** — Add `**/.sweet-search/**` to `FILE_PATTERNS.exclude` (1-line fix)
2. **CR-05 + CR-10** — Tighten `files` whitelist to exclude `training/output/*.cbm` and bulk training data; or create `.npmignore`
3. **CR-06** — Remove `bin.ss` entry or replace with Node.js wrapper script
4. **CR-07 + CR-08** — Create README.md with install, usage, MCP setup guide
5. **CR-11** — Add auth token to `/stop` endpoint or restrict to Unix socket only
6. **HI-01** — Wrap MCP `search` handler in try/catch with sanitized error messages
7. **HI-02** — Add `.min(1)` to query, `.int().min(1).max(200)` to k
8. **HI-05** — Run `npm audit fix`
9. **HI-06 + HI-07 + HI-08** — Remove dead dependencies (catboost, ajv, @anthropic-ai/sdk, sql.js, usearch)
10. **HI-10** — Fix header comments in sweet-search.js

### Before v2.4.0 (Soon After)

11. **CR-01** — Fix `ensureAgentDbDir` -> `ensureDataDir` import in integration test
12. **CR-02** — Add `.agentdb/` to `.gitignore` and clean up orphaned directory
13. **CR-03** — Implement `.agentdb -> .sweet-search` migration flow
14. **CR-09** — Fix `check-db.js` path or move to `scripts/`
15. **HI-03** — Add timeout to index child process
16. **HI-04** — Wire up `loadProjectConfig()` or remove it
17. **HI-11** — Add SIGTERM handler to MCP server
18. **HI-15** — Write tests for project-detector.js
19. **HI-16** — Write backward-compat alias tests

---

## Appendix: What's Actually Good (Credit Where Due)

The fleet acknowledges these areas of solid engineering:

- **Socket path migration** — Clean rename with legacy symlink fallback. `ss.sh`, C client, and session-preheat all have proper fallback. (Code Reviewer G1)
- **AGENTDB_PATH deprecation** — Proper cascade: `SWEET_SEARCH_DATA_DIR` > `AGENTDB_PATH` (with warning) > `.sweet-search` default. (Code Reviewer G2)
- **Incremental tracker** — Excellent engineering: mtime/size fast-path, batched stat calls, atomic saves, ENOSPC handling, TOCTOU prevention. (Code Reviewer G3)
- **MCP output schemas** — Zod schemas, stdout protection, lazy imports, annotations. (Code Reviewer G4, Contract Validator)
- **No circular dependencies** — Clean DAG from config.js leaf to sweet-search.js root. (Dependency Mapper)
- **Security fundamentals** — No eval(), no hardcoded secrets, parameterized SQL, scoped file access. (Security Scanner)
- **project-detector.js design** — 96 lines, single responsibility, clear API, proper marker file list. Needs tests and edge case hardening but the architecture is right. (Code Reviewer G5)

---

*Generated by AQE v3 Fleet (fleet-92e77bcd) | 6 agents | 396 tool calls | 545k tokens | Brutal Honesty Review (Linus Mode)*
