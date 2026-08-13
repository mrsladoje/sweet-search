// Lock B contract evaluator. Applies each opaque candidate to the base tree (overlay of the
// touched files only) and returns ACCEPT / REJECT / UNDECIDED. Prints opaque IDs only.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = '/root/blinded-work';
const GOLD = '/root/.ss-eval/golden';
const WORK = '/tmp/bw';

const BASE_COMMIT = {
  'apple__swift-nio-http2-145': '3d0b38268ecda6ba0e7a1d5aca1c3c5a20f7c42a',
  'codeception__codeceptjs-367': '9ed81962765b738eaa4d6bad059ce72081547190',
  'dashbitco__nimble_options-43': '5270554b86676476b3e63d91f54c0d340a67102c',
  'epiforecasts__scoringutils-229': '53436b609c29c7b72016ea645601a21a8ee3564b',
  'pytask-dev__pytask-210': '30227332d58cbe0dc8a055cafd5711eb1cd653d8',
  'jashkenas__underscore-2757': '4bd6f69b33179517d4ff9f6020637d6f336c5f99',
  'redboltz__mqtt_cpp-466': 'f48e140ba080e6078ad4066ae6280b5d10210521',
  'statamic__cms-9029': 'ce8e80987e29c8929364dc8387cd0f2399128202',
};
const goldens = fs.readdirSync(GOLD);
const baseOf = {};
for (const [t, c] of Object.entries(BASE_COMMIT)) {
  const hit = goldens.find(g => g.endsWith('@' + c));
  baseOf[t] = hit ? `${GOLD}/${hit}` : null;
}
fs.writeFileSync(`${OUT}/base-dirs.json`, JSON.stringify(baseOf, null, 1));

// ───────────────────────── patch application (overlay) ─────────────────────────
function patchTargets(txt) {
  const s = new Set();
  for (const m of txt.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)) if (m[1] !== '/dev/null') s.add(m[1]);
  for (const m of txt.matchAll(/^--- (?:a\/)?(\S+)/gm)) if (m[1] !== '/dev/null') s.add(m[1]);
  for (const m of txt.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)) { s.add(m[1]); s.add(m[2]); }
  return [...s];
}

function applyOverlay(task, oid) {
  const base = baseOf[task];
  const dir = `${WORK}/${task}/${oid}`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const patch = fs.readFileSync(`${OUT}/pools/${task}/${oid}.patch`, 'utf8');
  for (const rel of patchTargets(patch)) {
    const src = path.join(base, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.copyFileSync(src, dst); } catch { /* directory target */ }
  }
  const pf = `${dir}/.cand.patch`;
  fs.writeFileSync(pf, patch);
  let ok = false, how = '';
  for (const args of [['apply', '-p1', '--unsafe-paths', '--directory=.', pf],
                      ['apply', '-p1', '--unsafe-paths', '-C1', '--directory=.', pf],
                      ['apply', '-p1', '--unsafe-paths', '--reject', '--directory=.', pf]]) {
    try { execFileSync('git', args, { cwd: dir, stdio: 'pipe' }); ok = true; how = args.join(' '); break; }
    catch { /* next */ }
  }
  if (!ok) {
    try { execFileSync('patch', ['-p1', '--batch', '--forward', '-i', pf], { cwd: dir, stdio: 'pipe' }); ok = true; how = 'patch -p1'; }
    catch { /* give up */ }
  }
  return { dir, ok, how, patch };
}

const readers = {};
function mk(task, dir) {
  const base = baseOf[task];
  return (rel) => {
    const a = path.join(dir, rel);
    if (fs.existsSync(a) && fs.statSync(a).isFile()) return fs.readFileSync(a, 'utf8');
    const b = path.join(base, rel);
    if (fs.existsSync(b) && fs.statSync(b).isFile()) return fs.readFileSync(b, 'utf8');
    return null;
  };
}

const V = (v, why, detail) => ({ verdict: v, why, detail: detail || {} });
const sh = (cmd, args, opts = {}) => {
  try { return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, ...opts }) }; }
  catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message) }; }
};

