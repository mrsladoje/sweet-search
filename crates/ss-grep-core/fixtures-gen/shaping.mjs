// Fixtures for src/shaping.rs and src/render.rs: the JS functions they mirror, run on the
// recorded bareGrep calls (../../../corpus/<repo>.bare.jsonl) and on synthetic edge cases.
//
//   node fixtures-gen/shaping.mjs                 -> tests/fixtures/shaping/*.json (sampled, < 1 MB)
//   node fixtures-gen/shaping.mjs --full <dir>    -> every call, untruncated, into <dir>
//                                                    (run the Rust test with SHAPING_FIXTURES_FULL=<dir>)
//
// Env: SS_JS_ROOT (the JS worktree), SS_CORPUS (the corpus dir), SS_REPOS (checked-out repos for
// the -A/-B/-C context listing).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRATE = path.resolve(HERE, '..');
const JS_ROOT = process.env.SS_JS_ROOT || path.resolve(CRATE, '../../../wt-new');
const CORPUS = process.env.SS_CORPUS || path.resolve(CRATE, '../../../corpus');
const REPOS = process.env.SS_REPOS || '/Users/admin/.ss-eval/grep-e2e-bench/repos';

const shaping = await import(path.join(JS_ROOT, 'core/search/grep-output-shaping.js'));
const fixes = await import(path.join(JS_ROOT, 'core/search/agent-output-fixes.js'));
const rules = await import(path.join(JS_ROOT, 'core/search/grep-allocation-rules.js'));
const classes = await import(path.join(JS_ROOT, 'core/search/grep-line-classes.js'));
const testPaths = await import(path.join(JS_ROOT, 'core/infrastructure/test-paths.js'));

const fullIdx = process.argv.indexOf('--full');
const FULL = fullIdx >= 0;
const OUT = FULL ? path.resolve(process.argv[fullIdx + 1]) : path.join(CRATE, 'tests/fixtures/shaping');
mkdirSync(OUT, { recursive: true });

// --- deterministic sampling ----------------------------------------------------------------
let seed = 42;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

/** Node prints a lone surrogate as U+FFFD; fixtures hold the printed form. */
const wf = (s) => (typeof s === 'string' ? s.toWellFormed() : s);
const isWf = (s) => typeof s !== 'string' || s.isWellFormed();

/** Cut a long content line (committed fixtures only) without splitting a surrogate pair. */
function cap(s, n) {
  if (FULL || typeof s !== 'string' || s.length <= n) return s;
  let t = s.slice(0, n);
  if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1);
  return t;
}

function slimRow(r, contentCap = 160, matchCap = 300) {
  const o = { file: r.file, line: r.line, column: r.column ?? 0, matchText: cap(r.matchText ?? '', matchCap), content: cap(r.content ?? '', contentCap) };
  if (Number.isInteger(r.lineClass)) o.lineClass = r.lineClass;
  if (Number.isInteger(r.lineSymbol)) o.lineSymbol = r.lineSymbol;
  if (r.defines) o.defines = true;
  return o;
}

const DEFAULT_BODY = { alloc: 'weight', weight: 'sat2', rule: 'guarantee', lineClasses: true, lineSpread: true, fullLine: true };

function bodyOut(body, withLines = false) {
  if (!body.rows.every((r) => isWf(r.text))) return null; // Rust declines
  return {
    lines: withLines ? body.lines : null, rows: body.rows.map((r) => ({ file: r.file, line: r.line, text: r.text, more: r.more })),
    shownMatches: body.shownMatches, matchedFileCount: body.matchedFileCount,
    truncatedFileCount: body.truncatedFileCount, hiddenLine: body.hiddenLine, hidden: body.hidden,
  };
}

/** Every kept row belongs to the file the summary says (else the JS read another file's rows). */
function validKept(out, input) {
  let at = 0;
  for (const f of out.fileSummary.files) {
    for (let j = 0; j < f.kept; j++, at++) {
      const idx = out.kept[at];
      if (idx === undefined || input[idx]?.file !== f.file) return false;
    }
  }
  return at === out.kept.length;
}

function divOut(res, input) {
  const at = new Map(input.map((r, i) => [r, i]));
  return { kept: res.kept.map((r) => at.get(r)), fileSummary: res.fileSummary };
}

/** Sparse file lines for the context listing: { len, lines: { n: text } } of the windows. */
function sparseLines(repo, file, hitLines, before, after, store) {
  const key = file;
  let entry = store[key];
  let all = null;
  const abs = path.join(REPOS, repo, file);
  try {
    all = readFileSync(abs, 'utf8').split('\n');
    if (all.length && all[all.length - 1] === '') all.pop();
  } catch { all = null; }
  if (!all) { store[key] = null; return; }
  if (!entry) entry = store[key] = { len: all.length, lines: {} };
  for (const h of hitLines) {
    for (let n = Math.max(1, h - before); n <= Math.min(all.length, h + after); n++) entry.lines[n] = all[n - 1];
  }
}

function readerFrom(store) {
  return (file) => {
    const e = store[file];
    if (!e) return null;
    const arr = new Array(e.len).fill('');
    for (const [n, t] of Object.entries(e.lines)) arr[Number(n) - 1] = t;
    return arr;
  };
}

