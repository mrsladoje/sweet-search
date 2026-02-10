# DESLOTHIFY Enhancement Notes (Consolidated)

> Master addendum to `DESLOTHIFY.md`, merging relevant fixes and optimizations from all model reviews.

**Date:** 2026-02-10  
**Purpose:** Capture every relevant improvement (high to low priority) so execution can happen with minimal surprises.

---

## 1) Must-Fix Plan Corrections (Before Any Code Changes)

### 1.1 Plan structure and consistency

- Fix duplicate/inconsistent section numbering in `DESLOTHIFY.md` (currently two section-4 blocks and misnumbered script subsections).
- Resolve all placeholder items like "check for..." into explicit actions and target files.
- Reconcile summary counts after final scope is frozen (files renamed/deleted/updated).

### 1.2 `.agentdb` -> `.sweet-search` consistency holes

The plan still contains stale `.agentdb` references in some sections:

- Prewarm terms output path (should be `.sweet-search/vocab-terms.json`).
- `diagnose-int8` default index path (should be `.sweet-search/codebase-binary-hnsw.idx`).

Action:
- Normalize all post-migration runtime paths to `.sweet-search/*`.
- Keep `.agentdb` only in migration/compatibility notes.

### 1.3 Missing updates in active docs/commands

Add explicit update scope for:

- `docs/search/MCP_INTEGRATION.md` (still points to `core/smart-search-v21.js`)
- `HYBRID_SEARCH.md` (`SmartSearch` examples)
- `docs/TRANSLATION.md` (`.agentdb/translation-cache.json`)
- `.claude/commands/index-codebase.md` (`smart-search-v21.js` and `.agentdb/*` file tables)

### 1.4 Keep historical exceptions explicit and minimal

Allowed legacy references should remain only where approved:

- `docs/SEARCH_100x.md`
- `docs/SEARCH_200X.md`
- `RANKING_FIX_PLAN.md`

Everything else should be normalized.

### 1.5 Absolute path hygiene audit (missing explicit scope)

Add a dedicated pass for machine-specific absolute paths and local dev artifacts:

- Detect hardcoded absolute paths such as `/home/...`, `/mnt/c/...`, and `C:\...`.
- Classify each as:
  - intentional fixture/test data (allowlist), or
  - portability risk (replace with relative/project-root based pathing).
- Include release-surface and tooling files in this audit (package metadata, MCP config, scripts, docs).

---

## 2) Rename Coverage Additions

### 2.1 `smart-search` / `SmartSearch` / `SMART_SEARCH_*`

- Update `package.json` beyond `main`:
  - scripts and any CLI entrypoints that still call `core/smart-search-v21.js`
- Ensure all runtime/help strings are updated (not only imports/class names).
- Include shell/C wrappers:
  - `ss.sh`
  - `ss-fast/ss-fast.c`

### 2.2 `search-100x` and `SEARCH 100x` variants

Include both hyphen and space forms in runtime code/logs/comments:

- `search-100x`
- `SEARCH 100x`
- `Search 100x`

Known runtime candidates include:

- `core/config.js`
- `core/index-codebase-v21.js`
- `core/incremental-tracker.js`
- `.claude/helpers/session-preheat.sh`

### 2.3 Socket path rename (recommended)

If product identity cleanup is strict, include:

- `/tmp/search.sock` -> `/tmp/sweet-search.sock`

Audit all references in:

- core server implementation
- `ss.sh`
- `ss-fast/ss-fast.c`
- eval scripts and docs that mention socket path

### 2.4 Optional consistency rename: `index-codebase-v21.js`

Not strictly required, but consistent with removing `v21` from search entrypoint:

- Option A: keep filename (lower risk now)
- Option B: rename to `core/index-codebase.js` (higher consistency, wider blast radius)

If renamed, update all imports/scripts/docs/tests accordingly.

---

## 3) `.agentdb` -> `.sweet-search` Full Coverage

### 3.1 Config + constants + exports

- Update central `DB_PATHS` in `core/config.js` (single source of truth).
- Update any fallback hardcoded paths not derived from `DB_PATHS` (e.g. ColBERT fallback checks).
- In `.claude/hooks/index-maintainer.mjs`:
  - `AGENTDB_DIR` rename (`SWEET_SEARCH_DIR` or `DATA_DIR`)
  - update `CONFIG` export shape
  - update all consumers/tests using `CONFIG.AGENTDB_DIR`

### 3.2 Exclude patterns and self-index protection

Ensure `.sweet-search/` replaces `.agentdb/` in all exclude globs and scanners, so the tool does not index its own artifacts.

### 3.3 Two merkle paths must both be handled

There are two distinct states to migrate:

- `DB_PATHS.merkle`: `.agentdb/merkle-state.json`
- `merkle-tracker` state: `.agentdb/merkle/sloth-codebase.json` -> `.sweet-search/merkle/codebase-state.json`

Add explicit migration mapping for both, to avoid accidental full reindex due to missed state files.

### 3.4 Statusline/hook handler ownership check (important)

`.claude/helpers/statusline.cjs` and `.claude/helpers/hook-handler.cjs` include `memory.db`/AgentDB-related probes used by broader tooling.

