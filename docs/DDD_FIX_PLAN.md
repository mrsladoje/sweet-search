# DDD_FIX_PLAN: DDD Migration Remediation Plan

**Status**: PHASES 0-5 COMPLETE (2026-04-01), PHASES 6-9 REMAINING
**Priority**: MEDIUM (enforcement active, boundaries clean)
**Date**: 2026-04-01
**Builds on**: `docs/DDD_PLAN.md`

---

## Executive Summary

The DDD migration is structurally advanced but architecturally incomplete.

What is already true:

- The flat `core/` layout has been physically split into 9 bounded-context directories.
- Main package entrypoints now point at the new domain layout.
- Basic dependency direction inside `core/` is mostly sane.

What is not yet true:

- Consumers have not been migrated to domain public APIs.
- Domain barrels are not the actual integration surface.
- Boundary enforcement is weak and does not verify barrel-only consumption.
- The implementation is not yet a strong DDD / hexagonal design with ports and adapters.
- Several domain ownership, duplication, and testability issues remain.

This plan merges the findings from both audits into one execution sequence. The goal is not just to finish the folder migration, but to make the architecture consistent with the claims in `docs/DDD_PLAN.md`.

---

## Current Assessment

### Overall Judgment

The codebase has completed most of the **physical reorganization**, but not the **semantic consolidation** needed for a good DDD migration.

Current state in one sentence:

> The repo is now a cleaner modular monolith, but not yet a properly enforced bounded-context architecture.

### What This Plan Must Achieve

1. Make domain `index.js` files the real public APIs.
2. Remove direct cross-domain coupling where the plan expected façade-based access.
3. Add real enforcement so the architecture does not regress.
4. Fix domain ownership mistakes and dead duplication introduced during migration.
5. Restore trust in tests, coverage, and migration verification gates.

---

## Consolidated Findings

### P0: Migration Completion Gaps

- Phase 3 consumer migration is incomplete. Tests, scripts, eval, bench, MCP, and CLI code still import domain internals directly instead of using domain barrels.
- Phase 4 boundary enforcement is incomplete. There is no ESLint-based import policy and the current script only checks coarse dependency direction.
- Domain barrels exist, but many are incomplete or too leaky to serve as stable public APIs.
- `core/config.js` is still widely used as a compatibility façade instead of consumers targeting the correct infrastructure config surface.

### P0: Verification and Tooling Gaps

- `npm test` does not currently satisfy the migration gate; several tests fail.
- `vitest.config.js` coverage instrumentation appears mis-scoped, making coverage output unreliable for the migrated domains.
- There are no contract tests ensuring barrel exports remain complete and correct.
- There are no import-graph tests proving “barrel-only” consumption.

### P1: Architectural Integrity Gaps

- No actual ports/adapters or dependency inversion boundaries are present inside the domains.
- `core/infrastructure/index.js` is too thin, forcing direct imports of infra internals across the codebase.
- Many barrels use broad `export *` behavior and leak implementation details, which weakens ISP and makes internal churn part of the public contract.
- `core/start-server.js` is a side-effectful executable entrypoint, not a clean composition boundary.

### P1: Domain Ownership Problems

- Vocabulary-related logic exists in both `core/embedding/embedding-cache.js` and `core/vocabulary/`.
- `core/infrastructure/llm-provider.js` appears to contain graph/HCGS-specific behavior rather than broadly shared infrastructure.
- `HCGS_CONFIG` and `CEREBRAS_CONFIG` are placed in `translation` config even though they belong to different concerns.
- `core/indexing/index-maintainer.mjs` is in `core/indexing/` even though the original migration plan treated it as a hook-level concern.

### P1: Duplication and Drift

- Quantization utilities exist in more than one place.
- `cosineSimilarity` logic exists in multiple domains.
- Shared mutable singleton state is exported from `embedding-cache.js`, which increases hidden cross-domain coupling.

### P2: Maintainability and Cohesion Problems

- Several files greatly exceed the project’s 500-line target.
- Some modules appear to sit in a domain for migration convenience rather than domain cohesion.
- Some scripts and tests still reference old paths or direct internal files that should be hidden by the public API.

---

## Non-Goals

This plan does **not** require turning the modular monolith into microservices.

This plan does **not** require a full rewrite of core business logic before migration cleanup.

This plan does **not** require splitting every large file immediately. Large-file reduction is included only where it materially improves boundaries, testability, or ownership.

---

## Guiding Principles

1. Finish the migration in the order the architecture depends on, not by random issue count.
2. Make the public API real before tightening enforcement.
3. Add enforcement before doing large cleanup, so regressions stop immediately.
4. Fix domain ownership before introducing ports/adapters, otherwise abstractions will be built on the wrong seams.
5. Treat tests, coverage, and packaging as migration blockers, not cleanup work.

