# DESLOTHIFY FIX Plan (Merged Review Synthesis)

> Deduplicated remediation plan merged from:
> - `CODEX_DESLOTHIFY_REVIEW.md`
> - `docs/FLEET_SLOTHIFY_REVIEW.md`

**Date:** 2026-02-10  
**Goal:** Capture all good actionable suggestions from both reviews, deduplicated, prioritized, and traceable.

**Hard-cutover policy (locked):**
- This project is pre-release with no external users yet.
- Do **not** implement legacy `.agentdb` migration flows.
- Do **not** keep `AGENTDB_PATH` runtime compatibility aliases.
- Runtime/storage contract is `.sweet-search` only.

---

## 1) Review Quality Comparison

### Verdict: who did better?

For release-readiness depth, **AQE Fleet did better overall**:

- **Strengths:** wider coverage (security, packaging, MCP contract, dependency hygiene, testing, docs), severity taxonomy, and cross-agent corroboration.
- **Tradeoff:** more volume and some lower-signal items require prioritization.

Codex review was still high quality:

- **Strengths:** concise, high-signal, plan-alignment checks, strong focus on "implemented vs claimed."
- **Tradeoff:** narrower scope than fleet (fewer packaging/security/protocol details).

Net: use fleet breadth as baseline, and codex precision as confidence filter.

---

## 2) Deduplicated Unified Fix Backlog

Each fix item includes source trace IDs:
- `C-*` = Codex review item
- `CR/HI/ME/LO-*` = Fleet finding IDs

### P0 — Blockers (must fix before release)

### F-01 Build gate is not executable
- Add concrete `build` script to `package.json`.
- Enforce `npm run build` in release verification.
- **Sources:** C-01, CR recommended list, HI/ME coverage context.

### F-02 `.sweet-search.config.json` exists but is not wired into indexing behavior
- Ensure `loadProjectConfig()` is invoked by indexing flow.
- Apply include/exclude overrides at runtime, not only static defaults.
- **Sources:** C-02, HI-04.

### F-03 Self-indexing guard missing
- Add `**/.sweet-search/**` to active runtime exclude patterns.
- Verify hook/indexer scanners also exclude `.sweet-search`.
- **Sources:** C-03, CR-04.

### F-04 Hard cutover to `.sweet-search` only (no legacy `.agentdb` support)
- Remove runtime compatibility code for `AGENTDB_PATH` alias.
- Do not add/keep migration prompt/warn-only flows for `.agentdb`.
- If stale `.agentdb` is detected, fail fast with a clear one-line action: re-index into `.sweet-search`.
- **Sources:** C-04, CR-03.

### F-05 Fix broken integration test import (`ensureAgentDbDir` -> `ensureDataDir`)
- Update import in `__tests__/index-maintainer.integration.test.js`.
- Re-run full integration suite.
- **Sources:** CR-01.

### F-06 Secure `/stop` endpoint
- Add auth token/check, restrict to Unix socket/local trusted context, or remove endpoint in production mode.
- Prevent unauthenticated local/network DoS.
- **Sources:** CR-11.

### F-07 Package bloat and publish hygiene
- Remove dead training artifacts from publish payload.
- Tighten `files` whitelist and/or add `.npmignore`.
- Keep only runtime-required router/model artifacts.
- **Sources:** CR-05, CR-10.

### F-08 Broken `bin.ss` distribution contract
- `bin.ss` currently points to non-existent `./ss` after install.
- Either:
  - ship a real wrapper script, or
  - remove `bin.ss` entry until artifact strategy is stable.
- **Sources:** CR-06, ME-11.

### F-09 MCP search handler hardening
- Add robust try/catch and sanitize error surfaces.
- Remove absolute path leakage in error messages.
- **Sources:** HI-01, ME-05.

### F-10 MCP input validation hardening
- `query`: require non-empty and max size limits.
- `k`: enforce integer min/max bounds.
- **Sources:** HI-02, ME-01, ME-08.

### F-11 MCP index timeout and cancellation
- Add timeout and abort/kill strategy for index child process.
- Prevent indefinite hanging tool calls.
- **Sources:** HI-03.

### F-12 Add README and MCP setup docs
- Root README with install/use cases.
- Explicit MCP setup docs for Claude Code and Codex.
- **Sources:** CR-07, CR-08.

---

### P1 — High priority before/around release

### F-13 `check-db.js` path correctness and location
- Current relative path resolves outside repo in common usage.
- Fix path resolution and move to `scripts/` (or retain with rationale).
- **Sources:** C-07, CR-09.

