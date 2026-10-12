// Fixtures for src/globs.rs: minimatch with the path-glob options on fuzzed patterns and paths,
// compilePathGlobs (+ dirsMatched) on the corpus -g globs against real file lists and on
// synthetic glob lists, and filterMatchesByPathGlobs counts.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CORPUS, REPOS, REPOS_DIR, jsPath, mulberry32, readJsonl, writeFixture } from './_common.mjs';

const { Minimatch } = await import(jsPath('node_modules/minimatch/dist/esm/index.js'));
const globsJs = await import(jsPath('core/search/grep-path-globs.js'));
const SRC_OPTS = { dot: true, nocomment: true, nonegate: true, platform: 'linux', optimizationLevel: 2 };

const hex = (bits) => {
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 1) | (bits[i + j] ? 1 : 0);
    out += n.toString(16);
  }
  return out;
};

// --- 1. minimatch, fuzzed -----------------------------------------------------------------
const rnd = mulberry32(1234);
const PAT_PIECES = ['*', '*', '**', '?', 'a', 'b', 'a', '.', '/', '/', '[ab]', '[!a]', '[a-c]', '[^b]', '{a,b}', '{,x}', '\\*',
  '\\', 'x', 'é', '😀', '[]', '[', ']', '-', ',', '{', '}', '!', '[\\]]', '[z-a]', '{1..3}', '{a..c}', '(', ')', '|', '#',
  '$', '^', ' ', '\\|', '..', '[.]', '[a-]', '[-a]', '[\\^-b]', '{a,{b,c}}', '{}', '{x}', '*.', '.*', '?.b', '+(a)', '[[:alpha:]]',
  'ab', '\n', '[\n]', 'A', '[A-Z]', '{Z..a}', '{01..3}', '{a..e..2}', '$\\{x}', '@', '[é]', '[😀]'];
const PATH_PIECES = ['a', 'b', '.', '..', 'x', 'é', '😀', '[', '*', 'ab', '.a', 'a.b', 'b.a', 'A', 'aa', 'a b', '-', '\n', 'xa', '{a}', '1', '01', '|'];
const PATHS = new Set(['a', 'b', 'a/b', 'a/b/c', '.a', 'a/.b', 'x/a.b', 'é', '😀', 'a/😀', '', '.', '..', 'a/..', 'a/../b', '../a',
  '*', '[', '[ab]', 'a//b', 'a/', '/a', '{a}', 'a,b', '!a', 'Z', '[', '\\', '_', '^', '`', 'a|b', '#', '$', 'a\nb', '\n']);
while (PATHS.size < 140) {
  const n = 1 + (rnd() % 4);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + (rnd() % 2);
    let s = '';
    for (let j = 0; j < k; j++) s += PATH_PIECES[rnd() % PATH_PIECES.length];
    segs.push(s);
  }
  PATHS.add(segs.join('/'));
}
const paths = [...PATHS];
const pats = new Set(['*', '**', '*.h', '*.{h,c}', 'a/**', '**/a', '**/a/**', 'a/**/b', 'a/**/b/**/c', '?', '??', '??.b', '*.*', '.*',
  '[ab]', 'a/*', '*/b', '**/*.b', 'a/**/*', '**/..', 'a/../b', './a', 'a/./b', '{a,b}/**', 'x/{a,b}.b', '[!a]*', '[^a]', '\\*',
  'a\\', '[]a]', '[z-a]', '{1..3}', '{a..c}', '{Z..a}', '+(a)', '[[:alpha:]]', 'a/**/..', '**/../a/b', '**/**/a', '{}', '{,}', '{x}',
  'a{,/**}', '{a,b}{c,d}', '$\\{x}', 'a\\|b', '*\\|b', '\\[a]', '[\\^-b]', '[\\]]', '[a-]', '[-a]', '[é]', '[😀]', '😀*', '*😀',
  '?😀', '*.é', '[.]*', '.[a]', '\\.*', '\\.\\.[a]', '#a', '!a', '!(a)', '*(a)', '@(a)', '?(a)', '(a|b)', 'a|b', 'a/b/', '/a',
  '//a', 'a//b']);
while (pats.size < 1400) {
  const n = 1 + (rnd() % 5);
  let s = '';
  for (let i = 0; i < n; i++) s += PAT_PIECES[rnd() % PAT_PIECES.length];
  pats.add(s);
}
// a second batch from pieces the port never declines, so most patterns are compared
const SAFE_PIECES = ['*', '*', '**', '?', 'a', 'b', '.', '/', '/', '[ab]', '[!a]', '[a-c]', '[^b]', '{a,b}', '{,x}', '\\*', 'x',
  'é', '😀', '[]', '[', ']', '-', ',', '{', '}', '!', '[z-a]', '{1..3}', '{a..c}', '(', ')', '#', '$', '^', ' ', '..', '[.]',
  '[a-]', '[-a]', '{a,{b,c}}', '{}', '{x}', '*.', '.*', '?.b', 'ab', '[A-Z]', '{Z..a}', '{01..3}', '[é]', '[😀]', '|', '\\a'];
const safe = new Set();
while (safe.size < 700) {
  const n = 1 + (rnd() % 5);
  let s = '';
  for (let i = 0; i < n; i++) s += SAFE_PIECES[rnd() % SAFE_PIECES.length];
  if (!pats.has(s)) safe.add(s);
}
for (const p of safe) pats.add(p);
const mmCases = [];
for (const p of pats) {
  let mm;
  try { mm = new Minimatch(p, SRC_OPTS); } catch (e) { mmCases.push([p, 'throw']); continue; }
  const bits = [];
  let threw = false;
  for (const f of paths) {
    try { bits.push(mm.match(f)); } catch { threw = true; break; }
  }
  mmCases.push([p, threw ? 'throw' : hex(bits)]);
}
writeFixture('globs', 'minimatch', { paths, cases: mmCases });

