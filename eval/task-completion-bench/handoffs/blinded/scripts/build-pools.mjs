// Build blinded candidate pools per Lock C §1.
// Reads gold from tasks_full_luna_rotate20.json. PRINTS NO PATCH CONTENT and NO identity map.
import fs from 'node:fs';
import crypto from 'node:crypto';

const ROOT = '/root/sweet-search-private/eval/task-completion-bench';
const RES = `${ROOT}/results`;
const GOLD_DIR = '/root/.ss-eval/golden';
const OUT = '/root/blinded-work';
const RUNS = ['sb-codex-20260811', 'sb-opencode-20260811', 'sb-claudecode-20260811'];
const ARMS = ['native', 'sweet'];
const TASKS = [
  'apple__swift-nio-http2-145', 'codeception__codeceptjs-367',
  'dashbitco__nimble_options-43', 'epiforecasts__scoringutils-229',
  'pytask-dev__pytask-210', 'jashkenas__underscore-2757',
  'redboltz__mqtt_cpp-466', 'statamic__cms-9029',
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(`${OUT}/pools`, { recursive: true });

// --- base checkout resolution -------------------------------------------------
const meta = JSON.parse(fs.readFileSync(`${ROOT}/select/tasks_luna_rotate20.json`, 'utf8'));
const goldens = fs.readdirSync(GOLD_DIR);
const baseDir = {};
for (const t of meta) {
  if (!TASKS.includes(t.instance_id)) continue;
  const hit = goldens.find(g => g.endsWith('@' + t.base_commit));
  baseDir[t.instance_id] = hit ? `${GOLD_DIR}/${hit}` : null;
}

// --- candidates ---------------------------------------------------------------
const cands = {};   // task -> [{patch, prov}]
for (const t of TASKS) cands[t] = [];

for (const run of RUNS) {
  for (const arm of ARMS) {
    for (const rep of [0, 1]) {
      const p = rep === 0 ? `${RES}/${run}/${arm}/patches.json`
                          : `${RES}/${run}/${arm}/rep-1/patches.json`;
      if (!fs.existsSync(p)) continue;
      for (const row of JSON.parse(fs.readFileSync(p, 'utf8'))) {
        if (!TASKS.includes(row.instance_id)) continue;
        const patch = row.patch || row.model_patch || '';
        cands[row.instance_id].push({ patch, prov: `${run.split('-')[1]}/${arm}/r${rep}` });
      }
    }
  }
}

// gold — read by this script only
const full = JSON.parse(fs.readFileSync(`${ROOT}/select/.cache/tasks_full_luna_rotate20.json`, 'utf8'));
const fullArr = Array.isArray(full) ? full : Object.values(full);
let goldFound = 0;
for (const row of fullArr) {
  const id = row.instance_id || row.instanceId;
  if (!TASKS.includes(id)) continue;
  const g = row.patch || row.gold_patch || row.golden_patch;
  if (!g) continue;
  cands[id].push({ patch: g, prov: 'GOLD' });
  goldFound++;
  // also stash gold + test patch for the reveal step, in a sealed file
  fs.mkdirSync(`${OUT}/sealed`, { recursive: true });
  fs.writeFileSync(`${OUT}/sealed/${id}.gold.patch`, g);
  const tp = row.test_patch || row.testPatch;
  if (tp) fs.writeFileSync(`${OUT}/sealed/${id}.test.patch`, tp);
  const f2p = row.FAIL_TO_PASS || row.fail_to_pass;
  if (f2p) fs.writeFileSync(`${OUT}/sealed/${id}.f2p.json`, JSON.stringify(f2p));
}

// --- opaque IDs, sealed map ---------------------------------------------------
const sealed = {};
const summary = [];
for (const t of TASKS) {
  const seen = new Set();
  const list = [];
  for (const c of cands[t]) {
    const txt = (c.patch || '').trim();
    if (!txt) continue;
    const h = crypto.createHash('sha256').update(txt).digest('hex');
    list.push({ h, txt, prov: c.prov });
    seen.add(h);
  }
  list.sort((a, b) => a.h.localeCompare(b.h));
  const dir = `${OUT}/pools/${t}`;
  fs.mkdirSync(dir, { recursive: true });
  sealed[t] = {};
  list.forEach((c, i) => {
    const oid = 'K' + String(i + 1).padStart(2, '0');
    fs.writeFileSync(`${dir}/${oid}.patch`, c.txt.endsWith('\n') ? c.txt : c.txt + '\n');
    sealed[t][oid] = { prov: c.prov, sha256: c.h, bytes: c.txt.length };
  });
  const dupes = list.length - new Set(list.map(x => x.h)).size;
  summary.push({ task: t, base: baseDir[t] ? 'ok' : 'MISSING', candidates: list.length,
                 identicalDropped: dupes, hasGoldInPool: list.some(x => x.prov === 'GOLD') });
}

fs.writeFileSync(`${OUT}/SEALED-identity.json`, JSON.stringify(sealed, null, 1));
fs.writeFileSync(`${OUT}/base-dirs.json`, JSON.stringify(baseDir, null, 1));

// print WITHOUT provenance or gold slot
console.log(JSON.stringify(summary.map(s => ({ ...s, hasGoldInPool: undefined })), null, 1));
console.log('goldRowsFound=' + goldFound);
