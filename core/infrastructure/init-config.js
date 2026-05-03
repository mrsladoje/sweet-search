/**
 * Shared reader/writer for the init-managed `.sweet-search/config.json`
 * file. Owned by the infrastructure layer because both `scripts/init.js`
 * (writer) and `core/search/sweet-search.js` (reader) need it; placing
 * the helper here avoids a runtime → scripts dependency that would break
 * the DDD boundary check.
 *
 * The file shape is documented in `scripts/init.js::buildConfig` — this
 * module only loads/writes raw JSON, never validates business invariants.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const INIT_DATA_DIR_NAME = '.sweet-search';
export const INIT_CONFIG_FILE_NAME = 'config.json';

/**
 * Path to the project's persisted init config. Pure path math — does not
 * verify the file exists.
 */
export function getInitConfigPath(projectRoot) {
  return join(projectRoot, INIT_DATA_DIR_NAME, INIT_CONFIG_FILE_NAME);
}

/**
 * Load the persisted init config. Returns null when the file is missing
 * or unparseable — never throws. Callers fall back to defaults / env.
 *
 * @param {string} projectRootOrDataDir - either the project root or the
 *   `.sweet-search/` directory itself (init.js passes the latter).
 */
export function loadInitConfig(projectRootOrDataDir) {
  const candidates = [
    join(projectRootOrDataDir, INIT_CONFIG_FILE_NAME),
    join(projectRootOrDataDir, INIT_DATA_DIR_NAME, INIT_CONFIG_FILE_NAME),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Atomically write the init config (tmp + rename). Caller passes a
 * directory that already exists (init.js's `ensureDataDir`). Returns
 * the path that was written.
 */
export function writeInitConfig(dataDir, config) {
  const configPath = join(dataDir, INIT_CONFIG_FILE_NAME);
  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, configPath);
  return configPath;
}

/**
 * Convenience accessor for the LI-policy section of the persisted init
 * config. Returns `{ liModel, searchReranking }` if either field is
 * present, otherwise an empty object — the resolver treats absent fields
 * as "fall through to auto / config defaults".
 */
export function readPersistedLiPolicy(projectRoot) {
  const cfg = loadInitConfig(projectRoot);
  if (!cfg || typeof cfg !== 'object') return {};
  const li = cfg.runtime?.li;
  if (!li || typeof li !== 'object') return {};
  const out = {};
  if (typeof li.model === 'string') out.liModel = li.model;
  if (typeof li.searchReranking === 'string') out.searchReranking = li.searchReranking;
  return out;
}