function matchLinesOf(rows) {
  const m = new Map();
  for (const r of rows) { if (!m.has(r.file)) m.set(r.file, new Set()); m.get(r.file).add(r.line); }
  return m;
}
const matchLinesJson = (m) => Object.fromEntries([...m].map(([f, s]) => [f, [...s]]));

// --- corpus ----------------------------------------------------------------------------------
const repos = readdirSync(CORPUS).filter((f) => f.endsWith('.bare.jsonl')).map((f) => f.replace('.bare.jsonl', '')).sort();
const calls = [];
for (const repo of repos) {
  const lines = readFileSync(path.join(CORPUS, `${repo}.bare.jsonl`), 'utf8').split('\n').filter(Boolean);
  lines.forEach((l, i) => {
    const o = JSON.parse(l);
    calls.push({ repo, i, o });
  });
}

// --- 1. paths ----------------------------------------------------------------------------------
const pathSet = new Set();
for (const { o } of calls) {
  for (const r of o.result.results || []) pathSet.add(r.file);
  for (const f of o.result.fileSummary?.files || []) pathSet.add(f.file);
  for (const f of o.result.fileSummary?.hiddenSample || []) pathSet.add(f.file);
}
const SYN_PATHS = [
  '', 'a', 'test', 'tests/a.go', 'src/test/x.java', 'TestS/x', 'x/__tests__/y.js', 'x/__mocks__/y.js',
  'spec/a.rb', 'ſpec/a.rb', 'moKk/x.go', 'mock/x.go', 'MOCKS/x.go', 'testdata/a', 'test_data/b', 'fixture/x', 'Fixtures/x',
  'e2e/a.ts', 'testing/a.go', 'integration-tests/a.py', 'unit_test/a.py', 'acceptance-Tests/x', 'unit/a.go', 'acceptance/a.go',
  'pkg/foo_test.go', 'foo_TEST.GO', 'test_foo.py', 'a/test_.py', 'a/test_x', 'a/b/test_über.py', 'foo.test.ts', 'foo.spec.mjs',
  'foo-test.cjs', 'foo.Test.TSX', 'foo_spec.rb', 'FooTest.java', 'FooTests.swift', 'footest.java', 'FooTest.JAVA', 'FooTests.mm',
  'conftest.py', 'a/Conftest.PY', 'a\\b\\test_x.py', 'a\\tests\\b.go', 'vendor/x.go', 'a/VENDOR/x.go', 'dist/a.js', 'distx/a.js',
  'a/build/b.c', 'node_modules/x/index.js', 'x.min.js', 'x.MIN.JS', 'x.pb.go', 'x_pb2.py', 'x.generated.ts', 'Cargo.lock',
  'a/package-lock.json', 'yarn.lock', 'pnpm-lock.yml', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'go.sum', 'poetry.lock',
  'Pipfile.lock', 'uv.lock', 'pdm.lock', 'composer.lock', 'Gemfile.lock', 'Podfile.lock', 'Package.resolved', 'mix.lock',
  'pubspec.lock', 'flake.lock', 'gradle.lockfile', 'packages.lock.json', 'deno.lock', 'a/lockfile.go', 'blocked.go', 'x.resolved',
  'x.resolved.go', 'shrinkwrap.go', 'x/pb_util.go', 'pb2.go', 'docs/a.go', 'doc/x.go', 'README.md', 'a/b.MDX', 'x.markdown',
  'notes.txt', 'a.rst', 'a.adoc', 'a.rdoc', 'examples/a.rs', 'example.go', 'samples/x', 'demo/x', 'demos/x', 'CHANGELOG',
  'CHANGELOG.md', 'changes/x', 'NEWS', 'history.go', 'HISTORY/x', 'src/über/test_ü.py', '测试/test_x.py',
  '\u{1F600}/spec/a.rb', 'src/\u{1F600}.go', 'a//b/./c', './x/y', 'x\\y', 'a/specs/x', 'a/Specs', 'a/specx/y',
];
for (const p of SYN_PATHS) pathSet.add(p);
let pathList = [...pathSet].sort();
if (!FULL && pathList.length > 700) {
  const keep = new Set(SYN_PATHS);
  pathList = pathList.filter((p) => keep.has(p) || rand() < 450 / pathList.length);
}
const pathsFixture = pathList.map((p) => ({
  path: p,
  isTest: testPaths.isTestLikePath(p),
  prior: shaping.grepFilePrior(p),
  outsideSource: shaping.isOutsideScopeSourceFile(p),
}));

