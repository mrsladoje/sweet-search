#!/usr/bin/env node
// warm-fleet.mjs — drive prep-warm.mjs over every ledger task whose latest verdict
// is needs-warming. Sequential (box discipline), disk-guarded, resumable (a task
// whose latest ledger verdict is already gold-valid is skipped).
// Records per-task: gate result, warm image size, DELTA size (the commit layer on
// top of stock — the number that decides keep-fleet vs warm-on-demand).
// Usage: node warm-fleet.mjs --tasks <specs.json> --ledger <ledger.jsonl> --out <dir>
//        [--min-free-gb 15] [--only id1,id2] [--max N]
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadLedger } from './env-ledger.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const TASKS = arg('tasks'); const LEDGER = arg('ledger'); const OUT = arg('out', '/root/env-ledger/warm');
const MIN_FREE_GB = +arg('min-free-gb', 15);
const ONLY = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const MAX = +arg('max', 1e9);
const flagEvict = process.argv.includes('--evict-after-gate');
mkdirSync(OUT, { recursive: true });
const HARNESS_DIR = path.dirname(new URL(import.meta.url).pathname);

const freeGb = () => { try { return +execSync("df -BG --output=avail / | tail -1", { encoding: 'utf8' }).replace(/[^0-9]/g, ''); } catch { return 0; } };
const imgBytes = (img) => { try { return +execFileSync('docker', ['image', 'inspect', '--format', '{{.Size}}', img], { encoding: 'utf8' }).trim(); } catch { return null; } };

const ledger = loadLedger(LEDGER);
let targets = [...ledger.values()].filter(r => r.status === 'needs-warming').map(r => r.instance_id);
if (ONLY.length) targets = targets.filter(id => ONLY.includes(id));
targets = targets.slice(0, MAX);
console.log(`[warm-fleet] ${targets.length} needs-warming targets (min-free ${MIN_FREE_GB}G)`);

const results = [];
for (const id of targets) {
  const free = freeGb();
  if (free < MIN_FREE_GB) { console.log(`[warm-fleet] STOP: disk ${free}G < ${MIN_FREE_GB}G — remaining targets deferred`); break; }
  console.log(`\n[warm-fleet] ${id} (disk ${free}G free) — warming`);
  const t0 = Date.now();
  const r = spawnSync('node', [path.join(HARNESS_DIR, 'prep-warm.mjs'),
    '--tasks', TASKS, '--id', id, '--out', OUT, '--ledger', LEDGER],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 4 * 3600 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  appendFileSync(path.join(OUT, 'fleet.log'), `\n===== ${id} exit=${r.status} =====\n${out}`);
  const gate = r.status === 0 ? 'PASS' : (/GATE FAILED/.test(out) ? 'GATE-FAIL' : 'WARM-FAIL');
  // measure sizes: warm tag + its stock base → delta
  const warmTagM = out.match(/→ (swerebenchv2-warm\/\S+)/);
  const baseM = out.match(/warming \S+ on (\S+) →/);
  const warmTag = warmTagM?.[1] || null; const baseImg = baseM?.[1] || null;
  const wb = warmTag ? imgBytes(warmTag) : null; const bb = baseImg ? imgBytes(baseImg) : null;
  const row = {
    id, gate, mins: +((Date.now() - t0) / 60000).toFixed(1),
    warmTag, warmGb: wb ? +(wb / 1e9).toFixed(2) : null,
    deltaGb: (wb && bb) ? +((wb - bb) / 1e9).toFixed(2) : null,
    diskFreeAfterG: freeGb(),
  };
  results.push(row);
  appendFileSync(path.join(OUT, 'fleet-results.jsonl'), JSON.stringify(row) + '\n');
  console.log(`[warm-fleet] ${id}: ${gate} in ${row.mins}m — warm ${row.warmGb ?? '?'}G (Δ ${row.deltaGb ?? '?'}G), disk ${row.diskFreeAfterG}G free`);
  // --evict-after-gate (warm-on-demand mode): a standing fleet of full warm image
  // chains cannot fit on this box (each gated warm retains its whole base chain →
  // ~150G for 52 tasks). Warms are cheap + reproducible (measured 0.4-7 min typical),
  // so after the GATE VERDICT is recorded in the ledger we delete the warm image too;
  // at run time the green-ledger pre-flight sees the missing image as stale and forces
  // a fresh warm+gate for exactly the tasks being run (shard-warm procedure).
  if (flagEvict && row.gate === 'PASS' && warmTag) {
    try { execFileSync('docker', ['rmi', '-f', warmTag], { stdio: 'ignore', timeout: 120000 }); } catch { /* */ }
    console.log(`[warm-fleet] evicted ${warmTag} (gate verdict retained in ledger; re-warm on demand)`);
  }
  // drop the STOCK tag (re-pullable) — with eviction this frees the whole chain
  if (baseImg && !/^swerebenchv2-(fixed|warm)\//.test(baseImg)) {
    try { execFileSync('docker', ['rmi', baseImg], { stdio: 'ignore', timeout: 60000 }); } catch { /* in use / shared — fine */ }
  }
  if (flagEvict) { try { execSync('docker image prune -f', { stdio: 'ignore', timeout: 120000 }); } catch { /* */ } }
}
console.log(`\n[warm-fleet] DONE: ${results.filter(r => r.gate === 'PASS').length} gated / ${results.length} attempted`);
console.log(`[warm-fleet] fleet disk: ${results.filter(r => r.gate === 'PASS').reduce((a, r) => a + (r.warmGb || 0), 0).toFixed(1)}G total warm images (Σdelta ${results.filter(r => r.gate === 'PASS').reduce((a, r) => a + (r.deltaGb || 0), 0).toFixed(1)}G)`);