// --- 2. compilePathGlobs: corpus globs against real files -----------------------------------
const SYN_GLOB_LISTS = [['*.h'], ['!*.h'], ['!tests'], ['!tests/'], ['tests'], ['lib/*'], ['lib/**'], ['lib/sequel/model*'],
  ['!lib/tests/**'], ['/top.h'], ['./src/*'], ['src/*', '!src/m.h'], ['!src/**', 'src/m.h'], ['*.h', '!.hidden/'],
  ['lib', '!lib/tests'], ['**/tests/**'], ['!**/tests/**', '*.go'], ['{lib,src}/**'], ['!{lib,src}'], ['lib/sr?'], ['!', '/'],
  [''], ['!*'], ['*'], ['**'], ['!**'], ['x/'], ['lib/'], ['src/sub'], ['sub'], ['*_test.go'], ['!*_test.go', 'lib'],
  ['vendor', 'lib/tests'], ['!vendor/x'], ['src\\/sub'], ['[sl]*/**'], ['l?b'], ['!x/../lib/**'], ['é/*'], ['*.txt', 'docs']];
const SYN_FILES = ['top.h', '.hidden/z.h', 'lib/top.h', 'lib/tests/a.go', 'lib/src/b.go', 'lib/sequel/model.rb',
  'lib/sequel/model/base.rb', 'lib/sequel/models.rb', 'src/m.h', 'src/sub/a.rs', 'src/tests/x.rs', 'tests/t.rs',
  'vendor/x/src/c.c', 'docs/readme.md', 'é/ü.txt', 'a_test.go', 'x/a_test.go', 'src//sub/a.rs', './src/m.h', 'src\\sub\\b.rs', '',
  '.', 'lib', 'x/lib/tests/k.go', 'srcx/m.h', 'lib/../x', 'dir with space/f.txt', 'lib/sr/q.go', 'sub/a', 'x/sub/b'];
function runList(list, files) {
  const compiled = globsJs.compilePathGlobs(list);
  if (!compiled) return null;
  const bits = files.map((f) => compiled.matches(f));
  return [bits, [...compiled.dirsMatched]];
}
const synCases = [];
for (const list of SYN_GLOB_LISTS) {
  let r;
  try { r = runList(list, SYN_FILES); } catch (e) { synCases.push([list, 'throw']); continue; }
  synCases.push([list, r ? r[0] : null, r ? r[1] : null]);
}
// filterMatchesByPathGlobs, with and without totals
const MATCHES = SYN_FILES.flatMap((f, i) => Array.from({ length: 1 + (i % 3) }, (_, k) => ({ file: f, line: k + 1 })));
const TOTALS = new Map(SYN_FILES.map((f, i) => [f, i % 4 === 0 ? undefined : 10 + i]).filter(([, v]) => v !== undefined));
const filterCases = [];
for (const list of SYN_GLOB_LISTS.slice(0, 20)) {
  const compiled = globsJs.compilePathGlobs(list);
  const a = globsJs.filterMatchesByPathGlobs(MATCHES, compiled);
  const b = globsJs.filterMatchesByPathGlobs(MATCHES, globsJs.compilePathGlobs(list), TOTALS);
  filterCases.push([list, a.kept.map((m) => MATCHES.indexOf(m)), a.excludedMatches, a.excludedFiles,
    b.kept.map((m) => MATCHES.indexOf(m)), b.excludedMatches, b.excludedFiles]);
}
const hasCases = [[[], false], [[''], false], [['', 'x'], true], [['x'], true]].map(([g, _]) => [g, globsJs.hasPathGlobs(g)]);
writeFixture('globs', 'synthetic', {
  files: SYN_FILES, cases: synCases,
  matches: MATCHES.map((m) => m.file), totals: Object.fromEntries(TOTALS), filterCases, hasCases,
});

for (const repo of REPOS) {
  const root = path.join(REPOS_DIR, repo);
  const all = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
  const calls = readJsonl(path.join(CORPUS, `${repo}.calls.jsonl`));
  const lists = new Map();
  for (const c of calls) {
    const g = [];
    for (let i = 0; i < c.args.length; i++) if (c.args[i] === '-g' && c.args[i + 1] != null) g.push(c.args[i + 1]);
    if (g.length) lists.set(JSON.stringify([...new Set(g)]), [...new Set(g)]);
  }
  // files: random sample plus, per glob, files that share its literal parts
  const r = mulberry32(99);
  const files = new Set();
  for (let k = 0; k < 250; k++) files.add(all[r() % all.length]);
  for (const list of lists.values()) {
    for (const g of list) {
      const lit = g.replace(/^!/, '').split(/[*?[\]{}]/).filter((s) => s.length > 1);
      for (const l of lit) {
        const near = all.filter((p) => p.includes(l));
        for (let k = 0; k < 4 && near.length; k++) files.add(near[r() % near.length]);
      }
    }
  }
  const fileList = [...files];
  const cases = [];
  for (const list of lists.values()) {
    const res = runList(list, fileList);
    cases.push([list, res ? hex(res[0]) : null, res ? res[1] : null]);
  }
  writeFixture('globs', `corpus_${repo}`, { files: fileList, cases });
}
console.log('ok', mmCases.filter((c) => c[1] === 'throw').length, 'throws');
