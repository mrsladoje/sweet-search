// Fixtures for src/literals.rs: extractLiteralClauses / prefilterLiteralClauses of
// core/search/search-pattern-prefilter.js on every bench pattern (args[0] and the parsed
// positional of each corpus call) in the forms buildGrepPattern sends (raw, -i, -w, -F), with the
// fixedString option and with forceHeuristic, plus synthetic alternations; and hasAlternation,
// expandAlternatives and extractRequiredLiteralsHeuristic directly on the synthetic set.
//
// The native extractor's answer to every string it is called with is recorded (the addon's
// require-cache entry is wrapped before the JS loads it), and the Rust test replays it.
import path from 'node:path';
import { createRequire } from 'node:module';
import { CORPUS, REPOS, jsPath, readJsonl, writeFixture } from './_common.mjs';

const require = createRequire(import.meta.url);
const resolver = await import(jsPath('core/infrastructure/native-resolver.js'));
const validate = (m) => typeof m.buildSparseGramIndex === 'function'
  && typeof m.NativeSparseGramIndex?.load === 'function'
  && typeof m.extractRegexLiterals === 'function';
const loaded = resolver.loadNativeAddon({ validate });
if (!loaded) throw new Error('native addon not found');
const key = Object.keys(require.cache).find((k) => require.cache[k].exports === loaded.mod);
if (!key) throw new Error('addon not in the require cache');
const NATIVE = new Map();
const wrapper = Object.create(loaded.mod);
wrapper.extractRegexLiterals = (regex) => {
  try {
    const r = loaded.mod.extractRegexLiterals(regex);
    NATIVE.set(regex, r?.clauses ?? null);
    return r;
  } catch (e) {
    NATIVE.set(regex, 'throw');
    throw e;
  }
};
require.cache[key].exports = wrapper;

const pf = await import(jsPath('core/search/search-pattern-prefilter.js'));
const argparse = await import(jsPath('eval/agent-read-workflows/bin/_ss-argparse.mjs'));
pf.extractLiteralClauses('probe|x');   // the wrapper must be what the JS calls
if (!NATIVE.has('probe')) throw new Error('native extractor not intercepted');
NATIVE.clear();

// The positional pattern of an argument list (flags consumed as cmdGrep does, no paths).
function positional(args) {
  try {
    const a = argparse.normalizeArgs(args);
    argparse.parseBoolFlag(a, ['-i', '--ignore-case']);
    argparse.parseBoolFlag(a, ['-w', '--word-regexp']);
    argparse.parseBoolFlag(a, ['-F', '--fixed-strings']);
    argparse.parsePositiveIntFlag(a, ['-k', '--top'], 20);
    argparse.parseContextFlags(a);
    argparse.parseRepeatedValueFlag(a, '--in');
    argparse.parseGlobFlags(a);
    argparse.stripInertFlags(a);
    return argparse.extractPositional(a).pattern;
  } catch { return undefined; }
}

const patterns = new Set();
for (const repo of REPOS) {
  for (const c of readJsonl(path.join(CORPUS, `${repo}.calls.jsonl`))) {
    if (typeof c.args[0] === 'string') patterns.add(c.args[0]);
    const p = positional(c.args);
    if (typeof p === 'string') patterns.add(p);
  }
}
const SYNTHETIC = [
  'a.b|cde', '_color|_.*,', 'foo|bar', 'foo|ba', '(foo|bar)baz', '(?:foo|bar)baz', 'x(foo|bar)+', '(foo|bar)?baz',
  '(?:foo|bar){2}', '(?:foo){2}|barbaz', '(?=foo|bar)bazz', '(?<n>foo|bar)', '(?P<n>foo)|barr', '(?i:foo|bar)', '(?i)foo|bar',
  '[a|b]cdef', '[|]abc|xyz', '\\|abcd', 'abc\\|def', 'abc||def', '|abc', 'abc|', '()', '(|)', '((a|b)|(c|d))xyz',
  '((foo|bar)(baz|qux))', 'a(b|c(d|e))f|ghi', 'foo|(bar', 'foo)|bar', '[abc|def', 'foo\\', 'foo|bar\\', '(?:a|b|c|d|e|f)(?:g|h|i|j|k|l)xyz',
  '(?:a|b|c|d|e|f)(?:g|h|i|j|k|l)(?:m|n)', 'a{2,3}|bcd', 'a{,3}|bcd', 'abc{2}|def', 'abc{x}|defg', 'abc{|def', '(abc){1}|d',
  '[]|]abc|def', '[^]|]abc|def', '\\(foo|bar\\)', 'foo\\.bar|baz\\.qux', '\\bfoo\\b|\\bbar\\b', '(?i)\\bfoo\\b', '\\b(?:express)\\b',
  '(?i)\\b(?:express)\\b', '\\broute', 'foo\\s+bar', 'foo bar', 'foo\\x20bar', 'foo\\u{20}bar', 'foo\\p{L}bar', 'foo\\pLbar',
  'foo\\Qbar', 'foo\\1bar', 'foo\\xZZbar', 'foo\\b{start}bar', 'foo\\b{x}bar', 'foo\\B{x}', 'foo\\<bar\\>', '(?x)foo bar',
  '(?-x)foobar', '(?ix:foo)', '(?i-x:foobar)', 'fo+bar', 'foo?bar', 'foo*bar', 'f(oo)+bar', 'f(oo)*bar', 'foo{1}bar',
  'foo{1,1}bar', 'foo{0}bar', 'foo{01}bar', 'foo{2,}bar', 'foo{1,}?bar', 'foo{1}+bar', 'foo{2}{3}', 'foo+*', 'foo{ 2 }bar',
  'foo{,2}bar', 'foo{bar', 'foo{}bar', 'foo}bar', '*foo', '+foo', '?foo', '{2}foo', 'foo[abc]bar', 'foo[[:alpha:]]bar',
  'foo[[:alpha:]bar', 'foo[a[b]c]bar', 'foo[]]bar', 'foo[^]]bar', 'foo[\\]]bar', 'foo[', 'foo(bar', 'foo)bar', '(?<=foo)barbaz',
  '(?<!foo)barbaz', '(?!foo)barbaz', '(?#comment)foo', '(?', 'é字😀abc', 'abc😀?def', 'k8s_service|SESSION', 'σίσυφος|ßtraße',
  'KKelvin', 'ſtrange', 'abc\tdef', ' abc ', 'abc\ndef', 'ab', 'abc', '.', '^abc$', 'a.b.c.d', 'foo\\.bar',
  '(((((x)))))yzw', `${'('.repeat(30)}abc${')'.repeat(30)}`, `${'(?:a|b)'.repeat(5)}cde`, `${'(?:a|b)'.repeat(6)}cde`,
  'a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z|aa|bb|cc|dd|ee|ff|gg', 'abc|abc', 'ab c|abc ',
];
for (const s of SYNTHETIC) patterns.add(s);

