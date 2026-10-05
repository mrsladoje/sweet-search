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
import {
  stripNoise, csharpDeclarations, braceDeclarations, packageChain, referencedNames,
  csharpNamespaceRanges, namespaceAt, qualifiedChains, packageClauses, elixirModules,
  elixirReferences, lineOfIndex,
} from './import-symbol-index.js';

import { GO_PACKAGE_PREFIX, RUST_PATH_PREFIX, UNRESOLVED_IMPORT_PREFIX } from '../infrastructure/import-path-prefixes.js';

// Defined in infrastructure (the structural repository reads them too).
export { GO_PACKAGE_PREFIX, RUST_PATH_PREFIX, UNRESOLVED_IMPORT_PREFIX };

/** `SWEET_SEARCH_IMPORT_EDGES=0` turns file-level import resolution off. */
export function importEdgesEnabled() {
  return process.env.SWEET_SEARCH_IMPORT_EDGES !== '0';
}

const JS_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.json'];
const JS_EXT_SWAP = { '.js': ['.ts', '.tsx', '.d.ts'], '.jsx': ['.tsx', '.d.ts'], '.mjs': ['.mts', '.d.mts'], '.cjs': ['.cts', '.d.cts'] };
// Build-output roots a workspace package's `main`/`exports` usually point
// into; the indexed sources live under src/.
const BUILD_DIR_RE = /^(dist|lib|build|out|esm|cjs)\//;
const JS_LANGS = new Set(['javascript', 'typescript', 'tsx', 'sfc']);
const JVM_EXTS = ['.java', '.kt', '.kts', '.scala', '.groovy'];
const JVM_LANG_OF_EXT = { '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala', '.groovy': 'groovy' };
const PROBE_EXT_RE = /\.(?:[cm]?[jt]sx?|d\.ts|vue|svelte|astro|json|py|pyi|rs|go|h|hh|hpp|hxx|c|cc|cpp|cxx|m|mm|java|kt|kts|scala|groovy|rb|php|dart|cs|swift|exs?|lua|zig|hs|lhs|hsc|clj[cs]?|sol|sh|bash|zsh|proto|jl|elm|p[lm]|[rR]|ps[dm]?1|[eh]rl|cr|s[ac]ss|less|css)$/i;
// Implicit (namespace/package/module) references: at most this many target
// files per importing file, and a name declared in more than this many
// files of one namespace (partial classes aside) is too generic to link.
const MAX_IMPLICIT_EDGES_PER_FILE = 200;
const MAX_FILES_PER_NAME = 4;
const SVELTE_CONFIGS = ['svelte.config.js', 'svelte.config.ts', 'svelte.config.mjs'];
const FILE_SCOPED_MEMO_LANGUAGES =new Set(['rust', 'csharp', 'elixir', 'java', 'kotlin', 'scala', 'groovy']);

// Per-file declaration summaries for the namespace-language indexes (C#,
// JVM, Swift, Elixir), kept across resolvers. The incremental maintainer
// builds a fresh resolver every tick; without this, one edited .cs file made
// the tick re-read and re-parse every .cs file of the repo. A summary is
// reused while the file's size and mtime (ns) are unchanged.
const DECL_CACHE = new Map(); // `${root}\0${family}\0${rel}` -> { size, mtime, value }
const DECL_CACHE_MAX = 250000;

