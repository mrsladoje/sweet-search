/**
 * Project-local MCP server registration for sweet-search.
 *
 * `sweet-search init --mcp` writes a `sweet-search` entry into the project's
 * root `.mcp.json` — the project-scoped MCP config read by Claude Code and other
 * MCP hosts (see docs/search/MCP_INTEGRATION.md §`.mcp.json`). Additive and
 * idempotent: existing servers and any other top-level keys are preserved; only
 * `mcpServers.sweet-search` is created/updated.
 *
 * Design notes:
 *  - This is ROOT-level and harness-agnostic. It is independent of `--no-claude`
 *    (which gates `.claude/*` writes only). `.mcp.json` lives at the repo root.
 *  - The MCP server is a thin adapter over the SAME engine the CLI wraps. `--mcp`
 *    ADDS it; it never replaces the CLI. `--no-cli` only swaps the agent's
 *    *contact surface* to MCP — indexing still runs through the CLI/engine.
 *  - We never clobber an unparseable user `.mcp.json`; we fail loudly instead.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MCP_CONFIG_FILE = '.mcp.json';
export const MCP_SERVER_KEY = 'sweet-search';

/**
 * The canonical server entry. Uses `npx -y sweet-search-mcp` (the published bin)
 * so the registration keeps working after a global/local install without a
 * hard-coded path, and pins the target repo via `--project-root`.
 */
export function buildServerEntry({ projectRoot }) {
  return {
    command: 'npx',
    args: ['-y', 'sweet-search-mcp', '--project-root', projectRoot],
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Install/update the sweet-search MCP server registration.
 * Idempotent. Returns `{ status, path, detail? }` where status is one of:
 *   'created'   — wrote a fresh .mcp.json
 *   'added'     — file existed, added our server entry
 *   'updated'   — our entry existed but differed; rewritten
 *   'unchanged' — our entry already matches
 *   'error'     — existing file is not a usable JSON object (left untouched)
 */
export function installMcpServer({ projectRoot, configFile = MCP_CONFIG_FILE } = {}) {
  if (!projectRoot) throw new TypeError('install-mcp-server: projectRoot is required');
  const configPath = join(projectRoot, configFile);
  const entry = buildServerEntry({ projectRoot });

  let config = {};
  const existed = existsSync(configPath);
  if (existed) {
    let raw;
    try {
      raw = readFileSync(configPath, 'utf8');
    } catch (err) {
      return { status: 'error', path: configPath, detail: `cannot read ${configFile}: ${err.message}` };
    }
    try {
      config = JSON.parse(raw);
    } catch (err) {
      return { status: 'error', path: configPath, detail: `existing ${configFile} is not valid JSON: ${err.message}` };
    }
    if (!isPlainObject(config)) {
      return { status: 'error', path: configPath, detail: `existing ${configFile} is not a JSON object` };
    }
  }

  if (!isPlainObject(config.mcpServers)) config.mcpServers = {};

  const prev = config.mcpServers[MCP_SERVER_KEY];
  if (prev && deepEqual(prev, entry)) {
    return { status: 'unchanged', path: configPath };
  }
  const hadEntry = prev !== undefined;
  config.mcpServers[MCP_SERVER_KEY] = entry;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return { status: existed ? (hadEntry ? 'updated' : 'added') : 'created', path: configPath };
}

/**
 * Reverse `installMcpServer`. Removes only our `mcpServers.sweet-search` entry,
 * preserving any other servers / top-level keys. Deletes the file outright only
 * when it becomes wholly empty (no other servers, no other top-level keys).
 * @returns 'removed' | 'file-deleted' | 'not-found' | 'dry-run'
 */
export function removeMcpServer({ projectRoot, configFile = MCP_CONFIG_FILE, dryRun = false } = {}) {
  if (!projectRoot) throw new TypeError('remove-mcp-server: projectRoot is required');
  const configPath = join(projectRoot, configFile);
  if (!existsSync(configPath)) return 'not-found';
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return 'not-found'; // unparseable / not ours — never touch it
  }
  if (!isPlainObject(config) || !isPlainObject(config.mcpServers) || !(MCP_SERVER_KEY in config.mcpServers)) {
    return 'not-found';
  }
  if (dryRun) return 'dry-run';

  delete config.mcpServers[MCP_SERVER_KEY];
  const hasOtherServers = Object.keys(config.mcpServers).length > 0;
  const hasOtherKeys = Object.keys(config).some((k) => k !== 'mcpServers');
  if (!hasOtherServers && !hasOtherKeys) {
    unlinkSync(configPath);
    return 'file-deleted';
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return 'removed';
}