// --- 2. hit text ---------------------------------------------------------------------------------
const MAXES = [null, 80, 40, 10, 3, 2, 1, 200];
const hitRows = [];
for (const { o } of (FULL ? [] : calls)) {
  for (const r of o.result.results || []) {
    if (!isWf(r.content) || !isWf(r.matchText)) continue;
    const long = typeof r.content === 'string' && r.content.length > 60;
    if (FULL || (long ? rand() < 0.004 : rand() < 0.0008)) hitRows.push(slimRow(r, 600));
  }
}
const E = '\u{1F600}';
const SYN_HITS = [
  { matchText: 'foo', content: '   foo   bar\tbaz  ', column: 4 },
  { matchText: 'foo', content: '', column: 1 },
  { matchText: '  spaced \t text  ', content: '   \t ', column: 1 },
  { matchText: 'x'.repeat(150), content: '', column: 1 },
  { matchText: 'a'.repeat(139) + E + 'b', content: '', column: 1 },
  { matchText: 'a'.repeat(138) + E + 'b', content: '', column: 1 },
  { matchText: 'needle', content: 'x'.repeat(200) + 'needle' + 'y'.repeat(10), column: 201 },
  { matchText: 'needle', content: 'x'.repeat(200) + 'needle' + 'y'.repeat(10), column: 5 },
  { matchText: 'needle', content: 'x'.repeat(200) + 'needle' + 'y'.repeat(300), column: 201 },
  { matchText: 'needle', content: 'needle' + 'y'.repeat(300), column: 1 },
  { matchText: 'needle', content: 'y'.repeat(100) + 'needle' + 'y'.repeat(300), column: 101 },
  { matchText: 'absent', content: 'y'.repeat(300), column: 3 },
  { matchText: 'needle  \r', content: '\t\t' + 'z '.repeat(120) + 'needle' + ' w'.repeat(80), column: 243 },
  { matchText: 'née', content: 'é'.repeat(150) + 'née' + 'é'.repeat(150), column: 151 },
  { matchText: 'needle', content: E.repeat(100) + 'needle' + E.repeat(100), column: 201 },
  { matchText: 'needle', content: 'a' + E.repeat(100) + 'needle' + E.repeat(100), column: 202 },
  { matchText: E + 'x', content: '漢'.repeat(90) + E + 'x' + E.repeat(70), column: 91 },
  { matchText: 'tail', content: 'q'.repeat(300) + 'tail', column: 301 },
  { matchText: 'tail', content: E.repeat(150) + 'tail', column: 301 },
  { matchText: 'mid  dle', content: 'a  b  c　d'.repeat(40) + 'mid  dle' + ' x'.repeat(60), column: 1 },
  { matchText: 'q', content: '﻿' + 'q'.repeat(400), column: 2 },
  { matchText: '', content: 'k'.repeat(300), column: 1 },
  { matchText: 'k', content: 'k'.repeat(300), column: 0 },
  { matchText: 'k'.repeat(141), content: 'k'.repeat(300), column: 100 },
  { matchText: 'x', content: ' x', column: 2 },
  { matchText: 'ab', content: 'ab', column: 1 },
];
for (const s of SYN_HITS) hitRows.push({ file: 'syn.txt', line: 1, ...s });
function hitCases(rowsIn) {
  const out = { maxes: MAXES, cases: [] };
  for (const r of rowsIn) {
    const full = MAXES.map((max) => wf(fixes.grepHitText(r, { fullLine: true, ...(max != null ? { max } : {}) })));
    const plain = wf(fixes.grepHitText(r, { fullLine: false }));
    out.cases.push({ row: r, full, plain });
  }
  return out;
}
const hitFixture = hitCases(hitRows);

// --- 3. calls: selection, body, listing ---------------------------------------------------
function rebuildTotals(fs) {
  const m = new Map();
  for (const f of fs?.files || []) m.set(f.file, f.total);
  return m;
}

const SELECT_OPTS = [
  { perFileCap: 20, maxFiles: 20, order: 'weight', weight: 'sat2' },
  { perFileCap: 3, maxFiles: 3, order: 'weight', weight: 'sat2' },
  { perFileCap: 2, maxFiles: 5, order: 'weight' },
  { perFileCap: 1, maxFiles: 1, order: 'weight', weight: 'sat2', hiddenSampleSize: 2 },
  { perFileCap: 4, maxFiles: 0, order: 'weight', weight: 'sat2' },
  { perFileCap: 2, maxFiles: 2, order: 'weight', hiddenSampleSize: 0 },
  { perFileCap: 20, maxFiles: 20 },
  { perFileCap: 2, maxFiles: 3 },
  { perFileCap: 1, maxFiles: 0, hiddenSampleSize: 1 },
];

const BODY_VARIANTS = [
  { name: 'legacy', opts: undefined },
  { name: 'legacy-fullline-drop', opts: { fullLine: true, dropRepeatedText: true } },
  { name: 'weight-sl', opts: { alloc: 'weight', fullLine: true } },
  { name: 'weight-hh', opts: { alloc: 'weight', weight: 'sat2', rule: 'hh', lineClasses: true, fullLine: true } },
  { name: 'weight-noclass', opts: { alloc: 'weight', weight: 'sat2', rule: 'guarantee', fullLine: true, dropRepeatedText: true } },
  { name: 'weight-nospread', opts: { alloc: 'weight', weight: 'sat2', rule: 'guarantee', lineClasses: true, fullLine: false } },
];