Action:
- Determine which paths are Sweet Search runtime data vs external Claude Flow/AQE ecosystem paths.
- Rename only Sweet Search-owned paths; avoid breaking unrelated systems.

### 3.5 Root tooling cleanup

- `check-db.js` in repo root should be explicitly decided:
  - move to `scripts/`, or
  - delete if obsolete one-off.

### 3.6 Environment variable naming contract (must decide once)

Plan currently has ambiguous alternatives. Pick one canonical contract now.

Recommended:

- `SWEET_SEARCH_DATA_DIR` (new canonical)
- temporary alias support for `AGENTDB_PATH` (compatibility window)

### 3.7 `.sweet-search.config.json` contract (define before implementation)

Do not leave this implicit. Define a minimal schema up front so implementation is consistent:

- Required/optional keys (minimum):
  - `include: string[]`
  - `exclude: string[]`
  - `projectRoot?: string`
  - optional tuning flags as needed (`indexDocs`, file size caps, etc.)
- Decide validation behavior:
  - reject unknown keys, or
  - allow passthrough with warnings.
- Document precedence rules between defaults, env, and config file.

---

## 4) Migration and Backward Compatibility

### 4.1 Choose migration behavior now

Do not defer this to implementation. Pick one:

- **Warn-only**: keep user control, more manual work
- **Auto-migrate**: better UX, higher safety requirements
- **Hybrid** (recommended): detect legacy `.agentdb`, perform safe one-time migration with clear logs and fallback handling

### 4.2 Compatibility window (recommended for one release)

- Keep thin shim `core/smart-search-v21.js` re-exporting `core/sweet-search.js`
- Accept old env vars with warning:
  - `SMART_SEARCH_*` -> `SWEET_SEARCH_*`
  - `AGENTDB_PATH` -> `SWEET_SEARCH_DATA_DIR`
- If `.sweet-search/` absent and `.agentdb/` present:
  - read legacy path or migrate immediately (per chosen strategy)

### 4.3 Symlink compatibility (optional)

Optional transitional strategy:

- Create `.agentdb -> .sweet-search` symlink after migration for older scripts.

Use carefully (cross-platform and tooling caveats apply).

### 4.4 Release/migration note

Document both breaking changes clearly for CI/users:

- `.agentdb` -> `.sweet-search`
- env var rename(s)

### 4.5 Migration guardrails (prompt/opt-in safety)

If auto-migrate is enabled, add explicit safety controls:

- Interactive mode: show first-run prompt/confirmation before directory move.
- Non-interactive mode (CI/automation): default to safe warning-only unless explicit migration flag is provided.
- Emit clear rollback guidance if migration fails mid-operation.

---

## 5) Build/Packaging/Distribution Gaps

### 5.1 `npm run build` mismatch

`DESLOTHIFY.md` uses `npm run build`, but current `package.json` has no build script.

Action:
- Either add a real `build` script, or
- change verification to explicit build commands that actually exist.

### 5.2 `ss` binary generation

`package.json` bin includes `ss`, but repository currently uses `ss.sh` and C sources.

Action:
- Make build step explicit for `ss-fast` compilation (if shipping binary).
- Ensure instructions and CI align with actual artifact expectations.

### 5.3 Lockfile regeneration

Do not rely on "auto-update eventually" for `bun.lock`/lockfile entries after rename.

Action:
- add explicit lockfile refresh step post-rename.

### 5.4 Package identity audit

Before release, verify:

- `name`, `bin`, `files`, scripts, entrypoints
- no stale internal names in publish surface.

---

## 6) Verification Upgrade (Content vs Structural)

### 6.1 Separate two verification passes

1) **Content debranding pass** (can exclude approved historical/test fixtures)  
2) **Structural integrity pass** (must include tests/evaluation for import/path breakage)

### 6.2 Pattern set should include variants

Use comprehensive patterns:

- `smart-search|SmartSearch|SMART_SEARCH|smart-search-v21`
- `search-100x|SEARCH 100x|Search 100x`
- `\.agentdb/|AGENTDB_PATH|AGENTDB_DIR`
- `codolis`
- `sloth|SLOTH_|sloth-|sloth/|Sloth Web|Sloth-Local|Sloth-Central`

### 6.3 Include command/hook surfaces in audits

Always include:

- `.claude/commands/**`
- `.claude/hooks/**`
- `.claude/helpers/**`

These frequently retain stale names after core code is cleaned.

### 6.4 Add targeted checks

