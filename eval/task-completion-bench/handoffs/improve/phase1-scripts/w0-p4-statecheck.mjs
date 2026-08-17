#!/usr/bin/env node
// SLATE-B W0 gate — P4 falsifier 1: the STATE-SPACE CHECKER, frozen before it meets a patch.
//
// P4 proposes `ss-statecheck <symbol>`: parse the state enum and the switch transitions,
// pair directionally related operations, enumerate reachable state/action pairs, and hand
// back concrete counterexample paths. Its pre-registered kill condition is that a
// one-quadrant patch must FAIL the computed matrix without anyone reading the hidden test
// patch or the reference fix.
//
// WHAT THIS FILE MAY READ. It was authored from two things only: the issue text of
// apple/swift-nio-http2#145 and `Sources/NIOHTTP2/StreamStateMachine.swift` at the base
// commit 3d0b382. The reference patch, the hidden test patch, FAIL_TO_PASS and
// PASS_TO_PASS were not opened. It is committed before the replay runs.
//
// THE TWO RULES, AND WHY NEITHER IS A HAND-WRITTEN SEMANTICS.
//
// R-CLASS (end-of-stream closure). The file itself tells us which state pairs differ only
// by "the initiating side has ended its stream": those are exactly the transitions the
// code performs under `if endStream`. We parse that relation out of sendData/receiveData/
// sendHeaders/receiveHeaders rather than declaring it. An operation is called INSENSITIVE
// to one direction of that axis when its own allow-set already contains both endpoints of
// some edge in that direction — the base code demonstrates the insensitivity, we do not
// assume it. Once demonstrated, admitting one endpoint of an edge while rejecting the
// other is a counterexample.
//
//   For receivePushPromise at base: the allow-set holds fullyOpen(.client) and
//   halfClosedLocalPeerActive(.client, initiatedBy: .client), and sendData carries the
//   edge fullyOpen(r) --sendES--> halfClosedLocalPeerActive(r, .client). So PUSH_PROMISE
//   validity does not depend on whether the LOCAL side has ended its stream. It plainly
//   does depend on the REMOTE side, and the rule discovers that too, because no receive-ES
//   edge has both endpoints in the allow-set. The direction is found, not chosen.
//
// R-MIRROR (directional twin closure). sendX and receiveX are the same rule seen from the
// two ends of the wire. The state names carry the reflection: (Local|Remote) is which side
// we are, (Peer|Local) names the responder. A pair is ARMED only when the two allow-sets
// are already exact mirrors in the BASE tree. That precondition is what stops the rule
// firing on operations that are legitimately asymmetric, and it is also this gate's own
// false-positive control: an unarmed pair is reported, never silently skipped.
//
// $0: static parse of Swift source. No agent runs, no grading, no network, no build.
//
// Usage:  node w0-p4-statecheck.mjs <path-to-StreamStateMachine.swift> [--json]
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- generic Swift scanning

// Returns the index just past the brace that closes the one at `open`.
function matchBrace(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return src.length; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return i + 1; }
  }
  return src.length;
}

function skipString(src, i) {
  for (let k = i + 1; k < src.length; k++) {
    if (src[k] === '\\') { k++; continue; }
    if (src[k] === '"') return k;
  }
  return src.length;
}

// Split `text` on separators that sit at nesting depth zero. Used for both switch-arm
// pattern lists and call-argument lists, where a naive split on "," would cut inside
// `.fullyOpen(localRole: .server, ...)`.
function splitTop(text, sep = ',') {
  const out = [];
  let d = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { i = skipString(text, i); continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === sep && d === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

// Strip comments so a `//` mentioning `.closed` is never read as code. Keeps offsets by
// replacing with spaces, so every index reported downstream still points at real source.
function decomment(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '"') { const e = skipString(src, i); out += src.slice(i, e + 1); i = e; continue; }
    if (src[i] === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i); const stop = e < 0 ? src.length : e;
      out += ' '.repeat(stop - i); i = stop - 1; continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i); const stop = e < 0 ? src.length : e + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' '); i = stop - 1; continue;
    }
    out += src[i];
  }
  return out;
}