function callCase(repo, o, { withContext }) {
  const res = o.result;
  const rows = (res.results || []).map((r) => slimRow(r));
  if (!rows.every((r) => isWf(r.content) && isWf(r.matchText) && isWf(r.file))) return null;
  const fs = res.fileSummary || { files: [], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
  const total = res.stats?.totalMatches ?? rows.length;
  const hitMax = fixes.grepBroadHitMax(total);
  const c = { id: `${repo}#${o.call}`, rows, fileSummary: fs, total, hitMax: hitMax ?? null, bodies: [], selections: [], listings: [], lineLists: [] };

  // Selection on the rows grouped in path order (any grouping is a valid input).
  const grouped = rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.file < b.r.file ? -1 : a.r.file > b.r.file ? 1 : a.i - b.i)).map((x) => x.r);
  c.grouped = grouped.map((r) => rows.indexOf(r));
  const totals = rebuildTotals(fs);
  for (const opts of (FULL ? SELECT_OPTS : [0, 1, 3, 5, 6, 8].map((i) => SELECT_OPTS[i]))) {
    for (const withTotals of [false, true]) {
      const o2 = withTotals ? { ...opts, totals } : opts;
      let out;
      try { out = divOut(shaping.applyGrepFileDiversity(grouped, o2), grouped); } catch { out = null; }
      if (out && !validKept(out, grouped)) out = null; // JS read past a file's rows: Rust declines
      c.selections.push({ opts, withTotals, out });
    }
  }

  // Body: the default ss-grep options for k in {1, 3, 20, 50}, then the arms.
  for (const k of (FULL || repo === '__synthetic__' ? [0, 1, 3, 20, 50] : [1, 3, 20])) {
    const opts = hitMax ? { ...DEFAULT_BODY, hitMax } : DEFAULT_BODY;
    c.bodies.push({ name: 'default', k, opts, summary: 'given', out: bodyOut(shaping.renderGrepBody(rows, fs, k, opts), k === 20) });
  }
  const noOrder = { ...fs }; delete noOrder.order; delete noOrder.weight;
  c.bodies.push({ name: 'default-slowpath', k: 20, opts: DEFAULT_BODY, summary: 'noorder', out: bodyOut(shaping.renderGrepBody(rows, noOrder, 20, DEFAULT_BODY)) });
  for (const v of BODY_VARIANTS) {
    for (const k of [5]) {
      c.bodies.push({ name: v.name, k, opts: v.opts ?? null, summary: 'given', out: bodyOut(shaping.renderGrepBody(rows, fs, k, v.opts)) });
    }
  }

  // Listing of the default k=20 body, plain and with typed files.
  const body = shaping.renderGrepBody(rows, fs, 20, hitMax ? { ...DEFAULT_BODY, hitMax } : DEFAULT_BODY);
  if (bodyOut(body)) {
    const files = [...new Set(body.rows.map((r) => r.file))];
    for (const [typed, dropText] of [[files.slice(0, 2), true]]) {
      c.listings.push({ rows: null, before: 0, after: 0, typed, dropText, files: null, matchLines: null,
        out: shaping.renderGrepListing(body.rows, { typed, dropText }) });
    }
    c.listings.push({ rows: null, before: 0, after: 0, typed: [], dropText: false, files: null, matchLines: null,
      out: shaping.renderGrepListing(body.rows) });
    c.hiddenLine = shaping.renderGrepHiddenFiles(body.hidden);
    if (withContext) {
      const ml = matchLinesOf(rows);
      for (const [before, after] of (FULL ? [[2, 0], [0, 3], [2, 2], [6, 6]] : [[2, 0], [1, 3], [6, 6]])) {
        const store = {};
        const byFile = new Map();
        for (const r of body.rows) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r.line); }
        for (const [f, hl] of byFile) sparseLines(repo, f, hl, before, after, store);
        const out = shaping.renderGrepListing(body.rows, { before, after, getLines: readerFrom(store), matchLines: ml, typed: files.slice(0, 1) });
        c.listings.push({ rows: null, before, after, typed: files.slice(0, 1), dropText: false, files: store, matchLines: matchLinesJson(ml), out });
      }
    }
  }

  // Flood-mode line lists and the repeated-text check.
  const linesByFile = new Map();
  for (const m of rows) { if (!linesByFile.has(m.file)) linesByFile.set(m.file, []); linesByFile.get(m.file).push(m.line); }
  c.linesByFile = Object.fromEntries(linesByFile);
  for (const k of [0, 3, 20]) c.lineLists.push({ k, out: fixes.renderGrepLineLists(fs.files || [], linesByFile, k) });
  c.repeated = [fixes.matchTextIsRepeated(rows, { fullLine: false }), fixes.matchTextIsRepeated(rows, { fullLine: true })];
  return c;
}

// Committed: a sample (calls with `defines` rows first, then a random share, bounded by rows).
// --full: every unscoped call, one file per repo (plus its hit texts), written as it goes.
const callCases = [];
const contextCases = [];
const fullCounts = { calls: 0, hits: 0, declinedBodies: 0 };
if (FULL) {
  for (const repo of repos) {
    const mine = calls.filter((c) => c.repo === repo);
    const cases = [];
    const rowsForHits = [];
    for (const { o } of mine) {
      for (const r of o.result.results || []) if (isWf(r.content) && isWf(r.matchText)) rowsForHits.push(slimRow(r));
      if ((o.options?.perFileCap ?? 0) === 0) continue;
      const c = callCase(repo, o, { withContext: existsSync(path.join(REPOS, repo)) });
      if (!c) continue;
      cases.push(c);
      fullCounts.declinedBodies += c.bodies.filter((b) => b.out === null).length;
    }
    fullCounts.calls += cases.length;
    fullCounts.hits += rowsForHits.length;
    writeFileSync(path.join(OUT, `calls-${repo}.json`), JSON.stringify(cases));
    writeFileSync(path.join(OUT, `hit_text-${repo}.json`), JSON.stringify(hitCases(rowsForHits)));
    writeFileSync(path.join(OUT, `line_classes-${repo}.json`), JSON.stringify(lineClassFor(cases, Infinity)));
    writeFileSync(path.join(OUT, `stdout-${repo}.json`), JSON.stringify(stdoutCases(repo)));
    if (callCases.length < 40) callCases.push(...cases.slice(0, 3)); // for typed labels / line classes below
  }
} else {
  let budgetRows = 0;
  const ROW_BUDGET = 170;
  const CTX_BUDGET = 5;
  const ordered = calls.map((x) => ({ x, r: rand() })).sort((a, b) => a.r - b.r).map((y) => y.x);
  ordered.sort((a, b) => Number((b.o.result.results || []).some((r) => r.defines)) - Number((a.o.result.results || []).some((r) => r.defines)));
  for (const { repo, o } of ordered) {
    const res = o.result;
    if ((o.options?.perFileCap ?? 0) === 0) continue; // scoped (flat) calls have no fileSummary
    const n = (res.results || []).length;
    if (n === 0 && callCases.length > 3) continue;
    if (n > 60 || budgetRows + n > ROW_BUDGET) continue;
    const withContext = contextCases.length < CTX_BUDGET && n > 0 && existsSync(path.join(REPOS, repo));
    const c = callCase(repo, o, { withContext });
    if (!c) continue;
    budgetRows += n;
    callCases.push(c);
    if (withContext) contextCases.push(c.id);
  }
}
const corpusCallCount = callCases.length;

