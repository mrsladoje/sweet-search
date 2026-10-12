// Fixtures for src/paths.rs: Node path.posix (fuzzed), core/search/cwd-paths.js on a synthetic
// repository (two spellings of its root through the /tmp symlink, a symlinked directory, a
// dangling link, non-ASCII names) and the real bench repos, and the --in scope predicate of
// core/search/grep-output-shaping.js on the corpus --in values against real file lists.
// Usage: node fixtures-gen/paths.mjs <synthetic repo dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  CORPUS, REPOS, REPOS_DIR, jsPath, mulberry32, readJsonl, resetProbe, takeProbe, writeFixture,
} from './_common.mjs';

const cwdPaths = await import(jsPath('core/search/cwd-paths.js'));
const shaping = await import(jsPath('core/search/grep-output-shaping.js'));

function sub(v, roots) {
  if (typeof v === 'string') { let s = v; for (const [tok, r] of roots) s = s.split(r).join(tok); return s; }
  if (Array.isArray(v)) return v.map((x) => sub(x, roots));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [sub(k, roots), sub(x, roots)]));
  return v;
}
const hex = (bits) => {
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 1) | (bits[i + j] ? 1 : 0);
    out += n.toString(16);
  }
  return out;
};

// --- 1. Node path.posix fuzz ----------------------------------------------------------------
const rnd = mulberry32(42);
const PIECES = ['/', '/', '/', '.', '.', '..', 'a', 'b', 'é', '😀', ' ', '\\', 'abc'];
const randPath = () => {
  const n = rnd() % 9;
  let s = '';
  for (let i = 0; i < n; i++) s += PIECES[rnd() % PIECES.length];
  return s;
};
const nodePath = [];
for (let i = 0; i < 450; i++) {
  const a = randPath(); const b = randPath(); const c = randPath();
  nodePath.push([a, b, c,
    path.posix.normalize(a),
    path.posix.join(a, b, c),
    path.posix.resolve(a, b),
    path.posix.relative(a, b),
    path.posix.isAbsolute(a)]);
}
writeFixture('paths', 'nodepath', { cwd: process.cwd(), cases: nodePath });