// ───────────────────────────── B1 underscore ─────────────────────────────
function B1(task, dir, read) {
  const src = read('underscore.js');
  if (!src) return V('UNDECIDED', 'underscore.js unreadable');
  const f = `${dir}/_probe_underscore.js`;
  fs.writeFileSync(f, src);
  const driver = `
const _ = require(${JSON.stringify(f)});
const r = {};
try { const a=[1,2]; const g=_.groupBy([{p:a,o:1},{p:a,o:2}],'p');
      const k=Object.keys(g); r.P1 = k.length===1 && g[k[0]].length===2; } catch(e){ r.P1='ERR'; }
try { const g=_.groupBy([1.3,2.1,2.4], Math.floor);
      r.P2 = JSON.stringify(g)===JSON.stringify({1:[1.3],2:[2.1,2.4]}); } catch(e){ r.P2='ERR'; }
try { const a=[1,2]; const g=_.countBy([{p:a},{p:a}],'p');
      const k=Object.keys(g); r.P3 = k.length===1 && g[k[0]]===2; } catch(e){ r.P3='ERR'; }
try { r.P4 = _.has({a:{b:'foo'}},['a','b'])===true; } catch(e){ r.P4='ERR'; }
try { r.P5 = _.has({a:{b:'foo'}},['a','x'])===false; } catch(e){ r.P5='ERR'; }
try { const a=[1,2]; const g=_.indexBy([{p:a,o:1},{p:a,o:2}],'p');
      r.P6 = Object.keys(g).length===1; } catch(e){ r.P6='ERR'; }
console.log(JSON.stringify(r));`;
  const df = `${dir}/_drv.js`; fs.writeFileSync(df, driver);
  const res = sh('node', [df]);
  if (!res.ok) return V('REJECT', 'module throws on load', { err: res.out.slice(0, 200) });
  let r; try { r = JSON.parse(res.out.trim().split('\n').pop()); } catch { return V('UNDECIDED', 'probe output unparseable'); }
  if (r.P1 !== true || r.P4 !== true) return V('REJECT', 'P1 or P4 failed', r);
  if (Object.values(r).every(v => v === true)) return V('ACCEPT', 'P1-P6 hold', r);
  return V('UNDECIDED', 'partial', r);
}

// ───────────────────────────── B2 pytask ─────────────────────────────
function B2(task, dir, read) {
  const src = read('src/_pytask/traceback.py');
  if (!src) return V('UNDECIDED', 'traceback.py unreadable');
  if (!/_is_internal_or_hidden_traceback_frame/.test(src)) return V('UNDECIDED', 'predicate not present under expected name');
  const mod = `${dir}/_tb_src.py`; fs.writeFileSync(mod, src);
  const drv = `${dir}/_tb_drv.py`;
  fs.writeFileSync(drv, `
import sys, types, json, inspect
from pathlib import Path
def stub(name, file=None, **attrs):
    m = types.ModuleType(name)
    if file: m.__file__ = file
    for k,v in attrs.items(): setattr(m,k,v)
    sys.modules[name] = m
    return m
stub('_pytask', '/stubroot/_pytask/__init__.py')
stub('pluggy', '/stubroot/pluggy/__init__.py')
rich = stub('rich', '/stubroot/rich/__init__.py')
tb = stub('rich.traceback', '/stubroot/rich/traceback.py', Traceback=type('Traceback',(object,),{}))
rich.traceback = tb
stub('rich.console', '/stubroot/rich/console.py', Console=type('Console',(object,),{}))
ns = {'__name__':'_probe_tb'}
src = open(${JSON.stringify(mod)}).read()
try:
    exec(compile(src, 'traceback.py', 'exec'), ns)
except Exception as e:
    print(json.dumps({'LOAD':'ERR','msg':str(e)})); raise SystemExit(0)
fn = ns.get('_is_internal_or_hidden_traceback_frame')
if fn is None:
    print(json.dumps({'LOAD':'MISSING'})); raise SystemExit(0)
class Code:
    co_filename = '/tmp/userland/script.py'
class Frame:
    def __init__(self, loc): self.f_locals = loc; self.f_code = Code()
class TB:
    def __init__(self, loc): self.tb_frame = Frame(loc); self.tb_next = None
def call(loc):
    t = TB(loc)
    nargs = len(inspect.signature(fn).parameters)
    args = [t] + [None]*(nargs-1)
    return fn(*args)
r = {}
cases = {'Q1': {'__tracebackhide__': (lambda *a, **k: True)},
         'Q2': {'__tracebackhide__': (lambda *a, **k: False)},
         'Q3': {'__tracebackhide__': True},
         'Q4': {'__tracebackhide__': False},
         'Q5': {}}
want = {'Q1': True, 'Q2': False, 'Q3': True, 'Q4': False, 'Q5': False}
for k, loc in cases.items():
    try: r[k] = (bool(call(loc)) == want[k])
    except Exception as e: r[k] = 'ERR:'+type(e).__name__
print(json.dumps(r))
`);
  const res = sh('python3', [drv]);
  let r; try { r = JSON.parse(res.out.trim().split('\n').pop()); } catch { return V('UNDECIDED', 'probe output unparseable', { out: res.out.slice(0, 300) }); }
  if (r.LOAD) return V('UNDECIDED', 'module load ' + r.LOAD, r);
  if (r.Q2 !== true) return V('REJECT', 'callable not consulted (Q2)', r);
  if (r.Q3 !== true || r.Q4 !== true || r.Q5 !== true) return V('REJECT', 'boolean/absent regressed', r);
  if (Object.values(r).every(v => v === true)) return V('ACCEPT', 'Q1-Q5 hold', r);
  return V('UNDECIDED', 'partial', r);
}

