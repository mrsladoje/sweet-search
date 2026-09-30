/**
 * Install the sweet-search opencode harness (project scope, `sweet-search init --opencode`).
 *
 * Everything goes into the project's `.opencode/` directory, which opencode 1.18.4 loads as a
 * project config layer. No AGENTS.md and no root opencode.json are written (an older install's
 * AGENTS.md block is migrated away by init):
 *
 *   .opencode/sweet-search.md             the sweet-search rules
 *   .opencode/sweet-search-prompt.txt     our full build/general agent prompt (scripts/harness-prompts/:
 *                                         opencode 1.18.4's gpt-family prompt minus the Glob/Grep
 *                                         steer, plus our lines = the benchmark arm
 *                                         OC_HARNESS_TRIM=conflict3+todo3eff3k)
 *   .opencode/plugins/sweet-search.mjs    the tool-description plugin (`tool.definition` hook)
 *   .opencode/opencode.json               keys that reference them (merged into an existing file):
 *                                           instructions: [".opencode/sweet-search.md"]
 *                                           plugin: [["./plugins/sweet-search.mjs", {edits}]]
 *                                           tools: {grep: false}
 *                                           agent.build.prompt / agent.general.prompt:
 *                                             "{file:./sweet-search-prompt.txt}\n"
 *                                           agent.explore.disable: true
 *   .opencode/sweet-search-harness.json   manifest: what this module added (file hashes, config keys),
 *                                         so uninstall removes only that and never user content
 *
 * Verified by $0 request capture on opencode 1.18.4: `{file:…}` and a relative plugin path resolve
 * against the config file's directory; an `instructions` entry resolves from the project; the
 * plugin gets its options only when listed in the config (opencode auto-loads `.opencode/plugins/*.js`
 * WITHOUT options, and not `.mjs`, so the listed `.mjs` loads exactly once). `{file:…}` trims the
 * file, so the reference carries the prompt's one trailing newline itself.
 */

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { OPENCODE_TOOL_EDITS, OPENCODE_TRIM_PLUGIN_SOURCE, opencodePrompt } from './harness-prompts/index.js';

export const OPENCODE_DIR_REL = '.opencode';
export const OPENCODE_CONFIG_REL = '.opencode/opencode.json';
export const OPENCODE_RULES_REL = '.opencode/sweet-search.md';
export const OPENCODE_PROMPT_REL = '.opencode/sweet-search-prompt.txt';
export const OPENCODE_PLUGIN_REL = '.opencode/plugins/sweet-search.mjs';
export const OPENCODE_MANIFEST_REL = '.opencode/sweet-search-harness.json';
// Config values. `instructions` resolves from the project root; the others from .opencode/.
export const OPENCODE_RULES_ENTRY = OPENCODE_RULES_REL;
export const OPENCODE_PLUGIN_SPEC = './plugins/sweet-search.mjs';
export const OPENCODE_PROMPT_REF = '{file:./sweet-search-prompt.txt}\n';
const SCHEMA_URL = 'https://opencode.ai/config.json';
const MANIFEST_VERSION = 1;

// What opencode itself writes into a config directory it loads plugins from (it installs
// @opencode-ai/plugin there). Removed with the directory only when init created the directory.
const OPENCODE_BOILERPLATE = new Set(['.gitignore', 'package.json', 'package-lock.json', 'bun.lock', 'node_modules']);

const sha = s => createHash('sha256').update(s).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** The rules file body. */
export function opencodeRulesFile(rules) {
  return `${String(rules).trimEnd()}\n`;
}

/** The plugin entry this module adds to `plugin`. */
export function opencodePluginEntry() {
  return [OPENCODE_PLUGIN_SPEC, { edits: OPENCODE_TOOL_EDITS }];
}

const pluginSpecOf = e => (Array.isArray(e) ? e[0] : e);

function readJson(path) {
  if (!existsSync(path)) return { value: {}, exists: false };
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObj(value)) return { error: `${path} must contain a JSON object` };
    return { value, exists: true };
  } catch (err) {
    return { error: `${path} is not valid JSON: ${err.message}` };
  }
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.sweet-search.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