// ---------------------------------------------------------------- the state enum

// case fullyOpen(localRole: StreamRole, localContentLength: ContentLengthVerifier, ...)
// -> { name, labels: [{label, type}], roleLabels: ['localRole'] }
export function parseStateEnum(src, enumName = 'State') {
  const m = new RegExp(`enum\\s+${enumName}\\s*\\{`).exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  const body = src.slice(open, matchBrace(src, open));
  const cases = new Map();
  const re = /^\s*case\s+([A-Za-z_]\w*)\s*(\(([^\n]*)\))?\s*$/gm;
  let c;
  while ((c = re.exec(body))) {
    const labels = c[3] ? splitTop(c[3]).map(p => {
      const k = p.split(':');
      return k.length >= 2 ? { label: k[0].trim(), type: k.slice(1).join(':').trim() } : { label: null, type: p.trim() };
    }) : [];
    cases.set(c[1], { name: c[1], labels, roleLabels: labels.filter(l => l.type === ROLE_TYPE).map(l => l.label) });
  }
  return cases;
}

const ROLE_TYPE = 'StreamRole';
const ROLES = ['client', 'server'];

// ---------------------------------------------------------------- state patterns

// A pattern is one `.caseName(...)` inside a switch arm or a state assignment.
// `constraints` pins a role label to a constant; `binds` records the local variable a role
// label was bound to, which is how a target state inherits the source state's role.
export function parsePattern(text, cases) {
  const m = /^\.?([A-Za-z_]\w*)\s*(\(([\s\S]*)\))?\s*$/.exec(text.trim());
  if (!m) return null;
  const name = m[1];
  const decl = cases.get(name);
  if (!decl) return null;
  const pat = { case: name, constraints: {}, binds: {} };
  if (!m[3]) return pat;                       // bare `.idle` — matches every role value
  const args = splitTop(m[3]);
  args.forEach((raw, idx) => {
    let label = null, value = raw;
    const colon = splitTop(raw, ':');
    if (colon.length >= 2 && /^[A-Za-z_]\w*$/.test(colon[0])) { label = colon[0]; value = colon.slice(1).join(':').trim(); }
    else label = decl.labels[idx]?.label ?? null;   // positional: `.idle(.client, ...)`
    if (!label || !decl.roleLabels.includes(label)) return;
    const v = value.trim();
    const cm = /^\.([A-Za-z_]\w*)$/.exec(v);
    if (cm && ROLES.includes(cm[1])) pat.constraints[label] = cm[1];
    else {
      const bm = /^(?:let|var)?\s*([A-Za-z_]\w*)$/.exec(v);
      if (bm && bm[1] !== '_') pat.binds[label] = bm[1];
    }
  });
  return pat;
}

// Every ground state a pattern covers. A wildcard role expands to both roles, so
// `.halfClosedRemoteLocalActive` alone covers all four role combinations.
export function groundStates(pat, cases) {
  const roles = cases.get(pat.case).roleLabels;
  let acc = [{}];
  for (const r of roles) {
    const fixed = pat.constraints[r];
    acc = acc.flatMap(a => (fixed ? [{ ...a, [r]: fixed }] : ROLES.map(v => ({ ...a, [r]: v }))));
  }
  return acc.map(a => ({ case: pat.case, roles: a, key: stateKey(pat.case, a) }));
}

export const stateKey = (name, roles) =>
  name + (Object.keys(roles).length ? '(' + Object.keys(roles).sort().map(k => `${k}: .${roles[k]}`).join(', ') + ')' : '');

// ---------------------------------------------------------------- operations