// ───────────────────────────── B3 codeceptjs ─────────────────────────────
function B3(task, dir, read) {
  const src = read('lib/actor.js');
  if (!src) return V('UNDECIDED', 'lib/actor.js unreadable');
  // materialise the whole lib/ so intra-lib requires resolve, then overlay patched files
  const libDst = `${dir}/_lib`;
  fs.rmSync(libDst, { recursive: true, force: true });
  fs.cpSync(path.join(baseOf[task], 'lib'), libDst, { recursive: true });
  const pdir = path.join(dir, 'lib');
  if (fs.existsSync(pdir)) fs.cpSync(pdir, libDst, { recursive: true, force: true });
  const drv = `${dir}/_ce_drv.js`;
  fs.writeFileSync(drv, `
const Module = require('module');
const printed = [];
const queue = [];
const anyFn = () => {};
const proxy = (base) => new Proxy(base, { get(t, p) {
  if (p in t) return t[p];
  if (typeof p === 'symbol') return undefined;
  return anyFn;
}});
const outputStub = proxy({
  say: (m) => printed.push(String(m)),
  print: (m) => printed.push(String(m)),
  debug: () => {}, log: (m) => printed.push(String(m)),
  level: () => 1, stepShift: 0,
});
const recorderStub = proxy({
  add: (a, b) => { const fn = typeof a === 'function' ? a : b; if (fn) queue.push(fn); return Promise.resolve(); },
  promise: () => Promise.resolve(),
  catchWithoutStop: () => {}, catch: () => {}, session: proxy({}),
  start: () => {}, stop: () => {}, throw: () => {}, reset: () => {},
});
const eventStub = proxy({
  emit: () => {}, dispatcher: proxy({ emit: () => {}, on: () => {} }),
  step: { before: 'sb', after: 'sa', started: 'ss', passed: 'sp', failed: 'sf', comment: 'sc' },
  hook: proxy({}), test: proxy({}), suite: proxy({}), all: proxy({}),
});
const containerStub = proxy({
  helpers: () => ({}),
  translation: () => ({ loaded: false, actionAliasFor: (a) => a, I: 'I', value: (x) => x, vocabulary: {} }),
  support: () => ({}), plugins: () => ({}), mocha: () => ({}),
});
const stubs = { container: containerStub, recorder: recorderStub, event: eventStub, output: outputStub };
const orig = Module._load;
Module._load = function (req, parent, isMain) {
  const base = String(req).replace(/^.*\\//, '').replace(/\\.js$/, '');
  if (stubs[base]) return stubs[base];
  return orig.apply(this, arguments);
};
const r = {};
let I;
try { I = require(${JSON.stringify(libDst + '/actor.js')})({}); } catch (e) { console.log(JSON.stringify({ BUILD: 'ERR', msg: String(e).slice(0,200) })); process.exit(0); }
const names = ['say', 'comment', 'remark', 'annotate'].filter(n => typeof I[n] === 'function');
r.R1 = names.length > 0;
r.names = names;
if (!r.R1) { console.log(JSON.stringify(r)); process.exit(0); }
const n = names[0];
printed.length = 0; queue.length = 0;
try { I[n]('hello'); } catch (e) { r.CALL = 'ERR:' + String(e).slice(0,120); }
r.R2 = printed.length === 0;
r.queued = queue.length;
(async () => {
  for (const fn of queue.slice()) { try { await fn(); } catch (e) {} }
  r.R3 = printed.some(p => String(p).includes('hello'));
  console.log(JSON.stringify(r));
})();
`);
  const res = sh('node', [drv]);
  let r; try { r = JSON.parse(res.out.trim().split('\n').pop()); } catch { return V('UNDECIDED', 'probe unparseable', { out: res.out.slice(0, 300) }); }
  if (r.BUILD) return V('UNDECIDED', 'actor could not be built', r);
  if (r.R1 === true && r.R2 === false) return V('REJECT', 'method prints synchronously', r);
  if (r.R1 === true && r.R2 === true && r.R3 === true) return V('ACCEPT', 'R1-R3 hold', r);
  return V('UNDECIDED', 'partial', r);
}

