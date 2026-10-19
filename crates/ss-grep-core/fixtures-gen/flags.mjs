// Fixtures for grep's agent forms in src/args.rs and src/render.rs: translateBreAlternation,
// normalizeArgs with ss-grep's bundle letters, unsupportedGrepOption, and the -l / -c / -o
// renderers, run from the real JS of THIS checkout (no corpus needed).
// Usage: node fixtures-gen/flags.mjs
import path from 'node:path';
import { CRATE, mulberry32, writeFixture } from './_common.mjs';

const ROOT = path.resolve(CRATE, '../..');
const argparse = await import(path.join(ROOT, 'eval/agent-read-workflows/bin/_ss-argparse.mjs'));
const shaping = await import(path.join(ROOT, 'core/search/grep-output-shaping.js'));

// --- translateBreAlternation: hand cases, then fuzzed strings over the characters it reads
const BRE = [
  'func New\\|func Default', 'def foo\\|class Bar', 'foo(\\|bar{', '\\(a\\|b\\)\\{2\\}', '*x\\|^*y', 'a|b\\|c',
  '[|]\\|x', '[[:alpha:]]\\|z', '[]a]\\|b', '[^]a]\\|b', '[a\\|b', 'plain', 'a\\', '\\\\|b', 'a\\\\\\|b', 'LL \\|\\s+\\w+',
  '\\<foo\\>\\|bar', 'x\\|', '\\|', '\\|\\|', 'é\\|😀', '\\😀\\|a', '[[:x\\|y', 'a\\.b\\|c?d+', '^\\|$', 'a{1,2}\\|b',
  '\\(\\*a\\|b\\)', '^*\\|x', '[[.a.]]\\|b', '[[=e=]]\\|f', 'a[\\]\\|b', '',
];
const r = mulberry32(4242);
const ALPHA = ['\\', '\\', '|', '(', ')', '{', '}', '+', '?', '*', '^', '[', ']', ':', '.', '=', 'a', 'b', 'é', '😀', ' '];
for (let i = 0; i < 3000; i++) {
  const n = 1 + (r() % 12);
  let s = '';
  for (let j = 0; j < n; j++) s += ALPHA[r() % ALPHA.length];
  if (!s.includes('\\|') && r() % 2) s += '\\|x';
  BRE.push(s);
}
const translate = BRE.map((p) => [p, argparse.translateBreAlternation(p)]);

// --- normalizeArgs with GREP_BOOL_SHORTS (and the default set, for contrast)
const NORM = [
  ['-rn', 'x', '.'], ['-rl', 'x'], ['-rnE', 'a|b'], ['-lc', 'x'], ['-co', 'x'], ['-rniw', 'x'], ['-rnC2', 'x'], ['-rnA', '3', 'x'],
  ['-Error'], ['-only'], ['-rv', 'x'], ['-rh', 'x'], ['-HnR', 'x'], ['-lk5', 'x'], ['-onA.*', 'x'], ['-E', 'x'], ['-iwFk3', 'x'],
  ['--', '-rn'], ['-rn\n', 'x'], ['-rnx', 'p'], ['-l'], ['-c'], ['-nrE'],
];
const normalize = NORM.map((args) => [args, argparse.normalizeArgs([...args], { boolShorts: argparse.GREP_BOOL_SHORTS }), argparse.normalizeArgs([...args])]);

// --- unsupportedGrepOption
const UNSUP = [['-v', 'x'], ['x', '-m', '2'], ['--', '-v'], ['-L', 'x', '-q'], ['x'], ['--quiet', 'x'], ['-P'], ['x', '--', '-h']];
const unsupported = UNSUP.map((args) => [args, argparse.unsupportedGrepOption(args)?.flag ?? null]);

// --- renderers
const F = (file, total) => ({ file, total, kept: 1 });
const FILES = [
  [], [F('a.go', 3)], [F('src/b.rs', 1), F('a.go', 12), F('tests/t.py', 2)],
  Array.from({ length: 25 }, (_, i) => F(`d${i % 7}/f${i}.js`, i + 1)),
];
const lists = [];
for (const files of FILES) {
  for (const k of [1, 2, 20]) {
    for (const extra of [0, 3]) {
      lists.push([files, k, files.length + extra,
        shaping.renderGrepFileList(files, k, files.length + extra), shaping.renderGrepFileCounts(files, k, files.length + extra)]);
    }
  }
}
const ROWS = [
  [['a.go', 3, ['New', 'Default']], ['a.go', 9, []], ['b/a.go', 1, ['x']]],
  [['src/x.rs', 2, ['fn']], ['src/y.rs', 4, ['fn', 'fn']]],
  [['only.py', 7, []]],
];
const TYPED = [[], ['a.go'], ['a.go', 'b/a.go'], ['src/x.rs']];
const only = [];
for (const rows of ROWS) {
  for (const typed of TYPED) {
    const objs = rows.map(([file, line, ms]) => ({ file, line, ms }));
    only.push([rows, typed, shaping.renderGrepOnlyMatching(objs, (row) => row.ms, { typed })]);
  }
}

console.log(writeFixture('flags', 'pure', { translate, normalize, unsupported, lists, only }));
