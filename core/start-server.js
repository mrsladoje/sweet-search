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

// Same identity as `sweet-search --serve` (core/cli.js): the native ss-* client spawns
// the daemon through this file, so the name in ps and the bench spawn ledger must not
// depend on which entry point started it.
try { process.title = 'sweet-search-daemon'; } catch { /* best-effort */ }
if (process.env.SWEET_SEARCH_SPAWN_LEDGER_DIR) {
  try {
    const { recordSpawn } = await import('./infrastructure/spawn-ledger.js');
    recordSpawn({ pid: process.pid, role: 'daemon-self' });
  } catch { /* best-effort */ }
}

const { startServer } = await import('./search/search-server.js');
await startServer();