---

## Phase Plan

## Phase 0: Baseline and Verification Repair

**Goal**: re-establish trustworthy verification before more architectural work.

### Tasks

- Fix coverage instrumentation so `core/**/*.js` is actually covered (`vitest.config.js` `include` currently matches only root-level `*.js`, missing all domain code).
- Fix benchmark include pattern: `vitest.config.js:22` references `__tests__/**/*.bench.js` but the sole benchmark (`indexing.bench.js`) has not been relocated. Either move the file or update the pattern.
- Record the current failing test set and classify failures:
  - migration-caused regressions
  - pre-existing unrelated failures
  - environment-sensitive failures
- Add a migration verification checklist that must pass before each later phase is considered done.
- Confirm package entrypoints, pack contents, and runtime paths still resolve after the moved layout.

### Acceptance Criteria

- Coverage instrumentation includes migrated core domains.
- Benchmark config matches actual benchmark file locations.
- There is a documented “known failures” baseline.
- `npm run build` still passes.
- Verification expectations are explicit and reproducible.

---

## Phase 1: Public API Completion

**Goal**: make each domain barrel a usable, intentional integration surface.

### Tasks

- Complete `core/infrastructure/index.js` so it exports the stable shared infra surface needed by consumers.
- Fill barrel gaps in domains where consumer migration is currently blocked:
  - `core/indexing/index.js`
  - `core/search/index.js`
  - `core/vector-store/index.js`
  - any other domain barrel missing currently imported public symbols
- Replace broad `export *` usage where practical with explicit named exports for the supported API.
- Review default exports and ensure façade behavior is consistent across domains.
- Fix `core/infrastructure/config/index.js` default export completeness so config consumers do not receive silent `undefined` values (missing: `MODEL_DELIVERY_CONFIG`, `CASCADE_CONFIG`, `AGENTIC_GITIGNORE_ALLOWLIST`, `loadProjectConfig`, `getVoyageApiKey`, `getJinaApiKey`).
- Add barrel contract tests for each domain: import `* from 'core/<domain>/index.js'` and assert the expected named exports exist. This prevents silent barrel regressions in future changes.

### Acceptance Criteria

- Every symbol needed by external consumers is exported from the owning domain barrel.
- No consumer needs to import `core/<domain>/<internal-file>.js` for legitimate public use.
- Barrel exports are explicit enough to distinguish public API from implementation detail.
- Each domain has a barrel contract test that will fail if a public export is removed.

---

## Phase 2: Consumer Migration

**Goal**: move all non-domain consumers to domain public APIs.

### Scope

- `tests/`
- `__tests__/`
- `scripts/`
- `eval/`
- `evaluation/`
- `bin/`
- `mcp/`
- `training/` where applicable
- `translation/` where applicable

### Tasks

- Replace direct imports of internal domain files with `core/<domain>/index.js` imports.
- Clarify `core/config.js` policy: `core/config.js` remains as a permanent re-export facade for external/package consumers (per `DDD_PLAN.md`). Domain-internal code (files inside `core/`) must import from `../infrastructure/config/index.js` directly, not from `../config.js`. Consumer code outside `core/` (scripts, tests, eval, translation, training) should import from `core/infrastructure/config/index.js` or the infrastructure barrel.
- Fix `mcp/server.js:83-92` dynamic `path.join(__dirname, '..', 'core', ...)` imports. These bypass barrels and ESM resolution. Replace with standard ESM imports from domain barrels so they are caught by future lint rules.
- Restore or replace missing compatibility entrypoints only where required by packaging or external contracts. Specifically: root `ast-chunker.js` was deleted without a stub — either restore it as a re-export or update `eval/scripts/freeze-pattern-chunk-ids.js:8` to use the new path.
- Fix broken path references such as missing root-level compatibility modules if those are still required by consumers.

### Acceptance Criteria

- External consumers import from domain barrels, not internals.
- `core/config.js` usage policy is documented: external consumers may use it, domain-internal code must not.
- `mcp/server.js` uses standard ESM imports, not `path.join` dynamic resolution.
- Remaining exceptions are documented and justified.
- There are no stale path references to deleted or pre-migration files.

---

## Phase 3: Boundary Enforcement

**Goal**: enforce the architecture mechanically.

### Tasks

- Add ESLint `no-restricted-imports` or equivalent boundary rules.
- Upgrade `scripts/check-boundaries.js` to check:
  - forbidden dependency direction
  - barrel-only imports across domains
  - forbidden imports from non-domain internals where a public API exists
  - exceptions with explicit allowlists
