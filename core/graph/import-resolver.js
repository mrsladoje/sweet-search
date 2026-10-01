/**
 * Import Resolver — map an import specifier to the repo file it loads.
 *
 * Covers what the name-based relationship resolver cannot:
 * - JS/TS relative imports (`../../x`), extension + `/index` resolution,
 *   TS ESM `.js` → `.ts` mapping, tsconfig/jsconfig `baseUrl` + `paths`
 *   (with `extends` chains and solution-style `references`), package.json
 *   `imports` (`#x`), simple Vite/webpack `resolve.alias` objects, the `@/` /
 *   `~/` source-root convention, and local workspace packages.
 * - Python relative (`from ..x import y`) and absolute package imports.
 * - Rust `crate::` / `self::` / `super::` paths, `mod x;`, workspace crates.
 * - Go module-path imports (go.mod `module` prefix → package directory).
 * - C/C++ `#include`, JVM FQNs, Ruby `require`/`require_relative`, PHP
 *   PSR-4 `use` + `require`, Dart relative and `package:` imports.
 *
 * Speed: resolution is Set lookups against the indexed file list. Config
 * files are read once per directory (memoised); there is no per-import
 * filesystem walk. Without a file list (incremental maintainer), candidate
 * checks fall back to memoised `existsSync` on code-file extensions only.
 *
 * Output paths are repo-relative POSIX paths. Go package imports resolve to
 * a directory and end with '/'.
 */

import fs from 'fs';
import path from 'path';

/**
 * `full_import_path` value for an import whose module is not a repo file
 * (package, stdlib, unresolvable alias). Name-based resolution skips these.
 */
export const UNRESOLVED_IMPORT_PREFIX = 'unresolved:';

/** `SWEET_SEARCH_IMPORT_EDGES=0` turns file-level import resolution off. */
export function importEdgesEnabled() {
  return process.env.SWEET_SEARCH_IMPORT_EDGES !== '0';
}

const JS_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.json'];
const JS_EXT_SWAP = { '.js': ['.ts', '.tsx', '.d.ts'], '.jsx': ['.tsx', '.d.ts'], '.mjs': ['.mts', '.d.mts'], '.cjs': ['.cts', '.d.cts'] };
// Build-output roots a workspace package's `main`/`exports` usually point
// into; the indexed sources live under src/.
const BUILD_DIR_RE = /^(dist|lib|build|out|esm|cjs)\//;
const JS_LANGS = new Set(['javascript', 'typescript', 'tsx']);
const JVM_EXTS = ['.java', '.kt', '.kts', '.scala', '.groovy'];
const PROBE_EXT_RE = /\.(?:[cm]?[jt]sx?|d\.ts|vue|svelte|json|py|pyi|rs|go|h|hh|hpp|hxx|c|cc|cpp|cxx|m|mm|java|kt|kts|scala|groovy|rb|php|dart)$/i;

/** Normalise to a repo-relative POSIX path; null when it escapes the repo. */
function norm(p) {
  const n = path.posix.normalize(p.replace(/\\/g, '/'));
  if (n === '.' || n === '') return '';
  if (n.startsWith('../') || n === '..' || n.startsWith('/')) return null;
  return n.startsWith('./') ? n.slice(2) : n;
}

function dirOf(rel) {
  const d = path.posix.dirname(rel);
  return d === '.' ? '' : d;
}

function join(...parts) {
  return norm(path.posix.join(...parts.filter((p) => p !== '' && p != null)));
}

/**
 * Strip comments and trailing commas from JSONC (tsconfig style) while
 * leaving string contents (URLs, `/*` globs) intact.
 */
export function parseJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += text[++i] ?? ''; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

/**
 * @param {object} options
 * @param {string} options.projectRoot - absolute repo root
 * @param {Iterable<string>} [options.files] - repo-relative indexed files
 * @param {boolean} [options.probeFs] - check candidates on disk when they are
 *   not in `files` (default: true when no file list is given)
 */
