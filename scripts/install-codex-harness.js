/**
 * Install the sweet-search Codex CLI harness (project scope, `sweet-search init --codex`).
 *
 * Everything goes into the project's `.codex/` layer; AGENTS.md is NOT written (an older install's
 * AGENTS.md block is migrated away by init):
 *
 *   .codex/sweet-search-instructions.md   our full base instructions (scripts/harness-prompts/:
 *                                         codex 0.146.1's own text minus the `rg` search steer,
 *                                         plus our tool-grouping lines = the benchmark arm
 *                                         CODEX_HARNESS_TRIM=conflict + CODEX_TRIM_BATCH=yt3batch2)
 *   .codex/config.toml                    a marked block at the top with two top-level keys:
 *                                           model_instructions_file = "sweet-search-instructions.md"
 *                                             REPLACES Codex's own base instructions. Codex resolves
 *                                             a relative path against the config file's directory
 *                                             (.codex/), so it works from any cwd in the repo and no
 *                                             machine path lands in a committed file ($0 capture,
 *                                             codex 0.146.1).
 *                                           developer_instructions = the sweet-search rules
 *                                             (sent as a developer message)
 *                                         plus `[features] hooks = true` for the SessionStart hook
 *   .codex/sweet-search-harness.json      manifest: what this module added (file and block hashes,
 *                                         whether it created config.toml, the [features] table or
 *                                         the hooks flag), so uninstall removes only that and never
 *                                         user content
 *
 * Codex reads a project `.codex/config.toml` only for a TRUSTED project. `codex exec` silently
 * ignores it for an untrusted one (stock prompt, no rules); the interactive TUI asks "Do you trust
 * the contents of this directory?" on first start and records the answer in ~/.codex/config.toml.
 */

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { codexInstructions } from './harness-prompts/index.js';

export const CODEX_DIR_REL = '.codex';
export const CODEX_CONFIG_REL = '.codex/config.toml';
export const CODEX_INSTRUCTIONS_REL = '.codex/sweet-search-instructions.md';
export const CODEX_MANIFEST_REL = '.codex/sweet-search-harness.json';
// Relative to the config file's directory (see the header).
export const CODEX_INSTRUCTIONS_CONFIG_VALUE = 'sweet-search-instructions.md';
const MANIFEST_VERSION = 1;

const BLOCK_BEGIN = '# >>> sweet-search: added by `sweet-search init --codex`; `sweet-search uninstall` removes it';
const BLOCK_END = '# <<< sweet-search';
const BLOCK_RE = /^# >>> sweet-search[^\n]*\n[\s\S]*?^# <<< sweet-search[^\n]*(?:\n|$)/m;
const OWNED_KEYS = Object.freeze(['model_instructions_file', 'developer_instructions']);

const sha = s => createHash('sha256').update(s).digest('hex');

/** TOML basic string (JSON escapes are valid TOML escapes; TOML also forbids a literal U+007F). */
export function tomlBasicString(text) {
  return JSON.stringify(String(text)).replace(/\u007f/g, '\\u007F');
}

/**
 * The rules as a TOML value that parses to `text` exactly. A multi-line literal string keeps the
 * rules readable in config.toml; a basic string is the fallback when the text holds `'''` or a
 * control character a literal string cannot carry.
 */
export function tomlRulesString(text) {
  const s = String(text);
  if (s.includes("'''") || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(s) || s.endsWith("'")) return tomlBasicString(s);
  return `'''\n${s}'''`;
}

/** The marked block that carries our top-level keys. */
export function buildCodexConfigBlock({ instructionsFile = false, rules = null } = {}) {
  const lines = [BLOCK_BEGIN];
  if (instructionsFile) lines.push(`model_instructions_file = ${tomlBasicString(CODEX_INSTRUCTIONS_CONFIG_VALUE)}`);
  if (rules != null) lines.push(`developer_instructions = ${tomlRulesString(`${String(rules).trimEnd()}\n`)}`);
  lines.push(BLOCK_END);
  return `${lines.join('\n')}\n`;
}

function readJson(path) {
  if (!existsSync(path)) return { value: {}, exists: false };
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: `${path} must contain a JSON object` };
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

