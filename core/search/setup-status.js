// `sweet-search status`: what is set up for this project, and the one next step.
//
// It answers the questions an agent asks after a failed setup: did the install scripts
// run, was init run, are the models present and can their cache be written,
// which parts of the index exist, does the search server run, and what to run next.
// It reads files and probes the server socket; it never loads a model or an index.

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DB_PATHS, MODEL_DELIVERY_CONFIG, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { loadInitConfig, resolveRuntimeLiModel } from '../infrastructure/init-config.js';
import { MODEL_REGISTRY } from '../infrastructure/model-registry.js';
import { baselineStatus } from '../incremental-indexing/infrastructure/baseline-readiness.mjs';
import { readManifest } from '../incremental-indexing/infrastructure/manifest.mjs';
import { classifyProvenance, describeEncoders } from '../indexing/inference-provenance.js';
import { daemonLogPath } from './daemon-log.js';
import { projectSocketPath } from './server-identity.js';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The embedding model every search setup needs, plus the late-interaction model in use. */
export function requiredModelKeys(liModel) {
  return ['coderankembed-int8', ...(liModel ? [liModel] : [])];
}

/** Present when every file of the model is in the cache at its registry size. */
export function modelPresence(key, cacheRoot, stat = statSync) {
  const entry = MODEL_REGISTRY[key];
  if (!entry) return { key, present: false, missingBytes: 0 };
  const dir = path.join(cacheRoot, entry.hfId.replace('/', '--'));
  let missingBytes = 0;
  for (const file of entry.files) {
    let size = -1;
    try { size = stat(path.join(dir, file.path)).size; } catch { /* missing */ }
    if (size !== file.sizeBytes) missingBytes += file.sizeBytes || 0;
  }
  return { key, present: missingBytes === 0, missingBytes };
}

/** Can this process create files under `dir`? Checks the nearest existing ancestor. */
export function isWritableDir(dir, access = accessSync, exists = existsSync) {
  let current = path.resolve(dir);
  while (!exists(current)) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    access(current, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function probeServer(socketPath, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: '/health', method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ state: 'running', health: JSON.parse(body) }); }
        catch { resolve({ state: 'running', health: null }); }
      });
    });
    req.on('error', (err) => {
      resolve({ state: ['ENOENT', 'ECONNREFUSED'].includes(err?.code) ? 'not-running' : 'unknown', health: null });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ state: 'busy', health: null }); });
    req.end();
  });
}

function readMerkleStats(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    return {
      lastIndex: state.lastIndex || null,
      files: state.stats?.totalFiles ?? Object.keys(state.files || {}).length,
      chunks: state.stats?.totalChunks ?? null,
    };
  } catch {
    return null;
  }
}

/** Which encoder backends wrote the stored vectors (inference-provenance.js). */
function readEncoders(stateDir) {
  try {
    const manifest = readManifest(stateDir);
    if (!manifest) return null;
    return {
      dense: describeEncoders(manifest.vectors?.encoders),
      lateInteraction: describeEncoders(manifest.lateInteraction?.encoders),
      ...classifyProvenance(manifest),
    };
  } catch {
    return null;
  }
}

const MB = 1024 * 1024;

/**
 * The one step that unblocks search, in the order a setup fails: install, models, index,
 * server. Pure, so tests can walk every branch.
 */
export function nextStep(status) {
  const { install, setup, models, index, server } = status;
  if (install.skippedPostinstall) return install.skippedPostinstall.fix;
  const missing = models.required.filter((m) => !m.present);
  if (missing.length > 0) {
    if (!models.cacheWritable) {
      return `allow writes to ${models.cacheRoot}, or set SWEET_SEARCH_MODEL_CACHE to a writable directory, then run: sweet-search init`;
    }
    return setup.initialized && setup.modelsDeferred
      ? 'sweet-search index (it downloads the missing models first)'
      : 'sweet-search init';
  }
  if (!index.ready) {
    return index.reason === 'config-fingerprint-mismatch' || index.reason === 'li-format-outdated'
      ? 'sweet-search index --full' : 'sweet-search index';
  }
  if (server.state === 'failed') return 'sweet-search daemon restart';
  return null;
}

