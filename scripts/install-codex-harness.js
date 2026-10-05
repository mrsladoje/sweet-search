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
 *                                         plus `[features] hooks = true` when init installed the
 *                                         SessionStart hook (.codex/hooks.json)
 *   .codex/sweet-search-harness.json      manifest: what this module added (file and block hashes,
 *                                         whether it created config.toml, the [features] table or
 *                                         the hooks flag), so uninstall removes only that and never
 *                                         user content
 *
 * Codex reads a project `.codex/config.toml` only for a TRUSTED project. `codex exec` silently
 * ignores it for an untrusted one (stock prompt, no rules); the interactive TUI asks "Do you trust
 * the contents of this directory?" on first start and records the answer in ~/.codex/config.toml.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  codexInstructions, codexCapturedStock, readCodexStock, resolveCodexModel,
} from './harness-prompts/index.js';

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
// The whole config.toml an init older than the manifest wrote (the hooks flag, before and after
// the `codex_hooks` → `hooks` rename).
const LEGACY_CONFIG_TEXTS = new Set(['[features]\nhooks = true\n', '[features]\ncodex_hooks = true\n']);

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
// Project trust (read only)
// ---------------------------------------------------------------------------------------------

/** `$CODEX_HOME/config.toml`, default `~/.codex/config.toml`. */
export function codexUserConfigPath(env = process.env) {
  return join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
}

const trimSlash = p => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p);

/** An absolute path in the form Codex records it: no trailing slash, symlinks resolved. */
function normalizeProjectPath(p) {
  const out = resolve(String(p));
  try { return trimSlash(realpathSync(out)); } catch { return trimSlash(out); }
}

/** Both spellings of a path (as written and with symlinks resolved), for matching config keys. */
function projectPathForms(p) {
  return [...new Set([trimSlash(resolve(String(p))), normalizeProjectPath(p)])];
}

/** Decode a TOML key (basic string, literal string or bare key); null when it is none of them. */
function tomlKey(raw) {
  if (raw.startsWith('"')) {
    const json = raw.replace(/\\U([0-9a-fA-F]{8})/g, (_, h) => JSON.stringify(String.fromCodePoint(parseInt(h, 16))).slice(1, -1));
    try { return JSON.parse(json); } catch { return null; }
  }
  if (raw.startsWith("'")) return raw.slice(1, -1);
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : null;
}

