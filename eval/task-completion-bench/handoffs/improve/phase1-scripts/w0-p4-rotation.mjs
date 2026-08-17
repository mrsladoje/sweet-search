#!/usr/bin/env node
// SLATE-B W0 gate — P4 falsifier 3: rotate the checker off its motivating trace.
//
// The pre-registered kill condition is "kill it if project-specific handwritten semantics
// are required for nearly every case". That question has two halves and they need
// different evidence, so both are measured separately here rather than blended.
//
//   PREVALENCE  — how often does the shape the two rules need occur at all? A rule that
//                 fires on one file in one repository is a patch, not a capability.
//   FALSE FIRING — on shipped release trees that nobody is asking us to change, how often
//                 does the checker contradict working code? Every such rejection is the
//                 cost the P3 gate found and P4's ceiling arithmetic never counts: a
//                 terminal checker that contradicts a correct patch converts solves into
//                 non-solves. Recorded rollouts cannot price this, because Apple is the
//                 only task in the corpus with the shape and it is 0/2 in both arms, so
//                 shipped trees are used as the proxy for correct work.
//
// $0: static parse of source already on disk. Golden checkouts are read, never written.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { analyze, parseStateEnum, parseOperations } from './w0-p4-statecheck.mjs';

const GOLDEN = process.env.GOLDEN || '/root/.ss-eval/golden';
const LIMIT_MB = 2;

// The two RULES are language-independent; this PARSER is not. It reads Swift enums and
// `switch self.state`. Counting how many candidate files it cannot read is part of the
// answer, so non-Swift candidates are found too and reported as unparsed rather than
// quietly dropped.
const SHAPE_EXT = new Set(['.swift', '.rs', '.ts', '.js', '.java', '.kt', '.go', '.py', '.cs', '.rb', '.ex', '.dart', '.php', '.scala', '.c', '.cpp', '.h', '.hpp', '.m', '.mm']);
const SKIP_DIR = new Set(['.git', 'node_modules', 'vendor', 'target', 'build', 'dist', '.build', 'Pods', '__pycache__', 'deps', '_build', 'third_party']);

// A candidate is a file where the same stored state field is switched on by several
// operations. That is the minimum the axis and mirror rules need: more than one operation
// partitioning one state space.
const STATE_SWITCH = /\bswitch\s*\(?\s*(?:self|this)[.$]?(?:state|_state|\.state)\b|\bmatch\s+self\.state\b/g;

function* walk(dir, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.build') { if (SKIP_DIR.has(e.name)) continue; }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) yield* walk(p, depth + 1); continue; }
    if (!e.isFile()) continue;
    if (!SHAPE_EXT.has(path.extname(e.name))) continue;
    yield p;
  }
}

const twinPairs = (names) => {
  const out = [];
  for (const n of names) {
    for (const [a, b] of [['send', 'receive'], ['send', 'recv'], ['write', 'read'], ['encode', 'decode'], ['put', 'get']]) {
      if (!n.startsWith(a)) continue;
      const t = b + n.slice(a.length);
      if (names.includes(t)) out.push(`${n}/${t}`);
    }
  }
  return out;
};

const repos = readdirSync(GOLDEN).filter(d => { try { return statSync(path.join(GOLDEN, d)).isDirectory(); } catch { return false; } });
console.log(`scanning ${repos.length} golden checkouts\n`);

const cand = [];        // files with the shape, any language
let scanned = 0;
for (const repo of repos) {
  for (const f of walk(path.join(GOLDEN, repo))) {
    let st; try { st = statSync(f); } catch { continue; }
    if (st.size > LIMIT_MB * 1024 * 1024) continue;
    scanned++;
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    STATE_SWITCH.lastIndex = 0;
    const hits = (text.match(STATE_SWITCH) || []).length;
    if (hits < 3) continue;
    cand.push({ repo, file: path.relative(path.join(GOLDEN, repo), f), ext: path.extname(f), switches: hits, text });
  }
}

console.log(`files read              ${scanned}`);
console.log(`candidate state machines ${cand.length}  (a stored state field switched on by 3+ operations)`);
const byExt = {};
for (const c of cand) byExt[c.ext] = (byExt[c.ext] || 0) + 1;
console.log('by language             ' + JSON.stringify(byExt));
console.log(`distinct repositories   ${new Set(cand.map(c => c.repo)).size}\n`);

// ------------------------------------------------------------- what the parser can read

const parsed = [], unparsed = [];
for (const c of cand) {
  let r;
  try { r = analyze(c.text); } catch (e) { unparsed.push({ ...c, why: 'parse threw: ' + e.message }); continue; }
  if (r.error || !r.ops?.length) { unparsed.push({ ...c, why: r.error || 'no operation switches on the state enum' }); continue; }
  parsed.push({ ...c, r });
}
console.log(`the Swift front end reads  ${parsed.length}/${cand.length}`);
console.log(`  cannot read              ${unparsed.length}`);
const uw = {};
for (const u of unparsed) uw[u.ext] = (uw[u.ext] || 0) + 1;
console.log('  unread by language       ' + JSON.stringify(uw));

const armed = parsed.filter(p => p.r.pairs.some(x => x.armed));
const withEdges = parsed.filter(p => p.r.esEdges.length > 0);
console.log(`\nof the ${parsed.length} it reads:`);
console.log(`  derive an end-of-stream axis   ${withEdges.length}`);
console.log(`  have an armed directional pair ${armed.length}`);
console.log(`  have BOTH (a rule can fire)    ${parsed.filter(p => p.r.esEdges.length && p.r.pairs.some(x => x.armed)).length}`);

// ------------------------------------------------------------- false firing on shipped code

const fires = parsed.filter(p => p.r.findings.length);
console.log(`\n--- false firing`);
console.log(`shipped trees the checker REJECTS  ${fires.length}/${parsed.length}`);
for (const f of fires.slice(0, 20)) {
  console.log(`  ${f.repo.split('@')[0]}  ${f.file}`);
  for (const x of f.r.findings.slice(0, 4)) console.log(`      [${x.rule}] ${x.op}: ${x.state}`);
}
if (fires.length > 20) console.log(`  ... and ${fires.length - 20} more`);

console.log('\n--- portability verdict inputs');
console.log(`languages carrying the shape        ${Object.keys(byExt).length}`);
console.log(`fraction of the shape this parser reads  ${(parsed.length / Math.max(cand.length, 1) * 100).toFixed(1)}%`);