// --- 2. cwd-paths on the synthetic repository -------------------------------------------------
const synDir = process.argv[2];
if (!synDir) throw new Error('usage: node fixtures-gen/paths.mjs <synthetic repo dir>');
const synReal = fs.realpathSync(synDir);
const synTmp = synReal.replace(/^\/private\/tmp\//, '/tmp/');
const ROOTS = [synReal, synTmp, `${synReal}/`, `${synTmp}//`, `${synReal}/src/..`, '/', ''];
const CWDS = (r) => [r, `${r}/src`, `${r}/src/sub`, `${r}/link`, `${r}/link/sub`, `${r}/é`, `${r}/dir with space`, `${r}/nope`,
  `${r}/src/`, '/usr', '/', `${r}/../`, `${r}x`];
const PS = ['lib.rs', 'sub', 'sub/a.rs', './sub/', '../tests', '../../etc', '../..', '..', '.', '', 'x', 'link', 'dangling',
  'tests\\t.rs', 'src/lib.rs', 'ü.txt', 'f.txt', 'a//b', 'sub/../main.rs', '/abs', `${synReal}/src`, 'tests/t.rs', 'top.h'];
const GLOBS = ['*.h', '!*.h', 'tests', '!tests', 'tests/', 'sub/*', '!sub/**', '**/x', '!**/x/*', './x/*', '/x/*', '!/sub/**',
  './/sub', './', '/', '!', '', 'a/b*', 'sub/a*', 'nope/x/*', 'tests/**', 'lib/tests/**', '../src/**', '../../**', '../../../x',
  `${synReal}/src/**`, `!${synTmp}/lib/**`, synReal, `${synReal}/`, `!${synReal}`, '[s]ub/*', 'sub/[a]/*', 's?b/*', '{sub,x}/*',
  'su\\b/*', 'a/./b/*', 'a/../b/*', './/', 'é/*', 'link/*', 'dangling/*', 'sub//a.rs', '**', '!**', 'sub/', 'sub///'];
resetProbe();
const cwdCases = [];
for (const root of ROOTS) {
  for (const cwd of CWDS(root || synReal)) {
    const offset = cwdPaths.cwdOffset({ cwd, root });
    const scope = cwdPaths.cwdGrepScope({ cwd, fileRoot: root, indexRoot: root });
    const scope2 = cwdPaths.cwdGrepScope({ cwd, fileRoot: root, indexRoot: synTmp });
    const paths = PS.map((p) => cwdPaths.resolveCwdPath(p, { cwd, root }));
    const globs = GLOBS.map((g) => cwdPaths.resolveCwdGlob(g, { cwd, root }));
    cwdCases.push([cwd, root, offset, scope, scope2, paths, globs]);
  }
}
const synRoots = [['$R', synReal], ['$T', synTmp]];
writeFixture('paths', 'cwd_synthetic', { R: synReal, T: synTmp, ...sub({ probe: takeProbe(), ps: PS, globs: GLOBS, cases: cwdCases }, synRoots) });

// --- 3. the --in scope predicate --------------------------------------------------------------
// Synthetic: odd scopes and files, several project-root spellings.
const SYN_FILTERS = [['.'], ['./'], ['/'], [''], [], ['..'], ['src/..'], ['src'], ['sub'], ['src/sub'], ['sub/a.rs'], ['a.rs'],
  ['./src/sub/'], ['src//sub'], ['src\\sub'], [`${synReal}/src`], [`${synTmp}/src`], [`${synReal}`], [`${synTmp}/`],
  ['/other/src'], [`${synReal}x/src`], ['C:/x/src'], ['c:\\x'], ['tests', 'lib'], ['nope', 'src/sub'], ['é'], ['ü.txt'],
  ['dir with space'], ['link'], ['link/sub'], ['vendor/x/src'], ['x/src'], ['src', 'src'], ['.', 'nope'], ['lib/tests/a.go']];
const SYN_FILES = ['', '.', './', 'src/lib.rs', 'src/sub/a.rs', './src/sub/a.rs', 'src//sub/a.rs', 'src\\sub\\a.rs', 'vendor/x/src/c.c',
  'lib/tests/a.go', 'lib/src/b.go', 'lib/top.h', 'tests/t.rs', 'top.h', 'é/ü.txt', 'dir with space/f.txt', 'link/lib.rs',
  'a.rs', 'xsrc/a', 'src', 'srcx/y', '/abs/src/a', 'C:/x/src/a', 'x/src/sub/a.rs', 'test_a.rs', 'sub', 'nested/src/a.js'];
const SYN_PROJECT_ROOTS = [synReal, synTmp, `${synReal}/`, null, '', 'relative/root', '/', `${synReal}/src`];
resetProbe();
const filterCases = [];
for (const pr of SYN_PROJECT_ROOTS) {
  for (const f of SYN_FILTERS) {
    const pred = shaping.grepFileFilterPredicate(f, pr);
    filterCases.push([f, pr, SYN_FILES.map((file) => pred(file))]);
  }
  // the single-string form
  for (const f of ['src', '', '.', `${synReal}/lib`]) {
    const pred = shaping.grepFileFilterPredicate(f, pr);
    filterCases.push([f, pr, SYN_FILES.map((file) => pred(file))]);
  }
}
writeFixture('paths', 'filter_synthetic', { R: synReal, T: synTmp, ...sub({ probe: takeProbe(), files: SYN_FILES, cases: filterCases }, synRoots) });

// Corpus: every distinct --in list of the 1,600 calls, against a file sample of the repo
// (files inside or next to each scope, plus random files).
for (const repo of REPOS) {
  const root = path.join(REPOS_DIR, repo);
  const all = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
  const calls = readJsonl(path.join(CORPUS, `${repo}.calls.jsonl`));
  const filters = new Map();
  for (const c of calls) {
    const ins = [];
    for (let i = 0; i < c.args.length; i++) if (c.args[i] === '--in' && c.args[i + 1] != null) ins.push(c.args[i + 1]);
    if (ins.length) filters.set(JSON.stringify([...new Set(ins)]), [...new Set(ins)]);
  }
  const r = mulberry32(7);
  const files = new Set();
  for (const f of filters.values()) {
    for (const scope of f) {
      const segs = scope.split('/').filter(Boolean);
      const needle = segs[segs.length - 1] || '';
      const near = all.filter((p) => p.includes(needle));
      for (let k = 0; k < 2 && near.length; k++) files.add(near[r() % near.length]);
    }
  }
  for (let k = 0; k < 90; k++) files.add(all[r() % all.length]);
  const fileList = [...files];
  resetProbe();
  const cases = [];
  for (const f of filters.values()) {
    const pred = shaping.grepFileFilterPredicate(f, root);
    cases.push([f, hex(fileList.map((file) => pred(file)))]);
  }
  writeFixture('paths', `filter_${repo}`, { R: root, ...sub({ probe: takeProbe(), files: fileList, cases }, [['$R', root]]) });
}
console.log('ok');
