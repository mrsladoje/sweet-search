#!/usr/bin/env node
// SLATE-B W0 gate — P3: CONTROLS FOR THE DELTA PARSER.
//
// The P1 probe was wrong five times and the P2 replay carried two defects that its own
// controls caught. P3 is the most dangerous of the three because its classifier can be
// wrong in two directions with opposite consequences:
//
//   a FALSE stale  — calling a real, fixable failure "an obsolete assertion". This is
//                    the gate's kill condition and, in production, the move that ships
//                    a broken patch. Every control below that expects REAL guards it.
//   a MISSED stale — never firing at all. That flatters the noise numbers while making
//                    the whole proposal worthless, so silence is checked too.
//
// Every expectation is anchored to text copied VERBATIM out of a recorded screen, and
// the last control re-reads the extracted artifact to prove the literals below are not
// a paraphrase of what the agent actually saw.
//
// Usage: node w0-p3-controls.mjs        (add IN=/root/w0-p3-screens.json on the box)
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { tokens, tokenDiff, parseScreen, classify } from './w0-p3-delta.mjs';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`); }
};

// ---------------------------------------------------------------------- fixtures
// Verbatim from results/sb-claudecode-20260811, dashbitco sweet r1, final run_tests.
const DASHBIT = `
  1) test validate the schema itself before validating the options raise ArgumentError when invalid (NimbleOptionsTest)
     test/nimble_options_test.exs:28
     Wrong message for ArgumentError
     expected:
       "invalid schema given to NimbleOptions.validate/2. Reason: invalid option type :foo.\\n\\nAvailable types: :any, :keyword_list, :non_empty_keyword_list, :atom, :non_neg_integer, :pos_integer, :mfa, :mod_arg, :string, :boolean, :timeout, :pid, {:fun, arity}, {:one_of, choices}, {:custom, mod, fun, args} (in options [:stages])"
     actual:
       "invalid schema given to NimbleOptions.validate/2. Reason: invalid option type :foo.\\n\\nAvailable types: :any, :keyword_list, :non_empty_keyword_list, :atom, :integer, :non_neg_integer, :pos_integer, :mfa, :mod_arg, :string, :boolean, :timeout, :pid, {:fun, arity}, {:one_of, choices}, {:custom, mod, fun, args} (in options [:stages])"
     code: assert_raise ArgumentError, message, fn ->
     stacktrace:
       test/nimble_options_test.exs:41: (test)
`;
// Verbatim from results/sb-claudecode-20260811, codeception native r0, screen i=18.
const CODECEPT = `
  1) Actor should take all methods of helpers:

      AssertionError: expected { Object (hello, bye, ...) } to have keys 'hello', 'bye', and 'greeting'
      + expected - actual

       [
         "bye"
      -  "comment"
         "greeting"
         "hello"
      -  "remark"
      -  "say"
       ]

      at Context.<anonymous> (test/unit/actor_test.js:27:19)