function fileState(projectRoot, rel, manifest) {
  const path = join(projectRoot, rel);
  if (!existsSync(path)) return 'absent';
  const recorded = manifest?.files?.[rel];
  return recorded && sha(readFileSync(path, 'utf8')) === recorded ? 'ours' : 'user';
}

// The list-valued settings: `has` detects our entry, `add` / `remove` change `cfg` in place,
// `free` is false when the user's value is not a list (then it is left alone).
const SETTINGS = {
  instructions: {
    has: cfg => Array.isArray(cfg.instructions) && cfg.instructions.includes(OPENCODE_RULES_ENTRY),
    add: cfg => { cfg.instructions = [...(Array.isArray(cfg.instructions) ? cfg.instructions : []), OPENCODE_RULES_ENTRY]; },
    remove: cfg => {
      if (!Array.isArray(cfg.instructions)) return;
      cfg.instructions = cfg.instructions.filter(e => e !== OPENCODE_RULES_ENTRY);
      if (!cfg.instructions.length) delete cfg.instructions;
    },
    free: cfg => cfg.instructions === undefined || Array.isArray(cfg.instructions),
  },
  plugin: {
    has: cfg => Array.isArray(cfg.plugin) && cfg.plugin.some(e => pluginSpecOf(e) === OPENCODE_PLUGIN_SPEC),
    add: cfg => {
      const list = Array.isArray(cfg.plugin) ? cfg.plugin.filter(e => pluginSpecOf(e) !== OPENCODE_PLUGIN_SPEC) : [];
      cfg.plugin = [...list, opencodePluginEntry()];
    },
    current: cfg => (Array.isArray(cfg.plugin) ? cfg.plugin.find(e => pluginSpecOf(e) === OPENCODE_PLUGIN_SPEC) : undefined),
    remove: cfg => {
      if (!Array.isArray(cfg.plugin)) return;
      cfg.plugin = cfg.plugin.filter(e => pluginSpecOf(e) !== OPENCODE_PLUGIN_SPEC);
      if (!cfg.plugin.length) delete cfg.plugin;
    },
    free: cfg => cfg.plugin === undefined || Array.isArray(cfg.plugin),
  },
};

// Scalar settings at a path, set only when the user has not set them.
const SCALARS = [
  { key: 'tools.grep', path: ['tools', 'grep'], value: false },
  { key: 'agent.build.prompt', path: ['agent', 'build', 'prompt'], value: OPENCODE_PROMPT_REF },
  { key: 'agent.general.prompt', path: ['agent', 'general', 'prompt'], value: OPENCODE_PROMPT_REF },
  { key: 'agent.explore.disable', path: ['agent', 'explore', 'disable'], value: true },
];

function getPath(obj, path) {
  let o = obj;
  for (const p of path) { if (!isObj(o)) return undefined; o = o[p]; }
  return o;
}
function setPath(obj, path, value) {
  let o = obj;
  for (const p of path.slice(0, -1)) {
    if (o[p] === undefined) o[p] = {};
    if (!isObj(o[p])) return false;
    o = o[p];
  }
  o[path[path.length - 1]] = value;
  return true;
}
function unsetPath(obj, path) {
  const chain = [obj];
  for (const p of path.slice(0, -1)) {
    const o = chain[chain.length - 1][p];
    if (!isObj(o)) return;
    chain.push(o);
  }
  delete chain[chain.length - 1][path[path.length - 1]];
  // Drop containers the removal left empty.
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length) break;
    delete chain[i - 1][path[i - 1]];
  }
}

/**
 * Install (or refresh) the opencode harness. Idempotent. Never throws.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string|null} [args.rules]  the rules text for .opencode/sweet-search.md; null = none
 * @param {boolean} [args.prompt]     ship our prompt, plugin, grep off and explore off
 * @returns {{status: string, detail: string, warning?: string}} status in { installed, unchanged, error }
 */