// --- 3b. end to end: the recorded ss-grep stdout of unscoped calls without context -------------
function stdoutCases(repo) {
  const out = [];
  const bare = calls.filter((c) => c.repo === repo).map((c) => c.o);
  const byCall = new Map();
  for (const b of bare) { if (!byCall.has(b.call)) byCall.set(b.call, []); byCall.get(b.call).push(b); }
  const lines = readFileSync(path.join(CORPUS, `${repo}.calls.jsonl`), 'utf8').split('\n').filter(Boolean);
  for (const l of lines) {
    const c = JSON.parse(l);
    const args = c.args || [];
    if (args.some((a) => /^-[ABC]/.test(a) || a === '--in' || a.startsWith('--context'))) continue;
    const recs = (byCall.get(c.seq) || []).filter((b) => b.options.perFileCap > 1);
    if (!recs.length) continue;
    const b = recs[recs.length - 1];
    const res = b.result;
    if (!FULL && (res.results.length > 12 || res.results.some((r) => (r.content || '').length > 200))) continue;
    out.push({ id: c.id, k: b.options.maxFiles, total: res.stats?.totalMatches ?? res.results.length,
      rows: res.results.map((r) => slimRow(r, Infinity, Infinity)), fileSummary: res.fileSummary, stdout: c.stdout });
  }
  return out;
}

// --- 4. synthetic calls --------------------------------------------------------------------------
const BLOB = 'sha512-Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYx0123456789==';
function row(file, line, content, extra = {}) { return { file, line, column: 1, matchText: content.trim().slice(0, 5) || 'x', content, ...extra }; }
const synCalls = [];
{
  // Ties: every file 2 hits, source prior; blob files; a lockfile; test files.
  const rows = [];
  for (const f of ['b.go', 'a.go', 'c.go', 'z/test_a.py', 'd.go', 'e.go']) { rows.push(row(f, 1, 'x := 1')); rows.push(row(f, 5, 'y := 2')); }
  for (let i = 1; i <= 3; i++) rows.push(row('data/blob.txt', i, `  "integrity": "${BLOB}"`));
  for (let i = 1; i <= 2; i++) rows.push(row('data/two.txt', i, BLOB));
  for (let i = 1; i <= 4; i++) rows.push(row('data/mixed.txt', i, i === 3 ? 'plain words here' : BLOB));
  for (let i = 1; i <= 3; i++) rows.push(row('web/package-lock.json', i, `"resolved": "${BLOB}"`));
  synCalls.push({ id: 'syn-ties-blobs', rows });
}
{
  // Line classes + spread + comments + large symbols + defines.
  const rows = [];
  const cls = [2, 1, 0, 1, 1, 0, 2, 1, 1, 0, 1, 1];
  const sym = [-1, 0, 0, 0, 3000, 3000, -1, 5, 5, 7, 7, 2];
  const txt = ['import x', 'call(x)', 'func x()', '// x note', 'x()', 'func y(x)', '# x', '  * x', 'x.y', 'def x', 'x = 1', 'return x'];
  for (let i = 0; i < 12; i++) rows.push(row('pkg/many.go', 10 * (i + 1), txt[i], { lineClass: cls[i], lineSymbol: sym[i] }));
  for (let i = 0; i < 6; i++) rows.push(row('pkg/noclass.go', i + 1, `x${i}`, i === 2 ? {} : { lineClass: 1, lineSymbol: 1 }));
  for (let i = 0; i < 5; i++) rows.push(row('pkg/nosym.go', i + 1, `x${i}`, { lineClass: i % 3 }));
  rows.push(row('pkg/def.go', 3, 'func Target() {', { defines: true }));
  rows.push(row('pkg/def.go', 9, 'Target()'));
  for (let i = 0; i < 4; i++) rows.push(row('pkg/z_test.go', i + 1, 'Target()'));
  synCalls.push({ id: 'syn-classes-defines', rows });
}
{
  // Non-ASCII paths and content, astral chars, long lines, CRLF.
  const rows = [];
  rows.push(row('src/über.go', 1, 'été = "' + E.repeat(90) + 'needle' + E.repeat(90) + '"', { matchText: 'needle', column: 1 }));
  rows.push(row('src/über.go', 2, '\t' + 'w '.repeat(100) + 'needle\r', { matchText: 'needle\r', column: 202 }));
  rows.push(row('测试/a.go', 7, '漢字 needle', { matchText: 'needle', column: 4 }));
  rows.push(row('\u{1F600}/b.go', 1, 'needle', { matchText: 'needle', column: 1 }));
  rows.push(row('～/c.go', 1, 'needle', { matchText: 'needle', column: 1 }));
  synCalls.push({ id: 'syn-unicode', rows });
}
{
  // A 140-unit cut of the matched text through an astral char: JS keeps a lone surrogate; the
  // Rust body declines (expected null) whenever that row is shown.
  const rows = [row('src/cut.go', 1, '', { matchText: 'a'.repeat(139) + E + 'b' }), row('src/cut.go', 2, 'plain', { matchText: 'plain' }),
    row('src/ok.go', 1, 'ok line', { matchText: 'ok' })];
  synCalls.push({ id: 'syn-lone-surrogate', rows });
}
{
  // Many files, k small: unallocated and hidden.
  const rows = [];
  for (let f = 0; f < 30; f++) for (let l = 0; l <= f % 4; l++) rows.push(row(`d${String(f).padStart(2, '0')}/f.go`, l + 1, `hit ${f} ${l}`));
  synCalls.push({ id: 'syn-many-files', rows });
}
for (const s of synCalls) {
  const sel = shaping.selectGrepFilesByWeight(s.rows, { perFileCap: 20, maxFiles: 20, weight: 'sat2' });
  const o = { call: s.id, result: { results: sel.kept, fileSummary: sel.fileSummary, stats: { totalMatches: s.rows.length } } };
  const c = callCase('__synthetic__', o, { withContext: false });
  c.id = s.id;
  // Also the raw (unselected) rows through the selection.
  c.raw = s.rows;
  c.rawSelections = SELECT_OPTS.map((opts) => ({ opts, out: divOut(shaping.applyGrepFileDiversity(s.rows, opts), s.rows) }));
  // ...and with totals larger than the stored rows (unread hits: no blob prior; kept past the rows: decline).
  const big = new Map([...new Set(s.rows.map((r) => r.file))].map((f, i) => [f, s.rows.filter((r) => r.file === f).length + (i % 3)]));
  c.rawTotals = Object.fromEntries(big);
  c.rawSelectionsTotals = SELECT_OPTS.map((opts) => {
    let out = divOut(shaping.applyGrepFileDiversity(s.rows, { ...opts, totals: big }), s.rows);
    if (!validKept(out, s.rows)) out = null;
    return { opts, out };
  });
  callCases.push(c);
}

