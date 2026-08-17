#!/usr/bin/env node
// SLATE-B W0 gate — P3: THE EXPECTED/ACTUAL DELTA PARSER AND STALE CLASSIFIER.
//
// P3 proposes ss-finish: at the completion boundary, take each still-failing visible
// test and decide whether its failure is
//   REAL             — the patch broke something, or did not do the job; keep working;
//   STALE-CANDIDATE  — the delta between what the assertion pins and what the code now
//                      produces is exactly the public change the issue asked for, so the
//                      assertion is a candidate for explicit adjudication.
// P3 is emphatic that STALE-CANDIDATE is NOT permission to ship red. It is a request for
// adjudication, and the production-safety constraint is that issue/assertion substring
// similarity alone must never earn it.
//
// THE RULE, pre-registered before the sweep (see w0-p3-controls.mjs for the anchors):
//   1. parse the screen into failures carrying an expected and an actual string;
//   2. token-diff them; CHANGED = tokens inserted into actual + tokens dropped from
//      expected;
//   3. STALE-CANDIDATE only if ALL THREE hold:
//      (a) NON-DESTRUCTIVE — expected's token sequence survives inside actual. If the
//          new behaviour dropped something the old assertion pinned, the change is
//          destructive and the failure is REAL. This is the condition that refuses
//          Dashbitco r0's move of deleting `:integer` from the advertised list to keep
//          an old string green.
//      (b) ISSUE-NAMED — every changed token is named in the issue text.
//      (c) SELF-CAUSED — every changed token appears in a line the agent's own patch
//          ADDED. A delta the agent did not author is not evidence about the requested
//          public change; it is a symptom.
//   4. anything unparsed stays UNPARSED and is never called stale. Silence is safe here:
//      the kill condition is a FALSE stale, so an unread screen cannot trip it — but it
//      also cannot be counted as coverage, so both numbers are reported.
//
// (b) alone is the banned move. (a) and (c) are what make it evidence rather than
// similarity.
//
// $0: pure functions over recorded text. No agent runs, no grading, no network.
import { readFileSync } from 'node:fs';

// ------------------------------------------------------------------ tokenisation

// Identifier-shaped runs, numbers, and single punctuation. Elixir atoms (`:integer`),
// Ruby/JS symbols and hyphenated names have to survive as ONE token, otherwise the
// changed-token set fills with punctuation that appears in every issue ever written.
export const tokens = (s) => String(s).match(/:?[A-Za-z_$][\w$-]*|\d+(?:\.\d+)?|[^\s\w]/g) || [];
export const words = (s) => new Set(tokens(s).map(t => t.replace(/^:/, '').toLowerCase()));

// Longest-common-subsequence diff, ordered. Returns {ins, del} as token arrays.
export function tokenDiff(a, b) {
  const A = tokens(a), B = tokens(b);
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return null; // pathological screen; refuse rather than guess
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ins = [], del = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) del.push(A[i++]);
    else ins.push(B[j++]);
  }
  while (i < n) del.push(A[i++]);
  while (j < m) ins.push(B[j++]);
  return { ins, del };
}

// ---------------------------------------------------------------- screen parsing
//
// One parser per shape actually present in the recorded screens. Each returns
// [{test, expected, actual, shape}]. A shape that cannot produce BOTH sides is not
// registered: a failure with no actual/expected pair carries no delta to reason about,
// so it is reported as a failure with no delta rather than guessed at.

const strip = (s) => s.replace(/\[[0-9;]*m/g, '');           // ANSI colour
const unq = (s) => { const t = s.trim(); return /^".*"$/s.test(t) ? t.slice(1, -1) : t; };

// Most runners number their failures. Splitting on that marker first, and parsing each
// block on its own, is what keeps a regex from running past the end of one failure into
// the next — and it is why the parsers below never need an end-of-block lookahead, which
// is what silently matched nothing on the first attempt.
function blocks(out) {
  const res = [];
  const re = /^[ \t]*(\d+)\)[ \t]+(.*)$/gm;
  const marks = [...out.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : out.length;
    res.push({ title: marks[i][2].replace(/:\s*$/, '').trim(), body: out.slice(start, end) });
  }
  return res;
}