// ───────────────────────────── B4 nimble_options ─────────────────────────────
function B4(task, dir, read) {
  const src = read('lib/nimble_options.ex');
  if (!src) return V('UNDECIDED', 'nimble_options.ex unreadable');
  const bt = src.match(/@basic_types\s*\[([\s\S]*?)\]/);
  const S1 = !!bt && /(^|[\s,\[])\:integer\s*(,|\]|$)/m.test(bt[1]);
  const clauses = [...src.matchAll(/defp\s+validate_type\(\s*:(\w+)\s*,([\s\S]{0,400}?)\bdo\b/g)]
    .map(m => ({ type: m[1], head: m[2] }));
  const intC = clauses.filter(c => c.type === 'integer');
  const S2 = intC.length > 0;
  const S3 = S2 && !intC.some(c => /value\s*[<>]/.test(c.head));
  const nn = clauses.find(c => c.type === 'non_neg_integer');
  const pi = clauses.find(c => c.type === 'pos_integer');
  const S4 = !!nn && /value\s*<\s*0/.test(nn.head) && !!pi && /value\s*<\s*1/.test(pi.head);
  const d = { S1, S2, S3, S4, intClauses: intC.length };
  if (S1 && !S2) return V('REJECT', 'type declared without validation clause', d);
  if (!S4) return V('REJECT', 'neighbouring integer clauses altered', d);
  if (S1 && S2 && S3 && S4) return V('ACCEPT', 'S1-S4 hold', d);
  return V('UNDECIDED', 'partial', d);
}

// ───────────────────────────── B5 scoringutils ─────────────────────────────
function B5(task, dir, read) {
  const src = read('R/input-check-helpers.R');
  if (!src) return V('UNDECIDED', 'input-check-helpers.R unreadable');
  const i = src.indexOf('check_equal_length');
  if (i < 0) return V('UNDECIDED', 'function absent');
  const fnStart = src.indexOf('<- function', i);
  if (fnStart < 0) return V('UNDECIDED', 'function head not found');
  let depth = 0, j = src.indexOf('{', fnStart), end = -1;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) return V('UNDECIDED', 'function body unbalanced');
  const body = src.slice(fnStart, end + 1);
  if (!/stop\s*\(/.test(body)) return V('REJECT', 'stop() removed — check neutered', {});
  if (!/lengths\s*\[\s*lengths\s*!=\s*1\s*\]/.test(body)) return V('UNDECIDED', 'length-1 filter restructured beyond translator');
  const si = body.indexOf('stop(');
  const pre = body.slice(0, si);
  const ifm = [...pre.matchAll(/\bif\s*\(/g)].pop();
  if (!ifm) return V('UNDECIDED', 'guard not found');
  let d2 = 0, s = ifm.index + ifm[0].length - 1, e2 = -1;
  for (let k = s; k < body.length; k++) {
    if (body[k] === '(') d2++;
    else if (body[k] === ')') { d2--; if (d2 === 0) { e2 = k; break; } }
  }
  if (e2 < 0) return V('UNDECIDED', 'guard unbalanced');
  const cond = body.slice(s + 1, e2);
  let js = cond
    .replace(/length\s*\(\s*unique\s*\(\s*lengths\s*\)\s*\)/g, 'UL')
    .replace(/length\s*\(\s*lengths\s*\)/g, 'L.length')
    .replace(/\blengths\b/g, 'L')
    .replace(/!=/g, '!==').replace(/(^|[^=!<>])=(?!=)/g, '$1===')
    .replace(/={4}/g, '===');
  if (/[a-zA-Z_.]\s*\(/.test(js.replace(/\b(UL|L)\b/g, ''))) return V('UNDECIDED', 'guard uses untranslated call: ' + cond.trim().slice(0, 120));
  const evalG = (arr) => {
    const UL = new Set(arr).size, L = arr;
    try { return !!Function('UL', 'L', 'return (' + js + ');')(UL, L); } catch { return 'ERR'; }
  };
  const T1 = evalG([]) === false;
  const T2 = evalG([3]) === false;
  const T3 = evalG([2, 3]) === true;
  const d = { T1, T2, T3, cond: cond.trim().slice(0, 160) };
  if (T3 !== true) return V('REJECT', 'ragged input no longer errors', d);
  if (T1 && T2 && T3) return V('ACCEPT', 'T1-T3 hold', d);
  return V('UNDECIDED', 'partial', d);
}

// ───────────────────────────── B6 mqtt_cpp ─────────────────────────────
function walk(root, out = []) {
  let ents = []; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const p = path.join(root, e.name); e.isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}
function B6(task, dir, read) {
  const base = baseOf[task];
  const rels = walk(path.join(base, 'include/mqtt')).map(p => p.slice(base.length + 1));
  let u1 = 0, u2 = 0, resolveMod = false, epsIter = false, stringRef = false;
  for (const rel of rels) {
    const t = read(rel); if (!t) continue;
    if (/BOOST_VERSION\s*<\s*106600/.test(t)) u1++;
    if (/resolver::query/.test(t)) u2++;
    if (/r\.resolve\(\s*host_\s*,\s*port_\s*\)/.test(t)) resolveMod = true;
    if (/eps\.begin\(\)/.test(t)) epsIter = true;
    if (/boost\/utility\/string_ref\.hpp/.test(t)) stringRef = true;
  }
  const U1 = u1 === 0, U2 = u2 === 0, U3 = resolveMod && epsIter;
  const d = { U1, U2, U3, U4_stringRefGone: !stringRef, legacyGuards: u1, queryRefs: u2 };
  if (U1 && !U2) return V('REJECT', 'guards stripped, legacy resolver::query kept', d);
  if (U1 && !U3) return V('REJECT', 'modern arm not the survivor', d);
  if (U1 && U2 && U3) return V('ACCEPT', 'U1-U3 hold', d);
  return V('UNDECIDED', 'partial', d);
}

// ───────────────────────────── B7 swift-nio ─────────────────────────────
function swiftFn(src, name) {
  const i = src.indexOf('mutating func ' + name);
  if (i < 0) return null;
  const j = src.indexOf('mutating func ', i + 10);
  return src.slice(i, j < 0 ? src.length : j);
}
function caseBlocks(body) {
  const lines = body.split('\n');
  const blocks = []; let cur = null;
  for (const ln of lines) {
    if (/^\s*case\s/.test(ln)) { if (cur) blocks.push(cur); cur = { labels: [], body: [], inLabels: true }; }
    if (!cur) continue;
    const isBody = /^\s*(return|self\.|try |do \{|\}|let |var )/.test(ln) && !/^\s*case\s/.test(ln);
    if (isBody) cur.inLabels = false;
    (cur.inLabels ? cur.labels : cur.body).push(ln);
  }
  if (cur) blocks.push(cur);
  return blocks.map(b => ({ labels: b.labels.join('\n'), body: b.body.join('\n') }));
}
function B7(task, dir, read) {
  const src = read('Sources/NIOHTTP2/StreamStateMachine.swift');
  if (!src) return V('UNDECIDED', 'StreamStateMachine.swift unreadable');
  const recv = swiftFn(src, 'receivePushPromise');
  const send = swiftFn(src, 'sendPushPromise');
  if (!recv) return V('UNDECIDED', 'receivePushPromise not found');
  const blocks = caseBlocks(recv);
  const acc = blocks.filter(b => /processRequestHeaders/.test(b.body));
  const rej = blocks.filter(b => /\.streamError/.test(b.body));
  if (!acc.length || !rej.length) return V('UNDECIDED', 'switch shape unrecognised', { blocks: blocks.length });
  const inAcc = acc.some(b => /halfClosedLocalPeerIdle/.test(b.labels));
  const inRej = rej.some(b => /halfClosedLocalPeerIdle/.test(b.labels));
  const rejLabels = rej.map(b => b.labels).join('\n');
  const V1 = inAcc, V2 = !inRej;
  const V3 = /\.idle\b/.test(rejLabels) && /\.closed\b/.test(rejLabels);
  const V4 = send ? caseBlocks(send).filter(b => /\.streamError/.test(b.body)).some(b => /halfClosedLocalPeerIdle/.test(b.labels)) : null;
  const d = { V1, V2, V3, V4_sendStillRejects: V4 };
  if (!V3) return V('REJECT', 'idle/closed no longer rejected — machine made permissive', d);
  if (V1 && V2 && V3) return V('ACCEPT', 'V1-V3 hold', d);
  return V('UNDECIDED', 'partial', d);
}

// ───────────────────────────── B8 statamic ─────────────────────────────
function B8(task, dir, read) {
  const src = read('src/Licensing/Outpost.php');
  if (!src) return V('UNDECIDED', 'Outpost.php unreadable');
  const pp = `${OUT}/pools/${task}/${dirOid(dir)}.patch`;
  const patch = fs.existsSync(pp) ? fs.readFileSync(pp, 'utf8') : '';
  const added = patch.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const hay = src + '\n' + added;
  const W1 = /LockProvider|method_exists\s*\(|supportsLock|supportsLocks|catch\s*\(\s*\\?(BadMethodCallException|Error|Throwable)/.test(hay);
  const W2 = /->lock\s*\(/.test(hay) && /->block\s*\(/.test(hay);
  const W3 = /\?->release\s*\(|if\s*\(\s*\$lock|\$lock\s*!==\s*null|isset\s*\(\s*\$lock|\$lock\s*&&/.test(hay)
    || !/finally/.test(src);
  const W4 = /performAndCacheRequest|hasCachedResponse/.test(src);
  const d = { W1, W2, W3, W4 };
  if (!W2) return V('REJECT', 'locking removed unconditionally', d);
  if (W1 && W2 && W3 && W4) return V('ACCEPT', 'W1-W4 hold', d);
  return V('UNDECIDED', 'partial', d);
}
function dirOid(dir) { return path.basename(dir); }

const CONTRACTS = {
  'jashkenas__underscore-2757': B1, 'pytask-dev__pytask-210': B2,
  'codeception__codeceptjs-367': B3, 'dashbitco__nimble_options-43': B4,
  'epiforecasts__scoringutils-229': B5, 'redboltz__mqtt_cpp-466': B6,
  'apple__swift-nio-http2-145': B7, 'statamic__cms-9029': B8,
};

const results = {};
for (const task of Object.keys(CONTRACTS)) {
  results[task] = {};
  // CONTROL: unpatched base. A contract that ACCEPTs here is vacuous.
  {
    const bdir = `${WORK}/${task}/BASE`;
    fs.rmSync(bdir, { recursive: true, force: true });
    fs.mkdirSync(bdir, { recursive: true });
    try { results[task]['BASE'] = { ...CONTRACTS[task](task, bdir, mk(task, bdir)), applied: 'none (control)' }; }
    catch (e) { results[task]['BASE'] = V('UNDECIDED', 'contract threw: ' + String(e).slice(0, 200)); }
    fs.rmSync(`${bdir}/_lib`, { recursive: true, force: true });
  }
  const oids = fs.readdirSync(`${OUT}/pools/${task}`).filter(f => f.endsWith('.patch')).map(f => f.replace('.patch', '')).sort();
  for (const oid of oids) {
    const { dir, ok, how } = applyOverlay(task, oid);
    if (!ok) { results[task][oid] = V('UNDECIDED', 'patch did not apply'); continue; }
    try { results[task][oid] = { ...CONTRACTS[task](task, dir, mk(task, dir)), applied: how }; }
    catch (e) { results[task][oid] = V('UNDECIDED', 'contract threw: ' + String(e).slice(0, 200)); }
    fs.rmSync(`${dir}/_lib`, { recursive: true, force: true });
  }
}
fs.writeFileSync(`${OUT}/contract-verdicts.json`, JSON.stringify(results, null, 1));
for (const [t, m] of Object.entries(results)) {
  const c = { ACCEPT: 0, REJECT: 0, UNDECIDED: 0 };
  for (const v of Object.values(m)) c[v.verdict]++;
  console.log(t.padEnd(34), 'A=' + c.ACCEPT, 'R=' + c.REJECT, 'U=' + c.UNDECIDED,
    '|', Object.entries(m).map(([k, v]) => k + ':' + v.verdict[0]).join(' '));
}
