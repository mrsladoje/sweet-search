/**
 * Manifest + run-config loaders.
 *
 * `loadManifest` reads the campaign-level manifest and resolves the upstream
 * `repoManifest` reference to a fully-merged record (so callers don't need to
 * load both files). `loadRunConfig` parses the run-level TOML override.
 *
 * Plan reference: §13.3 schemas, §11.7 reproducibility artifacts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const DEFAULT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'core',
  'prompt-optimization',
  'data',
  'manifest.json',
);
export const DEFAULT_RUN_CONFIG_PATH = path.join(
  REPO_ROOT,
  'core',
  'prompt-optimization',
  'data',
  'run-config.toml',
);

export function loadManifest({ manifestPath = DEFAULT_MANIFEST_PATH } = {}) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`loadManifest: manifest not found at ${manifestPath}`);
  }
  const top = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (top.schemaVersion !== 1) {
    throw new Error(`loadManifest: unsupported schemaVersion ${top.schemaVersion}`);
  }
  let repos = {};
  if (top.repoManifest) {
    const refPath = path.resolve(REPO_ROOT, top.repoManifest);
    if (!fs.existsSync(refPath)) {
      throw new Error(`loadManifest: referenced repoManifest missing at ${refPath}`);
    }
    repos = JSON.parse(fs.readFileSync(refPath, 'utf8')).repos ?? {};
  }
  return { ...top, _repos: repos, _manifestPath: manifestPath };
}

export function loadRunConfig({ runConfigPath = DEFAULT_RUN_CONFIG_PATH } = {}) {
  if (!fs.existsSync(runConfigPath)) {
    throw new Error(`loadRunConfig: file not found at ${runConfigPath}`);
  }
  const text = fs.readFileSync(runConfigPath, 'utf8');
  return { ...parseToml(text), _path: runConfigPath };
}

// ─── Minimal TOML parser ─────────────────────────────────────────────────────
//
// Subset that covers the run-config schema in §13.3:
//   - line comments (#)
//   - top-level scalars: string ("..."), int, float, bool
//   - arrays of scalars
//   - sections [name]
//   - inline tables { k = v, k = v }
// No nested arrays, no array-of-tables, no datetimes. Adding a real TOML lib
// is fine later — keeping this dep-free for P0 scaffolding.

function parseToml(text) {
  const out = {};
  let cursor = out;
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    lineNo++;
    let line = stripComment(raw).trim();
    if (line === '') continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).trim();
      if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/.test(name)) {
        throw new SyntaxError(`run-config: invalid section name "${name}" at line ${lineNo}`);
      }
      cursor = ensureSection(out, name.split('.'));
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      throw new SyntaxError(`run-config: missing '=' at line ${lineNo}: ${raw}`);
    }
    const key = line.slice(0, eq).trim();
    const valueText = line.slice(eq + 1).trim();
    cursor[key] = parseValue(valueText, lineNo);
  }
  return out;
}

function stripComment(line) {
  // Strip everything from the first unquoted '#' onward.
  let inStr = false;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inStr = false;
    } else {
      if (ch === '"' || ch === '\'') { inStr = true; quote = ch; }
      else if (ch === '#') return line.slice(0, i);
    }
  }
  return line;
}

function ensureSection(root, parts) {
  let node = root;
  for (const p of parts) {
    if (!Object.prototype.hasOwnProperty.call(node, p)) node[p] = {};
    node = node[p];
  }
  return node;
}

function parseValue(text, lineNo) {
  if (text === '') throw new SyntaxError(`run-config: empty value at line ${lineNo}`);
  const ch0 = text[0];
  if (ch0 === '"' || ch0 === '\'') return parseString(text, lineNo);
  if (ch0 === '[') return parseArray(text, lineNo);
  if (ch0 === '{') return parseInlineTable(text, lineNo);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return Number.parseFloat(text);
  throw new SyntaxError(`run-config: cannot parse value "${text}" at line ${lineNo}`);
}

function parseString(text, lineNo) {
  const quote = text[0];
  if (text[text.length - 1] !== quote) {
    throw new SyntaxError(`run-config: unterminated string at line ${lineNo}`);
  }
  return text.slice(1, -1).replace(/\\(.)/g, (_, c) => c);
}

function parseArray(text, lineNo) {
  if (text[text.length - 1] !== ']') {
    throw new SyntaxError(`run-config: unterminated array at line ${lineNo}`);
  }
  const inner = text.slice(1, -1).trim();
  if (inner === '') return [];
  return splitTopLevel(inner).map(part => parseValue(part.trim(), lineNo));
}

function parseInlineTable(text, lineNo) {
  if (text[text.length - 1] !== '}') {
    throw new SyntaxError(`run-config: unterminated inline table at line ${lineNo}`);
  }
  const inner = text.slice(1, -1).trim();
  if (inner === '') return {};
  const obj = {};
  for (const part of splitTopLevel(inner)) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      throw new SyntaxError(`run-config: missing '=' in inline table at line ${lineNo}`);
    }
    const k = part.slice(0, eq).trim();
    obj[k] = parseValue(part.slice(eq + 1).trim(), lineNo);
  }
  return obj;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === '\'') { inStr = true; quote = ch; }
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}