const TOML_KEY = String.raw`"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+`;
const PROJECT_HEADER_RE = new RegExp(String.raw`^[ \t]*\[[ \t]*projects[ \t]*\.[ \t]*(${TOML_KEY})[ \t]*\][ \t]*(?:#.*)?\r?$`);
const PROJECTS_HEADER_RE = /^[ \t]*\[[ \t]*projects[ \t]*\][ \t]*(?:#.*)?\r?$/;
const INLINE_PROJECT_RE = new RegExp(String.raw`^[ \t]*(${TOML_KEY})[ \t]*=[ \t]*\{([^}]*)\}`);
const TRUST_LEVEL_RE = /(?:^|[,{\s])trust_level[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)')/;

/**
 * The `trust_level` of each `[projects."<path>"]` entry in a Codex user config (also the inline
 * `[projects]` form `"<path>" = { trust_level = "trusted" }`), keyed by the path as written and
 * with symlinks resolved, both without a trailing slash.
 */
export function parseCodexProjectTrust(text) {
  const out = new Map();
  let current = null; // the project path of the table we are in, '[projects]', or null
  for (const line of String(text).split('\n')) {
    if (TABLE_HEADER_RE.test(line)) {
      const m = line.match(PROJECT_HEADER_RE);
      const key = m ? tomlKey(m[1]) : null;
      current = key != null ? key : (PROJECTS_HEADER_RE.test(line) ? '[projects]' : null);
      continue;
    }
    if (current == null) continue;
    if (current === '[projects]') {
      const m = line.match(INLINE_PROJECT_RE);
      const key = m ? tomlKey(m[1]) : null;
      const t = key != null ? ` ${m[2]}`.match(TRUST_LEVEL_RE) : null;
      if (t) for (const f of projectPathForms(key)) out.set(f, t[1] ?? t[2]);
      continue;
    }
    const t = line.match(/^[ \t]*trust_level[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)')/);
    if (t) for (const f of projectPathForms(current)) out.set(f, t[1] ?? t[2]);
  }
  return out;
}

/** The main working tree of the git repository that holds `dir` (Codex trusts a repo by it). */
function gitMainRoot(dir) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
    return common && basename(common) === '.git' ? dirname(common) : null;
  } catch {
    return null;
  }
}

/**
 * Whether Codex trusts the project, read from the user's Codex config (READ ONLY — never written).
 * Codex looks up the session directory first and then the root of its git repository; a project
 * with no entry is untrusted.
 *
 * @returns {{trusted: boolean, level: string|null, configPath: string, projectKey: string}}
 *   `projectKey` is the path to trust (the git root, or the project root outside git).
 */
export function readCodexProjectTrust({ projectRoot, env = process.env } = {}) {
  const configPath = codexUserConfigPath(env);
  const root = normalizeProjectPath(projectRoot);
  const gitRoot = gitMainRoot(root);
  const projectKey = gitRoot ? normalizeProjectPath(gitRoot) : root;
  let entries = new Map();
  try {
    if (existsSync(configPath)) entries = parseCodexProjectTrust(readFileSync(configPath, 'utf8'));
  } catch { /* unreadable = no entries */ }
  const lookup = p => projectPathForms(p).map(f => entries.get(f)).find(v => v != null);
  const level = lookup(projectRoot) ?? lookup(projectKey) ?? null;
  return { trusted: level === 'trusted', level, configPath, projectKey };
}

/** The short warning init prints for an untrusted project. */
export function formatCodexUntrustedWarning({ projectKey, configPath }) {
  return '[init] Codex: this project is not trusted yet, so Codex ignores .codex/config.toml (our prompt '
    + 'and rules) — `codex exec` and CI silently, the interactive app asks once.\n'
    + `         To trust it: run \`codex\` in this repo and answer "Yes", or add to ${configPath}:\n`
    + `           [projects.${tomlBasicString(projectKey)}]\n`
    + '           trust_level = "trusted"\n';
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

  // Every key check is scoped to the `[features]` table (a `hooks` key in another table is not
  // the flag). The header may carry a trailing comment (`[features] # mine`) or a CR.
  const lines = text.split('\n');
  const { start, end } = featuresTableRange(lines);
  const inTable = re => (start < 0 ? -1 : lines.findIndex((l, i) => i > start && i < end && re.test(l)));
  // `^[ \t]*hooks` cannot match a `codex_hooks` line (the prefix differs), so
  // these canonical-key checks never collide with the legacy key.
  const hooksTrue = inTable(/^[ \t]*hooks[ \t]*=[ \t]*true\b/);
  const hooksAny = inTable(/^[ \t]*hooks[ \t]*=/);
  const legacyAny = inTable(/^[ \t]*codex_hooks[ \t]*=/);

  // Canonical flag already enabled.
  if (hooksTrue >= 0) {
    if (legacyAny >= 0) {
      // Strip the deprecated `codex_hooks` line so Codex v0.132+ stops warning.
      lines.splice(legacyAny, 1);
      return write(lines.join('\n'), 'migrated');
    }
    return { status: 'already', path: configPath };
  }

  // Canonical flag present but explicitly non-true → respect the user's choice;
  // don't add a duplicate key (which would make the TOML invalid).
  if (hooksAny >= 0) {
    return { status: 'present-other', path: configPath };
  }

  // Deprecated `codex_hooks` present (no canonical key) → migrate the key name
  // in place, preserving its value and any inline comment.
  if (legacyAny >= 0) {
    lines[legacyAny] = lines[legacyAny].replace(/^([ \t]*)codex_hooks/, '$1hooks');
    return write(lines.join('\n'), 'migrated');
  }

  // The features table defined another way (dotted `features.x = …` keys or an inline table):
  // appending a `[features]` header would redefine it, so leave the file to the user.
  if (start < 0 && /^[ \t]*features[ \t]*[.=]/m.test(text)) {
    return /^[ \t]*features[ \t]*\.[ \t]*hooks[ \t]*=[ \t]*true\b/m.test(text)
      ? { status: 'already', path: configPath }
      : { status: 'present-other', path: configPath };
  }

  // Neither key present → add the canonical flag.
  let next;
  if (!exists || text.trim() === '') {
    next = '[features]\nhooks = true\n';
  } else if (start >= 0) {
    lines.splice(start + 1, 0, 'hooks = true');
    next = lines.join('\n');
  } else {
    const sep = text.endsWith('\n') ? '' : '\n';
    next = `${text}${sep}\n[features]\nhooks = true\n`;
  }
  return write(next, exists ? 'added' : 'created');
}

const FEATURES_HEADER_RE = /^[ \t]*\[[ \t]*features[ \t]*\][ \t]*(?:#.*)?\r?$/;
const TABLE_HEADER_RE = /^[ \t]*\[/;

/** The `[features]` table's header line index and the index of the next table header. */
function featuresTableRange(lines) {
  const start = lines.findIndex(l => FEATURES_HEADER_RE.test(l));
  if (start < 0) return { start: -1, end: -1 };
  const end = lines.findIndex((l, i) => i > start && TABLE_HEADER_RE.test(l));
  return { start, end: end < 0 ? lines.length : end };
}

/**
 * Remove the `hooks = true` line from the `[features]` table (and the table header when
 * `dropEmptyTable` and nothing else is left in it). Returns the new text, or null when there
 * was no such line.
 */
export function removeCodexHooksFlagText(text, { dropEmptyTable = false } = {}) {
  const lines = text.split('\n');
  let { start, end } = featuresTableRange(lines);
  if (start < 0) return null;
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
 * @param {boolean} [args.hooksFlag]   enable `[features] hooks = true` (only when the SessionStart
 *                                     hook is installed; false also takes back a flag this module added)
 * @returns {{status: string, detail: string, hooksFlag: {status: string}|null, warning?: string}}
 *   status in { installed, unchanged, error }
 */
export function installCodexHarness({
  projectRoot, rules = null, prompt = true, hooksFlag = true,
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
} = {}) {
  if (!projectRoot) return { status: 'error', detail: 'install-codex-harness: projectRoot is required', hooksFlag: null };
  const manifestPath = join(projectRoot, CODEX_MANIFEST_REL);
  const configPath = join(projectRoot, CODEX_CONFIG_REL);
  const manifestRead = readJson(manifestPath);
  const manifest = manifestRead.error ? {} : manifestRead.value;
  const configExisted = existsSync(configPath);
  // An init older than this manifest created a config.toml that holds only the hooks flag:
  // adopt it, so uninstall removes it.
  const legacy = !manifestRead.exists && configExisted && LEGACY_CONFIG_TEXTS.has(readFileSync(configPath, 'utf8'));
  const next = {
    version: MANIFEST_VERSION,
    files: { ...(manifest.files || {}) },
    configBlock: manifest.configBlock || null,
    createdConfig: manifestRead.exists ? Boolean(manifest.createdConfig) : (!configExisted || legacy),
    addedFeaturesTable: Boolean(manifest.addedFeaturesTable) || legacy,
    addedHooksFlag: Boolean(manifest.addedHooksFlag) || legacy,
  };
  const changes = [];
  const warnings = [];
  let hooksReport = null;
  let promptSource = null;

  try {
    // 1. The instructions file.
    let instructionsFile = false;
    const state = fileState(projectRoot, CODEX_INSTRUCTIONS_REL, manifest);
    if (prompt) {
      if (state === 'user') {
        warnings.push(`${CODEX_INSTRUCTIONS_REL} is user-authored and was kept; Codex keeps its own base instructions.`);
      } else {
        // The model's stock text from the user's own Codex cache (follows Codex updates), else our
        // captured copy, else the legacy text (harness-prompts/index.js codexInstructions).
        const model = resolveCodexModel({ projectRoot, codexHome });
        const stock = readCodexStock({ codexHome, model });
        const content = codexInstructions({ model, stock });
        promptSource = stock ? `stock prefix (${model}, from the Codex model cache)`
          : codexCapturedStock(model) ? `stock prefix (${model}, captured copy)` : `fallback (no stock text for ${model})`;
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
    } else if (next.addedHooksFlag) {
      // No hook to run: take back the flag this module added, so no half-set-up hook is left.
      const cur = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
      const stripped = removeCodexHooksFlagText(cur, { dropEmptyTable: next.addedFeaturesTable });
      if (stripped != null) {
        if (next.createdConfig && stripped.trim() === '') unlinkSync(configPath);
        else writeAtomic(configPath, stripped);
        changes.push(`${CODEX_CONFIG_REL} ([features] hooks flag removed: no SessionStart hook)`);
      }
      next.addedHooksFlag = false;
      next.addedFeaturesTable = false;
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
    promptSource,
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
  const configPath = join(projectRoot, CODEX_CONFIG_REL);
  if (!manifestRead.exists) {
    // An older init (before the manifest) wrote exactly the legacy hooks flag
    // file; it is ours when its text is still byte-identical.
    let legacyText = null;
    try { legacyText = readFileSync(configPath, 'utf8'); } catch { /* absent */ }
    if (legacyText == null || !LEGACY_CONFIG_TEXTS.has(legacyText)) return { status: 'not-found', detail: 'no Codex harness manifest' };
    const detail = `${CODEX_CONFIG_REL} (legacy hooks flag from an older init)`;
    if (dryRun) return { status: 'dry-run', detail };
    unlinkSync(configPath);
    try { const dir = join(projectRoot, CODEX_DIR_REL); if (readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* keep a non-empty directory */ }
    return { status: 'removed', detail };
  }
  const manifest = manifestRead.value;
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