function cachedDeclarations(root, rel, family, parse) {
  const abs = path.join(root, rel);
  let st;
  try { st = fs.statSync(abs, { bigint: true }); } catch { return null; }
  const key = `${root}\0${family}\0${rel}`;
  const hit = DECL_CACHE.get(key);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeNs) return hit.value;
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const value = parse(text);
  if (DECL_CACHE.size >= DECL_CACHE_MAX) DECL_CACHE.clear();
  DECL_CACHE.set(key, { size: st.size, mtime: st.mtimeNs, value });
  return value;
}

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
    // Path order, not discovery order: every index built from fileSet
    // (package roots, declaration maps) then lists candidates the same way
    // whatever order the files were found in.
    const sorted = [...files].map(String).sort();
    for (const f of sorted) {
      const n = norm(f);
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

  // A path that merely ends like the import is not the imported module: an
  // external `foo.Bar`, `Data.Map` or `Foo::Bar` shares its suffix with a
  // local `com/x/foo/Bar.java`, `src/MyLib/Data/Map.hs` or `lib/My/Foo/Bar.pm`.
  // Candidates found by path shape must declare the module they stand for.
  const declaredMemo = new Map();
  function declaredModules(rel, family) {
    const key = `${family}\0${rel}`;
    if (declaredMemo.has(key)) return declaredMemo.get(key);
    const text = (readText(rel) || '').replace(/^﻿/, '');
    const names = new Set();
    if (family === 'jvm') {
      const lang = JVM_LANG_OF_EXT[path.posix.extname(rel)] || 'java';
      const chain = packageChain(packageClauses(stripNoise(text, lang)));
      if (chain.length) names.add(chain[chain.length - 1]);
      else names.add('');
    } else {
      const re = family === 'haskell' ? /^[> \t]*module[ \t]+([\w.']+)/gm
        : family === 'perl' ? /^[ \t]*package[ \t]+([\w:]+)/gm
          : family === 'php' ? /^[ \t]*namespace[ \t]+\\?([\w\\]+)[ \t]*[;{]/gm
            : /\(\s*ns\s+(?:\^\{[^}]*\}\s+|\^:[\w-]+\s+)*([\w.\-*+!?<>=']+)/g; // clojure
      let m;
      while ((m = re.exec(text)) !== null) names.add(m[1]);
    }
    declaredMemo.set(key, names);
    return names;
  }

  function declares(rel, family, expected) {
    return rel != null && declaredModules(rel, family).has(expected);
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

  // TS 5.5 `${configDir}`: the directory of the config being resolved for
  // (the leaf), even when the option is written in an extended base config.
  const CONFIG_DIR_RE = /\$\{configDir\}\/?/g;
  const HAS_CONFIG_DIR_RE = /\$\{configDir\}/;
  const tsconfigMemo = new Map();
  /**
   * @param {string} rel - config file (repo-relative)
   * @param {number} depth - `extends` depth
   * @param {string} leafDir - directory of the leaf config (`${configDir}`)
   */
  function loadTsconfig(rel, depth = 0, leafDir = dirOf(rel)) {
    const memoKey = `${rel}\0${leafDir}`;
    if (tsconfigMemo.has(memoKey)) return tsconfigMemo.get(memoKey);
    tsconfigMemo.set(memoKey, null);
    const text = readText(rel);
    if (text === null || depth > 8) return null;
    let json;
    try { json = parseJsonc(text); } catch { return null; }
    const dir = dirOf(rel);
    let cfg = { baseUrl: null, paths: null, pathsDir: null, rootDirs: null, references: [], leafDir };
    const bases = Array.isArray(json.extends) ? json.extends : json.extends ? [json.extends] : [];
    for (const ext of bases) {
      const baseRel = resolveExtends(dir, String(ext));
      const parent = baseRel ? loadTsconfig(baseRel, depth + 1, leafDir) : null;
      if (parent) {
        cfg = {
          ...cfg,
          baseUrl: parent.baseUrl ?? cfg.baseUrl,
          paths: parent.paths ?? cfg.paths,
          pathsDir: parent.pathsDir ?? cfg.pathsDir,
          rootDirs: parent.rootDirs ?? cfg.rootDirs,
        };
      }
    }
    const co = json.compilerOptions || {};
    // A directory option: relative to the defining config, or to the leaf
    // when it starts with `${configDir}`.
    const dirOption = (v) => {
      const s = String(v);
      return HAS_CONFIG_DIR_RE.test(s) ? join(leafDir, s.replace(CONFIG_DIR_RE, '')) : join(dir, s);
    };
    if (typeof co.baseUrl === 'string') cfg.baseUrl = dirOption(co.baseUrl) ?? '';
    if (co.paths && typeof co.paths === 'object') {
      // Targets keep `${configDir}`; matchTsPaths anchors them at the leaf.
      cfg.paths = co.paths;
      cfg.pathsDir = dir;
    }
    // `rootDirs`: several source roots merged into one virtual directory, so
    // `./x` from rootA/p/a.ts may load rootB/p/x.ts (TS handbook, "Virtual
    // Directories with rootDirs").
    if (Array.isArray(co.rootDirs)) {
      cfg.rootDirs = co.rootDirs.map(dirOption).filter((d) => d !== null);
    }
    if (Array.isArray(json.references)) {
      cfg.references = json.references.map((r) => r && r.path).filter(Boolean).map((p) => {
        const j = join(dir, p);
        return j && j.endsWith('.json') ? j : join(j ?? '', 'tsconfig.json');
      }).filter(Boolean);
    }
    tsconfigMemo.set(memoKey, cfg);
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
      const target = String(t).replace('*', bestStar);
      const hit = jsCandidates(HAS_CONFIG_DIR_RE.test(target)
        ? join(cfg.leafDir ?? '', target.replace(CONFIG_DIR_RE, ''))
        : join(baseDir, target));
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
      // `path.resolve(__dirname, 'src', 'components')` joins every string
      // argument; group 3 holds the arguments after the first.
      const entryRe = /['"]?([@~#$][\w@~#$/-]*|[A-Za-z_][\w/-]*)['"]?\s*:\s*(?:path\.(?:resolve|join)\(\s*__dirname\s*,\s*|resolve\(\s*__dirname\s*,\s*|fileURLToPath\(\s*new\s+URL\(\s*)?['"](\.{0,2}\/?[^'"]*)['"]((?:\s*,\s*['"][^'"]*['"])*)/g;
      const findRe = /find:\s*['"]([^'"]+)['"]\s*,\s*replacement:\s*(?:path\.(?:resolve|join)\(\s*__dirname\s*,\s*|resolve\(\s*__dirname\s*,\s*|fileURLToPath\(\s*new\s+URL\(\s*)?['"](\.{0,2}\/?[^'"]*)['"]((?:\s*,\s*['"][^'"]*['"])*)/g;
      const targetOf = (first, more) => {
        const segs = [first.replace(/^\//, ''), ...((more || '').match(/['"][^'"]*['"]/g) || []).map((s) => s.slice(1, -1))];
        return join(pkgDir, ...segs);
      };
      // Every alias block (array form `[{ find, replacement }, …]` included);
      // a bracket-balanced slice so nested objects do not end it early.
      const blockRe = /alias\s*:\s*([[{])/g;
      let b;
      while ((b = blockRe.exec(text)) !== null) {
        const start = b.index + b[0].length - 1;
        let depth = 0;
        let end = start;
        for (; end < text.length && end - start < 4000; end++) {
          const ch = text[end];
          if (ch === '[' || ch === '{') depth++;
          else if ((ch === ']' || ch === '}') && --depth === 0) break;
        }
        const body = text.slice(start, end + 1);
        let m;
        entryRe.lastIndex = 0;
        while ((m = entryRe.exec(body)) !== null) {
          if (/^(?:find|replacement)$/.test(m[1])) continue;
          const target = targetOf(m[2], m[3]);
          if (target !== null) aliases.push({ key: m[1], target });
        }
        findRe.lastIndex = 0;
        while ((m = findRe.exec(body)) !== null) {
          const target = targetOf(m[2], m[3]);
          if (target !== null) aliases.push({ key: m[1], target });
        }
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

  function viaRootDirs(fromDir, spec) {
    const cfg = effectiveTsconfig(fromDir);
    if (!cfg || !cfg.rootDirs || cfg.rootDirs.length < 2) return null;
    const own = cfg.rootDirs
      .filter((r) => r === '' || fromDir === r || fromDir.startsWith(r + '/'))
      .sort((a, b) => b.length - a.length)[0];
    if (own === undefined) return null;
    const inner = own === '' ? fromDir : fromDir.slice(own.length).replace(/^\//, '');
    for (const r of cfg.rootDirs) {
      if (r === own) continue;
      const hit = jsCandidates(join(r, inner, spec));
      if (hit) return hit;
    }
    return null;
  }

  function resolveJs(fromFile, spec) {
    if (!spec || spec.startsWith('node:') || /^[a-z]+:\/\//.test(spec)) return null;
    const clean = spec.replace(/[?#].*$/, '') || spec;
    const fromDir = dirOf(fromFile);
    if (clean.startsWith('./') || clean.startsWith('../') || clean === '.' || clean === '..') {
      return jsCandidates(join(fromDir, clean)) || viaRootDirs(fromDir, clean);
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
    // SvelteKit's built-in `$lib` alias (kit.files.lib, default src/lib).
    if ((clean === '$lib' || clean.startsWith('$lib/')) && SVELTE_CONFIGS.some((n) => readText(join(pkgDir, n) ?? n) !== null)) {
      return jsCandidates(join(pkgDir, 'src/lib', clean.slice(4).replace(/^\//, '')));
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
        if (mod == null) return null;
        // `from .sub import thing` where thing is a submodule of package sub
        // (the same rule as the absolute form below).
        for (const name of imp.kind === 'from' ? imp.names || [] : []) {
          const sub = pyModule(join(mod, name));
          if (sub && !sub.endsWith('__init__.py') && !sub.endsWith('__init__.pyi')) return sub;
        }
        return pyModule(mod) || null;
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
    // Several roots can hold a package of one name (uv: an `albatross`
    // package in each test workspace). The root nearest the importing file
    // wins; equally near roots that both hold the module are a guess — no
    // edge. Without this, the first root in file discovery order won.
    const tiers = pythonRootTiers(roots, fromDir);
    if (fallbackRoots.length) tiers.push(fallbackRoots);
    const NONE = Symbol('none');
    const pick = (probe) => {
      for (const tier of tiers) {
        const hits = new Set();
        for (const r of tier) { const hit = probe(r); if (hit) hits.add(hit); }
        if (hits.size === 1) return [...hits][0];
        if (hits.size > 1) return null;
      }
      return NONE;
    };
    // `from a.b import c` where c is a submodule.
    if (imp.kind === 'from' && imp.names && imp.names.length) {
      const sub = pick((r) => {
        for (const name of imp.names) {
          const hit = pyModule(join(r, [...segs, name].join('/')));
          if (hit && !hit.endsWith('__init__.py') && !hit.endsWith('__init__.pyi')) return hit;
        }
        return null;
      });
      if (sub !== NONE) return sub;
    }
    const mod = pick((r) => pyModule(join(r, segs.join('/'))));
    if (mod !== NONE) return mod;
    // `import a.b.c` where only the package a.b is local source.
    for (let n = segs.length - 1; n >= 1; n--) {
      const pkg = pick((r) => (fallbackRoots.includes(r) ? null : pyModule(join(r, segs.slice(0, n).join('/')))));
      if (pkg !== NONE) return pkg;
    }
    return null;
  }

  /** Roots grouped by nearness to `fromDir` (shared leading path segments), nearest first; paths sorted in a tier. */
  function pythonRootTiers(roots, fromDir) {
    const from = fromDir ? fromDir.split('/') : [];
    const shared = (r) => {
      const parts = r ? r.split('/') : [];
      let n = 0;
      while (n < parts.length && n < from.length && parts[n] === from[n]) n++;
      return n;
    };
    const byShared = new Map();
    for (const r of roots) {
      const k = shared(r);
      if (!byShared.has(k)) byShared.set(k, []);
      byShared.get(k).push(r);
    }
    return [...byShared.keys()].sort((a, b) => b - a).map((k) => byShared.get(k).sort());
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

  /**
   * Module directory of the crate `fromFile` belongs to. Cargo auto-discovers
   * separate crates under tests/, examples/, benches/ and src/bin/ (one per
   * x.rs, or per x/main.rs); `crate::` there names that crate, whose modules
   * sit next to its root file — not the library under src/.
   */
  function rustCrateSrc(fromFile) {
    const crateDir = nearestWith(dirOf(fromFile), 'Cargo.toml');
    if (crateDir === null) return null;
    const inCrate = crateDir ? fromFile.slice(crateDir.length + 1) : fromFile;
    const m = /^(tests|examples|benches|src\/bin)\/(.+)$/.exec(inCrate);
    if (m) {
      const base = join(crateDir, m[1]);
      const sub = m[2].includes('/') ? m[2].split('/')[0] : null;
      if (sub && hasFile(join(base, sub, 'main.rs'))) return join(base, sub);
      return base;
    }
    return join(crateDir, 'src');
  }

  function resolveRust(fromFile, imp) {
    if (imp.kind === 'mod-path') {
      // Rust reference, "The path attribute": outside inline module blocks
      // the path is relative to the directory of the current source file.
      const cand = join(dirOf(fromFile), imp.spec);
      return cand && hasFile(cand) ? cand : null;
    }
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
      // `crate` alone (the module of `crate::load()`) is the crate root.
      if (segs.length === 1) return rustCrateRootFile(src);
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

  /**
   * Scope of a Rust path call `a::b::f()` (`spec` = `a::b::f`) into a repo
   * module: the module's file and the source directory of its crate (where a
   * `pub use` re-export may define `f`). Null when the path names no repo
   * module (std, an external crate, a type).
   */
  function rustPathScope(fromFile, spec) {
    const from = norm(String(fromFile));
    if (from == null) return null;
    // The called last segment is an item; the module is the path before it
    // (`crate::load()` is lib.rs's `load` even when a module `load` exists).
    const segs = spec.split('::');
    const name = segs.pop();
    if (segs.length === 0) return null;
    const file = resolve(from, { spec: segs.join('::'), kind: 'use' }, 'rust');
    if (!file) return null;
    // `pub use auth::login::login as auth_login;` in that module: the call
    // reaches the item under its original name in the module it came from.
    const renamed = new RegExp(String.raw`^\s*(?:pub(?:\([\w:\s]+\))?\s+)?use\s+((?:[\w]+::)+)(\w+)\s+as\s+${name}\s*;`, 'm').exec(readText(file) || '');
    if (renamed) {
      const origin = resolve(file, { spec: `${renamed[1]}${renamed[2]}`, kind: 'use' }, 'rust');
      if (origin) {
        const crate = rustCrateSrc(origin);
        return { file: origin, crate: crate == null ? '' : crate, name: renamed[2] };
      }
    }
    const crate = rustCrateSrc(file);
    return { file, crate: crate == null ? '' : crate };
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

  /**
   * The repo directory of a Go import as seen from `fromFile`: '' for a
   * module's root package at the repo root, 'x' for `<module>/x`; null when
   * the path is under no repo module (standard library, third party);
   * undefined when it is under a repo module but no such directory exists,
   * or when no go.mod / go.work covers the file (GOPATH layout: repo and
   * external paths cannot be told apart).
   */
  function goPackageDir(fromFile, spec) {
    const mods = goModules(dirOf(fromFile));
    if (mods.length === 0) return undefined;
    for (const mod of mods) {
      if (spec !== mod.path && !spec.startsWith(mod.path + '/')) continue;
      const rel = join(mod.dir, spec.slice(mod.path.length).replace(/^\//, ''));
      if (rel === '' || rel === '.') return '';
      return rel && hasDir(rel) ? rel : undefined;
    }
    return null;
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
      const pkg = segs.slice(0, n - 1).join('.');
      for (const ext of JVM_EXTS) {
        const hit = closest(suffixMatches(stem + ext).filter((f) => declares(f, 'jvm', pkg)), fromFile);
        if (hit) return hit;
      }
    }
    // No file named after the class: a Kotlin top-level function or a type
    // declared in a differently named file (`import a.b.foo` in Utils.kt).
    return resolveJvmByIndex(fromFile, imp.spec);
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
    // Without a PSR-4 rule, a file named like the class counts only when it
    // declares the imported namespace (`App\Support\Str.php` is not
    // `Illuminate\Support\Str`).
    const ns = parts.slice(0, -1).join('\\');
    return closest(suffixMatches(`${parts.slice(-2).join('/')}.php`).filter((f) => declares(f, 'php', ns)), fromFile);
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

  // -------------------------------------------------------------------------
  // Shared helpers for the languages below
  // -------------------------------------------------------------------------

  const listMemo = new Map();
  /** Entry names of a repo directory (memoised); [] when missing. */
  function listDir(rel) {
    if (listMemo.has(rel)) return listMemo.get(rel);
    let names = [];
    try { names = fs.readdirSync(path.join(root, rel)); } catch { names = []; }
    listMemo.set(rel, names);
    return names;
  }

  /** First existing candidate (repo-relative), or null. */
  function firstFile(cands) {
    for (const c of cands) if (c != null && hasFile(c)) return c;
    return null;
  }

  // -------------------------------------------------------------------------
  // Stylesheets (Sass / SCSS / Less / CSS)
  // -------------------------------------------------------------------------

  // Sass module resolution (sass-lang.com/documentation/at-rules/use,
  // "Finding the Module"): partial first, then the plain file, then the
  // folder's `_index` / `index`; `.sass`/`.scss`/`.css` extensions.
  function sassCandidates(base) {
    if (base == null) return null;
    const ext = path.posix.extname(base);
    const dir = dirOf(base);
    const name = path.posix.basename(base);
    if (ext === '.scss' || ext === '.sass' || ext === '.css') {
      return firstFile([join(dir, `_${name}`), base]);
    }
    const c = [];
    for (const e of ['.scss', '.sass', '.css']) c.push(join(dir, `_${name}${e}`));
    for (const e of ['.scss', '.sass', '.css']) c.push(join(dir, `${name}${e}`));
    for (const n of ['_index.scss', '_index.sass', 'index.scss', 'index.sass']) c.push(join(base, n));
    return firstFile(c);
  }

  function styleCandidates(base, kind) {
    if (base == null) return null;
    if (kind === 'style-sass') return sassCandidates(base);
    if (kind === 'style-less') return path.posix.extname(base) ? firstFile([base]) : firstFile([`${base}.less`, base]);
    return firstFile([base, path.posix.extname(base) ? null : `${base}.css`]);
  }

  function resolveStyle(fromFile, imp) {
    let spec = imp.spec.replace(/[?#].*$/, '');
    if (!spec || spec.startsWith('~')) return null; // webpack node_modules lookup
    const fromDir = dirOf(fromFile);
    if (spec.startsWith('/')) return styleCandidates(norm(spec.slice(1)), imp.kind);
    const rel = styleCandidates(join(fromDir, spec), imp.kind);
    if (rel) return rel;
    // `@/styles/x` and bundler aliases (Vue / Vite projects).
    const pkgDir = nearestWith(fromDir, 'package.json') ?? '';
    for (const { key, target } of bundlerAliases(pkgDir)) {
      if (spec === key || spec.startsWith(key + '/')) {
        const hit = styleCandidates(join(target, spec.slice(key.length).replace(/^\//, '')), imp.kind);
        if (hit) return hit;
      }
    }
    if (spec.startsWith('@/') || spec.startsWith('~/')) {
      spec = spec.slice(2);
      return styleCandidates(join(pkgDir, 'src', spec), imp.kind) || styleCandidates(join(pkgDir, spec), imp.kind);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Lua
  // -------------------------------------------------------------------------

  // LuaRocks rockspec `build.modules = { ["a.b"] = "src/a/b.lua" }`: the
  // module → file table a builtin build installs from.
  let rockModules = null;
  function luaRockspecModules() {
    if (rockModules) return rockModules;
    rockModules = new Map();
    const specs = [];
    for (const n of listDir('')) if (n.endsWith('.rockspec')) specs.push(n);
    for (const n of listDir('rockspecs')) if (n.endsWith('.rockspec')) specs.push(`rockspecs/${n}`);
    // Newest rockspec last so it wins.
    for (const rel of specs.sort()) {
      const text = readText(rel) || '';
      const re = /\[\s*["']([\w.-]+)["']\s*\]\s*=\s*["']([^"']+\.lua)["']/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const file = norm(m[2]);
        if (file && hasFile(file)) rockModules.set(m[1], file);
      }
    }
    return rockModules;
  }

  // package.path templates `?.lua;?/init.lua` (Lua manual §6.3) tried under
  // the conventional roots, then under each ancestor of the importing file
  // (nested projects run from their own directory).
  function resolveLua(fromFile, spec) {
    if (!/^[\w.\-/]+$/.test(spec)) return null;
    const mapped = luaRockspecModules().get(spec);
    if (mapped) return mapped;
    const rel = spec.includes('/') ? spec.replace(/\.lua$/, '') : spec.replace(/\./g, '/');
    const tryRoot = (r) => firstFile([join(r, `${rel}.lua`), join(r, rel, 'init.lua')]);
    for (const r of ['', 'lua', 'src', 'lib']) { const hit = tryRoot(r); if (hit) return hit; }
    let d = dirOf(fromFile);
    while (d) {
      const hit = tryRoot(d) || tryRoot(join(d, 'lua'));
      if (hit) return hit;
      d = dirOf(d);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Zig
  // -------------------------------------------------------------------------

  // build.zig named modules: `b.addModule("name", .{ .root_source_file = b.path("src/x.zig") })`,
  // `const m = b.createModule(.{ .root_source_file = ... }); x.addImport("name", m)`.
  const zigModMemo = new Map();
  function zigBuildModules(buildDir) {
    if (zigModMemo.has(buildDir)) return zigModMemo.get(buildDir);
    const mods = new Map();
    const text = readText(join(buildDir, 'build.zig') ?? 'build.zig') || '';
    const srcOf = (s) => {
      const m = /root_source_file\s*=\s*(?:b\.path\(\s*"([^"]+)"\s*\)|\.\{\s*\.(?:path|cwd_relative)\s*=\s*"([^"]+)"\s*\}|[\w.]*path\(\s*"([^"]+)"\s*\))/.exec(s);
      return m ? join(buildDir, m[1] || m[2] || m[3]) : null;
    };
    const addRe = /addModule\(\s*"([^"]+)"\s*,\s*\.\{([\s\S]{0,600}?)\}\s*\)/g;
    let m;
    while ((m = addRe.exec(text)) !== null) { const f = srcOf(m[2]); if (f) mods.set(m[1], f); }
    const varRe = /const\s+(\w+)\s*=\s*b\.(?:createModule|addModule\(\s*"[^"]*"\s*,)\s*\(?\s*\.\{([\s\S]{0,600}?)\}\s*\)/g;
    const vars = new Map();
    while ((m = varRe.exec(text)) !== null) { const f = srcOf(m[2]); if (f) vars.set(m[1], f); }
    const importRe = /addImport\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g;
    while ((m = importRe.exec(text)) !== null) if (vars.has(m[2]) && !mods.has(m[1])) mods.set(m[1], vars.get(m[2]));
    zigModMemo.set(buildDir, mods);
    return mods;
  }

  function resolveZig(fromFile, spec) {
    if (spec.endsWith('.zig') || spec.endsWith('.zon')) {
      const cand = join(dirOf(fromFile), spec);
      return cand && hasFile(cand) ? cand : null;
    }
    if (spec === 'std' || spec === 'builtin' || spec === 'root') return null;
    const buildDir = nearestWith(dirOf(fromFile), 'build.zig');
    if (buildDir === null) return null;
    const f = zigBuildModules(buildDir).get(spec);
    return f && hasFile(f) ? f : null;
  }

  // -------------------------------------------------------------------------
  // Haskell
  // -------------------------------------------------------------------------

  // GHC finds module A.B at <source dir>/A/B.hs; source dirs come from the
  // package's `hs-source-dirs` (.cabal) / `source-dirs` (package.yaml), as
  // HLS reads them through hie-bios.
  const hsDirMemo = new Map();
  function haskellSourceDirs(fromDir) {
    if (hsDirMemo.has(fromDir)) return hsDirMemo.get(fromDir);
    const dirs = [];
    let d = fromDir;
    for (;;) {
      const names = listDir(d);
      const cabal = names.find((n) => n.endsWith('.cabal'));
      const yaml = names.includes('package.yaml') ? 'package.yaml' : null;
      if (cabal || yaml) {
        for (const cfg of [cabal, yaml]) {
          if (!cfg) continue;
          const text = readText(join(d, cfg) ?? cfg) || '';
          const re = /(?:hs-source-dirs|source-dirs)\s*:\s*(\[[^\]]*\]|[^\n]+)/gi;
          let m;
          while ((m = re.exec(text)) !== null) {
            for (const part of m[1].replace(/[[\]"']/g, ' ').split(/[\s,]+/)) {
              const j = part ? join(d, part) : null;
              if (j !== null && !dirs.includes(j)) dirs.push(j);
            }
          }
        }
        for (const def of ['src', 'lib', 'app', 'test', 'tests', '']) {
          const j = join(d, def) ?? d;
          if (!dirs.includes(j)) dirs.push(j);
        }
        break;
      }
      if (!d) break;
      d = dirOf(d);
    }
    if (dirs.length === 0) dirs.push('src', 'lib', 'app', '');
    hsDirMemo.set(fromDir, dirs);
    return dirs;
  }

  function resolveHaskell(fromFile, spec) {
    const rel = spec.replace(/\./g, '/');
    for (const d of haskellSourceDirs(dirOf(fromFile))) {
      const hit = firstFile([join(d, `${rel}.hs`), join(d, `${rel}.lhs`), join(d, `${rel}.hsc`), join(d, `${rel}.hs-boot`)]);
      if (hit && declares(hit, 'haskell', spec)) return hit;
    }
    // A module path is the file path below some source dir; a multi-segment
    // name is specific enough to match on its suffix — when the file is that
    // module (`src/MyLib/Data/Map.hs` is MyLib.Data.Map, not Data.Map).
    if (!spec.includes('.')) return null;
    return closest(suffixMatches(`${rel}.hs`).filter((f) => declares(f, 'haskell', spec)), fromFile);
  }

  // -------------------------------------------------------------------------
  // Clojure
  // -------------------------------------------------------------------------

  const cljRootMemo = new Map();
  function clojureRoots(fromDir) {
    if (cljRootMemo.has(fromDir)) return cljRootMemo.get(fromDir);
    let projDir = null;
    const cfgNames = ['deps.edn', 'project.clj', 'shadow-cljs.edn', 'bb.edn'];
    for (const n of cfgNames) {
      const at = nearestWith(fromDir, n);
      if (at !== null && (projDir === null || at.length > projDir.length)) projDir = at;
    }
    const roots = [];
    const add = (r) => { const j = r === '' ? (projDir ?? '') : join(projDir ?? '', r); if (j !== null && !roots.includes(j)) roots.push(j); };
    if (projDir !== null) {
      for (const n of cfgNames) {
        const text = readText(join(projDir, n) ?? n);
        if (!text) continue;
        const re = /:(?:paths|extra-paths|source-paths|test-paths|java-source-paths)\s*\[([^\]]*)\]/g;
        let m;
        while ((m = re.exec(text)) !== null) for (const s of m[1].match(/"[^"]+"/g) || []) add(s.slice(1, -1));
      }
    }
    for (const r of ['src', 'test', 'src/main/clojure', 'src/clj', 'src/cljs', 'src/cljc', 'dev', '']) add(r);
    cljRootMemo.set(fromDir, roots);
    return roots;
  }

  // Clojure's loader maps namespace a.b-c to a/b_c.clj(c) on the classpath.
  function resolveClojure(fromFile, spec) {
    const rel = spec.replace(/-/g, '_').replace(/\./g, '/');
    const ext = path.posix.extname(fromFile);
    const exts = ext === '.cljs' ? ['.cljs', '.cljc'] : ext === '.cljc' ? ['.cljc', '.clj', '.cljs'] : ['.clj', '.cljc'];
    for (const r of clojureRoots(dirOf(fromFile))) {
      const hit = firstFile(exts.map((e) => join(r, `${rel}${e}`)));
      if (hit && declares(hit, 'clojure', spec)) return hit;
    }
    if (!spec.includes('.')) return null;
    for (const e of exts) {
      const hit = closest(suffixMatches(`${rel}${e}`).filter((f) => declares(f, 'clojure', spec)), fromFile);
      if (hit) return hit;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Solidity
  // -------------------------------------------------------------------------

  // Remappings (`prefix=target`, optional `context:` scope) from
  // remappings.txt and foundry.toml, longest prefix first (Solidity docs,
  // "Import Path Resolution" → Import Remapping).
  const solRemapMemo = new Map();
  function solidityProject(fromDir) {
    if (solRemapMemo.has(fromDir)) return solRemapMemo.get(fromDir);
    let projDir = null;
    for (const n of ['foundry.toml', 'remappings.txt', 'hardhat.config.ts', 'hardhat.config.js', 'truffle-config.js']) {
      const at = nearestWith(fromDir, n);
      if (at !== null && (projDir === null || at.length > projDir.length)) projDir = at;
    }
    const base = projDir ?? '';
    const remaps = [];
    const addLine = (line) => {
      const m = /^\s*(?:([^:=\s]+):)?([^=\s]+)=(\S+)\s*$/.exec(line);
      if (m) remaps.push({ context: m[1] ? join(base, m[1]) : null, prefix: m[2], target: join(base, m[3]) });
    };
    for (const line of (readText(join(base, 'remappings.txt') ?? 'remappings.txt') || '').split('\n')) addLine(line);
    const toml = readText(join(base, 'foundry.toml') ?? 'foundry.toml') || '';
    const arr = /remappings\s*=\s*\[([\s\S]*?)\]/.exec(toml);
    if (arr) for (const s of arr[1].match(/["']([^"']+)["']/g) || []) addLine(s.slice(1, -1));
    remaps.sort((a, b) => b.prefix.length - a.prefix.length);
    const out = { base, remaps };
    solRemapMemo.set(fromDir, out);
    return out;
  }

  function resolveSolidity(fromFile, spec) {
    const fromDir = dirOf(fromFile);
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const cand = join(fromDir, spec);
      return cand && hasFile(cand) ? cand : null;
    }
    const { base, remaps } = solidityProject(fromDir);
    for (const r of remaps) {
      if (r.target === null || !spec.startsWith(r.prefix)) continue;
      if (r.context && !(fromFile === r.context || fromFile.startsWith(r.context.replace(/\/?$/, '/')))) continue;
      const cand = join(r.target, spec.slice(r.prefix.length));
      if (cand && hasFile(cand)) return cand;
    }
    // Base path = project root; Foundry auto-detects lib/<dep>/src remaps.
    const direct = join(base, spec);
    if (direct && hasFile(direct)) return direct;
    const [head, ...rest] = spec.replace(/^@/, '').split('/');
    if (head && rest.length) {
      for (const libDir of [join(base, 'lib', head), join(base, 'lib', `${head}-contracts`)]) {
        if (!libDir || !hasDir(libDir)) continue;
        const hit = firstFile([join(libDir, 'src', rest.join('/')), join(libDir, rest.join('/')), join(libDir, 'contracts', rest.join('/'))]);
        if (hit) return hit;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Protocol Buffers
  // -------------------------------------------------------------------------

  // protoc resolves `import "a/b.proto"` against its -I roots; buf uses the
  // module root (buf.yaml) or buf.work.yaml directories.
  const protoRootMemo = new Map();
  function protoRoots(fromDir) {
    if (protoRootMemo.has(fromDir)) return protoRootMemo.get(fromDir);
    const roots = [];
    const add = (r) => { if (r !== null && !roots.includes(r)) roots.push(r); };
    const bufDir = nearestWith(fromDir, 'buf.yaml');
    if (bufDir !== null) add(bufDir);
    const workDir = nearestWith(fromDir, 'buf.work.yaml');
    if (workDir !== null) {
      const text = readText(join(workDir, 'buf.work.yaml') ?? 'buf.work.yaml') || '';
      for (const m of text.matchAll(/^\s*-\s*["']?([\w./-]+)["']?\s*$/gm)) add(join(workDir, m[1]));
    }
    for (const r of ['', 'proto', 'protos', 'protobuf', 'src/main/proto', 'api']) add(r);
    let d = fromDir;
    while (d) { add(d); d = dirOf(d); }
    protoRootMemo.set(fromDir, roots);
    return roots;
  }

  function resolveProto(fromFile, spec) {
    for (const r of protoRoots(dirOf(fromFile))) {
      const cand = join(r, spec);
      if (cand && hasFile(cand)) return cand;
    }
    if (!spec.includes('/')) return null;
    return closest(suffixMatches(norm(spec) ?? spec), fromFile);
  }

  // -------------------------------------------------------------------------
  // Small path-based languages
  // -------------------------------------------------------------------------

  function relativeFile(fromFile, spec, exts = ['']) {
    return firstFile(exts.map((e) => join(dirOf(fromFile), spec + e)));
  }

  function resolveElm(fromFile, spec) {
    const elmDir = nearestWith(dirOf(fromFile), 'elm.json');
    if (elmDir === null) return null;
    let dirs = ['src'];
    try {
      const json = JSON.parse(readText(join(elmDir, 'elm.json') ?? 'elm.json') || '{}');
      if (Array.isArray(json['source-directories'])) dirs = json['source-directories'];
    } catch { /* default */ }
    const rel = `${spec.replace(/\./g, '/')}.elm`;
    return firstFile(dirs.map((d) => join(elmDir, d, rel)));
  }

  // Perl @INC conventions: lib/ of the distribution, the repo root, t/lib.
  function resolvePerl(fromFile, imp) {
    if (imp.kind === 'perl-file') return relativeFile(fromFile, imp.spec) || firstFile([norm(imp.spec)]);
    const rel = `${imp.spec.replace(/::/g, '/')}.pm`;
    const roots = ['lib', '', 't/lib'];
    let d = dirOf(fromFile);
    while (d) { if (path.posix.basename(d) === 'lib') roots.unshift(d); d = dirOf(d); }
    // A .pm file is the module only when it declares that package
    // (`lib/My/Foo/Bar.pm` is My::Foo::Bar, not CPAN's Foo::Bar).
    for (const r of roots) {
      const cand = join(r, rel);
      if (cand && hasFile(cand) && declares(cand, 'perl', imp.spec)) return cand;
    }
    return imp.spec.includes('::') ? closest(suffixMatches(rel).filter((f) => declares(f, 'perl', imp.spec)), fromFile) : null;
  }

  // Erlang: `-include` searches the file's directory then the include path
  // (by convention ../include); `-include_lib("app/include/x.hrl")` names
  // an application directory.
  function resolveErlang(fromFile, imp) {
    const fromDir = dirOf(fromFile);
    if (imp.kind === 'erl-include') {
      return firstFile([join(fromDir, imp.spec), join(dirOf(fromDir), 'include', imp.spec), join('include', imp.spec)]);
    }
    const [app, ...rest] = imp.spec.split('/');
    if (!rest.length) return null;
    const tail = rest.join('/');
    for (const base of [join('apps', app), join('lib', app), app, '']) {
      const cand = join(base ?? '', tail);
      if (cand && hasFile(cand)) return cand;
    }
    return null;
  }

  // Crystal: "./x" → x.cr or x/x.cr relative to the file; "x" → src/x.cr.
  function resolveCrystal(fromFile, spec) {
    if (spec.includes('*')) return null;
    const name = path.posix.basename(spec);
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return relativeFile(fromFile, spec, ['.cr', `/${name}.cr`]) || relativeFile(fromFile, spec.endsWith('.cr') ? spec : `${spec}.cr`);
    }
    return firstFile([join('src', `${spec}.cr`), join('src', spec, `${name}.cr`)]);
  }

  // Terraform: a local module source is a directory (all its .tf files).
  function resolveTerraform(fromFile, spec) {
    const dir = join(dirOf(fromFile), spec.replace(/\/+$/, ''));
    return dir && hasDir(dir) ? `${dir}/` : null;
  }

  // Shell `source`: the script-directory idioms resolve against the file's
  // directory; a literal path is relative to the working directory, which
  // is unknown — try the file's directory, then the repo root.
  function resolveShell(fromFile, imp) {
    if (imp.kind === 'sh-scriptdir') return relativeFile(fromFile, imp.spec);
    if (imp.spec.startsWith('/') || imp.spec.startsWith('~')) return null;
    return relativeFile(fromFile, imp.spec) || firstFile([norm(imp.spec)]);
  }

  // -------------------------------------------------------------------------
  // Swift (SwiftPM targets)
  // -------------------------------------------------------------------------

  // Package.swift targets: `.target(name: "X", path: "P")`; default
  // Sources/<name>, Tests/<name> for test targets (PackageDescription docs).
  let swiftTargetList = null;
  function swiftTargets() {
    if (swiftTargetList) return swiftTargetList;
    swiftTargetList = [];
    const manifests = [...fileSet].filter((f) => path.posix.basename(f) === 'Package.swift');
    if (manifests.length === 0 && readText('Package.swift') !== null) manifests.push('Package.swift');
    for (const mf of manifests) {
      // Commented-out targets must not count; target names live in strings,
      // so only line comments are dropped.
      const text = (readText(mf) || '').replace(/^[ \t]*\/\/[^\n]*/gm, '');
      const pkgDir = dirOf(mf);
      const re = /\.(target|executableTarget|testTarget|macro|plugin)\s*\(\s*name\s*:\s*"([^"]+)"/g;
      let skipUntil = -1;
      let m;
      while ((m = re.exec(text)) !== null) {
        // `.target(name: "X")` inside a declaration's `dependencies:` is a
        // reference, not a declaration: skip everything inside the
        // balanced argument list of the declaration being read.
        if (m.index < skipUntil) continue;
        const open = text.indexOf('(', m.index);
        let depth = 0;
        let end = open;
        for (; end < text.length; end++) {
          const ch = text[end];
          if (ch === '"') { end++; while (end < text.length && text[end] !== '"') { if (text[end] === '\\') end++; end++; } continue; }
          if (ch === '(') depth++;
          else if (ch === ')' && --depth === 0) break;
        }
        const args = text.slice(m.index + m[0].length, end);
        // A bare reference (`.target(name: "X")`, `…, condition: …)`) at top level.
        if (!/\b(?:dependencies|path|sources|resources|exclude|swiftSettings|cSettings|plugins)\s*:/.test(args) && args.trim().replace(/^,/, '').trim() === '') continue;
        skipUntil = end;
        const own = args.replace(/\.(?:target|product|byName)\s*\([^()]*\)/g, '');
        const p = /\bpath\s*:\s*"([^"]+)"/.exec(own);
        const dir = p ? join(pkgDir, p[1]) : join(pkgDir, m[1] === 'testTarget' ? 'Tests' : 'Sources', m[2]);
        // `exclude: ["Legacy", "Old.swift"]`: paths inside the target that are
        // not compiled into it (PackageDescription, Target.exclude).
        const ex = /\bexclude\s*:\s*\[([^\]]*)\]/.exec(own);
        const exclude = ex ? (ex[1].match(/"[^"]+"/g) || []).map((s) => join(dir ?? '', s.slice(1, -1))).filter(Boolean) : [];
        if (dir !== null && hasDir(dir)) swiftTargetList.push({ name: m[2], dir, exclude });
      }
    }
    return swiftTargetList;
  }

  function swiftTargetOf(file) {
    let best = null;
    for (const t of swiftTargets()) {
      if ((t.dir === '' || file.startsWith(t.dir + '/')) && (!best || t.dir.length > best.dir.length)) best = t;
    }
    // An excluded path belongs to no module: it is not compiled.
    if (best && best.exclude.some((x) => file === x || file.startsWith(x + '/'))) return null;
    return best;
  }

  function swiftTargetNamed(name) {
    const hits = swiftTargets().filter((t) => t.name === name);
    return hits.length === 1 ? hits[0] : null;
  }

  function resolveSwift(fromFile, spec) {
    const t = swiftTargetNamed(spec);
    return t && t.dir ? `${t.dir}/` : null;
  }

  const swiftModuleIndexMemo = new Map();
  function swiftModuleIndex(target) {
    if (swiftModuleIndexMemo.has(target.dir)) return swiftModuleIndexMemo.get(target.dir);
    const byName = new Map();
    const prefix = target.dir ? `${target.dir}/` : '';
    for (const f of fileSet) {
      if (!f.endsWith('.swift') || !f.startsWith(prefix)) continue;
      if (swiftTargetOf(f) !== target) continue;
      const decls = cachedDeclarations(root, f, 'swift', (text) => braceDeclarations(stripNoise(text, 'swift')).decls);
      if (!decls) continue;
      for (const d of decls) addDecl(byName, d.name, f, d.kind, d);
    }
    swiftModuleIndexMemo.set(target.dir, byName);
    return byName;
  }

  // -------------------------------------------------------------------------
  // C#
  // -------------------------------------------------------------------------

  let csIndexMemo = null;
  function csIndex() {
    if (csIndexMemo) return csIndexMemo;
    const types = new Map(); // ns -> Map(name -> [{file, kind}])
    const namespaces = new Set();
    const globalUsings = new Map(); // project dir -> [ns]
    const projectDirs = [...fileSet].filter((f) => f.endsWith('.csproj')).map(dirOf);
    for (const f of fileSet) {
      if (!f.endsWith('.cs')) continue;
      const decl = cachedDeclarations(root, f, 'csharp', (text) => csharpDeclarations(stripNoise(text, 'csharp')));
      if (!decl) continue;
      for (const ns of decl.namespaces) namespaces.add(ns);
      for (const t of decl.types) {
        let byName = types.get(t.ns);
        if (!byName) { byName = new Map(); types.set(t.ns, byName); }
        addDecl(byName, t.name, f, 'type', t);
      }
      if (decl.globalUsings.length) {
        const proj = csProjectOf(f, projectDirs);
        let list = globalUsings.get(proj);
        if (!list) { list = []; globalUsings.set(proj, list); }
        for (const u of decl.globalUsings) if (!list.includes(u)) list.push(u);
      }
    }
    csIndexMemo = { types, namespaces, globalUsings, projectDirs };
    return csIndexMemo;
  }

  function csProjectOf(file, projectDirs) {
    let best = '';
    for (const d of projectDirs) if ((d === '' || file.startsWith(d + '/')) && d.length >= best.length) best = d;
    return best;
  }

  function resolveCsharp(fromFile, imp) {
    if (imp.kind !== 'cs-alias' && imp.kind !== 'cs-static') return null;
    const dot = imp.spec.lastIndexOf('.');
    if (dot === -1) return null;
    const entry = csIndex().types.get(imp.spec.slice(0, dot))?.get(imp.spec.slice(dot + 1));
    if (!entry) return null;
    const others = narrowDeclarers(entry, entry.type.filter((f) => f !== fromFile));
    return others.length >= 1 ? others[0] : null;
  }

  // -------------------------------------------------------------------------
  // JVM declaration index (Java / Kotlin / Scala / Groovy share packages)
  // -------------------------------------------------------------------------

  let jvmIndexMemo = null;
  function jvmIndex() {
    if (jvmIndexMemo) return jvmIndexMemo;
    jvmIndexMemo = new Map(); // package -> Map(name -> [{file, kind}])
    for (const f of fileSet) {
      const lang = JVM_LANG_OF_EXT[path.posix.extname(f)];
      if (!lang) continue;
      const parsed = cachedDeclarations(root, f, lang, (text) => braceDeclarations(stripNoise(text, lang)));
      if (!parsed) continue;
      const { packages, decls } = parsed;
      const pkg = packageChain(packages).pop() || '';
      let byName = jvmIndexMemo.get(pkg);
      if (!byName) { byName = new Map(); jvmIndexMemo.set(pkg, byName); }
      for (const d of decls) addDecl(byName, d.name, f, d.kind, d);
    }
    return jvmIndexMemo;
  }

  /** Kotlin top-level functions and classes in differently named files. */
  function resolveJvmByIndex(fromFile, spec) {
    const dot = spec.lastIndexOf('.');
    if (dot === -1) return null;
    const entry = jvmIndex().get(spec.slice(0, dot))?.get(spec.slice(dot + 1));
    if (!entry) return null;
    const files = narrowDeclarers(entry, [...new Set([...entry.type, ...entry.func])].filter((f) => f !== fromFile));
    return files.length === 1 ? files[0] : null;
  }

  // -------------------------------------------------------------------------
  // Elixir module index
  // -------------------------------------------------------------------------

  let exIndexMemo = null;
  function exIndex() {
    if (exIndexMemo) return exIndexMemo;
    exIndexMemo = new Map(); // module -> [files]
    for (const f of fileSet) {
      if (!f.endsWith('.ex') && !f.endsWith('.exs')) continue;
      const mods = cachedDeclarations(root, f, 'elixir', (text) => elixirModules(stripNoise(text, 'elixir')));
      if (!mods) continue;
      for (const mod of mods) {
        const list = exIndexMemo.get(mod);
        if (!list) exIndexMemo.set(mod, [f]); else if (!list.includes(f)) list.push(f);
      }
    }
    return exIndexMemo;
  }

  function resolveElixirModule(fromFile, mod) {
    const files = exIndex().get(mod);
    if (!files) return null;
    const others = files.filter((f) => f !== fromFile);
    return others.length === 1 ? others[0] : null;
  }

  // -------------------------------------------------------------------------
  // Implicit references (namespace / package / module languages)
  // -------------------------------------------------------------------------

  /**
   * Index entry per name: declaring files split by kind ('type' | 'func'),
   * plus the files whose declaration is a Kotlin `actual` (platform
   * implementation) or a C# `partial` part.
   */
  function addDecl(byName, name, file, kind, flags = null) {
    let entry = byName.get(name);
    if (!entry) { entry = { type: [], func: [], actual: new Set(), partial: new Set() }; byName.set(name, entry); }
    const list = kind === 'func' ? entry.func : entry.type;
    if (!list.includes(file)) list.push(file);
    if (flags?.actual) entry.actual.add(file);
    if (flags?.partial) entry.partial.add(file);
  }

  /**
   * The declaring files one reference may link to. Several files declaring
   * the name in one scope are linked only when they are one declaration:
   * the parts of a C# partial type. Kotlin `actual` platform implementations
   * give way to the `expect` declaration (a JVM file must not link the JS and
   * native actuals). Anything else — overloads in different files, the same
   * class in two Gradle modules — is ambiguous: no edge.
   */
  function narrowDeclarers(entry, files) {
    let out = files;
    if (out.length > 1 && entry.actual.size) {
      const expectOnly = out.filter((f) => !entry.actual.has(f));
      if (expectOnly.length) out = expectOnly;
    }
    if (out.length > 1 && !out.every((f) => entry.partial.has(f))) return [];
    return out.length <= MAX_FILES_PER_NAME ? out : [];
  }

  /**
   * Resolve `name` through ordered visibility tiers. Each tier is a list of
   * [scopeKey, Map(name -> entry)]. The first tier that declares the name
   * wins; two scopes of that tier declaring it is an ambiguity (no edge).
   */
  /** Drop scopes the index does not know and tiers left empty. */
  function liveTiers(tiers) {
    const out = [];
    for (const tier of tiers) {
      const live = tier.filter((s) => s[1]);
      if (live.length) out.push(live);
    }
    return out;
  }

  function lookupTiers(tiers, name, kind, fromFile) {
    for (const tier of tiers) {
      let hitScope = null;
      let hitFiles = null;
      for (const [scope, byName] of tier) {
        const entry = byName && byName.get(name);
        if (!entry) continue;
        const list = kind === 'func' ? entry.func : entry.type;
        if (list.length === 0) continue;
        if (hitFiles !== null && hitScope !== scope) return null; // ambiguous
        hitScope = scope;
        hitFiles = list;
      }
      if (hitFiles === null) continue;
      const files = hitFiles.includes(fromFile) ? hitFiles.filter((f) => f !== fromFile) : hitFiles;
      if (files.length === 0) return null; // declared by the importing file itself
      const entry = tier.find(([s]) => s === hitScope)[1].get(name);
      const narrowed = narrowDeclarers(entry, files);
      return narrowed.length ? { scope: hitScope, files: narrowed } : null;
    }
    return null;
  }

  /**
   * File-level dependencies a namespace/module language creates without a
   * file-naming import: names the file uses that resolve, by the language's
   * lookup rules, to a top-level declaration of another repo file.
   *
   * @param {string} fromFile - repo-relative file
   * @param {string} content - its source
   * @param {string} language - import language id
   * @param {Array<{spec: string, kind: string, names?: string[]}>} scanned - scanImports() result
   * @returns {Array<{target: string, spec: string, line: number}>}
   */
  function implicitImports(fromFile, content, language, scanned = []) {
    const from = norm(String(fromFile));
    if (from == null || !content) return [];
    try {
      switch (language) {
        case 'csharp': return implicitCsharp(from, content, scanned);
        case 'java': case 'kotlin': case 'scala': case 'groovy': return implicitJvm(from, content, language, scanned);
        case 'swift': return implicitSwift(from, content, scanned);
        case 'elixir': return implicitElixir(from, content, scanned);
        default: return [];
      }
    } catch {
      return [];
    }
  }

  function collectEdges(refs, body, resolveName, seen = new Set()) {
    const out = [];
    for (const [name, index] of refs) {
      const hit = resolveName(name, index);
      if (!hit) continue;
      for (const file of hit.files) {
        if (seen.has(file)) continue;
        seen.add(file);
        out.push({ target: file, spec: hit.spec || (hit.scope ? `${hit.scope}.${name}` : name), line: lineOfIndex(body, index) });
        if (out.length >= MAX_IMPLICIT_EDGES_PER_FILE) return out;
      }
    }
    return out;
  }

  /**
   * Namespace prefixes (`a`, `a.b`, `a.b.c` for namespace a.b.c) and the
   * segments a qualified chain may start with, for one declaration index.
   */
  const prefixMemo = new WeakMap();
  function namespacePrefixes(nsMap) {
    let p = prefixMemo.get(nsMap);
    if (p) return p;
    const prefixes = new Set();
    const heads = new Set();
    for (const ns of nsMap.keys()) {
      if (!ns) continue;
      const parts = ns.split('.');
      for (let k = 1; k <= parts.length; k++) prefixes.add(parts.slice(0, k).join('.'));
      for (const seg of parts) heads.add(seg);
    }
    p = { prefixes, heads };
    prefixMemo.set(nsMap, p);
    return p;
  }

  /**
   * A dotted chain that spells `<namespace>.<Name>` relative to one of
   * `bases` (innermost first; '' = absolute): the longest namespace prefix
   * that declares the next segment wins.
   */
  function qualifiedHit(chain, bases, nsMap, fromFile) {
    const segs = chain.split('.');
    const { prefixes } = namespacePrefixes(nsMap);
    for (const base of bases) {
      const head = base ? `${base}.${segs[0]}` : segs[0];
      if (!prefixes.has(head)) continue;
      for (let k = segs.length - 1; k >= 1; k--) {
        const ns = base ? `${base}.${segs.slice(0, k).join('.')}` : segs.slice(0, k).join('.');
        const entry = nsMap.get(ns)?.get(segs[k]);
        if (!entry) continue;
        const list = entry.type.length ? entry.type : entry.func;
        if (!list.length) continue;
        const files = narrowDeclarers(entry, list.filter((f) => f !== fromFile));
        if (files.length === 0) return null;
        return { scope: ns, files, spec: `${ns}.${segs[k]}` };
      }
    }
    return null;
  }

  function implicitCsharp(from, content, scanned) {
    const idx = csIndex();
    if (idx.types.size === 0) return [];
    const stripped = stripNoise(content, 'csharp');
    const ranges = csharpNamespaceRanges(stripped);
    // Innermost block-namespace range holding an offset (null at file level;
    // a file-scoped namespace runs to the end, so it holds every later offset).
    const rangeAt = (offset) => {
      let best = null;
      for (const r of ranges) if (offset >= r.start && offset < r.end && (!best || r.start >= best.start)) best = r;
      return best;
    };
    const lineStarts = [0];
    for (let k = stripped.indexOf('\n'); k !== -1; k = stripped.indexOf('\n', k + 1)) lineStarts.push(k + 1);
    // Using directives apply to the body of the namespace block they are
    // written in (C# spec, "Using directives"); file-level ones everywhere.
    const usings = []; // { ns, range }
    const aliasNames = new Set();
    for (const imp of scanned) {
      if (imp.kind === 'cs-namespace' || imp.kind === 'cs-global') {
        const at = lineStarts[Math.max(0, (imp.line || 1) - 1)] ?? 0;
        const range = imp.kind === 'cs-global' ? null : rangeAt(at);
        if (!usings.some((u) => u.ns === imp.spec && u.range === range)) usings.push({ ns: imp.spec, range });
      }
      if (imp.kind === 'cs-alias') for (const n of imp.names || []) aliasNames.add(n);
    }
    for (const u of idx.globalUsings.get(csProjectOf(from, idx.projectDirs)) || []) {
      if (!usings.some((x) => x.ns === u && x.range === null)) usings.push({ ns: u, range: null });
    }
    const scope = (ns) => [ns, idx.types.get(ns)];
    const outerChain = (ns) => {
      const parts = ns ? ns.split('.') : [];
      const out = [];
      for (let n = parts.length; n >= 1; n--) out.push(parts.slice(0, n).join('.'));
      out.push('');
      return out;
    };
    // C# spec: the enclosing namespace, then its using directives, then the
    // outer namespaces innermost first, then the global namespace.
    const tiersMemo = new Map();
    const tiersAt = (index) => {
      const ns = namespaceAt(ranges, index);
      const visible = [];
      for (const u of usings) {
        if ((!u.range || (index >= u.range.start && index < u.range.end)) && !visible.includes(u.ns)) visible.push(u.ns);
      }
      const key = `${ns}\0${visible.join(',')}`;
      let t = tiersMemo.get(key);
      if (!t) {
        const chain = outerChain(ns);
        t = liveTiers([[scope(chain[0])], visible.map(scope), ...chain.slice(1).map((n) => [scope(n)])]);
        tiersMemo.set(key, t);
      }
      return t;
    };
    const { types, body } = referencedNames(stripped, { capitalizedMethods: true });
    for (const a of aliasNames) types.delete(a);
    const seen = new Set();
    const out = collectEdges(types, body, (name, index) => {
      const tiers = tiersAt(index);
      const hit = lookupTiers(tiers, name, 'type', from);
      if (hit || name.endsWith('Attribute')) return hit;
      // `[Foo]` names attribute class FooAttribute.
      const attr = lookupTiers(tiers, `${name}Attribute`, 'type', from);
      return attr ? { ...attr, spec: `${attr.scope ? `${attr.scope}.` : ''}${name}Attribute` } : null;
    }, seen);
    // Qualified references: `Ocelot.Configuration.File.FileRoute`, or
    // `Configuration.File.FileRoute` inside namespace Ocelot.
    const chains = qualifiedChains(body, namespacePrefixes(idx.types).heads);
    for (const e of collectEdges(chains, body, (chain, index) => qualifiedHit(chain, outerChain(namespaceAt(ranges, index)), idx.types, from), seen)) out.push(e);
    return out.slice(0, MAX_IMPLICIT_EDGES_PER_FILE);
  }

  function implicitJvm(from, content, language, scanned) {
    const idx = jvmIndex();
    if (idx.size === 0) return [];
    const stripped = stripNoise(content, language);
    const chain = packageChain(packageClauses(stripped));
    const ownPkg = chain.length ? chain[chain.length - 1] : '';
    const wildcards = [];
    const bound = new Set();
    for (const imp of scanned) {
      if (imp.kind === 'jvm-wildcard') { if (!wildcards.includes(imp.spec)) wildcards.push(imp.spec); continue; }
      if (imp.kind !== 'jvm') continue;
      // `import a.B as C` binds C; `import a.{B => C}` binds C.
      bound.add(imp.names && imp.names.length ? imp.names[0] : imp.spec.split('.').pop());
    }
    const scope = (p) => [p, idx.get(p)];
    // Java/Kotlin: single-type imports shadow the package, which shadows
    // on-demand imports. Scala: wildcard imports outrank package members of
    // other compilation units; chained package clauses keep outer packages visible.
    const tiers = liveTiers(language === 'scala'
      ? [wildcards.map(scope), [scope(ownPkg)], ...chain.slice(0, -1).reverse().map((p) => [scope(p)])]
      : [[scope(ownPkg)], wildcards.map(scope)]);
    const withCalls = language === 'kotlin' || language === 'scala';
    const { types, calls, body } = referencedNames(stripped, { calls: withCalls });
    for (const b of bound) { types.delete(b); calls.delete(b); }
    const seen = new Set();
    const out = tiers.length ? collectEdges(types, body, (name) => lookupTiers(tiers, name, 'type', from), seen) : [];
    if (withCalls && tiers.length) {
      for (const e of collectEdges(calls, body, (name) => lookupTiers(tiers, name, 'func', from), seen)) out.push(e);
    }
    // Fully qualified references (`extends zipkin2.storage.StorageComponent`).
    const chains = qualifiedChains(body, namespacePrefixes(idx).heads);
    for (const e of collectEdges(chains, body, (c) => qualifiedHit(c, [''], idx, from), seen)) out.push(e);
    return out.slice(0, MAX_IMPLICIT_EDGES_PER_FILE);
  }

  function implicitSwift(from, content, scanned) {
    const own = swiftTargetOf(from);
    if (!own) return [];
    const tiers = [[[own.name, swiftModuleIndex(own)]]];
    const imported = [];
    for (const imp of scanned) {
      const t = imp.kind === 'swift-module' ? swiftTargetNamed(imp.spec) : null;
      if (t && t !== own) imported.push([t.name, swiftModuleIndex(t)]);
    }
    if (imported.length) tiers.push(imported);
    const { types, calls, body } = referencedNames(stripNoise(content, 'swift'), { calls: true });
    const out = collectEdges(types, body, (name) => lookupTiers(tiers, name, 'type', from));
    const seen = new Set(out.map((e) => e.target));
    for (const e of collectEdges(calls, body, (name) => lookupTiers(tiers, name, 'func', from))) {
      if (!seen.has(e.target)) { seen.add(e.target); out.push(e); }
    }
    return out.slice(0, MAX_IMPLICIT_EDGES_PER_FILE);
  }

  function implicitElixir(from, content, scanned) {
    const idx = exIndex();
    if (idx.size === 0) return [];
    const stripped = stripNoise(content, 'elixir');
    const ownMods = new Set(elixirModules(stripped));
    const aliases = new Map();
    for (const imp of scanned) if (imp.kind === 'ex-alias') for (const n of imp.names || []) aliases.set(n, imp.spec);
    const refs = elixirReferences(stripped);
    return collectEdges(refs, stripped, (name) => {
      const head = name.split('.')[0];
      const expanded = aliases.has(head) ? aliases.get(head) + name.slice(head.length) : null;
      for (const mod of [expanded, name]) {
        if (!mod || ownMods.has(mod)) continue;
        const files = (idx.get(mod) || []).filter((f) => f !== from);
        if (files.length === 1) return { scope: '', spec: mod, files };
        if (files.length > 1) return null;
      }
      return null;
    });
  }

  /**
   * True when a scanned import names a namespace declared in the repo (C#
   * `using X;`): it maps to no single file (its file-level dependencies come
   * from implicitImports).
   */
  function isLocalNamespace(fromFile, imp, language) {
    if (language !== 'csharp' || (imp.kind !== 'cs-namespace' && imp.kind !== 'cs-global')) return false;
    try { return csIndex().namespaces.has(imp.spec); } catch { return false; }
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
    if (!imp || !imp.spec) return null;
    // A C# namespace using never names one file (see implicitImports).
    if (imp.kind === 'cs-namespace' || imp.kind === 'cs-global') return null;
    const from = norm(String(fromFile));
    if (from == null) return null;
    // Results that exclude the importing file itself (index lookups) or
    // depend on its own module file must not be shared across a directory.
    const scope = FILE_SCOPED_MEMO_LANGUAGES.has(language) ? from : dirOf(from);
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
        case 'scss': case 'sass': case 'less': case 'css': return resolveStyle(from, imp);
        case 'csharp': return resolveCsharp(from, imp);
        case 'swift': return resolveSwift(from, imp.spec);
        case 'elixir': return resolveElixirModule(from, imp.spec);
        case 'lua': return resolveLua(from, imp.spec);
        case 'zig': return resolveZig(from, imp.spec);
        case 'haskell': return resolveHaskell(from, imp.spec);
        case 'clojure': return resolveClojure(from, imp.spec);
        case 'solidity': return resolveSolidity(from, imp.spec);
        case 'shell': return resolveShell(from, imp);
        case 'proto': return resolveProto(from, imp.spec);
        case 'hcl': return resolveTerraform(from, imp.spec);
        case 'julia': return relativeFile(from, imp.spec);
        case 'elm': return resolveElm(from, imp.spec);
        case 'perl': return resolvePerl(from, imp);
        case 'r': return relativeFile(from, imp.spec) || firstFile([norm(imp.spec)]);
        case 'powershell': return relativeFile(from, imp.spec);
        case 'erlang': return resolveErlang(from, imp);
        case 'crystal': return resolveCrystal(from, imp.spec);
        default: return null;
      }
    } catch {
      return null;
    }
  }

  return { resolve, implicitImports, isLocalNamespace, hasFile, goPackageDir, rustPathScope, root };
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
  // A maintained graph keeps retired rows until GC (epoch_retired set) and
  // writes rows under the physical id of the file's entity row (`<id>@e<N>`);
  // a full build writes them under the logical id with no entity row.
  const relCols = new Set(db.prepare('PRAGMA table_info(relationships)').all().map((c) => c.name));
  const entCols = new Set(db.prepare('PRAGMA table_info(entities)').all().map((c) => c.name));
  const liveRel = relCols.has('epoch_retired') ? ' AND epoch_retired IS NULL' : '';
  const liveEnt = entCols.has('epoch_retired') ? ' AND epoch_retired IS NULL' : '';
  const rows = db.prepare(`SELECT source_id, target_name FROM relationships WHERE type = 'importsFile'${liveRel}`).all();
  const idToFile = new Map();
  const paths = new Set(db.prepare('SELECT DISTINCT file_path FROM entities').pluck().all());
  for (const r of rows) paths.add(r.target_name);
  for (const p of paths) if (p) idToFile.set(fileIdOf(p), p);
  for (const e of db.prepare(`SELECT id, file_path FROM entities WHERE type = 'file'${liveEnt}`).all()) {
    if (e.file_path) idToFile.set(e.id, e.file_path);
  }
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