/** Top-level keys the user set outside our block (the region before the first table header). */
function userTopLevelKeys(text) {
  const outside = text.replace(BLOCK_RE, '');
  const head = outside.split(/^[ \t]*\[/m)[0];
  return OWNED_KEYS.filter(k => new RegExp(`^[ \\t]*${k}[ \\t]*=`, 'm').test(head));
}

// ---------------------------------------------------------------------------------------------
// [features] hooks flag
// ---------------------------------------------------------------------------------------------

/**
 * Ensure the canonical Codex hooks feature flag `[features] hooks = true` is
 * present in a Codex `config.toml`, preserving the file's existing content +
 * comments. Targeted text edit (no TOML round-trip) so a hand-curated config is
 * never reformatted.
 *
 * `hooks` is the canonical key as of Codex v0.132+. The earlier `codex_hooks`
 * key is deprecated (Codex now prints a deprecation warning for it), so this
 * function also MIGRATES a legacy `codex_hooks` flag to `hooks` instead of
 * writing the deprecated name. Legacy handling is deliberate: users who ran an
 * older sweet-search (which wrote `codex_hooks`) or older Codex shouldn't be
 * left with a deprecated, warning-producing flag.
 *
 * Behaviour:
 *   - `hooks = true` already present → no-op ('already'); if a deprecated
 *     `codex_hooks` line also lingers, strip it ('migrated')
 *   - `hooks` present but non-true → respect the user's choice ('present-other')
 *   - legacy `codex_hooks` present (no `hooks` key) → rename the key to `hooks`
 *     in place, preserving its value + inline comment ('migrated')
 *   - a `[features]` table exists → insert `hooks = true` under its header
 *   - no `[features]` table → append a fresh block at EOF
 *   - file absent + `create` → create it; absent + no `create` → 'absent'
 *
 * @param {string} configPath
 * @param {{create?:boolean}} [opts]
 * @returns {{status:'created'|'added'|'migrated'|'already'|'present-other'|'absent'|'error', path:string, detail?:string}}
 */
export function ensureCodexHooksFeatureFlag(configPath, { create = false } = {}) {
  const exists = existsSync(configPath);
  if (!exists && !create) return { status: 'absent', path: configPath };

  let text = '';
  if (exists) {
    try {
      text = readFileSync(configPath, 'utf-8');
    } catch (err) {
      return { status: 'error', path: configPath, detail: `read failed: ${err.message}` };
    }
  }

  const write = (next, status) => {
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      const tmp = configPath + '.tmp';
      writeFileSync(tmp, next, 'utf-8');
      renameSync(tmp, configPath);
    } catch (err) {
      return { status: 'error', path: configPath, detail: `write failed: ${err.message}` };
    }
    return { status, path: configPath };
  };

  // `^[ \t]*hooks` cannot match a `codex_hooks` line (the prefix differs), so
  // these canonical-key checks never collide with the legacy key.
  const HOOKS_TRUE = /^[ \t]*hooks[ \t]*=[ \t]*true\b/m;
  const HOOKS_ANY = /^[ \t]*hooks[ \t]*=/m;
  const LEGACY_ANY = /^[ \t]*codex_hooks[ \t]*=/m;
  const LEGACY_LINE = /^[ \t]*codex_hooks[ \t]*=.*(?:\r?\n)?/m;

  // Canonical flag already enabled.
  if (HOOKS_TRUE.test(text)) {
    if (LEGACY_ANY.test(text)) {
      // Strip the deprecated `codex_hooks` line so Codex v0.132+ stops warning.
      return write(text.replace(LEGACY_LINE, ''), 'migrated');
    }
    return { status: 'already', path: configPath };
  }

  // Canonical flag present but explicitly non-true → respect the user's choice;
  // don't add a duplicate key (which would make the TOML invalid).
  if (HOOKS_ANY.test(text)) {
    return { status: 'present-other', path: configPath };
  }

  // Deprecated `codex_hooks` present (no canonical key) → migrate the key name
  // in place, preserving its value and any inline comment.
  if (LEGACY_ANY.test(text)) {
    return write(text.replace(/^([ \t]*)codex_hooks([ \t]*=.*)$/m, '$1hooks$2'), 'migrated');
  }

  // Neither key present → add the canonical flag.
  let next;
  if (!exists || text.trim() === '') {
    next = '[features]\nhooks = true\n';
  } else if (/^[ \t]*\[features\][ \t]*$/m.test(text)) {
    next = text.replace(/^([ \t]*\[features\][ \t]*)$/m, '$1\nhooks = true');
  } else {
    const sep = text.endsWith('\n') ? '' : '\n';
    next = `${text}${sep}\n[features]\nhooks = true\n`;
  }
  return write(next, exists ? 'added' : 'created');
}

