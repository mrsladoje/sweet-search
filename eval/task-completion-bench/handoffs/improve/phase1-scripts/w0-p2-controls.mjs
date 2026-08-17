#!/usr/bin/env node
// SLATE-B W0 gate — P2: CONTROLS for the residue replay.
//
// The P1 gate's instrument was wrong five times and four of those errors pointed the
// same way, so every headline there had to be hand-checked before it could be
// believed. P2 is worse in one respect: its two halves fail in OPPOSITE directions.
//   - miss the Underscore twin  -> P2 dies on an instrument bug
//   - miss residue on solved cells -> P2 looks clean on an instrument bug
// A single-direction sanity check therefore cannot certify this replay. These controls
// pin both directions on inputs whose correct answer was established BY HAND from the
// base tree, before any code was written:
//
//   base underscore.js
//     448:    if (_.has(result, key)) result[key].push(value); else result[key] = [value];   <- groupBy, patched
//     461:    if (_.has(result, key)) result[key]++;           else result[key] = 1;         <- countBy, left alone
//
// Run: node w0-p2-controls.mjs      (exits non-zero on any failed control)
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { parsePatch, deriveStems, trimmedSpan, meaningfulStem, norm } from './w0-p2-residue-replay.mjs';

let pass = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok    ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

const GROUPBY_OLD = '    if (_.has(result, key)) result[key].push(value); else result[key] = [value];';
const GROUPBY_NEW = '    if (hasOwnProperty.call(result, key)) result[key].push(value); else result[key] = [value];';
const COUNTBY = '    if (_.has(result, key)) result[key]++; else result[key] = 1;';

const REAL_PATCH = [
  'diff --git a/underscore.js b/underscore.js',
  'index e4959b4..ba91c79 100644',
  '--- a/underscore.js',
  '+++ b/underscore.js',
  '@@ -445,7 +445,7 @@',
  '   _.groupBy = group(function(result, value, key) {',
  '-' + GROUPBY_OLD,
  '+' + GROUPBY_NEW,
  '   });',
].join('\n');

console.log('P2 replay controls\n');
console.log('-- SENSITIVITY: the instrument must find the twin it exists to find');

check('span stem is derived from the real claude sweet patch', () => {
  const stems = deriveStems(parsePatch(REAL_PATCH));
  assert.equal(stems.span.length, 1, `expected exactly 1 span stem, got ${stems.span.length}`);
});

check('span stem MATCHES the untouched countBy line', () => {
  const [s] = deriveStems(parsePatch(REAL_PATCH)).span;
  assert.ok(norm(COUNTBY).includes(s.stem),
    `stem ${JSON.stringify(s.stem)} does not occur in the countBy line`);
});

check('line-granular stem MISSES countBy (this is why the span exists)', () => {
  const stems = deriveStems(parsePatch(REAL_PATCH));
  const anyLineHit = stems.line.some(s => norm(COUNTBY).includes(s.stem));
  assert.equal(anyLineHit, false,
    'whole-line granularity matched countBy — the sub-line finding would be an artifact');
});

check('the derived stem is not so short it matches anything', () => {
  const [s] = deriveStems(parsePatch(REAL_PATCH)).span;
  assert.ok(s.stem.length >= 6, `stem too short: ${JSON.stringify(s.stem)}`);
  assert.ok(/_\.has/.test(s.stem), `stem lost the replaced call: ${JSON.stringify(s.stem)}`);
});

console.log('\n-- SPECIFICITY: the instrument must stay silent when there is nothing to say');

check('a stem the agent kept elsewhere in the patch is NOT reported', () => {
  const p = REAL_PATCH + '\n@@ -460,3 +460,3 @@\n-  x = 1;\n+  if (_.has(result, key)) keep();';
  const stems = deriveStems(parsePatch(p));
  assert.equal(stems.span.some(s => /_\.has\(result/.test(s.stem)), false,
    'reported a stem that the patch re-introduced in an added line');
});

check('a fully-replaced stem leaves no residue against the twin', () => {
  const both = [
    'diff --git a/underscore.js b/underscore.js',
    '@@ -445,7 +445,7 @@',
    '-' + GROUPBY_OLD,
    '+' + GROUPBY_NEW,
    '@@ -458,3 +458,3 @@',
    '-' + COUNTBY,
    '+    if (hasOwnProperty.call(result, key)) result[key]++; else result[key] = 1;',
  ].join('\n');
  const stems = deriveStems(parsePatch(both));
  // Both call sites are rewritten, so the post-edit tree holds no `_.has(result` at all.
  // The stems still derive; what must be true is that nothing survives to match them —
  // asserted here on the post-edit text rather than on stem count.
  const postEdit = [GROUPBY_NEW, '    if (hasOwnProperty.call(result, key)) result[key]++; else result[key] = 1;'].map(norm);
  const surviving = stems.span.filter(s => postEdit.some(l => l.includes(s.stem)));
  assert.equal(surviving.length, 0, `residue survived a complete replacement: ${JSON.stringify(surviving)}`);
});

check('trivial fragments are rejected before they can flood a report', () => {
  for (const junk of ['}', '  else', 'return', '});', 'end', '  if (', '#endif'])
    assert.equal(meaningfulStem(junk), false, `accepted junk stem ${JSON.stringify(junk)}`);
});

check('a real fragment is still accepted', () => {
  for (const good of ['_.has(result', 'resolver::query q(host_, port_)', 'self._excinfo'])
    assert.equal(meaningfulStem(good), true, `rejected real stem ${JSON.stringify(good)}`);
});

console.log('\n-- MECHANICS');

check('trimmedSpan cuts on token boundaries, never mid-identifier', () => {
  const span = trimmedSpan('foo(hasOwnProperty, x)', 'foo(hasOwn, x)');
  assert.ok(!/^wnProperty|^sOwnProperty/.test(span), `cut mid-identifier: ${JSON.stringify(span)}`);
});

check('a pure deletion keeps the whole removed line as the stem', () => {
  const p = 'diff --git a/a.js b/a.js\n@@ -1,3 +1,2 @@\n-  const legacyHelper = requireThing();\n   keep();';
  const [s] = deriveStems(parsePatch(p)).span;
  assert.equal(s.stem, 'const legacyHelper = requireThing();');
});

console.log('\n-- GROUND TRUTH (skipped off-box)');

const G = process.env.GOLDEN_UNDERSCORE
  || '/root/.ss-eval/golden/jashkenas__underscore@4bd6f69b33179517d4ff9f6020637d6f336c5f99/underscore.js';
if (existsSync(G)) {
  check('base tree really does hold the stem twice, at groupBy and countBy', () => {
    const lines = readFileSync(G, 'utf8').split('\n');
    const at = lines.map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('_.has(result, key)'));
    assert.equal(at.length, 2, `expected 2 occurrences in the base tree, found ${at.length}`);
    assert.deepEqual(at.map(([n]) => n), [448, 461], `occurrences moved: ${JSON.stringify(at.map(([n]) => n))}`);
  });
} else {
  console.log('  skip  base-tree check (golden not present here)');
}

console.log(`\n${pass} controls passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