export function createImportResolver({ projectRoot, files = null, probeFs } = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const fileSet = new Set();
  const dirSet = new Set(['']);
  if (files) {
    for (const f of files) {
      const n = norm(String(f));
      if (!n) continue;
      fileSet.add(n);
      let d = dirOf(n);
      while (d && !dirSet.has(d)) { dirSet.add(d); d = dirOf(d); }
    }
  }
  const probe = probeFs ?? !files;
  const existsMemo = new Map();
  const dirMemo = new Map();
  const readMemo = new Map();

  function hasFile(rel) {
    if (rel == null) return false;
    if (fileSet.has(rel)) return true;
    if (!probe || !PROBE_EXT_RE.test(rel)) return false;
    let v = existsMemo.get(rel);
    if (v === undefined) {
      try { v = fs.statSync(path.join(root, rel)).isFile(); } catch { v = false; }
      existsMemo.set(rel, v);
    }
    return v;
  }

  function hasDir(rel) {
    if (rel == null) return false;
    if (dirSet.has(rel)) return true;
    if (!probe) return false;
    let v = dirMemo.get(rel);
    if (v === undefined) {
      try { v = fs.statSync(path.join(root, rel)).isDirectory(); } catch { v = false; }
      dirMemo.set(rel, v);
    }
    return v;
  }

  /** Read a repo file (config) once; null when missing/unreadable. */
  function readText(rel) {
    if (readMemo.has(rel)) return readMemo.get(rel);
    let text = null;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { text = null; }
    readMemo.set(rel, text);
    return text;
  }

  // Nearest ancestor directory (inclusive) of `dir` holding `fileName`.
  const nearestMemo = new Map();
  function nearestWith(dir, fileName) {
    const key = `${fileName}\0${dir}`;
    if (nearestMemo.has(key)) return nearestMemo.get(key);
    let found = null;
    let d = dir;
    for (;;) {
      if (readText(join(d, fileName) ?? '') !== null) { found = d; break; }
      if (!d) break;
      d = dirOf(d);
    }
    nearestMemo.set(key, found);
    return found;
  }

  // Lazy basename index for unique-suffix lookups.
  let byBase = null;
  function suffixMatches(suffix) {
    if (!byBase) {
      byBase = new Map();
      for (const f of fileSet) {
        const b = path.posix.basename(f);
        let list = byBase.get(b);
        if (!list) { list = []; byBase.set(b, list); }
        list.push(f);
      }
    }
    const list = byBase.get(path.posix.basename(suffix)) || [];
    if (!suffix.includes('/')) return list;
    return list.filter((f) => f === suffix || f.endsWith('/' + suffix));
  }

  /** Pick the match sharing the longest directory prefix with `fromFile`. */
  function closest(matches, fromFile) {
    if (matches.length <= 1) return matches[0] ?? null;
    const from = dirOf(fromFile).split('/');
    let best = null;
    let bestScore = -1;
    let tie = false;
    for (const m of matches) {
      const parts = dirOf(m).split('/');
      let s = 0;
      while (s < parts.length && s < from.length && parts[s] === from[s]) s++;
      if (s > bestScore) { best = m; bestScore = s; tie = false; } else if (s === bestScore) tie = true;
    }
    return tie ? null : best;
  }

  // -------------------------------------------------------------------------
  // JavaScript / TypeScript
  // -------------------------------------------------------------------------

  // TypeScript order (modules reference): `./x.js` tries x.ts, x.tsx,
  // x.d.ts, then x.js; extensionless tries .ts, .tsx, .d.ts, .js, .jsx, ...
  function jsCandidates(base) {
    if (base == null) return null;
    const ext = path.posix.extname(base);
    const swap = JS_EXT_SWAP[ext];
    if (swap) {
      const stem = base.slice(0, -ext.length);
      for (const e of swap) if (hasFile(stem + e)) return stem + e;
    }
    if (ext && hasFile(base)) return base;
    for (const e of JS_EXTS) if (hasFile(base + e)) return base + e;
    for (const e of JS_EXTS) {
      const idx = join(base, 'index' + e);
      if (hasFile(idx)) return idx;
    }
    return null;
  }

  const tsconfigMemo = new Map();
  function loadTsconfig(rel, depth = 0) {
    if (tsconfigMemo.has(rel)) return tsconfigMemo.get(rel);
    tsconfigMemo.set(rel, null);
    const text = readText(rel);
    if (text === null || depth > 8) return null;
    let json;
    try { json = parseJsonc(text); } catch { return null; }
    const dir = dirOf(rel);
    let cfg = { baseUrl: null, paths: null, pathsDir: null, references: [] };
    const bases = Array.isArray(json.extends) ? json.extends : json.extends ? [json.extends] : [];
    for (const ext of bases) {
      const baseRel = resolveExtends(dir, String(ext));
      const parent = baseRel ? loadTsconfig(baseRel, depth + 1) : null;
      if (parent) cfg = { ...cfg, baseUrl: parent.baseUrl ?? cfg.baseUrl, paths: parent.paths ?? cfg.paths, pathsDir: parent.pathsDir ?? cfg.pathsDir };
    }
    const co = json.compilerOptions || {};
    // TS 5.5 `${configDir}`: the directory of the config that is being
    // resolved for, i.e. the leaf. Approximated by the defining config.
    const sub = (v) => String(v).replace(/\$\{configDir\}\/?/g, './');
    if (typeof co.baseUrl === 'string') cfg.baseUrl = join(dir, sub(co.baseUrl)) ?? '';
    if (co.paths && typeof co.paths === 'object') {
      cfg.paths = Object.fromEntries(Object.entries(co.paths).map(([k, v]) => [k, Array.isArray(v) ? v.map(sub) : v]));
      cfg.pathsDir = dir;
    }
    if (Array.isArray(json.references)) {
      cfg.references = json.references.map((r) => r && r.path).filter(Boolean).map((p) => {
        const j = join(dir, p);
        return j && j.endsWith('.json') ? j : join(j ?? '', 'tsconfig.json');
      }).filter(Boolean);
    }
    tsconfigMemo.set(rel, cfg);
    return cfg;
  }

  function resolveExtends(dir, ext) {
    const withJson = ext.endsWith('.json') ? ext : `${ext}.json`;
    if (ext.startsWith('.')) return join(dir, withJson);
    // Package config (`@tsconfig/node18/tsconfig.json`): node_modules lookup.
    let d = dir;
    for (;;) {
      for (const cand of [join(d, 'node_modules', withJson), join(d, 'node_modules', ext, 'tsconfig.json')]) {
        if (cand && readText(cand) !== null) return cand;
      }
      if (!d) return null;
      d = dirOf(d);
    }
  }

  /** Effective paths config for files in `dir` (nearest tsconfig/jsconfig). */
  const effectiveMemo = new Map();
  function effectiveTsconfig(dir) {
    if (effectiveMemo.has(dir)) return effectiveMemo.get(dir);
    let cfg = null;
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const at = nearestWith(dir, name);
      if (at === null) continue;
      cfg = loadTsconfig(join(at, name) ?? name);
      if (cfg) break;
    }
    // Solution-style root config (`"files": []` + references): borrow the
    // first referenced project that declares paths/baseUrl.
    if (cfg && !cfg.paths && !cfg.baseUrl && cfg.references.length) {
      for (const ref of cfg.references) {
        const sub = loadTsconfig(ref);
        if (sub && (sub.paths || sub.baseUrl)) { cfg = sub; break; }
      }
    }
    effectiveMemo.set(dir, cfg);
    return cfg;
  }

  function matchTsPaths(cfg, spec) {
    if (!cfg || !cfg.paths) return null;
    const baseDir = cfg.baseUrl ?? cfg.pathsDir ?? '';
    let bestKey = null;
    let bestStar = '';
    let bestLen = -1;
    for (const key of Object.keys(cfg.paths)) {
      const star = key.indexOf('*');
      if (star === -1) {
        if (key === spec && key.length > bestLen) { bestKey = key; bestStar = ''; bestLen = key.length; }
        continue;
      }
      const prefix = key.slice(0, star);
      const suffix = key.slice(star + 1);
      if (spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix) && prefix.length > bestLen) {
        bestKey = key;
        bestStar = spec.slice(prefix.length, spec.length - suffix.length);
        bestLen = prefix.length;
      }
    }
    if (bestKey === null) return null;
    const targets = Array.isArray(cfg.paths[bestKey]) ? cfg.paths[bestKey] : [];
    for (const t of targets) {
      const hit = jsCandidates(join(baseDir, String(t).replace('*', bestStar)));
      if (hit) return hit;
    }
    return null;
  }

  const pkgMemo = new Map();
  function packageJson(dir) {
    if (pkgMemo.has(dir)) return pkgMemo.get(dir);
    const text = readText(join(dir, 'package.json') ?? 'package.json');
    let json = null;
    if (text !== null) { try { json = JSON.parse(text); } catch { json = null; } }
    pkgMemo.set(dir, json);
    return json;
  }

  function pickExportTarget(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) { for (const v of value) { const t = pickExportTarget(v); if (t) return t; } return null; }
    if (value && typeof value === 'object') {
      for (const k of ['source', 'types', 'import', 'module', 'default', 'require', 'node']) {
        if (k in value) { const t = pickExportTarget(value[k]); if (t) return t; }
      }
      for (const v of Object.values(value)) { const t = pickExportTarget(v); if (t) return t; }
    }
    return null;
  }

  /**
   * A package.json target (`./dist/x.js`). When the build output is not
   * indexed, map it back to the source tree the way TypeScript remaps
   * outDir → rootDir for local `imports`: dist/x.js → src/x.
   */
  function packageTarget(baseDir, target) {
    if (!target) return null;
    const direct = jsCandidates(join(baseDir, target));
    if (direct) return direct;
    const rel = norm(target);
    if (!rel || !BUILD_DIR_RE.test(rel)) return null;
    const srcRel = rel.replace(BUILD_DIR_RE, 'src/').replace(/(?:\.d)?\.[mc]?[jt]s$/, '');
    return jsCandidates(join(baseDir, srcRel));
  }

  function matchSubpathMap(map, key, baseDir) {
    if (!map || typeof map !== 'object') return null;
    if (key in map) return packageTarget(baseDir, pickExportTarget(map[key]));
    for (const [pattern, value] of Object.entries(map)) {
      const star = pattern.indexOf('*');
      if (star === -1) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (key.startsWith(prefix) && key.endsWith(suffix) && key.length >= prefix.length + suffix.length) {
        const target = pickExportTarget(value);
        if (target) {
          const hit = packageTarget(baseDir, target.replace('*', key.slice(prefix.length, key.length - suffix.length)));
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  // Vite / webpack `resolve.alias` objects: literal entries only.
  const bundlerAliasMemo = new Map();
  function bundlerAliases(pkgDir) {
    if (bundlerAliasMemo.has(pkgDir)) return bundlerAliasMemo.get(pkgDir);
    const aliases = [];
    for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs', 'vitest.config.ts', 'webpack.config.js', 'webpack.config.ts', 'nuxt.config.ts', 'svelte.config.js', 'astro.config.mjs']) {
      const text = readText(join(pkgDir, name) ?? name);
      if (!text) continue;
      const entryRe = /['"]?([@~#$][\w@~#$/-]*|[A-Za-z_][\w/-]*)['"]?\s*:\s*(?:path\.(?:resolve|join)\(\s*__dirname\s*,\s*|resolve\(\s*__dirname\s*,\s*|fileURLToPath\(\s*new\s+URL\(\s*)?['"](\.{0,2}\/?[^'"]*)['"]/g;
      const findRe = /find:\s*['"]([^'"]+)['"]\s*,\s*replacement:\s*(?:path\.(?:resolve|join)\(\s*__dirname\s*,\s*|resolve\(\s*__dirname\s*,\s*|fileURLToPath\(\s*new\s+URL\(\s*)?['"](\.{0,2}\/?[^'"]*)['"]/g;
      const block = /alias\s*:\s*([[{][\s\S]{0,2000}?[}\]])/.exec(text);
      if (!block) continue;
      let m;
      while ((m = entryRe.exec(block[1])) !== null) {
        if (/^(?:find|replacement)$/.test(m[1])) continue;
        const target = join(pkgDir, m[2].replace(/^\//, ''));
        if (target !== null) aliases.push({ key: m[1], target });
      }
      while ((m = findRe.exec(block[1])) !== null) {
        const target = join(pkgDir, m[2].replace(/^\//, ''));
        if (target !== null) aliases.push({ key: m[1], target });
      }
    }
    aliases.sort((a, b) => b.key.length - a.key.length);
    bundlerAliasMemo.set(pkgDir, aliases);
    return aliases;
  }

  let workspaceMap = null;
  function workspacePackages() {
    if (workspaceMap) return workspaceMap;
    workspaceMap = new Map();
    for (const f of fileSet) {
      if (!f.endsWith('package.json') || f.includes('node_modules/')) continue;
      if (path.posix.basename(f) !== 'package.json') continue;
      const dir = dirOf(f);
      const json = packageJson(dir);
      if (json && typeof json.name === 'string' && !workspaceMap.has(json.name)) workspaceMap.set(json.name, { dir, json });
    }
    return workspaceMap;
  }

  function resolveWorkspacePackage(spec) {
    const ws = workspacePackages();
    if (ws.size === 0) return null;
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    const pkg = ws.get(name);
    if (!pkg) return null;
    const sub = spec.slice(name.length).replace(/^\//, '');
    if (pkg.json.exports && typeof pkg.json.exports === 'object' && !Array.isArray(pkg.json.exports)) {
      const key = sub ? `./${sub}` : '.';
      const hit = Object.keys(pkg.json.exports).some((k) => k.startsWith('.'))
        ? matchSubpathMap(pkg.json.exports, key, pkg.dir)
        : (sub ? null : packageTarget(pkg.dir, pickExportTarget(pkg.json.exports)));
      if (hit) return hit;
    }
    if (sub) return jsCandidates(join(pkg.dir, sub)) || jsCandidates(join(pkg.dir, 'src', sub));
    for (const field of ['source', 'types', 'typings', 'module', 'main']) {
      if (typeof pkg.json[field] === 'string') {
        const hit = packageTarget(pkg.dir, pkg.json[field]);
        if (hit) return hit;
      }
    }
    return jsCandidates(join(pkg.dir, 'src', 'index')) || jsCandidates(join(pkg.dir, 'index'));
  }

  function resolveJs(fromFile, spec) {
    if (!spec || spec.startsWith('node:') || /^[a-z]+:\/\//.test(spec)) return null;
    const clean = spec.replace(/[?#].*$/, '') || spec;
    const fromDir = dirOf(fromFile);
    if (clean.startsWith('./') || clean.startsWith('../') || clean === '.' || clean === '..') {
      return jsCandidates(join(fromDir, clean));
    }
    if (clean.startsWith('/')) return jsCandidates(norm(clean.slice(1)));
    const cfg = effectiveTsconfig(fromDir);
    const viaPaths = matchTsPaths(cfg, clean);
    if (viaPaths) return viaPaths;
    const pkgDir = nearestWith(fromDir, 'package.json') ?? '';
    if (clean.startsWith('#')) {
      const json = packageJson(pkgDir);
      const hit = json ? matchSubpathMap(json.imports, clean, pkgDir) : null;
      if (hit) return hit;
    }
    for (const { key, target } of bundlerAliases(pkgDir)) {
      if (clean === key || clean.startsWith(key + '/')) {
        const hit = jsCandidates(join(target, clean.slice(key.length).replace(/^\//, '')));
        if (hit) return hit;
      }
    }
    if (cfg && cfg.baseUrl !== null && cfg.baseUrl !== undefined) {
      const hit = jsCandidates(join(cfg.baseUrl, clean));
      if (hit) return hit;
    }
    // `@/x` and `~/x`: Next.js / Nuxt / Vite source-root convention.
    if (clean.startsWith('@/') || clean.startsWith('~/')) {
      const rest = clean.slice(2);
      return jsCandidates(join(pkgDir, 'src', rest)) || jsCandidates(join(pkgDir, rest));
    }
    return resolveWorkspacePackage(clean);
  }

  // -------------------------------------------------------------------------
  // Python
  // -------------------------------------------------------------------------

  let pyRoots = null;
  function pythonRoots() {
    if (pyRoots) return pyRoots;
    pyRoots = new Map(); // top-level package name -> [parent dirs]
    const initDirs = new Set();
    for (const f of fileSet) if (f === '__init__.py' || f.endsWith('/__init__.py')) initDirs.add(dirOf(f));
    for (const d of initDirs) {
      if (!d) continue;
      const parent = dirOf(d);
      if (initDirs.has(parent) && parent) continue;
      const name = path.posix.basename(d);
      let list = pyRoots.get(name);
      if (!list) { list = []; pyRoots.set(name, list); }
      if (!list.includes(parent)) list.push(parent);
    }
    return pyRoots;
  }

  let pyStemSet = null;
  function pythonStems() {
    if (pyStemSet) return pyStemSet;
    pyStemSet = new Set();
    for (const f of fileSet) {
      if (!f.endsWith('.py') && !f.endsWith('.pyi')) continue;
      for (const part of f.split('/')) pyStemSet.add(part.replace(/\.pyi?$/, ''));
    }
    // Probe mode: files on disk may be missing from the list; never reject.
    if (probe) pyStemSet = { has: () => true };
    return pyStemSet;
  }

  function pyModule(base) {
    if (base == null) return null;
    for (const cand of [`${base}.py`, `${base}.pyi`, join(base, '__init__.py'), join(base, '__init__.pyi')]) {
      if (cand && hasFile(cand)) return cand;
    }
    return null;
  }

  function resolvePython(fromFile, imp) {
    const spec = imp.spec;
    if (spec.startsWith('.')) {
      const level = spec.match(/^\.+/)[0].length;
      let base = dirOf(fromFile);
      for (let k = 1; k < level; k++) base = dirOf(base);
      const rest = spec.slice(level);
      if (rest) {
        const mod = join(base, rest.replace(/\./g, '/'));
        const hit = pyModule(mod);
        if (hit) return hit;
        return null;
      }
      // `from . import x`: prefer submodule x, else the package itself.
      for (const name of imp.names || []) {
        const hit = pyModule(join(base, name));
        if (hit) return hit;
      }
      return pyModule(base) || null;
    }
    const segs = spec.split('.');
    // Quick reject: stdlib/third-party modules (`os`, `typing`) name no repo
    // file or directory.
    if (!pythonStems().has(segs[0])) return null;
    const roots = [...(pythonRoots().get(segs[0]) || [])];
    for (const extra of ['', 'src', 'lib']) if (!roots.includes(extra)) roots.push(extra);
    // A script directory (no __init__.py) is sys.path[0] for its scripts, so
    // `import hello` there loads the sibling hello.py. Inside a package,
    // Python 3 has no implicit relative imports: `import typing` in
    // src/flask/ is the stdlib, not src/flask/typing.py.
    const fallbackRoots = [];
    const fromDir = dirOf(fromFile);
    if (!roots.includes(fromDir) && !hasFile(join(fromDir, '__init__.py'))) fallbackRoots.push(fromDir);
    const full = [...roots, ...fallbackRoots];
    // `from a.b import c` where c is a submodule.
    if (imp.kind === 'from' && imp.names && imp.names.length) {
      for (const r of full) {
        for (const name of imp.names) {
          const hit = pyModule(join(r, [...segs, name].join('/')));
          if (hit && !hit.endsWith('__init__.py') && !hit.endsWith('__init__.pyi')) return hit;
        }
      }
    }
    for (const r of full) {
      const hit = pyModule(join(r, segs.join('/')));
      if (hit) return hit;
    }
    // `import a.b.c` where only the package a.b is local source.
    for (let n = segs.length - 1; n >= 1; n--) {
      for (const r of roots) {
        const hit = pyModule(join(r, segs.slice(0, n).join('/')));
        if (hit) return hit;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Rust
  // -------------------------------------------------------------------------

  let rustCrates = null;
  function rustCrateMap() {
    if (rustCrates) return rustCrates;
    rustCrates = new Map();
    for (const f of fileSet) {
      if (path.posix.basename(f) !== 'Cargo.toml') continue;
      const text = readText(f);
      const m = text && /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/.exec(text);
      if (m) rustCrates.set(m[1].replace(/-/g, '_'), dirOf(f));
    }
    return rustCrates;
  }

  function rustModuleFile(dir, segs) {
    for (let n = segs.length; n >= 1; n--) {
      const base = join(dir, segs.slice(0, n).join('/'));
      if (base == null) return null;
      if (hasFile(`${base}.rs`)) return `${base}.rs`;
      const modRs = join(base, 'mod.rs');
      if (hasFile(modRs)) return modRs;
    }
    return null;
  }

  /** The file of the module whose children live in `dir` (x.rs / x/mod.rs / crate root). */
  function rustModuleFileForDir(dir) {
    if (dir == null) return null;
    const own = join(dir, 'mod.rs');
    if (hasFile(own)) return own;
    if (dir && hasFile(`${dir}.rs`)) return `${dir}.rs`;
    return rustCrateRootFile(dir);
  }

  function rustCrateRootFile(srcDir) {
    for (const f of ['lib.rs', 'main.rs']) { const p = join(srcDir, f); if (hasFile(p)) return p; }
    return null;
  }

  /** Directory holding the child modules of `fromFile`'s module. */
  function rustChildDir(fromFile) {
    const base = path.posix.basename(fromFile);
    const dir = dirOf(fromFile);
    if (base === 'mod.rs' || base === 'lib.rs' || base === 'main.rs' || base === 'build.rs') return dir;
    const parentName = path.posix.basename(dir);
    if (parentName === 'bin' || parentName === 'tests' || parentName === 'examples' || parentName === 'benches') return dir;
    return join(dir, base.slice(0, -3));
  }

  function rustCrateSrc(fromFile) {
    const crateDir = nearestWith(dirOf(fromFile), 'Cargo.toml');
    if (crateDir === null) return null;
    return join(crateDir, 'src');
  }

  function resolveRust(fromFile, imp) {
    if (imp.kind === 'mod') {
      const dir = rustChildDir(fromFile);
      for (const cand of [join(dir, `${imp.spec}.rs`), join(dir, imp.spec, 'mod.rs')]) if (cand && hasFile(cand)) return cand;
      return null;
    }
    const segs = imp.spec.split('::').filter(Boolean);
    if (segs.length === 0) return null;
    const head = segs[0];
    if (head === 'std' || head === 'core' || head === 'alloc') return null;
    if (head === 'crate') {
      const src = rustCrateSrc(fromFile);
      if (src === null) return null;
      // `crate::Item` lives in (or is re-exported by) the crate root; a
      // deeper path whose module file is missing stays unresolved.
      return rustModuleFile(src, segs.slice(1)) || (segs.length === 2 ? rustCrateRootFile(src) : null);
    }
    if (head === 'self' || head === 'super') {
      let dir = rustChildDir(fromFile);
      let k = 0;
      while (segs[k] === 'super' || segs[k] === 'self') {
        if (segs[k] === 'super') dir = dirOf(dir);
        k++;
      }
      const rest = segs.slice(k);
      const hit = rustModuleFile(dir, rest);
      if (hit || rest.length > 1) return hit;
      // `super::Item`: the item lives in the module that owns `dir`.
      return rustModuleFileForDir(dir);
    }
    const crateDir = rustCrateMap().get(head);
    if (crateDir !== undefined) {
      const src = join(crateDir, 'src');
      return rustModuleFile(src, segs.slice(1)) || (segs.length <= 2 ? rustCrateRootFile(src) : null);
    }
    // Edition-2018 implicit `self` for sibling modules declared with `mod`.
    return rustModuleFile(rustChildDir(fromFile), segs);
  }

  // -------------------------------------------------------------------------
  // Go
  // -------------------------------------------------------------------------

  function goModulePath(modDir) {
    const m = /^module\s+(\S+)/m.exec(readText(join(modDir, 'go.mod') ?? 'go.mod') || '');
    return m ? m[1].replace(/^"|"$/g, '') : null;
  }

  // Module path → directory for the importing file: its own module (nearest
  // go.mod), local `replace x => ./dir` targets, and go.work `use` modules.
  const goModMemo = new Map();
  function goModules(dir) {
    if (goModMemo.has(dir)) return goModMemo.get(dir);
    const mods = [];
    const add = (modPath, modDir) => {
      if (modPath && modDir !== null && !mods.some((m) => m.path === modPath)) mods.push({ path: modPath, dir: modDir });
    };
    const modDir = nearestWith(dir, 'go.mod');
    if (modDir !== null) {
      add(goModulePath(modDir), modDir);
      const text = readText(join(modDir, 'go.mod') ?? 'go.mod') || '';
      const replaceRe = /^\s*(?:replace\s+)?(\S+)(?:\s+v\S+)?\s*=>\s*(\.{1,2}\/\S*)\s*$/gm;
      let m;
      while ((m = replaceRe.exec(text)) !== null) add(m[1], join(modDir, m[2]));
    }
    const workDir = nearestWith(dir, 'go.work');
    if (workDir !== null) {
      const text = readText(join(workDir, 'go.work') ?? 'go.work') || '';
      const useRe = /^\s*(?:use\s+)?(\.{1,2}(?:\/\S*)?)\s*$/gm;
      let m;
      while ((m = useRe.exec(text)) !== null) {
        const d = join(workDir, m[1]);
        if (d !== null) add(goModulePath(d), d);
      }
    }
    mods.sort((a, b) => b.path.length - a.path.length);
    goModMemo.set(dir, mods);
    return mods;
  }

  function resolveGo(fromFile, spec) {
    for (const mod of goModules(dirOf(fromFile))) {
      if (spec !== mod.path && !spec.startsWith(mod.path + '/')) continue;
      const rel = join(mod.dir, spec.slice(mod.path.length).replace(/^\//, ''));
      if (rel && hasDir(rel)) return `${rel}/`;
      return null;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // C / C++ / Objective-C
  // -------------------------------------------------------------------------

  function resolveC(fromFile, imp) {
    const spec = imp.spec;
    if (imp.kind === 'quote') {
      let d = dirOf(fromFile);
      for (;;) {
        const cand = join(d, spec);
        if (cand && hasFile(cand)) return cand;
        if (!d) break;
        d = dirOf(d);
      }
    } else if (!spec.includes('/')) {
      return null; // <stdio.h>-style system header
    }
    const norms = norm(spec);
    return norms ? closest(suffixMatches(norms), fromFile) : null;
  }

  // -------------------------------------------------------------------------
  // JVM / Ruby / PHP / Dart
  // -------------------------------------------------------------------------

  function resolveJvm(fromFile, imp) {
    if (imp.kind === 'jvm-wildcard') return null;
    const segs = imp.spec.split('.');
    for (let n = segs.length; n >= Math.max(2, segs.length - 2); n--) {
      const stem = segs.slice(0, n).join('/');
      for (const ext of JVM_EXTS) {
        const hit = closest(suffixMatches(stem + ext), fromFile);
        if (hit) return hit;
      }
    }
    return null;
  }

  function resolveRuby(fromFile, imp) {
    const spec = imp.spec.endsWith('.rb') ? imp.spec : `${imp.spec}.rb`;
    if (imp.kind === 'relative') {
      const cand = join(dirOf(fromFile), spec);
      return cand && hasFile(cand) ? cand : null;
    }
    for (const base of ['lib', '']) {
      const cand = join(base, spec);
      if (cand && hasFile(cand)) return cand;
    }
    const n = norm(spec);
    return n && n.includes('/') ? closest(suffixMatches(n), fromFile) : null;
  }

  let psr4 = null;
  function composerPsr4() {
    if (psr4) return psr4;
    psr4 = [];
    for (const f of ['composer.json', ...[...fileSet].filter((x) => x.endsWith('/composer.json'))]) {
      const text = readText(f);
      if (!text) continue;
      let json;
      try { json = JSON.parse(text); } catch { continue; }
      for (const section of [json.autoload, json['autoload-dev']]) {
        const map = section && section['psr-4'];
        if (!map) continue;
        for (const [prefix, dirs] of Object.entries(map)) {
          for (const d of Array.isArray(dirs) ? dirs : [dirs]) {
            const dir = join(dirOf(f), String(d));
            if (dir !== null) psr4.push({ prefix, dir });
          }
        }
      }
    }
    psr4.sort((a, b) => b.prefix.length - a.prefix.length);
    return psr4;
  }

  function resolvePhp(fromFile, imp) {
    if (imp.kind === 'require') {
      const cand = join(dirOf(fromFile), imp.spec);
      if (cand && hasFile(cand)) return cand;
      const fromRoot = norm(imp.spec.replace(/^\//, ''));
      return fromRoot && hasFile(fromRoot) ? fromRoot : null;
    }
    const fqn = imp.spec.replace(/^\\/, '');
    for (const { prefix, dir } of composerPsr4()) {
      if (prefix && !fqn.startsWith(prefix)) continue;
      const cand = join(dir, `${fqn.slice(prefix.length).replace(/\\/g, '/')}.php`);
      if (cand && hasFile(cand)) return cand;
    }
    const parts = fqn.split('\\');
    if (parts.length < 2) return null;
    return closest(suffixMatches(`${parts.slice(-2).join('/')}.php`), fromFile);
  }

  function resolveDart(fromFile, spec) {
    if (spec.startsWith('package:')) {
      const [name, ...rest] = spec.slice(8).split('/');
      const pubDir = nearestWith(dirOf(fromFile), 'pubspec.yaml');
      if (pubDir === null) return null;
      const m = /^name:\s*(\S+)/m.exec(readText(join(pubDir, 'pubspec.yaml') ?? 'pubspec.yaml') || '');
      if (!m || m[1] !== name) return null;
      const cand = join(pubDir, 'lib', rest.join('/'));
      return cand && hasFile(cand) ? cand : null;
    }
    const cand = join(dirOf(fromFile), spec);
    return cand && hasFile(cand) ? cand : null;
  }

  /**
   * @param {string} fromFile - repo-relative importing file
   * @param {{spec: string, kind: string, names?: string[]}} imp - scanned import
   * @param {string} language - registry language id
   * @returns {string|null} repo-relative file (or Go package dir ending '/')
   */
  // Many files share imports; the result depends on the importing directory
  // (Rust: the file, since `x.rs` and `mod.rs` own different child dirs).
  const resolveMemo = new Map();
  function resolve(fromFile, imp, language) {
    const from = norm(String(fromFile));
    if (from == null || !imp || !imp.spec) return null;
    const scope = language === 'rust' ? from : dirOf(from);
    const key = `${language}\0${scope}\0${imp.kind}\0${imp.spec}\0${imp.names ? imp.names.join(',') : ''}`;
    if (resolveMemo.has(key)) return resolveMemo.get(key);
    const result = resolveUncached(from, imp, language);
    resolveMemo.set(key, result);
    return result;
  }

  function resolveUncached(from, imp, language) {
    try {
      if (JS_LANGS.has(language)) return resolveJs(from, imp.spec);
      switch (language) {
        case 'python': return resolvePython(from, imp);
        case 'rust': return resolveRust(from, imp);
        case 'go': return resolveGo(from, imp.spec);
        case 'c': case 'cpp': case 'objc': return resolveC(from, imp);
        case 'java': case 'kotlin': case 'scala': case 'groovy': return resolveJvm(from, imp);
        case 'ruby': return resolveRuby(from, imp);
        case 'php': return resolvePhp(from, imp);
        case 'dart': return resolveDart(from, imp.spec);
        default: return null;
      }
    } catch {
      return null;
    }
  }

  return { resolve, hasFile, root };
}

/**
 * file → Set of imported repo files, from the `importsFile` edges of a code
 * graph DB. Source rows carry the importing file's graph id (sha256 of
 * `path:file:basename`), so ids are mapped back through the entity file list
 * plus every edge target. Intended for call-target disambiguation: a call in
 * file A to `foo` should prefer the `foo` defined in a file A imports.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {(filePath: string) => string} fileIdOf - GraphExtractor file id fn
 * @returns {Map<string, Set<string>>}
 */
export function buildFileImportMap(db, fileIdOf) {
  const rows = db.prepare("SELECT source_id, target_name FROM relationships WHERE type = 'importsFile'").all();
  const idToFile = new Map();
  const paths = new Set(db.prepare('SELECT DISTINCT file_path FROM entities').pluck().all());
  for (const r of rows) paths.add(r.target_name);
  for (const p of paths) if (p) idToFile.set(fileIdOf(p), p);
  const map = new Map();
  for (const r of rows) {
    const from = idToFile.get(r.source_id);
    if (!from) continue;
    let set = map.get(from);
    if (!set) { set = new Set(); map.set(from, set); }
    set.add(r.target_name);
  }
  return map;
}

export default { createImportResolver, buildFileImportMap, parseJsonc };
