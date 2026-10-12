#!/usr/bin/env node
// Fixtures for src/classes.rs + src/enrich.rs (tests/enrich.rs).
//
// Runs the REAL JS functions on corpus inputs against each bench repo's code graph, opened
// READ-ONLY through the real CodeGraphRepository whose methods are wrapped to RECORD every call
// (arguments -> answer, in call order). File reads the functions make are recorded too. The
// Rust tests replay the recordings through fake CodeGraph / SourceText impls and assert the
// same outputs byte for byte and the same graph-call sequence.
//
// Usage: node fixtures-gen/enrich.mjs <js-root> <corpus-dir> <repos-dir> <out-dir>
// Never writes outside <out-dir> (and a temp dir for synthetic files under it, removed).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [JS_ROOT, CORPUS, REPOS, OUT] = process.argv.slice(2);
if (!JS_ROOT || !CORPUS || !REPOS || !OUT) {
  console.error('usage: enrich.mjs <js-root> <corpus-dir> <repos-dir> <out-dir>');
  process.exit(2);
}
const imp = (rel) => import(path.join(JS_ROOT, rel));
const glc = await imp('core/search/grep-line-classes.js');
const apc = await imp('core/search/agent-pack-completion.js');
const sr = await imp('core/search/search-read.js');
const qs = await imp('core/search/query-sufficiency.js');
const { readFileRange } = await imp('core/search/search-pattern-chunks.js');
const { indexFreshness } = await imp('core/search/index-freshness.js');
const { compilePathGlobs } = await imp('core/search/grep-path-globs.js');
const { isTestLikePath } = await imp('core/infrastructure/test-paths.js');
const { isTestPath } = await imp('core/graph/relationship-resolver.js');
const { CodeGraphRepository } = await imp('core/infrastructure/code-graph-repository.js');
const require = createRequire(path.join(JS_ROOT, 'package.json'));
const Database = require('better-sqlite3');

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------------------------
const TRAIT_METHODS = [
  'findEntitiesInFile', 'findEntitiesInRange', 'findEnclosingEntity', 'findEntitiesAtLines',
  'findEntitiesForRanges', 'findFamilyCandidates', 'findInterfaceCallImplementationsInRanges',
];
let LOG = null; // current case's graph-call log
let depth = 0;
for (const m of TRAIT_METHODS) {
  const orig = CodeGraphRepository.prototype[m];
  CodeGraphRepository.prototype[m] = function (...args) {
    if (depth > 0 || !LOG) return orig.apply(this, args);
    depth++;
    try {
      const result = orig.apply(this, args);
      LOG.push([m, JSON.parse(JSON.stringify(args)), JSON.parse(JSON.stringify(pack(m, result) ?? null))]);
      return result;
    } catch (err) {
      LOG.push([m, JSON.parse(JSON.stringify(args)), { throw: String(err?.message || err) }]);
      throw err;
    } finally {
      depth--;
    }
  };
}

// Entity objects -> compact arrays [id, name, type, startLine, endLine, parentClass(, filePath)].
const packEntity = (e) => {
  if (!e) return e;
  const a = [e.id ?? null, e.name ?? null, e.type ?? null, e.startLine ?? null, e.endLine ?? null, e.parentClass ?? null];
  if ('filePath' in e) a.push(e.filePath ?? null);
  return a;
};
function pack(method, r) {
  if (r == null) return r;
  switch (method) {
    case 'findEntitiesInFile': case 'findEntitiesInRange': case 'findFamilyCandidates':
      return r.map(packEntity);
    case 'findEnclosingEntity':
      return packEntity(r);
    case 'findEntitiesAtLines': case 'findEntitiesForRanges':
      return r.map((x) => ({ enclosing: packEntity(x.enclosing), inRange: x.inRange.map(packEntity) }));
    default:
      return r; // interface rows: plain objects
  }
}

const lines = (t) => t.split('\n');
const truncateCp = (s, n) => { const a = Array.from(s); return a.length > n ? a.slice(0, n).join('') : s; };

// Sibling-line file read, minimized exactly: a line can matter only when it lies in an
// enclosing span, is an entity's start line, or holds a state entity's name (assignment scan).
const STATE = new Set(['field', 'property', 'variable', 'constant', 'const', 'static', 'enum_constant']);
function siblingReadText(text, log) {
  if (typeof text !== 'string' || text === '') return text;
  const encl = log.filter(([m]) => m === 'findEnclosingEntity').map(([, , r]) => r).filter(Boolean);
  const ents = log.find(([m, a]) => m === 'findEntitiesInFile' && a.length === 1)?.[2] || [];
  const keep = new Set();
  for (const e of encl) if (Number.isInteger(e[3]) && Number.isInteger(e[4])) for (let l = e[3]; l <= e[4] && l - e[3] < 100000; l++) keep.add(l);
  for (const e of ents) if (Number.isInteger(e[3])) keep.add(e[3]);
  const stateNames = ents.filter((e) => STATE.has(String(e[2] || '').toLowerCase()) && e[1]).map((e) => e[1]);
  const out = lines(text).map((ln, i) => (keep.has(i + 1) || stateNames.some((n) => ln.includes(n)) ? ln : ''));
  const joined = out.join('\n');
  return joined === '' ? text : joined;
}

// Implementation-code reads (interface trailer), minimized to the lines read.
function implReads(root, log) {
  const need = new Map();
  for (const [m, , r] of log) {
    if (m !== 'findInterfaceCallImplementationsInRanges' || !Array.isArray(r)) continue;
    for (const rows of r) for (const row of rows || []) for (const i of row.impls || []) {
      if (!i.filePath || !(i.startLine > 0) || !(i.endLine >= i.startLine) || i.endLine - i.startLine > 12) continue;
      if (!need.has(i.filePath)) need.set(i.filePath, new Set());
      for (let l = i.startLine; l <= i.endLine; l++) need.get(i.filePath).add(l);
    }
  }
  const reads = {};
  for (const [file, ls] of need) {
    let text = null;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { text = null; }
    reads[file] = text == null ? null : lines(text).map((ln, i) => (ls.has(i + 1) ? ln : '')).join('\n');
  }
  return reads;
}