// --- 5. synthetic listings (twins, stale lines, CRLF, empty file) --------------------------------
const synListings = [];
{
  const mk = (file, line, text, more = 0) => ({ file, line, text, more });
  const store = {
    'api/android/okhttp.api': { len: 12, lines: { 1: 'a', 2: 'fun x()\r', 3: 'b', 4: 'c', 5: 'fun y()', 6: 'd', 7: 'e' } },
    'api/jvm/okhttp.api': { len: 14, lines: { 3: 'a', 4: 'fun x()\r', 5: 'b', 6: 'c', 7: 'fun y()', 8: 'd', 9: 'e' } },
    'empty.txt': { len: 0, lines: {} },
    'short.txt': { len: 3, lines: { 1: 'one', 2: 'two', 3: 'three\r\r' } },
  };
  const rowsA = [mk('api/android/okhttp.api', 2, 'fun x()'), mk('api/android/okhttp.api', 5, 'fun y()'),
    mk('api/jvm/okhttp.api', 4, 'fun x()'), mk('api/jvm/okhttp.api', 7, 'fun y()'),
    mk('empty.txt', 1, 'gone'), mk('short.txt', 9, 'stale'), mk('short.txt', 2, 'two'), mk('short.txt', 0, 'zero', 4),
    mk('docs/okhttp.api', 2, 'fun x()'), mk('docs/okhttp.api', 5, 'fun y()'), mk('other/okhttp.api', 2, 'fun x()…'), mk('other/okhttp.api', 5, 'fun y()')];
  const ml = { 'api/android/okhttp.api': [1, 2, 5], 'short.txt': [1] };
  const mlMap = new Map(Object.entries(ml).map(([f, l]) => [f, new Set(l)]));
  for (const [before, after] of [[0, 0], [1, 1], [0, 2], [3, 0]]) {
    for (const typed of [[], ['api/jvm/okhttp.api'], ['short.txt', 'docs/okhttp.api']]) {
      for (const dropText of [false, true]) {
        const out = shaping.renderGrepListing(rowsA, { before, after, getLines: readerFrom(store), matchLines: mlMap, typed, dropText });
        synListings.push({ rows: rowsA, before, after, typed, dropText, files: store, matchLines: ml, out });
      }
    }
  }
  const single = [mk('only.go', 3, 'x'), mk('only.go', 4, 'y', 7)];
  synListings.push({ rows: single, before: 0, after: 0, typed: ['only.go'], dropText: false, files: null, matchLines: null,
    out: shaping.renderGrepListing(single, { typed: ['only.go'] }) });
  // Twins: a cut line (…) is no evidence; a file with hidden hits is no twin and no template.
  const dup = [mk('a/dup.go', 1, 'long\u2026'), mk('a/dup.go', 2, 'x'), mk('b/dup.go', 1, 'long\u2026'), mk('b/dup.go', 2, 'x'),
    mk('c/dup.go', 1, 'y'), mk('c/dup.go', 2, 'z'), mk('d/dup.go', 11, 'y'), mk('d/dup.go', 12, 'z', 3), mk('e/dup.go', 5, 'y'), mk('e/dup.go', 6, 'z'),
    mk('f/dup.go', 7, 'q'), mk('g/dup.go', 7, 'q'), mk('h/dup.go', 3, 'y'), mk('h/dup.go', 1, 'z')];
  for (const [typed, dropText] of [[[], false], [[], true], [['e/dup.go'], false], [['c/dup.go', 'e/dup.go'], false]]) {
    synListings.push({ rows: dup, before: 0, after: 0, typed, dropText, files: null, matchLines: null,
      out: shaping.renderGrepListing(dup, { typed, dropText }) });
  }
  const unread = [mk('missing.go', 3, 'x'), mk('missing.go', 1, 'y')];
  synListings.push({ rows: unread, before: 2, after: 2, typed: [], dropText: false, files: {}, matchLines: null,
    out: shaping.renderGrepListing(unread, { before: 2, after: 2, getLines: readerFrom({}) }) });
}