- Add CI jobs for:
  - boundary checking
  - barrel contract validation
  - package export validation
- Add tests that fail if a consumer bypasses a domain’s public API.

### Acceptance Criteria

- Architecture rules are enforced in CI.
- Direct cross-domain internal imports fail unless explicitly allowed.
- Boundary policy is documented and machine-checked.

---

## Phase 4: Domain Ownership Cleanup

**Goal**: fix modules and logic that live in the wrong bounded context.

### Tasks

- Consolidate vocabulary ownership:
  - move or extract vocabulary-specific logic from `core/embedding/embedding-cache.js`
  - choose one vocabulary abstraction model
- Re-home graph/HCGS-specific LLM orchestration if `core/infrastructure/llm-provider.js` is not truly shared infrastructure.
- Move `HCGS_CONFIG` and `CEREBRAS_CONFIG` into more coherent configuration modules.
- Fix the only cross-domain dependency matrix violation: `core/graph/hcgs-generator.js:547` dynamically imports `../embedding/embedding-service.js`. The DDD plan forbids graph/ → embedding/ (except CLI-only dynamic lazy-load), but this code path is reachable from the indexer pipeline. Fix via dependency injection: have the caller pass `getEmbedding` as a parameter instead of graph/ reaching into embedding/.
- Decide whether `core/indexing/index-maintainer.mjs` belongs in `core/indexing/` or should be returned to hook-oriented infrastructure consistent with the migration plan.
- Reassess `warmup-metrics.js` domain placement if it is more vocabulary-oriented than search-oriented.

### Acceptance Criteria

- Each module has a clear domain owner.
- Cross-domain logic placement is justified by the domain model, not migration convenience.
- Vocabulary, graph, and infra concerns are no longer mixed opportunistically.
- Zero dependency matrix violations (graph/ → embedding/ resolved).

---

## Phase 5: Duplication Removal and Shared Kernel Decisions

**Goal**: remove duplicate low-level logic and decide what belongs in shared infrastructure versus domain code.

### Tasks

- Deduplicate quantization functions and keep one canonical implementation.
- Deduplicate `cosineSimilarity` and similar primitive scoring helpers.
- Audit other duplicated math / vector / utility code introduced during migration.
- Decide whether certain utilities belong to:
  - a shared kernel
  - infrastructure
  - the owning domain only
- Reduce exported singleton mutable state from `embedding-cache.js` and replace it with explicit service access where practical.

### Acceptance Criteria

- Duplicate implementations are removed or intentionally wrapped.
- Shared primitives have one owner.
- Shared state is explicit and testable.

---

## Phase 6: Ports, Adapters, and Dependency Inversion

**Goal**: align the implementation with the DDD / hexagonal claims in `docs/DDD_PLAN.md`.

### Tasks

- Identify the first set of boundaries that actually need ports:
  - embedding provider access
  - reranking provider access
  - graph summary generation
  - persistence / cache access where direct infra coupling hurts testability
- Introduce abstractions only where they reduce concrete coupling or improve testability.
- Define adapter seams for external services and heavyweight runtime dependencies.
- Reduce direct domain-to-infrastructure imports where a port is more appropriate.
- Keep the scope pragmatic; do not abstract everything.

### Acceptance Criteria

- At least the highest-value integration seams use explicit abstractions.
- Infrastructure implements adapters for domain-defined contracts where appropriate.
- “Ports and adapters” is true in the code, not only in the plan.

---

## Phase 7: Test Coverage Gap Closure

**Goal**: ensure each domain has meaningful test coverage, not just instrumentation.

### Context

The Phase 0 coverage instrumentation fix ensures code is *measured*. This phase ensures it is *tested*. The audit found 42 of ~80 source modules have no corresponding test file — approximately 50% of domain code is untested by name.

### Priority Targets

Domains with the worst coverage-by-module ratios:

| Domain | Modules | Test Files | Gap |
|--------|--------:|----------:|-----|
| vector-store | 6 | 1 | 5 untested |
| infrastructure | 15 | 2 | 13 untested |
| query | 5 | 2 | 3 untested |
| indexing | 12 | 6 | 6 untested |

### Tasks

- For each domain, add at minimum one test file per public-facing module that is imported by other domains or consumers.
- Focus on barrel-import-based testing: tests should import from `core/<domain>/index.js`, not internals.
- Prioritize modules that are cross-domain dependencies (e.g., `db-utils`, `model-fetcher`, `simd-distance`) since breakage there cascades.
- Use London School TDD (mock cross-domain deps) per project convention.

### Acceptance Criteria

- Every domain has test coverage for its barrel-exported public API.
- Cross-domain dependency modules (infrastructure utilities, embedding service, etc.) have dedicated tests.
- Coverage percentage for `core/**/*.js` is measurable and baselined.

