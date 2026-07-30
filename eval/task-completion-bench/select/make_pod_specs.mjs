#!/usr/bin/env node
// make_pod_specs.mjs — build the golden-build inputs for the RunPod indexing pass.
//
// The pod only ever needs to clone a repo at a commit and index it, so it gets a
// GOLD-FREE spec file: instance_id, repo, base_commit, language and nothing else.
// The materialized specs in select/.cache/ carry gold patches and hidden tests and
// must never leave this machine.
//
// Emits, next to the frozen lists:
//   .cache/heldout2_pod_specs.json   -> copy to the pod as /root/ss/heldout2_specs.json
//   .cache/heldout2_golden_keys.tsv  -> instance_id, cache key, tranche, vault status
//
// Order is primary 200 first (manifest order), then reserve by language and rank, so
// a pod session that runs out of time still leaves the primaries complete.
//
//   node select/make_pod_specs.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache');
const VAULT = process.env.SS_VAULT_DIR || path.join(os.homedir(), '.ss-eval', 'vault', 'golden');

const jsonl = (f) => readFileSync(path.join(HERE, f), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const primary = jsonl('tasks_heldout2.jsonl');
const reserve = jsonl('tasks_heldout2_reserve.jsonl')
  .sort((a, b) => (a.language < b.language ? -1 : a.language > b.language ? 1 : a.reserve_rank - b.reserve_rank));

const cacheKey = (t) => `${t.repo.replace('/', '__')}@${t.base_commit}`;
const vaultState = (key) => {
  const dir = path.join(VAULT, key);
  if (!existsSync(dir)) return 'absent';
  if (!existsSync(path.join(dir, '.sweet-search', 'codebase.db'))) return 'incomplete';
  return existsSync(path.join(dir, '.vault-manifest.sha256')) ? 'vaulted' : 'unmanifested';
};

const rows = [];
const seen = new Map();          // cache key -> first instance_id that claims it
for (const [tranche, tasks] of [['primary', primary], ['reserve', reserve]]) {
  for (const t of tasks) {
    const key = cacheKey(t);
    if (seen.has(key)) {         // two tasks sharing repo@commit build once
      rows.push({ ...t, key, tranche, build: false, sharesWith: seen.get(key), vault: vaultState(key) });
      continue;
    }
    seen.set(key, t.instance_id);
    rows.push({ ...t, key, tranche, build: true, vault: vaultState(key) });
  }
}

const podSpecs = rows.filter((r) => r.build).map((r) => ({
  instance_id: r.instance_id, repo: r.repo, base_commit: r.base_commit, language: r.language,
}));
writeFileSync(path.join(CACHE, 'heldout2_pod_specs.json'), JSON.stringify(podSpecs, null, 1));

const tsv = ['instance_id\tcache_key\ttranche\tvault_state'];
for (const r of rows) tsv.push(`${r.instance_id}\t${r.key}\t${r.tranche}\t${r.build ? r.vault : `duplicate-of:${r.sharesWith}`}`);
writeFileSync(path.join(CACHE, 'heldout2_golden_keys.tsv'), tsv.join('\n') + '\n');

const count = (pred) => rows.filter(pred).length;
const need = rows.filter((r) => r.build && r.vault !== 'vaulted');
console.log(`tasks             ${rows.length}  (primary ${primary.length}, reserve ${reserve.length})`);
console.log(`unique cache keys ${seen.size}   (${count((r) => !r.build)} task(s) share a key with another)`);
console.log(`already vaulted   ${count((r) => r.build && r.vault === 'vaulted')}`);
console.log(`  incomplete      ${count((r) => r.build && r.vault === 'incomplete')}`);
console.log(`  unmanifested    ${count((r) => r.build && r.vault === 'unmanifested')}`);
console.log(`TO BUILD ON POD   ${need.length}   (primary ${need.filter((r) => r.tranche === 'primary').length}, reserve ${need.filter((r) => r.tranche === 'reserve').length})`);
console.log(`\nwrote ${path.join(CACHE, 'heldout2_pod_specs.json')} (${podSpecs.length} specs, gold-free)`);
console.log(`wrote ${path.join(CACHE, 'heldout2_golden_keys.tsv')}`);
