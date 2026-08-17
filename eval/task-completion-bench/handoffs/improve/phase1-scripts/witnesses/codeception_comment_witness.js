// SLATE-B W0 gate — P3 falsifier 1: HAND-AUTHORED WITNESS for Codeception/CodeceptJS#367.
//
// Authored from the issue text and the base tree at 9ed8196 only. The gold patch, the
// hidden test patch, FAIL_TO_PASS and PASS_TO_PASS were not read.
//
// The issue, in its own words: "Need I.comment() or I.remark() or similar. console.log
// isn't sufficient to print info during tests, because it will run all console.log calls
// right away instead of at the intuitive time."
//
// So the requested behaviour has two halves, and the SECOND half is the whole complaint:
//   1. the actor exposes a comment-style step, and
//   2. that step runs IN ORDER with the other steps rather than immediately.
// A patch that adds `I.comment = console.log` satisfies half 1 and is exactly the thing
// the issue was filed against. Test 2 below is what separates them, and it is derivable
// with no knowledge of the fix: the base tree already shows that every actor method goes
// through `recordStep`, which queues onto `recorder` and returns `recorder.promise()`.
//
// Runs on plain node with two stubs (chalk, mocha's reporter base) for modules the base
// tree imports only for colouring. Nothing else is installed, so the witness cannot be
// contaminated by a dependency resolving differently than it did in 2016.
'use strict';
const assert = require('assert');
const path = require('path');

const ROOT = process.env.REPO || process.cwd();
global.codecept_dir = ROOT;

const actorFactory = require(path.join(ROOT, 'lib/actor'));
const container = require(path.join(ROOT, 'lib/container'));
const recorder = require(path.join(ROOT, 'lib/recorder'));

const results = [];
const check = (name, fn) => {
  return Promise.resolve().then(fn).then(
    () => { results.push([name, 'PASS', '']); },
    (e) => { results.push([name, 'FAIL', String(e && e.message || e).split('\n')[0]]); });
};

function freshActor() {
  container.clear({
    MyHelper: { hello: () => 'hello world', bye: () => 'bye world', _hidden: () => 'hidden' },
    MyHelper2: { greeting: () => 'greetings, world' },
  });
  return actorFactory();
}

// The issue names comment and remark and then says "or similar", so the witness does not
// insist on one spelling. It does insist that SOMETHING comment-shaped exists, and every
// behavioural test below runs against whichever name the patch chose.
const NAMES = ['comment', 'remark', 'say'];
const commentName = (I) => NAMES.find((n) => typeof I[n] === 'function');

// Capture everything the process prints, however it prints it.
function captureOutput() {
  const seen = [];
  const w = process.stdout.write.bind(process.stdout);
  const log = console.log;
  process.stdout.write = (chunk, ...rest) => { seen.push(String(chunk)); return w(chunk, ...rest); };
  console.log = (...args) => { seen.push(args.join(' ')); };
  return { seen, stop: () => { process.stdout.write = w; console.log = log; } };
}

async function main() {
  await check('the actor exposes a comment-style step', () => {
    const I = freshActor();
    assert.ok(commentName(I), `none of ${NAMES.join('/')} is a function on the actor`);
  });

  await check('the comment step still leaves every helper method reachable', () => {
    const I = freshActor();
    for (const m of ['hello', 'bye', 'greeting']) {
      assert.equal(typeof I[m], 'function', `helper method ${m} disappeared from the actor`);
    }
    assert.equal(typeof I._hidden, 'undefined', 'an underscore-prefixed helper method must stay private');
  });

  await check('the comment step returns a promise, like every other step', async () => {
    const I = freshActor();
    const n = commentName(I);
    assert.ok(n, 'no comment-style step to test');
    recorder.start();
    const p = I[n]('hello from the witness');
    assert.ok(p instanceof Promise, `${n}() returned ${typeof p}, not a promise`);
    await recorder.promise();
  });

  // THE ISSUE ITSELF. A comment queued behind a slow step must print AFTER it.
  await check('the comment prints in step order, not immediately', async () => {
    const I = freshActor();
    const n = commentName(I);
    assert.ok(n, 'no comment-style step to test');
    const MARK = 'W0P3-WITNESS-MARK';
    const order = [];
    recorder.start();
    recorder.add('a slow step that must finish first', () =>
      new Promise((res) => setTimeout(() => { order.push('step'); res(); }, 25)));

    const cap = captureOutput();
    try {
      I[n](MARK);
      // If the comment printed synchronously here, the complaint in the issue is
      // unaddressed: console.log runs right away instead of at the intuitive time.
      assert.ok(!cap.seen.some((s) => s.includes(MARK)),
        `${n}() printed immediately; the issue is that this must be deferred`);
      await recorder.promise();
      const printedAt = cap.seen.findIndex((s) => s.includes(MARK));
      assert.ok(printedAt >= 0, `${n}() never printed ${MARK} at all`);
      assert.deepEqual(order, ['step'], 'the queued step did not run');
    } finally {
      cap.stop();
    }
  });

  const failed = results.filter((r) => r[1] === 'FAIL');
  for (const [name, verdict, why] of results) console.log(`  ${verdict}  ${name}${why ? '  — ' + why : ''}`);
  console.log(`WITNESS ${failed.length ? 'REJECT' : 'ACCEPT'} (${results.length - failed.length}/${results.length})`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.log('WITNESS REJECT (harness error) — ' + e.message); process.exit(2); });
