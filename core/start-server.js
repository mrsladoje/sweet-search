#!/usr/bin/env node
// Minimal server-start entry point — avoids the circular import in sweet-search.js.
// Used by the Rust CLI's auto_start_server() to spawn the background server,
// and by the SessionStart daemon-prewarm hook (core/search/session-daemon-prewarm.mjs)
// when Claude Code opens a new session.

// Apply the user's persisted `runtime.li.model` from .sweet-search/config.json
// BEFORE importing search-server (which transitively imports session-warmup,
// which gates warmup steps on `LATE_INTERACTION_CONFIG.enabled` and triggers a
// warmup search using `LATE_INTERACTION_CONFIG.model`). Without this, an
// edge-only init still spawns a daemon that prewarms the standard model.
const projectRoot = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
const { applyPersistedLiModel } = await import('./infrastructure/init-config.js');
applyPersistedLiModel(projectRoot);

const { startServer } = await import('./search/search-server.js');
await startServer();