export function parseOperations(src, cases) {
  const ops = new Map();
  const re = /(?:mutating\s+)?func\s+([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index);
    if (open < 0) continue;
    const end = matchBrace(src, open);
    const body = src.slice(open, end);
    const sw = /switch\s+self\.state\s*\{/.exec(body);
    if (!sw) continue;
    const so = body.indexOf('{', sw.index);
    const arms = parseArms(body.slice(so, matchBrace(body, so)), cases);
    if (!arms.length) continue;
    const allow = new Map(), reject = new Map();
    for (const arm of arms) {
      const sink = arm.verdict === 'reject' ? reject : allow;
      for (const p of arm.patterns) for (const g of groundStates(p, cases)) sink.set(g.key, g);
    }
    // An arm can both allow and reject nothing; a state named in both is treated as
    // allowed, because the allowing arm is the one that runs.
    for (const k of allow.keys()) reject.delete(k);
    ops.set(m[1], { name: m[1], body, arms, allow, reject });
  }
  return ops;
}

function parseArms(swBody, cases) {
  const arms = [];
  const marks = [];
  const re = /(^|[\s{;])(case|default)\b/g;
  let m;
  while ((m = re.exec(swBody))) {
    if (depthAt(swBody, m.index) !== 1) continue;    // depth 1 == directly inside the switch
    marks.push({ at: m.index + m[0].length - m[2].length, kw: m[2] });
  }
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].at;
    const stop = i + 1 < marks.length ? marks[i + 1].at : swBody.length;
    const seg = swBody.slice(start, stop);
    const colon = topColon(seg);
    if (colon < 0) continue;
    const header = seg.slice(marks[i].kw.length, colon);
    const body = seg.slice(colon + 1);
    const patterns = marks[i].kw === 'default' ? [] : splitTop(header)
      .map(p => parsePattern(stripWhere(p), cases)).filter(Boolean);
    arms.push({ patterns, body, verdict: armVerdict(body) });
  }
  return arms;
}

const stripWhere = (p) => p.split(/\bwhere\b/)[0].trim();

// Depth of nesting at `idx`, counting braces only. 1 means inside the switch body itself.
function depthAt(src, idx) {
  let d = 0;
  for (let i = 0; i < idx; i++) {
    const c = src[i];
    if (c === '"') { i = skipString(src, i); continue; }
    if (c === '{') d++;
    else if (c === '}') d--;
    else if (c === '(' || c === '[') { // skip the whole group: a `:` inside is a label
      let g = 1;
      for (i++; i < idx && g; i++) { if ('(['.includes(src[i])) g++; else if (')]'.includes(src[i])) g--; }
      i--;
    }
  }
  return d;
}

function topColon(seg) {
  let d = 0;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '"') { i = skipString(seg, i); continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ':' && d === 0) return i;
  }
  return -1;
}

// An arm rejects when everything it can return is a stream error. Anything that succeeds,
// or that hands off to one of the header-processing helpers, is an allowing arm.
function armVerdict(body) {
  const hasError = /result:\s*\.streamError/.test(body);
  const hasOk = /result:\s*\.succeed/.test(body) || /return\s+self\.process[A-Za-z]*\(/.test(body)
    || /self\.state\s*=/.test(body) || /targetState\s*[:=]/.test(body);
  return hasError && !hasOk ? 'reject' : 'allow';
}

// ---------------------------------------------------------------- end-of-stream edges

// The axis is not declared here. It is read off the transitions the file performs under
// `if endStream`, in the four frame operations that carry an END_STREAM flag.
const ES_SOURCES = [
  { fn: 'sendHeaders', dir: 'send' }, { fn: 'sendData', dir: 'send' },
  { fn: 'receiveHeaders', dir: 'recv' }, { fn: 'receiveData', dir: 'recv' },
];

export function parseEndStreamEdges(ops, cases) {
  const edges = [];
  for (const { fn, dir } of ES_SOURCES) {
    const op = ops.get(fn);
    if (!op) continue;
    for (const arm of op.arms) {
      if (!arm.patterns.length) continue;
      // An arm that reports `.streamCreated` is opening the stream, not ending a body on an
      // existing one. `idle --sendHeaders(END_STREAM)--> halfClosedLocalPeerIdle` is such an
      // arm: it crosses stream creation, so the two states are not siblings on this axis and
      // pairing them makes every operation look inconsistent about `idle`. The exclusion is
      // read off the effect the code itself emits, not asserted.
      if (/\.streamCreated(?:AndClosed)?\b/.test(arm.body)) continue;
      for (const blk of endStreamBlocks(arm.body)) {
        for (const t of assignedStates(blk, cases)) {
          for (const src of arm.patterns) edges.push({ fn, dir, src, dst: t });
        }
      }
      // `processTrailers(..., isEndStreamSet: endStream, targetState: .X)` closes the
      // stream on the same flag without an `if`. Missing these would silently shrink the
      // axis, so they are collected explicitly.
      const tr = /process(?:Trailers)\s*\(([\s\S]*?)\)\s*$/m.exec(arm.body);
      if (tr && /isEndStreamSet:\s*endStream/.test(tr[1])) {
        const ts = /targetState:\s*(\.[A-Za-z_]\w*(?:\([^)]*\))?)/.exec(tr[1]);
        const p = ts && parsePattern(ts[1], cases);
        if (p) for (const src of arm.patterns) edges.push({ fn, dir, src, dst: p });
      }
    }
  }
  return edges;
}