export function installOpencodeHarness({ projectRoot, rules = null, prompt = true } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'install-opencode-harness: projectRoot is required' };
  const configPath = join(projectRoot, OPENCODE_CONFIG_REL);
  const manifestPath = join(projectRoot, OPENCODE_MANIFEST_REL);
  const configRead = readJson(configPath);
  if (configRead.error) return { status: 'error', detail: configRead.error };
  const manifestRead = readJson(manifestPath);
  const manifest = manifestRead.error ? {} : manifestRead.value;
  const dirExisted = existsSync(join(projectRoot, OPENCODE_DIR_REL));
  const cfg = configRead.value;
  const before = JSON.stringify(cfg);
  const added = { ...(manifest.added || {}) };
  const next = {
    version: MANIFEST_VERSION,
    files: { ...(manifest.files || {}) },
    createdDir: manifestRead.exists ? Boolean(manifest.createdDir) : !dirExisted,
    createdConfig: manifestRead.exists ? Boolean(manifest.createdConfig) : !configRead.exists,
    added,
  };
  const changes = [];
  const warnings = [];

  try {
    // 1. Files.
    const wantedFiles = {
      [OPENCODE_RULES_REL]: rules != null ? opencodeRulesFile(rules) : null,
      [OPENCODE_PROMPT_REL]: prompt ? opencodePrompt() : null,
      [OPENCODE_PLUGIN_REL]: prompt ? readFileSync(OPENCODE_TRIM_PLUGIN_SOURCE, 'utf8') : null,
    };
    const fileOk = {};
    for (const [rel, content] of Object.entries(wantedFiles)) {
      const state = fileState(projectRoot, rel, manifest);
      const path = join(projectRoot, rel);
      if (content == null) {
        if (state === 'ours') { unlinkSync(path); changes.push(`removed ${rel}`); }
        delete next.files[rel];
        continue;
      }
      if (state === 'user') {
        warnings.push(`${rel} is user-authored and was kept; sweet-search does not reference it.`);
        delete next.files[rel];
        continue;
      }
      if (!(state === 'ours' && readFileSync(path, 'utf8') === content)) {
        writeAtomic(path, content);
        changes.push(rel);
      }
      next.files[rel] = sha(content);
      fileOk[rel] = true;
    }

    // 2. Config keys.
    if (!configRead.exists && cfg.$schema === undefined) { cfg.$schema = SCHEMA_URL; added.$schema = true; }
    const want = {
      instructions: Boolean(fileOk[OPENCODE_RULES_REL]),
      plugin: Boolean(fileOk[OPENCODE_PLUGIN_REL]),
    };
    for (const [name, s] of Object.entries(SETTINGS)) {
      if (want[name]) {
        if (!s.free(cfg)) { warnings.push(`${OPENCODE_CONFIG_REL} "${name}" is not a list; left as it is.`); continue; }
        if (!s.has(cfg)) { s.add(cfg); added[name] = true; }
        else if (added[name] && s.current && !same(s.current(cfg), opencodePluginEntry())) s.add(cfg); // refresh our edits
      } else if (added[name]) {
        s.remove(cfg);
        delete added[name];
      }
    }
    const wantPrompt = Boolean(fileOk[OPENCODE_PROMPT_REL]);
    for (const { key, path, value } of SCALARS) {
      const wanted = key.startsWith('agent.build') || key.startsWith('agent.general') ? wantPrompt : prompt;
      const cur = getPath(cfg, path);
      if (wanted) {
        if (cur === undefined) {
          if (setPath(cfg, path, value)) added[key] = true;
          else warnings.push(`${OPENCODE_CONFIG_REL} ${path.slice(0, -1).join('.')} is not an object; ${key} not set.`);
        } else if (!added[key] && !same(cur, value)) {
          warnings.push(`${OPENCODE_CONFIG_REL} already sets ${key}; kept yours.`);
        }
      } else if (added[key]) {
        if (same(cur, value)) unsetPath(cfg, path);
        delete added[key];
      }
    }
    if (JSON.stringify(cfg) !== before || !configRead.exists) {
      writeAtomic(configPath, JSON.stringify(cfg, null, 2) + '\n');
      changes.push(`${OPENCODE_CONFIG_REL} (${Object.keys(added).filter(k => k !== '$schema').join(', ') || 'no keys'})`);
    }

    if (!manifestRead.exists || !same(manifest, next)) writeAtomic(manifestPath, JSON.stringify(next, null, 2) + '\n');
  } catch (err) {
    return { status: 'error', detail: err.message };
  }

  const result = {
    status: changes.length ? 'installed' : 'unchanged',
    detail: changes.length ? changes.join('; ') : 'opencode harness already installed',
  };
  if (warnings.length) result.warning = warnings.join(' ');
  return result;
}