export async function collectSetupStatus({ env = process.env } = {}) {
  const projectRoot = PROJECT_ROOT;
  const stateDir = path.dirname(DB_PATHS.merkle);

  let skippedPostinstall = null;
  try {
    const { detectSkippedPostinstall } = await import('../../scripts/init.js');
    skippedPostinstall = detectSkippedPostinstall(PACKAGE_ROOT);
  } catch { /* init script not shipped: nothing to check */ }

  let version = null;
  try { version = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version; } catch { /* */ }

  const config = loadInitConfig(projectRoot);
  const liModel = resolveRuntimeLiModel(config?.runtime?.li?.model, env);
  const cacheRoot = MODEL_DELIVERY_CONFIG.modelCacheRoot;
  const required = requiredModelKeys(liModel).map((key) => modelPresence(key, cacheRoot));

  const baseline = baselineStatus(stateDir);
  const parts = {
    codeGraph: existsSync(DB_PATHS.codeGraph),
    searchDatabase: existsSync(DB_PATHS.codebase),
    vectorIndex: existsSync(DB_PATHS.binaryHnswIndex),
    lateInteraction: liModel ? existsSync(DB_PATHS.lateInteraction) : null,
  };

  const socketPath = projectSocketPath();
  const probe = await probeServer(socketPath);
  let serverState = probe.state;
  if (probe.health?.status === 'failed') serverState = 'failed';
  else if (probe.health?.status === 'starting') serverState = 'starting';
  else if (probe.health) serverState = 'ready';

  const status = {
    projectRoot,
    install: { version, packageRoot: PACKAGE_ROOT, skippedPostinstall },
    setup: {
      initialized: Boolean(config),
      // init --skip-models: the first index downloads the models
      modelsDeferred: config?.runtime?.allowRuntimeModelDownload === true,
      liModel: liModel || 'none',
    },
    models: { cacheRoot, cacheWritable: isWritableDir(cacheRoot), required },
    index: {
      ready: baseline.ready,
      reason: baseline.reason,
      parts,
      state: readMerkleStats(DB_PATHS.merkle),
      encoders: readEncoders(stateDir),
    },
    server: {
      state: serverState,
      pid: probe.health?.pid ?? null,
      error: probe.health?.init?.error ?? null,
      socket: socketPath,
      log: daemonLogPath(projectRoot),
    },
  };
  status.nextStep = nextStep(status);
  return status;
}

const INDEX_REASONS = {
  'no-state-dir': 'nothing indexed yet',
  'no-manifest': 'no complete index yet',
  'manifest-epoch-zero': 'no complete index yet',
  'no-merkle-state': 'no complete index yet',
  'no-config-fingerprint': 'no complete index yet (only part of it was built)',
  'config-fingerprint-mismatch': 'built by an older index format; it needs a full rebuild',
  'missing-vectors-db': 'the search database is missing',
  'li-format-outdated': 'its late-interaction index is in an older single-file format; it needs a full rebuild',
};

const SERVER_STATES = {
  ready: 'ready',
  starting: 'starting (loading the index)',
  busy: 'running, too busy to answer',
  failed: 'failed',
  'not-running': 'not running (it starts on the first search)',
  unknown: 'unknown',
};

export function formatSetupStatus(s) {
  const yes = (v) => (v ? 'yes' : 'no');
  const lines = [];
  lines.push(`Sweet Search status for ${s.projectRoot}`);
  lines.push('');
  lines.push(`Package: sweet-search ${s.install.version ?? '(unknown version)'} at ${s.install.packageRoot}`);
  if (s.install.skippedPostinstall) {
    lines.push('  Install scripts: did not run (npm blocked them)');
  }
  if (s.setup.initialized) {
    const deferred = s.setup.modelsDeferred ? ' with --skip-models (models download on the first index)' : '';
    lines.push(`Init: done${deferred}; late-interaction model: ${s.setup.liModel}`);
  } else {
    lines.push('Init: not run in this project');
  }
  lines.push(`Models: ${s.models.cacheRoot} (writable: ${yes(s.models.cacheWritable)})`);
  for (const m of s.models.required) {
    const detail = m.present ? 'present' : `missing (${Math.ceil(m.missingBytes / MB)} MB to download)`;
    lines.push(`  ${m.key}: ${detail}`);
  }
  const p = s.index.parts;
  lines.push(`Index: ${s.index.ready ? 'complete' : INDEX_REASONS[s.index.reason] || s.index.reason}`);
  lines.push(`  Code graph: ${yes(p.codeGraph)}`);
  lines.push(`  Search database (text and vectors): ${yes(p.searchDatabase)}`);
  lines.push(`  Vector index: ${yes(p.vectorIndex)}`);
  if (p.lateInteraction !== null) lines.push(`  Late-interaction index: ${yes(p.lateInteraction)}`);
  if (s.index.ready && s.index.state) {
    const chunks = s.index.state.chunks != null ? `, ${s.index.state.chunks} chunks` : '';
    lines.push(`  Last full index: ${s.index.state.lastIndex} (${s.index.state.files} files${chunks})`);
  }
  const enc = s.index.encoders;
  if (s.index.ready && enc) {
    if (enc.dense) lines.push(`  Dense vectors written by: ${enc.dense}`);
    if (enc.lateInteraction) lines.push(`  Late-interaction vectors written by: ${enc.lateInteraction}`);
    for (const note of enc.notes) lines.push(`  Note: ${note}`);
  }
  const pid = s.server.pid ? `, process id ${s.server.pid}` : '';
  lines.push(`Search server: ${SERVER_STATES[s.server.state] || s.server.state}${pid}`);
  if (s.server.error) lines.push(`  Error: ${s.server.error}`);
  if (s.server.log) lines.push(`  Log: ${s.server.log}`);
  lines.push('');
  lines.push(s.nextStep ? `Next step: ${s.nextStep}` : 'Ready. Search with: sweet-search "<query>"');
  return lines.join('\n');
}

/** Exit code 0 when search can run now (no next step), else 1. */
export async function runStatusCli(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: sweet-search status [--json]

Shows what is set up for this project: install scripts, init, models, index parts
and the search server. The last line names the next command to run.
Exit code 0 means search is ready; 1 means a step is missing.`);
    return;
  }
  const status = await collectSetupStatus();
  console.log(args.includes('--json') ? JSON.stringify(status, null, 2) : formatSetupStatus(status));
  process.exitCode = status.nextStep ? 1 : 0;
}
