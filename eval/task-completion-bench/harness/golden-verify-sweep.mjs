#!/usr/bin/env node
// golden-verify-sweep.mjs — audit the golden cache (HANDOFF-SLATE-A-RESIDUE §3.G.1).
//
// Every golden built before golden-provenance.mjs existed is UNVERIFIED: the build recorded
// nothing, and the fresh-init (`rm -rf .git && git init`) destroyed the evidence, so no
// after-the-fact inspection of the directory can say which commit it came from. This sweep
// reports that state honestly and, with --deep, settles it by rebuilding the base tree from
// upstream and comparing.
//
//   (default, $0, offline)  classify each golden: verified / unstamped / mismatch / treeDrift
//   --deep                  for unstamped goldens, clone the repo at base_commit into a temp
//                           dir, replay the SAME fresh-init, and compare tree hashes. Requires
//                           network, so it needs the lockdown-off window.
//   --ids a,b               restrict to these instance ids
//   --json <path>           write the full result table
//
// A "deep MATCH" is proof the golden is the base tree. A "deep DIFFER" is proof it is not, and
// every result produced from it has to be discarded — that is the case the handoff is worried
// about, in which a blinded gate reads the answer out of its own working directory.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyGolden, readProvenance, goldenTree, writeProvenance } from './golden-provenance.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const GOLDEN_DIR = path.join(process.env.HOME, '.ss-eval', 'golden');
const TASKS = arg('tasks');
const DEEP = process.argv.includes('--deep');
const ONLY = (arg('ids', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT = arg('json');
if (!TASKS) { console.error('usage: golden-verify-sweep.mjs --tasks <specs.json> [--deep] [--ids a,b] [--json out.json]'); process.exit(2); }

const specs = JSON.parse(readFileSync(TASKS, 'utf8'));
const cacheKeyFor = t => `${t.repo.replace('/', '__')}@${t.base_commit}`;
const sh = (cmd, cwd) => execSync(cmd, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });

/** Rebuild the base tree upstream and replay the identical fresh-init, then hash it. */
function deepTreeFor(t) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'golden-verify-'));
  const d = path.join(tmp, 'r');
  try {
    sh(`git clone --quiet https://github.com/${t.repo}.git ${d}`);
    sh(`git -C ${d} checkout --quiet ${t.base_commit}`);
    // byte-identical to the builders' fresh-init, or the hashes are not comparable
    sh(`rm -rf ${d}/.git && git -C ${d} init -q && printf '.sweet-search/\\n' > ${d}/.git/info/exclude && git -C ${d} add -A && git -C ${d} -c user.email=a@b.c -c user.name=bench commit -q -m base`);
    return goldenTree(d);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const present = new Set(existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter(n => n !== '.provenance') : []);
const rows = [];
for (const t of specs) {
  if (ONLY.length && !ONLY.includes(t.instance_id)) continue;
  const key = cacheKeyFor(t);
  if (!present.has(key)) continue;
  const gdir = path.join(GOLDEN_DIR, key);
  const v = verifyGolden(GOLDEN_DIR, key, { baseCommit: t.base_commit, gdir });
  const row = { id: t.instance_id, repo: t.repo, key, status: v.status, stamp: readProvenance(GOLDEN_DIR, key) };
  if (DEEP && v.status === 'unstamped') {
    try {
      const want = deepTreeFor(t), got = goldenTree(gdir);
      row.deep = want === got ? 'MATCH' : 'DIFFER';
      row.deepWant = want; row.deepGot = got;
      // A deep MATCH is as good as a stamp: record it so the next sweep is offline.
      if (want === got) {
        writeProvenance(GOLDEN_DIR, key, { repo: t.repo, baseCommit: t.base_commit, sourceTreeHash: null, gdir });
        row.status = 'verified(deep)';
      }
    } catch (e) { row.deep = `ERROR: ${String(e.message).slice(0, 120)}`; }
  }
  rows.push(row);
}

const by = s => rows.filter(r => r.status === s).length;
console.log(`=== golden cache audit — ${rows.length} golden(s) present of ${specs.length} task(s) ===\n`);
for (const r of rows) {
  const extra = r.deep ? `  deep=${r.deep}` : '';
  console.log(`  ${String(r.status).padEnd(16)} ${r.id}${extra}`);
}
console.log(`\nverified ${by('verified') + by('verified(deep)')}  unstamped ${by('unstamped')}  mismatch ${by('mismatch')}  treeDrift ${by('treeDrift')}`);
const bad = rows.filter(r => r.status === 'mismatch' || r.status === 'treeDrift' || r.deep === 'DIFFER');
if (bad.length) {
  console.log(`\nNOT THE BASE TREE — every result produced from these must be discarded:`);
  for (const r of bad) console.log(`  ${r.id} (${r.status}${r.deep ? ', deep ' + r.deep : ''})`);
}
if (!DEEP && by('unstamped')) {
  console.log(`\n${by('unstamped')} golden(s) predate the provenance stamp. They are NOT known to be wrong and NOT`);
  console.log('known to be right. Re-run with --deep during a lockdown-off window to settle it.');
}
if (OUT) { writeFileSync(OUT, JSON.stringify(rows, null, 2) + '\n'); console.log(`\nwrote ${OUT}`); }
process.exit(bad.length ? 1 : 0);
