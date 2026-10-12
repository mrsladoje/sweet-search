// Fixtures for src/args.rs: the argument part of cmdGrep, run from the REAL source text of
// _ss-helpers.mjs (the helper functions and the start of cmdGrep are cut out of the file and
// evaluated with the real imports), on the 1,600 corpus argument lists from the repository
// root, from a subdirectory, and from a subdirectory with the --in paths typed relative to it,
// plus synthetic edge cases. Usage: node fixtures-gen/args.mjs <synthetic repo dir>
import fs from 'node:fs';
import path from 'node:path';
import {
  CORPUS, REPOS, REPOS_DIR, jsPath, readJsonl, resetProbe, takeProbe, writeFixture,
} from './_common.mjs';

const argparse = await import(jsPath('eval/agent-read-workflows/bin/_ss-argparse.mjs'));
const cwdPaths = await import(jsPath('core/search/cwd-paths.js'));
const prefilter = await import(jsPath('core/search/search-pattern-prefilter.js'));

const SRC = fs.readFileSync(jsPath('eval/agent-read-workflows/bin/_ss-helpers.mjs'), 'utf8');

function cutFunction(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  if (start === -1) throw new Error(`no function ${name}`);
  const end = SRC.indexOf('\n}\n', start);
  return SRC.slice(start + 1, end + 3);
}
function cutGrepPrefix() {
  const head = 'async function cmdGrep(rawArgs, { fromFind = false } = {}) {\n';
  const start = SRC.indexOf(head);
  const end = SRC.indexOf('\n  // SS_FIX_GREP_RETRY', start);
  if (start === -1 || end === -1) throw new Error('cmdGrep prefix not found');
  return SRC.slice(start + head.length, end);
}

const HELPERS = ['failUsage', 'resolvePositional', 'readPositiveIntFlag', 'readValueFlag', 'readRepeatedValueFlag',
  'rejectExtraPositionals', 'cwdPath', 'resolveScopePaths', 'readGlobFlags', 'absorbPositionalPaths'];
const GREP_USAGE_SRC = SRC.slice(SRC.indexOf('const GREP_USAGE ='), SRC.indexOf(';\n', SRC.indexOf('const GREP_USAGE =')) + 2);

class UsageExit extends Error {}
let CURRENT_CWD = '/';
const fakeProcess = {
  cwd: () => CURRENT_CWD,
  stderr: { write() {} },
  exit(code) { throw new UsageExit(String(code)); },
};

const body = `${GREP_USAGE_SRC}\n${HELPERS.map(cutFunction).join('\n')}\n`
  + `return async function cmdGrepArgs(rawArgs, { fromFind = false } = {}) {\n${cutGrepPrefix()}\n`
  + `  return { ignoreCase, wordBound, fixedString, k, before: context.before, after: context.after, inPaths, globs, rawPattern, regex };\n};\n`;
const injected = {
  ...argparse,
  absorbPositionalPathsPure: argparse.absorbPositionalPaths,
  resolveCwdPath: cwdPaths.resolveCwdPath,
  resolveCwdGlob: cwdPaths.resolveCwdGlob,
  existsSync: fs.existsSync,
  path,
  process: fakeProcess,
};
let FILE_ROOT = '/';
const names = Object.keys(injected).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
const factory = new Function(...names, 'getRoot', body.replaceAll('FILE_ROOT', 'getRoot()'));
const cmdGrepArgs = factory(...names.map((n) => injected[n]), () => FILE_ROOT);

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
// Compact form: every string has the root spellings replaced by $R / $T (the Rust test puts
// them back); a case is [args, cwd, expect], expect = a decline reason string or
// [ignoreCase, wordBound, fixedString, k, before, after, inPaths, globs, rawPattern, regex].
function sub(v, roots) {
  if (typeof v === 'string') { let s = v; for (const [tok, r] of roots) s = s.split(r).join(tok); return s; }
  if (Array.isArray(v)) return v.map((x) => sub(x, roots));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [sub(k, roots), sub(x, roots)]));
  return v;
}
function assertNoPlaceholder(v) {
  if (typeof v === 'string' && /\$[RT]/.test(v)) throw new Error(`input holds a placeholder: ${v}`);
  if (Array.isArray(v)) v.forEach(assertNoPlaceholder);
}
function compactCase(c, roots) {
  assertNoPlaceholder(c.args);
  const e = c.expect;
  // rawPattern as the index of the argument it equals; regex as true when it equals rawPattern
  const rawAt = e.decline ? -1 : c.args.indexOf(e.rawPattern);
  const ex = e.decline ? e.decline : [e.ignoreCase, e.wordBound, e.fixedString, e.k, e.before, e.after, e.inPaths, e.globs,
    rawAt !== -1 ? rawAt : e.rawPattern, e.regex === e.rawPattern ? true : e.regex];
  const out = [c.args, c.cwd, ex];
  if (c.root) out.push(c.root);
  return sub(out, roots);
}
async function run(args, cwd, root) {
  CURRENT_CWD = cwd;
  FILE_ROOT = root;
  try {
    const r = await cmdGrepArgs([...args]);
    if (r.k > MAX_SAFE || r.before > MAX_SAFE || r.after > MAX_SAFE) return { decline: 'bigcount' };
    return r;
  } catch (e) {
    if (e instanceof UsageExit) return { decline: 'usage' };
    return { decline: `throw: ${e.message}` };
  }
}

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