// --- 6. hidden files, outside scope, typed labels, allocation primitives ---------------------
const hiddenCases = [null, { files: 0, matches: 0, sample: [] }, { files: 1, matches: 1, sample: [] },
  { files: 1, matches: 2, sample: ['a.go'] }, { files: 6, matches: 10, sample: ['a.go', 'b.go', 'c.go'] }]
  .map((h) => ({ hidden: h, out: shaping.renderGrepHiddenFiles(h) }));

const outsideCases = [];
const probeCases = [];
for (const { repo, o } of calls) {
  if (!FULL && rand() > 0.03) continue;
  const st = o.result.stats || {};
  const scopes = Array.isArray(o.options?.fileFilter) ? o.options.fileFilter : (o.options?.fileFilter ? [o.options.fileFilter] : null);
  if (!scopes || o.options?.perFileCap !== 1) continue;
  const scopedTotal = o.options.grepOutsideScopedTotal ?? 0;
  if (st.outsideProbe) {
    for (const st2 of [scopedTotal, 0]) {
      const a = { ...st.outsideProbe, scopedTotal: st2, scopes };
      probeCases.push({ files: a.files, limit: a.limit, complete: a.complete ?? false, scopedTotal: st2, scopes, max: 3, out: shaping.renderOutsideScopeProbeLine(a) });
    }
  } else {
    const files = o.result.fileSummary?.files || [];
    const all = st.totalMatches ?? o.result.results.length;
    for (const st2 of [scopedTotal, 0]) {
      const a = { files, hiddenFiles: o.result.fileSummary?.hiddenFileCount || 0, outsideTotal: all - scopedTotal, scopedTotal: st2, scopes };
      outsideCases.push({ ...a, max: 3, out: shaping.renderOutsideScopeLine(a) });
    }
  }
}
{
  const F = (file, total, prior) => ({ file, total, kept: 1, ...(prior != null ? { prior } : {}) });
  const files = [F('a/x_test.go', 3, 0.5), F('docs/a.md', 2, 1), F('src/a.go', 1, 1), F('src/b.go', 1), F('lib/c.go', 4, 0.25), F('lib/d.go', 1, 1), F('src/a.go', 9, 1)];
  for (const scopes of [['src'], ['src/', 'lib'], ['.'], ['/'], [''], ['src/a.go'], ['nomatch'], []]) {
    for (const [outsideTotal, scopedTotal, hiddenFiles, max] of [[5, 3, 0, 3], [0, 3, 0, 3], [7, 0, 2, 3], [1, 0, -1, 1], [9, 2, 4, 10]]) {
      const a = { files, hiddenFiles, outsideTotal, scopedTotal, scopes, max };
      outsideCases.push({ ...a, out: shaping.renderOutsideScopeLine(a) });
    }
    const pf = ['docs/x.md', 'src/a.go', 'lib/a.go', 'a_test.go', 'README', 'x/y/z.rs'];
    for (const [limit, complete, scopedTotal, max] of [[20, true, 3, 3], [2, true, 0, 3], [6, false, 1, 2], [1, true, 0, 3], [5, true, 0, 1]]) {
      for (const list of [pf, pf.slice(1), pf.slice(2, 3)]) {
        const a = { files: list, limit, complete, scopedTotal, scopes, max };
        probeCases.push({ ...a, out: shaping.renderOutsideScopeProbeLine(a) });
      }
    }
  }
}
const scopeCases = [];
for (const file of ['src/a.go', 'src', 'srcx/a.go', 'a/src/b.go', '', 'x']) {
  for (const scopes of [['src'], ['src//'], ['.'], ['./'], ['/'], [''], ['x', 'src/a.go'], []]) {
    scopeCases.push({ file, scopes, out: shaping.fileInScopes(file, scopes) });
  }
}