### F-14 Socket migration completeness in C tooling
- `ss-fast/Makefile` test target still checks only `/tmp/search.sock`.
- Make test target aware of new `/tmp/sweet-search.sock` and compat fallback.
- **Sources:** C-06, ME-14.

### F-15 Lockfile regeneration + stale naming cleanup
- Regenerate lockfile after rename.
- Remove stale `search-100x` naming remnants from lock metadata.
- **Sources:** C-08, HI-12.

### F-16 Dependency cleanup and risk reduction
- Remove dead prod dep `catboost`.
- Move `ajv`/`ajv-formats` to devDependency if runtime not required.
- Remove dead optional deps (`@anthropic-ai/sdk`, `sql.js`, `usearch`) unless intentionally kept.
- **Sources:** HI-06, HI-07, HI-08.

### F-17 Run `npm audit fix` and verify high CVEs resolved
- Address transitive high vulnerabilities where feasible.
- Record accepted residual risk if pinned by ecosystem constraints.
- **Sources:** HI-05.

### F-18 MCP server graceful shutdown
- Add SIGINT/SIGTERM handling and deterministic cleanup.
- Prevent leaked resources and DB/session corruption.
- **Sources:** HI-11.

### F-19 Project detector + debranding compatibility test coverage
- Add tests for:
  - `core/project-detector.js`
  - debranding compatibility (`SmartSearch` alias if retained, `.sweet-search` default data dir)
- **Sources:** HI-15, HI-16.

### F-20 Fix known translation test baseline failures
- Investigate and fix failing language-detection assertions.
- Release gates should not claim green with known failing baseline.
- **Sources:** C-12, HI-13.

### F-21 Normalize leftover internal naming in runtime comments/vars
- Fix stale "Smart Search" header comments in `core/sweet-search.js`.
- Rename `SEARCH_100X_ROOT` vars in evaluation scripts where not intentionally historical.
- **Sources:** HI-10, HI-14.

### F-22 MCP metadata and packaging polish
- Add `exports` field for ESM subpath hygiene.
- Synchronize hardcoded MCP server version with `package.json` version.
- **Sources:** HI-09, ME-12.

### F-23 `.agentdb` artifact purge and hygiene
- Remove stale `.agentdb/` artifacts from working tree and CI flows.
- Enforce that runtime paths do not read/write `.agentdb`.
- Keep `.agentdb/` ignored only as a safety net against accidental local residue commits.
- **Sources:** CR-02.

---

### P2 — Medium priority (soon after release)

### F-24 MCP protocol conformance refinements
- Fix `notifications/progress` payload format.
- Revisit `listChanged` semantics if no dynamic changes are emitted.
- Reconsider `index` tool `idempotentHint` behavior for expensive operations.
- **Sources:** ME-02, LO-01, LO-04.

### F-25 Health path performance/robustness
- Avoid opening new DB connection per health call.
- Add `SQLITE_BUSY` handling for index/search concurrency contention.
- **Sources:** ME-03, ME-04.

### F-26 Information exposure hardening
- Prevent absolute `PROJECT_ROOT` and local machine paths in responses/config/diagnostics.
- Remove hardcoded developer home paths in `.mcp.json` / `.claude/mcp.json` where possible.
- **Sources:** ME-06, ME-07.

### F-27 Project detector cache bounds
- Add TTL/LRU or bounded size to boundary cache.
- **Sources:** ME-10.

### F-28 Legacy comment cleanup in eval tooling
- Remove stale "Sloth codebase" wording in active evaluation comments where not intentional.
- **Sources:** ME-09.

### F-29 Repo metadata consistency
- Align `NOTICE` repo URL with `package.json` canonical repository URL.
- **Sources:** ME-13.

### F-30 Prewarm implementation completion
- Confirm `/sweet-prewarm-vocab` skill exists and is wired into workflow, not only script rewrite.
- **Sources:** C-05.

---

### P3 — Low priority hardening and polish

### F-31 Backward compatibility messaging
- Add `@deprecated` docs/warnings for legacy `SmartSearch` alias.
- **Sources:** LO-05.

### F-32 Unicode-safe kebab conversion
- Improve `toKebabCase()` handling for unicode/diacritics.
- **Sources:** LO-06.

### F-33 Test assertions quality
- Add assertions for presence of new brand, not just absence of old terms.
- **Sources:** LO-07.

### F-34 Query sanitizer hardening
- Re-evaluate FTS query sanitization for `-` (NOT) operator behavior.
- **Sources:** LO-08.