const stats = { cases: 0, declines: 0 };
for (const repo of REPOS) {
  const root = path.join(REPOS_DIR, repo);
  const calls = readJsonl(path.join(CORPUS, `${repo}.calls.jsonl`));
  const topDirs = fs.readdirSync(root).filter((d) => !d.startsWith('.') && isDir(path.join(root, d))).sort();
  resetProbe();
  const cases = [];
  for (const [n, call] of calls.entries()) {
    const args = call.args;
    cases.push({ args, cwd: root, expect: await run(args, root, root) });
    const inAt = args.indexOf('--in');
    const firstIn = inAt !== -1 ? args[inAt + 1] : null;
    const segs = typeof firstIn === 'string' ? firstIn.split('/').filter(Boolean) : [];
    const sub = segs.length >= 2 && isDir(path.join(root, segs[0])) ? segs[0] : topDirs[n % topDirs.length];
    if (sub) {
      const cwd = path.join(root, sub);
      // (every fourth call, to keep the fixture small)
      if (n % 4 === 0) cases.push({ args, cwd, expect: await run(args, cwd, root) });
      if (segs.length >= 2 && sub === segs[0]) {
        // as typed from the subdirectory: --in values (and -g globs) relative to it
        const rel = args.map((a, i) => (i > 0 && (args[i - 1] === '--in' || args[i - 1] === '-g') && a.startsWith(`${sub}/`)) ? a.slice(sub.length + 1) : a);
        cases.push({ args: rel, cwd, expect: await run(rel, cwd, root) });
        // two levels down, when the scope has three segments
        if (segs.length >= 3 && isDir(path.join(root, segs[0], segs[1]))) {
          const cwd2 = path.join(root, segs[0], segs[1]);
          cases.push({ args, cwd: cwd2, expect: await run(args, cwd2, root) });
        }
      }
    }
  }
  for (const c of cases) { stats.cases++; if (c.expect.decline) stats.declines++; }
  const roots = [['$R', root]];
  writeFixture('args', repo, { R: root, probe: sub(takeProbe(), roots), cases: cases.map((c) => compactCase(c, roots)) });
}

