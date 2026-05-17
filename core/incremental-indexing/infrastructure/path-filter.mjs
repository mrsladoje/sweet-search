/**
 * Path filter (`.sweet-search-ignore` + repo-size cap).
 *
 * Plan § 11 ("Default deny-list (independent of `.gitignore`) catches"),
 * § 22.9 ("Many tiny files / Cursor's 400 k freeze") and § 14.2.7
 * ("resolved-exclude fingerprint"). Three concerns combined:
 *
 *   1. **Default deny-list** for paths that should never reach the
 *      reconcile dirty set, independent of project `.gitignore`. This
 *      catches `node_modules`, build dirs, common artifact extensions,
 *      etc.
 *   2. **`.sweet-search-ignore`** — a project-level ignore file with
 *      gitignore-compatible patterns. Allows users to opt out of paths
 *      that `.gitignore` doesn't already cover.
 *   3. **Repo-size cap** — Cursor froze at ~400 k indexed files; we cap
 *      at 200 k by default with a warning at 50 % of cap.
 *
 * Pattern matching is intentionally simple — substring + extension +
 * directory checks. Full gitignore semantics live in
 * `core/infrastructure/config/search.js::loadProjectConfig` which the
 * reconcile path consults for the authoritative exclude list.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from '../../infrastructure/config/search.js';

const DEFAULT_DENY_DIRS = Object.freeze([
  'node_modules',
  '.git',
  '.sweet-search',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.turbo',
  'coverage',
  '.parcel-cache',
  '.svelte-kit',
  '.vercel',
]);

const DEFAULT_DENY_EXTS = Object.freeze([
  '.lock',
  '.lockb',
  '.min.js',
  '.min.css',
  '.map',
  '.bundle.js',
  '.pyc',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.bin',
  '.wasm',
]);

export const DEFAULT_REPO_SIZE_CAP = 200_000;
export const DEFAULT_REPO_SIZE_WARN_FRAC = 0.5;

/**
 * Parse a `.sweet-search-ignore` file. Format: gitignore-like, but we
 * only support `glob`, `dir/`, `**`, `*`, and `#` comments. Returns
 * the array of normalised pattern strings.
 *
 * @param {string} filePath
 * @returns {string[]}
 */
export function loadIgnoreFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const out = [];
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    out.push(line);
  }
  return out;
}

function patternToRegex(pattern) {
  // Convert the subset of gitignore-style globbing used by the shared
  // sweet-search config. In particular, leading `**/` must match root-level
  // files too (`**/package-lock.json` matches `package-lock.json`).
  let p = String(pattern || '').replace(/\\/g, '/');
  let dirOnly = false;
  if (p.startsWith('/')) p = p.slice(1);
  if (p.endsWith('/')) { p = p.slice(0, -1); dirOnly = true; }
  const hasSlash = p.includes('/');

  let body = '';
  for (let i = 0; i < p.length; i++) {
    if (p.startsWith('**/', i)) {
      body += '(?:.*/)?';
      i += 2;
      continue;
    }
    if (p.startsWith('/**', i) && i + 3 === p.length) {
      body += '(?:/.*)?';
      i += 2;
      continue;
    }
    if (p.startsWith('**', i)) {
      body += '.*';
      i += 1;
      continue;
    }
    const ch = p[i];
    if (ch === '*') body += '[^/]*';
    else if (ch === '?') body += '[^/]';
    else body += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  const prefix = hasSlash ? '^' : '(?:^|.*/)';
  const suffix = dirOnly ? '(?:/.*)?$' : '$';
  return new RegExp(prefix + body + suffix);
}

/**
 * Build a path-filter function from default deny-list + ignore file.
 *
 * The filter is true for paths that should be **excluded**.
 *
 * @param {{projectRoot?:string, ignoreFile?:string, extraPatterns?:string[], allowSweetSearchDir?:boolean}} [opts]
 * @returns {(relativePath:string)=>boolean}
 */
export function buildPathFilter(opts = {}) {
  const patterns = [];
  if (opts.projectRoot) {
    for (const p of loadProjectConfig(opts.projectRoot).exclude || []) {
      if (opts.allowSweetSearchDir && String(p).includes('.sweet-search')) continue;
      patterns.push(p);
    }
  }
  for (const p of (opts.extraPatterns || [])) patterns.push(p);
  const ignoreFile = opts.ignoreFile
    || (opts.projectRoot ? path.join(opts.projectRoot, '.sweet-search-ignore') : null);
  if (ignoreFile) {
    for (const p of loadIgnoreFile(ignoreFile)) patterns.push(p);
  }
  const regexes = patterns.map(patternToRegex);
  const denyDirs = new Set(DEFAULT_DENY_DIRS);
  if (opts.allowSweetSearchDir) denyDirs.delete('.sweet-search');
  const denyExts = new Set(DEFAULT_DENY_EXTS);

  return function isExcluded(relativePath) {
    if (typeof relativePath !== 'string') return true;
    const norm = relativePath.replace(/\\/g, '/');
    const parts = norm.split('/');
    for (const part of parts) {
      if (denyDirs.has(part)) return true;
    }
    const base = parts[parts.length - 1] || '';
    const ext = path.extname(base).toLowerCase();
    if (denyExts.has(ext)) return true;
    // Multi-suffix matches like `.min.js` — denyExts already has them.
    for (const compound of ['.min.js', '.min.css', '.bundle.js']) {
      if (base.endsWith(compound)) return true;
    }
    for (const re of regexes) {
      if (re.test(norm)) return true;
    }
    return false;
  };
}

/**
 * Apply the repo-size cap policy. Plan § 22.9.
 *
 * @param {number} fileCount
 * @param {{cap?:number, warnFrac?:number}} [opts]
 * @returns {{ok:boolean, warn:boolean, cap:number, fileCount:number}}
 */
export function evaluateRepoSizeCap(fileCount, opts = {}) {
  const cap = opts.cap ?? DEFAULT_REPO_SIZE_CAP;
  const warnFrac = opts.warnFrac ?? DEFAULT_REPO_SIZE_WARN_FRAC;
  return {
    ok: fileCount <= cap,
    warn: fileCount >= cap * warnFrac,
    cap,
    fileCount,
  };
}