/**
 * Reverse `installOpencodeHarness`: remove only what the manifest says this module added and the
 * user did not change since. A hand-edited file is kept and named in `kept`.
 *
 * @returns {{status: string, detail: string, kept?: string[]}} status in { removed, not-found, dry-run, error }
 */
export function removeOpencodeHarness({ projectRoot, dryRun = false } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'remove-opencode-harness: projectRoot is required' };
  const manifestPath = join(projectRoot, OPENCODE_MANIFEST_REL);
  const manifestRead = readJson(manifestPath);
  if (manifestRead.error) return { status: 'error', detail: manifestRead.error };
  if (!manifestRead.exists) return { status: 'not-found', detail: 'no opencode harness manifest' };
  const manifest = manifestRead.value;
  const added = manifest.added || {};
  const configPath = join(projectRoot, OPENCODE_CONFIG_REL);
  const configRead = readJson(configPath);
  const kept = [];
  const ownedFiles = Object.keys(manifest.files || {}).filter(rel => fileState(projectRoot, rel, manifest) === 'ours');
  for (const rel of Object.keys(manifest.files || {})) {
    if (!ownedFiles.includes(rel) && existsSync(join(projectRoot, rel))) kept.push(`${rel} (edited by hand)`);
  }
  const keys = Object.keys(added).filter(k => k !== '$schema');
  const parts = [...ownedFiles, ...(keys.length ? [`${OPENCODE_CONFIG_REL} keys (${keys.join(', ')})`] : [])];
  if (configRead.error) kept.push(`${OPENCODE_CONFIG_REL} (not valid JSON; left as it is)`);
  if (dryRun) return { status: 'dry-run', detail: parts.join(' + ') || 'manifest only', kept };

  try {
    if (configRead.exists && !configRead.error) {
      const cfg = configRead.value;
      for (const [name, s] of Object.entries(SETTINGS)) if (added[name]) s.remove(cfg);
      for (const { key, path, value } of SCALARS) {
        if (added[key] && same(getPath(cfg, path), value)) unsetPath(cfg, path);
      }
      if (added.$schema && cfg.$schema === SCHEMA_URL && Object.keys(cfg).length === 1) delete cfg.$schema;
      if (manifest.createdConfig && Object.keys(cfg).length === 0) unlinkSync(configPath);
      else writeAtomic(configPath, JSON.stringify(cfg, null, 2) + '\n');
    }
    for (const rel of ownedFiles) unlinkSync(join(projectRoot, rel));
    unlinkSync(manifestPath);
    const dir = join(projectRoot, OPENCODE_DIR_REL);
    try { rmdirSync(join(dir, 'plugins')); } catch { /* absent or not empty */ }
    const left = existsSync(dir) ? readdirSync(dir) : [];
    if (manifest.createdDir && left.every(name => OPENCODE_BOILERPLATE.has(name)) && isOpencodeBoilerplate(dir, left)) {
      rmSync(dir, { recursive: true, force: true });
      if (left.length) parts.push(`${OPENCODE_DIR_REL}/ (with opencode's own ${left.join(', ')})`);
    } else if (!left.length) {
      try { rmdirSync(dir); } catch { /* keep */ }
    }
    return { status: 'removed', detail: parts.join(' + ') || 'manifest only', kept };
  } catch (err) {
    return { status: 'error', detail: err.message, kept };
  }
}

// The files opencode writes into a plugin config directory: a .gitignore listing its install
// artefacts and a package.json that depends only on @opencode-ai/plugin.
function isOpencodeBoilerplate(dir, names) {
  try {
    if (names.includes('.gitignore')) {
      const lines = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.every(l => OPENCODE_BOILERPLATE.has(l))) return false;
    }
    if (names.includes('package.json')) {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (!isObj(pkg) || Object.keys(pkg).some(k => k !== 'dependencies')) return false;
      if (Object.keys(pkg.dependencies || {}).some(k => k !== '@opencode-ai/plugin')) return false;
    }
    return true;
  } catch {
    return false;
  }
}