// --- synthetic edge cases ----------------------------------------------------------------
const synDir = process.argv[2];
if (!synDir) throw new Error('usage: node fixtures-gen/args.mjs <synthetic repo dir>');
const synReal = fs.realpathSync(synDir);
const synTmp = synReal.replace(/^\/private\/tmp\//, '/tmp/');
const A = [
  ['-iwk5', 'foo'], ['-A3', 'x'], ['-A', '3', 'x'], ['-Ax', 'pat'], ['-A.*foo'], ['-C++'], ['--in=', 'x'], ['-g!x', 'p'],
  ["-g'!x'", 'p'], ['--', '-foo'], ['-?\\d+'], ['-->'], ['--foo', 'x'], ['-k', '0', 'x'], ['-k', '1e3', 'x'],
  ['-k', '0x14', 'x'], ['-k', ' 7 ', 'x'], ['-k', '9007199254740993', 'x'], ['-k', '9007199254740991', 'x'],
  ['-k', '5.0', 'x'], ['-k', '5.5', 'x'], ['-k', '+5', 'x'], ['-k', '.5e1', 'x'], ['-k', '5.', 'x'], ['-k', 'Infinity', 'x'],
  ['-k', '0b11', 'x'], ['-k', '0o17', 'x'], ['-k', '1_0', 'x'], ['-k', '', 'x'], ['-k', ' 7 ', 'x'], ['-k', '-5', 'x'],
  ['-C', '2', '-A', '5', 'x'], ['--context=3', 'x'], ['-iC2', 'x'], ['-iA', 'x'], ['-iA', '4', 'x'], ['-wiF', 'a.b'],
  ['-F', '-w', '-i', 'a+b'], ['-i', '(?i)foo'], ['-i', '(?s-i:x)'], ['-i', '(?x)'], ['-i', '(?I)x'], ['-i', '(?-i)x'],
  ['x', 'y'], ['x', 'src'], ['x', 'src', 'src'], ['x', '--in', 'src', 'src'], ['x', `${synReal}/src`], ['x', `${synTmp}/docs`],
  ['é', '--in', 'é'], ['😀', '--in', 'dir with space'], [''], [], ['-n', '-r', '--color=always', 'pat'], ['--colour=never', '-H', 'p'],
  ['--include', '*.h', '--exclude', '*.c', '--exclude-dir', 'build/', 'p'], ['--exclude-dir', '.', 'p'], ['--exclude-dir', '//', 'p'],
  ['-g', '!', 'p'], ['-g', '/', 'p'], ['-g', '!//', 'p'], ['-g', '--', 'p'], ['-g'], ['--in'], ['-k'], ['-k', '-i', 'x'],
  ['--top', '5', 'x'], ['--top=5', 'x'], ['-k5', '-k6', 'x'], ['pat', '--in', 'a', '--in', 'b', '--in', 'a'],
  ['pat', '--', '--in', 'x'], ['--', 'a', 'src'], ['--', 'a', 'b'], ['-gfoo\n*', 'x'], ['--in=a\nb', 'x'], ['--in=src', 'x'],
  ['-i\n', 'x'], ['-ix', 'p'], ['-Ffoo'], ['-k5x', 'p'], ['-C', '007', 'x'], ['-A', '99999999999999999999', 'x'],
  ['-g', 'tests/**', 'x'], ['-g', './x/*', 'x'], ['-g', `${synReal}/src/**`, 'x'], ['-g', `!${synTmp}/lib/**`, 'x'],
  ['-g', `${synReal}`, 'x'], ['-g', '../src/**', 'x'], ['-g', '../../**', 'x'], ['-g', '**/x', 'x'], ['-g', '!*.h', 'x'],
  ['-g', 'lib/tests/**', 'x'], ['-g', 'sub/*', 'x'], ['-g', '!sub/', 'x'], ['-g', 'tests', 'x'], ['-g', '*.{h,c}', 'x'],
  ['-g', 'nope/x/*', 'x'], ['-g', '/sub/**', 'x'], ['-g', './/sub', 'x'], ['-g', 'a/./b/*', 'x'], ['-g', '[s]ub/*', 'x'],
  ['-g*.h', '-g', '*.h', 'x'], ['-gzip', 'x'], ['-g.x', 'p'], ['--glob=*.rs', 'p'], ['--include=*.rs', 'p'],
  ['--exclude=*.rs', 'p'], ['--exclude-dir=tests', 'p'], ['--exclude-dir', 'tests///', 'p'],
  ['x', 'lib.rs'], ['x', 'sub'], ['x', 'sub/a.rs', '--in', 'sub/a.rs'], ['x', '../tests'], ['x', '../../etc'], ['x', 'link'],
  ['x', 'dangling'], ['x', 'tests\\t.rs'], ['x', './sub/'], ['x', '.'], ['x', ''], ['x', '--in', '.'], ['x', '--in', './'],
  ['x', '--in', '/'], ['x', '--in', 'sub', '--in', 'src/sub'], ['-w', '(?i)a'], ['-F', '(?i)a', '-i'], ['-iF', '$x^'],
  ['--ignore-case', '--word-regexp', '--fixed-strings', 'a|b'], ['--', '-i'], ['-i', '--', '-w'], ['-k', '3', '--', '-k'],
  ['x', '-n', 'src'], ['--recursive', 'x', 'tests'], ['-R', 'x', '-H', 'docs', '--no-filename'], ['--line-number', 'x'],
  ['-C', '1', '--in', 'src', '-A', '2', '-B', '0', 'x'], ['--before-context=2', '--after-context', '3', 'x'],
  ['--after-context', 'x', 'y'], ['-B'], ['-iwFk3', 'x'], ['-iwFC3', 'x'], ['-iwFC', 'x'], ['-wk', '3', 'x'],
  ['-kx'], ['-K5', 'x'], ['-I', 'x'], ['--Top', '5', 'x'], ['--top=', 'x'], ['--glob=', 'x'], ['--in', '--', 'x'],
  ['--in', '-n', 'x'], ['--in', '-?', 'x'], ['--in', '---', 'x'], ['--x=a\nb', 'p'], ['--9', 'p'], ['-9', 'p'], ['-é', 'p'],
  ['-', 'p'], ['p', '-'], ['p', '--'], ['--', '--'], ['--', '--', 'x'], ['-g', '**', 'x'], ['-g', '!**', 'x'],
  ['x', 'src/../tests'], ['x', '--in', 'src/../tests'], ['x', '--in', '../src'], ['x', '--in', 'sub/../../tests'],
];
const SYN_CWDS = ['', 'src', 'src/sub', 'lib', 'é'];
resetProbe();
const cases = [];
for (const rootSpelling of [synReal, synTmp]) {
  for (const sub of SYN_CWDS) {
    for (const cwdSpelling of [synReal, synTmp]) {
      if (cwdSpelling !== rootSpelling && sub !== 'src') continue;
      const cwd = sub ? path.join(cwdSpelling, sub) : cwdSpelling;
      for (const args of A) cases.push({ args, cwd, root: rootSpelling, expect: await run(args, cwd, rootSpelling) });
    }
  }
}
// fuzzed argument lists from flag / value / path pieces, from several cwds
{
  const { mulberry32 } = await import('./_common.mjs');
  const r = mulberry32(5150);
  const P = ['-i', '-w', '-F', '-k', '5', '-k5', '-k0', '-A', '-B', '-C', '2', '-A2', '-C9', '-iw', '-iwk3', '-wC1', '-iAx',
    '--in', '--in', 'src', 'sub', 'src/sub', '.', './', 'lib.rs', 'sub/a.rs', '../tests', '../../x', 'tests', 'é', 'link',
    '-g', '-g', '*.rs', '!tests/**', 'sub/*', '!*.h', '/sub/**', './x/*', '-g!lib/**', '-g*.h', '--glob=*.h', '--include',
    '--exclude', '--exclude-dir', '--exclude-dir=build/', '--', '-n', '-r', '-H', '--color=auto', '--colour', 'pat', 'pat',
    'a|b', 'x', '-x', '--foo', '', '-?x', '-->', '--top', '0', '1e2', '0x10', '-C3x', '--context=2', '--in=src', '(?i)q', 'a b'];
  const CW = ['', 'src', 'src/sub', 'lib', 'link'];
  for (let i = 0; i < 1200; i++) {
    const n = 1 + (r() % 7);
    const args = [];
    for (let j = 0; j < n; j++) args.push(P[r() % P.length]);
    const sub = CW[r() % CW.length];
    const cwd = sub ? path.join(synReal, sub) : synReal;
    cases.push({ args, cwd, root: synReal, expect: await run(args, cwd, synReal) });
  }
}
// a cwd outside the root
for (const args of A.slice(0, 40)) cases.push({ args, cwd: '/usr', root: synReal, expect: await run(args, '/usr', synReal) });
for (const c of cases) { stats.cases++; if (c.expect.decline) stats.declines++; }
const synRoots = [['$R', synReal], ['$T', synTmp]];
writeFixture('args', 'synthetic', { R: synReal, T: synTmp, probe: sub(takeProbe(), synRoots), cases: cases.map((c) => compactCase(c, synRoots)) });

// --- pure helpers on synthetic tokens -----------------------------------------------------
const TOKS = [...new Set([...A.flat(), '-', '--', '-i', '-iw', '-C2', '--ignore-case', '--foo=bar', '--foo=a\nb', '-?\\d+', '-->',
  '--a', '--a-b_c', '--a=', '-a1b2', '-a_b', '-1', '--1', '---', '-ab-', '--é', '-x ', '(?i)', '(?im)x', '(?mi:x)', '(?-i)',
  '(?i', '(?ix', '(?i-', '((?i)', 'a(?i)', '(?:i)', '(?I:x)', '(?xi)', '(?--i--)', '( ?i)'])];
const NUMS = ['', ' ', '0', '1', '-0', '+0', '00', '0x', '0x1F', '0X1f', '-0x1', '0b', '0b102', '0o8', '0o17', '1e', '1e+', '1e-3',
  '1E3', '.', '.5', '5.', '+.5', '-.5e1', 'Infinity', '-Infinity', 'infinity', 'inf', 'NaN', '1_000', '1,000', '٣', '\t12\n',
  '  3 ﻿', '12abc', '0x' + 'f'.repeat(20), '9'.repeat(25), '1e400', '123456789012345678', '0.1e1', '1.5', '2.0000000000000001'];
const pure = {
  normalizeArgs: A.map((a) => argparse.normalizeArgs(a)),
  looksLikeOption: TOKS.map((t) => argparse.looksLikeOption(t)),
  inlineI: TOKS.map((t) => /^\(\?[a-z-]*i[a-z-]*[:)]/.test(t)),
  hasCaseInsensitiveRegexFlag: TOKS.map((t) => prefilter.hasCaseInsensitiveRegexFlag(t)),
  escapeRegex: TOKS.map((t) => argparse.escapeRegex(t)),
  numbers: NUMS.map((s) => { const n = Number(s); return Number.isNaN(n) ? 'NaN' : (Object.is(n, -0) ? '-0' : String(n)); }),
};
writeFixture('args', 'pure', { R: synReal, T: synTmp, ...sub({ toks: TOKS, nums: NUMS, argLists: A, ...pure }, synRoots) });
console.log(JSON.stringify(stats));