const FEATURES_HEADER_RE = /^[ \t]*\[features\][ \t]*(?:#.*)?$/;
const TABLE_HEADER_RE = /^[ \t]*\[/;

/**
 * Remove the `hooks = true` line from the `[features]` table (and the table header when
 * `dropEmptyTable` and nothing else is left in it). Returns the new text, or null when there
 * was no such line.
 */
export function removeCodexHooksFlagText(text, { dropEmptyTable = false } = {}) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => FEATURES_HEADER_RE.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && TABLE_HEADER_RE.test(l));
  if (end < 0) end = lines.length;
  const at = lines.findIndex((l, i) => i > start && i < end && /^[ \t]*hooks[ \t]*=[ \t]*true[ \t]*(?:#.*)?\r?$/.test(l));
  if (at < 0) return null;
  lines.splice(at, 1);
  end -= 1;
  if (dropEmptyTable && lines.slice(start + 1, end).every(l => l.trim() === '')) {
    // Nothing else is left in the table: drop the header, and the blank line
    // ensureCodexHooksFeatureFlag put before it.
    const removeFrom = start > 0 && lines[start - 1].trim() === '' ? start - 1 : start;
    lines.splice(removeFrom, start + 1 - removeFrom);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Install / remove
// ---------------------------------------------------------------------------------------------

/**
 * Install (or refresh) the Codex harness. Idempotent. Never throws.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string|null} [args.rules]   the rules text for developer_instructions; null = none
 * @param {boolean} [args.prompt]      ship our base instructions (model_instructions_file)
 * @param {boolean} [args.hooksFlag]   enable `[features] hooks = true` (the SessionStart hook)
 * @returns {{status: string, detail: string, hooksFlag: {status: string}|null, warning?: string}}
 *   status in { installed, unchanged, error }
 */
export function installCodexHarness({ projectRoot, rules = null, prompt = true, hooksFlag = true } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'install-codex-harness: projectRoot is required', hooksFlag: null };
  const manifestPath = join(projectRoot, CODEX_MANIFEST_REL);
  const configPath = join(projectRoot, CODEX_CONFIG_REL);
  const manifestRead = readJson(manifestPath);
  const manifest = manifestRead.error ? {} : manifestRead.value;
  const configExisted = existsSync(configPath);
  const next = {
    version: MANIFEST_VERSION,
    files: { ...(manifest.files || {}) },
    configBlock: manifest.configBlock || null,
    createdConfig: manifestRead.exists ? Boolean(manifest.createdConfig) : !configExisted,
    addedFeaturesTable: Boolean(manifest.addedFeaturesTable),
    addedHooksFlag: Boolean(manifest.addedHooksFlag),
  };
  const changes = [];
  const warnings = [];
  let hooksReport = null;

  try {
    // 1. The instructions file.
    let instructionsFile = false;
    const state = fileState(projectRoot, CODEX_INSTRUCTIONS_REL, manifest);
    if (prompt) {
      if (state === 'user') {
        warnings.push(`${CODEX_INSTRUCTIONS_REL} is user-authored and was kept; Codex keeps its own base instructions.`);
      } else {
        const content = codexInstructions();
        const path = join(projectRoot, CODEX_INSTRUCTIONS_REL);
        if (!(state === 'ours' && readFileSync(path, 'utf8') === content)) {
          writeAtomic(path, content);
          changes.push(CODEX_INSTRUCTIONS_REL);
        }
        next.files[CODEX_INSTRUCTIONS_REL] = sha(content);
        instructionsFile = true;
      }
    } else if (state === 'ours') {
      unlinkSync(join(projectRoot, CODEX_INSTRUCTIONS_REL));
      delete next.files[CODEX_INSTRUCTIONS_REL];
      changes.push(`removed ${CODEX_INSTRUCTIONS_REL}`);
    } else {
      delete next.files[CODEX_INSTRUCTIONS_REL];
    }

    // 2. The config block (top of the file: its keys are top-level keys).
    let text = configExisted ? readFileSync(configPath, 'utf8') : '';
    const userKeys = userTopLevelKeys(text);
    for (const k of userKeys) warnings.push(`${CODEX_CONFIG_REL} already sets ${k}; kept yours, so sweet-search does not set it.`);
    const wantFile = instructionsFile && !userKeys.includes('model_instructions_file');
    const wantRules = rules != null && !userKeys.includes('developer_instructions');
    const current = text.match(BLOCK_RE)?.[0] ?? null;
    const currentOurs = current != null && next.configBlock === sha(current);
    if (current != null && !currentOurs) {
      warnings.push(`the sweet-search block in ${CODEX_CONFIG_REL} was edited by hand and was kept as it is.`);
    } else if (!wantFile && !wantRules) {
      if (current != null) {
        text = text.replace(BLOCK_RE, '').replace(/^\n/, '');
        next.configBlock = null;
        changes.push(`${CODEX_CONFIG_REL} (block removed)`);
      }
    } else {
      const block = buildCodexConfigBlock({ instructionsFile: wantFile, rules: wantRules ? rules : null });
      if (current !== block) {
        text = current != null ? text.replace(BLOCK_RE, () => block) : (text ? `${block}\n${text}` : block);
        changes.push(`${CODEX_CONFIG_REL} (${[wantFile && 'model_instructions_file', wantRules && 'developer_instructions'].filter(Boolean).join(', ')})`);
      }
      next.configBlock = sha(block);
    }
    if (changes.some(c => c.startsWith(CODEX_CONFIG_REL))) writeAtomic(configPath, text);

    // 3. The hooks feature flag (recorded only when this call adds it).
    if (hooksFlag) {
      const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
      const hadFeatures = before.split('\n').some(l => FEATURES_HEADER_RE.test(l));
      hooksReport = ensureCodexHooksFeatureFlag(configPath, { create: true });
      if (hooksReport.status === 'created' || hooksReport.status === 'added') {
        next.addedHooksFlag = true;
        if (!hadFeatures) next.addedFeaturesTable = true;
        changes.push(`${CODEX_CONFIG_REL} ([features] hooks = true)`);
      }
    }

    const tracked = Object.keys(next.files).length || next.configBlock || next.addedHooksFlag
      || (next.createdConfig && existsSync(configPath));
    if (tracked) {
      if (!manifestRead.exists || JSON.stringify(manifest) !== JSON.stringify(next)) writeAtomic(manifestPath, JSON.stringify(next, null, 2) + '\n');
    } else if (manifestRead.exists) {
      unlinkSync(manifestPath);
    }
  } catch (err) {
    return { status: 'error', detail: err.message, hooksFlag: hooksReport };
  }

  const result = {
    status: changes.length ? 'installed' : 'unchanged',
    detail: changes.length ? changes.join('; ') : 'Codex harness already installed',
    hooksFlag: hooksReport,
  };
  if (warnings.length) result.warning = warnings.join(' ');
  return result;
}

/**
 * Reverse `installCodexHarness`: remove only what the manifest says this module added and the
 * user did not change since. A hand-edited block or file is kept and named in `kept`.
 *
 * @returns {{status: string, detail: string, kept?: string[]}} status in { removed, not-found, dry-run, error }
 */
export function removeCodexHarness({ projectRoot, dryRun = false } = {}) {
  if (!projectRoot) return { status: 'error', detail: 'remove-codex-harness: projectRoot is required' };
  const manifestPath = join(projectRoot, CODEX_MANIFEST_REL);
  const manifestRead = readJson(manifestPath);
  if (manifestRead.error) return { status: 'error', detail: manifestRead.error };
  if (!manifestRead.exists) return { status: 'not-found', detail: 'no Codex harness manifest' };
  const manifest = manifestRead.value;
  const configPath = join(projectRoot, CODEX_CONFIG_REL);
  const parts = [];
  const kept = [];

  try {
    let text = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
    let configChanged = false;
    if (text != null) {
      const current = text.match(BLOCK_RE)?.[0] ?? null;
      if (current != null) {
        if (manifest.configBlock && sha(current) === manifest.configBlock) {
          text = text.replace(BLOCK_RE, '').replace(/^\n/, '');
          configChanged = true;
          parts.push('config.toml block (model_instructions_file, developer_instructions)');
        } else {
          kept.push(`${CODEX_CONFIG_REL} sweet-search block (edited by hand)`);
        }
      }
      if (manifest.addedHooksFlag) {
        const stripped = removeCodexHooksFlagText(text, { dropEmptyTable: Boolean(manifest.addedFeaturesTable) });
        if (stripped != null) {
          text = stripped;
          configChanged = true;
          parts.push('[features] hooks flag');
        }
      }
    }
    const ownedFiles = Object.keys(manifest.files || {}).filter(rel => fileState(projectRoot, rel, manifest) === 'ours');
    for (const rel of Object.keys(manifest.files || {})) {
      if (!ownedFiles.includes(rel) && existsSync(join(projectRoot, rel))) kept.push(`${rel} (edited by hand)`);
    }
    parts.push(...ownedFiles);
    if (dryRun) return { status: 'dry-run', detail: parts.join(' + ') || 'manifest only', kept };

    if (configChanged) {
      if (manifest.createdConfig && text.trim() === '') unlinkSync(configPath);
      else writeAtomic(configPath, text);
    }
    for (const rel of ownedFiles) unlinkSync(join(projectRoot, rel));
    unlinkSync(manifestPath);
    const dir = join(projectRoot, CODEX_DIR_REL);
    try { if (readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* keep a non-empty directory */ }
    return { status: 'removed', detail: parts.join(' + ') || 'manifest only', kept };
  } catch (err) {
    return { status: 'error', detail: err.message, kept };
  }
}