// variants: [regex, options] as cmdGrep / the server send them
function variants(p) {
  return [
    [p, {}],
    [argparse.buildGrepPattern(p, { ignoreCase: true }), {}],
    [argparse.buildGrepPattern(p, { wordBound: true }), {}],
    [argparse.buildGrepPattern(p, { fixedString: true }), {}],
    [p, { fixedString: true }],
    [p, { forceHeuristic: true }],
  ];
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A result holding a lone surrogate half (the JS cuts `😀?` in two) is one the port declines:
// it is stored as the marker 'lone' (JSON with lone surrogates does not round-trip anyway).
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const hasLone = (v) => (typeof v === 'string' ? LONE.test(v) : Array.isArray(v) ? v.some(hasLone)
  : (v && typeof v === 'object') ? Object.values(v).some(hasLone) : false);
const cases = [];
for (const p of patterns) {
  const row = [p];
  for (const [regex, opts] of variants(p)) {
    let plan;
    try { plan = pf.extractLiteralClauses(regex, opts); } catch (e) { row.push(['throw']); continue; }
    const ci = pf.hasCaseInsensitiveRegexFlag(regex);
    const pre = pf.prefilterLiteralClauses(plan.clauses, { caseInsensitive: ci });
    if (!same(pre.rg, plan.clauses)) throw new Error('rg differs from the clauses');
    // ascii / gram stored only when they differ from the level above (1 = same)
    if (hasLone([plan.clauses, pre])) { row.push(['lone']); continue; }
    const v = [plan.clauses, plan.source, same(pre.ascii, plan.clauses) ? 1 : pre.ascii, same(pre.gram, pre.ascii) ? 1 : pre.gram];
    // a result equal to an earlier variant of the row is stored as that variant's index
    const earlier = row.slice(1).findIndex((x) => Array.isArray(x) && same(x, v));
    row.push(earlier !== -1 ? earlier : v);
  }
  cases.push(row);
}
// direct functions on the synthetic set (plus the case-insensitive split of their clauses)
const direct = SYNTHETIC.map((s) => {
  let heur;
  try { heur = pf.extractRequiredLiteralsHeuristic(s); } catch { heur = 'throw'; }
  const exp = pf.expandAlternatives(s);
  const plan = pf.extractLiteralClauses(s);
  const pre = pf.prefilterLiteralClauses(plan.clauses, { caseInsensitive: true });
  return [s, pf.hasAlternation(s), hasLone(exp) ? 'lone' : exp, hasLone(heur) ? 'lone' : heur, hasLone(pre) ? null : pre];
});
// native answers: 0 = [], 1 = [[the string itself]], else the clauses (or 'throw' / null)
const native = {};
for (const [k, v] of NATIVE) {
  if (hasLone(k) || hasLone(v)) throw new Error(`lone surrogate in a native call: ${JSON.stringify(k)}`);
  native[k] = (Array.isArray(v) && v.length === 0) ? 0 : (same(v, [[k]]) ? 1 : v);
}
writeFixture('literals', 'literals', { native, cases, direct });
console.log('ok', cases.length, 'patterns,', NATIVE.size, 'native answers');