### F-35 Predictable `/tmp` artifact hardening
- Consider stronger ownership/permission/randomization controls for PID/socket artifacts.
- **Sources:** LO-09.

### F-36 MCP compatibility niceties
- Verify behavior with older clients re: annotations and custom URI discoverability.
- **Sources:** LO-02, LO-03.

---

## 3) Process and Verification Discipline Fixes

### F-37 Execution-trust discipline
- Ensure claimed swarm topology/consensus/agent counts match actual runtime output.
- Ensure non-blocking tool errors have explicit compensating validation.
- **Sources:** C-09, C-10, C-11.

### F-38 Release gate policy
- Do not declare release-ready when critical phase gates (build/tests/integration) are unverified or known failing.
- **Sources:** C-12, fleet verdict context.

---

## 4) Recommended Implementation Order

1. **P0 blockers** (`F-01`..`F-12`)  
2. **P1 release-high** (`F-13`..`F-23`)  
3. **P2 medium** (`F-24`..`F-30`)  
4. **P3 low hardening** (`F-31`..`F-36`)  
5. **Process discipline** (`F-37`, `F-38`) enforced throughout

---

## 5) Codex-to-Merged Traceability Matrix

| Codex ID | Source suggestion | Merged Fix ID |
|---|---|---|
| C-01 | `npm run build` gate not executable | F-01 |
| C-02 | `.sweet-search.config.json` unwired | F-02 |
| C-03 | Missing `**/.sweet-search/**` exclude | F-03 |
| C-04 | Migration behavior not implemented | F-04 |
| C-05 | Prewarm skill incomplete | F-30 |
| C-06 | `ss-fast` Makefile still checks legacy socket | F-14 |
| C-07 | `check-db.js` path/root issue | F-13 |
| C-08 | Lockfile not regenerated | F-15 |
| C-09 | Claimed topology/consensus mismatch runtime | F-37 |
| C-10 | Agent fan-out claims overstated | F-37 |
| C-11 | Non-blocking errors accepted without compensating validation | F-37 |
| C-12 | Pre-existing translation tests still failing | F-20 / F-38 |

---

## 6) Fleet-to-Merged Traceability Matrix

### CR Findings

| Fleet ID | Merged Fix ID |
|---|---|
| CR-01 | F-05 |
| CR-02 | F-23 |
| CR-03 | F-04 |
| CR-04 | F-03 |
| CR-05 | F-07 |
| CR-06 | F-08 |
| CR-07 | F-12 |
| CR-08 | F-12 |
| CR-09 | F-13 |
| CR-10 | F-07 |
| CR-11 | F-06 |

### HI Findings

| Fleet ID | Merged Fix ID |
|---|---|
| HI-01 | F-09 |
| HI-02 | F-10 |
| HI-03 | F-11 |
| HI-04 | F-02 |
| HI-05 | F-17 |
| HI-06 | F-16 |
| HI-07 | F-16 |
| HI-08 | F-16 |
| HI-09 | F-22 |
| HI-10 | F-21 |
| HI-11 | F-18 |
| HI-12 | F-15 |
| HI-13 | F-20 |
| HI-14 | F-21 |
| HI-15 | F-19 |
| HI-16 | F-19 |

### ME Findings

| Fleet ID | Merged Fix ID |
|---|---|
| ME-01 | F-10 |
| ME-02 | F-24 |
| ME-03 | F-25 |
| ME-04 | F-25 |
| ME-05 | F-09 |
| ME-06 | F-26 |
| ME-07 | F-26 |
| ME-08 | F-10 |
| ME-09 | F-28 |
| ME-10 | F-27 |
| ME-11 | F-08 |
| ME-12 | F-22 |
| ME-13 | F-29 |
| ME-14 | F-14 |

### LO Findings

| Fleet ID | Merged Fix ID |
|---|---|
| LO-01 | F-24 |
| LO-02 | F-36 |
| LO-03 | F-36 |
| LO-04 | F-24 |
| LO-05 | F-31 |
| LO-06 | F-32 |
| LO-07 | F-33 |
| LO-08 | F-34 |
| LO-09 | F-35 |

---

## 7) Inclusion Check (Proof of Completeness)

This merged plan includes all good actionable suggestions from:

- Codex: **12 / 12**
- Fleet actionable findings: **50 / 50** (`CR+HI+ME+LO`)

Excluded intentionally:

- Fleet `INFO` findings marked "no action needed" (acknowledged, not remediation items).