- Any remaining `/tmp/search.sock` and `/tmp/search-100x*` artifacts
- Remaining `CONFIG.AGENTDB_*` usage
- Remaining `AGENTDB_PATH` references (unless intentionally aliased)
- Remaining stale entries in docs/commands tables
- Remaining machine-specific absolute paths (`/home/`, `/mnt/c/`, `C:\`) outside approved fixtures

---

## 7) Execution Strategy Improvements

### 7.1 Resolve "split vs atomic" tension with a hybrid approach

Two opposing suggestions are both valid:

- Split huge phases for easier debugging
- Keep high-risk renames close to avoid long broken intermediate states

Recommended hybrid:

- One execution session/branch for breaking changes
- Internally split into sub-phases with immediate checks after each sub-phase
- Avoid merging partial broken states

### 7.2 Sub-phase checkpoints for high-risk work

After each major rename block:

1. run tests (`npm test -- --run`)
2. run build command(s) that actually exist
3. run pattern audits
4. smoke query paths (lexical, semantic, hybrid)

### 7.3 Rollback plan

- Use one commit per major phase/sub-phase.
- If a phase regresses behavior, revert only that phase.

### 7.4 Ordering constraints that should be explicit

Add explicit sequence constraints to reduce drift and ambiguous failures:

- Perform `.agentdb` -> `.sweet-search` core path migration before implementing prewarm-vocab output path changes, so a third location is not introduced accidentally.
- After `SmartSearch`/entrypoint rename, run a quick import-resolution sanity pass before bulk doc/path rewrites.
- For `SMART_SEARCH_PERFORMANCE_ARCHITECTURE` docs: apply content updates before or in the same change set as filename rename, to avoid stale transitional references.

---

## 8) Performance/Architecture Optimizations (Low Priority but Valuable)

### 8.1 Project detector caching

In new `project-detector` utility, cache directory-boundary lookups (`Map`) to avoid repeated filesystem walks during indexing.

### 8.2 File pattern broadening guardrails

When making include patterns generic:

- maintain strong excludes for generated/vendor/large artifacts
- consider docs indexing as opt-in or lower weight

This prevents index bloat and slowdowns on large repos.

### 8.3 Single source of truth for data-dir naming

Avoid repeating `.sweet-search` literals across modules.

Recommendation:
- centralize data-dir constant in one module and consume it everywhere (core + hooks).

### 8.4 XDG support (optional nice-to-have)

Optional Linux improvement:

- support `XDG_DATA_HOME` / `XDG_CACHE_HOME` for data placement
- keep `.sweet-search/` as default local-project mode.

### 8.5 MCP tool name collision check (optional)

Current MCP tool name `search` is likely fine, but in multi-server environments it may be generic.

Optional:
- evaluate namespacing strategy if conflicts are observed.

### 8.6 Shell alias/user environment reminder

If users have shell aliases/scripts pinned to old names/paths, include migration guidance in release notes.

---

## 9) Decision Items to Finalize Before Execution

- [ ] Canonical data env var name (`SWEET_SEARCH_DATA_DIR` recommended).
- [ ] Constant naming (`DATA_DIR` vs `SWEET_SEARCH_DIR`).
- [ ] `.agentdb` migration mode (warn-only vs auto-migrate vs hybrid).
- [ ] Whether to rename `index-codebase-v21.js` now.
- [ ] Whether to rename socket path `/tmp/search.sock`.
- [ ] Ownership decision for `statusline.cjs`/`hook-handler.cjs` memory paths.
- [ ] Disposition of root `check-db.js` (move/delete/keep with reason).
- [ ] Handling of `training/evaluate-catboost-router.js` legacy references.
- [ ] `.sweet-search.config.json` schema and validation policy.
- [ ] Absolute path policy (what is allowed as fixture vs what must be replaced).
- [ ] Whether migration requires explicit prompt/opt-in in interactive mode.

---

## 10) Consolidated Pre-Execution Checklist

- [ ] Fix numbering/structure drift in `DESLOTHIFY.md`.
- [ ] Remove stale `.agentdb` references in plan sections (except migration notes).
- [ ] Add missing files to planned scope:
  - [ ] `docs/search/MCP_INTEGRATION.md`
  - [ ] `HYBRID_SEARCH.md`
  - [ ] `docs/TRANSLATION.md`
  - [ ] `.claude/commands/index-codebase.md`
- [ ] Update `package.json` scripts and entrypoints comprehensively.
- [ ] Include `SEARCH 100x` (space variant) replacements in runtime scope.
- [ ] Include command/hook/helper surfaces in rename scope.
- [ ] Add explicit lockfile regeneration step.
- [ ] Make build verification executable (existing command or add script).
- [ ] Add migration/release note tasks.
- [ ] Add structural verification pass that includes tests/evaluation.
- [ ] Define rollback strategy (phase-level commits).
- [ ] Add absolute-path audit task with allowlist policy.
- [ ] Document `.sweet-search.config.json` schema and precedence rules.
- [ ] Add explicit ordering constraints (data-dir before prewarm; import sanity before bulk docs).

---

## 11) Minimal Phase Gate (Updated)

After each high-risk sub-phase:

1. `npm test -- --run`
2. Build verification command(s) that exist in this repo
3. Pattern audit (content + structural):
   - `smart-search|SmartSearch|SMART_SEARCH|smart-search-v21`
   - `search-100x|SEARCH 100x|Search 100x`
   - `\.agentdb/|AGENTDB_PATH|AGENTDB_DIR`
   - `codolis`
   - `sloth|SLOTH_|sloth-|sloth/|Sloth Web|Sloth-Local|Sloth-Central`
4. Smoke test:
   - index a non-Sloth codebase
   - run lexical + semantic + hybrid queries
5. If regressions appear, revert only the phase commit and retry.

