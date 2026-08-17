#!/usr/bin/env node
// SLATE-B W0 gate — P4 controls for the state checker.
//
// The checker can fail in two opposite directions and only one of them is visible from
// the headline. If it under-fires it flatters P4 by never contradicting a patch; if it
// over-fires it kills correct work, which is exactly the cost the P3 gate found and P4's
// ceiling arithmetic never counts. So every control below is asserted in BOTH directions:
// a synthetic patch that ought to be rejected, and one that ought to be accepted.
//
// Control 4 is the one that matters most. A rule nobody can satisfy is not a checker, it
// is a wall. Control 4 constructs the four-quadrant patch by hand and requires the checker
// to return zero counterexamples on it, which proves the rule is satisfiable before any
// recorded patch is scored against it.
//
// $0: pure string surgery on the base file plus a static parse. Nothing is built or run.
import { readFileSync } from 'node:fs';
import { analyze } from './w0-p4-statecheck.mjs';

const BASE = process.env.BASE
  || '/root/.ss-eval/golden/apple__swift-nio-http2@3d0b38268ecda6ba0e7a1d5aca1c3c5a20f7c42a/Sources/NIOHTTP2/StreamStateMachine.swift';
const src = readFileSync(BASE, 'utf8');

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ------------------------------------------------------------------ synthetic patches

// Adding a state to an operation means moving it from the rejecting arm's list into the
// allowing arm's list. Both halves are done, the way a real patch does it, so the checker
// is never handed a switch that names the same state twice.
function admit(text, fn, addPattern, dropName) {
  const at = text.indexOf(`mutating func ${fn}(`);
  if (at < 0) throw new Error(`no ${fn}`);
  const end = text.indexOf('\n    mutating func ', at + 10);
  const stop = end < 0 ? text.length : end;
  let body = text.slice(at, stop);

  // allow arm: the first `case` of the switch, which ends at the `:` before `return self.`
  const allowAt = body.indexOf('switch self.state {');
  const firstCase = body.indexOf('case ', allowAt);
  body = body.slice(0, firstCase + 5) + addPattern + ',\n             ' + body.slice(firstCase + 5);

  // reject arm: drop the bare `.name` entry from the trailing case list
  const re = new RegExp(`\\.${dropName}\\b(?!\\()\\s*,\\s*`, 'g');
  const rejAt = body.lastIndexOf('case .');
  const rej = body.slice(rejAt).replace(re, '');
  body = body.slice(0, rejAt) + rej;

  return text.slice(0, at) + body + text.slice(stop);
}

const RECV_IDLE = '.halfClosedLocalPeerIdle(remoteWindow: _)';
const RECV_HALFOPEN = '.halfOpenLocalPeerIdle(localWindow: _, localContentLength: _, remoteWindow: _)';
const SEND_IDLE = '.halfClosedRemoteLocalIdle(localWindow: _)';
const SEND_HALFOPEN = '.halfOpenRemoteLocalIdle(localWindow: _, remoteContentLength: _, remoteWindow: _)';

const run = (text) => analyze(text, src);
const has = (r, rule, state, op) => r.findings.some(f => f.rule === rule && f.state === state && (!op || f.op === op));

// ------------------------------------------------------------------ 1. the base tree

console.log('\n1. the shipped base tree is clean');
const b = run(src);
check('parse found the state enum', b.cases.length === 11, `${b.cases.length} cases`);
check('parse found ten operations', b.ops.length === 10, b.ops.join(','));
check('eight end-of-stream edges derived', b.esEdges.length === 8, `${b.esEdges.length}`);
check('the push-promise pair is armed',
  b.pairs.some(p => p.send === 'sendPushPromise' && p.armed));
check('the window-update pair is reported UNARMED, not dropped',
  b.pairs.some(p => p.send === 'sendWindowUpdate' && !p.armed));
check('zero counterexamples on unmodified base', b.findings.length === 0,
  b.findings.map(f => `${f.rule}:${f.op}:${f.state}`).join(' '));

// ------------------------------------------------------------------ 2. one quadrant

console.log('\n2. the one-quadrant patch both arms actually wrote');
const p1 = run(admit(src, 'receivePushPromise', RECV_IDLE, 'halfClosedLocalPeerIdle'));
check('rejected', p1.findings.length > 0, `${p1.findings.length} counterexamples`);
check('class rule names the untouched halfOpenLocalPeerIdle',
  has(p1, 'class', 'halfOpenLocalPeerIdle', 'receivePushPromise'));
check('mirror rule names the untouched send twin',
  has(p1, 'mirror', 'halfClosedRemoteLocalIdle', 'sendPushPromise'));
check('a reachable path is attached to the class counterexample',
  p1.findings.find(f => f.rule === 'class')?.path?.length > 0);

// ------------------------------------------------------------------ 3. receive side only

console.log('\n3. both receive states, send side untouched');
let t3 = admit(src, 'receivePushPromise', RECV_IDLE, 'halfClosedLocalPeerIdle');
t3 = admit(t3, 'receivePushPromise', RECV_HALFOPEN, 'halfOpenLocalPeerIdle');
const p3 = run(t3);
check('the class rule falls silent on receivePushPromise',
  !p3.findings.some(f => f.rule === 'class' && f.op === 'receivePushPromise'));
check('the mirror rule still rejects', p3.findings.some(f => f.rule === 'mirror'),
  `${p3.findings.length} counterexamples`);

// ------------------------------------------------------------------ 4. all four

console.log('\n4. the four-quadrant patch — the rule must be satisfiable');
let t4 = t3;
t4 = admit(t4, 'sendPushPromise', SEND_IDLE, 'halfClosedRemoteLocalIdle');
t4 = admit(t4, 'sendPushPromise', SEND_HALFOPEN, 'halfOpenRemoteLocalIdle');
const p4 = run(t4);
check('accepted with zero counterexamples', p4.findings.length === 0,
  p4.findings.map(f => `${f.rule}:${f.op}:${f.state}`).join(' '));
check('and it really did widen both operations',
  p4.allow.receivePushPromise.length === 4 && p4.allow.sendPushPromise.length === 4,
  `recv ${p4.allow.receivePushPromise.length}, send ${p4.allow.sendPushPromise.length}`);

// ------------------------------------------------------------------ 5. rules independent

console.log('\n5. mirrored but class-broken — the two rules are independent');
let t5 = admit(src, 'receivePushPromise', RECV_IDLE, 'halfClosedLocalPeerIdle');
t5 = admit(t5, 'sendPushPromise', SEND_IDLE, 'halfClosedRemoteLocalIdle');
const p5 = run(t5);
check('the mirror rule falls silent', !p5.findings.some(f => f.rule === 'mirror'),
  p5.findings.filter(f => f.rule === 'mirror').map(f => f.state).join(' '));
check('the class rule rejects on both sides',
  has(p5, 'class', 'halfOpenLocalPeerIdle') && has(p5, 'class', 'halfOpenRemoteLocalIdle'),
  p5.findings.map(f => `${f.op}:${f.state}`).join(' '));

// ------------------------------------------------------------------ 6. no free rejection

console.log('\n6. a patch that touches nothing relevant is not rejected');
const p6 = run(src.replace('windowIncrement: UInt32', 'windowIncrement: UInt32 /* touched */'));
check('a comment-only edit stays accepted', p6.findings.length === 0);

console.log(`\nCONTROLS ${failed ? 'FAILED (' + failed + ')' : 'PASSED'}`);
process.exit(failed ? 1 : 0);