---

## Phase 8: Large File Decomposition

**Goal**: split oversized modules where they block ownership clarity, testing, or boundaries.

### Priority Files

- `core/graph/graph-extractor.js` (2304 lines, 4.6x limit)
- `core/graph/graph-search.js` (2018 lines, 4.0x limit)
- `core/indexing/index-maintainer.mjs` (1674 lines, 3.3x limit)

### Secondary Candidates

- `core/vector-store/binary-hnsw-index.js` (1004 lines)
- `core/indexing/artifact-builder.js` (958 lines)
- `core/ranking/late-interaction-index.js` (903 lines)
- `core/embedding/embedding-service.js` (866 lines)
- `core/ranking/flashrank.js` (788 lines)
- other 500+ line modules as needed (24 total over limit)

### Acceptance Criteria

- Decomposition follows domain seams, not arbitrary line-count slicing.
- Resulting modules have clearer ownership and smaller public surfaces.
- Tests remain stable or improve.

---

## Phase 9: Final Migration Closure

**Goal**: formally close the migration and replace “partially migrated” status with enforceable completion.

### Tasks

- Re-run the original DDD migration verification gates against the fixed codebase.
- Confirm no remaining consumers depend on internal files without documented exception.
- Confirm package exports, scripts, and runtime assets all use the new structure.
- Add a short architectural README describing allowed dependency rules and public API usage.
- Mark `docs/DDD_PLAN.md` items complete or superseded by this plan.

### Acceptance Criteria

- Migration gates pass.
- Public API usage is the default pattern throughout the repo.
- Architecture rules are enforced and documented.

---

## Remediation Priority Order

### Immediate

1. Fix coverage instrumentation and benchmark config.
2. Complete barrels, config export gaps, and add barrel contract tests.
3. Migrate consumers to barrels (including MCP `path.join` fix and `config.js` policy).
4. Add enforceable boundary tooling.

### Next

5. Fix domain ownership mistakes (including graph→embedding violation).
6. Remove duplication and global-state leaks.
7. Introduce high-value ports/adapters.

### Then

8. Close test coverage gaps across domains.
9. Split the largest architectural hotspots.
10. Re-run migration closure and verification.

---

## Issue-to-Phase Mapping

| Issue Area | Phase |
|-----------|-------|
| Coverage config broken | 0 |
| Benchmark include pattern mismatch | 0 |
| Failing migration verification | 0 |
| Barrel export gaps | 1 |
| Infrastructure barrel nearly empty | 1 |
| Config default export gaps (6 missing properties) | 1 |
| Barrel contract tests | 1 |
| Phase 3 consumer migration incomplete | 2 |
| Old `core/config.js` compatibility-path overuse | 2 |
| `core/config.js` usage policy (external vs internal) | 2 |
| `mcp/server.js` `path.join` dynamic imports | 2 |
| Missing root `ast-chunker.js` stub | 2 |
| Missing compatibility path / stale references | 2 |
| No ESLint / no restricted imports / weak checker | 3 |
| No import-graph boundary tests | 3 |
| No ports/adapters / concrete coupling everywhere | 6 |
| Vocabulary logic in embedding | 4 |
| `llm-provider.js` domain misplacement | 4 |
| `HCGS_CONFIG` / `CEREBRAS_CONFIG` misplacement | 4 |
| `graph/hcgs-generator.js` → `embedding/` violation | 4 |
| `index-maintainer.mjs` placement | 4 |
| Quantization duplication | 5 |
| `cosineSimilarity` duplication | 5 |
| Shared mutable singleton state | 5 |
| 42 modules with no test coverage | 7 |
| Oversized files (27 over 500 lines) | 8 |

---

## Execution Notes

- Do not start with ports/adapters before fixing the public API and boundary enforcement. That would add abstractions on top of unstable seams.
- Do not split mega-files before clarifying domain ownership, otherwise the split will fossilize the wrong boundaries.
- Do not remove compatibility surfaces blindly. Some may still exist for package, CLI, or benchmark contract reasons.
- Barrel migration and boundary enforcement should land close together so the repo does not immediately drift back.

---

## Definition of Done

The DDD migration is considered complete only when all of the following are true:

- Domain barrels are the normal integration surface.
- External consumers no longer depend on domain internals without documented exception.
- Boundary rules are enforced automatically in CI.
- Config, packaging, runtime paths, and coverage all reflect the new architecture.
- Major ownership mistakes and obvious duplication introduced by migration are corrected.
- The code contains at least the key ports/adapters necessary to justify the architectural claims in `docs/DDD_PLAN.md`.

Until then, the migration should be considered **partially complete**.