// ExUnit (Elixir): "expected:\n  <v>\n     actual:\n  <v>"  — the Dashbitco shape.
function exunit(out) {
  const res = [];
  for (const b of blocks(out)) {
    const m = /^\s*expected:\s*\n([\s\S]*?)^\s*actual:\s*\n([\s\S]*?)(?=^\s*(?:code:|stacktrace:)|$)/m.exec(b.body);
    if (m) res.push({ test: b.title, expected: unq(m[1]), actual: unq(m[2]), shape: 'exunit' });
  }
  return res;
}

// ExUnit "Assertion with == failed" carries left/right instead of expected/actual.
function exunitLR(out) {
  const res = [];
  for (const b of blocks(out)) {
    const m = /^\s*left:\s*(.+?)\n\s*right:\s*(.+?)$/m.exec(b.body);
    if (m) res.push({ test: b.title, expected: unq(m[2]), actual: unq(m[1]), shape: 'exunit-lr' });
  }
  return res;
}

// chai / mocha: "AssertionError: expected X to equal Y" plus a "+ expected - actual"
// block. In that block `+` lines are EXPECTED and `-` lines are ACTUAL — the reverse of
// a normal patch, and getting it backwards would invert every non-destructive check.
function mocha(out) {
  const res = [];
  for (const b of blocks(out)) {
    if (/\+ expected - actual/.test(b.body)) {
      const exp = [], act = [];
      for (const l of b.body.split('\n')) {
        const t = l.trimStart();
        // The legend line is itself "+ expected - actual", so a naive `^\+` reading
        // pushes the words "expected" and "actual" into the expected side. That put two
        // phantom tokens into every chai delta and turned a genuine additive delta into
        // REAL — an UNDER-fire, which is the direction that flatters this gate.
        if (/^[+-]\s*expected\s+-\s+actual\s*$/.test(t)) continue;
        if (/^\+/.test(t)) exp.push(t.slice(1).trim());
        else if (/^-/.test(t)) act.push(t.slice(1).trim());
        else if (t.trim() && !/^(AssertionError|at |\d+\)|\+ expected)/.test(t.trim())) { exp.push(t.trim()); act.push(t.trim()); }
      }
      res.push({ test: b.title, expected: exp.join('\n'), actual: act.join('\n'), shape: 'mocha-diff' });
      continue;
    }
    const inline = /expected\s+(.+?)\s+to\s+(?:equal|be|deeply equal)\s+(.+?)(?:\n|$)/s.exec(b.body);
    if (inline) res.push({ test: b.title, expected: unq(inline[2]), actual: unq(inline[1]), shape: 'mocha-inline' });
  }
  return res;
}

// XCTest (Swift): XCTAssertEqual failed: ("a") is not equal to ("b")
function xctest(out) {
  const res = [];
  const re = /(\S+\.swift:\d+):\s*error:\s*(.+?)\s*:\s*XCTAssert\w*\s+failed:?\s*\("?([\s\S]*?)"?\)\s+is not equal to\s+\("?([\s\S]*?)"?\)/g;
  for (const m of out.matchAll(re)) res.push({ test: m[2].trim(), expected: m[4].trim(), actual: m[3].trim(), shape: 'xctest' });
  return res;
}

// busted (Lua): "Expected objects to be equal.\nPassed in:\n<actual>\nExpected:\n<expected>"
function busted(out) {
  const res = [];
  const re = /Failure\s*(?:→|->)?\s*(.*?)\n[\s\S]*?Passed in:\s*\n([\s\S]*?)\n\s*Expected:\s*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  for (const m of out.matchAll(re)) res.push({ test: m[1].trim(), expected: m[3].trim(), actual: m[2].trim(), shape: 'busted' });
  return res;
}