`;
const DASHBIT_ISSUE = 'Add an :integer type to NimbleOptions so schemas can accept plain integers.';
const DASHBIT_PATCH_ADDED = 'defp validate_type(:integer, key, value) when is_integer(value)\n  :integer,';

console.log('P3 delta-parser controls\n');

// --------------------------------------------------------------- tokenisation
check('an Elixir atom stays one token', () => {
  assert.ok(tokens('list of :integer and :non_neg_integer').includes(':integer'));
  assert.ok(tokens('list of :integer and :non_neg_integer').includes(':non_neg_integer'));
});

check('identical strings produce an empty diff', () => {
  const d = tokenDiff('a b c', 'a b c');
  assert.deepEqual([d.ins, d.del], [[], []]);
});

check('diff direction: ins is what ACTUAL gained, del is what EXPECTED lost', () => {
  const d = tokenDiff('a c', 'a b c');
  assert.deepEqual(d.ins, ['b']);
  assert.deepEqual(d.del, []);
});

// -------------------------------------------------------------------- parsing
check('the ExUnit expected/actual block parses at all', () => {
  const f = parseScreen(DASHBIT);
  assert.equal(f.length, 1, `expected one failure, got ${f.length}`);
  assert.match(f[0].test, /raise ArgumentError when invalid/);
});

check('the parsed sides are the right way round on Dashbitco', () => {
  const [f] = parseScreen(DASHBIT);
  assert.ok(!f.expected.includes(':integer,'), 'expected side must NOT advertise :integer');
  assert.ok(f.actual.includes(':integer,'), 'actual side MUST advertise :integer');
});

check('the Dashbitco delta is exactly the one added atom', () => {
  const [f] = parseScreen(DASHBIT);
  const d = tokenDiff(f.expected, f.actual);
  assert.deepEqual(d.del, [], 'nothing may be dropped');
  assert.deepEqual(d.ins.filter(t => /[A-Za-z]/.test(t)), [':integer'], `insertions were ${JSON.stringify(d.ins)}`);
});

check('chai orientation: + is expected, - is actual', () => {
  const f = parseScreen(CODECEPT);
  assert.equal(f.length, 1, `expected one failure, got ${f.length}`);
  assert.ok(f[0].actual.includes('comment') && f[0].actual.includes('say'),
    'the extra keys are what the code PRODUCED, so they belong to actual');
  assert.ok(!f[0].expected.includes('comment'), 'expected must not carry the extra keys');
});

check('the chai legend line never becomes content', () => {
  const [f] = parseScreen(CODECEPT);
  const d = tokenDiff(f.expected, f.actual);
  const changed = [...new Set([...d.ins, ...d.del])].filter(t => /[A-Za-z]/.test(t));
  assert.ok(!changed.includes('expected') && !changed.includes('actual'),
    `the words "expected"/"actual" leaked into the delta: ${JSON.stringify(changed)}`);
  assert.deepEqual(changed.sort(), ['comment', 'remark', 'say']);
});

check('a screen with no expected/actual pair yields nothing rather than a guess', () => {
  assert.equal(parseScreen('1561 tests of 1562 passed, 1 failed.\nTests completed in 4062 milliseconds.').length, 0);
});

// ------------------------------------------------------------- classification
check('SENSITIVITY: the Dashbitco failure is a stale candidate', () => {
  const [f] = parseScreen(DASHBIT);
  const v = classify(f, DASHBIT_ISSUE, DASHBIT_PATCH_ADDED);
  assert.equal(v.verdict, 'STALE-CANDIDATE', v.why);
});

check('SAFETY: issue similarity alone does NOT earn stale', () => {
  const [f] = parseScreen(DASHBIT);
  // Same screen, same issue — but this agent never added :integer anywhere.
  const v = classify(f, DASHBIT_ISSUE, 'defp validate_type(:atom, key, value)');
  assert.equal(v.verdict, 'REAL', 'a delta the patch did not author must not be called stale');
});

check('SAFETY: a delta the issue never mentions is REAL', () => {
  const [f] = parseScreen(DASHBIT);
  const v = classify(f, 'Fix the docs typo in the README.', DASHBIT_PATCH_ADDED);
  assert.equal(v.verdict, 'REAL');
});

check('SAFETY: a DESTRUCTIVE delta is REAL even when issue and patch both name it', () => {
  // Dashbitco r0's actual move: drop an advertised type so an old string keeps passing.
  const destructive = {
    test: 'x',
    expected: 'types: :atom, :integer, :pos_integer',
    actual: 'types: :atom, :integer',
  };
  const v = classify(destructive, 'remove :pos_integer', 'remove :pos_integer');
  assert.equal(v.verdict, 'REAL', 'dropping something the assertion pinned can never be stale');
  assert.match(v.why, /destructive/);
});

check('a pure punctuation delta is UNPARSED, not stale', () => {
  const v = classify({ test: 'x', expected: 'a, b', actual: 'a; b' }, 'anything', 'anything');
  assert.equal(v.verdict, 'UNPARSED');
});

// ------------------------------------------------------- artifact cross-check
// The literals above are only trustworthy if they are what the agent actually saw.
check('the Dashbitco fixture is present verbatim in the extracted artifact', () => {
  const IN = process.env.IN || '/root/w0-p3-screens.json';
  if (!existsSync(IN)) { console.log('       (skipped off-box: no extracted screens)'); return; }
  const cells = JSON.parse(readFileSync(IN, 'utf8'));
  const hit = cells.filter(c => c.taskId === 'dashbitco__nimble_options-43')
    .flatMap(c => c.screens)
    .filter(s => s.out.includes('Available types: :any, :keyword_list, :non_empty_keyword_list, :atom, :integer,'));
  assert.ok(hit.length >= 1, 'the advertised-types actual string must appear in a real screen');
  const parsed = parseScreen(hit[0].out);
  assert.ok(parsed.some(f => /ArgumentError/.test(f.test)),
    'the parser must find the failure in the REAL screen, not only in the fixture');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
