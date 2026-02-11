# DESLOTHIFY Codex Review

Date: 2026-02-11  
Scope reviewed: `DESLOTHIFY.md`, `DESLOTHIFY_FIX.md`, implementation state in repo, and workflow from `docs/claude-flow-guide.md` (route + pre-task used for this review).

## Verification Snapshot

- `npm run build`: PASS
- `npm test`: FAIL (`7` failing tests, all in `__tests__/translation/language-detection.test.js`)

## Findings (Ordered by Severity)

### 1) Critical: Release gate is still red (F-20, F-38 unresolved)

- `npm test` fails on language detection baseline (`7` failing assertions in `__tests__/translation/language-detection.test.js`).
- Root cause appears in `translation/language-detector.js:15`: it imports `../config.js` (non-existent from `translation/`), so `TRANSLATION_CONFIG` stays `null` and `detectLatinLanguage()` returns `null` (`translation/language-detector.js:322-339`).
- This directly leaves DESLOTHIFY_FIX release discipline incomplete (`F-20`, `F-38`).

### 2) High: `/stop` hardening introduced a functional CLI mismatch (F-06 partial regression)

- Server now allows `/stop` only on Unix socket (`core/sweet-search.js:2374-2381`), which is good for security.
- But CLI `--stop` still sends an HTTP request to TCP localhost (`core/sweet-search.js:2761`), so stop behavior is inconsistent and can fail/mislead.
- Net result: secured endpoint, but broken stop path for Node CLI.

### 3) High: `check-db.js` path is still wrong and script is still at repo root (F-13 unresolved)

- `check-db.js:7` uses `path.join(__dirname, '../../.sweet-search/code-graph.db')`, which resolves outside repo when executed from project root.
- DESLOTHIFY_FIX `F-13` asked to fix path resolution and relocate to `scripts/` (or document rationale). Neither is done.

### 4) High: `.sweet-search.config.json` is not consistently respected across indexing entrypoints (F-02 partial)

- Main indexer uses `loadProjectConfig()` (`core/index-codebase-v21.js:318-324`) correctly.
- Hook daemon still uses hardcoded `INDEXABLE_EXTENSIONS` / `EXCLUDED_DIRS` and direct globbing (`.claude/hooks/index-maintainer.mjs:265-275`, `.claude/hooks/index-maintainer.mjs:952-955`).
- This creates config drift between manual indexing and daemon-driven indexing.

### 5) Medium: Prewarm skill requirement is still missing (F-30 unresolved)

- DESLOTHIFY phase 10 requested `/sweet-prewarm-vocab` skill/workflow.
- `scripts/prewarm-vocab.js` rewrite exists, but no corresponding command/skill wiring is present under `.claude/commands/` (script-only completion).

### 6) Medium: MCP integration docs are out of sync with implementation

- Docs claim `listChanged: true` and progress notifications for indexing (`docs/search/MCP_INTEGRATION.md:50-53`, `docs/search/MCP_INTEGRATION.md:105-107`, `docs/search/MCP_INTEGRATION.md:120`).
- Actual server sets `listChanged: false` and `index.idempotentHint: false` and does not emit `notifications/progress` (`mcp/server.js:90-93`, `mcp/server.js:209-213`).
- This is documentation drift and can mislead integrators.

### 7) Medium: Internal naming cleanup is incomplete (F-21 partial)

- Stale internal naming still exists in active runtime comments/headers, e.g. `// SMART SEARCH CLASS` (`core/sweet-search.js:50`).
- Additional “Smart Search” wording remains in active helper docs/scripts (example: `.claude/helpers/session-preheat.sh:4`).

## Suggested Next Fix Order

1. Fix `translation/language-detector.js` config import path and re-run full test suite.
2. Fix Node CLI `--stop` to use Unix socket path (or a secure local token flow) so it matches endpoint policy.
3. Fix and relocate `check-db.js` to `scripts/check-db.js` with repo-root-safe path logic.
4. Make index-maintainer read `.sweet-search.config.json` include/exclude (or clearly document intentional divergence).
5. Either implement `/sweet-prewarm-vocab` workflow wiring or remove/replace the requirement in plan docs.
6. Sync `docs/search/MCP_INTEGRATION.md` to current MCP server behavior.