const typedCases = [];
for (const c of callCases.slice(0, FULL ? callCases.length : 25)) {
  const files = [...new Set(c.rows.map((r) => r.file))];
  for (const f of files.slice(0, 4)) typedCases.push({ file: f, others: files, out: fixes.typedPathLabel(f, files) });
}
for (const [file, others] of [['a/b/c.go', ['x/b/c.go', 'c.go']], ['a/b/c.go', ['a/b/c.go']], ['c.go', ['a/c.go']], ['a/b/c.go', ['b/c.go', 'q/a/b/c.go']], ['', ['x']], ['a//b', ['b']]]) {
  typedCases.push({ file, others, out: fixes.typedPathLabel(file, others) });
}

const allocCases = [];
for (let t = 0; t < (FULL ? 3000 : 150); t++) {
  const n = Math.floor(rand() * 9);
  const totals = []; const caps = []; const keysSat = []; const keysSqrt = [];
  for (let i = 0; i < n; i++) {
    const hits = 1 + Math.floor(rand() * (rand() < 0.3 ? 3 : 40));
    const scale = [16, 4, 1][Math.floor(rand() * 3)];
    totals.push(hits); caps.push(Math.min(hits, Math.floor(rand() * 25)));
    keysSat.push(rules.grepWeightKey(hits, scale, 'sat2')); keysSqrt.push(rules.grepWeightKey(hits, scale));
  }
  const budget = Math.floor(rand() * 30);
  for (const [keys, w] of [[keysSat, 'sat2'], [keysSqrt, 'sqrt']]) {
    allocCases.push({
      keys, totals, caps, budget, weight: w,
      sl: [...shaping.allocateGrepLinesSainteLague(keys, totals, caps, budget)],
      guarantee: [...rules.allocateGrepLinesWithFirstLine(keys, totals, caps, budget, 'guarantee')],
      hh: [...rules.allocateGrepLinesWithFirstLine(keys, totals, caps, budget, 'hh')],
      budgetRR: shaping.allocateGrepBudget(caps, budget),
    });
  }
}
const weightKeyCases = [];
for (const hits of [0, 1, 2, 3, 7, 50, 1000, 123456, 99999999]) for (const scale of [16, 4, 1]) {
  weightKeyCases.push({ hits, scale, sat2: rules.grepWeightKey(hits, scale, 'sat2'), sqrt: rules.grepWeightKey(hits, scale) });
}
const quotaCases = [];
for (const [s, t, k] of [[0, 1, 5], [1, 0, 5], [3, 3, 6], [5, 5, 3], [10, 2, 5], [10, 10, 1], [10, 10, 5], [10, 10, 15], [100, 100, 20], [7, 7, 7], [9, 9, 8], [4, 4, -1]]) {
  quotaCases.push({ src: s, test: t, k, out: fixes.testFileQuota(s, t, k) });
}
const commentCases = ['', '  // x', '/* y', '\t* z', '*', '#', '# x', '#\tx', '#include', '#[derive]', '#!', '  /x', '/', 'x // y', '#\u{1F600}', ' // x']
  .map((t) => ({ text: t, out: classes.isCommentLine(t) }));
function lineClassFor(cases, limit) {
const lineClassCases = [];
for (const c of cases) {
  const byFile = new Map();
  for (const r of [...c.rows, ...(c.raw || [])]) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
  for (const ms of byFile.values()) {
    if (ms.length < 2 || !ms.some((m) => Number.isInteger(m.lineClass))) continue;
    const picks = [];
    for (const a of [...new Set([0, 1, 2, 3, Math.floor(ms.length / 2), ms.length - 1, ms.length])]) {
      for (const spread of [false, true]) picks.push({ a, spread, out: classes.selectGrepLinesByClass(ms, a, spread) });
    }
    lineClassCases.push({ ms: ms.map((m) => ({ file: m.file, line: m.line, content: cap(m.content, 60), ...(m.lineClass !== undefined ? { lineClass: m.lineClass } : {}), ...(m.lineSymbol !== undefined ? { lineSymbol: m.lineSymbol } : {}) })), picks });
    if (lineClassCases.length > limit) break;
  }
}
return lineClassCases;
}
const lineClassCases = lineClassFor(callCases, FULL ? Infinity : 60);
const broadCases = [0, 1, 49, 50, 51, 1000].map((t) => ({ total: t, out: fixes.grepBroadHitMax(t) ?? null }));

// --- write -------------------------------------------------------------------------------------
function write(name, data) {
  const s = JSON.stringify(data);
  writeFileSync(path.join(OUT, name), s);
  return s.length;
}
const sizes = {
  'paths.json': write('paths.json', pathsFixture),
  'hit_text.json': write('hit_text.json', hitFixture),
  'calls.json': write('calls.json', FULL ? callCases.slice(corpusCallCount) : callCases),
  'listings.json': write('listings.json', synListings),
  'misc.json': write('misc.json', { hiddenCases, outsideCases, probeCases, scopeCases, typedCases, allocCases, weightKeyCases, quotaCases, commentCases, broadCases, hiddenHint: shaping.GREP_HIDDEN_HINT }),
  'line_classes.json': write('line_classes.json', lineClassCases),
  ...(FULL ? {} : { 'stdout.json': write('stdout.json', repos.flatMap((r) => stdoutCases(r).filter(() => rand() < 0.12))) }),
};
const totalSize = Object.values(sizes).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ out: OUT, sizes, totalSize, fullCounts, calls: callCases.length, contextCalls: contextCases.length, hitCases: hitFixture.length, paths: pathsFixture.length, alloc: allocCases.length, lineClass: lineClassCases.length, outside: outsideCases.length, probe: probeCases.length }));