// The JS reference for writeGrepInterfaceHint (eval/agent-read-workflows/bin/_ss-helpers.mjs,
// copied verbatim but returning the bytes instead of writing them; that file is a CLI entry).
const GREP_IMPL_HINT_MAX_MATCHES = 8;
const GREP_IMPL_HINT_LINES_AFTER = 3;
const GREP_IMPL_HINT_MAX_LINES = 3;
function writeGrepInterfaceHint(PROJECT_ROOT, total, rows) {
  if (!(total > 0 && total <= GREP_IMPL_HINT_MAX_MATCHES)) return null;
  const byFile = new Map();
  for (const r of rows) {
    if (!byFile.has(r.file)) byFile.set(r.file, []);
    byFile.get(r.file).push(r);
  }
  const callsOf = new Map();
  for (const [file, hits] of byFile) {
    const found = sr.interfaceCallsInRanges(PROJECT_ROOT, file, hits.map(r => ({ startLine: r.line, endLine: r.line + GREP_IMPL_HINT_LINES_AFTER })));
    hits.forEach((r, i) => callsOf.set(r, found[i]));
  }
  const calls = [];
  const seen = new Set();
  for (const r of rows) {
    for (const c of callsOf.get(r)) {
      if (seen.has(c.target)) continue;
      seen.add(c.target);
      calls.push(c);
    }
  }
  const hint = sr.renderInterfaceImpls({ interfaceCalls: calls.slice(0, GREP_IMPL_HINT_MAX_LINES) });
  return hint ? `${hint}\n` : null;
}