function endStreamBlocks(body) {
  const out = [];
  const re = /\bif\s+endStream\s*\{/g;
  let m;
  while ((m = re.exec(body))) {
    const open = body.indexOf('{', m.index);
    out.push(body.slice(open, matchBrace(body, open)));
  }
  return out;
}

function assignedStates(blk, cases) {
  const out = [];
  const re = /(?:self\.state|targetState|targetStateIfFinal)\s*[:=]\s*(\.[A-Za-z_]\w*)\s*(\()?/g;
  let m;
  while ((m = re.exec(blk))) {
    let text = m[1];
    if (m[2]) {
      const open = blk.indexOf('(', m.index + m[1].length);
      let d = 0, i = open;
      for (; i < blk.length; i++) { if (blk[i] === '(') d++; else if (blk[i] === ')') { d--; if (!d) break; } }
      text = m[1] + blk.slice(open, i + 1);
    }
    const p = parsePattern(text, cases);
    if (p) out.push(p);
  }
  return out;
}

// Resolve one edge for one ground source state: constants stay, a role bound in the source
// pattern is carried across, an unbound role stays wildcard and expands.
function edgeTargets(edge, gsrc, cases) {
  const dstRoles = cases.get(edge.dst.case).roleLabels;
  const bindToRole = {};
  for (const [label, varName] of Object.entries(edge.src.binds)) bindToRole[varName] = gsrc.roles[label];
  let acc = [{}];
  for (const r of dstRoles) {
    const fixed = edge.dst.constraints[r];
    const viaBind = edge.dst.binds[r] !== undefined ? bindToRole[edge.dst.binds[r]] : undefined;
    const v = fixed ?? viaBind;
    acc = acc.flatMap(a => (v ? [{ ...a, [r]: v }] : ROLES.map(x => ({ ...a, [r]: x }))));
  }
  return acc.map(a => ({ case: edge.dst.case, roles: a, key: stateKey(edge.dst.case, a) }));
}

export function groundEdges(edges, cases) {
  const out = [];
  for (const e of edges) {
    for (const gsrc of groundStates(e.src, cases)) {
      for (const gdst of edgeTargets(e, gsrc, cases)) {
        if (gdst.case === 'closed') continue;         // terminal; carries no PP question
        if (gdst.key === gsrc.key) continue;
        out.push({ fn: e.fn, dir: e.dir, from: gsrc.key, to: gdst.key });
      }
    }
  }
  return dedupe(out, e => `${e.dir}|${e.from}|${e.to}`);
}

const dedupe = (arr, key) => { const s = new Map(); for (const a of arr) s.set(key(a), a); return [...s.values()]; };

// ---------------------------------------------------------------- the mirror map

// `halfClosedLocalPeerIdle` reflects to `halfClosedRemoteLocalIdle`: the side token flips,
// and the responder token flips with it because the responder is named from whoever it is.
const NAME_RE = /^(halfOpen|halfClosed)(Local|Remote)(Peer|Local)(Idle|Active)$/;
const flipSide = (s) => (s === 'Local' ? 'Remote' : 'Local');
const flipResp = (s) => (s === 'Peer' ? 'Local' : 'Peer');

export function mirrorCase(name, cases) {
  const m = NAME_RE.exec(name);
  if (m) {
    const n = m[1] + flipSide(m[2]) + flipResp(m[3]) + m[4];
    return cases.has(n) ? n : null;
  }
  const r = /^reserved(Local|Remote)$/.exec(name);
  if (r) { const n = 'reserved' + flipSide(r[1]); return cases.has(n) ? n : null; }
  return cases.has(name) ? name : null;   // idle, fullyOpen, closed reflect onto themselves
}

// Reflecting a ground state also swaps which end we are: localRole flips. `initiatedBy`
// names the peer that opened the stream in absolute terms, so it does not flip.
export function mirrorState(key, cases) {
  const m = /^([A-Za-z_]\w*)(?:\((.*)\))?$/.exec(key);
  const dst = mirrorCase(m[1], cases);
  if (!dst) return null;
  const roles = {};
  if (m[2]) for (const part of splitTop(m[2])) {
    const [l, v] = part.split(':').map(s => s.trim());
    const role = v.replace(/^\./, '');
    roles[l] = l === 'localRole' ? (role === 'client' ? 'server' : 'client') : role;
  }
  const declared = cases.get(dst).roleLabels;
  const kept = {};
  for (const l of declared) if (roles[l]) kept[l] = roles[l];
  return stateKey(dst, kept);
}

// ---------------------------------------------------------------- reachability

// Every state assignment in the file, END_STREAM or not, so a counterexample can be given
// as a path an implementation actually walks rather than as an abstract cell.
export function reachability(ops, cases) {
  const edges = [];
  for (const [fn, op] of ops) {
    for (const arm of op.arms) {
      if (!arm.patterns.length) continue;
      for (const t of assignedStates(arm.body, cases)) {
        for (const src of arm.patterns) for (const gs of groundStates(src, cases)) {
          for (const gd of edgeTargets({ src, dst: t }, gs, cases)) edges.push({ fn, from: gs.key, to: gd.key });
        }
      }
    }
  }
  return edges;
}

export function pathTo(target, reach, cases) {
  const starts = [...cases.keys()].filter(c => c === 'idle')
    .flatMap(c => groundStates({ case: c, constraints: {}, binds: {} }, cases)).map(g => g.key);
  const prev = new Map(starts.map(s => [s, null]));
  let frontier = [...starts];
  while (frontier.length) {
    const next = [];
    for (const f of frontier) for (const e of reach) {
      if (e.from !== f || prev.has(e.to)) continue;
      prev.set(e.to, { from: f, fn: e.fn });
      if (e.to === target) return unwind(target, prev);
      next.push(e.to);
    }
    frontier = next;
  }
  return prev.has(target) ? unwind(target, prev) : null;
}

function unwind(target, prev) {
  const steps = [];
  let cur = target;
  while (prev.get(cur)) { const p = prev.get(cur); steps.unshift(`${p.from} --${p.fn}--> ${cur}`); cur = p.from; }
  return steps;
}

// ---------------------------------------------------------------- the two rules

// Only pairs whose base allow-sets are exact reflections get an armed mirror rule. The
// unarmed ones are returned too: a rule that quietly declines to fire is the failure mode
// that flatters a gate, so it is always reported.
export function mirrorPairs(ops, cases, baseOps) {
  const out = [];
  for (const name of ops.keys()) {
    if (!name.startsWith('send')) continue;
    const twin = 'receive' + name.slice(4);
    if (!ops.has(twin)) continue;
    const armed = isMirrorExact(baseOps.get(name), baseOps.get(twin), cases);
    out.push({ send: name, recv: twin, armed });
  }
  return out;
}

function isMirrorExact(a, b, cases) {
  if (!a || !b) return false;
  const imgA = new Set([...a.allow.keys()].map(k => mirrorState(k, cases)).filter(Boolean));
  const imgB = new Set([...b.allow.keys()].map(k => mirrorState(k, cases)).filter(Boolean));
  if (imgA.size !== b.allow.size || imgB.size !== a.allow.size) return false;
  for (const k of b.allow.keys()) if (!imgA.has(k)) return false;
  for (const k of a.allow.keys()) if (!imgB.has(k)) return false;
  return true;
}

export function checkClass(op, gedges, reach, cases) {
  const findings = [];
  for (const dir of ['send', 'recv']) {
    const es = gedges.filter(e => e.dir === dir);
    const demo = es.find(e => op.allow.has(e.from) && op.allow.has(e.to));
    if (!demo) continue;                    // the operation never shows itself insensitive
    for (const e of es) {
      const a = op.allow.has(e.from), b = op.allow.has(e.to);
      if (a === b) continue;
      const missing = a ? e.to : e.from;
      findings.push({
        rule: 'class', op: op.name, axis: dir === 'send' ? 'the local side has ended its stream'
          : 'the remote side has ended its stream',
        why: `${op.name} admits ${a ? e.from : e.to} but rejects ${missing}; the two differ only by `
          + `${dir === 'send' ? 'a locally' : 'a remotely'} sent END_STREAM, an axis this operation is `
          + `insensitive to (it already admits both ends of ${demo.from} --${demo.dir}ES--> ${demo.to}).`,
        state: missing, path: pathTo(missing, reach, cases),
      });
    }
  }
  return findings;
}

export function checkMirror(pair, ops, cases) {
  if (!pair.armed) return [];
  const a = ops.get(pair.send), b = ops.get(pair.recv);
  const findings = [];
  const side = (from, to, fromOp, toOp) => {
    for (const k of from.allow.keys()) {
      const img = mirrorState(k, cases);
      if (!img || to.allow.has(img)) continue;
      findings.push({
        rule: 'mirror', op: toOp, pair: `${pair.send}/${pair.recv}`,
        why: `${fromOp} admits ${k}, but its twin ${toOp} rejects the reflected state ${img}. `
          + `The two allow-sets are exact mirrors in the base tree, so one side moved alone.`,
        state: img,
      });
    }
  };
  side(a, b, pair.send, pair.recv);
  side(b, a, pair.recv, pair.send);
  return findings;
}

// ---------------------------------------------------------------- driver

export function analyze(src, baseSrc) {
  const clean = decomment(src);
  const cases = parseStateEnum(clean);
  if (!cases) return { error: 'no State enum found' };
  const ops = parseOperations(clean, cases);
  const gedges = groundEdges(parseEndStreamEdges(ops, cases), cases);
  const reach = reachability(ops, cases);
  const baseCases = baseSrc ? parseStateEnum(decomment(baseSrc)) : cases;
  const baseOps = baseSrc ? parseOperations(decomment(baseSrc), baseCases) : ops;
  const pairs = mirrorPairs(ops, cases, baseOps);

  const findings = [];
  for (const op of ops.values()) findings.push(...checkClass(op, gedges, reach, cases));
  for (const p of pairs) findings.push(...checkMirror(p, ops, cases));

  return {
    cases: [...cases.keys()], ops: [...ops.keys()], esEdges: gedges, pairs,
    allow: Object.fromEntries([...ops].map(([k, v]) => [k, [...v.allow.keys()].sort()])),
    findings: dedupe(findings, f => `${f.rule}|${f.op}|${f.state}`),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  const baseFile = process.argv.find(a => a.startsWith('--base='))?.slice(7);
  const r = analyze(readFileSync(file, 'utf8'), baseFile ? readFileSync(baseFile, 'utf8') : null);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(r.findings?.length ? 1 : 0); }
  if (r.error) { console.log('ERROR ' + r.error); process.exit(2); }
  console.log(`states ${r.cases.length}  operations ${r.ops.length}  end-of-stream edges ${r.esEdges.length}`);
  console.log('directional pairs: ' + r.pairs.map(p => `${p.send}/${p.recv}=${p.armed ? 'ARMED' : 'unarmed'}`).join('  '));
  for (const f of r.findings) {
    console.log(`\n[${f.rule}] ${f.op}\n  ${f.why}`);
    if (f.path?.length) console.log('  reachable by:\n' + f.path.map(s => '    ' + s).join('\n'));
  }
  console.log(`\nSTATECHECK ${r.findings.length ? 'REJECT' : 'ACCEPT'} (${r.findings.length} counterexamples)`);
  process.exit(r.findings.length ? 1 : 0);
}