// pytest: "E   AssertionError: assert <actual> == <expected>"
function pytest(out) {
  const res = [];
  const re = /^E\s+AssertionError:\s*assert\s+([\s\S]*?)\s==\s([\s\S]*?)$/gm;
  for (const m of out.matchAll(re)) res.push({ test: 'assert', expected: unq(m[2]), actual: unq(m[1]), shape: 'pytest' });
  return res;
}

// testthat / generic "Expected: x / Actual: y"
function generic(out) {
  const res = [];
  const re = /Expected:?\s*(.+?)\n\s*(?:Actual|but got|got):?\s*(.+?)$/gim;
  for (const m of out.matchAll(re)) res.push({ test: 'generic', expected: unq(m[1]), actual: unq(m[2]), shape: 'generic' });
  return res;
}

// Language-specific parsers first; `generic` is a LAST RESORT and runs only when none
// of them matched. Letting it run alongside them made the Dashbitco screen yield the
// same failure twice under two shapes, which would double-count every Elixir verdict.
const PARSERS = [exunit, exunitLR, mocha, xctest, busted, pytest];

export function parseScreen(out) {
  const clean = strip(String(out));
  const SEP = String.fromCharCode(31);
  const seen = new Set(), res = [];
  const take = (got) => {
    for (const f of got || []) {
      if (!f.expected || !f.actual || f.expected === f.actual) continue;
      const k = f.test + SEP + f.expected + SEP + f.actual;
      if (seen.has(k)) continue;
      seen.add(k); res.push(f);
    }
  };
  // A shape whose regex throws is not a failure. Language parsers run first and the
  // generic Expected/Actual reader is a LAST RESORT, so it cannot report a second
  // copy of a failure another parser already read.
  for (const p of PARSERS) { try { take(p(clean)); } catch { /* not a failure */ } }
  if (!res.length) { try { take(generic(clean)); } catch { /* not a failure */ } }
  return res;
}

// ------------------------------------------------------------------ classification

// Common English and test-harness furniture: these carry no evidence either way, and
// leaving them in CHANGED would let punctuation-only deltas be "named in the issue".
const NOISE = new Set(['the', 'a', 'an', 'is', 'to', 'be', 'of', 'in', 'and', 'or', 'not', 'it',
  'this', 'that', 'for', 'with', 'as', 'at', 'on', 'by', 'from', 'true', 'false', 'null', 'nil', 'none']);
const meaningful = (t) => /[A-Za-z_]/.test(t) && !NOISE.has(t.replace(/^:/, '').toLowerCase());

export function classify(failure, issueText, patchAddedText) {
  const d = tokenDiff(failure.expected, failure.actual);
  if (!d) return { verdict: 'UNPARSED', why: 'diff refused: screen too large' };
  const changed = [...new Set([...d.ins, ...d.del])].filter(meaningful);
  if (!changed.length) return { verdict: 'UNPARSED', why: 'no meaningful changed token' };

  const destructive = d.del.filter(meaningful);
  if (destructive.length) {
    return { verdict: 'REAL', why: `destructive: the assertion pinned ${JSON.stringify(destructive.slice(0, 6))} and the code no longer produces it`, changed };
  }
  const issue = words(issueText);
  const unnamed = changed.filter(t => !issue.has(t.replace(/^:/, '').toLowerCase()));
  if (unnamed.length) return { verdict: 'REAL', why: `not named in the issue: ${JSON.stringify(unnamed.slice(0, 6))}`, changed };

  const mine = words(patchAddedText);
  const foreign = changed.filter(t => !mine.has(t.replace(/^:/, '').toLowerCase()));
  if (foreign.length) return { verdict: 'REAL', why: `not introduced by this patch: ${JSON.stringify(foreign.slice(0, 6))}`, changed };

  return { verdict: 'STALE-CANDIDATE', why: `additive delta ${JSON.stringify(changed.slice(0, 6))}, named in the issue and introduced by this patch`, changed };
}