// The JS reference for bareGrep's enrichment block (core/search/search-pattern.js, copied).
function bareGrepEnrich(results, regex, options, repo, searchDir, manifest, pathGlobs) {
  const GREP_LINE_CLASS_ENTITY_CAP = 2048;
  const fileSummary = options.perFileCap > 0;
  let lineClassStats = null;
  if (options._isAgentFormat === true && options.grepLineClasses === true && fileSummary
      && typeof repo?.findEntitiesInFile === 'function') {
    const bare = String(regex).replace(/^\\b\(\?:(.*)\)\\b$/, '$1');
    const definedName = /^(?:\\b)?([A-Za-z_$][\w$]*)(?:\\b|\\\(|\\s\*\\\()?$/.exec(bare)?.[1] || null;
    lineClassStats = glc.stampGrepLineClasses(results, {
      definedName,
      entitiesInFile: (file) => {
        const entities = repo.findEntitiesInFile(file, { limit: GREP_LINE_CLASS_ENTITY_CAP }) || [];
        return entities.length >= GREP_LINE_CLASS_ENTITY_CAP ? [] : entities;
      },
      isFresh: (file) => {
        const f = indexFreshness(path.resolve(searchDir, file), manifest);
        return f.known && !f.stale;
      },
    });
  }
  const unscopedShape = !options.fileFilter || options._cwdScope === true;
  const familyManifest = options._isAgentFormat === true && unscopedShape
    ? apc.buildIndexedGrepFamilyManifest(results, repo,
      pathGlobs ? { keepFile: (file) => typeof file === 'string' && pathGlobs.matches(file) } : undefined)
    : null;
  const siblingLine = options._isAgentFormat === true && unscopedShape
      && options._siblingLine !== false
      && results.length >= 1 && results.length <= 3
      && results.every((result) => result.file === results[0].file)
    ? apc.buildSingletonSiblingLine(results, repo, { regex, projectRoot: searchDir })
    : null;
  return { lineClassStats, familyManifest, siblingLine };
}

const wf = (_k, v) => (typeof v === 'string' ? v.toWellFormed() : v);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// Deterministic sampling (seeded LCG).
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
function sample(arr, n, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

const statOf = (abs) => {
  try {
    const b = fs.statSync(abs, { bigint: true });
    return [Number(b.mtimeNs / 1000000000n), Number(b.mtimeNs % 1000000000n), fs.statSync(abs).mtimeMs];
  } catch { return null; }
};

// ---------------------------------------------------------------------------------------------
// Per repo
// ---------------------------------------------------------------------------------------------
const REPO_NAMES = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.bare.jsonl')).map((f) => f.replace('.bare.jsonl', '')).sort();
const helperPaths = new Set();
const helperRegexes = new Set();
const helperContents = new Set();
const accessorCodes = [];
let totalCases = 0;

for (const repoName of REPO_NAMES) {
  const root = path.join(REPOS, repoName);
  const dbPath = path.join(root, '.sweet-search', 'code-graph.db');
  if (!fs.existsSync(dbPath)) { console.error(`skip ${repoName}: no code graph`); continue; }
  const repo = new CodeGraphRepository(dbPath);
  let manifestText = null;
  try { manifestText = fs.readFileSync(path.join(root, '.sweet-search', 'reconcile-manifest.json'), 'utf8'); } catch { /* none */ }
  let manifest = null;
  try { manifest = JSON.parse(manifestText); if (!Number.isInteger(manifest?.epoch)) manifest = null; } catch { manifest = null; }
  const r = rng(42 + repoName.length * 7919 + repoName.charCodeAt(0));
  const bare = readJsonl(path.join(CORPUS, `${repoName}.bare.jsonl`));
  for (const b of bare) {
    helperRegexes.add(String(b.options?.regex ?? b.query ?? ''));
    for (const row of b.result.results || []) { helperPaths.add(row.file); if (helperContents.size < 4000) helperContents.add(row.content ?? ''); }
  }
  const cases = [];
  const stats = {};

  const freshAnswers = {};
  const freshFn = (file) => {
    const abs = path.resolve(root, file);
    const f = indexFreshness(abs, manifest);
    const st = statOf(abs);
    freshAnswers[file] = { fresh: f.known && !f.stale, known: f.known, stale: f.stale, stat: st };
    return f.known && !f.stale;
  };

  // --- bare cases: the bareGrep block on corpus calls (reduced row sets), with their gates.
  const withRows = bare.filter((b) => (b.result.results || []).length > 0);
  const special = withRows.filter((b) => b.result.familyManifest || b.result.siblingLine);
  const bareSample = [...special, ...sample(withRows.filter((b) => !special.includes(b)), 22, r)];
  let corpusAgree = 0; let corpusDiffer = 0;
  const bareCases = [];
  for (const b0 of bareSample) {
    // bareGrep's outside-probe branch re-runs itself unscoped (the recorded options are the
    // outer call's): mirror that so the gates see the options the enrichment ran under.
    let b = b0;
    if (b0.options.grepOutsideProbe > 0) {
      const { grepOutsideProbe: _p, grepOutsideScopedTotal: _t, fileFilter: _f, ...unscoped } = b0.options;
      b = { ...b0, options: unscoped };
    }
    const regex = String(b.options.regex ?? b.query);
    if (b.result.familyManifest || b.result.siblingLine) {
      // Sanity: the full corpus rows, unrecorded, against what the corpus run printed.
      const full = b.result.results.map((x) => ({ file: x.file, line: x.line, content: x.content, text: x.content }));
      const o = bareGrepEnrich(full, regex, { ...b.options, grepLineClasses: false }, repo, root, manifest, compilePathGlobs(b.options.pathGlobs));
      const same = (o.familyManifest?.rendered ?? null) === (b.result.familyManifest?.rendered ?? null)
        && (o.siblingLine?.rendered ?? null) === (b.result.siblingLine?.rendered ?? null);
      if (same) corpusAgree++; else { corpusDiffer++; console.error(`  corpus differs: ${repoName} call ${b.call}: ${JSON.stringify([b.result.familyManifest?.rendered, o.familyManifest?.rendered, b.result.siblingLine?.rendered, o.siblingLine?.rendered]).slice(0, 600)}`); }
    }
    // Reduce: first 8 files, 12 rows each, content <= 400 code points.
    const perFile = new Map();
    const rows = [];
    for (const row of b.result.results) {
      if (!perFile.has(row.file)) { if (perFile.size >= 8) continue; perFile.set(row.file, 0); }
      if (perFile.get(row.file) >= 12) continue;
      perFile.set(row.file, perFile.get(row.file) + 1);
      rows.push({ file: row.file, line: row.line, content: truncateCp(row.content ?? '', 400) });
    }
    const pathGlobs = compilePathGlobs(b.options.pathGlobs);
    const keepAnswers = {};
    const pg = pathGlobs ? { matches: (f) => { const v = pathGlobs.matches(f); keepAnswers[f] = v; return v; } } : null;
    LOG = [];
    for (const k of Object.keys(freshAnswers)) delete freshAnswers[k];
    const origFresh = indexFreshness;
    const results = rows.map((x) => ({ ...x, text: x.content }));
    // isFresh inside bareGrepEnrich uses indexFreshness directly; record via a wrapper.
    const out = bareGrepEnrich(results, regex, b.options, repo, root, manifest, pg);
    void origFresh;
    const log = LOG; LOG = null;
    // Freshness answers for every file (the Rust fake answers from this table).
    const fresh = {};
    for (const f of new Set(rows.map((x) => x.file))) { freshFn(f); fresh[f] = freshAnswers[f]; }
    const reads = {};
    if (out.siblingLine || log.some(([m, a, res]) => m === 'findEntitiesInFile' && a.length === 1 && Array.isArray(res) && res.length > 0)) {
      const f = rows[0].file;
      reads[f] = siblingReadText(readFileRange(new Map(), f, 1, 1_000_000, root), log);
    }
    bareCases.push({ special: !!(b.result.familyManifest || b.result.siblingLine), c: {
      kind: 'bare', call: b.call, regex,
      opts: {
        isAgentFormat: b.options._isAgentFormat === true,
        grepLineClasses: b.options.grepLineClasses === true,
        hasFileSummary: b.options.perFileCap > 0,
        hasFileFilter: !!b.options.fileFilter,
        cwdScope: b.options._cwdScope === true,
        siblingLineOff: b.options._siblingLine === false,
        keepFile: pathGlobs ? keepAnswers : null,
      },
      rows: rows.map((x) => [x.file, x.line, x.content]),
      fresh: Object.fromEntries(Object.entries(fresh).map(([k, v]) => [k, v.fresh])),
      graph: log, reads,
      expect: {
        rows: results.map((x) => [x.lineClass ?? null, x.lineSymbol ?? null, x.defines === true]),
        stats: out.lineClassStats,
        familyManifest: out.familyManifest ? { ...out.familyManifest, members: out.familyManifest.members.map(packEntity) } : null,
        siblingLine: out.siblingLine,
      },
    } });
    stats.freshness ??= [];
    for (const [f, v] of Object.entries(fresh)) if (stats.freshness.length < 12 && v.stat) stats.freshness.push([f, v.stat[0], v.stat[1], String(v.stat[2]), v.known, v.stale]);
  }

  // Size budget: specials first, then smallest; at most ~70KB of bare cases per repo.
  {
    const sized = bareCases.map((x) => ({ ...x, size: JSON.stringify(x.c).length }));
    sized.sort((a, b) => (b.special - a.special) || (a.size - b.size));
    let used = 0;
    for (const x of sized) {
      if (x.size > 25000 || used + x.size > 70000) continue;
      used += x.size;
      cases.push(x.c);
    }
  }

  // --- family cases (ungated): corpus result sets + digit-name families from the graph.
  const famInputs = sample(withRows, 14, r).map((b) => b.result.results.slice(0, 40).map((x) => [x.file, x.line]));
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rowsDigit = db.prepare(`SELECT name, file_path, start_line FROM entities
      WHERE name GLOB '*[A-Za-z][A-Za-z][A-Za-z]*' AND name GLOB '*[0-9]*' AND stale_since IS NULL AND epoch_retired IS NULL
      AND start_line IS NOT NULL LIMIT 20000`).all();
    const groups = new Map();
    for (const e of rowsDigit) {
      const key = `${path.posix.dirname(e.file_path)}\0${e.name.replace(/\d+/g, '#')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const good = [...groups.values()].filter((g) => g.length >= 2 && g.length <= 12);
    for (const g of sample(good, 6, r)) famInputs.push(g.slice(0, 6).map((e) => [e.file_path, e.start_line]));
    // Interface call sites (synthetic hint inputs).
    const iface = db.prepare(`SELECT s.file_path AS file, r.context_line AS line FROM relationships r
      JOIN entities s ON s.id = r.source_id JOIN entities t ON t.id = r.target_id
      LEFT JOIN entities p ON p.id = t.parent_id
      WHERE r.type = 'calls' AND r.context_line IS NOT NULL AND (p.type IN ('interface','protocol','trait')
        OR EXISTS (SELECT 1 FROM relationships o WHERE o.type = 'overrides' AND o.source_id = t.id))
      LIMIT 3000`).all();
    stats.ifaceSites = iface.length;
    var ifaceSample = sample(iface, 10, r);
    db.close();
  } catch (err) {
    console.error(`${repoName}: sql sampling failed: ${err.message}`);
    var ifaceSample = [];
  }
  for (const hits of famInputs) {
    LOG = [];
    const res = apc.buildIndexedGrepFamilyManifest(hits.map(([file, line]) => ({ file, line })), repo);
    const log = LOG; LOG = null;
    cases.push({ kind: 'family', hits, graph: log, expect: res ? { ...res, members: res.members.map(packEntity) } : null });
  }

  // --- sibling cases (ungated): 1-3 rows of one file from corpus calls.
  for (const b of sample(withRows, 12, r)) {
    const file = b.result.results[0].file;
    const n = 1 + Math.floor(r() * 3);
    const hits = b.result.results.filter((x) => x.file === file).slice(0, n).map((x) => [x.file, x.line]);
    const regex = String(b.options.regex ?? b.query);
    LOG = [];
    const res = apc.buildSingletonSiblingLine(hits.map(([f, l]) => ({ file: f, line: l })), repo, { regex, projectRoot: root });
    const log = LOG; LOG = null;
    const reads = {};
    if (log.some(([m, a, x]) => m === 'findEntitiesInFile' && a.length === 1 && Array.isArray(x) && x.length > 0)) {
      reads[file] = siblingReadText(readFileRange(new Map(), file, 1, 1_000_000, root), log);
    }
    const before = Math.floor(r() * 3); const after = Math.floor(r() * 3);
    const printed = hits.map(([, l]) => l);
    cases.push({ kind: 'sibling', hits, regex, graph: log, reads, expect: res,
      grep: { rows: printed, before, after, expect: null } });
    // grepSiblingLine reference (_ss-helpers.mjs, copied).
    const gsl = (siblingLine, rows, { before: bf = 0, after: af = 0 } = {}) => {
      if (!siblingLine?.rendered) return null;
      if (!Array.isArray(siblingLine.sites)) return siblingLine.rendered;
      const shown = (line) => rows.some((x) => line >= x.line - bf && line <= x.line + af);
      const kept = siblingLine.sites.filter((site) => !shown(site.line));
      if (kept.length === 0) return null;
      return `# siblings: ${kept.map((site) => `${site.line}: ${site.text}`).join(' · ')}`;
    };
    cases.at(-1).grep.expect = gsl(res, printed.map((line) => ({ line })), { before, after });
  }

  // --- interface-hint cases: corpus calls (first <= 8 rows, real total) + call sites.
  const hintInputs = sample(withRows, 10, r).map((b) => ({ total: b.result.stats?.totalMatches ?? b.result.results.length, rows: b.result.results.slice(0, 8).map((x) => [x.file, x.line]) }));
  for (const s of ifaceSample) hintInputs.push({ total: 1 + Math.floor(r() * 8), rows: [[s.file, Math.max(1, s.line - Math.floor(r() * 3))]] });
  // Several call sites of one file in one grep.
  if (ifaceSample.length >= 3) hintInputs.push({ total: 3, rows: ifaceSample.slice(0, 3).map((s) => [s.file, s.line]) });
  for (const h of hintInputs) {
    LOG = [];
    const out = writeGrepInterfaceHint(root, h.total, h.rows.map(([file, line]) => ({ file, line })));
    const log = LOG; LOG = null;
    const reads = implReads(root, log);
    for (const [f, t] of Object.entries(reads)) if (t != null && accessorCodes.length < 300) {
      // Accessor-check inputs straight from real implementations.
      for (const [m, , res] of log) if (m === 'findInterfaceCallImplementationsInRanges') for (const rows of res) for (const row of rows) for (const i of row.impls) {
        if (i.filePath === f && i.startLine > 0 && i.endLine >= i.startLine && i.endLine - i.startLine <= 12) {
          accessorCodes.push([lines(t).slice(i.startLine - 1, i.endLine).join('\n'), i.name]);
        }
      }
    }
    cases.push({ kind: 'hint', total: h.total, rows: h.rows, graph: log, reads, expect: out });
  }

  for (let i = cases.length - 1; i >= 0; i--) if (cases[i].kind !== 'bare' && JSON.stringify(cases[i]).length > 20000) cases.splice(i, 1);
  const outFile = path.join(OUT, `${repoName}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ repo: repoName, manifest: manifestText, freshness: stats.freshness || [], cases }, wf));
  totalCases += cases.length;
  const counts = {};
  for (const c of cases) counts[c.kind] = (counts[c.kind] || 0) + 1;
  const nonNull = cases.filter((c) => c.expect && (c.kind !== 'bare' || c.expect.familyManifest || c.expect.siblingLine || c.expect.stats?.stamped)).length;
  console.log(`${repoName}: ${JSON.stringify(counts)} nonNull=${nonNull} corpusAgree=${corpusAgree} corpusDiffer=${corpusDiffer} iface=${stats.ifaceSites} ${(fs.statSync(outFile).size / 1024).toFixed(0)}KB`);
  repo.close();
}

// ---------------------------------------------------------------------------------------------
// Helpers + synthetic edge cases
// ---------------------------------------------------------------------------------------------
const SYN_PATHS = [
  '', 'a.go', 'pkg/foo_test.go', 'src/Test/x.c', 'tests/a.py', 'TESTS/A.PY', 'lib/spec/x.rb', 'x_spec.rb', 'a/b/FooTest.java',
  'a/b/FooTests.swift', 'a/b/contests.go', 'latest.ts', 'greatest.py', 'foo.test.ts', 'foo.Spec.JSX', 'conftest.py', 'a/conftest.py',
  'test_foo.py', 'a/test_x.rb', 'unit/x.go', 'unit_tests/x.go', 'acceptance-test/y.cs', 'integration/z.java', 'e2e/q.ts',
  'functional/k.java', 'functionaltests/k.java', 'a\\tests\\b.go', 'Mocks/m.go', 'mock/m.go', '__tests__/a.js', '__mocks__/b.js',
  'testdata/x.json', 'test_data/y', 'fixture/z', 'fixtures/z', 'testing/t.go', 'specs/s.rb', 'FooSpec.scala', 'fooSpec.scala',
  'FooSpecs.kt', 'aTests.m', 'ATests.php', 'x/Tests.cs', 'x/Specs.cs', 'ſpec/x.go', 'tK/teſt.go', 'test', 'tests', 'a/tests',
  'café/tests/é.go', 'x.TEST.ts', 'y_TEST.go', 'z_test.', 'q_test.go/', 'integration-tests/a', 'unittest/a', 'acceptancetests/a',
];
const SYN_REGEXES = [
  '', 'safeParse', '\\bsafeParse\\b', 'safeParse\\(', 'safeParse\\s*\\(', '\\b(?:safeParse)\\b', '\\b(?:a|b)\\b', '$foo', '_x9',
  '9abc', 'foo\\b\\(', 'foo bar', '\\b(?:foo\nbar)\\b', '\\bfoo', 'foo\\b', '\\b\\bfoo', 'fooé', '\\b(?:)\\b', 'def name', 'function\\s+(\\w+)',
  'return null|x', 'a\\.b\\(c', '\\s+x\\S', '(?i)HTTPServer', 'foo|bar baz|qux', 'abc\\', '--opt-name', '::Foo::Bar', 'a\u0000bcd',
  '[A-Z]\\w+Client', 'get_\\w+_by_id', '\\$this->getType\\(\\)', 'IVec2|IVec3', 'snake_case_name', 'x\u00a0yzz', 'éclair_ünïcode',
];
const SYN_TEXTS = [
  '', 'a', 'HTTPServer', 'parseHTTPResponseCode', 'IVec2', 'I64Vec3', 'getUserByID', 'foo_bar_baz', 'ABCdef', '123abc', 'abc123def',
  'XMLHttpRequest2', 'the and for', 'Σίσυφος', 'naïveCafé', 'x😀yHello', 'snake__case', '$jquery', 'A1B2C3', 'DBConfig', 'getX', 'URLs',
  'avx512MaskedLoadSliceTemplate', 'TestMappingCollectionFormat', 'ss_find_v2_ANSWER', 'aBC', 'AbC', 'ABC', 'abC9xyz',
];
const ACCESSOR_SYN = [
  ['public function getType() { return $this->type; }', 'getType'],
  ['public function getType() { return $this->aliasOf->getType(); }', 'getType'],
  ['public function getType() { return $this->compute(); }', 'getType'],
  ['get() = field', 'get'],
  ['fun name(): String = other.name()', 'name'],
  ['fn len(&self) -> usize { self.0.len() }', 'len'],
  ['def value(self):\n    return self._value', 'value'],
  ['def value(self):\n    # just a comment\n    return self._value', 'value'],
  ['def value(self): return compute(self)', 'value'],
  ['func (s *S) Get() int { return s.v /* cached */ }', 'Get'],
  ['func (s *S) Get() int { // see http://x.y/z\n return s.v }', 'Get'],
  ['x => x.y', 'x'],
  ['(a) => fetch(a)', 'f'],
  ['Foo(): Bar = baz()', 'Foo'],
  ['Foo() : Map<K,V> = m', 'Foo'],
  ['Foo() == bar', 'Foo'],
  ['', 'x'],
  ['oneline', 'x'],
  ['{}', 'x'],
  ['{ return(foo()); }', 'foo'],
  ['{ $return(x) }', 'x'],
  ['{ panic!("no"); }', 'panic'],
  ['{ a(); /* b() */ }', 'a'],
  ['{ ' + 'x'.repeat(61) + ' }', 'x'],
  ['{ ' + 'é'.repeat(61) + ' }', 'x'],
  ['\n  # comment only\n  ', 'x'],
  ['def f():\n\n   \n  # c\n  return 1', 'f'],
  ['{ url = "http://a"; }', 'x'],
  ['{ a:// x\n b() }', 'b'],
  ['{ x = y; //c\r\n z() }', 'z'],
];
const NAME_ON_LINE = [
  ['foo', 'foo'], ['foo', 'foobar foo'], ['foo', 'barfoo'], ['foo', 'foo_bar'], ['foo', 'é foo é'], ['foo', '😀foo😀'], ['', 'x'], ['x', ''],
  ['Ünï', 'Ünï()'], ['Ünï', 'aÜnï'], ['a', 'a'], ['$x', '$x$'], ['x', 'x$'],
];
const COMMENT_LINES = ['', '   ', '// x', '  /* y', '\t* z', '#', '# x', '#\tx', '#include', '#[derive]', '#!', '/x', '  -- sql', 'é// x', ' \t //'];
const SHORT_NAMES = ['', 'a', 'a.b', 'a::b', 'a->b', 'a#b', 'a:::b', 'a::', '::', '.a.', 'Oracle.hasConflict', 'x->y::z#w.v', 'a:b', 'é.ü', '->'];
const DATES = ['', '2026-10-12T10:07:20.681Z', '2026-10-12T10:07:20Z', '2024-02-29T00:00:00.000Z', '1969-12-31T23:59:59.999Z',
  '2026-10-12T10:07:20.681+02:00', '2026-10-12T10:07:20.681-05:30', '0001-01-01T00:00:00.000Z'];
const CONTAINS = [
  ['getUserByID', 'User', true], ['getUserByID', 'user', false], ['get_user', 'user', false], ['user', 'user', true], ['xuser', 'user', true],
  ['a.user.b', 'user', true], ['$user', 'user', true], ['ÉCLAIR', 'éclair', false], ['', 'x', true], ['abc', '', true], ['ab', 'abc', true],
];
const FAMILY_SYN = [
  { candidates: ['IVec2', 'IVec3', 'IVec4', 'UVec2', 'UVec3', 'I64Vec2', 'I64Vec3', 'Vec2', 'Vec3'].map((n, i) => ({ id: `i${i}`, name: n, type: 'struct', filePath: `src/v/${n}.rs`, startLine: i + 1, endLine: i + 2, parentClass: null })), seedNames: ['IVec2'] },
  { candidates: ['handler_01', 'handler_1', 'handler_010', 'handler_10', 'handler_2'].map((n, i) => ({ id: `h${i}`, name: n, type: 'function', startLine: i, endLine: i })), seedNames: [] },
  { candidates: ['avx2MaskedTemplate', 'avx512MaskedTemplate', 'avx2MaskedLoadSliceTemplate', 'avx512MaskedLoadSliceTemplate', 'sse4Masked'].map((n, i) => ({ id: `a${i}`, name: n, type: 'variable', startLine: i, endLine: i })), seedNames: ['avx2MaskedTemplate'] },
  { candidates: ['Foo1Bar', 'Foo2Bar', 'foo1Bar', 'foo2Bar', '_Foo1Bar', '_Foo2Bar', 'Foo-1Bar', 'Foo-2Bar', 'Foo.1Bar', 'Foo.2Bar'].map((n, i) => ({ id: `f${i}`, name: n, type: 'class', startLine: i, endLine: i })), seedNames: [] },
  { candidates: [{ name: 'x1' }, { name: 'x2' }, { name: 'abc1' }, { name: null }, { name: 'abcd' }, { name: 'abcd1' }, { name: 'abcd2' }, { name: 'abcd2' }], seedNames: ['zzz9'] },
  { candidates: ['Width8Thing', 'Width16Thing', 'Width8Other', 'Width16Other', 'W99999999999999999999999Thing1', 'W99999999999999999999999Thing2'].map((n) => ({ name: n, type: 'struct' })), seedNames: [] },
  { candidates: [{ name: 'one1' }], seedNames: [] },
];

// Synthetic sibling-line inputs: a fake repo (recorded like the real one) over temp files.
const SYN_ROOT = path.join(OUT, '.syn-tmp');
fs.rmSync(SYN_ROOT, { recursive: true, force: true });
fs.mkdirSync(SYN_ROOT, { recursive: true });
const SYN_FILES = {
  'a/svc.js': [
    'class Service {',                       // 1
    '  constructor() {',                     // 2
    '    this.userCache = new Map();',       // 3
    '    this.userCount = 0;',               // 4
    '  }',                                   // 5
    '  loadUserCache(id) {',                 // 6
    '    return this.userCache.get(id);',    // 7
    '  }',                                   // 8
    '  saveUserCache(id, v) {',              // 9
    '    this.userCache.set(id, v); if (this.userCount == 0) {}', // 10
    '  }',                                   // 11
    '  reset() { this.userCount = 1; }',     // 12
    '  ' + 'x'.repeat(120) + ' longLine() { return "ünïcödé😀" }', // 13
    '}',                                     // 14
  ].join('\r\n'),
  'b/model.py': [
    'class Model:',                          // 1
    '    total_count = 0',                   // 2
    '',                                      // 3
    '    def add_total(self, n):',           // 4
    '        self.total_count += n',         // 5
    '        return self.total_count',       // 6
    '',                                      // 7
    '    def get_total(self):',              // 8
    '        return self.total_count',       // 9
    '',                                      // 10
    'def reset_total(m):',                   // 11
    '    m.total_count=0',                   // 12
    '    @total_count = 5',                  // 13
    '\u00a0\t',                              // 14
    '    café_total = "x" * 200 + "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀"', // 15
  ].join('\n') + '\n',
};
for (const [f, t] of Object.entries(SYN_FILES)) { fs.mkdirSync(path.dirname(path.join(SYN_ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(SYN_ROOT, f), t); }
const E = (id, name, type, s, e) => ({ id, name, type, startLine: s, endLine: e, parentClass: null });
const SYN_ENTS = {
  'a/svc.js': [E('c', 'Service', 'class', 1, 14), E('k', 'constructor', 'constructor', 2, 5), E('uc', 'userCache', 'property', 3, 3), E('un', 'userCount', 'field', 4, 4),
    E('l', 'loadUserCache', 'method', 6, 8), E('s', 'saveUserCache', 'method', 9, 11), E('r', 'reset', 'method', 12, 12), E('ll', 'longLine', 'method', 13, 13)],
  'b/model.py': [E('m', 'Model', 'class', 1, 9), E('tc', 'total_count', 'variable', 2, 2), E('at', 'add_total', 'method', 4, 6), E('gt', 'get_total', 'method', 8, 9),
    E('rt', 'reset_total', 'function', 11, 13), E('ct', 'café_total', 'Variable', 15, 15), E(null, 'Anon', 'symbol', 14, 14)],
};
const fakeRepo = {
  findEnclosingEntity(file, s, e) {
    const ents = (SYN_ENTS[file] || []).filter((x) => x.startLine <= s && x.endLine >= e);
    ents.sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine));
    return ents[0] || null;
  },
  findEntitiesInFile(file) { return (SYN_ENTS[file] || []).map((x) => ({ ...x })); },
};
const recRepo = {};
for (const m of Object.keys(fakeRepo)) recRepo[m] = (...args) => { const res = fakeRepo[m](...args); LOG?.push([m, JSON.parse(JSON.stringify(args)), pack(m, res)]); return res; };
const SYN_SIBLING = [
  { hits: [['a/svc.js', 7]], regex: 'userCache' },
  { hits: [['a/svc.js', 7], ['a/svc.js', 10]], regex: 'userCache\\.\\w+' },
  { hits: [['a/svc.js', 12]], regex: 'reset' },
  { hits: [['a/svc.js', 13]], regex: 'longLine' },
  { hits: [['b/model.py', 5]], regex: 'total_count' },
  { hits: [['b/model.py', 9], ['b/model.py', 5], ['b/model.py', 12]], regex: 'self\\.total' },
  { hits: [['b/model.py', 12]], regex: '' },
  { hits: [['b/model.py', 15]], regex: 'café' },
  { hits: [['b/model.py', 5], ['a/svc.js', 3]], regex: 'x' },
  { hits: [], regex: 'x' },
  { hits: [['nope.go', 1]], regex: 'x' },
];
const synSibling = [];
for (const s of SYN_SIBLING) {
  LOG = [];
  let res; let err = null;
  try { res = apc.buildSameFileSiblingLine(s.hits.map(([file, line]) => ({ file, line })), recRepo, { regex: s.regex, projectRoot: SYN_ROOT }); }
  catch (e) { err = String(e.message); }
  const log = LOG; LOG = null;
  const reads = {};
  for (const f of new Set(s.hits.map(([f]) => f))) reads[f] = readFileRange(new Map(), f, 1, 1_000_000, SYN_ROOT);
  synSibling.push({ hits: s.hits, regex: s.regex, graph: log, reads, expect: res ?? null, error: err });
}
fs.rmSync(SYN_ROOT, { recursive: true, force: true });

// Interface-call selection/rendering on synthetic graph rows.
const I = (name, owner, filePath, startLine, endLine) => ({ name, owner, filePath, startLine, endLine });
const SYN_IFACE = [
  { file: 'src/a.cs', rows: [{ line: 10, call: 'Replace', target: 'IRepl.Replace', impls: [I('Replace', 'Repl', 'src/r.cs', 5, 30)] }] },
  { file: 'src/a.cs', rows: [{ line: 10, call: 'Do', target: 'IX.Do', impls: [I('Do', 'A', 'src/x.cs', 1, 40), I('Do', 'B', 'src/y.cs', 1, 40), I('Do', 'C', 'src/z.cs', 1, 40)] },
    { line: 11, call: 'Undo', target: 'IX.Undo', impls: [I('Undo', 'A', 'src/x.cs', 50, 90), I('Undo', 'B', 'src/y.cs', 50, 90), I('Undo', 'C', 'src/z.cs', 50, 90)] },
    { line: 12, call: 'Run', target: 'IY.Run', impls: [I('Run', null, 'src/p.go', 3, 40), I('Run', null, 'src/q.go', 4, 40), I('Run', '', 'src/s.go', null, null)] }] },
  { file: 'src/a.cs', rows: [{ line: 3, call: 'X', target: 'IX', impls: [I('X', 'A', 'tests/x.cs', 1, 40)] }, { line: 4, call: 'Y', target: 'IY', impls: [I('Y', 'A', 'src/a.cs', 1, 40)] }] },
  { file: 'tests/a.cs', rows: [{ line: 3, call: 'X', target: 'IX', impls: [I('X', 'A', 'src/x.cs', 1, 40)] }] },
  { file: 'src/a.cs', rows: [{ line: 3, call: 'X', target: 'IX', impls: [1, 2, 3, 4, 5, 6].map((k) => I('X', `C${k}`, `src/c${k}.cs`, 1, 40)) }] },
  { file: 'src/a.cs', rows: [{ line: 3, call: 'X', target: 'IX', impls: [I('X', 'A', 'src/x.cs', 1, 40), I('X', 'A', 'src/x2.cs', 1, 40)] },
    { line: 4, call: 'X2', target: 'IX', impls: [I('X', 'B', 'src/x.cs', 1, 40)] }] },
  { file: 'src/a.cs', rows: [1, 2, 3, 4, 5].map((k) => ({ line: k, call: `M${k}`, target: `I${k}.M`, impls: [I('M', `K${k}`, 'src/k.cs', k, 40)] })) },
  { file: 'src/a.cs', rows: [{ line: 9, call: 'P', target: 'NoDot', impls: [I('P', 'A', 'src/p.cs', 1, 40), I('P', 'B', 'src/p.cs', 50, 90), I('P', 'C', 'unit/p.cs', 1, 40), I('P', 'D', 'src/d.cs', 1, 40)] }] },
];
const synIface = SYN_IFACE.map((s) => {
  const calls = sr.selectInterfaceCalls(JSON.parse(JSON.stringify(s.rows)), s.file);
  return { file: s.file, rows: s.rows, select: calls, render: sr.renderInterfaceImpls({ interfaceCalls: calls }) };
});

// Interface-hint scenarios through the real JS path (no bench repo has interface overrides):
// the repository method answers from a synthetic call table; impl files are real temp files.
const IFACE_ROOT = path.join(OUT, '.syn-iface');
fs.rmSync(IFACE_ROOT, { recursive: true, force: true });
const IFACE_FILES = {
  'src/impl/Repl.cs': 'class Repl {\n  // x\n  public string Replace(string s) {\n    return _inner.Transform(s);\n  }\n}\n',
  'src/impl/Getter.cs': 'class Getter {\n  public string GetType() { return this.type; }\n}\n',
  'src/impl/Fwd.php': '<?php\nclass Fwd {\n  public function getType() {\n    return $this->aliasOf->getType(); // same\n  }\n}\n',
  'src/impl/Py.py': 'class P:\n    def value(self):\n        # cached\n        return self._v\n',
  'src/impl/Ünï.kt': 'class Ü {\n  override fun name(): String = other.compute()\n}\n',
};
for (const [f, t] of Object.entries(IFACE_FILES)) { fs.mkdirSync(path.dirname(path.join(IFACE_ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(IFACE_ROOT, f), t); }
const J = (name, owner, filePath, startLine, endLine) => ({ name, owner, filePath, startLine, endLine });
const IFACE_TABLE = {
  'src/app/Main.cs': [
    { line: 10, call: 'Replace', target: 'IReplacer.Replace', impls: [J('Replace', 'Repl', 'src/impl/Repl.cs', 3, 5)] },
    { line: 12, call: 'GetType', target: 'ITyped.GetType', impls: [J('GetType', 'Getter', 'src/impl/Getter.cs', 2, 2)] },
    { line: 13, call: 'getType', target: 'ITyped2.getType', impls: [J('getType', 'Fwd', 'src/impl/Fwd.php', 3, 5), J('getType', 'Getter', 'src/impl/Getter.cs', 2, 2)] },
    { line: 20, call: 'Handle', target: 'IHandler.Handle', impls: [J('Handle', 'A', 'src/h/A.cs', 1, 40), J('Handle', 'B', 'src/h/B.cs', 1, 40), J('Handle', 'C', 'src/h/C.cs', 1, 40)] },
    { line: 21, call: 'Close', target: 'IHandler.Close', impls: [J('Close', 'A', 'src/h/A.cs', 50, 90), J('Close', 'B', 'src/h/B.cs', 50, 90), J('Close', 'C', 'src/h/C.cs', 50, 90)] },
    { line: 22, call: 'Open', target: 'IHandler.Open', impls: [J('Open', 'A', 'src/h/A.cs', 95, 99), J('Open', 'B', 'src/h/B.cs', 95, 99), J('Open', 'D', 'src/h/D.cs', 95, 99)] },
    { line: 23, call: 'Replace', target: 'IReplacer.Replace', impls: [J('Replace', 'Repl', 'src/impl/Repl.cs', 3, 5)] },
    { line: 30, call: 'Run', target: 'IRunner.Run', impls: [J('Run', null, 'src/r/a.go', 3, 40), J('Run', null, 'src/r/b.go', 3, 40), J('Run', null, 'tests/r/c.go', 3, 40), J('Run', null, 'src/r/d.go', null, null)] },
    { line: 31, call: 'Six', target: 'ISix.Six', impls: [1, 2, 3, 4, 5, 6].map((k) => J('Six', `S${k}`, `src/s/S${k}.cs`, 1, 30)) },
    { line: 32, call: 'Self', target: 'ISelf.Self', impls: [J('Self', 'Main', 'src/app/Main.cs', 100, 140)] },
    { line: 33, call: 'Test', target: 'ITest.Test', impls: [J('Test', 'T', 'tests/T.cs', 1, 30)] },
    { line: 34, call: 'value', target: 'IVal.value', impls: [J('value', 'P', 'src/impl/Py.py', 2, 4)] },
    { line: 35, call: 'name', target: 'INamed.name', impls: [J('name', 'Ü', 'src/impl/Ünï.kt', 2, 2), J('name', 'Ü', 'src/impl/Ünï.kt', 2, 2)] },
    { line: 36, call: 'Gone', target: 'IGone.Gone', impls: [J('Gone', 'G', 'src/impl/missing.cs', 1, 3)] },
  ],
  'src/app/Other.java': [
    { line: 5, call: 'Replace', target: 'IReplacer.Replace', impls: [J('Replace', 'Repl', 'src/impl/Repl.cs', 3, 5)] },
    { line: 6, call: 'Do', target: 'NoDot', impls: [J('Do', 'X', 'src/x/X.java', 1, 30), J('Do', 'Y', 'src/x/Y.java', 1, 30), J('Do', '', 'src/x/Z.java', 7, 30)] },
  ],
  'tests/app/MainTest.cs': [{ line: 3, call: 'Replace', target: 'IReplacer.Replace', impls: [J('Replace', 'Repl', 'src/impl/Repl.cs', 3, 5)] }],
};
const realInRanges = CodeGraphRepository.prototype.findInterfaceCallImplementationsInRanges;
// The recording wrapper (installed above) calls `orig`; swap what it wraps for the table.
const synInRanges = function (filePath, ranges) {
  return ranges.map((r) => (IFACE_TABLE[filePath] || []).filter((c) => c.line >= r.startLine && c.line <= r.endLine).slice(0, 64)
    .map((c) => ({ ...c, impls: c.impls.map((i) => ({ ...i })) })));
};
const IFACE_HINTS = [
  { total: 1, rows: [['src/app/Main.cs', 9]] },
  { total: 1, rows: [['src/app/Main.cs', 12]] },
  { total: 2, rows: [['src/app/Main.cs', 18], ['src/app/Main.cs', 20]] },
  { total: 3, rows: [['src/app/Main.cs', 20], ['src/app/Other.java', 4], ['src/app/Main.cs', 30]] },
  { total: 8, rows: [['src/app/Main.cs', 28], ['src/app/Main.cs', 31], ['src/app/Main.cs', 33]] },
  { total: 9, rows: [['src/app/Main.cs', 9]] },
  { total: 0, rows: [['src/app/Main.cs', 9]] },
  { total: 1, rows: [['tests/app/MainTest.cs', 2]] },
  { total: 4, rows: [['src/app/Other.java', 3], ['src/app/Main.cs', 7], ['src/app/Main.cs', 19], ['src/app/Main.cs', 34]] },
  { total: 2, rows: [['src/app/Main.cs', 32], ['src/app/Main.cs', 33]] },
  { total: 1, rows: [['src/app/Main.cs', 21]] },
  { total: 1, rows: [['src/app/Other.java', 6]] },
  { total: 5, rows: [['src/app/Main.cs', 22], ['src/app/Main.cs', 20], ['src/app/Main.cs', 21], ['src/app/Main.cs', 10], ['src/app/Main.cs', 13]] },
  { total: 2, rows: [['src/app/Main.cs', 35], ['src/app/Main.cs', 36]] },
  { total: 1, rows: [['nowhere.cs', 1]] },
];
const ifaceHints = [];
{
  const wrapped = CodeGraphRepository.prototype.findInterfaceCallImplementationsInRanges;
  // Re-wrap: the recorder closes over the real method, so install a recorder around the table.
  CodeGraphRepository.prototype.findInterfaceCallImplementationsInRanges = function (...args) {
    const result = synInRanges.apply(this, args);
    LOG?.push(['findInterfaceCallImplementationsInRanges', JSON.parse(JSON.stringify(args)), JSON.parse(JSON.stringify(result))]);
    return result;
  };
  for (const h of IFACE_HINTS) {
    LOG = [];
    const out = writeGrepInterfaceHint(IFACE_ROOT, h.total, h.rows.map(([file, line]) => ({ file, line })));
    const log = LOG; LOG = null;
    const reads = {};
    for (const [, , res] of log) for (const rows of res) for (const row of rows) for (const i of row.impls) {
      if (i.filePath && i.startLine > 0 && i.endLine >= i.startLine && i.endLine - i.startLine <= 12) {
        let t = null; try { t = fs.readFileSync(path.join(IFACE_ROOT, i.filePath), 'utf8'); } catch { t = null; }
        reads[i.filePath] = t;
      }
    }
    ifaceHints.push({ total: h.total, rows: h.rows, graph: log, reads, expect: out });
  }
  CodeGraphRepository.prototype.findInterfaceCallImplementationsInRanges = wrapped;
  void realInRanges;
}
fs.rmSync(IFACE_ROOT, { recursive: true, force: true });

// Accessor bodies: synthetic + real implementation code.
const accessor = [...ACCESSOR_SYN, ...accessorCodes].map(([code, name]) => [code, name, sr.isAccessorBody(code, name)]);

// readFileRange slices.
const RANGE_TEXT = 'l1\nl2\r\nl3\n\nl5\n';
const tmpRange = path.join(OUT, '.range-tmp');
fs.mkdirSync(tmpRange, { recursive: true });
fs.writeFileSync(path.join(tmpRange, 'r.txt'), RANGE_TEXT);
const ranges = [[1, 1], [1, 3], [0, 0], [0, 2], [2, 0], [5, 9], [7, 9], [-1, 2], [3, -1], [1, 1000000], [4, 4], [6, 6]].map(([s, e]) => [s, e, readFileRange(new Map(), 'r.txt', s, e, tmpRange)]);
const traversal = ['r.txt', './r.txt', '../x', 'a/../r.txt', '/etc/hosts', '../.range-tmp/r.txt'].map((f) => [f, readFileRange(new Map(), f, 1, 1, tmpRange) === null]);
fs.rmSync(tmpRange, { recursive: true, force: true });

const allPaths = [...SYN_PATHS, ...sample([...helperPaths], 700, rng(7))];
const allRegexes = [...SYN_REGEXES, ...[...helperRegexes].slice(0, 600)];
const contents = sample([...helperContents], 600, rng(11)).map((c) => truncateCp(c, 300));
const helpers = {
  paths: allPaths.map((p) => [p, isTestLikePath(p), isTestPath(p), (isTestPath(p) || /(?:^|\/)(?:unit|acceptance|integration|e2e|functional)(?:[-_]?tests?)?\//i.test(p || ''))]),
  definedName: allRegexes.map((rx) => {
    const bare = String(rx).replace(/^\\b\(\?:(.*)\)\\b$/, '$1');
    return [rx, /^(?:\\b)?([A-Za-z_$][\w$]*)(?:\\b|\\\(|\\s\*\\\()?$/.exec(bare)?.[1] || null];
  }),
  literalRuns: allRegexes.map((rx) => [rx, qs.regexLiteralRuns(rx)]),
  evidence: allRegexes.map((rx) => { const e1 = qs.extractQueryEvidence('', rx); const e2 = qs.extractQueryEvidence(rx, rx); return [rx, e1.anchors, [...e1.subtokens], e2.anchors, [...e2.subtokens]]; }),
  subtokens: [...SYN_TEXTS, ...contents.slice(0, 200)].map((t) => [t, [...qs.informativeSubtokens(t)]]),
  contains: CONTAINS.map(([h, t, cs]) => [h, t, cs, qs.containsToken(h, t, { caseSensitive: cs })]),
  shortName: [...SHORT_NAMES, ...SYN_TEXTS].map((n) => [n, glc.entityShortName(n)]),
  nameOnLine: [...NAME_ON_LINE, ...contents.slice(0, 200).map((c, i) => [SYN_TEXTS[i % SYN_TEXTS.length].slice(0, 4) || 'a', c])].map(([n, t]) => [n, t, glc.nameOnLine(n, t)]),
  commentLine: [...COMMENT_LINES, ...contents].map((t) => [t, glc.isCommentLine(t)]),
  dates: DATES.map((d) => [d, Number.isFinite(Date.parse(d)) ? Date.parse(d) : null]),
  family: FAMILY_SYN.map((f) => { const m = apc.buildIndexedFamilyManifest(f.candidates, { seedNames: f.seedNames }); return [f.candidates.map(packEntity), f.seedNames, m ? { ...m, members: m.members.map(packEntity) } : null]; }),
  accessor,
  iface: synIface,
  ifaceHints,
  sibling: synSibling,
  ranges: { text: RANGE_TEXT, cases: ranges, traversal },
};
fs.writeFileSync(path.join(OUT, '_helpers.json'), JSON.stringify(helpers, wf));
console.log(`helpers: ${(fs.statSync(path.join(OUT, '_helpers.json')).size / 1024).toFixed(0)}KB; repo cases ${totalCases}`);
process.exit(0);
