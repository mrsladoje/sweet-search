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

import { LATE_INTERACTION_CONFIG } from './config/ranking.js';

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

// ---------------------------------------------------------------------------
// Runtime LI model resolution (Phase 4 follow-up).
//
// Background: scripts/init.js writes the user's chosen LI variant into
// `runtime.li.model` of `.sweet-search/config.json` (one of 'lateon-code',
// 'lateon-code-edge', or 'none'). However the runtime late-interaction
// machinery — encodeQuery, the LI index header check, the native model
// loader, the CoreML cascade dispatcher, the indexer, the prewarm hook —
// all read `LATE_INTERACTION_CONFIG.model` directly from
// `core/infrastructure/config/ranking.js`, which only honours
// `process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL`. Without this bridge
// an edge-only init would silently boot the standard model on every search,
// breaking `read-semantic`, ColGrep, and every encodeQuery path even when
// the persisted choice is correct.
//
// `applyPersistedLiModel` closes that gap. It is called from one place per
// process entry point (SweetSearch ctor, read-semantic CLI/API, server
// startup, prewarm hook) and is fully idempotent + cheap.
//
// Precedence (most-specific wins):
//   1. explicit env var SWEET_SEARCH_LATE_INTERACTION_MODEL  (CI / scripts)
//   2. persisted runtime.li.model in .sweet-search/config.json
//   3. config default ('lateon-code')
//
// `'none'` from persisted config maps to the same disabled state the
// indexer's `--no-late-interaction` flag uses (`model = false`), so
// `LATE_INTERACTION_CONFIG.enabled` collapses to false everywhere LI is
// consulted.
// ---------------------------------------------------------------------------

const VALID_RUNTIME_LI_MODEL_IDS = new Set([
  'lateon-code',
  'lateon-code-edge',
  'none',
]);

/**
 * Resolve the active LI runtime model id given precedence inputs. Pure;
 * does no I/O of its own. Caller passes in the persisted record (or null).
 *
 * Returns one of:
 *   - 'lateon-code'      → standard variant
 *   - 'lateon-code-edge' → edge variant
 *   - false              → LI disabled (matches index-codebase-v21's `--no-late-interaction`)
 *
 * @param {string|null|undefined} persistedModel
 * @param {object} [env=process.env]
 * @param {string} [defaultModel='lateon-code']
 */
export function resolveRuntimeLiModel(
  persistedModel,
  env = process.env,
  defaultModel = 'lateon-code',
) {
  // 1. Explicit env override always wins (preserves the CI/script contract
  //    documented on LATE_INTERACTION_CONFIG.model).
  const fromEnv = env?.SWEET_SEARCH_LATE_INTERACTION_MODEL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    if (fromEnv === 'none') return false;
    if (fromEnv === 'false') return false;
    return fromEnv;
  }
  // 2. Persisted choice from .sweet-search/config.json.
  if (typeof persistedModel === 'string' && VALID_RUNTIME_LI_MODEL_IDS.has(persistedModel)) {
    if (persistedModel === 'none') return false;
    return persistedModel;
  }
  // 3. Default — preserves the historical 'lateon-code' fallback.
  return defaultModel;
}

/**
 * Apply the persisted LI model choice from `.sweet-search/config.json`
 * to the global `LATE_INTERACTION_CONFIG.model`, honouring the precedence
 * ladder documented above. Idempotent + cheap; safe to call from every
 * runtime entry point.
 *
 * Returns a small report object so the caller can log / surface the
 * decision when verbose. Never throws.
 *
 *   {
 *     applied:   'lateon-code' | 'lateon-code-edge' | false,
 *     before:    <prior LATE_INTERACTION_CONFIG.model>,
 *     source:    'env' | 'persisted' | 'default',
 *     persistedModel: <raw persisted value or null>,
 *     changed:   boolean,
 *   }
 *
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]
 * @param {boolean} [opts.force=false] — when true, applies even if the
 *   active value already matches (used by tests resetting state).
 */
export function applyPersistedLiModel(projectRoot, opts = {}) {
  const env = opts.env ?? process.env;

  const before = LATE_INTERACTION_CONFIG.model;

  let persistedModel = null;
  try {
    const persisted = readPersistedLiPolicy(projectRoot);
    persistedModel = typeof persisted.liModel === 'string' ? persisted.liModel : null;
  } catch {
    persistedModel = null;
  }

  const resolved = resolveRuntimeLiModel(persistedModel, env, 'lateon-code');

  let source;
  if (typeof env?.SWEET_SEARCH_LATE_INTERACTION_MODEL === 'string'
      && env.SWEET_SEARCH_LATE_INTERACTION_MODEL.length > 0) {
    source = 'env';
  } else if (persistedModel != null && VALID_RUNTIME_LI_MODEL_IDS.has(persistedModel)) {
    source = 'persisted';
  } else {
    source = 'default';
  }

  if (opts.force === true || resolved !== before) {
    // Mutates the shared LATE_INTERACTION_CONFIG singleton — this is the
    // entire point of this helper. The ESM namespace binding is read-only
    // but the OBJECT it references is the same reference every consumer
    // (encodeQuery, indexer, native-inference, prewarm) holds.
    LATE_INTERACTION_CONFIG.model = resolved;
  }

  return {
    applied: resolved,
    before,
    source,
    persistedModel,
    changed: resolved !== before,
  };
}
